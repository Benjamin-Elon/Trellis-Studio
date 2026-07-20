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
    const GRAPH_OVERLAY_Z = Object.freeze({ ANNOTATION: 10000, CONNECTION: 10010, CONTROL: 10020, CONTROL_TOP: 10030 }); // CHANGE
    const GRAPH_OVERLAY_LAYER_CLASS = Object.freeze({ control: "trellis-graph-control-layer trellis-body-control-layer" }); // CHANGE
    const TRELLIS_DIALOG_Z = 2000000000; // NEW

    const DASH_ATTR = "garden_dashboard";
    const DASH_YEAR_ATTR = "dashboard_year";
    const MODULE_CURRENT_YEAR_ATTR = "current_year"; // NEW
    const YEAR_HIDDEN_ATTR = "year_hidden";
    const PLAN_YEAR_JSON_ATTR = "plan_year_json";

    const BTN_SIZE = 22;
    const BTN_GAP = 6;
    const CTRL_PAD = 6;
    const DASH_MIN_W = 320; // CHANGE
    const DASH_DEFAULT_ASPECT = 320 / 220; // CHANGE
    const GARDEN_MIN_CONTENT_W = 440; // CHANGE
    const GARDEN_MIN_CONTENT_H = 340; // CHANGE

    const DASH_STYLE =
        "rounded=0;whiteSpace=wrap;html=1;" +
        "align=left;verticalAlign=top;" +
        "labelPosition=left;verticalLabelPosition=top;" +
        "spacing=0;spacingTop=0;spacingLeft=0;spacingRight=0;spacingBottom=0;" +
        "strokeColor=#666666;fillColor=#f7f7f7;fontSize=12;";

    const PLAN_YEAR_EVENT = "usl:planYearRequested";
    const ALLOCATE_PLAN_EVENT = "usl:allocatePlanRequested";

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

    function findModuleAncestor(graph, cell) {
        const m = graph.getModel();
        let cur = cell;
        while (cur) {
            if (isModule(cur)) return cur;
            cur = m.getParent(cur);
        }
        return null;
    }

    function findGardenModuleAncestor(graph, cell) { // NEW
        const m = graph.getModel(); // NEW
        let cur = cell; // NEW
        while (cur) { // NEW
            if (isGardenModule(cur)) return cur; // NEW
            cur = m.getParent(cur); // NEW
        } // NEW
        return null; // NEW
    } // NEW

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
        return !!(moduleCell && moduleCell.getAttribute && (moduleCell.getAttribute("city_id") || moduleCell.getAttribute("city_name"))); // CHANGED
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

    function isDashboardCell(cell) { // CHANGE
        return !!cell && cell.getAttribute && cell.getAttribute(DASH_ATTR) === "1"; // CHANGE
    } // CHANGE

    function getModuleHeaderHeight(moduleCell) { // CHANGE
        if (!moduleCell) return 0; // CHANGE
        if (graph.getStartSize) { // CHANGE
            const size = graph.getStartSize(moduleCell) || {}; // CHANGE
            return Number(size.height) || 0; // CHANGE
        } // CHANGE
        const style = getStyleSafe(moduleCell); // CHANGE
        const m = style.match(/(?:^|;)startSize=(\d+)(?=;|$)/); // CHANGE
        return m ? parseInt(m[1], 10) : 0; // CHANGE
    } // CHANGE

    function ensureGardenModuleMinimum(moduleCell) { // CHANGE
        if (!isGardenModule(moduleCell)) return; // CHANGE
        const api = graph && graph.__trellisModules; // CHANGE
        if (api && typeof api.enforceGardenModuleMinimum === "function") { // CHANGE
            api.enforceGardenModuleMinimum(moduleCell); // CHANGE
            return; // CHANGE
        } // CHANGE
        try { // CHANGE
            graph.fireEvent(new mxEventObject("usl:requestApplyModuleMargins", "cell", moduleCell)); // CHANGE
        } catch (_) { } // CHANGE
    } // CHANGE

    function getGardenModuleContentSize(moduleCell) { // CHANGE
        const g = moduleCell && model.getGeometry(moduleCell); // CHANGE
        if (!g) return { width: GARDEN_MIN_CONTENT_W, height: GARDEN_MIN_CONTENT_H }; // CHANGE
        return { // CHANGE
            width: Math.max(GARDEN_MIN_CONTENT_W, Number(g.width) || 0), // CHANGE
            height: Math.max(GARDEN_MIN_CONTENT_H, (Number(g.height) || 0) - getModuleHeaderHeight(moduleCell)) // CHANGE
        }; // CHANGE
    } // CHANGE

    function growGardenModuleToContain(moduleCell, x, y, width, height) { // CHANGE
        if (!isGardenModule(moduleCell)) return false; // CHANGE
        const g = model.getGeometry(moduleCell); // CHANGE
        if (!g) return false; // CHANGE
        const headerH = getModuleHeaderHeight(moduleCell); // CHANGE
        const neededW = Math.max(GARDEN_MIN_CONTENT_W, (Number(x) || 0) + (Number(width) || 0)); // CHANGE
        const neededH = Math.max(GARDEN_MIN_CONTENT_H, (Number(y) || 0) + (Number(height) || 0)) + headerH; // CHANGE
        const nextW = Math.max(Number(g.width) || 0, neededW); // CHANGE
        const nextH = Math.max(Number(g.height) || 0, neededH); // CHANGE
        if (Math.abs(nextW - g.width) < 0.5 && Math.abs(nextH - g.height) < 0.5) return false; // CHANGE
        const g2 = g.clone(); // CHANGE
        g2.width = nextW; // CHANGE
        g2.height = nextH; // CHANGE
        model.setGeometry(moduleCell, g2); // CHANGE
        return true; // CHANGE
    } // CHANGE

    function getDashboardMeasuredAspect(dashCell) { // CHANGE
        const entry = dashCell && overlayByDashId.get(dashCell.getId()); // CHANGE
        const size = measureDashboardUiNaturalSize(entry); // CHANGE
        return size.width > 0 && size.height > 0 ? size.width / size.height : DASH_DEFAULT_ASPECT; // CHANGE
    } // CHANGE

    function clampDashboardGeometry(dashCell, opts) { // CHANGE
        const o = opts || {}; // CHANGE
        if (!isDashboardCell(dashCell) || graph.__gardenDashboardClamping) return false; // CHANGE
        const g = model.getGeometry(dashCell); // CHANGE
        if (!g) return false; // CHANGE
        const moduleCell = findGardenModuleAncestor(graph, dashCell); // CHANGE
        if (moduleCell && o.allowModuleGrow !== false) ensureGardenModuleMinimum(moduleCell); // CHANGE

        const ratio = Math.max(0.01, Number(o.aspectRatio) || getDashboardMeasuredAspect(dashCell)); // CHANGE
        let width = Math.max(DASH_MIN_W, Number(g.width) || DASH_MIN_W); // CHANGE
        let height = Math.max(1, Number(g.height) || (DASH_MIN_W / ratio)); // CHANGE

        if (o.preserveWidth) { // CHANGE
            width = Math.max(DASH_MIN_W, width); // CHANGE
            height = Math.max(1, width / ratio); // CHANGE
        } else if (o.preserveSize) { // CHANGE
            width = Math.max(DASH_MIN_W, width); // CHANGE
            height = Math.max(1, height); // CHANGE
        } else if (o.preserveArea) { // CHANGE
            const area = Math.max(DASH_MIN_W, width * height); // CHANGE
            width = Math.max(DASH_MIN_W, Math.sqrt(area * ratio)); // CHANGE
            height = Math.max(1, width / ratio); // CHANGE
        } else if (width / height > ratio) { // CHANGE
            width = Math.max(DASH_MIN_W, height * ratio); // CHANGE
        } else { // CHANGE
            height = Math.max(1, width / ratio); // CHANGE
        } // CHANGE

        if (moduleCell) { // CHANGE
            const content = getGardenModuleContentSize(moduleCell); // CHANGE
            if (width > content.width || height > content.height) growGardenModuleToContain(moduleCell, Number(g.x) || 0, Number(g.y) || 0, width, height); // CHANGE
            const updatedContent = getGardenModuleContentSize(moduleCell); // CHANGE
            width = Math.min(width, Math.max(DASH_MIN_W, updatedContent.width)); // CHANGE
            height = Math.min(height, Math.max(1, updatedContent.height)); // CHANGE
        } // CHANGE

        const next = g.clone(); // CHANGE
        next.width = width; // CHANGE
        next.height = height; // CHANGE
        if (moduleCell) { // CHANGE
            const content = getGardenModuleContentSize(moduleCell); // CHANGE
            next.x = Math.max(0, Math.min(Number(next.x) || 0, Math.max(0, content.width - next.width))); // CHANGE
            next.y = Math.max(0, Math.min(Number(next.y) || 0, Math.max(0, content.height - next.height))); // CHANGE
        } // CHANGE

        if (Math.abs(next.x - g.x) < 0.5 && Math.abs(next.y - g.y) < 0.5 && Math.abs(next.width - g.width) < 0.5 && Math.abs(next.height - g.height) < 0.5) return false; // CHANGE
        graph.__gardenDashboardClamping = true; // CHANGE
        try { // CHANGE
            model.setGeometry(dashCell, next); // CHANGE
        } finally { // CHANGE
            graph.__gardenDashboardClamping = false; // CHANGE
        } // CHANGE
        return true; // CHANGE
    } // CHANGE

    function isValidYear(n) { // NEW
        return Number.isFinite(n) && n > 1900 && n < 3000; // NEW
    } // NEW

    function getAttrYear(cell, key) { // NEW
        const y = toInt(getCellAttr(cell, key, ""), NaN); // NEW
        return isValidYear(y) ? y : NaN; // NEW
    } // NEW

    function getModuleCurrentYear(moduleCell) { // NEW
        return getAttrYear(moduleCell, MODULE_CURRENT_YEAR_ATTR); // NEW
    } // NEW

    function setModuleCurrentYear(moduleCell, year) { // NEW
        const y = toInt(year, NaN); // NEW
        if (!moduleCell || !isGardenModule(moduleCell) || !isValidYear(y)) return; // NEW
        setCellAttr(moduleCell, MODULE_CURRENT_YEAR_ATTR, String(y)); // NEW
    } // NEW

    function getDashboardYear(dashCell) { // CHANGE
        const dashYear = getAttrYear(dashCell, DASH_YEAR_ATTR); // CHANGE
        if (isValidYear(dashYear)) return dashYear; // CHANGE

        const moduleCell = findGardenModuleAncestor(graph, dashCell); // NEW
        const moduleYear = getModuleCurrentYear(moduleCell); // NEW
        if (isValidYear(moduleYear)) return moduleYear; // NEW

        return new Date().getFullYear(); // CHANGE
    } // CHANGE

    function setDashboardYear(dashCell, year, moduleCell) { // CHANGE
        const y = toInt(year, NaN); // NEW
        if (!isValidYear(y)) return; // NEW

        setCellAttr(dashCell, DASH_YEAR_ATTR, String(y)); // CHANGE

        const mod = moduleCell || findGardenModuleAncestor(graph, dashCell); // NEW
        if (mod) setModuleCurrentYear(mod, y); // NEW
    } // CHANGE

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
            irrigation: readIrrigationDashboardSummary(moduleCell), // NEW
            rows
        };
    }

    function readIrrigationDashboardSummary(moduleCell) { // NEW
        const raw = getCellAttr(moduleCell, "irrigation_dashboard_summary_json", ""); // NEW
        if (!raw) return null; // NEW
        try { return JSON.parse(raw); } catch (_) { return null; } // NEW
    } // NEW


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
        selectedYear = toInt(selectedYear, new Date().getFullYear()); // NEW
        if (!isValidYear(selectedYear)) selectedYear = new Date().getFullYear(); // NEW
        setModuleCurrentYear(moduleCell, selectedYear); // NEW

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
        const irrigation = metrics.irrigation || null; // NEW
        const fmtPctWhole = (n) => Number.isFinite(Number(n)) ? Math.round(Number(n)) + "%" : "0%"; // NEW
        const fmtMoney = (n) => "$" + (Number.isFinite(Number(n)) ? Number(n).toFixed(Number(n) % 1 === 0 ? 0 : 2) : "0"); // NEW
        const fmtMargin = (n) => Number.isFinite(Number(n)) ? Number(n).toFixed(1) + " psi" : "n/a"; // NEW
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
      </tr>`; // NEW

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

    // -------------------- Viewport toolbar (active dashboard UI) -------------------- // NEW
    const toolbarExpandedByModuleId = new Map(); // NEW
    let viewportToolbar = null; // NEW
    let activeToolbarModule = null; // NEW
    let toolbarRefreshTimer = null; // NEW

    function cellId(cell) { // NEW
        return cell && cell.getId ? cell.getId() : (cell && cell.id) || ""; // NEW
    } // NEW

    function getViewportToolbarContainer() { // NEW
        return graph && graph.container; // NEW
    } // NEW

    function getViewportToolbarHost() { // CHANGE
        return ensureGraphBodyControlLayer(); // CHANGE
    } // NEW

    function ensureViewportToolbarHost() { // NEW
        const host = getViewportToolbarHost(); // NEW
        return host; // NEW
    } // NEW

    function ensureGraphBodyControlLayer() { // CHANGE
        const container = getViewportToolbarContainer(); // NEW
        if (!container || !document.body) return null; // CHANGE
        try { // NEW
            if (window.getComputedStyle && window.getComputedStyle(container).position === "static") container.style.position = "relative"; // NEW
        } catch (_) { } // NEW
        let layer = document.body.querySelector(".trellis-body-control-layer"); // CHANGE
        if (!layer) { // NEW
            layer = document.createElement("div"); // NEW
            layer.className = GRAPH_OVERLAY_LAYER_CLASS.control; // CHANGE
            layer.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:" + GRAPH_OVERLAY_Z.CONTROL + ";"; // CHANGE
            document.body.appendChild(layer); // CHANGE
        } // NEW
        return layer; // NEW
    } // CHANGE

    function viewportToolbarWidth(host) { // NEW
        if (!host) return 0; // NEW
        const rect = host.getBoundingClientRect ? host.getBoundingClientRect() : null; // NEW
        if (rect && rect.width) return rect.width; // CHANGE
        return host.clientWidth || 0; // CHANGE
    } // NEW

    function getToolbarYear(moduleCell) { // NEW
        const moduleYear = getModuleCurrentYear(moduleCell); // NEW
        return isValidYear(moduleYear) ? moduleYear : new Date().getFullYear(); // NEW
    } // NEW

    function setToolbarYear(moduleCell, year) { // NEW
        const y = toInt(year, NaN); // NEW
        if (!moduleCell || !isGardenModule(moduleCell) || !isValidYear(y)) return; // NEW
        model.beginUpdate(); // NEW
        try { // NEW
            setModuleCurrentYear(moduleCell, y); // NEW
        } finally { // NEW
            model.endUpdate(); // NEW
        } // NEW
        applyYearVisibilityToModule(moduleCell, y); // NEW
    } // NEW

    function selectedGardenModuleForToolbar() { // NEW
        const selected = graph.getSelectionCells ? (graph.getSelectionCells() || []) : [graph.getSelectionCell && graph.getSelectionCell()].filter(Boolean); // NEW
        for (const cell of selected) { // NEW
            const moduleCell = isGardenModule(cell) ? cell : findGardenModuleAncestor(graph, cell); // NEW
            if (moduleCell) return moduleCell; // NEW
        } // NEW
        return null; // NEW
    } // NEW

    function createToolbarButton(label, title) { // NEW
        const btn = document.createElement("button"); // NEW
        btn.type = "button"; // NEW
        btn.textContent = label; // NEW
        btn.title = title || label; // NEW
        btn.style.height = BTN_SIZE + "px"; // NEW
        btn.style.border = "1px solid #777"; // NEW
        btn.style.borderRadius = "6px"; // NEW
        btn.style.background = "#fff"; // NEW
        btn.style.cursor = "pointer"; // NEW
        btn.style.padding = "0 8px"; // NEW
        btn.style.fontFamily = "Arial"; // NEW
        btn.style.fontSize = "12px"; // NEW
        btn.style.whiteSpace = "nowrap"; // NEW
        btn.style.boxSizing = "border-box"; // NEW
        return btn; // NEW
    } // NEW

    function createYearButton(label, title) { // NEW
        const btn = createToolbarButton(label, title); // NEW
        btn.style.width = BTN_SIZE + "px"; // NEW
        btn.style.padding = "0"; // NEW
        return btn; // NEW
    } // NEW

    function openIrrigationPlannerForModule(moduleCell) { // NEW
        if (!moduleCell) return; // NEW
        const plannerApi = graph && graph.__trellisIrrigationPlanner; // NEW
        if (!plannerApi || typeof plannerApi.openIrrigationMode !== "function") return; // NEW
        plannerApi.openIrrigationMode(moduleCell, { preserveViewport: true }); // NEW
    } // NEW

    function trellisUsersApi() { // NEW
        return window.Trellis && window.Trellis.users; // NEW
    } // NEW

    function selectedCellsForShare() { // NEW
        return graph.getSelectionCells ? (graph.getSelectionCells() || []) : []; // NEW
    } // NEW

    function shareSelectionState() { // NEW
        const users = trellisUsersApi(); // NEW
        if (!users || typeof users.getEligibleShareScopes !== "function") return { ok: false, reason: "Trellis Users is unavailable." }; // NEW
        return users.getEligibleShareScopes(selectedCellsForShare()); // NEW
    } // NEW

    function setButtonDisabled(button, disabled, title) { // NEW
        if (!button) return; // NEW
        button.disabled = !!disabled; // NEW
        button.title = title || button.title || ""; // NEW
        button.style.opacity = disabled ? "0.45" : "1"; // NEW
        button.style.cursor = disabled ? "not-allowed" : "pointer"; // NEW
    } // NEW

    function alertShareStatus(message) { // NEW
        if (ui && typeof ui.alert === "function") ui.alert(String(message || "")); // NEW
        else window.alert(String(message || "")); // NEW
    } // NEW

    function closeShareDialog(dialog) { // NEW
        if (dialog && dialog.parentNode) dialog.parentNode.removeChild(dialog); // NEW
    } // NEW

    function openShareInviteDialog(scopes, shareInfo) { // NEW
        const users = trellisUsersApi(); // NEW
        const overlay = document.createElement("div"); // NEW
        overlay.style.cssText = "position:fixed;left:0;top:0;right:0;bottom:0;z-index:" + TRELLIS_DIALOG_Z + ";background:rgba(0,0,0,.24);display:flex;align-items:flex-start;justify-content:center;padding-top:80px;box-sizing:border-box;"; // CHANGE
        const box = document.createElement("div"); // NEW
        box.style.cssText = "width:420px;max-width:calc(100vw - 32px);background:#fff;border:1px solid #111;border-radius:6px;box-shadow:0 10px 28px rgba(0,0,0,.28);padding:14px;font:13px Arial,sans-serif;box-sizing:border-box;"; // NEW
        const title = document.createElement("div"); // NEW
        title.textContent = "Share garden canvas"; // NEW
        title.style.cssText = "font-weight:700;font-size:15px;margin-bottom:8px;"; // NEW
        const scopeText = document.createElement("div"); // NEW
        scopeText.style.cssText = "color:#4B5563;margin-bottom:8px;line-height:18px;"; // NEW
        scopeText.textContent = "Sharing: " + scopes.map(function (scope) { return scope.label; }).join(", "); // NEW
        const email = document.createElement("input"); // NEW
        email.type = "email"; // NEW
        email.placeholder = "Recipient email"; // NEW
        email.style.cssText = "box-sizing:border-box;width:100%;padding:6px 8px;border:1px solid #D1D5DB;border-radius:4px;font:13px Arial,sans-serif;margin-bottom:10px;"; // NEW
        const preset = document.createElement("select"); // NEW
        preset.style.cssText = "box-sizing:border-box;width:100%;padding:6px 8px;border:1px solid #D1D5DB;border-radius:4px;font:13px Arial,sans-serif;margin-bottom:8px;"; // NEW
        ["viewer", "grower", "task", "manager"].forEach(function (value) { // NEW
            const option = document.createElement("option"); // NEW
            option.value = value; // NEW
            option.textContent = value.charAt(0).toUpperCase() + value.slice(1); // NEW
            preset.appendChild(option); // NEW
        }); // NEW
        preset.value = "viewer"; // NEW
        const presetCaps = { viewer: [], grower: ["create_plantings", "manage_own_plantings"], task: ["move_tasks", "edit_task_details"], manager: ["create_plantings", "manage_own_plantings", "move_tasks", "edit_task_details", "manage_scope_content", "manage_access"] }; // NEW
        const capabilityLabels = { create_plantings: "Create plantings", manage_own_plantings: "Manage own plantings", move_tasks: "Move tasks", edit_task_details: "Edit task details", manage_scope_content: "Manage scope content", manage_access: "Manage access" }; // NEW
        const capabilityWrap = document.createElement("div"); // NEW
        capabilityWrap.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:4px 8px;margin-bottom:10px;color:#374151;"; // NEW
        function selectedInviteCapabilities() { // NEW
            return Array.from(capabilityWrap.querySelectorAll("input[type='checkbox']")).filter(function (input) { return input.checked; }).map(function (input) { return input.value; }).sort(); // NEW
        } // NEW
        function renderInviteCapabilities() { // NEW
            capabilityWrap.innerHTML = ""; // NEW
            const active = new Set(presetCaps[preset.value] || []); // NEW
            Object.keys(capabilityLabels).forEach(function (capability) { // NEW
                const label = document.createElement("label"); // NEW
                label.style.cssText = "display:flex;gap:4px;align-items:center;font-size:12px;"; // NEW
                const input = document.createElement("input"); // NEW
                input.type = "checkbox"; // NEW
                input.value = capability; // NEW
                input.checked = active.has(capability); // NEW
                label.appendChild(input); // NEW
                label.appendChild(document.createTextNode(capabilityLabels[capability])); // NEW
                capabilityWrap.appendChild(label); // NEW
            }); // NEW
        } // NEW
        preset.addEventListener("change", renderInviteCapabilities); // NEW
        renderInviteCapabilities(); // NEW
        const status = document.createElement("div"); // NEW
        status.style.cssText = "min-height:18px;color:#4B5563;margin-bottom:8px;"; // NEW
        const buttons = document.createElement("div"); // NEW
        buttons.style.cssText = "display:flex;justify-content:flex-end;gap:8px;"; // NEW
        const cancel = createToolbarButton("Cancel", "Close share dialog"); // NEW
        const send = createToolbarButton("Create Email", "Create invite and open an email draft"); // NEW
        cancel.addEventListener("click", function () { closeShareDialog(overlay); }); // NEW
        send.addEventListener("click", function () { // NEW
            const result = users.createPendingInvite({ email: email.value, scopeCellIds: scopes.map(function (scope) { return scope.id; }), preset: preset.value, capabilities: selectedInviteCapabilities(), shareInfo }); // CHANGE
            if (!result.ok) { status.textContent = result.reason; return; } // NEW
            const bridge = window.trellisShare; // NEW
            bridge.openEmailDraft(result.emailDraft).then(function (draftResult) { // NEW
                if (!draftResult || draftResult.ok === false) { status.textContent = (draftResult && draftResult.reason) || "Email draft could not be opened."; return; } // NEW
                closeShareDialog(overlay); // NEW
            }).catch(function (err) { status.textContent = err && err.message ? err.message : String(err); }); // NEW
        }); // NEW
        buttons.appendChild(cancel); // NEW
        buttons.appendChild(send); // NEW
        box.appendChild(title); // NEW
        box.appendChild(scopeText); // NEW
        box.appendChild(email); // NEW
        box.appendChild(preset); // NEW
        box.appendChild(capabilityWrap); // NEW
        box.appendChild(status); // NEW
        box.appendChild(buttons); // NEW
        overlay.appendChild(box); // NEW
        document.body.appendChild(overlay); // NEW
        email.focus(); // NEW
    } // NEW

    function openEnableUsersForShareDialog() { // NEW
        const users = trellisUsersApi(); // NEW
        const overlay = document.createElement("div"); // NEW
        overlay.style.cssText = "position:fixed;left:0;top:0;right:0;bottom:0;z-index:" + TRELLIS_DIALOG_Z + ";background:rgba(0,0,0,.24);display:flex;align-items:flex-start;justify-content:center;padding-top:80px;box-sizing:border-box;"; // CHANGE
        const box = document.createElement("div"); // NEW
        box.style.cssText = "width:380px;max-width:calc(100vw - 32px);background:#fff;border:1px solid #111;border-radius:6px;box-shadow:0 10px 28px rgba(0,0,0,.28);padding:14px;font:13px Arial,sans-serif;box-sizing:border-box;"; // NEW
        const title = document.createElement("div"); // NEW
        title.textContent = "Enable users"; // NEW
        title.style.cssText = "font-weight:700;font-size:15px;margin-bottom:8px;"; // NEW
        const hint = document.createElement("div"); // NEW
        hint.textContent = "Create the first admin before sharing selected garden scopes."; // NEW
        hint.style.cssText = "color:#4B5563;margin-bottom:8px;"; // NEW
        const name = document.createElement("input"); // NEW
        name.type = "text"; // NEW
        name.placeholder = "Admin name"; // NEW
        const pin = document.createElement("input"); // NEW
        pin.type = "password"; // NEW
        pin.placeholder = "PIN"; // NEW
        [name, pin].forEach(function (input) { input.style.cssText = "box-sizing:border-box;width:100%;padding:6px 8px;border:1px solid #D1D5DB;border-radius:4px;font:13px Arial,sans-serif;margin-bottom:8px;"; }); // NEW
        const status = document.createElement("div"); // NEW
        status.style.cssText = "min-height:18px;color:#4B5563;margin-bottom:8px;"; // NEW
        const buttons = document.createElement("div"); // NEW
        buttons.style.cssText = "display:flex;justify-content:flex-end;gap:8px;"; // NEW
        const cancel = createToolbarButton("Cancel", "Close"); // NEW
        const enable = createToolbarButton("Enable", "Enable users and continue sharing"); // NEW
        cancel.addEventListener("click", function () { closeShareDialog(overlay); }); // NEW
        enable.addEventListener("click", function () { // NEW
            const result = users.enableUsers(name.value, pin.value); // NEW
            if (!result.ok) { status.textContent = result.reason; return; } // NEW
            closeShareDialog(overlay); // NEW
            setTimeout(openShareGardenCanvasDialog, 0); // NEW
        }); // NEW
        buttons.appendChild(cancel); // NEW
        buttons.appendChild(enable); // NEW
        box.appendChild(title); // NEW
        box.appendChild(hint); // NEW
        box.appendChild(name); // NEW
        box.appendChild(pin); // NEW
        box.appendChild(status); // NEW
        box.appendChild(buttons); // NEW
        overlay.appendChild(box); // NEW
        document.body.appendChild(overlay); // NEW
        name.focus(); // NEW
    } // NEW

    async function openShareGardenCanvasDialog() { // NEW
        const users = trellisUsersApi(); // NEW
        const state = shareSelectionState(); // NEW
        if (!state.ok) { alertShareStatus(state.reason); return; } // NEW
        if (!users || typeof users.isEnabled !== "function" || !users.isEnabled()) { // NEW
            openEnableUsersForShareDialog(); // CHANGE
            return; // NEW
        } // NEW
        if (!users.isLoggedIn || !users.isLoggedIn()) { alertShareStatus("Log in before sharing this garden canvas."); return; } // NEW
        const permission = users.canInviteScopes(state.cells || selectedCellsForShare()); // NEW
        if (!permission.ok) { alertShareStatus(permission.reason); return; } // NEW
        const bridge = window.trellisShare; // NEW
        if (!bridge || typeof bridge.getSyncthingShareInfo !== "function" || typeof bridge.openEmailDraft !== "function") { // NEW
            alertShareStatus("Syncthing sharing is unavailable in this Trellis build."); // NEW
            return; // NEW
        } // NEW
        let shareInfo; // NEW
        try { shareInfo = await bridge.getSyncthingShareInfo({}); } catch (err) { shareInfo = { ok: false, reason: err && err.message ? err.message : String(err) }; } // NEW
        if (!shareInfo || shareInfo.ok === false) { alertShareStatus((shareInfo && shareInfo.reason) || "Syncthing sharing is unavailable."); return; } // NEW
        if (shareInfo.managed === false) { alertShareStatus(shareInfo.reason || "Move this diagram into a Trellis-managed Syncthing folder before sharing."); return; } // NEW
        openShareInviteDialog(permission.scopes || state.scopes, shareInfo); // NEW
    } // NEW

    function ensureViewportToolbar() { // NEW
        if (viewportToolbar) return viewportToolbar; // NEW
        const host = ensureViewportToolbarHost(); // NEW
        if (!host) return null; // NEW

        const wrap = document.createElement("div"); // NEW
        wrap.className = "trellis-garden-dashboard-toolbar"; // NEW
        wrap.style.position = "fixed"; // CHANGE
        wrap.style.zIndex = String(GRAPH_OVERLAY_Z.CONTROL); // CHANGE
        wrap.style.display = "none"; // NEW
        wrap.style.boxSizing = "border-box"; // NEW
        wrap.style.padding = "8px 12px"; // NEW
        wrap.style.pointerEvents = "none"; // NEW

        const panel = document.createElement("div"); // NEW
        panel.className = "trellis-garden-dashboard-toolbar-panel"; // NEW
        panel.style.display = "flex"; // NEW
        panel.style.flexDirection = "column"; // NEW
        panel.style.gap = "8px"; // NEW
        panel.style.maxWidth = "100%"; // NEW
        panel.style.boxSizing = "border-box"; // NEW
        panel.style.padding = "8px"; // NEW
        panel.style.background = "rgba(255,255,255,0.96)"; // NEW
        panel.style.border = "1px solid #c7c7cc"; // NEW
        panel.style.borderRadius = "6px"; // NEW
        panel.style.boxShadow = "0 2px 10px rgba(0,0,0,0.14)"; // NEW
        panel.style.pointerEvents = "auto"; // NEW

        const controls = document.createElement("div"); // NEW
        controls.className = "trellis-garden-dashboard-toolbar-controls"; // NEW
        controls.style.display = "flex"; // NEW
        controls.style.alignItems = "center"; // NEW
        controls.style.gap = BTN_GAP + "px"; // NEW
        controls.style.flexWrap = "wrap"; // NEW
        controls.style.boxSizing = "border-box"; // NEW

        const prev = createYearButton("<", "Previous year"); // NEW
        const next = createYearButton(">", "Next year"); // NEW
        const yearLabel = document.createElement("div"); // NEW
        yearLabel.className = "trellis-garden-dashboard-year"; // NEW
        yearLabel.style.minWidth = "60px"; // NEW
        yearLabel.style.height = BTN_SIZE + "px"; // NEW
        yearLabel.style.display = "flex"; // NEW
        yearLabel.style.alignItems = "center"; // NEW
        yearLabel.style.justifyContent = "center"; // NEW
        yearLabel.style.fontFamily = "Arial"; // NEW
        yearLabel.style.fontSize = "12px"; // NEW
        yearLabel.style.fontWeight = "700"; // NEW
        yearLabel.style.padding = "0 6px"; // NEW
        yearLabel.style.border = "1px solid #777"; // NEW
        yearLabel.style.borderRadius = "6px"; // NEW
        yearLabel.style.background = "#fff"; // NEW
        yearLabel.style.boxSizing = "border-box"; // NEW

        const planBtn = createToolbarButton("Plan", "Open the year planner"); // NEW
        const equipmentBtn = createToolbarButton("Equipment", "Open garden equipment"); // NEW
        const irrigationBtn = createToolbarButton("Irrigation", "Open irrigation planner"); // NEW
        const allocateBtn = createToolbarButton("Allocate", "Allocate the current plan"); // NEW
        const exportBtn = createToolbarButton("Export", "Export dashboard CSV"); // NEW
        const shareBtn = createToolbarButton("Share", "Share selected module(s), task board(s), or garden bed(s)"); // NEW
        const tableBtn = createToolbarButton("Table", "Show dashboard table"); // NEW

        const table = document.createElement("div"); // NEW
        table.className = "trellis-garden-dashboard-table"; // NEW
        table.style.display = "none"; // NEW
        table.style.overflow = "auto"; // NEW
        table.style.maxHeight = "45vh"; // NEW
        table.style.borderTop = "1px solid #ddd"; // NEW
        table.style.paddingTop = "8px"; // NEW
        table.style.boxSizing = "border-box"; // NEW

        controls.appendChild(prev); // NEW
        controls.appendChild(yearLabel); // NEW
        controls.appendChild(next); // NEW
        controls.appendChild(planBtn); // NEW
        controls.appendChild(equipmentBtn); // NEW
        controls.appendChild(irrigationBtn); // NEW
        controls.appendChild(allocateBtn); // NEW
        controls.appendChild(exportBtn); // NEW
        controls.appendChild(shareBtn); // NEW
        controls.appendChild(tableBtn); // NEW
        panel.appendChild(controls); // NEW
        panel.appendChild(table); // NEW
        wrap.appendChild(panel); // NEW
        host.appendChild(wrap); // NEW

        viewportToolbar = { wrap, panel, controls, prev, next, yearLabel, planBtn, equipmentBtn, irrigationBtn, allocateBtn, exportBtn, shareBtn, tableBtn, table }; // CHANGE

        mxEvent.addListener(wrap, "mousedown", function (evt) { mxEvent.consume(evt); }); // NEW
        mxEvent.addListener(wrap, "click", function (evt) { evt.stopPropagation(); }); // NEW

        prev.addEventListener("click", function () { // NEW
            if (!activeToolbarModule) return; // NEW
            setToolbarYear(activeToolbarModule, getToolbarYear(activeToolbarModule) - 1); // NEW
            renderViewportToolbar(activeToolbarModule); // NEW
        }); // NEW
        next.addEventListener("click", function () { // NEW
            if (!activeToolbarModule) return; // NEW
            setToolbarYear(activeToolbarModule, getToolbarYear(activeToolbarModule) + 1); // NEW
            renderViewportToolbar(activeToolbarModule); // NEW
        }); // NEW
        planBtn.addEventListener("click", function () { // NEW
            if (!activeToolbarModule) return; // NEW
            const year = getToolbarYear(activeToolbarModule); // NEW
            setToolbarYear(activeToolbarModule, year); // NEW
            try { window.dispatchEvent(new CustomEvent(PLAN_YEAR_EVENT, { detail: { moduleCellId: cellId(activeToolbarModule), year } })); } catch (_) { } // NEW
        }); // NEW
        equipmentBtn.addEventListener("click", function () { // NEW
            if (!activeToolbarModule) return; // NEW
            const equipmentApi = graph && graph.__trellisEquipment; // NEW
            if (equipmentApi && typeof equipmentApi.openDialog === "function") equipmentApi.openDialog(activeToolbarModule); // NEW
        }); // NEW
        irrigationBtn.addEventListener("click", function () { openIrrigationPlannerForModule(activeToolbarModule); }); // NEW
        allocateBtn.addEventListener("click", function () { // NEW
            if (!activeToolbarModule) return; // NEW
            const year = getToolbarYear(activeToolbarModule); // NEW
            setToolbarYear(activeToolbarModule, year); // NEW
            try { window.dispatchEvent(new CustomEvent(ALLOCATE_PLAN_EVENT, { detail: { moduleCellId: cellId(activeToolbarModule), year } })); } catch (_) { } // NEW
        }); // NEW
        exportBtn.addEventListener("click", function () { // NEW
            if (!activeToolbarModule) return; // NEW
            const year = getToolbarYear(activeToolbarModule); // NEW
            const metrics = computeModuleMetrics(activeToolbarModule, year); // NEW
            const safeName = String(metrics.moduleName || "garden").replace(/[^\w\-]+/g, "_").slice(0, 60); // NEW
            downloadCsv(`${safeName}_${year}_dashboard.csv`, buildDashboardCsvSingleTable(metrics, year)); // NEW
        }); // NEW
        shareBtn.addEventListener("click", function () { openShareGardenCanvasDialog(); }); // NEW
        tableBtn.addEventListener("click", function () { // NEW
            if (!activeToolbarModule) return; // NEW
            const key = cellId(activeToolbarModule); // NEW
            toolbarExpandedByModuleId.set(key, toolbarExpandedByModuleId.get(key) !== true); // NEW
            renderViewportToolbar(activeToolbarModule); // NEW
        }); // NEW

        return viewportToolbar; // NEW
    } // NEW

    function positionViewportToolbar(entry) { // NEW
        const host = getViewportToolbarContainer(); // CHANGE
        if (!entry || !host) return; // NEW
        const rect = host.getBoundingClientRect ? host.getBoundingClientRect() : { left: 0, top: 0 }; // CHANGE
        entry.wrap.style.left = Math.round(rect.left || 0) + "px"; // CHANGE
        entry.wrap.style.top = Math.round(rect.top || 0) + "px"; // CHANGE
        entry.wrap.style.width = Math.max(0, Math.round(viewportToolbarWidth(host))) + "px"; // NEW
    } // NEW

    function renderViewportToolbar(moduleCell) { // NEW
        const entry = ensureViewportToolbar(); // NEW
        if (!entry || !moduleCell) return; // NEW
        const year = getToolbarYear(moduleCell); // NEW
        const expanded = toolbarExpandedByModuleId.get(cellId(moduleCell)) === true; // NEW
        entry.yearLabel.textContent = String(year); // NEW
        entry.tableBtn.textContent = expanded ? "Hide Table" : "Table"; // NEW
        entry.tableBtn.title = expanded ? "Hide dashboard table" : "Show dashboard table"; // NEW
        const shareState = shareSelectionState(); // NEW
        setButtonDisabled(entry.shareBtn, !shareState.ok, shareState.ok ? "Share selected scope(s)" : shareState.reason); // NEW
        entry.table.style.display = expanded ? "block" : "none"; // NEW
        if (expanded) { // NEW
            entry.table.innerHTML = formatOverlayTableHtml(computeModuleMetrics(moduleCell, year), year); // NEW
            const irrigationSummary = entry.table.querySelector(".trellis-irrigation-dashboard-summary"); // NEW
            if (irrigationSummary) { // NEW
                irrigationSummary.addEventListener("click", function (ev) { // NEW
                    ev.preventDefault(); // NEW
                    ev.stopPropagation(); // NEW
                    openIrrigationPlannerForModule(moduleCell); // NEW
                }); // NEW
            } // NEW
        } else { // NEW
            entry.table.innerHTML = ""; // NEW
        } // NEW
        entry.wrap.style.display = "block"; // NEW
        positionViewportToolbar(entry); // NEW
    } // NEW

    function hideViewportToolbar() { // NEW
        if (viewportToolbar) viewportToolbar.wrap.style.display = "none"; // NEW
        activeToolbarModule = null; // NEW
    } // NEW

    function refreshViewportToolbarForSelection() { // NEW
        toolbarRefreshTimer = null; // NEW
        const moduleCell = selectedGardenModuleForToolbar(); // NEW
        if (!moduleCell) { hideViewportToolbar(); return; } // NEW
        activeToolbarModule = moduleCell; // NEW
        renderViewportToolbar(moduleCell); // NEW
    } // NEW

    function scheduleViewportToolbarRefresh() { // NEW
        if (toolbarRefreshTimer) return; // NEW
        toolbarRefreshTimer = setTimeout(refreshViewportToolbarForSelection, 0); // NEW
    } // NEW

    function openIrrigationPlannerForDashboard(dashCell) { // NEW
        const moduleCell = findModuleAncestor(graph, dashCell); // NEW
        if (!moduleCell) return; // NEW
        const plannerApi = graph && graph.__trellisIrrigationPlanner; // NEW
        if (!plannerApi || typeof plannerApi.openIrrigationMode !== "function") return; // CHANGE
        plannerApi.openIrrigationMode(moduleCell, { preserveViewport: true }); // CHANGE
    } // NEW

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
        wrap.style.zIndex = String(GRAPH_OVERLAY_Z.CONTROL); // CHANGE
        wrap.style.pointerEvents = "none"; // CHANGE
        wrap.style.boxSizing = "border-box";
        wrap.style.padding = "0";
        wrap.style.overflow = "hidden";

        // Visual: keep overlay readable but inside the cell bounds 
        wrap.style.background = "rgba(255,255,255,0.0)";

        const uiScaleBox = document.createElement("div"); // CHANGE
        uiScaleBox.style.position = "absolute"; // CHANGE
        uiScaleBox.style.left = "0"; // CHANGE
        uiScaleBox.style.top = "0"; // CHANGE
        uiScaleBox.style.display = "flex"; // CHANGE
        uiScaleBox.style.flexDirection = "column"; // CHANGE
        uiScaleBox.style.boxSizing = "border-box"; // CHANGE
        uiScaleBox.style.transformOrigin = "top left"; // CHANGE
        uiScaleBox.style.pointerEvents = "none"; // CHANGE

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
        header.style.pointerEvents = "none"; // CHANGE

        // Header bar button layout
        const leftBar = document.createElement("div");
        leftBar.style.display = "flex";
        leftBar.style.alignItems = "center";
        leftBar.style.pointerEvents = "none"; // CHANGE

        const centerBar = document.createElement("div");
        centerBar.style.display = "flex";
        centerBar.style.alignItems = "center";
        centerBar.style.justifyContent = "center";
        centerBar.style.flex = "1 1 auto";
        centerBar.style.pointerEvents = "none"; // CHANGE

        const rightBar = document.createElement("div");
        rightBar.style.display = "flex";
        rightBar.style.alignItems = "center";
        rightBar.style.justifyContent = "flex-end";
        rightBar.style.pointerEvents = "none"; // CHANGE

        const contentViewport = document.createElement("div");
        contentViewport.style.flex = "1 1 auto";
        contentViewport.style.minHeight = "0";
        contentViewport.style.overflow = "hidden"; // CHANGE
        contentViewport.style.boxSizing = "border-box";
        contentViewport.style.padding = CTRL_PAD + "px";
        contentViewport.style.pointerEvents = "none"; // CHANGE

        contentViewport.style.background = "#fff";
        contentViewport.style.border = "1px solid #999";
        contentViewport.style.borderRadius = "6px";

        const mkBtn = (txt) => {
            const b = document.createElement("button");
            b.textContent = txt;
            b.style.width = BTN_SIZE + "px";
            b.style.height = BTN_SIZE + "px";
            b.style.border = "1px solid #777";
            b.style.borderRadius = "6px";
            b.style.background = "#fff";
            b.style.cursor = "pointer";
            b.style.padding = "0";
            b.style.lineHeight = "1";
            b.style.pointerEvents = "auto"; // CHANGE
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

        const planBtn = document.createElement("button");
        planBtn.textContent = "Plan";
        planBtn.style.height = BTN_SIZE + "px";
        planBtn.style.border = "1px solid #777";
        planBtn.style.borderRadius = "6px";
        planBtn.style.background = "#fff";
        planBtn.style.cursor = "pointer";
        planBtn.style.padding = "0 8px";
        planBtn.style.fontFamily = "Arial";
        planBtn.style.fontSize = "12px";
        planBtn.style.pointerEvents = "auto"; // CHANGE

        const equipmentBtn = document.createElement("button"); // NEW
        equipmentBtn.textContent = "Equipment"; // NEW
        equipmentBtn.style.height = BTN_SIZE + "px"; // NEW
        equipmentBtn.style.border = "1px solid #777"; // NEW
        equipmentBtn.style.borderRadius = "6px"; // NEW
        equipmentBtn.style.background = "#fff"; // NEW
        equipmentBtn.style.cursor = "pointer"; // NEW
        equipmentBtn.style.padding = "0 8px"; // NEW
        equipmentBtn.style.fontFamily = "Arial"; // NEW
        equipmentBtn.style.fontSize = "12px"; // NEW
        equipmentBtn.style.pointerEvents = "auto"; // CHANGE

        const irrigationBtn = document.createElement("button"); // NEW
        irrigationBtn.textContent = "Irrigation"; // NEW
        irrigationBtn.style.height = BTN_SIZE + "px"; // NEW
        irrigationBtn.style.border = "1px solid #777"; // NEW
        irrigationBtn.style.borderRadius = "6px"; // NEW
        irrigationBtn.style.background = "#fff"; // NEW
        irrigationBtn.style.cursor = "pointer"; // NEW
        irrigationBtn.style.padding = "0 8px"; // NEW
        irrigationBtn.style.fontFamily = "Arial"; // NEW
        irrigationBtn.style.fontSize = "12px"; // NEW
        irrigationBtn.style.pointerEvents = "auto"; // NEW

        const allocateBtn = document.createElement("button");
        allocateBtn.textContent = "Allocate";
        allocateBtn.style.height = BTN_SIZE + "px";
        allocateBtn.style.border = "1px solid #777";
        allocateBtn.style.borderRadius = "6px";
        allocateBtn.style.background = "#fff";
        allocateBtn.style.cursor = "pointer";
        allocateBtn.style.padding = "0 8px";
        allocateBtn.style.fontFamily = "Arial";
        allocateBtn.style.fontSize = "12px";
        allocateBtn.style.pointerEvents = "auto"; // CHANGE

        const exportBtn = document.createElement("button");
        exportBtn.textContent = "Export";
        exportBtn.style.height = BTN_SIZE + "px";
        exportBtn.style.border = "1px solid #777";
        exportBtn.style.borderRadius = "6px";
        exportBtn.style.background = "#fff";
        exportBtn.style.cursor = "pointer";
        exportBtn.style.padding = "0 8px";
        exportBtn.style.fontFamily = "Arial";
        exportBtn.style.fontSize = "12px";
        exportBtn.style.pointerEvents = "auto"; // CHANGE

        // Content area 
        const content = document.createElement("div");
        content.style.background = "transparent";
        content.style.border = "0";
        content.style.borderRadius = "0";
        content.style.padding = "0";
        content.style.boxSizing = "border-box";
        content.style.width = "max-content"; // CHANGE
        content.style.pointerEvents = "none"; // CHANGE

        const contentScaleBox = document.createElement("div");
        contentScaleBox.style.width = "max-content"; // CHANGE
        contentScaleBox.style.height = "max-content"; // CHANGE
        contentScaleBox.style.pointerEvents = "none"; // CHANGE


        contentScaleBox.appendChild(content);
        contentViewport.appendChild(contentScaleBox);
        uiScaleBox.appendChild(header); // CHANGE
        uiScaleBox.appendChild(contentViewport); // CHANGE
        wrap.appendChild(uiScaleBox); // CHANGE

        function syncYearLabel() {
            yearLabel.textContent = String(getDashboardYear(dashCell));
        }

        prev.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();

            const moduleCell = findGardenModuleAncestor(graph, dashCell); // CHANGE

            model.beginUpdate();
            try {
                const y = getDashboardYear(dashCell);
                setDashboardYear(dashCell, y - 1, moduleCell); // CHANGE
            } finally {
                model.endUpdate();
            }

            if (moduleCell) applyYearVisibilityToModule(moduleCell, getDashboardYear(dashCell)); // CHANGE

            recomputeAndRenderDashboard(dashCell, { allowGeometryChange: true, preserveWidth: true }); // CHANGE
        });


        next.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();

            const moduleCell = findGardenModuleAncestor(graph, dashCell); // CHANGE

            model.beginUpdate();
            try {
                const y = getDashboardYear(dashCell);
                setDashboardYear(dashCell, y + 1, moduleCell); // CHANGE
            } finally {
                model.endUpdate();
            }

            if (moduleCell) applyYearVisibilityToModule(moduleCell, getDashboardYear(dashCell)); // CHANGE

            recomputeAndRenderDashboard(dashCell, { allowGeometryChange: true, preserveWidth: true }); // CHANGE
        });

        planBtn.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();

            const moduleCell = findModuleAncestor(graph, dashCell);
            if (!moduleCell) return;

            const year = getDashboardYear(dashCell);

            setDashboardYear(dashCell, year, moduleCell); // NEW

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

        equipmentBtn.addEventListener("click", (ev) => { // NEW
            ev.preventDefault(); // NEW
            ev.stopPropagation(); // NEW

            const moduleCell = findModuleAncestor(graph, dashCell); // NEW
            if (!moduleCell) return; // NEW

            const equipmentApi = graph && graph.__trellisEquipment; // NEW
            if (!equipmentApi || typeof equipmentApi.openDialog !== "function") return; // NEW

            equipmentApi.openDialog(moduleCell); // NEW
        }); // NEW

        irrigationBtn.addEventListener("click", (ev) => { // NEW
            ev.preventDefault(); // NEW
            ev.stopPropagation(); // NEW
            openIrrigationPlannerForDashboard(dashCell); // NEW
        }); // NEW

        allocateBtn.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();

            const moduleCell = findModuleAncestor(graph, dashCell);
            if (!moduleCell) return;

            const year = getDashboardYear(dashCell);

            setDashboardYear(dashCell, year, moduleCell); // NEW

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
        rightBar.appendChild(equipmentBtn); // NEW
        rightBar.appendChild(irrigationBtn); // NEW
        rightBar.appendChild(allocateBtn);
        rightBar.appendChild(exportBtn);

        // Mount bars into header
        header.appendChild(leftBar);
        header.appendChild(centerBar);
        header.appendChild(rightBar);


        graph.container.appendChild(wrap);

        const entry = {
            wrap, uiScaleBox, header, // CHANGE
            leftBar, centerBar, rightBar,
            contentViewport, contentScaleBox, content,
            prev, next,
            planBtn, equipmentBtn, allocateBtn, exportBtn, // CHANGE
            yearLabel, syncYearLabel
        };

        overlayByDashId.set(dashId, entry);

        syncYearLabel();
        return entry;
    }

    // -------------------- Zoom Helpers ------------------------------

    function applyDashboardUiScale(entry, dashCell) {
        if (!entry || !entry.uiScaleBox) return; // CHANGE
        const s = getEffectiveDashUiScale(entry, dashCell);
        syncDashboardUiNaturalBox(entry); // CHANGE
        entry.uiScaleBox.style.transformOrigin = "top left"; // CHANGE
        entry.uiScaleBox.style.transform = `scale(${s})`; // CHANGE
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

    function measureHeaderNaturalSize(entry) { // CHANGE
        if (!entry) return { width: 0, height: 0 }; // CHANGE
        const bars = [entry.leftBar, entry.centerBar, entry.rightBar]; // CHANGE
        let width = 2 * CTRL_PAD; // CHANGE
        let height = 0; // CHANGE
        for (const bar of bars) { // CHANGE
            if (!bar) continue; // CHANGE
            width += bar.scrollWidth || bar.offsetWidth || 0; // CHANGE
            height = Math.max(height, bar.scrollHeight || bar.offsetHeight || 0); // CHANGE
        } // CHANGE
        return { width, height: height + (2 * CTRL_PAD) }; // CHANGE
    } // CHANGE

    function measureDashboardUiNaturalSize(entry) { // CHANGE
        if (!entry) return { width: DASH_MIN_W, height: DASH_MIN_W / DASH_DEFAULT_ASPECT }; // CHANGE
        const headerSize = measureHeaderNaturalSize(entry); // CHANGE
        const contentW = getNaturalContentWidthPx(entry); // CHANGE
        const contentH = getNaturalContentHeightPx(entry); // CHANGE
        const viewportW = contentW + (2 * CTRL_PAD) + 2; // CHANGE
        const viewportH = contentH + (2 * CTRL_PAD) + 2; // CHANGE
        return { // CHANGE
            width: Math.max(DASH_MIN_W, Math.ceil(Math.max(headerSize.width, viewportW))), // CHANGE
            height: Math.max(1, Math.ceil(headerSize.height + viewportH)) // CHANGE
        }; // CHANGE
    } // CHANGE

    function syncDashboardUiNaturalBox(entry) { // CHANGE
        if (!entry || !entry.uiScaleBox) return; // CHANGE
        const size = measureDashboardUiNaturalSize(entry); // CHANGE
        const headerH = measureHeaderNaturalSize(entry).height; // CHANGE
        entry.uiScaleBox.style.width = size.width + "px"; // CHANGE
        entry.uiScaleBox.style.height = size.height + "px"; // CHANGE
        if (entry.header) entry.header.style.width = size.width + "px"; // CHANGE
        if (entry.contentViewport) { // CHANGE
            entry.contentViewport.style.width = size.width + "px"; // CHANGE
            entry.contentViewport.style.height = Math.max(0, size.height - headerH) + "px"; // CHANGE
        } // CHANGE
    } // CHANGE

    function getEffectiveDashUiScale(entry, dashCell) { // CHANGE
        const st = dashCell && graph.view.getState(dashCell); // CHANGE
        const size = measureDashboardUiNaturalSize(entry); // CHANGE
        if (!st || !(size.width > 0) || !(size.height > 0)) return 1; // CHANGE
        return Math.min(Math.max(0, st.width) / size.width, Math.max(0, st.height) / size.height); // CHANGE
    } // CHANGE

    function applyScaledHeaderLayout(entry) {
        if (!entry) return;

        const gapPx = BTN_GAP; // CHANGE
        const padPx = CTRL_PAD; // CHANGE

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


    function renderOverlay(dashCell, metrics, year, opts) { // CHANGE
        const entry = ensureOverlay(dashCell);
        entry.syncYearLabel();
        entry.content.innerHTML = formatOverlayTableHtml(metrics, year);
        const irrigationSummary = entry.content.querySelector(".trellis-irrigation-dashboard-summary"); // NEW
        if (irrigationSummary) { // NEW
            irrigationSummary.style.pointerEvents = "auto"; // NEW
            irrigationSummary.addEventListener("click", function (ev) { // NEW
                ev.preventDefault(); // NEW
                ev.stopPropagation(); // NEW
                openIrrigationPlannerForDashboard(dashCell); // NEW
            }); // NEW
        } // NEW
        syncDashboardUiNaturalBox(entry); // CHANGE
        if (opts && opts.allowGeometryChange) { // CHANGE
            model.beginUpdate(); // CHANGE
            try { // CHANGE
                clampDashboardGeometry(dashCell, { preserveArea: !opts.preserveWidth, preserveWidth: !!opts.preserveWidth, allowModuleGrow: true }); // CHANGE
            } finally { // CHANGE
                model.endUpdate(); // CHANGE
            } // CHANGE
        } // CHANGE
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
    function recomputeAndRenderDashboard(dashCell, opts) { // CHANGE
        return; // CHANGE
        if (!dashCell) return;
        const moduleCell = findModuleAncestor(graph, dashCell);
        if (!moduleCell) return;

        const year = getDashboardYear(dashCell);
        const metrics = computeModuleMetrics(moduleCell, year);

        // Render the full UI as a DOM overlay. 
        renderOverlay(dashCell, metrics, year, opts); // CHANGE
    }

    function ensureOverlayForDashboard(dashCell) {
        if (!dashCell) return;
        ensureOverlay(dashCell);
        positionOverlay(dashCell);
    }

    // -------------------- Create dashboard cell --------------------
    function createDashboardCell(moduleCell) {
        return null; // CHANGE
        const parent = moduleCell;

        const x = 20;
        const y = 20;
        const w = 320;
        const h = 220;

        // Safer: use graph.insertVertex which handles value nodes correctly
        const inserted = graph.insertVertex(parent, null, "", x, y, w, h, DASH_STYLE);

        setCellAttr(inserted, DASH_ATTR, "1");

        const initialYear = getModuleCurrentYear(moduleCell) || new Date().getFullYear(); // NEW
        setDashboardYear(inserted, initialYear, moduleCell); // CHANGE
        ensureGardenModuleMinimum(moduleCell); // CHANGE
        applyYearVisibilityToModule(moduleCell, initialYear); // CHANGE

        // Ensure it is visually on top of other children (optional)
        try { graph.orderCells(false, [inserted]); } catch (e) { }

        ensureOverlayForDashboard(inserted);
        recomputeAndRenderDashboard(inserted, { allowGeometryChange: true }); // CHANGE

        return inserted;
    }

    function hasGardenSettingsSet(moduleCell) {
        return !!(moduleCell && moduleCell.getAttribute &&
            (moduleCell.getAttribute("city_id") || moduleCell.getAttribute("city_name")) && // CHANGED
            moduleCell.getAttribute("unit_system"));
    }

    // -------------------- Auto-create dashboard on garden module event -------------------- 
    if (!graph.__gardenDashboardAutoCreateInstalled) {
        graph.__gardenDashboardAutoCreateInstalled = true;

        graph.addListener("usl:gardenModuleNeedsSettings", function (sender, evt) {
            return; // CHANGE
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
    let attachExistingDashboardsOncePending = false; // CHANGE
    let attachExistingDashboardsOnceDone = false; // CHANGE

    function scheduleOverlayReposition() {
        scheduleViewportToolbarRefresh(); // CHANGE
        return; // CHANGE
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

    function collectTouchedDashboards(cells) { // CHANGE
        return []; // CHANGE
        const out = []; // CHANGE
        const seen = new Set(); // CHANGE
        for (const cell of (cells || [])) { // CHANGE
            const dash = isDashboardCell(cell) ? cell : (isGardenModule(cell) ? findDashboardCell(cell) : findDashboardAncestor(cell)); // CHANGE
            if (!dash || seen.has(dash.getId())) continue; // CHANGE
            seen.add(dash.getId()); // CHANGE
            out.push(dash); // CHANGE
        } // CHANGE
        return out; // CHANGE
    } // CHANGE

    graph.addListener(mxEvent.CELLS_MOVED, function (_sender, evt) { // CHANGE
        const dashboards = collectTouchedDashboards(evt.getProperty("cells") || []); // CHANGE
        if (!dashboards.length) return; // CHANGE
        model.beginUpdate(); // CHANGE
        try { // CHANGE
            dashboards.forEach(dash => clampDashboardGeometry(dash, { preserveSize: true, allowModuleGrow: true })); // CHANGE
        } finally { // CHANGE
            model.endUpdate(); // CHANGE
        } // CHANGE
        scheduleOverlayReposition(); // CHANGE
    }); // CHANGE

    graph.addListener(mxEvent.CELLS_RESIZED, function (_sender, evt) { // CHANGE
        const dashboards = collectTouchedDashboards(evt.getProperty("cells") || []); // CHANGE
        if (!dashboards.length) return; // CHANGE
        model.beginUpdate(); // CHANGE
        try { // CHANGE
            dashboards.forEach(dash => clampDashboardGeometry(dash, { preserveArea: false, allowModuleGrow: true })); // CHANGE
        } finally { // CHANGE
            model.endUpdate(); // CHANGE
        } // CHANGE
        scheduleOverlayReposition(); // CHANGE
    }); // CHANGE

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
    graph.getSelectionModel().addListener(mxEvent.CHANGE, function () { // CHANGE
        return; // CHANGE
    });

    // -------------------- Context menu: Create Garden Dashboard --------------------
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

    registerTrellisContextMenuContributor({ // CHANGE
        id: "gardenDashboard", // NEW
        priority: 200, // NEW
        addItems: function (menu, cell, evt) { // CHANGE
            return; // CHANGE

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
        } // CHANGE
    }); // CHANGE

    // -------------------- If dashboards already exist in file, attach overlays --------------------
    function attachExistingDashboards() {
        return; // CHANGE
        const root = model.getRoot();
        const all = getDescendants(root);

        for (const c of all) {
            if (c && c.getAttribute && c.getAttribute(DASH_ATTR) === "1") {
                ensureOverlayForDashboard(c);
                recomputeAndRenderDashboard(c);

                const mod = findGardenModuleAncestor(graph, c); // CHANGE
                if (mod) { // CHANGE
                    const year = getDashboardYear(c); // NEW
                    setDashboardYear(c, year, mod); // NEW
                    applyYearVisibilityToModule(mod, year); // CHANGE
                } // CHANGE
            }
        }

        scheduleOverlayReposition();
    }

    function scheduleAttachExistingDashboards() {
        return; // CHANGE
        setTimeout(function () {
            attachExistingDashboards();
        }, 10000);
    }

    if (graph.getSelectionModel && graph.getSelectionModel().addListener) { // NEW
        graph.getSelectionModel().addListener(mxEvent.CHANGE, scheduleViewportToolbarRefresh); // NEW
    } // NEW
    if (model.addListener) { // NEW
        model.addListener(mxEvent.CHANGE, scheduleViewportToolbarRefresh); // NEW
    } // NEW
    window.addEventListener("resize", scheduleViewportToolbarRefresh); // NEW
    const viewportToolbarHost = getViewportToolbarContainer(); // CHANGE
    if (viewportToolbarHost && viewportToolbarHost.addEventListener) { // NEW
        viewportToolbarHost.addEventListener("scroll", scheduleViewportToolbarRefresh); // NEW
    } // NEW
    scheduleViewportToolbarRefresh(); // NEW

    scheduleAttachExistingDashboards();

});
