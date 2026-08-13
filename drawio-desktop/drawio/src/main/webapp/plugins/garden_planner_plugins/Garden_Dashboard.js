/**
 * Draw.io Plugin: Garden Dashboard (Garden-Module Viewport Toolbar)
 *
 * Features:
 * - Floating garden-relative toolbar appears when a garden module or descendant is selected
 * - Dashboard table is an expandable viewport overlay section, collapsed by default
 * - Prev/Next year buttons + current year label are stored on the garden module
 * - Metrics are computed from tiler groups under that module
 * - Only includes crops that begin in selected year (season_start_year == selected year)
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

    const MODULE_CURRENT_YEAR_ATTR = "current_year";
    const YEAR_HIDDEN_ATTR = "year_hidden";
    const PLAN_YEAR_JSON_ATTR = "plan_year_json";

    const BTN_SIZE = 22;
    const BTN_GAP = 6;
    const GARDEN_PICKER_NO_CITY = "No city";
    const DEFAULT_MODULE_WIDTH = 160;
    const DEFAULT_MODULE_HEIGHT = 100;

    const PLAN_YEAR_EVENT = "usl:planYearRequested";
    const ALLOCATE_PLAN_EVENT = "usl:allocatePlanRequested";
    const IRRIGATION_MODE_CHANGED_EVENT = "trellisIrrigationModeChanged";
    const ALLOCATE_NO_PLAN_TITLE = "Create a year plan before allocating."; // CHANGE: explain why Allocate is disabled before a saved plan exists.
    const ALLOCATE_EMPTY_PLAN_TITLE = "Add at least one crop to the year plan before allocating."; // CHANGE: saved empty plans are not allocatable.
    const IRRIGATION_ACTIVE_BACKGROUND = "#eff6ff"; // CHANGE: match the Enter Irrigation Design Mode light-blue active fill
    const IRRIGATION_ACTIVE_TEXT = "#1e3a8a"; // CHANGE: match the Enter Irrigation Design Mode dark-blue active text
    const WORKSPACE_TASK_BOARD_STORAGE_PREFIX = "trellis.gardenDashboard.workspaceTaskBoard.v1"; // NEW: local per-user workspace task-board memory
    const WORKSPACE_DISABLED_TITLE = "Return to Garden workspace before using garden tools."; // NEW: explain visible disabled dashboard actions outside Garden
    const TASK_BOARD_KEY = "KANBAN_BOARD"; // NEW: dashboard selector sync recognizes current task board cells locally
    const LEGACY_TASK_BOARD_KEY = "MAIN_KANBAN_BOARD"; // NEW: preserve selector sync for legacy main board cells

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

    function isTeamModule(cell) {
        return !!(cell && cell.getAttribute && cell.getAttribute("team_module") === "1");
    }

    function isTaskBoard(cell) {
        const key = getCellAttr(cell, "board_key", "");
        return key === TASK_BOARD_KEY || key === LEGACY_TASK_BOARD_KEY; // NEW: mirror task manager board recognition without coupling APIs
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

    function findTaskBoardAncestor(cell) {
        let cur = cell;
        while (cur) {
            if (isTaskBoard(cur)) return cur;
            cur = model.getParent(cur);
        }
        return null; // NEW
    }

    function findTeamModuleAncestor(graph, cell) {
        const m = graph.getModel();
        let cur = cell;
        while (cur) {
            if (isTeamModule(cur)) return cur;
            cur = m.getParent(cur);
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

    function allocationPlanStatus(moduleCell, year) {
        const planObj = getPlanYearObject(moduleCell, year);
        if (!planObj) return { enabled: false, title: ALLOCATE_NO_PLAN_TITLE }; // CHANGE: Allocate requires a saved plan for the selected toolbar year.
        const crops = Array.isArray(planObj.crops) ? planObj.crops : [];
        return crops.length
            ? { enabled: true, title: "Allocate the current plan" }
            : { enabled: false, title: ALLOCATE_EMPTY_PLAN_TITLE }; // CHANGE: a saved empty plan still has no allocatable crop plan.
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
        const cards = all.filter(isKanbanCard).concat(collectLinkedTaskBoardCards(moduleCell)); // CHANGE: companion Task modules are outside the garden module tree

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
    const taskBoardSelectionByPreferenceKey = new Map(); // CHANGE: board memory is keyed by user/shared local preference
    let viewportToolbar = null;
    let activeToolbarModule = null;
    let toolbarRefreshTimer = null;
    let gardenPickerOpen = false;
    let gardenPickerSearchText = "";
    let lastToolbarContext = null;
    let startupGardenFocusDone = false;

    function dashboardDiagramIsOpen() {
        return !!(ui && typeof ui.getCurrentFile === "function" && ui.getCurrentFile());
    }

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

    function plainTextLabel(raw, fallback) {
        const value = String(raw == null ? "" : raw);
        if (document && document.createElement) {
            const holder = document.createElement("div");
            holder.innerHTML = value;
            const text = String(holder.textContent || "").replace(/\s+/g, " ").trim();
            if (text) return text;
        }
        const stripped = value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        return stripped || fallback || "";
    }

    function gardenLabel(moduleCell) {
        const raw = getCellAttr(moduleCell, "label", "") || (typeof (moduleCell && moduleCell.value) === "string" ? moduleCell.value : "");
        return plainTextLabel(raw, "Garden Module") || cellId(moduleCell) || "Garden Module";
    }

    function gardenCity(moduleCell) {
        return plainTextLabel(getCellAttr(moduleCell, "city_name", "") || getCellAttr(moduleCell, "city_id", ""), "");
    }

    function allModelCells() {
        const root = model.getRoot && model.getRoot();
        const fromMap = model.cells ? Object.values(model.cells) : [];
        if (fromMap.length) return fromMap;
        return getDescendants(root);
    }

    function collectGardenModules() {
        const seen = new Set();
        const gardens = [];
        for (const cell of allModelCells()) {
            const id = cellId(cell);
            if (!id || seen.has(id) || !isGardenModule(cell)) continue;
            seen.add(id);
            gardens.push(cell);
        }
        return gardens;
    }

    function linkIdSet(cell) {
        return new Set(String(getCellAttr(cell, "linkedTo", "") || "").split(",").map(function (part) { return part.trim(); }).filter(Boolean));
    }

    function linkedGardenModulesForCompanion(moduleCell) {
        if (!moduleCell) return [];
        const ids = linkIdSet(moduleCell);
        const typedGardenId = getCellAttr(moduleCell, "trellis_garden_module_id", "");
        if (typedGardenId) ids.add(typedGardenId);
        const seen = new Set();
        const gardens = [];
        ids.forEach(function (id) {
            const garden = id && model.getCell ? model.getCell(id) : null;
            const gardenId = cellId(garden);
            if (!gardenId || seen.has(gardenId) || !isGardenModule(garden)) return;
            seen.add(gardenId);
            gardens.push(garden);
        });
        return sortGardensForPicker(gardens);
    }

    function resolvedGardenCandidatesForCell(cell) {
        const moduleCell = isGardenModule(cell) ? cell : findGardenModuleAncestor(graph, cell);
        if (moduleCell) return [moduleCell];
        const taskModule = isTaskModule(cell) ? cell : findTaskModuleAncestor(graph, cell);
        if (taskModule) return linkedGardenModulesForCompanion(taskModule);
        const teamModule = isTeamModule(cell) ? cell : findTeamModuleAncestor(graph, cell);
        if (teamModule) return linkedGardenModulesForCompanion(teamModule);
        return [];
    }

    function selectedCellsForDashboard() {
        const selected = graph.getSelectionCells ? (graph.getSelectionCells() || []) : [graph.getSelectionCell && graph.getSelectionCell()].filter(Boolean);
        return selected.filter(Boolean);
    }

    function uniqueGardenList(gardens) {
        const seen = new Set();
        const out = [];
        for (const garden of (gardens || [])) {
            const id = cellId(garden);
            if (!id || seen.has(id) || !isGardenModule(garden)) continue;
            seen.add(id);
            out.push(garden);
        }
        return out;
    }

    function collectLinkedTaskBoardCards(moduleCell) {
        const api = taskManagerApi();
        if (!api || typeof api.listBoardsForGarden !== "function") return []; // NEW: task year filtering is best-effort when the task manager is unavailable
        const cards = [];
        const seen = new Set();
        (api.listBoardsForGarden(moduleCell) || []).forEach(function (board) {
            getDescendants(board).forEach(function (cell) {
                const id = cellId(cell);
                if (!isKanbanCard(cell) || (id && seen.has(id))) return;
                if (id) seen.add(id);
                cards.push(cell);
            });
        });
        return cards;
    }

    function sortGardensForPicker(gardens) {
        return uniqueGardenList(gardens).sort(function (left, right) {
            const leftCity = gardenCity(left) || GARDEN_PICKER_NO_CITY;
            const rightCity = gardenCity(right) || GARDEN_PICKER_NO_CITY;
            const leftNoCity = leftCity === GARDEN_PICKER_NO_CITY;
            const rightNoCity = rightCity === GARDEN_PICKER_NO_CITY;
            if (leftNoCity !== rightNoCity) return leftNoCity ? 1 : -1;
            const cityCmp = leftCity.localeCompare(rightCity);
            if (cityCmp) return cityCmp;
            return gardenLabel(left).localeCompare(gardenLabel(right));
        });
    }

    function resolveDashboardToolbarContext() {
        const allGardens = sortGardensForPicker(collectGardenModules());
        const selected = selectedCellsForDashboard();
        if (!selected.length) return { moduleCell: null, candidates: allGardens, allGardens, reason: "none" };

        const resolved = [];
        const ambiguous = [];
        for (const cell of selected) {
            const candidates = resolvedGardenCandidatesForCell(cell);
            if (candidates.length === 1) resolved.push(candidates[0]);
            else if (candidates.length > 1) ambiguous.push(candidates);
            else return { moduleCell: null, candidates: allGardens, allGardens, reason: "unrelated" };
        }

        if (ambiguous.length) {
            const filtered = ambiguous.length === 1 ? ambiguous[0] : allGardens;
            return { moduleCell: null, candidates: sortGardensForPicker(filtered), allGardens, reason: "ambiguous" };
        }

        const unique = uniqueGardenList(resolved);
        if (unique.length === 1) return { moduleCell: unique[0], candidates: allGardens, allGardens, reason: "selected" };
        return { moduleCell: null, candidates: allGardens, allGardens, reason: "mixed" };
    }

    function selectedGardenModuleForToolbar() {
        return resolveDashboardToolbarContext().moduleCell;
    }

    function selectedCellIsGardenRelated() {
        return !!selectedGardenModuleForToolbar();
    }

    function modulesApi() {
        return graph && graph.__trellisModules; // NEW: workspace switching repairs companion modules through the existing Modules API
    }

    function localStorageSafe() {
        try { return typeof window !== "undefined" && window.localStorage ? window.localStorage : null; } catch (_) { return null; } // NEW: local workspace memory must fail closed
    }

    function workspaceUserScopeKey() {
        const users = window.Trellis && window.Trellis.users;
        const current = users && typeof users.getCurrentUser === "function" ? users.getCurrentUser() : null;
        return current && current.id ? "user:" + current.id : "shared"; // NEW: shared fallback keeps preferences useful without login
    }

    function taskBoardPreferenceKey(moduleCell) {
        return WORKSPACE_TASK_BOARD_STORAGE_PREFIX + ":" + workspaceUserScopeKey() + ":" + cellId(moduleCell); // NEW
    }

    function loadRememberedTaskBoardId(moduleCell) {
        const key = taskBoardPreferenceKey(moduleCell);
        if (!key) return "";
        if (taskBoardSelectionByPreferenceKey.has(key)) return taskBoardSelectionByPreferenceKey.get(key) || ""; // NEW
        const store = localStorageSafe();
        let value = "";
        if (store) {
            try { value = String(store.getItem(key) || ""); } catch (_) { value = ""; }
        }
        taskBoardSelectionByPreferenceKey.set(key, value);
        return value;
    }

    function saveRememberedTaskBoardId(moduleCell, boardId) {
        const key = taskBoardPreferenceKey(moduleCell);
        const value = String(boardId || "");
        if (!key || !value) return;
        taskBoardSelectionByPreferenceKey.set(key, value); // NEW
        const store = localStorageSafe();
        if (store) {
            try { store.setItem(key, value); } catch (_) { }
        }
    }

    function getSelectedWorkspaceForCell(cell) {
        if (!cell) return null;
        if (isGardenModule(cell) || findGardenModuleAncestor(graph, cell)) return "garden"; // NEW
        if (isTaskModule(cell) || findTaskModuleAncestor(graph, cell)) return "tasks"; // NEW
        if (isTeamModule(cell) || findTeamModuleAncestor(graph, cell)) return "team"; // NEW
        return null;
    }

    function getActiveWorkspaceForSelection() {
        const selected = selectedCellsForDashboard();
        if (!selected.length) return null;
        const workspaces = new Set();
        selected.forEach(function (cell) {
            const workspace = getSelectedWorkspaceForCell(cell);
            if (workspace) workspaces.add(workspace);
        });
        return workspaces.size === 1 ? Array.from(workspaces)[0] : null; // NEW: mixed selections do not claim an active workspace
    }

    function selectedTaskBoardIdForSelection() {
        const selected = selectedCellsForDashboard();
        if (!selected.length) return "";
        let selectedBoardId = "";
        for (const cell of selected) {
            const board = findTaskBoardAncestor(cell);
            const id = cellId(board);
            if (!id) return ""; // NEW: strict sync requires every selected item to resolve to a board
            if (selectedBoardId && selectedBoardId !== id) return ""; // NEW: mixed-board selections leave the chooser on remembered/current fallback
            selectedBoardId = id;
        }
        return selectedBoardId; // NEW
    }

    function cellBoundsInModel(cell) {
        const state = graph.view && graph.view.getState ? graph.view.getState(cell) : null;
        if (state && Number.isFinite(Number(state.x)) && Number.isFinite(Number(state.y))) {
            const scale = Number(graph.view && graph.view.scale) || 1;
            const translate = graph.view && graph.view.translate ? graph.view.translate : { x: 0, y: 0 };
            return {
                x: Number(state.x) / scale - (Number(translate.x) || 0),
                y: Number(state.y) / scale - (Number(translate.y) || 0),
                width: Math.max(0, (Number(state.width) || 0) / scale),
                height: Math.max(0, (Number(state.height) || 0) / scale)
            };
        }

        const geo = cell && model.getGeometry ? model.getGeometry(cell) : null;
        if (!geo) return null;
        let x = Number(geo.x) || 0;
        let y = Number(geo.y) || 0;
        let parent = model.getParent ? model.getParent(cell) : cell && cell.parent;
        while (parent) {
            const parentGeo = model.getGeometry ? model.getGeometry(parent) : null;
            if (parentGeo) {
                x += Number(parentGeo.x) || 0;
                y += Number(parentGeo.y) || 0;
            }
            parent = model.getParent ? model.getParent(parent) : parent.parent;
        }
        return {
            x,
            y,
            width: Math.max(0, Number(geo.width) || 0),
            height: Math.max(0, Number(geo.height) || 0)
        };
    }

    function zoomGardenToViewport(moduleCell) {
        const bounds = cellBoundsInModel(moduleCell);
        const host = getViewportToolbarContainer();
        if (!bounds || !host || typeof graph.fitWindow !== "function") {
            if (graph.scrollCellToVisible) graph.scrollCellToVisible(moduleCell, true);
            return;
        }
        graph.fitWindow(bounds, 48);
        setTimeout(function () {
            if (graph.view && Number(graph.view.scale) > 1 && graph.zoomTo) graph.zoomTo(1);
        }, 0);
    }

    function selectAndZoomToGarden(moduleCell) {
        if (!moduleCell || !isGardenModule(moduleCell)) return;
        if (graph.setSelectionCell) graph.setSelectionCell(moduleCell);
        zoomGardenToViewport(moduleCell);
    }

    function fitCellToViewport(cell) {
        if (!cell) return;
        const bounds = cellBoundsInModel(cell);
        if (bounds && typeof graph.fitWindow === "function") {
            graph.fitWindow(bounds, 48); // NEW: shared workspace navigation fits nested companion modules and boards
        } else if (graph.scrollCellToVisible) {
            graph.scrollCellToVisible(cell, true);
        }
        setTimeout(function () {
            if (graph.view && Number(graph.view.scale) > 1 && graph.zoomTo) graph.zoomTo(1);
        }, 0);
    }

    function selectAndFitWorkspaceCell(cell) {
        if (!cell) return;
        if (graph.setSelectionCell) graph.setSelectionCell(cell); // NEW
        fitCellToViewport(cell);
    }

    function visualBoundsForPulse(cell) {
        const state = graph.view && graph.view.getState ? graph.view.getState(cell) : null;
        const node = state && state.shape && state.shape.node ? state.shape.node : null;
        if (!node || !node.getBoundingClientRect) return null;
        const rect = node.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return null;
        return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }; // NEW
    }

    function pulseWorkspaceDestination(cell) {
        const host = ensureViewportToolbarHost();
        const bounds = visualBoundsForPulse(cell);
        if (!host || !bounds || !document || !document.createElement) return;
        const pulse = document.createElement("div");
        pulse.className = "trellis-garden-workspace-destination-pulse";
        pulse.style.cssText = "position:fixed;left:" + Math.round(bounds.left - 5) + "px;top:" + Math.round(bounds.top - 5) + "px;width:" + Math.round(bounds.width + 10) + "px;height:" + Math.round(bounds.height + 10) + "px;box-sizing:border-box;border:3px solid #2563eb;border-radius:8px;box-shadow:0 0 0 4px rgba(37,99,235,.16);pointer-events:none;opacity:1;transition:opacity .45s ease;z-index:" + GRAPH_OVERLAY_Z.ANNOTATION + ";"; // NEW
        host.appendChild(pulse);
        setTimeout(function () { pulse.style.opacity = "0"; }, 650);
        setTimeout(function () { if (pulse.parentNode) pulse.parentNode.removeChild(pulse); }, 1150);
    }

    function visibleViewportGardenInsertPoint() {
        const moduleBounds = { width: DEFAULT_MODULE_WIDTH, height: DEFAULT_MODULE_HEIGHT };
        if (graph.getCenterInsertPoint) return graph.getCenterInsertPoint(moduleBounds);
        const host = getViewportToolbarContainer();
        const view = graph.view || {};
        const scale = Number(view.scale) > 0 ? Number(view.scale) : 1;
        const translate = view.translate || { x: 0, y: 0 };
        const scrollLeft = host && Number(host.scrollLeft) || 0;
        const scrollTop = host && Number(host.scrollTop) || 0;
        const width = host && (Number(host.clientWidth) || 0) || 0;
        const height = host && (Number(host.clientHeight) || 0) || 0;
        return {
            x: (scrollLeft + width / 2) / scale - (Number(translate.x) || 0) - moduleBounds.width / 2,
            y: (scrollTop + height / 2) / scale - (Number(translate.y) || 0) - moduleBounds.height / 2
        };
    }

    function createGardenFromDashboard() {
        const modules = graph && graph.__trellisModules;
        if (!modules || typeof modules.createModuleAtPoint !== "function") return;
        const garden = modules.createModuleAtPoint(visibleViewportGardenInsertPoint(), "garden");
        if (garden) selectAndZoomToGarden(garden);
    }

    function runStartupGardenFocusOnce() {
        if (!dashboardDiagramIsOpen()) return;
        if (startupGardenFocusDone) return;
        startupGardenFocusDone = true;
        const gardens = collectGardenModules();
        if (gardens.length !== 1 || selectedCellIsGardenRelated()) return;
        selectAndZoomToGarden(gardens[0]);
    }

    function scheduleStartupGardenFocus() {
        if (!dashboardDiagramIsOpen()) return;
        setTimeout(runStartupGardenFocusOnce, 0);
    }

    function groupedGardensForPicker(gardens, searchText) {
        const query = String(searchText || "").trim().toLocaleLowerCase();
        const visible = sortGardensForPicker(gardens).filter(function (garden) {
            return !query || gardenLabel(garden).toLocaleLowerCase().indexOf(query) >= 0;
        });
        const byCity = new Map();
        for (const garden of visible) {
            const city = gardenCity(garden) || GARDEN_PICKER_NO_CITY;
            if (!byCity.has(city)) byCity.set(city, []);
            byCity.get(city).push(garden);
        }
        return Array.from(byCity.keys()).sort(function (left, right) {
            if (left === GARDEN_PICKER_NO_CITY && right !== GARDEN_PICKER_NO_CITY) return 1;
            if (right === GARDEN_PICKER_NO_CITY && left !== GARDEN_PICKER_NO_CITY) return -1;
            return left.localeCompare(right);
        }).map(function (city) {
            return { city, gardens: byCity.get(city).sort(function (left, right) { return gardenLabel(left).localeCompare(gardenLabel(right)); }) };
        });
    }

    function closeGardenPicker(entry) {
        gardenPickerOpen = false;
        if (entry && entry.gardenPickerPopover) {
            entry.gardenPickerPopover.remove();
            entry.gardenPickerPopover = null;
        }
    }

    function renderGardenPickerPopover(entry, context) {
        if (!entry || !entry.gardenPickerWrap) return;
        if (entry.gardenPickerPopover) entry.gardenPickerPopover.remove();
        if (!gardenPickerOpen) { entry.gardenPickerPopover = null; return; }

        const popover = document.createElement("div");
        popover.className = "trellis-garden-dashboard-picker-popover";
        popover.style.cssText = "position:absolute;left:0;top:calc(100% + 4px);width:280px;max-height:320px;overflow:auto;background:#fff;border:1px solid #9ca3af;border-radius:6px;box-shadow:0 8px 20px rgba(0,0,0,.18);padding:8px;box-sizing:border-box;z-index:" + GRAPH_OVERLAY_Z.CONTROL_TOP + ";";

        const search = document.createElement("input");
        search.type = "search";
        search.className = "trellis-garden-dashboard-garden-search";
        search.placeholder = "Search gardens";
        search.setAttribute("aria-label", "Search gardens");
        search.value = gardenPickerSearchText;
        search.style.cssText = "box-sizing:border-box;width:100%;height:26px;margin-bottom:6px;padding:4px 6px;border:1px solid #9ca3af;border-radius:4px;font:12px Arial,sans-serif;";
        search.addEventListener("input", function () {
            gardenPickerSearchText = search.value || "";
            renderGardenPickerPopover(entry, lastToolbarContext || context || {});
        });
        popover.appendChild(search);

        const candidates = (context && context.candidates) || [];
        const groups = groupedGardensForPicker(candidates, gardenPickerSearchText);
        if (!groups.length) {
            const empty = document.createElement("div");
            empty.className = "trellis-garden-dashboard-picker-empty";
            empty.textContent = "No gardens match the current search.";
            empty.style.cssText = "padding:8px 4px;color:#6b7280;font:12px Arial,sans-serif;";
            popover.appendChild(empty);
        }

        groups.forEach(function (group) {
            const heading = document.createElement("div");
            heading.className = "trellis-garden-dashboard-picker-city";
            heading.textContent = group.city;
            heading.style.cssText = "padding:7px 4px 3px;color:#4b5563;font:700 11px Arial,sans-serif;text-transform:uppercase;";
            popover.appendChild(heading);
            group.gardens.forEach(function (garden) {
                const row = document.createElement("button");
                row.type = "button";
                row.className = "trellis-garden-dashboard-picker-row";
                row.textContent = gardenLabel(garden);
                row.setAttribute("data-garden-cell-id", cellId(garden));
                row.style.cssText = "display:block;width:100%;text-align:left;border:0;background:#fff;border-radius:4px;padding:6px 7px;cursor:pointer;font:12px Arial,sans-serif;color:#111827;";
                row.addEventListener("mouseenter", function () { row.style.background = "#eff6ff"; });
                row.addEventListener("mouseleave", function () { row.style.background = "#fff"; });
                row.addEventListener("click", function (ev) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    closeGardenPicker(entry);
                    selectAndZoomToGarden(garden);
                    scheduleViewportToolbarRefresh();
                });
                popover.appendChild(row);
            });
        });

        entry.gardenPickerWrap.appendChild(popover);
        entry.gardenPickerPopover = popover;
        setTimeout(function () { if (search && typeof search.focus === "function") search.focus(); }, 0);
    }

    function createToolbarButton(label, title, variant) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = label;
        btn.title = title || label;
        const semanticVariant = variant || "neutral";
        if (window.Trellis && window.Trellis.ui && typeof window.Trellis.ui.applyButtonStyle === "function") window.Trellis.ui.applyButtonStyle(btn, semanticVariant, { compact: true, padding: "0 8px" });
        const fallbackColors = { open: "#2563eb", add: "#188038", close: "#b91c1c", danger: "#b91c1c", neutral: "#777" }; // CHANGE
        const dangerFallback = semanticVariant === "danger"; // NEW
        btn.style.height = BTN_SIZE + "px";
        if (!btn.getAttribute("data-trellis-button-variant")) btn.style.border = "1px solid " + (fallbackColors[semanticVariant] || fallbackColors.neutral);
        btn.style.borderRadius = "6px";
        if (!btn.getAttribute("data-trellis-button-variant")) btn.style.background = dangerFallback ? "#b91c1c" : "#fff"; // CHANGE
        if (!btn.getAttribute("data-trellis-button-variant")) btn.style.color = semanticVariant === "open" ? "#1d4ed8" : (semanticVariant === "add" ? "#166534" : (semanticVariant === "close" ? "#b91c1c" : (dangerFallback ? "#fff" : "#000"))); // CHANGE
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

    function createWorkspaceSegment(label, workspace) {
        const btn = createToolbarButton(label, "Open " + label + " workspace", "open"); // NEW
        btn.className = "trellis-garden-workspace-segment trellis-garden-workspace-" + workspace;
        btn.setAttribute("data-workspace", workspace);
        btn.style.position = "relative";
        btn.style.borderRadius = "0";
        btn.style.marginLeft = "-1px";
        btn.style.minWidth = workspace === "garden" ? "58px" : "52px";
        return btn;
    }

    function attachTaskWorkspaceBadge(btn) {
        const badge = document.createElement("span");
        badge.className = "trellis-garden-workspace-task-badge"; // CHANGE: unseen task count now belongs to the Tasks segment
        badge.style.cssText = "display:none;position:absolute;right:-7px;top:-7px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:#dc2626;color:#fff;font:10px Arial,sans-serif;line-height:16px;text-align:center;box-sizing:border-box;";
        btn.appendChild(badge);
        btn.__trellisTaskBadge = badge; // CHANGE: preserve existing badge update path on the new switcher segment
    }

    function createWorkspaceSwitcher() {
        const wrap = document.createElement("div");
        wrap.className = "trellis-garden-workspace-switcher"; // NEW
        wrap.style.display = "inline-flex";
        wrap.style.alignItems = "center";
        wrap.style.gap = "0";
        wrap.style.height = BTN_SIZE + "px";

        const gardenBtn = createWorkspaceSegment("Garden", "garden");
        const tasksBtn = createWorkspaceSegment("Tasks", "tasks");
        const teamBtn = createWorkspaceSegment("Team", "team");
        gardenBtn.style.borderTopLeftRadius = "6px";
        gardenBtn.style.borderBottomLeftRadius = "6px";
        teamBtn.style.borderTopRightRadius = "6px";
        teamBtn.style.borderBottomRightRadius = "6px";
        attachTaskWorkspaceBadge(tasksBtn);
        wrap.appendChild(gardenBtn);
        wrap.appendChild(tasksBtn);
        wrap.appendChild(teamBtn);
        return { wrap, gardenBtn, tasksBtn, teamBtn };
    }

    function createTaskBoardSelect() {
        const select = document.createElement("select");
        select.className = "trellis-task-board-toolbar-selector";
        select.title = "Task Boards"; // CHANGE: visible value is the selected board; tooltip names the chooser
        select.setAttribute("aria-label", "Task Boards"); // NEW
        select.style.height = BTN_SIZE + "px";
        select.style.border = "1px solid #777";
        select.style.borderRadius = "6px";
        select.style.background = "#fff";
        select.style.fontFamily = "Arial";
        select.style.fontSize = "12px";
        select.style.boxSizing = "border-box";
        select.style.maxWidth = "210px";
        ["mousedown", "mouseup", "click", "dblclick", "pointerdown", "pointerup"].forEach(function (type) { select.addEventListener(type, stopToolbarNativeControlEvent); }); // NEW: native selects must keep their default open behavior
        return select;
    }

    function isToolbarNativeControl(target) {
        const tag = target && target.tagName ? String(target.tagName).toUpperCase() : "";
        return tag === "SELECT" || tag === "OPTION" || tag === "INPUT" || tag === "TEXTAREA"; // NEW: form controls need browser-default pointer handling
    }

    function stopToolbarNativeControlEvent(evt) {
        if (evt && evt.stopPropagation) evt.stopPropagation(); // NEW: keep graph gestures out without preventing native control defaults
    }

    function taskManagerApi() {
        return graph && graph.__trellisTaskManager;
    }

    function taskBoardOptionLabel(boardSummary) {
        return String(boardSummary && boardSummary.name || "Kanban"); // CHANGE: the compact chooser displays only the selected board name
    }

    function taskBoardIdInList(boards, boardId) {
        const id = String(boardId || "");
        return !!id && (boards || []).some(function (board) { return cellId(board) === id; }); // NEW
    }

    function selectedTaskBoardIdForGarden(moduleCell, boards, fallbackValue, selectedBoardId) {
        if (taskBoardIdInList(boards, selectedBoardId)) return String(selectedBoardId || ""); // NEW: active board selection takes precedence over stored preference
        const remembered = loadRememberedTaskBoardId(moduleCell);
        if (taskBoardIdInList(boards, remembered)) return remembered; // NEW
        if (taskBoardIdInList(boards, fallbackValue)) return String(fallbackValue || "");
        return boards && boards.length ? cellId(boards[0]) : ""; // CHANGE: main board remains first/default
    }

    function applyWorkspaceSegmentState(btn, active, disabled) {
        if (!btn) return;
        if (window.Trellis && window.Trellis.ui && typeof window.Trellis.ui.applyButtonStyle === "function") window.Trellis.ui.applyButtonStyle(btn, "open", { compact: true, active: !!active }); // NEW
        btn.disabled = !!disabled;
        btn.style.height = BTN_SIZE + "px";
        btn.style.padding = "0 8px";
        btn.style.background = active ? "#eff6ff" : "#fff";
        btn.style.borderColor = active ? "#2563eb" : "#777";
        btn.style.color = active ? "#1e3a8a" : "#1d4ed8";
        btn.style.fontWeight = active ? "700" : "";
        btn.style.opacity = disabled ? "0.45" : "1";
        btn.style.cursor = disabled ? "not-allowed" : "pointer";
        btn.setAttribute("aria-pressed", active ? "true" : "false");
    }

    function ensureWorkspaceTaskModule(moduleCell) {
        const modules = modulesApi();
        if (!moduleCell || !modules || typeof modules.ensureGardenTaskModule !== "function") return null;
        return modules.ensureGardenTaskModule(moduleCell, { createMainBoard: true }); // NEW: switcher repairs/creates missing Task companion on demand
    }

    function ensureWorkspaceTeamModule(moduleCell) {
        const modules = modulesApi();
        if (!moduleCell || !modules || typeof modules.ensureGardenTeamModule !== "function") return null;
        return modules.ensureGardenTeamModule(moduleCell); // NEW: switcher repairs/creates missing Team companion on demand
    }

    function openToolbarTaskBoard(moduleCell, boardId) {
        return openGardenWorkspace(moduleCell, "tasks", boardId); // CHANGE: the Tasks workspace owns board opening
    }

    function openGardenWorkspace(moduleCell, workspace, boardId) {
        if (!moduleCell) return null;
        if (workspace === "garden") {
            selectAndZoomToGarden(moduleCell);
            setTimeout(function () { pulseWorkspaceDestination(moduleCell); }, 0); // NEW
            renderViewportToolbar(moduleCell);
            return moduleCell;
        }
        if (workspace === "team") {
            const teamModule = ensureWorkspaceTeamModule(moduleCell);
            if (teamModule) {
                selectAndFitWorkspaceCell(teamModule);
                setTimeout(function () { pulseWorkspaceDestination(teamModule); }, 0); // NEW
                renderViewportToolbar(moduleCell);
            }
            return teamModule || null;
        }
        if (workspace !== "tasks") return null;
        const taskModule = ensureWorkspaceTaskModule(moduleCell);
        const api = taskManagerApi();
        if (!api || typeof api.openBoardForGarden !== "function") {
            if (taskModule) {
                selectAndFitWorkspaceCell(taskModule);
                setTimeout(function () { pulseWorkspaceDestination(taskModule); }, 0); // NEW
            }
            return taskModule || null;
        }
        const year = getToolbarYear(moduleCell);
        const taskBoards = typeof api.listBoardsForGarden === "function" ? (api.listBoardsForGarden(moduleCell) || []) : [];
        const requestedBoardId = boardId || selectedTaskBoardIdForGarden(moduleCell, taskBoards, "");
        if (requestedBoardId) saveRememberedTaskBoardId(moduleCell, requestedBoardId); // CHANGE
        const openedBoard = api.openBoardForGarden(moduleCell, requestedBoardId, year);
        const openedBoardId = cellId(openedBoard);
        if (openedBoardId) saveRememberedTaskBoardId(moduleCell, openedBoardId); // CHANGE
        if (typeof api.setActiveDashboardContext === "function") api.setActiveDashboardContext(moduleCell, year);
        setTimeout(function () { pulseWorkspaceDestination(openedBoard || taskModule); }, 0); // NEW
        renderViewportToolbar(moduleCell);
        return openedBoard || taskModule || null;
    }

    function activeIrrigationModuleMatches(moduleCell) {
        const plannerApi = graph && graph.__trellisIrrigationPlanner;
        return !!(plannerApi && typeof plannerApi.isIrrigationModeActive === "function" && plannerApi.isIrrigationModeActive(moduleCell));
    }

    function applyToolbarActiveButtonState(btn, active) {
        if (!btn) return;
        if (window.Trellis && window.Trellis.ui && typeof window.Trellis.ui.applyButtonStyle === "function") window.Trellis.ui.applyButtonStyle(btn, "open", { compact: true, active: !!active }); // CHANGE: reuse the shared active open-button style
        btn.style.height = BTN_SIZE + "px"; // CHANGE: preserve dashboard toolbar sizing after shared restyling
        btn.style.padding = "0 8px"; // CHANGE: preserve dashboard toolbar spacing after shared restyling
        btn.style.background = active ? IRRIGATION_ACTIVE_BACKGROUND : "#fff"; // CHANGE: fallback light-blue active fill
        btn.style.borderColor = "#2563eb"; // CHANGE: keep active/inactive open-button border consistent
        btn.style.color = active ? IRRIGATION_ACTIVE_TEXT : "#1d4ed8"; // CHANGE: fallback dark-blue active text
        btn.style.fontWeight = active ? "700" : ""; // CHANGE: match the active overlay-button emphasis
        btn.setAttribute("aria-pressed", active ? "true" : "false"); // CHANGE: expose irrigation mode state on the toggle button
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
        if (title !== undefined) button.title = title;
        button.style.opacity = disabled ? "0.45" : "1";
        button.style.cursor = disabled ? "not-allowed" : "pointer";
    }

    function renderWorkspaceSwitcher(entry, activeWorkspace, taskSummary) {
        if (!entry || !entry.workspaceWrap) return;
        entry.workspaceWrap.style.display = "inline-flex"; // NEW
        applyWorkspaceSegmentState(entry.workspaceGardenBtn, activeWorkspace === "garden", false);
        applyWorkspaceSegmentState(entry.workspaceTasksBtn, activeWorkspace === "tasks", false);
        applyWorkspaceSegmentState(entry.workspaceTeamBtn, activeWorkspace === "team", false);
        const badge = entry.workspaceTasksBtn && entry.workspaceTasksBtn.__trellisTaskBadge;
        const badgeTotal = taskSummary && !taskSummary.hidden ? (Number(taskSummary.total) || 0) : 0;
        if (badge) { badge.style.display = badgeTotal > 0 ? "" : "none"; badge.textContent = String(badgeTotal); } // CHANGE
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

        const gardenName = document.createElement("div");
        gardenName.className = "trellis-garden-dashboard-active-garden";
        gardenName.style.minHeight = BTN_SIZE + "px";
        gardenName.style.display = "flex";
        gardenName.style.alignItems = "center";
        gardenName.style.maxWidth = "230px";
        gardenName.style.overflow = "hidden";
        gardenName.style.textOverflow = "ellipsis";
        gardenName.style.whiteSpace = "nowrap";
        gardenName.style.fontFamily = "Arial";
        gardenName.style.fontSize = "12px";
        gardenName.style.fontWeight = "700";
        gardenName.style.color = "#111827";

        const gardenPickerWrap = document.createElement("div");
        gardenPickerWrap.className = "trellis-garden-dashboard-picker";
        gardenPickerWrap.style.position = "relative";
        gardenPickerWrap.style.display = "none";

        const gardenPickerBtn = createToolbarButton("Select garden...", "Select a garden module", "open");
        gardenPickerBtn.className = "trellis-garden-dashboard-picker-button";

        const createGardenBtn = createToolbarButton("Create Garden", "Create a garden module", "add");
        createGardenBtn.className = "trellis-garden-dashboard-create-garden";
        createGardenBtn.style.display = "none";

        gardenPickerWrap.appendChild(gardenPickerBtn);

        const workspaceSwitcher = createWorkspaceSwitcher(); // NEW
        const workspaceWrap = workspaceSwitcher.wrap; // NEW
        const workspaceGardenBtn = workspaceSwitcher.gardenBtn; // NEW
        const workspaceTasksBtn = workspaceSwitcher.tasksBtn; // NEW
        const workspaceTeamBtn = workspaceSwitcher.teamBtn; // NEW
        const planBtn = createToolbarButton("Plan", "Open the year planner", "open");
        const equipmentBtn = createToolbarButton("Equipment", "Open garden equipment", "open");
        const irrigationBtn = createToolbarButton("Irrigation", "Open irrigation planner", "open");
        const allocateBtn = createToolbarButton("Allocate", "Allocate the current plan", "add");
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

        leftControls.appendChild(gardenName);
        leftControls.appendChild(gardenPickerWrap);
        leftControls.appendChild(createGardenBtn);
        leftControls.appendChild(workspaceWrap);
        leftControls.appendChild(taskBoardSelect);
        leftControls.appendChild(prev);
        leftControls.appendChild(yearLabel);
        leftControls.appendChild(next);
        leftControls.appendChild(planBtn);
        leftControls.appendChild(allocateBtn);
        leftControls.appendChild(irrigationBtn);
        leftControls.appendChild(equipmentBtn);
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

        viewportToolbar = { wrap, panel, controls, leftControls, rightActions, gardenName, gardenPickerWrap, gardenPickerBtn, createGardenBtn, gardenPickerPopover: null, workspaceWrap, workspaceGardenBtn, workspaceTasksBtn, workspaceTeamBtn, prev, next, yearLabel, planBtn, equipmentBtn, irrigationBtn, allocateBtn, taskBoardSelect, messagesBtn, exportBtn, shareBtn, tableBtn, table }; // CHANGE
        [prev, next, planBtn, equipmentBtn, irrigationBtn, allocateBtn, workspaceGardenBtn, workspaceTasksBtn, workspaceTeamBtn, messagesBtn, exportBtn, shareBtn, tableBtn, gardenPickerBtn, createGardenBtn].forEach(function (button) {
            button.__trellisDashboardDefaultTitle = button.title || "";
        });

        mxEvent.addListener(wrap, "mousedown", function (evt) { if (isToolbarNativeControl(evt && evt.target)) { stopToolbarNativeControlEvent(evt); return; } mxEvent.consume(evt); }); // CHANGE: do not block native select opening
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
        workspaceGardenBtn.addEventListener("click", function () { openGardenWorkspace(activeToolbarModule, "garden"); }); // NEW
        workspaceTasksBtn.addEventListener("click", function () { openToolbarTaskBoard(activeToolbarModule, taskBoardSelect.value); }); // CHANGE
        workspaceTeamBtn.addEventListener("click", function () { openGardenWorkspace(activeToolbarModule, "team"); }); // NEW
        taskBoardSelect.addEventListener("change", function () { if (activeToolbarModule && taskBoardSelect.value) { saveRememberedTaskBoardId(activeToolbarModule, taskBoardSelect.value); openToolbarTaskBoard(activeToolbarModule, taskBoardSelect.value); } }); // CHANGE
        gardenPickerBtn.addEventListener("click", function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            gardenPickerOpen = !gardenPickerOpen;
            if (gardenPickerOpen) gardenPickerSearchText = "";
            renderGardenPickerPopover(viewportToolbar, lastToolbarContext || resolveDashboardToolbarContext());
        });
        createGardenBtn.addEventListener("click", function () { createGardenFromDashboard(); });
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

    function setGardenActionControlsDisabled(entry, disabled, title) {
        [entry.planBtn, entry.equipmentBtn, entry.irrigationBtn, entry.allocateBtn, entry.messagesBtn, entry.exportBtn, entry.shareBtn, entry.tableBtn].forEach(function (button) { // CHANGE: year controls remain active in linked Task workspace
            setButtonDisabled(button, disabled, disabled ? "Select a garden module first." : (button.__trellisDashboardDefaultTitle || ""));
        });
        if (disabled && title) {
            [entry.planBtn, entry.equipmentBtn, entry.irrigationBtn, entry.allocateBtn, entry.messagesBtn, entry.exportBtn, entry.shareBtn, entry.tableBtn].forEach(function (button) { if (button) button.title = title; }); // CHANGE: keep year navigation available while task tools are disabled
        }
        entry.taskBoardSelect.disabled = true;
        entry.taskBoardSelect.style.opacity = disabled ? "0.45" : "1";
        entry.taskBoardSelect.style.cursor = disabled ? "not-allowed" : "pointer";
    }

    function setYearActionControlsDisabled(entry, disabled, title) {
        [entry.prev, entry.next].forEach(function (button) { // NEW: year navigation has different workspace availability than garden-only tools
            setButtonDisabled(button, disabled, disabled ? (title || "Select a garden module first.") : (button.__trellisDashboardDefaultTitle || ""));
        });
    }

    function renderBlankViewportToolbar(context) {
        const entry = ensureViewportToolbar();
        if (!entry) return;
        activeToolbarModule = null;
        if (taskManagerApi() && typeof taskManagerApi().setActiveDashboardContext === "function") taskManagerApi().setActiveDashboardContext(null, null);
        entry.gardenName.textContent = "No active garden";
        entry.gardenName.title = "No active garden";
        entry.yearLabel.textContent = String(new Date().getFullYear());
        entry.taskBoardSelect.innerHTML = "";
        entry.taskBoardSelect.title = "Task Boards"; // CHANGE
        entry.taskBoardSelect.style.display = "none"; // NEW: no board chooser without an active garden
        entry.workspaceWrap.style.display = "none"; // NEW: no switcher until there is an active garden
        entry.messagesBtn.textContent = "Messages";
        entry.tableBtn.textContent = "Table";
        entry.tableBtn.title = "Select a garden module first.";
        entry.table.style.display = "none";
        entry.table.innerHTML = "";
        applyToolbarActiveButtonState(entry.irrigationBtn, false);
        setGardenActionControlsDisabled(entry, true);
        setYearActionControlsDisabled(entry, true);

        const candidates = sortGardensForPicker(context && context.candidates || []);
        entry.gardenPickerWrap.style.display = candidates.length ? "block" : "none";
        entry.createGardenBtn.style.display = candidates.length ? "none" : "inline-block";
        entry.gardenPickerBtn.textContent = "Select garden...";
        entry.gardenPickerBtn.title = candidates.length ? "Select a garden module" : "No garden modules found.";
        setButtonDisabled(entry.gardenPickerBtn, !candidates.length, candidates.length ? "Select a garden module" : "No garden modules found.");
        setButtonDisabled(entry.createGardenBtn, false, "Create a garden module");
        if (!gardenPickerOpen) closeGardenPicker(entry);
        else renderGardenPickerPopover(entry, context || {});
        entry.wrap.style.display = "block";
        positionViewportToolbar(entry);
    }

    function renderViewportToolbar(moduleCell) {
        const entry = ensureViewportToolbar();
        if (!entry || !moduleCell) return;
        closeGardenPicker(entry);
        entry.gardenName.textContent = gardenLabel(moduleCell);
        entry.gardenName.title = gardenLabel(moduleCell);
        entry.gardenPickerWrap.style.display = "none";
        entry.createGardenBtn.style.display = "none";
        const year = getToolbarYear(moduleCell);
        const activeWorkspace = getActiveWorkspaceForSelection() || "garden"; // NEW
        const gardenToolsDisabled = activeWorkspace === "tasks" || activeWorkspace === "team"; // NEW
        const yearControlsDisabled = activeWorkspace === "team"; // NEW: linked Task workspace can still drive the garden year
        setGardenActionControlsDisabled(entry, gardenToolsDisabled, gardenToolsDisabled ? WORKSPACE_DISABLED_TITLE : "");
        setYearActionControlsDisabled(entry, yearControlsDisabled, yearControlsDisabled ? WORKSPACE_DISABLED_TITLE : "");
        const expanded = toolbarExpandedByModuleId.get(cellId(moduleCell)) === true;
        const taskApi = taskManagerApi();
        if (taskApi && typeof taskApi.setActiveDashboardContext === "function") taskApi.setActiveDashboardContext(moduleCell, year);
        const taskBoards = taskApi && typeof taskApi.listBoardsForGarden === "function" ? (taskApi.listBoardsForGarden(moduleCell) || []) : [];
        const taskSummary = taskApi && typeof taskApi.unseenCreatedSummaryForGarden === "function" ? taskApi.unseenCreatedSummaryForGarden(moduleCell) : { hidden: true, total: 0, boards: [] };
        const summaryByBoardId = new Map((taskSummary.boards || []).map(function (entry) { return [String(entry.boardId || ""), entry]; }));
        const preferredBoardId = selectedTaskBoardIdForGarden(moduleCell, taskBoards, entry.taskBoardSelect.value, selectedTaskBoardIdForSelection()); // CHANGE
        let selectedBoardId = "";
        entry.yearLabel.textContent = String(year);
        renderWorkspaceSwitcher(entry, activeWorkspace, taskSummary); // NEW
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
        if (selectedBoardId) entry.taskBoardSelect.value = selectedBoardId; // CHANGE: render reflects remembered/default board without persisting defaults
        const showTaskBoardSelect = activeWorkspace === "tasks" && taskBoards.length > 1; // NEW: board chooser is scoped to the active Tasks workspace
        entry.taskBoardSelect.style.display = showTaskBoardSelect ? "" : "none"; // CHANGE
        entry.taskBoardSelect.disabled = !taskApi || !showTaskBoardSelect; // CHANGE
        entry.taskBoardSelect.style.opacity = entry.taskBoardSelect.disabled ? "0.45" : "1";
        entry.taskBoardSelect.style.cursor = entry.taskBoardSelect.disabled ? "not-allowed" : "pointer";
        entry.taskBoardSelect.title = "Task Boards"; // CHANGE
        entry.messagesBtn.textContent = messagesButtonLabel(moduleCell);
        entry.messagesBtn.title = gardenToolsDisabled ? WORKSPACE_DISABLED_TITLE : "Review access requests"; // CHANGE
        entry.tableBtn.textContent = expanded ? "Hide Table" : "Table";
        entry.tableBtn.title = gardenToolsDisabled ? WORKSPACE_DISABLED_TITLE : (expanded ? "Hide dashboard table" : "Show dashboard table"); // CHANGE
        applyToolbarActiveButtonState(entry.irrigationBtn, activeIrrigationModuleMatches(moduleCell));
        const allocateStatus = allocationPlanStatus(moduleCell, year); // CHANGE: gate Allocate from the selected year's saved crop plan.
        setButtonDisabled(entry.allocateBtn, gardenToolsDisabled || !allocateStatus.enabled, gardenToolsDisabled ? WORKSPACE_DISABLED_TITLE : allocateStatus.title); // CHANGE
        const shareState = shareSelectionState();
        setButtonDisabled(entry.shareBtn, gardenToolsDisabled || !shareState.ok, gardenToolsDisabled ? WORKSPACE_DISABLED_TITLE : (shareState.ok ? "Share selected scope(s)" : shareState.reason)); // CHANGE
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
        if (!dashboardDiagramIsOpen()) { hideViewportToolbar(); return; }
        const context = resolveDashboardToolbarContext();
        lastToolbarContext = context;
        if (!context.moduleCell) { renderBlankViewportToolbar(context); return; }
        activeToolbarModule = context.moduleCell;
        renderViewportToolbar(context.moduleCell);
    }

    function scheduleViewportToolbarRefresh() {
        if (toolbarRefreshTimer) return;
        toolbarRefreshTimer = setTimeout(refreshViewportToolbarForSelection, 0);
    }

    function handleDashboardDiagramOpened() {
        startupGardenFocusDone = false;
        gardenPickerOpen = false;
        gardenPickerSearchText = "";
        scheduleViewportToolbarRefresh();
        scheduleStartupGardenFocus();
    }

    // -------------------- View/model event wiring --------------------
    function scheduleOverlayReposition() {
        scheduleViewportToolbarRefresh();
    }

    const oldValidate = graph.view.validate;
    graph.view.validate = function () {
        const res = oldValidate.apply(this, arguments);
        scheduleOverlayReposition();
        return res;
    };

    window.addEventListener("resize", scheduleOverlayReposition);
    if (graph.getSelectionModel && graph.getSelectionModel().addListener) {
        graph.getSelectionModel().addListener(mxEvent.CHANGE, scheduleViewportToolbarRefresh);
    }
    if (model.addListener) {
        model.addListener(mxEvent.CHANGE, scheduleViewportToolbarRefresh);
    }
    if (ui.editor && typeof ui.editor.addListener === "function") {
        ui.editor.addListener("fileLoaded", handleDashboardDiagramOpened);
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
    scheduleStartupGardenFocus();

});
