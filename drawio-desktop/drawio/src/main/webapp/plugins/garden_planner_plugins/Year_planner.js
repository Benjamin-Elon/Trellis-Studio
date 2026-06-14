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

    // -------------------- Config --------------------
    const PLAN_YEARS_ATTR = "plan_year_json";
    const PLAN_TEMPLATES_ATTR = "plan_year_templates";      // (diagram-scoped)
    const PLAN_UNIT_DEFAULTS_ATTR = "plan_unit_defaults";   // (diagram-scoped, per plantId)
    const __YP_GLOBAL = window.__uslYearPlannerGlobal || (window.__uslYearPlannerGlobal = {});

    // -------------------- SessionController -------------------- // CHANGE
    /**
     * Owns the single active modal session and all listener/DOM cleanup attached to it. // NEW
     */
    const SessionController = (() => { // NEW
        let activeSession = null; // NEW

        function safeDispose(fn) { // CHANGE
            try { fn && fn(); } catch (_) { }
        }

        function close() { // CHANGE
            const session = activeSession; // CHANGE
            if (!session) return;

            const disposers = Array.isArray(session.disposers) ? session.disposers.slice().reverse() : []; // CHANGE
            session.disposers = [];
            for (const dispose of disposers) safeDispose(dispose); // CHANGE

            if (session.ui && session.ui.modalEl) {
                try { session.ui.modalEl.remove(); } catch (_) { }
                session.ui.modalEl = null;
            }

            activeSession = null; // CHANGE
        }

        function start(moduleCell, year, plan) { // CHANGE
            close(); // NEW
            const moduleCellId = String(moduleCell?.getId ? moduleCell.getId() : moduleCell?.id || "");
            activeSession = { // CHANGE
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
            return activeSession; // NEW
        }

        function isActive(session) { // NEW
            return activeSession === session; // NEW
        }

        function addWindowListener(session, type, handler, opts) { // CHANGE
            window.addEventListener(type, handler, opts);
            session.disposers.push(() => window.removeEventListener(type, handler, opts));
        }

        function addGraphListener(session, targetGraph, eventName, handler) { // CHANGE
            targetGraph.addListener(eventName, handler);
            session.disposers.push(() => { try { targetGraph.removeListener(handler); } catch (_) { } });
        }

        return { start, close, isActive, addWindowListener, addGraphListener }; // NEW
    })();



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

        return {
            getCellAttr,
            setCellAttr
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

        async function queryPlantingMethodsForPlantId(plantId) { // NEW
            const pid = Number(plantId); // NEW
            if (!Number.isFinite(pid)) return []; // NEW
            const sql = ` // NEW
        SELECT pm.method_id, pm.method_name, pm.method_category_id
        FROM PlantingMethods pm
        INNER JOIN PlantAllowedMethodCategories allowed
          ON LOWER(TRIM(allowed.method_category_id)) = LOWER(TRIM(pm.method_category_id))
        WHERE allowed.plant_id = ?
        ORDER BY LOWER(TRIM(pm.method_category_id)), LOWER(TRIM(pm.method_name)), LOWER(TRIM(pm.method_id));`; // NEW
            return await queryAll(sql, [pid]); // NEW
        } // NEW

        return {
            getDbPath,
            queryAll,
            listPlantsBasicRows,
            getPlantsBasicCached,
            invalidatePlantsBasicCache,
            queryVarietiesByPlantId,
            queryPlantingMethodsForPlantId // NEW
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

        const DAY_MS = 24 * 60 * 60 * 1000; // NEW
        const WEEK_MS = 7 * DAY_MS; // CHANGE

        function weekRangeForWindowClamped(weekStarts, fromYmd, toYmd) { // NEW
            if (!Array.isArray(weekStarts) || !weekStarts.length) return null; // NEW
            if (!hasYmd(fromYmd) || !hasYmd(toYmd)) return null; // NEW

            const t0 = parseYmdLocalToMs(fromYmd); // NEW
            const t1 = parseYmdLocalToMs(toYmd); // NEW
            if (!Number.isFinite(t0) || !Number.isFinite(t1)) return null; // NEW

            const winStart = Math.min(t0, t1); // NEW
            const winEndEx = addDaysMs(Math.max(t0, t1), 1); // NEW

            let a = -1; // NEW
            let b = -1; // NEW

            for (let i = 0; i < weekStarts.length; i++) { // NEW
                const ws = weekStarts[i].ms; // NEW
                const we = addDaysMs(ws, 7); // NEW
                const overlaps = winStart < we && winEndEx > ws; // NEW
                if (!overlaps) continue; // NEW
                if (a < 0) a = i; // NEW
                b = i; // NEW
            } // NEW

            return (a >= 0 && b >= 0) ? { a, b } : null; // NEW
        } // NEW

        function weekStartMsForDate(dateYmd, weekStartDow) { // NEW
            const t = parseYmdLocalToMs(dateYmd); // NEW
            if (!Number.isFinite(t)) return NaN; // NEW

            const d = new Date(t); // NEW
            const dow = d.getDay(); // NEW
            const delta = (7 + (dow - weekStartDow)) % 7; // NEW
            return addDaysMs(t, -delta); // NEW
        } // NEW

        function weekOffsetFromWindowStart(weekStarts, i, fromYmd, weekStartDow) { // NEW
            const startWeekMs = weekStartMsForDate(fromYmd, weekStartDow); // NEW
            if (!Number.isFinite(startWeekMs)) return 0; // NEW

            const diff = Number(weekStarts[i].ms) - startWeekMs; // NEW
            if (!Number.isFinite(diff)) return 0; // NEW

            return Math.max(0, Math.round(diff / WEEK_MS)); // NEW
        } // NEW

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
            const wr = weekRangeForWindowClamped(weekStarts, fromYmd, toYmd); // CHANGE
            if (!wr) return; // CHANGE

            for (let i = wr.a; i <= wr.b; i++) series[i] += kgPerWeek; // CHANGE
        }

        function addTotalKgAcrossWindowProrated(series, weekStarts, fromYmd, toYmd, totalKg, selectedYear) { // NEW
            if (!Array.isArray(series) || !Array.isArray(weekStarts)) return false; // NEW
            if (!hasYmd(fromYmd) || !hasYmd(toYmd)) return false; // NEW

            const total = Number(totalKg); // NEW
            if (!Number.isFinite(total) || total <= 0) return false; // NEW

            const y = Number(selectedYear); // NEW
            if (!Number.isFinite(y)) return false; // NEW

            const t0 = parseYmdLocalToMs(fromYmd); // NEW
            const t1 = parseYmdLocalToMs(toYmd); // NEW
            if (!Number.isFinite(t0) || !Number.isFinite(t1)) return false; // NEW

            const winStart = Math.min(t0, t1); // NEW
            const winEndEx = addDaysMs(Math.max(t0, t1), 1); // NEW

            const yearStart = parseYmdLocalToMs(`${y}-01-01`); // NEW
            const yearEndEx = parseYmdLocalToMs(`${y + 1}-01-01`); // NEW
            if (!Number.isFinite(yearStart) || !Number.isFinite(yearEndEx)) return false; // NEW

            const fullDays = Math.max(1, Math.round((winEndEx - winStart) / DAY_MS)); // NEW
            let added = false; // NEW

            for (let i = 0; i < weekStarts.length; i++) { // NEW
                const ws = Number(weekStarts[i].ms); // NEW
                if (!Number.isFinite(ws)) continue; // NEW

                const we = addDaysMs(ws, 7); // NEW

                const overlapStart = Math.max(winStart, ws, yearStart); // NEW
                const overlapEnd = Math.min(winEndEx, we, yearEndEx); // NEW
                if (overlapStart >= overlapEnd) continue; // NEW

                const overlapDays = Math.max(0, (overlapEnd - overlapStart) / DAY_MS); // NEW
                if (!(overlapDays > 0)) continue; // NEW

                series[i] += total * (overlapDays / fullDays); // NEW
                added = true; // NEW
            } // NEW

            return added; // NEW
        } // NEW

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

                        const wr = PlanMath.weekRangeForWindowClamped(weeks, from, to); // CHANGE
                        if (!wr) continue; // CHANGE

                        const arr = ensureCropArrays(crop.id); // CHANGE

                        for (let i = wr.a; i <= wr.b; i++) { // CHANGE
                            const rel = weekOffsetFromWindowStart(weeks, i, from, weekStartDow); // CHANGE
                            if (rel % everyN !== 0) continue; // CHANGE
                            arr.target[i] += boxes * qty * kgPerUnit; // CHANGE
                        }
                    }
                }
            }

            // supply estimate / actual harvest
            for (const crop of crops) {
                if (!crop || !crop.id) continue;

                const arr = ensureCropArrays(crop.id); // NEW

                const actualSeries = Array.isArray(crop.__actualHarvestWeeklyKg)
                    ? crop.__actualHarvestWeeklyKg
                    : null; // NEW

                const hasActualSeries = !!actualSeries && actualSeries.some(v => Number(v) > 0); // NEW
                const useActual = crop.useActualHarvest !== false; // NEW

                if (useActual && hasActualSeries) { // NEW
                    for (let i = 0; i < n; i++) { // NEW
                        arr.supply[i] += Math.max(0, Number(actualSeries[i]) || 0); // NEW
                    } // NEW
                    continue; // NEW
                } // NEW

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

                const totalKg = actualPlants * kgPerPlant; // CHANGE

                addTotalKgAcrossWindowProrated( // CHANGE
                    arr.supply,
                    weeks,
                    crop.harvestStart,
                    crop.harvestEnd,
                    totalKg,
                    year
                );
            }

            // Aggregate all per-crop series into total series before returning. // CHANGE
            for (const v of perCrop.values()) { // CHANGE
                for (let i = 0; i < n; i++) { // CHANGE
                    targetTotal[i] += Math.max(0, Number(v.target[i]) || 0); // CHANGE
                    supplyTotal[i] += Math.max(0, Number(v.supply[i]) || 0); // CHANGE
                } // CHANGE
            } // CHANGE

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


        return {
            pushWarn,
            hasYmd,
            toIsoDateLocal,
            parseYmdLocalToMs,
            addDaysMs,
            buildWeekStartsForYearLocal,
            weekIndexForDate,
            weekRangeForWindowClamped, // NEW
            weekStartMsForDate, // NEW
            weekOffsetFromWindowStart, // NEW
            findCrop,
            resolveUnitToKgPerUnit,
            addKgAcrossWeeks,
            addTotalKgAcrossWindowProrated, // NEW
            computePlanWeekly,
            computePlanCropTotals
        };
    })();

    // -------------------- PlanSchema -------------------- // NEW
    /**
     * Owns the persisted plan shape, runtime normalization, validation, and crop identity rules. // NEW
     */
    const PlanSchema = (() => { // NEW
        function clonePlain(obj) { // NEW
            return JSON.parse(JSON.stringify(obj || {})); // NEW
        }

        function createEmptyPlan(year) { // NEW
            return normalizeForRuntime({ // NEW
                version: 1,
                year: Number(year),
                weekStartDow: 1,
                crops: [],
                csa: { enabled: false, boxesPerWeek: 0, start: "", end: "", components: [] }
            }, year);
        }

        function isPositiveFiniteNumber(value) { // NEW
            const number = Number(value); // NEW
            return Number.isFinite(number) && number > 0; // NEW
        }

        function normalizeYieldFieldsForRuntime(crop) { // CHANGE
            if (!crop) return;

            const legacyBase = Number(crop.baseKgPerPlant ?? crop.__baseKgPerPlant);
            const kg = Number(crop.kgPerPlant);
            const legacyLastAuto = Number(crop.__kgpp_lastAuto);

            if (isPositiveFiniteNumber(legacyBase)) {
                crop.baseKgPerPlant = legacyBase;
            } else if (isPositiveFiniteNumber(kg)) {
                crop.baseKgPerPlant = kg;
            } else if (crop.baseKgPerPlant == null) {
                crop.baseKgPerPlant = null;
            }

            if (!isPositiveFiniteNumber(crop.kgPerPlant)) {
                crop.kgPerPlant = isPositiveFiniteNumber(crop.baseKgPerPlant) ? Number(crop.baseKgPerPlant) : null;
            }

            if (crop.kgPerPlantMode !== "manual" && crop.kgPerPlantMode !== "auto") {
                const nearlySame = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-9;
                const hasKg = isPositiveFiniteNumber(kg);
                const hasLastAuto = isPositiveFiniteNumber(legacyLastAuto);
                const differsFromLastAuto = hasKg && hasLastAuto && !nearlySame(kg, legacyLastAuto);
                crop.kgPerPlantMode = differsFromLastAuto ? "manual" : "auto";
            }
        }

        function normalizeForRuntime(plan, year) { // CHANGE
            const normalized = plan && typeof plan === "object" ? plan : {};
            normalized.version = Number(normalized.version) || 1;
            normalized.year = Number.isFinite(Number(year)) ? Number(year) : Number(normalized.year);
            if (!Number.isFinite(normalized.year)) normalized.year = new Date().getFullYear();
            if (!Number.isFinite(Number(normalized.weekStartDow))) normalized.weekStartDow = 1;
            normalized.crops = Array.isArray(normalized.crops) ? normalized.crops : [];

            if (!normalized.csa || typeof normalized.csa !== "object") {
                normalized.csa = { enabled: false, boxesPerWeek: 0, start: "", end: "", components: [] };
            }
            normalized.csa.components = Array.isArray(normalized.csa.components) ? normalized.csa.components : [];

            for (const crop of normalized.crops) {
                normalizeYieldFieldsForRuntime(crop);
                crop.packages = Array.isArray(crop.packages) ? crop.packages : [];
                crop.market = Array.isArray(crop.market) ? crop.market : [];
                if (!Number.isFinite(Number(crop.shelfLifeDays))) crop.shelfLifeDays = 0;
                if (!Number.isFinite(Number(crop.germRate)) || Number(crop.germRate) <= 0 || Number(crop.germRate) > 1) {
                    crop.germRate = 1.0;
                }
            }

            return normalized;
        }

        function stripRuntimeFields(plan, options) { // NEW
            const forTemplate = !!(options && options.forTemplate);
            delete plan.cropFilterId;
            if (!forTemplate) delete plan.templateBaseYear;

            for (const crop of (plan.crops || [])) {
                delete crop.__actualHarvestWeeklyKg;
                delete crop.__sync_lastHarvestStart;
                delete crop.__sync_lastHarvestEnd;
                delete crop.__sync_lastAvailEnd;
                delete crop.__kgpp_lastAuto;
                delete crop.__baseKgPerPlant;
                delete crop.savePackagesAsDefault;

                crop.kgPerPlantMode = crop.kgPerPlantMode === "manual" ? "manual" : "auto";
                crop.market = Array.isArray(crop.market) ? crop.market : [];
                for (const marketLine of crop.market) {
                    delete marketLine.__baseTo;
                    delete marketLine.__preSyncTo;
                }
            }
            return plan;
        }

        function serializeForPersistence(plan, options) { // CHANGE
            const serialized = normalizeForRuntime(clonePlain(plan || {}), plan && plan.year);
            return stripRuntimeFields(serialized, options);
        }

        function normalizeVarietyIdForIdentity(varietyId) { // NEW
            if (varietyId === null || varietyId === undefined || varietyId === "") return "";
            return String(varietyId).trim();
        }

        function makeCropIdentityKey(plantId, varietyId) { // CHANGE
            const normalizedPlantId = String(plantId ?? "").trim();
            if (!normalizedPlantId) return "";
            return `pid:${normalizedPlantId}|vid:${normalizeVarietyIdForIdentity(varietyId)}`;
        }

        function getCropIdentityKey(crop) { // NEW
            return makeCropIdentityKey(crop && crop.plantId, crop && crop.varietyId);
        }

        function findDuplicateCrop(plan, plantId, varietyId, exceptCropId) { // CHANGE
            const key = makeCropIdentityKey(plantId, varietyId);
            if (!key || !plan || !Array.isArray(plan.crops)) return null;
            const except = String(exceptCropId || "");

            for (const crop of plan.crops) {
                if (!crop) continue;
                if (except && String(crop.id || "") === except) continue;
                if (getCropIdentityKey(crop) === key) return crop;
            }
            return null;
        }

        function findFirstDuplicateCrop(plan) { // CHANGE
            const seen = new Map();
            for (const crop of ((plan && plan.crops) || [])) {
                const key = getCropIdentityKey(crop);
                if (!key) continue;
                if (seen.has(key)) return { first: seen.get(key), second: crop, key };
                seen.set(key, crop);
            }
            return null;
        }

        function validateCrop(crop) { // NEW
            const errors = [];
            if (!crop || typeof crop !== "object") return ["Crop is missing."]; // NEW
            if (!crop.id) errors.push("Crop missing id.");
            if (!crop.plantId) errors.push(`Crop "${crop.plant || crop.id}" missing plantId.`);
            if (!Number.isFinite(Number(crop.kgPerPlant)) || Number(crop.kgPerPlant) <= 0) {
                errors.push(`Crop "${crop.plant || crop.id}" missing valid kg/plant.`);
            }

            for (const pkg of (crop.packages || [])) {
                const unit = String(pkg.unit || "").trim();
                const baseType = String(pkg.baseType || "").trim().toLowerCase();
                const baseQty = Number(pkg.baseQty);
                if (!unit) errors.push(`Crop "${crop.plant || crop.id}" has a package with blank unit.`);
                if (!Number.isFinite(baseQty) || baseQty <= 0) errors.push(`Crop "${crop.plant || crop.id}" package "${unit}" baseQty must be > 0.`);
                if (baseType !== "kg" && baseType !== "plant" && baseType !== "plants") errors.push(`Crop "${crop.plant || crop.id}" package "${unit}" baseType must be kg or plant.`);
                if ((baseType === "plant" || baseType === "plants") && !(Number(crop.kgPerPlant) > 0)) {
                    errors.push(`Crop "${crop.plant || crop.id}" package "${unit}" uses plant but kg/plant is missing.`);
                }
            }

            for (const marketLine of (crop.market || [])) {
                if (!PlanMath.hasYmd(marketLine.from) || !PlanMath.hasYmd(marketLine.to)) {
                    errors.push(`Crop "${crop.plant || crop.id}" market line missing dates.`);
                }
                if (!Number.isFinite(PlanMath.resolveUnitToKgPerUnit(crop, marketLine.unit))) {
                    errors.push(`Crop "${crop.plant || crop.id}" market unit "${marketLine.unit}" does not resolve to kg.`);
                }
            }

            const germinationRate = Number(crop.germRate);
            if (!Number.isFinite(germinationRate) || germinationRate <= 0 || germinationRate > 1) {
                errors.push(`Crop "${crop.plant || crop.id}" missing valid germination rate (0..1).`);
            }
            return errors; // NEW
        } // NEW

        function validate(plan) { // CHANGE
            const errors = [];
            const crops = (plan && plan.crops) || [];
            for (const crop of crops) errors.push(...validateCrop(crop)); // CHANGE

            const duplicate = findFirstDuplicateCrop(plan); // NEW
            if (duplicate) errors.push("Duplicate crop rows found. Each plant/variety may appear only once per year plan."); // NEW

            if (plan && plan.csa && plan.csa.enabled) {
                if (!Number.isFinite(Number(plan.csa.boxesPerWeek)) || Number(plan.csa.boxesPerWeek) <= 0) {
                    errors.push("CSA enabled but boxes/week is not set.");
                }
                for (const component of (plan.csa.components || [])) {
                    const crop = PlanMath.findCrop(plan, component.cropId);
                    if (!crop) {
                        errors.push("CSA component references missing crop.");
                        continue;
                    }
                    const from = component.start || plan.csa.start;
                    const to = component.end || plan.csa.end;
                    if (!PlanMath.hasYmd(from) || !PlanMath.hasYmd(to)) {
                        errors.push(`CSA component for "${crop.plant || crop.id}" missing dates.`);
                    }
                    if (!Number.isFinite(PlanMath.resolveUnitToKgPerUnit(crop, component.unit))) {
                        errors.push(`CSA component for "${crop.plant || crop.id}" unit "${component.unit}" does not resolve to kg.`);
                    }
                }
            }
            return errors;
        }

        return { // NEW
            clonePlain,
            createEmptyPlan,
            normalizeYieldFieldsForRuntime,
            normalizeForRuntime,
            stripRuntimeFields,
            serializeForPersistence,
            makeCropIdentityKey,
            getCropIdentityKey,
            findDuplicateCrop,
            findFirstDuplicateCrop,
            validateCrop, // NEW
            validate
        };
    })();

    // -------------------- PlanRepository -------------------- // NEW
    /**
     * Owns all persisted year-plan, template, and unit-default storage contracts. // NEW
     */
    const PlanRepository = (() => { // NEW
        function readJsonMap(cell, attributeName) { // NEW
            const raw = DiagramStore.getCellAttr(cell, attributeName, "");
            const parsed = Env.safeJsonStringParse(raw, null);
            return (parsed && typeof parsed === "object" && !Array.isArray(parsed)) ? parsed : {};
        }

        function writeJsonMap(cell, attributeName, map) { // NEW
            if (!cell) return;
            Env.model.beginUpdate();
            try {
                DiagramStore.setCellAttr(cell, attributeName, JSON.stringify(map || {}));
            } finally {
                Env.model.endUpdate();
            }
            Env.graph.refresh(cell);
        }

        function getDiagramRootCell() { // NEW
            try { return Env.model.getRoot(); } catch (_) { return null; }
        }

        function readRootJsonMap(attributeName) { // NEW
            return readJsonMap(getDiagramRootCell(), attributeName);
        }

        function writeRootJsonMap(attributeName, map) { // NEW
            writeJsonMap(getDiagramRootCell(), attributeName, map);
        }

        function loadPlanForYear(moduleCell, year) { // CHANGE
            const stored = readJsonMap(moduleCell, Env.ATTRS.PLAN_YEARS_ATTR)[String(year)];
            return (stored && typeof stored === "object" && !Array.isArray(stored))
                ? PlanSchema.normalizeForRuntime(PlanSchema.clonePlain(stored), year)
                : null;
        }

        function savePlanForYear(moduleCell, year, plan) { // CHANGE
            const plans = readJsonMap(moduleCell, Env.ATTRS.PLAN_YEARS_ATTR);
            plans[String(year)] = PlanSchema.serializeForPersistence(plan);
            writeJsonMap(moduleCell, Env.ATTRS.PLAN_YEARS_ATTR, plans);
        }

        function deletePlanForYear(moduleCell, year) { // CHANGE
            const plans = readJsonMap(moduleCell, Env.ATTRS.PLAN_YEARS_ATTR);
            delete plans[String(year)];
            writeJsonMap(moduleCell, Env.ATTRS.PLAN_YEARS_ATTR, plans);
        }

        function daysInMonthLocal(year, monthIndex) { // NEW
            return new Date(year, monthIndex + 1, 0).getDate();
        }

        function shiftYmdByYears(ymd, deltaYears) { // NEW
            if (!PlanMath.hasYmd(ymd)) return ymd || "";
            const match = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (!match) return ymd;
            const nextYear = Number(match[1]) + Number(deltaYears || 0);
            const monthIndex = Number(match[2]) - 1;
            const safeDay = Math.min(Number(match[3]), daysInMonthLocal(nextYear, monthIndex));
            return PlanMath.toIsoDateLocal(new Date(nextYear, monthIndex, safeDay));
        }

        function shiftFieldYear(target, key, deltaYears) { // NEW
            if (target && PlanMath.hasYmd(target[key])) target[key] = shiftYmdByYears(target[key], deltaYears);
        }

        function shiftPlanDateFields(plan, deltaYears) { // NEW
            if (!plan || !Number.isFinite(Number(deltaYears)) || Number(deltaYears) === 0) return;
            for (const crop of (plan.crops || [])) {
                shiftFieldYear(crop, "harvestStart", deltaYears);
                shiftFieldYear(crop, "harvestEnd", deltaYears);
                for (const marketLine of (crop.market || [])) {
                    shiftFieldYear(marketLine, "from", deltaYears);
                    shiftFieldYear(marketLine, "to", deltaYears);
                }
            }
            if (!plan.csa) return;
            shiftFieldYear(plan.csa, "start", deltaYears);
            shiftFieldYear(plan.csa, "end", deltaYears);
            for (const component of (plan.csa.components || [])) {
                shiftFieldYear(component, "start", deltaYears);
                shiftFieldYear(component, "end", deltaYears);
            }
        }

        function listTemplateNames() { // CHANGE
            return Object.keys(readRootJsonMap(Env.ATTRS.PLAN_TEMPLATES_ATTR)).sort();
        }

        function loadTemplateByName(name) { // CHANGE
            const template = readRootJsonMap(Env.ATTRS.PLAN_TEMPLATES_ATTR)[String(name || "")];
            return (template && typeof template === "object" && !Array.isArray(template)) ? template : null;
        }

        function saveTemplateByName(name, template) { // CHANGE
            const key = String(name || "").trim();
            if (!key) return;
            const templates = readRootJsonMap(Env.ATTRS.PLAN_TEMPLATES_ATTR);
            templates[key] = template;
            writeRootJsonMap(Env.ATTRS.PLAN_TEMPLATES_ATTR, templates);
        }

        function deleteTemplateByName(name) { // CHANGE
            const key = String(name || "").trim();
            if (!key) return;
            const templates = readRootJsonMap(Env.ATTRS.PLAN_TEMPLATES_ATTR);
            delete templates[key];
            writeRootJsonMap(Env.ATTRS.PLAN_TEMPLATES_ATTR, templates);
        }

        function rekeyTemplateToPlan(template, year) { // CHANGE
            const rekeyed = template ? PlanSchema.clonePlain(template) : {};
            const validYear = value => {
                const number = Number(value);
                return Number.isFinite(number) && number >= 1900 ? number : NaN;
            };
            const targetYearValue = validYear(year);
            const targetYear = Number.isFinite(targetYearValue) ? targetYearValue : new Date().getFullYear();
            const templateBaseYear = validYear(rekeyed.templateBaseYear);
            const planYear = validYear(rekeyed.year);
            const baseYear = Number.isFinite(templateBaseYear) ? templateBaseYear
                : (Number.isFinite(planYear) ? planYear : targetYear);

            PlanSchema.normalizeForRuntime(rekeyed, targetYear);
            shiftPlanDateFields(rekeyed, targetYear - baseYear);

            const idMap = new Map();
            for (const crop of rekeyed.crops) {
                const oldId = crop.id;
                crop.id = Env.uid("crop");
                idMap.set(oldId, crop.id);
                PlanSchema.normalizeYieldFieldsForRuntime(crop);
            }
            for (const component of rekeyed.csa.components) {
                component.cropId = idMap.has(component.cropId) ? idMap.get(component.cropId) : "";
            }
            if (idMap.has(rekeyed.cropFilterId)) rekeyed.cropFilterId = idMap.get(rekeyed.cropFilterId);
            else delete rekeyed.cropFilterId;
            delete rekeyed.templateBaseYear;
            return PlanSchema.normalizeForRuntime(rekeyed, targetYear);
        }

        function getDefaultsForPlant(plantId) { // CHANGE
            const value = readRootJsonMap(Env.ATTRS.PLAN_UNIT_DEFAULTS_ATTR)[String(plantId || "")];
            return Array.isArray(value) ? value : null;
        }

        function saveDefaultsForPlant(plantId, packages) { // CHANGE
            const key = String(plantId || "").trim();
            if (!key) return;
            const defaults = readRootJsonMap(Env.ATTRS.PLAN_UNIT_DEFAULTS_ATTR);
            defaults[key] = Array.isArray(packages) ? packages : [];
            writeRootJsonMap(Env.ATTRS.PLAN_UNIT_DEFAULTS_ATTR, defaults);
        }

        return { // NEW
            loadPlanForYear,
            savePlanForYear,
            deletePlanForYear,
            listTemplateNames,
            loadTemplateByName,
            saveTemplateByName,
            deleteTemplateByName,
            rekeyTemplateToPlan,
            getDefaultsForPlant,
            saveDefaultsForPlant,
            shiftYmdByYears
        };
    })();





























    // -------------------- DiagramPlanReader -------------------- // CHANGE
    const DiagramPlanReader = (() => { // CHANGE
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

            const y = Number(selectedYear); // CHANGE
            if (!Number.isFinite(y)) return false; // CHANGE

            const rawStart = String(DiagramStore.getCellAttr(tg, "season_start_year", "")).trim(); // CHANGE
            const startY = rawStart ? Number(rawStart) : NaN; // CHANGE

            if (isPerennialTilerGroup(tg)) { // CHANGE
                if (Number.isFinite(startY)) return y >= startY; // CHANGE
                return true; // CHANGE
            } // CHANGE

            // 1) Explicit season assignment
            if (Number.isFinite(startY) && startY === y) return true;

            // 2) Harvest window overlap (local-year)
            const hsRaw = String(getFirstNonEmptyAttr(tg, [
                "harvest_start", "harvest_start_date", "planting_harvest_start", "season_harvest_start", "start"
            ]) || "").trim();

            const heRaw = String(getFirstNonEmptyAttr(tg, [
                "harvest_end", "harvest_end_date", "planting_harvest_end", "season_harvest_end", "end"
            ]) || "").trim();

            const hsMs = PlanMath.parseYmdLocalToMs(hsRaw);
            const heMs = PlanMath.parseYmdLocalToMs(heRaw);
            const hsY = Number.isFinite(hsMs) ? new Date(hsMs).getFullYear() : NaN;
            const heY = Number.isFinite(heMs) ? new Date(heMs).getFullYear() : NaN;

            const injectedEndY = harvestEndYearFn ? harvestEndYearFn(tg) : NaN;
            const endY = Number.isFinite(injectedEndY) ? injectedEndY : heY;

            if (Number.isFinite(hsY) && Number.isFinite(endY)) {
                const lo = Math.min(hsY, endY);
                const hi = Math.max(hsY, endY);
                if (y >= lo && y <= hi) return true;
            } else {
                if (Number.isFinite(hsY) && hsY === y) return true;
                if (Number.isFinite(endY) && endY === y) return true;
            }

            return false;
        }

        function harvestStartYmd(tg) { // CHANGE
            return String(getFirstNonEmptyAttr(tg, [
                "harvest_start", "harvest_start_date", "planting_harvest_start", "season_harvest_start", "start"
            ]) || "").trim();
        }

        function harvestEndYmd(tg) { // CHANGE
            return String(getFirstNonEmptyAttr(tg, [
                "harvest_end", "harvest_end_date", "planting_harvest_end", "season_harvest_end", "end"
            ]) || "").trim();
        }

        function harvestEndLocalYear(tg) { // NEW
            const endMs = PlanMath.parseYmdLocalToMs(harvestEndYmd(tg));
            return Number.isFinite(endMs) ? new Date(endMs).getFullYear() : NaN;
        }

        function harvestWindowOverlapsYear(tg, year) { // CHANGE
            const startMs = PlanMath.parseYmdLocalToMs(harvestStartYmd(tg));
            const endMs = PlanMath.parseYmdLocalToMs(harvestEndYmd(tg));
            const selectedYear = Number(year);
            if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !Number.isFinite(selectedYear)) return false;

            const yearStartMs = PlanMath.parseYmdLocalToMs(`${selectedYear}-01-01`);
            const yearEndExMs = PlanMath.parseYmdLocalToMs(`${selectedYear + 1}-01-01`);
            const windowStartMs = Math.min(startMs, endMs);
            const windowEndExMs = PlanMath.addDaysMs(Math.max(startMs, endMs), 1);
            return windowStartMs < yearEndExMs && windowEndExMs > yearStartMs;
        }

        function getTilerGroups(moduleCell) { // NEW
            return getAllDescendants(Env.model, moduleCell).filter(isTilerGroupCell);
        }

        function actualPlantsMapFromTilers(tilerGroups, selectedYear) { // NEW
            const actualPlantsByCropKey = new Map();
            for (const tilerGroup of tilerGroups) {
                if (!shouldIncludeTilerGroupInYear(tilerGroup, selectedYear, harvestEndLocalYear)) continue;
                const plantCount = Number(DiagramStore.getCellAttr(tilerGroup, "plant_count", ""));
                const count = Number.isFinite(plantCount) && plantCount > 0 ? Math.trunc(plantCount) : 0;
                if (count <= 0) continue;
                const key = getCropKeyFromTilerGroup(tilerGroup);
                actualPlantsByCropKey.set(key, (actualPlantsByCropKey.get(key) || 0) + count);
            }
            return actualPlantsByCropKey;
        }

        function actualPlantsMapFromModule(moduleCell, selectedYear) { // CHANGE
            return actualPlantsMapFromTilers(getTilerGroups(moduleCell), selectedYear);
        }

        function buildActualHarvestSeriesFromTilers(tilerGroups, year, weekStarts, cropKeyToKgPerPlant) { // NEW
            const seriesByCropKey = new Map();
            const ensureSeries = key => {
                if (!seriesByCropKey.has(key)) seriesByCropKey.set(key, Array(weekStarts.length).fill(0));
                return seriesByCropKey.get(key);
            };

            for (const tilerGroup of tilerGroups) {
                if (!harvestWindowOverlapsYear(tilerGroup, year)) continue;
                const plantCount = Number(DiagramStore.getCellAttr(tilerGroup, "plant_count", ""));
                const count = Number.isFinite(plantCount) && plantCount > 0 ? Math.trunc(plantCount) : 0;
                if (count <= 0) continue;

                const key = getCropKeyFromTilerGroup(tilerGroup);
                const kgPerPlant = Number(cropKeyToKgPerPlant.get(key));
                if (!Number.isFinite(kgPerPlant) || kgPerPlant <= 0) continue;

                PlanMath.addTotalKgAcrossWindowProrated(
                    ensureSeries(key),
                    weekStarts,
                    harvestStartYmd(tilerGroup),
                    harvestEndYmd(tilerGroup),
                    count * kgPerPlant,
                    year
                );
            }
            return seriesByCropKey;
        }

        function buildActualHarvestSeriesByCropKey(moduleCell, year, weekStarts, cropKeyToKgPerPlant) { // CHANGE
            return buildActualHarvestSeriesFromTilers(getTilerGroups(moduleCell), year, weekStarts, cropKeyToKgPerPlant);
        }

        /**
         * Scans module descendants once and returns all diagram facts needed by recalculation. // NEW
         */
        function readYearFacts(moduleCell, year, weekStarts, cropKeyToKgPerPlant) { // NEW
            const tilerGroups = getTilerGroups(moduleCell);
            return {
                actualPlantsByCropKey: actualPlantsMapFromTilers(tilerGroups, year),
                actualHarvestSeriesByCropKey: buildActualHarvestSeriesFromTilers(
                    tilerGroups,
                    year,
                    weekStarts,
                    cropKeyToKgPerPlant
                )
            };
        }

        return {
            isTilerGroupCell,
            getCropKeyFromPlanCrop,
            getCropKeyFromTilerGroup,
            getAllDescendants,
            getFirstNonEmptyAttr,
            isPerennialTilerGroup,
            shouldIncludeTilerGroupInYear,
            actualPlantsMapFromModule,
            buildActualHarvestSeriesByCropKey,
            harvestStartYmd,
            harvestEndYmd,
            harvestWindowOverlapsYear,
            readYearFacts
        };
    })();


















    // -------------------- PlanRuntimeService -------------------- // NEW
    /**
     * Mutates the live plan with diagram-derived values and returns a DOM-free render model. // NEW
     */
    const PlanRuntimeService = (() => { // NEW
        function addDaysYmd(ymd, days) { // NEW
            const ms = PlanMath.parseYmdLocalToMs(ymd);
            return Number.isFinite(ms)
                ? PlanMath.toIsoDateLocal(new Date(PlanMath.addDaysMs(ms, days)))
                : null;
        }

        function cropAvailableEndYmd(crop) { // NEW
            if (!PlanMath.hasYmd(crop && crop.harvestEnd)) return null;
            const shelfDays = Number.isFinite(Number(crop.shelfLifeDays)) ? Number(crop.shelfLifeDays) : 0;
            return addDaysYmd(crop.harvestEnd, shelfDays) || crop.harvestEnd;
        }

        function ymdMin(a, b) { // NEW
            if (!PlanMath.hasYmd(a)) return b;
            if (!PlanMath.hasYmd(b)) return a;
            return a < b ? a : b;
        }

        function ymdMax(a, b) { // NEW
            if (!PlanMath.hasYmd(a)) return b;
            if (!PlanMath.hasYmd(b)) return a;
            return a > b ? a : b;
        }

        function clampYmdIntoRange(value, lower, upper) { // NEW
            if (!PlanMath.hasYmd(value) || (!PlanMath.hasYmd(lower) && !PlanMath.hasYmd(upper))) return value;
            let clamped = value;
            if (PlanMath.hasYmd(lower) && clamped < lower) clamped = lower;
            if (PlanMath.hasYmd(upper) && clamped > upper) clamped = upper;
            return clamped;
        }

        function shouldAutoReplaceDate(current, lastAutomatic) { // NEW
            return !PlanMath.hasYmd(current)
                || (PlanMath.hasYmd(lastAutomatic) && current === lastAutomatic);
        }

        function syncCropDatesIfEnabled(plan, crop, oldSnapshot) { // CHANGE
            if (!crop || !crop.syncharvest) return;
            const harvestStart = crop.harvestStart;
            const harvestEnd = crop.harvestEnd;
            const availableEnd = cropAvailableEndYmd(crop);
            const csa = plan && plan.csa ? plan.csa : null;

            crop.__sync_lastHarvestStart = crop.__sync_lastHarvestStart ?? (oldSnapshot && oldSnapshot.hs) ?? "";
            crop.__sync_lastHarvestEnd = crop.__sync_lastHarvestEnd ?? (oldSnapshot && oldSnapshot.he) ?? "";
            crop.__sync_lastAvailEnd = crop.__sync_lastAvailEnd ?? (oldSnapshot && oldSnapshot.availEnd) ?? "";

            crop.market = crop.market || [];
            for (const marketLine of crop.market) {
                if (!marketLine) continue;
                if (shouldAutoReplaceDate(marketLine.from, crop.__sync_lastHarvestStart) && PlanMath.hasYmd(harvestStart)) {
                    marketLine.from = harvestStart;
                }
                marketLine.from = clampYmdIntoRange(marketLine.from, harvestStart, availableEnd);

                const lastAutomaticEnd = crop.__sync_lastAvailEnd || crop.__sync_lastHarvestEnd;
                const looksAutomatic = PlanMath.hasYmd(harvestEnd)
                    && PlanMath.hasYmd(marketLine.to)
                    && String(marketLine.to) === String(harvestEnd);
                if (shouldAutoReplaceDate(marketLine.to, lastAutomaticEnd) || looksAutomatic) {
                    if (PlanMath.hasYmd(availableEnd)) marketLine.to = availableEnd;
                    else if (PlanMath.hasYmd(harvestEnd)) marketLine.to = harvestEnd;
                }
                marketLine.to = clampYmdIntoRange(marketLine.to, harvestStart, availableEnd);
            }

            if (csa && Array.isArray(csa.components)) {
                for (const component of csa.components) {
                    if (!component || component.cropId !== crop.id) continue;
                    const desiredStart = PlanMath.hasYmd(harvestStart) ? ymdMax(harvestStart, csa.start) : csa.start;
                    if (shouldAutoReplaceDate(component.start, crop.__sync_lastHarvestStart) && PlanMath.hasYmd(desiredStart)) {
                        component.start = desiredStart;
                    }
                    component.start = clampYmdIntoRange(component.start, harvestStart, availableEnd);

                    const desiredEnd = PlanMath.hasYmd(availableEnd)
                        ? ymdMin(availableEnd, csa.end)
                        : (PlanMath.hasYmd(harvestEnd) ? ymdMin(harvestEnd, csa.end) : csa.end);
                    const lastAutomaticEnd = crop.__sync_lastAvailEnd || crop.__sync_lastHarvestEnd;
                    if (shouldAutoReplaceDate(component.end, lastAutomaticEnd) && PlanMath.hasYmd(desiredEnd)) {
                        component.end = desiredEnd;
                    }
                    component.end = clampYmdIntoRange(component.end, harvestStart, availableEnd);
                }
            }

            crop.__sync_lastHarvestStart = PlanMath.hasYmd(harvestStart) ? harvestStart : crop.__sync_lastHarvestStart;
            crop.__sync_lastHarvestEnd = PlanMath.hasYmd(harvestEnd) ? harvestEnd : crop.__sync_lastHarvestEnd;
            crop.__sync_lastAvailEnd = PlanMath.hasYmd(availableEnd) ? availableEnd : crop.__sync_lastAvailEnd;
        }

        function autoFillAndClampCsa(plan) { // CHANGE
            plan.csa = plan.csa || { enabled: false, boxesPerWeek: 0, start: "", end: "", components: [] };
            plan.csa.components = Array.isArray(plan.csa.components) ? plan.csa.components : [];
            const cropsWithWindows = (plan.crops || []).filter(
                crop => PlanMath.hasYmd(crop.harvestStart) && PlanMath.hasYmd(crop.harvestEnd)
            );

            if (cropsWithWindows.length) {
                const minimumStart = cropsWithWindows.reduce(
                    (current, crop) => current < crop.harvestStart ? current : crop.harvestStart,
                    cropsWithWindows[0].harvestStart
                );
                const maximumEnd = cropsWithWindows.reduce((current, crop) => {
                    const end = cropAvailableEndYmd(crop) || crop.harvestEnd;
                    return current > end ? current : end;
                }, cropAvailableEndYmd(cropsWithWindows[0]) || cropsWithWindows[0].harvestEnd);
                if (!PlanMath.hasYmd(plan.csa.start)) plan.csa.start = minimumStart;
                if (!PlanMath.hasYmd(plan.csa.end)) plan.csa.end = maximumEnd;
            }

            const cropsById = new Map((plan.crops || []).map(crop => [crop.id, crop]));
            for (const component of plan.csa.components) {
                const crop = cropsById.get(component.cropId);
                if (!crop) continue;
                if (!PlanMath.hasYmd(component.start) && PlanMath.hasYmd(plan.csa.start)) component.start = plan.csa.start;
                if (!PlanMath.hasYmd(component.end) && PlanMath.hasYmd(plan.csa.end)) component.end = plan.csa.end;
                if (PlanMath.hasYmd(crop.harvestStart) && PlanMath.hasYmd(component.start) && component.start < crop.harvestStart) {
                    component.start = crop.harvestStart;
                }
                const maximumEnd = cropAvailableEndYmd(crop);
                if (maximumEnd && PlanMath.hasYmd(component.end) && component.end > maximumEnd) component.end = maximumEnd;
            }
        }

        function deriveHarvestWindow(crop, weekStarts, series) { // NEW
            if (crop.useActualHarvest === false) return;
            let first = -1;
            let last = -1;
            for (let index = 0; index < series.length; index++) {
                if (Number(series[index]) > 0) {
                    first = index;
                    break;
                }
            }
            for (let index = series.length - 1; index >= 0; index--) {
                if (Number(series[index]) > 0) {
                    last = index;
                    break;
                }
            }
            if (first < 0 || last < 0) return;
            crop.harvestStart = String(weekStarts[first].iso);
            crop.harvestEnd = PlanMath.toIsoDateLocal(new Date(PlanMath.addDaysMs(weekStarts[last].ms, 6)));
        }

        function recalculate(moduleCell, year, plan) { // NEW
            PlanSchema.normalizeForRuntime(plan, year);
            const selectedYear = Number(plan.year);
            const weekStartDow = Number.isFinite(Number(plan.weekStartDow)) ? Number(plan.weekStartDow) : 1;
            const weekStarts = PlanMath.buildWeekStartsForYearLocal(selectedYear, weekStartDow);
            const kgPerPlantByCropKey = new Map();

            for (const crop of plan.crops) {
                const key = DiagramPlanReader.getCropKeyFromPlanCrop(crop);
                const kgPerPlant = Number(crop.kgPerPlant);
                if (Number.isFinite(kgPerPlant) && kgPerPlant > 0) kgPerPlantByCropKey.set(key, kgPerPlant);
            }

            const diagramFacts = DiagramPlanReader.readYearFacts(
                moduleCell,
                selectedYear,
                weekStarts,
                kgPerPlantByCropKey
            );
            const beforeHarvestById = new Map();

            for (const crop of plan.crops) {
                const key = DiagramPlanReader.getCropKeyFromPlanCrop(crop);
                crop.actualPlants = Math.max(0, Math.trunc(Number(diagramFacts.actualPlantsByCropKey.get(key)) || 0));
                beforeHarvestById.set(crop.id, {
                    hs: crop.harvestStart,
                    he: crop.harvestEnd,
                    availEnd: cropAvailableEndYmd(crop)
                });
                crop.__actualHarvestWeeklyKg = diagramFacts.actualHarvestSeriesByCropKey.get(key)
                    || Array(weekStarts.length).fill(0);
                deriveHarvestWindow(crop, weekStarts, crop.__actualHarvestWeeklyKg);
            }

            for (const crop of plan.crops) syncCropDatesIfEnabled(plan, crop, beforeHarvestById.get(crop.id));
            autoFillAndClampCsa(plan);

            const warnings = [];
            const weekly = PlanMath.computePlanWeekly(plan, warnings);
            const cropTotals = PlanMath.computePlanCropTotals(plan, weekly);
            const totalsById = new Map(cropTotals.map(row => [String(row.crop.id), row]));
            const derivedByCropId = new Map();

            for (const crop of plan.crops) {
                const totals = totalsById.get(String(crop.id)) || null;
                const requiredPlants = totals && Number.isFinite(Number(totals.plantsReq)) && Number(totals.plantsReq) > 0
                    ? Math.ceil(Number(totals.plantsReq))
                    : 0;
                const requiredSeeds = totals && Number.isFinite(Number(totals.seedsReq)) && Number(totals.seedsReq) > 0
                    ? Math.ceil(Number(totals.seedsReq))
                    : 0;
                crop.plantsReq = requiredPlants;
                crop.seedsReq = requiredSeeds;
                derivedByCropId.set(String(crop.id), {
                    actualPlants: crop.actualPlants,
                    requiredPlants,
                    requiredSeeds,
                    harvestStart: crop.harvestStart || "",
                    harvestEnd: crop.harvestEnd || "",
                    actualHarvestWeeklyKg: crop.__actualHarvestWeeklyKg
                });
            }

            return { // NEW
                plan,
                year: selectedYear,
                weekStarts,
                weekly,
                cropTotals,
                warnings,
                derivedByCropId
            };
        }

        return { recalculate, cropAvailableEndYmd, syncCropDatesIfEnabled, autoFillAndClampCsa, addDaysYmd }; // NEW
    })();

    // -------------------- Dashboard model -------------------- // NEW
    /** // NEW
     * Produces persistence-safe modal state and presentation metrics from one runtime calculation. // NEW
     * This layer has no DOM dependencies so status, dirty-state, and selection rules remain testable. // NEW
     */ // NEW
    const YearPlanDashboard = (() => { // NEW
        const EPS = 0.0001; // NEW

        function uniqueMessages(messages) { // NEW
            const seen = new Set(); // NEW
            const out = []; // NEW
            for (const message of (messages || [])) { // NEW
                const text = String(message || "").trim(); // NEW
                if (!text || seen.has(text)) continue; // NEW
                seen.add(text); // NEW
                out.push(text); // NEW
            } // NEW
            return out; // NEW
        } // NEW

        function persistenceSnapshot(plan) { // NEW
            const persistedPlan = PlanSchema.serializeForPersistence(plan || {}); // NEW
            const packageDefaultCropIds = ((plan && plan.crops) || []) // NEW
                .filter(crop => crop && crop.savePackagesAsDefault) // NEW
                .map(crop => String(crop.id || "")) // NEW
                .sort(); // NEW
            return JSON.stringify({ persistedPlan, packageDefaultCropIds }); // NEW
        } // NEW

        function resolveSelectedCropId(crops, requestedId, removedIndex) { // NEW
            const list = Array.isArray(crops) ? crops : []; // NEW
            const wanted = String(requestedId || ""); // NEW
            if (wanted && list.some(crop => String(crop && crop.id || "") === wanted)) return wanted; // NEW
            if (list.length === 0) return ""; // NEW
            const index = Number.isFinite(Number(removedIndex)) // NEW
                ? Math.max(0, Math.min(list.length - 1, Math.trunc(Number(removedIndex)))) // NEW
                : 0; // NEW
            return String(list[index] && list[index].id || ""); // NEW
        } // NEW

        function createState(plan) { // NEW
            const crops = (plan && plan.crops) || []; // NEW
            return { // NEW
                selectedCropId: resolveSelectedCropId(crops, "", 0), // NEW
                activeTab: "basics", // NEW
                previewExpanded: false, // NEW
                baselineSnapshot: "", // NEW
                validationState: "idle", // NEW
                lastSavedAt: null, // NEW
                closePromptOpen: false, // NEW
                extraDiagnostics: [] // NEW
            }; // NEW
        } // NEW

        function markBaseline(state, plan, savedAt) { // NEW
            state.baselineSnapshot = persistenceSnapshot(plan); // NEW
            state.validationState = "valid"; // NEW
            state.lastSavedAt = savedAt || null; // NEW
            return state.baselineSnapshot; // NEW
        } // NEW

        function isDirty(state, plan) { // NEW
            return !!state && persistenceSnapshot(plan) !== String(state.baselineSnapshot || ""); // NEW
        } // NEW

        function buildMethodOptions(rows, currentValue) { // NEW
            const current = String(currentValue || "").trim(); // NEW
            const seen = new Set(); // NEW
            const options = []; // NEW
            for (const row of (rows || [])) { // NEW
                const value = String(row && row.method_id || "").trim(); // NEW
                if (!value || seen.has(value)) continue; // NEW
                seen.add(value); // NEW
                options.push({ value, label: String(row.method_name || value), unavailable: false }); // NEW
            } // NEW
            if (current && !seen.has(current)) options.unshift({ value: current, label: `${current} (legacy/unavailable)`, unavailable: true }); // NEW
            return options; // NEW
        } // NEW

        function compute(plan, runtime, options) { // NEW
            const settings = options || {}; // NEW
            const rows = runtime && Array.isArray(runtime.cropTotals) ? runtime.cropTotals : []; // NEW
            const rowsById = new Map(rows.map(row => [String(row && row.crop && row.crop.id || ""), row])); // NEW
            const cropMetrics = []; // NEW
            let targetKg = 0; // NEW
            let supplyKg = 0; // NEW
            let shortKg = 0; // NEW
            let surplusKg = 0; // NEW
            let actualHarvestActive = false; // NEW
            let manualHarvestDates = false; // NEW

            for (const crop of ((plan && plan.crops) || [])) { // NEW
                const row = rowsById.get(String(crop.id || "")) || { targetKg: 0, supplyKg: 0, plantsReq: NaN, seedsReq: NaN }; // NEW
                const target = Math.max(0, Number(row.targetKg) || 0); // NEW
                const supply = Math.max(0, Number(row.supplyKg) || 0); // NEW
                const shortage = Math.max(0, target - supply); // NEW
                const surplus = Math.max(0, supply - target); // NEW
                const errors = PlanSchema.validateCrop(crop); // NEW
                if (target > EPS && (!PlanMath.hasYmd(crop.harvestStart) || !PlanMath.hasYmd(crop.harvestEnd))) { // NEW
                    errors.push(`Crop "${crop.plant || crop.id}" missing harvest window.`); // NEW
                } // NEW
                let status = "OK"; // NEW

                if (errors.length > 0) status = "Missing data"; // NEW
                else if (target <= EPS) status = "No demand"; // NEW
                else if (shortage > EPS) status = "Short"; // NEW
                else if (surplus > EPS) status = "Surplus"; // NEW

                targetKg += target; // NEW
                supplyKg += supply; // NEW
                shortKg += shortage; // NEW
                surplusKg += surplus; // NEW
                const derived = runtime && runtime.derivedByCropId && runtime.derivedByCropId.get(String(crop.id)); // NEW
                actualHarvestActive = actualHarvestActive || (crop.useActualHarvest !== false // NEW
                    && !!derived // NEW
                    && Array.isArray(derived.actualHarvestWeeklyKg) // NEW
                    && derived.actualHarvestWeeklyKg.some(value => Number(value) > 0)); // NEW
                manualHarvestDates = manualHarvestDates || crop.useActualHarvest === false; // NEW

                cropMetrics.push({ // NEW
                    crop,
                    targetKg: target,
                    supplyKg: supply,
                    shortKg: shortage,
                    surplusKg: surplus,
                    plantsReq: Number(row.plantsReq),
                    seedsReq: Number(row.seedsReq),
                    errors,
                    status
                }); // NEW
            } // NEW

            const validationErrors = uniqueMessages([ // NEW
                ...PlanSchema.validate(plan), // NEW
                ...cropMetrics.flatMap(metric => metric.errors) // NEW
            ]); // NEW
            const diagnostics = uniqueMessages([ // NEW
                ...((runtime && runtime.warnings) || []), // NEW
                ...validationErrors, // NEW
                ...((settings.extraDiagnostics) || []) // NEW
            ]); // NEW
            const badges = []; // NEW
            if (cropMetrics.some(metric => metric.status === "Missing data")) badges.push("Missing data"); // NEW
            if (cropMetrics.some(metric => metric.status === "Short")) badges.push("Short"); // NEW
            if (cropMetrics.some(metric => metric.status === "Surplus")) badges.push("Surplus"); // NEW
            if (cropMetrics.length > 0 && cropMetrics.every(metric => metric.status === "OK" || metric.status === "No demand")) badges.push("OK"); // NEW
            if (actualHarvestActive) badges.push("Actual harvest active"); // NEW
            if (manualHarvestDates) badges.push("Manual harvest dates"); // NEW
            if (settings.dirty) badges.push("Unsaved"); // NEW

            return { // NEW
                year: Number(plan && plan.year), // NEW
                cropCount: cropMetrics.length, // NEW
                targetKg, // NEW
                supplyKg, // NEW
                shortKg, // NEW
                surplusKg, // NEW
                warningCount: diagnostics.length, // NEW
                validationErrors, // NEW
                diagnostics, // NEW
                badges, // NEW
                cropMetrics, // NEW
                cropMetricsById: new Map(cropMetrics.map(metric => [String(metric.crop.id), metric])) // NEW
            }; // NEW
        } // NEW

        return { // NEW
            createState,
            markBaseline,
            isDirty,
            persistenceSnapshot,
            resolveSelectedCropId,
            uniqueMessages,
            buildMethodOptions, // NEW
            compute
        }; // NEW
    })(); // NEW

    // -------------------- Modal UI (dashboard) -------------------- // CHANGE

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

    function renderHarvestDots(hostEl, weekStarts, weeklyKg) { // NEW
        if (!hostEl) return; // NEW
        const weeks = Array.isArray(weekStarts) ? weekStarts : []; // NEW
        const series = Array.isArray(weeklyKg) ? weeklyKg : []; // NEW
        const maxValue = Math.max(0, ...series.map(value => Number(value) || 0)); // NEW
        hostEl.innerHTML = ""; // NEW
        hostEl.style.cssText = "display:flex;flex-wrap:wrap;gap:2px;align-items:center;margin-top:6px;"; // NEW
        for (let index = 0; index < weeks.length; index++) { // NEW
            const value = Math.max(0, Number(series[index]) || 0); // NEW
            const intensity = maxValue > 0 ? Math.min(1, value / maxValue) : 0; // NEW
            const dot = document.createElement("div"); // NEW
            dot.style.cssText = `width:7px;height:7px;border-radius:999px;border:1px solid rgba(0,0,0,.25);background:rgba(0,0,0,${0.05 + 0.85 * intensity});`; // NEW
            dot.title = `${weeks[index] && weeks[index].iso || ""} - ${value.toFixed(2)} kg/week`; // NEW
            hostEl.appendChild(dot); // NEW
        } // NEW
    } // NEW

    // ------------ openPlanModal --------------
    // -------------------- Dashboard modal controller -------------------- // NEW
    /** Owns dashboard DOM construction, event orchestration, persistence, and session-scoped UI state. */ // NEW
    const YearPlanModalController = (() => { // NEW
        function open(moduleCell, year) { // NEW
            let currentYear = Number(year); // NEW
            const existing = PlanRepository.loadPlanForYear(moduleCell, currentYear); // NEW
            const plan = PlanSchema.normalizeForRuntime(existing || PlanSchema.createEmptyPlan(currentYear), currentYear); // NEW
            const state = YearPlanDashboard.createState(plan); // NEW
            const session = SessionController.start(moduleCell, currentYear, plan); // NEW
            const varietyCache = new Map(); // NEW
            const methodCache = new Map(); // NEW
            let runtime = null; // NEW
            let dashboard = null; // NEW
            let refreshTimer = null; // NEW
            let editorRefs = {}; // NEW

            const wrap = document.createElement("div"); // NEW
            wrap.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;"; // NEW
            const card = document.createElement("div"); // NEW
            card.style.cssText = "width:1180px;max-width:97vw;height:92vh;background:#fff;border:1px solid #777;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.25);display:flex;flex-direction:column;overflow:hidden;font:12px Arial,sans-serif;"; // NEW
            const style = document.createElement("style"); // NEW
            style.textContent = ` /* NEW */
                .yp-dashboard-grid{display:grid;grid-template-columns:280px minmax(0,1fr);gap:12px;align-items:start}
                .yp-field-grid{display:grid;grid-template-columns:repeat(2,minmax(220px,1fr));gap:10px}
                .yp-summary-grid{display:grid;grid-template-columns:repeat(7,minmax(90px,1fr));gap:6px}
                .yp-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
                .yp-line{display:grid;grid-template-columns:minmax(70px,1fr) 120px 150px 150px auto;gap:8px;align-items:center}
                .yp-package-line{display:grid;grid-template-columns:32px minmax(90px,1fr) 26px 100px 100px 90px auto;gap:8px;align-items:center}
                @media(max-width:850px){
                    .yp-dashboard-grid{grid-template-columns:1fr}
                    .yp-field-grid{grid-template-columns:1fr}
                    .yp-summary-grid{grid-template-columns:repeat(2,minmax(100px,1fr))}
                    .yp-line,.yp-package-line{display:flex;flex-wrap:wrap}
                    .yp-preview-grid{grid-template-columns:1fr!important}
                }`; // NEW
            card.appendChild(style); // NEW

            const header = document.createElement("div"); // NEW
            header.style.cssText = "padding:10px 12px;border-bottom:1px solid #ddd;display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;background:#fff;"; // NEW
            const titleEl = document.createElement("div"); // NEW
            titleEl.style.cssText = "font-weight:700;font-size:15px;white-space:nowrap;"; // NEW
            const headerControls = document.createElement("div"); // NEW
            headerControls.className = "yp-row"; // NEW
            const summaryBox = document.createElement("div"); // NEW
            summaryBox.style.cssText = "padding:8px 12px;border-bottom:1px solid #ddd;background:#fafafa;"; // NEW
            const body = document.createElement("div"); // NEW
            body.style.cssText = "padding:12px;overflow:auto;flex:1 1 auto;min-height:0;"; // NEW
            const addRow = document.createElement("div"); // NEW
            addRow.className = "yp-row"; // NEW
            addRow.style.marginBottom = "12px"; // NEW
            const dashboardGrid = document.createElement("div"); // NEW
            dashboardGrid.className = "yp-dashboard-grid"; // NEW
            const sidebar = document.createElement("div"); // NEW
            sidebar.style.cssText = "border:1px solid #ddd;border-radius:8px;background:#fff;overflow:hidden;"; // NEW
            const sidebarHead = document.createElement("div"); // NEW
            sidebarHead.style.cssText = "padding:10px;font-weight:700;border-bottom:1px solid #eee;"; // NEW
            sidebarHead.textContent = "Crops"; // NEW
            const cropList = document.createElement("div"); // NEW
            cropList.style.cssText = "display:flex;flex-direction:column;max-height:56vh;overflow:auto;"; // NEW
            sidebar.appendChild(sidebarHead); // NEW
            sidebar.appendChild(cropList); // NEW
            const mainColumn = document.createElement("div"); // NEW
            mainColumn.style.cssText = "display:flex;flex-direction:column;gap:12px;min-width:0;"; // NEW
            const editorBox = document.createElement("div"); // NEW
            editorBox.style.cssText = "border:1px solid #ddd;border-radius:8px;background:#fff;min-height:280px;"; // NEW
            const csaBox = document.createElement("div"); // NEW
            csaBox.style.cssText = "border:1px solid #ddd;border-radius:8px;padding:10px;background:#fff;"; // NEW
            mainColumn.appendChild(editorBox); // NEW
            mainColumn.appendChild(csaBox); // NEW
            dashboardGrid.appendChild(sidebar); // NEW
            dashboardGrid.appendChild(mainColumn); // NEW
            body.appendChild(addRow); // NEW
            body.appendChild(dashboardGrid); // NEW

            const previewDock = document.createElement("div"); // NEW
            previewDock.style.cssText = "border-top:1px solid #ccc;background:#fff;flex:0 0 auto;"; // NEW
            const previewBar = document.createElement("div"); // NEW
            previewBar.style.cssText = "padding:7px 12px;display:flex;align-items:center;justify-content:space-between;gap:10px;background:#f7f7f7;cursor:pointer;"; // NEW
            const previewSummary = document.createElement("div"); // NEW
            previewSummary.style.fontWeight = "700"; // NEW
            const previewToggle = mkBtn("Show diagnostics"); // NEW
            const previewDetails = document.createElement("div"); // NEW
            previewDetails.style.cssText = "display:none;max-height:310px;overflow:auto;padding:10px 12px;border-top:1px solid #ddd;"; // NEW
            const previewGrid = document.createElement("div"); // NEW
            previewGrid.className = "yp-preview-grid"; // NEW
            previewGrid.style.cssText = "display:grid;grid-template-columns:minmax(0,1fr) minmax(340px,1fr);gap:12px;"; // NEW
            const chartBox = document.createElement("div"); // NEW
            const chartControls = document.createElement("div"); // NEW
            chartControls.className = "yp-row"; // NEW
            chartControls.style.marginBottom = "6px"; // NEW
            const cropFilterSel = document.createElement("select"); // NEW
            const canvas = document.createElement("canvas"); // NEW
            canvas.width = 900; // NEW
            canvas.height = 190; // NEW
            canvas.style.cssText = "width:100%;height:190px;border:1px solid #eee;"; // NEW
            const totalsBox = document.createElement("div"); // NEW
            const diagnosticsBox = document.createElement("div"); // NEW
            diagnosticsBox.style.marginTop = "10px"; // NEW
            chartControls.appendChild(document.createTextNode("Crop filter")); // NEW
            chartControls.appendChild(cropFilterSel); // NEW
            chartBox.appendChild(chartControls); // NEW
            chartBox.appendChild(canvas); // NEW
            previewGrid.appendChild(chartBox); // NEW
            previewGrid.appendChild(totalsBox); // NEW
            previewDetails.appendChild(previewGrid); // NEW
            previewDetails.appendChild(diagnosticsBox); // NEW
            previewBar.appendChild(previewSummary); // NEW
            previewBar.appendChild(previewToggle); // NEW
            previewDock.appendChild(previewBar); // NEW
            previewDock.appendChild(previewDetails); // NEW

            const footer = document.createElement("div"); // NEW
            footer.style.cssText = "padding:9px 12px;border-top:1px solid #ccc;background:#fff;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;"; // NEW
            const footerStatus = document.createElement("div"); // NEW
            footerStatus.style.color = "#555"; // NEW
            const footerActions = document.createElement("div"); // NEW
            footerActions.className = "yp-row"; // NEW
            const closePrompt = document.createElement("div"); // NEW
            closePrompt.className = "yp-row"; // NEW
            closePrompt.style.display = "none"; // NEW
            closePrompt.appendChild(document.createTextNode("Unsaved changes.")); // NEW
            footer.appendChild(footerStatus); // NEW
            footer.appendChild(footerActions); // NEW
            footer.appendChild(closePrompt); // NEW

            card.appendChild(header); // NEW
            card.appendChild(summaryBox); // NEW
            card.appendChild(body); // NEW
            card.appendChild(previewDock); // NEW
            card.appendChild(footer); // NEW
            wrap.appendChild(card); // NEW
            document.body.appendChild(wrap); // NEW
            session.ui.modalEl = wrap; // NEW

            function mkBtn(label, primary) { // NEW
                const button = document.createElement("button"); // NEW
                button.type = "button"; // NEW
                button.textContent = label; // NEW
                button.style.cssText = `border:1px solid ${primary ? "#2f6fed" : "#888"};border-radius:6px;background:${primary ? "#2f6fed" : "#fff"};color:${primary ? "#fff" : "#222"};cursor:pointer;padding:6px 10px;font:12px Arial,sans-serif;`; // NEW
                return button; // NEW
            } // NEW

            function mkInput(type, value, width) { // NEW
                const input = document.createElement("input"); // NEW
                input.type = type; // NEW
                if (value !== null && value !== undefined) input.value = String(value); // NEW
                input.style.cssText = "padding:5px 6px;border:1px solid #bbb;border-radius:6px;box-sizing:border-box;"; // NEW
                if (width) input.style.width = `${width}px`; // NEW
                return input; // NEW
            } // NEW

            function mkSelect(options, value, width) { // NEW
                const select = document.createElement("select"); // NEW
                select.style.cssText = "padding:5px 6px;border:1px solid #bbb;border-radius:6px;box-sizing:border-box;"; // NEW
                if (width) select.style.width = `${width}px`; // NEW
                for (const option of (options || [])) { // NEW
                    const element = document.createElement("option"); // NEW
                    element.value = String(option.value); // NEW
                    element.textContent = String(option.label); // NEW
                    select.appendChild(element); // NEW
                } // NEW
                select.value = String(value ?? ""); // NEW
                return select; // NEW
            } // NEW

            function cropLabel(crop) { // NEW
                const plantName = String(crop && crop.plant || "").trim(); // NEW
                const varietyName = String(crop && crop.variety || "").trim(); // NEW
                return plantName && varietyName ? `${plantName} - ${varietyName}` : (plantName || varietyName || String(crop && crop.id || "Crop")); // NEW
            } // NEW

            function formatKg(value) { // NEW
                const number = Number(value); // NEW
                return Number.isFinite(number) ? `${number.toFixed(1)} kg` : "-"; // NEW
            } // NEW

            function statusColor(status) { // NEW
                if (status === "Short" || status === "Missing data") return "#a33"; // NEW
                if (status === "Surplus") return "#256a36"; // NEW
                if (status === "OK") return "#256a36"; // NEW
                return "#666"; // NEW
            } // NEW

            function listUnitOptions(crop) { // NEW
                const options = [{ value: "kg", label: "kg" }, { value: "g", label: "g" }, { value: "lb", label: "lb" }, { value: "plant", label: "plant" }]; // NEW
                const seen = new Set(options.map(option => option.value)); // NEW
                for (const pkg of ((crop && crop.packages) || [])) { // NEW
                    const unit = String(pkg && pkg.unit || "").trim(); // NEW
                    const key = unit.toLowerCase(); // NEW
                    if (!key || seen.has(key)) continue; // NEW
                    seen.add(key); // NEW
                    options.push({ value: unit, label: unit }); // NEW
                } // NEW
                return options; // NEW
            } // NEW

            function defaultUnit(crop) { // NEW
                return String(crop && crop.packages && crop.packages[0] && crop.packages[0].unit || "").trim() || "kg"; // NEW
            } // NEW

            function selectedCrop() { // NEW
                return (plan.crops || []).find(crop => String(crop.id) === String(state.selectedCropId)) || null; // NEW
            } // NEW

            function addField(host, label, control, help) { // NEW
                const field = document.createElement("label"); // NEW
                field.style.cssText = "display:flex;flex-direction:column;gap:4px;min-width:0;"; // NEW
                const title = document.createElement("span"); // NEW
                title.style.fontWeight = "700"; // NEW
                title.textContent = label; // NEW
                if (control && !control.style.width) control.style.width = "100%"; // NEW
                field.appendChild(title); // NEW
                field.appendChild(control); // NEW
                if (help) { // NEW
                    const note = document.createElement("span"); // NEW
                    note.style.cssText = "color:#666;font-size:11px;"; // NEW
                    note.textContent = help; // NEW
                    field.appendChild(note); // NEW
                } // NEW
                host.appendChild(field); // NEW
                return field; // NEW
            } // NEW

            function debounceRefresh() { // NEW
                if (refreshTimer) clearTimeout(refreshTimer); // NEW
                refreshTimer = setTimeout(() => { // NEW
                    refreshTimer = null; // NEW
                    if (SessionController.isActive(session)) refreshDerived(); // NEW
                }, 90); // NEW
            } // NEW

            function ensureMarketBaseTo(crop, line) { // NEW
                if (!line || PlanMath.hasYmd(line.__baseTo)) return; // NEW
                line.__baseTo = PlanMath.hasYmd(line.to) ? String(line.to) : (PlanMath.hasYmd(crop.harvestEnd) ? String(crop.harvestEnd) : ""); // NEW
            } // NEW

            function applyShelfToMarket(crop, line) { // NEW
                ensureMarketBaseTo(crop, line); // NEW
                if (PlanMath.hasYmd(line.__baseTo)) line.to = PlanRuntimeService.addDaysYmd(line.__baseTo, Math.max(0, Math.trunc(Number(crop.shelfLifeDays) || 0))) || line.to; // NEW
            } // NEW

            function removeShelfFromMarket(crop, line) { // NEW
                ensureMarketBaseTo(crop, line); // NEW
                if (PlanMath.hasYmd(line.__baseTo)) line.to = String(line.__baseTo); // NEW
            } // NEW

            function fillTemplateDropdown() { // NEW
                templateSel.innerHTML = ""; // NEW
                templateSel.appendChild(new Option("-- Select template --", "")); // NEW
                for (const name of PlanRepository.listTemplateNames()) templateSel.appendChild(new Option(name, name)); // NEW
            } // NEW

            function fillCropFilter() { // NEW
                const current = String(plan.cropFilterId || ""); // NEW
                cropFilterSel.innerHTML = ""; // NEW
                cropFilterSel.appendChild(new Option("-- All crops --", "")); // NEW
                for (const crop of (plan.crops || [])) cropFilterSel.appendChild(new Option(cropLabel(crop), crop.id)); // NEW
                cropFilterSel.value = (plan.crops || []).some(crop => String(crop.id) === current) ? current : ""; // NEW
                plan.cropFilterId = cropFilterSel.value; // NEW
            } // NEW

            function replacePlan(nextPlan, nextYear) { // NEW
                Object.keys(plan).forEach(key => delete plan[key]); // NEW
                Object.assign(plan, PlanSchema.normalizeForRuntime(nextPlan, nextYear)); // NEW
                currentYear = Number(nextYear); // NEW
                plan.year = currentYear; // NEW
                state.selectedCropId = YearPlanDashboard.resolveSelectedCropId(plan.crops, "", 0); // NEW
                state.activeTab = "basics"; // NEW
                state.validationState = "idle"; // NEW
                state.lastSavedAt = null; // NEW
                state.closePromptOpen = false; // NEW
                state.extraDiagnostics = []; // NEW
                titleEl.textContent = `Plan Year - ${currentYear}`; // NEW
                yearInput.value = String(currentYear); // NEW
            } // NEW

            function renderSummary() { // NEW
                summaryBox.innerHTML = ""; // NEW
                const grid = document.createElement("div"); // NEW
                grid.className = "yp-summary-grid"; // NEW
                const values = [ // NEW
                    ["Year", dashboard.year],
                    ["Crops", dashboard.cropCount],
                    ["Target", formatKg(dashboard.targetKg)],
                    ["Supply", formatKg(dashboard.supplyKg)],
                    ["Short", formatKg(dashboard.shortKg)],
                    ["Surplus", formatKg(dashboard.surplusKg)],
                    ["Warnings", dashboard.warningCount]
                ]; // NEW
                for (const pair of values) { // NEW
                    const item = document.createElement("div"); // NEW
                    item.style.cssText = "border:1px solid #ddd;border-radius:6px;padding:6px 8px;background:#fff;"; // NEW
                    item.innerHTML = `<div style="color:#666;font-size:10px;text-transform:uppercase;">${mxUtils.htmlEntities(String(pair[0]))}</div><div style="font-weight:700;margin-top:2px;">${mxUtils.htmlEntities(String(pair[1]))}</div>`; // NEW
                    grid.appendChild(item); // NEW
                } // NEW
                summaryBox.appendChild(grid); // NEW
                const badges = document.createElement("div"); // NEW
                badges.className = "yp-row"; // NEW
                badges.style.marginTop = "7px"; // NEW
                for (const label of dashboard.badges) { // NEW
                    const badge = document.createElement("span"); // NEW
                    badge.textContent = label; // NEW
                    badge.style.cssText = `padding:3px 7px;border-radius:999px;border:1px solid #bbb;background:#fff;color:${statusColor(label)};font-weight:700;`; // NEW
                    badges.appendChild(badge); // NEW
                } // NEW
                summaryBox.appendChild(badges); // NEW
            } // NEW

            function renderCropList() { // NEW
                cropList.innerHTML = ""; // NEW
                if (!dashboard.cropMetrics.length) { // NEW
                    const empty = document.createElement("div"); // NEW
                    empty.style.cssText = "padding:16px;color:#666;"; // NEW
                    empty.textContent = "No crops in this plan."; // NEW
                    cropList.appendChild(empty); // NEW
                    return; // NEW
                } // NEW
                for (const metric of dashboard.cropMetrics) { // NEW
                    const selected = String(metric.crop.id) === String(state.selectedCropId); // NEW
                    const cardEl = document.createElement("button"); // NEW
                    cardEl.type = "button"; // NEW
                    cardEl.style.cssText = `border:0;border-bottom:1px solid #eee;background:${selected ? "#eef4ff" : "#fff"};padding:10px;text-align:left;cursor:pointer;width:100%;`; // NEW
                    const detail = metric.status === "Short" ? `Short ${formatKg(metric.shortKg)}` // NEW
                        : metric.status === "Surplus" ? `Surplus ${formatKg(metric.surplusKg)}` // NEW
                            : metric.status; // NEW
                    cardEl.innerHTML = `<div style="font-weight:700;">${mxUtils.htmlEntities(cropLabel(metric.crop))}</div><div style="margin-top:4px;color:#555;">Target ${formatKg(metric.targetKg)} | Supply ${formatKg(metric.supplyKg)}</div><div style="margin-top:4px;color:${statusColor(metric.status)};font-weight:700;">${mxUtils.htmlEntities(detail)}</div>`; // NEW
                    cardEl.addEventListener("click", () => { // NEW
                        state.selectedCropId = String(metric.crop.id); // NEW
                        state.activeTab = "basics"; // NEW
                        renderCropList(); // NEW
                        renderSelectedEditor(); // NEW
                    }); // NEW
                    cropList.appendChild(cardEl); // NEW
                } // NEW
            } // NEW

            function syncEditorDerived() { // NEW
                const crop = selectedCrop(); // NEW
                if (!crop || !dashboard) return; // NEW
                const metric = dashboard.cropMetricsById.get(String(crop.id)); // NEW
                if (editorRefs.actual) editorRefs.actual.value = String(Math.max(0, Math.trunc(Number(crop.actualPlants) || 0))); // NEW
                if (editorRefs.required) editorRefs.required.value = String(metric && Number.isFinite(metric.plantsReq) && metric.plantsReq > 0 ? Math.ceil(metric.plantsReq) : 0); // NEW
                if (editorRefs.seeds) editorRefs.seeds.value = String(metric && Number.isFinite(metric.seedsReq) && metric.seedsReq > 0 ? Math.ceil(metric.seedsReq) : 0); // NEW
                if (editorRefs.harvestStart) editorRefs.harvestStart.value = PlanMath.hasYmd(crop.harvestStart) ? crop.harvestStart : ""; // NEW
                if (editorRefs.harvestEnd) editorRefs.harvestEnd.value = PlanMath.hasYmd(crop.harvestEnd) ? crop.harvestEnd : ""; // NEW
                if (editorRefs.demandSummary && metric) editorRefs.demandSummary.textContent = `Market target: ${formatKg(metric.targetKg)} | Estimated supply: ${formatKg(metric.supplyKg)} | Short: ${formatKg(metric.shortKg)} | Surplus: ${formatKg(metric.surplusKg)}`; // NEW
                if (editorRefs.harvestDots && runtime) { // NEW
                    const derived = runtime.derivedByCropId.get(String(crop.id)); // NEW
                    renderHarvestDots(editorRefs.harvestDots, runtime.weekStarts, derived ? derived.actualHarvestWeeklyKg : []); // NEW
                } // NEW
            } // NEW

            function renderPreview() { // NEW
                previewDetails.style.display = state.previewExpanded ? "block" : "none"; // NEW
                previewToggle.textContent = state.previewExpanded ? "Hide diagnostics" : "Show diagnostics"; // NEW
                previewSummary.textContent = `Target ${formatKg(dashboard.targetKg)} | Supply ${formatKg(dashboard.supplyKg)} | Short ${formatKg(dashboard.shortKg)} | ${dashboard.warningCount} warning${dashboard.warningCount === 1 ? "" : "s"}`; // NEW
                if (!state.previewExpanded) return; // NEW
                const cropId = String(plan.cropFilterId || ""); // NEW
                const series = cropId && runtime.weekly.perCrop.get(cropId); // NEW
                drawPlanChart(canvas, runtime.weekly, series ? series.target : undefined, series ? series.supply : undefined); // NEW
                const rows = dashboard.cropMetrics.map(metric => `<tr><td>${mxUtils.htmlEntities(cropLabel(metric.crop))}</td><td>${metric.targetKg.toFixed(1)}</td><td>${metric.supplyKg.toFixed(1)}</td><td>${metric.shortKg.toFixed(1)}</td><td>${metric.surplusKg.toFixed(1)}</td><td>${mxUtils.htmlEntities(metric.status)}</td></tr>`).join(""); // NEW
                totalsBox.innerHTML = `<div style="font-weight:700;margin-bottom:6px;">Totals</div><table style="width:100%;border-collapse:collapse;"><thead><tr><th>Crop</th><th>Target</th><th>Supply</th><th>Short</th><th>Surplus</th><th>Status</th></tr></thead><tbody>${rows || '<tr><td colspan="6">No crops.</td></tr>'}</tbody></table>`; // NEW
                for (const cell of totalsBox.querySelectorAll("th,td")) cell.style.cssText = "border:1px solid #ddd;padding:4px;text-align:left;"; // NEW
                diagnosticsBox.innerHTML = dashboard.diagnostics.length // NEW
                    ? `<div style="font-weight:700;margin-bottom:5px;">Diagnostics</div><ul style="margin:0 0 0 18px;padding:0;">${dashboard.diagnostics.map(message => `<li>${mxUtils.htmlEntities(message)}</li>`).join("")}</ul>` // NEW
                    : '<div style="color:#256a36;font-weight:700;">No diagnostics.</div>'; // NEW
            } // NEW

            function renderFooter() { // NEW
                const dirty = YearPlanDashboard.isDirty(state, plan); // NEW
                if (state.validationState === "invalid") footerStatus.textContent = "Validation failed"; // NEW
                else if (dirty) footerStatus.textContent = "Unsaved changes"; // NEW
                else if (state.lastSavedAt) footerStatus.textContent = `Last saved ${state.lastSavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`; // NEW
                else footerStatus.textContent = existing ? "Loaded saved plan" : "New plan"; // NEW
                closePrompt.style.display = state.closePromptOpen ? "flex" : "none"; // NEW
                footerActions.style.display = state.closePromptOpen ? "none" : "flex"; // NEW
            } // NEW

            function refreshDerived() { // NEW
                runtime = PlanRuntimeService.recalculate(moduleCell, currentYear, plan); // NEW
                const dirty = state.baselineSnapshot ? YearPlanDashboard.isDirty(state, plan) : false; // NEW
                dashboard = YearPlanDashboard.compute(plan, runtime, { dirty, extraDiagnostics: state.extraDiagnostics }); // NEW
                state.selectedCropId = YearPlanDashboard.resolveSelectedCropId(plan.crops, state.selectedCropId, 0); // NEW
                renderSummary(); // NEW
                renderCropList(); // NEW
                renderPreview(); // NEW
                renderFooter(); // NEW
                syncEditorDerived(); // NEW
                return runtime; // NEW
            } // NEW

            async function loadVarieties(crop, select) { // NEW
                const key = String(crop.plantId || ""); // NEW
                select.disabled = true; // NEW
                try { // NEW
                    let rows = varietyCache.get(key); // NEW
                    if (!rows) { // NEW
                        rows = await DbClient.queryVarietiesByPlantId(key); // NEW
                        varietyCache.set(key, rows); // NEW
                    } // NEW
                    if (!SessionController.isActive(session) || selectedCrop() !== crop || editorRefs.variety !== select) return; // NEW
                    select.innerHTML = ""; // NEW
                    select.appendChild(new Option("(base plant)", "")); // NEW
                    for (const row of rows) select.appendChild(new Option(String(row.variety_name || row.variety_id), String(row.variety_id))); // NEW
                    const desired = crop.varietyId == null ? "" : String(crop.varietyId); // NEW
                    if (desired && !rows.some(row => String(row.variety_id) === desired)) select.appendChild(new Option(`${crop.variety || desired} (unavailable)`, desired)); // NEW
                    select.value = desired; // NEW
                } catch (error) { // NEW
                    if (SessionController.isActive(session)) { // NEW
                        select.innerHTML = ""; // NEW
                        select.appendChild(new Option(crop.variety || "(varieties unavailable)", crop.varietyId == null ? "" : String(crop.varietyId))); // NEW
                    } // NEW
                } finally { // NEW
                    if (SessionController.isActive(session) && editorRefs.variety === select) select.disabled = false; // NEW
                } // NEW
            } // NEW

            async function loadMethods(crop, select, diagnostic) { // NEW
                const key = String(crop.plantId || ""); // NEW
                select.disabled = true; // NEW
                try { // NEW
                    let rows = methodCache.get(key); // NEW
                    if (!rows) { // NEW
                        rows = await DbClient.queryPlantingMethodsForPlantId(key); // NEW
                        methodCache.set(key, rows); // NEW
                    } // NEW
                    if (!SessionController.isActive(session) || selectedCrop() !== crop || editorRefs.method !== select) return; // NEW
                    select.innerHTML = ""; // NEW
                    const current = String(crop.method || "").trim(); // NEW
                    const options = YearPlanDashboard.buildMethodOptions(rows, current); // NEW
                    for (const option of options) select.appendChild(new Option(option.label, option.value)); // NEW
                    diagnostic.textContent = options.some(option => option.value === current && option.unavailable) // NEW
                        ? "The saved planting method is not available in current plant metadata. It will be preserved until changed." // NEW
                        : ""; // NEW
                    if (!current && options.length) crop.method = String(options[0].value); // NEW
                    select.value = String(crop.method || ""); // NEW
                    if (!current && crop.method) refreshDerived(); // NEW
                } catch (error) { // NEW
                    if (SessionController.isActive(session)) { // NEW
                        select.innerHTML = ""; // NEW
                        select.appendChild(new Option(String(crop.method || "(unavailable)"), String(crop.method || ""))); // NEW
                        diagnostic.textContent = "Planting method metadata could not be loaded. The current value is preserved."; // NEW
                    } // NEW
                } finally { // NEW
                    if (SessionController.isActive(session) && editorRefs.method === select) select.disabled = false; // NEW
                } // NEW
            } // NEW

            function renderBasics(crop, content) { // NEW
                const grid = document.createElement("div"); // NEW
                grid.className = "yp-field-grid"; // NEW
                const plant = mkInput("text", crop.plant || "", 0); // NEW
                plant.disabled = true; // NEW
                const varietyRow = document.createElement("div"); // NEW
                varietyRow.className = "yp-row"; // NEW
                const variety = document.createElement("select"); // NEW
                variety.style.cssText = "padding:5px 6px;border:1px solid #bbb;border-radius:6px;flex:1 1 180px;"; // NEW
                const addVariety = mkBtn("+"); // NEW
                varietyRow.appendChild(variety); // NEW
                varietyRow.appendChild(addVariety); // NEW
                const kg = mkInput("number", crop.kgPerPlant ?? ""); // NEW
                kg.min = "0"; // NEW
                const germ = mkInput("number", crop.germRate ?? 1); // NEW
                germ.min = "0.01"; germ.max = "1"; germ.step = "0.01"; // NEW
                const harvestStart = mkInput("date", crop.harvestStart || ""); // NEW
                const harvestEnd = mkInput("date", crop.harvestEnd || ""); // NEW
                const shelf = mkInput("number", crop.shelfLifeDays ?? 0); // NEW
                shelf.min = "0"; // NEW
                const actual = mkInput("number", crop.actualPlants ?? 0); // NEW
                const required = mkInput("number", crop.plantsReq ?? 0); // NEW
                const seeds = mkInput("number", crop.seedsReq ?? 0); // NEW
                actual.disabled = required.disabled = seeds.disabled = true; // NEW
                const useActual = document.createElement("input"); // NEW
                useActual.type = "checkbox"; useActual.checked = crop.useActualHarvest !== false; // NEW
                const syncAvailability = document.createElement("input"); // NEW
                syncAvailability.type = "checkbox"; syncAvailability.checked = !!crop.syncharvest; // NEW
                const useActualLabel = document.createElement("label"); // NEW
                useActualLabel.className = "yp-row"; useActualLabel.appendChild(useActual); useActualLabel.appendChild(document.createTextNode("Use actual harvest")); // NEW
                const syncLabel = document.createElement("label"); // NEW
                syncLabel.className = "yp-row"; syncLabel.appendChild(syncAvailability); syncLabel.appendChild(document.createTextNode("Sync availability")); // NEW
                harvestStart.disabled = harvestEnd.disabled = useActual.checked; // NEW
                addField(grid, "Plant", plant); // NEW
                addField(grid, "Variety", varietyRow); // NEW
                addField(grid, "kg/plant", kg, crop.kgPerPlantMode === "manual" ? "Manual override" : "Using plant or variety default"); // NEW
                addField(grid, "Germination rate", germ, "Value from 0.01 through 1.00"); // NEW
                addField(grid, "Harvest start", harvestStart); // NEW
                addField(grid, "Harvest end", harvestEnd); // NEW
                addField(grid, "Shelf life (days)", shelf); // NEW
                addField(grid, "Actual plants", actual, "Read from diagram planting groups"); // NEW
                addField(grid, "Plants required", required, "Calculated from target and yield"); // NEW
                addField(grid, "Seeds required", seeds, "Calculated from plants required and germination"); // NEW
                grid.appendChild(useActualLabel); // NEW
                grid.appendChild(syncLabel); // NEW
                content.appendChild(grid); // NEW
                editorRefs = { ...editorRefs, variety, actual, required, seeds, harvestStart, harvestEnd }; // NEW
                loadVarieties(crop, variety); // NEW

                variety.addEventListener("change", () => { // NEW
                    const next = String(variety.value || ""); // NEW
                    const duplicate = PlanSchema.findDuplicateCrop(plan, crop.plantId, next, crop.id); // NEW
                    if (duplicate) { // NEW
                        variety.value = crop.varietyId == null ? "" : String(crop.varietyId); // NEW
                        state.extraDiagnostics = ["That plant/variety already exists in this year plan."]; // NEW
                        state.previewExpanded = true; // NEW
                        refreshDerived(); // NEW
                        return; // NEW
                    } // NEW
                    state.extraDiagnostics = []; // NEW
                    const rows = varietyCache.get(String(crop.plantId || "")) || []; // NEW
                    const row = rows.find(item => String(item.variety_id) === next); // NEW
                    crop.varietyId = next ? Number(next) : null; // NEW
                    crop.variety = row ? String(row.variety_name || "") : ""; // NEW
                    const overrides = row ? Env.safeJsonStringParse(row.overrides_json, null) : null; // NEW
                    const overrideYield = Number(overrides && (overrides.yield_per_plant_kg ?? overrides.overrides?.yield_per_plant_kg)); // NEW
                    crop.kgPerPlantMode = "auto"; // NEW
                    const autoYield = Number.isFinite(overrideYield) && overrideYield > 0 ? overrideYield : Number(crop.baseKgPerPlant); // NEW
                    if (Number.isFinite(autoYield) && autoYield > 0) crop.kgPerPlant = autoYield; // NEW
                    renderSelectedEditor(); // NEW
                    refreshDerived(); // NEW
                }); // NEW
                addVariety.addEventListener("click", () => { // NEW
                    graph.fireEvent(new mxEventObject("usl:openVarietyEditor", "cropId", String(crop.id), "plantId", Number(crop.plantId), "varietyId", crop.varietyId == null ? null : Number(crop.varietyId))); // NEW
                }); // NEW
                kg.addEventListener("input", () => { crop.kgPerPlant = Number(kg.value); crop.kgPerPlantMode = "manual"; debounceRefresh(); }); // NEW
                germ.addEventListener("input", () => { crop.germRate = Math.max(0.01, Math.min(1, Number(germ.value) || 1)); debounceRefresh(); }); // NEW
                useActual.addEventListener("change", () => { crop.useActualHarvest = useActual.checked; harvestStart.disabled = harvestEnd.disabled = useActual.checked; refreshDerived(); }); // NEW
                syncAvailability.addEventListener("change", () => { // NEW
                    crop.syncharvest = syncAvailability.checked; // NEW
                    for (const line of (crop.market || [])) crop.syncharvest ? applyShelfToMarket(crop, line) : removeShelfFromMarket(crop, line); // NEW
                    refreshDerived(); // NEW
                }); // NEW
                harvestStart.addEventListener("change", () => { // NEW
                    const before = { hs: crop.harvestStart, he: crop.harvestEnd, availEnd: PlanRuntimeService.cropAvailableEndYmd(crop) }; // NEW
                    crop.harvestStart = harvestStart.value; // NEW
                    PlanRuntimeService.syncCropDatesIfEnabled(plan, crop, before); // NEW
                    refreshDerived(); // NEW
                }); // NEW
                harvestEnd.addEventListener("change", () => { // NEW
                    const before = { hs: crop.harvestStart, he: crop.harvestEnd, availEnd: PlanRuntimeService.cropAvailableEndYmd(crop) }; // NEW
                    crop.harvestEnd = harvestEnd.value; // NEW
                    PlanRuntimeService.syncCropDatesIfEnabled(plan, crop, before); // NEW
                    refreshDerived(); // NEW
                }); // NEW
                shelf.addEventListener("input", () => { // NEW
                    crop.shelfLifeDays = Math.max(0, Math.trunc(Number(shelf.value) || 0)); // NEW
                    if (crop.syncharvest) for (const line of (crop.market || [])) applyShelfToMarket(crop, line); // NEW
                    debounceRefresh(); // NEW
                }); // NEW
            } // NEW

            function renderDemand(crop, content) { // NEW
                const summary = document.createElement("div"); // NEW
                summary.style.cssText = "padding:8px;border:1px solid #ddd;border-radius:6px;background:#fafafa;font-weight:700;margin-bottom:10px;"; // NEW
                content.appendChild(summary); // NEW
                editorRefs.demandSummary = summary; // NEW
                const rowsHost = document.createElement("div"); // NEW
                rowsHost.style.cssText = "display:flex;flex-direction:column;gap:7px;"; // NEW
                content.appendChild(rowsHost); // NEW
                const add = mkBtn("Add market line"); // NEW
                add.style.marginTop = "8px"; // NEW
                content.appendChild(add); // NEW

                const columns = document.createElement("div"); // NEW
                columns.className = "yp-line"; // NEW
                columns.style.cssText += ";font-weight:700;color:#555;"; // NEW
                for (const label of ["Qty", "Unit", "From", "To", ""]) columns.appendChild(document.createTextNode(label)); // NEW
                rowsHost.appendChild(columns); // NEW

                function renderRows() { // NEW
                    rowsHost.innerHTML = ""; // NEW
                    rowsHost.appendChild(columns); // NEW
                    crop.market = Array.isArray(crop.market) ? crop.market : []; // NEW
                    for (const line of crop.market) { // NEW
                        const row = document.createElement("div"); // NEW
                        row.className = "yp-line"; // NEW
                        const qty = mkInput("number", line.qty ?? 0); // NEW
                        const unit = mkSelect(listUnitOptions(crop), line.unit || defaultUnit(crop)); // NEW
                        const from = mkInput("date", line.from || crop.harvestStart || ""); // NEW
                        const to = mkInput("date", line.to || crop.harvestEnd || ""); // NEW
                        const remove = mkBtn("Remove"); // NEW
                        row.appendChild(qty); row.appendChild(unit); row.appendChild(from); row.appendChild(to); row.appendChild(remove); // NEW
                        rowsHost.appendChild(row); // NEW
                        qty.addEventListener("input", () => { line.qty = Math.max(0, Number(qty.value) || 0); debounceRefresh(); }); // NEW
                        unit.addEventListener("change", () => { line.unit = unit.value; refreshDerived(); }); // NEW
                        from.addEventListener("change", () => { line.from = from.value; refreshDerived(); }); // NEW
                        to.addEventListener("change", () => { // NEW
                            line.to = to.value; // NEW
                            line.__baseTo = crop.syncharvest ? (PlanRuntimeService.addDaysYmd(to.value, -Math.max(0, Math.trunc(Number(crop.shelfLifeDays) || 0))) || "") : to.value; // NEW
                            refreshDerived(); // NEW
                        }); // NEW
                        remove.addEventListener("click", () => { crop.market = crop.market.filter(item => item !== line); renderRows(); refreshDerived(); }); // NEW
                    } // NEW
                } // NEW

                add.addEventListener("click", () => { // NEW
                    const line = { qty: 0, unit: defaultUnit(crop), from: crop.harvestStart || "", to: crop.harvestEnd || "" }; // NEW
                    line.__baseTo = line.to; // NEW
                    if (crop.syncharvest) applyShelfToMarket(crop, line); // NEW
                    crop.market.push(line); // NEW
                    renderRows(); // NEW
                    refreshDerived(); // NEW
                }); // NEW
                renderRows(); // NEW
            } // NEW

            function renderPackages(crop, content) { // NEW
                const defaultLabel = document.createElement("label"); // NEW
                defaultLabel.className = "yp-row"; // NEW
                const saveDefault = document.createElement("input"); // NEW
                saveDefault.type = "checkbox"; saveDefault.checked = !!crop.savePackagesAsDefault; // NEW
                defaultLabel.appendChild(saveDefault); defaultLabel.appendChild(document.createTextNode("Save as default for plant")); // NEW
                content.appendChild(defaultLabel); // NEW
                const rowsHost = document.createElement("div"); // NEW
                rowsHost.style.cssText = "display:flex;flex-direction:column;gap:7px;margin-top:10px;"; // NEW
                content.appendChild(rowsHost); // NEW
                const add = mkBtn("Add package"); // NEW
                add.style.marginTop = "8px"; // NEW
                content.appendChild(add); // NEW
                saveDefault.addEventListener("change", () => { crop.savePackagesAsDefault = saveDefault.checked; renderFooter(); }); // NEW

                const columns = document.createElement("div"); // NEW
                columns.className = "yp-package-line"; // NEW
                columns.style.cssText += ";font-weight:700;color:#555;"; // NEW
                for (const label of ["", "Unit", "", "Quantity", "Base", "Price", ""]) columns.appendChild(document.createTextNode(label)); // NEW

                function renderRows() { // NEW
                    rowsHost.innerHTML = ""; // NEW
                    rowsHost.appendChild(columns); // NEW
                    crop.packages = Array.isArray(crop.packages) ? crop.packages : []; // NEW
                    for (const pkg of crop.packages) { // NEW
                        const row = document.createElement("div"); // NEW
                        row.className = "yp-package-line"; // NEW
                        const unit = mkInput("text", pkg.unit || ""); // NEW
                        const baseQty = mkInput("number", pkg.baseQty ?? 1); // NEW
                        const baseType = mkSelect([{ value: "kg", label: "kg" }, { value: "plant", label: "plant" }], pkg.baseType || "kg"); // NEW
                        const price = mkInput("number", Number.isFinite(Number(pkg.price)) ? pkg.price : ""); // NEW
                        const remove = mkBtn("Remove"); // NEW
                        row.appendChild(document.createTextNode("1")); row.appendChild(unit); row.appendChild(document.createTextNode("=")); row.appendChild(baseQty); row.appendChild(baseType); row.appendChild(price); row.appendChild(remove); // NEW
                        rowsHost.appendChild(row); // NEW
                        unit.addEventListener("input", () => { pkg.unit = unit.value; debounceRefresh(); }); // NEW
                        baseQty.addEventListener("input", () => { pkg.baseQty = Math.max(0, Number(baseQty.value) || 0); debounceRefresh(); }); // NEW
                        baseType.addEventListener("change", () => { pkg.baseType = baseType.value; refreshDerived(); }); // NEW
                        price.addEventListener("input", () => { pkg.price = price.value === "" ? NaN : Math.max(0, Number(price.value) || 0); renderFooter(); }); // NEW
                        remove.addEventListener("click", () => { crop.packages = crop.packages.filter(item => item !== pkg); renderRows(); refreshDerived(); }); // NEW
                    } // NEW
                } // NEW

                add.addEventListener("click", () => { crop.packages.push({ unit: "kg", baseType: "kg", baseQty: 1, price: NaN }); renderRows(); refreshDerived(); }); // NEW
                renderRows(); // NEW
            } // NEW

            function renderAdvanced(crop, content) { // NEW
                const grid = document.createElement("div"); // NEW
                grid.className = "yp-field-grid"; // NEW
                const method = document.createElement("select"); // NEW
                method.style.cssText = "padding:5px 6px;border:1px solid #bbb;border-radius:6px;width:100%;"; // NEW
                const methodDiagnostic = document.createElement("div"); // NEW
                methodDiagnostic.style.cssText = "color:#a33;font-size:11px;margin-top:4px;"; // NEW
                const methodHost = document.createElement("div"); // NEW
                methodHost.appendChild(method); methodHost.appendChild(methodDiagnostic); // NEW
                const cropId = mkInput("text", crop.id || ""); cropId.disabled = true; // NEW
                const plantId = mkInput("text", crop.plantId || ""); plantId.disabled = true; // NEW
                const varietyId = mkInput("text", crop.varietyId == null ? "" : crop.varietyId); varietyId.disabled = true; // NEW
                const modeHost = document.createElement("div"); // NEW
                modeHost.className = "yp-row"; // NEW
                const mode = document.createElement("span"); // NEW
                mode.textContent = crop.kgPerPlantMode === "manual" ? "Manual override" : "Automatic"; // NEW
                const resetYield = mkBtn("Reset to default"); // NEW
                modeHost.appendChild(mode); modeHost.appendChild(resetYield); // NEW
                addField(grid, "Planting method", methodHost); // NEW
                addField(grid, "Yield override state", modeHost); // NEW
                addField(grid, "Crop ID", cropId); // NEW
                addField(grid, "Plant ID", plantId); // NEW
                addField(grid, "Variety ID", varietyId); // NEW
                content.appendChild(grid); // NEW
                const dotsTitle = document.createElement("div"); // NEW
                dotsTitle.style.cssText = "font-weight:700;margin-top:14px;"; // NEW
                dotsTitle.textContent = "Actual harvest by week"; // NEW
                const dots = document.createElement("div"); // NEW
                content.appendChild(dotsTitle); content.appendChild(dots); // NEW
                editorRefs.method = method; // NEW
                editorRefs.harvestDots = dots; // NEW
                loadMethods(crop, method, methodDiagnostic); // NEW
                method.addEventListener("change", () => { crop.method = method.value; refreshDerived(); }); // NEW
                resetYield.addEventListener("click", () => { // NEW
                    crop.kgPerPlantMode = "auto"; // NEW
                    let nextYield = Number(crop.baseKgPerPlant); // NEW
                    const rows = varietyCache.get(String(crop.plantId || "")) || []; // NEW
                    const row = rows.find(item => String(item.variety_id) === String(crop.varietyId ?? "")); // NEW
                    const overrides = row ? Env.safeJsonStringParse(row.overrides_json, null) : null; // NEW
                    const overrideYield = Number(overrides && (overrides.yield_per_plant_kg ?? overrides.overrides?.yield_per_plant_kg)); // NEW
                    if (Number.isFinite(overrideYield) && overrideYield > 0) nextYield = overrideYield; // NEW
                    if (Number.isFinite(nextYield) && nextYield > 0) crop.kgPerPlant = nextYield; // NEW
                    renderSelectedEditor(); // NEW
                    refreshDerived(); // NEW
                }); // NEW
            } // NEW

            function renderSelectedEditor() { // NEW
                editorBox.innerHTML = ""; // NEW
                editorRefs = {}; // NEW
                const crop = selectedCrop(); // NEW
                if (!crop) { // NEW
                    const empty = document.createElement("div"); // NEW
                    empty.style.cssText = "padding:24px;color:#666;text-align:center;"; // NEW
                    empty.textContent = "Add or select a crop to edit its plan."; // NEW
                    editorBox.appendChild(empty); // NEW
                    return; // NEW
                } // NEW
                const head = document.createElement("div"); // NEW
                head.style.cssText = "padding:10px 12px;border-bottom:1px solid #ddd;display:flex;justify-content:space-between;gap:10px;align-items:center;"; // NEW
                const title = document.createElement("div"); // NEW
                title.style.cssText = "font-size:14px;font-weight:700;"; // NEW
                title.textContent = cropLabel(crop); // NEW
                const remove = mkBtn("Remove crop"); // NEW
                head.appendChild(title); head.appendChild(remove); // NEW
                const tabs = document.createElement("div"); // NEW
                tabs.style.cssText = "display:flex;gap:4px;padding:8px 10px 0;flex-wrap:wrap;"; // NEW
                const content = document.createElement("div"); // NEW
                content.style.padding = "12px"; // NEW
                for (const tab of [{ id: "basics", label: "Basics" }, { id: "demand", label: "Demand" }, { id: "packages", label: "Packages" }, { id: "advanced", label: "Advanced" }]) { // NEW
                    const button = mkBtn(tab.label, state.activeTab === tab.id); // NEW
                    button.addEventListener("click", () => { state.activeTab = tab.id; renderSelectedEditor(); syncEditorDerived(); }); // NEW
                    tabs.appendChild(button); // NEW
                } // NEW
                editorBox.appendChild(head); editorBox.appendChild(tabs); editorBox.appendChild(content); // NEW
                if (state.activeTab === "demand") renderDemand(crop, content); // NEW
                else if (state.activeTab === "packages") renderPackages(crop, content); // NEW
                else if (state.activeTab === "advanced") renderAdvanced(crop, content); // NEW
                else renderBasics(crop, content); // NEW
                remove.addEventListener("click", () => { // NEW
                    const index = plan.crops.indexOf(crop); // NEW
                    plan.crops = plan.crops.filter(item => item !== crop); // NEW
                    if (plan.csa && Array.isArray(plan.csa.components)) plan.csa.components = plan.csa.components.filter(component => component.cropId !== crop.id); // NEW
                    state.selectedCropId = YearPlanDashboard.resolveSelectedCropId(plan.crops, "", index); // NEW
                    renderSelectedEditor(); renderCsa(); fillCropFilter(); refreshDerived(); // NEW
                }); // NEW
                syncEditorDerived(); // NEW
            } // NEW

            function renderCsa() { // NEW
                csaBox.innerHTML = ""; // NEW
                plan.csa = plan.csa || { enabled: false, boxesPerWeek: 0, start: "", end: "", components: [] }; // NEW
                const title = document.createElement("div"); // NEW
                title.style.cssText = "font-weight:700;font-size:13px;margin-bottom:8px;"; // NEW
                title.textContent = "CSA (optional)"; // NEW
                const controls = document.createElement("div"); // NEW
                controls.className = "yp-row"; // NEW
                const enabled = document.createElement("input"); enabled.type = "checkbox"; enabled.checked = !!plan.csa.enabled; // NEW
                const enabledLabel = document.createElement("label"); enabledLabel.className = "yp-row"; enabledLabel.appendChild(enabled); enabledLabel.appendChild(document.createTextNode("Enable CSA")); // NEW
                const boxes = mkInput("number", plan.csa.boxesPerWeek ?? 0, 90); // NEW
                const start = mkInput("date", plan.csa.start || "", 145); // NEW
                const end = mkInput("date", plan.csa.end || "", 145); // NEW
                controls.appendChild(enabledLabel); controls.appendChild(document.createTextNode("Boxes/week")); controls.appendChild(boxes); controls.appendChild(document.createTextNode("Start")); controls.appendChild(start); controls.appendChild(document.createTextNode("End")); controls.appendChild(end); // NEW
                const rowsHost = document.createElement("div"); // NEW
                rowsHost.style.cssText = "display:flex;flex-direction:column;gap:7px;margin-top:10px;"; // NEW
                const add = mkBtn("Add component"); // NEW
                add.style.marginTop = "8px"; // NEW
                csaBox.appendChild(title); csaBox.appendChild(controls); csaBox.appendChild(rowsHost); csaBox.appendChild(add); // NEW
                const sync = () => { plan.csa.enabled = enabled.checked; plan.csa.boxesPerWeek = Math.max(0, Math.trunc(Number(boxes.value) || 0)); plan.csa.start = start.value; plan.csa.end = end.value; debounceRefresh(); }; // NEW
                enabled.addEventListener("change", sync); boxes.addEventListener("input", sync); start.addEventListener("change", sync); end.addEventListener("change", sync); // NEW

                function renderRows() { // NEW
                    rowsHost.innerHTML = ""; // NEW
                    plan.csa.components = Array.isArray(plan.csa.components) ? plan.csa.components : []; // NEW
                    for (const component of plan.csa.components) { // NEW
                        const row = document.createElement("div"); // NEW
                        row.className = "yp-row"; // NEW
                        const crop = PlanMath.findCrop(plan, component.cropId); // NEW
                        const cropSelect = mkSelect((plan.crops || []).map(item => ({ value: item.id, label: cropLabel(item) })), component.cropId || "", 220); // NEW
                        const qty = mkInput("number", component.qty ?? 1, 70); // NEW
                        const unit = mkSelect(listUnitOptions(crop), component.unit || defaultUnit(crop), 100); // NEW
                        const every = mkInput("number", component.everyNWeeks ?? 1, 65); // NEW
                        const from = mkInput("date", component.start || plan.csa.start || "", 145); // NEW
                        const to = mkInput("date", component.end || plan.csa.end || "", 145); // NEW
                        const remove = mkBtn("Remove"); // NEW
                        row.appendChild(cropSelect); row.appendChild(qty); row.appendChild(unit); row.appendChild(document.createTextNode("Every")); row.appendChild(every); row.appendChild(document.createTextNode("weeks")); row.appendChild(from); row.appendChild(to); row.appendChild(remove); // NEW
                        rowsHost.appendChild(row); // NEW
                        cropSelect.addEventListener("change", () => { component.cropId = cropSelect.value; component.unit = defaultUnit(PlanMath.findCrop(plan, component.cropId)); renderRows(); refreshDerived(); }); // NEW
                        qty.addEventListener("input", () => { component.qty = Math.max(0, Number(qty.value) || 0); debounceRefresh(); }); // NEW
                        unit.addEventListener("change", () => { component.unit = unit.value; refreshDerived(); }); // NEW
                        every.addEventListener("input", () => { component.everyNWeeks = Math.max(1, Math.trunc(Number(every.value) || 1)); debounceRefresh(); }); // NEW
                        from.addEventListener("change", () => { component.start = from.value; refreshDerived(); }); // NEW
                        to.addEventListener("change", () => { component.end = to.value; refreshDerived(); }); // NEW
                        remove.addEventListener("click", () => { plan.csa.components = plan.csa.components.filter(item => item !== component); renderRows(); refreshDerived(); }); // NEW
                    } // NEW
                } // NEW
                add.addEventListener("click", () => { // NEW
                    const crop = plan.crops && plan.crops[0]; // NEW
                    plan.csa.components.push({ cropId: crop ? crop.id : "", qty: 1, unit: defaultUnit(crop), everyNWeeks: 1, start: plan.csa.start || "", end: plan.csa.end || "" }); // NEW
                    renderRows(); refreshDerived(); // NEW
                }); // NEW
                renderRows(); // NEW
            } // NEW

            function renderAll() { // NEW
                fillCropFilter(); // NEW
                renderSelectedEditor(); // NEW
                renderCsa(); // NEW
                refreshDerived(); // NEW
            } // NEW

            function persistPackageDefaults() { // NEW
                for (const crop of (plan.crops || [])) { // NEW
                    if (crop.savePackagesAsDefault && crop.plantId && Array.isArray(crop.packages)) PlanRepository.saveDefaultsForPlant(crop.plantId, crop.packages); // NEW
                } // NEW
            } // NEW

            function saveCurrent(closeAfter) { // NEW
                refreshDerived(); // NEW
                if (dashboard.validationErrors.length) { // NEW
                    state.validationState = "invalid"; // NEW
                    state.previewExpanded = true; // NEW
                    renderPreview(); renderFooter(); // NEW
                    return false; // NEW
                } // NEW
                persistPackageDefaults(); // NEW
                PlanRepository.savePlanForYear(moduleCell, currentYear, plan); // NEW
                YearPlanDashboard.markBaseline(state, plan, new Date()); // NEW
                state.closePromptOpen = false; // NEW
                state.extraDiagnostics = []; // NEW
                refreshDerived(); // NEW
                if (closeAfter) SessionController.close(); // NEW
                return true; // NEW
            } // NEW

            function requestClose() { // NEW
                refreshDerived(); // NEW
                if (!YearPlanDashboard.isDirty(state, plan)) { SessionController.close(); return; } // NEW
                state.closePromptOpen = true; // NEW
                renderFooter(); // NEW
            } // NEW

            const yearInput = mkInput("number", currentYear, 88); // NEW
            yearInput.min = "1900"; yearInput.max = "3000"; // NEW
            const templateSel = document.createElement("select"); // NEW
            templateSel.style.cssText = "padding:5px 6px;border:1px solid #bbb;border-radius:6px;min-width:190px;"; // NEW
            const applyTemplate = mkBtn("Apply"); // NEW
            const saveTemplate = mkBtn("Save template"); // NEW
            const deleteTemplate = mkBtn("Delete template"); // NEW
            titleEl.textContent = `Plan Year - ${currentYear}`; // NEW
            headerControls.appendChild(document.createTextNode("Year")); headerControls.appendChild(yearInput); headerControls.appendChild(document.createTextNode("Template")); headerControls.appendChild(templateSel); headerControls.appendChild(applyTemplate); headerControls.appendChild(saveTemplate); headerControls.appendChild(deleteTemplate); // NEW
            header.appendChild(titleEl); header.appendChild(headerControls); // NEW
            fillTemplateDropdown(); // NEW

            const plantSelect = document.createElement("select"); // NEW
            plantSelect.style.cssText = "padding:6px;border:1px solid #bbb;border-radius:6px;min-width:260px;flex:1 1 260px;"; // NEW
            const addCrop = mkBtn("Add crop", true); // NEW
            const reloadPlants = mkBtn("Reload plants"); // NEW
            const plantMessage = document.createElement("span"); // NEW
            plantMessage.style.color = "#666"; // NEW
            addRow.appendChild(plantSelect); addRow.appendChild(addCrop); addRow.appendChild(reloadPlants); addRow.appendChild(plantMessage); // NEW

            const save = mkBtn("Save", true); // NEW
            const saveClose = mkBtn("Save & Close"); // NEW
            const exportButton = mkBtn("Export"); // NEW
            const reset = mkBtn(existing ? "Reset" : "Clear"); // NEW
            const close = mkBtn("Close"); // NEW
            footerActions.appendChild(save); footerActions.appendChild(saveClose); footerActions.appendChild(exportButton); footerActions.appendChild(reset); footerActions.appendChild(close); // NEW
            const promptSave = mkBtn("Save and Close", true); // NEW
            const promptDiscard = mkBtn("Discard"); // NEW
            const promptCancel = mkBtn("Cancel"); // NEW
            closePrompt.appendChild(promptSave); closePrompt.appendChild(promptDiscard); closePrompt.appendChild(promptCancel); // NEW

            async function loadPlants(force) { // NEW
                try { // NEW
                    if (force) DbClient.invalidatePlantsBasicCache(); // NEW
                    plantMessage.textContent = "Loading plants..."; // NEW
                    const plants = await DbClient.getPlantsBasicCached(); // NEW
                    if (!SessionController.isActive(session)) return; // NEW
                    plantSelect.innerHTML = ""; // NEW
                    plantSelect.appendChild(new Option("-- Select plant --", "")); // NEW
                    for (const item of plants) plantSelect.appendChild(new Option(String(item.plant_name), String(item.plant_id))); // NEW
                    plantMessage.textContent = ""; // NEW
                } catch (error) { // NEW
                    if (SessionController.isActive(session)) plantMessage.textContent = String(error && error.message || error); // NEW
                } // NEW
            } // NEW

            addCrop.addEventListener("click", async () => { // NEW
                const plantId = String(plantSelect.value || ""); // NEW
                if (!plantId) return; // NEW
                const requestYear = currentYear; // NEW
                const plants = await DbClient.getPlantsBasicCached(); // NEW
                if (!SessionController.isActive(session) || requestYear !== currentYear) return; // NEW
                const item = plants.find(row => String(row.plant_id) === plantId); // NEW
                if (!item) return; // NEW
                if (PlanSchema.findDuplicateCrop(plan, plantId, "", "")) { // NEW
                    state.extraDiagnostics = [`Crop already exists for ${item.plant_name} with the base variety.`]; // NEW
                    state.previewExpanded = true; // NEW
                    refreshDerived(); // NEW
                    return; // NEW
                } // NEW
                state.extraDiagnostics = []; // NEW
                const defaults = PlanRepository.getDefaultsForPlant(plantId); // NEW
                const crop = { // NEW
                    id: Env.uid("crop"), plantId, plant: String(item.plant_name), method: String(item.default_planting_method || "").trim() || "direct_sow",
                    varietyId: null, variety: "", harvestStart: "", harvestEnd: "", useActualHarvest: true, syncharvest: false,
                    shelfLifeDays: 0, baseKgPerPlant: Number(item.yield_per_plant_kg), kgPerPlant: Number(item.yield_per_plant_kg),
                    kgPerPlantMode: "auto", actualPlants: 0, germRate: 1,
                    packages: defaults && defaults.length ? PlanSchema.clonePlain(defaults) : [{ unit: "kg", baseType: "kg", baseQty: 1, price: NaN }],
                    market: []
                }; // NEW
                plan.crops.push(crop); // NEW
                state.selectedCropId = crop.id; state.activeTab = "basics"; // NEW
                emitHarvestWindowsNeeded(crop); // NEW
                renderAll(); // NEW
            }); // NEW
            reloadPlants.addEventListener("click", () => loadPlants(true)); // NEW

            yearInput.addEventListener("change", () => { // NEW
                const nextYear = Number(yearInput.value); // NEW
                if (!Number.isFinite(nextYear) || nextYear < 1900 || nextYear > 3000) { yearInput.value = String(currentYear); return; } // NEW
                if (nextYear === currentYear) return; // NEW
                if (!saveCurrent(false)) { yearInput.value = String(currentYear); return; } // NEW
                replacePlan(PlanRepository.loadPlanForYear(moduleCell, nextYear) || PlanSchema.createEmptyPlan(nextYear), nextYear); // NEW
                renderAll(); // NEW
                YearPlanDashboard.markBaseline(state, plan, null); // NEW
                refreshDerived(); // NEW
            }); // NEW
            applyTemplate.addEventListener("click", () => { // NEW
                const name = String(templateSel.value || ""); // NEW
                const template = name && PlanRepository.loadTemplateByName(name); // NEW
                if (!template) return; // NEW
                replacePlan(PlanRepository.rekeyTemplateToPlan(template, currentYear), currentYear); // NEW
                renderAll(); // NEW
            }); // NEW
            saveTemplate.addEventListener("click", () => { // NEW
                const name = String(prompt("Template name?") || "").trim(); // NEW
                if (!name) return; // NEW
                const template = PlanSchema.serializeForPersistence(plan, { forTemplate: true }); // NEW
                template.templateBaseYear = currentYear; template.year = null; // NEW
                PlanRepository.saveTemplateByName(name, template); fillTemplateDropdown(); templateSel.value = name; // NEW
            }); // NEW
            deleteTemplate.addEventListener("click", () => { // NEW
                const name = String(templateSel.value || ""); // NEW
                if (!name || !confirm(`Delete template "${name}"?`)) return; // NEW
                PlanRepository.deleteTemplateByName(name); fillTemplateDropdown(); // NEW
            }); // NEW
            cropFilterSel.addEventListener("change", () => { plan.cropFilterId = cropFilterSel.value; renderPreview(); renderFooter(); }); // NEW
            previewBar.addEventListener("click", event => { if (event.target === cropFilterSel) return; state.previewExpanded = !state.previewExpanded; renderPreview(); }); // NEW
            previewToggle.addEventListener("click", event => { event.stopPropagation(); state.previewExpanded = !state.previewExpanded; renderPreview(); }); // NEW
            save.addEventListener("click", () => saveCurrent(false)); // NEW
            saveClose.addEventListener("click", () => saveCurrent(true)); // NEW
            promptSave.addEventListener("click", () => saveCurrent(true)); // NEW
            promptDiscard.addEventListener("click", () => SessionController.close()); // NEW
            promptCancel.addEventListener("click", () => { state.closePromptOpen = false; renderFooter(); }); // NEW
            close.addEventListener("click", requestClose); // NEW
            exportButton.addEventListener("click", () => { // NEW
                const safeName = String(DiagramStore.getCellAttr(moduleCell, "label", "garden")).replace(/[^\w\-]+/g, "_").slice(0, 60); // NEW
                downloadJson(`${safeName}_${currentYear}_plan.json`, PlanSchema.serializeForPersistence(plan)); // NEW
            }); // NEW
            reset.addEventListener("click", () => { // NEW
                if (!confirm(`Clear the saved ${currentYear} plan?`)) return; // NEW
                PlanRepository.deletePlanForYear(moduleCell, currentYear); // NEW
                replacePlan(PlanSchema.createEmptyPlan(currentYear), currentYear); // NEW
                renderAll(); // NEW
                YearPlanDashboard.markBaseline(state, plan, null); // NEW
                refreshDerived(); // NEW
            }); // NEW

            function emitHarvestWindowsNeeded(crop) { // NEW
                window.dispatchEvent(new CustomEvent("usl:harvestWindowsNeeded", { detail: { // NEW
                    moduleCellId: moduleCell.getId ? moduleCell.getId() : moduleCell.id,
                    year: currentYear,
                    crops: [{ cropId: crop.id, plantId: crop.plantId, varietyId: crop.varietyId ?? null, method: crop.method ?? null, yieldTargetKg: 0 }]
                } })); // NEW
            } // NEW

            SessionController.addWindowListener(session, "usl:harvestWindowsSuggested", event => { // NEW
                const detail = event && event.detail; // NEW
                if (!detail || String(detail.moduleCellId || "") !== String(moduleCell.getId ? moduleCell.getId() : moduleCell.id) || Number(detail.year) !== currentYear) return; // NEW
                const byId = new Map((plan.crops || []).map(crop => [String(crop.id), crop])); // NEW
                for (const result of (detail.results || [])) { // NEW
                    const crop = byId.get(String(result.cropId)); // NEW
                    if (!crop) continue; // NEW
                    if (!PlanMath.hasYmd(crop.harvestStart) && PlanMath.hasYmd(result.harvestStart)) crop.harvestStart = result.harvestStart; // NEW
                    if (!PlanMath.hasYmd(crop.harvestEnd) && PlanMath.hasYmd(result.harvestEnd)) crop.harvestEnd = result.harvestEnd; // NEW
                    if (!(Number(crop.shelfLifeDays) > 0) && Number(result.shelfLifeDays) > 0) crop.shelfLifeDays = Math.trunc(Number(result.shelfLifeDays)); // NEW
                } // NEW
                renderSelectedEditor(); renderCsa(); refreshDerived(); // NEW
            }); // NEW

            SessionController.addGraphListener(session, graph, "usl:varietyEditorClosed", (sender, event) => { // NEW
                const cropId = String(event.getProperty("cropId") || ""); // NEW
                const crop = (plan.crops || []).find(item => String(item.id) === cropId); // NEW
                if (!crop) return; // NEW
                varietyCache.delete(String(crop.plantId || "")); // NEW
                const action = String(event.getProperty("action") || ""); // NEW
                const varietyId = event.getProperty("varietyId"); // NEW
                if (action !== "cancel" && action !== "error" && varietyId !== null && varietyId !== "") { // NEW
                    if (!PlanSchema.findDuplicateCrop(plan, crop.plantId, varietyId, crop.id)) { // NEW
                        crop.varietyId = Number(varietyId); crop.variety = String(event.getProperty("varietyName") || ""); // NEW
                    } // NEW
                } // NEW
                if (selectedCrop() === crop) renderSelectedEditor(); // NEW
                refreshDerived(); // NEW
            }); // NEW

            loadPlants(false); // NEW
            renderAll(); // NEW
            YearPlanDashboard.markBaseline(state, plan, null); // NEW
            refreshDerived(); // NEW
            return session; // NEW
        } // NEW

        return { open }; // NEW
    })(); // NEW

    if (window.__USL_YEAR_PLANNER_TEST_HOOK__) { // NEW
        window.__uslYearPlannerTestApi = { // NEW
            Env,
            DiagramStore,
            PlanMath,
            PlanSchema,
            PlanRepository,
            DiagramPlanReader,
            PlanRuntimeService,
            YearPlanDashboard, // NEW
            SessionController
        };
    }

    /** Starts the single year-plan modal session. // NEW */
    function openPlanModal(moduleCell, year) { // CHANGE
        return YearPlanModalController.open(moduleCell, year); // NEW
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
