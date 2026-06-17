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

    const GROUP_LABEL_FONT_PX = 12;
    const GROUP_LABEL_LINE_HEIGHT = 1.25;
    const GROUP_LABEL_BAND_PAD_PX = 6;
    const GROUP_LABEL_BAND_PX = Math.ceil(GROUP_LABEL_FONT_PX * GROUP_LABEL_LINE_HEIGHT + GROUP_LABEL_BAND_PAD_PX);

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
    const GROUP_LABEL_FONT_MAX_PX = 100;


    // -------------------- Debug helper ------------------
    function log(...args) {
        try {
            mxLog.show();
            mxLog.debug("[PlantTiler]", ...args);
        } catch (_) { }
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

    async function loadPlants() {
        const sql = `
        SELECT plant_id, plant_name, abbr, spacing_cm, veg_diameter_cm, yield_per_plant_kg
        FROM Plants
        WHERE abbr IS NOT NULL AND spacing_cm IS NOT NULL
        ORDER BY plant_name;
      `;
        const rows = await queryAll(sql);
        log("DB rows:", rows.length);
        return rows;
    }

    async function loadCities() {
        const sql = `
        SELECT city_name
        FROM Cities
        ORDER BY city_name;
      `;
        const rows = await queryAll(sql);
        return rows.map((r) => r.city_name);
    }

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


    function collapseToSummary(graph, groupCell, abbr, spacingXpx, spacingYpx) {
        const model = graph.getModel();
        model.beginUpdate();
        try {
            // Snapshot layout BEFORE removing children so expand can restore it. 
            const snap = captureLodLayoutSnapshot(graph, groupCell);
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
            const xRel = (g.width - size) / 2;
            const yRel = (g.height - size) / 2;

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
    function captureLodLayoutSnapshot(graph, groupCell) {
        if (!groupCell || !isTilerGroup(groupCell)) return null;

        const kids = graph.getChildVertices(groupCell) || [];
        const tiles = [];
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

            const g = k.getGeometry && k.getGeometry();
            if (!g) continue;

            tiles.push({
                r, c,
                x: g.x, y: g.y, w: g.width, h: g.height,
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


    function shouldExpandLOD(graph, groupCell, spacingXpx, spacingYpx) {
        const { count } = computeGridStatsXY(groupCell, spacingXpx, spacingYpx);
        return count <= LOD_TILE_THRESHOLD;
    }

    function expandTiles(graph, groupCell, abbr, spacingXpx, spacingYpx, iconDiamPx) {

        const { bandPx } = groupLabelMetrics(groupCell);
        const fontPx = tileFontPx(iconDiamPx);

        const model = graph.getModel();
        model.beginUpdate();
        try {
            clearChildren(graph, groupCell);

            const { rows, cols, count } = computeGridStatsXY(groupCell, spacingXpx, spacingYpx);

            const disabledSet = readDisabledSet(groupCell);
            pruneDisabledToGrid(model, groupCell, rows, cols);
            const disabledSet2 = readDisabledSet(groupCell);
            const { actual } = applyCounts(model, groupCell, count, disabledSet2);
            updateGroupYield(model, groupCell, { abbr, countOverride: actual });

            if (count > MAX_TILES) {
                collapseToSummary(graph, groupCell, abbr, spacingXpx, spacingYpx);
                return;
            }

            // --- NEW: restore dirty/manual tiles from snapshot by slot (r,c) ---
            const snapObj = readLodLayoutSnapshot(groupCell);
            const snapMap = snapshotTileMap(snapObj);

            const x0Rel = GROUP_PADDING_PX + spacingXpx / 2;
            const y0Rel = GROUP_PADDING_PX + (bandPx || groupLabelMetrics(groupCell).bandPx) + spacingYpx / 2;

            const cells = [];
            for (let r = 0; r < rows; r++) {
                const cyRel = y0Rel + r * spacingYpx;

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
                            geo = new mxGeometry(sx, sy, w, h);
                            autoAttr = String(snap.auto || "0");
                            dirtyAttr = String(snap.dirty || "1");
                        }
                    }

                    // Default grid placement for non-snap tiles 
                    if (!geo) {
                        const cxRel = x0Rel + c * spacingXpx;
                        geo = new mxGeometry(
                            cxRel - iconDiamPx / 2,
                            cyRel - iconDiamPx / 2,
                            iconDiamPx,
                            iconDiamPx
                        );
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


    function hasGardenSettingsSet(moduleCell) {
        if (!(moduleCell && moduleCell.getAttribute)) return false;
        const city = String(moduleCell.getAttribute("city_name") || "").trim();
        const units = String(moduleCell.getAttribute("unit_system") || "").trim();
        return !!(city && units);
    }


    // garden settings dialog (city + units)
    async function showGardenSettingsDialog(ui, graph, moduleCell) {
        const model = graph.getModel();
        const curCity = getXmlAttr(moduleCell, "city_name", "");
        const curUnits = getXmlAttr(moduleCell, "unit_system", "");

        let cities = [];
        try {
            cities = await loadCities();
        } catch (e) {
            mxUtils.alert("Error loading cities: " + e.message);
            return;
        }
        if (!cities.length) {
            mxUtils.alert("No cities found in database.");
            return;
        }

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
        }

        // City (mandatory)
        const citySel = document.createElement("select");
        citySel.style.flex = "1";

        const cityPlaceholder = document.createElement("option");
        cityPlaceholder.value = "";
        cityPlaceholder.textContent = "Select a city…";
        cityPlaceholder.disabled = true;
        cityPlaceholder.selected = !curCity;
        citySel.appendChild(cityPlaceholder);

        cities.forEach((name) => {
            const o = document.createElement("option");
            o.value = name;
            o.textContent = name;
            if (name === curCity) o.selected = true;
            citySel.appendChild(o);
        });
        row("City:", citySel);

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

        function showError(msg) {
            err.textContent = msg;
            err.style.display = "block";
        }

        const btnRow = document.createElement("div");
        btnRow.style.display = "flex";
        btnRow.style.justifyContent = "flex-end";
        btnRow.style.gap = "8px";
        btnRow.style.marginTop = "12px";

        const cancelBtn = mxUtils.button("Cancel", () => ui.hideDialog());
        const okBtn = mxUtils.button("OK", () => {
            err.style.display = "none";
            const chosenCity = (citySel.value || "").trim();
            const chosenUnits = (unitsSel.value || "").trim();

            if (!chosenCity) { showError("City is required."); citySel.focus(); return; }
            if (!chosenUnits) { showError("Units are required."); unitsSel.focus(); return; }

            ui.hideDialog();
            model.beginUpdate();
            try {
                setCellAttrsNoTxn(model, moduleCell, {
                    city_name: chosenCity,
                    unit_system: chosenUnits,
                });
            } finally {
                model.endUpdate();
            }
            graph.refresh(moduleCell);

        });

        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(okBtn);
        div.appendChild(btnRow);

        ui.showDialog(div, 420, 220, true, true);
        citySel.focus();
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
                showGardenSettingsDialog(ui, graph, moduleCell);
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
            !!(cell.getAttribute && cell.getAttribute("garden_module") === "1")
        );
    }

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
        return !!cell && cell.getAttribute && cell.getAttribute("garden_bed") === "1";
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
        const model = graph.getModel();
        const moduleCell = findGardenModuleAncestor(graph, groupCell);
        if (!moduleCell) return null;

        const mg = moduleCell.getGeometry && moduleCell.getGeometry();
        const gg = groupCell.getGeometry && groupCell.getGeometry();
        const cg = plantCell.getGeometry && plantCell.getGeometry();
        if (!mg || !gg || !cg) return null;

        return {
            moduleCell,
            x: (mg.x + gg.x + cg.x + (cg.width / 2)),
            y: (mg.y + gg.y + cg.y + (cg.height / 2)),
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


    /**
     * Creates an empty tiler group inside the given garden module.
     * - No plant is preselected.
     * - Defaults spacing to 30 cm (both axes).
     * - Centers a 240x240 group within the module bounds.
     */
    function createEmptyTilerGroup(graph, moduleCell, clickX, clickY) {
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

        const groupVal = createXmlValue("TilerGroup", {
            label: "New Plant Group",
            tiler_group: "1",
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
        model.beginUpdate();
        try {
            graph.addCell(group, moduleCell);
            graph.setSelectionCell(group);

            retileGroup(graph, group);

            reorderModuleChildrenForLayering(model, moduleCell);
        } finally {
            model.endUpdate();
        }
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
                try {
                    mxLog.debug(
                        "[PlantTiler][spacing] invalid " + JSON.stringify({ x, y })
                    );
                } catch (_) { }
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

        ui.showDialog(div, 360, 170, true, true);
        inputX.focus();
    }

    function runSetGroupSpacingOn(graph, groupCell) {
        if (!groupCell || !isTilerGroup(groupCell)) {
            try {
                mxLog.debug("[PlantTiler][spacing] not a tiler group");
            } catch (_) { }
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

            try {
                mxLog.debug(
                    "[PlantTiler][spacing] applied " + JSON.stringify({ x, y })
                );
            } catch (_) { }
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
        try {
            mxLog.debug("[PlantTiler] Registering ordered popup contributor"); // CHANGE
        } catch (_) { }

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
                try {
                    mxLog.debug(
                        "[PlantTiler][hitTest] " +
                        JSON.stringify({
                            clientX: evt.clientX,
                            clientY: evt.clientY,
                            gx,
                            gy,
                            s,
                            tr: { x: tr.x, y: tr.y },
                        })
                    );
                } catch (_) { }
                return hit;
            } catch (e) {
                try {
                    mxLog.debug("[PlantTiler][hitTest] error " + e.message);
                } catch (_) { }
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
            try {
                mxLog.debug(
                    "[PlantTiler][popup] cells " +
                    JSON.stringify({
                        byParam: dbgCellInfo(byParam),
                        byHit: dbgCellInfo(byHit),
                        bySel: dbgCellInfo(bySel),
                        target: dbgCellInfo(t),
                    })
                );
            } catch (_) { }
            return t;
        }

        function resolveModuleTarget(cell, evt) {
            const byParam = cell || null;
            const byHit = evt ? hitTestCell(evt) : null;
            const bySel = graph.getSelectionCell() || null;
            const cand = byParam || byHit || bySel;
            const t = cand ? findModuleAncestor(graph, cand) : null;
            try {
                mxLog.debug(
                    "[PlantTiler][popup][module] cand=" +
                    JSON.stringify(dbgCellInfo(cand)) +
                    " -> target=" +
                    JSON.stringify(dbgCellInfo(t))
                );
            } catch (_) { }
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
            id: "gardenLayout", // NEW
            priority: 300, // NEW
            addItems: function (menu, cell, evt) { // CHANGE
            try {
                mxLog.debug(
                    "[PlantTiler][popup] start " +
                    JSON.stringify({ orderedContributor: true }) // CHANGE
                );
            } catch (_) { }

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
                try {
                    mxLog.debug(
                        "[PlantTiler][popup] adding spacing item " +
                        JSON.stringify({ curX, curY })
                    );
                } catch (_) { }
                menu.addItem(label, null, function () {
                    try {
                        const act = ui.actions.get("setGroupSpacing");
                        if (act && typeof act.funct === "function") {
                            try {
                                mxLog.debug("[PlantTiler][popup] invoking action setGroupSpacing");
                            } catch (_) { }
                            act.funct();
                        } else {
                            try {
                                mxLog.debug(
                                    "[PlantTiler][popup] action missing; using direct invoker"
                                );
                            } catch (_) { }
                            runSetGroupSpacingOn(graph, target);
                        }
                    } catch (e) {
                        try {
                            mxLog.debug("[PlantTiler][popup] action error " + e.message);
                        } catch (_) { }
                    }
                });
            } else {
                try {
                    mxLog.debug("[PlantTiler][popup] no tiler group under cursor");
                } catch (_) { }
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
                        try { mxLog.debug(`[PlantTiler][trim] groups=${trimmedGroups}/${candidates.length} removed=${totalRemoved}`); } catch (_) { }
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
                    await showGardenSettingsDialog(ui, graph, targetMod);
                });
            }

            // --- Add New Plant Group (requires garden settings) ----------------------------------
            if (targetMod && isGardenModule(targetMod)) {
                if (hasGardenSettingsSet(targetMod)) {
                    menu.addItem("Add New Plant Group", null, function () {
                        try {
                            const pt = graph.getPointForEvent(evt);
                            createEmptyTilerGroup(graph, targetMod, pt.x, pt.y);
                            mxLog.debug("[PlantTiler][module] empty tiler group created");
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

        try {
            mxLog.debug(
                "[PlantTiler] Popup contributor registered " + // CHANGE
                JSON.stringify({
                    hasPopup: !!graph.popupMenuHandler,
                    hasAction: !!ui.actions.get("setGroupSpacing"),
                })
            );
        } catch (_) { }
    } else {
        try {
            mxLog.debug("[PlantTiler] popupMenuHandler not available");
        } catch (_) { }
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

        graph.addCell(group, parent);

        // Move circles into group; convert to GROUP-RELATIVE coordinates                                  
        for (const c of circleCells) {
            const cg = c.getGeometry();
            if (!cg) continue;

            const local = cg.clone();
            local.x = cg.x - groupX;
            local.y = (cg.y - groupY) + bandPx;

            c.setGeometry(local);
            graph.addCell(c, group);
        }

        // Retile group after it has children (will honor LOD, count, etc.)                                 
        retileGroup(graph, group);

        if (parent && isGardenModule(parent)) {
            reorderModuleChildrenForLayering(model, parent);
        }

        graph.setSelectionCell(group);
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
        const cg = childCell.getGeometry && childCell.getGeometry();
        if (!gg || !cg) return false;
        // Child geos are RELATIVE to group; compare to [0..w]x[0..h]                      
        const eps = 0.01;
        if (cg.x < -eps) return true;
        if (cg.y < -eps) return true;
        if (cg.x + cg.width > gg.width + eps) return true;
        if (cg.y + cg.height > gg.height + eps) return true;
        return false;
    }

    // expand/collapse helpers
    function expandGroupDetail(graph, groupCell) {
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
            collapseToSummary(graph, groupCell, abbr, sx, sy);
            return;
        }
        expandTiles(graph, groupCell, abbr, sx, sy, iconDiam);
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

    let SCROLL_TIMER = null;
    ui.editor.graph.container.addEventListener(
        "scroll",
        () => {
            if (SCROLL_TIMER) clearTimeout(SCROLL_TIMER);
            SCROLL_TIMER = setTimeout(() => retileVisibleExpandedGroups(graph), 100);
        },
        { passive: true }
    );

    let PAN_TIMER = null;
    graph.addListener(mxEvent.PAN, function () {
        if (PAN_TIMER) clearTimeout(PAN_TIMER);
        PAN_TIMER = setTimeout(() => retileVisibleExpandedGroups(graph), 100);
    });

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

        const model = graph.getModel();
        model.beginUpdate();
        try {
            syncGroupTitle(model, groupCell);
        } finally {
            model.endUpdate();
        }
        const abbr = groupCell.getAttribute("plant_abbr") || "?";
        const spacingXcm = Number(groupCell.getAttribute("spacing_x_cm") ||
            groupCell.getAttribute("spacing_cm") || "30");
        const spacingYcm = Number(groupCell.getAttribute("spacing_y_cm") ||
            groupCell.getAttribute("spacing_cm") || "30");
        const spacingXpx = toPx(spacingXcm);
        const spacingYpx = toPx(spacingYcm);

        const duringResize = !!opts.duringResize;
        if (duringResize) {
            const { count } = computeGridStatsXY(groupCell, spacingXpx, spacingYpx);

            const { rows, cols } = computeGridStatsXY(groupCell, spacingXpx, spacingYpx);
            const pruned = pruneDisabledToGrid(model, groupCell, rows, cols);
            const disabledSet = pruned.set || readDisabledSet(groupCell);
            const { actual } = applyCounts(model, groupCell, count, disabledSet);
            updateGroupYield(model, groupCell, { abbr, countOverride: actual });

            if (count > MAX_TILES || count > LOD_TILE_THRESHOLD) {
                collapseToSummary(graph, groupCell, abbr, spacingXpx, spacingYpx);
            }
            return;
        }

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
            collapseToSummary(graph, groupCell, abbr, spacingXpx, spacingYpx);
            return;
        }
        if (forceExpand) {
            expandGroupDetail(graph, groupCell);
            return;
        }

        if (autoCollapse && !collapsed) {
            collapseToSummary(graph, groupCell, abbr, spacingXpx, spacingYpx);
            return;
        }
        if (autoExpand && collapsed) {
            expandGroupDetail(graph, groupCell);
            return;
        }

        // Default path: keep current state; only refresh contents/summary        
        if (!collapsed) {
            expandTiles(graph, groupCell, abbr, spacingXpx, spacingYpx, iconDiam);
        } else {
            collapseToSummary(graph, groupCell, abbr, spacingXpx, spacingYpx);
        }
    }

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

    function minGroupSizePx(spacingXpx, spacingYpx, bandPx) {
        const b = Number.isFinite(Number(bandPx)) ? Number(bandPx) : GROUP_LABEL_BAND_PX;
        const minW = (GROUP_PADDING_PX * 2) + spacingXpx;
        const minH = (GROUP_PADDING_PX * 2) + b + spacingYpx;
        return { minW, minH };
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

    function ensureLineSlotsPresent(graph, groupCell, abbr, rows, cols, spacingXpx, spacingYpx, iconDiamPx) {
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
        model.beginUpdate();
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
            model.endUpdate();
        }

        return added;
    }



    function addTileAtSlot(graph, groupCell, abbr, r, c, spacingXpx, spacingYpx, iconDiamPx, disabledSet, bandPx, fontPx) {
        if (disabledSet && disabledSet.has(`${r},${c}`)) return null;

        const x0Rel = GROUP_PADDING_PX + spacingXpx / 2;
        const y0Rel = GROUP_PADDING_PX + (bandPx || GROUP_LABEL_BAND_PX) + spacingYpx / 2;

        const cxRel = x0Rel + c * spacingXpx;
        const cyRel = y0Rel + r * spacingYpx;

        const geo = new mxGeometry(
            cxRel - iconDiamPx / 2,
            cyRel - iconDiamPx / 2,
            iconDiamPx,
            iconDiamPx
        );

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

    function applyResizeDelta(graph, groupCell, prev, next, spacingXpx, spacingYpx, iconDiamPx) {
        const model = graph.getModel();
        const abbr = groupCell.getAttribute("plant_abbr") || "?";

        const disabledSet = readDisabledSet(groupCell);

        // If LOD collapsed, don’t maintain tiles. Keep your existing collapse/summary behavior.
        if (isCollapsedLOD(groupCell)) return;

        const { bandPx } = groupLabelMetrics(groupCell);
        const fontPx = tileFontPx(iconDiamPx);

        const slotMap = buildSlotMap(graph, groupCell);

        model.beginUpdate();
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
            model.endUpdate();
        }
    }

    function shiftGroupChildrenByDeltaBand(graph, groupCell, deltaY) {                 // NEW
        if (!deltaY || !Number.isFinite(deltaY)) return;                               // NEW
        if (!groupCell || isCollapsedLOD(groupCell)) return;                           // NEW

        const model = graph.getModel();                                                // NEW
        const kids = graph.getChildVertices(groupCell) || [];                          // NEW

        model.beginUpdate();                                                           // NEW
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
            model.endUpdate();                                                         // NEW
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
    
            // Collect affected tiler groups and snapshot BEFORE resize
            const groups = new Map();
            for (const c of (cells || [])) {
                const g = isTilerGroup(c) ? c : findTilerGroupAncestor(graph, c);
                if (g && g.id) groups.set(g.id, g);
            }
    
            const hasTiler = groups.size > 0;
    
            const snapshots = new Map(); // groupId -> { prev, spacingXpx, spacingYpx, iconDiamPx, bandPx }
            for (const g of groups.values()) {
                const sx = toPx(Number(g.getAttribute("spacing_x_cm") || g.getAttribute("spacing_cm") || "30"));
                const sy = toPx(Number(g.getAttribute("spacing_y_cm") || g.getAttribute("spacing_cm") || "30"));
    
                const vegDiamCm = Number(g.getAttribute("veg_diameter_cm") || 0);
                let iconDiam = vegDiamCm > 0
                    ? toPx(vegDiamCm)
                    : clamp(DEFAULT_ICON_DIAM_RATIO * Math.min(sx, sy), MIN_ICON_DIAM_PX, MAX_ICON_DIAM_PX);
                iconDiam = Math.max(iconDiam, 6);
    
                const { bandPx } = groupLabelMetrics(g);
    
                snapshots.set(g.id, {
                    prev: gridSnapshot(g, sx, sy),
                    spacingXpx: sx,
                    spacingYpx: sy,
                    iconDiamPx: iconDiam,
                    bandPx,
                });
            }
    
            // Clamp tiler group bounds to minimum 1×1 capacity
            if (hasTiler) {
                bounds = clampTilerBounds(cells, bounds, snapshots);
            }
    
            const duringResize = !!graph.isMouseDown;
    
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
                        shiftGroupChildrenByDeltaBand(graph, g, deltaBandY);
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
                        collapseToSummary(graph, g, abbr, snap.spacingXpx, snap.spacingYpx);
                        groupsNeedingRefresh.push(g);
                        continue;
                    }
    
                    // If currently collapsed but now under thresholds, expand
                    if (isCollapsedLOD(g)) {
                        expandTiles(graph, g, abbr, snap.spacingXpx, snap.spacingYpx, snap.iconDiamPx);
                        groupsNeedingRefresh.push(g);
                        continue;
                    }
    
                    // Delta slot maintenance (add/remove)
                    applyResizeDelta(graph, g, snap.prev, next, snap.spacingXpx, snap.spacingYpx, snap.iconDiamPx);
    
                    ensureLineSlotsPresent(
                        graph,
                        g,
                        abbr,
                        next.rows,
                        next.cols,
                        snap.spacingXpx,
                        snap.spacingYpx,
                        snap.iconDiamPx
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
        retileGroup
    });

    // -------------------- Boot --------------------
    (async function init() {
        try {

        } catch (e) {
            log("Init error:", e.message);
        }
    })();
});
