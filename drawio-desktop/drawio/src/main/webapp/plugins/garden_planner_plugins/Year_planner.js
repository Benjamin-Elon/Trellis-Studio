/**
 * Draw.io Plugin: Year Planner (listens for dashboard Plan button events)
 *
 * Listens:
 *   window event "usl:planYearRequested" with detail:
 *     { moduleCellId: string, dashCellId?: string, year: number }
 *
 * Stores plan JSON on the module cell attribute:
 *   plan_year_json  -> JSON object keyed by year string
 */
Draw.loadPlugin(function (ui) {
    const graph = ui.editor && ui.editor.graph;
    if (!graph) return;

    const model = graph.getModel();

    // Prevent double install
    if (graph.__yearPlannerInstalled) return;
    graph.__yearPlannerInstalled = true;

    // -------------------- Config --------------------
    const PLAN_YEARS_ATTR = "plan_year_json";
    const PLAN_TEMPLATES_ATTR = "plan_year_templates";      // (diagram-scoped)
    const PLAN_UNIT_DEFAULTS_ATTR = "plan_unit_defaults";   // (diagram-scoped, per plantId)
    const __YP_GLOBAL = window.__uslYearPlannerGlobal || (window.__uslYearPlannerGlobal = {});

    // -------------------- Session + lifecycle -------------------------------------------- 
    const controller = { session: null };

    function safeDispose(fn) {
        try { fn && fn(); } catch (_) { }
    }

    function closeSession() {
        const s = controller.session;
        if (!s) return;

        // run disposers (listeners etc.)
        const ds = Array.isArray(s.disposers) ? s.disposers.slice().reverse() : [];
        s.disposers = [];
        for (const d of ds) safeDispose(d);

        // remove DOM
        if (s.ui && s.ui.modalEl) {
            try { s.ui.modalEl.remove(); } catch (_) { }
            s.ui.modalEl = null;
        }

        controller.session = null;
    }

    function createSession(moduleCell, year, plan) {
        const moduleCellId = String(moduleCell?.getId ? moduleCell.getId() : moduleCell?.id || "");
        return {
            moduleCell,
            moduleCellId,
            year: Number(year),
            plan,
            ui: {
                modalEl: null,
                harvestVizByCropId: new Map()
            },
            disposers: []
        };
    }

    function addWindowListener(s, type, handler, opts) {
        window.addEventListener(type, handler, opts);
        s.disposers.push(() => window.removeEventListener(type, handler, opts));
    }

    function addGraphListener(s, graph, eventName, handler) {
        graph.addListener(eventName, handler);
        s.disposers.push(() => { try { graph.removeListener(handler); } catch (_) { } });
    }



    // -------------------- Env --------------------                                                     
    const Env = (() => {
        const DEBUG = false;

        function safeJsonStringParse(s, fallback) {
            try { return JSON.parse(String(s || "")); } catch (_) { return fallback; }
        }

        function uid(prefix) {
            return prefix + "_" + Math.random().toString(36).slice(2, 10);
        }

        return {
            graph,
            model,
            DEBUG,
            safeJsonStringParse,
            uid,
            ATTRS: {
                PLAN_YEARS_ATTR,
                PLAN_TEMPLATES_ATTR,
                PLAN_UNIT_DEFAULTS_ATTR
            }
        };
    })();














    // -------------------- DiagramStore --------------------                                            
    const DiagramStore = (() => {
        function getCellAttr(cell, key, def = "") {
            if (!cell || !cell.getAttribute) return def;
            const v = cell.getAttribute(key);
            return (v === null || v === undefined) ? def : v;
        }

        function setCellAttr(cell, key, val) {
            if (Env.graph.setAttributeForCell) {
                if (val == null) Env.graph.setAttributeForCell(cell, key, null);
                else Env.graph.setAttributeForCell(cell, key, String(val));
            } else if (cell.value && typeof cell.value.setAttribute === "function") {
                if (val == null) cell.value.removeAttribute(key);
                else cell.value.setAttribute(key, String(val));
            }
        }

        function readPlanYearsMap(moduleCell) {
            const raw = getCellAttr(moduleCell, Env.ATTRS.PLAN_YEARS_ATTR, "");
            const obj = Env.safeJsonStringParse(raw, null);
            return (obj && typeof obj === "object" && !Array.isArray(obj)) ? obj : {};
        }

        function writePlanYearsMap(moduleCell, mapObj) {
            Env.model.beginUpdate();
            try {
                setCellAttr(moduleCell, Env.ATTRS.PLAN_YEARS_ATTR, JSON.stringify(mapObj || {}));
            } finally {
                Env.model.endUpdate();
            }
            Env.graph.refresh(moduleCell);
        }

        function getDiagramRootCell() {
            try { return Env.model.getRoot(); } catch (_) { }
            return null;
        }

        function readRootJsonMap(attrName) {
            const root = getDiagramRootCell();
            if (!root) return {};
            const raw = getCellAttr(root, attrName, "");
            const obj = Env.safeJsonStringParse(raw, null);
            return (obj && typeof obj === "object" && !Array.isArray(obj)) ? obj : {};
        }

        function writeRootJsonMap(attrName, mapObj) {
            const root = getDiagramRootCell();
            if (!root) return;
            Env.model.beginUpdate();
            try { setCellAttr(root, attrName, JSON.stringify(mapObj || {})); }
            finally { Env.model.endUpdate(); }
            Env.graph.refresh(root);
        }

        return {
            getCellAttr,
            setCellAttr,
            readPlanYearsMap,
            writePlanYearsMap,
            readRootJsonMap,
            writeRootJsonMap,
            getDiagramRootCell
        };
    })();

















    // -------------------- DbClient --------------------                                                 
    const DbClient = (() => {
        let __dbPathCached = null;
        let __plantsBasicCache = null;

        async function getDbPath() {
            if (__dbPathCached) return __dbPathCached;

            if (!window.dbBridge || typeof window.dbBridge.resolvePath !== "function") {
                throw new Error("dbBridge.resolvePath not available; add dbResolvePath wiring");
            }

            const r = await window.dbBridge.resolvePath({
                dbName: "Trellis_database.sqlite"
            });

            __dbPathCached = r.dbPath;
            return __dbPathCached;
        }

        async function queryAll(sql, params) {
            if (!window.dbBridge || typeof window.dbBridge.open !== 'function') {
                throw new Error('dbBridge not available; check preload/main wiring');
            }
            const dbPath = await getDbPath();
            const opened = await window.dbBridge.open(dbPath, { readOnly: true });
            try {
                const res = await window.dbBridge.query(opened.dbId, sql, params || []);
                return Array.isArray(res?.rows) ? res.rows : [];
            } finally {
                try { await window.dbBridge.close(opened.dbId); } catch (_) { }
            }
        }

        async function listPlantsBasicRows() {
            const sql = `
          SELECT plant_id, plant_name, yield_per_plant_kg, harvest_window_days, default_planting_method
          FROM Plants
          WHERE abbr IS NOT NULL
          ORDER BY plant_name;`;
            return await queryAll(sql, []);
        }

        async function getPlantsBasicCached() {
            if (__plantsBasicCache) return __plantsBasicCache;
            __plantsBasicCache = await listPlantsBasicRows();
            return __plantsBasicCache;
        }

        function invalidatePlantsBasicCache() {
            __plantsBasicCache = null;
        }

        async function queryVarietiesByPlantId(plantId) {
            const pid = Number(plantId);
            if (!Number.isFinite(pid)) return [];
            const sql = `
        SELECT variety_id, plant_id, variety_name, overrides_json
        FROM PlantVarieties
        WHERE plant_id = ?
        ORDER BY variety_name COLLATE NOCASE;`;
            return await queryAll(sql, [pid]);
        }

        return {
            getDbPath,
            queryAll,
            listPlantsBasicRows,
            getPlantsBasicCached,
            invalidatePlantsBasicCache,
            queryVarietiesByPlantId
        };
    })();























    // -------------------- PlanMath --------------------                                                  
    const PlanMath = (() => {
        function pushWarn(warns, msg) {
            if (!warns) return;
            warns.push(String(msg || ""));
        }

        function hasYmd(s) {
            return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
        }

        function toIsoDateLocal(d) {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, "0");
            const da = String(d.getDate()).padStart(2, "0");
            return `${y}-${m}-${da}`;
        }

        function parseYmdLocalToMs(ymd) {
            const s = String(ymd || "").trim();
            if (!s) return NaN;
            const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (!m) return NaN;
            const y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3]);
            const dt = new Date(y, mo, d, 0, 0, 0, 0);
            const t = dt.getTime();
            return Number.isFinite(t) ? t : NaN;
        }

        function addDaysMs(ms, days) {
            return ms + (days * 24 * 60 * 60 * 1000);
        }

        function buildWeekStartsForYearLocal(year, weekStartDow /* 0=Sun..6=Sat */) {
            const start = new Date(year, 0, 1);
            const startDow = start.getDay();
            const delta = (7 + (startDow - weekStartDow)) % 7;
            const firstWeekStart = new Date(year, 0, 1 - delta);

            const out = [];
            for (let i = 0; i < 60; i++) {
                const d = new Date(firstWeekStart.getFullYear(), firstWeekStart.getMonth(), firstWeekStart.getDate() + i * 7);
                out.push({ iso: toIsoDateLocal(d), ms: d.getTime() });
                if (d.getFullYear() > year + 1) break;
            }

            const yearStartMs = new Date(year, 0, 1).getTime();
            const yearEndExMs = new Date(year + 1, 0, 1).getTime();
            return out.filter(w => w.ms < yearEndExMs && addDaysMs(w.ms, 7) > yearStartMs);
        }

        function weekIndexForDate(weekStarts, dateYmd) {
            const t = parseYmdLocalToMs(dateYmd);
            if (!Number.isFinite(t)) return -1;
            for (let i = 0; i < weekStarts.length; i++) {
                const a = weekStarts[i].ms;
                const b = addDaysMs(a, 7);
                if (t >= a && t < b) return i;
            }
            return -1;
        }

        function findCrop(plan, cropId) {
            const list = (plan && plan.crops) ? plan.crops : [];
            return list.find(c => c && c.id === cropId) || null;
        }

        function resolveUnitToKgPerUnit(crop, unit) {
            const u = String(unit || "").trim().toLowerCase();
            if (!u) return NaN;

            if (u === "kg") return 1;
            if (u === "g") return 0.001;
            if (u === "lb" || u === "lbs") return 0.45359237;

            if (u === "plant" || u === "plants") {
                const kgPerPlant = Number(crop && crop.kgPerPlant);
                if (!Number.isFinite(kgPerPlant) || kgPerPlant <= 0) return NaN;
                return kgPerPlant;
            }

            const packs = (crop && crop.packages) ? crop.packages : [];
            const p = packs.find(x => String(x.unit || "").trim().toLowerCase() === u);
            if (!p) return NaN;

            const baseType = String(p.baseType || "").trim().toLowerCase();
            const baseQty = Number(p.baseQty);
            if (!Number.isFinite(baseQty) || baseQty <= 0) return NaN;

            if (baseType === "kg") return baseQty;

            if (baseType === "plant" || baseType === "plants") {
                const kgPerPlant = Number(crop.kgPerPlant);
                if (!Number.isFinite(kgPerPlant) || kgPerPlant <= 0) return NaN;
                return baseQty * kgPerPlant;
            }

            return NaN;
        }

        function addKgAcrossWeeks(series, weekStarts, fromYmd, toYmd, kgPerWeek) {
            const i0 = weekIndexForDate(weekStarts, fromYmd);
            const i1 = weekIndexForDate(weekStarts, toYmd);
            if (i0 < 0 || i1 < 0) return;
            const a = Math.min(i0, i1);
            const b = Math.max(i0, i1);
            for (let i = a; i <= b; i++) series[i] += kgPerWeek;
        }

        function computePlanWeekly(plan, warns) {

            warns = Array.isArray(warns) ? warns : [];

            const year = Number(plan && plan.year);
            const weekStartDow = Number.isFinite(plan && plan.weekStartDow) ? plan.weekStartDow : 1;
            const weeks = buildWeekStartsForYearLocal(year, weekStartDow);
            const n = weeks.length;

            const targetTotal = Array(n).fill(0);
            const supplyTotal = Array(n).fill(0);
            const perCrop = new Map();

            function ensureCropArrays(cropId) {
                if (!perCrop.has(cropId)) {
                    perCrop.set(cropId, { target: Array(n).fill(0), supply: Array(n).fill(0) });
                }
                return perCrop.get(cropId);
            }

            const crops = (plan && plan.crops) ? plan.crops : [];

            // market
            for (const crop of crops) {
                if (!crop || !crop.id) continue;
                const arr = ensureCropArrays(crop.id);
                const market = crop.market || [];
                for (const line of market) {
                    const qty = Number(line && line.qty);
                    if (!Number.isFinite(qty) || qty <= 0) {
                        pushWarn(warns, `Market line skipped (qty missing) for ${crop.plant || crop.id}`);
                        continue;
                    }

                    if (!hasYmd(line.from) || !hasYmd(line.to)) {
                        pushWarn(warns, `Market line skipped (missing dates) for ${crop.plant || crop.id}`);
                        continue;
                    }

                    const kgPerUnit = resolveUnitToKgPerUnit(crop, line.unit);
                    if (!Number.isFinite(kgPerUnit)) {
                        pushWarn(warns, `Market line skipped (unknown unit "${line.unit}") for ${crop.plant || crop.id}`);
                        continue;
                    }

                    addKgAcrossWeeks(arr.target, weeks, line.from, line.to, qty * kgPerUnit);
                }
            }

            // CSA
            const csa = plan && plan.csa;
            if (csa && csa.enabled) {
                const boxes = Number(csa.boxesPerWeek);
                if (!Number.isFinite(boxes) || boxes <= 0) {
                    pushWarn(warns, "CSA enabled but boxes/week is not set.");
                } else {
                    const comps = csa.components || [];
                    for (const comp of comps) {
                        const crop = findCrop(plan, comp.cropId);
                        if (!crop) { pushWarn(warns, "CSA component skipped (missing crop)."); continue; }

                        const qty = Number(comp.qty);
                        if (!Number.isFinite(qty) || qty <= 0) {
                            pushWarn(warns, `CSA component skipped (qty missing) for ${crop.plant || crop.id}`);
                            continue;
                        }

                        const kgPerUnit = resolveUnitToKgPerUnit(crop, comp.unit);
                        if (!Number.isFinite(kgPerUnit)) {
                            pushWarn(warns, `CSA component skipped (unknown unit "${comp.unit}") for ${crop.plant || crop.id}`);
                            continue;
                        }

                        const everyN = Math.max(1, Number(comp.everyNWeeks) || 1);
                        const from = comp.start || csa.start;
                        const to = comp.end || csa.end;

                        if (!hasYmd(from) || !hasYmd(to)) {
                            pushWarn(warns, `CSA component skipped (missing dates) for ${crop.plant || crop.id}`);
                            continue;
                        }

                        const i0 = weekIndexForDate(weeks, from);
                        const i1 = weekIndexForDate(weeks, to);
                        if (i0 < 0 || i1 < 0) continue;

                        const a = Math.min(i0, i1), b = Math.max(i0, i1);
                        const arr = ensureCropArrays(crop.id);

                        for (let i = a; i <= b; i++) {
                            const rel = i - a;
                            if (rel % everyN !== 0) continue;
                            arr.target[i] += boxes * qty * kgPerUnit;
                        }
                    }
                }
            }

            // supply estimate (actualPlants)
            for (const crop of crops) {
                if (!crop || !crop.id) continue;

                const actualPlants = Number(crop.actualPlants);
                const kgPerPlant = Number(crop.kgPerPlant);
                if (!Number.isFinite(actualPlants) || actualPlants <= 0) continue;

                if (!Number.isFinite(kgPerPlant) || kgPerPlant <= 0) {
                    pushWarn(warns, `Supply skipped (kg/plant missing) for ${crop.plant || crop.id}`);
                    continue;
                }

                if (!hasYmd(crop.harvestStart) || !hasYmd(crop.harvestEnd)) {
                    pushWarn(warns, `Supply skipped (harvest window missing) for ${crop.plant || crop.id}`);
                    continue;
                }

                const i0 = weekIndexForDate(weeks, crop.harvestStart);
                const i1 = weekIndexForDate(weeks, crop.harvestEnd);
                if (i0 < 0 || i1 < 0) continue;

                const a = Math.min(i0, i1), b = Math.max(i0, i1);
                const countWeeks = b - a + 1;
                if (countWeeks <= 0) continue;

                const totalKg = actualPlants * kgPerPlant;
                const kgPerWeek = totalKg / countWeeks;
                const arr = ensureCropArrays(crop.id);
                for (let i = a; i <= b; i++) arr.supply[i] += kgPerWeek;
            }

            // totals
            for (const [, v] of perCrop.entries()) {
                for (let i = 0; i < n; i++) {
                    targetTotal[i] += v.target[i];
                    supplyTotal[i] += v.supply[i];
                }
            }

            return { weeks, targetTotal, supplyTotal, perCrop };
        }

        function computePlanCropTotals(plan, weekly) {
            const crops = (plan && plan.crops) ? plan.crops : [];
            const out = [];
            for (const crop of crops) {
                if (!crop || !crop.id) continue;
                const v = weekly.perCrop.get(crop.id);
                const targetKg = v ? v.target.reduce((a, b) => a + b, 0) : 0;
                const supplyKg = v ? v.supply.reduce((a, b) => a + b, 0) : 0;
                const kgPerPlant = Number(crop.kgPerPlant);
                const plantsReq = (Number.isFinite(kgPerPlant) && kgPerPlant > 0) ? (targetKg / kgPerPlant) : NaN;
                const germRate = Number(crop.germRate);
                const seedsReq = (Number.isFinite(plantsReq) && plantsReq > 0 && Number.isFinite(germRate) && germRate > 0 && germRate <= 1)
                    ? (plantsReq / germRate)
                    : NaN;

                out.push({ crop, targetKg, supplyKg, plantsReq, seedsReq });
            }
            return out;
        }


        function validatePlan(plan) {
            const errs = [];
            const crops = plan.crops || [];

            for (const c of crops) {
                if (!c.id) errs.push("Crop missing id.");
                if (!c.plantId) errs.push(`Crop "${c.plant || c.id}" missing plantId.`);
                if (!Number.isFinite(Number(c.kgPerPlant)) || Number(c.kgPerPlant) <= 0) {
                    errs.push(`Crop "${c.plant || c.id}" missing valid kg/plant.`);
                }
                // packages must resolve
                for (const p of (c.packages || [])) {
                    const u = String(p.unit || "").trim();
                    if (!u) errs.push(`Crop "${c.plant || c.id}" has a package with blank unit.`);
                    const baseType = String(p.baseType || "").trim().toLowerCase();
                    const baseQty = Number(p.baseQty);
                    if (!Number.isFinite(baseQty) || baseQty <= 0) errs.push(`Crop "${c.plant || c.id}" package "${u}" baseQty must be > 0.`);
                    if (baseType !== "kg" && baseType !== "plant" && baseType !== "plants") errs.push(`Crop "${c.plant || c.id}" package "${u}" baseType must be kg or plant.`);
                    if ((baseType === "plant" || baseType === "plants") && !(Number(c.kgPerPlant) > 0)) errs.push(`Crop "${c.plant || c.id}" package "${u}" uses plant but kg/plant is missing.`);
                }
                // market lines must have valid dates + unit
                for (const mkt of (c.market || [])) {
                    if (!hasYmd(mkt.from) || !hasYmd(mkt.to)) errs.push(`Crop "${c.plant || c.id}" market line missing dates.`);
                    const kg = resolveUnitToKgPerUnit(c, mkt.unit);
                    if (!Number.isFinite(kg)) errs.push(`Crop "${c.plant || c.id}" market unit "${mkt.unit}" does not resolve to kg.`);
                }

                const gr = Number(c.germRate);
                if (!Number.isFinite(gr) || gr <= 0 || gr > 1) {
                    errs.push(`Crop "${c.plant || c.id}" missing valid germination rate (0..1).`);
                }

            }

            if (plan.csa && plan.csa.enabled) {
                if (!Number.isFinite(Number(plan.csa.boxesPerWeek)) || Number(plan.csa.boxesPerWeek) <= 0) {
                    errs.push("CSA enabled but boxes/week is not set.");
                }
                for (const comp of (plan.csa.components || [])) {
                    const crop = findCrop(plan, comp.cropId);
                    if (!crop) { errs.push("CSA component references missing crop."); continue; }
                    if (!hasYmd(comp.start) || !hasYmd(comp.end)) errs.push(`CSA component for "${crop.plant || crop.id}" missing dates.`);
                    const kg = resolveUnitToKgPerUnit(crop, comp.unit);
                    if (!Number.isFinite(kg)) errs.push(`CSA component for "${crop.plant || crop.id}" unit "${comp.unit}" does not resolve to kg.`);
                }
            }

            return errs;
        }

        return {
            pushWarn,
            hasYmd,
            toIsoDateLocal,
            parseYmdLocalToMs,
            addDaysMs,
            buildWeekStartsForYearLocal,
            weekIndexForDate,
            findCrop,
            resolveUnitToKgPerUnit,
            addKgAcrossWeeks,
            computePlanWeekly,
            computePlanCropTotals,
            validatePlan
        };
    })();





























    // -------------------- Extractors --------------------                                                
    const Extractors = (() => {
        function isTilerGroupCell(cell) {
            return !!cell && typeof cell.getAttribute === "function" && cell.getAttribute("tiler_group") === "1";
        }

        function getCropKeyFromPlanCrop(c) {
            const plantId = String(c && c.plantId || "").trim();
            const varietyId = (c && c.varietyId != null && c.varietyId !== "") ? String(c.varietyId).trim() : "";
            if (plantId) return `pid:${plantId}|vid:${varietyId}`;
            const plant = String(c && c.plant || "").trim();
            const variety = String(c && c.variety || "").trim();
            return `name:${plant}|var:${variety}`;
        }

        function getCropKeyFromTilerGroup(tg) {
            const plantId = String(DiagramStore.getCellAttr(tg, "plant_id", "") || "").trim();
            const varietyId = String(DiagramStore.getCellAttr(tg, "variety_id", "") || "").trim();
            if (plantId) return `pid:${plantId}|vid:${varietyId}`;

            const plant = String(DiagramStore.getCellAttr(tg, "plant_name", "") || "").trim();
            const variety = String(DiagramStore.getCellAttr(tg, "variety_name", "") || "").trim();
            return `name:${plant}|var:${variety}`;
        }

        function getAllDescendants(model, root) {
            const out = [];
            if (!root) return out;
            const stack = [root];
            while (stack.length) {
                const cur = stack.pop();
                const n = model.getChildCount(cur);
                for (let i = 0; i < n; i++) {
                    const ch = model.getChildAt(cur, i);
                    out.push(ch);
                    stack.push(ch);
                }
            }
            return out;
        }

        function getFirstNonEmptyAttr(cell, keys) {
            for (const k of keys) {
                const v = DiagramStore.getCellAttr(cell, k, "");
                if (String(v || "").trim()) return v;
            }
            return "";
        }

        function isPerennialTilerGroup(tg) {
            const lc = String(DiagramStore.getCellAttr(tg, "life_cycle", "") || "").trim().toLowerCase();
            if (lc === "perennial") return true;
            if (DiagramStore.getCellAttr(tg, "is_perennial", "") === "1") return true;
            return false;
        }

        // Consolidated filter with overlap semantics + partial-date support.                       
        function shouldIncludeTilerGroupInYear(tg, selectedYear, harvestEndYearFn) {
            if (!isTilerGroupCell(tg)) return false;
            if (isPerennialTilerGroup(tg)) return true;

            const y = Number(selectedYear);
            if (!Number.isFinite(y)) return false;

            // 1) Explicit season assignment                                                       
            const rawStart = String(DiagramStore.getCellAttr(tg, "season_start_year", "")).trim();
            const startY = rawStart ? Number(rawStart) : NaN;
            if (Number.isFinite(startY) && startY === y) return true;

            // 2) Harvest window overlap (local-year)                                               
            // We reuse the same attribute keys you already standardized elsewhere.
            const hsRaw = String(getFirstNonEmptyAttr(tg, [
                "harvest_start", "harvest_start_date", "planting_harvest_start", "season_harvest_start", "start"
            ]) || "").trim();

            const heRaw = String(getFirstNonEmptyAttr(tg, [
                "harvest_end", "harvest_end_date", "planting_harvest_end", "season_harvest_end", "end"
            ]) || "").trim();

            // Local year extraction uses the same parser used everywhere else (PlanMath).          
            const hsMs = PlanMath.parseYmdLocalToMs(hsRaw);
            const heMs = PlanMath.parseYmdLocalToMs(heRaw);
            const hsY = Number.isFinite(hsMs) ? new Date(hsMs).getFullYear() : NaN;
            const heY = Number.isFinite(heMs) ? new Date(heMs).getFullYear() : NaN;

            // If caller injects a canonical end-year extractor, prefer it (still local-year).      
            const injectedEndY = harvestEndYearFn ? harvestEndYearFn(tg) : NaN;
            const endY = Number.isFinite(injectedEndY) ? injectedEndY : heY;

            // Overlap semantics when both ends are known                                            
            if (Number.isFinite(hsY) && Number.isFinite(endY)) {
                const lo = Math.min(hsY, endY);
                const hi = Math.max(hsY, endY);
                if (y >= lo && y <= hi) return true;
            } else {
                // Partial-date semantics                                                            
                if (Number.isFinite(hsY) && hsY === y) return true;
                if (Number.isFinite(endY) && endY === y) return true;
            }

            return false;
        }


        return {
            isTilerGroupCell,
            getCropKeyFromPlanCrop,
            getCropKeyFromTilerGroup,
            getAllDescendants,
            getFirstNonEmptyAttr,
            isPerennialTilerGroup,
            shouldIncludeTilerGroupInYear
        };
    })();


















    // -------------------- local aliases ------------------------------------ 
    const safeJsonStringParse = Env.safeJsonStringParse;
    const uid = Env.uid;

    const getCellAttr = DiagramStore.getCellAttr;
    const setCellAttr = DiagramStore.setCellAttr;
    const readPlanYearsMap = DiagramStore.readPlanYearsMap;
    const writePlanYearsMap = DiagramStore.writePlanYearsMap;
    const readRootJsonMap = DiagramStore.readRootJsonMap;
    const writeRootJsonMap = DiagramStore.writeRootJsonMap;

    const getDbPath = DbClient.getDbPath;
    const queryAll = DbClient.queryAll;
    const listPlantsBasicRows = DbClient.listPlantsBasicRows;
    const getPlantsBasicCached = DbClient.getPlantsBasicCached;
    const queryVarietiesByPlantId = DbClient.queryVarietiesByPlantId;

    const pushWarn = PlanMath.pushWarn;
    const hasYmd = PlanMath.hasYmd;
    const toIsoDateLocal = PlanMath.toIsoDateLocal;
    const parseYmdLocalToMs = PlanMath.parseYmdLocalToMs;
    const addDaysMs = PlanMath.addDaysMs;
    const buildWeekStartsForYearLocal = PlanMath.buildWeekStartsForYearLocal;
    const weekIndexForDate = PlanMath.weekIndexForDate;
    const findCrop = PlanMath.findCrop;
    const resolveUnitToKgPerUnit = PlanMath.resolveUnitToKgPerUnit;
    const addKgAcrossWeeks = PlanMath.addKgAcrossWeeks;
    const computePlanWeekly = PlanMath.computePlanWeekly;
    const computePlanCropTotals = PlanMath.computePlanCropTotals;
    const validatePlan = PlanMath.validatePlan;

    const isTilerGroupCell = Extractors.isTilerGroupCell;
    const getCropKeyFromPlanCrop = Extractors.getCropKeyFromPlanCrop;
    const getCropKeyFromTilerGroup = Extractors.getCropKeyFromTilerGroup;
    const getAllDescendants = (root) => Extractors.getAllDescendants(model, root);
    const getFirstNonEmptyAttr = Extractors.getFirstNonEmptyAttr;
    const shouldIncludeTilerGroupInYear = Extractors.shouldIncludeTilerGroupInYear;


    // -------------------- actual-plants from diagram --------------------

    function actualPlantsMapFromModule(moduleCell, selectedYear) {
        const all = getAllDescendants(moduleCell);
        const tilers = all.filter(isTilerGroupCell);

        const map = new Map();
        for (const tg of tilers) {
            if (!shouldIncludeTilerGroupInYear(tg, selectedYear, harvestEndLocalYear)) continue;

            const plantCount = Number(getCellAttr(tg, "plant_count", ""));
            const n = (Number.isFinite(plantCount) && plantCount > 0) ? Math.trunc(plantCount) : 0;
            if (n <= 0) continue;

            const key = getCropKeyFromTilerGroup(tg);
            map.set(key, (map.get(key) || 0) + n);

        }

        return map;
    }

    function applyactualPlantsFromModuleToPlan(moduleCell, year, plan) {
        if (!moduleCell || !plan || !Array.isArray(plan.crops)) return;
        const m = actualPlantsMapFromModule(moduleCell, year);

        for (const c of plan.crops) {
            const key = getCropKeyFromPlanCrop(c);
            const v = (m.get(key) != null) ? m.get(key) : 0;
            c.actualPlants = Math.max(0, Math.trunc(Number(v) || 0));
        }
    }











    // -------------------- Actual harvest from diagram helpers --------------------

    function harvestStartYmd(tg) {
        return String(getFirstNonEmptyAttr(tg, [
            "harvest_start", "harvest_start_date", "planting_harvest_start", "season_harvest_start", "start"
        ]) || "").trim();
    }

    function harvestEndYmd(tg) {
        return String(getFirstNonEmptyAttr(tg, [
            "harvest_end", "harvest_end_date", "planting_harvest_end", "season_harvest_end", "end"
        ]) || "").trim();
    }

    function harvestEndLocalYear(tg) {
        const raw = String(getFirstNonEmptyAttr(tg, [
            "harvest_end", "harvest_end_date", "planting_harvest_end", "season_harvest_end", "end"
        ]) || "").trim();

        const ms = parseYmdLocalToMs(raw);        // expects YYYY-MM-DD
        if (!Number.isFinite(ms)) return NaN;

        return new Date(ms).getFullYear();        // LOCAL year (consistent with parseYmdLocalToMs)
    }

    function harvestWindowOverlapsYear(tg, year) { // CHANGED
        const hs = harvestStartYmd(tg); // CHANGED
        const he = harvestEndYmd(tg); // CHANGED
        if (!hasYmd(hs) || !hasYmd(he)) return false; // CHANGED

        const startMs = parseYmdLocalToMs(hs); // CHANGED
        const endMs = parseYmdLocalToMs(he); // CHANGED
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false; // CHANGED

        const yearStartMs = parseYmdLocalToMs(`${Number(year)}-01-01`); // CHANGED
        const yearEndMs = parseYmdLocalToMs(`${Number(year)}-12-31`); // CHANGED
        if (!Number.isFinite(yearStartMs) || !Number.isFinite(yearEndMs)) return false; // CHANGED

        const a = Math.min(startMs, endMs); // CHANGED
        const b = Math.max(startMs, endMs); // CHANGED
        return b >= yearStartMs && a <= yearEndMs; // CHANGED
    } // CHANGED

    function weekRangeForWindow(weekStarts, fromYmd, toYmd) {
        if (!hasYmd(fromYmd) || !hasYmd(toYmd)) return null;
        const i0 = weekIndexForDate(weekStarts, fromYmd);
        const i1 = weekIndexForDate(weekStarts, toYmd);
        if (i0 < 0 || i1 < 0) return null;
        const a = Math.min(i0, i1), b = Math.max(i0, i1);
        return { a, b };
    }

    function buildActualHarvestSeriesByCropKey(moduleCell, year, weekStarts, cropKeyToKgPerPlant) {
        const all = getAllDescendants(moduleCell);
        const tilers = all.filter(isTilerGroupCell);

        const seriesByKey = new Map(); // key -> Array(nWeeks).fill(0)

        function ensure(key) {
            if (!seriesByKey.has(key)) seriesByKey.set(key, Array(weekStarts.length).fill(0));
            return seriesByKey.get(key);
        }

        for (const tg of tilers) {
            if (!harvestWindowOverlapsYear(tg, year)) continue; // CHANGED

            const plantCount = Number(getCellAttr(tg, "plant_count", ""));
            const nPlants = (Number.isFinite(plantCount) && plantCount > 0) ? Math.trunc(plantCount) : 0;
            if (nPlants <= 0) continue;

            const hs = harvestStartYmd(tg);
            const he = harvestEndYmd(tg);
            const wr = weekRangeForWindow(weekStarts, hs, he);
            if (!wr) continue;

            const key = getCropKeyFromTilerGroup(tg);

            const kgPerPlant = Number(cropKeyToKgPerPlant.get(key));
            if (!Number.isFinite(kgPerPlant) || kgPerPlant <= 0) continue;

            const totalKg = nPlants * kgPerPlant;
            const weeksCount = (wr.b - wr.a + 1);
            if (weeksCount <= 0) continue;

            const kgPerWeek = totalKg / weeksCount;
            const series = ensure(key);
            for (let i = wr.a; i <= wr.b; i++) series[i] += kgPerWeek;
        }

        return seriesByKey;
    }

    function applyActualHarvestFromModuleToPlan(moduleCell, year, plan, weekStarts) {
        if (!moduleCell || !plan || !Array.isArray(plan.crops)) return;

        // Map cropKey -> kgPerPlant (from plan crops)
        const kgppByKey = new Map();
        for (const c of plan.crops) {
            const key = getCropKeyFromPlanCrop(c);
            const kgpp = Number(c.kgPerPlant);
            if (Number.isFinite(kgpp) && kgpp > 0) kgppByKey.set(key, kgpp);
        }

        const seriesByKey = buildActualHarvestSeriesByCropKey(moduleCell, year, weekStarts, kgppByKey);

        for (const c of plan.crops) {
            const key = getCropKeyFromPlanCrop(c);
            const series = seriesByKey.get(key) || Array(weekStarts.length).fill(0);

            // Store for UI (viz) and for derivation
            c.__actualHarvestWeeklyKg = series;

            // Derive window only when enabled (default on)
            const useActual = (c.useActualHarvest !== false); // default true
            if (!useActual) continue;

            let first = -1, last = -1;
            for (let i = 0; i < series.length; i++) {
                if ((series[i] || 0) > 0) { first = i; break; }
            }
            for (let i = series.length - 1; i >= 0; i--) {
                if ((series[i] || 0) > 0) { last = i; break; }
            }

            if (first >= 0 && last >= 0) {
                c.harvestStart = String(weekStarts[first].iso);
                // harvestEnd: end of the last week => weekStarts[last] + 6 days (local)
                const endMs = addDaysMs(weekStarts[last].ms, 6);
                c.harvestEnd = toIsoDateLocal(new Date(endMs));
            } else {
                // If there is no actual harvest evidence, keep blank (or leave prior manual values if you prefer)
                // c.harvestStart = "";
                // c.harvestEnd = "";
            }
        }
    }












    // -------------------- Attribute helpers --------------------

    function loadPlanForYear(moduleCell, year) {
        const m = readPlanYearsMap(moduleCell);
        const p = m[String(year)];
        return (p && typeof p === "object" && !Array.isArray(p)) ? p : null;
    }

    function savePlanForYear(moduleCell, year, planObj) {
        const m = readPlanYearsMap(moduleCell);
        m[String(year)] = planObj;
        writePlanYearsMap(moduleCell, m);
    }

    function deletePlanForYear(moduleCell, year) {
        const m = readPlanYearsMap(moduleCell);
        delete m[String(year)];
        writePlanYearsMap(moduleCell, m);
    }

    // -------------------- Template helpers ---------------------

    function listTemplateNames() {
        return Object.keys(readRootJsonMap(PLAN_TEMPLATES_ATTR)).sort();
    }

    function loadTemplateByName(name) {
        const m = readRootJsonMap(PLAN_TEMPLATES_ATTR);
        const t = m[String(name || "")];
        return (t && typeof t === "object" && !Array.isArray(t)) ? t : null;
    }

    function saveTemplateByName(name, templateObj) {
        const key = String(name || "").trim();
        if (!key) return;
        const m = readRootJsonMap(PLAN_TEMPLATES_ATTR);
        m[key] = templateObj;
        writeRootJsonMap(PLAN_TEMPLATES_ATTR, m);
    }

    function deleteTemplateByName(name) {
        const key = String(name || "").trim();
        if (!key) return;
        const m = readRootJsonMap(PLAN_TEMPLATES_ATTR);
        delete m[key];
        writeRootJsonMap(PLAN_TEMPLATES_ATTR, m);
    }


    function rekeyTemplateToPlan(templateObj, year) {
        // Apply template: bind to year, regenerate crop IDs, and remap CSA cropIds.
        const t = templateObj ? JSON.parse(JSON.stringify(templateObj)) : {};
        t.version = 1;
        t.year = year;
        if (!Number.isFinite(t.weekStartDow)) t.weekStartDow = 1;
        t.crops = Array.isArray(t.crops) ? t.crops : [];
        t.csa = (t.csa && typeof t.csa === "object") ? t.csa : { enabled: false, boxesPerWeek: 0, start: "", end: "", components: [] };
        t.csa.components = Array.isArray(t.csa.components) ? t.csa.components : [];

        const idMap = new Map();
        for (const c of t.crops) {
            const oldId = c.id;
            c.id = uid("crop");
            idMap.set(oldId, c.id);
        }
        for (const comp of t.csa.components) {
            if (idMap.has(comp.cropId)) comp.cropId = idMap.get(comp.cropId);
        }
        return t;
    }

    // -------------------- Default helpers --------------------

    function readUnitDefaultsMap() {
        return readRootJsonMap(PLAN_UNIT_DEFAULTS_ATTR);
    }

    function writeUnitDefaultsMap(mapObj) {
        writeRootJsonMap(PLAN_UNIT_DEFAULTS_ATTR, mapObj);
    }

    function getDefaultsForPlant(plantId) {
        const m = readUnitDefaultsMap();
        const v = m[String(plantId || "")];
        return Array.isArray(v) ? v : null;
    }

    function saveDefaultsForPlant(plantId, packagesArray) {
        const pid = String(plantId || "").trim();
        if (!pid) return;
        const m = readUnitDefaultsMap();
        m[pid] = Array.isArray(packagesArray) ? packagesArray : [];
        writeUnitDefaultsMap(m);
    }

    // -------------------- Modal UI (row-based MVP) --------------------
    function closePlanModal() {
        closeSession();
    }



    function clampInt(n, defVal) {
        const x = Number(n);
        return Number.isFinite(x) ? Math.max(0, Math.trunc(x)) : defVal;
    }

    function clampNum(n, defVal) {
        const x = Number(n);
        return Number.isFinite(x) ? x : defVal;
    }

    function clampNonNegInt(n, defVal) {
        const x = Number(n);
        if (!Number.isFinite(x)) return defVal;
        return Math.max(0, Math.trunc(x));
    }

    function clampNonNegNum(n, defVal) {
        const x = Number(n);
        if (!Number.isFinite(x)) return defVal;
        return Math.max(0, x);
    }


    function downloadJson(filename, obj) {
        const txt = JSON.stringify(obj, null, 2);
        const blob = new Blob([txt], { type: "application/json;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    function drawPlanChart(canvas, weekly, seriesTarget, seriesSupply) {
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const t = seriesTarget || weekly.targetTotal || [];
        const s = seriesSupply || weekly.supplyTotal || [];

        const n = Math.max(t.length, s.length);
        if (n === 0) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }

        const maxV = Math.max(1, ...t, ...s);
        const w = canvas.width, h = canvas.height;
        const padL = 40, padR = 10, padT = 10, padB = 24;

        ctx.clearRect(0, 0, w, h);

        ctx.strokeStyle = "#999";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padL, padT);
        ctx.lineTo(padL, h - padB);
        ctx.lineTo(w - padR, h - padB);
        ctx.stroke();

        function x(i) { return padL + (i * (w - padL - padR) / Math.max(1, n - 1)); }
        function y(v) {
            const frac = v / maxV;
            return (h - padB) - frac * (h - padT - padB);
        }

        ctx.strokeStyle = "#000";
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
            const v = t[i] || 0;
            if (i === 0) ctx.moveTo(x(i), y(v)); else ctx.lineTo(x(i), y(v));
        }
        ctx.stroke();
        ctx.fillStyle = "#000";
        ctx.fillText("Target", padL + 6, padT + 12);

        ctx.strokeStyle = "#555";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
            const v = s[i] || 0;
            if (i === 0) ctx.moveTo(x(i), y(v)); else ctx.lineTo(x(i), y(v));
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#555";
        ctx.fillText("Supply", padL + 60, padT + 12);
    }

    function renderPlanTotals(hostEl, plan, weekly) {
        if (!hostEl) return;
        const rows = computePlanCropTotals(plan, weekly);
        const esc = (v) => mxUtils.htmlEntities(String(v ?? ""));
        const fmt = (n) => Number.isFinite(n) ? n.toFixed(1) : "—";

        const EPS = 0.0001; // tolerance to avoid tiny float noise

        const trs = rows.map(r => {
            const name =
                `${r.crop.plant || ""}${r.crop.variety ? " — " + r.crop.variety : ""}`.trim() || r.crop.id;

            const target = Number(r.targetKg);
            const supply = Number(r.supplyKg);
            const hasTarget = Number.isFinite(target);
            const hasSupply = Number.isFinite(supply);

            const shortKg = (hasTarget && hasSupply) ? Math.max(0, target - supply) : NaN;
            const surplusKg = (hasTarget && hasSupply) ? Math.max(0, supply - target) : NaN;

            // Supply is only meaningful if the user set actualPlants 
            const hasActual = Number.isFinite(Number(r.crop.actualPlants)) && Number(r.crop.actualPlants) > 0;

            let flag = "EST";
            if (hasActual && hasTarget && hasSupply) {
                if (shortKg > EPS) flag = "SHORT";
                else if (surplusKg > EPS) flag = "SURPLUS";
                else flag = "OK";
            }

            return `<tr>
                <td style="border:1px solid #ddd;padding:4px;white-space:nowrap;">${esc(name)}</td>
                <td style="border:1px solid #ddd;padding:4px;text-align:right;">${fmt(target)}</td>
                <td style="border:1px solid #ddd;padding:4px;text-align:right;">${fmt(supply)}</td>
                <td style="border:1px solid #ddd;padding:4px;text-align:right;">${fmt(shortKg)}</td>     <!-- NEW -->
                <td style="border:1px solid #ddd;padding:4px;text-align:right;">${fmt(surplusKg)}</td>   <!-- NEW -->
                <td style="border:1px solid #ddd;padding:4px;text-align:right;">${fmt(r.plantsReq)}</td>
                <td style="border:1px solid #ddd;padding:4px;text-align:center;">${esc(flag)}</td>
            </tr>`;
        }).join("");

        hostEl.innerHTML = `
          <table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr>
                <th style="border:1px solid #ddd;padding:4px;text-align:left;">Crop</th>
                <th style="border:1px solid #ddd;padding:4px;text-align:right;">Target kg</th>
                <th style="border:1px solid #ddd;padding:4px;text-align:right;">Supply kg</th>
                <th style="border:1px solid #ddd;padding:4px;text-align:right;">Short kg</th>     <!-- NEW -->
                <th style="border:1px solid #ddd;padding:4px;text-align:right;">Surplus kg</th>   <!-- NEW -->
                <th style="border:1px solid #ddd;padding:4px;text-align:right;">Plants req</th>
                <th style="border:1px solid #ddd;padding:4px;text-align:center;">Flag</th>
              </tr>
            </thead>
            <tbody>${trs || `<tr><td colspan="7" style="border:1px solid #ddd;padding:6px;">No crops.</td></tr>`}</tbody> <!-- CHANGE -->
          </table>
        `.trim();
    }















    // ------------ openPlanModal --------------
    function openPlanModal(moduleCell, year) {
        closeSession();

        let currentYear = year;

        const __actualControlsByCropId = new Map();
        const __requiredControlsByCropId = new Map();

        const existing = loadPlanForYear(moduleCell, year);
        const plan = existing || {
            version: 1,
            year: year,
            weekStartDow: 1,
            crops: [],
            csa: { enabled: false, boxesPerWeek: 0, start: "", end: "", components: [] }
        };

        const session = createSession(moduleCell, year, plan);
        controller.session = session;

        plan.year = currentYear;
        if (!Number.isFinite(plan.weekStartDow)) plan.weekStartDow = 1;
        if (!Array.isArray(plan.crops)) plan.crops = [];
        if (!plan.csa || typeof plan.csa !== "object") {
            plan.csa = { enabled: false, boxesPerWeek: 0, start: "", end: "", components: [] };
        }
        if (!Array.isArray(plan.csa.components)) plan.csa.components = [];


        const wrap = document.createElement("div");
        wrap.style.position = "fixed";
        wrap.style.left = "0";
        wrap.style.top = "0";
        wrap.style.right = "0";
        wrap.style.bottom = "0";
        wrap.style.zIndex = "9999";
        wrap.style.background = "rgba(0,0,0,0.35)";
        wrap.style.display = "flex";
        wrap.style.alignItems = "center";
        wrap.style.justifyContent = "center";

        const card = document.createElement("div");
        card.style.width = "980px";
        card.style.maxWidth = "96vw";
        card.style.maxHeight = "92vh";
        card.style.background = "#fff";
        card.style.border = "1px solid #777";
        card.style.borderRadius = "10px";
        card.style.boxShadow = "0 10px 30px rgba(0,0,0,0.25)";
        card.style.display = "flex";
        card.style.flexDirection = "column";
        card.style.overflow = "hidden";

        const head = document.createElement("div");
        head.style.padding = "10px 12px";
        head.style.borderBottom = "1px solid #ddd";
        head.style.display = "flex";
        head.style.alignItems = "center";
        head.style.justifyContent = "space-between";

        const btnBar = document.createElement("div");
        btnBar.style.display = "flex";
        btnBar.style.gap = "8px";

        const titleEl = document.createElement("div");
        titleEl.style.fontFamily = "Arial";
        titleEl.style.fontWeight = "700";
        titleEl.textContent = `Plan Year — ${currentYear}`;

        head.innerHTML = "";
        head.appendChild(titleEl);
        head.appendChild(btnBar);

        const mkBtn = (label) => {
            const b = document.createElement("button");
            b.textContent = label;
            b.style.border = "1px solid #777";
            b.style.borderRadius = "6px";
            b.style.background = "#fff";
            b.style.cursor = "pointer";
            b.style.padding = "6px 10px";
            b.style.fontFamily = "Arial";
            b.style.fontSize = "12px";
            return b;
        };

        const saveBtn = mkBtn("Save");
        const exportBtn = mkBtn("Export JSON");
        const resetBtn = mkBtn(existing ? "Reset" : "Clear");
        const closeBtn = mkBtn("Close");

        btnBar.appendChild(saveBtn);
        btnBar.appendChild(exportBtn);
        btnBar.appendChild(resetBtn);
        btnBar.appendChild(closeBtn);
        head.appendChild(btnBar);

        const reloadPlantsBtn = mkBtn("Reload plants");
        btnBar.insertBefore(reloadPlantsBtn, saveBtn);

        const body = document.createElement("div");
        body.style.padding = "12px";
        body.style.overflow = "auto";
        body.style.fontFamily = "Arial";
        body.style.fontSize = "12px";


        // ---- modal-scoped variety close listener ----
        const onVarietyEditorClosedGraph = function (sender, evt) {
            const cropId = String(evt.getProperty("cropId") || "").trim();
            const action = String(evt.getProperty("action") || "");
            const varietyIdRaw = evt.getProperty("varietyId");
            const varietyId = (varietyIdRaw == null || varietyIdRaw === "") ? null : Number(varietyIdRaw);
            const varietyName = String(evt.getProperty("varietyName") || "");

            if (!cropId) return;

            const crop = (plan.crops || []).find(c => String(c.id) === cropId);
            if (!crop) return;

            __varietyCacheByPlant.delete(String(crop.plantId || ""));

            if (action !== "cancel" && action !== "error" && varietyId != null && Number.isFinite(varietyId)) {
                crop.varietyId = varietyId;
                crop.variety = varietyName || "";
            }

            refreshVarietyDropdownForCrop(crop, true).then(() => {
                renderCrops();
                renderCsaSection();
                renderPreview();
            }).catch(e => console.warn("[YearPlanner] variety refresh failed", e));
        };

        addGraphListener(session, graph, "usl:varietyEditorClosed", onVarietyEditorClosedGraph);

        function closeThisModal() {
            closeSession();
        }

        closeBtn.addEventListener("click", (ev) => { ev.preventDefault(); closeThisModal(); });
        wrap.addEventListener("click", (ev) => { if (ev.target === wrap) closeThisModal(); });


        // UI skeleton (same as your current row-based MVP) -------------------
        const globalRow = document.createElement("div");
        globalRow.style.display = "flex";
        globalRow.style.flexWrap = "wrap";
        globalRow.style.gap = "10px";
        globalRow.style.alignItems = "center";
        globalRow.style.marginBottom = "10px";

        const yearInput = mkInput("number", year, 90);
        yearInput.min = "1900"; yearInput.max = "3000";

        const templateSel = document.createElement("select");
        templateSel.style.padding = "6px";
        templateSel.style.border = "1px solid #bbb";
        templateSel.style.borderRadius = "6px";
        templateSel.style.minWidth = "220px";

        const applyTemplateBtn = mkBtn("Apply template");
        const saveTemplateBtn = mkBtn("Save as template");
        const deleteTemplateBtn = mkBtn("Delete template");

        const cropFilterSel = document.createElement("select");
        cropFilterSel.style.padding = "6px";
        cropFilterSel.style.border = "1px solid #bbb";
        cropFilterSel.style.borderRadius = "6px";
        cropFilterSel.style.minWidth = "260px";

        globalRow.appendChild(document.createTextNode("Year"));
        globalRow.appendChild(yearInput);
        globalRow.appendChild(document.createTextNode("Template"));
        globalRow.appendChild(templateSel);
        globalRow.appendChild(applyTemplateBtn);
        globalRow.appendChild(saveTemplateBtn);
        globalRow.appendChild(deleteTemplateBtn);

        refreshTemplateDropdown();
        refreshCropFilterDropdown();

        const topRow = document.createElement("div");

        body.appendChild(globalRow);

        const plantSelect = document.createElement("select");
        plantSelect.style.flex = "1 1 auto";
        plantSelect.style.padding = "6px";
        plantSelect.style.border = "1px solid #bbb";
        plantSelect.style.borderRadius = "6px";

        const addCropBtn = mkBtn("Add crop");

        const msg = document.createElement("div");
        msg.style.color = "#555";
        msg.style.fontSize = "12px";
        msg.textContent = "Loading plants...";

        topRow.appendChild(plantSelect);
        topRow.appendChild(addCropBtn);
        topRow.appendChild(msg);

        const cropsBox = document.createElement("div");
        cropsBox.style.border = "1px solid #ddd";
        cropsBox.style.borderRadius = "8px";
        cropsBox.style.padding = "10px";
        cropsBox.style.marginBottom = "12px";

        const cropsTitle = document.createElement("div");
        cropsTitle.style.fontWeight = "700";
        cropsTitle.style.marginBottom = "8px";
        cropsTitle.textContent = "Crops";
        cropsBox.appendChild(cropsTitle);

        const cropsList = document.createElement("div");
        cropsList.style.display = "flex";
        cropsList.style.flexDirection = "column";
        cropsList.style.gap = "10px";
        cropsBox.appendChild(cropsList);

        const preview = document.createElement("div");
        preview.style.display = "grid";
        preview.style.gridTemplateColumns = "1fr 1fr";
        preview.style.gap = "12px";

        const chartBox = document.createElement("div");
        chartBox.style.border = "1px solid #ddd";
        chartBox.style.borderRadius = "8px";
        chartBox.style.padding = "8px";
        chartBox.innerHTML = `<div style="font-weight:700;margin-bottom:6px;">Weekly kg (Target vs Supply)</div>`;

        const chartControlsRow = document.createElement("div");
        chartControlsRow.style.display = "flex";
        chartControlsRow.style.flexWrap = "wrap";
        chartControlsRow.style.gap = "10px";
        chartControlsRow.style.alignItems = "center";
        chartControlsRow.style.marginBottom = "8px";

        chartControlsRow.appendChild(document.createTextNode("Crop filter"));
        chartControlsRow.appendChild(cropFilterSel);

        chartBox.appendChild(chartControlsRow);

        const canvas = document.createElement("canvas");
        canvas.width = 900;
        canvas.height = 220;
        canvas.style.width = "100%";
        canvas.style.height = "220px";
        chartBox.appendChild(canvas);


        const tableBox = document.createElement("div");
        tableBox.style.border = "1px solid #ddd";
        tableBox.style.borderRadius = "8px";
        tableBox.style.padding = "8px";
        tableBox.innerHTML = `<div style="font-weight:700;margin-bottom:6px;">Totals</div><div id="planTotals"></div>`;

        preview.appendChild(chartBox);
        preview.appendChild(tableBox);

        body.appendChild(topRow);

        const warnBox = document.createElement("div");
        warnBox.style.border = "1px solid #f0c36d";
        warnBox.style.background = "#fff8e1";
        warnBox.style.borderRadius = "8px";
        warnBox.style.padding = "8px";
        warnBox.style.marginBottom = "12px";
        warnBox.style.display = "none";
        body.appendChild(warnBox);

        body.appendChild(cropsBox);
        body.appendChild(preview);

        card.appendChild(head);
        card.appendChild(body);
        wrap.appendChild(card);

        document.body.appendChild(wrap);
        session.ui.modalEl = wrap;

        // --------------------- UI helpers --------------------

        function mkInput(type, val, wPx) {
            const i = document.createElement("input");
            i.type = type;
            if (val != null) i.value = String(val);
            i.style.padding = "5px 6px";
            i.style.border = "1px solid #bbb";
            i.style.borderRadius = "6px";
            if (wPx) i.style.width = wPx + "px";
            return i;
        }

        function mkSelect(options, value, wPx) {
            const s = document.createElement("select");
            s.style.padding = "5px 6px";
            s.style.border = "1px solid #bbb";
            s.style.borderRadius = "6px";
            if (wPx) s.style.width = wPx + "px";
            for (const opt of options) {
                const o = document.createElement("option");
                o.value = String(opt.value);
                o.textContent = String(opt.label);
                s.appendChild(o);
            }
            s.value = String(value ?? "");
            return s;
        }

        function listUnitOptionsForCrop(crop) {
            const opts = [];
            const seen = new Set();
            const add = (v, label) => {
                const key = String(v || "").trim().toLowerCase();
                if (!key || seen.has(key)) return;
                seen.add(key);
                opts.push({ value: String(v), label: String(label ?? v) });
            };

            add("kg", "kg");
            add("g", "g");
            add("lb", "lb");
            add("plant", "plant");

            for (const p of (crop && crop.packages) ? crop.packages : []) {
                const u = String(p && p.unit || "").trim();
                if (!u) continue;
                add(u, u);
            }

            return opts;
        }

        function readYieldOverrideKgFromOverridesJson(overridesJson) {
            const obj = safeJsonStringParse(overridesJson, null);
            if (!obj || typeof obj !== "object") return null;

            // Preferred key (your stated convention)
            const v1 = Number(obj.yield_per_plant_kg);
            if (Number.isFinite(v1) && v1 > 0) return v1;

            // Optional: support alternate nesting if you used it elsewhere
            const v2 = Number(obj?.overrides?.yield_per_plant_kg);
            if (Number.isFinite(v2) && v2 > 0) return v2;

            return null;
        }

        function shouldAutoReplaceNumber(cur, lastAuto) {
            const c = Number(cur);
            const a = Number(lastAuto);
            if (!Number.isFinite(c)) return Number.isFinite(a);               // only auto-replace NaN if we previously auto-set
            if (Number.isFinite(a) && c === a) return true;
            return false;
        }

        function setKgPerPlantAuto(crop, nextKg) {
            if (!crop) return;
            if (!Number.isFinite(Number(nextKg)) || Number(nextKg) <= 0) return;
            if (shouldAutoReplaceNumber(crop.kgPerPlant, crop.__kgpp_lastAuto)) {
                crop.kgPerPlant = Number(nextKg);
                crop.__kgpp_lastAuto = Number(nextKg);
            }
        }

        function mkUnitSelectForCrop(crop, value, wPx) {
            const opts = listUnitOptionsForCrop(crop);
            const sel = mkSelect(opts, value ?? "kg", wPx);
            return sel;
        }

        function pickDefaultUnitForCrop(crop) {
            const firstPack = (crop && Array.isArray(crop.packages) && crop.packages[0])
                ? String(crop.packages[0].unit || "").trim()
                : "";
            return firstPack || "kg";
        }


        function labelCrop(c) {
            const a = (c.plant || "").trim();
            const b = (c.variety || "").trim();
            return (a && b) ? `${a} — ${b}` : (a || b || c.id);
        }

        function addDaysYmd(ymd, days) {
            const ms = parseYmdLocalToMs(ymd);
            if (!Number.isFinite(ms)) return null;
            return toIsoDateLocal(new Date(addDaysMs(ms, days)));
        }

        function subDaysYmd(ymd, days) {
            return addDaysYmd(ymd, -Number(days || 0));
        }

        function getShelfDays(crop) {
            return Number.isFinite(Number(crop && crop.shelfLifeDays))
                ? Math.trunc(Number(crop.shelfLifeDays))
                : 0;
        }

        function ensureMarketBaseTo(crop, mkt) {
            if (!mkt) return;
            if (hasYmd(mkt.__baseTo)) return;

            // Derive baseTo from current to when enabling sync.                          
            // If current to already looks like "harvestEnd + shelf", use harvestEnd.     
            const shelf = getShelfDays(crop);
            const he = crop && crop.harvestEnd;
            const availEnd = cropAvailEndYmd(crop);

            if (hasYmd(he) && hasYmd(availEnd) && hasYmd(mkt.to) && String(mkt.to) === String(availEnd)) {
                mkt.__baseTo = String(he);
            } else if (hasYmd(mkt.to)) {
                mkt.__baseTo = String(mkt.to);
            } else if (hasYmd(he)) {
                mkt.__baseTo = String(he);
            } else {
                mkt.__baseTo = "";
            }
        }

        function applyShelfToMarketTo(crop, mkt) {
            if (!mkt) return;
            ensureMarketBaseTo(crop, mkt);
            const shelf = getShelfDays(crop);
            if (hasYmd(mkt.__baseTo)) {
                mkt.to = addDaysYmd(mkt.__baseTo, shelf) || mkt.to;
            }
        }

        function removeShelfFromMarketTo(crop, mkt) {
            if (!mkt) return;
            ensureMarketBaseTo(crop, mkt);
            if (hasYmd(mkt.__baseTo)) mkt.to = String(mkt.__baseTo);
        }


        function cropAvailEndYmd(c) {
            if (!hasYmd(c.harvestEnd)) return null;
            const shelf = Number.isFinite(Number(c.shelfLifeDays)) ? Number(c.shelfLifeDays) : 0;
            return addDaysYmd(c.harvestEnd, shelf) || c.harvestEnd;
        }



        function autoFillAndClampCsa(plan) {
            plan.csa = plan.csa || { enabled: false, boxesPerWeek: 0, start: "", end: "", components: [] };
            if (!Array.isArray(plan.csa.components)) plan.csa.components = [];

            // Auto-fill CSA start/end from crop windows if missing                          
            const crops = (plan.crops || []).filter(c => hasYmd(c.harvestStart) && hasYmd(c.harvestEnd));
            if (crops.length) {
                const minStart = crops.reduce((a, c) => (a < c.harvestStart ? a : c.harvestStart), crops[0].harvestStart);
                const maxEnd = crops.reduce((a, c) => {
                    const e = cropAvailEndYmd(c) || c.harvestEnd;
                    return (a > e ? a : e);
                }, cropAvailEndYmd(crops[0]) || crops[0].harvestEnd);

                if (!hasYmd(plan.csa.start)) plan.csa.start = minStart;
                if (!hasYmd(plan.csa.end)) plan.csa.end = maxEnd;
            }

            // Clamp CSA component dates into crop availability (incl shelf life)            
            const byId = new Map((plan.crops || []).map(c => [c.id, c]));
            for (const comp of plan.csa.components) {
                const crop = byId.get(comp.cropId);
                if (!crop) continue;

                if (!hasYmd(comp.start) && hasYmd(plan.csa.start)) comp.start = plan.csa.start;
                if (!hasYmd(comp.end) && hasYmd(plan.csa.end)) comp.end = plan.csa.end;

                if (hasYmd(crop.harvestStart) && hasYmd(comp.start) && comp.start < crop.harvestStart) comp.start = crop.harvestStart;
                const endMax = cropAvailEndYmd(crop);
                if (endMax && hasYmd(comp.end) && comp.end > endMax) comp.end = endMax;
            }
        }

        function ymdMin(a, b) {
            if (!hasYmd(a)) return b;
            if (!hasYmd(b)) return a;
            return (a < b) ? a : b;
        }

        function ymdMax(a, b) {
            if (!hasYmd(a)) return b;
            if (!hasYmd(b)) return a;
            return (a > b) ? a : b;
        }

        function isBlankYmd(s) {
            return !hasYmd(s);
        }

        function clampYmdIntoRange(v, lo, hi) {
            if (!hasYmd(v) || (!hasYmd(lo) && !hasYmd(hi))) return v;
            let out = v;
            if (hasYmd(lo) && hasYmd(out) && out < lo) out = lo;
            if (hasYmd(hi) && hasYmd(out) && out > hi) out = hi;
            return out;
        }

        function shouldAutoReplaceDate(cur, lastAuto) {
            // Replace only if blank or still equal to the last auto-set value           
            if (isBlankYmd(cur)) return true;
            if (hasYmd(lastAuto) && cur === lastAuto) return true;
            return false;
        }

        function syncactualPlantsInputs() {
            for (const c of (plan.crops || [])) {
                const ctl = __actualControlsByCropId.get(c.id);
                if (!ctl || !ctl.input) continue;
                const v = Number(c.actualPlants);
                ctl.input.value = String((Number.isFinite(v) && v > 0) ? Math.trunc(v) : 0);
            }
        }


        function syncRequiredPlantsInputs(cropTotalsRows) {
            const byId = new Map();
            for (const r of (cropTotalsRows || [])) {
                const id = String(r?.crop?.id || "");
                if (!id) continue;
                byId.set(id, r);
            }

            for (const c of (plan.crops || [])) {
                const ctl = __requiredControlsByCropId.get(c.id);
                if (!ctl || !ctl.input) continue;

                const r = byId.get(String(c.id)) || null;
                const pr = r ? Number(r.plantsReq) : NaN;

                // Display as integer plants (ceil). If NaN/<=0 => 0. 
                const shown = (Number.isFinite(pr) && pr > 0) ? Math.ceil(pr) : 0;
                ctl.input.value = String(shown);
            }
        }

        function syncactualPlantsInputs() {
            for (const c of (plan.crops || [])) {
                const ctl = __actualControlsByCropId.get(c.id);
                if (!ctl || !ctl.input) continue;
                const v = Number(c.actualPlants);
                ctl.input.value = String((Number.isFinite(v) && v > 0) ? Math.trunc(v) : 0);
            }
        }

        function renderHarvestDots(hostEl, weekStarts, weeklyKg) {
            if (!hostEl) return;
            const series = Array.isArray(weeklyKg) ? weeklyKg : [];
            const n = weekStarts.length;

            hostEl.innerHTML = "";
            hostEl.style.display = "flex";
            hostEl.style.flexWrap = "wrap";
            hostEl.style.gap = "2px";
            hostEl.style.alignItems = "center";
            hostEl.style.marginTop = "4px";

            const maxV = Math.max(0, ...series.map(x => Number(x) || 0));
            const norm = (v) => {
                const x = Math.max(0, Number(v) || 0);
                if (!(maxV > 0)) return 0;
                return Math.min(1, x / maxV);
            };

            for (let i = 0; i < n; i++) {
                const v = Number(series[i]) || 0;
                const t = norm(v);

                const dot = document.createElement("div");
                dot.style.width = "6px";
                dot.style.height = "6px";
                dot.style.borderRadius = "999px";
                dot.style.border = "1px solid rgba(0,0,0,0.25)";
                dot.style.background = `rgba(0,0,0,${0.05 + 0.85 * t})`;

                const iso = weekStarts[i] ? weekStarts[i].iso : "";
                dot.title = `${iso}  •  ${v.toFixed(2)} kg/week`;

                hostEl.appendChild(dot);
            }
        }

        function syncCropDatesIfEnabled(crop, oldSnap) {
            if (!crop || !crop.syncharvest) return;
            const hs = crop.harvestStart;
            const he = crop.harvestEnd;
            const availEnd = cropAvailEndYmd(crop);
            const planCsa = plan && plan.csa ? plan.csa : null;

            // Initialize sync memory if absent                                          
            crop.__sync_lastHarvestStart = crop.__sync_lastHarvestStart ?? (oldSnap && oldSnap.hs) ?? "";
            crop.__sync_lastHarvestEnd = crop.__sync_lastHarvestEnd ?? (oldSnap && oldSnap.he) ?? "";
            crop.__sync_lastAvailEnd = crop.__sync_lastAvailEnd ?? (oldSnap && oldSnap.availEnd) ?? "";



            // ---- Market lines ------------------------------------------------------  
            crop.market = crop.market || [];
            for (const mkt of crop.market) {
                if (!mkt) continue;

                // From: fill/clamp                                                     
                if (shouldAutoReplaceDate(mkt.from, crop.__sync_lastHarvestStart) && hasYmd(hs)) {
                    mkt.from = hs;
                }
                mkt.from = clampYmdIntoRange(mkt.from, hs, availEnd);

                // To: fill/clamp (prefer availEnd when present)
                const lastAutoTo = crop.__sync_lastAvailEnd || crop.__sync_lastHarvestEnd;

                // if "to" is still exactly harvestEnd, treat it as auto and let it track shelf life
                const looksAutoHarvestEnd =
                    hasYmd(he) && hasYmd(mkt.to) && String(mkt.to) === String(he);

                if (shouldAutoReplaceDate(mkt.to, lastAutoTo) || looksAutoHarvestEnd) {
                    if (hasYmd(availEnd)) mkt.to = availEnd;
                    else if (hasYmd(he)) mkt.to = he;
                }

                mkt.to = clampYmdIntoRange(mkt.to, hs, availEnd);

            }

            // ---- CSA components referencing this crop ------------------------------  
            if (planCsa && Array.isArray(planCsa.components)) {
                for (const comp of planCsa.components) {
                    if (!comp || comp.cropId !== crop.id) continue;

                    // Start: fill/clamp                                                 
                    const csaStart = planCsa.start;
                    const desiredStart = hasYmd(hs) ? ymdMax(hs, csaStart) : csaStart;
                    if (shouldAutoReplaceDate(comp.start, crop.__sync_lastHarvestStart) && hasYmd(desiredStart)) {
                        comp.start = desiredStart;
                    }
                    comp.start = clampYmdIntoRange(comp.start, hs, availEnd);

                    // End: fill/clamp                                                   
                    const csaEnd = planCsa.end;
                    const desiredEnd = hasYmd(availEnd) ? ymdMin(availEnd, csaEnd) : (hasYmd(he) ? ymdMin(he, csaEnd) : csaEnd);
                    const lastAutoEnd = crop.__sync_lastAvailEnd || crop.__sync_lastHarvestEnd;
                    if (shouldAutoReplaceDate(comp.end, lastAutoEnd) && hasYmd(desiredEnd)) {
                        comp.end = desiredEnd;
                    }
                    comp.end = clampYmdIntoRange(comp.end, hs, availEnd);
                }
            }

            // Update sync memory after applying                                         
            crop.__sync_lastHarvestStart = hasYmd(hs) ? hs : crop.__sync_lastHarvestStart;
            crop.__sync_lastHarvestEnd = hasYmd(he) ? he : crop.__sync_lastHarvestEnd;
            crop.__sync_lastAvailEnd = hasYmd(availEnd) ? availEnd : crop.__sync_lastAvailEnd;
        }

        function snapshotMarketToBeforeSync(crop) {
            if (!crop) return;
            crop.market = crop.market || [];
            for (const mkt of crop.market) {
                if (!mkt) continue;
                if (mkt.__preSyncTo === undefined) {
                    mkt.__preSyncTo = String(mkt.to || "");
                }
            }
        }

        function restoreMarketToAfterUnsync(crop) {
            if (!crop) return;
            crop.market = crop.market || [];
            for (const mkt of crop.market) {
                if (!mkt) continue;
                if (mkt.__preSyncTo !== undefined) {
                    mkt.to = String(mkt.__preSyncTo || "");
                    delete mkt.__preSyncTo;
                }
            }
        }

        // -------------------- Variety dropdown helpers --------------------  
        const __varietyCacheByPlant = new Map();
        const __varietyControlsByCropId = new Map();

        async function getVarietyOptionsForPlantCached(plantId, force = false) {
            const key = String(plantId || "").trim();
            if (!key) return { opts: [{ value: "", label: "(base plant)" }], byId: new Map() };

            if (!force && __varietyCacheByPlant.has(key)) return __varietyCacheByPlant.get(key);

            const rows = await queryVarietiesByPlantId(key);
            const byId = new Map();
            const opts = [{ value: "", label: "(base plant)" }].concat(
                rows.map(r => {
                    const id = String(r.variety_id);
                    const name = String(r.variety_name || "");
                    const ykg = readYieldOverrideKgFromOverridesJson(r.overrides_json);
                    byId.set(id, { name, yieldKg: ykg });
                    return { value: id, label: name };
                })
            );

            const pack = { opts, byId };
            __varietyCacheByPlant.set(key, pack);
            return pack;
        }

        function fillSelectOptions(sel, options, value) {
            sel.innerHTML = "";
            for (const opt of (options || [])) {
                const o = document.createElement("option");
                o.value = String(opt.value);
                o.textContent = String(opt.label);
                sel.appendChild(o);
            }
            sel.value = String(value ?? "");
        }

        async function refreshVarietyDropdownForCrop(crop, force = false) {
            const ctl = __varietyControlsByCropId.get(crop.id);
            if (!ctl || !ctl.sel) return;

            const sel = ctl.sel;
            sel.disabled = true;
            try {
                const pack = await getVarietyOptionsForPlantCached(crop.plantId, force);
                const desired = crop.varietyId ? String(crop.varietyId) : "";
                fillSelectOptions(sel, pack.opts, desired);

                // Keep crop.variety (name) coherent with selection            
                const rec = pack.byId.get(String(sel.value || "")) || null;
                const name = rec ? String(rec.name || "") : "";
                crop.varietyId = sel.value ? Number(sel.value) : null;
                crop.variety = sel.value ? String(name) : "";

                if (sel.value) {
                    if (rec && rec.yieldKg) setKgPerPlantAuto(crop, rec.yieldKg);
                } else {
                    if (Number.isFinite(Number(crop.__baseKgPerPlant)) && Number(crop.__baseKgPerPlant) > 0) {
                        setKgPerPlantAuto(crop, crop.__baseKgPerPlant);
                    }
                }

            } finally {
                sel.disabled = false;
            }
        }

        function dispatchOpenVarietyEditor(graph, { cropId, plantId, varietyId = null }) {
            try {
                graph.fireEvent(new mxEventObject(
                    "usl:openVarietyEditor",
                    "cropId", String(cropId || ""),
                    "plantId", Number(plantId),
                    "varietyId", (varietyId == null || varietyId === "") ? null : Number(varietyId)
                ));
            } catch (e) {
                console.error("[USL][YearPlanner] Failed to fire usl:openVarietyEditor", e);
            }
        }

        // -------------------- Refresh helpers --------------------

        function refreshTemplateDropdown() {
            templateSel.innerHTML = "";
            const o0 = document.createElement("option");
            o0.value = ""; o0.textContent = "-- Select template --";
            templateSel.appendChild(o0);
            for (const name of listTemplateNames()) {
                const o = document.createElement("option");
                o.value = name; o.textContent = name;
                templateSel.appendChild(o);
            }
        }

        function refreshCropFilterDropdown() {
            cropFilterSel.innerHTML = "";
            const o0 = document.createElement("option");
            o0.value = ""; o0.textContent = "-- All crops --";
            cropFilterSel.appendChild(o0);
            for (const c of (plan.crops || [])) {
                const o = document.createElement("option");
                o.value = c.id; o.textContent = labelCrop(c);
                cropFilterSel.appendChild(o);
            }
            cropFilterSel.value = String(plan.cropFilterId || "");
        }


        function renderPreview() {
            autoFillAndClampCsa(plan);

            applyactualPlantsFromModuleToPlan(moduleCell, currentYear, plan);

            syncactualPlantsInputs();

            const warnings = [];

            // build weekStarts once (same basis as computePlanWeekly)
            const weekStartDow = Number.isFinite(plan && plan.weekStartDow) ? plan.weekStartDow : 1;
            const weekStarts = buildWeekStartsForYearLocal(Number(plan.year), weekStartDow);

            // derive harvest windows + store per-week actual harvest series on crops
            applyActualHarvestFromModuleToPlan(moduleCell, currentYear, plan, weekStarts);

            // draw dot heatmap under each crop
            const vizMap = session.ui.harvestVizByCropId;
            if (vizMap && vizMap.size) {
                for (const c of (plan.crops || [])) {
                    const ctl = vizMap.get(c.id);
                    if (!ctl || !ctl.host) continue;
                    renderHarvestDots(ctl.host, weekStarts, c.__actualHarvestWeeklyKg || []);
                }
            }

            const weekly = computePlanWeekly(plan, warnings);

            const totalsRows = computePlanCropTotals(plan, weekly);

            // Persist computed requirements onto the plan crop objects.                         
            const totalsById = new Map();
            for (const r of (totalsRows || [])) {
                const id = String(r?.crop?.id || "");
                if (!id) continue;
                totalsById.set(id, r);
            }

            for (const c of (plan.crops || [])) {
                const r = totalsById.get(String(c.id)) || null;
                const pr = r ? Number(r.plantsReq) : NaN;
                const sr = r ? Number(r.seedsReq) : NaN;

                // Store as integers; NaN/<=0 => 0.                                            
                c.plantsReq = (Number.isFinite(pr) && pr > 0) ? Math.ceil(pr) : 0;
                c.seedsReq = (Number.isFinite(sr) && sr > 0) ? Math.ceil(sr) : 0;
            }

            syncRequiredPlantsInputs(totalsRows);

            const cropId = String(plan.cropFilterId || "");

            if (cropId) {
                const v = weekly.perCrop.get(cropId);
                const t = v ? v.target : [];
                const s = v ? v.supply : [];
                drawPlanChart(canvas, weekly, t, s);
            } else {
                drawPlanChart(canvas, weekly);
                if (!warnings.includes("Select a crop to view the per-crop chart.")) {
                    warnings.push("Select a crop to view the per-crop chart.");
                }
            }

            renderPlanTotals(tableBox.querySelector("#planTotals"), plan, weekly);

            if (warnings.length) {
                warnBox.style.display = "block";
                warnBox.innerHTML =
                    `<div style="font-weight:700;margin-bottom:4px;">Warnings</div>` +
                    warnings.map(w => `<div>• ${mxUtils.htmlEntities(w)}</div>`).join("");
            } else {
                warnBox.style.display = "none";
                warnBox.innerHTML = "";
            }
        }


        function showWarnings(list) {
            const msgs = Array.isArray(list) ? list.filter(Boolean) : [];
            if (msgs.length === 0) { warnBox.style.display = "none"; warnBox.innerHTML = ""; return; }
            warnBox.style.display = "block";
            warnBox.innerHTML = `<div style="font-weight:700;margin-bottom:6px;">Warnings</div>` +
                `<ul style="margin:0 0 0 18px;padding:0;">${msgs.map(m => `<li>${mxUtils.htmlEntities(m)}</li>`).join("")}</ul>`;
        }

        function renderCrops() {
            cropsList.innerHTML = "";

            session.ui.harvestVizByCropId.clear();

            __requiredControlsByCropId.clear();

            const crops = plan.crops || [];

            for (const crop of crops) {
                const panel = document.createElement("div");
                panel.style.border = "1px solid #eee";
                panel.style.borderRadius = "8px";
                panel.style.padding = "10px";

                const header = document.createElement("div");
                header.style.display = "flex";
                header.style.justifyContent = "space-between";
                header.style.alignItems = "center";
                header.style.marginBottom = "8px";

                const title = document.createElement("div");
                title.style.fontWeight = "700";
                title.textContent = labelCrop(crop);

                const delCrop = mkBtn("Remove crop");
                header.appendChild(title);
                header.appendChild(delCrop);

                // --- crop fields ------------------------------------------------------ 
                const row = document.createElement("div");
                row.style.display = "flex";
                row.style.flexWrap = "wrap";
                row.style.gap = "8px";
                row.style.alignItems = "center";

                const varietySel = document.createElement("select");
                varietySel.style.padding = "5px 6px";
                varietySel.style.border = "1px solid #bbb";
                varietySel.style.borderRadius = "6px";
                varietySel.style.width = "220px";

                const varietyAddBtn = mkBtn("+");
                varietyAddBtn.style.padding = "6px 10px";

                const kgpp = mkInput("number", crop.kgPerPlant ?? "", 110);
                const hs = mkInput("date", crop.harvestStart ?? "", 150);
                const he = mkInput("date", crop.harvestEnd ?? "", 150);
                const shelf = mkInput("number", crop.shelfLifeDays ?? 0, 90);
                const actual = mkInput("number", crop.actualPlants ?? 0, 120);
                actual.disabled = true;
                actual.title = "Auto from diagram tiler groups (sum of plant_count for this crop in the selected year).";
                __actualControlsByCropId.set(crop.id, { input: actual });

                const requiredPlants = mkInput("number", 0, 120);
                requiredPlants.disabled = true;
                requiredPlants.title = "Plants required to meet the plan target (computed from demand and kg/plant). Rounded up.";
                __requiredControlsByCropId.set(crop.id, { input: requiredPlants });

                actual.value = String(
                    Number.isFinite(Number(crop.actualPlants))
                        ? Math.trunc(Number(crop.actualPlants))
                        : 0
                );

                const germ = mkInput("number", (crop.germRate ?? 0.85), 90);
                germ.min = "0.01";
                germ.max = "1";
                germ.step = "0.01";
                germ.title = "Germination rate (0..1). Used to compute required seeds.";

                const syncharvestCb = document.createElement("input");
                syncharvestCb.type = "checkbox";
                syncharvestCb.checked = !!crop.syncharvest;

                const syncharvestLab = document.createElement("label");
                syncharvestLab.style.display = "flex";
                syncharvestLab.style.alignItems = "center";
                syncharvestLab.style.gap = "6px";
                syncharvestLab.appendChild(syncharvestCb);
                syncharvestLab.appendChild(document.createTextNode("Sync availability"));

                const useActualCb = document.createElement("input");
                useActualCb.type = "checkbox";
                useActualCb.checked = (crop.useActualHarvest !== false); // default true

                const useActualLab = document.createElement("label");
                useActualLab.style.display = "flex";
                useActualLab.style.alignItems = "center";
                useActualLab.style.gap = "6px";
                useActualLab.appendChild(useActualCb);
                useActualLab.appendChild(document.createTextNode("Use actual harvest"));

                const harvestViz = document.createElement("div");
                harvestViz.style.width = "100%";

                // Disable manual date inputs when using actual harvest                              
                hs.disabled = useActualCb.checked;
                he.disabled = useActualCb.checked;
                hs.title = useActualCb.checked ? "Derived from tiler group harvest dates." : "";
                he.title = useActualCb.checked ? "Derived from tiler group harvest dates." : "";

                // Put toggle near harvest fields                                                     
                row.appendChild(useActualLab);

                // Store control for later updates                                                   
                session.ui.harvestVizByCropId.set(crop.id, { host: harvestViz, cb: useActualCb, hs, he });

                useActualCb.addEventListener("change", () => {
                    crop.useActualHarvest = !!useActualCb.checked;
                    hs.disabled = !!crop.useActualHarvest;
                    he.disabled = !!crop.useActualHarvest;
                    renderPreview();
                });

                row.appendChild(document.createTextNode("Variety"));
                row.appendChild(varietySel);
                row.appendChild(varietyAddBtn);

                row.appendChild(document.createTextNode("kg/plant"));
                row.appendChild(kgpp);
                row.appendChild(document.createTextNode("Harvest"));
                row.appendChild(hs);
                row.appendChild(document.createTextNode("→"));
                row.appendChild(he);
                row.appendChild(document.createTextNode("Shelf (days)"));
                row.appendChild(shelf);
                row.appendChild(syncharvestLab);

                row.appendChild(document.createTextNode("plants req"));
                row.appendChild(requiredPlants);

                row.appendChild(document.createTextNode("actual plants"));
                row.appendChild(actual);

                row.appendChild(document.createTextNode("Germ rate"));
                row.appendChild(germ);

                // --- packages --------------------------------------------------------- 
                const packsTitle = document.createElement("div");
                packsTitle.style.fontWeight = "700";
                packsTitle.style.margin = "10px 0 6px";
                packsTitle.textContent = "Packages (display units)";

                const saveDefRow = document.createElement("div");
                saveDefRow.style.display = "flex";
                saveDefRow.style.alignItems = "center";
                saveDefRow.style.gap = "8px";
                saveDefRow.style.marginBottom = "6px";

                const saveDefCb = document.createElement("input");
                saveDefCb.type = "checkbox";
                saveDefCb.checked = !!crop.savePackagesAsDefault;

                const saveDefLab = document.createElement("label");
                saveDefLab.style.display = "flex";
                saveDefLab.style.alignItems = "center";
                saveDefLab.style.gap = "6px";
                saveDefLab.appendChild(saveDefCb);
                saveDefLab.appendChild(document.createTextNode("Save as default for plant"));

                saveDefRow.appendChild(saveDefLab);
                panel.appendChild(saveDefRow);

                saveDefCb.addEventListener("change", () => {
                    crop.savePackagesAsDefault = !!saveDefCb.checked;
                });

                const packsWrap = document.createElement("div");
                packsWrap.style.display = "flex";
                packsWrap.style.flexDirection = "column";
                packsWrap.style.gap = "6px";

                const addPackBtn = mkBtn("Add package");
                addPackBtn.style.marginTop = "6px";

                function renderPacks() {
                    packsWrap.innerHTML = "";
                    crop.packages = crop.packages || [];
                    for (const p of crop.packages) {
                        const line = document.createElement("div");
                        line.style.display = "flex";
                        line.style.gap = "8px";
                        line.style.alignItems = "center";

                        const unit = mkInput("text", p.unit ?? "bunch", 90);
                        const baseType = mkSelect(
                            [{ value: "kg", label: "kg" }, { value: "plant", label: "plant" }],
                            p.baseType ?? "kg",
                            90
                        );
                        const baseQty = mkInput("number", p.baseQty ?? 1, 90);
                        const price = mkInput("number", p.price ?? "", 90);
                        const del = mkBtn("Remove");

                        line.appendChild(document.createTextNode("1"));
                        line.appendChild(unit);
                        line.appendChild(document.createTextNode("="));
                        line.appendChild(baseQty);
                        line.appendChild(baseType);
                        line.appendChild(document.createTextNode("Price"));
                        line.appendChild(price);
                        line.appendChild(del);

                        unit.addEventListener("input", () => {
                            p.unit = String(unit.value || "");
                            renderMarket();
                            renderCsaSection();
                            renderPreview();
                        });
                        baseType.addEventListener("change", () => {
                            p.baseType = String(baseType.value || "kg");
                            renderMarket();
                            renderCsaSection();
                            renderPreview();
                        });

                        baseQty.min = "1";
                        price.min = "0";

                        baseQty.addEventListener("input", () => {
                            p.baseQty = clampNonNegNum(baseQty.value, 1);
                            baseQty.value = String(p.baseQty);
                            renderMarket();
                            renderCsaSection();
                            renderPreview();
                        });

                        price.addEventListener("input", () => {
                            p.price = clampNonNegNum(price.value, NaN);
                            price.value = Number.isFinite(Number(p.price)) ? String(p.price) : "";
                        });


                        del.addEventListener("click", (ev) => {
                            ev.preventDefault();
                            crop.packages = crop.packages.filter(x => x !== p);
                            renderPacks();
                            renderCsaSection();
                            renderPreview();
                        });

                        packsWrap.appendChild(line);
                    }
                }

                syncharvestCb.addEventListener("change", () => {
                    crop.syncharvest = !!syncharvestCb.checked;
                    crop.market = crop.market || [];

                    if (crop.syncharvest) {
                        for (const mkt of crop.market) applyShelfToMarketTo(crop, mkt);
                        renderMarket();
                        renderCsaSection();
                    } else {
                        for (const mkt of crop.market) removeShelfFromMarketTo(crop, mkt);
                        renderMarket();
                    }

                    renderPreview();
                });


                germ.addEventListener("input", () => {
                    const v = Number(germ.value);
                    // clamp to (0,1]; blank -> default 0.85                     
                    if (!Number.isFinite(v)) {
                        crop.germRate = 0.85;
                        germ.value = String(crop.germRate);
                    } else {
                        crop.germRate = Math.max(0.01, Math.min(1, v));
                        germ.value = String(crop.germRate);
                    }
                    renderPreview();
                });


                addPackBtn.addEventListener("click", (ev) => {
                    ev.preventDefault();
                    crop.packages = crop.packages || [];
                    crop.packages.push({ unit: "kg", baseType: "kg", baseQty: 1, price: NaN });
                    renderPacks();
                    renderCsaSection();
                    renderPreview();
                });

                // --- market demand ---------------------------------------------------- 
                const marketTitle = document.createElement("div");
                marketTitle.style.fontWeight = "700";
                marketTitle.style.margin = "10px 0 6px";
                marketTitle.textContent = "Market demand (per week)";

                const marketWrap = document.createElement("div");
                marketWrap.style.display = "flex";
                marketWrap.style.flexDirection = "column";
                marketWrap.style.gap = "6px";

                const addMarketBtn = mkBtn("Add market line");
                addMarketBtn.style.marginTop = "6px";

                function renderMarket() {
                    marketWrap.innerHTML = "";
                    crop.market = crop.market || [];
                    for (const mkt of crop.market) {
                        const line = document.createElement("div");
                        line.style.display = "flex";
                        line.style.gap = "8px";
                        line.style.alignItems = "center";

                        const qty = mkInput("number", mkt.qty ?? 0, 90);
                        const unit = mkUnitSelectForCrop(crop, mkt.unit ?? pickDefaultUnitForCrop(crop), 110);
                        const from = mkInput("date", mkt.from ?? crop.harvestStart ?? "", 150);
                        const to = mkInput("date", mkt.to ?? crop.harvestEnd ?? "", 150);
                        const del = mkBtn("Remove");

                        line.appendChild(document.createTextNode("Target"));
                        line.appendChild(qty);
                        line.appendChild(unit);
                        line.appendChild(document.createTextNode("From"));
                        line.appendChild(from);
                        line.appendChild(document.createTextNode("To"));
                        line.appendChild(to);
                        line.appendChild(del);

                        qty.addEventListener("input", () => {
                            mkt.qty = clampNonNegNum(qty.value, 0);
                            qty.value = String(mkt.qty);
                            renderPreview();
                        });

                        unit.addEventListener("change", () => { mkt.unit = String(unit.value || ""); renderPreview(); });
                        from.addEventListener("change", () => { mkt.from = String(from.value || ""); renderPreview(); });

                        to.addEventListener("change", () => {
                            const newTo = String(to.value || "");
                            mkt.to = newTo;

                            if (crop.syncharvest) {
                                // User edited the shelf-adjusted date -> update baseTo.   
                                const shelf = getShelfDays(crop);
                                mkt.__baseTo = subDaysYmd(newTo, shelf) || "";
                            } else {
                                // Unsynced edit directly sets baseTo.                      
                                mkt.__baseTo = hasYmd(newTo) ? newTo : "";
                            }

                            renderPreview();
                        });

                        del.addEventListener("click", (ev) => {
                            ev.preventDefault();
                            crop.market = crop.market.filter(x => x !== mkt);
                            renderMarket();
                            renderPreview();
                        });

                        marketWrap.appendChild(line);
                    }
                }

                addMarketBtn.addEventListener("click", (ev) => {
                    ev.preventDefault();
                    crop.market = crop.market || [];

                    const nl = { qty: 0, unit: pickDefaultUnitForCrop(crop), from: crop.harvestStart || "", to: crop.harvestEnd || "" };
                    nl.__baseTo = String(nl.to || "");
                    if (crop.syncharvest) applyShelfToMarketTo(crop, nl);
                    crop.market.push(nl);

                    renderMarket();
                    renderCsaSection();
                    renderPreview();
                });

                // events for crop fields ------------------------------------------------ 
                __varietyControlsByCropId.set(crop.id, { sel: varietySel, plusBtn: varietyAddBtn });

                // initial populate (async)                                                
                refreshVarietyDropdownForCrop(crop, false).then(() => {
                    title.textContent = labelCrop(crop);
                    refreshCropFilterDropdown();
                    renderPreview();
                }).catch(e => console.warn("[USL][YearPlanner] variety init failed", e));

                varietySel.addEventListener("change", () => {
                    const plantKey = String(crop.plantId || "").trim();
                    const pack = __varietyCacheByPlant.get(plantKey);
                    const id = String(varietySel.value || "");
                    const rec = (pack && pack.byId) ? (pack.byId.get(id) || null) : null;
                    const name = rec ? String(rec.name || "") : "";
                    crop.varietyId = id ? Number(id) : null;
                    crop.variety = id ? String(name) : "";

                    if (id) {
                        if (rec && rec.yieldKg) setKgPerPlantAuto(crop, rec.yieldKg);
                    } else {
                        if (Number.isFinite(Number(crop.__baseKgPerPlant)) && Number(crop.__baseKgPerPlant) > 0) {
                            setKgPerPlantAuto(crop, crop.__baseKgPerPlant);
                        }
                    }

                    title.textContent = labelCrop(crop);
                    refreshCropFilterDropdown();
                    renderPreview();

                    // optional: if variety affects harvest suggestion logic, you can re-emit 
                    // emitHarvestWindowsNeeded(moduleCell, year, [{ cropId: crop.id, plantId: crop.plantId, varietyId: crop.varietyId ?? null, method: crop.method ?? null, yieldTargetKg: 0 }]); 
                });

                varietyAddBtn.addEventListener("click", (ev) => {
                    ev.preventDefault();
                    const vid = String(varietySel.value || "").trim();
                    dispatchOpenVarietyEditor(graph, {
                        cropId: crop.id,
                        plantId: crop.plantId,
                        varietyId: vid ? vid : null
                    });
                });

                kgpp.min = "0";
                shelf.min = "1";
                actual.min = "1";

                kgpp.addEventListener("input", () => {
                    crop.kgPerPlant = clampNonNegNum(kgpp.value, NaN);
                    crop.__kgpp_lastAuto = null;
                    kgpp.value = Number.isFinite(Number(crop.kgPerPlant)) ? String(crop.kgPerPlant) : "";
                    renderCsaSection();
                    renderPreview();
                });

                hs.addEventListener("change", () => {
                    const snap = {
                        hs: crop.harvestStart, he: crop.harvestEnd, availEnd: cropAvailEndYmd(crop)
                    };
                    crop.harvestStart = String(hs.value || "");
                    syncCropDatesIfEnabled(crop, snap);
                    renderCsaSection();
                    renderMarket();
                    renderPreview();
                });

                he.addEventListener("change", () => {
                    const snap = {
                        hs: crop.harvestStart, he: crop.harvestEnd, availEnd: cropAvailEndYmd(crop)
                    };
                    crop.harvestEnd = String(he.value || "");
                    syncCropDatesIfEnabled(crop, snap);
                    renderCsaSection();
                    renderMarket();
                    renderPreview();
                });

                shelf.addEventListener("input", () => {
                    const snap = { hs: crop.harvestStart, he: crop.harvestEnd, availEnd: cropAvailEndYmd(crop) };
                    crop.shelfLifeDays = clampNonNegInt(shelf.value, 0);
                    shelf.value = String(crop.shelfLifeDays);

                    if (crop.syncharvest) {
                        for (const mkt of (crop.market || [])) applyShelfToMarketTo(crop, mkt);
                        renderMarket();
                    }

                    syncCropDatesIfEnabled(crop, snap);
                    renderMarket();
                    renderCsaSection();
                    renderPreview();
                });

                delCrop.addEventListener("click", (ev) => {
                    ev.preventDefault();
                    __actualControlsByCropId.delete(crop.id);
                    __requiredControlsByCropId.delete(crop.id);
                    __varietyControlsByCropId.delete(crop.id);
                    plan.crops = (plan.crops || []).filter(x => x !== crop);
                    if (plan.csa && Array.isArray(plan.csa.components)) {
                        plan.csa.components = plan.csa.components.filter(c => c.cropId !== crop.id);
                    }
                    refreshCropFilterDropdown();
                    renderCrops();
                    renderCsaSection();
                    renderPreview();
                });

                panel.appendChild(header);
                panel.appendChild(row);
                panel.appendChild(harvestViz);
                panel.appendChild(packsTitle);
                panel.appendChild(packsWrap);
                panel.appendChild(addPackBtn);
                panel.appendChild(marketTitle);
                panel.appendChild(marketWrap);
                panel.appendChild(addMarketBtn);

                cropsList.appendChild(panel);
                renderPacks();
                renderCsaSection();
                renderMarket();
            }
        }


        const csaBox = document.createElement("div");
        csaBox.style.border = "1px solid #ddd";
        csaBox.style.borderRadius = "8px";
        csaBox.style.padding = "10px";
        csaBox.style.marginBottom = "12px";
        body.insertBefore(csaBox, preview);

        function renderCsaSection() {
            csaBox.innerHTML = "";
            plan.csa = plan.csa || { enabled: false, boxesPerWeek: 0, start: "", end: "", components: [] };

            const title = document.createElement("div");
            title.style.fontWeight = "700";
            title.style.marginBottom = "8px";
            title.textContent = "CSA (optional)";
            csaBox.appendChild(title);

            const row1 = document.createElement("div");
            row1.style.display = "flex";
            row1.style.gap = "10px";
            row1.style.alignItems = "center";
            row1.style.marginBottom = "8px";

            const enabled = document.createElement("input");
            enabled.type = "checkbox";
            enabled.checked = !!plan.csa.enabled;

            const enabledLab = document.createElement("label");
            enabledLab.textContent = "Enable CSA";
            enabledLab.style.display = "flex";
            enabledLab.style.alignItems = "center";
            enabledLab.style.gap = "6px";
            enabledLab.appendChild(enabled);

            const boxes = mkInput("number", plan.csa.boxesPerWeek ?? 0, 100);
            const csaStart = mkInput("date", plan.csa.start ?? "", 150);
            const csaEnd = mkInput("date", plan.csa.end ?? "", 150);

            row1.appendChild(enabledLab);
            row1.appendChild(document.createTextNode("Boxes/week"));
            row1.appendChild(boxes);
            row1.appendChild(document.createTextNode("Start"));
            row1.appendChild(csaStart);
            row1.appendChild(document.createTextNode("End"));
            row1.appendChild(csaEnd);
            csaBox.appendChild(row1);

            const compsTitle = document.createElement("div");
            compsTitle.style.fontWeight = "700";
            compsTitle.style.margin = "8px 0 6px";
            compsTitle.textContent = "CSA components (per box)";
            csaBox.appendChild(compsTitle);

            const compsWrap = document.createElement("div");
            compsWrap.style.display = "flex";
            compsWrap.style.flexDirection = "column";
            compsWrap.style.gap = "6px";
            csaBox.appendChild(compsWrap);

            const addCompBtn = mkBtn("Add component");
            addCompBtn.style.marginTop = "8px";
            csaBox.appendChild(addCompBtn);

            boxes.min = "0";

            function syncPlanCsa() {
                plan.csa.enabled = !!enabled.checked;
                plan.csa.boxesPerWeek = clampNonNegInt(boxes.value, 0);
                boxes.value = String(plan.csa.boxesPerWeek);
                plan.csa.start = String(csaStart.value || "");
                plan.csa.end = String(csaEnd.value || "");
                renderPreview();
            }

            enabled.addEventListener("change", syncPlanCsa);
            boxes.addEventListener("input", syncPlanCsa);
            csaStart.addEventListener("change", syncPlanCsa);
            csaEnd.addEventListener("change", syncPlanCsa);

            function renderComponents() {
                compsWrap.innerHTML = "";
                plan.csa.components = plan.csa.components || [];

                for (const comp of plan.csa.components) {
                    const line = document.createElement("div");
                    line.style.display = "flex";
                    line.style.gap = "8px";
                    line.style.alignItems = "center";

                    const cropSel = mkSelect(
                        (plan.crops || []).map(c => ({ value: c.id, label: labelCrop(c) })),
                        comp.cropId || "",
                        260
                    );
                    const qty = mkInput("number", comp.qty ?? 1, 70);
                    const selectedCrop = findCrop(plan, comp.cropId);
                    const defaultUnit = selectedCrop ? pickDefaultUnitForCrop(selectedCrop) : "kg";
                    const unit = mkUnitSelectForCrop(selectedCrop, comp.unit ?? defaultUnit, 110);
                    const everyN = mkInput("number", comp.everyNWeeks ?? 1, 80);
                    const st = mkInput("date", comp.start ?? (plan.csa.start || ""), 150);
                    const en = mkInput("date", comp.end ?? (plan.csa.end || ""), 150);
                    const del = mkBtn("Remove");

                    line.appendChild(document.createTextNode("Crop"));
                    line.appendChild(cropSel);
                    line.appendChild(document.createTextNode("Qty"));
                    line.appendChild(qty);
                    line.appendChild(unit);
                    line.appendChild(document.createTextNode("Every"));
                    line.appendChild(everyN);
                    line.appendChild(document.createTextNode("weeks"));
                    line.appendChild(st);
                    line.appendChild(en);
                    line.appendChild(del);

                    cropSel.addEventListener("change", () => {
                        comp.cropId = String(cropSel.value || "");
                        const c2 = findCrop(plan, comp.cropId);
                        comp.unit = pickDefaultUnitForCrop(c2);
                        renderComponents();
                        renderPreview();
                    });
                    qty.addEventListener("input", () => {
                        comp.qty = clampNonNegNum(qty.value, 0);
                        qty.value = String(comp.qty);
                        renderPreview();
                    });
                    unit.addEventListener("change", () => { comp.unit = String(unit.value || ""); renderPreview(); });

                    everyN.min = "1"

                    everyN.addEventListener("input", () => {
                        comp.everyNWeeks = Math.max(1, clampNonNegInt(everyN.value, 1));
                        everyN.value = String(comp.everyNWeeks);
                        renderPreview();
                    });

                    st.addEventListener("change", () => { comp.start = String(st.value || ""); renderPreview(); });
                    en.addEventListener("change", () => { comp.end = String(en.value || ""); renderPreview(); });

                    del.addEventListener("click", (ev) => {
                        ev.preventDefault();
                        plan.csa.components = plan.csa.components.filter(x => x !== comp);
                        renderComponents();
                        renderPreview();
                    });

                    compsWrap.appendChild(line);
                }
            }

            addCompBtn.addEventListener("click", (ev) => {
                ev.preventDefault();
                plan.csa.components = plan.csa.components || [];
                plan.csa.components.push({
                    cropId: (plan.crops && plan.crops[0]) ? plan.crops[0].id : "",
                    qty: 1,
                    unit: pickDefaultUnitForCrop((plan.crops && plan.crops[0]) ? plan.crops[0] : null),
                    everyNWeeks: 1, start: plan.csa.start || "", end: plan.csa.end || ""
                });
                renderComponents();
                renderPreview();
            });

            renderComponents();
        }


        async function initPlantsDropdown() {
            try {
                const plants = await getPlantsBasicCached();
                plantSelect.innerHTML = "";
                const opt0 = document.createElement("option");
                opt0.value = ""; opt0.textContent = "-- Select plant --";
                plantSelect.appendChild(opt0);

                for (const p of plants) {
                    const o = document.createElement("option");
                    o.value = String(p.plant_id);
                    o.textContent = String(p.plant_name);
                    plantSelect.appendChild(o);
                }
                msg.textContent = "";
            } catch (e) {
                msg.textContent = String(e && e.message ? e.message : e);
            }
        }

        reloadPlantsBtn.addEventListener("click", async (ev) => {
            ev.preventDefault();
            DbClient.invalidatePlantsBasicCache();
            await initPlantsDropdown();
        });

        addCropBtn.addEventListener("click", async (ev) => {
            ev.preventDefault();
            const plantId = String(plantSelect.value || "").trim();
            if (!plantId) return;

            const plants = await getPlantsBasicCached();
            const p = plants.find(x => String(x.plant_id) === plantId);
            if (!p) return;

            const defaults = getDefaultsForPlant(p.plant_id);
            const initialPackages = (defaults && defaults.length)
                ? JSON.parse(JSON.stringify(defaults))
                : [{ unit: "kg", baseType: "kg", baseQty: 1, price: NaN }];

            const crop = {
                id: uid("crop"),
                plantId: String(p.plant_id),
                plant: String(p.plant_name),
                method: String(p.default_planting_method || "").trim() || "direct_sow", // CHANGED
                variety: "",
                harvestStart: "",
                harvestEnd: "",
                shelfLifeDays: 0,
                __baseKgPerPlant: clampNum(p.yield_per_plant_kg, NaN),
                kgPerPlant: clampNum(p.yield_per_plant_kg, NaN),
                __kgpp_lastAuto: clampNum(p.yield_per_plant_kg, NaN),
                actualPlants: 0,
                germRate: 1.0,
                packages: initialPackages,
                market: []
            };

            plan.crops = plan.crops || [];
            plan.crops.push(crop);
            refreshCropFilterDropdown();

            // after plan.crops.push(crop);
            emitHarvestWindowsNeeded(moduleCell, currentYear, [{
                cropId: crop.id,
                plantId: crop.plantId,
                varietyId: crop.varietyId ?? null,
                method: crop.method ?? null,
                yieldTargetKg: 0
            }]);

            renderCrops();
            renderCsaSection();   // ADD
            renderPreview();
        });


        yearInput.addEventListener("change", () => {
            const newYear = Number(yearInput.value);
            if (!Number.isFinite(newYear) || newYear < 1900 || newYear > 3000) return;

            savePlanForYear(moduleCell, currentYear, plan);

            currentYear = newYear;
            const loaded = loadPlanForYear(moduleCell, currentYear);

            const nextPlan = loaded || {
                version: 1,
                year: currentYear,
                weekStartDow: 1,
                crops: [],
                csa: { enabled: false, boxesPerWeek: 0, start: "", end: "", components: [] }
            };

            Object.keys(plan).forEach(k => delete plan[k]);
            Object.assign(plan, nextPlan);
            plan.year = currentYear;

            titleEl.textContent = `Plan Year — ${currentYear}`;

            refreshCropFilterDropdown();
            renderCrops();
            renderCsaSection();
            renderPreview();
        });

        cropFilterSel.addEventListener("change", () => {
            plan.cropFilterId = String(cropFilterSel.value || "");
            renderPreview();
        });


        applyTemplateBtn.addEventListener("click", () => {
            const name = String(templateSel.value || "").trim();
            if (!name) return;
            const t = loadTemplateByName(name);
            if (!t) return;

            const applied = rekeyTemplateToPlan(t, currentYear);

            Object.keys(plan).forEach(k => delete plan[k]);
            Object.assign(plan, applied);
            plan.year = currentYear;

            refreshCropFilterDropdown();
            renderCrops();
            renderCsaSection();
            renderPreview();
        });

        saveTemplateBtn.addEventListener("click", () => {
            const name = prompt("Template name?");
            const key = String(name || "").trim();
            if (!key) return;
            // Store template without module binding, but keep crop IDs as-is in template
            const t = plan ? JSON.parse(JSON.stringify(plan)) : {};
            t.year = null;
            saveTemplateByName(key, t);
            refreshTemplateDropdown();
            templateSel.value = key;
        });

        deleteTemplateBtn.addEventListener("click", () => {
            const name = String(templateSel.value || "").trim();
            if (!name) return;
            deleteTemplateByName(name);
            refreshTemplateDropdown();
        });


        saveBtn.addEventListener("click", (ev) => {
            ev.preventDefault();

            const errs = validatePlan(plan);
            if (errs.length) { showWarnings(errs); return; }

            // persist unit defaults
            for (const c of (plan.crops || [])) {
                if (c && c.savePackagesAsDefault && c.plantId && Array.isArray(c.packages)) {
                    saveDefaultsForPlant(c.plantId, c.packages);
                }
            }

            // Recompute plantsReq/seedsReq right before persisting (avoid stale values).        
            const warnings2 = [];
            const weekly2 = computePlanWeekly(plan, warnings2);
            const totals2 = computePlanCropTotals(plan, weekly2);
            const totalsById2 = new Map(totals2.map(r => [String(r.crop.id), r]));
            for (const c of (plan.crops || [])) {
                const r = totalsById2.get(String(c.id)) || null;
                const pr = r ? Number(r.plantsReq) : NaN;
                const sr = r ? Number(r.seedsReq) : NaN;
                c.plantsReq = (Number.isFinite(pr) && pr > 0) ? Math.ceil(pr) : 0;
                c.seedsReq = (Number.isFinite(sr) && sr > 0) ? Math.ceil(sr) : 0;
            }


            const persisted = JSON.parse(JSON.stringify(plan));

            // remove non-modal feilds to avoid xml bloat
            for (const c of (persisted.crops || [])) {
                delete c.__actualHarvestWeeklyKg;
                delete c.__sync_lastHarvestStart;
                delete c.__sync_lastHarvestEnd;
                delete c.__sync_lastAvailEnd;
                delete c.__kgpp_lastAuto;
                delete c.__baseKgPerPlant;

                for (const mkt of (c.market || [])) {
                    delete mkt.__baseTo;
                    delete mkt.__preSyncTo;
                }
            }

            savePlanForYear(moduleCell, currentYear, persisted);
        });


        exportBtn.addEventListener("click", (ev) => {
            ev.preventDefault();
            const safeName = String(getCellAttr(moduleCell, "label", "garden"))
                .replace(/[^\w\-]+/g, "_").slice(0, 60);
            downloadJson(`${safeName}_${currentYear}_plan.json`, plan);
        });

        resetBtn.addEventListener("click", (ev) => {
            ev.preventDefault();
            deletePlanForYear(moduleCell, currentYear);
            plan.version = 1;
            plan.year = currentYear;
            plan.weekStartDow = 1;
            plan.crops = [];
            plan.csa = { enabled: false, boxesPerWeek: 0, start: "", end: "", components: [] };
            renderCrops();
            renderCsaSection();
            renderPreview();
        });

        const USL_DEBUG_HARVEST_WINDOWS = true;


        function emitHarvestWindowsNeeded(moduleCell, year, cropsReq) {
            if (USL_DEBUG_HARVEST_WINDOWS) {
                console.groupCollapsed('[USL][YearPlanner] emit usl:harvestWindowsNeeded');
                console.log('moduleCellId:', moduleCell.getId ? moduleCell.getId() : moduleCell.id);
                console.log('year:', year);
                console.log('cropsReq:', JSON.parse(JSON.stringify(cropsReq)));
                console.groupEnd();
            }

            try {
                window.dispatchEvent(new CustomEvent("usl:harvestWindowsNeeded", {
                    detail: {
                        moduleCellId: moduleCell.getId ? moduleCell.getId() : moduleCell.id,
                        year: Number(year),
                        crops: cropsReq
                    }
                }));
            } catch (e) {
                console.error('[USL][YearPlanner] Failed to dispatch usl:harvestWindowsNeeded', e);
            }
        }

        function applyHarvestSuggestionsToPlan(plan, results) {                             // RESTORE
            if (!plan || !Array.isArray(plan.crops)) return;

            const byId = new Map(plan.crops.map(c => [c.id, c]));

            // Update crops
            for (const r of (results || [])) {
                const crop = byId.get(r.cropId);
                if (!crop) continue;

                if (!hasYmd(crop.harvestStart) && hasYmd(r.harvestStart)) crop.harvestStart = r.harvestStart;
                if (!hasYmd(crop.harvestEnd) && hasYmd(r.harvestEnd)) crop.harvestEnd = r.harvestEnd;

                // Only fill shelf life if currently empty/0 and scheduler gave one
                if ((!Number.isFinite(Number(crop.shelfLifeDays)) || Number(crop.shelfLifeDays) <= 0) &&
                    Number.isFinite(Number(r.shelfLifeDays)) && Number(r.shelfLifeDays) > 0) {
                    crop.shelfLifeDays = Math.trunc(Number(r.shelfLifeDays));
                }
            }

            // CSA auto-fill start/end if missing
            plan.csa = plan.csa || { enabled: false, boxesPerWeek: 0, start: "", end: "", components: [] };
            const cropsWithWindows = plan.crops.filter(c => hasYmd(c.harvestStart) && hasYmd(c.harvestEnd));

            if (cropsWithWindows.length) {
                const minStart = cropsWithWindows.reduce(
                    (a, c) => (a < c.harvestStart ? a : c.harvestStart),
                    cropsWithWindows[0].harvestStart
                );

                const maxAvailEnd = cropsWithWindows.reduce((a, c) => {
                    const shelf = Number.isFinite(Number(c.shelfLifeDays)) ? Number(c.shelfLifeDays) : 0;
                    const availEnd = addDaysYmd(c.harvestEnd, shelf) || c.harvestEnd;
                    return (a > availEnd ? a : availEnd);
                }, (() => {
                    const c0 = cropsWithWindows[0];
                    const shelf0 = Number.isFinite(Number(c0.shelfLifeDays)) ? Number(c0.shelfLifeDays) : 0;
                    return addDaysYmd(c0.harvestEnd, shelf0) || c0.harvestEnd;
                })());

                if (!hasYmd(plan.csa.start)) plan.csa.start = minStart;
                if (!hasYmd(plan.csa.end)) plan.csa.end = maxAvailEnd;
            }

            // Clamp CSA component dates into crop availability (end includes shelf life)
            if (Array.isArray(plan.csa.components)) {
                for (const comp of plan.csa.components) {
                    const crop = byId.get(comp.cropId);
                    const csaStart = plan.csa.start;
                    const csaEnd = plan.csa.end;

                    if (!hasYmd(comp.start) && hasYmd(csaStart)) comp.start = csaStart;
                    if (!hasYmd(comp.end) && hasYmd(csaEnd)) comp.end = csaEnd;

                    if (crop && hasYmd(crop.harvestStart) && hasYmd(crop.harvestEnd)) {
                        const shelf = Number.isFinite(Number(crop.shelfLifeDays)) ? Number(crop.shelfLifeDays) : 0;
                        const cropAvailEnd = addDaysYmd(crop.harvestEnd, shelf) || crop.harvestEnd;

                        if (hasYmd(comp.start) && comp.start < crop.harvestStart) comp.start = crop.harvestStart;
                        if (hasYmd(comp.end) && comp.end > cropAvailEnd) comp.end = cropAvailEnd;
                    }
                }
            }
        }


        function onHarvestWindowsSuggested(ev) {
            if (controller.session !== session) return;
            const d = ev && ev.detail ? ev.detail : null;
            if (!d) return;

            const moduleCellId = String(d.moduleCellId || "").trim();
            const year = Number(d.year);
            if (!moduleCellId || !Number.isFinite(year)) return;

            // If your modal is open, you have `plan` in closure.
            // Apply to the current open plan only if it matches the year and module.
            if (String(moduleCell.getId ? moduleCell.getId() : moduleCell.id) !== moduleCellId) return;
            if (Number(plan.year) !== year) return;

            applyHarvestSuggestionsToPlan(plan, d.results || []);
            renderCrops();
            renderCsaSection();
            renderPreview();
        }

        addWindowListener(session, "usl:harvestWindowsSuggested", onHarvestWindowsSuggested);

        initPlantsDropdown();
        renderCrops();
        renderCsaSection();
        renderPreview();

    }

















    // -------------------- Event listener --------------------
    function onPlanYearRequested(ev) {
        const d = ev && ev.detail ? ev.detail : null;
        if (!d) return;

        const moduleCellId = String(d.moduleCellId || "").trim();
        const year = Number(d.year);

        if (!moduleCellId) return;
        if (!Number.isFinite(year) || year < 1900 || year > 3000) return;

        const moduleCell = model.getCell(moduleCellId);
        if (!moduleCell) return;

        openPlanModal(moduleCell, year);
    }

    if (__YP_GLOBAL.planYearRequestedHandler) {
        window.removeEventListener("usl:planYearRequested", __YP_GLOBAL.planYearRequestedHandler);
    }
    __YP_GLOBAL.planYearRequestedHandler = onPlanYearRequested;
    window.addEventListener("usl:planYearRequested", __YP_GLOBAL.planYearRequestedHandler);
});
