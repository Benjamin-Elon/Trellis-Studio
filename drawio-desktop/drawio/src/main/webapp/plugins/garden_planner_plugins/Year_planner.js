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
    const PLAN_METADATA_CELL_ATTR = "usl_year_planner_metadata"; // NEW
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
                PLAN_UNIT_DEFAULTS_ATTR,
                PLAN_METADATA_CELL_ATTR // NEW
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
          SELECT plant_id, plant_name, yield_per_plant_kg, harvest_window_days, default_planting_method,
                 annual, biennial, perennial /* CHANGE */
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
            const sql = `
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
            if (t0 > t1) return false; // CHANGE

            const winStart = t0; // CHANGE
            const winEndEx = addDaysMs(t1, 1); // CHANGE

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

        /**
         * Simulates weekly FIFO inventory for one crop without changing its harvest series. // NEW
         * Shelf life is approximated in whole weekly buckets; harvest remains usable in its harvest week. // NEW
         */ // NEW
        function buildUsableSupplySeries(harvestSeries, targetSeries, shelfLifeDays, weekStarts) { // NEW
            const harvest = Array.isArray(harvestSeries) ? harvestSeries : []; // NEW
            const target = Array.isArray(targetSeries) ? targetSeries : []; // NEW
            const weeks = Array.isArray(weekStarts) ? weekStarts : []; // NEW
            const length = Math.max(harvest.length, target.length, weeks.length); // NEW
            const lifetimeWeeks = Math.max(1, Math.ceil(Math.max(0, Number(shelfLifeDays) || 0) / 7)); // NEW
            const availableSupply = Array(length).fill(0); // NEW
            const usableSupply = Array(length).fill(0); // NEW
            const short = Array(length).fill(0); // NEW
            const surplus = Array(length).fill(0); // NEW
            const expired = Array(length).fill(0); // NEW
            const endingInventory = Array(length).fill(0); // NEW
            const inventory = []; // NEW

            for (let weekIndex = 0; weekIndex < length; weekIndex++) { // NEW
                const harvestedKg = Math.max(0, Number(harvest[weekIndex]) || 0); // NEW
                if (harvestedKg > 0) { // NEW
                    inventory.push({ kg: harvestedKg, expiresWeek: weekIndex + lifetimeWeeks }); // NEW
                } // NEW

                while (inventory.length && inventory[0].expiresWeek <= weekIndex) { // NEW
                    expired[weekIndex] += inventory.shift().kg; // NEW
                } // NEW

                availableSupply[weekIndex] = inventory.reduce((sum, batch) => sum + batch.kg, 0); // NEW
                let demandRemaining = Math.max(0, Number(target[weekIndex]) || 0); // NEW

                while (demandRemaining > 0 && inventory.length) { // NEW
                    const batch = inventory[0]; // NEW
                    const usedKg = Math.min(demandRemaining, batch.kg); // NEW
                    batch.kg -= usedKg; // NEW
                    demandRemaining -= usedKg; // NEW
                    usableSupply[weekIndex] += usedKg; // NEW
                    if (batch.kg <= 1e-9) inventory.shift(); // NEW
                } // NEW

                short[weekIndex] = demandRemaining; // NEW
                endingInventory[weekIndex] = inventory.reduce((sum, batch) => sum + batch.kg, 0); // NEW
                surplus[weekIndex] = endingInventory[weekIndex]; // NEW
            } // NEW

            return { availableSupply, usableSupply, short, surplus, expired, endingInventory }; // NEW
        } // NEW

        function buildPlanChartModel(weekly, cropId) { // NEW
            const source = cropId && weekly && weekly.perCrop // NEW
                ? (weekly.perCrop.get(cropId) || weekly.perCrop.get(String(cropId))) // CHANGE
                : null; // NEW
            const weeks = weekly && Array.isArray(weekly.weeks) ? weekly.weeks : []; // NEW
            const target = source ? source.target : (weekly && weekly.targetTotal) || []; // NEW
            const harvest = source ? source.supply : (weekly && weekly.supplyTotal) || []; // NEW
            const available = source ? source.availableSupply : (weekly && weekly.availableSupplyTotal) || []; // NEW
            const usable = source ? source.usableSupply : (weekly && weekly.usableSupplyTotal) || []; // NEW
            const short = source ? source.short : (weekly && weekly.shortTotal) || []; // NEW
            const surplus = source ? source.surplus : (weekly && weekly.surplusTotal) || []; // NEW
            const expired = source ? source.expired : (weekly && weekly.expiredTotal) || []; // NEW
            const endingInventory = source ? source.endingInventory : (weekly && weekly.endingInventoryTotal) || []; // NEW

            return weeks.map((week, index) => ({ // NEW
                week: week && week.iso ? String(week.iso) : "", // NEW
                targetKg: Math.max(0, Number(target[index]) || 0), // NEW
                harvestKg: Math.max(0, Number(harvest[index]) || 0), // NEW
                availableSupplyKg: Math.max(0, Number(available[index]) || 0), // NEW
                usableSupplyKg: Math.max(0, Number(usable[index]) || 0), // NEW
                shortKg: Math.max(0, Number(short[index]) || 0), // NEW
                surplusKg: Math.max(0, Number(surplus[index]) || 0), // NEW
                expiredKg: Math.max(0, Number(expired[index]) || 0), // NEW
                endingInventoryKg: Math.max(0, Number(endingInventory[index]) || 0) // NEW
            })); // NEW
        } // NEW

        function summarizePlanChartModel(chartModel) { // NEW
            const rows = Array.isArray(chartModel) ? chartModel : []; // NEW
            const summary = { // NEW
                targetKg: 0, // NEW
                harvestKg: 0, // NEW
                usableSupplyKg: 0, // NEW
                shortKg: 0, // NEW
                expiredKg: 0, // NEW
                worstShortageKg: 0, // NEW
                worstShortageWeek: "", // NEW
                shortWeeks: 0 // NEW
            }; // NEW

            for (const row of rows) { // NEW
                summary.targetKg += Math.max(0, Number(row && row.targetKg) || 0); // NEW
                summary.harvestKg += Math.max(0, Number(row && row.harvestKg) || 0); // NEW
                summary.usableSupplyKg += Math.max(0, Number(row && row.usableSupplyKg) || 0); // NEW
                summary.shortKg += Math.max(0, Number(row && row.shortKg) || 0); // NEW
                summary.expiredKg += Math.max(0, Number(row && row.expiredKg) || 0); // NEW
                if (Number(row && row.shortKg) > 1e-9) summary.shortWeeks += 1; // NEW
                if (Number(row && row.shortKg) > summary.worstShortageKg) { // NEW
                    summary.worstShortageKg = Number(row.shortKg); // NEW
                    summary.worstShortageWeek = String(row.week || ""); // NEW
                } // NEW
            } // NEW
            return summary; // NEW
        } // NEW

        function computePlanWeekly(plan, warns) {

            warns = Array.isArray(warns) ? warns : [];

            PlanSchema.normalizeForRuntime(plan, plan && plan.year); // CHANGE
            const year = Number(plan && plan.year);
            const weekStartDow = plan.weekStartDow; // CHANGE
            const weeks = buildWeekStartsForYearLocal(year, weekStartDow);
            const n = weeks.length;

            const targetTotal = Array(n).fill(0);
            const supplyTotal = Array(n).fill(0);
            const availableSupplyTotal = Array(n).fill(0); // NEW
            const usableSupplyTotal = Array(n).fill(0); // NEW
            const shortTotal = Array(n).fill(0); // NEW
            const surplusTotal = Array(n).fill(0); // NEW
            const expiredTotal = Array(n).fill(0); // NEW
            const endingInventoryTotal = Array(n).fill(0); // NEW
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
                    if (line.from > line.to) { // NEW
                        pushWarn(warns, `Market line skipped (start date after end date) for ${crop.plant || crop.id}`); // NEW
                        continue; // NEW
                    } // NEW

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
                        if (from > to) { // NEW
                            pushWarn(warns, `CSA component skipped (start date after end date) for ${crop.plant || crop.id}`); // NEW
                            continue; // NEW
                        } // NEW

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
                if (crop.harvestStart > crop.harvestEnd) { // NEW
                    pushWarn(warns, `Supply skipped (harvest start date after end date) for ${crop.plant || crop.id}`); // NEW
                    continue; // NEW
                } // NEW

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

            for (const crop of crops) { // NEW
                if (!crop || !crop.id) continue; // NEW
                const arr = ensureCropArrays(crop.id); // NEW
                Object.assign(arr, buildUsableSupplySeries( // NEW
                    arr.supply, // NEW
                    arr.target, // NEW
                    crop.shelfLifeDays, // NEW
                    weeks // NEW
                )); // NEW
            } // NEW

            // Aggregate all per-crop series into total series before returning. // CHANGE
            for (const v of perCrop.values()) { // CHANGE
                for (let i = 0; i < n; i++) { // CHANGE
                    targetTotal[i] += Math.max(0, Number(v.target[i]) || 0); // CHANGE
                    supplyTotal[i] += Math.max(0, Number(v.supply[i]) || 0); // CHANGE
                    availableSupplyTotal[i] += Math.max(0, Number(v.availableSupply[i]) || 0); // NEW
                    usableSupplyTotal[i] += Math.max(0, Number(v.usableSupply[i]) || 0); // NEW
                    shortTotal[i] += Math.max(0, Number(v.short[i]) || 0); // NEW
                    surplusTotal[i] += Math.max(0, Number(v.surplus[i]) || 0); // NEW
                    expiredTotal[i] += Math.max(0, Number(v.expired[i]) || 0); // NEW
                    endingInventoryTotal[i] += Math.max(0, Number(v.endingInventory[i]) || 0); // NEW
                } // CHANGE
            } // CHANGE

            return { // CHANGE
                weeks, // CHANGE
                targetTotal, // CHANGE
                supplyTotal, // CHANGE
                availableSupplyTotal, // NEW
                usableSupplyTotal, // NEW
                shortTotal, // NEW
                surplusTotal, // NEW
                expiredTotal, // NEW
                endingInventoryTotal, // NEW
                perCrop // CHANGE
            }; // CHANGE
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
            buildUsableSupplySeries, // NEW
            buildPlanChartModel, // NEW
            summarizePlanChartModel, // NEW
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
            const weekStartDow = Math.trunc(Number(normalized.weekStartDow)); // CHANGE
            normalized.weekStartDow = Number.isFinite(weekStartDow) && weekStartDow >= 0 && weekStartDow <= 6 // CHANGE
                ? weekStartDow // CHANGE
                : 1; // CHANGE
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
            if (PlanMath.hasYmd(crop.harvestStart) && PlanMath.hasYmd(crop.harvestEnd) && crop.harvestStart > crop.harvestEnd) { // NEW
                errors.push(`Crop "${crop.plant || crop.id}" harvest start date is after harvest end date.`); // NEW
            } // NEW

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
                if (PlanMath.hasYmd(marketLine.from) && PlanMath.hasYmd(marketLine.to) && marketLine.from > marketLine.to) { // NEW
                    errors.push(`Crop "${crop.plant || crop.id}" market line has start date after end date.`); // NEW
                } // NEW
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

        function validateCsa(plan) { // NEW
            const errors = []; // NEW
            if (plan && plan.csa && plan.csa.enabled) { // CHANGE
                if (!Number.isFinite(Number(plan.csa.boxesPerWeek)) || Number(plan.csa.boxesPerWeek) <= 0) { // CHANGE
                    errors.push("CSA enabled but boxes/week is not set.");
                }
                if (PlanMath.hasYmd(plan.csa.start) && PlanMath.hasYmd(plan.csa.end) && plan.csa.start > plan.csa.end) { // NEW
                    errors.push("CSA start date is after CSA end date."); // NEW
                } // NEW
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
                    if (PlanMath.hasYmd(from) && PlanMath.hasYmd(to) && from > to) { // NEW
                        errors.push(`CSA component for "${crop.plant || crop.id}" has start date after end date.`); // NEW
                    } // NEW
                    if (!Number.isFinite(PlanMath.resolveUnitToKgPerUnit(crop, component.unit))) {
                        errors.push(`CSA component for "${crop.plant || crop.id}" unit "${component.unit}" does not resolve to kg.`);
                    }
                }
            }
            return errors; // NEW
        } // NEW

        function validate(plan) { // CHANGE
            const errors = [];
            const crops = (plan && plan.crops) || [];
            for (const crop of crops) errors.push(...validateCrop(crop)); // CHANGE

            const duplicate = findFirstDuplicateCrop(plan); // NEW
            if (duplicate) errors.push("Duplicate crop rows found. Each plant/variety may appear only once per year plan."); // NEW
            errors.push(...validateCsa(plan)); // NEW
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
            validateCsa, // NEW
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

        function findDiagramMetadataCell() { // NEW
            const root = getDiagramRootCell(); // NEW
            if (!root) return null; // NEW
            const queue = [root]; // NEW
            while (queue.length) { // NEW
                const cell = queue.shift(); // NEW
                if (DiagramStore.getCellAttr(cell, Env.ATTRS.PLAN_METADATA_CELL_ATTR, "") === "1") return cell; // NEW
                const count = Env.model.getChildCount(cell); // NEW
                for (let index = 0; index < count; index++) queue.push(Env.model.getChildAt(cell, index)); // NEW
            }
            return null; // NEW
        }

        /**
         * Creates one invisible vertex so diagram-level JSON is encoded as an XML user object. // NEW
         */
        function createDiagramMetadataCell() { // NEW
            const parent = Env.graph.getDefaultParent ? Env.graph.getDefaultParent() : getDiagramRootCell(); // NEW
            if (!parent || typeof Env.graph.insertVertex !== "function") return null; // NEW
            const xmlDocument = (typeof mxUtils !== "undefined" && typeof mxUtils.createXmlDocument === "function") // NEW
                ? mxUtils.createXmlDocument() : document; // NEW
            const value = xmlDocument.createElement("uslYearPlannerMetadata"); // NEW
            value.setAttribute(Env.ATTRS.PLAN_METADATA_CELL_ATTR, "1"); // NEW
            const cell = Env.graph.insertVertex(parent, null, value, 0, 0, 0, 0, "shape=none;opacity=0;noLabel=1;locked=1;"); // NEW
            if (cell && typeof cell.setVisible === "function") cell.setVisible(false); // NEW
            if (cell && typeof cell.setConnectable === "function") cell.setConnectable(false); // NEW
            return cell; // NEW
        }

        function rawCellAttribute(cell, attributeName) { // NEW
            return DiagramStore.getCellAttr(cell, attributeName, ""); // NEW
        }

        function parseJsonMap(raw) { // NEW
            const parsed = Env.safeJsonStringParse(raw, null); // NEW
            return (parsed && typeof parsed === "object" && !Array.isArray(parsed)) ? parsed : {}; // NEW
        }

        function readRootJsonMap(attributeName) { // NEW
            const metadataCell = findDiagramMetadataCell(); // NEW
            const metadataRaw = rawCellAttribute(metadataCell, attributeName); // NEW
            if (metadataRaw !== "") return parseJsonMap(metadataRaw); // NEW
            return readJsonMap(getDiagramRootCell(), attributeName); // CHANGE
        }

        /**
         * Copies both legacy root maps on the first write, then makes the metadata cell canonical. // NEW
         */
        function writeRootJsonMap(attributeName, map) { // NEW
            const root = getDiagramRootCell(); // NEW
            Env.model.beginUpdate(); // NEW
            let metadataCell = null; // NEW
            try {
                metadataCell = findDiagramMetadataCell() || createDiagramMetadataCell(); // NEW
                if (!metadataCell) return; // NEW
                for (const legacyAttribute of [Env.ATTRS.PLAN_TEMPLATES_ATTR, Env.ATTRS.PLAN_UNIT_DEFAULTS_ATTR]) { // NEW
                    const metadataRaw = rawCellAttribute(metadataCell, legacyAttribute); // NEW
                    const legacyRaw = rawCellAttribute(root, legacyAttribute); // NEW
                    if (metadataRaw === "" && legacyRaw !== "") DiagramStore.setCellAttr(metadataCell, legacyAttribute, legacyRaw); // NEW
                    if (legacyRaw !== "") DiagramStore.setCellAttr(root, legacyAttribute, null); // NEW
                }
                DiagramStore.setCellAttr(metadataCell, attributeName, JSON.stringify(map || {})); // NEW
            } finally {
                Env.model.endUpdate(); // NEW
            }
            if (metadataCell) Env.graph.refresh(metadataCell); // NEW
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
            if (startMs > endMs) return false; // CHANGE

            const yearStartMs = PlanMath.parseYmdLocalToMs(`${selectedYear}-01-01`);
            const yearEndExMs = PlanMath.parseYmdLocalToMs(`${selectedYear + 1}-01-01`);
            const windowStartMs = startMs; // CHANGE
            const windowEndExMs = PlanMath.addDaysMs(endMs, 1); // CHANGE
            return windowStartMs < yearEndExMs && windowEndExMs > yearStartMs;
        }

        function getTilerGroups(moduleCell) { // NEW
            return getAllDescendants(Env.model, moduleCell).filter(isTilerGroupCell);
        }

        /**
         * Returns stable crop metadata from every tiler group in the garden module. // NEW
         * Database availability and legacy variety-name resolution remain caller concerns. // NEW
         */ // NEW
        function readGardenCropCandidates(moduleCell) { // NEW
            const candidates = []; // NEW
            for (const tilerGroup of getTilerGroups(moduleCell)) { // NEW
                const plantId = String(DiagramStore.getCellAttr(tilerGroup, "plant_id", "") || "").trim(); // NEW
                if (!plantId) continue; // NEW
                candidates.push({ // NEW
                    plantId, // NEW
                    plantName: String(DiagramStore.getCellAttr(tilerGroup, "plant_name", "") || "").trim(), // NEW
                    varietyId: String(DiagramStore.getCellAttr(tilerGroup, "variety_id", "") || "").trim() || null, // NEW
                    varietyName: String(DiagramStore.getCellAttr(tilerGroup, "variety_name", "") || "").trim() // NEW
                }); // NEW
            } // NEW
            return candidates; // NEW
        } // NEW

        function actualPlantsMapFromTilers(tilerGroups, selectedYear, resolveCropKey) { // CHANGE
            const actualPlantsByCropKey = new Map();
            for (const tilerGroup of tilerGroups) {
                if (!shouldIncludeTilerGroupInYear(tilerGroup, selectedYear, harvestEndLocalYear)) continue;
                const plantCount = Number(DiagramStore.getCellAttr(tilerGroup, "plant_count", ""));
                const count = Number.isFinite(plantCount) && plantCount > 0 ? Math.trunc(plantCount) : 0;
                if (count <= 0) continue;
                const key = resolveCropKey ? resolveCropKey(tilerGroup) : getCropKeyFromTilerGroup(tilerGroup); // CHANGE
                if (!key) continue; // NEW
                actualPlantsByCropKey.set(key, (actualPlantsByCropKey.get(key) || 0) + count);
            }
            return actualPlantsByCropKey;
        }

        function actualPlantsMapFromModule(moduleCell, selectedYear) { // CHANGE
            return actualPlantsMapFromTilers(getTilerGroups(moduleCell), selectedYear);
        }

        function buildActualHarvestSeriesFromTilers(tilerGroups, year, weekStarts, cropKeyToKgPerPlant, resolveCropKey) { // CHANGE
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

                const key = resolveCropKey ? resolveCropKey(tilerGroup) : getCropKeyFromTilerGroup(tilerGroup); // CHANGE
                if (!key) continue; // NEW
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

        function normalizeIdentityName(value) { // NEW
            return String(value || "").trim().toLocaleLowerCase(); // NEW
        } // NEW

        /**
         * Resolves legacy variety-name-only tiler groups against unique planned crop identities. // NEW
         */ // NEW
        function createPlanCropKeyResolver(plan, diagnostics) { // NEW
            const plannedByPlantAndVarietyName = new Map(); // NEW
            for (const crop of ((plan && plan.crops) || [])) { // NEW
                const plantId = String(crop && crop.plantId || "").trim(); // NEW
                const varietyId = String((crop && crop.varietyId) ?? "").trim(); // NEW
                const varietyName = normalizeIdentityName(crop && crop.variety); // NEW
                if (!plantId || !varietyId || !varietyName) continue; // NEW
                const lookupKey = `${plantId}|${varietyName}`; // NEW
                const matches = plannedByPlantAndVarietyName.get(lookupKey) || []; // NEW
                matches.push(getCropKeyFromPlanCrop(crop)); // NEW
                plannedByPlantAndVarietyName.set(lookupKey, matches); // NEW
            } // NEW

            return tilerGroup => { // NEW
                const plantId = String(DiagramStore.getCellAttr(tilerGroup, "plant_id", "") || "").trim(); // NEW
                const varietyId = String(DiagramStore.getCellAttr(tilerGroup, "variety_id", "") || "").trim(); // NEW
                if (!plantId || varietyId) return getCropKeyFromTilerGroup(tilerGroup); // NEW

                const varietyName = String(DiagramStore.getCellAttr(tilerGroup, "variety_name", "") || "").trim(); // NEW
                if (!varietyName) return getCropKeyFromTilerGroup(tilerGroup); // NEW

                const matches = plannedByPlantAndVarietyName.get(`${plantId}|${normalizeIdentityName(varietyName)}`) || []; // NEW
                const plantName = String(DiagramStore.getCellAttr(tilerGroup, "plant_name", "") || plantId).trim(); // NEW
                const label = `${plantName} - ${varietyName}`; // NEW
                if (matches.length === 1) return matches[0]; // NEW
                diagnostics.push(matches.length > 1 // NEW
                    ? `Diagram crop "${label}" matches multiple planned varieties and was ignored.` // NEW
                    : `Diagram crop "${label}" has no unique planned variety match and was ignored.`); // NEW
                return ""; // NEW
            }; // NEW
        } // NEW

        /**
         * Scans relevant tiler groups once so counts, weekly harvest, and exact ranges share one identity. // NEW
         */ // NEW
        function collectYearFactsFromTilers(tilerGroups, year, weekStarts, cropKeyToKgPerPlant, plan) { // NEW
            const diagnostics = []; // NEW
            const resolveCropKey = createPlanCropKeyResolver(plan, diagnostics); // NEW
            const actualPlantsByCropKey = new Map(); // NEW
            const actualHarvestSeriesByCropKey = new Map(); // NEW
            const actualHarvestDateRangeByCropKey = new Map(); // NEW
            const ensureSeries = key => { // NEW
                if (!actualHarvestSeriesByCropKey.has(key)) actualHarvestSeriesByCropKey.set(key, Array(weekStarts.length).fill(0)); // NEW
                return actualHarvestSeriesByCropKey.get(key); // NEW
            }; // NEW

            for (const tilerGroup of tilerGroups) { // NEW
                if (!shouldIncludeTilerGroupInYear(tilerGroup, year, harvestEndLocalYear)) continue; // NEW
                const plantCount = Number(DiagramStore.getCellAttr(tilerGroup, "plant_count", "")); // NEW
                const count = Number.isFinite(plantCount) && plantCount > 0 ? Math.trunc(plantCount) : 0; // NEW
                if (count <= 0) continue; // NEW
                const key = resolveCropKey(tilerGroup); // NEW
                if (!key) continue; // NEW

                actualPlantsByCropKey.set(key, (actualPlantsByCropKey.get(key) || 0) + count); // NEW
                const start = harvestStartYmd(tilerGroup); // NEW
                const end = harvestEndYmd(tilerGroup); // NEW
                const label = String(DiagramStore.getCellAttr(tilerGroup, "plant_name", "") || key).trim(); // NEW
                if (!PlanMath.hasYmd(start) || !PlanMath.hasYmd(end)) { // NEW
                    diagnostics.push(`Diagram harvest window for "${label}" is incomplete and was ignored.`); // NEW
                    continue; // NEW
                } // NEW
                if (start > end) { // NEW
                    diagnostics.push(`Diagram harvest window for "${label}" has start date after end date and was ignored.`); // NEW
                    continue; // NEW
                } // NEW
                if (!harvestWindowOverlapsYear(tilerGroup, year)) continue; // NEW

                const currentRange = actualHarvestDateRangeByCropKey.get(key); // NEW
                actualHarvestDateRangeByCropKey.set(key, { // NEW
                    start: currentRange && currentRange.start < start ? currentRange.start : start, // NEW
                    end: currentRange && currentRange.end > end ? currentRange.end : end // NEW
                }); // NEW

                const kgPerPlant = Number(cropKeyToKgPerPlant.get(key)); // NEW
                if (!Number.isFinite(kgPerPlant) || kgPerPlant <= 0) continue; // NEW
                PlanMath.addTotalKgAcrossWindowProrated( // NEW
                    ensureSeries(key), // NEW
                    weekStarts, // NEW
                    start, // NEW
                    end, // NEW
                    count * kgPerPlant, // NEW
                    year // NEW
                ); // NEW
            } // NEW

            return { // NEW
                actualPlantsByCropKey, // NEW
                actualHarvestSeriesByCropKey, // NEW
                actualHarvestDateRangeByCropKey, // NEW
                diagnostics // NEW
            }; // NEW
        } // NEW

        /**
         * Scans module descendants once and returns all diagram facts needed by recalculation. // NEW
         */
        function readYearFacts(moduleCell, year, weekStarts, cropKeyToKgPerPlant, plan) { // CHANGE
            const tilerGroups = getTilerGroups(moduleCell);
            return collectYearFactsFromTilers(tilerGroups, year, weekStarts, cropKeyToKgPerPlant, plan); // CHANGE
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
            readGardenCropCandidates, // NEW
            createPlanCropKeyResolver, // NEW
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
            return String(crop.harvestEnd); // CHANGE
        } // CHANGE

        function legacyShelfExtendedEndYmd(crop, harvestEnd) { // NEW
            if (!PlanMath.hasYmd(harvestEnd)) return null; // NEW
            const shelfDays = Math.max(0, Math.trunc(Number(crop && crop.shelfLifeDays) || 0)); // NEW
            return shelfDays > 0 ? addDaysYmd(harvestEnd, shelfDays) : null; // NEW
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
            const previousHarvestEnd = oldSnapshot && oldSnapshot.he; // NEW
            const previousLegacyEnd = legacyShelfExtendedEndYmd(crop, previousHarvestEnd); // NEW
            const csa = plan && plan.csa ? plan.csa : null;

            crop.__sync_lastHarvestStart = crop.__sync_lastHarvestStart ?? (oldSnapshot && oldSnapshot.hs) ?? "";
            crop.__sync_lastHarvestEnd = crop.__sync_lastHarvestEnd ?? (oldSnapshot && oldSnapshot.he) ?? "";
            crop.__sync_lastAvailEnd = crop.__sync_lastAvailEnd ?? (oldSnapshot && oldSnapshot.availEnd) ?? "";

            crop.market = crop.market || [];
            for (const marketLine of crop.market) {
                if (!marketLine) continue;
                if (previousLegacyEnd && String(marketLine.to || "") === previousLegacyEnd) marketLine.to = previousHarvestEnd; // NEW
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
                    if (previousLegacyEnd && String(component.end || "") === previousLegacyEnd) component.end = previousHarvestEnd; // NEW
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

        function recalculate(moduleCell, year, plan) { // NEW
            PlanSchema.normalizeForRuntime(plan, year);
            const selectedYear = Number(plan.year);
            const weekStartDow = plan.weekStartDow; // CHANGE
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
                kgPerPlantByCropKey,
                plan // CHANGE
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
                const exactRange = diagramFacts.actualHarvestDateRangeByCropKey.get(key); // CHANGE
                if (crop.useActualHarvest !== false && exactRange) { // CHANGE
                    crop.harvestStart = exactRange.start; // CHANGE
                    crop.harvestEnd = exactRange.end; // CHANGE
                } // CHANGE
            }

            for (const crop of plan.crops) syncCropDatesIfEnabled(plan, crop, beforeHarvestById.get(crop.id));
            autoFillAndClampCsa(plan);

            const warnings = Array.from(diagramFacts.diagnostics || []); // CHANGE
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
                csaExpanded: false, // NEW
                demandExpanded: true, // NEW
                cropPlanExpanded: true, // NEW
                planCheckExpanded: false, // CHANGE
                hadBlockingErrors: false, // NEW
                hadCsaErrors: false, // NEW
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

        function formatKg(value) { // NEW
            const number = Number(value); // NEW
            return Number.isFinite(number) ? `${number.toFixed(1)} kg` : "-"; // NEW
        } // NEW

        function formatYmd(ymd) { // NEW
            const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || "")); // NEW
            if (!match) return ""; // NEW
            const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(match[2]) - 1]; // NEW
            return month ? `${month} ${match[3]}` : ""; // NEW
        } // NEW

        function buildCompactStatus(dashboard) { // NEW
            const cropCount = Math.max(0, Math.trunc(Number(dashboard && dashboard.cropCount) || 0)); // NEW
            const parts = [String(Number(dashboard && dashboard.year) || ""), `${cropCount} crop${cropCount === 1 ? "" : "s"}`]; // NEW
            if (Number(dashboard && dashboard.shortKg) > EPS) parts.push(`Short ${formatKg(dashboard.shortKg)}`); // NEW
            else if (Number(dashboard && dashboard.surplusKg) > EPS) parts.push(`Surplus ${formatKg(dashboard.surplusKg)}`); // NEW
            if (dashboard && dashboard.dirty) parts.push("Unsaved"); // NEW
            return parts.filter(Boolean).join(" \u00b7 "); // NEW
        } // NEW

        function buildCsaSummary(plan) { // NEW
            const csa = plan && plan.csa; // NEW
            if (!csa || !csa.enabled) return "CSA Box Plan: Off"; // NEW
            const parts = [`CSA Box Plan: ${Math.max(0, Math.trunc(Number(csa.boxesPerWeek) || 0))} boxes/week`]; // NEW
            const start = formatYmd(csa.start); // NEW
            const end = formatYmd(csa.end); // NEW
            if (start || end) parts.push(`${start || "?"}\u2013${end || "?"}`); // NEW
            const componentCount = Array.isArray(csa.components) ? csa.components.length : 0; // NEW
            parts.push(`${componentCount} component${componentCount === 1 ? "" : "s"}`); // NEW
            return parts.join(" \u00b7 "); // NEW
        } // NEW

        function syncExpansionState(state, dashboard, csaErrors) { // NEW
            const hasBlockingErrors = !!(dashboard && dashboard.validationErrors && dashboard.validationErrors.length); // NEW
            const hasCsaErrors = !!(csaErrors && csaErrors.length); // NEW
            const changes = { planCheckChanged: false, csaChanged: false }; // CHANGE
            if (hasBlockingErrors && !state.hadBlockingErrors && !state.planCheckExpanded) { // CHANGE
                state.planCheckExpanded = true; // CHANGE
                changes.planCheckChanged = true; // CHANGE
            } // NEW
            if (hasCsaErrors && !state.hadCsaErrors && !state.csaExpanded) { // NEW
                state.csaExpanded = true; // NEW
                changes.csaChanged = true; // NEW
            } // NEW
            state.hadBlockingErrors = hasBlockingErrors; // NEW
            state.hadCsaErrors = hasCsaErrors; // NEW
            return changes; // NEW
        } // NEW

        function compute(plan, runtime, options) { // NEW
            const settings = options || {}; // NEW
            const rows = runtime && Array.isArray(runtime.cropTotals) ? runtime.cropTotals : []; // NEW
            const rowsById = new Map(rows.map(row => [String(row && row.crop && row.crop.id || ""), row])); // NEW
            const weekly = runtime && runtime.weekly; // NEW
            const cropMetrics = []; // NEW
            let targetKg = 0; // NEW
            let supplyKg = 0; // NEW
            let shortKg = 0; // NEW
            let surplusKg = 0; // NEW
            let actualHarvestActive = false; // NEW
            let manualHarvestDates = false; // NEW

            for (const crop of ((plan && plan.crops) || [])) { // NEW
                const row = rowsById.get(String(crop.id || "")) || { targetKg: 0, supplyKg: 0, plantsReq: NaN, seedsReq: NaN }; // NEW
                const chartSummary = weekly // NEW
                    ? PlanMath.summarizePlanChartModel(PlanMath.buildPlanChartModel(weekly, String(crop.id))) // NEW
                    : { // NEW
                        targetKg: Math.max(0, Number(row.targetKg) || 0), // NEW
                        harvestKg: Math.max(0, Number(row.supplyKg) || 0), // NEW
                        usableSupplyKg: Math.min(Math.max(0, Number(row.targetKg) || 0), Math.max(0, Number(row.supplyKg) || 0)), // NEW
                        shortKg: Math.max(0, (Number(row.targetKg) || 0) - (Number(row.supplyKg) || 0)), // NEW
                        expiredKg: 0 // NEW
                    }; // NEW
                const target = chartSummary.targetKg; // CHANGE
                const supply = chartSummary.harvestKg; // CHANGE
                const shortage = chartSummary.shortKg; // CHANGE
                const surplus = Math.max(0, supply - chartSummary.usableSupplyKg); // CHANGE
                const errors = PlanSchema.validateCrop(crop); // NEW
                if (target > EPS && (!PlanMath.hasYmd(crop.harvestStart) || !PlanMath.hasYmd(crop.harvestEnd))) { // NEW
                    errors.push(`Crop "${crop.plant || crop.id}" missing harvest window.`); // NEW
                } // NEW
                let status = "OK"; // NEW

                if (errors.length > 0) status = "Missing data"; // NEW
                else if (target <= EPS) status = "No demand"; // NEW
                else if (shortage > EPS && supply + EPS < target) status = "Short"; // CHANGE
                else if (shortage > EPS) status = "Expired / timing issue"; // NEW
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
                    expiredKg: chartSummary.expiredKg, // NEW
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
            if (cropMetrics.some(metric => metric.status === "Expired / timing issue")) badges.push("Expired / timing issue"); // NEW
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
                dirty: !!settings.dirty, // NEW
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
            formatKg, // NEW
            formatYmd, // NEW
            buildCompactStatus, // NEW
            buildCsaSummary, // NEW
            syncExpansionState, // NEW
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

    /** Defines the chart's visual encodings once for rendering, legend controls, and hover details. */ // NEW
    const PLAN_CHART_SERIES = Object.freeze([ // NEW
        { id: "target", label: "Target demand", tooltipLabel: "Target", field: "targetKg", kind: "line", color: "#222", lineWidth: 2, dash: [], help: "Weekly demand required by market and CSA plans." }, // NEW
        { id: "available", label: "Available supply", tooltipLabel: "Available", field: "availableSupplyKg", kind: "dashed-line", color: "#1f7a3d", lineWidth: 2, dash: [6, 3], help: "Harvested inventory available before weekly demand is allocated." }, // NEW
        { id: "usable", label: "Usable supply", tooltipLabel: "Usable", field: "usableSupplyKg", kind: "line", color: "#62a96b", lineWidth: 1.5, dash: [], help: "Available supply used to satisfy this week's demand." }, // NEW
        { id: "harvest", label: "Harvest", tooltipLabel: "Harvested", field: "harvestKg", kind: "bar", color: "#4285f4", fill: "rgba(66, 133, 244, 0.34)", help: "Estimated harvested weight added during the week." }, // NEW
        { id: "shortage", label: "Shortage", tooltipLabel: "Short", field: "shortKg", kind: "area", color: "#d63939", fill: "rgba(214, 57, 57, 0.20)", help: "Demand that remains unmet after available supply is used." }, // NEW
        { id: "expired", label: "Expired", tooltipLabel: "Expired", field: "expiredKg", kind: "point", color: "#d97706", help: "Stored harvest that reaches the end of its shelf life this week." } // NEW
    ]); // NEW

    function isPlanChartSeriesVisible(visibleSeriesIds, seriesId) { // NEW
        return !visibleSeriesIds || visibleSeriesIds.has(seriesId); // NEW
    } // NEW

    function drawPlanChart(canvas, chartModel, visibleSeriesIds) { // CHANGE
        const ctx = canvas.getContext("2d"); // CHANGE
        const rows = Array.isArray(chartModel) ? chartModel : []; // NEW
        const seriesById = new Map(PLAN_CHART_SERIES.map(series => [series.id, series])); // NEW
        if (!ctx) return null; // CHANGE
        const width = canvas.width; // CHANGE
        const height = canvas.height; // CHANGE
        ctx.clearRect(0, 0, width, height); // CHANGE
        if (!rows.length) return null; // CHANGE

        const padLeft = 48; // CHANGE
        const padRight = 14; // CHANGE
        const padTop = 12; // CHANGE
        const padBottom = 28; // CHANGE
        const plotRight = width - padRight; // NEW
        const plotBottom = height - padBottom; // NEW
        const plotWidth = plotRight - padLeft; // NEW
        const plotHeight = plotBottom - padTop; // NEW
        const step = plotWidth / rows.length; // NEW
        const weekCenters = rows.map((row, index) => padLeft + ((index + 0.5) * step)); // NEW
        const maxValue = Math.max(1, ...rows.flatMap(row => [ // CHANGE
            row.targetKg, // NEW
            row.harvestKg, // NEW
            row.availableSupplyKg, // NEW
            row.usableSupplyKg, // NEW
            row.expiredKg // NEW
        ]).map(value => Math.max(0, Number(value) || 0))); // CHANGE
        const y = value => plotBottom - ((Math.max(0, Number(value) || 0) / maxValue) * plotHeight); // NEW

        ctx.font = "10px Arial"; // NEW
        ctx.textBaseline = "middle"; // NEW
        ctx.lineWidth = 1; // CHANGE
        for (let tick = 0; tick <= 4; tick++) { // NEW
            const value = maxValue * tick / 4; // NEW
            const tickY = y(value); // NEW
            ctx.strokeStyle = tick === 0 ? "#999" : "#e4e4e4"; // NEW
            ctx.beginPath(); // CHANGE
            ctx.moveTo(padLeft, tickY); // CHANGE
            ctx.lineTo(plotRight, tickY); // CHANGE
            ctx.stroke(); // CHANGE
            ctx.fillStyle = "#555"; // NEW
            ctx.textAlign = "right"; // NEW
            ctx.fillText(`${value.toFixed(value >= 10 ? 0 : 1)} kg`, padLeft - 5, tickY); // NEW
        } // NEW

        let previousMonth = ""; // NEW
        for (let index = 0; index < rows.length; index++) { // NEW
            const week = String(rows[index].week || ""); // NEW
            const month = week.slice(0, 7); // NEW
            if (!month || month === previousMonth) continue; // NEW
            const boundaryX = padLeft + (index * step); // NEW
            ctx.strokeStyle = "#d4d4d4"; // NEW
            ctx.beginPath(); // NEW
            ctx.moveTo(boundaryX, padTop); // NEW
            ctx.lineTo(boundaryX, plotBottom); // NEW
            ctx.stroke(); // NEW
            ctx.fillStyle = "#666"; // NEW
            ctx.textAlign = "left"; // NEW
            ctx.textBaseline = "alphabetic"; // NEW
            ctx.fillText(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(week.slice(5, 7)) - 1] || "", boundaryX + 2, height - 8); // NEW
            previousMonth = month; // NEW
        } // NEW

        const barWidth = Math.max(2, Math.min(12, step * 0.58)); // NEW
        for (let index = 0; index < rows.length; index++) { // NEW
            const row = rows[index]; // NEW
            const centerX = weekCenters[index]; // NEW
            if (isPlanChartSeriesVisible(visibleSeriesIds, "harvest")) { // NEW
                const harvestTop = y(row.harvestKg); // NEW
                ctx.fillStyle = seriesById.get("harvest").fill; // CHANGE
                ctx.fillRect(centerX - (barWidth / 2), harvestTop, barWidth, plotBottom - harvestTop); // NEW
            } // NEW
            if (isPlanChartSeriesVisible(visibleSeriesIds, "shortage") && row.shortKg > 0) { // CHANGE
                const targetY = y(row.targetKg); // NEW
                const usableY = y(row.usableSupplyKg); // NEW
                ctx.fillStyle = seriesById.get("shortage").fill; // CHANGE
                ctx.fillRect(centerX - (step * 0.38), targetY, step * 0.76, Math.max(2, usableY - targetY)); // NEW
            } // NEW
            if (isPlanChartSeriesVisible(visibleSeriesIds, "expired") && row.expiredKg > 0) { // CHANGE
                ctx.fillStyle = seriesById.get("expired").color; // CHANGE
                ctx.beginPath(); // NEW
                ctx.arc(centerX, y(row.expiredKg), 3, 0, Math.PI * 2); // NEW
                ctx.fill(); // NEW
            } // NEW
        } // NEW

        function drawLine(field, color, lineWidth, dash) { // NEW
            ctx.strokeStyle = color; // NEW
            ctx.lineWidth = lineWidth; // NEW
            ctx.setLineDash(dash || []); // NEW
            ctx.beginPath(); // NEW
            for (let index = 0; index < rows.length; index++) { // NEW
                const pointY = y(rows[index][field]); // NEW
                if (index === 0) ctx.moveTo(weekCenters[index], pointY); // NEW
                else ctx.lineTo(weekCenters[index], pointY); // NEW
            } // NEW
            ctx.stroke(); // NEW
            ctx.setLineDash([]); // NEW
        } // NEW

        for (const series of PLAN_CHART_SERIES) { // NEW
            if ((series.kind === "line" || series.kind === "dashed-line") && isPlanChartSeriesVisible(visibleSeriesIds, series.id)) { // NEW
                drawLine(series.field, series.color, series.lineWidth, series.dash); // NEW
            } // NEW
        } // NEW

        return { rows, weekCenters, plotLeft: padLeft, plotRight, step, maxValue }; // CHANGE
    } // CHANGE

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
            let loadedExistingForCurrentYear = !!existing; // NEW
            const plan = PlanSchema.normalizeForRuntime(existing || PlanSchema.createEmptyPlan(currentYear), currentYear); // NEW
            const state = YearPlanDashboard.createState(plan); // NEW
            const session = SessionController.start(moduleCell, currentYear, plan); // NEW
            const varietyCache = new Map(); // NEW
            const methodCache = new Map(); // NEW
            const addCropOptionById = new Map(); // NEW
            let addCropOptionsLoadVersion = 0; // NEW
            let runtime = null; // NEW
            let dashboard = null; // NEW
            let refreshTimer = null; // NEW
            let pendingRefreshOptions = null; // NEW
            let editorRefs = {}; // NEW
            let demandRefs = {}; // NEW
            let chartHitModel = null; // NEW
            const visibleChartSeriesIds = new Set(PLAN_CHART_SERIES.map(series => series.id)); // NEW

            const wrap = document.createElement("div"); // NEW
            wrap.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;"; // NEW
            const card = document.createElement("div"); // NEW
            card.style.cssText = "width:1180px;max-width:97vw;height:92vh;background:#fff;border:1px solid #777;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.25);display:flex;flex-direction:column;overflow:hidden;font:12px Arial,sans-serif;"; // NEW
            const style = document.createElement("style"); // NEW
            style.textContent = ` /* NEW */
                .yp-dashboard-grid{display:grid;grid-template-columns:280px minmax(0,1fr);gap:12px;align-items:start}
                .yp-strip-box{border:1px solid #ddd;border-radius:8px;background:#fff;overflow:hidden}
                .yp-strip-header{display:flex;align-items:center;gap:10px;width:100%;padding:9px 10px;border:0;background:#f7f7f7;cursor:pointer;text-align:left;font:12px Arial,sans-serif}
                .yp-strip-title{flex:0 0 auto;font-weight:700;font-size:13px}
                .yp-strip-summary{flex:1 1 auto;min-width:0;color:#555;overflow-wrap:anywhere}
                .yp-strip-toggle{flex:0 0 auto;color:#333}
                .yp-strip-details{padding:10px;border-top:1px solid #ddd}
                .yp-field-grid{display:grid;grid-template-columns:repeat(2,minmax(220px,1fr));gap:10px}
                .yp-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
                .yp-line{display:grid;grid-template-columns:minmax(70px,1fr) 120px 150px 150px auto;gap:8px;align-items:center}
                .yp-package-line{display:grid;grid-template-columns:32px minmax(90px,1fr) 26px 100px 100px 90px auto;gap:8px;align-items:center}
                .yp-chart-legend{display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center;margin:0 0 6px}
                .yp-chart-legend-item{display:inline-flex;align-items:center;gap:6px;padding:4px 7px;border:1px solid #aaa;border-radius:999px;background:#fff;color:#222;cursor:pointer;font:12px Arial,sans-serif}
                .yp-chart-legend-item[aria-pressed="false"]{opacity:.48;background:#f2f2f2;text-decoration:line-through}
                .yp-chart-legend-swatch{position:relative;display:inline-block;flex:0 0 22px;width:22px;height:10px}
                .yp-chart-legend-swatch[data-kind="line"]::before,.yp-chart-legend-swatch[data-kind="dashed-line"]::before{content:"";position:absolute;left:0;right:0;top:4px;border-top:2px solid var(--yp-series-color)}
                .yp-chart-legend-swatch[data-kind="dashed-line"]::before{border-top-style:dashed}
                .yp-chart-legend-swatch[data-kind="bar"]{height:10px;border:1px solid var(--yp-series-color);background:var(--yp-series-fill)}
                .yp-chart-legend-swatch[data-kind="area"]{height:10px;border:1px solid var(--yp-series-color);background:var(--yp-series-fill)}
                .yp-chart-legend-swatch[data-kind="point"]::before{content:"";position:absolute;left:7px;top:1px;width:8px;height:8px;border-radius:50%;background:var(--yp-series-color)}
                @media(max-width:850px){
                    .yp-dashboard-grid{grid-template-columns:1fr}
                    .yp-field-grid{grid-template-columns:1fr}
                    .yp-line,.yp-package-line{display:flex;flex-wrap:wrap}
                    .yp-plan-check-grid{grid-template-columns:1fr!important}
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
            body.style.cssText = "padding:12px;overflow:auto;flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:10px;"; // CHANGE
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
            const demandBox = document.createElement("div"); // NEW
            const cropPlanBox = document.createElement("div"); // NEW
            const planCheckBox = document.createElement("div"); // NEW
            csaBox.dataset.yearPlanStrip = "csa"; // NEW
            demandBox.dataset.yearPlanStrip = "demand"; // NEW
            cropPlanBox.dataset.yearPlanStrip = "crop-plan"; // NEW
            planCheckBox.dataset.yearPlanStrip = "plan-check"; // NEW
            mainColumn.appendChild(editorBox); // NEW
            dashboardGrid.appendChild(sidebar); // NEW
            dashboardGrid.appendChild(mainColumn); // NEW
            body.appendChild(cropPlanBox); // CHANGE
            body.appendChild(demandBox); // CHANGE
            body.appendChild(csaBox); // CHANGE
            body.appendChild(planCheckBox); // NEW

            const planCheckGrid = document.createElement("div"); // CHANGE
            planCheckGrid.className = "yp-plan-check-grid"; // CHANGE
            planCheckGrid.style.cssText = "display:grid;grid-template-columns:minmax(0,1fr) minmax(340px,1fr);gap:12px;"; // CHANGE
            const chartBox = document.createElement("div"); // NEW
            chartBox.style.position = "relative"; // NEW
            const chartControls = document.createElement("div"); // NEW
            chartControls.className = "yp-row"; // NEW
            chartControls.style.marginBottom = "6px"; // NEW
            const cropFilterSel = document.createElement("select"); // NEW
            const planCheckSummary = document.createElement("div"); // NEW
            planCheckSummary.className = "yp-plan-check-summary"; // NEW
            planCheckSummary.style.cssText = "display:flex;flex-wrap:wrap;gap:5px 14px;padding:7px 8px;margin-bottom:6px;border:1px solid #e0e0e0;border-radius:6px;background:#fafafa;"; // NEW
            const chartLegend = document.createElement("div"); // NEW
            chartLegend.className = "yp-chart-legend"; // NEW
            chartLegend.setAttribute("role", "group"); // NEW
            chartLegend.setAttribute("aria-label", "Chart series visibility"); // NEW
            const chartLegendHelp = document.createElement("div"); // NEW
            chartLegendHelp.className = "yp-chart-legend-help"; // NEW
            chartLegendHelp.style.cssText = "margin:-1px 0 6px;color:#666;font-size:11px;"; // NEW
            chartLegendHelp.textContent = "Toggle chart series. Plan Check calculations and totals are unchanged."; // NEW
            const canvas = document.createElement("canvas"); // NEW
            canvas.width = 900; // NEW
            canvas.height = 240; // CHANGE
            canvas.style.cssText = "width:100%;height:240px;border:1px solid #eee;"; // CHANGE
            const chartHiddenMessage = document.createElement("div"); // NEW
            chartHiddenMessage.className = "yp-plan-chart-hidden-message"; // NEW
            chartHiddenMessage.style.cssText = "display:none;position:absolute;left:50%;top:62%;transform:translate(-50%,-50%);pointer-events:none;padding:6px 9px;border:1px solid #bbb;border-radius:5px;background:rgba(255,255,255,.94);color:#555;font-weight:700;"; // NEW
            chartHiddenMessage.textContent = "All chart series hidden"; // NEW
            const chartTooltip = document.createElement("div"); // NEW
            chartTooltip.className = "yp-plan-chart-tooltip"; // NEW
            chartTooltip.style.cssText = "display:none;position:absolute;z-index:2;pointer-events:none;min-width:170px;padding:7px 8px;border:1px solid #777;border-radius:5px;background:rgba(255,255,255,.97);box-shadow:0 3px 12px rgba(0,0,0,.18);line-height:1.45;"; // NEW
            const totalsBox = document.createElement("div"); // NEW
            const diagnosticsBox = document.createElement("div"); // NEW
            diagnosticsBox.style.marginTop = "10px"; // NEW
            chartControls.appendChild(document.createTextNode("Crop filter")); // NEW
            chartControls.appendChild(cropFilterSel); // NEW
            chartBox.appendChild(chartControls); // NEW
            chartBox.appendChild(planCheckSummary); // NEW
            chartBox.appendChild(chartLegend); // NEW
            chartBox.appendChild(chartLegendHelp); // NEW
            chartBox.appendChild(canvas); // NEW
            chartBox.appendChild(chartHiddenMessage); // NEW
            chartBox.appendChild(chartTooltip); // NEW
            planCheckGrid.appendChild(chartBox); // CHANGE
            planCheckGrid.appendChild(totalsBox); // CHANGE

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

            /**
             * Renders one persistent collapsible strip shell and rebuilds its details only when requested. // NEW
             */ // NEW
            function renderStripBox(box, config) { // NEW
                const settings = config || {}; // NEW
                let shell = box.__yearPlanStrip; // NEW
                if (!shell) { // NEW
                    box.className = "yp-strip-box"; // NEW
                    const header = document.createElement("button"); // NEW
                    header.type = "button"; // NEW
                    header.className = "yp-strip-header"; // NEW
                    const title = document.createElement("span"); // NEW
                    title.className = "yp-strip-title"; // NEW
                    const summary = document.createElement("span"); // NEW
                    summary.className = "yp-strip-summary"; // NEW
                    const toggle = document.createElement("span"); // NEW
                    toggle.className = "yp-strip-toggle"; // NEW
                    const details = document.createElement("div"); // NEW
                    details.className = "yp-strip-details"; // NEW
                    details.id = settings.detailsId || Env.uid("yp-strip-details"); // NEW
                    header.setAttribute("aria-controls", details.id); // NEW
                    header.appendChild(title); // NEW
                    header.appendChild(summary); // NEW
                    header.appendChild(toggle); // NEW
                    box.appendChild(header); // NEW
                    box.appendChild(details); // NEW
                    shell = { header, title, summary, toggle, details, detailsBuilt: false, onToggle: null }; // NEW
                    header.addEventListener("click", () => { if (shell.onToggle) shell.onToggle(); }); // NEW
                    box.__yearPlanStrip = shell; // NEW
                } // NEW
                shell.onToggle = settings.onToggle || null; // NEW
                shell.title.textContent = String(settings.title || ""); // NEW
                shell.summary.textContent = String(settings.summaryText || ""); // NEW
                shell.toggle.textContent = settings.expanded ? "Collapse" : "Expand"; // NEW
                shell.header.setAttribute("aria-expanded", settings.expanded ? "true" : "false"); // NEW
                shell.details.style.display = settings.expanded ? "block" : "none"; // NEW
                const shouldBuild = !!settings.rebuildDetails || (!shell.detailsBuilt && (settings.expanded || settings.mountWhenCollapsed)); // NEW
                if (shouldBuild && settings.renderDetails) { // NEW
                    shell.details.innerHTML = ""; // NEW
                    settings.renderDetails(shell.details); // NEW
                    shell.detailsBuilt = true; // NEW
                } // NEW
                return shell; // NEW
            } // NEW

            function cropLabel(crop) { // NEW
                const plantName = String(crop && crop.plant || "").trim(); // NEW
                const varietyName = String(crop && crop.variety || "").trim(); // NEW
                return plantName && varietyName ? `${plantName} - ${varietyName}` : (plantName || varietyName || String(crop && crop.id || "Crop")); // NEW
            } // NEW

            const formatKg = YearPlanDashboard.formatKg; // CHANGE

            function statusColor(status) { // NEW
                if (status === "Short" || status === "Missing data") return "#a33"; // NEW
                if (status === "Expired / timing issue") return "#9a5a00"; // NEW
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

            /**
             * Keeps one editable date pair valid without rewriting the opposite endpoint. // NEW
             */ // NEW
            function bindPairedDateControls(startInput, endInput, options) { // NEW
                const settings = options || {}; // NEW
                const diagnostic = String(settings.diagnostic || "Start date cannot be after end date."); // NEW
                let lastStartValue = String(startInput.value || ""); // NEW
                let lastEndValue = String(endInput.value || ""); // NEW

                function updateConstraints() { // NEW
                    startInput.max = PlanMath.hasYmd(endInput.value) ? endInput.value : ""; // NEW
                    endInput.min = PlanMath.hasYmd(startInput.value) ? startInput.value : ""; // NEW
                } // NEW

                function syncFromInputs() { // NEW
                    lastStartValue = String(startInput.value || ""); // NEW
                    lastEndValue = String(endInput.value || ""); // NEW
                    updateConstraints(); // NEW
                } // NEW

                function removeDiagnostic() { // NEW
                    state.extraDiagnostics = (state.extraDiagnostics || []).filter(message => message !== diagnostic); // NEW
                } // NEW

                function rejectChange(input, previousValue, beforeDateRanges) { // NEW
                    input.value = previousValue; // NEW
                    state.extraDiagnostics = YearPlanDashboard.uniqueMessages([...(state.extraDiagnostics || []), diagnostic]); // NEW
                    state.planCheckExpanded = true; // CHANGE
                    updateConstraints(); // NEW
                    refreshDerived(beforeDateRanges); // NEW
                } // NEW

                function handleChange(changedField) { // NEW
                    const beforeDateRanges = captureDateRangeSnapshot(); // NEW
                    const nextStart = String(startInput.value || ""); // NEW
                    const nextEnd = String(endInput.value || ""); // NEW
                    if (PlanMath.hasYmd(nextStart) && PlanMath.hasYmd(nextEnd) && nextStart > nextEnd) { // NEW
                        rejectChange( // NEW
                            changedField === "start" ? startInput : endInput, // NEW
                            changedField === "start" ? lastStartValue : lastEndValue, // NEW
                            beforeDateRanges // NEW
                        ); // NEW
                        return; // NEW
                    } // NEW

                    const previousPair = { start: lastStartValue, end: lastEndValue }; // NEW
                    removeDiagnostic(); // NEW
                    if (changedField === "start") { // NEW
                        lastStartValue = nextStart; // NEW
                        if (settings.setStart) settings.setStart(nextStart); // NEW
                    } else { // NEW
                        lastEndValue = nextEnd; // NEW
                        if (settings.setEnd) settings.setEnd(nextEnd); // NEW
                    } // NEW
                    updateConstraints(); // NEW
                    if (settings.afterCommit) settings.afterCommit(beforeDateRanges, previousPair, changedField); // NEW
                    else refreshDerived(beforeDateRanges); // NEW
                } // NEW

                startInput.__syncPairedDateState = syncFromInputs; // NEW
                endInput.__syncPairedDateState = syncFromInputs; // NEW
                syncFromInputs(); // CHANGE
                startInput.addEventListener("change", () => handleChange("start")); // NEW
                endInput.addEventListener("change", () => handleChange("end")); // NEW
            } // NEW

            function debounceRefresh(renderOptions) { // CHANGE
                if (renderOptions) pendingRefreshOptions = { ...(pendingRefreshOptions || {}), ...renderOptions }; // NEW
                if (refreshTimer) clearTimeout(refreshTimer); // NEW
                refreshTimer = setTimeout(() => { // NEW
                    refreshTimer = null; // NEW
                    const options = pendingRefreshOptions; // NEW
                    pendingRefreshOptions = null; // NEW
                    if (SessionController.isActive(session)) refreshDerived(null, options); // CHANGE
                }, 90); // NEW
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

            function replacePlan(nextPlan, nextYear, loadedExisting) { // CHANGE
                Object.keys(plan).forEach(key => delete plan[key]); // NEW
                Object.assign(plan, PlanSchema.normalizeForRuntime(nextPlan, nextYear)); // NEW
                currentYear = Number(nextYear); // NEW
                loadedExistingForCurrentYear = !!loadedExisting; // NEW
                plan.year = currentYear; // NEW
                state.selectedCropId = YearPlanDashboard.resolveSelectedCropId(plan.crops, "", 0); // NEW
                state.activeTab = "basics"; // NEW
                state.hadBlockingErrors = false; // NEW
                state.hadCsaErrors = false; // NEW
                state.validationState = "idle"; // NEW
                state.lastSavedAt = null; // NEW
                state.closePromptOpen = false; // NEW
                state.extraDiagnostics = []; // NEW
                titleEl.textContent = `Plan Year - ${currentYear}`; // NEW
                yearInput.value = String(currentYear); // NEW
            } // NEW

            function renderSummary() { // NEW
                summaryBox.textContent = YearPlanDashboard.buildCompactStatus(dashboard); // CHANGE
                summaryBox.style.fontWeight = "700"; // NEW
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
                    const detail = metric.status === "Short" || metric.status === "Expired / timing issue" // CHANGE
                        ? `${metric.status} ${formatKg(metric.shortKg)}` // CHANGE
                        : metric.status === "Surplus" ? `Surplus ${formatKg(metric.surplusKg)}` // NEW
                            : metric.status; // NEW
                    cardEl.innerHTML = `<div style="font-weight:700;">${mxUtils.htmlEntities(cropLabel(metric.crop))}</div><div style="margin-top:4px;color:#555;">Target ${formatKg(metric.targetKg)} | Supply ${formatKg(metric.supplyKg)}</div><div style="margin-top:4px;color:${statusColor(metric.status)};font-weight:700;">${mxUtils.htmlEntities(detail)}</div>`; // NEW
                    cardEl.addEventListener("click", () => { // NEW
                        state.selectedCropId = String(metric.crop.id); // NEW
                        state.activeTab = "basics"; // NEW
                        renderCropList(); // NEW
                        renderSelectedEditor(); // NEW
                        renderDemandStrip(true); // NEW
                        renderCropPlan(false); // NEW
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
                if (editorRefs.harvestStart && editorRefs.harvestStart.__syncPairedDateState) editorRefs.harvestStart.__syncPairedDateState(); // NEW
                if (editorRefs.harvestDots && runtime) { // NEW
                    const derived = runtime.derivedByCropId.get(String(crop.id)); // NEW
                    renderHarvestDots(editorRefs.harvestDots, runtime.weekStarts, derived ? derived.actualHarvestWeeklyKg : []); // NEW
                } // NEW
            } // NEW

            function syncDemandDerived() { // NEW
                const crop = selectedCrop(); // NEW
                if (!crop || !dashboard || !demandRefs.summary) return; // NEW
                const metric = dashboard.cropMetricsById.get(String(crop.id)); // NEW
                if (metric) demandRefs.summary.textContent = `Market target: ${formatKg(metric.targetKg)} | Estimated supply: ${formatKg(metric.supplyKg)} | Short: ${formatKg(metric.shortKg)} | Surplus: ${formatKg(metric.surplusKg)}`; // NEW
            } // NEW

            function updateChartLegendState() { // NEW
                for (const button of chartLegend.querySelectorAll(".yp-chart-legend-item")) { // NEW
                    const series = PLAN_CHART_SERIES.find(item => item.id === button.dataset.seriesId); // NEW
                    if (!series) continue; // NEW
                    const visible = visibleChartSeriesIds.has(series.id); // NEW
                    button.setAttribute("aria-pressed", visible ? "true" : "false"); // NEW
                    button.setAttribute("aria-label", `${series.label}. ${series.help} Currently ${visible ? "shown" : "hidden"}.`); // NEW
                    button.title = `${series.label}: ${series.help} Click to ${visible ? "hide" : "show"}.`; // NEW
                } // NEW
            } // NEW

            function renderChartLegend() { // NEW
                chartLegend.innerHTML = ""; // NEW
                for (const series of PLAN_CHART_SERIES) { // NEW
                    const button = document.createElement("button"); // NEW
                    button.type = "button"; // NEW
                    button.className = "yp-chart-legend-item"; // NEW
                    button.dataset.seriesId = series.id; // NEW
                    const swatch = document.createElement("span"); // NEW
                    swatch.className = "yp-chart-legend-swatch"; // NEW
                    swatch.dataset.kind = series.kind; // NEW
                    swatch.setAttribute("aria-hidden", "true"); // NEW
                    swatch.style.setProperty("--yp-series-color", series.color); // NEW
                    swatch.style.setProperty("--yp-series-fill", series.fill || series.color); // NEW
                    const label = document.createElement("span"); // NEW
                    label.textContent = series.label; // NEW
                    button.appendChild(swatch); // NEW
                    button.appendChild(label); // NEW
                    button.addEventListener("click", () => { // NEW
                        if (visibleChartSeriesIds.has(series.id)) visibleChartSeriesIds.delete(series.id); // NEW
                        else visibleChartSeriesIds.add(series.id); // NEW
                        chartTooltip.style.display = "none"; // NEW
                        renderPlanCheck(); // CHANGE
                    }); // NEW
                    chartLegend.appendChild(button); // NEW
                } // NEW
                updateChartLegendState(); // NEW
            } // NEW

            function renderPlanCheck() { // CHANGE
                const cropId = String(plan.cropFilterId || ""); // NEW
                const chartModel = PlanMath.buildPlanChartModel(runtime.weekly, cropId); // NEW
                const chartSummary = PlanMath.summarizePlanChartModel(chartModel); // NEW
                const worstShortageText = chartSummary.worstShortageKg > 0 // NEW
                    ? `${formatKg(chartSummary.worstShortageKg)} \u00b7 Week of ${chartSummary.worstShortageWeek}` // NEW
                    : "-"; // NEW
                const planCheckSummaryText = `Target ${formatKg(chartSummary.targetKg)} | Harvested ${formatKg(chartSummary.harvestKg)} | Usable ${formatKg(chartSummary.usableSupplyKg)} | Short ${formatKg(chartSummary.shortKg)} | Expired ${formatKg(chartSummary.expiredKg)} | Worst shortage ${worstShortageText} | Short weeks ${chartSummary.shortWeeks}`; // CHANGE
                renderStripBox(planCheckBox, { // NEW
                    title: "Plan Check", // NEW
                    expanded: state.planCheckExpanded, // NEW
                    summaryText: planCheckSummaryText, // NEW
                    onToggle: () => { state.planCheckExpanded = !state.planCheckExpanded; renderPlanCheck(); }, // NEW
                    mountWhenCollapsed: true, // NEW
                    renderDetails: details => { details.appendChild(planCheckGrid); details.appendChild(diagnosticsBox); } // NEW
                }); // NEW
                if (!state.planCheckExpanded) chartTooltip.style.display = "none"; // CHANGE
                updateChartLegendState(); // NEW
                chartHiddenMessage.style.display = visibleChartSeriesIds.size === 0 ? "block" : "none"; // NEW
                chartHitModel = drawPlanChart(canvas, chartModel, visibleChartSeriesIds); // CHANGE
                const worstShortage = chartSummary.worstShortageKg > 0 // NEW
                    ? `${formatKg(chartSummary.worstShortageKg)} \u00b7 Week of ${mxUtils.htmlEntities(chartSummary.worstShortageWeek)}` // NEW
                    : "-"; // NEW
                planCheckSummary.innerHTML = [ // NEW
                    ["Target", formatKg(chartSummary.targetKg)], // NEW
                    ["Harvested", formatKg(chartSummary.harvestKg)], // NEW
                    ["Usable", formatKg(chartSummary.usableSupplyKg)], // NEW
                    ["Short", formatKg(chartSummary.shortKg)], // NEW
                    ["Expired", formatKg(chartSummary.expiredKg)], // NEW
                    ["Worst shortage", worstShortage], // NEW
                    ["Short weeks", String(chartSummary.shortWeeks)] // NEW
                ].map(([label, value]) => `<span><strong>${label}:</strong> ${value}</span>`).join(""); // NEW

                const rows = (plan.crops || []).map(crop => { // CHANGE
                    const summary = PlanMath.summarizePlanChartModel(PlanMath.buildPlanChartModel(runtime.weekly, String(crop.id))); // NEW
                    const metric = dashboard.cropMetricsById.get(String(crop.id)); // CHANGE
                    return `<tr><td>${mxUtils.htmlEntities(cropLabel(crop))}</td><td>${summary.targetKg.toFixed(1)}</td><td>${summary.harvestKg.toFixed(1)}</td><td>${summary.usableSupplyKg.toFixed(1)}</td><td>${summary.shortKg.toFixed(1)}</td><td>${summary.expiredKg.toFixed(1)}</td><td>${mxUtils.htmlEntities(metric ? metric.status : "Missing data")}</td></tr>`; // CHANGE
                }).join(""); // CHANGE
                totalsBox.innerHTML = `<div style="font-weight:700;margin-bottom:6px;">Plan Check totals</div><table style="width:100%;border-collapse:collapse;"><thead><tr><th>Crop</th><th>Target</th><th>Harvested</th><th>Usable</th><th>Short</th><th>Expired</th><th>Status</th></tr></thead><tbody>${rows || '<tr><td colspan="7">No crops.</td></tr>'}</tbody></table>`; // CHANGE
                for (const cell of totalsBox.querySelectorAll("th,td")) cell.style.cssText = "border:1px solid #ddd;padding:4px;text-align:left;"; // NEW
                diagnosticsBox.innerHTML = dashboard.diagnostics.length // NEW
                    ? `<div style="font-weight:700;margin-bottom:5px;">Plan Check</div><ul style="margin:0 0 0 18px;padding:0;">${dashboard.diagnostics.map(message => `<li>${mxUtils.htmlEntities(message)}</li>`).join("")}</ul>` // CHANGE
                    : '<div style="color:#256a36;font-weight:700;">Plan Check passed.</div>'; // CHANGE
            } // NEW

            function renderFooter() { // NEW
                const dirty = YearPlanDashboard.isDirty(state, plan); // NEW
                reset.textContent = loadedExistingForCurrentYear ? "Reset" : "Clear"; // NEW
                if (state.validationState === "invalid") footerStatus.textContent = "Validation failed"; // NEW
                else if (dirty) footerStatus.textContent = "Unsaved changes"; // NEW
                else if (state.lastSavedAt) footerStatus.textContent = `Last saved ${state.lastSavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`; // NEW
                else footerStatus.textContent = loadedExistingForCurrentYear ? "Loaded saved plan" : "New plan"; // CHANGE
                closePrompt.style.display = state.closePromptOpen ? "flex" : "none"; // NEW
                footerActions.style.display = state.closePromptOpen ? "none" : "flex"; // NEW
            } // NEW

            function captureDateRangeSnapshot() { // NEW
                const crop = selectedCrop(); // NEW
                const csa = plan && plan.csa ? plan.csa : {}; // NEW
                return { // NEW
                    csa: JSON.stringify({ // NEW
                        start: String(csa.start || ""), // NEW
                        end: String(csa.end || ""), // NEW
                        components: (Array.isArray(csa.components) ? csa.components : []).map(component => ({ // NEW
                            cropId: String(component && component.cropId || ""), // NEW
                            start: String(component && component.start || ""), // NEW
                            end: String(component && component.end || "") // NEW
                        })) // NEW
                    }), // NEW
                    selectedCropId: crop ? String(crop.id || "") : "", // NEW
                    market: JSON.stringify((crop && Array.isArray(crop.market) ? crop.market : []).map(line => ({ // NEW
                        from: String(line && line.from || ""), // NEW
                        to: String(line && line.to || "") // NEW
                    }))) // NEW
                }; // NEW
            } // NEW

            function refreshDerived(beforeDateRanges, renderOptions) { // CHANGE
                const options = renderOptions || {}; // NEW
                const beforeRecalculation = captureDateRangeSnapshot(); // NEW
                runtime = PlanRuntimeService.recalculate(moduleCell, currentYear, plan); // NEW
                const dirty = state.baselineSnapshot ? YearPlanDashboard.isDirty(state, plan) : false; // NEW
                dashboard = YearPlanDashboard.compute(plan, runtime, { dirty, extraDiagnostics: state.extraDiagnostics }); // NEW
                const expansionChanges = YearPlanDashboard.syncExpansionState(state, dashboard, PlanSchema.validateCsa(plan)); // NEW
                state.selectedCropId = YearPlanDashboard.resolveSelectedCropId(plan.crops, state.selectedCropId, 0); // NEW
                const afterRecalculation = captureDateRangeSnapshot(); // NEW
                const comparisonSnapshot = beforeDateRanges || beforeRecalculation; // NEW
                const csaDatesChanged = comparisonSnapshot.csa !== afterRecalculation.csa // NEW
                    || beforeRecalculation.csa !== afterRecalculation.csa; // NEW
                const demandDatesChanged = comparisonSnapshot.selectedCropId !== afterRecalculation.selectedCropId // NEW
                    || comparisonSnapshot.market !== afterRecalculation.market // NEW
                    || beforeRecalculation.selectedCropId !== afterRecalculation.selectedCropId // NEW
                    || beforeRecalculation.market !== afterRecalculation.market; // NEW
                renderSummary(); // NEW
                renderCropList(); // NEW
                renderCsa(!!options.rebuildCsa || expansionChanges.csaChanged || (state.csaExpanded && csaDatesChanged)); // CHANGE
                renderDemandStrip(!!options.rebuildDemand || (state.demandExpanded && demandDatesChanged)); // NEW
                renderCropPlan(false); // NEW
                renderPlanCheck(); // CHANGE
                renderFooter(); // NEW
                syncEditorDerived(); // NEW
                syncDemandDerived(); // NEW
                return runtime; // NEW
            } // NEW

            async function getVarietyRows(plantId) { // NEW
                const key = String(plantId || ""); // NEW
                let rows = varietyCache.get(key); // NEW
                if (!rows) { // NEW
                    rows = await DbClient.queryVarietiesByPlantId(key); // NEW
                    varietyCache.set(key, rows); // NEW
                } // NEW
                return rows; // NEW
            } // NEW

            async function loadVarieties(crop, select) { // NEW
                const key = String(crop.plantId || ""); // NEW
                select.disabled = true; // NEW
                try { // NEW
                    const rows = await getVarietyRows(key); // CHANGE
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
                syncLabel.className = "yp-row"; syncLabel.appendChild(syncAvailability); syncLabel.appendChild(document.createTextNode("Sync demand to harvest window")); // CHANGE
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
                        state.planCheckExpanded = true; // CHANGE
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
                    loadAddCropOptions(false); // NEW
                }); // NEW
                addVariety.addEventListener("click", () => { // NEW
                    graph.fireEvent(new mxEventObject("usl:openVarietyEditor", "cropId", String(crop.id), "plantId", Number(crop.plantId), "varietyId", crop.varietyId == null ? null : Number(crop.varietyId))); // NEW
                }); // NEW
                kg.addEventListener("input", () => { crop.kgPerPlant = Number(kg.value); crop.kgPerPlantMode = "manual"; debounceRefresh(); }); // NEW
                germ.addEventListener("input", () => { crop.germRate = Math.max(0.01, Math.min(1, Number(germ.value) || 1)); debounceRefresh(); }); // NEW
                useActual.addEventListener("change", () => { crop.useActualHarvest = useActual.checked; harvestStart.disabled = harvestEnd.disabled = useActual.checked; refreshDerived(); }); // NEW
                syncAvailability.addEventListener("change", () => { // NEW
                    const beforeDateRanges = captureDateRangeSnapshot(); // NEW
                    crop.syncharvest = syncAvailability.checked; // NEW
                    if (crop.syncharvest) { // CHANGE
                        const before = { hs: crop.harvestStart, he: crop.harvestEnd, availEnd: crop.harvestEnd }; // NEW
                        PlanRuntimeService.syncCropDatesIfEnabled(plan, crop, before); // NEW
                    } // NEW
                    refreshDerived(beforeDateRanges); // CHANGE
                }); // NEW
                bindPairedDateControls(harvestStart, harvestEnd, { // CHANGE
                    diagnostic: `Harvest start date cannot be after end date for "${crop.plant || crop.id}".`, // NEW
                    setStart: value => { crop.harvestStart = value; }, // NEW
                    setEnd: value => { crop.harvestEnd = value; }, // NEW
                    afterCommit: (beforeDateRanges, previousPair) => { // NEW
                        PlanRuntimeService.syncCropDatesIfEnabled(plan, crop, { // NEW
                            hs: previousPair.start, // NEW
                            he: previousPair.end, // NEW
                            availEnd: previousPair.end // NEW
                        }); // NEW
                        refreshDerived(beforeDateRanges); // NEW
                    } // NEW
                }); // CHANGE
                shelf.addEventListener("input", () => { // NEW
                    crop.shelfLifeDays = Math.max(0, Math.trunc(Number(shelf.value) || 0)); // NEW
                    debounceRefresh(); // NEW
                }); // NEW
            } // NEW

            function renderDemand(crop, content) { // NEW
                const summary = document.createElement("div"); // NEW
                summary.style.cssText = "padding:8px;border:1px solid #ddd;border-radius:6px;background:#fafafa;font-weight:700;margin-bottom:10px;"; // NEW
                content.appendChild(summary); // NEW
                demandRefs.summary = summary; // CHANGE
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
                        bindPairedDateControls(from, to, { // CHANGE
                            diagnostic: `Market start date cannot be after end date for "${crop.plant || crop.id}".`, // NEW
                            setStart: value => { line.from = value; }, // NEW
                            setEnd: value => { line.to = value; } // NEW
                        }); // CHANGE
                        remove.addEventListener("click", () => { crop.market = crop.market.filter(item => item !== line); renderRows(); refreshDerived(); }); // NEW
                    } // NEW
                } // NEW

                add.addEventListener("click", () => { // NEW
                    const line = { qty: 0, unit: defaultUnit(crop), from: crop.harvestStart || "", to: crop.harvestEnd || "" }; // NEW
                    crop.market.push(line); // NEW
                    renderRows(); // NEW
                    refreshDerived(); // NEW
                }); // NEW
                renderRows(); // NEW
            } // NEW

            function renderDemandStrip(rebuildDetails) { // NEW
                const crop = selectedCrop(); // NEW
                const metric = crop && dashboard ? dashboard.cropMetricsById.get(String(crop.id)) : null; // NEW
                const lineCount = crop && Array.isArray(crop.market) ? crop.market.length : 0; // NEW
                const summaryText = crop // NEW
                    ? `${cropLabel(crop)} | ${lineCount} demand line${lineCount === 1 ? "" : "s"} | Target ${formatKg(metric ? metric.targetKg : 0)}` // NEW
                    : "No crop selected"; // NEW
                renderStripBox(demandBox, { // NEW
                    title: "Demand", // NEW
                    expanded: state.demandExpanded, // NEW
                    summaryText, // NEW
                    rebuildDetails: !!rebuildDetails, // NEW
                    onToggle: () => { // NEW
                        state.demandExpanded = !state.demandExpanded; // NEW
                        renderDemandStrip(state.demandExpanded); // NEW
                        syncDemandDerived(); // NEW
                    }, // NEW
                    renderDetails: details => { // NEW
                        demandRefs = {}; // NEW
                        if (crop) renderDemand(crop, details); // NEW
                        else { // NEW
                            const empty = document.createElement("div"); // NEW
                            empty.style.cssText = "padding:12px;color:#666;text-align:center;"; // NEW
                            empty.textContent = "Add or select a crop in Crop Plan to edit demand."; // NEW
                            details.appendChild(empty); // NEW
                        } // NEW
                    } // NEW
                }); // NEW
            } // NEW

            function renderCropPlan(rebuildDetails) { // NEW
                const crop = selectedCrop(); // NEW
                const cropCount = Array.isArray(plan.crops) ? plan.crops.length : 0; // NEW
                const summaryText = `${cropCount} crop${cropCount === 1 ? "" : "s"}${crop ? ` | Selected ${cropLabel(crop)}` : " | No crop selected"}`; // NEW
                renderStripBox(cropPlanBox, { // NEW
                    title: "Crop Plan", // NEW
                    expanded: state.cropPlanExpanded, // NEW
                    summaryText, // NEW
                    rebuildDetails: !!rebuildDetails, // NEW
                    onToggle: () => { state.cropPlanExpanded = !state.cropPlanExpanded; renderCropPlan(false); }, // NEW
                    renderDetails: details => { details.appendChild(addRow); details.appendChild(dashboardGrid); } // NEW
                }); // NEW
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
                        unit.addEventListener("input", () => { pkg.unit = unit.value; debounceRefresh({ rebuildDemand: true, rebuildCsa: true }); }); // CHANGE
                        baseQty.addEventListener("input", () => { pkg.baseQty = Math.max(0, Number(baseQty.value) || 0); debounceRefresh(); }); // NEW
                        baseType.addEventListener("change", () => { pkg.baseType = baseType.value; refreshDerived(); }); // NEW
                        price.addEventListener("input", () => { pkg.price = price.value === "" ? NaN : Math.max(0, Number(price.value) || 0); renderFooter(); }); // NEW
                        remove.addEventListener("click", () => { crop.packages = crop.packages.filter(item => item !== pkg); renderRows(); refreshDerived(null, { rebuildDemand: true, rebuildCsa: true }); }); // CHANGE
                    } // NEW
                } // NEW

                add.addEventListener("click", () => { crop.packages.push({ unit: "kg", baseType: "kg", baseQty: 1, price: NaN }); renderRows(); refreshDerived(null, { rebuildDemand: true, rebuildCsa: true }); }); // CHANGE
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
                for (const tab of [{ id: "basics", label: "Basics" }, { id: "packages", label: "Packages" }, { id: "advanced", label: "Advanced" }]) { // CHANGE
                    const button = mkBtn(tab.label, state.activeTab === tab.id); // NEW
                    button.addEventListener("click", () => { state.activeTab = tab.id; renderSelectedEditor(); syncEditorDerived(); }); // NEW
                    tabs.appendChild(button); // NEW
                } // NEW
                editorBox.appendChild(head); editorBox.appendChild(tabs); editorBox.appendChild(content); // NEW
                if (state.activeTab === "packages") renderPackages(crop, content); // CHANGE
                else if (state.activeTab === "advanced") renderAdvanced(crop, content); // NEW
                else renderBasics(crop, content); // NEW
                remove.addEventListener("click", () => { // NEW
                    const index = plan.crops.indexOf(crop); // NEW
                    plan.crops = plan.crops.filter(item => item !== crop); // NEW
                    if (plan.csa && Array.isArray(plan.csa.components)) plan.csa.components = plan.csa.components.filter(component => component.cropId !== crop.id); // NEW
                    state.selectedCropId = YearPlanDashboard.resolveSelectedCropId(plan.crops, "", index); // NEW
                    renderSelectedEditor(); fillCropFilter(); refreshDerived(null, { rebuildCsa: true, rebuildDemand: true }); loadAddCropOptions(false); // CHANGE
                }); // NEW
                syncEditorDerived(); // NEW
            } // NEW

            function renderCsa(rebuildDetails) { // CHANGE
                plan.csa = plan.csa || { enabled: false, boxesPerWeek: 0, start: "", end: "", components: [] }; // NEW
                const summaryText = YearPlanDashboard.buildCsaSummary(plan).replace(/^CSA Box Plan:\s*/, ""); // NEW
                renderStripBox(csaBox, { // NEW
                    title: "CSA", // NEW
                    expanded: state.csaExpanded, // NEW
                    summaryText, // NEW
                    rebuildDetails: !!rebuildDetails && state.csaExpanded, // NEW
                    onToggle: () => { state.csaExpanded = !state.csaExpanded; renderCsa(state.csaExpanded); }, // NEW
                    renderDetails: renderCsaDetails // NEW
                }); // NEW
            } // NEW

            function renderCsaDetails(details) { // NEW
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
                details.appendChild(controls); details.appendChild(rowsHost); details.appendChild(add); // CHANGE
                const refreshSummary = () => { renderCsa(false); }; // CHANGE
                const syncNonDateControls = () => { plan.csa.enabled = enabled.checked; plan.csa.boxesPerWeek = Math.max(0, Math.trunc(Number(boxes.value) || 0)); refreshSummary(); debounceRefresh(); }; // CHANGE
                enabled.addEventListener("change", syncNonDateControls); // CHANGE
                boxes.addEventListener("input", syncNonDateControls); // CHANGE
                bindPairedDateControls(start, end, { // CHANGE
                    diagnostic: "CSA start date cannot be after end date.", // NEW
                    setStart: value => { plan.csa.start = value; }, // NEW
                    setEnd: value => { plan.csa.end = value; }, // NEW
                    afterCommit: beforeDateRanges => { refreshSummary(); refreshDerived(beforeDateRanges); } // NEW
                }); // CHANGE

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
                        bindPairedDateControls(from, to, { // CHANGE
                            diagnostic: `CSA component start date cannot be after end date for "${crop ? crop.plant || crop.id : component.cropId}".`, // NEW
                            setStart: value => { component.start = value; }, // NEW
                            setEnd: value => { component.end = value; } // NEW
                        }); // CHANGE
                        remove.addEventListener("click", () => { plan.csa.components = plan.csa.components.filter(item => item !== component); renderRows(); refreshSummary(); refreshDerived(); }); // CHANGE
                    } // NEW
                } // NEW
                add.addEventListener("click", () => { // NEW
                    const crop = plan.crops && plan.crops[0]; // NEW
                    plan.csa.components.push({ cropId: crop ? crop.id : "", qty: 1, unit: defaultUnit(crop), everyNWeeks: 1, start: plan.csa.start || "", end: plan.csa.end || "" }); // NEW
                    state.csaExpanded = true; // NEW
                    renderRows(); refreshSummary(); refreshDerived(); // CHANGE
                }); // NEW
                renderRows(); // NEW
            } // NEW

            function renderAll() { // NEW
                fillCropFilter(); // NEW
                renderSelectedEditor(); // NEW
                renderCropPlan(true); // NEW
                refreshDerived(null, { rebuildCsa: true, rebuildDemand: true }); // CHANGE
                loadAddCropOptions(false); // NEW
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
                    state.planCheckExpanded = true; // CHANGE
                    if (PlanSchema.validateCsa(plan).length) state.csaExpanded = true; // NEW
                    renderCsa(true); renderPlanCheck(); renderFooter(); // CHANGE
                    return false; // NEW
                } // NEW
                persistPackageDefaults(); // NEW
                PlanRepository.savePlanForYear(moduleCell, currentYear, plan); // NEW
                loadedExistingForCurrentYear = true; // NEW
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
            const templateNameInput = mkInput("text", "", 170); // NEW
            templateNameInput.placeholder = "Template name"; // NEW
            const applyTemplate = mkBtn("Apply"); // NEW
            const saveTemplate = mkBtn("Save template"); // NEW
            const deleteTemplate = mkBtn("Delete template"); // NEW
            titleEl.textContent = `Plan Year - ${currentYear}`; // NEW
            headerControls.appendChild(document.createTextNode("Year")); headerControls.appendChild(yearInput); headerControls.appendChild(document.createTextNode("Template")); headerControls.appendChild(templateSel); headerControls.appendChild(templateNameInput); headerControls.appendChild(applyTemplate); headerControls.appendChild(saveTemplate); headerControls.appendChild(deleteTemplate); // CHANGE
            header.appendChild(titleEl); header.appendChild(headerControls); // NEW
            fillTemplateDropdown(); // NEW
            saveTemplate.disabled = true; // NEW

            const plantSelect = document.createElement("select"); // NEW
            plantSelect.style.cssText = "padding:6px;border:1px solid #bbb;border-radius:6px;min-width:260px;flex:1 1 260px;"; // NEW
            const addCrop = mkBtn("Add crop", true); // NEW
            const reloadPlants = mkBtn("Reload crops"); // CHANGE
            const plantMessage = document.createElement("span"); // NEW
            plantMessage.style.color = "#666"; // NEW
            addRow.appendChild(plantSelect); addRow.appendChild(addCrop); addRow.appendChild(reloadPlants); addRow.appendChild(plantMessage); // NEW

            const save = mkBtn("Save", true); // NEW
            const saveClose = mkBtn("Save & Close"); // NEW
            const exportButton = mkBtn("Export"); // NEW
            const reset = mkBtn(loadedExistingForCurrentYear ? "Reset" : "Clear"); // CHANGE
            const close = mkBtn("Close"); // NEW
            footerActions.appendChild(save); footerActions.appendChild(saveClose); footerActions.appendChild(exportButton); footerActions.appendChild(reset); footerActions.appendChild(close); // NEW
            const promptSave = mkBtn("Save and Close", true); // NEW
            const promptDiscard = mkBtn("Discard"); // NEW
            const promptCancel = mkBtn("Cancel"); // NEW
            closePrompt.appendChild(promptSave); closePrompt.appendChild(promptDiscard); closePrompt.appendChild(promptCancel); // NEW

            function appendAddCropOptionGroup(label, options) { // NEW
                if (!options.length) return; // NEW
                const group = document.createElement("optgroup"); // NEW
                group.label = label; // NEW
                for (const option of options) { // NEW
                    const optionId = Env.uid("addcrop"); // NEW
                    addCropOptionById.set(optionId, option); // NEW
                    const element = document.createElement("option"); // NEW
                    element.value = optionId; // NEW
                    element.textContent = option.label; // NEW
                    group.appendChild(element); // NEW
                } // NEW
                plantSelect.appendChild(group); // NEW
            } // NEW

            function getPlantLifecycle(row) { // NEW
                const enabled = [ // NEW
                    ["annual", Number(row && row.annual) === 1], // NEW
                    ["biennial", Number(row && row.biennial) === 1], // NEW
                    ["perennial", Number(row && row.perennial) === 1] // NEW
                ].filter(item => item[1]); // NEW
                return enabled.length === 1 ? enabled[0][0] : "uncategorized"; // NEW
            } // NEW

            function parseVarietyOverrideYield(varietyRow) { // NEW
                const overrides = varietyRow ? Env.safeJsonStringParse(varietyRow.overrides_json, null) : null; // NEW
                const value = Number(overrides && (overrides.yield_per_plant_kg ?? overrides.overrides?.yield_per_plant_kg)); // NEW
                return Number.isFinite(value) && value > 0 ? value : NaN; // NEW
            } // NEW

            async function resolveGardenCropOption(candidate, plantRowsById) { // NEW
                const plantId = String(candidate && candidate.plantId || ""); // NEW
                const row = plantRowsById.get(plantId); // NEW
                if (!row) return null; // NEW
                let varietyId = candidate && candidate.varietyId ? String(candidate.varietyId) : ""; // NEW
                let varietyName = String(candidate && candidate.varietyName || "").trim(); // NEW
                let varietyRow = null; // NEW

                if (varietyId || varietyName) { // NEW
                    const varietyRows = await getVarietyRows(plantId); // NEW
                    if (varietyId) { // NEW
                        varietyRow = varietyRows.find(item => String(item.variety_id) === varietyId) || null; // NEW
                        if (!varietyName && varietyRow) varietyName = String(varietyRow.variety_name || "").trim(); // NEW
                    } else { // NEW
                        const normalizedName = varietyName.toLocaleLowerCase(); // NEW
                        const matches = varietyRows.filter(item => String(item.variety_name || "").trim().toLocaleLowerCase() === normalizedName); // NEW
                        if (matches.length !== 1) return null; // NEW
                        varietyRow = matches[0]; // NEW
                        varietyId = String(varietyRow.variety_id); // NEW
                        varietyName = String(varietyRow.variety_name || varietyName).trim(); // NEW
                    } // NEW
                } // NEW

                const plantName = String(row.plant_name || candidate.plantName || "").trim(); // NEW
                return { // NEW
                    source: "garden", // NEW
                    plantId, // NEW
                    plantName, // NEW
                    varietyId: varietyId || null, // NEW
                    varietyName, // NEW
                    varietyRow, // NEW
                    row, // NEW
                    lifecycle: getPlantLifecycle(row), // NEW
                    label: varietyName ? `${plantName} - ${varietyName}` : plantName // NEW
                }; // NEW
            } // NEW

            async function loadAddCropOptions(force) { // NEW
                const loadVersion = ++addCropOptionsLoadVersion; // NEW
                plantSelect.disabled = true; // NEW
                addCrop.disabled = true; // NEW
                reloadPlants.disabled = true; // NEW
                addCropOptionById.clear(); // NEW
                plantSelect.innerHTML = ""; // NEW
                plantSelect.appendChild(new Option("-- Select crop --", "")); // CHANGE
                plantMessage.textContent = "Loading crops..."; // CHANGE
                try { // NEW
                    if (force) { // NEW
                        DbClient.invalidatePlantsBasicCache(); // NEW
                        varietyCache.clear(); // NEW
                    } // NEW
                    const plants = await DbClient.getPlantsBasicCached(); // NEW
                    const plantRowsById = new Map(plants.map(row => [String(row.plant_id), row])); // NEW
                    const plannedKeys = new Set((plan.crops || []).map(crop => PlanSchema.getCropIdentityKey(crop)).filter(Boolean)); // NEW
                    const gardenOptions = []; // NEW
                    const gardenKeys = new Set(); // NEW
                    let skippedGardenCount = 0; // NEW

                    for (const candidate of DiagramPlanReader.readGardenCropCandidates(moduleCell)) { // NEW
                        const option = await resolveGardenCropOption(candidate, plantRowsById); // NEW
                        if (!option) { skippedGardenCount += 1; continue; } // NEW
                        const key = PlanSchema.makeCropIdentityKey(option.plantId, option.varietyId || ""); // NEW
                        if (!key || plannedKeys.has(key) || gardenKeys.has(key)) continue; // NEW
                        gardenKeys.add(key); // NEW
                        gardenOptions.push(option); // NEW
                    } // NEW

                    if (!SessionController.isActive(session) || loadVersion !== addCropOptionsLoadVersion) return; // NEW
                    const byLifecycle = { annual: [], biennial: [], perennial: [], uncategorized: [] }; // NEW
                    for (const row of plants) { // NEW
                        const plantId = String(row.plant_id); // NEW
                        const key = PlanSchema.makeCropIdentityKey(plantId, ""); // NEW
                        if (!key || plannedKeys.has(key) || gardenKeys.has(key)) continue; // NEW
                        const plantName = String(row.plant_name || "").trim(); // NEW
                        const lifecycle = getPlantLifecycle(row); // NEW
                        byLifecycle[lifecycle].push({ // NEW
                            source: "database", // NEW
                            plantId, // NEW
                            plantName, // NEW
                            varietyId: null, // NEW
                            varietyName: "", // NEW
                            varietyRow: null, // NEW
                            row, // NEW
                            lifecycle, // NEW
                            label: plantName // NEW
                        }); // NEW
                    } // NEW

                    const sortOptions = options => options.sort((a, b) => a.label.localeCompare(b.label)); // NEW
                    plantSelect.innerHTML = ""; // NEW
                    plantSelect.appendChild(new Option("-- Select crop --", "")); // NEW
                    addCropOptionById.clear(); // NEW
                    appendAddCropOptionGroup("Crops in this garden, not yet in plan", sortOptions(gardenOptions)); // NEW
                    appendAddCropOptionGroup("Annual crops", sortOptions(byLifecycle.annual)); // NEW
                    appendAddCropOptionGroup("Biennial crops", sortOptions(byLifecycle.biennial)); // NEW
                    appendAddCropOptionGroup("Perennial crops", sortOptions(byLifecycle.perennial)); // NEW
                    appendAddCropOptionGroup("Uncategorized crops", sortOptions(byLifecycle.uncategorized)); // NEW
                    plantMessage.textContent = skippedGardenCount // NEW
                        ? `Skipped ${skippedGardenCount} unavailable garden crop${skippedGardenCount === 1 ? "" : "s"}.` // NEW
                        : ""; // NEW
                } catch (error) { // NEW
                    if (SessionController.isActive(session) && loadVersion === addCropOptionsLoadVersion) { // NEW
                        addCropOptionById.clear(); // NEW
                        plantMessage.textContent = String(error && error.message || error); // NEW
                    } // NEW
                } finally { // NEW
                    if (SessionController.isActive(session) && loadVersion === addCropOptionsLoadVersion) { // NEW
                        plantSelect.disabled = false; // NEW
                        addCrop.disabled = false; // NEW
                        reloadPlants.disabled = false; // NEW
                    } // NEW
                } // NEW
            } // NEW

            addCrop.addEventListener("click", () => { // CHANGE
                const selectedOption = addCropOptionById.get(String(plantSelect.value || "")); // NEW
                if (!selectedOption) return; // NEW
                if (PlanSchema.findDuplicateCrop(plan, selectedOption.plantId, selectedOption.varietyId || "", "")) { // CHANGE
                    state.extraDiagnostics = [`Crop already exists for ${selectedOption.label}.`]; // CHANGE
                    state.planCheckExpanded = true; // CHANGE
                    refreshDerived(); // NEW
                    return; // NEW
                } // NEW
                state.extraDiagnostics = []; // NEW
                const plantId = selectedOption.plantId; // NEW
                const item = selectedOption.row; // NEW
                const defaults = PlanRepository.getDefaultsForPlant(plantId); // NEW
                const baseYield = Number(item.yield_per_plant_kg); // NEW
                const overrideYield = parseVarietyOverrideYield(selectedOption.varietyRow); // NEW
                const cropYield = Number.isFinite(overrideYield) ? overrideYield : baseYield; // NEW
                const numericVarietyId = selectedOption.varietyId == null ? NaN : Number(selectedOption.varietyId); // NEW
                const crop = { // NEW
                    id: Env.uid("crop"), plantId, plant: selectedOption.plantName, method: String(item.default_planting_method || "").trim() || "direct_sow", // CHANGE
                    varietyId: selectedOption.varietyId == null ? null : (Number.isFinite(numericVarietyId) ? numericVarietyId : selectedOption.varietyId), variety: selectedOption.varietyName, harvestStart: "", harvestEnd: "", useActualHarvest: true, syncharvest: false, // CHANGE
                    shelfLifeDays: 0, baseKgPerPlant: baseYield, kgPerPlant: cropYield, // CHANGE
                    kgPerPlantMode: "auto", actualPlants: 0, germRate: 1,
                    packages: defaults && defaults.length ? PlanSchema.clonePlain(defaults) : [{ unit: "kg", baseType: "kg", baseQty: 1, price: NaN }],
                    market: []
                }; // NEW
                plan.crops.push(crop); // NEW
                state.selectedCropId = crop.id; state.activeTab = "basics"; // NEW
                emitHarvestWindowsNeeded(crop); // NEW
                renderAll(); // NEW
            }); // NEW
            reloadPlants.addEventListener("click", () => loadAddCropOptions(true)); // CHANGE

            yearInput.addEventListener("change", () => { // NEW
                const nextYear = Number(yearInput.value); // NEW
                if (!Number.isFinite(nextYear) || nextYear < 1900 || nextYear > 3000) { yearInput.value = String(currentYear); return; } // NEW
                if (nextYear === currentYear) return; // NEW
                if (!saveCurrent(false)) { yearInput.value = String(currentYear); return; } // NEW
                const nextExisting = PlanRepository.loadPlanForYear(moduleCell, nextYear); // NEW
                replacePlan(nextExisting || PlanSchema.createEmptyPlan(nextYear), nextYear, !!nextExisting); // CHANGE
                renderAll(); // NEW
                YearPlanDashboard.markBaseline(state, plan, null); // NEW
                refreshDerived(); // NEW
            }); // NEW
            applyTemplate.addEventListener("click", () => { // NEW
                const name = String(templateSel.value || ""); // NEW
                const template = name && PlanRepository.loadTemplateByName(name); // NEW
                if (!template) return; // NEW
                replacePlan(PlanRepository.rekeyTemplateToPlan(template, currentYear), currentYear, loadedExistingForCurrentYear); // CHANGE
                renderAll(); // NEW
            }); // NEW
            templateSel.addEventListener("change", () => { // NEW
                templateNameInput.value = String(templateSel.value || ""); // NEW
                saveTemplate.disabled = !templateNameInput.value.trim(); // NEW
            }); // NEW
            templateNameInput.addEventListener("input", () => { saveTemplate.disabled = !templateNameInput.value.trim(); }); // NEW
            saveTemplate.addEventListener("click", () => { // NEW
                const name = String(templateNameInput.value || "").trim(); // CHANGE
                if (!name) return; // NEW
                const template = PlanSchema.serializeForPersistence(plan, { forTemplate: true }); // NEW
                template.templateBaseYear = currentYear; template.year = null; // NEW
                PlanRepository.saveTemplateByName(name, template); fillTemplateDropdown(); templateSel.value = name; templateNameInput.value = name; saveTemplate.disabled = false; // CHANGE
            }); // NEW
            deleteTemplate.addEventListener("click", () => { // NEW
                const name = String(templateSel.value || ""); // NEW
                if (!name || !confirm(`Delete template "${name}"?`)) return; // NEW
                PlanRepository.deleteTemplateByName(name); fillTemplateDropdown(); templateNameInput.value = ""; saveTemplate.disabled = true; // CHANGE
            }); // NEW
            cropFilterSel.addEventListener("change", () => { plan.cropFilterId = cropFilterSel.value; renderPlanCheck(); renderFooter(); }); // CHANGE
            canvas.addEventListener("mousemove", event => { // NEW
                if (!chartHitModel || !chartHitModel.weekCenters.length) return; // NEW
                const canvasRect = canvas.getBoundingClientRect(); // NEW
                const chartRect = chartBox.getBoundingClientRect(); // NEW
                const canvasX = (event.clientX - canvasRect.left) * (canvas.width / Math.max(1, canvasRect.width)); // NEW
                if (canvasX < chartHitModel.plotLeft || canvasX > chartHitModel.plotRight) { // NEW
                    chartTooltip.style.display = "none"; // NEW
                    return; // NEW
                } // NEW
                const index = Math.max(0, Math.min( // NEW
                    chartHitModel.rows.length - 1, // NEW
                    Math.floor((canvasX - chartHitModel.plotLeft) / chartHitModel.step) // NEW
                )); // NEW
                const row = chartHitModel.rows[index]; // NEW
                if (!row) return; // NEW
                const tooltipLines = [`<strong>Week of ${mxUtils.htmlEntities(row.week)}</strong>`]; // CHANGE
                for (const series of PLAN_CHART_SERIES) { // NEW
                    if (visibleChartSeriesIds.has(series.id)) tooltipLines.push(`${series.tooltipLabel}: ${formatKg(row[series.field])}`); // NEW
                } // NEW
                tooltipLines.push(`Inventory: ${formatKg(row.endingInventoryKg)}`); // NEW
                chartTooltip.innerHTML = tooltipLines.join("<br>"); // CHANGE
                const maximumLeft = Math.max(4, chartBox.clientWidth - 190); // NEW
                chartTooltip.style.left = `${Math.max(4, Math.min(maximumLeft, event.clientX - chartRect.left + 12))}px`; // CHANGE
                chartTooltip.style.top = `${Math.max(35, event.clientY - chartRect.top - 18)}px`; // NEW
                chartTooltip.style.display = "block"; // NEW
            }); // NEW
            canvas.addEventListener("mouseleave", () => { chartTooltip.style.display = "none"; }); // NEW
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
                replacePlan(PlanSchema.createEmptyPlan(currentYear), currentYear, false); // CHANGE
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
                const beforeDateRanges = captureDateRangeSnapshot(); // NEW
                const byId = new Map((plan.crops || []).map(crop => [String(crop.id), crop])); // NEW
                for (const result of (detail.results || [])) { // NEW
                    const crop = byId.get(String(result.cropId)); // NEW
                    if (!crop) continue; // NEW
                    if (!PlanMath.hasYmd(crop.harvestStart) && PlanMath.hasYmd(result.harvestStart)) crop.harvestStart = result.harvestStart; // NEW
                    if (!PlanMath.hasYmd(crop.harvestEnd) && PlanMath.hasYmd(result.harvestEnd)) crop.harvestEnd = result.harvestEnd; // NEW
                    if (!(Number(crop.shelfLifeDays) > 0) && Number(result.shelfLifeDays) > 0) crop.shelfLifeDays = Math.trunc(Number(result.shelfLifeDays)); // NEW
                } // NEW
                refreshDerived(beforeDateRanges); // CHANGE
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
                loadAddCropOptions(false); // NEW
            }); // NEW

            renderChartLegend(); // NEW
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
            DbClient, // NEW
            PlanMath,
            PlanSchema,
            PlanRepository,
            DiagramPlanReader,
            PlanRuntimeService,
            YearPlanDashboard, // NEW
            YearPlanModalController, // NEW
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
