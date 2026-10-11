/**
 * Trellis plugin: Planting Group — Drag Circle → Auto Group → Resize to Tile (Square Grid, SQLite-backed)
 * With debug logs, re-entrancy guard, resize debounce, and max-tile cap.
 */
Draw.loadPlugin(function (ui) {
    const graph = ui.editor.graph; // CHANGE
    if (graph.__trellisPlantingGroupInstalled) return; // CHANGE: legacy and canonical plugin names install once.
    graph.__trellisPlantingGroupInstalled = true; // CHANGE
    const model = graph.getModel(); // CHANGE
    // Plant children use visual local coordinates; their rotated extents do not define the frame. // CHANGE
    const originalCellsAdded = graph.cellsAdded; // CHANGE
    graph.cellsAdded = function (cells, parent, index, source, target, absolute, constrain, extend) { // CHANGE
        const plantingParent = isTilerGroup(parent); // CHANGE
        return originalCellsAdded.call(this, cells, parent, index, source, target, absolute, plantingParent ? false : constrain, plantingParent ? false : extend); // CHANGE
    }; // CHANGE: preserve mxGraph events and transactions without changing graph-wide options.

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
        const button = applyTilerButtonStyle(mxUtils.button(label, onClick), variant || "neutral", options); // CHANGE
        if (options && options.title) button.title = options.title; // CHANGE
        return button; // CHANGE
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
    const CM_PER_INCH = CM_PER_FOOT / 12; // NEW: path widths display in inches for short imperial distances.
    const DEFAULT_CREATED_GARDEN_MODULE_WIDTH_UNITS = 160; // NEW: used to recognize the unsized garden shell created before settings are chosen.
    const DEFAULT_CREATED_GARDEN_MODULE_HEIGHT_UNITS = 100; // NEW: used to recognize the unsized garden shell created before settings are chosen.
    const DEFAULT_METRIC_GARDEN_WIDTH_CM = 4 * CM_PER_METER; // NEW: new metric gardens start as whole-number presets.
    const DEFAULT_METRIC_GARDEN_LENGTH_CM = 8 * CM_PER_METER; // NEW: new metric gardens start as whole-number presets.
    const DEFAULT_IMPERIAL_GARDEN_WIDTH_CM = 12 * CM_PER_FOOT; // NEW: new imperial gardens start as whole-number presets.
    const DEFAULT_IMPERIAL_GARDEN_LENGTH_CM = 24 * CM_PER_FOOT; // NEW: new imperial gardens start as whole-number presets.
    const DEFAULT_METRIC_BED_WIDTH_CM = 100;
    const DEFAULT_METRIC_BED_LENGTH_CM = 200;
    const DEFAULT_IMPERIAL_BED_WIDTH_CM = 4 * CM_PER_FOOT;
    const DEFAULT_IMPERIAL_BED_LENGTH_CM = 8 * CM_PER_FOOT;
    const DEFAULT_PATH_WIDTH_PRESETS = [ // NEW: fixed per-garden path snap presets.
        { id: "small", label: "Small", metricCm: 45, imperialCm: 18 * CM_PER_INCH },
        { id: "medium", label: "Medium", metricCm: 75, imperialCm: 30 * CM_PER_INCH },
        { id: "large", label: "Large", metricCm: 100, imperialCm: 48 * CM_PER_INCH }
    ];
    const PATH_WIDTH_TOLERANCE_RATIO = 0.25; // NEW
    const PATH_WIDTH_TOLERANCE_CAP_CM = 30; // NEW
    const PATH_SNAP_OVERLAY_CLASS = "trellis-path-snap-overlay"; // NEW
    const PATH_SNAP_BAND_CLASS = "trellis-path-snap-band"; // NEW
    const PATH_SNAP_BADGE_CLASS = "trellis-path-snap-badge"; // NEW
    const DEFAULT_MODULE_MARGIN_CM = 5 * CM_PER_METER; // CHANGE
    const TILER_GROUP_CREATED_EVENT = "usl:tilerGroupCreated";
    const ALLOCATE_PLAN_EVENT = "usl:allocatePlanRequested"; // NEW

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

    // --------------- Planting group scaling font size -----------------
    const GROUP_BASE_AREA_PX2 = 240 * 240;
    const GROUP_LABEL_FONT_MIN_PX = 10;
    const GROUP_LABEL_FONT_MAX_PX = 18;
    const BED_FIT_TOLERANCE = 0.25;
    const BED_FIT_RESIZE_SUPPRESS_MS = 250;
    const DEFAULT_ALLOWED_OVERHANG_PCT = 30; // CHANGE: percentage of circle diameter per bed edge.
    const savedCropOverhangDefaults = new Map(); // CHANGE: open editors must restore defaults saved after their rows were loaded.
    window.addEventListener('usl:cropOverhangSaved', event => { // CHANGE
        const detail = event.detail; // CHANGE
        if (detail?.plantId != null) savedCropOverhangDefaults.set(String(detail.plantId), resolveAllowedOverhangPct(detail.allowedOverhangPct)); // CHANGE: success events only; failed writes never become defaults.
    }); // CHANGE
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
            plugin: "Planting_Group.js",
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
            "connectable=0", // CHANGE
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
            "connectable=0", // CHANGE
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
        function updateButton() { button.textContent = selectedCity() ? fullCityLabel(selectedCity()) : "Select a city..."; button.title = "Choose the city used for this garden\'s climate and scheduling."; } // CHANGE
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

    // ------------------- Layering (garden beds, bed assemblies, other, planting groups) ----------------

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


    // ----------------- Planting group helpers ----------------------


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
        const { bandPx } = groupLabelMetrics(groupCell);
        const stats = classifyPlantingSlots(groupCell, spacingXpx, spacingYpx, bandPx, readDisabledSet(groupCell));
        return stats.actual > LOD_TILE_THRESHOLD; // CHANGE: outside omitted slots do not force summary LOD.
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

    function layoutGridOffsetPx(groupCell) {
        const xCm = finiteNumberOrNull(getXmlAttr(groupCell, "layout_offset_x_cm", "")) ?? finiteNumberOrNull(getXmlAttr(groupCell, "companion_offset_x_cm", "")); // CHANGE: current planting offsets are authoritative; companion offsets are legacy fallback.
        const yCm = finiteNumberOrNull(getXmlAttr(groupCell, "layout_offset_y_cm", "")) ?? finiteNumberOrNull(getXmlAttr(groupCell, "companion_offset_y_cm", "")); // CHANGE: current planting offsets are authoritative; companion offsets are legacy fallback.
        return {
            x: xCm == null ? 0 : toPx(xCm),
            y: yCm == null ? 0 : toPx(yCm),
            active: !!((xCm != null && xCm !== 0) || (yCm != null && yCm !== 0))
        };
    }

    function plantingContentBoundsLocal(groupCell, bandPx) { // NEW: slot omission uses the same non-label content area everywhere.
        const g = groupCell && groupCell.getGeometry ? groupCell.getGeometry() : null;
        const width = Math.max(0, Number(g && g.width) || 0);
        const height = Math.max(0, Number(g && g.height) || 0);
        const minX = GROUP_PADDING_PX;
        const minY = GROUP_PADDING_PX + (bandPx || GROUP_LABEL_BAND_PX);
        const maxX = Math.max(minX, width - GROUP_PADDING_PX);
        const maxY = Math.max(minY, height - GROUP_PADDING_PX);
        return { minX, minY, maxX, maxY };
    }

    function isPointInPlantingContentArea(groupCell, center, bandPx) { // NEW: center-in-bounds replaces clamp-to-edge.
        if (!center) return false;
        const bounds = plantingContentBoundsLocal(groupCell, bandPx);
        const x = Number(center.x);
        const y = Number(center.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
        const eps = 0.01;
        return x >= bounds.minX - eps && x <= bounds.maxX + eps && y >= bounds.minY - eps && y <= bounds.maxY + eps;
    }

    function shiftedSlotCenterLocal(groupCell, r, c, spacingXpx, spacingYpx, bandPx) { // NEW: offset visibly moves the grid instead of being swallowed by clamping.
        const logical = interplantSlotCenterLocal(groupCell, r, c, spacingXpx, spacingYpx, bandPx);
        const offset = layoutGridOffsetPx(groupCell);
        return {
            x: logical.x + offset.x,
            y: logical.y + offset.y
        };
    }

    function layoutGridOffsetActive(groupCell) {
        return layoutGridOffsetPx(groupCell).active;
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

    function layoutSlotCenterLocal(groupCell, r, c, spacingXpx, spacingYpx, bandPx, iconDiamPx) {
        const shifted = shiftedSlotCenterLocal(groupCell, r, c, spacingXpx, spacingYpx, bandPx);
        return isPointInPlantingContentArea(groupCell, shifted, bandPx) ? shifted : null; // CHANGE: outside slot centers are omitted, not clamped.
    }

    function visualCenterFromLogicalCenter(groupCell, logicalCenter, rotationDeg) {
        if (!logicalCenter) return null;
        return rotatePointAround(logicalCenter, groupCenterLocal(groupCell), rotationDeg);
    }

    function visualSlotCenterLocal(groupCell, r, c, spacingXpx, spacingYpx, bandPx, iconDiamPx) {
        const logical = layoutSlotCenterLocal(groupCell, r, c, spacingXpx, spacingYpx, bandPx, iconDiamPx);
        return visualCenterFromLogicalCenter(groupCell, logical, getTilerRotationDeg(groupCell));
    }

    function geometryFromVisualCenter(center, width, height) {
        return new mxGeometry(center.x - width / 2, center.y - height / 2, width, height);
    }

    function tileGeometryAtSlot(groupCell, r, c, spacingXpx, spacingYpx, iconDiamPx, bandPx) {
        const center = visualSlotCenterLocal(groupCell, r, c, spacingXpx, spacingYpx, bandPx, iconDiamPx);
        if (!center) return null; // CHANGE: callers skip generated slots outside the content area.
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
            const { bandPx } = groupLabelMetrics(groupCell); // CHANGE: collapse count classification needs the same label band used by expanded tiling.
            const slotStats = classifyPlantingSlots(groupCell, spacingXpx, spacingYpx, bandPx, disabledSet);
            applyCounts(model, groupCell, slotStats, disabledSet); // CHANGE: LOD counts omit offset-shifted slots outside the planting content area.
            const actual = getNumberAttr(groupCell, ATTR_PLANT_COUNT_ACT, slotStats.actual);
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
        const { bandPx } = groupLabelMetrics(groupCell);
        const stats = classifyPlantingSlots(groupCell, spacingXpx, spacingYpx, bandPx, readDisabledSet(groupCell));
        return stats.actual <= LOD_TILE_THRESHOLD; // CHANGE: LOD follows visible in-bounds circles.
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
            const slotStats = classifyPlantingSlots(groupCell, spacingXpx, spacingYpx, bandPx, disabledSet2);
            const { actual } = applyCounts(model, groupCell, slotStats, disabledSet2); // CHANGE: expanded rebuild count matches omitted outside slots.
            updateGroupYield(model, groupCell, { abbr, countOverride: actual });

            if (slotStats.actual > MAX_TILES) {
                collapseToSummary(graph, groupCell, abbr, spacingXpx, spacingYpx, { layoutSnapshot: snapObj, useLiveSnapshot: false });
                return;
            }

            const cells = [];
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    const key = `${r},${c}`;
                    if (disabledSet2.has(key) || !slotStats.inBoundsKeys.has(key)) continue; // CHANGE: outside generated centers are removed instead of clamped.

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
                            const snapCenter = { x: sx + w / 2, y: sy + h / 2 };
                            if (isPointInPlantingContentArea(groupCell, snapCenter, bandPx)) { // CHANGE: outside manual snapshot centers are removed during retile.
                                geo = visualGeometryFromLogicalGeometry(groupCell, { x: sx, y: sy, w, h });
                                autoAttr = String(snap.auto || "0");
                                dirtyAttr = String(snap.dirty || "1");
                            }
                        }
                    }

                    // Default grid placement for non-snap tiles 
                    if (!geo) {
                        geo = tileGeometryAtSlot(groupCell, r, c, spacingXpx, spacingYpx, iconDiamPx, bandPx);
                    }
                    if (!geo) continue; // CHANGE: skip omitted slots defensively.

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
        const kids = graph.getChildVertices(groupCell) || [];
        const slotMap = new Map();
        const occupiedDisabledAutoTiles = [];
        const disabledSet = readDisabledSet(groupCell);
        if (classifyPlantingSlots(groupCell, spacingXpx, spacingYpx, bandPx, disabledSet).actual > MAX_TILES) return { changed: false, fallback: true, reason: "max-tiles" }; // CHANGE: raw omitted slots do not force fallback.
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
            const slotStats = classifyPlantingSlots(groupCell, spacingXpx, spacingYpx, bandPx, disabledSet2);
            const { actual } = applyCounts(model, groupCell, slotStats, disabledSet2); // CHANGE: in-place retile count uses in-bounds slots only.
            updateGroupYield(model, groupCell, { abbr, countOverride: actual });

            for (const [key, tile] of slotMap.entries()) {
                const parts = key.split(",");
                const r = Number(parts[0]);
                const c = Number(parts[1]);
                if (r >= rows || c >= cols || disabledSet2.has(key) || !slotStats.inBoundsKeys.has(key)) {
                    toRemove.push(tile); // CHANGE: spacing retile removes any tile whose slot center is outside the content area.
                    continue;
                }
                if (!(isAutoTile(tile) && !isDirty(tile)) && !isPointInPlantingContentArea(groupCell, childCenterInUnrotatedGroupSpace(groupCell, tile), bandPx)) {
                    toRemove.push(tile); // CHANGE: dirty/manual circles outside the content area are removed during retile.
                    slotMap.delete(key); // CHANGE: valid generated slots can be recreated after removing outside manual geometry.
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
                if (!geo) {
                    toRemove.push(tile);
                    slotMap.delete(key);
                    continue;
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
                    if (disabledSet2.has(key) || slotMap.has(key) || !slotStats.inBoundsKeys.has(key)) continue; // CHANGE: omitted slots are not recreated.
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

    const SIBLING_COMPANION_METADATA_ATTRS = [
        "companion_relation_id",
        "companion_rating",
        "companion_type",
        "companion_start_offset_days",
        "companion_recommended_start_offset_days",
        "companion_layout_template",
        "companion_layout_spacing_x_cm",
        "companion_layout_spacing_y_cm",
        "companion_offset_x_cm",
        "companion_offset_y_cm",
        "companion_layout_anchor_group_id",
        "companion_layout_interplant",
        "companion_layout_clamped"
    ]; // CHANGE: cloned scheduler siblings must not inherit legacy companion pair/layout identity.

    function stripSiblingCompanionMetadata(value) {
        if (!value || typeof value.removeAttribute !== "function") return;
        ["derived_mode", "derived_source_group_id", "derived_source_plant_id", "derived_target_plant_id"].concat(SIBLING_COMPANION_METADATA_ATTRS)
            .forEach(attr => value.removeAttribute(attr)); // CHANGE: Add Companion creates an ordinary planting; turnover writes fresh derived attrs after this strip.
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

    function nonNegativeFiniteNumber(value) {
        const n = Number(value);
        return Number.isFinite(n) && n >= 0 ? n : null;
    } // CHANGE

    function formatBedCmAttr(cm) {
        return String(Math.round((Number(cm) || 0) * 1000) / 1000);
    }

    function pathPresetWidthAttr(id) {
        return `default_path_${id}_width_cm`; // NEW
    }

    function pathPresetEnabledAttr(id) {
        return `default_path_${id}_enabled`; // NEW
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

    function defaultGardenDimensionsCmForUnits(units) {
        if (units === "metric") return { widthCm: DEFAULT_METRIC_GARDEN_WIDTH_CM, lengthCm: DEFAULT_METRIC_GARDEN_LENGTH_CM }; // NEW
        if (units === "imperial") return { widthCm: DEFAULT_IMPERIAL_GARDEN_WIDTH_CM, lengthCm: DEFAULT_IMPERIAL_GARDEN_LENGTH_CM }; // NEW
        return null; // NEW
    } // NEW

    function defaultPathWidthPresetsCmForUnits(units) {
        if (!units) return []; // NEW
        return DEFAULT_PATH_WIDTH_PRESETS.map(function (preset) { // NEW
            return {
                id: preset.id,
                label: preset.label,
                enabled: true,
                widthCm: units === "imperial" ? preset.imperialCm : preset.metricCm
            };
        }); // NEW
    } // NEW

    function getSavedPathWidthPresetsCm(moduleCell) {
        const units = getXmlAttr(moduleCell, "unit_system", "") || "metric"; // NEW
        const defaults = defaultPathWidthPresetsCmForUnits(units); // NEW
        return defaults.map(function (preset) { // NEW
            const savedWidth = positiveFiniteNumber(getXmlAttr(moduleCell, pathPresetWidthAttr(preset.id), ""));
            const enabledAttr = getXmlAttr(moduleCell, pathPresetEnabledAttr(preset.id), "");
            return {
                id: preset.id,
                label: preset.label,
                enabled: enabledAttr === "" ? true : enabledAttr !== "0",
                widthCm: savedWidth || preset.widthCm
            };
        }); // NEW
    } // NEW

    function hasSavedPathWidthPresetAttrs(moduleCell) {
        return DEFAULT_PATH_WIDTH_PRESETS.some(function (preset) { // NEW
            return getXmlAttr(moduleCell, pathPresetWidthAttr(preset.id), "") !== "" || getXmlAttr(moduleCell, pathPresetEnabledAttr(preset.id), "") !== ""; // NEW
        }); // NEW
    } // NEW

    function getEnabledPathWidthPresets(moduleCell) {
        return getSavedPathWidthPresetsCm(moduleCell).filter(function (preset) { // NEW
            return preset.enabled && positiveFiniteNumber(preset.widthCm);
        }).map(function (preset) {
            return Object.assign({}, preset, { widthUnits: cmToGraphUnits(preset.widthCm) });
        }); // NEW
    } // NEW

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

    function graphUnitsToCm(units) {
        return Number(units) / (PX_PER_CM * DRAW_SCALE);
    } // CHANGE

    function cmToGraphUnits(cm) {
        return Number(cm) * PX_PER_CM * DRAW_SCALE;
    } // CHANGE

    function defaultModuleMarginUnits() {
        return Math.round(cmToGraphUnits(DEFAULT_MODULE_MARGIN_CM));
    } // CHANGE

    function lengthCmToDisplay(cm, units) {
        return units === "imperial" ? Number(cm) / CM_PER_FOOT : Number(cm) / CM_PER_METER;
    } // CHANGE

    function formatPathDistanceLabelFromUnits(graphUnits, units) {
        const cm = Math.max(0, graphUnitsToCm(graphUnits)); // NEW
        if (units === "imperial") { // NEW
            const inches = cm / CM_PER_INCH; // NEW
            if (inches < 120) return `${Math.round(inches)} in`; // NEW
            return `${Math.round((inches / 12) * 10) / 10} ft`; // NEW
        }
        if (cm < 100) return `${Math.round(cm)} cm`; // NEW
        return `${Math.round((cm / 100) * 10) / 10} m`; // NEW
    } // NEW

    function positiveLengthDisplayToCm(value, units) {
        const n = positiveFiniteNumber(value);
        if (!n) return null;
        return units === "imperial" ? n * CM_PER_FOOT : n * CM_PER_METER;
    } // CHANGE

    function nonNegativeLengthDisplayToCm(value, units) {
        const n = nonNegativeFiniteNumber(value);
        if (n == null) return null;
        return units === "imperial" ? n * CM_PER_FOOT : n * CM_PER_METER;
    } // CHANGE

    function geometryDimensionsCm(moduleCell) {
        const geo = moduleCell && moduleCell.getGeometry ? moduleCell.getGeometry() : null;
        return geo ? { widthCm: graphUnitsToCm(Number(geo.width) || 0), lengthCm: graphUnitsToCm(Number(geo.height) || 0) } : null;
    } // CHANGE

    function isDefaultCreatedGardenGeometry(moduleCell) {
        const geo = moduleCell && moduleCell.getGeometry ? moduleCell.getGeometry() : null; // NEW
        if (!geo) return false; // NEW
        return Math.abs((Number(geo.width) || 0) - DEFAULT_CREATED_GARDEN_MODULE_WIDTH_UNITS) < BED_FIT_TOLERANCE
            && Math.abs((Number(geo.height) || 0) - DEFAULT_CREATED_GARDEN_MODULE_HEIGHT_UNITS) < BED_FIT_TOLERANCE; // NEW
    } // NEW

    function shouldUseNewGardenDimensionPresets(moduleCell) {
        if (!moduleCell || !isDefaultCreatedGardenGeometry(moduleCell)) return false; // NEW
        const city = String(getXmlAttr(moduleCell, "city_id", "") || getXmlAttr(moduleCell, "city_name", "") || "").trim(); // NEW
        const units = String(getXmlAttr(moduleCell, "unit_system", "") || "").trim(); // NEW
        return !city && !units && !getSavedDefaultBedDimensionsCm(moduleCell); // NEW
    } // NEW

    function getModuleHeaderHeightForSettings(moduleCell) {
        if (!moduleCell) return 0;
        if (graph.getStartSize) {
            const size = graph.getStartSize(moduleCell) || {};
            return Number(size.height) || 0;
        }
        const match = getStyleSafe(moduleCell).match(/(?:^|;)startSize=(\d+)(?=;|$)/);
        return match ? parseInt(match[1], 10) : 0;
    } // CHANGE

    function childUnionRelative(moduleCell) {
        const graphModel = graph.getModel && graph.getModel();
        const children = graphModel && graphModel.getChildren ? graphModel.getChildren(moduleCell) || [] : [];
        let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
        let any = false;
        children.forEach(child => {
            if (!(child && child.isVertex && child.isVertex())) return;
            const geo = graphModel.getGeometry ? graphModel.getGeometry(child) : child.getGeometry && child.getGeometry();
            if (!geo || geo.relative) return;
            const x = Number(geo.x) || 0;
            const y = Number(geo.y) || 0;
            const width = Number(geo.width) || 0;
            const height = Number(geo.height) || 0;
            left = Math.min(left, x);
            top = Math.min(top, y);
            right = Math.max(right, x + width);
            bottom = Math.max(bottom, y + height);
            any = true;
        });
        return any ? { left, top, right, bottom, width: right - left, height: bottom - top } : null;
    } // CHANGE


    function hasGardenSettingsSet(moduleCell) {
        if (!(moduleCell && moduleCell.getAttribute)) return false;
        const city = String(moduleCell.getAttribute("city_id") || moduleCell.getAttribute("city_name") || "").trim();
        const units = String(moduleCell.getAttribute("unit_system") || "").trim();
        return !!(city && units && getSavedDefaultBedDimensionsCm(moduleCell));
    }

    function getModuleMarginFromStyle(moduleCell, defaultPx = defaultModuleMarginUnits()) {
        const fallback = Number.isInteger(defaultPx) && defaultPx >= 0 ? defaultPx : defaultModuleMarginUnits(); // CHANGE
        const match = getStyleSafe(moduleCell).match(/(?:^|;)module_margin=(\d+)(?=;|$)/);
        return match ? parseInt(match[1], 10) : fallback;
    }

    function getGardenModuleMargin(moduleCell) {
        return 0; // CHANGE: garden modules no longer expose or honor internal margins.
    }

    function getGardenModuleExternalMargin(moduleCell) {
        const modulesApi = graph.__trellisModules;
        if (modulesApi && typeof modulesApi.getModuleExternalMargin === "function") return modulesApi.getModuleExternalMargin(moduleCell, 40); // NEW
        const match = getStyleSafe(moduleCell).match(/(?:^|;)module_external_margin=(\d+)(?=;|$)/); // NEW
        return match ? parseInt(match[1], 10) : 40; // NEW
    }

    function readModuleMarginInput(inputEl, units) {
        const raw = String(inputEl && inputEl.value || "").trim();
        if (!units || raw === "") return null; // CHANGE
        const cm = nonNegativeLengthDisplayToCm(raw, units); // CHANGE
        if (cm == null) return null; // CHANGE
        const n = Math.round(cmToGraphUnits(cm)); // CHANGE
        return Number.isSafeInteger(n) && n >= 0 ? n : null; // CHANGE
    }

    function setGardenModuleMargin(moduleCell, marginPx) {
        return 0; // CHANGE: retained for compatibility; garden internal margin is always zero.
    }

    function setGardenModuleExternalMargin(moduleCell, marginPx) {
        const modulesApi = graph.__trellisModules;
        if (modulesApi && typeof modulesApi.setModuleExternalMargin === "function") {
            modulesApi.setModuleExternalMargin(moduleCell, marginPx); // NEW
            return;
        }
        const graphModel = graph.getModel && graph.getModel();
        if (graphModel && graphModel.setStyle) graphModel.setStyle(moduleCell, upsertStyleKV(getStyleSafe(moduleCell), "module_external_margin", String(marginPx))); // NEW
        if (graph.fireEvent && typeof mxEventObject === "function") graph.fireEvent(new mxEventObject("usl:requestSetModuleExternalMargin", "cell", moduleCell, "marginPx", marginPx)); // NEW
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
        }, "add", { title: "Save this city's location and climate data to the local database." }); // CHANGE: explicit action tooltip.
        setTooltip(saveBtn, "Save the city climate record to the Trellis database.");
        btnRow.appendChild(closeBtn);
        btnRow.appendChild(saveBtn);
        div.appendChild(btnRow);

        refreshPicker(current?.city_id);
        fillForm(current || { city_id: 1, timezone: "America/Los_Angeles" }, !!current);
        ui.showDialog(div, 800, 720, true, true);
        elevateTrellisDialog();
    }


    // garden settings dialog (city + units + garden dimensions + default bed dimensions) // CHANGE
    async function showGardenSettingsDialog(ui, graph, moduleCell, onClose) {
        const model = graph.getModel();
        const curGardenName = String(getXmlAttr(moduleCell, "garden_name", "") || getXmlAttr(moduleCell, "label", "") || "Garden").trim() || "Garden";
        const curCityId = getXmlAttr(moduleCell, "city_id", "");
        const curCity = getXmlAttr(moduleCell, "city_name", "");
        const curUnits = getXmlAttr(moduleCell, "unit_system", "");
        const curModuleExternalMargin = getGardenModuleExternalMargin(moduleCell); // NEW
        const useNewGardenDimensionPresets = shouldUseNewGardenDimensionPresets(moduleCell); // NEW
        const curGardenDimsCm = useNewGardenDimensionPresets ? null : geometryDimensionsCm(moduleCell); // CHANGE
        const savedBedDimsCm = getSavedDefaultBedDimensionsCm(moduleCell);
        const savedPathPresetsCm = hasSavedPathWidthPresetAttrs(moduleCell) ? getSavedPathWidthPresetsCm(moduleCell) : null; // NEW
        let activeGardenDisplayUnits = curUnits || ""; // CHANGE
        let activeMarginDisplayUnits = curUnits || ""; // CHANGE
        let activeBedDisplayUnits = curUnits || "";
        let activePathDisplayUnits = curUnits || ""; // NEW
        let bedDimensionsEdited = false;
        let pathWidthsEdited = false; // NEW
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
        }, "open", { title: "Open the city editor to add or update location and climate data." }); // CHANGE: explicit action tooltip.
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

        const gardenWidthInput = document.createElement("input"); // CHANGE
        gardenWidthInput.type = "number"; // CHANGE
        gardenWidthInput.step = "0.1"; // CHANGE
        gardenWidthInput.min = "0.01"; // CHANGE
        gardenWidthInput.style.flex = "1"; // CHANGE
        const gardenWidthRow = row("Garden width:", gardenWidthInput); // CHANGE

        const gardenLengthInput = document.createElement("input"); // CHANGE
        gardenLengthInput.type = "number"; // CHANGE
        gardenLengthInput.step = "0.1"; // CHANGE
        gardenLengthInput.min = "0.01"; // CHANGE
        gardenLengthInput.style.flex = "1"; // CHANGE
        const gardenLengthRow = row("Garden length:", gardenLengthInput); // CHANGE

        const bedWidthInput = document.createElement("input");
        bedWidthInput.type = "number";
        bedWidthInput.step = "0.1"; // CHANGE
        bedWidthInput.min = "0.01";
        bedWidthInput.style.flex = "1";
        const bedWidthRow = row("Default bed width:", bedWidthInput);

        const bedLengthInput = document.createElement("input");
        bedLengthInput.type = "number";
        bedLengthInput.step = "0.1"; // CHANGE
        bedLengthInput.min = "0.01";
        bedLengthInput.style.flex = "1";
        const bedLengthRow = row("Default bed length:", bedLengthInput);
        mxEvent.addListener(bedWidthInput, "input", function () { bedDimensionsEdited = true; });
        mxEvent.addListener(bedLengthInput, "input", function () { bedDimensionsEdited = true; });

        const pathPresetRows = DEFAULT_PATH_WIDTH_PRESETS.map(function (preset) { // NEW
            const enabledInput = document.createElement("input"); // NEW
            enabledInput.type = "checkbox"; // NEW
            enabledInput.style.margin = "0"; // NEW
            const widthInput = document.createElement("input"); // NEW
            widthInput.type = "number"; // NEW
            widthInput.step = "0.1"; // CHANGE
            widthInput.min = "0.01"; // NEW
            widthInput.style.flex = "1"; // NEW
            const control = document.createElement("div"); // NEW
            control.style.display = "flex"; // NEW
            control.style.alignItems = "center"; // NEW
            control.style.gap = "8px"; // NEW
            control.style.flex = "1"; // NEW
            control.appendChild(enabledInput); // NEW
            control.appendChild(widthInput); // NEW
            const rowRef = row(`${preset.label} path width:`, control); // NEW
            mxEvent.addListener(enabledInput, "change", function () { // NEW
                pathWidthsEdited = true; // NEW
                widthInput.disabled = !enabledInput.checked; // NEW
            }); // NEW
            mxEvent.addListener(widthInput, "input", function () { pathWidthsEdited = true; }); // NEW
            return { preset, enabledInput, widthInput, row: rowRef }; // NEW
        }); // NEW

        const moduleExternalMarginInput = document.createElement("input"); // NEW
        moduleExternalMarginInput.type = "number"; // NEW
        moduleExternalMarginInput.step = "0.1"; // CHANGE
        moduleExternalMarginInput.min = "0"; // NEW
        moduleExternalMarginInput.style.flex = "1"; // NEW
        const moduleExternalMarginRow = row("External margin:", moduleExternalMarginInput); // NEW

        function readGardenInputsAsCm(units) {
            if (!units) return null; // CHANGE
            const widthCm = positiveLengthDisplayToCm(gardenWidthInput.value, units); // CHANGE
            const lengthCm = positiveLengthDisplayToCm(gardenLengthInput.value, units); // CHANGE
            return widthCm && lengthCm ? { widthCm, lengthCm } : null; // CHANGE
        }

        function gardenDimensionDisplayValue(cm, units, roundWhole) {
            const displayValue = lengthCmToDisplay(cm, units); // NEW
            if (!roundWhole) return formatBedDisplayValue(displayValue); // NEW
            return String(Math.max(1, Math.round(displayValue))); // NEW
        } // NEW

        function setGardenInputsFromCm(dimsCm, units, options) {
            if (!dimsCm || !units) {
                gardenWidthInput.value = ""; // CHANGE
                gardenLengthInput.value = ""; // CHANGE
                return;
            }
            const roundWhole = !!(options && options.roundWhole); // NEW
            gardenWidthInput.value = gardenDimensionDisplayValue(dimsCm.widthCm, units, roundWhole); // CHANGE
            gardenLengthInput.value = gardenDimensionDisplayValue(dimsCm.lengthCm, units, roundWhole); // CHANGE
        }

        function setModuleMarginInputFromUnits(inputEl, marginUnits, units) {
            if (!units) {
                inputEl.value = ""; // CHANGE
                return;
            }
            inputEl.value = formatBedDisplayValue(lengthCmToDisplay(graphUnitsToCm(marginUnits), units)); // CHANGE
        }

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

        function pathPresetById(presets, id) {
            return (presets || []).find(function (preset) { return preset.id === id; }) || null; // NEW
        } // NEW

        function readPathWidthInputsAsCm(units) {
            if (!units) return null; // NEW
            const defaults = defaultPathWidthPresetsCmForUnits(units); // NEW
            return pathPresetRows.map(function (item) { // NEW
                const defaultPreset = pathPresetById(defaults, item.preset.id) || item.preset; // NEW
                const current = positiveLengthDisplayToCm(item.widthInput.value, units); // NEW
                if (item.enabledInput.checked && !current) return null; // NEW
                return {
                    id: item.preset.id,
                    label: item.preset.label,
                    enabled: !!item.enabledInput.checked,
                    widthCm: current || defaultPreset.widthCm
                };
            }).filter(Boolean); // NEW
        } // NEW

        function setPathWidthInputsFromCm(presets, units) {
            const defaults = defaultPathWidthPresetsCmForUnits(units); // NEW
            pathPresetRows.forEach(function (item) { // NEW
                const preset = pathPresetById(presets, item.preset.id) || pathPresetById(defaults, item.preset.id); // NEW
                const enabled = !preset || preset.enabled !== false; // NEW
                item.enabledInput.checked = enabled; // NEW
                item.widthInput.disabled = !enabled || !units; // NEW
                item.widthInput.value = preset && units ? formatBedDisplayValue(lengthCmToDisplay(preset.widthCm, units)) : ""; // NEW
            }); // NEW
        } // NEW

        function syncGardenDimensionInputs(nextUnits) {
            const priorDims = activeGardenDisplayUnits ? readGardenInputsAsCm(activeGardenDisplayUnits) : null; // CHANGE
            const priorUnits = activeGardenDisplayUnits; // NEW
            const nextDims = priorDims || curGardenDimsCm || defaultGardenDimensionsCmForUnits(nextUnits); // CHANGE
            const enabled = !!nextUnits; // CHANGE
            const unitLabel = enabled ? bedDisplayUnitLabel(nextUnits) : ""; // CHANGE
            activeGardenDisplayUnits = nextUnits || ""; // CHANGE
            gardenWidthRow.label.textContent = enabled ? `Garden width (${unitLabel}):` : "Garden width:"; // CHANGE
            gardenLengthRow.label.textContent = enabled ? `Garden length (${unitLabel}):` : "Garden length:"; // CHANGE
            gardenWidthInput.disabled = !enabled; // CHANGE
            gardenLengthInput.disabled = !enabled; // CHANGE
            setGardenInputsFromCm(enabled ? nextDims : null, nextUnits, { roundWhole: !!(priorDims && priorUnits !== nextUnits) }); // CHANGE
        }

        function syncModuleExternalMarginInput(nextUnits) {
            const priorExternalMargin = activeMarginDisplayUnits ? readModuleMarginInput(moduleExternalMarginInput, activeMarginDisplayUnits) : null; // NEW
            const nextExternalMargin = priorExternalMargin == null ? curModuleExternalMargin : priorExternalMargin; // NEW
            const enabled = !!nextUnits; // CHANGE
            const unitLabel = enabled ? bedDisplayUnitLabel(nextUnits) : ""; // CHANGE
            activeMarginDisplayUnits = nextUnits || ""; // CHANGE
            moduleExternalMarginRow.label.textContent = enabled ? `External margin (${unitLabel}):` : "External margin:"; // NEW
            moduleExternalMarginInput.disabled = !enabled; // NEW
            if (enabled) { // CHANGE
                setModuleMarginInputFromUnits(moduleExternalMarginInput, nextExternalMargin, nextUnits); // NEW
            } else {
                moduleExternalMarginInput.value = ""; // NEW
            }
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

        function syncPathWidthInputs(nextUnits) {
            const priorPresets = activePathDisplayUnits && pathWidthsEdited ? readPathWidthInputsAsCm(activePathDisplayUnits) : null; // NEW
            const nextPresets = priorPresets || savedPathPresetsCm || defaultPathWidthPresetsCmForUnits(nextUnits); // NEW
            const enabled = !!nextUnits; // NEW
            const unitLabel = enabled ? bedDisplayUnitLabel(nextUnits) : ""; // NEW
            activePathDisplayUnits = nextUnits || ""; // NEW
            pathPresetRows.forEach(function (item) { // NEW
                item.row.label.textContent = enabled ? `${item.preset.label} path width (${unitLabel}):` : `${item.preset.label} path width:`; // NEW
                item.enabledInput.disabled = !enabled; // NEW
            }); // NEW
            setPathWidthInputsFromCm(enabled ? nextPresets : null, nextUnits); // NEW
        } // NEW

        function gardenDimensionsFit(widthUnits, heightUnits) {
            const union = childUnionRelative(moduleCell); // CHANGE
            if (!union) return true; // CHANGE
            const neededWidth = union.right; // CHANGE
            const neededHeight = union.bottom + getModuleHeaderHeightForSettings(moduleCell); // CHANGE
            return widthUnits + 0.5 >= neededWidth && heightUnits + 0.5 >= neededHeight; // CHANGE
        }

        function requiredGardenFitMessage(units) {
            const union = childUnionRelative(moduleCell); // CHANGE
            if (!union) return ""; // CHANGE
            const neededWidth = union.right; // CHANGE
            const neededHeight = union.bottom + getModuleHeaderHeightForSettings(moduleCell); // CHANGE
            const width = formatBedDisplayValue(lengthCmToDisplay(graphUnitsToCm(neededWidth), units)); // CHANGE
            const length = formatBedDisplayValue(lengthCmToDisplay(graphUnitsToCm(neededHeight), units)); // CHANGE
            return `Garden dimensions must be at least ${width} by ${length} ${bedDisplayUnitLabel(units)} to fit existing contents.`; // CHANGE
        }

        mxEvent.addListener(unitsSel, "change", function () {
            const nextUnits = (unitsSel.value || "").trim(); // CHANGE
            syncGardenDimensionInputs(nextUnits); // CHANGE
            syncModuleExternalMarginInput(nextUnits); // CHANGE
            syncBedDimensionInputs(nextUnits); // CHANGE
            syncPathWidthInputs(nextUnits); // NEW
        });
        syncGardenDimensionInputs(curUnits); // CHANGE
        syncModuleExternalMarginInput(curUnits); // CHANGE
        syncBedDimensionInputs(curUnits);
        syncPathWidthInputs(curUnits); // NEW

        function showError(msg) {
            err.textContent = msg;
            err.style.display = "block";
        }

        const btnRow = document.createElement("div");
        btnRow.style.display = "flex";
        btnRow.style.justifyContent = "flex-end";
        btnRow.style.gap = "8px";
        btnRow.style.marginTop = "12px";

        const cancelBtn = tilerButton("Cancel", () => ui.hideDialog(), "close"); // CHANGE: garden settings cancellation uses the red outline.
        const okBtn = tilerButton("OK", () => {
            err.style.display = "none";
            const chosenGardenName = String(gardenNameInput.value || "").trim() || "Garden";
            const chosenCityRow = selectedCityRow();
            const chosenCity = String(chosenCityRow?.city_name || "").trim();
            const chosenCityId = chosenCityRow?.city_id != null ? String(chosenCityRow.city_id) : "";
            const chosenUnits = (unitsSel.value || "").trim();
            const chosenGardenDimsCm = readGardenInputsAsCm(chosenUnits); // CHANGE
            const chosenBedDimsCm = readBedInputsAsCm(chosenUnits);
            const chosenPathPresetsCm = readPathWidthInputsAsCm(chosenUnits); // NEW
            const chosenModuleExternalMargin = readModuleMarginInput(moduleExternalMarginInput, chosenUnits); // NEW
            const chosenGardenWidthUnits = chosenGardenDimsCm ? cmToGraphUnits(chosenGardenDimsCm.widthCm) : null; // CHANGE
            const chosenGardenHeightUnits = chosenGardenDimsCm ? cmToGraphUnits(chosenGardenDimsCm.lengthCm) : null; // CHANGE

            if (!chosenCity) { showError("City is required."); citySel.focus(); return; }
            if (!chosenUnits) { showError("Units are required."); unitsSel.focus(); return; }
            if (!chosenGardenDimsCm) { showError("Garden width and length must be positive numbers."); gardenWidthInput.focus(); return; } // CHANGE
            if (!chosenBedDimsCm) { showError("Default bed width and length must be positive numbers."); bedWidthInput.focus(); return; }
            if (!chosenPathPresetsCm || chosenPathPresetsCm.length !== DEFAULT_PATH_WIDTH_PRESETS.length) { showError("Enabled path widths must be positive numbers."); pathPresetRows[0].widthInput.focus(); return; } // NEW
            if (chosenModuleExternalMargin == null) { showError("External margin must be a non-negative number."); moduleExternalMarginInput.focus(); return; } // NEW
            if (!gardenDimensionsFit(chosenGardenWidthUnits, chosenGardenHeightUnits)) { showError(requiredGardenFitMessage(chosenUnits)); gardenWidthInput.focus(); return; } // CHANGE

            ui.hideDialog();
            model.beginUpdate();
            try {
                const geo = model.getGeometry(moduleCell); // CHANGE
                if (geo) { // CHANGE
                    const nextGeo = geo.clone ? geo.clone() : new mxGeometry(geo.x, geo.y, geo.width, geo.height); // CHANGE
                    nextGeo.width = chosenGardenWidthUnits; // CHANGE
                    nextGeo.height = chosenGardenHeightUnits; // CHANGE
                    model.setGeometry(moduleCell, nextGeo); // CHANGE
                } // CHANGE
                setCellAttrsNoTxn(model, moduleCell, {
                    garden_name: chosenGardenName,
                    label: chosenGardenName,
                    city_id: chosenCityId,
                    city_name: chosenCity,
                    unit_system: chosenUnits,
                    [DEFAULT_BED_WIDTH_CM_ATTR]: formatBedCmAttr(chosenBedDimsCm.widthCm),
                    [DEFAULT_BED_LENGTH_CM_ATTR]: formatBedCmAttr(chosenBedDimsCm.lengthCm),
                });
                const pathAttrs = {}; // NEW
                chosenPathPresetsCm.forEach(function (preset) { // NEW
                    pathAttrs[pathPresetEnabledAttr(preset.id)] = preset.enabled ? "1" : "0"; // NEW
                    pathAttrs[pathPresetWidthAttr(preset.id)] = formatBedCmAttr(preset.widthCm); // NEW
                }); // NEW
                setCellAttrsNoTxn(model, moduleCell, pathAttrs); // NEW
                setGardenModuleExternalMargin(moduleCell, chosenModuleExternalMargin); // NEW
            } finally {
                model.endUpdate();
            }
            graph.refresh(moduleCell);

        }, "add", { title: "Save these settings to the selected garden module." }); // CHANGE: explicit action tooltip.

        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(okBtn);
        div.appendChild(btnRow);

        ui.showDialog(div, 460, 560, true, true, notifyClose); // CHANGE
        elevateTrellisDialog();
        gardenNameInput.focus();
    }

    let openGardenSettingsDialogWithOverlaySuppressed = null;

    function cellBoundsInModel(cell) { // NEW
        const model = graph.getModel(); // NEW
        const state = graph.view && graph.view.getState ? graph.view.getState(cell) : null; // NEW
        if (state && Number.isFinite(Number(state.x)) && Number.isFinite(Number(state.y))) { // NEW
            const scale = Number(graph.view && graph.view.scale) || 1; // NEW
            const translate = graph.view && graph.view.translate ? graph.view.translate : { x: 0, y: 0 }; // NEW
            return { // NEW
                x: Number(state.x) / scale - (Number(translate.x) || 0), // NEW
                y: Number(state.y) / scale - (Number(translate.y) || 0), // NEW
                width: Math.max(0, (Number(state.width) || 0) / scale), // NEW
                height: Math.max(0, (Number(state.height) || 0) / scale) // NEW
            }; // NEW
        } // NEW

        const geo = cell && model.getGeometry ? model.getGeometry(cell) : null; // NEW
        if (!geo) return null; // NEW
        let x = Number(geo.x) || 0; // NEW
        let y = Number(geo.y) || 0; // NEW
        let parent = model.getParent ? model.getParent(cell) : cell && cell.parent; // NEW
        while (parent) { // NEW
            const parentGeo = model.getGeometry ? model.getGeometry(parent) : null; // NEW
            if (parentGeo) { x += Number(parentGeo.x) || 0; y += Number(parentGeo.y) || 0; } // NEW
            parent = model.getParent ? model.getParent(parent) : parent.parent; // NEW
        } // NEW
        return { x, y, width: Math.max(0, Number(geo.width) || 0), height: Math.max(0, Number(geo.height) || 0) }; // NEW
    } // NEW

    function zoomGardenToViewport(moduleCell) { // NEW
        const bounds = cellBoundsInModel(moduleCell); // NEW
        if (!bounds || !graph.container || typeof graph.fitWindow !== "function") { // NEW
            if (graph.scrollCellToVisible) graph.scrollCellToVisible(moduleCell, true); // NEW
            return; // NEW
        } // NEW
        graph.fitWindow(bounds, 48); // NEW
        setTimeout(function () { // NEW
            if (graph.view && Number(graph.view.scale) > 1 && graph.zoomTo) graph.zoomTo(1); // NEW
        }, 0); // NEW
    } // NEW

    function selectAndZoomToGarden(moduleCell) { // NEW
        if (!moduleCell || !isGardenModule(moduleCell)) return; // NEW
        if (graph.setSelectionCell) graph.setSelectionCell(moduleCell); // NEW
        zoomGardenToViewport(moduleCell); // NEW
    } // NEW

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
        let schedulePlantingBtn = null; // CHANGE
        let allocateModeBtn = null; // NEW
        let irrigationModeBtn = null; // CHANGE
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

        function alertSchedulePlantingError(error) {
            const message = error && error.message ? error.message : String(error || "Unknown scheduling error");
            if (ui && typeof ui.alert === "function") ui.alert("Scheduling error: " + message);
            else if (typeof mxUtils !== "undefined" && typeof mxUtils.alert === "function") mxUtils.alert("Scheduling error: " + message);
        } // CHANGE

        function openBedScheduleDialogFromOverlay(bedCell) {
            const scheduler = typeof window !== "undefined" && window.USL && window.USL.scheduler;
            if (!scheduler || typeof scheduler.openBedScheduleDialog !== "function") {
                if (ui && typeof ui.alert === "function") ui.alert("Scheduler plugin is unavailable.");
                else if (typeof mxUtils !== "undefined" && typeof mxUtils.alert === "function") mxUtils.alert("Scheduler plugin is unavailable.");
                return;
            }
            try {
                Promise.resolve(scheduler.openBedScheduleDialog(ui, bedCell)).catch(alertSchedulePlantingError);
                hideToolbar();
            } catch (error) {
                alertSchedulePlantingError(error);
            }
        } // CHANGE

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
            schedulePlantingBtn = makeButton("Schedule Planting", "add"); // CHANGE
            allocateModeBtn = makeButton("Enter Allocation Mode", "open"); // NEW
            irrigationModeBtn = makeButton("Enter Irrigation Design Mode", "open"); // CHANGE
            toolbar.appendChild(labelInputWrap);
            toolbar.appendChild(settingsBtn);
            toolbar.appendChild(addBedBtn);
            toolbar.appendChild(schedulePlantingBtn); // CHANGE
            toolbar.appendChild(allocateModeBtn); // NEW
            toolbar.appendChild(irrigationModeBtn); // CHANGE

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

            mxEvent.addListener(schedulePlantingBtn, "click", function (evt) {
                mxEvent.consume(evt);
                const moduleCell = activeModuleCell;
                const bedCell = activeBedCell;
                if (!moduleCell || !bedCell || activeOverlayMode !== "bed" || !hasGardenSettingsSet(moduleCell)) return;
                openBedScheduleDialogFromOverlay(bedCell);
            }); // CHANGE

            mxEvent.addListener(allocateModeBtn, "click", function (evt) { // NEW
                mxEvent.consume(evt); // NEW
                const moduleCell = activeModuleCell; // NEW
                if (!moduleCell || !hasGardenSettingsSet(moduleCell)) return; // NEW
                openAllocateModeForModule(moduleCell); // NEW
                hideToolbar(); // NEW
            }); // NEW

            mxEvent.addListener(irrigationModeBtn, "click", function (evt) { // CHANGE
                mxEvent.consume(evt);
                const moduleCell = activeModuleCell;
                if (!moduleCell || !hasGardenSettingsSet(moduleCell)) return; // CHANGE
                openIrrigationModeForModule(moduleCell, activeBedCell); // CHANGE
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

        function openIrrigationModeForModule(moduleCell, selectedBedCell) { // CHANGE
            if (typeof window !== "undefined" && window.TrellisIrrigationPlanner && typeof window.TrellisIrrigationPlanner.openIrrigationMode === "function") { // CHANGE
                window.TrellisIrrigationPlanner.openIrrigationMode(moduleCell, { selectCell: selectedBedCell || null, preserveViewport: true }); // CHANGE
                return;
            }
            if (graph.setSelectionCell) graph.setSelectionCell(selectedBedCell || moduleCell); // CHANGE
            const action = ui.actions && ui.actions.get && ui.actions.get("trellisIrrigationPlanner"); // CHANGE
            if (action && typeof action.funct === "function") action.funct();
        }

        function openAllocateModeForModule(moduleCell) { // NEW
            if (!moduleCell) return; // NEW
            const moduleCellId = String(moduleCell.getId ? moduleCell.getId() : moduleCell.id || "").trim(); // NEW
            if (!moduleCellId) return; // NEW
            try { window.dispatchEvent(new CustomEvent(ALLOCATE_PLAN_EVENT, { detail: { moduleCellId: moduleCellId, year: getCurrentGardenYear(moduleCell) } })); } catch (_) { } // NEW
        } // NEW

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

        /** Allocation suppresses bed controls while leaving module controls available. */ // CHANGE
        function isAllocationModeActiveForOverlay() { // CHANGE
            const modes = window.Trellis && window.Trellis.interactionModes; // CHANGE
            const active = modes && typeof modes.getActive === "function" ? modes.getActive() : null; // CHANGE
            return !!(active && active.mode === "allocate"); // CHANGE
        } // CHANGE

        function isIrrigationModeActiveForOverlay() {
            const planner = graph.__trellisIrrigationPlanner || (typeof window !== "undefined" && window.TrellisIrrigationPlanner);
            return !!(planner && typeof planner.isIrrigationModeActive === "function" && planner.isIrrigationModeActive());
        }

        function isTeamPermissionModeActiveForOverlay() {
            const users = typeof window !== "undefined" && window.Trellis && window.Trellis.users; // NEW
            return !!(users && typeof users.isTeamPermissionModeActive === "function" && users.isTeamPermissionModeActive()); // NEW
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
            if (isTeamPermissionModeActiveForOverlay()) { hideToolbar(); return; } // NEW
            if (activeOverlayMode === "bed" && isAllocationModeActiveForOverlay()) { hideToolbar(); return; } // CHANGE: repaint cannot reveal allocation-suppressed controls.
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
            if (!toolbar || !labelInputWrap || !settingsBtn || !addBedBtn || !schedulePlantingBtn || !allocateModeBtn || !irrigationModeBtn || !moduleCell) return; // CHANGE
            const hasSettings = hasGardenSettingsSet(moduleCell);
            const bedMode = activeOverlayMode === "bed";
            labelInputWrap.style.display = bedMode ? "none" : "flex";
            if (!bedMode) renderGardenModuleLabelInput(moduleCell);
            settingsBtn.style.display = bedMode ? "none" : "";
            addBedBtn.style.display = bedMode ? "none" : "";
            schedulePlantingBtn.style.display = bedMode ? "" : "none"; // CHANGE
            allocateModeBtn.style.display = bedMode ? "" : "none"; // NEW
            irrigationModeBtn.style.display = ""; // CHANGE
            settingsBtn.textContent = hasSettings ? "Edit Garden Settings" : "Set Garden Settings";
            settingsBtn.title = "Edit this garden module\'s location, dimensions, default bed sizes, and growing settings."; // CHANGE
            addBedBtn.disabled = !hasSettings;
            addBedBtn.title = hasSettings ? "Add the default-sized garden bed at the selected location" : "Set garden settings before adding beds";
            addBedBtn.style.opacity = hasSettings ? "1" : "0.55";
            addBedBtn.style.cursor = hasSettings ? "pointer" : "default";
            const canAddGroupInBed = bedMode && !!activeBedCell && hasSettings; // CHANGE
            schedulePlantingBtn.disabled = !canAddGroupInBed; // CHANGE
            schedulePlantingBtn.title = !bedMode || !activeBedCell ? "Select a garden bed before scheduling plants" : (hasSettings ? "Schedule a new planting fitted to this garden bed" : "Set garden settings before scheduling plants"); // CHANGE
            schedulePlantingBtn.style.opacity = canAddGroupInBed ? "1" : "0.55"; // CHANGE
            schedulePlantingBtn.style.cursor = canAddGroupInBed ? "pointer" : "default"; // CHANGE
            allocateModeBtn.disabled = !hasSettings; // NEW
            allocateModeBtn.title = hasSettings ? "Enter allocation mode" : "Set garden settings before entering allocation mode"; // NEW
            allocateModeBtn.style.opacity = hasSettings ? "1" : "0.55"; // NEW
            allocateModeBtn.style.cursor = hasSettings ? "pointer" : "default"; // NEW
            irrigationModeBtn.disabled = !hasSettings; // CHANGE
            irrigationModeBtn.title = hasSettings ? "Enter irrigation design mode" : "Set garden settings before entering irrigation design mode"; // CHANGE
            irrigationModeBtn.style.opacity = hasSettings ? "1" : "0.55"; // CHANGE
            irrigationModeBtn.style.cursor = hasSettings ? "pointer" : "default"; // CHANGE
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
            if (isTeamPermissionModeActiveForOverlay()) { // NEW
                hideToolbar(); // NEW
                return; // NEW
            } // NEW
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
            if (target.mode === "bed" && isAllocationModeActiveForOverlay()) { hideToolbar(); return; } // CHANGE: keep target state current before hiding bed controls.
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
        mxEvent.addListener(window, "trellisInteractionModeChanged", scheduleRefresh); // CHANGE: mode exit restores controls without reselection.
        mxEvent.addListener(window, "trellisTeamPermissionModeChanged", function (evt) { if (evt && evt.detail && evt.detail.active) hideToolbar(); else scheduleRefresh(); }); // NEW
        setTimeout(scheduleRefresh, 0);
    }


    // Listen for garden-module settings requests emitted by the module plugin               
    if (!graph.__uslGardenSettingsListenerInstalled) {
        graph.__uslGardenSettingsListenerInstalled = true;

        graph.addListener("usl:gardenModuleNeedsSettings", function (sender, evt) {
            const moduleCell = evt.getProperty("cell");
            if (!moduleCell || !isGardenModule(moduleCell)) return;
            const focusAfterSettingsClose = !!(evt && evt.getProperty && evt.getProperty("focusAfterSettingsClose")); // NEW
            function handleSettingsClose() { // NEW
                if (graph.__plantTilerRefreshGardenModuleOverlay) graph.__plantTilerRefreshGardenModuleOverlay(); // NEW
                if (focusAfterSettingsClose) selectAndZoomToGarden(moduleCell); // NEW
            } // NEW

            if (hasGardenSettingsSet(moduleCell)) { if (focusAfterSettingsClose) selectAndZoomToGarden(moduleCell); return; } // CHANGE

            // Defer dialog until after current paint/update completes                        
            setTimeout(() => {
                // Re-check in case settings were set during the delay                         
                if (hasGardenSettingsSet(moduleCell)) { if (focusAfterSettingsClose) selectAndZoomToGarden(moduleCell); return; } // CHANGE
                if (openGardenSettingsDialogWithOverlaySuppressed) {
                    openGardenSettingsDialogWithOverlaySuppressed(moduleCell, handleSettingsClose); // CHANGE
                } else {
                    showGardenSettingsDialog(ui, graph, moduleCell, handleSettingsClose); // CHANGE
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

    function normalizeRotationDeg(deg) {
        const n = ((Number(deg) || 0) % 360 + 360) % 360; // NEW
        return Math.min(n, 360 - n); // NEW
    } // NEW

    function isAxisAlignedPathSnapBed(cell) {
        return isGardenBed(cell) && normalizeRotationDeg(getTilerRotationDeg(cell)) <= ROTATION_EPS_DEG; // NEW
    } // NEW

    function rectRight(rect) {
        return rect ? (Number(rect.x) || 0) + (Number(rect.w) || 0) : 0; // NEW
    } // NEW

    function rectBottom(rect) {
        return rect ? (Number(rect.y) || 0) + (Number(rect.h) || 0) : 0; // NEW
    } // NEW

    function rectsOverlapOnX(a, b) {
        return Math.min(rectRight(a), rectRight(b)) - Math.max(a.x, b.x) > 0; // NEW
    } // NEW

    function rectsOverlapOnY(a, b) {
        return Math.min(rectBottom(a), rectBottom(b)) - Math.max(a.y, b.y) > 0; // NEW
    } // NEW

    function cloneModelRect(rect) {
        return rect ? { x: Number(rect.x) || 0, y: Number(rect.y) || 0, w: Math.max(0, Number(rect.w) || 0), h: Math.max(0, Number(rect.h) || 0) } : null; // NEW
    } // NEW

    function pathSnapToleranceUnits(widthUnits) {
        return Math.min(Math.max(0, Number(widthUnits) || 0) * PATH_WIDTH_TOLERANCE_RATIO, cmToGraphUnits(PATH_WIDTH_TOLERANCE_CAP_CM)); // NEW
    } // NEW

    function bestPathPresetForGap(gapUnits, presets) {
        let best = null; // NEW
        for (const preset of (presets || [])) { // NEW
            const target = Number(preset.widthUnits) || 0; // NEW
            if (target <= 0) continue; // NEW
            const diff = Math.abs((Number(gapUnits) || 0) - target); // NEW
            if (diff > pathSnapToleranceUnits(target)) continue; // NEW
            if (!best || diff < best.diff || (diff === best.diff && target < best.target)) { // NEW
                best = Object.assign({}, preset, { target, diff }); // NEW
            } // NEW
        } // NEW
        return best; // NEW
    } // NEW

    function rectInsideModuleBounds(moduleCell, rect) {
        const geo = moduleCell && moduleCell.getGeometry ? moduleCell.getGeometry() : null; // NEW
        if (!geo || !rect) return false; // NEW
        const width = Number(geo.width) || 0; // NEW
        const height = Number(geo.height) || 0; // NEW
        return rect.x >= -0.5 && rect.y >= -0.5 && rectRight(rect) <= width + 0.5 && rectBottom(rect) <= height + 0.5; // NEW
    } // NEW

    function movedRect(rect, dx, dy) {
        const out = cloneModelRect(rect); // NEW
        if (!out) return null; // NEW
        out.x += Number(dx) || 0; // NEW
        out.y += Number(dy) || 0; // NEW
        return out; // NEW
    } // NEW

    function gapBandRectForDirection(activeRect, neighborRect, direction, gap) {
        if (!activeRect || !neighborRect || !(gap > 0)) return null; // NEW
        if (direction === "above" || direction === "below") { // NEW
            const x = Math.max(activeRect.x, neighborRect.x); // NEW
            const right = Math.min(rectRight(activeRect), rectRight(neighborRect)); // NEW
            return { x, y: direction === "above" ? rectBottom(neighborRect) : rectBottom(activeRect), w: Math.max(1, right - x), h: gap }; // NEW
        } // NEW
        const y = Math.max(activeRect.y, neighborRect.y); // NEW
        const bottom = Math.min(rectBottom(activeRect), rectBottom(neighborRect)); // NEW
        return { x: direction === "left" ? rectRight(neighborRect) : rectRight(activeRect), y, w: gap, h: Math.max(1, bottom - y) }; // NEW
    } // NEW

    function directBedNeighborsByDirection(moduleCell, bedCell, activeRect) {
        const out = { above: null, below: null, left: null, right: null }; // NEW
        if (!moduleCell || !bedCell || !activeRect) return out; // NEW
        const beds = (graph.getChildVertices(moduleCell) || []).filter(isAxisAlignedPathSnapBed); // NEW
        for (const other of beds) { // NEW
            if (!other || other === bedCell || other.id === bedCell.id) continue; // NEW
            const rect = getModelRect(other); // NEW
            if (!rect || rect.w <= 0 || rect.h <= 0) continue; // NEW
            const aboveGap = activeRect.y - rectBottom(rect); // NEW
            if (aboveGap > 0 && rectsOverlapOnX(activeRect, rect) && (!out.above || aboveGap < out.above.gap)) out.above = { direction: "above", bed: other, rect, gap: aboveGap }; // NEW
            const belowGap = rect.y - rectBottom(activeRect); // NEW
            if (belowGap > 0 && rectsOverlapOnX(activeRect, rect) && (!out.below || belowGap < out.below.gap)) out.below = { direction: "below", bed: other, rect, gap: belowGap }; // NEW
            const leftGap = activeRect.x - rectRight(rect); // NEW
            if (leftGap > 0 && rectsOverlapOnY(activeRect, rect) && (!out.left || leftGap < out.left.gap)) out.left = { direction: "left", bed: other, rect, gap: leftGap }; // NEW
            const rightGap = rect.x - rectRight(activeRect); // NEW
            if (rightGap > 0 && rectsOverlapOnY(activeRect, rect) && (!out.right || rightGap < out.right.gap)) out.right = { direction: "right", bed: other, rect, gap: rightGap }; // NEW
        } // NEW
        return out; // NEW
    } // NEW

    function pathSnapDeltaForDirection(activeRect, neighbor, preset) {
        const target = preset && Number(preset.target || preset.widthUnits) || 0; // NEW
        if (!activeRect || !neighbor || target <= 0) return null; // NEW
        if (neighbor.direction === "above") return { dx: 0, dy: rectBottom(neighbor.rect) + target - activeRect.y }; // NEW
        if (neighbor.direction === "below") return { dx: 0, dy: neighbor.rect.y - target - activeRect.h - activeRect.y }; // NEW
        if (neighbor.direction === "left") return { dx: rectRight(neighbor.rect) + target - activeRect.x, dy: 0 }; // NEW
        if (neighbor.direction === "right") return { dx: neighbor.rect.x - target - activeRect.w - activeRect.x, dy: 0 }; // NEW
        return null; // NEW
    } // NEW

    function buildPathSnapCandidate(moduleCell, activeRect, neighbor, presets) {
        if (!neighbor) return null; // NEW
        const preset = bestPathPresetForGap(neighbor.gap, presets); // NEW
        const band = gapBandRectForDirection(activeRect, neighbor.rect, neighbor.direction, neighbor.gap); // NEW
        const candidate = Object.assign({}, neighbor, { band, preset: null, snap: null }); // NEW
        if (!preset) return candidate; // NEW
        const delta = pathSnapDeltaForDirection(activeRect, neighbor, preset); // NEW
        if (!delta) return candidate; // NEW
        const finalRect = movedRect(activeRect, delta.dx, delta.dy); // NEW
        if (!rectInsideModuleBounds(moduleCell, finalRect)) return candidate; // NEW
        candidate.preset = preset; // NEW
        candidate.snap = Object.assign({}, delta, { preset, axis: neighbor.direction === "left" || neighbor.direction === "right" ? "x" : "y" }); // NEW
        return candidate; // NEW
    } // NEW

    function chooseAxisPathSnap(candidates, axis) {
        const matches = candidates.filter(function (candidate) { return candidate && candidate.snap && candidate.snap.axis === axis; }); // NEW
        matches.sort(function (a, b) { // NEW
            const diff = a.preset.diff - b.preset.diff; // NEW
            if (diff) return diff; // NEW
            return a.gap - b.gap; // NEW
        }); // NEW
        return matches[0] || null; // NEW
    } // NEW

    function evaluateBedPathSnap(moduleCell, bedCell, activeRect) {
        const units = getXmlAttr(moduleCell, "unit_system", "") || "metric"; // NEW
        const presets = getEnabledPathWidthPresets(moduleCell); // NEW
        const directions = directBedNeighborsByDirection(moduleCell, bedCell, activeRect); // NEW
        const candidates = ["above", "below", "left", "right"].map(function (direction) { // NEW
            return buildPathSnapCandidate(moduleCell, activeRect, directions[direction], presets); // NEW
        }).filter(Boolean); // NEW
        const xSnap = chooseAxisPathSnap(candidates, "x"); // NEW
        const ySnap = chooseAxisPathSnap(candidates, "y"); // NEW
        const dx = xSnap && xSnap.snap ? xSnap.snap.dx : 0; // NEW
        const dy = ySnap && ySnap.snap ? ySnap.snap.dy : 0; // NEW
        candidates.forEach(function (candidate) { // NEW
            candidate.activeSnap = candidate === xSnap || candidate === ySnap; // NEW
        }); // NEW
        return { moduleCell, bedCell, activeRect, units, candidates, xSnap, ySnap, dx, dy }; // NEW
    } // NEW

    let lastBedPathSnapPointerEvent = null; // NEW

    function isBedPathSnapAltBypassActive() {
        return !!(lastBedPathSnapPointerEvent && mxEvent.isAltDown && mxEvent.isAltDown(lastBedPathSnapPointerEvent)); // NEW
    } // NEW

    function canConsiderBedPathSnapForCells(cells, evt, clone, target) {
        if (clone || target || (evt && mxEvent.isAltDown && mxEvent.isAltDown(evt))) return false; // CHANGE
        const snapCells = (cells || []).filter(Boolean); // CHANGE
        return snapCells.length === 1 && isAxisAlignedPathSnapBed(snapCells[0]) && !!findGardenModuleAncestor(graph, snapCells[0]); // CHANGE
    } // NEW

    function resolveBedPathSnapMoveContext(cells, evt, clone, target) {
        if (clone || !evt || (mxEvent.isAltDown && mxEvent.isAltDown(evt))) return null; // CHANGE
        const moveCells = (cells || []).filter(Boolean); // CHANGE
        const workspaceHandleDrag = graph.__trellisWorkspaceHandleDragActive === true; // CHANGE
        if (target && !workspaceHandleDrag) return null; // CHANGE
        const bedCell = moveCells[0]; // CHANGE
        const moduleCell = isAxisAlignedPathSnapBed(bedCell) ? findGardenModuleAncestor(graph, bedCell) : null; // CHANGE
        if (moveCells.length === 1 && moduleCell) {
            return { bedCell, moveCells: [bedCell], moduleCell, source: "single-bed" }; // CHANGE
        } // CHANGE
        if (!workspaceHandleDrag || moveCells.length < 2) return null; // CHANGE
        if (!moduleCell) return null; // CHANGE
        return { bedCell, moveCells: moveCells.slice(), moduleCell, source: "workspace-handle" }; // CHANGE
    } // CHANGE

    function applyBedPathSnapDeltaNoTxn(model, cells, dx, dy) {
        const changed = []; // CHANGE
        const seen = new Set(); // CHANGE
        for (const cell of (cells || [])) { // CHANGE
            const id = cell && (cell.id || (cell.getId && cell.getId())); // CHANGE
            if (!cell || (id && seen.has(id))) continue; // CHANGE
            if (id) seen.add(id); // CHANGE
            const geo = model.getGeometry ? model.getGeometry(cell) : cell.getGeometry && cell.getGeometry(); // CHANGE
            if (!geo) continue; // CHANGE
            const next = geo.clone ? geo.clone() : new mxGeometry(geo.x, geo.y, geo.width, geo.height); // CHANGE
            next.x = (Number(next.x) || 0) + dx; // CHANGE
            next.y = (Number(next.y) || 0) + dy; // CHANGE
            model.setGeometry(cell, next); // CHANGE
            changed.push(cell); // CHANGE
        } // CHANGE
        return changed; // CHANGE
    } // CHANGE

    function applyBedPathSnapEvaluationNoTxn(model, context, opts) {
        const bedCell = context && context.bedCell; // CHANGE
        const moduleCell = context && context.moduleCell; // CHANGE
        if (!model || !bedCell || !moduleCell || !isAxisAlignedPathSnapBed(bedCell)) return null; // CHANGE
        if (opts && opts.event && mxEvent.isAltDown && mxEvent.isAltDown(opts.event)) return null; // CHANGE
        const rect = getModelRect(bedCell); // CHANGE
        if (!rect) return null; // CHANGE
        const evaluation = evaluateBedPathSnap(moduleCell, bedCell, rect); // CHANGE
        if (!evaluation || (!evaluation.dx && !evaluation.dy)) return evaluation; // CHANGE
        const changed = applyBedPathSnapDeltaNoTxn(model, (context && context.moveCells) || [bedCell], evaluation.dx, evaluation.dy); // CHANGE
        evaluation.applied = changed.length > 0; // CHANGE
        evaluation.appliedCells = changed; // CHANGE
        return evaluation; // CHANGE
    } // CHANGE

    function applyBedPathSnapNoTxn(model, bedCell, opts) {
        const moduleCell = bedCell && isAxisAlignedPathSnapBed(bedCell) ? findGardenModuleAncestor(graph, bedCell) : null; // CHANGE
        return applyBedPathSnapEvaluationNoTxn(model, { bedCell, moduleCell, moveCells: (opts && opts.moveCells) || [bedCell] }, opts); // CHANGE
    } // NEW

    function installBedPathSnapOverlay() {
        if (graph.__plantTilerBedPathSnapOverlayInstalled) return; // NEW
        graph.__plantTilerBedPathSnapOverlayInstalled = true; // NEW

        let overlay = null; // NEW
        let refreshTimer = null; // NEW

        function overlayHost() {
            return graph.container || null; // NEW
        } // NEW

        function ensureOverlayHost() {
            const host = overlayHost(); // NEW
            if (!host) return null; // NEW
            const style = window.getComputedStyle ? window.getComputedStyle(host) : null; // NEW
            if (style && style.position === "static") host.style.position = "relative"; // NEW
            return host; // NEW
        } // NEW

        function ensureOverlay() {
            const host = ensureOverlayHost(); // NEW
            if (!host) return null; // NEW
            if (!overlay) { // NEW
                overlay = document.createElement("div"); // NEW
                overlay.className = PATH_SNAP_OVERLAY_CLASS; // NEW
                overlay.style.cssText = `position:absolute;left:0;top:0;right:0;bottom:0;z-index:${GRAPH_OVERLAY_Z.ANNOTATION};pointer-events:none;display:none;font:12px Arial,sans-serif;`; // NEW
            } // NEW
            if (overlay.parentNode !== host) host.appendChild(overlay); // NEW
            return overlay; // NEW
        } // NEW

        function hideOverlay() {
            if (overlay) { // NEW
                overlay.innerHTML = ""; // NEW
                overlay.style.display = "none"; // NEW
            } // NEW
        } // NEW

        function selectedPathSnapBed() {
            const cells = graph.getSelectionCells ? (graph.getSelectionCells() || []) : []; // NEW
            return cells.length === 1 && isAxisAlignedPathSnapBed(cells[0]) ? cells[0] : null; // NEW
        } // NEW

        function activeResizeRectForBed(bed) {
            const handlers = graph.selectionCellsHandler; // NEW
            const handler = handlers && typeof handlers.getHandler === "function" ? handlers.getHandler(bed) : null; // NEW
            const bounds = handler && handler.index != null && handler.unscaledBounds ? handler.unscaledBounds : null; // NEW
            if (!bounds) return null; // NEW
            return { x: Number(bounds.x) || 0, y: Number(bounds.y) || 0, w: Math.max(0, Number(bounds.width) || 0), h: Math.max(0, Number(bounds.height) || 0) }; // NEW
        } // NEW

        function activeMoveRectForBed(bed) {
            const handler = graph.graphHandler; // NEW
            if (!handler || handler.currentDx == null || handler.currentDy == null || !Array.isArray(handler.cells) || handler.cells.indexOf(bed) < 0) return null; // NEW
            const rect = getModelRect(bed); // NEW
            const scale = graph.view && graph.view.scale ? graph.view.scale : 1; // NEW
            return rect ? movedRect(rect, Number(handler.currentDx) / scale, Number(handler.currentDy) / scale) : null; // NEW
        } // NEW

        function activePreviewRectForBed(bed) {
            return activeResizeRectForBed(bed) || activeMoveRectForBed(bed) || getModelRect(bed); // NEW
        } // NEW

        function isGestureActiveForBed(bed) {
            if (!bed || !graph.isMouseDown) return false; // NEW
            return !!(activeResizeRectForBed(bed) || activeMoveRectForBed(bed)); // NEW
        } // NEW

        function viewPointForGraphPoint(pt) {
            const s = graph.view.scale || 1; // NEW
            const tr = graph.view.translate || { x: 0, y: 0 }; // NEW
            return {
                x: ((Number(pt.x) || 0) + tr.x) * s + (graph.panDx || 0),
                y: ((Number(pt.y) || 0) + tr.y) * s + (graph.panDy || 0)
            }; // NEW
        } // NEW

        function viewRectForModuleLocalRect(moduleCell, rect) {
            const geo = moduleCell && moduleCell.getGeometry ? moduleCell.getGeometry() : null; // NEW
            if (!geo || !rect) return null; // NEW
            const p1 = viewPointForGraphPoint({ x: (Number(geo.x) || 0) + rect.x, y: (Number(geo.y) || 0) + rect.y }); // NEW
            const p2 = viewPointForGraphPoint({ x: (Number(geo.x) || 0) + rectRight(rect), y: (Number(geo.y) || 0) + rectBottom(rect) }); // NEW
            return { x: p1.x, y: p1.y, w: Math.max(1, p2.x - p1.x), h: Math.max(1, p2.y - p1.y) }; // NEW
        } // NEW

        function appendBand(root, moduleCell, candidate) {
            if (!candidate || !candidate.activeSnap || !candidate.band) return; // NEW
            const vr = viewRectForModuleLocalRect(moduleCell, candidate.band); // NEW
            if (!vr) return; // NEW
            const band = document.createElement("div"); // NEW
            band.className = PATH_SNAP_BAND_CLASS; // NEW
            band.style.cssText = `position:absolute;left:${Math.round(vr.x)}px;top:${Math.round(vr.y)}px;width:${Math.max(1, Math.round(vr.w))}px;height:${Math.max(1, Math.round(vr.h))}px;background:rgba(37,99,235,0.14);border:1px solid rgba(37,99,235,0.50);box-sizing:border-box;`; // NEW
            root.appendChild(band); // NEW
        } // NEW

        function appendBadge(root, moduleCell, candidate, units) {
            if (!candidate || !candidate.band) return; // NEW
            const vr = viewRectForModuleLocalRect(moduleCell, candidate.band); // NEW
            if (!vr) return; // NEW
            const badge = document.createElement("div"); // NEW
            const snapLabel = candidate.preset ? ` · ${candidate.preset.label} snap` : ""; // NEW
            badge.className = PATH_SNAP_BADGE_CLASS + (candidate.activeSnap ? " active" : ""); // NEW
            badge.textContent = formatPathDistanceLabelFromUnits(candidate.gap, units) + snapLabel; // NEW
            badge.style.cssText = `position:absolute;left:${Math.round(vr.x + vr.w / 2)}px;top:${Math.round(vr.y + vr.h / 2)}px;transform:translate(-50%,-50%);max-width:160px;padding:3px 6px;border-radius:4px;border:1px solid ${candidate.activeSnap ? "#2563eb" : "#6b7280"};background:${candidate.activeSnap ? "rgba(239,246,255,0.98)" : "rgba(255,255,255,0.96)"};color:${candidate.activeSnap ? "#1d4ed8" : "#374151"};box-shadow:0 1px 4px rgba(0,0,0,0.14);white-space:nowrap;`; // NEW
            root.appendChild(badge); // NEW
        } // NEW

        function refreshOverlay() {
            refreshTimer = null; // NEW
            if (isBedPathSnapAltBypassActive()) { hideOverlay(); return; } // NEW
            const bed = selectedPathSnapBed(); // NEW
            if (!bed || !isGestureActiveForBed(bed)) { hideOverlay(); return; } // NEW
            const moduleCell = findGardenModuleAncestor(graph, bed); // NEW
            const rect = activePreviewRectForBed(bed); // NEW
            if (!moduleCell || !rect || !rectInsideModuleBounds(moduleCell, rect)) { hideOverlay(); return; } // NEW
            const evaluation = evaluateBedPathSnap(moduleCell, bed, rect); // NEW
            if (!evaluation.candidates.length) { hideOverlay(); return; } // NEW
            const root = ensureOverlay(); // NEW
            if (!root) return; // NEW
            root.innerHTML = ""; // NEW
            root.style.display = "block"; // NEW
            evaluation.candidates.forEach(function (candidate) { appendBand(root, moduleCell, candidate); }); // NEW
            evaluation.candidates.forEach(function (candidate) { appendBadge(root, moduleCell, candidate, evaluation.units); }); // NEW
        } // NEW

        function scheduleOverlayRefresh() {
            if (refreshTimer != null) clearTimeout(refreshTimer); // NEW
            refreshTimer = setTimeout(refreshOverlay, 0); // NEW
        } // NEW

        graph.addMouseListener({ // NEW
            mouseDown: function (_sender, me) { lastBedPathSnapPointerEvent = me && me.getEvent ? me.getEvent() : null; scheduleOverlayRefresh(); },
            mouseMove: function (_sender, me) { lastBedPathSnapPointerEvent = me && me.getEvent ? me.getEvent() : lastBedPathSnapPointerEvent; scheduleOverlayRefresh(); },
            mouseUp: function (_sender, me) { lastBedPathSnapPointerEvent = me && me.getEvent ? me.getEvent() : lastBedPathSnapPointerEvent; setTimeout(hideOverlay, 0); }
        }); // NEW
        if (graph.getSelectionModel) graph.getSelectionModel().addListener(mxEvent.CHANGE, scheduleOverlayRefresh); // NEW
        graph.addListener(mxEvent.CELLS_MOVED, scheduleOverlayRefresh); // NEW
        graph.addListener(mxEvent.CELLS_RESIZED, scheduleOverlayRefresh); // NEW
        graph.getView().addListener(mxEvent.SCALE, scheduleOverlayRefresh); // NEW
        graph.getView().addListener(mxEvent.TRANSLATE, scheduleOverlayRefresh); // NEW
        graph.getView().addListener(mxEvent.SCALE_AND_TRANSLATE, scheduleOverlayRefresh); // NEW
        graph.getView().addListener(mxEvent.REPAINT, scheduleOverlayRefresh); // NEW
        mxEvent.addListener(window, "resize", scheduleOverlayRefresh); // NEW
    } // NEW

    installBedPathSnapOverlay(); // NEW

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

        // Ignore planting groups that are over multiple beds (or no bed).
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
            const { bandPx } = groupLabelMetrics(groupCell);
            const slotStats = classifyPlantingSlots(groupCell, sx, sy, bandPx, disabledSet2);
            const { actual } = applyCounts(model, groupCell, slotStats, disabledSet2); // CHANGE: bed cleanup count respects offset-omitted slots.
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

    /** Saved legacy groups retain 30%; crop defaults are resolved only for new plantings. */ // CHANGE
    function resolveAllowedOverhangPct(value) { // CHANGE
        const raw = value && typeof value.getAttribute === 'function' ? value.getAttribute('allowed_overhang_pct') : value; // CHANGE
        const number = raw == null || String(raw).trim() === '' ? NaN : Number(raw); // CHANGE
        return Number.isFinite(number) && number >= 0 && number <= 50 ? number : DEFAULT_ALLOWED_OVERHANG_PCT; // CHANGE
    } // CHANGE

    function allowedOverhangForDiameter(diameter, percentage) { // CHANGE
        return Math.max(0, diameter) * resolveAllowedOverhangPct(percentage) / 100; // CHANGE
    } // CHANGE

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

    function shiftPlantCircleChildrenLogical(tg, dx, dy, nextGroupGeometry) { // CHANGE
        const model = graph.getModel();
        const rotationDeg = getTilerRotationDeg(tg);
        let changed = false;
        const childCount = model.getChildCount(tg);
        const snapshots = []; // CHANGE: read every logical position before changing the rotation pivot.
        for (let i = 0; i < childCount; i++) {
            const child = model.getChildAt(tg, i);
            if (!model.isVertex(child) || !isPlantCircle(child)) continue;
            const logicalGeo = childLogicalGeometryFromVisual(tg, child, rotationDeg);
            if (!logicalGeo) continue;
            if ((Number(logicalGeo.w) || 0) <= 0 || (Number(logicalGeo.h) || 0) <= 0) continue;
            snapshots.push({ child, logicalGeo }); // CHANGE
        } // CHANGE
        if (nextGroupGeometry) model.setGeometry(tg, nextGroupGeometry); // CHANGE: transforms below use the final pivot, including zero-shift trims.
        for (const { child, logicalGeo } of snapshots) { // CHANGE
            const next = visualGeometryFromLogicalGeometry(tg, {
                x: (Number(logicalGeo.x) || 0) + dx,
                y: (Number(logicalGeo.y) || 0) + dy,
                w: Number(logicalGeo.w) || 0,
                h: Number(logicalGeo.h) || 0
            });
            if (!next) continue;
            changed = setGeometryIfChanged(model, child, next) || changed; // CHANGE
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
        if (layoutGridOffsetActive(tg)) {
            bedFitLog("trim-skip", {
                txnId: debugCtx && debugCtx.txnId,
                groupId: bedFitCellId(tg),
                bedId: bedFitCellId(bed),
                reason: "layout-grid-offset"
            });
            return false;
        }
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
        const groupChanged = !(nearlySameNumber(current.x, next.x) && nearlySameNumber(current.y, next.y) && nearlySameNumber(current.width, next.width) && nearlySameNumber(current.height, next.height));
        const childrenChanged = shiftPlantCircleChildrenLogical(tg, dx, dy, groupChanged ? next : null); // CHANGE
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
        const overhang = allowedOverhangForDiameter(diameter, tg); // CHANGE
        const frameRect = getPlantingFrameRectModel(tgRect);
        if (!frameRect) return null;
        const targetFrameWidth = bedRect.w + overhang * 2;
        const targetFrameHeight = bedRect.h + overhang * 2;
        const widthClose = Math.abs(frameRect.w - targetFrameWidth) <= bedRect.w * BED_FIT_TOLERANCE;
        const heightClose = Math.abs(frameRect.h - targetFrameHeight) <= bedRect.h * BED_FIT_TOLERANCE;
        const canDragFit = allowDragIntoBedFit && diameter < bedRect.w && diameter < bedRect.h;
        const forcedFitWidth = !!(debugCtx && debugCtx.forceFitWidth);
        const forcedFitHeight = !!(debugCtx && debugCtx.forceFitHeight);
        const resizeIntent = debugCtx && debugCtx.resizeIntent; // CHANGE: fitted axes keep their accepted geometry during a direct resize.
        const fitWidth = !(resizeIntent && resizeIntent.axes.fitWidth) && (usePersistedFitAxes ? forcedFitWidth : (widthClose || canDragFit)); // CHANGE
        const fitHeight = !(resizeIntent && resizeIntent.axes.fitHeight) && (usePersistedFitAxes ? forcedFitHeight : (heightClose || canDragFit)); // CHANGE
        const retainWidth = !!(resizeIntent && resizeIntent.axes.fitWidth && !resizeIntent.releaseWidth); // CHANGE
        const retainHeight = !!(resizeIntent && resizeIntent.axes.fitHeight && !resizeIntent.releaseHeight); // CHANGE
        if (!fitWidth && !fitHeight) {
            if (persistAxisIntent) writeBedFitAxesNoTxn(model, tg, retainWidth, retainHeight); // CHANGE
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
        if (persistAxisIntent) writeBedFitAxesNoTxn(model, tg, fitWidth || retainWidth, fitHeight || retainHeight); // CHANGE
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
        const groups = getTilerGroupsFromEventCells(cells).filter(cell => !graph.__trellisBedTransforms || !graph.__trellisBedTransforms.isCarried(cell)); // CHANGE: carried layouts must not be refitted during movement.
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
        if (!(opts && opts.resizeIntents && opts.resizeIntents.size) && shouldSuppressBedFitResize(source, groups)) { // CHANGE: recent automatic fits must not swallow a new direct resize.
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
                const resizeIntent = opts && opts.resizeIntents && opts.resizeIntents.get(tg.id); // CHANGE
                const fitResult = applyBedFitGeometry(tg, bed, allowDragIntoBedFit, { txnId, source, persistAxisIntent, resizeIntent }); // CHANGE
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
        const assemblies = getBedAssembliesFromEventCells(cells).filter(cell => !graph.__trellisBedTransforms || !graph.__trellisBedTransforms.isCarried(cell)); // CHANGE: carry irrigation without refitting its frame.
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
            applyBedPathSnapNoTxn(model, bed, { source: "bed-created" }); // NEW
            graph.setSelectionCell(bed);
            reorderModuleChildrenForLayering(model, moduleCell);
        } finally {
            model.endUpdate();
        }
        graph.refresh(bed);
        return bed;
    }


    /**
     * Creates an empty planting group inside the given garden module.
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
        }, "neutral", { title: "Apply this horizontal and vertical spacing to the planting." }); // CHANGE: explicit action tooltip.
        const cancelBtn = tilerButton("Cancel", function () {
            ui.hideDialog();
        }, "close"); // CHANGE: spacing cancellation uses the red outline.
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
            log("[spacing] not a planting group");
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
            const { bandPx } = groupLabelMetrics(groupCell);
            const slotStats = classifyPlantingSlots(groupCell, spacingXpx, spacingYpx, bandPx, disabledSet2);
            const { actual } = applyCounts(model, groupCell, slotStats, disabledSet2); // CHANGE: disabling plants preserves offset-omitted count semantics.
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

                // ----- Planting group item -----
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
                    log("[popup] no planting group under cursor");
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

                    // Restore: if any selected/target planting groups have disabled tiles                   
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
        stripSiblingCompanionMetadata(value);
        for (const [k, v] of Object.entries(attrs || {})) {
            if (v === null || v === undefined || v === "") value.removeAttribute(k);
            else value.setAttribute(k, String(v));
        } // CHANGE: strip stale companion metadata before applying fresh scheduler attributes.
        const sourceStyle = typeof sourceCell.getStyle === "function" ? sourceCell.getStyle() : sourceCell.style; // CHANGE
        const style = upsertStyleKV(sourceStyle || groupFrameStyle(), "connectable", "0"); // CHANGE
        const geometry = sourceGeo.clone ? sourceGeo.clone() : new mxGeometry(sourceGeo.x, sourceGeo.y, sourceGeo.width, sourceGeo.height);
        const offsetCm = opts.layoutOffsetCm || opts.offsetCm || null;
        const offsetXCm = finiteNumberOrNull(offsetCm && offsetCm.x);
        const offsetYCm = finiteNumberOrNull(offsetCm && offsetCm.y);
        if (value && value.setAttribute) {
            if (offsetXCm != null && !value.getAttribute("layout_offset_x_cm")) value.setAttribute("layout_offset_x_cm", String(offsetXCm));
            if (offsetYCm != null && !value.getAttribute("layout_offset_y_cm")) value.setAttribute("layout_offset_y_cm", String(offsetYCm));
        }
        const group = new mxCell(value, geometry, style);
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
        notifyTilerGroupCreated(activeGraphArg, group, creationSource);
        return group;
    }

    function ymdValue(value) {
        const text = String(value || "").trim();
        return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
    }

    function ymdIntervalsOverlap(aStart, aEnd, bStart, bEnd) {
        const as = ymdValue(aStart);
        const ae = ymdValue(aEnd);
        const bs = ymdValue(bStart);
        const be = ymdValue(bEnd);
        return !!(as && ae && bs && be && as <= be && bs <= ae);
    }

    function plantingProposalConflictRank(conflicts) {
        if (!(conflicts || []).length) return 0; // CHANGE: bed-first scheduling prefers open space before shared companion space.
        if ((conflicts || []).some(function (item) { return String(item.conflictKind || item.relationshipKind || "") === "incompatible" || String(item.conflictSeverity || "") === "block"; })) return Infinity; // CHANGE: incompatible crop overlap is never an automatic placement candidate.
        if ((conflicts || []).some(function (item) { return String(item.conflictKind || item.relationshipKind || "") === "unknown"; })) return 2; // CHANGE: unknown overlap is allowed only after known companion placements.
        return 1; // CHANGE: known non-negative companion overlap is allowed, but still trails clean space.
    }

    /** Returns the corners of a planting footprint, including its model-space rotation. */ // CHANGE
    function plantingFootprintPolygon(rect) { // CHANGE
        const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; // CHANGE
        return [[rect.x, rect.y], [rect.x + rect.width, rect.y], [rect.x + rect.width, rect.y + rect.height], [rect.x, rect.y + rect.height]] // CHANGE
            .map(([x, y]) => rotatePointAround({ x, y }, center, Number(rect.rotation) || 0)); // CHANGE
    } // CHANGE

    /** Clips a convex footprint against a bed-local rectangle without changing either input. */ // CHANGE
    function clipPlantingFootprint(points, rect) { // CHANGE
        let clipped = points; // CHANGE
        [["x", rect.x, true], ["x", rect.x + rect.width, false], ["y", rect.y, true], ["y", rect.y + rect.height, false]].forEach(([axis, edge, lower]) => { // CHANGE
            const result = []; // CHANGE
            for (let i = 0; i < clipped.length; i++) { // CHANGE
                const a = clipped[i], b = clipped[(i + 1) % clipped.length]; // CHANGE
                const aInside = lower ? a[axis] >= edge : a[axis] <= edge; // CHANGE
                const bInside = lower ? b[axis] >= edge : b[axis] <= edge; // CHANGE
                if (aInside) result.push(a); // CHANGE
                if (aInside !== bInside) { // CHANGE
                    const t = (edge - a[axis]) / (b[axis] - a[axis]); // CHANGE
                    result.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }); // CHANGE
                } // CHANGE
            } // CHANGE
            clipped = result; // CHANGE
        }); // CHANGE
        return clipped; // CHANGE
    } // CHANGE

    /** Exact union area of convex polygons: sweep vertex/intersection slabs and integrate interval unions. */ // CHANGE
    function plantingFootprintUnionArea(polygons) { // CHANGE
        const edges = polygons.flatMap(points => points.map((a, i) => [a, points[(i + 1) % points.length]])); // CHANGE
        const xs = edges.flatMap(([a, b]) => [a.x, b.x]); // CHANGE
        for (let i = 0; i < edges.length; i++) { // CHANGE
            const [a, b] = edges[i]; // CHANGE
            for (let j = i + 1; j < edges.length; j++) { // CHANGE
                const [c, d] = edges[j]; // CHANGE
                const denominator = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x); // CHANGE
                if (Math.abs(denominator) < 1e-9) continue; // CHANGE
                const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / denominator; // CHANGE
                const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / denominator; // CHANGE
                if (t > 0 && t < 1 && u > 0 && u < 1) xs.push(a.x + t * (b.x - a.x)); // CHANGE
            } // CHANGE
        } // CHANGE
        const sorted = Array.from(new Set(xs)).sort((a, b) => a - b); // CHANGE
        let area = 0; // CHANGE
        for (let i = 1; i < sorted.length; i++) { // CHANGE
            const width = sorted[i] - sorted[i - 1]; // CHANGE
            if (width < 1e-9) continue; // CHANGE
            const x = (sorted[i] + sorted[i - 1]) / 2; // CHANGE
            const intervals = polygons.map(points => { // CHANGE
                const ys = []; // CHANGE
                points.forEach((a, index) => { // CHANGE
                    const b = points[(index + 1) % points.length]; // CHANGE
                    if (x > Math.min(a.x, b.x) && x < Math.max(a.x, b.x)) ys.push(a.y + (x - a.x) * (b.y - a.y) / (b.x - a.x)); // CHANGE
                }); // CHANGE
                return ys.length ? [Math.min(...ys), Math.max(...ys)] : null; // CHANGE
            }).filter(Boolean).sort((a, b) => a[0] - b[0]); // CHANGE
            let end = -Infinity, length = 0; // CHANGE
            intervals.forEach(([start, stop]) => { length += Math.max(0, stop - Math.max(start, end)); end = Math.max(end, stop); }); // CHANGE
            area += width * length; // CHANGE
        } // CHANGE
        return area; // CHANGE
    } // CHANGE

    /** Expresses model-space occupancy in the bed's axes; headers never enter this calculation. */ // CHANGE
    function plantingProposalOccupancy(input, bedRect, rotation) { // CHANGE
        const center = { x: bedRect.x + bedRect.width / 2, y: bedRect.y + bedRect.height / 2 }; // CHANGE
        const bedId = String(input.bedCell && (input.bedCell.id || input.bedCell.getId && input.bedCell.getId()) || ""); // CHANGE
        return (input.occupancy || []).filter(item => item && String(item.groupId || "") !== String(input.excludeGroupId || "") // CHANGE
            && (!bedId || !item.bedId || String(item.bedId) === bedId) // CHANGE
            && ymdIntervalsOverlap(input.entryISO || input.bedEntryISO, input.harvestEndISO, item.bedEntryISO, item.harvestEndISO)) // CHANGE
            .filter(item => item.plantingRect || item.rect || item.geometry) // CHANGE
            .map(item => ({ item, points: plantingFootprintPolygon(item.plantingRect || item.rect || item.geometry).map(point => rotatePointAround(point, center, -rotation)) })); // CHANGE
    } // CHANGE

    /** Shared fitted-frame sizing. Slot counts are never forced to one when no physical row fits. */ // CHANGE
    function plantingProposalFrame(maxW, maxH, sx, sy, diameter, percentage) { // CHANGE
        const overhang = allowedOverhangForDiameter(diameter, percentage); // CHANGE
        const width = maxW + overhang * 2, height = maxH + overhang * 2; // CHANGE
        const count = (length, spacing) => Math.max(0, Math.min(Math.floor((length + 1e-7) / spacing), Math.floor((length - diameter + 1e-7) / spacing) + 1)); // CHANGE
        return { width, height, overhang, cols: count(width, sx), rows: count(height, sy) }; // CHANGE
    } // CHANGE

    /** Count a shifted lattice analytically, trimming to the bed's allowed circle overhang as well as content centers. */ // CHANGE
    function fittedOffsetAxisRange(length, pitch, offset, gridCount, diameter) { // CHANGE
        const radius = diameter / 2; // CHANGE: the expanded fitted frame already includes the allowed bed overhang.
        const first = Math.max(0, Math.ceil((radius - pitch / 2 - offset - 0.01) / pitch)); // CHANGE
        const last = Math.min(gridCount - 1, Math.floor((length - radius - pitch / 2 - offset + 0.01) / pitch)); // CHANGE
        return { first, last, count: Math.max(0, last - first + 1) }; // CHANGE
    } // CHANGE

    /** Fit demand in complete surviving rows without normalizing away the user's grid offsets. */ // CHANGE
    function fittedOffsetPlantingProposalCandidate(input, axis, sx, sy, diameter, bedRect, rotation) { // CHANGE
        const frame = plantingProposalFrame(bedRect.width, bedRect.height, sx, sy, diameter, input.allowedOverhangPct); // CHANGE
        const ox = toPx(Number(input.offsetXCm) || 0), oy = toPx(Number(input.offsetYCm) || 0); // CHANGE
        const maxX = fittedOffsetAxisRange(frame.width, sx, ox, frame.cols, diameter); // CHANGE
        const maxY = fittedOffsetAxisRange(frame.height, sy, oy, frame.rows, diameter); // CHANGE
        const requested = Math.max(0, Math.trunc(Number(input.plantCount) || 0)); // CHANGE
        const perRow = axis === 'width' ? maxX.count : maxY.count; // CHANGE
        const capacity = maxX.count * maxY.count; // CHANGE
        const requiredRows = perRow ? Math.min(axis === 'width' ? maxY.count : maxX.count, Math.ceil(requested / perRow)) : 0; // CHANGE
        const pitch = axis === 'width' ? sy : sx, offset = axis === 'width' ? oy : ox; // CHANGE
        const maxGrid = axis === 'width' ? frame.rows : frame.cols, maxLength = axis === 'width' ? frame.height : frame.width; // CHANGE
        let low = 0, high = maxGrid; // CHANGE
        while (low < high) { // CHANGE: binary search avoids scanning huge beds or tiny spacing.
            const mid = Math.floor((low + high) / 2); // CHANGE
            const length = mid === maxGrid ? maxLength : mid * pitch; // CHANGE: a capacity-sized partial allocation retains the bed's residual edge space.
            if (fittedOffsetAxisRange(length, pitch, offset, mid, diameter).count >= requiredRows) high = mid; else low = mid + 1; // CHANGE
        } // CHANGE
        const cols = axis === 'width' ? frame.cols : low, rows = axis === 'width' ? low : frame.rows; // CHANGE
        const fw = axis === 'width' || cols === frame.cols ? frame.width : cols * sx, fh = axis === 'height' || rows === frame.rows ? frame.height : rows * sy; // CHANGE
        const activeColumns = fittedOffsetAxisRange(fw, sx, ox, cols, diameter), activeRows = fittedOffsetAxisRange(fh, sy, oy, rows, diameter); // CHANGE
        const plantCount = activeColumns.count * activeRows.count; // CHANGE
        const width = Math.max(1, fw + GROUP_PADDING_PX * 2); // CHANGE
        const solved = solveOuterHeightForPlantingFrame(fh, width, fh + GROUP_LABEL_BAND_PX); // CHANGE
        const localRect = { x: GROUP_PADDING_PX + sx / 2 + activeColumns.first * sx + ox - diameter / 2, // CHANGE
            y: GROUP_PADDING_PX + solved.bandPx + sy / 2 + activeRows.first * sy + oy - diameter / 2, // CHANGE
            width: activeColumns.count ? (activeColumns.count - 1) * sx + diameter : 0, height: activeRows.count ? (activeRows.count - 1) * sy + diameter : 0 }; // CHANGE
        const base = { fitAxis: axis, rows, cols, capacity, plantCount, requestedPlantCount: requested, activeColumns, activeRows, // CHANGE
            fullPlantCount: perRow ? Math.ceil(requested / perRow) * perRow : 0, spacingXpx: sx, spacingYpx: sy, iconDiameterPx: diameter, labelBandPx: solved.bandPx, // CHANGE
            layoutOffsetXCm: Number(input.offsetXCm) || 0, layoutOffsetYCm: Number(input.offsetYCm) || 0, rotation, // CHANGE: retain the entered centimeter values without conversion roundoff.
            geometry: { x: bedRect.x, y: bedRect.y, width, height: solved.outerHeight }, complete: capacity > 0 && plantCount >= requested }; // CHANGE
        return chooseFittedPlantingProposalPlacement(input, base, frame, bedRect, rotation, localRect); // CHANGE
    } // CHANGE

    /** Creates a read-only fitted lattice; group bounds retain grid pitch while occupancy trims to circles. */ // CHANGE
    function fittedPlantingProposalCandidate(input, axis, sx, sy, diameter, bedRect, rotation) { // CHANGE
        if (input.offsetXCm != null || input.offsetYCm != null) return fittedOffsetPlantingProposalCandidate(input, axis, sx, sy, diameter, bedRect, rotation); // CHANGE: explicit offsets use the committed tiler's center-in-bounds rule.
        const frame = plantingProposalFrame(bedRect.width, bedRect.height, sx, sy, diameter, input.allowedOverhangPct); // CHANGE
        const requested = Math.max(0, Math.trunc(Number(input.plantCount) || 0)); // CHANGE
        const fullBed = input.fillAvailableBed === true; // CHANGE
        const perRow = axis === "width" ? frame.cols : frame.rows; // CHANGE
        const maxRows = axis === "width" ? frame.rows : frame.cols; // CHANGE
        const rowCount = perRow ? Math.min(maxRows, fullBed ? maxRows : Math.ceil(requested / perRow)) : 0; // CHANGE
        const cols = axis === "width" || fullBed ? frame.cols : rowCount; // CHANGE
        const rows = axis === "height" || fullBed ? frame.rows : rowCount; // CHANGE
        const capacity = frame.cols * frame.rows; // CHANGE
        const plantCount = fullBed || input.fillCompleteRows ? cols * rows : Math.min(requested, cols * rows); // CHANGE
        const frameWidth = axis === "width" || fullBed ? frame.width : cols * sx; // CHANGE
        const frameHeight = axis === "height" || fullBed ? frame.height : rows * sy; // CHANGE
        const width = Math.max(1, frameWidth + GROUP_PADDING_PX * 2); // CHANGE
        const solved = solveOuterHeightForPlantingFrame(Math.max(0, frameHeight), width, frameHeight + GROUP_LABEL_BAND_PX); // CHANGE
        const bboxW = cols > 0 ? (cols - 1) * sx + diameter : 0; // CHANGE
        const bboxH = rows > 0 ? (rows - 1) * sy + diameter : 0; // CHANGE
        const offsetX = (frameWidth - cols * sx) / 2, offsetY = (frameHeight - rows * sy) / 2; // CHANGE
        const localRect = { x: GROUP_PADDING_PX + (frameWidth - bboxW) / 2, y: GROUP_PADDING_PX + solved.bandPx + (frameHeight - bboxH) / 2, width: bboxW, height: bboxH }; // CHANGE
        const fullRowCount = perRow ? Math.ceil(requested / perRow) * perRow : 0; // CHANGE
        const base = { fitAxis: axis, fillAvailableBed: fullBed, rows, cols, capacity, plantCount, requestedPlantCount: requested, fullPlantCount: fullRowCount, // CHANGE
            spacingXpx: sx, spacingYpx: sy, iconDiameterPx: diameter, labelBandPx: solved.bandPx, // CHANGE
            layoutOffsetXCm: offsetX / toPx(1), layoutOffsetYCm: offsetY / toPx(1), rotation, // CHANGE
            geometry: { x: bedRect.x, y: bedRect.y, width, height: solved.outerHeight }, complete: capacity > 0 && (fullBed || plantCount >= requested) }; // CHANGE
        return chooseFittedPlantingProposalPlacement(input, base, frame, bedRect, rotation, localRect); // CHANGE
    } // CHANGE

    /** Ranks positions along the free bed axis by relationship policy and occupied union area. */ // CHANGE
    function chooseFittedPlantingProposalPlacement(input, base, frame, bedRect, rotation, localRect) { // CHANGE
        const { fitAxis: axis, fillAvailableBed: fullBed, spacingXpx: sx, spacingYpx: sy } = base; // CHANGE
        const bboxW = localRect.width, bboxH = localRect.height; // CHANGE
        const occupied = plantingProposalOccupancy(input, bedRect, rotation); // CHANGE
        const spanWidth = axis === "width" || fullBed, spanHeight = axis === "height" || fullBed; // CHANGE
        const startX = spanWidth ? (base.activeColumns ? bedRect.x - frame.overhang + localRect.x - GROUP_PADDING_PX : bedRect.x + (bedRect.width - bboxW) / 2) : bedRect.x - frame.overhang; // CHANGE: pin the fitted frame so explicit offsets visibly shift the grid on its bed axis.
        const startY = spanHeight ? (base.activeRows ? bedRect.y - frame.overhang + localRect.y - GROUP_PADDING_PX - base.labelBandPx : bedRect.y + (bedRect.height - bboxH) / 2) : bedRect.y - frame.overhang; // CHANGE
        const endX = spanWidth ? startX : bedRect.x + bedRect.width + frame.overhang - bboxW; // CHANGE
        const endY = spanHeight ? startY : bedRect.y + bedRect.height + frame.overhang - bboxH; // CHANGE
        const positions = (start, end, step) => { // CHANGE
            const out = []; // CHANGE
            for (let value = start; value <= end + 1e-7; value += Math.max(8, step)) out.push(Math.min(value, end)); // CHANGE
            if (!out.length || Math.abs(out[out.length - 1] - end) > 1e-7) out.push(end); // CHANGE
            return out; // CHANGE
        }; // CHANGE
        let best = null; // CHANGE
        for (const y of positions(startY, endY, sy)) { // CHANGE
            for (const x of positions(startX, endX, sx)) { // CHANGE
                const plantingRect = { x, y, width: bboxW, height: bboxH }; // CHANGE
                const overlaps = occupied.map(entry => ({ item: entry.item, polygon: clipPlantingFootprint(entry.points, plantingRect) })) // CHANGE
                    .filter(entry => plantingFootprintUnionArea([entry.polygon]) > 1e-7); // CHANGE
                const conflicts = overlaps.map(entry => entry.item); // CHANGE
                const area = plantingFootprintUnionArea(overlaps.map(entry => entry.polygon)); // CHANGE
                const rank = input.overlapPolicy === "warn" ? 0 : plantingProposalConflictRank(conflicts); // CHANGE
                if (best && (rank > best.rank || (rank === best.rank && area >= best.area - 1e-7))) continue; // CHANGE
                const geometry = Object.assign({}, base.geometry); // CHANGE
                const target = rotatePointAround({ x: x + bboxW / 2, y: y + bboxH / 2 }, { x: bedRect.x + bedRect.width / 2, y: bedRect.y + bedRect.height / 2 }, rotation); // CHANGE
                positionGeometryForLocalPoint(geometry, { x: localRect.x + bboxW / 2, y: localRect.y + bboxH / 2 }, target, rotation); // CHANGE
                best = { rank, area, conflicts, geometry, plantingRect: { x: target.x - bboxW / 2, y: target.y - bboxH / 2, width: bboxW, height: bboxH, rotation } }; // CHANGE
                if (area < 1e-7) break; // CHANGE
            } // CHANGE
            if (best && best.area < 1e-7) break; // CHANGE
        } // CHANGE
        return Object.assign(base, best || { rank: 0, area: 0, conflicts: [] }); // CHANGE
    } // CHANGE

    /** // CHANGE
     * Plans a bed-fitted planting without creating or changing graph cells. // CHANGE
     * Coordinates are module-parent local; rotation is in degrees around each returned rectangle's center. // CHANGE
     * fitAxisOverride selects width/height explicitly; otherwise use the shorter axis (width on ties). // CHANGE
     * fillCompleteRows keeps spacing fixed and rounds demand upward. capacity is the physical whole-row // CHANGE
     * maximum; an oversized request returns ok=false and its capped geometry for a partial-count retry. // CHANGE
     * fillAvailableBed occupies both dimensions and retains the scheduler's spacing-orientation selection. // CHANGE
     * overlapPolicy="warn" permits every temporal overlap; the default blocks incompatible relationships. // CHANGE
     * plantingRect trims occupancy to plant circles; geometry includes the dynamic header and padding. // CHANGE
     * Slots, offsets, diameter and count are authoritative inputs to createPlantingFromProposal. // CHANGE
     */ // CHANGE
    function proposePlantingGeometry(input = {}) { // CHANGE
        if (input.allowedOverhangPct != null && (String(input.allowedOverhangPct).trim() === '' || !Number.isFinite(Number(input.allowedOverhangPct)) || Number(input.allowedOverhangPct) < 0 || Number(input.allowedOverhangPct) > 50)) throw new Error('Allowed overhang must be between 0% and 50%.'); // CHANGE
        const fillAvailableBed = input.fillAvailableBed === true; // CHANGE
        const spacingXCm = Number(input.spacingXCm ?? input.spacingCm ?? 30); // CHANGE
        const spacingYCm = Number(input.spacingYCm ?? input.spacingCm ?? 30); // CHANGE
        const vegHeightCm = Number(input.vegHeightCm ?? input.veg_height_cm); // CHANGE
        const vegDiameterCm = Number(input.vegDiameterCm ?? input.veg_diameter_cm); // CHANGE
        const sx = toPx(Number.isFinite(spacingXCm) && spacingXCm > 0 ? spacingXCm : 30); // CHANGE
        const sy = toPx(Number.isFinite(spacingYCm) && spacingYCm > 0 ? spacingYCm : 30); // CHANGE
        const bedGeo = input.bedCell && input.bedCell.getGeometry ? input.bedCell.getGeometry() : null; // CHANGE
        const bedRect = { x: Number(input.xPx ?? (bedGeo && bedGeo.x) ?? 0), y: Number(input.yPx ?? (bedGeo && bedGeo.y) ?? 0), // CHANGE
            width: Math.max(0, Number(input.maxWidthPx ?? (bedGeo && bedGeo.width) ?? 240)), height: Math.max(0, Number(input.maxHeightPx ?? (bedGeo && bedGeo.height) ?? 240)) }; // CHANGE
        const rotation = input.bedCell ? getTilerRotationDeg(input.bedCell) : 0; // CHANGE
        const diameter = Math.max(6, Number.isFinite(vegDiameterCm) && vegDiameterCm > 0 ? toPx(vegDiameterCm) : clamp(DEFAULT_ICON_DIAM_RATIO * Math.min(sx, sy), MIN_ICON_DIAM_PX, MAX_ICON_DIAM_PX)); // CHANGE
        if (!Object.values(bedRect).every(Number.isFinite) || bedRect.width <= 0 || bedRect.height <= 0) { // CHANGE
            return { ok: false, status: "unavailable", reason: "invalid_bed_geometry", capacity: 0, plantCount: 0, slots: [], warnings: [], fitAxis: input.fitAxisOverride || "width" }; // CHANGE
        } // CHANGE
        const defaultAxis = bedRect.width <= bedRect.height ? "width" : "height"; // CHANGE
        const axisOverride = input.fitAxisOverride === "width" || input.fitAxisOverride === "height" ? input.fitAxisOverride : ""; // CHANGE
        const orientations = input.fillCompleteRows ? ["normal"] : ["normal", "rotated_grid"]; // CHANGE
        const candidates = orientations.filter(orientation => !input.orientationOverride || orientation === input.orientationOverride).map(orientation => { // CHANGE
            const xSpacing = orientation === "normal" ? sx : sy, ySpacing = orientation === "normal" ? sy : sx; // CHANGE
            let candidate = fittedPlantingProposalCandidate(input, axisOverride || defaultAxis, xSpacing, ySpacing, diameter, bedRect, rotation); // CHANGE
            if (!axisOverride && !candidate.capacity && !fillAvailableBed) { // CHANGE
                candidate = fittedPlantingProposalCandidate(input, defaultAxis === "width" ? "height" : "width", xSpacing, ySpacing, diameter, bedRect, rotation); // CHANGE
            } // CHANGE
            return Object.assign(candidate, { orientation }); // CHANGE
        }); // CHANGE
        candidates.sort((a, b) => Number(b.complete) - Number(a.complete) || (a.rank === b.rank ? 0 : a.rank < b.rank ? -1 : 1) // CHANGE
            || a.area - b.area || a.plantCount - b.plantCount || a.orientation.localeCompare(b.orientation)); // CHANGE
        const best = candidates[0] || fittedPlantingProposalCandidate(input, axisOverride || defaultAxis, sx, sy, diameter, bedRect, rotation); // CHANGE
        const conflicts = best.conflicts || []; // CHANGE
        const blocked = !Number.isFinite(best.rank); // CHANGE
        const resolvedPlantCount = best.plantCount; // CHANGE
        const warnings = conflicts.map(item => { // CHANGE
            const kind = String(item.conflictKind || item.relationshipKind || "unknown"); // CHANGE
            const label = String(item.plantName || item.cropName || item.label || item.groupId || "existing planting"); // CHANGE
            return (kind === "companion" ? "Companion" : kind === "incompatible" ? "Incompatible" : "Unknown relationship:") + " overlap with " + label + "."; // CHANGE
        }); // CHANGE
        return Object.assign({}, best, { // CHANGE
            allowedOverhangPct: resolveAllowedOverhangPct(input.allowedOverhangPct), // CHANGE
            ok: !blocked && best.capacity > 0 && (fillAvailableBed || best.complete), // CHANGE
            status: blocked ? "blocked" : (conflicts.length ? "warning" : "compatible"), // CHANGE
            reason: blocked ? "incompatible_overlap" : !best.capacity ? "no_row_capacity" : !best.complete ? "insufficient_space" : "", // CHANGE
            warnings, conflicts, conflictGroupIds: conflicts.map(item => String(item.groupId || item.cellId || "")).filter(Boolean), // CHANGE
            plantCount: resolvedPlantCount, // CHANGE
            lodCollapsed: resolvedPlantCount > LOD_TILE_THRESHOLD, // CHANGE
            spacingXCm: best.orientation === "rotated_grid" ? (spacingYCm > 0 && Number.isFinite(spacingYCm) ? spacingYCm : 30) : (spacingXCm > 0 && Number.isFinite(spacingXCm) ? spacingXCm : 30), // CHANGE
            spacingYCm: best.orientation === "rotated_grid" ? (spacingXCm > 0 && Number.isFinite(spacingXCm) ? spacingXCm : 30) : (spacingYCm > 0 && Number.isFinite(spacingYCm) ? spacingYCm : 30), // CHANGE
            vegDiameterCm: diameter / toPx(1), // CHANGE
            vegHeightCm: Number.isFinite(vegHeightCm) && vegHeightCm > 0 ? vegHeightCm : null, // CHANGE
            slots: buildProposalSlots(best, resolvedPlantCount), // CHANGE
            geometry: best.geometry // CHANGE
        }); // CHANGE
    } // CHANGE

    /** Uses the committed tiler's band, diameter, and centered lattice offsets for ghost circles. */ // CHANGE
    function buildProposalSlots(best, plantCount) { // CHANGE
        const limit = Math.min(Math.max(0, Math.trunc(Number(plantCount) || 0)), LOD_TILE_THRESHOLD); // CHANGE
        const out = []; // CHANGE
        if (!best || !best.geometry) return out; // CHANGE
        for (let r = 0; r < best.rows && out.length < limit; r++) { // CHANGE
            for (let c = 0; c < best.cols && out.length < limit; c++) { // CHANGE
                if (best.activeColumns && (c < best.activeColumns.first || c > best.activeColumns.last) || best.activeRows && (r < best.activeRows.first || r > best.activeRows.last)) continue; // CHANGE: omit shifted-out slots rather than drawing them at the edge.
                out.push({ row: r, col: c, // CHANGE
                    x: GROUP_PADDING_PX + best.spacingXpx / 2 + c * best.spacingXpx + toPx(best.layoutOffsetXCm || 0), // CHANGE
                    y: GROUP_PADDING_PX + best.labelBandPx + best.spacingYpx / 2 + r * best.spacingYpx + toPx(best.layoutOffsetYCm || 0), // CHANGE
                    r: best.iconDiameterPx / 2 }); // CHANGE
            } // CHANGE
        } // CHANGE
        return out; // CHANGE
    } // CHANGE

    function previewDraftNumber(value, fallback) { // NEW: shared draft preview normalization without mutating cells.
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }

    function previewDraftAttrs(groupCell, draft) { // NEW: overlays can render an uncommitted tiler-faithful copy.
        const attrs = {};
        if (draft && draft.allowedOverhangPct != null) attrs.allowed_overhang_pct = String(draft.allowedOverhangPct); // CHANGE
        if (draft && draft.spacingXCm != null) attrs.spacing_x_cm = String(draft.spacingXCm);
        if (draft && draft.spacingYCm != null) attrs.spacing_y_cm = String(draft.spacingYCm);
        if (draft && draft.spacingXCm != null && draft.spacingYCm != null && Number(draft.spacingXCm) === Number(draft.spacingYCm)) attrs.spacing_cm = String(draft.spacingXCm);
        if (draft && draft.vegDiameterCm != null) attrs.veg_diameter_cm = String(draft.vegDiameterCm);
        if (draft && draft.offsetXCm != null) {
            attrs.layout_offset_x_cm = String(draft.offsetXCm);
            attrs.companion_offset_x_cm = ""; // CHANGE: previewed planting offsets must override stale legacy companion offsets.
        }
        if (draft && draft.offsetYCm != null) {
            attrs.layout_offset_y_cm = String(draft.offsetYCm);
            attrs.companion_offset_y_cm = ""; // CHANGE: previewed planting offsets must override stale legacy companion offsets.
        }
        if (draft.generatedPattern) { attrs.companion_layout_interplant = ''; attrs.companion_layout_template = ''; } // CHANGE: obsolete legacy staggering must not shift generated pair slots twice.
        if (draft && draft.label != null) attrs.label = String(draft.label);
        if (draft && draft.abbr != null) attrs.plant_abbr = String(draft.abbr);
        return attrs;
    }

    function previewStyleRotationDeg(activeGraph, groupCell) { // NEW: read rotation for data-only previews.
        try {
            const graphForStyle = activeGraph || graph;
            const style = graphForStyle && typeof graphForStyle.getCellStyle === "function" ? graphForStyle.getCellStyle(groupCell) : null;
            const raw = style && (style[mxConstants.STYLE_ROTATION] != null ? style[mxConstants.STYLE_ROTATION] : style.rotation);
            const n = Number(raw);
            if (Number.isFinite(n)) return n;
        } catch (_) { }
        const match = String(getStyleSafe(groupCell) || "").match(/(?:^|;)rotation=([^;]+)/);
        const fallback = match ? Number(match[1]) : 0;
        return Number.isFinite(fallback) ? fallback : 0;
    }

    /** Resolve a percentage edit without mutating the graph; preview and Apply consume this same geometry. */ // CHANGE
    function prepareBedFitSpacingDraft(groupCell, draft) { // CHANGE
        if (!groupCell || draft.allowedOverhangPct == null || Number(draft.allowedOverhangPct) === resolveAllowedOverhangPct(groupCell) || draft.generatedPattern || draft.strictFootprint || groupCell.getAttribute('bed_auto_fit') === '0') return draft; // CHANGE
        const fitWidth = groupCell.getAttribute(BED_FIT_WIDTH_ATTR) === '1', fitHeight = groupCell.getAttribute(BED_FIT_HEIGHT_ATTR) === '1'; // CHANGE
        if (!fitWidth && !fitHeight) return draft; // CHANGE
        const footprint = readPlantingFootprint(groupCell); // CHANGE: shallow headers can put the group center outside its bed.
        const bed = footprint && findSmallestContainingBedModel(model.getParent(groupCell), { x: footprint.x + footprint.width / 2, y: footprint.y + footprint.height / 2 }); // CHANGE
        const bedRect = getModelRect(bed), current = groupCell.getGeometry(); // CHANGE
        if (!bedRect || !current) return draft; // CHANGE
        const diameter = draft.vegDiameterCm > 0 ? toPx(draft.vegDiameterCm) : getPlantCircleDiameterPx(groupCell); // CHANGE
        const overhang = allowedOverhangForDiameter(diameter, draft.allowedOverhangPct), next = current.clone(); // CHANGE
        if (fitWidth) next.width = bedRect.w + overhang * 2 + GROUP_PADDING_PX * 2; // CHANGE
        if (fitHeight) next.height = solveOuterHeightForPlantingFrame(bedRect.h + overhang * 2, next.width, next.height).outerHeight; // CHANGE
        const rotation = getTilerRotationDeg(groupCell), frameCenter = plantingFrameLocalCenter(next.width, next.height); // CHANGE
        const preserved = modelPointForLocalPoint(current, plantingFrameLocalCenter(current.width, current.height), rotation); // CHANGE
        positionGeometryForLocalPointAxisAware(next, frameCenter, rectCenterModel(bedRect), rotation, fitWidth, fitHeight, preserved); // CHANGE
        const rect = Object.assign({}, draft.rect, { x: (draft.rect?.x ?? current.x) + next.x - current.x, y: (draft.rect?.y ?? current.y) + next.y - current.y, width: next.width, height: next.height }); // CHANGE
        const bounds = plantingContentBoundsLocal({ getGeometry: () => next }, frameCenter.bandPx); // CHANGE
        return Object.assign({}, draft, { rect, bedFitGeometry: next, bedFitLayoutSnapshot: captureBedFitLayoutSnapshot(groupCell), clipBounds: bounds, strictFootprint: false }); // CHANGE
    } // CHANGE

    function makeDraftPreviewCell(groupCell, rect, attrs) { // NEW: tiny cell facade lets preview reuse tiler geometry helpers.
        const width = Math.max(0, Number(rect && rect.width) || 0);
        const height = Math.max(0, Number(rect && rect.height) || 0);
        const geometry = { x: 0, y: 0, width, height };
        return {
            id: groupCell && groupCell.id || "",
            style: getStyleSafe(groupCell),
            getStyle: function () { return getStyleSafe(groupCell); },
            getGeometry: function () { return geometry; },
            getAttribute: function (key) {
                if (Object.prototype.hasOwnProperty.call(attrs, key)) return attrs[key];
                return groupCell && typeof groupCell.getAttribute === "function" ? groupCell.getAttribute(key) : "";
            }
        };
    }

    function buildDraftTilerGroupPreview(activeGraph, groupCell, draft = {}, opts = {}) { // NEW: read-only public preview API for DOM overlays.
        if (!groupCell || !isTilerGroup(groupCell)) return null;
        const sourceGeo = groupCell.getGeometry && groupCell.getGeometry();
        const rect = Object.assign({
            x: Number(sourceGeo && sourceGeo.x) || 0,
            y: Number(sourceGeo && sourceGeo.y) || 0,
            width: Number(sourceGeo && sourceGeo.width) || 0,
            height: Number(sourceGeo && sourceGeo.height) || 0
        }, draft.rect || opts.rect || {});
        const attrs = Object.assign({}, draft.attributes || {}, previewDraftAttrs(groupCell, draft)); // CHANGE
        const previewCell = makeDraftPreviewCell(groupCell, rect, attrs);
        const spacingXcm = previewDraftNumber(previewCell.getAttribute("spacing_x_cm") || previewCell.getAttribute("spacing_cm"), 30);
        const spacingYcm = previewDraftNumber(previewCell.getAttribute("spacing_y_cm") || previewCell.getAttribute("spacing_cm"), 30);
        const spacingXpx = toPx(spacingXcm > 0 ? spacingXcm : 30);
        const spacingYpx = toPx(spacingYcm > 0 ? spacingYcm : 30);
        const vegDiamCm = previewDraftNumber(previewCell.getAttribute("veg_diameter_cm"), 0);
        let iconDiam = vegDiamCm > 0 ? toPx(vegDiamCm) : clamp(DEFAULT_ICON_DIAM_RATIO * Math.min(spacingXpx, spacingYpx), MIN_ICON_DIAM_PX, MAX_ICON_DIAM_PX);
        iconDiam = Math.max(iconDiam, 6);
        const { fontPx, bandPx } = groupLabelMetrics(previewCell);
        const tileFont = tileFontPx(iconDiam);
        const grid = computeGridStatsXY(previewCell, spacingXpx, spacingYpx);
        const disabledSet = draft.resetDisabled ? new Set() : readDisabledSet(groupCell); // CHANGE
        // Shared-footprint clipping is translated into disabled slots, also persisted at commit. // CHANGE
        let clipped = 0; // CHANGE: intentional disabled plants do not make a saved layout invalid.
        if (draft.clipBounds) { // CHANGE
            const b = draft.clipBounds, radius = iconDiam / 2; // CHANGE
            for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) { // CHANGE
                const point = shiftedSlotCenterLocal(previewCell, r, c, spacingXpx, spacingYpx, bandPx); // CHANGE
                if (point.x - radius < b.minX - 1e-7 || point.x + radius > b.maxX + 1e-7 // CHANGE
                    || point.y - radius < b.minY - 1e-7 || point.y + radius > b.maxY + 1e-7) { // CHANGE
                    if (!disabledSet.has(`${r},${c}`)) clipped++; disabledSet.add(`${r},${c}`); // CHANGE
                } // CHANGE
            } // CHANGE
        } // CHANGE
        const slotStats = classifyPlantingSlots(previewCell, spacingXpx, spacingYpx, bandPx, disabledSet);
        const maxCircles = Math.max(1, Math.trunc(previewDraftNumber(draft.maxCircles ?? opts.maxCircles, 1000)));
        const requestedRotationDeg = opts && Object.prototype.hasOwnProperty.call(opts, "rotationDeg") ? Number(opts.rotationDeg) : null;
        const rotationDeg = Number.isFinite(requestedRotationDeg) ? requestedRotationDeg : previewStyleRotationDeg(activeGraph, groupCell); // CHANGE: spacing overlays can request an upright read-only preview without mutating the group.
        const label = getGroupDisplayName(previewCell, previewCell.getAttribute("plant_abbr") || "?");
        const abbr = previewCell.getAttribute("plant_abbr") || "?";
        const circles = [];
        const manualSlots = snapshotTileMap(draft.bedFitLayoutSnapshot); // CHANGE: manual plants keep logical positions when a percentage changes the frame.
        for (let r = 0; r < grid.rows; r++) {
            for (let c = 0; c < grid.cols; c++) {
                const slotKey = `${r},${c}`;
                if (!slotStats.renderedKeys.has(slotKey)) continue; // CHANGE: draft preview omits outside and disabled slots.
                if (circles.length >= maxCircles) continue;
                const saved = manualSlots.get(slotKey); // CHANGE
                const shifted = saved ? { x: saved.x + iconDiam / 2, y: saved.y + iconDiam / 2 } : shiftedSlotCenterLocal(previewCell, r, c, spacingXpx, spacingYpx, bandPx); // CHANGE
                const center = rotatePointAround(shifted, groupCenterLocal(previewCell), rotationDeg);
                circles.push({ row: r, col: c, x: rect.x + center.x, y: rect.y + center.y, r: iconDiam / 2, label: abbr, fontPx: tileFont });
            }
        }
        const committedCount = getNumberAttr(groupCell, ATTR_PLANT_COUNT_ACT, getNumberAttr(groupCell, ATTR_PLANT_COUNT, 0));
        const unit = groupCell.getAttribute("yield_unit") || YIELD_UNIT;
        const perYield = getNumberAttr(groupCell, "plant_yield", 0);
        const committedExpectedYield = getNumberAttr(groupCell, ATTR_YIELD_EXPECTED, committedCount * perYield);
        const draftExpectedYield = slotStats.actual * perYield;
        return {
            status: "ok",
            allowedOverhangPct: resolveAllowedOverhangPct(previewCell), // CHANGE
            rect,
            label,
            abbr,
            groupLabelFontPx: fontPx,
            groupLabelBandPx: bandPx, iconDiameterPx: iconDiam, contentBounds: plantingContentBoundsLocal(previewCell, bandPx), // CHANGE
            clipped, // CHANGE
            disabledSlots: Array.from(disabledSet, key => key.split(",").map(Number)), // CHANGE
            circleFontPx: tileFont,
            rotationDeg,
            paddingPx: GROUP_PADDING_PX,
            circles,
            total: slotStats.actual,
            rendered: circles.length,
            capped: slotStats.actual > circles.length,
            theoretical: slotStats.theoretical,
            omitted: slotStats.omitted,
            capacity: slotStats.capacity,
            disabled: slotStats.disabled,
            actual: slotStats.actual,
            committedCount,
            draftExpectedYield,
            committedExpectedYield,
            yieldUnit: unit,
            lodCollapsed: false
        };
    }

    /** Preview an unsaved planting using exactly the committed tiler's geometry and slot classifier. */ // CHANGE
    function buildUnsavedTilerGroupPreview(activeGraph, descriptor, draft = {}, opts = {}) { // CHANGE
        const attributes = Object.assign({ tiler_group: '1', plant_count: '0' }, descriptor.attributes || {}); // CHANGE
        const cell = { id: descriptor.cellId || '', style: descriptor.style || '', // CHANGE
            getAttribute: key => attributes[key] == null ? null : String(attributes[key]), // CHANGE
            getGeometry: () => descriptor.rect, getStyle: () => descriptor.style || '' }; // CHANGE
        return buildDraftTilerGroupPreview(activeGraph, cell, draft, opts); // CHANGE
    } // CHANGE

    function listGardenBeds(moduleCell) {
        if (!moduleCell) return [];
        return (graph.getChildVertices(moduleCell) || []).filter(isGardenBed);
    }

    function readBedProfile(bedCell) {
        if (!bedCell || !bedCell.getAttribute) return {};
        const keys = ["sun", "drainage", "fertility", "trellis", "season_extension", "protection", "wind", "bed_use"];
        const profile = {};
        keys.forEach(function (key) {
            const value = String(bedCell.getAttribute(key) || "").trim();
            if (value) profile[key] = value;
        });
        return profile;
    }

    function firstNonEmptyCellAttr(cell, keys) {
        for (const key of keys) {
            const value = getXmlAttr(cell, key, "");
            if (String(value || "").trim()) return String(value || "").trim();
        }
        return "";
    }

    function allDescendantsOf(root) {
        const out = [];
        const stack = root ? [root] : [];
        const model = graph.getModel && graph.getModel();
        while (stack.length && model) {
            const current = stack.pop();
            const n = model.getChildCount ? model.getChildCount(current) : 0;
            for (let i = 0; i < n; i++) {
                const child = model.getChildAt(current, i);
                out.push(child);
                stack.push(child);
            }
        }
        return out;
    }

    /** Reads the actual circle footprint, including offsets and disabled slots, without retile or writes. */ // CHANGE
    function readPlantingFootprint(group) { // CHANGE
        const geometry = group && group.getGeometry && group.getGeometry(); // CHANGE
        if (!geometry) return null; // CHANGE
        const sx = toPx(Number(getXmlAttr(group, "spacing_x_cm", "") || getXmlAttr(group, "spacing_cm", "30"))); // CHANGE
        const sy = toPx(Number(getXmlAttr(group, "spacing_y_cm", "") || getXmlAttr(group, "spacing_cm", "30"))); // CHANGE
        if (!(sx > 0 && sy > 0)) return null; // CHANGE
        const diameter = getPlantCircleDiameterPx(group) || Math.max(6, clamp(DEFAULT_ICON_DIAM_RATIO * Math.min(sx, sy), MIN_ICON_DIAM_PX, MAX_ICON_DIAM_PX)); // CHANGE
        let bbox = isCollapsedLOD(group) ? null : getPlantCircleBBoxLogical(group); // CHANGE
        if (!bbox) { // CHANGE
            const bandPx = groupLabelMetrics(group).bandPx; // CHANGE
            const stats = classifyPlantingSlots(group, sx, sy, bandPx, readDisabledSet(group)); // CHANGE
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity; // CHANGE
            stats.renderedKeys.forEach(key => { // CHANGE
                const [r, c] = key.split(",").map(Number); // CHANGE
                const point = shiftedSlotCenterLocal(group, r, c, sx, sy, bandPx); // CHANGE
                minX = Math.min(minX, point.x - diameter / 2); minY = Math.min(minY, point.y - diameter / 2); // CHANGE
                maxX = Math.max(maxX, point.x + diameter / 2); maxY = Math.max(maxY, point.y + diameter / 2); // CHANGE
            }); // CHANGE
            if (!Number.isFinite(minX)) return null; // CHANGE
            bbox = { x: minX, y: minY, w: maxX - minX, h: maxY - minY }; // CHANGE
        } // CHANGE
        const rotation = getTilerRotationDeg(group); // CHANGE
        const center = modelPointForLocalPoint(geometry, { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h / 2 }, rotation); // CHANGE
        return { x: center.x - bbox.w / 2, y: center.y - bbox.h / 2, width: bbox.w, height: bbox.h, rotation }; // CHANGE
    } // CHANGE

    function listPlantingFootprints(moduleCell, options = {}) {
        const year = Number(options.year);
        const includeUndated = options.includeUndatedOccupancy === true;
        const yearStart = Number.isFinite(year) ? `${year}-01-01` : "";
        const yearEnd = Number.isFinite(year) ? `${year}-12-31` : "";
        return allDescendantsOf(moduleCell).filter(isTilerGroup).map(function (group) {
            const geo = group.getGeometry && group.getGeometry();
            if (!geo) return null;
            const plantingRect = readPlantingFootprint(group); // CHANGE: bed membership follows plants, not a header-shifted outer rectangle.
            const center = plantingRect ? { x: plantingRect.x + plantingRect.width / 2, y: plantingRect.y + plantingRect.height / 2 } : { x: geo.x + geo.width / 2, y: geo.y + geo.height / 2 }; // CHANGE
            const bed = findSmallestContainingBedModel(moduleCell, center);
            if (!bed) return null;
            const bedEntryISO = firstNonEmptyCellAttr(group, ["lifespan_start", "transplant_date", "bed_entry_date", "sow_date", "planting_date", "start"]);
            const harvestEndISO = firstNonEmptyCellAttr(group, ["lifespan_end", "harvest_end", "harvest_end_date", "planting_harvest_end", "season_harvest_end", "end"]);
            if ((!ymdValue(bedEntryISO) || !ymdValue(harvestEndISO)) && !includeUndated) return null;
            if (yearStart && ymdValue(bedEntryISO) && ymdValue(harvestEndISO) && !ymdIntervalsOverlap(yearStart, yearEnd, bedEntryISO, harvestEndISO)) return null;
            return {
                groupId: String(group.id || group.getId && group.getId() || ""),
                bedId: String(bed.id || bed.getId && bed.getId() || ""),
                rect: { x: Number(geo.x) || 0, y: Number(geo.y) || 0, width: Math.max(0, Number(geo.width) || 0), height: Math.max(0, Number(geo.height) || 0) },
                plantingRect, // CHANGE: preserve outer bounds for consumers while allocation uses crop occupancy only.
                bedEntryISO,
                harvestEndISO,
                plantId: String(getXmlAttr(group, "plant_id", "") || ""),
                varietyId: String(getXmlAttr(group, "variety_id", "") || ""),
                plantName: String(getXmlAttr(group, "plant_name", "") || ""),
                varietyName: String(getXmlAttr(group, "variety_name", "") || "")
            };
        }).filter(Boolean);
    }

    function createPlantingFromProposal(input = {}, opts = {}) {
        const activeGraphArg = input.graph || graph;
        const proposal = input.proposal || input;
        if (proposal.ok === false) throw new Error("Cannot create a planting that does not physically fit."); // CHANGE
        const moduleCell = input.moduleCell || proposal.moduleCell || findGardenModuleAncestor(activeGraphArg, proposal.bedCell);
        if (!activeGraphArg || !moduleCell || !isGardenModule(moduleCell)) throw new Error("Planting creation requires a garden module.");
        const geometry = proposal.geometry || {};
        const centerX = Number(geometry.x || 0) + Number(geometry.width || 240) / 2;
        const centerY = Number(geometry.y || 0) + Number(geometry.height || 240) / 2;
        const moduleGeo = moduleCell.getGeometry && moduleCell.getGeometry();
        const group = createEmptyTilerGroup(activeGraphArg, moduleCell, (moduleGeo ? Number(moduleGeo.x) || 0 : 0) + centerX, (moduleGeo ? Number(moduleGeo.y) || 0 : 0) + centerY, { source: input.source || "allocate-create", select: opts.select !== false }); // CHANGE: transactional callers can defer selection until the planting and tasks succeed.
        const model = activeGraphArg.getModel && activeGraphArg.getModel();
        const attrs = Object.assign({}, input.attributes || proposal.attributes || {}, {
            allowed_overhang_pct: String(resolveAllowedOverhangPct(proposal.allowedOverhangPct)), // CHANGE
            plant_count: String(Math.max(0, Math.trunc(Number(proposal.plantCount) || 0))),
            spacing_x_cm: String(proposal.spacingXCm || 30),
            spacing_y_cm: String(proposal.spacingYCm || 30),
            spacing_cm: String(proposal.spacingXCm === proposal.spacingYCm ? proposal.spacingXCm || 30 : getXmlAttr(group, "spacing_cm", "30")),
            veg_height_cm: proposal.vegHeightCm == null ? String((input.attributes || proposal.attributes || {}).veg_height_cm || "") : String(proposal.vegHeightCm), // CHANGE
            veg_diameter_cm: proposal.vegDiameterCm == null ? String((input.attributes || proposal.attributes || {}).veg_diameter_cm || "") : String(proposal.vegDiameterCm), // CHANGE
            layout_offset_x_cm: String(proposal.layoutOffsetXCm || 0), layout_offset_y_cm: String(proposal.layoutOffsetYCm || 0), // CHANGE
            ...(proposal.disabledSlots ? { disabled_plants: JSON.stringify(proposal.disabledSlots) } : {}) // CHANGE
        });
        if (model) {
            const insideUpdate = !!(input.insideUpdate || opts.insideUpdate);
            if (!insideUpdate) model.beginUpdate();
            try {
                if (geometry && Number.isFinite(Number(geometry.width)) && Number.isFinite(Number(geometry.height))) {
                    model.setGeometry(group, new mxGeometry(Number(geometry.x) || 0, Number(geometry.y) || 0, Math.max(1, Number(geometry.width) || 1), Math.max(1, Number(geometry.height) || 1)));
                }
                setCellAttrsNoTxn(model, group, attrs);
                if (proposal.sharedFootprint) { // CHANGE: companion frames must not auto-fit back to the entire bed.
                    writeBedFitAxesNoTxn(model, group, false, false); // CHANGE
                    setCellAttrsNoTxn(model, group, { bed_auto_fit: '0' }); // CHANGE
                    setCellRotationDeg(group, proposal.rotation || 0); // CHANGE
                } // CHANGE
                if (proposal.fitAxis) { // CHANGE: resizing subsequently consumes the same persisted fitting-axis intent.
                    writeBedFitAxesNoTxn(model, group, proposal.fitAxis === "width" || proposal.fillAvailableBed === true, proposal.fitAxis === "height" || proposal.fillAvailableBed === true); // CHANGE
                    setCellRotationDeg(group, proposal.rotation || 0); // CHANGE
                    const grid = computeGridStatsXY(group, toPx(proposal.spacingXCm), toPx(proposal.spacingYCm)); // CHANGE
                    const disabled = new Set(); // CHANGE
                    for (let r = 0; r < grid.rows; r++) { // CHANGE
                        for (let c = 0; c < grid.cols; c++) { // CHANGE
                            const outsideOffsetRange = proposal.activeColumns && (c < proposal.activeColumns.first || c > proposal.activeColumns.last) || proposal.activeRows && (r < proposal.activeRows.first || r > proposal.activeRows.last); // CHANGE
                            if (outsideOffsetRange || r >= proposal.rows || c >= proposal.cols || !proposal.activeRows && r * proposal.cols + c >= proposal.plantCount) disabled.add(`${r},${c}`); // CHANGE: shifted rows retain their original grid keys at commit.
                        } // CHANGE
                    } // CHANGE
                    writeDisabledSet(model, group, disabled); // CHANGE
                } // CHANGE
                retileGroup(activeGraphArg, group, { inTransaction: true, forceExpand: proposal.lodCollapsed !== true });
                if (proposal.lodCollapsed === true) retileGroup(activeGraphArg, group, { inTransaction: true, forceCollapse: true });
            } finally {
                if (!insideUpdate) model.endUpdate();
            }
        }
        return group;
    }

    function computeGridStatsXY(groupCell, spacingXpx, spacingYpx) {
        const g = groupCell.getGeometry();
        const { bandPx } = groupLabelMetrics(groupCell);
        const usableW = Math.max(0, g.width - GROUP_PADDING_PX * 2);
        const usableH = Math.max(0, g.height - GROUP_PADDING_PX * 2 - bandPx);
        if (usableW <= 0 || usableH <= 0) return { rows: 0, cols: 0, count: 0 };
        const cols = Math.max(1, Math.floor((usableW + 1e-7) / spacingXpx)); // CHANGE: fitted dimensions must not lose a column to floating-point subtraction.
        const rows = Math.max(1, Math.floor((usableH + 1e-7) / spacingYpx)); // CHANGE: solved dynamic header heights preserve exact whole-row counts.
        return { rows, cols, count: rows * cols };
    }

    function classifyPlantingSlots(groupCell, spacingXpx, spacingYpx, bandPx, disabledSet) { // NEW: one source of truth for offset omission and counts.
        const grid = computeGridStatsXY(groupCell, spacingXpx, spacingYpx);
        const disabled = disabledSet || new Set();
        const inBoundsKeys = new Set();
        const renderedKeys = new Set();
        const omittedKeys = new Set();
        let disabledInBounds = 0;
        for (let r = 0; r < grid.rows; r++) {
            for (let c = 0; c < grid.cols; c++) {
                const key = `${r},${c}`;
                const center = shiftedSlotCenterLocal(groupCell, r, c, spacingXpx, spacingYpx, bandPx);
                const inBounds = isPointInPlantingContentArea(groupCell, center, bandPx);
                if (inBounds) inBoundsKeys.add(key);
                if (disabled.has(key)) {
                    if (inBounds) disabledInBounds += 1;
                    continue;
                }
                if (!inBounds) {
                    omittedKeys.add(key);
                    continue;
                }
                renderedKeys.add(key);
            }
        }
        return Object.assign({}, grid, {
            theoretical: grid.count,
            omitted: omittedKeys.size,
            capacity: inBoundsKeys.size,
            disabled: disabledInBounds,
            actual: renderedKeys.size,
            inBoundsKeys,
            renderedKeys,
            omittedKeys
        });
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
                    log("Already inside planting group; skip");
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
        const { bandPx } = groupLabelMetrics(groupCell);
        const stats = classifyPlantingSlots(groupCell, sx, sy, bandPx, readDisabledSet(groupCell));
        if (stats.actual > MAX_TILES) {
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
            timer = setTimeout(flushRotationLayouts, ROTATION_RETILE_DEBOUNCE_MS); // CHANGE
        } // CHANGE

        /** Flush the prior committed rotation before another edit captures its child positions. */ // CHANGE
        function flushRotationLayouts() { // CHANGE
            if (timer) clearTimeout(timer); // CHANGE
            if (!queue.size) { timer = null; return; } // CHANGE
            const items = Array.from(queue.values()); // CHANGE
            queue.clear(); // CHANGE
            timer = null; // CHANGE
            guard = true; // CHANGE
            const groupsNeedingRefresh = []; // CHANGE
            try { // CHANGE
                withUndoSuppressed(function () { // CHANGE
                    model.beginUpdate(); // CHANGE
                    try { // CHANGE
                        for (const item of items) { // CHANGE
                            if (!item.groupCell || !isTilerGroup(item.groupCell)) continue; // CHANGE
                            retileGroup(graph, item.groupCell, { layoutSnapshot: item.layoutSnapshot, useLiveSnapshot: false, preferInPlace: true, inTransaction: true }); // CHANGE
                            groupsNeedingRefresh.push(item.groupCell); // CHANGE
                        } // CHANGE
                    } finally { // CHANGE
                        model.endUpdate(); // CHANGE
                    } // CHANGE
                }); // CHANGE
            } finally { // CHANGE
                guard = false; // CHANGE
            } // CHANGE
            for (const group of groupsNeedingRefresh) graph.refresh(group); // CHANGE
        } // CHANGE
        graph.__plantTilerFlushRotationLayouts = flushRotationLayouts; // CHANGE: the bed controller calls this before starting a subsequent transaction.

        model.addListener(mxEvent.CHANGE, function (_sender, evt) {
            if (guard) return;
            const edit = evt && evt.getProperty && evt.getProperty("edit");
            const changes = edit && edit.changes ? edit.changes : [];
            const geometryByCellId = previousGeometryByCellIdFromChanges(changes);
            for (const change of changes) {
                const rotationChange = rotationChangedFromStyleChange(change);
                if (!rotationChange) continue;
                if (edit.__trellisBedTransformGroups && edit.__trellisBedTransformGroups.has(rotationChange.cell.id)) { // CHANGE: this edit already carries the exact child layout, including undo/redo.
                    queue.delete(rotationChange.cell.id); // CHANGE
                    continue; // CHANGE
                } // CHANGE
                if (rotationChange.cell && rotationChange.cell.id && queue.has(rotationChange.cell.id)) {
                    schedule(rotationChange.cell, null);
                    continue;
                }
                const snap = rotationLayoutSnapshot(rotationChange.cell, rotationChange.before, geometryByCellId);
                schedule(rotationChange.cell, snap);
            }
        });
    })();

    /**
     * Carry spatial bed contents as a rigid unit. Snapshots belong to the current
     * mxGraph edit, not the view, so hidden cells and undo/redo share the same data.
     * Model execution captures old state; the outer endUpdate commits companions
     * after snapping and before notifications. Preview never writes to the model.
     */
    function installBedTransformController() { // CHANGE
        const geometryChange = change => change instanceof mxGeometryChange; // CHANGE
        const styleChange = change => change instanceof mxStyleChange; // CHANGE
        const childChange = change => change instanceof mxChildChange; // CHANGE
        let applying = false, copying = 0, loading = 0, flushing = false; // CHANGE
        let gestureSnapshots = new Map(); // CHANGE
        const snapshots = new WeakMap(); // CHANGE

        /** Read the first previous value in an edit, including independently selected contents. */
        function originalReader(edit) { // CHANGE
            const geometries = new Map(), styles = new Map(), parents = new Map(); // CHANGE
            for (const change of edit && edit.changes || []) { // CHANGE
                if (geometryChange(change) && !geometries.has(change.cell)) geometries.set(change.cell, change.previous); // CHANGE
                if (styleChange(change) && !styles.has(change.cell)) styles.set(change.cell, change.previous); // CHANGE
                if (childChange(change) && !parents.has(change.child)) parents.set(change.child, change.previous); // CHANGE
            } // CHANGE
            return { // CHANGE
                geometry: cell => geometries.has(cell) ? geometries.get(cell) : model.getGeometry(cell), // CHANGE
                style: cell => styles.has(cell) ? styles.get(cell) : model.getStyle(cell), // CHANGE
                parent: cell => parents.has(cell) ? parents.get(cell) : model.getParent(cell), // CHANGE
                previousParents: parents // CHANGE
            }; // CHANGE
        } // CHANGE

        const live = { geometry: cell => model.getGeometry(cell), style: cell => model.getStyle(cell), parent: cell => model.getParent(cell) }; // CHANGE

        /** Finish a previous independent rotation before the next transaction snapshots its layout. */
        function flushPendingLayouts() { // CHANGE
            if (flushing || applying || !graph.__plantTilerFlushRotationLayouts) return; // CHANGE
            flushing = true; // CHANGE
            try { graph.__plantTilerFlushRotationLayouts(); } finally { flushing = false; } // CHANGE
        } // CHANGE

        function angle(cell, reader) { // CHANGE
            const sheet = graph.getStylesheet(); // CHANGE
            const defaults = model.isEdge(cell) ? sheet.getDefaultEdgeStyle() : sheet.getDefaultVertexStyle(); // CHANGE
            return Number(sheet.getCellStyle(reader.style(cell), defaults).rotation) || 0; // CHANGE
        } // CHANGE

        /** mxGraph children have untranslated local coordinates; parent rotation is not inherited. */
        function origin(cell, reader) { // CHANGE
            if (!cell) return { x: 0, y: 0 }; // CHANGE
            const parent = reader.parent(cell), base = origin(parent, reader), geo = reader.geometry(cell); // CHANGE
            if (!geo || model.isEdge(cell)) return base; // CHANGE
            const pg = parent && reader.geometry(parent); // CHANGE
            return { // CHANGE
                x: base.x + (geo.relative && pg ? geo.x * pg.width + (geo.offset && geo.offset.x || 0) : geo.x), // CHANGE
                y: base.y + (geo.relative && pg ? geo.y * pg.height + (geo.offset && geo.offset.y || 0) : geo.y) // CHANGE
            }; // CHANGE
        } // CHANGE

        function center(cell, reader) { // CHANGE
            const geo = reader.geometry(cell), point = origin(cell, reader); // CHANGE
            return geo ? { x: point.x + geo.width / 2, y: point.y + geo.height / 2 } : point; // CHANGE
        } // CHANGE

        function children(parent, reader) { // CHANGE
            // Model traversal deliberately includes invisible vertices, unlike view-based queries.
            const candidates = new Set(model.getChildren(parent) || []); // CHANGE
            if (reader.previousParents) reader.previousParents.forEach((previous, cell) => { if (previous === parent) candidates.add(cell); }); // CHANGE
            return Array.from(candidates).filter(cell => reader.parent(cell) === parent); // CHANGE
        } // CHANGE

        function containingBed(cell, reader) { // CHANGE
            const parent = reader.parent(cell); // CHANGE
            if (isGardenBed(parent)) return parent; // CHANGE
            const point = center(cell, reader); // CHANGE
            let chosen = null, area = Infinity; // CHANGE
            for (const candidate of children(parent, reader)) { // CHANGE
                if (!isGardenBed(candidate)) continue; // CHANGE
                const geo = reader.geometry(candidate); // CHANGE
                if (!geo || geo.width <= 0 || geo.height <= 0) continue; // CHANGE
                const c = center(candidate, reader), p = rotatePointAround(point, c, -angle(candidate, reader)); // CHANGE
                const o = origin(candidate, reader); // CHANGE
                if (p.x >= o.x - ROTATION_EPS_DEG && p.x <= o.x + geo.width + ROTATION_EPS_DEG && // CHANGE
                    p.y >= o.y - ROTATION_EPS_DEG && p.y <= o.y + geo.height + ROTATION_EPS_DEG && geo.width * geo.height < area) { // CHANGE
                    chosen = candidate; area = geo.width * geo.height; // CHANGE
                } // CHANGE
            } // CHANGE
            return chosen; // CHANGE
        } // CHANGE

        function resolve(cell, reader = live) { // CHANGE
            while (cell && !isGardenBed(cell) && !isTilerGroup(cell) && !isIrrigationBedAssembly(cell)) cell = reader.parent(cell); // CHANGE
            const bed = isGardenBed(cell) ? cell : cell && containingBed(cell, reader); // CHANGE
            if (!bed) return null; // CHANGE
            const candidates = children(reader.parent(bed), reader).concat(children(bed, reader)); // CHANGE
            const plantingGroups = [], bedAssemblies = []; // CHANGE
            for (const member of candidates) { // CHANGE
                if (!(isTilerGroup(member) || isIrrigationBedAssembly(member)) || containingBed(member, reader) !== bed) continue; // CHANGE
                (isTilerGroup(member) ? plantingGroups : bedAssemblies).push(member); // CHANGE
            } // CHANGE
            return { bed, plantingGroups, bedAssemblies, cells: [bed].concat(bedAssemblies, plantingGroups) }; // CHANGE
        } // CHANGE

        function capture(bed, reader) { // CHANGE
            const unit = resolve(bed, reader), geo = reader.geometry(bed); // CHANGE
            if (!unit || !geo) return null; // CHANGE
            const records = new Map(); // CHANGE
            function visit(cell) { // CHANGE
                if (records.has(cell)) return; // CHANGE
                const g = reader.geometry(cell); // CHANGE
                if (g) records.set(cell, { cell, geometry: g.clone(), parent: reader.parent(cell), parentOrigin: origin(reader.parent(cell), reader), center: center(cell, reader), rotation: angle(cell, reader) }); // CHANGE
                for (const child of children(cell, reader)) visit(child); // CHANGE
            } // CHANGE
            for (const member of unit.cells.slice(1)) visit(member); // CHANGE
            return { unit, parent: reader.parent(bed), geometry: geo.clone(), center: center(bed, reader), rotation: angle(bed, reader), records }; // CHANGE
        } // CHANGE

        /** Permissions are independent of draw.io locks. Carrying never modifies a lock style. */
        function deniedMember(snapshot, rotation) { // CHANGE
            const users = window.Trellis && window.Trellis.users; // CHANGE
            if (!users) return null; // CHANGE
            // Production Users exposes canEditCell; geometry-specific checks may be supplied by an adapter.
            const canMove = users.canMoveCell || users.canEditCell; // CHANGE
            const parent = model.getParent(snapshot.unit.bed); // CHANGE
            if (parent !== snapshot.parent && users.canAddCell && !users.canAddCell(parent)) return parent; // CHANGE
            return [snapshot.unit.bed].concat(Array.from(snapshot.records.keys())).find(cell => // CHANGE
                canMove && !canMove(cell) || // CHANGE
                rotation && !model.isEdge(cell) && users.canEditCell && !users.canEditCell(cell)) || null; // CHANGE
        } // CHANGE

        function canCarry(unit) { // CHANGE
            const snapshot = unit && capture(unit.bed, live); // CHANGE
            return !!snapshot && !deniedMember(snapshot, false); // CHANGE
        } // CHANGE

        function isCarried(cell) { // CHANGE
            const units = snapshots.get(model.currentEdit); // CHANGE
            return !!units && Array.from(units.values()).some(snapshot => snapshot.records.has(cell)); // CHANGE
        } // CHANGE

        function transformPoint(point, snapshot, targetCenter, delta) { // CHANGE
            const rotated = rotatePointAround(point, snapshot.center, delta); // CHANGE
            return { x: rotated.x + targetCenter.x - snapshot.center.x, y: rotated.y + targetCenter.y - snapshot.center.y }; // CHANGE
        } // CHANGE

        /** Convert the transformed world position back to the current parent coordinate system. */
        function transformedGeometry(record, snapshot, targetCenter, delta) { // CHANGE
            const cell = record.cell, geo = record.geometry.clone(), parent = model.getParent(cell), po = origin(parent, live); // CHANGE
            const convert = point => { // CHANGE
                const result = transformPoint({ x: point.x + record.parentOrigin.x, y: point.y + record.parentOrigin.y }, snapshot, targetCenter, delta); // CHANGE
                return new mxPoint(result.x - po.x, result.y - po.y); // CHANGE
            }; // CHANGE
            if (model.isEdge(cell)) { // CHANGE
                if (geo.sourcePoint) geo.sourcePoint = convert(geo.sourcePoint); // CHANGE
                if (geo.targetPoint) geo.targetPoint = convert(geo.targetPoint); // CHANGE
                if (geo.points) geo.points = geo.points.map(point => point && convert(point)); // CHANGE
                if (geo.offset && delta) { // CHANGE
                    const offset = rotatePointAround(geo.offset, { x: 0, y: 0 }, delta); // CHANGE
                    geo.offset = new mxPoint(offset.x, offset.y); // CHANGE
                } // CHANGE
            } else { // CHANGE
                const c = transformPoint(record.center, snapshot, targetCenter, delta); // CHANGE
                const x = c.x - po.x - geo.width / 2, y = c.y - po.y - geo.height / 2; // CHANGE
                if (geo.relative) { // CHANGE
                    const pg = model.getGeometry(parent); // CHANGE
                    geo.offset = new mxPoint(x - geo.x * (pg && pg.width || 0), y - geo.y * (pg && pg.height || 0)); // CHANGE
                } else { geo.x = x; geo.y = y; } // CHANGE
            } // CHANGE
            return geo; // CHANGE
        } // CHANGE

        function finalize(edit) { // CHANGE
            const units = snapshots.get(edit); // CHANGE
            if (!units || applying) return; // CHANGE
            snapshots.delete(edit); // CHANGE
            const active = Array.from(units.values()).filter(snapshot => { // CHANGE
                const geo = model.getGeometry(snapshot.unit.bed); // CHANGE
                return model.contains(snapshot.unit.bed) && geo && nearlySameNumber(geo.width, snapshot.geometry.width) && nearlySameNumber(geo.height, snapshot.geometry.height); // CHANGE
            }); // CHANGE
            const denied = active.map(snapshot => deniedMember(snapshot, !nearlySameNumber(angle(snapshot.unit.bed, live), snapshot.rotation))).find(Boolean); // CHANGE
            if (denied) { // CHANGE
                // Roll back before publication; an empty edit produces no undo entry or partial save.
                applying = true; // CHANGE
                try { for (let i = edit.changes.length - 1; i >= 0; i--) edit.changes[i].execute(); edit.changes.length = 0; } // CHANGE
                finally { applying = false; } // CHANGE
                if (ui.handleError) ui.handleError(new Error('Cannot move or rotate this bed: access is required for ' + graph.convertValueToString(denied) + '.')); // CHANGE
                graph.refresh(); // CHANGE
                return; // CHANGE
            } // CHANGE
            applying = true; // CHANGE
            edit.__trellisBedTransformGroups = new Set(); // CHANGE
            try { // CHANGE
                const carried = new Set(); // CHANGE
                for (const snapshot of active) { // CHANGE
                    const bed = snapshot.unit.bed, targetCenter = center(bed, live), delta = angle(bed, live) - snapshot.rotation; // CHANGE
                    const parent = model.getParent(bed); // CHANGE
                    if (parent !== snapshot.parent) for (const member of snapshot.unit.cells.slice(1)) { // CHANGE
                        const record = snapshot.records.get(member); // CHANGE
                        if (record && record.parent === snapshot.parent && model.getParent(member) === snapshot.parent) model.add(parent, member); // CHANGE
                    } // CHANGE
                    for (const record of snapshot.records.values()) { // CHANGE
                        const cell = record.cell; // CHANGE
                        if (!model.contains(cell) || carried.has(cell)) continue; // CHANGE
                        carried.add(cell); // CHANGE
                        const next = transformedGeometry(record, snapshot, targetCenter, delta); // CHANGE
                        if (!model.getGeometry(cell).equals(next)) model.setGeometry(cell, next); // CHANGE
                        if (!model.isEdge(cell)) setCellRotationDeg(cell, record.rotation + delta); // CHANGE
                        if (isTilerGroup(cell)) edit.__trellisBedTransformGroups.add(cell.id); // CHANGE
                    } // CHANGE
                } // CHANGE
            } finally { applying = false; } // CHANGE
        } // CHANGE

        const execute = model.execute; // CHANGE
        model.execute = function (change) { // CHANGE
            if (this.updateLevel === 0) flushPendingLayouts(); // CHANGE
            const bed = change.cell; // CHANGE
            if (!applying && !copying && !loading && !ui.openingFile && isGardenBed(bed) && model.contains(bed) && (geometryChange(change) || styleChange(change))) { // CHANGE
                const before = model.getGeometry(bed), next = geometryChange(change) && change.geometry; // CHANGE
                const moving = before && next && nearlySameNumber(before.width, next.width) && nearlySameNumber(before.height, next.height) && (!nearlySameNumber(before.x, next.x) || !nearlySameNumber(before.y, next.y)); // CHANGE
                const rotating = styleChange(change) && angle(bed, live) !== angle(bed, { style: () => change.style }); // CHANGE
                if (moving || rotating) { // CHANGE
                    let units = snapshots.get(this.currentEdit); // CHANGE
                    if (!units) { units = new Map(); snapshots.set(this.currentEdit, units); } // CHANGE
                    if (!units.has(bed)) { // CHANGE
                        const snapshot = gestureSnapshots.get(bed) || capture(bed, originalReader(this.currentEdit)); // CHANGE
                        if (snapshot) units.set(bed, snapshot); // CHANGE
                    } // CHANGE
                } // CHANGE
            } // CHANGE
            return execute.apply(this, arguments); // CHANGE
        }; // CHANGE
        const beginUpdate = model.beginUpdate; // CHANGE
        model.beginUpdate = function () { // CHANGE
            if (this.updateLevel === 0) flushPendingLayouts(); // CHANGE
            return beginUpdate.apply(this, arguments); // CHANGE
        }; // CHANGE
        const endUpdate = model.endUpdate; // CHANGE
        model.endUpdate = function () { // CHANGE
            if (this.updateLevel === 1 && !this.endingUpdate) finalize(this.currentEdit); // CHANGE
            return endUpdate.apply(this, arguments); // CHANGE
        }; // CHANGE

        const moveCells = graph.moveCells; // CHANGE
        graph.moveCells = function (cells, dx, dy, clone) { // CHANGE
            if (clone) copying++; // CHANGE
            try { return moveCells.apply(this, arguments); } // CHANGE
            finally { if (clone) copying--; } // CHANGE
        }; // CHANGE
        if (graph.setGraphXml) { // CHANGE
            const setGraphXml = graph.setGraphXml; // CHANGE
            graph.setGraphXml = function () { loading++; try { return setGraphXml.apply(this, arguments); } finally { loading--; } }; // CHANGE
        } // CHANGE

        /** Clone rendered SVG/HTML once per gesture; transform wrappers without touching live states. */
        function createPreview(beds, extraCells = []) { // CHANGE
            flushPendingLayouts(); // CHANGE
            const units = Array.from(new Set(beds)).map(bed => capture(bed, live)).filter(Boolean); // CHANGE
            if (extraCells.length) { // CHANGE
                const records = new Map(); // CHANGE
                function visit(cell) { records.set(cell, { cell }); for (const child of model.getChildren(cell) || []) visit(child); } // CHANGE
                extraCells.forEach(visit); // CHANGE
                units.push({ unit: { bed: { id: 'selection' } }, center: { x: 0, y: 0 }, records }); // CHANGE
            } // CHANGE
            const wrappers = [], hidden = [], seen = new Set(); // CHANGE
            let frame = null, pending = null; // CHANGE
            for (const snapshot of units) { // CHANGE
                // Calibrate the pivot from the view so drilling into a module uses its local origin.
                const state = graph.view.getState(snapshot.unit.bed), view = graph.view; // CHANGE
                snapshot.previewCenter = state ? { x: state.getCenterX() / view.scale - view.translate.x, y: state.getCenterY() / view.scale - view.translate.y } : snapshot.center; // CHANGE
                const parents = new Map(); // CHANGE
                const cells = [snapshot.unit.bed].concat(Array.from(snapshot.records.keys())); // CHANGE
                for (const cell of cells) { // CHANGE
                    const state = graph.view.getState(cell); // CHANGE
                    if (!state || !graph.isCellVisible(cell)) continue; // CHANGE
                    for (const rendered of [state.shape, state.text]) { // CHANGE
                        const node = rendered && rendered.node; // CHANGE
                        if (!node || !node.parentNode || seen.has(node)) continue; // CHANGE
                        seen.add(node); // CHANGE
                        const svg = node.namespaceURI === 'http://www.w3.org/2000/svg'; // CHANGE
                        let wrapper = parents.get(node.parentNode); // CHANGE
                        if (!wrapper) { // CHANGE
                            wrapper = svg ? document.createElementNS(node.namespaceURI, 'g') : document.createElement('div'); // CHANGE
                            wrapper.setAttribute('data-trellis-bed-transform-preview', snapshot.unit.bed.id); // CHANGE
                            wrapper.style.pointerEvents = 'none'; // CHANGE
                            if (!svg) wrapper.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;transform-origin:0 0;'; // CHANGE
                            node.parentNode.appendChild(wrapper); // CHANGE
                            parents.set(node.parentNode, wrapper); // CHANGE
                            wrappers.push({ wrapper, svg, snapshot }); // CHANGE
                        } // CHANGE
                        const copy = node.cloneNode(true); // CHANGE
                        copy.removeAttribute('id'); copy.style.visibility = 'visible'; copy.style.pointerEvents = 'none'; // CHANGE
                        for (const child of copy.querySelectorAll('*')) child.style.pointerEvents = 'none'; // CHANGE
                        copy.setAttribute('data-trellis-bed-preview-cell', cell.id); // CHANGE
                        copy.setAttribute('data-trellis-bed-preview-kind', rendered === state.shape ? 'shape' : 'text'); // CHANGE
                        wrapper.appendChild(copy); // CHANGE
                        hidden.push({ node, visibility: node.style.visibility }); node.style.visibility = 'hidden'; // CHANGE
                    } // CHANGE
                } // CHANGE
            } // CHANGE
            function paint() { // CHANGE
                frame = null; // CHANGE
                if (!pending) return; // CHANGE
                const view = graph.view, scale = view.scale, tr = view.translate; // CHANGE
                for (const { wrapper, svg, snapshot } of wrappers) { // CHANGE
                    const target = pending(snapshot), c = snapshot.previewCenter; // CHANGE
                    const x = (c.x + tr.x) * scale, y = (c.y + tr.y) * scale; // CHANGE
                    const tx = x + (target.dx || 0) * scale, ty = y + (target.dy || 0) * scale; // CHANGE
                    const transform = 'translate(' + tx + (svg ? ' ' : 'px,') + ty + (svg ? ')' : 'px)') + // CHANGE
                        ' rotate(' + (target.delta || 0) + (svg ? ')' : 'deg)') + // CHANGE
                        ' translate(' + -x + (svg ? ' ' : 'px,') + -y + (svg ? ')' : 'px)'); // CHANGE
                    if (svg) wrapper.setAttribute('transform', transform); else wrapper.style.transform = transform; // CHANGE
                } // CHANGE
            } // CHANGE
            return { // CHANGE
                snapshots: units, // CHANGE
                update(target) { pending = target; if (frame == null) frame = window.requestAnimationFrame(paint); }, // CHANGE
                clear() { // CHANGE
                    if (frame != null) window.cancelAnimationFrame(frame); // CHANGE
                    for (const { wrapper } of wrappers) wrapper.remove(); // CHANGE
                    for (const { node, visibility } of hidden) node.style.visibility = visibility; // CHANGE
                    pending = null; frame = null; // CHANGE
                } // CHANGE
            }; // CHANGE
        } // CHANGE

        function clearHandlerPreview(handler) { // CHANGE
            if (handler.__trellisBedPreview) handler.__trellisBedPreview.clear(); // CHANGE
            handler.__trellisBedPreview = null; // CHANGE
        } // CHANGE

        /** Freeze preview membership through mouse-up; nested handlers restore the previous operation. */
        function beginGestureCommit(handler) { // CHANGE
            const previous = gestureSnapshots; // CHANGE
            gestureSnapshots = new Map(); // CHANGE
            if (handler.__trellisBedPreview && !handler.cloning) for (const snapshot of handler.__trellisBedPreview.snapshots) { // CHANGE
                if (isGardenBed(snapshot.unit.bed)) gestureSnapshots.set(snapshot.unit.bed, snapshot); // CHANGE
            } // CHANGE
            return previous; // CHANGE
        } // CHANGE

        /** Preview adapter is installed per graph; global prototypes dispatch to the owning service. */
        function previewMove(handler) { // CHANGE
            const beds = (handler.cells || []).filter(isGardenBed); // CHANGE
            if (!beds.length || handler.cloning || handler.suspended) { clearHandlerPreview(handler); return false; } // CHANGE
            if (!handler.__trellisBedPreview) handler.__trellisBedPreview = createPreview(beds, (handler.cells || []).filter(cell => !isGardenBed(cell))); // CHANGE
            const scale = graph.view.scale; // CHANGE
            handler.__trellisBedPreview.update(snapshot => { // CHANGE
                let dx = handler.roundLength((handler.currentDx || 0) / scale), dy = handler.roundLength((handler.currentDy || 0) / scale); // CHANGE
                const bed = snapshot.unit.bed, module = isAxisAlignedPathSnapBed(bed) && findGardenModuleAncestor(graph, bed); // CHANGE
                if (module && beds.length === 1 && (handler.cells || []).length === 1 && !isBedPathSnapAltBypassActive() && (!handler.target || graph.__trellisWorkspaceHandleDragActive)) { // CHANGE
                    const rect = movedRect(getModelRect(bed), dx, dy), snap = evaluateBedPathSnap(module, bed, rect); // CHANGE
                    if (snap) { dx += snap.dx || 0; dy += snap.dy || 0; } // CHANGE
                } // CHANGE
                return { dx, dy }; // CHANGE
            }); // CHANGE
            return true; // CHANGE
        } // CHANGE

        function previewRotation(handler) { // CHANGE
            const bed = handler.state && handler.state.cell; // CHANGE
            if (!isGardenBed(bed)) return; // CHANGE
            if (!handler.__trellisBedPreview) handler.__trellisBedPreview = createPreview([bed]); // CHANGE
            handler.__trellisBedPreview.update(snapshot => ({ delta: (handler.currentAlpha || 0) - snapshot.rotation })); // CHANGE
        } // CHANGE

        graph.__trellisBedTransforms = { resolve, canCarry, isCarried, createPreview, previewMove, previewRotation, clearHandlerPreview, beginGestureCommit, endGestureCommit: previous => { gestureSnapshots = previous; } }; // CHANGE

        if (!mxGraphHandler.prototype.__trellisBedPreviewInstalled) { // CHANGE
            mxGraphHandler.prototype.__trellisBedPreviewInstalled = true; // CHANGE
            const updatePreview = mxGraphHandler.prototype.updatePreview, resetMove = mxGraphHandler.prototype.reset; // CHANGE
            mxGraphHandler.prototype.updatePreview = function () { // CHANGE
                const service = this.graph && this.graph.__trellisBedTransforms; // CHANGE
                if (service && service.previewMove(this)) { // CHANGE
                    // mouseUp requires a native preview marker even though our ghosts do the drawing.
                    if (!this.shape && this.pBounds) this.shape = this.createPreviewShape(this.pBounds); // CHANGE
                    this.livePreviewUsed = false; this.livePreviewActive = false; // CHANGE
                    if (this.shape && this.shape.node) this.shape.node.style.visibility = 'hidden'; // CHANGE
                    return; // CHANGE
                } // CHANGE
                if (this.shape && this.shape.node) this.shape.node.style.visibility = ''; // CHANGE
                return updatePreview.apply(this, arguments); // CHANGE
            }; // CHANGE
            mxGraphHandler.prototype.reset = function () { // CHANGE
                const service = this.graph && this.graph.__trellisBedTransforms; // CHANGE
                if (service) { // CHANGE
                    if (this.__trellisBedPreview && this.graph.selectionCellsHandler) this.setHandlesVisibleForCells(this.graph.selectionCellsHandler.getHandledSelectionCells(), true); // CHANGE
                    service.clearHandlerPreview(this); // CHANGE
                } // CHANGE
                return resetMove.apply(this, arguments); // CHANGE
            }; // CHANGE
            const rotate = mxVertexHandler.prototype.rotateVertex, resetRotation = mxVertexHandler.prototype.reset; // CHANGE
            mxVertexHandler.prototype.rotateVertex = function () { // CHANGE
                const result = rotate.apply(this, arguments), service = this.graph && this.graph.__trellisBedTransforms; // CHANGE
                if (service) service.previewRotation(this); // CHANGE
                return result; // CHANGE
            }; // CHANGE
            mxVertexHandler.prototype.reset = function () { // CHANGE
                const service = this.graph && this.graph.__trellisBedTransforms; // CHANGE
                if (service) service.clearHandlerPreview(this); // CHANGE
                return resetRotation.apply(this, arguments); // CHANGE
            }; // CHANGE
            for (const prototype of [mxGraphHandler.prototype, mxVertexHandler.prototype]) { // CHANGE
                const mouseUp = prototype.mouseUp, destroy = prototype.destroy; // CHANGE
                prototype.mouseUp = function () { // CHANGE
                    const service = this.graph && this.graph.__trellisBedTransforms; // CHANGE
                    const previous = service && service.beginGestureCommit(this); // CHANGE
                    if (service) service.clearHandlerPreview(this); // CHANGE
                    try { return mouseUp.apply(this, arguments); } // CHANGE
                    finally { if (service) service.endGestureCommit(previous); } // CHANGE
                }; // CHANGE
                prototype.destroy = function () { // CHANGE
                    const service = this.graph && this.graph.__trellisBedTransforms; // CHANGE
                    if (service) service.clearHandlerPreview(this); // CHANGE
                    return destroy.apply(this, arguments); // CHANGE
                }; // CHANGE
            } // CHANGE
        } // CHANGE
    } // CHANGE
    installBedTransformController(); // CHANGE

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
                    if (graph.__trellisBedTransforms && graph.__trellisBedTransforms.isCarried(cell)) continue; // CHANGE: moving with a bed is not an independent manual tile edit.

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

    let activeBedFitResizeIntents = null; // CHANGE: scoped to the current resize call, including nested bed refitting.
    let bedFitResizeGestureIntents = null; // CHANGE: the original fit state survives repeated events in one pointer gesture.

    /** Capture only directly resized groups; children and internal fits cannot release a parent's axes. */ // CHANGE
    function captureBedFitResizeIntents(cells, previous, intents) { // CHANGE
        const result = intents || new Map(); // CHANGE
        if (bedFitInProgress) return result; // CHANGE
        (cells || []).forEach(function (cell, index) { // CHANGE
            if (!isTilerGroup(cell) || cell.getAttribute(BED_AUTO_FIT_ATTR) === "0" || result.has(cell.id)) return; // CHANGE
            const geometry = previous ? previous[index] : graph.getModel().getGeometry(cell); // CHANGE
            if (geometry) result.set(cell.id, { geometry: geometry.clone(), axes: bedFitAxesForGroup(cell), releaseWidth: false, releaseHeight: false }); // CHANGE
        }); // CHANGE
        return result; // CHANGE
    } // CHANGE

    /** Release once per gesture, even if later events return to the original size. */ // CHANGE
    function releaseResizedBedFitAxes(cells, intents) { // CHANGE
        if (bedFitInProgress) return; // CHANGE
        const model = graph.getModel(); // CHANGE
        for (const cell of (cells || [])) { // CHANGE
            const intent = cell && intents.get(cell.id), geometry = cell && model.getGeometry(cell); // CHANGE
            if (!intent || !geometry) continue; // CHANGE
            intent.releaseWidth = intent.releaseWidth || (intent.axes.fitWidth && !nearlySameNumber(intent.geometry.width, geometry.width)); // CHANGE
            intent.releaseHeight = intent.releaseHeight || (intent.axes.fitHeight && !nearlySameNumber(intent.geometry.height, geometry.height)); // CHANGE
            if (intent.releaseWidth || intent.releaseHeight) { // CHANGE
                const axes = bedFitAxesForGroup(cell); // CHANGE
                writeBedFitAxesNoTxn(model, cell, axes.fitWidth && !intent.releaseWidth, axes.fitHeight && !intent.releaseHeight); // CHANGE
            } // CHANGE
        } // CHANGE
    } // CHANGE

    graph.addListener(mxEvent.FIRE_MOUSE_EVENT, function (_sender, evt) { // CHANGE: snapshot before handlers commit resize geometry on mouse-up.
        const eventName = evt.getProperty("eventName"); // CHANGE
        if (eventName === mxEvent.MOUSE_DOWN) { // CHANGE
            bedFitResizeGestureIntents = captureBedFitResizeIntents(graph.getSelectionCells()); // CHANGE
        } else if (eventName === mxEvent.MOUSE_UP) { // CHANGE
            const gesture = bedFitResizeGestureIntents; // CHANGE
            setTimeout(function () { if (bedFitResizeGestureIntents === gesture) bedFitResizeGestureIntents = null; }, 0); // CHANGE: handlers run after FIRE_MOUSE_EVENT.
        } // CHANGE
    }); // CHANGE

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
            const resizeIntents = activeBedFitResizeIntents || captureBedFitResizeIntents(cells, evt.getProperty("previous"), bedFitResizeGestureIntents); // CHANGE
            releaseResizedBedFitAxes(cells, resizeIntents); // CHANGE: flags change inside the same transaction as geometry.
            normalizeMovedTilerGroupsToBeds(cells, { source: "cells-resized", allowDragIntoBedFit: false, persistAxisIntent: true, clearFitAxisIntentOnNoBed: true, resizeIntents }); // CHANGE
            normalizeMovedBedAssembliesToBeds(cells, { source: "cells-resized", fitOnDrag: false, persistAxisIntent: true, clearFitAxisIntentOnNoBed: true });
        });
    })();

    (function installBedPathSnapMoveWrapper() {
        if (graph.__plantTilerBedPathSnapMoveInstalled) return; // NEW
        graph.__plantTilerBedPathSnapMoveInstalled = true; // NEW

        const oldMoveCells = graph.moveCells; // NEW
        graph.moveCells = function (cells, dx, dy, clone, target, evt, mapping) { // NEW
            const snapContext = resolveBedPathSnapMoveContext(cells, evt, clone, target); // CHANGE
            if (!snapContext) return oldMoveCells.call(this, cells, dx, dy, clone, target, evt, mapping); // CHANGE
            const model = graph.getModel(); // NEW
            let res; // NEW
            model.beginUpdate(); // NEW
            try { // NEW
                res = oldMoveCells.call(this, cells, dx, dy, clone, target, evt, mapping); // NEW
                applyBedPathSnapEvaluationNoTxn(model, snapContext, { source: "bed-moved", event: evt }); // CHANGE
            } finally { // NEW
                model.endUpdate(); // NEW
            } // NEW
            if (graph.refresh) (snapContext.moveCells || []).forEach(function (cell) { graph.refresh(cell); }); // CHANGE
            return res; // NEW
        }; // NEW
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
        if (!geo) return null; // CHANGE: offset-shifted slots outside the content area are omitted.

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
                        if (v) slotMap.set(key, v); // CHANGE: omitted outside slots do not occupy the slot map.
                    }
                }
            }

            // ---- Remove removed rows/cols (auto tiles) + remove dirty tiles that are now OOB ---- 
            const kids = graph.getChildVertices(groupCell) || [];
            const toRemove = [];

            for (const k of kids) {
                if (!isPlantCircle(k)) continue;

                // (A) Remove dirty/manual circles that are outside the planting content area.
                if (!(isAutoTile(k) && !isDirty(k)) && !isPointInPlantingContentArea(groupCell, childCenterInUnrotatedGroupSpace(groupCell, k), bandPx)) { // CHANGE
                    toRemove.push(k);
                    continue;
                }

                // (B) Existing rule: remove AUTO tiles that are outside new grid slots     
                if (!isAutoTile(k)) continue;

                const r = Number(k.getAttribute("tile_r"));
                const c = Number(k.getAttribute("tile_c"));
                if (!Number.isFinite(r) || !Number.isFinite(c)) continue;

                const key = `${r},${c}`;
                const center = shiftedSlotCenterLocal(groupCell, r, c, spacingXpx, spacingYpx, bandPx);
                if (r >= next.rows || c >= next.cols || !isPointInPlantingContentArea(groupCell, center, bandPx)) toRemove.push(k); // CHANGE: auto tiles outside the content area are omitted.
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
        const fromStats = capacityCount && typeof capacityCount === "object";
        const rawCapacity = fromStats ? Number(capacityCount.capacity || 0) : Number(capacityCount || 0);
        const capacity = Number.isFinite(rawCapacity) ? Math.max(0, rawCapacity) : 0;
        const disabledN = fromStats ? Number(capacityCount.disabled || 0) : (disabledSet ? disabledSet.size : 0);
        const rawActual = fromStats ? Number(capacityCount.actual || 0) : Math.max(0, capacity - disabledN);
        const actual = Number.isFinite(rawActual) ? Math.max(0, rawActual) : 0;
        setCellAttrsNoTxn(model, groupCell, {
            [ATTR_PLANT_COUNT_CAP]: String(capacity),
            [ATTR_PLANT_COUNT_ACT]: String(actual),
            [ATTR_PLANT_COUNT]: String(actual),
        });
        return { capacity, actual, disabledN }; // CHANGE: capacity is now in-bounds before disabled slots.
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
            const footprint = readPlantingFootprint(child); // CHANGE: fitted headers can put the outer group center beyond a shallow bed.
            const center = footprint ? { x: footprint.x + footprint.width / 2, y: footprint.y + footprint.height / 2 } : rectCenterModel(getModelRect(child)); // CHANGE
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
                const resizeIntent = activeBedFitResizeIntents && activeBedFitResizeIntents.get(item.tg.id); // CHANGE: an old bed snapshot cannot restore an axis released in this batch.
                const fitResult = applyBedFitGeometry(item.tg, item.bed, false, {
                    txnId,
                    source,
                    usePersistedFitAxes: true,
                    forceFitWidth: !!(item.axes && item.axes.fitWidth) && !(resizeIntent && resizeIntent.releaseWidth), // CHANGE
                    forceFitHeight: !!(item.axes && item.axes.fitHeight) && !(resizeIntent && resizeIntent.releaseHeight) // CHANGE
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

        const resizeAndRetile = function (cells, bounds, recurse) { // CHANGE: orchestration below scopes gesture intent around the complete existing pipeline.
            const model = graph.getModel();
            const duringResize = !!graph.isMouseDown;

            // Collect affected planting groups and snapshot BEFORE resize
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

            // Clamp planting group bounds to minimum 1×1 capacity
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
                    const disabledSet = readDisabledSet(g);
                    const slotStats = classifyPlantingSlots(g, snap.spacingXpx, snap.spacingYpx, nextBandPx, disabledSet);
                    const { actual } = applyCounts(model, g, slotStats, disabledSet); // CHANGE: resize counts only in-bounds offset slots.
                    updateGroupYield(model, g, {
                        abbr: g.getAttribute("plant_abbr") || "?",
                        countOverride: actual
                    });

                    const abbr = g.getAttribute("plant_abbr") || "?";

                    // LOD thresholds
                    if (slotStats.actual > MAX_TILES || slotStats.actual > LOD_TILE_THRESHOLD) {
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

                if (!isBedPathSnapAltBypassActive() && canConsiderBedPathSnapForCells(cells, null, false, null)) { // NEW
                    const snapEval = applyBedPathSnapNoTxn(model, cells[0], { source: "bed-resized" }); // NEW
                    if (snapEval && snapEval.applied) groupsNeedingRefresh.push(cells[0]); // NEW
                } // NEW

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

        graph.resizeCells = function (cells, bounds, recurse) { // CHANGE
            const previousIntents = activeBedFitResizeIntents; // CHANGE
            if (graph.isMouseDown && !bedFitResizeGestureIntents) bedFitResizeGestureIntents = new Map(); // CHANGE
            const captured = bedFitInProgress ? new Map() : captureBedFitResizeIntents(cells, null, bedFitResizeGestureIntents); // CHANGE
            activeBedFitResizeIntents = new Map(); // CHANGE: a selected parent is not a directly resized group when only its child changes.
            for (const cell of (cells || [])) { // CHANGE
                if (cell && captured.has(cell.id)) activeBedFitResizeIntents.set(cell.id, captured.get(cell.id)); // CHANGE
            } // CHANGE
            try { // CHANGE
                return resizeAndRetile.call(this, cells, bounds, recurse); // CHANGE
            } finally { // CHANGE
                activeBedFitResizeIntents = previousIntents; // CHANGE
                if (!graph.isMouseDown) bedFitResizeGestureIntents = null; // CHANGE: numeric edits and completed drags start fresh next time.
            } // CHANGE
        }; // CHANGE
    })();



    const GRAPH_OVERLAY_LAYER_CLASS = Object.freeze({ annotation: 'trellis-graph-annotation-layer', connection: 'trellis-graph-connection-layer', control: 'trellis-graph-control-layer', controlTop: 'trellis-graph-control-top-layer' }); // CHANGE: migrated planting overlay.

    const GRAPH_OVERLAY_LAYER_Z = Object.freeze({ annotation: GRAPH_OVERLAY_Z.ANNOTATION, connection: GRAPH_OVERLAY_Z.CONNECTION, control: GRAPH_OVERLAY_Z.CONTROL, controlTop: GRAPH_OVERLAY_Z.CONTROL_TOP }); // CHANGE: migrated planting overlay.

    function ensureGraphOverlayContainer() { // CHANGE: migrated planting overlay.
        const host = graph.container; // CHANGE: migrated planting overlay.
        if (!host) return null; // CHANGE: migrated planting overlay.
        try { // CHANGE: migrated planting overlay.
            if (window.getComputedStyle && window.getComputedStyle(host).position === 'static') host.style.position = 'relative'; // CHANGE: migrated planting overlay.
        } catch (_) { } // CHANGE: migrated planting overlay.
        return host; // CHANGE: migrated planting overlay.
    } // CHANGE: migrated planting overlay.

    function ensureGraphOverlayHtmlLayer(layerKey) { // CHANGE: migrated planting overlay.
        const host = ensureGraphOverlayContainer(); // CHANGE: migrated planting overlay.
        const key = GRAPH_OVERLAY_LAYER_CLASS[layerKey] ? layerKey : 'control'; // CHANGE: migrated planting overlay.
        const className = GRAPH_OVERLAY_LAYER_CLASS[key]; // CHANGE: migrated planting overlay.
        if (!host || !className) return null; // CHANGE: migrated planting overlay.
        let layer = host.querySelector('.' + className); // CHANGE: migrated planting overlay.
        if (!layer) { // CHANGE: migrated planting overlay.
            layer = document.createElement('div'); // CHANGE: migrated planting overlay.
            layer.className = className; // CHANGE: migrated planting overlay.
            layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:' + GRAPH_OVERLAY_LAYER_Z[key] + ';'; // CHANGE: migrated planting overlay.
            host.appendChild(layer); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.
        return layer; // CHANGE: migrated planting overlay.
    } // CHANGE: migrated planting overlay.

    function ensureGraphOverlaySvgLayer(layerKey) { // CHANGE: migrated planting overlay.
        const layer = ensureGraphOverlayHtmlLayer(layerKey || 'connection'); // CHANGE: migrated planting overlay.
        if (!layer) return null; // CHANGE: migrated planting overlay.
        layer.style.width = '100%'; // CHANGE: migrated planting overlay.
        layer.style.height = '100%'; // CHANGE: migrated planting overlay.
        let svg = layer.querySelector('svg.trellis-graph-connection-svg'); // CHANGE: migrated planting overlay.
        if (!svg) { // CHANGE: migrated planting overlay.
            svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('class', 'trellis-graph-connection-svg'); // CHANGE: migrated planting overlay.
            svg.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:auto;'; // CHANGE: migrated planting overlay.
            layer.appendChild(svg); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.
        return svg; // CHANGE: migrated planting overlay.
    } // CHANGE: migrated planting overlay.

    /** Draw transient planting copies. Inputs use current-view model coordinates; circles are already rotated. */ // CHANGE
    function createPlantingPreviewRenderer() { // CHANGE
        const owners = new Map(); // CHANGE: cleanup belongs to one graph and one workflow.

        function modelRectToViewRect(rect) { // CHANGE
            const view = graph.getView(); // CHANGE
            const scale = Number(view.scale) || 1, translate = view.translate || { x: 0, y: 0 }; // CHANGE
            return { x: (Number(rect.x) + translate.x) * scale, y: (Number(rect.y) + translate.y) * scale, width: rect.width * scale, height: rect.height * scale, scale }; // CHANGE
        } // CHANGE

        function appendFrame(host, row, bedFrame = false) { // CHANGE
            const rect = modelRectToViewRect(row.rect); // CHANGE
            const color = bedFrame ? '#15803d' : row.tone === 'warning' ? '#d97706' : '#2563eb'; // CHANGE
            const frame = document.createElement('div'); // CHANGE
            frame.className = bedFrame ? 'manual-link-spacing-preview-bed-frame' : 'manual-link-spacing-preview-group-frame'; // CHANGE: preserve existing CSS hooks.
            frame.dataset.spacingPreviewCell = row.cellId || ''; // CHANGE
            Object.assign(frame.style, { // CHANGE
                position: 'absolute', // CHANGE
                left: Math.round(rect.x) + 'px', // CHANGE
                top: Math.round(rect.y) + 'px', // CHANGE
                width: Math.round(rect.width) + 'px', // CHANGE
                height: Math.round(rect.height) + 'px', // CHANGE
                boxSizing: 'border-box', // CHANGE
                border: '2px ' + (bedFrame ? 'solid ' : 'dashed ') + color, // CHANGE
                background: bedFrame ? 'rgba(22,163,74,0.035)' : 'rgba(37,99,235,0.04)', // CHANGE
                boxShadow: '0 0 0 3px rgba(37,99,235,0.16)', // CHANGE
                color: '#111827', // CHANGE
                fontFamily: 'Arial, sans-serif', // CHANGE
                fontWeight: '700', // CHANGE
                fontSize: Math.max(8, Math.round(Number(row.groupLabelFontPx || 12) * rect.scale)) + 'px', // CHANGE
                lineHeight: '1.2', // CHANGE
                textAlign: 'center', // CHANGE
                overflow: 'hidden', // CHANGE
                transformOrigin: '50% 50%', // CHANGE
                transform: row.rotationDeg ? 'rotate(' + row.rotationDeg + 'deg)' : '', // CHANGE
                pointerEvents: 'none', // CHANGE
            }); // CHANGE
            if (!bedFrame) { // CHANGE
                const label = document.createElement('div'); // CHANGE
                label.textContent = row.label || row.abbr || ''; // CHANGE
                Object.assign(label.style, { padding: Math.max(1, Math.round(2 * rect.scale)) + 'px ' + Math.max(2, Math.round(4 * rect.scale)) + 'px', background: 'rgba(255,255,255,0.88)', borderBottom: '1px solid ' + color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }); // CHANGE
                frame.appendChild(label); // CHANGE
                if (row.summaryText) { // CHANGE
                    const summary = document.createElement('div'); // CHANGE
                    summary.className = 'planting-preview-summary'; summary.textContent = row.summaryText; // CHANGE
                    Object.assign(summary.style, { position: 'absolute', left: '0', top: '50%', width: '100%', transform: 'translateY(-50%)' }); // CHANGE
                    frame.appendChild(summary); // CHANGE
                } // CHANGE
            } // CHANGE
            host.appendChild(frame); // CHANGE
        } // CHANGE

        function appendCircle(host, dot, tone) { // CHANGE
            const rect = modelRectToViewRect({ x: dot.x, y: dot.y, width: 0, height: 0 }); // CHANGE
            const radius = Math.max(2, Number(dot.r || 2.5) * rect.scale); // CHANGE
            const circle = document.createElement('div'); // CHANGE
            circle.className = 'manual-link-spacing-preview-plant'; // CHANGE
            Object.assign(circle.style, { // CHANGE
                position: 'absolute', // CHANGE
                left: Math.round(rect.x - radius) + 'px', // CHANGE
                top: Math.round(rect.y - radius) + 'px', // CHANGE
                width: Math.round(radius * 2) + 'px', // CHANGE
                height: Math.round(radius * 2) + 'px', // CHANGE
                borderRadius: '50%', // CHANGE
                boxSizing: 'border-box', // CHANGE
                border: '2px solid ' + (tone === 'warning' ? '#d97706' : '#2563eb'), // CHANGE
                background: 'rgba(255,255,255,0.72)', // CHANGE
                boxShadow: '0 0 0 2px rgba(37,99,235,0.14)', // CHANGE
                color: '#1d4ed8', // CHANGE
                display: 'flex', // CHANGE
                alignItems: 'center', // CHANGE
                justifyContent: 'center', // CHANGE
                fontFamily: 'Arial, sans-serif', // CHANGE
                fontWeight: '700', // CHANGE
                fontSize: Math.max(6, Math.round(Number(dot.fontPx || 10) * rect.scale)) + 'px', // CHANGE
                lineHeight: '1', // CHANGE
                pointerEvents: 'none', // CHANGE
            }); // CHANGE
            circle.textContent = dot.label || ''; // CHANGE
            host.appendChild(circle); // CHANGE
        } // CHANGE

        /** Removes only this owner's DOM. Saved-shape visibility remains the editor's responsibility. */ // CHANGE
        function clear(ownerId) { // CHANGE
            const entry = owners.get(ownerId); // CHANGE
            if (entry && entry.node && entry.node.parentNode) entry.node.parentNode.removeChild(entry.node); // CHANGE: suspended owners retain input without a DOM node.
            owners.delete(ownerId); // CHANGE
        } // CHANGE

        /** An optional resolveInput callback produces current-view model coordinates on every draw or refresh. */ // CHANGE
        function draw(ownerId, input) { // CHANGE
            clear(ownerId); // CHANGE
            if (!input) return null; // CHANGE: ordinary clear-by-null calls do not retain an owner.
            const resolved = input && typeof input.resolveInput === 'function' ? input.resolveInput() : input; // CHANGE: resolve display coordinates afresh without modifying the retained canonical input.
            if (typeof input.resolveInput === 'function') owners.set(ownerId, { node: null, input }); // CHANGE: only dynamic owners retain suspended redraw registration.
            const layer = ensureGraphOverlayHtmlLayer('annotation'); // CHANGE
            if (!layer || !resolved || !Array.isArray(resolved.rows) || !resolved.rows.length) return null; // CHANGE
            const host = document.createElement('div'); // CHANGE
            host.className = resolved.className || 'planting-group-preview'; // CHANGE
            host.dataset.plantingPreviewOwner = ownerId; // CHANGE
            host.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;'; // CHANGE
            if (resolved.bedPreview) appendFrame(host, resolved.bedPreview, true); // CHANGE
            for (const row of resolved.rows) { // CHANGE
                appendFrame(host, row); // CHANGE
                if (!row.summaryText) (row.circles || []).forEach(dot => appendCircle(host, dot, row.tone)); // CHANGE
            } // CHANGE
            layer.appendChild(host); owners.set(ownerId, { node: host, input }); // CHANGE
            return host; // CHANGE
        } // CHANGE

        /** Own redraws independently of overlay panels so a view refresh cannot clear another workflow. */ // CHANGE
        function refresh() { // CHANGE
            for (const [ownerId, entry] of Array.from(owners)) draw(ownerId, entry.input); // CHANGE
        } // CHANGE

        return { render: draw, clear, refresh }; // CHANGE
    } // CHANGE

    const plantingPreview = createPlantingPreviewRenderer(); // CHANGE

    const taskScheduleOverlay = (function () { // CHANGE: planting-group owner of Cards, Schedule and Spacing.
        const LINK_ATTR = 'linkedTo'; // CHANGE: migrated planting overlay.

        const DEBUG_VERTEX_LINKING_CONSOLE = false; // CHANGE: migrated planting overlay.

        function applyPlantingOverlayButtonStyle(button, variant, options) { // CHANGE: migrated planting overlay.
            if (window.Trellis && window.Trellis.ui && typeof window.Trellis.ui.applyButtonStyle === 'function') { // CHANGE: migrated planting overlay.
                window.Trellis.ui.applyButtonStyle(button, variant, options); // CHANGE: migrated planting overlay.
            } else if (button) { // CHANGE: migrated planting overlay.
                const normalized = variant || 'neutral'; // CHANGE
                const activeOpen = normalized === 'open' && options && options.active === true; // NEW
                const style = { open: ['#2563eb', activeOpen ? '#1e3a8a' : '#1d4ed8', activeOpen ? '#eff6ff' : '#fff'], add: ['#188038', '#166534', '#fff'], close: ['#b91c1c', '#b91c1c', '#fff'], danger: ['#b91c1c', '#fff', '#b91c1c'], neutral: ['#6b7280', '#111827', '#fff'] }[normalized] || ['#6b7280', '#111827', '#fff']; // NEW
                button.setAttribute('data-trellis-button-variant', normalized); // CHANGE
                button.style.border = '1px solid ' + style[0]; // NEW
                button.style.color = style[1]; // NEW
                button.style.background = style[2]; // NEW
                if (activeOpen) button.style.fontWeight = '700'; // NEW
            } // CHANGE: migrated planting overlay.
            return button; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function vertexLinkLog() { // CHANGE: migrated planting overlay.
            if (!DEBUG_VERTEX_LINKING_CONSOLE) return; // CHANGE: migrated planting overlay.
            try { console.log.apply(console, arguments); } catch (_) { } // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function ensureValueIsElementUndoable(cell) { // CHANGE: migrated planting overlay.
            if (!cell) return null; // CHANGE: migrated planting overlay.
            const v = cell.value; // CHANGE: migrated planting overlay.
            if (v && typeof v !== 'string' && v.getAttribute) return v; // CHANGE: migrated planting overlay.

            const doc = mxUtils.createXmlDocument(); // CHANGE: migrated planting overlay.
            const obj = doc.createElement('object'); // CHANGE: migrated planting overlay.
            if (typeof v === 'string') obj.setAttribute('label', v); // CHANGE: migrated planting overlay.
            else obj.setAttribute('label', ''); // CHANGE: migrated planting overlay.

            // Make this change undoable                                                   
            model.setValue(cell, obj); // CHANGE: migrated planting overlay.
            return cell.value; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function setCellAttrUndoable(cell, attr, value) { // CHANGE: migrated planting overlay.
            ensureValueIsElementUndoable(cell); // CHANGE: migrated planting overlay.
            const change = new mxCellAttributeChange(cell, attr, value); // CHANGE: migrated planting overlay.
            model.execute(change); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function getAttr(cell, key) { // CHANGE: migrated planting overlay.
            const v = cell && cell.value; // CHANGE: migrated planting overlay.
            return (v && v.getAttribute) ? v.getAttribute(key) : null; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function isKanbanCard(cell) { // CHANGE: migrated planting overlay.
            return !!cell && getAttr(cell, 'kanban_card') === '1'; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function isKanbanBoard(cell) { // CHANGE: migrated planting overlay.
            return !!cell && (getAttr(cell, 'board_key') === 'KANBAN_BOARD'); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function findKanbanBoardAncestor(cell) { // CHANGE: migrated planting overlay.
            const m = graph.getModel(); // CHANGE: migrated planting overlay.
            let cur = cell; // CHANGE: migrated planting overlay.
            while (cur) { // CHANGE: migrated planting overlay.
                if (isKanbanBoard(cur)) return cur; // CHANGE: migrated planting overlay.
                cur = m.getParent(cur); // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.
            return null; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function isGardenModuleCell(cell) { // CHANGE: migrated planting overlay.
            return !!cell && getAttr(cell, 'garden_module') === '1'; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function isGardenDashboardCell(cell) { // CHANGE: migrated planting overlay.
            return !!cell && getAttr(cell, 'garden_dashboard') === '1'; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function findGardenModuleAncestor(cell) { // CHANGE: migrated planting overlay.
            let cur = cell; // CHANGE: migrated planting overlay.
            while (cur) { // CHANGE: migrated planting overlay.
                if (isGardenModuleCell(cur)) return cur; // CHANGE: migrated planting overlay.
                cur = model.getParent(cur); // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.
            return null; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function findDashboardCellInModule(moduleCell) { // CHANGE: migrated planting overlay.
            if (!moduleCell) return null; // CHANGE: migrated planting overlay.
            const stack = [moduleCell]; // CHANGE: migrated planting overlay.
            while (stack.length) { // CHANGE: migrated planting overlay.
                const cur = stack.pop(); // CHANGE: migrated planting overlay.
                const count = model.getChildCount(cur); // CHANGE: migrated planting overlay.
                for (let i = 0; i < count; i++) { // CHANGE: migrated planting overlay.
                    const child = model.getChildAt(cur, i); // CHANGE: migrated planting overlay.
                    if (!child) continue; // CHANGE: migrated planting overlay.
                    if (isGardenDashboardCell(child)) return child; // CHANGE: migrated planting overlay.
                    stack.push(child); // CHANGE: migrated planting overlay.
                } // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.
            return null; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function getDashboardYearForCell(cell) { // CHANGE: migrated planting overlay.
            const moduleCell = findGardenModuleAncestor(cell); // CHANGE: migrated planting overlay.
            const dashboard = findDashboardCellInModule(moduleCell); // CHANGE: migrated planting overlay.
            const year = Number(getAttr(dashboard, 'dashboard_year')); // CHANGE: migrated planting overlay.
            return Number.isFinite(year) && year > 1900 && year < 3000 ? year : new Date().getFullYear(); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function compareTaskCardsByStartDate(a, b) { // CHANGE: migrated planting overlay.
            const aRange = getTaskDateRange(a); // CHANGE: migrated planting overlay.
            const bRange = getTaskDateRange(b); // CHANGE: migrated planting overlay.
            const aHasDate = !!aRange; // CHANGE: migrated planting overlay.
            const bHasDate = !!bRange; // CHANGE: migrated planting overlay.

            if (aHasDate !== bHasDate) return aHasDate ? -1 : 1; // CHANGE: migrated planting overlay.
            if (aHasDate && bHasDate && aRange.startDay !== bRange.startDay) return aRange.startDay - bRange.startDay; // CHANGE: migrated planting overlay.

            const aLabel = (getRawTextLabel(a) || getAttr(a, 'title') || a.id || '').toLowerCase(); // CHANGE: migrated planting overlay.
            const bLabel = (getRawTextLabel(b) || getAttr(b, 'title') || b.id || '').toLowerCase(); // CHANGE: migrated planting overlay.
            if (aLabel < bLabel) return -1; // CHANGE: migrated planting overlay.
            if (aLabel > bLabel) return 1; // CHANGE: migrated planting overlay.

            return String(a.id || '').localeCompare(String(b.id || '')); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function parseTaskOverlayDate(raw) { // CHANGE: migrated planting overlay.
            if (!raw) return null; // CHANGE: migrated planting overlay.
            const match = String(raw).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); // CHANGE: migrated planting overlay.
            if (!match) return null; // CHANGE: migrated planting overlay.
            const year = Number(match[1]); // CHANGE: migrated planting overlay.
            const month = Number(match[2]); // CHANGE: migrated planting overlay.
            const day = Number(match[3]); // CHANGE: migrated planting overlay.
            if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null; // CHANGE: migrated planting overlay.
            const utc = Date.UTC(year, month - 1, day); // CHANGE: migrated planting overlay.
            const date = new Date(utc); // CHANGE: migrated planting overlay.
            if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null; // CHANGE: migrated planting overlay.
            return { // CHANGE: migrated planting overlay.
                iso: match[0], // CHANGE: migrated planting overlay.
                date, // CHANGE: migrated planting overlay.
                dayNumber: Math.floor(utc / 86400000) // CHANGE: migrated planting overlay.
            }; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function getTaskDateRange(card) { // CHANGE: migrated planting overlay.
            const start = parseTaskOverlayDate(getAttr(card, 'start')); // CHANGE: migrated planting overlay.
            if (!start) return null; // CHANGE: migrated planting overlay.
            const rawEnd = getAttr(card, 'end'); // CHANGE: migrated planting overlay.
            const end = rawEnd ? parseTaskOverlayDate(rawEnd) : start; // CHANGE: migrated planting overlay.
            if (!end || end.dayNumber < start.dayNumber) return null; // CHANGE: migrated planting overlay.
            return { // CHANGE: migrated planting overlay.
                start, // CHANGE: migrated planting overlay.
                end, // CHANGE: migrated planting overlay.
                startDay: start.dayNumber, // CHANGE: migrated planting overlay.
                endDay: end.dayNumber, // CHANGE: migrated planting overlay.
                durationDays: end.dayNumber - start.dayNumber + 1 // CHANGE: migrated planting overlay.
            }; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function taskDateRangeOverlapsYear(card, year) { // CHANGE: migrated planting overlay.
            const range = getTaskDateRange(card); // CHANGE: migrated planting overlay.
            const selectedYear = Number(year); // CHANGE: migrated planting overlay.
            if (!range || !Number.isFinite(selectedYear)) return false; // CHANGE: migrated planting overlay.
            const startDay = Math.floor(Date.UTC(selectedYear, 0, 1) / 86400000); // CHANGE: migrated planting overlay.
            const endDay = Math.floor(Date.UTC(selectedYear, 11, 31) / 86400000); // CHANGE: migrated planting overlay.
            return range.startDay <= endDay && range.endDay >= startDay; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function getTaskOverlayYears(cards) { // CHANGE: migrated planting overlay.
            const years = new Set(); // CHANGE: migrated planting overlay.
            for (const card of cards || []) { // CHANGE: migrated planting overlay.
                const range = getTaskDateRange(card); // CHANGE: migrated planting overlay.
                if (!range) continue; // CHANGE: migrated planting overlay.
                for (let year = range.start.date.getUTCFullYear(); year <= range.end.date.getUTCFullYear(); year++) { // CHANGE: migrated planting overlay.
                    if (year > 1900 && year < 3000) years.add(year); // CHANGE: migrated planting overlay.
                } // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.
            return Array.from(years).sort((a, b) => a - b); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function chooseDefaultOverlayYear(years) { // CHANGE: migrated planting overlay.
            const list = Array.isArray(years) ? years : []; // CHANGE: migrated planting overlay.
            if (!list.length) return null; // CHANGE: migrated planting overlay.
            const currentYear = new Date().getFullYear(); // CHANGE: migrated planting overlay.
            return list.indexOf(currentYear) >= 0 ? currentYear : list[0]; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function formatTaskOverlayDate(dateInfo) { // CHANGE: migrated planting overlay.
            if (!dateInfo || !dateInfo.date) return ''; // CHANGE: migrated planting overlay.
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; // CHANGE: migrated planting overlay.
            return months[dateInfo.date.getUTCMonth()] + ' ' + String(dateInfo.date.getUTCDate()).padStart(2, '0'); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function formatTaskDateRange(card) { // CHANGE: migrated planting overlay.
            const range = getTaskDateRange(card); // CHANGE: migrated planting overlay.
            if (!range) return 'Unscheduled'; // CHANGE: migrated planting overlay.
            const startLabel = formatTaskOverlayDate(range.start); // CHANGE: migrated planting overlay.
            const endLabel = formatTaskOverlayDate(range.end); // CHANGE: migrated planting overlay.
            return range.startDay === range.endDay ? startLabel : (startLabel + ' - ' + endLabel); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function stripTaskBadgeText(raw) { // CHANGE: migrated planting overlay.
            const text = stripHtmlAndPlaceholders(String(raw || '')); // CHANGE: migrated planting overlay.
            return text.length > 36 ? text.slice(0, 33) + '...' : text; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function getTaskLaneColor(card) { // CHANGE: migrated planting overlay.
            return getLaneColorForCard(card) || '#9aa0a6'; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function getTaskOverlayBadges(card) { // CHANGE: migrated planting overlay.
            const badges = []; // CHANGE: migrated planting overlay.
            const rawBadges = stripTaskBadgeText(getAttr(card, 'badges_html')); // CHANGE: migrated planting overlay.
            if (rawBadges) badges.push(rawBadges); // CHANGE: migrated planting overlay.
            const repeatBadge = getAttr(card, 'repeat_badge'); // CHANGE: migrated planting overlay.
            if (repeatBadge) badges.push('Repeat ' + repeatBadge); // CHANGE: migrated planting overlay.
            const note = stripTaskBadgeText(getAttr(card, 'card_note')); // CHANGE: migrated planting overlay.
            if (note) badges.push('Note ' + note); // CHANGE: migrated planting overlay.
            if (getAttr(card, 'date_override') === '1') badges.push('Dates edited'); // CHANGE: migrated planting overlay.
            const linkCount = getLinkSet(card).size; // CHANGE: migrated planting overlay.
            if (linkCount > 1) badges.push('Links ' + linkCount); // CHANGE: migrated planting overlay.
            return badges; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function normalizeRepeatIdentityText(value) { // CHANGE: migrated planting overlay.
            return String(value == null ? '' : value).trim().toLowerCase(); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function normalizeRepeatLinkedIds(value) { // CHANGE: migrated planting overlay.
            return Array.from(new Set(String(value == null ? '' : value) // CHANGE: migrated planting overlay.
                .split(',') // CHANGE: migrated planting overlay.
                .map(id => id.trim()) // CHANGE: migrated planting overlay.
                .filter(Boolean))) // CHANGE: migrated planting overlay.
                .sort(); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function buildRepeatSeriesKeyForOverlay(card) { // CHANGE: migrated planting overlay.
            const linkedIds = normalizeRepeatLinkedIds(getAttr(card, LINK_ATTR)); // CHANGE: migrated planting overlay.
            if (linkedIds.length === 0) return null; // CHANGE: migrated planting overlay.

            return JSON.stringify([ // CHANGE: migrated planting overlay.
                linkedIds, // CHANGE: migrated planting overlay.
                normalizeRepeatIdentityText(getAttr(card, 'plant_name')), // CHANGE: migrated planting overlay.
                normalizeRepeatIdentityText(getAttr(card, 'method')), // CHANGE: migrated planting overlay.
                normalizeRepeatIdentityText(getAttr(card, 'title')) // CHANGE: migrated planting overlay.
            ]); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function compareRepeatOccurrenceCards(a, b) { // CHANGE: migrated planting overlay.
            const aRange = getTaskDateRange(a); // CHANGE: migrated planting overlay.
            const bRange = getTaskDateRange(b); // CHANGE: migrated planting overlay.
            if (aRange && bRange && aRange.startDay !== bRange.startDay) return aRange.startDay - bRange.startDay; // CHANGE: migrated planting overlay.
            if (aRange && !bRange) return -1; // CHANGE: migrated planting overlay.
            if (!aRange && bRange) return 1; // CHANGE: migrated planting overlay.
            if (aRange && bRange && aRange.endDay !== bRange.endDay) return aRange.endDay - bRange.endDay; // CHANGE: migrated planting overlay.
            return String(a && a.id || '').localeCompare(String(b && b.id || '')); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function isOverlayCardVisibilityEligible(card) { // CHANGE: migrated planting overlay.
            return getAttr(card, 'year_hidden') !== '1' && getAttr(card, 'repeat_hidden') !== '1'; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function getLaneOrderIndex(lane) { // CHANGE: migrated planting overlay.
            if (!lane) return Number.POSITIVE_INFINITY; // CHANGE: migrated planting overlay.
            const parent = model.getParent(lane); // CHANGE: migrated planting overlay.
            if (!parent) return Number.POSITIVE_INFINITY; // CHANGE: migrated planting overlay.
            const count = model.getChildCount(parent); // CHANGE: migrated planting overlay.
            for (let i = 0; i < count; i++) { // CHANGE: migrated planting overlay.
                if (model.getChildAt(parent, i) === lane) return i; // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.
            return Number.POSITIVE_INFINITY; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function cleanOverlayLaneLabel(label) { // CHANGE: migrated planting overlay.
            return stripHtmlAndPlaceholders(String(label || '')).replace(/\s*\(Page\s+\d+\s*\/\s*\d+\)\s*$/i, '').trim(); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function getLaneGroupLabel(card, lane, laneKey) { // CHANGE: migrated planting overlay.
            if (lane) { // CHANGE: migrated planting overlay.
                const explicit = getAttr(lane, 'label') || getAttr(lane, 'status'); // CHANGE: migrated planting overlay.
                if (explicit) return cleanOverlayLaneLabel(explicit); // CHANGE: migrated planting overlay.
                if (typeof lane.value === 'string' && lane.value) return cleanOverlayLaneLabel(lane.value); // CHANGE: migrated planting overlay.
                if (lane.value && lane.value.textContent) return cleanOverlayLaneLabel(lane.value.textContent); // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.
            return laneKey || getAttr(card, 'status') || 'Unlaned'; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function makeLaneGroupForCard(card) { // CHANGE: migrated planting overlay.
            const lane = findLaneAncestor(card); // CHANGE: migrated planting overlay.
            const laneKey = getLaneStatusKeyForTask(card) || (lane ? getAttr(lane, 'lane_key') : null) || 'UNLANED'; // CHANGE: migrated planting overlay.
            return { // CHANGE: migrated planting overlay.
                lane, // CHANGE: migrated planting overlay.
                laneId: lane && lane.id ? lane.id : laneKey, // CHANGE: migrated planting overlay.
                laneKey, // CHANGE: migrated planting overlay.
                label: getLaneGroupLabel(card, lane, laneKey), // CHANGE: migrated planting overlay.
                color: getTaskLaneColor(card), // CHANGE: migrated planting overlay.
                order: getLaneOrderIndex(lane), // CHANGE: migrated planting overlay.
                items: [] // CHANGE: migrated planting overlay.
            }; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function withRepeatOverlayBadge(item, badgeText) { // CHANGE: migrated planting overlay.
            item.repeatBadge = badgeText || ''; // CHANGE: migrated planting overlay.
            return item; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function groupLinkedTasksForOverlay(cards) { // CHANGE: migrated planting overlay.
            const groupsByLane = new Map(); // CHANGE: migrated planting overlay.

            function getGroup(card) { // CHANGE: migrated planting overlay.
                const lane = findLaneAncestor(card); // CHANGE: migrated planting overlay.
                const laneKey = getLaneStatusKeyForTask(card) || (lane ? getAttr(lane, 'lane_key') : null) || 'UNLANED'; // CHANGE: migrated planting overlay.
                const laneId = lane && lane.id ? lane.id : laneKey; // CHANGE: migrated planting overlay.
                if (!groupsByLane.has(laneId)) groupsByLane.set(laneId, makeLaneGroupForCard(card)); // CHANGE: migrated planting overlay.
                return groupsByLane.get(laneId); // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.

            const recordsByLaneAndSeries = new Map(); // CHANGE: migrated planting overlay.
            for (const card of cards || []) { // CHANGE: migrated planting overlay.
                if (!card || getAttr(card, 'year_hidden') === '1') continue; // CHANGE: migrated planting overlay.
                const group = getGroup(card); // CHANGE: migrated planting overlay.
                const seriesKey = buildRepeatSeriesKeyForOverlay(card); // CHANGE: migrated planting overlay.

                if (!seriesKey) { // CHANGE: migrated planting overlay.
                    if (isOverlayCardVisibilityEligible(card)) group.items.push({ card, repeatBadge: '' }); // CHANGE: migrated planting overlay.
                    continue; // CHANGE: migrated planting overlay.
                } // CHANGE: migrated planting overlay.

                const laneSeriesKey = group.laneId + '|' + seriesKey; // CHANGE: migrated planting overlay.
                if (!recordsByLaneAndSeries.has(laneSeriesKey)) { // CHANGE: migrated planting overlay.
                    recordsByLaneAndSeries.set(laneSeriesKey, { group, seriesKey, cards: [] }); // CHANGE: migrated planting overlay.
                } // CHANGE: migrated planting overlay.
                recordsByLaneAndSeries.get(laneSeriesKey).cards.push(card); // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.

            for (const series of recordsByLaneAndSeries.values()) { // CHANGE: migrated planting overlay.
                const ordered = series.cards.slice().sort(compareRepeatOccurrenceCards); // CHANGE: migrated planting overlay.
                const candidates = ordered.filter(isOverlayCardVisibilityEligible); // CHANGE: migrated planting overlay.
                if (!candidates.length) continue; // CHANGE: migrated planting overlay.
                const representative = candidates[0]; // CHANGE: migrated planting overlay.
                const globalIndex = ordered.indexOf(representative); // CHANGE: migrated planting overlay.
                const hiddenInLane = Math.max(0, ordered.length - 1); // CHANGE: migrated planting overlay.
                const badge = ordered.length > 1 // CHANGE: migrated planting overlay.
                    ? ((globalIndex + 1) + '/' + ordered.length + (hiddenInLane > 0 ? ' +' + hiddenInLane : '')) // CHANGE: migrated planting overlay.
                    : ''; // CHANGE: migrated planting overlay.
                series.group.items.push(withRepeatOverlayBadge({ card: representative }, badge)); // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.

            const groups = Array.from(groupsByLane.values()) // CHANGE: migrated planting overlay.
                .map(group => { // CHANGE: migrated planting overlay.
                    group.items.sort((a, b) => compareTaskCardsByStartDate(a.card, b.card)); // CHANGE: migrated planting overlay.
                    return group; // CHANGE: migrated planting overlay.
                }) // CHANGE: migrated planting overlay.
                .filter(group => group.items.length > 0) // CHANGE: migrated planting overlay.
                .sort((a, b) => (a.order - b.order) || String(a.label || '').localeCompare(String(b.label || ''))); // CHANGE: migrated planting overlay.

            return groups; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function findLaneAncestor(cell) { // CHANGE: migrated planting overlay.
            const m = graph.getModel(); // CHANGE: migrated planting overlay.
            let cur = cell ? m.getParent(cell) : null; // CHANGE: migrated planting overlay.
            while (cur) { // CHANGE: migrated planting overlay.
                if (getAttr(cur, 'lane_key')) return cur; // CHANGE: migrated planting overlay.
                cur = m.getParent(cur); // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.
            return null; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function getRawStyleValue(cell, key) { // CHANGE: migrated planting overlay.
            const s = (cell && cell.getStyle && cell.getStyle()) || ''; // CHANGE: migrated planting overlay.
            const m = s.match(new RegExp('(?:^|;)' + key + '=([^;]*)')); // CHANGE: migrated planting overlay.
            return m ? m[1] : null; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function isRealColor(c) { // CHANGE: migrated planting overlay.
            if (!c) return false; // CHANGE: migrated planting overlay.
            const v = String(c).trim().toLowerCase(); // CHANGE: migrated planting overlay.
            if (v === 'none' || v === 'default') return false; // CHANGE: migrated planting overlay.
            return true; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function getLaneColorForCard(card) { // CHANGE: migrated planting overlay.
            if (!isKanbanCard(card)) return null; // CHANGE: migrated planting overlay.
            const lane = findLaneAncestor(card); // CHANGE: migrated planting overlay.
            if (!lane) { // CHANGE: migrated planting overlay.
                vertexLinkLog('[ManualLinker] getLaneColorForCard: no lane for card', // CHANGE: migrated planting overlay.
                    card && card.id); // CHANGE: migrated planting overlay.
                return null; // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.

            const style = lane.getStyle ? lane.getStyle() : ''; // CHANGE: migrated planting overlay.
            const laneFill = getRawStyleValue(lane, 'swimlaneFillColor'); // CHANGE: migrated planting overlay.
            const laneFillColor = getRawStyleValue(lane, 'fillColor'); // CHANGE: migrated planting overlay.
            const laneStroke = getRawStyleValue(lane, 'strokeColor'); // CHANGE: migrated planting overlay.

            let picked = null; // CHANGE: migrated planting overlay.
            if (isRealColor(laneFill)) picked = laneFill; // CHANGE: migrated planting overlay.
            else if (isRealColor(laneFillColor)) picked = laneFillColor; // CHANGE: migrated planting overlay.
            else if (isRealColor(laneStroke)) picked = laneStroke; // CHANGE: migrated planting overlay.

            vertexLinkLog('[ManualLinker] getLaneColorForCard', { // CHANGE: migrated planting overlay.
                cardId: card && card.id, // CHANGE: migrated planting overlay.
                laneId: lane && lane.id, // CHANGE: migrated planting overlay.
                laneStyle: style, // CHANGE: migrated planting overlay.
                laneFill, // CHANGE: migrated planting overlay.
                laneFillColor, // CHANGE: migrated planting overlay.
                laneStroke, // CHANGE: migrated planting overlay.
                pickedColor: picked // CHANGE: migrated planting overlay.
            }); // CHANGE: migrated planting overlay.

            return picked; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        const STRIP_PLACEHOLDERS = true; // CHANGE: migrated planting overlay.

        function decodeBasicEntities(s) { // CHANGE: migrated planting overlay.
            // minimal decode for common entities used in labels
            return s // CHANGE: migrated planting overlay.
                .replace(/&nbsp;/g, ' ') // CHANGE: migrated planting overlay.
                .replace(/&amp;/g, '&') // CHANGE: migrated planting overlay.
                .replace(/&lt;/g, '<') // CHANGE: migrated planting overlay.
                .replace(/&gt;/g, '>'); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function stripHtmlAndPlaceholders(s) { // CHANGE: migrated planting overlay.
            // Remove HTML tags
            s = s.replace(/<[^>]*>/g, ''); // CHANGE: migrated planting overlay.
            // Decode common entities
            s = decodeBasicEntities(s); // CHANGE: migrated planting overlay.
            // Optionally remove %placeholder% tokens
            if (STRIP_PLACEHOLDERS) s = s.replace(/%[^%]+%/g, ''); // CHANGE: migrated planting overlay.
            // Normalize whitespace
            return s.replace(/\s+/g, ' ').trim(); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function getRawTextLabel(cell) { // CHANGE: migrated planting overlay.
            if (!cell) return ''; // CHANGE: migrated planting overlay.
            const v = cell.value; // CHANGE: migrated planting overlay.
            if (v == null) return ''; // CHANGE: migrated planting overlay.

            if (typeof v === 'string') { // CHANGE: migrated planting overlay.
                return stripHtmlAndPlaceholders(v); // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.

            // XML <object> case
            if (v.getAttribute) { // CHANGE: migrated planting overlay.
                // Prefer explicit 'label' attribute if present
                const lbl = v.getAttribute('label'); // CHANGE: migrated planting overlay.
                if (lbl != null && lbl !== '') return stripHtmlAndPlaceholders(lbl); // CHANGE: migrated planting overlay.
                // Fallback: textContent of the node subtree (plain text)
                let txt = ''; // CHANGE: migrated planting overlay.
                try { txt = v.textContent || ''; } catch (_) { } // CHANGE: migrated planting overlay.
                return stripHtmlAndPlaceholders(txt); // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.

            // Fallback
            return stripHtmlAndPlaceholders(String(v)); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function getCellCenter(cell) { // CHANGE: migrated planting overlay.
            if (!cell) return null; // CHANGE: migrated planting overlay.

            const view = graph.getView(); // CHANGE: migrated planting overlay.
            const m = graph.getModel(); // CHANGE: migrated planting overlay.

            // First try the cell itself                                               
            let st = view.getState(cell); // CHANGE: migrated planting overlay.
            if (st && m.isVisible(cell)) { // CHANGE: migrated planting overlay.
                return { // CHANGE: migrated planting overlay.
                    x: st.x + st.width / 2, // CHANGE: migrated planting overlay.
                    y: st.y + st.height / 2, // CHANGE: migrated planting overlay.
                    w: st.width, // CHANGE: migrated planting overlay.
                    h: st.height // CHANGE: migrated planting overlay.
                }; // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.

            // Fallback: if this is a Kanban task card that is currently hidden,       
            // anchor overlays to its parent lane instead of dropping the link.        
            if (isKanbanCard(cell)) { // CHANGE: migrated planting overlay.
                const lane = findLaneAncestor(cell); // CHANGE: migrated planting overlay.
                if (lane) { // CHANGE: migrated planting overlay.
                    const laneState = view.getState(lane); // CHANGE: migrated planting overlay.
                    if (laneState && m.isVisible(lane)) { // CHANGE: migrated planting overlay.
                        return { // CHANGE: migrated planting overlay.
                            x: laneState.x + laneState.width / 2, // CHANGE: migrated planting overlay.
                            y: laneState.y + laneState.height / 2, // CHANGE: migrated planting overlay.
                            w: laneState.width, // CHANGE: migrated planting overlay.
                            h: laneState.height // CHANGE: migrated planting overlay.
                        }; // CHANGE: migrated planting overlay.
                    } // CHANGE: migrated planting overlay.
                } // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.

            // No usable geometry                                                      
            return null; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function sideToward(srcCenter, dstCenter) { // CHANGE: migrated planting overlay.
            const dx = dstCenter.x - srcCenter.x; // CHANGE: migrated planting overlay.
            const dy = dstCenter.y - srcCenter.y; // CHANGE: migrated planting overlay.
            if (Math.abs(dx) >= Math.abs(dy)) { // CHANGE: migrated planting overlay.
                return dx >= 0 ? 'right' : 'left'; // CHANGE: migrated planting overlay.
            } else { // CHANGE: migrated planting overlay.
                return dy >= 0 ? 'bottom' : 'top'; // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function anchorOnSide(center, side, t) { // CHANGE: migrated planting overlay.
            // center: {x, y, w, h}, side: 'left'|'right'|'top'|'bottom', t in [0,1]           
            const c = center; // CHANGE: migrated planting overlay.
            const tt = Math.max(0, Math.min(1, t == null ? 0.5 : t)); // CHANGE: migrated planting overlay.
            if (!c) return null; // CHANGE: migrated planting overlay.
            if (side === 'left') { // CHANGE: migrated planting overlay.
                return { x: c.x - c.w / 2, y: c.y - c.h / 2 + tt * c.h }; // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.
            if (side === 'right') { // CHANGE: migrated planting overlay.
                return { x: c.x + c.w / 2, y: c.y - c.h / 2 + tt * c.h }; // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.
            if (side === 'top') { // CHANGE: migrated planting overlay.
                return { x: c.x - c.w / 2 + tt * c.w, y: c.y - c.h / 2 }; // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.
            if (side === 'bottom') { // CHANGE: migrated planting overlay.
                return { x: c.x - c.w / 2 + tt * c.w, y: c.y + c.h / 2 }; // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.
            // Fallback: center                                                                 
            return { x: c.x, y: c.y }; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function mapStatusToKey(raw) { // CHANGE: migrated planting overlay.
            if (!raw) return null; // CHANGE: migrated planting overlay.
            raw = String(raw).trim().toUpperCase(); // CHANGE: migrated planting overlay.

            if (raw.includes('UPCOMING')) { // CHANGE: migrated planting overlay.
                if (raw.includes('YEAR')) return 'UPCOMING_YEAR'; // CHANGE: migrated planting overlay.
                if (raw.includes('MONTH')) return 'UPCOMING_MONTH'; // CHANGE: migrated planting overlay.
                return 'UPCOMING_WEEK'; // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.

            if (raw.includes('STAGED')) return 'TODO_STAGED'; // CHANGE: migrated planting overlay.
            if (raw === 'TODO') return 'TODO'; // CHANGE: migrated planting overlay.
            if (raw === 'DOING') return 'DOING'; // CHANGE: migrated planting overlay.

            if (raw.includes('DONE')) { // CHANGE: migrated planting overlay.
                if (raw.includes('WEEK')) return 'DONE_WEEK'; // CHANGE: migrated planting overlay.
                if (raw.includes('MONTH')) return 'DONE_MONTH'; // CHANGE: migrated planting overlay.
                if (raw.includes('YEAR')) return 'DONE_YEAR'; // CHANGE: migrated planting overlay.
                return 'DONE'; // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.

            if (raw.includes('ARCHIVED')) return 'ARCHIVED'; // CHANGE: migrated planting overlay.

            return raw; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function getLaneStatusKeyForTask(card) { // CHANGE: migrated planting overlay.
            if (!card) return null; // CHANGE: migrated planting overlay.
            const lane = findLaneAncestor(card); // CHANGE: migrated planting overlay.
            let laneRaw = lane ? getAttr(lane, 'lane_key') : null; // CHANGE: migrated planting overlay.

            if (laneRaw) { // CHANGE: migrated planting overlay.
                const key = String(laneRaw).trim().toUpperCase(); // CHANGE: migrated planting overlay.
                vertexLinkLog('[LaneStatus] from lane_key', { cardId: card.id, laneId: lane && lane.id, laneRaw, key }); // CHANGE: migrated planting overlay.
                return key || null; // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.

            const statusRaw = getAttr(card, 'status'); // CHANGE: migrated planting overlay.
            const mapped = mapStatusToKey(statusRaw); // CHANGE: migrated planting overlay.
            vertexLinkLog('[LaneStatus] from status', { cardId: card.id, statusRaw, mapped }); // CHANGE: migrated planting overlay.
            return mapped; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function isTilerGroup(cell) { // CHANGE: migrated planting overlay.
            return !!cell && getAttr(cell, 'tiler_group') === '1'; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function dispatchYearFilterChangedForTaskOverlay(card, year) { // CHANGE: migrated planting overlay.
            try { // CHANGE: migrated planting overlay.
                window.dispatchEvent(new CustomEvent('yearFilterChanged', { // CHANGE: migrated planting overlay.
                    detail: { moduleCellId: null, taskCardId: card && card.id || null, year: year == null ? null : year } // CHANGE: migrated planting overlay.
                })); // CHANGE: migrated planting overlay.
            } catch (_) { } // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function getLinkSet(cell) { // CHANGE: migrated planting overlay.
            if (!cell) return new Set(); // CHANGE: migrated planting overlay.
            const val = cell.value; // CHANGE: migrated planting overlay.
            const raw = (val && val.getAttribute) ? val.getAttribute(LINK_ATTR) : null; // CHANGE: migrated planting overlay.
            if (!raw) return new Set(); // CHANGE: migrated planting overlay.
            return new Set(String(raw).split(',').map(s => s.trim()).filter(Boolean)); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.
        const MODE_CARDS = 'cards'; // CHANGE: migrated planting overlay.
        const MODE_SCHEDULE = 'schedule'; // CHANGE: migrated planting overlay.
        const MODE_SPACING = 'spacing'; // CHANGE: migrated planting overlay.
        const PANEL_MIN_WIDTH = 168; // CHANGE: compact schedule-only overlays should shrink to their controls.
        const PANEL_MAX_WIDTH = 520; // CHANGE: wider spacing/task views can grow without overrunning the canvas.
        const PANEL_FALLBACK_WIDTH = 380; // CHANGE: preserve the old width as a measurement fallback.
        const PANEL_GAP = 12; // CHANGE: migrated planting overlay.
        const PANEL_SIDE_OFFSET = 60; // CHANGE: migrated planting overlay.
        const BODY_MAX_HEIGHT = 360; // CHANGE: migrated planting overlay.
        const registry = new Map(); // sourceId -> entry
        const selectedYearBySource = new Map(); // sourceId -> session-only year
        const LANE_COLLAPSE_STORAGE_KEY = 'trellis.vertexLinker.taskOverlay.collapsedLanes.v1'; // CHANGE: migrated planting overlay.
        const laneCollapseState = new Map(); // laneKey -> collapsed boolean
        let laneCollapseLoaded = false; // CHANGE: migrated planting overlay.
        let activeMode = MODE_CARDS; // CHANGE: migrated planting overlay.

        function isTeamPermissionModeActiveForTaskScheduleOverlay() { // CHANGE: migrated planting overlay.
            const users = window.Trellis && window.Trellis.users; // NEW
            return !!(users && typeof users.isTeamPermissionModeActive === 'function' && users.isTeamPermissionModeActive()); // NEW
        } // CHANGE: migrated planting overlay.

        function getOverlayPane() { // CHANGE: migrated planting overlay.
            const layeredPane = ensureGraphOverlaySvgLayer('connection'); // CHANGE: migrated planting overlay.
            if (layeredPane) return layeredPane; // CHANGE: migrated planting overlay.
            const view = graph.getView && graph.getView(); // CHANGE: migrated planting overlay.
            return view && view.getOverlayPane ? view.getOverlayPane() : null; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function getPanelHost() { // CHANGE: migrated planting overlay.
            const host = graph.container; // CHANGE: migrated planting overlay.
            if (!host) return null; // CHANGE: migrated planting overlay.
            try { // CHANGE: migrated planting overlay.
                if (window.getComputedStyle(host).position === 'static') { // CHANGE: migrated planting overlay.
                    host.style.position = 'relative'; // CHANGE: migrated planting overlay.
                } // CHANGE: migrated planting overlay.
            } catch (_) { } // CHANGE: migrated planting overlay.
            return host; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function getPanelLayer() { // CHANGE: migrated planting overlay.
            return ensureGraphOverlayHtmlLayer('control'); // CHANGE: task schedule panels must stay on the graph control layer below dialogs.
        } // CHANGE: migrated planting overlay.

        function removeNode(node) { // CHANGE: migrated planting overlay.
            if (node && node.parentNode) node.parentNode.removeChild(node); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function removePolyline(poly) { // CHANGE: migrated planting overlay.
            if (poly && poly.node && poly.node.parentNode) { // CHANGE: migrated planting overlay.
                poly.node.parentNode.removeChild(poly.node); // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function loadLaneCollapseState() { // CHANGE: migrated planting overlay.
            if (laneCollapseLoaded) return; // CHANGE: migrated planting overlay.
            laneCollapseLoaded = true; // CHANGE: migrated planting overlay.
            try { // CHANGE: migrated planting overlay.
                const raw = window.localStorage && window.localStorage.getItem(LANE_COLLAPSE_STORAGE_KEY); // CHANGE: migrated planting overlay.
                const parsed = raw ? JSON.parse(raw) : null; // CHANGE: migrated planting overlay.
                if (!parsed || typeof parsed !== 'object') return; // CHANGE: migrated planting overlay.
                for (const key in parsed) { // CHANGE: migrated planting overlay.
                    if (Object.prototype.hasOwnProperty.call(parsed, key)) laneCollapseState.set(key, parsed[key] === true); // CHANGE: migrated planting overlay.
                } // CHANGE: migrated planting overlay.
            } catch (_) { } // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function saveLaneCollapseState() { // CHANGE: migrated planting overlay.
            try { // CHANGE: migrated planting overlay.
                if (!window.localStorage) return; // CHANGE: migrated planting overlay.
                const out = {}; // CHANGE: migrated planting overlay.
                laneCollapseState.forEach((collapsed, key) => { out[key] = !!collapsed; }); // CHANGE: migrated planting overlay.
                window.localStorage.setItem(LANE_COLLAPSE_STORAGE_KEY, JSON.stringify(out)); // CHANGE: migrated planting overlay.
            } catch (_) { } // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function laneCollapseKey(group) { // CHANGE: migrated planting overlay.
            return String(group && (group.laneKey || group.label || group.laneId) || 'UNLANED'); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function isLaneGroupCollapsed(group) { // CHANGE: migrated planting overlay.
            loadLaneCollapseState(); // CHANGE: migrated planting overlay.
            return laneCollapseState.get(laneCollapseKey(group)) === true; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function setLaneGroupCollapsed(group, collapsed) { // CHANGE: migrated planting overlay.
            loadLaneCollapseState(); // CHANGE: migrated planting overlay.
            laneCollapseState.set(laneCollapseKey(group), !!collapsed); // CHANGE: migrated planting overlay.
            saveLaneCollapseState(); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function normalizeBadgeText(text) { // CHANGE: migrated planting overlay.
            return stripHtmlAndPlaceholders(String(text || '')).trim(); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function isValidOverlayCard(card) { // CHANGE: migrated planting overlay.
            return !!card && model.isVertex(card) && isKanbanCard(card) && !!findKanbanBoardAncestor(card); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function taskTitle(card) { // CHANGE: migrated planting overlay.
            return getAttr(card, 'title') || getRawTextLabel(card) || card.id || 'Task'; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function getSourceCropTitle(source) { // CHANGE: migrated planting overlay.
            if (!source) return ''; // CHANGE: migrated planting overlay.
            const plant = normalizeBadgeText(getAttr(source, 'plant_name') || getAttr(source, 'crop_name') || ''); // CHANGE: migrated planting overlay.
            const variety = normalizeBadgeText(getAttr(source, 'variety_name') || getAttr(source, 'variety') || ''); // CHANGE: migrated planting overlay.
            if (plant && variety) return plant + ' - ' + variety; // CHANGE: migrated planting overlay.
            return plant || variety; // CHANGE: selected planting overlays use only crop/variety, never task/link metadata.
        } // CHANGE: migrated planting overlay.

        function getOverlayTitle(entry) { // CHANGE: migrated planting overlay.
            const source = entry && entry.sourceId ? model.getCell(entry.sourceId) : null; // CHANGE: migrated planting overlay.
            return getSourceCropTitle(source) || 'Planting'; // CHANGE: title reflects the selected crop instead of the overlay's task internals.
        } // CHANGE: migrated planting overlay.

        function getScheduleOnlyTitle(entry) { // CHANGE: migrated planting overlay.
            const source = entry && entry.sourceId ? model.getCell(entry.sourceId) : null; // CHANGE: migrated planting overlay.
            return getSourceCropTitle(source) || 'Planting'; // CHANGE: schedule-only overlay follows the same crop/variety title rule.
        } // CHANGE: migrated planting overlay.

        function hasTilerSchedule(cell) { // CHANGE: migrated planting overlay.
            const start = getAttr(cell, 'sow_date'); // CHANGE: migrated planting overlay.
            return start != null && String(start).trim() !== ''; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function canScheduleTilerGroup(cell) { // CHANGE: migrated planting overlay.
            if (!isTilerGroup(cell)) return false; // CHANGE: migrated planting overlay.
            const users = window.Trellis && window.Trellis.users; // CHANGE: migrated planting overlay.
            if (users && typeof users.isEnabled === 'function' && users.isEnabled() && typeof users.canManagePlanting === 'function') return users.canManagePlanting(cell); // CHANGE: migrated planting overlay.
            return true; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function getOccupancyNavigatorApi() { // CHANGE: migrated planting overlay.
            return graph && graph.__trellisBedSuccessionNavigator && typeof graph.__trellisBedSuccessionNavigator.getSelectedClusterOccupancy === 'function' // CHANGE: migrated planting overlay.
                ? graph.__trellisBedSuccessionNavigator // CHANGE: migrated planting overlay.
                : null; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function getPlantingOccupancyRange(cell) { // CHANGE: migrated planting overlay.
            const perennial = String(getAttr(cell, 'perennial') || '') === '1' || !!String(getAttr(cell, 'lifespan_start') || '').trim(); // CHANGE: migrated planting overlay.
            const start = perennial ? parseTaskOverlayDate(getAttr(cell, 'lifespan_start')) : (parseTaskOverlayDate(getAttr(cell, 'transplant_date')) || parseTaskOverlayDate(getAttr(cell, 'sow_date'))); // CHANGE: migrated planting overlay.
            const end = perennial ? parseTaskOverlayDate(getAttr(cell, 'lifespan_end')) : parseTaskOverlayDate(getAttr(cell, 'harvest_end')); // CHANGE: migrated planting overlay.
            if (!start || !end || end.dayNumber < start.dayNumber) return { startISO: null, endISO: null }; // CHANGE: migrated planting overlay.
            return { startISO: start.iso, endISO: end.iso }; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function fallbackOccupancyForSource(source) { // CHANGE: migrated planting overlay.
            if (!isTilerGroup(source)) return { selectedId: null, items: [] }; // CHANGE: migrated planting overlay.
            const range = getPlantingOccupancyRange(source); // CHANGE: migrated planting overlay.
            return { // CHANGE: migrated planting overlay.
                selectedId: source.id, // CHANGE: migrated planting overlay.
                items: [{ cellId: source.id, label: getSourceCropTitle(source) || 'Planting', startISO: range.startISO, endISO: range.endISO }] // CHANGE: migrated planting overlay.
            }; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function getOccupancyModelForEntry(entry) { // CHANGE: migrated planting overlay.
            const source = entry && entry.sourceId ? model.getCell(entry.sourceId) : null; // CHANGE: migrated planting overlay.
            const api = getOccupancyNavigatorApi(); // CHANGE: migrated planting overlay.
            if (api) { // CHANGE: migrated planting overlay.
                const result = api.getSelectedClusterOccupancy(source); // CHANGE: migrated planting overlay.
                if (result && Array.isArray(result.items) && result.items.length) return result; // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.
            return fallbackOccupancyForSource(source); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function getScheduleDialogOpener() { // CHANGE: migrated planting overlay.
            return window.USL && window.USL.scheduler && typeof window.USL.scheduler.openScheduleDialog === 'function' // CHANGE: migrated planting overlay.
                ? window.USL.scheduler.openScheduleDialog // CHANGE: migrated planting overlay.
                : null; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function getDerivedScheduleDialogOpener() { // CHANGE: migrated planting overlay.
            return window.USL && window.USL.scheduler && typeof window.USL.scheduler.openDerivedScheduleDialog === 'function' // CHANGE: migrated planting overlay.
                ? window.USL.scheduler.openDerivedScheduleDialog // CHANGE: migrated planting overlay.
                : null; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function getSetPlantDialogOpener() { // CHANGE: migrated planting overlay.
            return window.USL && window.USL.scheduler && typeof window.USL.scheduler.openSetPlantDialog === 'function' // CHANGE: migrated planting overlay.
                ? window.USL.scheduler.openSetPlantDialog // CHANGE: migrated planting overlay.
                : null; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function sourceOccupancyCompleteForDerived(cell) { // CHANGE: migrated planting overlay.
            if (!isTilerGroup(cell)) return false; // CHANGE: migrated planting overlay.
            const perennial = String(getAttr(cell, 'perennial') || '') === '1' || !!String(getAttr(cell, 'lifespan_start') || '').trim(); // CHANGE: migrated planting overlay.
            const start = perennial ? String(getAttr(cell, 'lifespan_start') || '').trim() : (String(getAttr(cell, 'transplant_date') || '').trim() || String(getAttr(cell, 'sow_date') || '').trim()); // CHANGE: migrated planting overlay.
            const end = perennial ? String(getAttr(cell, 'lifespan_end') || '').trim() : String(getAttr(cell, 'harvest_end') || '').trim(); // CHANGE: migrated planting overlay.
            return !!(start && end); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function sourceIsAnnual(cell) { // CHANGE: migrated planting overlay.
            if (String(getAttr(cell, 'perennial') || '') === '1' || String(getAttr(cell, 'lifespan_start') || '').trim()) return false; // CHANGE: migrated planting overlay.
            return String(getAttr(cell, 'annual') || '') === '1' || !!String(getAttr(cell, 'harvest_end') || '').trim(); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function styleDerivedActionButton(button, enabled, color) { // CHANGE: migrated planting overlay.
            applyPlantingOverlayButtonStyle(button, 'add', { compact: true }); // CHANGE: migrated planting overlay.
            button.style.border = '1px solid ' + color; // CHANGE: migrated planting overlay.
            button.style.borderRadius = '5px'; // CHANGE: migrated planting overlay.
            button.style.background = enabled ? '#ffffff' : '#f1f3f4'; // CHANGE: migrated planting overlay.
            button.style.color = enabled ? color : '#9aa0a6'; // CHANGE: migrated planting overlay.
            button.style.cursor = enabled ? 'pointer' : 'default'; // CHANGE: migrated planting overlay.
            button.style.fontSize = '10px'; // CHANGE: migrated planting overlay.
            button.style.fontWeight = 'bold'; // CHANGE: migrated planting overlay.
            button.style.padding = '4px 7px'; // CHANGE: migrated planting overlay.
            button.style.whiteSpace = 'nowrap'; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function createDerivedScheduleActionButton(entry, mode) { // CHANGE: migrated planting overlay.
            const source = entry && entry.sourceId ? model.getCell(entry.sourceId) : null; // CHANGE: migrated planting overlay.
            if (!isTilerGroup(source) || !hasTilerSchedule(source)) return null; // CHANGE: migrated planting overlay.
            const opener = getDerivedScheduleDialogOpener(); // CHANGE: migrated planting overlay.
            const allowed = canScheduleTilerGroup(source); // CHANGE: migrated planting overlay.
            const hasDates = sourceOccupancyCompleteForDerived(source); // CHANGE: migrated planting overlay.
            const annualOk = mode !== 'turnover' || sourceIsAnnual(source); // CHANGE: migrated planting overlay.
            const enabled = !!(opener && allowed && hasDates && annualOk); // CHANGE: migrated planting overlay.
            const button = document.createElement('button'); // CHANGE: migrated planting overlay.
            button.type = 'button'; // CHANGE: migrated planting overlay.
            button.textContent = mode === 'turnover' ? 'Add Turnover' : 'Add Companion'; // CHANGE: migrated planting overlay.
            button.disabled = !enabled; // CHANGE: migrated planting overlay.
            button.title = !opener ? 'Scheduler plugin is unavailable.' : (!allowed ? 'You do not have permission to schedule this planting group.' : (!hasDates ? 'Source occupancy dates are required.' : (!annualOk ? 'Turnover is available only for annual source groups.' : button.textContent))); // CHANGE: migrated planting overlay.
            styleDerivedActionButton(button, enabled, '#166534'); // CHANGE: migrated planting overlay.
            mxEvent.addListener(button, 'mousedown', consumeOverlayControlEvent); // CHANGE: migrated planting overlay.
            mxEvent.addListener(button, 'dblclick', consumeOverlayControlEvent); // CHANGE: migrated planting overlay.
            mxEvent.addListener(button, 'click', async function (evt) { // CHANGE: migrated planting overlay.
                consumeOverlayControlEvent(evt); // CHANGE: migrated planting overlay.
                if (!enabled) return; // CHANGE: migrated planting overlay.
                const liveSource = model.getCell(entry.sourceId); // CHANGE: migrated planting overlay.
                if (!isTilerGroup(liveSource)) return; // CHANGE: migrated planting overlay.
                try { // CHANGE: migrated planting overlay.
                    await opener(ui, liveSource, { mode }); // CHANGE: migrated planting overlay.
                    setTimeout(refresh, 0); // CHANGE: migrated planting overlay.
                } catch (e) { // CHANGE: migrated planting overlay.
                    mxUtils.alert('Derived scheduling error: ' + (e && e.message ? e.message : String(e))); // CHANGE: migrated planting overlay.
                } // CHANGE: migrated planting overlay.
            }); // CHANGE: migrated planting overlay.
            return button; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function hasAssignedPlant(cell) { // CHANGE: migrated planting overlay.
            const plantName = getAttr(cell, 'plant_name'); // CHANGE: migrated planting overlay.
            return plantName != null && String(plantName).trim() !== ''; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function getTaskLinkLabelBadge(entry, card) { // CHANGE: migrated planting overlay.
            if (!entry || !entry.linkLabels || !card) return ''; // CHANGE: migrated planting overlay.
            const label = normalizeBadgeText(entry.linkLabels.get(card.id)); // CHANGE: migrated planting overlay.
            if (!label) return ''; // CHANGE: migrated planting overlay.
            const title = normalizeBadgeText(taskTitle(card)); // CHANGE: migrated planting overlay.
            return label.toLowerCase() === title.toLowerCase() ? '' : label; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function applyPanelStyle(panel) { // CHANGE: migrated planting overlay.
            panel.style.position = 'absolute'; // CHANGE: migrated planting overlay.
            panel.style.zIndex = String(GRAPH_OVERLAY_Z.CONTROL); // CHANGE: migrated planting overlay.
            panel.style.width = 'max-content'; // CHANGE: let the planting overlay size from current mode/content.
            panel.style.minWidth = PANEL_MIN_WIDTH + 'px'; // CHANGE: migrated planting overlay.
            panel.style.maxWidth = PANEL_MAX_WIDTH + 'px'; // CHANGE: migrated planting overlay.
            panel.style.boxSizing = 'border-box'; // CHANGE: migrated planting overlay.
            panel.style.padding = '8px'; // CHANGE: migrated planting overlay.
            panel.style.border = '1px solid rgba(60, 64, 67, 0.28)'; // CHANGE: migrated planting overlay.
            panel.style.borderRadius = '6px'; // CHANGE: migrated planting overlay.
            panel.style.background = 'rgba(255, 255, 255, 0.97)'; // CHANGE: migrated planting overlay.
            panel.style.boxShadow = '0 3px 10px rgba(0, 0, 0, 0.20)'; // CHANGE: migrated planting overlay.
            panel.style.fontFamily = 'Arial, Helvetica, sans-serif'; // CHANGE: migrated planting overlay.
            panel.style.fontSize = '11px'; // CHANGE: migrated planting overlay.
            panel.style.lineHeight = '16px'; // CHANGE: migrated planting overlay.
            panel.style.pointerEvents = 'all'; // CHANGE: migrated planting overlay.
            panel.style.color = '#202124'; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function dynamicPanelWidth(panel) { // CHANGE: migrated planting overlay.
            const measured = Number(panel && panel.offsetWidth); // CHANGE: migrated planting overlay.
            return Number.isFinite(measured) && measured > 0 ? measured : PANEL_FALLBACK_WIDTH; // CHANGE: positioning follows rendered dynamic width.
        } // CHANGE: migrated planting overlay.

        function makeTextSpan(text, color) { // CHANGE: migrated planting overlay.
            const span = document.createElement('span'); // CHANGE: migrated planting overlay.
            span.textContent = text || ''; // CHANGE: migrated planting overlay.
            span.style.overflow = 'hidden'; // CHANGE: migrated planting overlay.
            span.style.textOverflow = 'ellipsis'; // CHANGE: migrated planting overlay.
            span.style.whiteSpace = 'nowrap'; // CHANGE: migrated planting overlay.
            if (color) span.style.color = color; // CHANGE: migrated planting overlay.
            return span; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function makeClickableRow(card, className) { // CHANGE: migrated planting overlay.
            const row = document.createElement('div'); // CHANGE: migrated planting overlay.
            row.className = className || ''; // CHANGE: migrated planting overlay.
            row.setAttribute('title', 'Click to navigate to task'); // CHANGE: migrated planting overlay.
            const cardId = card.id; // CHANGE: migrated planting overlay.
            mxEvent.addListener(row, 'mousedown', function (evt) { // CHANGE: migrated planting overlay.
                if (evt.button != null && evt.button !== 0) return; // CHANGE: migrated planting overlay.
                const realCard = model.getCell(cardId); // CHANGE: migrated planting overlay.
                if (realCard && model.isVertex(realCard)) navigateOverlayCell(realCard); // CHANGE: migrated planting overlay.
                mxEvent.consume(evt); // CHANGE: migrated planting overlay.
                if (evt.stopPropagation) evt.stopPropagation(); // CHANGE: migrated planting overlay.
                if (evt.preventDefault) evt.preventDefault(); // CHANGE: migrated planting overlay.
            }); // CHANGE: migrated planting overlay.
            return row; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function makeBadge(text) { // CHANGE: migrated planting overlay.
            const badge = document.createElement('span'); // CHANGE: migrated planting overlay.
            badge.textContent = text; // CHANGE: migrated planting overlay.
            badge.style.display = 'inline-block'; // CHANGE: migrated planting overlay.
            badge.style.maxWidth = '150px'; // CHANGE: migrated planting overlay.
            badge.style.overflow = 'hidden'; // CHANGE: migrated planting overlay.
            badge.style.textOverflow = 'ellipsis'; // CHANGE: migrated planting overlay.
            badge.style.whiteSpace = 'nowrap'; // CHANGE: migrated planting overlay.
            badge.style.padding = '1px 6px'; // CHANGE: migrated planting overlay.
            badge.style.border = '1px solid rgba(60, 64, 67, 0.25)'; // CHANGE: migrated planting overlay.
            badge.style.borderRadius = '10px'; // CHANGE: migrated planting overlay.
            badge.style.background = '#f8f9fa'; // CHANGE: migrated planting overlay.
            badge.style.color = '#3c4043'; // CHANGE: migrated planting overlay.
            badge.style.fontSize = '10px'; // CHANGE: migrated planting overlay.
            badge.style.lineHeight = '14px'; // CHANGE: migrated planting overlay.
            return badge; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function makeYearControlButton(text, disabled) { // CHANGE: migrated planting overlay.
            const button = document.createElement('button'); // CHANGE: migrated planting overlay.
            button.type = 'button'; // CHANGE: migrated planting overlay.
            button.textContent = text; // CHANGE: migrated planting overlay.
            button.disabled = !!disabled; // CHANGE: migrated planting overlay.
            button.style.width = '24px'; // CHANGE: migrated planting overlay.
            button.style.height = '22px'; // CHANGE: migrated planting overlay.
            button.style.border = '1px solid rgba(60, 64, 67, 0.28)'; // CHANGE: migrated planting overlay.
            button.style.borderRadius = '5px'; // CHANGE: migrated planting overlay.
            button.style.background = disabled ? '#f1f3f4' : '#ffffff'; // CHANGE: migrated planting overlay.
            button.style.color = disabled ? '#9aa0a6' : '#202124'; // CHANGE: migrated planting overlay.
            button.style.cursor = disabled ? 'default' : 'pointer'; // CHANGE: migrated planting overlay.
            button.style.padding = '0'; // CHANGE: migrated planting overlay.
            button.style.lineHeight = '18px'; // CHANGE: migrated planting overlay.
            return button; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function consumeOverlayControlEvent(evt) { // CHANGE: migrated planting overlay.
            try { mxEvent.consume(evt); } catch (_) { } // CHANGE: migrated planting overlay.
            if (evt && evt.stopPropagation) evt.stopPropagation(); // CHANGE: migrated planting overlay.
            if (evt && evt.preventDefault) evt.preventDefault(); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function scheduleActionButtonLabelFor(source) { // CHANGE: migrated planting overlay.
            return hasTilerSchedule(source) ? 'Edit schedule' : 'Set schedule'; // CHANGE: legacy companion identity no longer changes schedule editing copy.
        } // CHANGE: migrated planting overlay.

        function scheduleActionButtonTitleFor(source, opener, allowed) { // CHANGE: migrated planting overlay.
            if (!allowed) return 'You do not have permission to schedule this planting group.'; // CHANGE: migrated planting overlay.
            if (!opener) return 'Scheduler plugin is unavailable.'; // CHANGE: migrated planting overlay.
            return scheduleActionButtonLabelFor(source); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function createScheduleActionButton(entry) { // CHANGE: migrated planting overlay.
            const source = entry && entry.sourceId ? model.getCell(entry.sourceId) : null; // CHANGE: migrated planting overlay.
            if (!isTilerGroup(source)) return null; // CHANGE: migrated planting overlay.
            const opener = getScheduleDialogOpener(); // CHANGE: migrated planting overlay.
            const allowed = canScheduleTilerGroup(source); // CHANGE: migrated planting overlay.
            const button = document.createElement('button'); // CHANGE: migrated planting overlay.
            button.type = 'button'; // CHANGE: migrated planting overlay.
            button.textContent = scheduleActionButtonLabelFor(source); // CHANGE: migrated planting overlay.
            button.title = scheduleActionButtonTitleFor(source, opener, allowed); // CHANGE: migrated planting overlay.
            button.disabled = !opener || !allowed; // CHANGE: migrated planting overlay.
            applyPlantingOverlayButtonStyle(button, 'open', { compact: true }); // CHANGE: migrated planting overlay.
            button.style.border = '1px solid #2563eb'; // CHANGE: migrated planting overlay.
            button.style.borderRadius = '5px'; // CHANGE: migrated planting overlay.
            button.style.background = opener && allowed ? '#ffffff' : '#f1f3f4'; // CHANGE: migrated planting overlay.
            button.style.color = opener && allowed ? '#1d4ed8' : '#9aa0a6'; // CHANGE: migrated planting overlay.
            button.style.cursor = opener && allowed ? 'pointer' : 'default'; // CHANGE: migrated planting overlay.
            button.style.fontSize = '10px'; // CHANGE: migrated planting overlay.
            button.style.fontWeight = 'bold'; // CHANGE: migrated planting overlay.
            button.style.padding = '4px 7px'; // CHANGE: migrated planting overlay.
            button.style.whiteSpace = 'nowrap'; // CHANGE: migrated planting overlay.
            mxEvent.addListener(button, 'mousedown', consumeOverlayControlEvent); // CHANGE: migrated planting overlay.
            mxEvent.addListener(button, 'dblclick', consumeOverlayControlEvent); // CHANGE: migrated planting overlay.
            mxEvent.addListener(button, 'click', async function (evt) { // CHANGE: migrated planting overlay.
                consumeOverlayControlEvent(evt); // CHANGE: migrated planting overlay.
                if (!opener) return; // CHANGE: migrated planting overlay.
                const liveSource = model.getCell(entry.sourceId); // CHANGE: migrated planting overlay.
                if (!isTilerGroup(liveSource)) return; // CHANGE: migrated planting overlay.
                if (!canScheduleTilerGroup(liveSource)) return; // CHANGE: migrated planting overlay.
                try { // CHANGE: migrated planting overlay.
                    await opener(ui, liveSource); // CHANGE: migrated planting overlay.
                    setTimeout(refresh, 0); // CHANGE: migrated planting overlay.
                } catch (e) { // CHANGE: migrated planting overlay.
                    mxUtils.alert('Scheduling error: ' + (e && e.message ? e.message : String(e))); // CHANGE: migrated planting overlay.
                } // CHANGE: migrated planting overlay.
            }); // CHANGE: migrated planting overlay.
            return button; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function createSetPlantActionButton(entry) { // CHANGE: migrated planting overlay.
            const source = entry && entry.sourceId ? model.getCell(entry.sourceId) : null; // CHANGE: migrated planting overlay.
            if (!isTilerGroup(source) || hasAssignedPlant(source)) return null; // CHANGE: migrated planting overlay.
            const opener = getSetPlantDialogOpener(); // CHANGE: migrated planting overlay.
            const button = document.createElement('button'); // CHANGE: migrated planting overlay.
            button.type = 'button'; // CHANGE: migrated planting overlay.
            button.textContent = 'Set plant'; // CHANGE: migrated planting overlay.
            button.title = opener ? 'Assign a plant and its default spacing to this planting group.' : 'Scheduler plant picker is unavailable.'; // CHANGE
            button.disabled = !opener; // CHANGE: migrated planting overlay.
            applyPlantingOverlayButtonStyle(button, 'add', { compact: true }); // CHANGE: migrated planting overlay.
            button.style.border = '1px solid #188038'; // CHANGE: migrated planting overlay.
            button.style.borderRadius = '5px'; // CHANGE: migrated planting overlay.
            button.style.background = opener ? '#ffffff' : '#f1f3f4'; // CHANGE: migrated planting overlay.
            button.style.color = opener ? '#137333' : '#9aa0a6'; // CHANGE: migrated planting overlay.
            button.style.cursor = opener ? 'pointer' : 'default'; // CHANGE: migrated planting overlay.
            button.style.fontSize = '10px'; // CHANGE: migrated planting overlay.
            button.style.fontWeight = 'bold'; // CHANGE: migrated planting overlay.
            button.style.padding = '4px 7px'; // CHANGE: migrated planting overlay.
            button.style.whiteSpace = 'nowrap'; // CHANGE: migrated planting overlay.
            mxEvent.addListener(button, 'mousedown', consumeOverlayControlEvent); // CHANGE: migrated planting overlay.
            mxEvent.addListener(button, 'dblclick', consumeOverlayControlEvent); // CHANGE: migrated planting overlay.
            mxEvent.addListener(button, 'click', async function (evt) { // CHANGE: migrated planting overlay.
                consumeOverlayControlEvent(evt); // CHANGE: migrated planting overlay.
                if (!opener) return; // CHANGE: migrated planting overlay.
                const liveSource = model.getCell(entry.sourceId); // CHANGE: migrated planting overlay.
                if (!isTilerGroup(liveSource) || hasAssignedPlant(liveSource)) return; // CHANGE: migrated planting overlay.
                try { // CHANGE: migrated planting overlay.
                    await opener(ui, liveSource); // CHANGE: migrated planting overlay.
                    setTimeout(refresh, 0); // CHANGE: migrated planting overlay.
                } catch (e) { // CHANGE: migrated planting overlay.
                    mxUtils.alert('Set Plant error: ' + (e && e.message ? e.message : String(e))); // CHANGE: migrated planting overlay.
                } // CHANGE: migrated planting overlay.
            }); // CHANGE: migrated planting overlay.
            return button; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function createSecondaryActionRow(entry) { // CHANGE: migrated planting overlay.
            const setPlantButton = createSetPlantActionButton(entry); // CHANGE: migrated planting overlay.
            if (!setPlantButton) return null; // CHANGE: migrated planting overlay.
            const row = document.createElement('div'); // CHANGE: migrated planting overlay.
            row.style.gridColumn = '1 / span 2'; // CHANGE: migrated planting overlay.
            row.style.display = 'flex'; // CHANGE: migrated planting overlay.
            row.style.justifyContent = 'flex-end'; // CHANGE: migrated planting overlay.
            row.style.marginTop = '7px'; // CHANGE: migrated planting overlay.
            row.appendChild(setPlantButton); // CHANGE: migrated planting overlay.
            return row; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function applyOverlayYearFilter(entry, year) { // CHANGE: migrated planting overlay.
            if (!entry || !Number.isFinite(Number(year))) return; // CHANGE: migrated planting overlay.
            const selectedYear = Number(year); // CHANGE: migrated planting overlay.
            const cards = entry.targetIds.map(id => model.getCell(id)).filter(isValidOverlayCard); // CHANGE: migrated planting overlay.
            model.beginUpdate(); // CHANGE: migrated planting overlay.
            try { // CHANGE: migrated planting overlay.
                for (const card of cards) { // CHANGE: migrated planting overlay.
                    const hidden = !taskDateRangeOverlapsYear(card, selectedYear); // CHANGE: migrated planting overlay.
                    const nextValue = hidden ? '1' : null; // CHANGE: migrated planting overlay.
                    if (getAttr(card, 'year_hidden') !== (nextValue || null)) setCellAttrUndoable(card, 'year_hidden', nextValue); // CHANGE: migrated planting overlay.
                } // CHANGE: migrated planting overlay.
            } finally { // CHANGE: migrated planting overlay.
                model.endUpdate(); // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.
            entry.selectedYear = selectedYear; // CHANGE: migrated planting overlay.
            selectedYearBySource.set(entry.sourceId, selectedYear); // CHANGE: migrated planting overlay.
            dispatchYearFilterChangedForTaskOverlay(null, selectedYear); // CHANGE: migrated planting overlay.
            renderEntry(entry); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function restoreEntryTasksToCurrentYear(entry) { // CHANGE: migrated planting overlay.
            if (!entry || !entry.targetIds) return; // CHANGE: migrated planting overlay.
            const cards = entry.targetIds.map(id => model.getCell(id)).filter(isValidOverlayCard); // CHANGE: migrated planting overlay.
            if (!cards.length) return; // CHANGE: migrated planting overlay.
            const source = model.getCell(entry.sourceId); // CHANGE: migrated planting overlay.
            const restoreYear = getDashboardYearForCell(source || cards[0]); // CHANGE: migrated planting overlay.
            if (Number(entry.selectedYear) === restoreYear) return; // CHANGE: migrated planting overlay.
            model.beginUpdate(); // CHANGE: migrated planting overlay.
            try { // CHANGE: migrated planting overlay.
                for (const card of cards) { // CHANGE: migrated planting overlay.
                    const hidden = !taskDateRangeOverlapsYear(card, restoreYear); // CHANGE: migrated planting overlay.
                    const nextValue = hidden ? '1' : null; // CHANGE: migrated planting overlay.
                    if (getAttr(card, 'year_hidden') !== (nextValue || null)) setCellAttrUndoable(card, 'year_hidden', nextValue); // CHANGE: migrated planting overlay.
                } // CHANGE: migrated planting overlay.
            } finally { // CHANGE: migrated planting overlay.
                model.endUpdate(); // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.
            selectedYearBySource.delete(entry.sourceId); // CHANGE: migrated planting overlay.
            dispatchYearFilterChangedForTaskOverlay(null, restoreYear); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function isEntryStillSelected(entry) { // CHANGE: migrated planting overlay.
            const selected = graph.getSelectionCells && graph.getSelectionCells(); // CHANGE: migrated planting overlay.
            if (!entry || !selected || selected.length !== 1) return false; // CHANGE: migrated planting overlay.
            const selectedCell = (graph.__trellisPlantingLinking ? graph.__trellisPlantingLinking.normalizeSelection(selected[0]) : selected[0]); // CHANGE: migrated planting overlay.
            return !!selectedCell && selectedCell.id === entry.sourceId; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function createYearControls(entry) { // CHANGE: migrated planting overlay.
            const years = entry && entry.years ? entry.years : []; // CHANGE: migrated planting overlay.
            if (years.length < 2) return null; // CHANGE: migrated planting overlay.
            const current = Number(entry.selectedYear); // CHANGE: migrated planting overlay.
            const idx = Math.max(0, years.indexOf(current)); // CHANGE: migrated planting overlay.
            const wrap = document.createElement('div'); // CHANGE: migrated planting overlay.
            wrap.style.gridColumn = '1 / span 2'; // CHANGE: migrated planting overlay.
            wrap.style.display = 'flex'; // CHANGE: migrated planting overlay.
            wrap.style.alignItems = 'center'; // CHANGE: migrated planting overlay.
            wrap.style.gap = '5px'; // CHANGE: migrated planting overlay.
            wrap.style.marginTop = '7px'; // CHANGE: migrated planting overlay.

            const prev = makeYearControlButton('<', idx <= 0); // CHANGE: migrated planting overlay.
            prev.title = prev.disabled ? 'Already at the first available year.' : 'Show the previous year\'s plantings.'; // CHANGE
            prev.setAttribute('aria-label', 'Previous year'); // CHANGE
            const label = document.createElement('div'); // CHANGE: migrated planting overlay.
            label.textContent = String(years[idx] || current || years[0]); // CHANGE: migrated planting overlay.
            label.style.minWidth = '48px'; // CHANGE: migrated planting overlay.
            label.style.textAlign = 'center'; // CHANGE: migrated planting overlay.
            label.style.border = '1px solid rgba(60, 64, 67, 0.28)'; // CHANGE: migrated planting overlay.
            label.style.borderRadius = '5px'; // CHANGE: migrated planting overlay.
            label.style.background = '#ffffff'; // CHANGE: migrated planting overlay.
            label.style.fontWeight = 'bold'; // CHANGE: migrated planting overlay.
            label.style.fontSize = '10px'; // CHANGE: migrated planting overlay.
            label.style.lineHeight = '20px'; // CHANGE: migrated planting overlay.
            const next = makeYearControlButton('>', idx >= years.length - 1); // CHANGE: migrated planting overlay.
            next.title = next.disabled ? 'Already at the last available year.' : 'Show the next year\'s plantings.'; // CHANGE
            next.setAttribute('aria-label', 'Next year'); // CHANGE

            mxEvent.addListener(prev, 'mousedown', function (evt) { // CHANGE: migrated planting overlay.
                if (idx > 0) applyOverlayYearFilter(entry, years[idx - 1]); // CHANGE: migrated planting overlay.
                mxEvent.consume(evt); // CHANGE: migrated planting overlay.
                if (evt.stopPropagation) evt.stopPropagation(); // CHANGE: migrated planting overlay.
                if (evt.preventDefault) evt.preventDefault(); // CHANGE: migrated planting overlay.
            }); // CHANGE: migrated planting overlay.
            mxEvent.addListener(next, 'mousedown', function (evt) { // CHANGE: migrated planting overlay.
                if (idx < years.length - 1) applyOverlayYearFilter(entry, years[idx + 1]); // CHANGE: migrated planting overlay.
                mxEvent.consume(evt); // CHANGE: migrated planting overlay.
                if (evt.stopPropagation) evt.stopPropagation(); // CHANGE: migrated planting overlay.
                if (evt.preventDefault) evt.preventDefault(); // CHANGE: migrated planting overlay.
            }); // CHANGE: migrated planting overlay.

            wrap.appendChild(prev); // CHANGE: migrated planting overlay.
            wrap.appendChild(label); // CHANGE: migrated planting overlay.
            wrap.appendChild(next); // CHANGE: migrated planting overlay.
            return wrap; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function createHeader(entry, count) { // CHANGE: migrated planting overlay.
            const header = document.createElement('div'); // CHANGE: migrated planting overlay.
            header.style.display = 'grid'; // CHANGE: migrated planting overlay.
            header.style.gridTemplateColumns = '1fr auto'; // CHANGE: migrated planting overlay.
            header.style.alignItems = 'center'; // CHANGE: migrated planting overlay.
            header.style.columnGap = '8px'; // CHANGE: migrated planting overlay.
            header.style.marginBottom = '8px'; // CHANGE: migrated planting overlay.

            const titleWrap = document.createElement('div'); // CHANGE: migrated planting overlay.
            const title = document.createElement('div'); // CHANGE: migrated planting overlay.
            title.textContent = getOverlayTitle(entry); // CHANGE: migrated planting overlay.
            title.style.fontWeight = 'bold'; // CHANGE: migrated planting overlay.
            title.style.fontSize = '12px'; // CHANGE: migrated planting overlay.
            title.style.overflow = 'hidden'; // CHANGE: migrated planting overlay.
            title.style.textOverflow = 'ellipsis'; // CHANGE: migrated planting overlay.
            title.style.whiteSpace = 'nowrap'; // CHANGE: migrated planting overlay.
            const subtitle = document.createElement('div'); // CHANGE: migrated planting overlay.
            subtitle.textContent = activeMode === MODE_SPACING ? (count + (count === 1 ? ' planting row' : ' planting rows')) : (count + (count === 1 ? ' linked task' : ' linked tasks')); // CHANGE: migrated planting overlay.
            subtitle.style.color = '#5f6368'; // CHANGE: migrated planting overlay.
            subtitle.style.fontSize = '10px'; // CHANGE: migrated planting overlay.
            titleWrap.appendChild(title); // CHANGE: migrated planting overlay.
            titleWrap.appendChild(subtitle); // CHANGE: migrated planting overlay.
            header.appendChild(titleWrap); // CHANGE: migrated planting overlay.

            const actions = document.createElement('div'); // CHANGE: migrated planting overlay.
            actions.style.display = 'inline-flex'; // CHANGE: migrated planting overlay.
            actions.style.alignItems = 'center'; // CHANGE: migrated planting overlay.
            actions.style.gap = '6px'; // CHANGE: migrated planting overlay.
            actions.style.flexWrap = 'wrap'; // CHANGE: migrated planting overlay.
            actions.style.justifyContent = 'flex-end'; // CHANGE: migrated planting overlay.

            const toggle = document.createElement('div'); // CHANGE: migrated planting overlay.
            toggle.style.cssText = 'display:inline-flex;align-items:center;gap:0;border:1px solid #c7c7cc;border-radius:4px;overflow:hidden;box-sizing:border-box;'; // CHANGE: match the irrigation Build/Analysis selector.
            toggle.appendChild(createModeButton(entry, 'Cards', MODE_CARDS)); // CHANGE: migrated planting overlay.
            toggle.appendChild(createModeButton(entry, 'Schedule', MODE_SCHEDULE)); // CHANGE: migrated planting overlay.
            toggle.appendChild(createModeButton(entry, 'Spacing', MODE_SPACING)); // CHANGE: migrated planting overlay.
            actions.appendChild(toggle); // CHANGE: migrated planting overlay.
            const scheduleButton = createScheduleActionButton(entry); // CHANGE: migrated planting overlay.
            if (scheduleButton) actions.appendChild(scheduleButton); // CHANGE: migrated planting overlay.
            const companionButton = createDerivedScheduleActionButton(entry, 'companion'); // CHANGE: migrated planting overlay.
            if (companionButton) actions.appendChild(companionButton); // CHANGE: migrated planting overlay.
            const turnoverButton = createDerivedScheduleActionButton(entry, 'turnover'); // CHANGE: migrated planting overlay.
            if (turnoverButton) actions.appendChild(turnoverButton); // CHANGE: migrated planting overlay.
            header.appendChild(actions); // CHANGE: migrated planting overlay.
            const secondaryActionRow = createSecondaryActionRow(entry); // CHANGE: migrated planting overlay.
            if (secondaryActionRow) header.appendChild(secondaryActionRow); // CHANGE: migrated planting overlay.
            const yearControls = createYearControls(entry); // CHANGE: migrated planting overlay.
            if (yearControls) header.appendChild(yearControls); // CHANGE: migrated planting overlay.
            return header; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function createScheduleOnlyHeader(entry) { // CHANGE: migrated planting overlay.
            const header = document.createElement('div'); // CHANGE: migrated planting overlay.
            header.style.display = 'flex'; // CHANGE: migrated planting overlay.
            header.style.flexDirection = 'column'; // CHANGE: migrated planting overlay.
            header.style.alignItems = 'stretch'; // CHANGE: migrated planting overlay.
            header.style.gap = '7px'; // CHANGE: migrated planting overlay.

            const title = document.createElement('div'); // CHANGE: migrated planting overlay.
            title.textContent = getScheduleOnlyTitle(entry); // CHANGE: migrated planting overlay.
            title.style.fontWeight = 'bold'; // CHANGE: migrated planting overlay.
            title.style.fontSize = '12px'; // CHANGE: migrated planting overlay.
            title.style.overflow = 'hidden'; // CHANGE: migrated planting overlay.
            title.style.textOverflow = 'ellipsis'; // CHANGE: migrated planting overlay.
            title.style.whiteSpace = 'nowrap'; // CHANGE: migrated planting overlay.
            header.appendChild(title); // CHANGE: migrated planting overlay.

            const toggle = document.createElement('div'); // CHANGE: migrated planting overlay.
            toggle.style.cssText = 'display:inline-flex;align-items:center;gap:0;border:1px solid #c7c7cc;border-radius:4px;overflow:hidden;box-sizing:border-box;'; // CHANGE: schedule-only groups use the same joined mode selector.
            toggle.style.alignSelf = 'flex-start'; // CHANGE: migrated planting overlay.
            const effectiveMode = activeMode === MODE_SPACING ? MODE_SPACING : MODE_SCHEDULE; // CHANGE: migrated planting overlay.
            toggle.appendChild(createModeButton(entry, 'Schedule', MODE_SCHEDULE, effectiveMode)); // CHANGE: migrated planting overlay.
            toggle.appendChild(createModeButton(entry, 'Spacing', MODE_SPACING, effectiveMode)); // CHANGE: migrated planting overlay.
            header.appendChild(toggle); // CHANGE: migrated planting overlay.

            const scheduleButton = createScheduleActionButton(entry); // CHANGE: migrated planting overlay.
            if (scheduleButton) { // CHANGE: migrated planting overlay.
                scheduleButton.style.alignSelf = 'flex-start'; // CHANGE: migrated planting overlay.
                header.appendChild(scheduleButton); // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.
            const companionButton = createDerivedScheduleActionButton(entry, 'companion'); // CHANGE: migrated planting overlay.
            if (companionButton) { companionButton.style.alignSelf = 'flex-start'; header.appendChild(companionButton); } // CHANGE: migrated planting overlay.
            const turnoverButton = createDerivedScheduleActionButton(entry, 'turnover'); // CHANGE: migrated planting overlay.
            if (turnoverButton) { turnoverButton.style.alignSelf = 'flex-start'; header.appendChild(turnoverButton); } // CHANGE: migrated planting overlay.
            const setPlantButton = createSetPlantActionButton(entry); // CHANGE: migrated planting overlay.
            if (setPlantButton) { // CHANGE: migrated planting overlay.
                setPlantButton.style.alignSelf = 'flex-start'; // CHANGE: migrated planting overlay.
                header.appendChild(setPlantButton); // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.
            return header; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function createModeButton(entry, label, mode, activeOverride) { // CHANGE: migrated planting overlay.
            const button = document.createElement('button'); // CHANGE: migrated planting overlay.
            button.type = 'button'; // CHANGE: migrated planting overlay.
            button.textContent = label; // CHANGE: migrated planting overlay.
            button.title = mode === MODE_CARDS ? 'Show linked planting cards.' : mode === MODE_SCHEDULE ? 'Show planting schedules and occupancy dates.' : 'Edit planting spacing and offsets.'; // CHANGE
            const active = (activeOverride || activeMode) === mode; // CHANGE: migrated planting overlay.
            button.setAttribute('aria-pressed', String(active)); // CHANGE: expose the selected planting view.
            if (window.Trellis && window.Trellis.ui && typeof window.Trellis.ui.applyButtonStyle === 'function') { // CHANGE: share the irrigation mode styling.
                window.Trellis.ui.applyButtonStyle(button, 'mode', { compact: true, active }); // CHANGE
            } else { // CHANGE: keep the same appearance when the shared UI helper has not loaded.
                button.style.cssText = 'box-sizing:border-box;border:0;border-radius:0;padding:3px 6px;font:12px Arial,sans-serif;white-space:nowrap;outline-offset:-2px;cursor:pointer;background:' + (active ? '#ecfeff' : '#fff') + ';color:' + (active ? '#155e75' : '#374151') + ';font-weight:' + (active ? '700' : '400') + ';'; // CHANGE: match the irrigation segment palette and dimensions.
            } // CHANGE
            mxEvent.addListener(button, 'mousedown', function (evt) { // CHANGE: migrated planting overlay.
                setMode(mode); // CHANGE: migrated planting overlay.
                mxEvent.consume(evt); // CHANGE: migrated planting overlay.
                if (evt.stopPropagation) evt.stopPropagation(); // CHANGE: migrated planting overlay.
                if (evt.preventDefault) evt.preventDefault(); // CHANGE: migrated planting overlay.
            }); // CHANGE: migrated planting overlay.
            return button; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function createBody() { // CHANGE: migrated planting overlay.
            const body = document.createElement('div'); // CHANGE: migrated planting overlay.
            body.style.maxHeight = BODY_MAX_HEIGHT + 'px'; // CHANGE: migrated planting overlay.
            body.style.overflowY = 'auto'; // CHANGE: migrated planting overlay.
            body.style.overflowX = 'hidden'; // CHANGE: migrated planting overlay.
            body.style.paddingRight = '2px'; // CHANGE: migrated planting overlay.
            return body; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function renderEmptyTaskOverlayMessage(body) { // CHANGE: migrated planting overlay.
            const empty = document.createElement('div'); // CHANGE: migrated planting overlay.
            empty.textContent = 'No linked tasks visible for this year'; // CHANGE: migrated planting overlay.
            empty.style.color = '#5f6368'; // CHANGE: migrated planting overlay.
            empty.style.padding = '8px 0'; // CHANGE: migrated planting overlay.
            body.appendChild(empty); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function countGroupItems(groups) { // CHANGE: migrated planting overlay.
            return (groups || []).reduce((sum, group) => sum + group.items.length, 0); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function countScheduleRows(cards) { // CHANGE: migrated planting overlay.
            return buildScheduleRowsForCards(cards).length; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function countOccupancyRows(entry) { // CHANGE: migrated planting overlay.
            const occupancy = getOccupancyModelForEntry(entry); // CHANGE: migrated planting overlay.
            return occupancy && Array.isArray(occupancy.items) ? occupancy.items.length : 0; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function getLayoutTools() { // CHANGE: migrated planting overlay.
            return window.USL && window.USL.scheduler && window.USL.scheduler.layoutTools; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function countSpacingRows(entry) { // CHANGE: migrated planting overlay.
            if (entry && Array.isArray(entry.spacingRows)) return entry.spacingRows.length; // CHANGE: migrated planting overlay.
            const source = entry && entry.sourceId ? model.getCell(entry.sourceId) : null; // CHANGE: migrated planting overlay.
            const api = graph.__trellisBedSuccessionNavigator; // CHANGE: migrated planting overlay.
            const context = api && typeof api.getSelectedClusterLayoutContext === 'function' ? api.getSelectedClusterLayoutContext(source) : null; // CHANGE: migrated planting overlay.
            return context && Array.isArray(context.cellIds) && context.cellIds.length ? context.cellIds.length : 1; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        const spacingPreviewState = { host: null, hidden: [], chromeCells: [] }; // CHANGE: spacing draft previews are DOM-only copies, not faded mxCells.

        /** Restore old rendered nodes and current selection handlers before reconciling a redraw. */ // CHANGE
        function restoreSpacingPreviewVisibility() { // CHANGE
            spacingPreviewState.hidden.forEach(item => { // CHANGE: migrated planting overlay.
                if (item && item.node && item.node.style) item.node.style.opacity = item.opacity; // CHANGE: migrated planting overlay.
            }); // CHANGE: migrated planting overlay.
            spacingPreviewState.hidden = []; // CHANGE: migrated planting overlay.
            spacingPreviewState.chromeCells.forEach(cell => setSpacingPreviewSelectionChromeVisible(cell, true)); // CHANGE: migrated planting overlay.
            spacingPreviewState.chromeCells = []; // CHANGE: migrated planting overlay.
        } // CHANGE

        function clearSpacingPreview() { // CHANGE: migrated planting overlay.
            restoreSpacingPreviewVisibility(); // CHANGE
            plantingPreview.clear('spacing'); // CHANGE: an editor cannot clear Allocate's preview. // CHANGE: migrated planting overlay.
            spacingPreviewState.host = null; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function setSpacingPreviewSelectionChromeVisible(cell, visible) { // NEW: hide handles without changing graph selection.
            const handler = graph.selectionCellsHandler && typeof graph.selectionCellsHandler.getHandler === 'function' // CHANGE: migrated planting overlay.
                ? graph.selectionCellsHandler.getHandler(cell) // CHANGE: migrated planting overlay.
                : null; // CHANGE: migrated planting overlay.
            if (!handler || typeof handler.setHandlesVisible !== 'function') return; // CHANGE: migrated planting overlay.
            handler.setHandlesVisible(!!visible); // CHANGE: migrated planting overlay.
            if (visible && typeof handler.redraw === 'function') handler.redraw(); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function rememberSpacingPreviewChromeCell(cell) { // NEW: restore selected-cell chrome when draft preview clears.
            if (!cell || spacingPreviewState.chromeCells.indexOf(cell) >= 0) return; // CHANGE: migrated planting overlay.
            spacingPreviewState.chromeCells.push(cell); // CHANGE: migrated planting overlay.
            setSpacingPreviewSelectionChromeVisible(cell, false); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function spacingPreviewCellNodes(cell) { // NEW: hide a group and its rendered descendants while the DOM copy is visible.
            const view = graph.getView && graph.getView(); // CHANGE: migrated planting overlay.
            const out = []; // CHANGE: migrated planting overlay.
            const stack = cell ? [cell] : []; // CHANGE: migrated planting overlay.
            while (stack.length && view) { // CHANGE: migrated planting overlay.
                const current = stack.pop(); // CHANGE: migrated planting overlay.
                const state = view.getState && view.getState(current); // CHANGE: migrated planting overlay.
                if (state && state.shape && state.shape.node) out.push(state.shape.node); // CHANGE: migrated planting overlay.
                if (state && state.text && state.text.node) out.push(state.text.node); // CHANGE: migrated planting overlay.
                const count = model.getChildCount ? model.getChildCount(current) : 0; // CHANGE: migrated planting overlay.
                for (let i = 0; i < count; i++) stack.push(model.getChildAt(current, i)); // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.
            return out; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function hideSpacingPreviewCell(cell) { // CHANGE: migrated planting overlay.
            spacingPreviewCellNodes(cell).forEach(node => { // CHANGE: migrated planting overlay.
                if (!node || !node.style || spacingPreviewState.hidden.some(item => item.node === node)) return; // CHANGE: migrated planting overlay.
                spacingPreviewState.hidden.push({ node, opacity: node.style.opacity || '' }); // CHANGE: migrated planting overlay.
                node.style.opacity = '0'; // CHANGE: keep the real cell hit-testable but visually replaced by the draft copy.
            }); // CHANGE: migrated planting overlay.
            rememberSpacingPreviewChromeCell(cell); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.


        /** Translate a canonical draft by its saved anchor's display displacement, preserving generated frames. */ // CHANGE
        function projectSpacingPreviewRow(row) { // CHANGE
            const cell = model.getCell(row.anchorCellId || row.cellId); // CHANGE: an unsaved companion shares its saved source's display displacement.
            const view = graph.getView(), state = cell && view.getState(cell); // CHANGE
            if (!state || state.invalid || !state.shape || !state.shape.node) return null; // CHANGE: never substitute a saved origin when the displayed origin is unavailable.
            let savedX = 0, savedY = 0; // CHANGE
            for (let current = cell; current; current = model.getParent(current)) { // CHANGE
                const geometry = model.getGeometry(current); // CHANGE
                if (geometry) { savedX += Number(geometry.x) || 0; savedY += Number(geometry.y) || 0; } // CHANGE
            } // CHANGE
            const scale = Number(view.scale) || 1, translate = view.translate || { x: 0, y: 0 }; // CHANGE
            const dx = state.x / scale - translate.x - savedX, dy = state.y / scale - translate.y - savedY; // CHANGE
            if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null; // CHANGE
            return Object.assign({}, row, { // CHANGE: only the disposable drawing copy receives display coordinates.
                rect: Object.assign({}, row.rect, { x: row.rect.x + dx, y: row.rect.y + dy }), // CHANGE
                circles: (row.circles || []).map(dot => Object.assign({}, dot, { x: dot.x + dx, y: dot.y + dy })) // CHANGE
            }); // CHANGE
        } // CHANGE

        /** Reconcile current shapes only after all required anchors of a bed preview are available. */ // CHANGE
        function resolveSpacingPreviewInput(rows, bedPreview) { // CHANGE
            restoreSpacingPreviewVisibility(); // CHANGE: graph refresh may have replaced the nodes hidden by the previous draw.
            const projected = rows.map(projectSpacingPreviewRow); // CHANGE
            const projectedBed = bedPreview ? projectSpacingPreviewRow(bedPreview) : null; // CHANGE
            if (bedPreview && (!projectedBed || projected.some(row => !row))) return null; // CHANGE: a bed and its planting rows are one visibility unit.
            const visibleRows = projected.filter(Boolean); // CHANGE: independent groups may suspend separately.
            if (projectedBed) hideSpacingPreviewCell(model.getCell(projectedBed.cellId)); // CHANGE
            visibleRows.forEach(row => hideSpacingPreviewCell(model.getCell(row.cellId))); // CHANGE
            return { className: 'manual-link-spacing-preview', rows: visibleRows, bedPreview: projectedBed }; // CHANGE
        } // CHANGE

        /** Retain canonical spacing data; resolve anchors and shape visibility on every renderer redraw. */ // CHANGE
        function renderSpacingPreview(modelPreview) { // CHANGE
            clearSpacingPreview(); // CHANGE
            const rows = modelPreview && Array.isArray(modelPreview.rows) ? modelPreview.rows : []; // CHANGE
            if (!rows.length) return; // CHANGE
            const bedPreview = modelPreview.bedPreview; // CHANGE
            const savedAnchor = rows.find(row => !row.proposed && model.getCell(row.cellId)); // CHANGE: proposed companion frames already share this source's canonical rectangle.
            const normalized = rows.map(row => Object.assign({}, row.groupPreview || { rect: row.rect, circles: row.dots && row.dots.circles || [] }, { cellId: row.cellId, anchorCellId: row.proposed ? savedAnchor && savedAnchor.cellId : row.cellId })); // CHANGE
            spacingPreviewState.host = plantingPreview.render('spacing', { resolveInput: () => resolveSpacingPreviewInput(normalized, bedPreview) }); // CHANGE
        } // CHANGE

        function spacingNumberInput(value, enabled) { // CHANGE: migrated planting overlay.
            const input = document.createElement('input'); // CHANGE: migrated planting overlay.
            input.type = 'number'; // CHANGE: migrated planting overlay.
            input.step = '1'; // CHANGE: native spacing-tab steppers move in whole-centimeter intervals while typed decimals remain valid.
            input.value = value == null ? '' : String(Number(value)); // CHANGE: retain computed tangency precision instead of rounding generated layouts.
            input.disabled = !enabled; // CHANGE: migrated planting overlay.
            input.style.width = '100%'; // CHANGE: fit all spacing fields inside the fixed overlay width.
            input.style.minWidth = '0'; // CHANGE: migrated planting overlay.
            input.style.boxSizing = 'border-box'; // CHANGE: migrated planting overlay.
            input.style.fontSize = '10px'; // CHANGE: migrated planting overlay.
            input.style.padding = '2px 3px'; // CHANGE: compact numeric fields prevent clipped columns.
            input.style.textAlign = 'right'; // CHANGE: compact numeric columns stay readable.
            return input; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        const spacingOffsetValues = new WeakMap(); // CHANGE: exact offsets belong to controls, independently of their rounded display.

        /** Assign offsets from layouts or drafts without losing precision to display formatting. */ // CHANGE
        function setSpacingOffsetValue(input, value, roundDisplay = true) { // CHANGE
            const exact = value == null ? '' : String(value); // CHANGE
            const finite = exact.trim() !== '' && Number.isFinite(Number(exact)); // CHANGE
            if (roundDisplay) input.value = finite ? String(Math.round(Number(exact)) || 0) : exact; // CHANGE: normalize negative zero; reading edits must not overwrite the browser's incomplete input text.
            spacingOffsetValues.set(input, { exact, displayed: input.value }); // CHANGE: remember the browser's displayed text, including sanitized invalid numbers.
            input.title = finite ? 'Rounded to whole cm for display. Exact offset: ' + exact + ' cm. Editing replaces this offset.' : 'Enter a finite offset in cm. Valid offsets are rounded only for display.'; // CHANGE
        } // CHANGE

        /** Only explicit edits replace an exact offset; unrelated events read the retained value. */ // CHANGE
        function readSpacingOffsetValue(input, edited = false) { // CHANGE
            let stored = spacingOffsetValues.get(input); // CHANGE
            if (!stored || edited || input.value !== stored.displayed) { // CHANGE: also accept programmatic changes before a shared row refresh.
                setSpacingOffsetValue(input, input.value, false); // CHANGE: preserve typed decimals and incomplete input until blur.
                stored = spacingOffsetValues.get(input); // CHANGE
            } // CHANGE
            return stored.exact; // CHANGE
        } // CHANGE

        function spacingSelect(value, enabled) { // CHANGE: migrated planting overlay.
            const select = document.createElement('select'); // CHANGE: migrated planting overlay.
            ['beside', 'interplant', 'staggered'].forEach(optionValue => { // CHANGE: migrated planting overlay.
                const option = document.createElement('option'); // CHANGE: migrated planting overlay.
                option.value = optionValue; // CHANGE: migrated planting overlay.
                option.textContent = optionValue; // CHANGE: migrated planting overlay.
                select.appendChild(option); // CHANGE: migrated planting overlay.
            }); // CHANGE: migrated planting overlay.
            select.value = value || 'beside'; // CHANGE: migrated planting overlay.
            select.disabled = !enabled; // CHANGE: migrated planting overlay.
            select.style.width = '100%'; // CHANGE: let the spacing grid own column sizing.
            select.style.minWidth = '0'; // CHANGE: prevent the native select width from forcing overflow.
            select.style.fontSize = '10px'; // CHANGE: migrated planting overlay.
            select.style.padding = '2px 3px'; // CHANGE: keep template control aligned with compact numeric fields.
            return select; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function spacingIdleStatus(rows) { // CHANGE: migrated planting overlay.
            const allRows = rows || []; // CHANGE: migrated planting overlay.
            const activeCount = allRows.filter(row => row && row.enabled !== false).length; // CHANGE: migrated planting overlay.
            const inactiveCount = allRows.length - activeCount; // CHANGE: migrated planting overlay.
            if (!activeCount && allRows.length) return 'No active rows in this occupancy window.'; // CHANGE: explain why preview/apply is unavailable.
            return inactiveCount ? 'Only active-window rows preview and apply.' : ''; // CHANGE: inactive rows are context, not editable targets.
        } // CHANGE: migrated planting overlay.

        function spacingDraftFromRowStates(rowStates) { // CHANGE: migrated planting overlay.
            return (rowStates || []).map(state => Object.assign({}, state.row, { // CHANGE: migrated planting overlay.
                spacingXCm: state.spacingX.value, // CHANGE: migrated planting overlay.
                spacingYCm: state.spacingY.value, // CHANGE: migrated planting overlay.
                allowedOverhangPct: state.overhang.value, overhangEdited: state.overhangEdited, // CHANGE
                offsetXCm: readSpacingOffsetValue(state.offsetX), // CHANGE: drafts consume exact offsets, never rounded display text.
                offsetYCm: readSpacingOffsetValue(state.offsetY) // CHANGE
            })); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function spacingDraftKey(row) { // CHANGE: migrated planting overlay.
            return String(row && row.cellId || ''); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function readStoredSpacingDraft(entry, row) { // NEW: view refreshes keep uncommitted field values.
            const key = spacingDraftKey(row); // CHANGE: migrated planting overlay.
            return key && entry && entry.spacingDraftByCellId ? entry.spacingDraftByCellId.get(key) : null; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function writeStoredSpacingDrafts(entry, rowStates) { // NEW: draft state lives outside the graph model.
            if (!entry) return; // CHANGE: migrated planting overlay.
            if (!entry.spacingDraftByCellId) entry.spacingDraftByCellId = new Map(); // CHANGE: migrated planting overlay.
            (rowStates || []).forEach(state => { // CHANGE: migrated planting overlay.
                const key = spacingDraftKey(state.row); // CHANGE: migrated planting overlay.
                if (!key || state.row.enabled === false) return; // CHANGE: migrated planting overlay.
                if (spacingRowChanged(state)) { // CHANGE: migrated planting overlay.
                    entry.spacingDraftByCellId.set(key, { // CHANGE: migrated planting overlay.
                        layoutMetadata: { rect: state.row.rect, modelRect: state.row.modelRect, rotationDeg: state.row.rotationDeg, vegDiameterCm: state.row.vegDiameterCm, clipBounds: state.row.clipBounds, resetDisabled: state.row.resetDisabled, generatedPattern: state.row.generatedPattern, strictFootprint: state.row.strictFootprint }, // CHANGE
                        spacingXCm: state.spacingX.value, // CHANGE: migrated planting overlay.
                        spacingYCm: state.spacingY.value, // CHANGE: migrated planting overlay.
                        allowedOverhangPct: state.overhang.value, overhangEdited: state.overhangEdited, // CHANGE
                        offsetXCm: readSpacingOffsetValue(state.offsetX), // CHANGE: view refreshes retain exact offset drafts.
                        offsetYCm: readSpacingOffsetValue(state.offsetY) // CHANGE
                    }); // CHANGE: migrated planting overlay.
                } else { // CHANGE: migrated planting overlay.
                    entry.spacingDraftByCellId.delete(key); // CHANGE: migrated planting overlay.
                } // CHANGE: migrated planting overlay.
            }); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function clearStoredSpacingDrafts(entry) { // CHANGE: migrated planting overlay.
            if (entry && entry.spacingDraftByCellId) entry.spacingDraftByCellId.clear(); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function spacingRowChanged(state) { // CHANGE: migrated planting overlay.
            const row = state.row; // CHANGE: migrated planting overlay.
            const offsetX = readSpacingOffsetValue(state.offsetX), offsetY = readSpacingOffsetValue(state.offsetY); // CHANGE: include incomplete offset drafts even when the original offset was zero.
            return Number(state.spacingX.value) !== Number(row.spacingXCm) || // CHANGE: migrated planting overlay.
                state.overhangEdited || state.overhang.value.trim() === '' || Number(state.overhang.value) !== resolveAllowedOverhangPct(row.allowedOverhangPct) || // CHANGE
                Number(state.spacingY.value) !== Number(row.spacingYCm) || // CHANGE: migrated planting overlay.
                offsetX.trim() === '' || Number(offsetX) !== Number(row.offsetXCm) || // CHANGE: rounding alone cannot mark a layout Custom or changed; blank is not zero.
                offsetY.trim() === '' || Number(offsetY) !== Number(row.offsetYCm) || !!row.generatedPattern; // CHANGE: generated patterns also update the shared planting frame.
        } // CHANGE: migrated planting overlay.

        function revertSpacingRowState(state) { // CHANGE: migrated planting overlay.
            const row = state.row.plantDefaultLayout || state.row; // CHANGE: row reset restores plant defaults when the scheduler exposes them.
            state.spacingX.value = row.spacingXCm == null ? '' : String(Math.round(Number(row.spacingXCm) * 10) / 10); // CHANGE: migrated planting overlay.
            state.spacingY.value = row.spacingYCm == null ? '' : String(Math.round(Number(row.spacingYCm) * 10) / 10); // CHANGE: migrated planting overlay.
            setSpacingOffsetValue(state.offsetX, row.offsetXCm); // CHANGE: reset restores the exact layout and its rounded display together.
            setSpacingOffsetValue(state.offsetY, row.offsetYCm); // CHANGE
            state.overhang.value = String(savedCropOverhangDefaults.get(String(state.row.plantId)) ?? resolveAllowedOverhangPct(row.allowedOverhangPct)); state.overhangEdited = true; // CHANGE: restore the current committed crop default, even in an already-open editor.
        } // CHANGE: migrated planting overlay.

        const SPACING_ROW_GRID_COLUMNS = 'minmax(72px,1fr) repeat(5,minmax(36px,46px)) 24px'; // CHANGE: percentage joins the four centimeter fields without widening the overlay.

        function createSpacingGridRow(className) { // CHANGE: migrated planting overlay.
            const row = document.createElement('div'); // CHANGE: migrated planting overlay.
            row.className = className || ''; // CHANGE: migrated planting overlay.
            row.style.display = 'grid'; // CHANGE: migrated planting overlay.
            row.style.gridTemplateColumns = SPACING_ROW_GRID_COLUMNS; // CHANGE: migrated planting overlay.
            row.style.columnGap = '4px'; // CHANGE: migrated planting overlay.
            row.style.alignItems = 'center'; // CHANGE: migrated planting overlay.
            row.style.width = '100%'; // CHANGE: migrated planting overlay.
            row.style.minWidth = '0'; // CHANGE: migrated planting overlay.
            return row; // CHANGE: each plant owns one grid row instead of relying on global CSS grid auto-placement.
        } // CHANGE: migrated planting overlay.

        function renderSpacingEditor(entry, body, context, tools, options = {}) { // CHANGE: Allocate and saved groups share one spacing editor.
            body.innerHTML = ''; // CHANGE: migrated planting overlay.
            entry.spacingRows = context.rows || []; // CHANGE: migrated planting overlay.
            const wrap = document.createElement('div'); // CHANGE: migrated planting overlay.
            wrap.className = 'manual-link-spacing-editor'; // CHANGE: migrated planting overlay.
            wrap.style.display = 'flex'; // CHANGE: migrated planting overlay.
            wrap.style.flexDirection = 'column'; // CHANGE: migrated planting overlay.
            wrap.style.gap = '6px'; // CHANGE: migrated planting overlay.
            const overhangHint = document.createElement('div'); // CHANGE
            overhangHint.className = 'manual-link-overhang-hint'; overhangHint.style.cssText = 'font-size:10px;line-height:13px;color:#5f6368;'; // CHANGE
            overhangHint.textContent = 'Allowed overhang (%) is circle diameter per bed edge (0–50%). Committed edits update the crop default.'; // CHANGE
            if (context.rows?.some(row => row.clipBounds || row.generatedPattern || row.strictFootprint) || options.live && !options.fitToDemand) overhangHint.textContent += ' Companion layouts keep the existing planting area.'; // CHANGE
            wrap.appendChild(overhangHint); // CHANGE

            const patternBar = document.createElement('div'); // CHANGE
            patternBar.className = 'manual-link-spacing-pattern'; patternBar.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;'; // CHANGE
            const patternLabel = document.createElement('span'); patternLabel.textContent = 'Row layout:'; patternBar.appendChild(patternLabel); // CHANGE
            const targetSelect = document.createElement('select'); targetSelect.setAttribute('aria-label', 'Companion planting'); // CHANGE
            const targets = context.companionTargets || []; // CHANGE
            if (targets.length > 1) { const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Choose companion'; targetSelect.appendChild(placeholder); } // CHANGE
            targets.forEach(row => { const option = document.createElement('option'); option.value = row.cellId; option.textContent = row.label || row.cellId; targetSelect.appendChild(option); }); // CHANGE
            targetSelect.value = context.pairTargetId || entry.pairTargetId || (targets.length === 1 ? targets[0].cellId : ''); // CHANGE
            if (targets.length > 1) patternBar.appendChild(targetSelect); // CHANGE
            const patternSource = document.createElement('span'); patternSource.className = 'manual-link-spacing-pattern-source'; patternSource.textContent = context.layoutSource || 'Custom'; // CHANGE
            const patternButtons = ['aligned', 'staggered'].map(pattern => { // CHANGE
                const button = document.createElement('button'); button.type = 'button'; button.textContent = pattern === 'aligned' ? 'Aligned' : 'Staggered'; // CHANGE
                button.dataset.spacingPattern = pattern; applyPlantingOverlayButtonStyle(button, 'neutral', { compact: true }); // CHANGE
                button.disabled = !targetSelect.value || !tools.generateCompanionPairLayout; patternBar.appendChild(button); return button; // CHANGE
            }); // CHANGE
            patternBar.appendChild(patternSource); patternBar.style.display = targets.length ? 'flex' : 'none'; wrap.appendChild(patternBar); // CHANGE
            const rowsWrap = document.createElement('div'); // CHANGE: migrated planting overlay.
            rowsWrap.className = 'manual-link-spacing-rows'; // CHANGE: migrated planting overlay.
            rowsWrap.style.display = 'flex'; // CHANGE: migrated planting overlay.
            rowsWrap.style.flexDirection = 'column'; // CHANGE: migrated planting overlay.
            rowsWrap.style.gap = '5px'; // CHANGE: migrated planting overlay.
            rowsWrap.style.width = '100%'; // CHANGE: migrated planting overlay.
            rowsWrap.style.minWidth = '0'; // CHANGE: migrated planting overlay.
            const headerRow = createSpacingGridRow('manual-link-spacing-header'); // CHANGE: migrated planting overlay.
            if (options.live) headerRow.style.gridTemplateColumns = 'minmax(44px,1.4fr) repeat(5,minmax(0,1fr)) 18px'; // CHANGE
            ['Planting', 'Space X', 'Space Y', 'Off X', 'Off Y', 'Overhang %', ''].forEach(text => { // CHANGE
                const head = document.createElement('div'); // CHANGE: migrated planting overlay.
                head.textContent = text; // CHANGE: migrated planting overlay.
                head.style.fontSize = '9px'; // CHANGE: migrated planting overlay.
                head.style.color = '#5f6368'; // CHANGE: migrated planting overlay.
                head.style.fontWeight = '700'; // CHANGE: migrated planting overlay.
                head.style.minWidth = '0'; // CHANGE: headers no longer force the spacing grid wider than the panel.
                head.style.textAlign = text === 'Planting' ? 'left' : 'center'; // CHANGE: compact columns remain visually aligned.
                headerRow.appendChild(head); // CHANGE: migrated planting overlay.
            }); // CHANGE: migrated planting overlay.
            rowsWrap.appendChild(headerRow); // CHANGE: migrated planting overlay.

            const rowStates = []; // CHANGE: migrated planting overlay.
            (context.rows || []).forEach(initialRow => { // CHANGE
                const metadata = readStoredSpacingDraft(entry, initialRow)?.layoutMetadata || {}; // CHANGE
                const row = Object.assign({}, initialRow, metadata); // CHANGE
                const enabled = row.enabled !== false; // CHANGE: migrated planting overlay.
                const storedDraft = readStoredSpacingDraft(entry, row); // CHANGE: migrated planting overlay.
                const displayRow = storedDraft ? Object.assign({}, row, storedDraft) : row; // CHANGE: migrated planting overlay.
                const rowEl = createSpacingGridRow('manual-link-spacing-row'); // CHANGE: migrated planting overlay.
                if (options.live) rowEl.style.gridTemplateColumns = 'minmax(44px,1.4fr) repeat(5,minmax(0,1fr)) 18px'; // CHANGE
                rowEl.dataset.spacingRowCell = row.cellId || ''; // CHANGE: migrated planting overlay.
                const labelCell = document.createElement('div'); // CHANGE: migrated planting overlay.
                labelCell.style.minWidth = '0'; // CHANGE: migrated planting overlay.
                labelCell.style.display = 'flex'; // CHANGE: migrated planting overlay.
                labelCell.style.flexDirection = 'column'; // CHANGE: migrated planting overlay.
                labelCell.style.lineHeight = '12px'; // CHANGE: migrated planting overlay.
                const label = makeTextSpan(row.label || row.cellId || 'Planting', enabled ? null : '#9aa0a6'); // CHANGE: migrated planting overlay.
                label.style.fontWeight = row.selected ? '700' : '400'; // CHANGE: migrated planting overlay.
                labelCell.appendChild(label); // CHANGE: migrated planting overlay.
                if (!enabled) { // CHANGE: migrated planting overlay.
                    const marker = document.createElement('span'); // CHANGE: migrated planting overlay.
                    marker.textContent = 'Inactive'; // CHANGE: migrated planting overlay.
                    marker.style.fontSize = '9px'; // CHANGE: migrated planting overlay.
                    marker.style.color = '#9aa0a6'; // CHANGE: migrated planting overlay.
                    marker.style.whiteSpace = 'nowrap'; // CHANGE: migrated planting overlay.
                    marker.style.lineHeight = '10px'; // CHANGE: migrated planting overlay.
                    labelCell.appendChild(marker); // CHANGE: disabled rows are explicitly outside the active occupancy window.
                } // CHANGE: migrated planting overlay.
                rowEl.appendChild(labelCell); // CHANGE: migrated planting overlay.

                const spacingX = spacingNumberInput(displayRow.spacingXCm, enabled); // CHANGE: migrated planting overlay.
                const spacingY = spacingNumberInput(displayRow.spacingYCm, enabled); // CHANGE: migrated planting overlay.
                const offsetX = spacingNumberInput(displayRow.offsetXCm, enabled); // CHANGE: migrated planting overlay.
                const offsetY = spacingNumberInput(displayRow.offsetYCm, enabled); // CHANGE: migrated planting overlay.
                const overhang = spacingNumberInput(displayRow.allowedOverhangPct == null ? 30 : displayRow.allowedOverhangPct, enabled); // CHANGE
                overhang.min = '0'; overhang.max = '50'; overhang.step = 'any'; overhang.setAttribute('aria-label', (row.label || 'Planting') + ' Allowed overhang (%)'); // CHANGE
                overhang.title = 'Percentage of circle diameter allowed beyond each bed edge. Apply/Create also saves the crop default.'; // CHANGE
                setSpacingOffsetValue(offsetX, displayRow.offsetXCm); setSpacingOffsetValue(offsetY, displayRow.offsetYCm); // CHANGE: all shared Spacing editors round only offset displays.
                [spacingX, spacingY, offsetX, offsetY].forEach((input, index) => input.setAttribute('aria-label', (row.label || 'Planting') + ' ' + ['Spacing X (cm)', 'Spacing Y (cm)', 'Offset X (cm)', 'Offset Y (cm)'][index])); // CHANGE: numeric fields remain identifiable in either overlay host.
                [spacingX, spacingY, offsetX, offsetY].forEach(input => rowEl.appendChild(input)); // CHANGE: migrated planting overlay.
                rowEl.appendChild(overhang); // CHANGE

                const revert = document.createElement('button'); // CHANGE: migrated planting overlay.
                revert.type = 'button'; // CHANGE: migrated planting overlay.
                revert.textContent = '↺'; // CHANGE: use a revert symbol instead of Reset text.
                revert.setAttribute('aria-label', 'Restore plant defaults'); // CHANGE: row reset targets the plant-table defaults.
                revert.title = 'Restore plant defaults'; // CHANGE: distinguish plant defaults from companion-set defaults.
                revert.style.fontSize = '12px'; // CHANGE: migrated planting overlay.
                revert.style.lineHeight = '14px'; // CHANGE: migrated planting overlay.
                revert.style.visibility = 'hidden'; // CHANGE: reserve the grid slot without exposing inactive actions.
                revert.style.pointerEvents = 'none'; // CHANGE: migrated planting overlay.
                revert.disabled = !enabled; // CHANGE: migrated planting overlay.
                applyPlantingOverlayButtonStyle(revert, 'neutral', { compact: true }); // CHANGE: migrated planting overlay.
                revert.style.width = '100%'; // CHANGE: revert column stays fixed and aligned.
                revert.style.minWidth = '0'; // CHANGE: migrated planting overlay.
                revert.style.padding = '2px 0'; // CHANGE: override shared compact padding to fit the icon column.
                rowEl.appendChild(revert); // CHANGE: migrated planting overlay.

                const state = { row, spacingX, spacingY, offsetX, offsetY, overhang, overhangEdited: !!displayRow.overhangEdited, revert }; // CHANGE
                rowStates.push(state); // CHANGE: migrated planting overlay.
                rowsWrap.appendChild(rowEl); // CHANGE: migrated planting overlay.
            }); // CHANGE: migrated planting overlay.
            wrap.appendChild(rowsWrap); // CHANGE: migrated planting overlay.

            const defaultLabel = document.createElement('label'); // CHANGE: migrated planting overlay.
            defaultLabel.style.display = 'none'; // CHANGE: migrated planting overlay.
            defaultLabel.style.alignItems = 'center'; // CHANGE: migrated planting overlay.
            defaultLabel.style.gap = '6px'; // CHANGE: migrated planting overlay.
            defaultLabel.style.fontSize = '10px'; // CHANGE: migrated planting overlay.
            defaultLabel.style.color = '#3c4043'; // CHANGE: migrated planting overlay.
            const saveDefaults = document.createElement('input'); // CHANGE: migrated planting overlay.
            saveDefaults.type = 'checkbox'; // CHANGE: migrated planting overlay.
            defaultLabel.appendChild(saveDefaults); // CHANGE: migrated planting overlay.
            defaultLabel.appendChild(document.createTextNode(options.live ? 'Save as default' : 'Save as companion default')); // CHANGE: allocation defaults are explicit and deferred until Create.
            saveDefaults.checked = !!options.saveDefaults; // CHANGE: preserve opt-in across allocation view switches.
            if (options.fitToDemand) defaultLabel.title = 'Save X/Y spacing as the plant default after Create. Offsets apply to this allocation.'; // CHANGE: single-plant default storage supports spacing; companion-set storage also supports offsets.
            wrap.appendChild(defaultLabel); // CHANGE: migrated planting overlay.

            const status = document.createElement('div'); // CHANGE: migrated planting overlay.
            if (options.live) status.style.whiteSpace = 'pre-line'; // CHANGE: count and coverage changes for affected crops remain readable on separate lines.
            status.style.minHeight = '14px'; // CHANGE: migrated planting overlay.
            status.style.color = '#92400e'; // CHANGE: migrated planting overlay.
            status.style.fontSize = '10px'; // CHANGE: migrated planting overlay.
            status.style.fontWeight = '700'; // CHANGE: migrated planting overlay.
            wrap.appendChild(status); // CHANGE: migrated planting overlay.
            const idleStatus = spacingIdleStatus(context.rows || []); // CHANGE: migrated planting overlay.
            status.textContent = idleStatus; // CHANGE: clarify inactive rows before edits begin.

            const actions = document.createElement('div'); // CHANGE: migrated planting overlay.
            actions.style.display = 'flex'; // CHANGE: migrated planting overlay.
            actions.style.gap = '6px'; // CHANGE: migrated planting overlay.
            actions.style.justifyContent = 'flex-end'; // CHANGE: migrated planting overlay.
            const applySetDefault = document.createElement('button'); // CHANGE: migrated planting overlay.
            applySetDefault.type = 'button'; // CHANGE: migrated planting overlay.
            applySetDefault.textContent = 'Apply set default'; // CHANGE: migrated planting overlay.
            applySetDefault.title = 'Restore the saved companion-set spacing defaults for active rows.'; // CHANGE
            applySetDefault.style.display = context.hasSetDefault ? '' : 'none'; // CHANGE: migrated planting overlay.
            applyPlantingOverlayButtonStyle(applySetDefault, 'neutral', { compact: true }); // CHANGE: migrated planting overlay.
            actions.appendChild(applySetDefault); // CHANGE: set defaults can be restored explicitly without editing a row first.
            const apply = document.createElement('button'); // CHANGE: migrated planting overlay.
            apply.type = 'button'; // CHANGE: migrated planting overlay.
            apply.textContent = 'Apply'; // CHANGE: migrated planting overlay.
            apply.disabled = true; // CHANGE: migrated planting overlay.
            applyPlantingOverlayButtonStyle(apply, 'add', { compact: true }); // CHANGE: migrated planting overlay.
            actions.appendChild(apply); // CHANGE: migrated planting overlay.
            if (options.live) apply.style.display = 'none'; // CHANGE: allocation edits update the draft, never apply graph mutations.
            wrap.appendChild(actions); // CHANGE: migrated planting overlay.
            body.appendChild(wrap); // CHANGE: migrated planting overlay.

            function refreshDraftState() { // CHANGE: migrated planting overlay.
                const changed = rowStates.filter(state => state.row.enabled !== false && spacingRowChanged(state)); // CHANGE: migrated planting overlay.
                writeStoredSpacingDrafts(entry, rowStates); // CHANGE: migrated planting overlay.
                rowStates.forEach(state => { // CHANGE: migrated planting overlay.
                    const showRevert = state.row.enabled !== false && spacingRowChanged(state); // CHANGE: migrated planting overlay.
                    state.revert.style.visibility = showRevert ? 'visible' : 'hidden'; // CHANGE: keep row layout stable while toggling the revert affordance.
                    state.revert.style.pointerEvents = showRevert ? 'auto' : 'none'; // CHANGE: hidden revert controls are not interactive.
                }); // CHANGE: migrated planting overlay.
                defaultLabel.style.display = changed.length || targets.length ? 'flex' : 'none'; // CHANGE
                const draft = spacingDraftFromRowStates(rowStates); // CHANGE: migrated planting overlay.
                const validation = tools.validateSpacingDraft(draft); // CHANGE: migrated planting overlay.
                apply.disabled = (!changed.length && !options.proposed) || !validation.ok || (options.isCurrent && !options.isCurrent()); // CHANGE
                apply.title = !changed.length ? 'Change an active row\'s spacing or offset before applying.' : !validation.ok ? validation.errors.join(' ') : 'Apply the spacing and offsets to the changed active plantings.'; // CHANGE
                status.textContent = validation.ok ? idleStatus : validation.errors.join(' '); // CHANGE: preserve active-window explanation while editing.
                if (options.live && options.fitToDemand) { // CHANGE: Allocate owns resizing, count, coverage, and canvas drawing.
                    defaultLabel.style.display = 'flex'; // CHANGE
                    options.onChange?.(draft, null, validation.ok, { saveDefaults: saveDefaults.checked }); // CHANGE
                    return; // CHANGE
                } // CHANGE
                if ((!changed.length && !options.proposed) || !validation.ok) { // CHANGE
                    if (!options.live) clearSpacingPreview(); options.onChange?.(draft, null, false, { saveDefaults: saveDefaults.checked }); // CHANGE
                    return; // CHANGE: migrated planting overlay.
                } // CHANGE: migrated planting overlay.
                const changedCellIds = new Set(changed.map(state => String(state.row.cellId || ''))); // CHANGE: migrated planting overlay.
                const bedScopedPreview = context && context.scope === 'bed' && draft.some(row => row.bedId); // CHANGE: bed spacing previews replace the whole rotated bed unit.
                const previewRows = draft.map(row => { // CHANGE: migrated planting overlay.
                    const isChanged = changedCellIds.has(String(row.cellId || '')) || !!options.proposed && row.enabled !== false; // CHANGE
                    const includeBedContext = !!(bedScopedPreview && row.bedId); // CHANGE: migrated planting overlay.
                    return Object.assign({}, row, { // CHANGE: migrated planting overlay.
                        enabled: isChanged, // CHANGE: migrated planting overlay.
                        previewOnly: includeBedContext && !isChanged, // CHANGE: migrated planting overlay.
                        previewUnrotated: includeBedContext // CHANGE: migrated planting overlay.
                    }); // CHANGE: migrated planting overlay.
                }); // CHANGE: migrated planting overlay.
                const preview = tools.buildSpacingPreviewModel(graph, previewRows); // CHANGE: pass graph so scheduler can use the read-only tiler preview API.
                if (preview && preview.status === 'invalid') { // CHANGE: migrated planting overlay.
                    apply.disabled = true; // CHANGE: zero in-bounds plant drafts cannot be applied.
                    apply.title = preview.warning || 'No plants remain inside the planting area.'; // CHANGE
                    if (!options.live) clearSpacingPreview(); // CHANGE: allocation preview belongs to Allocate.
                    status.textContent = preview.warning || 'No plants remain inside the planting area.'; // CHANGE: migrated planting overlay.
                    options.onChange?.(draft, preview, false, { saveDefaults: saveDefaults.checked }); return; // CHANGE
                } // CHANGE: migrated planting overlay.
                if (!options.live) renderSpacingPreview(preview); // CHANGE: allocation uses its owner-scoped renderer.
                if (preview.warning) status.textContent = preview.warning; // CHANGE: migrated planting overlay.
                options.onChange?.(draft, preview, !apply.disabled, { saveDefaults: saveDefaults.checked }); // CHANGE
            } // CHANGE: migrated planting overlay.

            rowStates.forEach(state => { // CHANGE: migrated planting overlay.
                [state.spacingX, state.spacingY, state.offsetX, state.offsetY, state.overhang].filter(Boolean).forEach(control => { // CHANGE
                    const edit = event => { // CHANGE
                        if (control === state.overhang) synchronizeCropOverhang(state); // CHANGE
                        if (control === state.offsetX || control === state.offsetY) readSpacingOffsetValue(control, event.type === 'input'); // CHANGE: typing zero over a rounded zero is an edit; unchanged change events retain precision.
                        refreshPatternSource(); refreshDraftState(); refreshPatterns(); // CHANGE
                    }; // CHANGE
                    control.addEventListener('input', edit); control.addEventListener('change', edit); // CHANGE
                }); // CHANGE: migrated planting overlay.
                [state.offsetX, state.offsetY].forEach(control => control.addEventListener('blur', () => { // CHANGE
                    const exact = readSpacingOffsetValue(control); // CHANGE
                    if (exact.trim() !== '' && Number.isFinite(Number(exact))) setSpacingOffsetValue(control, exact); // CHANGE: format valid offsets only; incomplete browser input remains visible and invalid.
                })); // CHANGE
                state.revert.addEventListener('click', function (evt) { // CHANGE: migrated planting overlay.
                    consumeOverlayControlEvent(evt); // CHANGE: migrated planting overlay.
                    revertSpacingRowState(state); refreshPatternSource(); // CHANGE
                    synchronizeCropOverhang(state); // CHANGE: restoring crop defaults updates matching active drafts too.
                    refreshDraftState(); // CHANGE: migrated planting overlay.
                }); // CHANGE: migrated planting overlay.
            }); // CHANGE: migrated planting overlay.
            /** Same-crop active drafts share one explicit default edit; inactive plantings are untouched. */ // CHANGE
            function synchronizeCropOverhang(source) { // CHANGE
                rowStates.forEach(state => { // CHANGE
                    if (state.row.enabled === false || state !== source && (source.row.plantId == null || String(state.row.plantId) !== String(source.row.plantId))) return; // CHANGE
                    state.overhang.value = source.overhang.value; state.overhangEdited = true; // CHANGE
                }); // CHANGE
            } // CHANGE
            saveDefaults.addEventListener('change', refreshDraftState); // CHANGE: allocation's opt-in remains in memory until creation succeeds.

            /** Regenerate only the selected pair; unrelated bed rows remain unchanged. */ // CHANGE
            function pairRows() { // CHANGE
                const draft = spacingDraftFromRowStates(rowStates); // CHANGE
                const source = draft.find(row => row.cellId === String(context.selectedId)) || draft.find(row => row.selected); // CHANGE
                const target = draft.find(row => row.cellId === targetSelect.value); // CHANGE
                return source && target ? [source, target] : []; // CHANGE
            } // CHANGE
            /** A manual edit is Custom only while the chosen pair differs from both generated layouts. */ // CHANGE
            function refreshPatternSource() { // CHANGE
                patternSource.textContent = 'Custom'; // CHANGE
                const rows = pairRows(), fields = ['spacingXCm', 'spacingYCm', 'offsetXCm', 'offsetYCm']; // CHANGE
                if (rows.length !== 2) return; // CHANGE
                for (const pattern of ['aligned', 'staggered']) { // CHANGE
                    try { // CHANGE
                        const generated = tools.generateCompanionPairLayout(graph, rows, pattern); // CHANGE
                        const matches = rows.every((row, index) => fields.every(field => Math.abs(Number(row[field]) - Number(generated[index][field])) < 1e-7) && // CHANGE
                            ['x', 'y', 'width', 'height'].every(field => Math.abs(Number(row.rect[field]) - Number(generated[index].rect[field])) < 1e-7) && // CHANGE
                            Math.abs(Number(row.rotationDeg || 0) - Number(generated[index].rotationDeg || 0)) < 1e-7); // CHANGE
                        if (matches) { patternSource.textContent = pattern === 'aligned' ? 'Aligned' : 'Staggered'; return; } // CHANGE
                    } catch (_) { /* An impossible generated pattern cannot describe the edited layout. */ } // CHANGE
                } // CHANGE
            } // CHANGE
            function refreshPatterns() { // CHANGE
                entry.pairTargetId = targetSelect.value; // CHANGE
                patternButtons.forEach((button, index) => { // CHANGE
                    try { if (pairRows().length !== 2) throw new Error('Choose a companion planting.'); tools.generateCompanionPairLayout(graph, pairRows(), index ? 'staggered' : 'aligned'); button.disabled = false; button.title = 'Preview ' + button.textContent.toLowerCase() + ' touching rows.'; } // CHANGE
                    catch (error) { button.disabled = true; button.title = error.message; } // CHANGE
                }); // CHANGE
            } // CHANGE
            targetSelect.addEventListener('change', refreshPatterns); // CHANGE
            patternButtons.forEach((button, index) => button.addEventListener('click', evt => { // CHANGE
                consumeOverlayControlEvent(evt); // CHANGE
                try { // CHANGE
                    const generated = tools.generateCompanionPairLayout(graph, pairRows(), index ? 'staggered' : 'aligned'); // CHANGE
                    generated.forEach(row => { const state = rowStates.find(item => item.row.cellId === row.cellId); // CHANGE
                        state.row = Object.assign({}, state.row, { rect: row.rect, modelRect: row.modelRect, rotationDeg: row.rotationDeg, vegDiameterCm: row.vegDiameterCm, clipBounds: row.clipBounds, resetDisabled: true, generatedPattern: row.generatedPattern, strictFootprint: false }); // CHANGE
                        state.spacingX.value = String(row.spacingXCm); state.spacingY.value = String(row.spacingYCm); // CHANGE
                        setSpacingOffsetValue(state.offsetX, row.offsetXCm); setSpacingOffsetValue(state.offsetY, row.offsetYCm); // CHANGE: generated tangency offsets retain full precision.
                    }); // CHANGE
                    patternSource.textContent = button.textContent; refreshDraftState(); refreshPatterns(); // CHANGE
                } catch (error) { status.textContent = error.message; } // CHANGE
            })); // CHANGE
            refreshPatterns(); // CHANGE
            apply.textContent = options.applyLabel || 'Apply'; // CHANGE
            apply.addEventListener('click', async function (evt) { // CHANGE: migrated planting overlay.
                consumeOverlayControlEvent(evt); // CHANGE: migrated planting overlay.
                if (apply.disabled || options.live) return; // CHANGE: a hidden allocation action cannot mutate saved plantings.
                try { // CHANGE: migrated planting overlay.
                    const allRows = spacingDraftFromRowStates(rowStates); // CHANGE
                    const changedRows = allRows.filter(row => row.enabled !== false && (options.proposed || spacingRowChanged(rowStates.find(state => state.row.cellId === row.cellId)))); // CHANGE
                    if (options.onApply) await options.onApply(allRows, { saveDefaults: saveDefaults.checked }); // CHANGE
                    else { // CHANGE
                        await tools.applySpacingDraft(graph, changedRows, { saveDefaults: false }); // CHANGE
                        if (saveDefaults.checked) await tools.saveSpacingDefaultsForRows(pairRows().length === 2 ? pairRows() : changedRows, graph, model); // CHANGE
                    } // CHANGE
                    clearStoredSpacingDrafts(entry); // CHANGE: migrated planting overlay.
                    clearSpacingPreview(); // CHANGE: migrated planting overlay.
                    status.textContent = 'Spacing applied.'; // CHANGE: migrated planting overlay.
                    if (!options.onApply) setTimeout(refresh, 0); // CHANGE
                } catch (e) { // CHANGE: migrated planting overlay.
                    status.textContent = e && e.message ? e.message : String(e); // CHANGE: migrated planting overlay.
                } // CHANGE: migrated planting overlay.
            }); // CHANGE: migrated planting overlay.
            applySetDefault.addEventListener('click', async function (evt) { // CHANGE: migrated planting overlay.
                consumeOverlayControlEvent(evt); // CHANGE: migrated planting overlay.
                if (!context.hasSetDefault || !tools || typeof tools.applySetDefault !== 'function') return; // CHANGE: migrated planting overlay.
                try { // CHANGE: migrated planting overlay.
                    rowStates.forEach(state => { // CHANGE
                        const layout = tools.setDefaultRowForSpacingRow(context.setDefault, state.row); // CHANGE
                        if (!layout || state.row.enabled === false) return; // CHANGE
                        state.spacingX.value = String(layout.spacingXCm); state.spacingY.value = String(layout.spacingYCm); // CHANGE
                        setSpacingOffsetValue(state.offsetX, layout.offsetXCm); setSpacingOffsetValue(state.offsetY, layout.offsetYCm); // CHANGE: saved defaults are exact even when their displays round to zero.
                    }); // CHANGE
                    patternSource.textContent = 'Saved layout'; refreshDraftState(); // CHANGE
                } catch (e) { // CHANGE: migrated planting overlay.
                    status.textContent = e && e.message ? e.message : String(e); // CHANGE: migrated planting overlay.
                } // CHANGE: migrated planting overlay.
            }); // CHANGE: migrated planting overlay.
            refreshDraftState(); // CHANGE: preserve and redraw valid spacing drafts across view refreshes.
            return { setStatus: message => { status.textContent = message || ''; } }; // CHANGE: live fitting updates feedback without replacing inputs or focus.
        } // CHANGE: migrated planting overlay.

        function renderSpacingView(entry, body) { // CHANGE: migrated planting overlay.
            clearSpacingPreview(); // CHANGE: migrated planting overlay.
            const tools = getLayoutTools(); // CHANGE: migrated planting overlay.
            if (!tools || typeof tools.buildSpacingLayoutRows !== 'function') { // CHANGE: migrated planting overlay.
                const empty = document.createElement('div'); // CHANGE: migrated planting overlay.
                empty.textContent = 'Spacing tools are unavailable.'; // CHANGE: migrated planting overlay.
                empty.style.color = '#5f6368'; // CHANGE: migrated planting overlay.
                empty.style.padding = '8px 0'; // CHANGE: migrated planting overlay.
                body.appendChild(empty); // CHANGE: migrated planting overlay.
                return; // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.
            const source = entry && entry.sourceId ? model.getCell(entry.sourceId) : null; // CHANGE: migrated planting overlay.
            const token = (entry.spacingRenderToken || 0) + 1; // CHANGE: migrated planting overlay.
            entry.spacingRenderToken = token; // CHANGE: migrated planting overlay.
            const loading = document.createElement('div'); // CHANGE: migrated planting overlay.
            loading.textContent = 'Loading spacing...'; // CHANGE: migrated planting overlay.
            loading.style.color = '#5f6368'; // CHANGE: migrated planting overlay.
            loading.style.padding = '8px 0'; // CHANGE: migrated planting overlay.
            body.appendChild(loading); // CHANGE: migrated planting overlay.
            Promise.resolve(tools.buildSpacingLayoutRows(graph, source)).then(context => { // CHANGE: migrated planting overlay.
                if (entry.spacingRenderToken !== token || !entry.panel || activeMode !== MODE_SPACING) return; // CHANGE: migrated planting overlay.
                renderSpacingEditor(entry, body, context || { rows: [] }, tools); // CHANGE: migrated planting overlay.
                positionPanel(entry, source); // CHANGE: migrated planting overlay.
            }).catch(e => { // CHANGE: migrated planting overlay.
                if (entry.spacingRenderToken !== token) return; // CHANGE: migrated planting overlay.
                body.innerHTML = ''; // CHANGE: migrated planting overlay.
                const error = document.createElement('div'); // CHANGE: migrated planting overlay.
                error.textContent = e && e.message ? e.message : String(e); // CHANGE: migrated planting overlay.
                error.style.color = '#b91c1c'; // CHANGE: migrated planting overlay.
                error.style.padding = '8px 0'; // CHANGE: migrated planting overlay.
                body.appendChild(error); // CHANGE: migrated planting overlay.
            }); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function todayOverlayDayNumber() { // CHANGE: migrated planting overlay.
            const now = new Date(); // CHANGE: migrated planting overlay.
            return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function firstScheduledCard(cards) { // CHANGE: migrated planting overlay.
            return (cards || []).slice().sort(compareRepeatOccurrenceCards).find(card => !!getTaskDateRange(card)) || (cards && cards[0]) || null; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function buildScheduleRowsForCards(cards) { // CHANGE: migrated planting overlay.
            const rows = []; // CHANGE: migrated planting overlay.
            const repeatRows = new Map(); // CHANGE: migrated planting overlay.

            for (const card of cards || []) { // CHANGE: migrated planting overlay.
                const seriesKey = buildRepeatSeriesKeyForOverlay(card); // CHANGE: migrated planting overlay.
                if (!seriesKey) { // CHANGE: migrated planting overlay.
                    rows.push({ // CHANGE: migrated planting overlay.
                        key: 'card:' + card.id, // CHANGE: migrated planting overlay.
                        card, // CHANGE: migrated planting overlay.
                        cards: [card], // CHANGE: migrated planting overlay.
                        label: taskTitle(card), // CHANGE: migrated planting overlay.
                        repeat: false // CHANGE: migrated planting overlay.
                    }); // CHANGE: migrated planting overlay.
                    continue; // CHANGE: migrated planting overlay.
                } // CHANGE: migrated planting overlay.

                if (!repeatRows.has(seriesKey)) { // CHANGE: migrated planting overlay.
                    repeatRows.set(seriesKey, { // CHANGE: migrated planting overlay.
                        key: 'repeat:' + seriesKey, // CHANGE: migrated planting overlay.
                        card, // CHANGE: migrated planting overlay.
                        cards: [], // CHANGE: migrated planting overlay.
                        label: taskTitle(card), // CHANGE: migrated planting overlay.
                        repeat: true // CHANGE: migrated planting overlay.
                    }); // CHANGE: migrated planting overlay.
                } // CHANGE: migrated planting overlay.
                repeatRows.get(seriesKey).cards.push(card); // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.

            for (const row of repeatRows.values()) { // CHANGE: migrated planting overlay.
                row.cards.sort(compareRepeatOccurrenceCards); // CHANGE: migrated planting overlay.
                row.card = firstScheduledCard(row.cards) || row.cards[0]; // CHANGE: migrated planting overlay.
                row.label = taskTitle(row.card); // CHANGE: migrated planting overlay.
                rows.push(row); // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.

            rows.sort((a, b) => compareTaskCardsByStartDate(a.card, b.card)); // CHANGE: migrated planting overlay.
            return rows; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function createLaneHeader(entry, group, collapsed) { // CHANGE: migrated planting overlay.
            const header = document.createElement('div'); // CHANGE: migrated planting overlay.
            header.style.display = 'grid'; // CHANGE: migrated planting overlay.
            header.style.gridTemplateColumns = '21px 6px 1fr auto'; // CHANGE: migrated planting overlay.
            header.style.alignItems = 'center'; // CHANGE: migrated planting overlay.
            header.style.columnGap = '6px'; // CHANGE: migrated planting overlay.
            header.style.margin = '8px 0 3px'; // CHANGE: migrated planting overlay.
            header.style.color = '#3c4043'; // CHANGE: migrated planting overlay.
            header.style.fontWeight = 'bold'; // CHANGE: migrated planting overlay.
            header.style.fontSize = '10px'; // CHANGE: migrated planting overlay.
            header.style.cursor = 'pointer'; // CHANGE: visible toggle replaces browser title tooltip

            const toggle = document.createElement('span'); // CHANGE: migrated planting overlay.
            toggle.textContent = collapsed ? '+' : '-'; // CHANGE: migrated planting overlay.
            toggle.style.display = 'inline-block'; // CHANGE: migrated planting overlay.
            toggle.style.width = '21px'; // CHANGE: migrated planting overlay.
            toggle.style.textAlign = 'center'; // CHANGE: migrated planting overlay.
            toggle.style.color = '#5f6368'; // CHANGE: migrated planting overlay.
            toggle.style.fontSize = '15px'; // CHANGE: migrated planting overlay.
            toggle.style.lineHeight = '14px'; // CHANGE: migrated planting overlay.
            header.appendChild(toggle); // CHANGE: migrated planting overlay.

            const stripe = document.createElement('span'); // CHANGE: migrated planting overlay.
            stripe.style.height = '12px'; // CHANGE: migrated planting overlay.
            stripe.style.borderRadius = '4px'; // CHANGE: migrated planting overlay.
            stripe.style.background = group.color || '#9aa0a6'; // CHANGE: migrated planting overlay.
            header.appendChild(stripe); // CHANGE: migrated planting overlay.

            header.appendChild(makeTextSpan(group.label || 'Lane', null)); // CHANGE: migrated planting overlay.
            const count = document.createElement('span'); // CHANGE: migrated planting overlay.
            count.textContent = String(group.items.length); // CHANGE: migrated planting overlay.
            count.style.color = '#5f6368'; // CHANGE: migrated planting overlay.
            count.style.fontWeight = 'normal'; // CHANGE: migrated planting overlay.
            header.appendChild(count); // CHANGE: migrated planting overlay.
            mxEvent.addListener(header, 'mousedown', function (evt) { // CHANGE: migrated planting overlay.
                if (evt.button != null && evt.button !== 0) return; // CHANGE: migrated planting overlay.
                setLaneGroupCollapsed(group, !isLaneGroupCollapsed(group)); // CHANGE: migrated planting overlay.
                renderEntry(entry); // CHANGE: migrated planting overlay.
                mxEvent.consume(evt); // CHANGE: migrated planting overlay.
                if (evt.stopPropagation) evt.stopPropagation(); // CHANGE: migrated planting overlay.
                if (evt.preventDefault) evt.preventDefault(); // CHANGE: migrated planting overlay.
            }); // CHANGE: migrated planting overlay.
            return header; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function renderCardView(entry, body, groups) { // CHANGE: migrated planting overlay.
            for (const group of groups) { // CHANGE: migrated planting overlay.
                const collapsed = isLaneGroupCollapsed(group); // CHANGE: migrated planting overlay.
                body.appendChild(createLaneHeader(entry, group, collapsed)); // CHANGE: migrated planting overlay.
                if (collapsed) continue; // CHANGE: migrated planting overlay.
                for (const item of group.items) { // CHANGE: migrated planting overlay.
                    const card = item.card; // CHANGE: migrated planting overlay.
                const row = makeClickableRow(card, 'manual-link-task-schedule-card'); // CHANGE: migrated planting overlay.
                row.style.display = 'grid'; // CHANGE: migrated planting overlay.
                row.style.gridTemplateColumns = '6px 1fr'; // CHANGE: migrated planting overlay.
                row.style.columnGap = '8px'; // CHANGE: migrated planting overlay.
                row.style.margin = '4px 0'; // CHANGE: migrated planting overlay.
                row.style.border = '1px solid rgba(60, 64, 67, 0.18)'; // CHANGE: migrated planting overlay.
                row.style.borderRadius = '5px'; // CHANGE: migrated planting overlay.
                row.style.background = '#ffffff'; // CHANGE: migrated planting overlay.
                row.style.cursor = 'pointer'; // CHANGE: migrated planting overlay.
                row.style.overflow = 'hidden'; // CHANGE: migrated planting overlay.

                const stripe = document.createElement('div'); // CHANGE: migrated planting overlay.
                stripe.style.background = getTaskLaneColor(card); // CHANGE: migrated planting overlay.
                row.appendChild(stripe); // CHANGE: migrated planting overlay.

                const content = document.createElement('div'); // CHANGE: migrated planting overlay.
                content.style.minWidth = '0'; // CHANGE: migrated planting overlay.
                content.style.padding = '6px 7px 6px 0'; // CHANGE: migrated planting overlay.

                const titleLine = makeTextSpan(taskTitle(card), null); // CHANGE: migrated planting overlay.
                titleLine.style.display = 'block'; // CHANGE: migrated planting overlay.
                titleLine.style.fontWeight = 'bold'; // CHANGE: migrated planting overlay.
                titleLine.style.fontSize = '12px'; // CHANGE: migrated planting overlay.
                content.appendChild(titleLine); // CHANGE: migrated planting overlay.

                const metaLine = makeTextSpan(formatTaskDateRange(card), '#5f6368'); // CHANGE: migrated planting overlay.
                metaLine.style.display = 'block'; // CHANGE: migrated planting overlay.
                metaLine.style.fontSize = '10px'; // CHANGE: migrated planting overlay.
                content.appendChild(metaLine); // CHANGE: migrated planting overlay.

                    let badges = getTaskOverlayBadges(card); // CHANGE: migrated planting overlay.
                    const linkLabelBadge = getTaskLinkLabelBadge(entry, card); // CHANGE: migrated planting overlay.
                    if (linkLabelBadge) badges.unshift(linkLabelBadge); // CHANGE: migrated planting overlay.
                    if (item.repeatBadge) { // CHANGE: migrated planting overlay.
                        badges = badges.filter(text => !String(text || '').startsWith('Repeat ')); // CHANGE: migrated planting overlay.
                        badges.unshift('Repeat ' + item.repeatBadge); // CHANGE: migrated planting overlay.
                    } // CHANGE: migrated planting overlay.
                    const visibleBadges = badges.slice(0, 4); // CHANGE: migrated planting overlay.
                    if (visibleBadges.length) { // CHANGE: migrated planting overlay.
                    const badgeRow = document.createElement('div'); // CHANGE: migrated planting overlay.
                    badgeRow.style.display = 'flex'; // CHANGE: migrated planting overlay.
                    badgeRow.style.flexWrap = 'wrap'; // CHANGE: migrated planting overlay.
                    badgeRow.style.gap = '3px'; // CHANGE: migrated planting overlay.
                    badgeRow.style.marginTop = '4px'; // CHANGE: migrated planting overlay.
                        for (const badge of visibleBadges) badgeRow.appendChild(makeBadge(badge)); // CHANGE: migrated planting overlay.
                    content.appendChild(badgeRow); // CHANGE: migrated planting overlay.
                } // CHANGE: migrated planting overlay.

                row.appendChild(content); // CHANGE: migrated planting overlay.
                body.appendChild(row); // CHANGE: migrated planting overlay.
                entry.visibleItems.push({ cardId: card.id, row }); // CHANGE: migrated planting overlay.
                } // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function axisLabelForDay(dayNumber) { // CHANGE: migrated planting overlay.
            const date = new Date(dayNumber * 86400000); // CHANGE: migrated planting overlay.
            return formatTaskOverlayDate({ date }); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function renderScheduleAxis(grid, minDay, maxDay, todayPct, leftHeaderText = 'Task') { // CHANGE: migrated planting overlay.
            const axis = document.createElement('div'); // CHANGE: migrated planting overlay.
            axis.style.display = 'grid'; // CHANGE: migrated planting overlay.
            axis.style.gridTemplateColumns = '112px 1fr'; // CHANGE: migrated planting overlay.
            axis.style.columnGap = '8px'; // CHANGE: migrated planting overlay.
            axis.style.alignItems = 'end'; // CHANGE: migrated planting overlay.
            axis.style.marginBottom = '4px'; // CHANGE: migrated planting overlay.

            const taskHead = document.createElement('div'); // CHANGE: migrated planting overlay.
            taskHead.textContent = leftHeaderText; // CHANGE: migrated planting overlay.
            taskHead.style.color = '#5f6368'; // CHANGE: migrated planting overlay.
            taskHead.style.fontSize = '10px'; // CHANGE: migrated planting overlay.
            axis.appendChild(taskHead); // CHANGE: migrated planting overlay.

            const ticks = document.createElement('div'); // CHANGE: migrated planting overlay.
            ticks.style.display = 'grid'; // CHANGE: migrated planting overlay.
            ticks.style.gridTemplateColumns = 'repeat(4, 1fr)'; // CHANGE: migrated planting overlay.
            ticks.style.color = '#5f6368'; // CHANGE: migrated planting overlay.
            ticks.style.fontSize = '10px'; // CHANGE: migrated planting overlay.
            ticks.style.position = 'relative'; // CHANGE: migrated planting overlay.
            ticks.appendChild(makeTextSpan(axisLabelForDay(minDay), null)); // CHANGE: migrated planting overlay.
            ticks.appendChild(makeTextSpan(axisLabelForDay(Math.round(minDay + (maxDay - minDay) / 3)), null)); // CHANGE: migrated planting overlay.
            ticks.appendChild(makeTextSpan(axisLabelForDay(Math.round(minDay + 2 * (maxDay - minDay) / 3)), null)); // CHANGE: migrated planting overlay.
            const end = makeTextSpan(axisLabelForDay(maxDay), null); // CHANGE: migrated planting overlay.
            end.style.textAlign = 'right'; // CHANGE: migrated planting overlay.
            ticks.appendChild(end); // CHANGE: migrated planting overlay.
            if (todayPct != null) { // CHANGE: migrated planting overlay.
                const today = document.createElement('span'); // CHANGE: migrated planting overlay.
                today.textContent = 'Today'; // CHANGE: migrated planting overlay.
                today.style.position = 'absolute'; // CHANGE: migrated planting overlay.
                today.style.left = todayPct + '%'; // CHANGE: migrated planting overlay.
                today.style.top = '-12px'; // CHANGE: migrated planting overlay.
                today.style.transform = 'translateX(-50%)'; // CHANGE: migrated planting overlay.
                today.style.color = '#1d4ed8'; // CHANGE: today marker label uses neutral blue instead of error red.
                today.style.fontWeight = 'bold'; // CHANGE: migrated planting overlay.
                ticks.appendChild(today); // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.
            axis.appendChild(ticks); // CHANGE: migrated planting overlay.
            grid.appendChild(axis); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function renderScheduleBar(track, card, range, minDay, totalDays) { // CHANGE: migrated planting overlay.
            const bar = document.createElement('div'); // CHANGE: migrated planting overlay.
            const leftPct = Math.max(0, Math.min(98, ((range.startDay - minDay) / totalDays) * 100)); // CHANGE: migrated planting overlay.
            const rawWidthPct = range.startDay === range.endDay ? 2 : ((range.endDay - range.startDay + 1) / totalDays) * 100; // CHANGE: migrated planting overlay.
            const widthPct = Math.max(range.startDay === range.endDay ? 2 : 3, rawWidthPct); // CHANGE: migrated planting overlay.
            bar.style.position = 'absolute'; // CHANGE: migrated planting overlay.
            bar.style.left = leftPct + '%'; // CHANGE: migrated planting overlay.
            bar.style.top = '5px'; // CHANGE: migrated planting overlay.
            bar.style.width = Math.min(100 - leftPct, widthPct) + '%'; // CHANGE: migrated planting overlay.
            bar.style.height = range.startDay === range.endDay ? '8px' : '9px'; // CHANGE: migrated planting overlay.
            bar.style.borderRadius = range.startDay === range.endDay ? '999px' : '4px'; // CHANGE: migrated planting overlay.
            bar.style.background = getTaskLaneColor(card); // CHANGE: migrated planting overlay.
            track.appendChild(bar); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function occupancyRangeForItem(item) { // CHANGE: migrated planting overlay.
            const start = parseTaskOverlayDate(item && item.startISO); // CHANGE: migrated planting overlay.
            const end = parseTaskOverlayDate(item && item.endISO); // CHANGE: migrated planting overlay.
            if (!start || !end || end.dayNumber < start.dayNumber) return null; // CHANGE: migrated planting overlay.
            return { start, end, startDay: start.dayNumber, endDay: end.dayNumber, durationDays: end.dayNumber - start.dayNumber + 1 }; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function renderOccupancyBar(track, range, selected, minDay, totalDays) { // CHANGE: migrated planting overlay.
            const bar = document.createElement('div'); // CHANGE: migrated planting overlay.
            const leftPct = Math.max(0, Math.min(98, ((range.startDay - minDay) / totalDays) * 100)); // CHANGE: migrated planting overlay.
            const rawWidthPct = range.startDay === range.endDay ? 2 : ((range.endDay - range.startDay + 1) / totalDays) * 100; // CHANGE: migrated planting overlay.
            const widthPct = Math.max(range.startDay === range.endDay ? 2 : 3, rawWidthPct); // CHANGE: migrated planting overlay.
            bar.style.position = 'absolute'; // CHANGE: migrated planting overlay.
            bar.style.left = leftPct + '%'; // CHANGE: migrated planting overlay.
            bar.style.top = '5px'; // CHANGE: migrated planting overlay.
            bar.style.width = Math.min(100 - leftPct, widthPct) + '%'; // CHANGE: migrated planting overlay.
            bar.style.height = range.startDay === range.endDay ? '8px' : '9px'; // CHANGE: migrated planting overlay.
            bar.style.borderRadius = range.startDay === range.endDay ? '999px' : '4px'; // CHANGE: migrated planting overlay.
            bar.style.background = selected ? '#137333' : '#188038'; // CHANGE: migrated planting overlay.
            bar.style.opacity = selected ? '1' : '0.72'; // CHANGE: migrated planting overlay.
            track.appendChild(bar); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function makeOccupancyRow(entry, item) { // CHANGE: migrated planting overlay.
            const row = document.createElement('div'); // CHANGE: migrated planting overlay.
            row.className = 'manual-link-task-occupancy-row'; // CHANGE: migrated planting overlay.
            row.setAttribute('title', 'Click to select planting group'); // CHANGE: migrated planting overlay.
            mxEvent.addListener(row, 'mousedown', function (evt) { // CHANGE: migrated planting overlay.
                if (evt.button != null && evt.button !== 0) return; // CHANGE: migrated planting overlay.
                const cell = item && item.cellId ? model.getCell(item.cellId) : null; // CHANGE: migrated planting overlay.
                if (cell && model.isVertex(cell)) navigateOverlayCell(cell); // CHANGE: migrated planting overlay.
                mxEvent.consume(evt); // CHANGE: migrated planting overlay.
                if (evt.stopPropagation) evt.stopPropagation(); // CHANGE: migrated planting overlay.
                if (evt.preventDefault) evt.preventDefault(); // CHANGE: migrated planting overlay.
            }); // CHANGE: migrated planting overlay.
            return row; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function occupancyRangesOverlap(left, right) { // CHANGE: migrated planting overlay.
            return !!(left && right && left.startDay <= right.endDay && right.startDay <= left.endDay); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function makeRelationshipBadge(text, color) { // CHANGE: migrated planting overlay.
            const badge = document.createElement('span'); // CHANGE: migrated planting overlay.
            badge.textContent = text; // CHANGE: migrated planting overlay.
            badge.style.display = 'inline-block'; // CHANGE: migrated planting overlay.
            badge.style.marginTop = '2px'; // CHANGE: migrated planting overlay.
            badge.style.marginRight = '4px'; // CHANGE: migrated planting overlay.
            badge.style.padding = '1px 4px'; // CHANGE: migrated planting overlay.
            badge.style.borderRadius = '4px'; // CHANGE: migrated planting overlay.
            badge.style.border = '1px solid ' + color; // CHANGE: migrated planting overlay.
            badge.style.color = color; // CHANGE: migrated planting overlay.
            badge.style.fontSize = '9px'; // CHANGE: migrated planting overlay.
            badge.style.fontWeight = '700'; // CHANGE: migrated planting overlay.
            return badge; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function renderOccupancyRelationshipBadges(entry, labelCell, item, range) { // CHANGE: migrated planting overlay.
            const rel = item && item.relationship; // CHANGE: migrated planting overlay.
            if (!rel || !range) return ''; // CHANGE: migrated planting overlay.
            if (rel.mode === 'turnover') { // CHANGE: migrated planting overlay.
                const gap = rel.gapDays !== '' ? rel.gapDays + 'd gap' : 'turnover'; // CHANGE: migrated planting overlay.
                return 'Turnover relationship: ' + gap + '.'; // CHANGE: only explicit turnover keeps relationship tooltip semantics.
            } // CHANGE: migrated planting overlay.
            return ''; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function renderOccupancyRow(entry, grid, item, range, minDay, totalDays, todayPct) { // CHANGE: migrated planting overlay.
            const selected = item && item.cellId === entry.sourceId; // CHANGE: migrated planting overlay.
            const row = makeOccupancyRow(entry, item); // CHANGE: migrated planting overlay.
            row.style.display = 'grid'; // CHANGE: migrated planting overlay.
            row.style.gridTemplateColumns = '112px 1fr'; // CHANGE: migrated planting overlay.
            row.style.columnGap = '8px'; // CHANGE: migrated planting overlay.
            row.style.alignItems = 'center'; // CHANGE: migrated planting overlay.
            row.style.minHeight = '24px'; // CHANGE: migrated planting overlay.
            row.style.cursor = 'pointer'; // CHANGE: migrated planting overlay.
            row.style.fontWeight = selected ? 'bold' : 'normal'; // CHANGE: migrated planting overlay.

            const labelCell = document.createElement('div'); // CHANGE: migrated planting overlay.
            labelCell.style.minWidth = '0'; // CHANGE: migrated planting overlay.
            const label = makeTextSpan(item.label || item.cellId || 'Planting', null); // CHANGE: migrated planting overlay.
            label.style.fontSize = '10px'; // CHANGE: migrated planting overlay.
            labelCell.appendChild(label); // CHANGE: migrated planting overlay.
            const relationshipTooltip = renderOccupancyRelationshipBadges(entry, labelCell, item, range); // CHANGE: migrated planting overlay.
            if (relationshipTooltip) { // CHANGE: migrated planting overlay.
                row.title = relationshipTooltip; // CHANGE: migrated planting overlay.
                labelCell.title = relationshipTooltip; // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.
            row.appendChild(labelCell); // CHANGE: migrated planting overlay.

            const track = document.createElement('div'); // CHANGE: migrated planting overlay.
            track.style.position = 'relative'; // CHANGE: migrated planting overlay.
            track.style.height = '18px'; // CHANGE: migrated planting overlay.
            track.style.borderBottom = '1px solid #e8eaed'; // CHANGE: migrated planting overlay.
            if (todayPct != null) { // CHANGE: migrated planting overlay.
                const todayLine = document.createElement('div'); // CHANGE: migrated planting overlay.
                todayLine.style.position = 'absolute'; // CHANGE: migrated planting overlay.
                todayLine.style.left = todayPct + '%'; // CHANGE: migrated planting overlay.
                todayLine.style.top = '0'; // CHANGE: migrated planting overlay.
                todayLine.style.bottom = '0'; // CHANGE: migrated planting overlay.
                todayLine.style.width = '1px'; // CHANGE: migrated planting overlay.
                todayLine.style.background = '#2563eb'; // CHANGE: today marker line uses neutral blue instead of error red.
                todayLine.style.opacity = '0.75'; // CHANGE: migrated planting overlay.
                track.appendChild(todayLine); // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.
            renderOccupancyBar(track, range, selected, minDay, totalDays); // CHANGE: migrated planting overlay.
            if (relationshipTooltip) track.title = relationshipTooltip; // CHANGE: migrated planting overlay.
            row.appendChild(track); // CHANGE: migrated planting overlay.
            grid.appendChild(row); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function renderScheduleRow(entry, grid, scheduleRow, minDay, totalDays, todayPct) { // CHANGE: migrated planting overlay.
            const card = scheduleRow.card; // CHANGE: migrated planting overlay.
            const row = makeClickableRow(card, 'manual-link-task-schedule-row'); // CHANGE: migrated planting overlay.
            row.style.display = 'grid'; // CHANGE: migrated planting overlay.
            row.style.gridTemplateColumns = '112px 1fr'; // CHANGE: migrated planting overlay.
            row.style.columnGap = '8px'; // CHANGE: migrated planting overlay.
            row.style.alignItems = 'center'; // CHANGE: migrated planting overlay.
            row.style.minHeight = '24px'; // CHANGE: migrated planting overlay.
            row.style.cursor = 'pointer'; // CHANGE: migrated planting overlay.

            const labelCell = document.createElement('div'); // CHANGE: migrated planting overlay.
            labelCell.style.minWidth = '0'; // CHANGE: migrated planting overlay.
            const label = makeTextSpan(scheduleRow.label, null); // CHANGE: migrated planting overlay.
            label.style.fontSize = '10px'; // CHANGE: migrated planting overlay.
            if (scheduleRow.repeat && scheduleRow.cards.length > 1) { // CHANGE: migrated planting overlay.
                label.textContent = scheduleRow.label + ' (' + scheduleRow.cards.length + ')'; // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.
            labelCell.appendChild(label); // CHANGE: migrated planting overlay.

            const scheduleBadge = getTaskLinkLabelBadge(entry, card); // CHANGE: migrated planting overlay.
            if (scheduleBadge) { // CHANGE: migrated planting overlay.
                const badgeWrap = document.createElement('div'); // CHANGE: migrated planting overlay.
                badgeWrap.style.marginTop = '2px'; // CHANGE: migrated planting overlay.
                badgeWrap.appendChild(makeBadge(scheduleBadge)); // CHANGE: migrated planting overlay.
                labelCell.appendChild(badgeWrap); // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.
            row.appendChild(labelCell); // CHANGE: migrated planting overlay.

            const track = document.createElement('div'); // CHANGE: migrated planting overlay.
            track.style.position = 'relative'; // CHANGE: migrated planting overlay.
            track.style.height = '18px'; // CHANGE: migrated planting overlay.
            track.style.borderBottom = '1px solid #e8eaed'; // CHANGE: migrated planting overlay.
            if (todayPct != null) { // CHANGE: migrated planting overlay.
                const todayLine = document.createElement('div'); // CHANGE: migrated planting overlay.
                todayLine.style.position = 'absolute'; // CHANGE: migrated planting overlay.
                todayLine.style.left = todayPct + '%'; // CHANGE: migrated planting overlay.
                todayLine.style.top = '0'; // CHANGE: migrated planting overlay.
                todayLine.style.bottom = '0'; // CHANGE: migrated planting overlay.
                todayLine.style.width = '1px'; // CHANGE: migrated planting overlay.
                todayLine.style.background = '#2563eb'; // CHANGE: today marker line uses neutral blue instead of error red.
                todayLine.style.opacity = '0.75'; // CHANGE: migrated planting overlay.
                track.appendChild(todayLine); // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.

            for (const occurrenceCard of scheduleRow.cards) { // CHANGE: migrated planting overlay.
                const range = getTaskDateRange(occurrenceCard); // CHANGE: migrated planting overlay.
                if (range) renderScheduleBar(track, occurrenceCard, range, minDay, totalDays); // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.
            row.appendChild(track); // CHANGE: migrated planting overlay.

            grid.appendChild(row); // CHANGE: migrated planting overlay.
            for (const occurrenceCard of scheduleRow.cards) { // CHANGE: migrated planting overlay.
                entry.visibleItems.push({ cardId: occurrenceCard.id, row }); // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function renderUnscheduledSection(entry, body, unscheduledRows) { // CHANGE: migrated planting overlay.
            if (!unscheduledRows.length) return; // CHANGE: migrated planting overlay.
            const section = document.createElement('div'); // CHANGE: migrated planting overlay.
            section.style.marginTop = '8px'; // CHANGE: migrated planting overlay.
            const title = document.createElement('div'); // CHANGE: migrated planting overlay.
            title.textContent = 'Unscheduled'; // CHANGE: migrated planting overlay.
            title.style.fontWeight = 'bold'; // CHANGE: migrated planting overlay.
            title.style.fontSize = '10px'; // CHANGE: migrated planting overlay.
            title.style.color = '#5f6368'; // CHANGE: migrated planting overlay.
            title.style.marginBottom = '3px'; // CHANGE: migrated planting overlay.
            section.appendChild(title); // CHANGE: migrated planting overlay.
            for (const scheduleRow of unscheduledRows) { // CHANGE: migrated planting overlay.
                const card = scheduleRow.card; // CHANGE: migrated planting overlay.
                const row = makeClickableRow(card, 'manual-link-task-schedule-unscheduled'); // CHANGE: migrated planting overlay.
                row.style.display = 'grid'; // CHANGE: migrated planting overlay.
                row.style.gridTemplateColumns = '6px 1fr'; // CHANGE: migrated planting overlay.
                row.style.columnGap = '6px'; // CHANGE: migrated planting overlay.
                row.style.alignItems = 'center'; // CHANGE: migrated planting overlay.
                row.style.minHeight = '22px'; // CHANGE: migrated planting overlay.
                row.style.padding = '2px 0'; // CHANGE: migrated planting overlay.
                row.style.cursor = 'pointer'; // CHANGE: migrated planting overlay.
                const stripe = document.createElement('span'); // CHANGE: migrated planting overlay.
                stripe.style.height = '14px'; // CHANGE: migrated planting overlay.
                stripe.style.borderRadius = '4px'; // CHANGE: migrated planting overlay.
                stripe.style.background = getTaskLaneColor(card); // CHANGE: migrated planting overlay.
                row.appendChild(stripe); // CHANGE: migrated planting overlay.
                const label = scheduleRow.repeat && scheduleRow.cards.length > 1 // CHANGE: migrated planting overlay.
                    ? scheduleRow.label + ' (' + scheduleRow.cards.length + ')' // CHANGE: migrated planting overlay.
                    : scheduleRow.label; // CHANGE: migrated planting overlay.
                const labelWrap = document.createElement('div'); // CHANGE: migrated planting overlay.
                labelWrap.style.minWidth = '0'; // CHANGE: migrated planting overlay.
                labelWrap.appendChild(makeTextSpan(label, '#5f6368')); // CHANGE: migrated planting overlay.
                const linkLabelBadge = getTaskLinkLabelBadge(entry, card); // CHANGE: migrated planting overlay.
                if (linkLabelBadge) { // CHANGE: migrated planting overlay.
                    const badgeLine = document.createElement('div'); // CHANGE: migrated planting overlay.
                    badgeLine.style.marginTop = '2px'; // CHANGE: migrated planting overlay.
                    badgeLine.appendChild(makeBadge(linkLabelBadge)); // CHANGE: migrated planting overlay.
                    labelWrap.appendChild(badgeLine); // CHANGE: migrated planting overlay.
                } // CHANGE: migrated planting overlay.
                row.appendChild(labelWrap); // CHANGE: migrated planting overlay.
                section.appendChild(row); // CHANGE: migrated planting overlay.
                for (const occurrenceCard of scheduleRow.cards) { // CHANGE: migrated planting overlay.
                    entry.visibleItems.push({ cardId: occurrenceCard.id, row }); // CHANGE: migrated planting overlay.
                } // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.
            body.appendChild(section); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function renderScheduleView(entry, body, cards) { // CHANGE: migrated planting overlay.
            const rows = buildScheduleRowsForCards(cards); // CHANGE: migrated planting overlay.
            const scheduledRows = []; // CHANGE: migrated planting overlay.
            const unscheduled = []; // CHANGE: migrated planting overlay.
            for (const row of rows) { // CHANGE: migrated planting overlay.
                const ranges = row.cards.map(card => getTaskDateRange(card)).filter(Boolean); // CHANGE: migrated planting overlay.
                if (ranges.length) scheduledRows.push({ row, ranges }); // CHANGE: migrated planting overlay.
                else unscheduled.push(row); // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.

            let minDay = null; // CHANGE: migrated planting overlay.
            let maxDay = null; // CHANGE: migrated planting overlay.
            let totalDays = 1; // CHANGE: migrated planting overlay.
            let todayPct = null; // CHANGE: migrated planting overlay.
            if (scheduledRows.length) { // CHANGE: migrated planting overlay.
                const startDays = []; // CHANGE: migrated planting overlay.
                const endDays = []; // CHANGE: migrated planting overlay.
                for (const record of scheduledRows) { // CHANGE: migrated planting overlay.
                    for (const range of record.ranges) { // CHANGE: migrated planting overlay.
                        startDays.push(range.startDay); // CHANGE: migrated planting overlay.
                        endDays.push(range.endDay); // CHANGE: migrated planting overlay.
                    } // CHANGE: migrated planting overlay.
                } // CHANGE: migrated planting overlay.
                minDay = Math.min.apply(null, startDays); // CHANGE: migrated planting overlay.
                maxDay = Math.max.apply(null, endDays); // CHANGE: migrated planting overlay.
                totalDays = Math.max(1, maxDay - minDay + 1); // CHANGE: migrated planting overlay.
                const today = todayOverlayDayNumber(); // CHANGE: migrated planting overlay.
                if (today >= minDay && today <= maxDay) todayPct = ((today - minDay) / totalDays) * 100; // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.

            if (!scheduledRows.length) { // CHANGE: migrated planting overlay.
                const empty = document.createElement('div'); // CHANGE: migrated planting overlay.
                empty.textContent = 'No scheduled task dates'; // CHANGE: migrated planting overlay.
                empty.style.color = '#5f6368'; // CHANGE: migrated planting overlay.
                empty.style.padding = '8px 0'; // CHANGE: migrated planting overlay.
                body.appendChild(empty); // CHANGE: migrated planting overlay.
            } else { // CHANGE: migrated planting overlay.
                const grid = document.createElement('div'); // CHANGE: migrated planting overlay.
                renderScheduleAxis(grid, minDay, maxDay, todayPct); // CHANGE: migrated planting overlay.
                scheduledRows.sort((a, b) => compareTaskCardsByStartDate(a.row.card, b.row.card)); // CHANGE: migrated planting overlay.
                for (const record of scheduledRows) { // CHANGE: migrated planting overlay.
                    renderScheduleRow(entry, grid, record.row, minDay, totalDays, todayPct); // CHANGE: migrated planting overlay.
                } // CHANGE: migrated planting overlay.
                body.appendChild(grid); // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.

            renderUnscheduledSection(entry, body, unscheduled); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function renderOccupancyUnscheduledSection(entry, body, items) { // CHANGE: migrated planting overlay.
            if (!items.length) return; // CHANGE: migrated planting overlay.
            const section = document.createElement('div'); // CHANGE: migrated planting overlay.
            section.style.marginTop = '8px'; // CHANGE: migrated planting overlay.
            const title = document.createElement('div'); // CHANGE: migrated planting overlay.
            title.textContent = 'Unscheduled'; // CHANGE: migrated planting overlay.
            title.style.fontWeight = 'bold'; // CHANGE: migrated planting overlay.
            title.style.fontSize = '10px'; // CHANGE: migrated planting overlay.
            title.style.color = '#5f6368'; // CHANGE: migrated planting overlay.
            title.style.marginBottom = '3px'; // CHANGE: migrated planting overlay.
            section.appendChild(title); // CHANGE: migrated planting overlay.
            for (const item of items) { // CHANGE: migrated planting overlay.
                const row = makeOccupancyRow(entry, item); // CHANGE: migrated planting overlay.
                row.style.display = 'grid'; // CHANGE: migrated planting overlay.
                row.style.gridTemplateColumns = '6px 1fr'; // CHANGE: migrated planting overlay.
                row.style.columnGap = '6px'; // CHANGE: migrated planting overlay.
                row.style.alignItems = 'center'; // CHANGE: migrated planting overlay.
                row.style.minHeight = '22px'; // CHANGE: migrated planting overlay.
                row.style.padding = '2px 0'; // CHANGE: migrated planting overlay.
                row.style.cursor = 'pointer'; // CHANGE: migrated planting overlay.
                const stripe = document.createElement('span'); // CHANGE: migrated planting overlay.
                stripe.style.height = '14px'; // CHANGE: migrated planting overlay.
                stripe.style.borderRadius = '4px'; // CHANGE: migrated planting overlay.
                stripe.style.background = '#9aa0a6'; // CHANGE: migrated planting overlay.
                row.appendChild(stripe); // CHANGE: migrated planting overlay.
                const labelWrap = document.createElement('div'); // CHANGE: migrated planting overlay.
                labelWrap.style.minWidth = '0'; // CHANGE: migrated planting overlay.
                labelWrap.appendChild(makeTextSpan(item.label || item.cellId || 'Planting', '#5f6368')); // CHANGE: migrated planting overlay.
                row.appendChild(labelWrap); // CHANGE: migrated planting overlay.
                section.appendChild(row); // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.
            body.appendChild(section); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function renderOccupancyView(entry, body) { // CHANGE: migrated planting overlay.
            const occupancy = getOccupancyModelForEntry(entry); // CHANGE: migrated planting overlay.
            const rows = (occupancy.items || []).map(item => ({ item, range: occupancyRangeForItem(item) })); // CHANGE: migrated planting overlay.
            const scheduledRows = rows.filter(row => !!row.range); // CHANGE: migrated planting overlay.
            const unscheduledItems = rows.filter(row => !row.range).map(row => row.item); // CHANGE: migrated planting overlay.
            let minDay = null; // CHANGE: migrated planting overlay.
            let maxDay = null; // CHANGE: migrated planting overlay.
            let totalDays = 1; // CHANGE: migrated planting overlay.
            let todayPct = null; // CHANGE: migrated planting overlay.

            if (scheduledRows.length) { // CHANGE: migrated planting overlay.
                minDay = Math.min.apply(null, scheduledRows.map(row => row.range.startDay)); // CHANGE: migrated planting overlay.
                maxDay = Math.max.apply(null, scheduledRows.map(row => row.range.endDay)); // CHANGE: migrated planting overlay.
                totalDays = Math.max(1, maxDay - minDay + 1); // CHANGE: migrated planting overlay.
                const today = todayOverlayDayNumber(); // CHANGE: migrated planting overlay.
                if (today >= minDay && today <= maxDay) todayPct = ((today - minDay) / totalDays) * 100; // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.

            if (!scheduledRows.length) { // CHANGE: migrated planting overlay.
                const empty = document.createElement('div'); // CHANGE: migrated planting overlay.
                empty.textContent = 'No scheduled occupancy dates'; // CHANGE: migrated planting overlay.
                empty.style.color = '#5f6368'; // CHANGE: migrated planting overlay.
                empty.style.padding = '8px 0'; // CHANGE: migrated planting overlay.
                body.appendChild(empty); // CHANGE: migrated planting overlay.
            } else { // CHANGE: migrated planting overlay.
                const grid = document.createElement('div'); // CHANGE: migrated planting overlay.
                renderScheduleAxis(grid, minDay, maxDay, todayPct, 'Planting'); // CHANGE: migrated planting overlay.
                scheduledRows.sort((a, b) => a.range.startDay - b.range.startDay || String(a.item.cellId || '').localeCompare(String(b.item.cellId || ''))); // CHANGE: migrated planting overlay.
                for (const row of scheduledRows) renderOccupancyRow(entry, grid, row.item, row.range, minDay, totalDays, todayPct); // CHANGE: migrated planting overlay.
                body.appendChild(grid); // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.

            renderOccupancyUnscheduledSection(entry, body, unscheduledItems); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function getSourceBoundsForPanel(source) { // CHANGE: migrated planting overlay.
            const host = getPanelHost(); // CHANGE: migrated planting overlay.
            const state = source && graph.getView && graph.getView().getState(source); // CHANGE: migrated planting overlay.
            if (host && state && state.shape && state.shape.node && state.shape.node.getBoundingClientRect) { // CHANGE: migrated planting overlay.
                const hostRect = host.getBoundingClientRect(); // CHANGE: migrated planting overlay.
                const cellRect = state.shape.node.getBoundingClientRect(); // CHANGE: migrated planting overlay.
                return { // CHANGE: migrated planting overlay.
                    x: cellRect.left - hostRect.left + (host.scrollLeft || 0), // CHANGE: migrated planting overlay.
                    y: cellRect.top - hostRect.top + (host.scrollTop || 0), // CHANGE: migrated planting overlay.
                    w: cellRect.width, // CHANGE: migrated planting overlay.
                    h: cellRect.height // CHANGE: migrated planting overlay.
                }; // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.
            const center = getCellCenter(source); // CHANGE: migrated planting overlay.
            return center ? { x: center.x - center.w / 2, y: center.y - center.h / 2, w: center.w, h: center.h } : null; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function normalizeLayoutBounds(bounds) { // CHANGE: migrated planting overlay.
            if (!bounds) return null; // CHANGE: migrated planting overlay.
            const w = Number(bounds.w ?? bounds.width ?? 0); // CHANGE: migrated planting overlay.
            const h = Number(bounds.h ?? bounds.height ?? 0); // CHANGE: migrated planting overlay.
            const x = Number(bounds.x ?? bounds.left ?? 0); // CHANGE: migrated planting overlay.
            const y = Number(bounds.y ?? bounds.top ?? 0); // CHANGE: migrated planting overlay.
            return Number.isFinite(x) && Number.isFinite(y) && w >= 0 && h >= 0 ? { x, y, w, h } : null; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function getClusterBoundsForPanel(source) { // CHANGE: migrated planting overlay.
            const api = graph.__trellisBedSuccessionNavigator; // CHANGE: migrated planting overlay.
            if (api && typeof api.getSelectedClusterLayoutContext === 'function') { // CHANGE: migrated planting overlay.
                const context = api.getSelectedClusterLayoutContext(source); // CHANGE: migrated planting overlay.
                const bounds = normalizeLayoutBounds(context && (context.overlayAnchorBounds || context.clusterBounds)); // CHANGE: visual anchoring is separate from bed-scoped layout context.
                if (bounds) return bounds; // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.
            return getSourceBoundsForPanel(source); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function positionPanel(entry, source) { // CHANGE: migrated planting overlay.
            const host = getPanelHost(); // CHANGE: migrated planting overlay.
            const sourceBounds = getClusterBoundsForPanel(source); // CHANGE: migrated planting overlay.
            if (!host || !entry.panel || !sourceBounds) return false; // CHANGE: migrated planting overlay.

            const panelHeight = entry.panel.offsetHeight || 32; // CHANGE: migrated planting overlay.
            const panelWidth = dynamicPanelWidth(entry.panel); // CHANGE: keep the left anchor correct for dynamically sized overlays.
            const left = sourceBounds.x - PANEL_GAP - PANEL_SIDE_OFFSET - panelWidth; // CHANGE: spacing/task overlay now lives on the left side of the selected cluster.
            const centeredTop = sourceBounds.y + sourceBounds.h / 2 - panelHeight / 2; // CHANGE: center only when the overlay would not enter the reserved occupancy space above the cluster.
            const top = centeredTop < sourceBounds.y ? sourceBounds.y : centeredTop; // CHANGE: deterministic clamp avoids render-order-sensitive Occupancy bounds measurement.

            entry.panelLeft = left; // CHANGE: migrated planting overlay.
            entry.panelTop = top; // CHANGE: migrated planting overlay.
            entry.panel.style.left = left + 'px'; // CHANGE: migrated planting overlay.
            entry.panel.style.top = top + 'px'; // CHANGE: migrated planting overlay.
            return true; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function itemCenterFromRow(entry, row) { // CHANGE: migrated planting overlay.
            const host = getPanelHost(); // CHANGE: migrated planting overlay.
            if (!host || !row || !row.getBoundingClientRect) return null; // CHANGE: migrated planting overlay.
            const rowRect = row.getBoundingClientRect(); // CHANGE: migrated planting overlay.
            const hostRect = host.getBoundingClientRect(); // CHANGE: migrated planting overlay.
            return { // CHANGE: migrated planting overlay.
                x: rowRect.left - hostRect.left + (host.scrollLeft || 0) + rowRect.width / 2, // CHANGE: migrated planting overlay.
                y: rowRect.top - hostRect.top + (host.scrollTop || 0) + rowRect.height / 2, // CHANGE: migrated planting overlay.
                w: rowRect.width, // CHANGE: migrated planting overlay.
                h: rowRect.height // CHANGE: migrated planting overlay.
            }; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function createOrUpdateLine(entry, cardId, row) { // CHANGE: migrated planting overlay.
            const pane = getOverlayPane(); // CHANGE: migrated planting overlay.
            const card = model.getCell(cardId); // CHANGE: migrated planting overlay.
            if (!pane || !row || !isValidOverlayCard(card)) { // CHANGE: migrated planting overlay.
                removePolyline(entry.lines.get(cardId)); // CHANGE: migrated planting overlay.
                entry.lines.delete(cardId); // CHANGE: migrated planting overlay.
                return; // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.

            const itemC = itemCenterFromRow(entry, row); // CHANGE: migrated planting overlay.
            const dstC = getCellCenter(card); // CHANGE: migrated planting overlay.
            if (!itemC || !dstC) { // CHANGE: migrated planting overlay.
                removePolyline(entry.lines.get(cardId)); // CHANGE: migrated planting overlay.
                entry.lines.delete(cardId); // CHANGE: migrated planting overlay.
                return; // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.

            const srcPt = anchorOnSide(itemC, sideToward(itemC, dstC), 0.5); // CHANGE: migrated planting overlay.
            const dstPt = anchorOnSide(dstC, sideToward(dstC, itemC), 0.5); // CHANGE: migrated planting overlay.
            if (!srcPt || !dstPt) return; // CHANGE: migrated planting overlay.

            const points = [new mxPoint(srcPt.x, srcPt.y), new mxPoint(dstPt.x, dstPt.y)]; // CHANGE: migrated planting overlay.
            const stroke = getTaskLaneColor(card); // CHANGE: migrated planting overlay.
            let poly = entry.lines.get(cardId); // CHANGE: migrated planting overlay.

            if (poly && poly.node && poly.node.parentNode === pane) { // CHANGE: migrated planting overlay.
                poly.points = points; // CHANGE: migrated planting overlay.
                poly.stroke = stroke; // CHANGE: migrated planting overlay.
                poly.redraw(); // CHANGE: migrated planting overlay.
            } else { // CHANGE: migrated planting overlay.
                removePolyline(poly); // CHANGE: migrated planting overlay.
                poly = new mxPolyline(points, stroke, 2); // CHANGE: migrated planting overlay.
                poly.dialect = graph.dialect; // CHANGE: migrated planting overlay.
                poly.init(pane); // CHANGE: migrated planting overlay.
                poly.redraw(); // CHANGE: migrated planting overlay.
                if (poly.node) { // CHANGE: migrated planting overlay.
                    poly.node.style.pointerEvents = 'none'; // CHANGE: migrated planting overlay.
                    poly.node.setAttribute('opacity', '0.72'); // CHANGE: migrated planting overlay.
                } // CHANGE: migrated planting overlay.
                entry.lines.set(cardId, poly); // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function refreshLines(entry) { // CHANGE: migrated planting overlay.
            const liveIds = new Set(); // CHANGE: migrated planting overlay.
            for (const item of entry.visibleItems || []) { // CHANGE: migrated planting overlay.
                liveIds.add(item.cardId); // CHANGE: migrated planting overlay.
                createOrUpdateLine(entry, item.cardId, item.row); // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.
            for (const [cardId, poly] of Array.from(entry.lines.entries())) { // CHANGE: migrated planting overlay.
                if (liveIds.has(cardId)) continue; // CHANGE: migrated planting overlay.
                removePolyline(poly); // CHANGE: migrated planting overlay.
                entry.lines.delete(cardId); // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function renderEntry(entry) { // CHANGE: migrated planting overlay.
            const host = getPanelHost(); // CHANGE: migrated planting overlay.
            const panelHost = getPanelLayer(); // CHANGE: migrated planting overlay.
            const source = model.getCell(entry.sourceId); // CHANGE: migrated planting overlay.
            if (!host || !panelHost || !source || !model.isVertex(source)) { // CHANGE: migrated planting overlay.
                removeEntry(entry); // CHANGE: migrated planting overlay.
                return; // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.

            const cards = entry.targetIds // CHANGE: migrated planting overlay.
                .map((id) => model.getCell(id)) // CHANGE: migrated planting overlay.
                .filter(isValidOverlayCard) // CHANGE: migrated planting overlay.
                .sort(compareTaskCardsByStartDate); // CHANGE: migrated planting overlay.
            entry.targetIds = cards.map((card) => card.id); // CHANGE: migrated planting overlay.
            if (entry.linkLabels) { // CHANGE: migrated planting overlay.
                const liveLabels = new Map(); // CHANGE: migrated planting overlay.
                for (const card of cards) liveLabels.set(card.id, entry.linkLabels.get(card.id) || ''); // CHANGE: migrated planting overlay.
                entry.linkLabels = liveLabels; // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.
            if (cards.length === 0) { // CHANGE: migrated planting overlay.
                if (!entry.scheduleOnly) { // CHANGE: migrated planting overlay.
                    removeEntry(entry); // CHANGE: migrated planting overlay.
                    return; // CHANGE: migrated planting overlay.
                } // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.

            if (entry.scheduleOnly) { // CHANGE: migrated planting overlay.
                if (!entry.panel) { // CHANGE: migrated planting overlay.
                    entry.panel = document.createElement('div'); // CHANGE: migrated planting overlay.
                    entry.panel.className = 'manual-link-task-schedule-overlay manual-link-task-schedule-only'; // CHANGE: migrated planting overlay.
                    applyPanelStyle(entry.panel); // CHANGE: migrated planting overlay.
                    panelHost.appendChild(entry.panel); // CHANGE: migrated planting overlay.
                } else if (entry.panel.parentNode !== panelHost) { // CHANGE: migrated planting overlay.
                    panelHost.appendChild(entry.panel); // CHANGE: migrated planting overlay.
                } // CHANGE: migrated planting overlay.
                while (entry.panel.firstChild) entry.panel.removeChild(entry.panel.firstChild); // CHANGE: migrated planting overlay.
                entry.visibleItems = []; // CHANGE: migrated planting overlay.
                entry.panel.appendChild(createScheduleOnlyHeader(entry)); // CHANGE: migrated planting overlay.
                if (activeMode === MODE_SPACING) { // CHANGE: migrated planting overlay.
                    const body = createBody(); // CHANGE: migrated planting overlay.
                    entry.panel.appendChild(body); // CHANGE: migrated planting overlay.
                    renderSpacingView(entry, body); // CHANGE: migrated planting overlay.
                } // CHANGE: migrated planting overlay.
                if (!positionPanel(entry, source)) { // CHANGE: migrated planting overlay.
                    removeEntry(entry); // CHANGE: migrated planting overlay.
                    return; // CHANGE: migrated planting overlay.
                } // CHANGE: migrated planting overlay.
                refreshLines(entry); // CHANGE: migrated planting overlay.
                return; // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.

            entry.years = getTaskOverlayYears(cards); // CHANGE: migrated planting overlay.
            if (entry.years.length) { // CHANGE: migrated planting overlay.
                const rememberedYear = selectedYearBySource.get(entry.sourceId); // CHANGE: migrated planting overlay.
                entry.selectedYear = entry.years.indexOf(rememberedYear) >= 0 ? rememberedYear : (entry.selectedYear || chooseDefaultOverlayYear(entry.years)); // CHANGE: migrated planting overlay.
            } else { // CHANGE: migrated planting overlay.
                entry.selectedYear = null; // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.
            const visibleCards = cards.filter(card => getAttr(card, 'year_hidden') !== '1'); // CHANGE: migrated planting overlay.
            const groups = groupLinkedTasksForOverlay(visibleCards); // CHANGE: migrated planting overlay.

            if (!entry.panel) { // CHANGE: migrated planting overlay.
                entry.panel = document.createElement('div'); // CHANGE: migrated planting overlay.
                entry.panel.className = 'manual-link-task-schedule-overlay'; // CHANGE: migrated planting overlay.
                applyPanelStyle(entry.panel); // CHANGE: migrated planting overlay.
                panelHost.appendChild(entry.panel); // CHANGE: migrated planting overlay.
            } else if (entry.panel.parentNode !== panelHost) { // CHANGE: migrated planting overlay.
                panelHost.appendChild(entry.panel); // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.

            while (entry.panel.firstChild) entry.panel.removeChild(entry.panel.firstChild); // CHANGE: migrated planting overlay.
            entry.visibleItems = []; // CHANGE: migrated planting overlay.
            const headerCount = activeMode === MODE_SPACING ? countSpacingRows(entry) : (activeMode === MODE_SCHEDULE ? countScheduleRows(visibleCards) : countGroupItems(groups)); // CHANGE: migrated planting overlay.
            entry.panel.appendChild(createHeader(entry, headerCount)); // CHANGE: migrated planting overlay.
            const body = createBody(); // CHANGE: migrated planting overlay.
            entry.panel.appendChild(body); // CHANGE: migrated planting overlay.
            mxEvent.addListener(body, 'scroll', function () { refreshLines(entry); }); // CHANGE: migrated planting overlay.

            if (activeMode === MODE_SPACING) renderSpacingView(entry, body); // CHANGE: migrated planting overlay.
            else if (visibleCards.length === 0) renderEmptyTaskOverlayMessage(body); // CHANGE: migrated planting overlay.
            else if (activeMode === MODE_SCHEDULE) renderScheduleView(entry, body, visibleCards); // CHANGE: migrated planting overlay.
            else if (groups.length) renderCardView(entry, body, groups); // CHANGE: migrated planting overlay.
            else renderEmptyTaskOverlayMessage(body); // CHANGE: migrated planting overlay.

            if (!positionPanel(entry, source)) { // CHANGE: migrated planting overlay.
                removeEntry(entry); // CHANGE: migrated planting overlay.
                return; // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.

            refreshLines(entry); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function removeEntry(entry, restoreYear) { // CHANGE: migrated planting overlay.
            if (!entry) return; // CHANGE: migrated planting overlay.
            clearSpacingPreview(); // CHANGE: migrated planting overlay.
            for (const poly of entry.lines.values()) removePolyline(poly); // CHANGE: migrated planting overlay.
            entry.lines.clear(); // CHANGE: migrated planting overlay.
            removeNode(entry.panel); // CHANGE: migrated planting overlay.
            registry.delete(entry.sourceId); // CHANGE: migrated planting overlay.
            if (restoreYear && !isEntryStillSelected(entry)) restoreEntryTasksToCurrentYear(entry); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function show(source, cards, linkLabels) { // CHANGE: migrated planting overlay.
            clear(); // CHANGE: migrated planting overlay.
            if (isTeamPermissionModeActiveForTaskScheduleOverlay()) return; // NEW
            if (!source || !source.id || !cards || cards.length === 0) return; // CHANGE: migrated planting overlay.

            const validCards = cards.filter(isValidOverlayCard).sort(compareTaskCardsByStartDate); // CHANGE: migrated planting overlay.
            if (validCards.length === 0) return; // CHANGE: migrated planting overlay.

            const entry = { // CHANGE: migrated planting overlay.
                sourceId: source.id, // CHANGE: migrated planting overlay.
                targetIds: validCards.map((card) => card.id), // CHANGE: migrated planting overlay.
                linkLabels: new Map(), // CHANGE: migrated planting overlay.
                panel: null, // CHANGE: migrated planting overlay.
                panelLeft: 0, // CHANGE: migrated planting overlay.
                panelTop: 0, // CHANGE: migrated planting overlay.
                visibleItems: [], // CHANGE: migrated planting overlay.
                spacingDraftByCellId: new Map(), // CHANGE: migrated planting overlay.
                lines: new Map() // CHANGE: migrated planting overlay.
            }; // CHANGE: migrated planting overlay.
            for (const card of validCards) entry.linkLabels.set(card.id, linkLabels && linkLabels.get ? (linkLabels.get(card.id) || '') : ''); // CHANGE: migrated planting overlay.
            registry.set(source.id, entry); // CHANGE: migrated planting overlay.
            renderEntry(entry); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function showScheduleOnly(source) { // CHANGE: migrated planting overlay.
            clear(); // CHANGE: migrated planting overlay.
            if (isTeamPermissionModeActiveForTaskScheduleOverlay()) return; // NEW
            if (!source || !source.id || !isTilerGroup(source)) return; // CHANGE: migrated planting overlay.
            const entry = { // CHANGE: migrated planting overlay.
                sourceId: source.id, // CHANGE: migrated planting overlay.
                targetIds: [], // CHANGE: migrated planting overlay.
                linkLabels: new Map(), // CHANGE: migrated planting overlay.
                scheduleOnly: true, // CHANGE: migrated planting overlay.
                panel: null, // CHANGE: migrated planting overlay.
                panelLeft: 0, // CHANGE: migrated planting overlay.
                panelTop: 0, // CHANGE: migrated planting overlay.
                visibleItems: [], // CHANGE: migrated planting overlay.
                spacingDraftByCellId: new Map(), // CHANGE: migrated planting overlay.
                lines: new Map() // CHANGE: migrated planting overlay.
            }; // CHANGE: migrated planting overlay.
            registry.set(source.id, entry); // CHANGE: migrated planting overlay.
            renderEntry(entry); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function clear() { // CHANGE: migrated planting overlay.
            for (const entry of Array.from(registry.values())) removeEntry(entry, true); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function refresh() { // CHANGE: migrated planting overlay.
            if (isTeamPermissionModeActiveForTaskScheduleOverlay()) { clear(); return; } // NEW
            for (const entry of Array.from(registry.values())) renderEntry(entry); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        /** View-only changes reposition panels in place; only model/context changes rebuild their contents. */ // CHANGE
        function refreshView() { // CHANGE
            if (isTeamPermissionModeActiveForTaskScheduleOverlay()) { clear(); return; } // CHANGE
            for (const entry of Array.from(registry.values())) { // CHANGE
                const source = model.getCell(entry.sourceId); // CHANGE
                if (!source) { removeEntry(entry); continue; } // CHANGE
                if (entry.panel) entry.panel.style.display = positionPanel(entry, source) ? '' : 'none'; // CHANGE
                refreshLines(entry); // CHANGE
            } // CHANGE
        } // CHANGE

        function changeCellForSpacingDraft(change) { // NEW: detect committed graph edits that invalidate transient drafts.
            return change && (change.cell || change.child || change.terminal || null); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function spacingDraftTouchesCell(entry, cell) { // CHANGE: migrated planting overlay.
            if (!entry || !entry.spacingDraftByCellId || !entry.spacingDraftByCellId.size || !cell) return false; // CHANGE: migrated planting overlay.
            const draftIds = entry.spacingDraftByCellId; // CHANGE: migrated planting overlay.
            for (let cur = cell; cur; cur = model.getParent ? model.getParent(cur) : null) { // CHANGE: migrated planting overlay.
                if (cur.id && draftIds.has(String(cur.id))) return true; // CHANGE: migrated planting overlay.
            } // CHANGE: migrated planting overlay.
            return false; // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        function clearSpacingDraftsForChanges(changes) { // CHANGE: migrated planting overlay.
            const list = Array.isArray(changes) ? changes : []; // CHANGE: migrated planting overlay.
            if (!list.length) return; // CHANGE: migrated planting overlay.
            let cleared = false; // CHANGE: migrated planting overlay.
            registry.forEach(entry => { // CHANGE: migrated planting overlay.
                if (!entry.spacingDraftByCellId || !entry.spacingDraftByCellId.size) return; // CHANGE: migrated planting overlay.
                if (!list.some(change => spacingDraftTouchesCell(entry, changeCellForSpacingDraft(change)))) return; // CHANGE: migrated planting overlay.
                clearStoredSpacingDrafts(entry); // CHANGE: migrated planting overlay.
                cleared = true; // CHANGE: migrated planting overlay.
            }); // CHANGE: migrated planting overlay.
            if (cleared) clearSpacingPreview(); // CHANGE: affected undo/redo/model edits restore real groups immediately.
        } // CHANGE: migrated planting overlay.

        function setMode(mode) { // CHANGE: migrated planting overlay.
            clearSpacingPreview(); // CHANGE: migrated planting overlay.
            activeMode = mode === MODE_SPACING ? MODE_SPACING : (mode === MODE_SCHEDULE ? MODE_SCHEDULE : MODE_CARDS); // CHANGE: migrated planting overlay.
            if (activeMode !== MODE_SPACING) registry.forEach(entry => clearStoredSpacingDrafts(entry)); // CHANGE: leaving Spacing discards uncommitted layout drafts.
            refresh(); // CHANGE: migrated planting overlay.
        } // CHANGE: migrated planting overlay.

        graph.__trellisPlantingSpacingEditor = { // CHANGE: public UI bridge lets Allocate reuse the actual planting overlay editor.
            render: (body, context, options) => renderSpacingEditor({ sourceId: context.selectedId, spacingDraftByCellId: new Map() }, body, context, getLayoutTools(), options), // CHANGE
            clear: clearSpacingPreview // CHANGE
        }; // CHANGE
        return { // CHANGE: migrated planting overlay.
            show, // CHANGE: migrated planting overlay.
            showScheduleOnly, // CHANGE: migrated planting overlay.
            clear, // CHANGE: migrated planting overlay.
            refresh, // CHANGE: migrated planting overlay.
            clearSpacingDraftsForChanges, // CHANGE: migrated planting overlay.
            refreshView, // CHANGE
            setMode, registry // CHANGE: migrated planting overlay.
        }; // CHANGE: migrated planting overlay.
    })(); // CHANGE: migrated planting overlay.
    // Primary flag persistence remains in the linking plugin. // CHANGE

    /** Navigate through the linking adapter, preserving card paging and ancestor reveal behavior. */ // CHANGE
    function navigateOverlayCell(cell) { // CHANGE
        const adapter = graph.__trellisPlantingLinking; // CHANGE
        if (adapter) adapter.navigate(cell); // CHANGE
        else { graph.setSelectionCell(cell); if (graph.scrollCellToVisible) graph.scrollCellToVisible(cell); } // CHANGE
    } // CHANGE

    /** One controller owns selection, draft invalidation and presentation refreshes. */ // CHANGE
    function createPlantingOverlayLifecycle() { // CHANGE
        let restoringHistory = false; // CHANGE
        function syncSelection() { // CHANGE
            if (restoringHistory) return; // CHANGE
            const selected = graph.getSelectionCells ? graph.getSelectionCells() : []; // CHANGE
            const adapter = graph.__trellisPlantingLinking; // CHANGE
            let source = selected.length === 1 ? selected[0] : null; // CHANGE
            if (source && adapter) source = adapter.normalizeSelection(source); // CHANGE
            else if (source) { // CHANGE
                for (let cell = source; cell; cell = model.getParent(cell)) if (isTilerGroup(cell)) { source = cell; break; } // CHANGE
            } // CHANGE
            if (source && model.contains && !model.contains(source)) source = null; // CHANGE
            const active = source && taskScheduleOverlay.registry.get(source.id); // CHANGE
            const context = source && adapter ? adapter.getContext(source) : null; // CHANGE
            const targetIds = context ? context.cards.map(card => card.id).sort() : []; // CHANGE
            if (active && JSON.stringify(active.targetIds.slice().sort()) === JSON.stringify(targetIds)) { taskScheduleOverlay.refresh(); return; } // CHANGE: preserve drafts unless the linked-card context actually changed.
            if (context && context.cards.length && !(source.getAttribute && source.getAttribute('kanban_card') === '1')) taskScheduleOverlay.show(source, context.cards, context.linkLabels); // CHANGE
            else if (source && isTilerGroup(source)) taskScheduleOverlay.showScheduleOnly(source); // CHANGE
            else taskScheduleOverlay.clear(); // CHANGE
        } // CHANGE

        function onModelChange(_sender, event) { // CHANGE
            const edit = event && event.getProperty && event.getProperty('edit'); // CHANGE
            taskScheduleOverlay.clearSpacingDraftsForChanges(edit && edit.changes); // CHANGE
            syncSelection(); // CHANGE
        } // CHANGE

        let viewRefreshPending = false; // CHANGE
        function onViewChange() { // CHANGE
            if (viewRefreshPending) return; // CHANGE: coalesce graph refresh, zoom and scroll notifications after view validation.
            viewRefreshPending = true; // CHANGE
            const schedule = window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : (callback => setTimeout(callback, 0)); // CHANGE
            schedule(() => { // CHANGE
                viewRefreshPending = false; // CHANGE
                plantingPreview.refresh(); taskScheduleOverlay.refreshView(); // CHANGE: redraw ghosts without rebuilding the spacing form.
            }); // CHANGE
        } // CHANGE

        const selection = graph.getSelectionModel && graph.getSelectionModel(); // CHANGE
        if (selection && selection.addListener) selection.addListener(mxEvent.CHANGE, syncSelection); // CHANGE
        if (model.addListener) model.addListener(mxEvent.CHANGE, onModelChange); // CHANGE
        const view = graph.getView && graph.getView(); // CHANGE
        if (view && view.addListener) [mxEvent.SCALE, mxEvent.TRANSLATE, mxEvent.SCALE_AND_TRANSLATE, mxEvent.UP, mxEvent.DOWN].filter(Boolean).forEach(name => view.addListener(name, onViewChange)); // CHANGE
        if (graph.addListener) { // CHANGE
            graph.addListener(mxEvent.REFRESH, onViewChange); // CHANGE: personal Roadmap projection changes refresh the graph without editing its model.
            graph.addListener('linksChanged', syncSelection); // CHANGE
            graph.addListener('trellisPlantingLinkingReady', syncSelection); // CHANGE
            graph.addListener('trellisSelectionVisualsRefresh', syncSelection); // CHANGE
            graph.addListener(TILER_GROUP_CREATED_EVENT, (_sender, event) => { // CHANGE
                const id = event && event.getProperty && event.getProperty('cellId'); // CHANGE
                const cell = id && model.getCell(id) || event && event.getProperty && event.getProperty('cell'); // CHANGE
                if (!cell || !isTilerGroup(cell)) return; // CHANGE
                graph.setSelectionCell(cell); // CHANGE
                setTimeout(() => { if ((!model.contains || model.contains(cell)) && graph.getSelectionCell() === cell) syncSelection(); }, 0); // CHANGE
            }); // CHANGE
        } // CHANGE
        if (graph.container && graph.container.addEventListener) graph.container.addEventListener('scroll', onViewChange); // CHANGE
        if (window.addEventListener) { // CHANGE
            window.addEventListener('resize', onViewChange); // CHANGE
            window.addEventListener('trellisTeamPermissionModeChanged', syncSelection); // CHANGE
            window.addEventListener('trellisHistoryBeforeRestore', () => { restoringHistory = true; taskScheduleOverlay.clear(); }); // CHANGE
            window.addEventListener('trellisHistoryAfterRestore', () => { restoringHistory = false; syncSelection(); }); // CHANGE
        } // CHANGE
        return Object.assign({}, taskScheduleOverlay, { syncSelection }); // CHANGE
    } // CHANGE

    graph.__trellisPlantingGroup = { preview: plantingPreview, overlay: createPlantingOverlayLifecycle(), spacingEditor: graph.__trellisPlantingSpacingEditor }; // CHANGE

    // ---- Public API export (for other plugins) ---------------------------------
    window.USL = window.USL || {};
    window.USL.plantingGroup = Object.assign({}, window.USL.plantingGroup || window.USL.tiler, { // CHANGE
        retileGroup,
        retileAndFitToContainingBed,
        createSiblingTilerGroupFromSource,
        listGardenBeds,
        readBedProfile,
        buildDraftTilerGroupPreview, buildUnsavedTilerGroupPreview, // CHANGE
        listPlantingFootprints,
        readPlantingFootprint, // CHANGE: allocation timeline clustering can use the same header-free occupancy as placement.
        resolveAllowedOverhangPct, // CHANGE: shared scheduler and Allocate defaults use the same percentage policy.
        prepareBedFitSpacingDraft, // CHANGE: pure fitting shared by saved-planting previews and commits.
        proposePlantingGeometry,
        createPlantingFromProposal,
        reorderModuleChildrenForLayering
    });
    graph.__trellisPlantingGroup.overlay.syncSelection(); // CHANGE: support linking-before-owner startup.
    window.USL.tiler = window.USL.plantingGroup; // CHANGE: identity alias preserves old callers.
    if (graph.fireEvent && typeof mxEventObject !== 'undefined') graph.fireEvent(new mxEventObject('trellisPlantingGroupReady')); // CHANGE
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
