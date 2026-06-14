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

        function validate(plan) { // CHANGE
            const errors = [];
            const crops = (plan && plan.crops) || [];

            for (const crop of crops) {
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
            }

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

    // -------------------- Modal UI (row-based MVP) --------------------

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
        const rows = PlanMath.computePlanCropTotals(plan, weekly);
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
    const YearPlanModalController = { // NEW
        open(moduleCell, year) { // CHANGE
        let currentYear = year;

        const __actualControlsByCropId = new Map();
        const __requiredControlsByCropId = new Map();

        const existing = PlanRepository.loadPlanForYear(moduleCell, year);
        const plan = PlanSchema.normalizeForRuntime(existing || PlanSchema.createEmptyPlan(year), year); // CHANGE

        const session = SessionController.start(moduleCell, year, plan);


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

            if (!SessionController.isActive(session)) return; // CHANGE

            const cropId = String(evt.getProperty("cropId") || "").trim(); // FIX
            const action = String(evt.getProperty("action") || "");
            const varietyIdRaw = evt.getProperty("varietyId");
            const varietyId = (varietyIdRaw == null || varietyIdRaw === "") ? null : Number(varietyIdRaw);
            const varietyName = String(evt.getProperty("varietyName") || "");

            if (!cropId) return;

            const crop = (plan.crops || []).find(c => String(c.id) === cropId);
            if (!crop) return;

            __varietyCacheByPlant.delete(String(crop.plantId || ""));

            if (action !== "cancel" && action !== "error" && varietyId != null && Number.isFinite(varietyId)) { // CHANGE
                const dupe = PlanSchema.findDuplicateCrop(plan, crop.plantId, varietyId, crop.id); // NEW
                if (dupe) { // NEW
                    showWarnings([`That plant/variety already exists in this year plan.`]); // NEW
                } else { // NEW
                    crop.varietyId = varietyId; // CHANGE
                    crop.variety = varietyName || ""; // CHANGE
                } // NEW
            } // CHANGE

            refreshVarietyDropdownForCrop(crop, true).then(() => {
                if (!SessionController.isActive(session)) return; // CHANGE
                if (!(plan.crops || []).some(c => c.id === crop.id)) return; // CHANGE
            refreshAll(); // CHANGE
            }).catch(e => console.warn("[YearPlanner] variety refresh failed", e));
        };

        SessionController.addGraphListener(session, graph, "usl:varietyEditorClosed", onVarietyEditorClosedGraph);

        function closeThisModal() {
            SessionController.close();
        }

        closeBtn.addEventListener("click", (ev) => { ev.preventDefault(); closeThisModal(); });

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

        topRow.style.display = "flex"; // CHANGE
        topRow.style.flexWrap = "wrap"; // CHANGE
        topRow.style.gap = "8px"; // CHANGE
        topRow.style.alignItems = "center"; // CHANGE
        topRow.style.marginBottom = "12px"; // CHANGE

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
        msg.style.flex = "1 1 220px"; // CHANGE
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

        const cropFilterHelp = document.createElement("div"); // NEW
        cropFilterHelp.style.color = "#666"; // NEW
        cropFilterHelp.style.fontSize = "12px"; // NEW
        cropFilterHelp.style.marginBottom = "8px"; // NEW
        cropFilterHelp.textContent = "Select a crop to view a per-crop chart. Leave blank to view total target vs supply."; // NEW
        chartBox.appendChild(cropFilterHelp); // NEW

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
            const obj = Env.safeJsonStringParse(overridesJson, null);
            if (!obj || typeof obj !== "object") return null;

            // Preferred key (your stated convention)
            const v1 = Number(obj.yield_per_plant_kg);
            if (Number.isFinite(v1) && v1 > 0) return v1;

            // Optional: support alternate nesting if you used it elsewhere
            const v2 = Number(obj?.overrides?.yield_per_plant_kg);
            if (Number.isFinite(v2) && v2 > 0) return v2;

            return null;
        }

        function setKgPerPlantAuto(crop, nextKg) { // CHANGE
            if (!crop) return; // CHANGE
            const n = Number(nextKg); // CHANGE
            if (!Number.isFinite(n) || n <= 0) return; // CHANGE

            PlanSchema.normalizeYieldFieldsForRuntime(crop); // CHANGE

            if (crop.kgPerPlantMode === "manual") return; // CHANGE

            crop.kgPerPlant = n; // CHANGE
            crop.__kgpp_lastAuto = n; // NEW
            crop.kgPerPlantMode = "auto"; // CHANGE
        } // CHANGE

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
            const ms = PlanMath.parseYmdLocalToMs(ymd);
            if (!Number.isFinite(ms)) return null;
            return PlanMath.toIsoDateLocal(new Date(PlanMath.addDaysMs(ms, days)));
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
            if (PlanMath.hasYmd(mkt.__baseTo)) return;

            // Derive baseTo from current to when enabling sync.
            // If current to already looks like "harvestEnd + shelf", use harvestEnd.
            const shelf = getShelfDays(crop);
            const he = crop && crop.harvestEnd;
            const availEnd = PlanRuntimeService.cropAvailableEndYmd(crop);

            if (PlanMath.hasYmd(he) && PlanMath.hasYmd(availEnd) && PlanMath.hasYmd(mkt.to) && String(mkt.to) === String(availEnd)) {
                mkt.__baseTo = String(he);
            } else if (PlanMath.hasYmd(mkt.to)) {
                mkt.__baseTo = String(mkt.to);
            } else if (PlanMath.hasYmd(he)) {
                mkt.__baseTo = String(he);
            } else {
                mkt.__baseTo = "";
            }
        }

        function applyShelfToMarketTo(crop, mkt) {
            if (!mkt) return;
            ensureMarketBaseTo(crop, mkt);
            const shelf = getShelfDays(crop);
            if (PlanMath.hasYmd(mkt.__baseTo)) {
                mkt.to = addDaysYmd(mkt.__baseTo, shelf) || mkt.to;
            }
        }

        function removeShelfFromMarketTo(crop, mkt) {
            if (!mkt) return;
            ensureMarketBaseTo(crop, mkt);
            if (PlanMath.hasYmd(mkt.__baseTo)) mkt.to = String(mkt.__baseTo);
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



        // -------------------- Variety dropdown helpers --------------------
        const __varietyCacheByPlant = new Map();
        const __varietyControlsByCropId = new Map();

        async function getVarietyOptionsForPlantCached(plantId, force = false) {
            const key = String(plantId || "").trim();
            if (!key) return { opts: [{ value: "", label: "(base plant)" }], byId: new Map() };

            if (!force && __varietyCacheByPlant.has(key)) return __varietyCacheByPlant.get(key);

            const rows = await DbClient.queryVarietiesByPlantId(key);
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
            if (!SessionController.isActive(session)) return; // CHANGE
            if (!crop || !(plan.crops || []).some(c => c.id === crop.id)) return; // CHANGE

            const ctl = __varietyControlsByCropId.get(crop.id);
            if (!ctl || !ctl.sel) return;

            const sel = ctl.sel;
            sel.disabled = true;

            try {
                const pack = await getVarietyOptionsForPlantCached(crop.plantId, force);

                if (!SessionController.isActive(session)) return; // CHANGE
                if (!(plan.crops || []).some(c => c.id === crop.id)) return; // CHANGE

                const liveCtl = __varietyControlsByCropId.get(crop.id); // CHANGE
                if (!liveCtl || liveCtl.sel !== sel) return; // CHANGE

                const desired = crop.varietyId ? String(crop.varietyId) : "";
                fillSelectOptions(sel, pack.opts, desired);

                // Keep crop.variety (name) coherent with selection.
                const rec = pack.byId.get(String(sel.value || "")) || null;
                const name = rec ? String(rec.name || "") : "";
                crop.varietyId = sel.value ? Number(sel.value) : null;
                crop.variety = sel.value ? String(name) : "";

                if (sel.value) {
                    if (rec && rec.yieldKg) setKgPerPlantAuto(crop, rec.yieldKg);
                } else {
                    if (Number.isFinite(Number(crop.baseKgPerPlant)) && Number(crop.baseKgPerPlant) > 0) {
                        setKgPerPlantAuto(crop, crop.baseKgPerPlant);
                    }
                }

            } finally {
                const liveCtl = crop ? __varietyControlsByCropId.get(crop.id) : null; // CHANGE
                if (SessionController.isActive(session) && liveCtl && liveCtl.sel === sel) { // CHANGE
                    sel.disabled = false; // CHANGE
                } // CHANGE
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
            for (const name of PlanRepository.listTemplateNames()) {
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


        function syncHarvestDateInputs() { // NEW
            const vizMap = session.ui.harvestVizByCropId; // NEW
            if (!vizMap) return; // NEW

            for (const c of (plan.crops || [])) { // NEW
                const ctl = vizMap.get(c.id); // NEW
                if (!ctl) continue; // NEW

                if (ctl.hs) { // NEW
                    ctl.hs.value = PlanMath.hasYmd(c.harvestStart) ? String(c.harvestStart) : ""; // NEW
                    ctl.hs.disabled = c.useActualHarvest !== false; // NEW
                } // NEW

                if (ctl.he) { // NEW
                    ctl.he.value = PlanMath.hasYmd(c.harvestEnd) ? String(c.harvestEnd) : ""; // NEW
                    ctl.he.disabled = c.useActualHarvest !== false; // NEW
                } // NEW
            } // NEW
        } // NEW

        const PreviewView = { // NEW
            /**
             * Renders a completed runtime model and performs no plan calculations. // NEW
             */
            render(runtime) { // CHANGE
                syncactualPlantsInputs();
                syncHarvestDateInputs();
                syncRequiredPlantsInputs(runtime.cropTotals);

                const vizMap = session.ui.harvestVizByCropId;
                for (const crop of (runtime.plan.crops || [])) {
                    const controls = vizMap && vizMap.get(crop.id);
                    const derived = runtime.derivedByCropId.get(String(crop.id));
                    if (controls && controls.host && derived) {
                        renderHarvestDots(controls.host, runtime.weekStarts, derived.actualHarvestWeeklyKg || []);
                    }
                }

                const cropId = String(runtime.plan.cropFilterId || "");
                cropFilterHelp.style.display = cropId ? "none" : "block";
                if (cropId) {
                    const series = runtime.weekly.perCrop.get(cropId);
                    drawPlanChart(canvas, runtime.weekly, series ? series.target : [], series ? series.supply : []);
                } else {
                    drawPlanChart(canvas, runtime.weekly);
                }

                renderPlanTotals(tableBox.querySelector("#planTotals"), runtime.plan, runtime.weekly);
                this.renderWarnings(runtime.warnings);
            },

            renderWarnings(list) { // CHANGE
                const messages = Array.isArray(list) ? list.filter(Boolean) : [];
                if (messages.length === 0) {
                    warnBox.style.display = "none";
                    warnBox.innerHTML = "";
                    return;
                }
                warnBox.style.display = "block";
                warnBox.innerHTML = `<div style="font-weight:700;margin-bottom:6px;">Warnings</div>` +
                    `<ul style="margin:0 0 0 18px;padding:0;">${messages.map(
                        message => `<li>${mxUtils.htmlEntities(message)}</li>`
                    ).join("")}</ul>`;
            }
        };

        function showWarnings(list) { // CHANGE
            PreviewView.renderWarnings(list);
        }

        const CropListView = { // NEW
            render() { // CHANGE
            cropsList.innerHTML = "";

            __actualControlsByCropId.clear(); // CHANGE
            __requiredControlsByCropId.clear(); // CHANGE
            __varietyControlsByCropId.clear(); // CHANGE
            session.ui.harvestVizByCropId.clear(); // CHANGE

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
                    refreshPreview();
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

                saveDefCb.addEventListener("change", () => {
                    crop.savePackagesAsDefault = !!saveDefCb.checked;
                });

                const packsWrap = document.createElement("div");
                packsWrap.style.display = "flex";
                packsWrap.style.flexDirection = "column";
                packsWrap.style.gap = "6px";

                const addPackBtn = mkBtn("Add package");
                addPackBtn.style.marginTop = "6px";

                function syncKgppInput() { // FIX
                    kgpp.value = Number.isFinite(Number(crop.kgPerPlant)) ? String(crop.kgPerPlant) : ""; // FIX
                } // FIX

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
                            refreshAll({ cropList: false }); // CHANGE
                        });
                        baseType.addEventListener("change", () => {
                            p.baseType = String(baseType.value || "kg");
                            renderMarket();
                            refreshAll({ cropList: false }); // CHANGE
                        });

                        baseQty.min = "1";
                        price.min = "0";

                        baseQty.addEventListener("input", () => {
                            p.baseQty = clampNonNegNum(baseQty.value, 1);
                            baseQty.value = String(p.baseQty);
                            renderMarket();
                            refreshAll({ cropList: false }); // CHANGE
                        });

                        price.addEventListener("input", () => {
                            p.price = clampNonNegNum(price.value, NaN);
                            price.value = Number.isFinite(Number(p.price)) ? String(p.price) : "";
                        });


                        del.addEventListener("click", (ev) => {
                            ev.preventDefault();
                            crop.packages = crop.packages.filter(x => x !== p);
                            renderPacks();
                            refreshAll({ cropList: false }); // CHANGE
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
                    } else {
                        for (const mkt of crop.market) removeShelfFromMarketTo(crop, mkt);
                        renderMarket();
                    }

                    refreshAll({ cropList: false }); // CHANGE
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
                    refreshPreview();
                });


                addPackBtn.addEventListener("click", (ev) => {
                    ev.preventDefault();
                    crop.packages = crop.packages || [];
                    crop.packages.push({ unit: "kg", baseType: "kg", baseQty: 1, price: NaN });
                    renderPacks();
                    refreshAll({ cropList: false }); // CHANGE
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
                            refreshPreview();
                        });

                        unit.addEventListener("change", () => { mkt.unit = String(unit.value || ""); refreshPreview(); });
                        from.addEventListener("change", () => { mkt.from = String(from.value || ""); refreshPreview(); });

                        to.addEventListener("change", () => {
                            const newTo = String(to.value || "");
                            mkt.to = newTo;

                            if (crop.syncharvest) {
                                // User edited the shelf-adjusted date -> update baseTo.
                                const shelf = getShelfDays(crop);
                                mkt.__baseTo = subDaysYmd(newTo, shelf) || "";
                            } else {
                                // Unsynced edit directly sets baseTo.
                                mkt.__baseTo = PlanMath.hasYmd(newTo) ? newTo : "";
                            }

                            refreshPreview();
                        });

                        del.addEventListener("click", (ev) => {
                            ev.preventDefault();
                            crop.market = crop.market.filter(x => x !== mkt);
                            renderMarket();
                            refreshPreview();
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
                    refreshAll({ cropList: false }); // CHANGE
                });

                // events for crop fields ------------------------------------------------
                __varietyControlsByCropId.set(crop.id, { sel: varietySel, plusBtn: varietyAddBtn });

                // initial populate (async)
                refreshVarietyDropdownForCrop(crop, false).then(() => {
                    if (!SessionController.isActive(session)) return; // CHANGE
                    if (!(plan.crops || []).some(c => c.id === crop.id)) return; // CHANGE

                    syncKgppInput(); // FIX

                    title.textContent = labelCrop(crop);
                    refreshAll({ cropList: false, csa: false }); // CHANGE
                }).catch(e => console.warn("[USL][YearPlanner] variety init failed", e));

                varietySel.addEventListener("change", () => {

                    const prevVarietyId = crop.varietyId == null ? "" : String(crop.varietyId); // NEW
                    const nextVarietyId = String(varietySel.value || ""); // NEW

                    const dupe = PlanSchema.findDuplicateCrop(plan, crop.plantId, nextVarietyId, crop.id); // NEW
                    if (dupe) { // NEW
                        varietySel.value = prevVarietyId; // NEW
                        showWarnings([`That plant/variety already exists in this year plan.`]); // NEW
                        return; // NEW
                    } // NEW

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
                        if (Number.isFinite(Number(crop.baseKgPerPlant)) && Number(crop.baseKgPerPlant) > 0) { // CHANGE
                            setKgPerPlantAuto(crop, crop.baseKgPerPlant); // CHANGE
                        } // CHANGE
                    }

                    syncKgppInput(); // FIX

                    title.textContent = labelCrop(crop);
                    refreshAll({ cropList: false, csa: false }); // CHANGE

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
                shelf.min = "0";
                actual.min = "0";

                kgpp.addEventListener("input", () => {
                    crop.kgPerPlant = clampNonNegNum(kgpp.value, NaN);
                    crop.kgPerPlantMode = "manual"; // CHANGE
                    kgpp.value = Number.isFinite(Number(crop.kgPerPlant)) ? String(crop.kgPerPlant) : "";
                    refreshAll({ cropList: false }); // CHANGE
                });

                hs.addEventListener("change", () => {
                    const snap = {
                        hs: crop.harvestStart, he: crop.harvestEnd, availEnd: PlanRuntimeService.cropAvailableEndYmd(crop)
                    };
                    crop.harvestStart = String(hs.value || "");
                    PlanRuntimeService.syncCropDatesIfEnabled(plan, crop, snap);
                    renderMarket();
                    refreshAll({ cropList: false }); // CHANGE
                });

                he.addEventListener("change", () => {
                    const snap = {
                        hs: crop.harvestStart, he: crop.harvestEnd, availEnd: PlanRuntimeService.cropAvailableEndYmd(crop)
                    };
                    crop.harvestEnd = String(he.value || "");
                    PlanRuntimeService.syncCropDatesIfEnabled(plan, crop, snap);
                    renderMarket();
                    refreshAll({ cropList: false }); // CHANGE
                });

                shelf.addEventListener("input", () => {
                    const snap = { hs: crop.harvestStart, he: crop.harvestEnd, availEnd: PlanRuntimeService.cropAvailableEndYmd(crop) };
                    crop.shelfLifeDays = clampNonNegInt(shelf.value, 0);
                    shelf.value = String(crop.shelfLifeDays);

                    if (crop.syncharvest) {
                        for (const mkt of (crop.market || [])) applyShelfToMarketTo(crop, mkt);
                        renderMarket();
                    }

                    PlanRuntimeService.syncCropDatesIfEnabled(plan, crop, snap);
                    renderMarket();
                    refreshAll({ cropList: false }); // CHANGE
                });

                delCrop.addEventListener("click", (ev) => {
                    ev.preventDefault();
                    plan.crops = (plan.crops || []).filter(x => x !== crop);
                    if (plan.csa && Array.isArray(plan.csa.components)) {
                        plan.csa.components = plan.csa.components.filter(c => c.cropId !== crop.id);
                    }
            refreshAll(); // CHANGE
                });

                panel.appendChild(header);
                panel.appendChild(row);
                panel.appendChild(harvestViz);
                panel.appendChild(packsTitle);
                panel.appendChild(saveDefRow); // CHANGE
                panel.appendChild(packsWrap);
                panel.appendChild(addPackBtn);
                panel.appendChild(marketTitle);
                panel.appendChild(marketWrap);
                panel.appendChild(addMarketBtn);

                cropsList.appendChild(panel);
                renderPacks();
                renderMarket();
            }
        }
        };


        const csaBox = document.createElement("div");
        csaBox.style.border = "1px solid #ddd";
        csaBox.style.borderRadius = "8px";
        csaBox.style.padding = "10px";
        csaBox.style.marginBottom = "12px";
        body.insertBefore(csaBox, preview);

        const CsaView = { // NEW
            render() { // CHANGE
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
                refreshPreview();
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
                    const selectedCrop = PlanMath.findCrop(plan, comp.cropId);
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
                        const c2 = PlanMath.findCrop(plan, comp.cropId);
                        comp.unit = pickDefaultUnitForCrop(c2);
                        renderComponents();
                        refreshPreview();
                    });
                    qty.addEventListener("input", () => {
                        comp.qty = clampNonNegNum(qty.value, 0);
                        qty.value = String(comp.qty);
                        refreshPreview();
                    });
                    unit.addEventListener("change", () => { comp.unit = String(unit.value || ""); refreshPreview(); });

                    everyN.min = "1"

                    everyN.addEventListener("input", () => {
                        comp.everyNWeeks = Math.max(1, clampNonNegInt(everyN.value, 1));
                        everyN.value = String(comp.everyNWeeks);
                        refreshPreview();
                    });

                    st.addEventListener("change", () => { comp.start = String(st.value || ""); refreshPreview(); });
                    en.addEventListener("change", () => { comp.end = String(en.value || ""); refreshPreview(); });

                    del.addEventListener("click", (ev) => {
                        ev.preventDefault();
                        plan.csa.components = plan.csa.components.filter(x => x !== comp);
                        renderComponents();
                        refreshPreview();
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
                refreshPreview();
            });

            renderComponents();
        }
        };


        const Views = { CropListView, CsaView, PreviewView }; // NEW

        /**
         * Recalculates the live plan once and renders every derived preview value. // NEW
         */
        function refreshPreview() { // NEW
            const runtime = PlanRuntimeService.recalculate(moduleCell, currentYear, plan); // NEW
            Views.PreviewView.render(runtime); // NEW
            return runtime; // NEW
        }

        /**
         * Rebuilds structure-dependent views before recalculating the preview. // NEW
         */
        function refreshAll(options) { // NEW
            const settings = options || {}; // NEW
            refreshCropFilterDropdown(); // NEW
            if (settings.cropList !== false) Views.CropListView.render(); // NEW
            if (settings.csa !== false) Views.CsaView.render(); // NEW
            return refreshPreview(); // NEW
        }

        async function initPlantsDropdown() {
            try {
                const plants = await DbClient.getPlantsBasicCached();
                if (!SessionController.isActive(session)) return; // CHANGE

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
                if (!SessionController.isActive(session)) return; // CHANGE
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

            const requestYear = currentYear; // CHANGE
            const plants = await DbClient.getPlantsBasicCached();

            if (!SessionController.isActive(session)) return; // CHANGE
            if (requestYear !== currentYear) return; // CHANGE

            const p = plants.find(x => String(x.plant_id) === plantId);
            if (!p) return;

            const dupe = PlanSchema.findDuplicateCrop(plan, p.plant_id, ""); // NEW
            if (dupe) { // NEW
                showWarnings([`Crop already exists for ${p.plant_name} with the base variety.`]); // NEW
                return; // NEW
            } // NEW

            const defaults = PlanRepository.getDefaultsForPlant(p.plant_id);
            const initialPackages = (defaults && defaults.length)
                ? JSON.parse(JSON.stringify(defaults))
                : [{ unit: "kg", baseType: "kg", baseQty: 1, price: NaN }];

            const crop = {
                id: Env.uid("crop"),
                plantId: String(p.plant_id),
                plant: String(p.plant_name),
                method: String(p.default_planting_method || "").trim() || "direct_sow",
                variety: "",
                harvestStart: "",
                harvestEnd: "",
                shelfLifeDays: 0,
                baseKgPerPlant: clampNum(p.yield_per_plant_kg, NaN), // CHANGE
                kgPerPlant: clampNum(p.yield_per_plant_kg, NaN),
                kgPerPlantMode: "auto", // NEW
                actualPlants: 0,
                germRate: 1.0,
                packages: initialPackages,
                market: []
            };

            plan.crops = plan.crops || [];
            plan.crops.push(crop);

            // after plan.crops.push(crop);
            emitHarvestWindowsNeeded(moduleCell, currentYear, [{
                cropId: crop.id,
                plantId: crop.plantId,
                varietyId: crop.varietyId ?? null,
                method: crop.method ?? null,
                yieldTargetKg: 0
            }]);

            refreshAll(); // CHANGE
        });


        yearInput.addEventListener("change", () => {
            const newYear = Number(yearInput.value);
            if (!Number.isFinite(newYear) || newYear < 1900 || newYear > 3000) return;

            PlanRepository.savePlanForYear(moduleCell, currentYear, plan);

            currentYear = newYear;
            const loaded = PlanRepository.loadPlanForYear(moduleCell, currentYear);

            const nextPlan = loaded || PlanSchema.createEmptyPlan(currentYear); // CHANGE

            const normalizedNextPlan = PlanSchema.normalizeForRuntime(nextPlan, currentYear); // CHANGE

            Object.keys(plan).forEach(k => delete plan[k]);
            Object.assign(plan, normalizedNextPlan); // CHANGE
            plan.year = currentYear;

            titleEl.textContent = `Plan Year — ${currentYear}`;
            refreshAll(); // CHANGE
        });

        cropFilterSel.addEventListener("change", () => {
            plan.cropFilterId = String(cropFilterSel.value || "");
            refreshPreview();
        });


        applyTemplateBtn.addEventListener("click", () => {
            const name = String(templateSel.value || "").trim();
            if (!name) return;
            const t = PlanRepository.loadTemplateByName(name);
            if (!t) return;

            const applied = PlanSchema.normalizeForRuntime(PlanRepository.rekeyTemplateToPlan(t, currentYear), currentYear); // CHANGE

            Object.keys(plan).forEach(k => delete plan[k]);
            Object.assign(plan, applied);
            plan.year = currentYear;
            refreshAll(); // CHANGE
        });

        saveTemplateBtn.addEventListener("click", () => {
            const name = prompt("Template name?");
            const key = String(name || "").trim();
            if (!key) return;

            const t = PlanSchema.serializeForPersistence(plan, { forTemplate: true }); // CHANGE
            t.templateBaseYear = Number(currentYear); // NEW
            t.year = null; // CHANGE

            PlanRepository.saveTemplateByName(key, t);
            refreshTemplateDropdown();
            templateSel.value = key;
        });

        deleteTemplateBtn.addEventListener("click", () => {
            const name = String(templateSel.value || "").trim();
            if (!name) return;
            PlanRepository.deleteTemplateByName(name);
            refreshTemplateDropdown();
        });


        saveBtn.addEventListener("click", (ev) => {
            ev.preventDefault();

            const dup = PlanSchema.findFirstDuplicateCrop(plan); // NEW
            if (dup) { // NEW
                showWarnings([`Duplicate crop rows found. Each plant/variety may appear only once per year plan.`]); // NEW
                return; // NEW
            } // NEW

            refreshPreview(); // CHANGE
            const errs = PlanSchema.validate(plan);
            if (errs.length) { showWarnings(errs); return; }

            // persist unit defaults
            for (const c of (plan.crops || [])) {
                if (c && c.savePackagesAsDefault && c.plantId && Array.isArray(c.packages)) {
                    PlanRepository.saveDefaultsForPlant(c.plantId, c.packages);
                }
            }

            PlanRepository.savePlanForYear(moduleCell, currentYear, plan); // CHANGE
        });


        exportBtn.addEventListener("click", (ev) => {
            ev.preventDefault();
            const safeName = String(DiagramStore.getCellAttr(moduleCell, "label", "garden"))
                .replace(/[^\w\-]+/g, "_").slice(0, 60);
            downloadJson(`${safeName}_${currentYear}_plan.json`, plan);
        });

        resetBtn.addEventListener("click", (ev) => {
            ev.preventDefault();
            PlanRepository.deletePlanForYear(moduleCell, currentYear);
            Object.keys(plan).forEach(key => delete plan[key]); // CHANGE
            Object.assign(plan, PlanSchema.createEmptyPlan(currentYear)); // CHANGE
            refreshAll(); // CHANGE
        });

        const USL_DEBUG_HARVEST_WINDOWS = Env.DEBUG; // CHANGE


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

                if (!PlanMath.hasYmd(crop.harvestStart) && PlanMath.hasYmd(r.harvestStart)) crop.harvestStart = r.harvestStart;
                if (!PlanMath.hasYmd(crop.harvestEnd) && PlanMath.hasYmd(r.harvestEnd)) crop.harvestEnd = r.harvestEnd;

                // Only fill shelf life if currently empty/0 and scheduler gave one
                if ((!Number.isFinite(Number(crop.shelfLifeDays)) || Number(crop.shelfLifeDays) <= 0) &&
                    Number.isFinite(Number(r.shelfLifeDays)) && Number(r.shelfLifeDays) > 0) {
                    crop.shelfLifeDays = Math.trunc(Number(r.shelfLifeDays));
                }
            }

        }


        function onHarvestWindowsSuggested(ev) {
            if (!SessionController.isActive(session)) return;
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
            refreshAll(); // CHANGE
        }

        SessionController.addWindowListener(session, "usl:harvestWindowsSuggested", onHarvestWindowsSuggested);

        initPlantsDropdown();
            refreshAll(); // CHANGE

    }
    };

















    if (window.__USL_YEAR_PLANNER_TEST_HOOK__) { // NEW
        window.__uslYearPlannerTestApi = { // NEW
            Env,
            DiagramStore,
            PlanMath,
            PlanSchema,
            PlanRepository,
            DiagramPlanReader,
            PlanRuntimeService,
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
