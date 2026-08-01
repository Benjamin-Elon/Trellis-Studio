/**
 * Draw.io Plugin: Drag Circle → Auto Group → Resize to Tile (Square Grid, SQLite-backed)
 * With debug logs, re-entrancy guard, resize debounce, and max-tile cap.
 */
Draw.loadPlugin(function (ui) {
    const graph = ui.editor.graph;

    // -------------------- Config --------------------
    const PX_PER_CM = 5;
    const DRAW_SCALE = 0.18;
    const DEFAULT_ICON_DIAM_RATIO = 0.55;
    const MIN_ICON_DIAM_PX = 12;
    const MAX_ICON_DIAM_PX = 28;
    const GROUP_PADDING_PX = 4;
    const MAX_TILES = 1000; // hard cap to avoid freezes
    const RESIZE_DEBOUNCE_MS = 120; // debounce tiling during resize
    const ROTATION_RETILE_DEBOUNCE_MS = 150;
    const DEBUG_PLANT_TILER = false;
    const DEBUG_BED_FIT = false;
    const GRAPH_OVERLAY_Z = Object.freeze({ ANNOTATION: 10000, CONNECTION: 10010, CONTROL: 10020, CONTROL_TOP: 10030 });
    const TRELLIS_DIALOG_Z = 2000000000;

    function applyTilerButtonStyle(button, variant, options) {
        if (window.Trellis && window.Trellis.ui && typeof window.Trellis.ui.applyButtonStyle === "function") {
            window.Trellis.ui.applyButtonStyle(button, variant, options);
        } else if (button) {
            const normalized = variant || "neutral"; // CHANGE
            const activeOpen = normalized === "open" && options && options.active === true; // NEW
            const style = { open: ["#2563eb", activeOpen ? "#1e3a8a" : "#1d4ed8", activeOpen ? "#eff6ff" : "#fff"], add: ["#188038", "#166534", "#fff"], close: ["#b91c1c", "#b91c1c", "#fff"], danger: ["#b91c1c", "#fff", "#b91c1c"], neutral: ["#6b7280", "#111827", "#fff"] }[normalized] || ["#6b7280", "#111827", "#fff"]; // NEW
            button.setAttribute("data-trellis-button-variant", normalized); // CHANGE
            button.style.border = "1px solid " + style[0]; // NEW
            button.style.color = style[1]; // NEW
            button.style.background = style[2]; // NEW
            if (activeOpen) button.style.fontWeight = "700"; // NEW
        }
        return button;
    }

    function tilerButton(label, onClick, variant, options) {
        return applyTilerButtonStyle(mxUtils.button(label, onClick), variant || "neutral", options);
    }

    const GROUP_LABEL_FONT_PX = 12;
    const GROUP_LABEL_LINE_HEIGHT = 1.25;
    const GROUP_LABEL_BAND_PAD_PX = 6;
    const GROUP_LABEL_BAND_PX = Math.ceil(GROUP_LABEL_FONT_PX * GROUP_LABEL_LINE_HEIGHT + GROUP_LABEL_BAND_PAD_PX);

    const MODULE_CURRENT_YEAR_ATTR = "current_year";
    const SEASON_START_YEAR_ATTR = "season_start_year";
    const DEFAULT_BED_WIDTH_CM_ATTR = "default_bed_width_cm";
    const DEFAULT_BED_LENGTH_CM_ATTR = "default_bed_length_cm";
    const CM_PER_METER = 100;
    const CM_PER_FOOT = 30.48;
    const DEFAULT_METRIC_BED_WIDTH_CM = 100;
    const DEFAULT_METRIC_BED_LENGTH_CM = 200;
    const DEFAULT_IMPERIAL_BED_WIDTH_CM = 4 * CM_PER_FOOT;
    const DEFAULT_IMPERIAL_BED_LENGTH_CM = 8 * CM_PER_FOOT;
    const TILER_GROUP_CREATED_EVENT = "usl:tilerGroupCreated";

    // ---------- LOD settings ----------
    const LOD_TILE_THRESHOLD = 300; // collapse if rows*cols > this
    const LOD_SUMMARY_MIN_SIZE = 24; // min px size of summary marker

    // ----------- Yield ---------------
    const YIELD_UNIT = "kg"; // default display unit
    const ATTR_YIELD_EXPECTED = "planting_expected_yield_kg";
    const ATTR_YIELD_ACTUAL = "planting_actual_yield_kg";

    const SHOW_YIELD_IN_GROUP_LABEL = false; // update group title with total yield
    const SHOW_YIELD_IN_SUMMARY = true; // append total yield in summary label

    // ---------------- Disabled tiles + count semantics --------------
    const ATTR_PLANT_COUNT = "plant_count";                           // EXISTING (keep synced to actual) 
    const ATTR_PLANT_COUNT_CAP = "plant_count_capacity";
    const ATTR_PLANT_COUNT_ACT = "plant_count_actual";
    const ATTR_DISABLED_PLANTS = "disabled_plants";

    // --------------- Tiler group scaling font size -----------------
    const GROUP_BASE_AREA_PX2 = 240 * 240;
    const GROUP_LABEL_FONT_MIN_PX = 10;
    const GROUP_LABEL_FONT_MAX_PX = 18;
    const BED_FIT_TOLERANCE = 0.25;
    const BED_FIT_RESIZE_SUPPRESS_MS = 250;
    const EDGE_CIRCLE_CENTER_CONTAINED_PCT = 0.40;
    const BED_AUTO_FIT_ATTR = "bed_auto_fit";
    const BED_FIT_WIDTH_ATTR = "bed_fit_width";
    const BED_FIT_HEIGHT_ATTR = "bed_fit_height";


    // -------------------- Debug helper ------------------
    function log(...args) {
        if (!DEBUG_PLANT_TILER) return;
        try {
            mxLog.debug("[PlantTiler]", ...args);
        } catch (_) { }
    }

    function bedFitDebugEnabled() {
        try {
            if (DEBUG_BED_FIT) return true;
            if (typeof window !== "undefined" && window.__TRELLIS_BED_FIT_DEBUG__ === true) return true;
            if (typeof window !== "undefined" && window.localStorage && window.localStorage.getItem("trellis_bed_fit_debug") === "1") return true;
        } catch (_) { }
        return false;
    }

    function bedFitLog(stage, payload) {
        if (!bedFitDebugEnabled() || typeof console === "undefined") return;
        try {
            const data = payload || {};
            const tables = data.tables || {};
            const scalar = Object.assign({}, data);
            delete scalar.tables;
            if (console.groupCollapsed) console.groupCollapsed("[BedFit]", stage, scalar.txnId != null ? "txn=" + scalar.txnId : "");
            else console.log("[BedFit]", stage, scalar);
            console.log(scalar);
            for (const key of Object.keys(tables)) {
                console.log(key);
                if (console.table) console.table(tables[key]);
                else console.log(tables[key]);
            }
            if (console.groupEnd) console.groupEnd();
        } catch (e) {
            try { console.log("[BedFit] logging failed", stage, e); } catch (_) { }
        }
    }

    function debugLocalStore() {
        try { return typeof window !== "undefined" && window.localStorage ? window.localStorage : null; } catch (_) { return null; }
    }

    function debugFlagSnapshot() {
        const store = debugLocalStore();
        const win = typeof window !== "undefined" ? window : null;
        return {
            storage: {
                trellis_users_debug: store ? store.getItem("trellis_users_debug") : null,
                trellis_bed_fit_debug: store ? store.getItem("trellis_bed_fit_debug") : null
            },
            windowFlags: {
                users: !!(win && win.__TRELLIS_USERS_DEBUG__ === true),
                bedFit: !!(win && win.__TRELLIS_BED_FIT_DEBUG__ === true)
            }
        };
    }

    function bedFitStatus() {
        const win = typeof window !== "undefined" ? window : null;
        const flags = debugFlagSnapshot();
        return {
            plugin: "Plant_Tiler.js",
            loaded: true,
            debugEnabled: bedFitDebugEnabled(),
            url: win && win.location ? String(win.location.href || "") : "",
            origin: win && win.location ? String(win.location.origin || "") : "",
            storage: flags.storage,
            windowFlags: flags.windowFlags,
            bedFitInProgress: !!bedFitInProgress,
            nextTxnId: bedFitTxnSeq + 1,
            tilerFitApiPresent: !!(win && win.USL && win.USL.tiler && typeof win.USL.tiler.retileAndFitToContainingBed === "function")
        };
    }

    function debugProbeSnapshot() {
        const win = typeof window !== "undefined" ? window : null;
        const debug = win && win.Trellis && win.Trellis.debug;
        const flags = debugFlagSnapshot();
        return {
            url: win && win.location ? String(win.location.href || "") : "",
            origin: win && win.location ? String(win.location.origin || "") : "",
            usersPluginLoaded: !!(win && win.__TRELLIS_USERS_PLUGIN_LOADED),
            bedFitPluginLoaded: !!(win && win.__TRELLIS_BED_FIT_PLUGIN_LOADED),
            storage: flags.storage,
            windowFlags: flags.windowFlags,
            usersApiPresent: !!(win && win.Trellis && win.Trellis.users),
            tilerFitApiPresent: !!(win && win.USL && win.USL.tiler && typeof win.USL.tiler.retileAndFitToContainingBed === "function"),
            usersStatus: debug && typeof debug.usersStatus === "function" ? debug.usersStatus() : null,
            bedFitStatus: debug && typeof debug.bedFitStatus === "function" ? debug.bedFitStatus() : null
        };
    }

    function debugProbe() {
        const snapshot = debugProbeSnapshot();
        if (typeof console !== "undefined") {
            try {
                if (console.groupCollapsed) console.groupCollapsed("[TrellisDebug] probe");
                else if (console.log) console.log("[TrellisDebug] probe");
                if (console.log) console.log(snapshot);
            } finally {
                try { if (console.groupEnd) console.groupEnd(); } catch (_) { }
            }
        }
        return snapshot;
    }

    function installTrellisDebugSurface() {
        const win = typeof window !== "undefined" ? window : null;
        if (!win) return null;
        win.Trellis = win.Trellis || {};
        const debug = win.Trellis.debug = win.Trellis.debug || {};
        win.__TRELLIS_BED_FIT_PLUGIN_LOADED = true;
        debug.bedFitStatus = bedFitStatus;
        debug.enable = function () {
            const store = debugLocalStore();
            win.__TRELLIS_USERS_DEBUG__ = true;
            win.__TRELLIS_BED_FIT_DEBUG__ = true;
            if (store) { store.setItem("trellis_users_debug", "1"); store.setItem("trellis_bed_fit_debug", "1"); }
            return debugProbeSnapshot();
        };
        debug.disable = function () {
            const store = debugLocalStore();
            win.__TRELLIS_USERS_DEBUG__ = false;
            win.__TRELLIS_BED_FIT_DEBUG__ = false;
            if (store) { store.removeItem("trellis_users_debug"); store.removeItem("trellis_bed_fit_debug"); }
            return debugProbeSnapshot();
        };
        debug.probe = debugProbe;
        return debug;
    }

    function withUndoSuppressed(fn) {
        if (graph.__withUndoSuppressed) return graph.__withUndoSuppressed(fn);
        const um = ui && ui.editor && ui.editor.undoManager;
        if (!um || typeof um.undoableEditHappened !== "function") return fn();

        if (!graph.__plantTilerUndoSuppressInstalled) {
            const oldUndoableEditHappened = um.undoableEditHappened.bind(um);
            graph.__plantTilerUndoSuppressDepth = graph.__plantTilerUndoSuppressDepth || 0;
            um.undoableEditHappened = function (edit) {
                if (graph.__plantTilerUndoSuppressDepth > 0) return;
                return oldUndoableEditHappened(edit);
            };
            graph.__plantTilerUndoSuppressInstalled = true;
        }

        graph.__plantTilerUndoSuppressDepth++;
        try { return fn(); }
        finally { graph.__plantTilerUndoSuppressDepth--; }
    }

    // -------------------- Utils & Styles --------------------
    function toPx(cm) {
        return cm * PX_PER_CM * DRAW_SCALE;
    }
    function clamp(v, lo, hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    function tileFontPx(iconDiamPx) {
        // Scale label with circle size; clamp for readability
        const fs = Math.round(iconDiamPx * 0.45);
        return clamp(fs, 8, 50);
    }

    function groupLabelMetrics(groupCell) {
        const g = groupCell && groupCell.getGeometry ? groupCell.getGeometry() : null;
        const w = g ? Math.max(1, Number(g.width) || 1) : 1;
        const h = g ? Math.max(1, Number(g.height) || 1) : 1;
        const area = w * h;

        // Scale ~sqrt(area) so it grows proportionally with linear dimensions
        const scale = Math.sqrt(area / GROUP_BASE_AREA_PX2);
        const fontPx = clamp(
            Math.round(GROUP_LABEL_FONT_PX * scale),
            GROUP_LABEL_FONT_MIN_PX,
            GROUP_LABEL_FONT_MAX_PX
        );

        const bandPx = Math.ceil(fontPx * GROUP_LABEL_LINE_HEIGHT + GROUP_LABEL_BAND_PAD_PX);
        return { fontPx, bandPx };
    }

    function upsertStyleKV(styleStr, key, value) {
        const st = String(styleStr || "");
        const parts = st.split(";").filter(Boolean);
        const out = [];
        let found = false;
        for (const p of parts) {
            const i = p.indexOf("=");
            if (i <= 0) { out.push(p); continue; }
            const k = p.slice(0, i);
            if (k === key) {
                out.push(`${key}=${value}`);
                found = true;
            } else {
                out.push(p);
            }
        }
        if (!found) out.push(`${key}=${value}`);
        return out.join(";") + ";";
    }

    function applyGroupLabelFont(model, groupCell) {
        if (!model || !groupCell) return;
        const { fontPx } = groupLabelMetrics(groupCell);
        const next = upsertStyleKV(getStyleSafe(groupCell), "fontSize", String(fontPx));
        if (next !== getStyleSafe(groupCell)) model.setStyle(groupCell, next);
    }

    function plantCircleStyle(fontPx = 10) {
        const fs = clamp(Math.round(Number(fontPx) || 10), 6, 24);
        return [
            "shape=ellipse",
            "aspect=fixed",
            "perimeter=ellipsePerimeter",
            "strokeColor=#111827",
            "strokeWidth=1",
            "fillColor=#ffffff",
            "fillOpacity=50",
            `fontSize=${fs}`,
            "align=center",
            "verticalAlign=middle",
            "html=0",
            "resizable=0",
            "movable=1",
            "deletable=1",
            "editable=0",
            "whiteSpace=nowrap",
        ].join(";");
    }

    function groupFrameStyle() {
        return [
            "shape=rectangle",
            "strokeColor=#000000",
            "strokeOpacity=100",
            "dashed=1",
            "fillColor=none",
            "dashPattern=3 3",
            `fontSize=${GROUP_LABEL_FONT_PX}`,
            "align=center",
            "verticalAlign=top",
            "labelBackgroundColor=#ffffff",
            "labelBorderColor=000000",
            "resizable=1",
            "movable=1",
            "deletable=1",
            "editable=0",
            "whiteSpace=nowrap",
            "html=0",
            "resizeChildren=0",
            "recursiveResize=0"
        ].join(";");
    }

    let __dbPathCached = null;

    async function getDbPath() {
        if (__dbPathCached) return __dbPathCached;

        if (!window.dbBridge || typeof window.dbBridge.resolvePath !== "function") {
            throw new Error("dbBridge.resolvePath not available; add dbResolvePath wiring");
        }

        const r = await window.dbBridge.resolvePath({
            dbName: "Trellis_database.sqlite"
            // seedRelPath omitted -> main uses its default ../../trellis_database/Trellis_database.sqlite
            // reset: true // only for testing if you want to re-copy seed
        });

        __dbPathCached = r.dbPath;
        return __dbPathCached;
    }


    // -------------------- DB (open → query → close) --------------------
    async function queryAll(sql, params) {
        if (!window.dbBridge || typeof window.dbBridge.open !== "function") {
            throw new Error("dbBridge not available; check preload/main wiring");
        }
        const dbPath = await getDbPath();
        const opened = await window.dbBridge.open(dbPath, { readOnly: true });
        try {
            const res = await window.dbBridge.query(opened.dbId, sql, params);
            return Array.isArray(res?.rows) ? res.rows : [];
        } finally {
            try {
                await window.dbBridge.close(opened.dbId);
            } catch (_) { }
        }
    }

    function elevateTrellisDialog() {
        const dlg = ui && ui.dialog;
        if (dlg && dlg.bg && dlg.bg.style) dlg.bg.style.zIndex = String(TRELLIS_DIALOG_Z - 1);
        if (dlg && dlg.container && dlg.container.style) dlg.container.style.zIndex = String(TRELLIS_DIALOG_Z);
    }

    async function execAll(sql, params) {
        if (!window.dbBridge || typeof window.dbBridge.open !== "function") {
            throw new Error("dbBridge not available; check preload/main wiring");
        }
        const dbPath = await getDbPath();
        const opened = await window.dbBridge.open(dbPath, { readOnly: false });
        try {
            if (typeof window.dbBridge.exec === "function") return await window.dbBridge.exec(opened.dbId, sql, params || []);
            if (typeof window.dbBridge.run === "function") return await window.dbBridge.run(opened.dbId, sql, params || []);
            throw new Error("dbBridge.exec/run not available");
        } finally {
            try { await window.dbBridge.close(opened.dbId); } catch (_) { }
        }
    }

    async function execSchemaStatements(statements) {
        if (!window.dbBridge || typeof window.dbBridge.open !== "function") throw new Error("dbBridge not available; check preload/main wiring");
        const dbPath = await getDbPath();
        const opened = await window.dbBridge.open(dbPath, { readOnly: false });
        try {
            for (const statement of statements) {
                if (typeof window.dbBridge.exec === "function") await window.dbBridge.exec(opened.dbId, statement, []);
                else if (typeof window.dbBridge.run === "function") await window.dbBridge.run(opened.dbId, statement, []);
                else throw new Error("dbBridge.exec/run not available");
            }
        } finally {
            try { await window.dbBridge.close(opened.dbId); } catch (_) { }
        }
    }

    function quoteSqlIdentifier(value) {
        return `"${String(value).replace(/"/g, '""')}"`;
    }

    function cityColumnDefinition(column) {
        const parts = [quoteSqlIdentifier(column.name), String(column.type || "TEXT")];
        if (Number(column.pk || 0)) parts.push("PRIMARY KEY");
        if (Number(column.notnull || 0) && !Number(column.pk || 0)) parts.push("NOT NULL");
        if (column.dflt_value != null) parts.push(`DEFAULT ${column.dflt_value}`);
        return parts.join(" ");
    }

    async function cityHasUniqueNameConstraint() {
        const indexes = await queryAll("PRAGMA index_list(Cities);", []);
        for (const index of indexes) {
            if (!Number(index.unique || 0)) continue;
            const indexName = String(index.name || "");
            const columns = (await queryAll(`PRAGMA index_info(${quoteSqlIdentifier(indexName)});`, [])).map(row => String(row.name || ""));
            if (columns.length === 1 && columns[0] === "city_name") return true;
        }
        return false;
    }

    async function rebuildCitiesWithoutUniqueName() {
        const columns = await queryAll("PRAGMA table_info(Cities);", []);
        const names = columns.map(column => String(column.name || "")).filter(Boolean);
        const quotedNames = names.map(quoteSqlIdentifier).join(", ");
        await execSchemaStatements([
            "PRAGMA foreign_keys = OFF;",
            `CREATE TABLE Cities_new (${columns.map(cityColumnDefinition).join(", ")});`,
            `INSERT INTO Cities_new (${quotedNames}) SELECT ${quotedNames} FROM Cities;`,
            "DROP TABLE Cities;",
            "ALTER TABLE Cities_new RENAME TO Cities;",
            "PRAGMA foreign_keys = ON;",
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_Cities_city_geo_identity ON Cities(lower(trim(city_name)), lower(trim(coalesce(country_name, ''))), lower(trim(coalesce(country_code, ''))), lower(trim(coalesce(region_name, ''))), lower(trim(coalesce(region_code, ''))));",
            "CREATE INDEX IF NOT EXISTS idx_Cities_city_name ON Cities(city_name);"
        ]);
    }

    const CITY_GEO_COLUMNS = Object.freeze({
        country_name: "TEXT",
        country_code: "TEXT",
        region_name: "TEXT",
        region_code: "TEXT"
    });
    let cityGeoSchemaEnsured = false;

    async function ensureCityGeographySchema() {
        if (cityGeoSchemaEnsured) return;
        const existing = new Set((await queryAll("PRAGMA table_info(Cities);", [])).map(row => String(row.name || "").toLowerCase()));
        for (const [column, type] of Object.entries(CITY_GEO_COLUMNS)) {
            if (!existing.has(column.toLowerCase())) await execAll(`ALTER TABLE Cities ADD COLUMN ${column} ${type};`, []);
        }
        if (await cityHasUniqueNameConstraint()) await rebuildCitiesWithoutUniqueName();
        cityGeoSchemaEnsured = true;
    }

    function normalizeCityGeoText(value) {
        return String(value == null ? "" : value).trim();
    }

    function normalizeCityIdentityText(value) {
        return normalizeCityGeoText(value).toLowerCase();
    }

    function cityCountryLabel(city) {
        return normalizeCityGeoText(city && city.country_name) || normalizeCityGeoText(city && city.country_code) || "Uncategorized";
    }

    function cityRegionLabel(city) {
        const name = normalizeCityGeoText(city && city.region_name);
        const code = normalizeCityGeoText(city && city.region_code);
        if (name && code && name.toLowerCase() !== code.toLowerCase()) return `${name} (${code})`;
        return name || code || "Uncategorized";
    }

    function cityDisplayLabel(city) {
        return normalizeCityGeoText(city && city.city_name) || "(unnamed city)";
    }

    function fullCityLabel(city) {
        return `${cityDisplayLabel(city)} - ${cityCountryLabel(city)} / ${cityRegionLabel(city)}`;
    }

    function citySearchText(city) {
        return [cityDisplayLabel(city), cityCountryLabel(city), cityRegionLabel(city), normalizeCityGeoText(city && city.country_code), normalizeCityGeoText(city && city.region_code)].join(" ").toLowerCase();
    }

    function sortedCities(cities) {
        return (cities || []).slice().sort((a, b) => {
            const av = [cityCountryLabel(a), cityRegionLabel(a), cityDisplayLabel(a)].join("\u0000").toLowerCase();
            const bv = [cityCountryLabel(b), cityRegionLabel(b), cityDisplayLabel(b)].join("\u0000").toLowerCase();
            return av.localeCompare(bv);
        });
    }

    function makeCityTreePicker(cities, initialValue) {
        let cityRows = sortedCities(cities);
        let currentValue = String(initialValue || (cityRows[0] && cityRows[0].city_id || ""));
        let isOpen = false;
        const root = document.createElement("div");
        root.tabIndex = 0;
        root.style.position = "relative";
        root.style.flex = "1";
        const button = document.createElement("button");
        button.type = "button";
        button.style.width = "100%";
        button.style.padding = "6px";
        button.style.border = "1px solid #bbb";
        button.style.borderRadius = "6px";
        button.style.background = "#fff";
        button.style.textAlign = "left";
        applyTilerButtonStyle(button, "open", { compact: true });
        const panel = document.createElement("div");
        panel.style.position = "absolute";
        panel.style.zIndex = "10000";
        panel.style.left = "0";
        panel.style.right = "0";
        panel.style.top = "100%";
        panel.style.marginTop = "3px";
        panel.style.padding = "6px";
        panel.style.border = "1px solid #bbb";
        panel.style.borderRadius = "6px";
        panel.style.background = "#fff";
        panel.style.boxShadow = "0 8px 20px rgba(0,0,0,0.18)";
        panel.style.display = "none";
        const search = document.createElement("input");
        search.type = "search";
        search.placeholder = "Search city, country, or region";
        search.style.width = "100%";
        search.style.marginBottom = "6px";
        const list = document.createElement("div");
        list.style.maxHeight = "260px";
        list.style.overflow = "auto";
        panel.appendChild(search);
        panel.appendChild(list);
        root.appendChild(button);
        root.appendChild(panel);

        function selectedCity() { return cityRows.find(city => String(city.city_id) === currentValue) || null; }
        function updateButton() { button.textContent = selectedCity() ? fullCityLabel(selectedCity()) : "Select a city..."; }
        function closePicker() { isOpen = false; panel.style.display = "none"; }
        function renderHeader(text, level) {
            const header = document.createElement("div");
            header.textContent = text;
            header.style.fontWeight = level === 1 ? "700" : "600";
            header.style.margin = level === 1 ? "8px 0 3px" : "5px 0 2px 12px";
            header.style.color = "#374151";
            list.appendChild(header);
        }
        function chooseCity(city) {
            currentValue = String(city.city_id);
            updateButton();
            closePicker();
            root.dispatchEvent(new Event("change", { bubbles: true }));
        }
        function renderList() {
            const filter = normalizeCityGeoText(search.value).toLowerCase();
            const visible = cityRows.filter(city => !filter || citySearchText(city).indexOf(filter) >= 0);
            list.innerHTML = "";
            let lastCountry = null;
            let lastRegion = null;
            if (!visible.length) {
                const empty = document.createElement("div");
                empty.textContent = "No matching cities";
                empty.style.color = "#6b7280";
                empty.style.padding = "6px";
                list.appendChild(empty);
                return;
            }
            visible.forEach(city => {
                const country = cityCountryLabel(city);
                const region = cityRegionLabel(city);
                if (country !== lastCountry) { renderHeader(country, 1); lastCountry = country; lastRegion = null; }
                if (region !== lastRegion) { renderHeader(region, 2); lastRegion = region; }
                const item = document.createElement("button");
                item.type = "button";
                item.textContent = cityDisplayLabel(city);
                item.style.display = "block";
                item.style.width = "100%";
                item.style.margin = "1px 0";
                item.style.padding = "4px 6px 4px 24px";
                item.style.border = "0";
                item.style.borderRadius = "4px";
                item.style.background = String(city.city_id) === currentValue ? "#e5f0ff" : "#fff";
                item.style.textAlign = "left";
                item.addEventListener("click", () => chooseCity(city));
                list.appendChild(item);
            });
        }
        function openPicker() { isOpen = true; panel.style.display = "block"; renderList(); search.focus(); }
        Object.defineProperty(root, "value", {
            get() { return currentValue; },
            set(value) { currentValue = String(value || ""); updateButton(); }
        });
        root.setCities = function (nextCities, selectedValue) {
            cityRows = sortedCities(nextCities);
            currentValue = String(selectedValue || (cityRows[0] && cityRows[0].city_id || ""));
            updateButton();
            renderList();
        };
        button.addEventListener("click", () => { isOpen ? closePicker() : openPicker(); });
        search.addEventListener("input", renderList);
        search.addEventListener("keydown", evt => {
            if (evt.key === "Escape") { evt.preventDefault(); closePicker(); button.focus(); }
            if (evt.key === "Enter") {
                const filter = normalizeCityGeoText(search.value).toLowerCase();
                const first = cityRows.find(city => !filter || citySearchText(city).indexOf(filter) >= 0);
                if (first) { evt.preventDefault(); chooseCity(first); }
            }
        });
        document.addEventListener("mousedown", evt => { if (isOpen && !root.contains(evt.target)) closePicker(); });
        updateButton();
        renderList();
        return root;
    }

    async function loadCities() {
        await ensureCityGeographySchema();
        const sql = `
        SELECT *
        FROM Cities
        ORDER BY city_name;
      `;
        const rows = await queryAll(sql);
        return rows;
    }

    async function loadCityById(cityId) {
        await ensureCityGeographySchema();
        const id = Number(cityId);
        if (!Number.isFinite(id)) return null;
        const rows = await queryAll("SELECT * FROM Cities WHERE city_id = ? LIMIT 1;", [id]);
        return rows[0] || null;
    }

    async function cityIdentityExists(row, excludeCityId) {
        await ensureCityGeographySchema();
        const cityName = normalizeCityGeoText(row.city_name);
        const rows = await queryAll(
            "SELECT city_id, city_name, country_name, country_code, region_name, region_code FROM Cities WHERE LOWER(TRIM(city_name)) = LOWER(TRIM(?)) AND (? IS NULL OR city_id <> ?);",
            [cityName, excludeCityId == null ? null : Number(excludeCityId), excludeCityId == null ? null : Number(excludeCityId)]
        );
        const countryName = normalizeCityIdentityText(row.country_name);
        const countryCode = normalizeCityIdentityText(row.country_code);
        const regionName = normalizeCityIdentityText(row.region_name);
        const regionCode = normalizeCityIdentityText(row.region_code);
        return rows.some(existing => {
            const sameCountry = (countryCode && normalizeCityIdentityText(existing.country_code) === countryCode) || (countryName && normalizeCityIdentityText(existing.country_name) === countryName);
            const sameRegion = (regionCode && normalizeCityIdentityText(existing.region_code) === regionCode) || (regionName && normalizeCityIdentityText(existing.region_name) === regionName);
            return sameCountry && sameRegion;
        });
    }

    // ------------------- Layering (garden beds, bed assemblies, other, tiler groups) ----------------

    let __REORDERING = false;

    function isIrrigationBedAssembly(cell) {
        return !!cell && cell.getAttribute && cell.getAttribute("irrigation_assembly") === "1" && cell.getAttribute("irrigation_assembly_type") === "bed";
    }

    function reorderModuleChildrenForLayering(model, moduleCell) {
        if (!model || !moduleCell || !isGardenModule(moduleCell)) return;
        if (__REORDERING) return; // re-entrancy guard

        const n = model.getChildCount(moduleCell);
        if (!n || n <= 1) return;

        // Collect children in current order
        const children = [];
        for (let i = 0; i < n; i++) {
            const ch = model.getChildAt(moduleCell, i);
            if (ch) children.push(ch);
        }
        if (children.length <= 1) return;

        // Partition while preserving relative order within each bucket
        const beds = [];
        const bedAssemblies = [];
        const groups = [];
        const others = [];

        for (const ch of children) {
            if (isGardenBed(ch)) beds.push(ch);
            else if (isIrrigationBedAssembly(ch)) bedAssemblies.push(ch);
            else if (isTilerGroup(ch)) groups.push(ch);
            else others.push(ch);
        }

        const ordered = beds.concat(bedAssemblies, others, groups);

        // If it’s the same order, do nothing (prevents redundant undo edits)
        let same = (ordered.length === children.length);
        if (same) {
            for (let i = 0; i < ordered.length; i++) {
                if (ordered[i] !== children[i]) { same = false; break; }
            }
        }
        if (same) return;

        __REORDERING = true;
        model.beginUpdate();
        try {
            // Move only the ones that are out of place (minimizes undo noise)
            for (let i = 0; i < ordered.length; i++) {
                const ch = ordered[i];
                if (model.getChildAt(moduleCell, i) !== ch) {
                    model.add(moduleCell, ch, i);
                }
            }
        } finally {
            model.endUpdate();
            __REORDERING = false;
        }
    }


    // ----------------- Tiler group helpers ----------------------


    function isValidGardenYear(value) {
        const n = Number(value);
        return Number.isFinite(n) && n > 1900 && n < 3000;
    }
    
    function getCurrentCalendarYear() {
        return new Date().getFullYear();
    }
    
    function getCurrentGardenYear(moduleCell) {
        const moduleYear = getXmlAttr(moduleCell, MODULE_CURRENT_YEAR_ATTR, "");
        if (isValidGardenYear(moduleYear)) return Math.trunc(Number(moduleYear));
    
        return getCurrentCalendarYear();
    }

    function findTilerGroupAncestor(graph, cell) {
        const model = graph.getModel();
        let cur = cell;
        while (cur) {
            if (isTilerGroup(cur)) return cur;
            cur = model.getParent(cur);
        }
        return null;
    }

    function shouldCollapseLOD(graph, groupCell, spacingXpx, spacingYpx) {
        const { count } = computeGridStatsXY(groupCell, spacingXpx, spacingYpx);
        return count > LOD_TILE_THRESHOLD;
    }

    function isCollapsedLOD(groupCell) {
        return (
            groupCell.getAttribute && groupCell.getAttribute("lod_collapsed") === "1"
        );
    }

    function setCollapsedFlag(model, groupCell, v) {
        setCellAttrsNoTxn(model, groupCell, { lod_collapsed: v ? "1" : "0" });
    }


    function clearChildren(graph, groupCell, cellsToRemove) {
        // If explicit list provided, remove only those cells (that are inside group) 
        if (Array.isArray(cellsToRemove) && cellsToRemove.length) {
            const model = graph.getModel();
            const filtered = [];
            for (const c of cellsToRemove) {
                if (!c) continue;
                if (model.getParent(c) !== groupCell) continue;
                filtered.push(c);
            }
            if (filtered.length) graph.removeCells(filtered);
            return;
        }

        // Default: remove all child vertices (existing behavior)
        const kids = graph.getChildVertices(groupCell);
        if (kids && kids.length) graph.removeCells(kids);
    }


    // -------------------- Rotation-aware tile placement --------------------
    const ROTATION_EPS_DEG = 0.000001;

    function toRad(deg) {
        return (Number(deg) || 0) * Math.PI / 180;
    }

    function getTilerRotationDeg(cell) {
        if (!cell) return 0;
        const style = graph.getCellStyle(cell) || {};
        const raw = style[mxConstants.STYLE_ROTATION] != null ? style[mxConstants.STYLE_ROTATION] : style.rotation;
        const n = Number(raw);
        return Number.isFinite(n) ? n : 0;
    }

    function setCellRotationDeg(cell, angleDeg) {
        if (!cell) return false;
        const n = Number(angleDeg);
        const next = Number.isFinite(n) ? n : 0;
        if (nearlySameNumber(getTilerRotationDeg(cell), next)) return false;
        graph.setCellStyles(mxConstants.STYLE_ROTATION, String(next), [cell]);
        return true;
    }

    function hasEffectiveRotation(groupCell) {
        const rot = Math.abs(((getTilerRotationDeg(groupCell) % 360) + 360) % 360);
        return rot > ROTATION_EPS_DEG && Math.abs(rot - 360) > ROTATION_EPS_DEG;
    }

    function groupCenterLocal(groupCell) {
        const g = groupCell && groupCell.getGeometry ? groupCell.getGeometry() : null;
        if (!g) return { x: 0, y: 0 };
        return { x: (Number(g.width) || 0) / 2, y: (Number(g.height) || 0) / 2 };
    }

    function rotatePointAround(point, center, angleDeg) {
        const a = toRad(angleDeg);
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        const dx = point.x - center.x;
        const dy = point.y - center.y;
        return {
            x: center.x + dx * cos - dy * sin,
            y: center.y + dx * sin + dy * cos
        };
    }

    function logicalSlotCenterLocal(r, c, spacingXpx, spacingYpx, bandPx) {
        return {
            x: GROUP_PADDING_PX + spacingXpx / 2 + c * spacingXpx,
            y: GROUP_PADDING_PX + (bandPx || GROUP_LABEL_BAND_PX) + spacingYpx / 2 + r * spacingYpx
        };
    }

    function isInterplantLayoutGroup(groupCell) {
        return getXmlAttr(groupCell, "companion_layout_interplant", "") === "1" || getXmlAttr(groupCell, "companion_layout_template", "") === "interplant";
    }

    function interplantSlotCenterLocal(groupCell, r, c, spacingXpx, spacingYpx, bandPx) {
        const center = logicalSlotCenterLocal(r, c, spacingXpx, spacingYpx, bandPx);
        if (!isInterplantLayoutGroup(groupCell)) return center;
        if ((r + c) % 2 !== 0) return center;
        const geo = groupCell && groupCell.getGeometry ? groupCell.getGeometry() : null;
        const maxX = Math.max(GROUP_PADDING_PX, Number(geo?.width || 0) - GROUP_PADDING_PX);
        const maxY = Math.max(GROUP_PADDING_PX + (bandPx || GROUP_LABEL_BAND_PX), Number(geo?.height || 0) - GROUP_PADDING_PX);
        return {
            x: Math.min(maxX, center.x + spacingXpx / 2),
            y: Math.min(maxY, center.y + spacingYpx / 2)
        };
    }

    function visualCenterFromLogicalCenter(groupCell, logicalCenter, rotationDeg) {
        return rotatePointAround(logicalCenter, groupCenterLocal(groupCell), rotationDeg);
    }

    function visualSlotCenterLocal(groupCell, r, c, spacingXpx, spacingYpx, bandPx) {
        const logical = interplantSlotCenterLocal(groupCell, r, c, spacingXpx, spacingYpx, bandPx);
        return visualCenterFromLogicalCenter(groupCell, logical, getTilerRotationDeg(groupCell));
    }

    function geometryFromVisualCenter(center, width, height) {
        return new mxGeometry(center.x - width / 2, center.y - height / 2, width, height);
    }

    function tileGeometryAtSlot(groupCell, r, c, spacingXpx, spacingYpx, iconDiamPx, bandPx) {
        const center = visualSlotCenterLocal(groupCell, r, c, spacingXpx, spacingYpx, bandPx);
        return geometryFromVisualCenter(center, iconDiamPx, iconDiamPx);
    }

    function childVisualCenterLocal(childCell, geometryOverride) {
        const g = geometryOverride || (childCell && childCell.getGeometry ? childCell.getGeometry() : null);
        if (!g) return null;
        return { x: Number(g.x) + Number(g.width) / 2, y: Number(g.y) + Number(g.height) / 2 };
    }

    function childCenterInUnrotatedGroupSpace(groupCell, childCell, rotationDeg, geometryOverride) {
        const center = childVisualCenterLocal(childCell, geometryOverride);
        if (!center) return null;
        const rot = rotationDeg != null ? Number(rotationDeg) : getTilerRotationDeg(groupCell);
        return rotatePointAround(center, groupCenterLocal(groupCell), -rot);
    }

    function childLogicalGeometryFromVisual(groupCell, childCell, rotationDeg, geometryOverride) {
        const g = geometryOverride || (childCell && childCell.getGeometry ? childCell.getGeometry() : null);
        const center = childCenterInUnrotatedGroupSpace(groupCell, childCell, rotationDeg, geometryOverride);
        if (!g || !center) return null;
        return { x: center.x - g.width / 2, y: center.y - g.height / 2, w: g.width, h: g.height };
    }

    function visualGeometryFromLogicalGeometry(groupCell, logicalGeo) {
        if (!logicalGeo) return null;
        const w = Number(logicalGeo.w);
        const h = Number(logicalGeo.h);
        const x = Number(logicalGeo.x);
        const y = Number(logicalGeo.y);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) return null;
        const logicalCenter = { x: x + w / 2, y: y + h / 2 };
        const visualCenter = visualCenterFromLogicalCenter(groupCell, logicalCenter, getTilerRotationDeg(groupCell));
        return geometryFromVisualCenter(visualCenter, w, h);
    }

    function rotationValueFromStyleString(styleText) {
        if (typeof styleText !== "string") return null;
        const parts = styleText.split(";");
        for (const part of parts) {
            const idx = part.indexOf("=");
            if (idx <= 0) continue;
            const key = part.slice(0, idx);
            if (key === mxConstants.STYLE_ROTATION || key === "rotation") return part.slice(idx + 1);
        }
        return null;
    }

    function rotationDegFromStyleString(styleText) {
        const raw = rotationValueFromStyleString(styleText);
        const n = Number(raw);
        return Number.isFinite(n) ? n : 0;
    }

    function rotationChangedFromStyleChange(change) {
        if (!change) return null;
        const cell = change.cell || null;
        if (!cell || !isTilerGroup(cell)) return null;
        const before = rotationDegFromStyleString(change.previous);
        const after = rotationDegFromStyleString(change.style);
        if (Math.abs(before - after) <= ROTATION_EPS_DEG) return null;
        return { cell, before, after };
    }

    function changeTypeName(change) {
        return change && change.constructor && change.constructor.name ? change.constructor.name : "";
    }

    function previousGeometryByCellIdFromChanges(changes) {
        const out = new Map();
        for (const change of (changes || [])) {
            if (changeTypeName(change) !== "mxGeometryChange") continue;
            const cell = change.cell;
            const prev = change.previous;
            if (!cell || !cell.id || !prev || !isPlantCircle(cell)) continue;
            out.set(cell.id, prev);
        }
        return out;
    }

    function snapshotHasTiles(snapObj) {
        return !!snapObj && Array.isArray(snapObj.tiles) && snapObj.tiles.length > 0;
    }

    function resolveLayoutSnapshot(graph, groupCell, opts = {}) {
        if (opts.layoutSnapshot) return opts.layoutSnapshot;
        if (opts.useLiveSnapshot !== false) {
            const liveSnap = captureLodLayoutSnapshot(graph, groupCell, { rotationDeg: opts.previousRotationDeg });
            if (snapshotHasTiles(liveSnap)) return liveSnap;
        }
        return readLodLayoutSnapshot(groupCell);
    }

    function collapseToSummary(graph, groupCell, abbr, spacingXpx, spacingYpx, opts = {}) {
        const model = graph.getModel();
        model.beginUpdate();
        try {
            // Snapshot layout BEFORE removing children so expand can restore it. 
            const snap = resolveLayoutSnapshot(graph, groupCell, opts);
            writeLodLayoutSnapshot(model, groupCell, snap);

            clearChildren(graph, groupCell); // wipe current children under group

            // DEBUG: assert empty before add
            const kids = graph.getChildVertices(groupCell) || [];
            log("[DBG] collapse pre-add, kids=", kids.length);

            const { rows, cols, count } = computeGridStatsXY(
                groupCell,
                spacingXpx,
                spacingYpx
            );
            const g = groupCell.getGeometry();
            const size = Math.max(
                LOD_SUMMARY_MIN_SIZE,
                Math.min(g.width, g.height) * 0.35
            );
            const summaryCenter = groupCenterLocal(groupCell);
            const xRel = summaryCenter.x - size / 2;
            const yRel = summaryCenter.y - size / 2;

            const geo = new mxGeometry(xRel, yRel, size, size);
            // In collapseToSummary summary style:
            const style = [
                "shape=ellipse",
                "aspect=fixed",
                "perimeter=ellipsePerimeter",
                "strokeColor=#374151",
                "strokeWidth=1",
                "fillColor=#e5e7eb",
                "fontSize=12",
                "align=center",
                "verticalAlign=middle",
                "html=1",
                "resizable=0",
                "movable=0",
                "rotation=0",
                "editable=0",
            ].join(";");


            const disabledSet = readDisabledSet(groupCell);
            applyCounts(model, groupCell, count, disabledSet);
            const actual = getNumberAttr(groupCell, ATTR_PLANT_COUNT_ACT, count);
            const y = updateGroupYield(model, groupCell, { abbr, countOverride: actual });

            // Pull unit and potential targets from attrs
            const unit = groupCell.getAttribute('yield_unit') || YIELD_UNIT;

            // Build label parts: "FullName × count [· target ...] [· current ...]"
            const parts = [];
            parts.push(`× ${actual}`);


            if (SHOW_YIELD_IN_SUMMARY) {
                parts.push(`Expected yield ${formatYield(y.expectedYield, y.unit)}`);
            }

            const label = parts.join('<br/>');

            const summary = new mxCell(label, geo, style);
            summary.setVertex(true);
            summary.setConnectable(false);

            // Tag and ID
            const val = mxUtils.createXmlDocument().createElement("Summary");
            val.setAttribute("lod_summary", "1");
            val.setAttribute("label", label);
            summary.setValue(val);

            graph.addCell(summary, groupCell);
            setCollapsedFlag(model, groupCell, true);

            log(
                "[DBG] collapse post-add, kids=",
                (graph.getChildVertices(groupCell) || []).length
            );
        } finally {
            model.endUpdate();
        }
    }

    // ---------------- LOD layout snapshot ----------------
    const ATTR_LOD_LAYOUT_SNAPSHOT = "lod_layout_snapshot_v1";
    const ATTR_LOD_LAYOUT_SNAPSHOT_AT = "lod_layout_snapshot_at";

    function nowIso() {
        try { return new Date().toISOString(); } catch (_) { return ""; }
    }

    // Capture ONLY the tiles that need preserving (dirty or non-auto) keyed by r,c. 
    function captureLodLayoutSnapshot(graph, groupCell, opts = {}) {
        if (!groupCell || !isTilerGroup(groupCell)) return null;

        const kids = graph.getChildVertices(groupCell) || [];
        const tiles = [];
        const rotationDeg = opts.rotationDeg != null ? Number(opts.rotationDeg) : getTilerRotationDeg(groupCell);
        const geometryByCellId = opts.geometryByCellId || null;
        for (const k of kids) {
            if (!isPlantCircle(k)) continue;
            if (!hasTileRC(k)) continue;

            const auto = String(k.getAttribute("auto") || "0");
            const dirty = String(k.getAttribute("dirty") || "0");

            // Preserve only tiles whose geometry you care about keeping. 
            // - dirty==1: user moved/modified
            // - auto!=1: user-made/manual
            if (!(dirty === "1" || auto !== "1")) continue;

            const r = Number(k.getAttribute("tile_r"));
            const c = Number(k.getAttribute("tile_c"));
            if (!Number.isFinite(r) || !Number.isFinite(c)) continue;

            const overrideGeo = geometryByCellId && k.id ? geometryByCellId.get(k.id) : null;
            const logicalGeo = childLogicalGeometryFromVisual(groupCell, k, rotationDeg, overrideGeo);
            if (!logicalGeo) continue;

            tiles.push({
                r, c,
                x: logicalGeo.x, y: logicalGeo.y, w: logicalGeo.w, h: logicalGeo.h,
                auto, dirty,
                abbr: String(k.getAttribute("abbr") || ""), // optional
                label: String(k.getAttribute("label") || ""), // optional
            });
        }

        // Keep it compact and versioned. 
        return {
            v: 1,
            tiles
        };
    }

    function writeLodLayoutSnapshot(model, groupCell, snapObj) {
        if (!model || !groupCell) return;
        const json = snapObj ? JSON.stringify(snapObj) : "";
        setCellAttrsNoTxn(model, groupCell, {
            [ATTR_LOD_LAYOUT_SNAPSHOT]: json,
            [ATTR_LOD_LAYOUT_SNAPSHOT_AT]: snapObj ? nowIso() : ""
        });
    }

    function readLodLayoutSnapshot(groupCell) {
        const raw = getXmlAttr(groupCell, ATTR_LOD_LAYOUT_SNAPSHOT, "");
        if (!raw) return null;
        const obj = safeJsonParse(raw, null);
        if (!obj || obj.v !== 1 || !Array.isArray(obj.tiles)) return null;
        return obj;
    }

    // Map snapshot tiles by "r,c" for fast lookup. 
    function snapshotTileMap(snapObj) {
        const map = new Map();
        if (!snapObj || !Array.isArray(snapObj.tiles)) return map;
        for (const t of snapObj.tiles) {
            if (!t) continue;
            const r = Number(t.r), c = Number(t.c);
            if (!Number.isFinite(r) || !Number.isFinite(c)) continue;
            map.set(`${r},${c}`, t);
        }
        return map;
    }

    function shiftLayoutSnapshotByDeltaY(snapObj, deltaY) {
        if (!snapshotHasTiles(snapObj) || !Number.isFinite(Number(deltaY)) || !deltaY) return;
        for (const tile of snapObj.tiles) {
            const y = Number(tile.y);
            if (Number.isFinite(y)) tile.y = y + deltaY;
        }
    }


    function shouldExpandLOD(graph, groupCell, spacingXpx, spacingYpx) {
        const { count } = computeGridStatsXY(groupCell, spacingXpx, spacingYpx);
        return count <= LOD_TILE_THRESHOLD;
    }

    function expandTiles(graph, groupCell, abbr, spacingXpx, spacingYpx, iconDiamPx, opts = {}) {

        const { bandPx } = groupLabelMetrics(groupCell);
        const fontPx = tileFontPx(iconDiamPx);
        const snapObj = resolveLayoutSnapshot(graph, groupCell, opts);
        const snapMap = snapshotTileMap(snapObj);

        const model = graph.getModel();
        model.beginUpdate();
        try {
            clearChildren(graph, groupCell);

            const { rows, cols, count } = computeGridStatsXY(groupCell, spacingXpx, spacingYpx);

            pruneDisabledToGrid(model, groupCell, rows, cols);
            const disabledSet2 = readDisabledSet(groupCell);
            const { actual } = applyCounts(model, groupCell, count, disabledSet2);
            updateGroupYield(model, groupCell, { abbr, countOverride: actual });

            if (count > MAX_TILES) {
                collapseToSummary(graph, groupCell, abbr, spacingXpx, spacingYpx, { layoutSnapshot: snapObj, useLiveSnapshot: false });
                return;
            }

            const cells = [];
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    if (disabledSet2.has(`${r},${c}`)) continue;

                    const snap = snapMap.get(`${r},${c}`);
                    let geo;
                    let autoAttr = "1";
                    let dirtyAttr = "0";

                    if (snap) {
                        // Use saved geometry, but normalize size to current iconDiam for coherence. 
                        const sx = Number(snap.x), sy = Number(snap.y);
                        const okXY = Number.isFinite(sx) && Number.isFinite(sy);

                        const w = iconDiamPx;
                        const h = iconDiamPx;

                        if (okXY) {
                            geo = visualGeometryFromLogicalGeometry(groupCell, { x: sx, y: sy, w, h });
                            autoAttr = String(snap.auto || "0");
                            dirtyAttr = String(snap.dirty || "1");
                        }
                    }

                    // Default grid placement for non-snap tiles 
                    if (!geo) {
                        geo = tileGeometryAtSlot(groupCell, r, c, spacingXpx, spacingYpx, iconDiamPx, bandPx);
                    }

                    const vVal = createXmlValue("PlantTile", {
                        plant_tiler: "1",
                        auto: autoAttr,
                        abbr: abbr,
                        label: abbr,
                        tile_r: String(r),
                        tile_c: String(c),
                        dirty: dirtyAttr,
                    });

                    const v = new mxCell(vVal, geo, plantCircleStyle(fontPx || tileFontPx(iconDiamPx)));
                    v.setVertex(true);
                    v.setConnectable(false);
                    cells.push(v);
                }
            }

            if (cells.length) graph.addCells(cells, groupCell);
            setCollapsedFlag(model, groupCell, false);

            log(
                "[DBG] expand post-add, kids=",
                (graph.getChildVertices(groupCell) || []).length,
                "rendered=",
                cells.length,
                "of",
                getNumberAttr(groupCell, ATTR_PLANT_COUNT_ACT, count)
            );
        } finally {
            model.endUpdate();
        }

        graph.refresh(groupCell);
    }

    function geometryNearlyEqual(a, b) {
        if (!a || !b) return false;
        return Math.abs((Number(a.x) || 0) - (Number(b.x) || 0)) < 0.001 &&
            Math.abs((Number(a.y) || 0) - (Number(b.y) || 0)) < 0.001 &&
            Math.abs((Number(a.width) || 0) - (Number(b.width) || 0)) < 0.001 &&
            Math.abs((Number(a.height) || 0) - (Number(b.height) || 0)) < 0.001;
    }

    function setGeometryIfChanged(model, cell, nextGeo) {
        const cur = cell && cell.getGeometry ? cell.getGeometry() : null;
        if (!cur || !nextGeo || geometryNearlyEqual(cur, nextGeo)) return false;
        model.setGeometry(cell, nextGeo);
        return true;
    }

    function setStyleIfChanged(model, cell, nextStyle) {
        if (getStyleSafe(cell) === nextStyle) return false;
        model.setStyle(cell, nextStyle);
        return true;
    }

    function setTileAttrsIfChanged(model, cell, attrs) {
        for (const [key, value] of Object.entries(attrs || {})) {
            if (String(cell.getAttribute(key) || "") !== String(value)) {
                setCellAttrsNoTxn(model, cell, attrs);
                return true;
            }
        }
        return false;
    }

    function syncAutoTileGeometriesInPlace(graph, groupCell, abbr, spacingXpx, spacingYpx, iconDiamPx, opts = {}) {
        if (!groupCell || !isTilerGroup(groupCell) || isCollapsedLOD(groupCell)) return { changed: false, fallback: true, reason: "not-expanded" };

        const model = graph.getModel();
        const { bandPx } = groupLabelMetrics(groupCell);
        const fontPx = tileFontPx(iconDiamPx);
        const nextStyle = plantCircleStyle(fontPx || tileFontPx(iconDiamPx));
        const { rows, cols, count } = computeGridStatsXY(groupCell, spacingXpx, spacingYpx);
        if (count > MAX_TILES) return { changed: false, fallback: true, reason: "max-tiles" };

        const kids = graph.getChildVertices(groupCell) || [];
        const slotMap = new Map();
        const occupiedDisabledAutoTiles = [];
        const disabledSet = readDisabledSet(groupCell);
        const snapObj = resolveLayoutSnapshot(graph, groupCell, opts);
        const snapMap = snapshotTileMap(snapObj);

        for (const k of kids) {
            if (k && k.getAttribute && k.getAttribute("lod_summary") === "1") return { changed: false, fallback: true, reason: "summary-child" };
            if (!isPlantCircle(k)) continue;
            if (!hasTileRC(k)) return { changed: false, fallback: true, reason: "missing-slot" };

            const r = Number(k.getAttribute("tile_r"));
            const c = Number(k.getAttribute("tile_c"));
            if (!Number.isFinite(r) || !Number.isFinite(c) || r < 0 || c < 0) return { changed: false, fallback: true, reason: "bad-slot" };

            const key = `${r},${c}`;
            if (slotMap.has(key)) return { changed: false, fallback: true, reason: "duplicate-slot" };
            slotMap.set(key, k);

            if (disabledSet.has(key)) {
                if (isAutoTile(k) && !isDirty(k)) occupiedDisabledAutoTiles.push(k);
                else return { changed: false, fallback: true, reason: "manual-disabled-slot" };
            }

            if (!(isAutoTile(k) && !isDirty(k)) && !snapMap.has(key)) {
                return { changed: false, fallback: true, reason: "manual-without-snapshot" };
            }
            if (!(isAutoTile(k) && !isDirty(k))) {
                const snap = snapMap.get(key);
                if (!Number.isFinite(Number(snap.x)) || !Number.isFinite(Number(snap.y))) {
                    return { changed: false, fallback: true, reason: "bad-snapshot" };
                }
            }
        }

        let changed = false;
        const toRemove = occupiedDisabledAutoTiles.slice();
        const ownsUpdate = !opts.inTransaction;
        if (ownsUpdate) model.beginUpdate();
        try {
            pruneDisabledToGrid(model, groupCell, rows, cols);
            const disabledSet2 = readDisabledSet(groupCell);
            const { actual } = applyCounts(model, groupCell, count, disabledSet2);
            updateGroupYield(model, groupCell, { abbr, countOverride: actual });

            for (const [key, tile] of slotMap.entries()) {
                const parts = key.split(",");
                const r = Number(parts[0]);
                const c = Number(parts[1]);
                if (r >= rows || c >= cols || disabledSet2.has(key)) {
                    if (isAutoTile(tile) && !isDirty(tile)) toRemove.push(tile);
                    else if (isChildOutOfGroupBounds(groupCell, tile)) toRemove.push(tile);
                    continue;
                }

                const snap = snapMap.get(key);
                let geo = null;
                let autoAttr = "1";
                let dirtyAttr = "0";

                if (snap && !(isAutoTile(tile) && !isDirty(tile))) {
                    const sx = Number(snap.x);
                    const sy = Number(snap.y);
                    geo = visualGeometryFromLogicalGeometry(groupCell, { x: sx, y: sy, w: iconDiamPx, h: iconDiamPx });
                    autoAttr = String(snap.auto || "0");
                    dirtyAttr = String(snap.dirty || "1");
                } else {
                    geo = tileGeometryAtSlot(groupCell, r, c, spacingXpx, spacingYpx, iconDiamPx, bandPx);
                }

                changed = setGeometryIfChanged(model, tile, geo) || changed;
                changed = setStyleIfChanged(model, tile, nextStyle) || changed;
                changed = setTileAttrsIfChanged(model, tile, {
                    plant_tiler: "1",
                    auto: autoAttr,
                    abbr: abbr,
                    label: abbr,
                    tile_r: String(r),
                    tile_c: String(c),
                    dirty: dirtyAttr
                }) || changed;
            }

            if (toRemove.length) {
                graph.removeCells(Array.from(new Set(toRemove)));
                changed = true;
            }

            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    const key = `${r},${c}`;
                    if (disabledSet2.has(key) || slotMap.has(key)) continue;
                    const v = addTileAtSlot(graph, groupCell, abbr, r, c, spacingXpx, spacingYpx, iconDiamPx, disabledSet2, bandPx, fontPx);
                    if (v) changed = true;
                }
            }

            setCollapsedFlag(model, groupCell, false);
        } finally {
            if (ownsUpdate) model.endUpdate();
        }

        return { changed, fallback: false };
    }


    // -------------------- Palette (XML value) --------------------
    function createXmlValue(tag, attrs) {
        const doc = mxUtils.createXmlDocument();
        const node = doc.createElement(tag);
        Object.keys(attrs || {}).forEach((k) =>
            node.setAttribute(k, String(attrs[k]))
        );
        return node;
    }

    // ---------- helpers --------------------------
    function getXmlAttr(cell, name, def = "") {
        return cell && cell.getAttribute ? cell.getAttribute(name) || def : def;
    }

    function ensureXmlValue(cell) {
        // Return an XML Element for cell.value, creating one if needed                          
        const current = cell && cell.value;
        if (current && current.nodeType === 1) return current;
        // Create a <Module> node and carry over the visible label                               
        const doc = mxUtils.createXmlDocument();
        const node = doc.createElement('Module');
        const label = (typeof current === 'string' && current) ? current :
            (typeof graph.convertValueToString === 'function'
                ? graph.convertValueToString(cell)
                : '');
        if (label) node.setAttribute('label', label);
        return node;
    }

    // -------------------- Utils & Styles --------------------

    function setCellAttrsNoTxn(model, cell, attrs) {
        const base = ensureXmlValue(cell);
        const clone = base.cloneNode(true);
        for (const [k, v] of Object.entries(attrs || {})) {
            if (v === null || v === undefined || v === "") clone.removeAttribute(k);
            else clone.setAttribute(k, String(v));
        }
        model.setValue(cell, clone);
    }

    function cloneXmlValueWithAttrs(cell, attrs) {
        const base = ensureXmlValue(cell);
        const clone = base.cloneNode(true);
        for (const [k, v] of Object.entries(attrs || {})) {
            if (v === null || v === undefined || v === "") clone.removeAttribute(k);
            else clone.setAttribute(k, String(v));
        }
        return clone;
    }

    function finiteNumberOrNull(value) {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }

    function cToDisplayTemp(c, units) {
        const n = finiteNumberOrNull(c);
        if (n == null) return "";
        return units === "imperial" ? String(Math.round((n * 9 / 5 + 32) * 10) / 10) : String(Math.round(n * 10) / 10);
    }

    function displayTempToC(value, units) {
        const n = finiteNumberOrNull(value);
        if (n == null) return null;
        return units === "imperial" ? (n - 32) * 5 / 9 : n;
    }

    function formatDbNumber(value) {
        const n = finiteNumberOrNull(value);
        return n == null ? null : String(Math.round(n * 1000) / 1000);
    }

    function mmDdToDoyNoLeap(value) {
        const match = /^(\d{1,2})-(\d{1,2})$/.exec(String(value || "").trim());
        if (!match) return null;
        const month = Number(match[1]);
        const day = Number(match[2]);
        const monthDays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        if (month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]) return null;
        return monthDays.slice(0, month - 1).reduce((sum, item) => sum + item, 0) + day;
    }

    function doyToMmDdNoLeap(value) {
        let doy = Number(value);
        if (!Number.isInteger(doy) || doy < 1 || doy > 365) return "";
        const monthDays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        let month = 1;
        while (doy > monthDays[month - 1]) { doy -= monthDays[month - 1]; month += 1; }
        return `${String(month).padStart(2, "0")}-${String(doy).padStart(2, "0")}`;
    }

    function setTooltip(el, text) {
        if (!el) return;
        el.title = String(text || "");
        if (el.tagName === "BUTTON") el.setAttribute("aria-label", String(text || el.textContent || ""));
    }

    function refreshDiagramCityNameById(model, root, city) {
        if (!model || !root || !city || city.city_id == null) return;
        const cityId = String(city.city_id);
        const nextName = String(city.city_name || "");
        function visit(cell) {
            if (!cell) return;
            if (String(cell.getAttribute?.("city_id") || "") === cityId) setCellAttrsNoTxn(model, cell, { city_name: nextName });
            const count = typeof model.getChildCount === "function" ? model.getChildCount(cell) : 0;
            for (let i = 0; i < count; i += 1) visit(model.getChildAt(cell, i));
        }
        visit(root);
    }

    // Default bed dimensions are stored in centimeters; dialog units are display-only.
    function positiveFiniteNumber(value) {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? n : null;
    }

    function formatBedCmAttr(cm) {
        return String(Math.round((Number(cm) || 0) * 1000) / 1000);
    }

    function formatBedDisplayValue(value) {
        const rounded = Math.round((Number(value) || 0) * 1000) / 1000;
        return String(rounded);
    }

    function defaultBedDimensionsCmForUnits(units) {
        if (units === "metric") return { widthCm: DEFAULT_METRIC_BED_WIDTH_CM, lengthCm: DEFAULT_METRIC_BED_LENGTH_CM };
        if (units === "imperial") return { widthCm: DEFAULT_IMPERIAL_BED_WIDTH_CM, lengthCm: DEFAULT_IMPERIAL_BED_LENGTH_CM };
        return null;
    }

    function getSavedDefaultBedDimensionsCm(moduleCell) {
        const widthCm = positiveFiniteNumber(getXmlAttr(moduleCell, DEFAULT_BED_WIDTH_CM_ATTR, ""));
        const lengthCm = positiveFiniteNumber(getXmlAttr(moduleCell, DEFAULT_BED_LENGTH_CM_ATTR, ""));
        return widthCm && lengthCm ? { widthCm, lengthCm } : null;
    }

    function getDefaultBedDimensionsCm(moduleCell) {
        const saved = getSavedDefaultBedDimensionsCm(moduleCell);
        if (saved) return saved;
        return defaultBedDimensionsCmForUnits(getXmlAttr(moduleCell, "unit_system", ""));
    }

    function bedDisplayUnitLabel(units) {
        return units === "imperial" ? "ft" : "m";
    }

    function bedDimensionCmToDisplay(cm, units) {
        return units === "imperial" ? cm / CM_PER_FOOT : cm / CM_PER_METER;
    }

    function bedDimensionDisplayToCm(value, units) {
        const n = positiveFiniteNumber(value);
        if (!n) return null;
        return units === "imperial" ? n * CM_PER_FOOT : n * CM_PER_METER;
    }


    function hasGardenSettingsSet(moduleCell) {
        if (!(moduleCell && moduleCell.getAttribute)) return false;
        const city = String(moduleCell.getAttribute("city_id") || moduleCell.getAttribute("city_name") || "").trim();
        const units = String(moduleCell.getAttribute("unit_system") || "").trim();
        return !!(city && units && getSavedDefaultBedDimensionsCm(moduleCell));
    }

    function getModuleMarginFromStyle(moduleCell, defaultPx = 100) {
        const fallback = Number.isInteger(defaultPx) && defaultPx >= 0 ? defaultPx : 100;
        const match = getStyleSafe(moduleCell).match(/(?:^|;)module_margin=(\d+)(?=;|$)/);
        return match ? parseInt(match[1], 10) : fallback;
    }

    function getGardenModuleMargin(moduleCell) {
        const modulesApi = graph.__trellisModules;
        if (modulesApi && typeof modulesApi.getModuleMargin === "function") return modulesApi.getModuleMargin(moduleCell, 100);
        return getModuleMarginFromStyle(moduleCell, 100);
    }

    function readModuleMarginInput(inputEl) {
        const raw = String(inputEl && inputEl.value || "").trim();
        if (!/^\d+$/.test(raw)) return null;
        const n = Number(raw);
        return Number.isSafeInteger(n) && n >= 0 ? n : null;
    }

    function setGardenModuleMargin(moduleCell, marginPx) {
        const modulesApi = graph.__trellisModules;
        if (modulesApi && typeof modulesApi.setModuleMargin === "function") {
            modulesApi.setModuleMargin(moduleCell, marginPx);
            return;
        }
        const graphModel = graph.getModel && graph.getModel();
        if (graphModel && graphModel.setStyle) graphModel.setStyle(moduleCell, upsertStyleKV(getStyleSafe(moduleCell), "module_margin", String(marginPx)));
        if (graph.fireEvent && typeof mxEventObject === "function") {
            graph.fireEvent(new mxEventObject("usl:requestApplyModuleMargins", "cell", moduleCell));
        } else if (graph.refresh) {
            graph.refresh(moduleCell);
        }
    }

    async function saveCityRecord(row, existingCityId = null) {
        await ensureCityGeographySchema();
        const cityId = Number(row.city_id);
        const cityName = String(row.city_name || "").trim();
        const countryName = normalizeCityGeoText(row.country_name);
        const regionName = normalizeCityGeoText(row.region_name);
        if (!Number.isInteger(cityId) || cityId <= 0) throw new Error("City ID is required and must be a positive integer.");
        if (!cityName) throw new Error("City name is required.");
        if (!countryName) throw new Error("Country is required.");
        if (!regionName) throw new Error("Region/state is required. Use Unspecified when no region applies.");
        if (await cityIdentityExists(row, existingCityId == null ? null : cityId)) throw new Error("A city with that city/country/region already exists.");
        const lat = finiteNumberOrNull(row.latitude);
        const lon = finiteNumberOrNull(row.longitude);
        if (lat == null || lat < -66.5 || lat > 66.5) throw new Error("Latitude is required and must be between -66.5 and 66.5.");
        if (lon == null || lon < -180 || lon > 180) throw new Error("Longitude is required and must be between -180 and 180.");
        if (!String(row.timezone || "").trim()) throw new Error("Timezone is required.");
        if (!Number.isInteger(Number(row.last_spring_frost_p50_doy))) throw new Error("Spring p50 frost date is required.");
        if (!Number.isInteger(Number(row.first_fall_frost_p50_doy))) throw new Error("Fall p50 frost date is required.");
        for (let m = 1; m <= 12; m += 1) {
            if (finiteNumberOrNull(row[`avg_monthly_low_c${m}`]) == null || finiteNumberOrNull(row[`avg_monthly_high_c${m}`]) == null) {
                throw new Error("All monthly low/high normals are required.");
            }
        }
        const columns = [
            "city_id", "city_name", "country_name", "country_code", "region_name", "region_code", "latitude", "longitude", "timezone", "gdd_annual", "gdd_base_c",
            "last_spring_frost_doy", "last_spring_frost_p90_doy", "last_spring_frost_p50_doy", "last_spring_frost_p10_doy",
            "first_fall_frost_doy", "first_fall_frost_p90_doy", "first_fall_frost_p50_doy", "first_fall_frost_p10_doy"
        ];
        for (let m = 1; m <= 12; m += 1) columns.push(`avg_monthly_low_c${m}`, `avg_monthly_high_c${m}`);
        const values = columns.map(col => row[col] == null || row[col] === "" ? null : row[col]);
        const exists = await loadCityById(cityId);
        if (exists && existingCityId == null) throw new Error("A city with that ID already exists.");
        if (exists) {
            const assignments = columns.filter(col => col !== "city_id").map(col => `${col} = ?`).join(", ");
            const updateValues = columns.filter(col => col !== "city_id").map(col => row[col] == null || row[col] === "" ? null : row[col]);
            await execAll(`UPDATE Cities SET ${assignments} WHERE city_id = ?;`, updateValues.concat(cityId));
        } else {
            await execAll(`INSERT INTO Cities (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")});`, values);
        }
        return await loadCityById(cityId);
    }

    async function showCityManagerDialog(ui, graph, selectedCityId, units, onSaved) {
        const model = graph.getModel();
        let cities = await loadCities();
        let current = cities.find(city => String(city.city_id) === String(selectedCityId)) || cities[0] || null;
        let editingExistingId = current ? Number(current.city_id) : null;
        const displayUnits = units === "imperial" ? "imperial" : "metric";
        const tempUnit = displayUnits === "imperial" ? "F" : "C";

        const div = document.createElement("div");
        div.style.padding = "10px";
        div.style.width = "760px";
        div.style.maxHeight = "680px";
        div.style.overflow = "auto";

        const title = document.createElement("div");
        title.textContent = "City Manager";
        title.style.fontWeight = "600";
        title.style.marginBottom = "8px";
        div.appendChild(title);

        const err = document.createElement("div");
        err.style.color = "#b91c1c";
        err.style.fontSize = "12px";
        err.style.marginBottom = "8px";
        err.style.display = "none";
        div.appendChild(err);

        function showError(message) { err.textContent = message; err.style.display = "block"; }
        function clearError() { err.textContent = ""; err.style.display = "none"; }
        function input(type = "text", width = "100%") {
            const el = document.createElement("input");
            el.type = type;
            el.style.width = width;
            el.style.padding = "5px";
            return el;
        }
        function field(label, el, tooltip) {
            const wrap = document.createElement("div");
            wrap.style.display = "flex";
            wrap.style.alignItems = "center";
            wrap.style.gap = "8px";
            wrap.style.margin = "6px 0";
            const lab = document.createElement("label");
            lab.textContent = label;
            lab.style.minWidth = "150px";
            setTooltip(lab, tooltip);
            setTooltip(el, tooltip);
            wrap.appendChild(lab);
            wrap.appendChild(el);
            div.appendChild(wrap);
            return el;
        }

        const pickerRow = document.createElement("div");
        pickerRow.style.display = "flex";
        pickerRow.style.gap = "8px";
        pickerRow.style.alignItems = "center";
        pickerRow.style.marginBottom = "8px";
        const cityPicker = document.createElement("select");
        cityPicker.style.flex = "1";
        cityPicker.style.padding = "6px";
        const newBtn = tilerButton("New City", () => {
            const maxId = cities.reduce((max, city) => Math.max(max, Number(city.city_id) || 0), 0);
            editingExistingId = null;
            fillForm({ city_id: maxId + 1, city_name: "", country_name: "", region_name: "Unspecified", timezone: "America/Los_Angeles" }, false);
        }, "add");
        setTooltip(newBtn, "Create a scheduler-ready city record with required climate fields.");
        pickerRow.appendChild(cityPicker);
        pickerRow.appendChild(newBtn);
        div.appendChild(pickerRow);

        const idInput = field("City ID:", input("number"), "Stable city_id used by diagrams; it cannot be changed for existing cities.");
        const nameInput = field("City name:", input("text"), "Required city-only display name, for example Vancouver.");
        const countryNameInput = field("Country:", input("text"), "Required country name, for example Canada.");
        const countryCodeInput = field("Country code:", input("text"), "Optional ISO-style country code, for example CA.");
        const regionNameInput = field("Region/state:", input("text"), "Required state, province, or region name. Use Unspecified when no region applies.");
        const regionCodeInput = field("Region code:", input("text"), "Optional compact state/province code, for example BC.");
        const latInput = field("Latitude:", input("number"), "Required decimal degrees, -66.5 to 66.5, used for photoperiod checks.");
        const lonInput = field("Longitude:", input("number"), "Required decimal degrees, -180 to 180.");
        const tzInput = field("Timezone:", input("text"), "Required IANA timezone, for example America/Los_Angeles.");
        const gddAnnualInput = field("Annual GDD:", input("number"), "Optional annual growing-degree-days calibration target.");
        const gddBaseInput = field("GDD base C:", input("number"), "Optional Celsius base temperature for city annual GDD calibration.");
        const springP90Input = field("Spring frost p90:", input("text"), "Optional MM-DD last spring frost risk date; Feb 29 is not valid.");
        const springP50Input = field("Spring frost p50:", input("text"), "Required MM-DD last spring frost date; Feb 29 is not valid.");
        const springP10Input = field("Spring frost p10:", input("text"), "Optional MM-DD last spring frost risk date; Feb 29 is not valid.");
        const fallP90Input = field("Fall frost p90:", input("text"), "Optional MM-DD first fall frost risk date; Feb 29 is not valid.");
        const fallP50Input = field("Fall frost p50:", input("text"), "Required MM-DD first fall frost date; Feb 29 is not valid.");
        const fallP10Input = field("Fall frost p10:", input("text"), "Optional MM-DD first fall frost risk date; Feb 29 is not valid.");

        const monthTitle = document.createElement("div");
        monthTitle.textContent = `Monthly normals (${tempUnit})`;
        monthTitle.style.fontWeight = "600";
        monthTitle.style.margin = "12px 0 6px";
        div.appendChild(monthTitle);
        const monthGrid = document.createElement("div");
        monthGrid.style.display = "grid";
        monthGrid.style.gridTemplateColumns = "70px 1fr 1fr";
        monthGrid.style.gap = "4px 8px";
        div.appendChild(monthGrid);
        ["Month", "Low", "High"].forEach(text => {
            const cell = document.createElement("div");
            cell.textContent = text;
            cell.style.fontWeight = "600";
            monthGrid.appendChild(cell);
        });
        const monthInputs = [];
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        monthNames.forEach((name, index) => {
            const low = input("number");
            const high = input("number");
            low.step = high.step = "0.1";
            setTooltip(low, `Required average monthly low for ${name}, shown in ${tempUnit}.`);
            setTooltip(high, `Required average monthly high for ${name}, shown in ${tempUnit}.`);
            const lab = document.createElement("div");
            lab.textContent = name;
            monthGrid.appendChild(lab);
            monthGrid.appendChild(low);
            monthGrid.appendChild(high);
            monthInputs[index + 1] = { low, high };
        });

        function refreshPicker(selectedId) {
            while (cityPicker.firstChild) cityPicker.removeChild(cityPicker.firstChild);
            sortedCities(cities).forEach(city => {
                const opt = document.createElement("option");
                opt.value = String(city.city_id);
                opt.textContent = `${fullCityLabel(city)} (#${city.city_id})`;
                cityPicker.appendChild(opt);
            });
            if (selectedId != null) cityPicker.value = String(selectedId);
        }

        function fillForm(city, existing) {
            current = city || {};
            editingExistingId = existing ? Number(city.city_id) : null;
            idInput.value = current.city_id || "";
            idInput.disabled = !!existing;
            nameInput.value = current.city_name || "";
            countryNameInput.value = current.country_name || "";
            countryCodeInput.value = current.country_code || "";
            regionNameInput.value = current.region_name || "";
            regionCodeInput.value = current.region_code || "";
            latInput.value = current.latitude ?? "";
            lonInput.value = current.longitude ?? "";
            tzInput.value = current.timezone || "";
            gddAnnualInput.value = current.gdd_annual ?? "";
            gddBaseInput.value = current.gdd_base_c ?? "";
            springP90Input.value = doyToMmDdNoLeap(current.last_spring_frost_p90_doy);
            springP50Input.value = doyToMmDdNoLeap(current.last_spring_frost_p50_doy || current.last_spring_frost_doy);
            springP10Input.value = doyToMmDdNoLeap(current.last_spring_frost_p10_doy);
            fallP90Input.value = doyToMmDdNoLeap(current.first_fall_frost_p90_doy);
            fallP50Input.value = doyToMmDdNoLeap(current.first_fall_frost_p50_doy || current.first_fall_frost_doy);
            fallP10Input.value = doyToMmDdNoLeap(current.first_fall_frost_p10_doy);
            for (let m = 1; m <= 12; m += 1) {
                monthInputs[m].low.value = cToDisplayTemp(current[`avg_monthly_low_c${m}`], displayUnits);
                monthInputs[m].high.value = cToDisplayTemp(current[`avg_monthly_high_c${m}`], displayUnits);
            }
        }

        cityPicker.addEventListener("change", () => {
            const next = cities.find(city => String(city.city_id) === String(cityPicker.value));
            fillForm(next, true);
        });

        function readDate(inputEl, required, label) {
            const raw = String(inputEl.value || "").trim();
            if (!raw && !required) return null;
            const doy = mmDdToDoyNoLeap(raw);
            if (!doy) throw new Error(`${label} must be an MM-DD date in a non-leap year.`);
            return doy;
        }

        function readForm() {
            const row = {
                city_id: Number(idInput.value),
                city_name: String(nameInput.value || "").trim(),
                country_name: String(countryNameInput.value || "").trim(),
                country_code: String(countryCodeInput.value || "").trim(),
                region_name: String(regionNameInput.value || "").trim(),
                region_code: String(regionCodeInput.value || "").trim(),
                latitude: finiteNumberOrNull(latInput.value),
                longitude: finiteNumberOrNull(lonInput.value),
                timezone: String(tzInput.value || "").trim(),
                gdd_annual: finiteNumberOrNull(gddAnnualInput.value),
                gdd_base_c: finiteNumberOrNull(gddBaseInput.value),
                last_spring_frost_p90_doy: readDate(springP90Input, false, "Spring frost p90"),
                last_spring_frost_p50_doy: readDate(springP50Input, true, "Spring frost p50"),
                last_spring_frost_p10_doy: readDate(springP10Input, false, "Spring frost p10"),
                first_fall_frost_p90_doy: readDate(fallP90Input, false, "Fall frost p90"),
                first_fall_frost_p50_doy: readDate(fallP50Input, true, "Fall frost p50"),
                first_fall_frost_p10_doy: readDate(fallP10Input, false, "Fall frost p10")
            };
            row.last_spring_frost_doy = row.last_spring_frost_p50_doy;
            row.first_fall_frost_doy = row.first_fall_frost_p50_doy;
            for (let m = 1; m <= 12; m += 1) {
                row[`avg_monthly_low_c${m}`] = formatDbNumber(displayTempToC(monthInputs[m].low.value, displayUnits));
                row[`avg_monthly_high_c${m}`] = formatDbNumber(displayTempToC(monthInputs[m].high.value, displayUnits));
            }
            return row;
        }

        const btnRow = document.createElement("div");
        btnRow.style.display = "flex";
        btnRow.style.justifyContent = "flex-end";
        btnRow.style.gap = "8px";
        btnRow.style.marginTop = "12px";
        const closeBtn = tilerButton("Close", () => ui.hideDialog(), "close"); // CHANGE
        const saveBtn = tilerButton("Save City", async () => {
            clearError();
            try {
                const saved = await saveCityRecord(readForm(), editingExistingId);
                cities = await loadCities();
                refreshPicker(saved.city_id);
                fillForm(saved, true);
                model.beginUpdate();
                try { refreshDiagramCityNameById(model, model.getRoot(), saved); } finally { model.endUpdate(); }
                if (typeof onSaved === "function") onSaved(saved);
            } catch (e) {
                showError(e && e.message ? e.message : String(e));
            }
        }, "add");
        setTooltip(saveBtn, "Save the city climate record to the Trellis database.");
        btnRow.appendChild(closeBtn);
        btnRow.appendChild(saveBtn);
        div.appendChild(btnRow);

        refreshPicker(current?.city_id);
        fillForm(current || { city_id: 1, timezone: "America/Los_Angeles" }, !!current);
        ui.showDialog(div, 800, 720, true, true);
        elevateTrellisDialog();
    }


    // garden settings dialog (city + units + default bed dimensions)
    async function showGardenSettingsDialog(ui, graph, moduleCell, onClose) {
        const model = graph.getModel();
        const curGardenName = String(getXmlAttr(moduleCell, "garden_name", "") || getXmlAttr(moduleCell, "label", "") || "Garden").trim() || "Garden";
        const curCityId = getXmlAttr(moduleCell, "city_id", "");
        const curCity = getXmlAttr(moduleCell, "city_name", "");
        const curUnits = getXmlAttr(moduleCell, "unit_system", "");
        const curModuleMargin = getGardenModuleMargin(moduleCell);
        const savedBedDimsCm = getSavedDefaultBedDimensionsCm(moduleCell);
        let activeBedDisplayUnits = curUnits || "";
        let bedDimensionsEdited = false;
        let closeNotified = false;

        function notifyClose() {
            if (closeNotified) return;
            closeNotified = true;
            if (typeof onClose === "function") onClose();
        }

        let cities = [];
        try {
            cities = await loadCities();
        } catch (e) {
            mxUtils.alert("Error loading cities: " + e.message);
            notifyClose();
            return;
        }
        // Empty city lists are allowed so the City Manager can create the first scheduler-ready city.

        const div = document.createElement("div");
        div.style.padding = "10px";
        div.style.minWidth = "360px";

        const title = document.createElement("div");
        title.style.fontWeight = "600";
        title.style.marginBottom = "10px";
        title.textContent = "Garden Settings";
        div.appendChild(title);

        const err = document.createElement("div");
        err.style.color = "#b91c1c";
        err.style.fontSize = "12px";
        err.style.marginBottom = "8px";
        err.style.display = "none";
        div.appendChild(err);

        function row(labelText, controlEl) {
            const wrap = document.createElement("div");
            wrap.style.display = "flex";
            wrap.style.alignItems = "center";
            wrap.style.gap = "8px";
            wrap.style.margin = "8px 0";
            const lab = document.createElement("label");
            lab.textContent = labelText;
            lab.style.minWidth = "140px";
            wrap.appendChild(lab);
            wrap.appendChild(controlEl);
            div.appendChild(wrap);
            return { wrap, label: lab, control: controlEl };
        }

        const gardenNameInput = document.createElement("input");
        gardenNameInput.type = "text";
        gardenNameInput.value = curGardenName;
        gardenNameInput.style.flex = "1";
        row("Garden name:", gardenNameInput);

        // City (mandatory)
        const citySel = makeCityTreePicker(cities, curCityId);

        function selectedCityRow() {
            return cities.find(city => String(city.city_id) === String(citySel.value)) || null;
        }

        function refreshCityOptions(selectedCityId, selectedCityName) {
            const selected = selectedCityId || (cities.find(city => city.city_name === selectedCityName)?.city_id) || "";
            citySel.setCities(cities, selected);
        }

        refreshCityOptions(curCityId, curCity);
        const cityControl = document.createElement("div");
        cityControl.style.display = "flex";
        cityControl.style.gap = "6px";
        cityControl.style.flex = "1";
        cityControl.appendChild(citySel);
        const manageCityBtn = tilerButton("Manage...", async () => {
            await showCityManagerDialog(ui, graph, citySel.value, unitsSel.value || curUnits || "metric", async saved => {
                cities = await loadCities();
                refreshCityOptions(saved.city_id, saved.city_name);
            });
        }, "open");
        setTooltip(citySel, "Select the garden city. City climate data is managed with the adjacent button.");
        setTooltip(manageCityBtn, "Add or edit city latitude, longitude, timezone, frost dates, and monthly normals.");
        cityControl.appendChild(manageCityBtn);
        row("City:", cityControl);

        // Units (mandatory)
        const unitsSel = document.createElement("select");
        unitsSel.style.flex = "1";

        const unitsPlaceholder = document.createElement("option");
        unitsPlaceholder.value = "";
        unitsPlaceholder.textContent = "Select units…";
        unitsPlaceholder.disabled = true;
        unitsPlaceholder.selected = !curUnits;
        unitsSel.appendChild(unitsPlaceholder);

        [{ v: "metric", t: "Metric (m, cm)" }, { v: "imperial", t: "Imperial (ft, in)" }]
            .forEach(({ v, t }) => {
                const o = document.createElement("option");
                o.value = v;
                o.textContent = t;
                if (v === curUnits) o.selected = true;
                unitsSel.appendChild(o);
            });
        row("Units:", unitsSel);

        const bedWidthInput = document.createElement("input");
        bedWidthInput.type = "number";
        bedWidthInput.step = "0.01";
        bedWidthInput.min = "0.01";
        bedWidthInput.style.flex = "1";
        const bedWidthRow = row("Default bed width:", bedWidthInput);

        const bedLengthInput = document.createElement("input");
        bedLengthInput.type = "number";
        bedLengthInput.step = "0.01";
        bedLengthInput.min = "0.01";
        bedLengthInput.style.flex = "1";
        const bedLengthRow = row("Default bed length:", bedLengthInput);
        mxEvent.addListener(bedWidthInput, "input", function () { bedDimensionsEdited = true; });
        mxEvent.addListener(bedLengthInput, "input", function () { bedDimensionsEdited = true; });

        const moduleMarginInput = document.createElement("input");
        moduleMarginInput.type = "number";
        moduleMarginInput.step = "1";
        moduleMarginInput.min = "0";
        moduleMarginInput.value = String(curModuleMargin);
        moduleMarginInput.style.flex = "1";
        row("Module margin (px):", moduleMarginInput);

        function readBedInputsAsCm(units) {
            if (!units) return null;
            const widthCm = bedDimensionDisplayToCm(bedWidthInput.value, units);
            const lengthCm = bedDimensionDisplayToCm(bedLengthInput.value, units);
            return widthCm && lengthCm ? { widthCm, lengthCm } : null;
        }

        function setBedInputsFromCm(dimsCm, units) {
            if (!dimsCm || !units) {
                bedWidthInput.value = "";
                bedLengthInput.value = "";
                return;
            }
            bedWidthInput.value = formatBedDisplayValue(bedDimensionCmToDisplay(dimsCm.widthCm, units));
            bedLengthInput.value = formatBedDisplayValue(bedDimensionCmToDisplay(dimsCm.lengthCm, units));
        }

        function syncBedDimensionInputs(nextUnits) {
            const priorDims = activeBedDisplayUnits && bedDimensionsEdited ? readBedInputsAsCm(activeBedDisplayUnits) : null;
            const nextDims = priorDims || savedBedDimsCm || defaultBedDimensionsCmForUnits(nextUnits);
            const enabled = !!nextUnits;
            const unitLabel = enabled ? bedDisplayUnitLabel(nextUnits) : "";
            activeBedDisplayUnits = nextUnits || "";
            bedWidthRow.label.textContent = enabled ? `Default bed width (${unitLabel}):` : "Default bed width:";
            bedLengthRow.label.textContent = enabled ? `Default bed length (${unitLabel}):` : "Default bed length:";
            bedWidthInput.disabled = !enabled;
            bedLengthInput.disabled = !enabled;
            setBedInputsFromCm(enabled ? nextDims : null, nextUnits);
        }

        mxEvent.addListener(unitsSel, "change", function () {
            syncBedDimensionInputs((unitsSel.value || "").trim());
        });
        syncBedDimensionInputs(curUnits);

        function showError(msg) {
            err.textContent = msg;
            err.style.display = "block";
        }

        const btnRow = document.createElement("div");
        btnRow.style.display = "flex";
        btnRow.style.justifyContent = "flex-end";
        btnRow.style.gap = "8px";
        btnRow.style.marginTop = "12px";

        const cancelBtn = tilerButton("Cancel", () => ui.hideDialog(), "neutral");
        const okBtn = tilerButton("OK", () => {
            err.style.display = "none";
            const chosenGardenName = String(gardenNameInput.value || "").trim() || "Garden";
            const chosenCityRow = selectedCityRow();
            const chosenCity = String(chosenCityRow?.city_name || "").trim();
            const chosenCityId = chosenCityRow?.city_id != null ? String(chosenCityRow.city_id) : "";
            const chosenUnits = (unitsSel.value || "").trim();
            const chosenBedDimsCm = readBedInputsAsCm(chosenUnits);
            const chosenModuleMargin = readModuleMarginInput(moduleMarginInput);

            if (!chosenCity) { showError("City is required."); citySel.focus(); return; }
            if (!chosenUnits) { showError("Units are required."); unitsSel.focus(); return; }
            if (!chosenBedDimsCm) { showError("Default bed width and length must be positive numbers."); bedWidthInput.focus(); return; }
            if (chosenModuleMargin == null) { showError("Module margin must be a non-negative whole number."); moduleMarginInput.focus(); return; }

            ui.hideDialog();
            model.beginUpdate();
            try {
                setCellAttrsNoTxn(model, moduleCell, {
                    garden_name: chosenGardenName,
                    label: chosenGardenName,
                    city_id: chosenCityId,
                    city_name: chosenCity,
                    unit_system: chosenUnits,
                    [DEFAULT_BED_WIDTH_CM_ATTR]: formatBedCmAttr(chosenBedDimsCm.widthCm),
                    [DEFAULT_BED_LENGTH_CM_ATTR]: formatBedCmAttr(chosenBedDimsCm.lengthCm),
                });
                setGardenModuleMargin(moduleCell, chosenModuleMargin);
            } finally {
                model.endUpdate();
            }
            graph.refresh(moduleCell);

        }, "add");

        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(okBtn);
        div.appendChild(btnRow);

        ui.showDialog(div, 420, 330, true, true, notifyClose);
        elevateTrellisDialog();
        gardenNameInput.focus();
    }

    let openGardenSettingsDialogWithOverlaySuppressed = null;

    function installGardenModuleOverlay() {
        if (graph.__plantTilerGardenModuleOverlayInstalled) return;
        graph.__plantTilerGardenModuleOverlayInstalled = true;

        const OFFSET_PX = 8;
        const SIMPLE_CLICK_MAX_MOVE_PX = 4;
        const MOUSE_ANCHOR_MAX_AGE_MS = 1000;
        let toolbar = null;
        let labelInputWrap = null;
        let settingsBtn = null;
        let addBedBtn = null;
        let addGroupBtn = null;
        let irrigationSourceBtn = null;
        let activeModuleCell = null;
        let activeBedCell = null;
        let activeOverlayMode = "";
        let anchorModelPoint = null;
        let lastMouseAnchor = null;
        let gestureHidden = false;
        let refreshTimer = null;
        let gardenSettingsOverlaySuppressed = false;
        let manuallyHiddenModuleCell = null;
        let pendingSelectedModuleToggle = null;

        function getOverlayHost() {
            return graph.container;
        }

        function ensureOverlayHost() {
            const host = getOverlayHost();
            if (!host) return null;
            const style = window.getComputedStyle ? window.getComputedStyle(host) : null;
            if (style && style.position === "static") host.style.position = "relative";
            return host;
        }

        function makeButton(text, variant) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.textContent = text;
            btn.style.border = "1px solid #b8b8b8";
            btn.style.borderRadius = "4px";
            btn.style.background = "#fff";
            btn.style.color = "#222";
            btn.style.cursor = "pointer";
            btn.style.font = "12px Arial, sans-serif";
            btn.style.padding = "5px 8px";
            btn.style.textAlign = "left";
            btn.style.whiteSpace = "nowrap";
            applyTilerButtonStyle(btn, variant || "neutral", { compact: true });
            return btn;
        }

        function gardenModuleLabelApi() {
            return graph && graph.__trellisModules ? graph.__trellisModules : {};
        }

        function plainGardenModuleLabel(moduleCell) {
            const api = gardenModuleLabelApi();
            if (typeof api.getModuleLabel === "function") return api.getModuleLabel(moduleCell, "Garden Module");
            const raw = getXmlAttr(moduleCell, "label", "") || (typeof (moduleCell && moduleCell.value) === "string" ? moduleCell.value : "");
            if (document && document.createElement) {
                const holder = document.createElement("div");
                holder.innerHTML = raw;
                const text = String(holder.textContent || "").replace(/\s+/g, " ").trim();
                if (text) return text;
            }
            const stripped = String(raw || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
            return stripped || "Garden Module";
        }

        function writeGardenModuleLabel(moduleCell, label) {
            const api = gardenModuleLabelApi();
            if (typeof api.writeModuleLabel === "function") return api.writeModuleLabel(moduleCell, label);
            const next = String(label == null ? "" : label).trim() || "Garden Module";
            if (plainGardenModuleLabel(moduleCell) !== next) {
                const graphModel = graph.getModel && graph.getModel();
                if (graphModel) {
                    graphModel.beginUpdate();
                    try {
                        setCellAttrsNoTxn(graphModel, moduleCell, { label: next });
                    } finally {
                        graphModel.endUpdate();
                    }
                }
                if (graph.refresh) graph.refresh(moduleCell);
            }
            return next;
        }

        function stopGardenLabelEvent(evt) {
            if (evt && evt.stopPropagation) evt.stopPropagation();
        }

        function consumeGardenLabelEvent(evt) {
            stopGardenLabelEvent(evt);
            if (evt && evt.preventDefault) evt.preventDefault();
        }

        function makeGardenModuleLabelInput(moduleCell) {
            const initialLabel = plainGardenModuleLabel(moduleCell);
            const input = document.createElement("input");
            input.type = "text";
            input.value = initialLabel;
            input.setAttribute("aria-label", "Garden label");
            input.style.cssText = "display:block;box-sizing:border-box;width:100%;min-width:0;margin-bottom:2px;border:1px solid rgba(75,85,99,0.35);border-radius:4px;padding:3px 5px;font:12px Arial,sans-serif;font-weight:600;";
            ["mousedown", "mouseup", "click", "dblclick", "pointerdown", "pointerup"].forEach(function (type) {
                input.addEventListener(type, stopGardenLabelEvent);
            });
            input.addEventListener("keydown", function (evt) {
                stopGardenLabelEvent(evt);
                if (evt.key === "Enter") {
                    input.value = writeGardenModuleLabel(moduleCell, input.value);
                    if (input.blur) input.blur();
                    consumeGardenLabelEvent(evt);
                } else if (evt.key === "Escape") {
                    input.value = initialLabel;
                    consumeGardenLabelEvent(evt);
                }
            });
            ["keypress", "keyup"].forEach(function (type) { input.addEventListener(type, stopGardenLabelEvent); });
            input.addEventListener("blur", function () { input.value = writeGardenModuleLabel(moduleCell, input.value); });
            return input;
        }

        function renderGardenModuleLabelInput(moduleCell) {
            if (!labelInputWrap) return;
            labelInputWrap.innerHTML = "";
            if (moduleCell && isGardenModule(moduleCell)) labelInputWrap.appendChild(makeGardenModuleLabelInput(moduleCell));
        }

        function ensureToolbar() {
            if (toolbar) return toolbar;
            toolbar = document.createElement("div");
            toolbar.style.position = "absolute";
            toolbar.style.zIndex = String(GRAPH_OVERLAY_Z.CONTROL);
            toolbar.style.display = "none";
            toolbar.style.flexDirection = "column";
            toolbar.style.gap = "4px";
            toolbar.style.padding = "4px";
            toolbar.style.background = "rgba(255,255,255,0.96)";
            toolbar.style.border = "1px solid #c7c7cc";
            toolbar.style.borderRadius = "6px";
            toolbar.style.boxShadow = "0 2px 8px rgba(0,0,0,0.16)";
            toolbar.style.font = "12px Arial, sans-serif";
            toolbar.style.pointerEvents = "auto";
            mxEvent.addListener(toolbar, "mousedown", function (evt) { mxEvent.consume(evt); });
            mxEvent.addListener(toolbar, "click", function (evt) { evt.stopPropagation(); });

            labelInputWrap = document.createElement("div");
            labelInputWrap.className = "trellis-garden-module-label-controls";
            labelInputWrap.style.cssText = "display:flex;flex-direction:column;gap:4px;padding:2px 2px 4px;border-bottom:1px solid #e5e7eb;";
            settingsBtn = makeButton("Set Garden Settings", "open");
            addBedBtn = makeButton("Add Garden Bed", "add");
            addGroupBtn = makeButton("Add New Plant Group", "add");
            irrigationSourceBtn = makeButton("Create Irrigation Source", "add");
            toolbar.appendChild(labelInputWrap);
            toolbar.appendChild(settingsBtn);
            toolbar.appendChild(addBedBtn);
            toolbar.appendChild(addGroupBtn);
            toolbar.appendChild(irrigationSourceBtn);

            mxEvent.addListener(settingsBtn, "click", async function (evt) {
                mxEvent.consume(evt);
                const moduleCell = activeModuleCell;
                if (!moduleCell || !isGardenModule(moduleCell)) return;
                await openGardenSettingsDialogWithOverlaySuppressed(moduleCell);
            });

            mxEvent.addListener(addBedBtn, "click", function (evt) {
                mxEvent.consume(evt);
                const moduleCell = activeModuleCell;
                const pt = anchorModelPoint;
                if (!moduleCell || !pt || !hasGardenSettingsSet(moduleCell)) return;
                try {
                    createDefaultGardenBed(graph, moduleCell, pt.x, pt.y);
                    hideToolbar();
                } catch (e) {
                    mxUtils.alert("Error creating garden bed: " + (e && e.message ? e.message : e));
                }
            });

            mxEvent.addListener(addGroupBtn, "click", function (evt) {
                mxEvent.consume(evt);
                const moduleCell = activeModuleCell;
                const pt = anchorModelPoint;
                if (!moduleCell || !pt || !hasGardenSettingsSet(moduleCell)) return;
                createEmptyTilerGroup(graph, moduleCell, pt.x, pt.y, { source: activeOverlayMode === "bed" ? "overlay-bed-add" : "overlay-module-add" });
                hideToolbar();
            });

            mxEvent.addListener(irrigationSourceBtn, "click", function (evt) {
                mxEvent.consume(evt);
                const moduleCell = activeModuleCell;
                if (!moduleCell || !hasGardenSettingsSet(moduleCell) || gardenModuleHasIrrigationSource(moduleCell)) return;
                openIrrigationSourceFormForModule(moduleCell);
                hideToolbar();
            });

            const host = ensureOverlayHost();
            if (host) host.appendChild(toolbar);
            return toolbar;
        }

        function hideToolbar() {
            if (toolbar) toolbar.style.display = "none";
        }

        function isPlainPrimaryMouseEvent(evt) {
            if (!evt) return false;
            if ((mxEvent.isPopupTrigger && mxEvent.isPopupTrigger(evt)) || evt.button === 2) return false;
            return !mxEvent.isControlDown(evt) && !mxEvent.isMetaDown(evt) && !mxEvent.isShiftDown(evt) && Number(evt.detail || 1) <= 1;
        }

        function mouseEventCell(me, evt) {
            const cell = me && me.getCell ? me.getCell() : null;
            if (cell || !evt || !graph.getCellAt || !graph.getPointForEvent) return cell;
            const pt = graph.getPointForEvent(evt, false);
            return pt ? graph.getCellAt(pt.x, pt.y) : null;
        }

        function selectedGardenModulePlainClickTarget(me, evt) {
            if (!isPlainPrimaryMouseEvent(evt)) return null;
            const selectedModule = getSingleSelectedGardenModule();
            if (!selectedModule) return null;
            if (activeOverlayMode !== "module" || activeModuleCell !== selectedModule) return null;
            return mouseEventCell(me, evt) === selectedModule ? selectedModule : null;
        }

        function clearHiddenModuleIfTargetChanged(target) {
            if (!manuallyHiddenModuleCell) return;
            if (!target || target.mode !== "module" || target.moduleCell !== manuallyHiddenModuleCell) manuallyHiddenModuleCell = null;
        }

        function toggleHiddenModuleAfterSimpleClick(evt) {
            const pending = pendingSelectedModuleToggle;
            pendingSelectedModuleToggle = null;
            if (!pending || !isSimpleAnchorClick(evt)) return false;
            if (getSingleSelectedGardenModule() !== pending) return false;
            manuallyHiddenModuleCell = manuallyHiddenModuleCell === pending ? null : pending;
            return true;
        }

        function gardenModuleHasIrrigationSource(moduleCell) {
            return collectModuleDescendants(moduleCell).some(function (cell) {
                return getXmlAttr(cell, "irrigation_endpoint_type", "") === "source";
            });
        }

        function collectModuleDescendants(moduleCell) {
            const graphModel = graph.getModel && graph.getModel();
            const out = [];
            (function visit(parent) {
                const count = graphModel && graphModel.getChildCount ? graphModel.getChildCount(parent) : ((parent && parent.children && parent.children.length) || 0);
                for (let i = 0; i < count; i++) {
                    const child = graphModel && graphModel.getChildAt ? graphModel.getChildAt(parent, i) : parent.children[i];
                    if (!child) continue;
                    out.push(child);
                    visit(child);
                }
            })(moduleCell);
            return out;
        }

        function openIrrigationSourceFormForModule(moduleCell) {
            if (window.TrellisIrrigationPlanner && typeof window.TrellisIrrigationPlanner.openIrrigationMode === "function") {
                window.TrellisIrrigationPlanner.openIrrigationMode(moduleCell, { sourceForm: true, preserveViewport: true });
                return;
            }
            if (graph.setSelectionCell) graph.setSelectionCell(moduleCell);
            const action = ui.actions && ui.actions.get && ui.actions.get("trellisIrrigationCreateSourceEndpoint");
            if (action && typeof action.funct === "function") action.funct();
        }

        openGardenSettingsDialogWithOverlaySuppressed = async function (moduleCell, onClose) {
            gardenSettingsOverlaySuppressed = true;
            hideToolbar();
            let closeHandled = false;

            function clearSuppressionAndNotify() {
                if (closeHandled) return;
                closeHandled = true;
                gardenSettingsOverlaySuppressed = false;
                if (typeof onClose === "function") onClose();
                scheduleRefresh();
            }

            try {
                await showGardenSettingsDialog(ui, graph, moduleCell, clearSuppressionAndNotify);
            } catch (e) {
                clearSuppressionAndNotify();
                throw e;
            }
        };

        function getSingleSelectedGardenModule() {
            const cells = graph.getSelectionCells ? (graph.getSelectionCells() || []) : [];
            if (cells.length !== 1) return null;
            return isGardenModule(cells[0]) ? cells[0] : null;
        }

        function isIrrigationModeActiveForOverlay() {
            const planner = graph.__trellisIrrigationPlanner || (typeof window !== "undefined" && window.TrellisIrrigationPlanner);
            return !!(planner && typeof planner.isIrrigationModeActive === "function" && planner.isIrrigationModeActive());
        }

        function getSingleSelectedOverlayTarget() {
            const cells = graph.getSelectionCells ? (graph.getSelectionCells() || []) : [];
            if (cells.length !== 1) return null;
            const cell = cells[0];
            if (isGardenModule(cell)) return { mode: "module", moduleCell: cell, bedCell: null, anchorCell: cell };
            if (isGardenBed(cell)) {
                const moduleCell = findGardenModuleAncestor(graph, cell);
                if (moduleCell) return { mode: "bed", moduleCell: moduleCell, bedCell: cell, anchorCell: cell };
            }
            return null;
        }

        function viewPointFromModelPoint(pt) {
            const s = graph.view.scale || 1;
            const tr = graph.view.translate || { x: 0, y: 0 };
            return {
                x: ((Number(pt.x) || 0) + tr.x) * s + (graph.panDx || 0),
                y: ((Number(pt.y) || 0) + tr.y) * s + (graph.panDy || 0)
            };
        }

        function viewportCenterModelPoint() {
            const s = graph.view.scale || 1;
            const tr = graph.view.translate || { x: 0, y: 0 };
            const host = getOverlayHost();
            const visibleCenterX = (host ? host.scrollLeft || 0 : 0) + (host ? host.clientWidth || 0 : 0) / 2;
            const visibleCenterY = (host ? host.scrollTop || 0 : 0) + (host ? host.clientHeight || 0 : 0) / 2;
            return {
                x: (visibleCenterX - (graph.panDx || 0)) / s - tr.x,
                y: (visibleCenterY - (graph.panDy || 0)) / s - tr.y
            };
        }

        function cellCenterGraphPoint(cell) {
            const model = graph.getModel();
            const geo = cell && model.getGeometry(cell);
            if (!geo) return viewportCenterModelPoint();
            const parent = model.getParent(cell);
            const parentGeo = parent && model.getGeometry(parent);
            const parentX = parentGeo ? Number(parentGeo.x) || 0 : 0;
            const parentY = parentGeo ? Number(parentGeo.y) || 0 : 0;
            return {
                x: parentX + (Number(geo.x) || 0) + (Number(geo.width) || 0) / 2,
                y: parentY + (Number(geo.y) || 0) + (Number(geo.height) || 0) / 2
            };
        }

        function stateContainsViewPoint(state, pt) {
            if (!state || !pt) return false;
            return pt.x >= state.x && pt.y >= state.y && pt.x <= state.x + state.width && pt.y <= state.y + state.height;
        }

        function chooseAnchorPoint(target) {
            const now = Date.now();
            const state = target && target.anchorCell ? graph.view.getState(target.anchorCell) : null;
            if (lastMouseAnchor && now - lastMouseAnchor.t <= MOUSE_ANCHOR_MAX_AGE_MS && stateContainsViewPoint(state, lastMouseAnchor.view)) {
                return { x: lastMouseAnchor.model.x, y: lastMouseAnchor.model.y };
            }
            if (target && target.mode === "bed") return cellCenterGraphPoint(target.bedCell);
            return viewportCenterModelPoint();
        }

        function isSimpleAnchorClick(evt) {
            if (!evt || !lastMouseAnchor || !lastMouseAnchor.client) return false;
            const dx = mxEvent.getClientX(evt) - lastMouseAnchor.client.x;
            const dy = mxEvent.getClientY(evt) - lastMouseAnchor.client.y;
            return Math.sqrt(dx * dx + dy * dy) <= SIMPLE_CLICK_MAX_MOVE_PX;
        }

        function updateAnchorFromSimpleClick(evt) {
            if (!isSimpleAnchorClick(evt)) return false;
            const target = getSingleSelectedOverlayTarget();
            const state = target && target.anchorCell ? graph.view.getState(target.anchorCell) : null;
            if (!target || !stateContainsViewPoint(state, lastMouseAnchor.view)) return false;
            activeModuleCell = target.moduleCell;
            activeBedCell = target.bedCell || null;
            activeOverlayMode = target.mode;
            anchorModelPoint = { x: lastMouseAnchor.model.x, y: lastMouseAnchor.model.y };
            return true;
        }

        function positionToolbar() {
            if (gardenSettingsOverlaySuppressed) { hideToolbar(); return; }
            if (isIrrigationModeActiveForOverlay()) { hideToolbar(); return; }
            if (!toolbar || !activeModuleCell || !anchorModelPoint) return;
            const host = ensureOverlayHost();
            if (host && toolbar.parentNode !== host) host.appendChild(toolbar);
            const viewPt = viewPointFromModelPoint(anchorModelPoint);
            toolbar.style.display = "flex";
            toolbar.style.left = Math.round(viewPt.x + OFFSET_PX) + "px";
            toolbar.style.top = Math.round(viewPt.y + OFFSET_PX) + "px";
        }

        function syncToolbarState() {
            const moduleCell = activeModuleCell;
            if (!toolbar || !labelInputWrap || !settingsBtn || !addBedBtn || !addGroupBtn || !irrigationSourceBtn || !moduleCell) return;
            const hasSettings = hasGardenSettingsSet(moduleCell);
            const bedMode = activeOverlayMode === "bed";
            const showIrrigationSource = !bedMode && !gardenModuleHasIrrigationSource(moduleCell);
            labelInputWrap.style.display = bedMode ? "none" : "flex";
            if (!bedMode) renderGardenModuleLabelInput(moduleCell);
            settingsBtn.style.display = bedMode ? "none" : "";
            addBedBtn.style.display = bedMode ? "none" : "";
            addGroupBtn.style.display = "";
            irrigationSourceBtn.style.display = showIrrigationSource ? "" : "none";
            settingsBtn.textContent = hasSettings ? "Edit Garden Settings" : "Set Garden Settings";
            addBedBtn.disabled = !hasSettings;
            addBedBtn.title = hasSettings ? "Add the default-sized garden bed at the selected location" : "Set garden settings before adding beds";
            addBedBtn.style.opacity = hasSettings ? "1" : "0.55";
            addBedBtn.style.cursor = hasSettings ? "pointer" : "default";
            addGroupBtn.disabled = !hasSettings;
            addGroupBtn.title = hasSettings ? (bedMode ? "Add a new plant group fitted to this garden bed" : "Add a new plant group at the selected location") : "Set garden settings before adding plants";
            addGroupBtn.style.opacity = hasSettings ? "1" : "0.55";
            addGroupBtn.style.cursor = hasSettings ? "pointer" : "default";
            irrigationSourceBtn.disabled = !hasSettings;
            irrigationSourceBtn.title = hasSettings ? "Enter irrigation design mode and create the first irrigation source" : "Set garden settings before creating an irrigation source";
            irrigationSourceBtn.style.opacity = hasSettings ? "1" : "0.55";
            irrigationSourceBtn.style.cursor = hasSettings ? "pointer" : "default";
        }

        function refreshForSelection() {
            refreshTimer = null;
            if (gardenSettingsOverlaySuppressed) {
                hideToolbar();
                return;
            }
            if (isIrrigationModeActiveForOverlay()) {
                hideToolbar();
                return;
            }
            const target = getSingleSelectedOverlayTarget();
            clearHiddenModuleIfTargetChanged(target);
            if (!target || gestureHidden) {
                activeModuleCell = target ? target.moduleCell : null;
                activeBedCell = target ? target.bedCell : null;
                activeOverlayMode = target ? target.mode : "";
                if (!target) anchorModelPoint = null;
                hideToolbar();
                return;
            }
            if (activeModuleCell !== target.moduleCell || activeBedCell !== target.bedCell || activeOverlayMode !== target.mode || !anchorModelPoint) {
                anchorModelPoint = chooseAnchorPoint(target);
            }
            activeModuleCell = target.moduleCell;
            activeBedCell = target.bedCell || null;
            activeOverlayMode = target.mode;
            if (target.mode === "module" && target.moduleCell === manuallyHiddenModuleCell) { hideToolbar(); return; }
            ensureToolbar();
            syncToolbarState();
            positionToolbar();
        }

        function scheduleRefresh() {
            if (refreshTimer != null) clearTimeout(refreshTimer);
            refreshTimer = setTimeout(refreshForSelection, 0);
        }

        graph.__plantTilerRefreshGardenModuleOverlay = scheduleRefresh;

        graph.addMouseListener({
            mouseDown: function (_sender, me) {
                const evt = me && me.getEvent ? me.getEvent() : null;
                if (evt && toolbar && toolbar.contains(mxEvent.getSource(evt))) return;
                pendingSelectedModuleToggle = selectedGardenModulePlainClickTarget(me, evt);
                if (evt) {
                    const modelPt = graph.getPointForEvent(evt, false);
                    lastMouseAnchor = {
                        model: { x: modelPt.x, y: modelPt.y },
                        view: { x: me.getGraphX(), y: me.getGraphY() },
                        client: { x: mxEvent.getClientX(evt), y: mxEvent.getClientY(evt) },
                        t: Date.now()
                    };
                }
                gestureHidden = true;
                hideToolbar();
            },
            mouseMove: function () { },
            mouseUp: function (_sender, me) {
                const evt = me && me.getEvent ? me.getEvent() : null;
                gestureHidden = false;
                updateAnchorFromSimpleClick(evt);
                toggleHiddenModuleAfterSimpleClick(evt);
                scheduleRefresh();
            }
        });

        graph.getSelectionModel().addListener(mxEvent.CHANGE, scheduleRefresh);
        graph.addListener(mxEvent.CELLS_MOVED, scheduleRefresh);
        graph.addListener(mxEvent.CELLS_RESIZED, scheduleRefresh);
        graph.getView().addListener(mxEvent.SCALE, scheduleRefresh);
        graph.getView().addListener(mxEvent.TRANSLATE, scheduleRefresh);
        graph.getView().addListener(mxEvent.SCALE_AND_TRANSLATE, scheduleRefresh);
        graph.getView().addListener(mxEvent.REPAINT, function () { if (!gardenSettingsOverlaySuppressed && toolbar && toolbar.style.display !== "none") positionToolbar(); });
        graph.getModel().addListener(mxEvent.UNDO, scheduleRefresh);
        graph.getModel().addListener(mxEvent.REDO, scheduleRefresh);
        mxEvent.addListener(window, "resize", scheduleRefresh);
        mxEvent.addListener(window, "trellisIrrigationModeChanged", scheduleRefresh);
        setTimeout(scheduleRefresh, 0);
    }


    // Listen for garden-module settings requests emitted by the module plugin               
    if (!graph.__uslGardenSettingsListenerInstalled) {
        graph.__uslGardenSettingsListenerInstalled = true;

        graph.addListener("usl:gardenModuleNeedsSettings", function (sender, evt) {
            const moduleCell = evt.getProperty("cell");
            if (!moduleCell || !isGardenModule(moduleCell)) return;

            if (hasGardenSettingsSet(moduleCell)) return;

            // Defer dialog until after current paint/update completes                        
            setTimeout(() => {
                // Re-check in case settings were set during the delay                         
                if (hasGardenSettingsSet(moduleCell)) return;
                if (openGardenSettingsDialogWithOverlaySuppressed) {
                    openGardenSettingsDialogWithOverlaySuppressed(moduleCell);
                } else {
                    showGardenSettingsDialog(ui, graph, moduleCell, graph.__plantTilerRefreshGardenModuleOverlay);
                }
            }, 0);
        });
    }

    function getGroupDisplayName(groupCell, fallbackAbbr = '?') {
        const plantName = getXmlAttr(groupCell, 'plant_name', '') || '';
        const varietyName = getXmlAttr(groupCell, 'variety_name', '') || '';
        const base = (plantName || fallbackAbbr || '?').trim();
        const v = varietyName.trim();
        return v ? `${base} - ${v}` : base;
    }


    function getStyleSafe(cell) {
        return cell && typeof cell.getStyle === "function"
            ? cell.getStyle() || ""
            : (cell && cell.style) || "";
    }

    function isModule(cell) {
        return !!cell && getStyleSafe(cell).includes("module=1");
    }

    function isGardenModule(cell) {
        return (
            isModule(cell) &&
            getXmlAttr(cell, "garden_module", "") === "1"
        );
    }

    installGardenModuleOverlay();

    function findModuleAncestor(graph, cell) {
        const m = graph.getModel();
        let cur = cell;
        while (cur) {
            if (isModule(cur)) return cur;
            cur = m.getParent(cur);
        }
        return null;
    }

    // -------------------- Garden Bed helpers --------------------
    function isGardenBed(cell) {
        return !!cell && cell.getAttribute && (
            cell.getAttribute("garden_bed") === "1" ||
            cell.getAttribute("gardenBed") === "1" ||
            cell.getAttribute("is_garden_bed") === "1"
        );
    }

    function findGardenModuleAncestor(graph, cell) {
        const m = graph.getModel();
        let cur = cell;
        while (cur) {
            if (isGardenModule(cur)) return cur;
            cur = m.getParent(cur);
        }
        return null;
    }

    function bedAtGraphPoint(graph, moduleCell, gx, gy) {
        // Use mxGraph hit-testing so "actual shape" is used, not rectangular bounds. 
        // Ignore everything except garden beds. 
        const ignoreFn = (c) => !isGardenBed(c);
        return graph.getCellAt(gx, gy, moduleCell, true, false, ignoreFn);
    }

    function plantCenterInGraphCoords(graph, groupCell, plantCell) {
        // Assumption: group is a direct child of the garden module (as your system intends).
        const moduleCell = findGardenModuleAncestor(graph, groupCell);
        if (!moduleCell) return null;

        const mg = moduleCell.getGeometry && moduleCell.getGeometry();
        const gg = groupCell.getGeometry && groupCell.getGeometry();
        const center = childVisualCenterLocal(plantCell);
        if (!mg || !gg || !center) return null;

        return {
            moduleCell,
            x: (mg.x + gg.x + center.x),
            y: (mg.y + gg.y + center.y),
        };
    }

    function trimGroupToSingleGardenBed(graph, groupCell) {
        if (!groupCell || !isTilerGroup(groupCell)) return { removed: 0, skipped: true };
        if (isCollapsedLOD(groupCell)) return { removed: 0, skipped: true, reason: "lod_collapsed" };

        const model = graph.getModel();
        const kids = graph.getChildVertices(groupCell) || [];
        const circles = kids.filter(k => isPlantCircle(k));
        if (!circles.length) return { removed: 0, skipped: true, reason: "no_circles" };

        // Map each circle -> bed (shape hit-test)
        const bedIds = new Set();
        const circleBed = new Map();

        for (const c of circles) {
            const pt = plantCenterInGraphCoords(graph, groupCell, c);
            if (!pt) { circleBed.set(c, null); continue; }

            const bed = bedAtGraphPoint(graph, pt.moduleCell, pt.x, pt.y);
            circleBed.set(c, bed || null);
            if (bed && bed.id) bedIds.add(bed.id);
        }

        // Ignore tiler groups that are over multiple beds (or no bed).
        if (bedIds.size !== 1) {
            return { removed: 0, skipped: true, reason: bedIds.size === 0 ? "no_bed" : "multiple_beds" };
        }

        const bedId = Array.from(bedIds)[0];

        // Remove circles not in the single bed (including null).
        const toRemove = [];
        const disabledSet = readDisabledSet(groupCell);
        let disabledAdded = 0;

        for (const c of circles) {
            const bed = circleBed.get(c);
            if (!bed || bed.id !== bedId) {
                toRemove.push(c);
                if (hasTileRC(c)) {
                    const r = Number(c.getAttribute("tile_r"));
                    const cc = Number(c.getAttribute("tile_c"));
                    if (Number.isFinite(r) && Number.isFinite(cc)) {
                        const key = `${r},${cc}`;
                        if (!disabledSet.has(key)) { disabledSet.add(key); disabledAdded++; }
                    }
                }
            }
        }

        if (!toRemove.length) return { removed: 0, skipped: false };

        model.beginUpdate();
        try {
            if (disabledAdded) writeDisabledSet(model, groupCell, disabledSet);
            graph.removeCells(toRemove);

            // Recompute counts/yield to keep ATTR_PLANT_COUNT* consistent.
            const abbr = groupCell.getAttribute("plant_abbr") || "?";
            const sx = toPx(Number(groupCell.getAttribute("spacing_x_cm") || groupCell.getAttribute("spacing_cm") || "30"));
            const sy = toPx(Number(groupCell.getAttribute("spacing_y_cm") || groupCell.getAttribute("spacing_cm") || "30"));
            const { rows, cols, count } = computeGridStatsXY(groupCell, sx, sy);
            pruneDisabledToGrid(model, groupCell, rows, cols);
            const disabledSet2 = readDisabledSet(groupCell);
            const { actual } = applyCounts(model, groupCell, count, disabledSet2);
            updateGroupYield(model, groupCell, { abbr, countOverride: actual });
        } finally {
            model.endUpdate();
        }

        graph.refresh(groupCell);
        return { removed: toRemove.length, skipped: false, bedId };
    }

    // -------------------- Bed-aware model-space auto-fit --------------------
    let bedFitInProgress = false;
    let bedFitTxnSeq = 0;
    let bedFitSuppressResizeUntil = 0;
    let bedFitSuppressResizeIds = new Set();

    function nearlySameNumber(a, b) {
        return Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.001;
    }

    function bedFitRound(value) {
        const n = Number(value);
        return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : value;
    }

    function bedFitRectSnapshot(rect) {
        if (!rect) return null;
        return {
            x: bedFitRound(rect.x),
            y: bedFitRound(rect.y),
            w: bedFitRound(rect.w != null ? rect.w : rect.width),
            h: bedFitRound(rect.h != null ? rect.h : rect.height)
        };
    }

    function bedFitGeometrySnapshot(cell) {
        const g = cell && cell.getGeometry ? cell.getGeometry() : null;
        return g ? bedFitRectSnapshot(g) : null;
    }

    function bedFitCellId(cell) {
        return cell && cell.id ? cell.id : null;
    }

    function bedFitTileSample(groupCell, limit) {
        const model = graph.getModel();
        const out = [];
        const n = model.getChildCount(groupCell);
        const max = Math.max(1, Number(limit) || 6);
        for (let i = 0; i < n && out.length < max; i++) {
            const child = model.getChildAt(groupCell, i);
            if (!model.isVertex(child) || !isPlantCircle(child)) continue;
            const visualCenter = childVisualCenterLocal(child);
            const unrotatedCenter = childCenterInUnrotatedGroupSpace(groupCell, child);
            out.push({
                id: bedFitCellId(child),
                r: child.getAttribute("tile_r"),
                c: child.getAttribute("tile_c"),
                auto: child.getAttribute("auto"),
                dirty: child.getAttribute("dirty"),
                geo: bedFitGeometrySnapshot(child),
                visualCx: visualCenter ? bedFitRound(visualCenter.x) : null,
                visualCy: visualCenter ? bedFitRound(visualCenter.y) : null,
                unrotatedCx: unrotatedCenter ? bedFitRound(unrotatedCenter.x) : null,
                unrotatedCy: unrotatedCenter ? bedFitRound(unrotatedCenter.y) : null
            });
        }
        return out;
    }

    function markBedFitResizeSuppression(items) {
        bedFitSuppressResizeIds = new Set();
        for (const item of (items || [])) {
            if (item && item.tg && item.tg.id) bedFitSuppressResizeIds.add(item.tg.id);
            else if (item && item.assembly && item.assembly.id) bedFitSuppressResizeIds.add(item.assembly.id);
        }
        bedFitSuppressResizeUntil = bedFitSuppressResizeIds.size ? Date.now() + BED_FIT_RESIZE_SUPPRESS_MS : 0;
    }

    function bedFitAxesForGroup(groupCell) {
        return {
            fitWidth: !!(groupCell && groupCell.getAttribute && groupCell.getAttribute(BED_FIT_WIDTH_ATTR) === "1"),
            fitHeight: !!(groupCell && groupCell.getAttribute && groupCell.getAttribute(BED_FIT_HEIGHT_ATTR) === "1")
        };
    }

    function writeBedFitAxesNoTxn(model, groupCell, fitWidth, fitHeight) {
        if (!model || !groupCell || !(isTilerGroup(groupCell) || isIrrigationBedAssembly(groupCell))) return;
        setCellAttrsNoTxn(model, groupCell, {
            [BED_FIT_WIDTH_ATTR]: fitWidth ? "1" : "0",
            [BED_FIT_HEIGHT_ATTR]: fitHeight ? "1" : "0"
        });
    }

    function shouldSuppressBedFitResize(source, groups) {
        if (source !== "cells-resized" || !bedFitSuppressResizeIds.size) return false;
        if (Date.now() > bedFitSuppressResizeUntil) {
            bedFitSuppressResizeIds.clear();
            bedFitSuppressResizeUntil = 0;
            return false;
        }
        return (groups || []).some(group => group && group.id && bedFitSuppressResizeIds.has(group.id));
    }

    function getModelRect(cell) {
        const model = graph.getModel();
        const g = cell ? model.getGeometry(cell) : null;
        if (!g) return null;
        return { x: Number(g.x) || 0, y: Number(g.y) || 0, w: Number(g.width) || 0, h: Number(g.height) || 0 };
    }

    function rectCenterModel(rect) {
        return rect ? { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 } : null;
    }

    function rectAreaModel(rect) {
        return rect ? Math.max(0, rect.w) * Math.max(0, rect.h) : 0;
    }

    function rotatedRectForModelRect(cell, rect) {
        if (!cell || !rect || rect.w <= 0 || rect.h <= 0) return null;
        const center = rectCenterModel(rect);
        const angleDeg = getTilerRotationDeg(cell);
        return { x: rect.x, y: rect.y, w: rect.w, h: rect.h, cx: center.x, cy: center.y, center, angleDeg, angleRad: toRad(angleDeg) };
    }

    function rotateModelPoint(point, center, angleRad) {
        const dx = point.x - center.x;
        const dy = point.y - center.y;
        const cos = Math.cos(angleRad);
        const sin = Math.sin(angleRad);
        return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
    }

    function getRotatedRectModel(cell) {
        const rect = getModelRect(cell);
        return rotatedRectForModelRect(cell, rect);
    }

    function pointInRotatedRectModel(point, rotatedRect) {
        if (!point || !rotatedRect) return false;
        const center = rotatedRect.center || { x: rotatedRect.cx, y: rotatedRect.cy };
        const local = rotateModelPoint(point, center, -rotatedRect.angleRad);
        return local.x >= rotatedRect.x - ROTATION_EPS_DEG &&
            local.x <= rotatedRect.x + rotatedRect.w + ROTATION_EPS_DEG &&
            local.y >= rotatedRect.y - ROTATION_EPS_DEG &&
            local.y <= rotatedRect.y + rotatedRect.h + ROTATION_EPS_DEG;
    }

    function findSmallestContainingBedModel(parent, point) {
        if (!parent || !point) return null;
        const beds = (graph.getChildVertices(parent) || []).filter(isGardenBed);
        let chosen = null;
        let chosenArea = Infinity;
        for (const bed of beds) {
            const rect = getRotatedRectModel(bed);
            if (!rect || !pointInRotatedRectModel(point, rect)) continue;
            const area = rectAreaModel(rect);
            if (area > 0 && area < chosenArea) {
                chosen = bed;
                chosenArea = area;
            }
        }
        return chosen;
    }

    function findBedAssemblyAncestor(cell) {
        let cur = cell;
        while (cur) {
            if (isIrrigationBedAssembly(cur)) return cur;
            cur = graph.getModel().getParent(cur);
        }
        return null;
    }

    function getBedAssembliesFromEventCells(cells) {
        const out = new Map();
        const moved = (cells || []).filter(Boolean);
        for (const cell of moved) {
            const assembly = isIrrigationBedAssembly(cell) ? cell : findBedAssemblyAncestor(cell);
            if (assembly && assembly.id && !out.has(assembly.id)) out.set(assembly.id, assembly);
        }
        if (!moved.length) {
            const selected = graph.getSelectionCells ? graph.getSelectionCells() : [graph.getSelectionCell()];
            for (const cell of (selected || [])) {
                const assembly = isIrrigationBedAssembly(cell) ? cell : findBedAssemblyAncestor(cell);
                if (assembly && assembly.id && !out.has(assembly.id)) out.set(assembly.id, assembly);
            }
        }
        return Array.from(out.values());
    }

    function bedFitAxisClose(value, target) {
        const t = Math.max(1, Number(target) || 1);
        return Math.abs((Number(value) || 0) - t) <= t * BED_FIT_TOLERANCE;
    }

    function inferBedAssemblyFitAxes(assembly, bed) {
        const assemblyRect = getModelRect(assembly);
        const bedRect = getModelRect(bed);
        return {
            fitWidth: !!(assemblyRect && bedRect && bedFitAxisClose(assemblyRect.w, bedRect.w)),
            fitHeight: !!(assemblyRect && bedRect && bedFitAxisClose(assemblyRect.h, bedRect.h))
        };
    }

    function bedFitAxesForBedAssembly(assembly, bed) {
        const inferred = inferBedAssemblyFitAxes(assembly, bed);
        const widthAttr = assembly && assembly.getAttribute ? assembly.getAttribute(BED_FIT_WIDTH_ATTR) : null;
        const heightAttr = assembly && assembly.getAttribute ? assembly.getAttribute(BED_FIT_HEIGHT_ATTR) : null;
        return {
            fitWidth: widthAttr == null ? inferred.fitWidth : widthAttr === "1",
            fitHeight: heightAttr == null ? inferred.fitHeight : heightAttr === "1"
        };
    }

    function resolveBedForAssemblyGeometry(parent, assembly, fallbackBed) {
        const center = rectCenterModel(getModelRect(assembly));
        return findSmallestContainingBedModel(parent, center) || fallbackBed || null;
    }

    function irrigationPlannerForBedFit() {
        return graph.__trellisIrrigationPlanner || (typeof window !== "undefined" && window.TrellisIrrigationPlanner);
    }

    function syncBedAssemblyFitToBed(parent, assembly, bed, axes, opts) {
        const planner = irrigationPlannerForBedFit();
        if (!planner || typeof planner.syncLinkedBedAssemblyToBed !== "function") return false;
        return !!planner.syncLinkedBedAssemblyToBed(parent, assembly, bed, {
            inTransaction: !!(opts && opts.inTransaction),
            fitWidth: !!(axes && axes.fitWidth),
            fitHeight: !!(axes && axes.fitHeight)
        });
    }

    function largestChildPlantCircleDiameter(tg) {
        const model = graph.getModel();
        let diameter = 0;
        const childCount = model.getChildCount(tg);
        for (let i = 0; i < childCount; i++) {
            const child = model.getChildAt(tg, i);
            if (!model.isVertex(child) || !isPlantCircle(child)) continue;
            const cg = model.getGeometry(child);
            if (!cg) continue;
            diameter = Math.max(diameter, Number(cg.width) || 0, Number(cg.height) || 0);
        }
        return diameter;
    }

    function getPlantCircleDiameterPx(tg) {
        const childDiameter = largestChildPlantCircleDiameter(tg);
        if (childDiameter > 0) return childDiameter;
        const vegDiameterCm = parseFloat(String(tg && tg.getAttribute ? tg.getAttribute("veg_diameter_cm") : 0).trim());
        return Number.isFinite(vegDiameterCm) && vegDiameterCm > 0 ? toPx(vegDiameterCm) : 0;
    }

    function allowedOverhangForDiameter(diameter) {
        return Math.max(0, diameter) * (1 - EDGE_CIRCLE_CENTER_CONTAINED_PCT) / 2;
    }

    function bedFitLabelBandPxForSize(width, height) {
        return groupLabelMetrics({ getGeometry: () => ({ width, height }) }).bandPx;
    }

    function getPlantingFrameRectModel(tgRect) {
        if (!tgRect) return null;
        const bandPx = bedFitLabelBandPxForSize(tgRect.w, tgRect.h);
        return {
            x: tgRect.x + GROUP_PADDING_PX,
            y: tgRect.y + GROUP_PADDING_PX + bandPx,
            w: Math.max(0, tgRect.w - GROUP_PADDING_PX * 2),
            h: Math.max(0, tgRect.h - GROUP_PADDING_PX * 2 - bandPx),
            bandPx: bandPx
        };
    }

    function solveOuterHeightForPlantingFrame(innerHeight, outerWidth, seedHeight) {
        let bandPx = bedFitLabelBandPxForSize(outerWidth, seedHeight);
        let outerHeight = Math.max(1, innerHeight + GROUP_PADDING_PX * 2 + bandPx);
        for (let i = 0; i < 5; i++) {
            const nextBandPx = bedFitLabelBandPxForSize(outerWidth, outerHeight);
            const nextOuterHeight = Math.max(1, innerHeight + GROUP_PADDING_PX * 2 + nextBandPx);
            if (nextBandPx === bandPx && nearlySameNumber(nextOuterHeight, outerHeight)) break;
            bandPx = nextBandPx;
            outerHeight = nextOuterHeight;
        }
        return { outerHeight: outerHeight, bandPx: bandPx };
    }

    function collectTilerGroupCandidate(cell, out) {
        const tg = findTilerGroupAncestor(graph, cell);
        if (tg && tg.id && !out.has(tg.id)) out.set(tg.id, tg);
    }

    function getTilerGroupsFromEventCells(cells) {
        const out = new Map();
        const moved = (cells || []).filter(Boolean);
        for (const cell of moved) collectTilerGroupCandidate(cell, out);
        if (!moved.length) {
            const selected = graph.getSelectionCells ? graph.getSelectionCells() : [graph.getSelectionCell()];
            for (const cell of (selected || [])) collectTilerGroupCandidate(cell, out);
        }
        return Array.from(out.values());
    }

    function captureBedFitLayoutSnapshot(tg) {
        if (!tg || !isTilerGroup(tg)) return null;
        const model = graph.getModel();
        const rotationDeg = getTilerRotationDeg(tg);
        const tiles = [];
        const childCount = model.getChildCount(tg);
        for (let i = 0; i < childCount; i++) {
            const child = model.getChildAt(tg, i);
            if (!model.isVertex(child) || !isPlantCircle(child) || !hasTileRC(child)) continue;
            const r = Number(child.getAttribute("tile_r"));
            const c = Number(child.getAttribute("tile_c"));
            if (!Number.isFinite(r) || !Number.isFinite(c)) continue;
            const auto = String(child.getAttribute("auto") || "0");
            const dirty = String(child.getAttribute("dirty") || "0");
            if (!(dirty === "1" || auto !== "1")) continue;
            const logicalGeo = childLogicalGeometryFromVisual(tg, child, rotationDeg);
            if (!logicalGeo) continue;
            tiles.push({
                r, c,
                x: logicalGeo.x, y: logicalGeo.y, w: logicalGeo.w, h: logicalGeo.h,
                auto,
                dirty,
                abbr: String(child.getAttribute("abbr") || ""),
                label: String(child.getAttribute("label") || "")
            });
        }
        if (!tiles.length && isCollapsedLOD(tg)) return readLodLayoutSnapshot(tg);
        return { v: 1, tiles: tiles };
    }

    function getPlantCircleBBoxLogical(tg) {
        const model = graph.getModel();
        const rotationDeg = getTilerRotationDeg(tg);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const childCount = model.getChildCount(tg);
        for (let i = 0; i < childCount; i++) {
            const child = model.getChildAt(tg, i);
            if (!model.isVertex(child) || !isPlantCircle(child)) continue;
            const cg = childLogicalGeometryFromVisual(tg, child, rotationDeg);
            if (!cg) continue;
            const x = Number(cg.x) || 0;
            const y = Number(cg.y) || 0;
            const w = Number(cg.w) || 0;
            const h = Number(cg.h) || 0;
            if (w <= 0 || h <= 0) continue;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x + w);
            maxY = Math.max(maxY, y + h);
        }
        if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return null;
        return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }

    function shiftPlantCircleChildrenLogical(tg, dx, dy) {
        if (nearlySameNumber(dx, 0) && nearlySameNumber(dy, 0)) return false;
        const model = graph.getModel();
        const rotationDeg = getTilerRotationDeg(tg);
        let changed = false;
        const childCount = model.getChildCount(tg);
        for (let i = 0; i < childCount; i++) {
            const child = model.getChildAt(tg, i);
            if (!model.isVertex(child) || !isPlantCircle(child)) continue;
            const logicalGeo = childLogicalGeometryFromVisual(tg, child, rotationDeg);
            if (!logicalGeo) continue;
            if ((Number(logicalGeo.w) || 0) <= 0 || (Number(logicalGeo.h) || 0) <= 0) continue;
            const next = visualGeometryFromLogicalGeometry(tg, {
                x: (Number(logicalGeo.x) || 0) + dx,
                y: (Number(logicalGeo.y) || 0) + dy,
                w: Number(logicalGeo.w) || 0,
                h: Number(logicalGeo.h) || 0
            });
            if (!next) continue;
            model.setGeometry(child, next);
            changed = true;
        }
        return changed;
    }

    function rotateVectorModel(vx, vy, angleRad) {
        const cos = Math.cos(angleRad);
        const sin = Math.sin(angleRad);
        return { x: vx * cos - vy * sin, y: vx * sin + vy * cos };
    }

    function positionGeometryForLocalPoint(next, localPoint, targetPoint, angleDeg) {
        if (!next || !localPoint || !targetPoint) return false;
        const centerOffset = {
            x: localPoint.x - (Number(next.width) || 0) / 2,
            y: localPoint.y - (Number(next.height) || 0) / 2
        };
        const rotatedOffset = rotateVectorModel(centerOffset.x, centerOffset.y, toRad(angleDeg));
        const groupCenter = { x: targetPoint.x - rotatedOffset.x, y: targetPoint.y - rotatedOffset.y };
        next.x = groupCenter.x - (Number(next.width) || 0) / 2;
        next.y = groupCenter.y - (Number(next.height) || 0) / 2;
        return true;
    }

    function modelPointForLocalPoint(geo, localPoint, angleDeg) {
        if (!geo || !localPoint) return null;
        const center = {
            x: (Number(geo.x) || 0) + (Number(geo.width) || 0) / 2,
            y: (Number(geo.y) || 0) + (Number(geo.height) || 0) / 2
        };
        const offset = rotateVectorModel(
            (Number(localPoint.x) || 0) - (Number(geo.width) || 0) / 2,
            (Number(localPoint.y) || 0) - (Number(geo.height) || 0) / 2,
            toRad(angleDeg)
        );
        return { x: center.x + offset.x, y: center.y + offset.y };
    }

    function positionGeometryForLocalPointAxisAware(next, localPoint, targetPoint, angleDeg, fitWidth, fitHeight, preservePoint) {
        if (!next || !localPoint || !targetPoint) return false;
        const preserved = preservePoint || modelPointForLocalPoint(next, localPoint, angleDeg);
        if (!preserved) return false;
        const angleRad = toRad(angleDeg);
        const centerLocal = rotateModelPoint(targetPoint, targetPoint, -angleRad);
        const preserveLocal = rotateModelPoint(preserved, targetPoint, -angleRad);
        const axisTargetLocal = {
            x: fitWidth ? centerLocal.x : preserveLocal.x,
            y: fitHeight ? centerLocal.y : preserveLocal.y
        };
        const axisTargetPoint = rotateModelPoint(axisTargetLocal, targetPoint, angleRad);
        return positionGeometryForLocalPoint(next, localPoint, axisTargetPoint, angleDeg);
    }

    function plantingFrameLocalCenter(width, height) {
        const w = Math.max(1, Number(width) || 1);
        const h = Math.max(1, Number(height) || 1);
        const bandPx = bedFitLabelBandPxForSize(w, h);
        const frameH = Math.max(0, h - GROUP_PADDING_PX * 2 - bandPx);
        return { x: w / 2, y: GROUP_PADDING_PX + bandPx + frameH / 2, bandPx: bandPx };
    }

    function buildAxisAwareTrimGeometry(tg, bed, bbox, fitWidth, fitHeight, finalWidth, finalHeight, bandPx) {
        const model = graph.getModel();
        const bedCenter = rectCenterModel(getModelRect(bed));
        const current = model.getGeometry(tg);
        if (!bedCenter || !current) return null;
        const next = current.clone();
        if (fitWidth) next.width = finalWidth;
        if (fitHeight) next.height = finalHeight;
        const localPlantCenter = {
            x: fitWidth ? GROUP_PADDING_PX + bbox.w / 2 : bbox.x + bbox.w / 2,
            y: fitHeight ? GROUP_PADDING_PX + bandPx + bbox.h / 2 : bbox.y + bbox.h / 2
        };
        positionGeometryForLocalPointAxisAware(next, localPlantCenter, bedCenter, getTilerRotationDeg(bed), fitWidth, fitHeight);
        return next;
    }

    function trimGroupToPlantFootprint(tg, bed, bbox, fitWidth, fitHeight, debugCtx) {
        if (tg && isCollapsedLOD(tg)) {
            bedFitLog("trim-skip", {
                txnId: debugCtx && debugCtx.txnId,
                groupId: bedFitCellId(tg),
                bedId: bedFitCellId(bed),
                reason: "lod-collapsed"
            });
            return false;
        }
        if (!tg || !bed || !bbox || bbox.w <= 0 || bbox.h <= 0) {
            bedFitLog("trim-skip", {
                txnId: debugCtx && debugCtx.txnId,
                groupId: bedFitCellId(tg),
                bedId: bedFitCellId(bed),
                reason: !bbox ? "missing-bbox" : "empty-bbox",
                bbox: bedFitRectSnapshot(bbox)
            });
            return false;
        }
        if (!fitWidth && !fitHeight) return false;
        const model = graph.getModel();
        const current = model.getGeometry(tg);
        if (!current) return false;
        const beforeGeo = bedFitGeometrySnapshot(tg);
        const beforeTiles = bedFitTileSample(tg, 6);
        const finalWidth = fitWidth ? Math.max(1, bbox.w + GROUP_PADDING_PX * 2) : current.width;
        const solved = fitHeight
            ? solveOuterHeightForPlantingFrame(bbox.h, finalWidth, current.height)
            : { outerHeight: current.height, bandPx: bedFitLabelBandPxForSize(finalWidth, current.height) };
        const next = buildAxisAwareTrimGeometry(tg, bed, bbox, fitWidth, fitHeight, finalWidth, solved.outerHeight, solved.bandPx);
        if (!next) return false;
        const dx = fitWidth ? GROUP_PADDING_PX - bbox.x : 0;
        const dy = fitHeight ? GROUP_PADDING_PX + solved.bandPx - bbox.y : 0;
        const childrenChanged = shiftPlantCircleChildrenLogical(tg, dx, dy);
        const groupChanged = !(nearlySameNumber(current.x, next.x) && nearlySameNumber(current.y, next.y) && nearlySameNumber(current.width, next.width) && nearlySameNumber(current.height, next.height));
        if (groupChanged) model.setGeometry(tg, next);
        bedFitLog("trim", {
            txnId: debugCtx && debugCtx.txnId,
            groupId: bedFitCellId(tg),
            bedId: bedFitCellId(bed),
            fitWidth,
            fitHeight,
            bbox: bedFitRectSnapshot(bbox),
            finalWidth: bedFitRound(finalWidth),
            finalHeight: bedFitRound(solved.outerHeight),
            bandPx: bedFitRound(solved.bandPx),
            dx: bedFitRound(dx),
            dy: bedFitRound(dy),
            childrenChanged,
            groupChanged,
            beforeGeo,
            afterGeo: bedFitGeometrySnapshot(tg),
            tables: {
                "tiles before trim": beforeTiles,
                "tiles after trim": bedFitTileSample(tg, 6)
            }
        });
        return childrenChanged || groupChanged;
    }

    function applyBedFitGeometry(tg, bed, allowDragIntoBedFit, debugCtx) {
        const ignoreBedAutoFit = !!(debugCtx && debugCtx.ignoreBedAutoFit);
        const persistAxisIntent = !!(debugCtx && debugCtx.persistAxisIntent);
        const usePersistedFitAxes = !!(debugCtx && debugCtx.usePersistedFitAxes);
        if (!tg || !bed || (!ignoreBedAutoFit && tg.getAttribute(BED_AUTO_FIT_ATTR) === "0")) {
            bedFitLog("fit-skip", {
                txnId: debugCtx && debugCtx.txnId,
                groupId: bedFitCellId(tg),
                bedId: bedFitCellId(bed),
                reason: !tg ? "missing-group" : (!bed ? "missing-bed" : "bed-auto-fit-disabled")
            });
            return null;
        }
        const model = graph.getModel();
        const tgRect = getModelRect(tg);
        const bedRect = getModelRect(bed);
        if (!tgRect || !bedRect || bedRect.w <= 0 || bedRect.h <= 0) {
            bedFitLog("fit-skip", {
                txnId: debugCtx && debugCtx.txnId,
                groupId: bedFitCellId(tg),
                bedId: bedFitCellId(bed),
                reason: "invalid-rect",
                groupRect: bedFitRectSnapshot(tgRect),
                bedRect: bedFitRectSnapshot(bedRect)
            });
            return null;
        }
        const diameter = getPlantCircleDiameterPx(tg);
        const overhang = allowedOverhangForDiameter(diameter);
        const frameRect = getPlantingFrameRectModel(tgRect);
        if (!frameRect) return null;
        const targetFrameWidth = bedRect.w + overhang * 2;
        const targetFrameHeight = bedRect.h + overhang * 2;
        const widthClose = Math.abs(frameRect.w - targetFrameWidth) <= bedRect.w * BED_FIT_TOLERANCE;
        const heightClose = Math.abs(frameRect.h - targetFrameHeight) <= bedRect.h * BED_FIT_TOLERANCE;
        const canDragFit = allowDragIntoBedFit && diameter < bedRect.w && diameter < bedRect.h;
        const forcedFitWidth = !!(debugCtx && debugCtx.forceFitWidth);
        const forcedFitHeight = !!(debugCtx && debugCtx.forceFitHeight);
        const fitWidth = usePersistedFitAxes ? forcedFitWidth : (widthClose || canDragFit);
        const fitHeight = usePersistedFitAxes ? forcedFitHeight : (heightClose || canDragFit);
        if (!fitWidth && !fitHeight) {
            if (persistAxisIntent) writeBedFitAxesNoTxn(model, tg, false, false);
            bedFitLog("fit-skip", {
                txnId: debugCtx && debugCtx.txnId,
                groupId: bedFitCellId(tg),
                bedId: bedFitCellId(bed),
                reason: "not-close-enough",
                allowDragIntoBedFit,
                diameter: bedFitRound(diameter),
                frameRect: bedFitRectSnapshot(frameRect),
                targetFrameWidth: bedFitRound(targetFrameWidth),
                targetFrameHeight: bedFitRound(targetFrameHeight),
                widthClose,
                heightClose,
                canDragFit,
                usePersistedFitAxes,
                forcedFitWidth,
                forcedFitHeight
            });
            return null;
        }
        const g = model.getGeometry(tg);
        if (!g) return null;
        const beforeGeo = bedFitGeometrySnapshot(tg);
        const beforeRotation = getTilerRotationDeg(tg);
        const beforeBandPx = groupLabelMetrics(tg).bandPx;
        const layoutSnapshot = captureBedFitLayoutSnapshot(tg);
        const next = g.clone();
        if (fitWidth) next.width = targetFrameWidth + GROUP_PADDING_PX * 2;
        if (fitHeight) {
            const solved = solveOuterHeightForPlantingFrame(targetFrameHeight, next.width, next.height);
            next.height = solved.outerHeight;
        }
        const bedRotation = getTilerRotationDeg(bed);
        const frameCenter = plantingFrameLocalCenter(next.width, next.height);
        const bedCenter = rectCenterModel(bedRect);
        positionGeometryForLocalPointAxisAware(next, frameCenter, bedCenter, bedRotation, fitWidth, fitHeight);
        const geometryChanged = !(nearlySameNumber(g.x, next.x) && nearlySameNumber(g.y, next.y) && nearlySameNumber(g.width, next.width) && nearlySameNumber(g.height, next.height));
        const rotationChanged = setCellRotationDeg(tg, bedRotation);
        if (persistAxisIntent) writeBedFitAxesNoTxn(model, tg, fitWidth, fitHeight);
        if (geometryChanged) model.setGeometry(tg, next);
        const afterBandPx = groupLabelMetrics(tg).bandPx;
        const bandDeltaY = (Number(afterBandPx) || 0) - (Number(beforeBandPx) || 0);
        shiftLayoutSnapshotByDeltaY(layoutSnapshot, bandDeltaY);
        bedFitLog("fit", {
            txnId: debugCtx && debugCtx.txnId,
            source: debugCtx && debugCtx.source,
            groupId: bedFitCellId(tg),
            bedId: bedFitCellId(bed),
            allowDragIntoBedFit,
            beforeGeo,
            afterGeo: bedFitGeometrySnapshot(tg),
            bedRect: bedFitRectSnapshot(bedRect),
            frameRect: bedFitRectSnapshot(frameRect),
            targetFrameWidth: bedFitRound(targetFrameWidth),
            targetFrameHeight: bedFitRound(targetFrameHeight),
            diameter: bedFitRound(diameter),
            overhang: bedFitRound(overhang),
            widthClose,
            heightClose,
            canDragFit,
            usePersistedFitAxes,
            forcedFitWidth,
            forcedFitHeight,
            fitWidth,
            fitHeight,
            beforeRotation: bedFitRound(beforeRotation),
            bedRotation: bedFitRound(bedRotation),
            afterRotation: bedFitRound(getTilerRotationDeg(tg)),
            beforeBandPx: bedFitRound(beforeBandPx),
            afterBandPx: bedFitRound(afterBandPx),
            bandDeltaY: bedFitRound(bandDeltaY),
            geometryChanged,
            rotationChanged,
            snapshotTiles: layoutSnapshot && Array.isArray(layoutSnapshot.tiles) ? layoutSnapshot.tiles.length : 0
        });
        return { changed: geometryChanged || rotationChanged, fitWidth: fitWidth, fitHeight: fitHeight, bed: bed, layoutSnapshot: layoutSnapshot, previousRotationDeg: beforeRotation };
    }

    function retileAfterBedFit(tg, debugCtx) {
        const beforeTiles = bedFitTileSample(tg, 6);
        const beforeChildCount = (graph.getChildVertices(tg) || []).length;
        const beforeGeo = bedFitGeometrySnapshot(tg);
        const beforeRotation = getTilerRotationDeg(tg);
        let threw = false;
        let errorMessage = "";
        try {
            retileGroup(graph, tg, {
                layoutSnapshot: debugCtx && debugCtx.layoutSnapshot,
                previousRotationDeg: debugCtx && debugCtx.previousRotationDeg,
                useLiveSnapshot: false,
                preferInPlace: true,
                inTransaction: true
            });
        } catch (e) {
            threw = true;
            errorMessage = e && e.message ? e.message : String(e);
            try { mxLog.debug("[BedFit] retile failed:", e && e.message ? e.message : e); } catch (_) { }
            graph.refresh(tg);
        }
        bedFitLog("retile", {
            txnId: debugCtx && debugCtx.txnId,
            source: debugCtx && debugCtx.source,
            groupId: bedFitCellId(tg),
            beforeGeo,
            afterGeo: bedFitGeometrySnapshot(tg),
            beforeRotation: bedFitRound(beforeRotation),
            afterRotation: bedFitRound(getTilerRotationDeg(tg)),
            previousRotationDeg: bedFitRound(debugCtx && debugCtx.previousRotationDeg),
            snapshotTiles: debugCtx && debugCtx.layoutSnapshot && Array.isArray(debugCtx.layoutSnapshot.tiles) ? debugCtx.layoutSnapshot.tiles.length : 0,
            beforeChildCount,
            afterChildCount: (graph.getChildVertices(tg) || []).length,
            lodCollapsed: isCollapsedLOD(tg),
            threw,
            errorMessage,
            tables: {
                "tiles before retile": beforeTiles,
                "tiles after retile": bedFitTileSample(tg, 6)
            }
        });
    }

    function finiteMoveDelta(value) {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }

    function normalizeMovedTilerGroupsToBeds(cells, opts) {
        const txnId = ++bedFitTxnSeq;
        const source = (opts && opts.source) || "unknown";
        if (bedFitInProgress) {
            bedFitLog("normalize-skip", { txnId, source, reason: "in-progress" });
            return 0;
        }
        const groups = getTilerGroupsFromEventCells(cells);
        const movedCells = (cells || []).filter(Boolean);
        if (!groups.length) {
            bedFitLog("normalize-skip", {
                txnId,
                source,
                reason: "no-groups",
                movedCellIds: movedCells.map(bedFitCellId)
            });
            return 0;
        }
        if (shouldSuppressBedFitResize(source, groups)) {
            bedFitLog("normalize-skip", {
                txnId,
                source,
                reason: "recent-bed-fit-resize",
                movedCellIds: movedCells.map(bedFitCellId),
                groupIds: groups.map(bedFitCellId)
            });
            return 0;
        }
        const model = graph.getModel();
        const allowDragIntoBedFit = !!(opts && opts.allowDragIntoBedFit);
        const skipSameBedMoveFit = !!(opts && opts.skipSameBedMoveFit);
        const persistAxisIntent = !!(opts && opts.persistAxisIntent);
        const clearFitAxisIntentOnNoBed = !!(opts && opts.clearFitAxisIntentOnNoBed);
        const moveDx = finiteMoveDelta(opts && opts.moveDx);
        const moveDy = finiteMoveDelta(opts && opts.moveDy);
        const changed = [];
        let trimmed = false;
        bedFitLog("normalize-start", {
            txnId,
            source,
            allowDragIntoBedFit,
            skipSameBedMoveFit,
            persistAxisIntent,
            clearFitAxisIntentOnNoBed,
            moveDx: bedFitRound(moveDx),
            moveDy: bedFitRound(moveDy),
            movedCellIds: movedCells.map(bedFitCellId),
            groupIds: groups.map(bedFitCellId)
        });
        bedFitInProgress = true;
        model.beginUpdate();
        try {
            for (const tg of groups) {
                const parent = model.getParent(tg);
                const center = rectCenterModel(getModelRect(tg));
                const bed = findSmallestContainingBedModel(parent, center);
                const previousCenter = center && moveDx != null && moveDy != null ? { x: center.x - moveDx, y: center.y - moveDy } : null;
                const previousBed = previousCenter ? findSmallestContainingBedModel(parent, previousCenter) : null;
                const sameBedMove = !!(skipSameBedMoveFit && bed && previousBed && previousBed.id === bed.id);
                bedFitLog("group-evaluate", {
                    txnId,
                    source,
                    groupId: bedFitCellId(tg),
                    parentId: bedFitCellId(parent),
                    currentBedId: bedFitCellId(bed),
                    previousBedId: bedFitCellId(previousBed),
                    center: center ? { x: bedFitRound(center.x), y: bedFitRound(center.y) } : null,
                    previousCenter: previousCenter ? { x: bedFitRound(previousCenter.x), y: bedFitRound(previousCenter.y) } : null,
                    groupGeo: bedFitGeometrySnapshot(tg),
                    groupRotation: bedFitRound(getTilerRotationDeg(tg)),
                    lodCollapsed: isCollapsedLOD(tg),
                    skipReason: sameBedMove ? "same-bed-move" : ""
                });
                if (sameBedMove) continue;
                if (!bed && persistAxisIntent && clearFitAxisIntentOnNoBed && tg.getAttribute(BED_AUTO_FIT_ATTR) !== "0") writeBedFitAxesNoTxn(model, tg, false, false);
                const fitResult = applyBedFitGeometry(tg, bed, allowDragIntoBedFit, { txnId, source, persistAxisIntent });
                if (fitResult) changed.push({
                    tg: tg,
                    bed: fitResult.bed,
                    fitWidth: fitResult.fitWidth,
                    fitHeight: fitResult.fitHeight,
                    bedFitChanged: !!fitResult.changed,
                    layoutSnapshot: fitResult.layoutSnapshot,
                    previousRotationDeg: fitResult.previousRotationDeg
                });
            }
            for (const item of changed) retileAfterBedFit(item.tg, {
                txnId,
                source,
                layoutSnapshot: item.layoutSnapshot,
                previousRotationDeg: item.previousRotationDeg
            });
            for (const item of changed) {
                const bbox = getPlantCircleBBoxLogical(item.tg);
                if (trimGroupToPlantFootprint(item.tg, item.bed, bbox, item.fitWidth, item.fitHeight, { txnId, source })) trimmed = true;
            }
        } finally {
            model.endUpdate();
            bedFitInProgress = false;
        }
        if (trimmed) {
            for (const item of changed) graph.refresh(item.tg);
        }
        if (trimmed || changed.some(item => item.bedFitChanged)) markBedFitResizeSuppression(changed);
        bedFitLog("normalize-end", {
            txnId,
            source,
            changedCount: changed.length,
            trimmed,
            tables: {
                "changed groups": changed.map(item => ({
                    groupId: bedFitCellId(item.tg),
                    bedId: bedFitCellId(item.bed),
                    fitWidth: item.fitWidth,
                    fitHeight: item.fitHeight,
                    bedFitChanged: item.bedFitChanged,
                    finalGeo: bedFitGeometrySnapshot(item.tg),
                    finalRotation: bedFitRound(getTilerRotationDeg(item.tg))
                }))
            }
        });
        return changed.length;
    }

    function normalizeMovedBedAssembliesToBeds(cells, opts) {
        const txnId = ++bedFitTxnSeq;
        const source = (opts && opts.source) || "unknown";
        const assemblies = getBedAssembliesFromEventCells(cells);
        if (!assemblies.length || bedFitInProgress || shouldSuppressBedFitResize(source, assemblies.map(function (assembly) { return { id: assembly.id }; }))) return 0;
        const model = graph.getModel();
        const fitOnDrag = !!(opts && opts.fitOnDrag);
        const skipSameBedMoveFit = !!(opts && opts.skipSameBedMoveFit);
        const persistAxisIntent = !!(opts && opts.persistAxisIntent);
        const clearFitAxisIntentOnNoBed = !!(opts && opts.clearFitAxisIntentOnNoBed);
        const moveDx = finiteMoveDelta(opts && opts.moveDx);
        const moveDy = finiteMoveDelta(opts && opts.moveDy);
        const changed = [];
        bedFitInProgress = true;
        model.beginUpdate();
        try {
            for (const assembly of assemblies) {
                if (!assembly || assembly.getAttribute(BED_AUTO_FIT_ATTR) === "0") continue;
                const parent = model.getParent(assembly);
                const bed = resolveBedForAssemblyGeometry(parent, assembly, null);
                const center = rectCenterModel(getModelRect(assembly));
                const previousCenter = center && moveDx != null && moveDy != null ? { x: center.x - moveDx, y: center.y - moveDy } : null;
                const previousBed = previousCenter ? findSmallestContainingBedModel(parent, previousCenter) : null;
                if (skipSameBedMoveFit && bed && previousBed && previousBed.id === bed.id) continue;
                if (!bed) {
                    if (persistAxisIntent && clearFitAxisIntentOnNoBed) writeBedFitAxesNoTxn(model, assembly, false, false);
                    continue;
                }
                const axes = fitOnDrag ? { fitWidth: true, fitHeight: true } : inferBedAssemblyFitAxes(assembly, bed);
                if (persistAxisIntent && !axes.fitWidth && !axes.fitHeight) {
                    if (syncBedAssemblyFitToBed(parent, assembly, bed, axes, { inTransaction: true })) changed.push({ assembly });
                    continue;
                }
                if (!axes.fitWidth && !axes.fitHeight) continue;
                if (syncBedAssemblyFitToBed(parent, assembly, bed, axes, { inTransaction: true })) changed.push({ assembly });
            }
        } finally {
            model.endUpdate();
            bedFitInProgress = false;
        }
        if (changed.length) markBedFitResizeSuppression(changed);
        for (const item of changed) graph.refresh(item.assembly);
        return changed.length;
    }

    function retileAndFitToContainingBed(graphArg, groupCell, opts) {
        const activeGraph = graphArg || graph;
        const source = (opts && opts.source) || "api-refit";
        const ownsTransaction = !(opts && opts.inTransaction);
        const txnId = opts && opts.txnId ? opts.txnId : ++bedFitTxnSeq;
        if (!activeGraph || !groupCell || !isTilerGroup(groupCell) || bedFitInProgress) {
            bedFitLog("retile-fit-skip", { txnId, source, groupId: bedFitCellId(groupCell), reason: "not-available", hasGraph: !!activeGraph, isTilerGroup: isTilerGroup(groupCell), bedFitInProgress });
            return { changed: false, fitted: false, reason: "not-available" };
        }
        const model = activeGraph.getModel();
        let fitResult = null;
        let trimmed = false;
        let result = { changed: false, fitted: false, reason: "" };
        bedFitLog("retile-fit-start", { txnId, source, groupId: bedFitCellId(groupCell), groupGeo: bedFitGeometrySnapshot(groupCell), ownsTransaction });
        bedFitInProgress = true;
        if (ownsTransaction) model.beginUpdate();
        try {
            retileGroup(activeGraph, groupCell, { preferInPlace: true, inTransaction: true });
            const parent = model.getParent(groupCell);
            const center = rectCenterModel(getModelRect(groupCell));
            const bed = findSmallestContainingBedModel(parent, center);
            bedFitLog("retile-fit-bed-resolve", { txnId, source, groupId: bedFitCellId(groupCell), parentId: bedFitCellId(parent), bedId: bedFitCellId(bed), center: center ? { x: bedFitRound(center.x), y: bedFitRound(center.y) } : null });
            if (!bed) { result = { changed: false, fitted: false, reason: "no-containing-bed" }; return result; }
            fitResult = applyBedFitGeometry(groupCell, bed, true, { txnId, source, ignoreBedAutoFit: true, persistAxisIntent: true });
            if (!fitResult) { result = { changed: false, fitted: false, reason: "fit-skipped", bed }; return result; }
            retileAfterBedFit(groupCell, {
                txnId,
                source,
                layoutSnapshot: fitResult.layoutSnapshot,
                previousRotationDeg: fitResult.previousRotationDeg
            });
            const bbox = getPlantCircleBBoxLogical(groupCell);
            trimmed = trimGroupToPlantFootprint(groupCell, fitResult.bed, bbox, fitResult.fitWidth, fitResult.fitHeight, { txnId, source });
            result = { changed: !!(fitResult.changed || trimmed), fitted: true, trimmed };
            return result;
        } finally {
            if (ownsTransaction) model.endUpdate();
            bedFitInProgress = false;
            if (fitResult && (trimmed || fitResult.changed)) markBedFitResizeSuppression([{ tg: groupCell }]);
            activeGraph.refresh(groupCell);
            bedFitLog("retile-fit-end", { txnId, source, groupId: bedFitCellId(groupCell), result, finalGeo: bedFitGeometrySnapshot(groupCell), trimmed, fitChanged: !!(fitResult && fitResult.changed) });
        }
    }


    const BOARD_KEY = 'KANBAN_BOARD'; // already in your other plugin; include here if not present 

    function isKanbanBoard(cell) {
        if (!cell) return false;
        if (!cell.getAttribute) {
            const st = getStyleSafe(cell);
            return st.includes(BOARD_KEY);
        }

        // XML attribute markers (adjust to match your kanban plugin if needed) 
        if (cell.getAttribute(BOARD_KEY) === "1") return true;
        if (cell.getAttribute("board_key") === BOARD_KEY) return true;
        if (cell.getAttribute("board_role") === BOARD_KEY) return true;

        // Style fallback 
        const st = getStyleSafe(cell);
        if (st.includes(BOARD_KEY)) return true;
        if (st.includes(`board_key=${BOARD_KEY}`)) return true;
        if (st.includes(`board_role=${BOARD_KEY}`)) return true;

        return false;
    }

    function findKanbanBoardAncestor(graph, cell) {
        const model = graph.getModel();
        let cur = cell;
        while (cur) {
            if (isKanbanBoard(cur)) return cur;
            cur = model.getParent(cur);
        }
        return null;
    }


    function isTypedObject(cell) {
        if (!cell || !cell.getAttribute) return false;

        // XML-attr types
        const typeAttrs = [
            "garden_module",
            "tiler_group",
            "garden_bed",
            "plant_tiler",
            "lod_summary",
        ];
        for (const a of typeAttrs) {
            if (cell.getAttribute(a) === "1") return true;
        }

        // Style-based types you already use
        const st = getStyleSafe(cell);
        if (st.includes("module=1")) return true;

        return false;
    }

    function isRegularVertexCandidateForBed(graph, cell) {
        if (!cell || !(cell.isVertex && cell.isVertex())) return false;
        if (cell.isEdge && cell.isEdge()) return false;
        if (isTypedObject(cell)) return false;

        if (isKanbanBoard(cell)) return false;
        if (findKanbanBoardAncestor(graph, cell)) return false;

        if (findTilerGroupAncestor(graph, cell)) return false; // prevent converting plant tiles/summaries etc.
        return true;
    }


    function addBedStyle(existingStyle) {
        const st = String(existingStyle || "");
        const add = [
            "dashed=1",
            "dashPattern=4 3",
            "strokeWidth=2",
            "fillColor=#A16207",
            "fillOpacity=35",
        ].join(";");

        return st
            ? (st.endsWith(";") ? st + add : st + ";" + add)
            : add;
    }


    function collectBedCandidates(graph, cells) {
        const out = [];
        const seen = new Set();
        for (const c of (cells || [])) {
            if (!c) continue;
            if (seen.has(c.id)) continue;
            seen.add(c.id);
            if (!isRegularVertexCandidateForBed(graph, c)) continue;
            out.push(c);
        }
        return out;
    }

    function isInsideGardenModule(graph, cell) {
        const mod = findModuleAncestor(graph, cell);
        return !!(mod && isGardenModule(mod));
    }

    function convertCellsToGardenBeds(graph, cells) {
        const model = graph.getModel();
        model.beginUpdate();
        try {
            const modulesToFix = new Map();

            for (const c of (cells || [])) {
                setCellAttrsNoTxn(model, c, { garden_bed: "1" });
                model.setStyle(c, addBedStyle(getStyleSafe(c)));

                const p = model.getParent(c);
                if (p && isGardenModule(p)) modulesToFix.set(p.id, p);
            }

            for (const m of modulesToFix.values()) {
                reorderModuleChildrenForLayering(model, m);
            }
        } finally {
            model.endUpdate();
        }
        for (const c of (cells || [])) graph.refresh(c);
    }

    function notifyTilerGroupCreated(graph, group, source, debugTxnId) {
        if (!graph || !group) return;
        const groupId = group.id || "";
        const txnId = debugTxnId || null;
        bedFitLog("created-event-schedule", { txnId, source: source || "", groupId: groupId || bedFitCellId(group) });
        setTimeout(function () {
            const model = graph.getModel && graph.getModel();
            const liveGroup = groupId && model && model.getCell ? model.getCell(groupId) : group;
            if (!liveGroup || !isTilerGroup(liveGroup)) {
                bedFitLog("created-event-skip", { txnId, source: source || "", groupId, reason: "missing-live-group" });
                return;
            }
            try {
                bedFitLog("created-event-fire", { txnId, source: source || "", groupId: bedFitCellId(liveGroup), groupGeo: bedFitGeometrySnapshot(liveGroup) });
                graph.fireEvent(new mxEventObject(TILER_GROUP_CREATED_EVENT, "cell", liveGroup, "cellId", liveGroup.id || groupId, "source", source || ""));
                bedFitLog("created-event-fired", { txnId, source: source || "", groupId: bedFitCellId(liveGroup) });
            } catch (e) {
                bedFitLog("created-event-error", { txnId, source: source || "", groupId: bedFitCellId(liveGroup), errorMessage: e && e.message ? e.message : String(e) });
            }
        }, 0);
    }

    function finalizeCreatedTilerGroup(graph, group, parent, source, debugTxnId) {
        if (!graph || !group) return null;
        const model = graph.getModel();
        const txnId = debugTxnId || ++bedFitTxnSeq;
        const debugSource = source || "tiler-created";
        let fitResult = null;
        let threw = false;
        let errorMessage = "";
        bedFitLog("finalize-created-start", { txnId, source: debugSource, groupId: bedFitCellId(group), parentId: bedFitCellId(parent), parentIsGardenModule: !!(parent && isGardenModule(parent)), groupGeo: bedFitGeometrySnapshot(group) });
        try {
            fitResult = retileAndFitToContainingBed(graph, group, { source: debugSource, inTransaction: true, txnId });
            if (parent && isGardenModule(parent)) reorderModuleChildrenForLayering(model, parent);
            graph.setSelectionCell(group);
            return group;
        } catch (e) {
            threw = true;
            errorMessage = e && e.message ? e.message : String(e);
            throw e;
        } finally {
            bedFitLog("finalize-created-end", { txnId, source: debugSource, groupId: bedFitCellId(group), fitResult, threw, errorMessage, finalGeo: bedFitGeometrySnapshot(group) });
        }
    }

    function createDefaultGardenBed(graph, moduleCell, clickX, clickY) {
        const dimsCm = getDefaultBedDimensionsCm(moduleCell);
        if (!dimsCm) throw new Error("Default bed dimensions are not set.");

        const modGeo = moduleCell.getGeometry && moduleCell.getGeometry();
        const gx = modGeo ? modGeo.x : 0;
        const gy = modGeo ? modGeo.y : 0;
        const gw = modGeo ? modGeo.width : toPx(dimsCm.widthCm);
        const gh = modGeo ? modGeo.height : toPx(dimsCm.lengthCm);
        const w = toPx(dimsCm.widthCm);
        const h = toPx(dimsCm.lengthCm);
        const localX = (typeof clickX === "number") ? (clickX - gx - w / 2) : (gw - w) / 2;
        const localY = (typeof clickY === "number") ? (clickY - gy - h / 2) : (gh - h) / 2;
        const relX = Math.max(0, Math.min(gw - w, localX));
        const relY = Math.max(0, Math.min(gh - h, localY));
        const bedVal = createXmlValue("GardenBed", { label: "Garden Bed", garden_bed: "1" });
        const bed = new mxCell(bedVal, new mxGeometry(relX, relY, w, h), addBedStyle("shape=rectangle;whiteSpace=wrap;html=1"));
        bed.setVertex(true);
        bed.setConnectable(false);

        const model = graph.getModel();
        model.beginUpdate();
        try {
            graph.addCell(bed, moduleCell);
            graph.setSelectionCell(bed);
            reorderModuleChildrenForLayering(model, moduleCell);
        } finally {
            model.endUpdate();
        }
        graph.refresh(bed);
        return bed;
    }


    /**
     * Creates an empty tiler group inside the given garden module.
     * - No plant is preselected.
     * - Defaults spacing to 30 cm (both axes).
     * - Centers a 240x240 group within the module bounds.
     */
    function createEmptyTilerGroup(graph, moduleCell, clickX, clickY, opts = {}) {
        const DEFAULT_GROUP_PX = 240;
        const spacingCm = 30;

        const modGeo = moduleCell.getGeometry && moduleCell.getGeometry();
        const gx = modGeo ? modGeo.x : 0;                                           // absolute module x
        const gy = modGeo ? modGeo.y : 0;                                           // absolute module y
        const gw = modGeo ? modGeo.width : DEFAULT_GROUP_PX;
        const gh = modGeo ? modGeo.height : DEFAULT_GROUP_PX;

        const w = DEFAULT_GROUP_PX;
        const h = DEFAULT_GROUP_PX;

        // Convert click (graph coords) -> local coords in module
        const localX = (typeof clickX === "number") ? (clickX - gx - w / 2) : (gw - w) / 2;
        const localY = (typeof clickY === "number") ? (clickY - gy - h / 2) : (gh - h) / 2;

        // Clamp inside module bounds
        const relX = Math.max(0, Math.min(gw - w, localX));
        const relY = Math.max(0, Math.min(gh - h, localY));

        const seasonStartYear = getCurrentGardenYear(moduleCell);

        const groupVal = createXmlValue("TilerGroup", {
            label: "New Plant Group",
            tiler_group: "1",
            season_start_year: String(seasonStartYear),

            spacing_cm: String(spacingCm),
            spacing_x_cm: String(spacingCm),
            spacing_y_cm: String(spacingCm),
            veg_diameter_cm: "",
            yield_per_plant_kg: "",
            yield_unit: YIELD_UNIT,
            plant_count: "0",
            planting_expected_yield_kg: "0",
            planting_actual_yield_kg: "0"
        });

        // Note: child geometry should be RELATIVE to parent module
        const geo = new mxGeometry(relX, relY, w, h);
        const group = new mxCell(groupVal, geo, groupFrameStyle());
        group.setVertex(true);
        group.setConnectable(false);
        group.setCollapsed(false);

        const model = graph.getModel();
        const creationSource = (opts && opts.source) || "empty-group";
        const creationTxnId = ++bedFitTxnSeq;
        let threw = false;
        let errorMessage = "";
        bedFitLog("create-empty-start", { txnId: creationTxnId, source: creationSource, moduleId: bedFitCellId(moduleCell), clickX: bedFitRound(clickX), clickY: bedFitRound(clickY), localX: bedFitRound(localX), localY: bedFitRound(localY), relX: bedFitRound(relX), relY: bedFitRound(relY), groupId: bedFitCellId(group), groupGeo: bedFitGeometrySnapshot(group) });
        model.beginUpdate();
        try {
            graph.addCell(group, moduleCell);
            finalizeCreatedTilerGroup(graph, group, moduleCell, creationSource, creationTxnId);
        } catch (e) {
            threw = true;
            errorMessage = e && e.message ? e.message : String(e);
            throw e;
        } finally {
            model.endUpdate();
            bedFitLog("create-empty-end", { txnId: creationTxnId, source: creationSource, moduleId: bedFitCellId(moduleCell), groupId: bedFitCellId(group), finalGeo: bedFitGeometrySnapshot(group), threw, errorMessage });
        }
        notifyTilerGroupCreated(graph, group, creationSource, creationTxnId);
        bedFitLog("create-empty-notify-scheduled", { txnId: creationTxnId, source: creationSource, groupId: bedFitCellId(group) });
        return group;
    }

    // ---------- Debug helpers (compact, JSON-safe) ----------
    function dbgAttrMap(cell) {
        const out = {};
        const v = cell && cell.value;
        if (v && v.attributes) {
            for (let i = 0; i < v.attributes.length; i++) {
                const a = v.attributes[i];
                out[a.nodeName] = a.nodeValue;
            }
        }
        return out;
    }

    function dbgCellInfo(cell) {
        if (!cell) return { cell: false };
        const g = cell.getGeometry ? cell.getGeometry() : null;
        return {
            id: cell.id || null,
            tag: (cell.value && cell.value.nodeName) || "",
            attrs: dbgAttrMap(cell),
            style: cell.style || "",
            vertex: !!(cell.isVertex && cell.isVertex()),
            edge: !!(cell.isEdge && cell.isEdge()),
            geo: g ? { x: g.x, y: g.y, w: g.width, h: g.height } : null,
        };
    }

    function showSpacingDialog(ui, curX, curY, onOk) {
        const div = document.createElement("div");
        div.style.padding = "10px";
        div.style.minWidth = "280px";

        const title = document.createElement("div");
        title.style.fontWeight = "600";
        title.style.marginBottom = "8px";
        title.textContent = "Set Plant Spacing (cm)";
        div.appendChild(title);

        const row = (labelTxt, init) => {
            const wrap = document.createElement("div");
            wrap.style.display = "flex";
            wrap.style.alignItems = "center";
            wrap.style.gap = "8px";
            wrap.style.marginBottom = "8px";
            const lab = document.createElement("label");
            lab.textContent = labelTxt;
            lab.style.minWidth = "120px";
            const inp = document.createElement("input");
            inp.type = "number";
            inp.step = "0.1";
            inp.min = "0.1";
            inp.style.flex = "1";
            inp.value = String(init);
            wrap.appendChild(lab);
            wrap.appendChild(inp);
            div.appendChild(wrap);
            return inp;
        };

        const inputX = row("Horizontal spacing X:", curX);
        const inputY = row("Vertical spacing Y:", curY);

        const btnRow = document.createElement("div");
        btnRow.style.display = "flex";
        btnRow.style.justifyContent = "flex-end";
        btnRow.style.gap = "8px";

        const okBtn = tilerButton("OK", function () {
            const x = Number(inputX.value),
                y = Number(inputY.value);
            if (!isFinite(x) || !isFinite(y) || x <= 0 || y <= 0) {
                log("[spacing] invalid " + JSON.stringify({ x, y }));
                return;
            }
            ui.hideDialog();
            onOk(x, y);
        }, "neutral");
        const cancelBtn = tilerButton("Cancel", function () {
            ui.hideDialog();
        }, "neutral");
        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(okBtn);
        div.appendChild(btnRow);

        // Enter/Escape keys
        mxEvent.addListener(div, "keydown", function (evt) {
            if (evt.key === "Enter") {
                okBtn.click();
            }
            if (evt.key === "Escape") {
                ui.hideDialog();
            }
        });

        ui.showDialog(div, 360, 170, true, true);
        elevateTrellisDialog();
        inputX.focus();
    }

    function runSetGroupSpacingOn(graph, groupCell) {
        if (!groupCell || !isTilerGroup(groupCell)) {
            log("[spacing] not a tiler group");
            return;
        }
        const curX = Number(
            getXmlAttr(
                groupCell,
                "spacing_x_cm",
                getXmlAttr(groupCell, "spacing_cm", "30")
            )
        );
        const curY = Number(
            getXmlAttr(
                groupCell,
                "spacing_y_cm",
                getXmlAttr(groupCell, "spacing_cm", "30")
            )
        );

        showSpacingDialog(ui, curX, curY, function (x, y) {
            const model = graph.getModel();
            model.beginUpdate();
            try {
                setCellAttrsNoTxn(model, groupCell, {
                    spacing_x_cm: String(x),
                    spacing_y_cm: String(y),
                });
                retileGroup(graph, groupCell);
            } finally {
                model.endUpdate();
            }
            graph.refresh(groupCell);

            log("[spacing] applied " + JSON.stringify({ x, y }));
        });
    }

    function collectSelectedPlantTilesByGroup(graph, fallbackTarget) {
        const sel = graph.getSelectionCells ? (graph.getSelectionCells() || []) : [];
        const out = new Map(); // groupId -> { group, tiles: [] }

        function addTile(tile) {
            if (!tile || !isPlantCircle(tile)) return;
            if (!hasTileRC(tile)) return; // require row/col
            const g = findTilerGroupAncestor(graph, tile);
            if (!g) return;
            if (!out.has(g.id)) out.set(g.id, { group: g, tiles: [] });
            out.get(g.id).tiles.push(tile);
        }

        for (const c of sel) addTile(c);

        // If selection contains no tiles, try hit/target cell                              
        if (out.size === 0 && fallbackTarget) addTile(fallbackTarget);

        return Array.from(out.values());
    }

    function groupHasDisabled(groupCell) {
        const set = readDisabledSet(groupCell);
        return set.size > 0;
    }

    function disableTilesInGroup(graph, groupCell, tileCells) {
        if (!groupCell || !isTilerGroup(groupCell)) return;
        const model = graph.getModel();

        const disabledSet = readDisabledSet(groupCell);
        let added = 0;

        // Track exact tiles to remove (only those newly disabled)
        const newlyDisabled = new Set();

        for (const t of (tileCells || [])) {
            if (!t || !isPlantCircle(t) || !hasTileRC(t)) continue;
            const r = Number(t.getAttribute("tile_r"));
            const c = Number(t.getAttribute("tile_c"));
            if (!Number.isFinite(r) || !Number.isFinite(c)) continue;

            const key = `${r},${c}`;
            if (!disabledSet.has(key)) {
                disabledSet.add(key);
                newlyDisabled.add(key);
                added++;
            }
        }
        if (!added) return;

        model.beginUpdate();
        try {
            writeDisabledSet(model, groupCell, disabledSet);

            // Remove only tiles that correspond to newly-disabled keys
            const toRemove = [];
            for (const t of (tileCells || [])) {
                if (!t || !isPlantCircle(t) || !hasTileRC(t)) continue;
                const key = `${t.getAttribute("tile_r")},${t.getAttribute("tile_c")}`;
                if (newlyDisabled.has(key)) toRemove.push(t);
            }
            if (toRemove.length) clearChildren(graph, groupCell, toRemove);

            // Update counts/yield to reflect disabled tiles (no full re-tile)
            const abbr = groupCell.getAttribute("plant_abbr") || "?";
            const spacingXcm = Number(groupCell.getAttribute("spacing_x_cm") ||
                groupCell.getAttribute("spacing_cm") || "30");
            const spacingYcm = Number(groupCell.getAttribute("spacing_y_cm") ||
                groupCell.getAttribute("spacing_cm") || "30");
            const spacingXpx = toPx(spacingXcm);
            const spacingYpx = toPx(spacingYcm);

            const { rows, cols, count } = computeGridStatsXY(groupCell, spacingXpx, spacingYpx);
            pruneDisabledToGrid(model, groupCell, rows, cols);
            const disabledSet2 = readDisabledSet(groupCell);
            const { actual } = applyCounts(model, groupCell, count, disabledSet2);
            updateGroupYield(model, groupCell, { abbr, countOverride: actual });
        } finally {
            model.endUpdate();
        }

        graph.refresh(groupCell);
    }

    function restoreTilesInGroup(graph, groupCell) {
        if (!groupCell || !isTilerGroup(groupCell)) return;
        const model = graph.getModel();
        const set = readDisabledSet(groupCell);
        if (!set.size) return;

        model.beginUpdate();
        try {
            writeDisabledSet(model, groupCell, new Set());
        } finally {
            model.endUpdate();
        }

        const abbr = groupCell.getAttribute("plant_abbr") || "?";
        const spacingXcm = Number(groupCell.getAttribute("spacing_x_cm") || groupCell.getAttribute("spacing_cm") || "30");
        const spacingYcm = Number(groupCell.getAttribute("spacing_y_cm") || groupCell.getAttribute("spacing_cm") || "30");
        const spacingXpx = toPx(spacingXcm);
        const spacingYpx = toPx(spacingYcm);

        if (isCollapsedLOD(groupCell)) {
            collapseToSummary(graph, groupCell, abbr, spacingXpx, spacingYpx);
            graph.refresh(groupCell);
            return;
        }

        // Restore expanded: simplest correct option is rebuild once                              
        retileGroup(graph, groupCell, { forceExpand: true });
        graph.refresh(groupCell);
    }



    // ---------- Popup menu: register deterministic Trellis contributor ----------
    if (graph && graph.popupMenuHandler) {
        graph.popupMenuHandler.selectOnPopup = false;
        log("Registering ordered popup contributor");

        function registerTrellisContextMenuContributor(contributor) {
            function finishRegistration() {
                if (!window.TrellisContextMenu) return;
                window.TrellisContextMenu.install(ui);
                window.TrellisContextMenu.register(contributor);
            }

            if (window.TrellisContextMenu) {
                finishRegistration();
            } else if (typeof mxscript === "function") {
                mxscript("plugins/garden_planner_plugins/Trellis_Context_Menu.js", finishRegistration);
            }
        }

        // Helpers must be defined BEFORE factoryMethod uses them
        function hitTestCell(evt) {
            try {
                const pt = mxUtils.convertPoint(graph.container, evt.clientX, evt.clientY);
                const s = graph.view.scale,
                    tr = graph.view.translate;
                const gx = pt.x / s - tr.x,
                    gy = pt.y / s - tr.y;
                const hit = graph.getCellAt(gx, gy);
                log("[hitTest] " + JSON.stringify({ clientX: evt.clientX, clientY: evt.clientY, gx, gy, s, tr: { x: tr.x, y: tr.y } }));
                return hit;
            } catch (e) {
                log("[hitTest] error " + e.message);
                return null;
            }
        }

        function resolveTarget(cell, evt) {
            const byParam = cell || null;
            const byHit = evt ? hitTestCell(evt) : null;
            const bySel = graph.getSelectionCell() || null;
            let t = byParam || byHit || bySel;
            if (t && !isTilerGroup(t)) {
                const parentGroup = findTilerGroupAncestor(graph, t);
                if (parentGroup) t = parentGroup;
            }
            log("[popup] cells " + JSON.stringify({ byParam: dbgCellInfo(byParam), byHit: dbgCellInfo(byHit), bySel: dbgCellInfo(bySel), target: dbgCellInfo(t) }));
            return t;
        }

        function resolveModuleTarget(cell, evt) {
            const byParam = cell || null;
            const byHit = evt ? hitTestCell(evt) : null;
            const bySel = graph.getSelectionCell() || null;
            const cand = byParam || byHit || bySel;
            const t = cand ? findModuleAncestor(graph, cand) : null;
            log("[popup][module] cand=" + JSON.stringify(dbgCellInfo(cand)) + " -> target=" + JSON.stringify(dbgCellInfo(t)));
            return t;
        }

        function collectSelectedTilerGroups(graph, fallbackTarget) {
            const sel = graph.getSelectionCells ? (graph.getSelectionCells() || []) : [];
            const out = new Map();

            function addIfGroup(c) {
                if (!c) return;
                const g = isTilerGroup(c) ? c : findTilerGroupAncestor(graph, c);
                if (g && g.id) out.set(g.id, g);
            }

            // Include selection-derived groups                                              
            for (const c of sel) addIfGroup(c);

            // Fallback: if selection has no groups, use the target under cursor             
            if (out.size === 0) addIfGroup(fallbackTarget);

            return Array.from(out.values());
        }

        function selectionGroupState(groups) {
            let anyCollapsed = false;
            let anyExpanded = false;
            for (const g of groups) {
                const collapsed = isCollapsedLOD(g);
                if (collapsed) anyCollapsed = true;
                else anyExpanded = true;
                if (anyCollapsed && anyExpanded) break;
            }
            return { anyCollapsed, anyExpanded };
        }


        registerTrellisContextMenuContributor({
            id: "plantTiler",
            priority: 300,
            addItems: function (menu, cell, evt) {
                log("[popup] start " + JSON.stringify({ orderedContributor: true }));

                // ----- Tiler group item -----
                const target = resolveTarget(cell, evt);
                if (target && isTilerGroup(target)) {
                    const curX = Number(
                        getXmlAttr(
                            target,
                            "spacing_x_cm",
                            getXmlAttr(target, "spacing_cm", "30")
                        )
                    );
                    const curY = Number(
                        getXmlAttr(
                            target,
                            "spacing_y_cm",
                            getXmlAttr(target, "spacing_cm", "30")
                        )
                    );
                    const label = `Set Plant Spacing (cm)…  [${curX} × ${curY}]`;
                    log("[popup] adding spacing item " + JSON.stringify({ curX, curY }));
                    menu.addItem(label, null, function () {
                        try {
                            const act = ui.actions.get("setGroupSpacing");
                            if (act && typeof act.funct === "function") {
                                log("[popup] invoking action setGroupSpacing");
                                act.funct();
                            } else {
                                log("[popup] action missing; using direct invoker");
                                runSetGroupSpacingOn(graph, target);
                            }
                        } catch (e) {
                            log("[popup] action error " + e.message);
                        }
                    });
                } else {
                    log("[popup] no tiler group under cursor");
                }

                // ----- MODULE CONTEXT MENU -----
                const targetMod = resolveModuleTarget(cell, evt);

                // -------------------- Garden Beds (selection-aware) --------------------
                try {
                    const sel = graph.getSelectionCells ? (graph.getSelectionCells() || []) : [];
                    const validSel = collectBedCandidates(graph, sel).filter(c => isInsideGardenModule(graph, c));

                    // Prefer multi-selection when it yields 2+ valid targets
                    if (validSel.length >= 2) {
                        menu.addItem(`Convert to Garden Beds (${validSel.length})`, null, function () {
                            try {
                                convertCellsToGardenBeds(graph, validSel);
                            } catch (e) {
                                mxUtils.alert("Error converting to garden beds: " + e.message);
                            }
                        });
                    } else {
                        // Single selection or fallback to hit cell
                        const hit = evt ? hitTestCell(evt) : cell;
                        const hitOk = hit &&
                            isInsideGardenModule(graph, hit) &&
                            isRegularVertexCandidateForBed(graph, hit);

                        if (validSel.length === 1) {
                            menu.addItem("Convert to Garden Bed", null, function () {
                                try {
                                    convertCellsToGardenBeds(graph, validSel);
                                } catch (e) {
                                    mxUtils.alert("Error converting to garden bed: " + e.message);
                                }
                            });
                        } else if (hitOk) {
                            menu.addItem("Convert to Garden Bed", null, function () {
                                try {
                                    convertCellsToGardenBeds(graph, [hit]);
                                } catch (e) {
                                    mxUtils.alert("Error converting to garden bed: " + e.message);
                                }
                            });
                        }
                    }
                } catch (_) { }


                // ----- Expand/Collapse (selection-aware) ---------------------------------- 
                const selectedGroups = collectSelectedTilerGroups(graph, target);
                const n = selectedGroups.length;
                const noun = n > 1 ? "plantings" : "planting";


                // ----- Trim to Garden Bed (selection-aware) --------------------------------------- 
                try {
                    const candidates = [];
                    for (const g of selectedGroups) {
                        const mod = findGardenModuleAncestor(graph, g);
                        if (!mod) continue;
                        const mg = mod.getGeometry && mod.getGeometry();
                        const gg = g.getGeometry && g.getGeometry();
                        if (!mg || !gg) continue;

                        // Quick eligibility check: bed under group center (shape hit-test). 
                        const cx = mg.x + gg.x + gg.width / 2;
                        const cy = mg.y + gg.y + gg.height / 2;
                        const bed = bedAtGraphPoint(graph, mod, cx, cy);
                        if (bed && isGardenBed(bed)) candidates.push(g);
                    }

                    if (candidates.length) {
                        menu.addItem(`Trim to Garden Bed (${candidates.length})`, null, function () {
                            const model = graph.getModel();
                            let totalRemoved = 0;
                            let trimmedGroups = 0;

                            model.beginUpdate();
                            try {
                                for (const g of candidates) {
                                    const r = trimGroupToSingleGardenBed(graph, g);
                                    if (!r.skipped) trimmedGroups++;
                                    totalRemoved += (r.removed || 0);
                                }
                            } finally {
                                model.endUpdate();
                            }

                            // Keep selection stable; refresh is already done per group. 
                            log(`[trim] groups=${trimmedGroups}/${candidates.length} removed=${totalRemoved}`);
                        });
                    }
                } catch (_) { }

                if (selectedGroups.length) {
                    const st = selectionGroupState(selectedGroups);

                    if (st.anyCollapsed) {
                        menu.addItem(`Expand ${noun}`, null, function () {
                            const model = graph.getModel();
                            model.beginUpdate();
                            try {
                                for (const g of selectedGroups) {
                                    retileGroup(graph, g, { forceExpand: true });
                                    graph.refresh(g); // refresh each
                                }
                            } finally {
                                model.endUpdate();
                            }
                        });
                    }

                    if (st.anyExpanded) {
                        menu.addItem(`Collapse ${noun}`, null, function () {
                            const model = graph.getModel();
                            model.beginUpdate();
                            try {
                                for (const g of selectedGroups) {
                                    retileGroup(graph, g, { forceCollapse: true });
                                    graph.refresh(g); // refresh each
                                }
                            } finally {
                                model.endUpdate();
                            }
                        });
                    }
                }

                // ----- Disable/Restore plant circles (selection-aware) ----------------------------- 
                try {
                    const hit = evt ? hitTestCell(evt) : cell;
                    const tileGroups = collectSelectedPlantTilesByGroup(graph, hit);

                    // Disable: only if we have at least one tile selected                               
                    if (tileGroups.length) {
                        const totalTiles = tileGroups.reduce((s, x) => s + (x.tiles?.length || 0), 0);
                        if (totalTiles > 0) {
                            menu.addItem(`Disable plant circles (${totalTiles})`, null, function () {
                                const model = graph.getModel();
                                model.beginUpdate();
                                try {
                                    for (const tg of tileGroups) {
                                        disableTilesInGroup(graph, tg.group, tg.tiles);
                                    }
                                } finally {
                                    model.endUpdate();
                                }
                            });
                        }
                    }

                    // Restore: if any selected/target tiler groups have disabled tiles                   
                    const groupsForRestore = collectSelectedTilerGroups(graph, target);
                    const restorable = groupsForRestore.filter(g => groupHasDisabled(g));
                    if (restorable.length) {
                        const noun2 = restorable.length > 1 ? "plantings" : "planting";
                        menu.addItem(`Restore plant circles (${noun2})`, null, function () {
                            const model = graph.getModel();
                            model.beginUpdate();
                            try {
                                for (const g of restorable) restoreTilesInGroup(graph, g);
                            } finally {
                                model.endUpdate();
                            }
                        });
                    }
                } catch (_) { }

                if (targetMod && isGardenModule(targetMod)) {
                    menu.addItem("Garden Settings…", null, async function () {
                        if (openGardenSettingsDialogWithOverlaySuppressed) {
                            await openGardenSettingsDialogWithOverlaySuppressed(targetMod);
                        } else {
                            await showGardenSettingsDialog(ui, graph, targetMod);
                        }
                    });
                }

                // --- Add New Plant Group (requires garden settings) ----------------------------------
                if (targetMod && isGardenModule(targetMod)) {
                    if (hasGardenSettingsSet(targetMod)) {
                        menu.addItem("Add New Plant Group", null, function () {
                            try {
                                const pt = graph.getPointForEvent(evt);
                                createEmptyTilerGroup(graph, targetMod, pt.x, pt.y);
                                log("[module] empty tiler group created");
                            } catch (e) {
                                mxUtils.alert("Error creating tiler group: " + e.message);
                            }
                        });
                    } else {
                        // Disabled hint (non-clickable)
                        menu.addItem("Set garden settings to add plants", null, function () { }, null, null, false);
                    }
                }
            }
        });

        log("Popup contributor registered " + JSON.stringify({ hasPopup: !!graph.popupMenuHandler, hasAction: !!ui.actions.get("setGroupSpacing") }));
    } else {
        log("popupMenuHandler not available");
    }

    // -------------------- Group wrapping & events --------------------
    function isPlantCircle(cell) {
        return !!cell && cell.getAttribute && cell.getAttribute("plant_tiler") === "1";
    }

    function isTilerGroup(cell) {
        const ok = !!cell && cell.getAttribute && cell.getAttribute("tiler_group") === "1";
        return ok;
    }

    function getNumberAttr(cell, name, def = 0) {
        const v = cell && cell.getAttribute ? cell.getAttribute(name) : null;
        const n = Number(v);
        return Number.isFinite(n) ? n : def;
    }

    function formatYield(value, unit) {
        // Simple formatting: keep three sig figs for small numbers
        if (!Number.isFinite(value)) return `0 ${unit}`;
        const abs = Math.abs(value);
        const s =
            abs >= 10 ? value.toFixed(1) : abs >= 1 ? value.toFixed(2) : value.toFixed(3);
        return `${s} ${unit}`;
    }

    let WRAP_GUARD = false; // re-entrancy guard

    function createTilerGroupFromCircle(graph, circleCells) {
        if (!circleCells || circleCells.length === 0) return null;

        const model = graph.getModel();
        const first = circleCells[0];

        const parent = model.getParent(first) || graph.getDefaultParent();

        const moduleCell = findGardenModuleAncestor(graph, parent);
        const seasonStartYear = moduleCell ? getCurrentGardenYear(moduleCell) : getCurrentCalendarYear();

        // Assumption: all circles share the same parent after the move.                                   
        // If not, bucket before calling this function.                                                    

        // Use first circle as metadata source                                                             
        const abbr = first.getAttribute("abbr") || "?";
        const plantId = first.getAttribute("plant_id") || "";
        const plantName = first.getAttribute("plant_name") || "";
        const varietyName = first.getAttribute("variety_name") || "";

        const titleName = (varietyName && plantName)
            ? `${plantName} - ${varietyName}`
            : (plantName || abbr || "?");

        const spacingCm = first.getAttribute("spacing_cm") || "30";
        const spacingXcm = first.getAttribute("spacing_x_cm") || spacingCm;
        const spacingYcm = first.getAttribute("spacing_y_cm") || spacingCm;
        const vegDiamCm = first.getAttribute("veg_diameter_cm") || "";
        const plantYield = first.getAttribute("yield_per_plant_kg") || "";
        const yieldUnit = first.getAttribute("yield_unit") || YIELD_UNIT;

        // Compute bounding box in PARENT coordinates                                                      
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const c of circleCells) {
            const g = c.getGeometry();
            if (!g) continue;
            minX = Math.min(minX, g.x);
            minY = Math.min(minY, g.y);
            maxX = Math.max(maxX, g.x + g.width);
            maxY = Math.max(maxY, g.y + g.height);
        }
        if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return null;

        const pad = GROUP_PADDING_PX;
        const groupX = Math.max(0, minX - pad);
        const groupY = Math.max(0, minY - pad);
        const groupW = (maxX - minX) + pad * 2;
        const rawH = (maxY - minY) + pad * 2;

        const tmp = { getGeometry: () => ({ width: groupW, height: rawH }) };
        const { bandPx } = groupLabelMetrics(tmp);
        const groupH = rawH + bandPx;

        const groupVal = createXmlValue("TilerGroup", {
            label: `${titleName}`,
            tiler_group: "1",
            season_start_year: String(seasonStartYear),
            
            plant_abbr: abbr,
            plant_id: plantId,
            plant_name: plantName,
            variety_name: varietyName,
            spacing_cm: spacingCm,
            spacing_x_cm: spacingXcm,
            spacing_y_cm: spacingYcm,
            veg_diameter_cm: vegDiamCm,
            yield_per_plant_kg: plantYield,
            yield_unit: yieldUnit,
            plant_count: String(circleCells.length),
            planting_expected_yield_kg: "0",
            planting_actual_yield_kg: "0"
        });

        const group = new mxCell(groupVal, new mxGeometry(groupX, groupY, groupW, groupH), groupFrameStyle());
        group.setVertex(true);
        group.setConnectable(false);
        group.setCollapsed(false);

        model.beginUpdate();
        try {
            graph.addCell(group, parent);

            // Move circles into group; convert to GROUP-RELATIVE coordinates
            for (const c of circleCells) {
                const cg = c.getGeometry();
                if (!cg) continue;

                const local = cg.clone();
                local.x = cg.x - groupX;
                local.y = (cg.y - groupY) + bandPx;

                model.setGeometry(c, local);
                graph.addCell(c, group);
            }
            finalizeCreatedTilerGroup(graph, group, parent, "plant-circle-wrap");
        } finally {
            model.endUpdate();
        }
        notifyTilerGroupCreated(graph, group, "plant-circle-wrap");
        return group;
    }

    function createSiblingTilerGroupFromSource(graphArg, sourceCell, opts = {}) {
        const activeGraphArg = graphArg || graph;
        if (!activeGraphArg || !sourceCell || !isTilerGroup(sourceCell)) return null;
        const model = activeGraphArg.getModel && activeGraphArg.getModel();
        if (!model) return null;
        const parent = model.getParent(sourceCell);
        if (!parent) return null;
        const sourceGeo = sourceCell.getGeometry && sourceCell.getGeometry();
        if (!sourceGeo) return null;
        const creationSource = String(opts.source || 'derived-sibling');
        const attrs = Object.assign({}, opts.attributes || {}, { tiler_group: "1" });
        const value = cloneXmlValueWithAttrs(sourceCell, attrs);
        const style = typeof sourceCell.getStyle === "function" ? sourceCell.getStyle() : sourceCell.style;
        const geometry = sourceGeo.clone ? sourceGeo.clone() : new mxGeometry(sourceGeo.x, sourceGeo.y, sourceGeo.width, sourceGeo.height);
        const offsetCm = opts.layoutOffsetCm || opts.offsetCm || null;
        const offsetXPx = Number.isFinite(Number(offsetCm && offsetCm.x)) ? toPx(Number(offsetCm.x)) : 0;
        const offsetYPx = Number.isFinite(Number(offsetCm && offsetCm.y)) ? toPx(Number(offsetCm.y)) : 0;
        let placementWarning = "";
        if (offsetXPx || offsetYPx) {
            const parentGeo = parent.getGeometry && parent.getGeometry();
            geometry.x = Number(geometry.x || 0) + offsetXPx;
            geometry.y = Number(geometry.y || 0) + offsetYPx;
            if (parentGeo) {
                const maxX = Math.max(0, Number(parentGeo.width || 0) - Number(geometry.width || 0));
                const maxY = Math.max(0, Number(parentGeo.height || 0) - Number(geometry.height || 0));
                const clampedX = clamp(geometry.x, 0, maxX);
                const clampedY = clamp(geometry.y, 0, maxY);
                if (Math.abs(clampedX - geometry.x) > 0.01 || Math.abs(clampedY - geometry.y) > 0.01) {
                    placementWarning = "Companion layout was clamped inside the garden module.";
                    attrs.companion_layout_clamped = "1";
                    if (value && value.setAttribute) value.setAttribute("companion_layout_clamped", "1");
                }
                geometry.x = clampedX;
                geometry.y = clampedY;
            }
        }
        const group = new mxCell(value, geometry, style || groupFrameStyle());
        group.setVertex(true);
        group.setConnectable(false);
        group.setCollapsed(false);
        const ownsUpdate = !opts.inTransaction;
        if (ownsUpdate) model.beginUpdate();
        try {
            activeGraphArg.addCell(group, parent);
            if (parent && isGardenModule(parent)) reorderModuleChildrenForLayering(model, parent);
            if (opts.select !== false && typeof activeGraphArg.setSelectionCell === "function") activeGraphArg.setSelectionCell(group);
        } finally {
            if (ownsUpdate) model.endUpdate();
        }
        if (placementWarning && typeof opts.onPlacementWarning === "function") opts.onPlacementWarning(placementWarning);
        notifyTilerGroupCreated(activeGraphArg, group, creationSource);
        return group;
    }

    function computeGridStatsXY(groupCell, spacingXpx, spacingYpx) {
        const g = groupCell.getGeometry();
        const { bandPx } = groupLabelMetrics(groupCell);
        const usableW = Math.max(0, g.width - GROUP_PADDING_PX * 2);
        const usableH = Math.max(0, g.height - GROUP_PADDING_PX * 2 - bandPx);
        if (usableW <= 0 || usableH <= 0) return { rows: 0, cols: 0, count: 0 };
        const cols = Math.max(1, Math.floor(usableW / spacingXpx));
        const rows = Math.max(1, Math.floor(usableH / spacingYpx));
        return { rows, cols, count: rows * cols };
    }


    function hasTileRC(cell) {
        if (!cell || !cell.getAttribute) return false;
        const r = cell.getAttribute("tile_r");
        const c = cell.getAttribute("tile_c");
        return (r !== null && r !== "") && (c !== null && c !== "");
    }

    function isAutoGeneratedTile(cell) {
        if (!cell || !cell.getAttribute) return false;
        // auto=1 is your signal for generated tiles; keep RC as fallback                     
        return cell.getAttribute("auto") === "1";
    }

    graph.addListener(mxEvent.CELLS_ADDED, function (sender, evt) {
        const cells = evt.getProperty("cells") || [];
        log("CELLS_ADDED count=", cells.length);

        if (WRAP_GUARD) {
            log("wrap guard active; ignoring");
            return;
        }
        WRAP_GUARD = true;
        const model = graph.getModel();
        model.beginUpdate();
        try {
            for (const cell of cells) {
                if (!isPlantCircle(cell)) continue;

                // If this is a tile dragged out of a group, do not wrap it                           
                if (isAutoGeneratedTile(cell)) {
                    log("Plant tile moved out; skip auto-wrap");
                    continue;
                }

                const parent = model.getParent(cell);
                if (isTilerGroup(parent)) {
                    log("Already inside tiler group; skip");
                    continue;
                }

                createTilerGroupFromCircle(graph, [cell]);
            }

        } finally {
            model.endUpdate();
            WRAP_GUARD = false;
        }
    });

    // ---------------- dirty plant circles helers -----------------

    function isDIrty(cell) {
        if (!cell || !cell.getAttribute) return false;
        return cell.getAttribute("dirty") === "1";
    }

    function isAutoTile(cell) {
        if (!cell || !cell.getAttribute) return false;
        return cell.getAttribute("plant_tiler") === "1" && cell.getAttribute("auto") === "1";
    }

    function setAttrsTxn(model, cell, attrs) {
        // uses your setCellAttrsNoTxn but wrapped in begin/endUpdate by caller
        setCellAttrsNoTxn(model, cell, attrs);
    }

    function isDirty(cell) {
        return !!cell && cell.getAttribute && cell.getAttribute("dirty") === "1";
    }

    function isChildOutOfGroupBounds(groupCell, childCell) {
        if (!groupCell || !childCell) return false;
        const gg = groupCell.getGeometry && groupCell.getGeometry();
        const center = childCenterInUnrotatedGroupSpace(groupCell, childCell);
        if (!gg || !center) return false;
        // Child geos are visual group-local positions; compare unrotated centers to [0..w]x[0..h].
        const eps = 0.01;
        if (center.x < -eps) return true;
        if (center.y < -eps) return true;
        if (center.x > gg.width + eps) return true;
        if (center.y > gg.height + eps) return true;
        return false;
    }

    // expand/collapse helpers
    function expandGroupDetail(graph, groupCell, opts = {}) {
        const abbr = groupCell.getAttribute("plant_abbr") || "?";
        const sx = toPx(Number(groupCell.getAttribute("spacing_x_cm") ||
            groupCell.getAttribute("spacing_cm") || "30"));
        const sy = toPx(Number(groupCell.getAttribute("spacing_y_cm") ||
            groupCell.getAttribute("spacing_cm") || "30"));
        const vegDiam = Number(groupCell.getAttribute("veg_diameter_cm") || 0);
        const iconDiam = Math.max(
            vegDiam > 0 ? toPx(vegDiam) : clamp(DEFAULT_ICON_DIAM_RATIO * Math.min(sx, sy), MIN_ICON_DIAM_PX, MAX_ICON_DIAM_PX), 6
        );
        const { rows, cols, count } = computeGridStatsXY(groupCell, sx, sy);
        if (count > MAX_TILES) {
            collapseToSummary(graph, groupCell, abbr, sx, sy, opts);
            return;
        }
        expandTiles(graph, groupCell, abbr, sx, sy, iconDiam, opts);
    }

    function collapseGroupDetail(graph, groupCell) {
        const abbr = groupCell.getAttribute("plant_abbr") || "?";
        const sx = toPx(Number(groupCell.getAttribute("spacing_x_cm") ||
            groupCell.getAttribute("spacing_cm") || "30"));
        const sy = toPx(Number(groupCell.getAttribute("spacing_y_cm") ||
            groupCell.getAttribute("spacing_cm") || "30"));
        collapseToSummary(graph, groupCell, abbr, sx, sy);
    }

    function retileVisibleExpandedGroups(graph) {
        const parent = graph.getDefaultParent();
        const all = graph.getChildVertices(parent) || [];
        const model = graph.getModel();
        model.beginUpdate();
        try {
            for (const v of all) {
                if (!isTilerGroup(v)) continue;
                if (isCollapsedLOD(v)) continue;
                retileGroup(graph, v);
            }
        } finally {
            model.endUpdate();
        }
    }

    // Viewport-only scroll/pan must not mutate tiler geometry.

    function updateGroupYield(model, groupCell, opts = {}) {
        const abbr = opts.abbr != null ? String(opts.abbr) : getXmlAttr(groupCell, "plant_abbr", "?");
        const fullName = getGroupDisplayName(groupCell, abbr || '?');
        const unit = groupCell.getAttribute("yield_unit") || YIELD_UNIT;

        const perYield = getNumberAttr(groupCell, "plant_yield", 0);
        const count =
            opts.countOverride != null
                ? Number(opts.countOverride)
                : getNumberAttr(groupCell, "plant_count", 0);

        const expectedYield = perYield * (Number.isFinite(count) ? count : 0);

        setCellAttrsNoTxn(model, groupCell, { [ATTR_YIELD_EXPECTED]: expectedYield });

        if (SHOW_YIELD_IN_GROUP_LABEL) {
            setCellAttrsNoTxn(model, groupCell, { label: `${fullName} — ${formatYield(expectedYield, unit)}` });
        }

        return { perYield, count, expectedYield, unit, abbr };
    }

    function syncGroupTitle(model, groupCell) {
        const abbr = getXmlAttr(groupCell, "plant_abbr", "?");
        const fullName = getGroupDisplayName(groupCell, abbr);
        setCellAttrsNoTxn(model, groupCell, { label: `${fullName}` });
    }


    function retileGroup(graph, groupCell, opts = {}) {

        if (opts.duringResize) return;
        const model = graph.getModel();
        const ownsTitleUpdate = !opts.inTransaction;
        if (ownsTitleUpdate) model.beginUpdate();
        try {
            syncGroupTitle(model, groupCell);
            applyGroupLabelFont(model, groupCell);
        } finally {
            if (ownsTitleUpdate) model.endUpdate();
        }
        const abbr = groupCell.getAttribute("plant_abbr") || "?";
        const spacingXcm = Number(groupCell.getAttribute("spacing_x_cm") ||
            groupCell.getAttribute("spacing_cm") || "30");
        const spacingYcm = Number(groupCell.getAttribute("spacing_y_cm") ||
            groupCell.getAttribute("spacing_cm") || "30");
        const spacingXpx = toPx(spacingXcm);
        const spacingYpx = toPx(spacingYcm);

        const vegDiamCm = Number(groupCell.getAttribute("veg_diameter_cm") || 0);
        let iconDiam = vegDiamCm > 0 ? toPx(vegDiamCm)
            : clamp(
                DEFAULT_ICON_DIAM_RATIO * Math.min(spacingXpx, spacingYpx),
                MIN_ICON_DIAM_PX,
                MAX_ICON_DIAM_PX
            );
        iconDiam = Math.max(iconDiam, 6);

        const collapsed = isCollapsedLOD(groupCell);
        const forceExpand = !!opts.forceExpand;
        const forceCollapse = !!opts.forceCollapse;

        const autoCollapse = shouldCollapseLOD(graph, groupCell, spacingXpx, spacingYpx);
        const autoExpand = shouldExpandLOD(graph, groupCell, spacingXpx, spacingYpx);

        if (forceCollapse) {
            collapseToSummary(graph, groupCell, abbr, spacingXpx, spacingYpx, { layoutSnapshot: opts.layoutSnapshot, previousRotationDeg: opts.previousRotationDeg, useLiveSnapshot: opts.useLiveSnapshot });
            return;
        }
        if (forceExpand) {
            expandGroupDetail(graph, groupCell, { layoutSnapshot: opts.layoutSnapshot, previousRotationDeg: opts.previousRotationDeg, useLiveSnapshot: opts.useLiveSnapshot });
            return;
        }

        if (autoCollapse && !collapsed) {
            collapseToSummary(graph, groupCell, abbr, spacingXpx, spacingYpx, { layoutSnapshot: opts.layoutSnapshot, previousRotationDeg: opts.previousRotationDeg, useLiveSnapshot: opts.useLiveSnapshot });
            return;
        }
        if (autoExpand && collapsed) {
            expandGroupDetail(graph, groupCell, { layoutSnapshot: opts.layoutSnapshot, previousRotationDeg: opts.previousRotationDeg, useLiveSnapshot: opts.useLiveSnapshot });
            return;
        }

        // Default path: keep current state; only refresh contents/summary        
        if (!collapsed) {
            if (opts.preferInPlace && hasEffectiveRotation(groupCell)) {
                const synced = syncAutoTileGeometriesInPlace(graph, groupCell, abbr, spacingXpx, spacingYpx, iconDiam, {
                    layoutSnapshot: opts.layoutSnapshot,
                    previousRotationDeg: opts.previousRotationDeg,
                    useLiveSnapshot: opts.useLiveSnapshot,
                    inTransaction: opts.inTransaction
                });
                if (!synced.fallback) return;
            }
            expandTiles(graph, groupCell, abbr, spacingXpx, spacingYpx, iconDiam, { layoutSnapshot: opts.layoutSnapshot, previousRotationDeg: opts.previousRotationDeg, useLiveSnapshot: opts.useLiveSnapshot });
        } else {
            collapseToSummary(graph, groupCell, abbr, spacingXpx, spacingYpx, { layoutSnapshot: opts.layoutSnapshot, previousRotationDeg: opts.previousRotationDeg, useLiveSnapshot: opts.useLiveSnapshot });
        }
    }

    (function installRotationRetileListener() {
        if (graph.__plantTilerRotationRetileInstalled) return;
        graph.__plantTilerRotationRetileInstalled = true;

        const model = graph.getModel();
        const queue = new Map();
        let timer = null;
        let guard = false;

        function rotationLayoutSnapshot(groupCell, previousRotationDeg, geometryByCellId) {
            const snap = captureLodLayoutSnapshot(graph, groupCell, {
                rotationDeg: previousRotationDeg,
                geometryByCellId: geometryByCellId
            });
            if (snapshotHasTiles(snap)) return snap;
            return isCollapsedLOD(groupCell) ? readLodLayoutSnapshot(groupCell) : snap;
        }

        function schedule(groupCell, layoutSnapshot) {
            if (!groupCell || !groupCell.id) return;
            if (!queue.has(groupCell.id)) queue.set(groupCell.id, { groupCell, layoutSnapshot });
            if (timer) clearTimeout(timer);
            timer = setTimeout(function () {
                const items = Array.from(queue.values());
                queue.clear();
                timer = null;
                guard = true;
                const groupsNeedingRefresh = [];
                try {
                    withUndoSuppressed(function () {
                        model.beginUpdate();
                        try {
                            for (const item of items) {
                                if (!item.groupCell || !isTilerGroup(item.groupCell)) continue;
                                retileGroup(graph, item.groupCell, { layoutSnapshot: item.layoutSnapshot, useLiveSnapshot: false, preferInPlace: true, inTransaction: true });
                                groupsNeedingRefresh.push(item.groupCell);
                            }
                        } finally {
                            model.endUpdate();
                        }
                    });
                } finally {
                    guard = false;
                }
                for (const group of groupsNeedingRefresh) graph.refresh(group);
            }, ROTATION_RETILE_DEBOUNCE_MS);
        }

        model.addListener(mxEvent.CHANGE, function (_sender, evt) {
            if (guard) return;
            const edit = evt && evt.getProperty && evt.getProperty("edit");
            const changes = edit && edit.changes ? edit.changes : [];
            const geometryByCellId = previousGeometryByCellIdFromChanges(changes);
            for (const change of changes) {
                const rotationChange = rotationChangedFromStyleChange(change);
                if (!rotationChange) continue;
                if (rotationChange.cell && rotationChange.cell.id && queue.has(rotationChange.cell.id)) {
                    schedule(rotationChange.cell, null);
                    continue;
                }
                const snap = rotationLayoutSnapshot(rotationChange.cell, rotationChange.before, geometryByCellId);
                schedule(rotationChange.cell, snap);
            }
        });
    })();

    let REORDER_GUARD = false;

    graph.addListener(mxEvent.CELLS_ADDED, function (sender, evt) {
        if (REORDER_GUARD) return;

        const cells = evt.getProperty("cells") || [];
        const model = graph.getModel();

        const modulesToFix = new Map();
        for (const c of cells) {
            if (!c) continue;

            // Only direct children matter; check parent and type
            const p = model.getParent(c);
            if (!p || !isGardenModule(p)) continue;

            if (isGardenBed(c) || isIrrigationBedAssembly(c) || isTilerGroup(c)) {
                modulesToFix.set(p.id, p);
            }
        }

        if (!modulesToFix.size) return;

        REORDER_GUARD = true;
        model.beginUpdate();
        try {
            for (const m of modulesToFix.values()) {
                reorderModuleChildrenForLayering(model, m);
            }
        } finally {
            model.endUpdate();
            REORDER_GUARD = false;
        }
    });


    (function installDirtyOnManualMove() {
        if (graph.__plantTilerDirtyMoveInstalled) return;
        graph.__plantTilerDirtyMoveInstalled = true;

        graph.addListener(mxEvent.CELLS_MOVED, function (sender, evt) {
            const cells = evt.getProperty("cells") || [];
            if (!cells.length) return;

            const model = graph.getModel();
            model.beginUpdate();
            try {
                for (const cell of cells) {
                    if (!cell) continue;

                    const parent = model.getParent(cell);
                    if (!parent || !isTilerGroup(parent)) continue;

                    // Only mark plant circles
                    if (!isPlantCircle(cell)) continue;

                    // If it was auto-placed and user moved it, set as dirty
                    if (cell.getAttribute("auto") === "1" && cell.getAttribute("dirty") !== "1") {
                        setAttrsTxn(model, cell, { auto: "0", dirty: "1" });
                    }
                }
            } finally {
                model.endUpdate();
            }

            // Refresh moved cells so styles/labels update if you choose to reflect dirty state visually
            for (const cell of cells) graph.refresh(cell);
        });
    })();

    (function installBedAutoFitListeners() {
        if (graph.__plantTilerBedAutoFitInstalled) return;
        graph.__plantTilerBedAutoFitInstalled = true;

        graph.addListener(mxEvent.CELLS_MOVED, function (_sender, evt) {
            const cells = evt.getProperty("cells");
            normalizeMovedTilerGroupsToBeds(cells, {
                source: "cells-moved",
                allowDragIntoBedFit: true,
                skipSameBedMoveFit: true,
                persistAxisIntent: true,
                moveDx: evt.getProperty("dx"),
                moveDy: evt.getProperty("dy")
            });
            normalizeMovedBedAssembliesToBeds(cells, { source: "cells-moved", fitOnDrag: true, skipSameBedMoveFit: true, persistAxisIntent: true, moveDx: evt.getProperty("dx"), moveDy: evt.getProperty("dy") });
        });

        graph.addListener(mxEvent.CELLS_RESIZED, function (_sender, evt) {
            const cells = evt.getProperty("cells");
            normalizeMovedTilerGroupsToBeds(cells, { source: "cells-resized", allowDragIntoBedFit: false, persistAxisIntent: true, clearFitAxisIntentOnNoBed: true });
            normalizeMovedBedAssembliesToBeds(cells, { source: "cells-resized", fitOnDrag: false, persistAxisIntent: true, clearFitAxisIntentOnNoBed: true });
        });
    })();

    function minGroupSizePx(spacingXpx, spacingYpx, bandPx) {
        const b = Number.isFinite(Number(bandPx)) ? Number(bandPx) : GROUP_LABEL_BAND_PX;
        const minW = (GROUP_PADDING_PX * 2) + spacingXpx;
        const minH = (GROUP_PADDING_PX * 2) + b + spacingYpx;
        return { minW, minH };
    }

    function buildResizeSnapshot(graph, groupCell, includeLayout) {
        const sx = toPx(Number(groupCell.getAttribute("spacing_x_cm") || groupCell.getAttribute("spacing_cm") || "30"));
        const sy = toPx(Number(groupCell.getAttribute("spacing_y_cm") || groupCell.getAttribute("spacing_cm") || "30"));
        const vegDiamCm = Number(groupCell.getAttribute("veg_diameter_cm") || 0);
        let iconDiam = vegDiamCm > 0
            ? toPx(vegDiamCm)
            : clamp(DEFAULT_ICON_DIAM_RATIO * Math.min(sx, sy), MIN_ICON_DIAM_PX, MAX_ICON_DIAM_PX);
        iconDiam = Math.max(iconDiam, 6);

        const { bandPx } = groupLabelMetrics(groupCell);
        return {
            prev: includeLayout ? gridSnapshot(groupCell, sx, sy) : null,
            spacingXpx: sx,
            spacingYpx: sy,
            iconDiamPx: iconDiam,
            bandPx,
            rotated: includeLayout ? hasEffectiveRotation(groupCell) : false,
            layoutSnapshot: includeLayout ? resolveLayoutSnapshot(graph, groupCell) : null
        };
    }

    function asBoundsArray(bounds, n) {
        if (Array.isArray(bounds)) return bounds;
        // mxGraph often passes a single mxRectangle for single-cell resizes;             
        // replicate defensively for multi-cell resizes.                                  
        if (bounds && typeof bounds === "object" && n > 1) {
            const out = [];
            for (let i = 0; i < n; i++) out.push(bounds);
            return out;
        }
        return bounds ? [bounds] : [];
    }

    function clampTilerBounds(cells, bounds, snapshots) {
        const bArr = asBoundsArray(bounds, (cells || []).length);
        if (!bArr.length) return bounds;

        // Clone only when needed to avoid mutating mxGraph internals unexpectedly.        
        let changed = false;
        const out = bArr.slice();

        for (let i = 0; i < (cells || []).length; i++) {
            const c = cells[i];
            const b = out[i];
            if (!c || !b) continue;

            const gId = (isTilerGroup(c) ? c.id : null);
            const snap = gId ? snapshots.get(gId) : null;
            if (!snap) continue;

            const { minW, minH } = minGroupSizePx(snap.spacingXpx, snap.spacingYpx, snap.bandPx);
            const nextW = Math.max(minW, b.width);
            const nextH = Math.max(minH, b.height);

            if (nextW !== b.width || nextH !== b.height) {
                // Ensure a true mxRectangle clone when present                            
                const nb = b.clone ? b.clone() : new mxRectangle(b.x, b.y, b.width, b.height);
                nb.width = nextW;
                nb.height = nextH;
                out[i] = nb;
                changed = true;
            }
        }

        if (!changed) return bounds;
        // Return in the same "shape" mxGraph expects.                                     
        return Array.isArray(bounds) ? out : out[0];
    }


    function gridSnapshot(groupCell, spacingXpx, spacingYpx) {
        const { rows, cols, count } = computeGridStatsXY(groupCell, spacingXpx, spacingYpx);
        return { rows, cols, count };
    }

    function ensureLineSlotsPresent(graph, groupCell, abbr, rows, cols, spacingXpx, spacingYpx, iconDiamPx, opts = {}) {
        // Only needed for 1×N or N×1 shapes
        if (isCollapsedLOD(groupCell)) return 0;
        if (!(rows === 1 || cols === 1)) return 0;
        if (rows <= 0 || cols <= 0) return 0;

        const model = graph.getModel();
        const slotMap = buildSlotMap(graph, groupCell);

        // dynamic label band + tile font scaling
        const { bandPx } = groupLabelMetrics(groupCell);
        const fontPx = tileFontPx(iconDiamPx);

        let added = 0;
        const ownsUpdate = !opts.inTransaction;
        if (ownsUpdate) model.beginUpdate();
        try {
            const disabledSet = readDisabledSet(groupCell);

            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    const key = `${r},${c}`;
                    if (slotMap.has(key)) continue;

                    const v = addTileAtSlot(
                        graph,
                        groupCell,
                        abbr,
                        r,
                        c,
                        spacingXpx,
                        spacingYpx,
                        iconDiamPx,
                        disabledSet,
                        bandPx,
                        fontPx
                    );

                    if (v) {
                        slotMap.set(key, v);
                        added++;
                    }
                }
            }
        } finally {
            if (ownsUpdate) model.endUpdate();
        }

        return added;
    }



    function addTileAtSlot(graph, groupCell, abbr, r, c, spacingXpx, spacingYpx, iconDiamPx, disabledSet, bandPx, fontPx) {
        if (disabledSet && disabledSet.has(`${r},${c}`)) return null;

        const geo = tileGeometryAtSlot(groupCell, r, c, spacingXpx, spacingYpx, iconDiamPx, bandPx);

        const vVal = createXmlValue("PlantTile", {
            plant_tiler: "1",
            auto: "1",
            abbr: abbr,
            label: abbr,
            tile_r: String(r),
            tile_c: String(c),
            dirty: "0",
        });

        const v = new mxCell(vVal, geo, plantCircleStyle(fontPx));
        v.setVertex(true);
        v.setConnectable(false);

        graph.addCell(v, groupCell);
        return v;
    }

    function applyResizeDelta(graph, groupCell, prev, next, spacingXpx, spacingYpx, iconDiamPx, opts = {}) {
        const model = graph.getModel();
        const abbr = groupCell.getAttribute("plant_abbr") || "?";

        const disabledSet = readDisabledSet(groupCell);

        // If LOD collapsed, don’t maintain tiles. Keep your existing collapse/summary behavior.
        if (isCollapsedLOD(groupCell)) return;

        const { bandPx } = groupLabelMetrics(groupCell);
        const fontPx = tileFontPx(iconDiamPx);

        const slotMap = buildSlotMap(graph, groupCell);

        const ownsUpdate = !opts.inTransaction;
        if (ownsUpdate) model.beginUpdate();
        try {
            // ---- Add new rows ----
            if (next.rows > prev.rows) {
                for (let r = prev.rows; r < next.rows; r++) {
                    for (let c = 0; c < next.cols; c++) {
                        const key = `${r},${c}`;
                        if (slotMap.has(key)) continue;
                        const v = addTileAtSlot(graph, groupCell, abbr, r, c, spacingXpx, spacingYpx, iconDiamPx, disabledSet, bandPx, fontPx);
                        if (v) slotMap.set(key, v);
                    }
                }
            }

            // ---- Add new cols ----
            if (next.cols > prev.cols) {
                const rMax = Math.min(prev.rows, next.rows);
                for (let r = 0; r < rMax; r++) {
                    for (let c = prev.cols; c < next.cols; c++) {
                        const key = `${r},${c}`;
                        if (slotMap.has(key)) continue;
                        const v = addTileAtSlot(graph, groupCell, abbr, r, c, spacingXpx, spacingYpx, iconDiamPx, disabledSet, bandPx, fontPx);
                        slotMap.set(key, v);
                    }
                }
            }

            // ---- Remove removed rows/cols (auto tiles) + remove dirty tiles that are now OOB ---- 
            const kids = graph.getChildVertices(groupCell) || [];
            const toRemove = [];

            for (const k of kids) {
                if (!isPlantCircle(k)) continue;

                // (A) Remove dirty circles that are outside group bounds                   
                if (isDirty(k) && isChildOutOfGroupBounds(groupCell, k)) {
                    toRemove.push(k);
                    continue;
                }

                // (B) Existing rule: remove AUTO tiles that are outside new grid slots     
                if (!isAutoTile(k)) continue;

                const r = Number(k.getAttribute("tile_r"));
                const c = Number(k.getAttribute("tile_c"));
                if (!Number.isFinite(r) || !Number.isFinite(c)) continue;

                if (r >= next.rows || c >= next.cols) toRemove.push(k);
            }

            if (toRemove.length) graph.removeCells(toRemove);

        } finally {
            if (ownsUpdate) model.endUpdate();
        }
    }

    function shiftGroupChildrenByDeltaBand(graph, groupCell, deltaY, opts = {}) {
        if (!deltaY || !Number.isFinite(deltaY)) return;
        if (!groupCell || isCollapsedLOD(groupCell)) return;

        const model = graph.getModel();
        const kids = graph.getChildVertices(groupCell) || [];

        const ownsUpdate = !opts.inTransaction;
        if (ownsUpdate) model.beginUpdate();
        try {
            for (const k of kids) {
                if (!k) continue;
                if (!isPlantCircle(k)) continue;                                       // NEW (only plant circles)
                if (k.getAttribute && k.getAttribute("lod_summary") === "1") continue; // NEW (paranoia)

                const g = k.getGeometry && k.getGeometry();
                if (!g) continue;

                const ng = g.clone();
                ng.y = (Number(ng.y) || 0) + deltaY;
                model.setGeometry(k, ng);
            }
        } finally {
            if (ownsUpdate) model.endUpdate();
        }
    }

    function buildSlotMap(graph, groupCell) {
        const kids = graph.getChildVertices(groupCell) || [];
        const map = new Map(); // key "r,c" -> cell
        for (const k of kids) {
            if (!isPlantCircle(k)) continue;
            const r = Number(k.getAttribute("tile_r"));
            const c = Number(k.getAttribute("tile_c"));
            if (!Number.isFinite(r) || !Number.isFinite(c)) continue;
            map.set(`${r},${c}`, k);
        }
        return map;
    }


    function safeJsonParse(s, fallback) {
        try { return JSON.parse(s); } catch (_) { return fallback; }
    }

    // Stored format: JSON array of [r,c] pairs, e.g. [[0,1],[2,3]]     
    function readDisabledSet(groupCell) {
        const raw = getXmlAttr(groupCell, ATTR_DISABLED_PLANTS, "");
        const arr = raw ? safeJsonParse(raw, []) : [];
        const set = new Set();
        for (const it of (Array.isArray(arr) ? arr : [])) {
            if (!Array.isArray(it) || it.length !== 2) continue;
            const r = Number(it[0]), c = Number(it[1]);
            if (!Number.isFinite(r) || !Number.isFinite(c)) continue;
            if (r < 0 || c < 0) continue;
            set.add(`${r},${c}`);
        }
        return set;
    }

    function writeDisabledSet(model, groupCell, set) {
        const arr = [];
        for (const key of (set || new Set())) {
            const [rs, cs] = String(key).split(",");
            const r = Number(rs), c = Number(cs);
            if (!Number.isFinite(r) || !Number.isFinite(c)) continue;
            arr.push([r, c]);
        }
        setCellAttrsNoTxn(model, groupCell, {
            [ATTR_DISABLED_PLANTS]: arr.length ? JSON.stringify(arr) : ""
        });
    }

    function pruneDisabledToGrid(model, groupCell, rows, cols) {
        const set = readDisabledSet(groupCell);
        if (!set.size) return { changed: false, set };

        let changed = false;
        for (const key of Array.from(set)) {
            const [rs, cs] = key.split(",");
            const r = Number(rs), c = Number(cs);
            if (!Number.isFinite(r) || !Number.isFinite(c) || r < 0 || c < 0 || r >= rows || c >= cols) {
                set.delete(key);
                changed = true;
            }
        }
        if (changed) writeDisabledSet(model, groupCell, set);
        return { changed, set };
    }

    function applyCounts(model, groupCell, capacityCount, disabledSet) {
        const disabledN = disabledSet ? disabledSet.size : 0;
        const actual = Math.max(0, Number(capacityCount) - disabledN);
        setCellAttrsNoTxn(model, groupCell, {
            [ATTR_PLANT_COUNT_CAP]: String(capacityCount),
            [ATTR_PLANT_COUNT_ACT]: String(actual),
            [ATTR_PLANT_COUNT]: String(actual),
        });
        return { capacity: capacityCount, actual, disabledN };
    }

    function buildBedResizeSnapshot(bed) {
        if (!bed || !isGardenBed(bed)) return null;
        const model = graph.getModel();
        const parent = model.getParent(bed);
        const previousRect = getModelRect(bed);
        const previousRotatedRect = rotatedRectForModelRect(bed, previousRect);
        if (!parent || !previousRect || !previousRotatedRect) return null;
        const targets = [];
        const assemblyTargets = [];
        const bedId = bed.id || (bed.getId && bed.getId()) || "";
        const children = graph.getChildVertices(parent) || [];
        for (const child of children) {
            if (isIrrigationBedAssembly(child) && child.getAttribute(BED_AUTO_FIT_ATTR) !== "0") {
                const geometryBed = resolveBedForAssemblyGeometry(parent, child, null);
                const ownsByGeometry = !!(geometryBed && geometryBed.id === bedId);
                const ownsByCachedLink = !geometryBed && child.getAttribute("irrigation_linked_bed_id") === bedId;
                if (ownsByGeometry || ownsByCachedLink) {
                    const axes = bedFitAxesForBedAssembly(child, bed);
                    if (axes.fitWidth || axes.fitHeight) assemblyTargets.push({ assembly: child, axes });
                }
            }
            if (!child || !isTilerGroup(child) || child.getAttribute(BED_AUTO_FIT_ATTR) === "0") continue;
            const axes = bedFitAxesForGroup(child);
            if (!axes.fitWidth && !axes.fitHeight) continue;
            const center = rectCenterModel(getModelRect(child));
            if (!pointInRotatedRectModel(center, previousRotatedRect)) continue;
            targets.push({ tg: child, axes });
        }
        return { bed, parent, previousRect, previousRotatedRect, previousArea: rectAreaModel(previousRect), targets, assemblyTargets };
    }

    function collectBedResizeSnapshots(cells) {
        const snapshots = new Map();
        for (const cell of (cells || [])) {
            if (!cell || !cell.id || !isGardenBed(cell) || snapshots.has(cell.id)) continue;
            const snapshot = buildBedResizeSnapshot(cell);
            if (snapshot) snapshots.set(cell.id, snapshot);
        }
        return snapshots;
    }

    function syncIrrigationBedAssembliesForSnapshot(snapshot, opts) {
        const planner = (graph.__trellisIrrigationPlanner || (typeof window !== "undefined" && window.TrellisIrrigationPlanner));
        if (!planner || typeof planner.syncLinkedBedAssemblyToBed !== "function") return [];
        const changed = [];
        for (const target of (snapshot && snapshot.assemblyTargets || [])) {
            const assembly = target && target.assembly ? target.assembly : target;
            const axes = target && target.axes ? target.axes : { fitWidth: true, fitHeight: true };
            if (planner.syncLinkedBedAssemblyToBed(snapshot.parent, assembly, snapshot.bed, { inTransaction: !!(opts && opts.inTransaction), fitWidth: !!axes.fitWidth, fitHeight: !!axes.fitHeight })) changed.push(assembly);
        }
        return changed;
    }

    function refitGroupsForResizedBeds(bedSnapshots, opts) {
        const source = (opts && opts.source) || "bed-resized";
        const txnId = (opts && opts.txnId) || ++bedFitTxnSeq;
        const ownsTransaction = !(opts && opts.inTransaction);
        const snapshots = Array.from((bedSnapshots && bedSnapshots.values) ? bedSnapshots.values() : (bedSnapshots || []));
        if (!snapshots.length || bedFitInProgress) {
            bedFitLog("bed-resize-skip", { txnId, source, reason: !snapshots.length ? "no-beds" : "in-progress" });
            return { changed: [], trimmed: false };
        }
        const model = graph.getModel();
        const targetByGroupId = new Map();
        const syncedAssemblies = [];
        for (const snap of snapshots) {
            Array.prototype.push.apply(syncedAssemblies, syncIrrigationBedAssembliesForSnapshot(snap, { inTransaction: !ownsTransaction }));
            for (const target of (snap.targets || [])) {
                const tg = target && target.tg;
                if (!tg || !tg.id || !isTilerGroup(tg)) continue;
                const previous = targetByGroupId.get(tg.id);
                if (!previous || snap.previousArea < previous.previousArea) targetByGroupId.set(tg.id, { tg, bed: snap.bed, axes: target.axes, previousArea: snap.previousArea });
            }
        }
        if (!targetByGroupId.size && !syncedAssemblies.length) {
            bedFitLog("bed-resize-skip", { txnId, source, reason: "no-fitted-groups", bedIds: snapshots.map(snap => bedFitCellId(snap.bed)) });
            return { changed: [], trimmed: false };
        }
        const changed = [];
        let trimmed = false;
        bedFitLog("bed-resize-start", { txnId, source, bedIds: snapshots.map(snap => bedFitCellId(snap.bed)), groupIds: Array.from(targetByGroupId.values()).map(item => bedFitCellId(item.tg)), assemblyIds: syncedAssemblies.map(bedFitCellId) });
        bedFitInProgress = true;
        if (ownsTransaction) model.beginUpdate();
        try {
            for (const item of targetByGroupId.values()) {
                const fitResult = applyBedFitGeometry(item.tg, item.bed, false, {
                    txnId,
                    source,
                    usePersistedFitAxes: true,
                    forceFitWidth: !!(item.axes && item.axes.fitWidth),
                    forceFitHeight: !!(item.axes && item.axes.fitHeight)
                });
                if (fitResult) changed.push({
                    tg: item.tg,
                    bed: fitResult.bed,
                    fitWidth: fitResult.fitWidth,
                    fitHeight: fitResult.fitHeight,
                    bedFitChanged: !!fitResult.changed,
                    layoutSnapshot: fitResult.layoutSnapshot,
                    previousRotationDeg: fitResult.previousRotationDeg
                });
            }
            for (const item of changed) retileAfterBedFit(item.tg, {
                txnId,
                source,
                layoutSnapshot: item.layoutSnapshot,
                previousRotationDeg: item.previousRotationDeg
            });
            for (const item of changed) {
                const bbox = getPlantCircleBBoxLogical(item.tg);
                if (trimGroupToPlantFootprint(item.tg, item.bed, bbox, item.fitWidth, item.fitHeight, { txnId, source })) trimmed = true;
            }
        } finally {
            if (ownsTransaction) model.endUpdate();
            bedFitInProgress = false;
        }
        if (trimmed || changed.some(item => item.bedFitChanged)) markBedFitResizeSuppression(changed);
        bedFitLog("bed-resize-end", { txnId, source, changedCount: changed.length, assemblyCount: syncedAssemblies.length, trimmed });
        return { changed, syncedAssemblies, trimmed };
    }


    // -------------------- Resize → Retile in SAME undo step --------------------
    (function installResizeCellsWrapper() {
        if (graph.__plantTilerResizeCellsWrapped) return;
        graph.__plantTilerResizeCellsWrapped = true;

        const oldResizeCells = graph.resizeCells;

        graph.resizeCells = function (cells, bounds, recurse) {
            const model = graph.getModel();
            const duringResize = !!graph.isMouseDown;

            // Collect affected tiler groups and snapshot BEFORE resize
            const groups = new Map();
            for (const c of (cells || [])) {
                const g = isTilerGroup(c) ? c : findTilerGroupAncestor(graph, c);
                if (g && g.id) groups.set(g.id, g);
            }

            const hasTiler = groups.size > 0;
            const bedSnapshots = collectBedResizeSnapshots(cells);
            const hasResizedBeds = bedSnapshots.size > 0;

            const snapshots = new Map(); // groupId -> { prev, spacingXpx, spacingYpx, iconDiamPx, bandPx, rotated, layoutSnapshot }
            for (const g of groups.values()) {
                snapshots.set(g.id, buildResizeSnapshot(graph, g, !duringResize));
            }

            // Clamp tiler group bounds to minimum 1×1 capacity
            if (hasTiler) {
                bounds = clampTilerBounds(cells, bounds, snapshots);
            }

            // During drag: do ONLY the geometry resize (lightweight)
            if (duringResize || (!hasTiler && !hasResizedBeds)) {
                return oldResizeCells.call(this, cells, bounds, hasTiler ? false : recurse);
            }

            // Mouse-up: make geometry resize + all follow-up edits ONE undoable change
            let res;
            const groupsNeedingRefresh = [];
            const bedResizeTxnId = hasResizedBeds ? ++bedFitTxnSeq : null;

            model.beginUpdate();
            try {
                // Geometry resize happens inside the SAME outer transaction
                res = oldResizeCells.call(this, cells, bounds, hasTiler ? false : recurse);

                for (const g of groups.values()) {
                    const snap = snapshots.get(g.id);
                    if (!snap) continue;

                    const next = gridSnapshot(g, snap.spacingXpx, snap.spacingYpx);

                    // Label font update
                    applyGroupLabelFont(model, g);

                    // Band height change: shift children
                    const nextBandPx = groupLabelMetrics(g).bandPx;
                    const deltaBandY = (Number(nextBandPx) || 0) - (Number(snap.bandPx) || 0);
                    if (deltaBandY) {
                        if (snap.rotated) shiftLayoutSnapshotByDeltaY(snap.layoutSnapshot, deltaBandY);
                        else shiftGroupChildrenByDeltaBand(graph, g, deltaBandY, { inTransaction: true });
                        snap.bandPx = nextBandPx;
                    }

                    // Prune disabled entries now outside grid
                    pruneDisabledToGrid(model, g, next.rows, next.cols);

                    // Update group count/yield to match new capacity
                    {
                        const disabledSet = readDisabledSet(g);
                        const { actual } = applyCounts(model, g, next.count, disabledSet);
                        updateGroupYield(model, g, {
                            abbr: g.getAttribute("plant_abbr") || "?",
                            countOverride: actual
                        });
                    }

                    const abbr = g.getAttribute("plant_abbr") || "?";

                    // LOD thresholds
                    if (next.count > MAX_TILES || next.count > LOD_TILE_THRESHOLD) {
                        collapseToSummary(graph, g, abbr, snap.spacingXpx, snap.spacingYpx, snap.rotated ? { layoutSnapshot: snap.layoutSnapshot, useLiveSnapshot: false } : {});
                        groupsNeedingRefresh.push(g);
                        continue;
                    }

                    // If currently collapsed but now under thresholds, expand
                    if (isCollapsedLOD(g)) {
                        expandTiles(graph, g, abbr, snap.spacingXpx, snap.spacingYpx, snap.iconDiamPx, snap.rotated ? { layoutSnapshot: snap.layoutSnapshot, useLiveSnapshot: false } : {});
                        groupsNeedingRefresh.push(g);
                        continue;
                    }

                    if (snap.rotated) {
                        const synced = syncAutoTileGeometriesInPlace(graph, g, abbr, snap.spacingXpx, snap.spacingYpx, snap.iconDiamPx, { layoutSnapshot: snap.layoutSnapshot, useLiveSnapshot: false, inTransaction: true });
                        if (synced.fallback) expandTiles(graph, g, abbr, snap.spacingXpx, snap.spacingYpx, snap.iconDiamPx, { layoutSnapshot: snap.layoutSnapshot, useLiveSnapshot: false });
                        groupsNeedingRefresh.push(g);
                        continue;
                    }

                    // Delta slot maintenance (add/remove)
                    applyResizeDelta(graph, g, snap.prev, next, snap.spacingXpx, snap.spacingYpx, snap.iconDiamPx, { inTransaction: true });

                    ensureLineSlotsPresent(
                        graph,
                        g,
                        abbr,
                        next.rows,
                        next.cols,
                        snap.spacingXpx,
                        snap.spacingYpx,
                        snap.iconDiamPx,
                        { inTransaction: true }
                    );

                    groupsNeedingRefresh.push(g);
                }

                if (hasResizedBeds) {
                    const bedFitResult = refitGroupsForResizedBeds(bedSnapshots, { source: "bed-resized", inTransaction: true, txnId: bedResizeTxnId });
                    for (const item of bedFitResult.changed || []) groupsNeedingRefresh.push(item.tg);
                    for (const assembly of bedFitResult.syncedAssemblies || []) groupsNeedingRefresh.push(assembly);
                }
            } finally {
                model.endUpdate();
            }

            for (const g of groupsNeedingRefresh) graph.refresh(g);
            return res;
        };
    })();



    // ---- Public API export (for other plugins) ---------------------------------
    window.USL = window.USL || {};
    window.USL.tiler = Object.assign({}, window.USL.tiler, {
        retileGroup,
        retileAndFitToContainingBed,
        createSiblingTilerGroupFromSource,
        reorderModuleChildrenForLayering
    });
    installTrellisDebugSurface();
    bedFitLog("loaded", bedFitStatus());

    // -------------------- Boot --------------------
    (async function init() {
        try {

        } catch (e) {
            log("Init error:", e.message);
        }
    })();
});
