/**
 * Draw.io Plugin: Garden Dashboard (Garden-Module Viewport Toolbar)
 *
 * Features:
 * - Floating garden-relative toolbar appears when a garden module or descendant is selected
 * - Dashboard table is an expandable viewport overlay section, collapsed by default
 * - Prev/Next year buttons + current year label are stored on the garden module
 * - Metrics are computed from tiler groups under that module
 * - Only includes crops that begin in selected year (season_start_year == selected year)
 * Existing garden_dashboard cells are left in files as inert legacy remnants.
 */
Draw.loadPlugin(function (ui) {
    const graph = ui.editor && ui.editor.graph;
    if (!graph) return;

    const model = graph.getModel();

    // Prevent double install
    if (graph.__gardenDashboardInstalled) return;
    graph.__gardenDashboardInstalled = true;

    // -------------------- Config --------------------
    const PX_PER_CM = 5;
    const DRAW_SCALE = 0.18;
    const GRAPH_OVERLAY_Z = Object.freeze({ ANNOTATION: 10000, CONNECTION: 10010, CONTROL: 10020, CONTROL_TOP: 10030 });
    const GRAPH_OVERLAY_LAYER_CLASS = Object.freeze({ control: "trellis-graph-control-layer trellis-body-control-layer" });
    const TRELLIS_DIALOG_Z = 2000000000;

    const DASH_ATTR = "garden_dashboard";
    const DASH_YEAR_ATTR = "dashboard_year";
    const MODULE_CURRENT_YEAR_ATTR = "current_year";
    const YEAR_HIDDEN_ATTR = "year_hidden";
    const PLAN_YEAR_JSON_ATTR = "plan_year_json";

    const BTN_SIZE = 22;
    const BTN_GAP = 6;
    const CTRL_PAD = 6;
    const DASH_MIN_W = 320;
    const DASH_DEFAULT_ASPECT = 320 / 220;
    const GARDEN_MIN_CONTENT_W = 440;
    const GARDEN_MIN_CONTENT_H = 340;

    const DASH_STYLE =
        "rounded=0;whiteSpace=wrap;html=1;" +
        "align=left;verticalAlign=top;" +
        "labelPosition=left;verticalLabelPosition=top;" +
        "spacing=0;spacingTop=0;spacingLeft=0;spacingRight=0;spacingBottom=0;" +
        "strokeColor=#666666;fillColor=#f7f7f7;fontSize=12;";

    const PLAN_YEAR_EVENT = "usl:planYearRequested";
    const ALLOCATE_PLAN_EVENT = "usl:allocatePlanRequested";
    const IRRIGATION_MODE_CHANGED_EVENT = "trellisIrrigationModeChanged";
    const IRRIGATION_ACTIVE_BLUE = "#2563eb";

    const GROUP_LABEL_FONT_PX = 12;
    const GROUP_LABEL_LINE_HEIGHT = 1.25;
    const GROUP_LABEL_BAND_PAD_PX = 6;
    const GROUP_LABEL_BAND_PX = Math.ceil(
        GROUP_LABEL_FONT_PX * GROUP_LABEL_LINE_HEIGHT + GROUP_LABEL_BAND_PAD_PX
    );

    // -------------------- Helpers --------------------
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

    function isTaskModule(cell) {
        return !!(cell && cell.getAttribute && cell.getAttribute("task_module") === "1");
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

    function findGardenModuleAncestor(graph, cell) {
        const m = graph.getModel();
        let cur = cell;
        while (cur) {
            if (isGardenModule(cur)) return cur;
            cur = m.getParent(cur);
        }
        return null;
    }

    function findTaskModuleAncestor(graph, cell) {
        const m = graph.getModel();
        let cur = cell;
        while (cur) {
            if (isTaskModule(cur)) return cur;
            cur = m.getParent(cur);
        }
        return null;
    }

    function gardenForTaskModule(taskModule) {
        const gardenId = taskModule && taskModule.getAttribute ? taskModule.getAttribute("trellis_garden_module_id") : "";
        const garden = gardenId && model.getCell ? model.getCell(gardenId) : null;
        return isGardenModule(garden) ? garden : null;
    }

    function findDashboardAncestor(cell) {
        let cur = cell;
        while (cur) {
            if (cur.getAttribute && cur.getAttribute(DASH_ATTR) === "1") return cur;
            cur = model.getParent(cur);
        }
        return null;
    }

    function isTilerGroup(cell) {
        const ok = !!cell && cell.getAttribute && cell.getAttribute("tiler_group") === "1";
        return ok;
    }

    function hasCitySet(moduleCell) {
        return !!(moduleCell && moduleCell.getAttribute && (moduleCell.getAttribute("city_id") || moduleCell.getAttribute("city_name")));
    }

    // -------------------- Germ Rate helpers ------------

    function safeJsonParse(s, defVal) {
        try { return JSON.parse(String(s || "")); } catch (e) { return defVal; }
    }

    function getPlanYearObject(moduleCell, year) {
        const raw = getCellAttr(moduleCell, PLAN_YEAR_JSON_ATTR, "");
        if (!raw) return null;
        const root = safeJsonParse(raw, null);
        if (!root || typeof root !== "object") return null;

        // supports {"2026":{...}} shape (your example)
        const yKey = String(year);
        const obj = root[yKey];
        return (obj && typeof obj === "object") ? obj : null;
    }

    function normKeyPart(s) {
        return String(s || "").trim().toLowerCase();
    }

    function cropKeyFromParts(plant, variety) {
        const p = String(plant || "").trim();
        const v = String(variety || "").trim();
        if (p && v) return `${p} — ${v}`;
        return p || v || "(Unnamed crop)";
    }

    function buildPlanIndex(planYearObj) {
        // Returns:
        // {
        //   byVarietyId: Map<number, crop>,
        //   byNameKey: Map<string, crop[]>,   : array to handle dupes
        //   crops: array
        // }
        const out = {
            byVarietyId: new Map(),
            byNameKey: new Map(),
            crops: []
        };

        const crops = (planYearObj && Array.isArray(planYearObj.crops)) ? planYearObj.crops : [];
        out.crops = crops;

        for (const c of crops) {
            const vid = Number(c && c.varietyId);
            if (Number.isFinite(vid)) out.byVarietyId.set(vid, c);

            const nameKey = normKeyPart(cropKeyFromParts(c && c.plant, c && c.variety));
            const arr = out.byNameKey.get(nameKey) || [];
            arr.push(c);
            out.byNameKey.set(nameKey, arr);
        }
        return out;
    }

    function findPlanCropForTiler(planIndex, tg) {
        if (!planIndex) return null;

        // Prefer stable IDs if present on tiler groups
        const tgVarietyId = Number(getCellAttr(tg, "variety_id", ""));
        if (Number.isFinite(tgVarietyId) && planIndex.byVarietyId.has(tgVarietyId)) {
            return planIndex.byVarietyId.get(tgVarietyId);
        }

        // Fallback: match by "Plant — Variety" label
        const tgKey = normKeyPart(getCropKey(tg));
        const hits = planIndex.byNameKey.get(tgKey);
        if (hits && hits.length) return hits[0];
        return null;
    }

    function germAdjustedSeeds(plants, germRate) {
        const p = Number(plants);
        const g = Number(germRate);
        if (!Number.isFinite(p) || p <= 0) return 0;
        if (!Number.isFinite(g) || g <= 0 || g > 1.5) return Math.ceil(p); // guard
        return Math.ceil(p / g);
    }


    // -------------------- Helpers --------------------
    function toInt(v, def = 0) {
        const n = Number(v);
        return Number.isFinite(n) ? Math.trunc(n) : def;
    }

    function toNum(v, def = 0) {
        const n = Number(v);
        return Number.isFinite(n) ? n : def;
    }

    function getCellAttr(cell, key, def = "") {
        if (!cell || !cell.getAttribute) return def;
        const v = cell.getAttribute(key);
        return (v === null || v === undefined) ? def : v;
    }

    function setCellAttr(cell, key, val) {
        if (graph.setAttributeForCell) {
            if (val == null) graph.setAttributeForCell(cell, key, null);
            else graph.setAttributeForCell(cell, key, String(val));
        } else if (cell.value && typeof cell.value.setAttribute === "function") {
            if (val == null) cell.value.removeAttribute(key);
            else cell.value.setAttribute(key, String(val));
        }
    }

    function setYearHidden(cell, hidden) {
        if (!cell) return;
        if (hidden) setCellAttr(cell, YEAR_HIDDEN_ATTR, "1");
        else setCellAttr(cell, YEAR_HIDDEN_ATTR, null);
    }


    function getDescendants(root) {
        const out = [];
        if (!root) return out;

        const stack = [root];
        while (stack.length) {
            const cur = stack.pop();
            const childCount = model.getChildCount(cur);
            for (let i = 0; i < childCount; i++) {
                const ch = model.getChildAt(cur, i);
                out.push(ch);
                stack.push(ch);
            }
        }
        return out;
    }

    function findDashboardCell(moduleCell) {
        if (!moduleCell) return null;
        const kids = getDescendants(moduleCell);
        for (const c of kids) {
            if (c && c.getAttribute && c.getAttribute(DASH_ATTR) === "1") {
                return c;
            }
        }
        return null;
    }

    function isDashboardCell(cell) {
        return !!cell && cell.getAttribute && cell.getAttribute(DASH_ATTR) === "1";
    }

    function getModuleHeaderHeight(moduleCell) {
        if (!moduleCell) return 0;
        if (graph.getStartSize) {
            const size = graph.getStartSize(moduleCell) || {};
            return Number(size.height) || 0;
        }
        const style = getStyleSafe(moduleCell);
        const m = style.match(/(?:^|;)startSize=(\d+)(?=;|$)/);
        return m ? parseInt(m[1], 10) : 0;
    }

    function ensureGardenModuleMinimum(moduleCell) {
        if (!isGardenModule(moduleCell)) return;
        const api = graph && graph.__trellisModules;
        if (api && typeof api.enforceGardenModuleMinimum === "function") {
            api.enforceGardenModuleMinimum(moduleCell);
            return;
        }
        try {
            graph.fireEvent(new mxEventObject("usl:requestApplyModuleMargins", "cell", moduleCell));
        } catch (_) { }
    }

    function getGardenModuleContentSize(moduleCell) {
        const g = moduleCell && model.getGeometry(moduleCell);
        if (!g) return { width: GARDEN_MIN_CONTENT_W, height: GARDEN_MIN_CONTENT_H };
        return {
            width: Math.max(GARDEN_MIN_CONTENT_W, Number(g.width) || 0),
            height: Math.max(GARDEN_MIN_CONTENT_H, (Number(g.height) || 0) - getModuleHeaderHeight(moduleCell))
        };
    }

    function growGardenModuleToContain(moduleCell, x, y, width, height) {
        if (!isGardenModule(moduleCell)) return false;
        const g = model.getGeometry(moduleCell);
        if (!g) return false;
        const headerH = getModuleHeaderHeight(moduleCell);
        const neededW = Math.max(GARDEN_MIN_CONTENT_W, (Number(x) || 0) + (Number(width) || 0));
        const neededH = Math.max(GARDEN_MIN_CONTENT_H, (Number(y) || 0) + (Number(height) || 0)) + headerH;
        const nextW = Math.max(Number(g.width) || 0, neededW);
        const nextH = Math.max(Number(g.height) || 0, neededH);
        if (Math.abs(nextW - g.width) < 0.5 && Math.abs(nextH - g.height) < 0.5) return false;
        const g2 = g.clone();
        g2.width = nextW;
        g2.height = nextH;
        model.setGeometry(moduleCell, g2);
        return true;
    }

    function getDashboardMeasuredAspect(dashCell) {
        const entry = dashCell && overlayByDashId.get(dashCell.getId());
        const size = measureDashboardUiNaturalSize(entry);
        return size.width > 0 && size.height > 0 ? size.width / size.height : DASH_DEFAULT_ASPECT;
    }

    function clampDashboardGeometry(dashCell, opts) {
        const o = opts || {};
        if (!isDashboardCell(dashCell) || graph.__gardenDashboardClamping) return false;
        const g = model.getGeometry(dashCell);
        if (!g) return false;
        const moduleCell = findGardenModuleAncestor(graph, dashCell);
        if (moduleCell && o.allowModuleGrow !== false) ensureGardenModuleMinimum(moduleCell);

        const ratio = Math.max(0.01, Number(o.aspectRatio) || getDashboardMeasuredAspect(dashCell));
        let width = Math.max(DASH_MIN_W, Number(g.width) || DASH_MIN_W);
        let height = Math.max(1, Number(g.height) || (DASH_MIN_W / ratio));

        if (o.preserveWidth) {
            width = Math.max(DASH_MIN_W, width);
            height = Math.max(1, width / ratio);
        } else if (o.preserveSize) {
            width = Math.max(DASH_MIN_W, width);
            height = Math.max(1, height);
        } else if (o.preserveArea) {
            const area = Math.max(DASH_MIN_W, width * height);
            width = Math.max(DASH_MIN_W, Math.sqrt(area * ratio));
            height = Math.max(1, width / ratio);
        } else if (width / height > ratio) {
            width = Math.max(DASH_MIN_W, height * ratio);
        } else {
            height = Math.max(1, width / ratio);
        }

        if (moduleCell) {
            const content = getGardenModuleContentSize(moduleCell);
            if (width > content.width || height > content.height) growGardenModuleToContain(moduleCell, Number(g.x) || 0, Number(g.y) || 0, width, height);
            const updatedContent = getGardenModuleContentSize(moduleCell);
            width = Math.min(width, Math.max(DASH_MIN_W, updatedContent.width));
            height = Math.min(height, Math.max(1, updatedContent.height));
        }

        const next = g.clone();
        next.width = width;
        next.height = height;
        if (moduleCell) {
            const content = getGardenModuleContentSize(moduleCell);
            next.x = Math.max(0, Math.min(Number(next.x) || 0, Math.max(0, content.width - next.width)));
            next.y = Math.max(0, Math.min(Number(next.y) || 0, Math.max(0, content.height - next.height)));
        }

        if (Math.abs(next.x - g.x) < 0.5 && Math.abs(next.y - g.y) < 0.5 && Math.abs(next.width - g.width) < 0.5 && Math.abs(next.height - g.height) < 0.5) return false;
        graph.__gardenDashboardClamping = true;
        try {
            model.setGeometry(dashCell, next);
        } finally {
            graph.__gardenDashboardClamping = false;
        }
        return true;
    }

    function isValidYear(n) {
        return Number.isFinite(n) && n > 1900 && n < 3000;
    }

    function getAttrYear(cell, key) {
        const y = toInt(getCellAttr(cell, key, ""), NaN);
        return isValidYear(y) ? y : NaN;
    }

    function getModuleCurrentYear(moduleCell) {
        return getAttrYear(moduleCell, MODULE_CURRENT_YEAR_ATTR);
    }

    function setModuleCurrentYear(moduleCell, year) {
        const y = toInt(year, NaN);
        if (!moduleCell || !isGardenModule(moduleCell) || !isValidYear(y)) return;
        setCellAttr(moduleCell, MODULE_CURRENT_YEAR_ATTR, String(y));
    }

    function getDashboardYear(dashCell) {
        const dashYear = getAttrYear(dashCell, DASH_YEAR_ATTR);
        if (isValidYear(dashYear)) return dashYear;

        const moduleCell = findGardenModuleAncestor(graph, dashCell);
        const moduleYear = getModuleCurrentYear(moduleCell);
        if (isValidYear(moduleYear)) return moduleYear;

        return new Date().getFullYear();
    }

    function setDashboardYear(dashCell, year, moduleCell) {
        const y = toInt(year, NaN);
        if (!isValidYear(y)) return;

        setCellAttr(dashCell, DASH_YEAR_ATTR, String(y));

        const mod = moduleCell || findGardenModuleAncestor(graph, dashCell);
        if (mod) setModuleCurrentYear(mod, y);
    }

    function notifyYearFilterChanged(moduleCell, selectedYear) {
        try {
            window.dispatchEvent(new CustomEvent("yearFilterChanged", {
                detail: { moduleCellId: moduleCell ? moduleCell.getId() : null, year: selectedYear }
            }));
        } catch (e) { }
    }


    function unitsToAreaM2(wUnits, hUnits) {
        const k = (PX_PER_CM * DRAW_SCALE * 100);
        const wM = Number(wUnits) / k;
        const hM = Number(hUnits) / k;
        if (!Number.isFinite(wM) || !Number.isFinite(hM)) return 0;
        return wM * hM;
    }


    function getCropKey(tg) {
        const plant = getCellAttr(tg, "plant_name", "").trim();
        const variety = getCellAttr(tg, "variety_name", "").trim();
        if (plant && variety) return `${plant} — ${variety}`;
        return plant || variety || "(Unnamed crop)";
    }

    function computeModuleMetrics(moduleCell, selectedYear) {
        const all = getDescendants(moduleCell);
        const tilers = all.filter(isTilerGroup);
        const tilersInYear = tilers.filter((tg) => shouldRenderTilerGroup(tg, selectedYear));

        const planObj = getPlanYearObject(moduleCell, selectedYear);
        const planIndex = planObj ? buildPlanIndex(planObj) : null;

        const byCrop = new Map();

        // Totals
        let totalAreaM2 = 0;
        let totalActualPlants = 0;
        let totalActualSeedsAdj = 0;
        let totalPlanPlants = 0;
        let totalPlanSeedsAdj = 0;
        let totalTargetKg = 0;
        let totalExpectedKg = 0;

        // --- Seed rows from plan first (prevents double-counting and shows plan-only crops) --- 
        if (planIndex && Array.isArray(planIndex.crops)) {
            for (const pc of planIndex.crops) {
                const crop = cropKeyFromParts(pc && pc.plant, pc && pc.variety);
                const planGermRate = Number(pc && pc.germRate);


                const planPlants = Number(pc && pc.plantsReq);
                const safePlanPlants = Number.isFinite(planPlants) ? planPlants : 0;

                const gr = (Number.isFinite(planGermRate) ? planGermRate : NaN);

                const row = byCrop.get(crop) || {
                    crop,
                    area_m2: 0,
                    actual_plants: 0,
                    actual_seeds_adj: 0,
                    plan_plants: 0,
                    plan_seeds_adj: 0,
                    germ_rate: NaN,
                    target_kg: 0,
                    expected_kg: 0,
                    count: 0,
                    _planBound: false,
                    _planCropId: null
                };

                row.plan_plants += safePlanPlants; // actually store plantsReq as plan plants

                // Always accumulate plan totals for this crop (handles multiple plan entries per crop).      
                const seedsReq = Number(pc && pc.seedsReq);
                const safeSeedsReq = Number.isFinite(seedsReq) ? seedsReq : NaN;
                const planSeeds = Number.isFinite(safeSeedsReq)
                    ? safeSeedsReq
                    : germAdjustedSeeds(safePlanPlants, gr);
                row.plan_seeds_adj += planSeeds;

                // a germ rate if we have one; don’t overwrite a valid one with NaN.                      
                if (!Number.isFinite(row.germ_rate) && Number.isFinite(gr)) row.germ_rate = gr;

                row._planBound = true;
                row._planCropId = (pc && pc.id) ? String(pc.id) : row._planCropId;

                byCrop.set(crop, row);
            }
        }

        // --- Accumulate actuals from tiler groups --- 
        for (const tg of tilersInYear) {
            const geo = model.getGeometry(tg);
            let areaM2 = 0;
            if (geo) {
                const wUnits = geo.width;
                const hUnits = Math.max(0, geo.height - GROUP_LABEL_BAND_PX);
                areaM2 = unitsToAreaM2(wUnits, hUnits);
            }

            const actualPlants = toNum(getCellAttr(tg, "plant_count", 0), 0);
            const expectedKg = toNum(getCellAttr(tg, "plant_yield", 0), 0);

            const targetDirect = toNum(getCellAttr(tg, "planting_target_yield_kg", NaN), NaN);
            const targetLegacy = toNum(getCellAttr(tg, "target_yield", NaN), NaN);
            const targetKg = Number.isFinite(targetDirect) ? targetDirect : (Number.isFinite(targetLegacy) ? targetLegacy : 0);

            const crop = getCropKey(tg);

            const planCrop = findPlanCropForTiler(planIndex, tg);
            const planGermRate = planCrop && Number.isFinite(Number(planCrop.germRate)) ? Number(planCrop.germRate) : NaN;
            const actualSeedsAdj = germAdjustedSeeds(actualPlants, planGermRate);

            // Ensure row exists (could be plan-seeded or tiler-only)
            const cur = byCrop.get(crop) || {
                crop,
                area_m2: 0,

                actual_plants: 0,
                actual_seeds_adj: 0,

                plan_plants: 0,
                plan_seeds_adj: 0,
                germ_rate: NaN,

                target_kg: 0,
                expected_kg: 0,
                count: 0,

                _planBound: false,
                _planCropId: null
            };

            cur.area_m2 += areaM2;

            cur.actual_plants += actualPlants;
            cur.actual_seeds_adj += actualSeedsAdj;

            // If this tiler row wasn’t plan-seeded but we found a plan crop, bind plan ONCE here. 
            if (planCrop && !cur._planBound) {
                const planPlants = Number.isFinite(Number(planCrop.plantsReq)) ? Number(planCrop.plantsReq) : 0;
                const seedsReq = Number.isFinite(Number(planCrop.seedsReq)) ? Number(planCrop.seedsReq) : NaN;
                const planSeedsAdj = Number.isFinite(seedsReq) ? seedsReq : germAdjustedSeeds(planPlants, planGermRate);
                cur.plan_plants += planPlants;
                cur.plan_seeds_adj += planSeedsAdj;
                cur.germ_rate = Number.isFinite(planGermRate) ? planGermRate : cur.germ_rate;
                cur._planBound = true;
                cur._planCropId = (planCrop && planCrop.id) ? String(planCrop.id) : cur._planCropId;
            }

            cur.target_kg += targetKg;
            cur.expected_kg += expectedKg;
            cur.count += 1;

            byCrop.set(crop, cur);

            // Totals (actual/area/expected/target can be summed per tiler safely)
            totalAreaM2 += areaM2;
            totalActualPlants += actualPlants;
            totalActualSeedsAdj += actualSeedsAdj;
            totalExpectedKg += expectedKg;
            totalTargetKg += targetKg;
        }

        // --- Compute plan totals from rows (each row has plan bound at most once) --- 
        for (const r of byCrop.values()) {
            totalPlanPlants += Number(r.plan_plants || 0);
            totalPlanSeedsAdj += Number(r.plan_seeds_adj || 0);
        }

        const rows = Array.from(byCrop.values())
            .map(r => {
                const { _planBound, _planCropId, ...clean } = r;
                return clean;
            })
            .sort((a, b) => a.crop.localeCompare(b.crop));

        const city = hasCitySet(moduleCell) ? getCellAttr(moduleCell, "city_name", "") : "";
        const moduleName = (moduleCell.value && moduleCell.value.getAttribute)
            ? (moduleCell.value.getAttribute("label") || moduleCell.getAttribute("label") || moduleCell.getId())
            : (moduleCell.getAttribute ? (moduleCell.getAttribute("label") || moduleCell.getId()) : moduleCell.getId());

        return {
            moduleName,
            city,
            tilerGroupsTotal: tilers.length,
            tilerGroupsInYear: tilersInYear.length,
            totalAreaM2,

            totalActualPlants,
            totalActualSeedsAdj,
            totalPlanPlants,
            totalPlanSeedsAdj,

            totalTargetKg,
            totalExpectedKg,
            irrigation: readIrrigationDashboardSummary(moduleCell),
            rows
        };
    }

    function readIrrigationDashboardSummary(moduleCell) {
        const raw = getCellAttr(moduleCell, "irrigation_dashboard_summary_json", "");
        if (!raw) return null;
        try { return JSON.parse(raw); } catch (_) { return null; }
    }


    // -------------------- year Filtering Helpers --------------------

    function isKanbanCard(cell) {
        return getCellAttr(cell, "kanban_card", "") === "1";
    }

    function isPerennialTilerGroup(tg) {
        // Prefer a single canonical attribute; fall back to reasonable alternates.    
        const lc = getCellAttr(tg, "life_cycle", "").trim().toLowerCase();
        if (lc === "perennial") return true;
        if (getCellAttr(tg, "is_perennial", "") === "1") return true;
        return false;
    }

    function shouldRenderTilerGroup(tg, selectedYear) {
        if (!isTilerGroup(tg)) return false;
        if (isPerennialTilerGroup(tg)) return true;

        const startY = toInt(getCellAttr(tg, "season_start_year", ""), NaN);
        if (Number.isFinite(startY) && startY === selectedYear) return true;

        const endY = harvestEndUtcYear(tg);
        if (Number.isFinite(endY) && endY === selectedYear) return true;

        return false;
    }

    function yearBounds(selectedYear) {
        // [start, endExclusive] in ms UTC.                                            
        const start = Date.UTC(selectedYear, 0, 1, 0, 0, 0, 0);
        const endEx = Date.UTC(selectedYear + 1, 0, 1, 0, 0, 0, 0);
        return { start, endEx };
    }

    function getFirstNonEmptyAttr(cell, keys) {
        for (const k of keys) {
            const v = getCellAttr(cell, k, "");
            if (String(v || "").trim()) return v;
        }
        return "";
    }

    function harvestEndUtcYear(tg) {
        const raw = getFirstNonEmptyAttr(tg, [
            "harvest_end",
            "harvest_end_date",
            "planting_harvest_end",
            "season_harvest_end",
            "end"
        ]);
        const ms = parseIsoDateToUtcMs(raw);
        if (!Number.isFinite(ms)) return NaN;
        return new Date(ms).getUTCFullYear();
    }

    function parseIsoDateToUtcMs(s) {
        // Expects "YYYY-MM-DD" or full ISO.                                           
        const str = String(s || "").trim();
        if (!str) return NaN;
        const d = new Date(str);
        const t = d.getTime();
        return Number.isFinite(t) ? t : NaN;
    }

    function taskOverlapsYear(taskStartMs, taskEndExMs, selectedYear) {
        if (!Number.isFinite(taskStartMs) || !Number.isFinite(taskEndExMs)) return false;
        const b = yearBounds(selectedYear);
        return taskStartMs < b.endEx && taskEndExMs > b.start;
    }

    function shouldRenderTaskCard(taskCell, selectedYear) {
        if (!isKanbanCard(taskCell)) return false;

        const sMs = parseIsoDateToUtcMs(getCellAttr(taskCell, "start", ""));
        const eMs = parseIsoDateToUtcMs(getCellAttr(taskCell, "end", ""));

        // Treat "end" as inclusive YYYY-MM-DD and convert to exclusive end.           
        const endExMs = Number.isFinite(eMs) ? (eMs + 24 * 60 * 60 * 1000) : NaN;

        return taskOverlapsYear(sMs, endExMs, selectedYear);
    }

    function setCellVisible(cell, isVisible) {
        if (!cell) return;
        const m = graph.getModel();
        if (typeof m.setVisible === "function") {
            m.setVisible(cell, !!isVisible);
            return;
        }

        // Fallback if setVisible is not available (rare)                              
        graph.toggleCells(!isVisible, [cell], true);
        graph.refresh(cell);
    }

    function applyYearVisibilityToModule(moduleCell, selectedYear) {
        selectedYear = toInt(selectedYear, new Date().getFullYear());
        if (!isValidYear(selectedYear)) selectedYear = new Date().getFullYear();
        setModuleCurrentYear(moduleCell, selectedYear);

        const all = getDescendants(moduleCell);
        const tilers = all.filter(isTilerGroup);
        const cards = all.filter(isKanbanCard);

        model.beginUpdate();
        try {
            // --- tiler groups: dashboard owns visibility ---------------------------- 
            for (const tg of tilers) {
                const show = shouldRenderTilerGroup(tg, selectedYear);
                setYearHidden(tg, !show);
                setCellVisible(tg, show);
            }

            // --- kanban cards: kanban owns visibility (paging) ---------------------- 
            for (const c of cards) {
                const show = shouldRenderTaskCard(c, selectedYear);
                setYearHidden(c, !show);
            }
        } finally {
            model.endUpdate();
        }

        graph.refresh(moduleCell);
        notifyYearFilterChanged(moduleCell, selectedYear);
    }


    // -------------------- Overlay HTML (not persisted) --------------------
    function formatOverlayTableHtml(metrics, year) {
        const fmt1 = (n) => (Number.isFinite(n) ? n.toFixed(1) : "0.0");
        const fmt0 = (n) => (Number.isFinite(n) ? Math.round(n).toString() : "0");
        const esc = (v) => mxUtils.htmlEntities(String(v ?? ""));
        const fmtPct = (n) => (Number.isFinite(n) ? (n * 100).toFixed(0) + "%" : "");
        const irrigation = metrics.irrigation || null;
        const fmtPctWhole = (n) => Number.isFinite(Number(n)) ? Math.round(Number(n)) + "%" : "0%";
        const fmtMoney = (n) => "$" + (Number.isFinite(Number(n)) ? Number(n).toFixed(Number(n) % 1 === 0 ? 0 : 2) : "0");
        const fmtMargin = (n) => Number.isFinite(Number(n)) ? Number(n).toFixed(1) + " psi" : "n/a";
        const irrigationRows = irrigation ? ` 
      <tr class="trellis-irrigation-dashboard-summary" title="Open Irrigation Planner" style="cursor:pointer;">
        <td style="border:1px solid #999; padding:4px; font-weight:700;">Irrigation</td>
        <td colspan="8" style="border:1px solid #999; padding:4px; pointer-events:auto;">
          ${esc(fmtPctWhole(irrigation.percentIrrigated))} irrigated | ${esc(fmtMoney(irrigation.purchaseNeededCost))} needed | ${esc(irrigation.zoneCount || 0)} zones | ${esc(fmtPctWhole(irrigation.completeness))} complete | ${esc(fmtMargin(irrigation.worstHydraulicMarginPsi))} worst margin | ${esc(irrigation.purchaseNeededCount || 0)} purchase parts | ${esc(irrigation.criticalWarningCount || 0)} critical warnings
        </td>
      </tr>` : `
      <tr class="trellis-irrigation-dashboard-summary" title="Open Irrigation Planner" style="cursor:pointer;">
        <td style="border:1px solid #999; padding:4px; font-weight:700;">Irrigation</td>
        <td colspan="8" style="border:1px solid #999; padding:4px; pointer-events:auto;">Not planned</td>
      </tr>`;

        const cropRows = (metrics.rows || []).map((r) => `
        <tr>
          <td style="border:1px solid #999; padding:4px; text-align:left; white-space:nowrap;">${esc(r.crop)}</td>
          <td style="border:1px solid #999; padding:4px; text-align:right;">${fmt1(r.area_m2)}</td>
      
          <td style="border:1px solid #999; padding:4px; text-align:right;">${fmt0(r.plan_plants)}</td>           
          <td style="border:1px solid #999; padding:4px; text-align:right;">${fmt0(r.actual_plants)}</td>     
          <td style="border:1px solid #999; padding:4px; text-align:right;">${fmt0((r.actual_plants || 0) - (r.plan_plants || 0))}</td> 
      
          <td style="border:1px solid #999; padding:4px; text-align:right;">${fmtPct(r.germ_rate)}</td>          
          <td style="border:1px solid #999; padding:4px; text-align:right;">${fmt0(r.plan_seeds_adj)}</td>   
      
          <td style="border:1px solid #999; padding:4px; text-align:right;">${fmt1(r.target_kg)}</td>
          <td style="border:1px solid #999; padding:4px; text-align:right;">${fmt1(r.expected_kg)}</td>
        </tr>
      `).join("");


        return `
<div style="font-family: Arial; font-size: 12px; line-height: 1.25;">
  <table style="width:100%; border-collapse:collapse;">
    <tbody>
      <tr>
        <td style="border:1px solid #999; padding:4px; font-weight:700; width:34%;">Garden module</td>
        <td colspan="4" style="border:1px solid #999; padding:4px;">${esc(metrics.moduleName)}</td>
      </tr>
      <tr>
        <td style="border:1px solid #999; padding:4px; font-weight:700;">Location (city)</td>
        <td colspan="4" style="border:1px solid #999; padding:4px;">${esc(metrics.city)}</td>
      </tr>
      <tr>
        <td style="border:1px solid #999; padding:4px; font-weight:700;">Selected year</td>
        <td style="border:1px solid #999; padding:4px;">${esc(year)}</td>
        <td style="border:1px solid #999; padding:4px; font-weight:700;">Total tiler groups</td>
        <td style="border:1px solid #999; padding:4px; text-align:right;">${esc(metrics.tilerGroupsTotal)}</td>
      </tr>
      <tr>
        <td style="border:1px solid #999; padding:4px; font-weight:700;">Tiler groups in year</td>
        <td style="border:1px solid #999; padding:4px; text-align:right;">${esc(metrics.tilerGroupsInYear)}</td>
        <td style="border:1px solid #999; padding:4px; font-weight:700;">(Filter)</td>
        <td style="border:1px solid #999; padding:4px;">perennial OR season_start_year == ${esc(year)} OR harvest overlaps ${esc(year)}</td>
      </tr>
      ${irrigationRows}

      <tr>


    <tr>
    <th style="border:1px solid #999; padding:6px; text-align:left;">Crop</th>
    <th style="border:1px solid #999; padding:6px; text-align:right;">Area (m²)</th>

    <th style="border:1px solid #999; padding:6px; text-align:right;">Plan plants</th>       
    <th style="border:1px solid #999; padding:6px; text-align:right;">Actual plants</th>     
    <th style="border:1px solid #999; padding:6px; text-align:right;">Δ</th>                

    <th style="border:1px solid #999; padding:6px; text-align:right;">Germ</th>              
    <th style="border:1px solid #999; padding:6px; text-align:right;">Plan seeds</th>       

    <th style="border:1px solid #999; padding:6px; text-align:right;">Target (kg)</th>
    <th style="border:1px solid #999; padding:6px; text-align:right;">Expected (kg)</th>
    </tr>


      ${cropRows || `
      <tr>
        <td colspan="9" style="border:1px solid #999; padding:8px; text-align:left;">
          No crops found for ${esc(year)}.
        </td>
      </tr>
      `}
    </tbody>

    <tfoot>
    <tr>
        <td style="border:1px solid #999; padding:6px; font-weight:700;">Total</td>
        <td style="border:1px solid #999; padding:6px; text-align:right; font-weight:700;">${fmt1(metrics.totalAreaM2)}</td>

        <td style="border:1px solid #999; padding:6px; text-align:right; font-weight:700;">${fmt0(metrics.totalPlanPlants)}</td>
        <td style="border:1px solid #999; padding:6px; text-align:right; font-weight:700;">${fmt0(metrics.totalActualPlants)}</td>
        <td style="border:1px solid #999; padding:6px; text-align:right; font-weight:700;">${fmt0((metrics.totalActualPlants || 0) - (metrics.totalPlanPlants || 0))}</td>

        <td style="border:1px solid #999; padding:6px; text-align:right; font-weight:700;"></td>
        <td style="border:1px solid #999; padding:6px; text-align:right; font-weight:700;">${fmt0(metrics.totalPlanSeedsAdj)}</td>

        <td style="border:1px solid #999; padding:6px; text-align:right; font-weight:700;">${fmt1(metrics.totalTargetKg)}</td>
        <td style="border:1px solid #999; padding:6px; text-align:right; font-weight:700;">${fmt1(metrics.totalExpectedKg)}</td>
    </tr>
    </tfoot>

  </table>
</div>`.trim();
    }

    // -------------------- CSV helpers --------------------
    function csvEscape(s) {
        const str = String(s ?? "");
        const needsQuotes = /[",\n\r]/.test(str);
        const escaped = str.replace(/"/g, '""');
        return needsQuotes ? `"${escaped}"` : escaped;
    }

    function downloadCsv(filename, csvText) {
        const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    function buildDashboardCsvSingleTable(metrics, year) {
        const rows = [];
        const push = (arr) => rows.push(arr.map(csvEscape).join(","));

        push(["Garden Dashboard"]);
        push(["Garden module", metrics.moduleName || ""]);
        push(["Location (city)", metrics.city || ""]);
        push(["Selected year", String(year)]);
        push(["Total tiler groups", String(metrics.tilerGroupsTotal ?? 0)]);
        push(["Tiler groups in year", String(metrics.tilerGroupsInYear ?? 0)]);
        push(["Filter", `perennial OR season_start_year == ${year} OR harvest overlaps ${year}`]);

        push([""]);
        push(["Crop", "Area (m²)", "Plan plants", "Actual plants", "Delta", "Germ", "Plan seeds", "Target (kg)", "Expected (kg)"]);

        const list = metrics.rows || [];
        if (list.length === 0) {
            push([`No crops found for ${year}.`]);
        } else {
            for (const r of list) {
                const germPct = Number.isFinite(r.germ_rate) ? Math.round(r.germ_rate * 100) + "%" : "";
                const delta = (r.actual_plants || 0) - (r.plan_plants || 0);
                push([
                    r.crop || "",
                    Number.isFinite(r.area_m2) ? r.area_m2.toFixed(1) : "0.0",
                    String(Math.round(r.plan_plants || 0)),
                    String(Math.round(r.actual_plants || 0)),
                    String(Math.round(delta)),
                    germPct,
                    String(Math.round(r.plan_seeds_adj || 0)),
                    Number.isFinite(r.target_kg) ? r.target_kg.toFixed(1) : "0.0",
                    Number.isFinite(r.expected_kg) ? r.expected_kg.toFixed(1) : "0.0"
                ]);
            }
        }

        push(["Total",
            Number.isFinite(metrics.totalAreaM2) ? metrics.totalAreaM2.toFixed(1) : "0.0",
            String(Math.round(metrics.totalPlanPlants ?? 0)),
            String(Math.round(metrics.totalActualPlants ?? 0)),
            String(Math.round((metrics.totalActualPlants ?? 0) - (metrics.totalPlanPlants ?? 0))),
            "",
            String(Math.round(metrics.totalPlanSeedsAdj ?? 0)),
            Number.isFinite(metrics.totalTargetKg) ? metrics.totalTargetKg.toFixed(1) : "0.0",
            Number.isFinite(metrics.totalExpectedKg) ? metrics.totalExpectedKg.toFixed(1) : "0.0"
        ]);


        return rows.join("\r\n");
    }

    // -------------------- Viewport toolbar (active dashboard UI) --------------------
    const toolbarExpandedByModuleId = new Map();
    const taskBoardSelectionByModuleId = new Map();
    let viewportToolbar = null;
    let activeToolbarModule = null;
    let toolbarRefreshTimer = null;

    function cellId(cell) {
        return cell && cell.getId ? cell.getId() : (cell && cell.id) || "";
    }

    function getViewportToolbarContainer() {
        return graph && graph.container;
    }

    function getViewportToolbarHost() {
        return ensureGraphBodyControlLayer();
    }

    function ensureViewportToolbarHost() {
        const host = getViewportToolbarHost();
        return host;
    }

    function ensureGraphBodyControlLayer() {
        const container = getViewportToolbarContainer();
        if (!container || !document.body) return null;
        try {
            if (window.getComputedStyle && window.getComputedStyle(container).position === "static") container.style.position = "relative";
        } catch (_) { }
        let layer = document.body.querySelector(".trellis-body-control-layer");
        if (!layer) {
            layer = document.createElement("div");
            layer.className = GRAPH_OVERLAY_LAYER_CLASS.control;
            layer.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:" + GRAPH_OVERLAY_Z.CONTROL + ";";
            document.body.appendChild(layer);
        }
        return layer;
    }

    function viewportToolbarWidth(host) {
        if (!host) return 0;
        const rect = host.getBoundingClientRect ? host.getBoundingClientRect() : null;
        if (rect && rect.width) return rect.width;
        return host.clientWidth || 0;
    }

    function getToolbarYear(moduleCell) {
        const moduleYear = getModuleCurrentYear(moduleCell);
        return isValidYear(moduleYear) ? moduleYear : new Date().getFullYear();
    }

    function setToolbarYear(moduleCell, year) {
        const y = toInt(year, NaN);
        if (!moduleCell || !isGardenModule(moduleCell) || !isValidYear(y)) return;
        model.beginUpdate();
        try {
            setModuleCurrentYear(moduleCell, y);
        } finally {
            model.endUpdate();
        }
        applyYearVisibilityToModule(moduleCell, y);
    }

    function selectedGardenModuleForToolbar() {
        const selected = graph.getSelectionCells ? (graph.getSelectionCells() || []) : [graph.getSelectionCell && graph.getSelectionCell()].filter(Boolean);
        for (const cell of selected) {
            const moduleCell = isGardenModule(cell) ? cell : findGardenModuleAncestor(graph, cell);
            if (moduleCell) return moduleCell;
            const taskGarden = gardenForTaskModule(isTaskModule(cell) ? cell : findTaskModuleAncestor(graph, cell));
            if (taskGarden) return taskGarden;
        }
        return null;
    }

    function createToolbarButton(label, title, variant) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = label;
        btn.title = title || label;
        const semanticVariant = variant || "neutral";
        if (window.Trellis && window.Trellis.ui && typeof window.Trellis.ui.applyButtonStyle === "function") window.Trellis.ui.applyButtonStyle(btn, semanticVariant, { compact: true, padding: "0 8px" });
        const fallbackColors = { open: "#2563eb", add: "#188038", danger: "#b91c1c", neutral: "#777" };
        btn.style.height = BTN_SIZE + "px";
        if (!btn.getAttribute("data-trellis-button-variant")) btn.style.border = "1px solid " + (fallbackColors[semanticVariant] || fallbackColors.neutral);
        btn.style.borderRadius = "6px";
        if (!btn.getAttribute("data-trellis-button-variant")) btn.style.background = "#fff";
        if (!btn.getAttribute("data-trellis-button-variant")) btn.style.color = semanticVariant === "open" ? "#1d4ed8" : (semanticVariant === "add" ? "#166534" : (semanticVariant === "danger" ? "#b91c1c" : "#000"));
        btn.style.cursor = "pointer";
        btn.style.padding = "0 8px";
        btn.style.fontFamily = "Arial";
        btn.style.fontSize = "12px";
        btn.style.whiteSpace = "nowrap";
        btn.style.boxSizing = "border-box";
        if (!btn.getAttribute("data-trellis-button-variant")) btn.setAttribute("data-trellis-button-variant", semanticVariant);
        return btn;
    }

    function createYearButton(label, title) {
        const btn = createToolbarButton(label, title);
        btn.style.width = BTN_SIZE + "px";
        btn.style.padding = "0";
        return btn;
    }

    function createTaskBoardButton() {
        const btn = createToolbarButton("Task Board", "Open the current task board", "open");
        btn.style.position = "relative";
        const badge = document.createElement("span");
        badge.className = "trellis-task-board-toolbar-badge";
        badge.style.cssText = "display:none;position:absolute;right:-7px;top:-7px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:#dc2626;color:#fff;font:10px Arial,sans-serif;line-height:16px;text-align:center;box-sizing:border-box;";
        btn.appendChild(badge);
        btn.__trellisTaskBadge = badge;
        return btn;
    }

    function createTaskBoardSelect() {
        const select = document.createElement("select");
        select.className = "trellis-task-board-toolbar-selector";
        select.title = "Open a task board";
        select.style.height = BTN_SIZE + "px";
        select.style.border = "1px solid #777";
        select.style.borderRadius = "6px";
        select.style.background = "#fff";
        select.style.fontFamily = "Arial";
        select.style.fontSize = "12px";
        select.style.boxSizing = "border-box";
        select.style.maxWidth = "210px";
        return select;
    }

    function taskManagerApi() {
        return graph && graph.__trellisTaskManager;
    }

    function taskBoardOptionLabel(boardSummary) {
        const count = Number(boardSummary && boardSummary.count) || 0;
        const years = Array.isArray(boardSummary && boardSummary.years) ? boardSummary.years : [];
        return String(boardSummary && boardSummary.name || "Kanban") + (count ? " (" + count + ")" : "") + (years.length ? " " + years.join(", ") : "");
    }

    function openToolbarTaskBoard(moduleCell, boardId) {
        if (!moduleCell) return;
        const api = taskManagerApi();
        if (!api || typeof api.openBoardForGarden !== "function") return;
        const year = getToolbarYear(moduleCell);
        const moduleId = cellId(moduleCell);
        const requestedBoardId = boardId || taskBoardSelectionByModuleId.get(moduleId) || "";
        if (requestedBoardId) taskBoardSelectionByModuleId.set(moduleId, requestedBoardId);
        const openedBoard = api.openBoardForGarden(moduleCell, requestedBoardId, year);
        const openedBoardId = cellId(openedBoard);
        if (openedBoardId) taskBoardSelectionByModuleId.set(moduleId, openedBoardId);
        if (typeof api.setActiveDashboardContext === "function") api.setActiveDashboardContext(moduleCell, year);
        renderViewportToolbar(moduleCell);
    }

    function activeIrrigationModuleMatches(moduleCell) {
        const plannerApi = graph && graph.__trellisIrrigationPlanner;
        return !!(plannerApi && typeof plannerApi.isIrrigationModeActive === "function" && plannerApi.isIrrigationModeActive(moduleCell));
    }

    function applyToolbarActiveButtonState(btn, active) {
        if (!btn) return;
        btn.style.background = active ? IRRIGATION_ACTIVE_BLUE : "#fff";
        btn.style.borderColor = active ? IRRIGATION_ACTIVE_BLUE : "#2563eb";
        btn.style.color = active ? "#fff" : "#1d4ed8";
    }

    function openIrrigationPlannerForModule(moduleCell) {
        if (!moduleCell) return;
        const plannerApi = graph && graph.__trellisIrrigationPlanner;
        if (!plannerApi || typeof plannerApi.openIrrigationMode !== "function") return;
        plannerApi.openIrrigationMode(moduleCell, { preserveViewport: true });
    }

    function toggleIrrigationPlannerForModule(moduleCell) {
        if (!moduleCell) return;
        const plannerApi = graph && graph.__trellisIrrigationPlanner;
        if (!plannerApi || typeof plannerApi.openIrrigationMode !== "function") return;
        if (typeof plannerApi.isIrrigationModeActive === "function" && plannerApi.isIrrigationModeActive(moduleCell) && typeof plannerApi.closeIrrigationMode === "function") {
            plannerApi.closeIrrigationMode();
            return;
        }
        plannerApi.openIrrigationMode(moduleCell, { preserveViewport: true });
    }

    function trellisUsersApi() {
        return window.Trellis && window.Trellis.users;
    }

    function selectedCellsForShare() {
        return graph.getSelectionCells ? (graph.getSelectionCells() || []) : [];
    }

    function shareSelectionState() {
        const users = trellisUsersApi();
        if (!users || typeof users.getEligibleShareScopes !== "function") return { ok: false, reason: "Trellis Users is unavailable." };
        return users.getEligibleShareScopes(selectedCellsForShare());
    }

    function incomingMessagesCount(moduleCell) {
        const users = trellisUsersApi();
        if (!users) return 0;
        const incoming = typeof users.incomingAccessRequestCount === "function" ? Math.max(0, Number(users.incomingAccessRequestCount({ scopeCell: moduleCell })) || 0) : 0;
        const unread = typeof users.unreadAccessMessageCount === "function" ? Math.max(0, Number(users.unreadAccessMessageCount({ scopeCell: moduleCell })) || 0) : 0;
        return incoming + unread;
    }

    function messagesButtonLabel(moduleCell) {
        const count = incomingMessagesCount(moduleCell);
        return count ? "Messages (" + count + ")" : "Messages";
    }

    function openToolbarMessagesDialog(moduleCell) {
        const users = trellisUsersApi();
        if (!users) { alertShareStatus("Trellis Users is unavailable."); return; }
        if (typeof users.openMessagesDialog === "function") { users.openMessagesDialog({ scopeCell: moduleCell }); return; }
        if (typeof users.showAuthDialog === "function" && (!users.isEnabled || !users.isEnabled() || !users.isLoggedIn || !users.isLoggedIn())) {
            users.showAuthDialog({ blocking: false, message: users.isEnabled && users.isEnabled() ? "Log in to review access messages." : "Enable users before reviewing access messages." });
            return;
        }
        alertShareStatus("Access messages are unavailable in this Trellis build.");
    }

    function setButtonDisabled(button, disabled, title) {
        if (!button) return;
        button.disabled = !!disabled;
        button.title = title || button.title || "";
        button.style.opacity = disabled ? "0.45" : "1";
        button.style.cursor = disabled ? "not-allowed" : "pointer";
    }

    function alertShareStatus(message) {
        if (ui && typeof ui.alert === "function") ui.alert(String(message || ""));
        else window.alert(String(message || ""));
    }

    function closeShareDialog(dialog) {
        if (dialog && dialog.parentNode) dialog.parentNode.removeChild(dialog);
    }

    function openShareInviteDialog(scopes, shareInfo) {
        const users = trellisUsersApi();
        const overlay = document.createElement("div");
        overlay.style.cssText = "position:fixed;left:0;top:0;right:0;bottom:0;z-index:" + TRELLIS_DIALOG_Z + ";background:rgba(0,0,0,.24);display:flex;align-items:flex-start;justify-content:center;padding-top:80px;box-sizing:border-box;";
        const box = document.createElement("div");
        box.style.cssText = "width:420px;max-width:calc(100vw - 32px);background:#fff;border:1px solid #111;border-radius:6px;box-shadow:0 10px 28px rgba(0,0,0,.28);padding:14px;font:13px Arial,sans-serif;box-sizing:border-box;";
        const title = document.createElement("div");
        title.textContent = "Share garden canvas";
        title.style.cssText = "font-weight:700;font-size:15px;margin-bottom:8px;";
        const scopeText = document.createElement("div");
        scopeText.style.cssText = "color:#4B5563;margin-bottom:8px;line-height:18px;";
        scopeText.textContent = "Sharing: " + scopes.map(function (scope) { return scope.label; }).join(", ");
        const email = document.createElement("input");
        email.type = "email";
        email.placeholder = "Recipient email";
        email.style.cssText = "box-sizing:border-box;width:100%;padding:6px 8px;border:1px solid #D1D5DB;border-radius:4px;font:13px Arial,sans-serif;margin-bottom:10px;";
        const preset = document.createElement("select");
        preset.style.cssText = "box-sizing:border-box;width:100%;padding:6px 8px;border:1px solid #D1D5DB;border-radius:4px;font:13px Arial,sans-serif;margin-bottom:8px;";
        ["viewer", "grower", "task", "manager"].forEach(function (value) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = value.charAt(0).toUpperCase() + value.slice(1);
            preset.appendChild(option);
        });
        preset.value = "viewer";
        const presetCaps = { viewer: [], grower: ["create_plantings", "manage_own_plantings"], task: ["move_tasks", "edit_task_details"], manager: ["create_plantings", "manage_own_plantings", "move_tasks", "edit_task_details", "manage_scope_content", "manage_access"] };
        const capabilityLabels = { create_plantings: "Create plantings", manage_own_plantings: "Manage own plantings", move_tasks: "Move tasks", edit_task_details: "Edit task details", manage_scope_content: "Manage scope content", manage_access: "Manage access" };
        const capabilityWrap = document.createElement("div");
        capabilityWrap.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:4px 8px;margin-bottom:10px;color:#374151;";
        function selectedInviteCapabilities() {
            return Array.from(capabilityWrap.querySelectorAll("input[type='checkbox']")).filter(function (input) { return input.checked; }).map(function (input) { return input.value; }).sort();
        }
        function renderInviteCapabilities() {
            capabilityWrap.innerHTML = "";
            const active = new Set(presetCaps[preset.value] || []);
            Object.keys(capabilityLabels).forEach(function (capability) {
                const label = document.createElement("label");
                label.style.cssText = "display:flex;gap:4px;align-items:center;font-size:12px;";
                const input = document.createElement("input");
                input.type = "checkbox";
                input.value = capability;
                input.checked = active.has(capability);
                label.appendChild(input);
                label.appendChild(document.createTextNode(capabilityLabels[capability]));
                capabilityWrap.appendChild(label);
            });
        }
        preset.addEventListener("change", renderInviteCapabilities);
        renderInviteCapabilities();
        const status = document.createElement("div");
        status.style.cssText = "min-height:18px;color:#4B5563;margin-bottom:8px;";
        const buttons = document.createElement("div");
        buttons.style.cssText = "display:flex;justify-content:flex-end;gap:8px;";
        const cancel = createToolbarButton("Cancel", "Close share dialog", "neutral");
        const send = createToolbarButton("Create Email", "Create invite and open an email draft", "open");
        cancel.addEventListener("click", function () { closeShareDialog(overlay); });
        send.addEventListener("click", function () {
            const result = users.createPendingInvite({ email: email.value, scopeCellIds: scopes.map(function (scope) { return scope.id; }), preset: preset.value, capabilities: selectedInviteCapabilities(), shareInfo });
            if (!result.ok) { status.textContent = result.reason; return; }
            const bridge = window.trellisShare;
            bridge.openEmailDraft(result.emailDraft).then(function (draftResult) {
                if (!draftResult || draftResult.ok === false) { status.textContent = (draftResult && draftResult.reason) || "Email draft could not be opened."; return; }
                closeShareDialog(overlay);
            }).catch(function (err) { status.textContent = err && err.message ? err.message : String(err); });
        });
        buttons.appendChild(cancel);
        buttons.appendChild(send);
        box.appendChild(title);
        box.appendChild(scopeText);
        box.appendChild(email);
        box.appendChild(preset);
        box.appendChild(capabilityWrap);
        box.appendChild(status);
        box.appendChild(buttons);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        email.focus();
    }

    function openEnableUsersForShareDialog() {
        const users = trellisUsersApi();
        const overlay = document.createElement("div");
        overlay.style.cssText = "position:fixed;left:0;top:0;right:0;bottom:0;z-index:" + TRELLIS_DIALOG_Z + ";background:rgba(0,0,0,.24);display:flex;align-items:flex-start;justify-content:center;padding-top:80px;box-sizing:border-box;";
        const box = document.createElement("div");
        box.style.cssText = "width:380px;max-width:calc(100vw - 32px);background:#fff;border:1px solid #111;border-radius:6px;box-shadow:0 10px 28px rgba(0,0,0,.28);padding:14px;font:13px Arial,sans-serif;box-sizing:border-box;";
        const title = document.createElement("div");
        title.textContent = "Enable users";
        title.style.cssText = "font-weight:700;font-size:15px;margin-bottom:8px;";
        const hint = document.createElement("div");
        hint.textContent = "Create the first admin before sharing selected garden scopes.";
        hint.style.cssText = "color:#4B5563;margin-bottom:8px;";
        const name = document.createElement("input");
        name.type = "text";
        name.placeholder = "Admin name";
        const pin = document.createElement("input");
        pin.type = "password";
        pin.placeholder = "PIN";
        [name, pin].forEach(function (input) { input.style.cssText = "box-sizing:border-box;width:100%;padding:6px 8px;border:1px solid #D1D5DB;border-radius:4px;font:13px Arial,sans-serif;margin-bottom:8px;"; });
        const status = document.createElement("div");
        status.style.cssText = "min-height:18px;color:#4B5563;margin-bottom:8px;";
        const buttons = document.createElement("div");
        buttons.style.cssText = "display:flex;justify-content:flex-end;gap:8px;";
        const cancel = createToolbarButton("Cancel", "Close", "neutral");
        const enable = createToolbarButton("Enable", "Enable users and continue sharing", "add");
        cancel.addEventListener("click", function () { closeShareDialog(overlay); });
        enable.addEventListener("click", function () {
            const result = users.enableUsers(name.value, pin.value);
            if (!result.ok) { status.textContent = result.reason; return; }
            closeShareDialog(overlay);
            setTimeout(openShareGardenCanvasDialog, 0);
        });
        buttons.appendChild(cancel);
        buttons.appendChild(enable);
        box.appendChild(title);
        box.appendChild(hint);
        box.appendChild(name);
        box.appendChild(pin);
        box.appendChild(status);
        box.appendChild(buttons);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        name.focus();
    }

    async function openShareGardenCanvasDialog() {
        const users = trellisUsersApi();
        const state = shareSelectionState();
        if (!state.ok) { alertShareStatus(state.reason); return; }
        if (!users || typeof users.isEnabled !== "function" || !users.isEnabled()) {
            openEnableUsersForShareDialog();
            return;
        }
        if (!users.isLoggedIn || !users.isLoggedIn()) { alertShareStatus("Log in before sharing this garden canvas."); return; }
        const permission = users.canInviteScopes(state.cells || selectedCellsForShare());
        if (!permission.ok) { alertShareStatus(permission.reason); return; }
        const bridge = window.trellisShare;
        if (!bridge || typeof bridge.getSyncthingShareInfo !== "function" || typeof bridge.openEmailDraft !== "function") {
            alertShareStatus("Syncthing sharing is unavailable in this Trellis build.");
            return;
        }
        let shareInfo;
        try { shareInfo = await bridge.getSyncthingShareInfo({}); } catch (err) { shareInfo = { ok: false, reason: err && err.message ? err.message : String(err) }; }
        if (!shareInfo || shareInfo.ok === false) { alertShareStatus((shareInfo && shareInfo.reason) || "Syncthing sharing is unavailable."); return; }
        if (shareInfo.managed === false) { alertShareStatus(shareInfo.reason || "Move this diagram into a Trellis-managed Syncthing folder before sharing."); return; }
        openShareInviteDialog(permission.scopes || state.scopes, shareInfo);
    }

    function ensureViewportToolbar() {
        if (viewportToolbar) return viewportToolbar;
        const host = ensureViewportToolbarHost();
        if (!host) return null;

        const wrap = document.createElement("div");
        wrap.className = "trellis-garden-dashboard-toolbar";
        wrap.style.position = "fixed";
        wrap.style.zIndex = String(GRAPH_OVERLAY_Z.CONTROL);
        wrap.style.display = "none";
        wrap.style.boxSizing = "border-box";
        wrap.style.padding = "8px 12px";
        wrap.style.pointerEvents = "none";

        const panel = document.createElement("div");
        panel.className = "trellis-garden-dashboard-toolbar-panel";
        panel.style.display = "flex";
        panel.style.flexDirection = "column";
        panel.style.gap = "8px";
        panel.style.maxWidth = "100%";
        panel.style.boxSizing = "border-box";
        panel.style.padding = "8px";
        panel.style.background = "rgba(255,255,255,0.96)";
        panel.style.border = "1px solid #c7c7cc";
        panel.style.borderRadius = "6px";
        panel.style.boxShadow = "0 2px 10px rgba(0,0,0,0.14)";
        panel.style.pointerEvents = "auto";

        const controls = document.createElement("div");
        controls.className = "trellis-garden-dashboard-toolbar-controls";
        controls.style.display = "flex";
        controls.style.alignItems = "center";
        controls.style.gap = BTN_GAP + "px";
        controls.style.flexWrap = "wrap";
        controls.style.boxSizing = "border-box";
        controls.style.justifyContent = "space-between";
        controls.style.width = "100%";

        const leftControls = document.createElement("div");
        leftControls.className = "trellis-garden-dashboard-toolbar-left";
        leftControls.style.display = "flex";
        leftControls.style.alignItems = "center";
        leftControls.style.gap = BTN_GAP + "px";
        leftControls.style.flexWrap = "wrap";

        const rightActions = document.createElement("div");
        rightActions.className = "trellis-garden-dashboard-toolbar-right";
        rightActions.style.display = "flex";
        rightActions.style.alignItems = "center";
        rightActions.style.justifyContent = "flex-end";
        rightActions.style.gap = BTN_GAP + "px";
        rightActions.style.flexWrap = "wrap";
        rightActions.style.marginLeft = "auto";

        const prev = createYearButton("<", "Previous year");
        const next = createYearButton(">", "Next year");
        const yearLabel = document.createElement("div");
        yearLabel.className = "trellis-garden-dashboard-year";
        yearLabel.style.minWidth = "60px";
        yearLabel.style.height = BTN_SIZE + "px";
        yearLabel.style.display = "flex";
        yearLabel.style.alignItems = "center";
        yearLabel.style.justifyContent = "center";
        yearLabel.style.fontFamily = "Arial";
        yearLabel.style.fontSize = "12px";
        yearLabel.style.fontWeight = "700";
        yearLabel.style.padding = "0 6px";
        yearLabel.style.border = "1px solid #777";
        yearLabel.style.borderRadius = "6px";
        yearLabel.style.background = "#fff";
        yearLabel.style.boxSizing = "border-box";

        const planBtn = createToolbarButton("Plan", "Open the year planner", "open");
        const equipmentBtn = createToolbarButton("Equipment", "Open garden equipment", "open");
        const irrigationBtn = createToolbarButton("Irrigation", "Open irrigation planner", "open");
        const allocateBtn = createToolbarButton("Allocate", "Allocate the current plan", "add");
        const taskBoardBtn = createTaskBoardButton();
        const taskBoardSelect = createTaskBoardSelect();
        const messagesBtn = createToolbarButton("Messages", "Review access requests", "open");
        const exportBtn = createToolbarButton("Export", "Export dashboard CSV", "neutral");
        const shareBtn = createToolbarButton("Share", "Share selected module(s), task board(s), or garden bed(s)", "open");
        const tableBtn = createToolbarButton("Table", "Show dashboard table", "open");

        const table = document.createElement("div");
        table.className = "trellis-garden-dashboard-table";
        table.style.display = "none";
        table.style.overflow = "auto";
        table.style.maxHeight = "45vh";
        table.style.borderTop = "1px solid #ddd";
        table.style.paddingTop = "8px";
        table.style.boxSizing = "border-box";

        leftControls.appendChild(prev);
        leftControls.appendChild(yearLabel);
        leftControls.appendChild(next);
        leftControls.appendChild(planBtn);
        leftControls.appendChild(equipmentBtn);
        leftControls.appendChild(irrigationBtn);
        leftControls.appendChild(allocateBtn);
        leftControls.appendChild(taskBoardBtn);
        leftControls.appendChild(taskBoardSelect);
        rightActions.appendChild(messagesBtn);
        rightActions.appendChild(exportBtn);
        rightActions.appendChild(shareBtn);
        rightActions.appendChild(tableBtn);
        controls.appendChild(leftControls);
        controls.appendChild(rightActions);
        panel.appendChild(controls);
        panel.appendChild(table);
        wrap.appendChild(panel);
        host.appendChild(wrap);

        viewportToolbar = { wrap, panel, controls, leftControls, rightActions, prev, next, yearLabel, planBtn, equipmentBtn, irrigationBtn, allocateBtn, taskBoardBtn, taskBoardSelect, messagesBtn, exportBtn, shareBtn, tableBtn, table };

        mxEvent.addListener(wrap, "mousedown", function (evt) { mxEvent.consume(evt); });
        mxEvent.addListener(wrap, "click", function (evt) { evt.stopPropagation(); });

        prev.addEventListener("click", function () {
            if (!activeToolbarModule) return;
            setToolbarYear(activeToolbarModule, getToolbarYear(activeToolbarModule) - 1);
            renderViewportToolbar(activeToolbarModule);
        });
        next.addEventListener("click", function () {
            if (!activeToolbarModule) return;
            setToolbarYear(activeToolbarModule, getToolbarYear(activeToolbarModule) + 1);
            renderViewportToolbar(activeToolbarModule);
        });
        planBtn.addEventListener("click", function () {
            if (!activeToolbarModule) return;
            const year = getToolbarYear(activeToolbarModule);
            setToolbarYear(activeToolbarModule, year);
            try { window.dispatchEvent(new CustomEvent(PLAN_YEAR_EVENT, { detail: { moduleCellId: cellId(activeToolbarModule), year } })); } catch (_) { }
        });
        equipmentBtn.addEventListener("click", function () {
            if (!activeToolbarModule) return;
            const equipmentApi = graph && graph.__trellisEquipment;
            if (equipmentApi && typeof equipmentApi.openDialog === "function") equipmentApi.openDialog(activeToolbarModule);
        });
        irrigationBtn.addEventListener("click", function () { toggleIrrigationPlannerForModule(activeToolbarModule); });
        allocateBtn.addEventListener("click", function () {
            if (!activeToolbarModule) return;
            const year = getToolbarYear(activeToolbarModule);
            setToolbarYear(activeToolbarModule, year);
            try { window.dispatchEvent(new CustomEvent(ALLOCATE_PLAN_EVENT, { detail: { moduleCellId: cellId(activeToolbarModule), year } })); } catch (_) { }
        });
        taskBoardBtn.addEventListener("click", function () { openToolbarTaskBoard(activeToolbarModule, taskBoardSelect.value); });
        taskBoardSelect.addEventListener("change", function () { if (activeToolbarModule && taskBoardSelect.value) taskBoardSelectionByModuleId.set(cellId(activeToolbarModule), taskBoardSelect.value); });
        exportBtn.addEventListener("click", function () {
            if (!activeToolbarModule) return;
            const year = getToolbarYear(activeToolbarModule);
            const metrics = computeModuleMetrics(activeToolbarModule, year);
            const safeName = String(metrics.moduleName || "garden").replace(/[^\w\-]+/g, "_").slice(0, 60);
            downloadCsv(`${safeName}_${year}_dashboard.csv`, buildDashboardCsvSingleTable(metrics, year));
        });
        messagesBtn.addEventListener("click", function () { openToolbarMessagesDialog(activeToolbarModule); });
        shareBtn.addEventListener("click", function () { openShareGardenCanvasDialog(); });
        tableBtn.addEventListener("click", function () {
            if (!activeToolbarModule) return;
            const key = cellId(activeToolbarModule);
            toolbarExpandedByModuleId.set(key, toolbarExpandedByModuleId.get(key) !== true);
            renderViewportToolbar(activeToolbarModule);
        });

        return viewportToolbar;
    }

    function positionViewportToolbar(entry) {
        const host = getViewportToolbarContainer();
        if (!entry || !host) return;
        const rect = host.getBoundingClientRect ? host.getBoundingClientRect() : { left: 0, top: 0 };
        entry.wrap.style.left = Math.round(rect.left || 0) + "px";
        entry.wrap.style.top = Math.round(rect.top || 0) + "px";
        entry.wrap.style.width = Math.max(0, Math.round(viewportToolbarWidth(host))) + "px";
    }

    function renderViewportToolbar(moduleCell) {
        const entry = ensureViewportToolbar();
        if (!entry || !moduleCell) return;
        const year = getToolbarYear(moduleCell);
        const expanded = toolbarExpandedByModuleId.get(cellId(moduleCell)) === true;
        const taskApi = taskManagerApi();
        if (taskApi && typeof taskApi.setActiveDashboardContext === "function") taskApi.setActiveDashboardContext(moduleCell, year);
        const taskBoards = taskApi && typeof taskApi.listBoardsForGarden === "function" ? (taskApi.listBoardsForGarden(moduleCell) || []) : [];
        const taskSummary = taskApi && typeof taskApi.unseenCreatedSummaryForGarden === "function" ? taskApi.unseenCreatedSummaryForGarden(moduleCell) : { hidden: true, total: 0, boards: [] };
        const summaryByBoardId = new Map((taskSummary.boards || []).map(function (entry) { return [String(entry.boardId || ""), entry]; }));
        const moduleId = cellId(moduleCell);
        const preferredBoardId = taskBoardSelectionByModuleId.get(moduleId) || entry.taskBoardSelect.value || "";
        let selectedBoardId = "";
        entry.yearLabel.textContent = String(year);
        entry.taskBoardSelect.innerHTML = "";
        taskBoards.forEach(function (board) {
            const id = cellId(board);
            const summary = summaryByBoardId.get(id) || { boardId: id, name: getCellAttr(board, "label", "") || "Kanban", count: 0, years: [] };
            const option = document.createElement("option");
            option.value = id;
            option.textContent = taskBoardOptionLabel(summary);
            if (id && id === preferredBoardId) selectedBoardId = id;
            entry.taskBoardSelect.appendChild(option);
        });
        if (!selectedBoardId && taskBoards.length) selectedBoardId = cellId(taskBoards[0]);
        if (selectedBoardId) { entry.taskBoardSelect.value = selectedBoardId; taskBoardSelectionByModuleId.set(moduleId, selectedBoardId); }
        entry.taskBoardSelect.disabled = !taskApi || !taskBoards.length;
        entry.taskBoardBtn.disabled = !taskApi || !taskBoards.length;
        const badge = entry.taskBoardBtn.__trellisTaskBadge;
        const badgeTotal = taskSummary.hidden ? 0 : (Number(taskSummary.total) || 0);
        if (badge) { badge.style.display = badgeTotal > 0 ? "" : "none"; badge.textContent = String(badgeTotal); }
        entry.taskBoardBtn.title = taskApi ? (taskBoards.length ? "Open the selected task board" : "No companion task board exists for this garden") : "Task manager is unavailable";
        entry.messagesBtn.textContent = messagesButtonLabel(moduleCell);
        entry.messagesBtn.title = "Review access requests";
        entry.tableBtn.textContent = expanded ? "Hide Table" : "Table";
        entry.tableBtn.title = expanded ? "Hide dashboard table" : "Show dashboard table";
        applyToolbarActiveButtonState(entry.irrigationBtn, activeIrrigationModuleMatches(moduleCell));
        const shareState = shareSelectionState();
        setButtonDisabled(entry.shareBtn, !shareState.ok, shareState.ok ? "Share selected scope(s)" : shareState.reason);
        entry.table.style.display = expanded ? "block" : "none";
        if (expanded) {
            entry.table.innerHTML = formatOverlayTableHtml(computeModuleMetrics(moduleCell, year), year);
            const irrigationSummary = entry.table.querySelector(".trellis-irrigation-dashboard-summary");
            if (irrigationSummary) {
                irrigationSummary.addEventListener("click", function (ev) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    openIrrigationPlannerForModule(moduleCell);
                });
            }
        } else {
            entry.table.innerHTML = "";
        }
        entry.wrap.style.display = "block";
        positionViewportToolbar(entry);
    }

    function hideViewportToolbar() {
        if (viewportToolbar) viewportToolbar.wrap.style.display = "none";
        activeToolbarModule = null;
    }

    function refreshViewportToolbarForSelection() {
        toolbarRefreshTimer = null;
        const moduleCell = selectedGardenModuleForToolbar();
        if (!moduleCell) { hideViewportToolbar(); return; }
        activeToolbarModule = moduleCell;
        renderViewportToolbar(moduleCell);
    }

    function scheduleViewportToolbarRefresh() {
        if (toolbarRefreshTimer) return;
        toolbarRefreshTimer = setTimeout(refreshViewportToolbarForSelection, 0);
    }

    function openIrrigationPlannerForDashboard(dashCell) {
        const moduleCell = findModuleAncestor(graph, dashCell);
        if (!moduleCell) return;
        const plannerApi = graph && graph.__trellisIrrigationPlanner;
        if (!plannerApi || typeof plannerApi.openIrrigationMode !== "function") return;
        plannerApi.openIrrigationMode(moduleCell, { preserveViewport: true });
    }

    function toggleIrrigationPlannerForDashboard(dashCell) {
        const moduleCell = findModuleAncestor(graph, dashCell);
        toggleIrrigationPlannerForModule(moduleCell);
    }

    // -------------------- DOM overlay (controls + table) --------------------
    const overlayByDashId = new Map();

    function removeOverlay(dashId) {
        const entry = overlayByDashId.get(dashId);
        if (!entry) return;
        entry.wrap.remove();
        overlayByDashId.delete(dashId);
    }

    function ensureOverlay(dashCell) {
        const dashId = dashCell.getId();
        if (overlayByDashId.has(dashId)) return overlayByDashId.get(dashId);

        const wrap = document.createElement("div");
        wrap.style.display = "flex";
        wrap.style.flexDirection = "column";
        wrap.style.minHeight = "0";

        wrap.style.position = "absolute";
        wrap.style.zIndex = String(GRAPH_OVERLAY_Z.CONTROL);
        wrap.style.pointerEvents = "none";
        wrap.style.boxSizing = "border-box";
        wrap.style.padding = "0";
        wrap.style.overflow = "hidden";

        // Visual: keep overlay readable but inside the cell bounds 
        wrap.style.background = "rgba(255,255,255,0.0)";

        const uiScaleBox = document.createElement("div");
        uiScaleBox.style.position = "absolute";
        uiScaleBox.style.left = "0";
        uiScaleBox.style.top = "0";
        uiScaleBox.style.display = "flex";
        uiScaleBox.style.flexDirection = "column";
        uiScaleBox.style.boxSizing = "border-box";
        uiScaleBox.style.transformOrigin = "top left";
        uiScaleBox.style.pointerEvents = "none";

        // Header bar (controls) 
        const header = document.createElement("div");
        header.style.flex = "0 0 auto";
        header.style.display = "flex";
        header.style.alignItems = "center";
        header.style.justifyContent = "space-between";
        header.style.gap = "0px";
        header.style.padding = CTRL_PAD + "px";
        header.style.boxSizing = "border-box";
        header.style.background = "rgba(255,255,255,0.0)";
        header.style.pointerEvents = "none";

        // Header bar button layout
        const leftBar = document.createElement("div");
        leftBar.style.display = "flex";
        leftBar.style.alignItems = "center";
        leftBar.style.pointerEvents = "none";

        const centerBar = document.createElement("div");
        centerBar.style.display = "flex";
        centerBar.style.alignItems = "center";
        centerBar.style.justifyContent = "center";
        centerBar.style.flex = "1 1 auto";
        centerBar.style.pointerEvents = "none";

        const rightBar = document.createElement("div");
        rightBar.style.display = "flex";
        rightBar.style.alignItems = "center";
        rightBar.style.justifyContent = "flex-end";
        rightBar.style.pointerEvents = "none";

        const contentViewport = document.createElement("div");
        contentViewport.style.flex = "1 1 auto";
        contentViewport.style.minHeight = "0";
        contentViewport.style.overflow = "hidden";
        contentViewport.style.boxSizing = "border-box";
        contentViewport.style.padding = CTRL_PAD + "px";
        contentViewport.style.pointerEvents = "none";

        contentViewport.style.background = "#fff";
        contentViewport.style.border = "1px solid #999";
        contentViewport.style.borderRadius = "6px";

        const mkBtn = (txt) => {
            const b = document.createElement("button");
            b.textContent = txt;
            if (window.Trellis && window.Trellis.ui && typeof window.Trellis.ui.applyButtonStyle === "function") window.Trellis.ui.applyButtonStyle(b, "neutral", { compact: true });
            b.style.width = BTN_SIZE + "px";
            b.style.height = BTN_SIZE + "px";
            if (!b.getAttribute("data-trellis-button-variant")) b.style.border = "1px solid #777";
            b.style.borderRadius = "6px";
            if (!b.getAttribute("data-trellis-button-variant")) b.style.background = "#fff";
            b.style.cursor = "pointer";
            b.style.padding = "0";
            b.style.lineHeight = "1";
            b.style.pointerEvents = "auto";
            return b;
        };

        const prev = mkBtn("◀");
        const next = mkBtn("▶");

        const yearLabel = document.createElement("div");
        yearLabel.style.minWidth = "60px";
        yearLabel.style.textAlign = "center";
        yearLabel.style.fontFamily = "Arial";
        yearLabel.style.fontSize = "12px";
        yearLabel.style.fontWeight = "700";
        yearLabel.style.padding = "2px 6px";
        yearLabel.style.border = "1px solid #777";
        yearLabel.style.borderRadius = "6px";
        yearLabel.style.background = "#fff";

        const planBtn = createToolbarButton("Plan", "Open the year planner", "open");
        planBtn.style.pointerEvents = "auto";

        const equipmentBtn = createToolbarButton("Equipment", "Open garden equipment", "open");
        equipmentBtn.style.pointerEvents = "auto";

        const irrigationBtn = createToolbarButton("Irrigation", "Open irrigation planner", "open");
        irrigationBtn.style.pointerEvents = "auto";

        const allocateBtn = createToolbarButton("Allocate", "Allocate the current plan", "add");
        allocateBtn.style.pointerEvents = "auto";

        const exportBtn = createToolbarButton("Export", "Export dashboard CSV", "neutral");
        exportBtn.style.pointerEvents = "auto";

        // Content area 
        const content = document.createElement("div");
        content.style.background = "transparent";
        content.style.border = "0";
        content.style.borderRadius = "0";
        content.style.padding = "0";
        content.style.boxSizing = "border-box";
        content.style.width = "max-content";
        content.style.pointerEvents = "none";

        const contentScaleBox = document.createElement("div");
        contentScaleBox.style.width = "max-content";
        contentScaleBox.style.height = "max-content";
        contentScaleBox.style.pointerEvents = "none";


        contentScaleBox.appendChild(content);
        contentViewport.appendChild(contentScaleBox);
        uiScaleBox.appendChild(header);
        uiScaleBox.appendChild(contentViewport);
        wrap.appendChild(uiScaleBox);

        function syncYearLabel() {
            yearLabel.textContent = String(getDashboardYear(dashCell));
        }

        prev.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();

            const moduleCell = findGardenModuleAncestor(graph, dashCell);

            model.beginUpdate();
            try {
                const y = getDashboardYear(dashCell);
                setDashboardYear(dashCell, y - 1, moduleCell);
            } finally {
                model.endUpdate();
            }

            if (moduleCell) applyYearVisibilityToModule(moduleCell, getDashboardYear(dashCell));

            recomputeAndRenderDashboard(dashCell, { allowGeometryChange: true, preserveWidth: true });
        });


        next.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();

            const moduleCell = findGardenModuleAncestor(graph, dashCell);

            model.beginUpdate();
            try {
                const y = getDashboardYear(dashCell);
                setDashboardYear(dashCell, y + 1, moduleCell);
            } finally {
                model.endUpdate();
            }

            if (moduleCell) applyYearVisibilityToModule(moduleCell, getDashboardYear(dashCell));

            recomputeAndRenderDashboard(dashCell, { allowGeometryChange: true, preserveWidth: true });
        });

        planBtn.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();

            const moduleCell = findModuleAncestor(graph, dashCell);
            if (!moduleCell) return;

            const year = getDashboardYear(dashCell);

            setDashboardYear(dashCell, year, moduleCell);

            try {
                window.dispatchEvent(new CustomEvent(PLAN_YEAR_EVENT, {
                    detail: {
                        moduleCellId: moduleCell.getId ? moduleCell.getId() : moduleCell.id,
                        dashCellId: dashCell.getId ? dashCell.getId() : dashCell.id,
                        year: year
                    }
                }));
            } catch (_) { }
        });

        equipmentBtn.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();

            const moduleCell = findModuleAncestor(graph, dashCell);
            if (!moduleCell) return;

            const equipmentApi = graph && graph.__trellisEquipment;
            if (!equipmentApi || typeof equipmentApi.openDialog !== "function") return;

            equipmentApi.openDialog(moduleCell);
        });

        irrigationBtn.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            toggleIrrigationPlannerForDashboard(dashCell);
        });

        allocateBtn.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();

            const moduleCell = findModuleAncestor(graph, dashCell);
            if (!moduleCell) return;

            const year = getDashboardYear(dashCell);

            setDashboardYear(dashCell, year, moduleCell);

            try {
                window.dispatchEvent(new CustomEvent(ALLOCATE_PLAN_EVENT, {
                    detail: {
                        moduleCellId: moduleCell.getId ? moduleCell.getId() : moduleCell.id,
                        dashCellId: dashCell.getId ? dashCell.getId() : dashCell.id,
                        year: year
                    }
                }));
            } catch (_) { }
        });

        exportBtn.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();

            const moduleCell = findModuleAncestor(graph, dashCell);
            if (!moduleCell) return;

            const year = getDashboardYear(dashCell);

            applyYearVisibilityToModule(moduleCell, year);

            const metrics = computeModuleMetrics(moduleCell, year);

            const safeName = String(metrics.moduleName || "garden")
                .replace(/[^\w\-]+/g, "_")
                .slice(0, 60);

            const filename = `${safeName}_${year}_dashboard.csv`;
            const csv = buildDashboardCsvSingleTable(metrics, year);
            downloadCsv(filename, csv);
        });

        // Left: year controls
        leftBar.appendChild(prev);
        leftBar.appendChild(yearLabel);
        leftBar.appendChild(next);

        // Right: action buttons
        rightBar.appendChild(planBtn);
        rightBar.appendChild(equipmentBtn);
        rightBar.appendChild(irrigationBtn);
        rightBar.appendChild(allocateBtn);
        rightBar.appendChild(exportBtn);

        // Mount bars into header
        header.appendChild(leftBar);
        header.appendChild(centerBar);
        header.appendChild(rightBar);


        graph.container.appendChild(wrap);

        const entry = {
            wrap, uiScaleBox, header,
            leftBar, centerBar, rightBar,
            contentViewport, contentScaleBox, content,
            prev, next,
            planBtn, equipmentBtn, allocateBtn, exportBtn,
            yearLabel, syncYearLabel
        };

        overlayByDashId.set(dashId, entry);

        syncYearLabel();
        return entry;
    }

    // -------------------- Zoom Helpers ------------------------------

    function applyDashboardUiScale(entry, dashCell) {
        if (!entry || !entry.uiScaleBox) return;
        const s = getEffectiveDashUiScale(entry, dashCell);
        syncDashboardUiNaturalBox(entry);
        entry.uiScaleBox.style.transformOrigin = "top left";
        entry.uiScaleBox.style.transform = `scale(${s})`;
    }

    function getNaturalContentWidthPx(entry) {
        if (!entry || !entry.content) return 0;
        // scrollWidth is the natural layout width (not affected by transforms on ancestors)
        const w = entry.content.scrollWidth || entry.content.offsetWidth || 0;
        return Math.max(0, w);
    }

    function getNaturalContentHeightPx(entry) {
        if (!entry || !entry.content) return 0;
        const h = entry.content.scrollHeight || entry.content.offsetHeight || 0;
        return Math.max(0, h);
    }

    function measureHeaderNaturalSize(entry) {
        if (!entry) return { width: 0, height: 0 };
        const bars = [entry.leftBar, entry.centerBar, entry.rightBar];
        let width = 2 * CTRL_PAD;
        let height = 0;
        for (const bar of bars) {
            if (!bar) continue;
            width += bar.scrollWidth || bar.offsetWidth || 0;
            height = Math.max(height, bar.scrollHeight || bar.offsetHeight || 0);
        }
        return { width, height: height + (2 * CTRL_PAD) };
    }

    function measureDashboardUiNaturalSize(entry) {
        if (!entry) return { width: DASH_MIN_W, height: DASH_MIN_W / DASH_DEFAULT_ASPECT };
        const headerSize = measureHeaderNaturalSize(entry);
        const contentW = getNaturalContentWidthPx(entry);
        const contentH = getNaturalContentHeightPx(entry);
        const viewportW = contentW + (2 * CTRL_PAD) + 2;
        const viewportH = contentH + (2 * CTRL_PAD) + 2;
        return {
            width: Math.max(DASH_MIN_W, Math.ceil(Math.max(headerSize.width, viewportW))),
            height: Math.max(1, Math.ceil(headerSize.height + viewportH))
        };
    }

    function syncDashboardUiNaturalBox(entry) {
        if (!entry || !entry.uiScaleBox) return;
        const size = measureDashboardUiNaturalSize(entry);
        const headerH = measureHeaderNaturalSize(entry).height;
        entry.uiScaleBox.style.width = size.width + "px";
        entry.uiScaleBox.style.height = size.height + "px";
        if (entry.header) entry.header.style.width = size.width + "px";
        if (entry.contentViewport) {
            entry.contentViewport.style.width = size.width + "px";
            entry.contentViewport.style.height = Math.max(0, size.height - headerH) + "px";
        }
    }

    function getEffectiveDashUiScale(entry, dashCell) {
        const st = dashCell && graph.view.getState(dashCell);
        const size = measureDashboardUiNaturalSize(entry);
        if (!st || !(size.width > 0) || !(size.height > 0)) return 1;
        return Math.min(Math.max(0, st.width) / size.width, Math.max(0, st.height) / size.height);
    }

    function applyScaledHeaderLayout(entry) {
        if (!entry) return;

        const gapPx = BTN_GAP;
        const padPx = CTRL_PAD;

        entry.header.style.padding = padPx + "px";

        // Use CSS gap inside each bar for consistent spacing
        for (const bar of [entry.leftBar, entry.centerBar, entry.rightBar]) {
            if (!bar) continue;
            bar.style.gap = gapPx + "px";
        }
    }

    function positionOverlay(dashCell) {
        const st = graph.view.getState(dashCell);
        if (!st) return;

        const entry = overlayByDashId.get(dashCell.getId());
        if (!entry) return;

        entry.wrap.style.left = Math.round(st.x) + "px";
        entry.wrap.style.top = Math.round(st.y) + "px";
        entry.wrap.style.width = Math.max(0, Math.round(st.width)) + "px";
        entry.wrap.style.height = Math.max(0, Math.round(st.height)) + "px";

        applyScaledHeaderLayout(entry);
        applyDashboardUiScale(entry, dashCell);
    }


    function renderOverlay(dashCell, metrics, year, opts) {
        const entry = ensureOverlay(dashCell);
        entry.syncYearLabel();
        entry.content.innerHTML = formatOverlayTableHtml(metrics, year);
        const irrigationSummary = entry.content.querySelector(".trellis-irrigation-dashboard-summary");
        if (irrigationSummary) {
            irrigationSummary.style.pointerEvents = "auto";
            irrigationSummary.addEventListener("click", function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                openIrrigationPlannerForDashboard(dashCell);
            });
        }
        syncDashboardUiNaturalBox(entry);
        if (opts && opts.allowGeometryChange) {
            model.beginUpdate();
            try {
                clampDashboardGeometry(dashCell, { preserveArea: !opts.preserveWidth, preserveWidth: !!opts.preserveWidth, allowModuleGrow: true });
            } finally {
                model.endUpdate();
            }
        }
        positionOverlay(dashCell);
    }

    function cleanupMissingDashboards() {
        for (const [dashId, entry] of overlayByDashId.entries()) {
            const cell = model.getCell(dashId);
            if (!cell || !cell.getAttribute || cell.getAttribute(DASH_ATTR) !== "1") {
                removeOverlay(dashId);
            }
        }
    }

    // -------------------- Dashboard update orchestration --------------------
    function recomputeAndRenderDashboard(dashCell, opts) {
        return;
        if (!dashCell) return;
        const moduleCell = findModuleAncestor(graph, dashCell);
        if (!moduleCell) return;

        const year = getDashboardYear(dashCell);
        const metrics = computeModuleMetrics(moduleCell, year);

        // Render the full UI as a DOM overlay. 
        renderOverlay(dashCell, metrics, year, opts);
    }

    function ensureOverlayForDashboard(dashCell) {
        if (!dashCell) return;
        ensureOverlay(dashCell);
        positionOverlay(dashCell);
    }

    // -------------------- Create dashboard cell --------------------
    function createDashboardCell(moduleCell) {
        return null;
        const parent = moduleCell;

        const x = 20;
        const y = 20;
        const w = 320;
        const h = 220;

        // Safer: use graph.insertVertex which handles value nodes correctly
        const inserted = graph.insertVertex(parent, null, "", x, y, w, h, DASH_STYLE);

        setCellAttr(inserted, DASH_ATTR, "1");

        const initialYear = getModuleCurrentYear(moduleCell) || new Date().getFullYear();
        setDashboardYear(inserted, initialYear, moduleCell);
        ensureGardenModuleMinimum(moduleCell);
        applyYearVisibilityToModule(moduleCell, initialYear);

        // Ensure it is visually on top of other children (optional)
        try { graph.orderCells(false, [inserted]); } catch (e) { }

        ensureOverlayForDashboard(inserted);
        recomputeAndRenderDashboard(inserted, { allowGeometryChange: true });

        return inserted;
    }

    function hasGardenSettingsSet(moduleCell) {
        return !!(moduleCell && moduleCell.getAttribute &&
            (moduleCell.getAttribute("city_id") || moduleCell.getAttribute("city_name")) &&
            moduleCell.getAttribute("unit_system"));
    }

    // -------------------- Auto-create dashboard on garden module event -------------------- 
    if (!graph.__gardenDashboardAutoCreateInstalled) {
        graph.__gardenDashboardAutoCreateInstalled = true;

        graph.addListener("usl:gardenModuleNeedsSettings", function (sender, evt) {
            return;
            const mod = evt.getProperty("cell");
            if (!mod || !isGardenModule(mod)) return;

            // Idempotent: do nothing if already present                                       
            if (findDashboardCell(mod)) return;

            // Optional gating: only create after mandatory settings exist                      
            // If you want immediate dashboard creation, delete this block.                     
            if (!hasGardenSettingsSet(mod)) return;

            setTimeout(function () {
                // Re-check after delay                                                         
                if (!model.getCell(mod.getId ? mod.getId() : mod.id)) return;
                if (!isGardenModule(mod)) return;
                if (findDashboardCell(mod)) return;
                if (!hasGardenSettingsSet(mod)) return;

                model.beginUpdate();
                try {
                    createDashboardCell(mod);
                } finally {
                    model.endUpdate();
                }
            }, 0);
        });
    }


    // -------------------- View/model event wiring --------------------
    let rafPending = false;
    let attachExistingDashboardsOncePending = false;
    let attachExistingDashboardsOnceDone = false;

    function scheduleOverlayReposition() {
        scheduleViewportToolbarRefresh();
        return;
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(function () {
            rafPending = false;
            cleanupMissingDashboards();
            for (const [dashId, entry] of overlayByDashId.entries()) {
                const cell = model.getCell(dashId);
                if (cell) positionOverlay(cell);
            }
        });
    }

    // Hook into view updates (zoom/pan/resize)
    const oldValidate = graph.view.validate;
    graph.view.validate = function () {
        const res = oldValidate.apply(this, arguments);
        scheduleOverlayReposition();
        return res;
    };

    window.addEventListener("resize", function () {
        scheduleOverlayReposition();
    });

    function collectTouchedDashboards(cells) {
        return [];
        const out = [];
        const seen = new Set();
        for (const cell of (cells || [])) {
            const dash = isDashboardCell(cell) ? cell : (isGardenModule(cell) ? findDashboardCell(cell) : findDashboardAncestor(cell));
            if (!dash || seen.has(dash.getId())) continue;
            seen.add(dash.getId());
            out.push(dash);
        }
        return out;
    }

    graph.addListener(mxEvent.CELLS_MOVED, function (_sender, evt) {
        const dashboards = collectTouchedDashboards(evt.getProperty("cells") || []);
        if (!dashboards.length) return;
        model.beginUpdate();
        try {
            dashboards.forEach(dash => clampDashboardGeometry(dash, { preserveSize: true, allowModuleGrow: true }));
        } finally {
            model.endUpdate();
        }
        scheduleOverlayReposition();
    });

    graph.addListener(mxEvent.CELLS_RESIZED, function (_sender, evt) {
        const dashboards = collectTouchedDashboards(evt.getProperty("cells") || []);
        if (!dashboards.length) return;
        model.beginUpdate();
        try {
            dashboards.forEach(dash => clampDashboardGeometry(dash, { preserveArea: false, allowModuleGrow: true }));
        } finally {
            model.endUpdate();
        }
        scheduleOverlayReposition();
    });

    // On model changes, reposition overlays (and optionally recompute when selected). 
    model.addListener(mxEvent.CHANGE, function () {
        scheduleOverlayReposition();

        // Conservative recompute: if a dashboard is selected (or inside selected), update it. 
        const sel = graph.getSelectionCell && graph.getSelectionCell();
        if (!sel) return;
        const dash = (sel.getAttribute && sel.getAttribute(DASH_ATTR) === "1") ? sel : findDashboardAncestor(sel);
        if (!dash) return;
        recomputeAndRenderDashboard(dash);
    });

    // Recompute when selecting a dashboard (or something inside it)
    graph.getSelectionModel().addListener(mxEvent.CHANGE, function () {
        return;
    });

    // -------------------- Context menu: Create Garden Dashboard --------------------
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

    registerTrellisContextMenuContributor({
        id: "gardenDashboard",
        priority: 200,
        addItems: function (menu, cell, evt) {
            return;

            if (!cell) return;

            // If user right-clicks inside something, we want the garden module ancestor
            const mod = isGardenModule(cell) ? cell : (function () {
                const anc = findModuleAncestor(graph, cell);
                return (anc && isGardenModule(anc)) ? anc : null;
            })();

            if (!mod) return;

            const existing = findDashboardCell(mod);
            if (existing) return;

            menu.addSeparator();
            menu.addItem("Create Garden Dashboard", null, function () {
                graph.getModel().beginUpdate();
                try {
                    createDashboardCell(mod);
                } finally {
                    graph.getModel().endUpdate();
                }
            });
        }
    });

    // -------------------- If dashboards already exist in file, attach overlays --------------------
    function attachExistingDashboards() {
        return;
        const root = model.getRoot();
        const all = getDescendants(root);

        for (const c of all) {
            if (c && c.getAttribute && c.getAttribute(DASH_ATTR) === "1") {
                ensureOverlayForDashboard(c);
                recomputeAndRenderDashboard(c);

                const mod = findGardenModuleAncestor(graph, c);
                if (mod) {
                    const year = getDashboardYear(c);
                    setDashboardYear(c, year, mod);
                    applyYearVisibilityToModule(mod, year);
                }
            }
        }

        scheduleOverlayReposition();
    }

    function scheduleAttachExistingDashboards() {
        return;
        setTimeout(function () {
            attachExistingDashboards();
        }, 10000);
    }

    if (graph.getSelectionModel && graph.getSelectionModel().addListener) {
        graph.getSelectionModel().addListener(mxEvent.CHANGE, scheduleViewportToolbarRefresh);
    }
    if (model.addListener) {
        model.addListener(mxEvent.CHANGE, scheduleViewportToolbarRefresh);
    }
    window.addEventListener("resize", scheduleViewportToolbarRefresh);
    window.addEventListener("trellisUsersStoreChanged", scheduleViewportToolbarRefresh);
    window.addEventListener("trellisTaskBoardSeenStateChanged", scheduleViewportToolbarRefresh);
    window.addEventListener(IRRIGATION_MODE_CHANGED_EVENT, scheduleViewportToolbarRefresh);
    const viewportToolbarHost = getViewportToolbarContainer();
    if (viewportToolbarHost && viewportToolbarHost.addEventListener) {
        viewportToolbarHost.addEventListener("scroll", scheduleViewportToolbarRefresh);
    }
    scheduleViewportToolbarRefresh();

    scheduleAttachExistingDashboards();

});
