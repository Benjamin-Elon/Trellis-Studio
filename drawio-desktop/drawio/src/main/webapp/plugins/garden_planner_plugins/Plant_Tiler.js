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
    const RESIZE_DEBOUNCE_MS = 120; // debounce tiling during resize // RESTORE
    const ROTATION_RETILE_DEBOUNCE_MS = 150; // CHANGE
    const DEBUG_PLANT_TILER = false; // CHANGE
    const DEBUG_BED_FIT = false; // CHANGE
    const GRAPH_OVERLAY_Z = Object.freeze({ ANNOTATION: 10000, CONNECTION: 10010, CONTROL: 10020, CONTROL_TOP: 10030 }); // CHANGE
    const TRELLIS_DIALOG_Z = 2000000000; // NEW

    const GROUP_LABEL_FONT_PX = 12;
    const GROUP_LABEL_LINE_HEIGHT = 1.25;
    const GROUP_LABEL_BAND_PAD_PX = 6;
    const GROUP_LABEL_BAND_PX = Math.ceil(GROUP_LABEL_FONT_PX * GROUP_LABEL_LINE_HEIGHT + GROUP_LABEL_BAND_PAD_PX);

    const MODULE_CURRENT_YEAR_ATTR = "current_year"; // NEW
    const SEASON_START_YEAR_ATTR = "season_start_year"; // NEW
    const DEFAULT_BED_WIDTH_CM_ATTR = "default_bed_width_cm"; // CHANGE
    const DEFAULT_BED_LENGTH_CM_ATTR = "default_bed_length_cm"; // CHANGE
    const CM_PER_METER = 100; // CHANGE
    const CM_PER_FOOT = 30.48; // CHANGE
    const DEFAULT_METRIC_BED_WIDTH_CM = 100; // CHANGE
    const DEFAULT_METRIC_BED_LENGTH_CM = 200; // CHANGE
    const DEFAULT_IMPERIAL_BED_WIDTH_CM = 4 * CM_PER_FOOT; // CHANGE
    const DEFAULT_IMPERIAL_BED_LENGTH_CM = 8 * CM_PER_FOOT; // CHANGE
    const TILER_GROUP_CREATED_EVENT = "usl:tilerGroupCreated"; // CHANGE

    // ---------- LOD settings ----------
    const LOD_TILE_THRESHOLD = 300; // collapse if rows*cols > this
    const LOD_SUMMARY_MIN_SIZE = 24; // min px size of summary marker

    // ----------- Yield ---------------
    const YIELD_UNIT = "kg"; // default display unit
    const ATTR_YIELD_EXPECTED = "planting_expected_yield_kg";
    const ATTR_YIELD_ACTUAL = "planting_actual_yield_kg"; // RESTORE

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
    const GROUP_LABEL_FONT_MAX_PX = 18; // CHANGE
    const BED_FIT_TOLERANCE = 0.25; // MOVED
    const BED_FIT_RESIZE_SUPPRESS_MS = 250; // CHANGE
    const EDGE_CIRCLE_CENTER_CONTAINED_PCT = 0.40; // MOVED
    const BED_AUTO_FIT_ATTR = "bed_auto_fit"; // MOVED


    // -------------------- Debug helper ------------------
    function log(...args) {
        if (!DEBUG_PLANT_TILER) return; // CHANGE
        try {
            mxLog.debug("[PlantTiler]", ...args);
        } catch (_) { }
    }

    function bedFitDebugEnabled() { // NEW
        try { // NEW
            if (DEBUG_BED_FIT) return true; // NEW
            if (typeof window !== "undefined" && window.__TRELLIS_BED_FIT_DEBUG__ === true) return true; // NEW
            if (typeof window !== "undefined" && window.localStorage && window.localStorage.getItem("trellis_bed_fit_debug") === "1") return true; // NEW
        } catch (_) { } // NEW
        return false; // NEW
    } // NEW

    function bedFitLog(stage, payload) { // CHANGE
        if (!bedFitDebugEnabled() || typeof console === "undefined") return; // CHANGE
        try { // CHANGE
            const data = payload || {}; // CHANGE
            const tables = data.tables || {}; // CHANGE
            const scalar = Object.assign({}, data); // CHANGE
            delete scalar.tables; // CHANGE
            if (console.groupCollapsed) console.groupCollapsed("[BedFit]", stage, scalar.txnId != null ? "txn=" + scalar.txnId : ""); // CHANGE
            else console.log("[BedFit]", stage, scalar); // CHANGE
            console.log(scalar); // CHANGE
            for (const key of Object.keys(tables)) { // CHANGE
                console.log(key); // CHANGE
                if (console.table) console.table(tables[key]); // CHANGE
                else console.log(tables[key]); // CHANGE
            } // CHANGE
            if (console.groupEnd) console.groupEnd(); // CHANGE
        } catch (e) { // CHANGE
            try { console.log("[BedFit] logging failed", stage, e); } catch (_) { } // CHANGE
        } // CHANGE
    } // CHANGE

    function debugLocalStore() { // NEW
        try { return typeof window !== "undefined" && window.localStorage ? window.localStorage : null; } catch (_) { return null; } // NEW
    } // NEW

    function debugFlagSnapshot() { // NEW
        const store = debugLocalStore(); // NEW
        const win = typeof window !== "undefined" ? window : null; // NEW
        return { // NEW
            storage: { // NEW
                trellis_users_debug: store ? store.getItem("trellis_users_debug") : null, // NEW
                trellis_bed_fit_debug: store ? store.getItem("trellis_bed_fit_debug") : null // NEW
            }, // NEW
            windowFlags: { // NEW
                users: !!(win && win.__TRELLIS_USERS_DEBUG__ === true), // NEW
                bedFit: !!(win && win.__TRELLIS_BED_FIT_DEBUG__ === true) // NEW
            } // NEW
        }; // NEW
    } // NEW

    function bedFitStatus() { // NEW
        const win = typeof window !== "undefined" ? window : null; // NEW
        const flags = debugFlagSnapshot(); // NEW
        return { // NEW
            plugin: "Plant_Tiler.js", // NEW
            loaded: true, // NEW
            debugEnabled: bedFitDebugEnabled(), // NEW
            url: win && win.location ? String(win.location.href || "") : "", // NEW
            origin: win && win.location ? String(win.location.origin || "") : "", // NEW
            storage: flags.storage, // NEW
            windowFlags: flags.windowFlags, // NEW
            bedFitInProgress: !!bedFitInProgress, // NEW
            nextTxnId: bedFitTxnSeq + 1, // NEW
            tilerFitApiPresent: !!(win && win.USL && win.USL.tiler && typeof win.USL.tiler.retileAndFitToContainingBed === "function") // NEW
        }; // NEW
    } // NEW

    function debugProbeSnapshot() { // NEW
        const win = typeof window !== "undefined" ? window : null; // NEW
        const debug = win && win.Trellis && win.Trellis.debug; // NEW
        const flags = debugFlagSnapshot(); // NEW
        return { // NEW
            url: win && win.location ? String(win.location.href || "") : "", // NEW
            origin: win && win.location ? String(win.location.origin || "") : "", // NEW
            usersPluginLoaded: !!(win && win.__TRELLIS_USERS_PLUGIN_LOADED), // NEW
            bedFitPluginLoaded: !!(win && win.__TRELLIS_BED_FIT_PLUGIN_LOADED), // NEW
            storage: flags.storage, // NEW
            windowFlags: flags.windowFlags, // NEW
            usersApiPresent: !!(win && win.Trellis && win.Trellis.users), // NEW
            tilerFitApiPresent: !!(win && win.USL && win.USL.tiler && typeof win.USL.tiler.retileAndFitToContainingBed === "function"), // NEW
            usersStatus: debug && typeof debug.usersStatus === "function" ? debug.usersStatus() : null, // NEW
            bedFitStatus: debug && typeof debug.bedFitStatus === "function" ? debug.bedFitStatus() : null // NEW
        }; // NEW
    } // NEW

    function debugProbe() { // NEW
        const snapshot = debugProbeSnapshot(); // NEW
        if (typeof console !== "undefined") { // NEW
            try { // NEW
                if (console.groupCollapsed) console.groupCollapsed("[TrellisDebug] probe"); // NEW
                else if (console.log) console.log("[TrellisDebug] probe"); // NEW
                if (console.log) console.log(snapshot); // NEW
            } finally { // NEW
                try { if (console.groupEnd) console.groupEnd(); } catch (_) { } // NEW
            } // NEW
        } // NEW
        return snapshot; // NEW
    } // NEW

    function installTrellisDebugSurface() { // NEW
        const win = typeof window !== "undefined" ? window : null; // NEW
        if (!win) return null; // NEW
        win.Trellis = win.Trellis || {}; // NEW
        const debug = win.Trellis.debug = win.Trellis.debug || {}; // NEW
        win.__TRELLIS_BED_FIT_PLUGIN_LOADED = true; // NEW
        debug.bedFitStatus = bedFitStatus; // NEW
        debug.enable = function () { // NEW
            const store = debugLocalStore(); // NEW
            win.__TRELLIS_USERS_DEBUG__ = true; // NEW
            win.__TRELLIS_BED_FIT_DEBUG__ = true; // NEW
            if (store) { store.setItem("trellis_users_debug", "1"); store.setItem("trellis_bed_fit_debug", "1"); } // NEW
            return debugProbeSnapshot(); // NEW
        }; // NEW
        debug.disable = function () { // NEW
            const store = debugLocalStore(); // NEW
            win.__TRELLIS_USERS_DEBUG__ = false; // NEW
            win.__TRELLIS_BED_FIT_DEBUG__ = false; // NEW
            if (store) { store.removeItem("trellis_users_debug"); store.removeItem("trellis_bed_fit_debug"); } // NEW
            return debugProbeSnapshot(); // NEW
        }; // NEW
        debug.probe = debugProbe; // NEW
        return debug; // NEW
    } // NEW

    function withUndoSuppressed(fn) { // NEW
        if (graph.__withUndoSuppressed) return graph.__withUndoSuppressed(fn); // NEW
        const um = ui && ui.editor && ui.editor.undoManager; // NEW
        if (!um || typeof um.undoableEditHappened !== "function") return fn(); // NEW

        if (!graph.__plantTilerUndoSuppressInstalled) { // NEW
            const oldUndoableEditHappened = um.undoableEditHappened.bind(um); // NEW
            graph.__plantTilerUndoSuppressDepth = graph.__plantTilerUndoSuppressDepth || 0; // NEW
            um.undoableEditHappened = function (edit) { // NEW
                if (graph.__plantTilerUndoSuppressDepth > 0) return; // NEW
                return oldUndoableEditHappened(edit); // NEW
            }; // NEW
            graph.__plantTilerUndoSuppressInstalled = true; // NEW
        } // NEW

        graph.__plantTilerUndoSuppressDepth++; // NEW
        try { return fn(); } // NEW
        finally { graph.__plantTilerUndoSuppressDepth--; } // NEW
    } // NEW

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

    function elevateTrellisDialog() { // NEW
        const dlg = ui && ui.dialog; // NEW
        if (dlg && dlg.bg && dlg.bg.style) dlg.bg.style.zIndex = String(TRELLIS_DIALOG_Z - 1); // NEW
        if (dlg && dlg.container && dlg.container.style) dlg.container.style.zIndex = String(TRELLIS_DIALOG_Z); // NEW
    } // NEW

    async function execAll(sql, params) { // ADDED
        if (!window.dbBridge || typeof window.dbBridge.open !== "function") { // ADDED
            throw new Error("dbBridge not available; check preload/main wiring"); // ADDED
        } // ADDED
        const dbPath = await getDbPath(); // ADDED
        const opened = await window.dbBridge.open(dbPath, { readOnly: false }); // ADDED
        try { // ADDED
            if (typeof window.dbBridge.exec === "function") return await window.dbBridge.exec(opened.dbId, sql, params || []); // ADDED
            if (typeof window.dbBridge.run === "function") return await window.dbBridge.run(opened.dbId, sql, params || []); // ADDED
            throw new Error("dbBridge.exec/run not available"); // ADDED
        } finally { // ADDED
            try { await window.dbBridge.close(opened.dbId); } catch (_) { } // ADDED
        } // ADDED
    } // ADDED

    async function execSchemaStatements(statements) { // ADDED
        if (!window.dbBridge || typeof window.dbBridge.open !== "function") throw new Error("dbBridge not available; check preload/main wiring"); // ADDED
        const dbPath = await getDbPath(); // ADDED
        const opened = await window.dbBridge.open(dbPath, { readOnly: false }); // ADDED
        try { // ADDED
            for (const statement of statements) { // ADDED
                if (typeof window.dbBridge.exec === "function") await window.dbBridge.exec(opened.dbId, statement, []); // ADDED
                else if (typeof window.dbBridge.run === "function") await window.dbBridge.run(opened.dbId, statement, []); // ADDED
                else throw new Error("dbBridge.exec/run not available"); // ADDED
            } // ADDED
        } finally { // ADDED
            try { await window.dbBridge.close(opened.dbId); } catch (_) { } // ADDED
        } // ADDED
    } // ADDED

    function quoteSqlIdentifier(value) { // ADDED
        return `"${String(value).replace(/"/g, '""')}"`; // ADDED
    } // ADDED

    function cityColumnDefinition(column) { // ADDED
        const parts = [quoteSqlIdentifier(column.name), String(column.type || "TEXT")]; // ADDED
        if (Number(column.pk || 0)) parts.push("PRIMARY KEY"); // ADDED
        if (Number(column.notnull || 0) && !Number(column.pk || 0)) parts.push("NOT NULL"); // ADDED
        if (column.dflt_value != null) parts.push(`DEFAULT ${column.dflt_value}`); // ADDED
        return parts.join(" "); // ADDED
    } // ADDED

    async function cityHasUniqueNameConstraint() { // ADDED
        const indexes = await queryAll("PRAGMA index_list(Cities);", []); // ADDED
        for (const index of indexes) { // ADDED
            if (!Number(index.unique || 0)) continue; // ADDED
            const indexName = String(index.name || ""); // ADDED
            const columns = (await queryAll(`PRAGMA index_info(${quoteSqlIdentifier(indexName)});`, [])).map(row => String(row.name || "")); // ADDED
            if (columns.length === 1 && columns[0] === "city_name") return true; // ADDED
        } // ADDED
        return false; // ADDED
    } // ADDED

    async function rebuildCitiesWithoutUniqueName() { // ADDED
        const columns = await queryAll("PRAGMA table_info(Cities);", []); // ADDED
        const names = columns.map(column => String(column.name || "")).filter(Boolean); // ADDED
        const quotedNames = names.map(quoteSqlIdentifier).join(", "); // ADDED
        await execSchemaStatements([ // ADDED
            "PRAGMA foreign_keys = OFF;", // ADDED
            `CREATE TABLE Cities_new (${columns.map(cityColumnDefinition).join(", ")});`, // ADDED
            `INSERT INTO Cities_new (${quotedNames}) SELECT ${quotedNames} FROM Cities;`, // ADDED
            "DROP TABLE Cities;", // ADDED
            "ALTER TABLE Cities_new RENAME TO Cities;", // ADDED
            "PRAGMA foreign_keys = ON;", // ADDED
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_Cities_city_geo_identity ON Cities(lower(trim(city_name)), lower(trim(coalesce(country_name, ''))), lower(trim(coalesce(country_code, ''))), lower(trim(coalesce(region_name, ''))), lower(trim(coalesce(region_code, ''))));", // ADDED
            "CREATE INDEX IF NOT EXISTS idx_Cities_city_name ON Cities(city_name);" // ADDED
        ]); // ADDED
    } // ADDED

    const CITY_GEO_COLUMNS = Object.freeze({ // ADDED
        country_name: "TEXT", // ADDED
        country_code: "TEXT", // ADDED
        region_name: "TEXT", // ADDED
        region_code: "TEXT" // ADDED
    }); // ADDED
    let cityGeoSchemaEnsured = false; // ADDED

    async function ensureCityGeographySchema() { // ADDED
        if (cityGeoSchemaEnsured) return; // ADDED
        const existing = new Set((await queryAll("PRAGMA table_info(Cities);", [])).map(row => String(row.name || "").toLowerCase())); // ADDED
        for (const [column, type] of Object.entries(CITY_GEO_COLUMNS)) { // ADDED
            if (!existing.has(column.toLowerCase())) await execAll(`ALTER TABLE Cities ADD COLUMN ${column} ${type};`, []); // ADDED
        } // ADDED
        if (await cityHasUniqueNameConstraint()) await rebuildCitiesWithoutUniqueName(); // ADDED
        cityGeoSchemaEnsured = true; // ADDED
    } // ADDED

    function normalizeCityGeoText(value) { // ADDED
        return String(value == null ? "" : value).trim(); // ADDED
    } // ADDED

    function normalizeCityIdentityText(value) { // ADDED
        return normalizeCityGeoText(value).toLowerCase(); // ADDED
    } // ADDED

    function cityCountryLabel(city) { // ADDED
        return normalizeCityGeoText(city && city.country_name) || normalizeCityGeoText(city && city.country_code) || "Uncategorized"; // ADDED
    } // ADDED

    function cityRegionLabel(city) { // ADDED
        const name = normalizeCityGeoText(city && city.region_name); // ADDED
        const code = normalizeCityGeoText(city && city.region_code); // ADDED
        if (name && code && name.toLowerCase() !== code.toLowerCase()) return `${name} (${code})`; // ADDED
        return name || code || "Uncategorized"; // ADDED
    } // ADDED

    function cityDisplayLabel(city) { // ADDED
        return normalizeCityGeoText(city && city.city_name) || "(unnamed city)"; // ADDED
    } // ADDED

    function fullCityLabel(city) { // ADDED
        return `${cityDisplayLabel(city)} - ${cityCountryLabel(city)} / ${cityRegionLabel(city)}`; // ADDED
    } // ADDED

    function citySearchText(city) { // ADDED
        return [cityDisplayLabel(city), cityCountryLabel(city), cityRegionLabel(city), normalizeCityGeoText(city && city.country_code), normalizeCityGeoText(city && city.region_code)].join(" ").toLowerCase(); // ADDED
    } // ADDED

    function sortedCities(cities) { // ADDED
        return (cities || []).slice().sort((a, b) => { // ADDED
            const av = [cityCountryLabel(a), cityRegionLabel(a), cityDisplayLabel(a)].join("\u0000").toLowerCase(); // ADDED
            const bv = [cityCountryLabel(b), cityRegionLabel(b), cityDisplayLabel(b)].join("\u0000").toLowerCase(); // ADDED
            return av.localeCompare(bv); // ADDED
        }); // ADDED
    } // ADDED

    function makeCityTreePicker(cities, initialValue) { // ADDED
        let cityRows = sortedCities(cities); // ADDED
        let currentValue = String(initialValue || (cityRows[0] && cityRows[0].city_id || "")); // ADDED
        let isOpen = false; // ADDED
        const root = document.createElement("div"); // ADDED
        root.tabIndex = 0; // ADDED
        root.style.position = "relative"; // ADDED
        root.style.flex = "1"; // ADDED
        const button = document.createElement("button"); // ADDED
        button.type = "button"; // ADDED
        button.style.width = "100%"; // ADDED
        button.style.padding = "6px"; // ADDED
        button.style.border = "1px solid #bbb"; // ADDED
        button.style.borderRadius = "6px"; // ADDED
        button.style.background = "#fff"; // ADDED
        button.style.textAlign = "left"; // ADDED
        const panel = document.createElement("div"); // ADDED
        panel.style.position = "absolute"; // ADDED
        panel.style.zIndex = "10000"; // ADDED
        panel.style.left = "0"; // ADDED
        panel.style.right = "0"; // ADDED
        panel.style.top = "100%"; // ADDED
        panel.style.marginTop = "3px"; // ADDED
        panel.style.padding = "6px"; // ADDED
        panel.style.border = "1px solid #bbb"; // ADDED
        panel.style.borderRadius = "6px"; // ADDED
        panel.style.background = "#fff"; // ADDED
        panel.style.boxShadow = "0 8px 20px rgba(0,0,0,0.18)"; // ADDED
        panel.style.display = "none"; // ADDED
        const search = document.createElement("input"); // ADDED
        search.type = "search"; // ADDED
        search.placeholder = "Search city, country, or region"; // ADDED
        search.style.width = "100%"; // ADDED
        search.style.marginBottom = "6px"; // ADDED
        const list = document.createElement("div"); // ADDED
        list.style.maxHeight = "260px"; // ADDED
        list.style.overflow = "auto"; // ADDED
        panel.appendChild(search); // ADDED
        panel.appendChild(list); // ADDED
        root.appendChild(button); // ADDED
        root.appendChild(panel); // ADDED

        function selectedCity() { return cityRows.find(city => String(city.city_id) === currentValue) || null; } // ADDED
        function updateButton() { button.textContent = selectedCity() ? fullCityLabel(selectedCity()) : "Select a city..."; } // ADDED
        function closePicker() { isOpen = false; panel.style.display = "none"; } // ADDED
        function renderHeader(text, level) { // ADDED
            const header = document.createElement("div"); // ADDED
            header.textContent = text; // ADDED
            header.style.fontWeight = level === 1 ? "700" : "600"; // ADDED
            header.style.margin = level === 1 ? "8px 0 3px" : "5px 0 2px 12px"; // ADDED
            header.style.color = "#374151"; // ADDED
            list.appendChild(header); // ADDED
        } // ADDED
        function chooseCity(city) { // ADDED
            currentValue = String(city.city_id); // ADDED
            updateButton(); // ADDED
            closePicker(); // ADDED
            root.dispatchEvent(new Event("change", { bubbles: true })); // ADDED
        } // ADDED
        function renderList() { // ADDED
            const filter = normalizeCityGeoText(search.value).toLowerCase(); // ADDED
            const visible = cityRows.filter(city => !filter || citySearchText(city).indexOf(filter) >= 0); // ADDED
            list.innerHTML = ""; // ADDED
            let lastCountry = null; // ADDED
            let lastRegion = null; // ADDED
            if (!visible.length) { // ADDED
                const empty = document.createElement("div"); // ADDED
                empty.textContent = "No matching cities"; // ADDED
                empty.style.color = "#6b7280"; // ADDED
                empty.style.padding = "6px"; // ADDED
                list.appendChild(empty); // ADDED
                return; // ADDED
            } // ADDED
            visible.forEach(city => { // ADDED
                const country = cityCountryLabel(city); // ADDED
                const region = cityRegionLabel(city); // ADDED
                if (country !== lastCountry) { renderHeader(country, 1); lastCountry = country; lastRegion = null; } // ADDED
                if (region !== lastRegion) { renderHeader(region, 2); lastRegion = region; } // ADDED
                const item = document.createElement("button"); // ADDED
                item.type = "button"; // ADDED
                item.textContent = cityDisplayLabel(city); // ADDED
                item.style.display = "block"; // ADDED
                item.style.width = "100%"; // ADDED
                item.style.margin = "1px 0"; // ADDED
                item.style.padding = "4px 6px 4px 24px"; // ADDED
                item.style.border = "0"; // ADDED
                item.style.borderRadius = "4px"; // ADDED
                item.style.background = String(city.city_id) === currentValue ? "#e5f0ff" : "#fff"; // ADDED
                item.style.textAlign = "left"; // ADDED
                item.addEventListener("click", () => chooseCity(city)); // ADDED
                list.appendChild(item); // ADDED
            }); // ADDED
        } // ADDED
        function openPicker() { isOpen = true; panel.style.display = "block"; renderList(); search.focus(); } // ADDED
        Object.defineProperty(root, "value", { // ADDED
            get() { return currentValue; }, // ADDED
            set(value) { currentValue = String(value || ""); updateButton(); } // ADDED
        }); // ADDED
        root.setCities = function (nextCities, selectedValue) { // ADDED
            cityRows = sortedCities(nextCities); // ADDED
            currentValue = String(selectedValue || (cityRows[0] && cityRows[0].city_id || "")); // ADDED
            updateButton(); // ADDED
            renderList(); // ADDED
        }; // ADDED
        button.addEventListener("click", () => { isOpen ? closePicker() : openPicker(); }); // ADDED
        search.addEventListener("input", renderList); // ADDED
        search.addEventListener("keydown", evt => { // ADDED
            if (evt.key === "Escape") { evt.preventDefault(); closePicker(); button.focus(); } // ADDED
            if (evt.key === "Enter") { // ADDED
                const filter = normalizeCityGeoText(search.value).toLowerCase(); // ADDED
                const first = cityRows.find(city => !filter || citySearchText(city).indexOf(filter) >= 0); // ADDED
                if (first) { evt.preventDefault(); chooseCity(first); } // ADDED
            } // ADDED
        }); // ADDED
        document.addEventListener("mousedown", evt => { if (isOpen && !root.contains(evt.target)) closePicker(); }); // ADDED
        updateButton(); // ADDED
        renderList(); // ADDED
        return root; // ADDED
    } // ADDED

    async function loadCities() {
        await ensureCityGeographySchema(); // ADDED
        const sql = `
        SELECT *
        FROM Cities
        ORDER BY city_name;
      `;
        const rows = await queryAll(sql);
        return rows;
    }

    async function loadCityById(cityId) { // ADDED
        await ensureCityGeographySchema(); // ADDED
        const id = Number(cityId); // ADDED
        if (!Number.isFinite(id)) return null; // ADDED
        const rows = await queryAll("SELECT * FROM Cities WHERE city_id = ? LIMIT 1;", [id]); // ADDED
        return rows[0] || null; // ADDED
    } // ADDED

    async function cityIdentityExists(row, excludeCityId) { // CHANGED
        await ensureCityGeographySchema(); // ADDED
        const cityName = normalizeCityGeoText(row.city_name); // ADDED
        const rows = await queryAll( // ADDED
            "SELECT city_id, city_name, country_name, country_code, region_name, region_code FROM Cities WHERE LOWER(TRIM(city_name)) = LOWER(TRIM(?)) AND (? IS NULL OR city_id <> ?);", // CHANGED
            [cityName, excludeCityId == null ? null : Number(excludeCityId), excludeCityId == null ? null : Number(excludeCityId)] // ADDED
        ); // ADDED
        const countryName = normalizeCityIdentityText(row.country_name); // ADDED
        const countryCode = normalizeCityIdentityText(row.country_code); // ADDED
        const regionName = normalizeCityIdentityText(row.region_name); // ADDED
        const regionCode = normalizeCityIdentityText(row.region_code); // ADDED
        return rows.some(existing => { // ADDED
            const sameCountry = (countryCode && normalizeCityIdentityText(existing.country_code) === countryCode) || (countryName && normalizeCityIdentityText(existing.country_name) === countryName); // ADDED
            const sameRegion = (regionCode && normalizeCityIdentityText(existing.region_code) === regionCode) || (regionName && normalizeCityIdentityText(existing.region_name) === regionName); // ADDED
            return sameCountry && sameRegion; // ADDED
        }); // ADDED
    } // CHANGED

    // ------------------- Layering (garden beds, other, tiler groups) ----------------

    let __REORDERING = false;

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
        const groups = [];
        const others = [];

        for (const ch of children) {
            if (isGardenBed(ch)) beds.push(ch);
            else if (isTilerGroup(ch)) groups.push(ch);
            else others.push(ch);
        }

        // Fast check: already valid (no bed after any group)
        let seenGroup = false;
        let ok = true;
        for (const ch of children) {
            if (isTilerGroup(ch)) seenGroup = true;
            else if (isGardenBed(ch) && seenGroup) { ok = false; break; }
        }
        if (ok) return;

        const ordered = beds.concat(others, groups);

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


    function isValidGardenYear(value) { // NEW
        const n = Number(value); // NEW
        return Number.isFinite(n) && n > 1900 && n < 3000; // NEW
    } // NEW
    
    function getCurrentCalendarYear() { // NEW
        return new Date().getFullYear(); // NEW
    } // NEW
    
    function getCurrentGardenYear(moduleCell) { // NEW
        const moduleYear = getXmlAttr(moduleCell, MODULE_CURRENT_YEAR_ATTR, ""); // NEW
        if (isValidGardenYear(moduleYear)) return Math.trunc(Number(moduleYear)); // NEW
    
        return getCurrentCalendarYear(); // NEW
    } // NEW

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


    // -------------------- Rotation-aware tile placement -------------------- // NEW
    const ROTATION_EPS_DEG = 0.000001; // NEW

    function toRad(deg) { // NEW
        return (Number(deg) || 0) * Math.PI / 180; // NEW
    } // NEW

    function getTilerRotationDeg(cell) { // CHANGE
        if (!cell) return 0; // MOVED
        const style = graph.getCellStyle(cell) || {}; // MOVED
        const raw = style[mxConstants.STYLE_ROTATION] != null ? style[mxConstants.STYLE_ROTATION] : style.rotation; // NEW
        const n = Number(raw); // NEW
        return Number.isFinite(n) ? n : 0; // NEW
    } // NEW

    function setCellRotationDeg(cell, angleDeg) { // MOVED
        if (!cell) return false; // MOVED
        const n = Number(angleDeg); // MOVED
        const next = Number.isFinite(n) ? n : 0; // MOVED
        if (nearlySameNumber(getTilerRotationDeg(cell), next)) return false; // MOVED
        graph.setCellStyles(mxConstants.STYLE_ROTATION, String(next), [cell]); // MOVED
        return true; // MOVED
    } // MOVED

    function hasEffectiveRotation(groupCell) { // NEW
        const rot = Math.abs(((getTilerRotationDeg(groupCell) % 360) + 360) % 360); // NEW
        return rot > ROTATION_EPS_DEG && Math.abs(rot - 360) > ROTATION_EPS_DEG; // NEW
    } // NEW

    function groupCenterLocal(groupCell) { // NEW
        const g = groupCell && groupCell.getGeometry ? groupCell.getGeometry() : null; // NEW
        if (!g) return { x: 0, y: 0 }; // NEW
        return { x: (Number(g.width) || 0) / 2, y: (Number(g.height) || 0) / 2 }; // NEW
    } // NEW

    function rotatePointAround(point, center, angleDeg) { // NEW
        const a = toRad(angleDeg); // NEW
        const cos = Math.cos(a); // NEW
        const sin = Math.sin(a); // NEW
        const dx = point.x - center.x; // NEW
        const dy = point.y - center.y; // NEW
        return { // NEW
            x: center.x + dx * cos - dy * sin, // NEW
            y: center.y + dx * sin + dy * cos // NEW
        }; // NEW
    } // NEW

    function logicalSlotCenterLocal(r, c, spacingXpx, spacingYpx, bandPx) { // NEW
        return { // NEW
            x: GROUP_PADDING_PX + spacingXpx / 2 + c * spacingXpx, // NEW
            y: GROUP_PADDING_PX + (bandPx || GROUP_LABEL_BAND_PX) + spacingYpx / 2 + r * spacingYpx // NEW
        }; // NEW
    } // NEW

    function visualCenterFromLogicalCenter(groupCell, logicalCenter, rotationDeg) { // NEW
        return rotatePointAround(logicalCenter, groupCenterLocal(groupCell), rotationDeg); // NEW
    } // NEW

    function visualSlotCenterLocal(groupCell, r, c, spacingXpx, spacingYpx, bandPx) { // NEW
        const logical = logicalSlotCenterLocal(r, c, spacingXpx, spacingYpx, bandPx); // NEW
        return visualCenterFromLogicalCenter(groupCell, logical, getTilerRotationDeg(groupCell)); // NEW
    } // NEW

    function geometryFromVisualCenter(center, width, height) { // NEW
        return new mxGeometry(center.x - width / 2, center.y - height / 2, width, height); // NEW
    } // NEW

    function tileGeometryAtSlot(groupCell, r, c, spacingXpx, spacingYpx, iconDiamPx, bandPx) { // NEW
        const center = visualSlotCenterLocal(groupCell, r, c, spacingXpx, spacingYpx, bandPx); // NEW
        return geometryFromVisualCenter(center, iconDiamPx, iconDiamPx); // NEW
    } // NEW

    function childVisualCenterLocal(childCell, geometryOverride) { // CHANGE
        const g = geometryOverride || (childCell && childCell.getGeometry ? childCell.getGeometry() : null); // CHANGE
        if (!g) return null; // NEW
        return { x: Number(g.x) + Number(g.width) / 2, y: Number(g.y) + Number(g.height) / 2 }; // NEW
    } // NEW

    function childCenterInUnrotatedGroupSpace(groupCell, childCell, rotationDeg, geometryOverride) { // CHANGE
        const center = childVisualCenterLocal(childCell, geometryOverride); // CHANGE
        if (!center) return null; // NEW
        const rot = rotationDeg != null ? Number(rotationDeg) : getTilerRotationDeg(groupCell); // NEW
        return rotatePointAround(center, groupCenterLocal(groupCell), -rot); // NEW
    } // NEW

    function childLogicalGeometryFromVisual(groupCell, childCell, rotationDeg, geometryOverride) { // CHANGE
        const g = geometryOverride || (childCell && childCell.getGeometry ? childCell.getGeometry() : null); // CHANGE
        const center = childCenterInUnrotatedGroupSpace(groupCell, childCell, rotationDeg, geometryOverride); // CHANGE
        if (!g || !center) return null; // NEW
        return { x: center.x - g.width / 2, y: center.y - g.height / 2, w: g.width, h: g.height }; // NEW
    } // NEW

    function visualGeometryFromLogicalGeometry(groupCell, logicalGeo) { // NEW
        if (!logicalGeo) return null; // NEW
        const w = Number(logicalGeo.w); // NEW
        const h = Number(logicalGeo.h); // NEW
        const x = Number(logicalGeo.x); // NEW
        const y = Number(logicalGeo.y); // NEW
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) return null; // NEW
        const logicalCenter = { x: x + w / 2, y: y + h / 2 }; // NEW
        const visualCenter = visualCenterFromLogicalCenter(groupCell, logicalCenter, getTilerRotationDeg(groupCell)); // NEW
        return geometryFromVisualCenter(visualCenter, w, h); // NEW
    } // NEW

    function rotationValueFromStyleString(styleText) { // NEW
        if (typeof styleText !== "string") return null; // NEW
        const parts = styleText.split(";"); // NEW
        for (const part of parts) { // NEW
            const idx = part.indexOf("="); // NEW
            if (idx <= 0) continue; // NEW
            const key = part.slice(0, idx); // NEW
            if (key === mxConstants.STYLE_ROTATION || key === "rotation") return part.slice(idx + 1); // NEW
        } // NEW
        return null; // NEW
    } // NEW

    function rotationDegFromStyleString(styleText) { // NEW
        const raw = rotationValueFromStyleString(styleText); // NEW
        const n = Number(raw); // NEW
        return Number.isFinite(n) ? n : 0; // NEW
    } // NEW

    function rotationChangedFromStyleChange(change) { // NEW
        if (!change) return null; // NEW
        const cell = change.cell || null; // NEW
        if (!cell || !isTilerGroup(cell)) return null; // NEW
        const before = rotationDegFromStyleString(change.previous); // NEW
        const after = rotationDegFromStyleString(change.style); // NEW
        if (Math.abs(before - after) <= ROTATION_EPS_DEG) return null; // NEW
        return { cell, before, after }; // NEW
    } // NEW

    function changeTypeName(change) { // NEW
        return change && change.constructor && change.constructor.name ? change.constructor.name : ""; // NEW
    } // NEW

    function previousGeometryByCellIdFromChanges(changes) { // NEW
        const out = new Map(); // NEW
        for (const change of (changes || [])) { // NEW
            if (changeTypeName(change) !== "mxGeometryChange") continue; // NEW
            const cell = change.cell; // NEW
            const prev = change.previous; // NEW
            if (!cell || !cell.id || !prev || !isPlantCircle(cell)) continue; // NEW
            out.set(cell.id, prev); // NEW
        } // NEW
        return out; // NEW
    } // NEW

    function snapshotHasTiles(snapObj) { // NEW
        return !!snapObj && Array.isArray(snapObj.tiles) && snapObj.tiles.length > 0; // NEW
    } // NEW

    function resolveLayoutSnapshot(graph, groupCell, opts = {}) { // NEW
        if (opts.layoutSnapshot) return opts.layoutSnapshot; // NEW
        if (opts.useLiveSnapshot !== false) { // NEW
            const liveSnap = captureLodLayoutSnapshot(graph, groupCell, { rotationDeg: opts.previousRotationDeg }); // NEW
            if (snapshotHasTiles(liveSnap)) return liveSnap; // NEW
        } // NEW
        return readLodLayoutSnapshot(groupCell); // NEW
    } // NEW

    function collapseToSummary(graph, groupCell, abbr, spacingXpx, spacingYpx, opts = {}) { // CHANGE
        const model = graph.getModel();
        model.beginUpdate();
        try {
            // Snapshot layout BEFORE removing children so expand can restore it. 
            const snap = resolveLayoutSnapshot(graph, groupCell, opts); // CHANGE
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
            const summaryCenter = groupCenterLocal(groupCell); // NEW
            const xRel = summaryCenter.x - size / 2; // CHANGE
            const yRel = summaryCenter.y - size / 2; // CHANGE

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
                "rotation=0", // NEW
                "editable=0",
            ].join(";");


            const disabledSet = readDisabledSet(groupCell);
            applyCounts(model, groupCell, count, disabledSet);
            const actual = getNumberAttr(groupCell, ATTR_PLANT_COUNT_ACT, count);
            const y = updateGroupYield(model, groupCell, { abbr, countOverride: actual });

            // Pull unit and potential targets from attrs // RESTORE
            const unit = groupCell.getAttribute('yield_unit') || YIELD_UNIT; // RESTORE

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
    function captureLodLayoutSnapshot(graph, groupCell, opts = {}) { // CHANGE
        if (!groupCell || !isTilerGroup(groupCell)) return null;

        const kids = graph.getChildVertices(groupCell) || [];
        const tiles = [];
        const rotationDeg = opts.rotationDeg != null ? Number(opts.rotationDeg) : getTilerRotationDeg(groupCell); // NEW
        const geometryByCellId = opts.geometryByCellId || null; // NEW
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

            const overrideGeo = geometryByCellId && k.id ? geometryByCellId.get(k.id) : null; // NEW
            const logicalGeo = childLogicalGeometryFromVisual(groupCell, k, rotationDeg, overrideGeo); // CHANGE
            if (!logicalGeo) continue; // CHANGE

            tiles.push({
                r, c,
                x: logicalGeo.x, y: logicalGeo.y, w: logicalGeo.w, h: logicalGeo.h, // CHANGE
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

    function shiftLayoutSnapshotByDeltaY(snapObj, deltaY) { // NEW
        if (!snapshotHasTiles(snapObj) || !Number.isFinite(Number(deltaY)) || !deltaY) return; // NEW
        for (const tile of snapObj.tiles) { // NEW
            const y = Number(tile.y); // NEW
            if (Number.isFinite(y)) tile.y = y + deltaY; // NEW
        } // NEW
    } // NEW


    function shouldExpandLOD(graph, groupCell, spacingXpx, spacingYpx) {
        const { count } = computeGridStatsXY(groupCell, spacingXpx, spacingYpx);
        return count <= LOD_TILE_THRESHOLD;
    }

    function expandTiles(graph, groupCell, abbr, spacingXpx, spacingYpx, iconDiamPx, opts = {}) { // CHANGE

        const { bandPx } = groupLabelMetrics(groupCell);
        const fontPx = tileFontPx(iconDiamPx);
        const snapObj = resolveLayoutSnapshot(graph, groupCell, opts); // NEW
        const snapMap = snapshotTileMap(snapObj); // NEW

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
                collapseToSummary(graph, groupCell, abbr, spacingXpx, spacingYpx, { layoutSnapshot: snapObj, useLiveSnapshot: false }); // CHANGE
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
                            geo = visualGeometryFromLogicalGeometry(groupCell, { x: sx, y: sy, w, h }); // CHANGE
                            autoAttr = String(snap.auto || "0");
                            dirtyAttr = String(snap.dirty || "1");
                        }
                    }

                    // Default grid placement for non-snap tiles 
                    if (!geo) {
                        geo = tileGeometryAtSlot(groupCell, r, c, spacingXpx, spacingYpx, iconDiamPx, bandPx); // CHANGE
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

    function geometryNearlyEqual(a, b) { // NEW
        if (!a || !b) return false; // NEW
        return Math.abs((Number(a.x) || 0) - (Number(b.x) || 0)) < 0.001 && // NEW
            Math.abs((Number(a.y) || 0) - (Number(b.y) || 0)) < 0.001 && // NEW
            Math.abs((Number(a.width) || 0) - (Number(b.width) || 0)) < 0.001 && // NEW
            Math.abs((Number(a.height) || 0) - (Number(b.height) || 0)) < 0.001; // NEW
    } // NEW

    function setGeometryIfChanged(model, cell, nextGeo) { // NEW
        const cur = cell && cell.getGeometry ? cell.getGeometry() : null; // NEW
        if (!cur || !nextGeo || geometryNearlyEqual(cur, nextGeo)) return false; // NEW
        model.setGeometry(cell, nextGeo); // NEW
        return true; // NEW
    } // NEW

    function setStyleIfChanged(model, cell, nextStyle) { // NEW
        if (getStyleSafe(cell) === nextStyle) return false; // NEW
        model.setStyle(cell, nextStyle); // NEW
        return true; // NEW
    } // NEW

    function setTileAttrsIfChanged(model, cell, attrs) { // NEW
        for (const [key, value] of Object.entries(attrs || {})) { // NEW
            if (String(cell.getAttribute(key) || "") !== String(value)) { // NEW
                setCellAttrsNoTxn(model, cell, attrs); // NEW
                return true; // NEW
            } // NEW
        } // NEW
        return false; // NEW
    } // NEW

    function syncAutoTileGeometriesInPlace(graph, groupCell, abbr, spacingXpx, spacingYpx, iconDiamPx, opts = {}) { // NEW
        if (!groupCell || !isTilerGroup(groupCell) || isCollapsedLOD(groupCell)) return { changed: false, fallback: true, reason: "not-expanded" }; // NEW

        const model = graph.getModel(); // NEW
        const { bandPx } = groupLabelMetrics(groupCell); // NEW
        const fontPx = tileFontPx(iconDiamPx); // NEW
        const nextStyle = plantCircleStyle(fontPx || tileFontPx(iconDiamPx)); // NEW
        const { rows, cols, count } = computeGridStatsXY(groupCell, spacingXpx, spacingYpx); // NEW
        if (count > MAX_TILES) return { changed: false, fallback: true, reason: "max-tiles" }; // NEW

        const kids = graph.getChildVertices(groupCell) || []; // NEW
        const slotMap = new Map(); // NEW
        const occupiedDisabledAutoTiles = []; // NEW
        const disabledSet = readDisabledSet(groupCell); // NEW
        const snapObj = resolveLayoutSnapshot(graph, groupCell, opts); // NEW
        const snapMap = snapshotTileMap(snapObj); // NEW

        for (const k of kids) { // NEW
            if (k && k.getAttribute && k.getAttribute("lod_summary") === "1") return { changed: false, fallback: true, reason: "summary-child" }; // NEW
            if (!isPlantCircle(k)) continue; // NEW
            if (!hasTileRC(k)) return { changed: false, fallback: true, reason: "missing-slot" }; // NEW

            const r = Number(k.getAttribute("tile_r")); // NEW
            const c = Number(k.getAttribute("tile_c")); // NEW
            if (!Number.isFinite(r) || !Number.isFinite(c) || r < 0 || c < 0) return { changed: false, fallback: true, reason: "bad-slot" }; // NEW

            const key = `${r},${c}`; // NEW
            if (slotMap.has(key)) return { changed: false, fallback: true, reason: "duplicate-slot" }; // NEW
            slotMap.set(key, k); // NEW

            if (disabledSet.has(key)) { // NEW
                if (isAutoTile(k) && !isDirty(k)) occupiedDisabledAutoTiles.push(k); // NEW
                else return { changed: false, fallback: true, reason: "manual-disabled-slot" }; // NEW
            } // NEW

            if (!(isAutoTile(k) && !isDirty(k)) && !snapMap.has(key)) { // NEW
                return { changed: false, fallback: true, reason: "manual-without-snapshot" }; // NEW
            } // NEW
            if (!(isAutoTile(k) && !isDirty(k))) { // NEW
                const snap = snapMap.get(key); // NEW
                if (!Number.isFinite(Number(snap.x)) || !Number.isFinite(Number(snap.y))) { // NEW
                    return { changed: false, fallback: true, reason: "bad-snapshot" }; // NEW
                } // NEW
            } // NEW
        } // NEW

        let changed = false; // NEW
        const toRemove = occupiedDisabledAutoTiles.slice(); // NEW
        const ownsUpdate = !opts.inTransaction; // NEW
        if (ownsUpdate) model.beginUpdate(); // NEW
        try {
            pruneDisabledToGrid(model, groupCell, rows, cols); // NEW
            const disabledSet2 = readDisabledSet(groupCell); // NEW
            const { actual } = applyCounts(model, groupCell, count, disabledSet2); // NEW
            updateGroupYield(model, groupCell, { abbr, countOverride: actual }); // NEW

            for (const [key, tile] of slotMap.entries()) { // NEW
                const parts = key.split(","); // NEW
                const r = Number(parts[0]); // NEW
                const c = Number(parts[1]); // NEW
                if (r >= rows || c >= cols || disabledSet2.has(key)) { // NEW
                    if (isAutoTile(tile) && !isDirty(tile)) toRemove.push(tile); // NEW
                    else if (isChildOutOfGroupBounds(groupCell, tile)) toRemove.push(tile); // NEW
                    continue; // NEW
                } // NEW

                const snap = snapMap.get(key); // NEW
                let geo = null; // NEW
                let autoAttr = "1"; // NEW
                let dirtyAttr = "0"; // NEW

                if (snap && !(isAutoTile(tile) && !isDirty(tile))) { // NEW
                    const sx = Number(snap.x); // NEW
                    const sy = Number(snap.y); // NEW
                    geo = visualGeometryFromLogicalGeometry(groupCell, { x: sx, y: sy, w: iconDiamPx, h: iconDiamPx }); // NEW
                    autoAttr = String(snap.auto || "0"); // NEW
                    dirtyAttr = String(snap.dirty || "1"); // NEW
                } else {
                    geo = tileGeometryAtSlot(groupCell, r, c, spacingXpx, spacingYpx, iconDiamPx, bandPx); // NEW
                }

                changed = setGeometryIfChanged(model, tile, geo) || changed; // NEW
                changed = setStyleIfChanged(model, tile, nextStyle) || changed; // NEW
                changed = setTileAttrsIfChanged(model, tile, { // NEW
                    plant_tiler: "1", // NEW
                    auto: autoAttr, // NEW
                    abbr: abbr, // NEW
                    label: abbr, // NEW
                    tile_r: String(r), // NEW
                    tile_c: String(c), // NEW
                    dirty: dirtyAttr // NEW
                }) || changed; // NEW
            } // NEW

            if (toRemove.length) { // NEW
                graph.removeCells(Array.from(new Set(toRemove))); // NEW
                changed = true; // NEW
            } // NEW

            for (let r = 0; r < rows; r++) { // NEW
                for (let c = 0; c < cols; c++) { // NEW
                    const key = `${r},${c}`; // NEW
                    if (disabledSet2.has(key) || slotMap.has(key)) continue; // NEW
                    const v = addTileAtSlot(graph, groupCell, abbr, r, c, spacingXpx, spacingYpx, iconDiamPx, disabledSet2, bandPx, fontPx); // NEW
                    if (v) changed = true; // NEW
                } // NEW
            } // NEW

            setCollapsedFlag(model, groupCell, false); // NEW
        } finally {
            if (ownsUpdate) model.endUpdate(); // NEW
        }

        return { changed, fallback: false }; // NEW
    } // NEW


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

    function finiteNumberOrNull(value) { // ADDED
        const n = Number(value); // ADDED
        return Number.isFinite(n) ? n : null; // ADDED
    } // ADDED

    function cToDisplayTemp(c, units) { // ADDED
        const n = finiteNumberOrNull(c); // ADDED
        if (n == null) return ""; // ADDED
        return units === "imperial" ? String(Math.round((n * 9 / 5 + 32) * 10) / 10) : String(Math.round(n * 10) / 10); // ADDED
    } // ADDED

    function displayTempToC(value, units) { // ADDED
        const n = finiteNumberOrNull(value); // ADDED
        if (n == null) return null; // ADDED
        return units === "imperial" ? (n - 32) * 5 / 9 : n; // ADDED
    } // ADDED

    function formatDbNumber(value) { // ADDED
        const n = finiteNumberOrNull(value); // ADDED
        return n == null ? null : String(Math.round(n * 1000) / 1000); // ADDED
    } // ADDED

    function mmDdToDoyNoLeap(value) { // ADDED
        const match = /^(\d{1,2})-(\d{1,2})$/.exec(String(value || "").trim()); // ADDED
        if (!match) return null; // ADDED
        const month = Number(match[1]); // ADDED
        const day = Number(match[2]); // ADDED
        const monthDays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // ADDED
        if (month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]) return null; // ADDED
        return monthDays.slice(0, month - 1).reduce((sum, item) => sum + item, 0) + day; // ADDED
    } // ADDED

    function doyToMmDdNoLeap(value) { // ADDED
        let doy = Number(value); // ADDED
        if (!Number.isInteger(doy) || doy < 1 || doy > 365) return ""; // ADDED
        const monthDays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // ADDED
        let month = 1; // ADDED
        while (doy > monthDays[month - 1]) { doy -= monthDays[month - 1]; month += 1; } // ADDED
        return `${String(month).padStart(2, "0")}-${String(doy).padStart(2, "0")}`; // ADDED
    } // ADDED

    function setTooltip(el, text) { // ADDED
        if (!el) return; // ADDED
        el.title = String(text || ""); // ADDED
        if (el.tagName === "BUTTON") el.setAttribute("aria-label", String(text || el.textContent || "")); // ADDED
    } // ADDED

    function refreshDiagramCityNameById(model, root, city) { // ADDED
        if (!model || !root || !city || city.city_id == null) return; // ADDED
        const cityId = String(city.city_id); // ADDED
        const nextName = String(city.city_name || ""); // ADDED
        function visit(cell) { // ADDED
            if (!cell) return; // ADDED
            if (String(cell.getAttribute?.("city_id") || "") === cityId) setCellAttrsNoTxn(model, cell, { city_name: nextName }); // ADDED
            const count = typeof model.getChildCount === "function" ? model.getChildCount(cell) : 0; // ADDED
            for (let i = 0; i < count; i += 1) visit(model.getChildAt(cell, i)); // ADDED
        } // ADDED
        visit(root); // ADDED
    } // ADDED

    // Default bed dimensions are stored in centimeters; dialog units are display-only. // CHANGE
    function positiveFiniteNumber(value) { // CHANGE
        const n = Number(value); // CHANGE
        return Number.isFinite(n) && n > 0 ? n : null; // CHANGE
    } // CHANGE

    function formatBedCmAttr(cm) { // CHANGE
        return String(Math.round((Number(cm) || 0) * 1000) / 1000); // CHANGE
    } // CHANGE

    function formatBedDisplayValue(value) { // CHANGE
        const rounded = Math.round((Number(value) || 0) * 1000) / 1000; // CHANGE
        return String(rounded); // CHANGE
    } // CHANGE

    function defaultBedDimensionsCmForUnits(units) { // CHANGE
        if (units === "metric") return { widthCm: DEFAULT_METRIC_BED_WIDTH_CM, lengthCm: DEFAULT_METRIC_BED_LENGTH_CM }; // CHANGE
        if (units === "imperial") return { widthCm: DEFAULT_IMPERIAL_BED_WIDTH_CM, lengthCm: DEFAULT_IMPERIAL_BED_LENGTH_CM }; // CHANGE
        return null; // CHANGE
    } // CHANGE

    function getSavedDefaultBedDimensionsCm(moduleCell) { // CHANGE
        const widthCm = positiveFiniteNumber(getXmlAttr(moduleCell, DEFAULT_BED_WIDTH_CM_ATTR, "")); // CHANGE
        const lengthCm = positiveFiniteNumber(getXmlAttr(moduleCell, DEFAULT_BED_LENGTH_CM_ATTR, "")); // CHANGE
        return widthCm && lengthCm ? { widthCm, lengthCm } : null; // CHANGE
    } // CHANGE

    function getDefaultBedDimensionsCm(moduleCell) { // CHANGE
        const saved = getSavedDefaultBedDimensionsCm(moduleCell); // CHANGE
        if (saved) return saved; // CHANGE
        return defaultBedDimensionsCmForUnits(getXmlAttr(moduleCell, "unit_system", "")); // CHANGE
    } // CHANGE

    function bedDisplayUnitLabel(units) { // CHANGE
        return units === "imperial" ? "ft" : "m"; // CHANGE
    } // CHANGE

    function bedDimensionCmToDisplay(cm, units) { // CHANGE
        return units === "imperial" ? cm / CM_PER_FOOT : cm / CM_PER_METER; // CHANGE
    } // CHANGE

    function bedDimensionDisplayToCm(value, units) { // CHANGE
        const n = positiveFiniteNumber(value); // CHANGE
        if (!n) return null; // CHANGE
        return units === "imperial" ? n * CM_PER_FOOT : n * CM_PER_METER; // CHANGE
    } // CHANGE


    function hasGardenSettingsSet(moduleCell) {
        if (!(moduleCell && moduleCell.getAttribute)) return false;
        const city = String(moduleCell.getAttribute("city_id") || moduleCell.getAttribute("city_name") || "").trim(); // CHANGED
        const units = String(moduleCell.getAttribute("unit_system") || "").trim();
        return !!(city && units && getSavedDefaultBedDimensionsCm(moduleCell)); // CHANGE
    }

    function getModuleMarginFromStyle(moduleCell, defaultPx = 100) { // NEW
        const fallback = Number.isInteger(defaultPx) && defaultPx >= 0 ? defaultPx : 100; // NEW
        const match = getStyleSafe(moduleCell).match(/(?:^|;)module_margin=(\d+)(?=;|$)/); // NEW
        return match ? parseInt(match[1], 10) : fallback; // NEW
    } // NEW

    function getGardenModuleMargin(moduleCell) { // NEW
        const modulesApi = graph.__trellisModules; // NEW
        if (modulesApi && typeof modulesApi.getModuleMargin === "function") return modulesApi.getModuleMargin(moduleCell, 100); // NEW
        return getModuleMarginFromStyle(moduleCell, 100); // NEW
    } // NEW

    function readModuleMarginInput(inputEl) { // NEW
        const raw = String(inputEl && inputEl.value || "").trim(); // NEW
        if (!/^\d+$/.test(raw)) return null; // NEW
        const n = Number(raw); // NEW
        return Number.isSafeInteger(n) && n >= 0 ? n : null; // NEW
    } // NEW

    function setGardenModuleMargin(moduleCell, marginPx) { // NEW
        const modulesApi = graph.__trellisModules; // NEW
        if (modulesApi && typeof modulesApi.setModuleMargin === "function") { // NEW
            modulesApi.setModuleMargin(moduleCell, marginPx); // NEW
            return; // NEW
        } // NEW
        const graphModel = graph.getModel && graph.getModel(); // NEW
        if (graphModel && graphModel.setStyle) graphModel.setStyle(moduleCell, upsertStyleKV(getStyleSafe(moduleCell), "module_margin", String(marginPx))); // NEW
        if (graph.fireEvent && typeof mxEventObject === "function") { // NEW
            graph.fireEvent(new mxEventObject("usl:requestApplyModuleMargins", "cell", moduleCell)); // NEW
        } else if (graph.refresh) { // NEW
            graph.refresh(moduleCell); // NEW
        } // NEW
    } // NEW

    async function saveCityRecord(row, existingCityId = null) { // ADDED
        await ensureCityGeographySchema(); // ADDED
        const cityId = Number(row.city_id); // ADDED
        const cityName = String(row.city_name || "").trim(); // ADDED
        const countryName = normalizeCityGeoText(row.country_name); // ADDED
        const regionName = normalizeCityGeoText(row.region_name); // ADDED
        if (!Number.isInteger(cityId) || cityId <= 0) throw new Error("City ID is required and must be a positive integer."); // ADDED
        if (!cityName) throw new Error("City name is required."); // ADDED
        if (!countryName) throw new Error("Country is required."); // ADDED
        if (!regionName) throw new Error("Region/state is required. Use Unspecified when no region applies."); // ADDED
        if (await cityIdentityExists(row, existingCityId == null ? null : cityId)) throw new Error("A city with that city/country/region already exists."); // CHANGED
        const lat = finiteNumberOrNull(row.latitude); // ADDED
        const lon = finiteNumberOrNull(row.longitude); // ADDED
        if (lat == null || lat < -66.5 || lat > 66.5) throw new Error("Latitude is required and must be between -66.5 and 66.5."); // ADDED
        if (lon == null || lon < -180 || lon > 180) throw new Error("Longitude is required and must be between -180 and 180."); // ADDED
        if (!String(row.timezone || "").trim()) throw new Error("Timezone is required."); // ADDED
        if (!Number.isInteger(Number(row.last_spring_frost_p50_doy))) throw new Error("Spring p50 frost date is required."); // ADDED
        if (!Number.isInteger(Number(row.first_fall_frost_p50_doy))) throw new Error("Fall p50 frost date is required."); // ADDED
        for (let m = 1; m <= 12; m += 1) { // ADDED
            if (finiteNumberOrNull(row[`avg_monthly_low_c${m}`]) == null || finiteNumberOrNull(row[`avg_monthly_high_c${m}`]) == null) { // ADDED
                throw new Error("All monthly low/high normals are required."); // ADDED
            } // ADDED
        } // ADDED
        const columns = [ // ADDED
            "city_id", "city_name", "country_name", "country_code", "region_name", "region_code", "latitude", "longitude", "timezone", "gdd_annual", "gdd_base_c", // CHANGED
            "last_spring_frost_doy", "last_spring_frost_p90_doy", "last_spring_frost_p50_doy", "last_spring_frost_p10_doy", // ADDED
            "first_fall_frost_doy", "first_fall_frost_p90_doy", "first_fall_frost_p50_doy", "first_fall_frost_p10_doy" // ADDED
        ]; // ADDED
        for (let m = 1; m <= 12; m += 1) columns.push(`avg_monthly_low_c${m}`, `avg_monthly_high_c${m}`); // ADDED
        const values = columns.map(col => row[col] == null || row[col] === "" ? null : row[col]); // ADDED
        const exists = await loadCityById(cityId); // ADDED
        if (exists && existingCityId == null) throw new Error("A city with that ID already exists."); // ADDED
        if (exists) { // ADDED
            const assignments = columns.filter(col => col !== "city_id").map(col => `${col} = ?`).join(", "); // ADDED
            const updateValues = columns.filter(col => col !== "city_id").map(col => row[col] == null || row[col] === "" ? null : row[col]); // ADDED
            await execAll(`UPDATE Cities SET ${assignments} WHERE city_id = ?;`, updateValues.concat(cityId)); // ADDED
        } else { // ADDED
            await execAll(`INSERT INTO Cities (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")});`, values); // ADDED
        } // ADDED
        return await loadCityById(cityId); // ADDED
    } // ADDED

    async function showCityManagerDialog(ui, graph, selectedCityId, units, onSaved) { // ADDED
        const model = graph.getModel(); // ADDED
        let cities = await loadCities(); // ADDED
        let current = cities.find(city => String(city.city_id) === String(selectedCityId)) || cities[0] || null; // ADDED
        let editingExistingId = current ? Number(current.city_id) : null; // ADDED
        const displayUnits = units === "imperial" ? "imperial" : "metric"; // ADDED
        const tempUnit = displayUnits === "imperial" ? "F" : "C"; // ADDED

        const div = document.createElement("div"); // ADDED
        div.style.padding = "10px"; // ADDED
        div.style.width = "760px"; // ADDED
        div.style.maxHeight = "680px"; // ADDED
        div.style.overflow = "auto"; // ADDED

        const title = document.createElement("div"); // ADDED
        title.textContent = "City Manager"; // ADDED
        title.style.fontWeight = "600"; // ADDED
        title.style.marginBottom = "8px"; // ADDED
        div.appendChild(title); // ADDED

        const err = document.createElement("div"); // ADDED
        err.style.color = "#b91c1c"; // ADDED
        err.style.fontSize = "12px"; // ADDED
        err.style.marginBottom = "8px"; // ADDED
        err.style.display = "none"; // ADDED
        div.appendChild(err); // ADDED

        function showError(message) { err.textContent = message; err.style.display = "block"; } // ADDED
        function clearError() { err.textContent = ""; err.style.display = "none"; } // ADDED
        function input(type = "text", width = "100%") { // ADDED
            const el = document.createElement("input"); // ADDED
            el.type = type; // ADDED
            el.style.width = width; // ADDED
            el.style.padding = "5px"; // ADDED
            return el; // ADDED
        } // ADDED
        function field(label, el, tooltip) { // ADDED
            const wrap = document.createElement("div"); // ADDED
            wrap.style.display = "flex"; // ADDED
            wrap.style.alignItems = "center"; // ADDED
            wrap.style.gap = "8px"; // ADDED
            wrap.style.margin = "6px 0"; // ADDED
            const lab = document.createElement("label"); // ADDED
            lab.textContent = label; // ADDED
            lab.style.minWidth = "150px"; // ADDED
            setTooltip(lab, tooltip); // ADDED
            setTooltip(el, tooltip); // ADDED
            wrap.appendChild(lab); // ADDED
            wrap.appendChild(el); // ADDED
            div.appendChild(wrap); // ADDED
            return el; // ADDED
        } // ADDED

        const pickerRow = document.createElement("div"); // ADDED
        pickerRow.style.display = "flex"; // ADDED
        pickerRow.style.gap = "8px"; // ADDED
        pickerRow.style.alignItems = "center"; // ADDED
        pickerRow.style.marginBottom = "8px"; // ADDED
        const cityPicker = document.createElement("select"); // ADDED
        cityPicker.style.flex = "1"; // ADDED
        cityPicker.style.padding = "6px"; // ADDED
        const newBtn = mxUtils.button("New City", () => { // ADDED
            const maxId = cities.reduce((max, city) => Math.max(max, Number(city.city_id) || 0), 0); // ADDED
            editingExistingId = null; // ADDED
            fillForm({ city_id: maxId + 1, city_name: "", country_name: "", region_name: "Unspecified", timezone: "America/Los_Angeles" }, false); // CHANGED
        }); // ADDED
        setTooltip(newBtn, "Create a scheduler-ready city record with required climate fields."); // ADDED
        pickerRow.appendChild(cityPicker); // ADDED
        pickerRow.appendChild(newBtn); // ADDED
        div.appendChild(pickerRow); // ADDED

        const idInput = field("City ID:", input("number"), "Stable city_id used by diagrams; it cannot be changed for existing cities."); // ADDED
        const nameInput = field("City name:", input("text"), "Required city-only display name, for example Vancouver."); // CHANGED
        const countryNameInput = field("Country:", input("text"), "Required country name, for example Canada."); // ADDED
        const countryCodeInput = field("Country code:", input("text"), "Optional ISO-style country code, for example CA."); // ADDED
        const regionNameInput = field("Region/state:", input("text"), "Required state, province, or region name. Use Unspecified when no region applies."); // ADDED
        const regionCodeInput = field("Region code:", input("text"), "Optional compact state/province code, for example BC."); // ADDED
        const latInput = field("Latitude:", input("number"), "Required decimal degrees, -66.5 to 66.5, used for photoperiod checks."); // ADDED
        const lonInput = field("Longitude:", input("number"), "Required decimal degrees, -180 to 180."); // ADDED
        const tzInput = field("Timezone:", input("text"), "Required IANA timezone, for example America/Los_Angeles."); // ADDED
        const gddAnnualInput = field("Annual GDD:", input("number"), "Optional annual growing-degree-days calibration target."); // ADDED
        const gddBaseInput = field("GDD base C:", input("number"), "Optional Celsius base temperature for city annual GDD calibration."); // ADDED
        const springP90Input = field("Spring frost p90:", input("text"), "Optional MM-DD last spring frost risk date; Feb 29 is not valid."); // ADDED
        const springP50Input = field("Spring frost p50:", input("text"), "Required MM-DD last spring frost date; Feb 29 is not valid."); // ADDED
        const springP10Input = field("Spring frost p10:", input("text"), "Optional MM-DD last spring frost risk date; Feb 29 is not valid."); // ADDED
        const fallP90Input = field("Fall frost p90:", input("text"), "Optional MM-DD first fall frost risk date; Feb 29 is not valid."); // ADDED
        const fallP50Input = field("Fall frost p50:", input("text"), "Required MM-DD first fall frost date; Feb 29 is not valid."); // ADDED
        const fallP10Input = field("Fall frost p10:", input("text"), "Optional MM-DD first fall frost risk date; Feb 29 is not valid."); // ADDED

        const monthTitle = document.createElement("div"); // ADDED
        monthTitle.textContent = `Monthly normals (${tempUnit})`; // ADDED
        monthTitle.style.fontWeight = "600"; // ADDED
        monthTitle.style.margin = "12px 0 6px"; // ADDED
        div.appendChild(monthTitle); // ADDED
        const monthGrid = document.createElement("div"); // ADDED
        monthGrid.style.display = "grid"; // ADDED
        monthGrid.style.gridTemplateColumns = "70px 1fr 1fr"; // ADDED
        monthGrid.style.gap = "4px 8px"; // ADDED
        div.appendChild(monthGrid); // ADDED
        ["Month", "Low", "High"].forEach(text => { // ADDED
            const cell = document.createElement("div"); // ADDED
            cell.textContent = text; // ADDED
            cell.style.fontWeight = "600"; // ADDED
            monthGrid.appendChild(cell); // ADDED
        }); // ADDED
        const monthInputs = []; // ADDED
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]; // ADDED
        monthNames.forEach((name, index) => { // ADDED
            const low = input("number"); // ADDED
            const high = input("number"); // ADDED
            low.step = high.step = "0.1"; // ADDED
            setTooltip(low, `Required average monthly low for ${name}, shown in ${tempUnit}.`); // ADDED
            setTooltip(high, `Required average monthly high for ${name}, shown in ${tempUnit}.`); // ADDED
            const lab = document.createElement("div"); // ADDED
            lab.textContent = name; // ADDED
            monthGrid.appendChild(lab); // ADDED
            monthGrid.appendChild(low); // ADDED
            monthGrid.appendChild(high); // ADDED
            monthInputs[index + 1] = { low, high }; // ADDED
        }); // ADDED

        function refreshPicker(selectedId) { // ADDED
            while (cityPicker.firstChild) cityPicker.removeChild(cityPicker.firstChild); // ADDED
            sortedCities(cities).forEach(city => { // CHANGED
                const opt = document.createElement("option"); // ADDED
                opt.value = String(city.city_id); // ADDED
                opt.textContent = `${fullCityLabel(city)} (#${city.city_id})`; // CHANGED
                cityPicker.appendChild(opt); // ADDED
            }); // ADDED
            if (selectedId != null) cityPicker.value = String(selectedId); // ADDED
        } // ADDED

        function fillForm(city, existing) { // ADDED
            current = city || {}; // ADDED
            editingExistingId = existing ? Number(city.city_id) : null; // ADDED
            idInput.value = current.city_id || ""; // ADDED
            idInput.disabled = !!existing; // ADDED
            nameInput.value = current.city_name || ""; // ADDED
            countryNameInput.value = current.country_name || ""; // ADDED
            countryCodeInput.value = current.country_code || ""; // ADDED
            regionNameInput.value = current.region_name || ""; // ADDED
            regionCodeInput.value = current.region_code || ""; // ADDED
            latInput.value = current.latitude ?? ""; // ADDED
            lonInput.value = current.longitude ?? ""; // ADDED
            tzInput.value = current.timezone || ""; // ADDED
            gddAnnualInput.value = current.gdd_annual ?? ""; // ADDED
            gddBaseInput.value = current.gdd_base_c ?? ""; // ADDED
            springP90Input.value = doyToMmDdNoLeap(current.last_spring_frost_p90_doy); // ADDED
            springP50Input.value = doyToMmDdNoLeap(current.last_spring_frost_p50_doy || current.last_spring_frost_doy); // ADDED
            springP10Input.value = doyToMmDdNoLeap(current.last_spring_frost_p10_doy); // ADDED
            fallP90Input.value = doyToMmDdNoLeap(current.first_fall_frost_p90_doy); // ADDED
            fallP50Input.value = doyToMmDdNoLeap(current.first_fall_frost_p50_doy || current.first_fall_frost_doy); // ADDED
            fallP10Input.value = doyToMmDdNoLeap(current.first_fall_frost_p10_doy); // ADDED
            for (let m = 1; m <= 12; m += 1) { // ADDED
                monthInputs[m].low.value = cToDisplayTemp(current[`avg_monthly_low_c${m}`], displayUnits); // ADDED
                monthInputs[m].high.value = cToDisplayTemp(current[`avg_monthly_high_c${m}`], displayUnits); // ADDED
            } // ADDED
        } // ADDED

        cityPicker.addEventListener("change", () => { // ADDED
            const next = cities.find(city => String(city.city_id) === String(cityPicker.value)); // ADDED
            fillForm(next, true); // ADDED
        }); // ADDED

        function readDate(inputEl, required, label) { // ADDED
            const raw = String(inputEl.value || "").trim(); // ADDED
            if (!raw && !required) return null; // ADDED
            const doy = mmDdToDoyNoLeap(raw); // ADDED
            if (!doy) throw new Error(`${label} must be an MM-DD date in a non-leap year.`); // ADDED
            return doy; // ADDED
        } // ADDED

        function readForm() { // ADDED
            const row = { // ADDED
                city_id: Number(idInput.value), // ADDED
                city_name: String(nameInput.value || "").trim(), // ADDED
                country_name: String(countryNameInput.value || "").trim(), // ADDED
                country_code: String(countryCodeInput.value || "").trim(), // ADDED
                region_name: String(regionNameInput.value || "").trim(), // ADDED
                region_code: String(regionCodeInput.value || "").trim(), // ADDED
                latitude: finiteNumberOrNull(latInput.value), // ADDED
                longitude: finiteNumberOrNull(lonInput.value), // ADDED
                timezone: String(tzInput.value || "").trim(), // ADDED
                gdd_annual: finiteNumberOrNull(gddAnnualInput.value), // ADDED
                gdd_base_c: finiteNumberOrNull(gddBaseInput.value), // ADDED
                last_spring_frost_p90_doy: readDate(springP90Input, false, "Spring frost p90"), // ADDED
                last_spring_frost_p50_doy: readDate(springP50Input, true, "Spring frost p50"), // ADDED
                last_spring_frost_p10_doy: readDate(springP10Input, false, "Spring frost p10"), // ADDED
                first_fall_frost_p90_doy: readDate(fallP90Input, false, "Fall frost p90"), // ADDED
                first_fall_frost_p50_doy: readDate(fallP50Input, true, "Fall frost p50"), // ADDED
                first_fall_frost_p10_doy: readDate(fallP10Input, false, "Fall frost p10") // ADDED
            }; // ADDED
            row.last_spring_frost_doy = row.last_spring_frost_p50_doy; // ADDED
            row.first_fall_frost_doy = row.first_fall_frost_p50_doy; // ADDED
            for (let m = 1; m <= 12; m += 1) { // ADDED
                row[`avg_monthly_low_c${m}`] = formatDbNumber(displayTempToC(monthInputs[m].low.value, displayUnits)); // ADDED
                row[`avg_monthly_high_c${m}`] = formatDbNumber(displayTempToC(monthInputs[m].high.value, displayUnits)); // ADDED
            } // ADDED
            return row; // ADDED
        } // ADDED

        const btnRow = document.createElement("div"); // ADDED
        btnRow.style.display = "flex"; // ADDED
        btnRow.style.justifyContent = "flex-end"; // ADDED
        btnRow.style.gap = "8px"; // ADDED
        btnRow.style.marginTop = "12px"; // ADDED
        const closeBtn = mxUtils.button("Close", () => ui.hideDialog()); // ADDED
        const saveBtn = mxUtils.button("Save City", async () => { // ADDED
            clearError(); // ADDED
            try { // ADDED
                const saved = await saveCityRecord(readForm(), editingExistingId); // ADDED
                cities = await loadCities(); // ADDED
                refreshPicker(saved.city_id); // ADDED
                fillForm(saved, true); // ADDED
                model.beginUpdate(); // ADDED
                try { refreshDiagramCityNameById(model, model.getRoot(), saved); } finally { model.endUpdate(); } // ADDED
                if (typeof onSaved === "function") onSaved(saved); // ADDED
            } catch (e) { // ADDED
                showError(e && e.message ? e.message : String(e)); // ADDED
            } // ADDED
        }); // ADDED
        setTooltip(saveBtn, "Save the city climate record to the Trellis database."); // ADDED
        btnRow.appendChild(closeBtn); // ADDED
        btnRow.appendChild(saveBtn); // ADDED
        div.appendChild(btnRow); // ADDED

        refreshPicker(current?.city_id); // ADDED
        fillForm(current || { city_id: 1, timezone: "America/Los_Angeles" }, !!current); // ADDED
        ui.showDialog(div, 800, 720, true, true); // CHANGE
        elevateTrellisDialog(); // NEW
    } // ADDED


    // garden settings dialog (city + units + default bed dimensions) // CHANGE
    async function showGardenSettingsDialog(ui, graph, moduleCell, onClose) { // CHANGE
        const model = graph.getModel();
        const curGardenName = String(getXmlAttr(moduleCell, "garden_name", "") || getXmlAttr(moduleCell, "label", "") || "Garden").trim() || "Garden"; // ADDED
        const curCityId = getXmlAttr(moduleCell, "city_id", ""); // ADDED
        const curCity = getXmlAttr(moduleCell, "city_name", "");
        const curUnits = getXmlAttr(moduleCell, "unit_system", "");
        const curModuleMargin = getGardenModuleMargin(moduleCell); // NEW
        const savedBedDimsCm = getSavedDefaultBedDimensionsCm(moduleCell); // CHANGE
        let activeBedDisplayUnits = curUnits || ""; // CHANGE
        let bedDimensionsEdited = false; // CHANGE
        let closeNotified = false; // CHANGE

        function notifyClose() { // CHANGE
            if (closeNotified) return; // CHANGE
            closeNotified = true; // CHANGE
            if (typeof onClose === "function") onClose(); // CHANGE
        } // CHANGE

        let cities = [];
        try {
            cities = await loadCities();
        } catch (e) {
            mxUtils.alert("Error loading cities: " + e.message);
            notifyClose(); // CHANGE
            return;
        }
        // Empty city lists are allowed so the City Manager can create the first scheduler-ready city. // CHANGED

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

        function row(labelText, controlEl) { // CHANGE
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
            return { wrap, label: lab, control: controlEl }; // CHANGE
        }

        const gardenNameInput = document.createElement("input"); // ADDED
        gardenNameInput.type = "text"; // ADDED
        gardenNameInput.value = curGardenName; // ADDED
        gardenNameInput.style.flex = "1"; // ADDED
        row("Garden name:", gardenNameInput); // ADDED

        // City (mandatory)
        const citySel = makeCityTreePicker(cities, curCityId); // CHANGED

        function selectedCityRow() { // ADDED
            return cities.find(city => String(city.city_id) === String(citySel.value)) || null; // ADDED
        } // ADDED

        function refreshCityOptions(selectedCityId, selectedCityName) { // ADDED
            const selected = selectedCityId || (cities.find(city => city.city_name === selectedCityName)?.city_id) || ""; // CHANGED
            citySel.setCities(cities, selected); // CHANGED
        } // ADDED

        refreshCityOptions(curCityId, curCity); // ADDED
        const cityControl = document.createElement("div"); // ADDED
        cityControl.style.display = "flex"; // ADDED
        cityControl.style.gap = "6px"; // ADDED
        cityControl.style.flex = "1"; // ADDED
        cityControl.appendChild(citySel); // ADDED
        const manageCityBtn = mxUtils.button("Manage...", async () => { // ADDED
            await showCityManagerDialog(ui, graph, citySel.value, unitsSel.value || curUnits || "metric", async saved => { // ADDED
                cities = await loadCities(); // ADDED
                refreshCityOptions(saved.city_id, saved.city_name); // ADDED
            }); // ADDED
        }); // ADDED
        setTooltip(citySel, "Select the garden city. City climate data is managed with the adjacent button."); // ADDED
        setTooltip(manageCityBtn, "Add or edit city latitude, longitude, timezone, frost dates, and monthly normals."); // ADDED
        cityControl.appendChild(manageCityBtn); // ADDED
        row("City:", cityControl); // CHANGED

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

        const bedWidthInput = document.createElement("input"); // CHANGE
        bedWidthInput.type = "number"; // CHANGE
        bedWidthInput.step = "0.01"; // CHANGE
        bedWidthInput.min = "0.01"; // CHANGE
        bedWidthInput.style.flex = "1"; // CHANGE
        const bedWidthRow = row("Default bed width:", bedWidthInput); // CHANGE

        const bedLengthInput = document.createElement("input"); // CHANGE
        bedLengthInput.type = "number"; // CHANGE
        bedLengthInput.step = "0.01"; // CHANGE
        bedLengthInput.min = "0.01"; // CHANGE
        bedLengthInput.style.flex = "1"; // CHANGE
        const bedLengthRow = row("Default bed length:", bedLengthInput); // CHANGE
        mxEvent.addListener(bedWidthInput, "input", function () { bedDimensionsEdited = true; }); // CHANGE
        mxEvent.addListener(bedLengthInput, "input", function () { bedDimensionsEdited = true; }); // CHANGE

        const moduleMarginInput = document.createElement("input"); // NEW
        moduleMarginInput.type = "number"; // NEW
        moduleMarginInput.step = "1"; // NEW
        moduleMarginInput.min = "0"; // NEW
        moduleMarginInput.value = String(curModuleMargin); // NEW
        moduleMarginInput.style.flex = "1"; // NEW
        row("Module margin (px):", moduleMarginInput); // NEW

        function readBedInputsAsCm(units) { // CHANGE
            if (!units) return null; // CHANGE
            const widthCm = bedDimensionDisplayToCm(bedWidthInput.value, units); // CHANGE
            const lengthCm = bedDimensionDisplayToCm(bedLengthInput.value, units); // CHANGE
            return widthCm && lengthCm ? { widthCm, lengthCm } : null; // CHANGE
        } // CHANGE

        function setBedInputsFromCm(dimsCm, units) { // CHANGE
            if (!dimsCm || !units) { // CHANGE
                bedWidthInput.value = ""; // CHANGE
                bedLengthInput.value = ""; // CHANGE
                return; // CHANGE
            } // CHANGE
            bedWidthInput.value = formatBedDisplayValue(bedDimensionCmToDisplay(dimsCm.widthCm, units)); // CHANGE
            bedLengthInput.value = formatBedDisplayValue(bedDimensionCmToDisplay(dimsCm.lengthCm, units)); // CHANGE
        } // CHANGE

        function syncBedDimensionInputs(nextUnits) { // CHANGE
            const priorDims = activeBedDisplayUnits && bedDimensionsEdited ? readBedInputsAsCm(activeBedDisplayUnits) : null; // CHANGE
            const nextDims = priorDims || savedBedDimsCm || defaultBedDimensionsCmForUnits(nextUnits); // CHANGE
            const enabled = !!nextUnits; // CHANGE
            const unitLabel = enabled ? bedDisplayUnitLabel(nextUnits) : ""; // CHANGE
            activeBedDisplayUnits = nextUnits || ""; // CHANGE
            bedWidthRow.label.textContent = enabled ? `Default bed width (${unitLabel}):` : "Default bed width:"; // CHANGE
            bedLengthRow.label.textContent = enabled ? `Default bed length (${unitLabel}):` : "Default bed length:"; // CHANGE
            bedWidthInput.disabled = !enabled; // CHANGE
            bedLengthInput.disabled = !enabled; // CHANGE
            setBedInputsFromCm(enabled ? nextDims : null, nextUnits); // CHANGE
        } // CHANGE

        mxEvent.addListener(unitsSel, "change", function () { // CHANGE
            syncBedDimensionInputs((unitsSel.value || "").trim()); // CHANGE
        }); // CHANGE
        syncBedDimensionInputs(curUnits); // CHANGE

        function showError(msg) {
            err.textContent = msg;
            err.style.display = "block";
        }

        const btnRow = document.createElement("div");
        btnRow.style.display = "flex";
        btnRow.style.justifyContent = "flex-end";
        btnRow.style.gap = "8px";
        btnRow.style.marginTop = "12px";

        const cancelBtn = mxUtils.button("Cancel", () => ui.hideDialog()); // CHANGE
        const okBtn = mxUtils.button("OK", () => {
            err.style.display = "none";
            const chosenGardenName = String(gardenNameInput.value || "").trim() || "Garden"; // ADDED
            const chosenCityRow = selectedCityRow(); // ADDED
            const chosenCity = String(chosenCityRow?.city_name || "").trim(); // CHANGED
            const chosenCityId = chosenCityRow?.city_id != null ? String(chosenCityRow.city_id) : ""; // ADDED
            const chosenUnits = (unitsSel.value || "").trim();
            const chosenBedDimsCm = readBedInputsAsCm(chosenUnits); // CHANGE
            const chosenModuleMargin = readModuleMarginInput(moduleMarginInput); // NEW

            if (!chosenCity) { showError("City is required."); citySel.focus(); return; }
            if (!chosenUnits) { showError("Units are required."); unitsSel.focus(); return; }
            if (!chosenBedDimsCm) { showError("Default bed width and length must be positive numbers."); bedWidthInput.focus(); return; } // CHANGE
            if (chosenModuleMargin == null) { showError("Module margin must be a non-negative whole number."); moduleMarginInput.focus(); return; } // NEW

            ui.hideDialog();
            model.beginUpdate();
            try {
                setCellAttrsNoTxn(model, moduleCell, {
                    garden_name: chosenGardenName, // ADDED
                    label: chosenGardenName, // ADDED
                    city_id: chosenCityId, // ADDED
                    city_name: chosenCity,
                    unit_system: chosenUnits,
                    [DEFAULT_BED_WIDTH_CM_ATTR]: formatBedCmAttr(chosenBedDimsCm.widthCm), // CHANGE
                    [DEFAULT_BED_LENGTH_CM_ATTR]: formatBedCmAttr(chosenBedDimsCm.lengthCm), // CHANGE
                });
                setGardenModuleMargin(moduleCell, chosenModuleMargin); // NEW
            } finally {
                model.endUpdate();
            }
            graph.refresh(moduleCell);

        });

        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(okBtn);
        div.appendChild(btnRow);

        ui.showDialog(div, 420, 330, true, true, notifyClose); // CHANGE
        elevateTrellisDialog(); // NEW
        gardenNameInput.focus(); // CHANGED
    }

    let openGardenSettingsDialogWithOverlaySuppressed = null; // NEW

    function installGardenModuleOverlay() { // CHANGE
        if (graph.__plantTilerGardenModuleOverlayInstalled) return; // CHANGE
        graph.__plantTilerGardenModuleOverlayInstalled = true; // CHANGE

        const OFFSET_PX = 8; // CHANGE
        const SIMPLE_CLICK_MAX_MOVE_PX = 4; // CHANGE
        const MOUSE_ANCHOR_MAX_AGE_MS = 1000; // CHANGE
        let toolbar = null; // CHANGE
        let settingsBtn = null; // CHANGE
        let addBedBtn = null; // CHANGE
        let addGroupBtn = null; // CHANGE
        let irrigationSourceBtn = null; // NEW
        let activeModuleCell = null; // CHANGE
        let activeBedCell = null; // CHANGE
        let activeOverlayMode = ""; // CHANGE
        let anchorModelPoint = null; // CHANGE
        let lastMouseAnchor = null; // CHANGE
        let gestureHidden = false; // CHANGE
        let refreshTimer = null; // CHANGE
        let gardenSettingsOverlaySuppressed = false; // NEW
        let manuallyHiddenModuleCell = null; // NEW
        let pendingSelectedModuleToggle = null; // NEW

        function getOverlayHost() { // CHANGE
            return graph.container; // CHANGE
        } // CHANGE

        function ensureOverlayHost() { // CHANGE
            const host = getOverlayHost(); // CHANGE
            if (!host) return null; // CHANGE
            const style = window.getComputedStyle ? window.getComputedStyle(host) : null; // CHANGE
            if (style && style.position === "static") host.style.position = "relative"; // CHANGE
            return host; // CHANGE
        } // CHANGE

        function makeButton(text) { // CHANGE
            const btn = document.createElement("button"); // CHANGE
            btn.type = "button"; // CHANGE
            btn.textContent = text; // CHANGE
            btn.style.border = "1px solid #b8b8b8"; // CHANGE
            btn.style.borderRadius = "4px"; // CHANGE
            btn.style.background = "#fff"; // CHANGE
            btn.style.color = "#222"; // CHANGE
            btn.style.cursor = "pointer"; // CHANGE
            btn.style.font = "12px Arial, sans-serif"; // CHANGE
            btn.style.padding = "5px 8px"; // CHANGE
            btn.style.textAlign = "left"; // CHANGE
            btn.style.whiteSpace = "nowrap"; // CHANGE
            return btn; // CHANGE
        } // CHANGE

        function ensureToolbar() { // CHANGE
            if (toolbar) return toolbar; // CHANGE
            toolbar = document.createElement("div"); // CHANGE
            toolbar.style.position = "absolute"; // CHANGE
            toolbar.style.zIndex = String(GRAPH_OVERLAY_Z.CONTROL); // CHANGE
            toolbar.style.display = "none"; // CHANGE
            toolbar.style.flexDirection = "column"; // CHANGE
            toolbar.style.gap = "4px"; // CHANGE
            toolbar.style.padding = "4px"; // CHANGE
            toolbar.style.background = "rgba(255,255,255,0.96)"; // CHANGE
            toolbar.style.border = "1px solid #c7c7cc"; // CHANGE
            toolbar.style.borderRadius = "6px"; // CHANGE
            toolbar.style.boxShadow = "0 2px 8px rgba(0,0,0,0.16)"; // CHANGE
            toolbar.style.font = "12px Arial, sans-serif"; // CHANGE
            toolbar.style.pointerEvents = "auto"; // CHANGE
            mxEvent.addListener(toolbar, "mousedown", function (evt) { mxEvent.consume(evt); }); // CHANGE
            mxEvent.addListener(toolbar, "click", function (evt) { evt.stopPropagation(); }); // CHANGE

            settingsBtn = makeButton("Set Garden Settings"); // CHANGE
            addBedBtn = makeButton("Add Garden Bed"); // CHANGE
            addGroupBtn = makeButton("Add New Plant Group"); // CHANGE
            irrigationSourceBtn = makeButton("Create Irrigation Source"); // NEW
            toolbar.appendChild(settingsBtn); // CHANGE
            toolbar.appendChild(addBedBtn); // CHANGE
            toolbar.appendChild(addGroupBtn); // CHANGE
            toolbar.appendChild(irrigationSourceBtn); // NEW

            mxEvent.addListener(settingsBtn, "click", async function (evt) { // CHANGE
                mxEvent.consume(evt); // CHANGE
                const moduleCell = activeModuleCell; // CHANGE
                if (!moduleCell || !isGardenModule(moduleCell)) return; // CHANGE
                await openGardenSettingsDialogWithOverlaySuppressed(moduleCell); // CHANGE
            }); // CHANGE

            mxEvent.addListener(addBedBtn, "click", function (evt) { // CHANGE
                mxEvent.consume(evt); // CHANGE
                const moduleCell = activeModuleCell; // CHANGE
                const pt = anchorModelPoint; // CHANGE
                if (!moduleCell || !pt || !hasGardenSettingsSet(moduleCell)) return; // CHANGE
                try { // CHANGE
                    createDefaultGardenBed(graph, moduleCell, pt.x, pt.y); // CHANGE
                    hideToolbar(); // CHANGE
                } catch (e) { // CHANGE
                    mxUtils.alert("Error creating garden bed: " + (e && e.message ? e.message : e)); // CHANGE
                } // CHANGE
            }); // CHANGE

            mxEvent.addListener(addGroupBtn, "click", function (evt) { // CHANGE
                mxEvent.consume(evt); // CHANGE
                const moduleCell = activeModuleCell; // CHANGE
                const pt = anchorModelPoint; // CHANGE
                if (!moduleCell || !pt || !hasGardenSettingsSet(moduleCell)) return; // CHANGE
                createEmptyTilerGroup(graph, moduleCell, pt.x, pt.y, { source: activeOverlayMode === "bed" ? "overlay-bed-add" : "overlay-module-add" }); // CHANGE
                hideToolbar(); // CHANGE
            }); // CHANGE

            mxEvent.addListener(irrigationSourceBtn, "click", function (evt) { // NEW
                mxEvent.consume(evt); // NEW
                const moduleCell = activeModuleCell; // NEW
                if (!moduleCell || !hasGardenSettingsSet(moduleCell) || gardenModuleHasIrrigationSource(moduleCell)) return; // NEW
                openIrrigationSourceFormForModule(moduleCell); // NEW
                hideToolbar(); // NEW
            }); // NEW

            const host = ensureOverlayHost(); // CHANGE
            if (host) host.appendChild(toolbar); // CHANGE
            return toolbar; // CHANGE
        } // CHANGE

        function hideToolbar() { // CHANGE
            if (toolbar) toolbar.style.display = "none"; // CHANGE
        } // CHANGE

        function isPlainPrimaryMouseEvent(evt) { // NEW
            if (!evt) return false; // NEW
            if ((mxEvent.isPopupTrigger && mxEvent.isPopupTrigger(evt)) || evt.button === 2) return false; // NEW
            return !mxEvent.isControlDown(evt) && !mxEvent.isMetaDown(evt) && !mxEvent.isShiftDown(evt) && Number(evt.detail || 1) <= 1; // NEW
        } // NEW

        function mouseEventCell(me, evt) { // NEW
            const cell = me && me.getCell ? me.getCell() : null; // NEW
            if (cell || !evt || !graph.getCellAt || !graph.getPointForEvent) return cell; // NEW
            const pt = graph.getPointForEvent(evt, false); // NEW
            return pt ? graph.getCellAt(pt.x, pt.y) : null; // NEW
        } // NEW

        function selectedGardenModulePlainClickTarget(me, evt) { // NEW
            if (!isPlainPrimaryMouseEvent(evt)) return null; // NEW
            const selectedModule = getSingleSelectedGardenModule(); // NEW
            if (!selectedModule) return null; // NEW
            if (activeOverlayMode !== "module" || activeModuleCell !== selectedModule) return null; // NEW
            return mouseEventCell(me, evt) === selectedModule ? selectedModule : null; // NEW
        } // NEW

        function clearHiddenModuleIfTargetChanged(target) { // NEW
            if (!manuallyHiddenModuleCell) return; // NEW
            if (!target || target.mode !== "module" || target.moduleCell !== manuallyHiddenModuleCell) manuallyHiddenModuleCell = null; // NEW
        } // NEW

        function toggleHiddenModuleAfterSimpleClick(evt) { // NEW
            const pending = pendingSelectedModuleToggle; // NEW
            pendingSelectedModuleToggle = null; // NEW
            if (!pending || !isSimpleAnchorClick(evt)) return false; // NEW
            if (getSingleSelectedGardenModule() !== pending) return false; // NEW
            manuallyHiddenModuleCell = manuallyHiddenModuleCell === pending ? null : pending; // NEW
            return true; // NEW
        } // NEW

        function gardenModuleHasIrrigationSource(moduleCell) { // NEW
            return collectModuleDescendants(moduleCell).some(function (cell) { // NEW
                return getXmlAttr(cell, "irrigation_endpoint_type", "") === "source"; // NEW
            }); // NEW
        } // NEW

        function collectModuleDescendants(moduleCell) { // NEW
            const graphModel = graph.getModel && graph.getModel(); // FIX
            const out = []; // NEW
            (function visit(parent) { // NEW
                const count = graphModel && graphModel.getChildCount ? graphModel.getChildCount(parent) : ((parent && parent.children && parent.children.length) || 0); // FIX
                for (let i = 0; i < count; i++) { // NEW
                    const child = graphModel && graphModel.getChildAt ? graphModel.getChildAt(parent, i) : parent.children[i]; // FIX
                    if (!child) continue; // NEW
                    out.push(child); // NEW
                    visit(child); // NEW
                } // NEW
            })(moduleCell); // NEW
            return out; // NEW
        } // NEW

        function openIrrigationSourceFormForModule(moduleCell) { // NEW
            if (window.TrellisIrrigationPlanner && typeof window.TrellisIrrigationPlanner.openIrrigationMode === "function") { // NEW
                window.TrellisIrrigationPlanner.openIrrigationMode(moduleCell, { sourceForm: true, preserveViewport: true }); // NEW
                return; // NEW
            } // NEW
            if (graph.setSelectionCell) graph.setSelectionCell(moduleCell); // NEW
            const action = ui.actions && ui.actions.get && ui.actions.get("trellisIrrigationCreateSourceEndpoint"); // NEW
            if (action && typeof action.funct === "function") action.funct(); // NEW
        } // NEW

        openGardenSettingsDialogWithOverlaySuppressed = async function (moduleCell, onClose) { // NEW
            gardenSettingsOverlaySuppressed = true; // NEW
            hideToolbar(); // NEW
            let closeHandled = false; // NEW

            function clearSuppressionAndNotify() { // NEW
                if (closeHandled) return; // NEW
                closeHandled = true; // NEW
                gardenSettingsOverlaySuppressed = false; // NEW
                if (typeof onClose === "function") onClose(); // NEW
                scheduleRefresh(); // NEW
            } // NEW

            try { // NEW
                await showGardenSettingsDialog(ui, graph, moduleCell, clearSuppressionAndNotify); // NEW
            } catch (e) { // NEW
                clearSuppressionAndNotify(); // NEW
                throw e; // NEW
            } // NEW
        }; // NEW

        function getSingleSelectedGardenModule() { // CHANGE
            const cells = graph.getSelectionCells ? (graph.getSelectionCells() || []) : []; // CHANGE
            if (cells.length !== 1) return null; // CHANGE
            return isGardenModule(cells[0]) ? cells[0] : null; // CHANGE
        } // CHANGE

        function getSingleSelectedOverlayTarget() { // CHANGE
            const cells = graph.getSelectionCells ? (graph.getSelectionCells() || []) : []; // CHANGE
            if (cells.length !== 1) return null; // CHANGE
            const cell = cells[0]; // CHANGE
            if (isGardenModule(cell)) return { mode: "module", moduleCell: cell, bedCell: null, anchorCell: cell }; // CHANGE
            if (isGardenBed(cell)) { // CHANGE
                const moduleCell = findGardenModuleAncestor(graph, cell); // CHANGE
                if (moduleCell) return { mode: "bed", moduleCell: moduleCell, bedCell: cell, anchorCell: cell }; // CHANGE
            } // CHANGE
            return null; // CHANGE
        } // CHANGE

        function viewPointFromModelPoint(pt) { // CHANGE
            const s = graph.view.scale || 1; // CHANGE
            const tr = graph.view.translate || { x: 0, y: 0 }; // CHANGE
            return { // CHANGE
                x: ((Number(pt.x) || 0) + tr.x) * s + (graph.panDx || 0), // CHANGE
                y: ((Number(pt.y) || 0) + tr.y) * s + (graph.panDy || 0) // CHANGE
            }; // CHANGE
        } // CHANGE

        function viewportCenterModelPoint() { // CHANGE
            const s = graph.view.scale || 1; // CHANGE
            const tr = graph.view.translate || { x: 0, y: 0 }; // CHANGE
            const host = getOverlayHost(); // CHANGE
            const visibleCenterX = (host ? host.scrollLeft || 0 : 0) + (host ? host.clientWidth || 0 : 0) / 2; // CHANGE
            const visibleCenterY = (host ? host.scrollTop || 0 : 0) + (host ? host.clientHeight || 0 : 0) / 2; // CHANGE
            return { // CHANGE
                x: (visibleCenterX - (graph.panDx || 0)) / s - tr.x, // CHANGE
                y: (visibleCenterY - (graph.panDy || 0)) / s - tr.y // CHANGE
            }; // CHANGE
        } // CHANGE

        function cellCenterGraphPoint(cell) { // CHANGE
            const model = graph.getModel(); // CHANGE
            const geo = cell && model.getGeometry(cell); // CHANGE
            if (!geo) return viewportCenterModelPoint(); // CHANGE
            const parent = model.getParent(cell); // CHANGE
            const parentGeo = parent && model.getGeometry(parent); // CHANGE
            const parentX = parentGeo ? Number(parentGeo.x) || 0 : 0; // CHANGE
            const parentY = parentGeo ? Number(parentGeo.y) || 0 : 0; // CHANGE
            return { // CHANGE
                x: parentX + (Number(geo.x) || 0) + (Number(geo.width) || 0) / 2, // CHANGE
                y: parentY + (Number(geo.y) || 0) + (Number(geo.height) || 0) / 2 // CHANGE
            }; // CHANGE
        } // CHANGE

        function stateContainsViewPoint(state, pt) { // CHANGE
            if (!state || !pt) return false; // CHANGE
            return pt.x >= state.x && pt.y >= state.y && pt.x <= state.x + state.width && pt.y <= state.y + state.height; // CHANGE
        } // CHANGE

        function chooseAnchorPoint(target) { // CHANGE
            const now = Date.now(); // CHANGE
            const state = target && target.anchorCell ? graph.view.getState(target.anchorCell) : null; // CHANGE
            if (lastMouseAnchor && now - lastMouseAnchor.t <= MOUSE_ANCHOR_MAX_AGE_MS && stateContainsViewPoint(state, lastMouseAnchor.view)) { // CHANGE
                return { x: lastMouseAnchor.model.x, y: lastMouseAnchor.model.y }; // CHANGE
            } // CHANGE
            if (target && target.mode === "bed") return cellCenterGraphPoint(target.bedCell); // CHANGE
            return viewportCenterModelPoint(); // CHANGE
        } // CHANGE

        function isSimpleAnchorClick(evt) { // CHANGE
            if (!evt || !lastMouseAnchor || !lastMouseAnchor.client) return false; // CHANGE
            const dx = mxEvent.getClientX(evt) - lastMouseAnchor.client.x; // CHANGE
            const dy = mxEvent.getClientY(evt) - lastMouseAnchor.client.y; // CHANGE
            return Math.sqrt(dx * dx + dy * dy) <= SIMPLE_CLICK_MAX_MOVE_PX; // CHANGE
        } // CHANGE

        function updateAnchorFromSimpleClick(evt) { // CHANGE
            if (!isSimpleAnchorClick(evt)) return false; // CHANGE
            const target = getSingleSelectedOverlayTarget(); // CHANGE
            const state = target && target.anchorCell ? graph.view.getState(target.anchorCell) : null; // CHANGE
            if (!target || !stateContainsViewPoint(state, lastMouseAnchor.view)) return false; // CHANGE
            activeModuleCell = target.moduleCell; // CHANGE
            activeBedCell = target.bedCell || null; // CHANGE
            activeOverlayMode = target.mode; // CHANGE
            anchorModelPoint = { x: lastMouseAnchor.model.x, y: lastMouseAnchor.model.y }; // CHANGE
            return true; // CHANGE
        } // CHANGE

        function positionToolbar() { // CHANGE
            if (gardenSettingsOverlaySuppressed) { hideToolbar(); return; } // NEW
            if (!toolbar || !activeModuleCell || !anchorModelPoint) return; // CHANGE
            const host = ensureOverlayHost(); // CHANGE
            if (host && toolbar.parentNode !== host) host.appendChild(toolbar); // CHANGE
            const viewPt = viewPointFromModelPoint(anchorModelPoint); // CHANGE
            toolbar.style.display = "flex"; // CHANGE
            toolbar.style.left = Math.round(viewPt.x + OFFSET_PX) + "px"; // CHANGE
            toolbar.style.top = Math.round(viewPt.y + OFFSET_PX) + "px"; // CHANGE
        } // CHANGE

        function syncToolbarState() { // CHANGE
            const moduleCell = activeModuleCell; // CHANGE
            if (!toolbar || !settingsBtn || !addBedBtn || !addGroupBtn || !irrigationSourceBtn || !moduleCell) return; // CHANGE
            const hasSettings = hasGardenSettingsSet(moduleCell); // CHANGE
            const bedMode = activeOverlayMode === "bed"; // CHANGE
            const showIrrigationSource = !bedMode && !gardenModuleHasIrrigationSource(moduleCell); // NEW
            settingsBtn.style.display = bedMode ? "none" : ""; // CHANGE
            addBedBtn.style.display = bedMode ? "none" : ""; // CHANGE
            addGroupBtn.style.display = ""; // CHANGE
            irrigationSourceBtn.style.display = showIrrigationSource ? "" : "none"; // NEW
            settingsBtn.textContent = hasSettings ? "Edit Garden Settings" : "Set Garden Settings"; // CHANGE
            addBedBtn.disabled = !hasSettings; // CHANGE
            addBedBtn.title = hasSettings ? "Add the default-sized garden bed at the selected location" : "Set garden settings before adding beds"; // CHANGE
            addBedBtn.style.opacity = hasSettings ? "1" : "0.55"; // CHANGE
            addBedBtn.style.cursor = hasSettings ? "pointer" : "default"; // CHANGE
            addGroupBtn.disabled = !hasSettings; // CHANGE
            addGroupBtn.title = hasSettings ? (bedMode ? "Add a new plant group fitted to this garden bed" : "Add a new plant group at the selected location") : "Set garden settings before adding plants"; // CHANGE
            addGroupBtn.style.opacity = hasSettings ? "1" : "0.55"; // CHANGE
            addGroupBtn.style.cursor = hasSettings ? "pointer" : "default"; // CHANGE
            irrigationSourceBtn.disabled = !hasSettings; // NEW
            irrigationSourceBtn.title = hasSettings ? "Enter irrigation design mode and create the first irrigation source" : "Set garden settings before creating an irrigation source"; // NEW
            irrigationSourceBtn.style.opacity = hasSettings ? "1" : "0.55"; // NEW
            irrigationSourceBtn.style.cursor = hasSettings ? "pointer" : "default"; // NEW
        } // CHANGE

        function refreshForSelection() { // CHANGE
            refreshTimer = null; // CHANGE
            if (gardenSettingsOverlaySuppressed) { // NEW
                hideToolbar(); // NEW
                return; // NEW
            } // NEW
            const target = getSingleSelectedOverlayTarget(); // CHANGE
            clearHiddenModuleIfTargetChanged(target); // NEW
            if (!target || gestureHidden) { // CHANGE
                activeModuleCell = target ? target.moduleCell : null; // CHANGE
                activeBedCell = target ? target.bedCell : null; // CHANGE
                activeOverlayMode = target ? target.mode : ""; // CHANGE
                if (!target) anchorModelPoint = null; // CHANGE
                hideToolbar(); // CHANGE
                return; // CHANGE
            } // CHANGE
            if (activeModuleCell !== target.moduleCell || activeBedCell !== target.bedCell || activeOverlayMode !== target.mode || !anchorModelPoint) { // CHANGE
                anchorModelPoint = chooseAnchorPoint(target); // CHANGE
            } // CHANGE
            activeModuleCell = target.moduleCell; // CHANGE
            activeBedCell = target.bedCell || null; // CHANGE
            activeOverlayMode = target.mode; // CHANGE
            if (target.mode === "module" && target.moduleCell === manuallyHiddenModuleCell) { hideToolbar(); return; } // NEW
            ensureToolbar(); // CHANGE
            syncToolbarState(); // CHANGE
            positionToolbar(); // CHANGE
        } // CHANGE

        function scheduleRefresh() { // CHANGE
            if (refreshTimer != null) clearTimeout(refreshTimer); // CHANGE
            refreshTimer = setTimeout(refreshForSelection, 0); // CHANGE
        } // CHANGE

        graph.__plantTilerRefreshGardenModuleOverlay = scheduleRefresh; // CHANGE

        graph.addMouseListener({ // CHANGE
            mouseDown: function (_sender, me) { // CHANGE
                const evt = me && me.getEvent ? me.getEvent() : null; // CHANGE
                if (evt && toolbar && toolbar.contains(mxEvent.getSource(evt))) return; // CHANGE
                pendingSelectedModuleToggle = selectedGardenModulePlainClickTarget(me, evt); // NEW
                if (evt) { // CHANGE
                    const modelPt = graph.getPointForEvent(evt, false); // CHANGE
                    lastMouseAnchor = { // CHANGE
                        model: { x: modelPt.x, y: modelPt.y }, // CHANGE
                        view: { x: me.getGraphX(), y: me.getGraphY() }, // CHANGE
                        client: { x: mxEvent.getClientX(evt), y: mxEvent.getClientY(evt) }, // CHANGE
                        t: Date.now() // CHANGE
                    }; // CHANGE
                } // CHANGE
                gestureHidden = true; // CHANGE
                hideToolbar(); // CHANGE
            }, // CHANGE
            mouseMove: function () { }, // CHANGE
            mouseUp: function (_sender, me) { // CHANGE
                const evt = me && me.getEvent ? me.getEvent() : null; // CHANGE
                gestureHidden = false; // CHANGE
                updateAnchorFromSimpleClick(evt); // CHANGE
                toggleHiddenModuleAfterSimpleClick(evt); // NEW
                scheduleRefresh(); // CHANGE
            } // CHANGE
        }); // CHANGE

        graph.getSelectionModel().addListener(mxEvent.CHANGE, scheduleRefresh); // CHANGE
        graph.addListener(mxEvent.CELLS_MOVED, scheduleRefresh); // CHANGE
        graph.addListener(mxEvent.CELLS_RESIZED, scheduleRefresh); // CHANGE
        graph.getView().addListener(mxEvent.SCALE, scheduleRefresh); // CHANGE
        graph.getView().addListener(mxEvent.TRANSLATE, scheduleRefresh); // CHANGE
        graph.getView().addListener(mxEvent.SCALE_AND_TRANSLATE, scheduleRefresh); // CHANGE
        graph.getView().addListener(mxEvent.REPAINT, function () { if (!gardenSettingsOverlaySuppressed && toolbar && toolbar.style.display !== "none") positionToolbar(); }); // CHANGE
        graph.getModel().addListener(mxEvent.UNDO, scheduleRefresh); // CHANGE
        graph.getModel().addListener(mxEvent.REDO, scheduleRefresh); // CHANGE
        mxEvent.addListener(window, "resize", scheduleRefresh); // CHANGE
        setTimeout(scheduleRefresh, 0); // CHANGE
    } // CHANGE


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
                if (openGardenSettingsDialogWithOverlaySuppressed) { // NEW
                    openGardenSettingsDialogWithOverlaySuppressed(moduleCell); // NEW
                } else { // NEW
                    showGardenSettingsDialog(ui, graph, moduleCell, graph.__plantTilerRefreshGardenModuleOverlay); // NEW
                } // NEW
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
            getXmlAttr(cell, "garden_module", "") === "1" // CHANGE
        );
    }

    installGardenModuleOverlay(); // CHANGE

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
    function isGardenBed(cell) { // CHANGE
        return !!cell && cell.getAttribute && ( // CHANGE
            cell.getAttribute("garden_bed") === "1" || // CHANGE
            cell.getAttribute("gardenBed") === "1" || // CHANGE
            cell.getAttribute("is_garden_bed") === "1" // CHANGE
        ); // CHANGE
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
        const center = childVisualCenterLocal(plantCell); // NEW
        if (!mg || !gg || !center) return null; // CHANGE

        return {
            moduleCell,
            x: (mg.x + gg.x + center.x), // CHANGE
            y: (mg.y + gg.y + center.y), // CHANGE
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

    // -------------------- Bed-aware model-space auto-fit -------------------- // MOVED
    let bedFitInProgress = false; // MOVED
    let bedFitTxnSeq = 0; // CHANGE
    let bedFitSuppressResizeUntil = 0; // CHANGE
    let bedFitSuppressResizeIds = new Set(); // CHANGE

    function nearlySameNumber(a, b) { // MOVED
        return Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.001; // MOVED
    } // MOVED

    function bedFitRound(value) { // CHANGE
        const n = Number(value); // CHANGE
        return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : value; // CHANGE
    } // CHANGE

    function bedFitRectSnapshot(rect) { // CHANGE
        if (!rect) return null; // CHANGE
        return { // CHANGE
            x: bedFitRound(rect.x), // CHANGE
            y: bedFitRound(rect.y), // CHANGE
            w: bedFitRound(rect.w != null ? rect.w : rect.width), // CHANGE
            h: bedFitRound(rect.h != null ? rect.h : rect.height) // CHANGE
        }; // CHANGE
    } // CHANGE

    function bedFitGeometrySnapshot(cell) { // CHANGE
        const g = cell && cell.getGeometry ? cell.getGeometry() : null; // CHANGE
        return g ? bedFitRectSnapshot(g) : null; // CHANGE
    } // CHANGE

    function bedFitCellId(cell) { // CHANGE
        return cell && cell.id ? cell.id : null; // CHANGE
    } // CHANGE

    function bedFitTileSample(groupCell, limit) { // CHANGE
        const model = graph.getModel(); // CHANGE
        const out = []; // CHANGE
        const n = model.getChildCount(groupCell); // CHANGE
        const max = Math.max(1, Number(limit) || 6); // CHANGE
        for (let i = 0; i < n && out.length < max; i++) { // CHANGE
            const child = model.getChildAt(groupCell, i); // CHANGE
            if (!model.isVertex(child) || !isPlantCircle(child)) continue; // CHANGE
            const visualCenter = childVisualCenterLocal(child); // CHANGE
            const unrotatedCenter = childCenterInUnrotatedGroupSpace(groupCell, child); // CHANGE
            out.push({ // CHANGE
                id: bedFitCellId(child), // CHANGE
                r: child.getAttribute("tile_r"), // CHANGE
                c: child.getAttribute("tile_c"), // CHANGE
                auto: child.getAttribute("auto"), // CHANGE
                dirty: child.getAttribute("dirty"), // CHANGE
                geo: bedFitGeometrySnapshot(child), // CHANGE
                visualCx: visualCenter ? bedFitRound(visualCenter.x) : null, // CHANGE
                visualCy: visualCenter ? bedFitRound(visualCenter.y) : null, // CHANGE
                unrotatedCx: unrotatedCenter ? bedFitRound(unrotatedCenter.x) : null, // CHANGE
                unrotatedCy: unrotatedCenter ? bedFitRound(unrotatedCenter.y) : null // CHANGE
            }); // CHANGE
        } // CHANGE
        return out; // CHANGE
    } // CHANGE

    function markBedFitResizeSuppression(items) { // CHANGE
        bedFitSuppressResizeIds = new Set(); // CHANGE
        for (const item of (items || [])) { // CHANGE
            if (item && item.tg && item.tg.id) bedFitSuppressResizeIds.add(item.tg.id); // CHANGE
        } // CHANGE
        bedFitSuppressResizeUntil = bedFitSuppressResizeIds.size ? Date.now() + BED_FIT_RESIZE_SUPPRESS_MS : 0; // CHANGE
    } // CHANGE

    function shouldSuppressBedFitResize(source, groups) { // CHANGE
        if (source !== "cells-resized" || !bedFitSuppressResizeIds.size) return false; // CHANGE
        if (Date.now() > bedFitSuppressResizeUntil) { // CHANGE
            bedFitSuppressResizeIds.clear(); // CHANGE
            bedFitSuppressResizeUntil = 0; // CHANGE
            return false; // CHANGE
        } // CHANGE
        return (groups || []).some(group => group && group.id && bedFitSuppressResizeIds.has(group.id)); // CHANGE
    } // CHANGE

    function getModelRect(cell) { // MOVED
        const model = graph.getModel(); // MOVED
        const g = cell ? model.getGeometry(cell) : null; // MOVED
        if (!g) return null; // MOVED
        return { x: Number(g.x) || 0, y: Number(g.y) || 0, w: Number(g.width) || 0, h: Number(g.height) || 0 }; // MOVED
    } // MOVED

    function rectCenterModel(rect) { // MOVED
        return rect ? { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 } : null; // MOVED
    } // MOVED

    function rectAreaModel(rect) { // MOVED
        return rect ? Math.max(0, rect.w) * Math.max(0, rect.h) : 0; // MOVED
    } // MOVED

    function rotateModelPoint(point, center, angleRad) { // MOVED
        const dx = point.x - center.x; // MOVED
        const dy = point.y - center.y; // MOVED
        const cos = Math.cos(angleRad); // MOVED
        const sin = Math.sin(angleRad); // MOVED
        return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos }; // MOVED
    } // MOVED

    function getRotatedRectModel(cell) { // MOVED
        const rect = getModelRect(cell); // MOVED
        if (!rect || rect.w <= 0 || rect.h <= 0) return null; // MOVED
        const center = rectCenterModel(rect); // MOVED
        const angleDeg = getTilerRotationDeg(cell); // MOVED
        return { x: rect.x, y: rect.y, w: rect.w, h: rect.h, cx: center.x, cy: center.y, center, angleDeg, angleRad: toRad(angleDeg) }; // MOVED
    } // MOVED

    function pointInRotatedRectModel(point, rotatedRect) { // MOVED
        if (!point || !rotatedRect) return false; // MOVED
        const center = rotatedRect.center || { x: rotatedRect.cx, y: rotatedRect.cy }; // MOVED
        const local = rotateModelPoint(point, center, -rotatedRect.angleRad); // MOVED
        return local.x >= rotatedRect.x - ROTATION_EPS_DEG && // MOVED
            local.x <= rotatedRect.x + rotatedRect.w + ROTATION_EPS_DEG && // MOVED
            local.y >= rotatedRect.y - ROTATION_EPS_DEG && // MOVED
            local.y <= rotatedRect.y + rotatedRect.h + ROTATION_EPS_DEG; // MOVED
    } // MOVED

    function findSmallestContainingBedModel(parent, point) { // MOVED
        if (!parent || !point) return null; // MOVED
        const beds = (graph.getChildVertices(parent) || []).filter(isGardenBed); // MOVED
        let chosen = null; // MOVED
        let chosenArea = Infinity; // MOVED
        for (const bed of beds) { // MOVED
            const rect = getRotatedRectModel(bed); // MOVED
            if (!rect || !pointInRotatedRectModel(point, rect)) continue; // MOVED
            const area = rectAreaModel(rect); // MOVED
            if (area > 0 && area < chosenArea) { // MOVED
                chosen = bed; // MOVED
                chosenArea = area; // MOVED
            } // MOVED
        } // MOVED
        return chosen; // MOVED
    } // MOVED

    function largestChildPlantCircleDiameter(tg) { // MOVED
        const model = graph.getModel(); // MOVED
        let diameter = 0; // MOVED
        const childCount = model.getChildCount(tg); // MOVED
        for (let i = 0; i < childCount; i++) { // MOVED
            const child = model.getChildAt(tg, i); // MOVED
            if (!model.isVertex(child) || !isPlantCircle(child)) continue; // MOVED
            const cg = model.getGeometry(child); // MOVED
            if (!cg) continue; // MOVED
            diameter = Math.max(diameter, Number(cg.width) || 0, Number(cg.height) || 0); // MOVED
        } // MOVED
        return diameter; // MOVED
    } // MOVED

    function getPlantCircleDiameterPx(tg) { // MOVED
        const childDiameter = largestChildPlantCircleDiameter(tg); // MOVED
        if (childDiameter > 0) return childDiameter; // MOVED
        const vegDiameterCm = parseFloat(String(tg && tg.getAttribute ? tg.getAttribute("veg_diameter_cm") : 0).trim()); // MOVED
        return Number.isFinite(vegDiameterCm) && vegDiameterCm > 0 ? toPx(vegDiameterCm) : 0; // MOVED
    } // MOVED

    function allowedOverhangForDiameter(diameter) { // MOVED
        return Math.max(0, diameter) * (1 - EDGE_CIRCLE_CENTER_CONTAINED_PCT) / 2; // MOVED
    } // MOVED

    function bedFitLabelBandPxForSize(width, height) { // MOVED
        return groupLabelMetrics({ getGeometry: () => ({ width, height }) }).bandPx; // MOVED
    } // MOVED

    function getPlantingFrameRectModel(tgRect) { // MOVED
        if (!tgRect) return null; // MOVED
        const bandPx = bedFitLabelBandPxForSize(tgRect.w, tgRect.h); // MOVED
        return { // MOVED
            x: tgRect.x + GROUP_PADDING_PX, // MOVED
            y: tgRect.y + GROUP_PADDING_PX + bandPx, // MOVED
            w: Math.max(0, tgRect.w - GROUP_PADDING_PX * 2), // MOVED
            h: Math.max(0, tgRect.h - GROUP_PADDING_PX * 2 - bandPx), // MOVED
            bandPx: bandPx // MOVED
        }; // MOVED
    } // MOVED

    function solveOuterHeightForPlantingFrame(innerHeight, outerWidth, seedHeight) { // MOVED
        let bandPx = bedFitLabelBandPxForSize(outerWidth, seedHeight); // MOVED
        let outerHeight = Math.max(1, innerHeight + GROUP_PADDING_PX * 2 + bandPx); // MOVED
        for (let i = 0; i < 5; i++) { // MOVED
            const nextBandPx = bedFitLabelBandPxForSize(outerWidth, outerHeight); // MOVED
            const nextOuterHeight = Math.max(1, innerHeight + GROUP_PADDING_PX * 2 + nextBandPx); // MOVED
            if (nextBandPx === bandPx && nearlySameNumber(nextOuterHeight, outerHeight)) break; // MOVED
            bandPx = nextBandPx; // MOVED
            outerHeight = nextOuterHeight; // MOVED
        } // MOVED
        return { outerHeight: outerHeight, bandPx: bandPx }; // MOVED
    } // MOVED

    function collectTilerGroupCandidate(cell, out) { // MOVED
        const tg = findTilerGroupAncestor(graph, cell); // MOVED
        if (tg && tg.id && !out.has(tg.id)) out.set(tg.id, tg); // MOVED
    } // MOVED

    function getTilerGroupsFromEventCells(cells) { // MOVED
        const out = new Map(); // MOVED
        const moved = (cells || []).filter(Boolean); // MOVED
        for (const cell of moved) collectTilerGroupCandidate(cell, out); // MOVED
        if (!moved.length) { // MOVED
            const selected = graph.getSelectionCells ? graph.getSelectionCells() : [graph.getSelectionCell()]; // MOVED
            for (const cell of (selected || [])) collectTilerGroupCandidate(cell, out); // MOVED
        } // MOVED
        return Array.from(out.values()); // MOVED
    } // MOVED

    function captureBedFitLayoutSnapshot(tg) { // CHANGE
        if (!tg || !isTilerGroup(tg)) return null; // CHANGE
        const model = graph.getModel(); // CHANGE
        const rotationDeg = getTilerRotationDeg(tg); // CHANGE
        const tiles = []; // CHANGE
        const childCount = model.getChildCount(tg); // CHANGE
        for (let i = 0; i < childCount; i++) { // CHANGE
            const child = model.getChildAt(tg, i); // CHANGE
            if (!model.isVertex(child) || !isPlantCircle(child) || !hasTileRC(child)) continue; // CHANGE
            const r = Number(child.getAttribute("tile_r")); // CHANGE
            const c = Number(child.getAttribute("tile_c")); // CHANGE
            if (!Number.isFinite(r) || !Number.isFinite(c)) continue; // CHANGE
            const auto = String(child.getAttribute("auto") || "0"); // CHANGE
            const dirty = String(child.getAttribute("dirty") || "0"); // CHANGE
            if (!(dirty === "1" || auto !== "1")) continue; // CHANGE
            const logicalGeo = childLogicalGeometryFromVisual(tg, child, rotationDeg); // CHANGE
            if (!logicalGeo) continue; // CHANGE
            tiles.push({ // CHANGE
                r, c, // CHANGE
                x: logicalGeo.x, y: logicalGeo.y, w: logicalGeo.w, h: logicalGeo.h, // CHANGE
                auto, // CHANGE
                dirty, // CHANGE
                abbr: String(child.getAttribute("abbr") || ""), // CHANGE
                label: String(child.getAttribute("label") || "") // CHANGE
            }); // CHANGE
        } // CHANGE
        if (!tiles.length && isCollapsedLOD(tg)) return readLodLayoutSnapshot(tg); // CHANGE
        return { v: 1, tiles: tiles }; // CHANGE
    } // CHANGE

    function getPlantCircleBBoxLogical(tg) { // CHANGE
        const model = graph.getModel(); // MOVED
        const rotationDeg = getTilerRotationDeg(tg); // CHANGE
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity; // MOVED
        const childCount = model.getChildCount(tg); // MOVED
        for (let i = 0; i < childCount; i++) { // MOVED
            const child = model.getChildAt(tg, i); // MOVED
            if (!model.isVertex(child) || !isPlantCircle(child)) continue; // MOVED
            const cg = childLogicalGeometryFromVisual(tg, child, rotationDeg); // CHANGE
            if (!cg) continue; // CHANGE
            const x = Number(cg.x) || 0; // CHANGE
            const y = Number(cg.y) || 0; // CHANGE
            const w = Number(cg.w) || 0; // CHANGE
            const h = Number(cg.h) || 0; // CHANGE
            if (w <= 0 || h <= 0) continue; // MOVED
            minX = Math.min(minX, x); // MOVED
            minY = Math.min(minY, y); // MOVED
            maxX = Math.max(maxX, x + w); // MOVED
            maxY = Math.max(maxY, y + h); // MOVED
        } // MOVED
        if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return null; // MOVED
        return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }; // MOVED
    } // CHANGE

    function shiftPlantCircleChildrenLogical(tg, dx, dy) { // CHANGE
        if (nearlySameNumber(dx, 0) && nearlySameNumber(dy, 0)) return false; // MOVED
        const model = graph.getModel(); // MOVED
        const rotationDeg = getTilerRotationDeg(tg); // CHANGE
        let changed = false; // MOVED
        const childCount = model.getChildCount(tg); // MOVED
        for (let i = 0; i < childCount; i++) { // MOVED
            const child = model.getChildAt(tg, i); // MOVED
            if (!model.isVertex(child) || !isPlantCircle(child)) continue; // MOVED
            const logicalGeo = childLogicalGeometryFromVisual(tg, child, rotationDeg); // CHANGE
            if (!logicalGeo) continue; // CHANGE
            if ((Number(logicalGeo.w) || 0) <= 0 || (Number(logicalGeo.h) || 0) <= 0) continue; // CHANGE
            const next = visualGeometryFromLogicalGeometry(tg, { // CHANGE
                x: (Number(logicalGeo.x) || 0) + dx, // CHANGE
                y: (Number(logicalGeo.y) || 0) + dy, // CHANGE
                w: Number(logicalGeo.w) || 0, // CHANGE
                h: Number(logicalGeo.h) || 0 // CHANGE
            }); // CHANGE
            if (!next) continue; // CHANGE
            model.setGeometry(child, next); // MOVED
            changed = true; // MOVED
        } // MOVED
        return changed; // CHANGE
    } // CHANGE

    function rotateVectorModel(vx, vy, angleRad) { // MOVED
        const cos = Math.cos(angleRad); // MOVED
        const sin = Math.sin(angleRad); // MOVED
        return { x: vx * cos - vy * sin, y: vx * sin + vy * cos }; // MOVED
    } // MOVED

    function positionGeometryForLocalPoint(next, localPoint, targetPoint, angleDeg) { // MOVED
        if (!next || !localPoint || !targetPoint) return false; // MOVED
        const centerOffset = { // MOVED
            x: localPoint.x - (Number(next.width) || 0) / 2, // MOVED
            y: localPoint.y - (Number(next.height) || 0) / 2 // MOVED
        }; // MOVED
        const rotatedOffset = rotateVectorModel(centerOffset.x, centerOffset.y, toRad(angleDeg)); // MOVED
        const groupCenter = { x: targetPoint.x - rotatedOffset.x, y: targetPoint.y - rotatedOffset.y }; // MOVED
        next.x = groupCenter.x - (Number(next.width) || 0) / 2; // MOVED
        next.y = groupCenter.y - (Number(next.height) || 0) / 2; // MOVED
        return true; // MOVED
    } // MOVED

    function plantingFrameLocalCenter(width, height) { // MOVED
        const w = Math.max(1, Number(width) || 1); // MOVED
        const h = Math.max(1, Number(height) || 1); // MOVED
        const bandPx = bedFitLabelBandPxForSize(w, h); // MOVED
        const frameH = Math.max(0, h - GROUP_PADDING_PX * 2 - bandPx); // MOVED
        return { x: w / 2, y: GROUP_PADDING_PX + bandPx + frameH / 2, bandPx: bandPx }; // MOVED
    } // MOVED

    function buildAxisAwareTrimGeometry(tg, bed, bbox, fitWidth, fitHeight, finalWidth, finalHeight, bandPx) { // MOVED
        const model = graph.getModel(); // MOVED
        const bedCenter = rectCenterModel(getModelRect(bed)); // MOVED
        const current = model.getGeometry(tg); // MOVED
        if (!bedCenter || !current) return null; // MOVED
        const next = current.clone(); // MOVED
        if (fitWidth) next.width = finalWidth; // MOVED
        if (fitHeight) next.height = finalHeight; // MOVED
        const localPlantCenter = { // MOVED
            x: fitWidth ? GROUP_PADDING_PX + bbox.w / 2 : bbox.x + bbox.w / 2, // MOVED
            y: fitHeight ? GROUP_PADDING_PX + bandPx + bbox.h / 2 : bbox.y + bbox.h / 2 // MOVED
        }; // MOVED
        positionGeometryForLocalPoint(next, localPlantCenter, bedCenter, getTilerRotationDeg(bed)); // MOVED
        return next; // MOVED
    } // MOVED

    function trimGroupToPlantFootprint(tg, bed, bbox, fitWidth, fitHeight, debugCtx) { // CHANGE
        if (tg && isCollapsedLOD(tg)) { // CHANGE
            bedFitLog("trim-skip", { // CHANGE
                txnId: debugCtx && debugCtx.txnId, // CHANGE
                groupId: bedFitCellId(tg), // CHANGE
                bedId: bedFitCellId(bed), // CHANGE
                reason: "lod-collapsed" // CHANGE
            }); // CHANGE
            return false; // CHANGE
        } // CHANGE
        if (!tg || !bed || !bbox || bbox.w <= 0 || bbox.h <= 0) { // CHANGE
            bedFitLog("trim-skip", { // CHANGE
                txnId: debugCtx && debugCtx.txnId, // CHANGE
                groupId: bedFitCellId(tg), // CHANGE
                bedId: bedFitCellId(bed), // CHANGE
                reason: !bbox ? "missing-bbox" : "empty-bbox", // CHANGE
                bbox: bedFitRectSnapshot(bbox) // CHANGE
            }); // CHANGE
            return false; // CHANGE
        } // CHANGE
        if (!fitWidth && !fitHeight) return false; // MOVED
        const model = graph.getModel(); // MOVED
        const current = model.getGeometry(tg); // MOVED
        if (!current) return false; // MOVED
        const beforeGeo = bedFitGeometrySnapshot(tg); // CHANGE
        const beforeTiles = bedFitTileSample(tg, 6); // CHANGE
        const finalWidth = fitWidth ? Math.max(1, bbox.w + GROUP_PADDING_PX * 2) : current.width; // MOVED
        const solved = fitHeight // MOVED
            ? solveOuterHeightForPlantingFrame(bbox.h, finalWidth, current.height) // MOVED
            : { outerHeight: current.height, bandPx: bedFitLabelBandPxForSize(finalWidth, current.height) }; // MOVED
        const next = buildAxisAwareTrimGeometry(tg, bed, bbox, fitWidth, fitHeight, finalWidth, solved.outerHeight, solved.bandPx); // MOVED
        if (!next) return false; // MOVED
        const dx = fitWidth ? GROUP_PADDING_PX - bbox.x : 0; // MOVED
        const dy = fitHeight ? GROUP_PADDING_PX + solved.bandPx - bbox.y : 0; // MOVED
        const childrenChanged = shiftPlantCircleChildrenLogical(tg, dx, dy); // CHANGE
        const groupChanged = !(nearlySameNumber(current.x, next.x) && nearlySameNumber(current.y, next.y) && nearlySameNumber(current.width, next.width) && nearlySameNumber(current.height, next.height)); // MOVED
        if (groupChanged) model.setGeometry(tg, next); // MOVED
        bedFitLog("trim", { // CHANGE
            txnId: debugCtx && debugCtx.txnId, // CHANGE
            groupId: bedFitCellId(tg), // CHANGE
            bedId: bedFitCellId(bed), // CHANGE
            fitWidth, // CHANGE
            fitHeight, // CHANGE
            bbox: bedFitRectSnapshot(bbox), // CHANGE
            finalWidth: bedFitRound(finalWidth), // CHANGE
            finalHeight: bedFitRound(solved.outerHeight), // CHANGE
            bandPx: bedFitRound(solved.bandPx), // CHANGE
            dx: bedFitRound(dx), // CHANGE
            dy: bedFitRound(dy), // CHANGE
            childrenChanged, // CHANGE
            groupChanged, // CHANGE
            beforeGeo, // CHANGE
            afterGeo: bedFitGeometrySnapshot(tg), // CHANGE
            tables: { // CHANGE
                "tiles before trim": beforeTiles, // CHANGE
                "tiles after trim": bedFitTileSample(tg, 6) // CHANGE
            } // CHANGE
        }); // CHANGE
        return childrenChanged || groupChanged; // MOVED
    } // MOVED

    function applyBedFitGeometry(tg, bed, allowDragIntoBedFit, debugCtx) { // CHANGE
        const ignoreBedAutoFit = !!(debugCtx && debugCtx.ignoreBedAutoFit); // CHANGE
        if (!tg || !bed || (!ignoreBedAutoFit && tg.getAttribute(BED_AUTO_FIT_ATTR) === "0")) { // CHANGE
            bedFitLog("fit-skip", { // CHANGE
                txnId: debugCtx && debugCtx.txnId, // CHANGE
                groupId: bedFitCellId(tg), // CHANGE
                bedId: bedFitCellId(bed), // CHANGE
                reason: !tg ? "missing-group" : (!bed ? "missing-bed" : "bed-auto-fit-disabled") // CHANGE
            }); // CHANGE
            return null; // CHANGE
        } // CHANGE
        const model = graph.getModel(); // MOVED
        const tgRect = getModelRect(tg); // MOVED
        const bedRect = getModelRect(bed); // MOVED
        if (!tgRect || !bedRect || bedRect.w <= 0 || bedRect.h <= 0) { // CHANGE
            bedFitLog("fit-skip", { // CHANGE
                txnId: debugCtx && debugCtx.txnId, // CHANGE
                groupId: bedFitCellId(tg), // CHANGE
                bedId: bedFitCellId(bed), // CHANGE
                reason: "invalid-rect", // CHANGE
                groupRect: bedFitRectSnapshot(tgRect), // CHANGE
                bedRect: bedFitRectSnapshot(bedRect) // CHANGE
            }); // CHANGE
            return null; // CHANGE
        } // CHANGE
        const diameter = getPlantCircleDiameterPx(tg); // MOVED
        const overhang = allowedOverhangForDiameter(diameter); // MOVED
        const frameRect = getPlantingFrameRectModel(tgRect); // MOVED
        if (!frameRect) return null; // MOVED
        const targetFrameWidth = bedRect.w + overhang * 2; // MOVED
        const targetFrameHeight = bedRect.h + overhang * 2; // MOVED
        const widthClose = Math.abs(frameRect.w - targetFrameWidth) <= bedRect.w * BED_FIT_TOLERANCE; // MOVED
        const heightClose = Math.abs(frameRect.h - targetFrameHeight) <= bedRect.h * BED_FIT_TOLERANCE; // MOVED
        const canDragFit = allowDragIntoBedFit && diameter < bedRect.w && diameter < bedRect.h; // MOVED
        const fitWidth = widthClose || canDragFit; // MOVED
        const fitHeight = heightClose || canDragFit; // MOVED
        if (!fitWidth && !fitHeight) { // CHANGE
            bedFitLog("fit-skip", { // CHANGE
                txnId: debugCtx && debugCtx.txnId, // CHANGE
                groupId: bedFitCellId(tg), // CHANGE
                bedId: bedFitCellId(bed), // CHANGE
                reason: "not-close-enough", // CHANGE
                allowDragIntoBedFit, // CHANGE
                diameter: bedFitRound(diameter), // CHANGE
                frameRect: bedFitRectSnapshot(frameRect), // CHANGE
                targetFrameWidth: bedFitRound(targetFrameWidth), // CHANGE
                targetFrameHeight: bedFitRound(targetFrameHeight), // CHANGE
                widthClose, // CHANGE
                heightClose, // CHANGE
                canDragFit // CHANGE
            }); // CHANGE
            return null; // CHANGE
        } // CHANGE
        const g = model.getGeometry(tg); // MOVED
        if (!g) return null; // MOVED
        const beforeGeo = bedFitGeometrySnapshot(tg); // CHANGE
        const beforeRotation = getTilerRotationDeg(tg); // CHANGE
        const beforeBandPx = groupLabelMetrics(tg).bandPx; // CHANGE
        const layoutSnapshot = captureBedFitLayoutSnapshot(tg); // CHANGE
        const next = g.clone(); // MOVED
        if (fitWidth) next.width = targetFrameWidth + GROUP_PADDING_PX * 2; // MOVED
        if (fitHeight) { // MOVED
            const solved = solveOuterHeightForPlantingFrame(targetFrameHeight, next.width, next.height); // MOVED
            next.height = solved.outerHeight; // MOVED
        } // MOVED
        const bedRotation = getTilerRotationDeg(bed); // MOVED
        const frameCenter = plantingFrameLocalCenter(next.width, next.height); // MOVED
        const bedCenter = rectCenterModel(bedRect); // MOVED
        positionGeometryForLocalPoint(next, frameCenter, bedCenter, bedRotation); // MOVED
        const geometryChanged = !(nearlySameNumber(g.x, next.x) && nearlySameNumber(g.y, next.y) && nearlySameNumber(g.width, next.width) && nearlySameNumber(g.height, next.height)); // MOVED
        const rotationChanged = setCellRotationDeg(tg, bedRotation); // MOVED
        if (geometryChanged) model.setGeometry(tg, next); // MOVED
        const afterBandPx = groupLabelMetrics(tg).bandPx; // CHANGE
        const bandDeltaY = (Number(afterBandPx) || 0) - (Number(beforeBandPx) || 0); // CHANGE
        shiftLayoutSnapshotByDeltaY(layoutSnapshot, bandDeltaY); // CHANGE
        bedFitLog("fit", { // CHANGE
            txnId: debugCtx && debugCtx.txnId, // CHANGE
            source: debugCtx && debugCtx.source, // CHANGE
            groupId: bedFitCellId(tg), // CHANGE
            bedId: bedFitCellId(bed), // CHANGE
            allowDragIntoBedFit, // CHANGE
            beforeGeo, // CHANGE
            afterGeo: bedFitGeometrySnapshot(tg), // CHANGE
            bedRect: bedFitRectSnapshot(bedRect), // CHANGE
            frameRect: bedFitRectSnapshot(frameRect), // CHANGE
            targetFrameWidth: bedFitRound(targetFrameWidth), // CHANGE
            targetFrameHeight: bedFitRound(targetFrameHeight), // CHANGE
            diameter: bedFitRound(diameter), // CHANGE
            overhang: bedFitRound(overhang), // CHANGE
            widthClose, // CHANGE
            heightClose, // CHANGE
            canDragFit, // CHANGE
            fitWidth, // CHANGE
            fitHeight, // CHANGE
            beforeRotation: bedFitRound(beforeRotation), // CHANGE
            bedRotation: bedFitRound(bedRotation), // CHANGE
            afterRotation: bedFitRound(getTilerRotationDeg(tg)), // CHANGE
            beforeBandPx: bedFitRound(beforeBandPx), // CHANGE
            afterBandPx: bedFitRound(afterBandPx), // CHANGE
            bandDeltaY: bedFitRound(bandDeltaY), // CHANGE
            geometryChanged, // CHANGE
            rotationChanged, // CHANGE
            snapshotTiles: layoutSnapshot && Array.isArray(layoutSnapshot.tiles) ? layoutSnapshot.tiles.length : 0 // CHANGE
        }); // CHANGE
        return { changed: geometryChanged || rotationChanged, fitWidth: fitWidth, fitHeight: fitHeight, bed: bed, layoutSnapshot: layoutSnapshot, previousRotationDeg: beforeRotation }; // CHANGE
    } // MOVED

    function retileAfterBedFit(tg, debugCtx) { // CHANGE
        const beforeTiles = bedFitTileSample(tg, 6); // CHANGE
        const beforeChildCount = (graph.getChildVertices(tg) || []).length; // CHANGE
        const beforeGeo = bedFitGeometrySnapshot(tg); // CHANGE
        const beforeRotation = getTilerRotationDeg(tg); // CHANGE
        let threw = false; // CHANGE
        let errorMessage = ""; // CHANGE
        try { // MOVED
            retileGroup(graph, tg, { // CHANGE
                layoutSnapshot: debugCtx && debugCtx.layoutSnapshot, // CHANGE
                previousRotationDeg: debugCtx && debugCtx.previousRotationDeg, // CHANGE
                useLiveSnapshot: false, // CHANGE
                preferInPlace: true, // CHANGE
                inTransaction: true // CHANGE
            }); // CHANGE
        } catch (e) { // MOVED
            threw = true; // CHANGE
            errorMessage = e && e.message ? e.message : String(e); // CHANGE
            try { mxLog.debug("[BedFit] retile failed:", e && e.message ? e.message : e); } catch (_) { } // MOVED
            graph.refresh(tg); // MOVED
        } // MOVED
        bedFitLog("retile", { // CHANGE
            txnId: debugCtx && debugCtx.txnId, // CHANGE
            source: debugCtx && debugCtx.source, // CHANGE
            groupId: bedFitCellId(tg), // CHANGE
            beforeGeo, // CHANGE
            afterGeo: bedFitGeometrySnapshot(tg), // CHANGE
            beforeRotation: bedFitRound(beforeRotation), // CHANGE
            afterRotation: bedFitRound(getTilerRotationDeg(tg)), // CHANGE
            previousRotationDeg: bedFitRound(debugCtx && debugCtx.previousRotationDeg), // CHANGE
            snapshotTiles: debugCtx && debugCtx.layoutSnapshot && Array.isArray(debugCtx.layoutSnapshot.tiles) ? debugCtx.layoutSnapshot.tiles.length : 0, // CHANGE
            beforeChildCount, // CHANGE
            afterChildCount: (graph.getChildVertices(tg) || []).length, // CHANGE
            lodCollapsed: isCollapsedLOD(tg), // CHANGE
            threw, // CHANGE
            errorMessage, // CHANGE
            tables: { // CHANGE
                "tiles before retile": beforeTiles, // CHANGE
                "tiles after retile": bedFitTileSample(tg, 6) // CHANGE
            } // CHANGE
        }); // CHANGE
    } // MOVED

    function finiteMoveDelta(value) { // MOVED
        const n = Number(value); // MOVED
        return Number.isFinite(n) ? n : null; // MOVED
    } // MOVED

    function normalizeMovedTilerGroupsToBeds(cells, opts) { // MOVED
        const txnId = ++bedFitTxnSeq; // CHANGE
        const source = (opts && opts.source) || "unknown"; // CHANGE
        if (bedFitInProgress) { // CHANGE
            bedFitLog("normalize-skip", { txnId, source, reason: "in-progress" }); // CHANGE
            return 0; // CHANGE
        } // CHANGE
        const groups = getTilerGroupsFromEventCells(cells); // MOVED
        const movedCells = (cells || []).filter(Boolean); // CHANGE
        if (!groups.length) { // CHANGE
            bedFitLog("normalize-skip", { // CHANGE
                txnId, // CHANGE
                source, // CHANGE
                reason: "no-groups", // CHANGE
                movedCellIds: movedCells.map(bedFitCellId) // CHANGE
            }); // CHANGE
            return 0; // CHANGE
        } // CHANGE
        if (shouldSuppressBedFitResize(source, groups)) { // CHANGE
            bedFitLog("normalize-skip", { // CHANGE
                txnId, // CHANGE
                source, // CHANGE
                reason: "recent-bed-fit-resize", // CHANGE
                movedCellIds: movedCells.map(bedFitCellId), // CHANGE
                groupIds: groups.map(bedFitCellId) // CHANGE
            }); // CHANGE
            return 0; // CHANGE
        } // CHANGE
        const model = graph.getModel(); // MOVED
        const allowDragIntoBedFit = !!(opts && opts.allowDragIntoBedFit); // MOVED
        const skipSameBedMoveFit = !!(opts && opts.skipSameBedMoveFit); // MOVED
        const moveDx = finiteMoveDelta(opts && opts.moveDx); // MOVED
        const moveDy = finiteMoveDelta(opts && opts.moveDy); // MOVED
        const changed = []; // MOVED
        let trimmed = false; // MOVED
        bedFitLog("normalize-start", { // CHANGE
            txnId, // CHANGE
            source, // CHANGE
            allowDragIntoBedFit, // CHANGE
            skipSameBedMoveFit, // CHANGE
            moveDx: bedFitRound(moveDx), // CHANGE
            moveDy: bedFitRound(moveDy), // CHANGE
            movedCellIds: movedCells.map(bedFitCellId), // CHANGE
            groupIds: groups.map(bedFitCellId) // CHANGE
        }); // CHANGE
        bedFitInProgress = true; // MOVED
        model.beginUpdate(); // MOVED
        try { // MOVED
            for (const tg of groups) { // MOVED
                const parent = model.getParent(tg); // MOVED
                const center = rectCenterModel(getModelRect(tg)); // MOVED
                const bed = findSmallestContainingBedModel(parent, center); // MOVED
                const previousCenter = center && moveDx != null && moveDy != null ? { x: center.x - moveDx, y: center.y - moveDy } : null; // CHANGE
                const previousBed = previousCenter ? findSmallestContainingBedModel(parent, previousCenter) : null; // CHANGE
                const sameBedMove = !!(skipSameBedMoveFit && bed && previousBed && previousBed.id === bed.id); // CHANGE
                bedFitLog("group-evaluate", { // CHANGE
                    txnId, // CHANGE
                    source, // CHANGE
                    groupId: bedFitCellId(tg), // CHANGE
                    parentId: bedFitCellId(parent), // CHANGE
                    currentBedId: bedFitCellId(bed), // CHANGE
                    previousBedId: bedFitCellId(previousBed), // CHANGE
                    center: center ? { x: bedFitRound(center.x), y: bedFitRound(center.y) } : null, // CHANGE
                    previousCenter: previousCenter ? { x: bedFitRound(previousCenter.x), y: bedFitRound(previousCenter.y) } : null, // CHANGE
                    groupGeo: bedFitGeometrySnapshot(tg), // CHANGE
                    groupRotation: bedFitRound(getTilerRotationDeg(tg)), // CHANGE
                    lodCollapsed: isCollapsedLOD(tg), // CHANGE
                    skipReason: sameBedMove ? "same-bed-move" : "" // CHANGE
                }); // CHANGE
                if (sameBedMove) continue; // CHANGE
                const fitResult = applyBedFitGeometry(tg, bed, allowDragIntoBedFit, { txnId, source }); // CHANGE
                if (fitResult) changed.push({ // CHANGE
                    tg: tg, // CHANGE
                    bed: fitResult.bed, // CHANGE
                    fitWidth: fitResult.fitWidth, // CHANGE
                    fitHeight: fitResult.fitHeight, // CHANGE
                    bedFitChanged: !!fitResult.changed, // CHANGE
                    layoutSnapshot: fitResult.layoutSnapshot, // CHANGE
                    previousRotationDeg: fitResult.previousRotationDeg // CHANGE
                }); // CHANGE
            } // MOVED
            for (const item of changed) retileAfterBedFit(item.tg, { // CHANGE
                txnId, // CHANGE
                source, // CHANGE
                layoutSnapshot: item.layoutSnapshot, // CHANGE
                previousRotationDeg: item.previousRotationDeg // CHANGE
            }); // CHANGE
            for (const item of changed) { // MOVED
                const bbox = getPlantCircleBBoxLogical(item.tg); // CHANGE
                if (trimGroupToPlantFootprint(item.tg, item.bed, bbox, item.fitWidth, item.fitHeight, { txnId, source })) trimmed = true; // CHANGE
            } // MOVED
        } finally { // MOVED
            model.endUpdate(); // MOVED
            bedFitInProgress = false; // MOVED
        } // MOVED
        if (trimmed) { // MOVED
            for (const item of changed) graph.refresh(item.tg); // MOVED
        } // MOVED
        if (trimmed || changed.some(item => item.bedFitChanged)) markBedFitResizeSuppression(changed); // CHANGE
        bedFitLog("normalize-end", { // CHANGE
            txnId, // CHANGE
            source, // CHANGE
            changedCount: changed.length, // CHANGE
            trimmed, // CHANGE
            tables: { // CHANGE
                "changed groups": changed.map(item => ({ // CHANGE
                    groupId: bedFitCellId(item.tg), // CHANGE
                    bedId: bedFitCellId(item.bed), // CHANGE
                    fitWidth: item.fitWidth, // CHANGE
                    fitHeight: item.fitHeight, // CHANGE
                    bedFitChanged: item.bedFitChanged, // CHANGE
                    finalGeo: bedFitGeometrySnapshot(item.tg), // CHANGE
                    finalRotation: bedFitRound(getTilerRotationDeg(item.tg)) // CHANGE
                })) // CHANGE
            } // CHANGE
        }); // CHANGE
        return changed.length; // MOVED
    } // MOVED

    function retileAndFitToContainingBed(graphArg, groupCell, opts) { // CHANGE
        const activeGraph = graphArg || graph; // CHANGE
        const source = (opts && opts.source) || "api-refit"; // CHANGE
        const ownsTransaction = !(opts && opts.inTransaction); // CHANGE
        const txnId = opts && opts.txnId ? opts.txnId : ++bedFitTxnSeq; // CHANGE
        if (!activeGraph || !groupCell || !isTilerGroup(groupCell) || bedFitInProgress) { // CHANGE
            bedFitLog("retile-fit-skip", { txnId, source, groupId: bedFitCellId(groupCell), reason: "not-available", hasGraph: !!activeGraph, isTilerGroup: isTilerGroup(groupCell), bedFitInProgress }); // NEW
            return { changed: false, fitted: false, reason: "not-available" }; // CHANGE
        } // CHANGE
        const model = activeGraph.getModel(); // CHANGE
        let fitResult = null; // CHANGE
        let trimmed = false; // CHANGE
        let result = { changed: false, fitted: false, reason: "" }; // CHANGE
        bedFitLog("retile-fit-start", { txnId, source, groupId: bedFitCellId(groupCell), groupGeo: bedFitGeometrySnapshot(groupCell), ownsTransaction }); // NEW
        bedFitInProgress = true; // CHANGE
        if (ownsTransaction) model.beginUpdate(); // CHANGE
        try { // CHANGE
            retileGroup(activeGraph, groupCell, { preferInPlace: true, inTransaction: true }); // CHANGE
            const parent = model.getParent(groupCell); // CHANGE
            const center = rectCenterModel(getModelRect(groupCell)); // CHANGE
            const bed = findSmallestContainingBedModel(parent, center); // CHANGE
            bedFitLog("retile-fit-bed-resolve", { txnId, source, groupId: bedFitCellId(groupCell), parentId: bedFitCellId(parent), bedId: bedFitCellId(bed), center: center ? { x: bedFitRound(center.x), y: bedFitRound(center.y) } : null }); // NEW
            if (!bed) { result = { changed: false, fitted: false, reason: "no-containing-bed" }; return result; } // CHANGE
            fitResult = applyBedFitGeometry(groupCell, bed, true, { txnId, source, ignoreBedAutoFit: true }); // CHANGE
            if (!fitResult) { result = { changed: false, fitted: false, reason: "fit-skipped", bed }; return result; } // CHANGE
            retileAfterBedFit(groupCell, { // CHANGE
                txnId, // CHANGE
                source, // CHANGE
                layoutSnapshot: fitResult.layoutSnapshot, // CHANGE
                previousRotationDeg: fitResult.previousRotationDeg // CHANGE
            }); // CHANGE
            const bbox = getPlantCircleBBoxLogical(groupCell); // CHANGE
            trimmed = trimGroupToPlantFootprint(groupCell, fitResult.bed, bbox, fitResult.fitWidth, fitResult.fitHeight, { txnId, source }); // CHANGE
            result = { changed: !!(fitResult.changed || trimmed), fitted: true, trimmed }; // CHANGE
            return result; // CHANGE
        } finally { // CHANGE
            if (ownsTransaction) model.endUpdate(); // CHANGE
            bedFitInProgress = false; // CHANGE
            if (fitResult && (trimmed || fitResult.changed)) markBedFitResizeSuppression([{ tg: groupCell }]); // CHANGE
            activeGraph.refresh(groupCell); // CHANGE
            bedFitLog("retile-fit-end", { txnId, source, groupId: bedFitCellId(groupCell), result, finalGeo: bedFitGeometrySnapshot(groupCell), trimmed, fitChanged: !!(fitResult && fitResult.changed) }); // NEW
        } // CHANGE
    } // CHANGE


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

    function notifyTilerGroupCreated(graph, group, source, debugTxnId) { // CHANGE
        if (!graph || !group) return; // CHANGE
        const groupId = group.id || ""; // CHANGE
        const txnId = debugTxnId || null; // NEW
        bedFitLog("created-event-schedule", { txnId, source: source || "", groupId: groupId || bedFitCellId(group) }); // NEW
        setTimeout(function () { // CHANGE
            const model = graph.getModel && graph.getModel(); // CHANGE
            const liveGroup = groupId && model && model.getCell ? model.getCell(groupId) : group; // CHANGE
            if (!liveGroup || !isTilerGroup(liveGroup)) { // CHANGE
                bedFitLog("created-event-skip", { txnId, source: source || "", groupId, reason: "missing-live-group" }); // NEW
                return; // CHANGE
            } // CHANGE
            try { // CHANGE
                bedFitLog("created-event-fire", { txnId, source: source || "", groupId: bedFitCellId(liveGroup), groupGeo: bedFitGeometrySnapshot(liveGroup) }); // NEW
                graph.fireEvent(new mxEventObject(TILER_GROUP_CREATED_EVENT, "cell", liveGroup, "cellId", liveGroup.id || groupId, "source", source || "")); // CHANGE
                bedFitLog("created-event-fired", { txnId, source: source || "", groupId: bedFitCellId(liveGroup) }); // NEW
            } catch (e) { // CHANGE
                bedFitLog("created-event-error", { txnId, source: source || "", groupId: bedFitCellId(liveGroup), errorMessage: e && e.message ? e.message : String(e) }); // NEW
            } // CHANGE
        }, 0); // CHANGE
    } // CHANGE

    function finalizeCreatedTilerGroup(graph, group, parent, source, debugTxnId) { // CHANGE
        if (!graph || !group) return null; // NEW
        const model = graph.getModel(); // NEW
        const txnId = debugTxnId || ++bedFitTxnSeq; // NEW
        const debugSource = source || "tiler-created"; // NEW
        let fitResult = null; // NEW
        let threw = false; // NEW
        let errorMessage = ""; // NEW
        bedFitLog("finalize-created-start", { txnId, source: debugSource, groupId: bedFitCellId(group), parentId: bedFitCellId(parent), parentIsGardenModule: !!(parent && isGardenModule(parent)), groupGeo: bedFitGeometrySnapshot(group) }); // NEW
        try { // NEW
            fitResult = retileAndFitToContainingBed(graph, group, { source: debugSource, inTransaction: true, txnId }); // CHANGE
            if (parent && isGardenModule(parent)) reorderModuleChildrenForLayering(model, parent); // NEW
            graph.setSelectionCell(group); // NEW
            return group; // NEW
        } catch (e) { // NEW
            threw = true; // NEW
            errorMessage = e && e.message ? e.message : String(e); // NEW
            throw e; // NEW
        } finally { // NEW
            bedFitLog("finalize-created-end", { txnId, source: debugSource, groupId: bedFitCellId(group), fitResult, threw, errorMessage, finalGeo: bedFitGeometrySnapshot(group) }); // NEW
        } // NEW
    } // NEW

    function createDefaultGardenBed(graph, moduleCell, clickX, clickY) { // CHANGE
        const dimsCm = getDefaultBedDimensionsCm(moduleCell); // CHANGE
        if (!dimsCm) throw new Error("Default bed dimensions are not set."); // CHANGE

        const modGeo = moduleCell.getGeometry && moduleCell.getGeometry(); // CHANGE
        const gx = modGeo ? modGeo.x : 0; // CHANGE
        const gy = modGeo ? modGeo.y : 0; // CHANGE
        const gw = modGeo ? modGeo.width : toPx(dimsCm.widthCm); // CHANGE
        const gh = modGeo ? modGeo.height : toPx(dimsCm.lengthCm); // CHANGE
        const w = toPx(dimsCm.widthCm); // CHANGE
        const h = toPx(dimsCm.lengthCm); // CHANGE
        const localX = (typeof clickX === "number") ? (clickX - gx - w / 2) : (gw - w) / 2; // CHANGE
        const localY = (typeof clickY === "number") ? (clickY - gy - h / 2) : (gh - h) / 2; // CHANGE
        const relX = Math.max(0, Math.min(gw - w, localX)); // CHANGE
        const relY = Math.max(0, Math.min(gh - h, localY)); // CHANGE
        const bedVal = createXmlValue("GardenBed", { label: "Garden Bed", garden_bed: "1" }); // CHANGE
        const bed = new mxCell(bedVal, new mxGeometry(relX, relY, w, h), addBedStyle("shape=rectangle;whiteSpace=wrap;html=1")); // CHANGE
        bed.setVertex(true); // CHANGE
        bed.setConnectable(false); // CHANGE

        const model = graph.getModel(); // CHANGE
        model.beginUpdate(); // CHANGE
        try { // CHANGE
            graph.addCell(bed, moduleCell); // CHANGE
            graph.setSelectionCell(bed); // CHANGE
            reorderModuleChildrenForLayering(model, moduleCell); // CHANGE
        } finally { // CHANGE
            model.endUpdate(); // CHANGE
        } // CHANGE
        graph.refresh(bed); // CHANGE
        return bed; // CHANGE
    } // CHANGE


    /**
     * Creates an empty tiler group inside the given garden module.
     * - No plant is preselected.
     * - Defaults spacing to 30 cm (both axes).
     * - Centers a 240x240 group within the module bounds.
     */
    function createEmptyTilerGroup(graph, moduleCell, clickX, clickY, opts = {}) { // CHANGE
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

        const seasonStartYear = getCurrentGardenYear(moduleCell); // NEW

        const groupVal = createXmlValue("TilerGroup", {
            label: "New Plant Group",
            tiler_group: "1",
            season_start_year: String(seasonStartYear), // NEW

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
        const creationSource = (opts && opts.source) || "empty-group"; // NEW
        const creationTxnId = ++bedFitTxnSeq; // NEW
        let threw = false; // NEW
        let errorMessage = ""; // NEW
        bedFitLog("create-empty-start", { txnId: creationTxnId, source: creationSource, moduleId: bedFitCellId(moduleCell), clickX: bedFitRound(clickX), clickY: bedFitRound(clickY), localX: bedFitRound(localX), localY: bedFitRound(localY), relX: bedFitRound(relX), relY: bedFitRound(relY), groupId: bedFitCellId(group), groupGeo: bedFitGeometrySnapshot(group) }); // NEW
        model.beginUpdate();
        try {
            graph.addCell(group, moduleCell);
            finalizeCreatedTilerGroup(graph, group, moduleCell, creationSource, creationTxnId); // CHANGE
        } catch (e) { // NEW
            threw = true; // NEW
            errorMessage = e && e.message ? e.message : String(e); // NEW
            throw e; // NEW
        } finally {
            model.endUpdate();
            bedFitLog("create-empty-end", { txnId: creationTxnId, source: creationSource, moduleId: bedFitCellId(moduleCell), groupId: bedFitCellId(group), finalGeo: bedFitGeometrySnapshot(group), threw, errorMessage }); // NEW
        }
        notifyTilerGroupCreated(graph, group, creationSource, creationTxnId); // CHANGE
        bedFitLog("create-empty-notify-scheduled", { txnId: creationTxnId, source: creationSource, groupId: bedFitCellId(group) }); // NEW
        return group; // CHANGE
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

        const okBtn = mxUtils.button("OK", function () {
            const x = Number(inputX.value),
                y = Number(inputY.value);
            if (!isFinite(x) || !isFinite(y) || x <= 0 || y <= 0) {
                log("[spacing] invalid " + JSON.stringify({ x, y })); // CHANGE
                return;
            }
            ui.hideDialog();
            onOk(x, y);
        });
        const cancelBtn = mxUtils.button("Cancel", function () {
            ui.hideDialog();
        });
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

        ui.showDialog(div, 360, 170, true, true); // CHANGE
        elevateTrellisDialog(); // NEW
        inputX.focus();
    }

    function runSetGroupSpacingOn(graph, groupCell) {
        if (!groupCell || !isTilerGroup(groupCell)) {
            log("[spacing] not a tiler group"); // CHANGE
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

            log("[spacing] applied " + JSON.stringify({ x, y })); // CHANGE
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



    // ---------- Popup menu: register deterministic Trellis contributor ---------- // CHANGE
    if (graph && graph.popupMenuHandler) {
        graph.popupMenuHandler.selectOnPopup = false;
        log("Registering ordered popup contributor"); // CHANGE

        function registerTrellisContextMenuContributor(contributor) { // NEW
            function finishRegistration() { // NEW
                if (!window.TrellisContextMenu) return; // NEW
                window.TrellisContextMenu.install(ui); // NEW
                window.TrellisContextMenu.register(contributor); // NEW
            } // NEW

            if (window.TrellisContextMenu) { // NEW
                finishRegistration(); // NEW
            } else if (typeof mxscript === "function") { // NEW
                mxscript("plugins/garden_planner_plugins/Trellis_Context_Menu.js", finishRegistration); // NEW
            } // NEW
        } // NEW

        // Helpers must be defined BEFORE factoryMethod uses them
        function hitTestCell(evt) {
            try {
                const pt = mxUtils.convertPoint(graph.container, evt.clientX, evt.clientY);
                const s = graph.view.scale,
                    tr = graph.view.translate;
                const gx = pt.x / s - tr.x,
                    gy = pt.y / s - tr.y;
                const hit = graph.getCellAt(gx, gy);
                log("[hitTest] " + JSON.stringify({ clientX: evt.clientX, clientY: evt.clientY, gx, gy, s, tr: { x: tr.x, y: tr.y } })); // CHANGE
                return hit;
            } catch (e) {
                log("[hitTest] error " + e.message); // CHANGE
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
            log("[popup] cells " + JSON.stringify({ byParam: dbgCellInfo(byParam), byHit: dbgCellInfo(byHit), bySel: dbgCellInfo(bySel), target: dbgCellInfo(t) })); // CHANGE
            return t;
        }

        function resolveModuleTarget(cell, evt) {
            const byParam = cell || null;
            const byHit = evt ? hitTestCell(evt) : null;
            const bySel = graph.getSelectionCell() || null;
            const cand = byParam || byHit || bySel;
            const t = cand ? findModuleAncestor(graph, cand) : null;
            log("[popup][module] cand=" + JSON.stringify(dbgCellInfo(cand)) + " -> target=" + JSON.stringify(dbgCellInfo(t))); // CHANGE
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


        registerTrellisContextMenuContributor({ // CHANGE
            id: "plantTiler", // CHANGE
            priority: 300, // NEW
            addItems: function (menu, cell, evt) { // CHANGE
                log("[popup] start " + JSON.stringify({ orderedContributor: true })); // CHANGE

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
                    log("[popup] adding spacing item " + JSON.stringify({ curX, curY })); // CHANGE
                    menu.addItem(label, null, function () {
                        try {
                            const act = ui.actions.get("setGroupSpacing");
                            if (act && typeof act.funct === "function") {
                                log("[popup] invoking action setGroupSpacing"); // CHANGE
                                act.funct();
                            } else {
                                log("[popup] action missing; using direct invoker"); // CHANGE
                                runSetGroupSpacingOn(graph, target);
                            }
                        } catch (e) {
                            log("[popup] action error " + e.message); // CHANGE
                        }
                    });
                } else {
                    log("[popup] no tiler group under cursor"); // CHANGE
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
                            log(`[trim] groups=${trimmedGroups}/${candidates.length} removed=${totalRemoved}`); // CHANGE
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
                        if (openGardenSettingsDialogWithOverlaySuppressed) { // NEW
                            await openGardenSettingsDialogWithOverlaySuppressed(targetMod); // NEW
                        } else { // NEW
                            await showGardenSettingsDialog(ui, graph, targetMod); // NEW
                        } // NEW
                    });
                }

                // --- Add New Plant Group (requires garden settings) ----------------------------------
                if (targetMod && isGardenModule(targetMod)) {
                    if (hasGardenSettingsSet(targetMod)) {
                        menu.addItem("Add New Plant Group", null, function () {
                            try {
                                const pt = graph.getPointForEvent(evt);
                                createEmptyTilerGroup(graph, targetMod, pt.x, pt.y);
                                log("[module] empty tiler group created"); // CHANGE
                            } catch (e) {
                                mxUtils.alert("Error creating tiler group: " + e.message);
                            }
                        });
                    } else {
                        // Disabled hint (non-clickable)
                        menu.addItem("Set garden settings to add plants", null, function () { }, null, null, false);
                    }
                }
            } // CHANGE
        }); // CHANGE

        log("Popup contributor registered " + JSON.stringify({ hasPopup: !!graph.popupMenuHandler, hasAction: !!ui.actions.get("setGroupSpacing") })); // CHANGE
    } else {
        log("popupMenuHandler not available"); // CHANGE
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

        const moduleCell = findGardenModuleAncestor(graph, parent); // NEW
        const seasonStartYear = moduleCell ? getCurrentGardenYear(moduleCell) : getCurrentCalendarYear(); // NEW

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
            season_start_year: String(seasonStartYear), // NEW
            
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

        model.beginUpdate(); // NEW
        try { // NEW
            graph.addCell(group, parent); // CHANGE

            // Move circles into group; convert to GROUP-RELATIVE coordinates                               // CHANGE
            for (const c of circleCells) { // CHANGE
                const cg = c.getGeometry(); // CHANGE
                if (!cg) continue; // CHANGE

                const local = cg.clone(); // CHANGE
                local.x = cg.x - groupX; // CHANGE
                local.y = (cg.y - groupY) + bandPx; // CHANGE

                model.setGeometry(c, local); // CHANGE
                graph.addCell(c, group); // CHANGE
            } // CHANGE
            finalizeCreatedTilerGroup(graph, group, parent, "plant-circle-wrap"); // CHANGE
        } finally { // NEW
            model.endUpdate(); // NEW
        } // NEW
        notifyTilerGroupCreated(graph, group, "plant-circle-wrap"); // CHANGE
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

    function isDIrty(cell) { // RESTORE
        if (!cell || !cell.getAttribute) return false; // RESTORE
        return cell.getAttribute("dirty") === "1"; // RESTORE
    } // RESTORE

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
        const center = childCenterInUnrotatedGroupSpace(groupCell, childCell); // NEW
        if (!gg || !center) return false; // CHANGE
        // Child geos are visual group-local positions; compare unrotated centers to [0..w]x[0..h]. // CHANGE
        const eps = 0.01;
        if (center.x < -eps) return true; // CHANGE
        if (center.y < -eps) return true; // CHANGE
        if (center.x > gg.width + eps) return true; // CHANGE
        if (center.y > gg.height + eps) return true; // CHANGE
        return false;
    }

    // expand/collapse helpers
    function expandGroupDetail(graph, groupCell, opts = {}) { // CHANGE
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
            collapseToSummary(graph, groupCell, abbr, sx, sy, opts); // CHANGE
            return;
        }
        expandTiles(graph, groupCell, abbr, sx, sy, iconDiam, opts); // CHANGE
    }

    function collapseGroupDetail(graph, groupCell) { // RESTORE
        const abbr = groupCell.getAttribute("plant_abbr") || "?"; // RESTORE
        const sx = toPx(Number(groupCell.getAttribute("spacing_x_cm") || // RESTORE
            groupCell.getAttribute("spacing_cm") || "30")); // RESTORE
        const sy = toPx(Number(groupCell.getAttribute("spacing_y_cm") || // RESTORE
            groupCell.getAttribute("spacing_cm") || "30")); // RESTORE
        collapseToSummary(graph, groupCell, abbr, sx, sy); // RESTORE
    } // RESTORE

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

    // Viewport-only scroll/pan must not mutate tiler geometry. // CHANGE

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

        if (opts.duringResize) return; // CHANGE
        const model = graph.getModel();
        const ownsTitleUpdate = !opts.inTransaction; // CHANGE
        if (ownsTitleUpdate) model.beginUpdate(); // CHANGE
        try {
            syncGroupTitle(model, groupCell);
            applyGroupLabelFont(model, groupCell); // CHANGE
        } finally {
            if (ownsTitleUpdate) model.endUpdate(); // CHANGE
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
            collapseToSummary(graph, groupCell, abbr, spacingXpx, spacingYpx, { layoutSnapshot: opts.layoutSnapshot, previousRotationDeg: opts.previousRotationDeg, useLiveSnapshot: opts.useLiveSnapshot }); // CHANGE
            return;
        }
        if (forceExpand) {
            expandGroupDetail(graph, groupCell, { layoutSnapshot: opts.layoutSnapshot, previousRotationDeg: opts.previousRotationDeg, useLiveSnapshot: opts.useLiveSnapshot }); // CHANGE
            return;
        }

        if (autoCollapse && !collapsed) {
            collapseToSummary(graph, groupCell, abbr, spacingXpx, spacingYpx, { layoutSnapshot: opts.layoutSnapshot, previousRotationDeg: opts.previousRotationDeg, useLiveSnapshot: opts.useLiveSnapshot }); // CHANGE
            return;
        }
        if (autoExpand && collapsed) {
            expandGroupDetail(graph, groupCell, { layoutSnapshot: opts.layoutSnapshot, previousRotationDeg: opts.previousRotationDeg, useLiveSnapshot: opts.useLiveSnapshot }); // CHANGE
            return;
        }

        // Default path: keep current state; only refresh contents/summary        
        if (!collapsed) {
            if (opts.preferInPlace && hasEffectiveRotation(groupCell)) { // NEW
                const synced = syncAutoTileGeometriesInPlace(graph, groupCell, abbr, spacingXpx, spacingYpx, iconDiam, { // NEW
                    layoutSnapshot: opts.layoutSnapshot, // NEW
                    previousRotationDeg: opts.previousRotationDeg, // NEW
                    useLiveSnapshot: opts.useLiveSnapshot, // NEW
                    inTransaction: opts.inTransaction // NEW
                }); // NEW
                if (!synced.fallback) return; // NEW
            } // NEW
            expandTiles(graph, groupCell, abbr, spacingXpx, spacingYpx, iconDiam, { layoutSnapshot: opts.layoutSnapshot, previousRotationDeg: opts.previousRotationDeg, useLiveSnapshot: opts.useLiveSnapshot }); // CHANGE
        } else {
            collapseToSummary(graph, groupCell, abbr, spacingXpx, spacingYpx, { layoutSnapshot: opts.layoutSnapshot, previousRotationDeg: opts.previousRotationDeg, useLiveSnapshot: opts.useLiveSnapshot }); // CHANGE
        }
    }

    (function installRotationRetileListener() { // NEW
        if (graph.__plantTilerRotationRetileInstalled) return; // NEW
        graph.__plantTilerRotationRetileInstalled = true; // NEW

        const model = graph.getModel(); // NEW
        const queue = new Map(); // NEW
        let timer = null; // NEW
        let guard = false; // NEW

        function rotationLayoutSnapshot(groupCell, previousRotationDeg, geometryByCellId) { // NEW
            const snap = captureLodLayoutSnapshot(graph, groupCell, { // NEW
                rotationDeg: previousRotationDeg, // NEW
                geometryByCellId: geometryByCellId // NEW
            }); // NEW
            if (snapshotHasTiles(snap)) return snap; // NEW
            return isCollapsedLOD(groupCell) ? readLodLayoutSnapshot(groupCell) : snap; // NEW
        } // NEW

        function schedule(groupCell, layoutSnapshot) { // CHANGE
            if (!groupCell || !groupCell.id) return; // NEW
            if (!queue.has(groupCell.id)) queue.set(groupCell.id, { groupCell, layoutSnapshot }); // CHANGE
            if (timer) clearTimeout(timer); // CHANGE
            timer = setTimeout(function () { // NEW
                const items = Array.from(queue.values()); // NEW
                queue.clear(); // NEW
                timer = null; // NEW
                guard = true; // NEW
                const groupsNeedingRefresh = []; // NEW
                try { // NEW
                    withUndoSuppressed(function () { // NEW
                        model.beginUpdate(); // CHANGE
                        try { // NEW
                            for (const item of items) { // NEW
                                if (!item.groupCell || !isTilerGroup(item.groupCell)) continue; // NEW
                                retileGroup(graph, item.groupCell, { layoutSnapshot: item.layoutSnapshot, useLiveSnapshot: false, preferInPlace: true, inTransaction: true }); // CHANGE
                                groupsNeedingRefresh.push(item.groupCell); // NEW
                            } // NEW
                        } finally {
                            model.endUpdate(); // CHANGE
                        }
                    }); // NEW
                } finally { // NEW
                    guard = false; // NEW
                } // NEW
                for (const group of groupsNeedingRefresh) graph.refresh(group); // NEW
            }, ROTATION_RETILE_DEBOUNCE_MS); // CHANGE
        } // NEW

        model.addListener(mxEvent.CHANGE, function (_sender, evt) { // NEW
            if (guard) return; // NEW
            const edit = evt && evt.getProperty && evt.getProperty("edit"); // NEW
            const changes = edit && edit.changes ? edit.changes : []; // NEW
            const geometryByCellId = previousGeometryByCellIdFromChanges(changes); // NEW
            for (const change of changes) { // NEW
                const rotationChange = rotationChangedFromStyleChange(change); // NEW
                if (!rotationChange) continue; // NEW
                if (rotationChange.cell && rotationChange.cell.id && queue.has(rotationChange.cell.id)) { // NEW
                    schedule(rotationChange.cell, null); // NEW
                    continue; // NEW
                } // NEW
                const snap = rotationLayoutSnapshot(rotationChange.cell, rotationChange.before, geometryByCellId); // NEW
                schedule(rotationChange.cell, snap); // CHANGE
            } // NEW
        }); // NEW
    })(); // NEW

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

            if (isGardenBed(c) || isTilerGroup(c)) {
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

    (function installBedAutoFitListeners() { // MOVED
        if (graph.__plantTilerBedAutoFitInstalled) return; // MOVED
        graph.__plantTilerBedAutoFitInstalled = true; // MOVED

        graph.addListener(mxEvent.CELLS_MOVED, function (_sender, evt) { // MOVED
            const cells = evt.getProperty("cells"); // MOVED
            normalizeMovedTilerGroupsToBeds(cells, { // MOVED
                source: "cells-moved", // CHANGE
                allowDragIntoBedFit: true, // MOVED
                skipSameBedMoveFit: true, // MOVED
                moveDx: evt.getProperty("dx"), // MOVED
                moveDy: evt.getProperty("dy") // MOVED
            }); // MOVED
        }); // MOVED

        graph.addListener(mxEvent.CELLS_RESIZED, function (_sender, evt) { // MOVED
            const cells = evt.getProperty("cells"); // MOVED
            normalizeMovedTilerGroupsToBeds(cells, { source: "cells-resized", allowDragIntoBedFit: false }); // CHANGE
        }); // MOVED
    })(); // MOVED

    function minGroupSizePx(spacingXpx, spacingYpx, bandPx) {
        const b = Number.isFinite(Number(bandPx)) ? Number(bandPx) : GROUP_LABEL_BAND_PX;
        const minW = (GROUP_PADDING_PX * 2) + spacingXpx;
        const minH = (GROUP_PADDING_PX * 2) + b + spacingYpx;
        return { minW, minH };
    }

    function buildResizeSnapshot(graph, groupCell, includeLayout) { // NEW
        const sx = toPx(Number(groupCell.getAttribute("spacing_x_cm") || groupCell.getAttribute("spacing_cm") || "30")); // NEW
        const sy = toPx(Number(groupCell.getAttribute("spacing_y_cm") || groupCell.getAttribute("spacing_cm") || "30")); // NEW
        const vegDiamCm = Number(groupCell.getAttribute("veg_diameter_cm") || 0); // NEW
        let iconDiam = vegDiamCm > 0 // NEW
            ? toPx(vegDiamCm) // NEW
            : clamp(DEFAULT_ICON_DIAM_RATIO * Math.min(sx, sy), MIN_ICON_DIAM_PX, MAX_ICON_DIAM_PX); // NEW
        iconDiam = Math.max(iconDiam, 6); // NEW

        const { bandPx } = groupLabelMetrics(groupCell); // NEW
        return { // NEW
            prev: includeLayout ? gridSnapshot(groupCell, sx, sy) : null, // CHANGE
            spacingXpx: sx, // NEW
            spacingYpx: sy, // NEW
            iconDiamPx: iconDiam, // NEW
            bandPx, // NEW
            rotated: includeLayout ? hasEffectiveRotation(groupCell) : false, // CHANGE
            layoutSnapshot: includeLayout ? resolveLayoutSnapshot(graph, groupCell) : null // CHANGE
        }; // NEW
    } // NEW

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

    function ensureLineSlotsPresent(graph, groupCell, abbr, rows, cols, spacingXpx, spacingYpx, iconDiamPx, opts = {}) { // CHANGE
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
        const ownsUpdate = !opts.inTransaction; // CHANGE
        if (ownsUpdate) model.beginUpdate(); // CHANGE
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
            if (ownsUpdate) model.endUpdate(); // CHANGE
        }

        return added;
    }



    function addTileAtSlot(graph, groupCell, abbr, r, c, spacingXpx, spacingYpx, iconDiamPx, disabledSet, bandPx, fontPx) {
        if (disabledSet && disabledSet.has(`${r},${c}`)) return null;

        const geo = tileGeometryAtSlot(groupCell, r, c, spacingXpx, spacingYpx, iconDiamPx, bandPx); // CHANGE

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

    function applyResizeDelta(graph, groupCell, prev, next, spacingXpx, spacingYpx, iconDiamPx, opts = {}) { // CHANGE
        const model = graph.getModel();
        const abbr = groupCell.getAttribute("plant_abbr") || "?";

        const disabledSet = readDisabledSet(groupCell);

        // If LOD collapsed, don’t maintain tiles. Keep your existing collapse/summary behavior.
        if (isCollapsedLOD(groupCell)) return;

        const { bandPx } = groupLabelMetrics(groupCell);
        const fontPx = tileFontPx(iconDiamPx);

        const slotMap = buildSlotMap(graph, groupCell);

        const ownsUpdate = !opts.inTransaction; // CHANGE
        if (ownsUpdate) model.beginUpdate(); // CHANGE
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
            if (ownsUpdate) model.endUpdate(); // CHANGE
        }
    }

    function shiftGroupChildrenByDeltaBand(graph, groupCell, deltaY, opts = {}) {      // CHANGE
        if (!deltaY || !Number.isFinite(deltaY)) return;                               // NEW
        if (!groupCell || isCollapsedLOD(groupCell)) return;                           // NEW

        const model = graph.getModel();                                                // NEW
        const kids = graph.getChildVertices(groupCell) || [];                          // NEW

        const ownsUpdate = !opts.inTransaction;                                        // NEW
        if (ownsUpdate) model.beginUpdate();                                           // CHANGE
        try {
            for (const k of kids) {
                if (!k) continue;
                if (!isPlantCircle(k)) continue;                                       // NEW (only plant circles)
                if (k.getAttribute && k.getAttribute("lod_summary") === "1") continue; // NEW (paranoia)

                const g = k.getGeometry && k.getGeometry();
                if (!g) continue;

                const ng = g.clone();
                ng.y = (Number(ng.y) || 0) + deltaY;                                   // NEW
                model.setGeometry(k, ng);                                              // NEW
            }
        } finally {
            if (ownsUpdate) model.endUpdate();                                         // CHANGE
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


    // -------------------- Resize → Retile in SAME undo step --------------------
    (function installResizeCellsWrapper() {
        if (graph.__plantTilerResizeCellsWrapped) return;
        graph.__plantTilerResizeCellsWrapped = true;

        const oldResizeCells = graph.resizeCells;

        graph.resizeCells = function (cells, bounds, recurse) {
            const model = graph.getModel();
            const duringResize = !!graph.isMouseDown; // CHANGE

            // Collect affected tiler groups and snapshot BEFORE resize
            const groups = new Map();
            for (const c of (cells || [])) {
                const g = isTilerGroup(c) ? c : findTilerGroupAncestor(graph, c);
                if (g && g.id) groups.set(g.id, g);
            }

            const hasTiler = groups.size > 0;

            const snapshots = new Map(); // groupId -> { prev, spacingXpx, spacingYpx, iconDiamPx, bandPx, rotated, layoutSnapshot } // CHANGE
            for (const g of groups.values()) {
                snapshots.set(g.id, buildResizeSnapshot(graph, g, !duringResize)); // CHANGE
            }

            // Clamp tiler group bounds to minimum 1×1 capacity
            if (hasTiler) {
                bounds = clampTilerBounds(cells, bounds, snapshots);
            }

            // During drag: do ONLY the geometry resize (lightweight)                         // CHANGED
            if (duringResize || !hasTiler) {                                                 // CHANGED
                return oldResizeCells.call(this, cells, bounds, hasTiler ? false : recurse); // CHANGED
            }

            // Mouse-up: make geometry resize + all follow-up edits ONE undoable change       // CHANGED
            let res;                                                                         // CHANGED
            const groupsNeedingRefresh = [];                                                 // CHANGED

            model.beginUpdate();                                                             // CHANGED
            try {
                // Geometry resize happens inside the SAME outer transaction                  // CHANGED
                res = oldResizeCells.call(this, cells, bounds, false);                        // CHANGED

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
                        if (snap.rotated) shiftLayoutSnapshotByDeltaY(snap.layoutSnapshot, deltaBandY); // NEW
                        else shiftGroupChildrenByDeltaBand(graph, g, deltaBandY, { inTransaction: true }); // CHANGE
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
                        collapseToSummary(graph, g, abbr, snap.spacingXpx, snap.spacingYpx, snap.rotated ? { layoutSnapshot: snap.layoutSnapshot, useLiveSnapshot: false } : {}); // CHANGE
                        groupsNeedingRefresh.push(g);
                        continue;
                    }

                    // If currently collapsed but now under thresholds, expand
                    if (isCollapsedLOD(g)) {
                        expandTiles(graph, g, abbr, snap.spacingXpx, snap.spacingYpx, snap.iconDiamPx, snap.rotated ? { layoutSnapshot: snap.layoutSnapshot, useLiveSnapshot: false } : {}); // CHANGE
                        groupsNeedingRefresh.push(g);
                        continue;
                    }

                    if (snap.rotated) { // NEW
                        const synced = syncAutoTileGeometriesInPlace(graph, g, abbr, snap.spacingXpx, snap.spacingYpx, snap.iconDiamPx, { layoutSnapshot: snap.layoutSnapshot, useLiveSnapshot: false, inTransaction: true }); // CHANGE
                        if (synced.fallback) expandTiles(graph, g, abbr, snap.spacingXpx, snap.spacingYpx, snap.iconDiamPx, { layoutSnapshot: snap.layoutSnapshot, useLiveSnapshot: false }); // CHANGE
                        groupsNeedingRefresh.push(g); // NEW
                        continue; // NEW
                    } // NEW

                    // Delta slot maintenance (add/remove)
                    applyResizeDelta(graph, g, snap.prev, next, snap.spacingXpx, snap.spacingYpx, snap.iconDiamPx, { inTransaction: true }); // CHANGE

                    ensureLineSlotsPresent(
                        graph,
                        g,
                        abbr,
                        next.rows,
                        next.cols,
                        snap.spacingXpx,
                        snap.spacingYpx,
                        snap.iconDiamPx,
                        { inTransaction: true } // CHANGE
                    );

                    groupsNeedingRefresh.push(g);
                }
            } finally {
                model.endUpdate();                                                           // CHANGED
            }

            for (const g of groupsNeedingRefresh) graph.refresh(g);
            return res;
        };
    })();



    // ---- Public API export (for other plugins) ---------------------------------
    window.USL = window.USL || {};
    window.USL.tiler = Object.assign({}, window.USL.tiler, {
        retileGroup, // CHANGE
        retileAndFitToContainingBed // CHANGE
    });
    installTrellisDebugSurface(); // NEW
    bedFitLog("loaded", bedFitStatus()); // NEW

    // -------------------- Boot --------------------
    (async function init() {
        try {

        } catch (e) {
            log("Init error:", e.message);
        }
    })();
});
