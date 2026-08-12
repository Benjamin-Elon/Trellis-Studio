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
    const PLAN_METADATA_CELL_ATTR = "usl_year_planner_metadata";
    const EPS = 0.0001;
    const TRELLIS_DIALOG_Z = 2000000000;
    const EMPTY_PLAN_SAVE_MESSAGE = "Add at least one crop to the year plan before saving."; // CHANGE: empty plans can be edited but not persisted.
    const __YP_GLOBAL = window.__uslYearPlannerGlobal || (window.__uslYearPlannerGlobal = {});

    function installTrellisInteractionModeController() {
        window.Trellis = window.Trellis || {};
        if (window.Trellis.interactionModes && window.Trellis.interactionModes.__trellisInteractionModeController) return window.Trellis.interactionModes;

        let active = null;

        function normalizeId(value) {
            return String(value || "").trim();
        }

        function dispatchChanged(previous, next) {
            if (!window.dispatchEvent) return;
            try {
                window.dispatchEvent(new CustomEvent("trellisInteractionModeChanged", {
                    detail: {
                        previousMode: previous && previous.mode || "",
                        activeMode: next && next.mode || "",
                        ownerId: next && next.ownerId || ""
                    }
                }));
            } catch (_) { }
        }

        function closeActive(reason) {
            const previous = active;
            if (!previous) return false;
            active = null;
            try {
                if (previous.hooks && typeof previous.hooks.close === "function") previous.hooks.close({ reason: reason || "closed" });
            } finally {
                dispatchChanged(previous, null);
            }
            return true;
        }

        const api = {
            __trellisInteractionModeController: true,
            request(mode, ownerId, hooks) {
                const nextMode = normalizeId(mode);
                const nextOwner = normalizeId(ownerId) || nextMode;
                if (!nextMode) throw new Error("Interaction mode requires a mode id.");
                if (active && active.mode === nextMode && active.ownerId === nextOwner) {
                    active.hooks = hooks || {};
                    return { mode: active.mode, ownerId: active.ownerId };
                }
                const previous = active;
                if (previous) closeActive("replaced");
                active = { mode: nextMode, ownerId: nextOwner, hooks: hooks || {} };
                dispatchChanged(previous, active);
                return { mode: active.mode, ownerId: active.ownerId };
            },
            release(mode, ownerId, reason) {
                const requestedMode = normalizeId(mode);
                const requestedOwner = normalizeId(ownerId) || requestedMode;
                if (!active || active.mode !== requestedMode || active.ownerId !== requestedOwner) return false;
                return closeActive(reason || "released");
            },
            closeActive,
            getActive() {
                return active ? { mode: active.mode, ownerId: active.ownerId } : null;
            },
            isActive(mode, ownerId) {
                if (!active) return false;
                const requestedMode = normalizeId(mode);
                const requestedOwner = normalizeId(ownerId);
                if (requestedMode && active.mode !== requestedMode) return false;
                if (requestedOwner && active.ownerId !== requestedOwner) return false;
                return true;
            }
        };
        window.Trellis.interactionModes = api;
        return api;
    }

    installTrellisInteractionModeController();

    // -------------------- SessionController --------------------
    /**
     * Owns the single active modal session and all listener/DOM cleanup attached to it.
     */
    const SessionController = (() => {
        let activeSession = null;

        function safeDispose(fn) {
            try { fn && fn(); } catch (_) { }
        }

        function close() {
            const session = activeSession;
            if (!session) return;

            const disposers = Array.isArray(session.disposers) ? session.disposers.slice().reverse() : [];
            session.disposers = [];
            for (const dispose of disposers) safeDispose(dispose);

            if (session.ui && session.ui.modalEl) {
                try { session.ui.modalEl.remove(); } catch (_) { }
                session.ui.modalEl = null;
            }

            activeSession = null;
        }

        function start(moduleCell, year, plan) {
            close();
            const moduleCellId = String(moduleCell?.getId ? moduleCell.getId() : moduleCell?.id || "");
            activeSession = {
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
            return activeSession;
        }

        function isActive(session) {
            return activeSession === session;
        }

        function addWindowListener(session, type, handler, opts) {
            window.addEventListener(type, handler, opts);
            session.disposers.push(() => window.removeEventListener(type, handler, opts));
        }

        function addGraphListener(session, targetGraph, eventName, handler) {
            targetGraph.addListener(eventName, handler);
            session.disposers.push(() => { try { targetGraph.removeListener(handler); } catch (_) { } });
        }

        return { start, close, isActive, addWindowListener, addGraphListener };
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
                PLAN_METADATA_CELL_ATTR
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

    // -------------------- YearPlanCollapsePreferences --------------------
    const YearPlanCollapsePreferences = (() => {
        const STORAGE_PREFIX = "trellis.yearPlanner.collapse.v1";

        function storage() {
            try { return typeof window !== "undefined" && window.localStorage ? window.localStorage : null; } catch (_) { return null; }
        }

        function moduleCellId(moduleCell) {
            return String(moduleCell && (moduleCell.getId ? moduleCell.getId() : moduleCell.id) || "");
        }

        function storageKey(moduleCell, year) {
            return `${STORAGE_PREFIX}:${moduleCellId(moduleCell)}:${Number(year) || ""}`;
        }

        function normalizeIdList(value) {
            return Array.isArray(value)
                ? Array.from(new Set(value.map(item => String(item || "").trim()).filter(Boolean)))
                : [];
        }

        function normalize(record) {
            const source = record && typeof record === "object" ? record : {};
            const top = source.top && typeof source.top === "object" ? source.top : {};
            return {
                top: {
                    cropPlanExpanded: top.cropPlanExpanded === false ? false : true,
                    demandExpanded: top.demandExpanded === false ? false : true,
                    csaExpanded: top.csaExpanded === true,
                    planCheckExpanded: top.planCheckExpanded === true
                },
                collapsedDemandChannelIds: normalizeIdList(source.collapsedDemandChannelIds),
                collapsedDemandLineIds: normalizeIdList(source.collapsedDemandLineIds)
            };
        }

        function load(moduleCell, year) {
            const store = storage();
            if (!store) return normalize(null);
            try { return normalize(JSON.parse(store.getItem(storageKey(moduleCell, year)) || "{}")); } catch (_) { return normalize(null); }
        }

        function save(moduleCell, year, state) {
            const store = storage();
            if (!store || !state) return;
            const record = normalize({
                top: {
                    cropPlanExpanded: state.cropPlanExpanded,
                    demandExpanded: state.demandExpanded,
                    csaExpanded: state.csaExpanded,
                    planCheckExpanded: state.planCheckExpanded
                },
                collapsedDemandChannelIds: Array.from(state.collapsedDemandChannelIds || []),
                collapsedDemandLineIds: Array.from(state.collapsedDemandLineIds || [])
            });
            try { store.setItem(storageKey(moduleCell, year), JSON.stringify(record)); } catch (_) { }
        }

        return { load, save, storageKey };
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
                 default_planting_method_category,
                 annual, biennial, perennial
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

        async function queryPlantingMethodsForPlantId(plantId) {
            const pid = Number(plantId);
            if (!Number.isFinite(pid)) return [];
            const sql = `
        SELECT pm.method_id, pm.method_name, pm.method_category_id
        FROM PlantingMethods pm
        INNER JOIN PlantAllowedMethodCategories allowed
          ON LOWER(TRIM(allowed.method_category_id)) = LOWER(TRIM(pm.method_category_id))
        WHERE allowed.plant_id = ?
        ORDER BY LOWER(TRIM(pm.method_category_id)), LOWER(TRIM(pm.method_name)), LOWER(TRIM(pm.method_id));`;
            return await queryAll(sql, [pid]);
        }

        return {
            getDbPath,
            queryAll,
            listPlantsBasicRows,
            getPlantsBasicCached,
            invalidatePlantsBasicCache,
            queryVarietiesByPlantId,
            queryPlantingMethodsForPlantId
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

        const DAY_MS = 24 * 60 * 60 * 1000;
        const WEEK_MS = 7 * DAY_MS;

        function weekRangeForWindowClamped(weekStarts, fromYmd, toYmd) {
            if (!Array.isArray(weekStarts) || !weekStarts.length) return null;
            if (!hasYmd(fromYmd) || !hasYmd(toYmd)) return null;

            const t0 = parseYmdLocalToMs(fromYmd);
            const t1 = parseYmdLocalToMs(toYmd);
            if (!Number.isFinite(t0) || !Number.isFinite(t1)) return null;

            const winStart = Math.min(t0, t1);
            const winEndEx = addDaysMs(Math.max(t0, t1), 1);

            let a = -1;
            let b = -1;

            for (let i = 0; i < weekStarts.length; i++) {
                const ws = weekStarts[i].ms;
                const we = addDaysMs(ws, 7);
                const overlaps = winStart < we && winEndEx > ws;
                if (!overlaps) continue;
                if (a < 0) a = i;
                b = i;
            }

            return (a >= 0 && b >= 0) ? { a, b } : null;
        }

        function weekStartMsForDate(dateYmd, weekStartDow) {
            const t = parseYmdLocalToMs(dateYmd);
            if (!Number.isFinite(t)) return NaN;

            const d = new Date(t);
            const dow = d.getDay();
            const delta = (7 + (dow - weekStartDow)) % 7;
            return addDaysMs(t, -delta);
        }

        function weekOffsetFromWindowStart(weekStarts, i, fromYmd, weekStartDow) {
            const startWeekMs = weekStartMsForDate(fromYmd, weekStartDow);
            if (!Number.isFinite(startWeekMs)) return 0;

            const diff = Number(weekStarts[i].ms) - startWeekMs;
            if (!Number.isFinite(diff)) return 0;

            return Math.max(0, Math.round(diff / WEEK_MS));
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

        function resolvePackagePriceForUnit(crop, unit) {
            const u = String(unit || "").trim().toLowerCase();
            if (!u) return NaN;
            const packs = Array.isArray(crop && crop.packages) ? crop.packages : [];
            const pkg = packs.find(item => String(item && item.unit || "").trim().toLowerCase() === u);
            if (!pkg || pkg.price === "" || pkg.price === null || pkg.price === undefined) return NaN;
            const price = Number(pkg.price);
            return Number.isFinite(price) && price >= 0 ? price : NaN;
        }

        function addKgAcrossWeeks(series, weekStarts, fromYmd, toYmd, kgPerWeek) {
            const wr = weekRangeForWindowClamped(weekStarts, fromYmd, toYmd);
            if (!wr) return;

            for (let i = wr.a; i <= wr.b; i++) series[i] += kgPerWeek;
        }

        function addDailyDemandAcrossWeeks(series, weekStarts, fromYmd, toYmd, kgPerOccurrence, everyN) {
            if (!Array.isArray(series) || !Array.isArray(weekStarts)) return false;
            if (!hasYmd(fromYmd) || !hasYmd(toYmd) || fromYmd > toYmd) return false;
            const kg = Number(kgPerOccurrence);
            const interval = Math.max(1, Math.trunc(Number(everyN) || 1));
            if (!Number.isFinite(kg) || kg <= 0) return false;
            const match = String(fromYmd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (!match) return false;
            const anchor = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
            const endMatch = String(toYmd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
            const end = Date.UTC(Number(endMatch[1]), Number(endMatch[2]) - 1, Number(endMatch[3]));
            let added = false;
            for (let day = anchor; day <= end; day += interval * DAY_MS) {
                const date = new Date(day);
                const ymd = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
                const index = weekIndexForDate(weekStarts, ymd);
                if (index < 0) continue;
                series[index] += kg;
                added = true;
            }
            return added;
        }

        function addWeeklyDemandAcrossWeeks(series, weekStarts, fromYmd, toYmd, kgPerOccurrence, everyN, weekStartDow) {
            const wr = weekRangeForWindowClamped(weekStarts, fromYmd, toYmd);
            const kg = Number(kgPerOccurrence);
            const interval = Math.max(1, Math.trunc(Number(everyN) || 1));
            if (!wr || !Number.isFinite(kg) || kg <= 0) return false;
            let added = false;
            for (let i = wr.a; i <= wr.b; i++) {
                const offset = weekOffsetFromWindowStart(weekStarts, i, fromYmd, weekStartDow);
                if (offset % interval !== 0) continue;
                series[i] += kg;
                added = true;
            }
            return added;
        }

        function addMonthlyDemandAcrossWeeks(series, weekStarts, fromYmd, toYmd, kgPerMonth, everyN) {
            if (!Array.isArray(series) || !Array.isArray(weekStarts)) return false;
            if (!hasYmd(fromYmd) || !hasYmd(toYmd) || fromYmd > toYmd) return false;
            const kg = Number(kgPerMonth);
            const interval = Math.max(1, Math.trunc(Number(everyN) || 1));
            if (!Number.isFinite(kg) || kg <= 0) return false;
            const fromParts = String(fromYmd).split("-").map(Number);
            const toParts = String(toYmd).split("-").map(Number);
            const anchorMonth = fromParts[0] * 12 + fromParts[1] - 1;
            const lastMonth = toParts[0] * 12 + toParts[1] - 1;
            let added = false;
            for (let monthKey = anchorMonth; monthKey <= lastMonth; monthKey += interval) {
                const year = Math.floor(monthKey / 12);
                const monthIndex = monthKey % 12;
                const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
                const activeStart = monthKey === anchorMonth ? fromParts[2] : 1;
                const activeEnd = monthKey === lastMonth ? toParts[2] : daysInMonth;
                for (let day = activeStart; day <= activeEnd; day++) {
                    const ymd = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                    const index = weekIndexForDate(weekStarts, ymd);
                    if (index < 0) continue;
                    series[index] += kg / daysInMonth;
                    added = true;
                }
            }
            return added;
        }

        function addDemandAcrossWeeks(series, weekStarts, line, kgPerUnit, weekStartDow) {
            const qtyKg = Number(line && line.qty) * Number(kgPerUnit);
            const everyN = Math.max(1, Math.trunc(Number(line && line.everyN) || 1));
            if (line && line.frequency === "day") return addDailyDemandAcrossWeeks(series, weekStarts, line.from, line.to, qtyKg, everyN);
            if (line && line.frequency === "month") return addMonthlyDemandAcrossWeeks(series, weekStarts, line.from, line.to, qtyKg, everyN);
            return addWeeklyDemandAcrossWeeks(series, weekStarts, line && line.from, line && line.to, qtyKg, everyN, weekStartDow);
        }

        function addTotalKgAcrossWindowProrated(series, weekStarts, fromYmd, toYmd, totalKg, selectedYear) {
            if (!Array.isArray(series) || !Array.isArray(weekStarts)) return false;
            if (!hasYmd(fromYmd) || !hasYmd(toYmd)) return false;

            const total = Number(totalKg);
            if (!Number.isFinite(total) || total <= 0) return false;

            const y = Number(selectedYear);
            if (!Number.isFinite(y)) return false;

            const t0 = parseYmdLocalToMs(fromYmd);
            const t1 = parseYmdLocalToMs(toYmd);
            if (!Number.isFinite(t0) || !Number.isFinite(t1)) return false;
            if (t0 > t1) return false;

            const winStart = t0;
            const winEndEx = addDaysMs(t1, 1);

            const yearStart = parseYmdLocalToMs(`${y}-01-01`);
            const yearEndEx = parseYmdLocalToMs(`${y + 1}-01-01`);
            if (!Number.isFinite(yearStart) || !Number.isFinite(yearEndEx)) return false;

            const fullDays = Math.max(1, Math.round((winEndEx - winStart) / DAY_MS));
            let added = false;

            for (let i = 0; i < weekStarts.length; i++) {
                const ws = Number(weekStarts[i].ms);
                if (!Number.isFinite(ws)) continue;

                const we = addDaysMs(ws, 7);

                const overlapStart = Math.max(winStart, ws, yearStart);
                const overlapEnd = Math.min(winEndEx, we, yearEndEx);
                if (overlapStart >= overlapEnd) continue;

                const overlapDays = Math.max(0, (overlapEnd - overlapStart) / DAY_MS);
                if (!(overlapDays > 0)) continue;

                series[i] += total * (overlapDays / fullDays);
                added = true;
            }

            return added;
        }

        /**
         * Simulates weekly FIFO inventory for one crop without changing its harvest series.
         * Shelf life is approximated in whole weekly buckets; harvest remains usable in its harvest week.
         */
        function buildUsableSupplySeries(harvestSeries, targetSeries, shelfLifeDays, weekStarts) {
            const harvest = Array.isArray(harvestSeries) ? harvestSeries : [];
            const target = Array.isArray(targetSeries) ? targetSeries : [];
            const weeks = Array.isArray(weekStarts) ? weekStarts : [];
            const length = Math.max(harvest.length, target.length, weeks.length);
            const lifetimeWeeks = Math.max(1, Math.ceil(Math.max(0, Number(shelfLifeDays) || 0) / 7));
            const availableSupply = Array(length).fill(0);
            const usableSupply = Array(length).fill(0);
            const short = Array(length).fill(0);
            const surplus = Array(length).fill(0);
            const expired = Array(length).fill(0);
            const endingInventory = Array(length).fill(0);
            const inventory = [];

            for (let weekIndex = 0; weekIndex < length; weekIndex++) {
                const harvestedKg = Math.max(0, Number(harvest[weekIndex]) || 0);
                if (harvestedKg > 0) {
                    inventory.push({ kg: harvestedKg, expiresWeek: weekIndex + lifetimeWeeks });
                }

                while (inventory.length && inventory[0].expiresWeek <= weekIndex) {
                    expired[weekIndex] += inventory.shift().kg;
                }

                availableSupply[weekIndex] = inventory.reduce((sum, batch) => sum + batch.kg, 0);
                let demandRemaining = Math.max(0, Number(target[weekIndex]) || 0);

                while (demandRemaining > 0 && inventory.length) {
                    const batch = inventory[0];
                    const usedKg = Math.min(demandRemaining, batch.kg);
                    batch.kg -= usedKg;
                    demandRemaining -= usedKg;
                    usableSupply[weekIndex] += usedKg;
                    if (batch.kg <= 1e-9) inventory.shift();
                }

                short[weekIndex] = demandRemaining;
                endingInventory[weekIndex] = inventory.reduce((sum, batch) => sum + batch.kg, 0);
                surplus[weekIndex] = endingInventory[weekIndex];
            }

            return { availableSupply, usableSupply, short, surplus, expired, endingInventory };
        }

        function buildPlanChartModel(weekly, cropId) {
            const source = cropId && weekly && weekly.perCrop
                ? (weekly.perCrop.get(cropId) || weekly.perCrop.get(String(cropId)))
                : null;
            const weeks = weekly && Array.isArray(weekly.weeks) ? weekly.weeks : [];
            const target = source ? source.target : (weekly && weekly.targetTotal) || [];
            const harvest = source ? source.supply : (weekly && weekly.supplyTotal) || [];
            const available = source ? source.availableSupply : (weekly && weekly.availableSupplyTotal) || [];
            const usable = source ? source.usableSupply : (weekly && weekly.usableSupplyTotal) || [];
            const short = source ? source.short : (weekly && weekly.shortTotal) || [];
            const surplus = source ? source.surplus : (weekly && weekly.surplusTotal) || [];
            const expired = source ? source.expired : (weekly && weekly.expiredTotal) || [];
            const endingInventory = source ? source.endingInventory : (weekly && weekly.endingInventoryTotal) || [];

            return weeks.map((week, index) => ({
                week: week && week.iso ? String(week.iso) : "",
                targetKg: Math.max(0, Number(target[index]) || 0),
                harvestKg: Math.max(0, Number(harvest[index]) || 0),
                availableSupplyKg: Math.max(0, Number(available[index]) || 0),
                usableSupplyKg: Math.max(0, Number(usable[index]) || 0),
                shortKg: Math.max(0, Number(short[index]) || 0),
                surplusKg: Math.max(0, Number(surplus[index]) || 0),
                expiredKg: Math.max(0, Number(expired[index]) || 0),
                endingInventoryKg: Math.max(0, Number(endingInventory[index]) || 0)
            }));
        }

        function summarizePlanChartModel(chartModel) {
            const rows = Array.isArray(chartModel) ? chartModel : [];
            const summary = {
                targetKg: 0,
                harvestKg: 0,
                usableSupplyKg: 0,
                shortKg: 0,
                expiredKg: 0,
                worstShortageKg: 0,
                worstShortageWeek: "",
                shortWeeks: 0
            };

            for (const row of rows) {
                summary.targetKg += Math.max(0, Number(row && row.targetKg) || 0);
                summary.harvestKg += Math.max(0, Number(row && row.harvestKg) || 0);
                summary.usableSupplyKg += Math.max(0, Number(row && row.usableSupplyKg) || 0);
                summary.shortKg += Math.max(0, Number(row && row.shortKg) || 0);
                summary.expiredKg += Math.max(0, Number(row && row.expiredKg) || 0);
                if (Number(row && row.shortKg) > 1e-9) summary.shortWeeks += 1;
                if (Number(row && row.shortKg) > summary.worstShortageKg) {
                    summary.worstShortageKg = Number(row.shortKg);
                    summary.worstShortageWeek = String(row.week || "");
                }
            }
            return summary;
        }

        function computePlanWeekly(plan, warns) {

            warns = Array.isArray(warns) ? warns : [];

            PlanSchema.normalizeForRuntime(plan, plan && plan.year);
            const year = Number(plan && plan.year);
            const weekStartDow = plan.weekStartDow;
            const weeks = buildWeekStartsForYearLocal(year, weekStartDow);
            const n = weeks.length;

            const targetTotal = Array(n).fill(0);
            const supplyTotal = Array(n).fill(0);
            const availableSupplyTotal = Array(n).fill(0);
            const usableSupplyTotal = Array(n).fill(0);
            const shortTotal = Array(n).fill(0);
            const surplusTotal = Array(n).fill(0);
            const expiredTotal = Array(n).fill(0);
            const endingInventoryTotal = Array(n).fill(0);
            const perCrop = new Map();

            function ensureCropArrays(cropId) {
                if (!perCrop.has(cropId)) {
                    perCrop.set(cropId, { target: Array(n).fill(0), supply: Array(n).fill(0) });
                }
                return perCrop.get(cropId);
            }

            const crops = (plan && plan.crops) ? plan.crops : [];
            const carryoverCrops = Array.isArray(plan && plan.__carryoverCrops) ? plan.__carryoverCrops : [];
            const supplyCrops = crops.concat(carryoverCrops);

            const demandLineOrder = new Map();
            const channelOrder = new Map(((plan && plan.demandChannels) || []).map((channel, index) => [String(channel && channel.id || ""), index]));
            const perDemandLine = new Map();
            const perChannel = new Map();
            const perPriority = new Map();
            const csaWeekly = { target: Array(n).fill(0), usableSupply: Array(n).fill(0), short: Array(n).fill(0), potentialRevenue: Array(n).fill(0), fulfilledRevenue: Array(n).fill(0), boxFillRatio: Array(n).fill(0), potentialRevenueByCropId: new Map(), fulfilledRevenueByCropId: new Map(), componentValuePerBox: 0, salePricePerBox: 0 };
            const csaComponentRequests = [];
            const priorityRank = new Map([["committed", 0], ["target", 1], ["optional", 2]]);

            function ensureCsaRevenueArrays(cropId) {
                const key = String(cropId || "");
                if (!csaWeekly.potentialRevenueByCropId.has(key)) csaWeekly.potentialRevenueByCropId.set(key, Array(n).fill(0));
                if (!csaWeekly.fulfilledRevenueByCropId.has(key)) csaWeekly.fulfilledRevenueByCropId.set(key, Array(n).fill(0));
                return {
                    potential: csaWeekly.potentialRevenueByCropId.get(key),
                    fulfilled: csaWeekly.fulfilledRevenueByCropId.get(key)
                };
            }

            for (const [lineIndex, line] of ((plan && plan.demands) || []).entries()) {
                demandLineOrder.set(String(line && line.id || ""), lineIndex);
                const crop = findCrop(plan, line && line.cropId);
                if (!crop) { pushWarn(warns, "Demand line skipped (missing crop)."); continue; }
                const qty = Number(line && line.qty);
                if (!Number.isFinite(qty) || qty <= 0) { pushWarn(warns, `Demand line skipped (qty missing) for ${crop.plant || crop.id}`); continue; }
                if (!hasYmd(line.from) || !hasYmd(line.to)) { pushWarn(warns, `Demand line skipped (missing dates) for ${crop.plant || crop.id}`); continue; }
                if (line.from > line.to) { pushWarn(warns, `Demand line skipped (start date after end date) for ${crop.plant || crop.id}`); continue; }
                const kgPerUnit = resolveUnitToKgPerUnit(crop, line.unit);
                if (!Number.isFinite(kgPerUnit)) { pushWarn(warns, `Demand line skipped (unknown unit "${line.unit}") for ${crop.plant || crop.id}`); continue; }
                const unitPrice = resolvePackagePriceForUnit(crop, line.unit);
                const target = Array(n).fill(0);
                if (!addDemandAcrossWeeks(target, weeks, line, kgPerUnit, weekStartDow)) continue;
                const result = {
                    line,
                    cropId: String(crop.id),
                    channelId: String(line.channelId || ""),
                    priority: String(line.priority || "target"),
                    kgPerUnit,
                    unitPrice,
                    target,
                    usableSupply: Array(n).fill(0),
                    short: Array(n).fill(0),
                    potentialRevenue: target.map(value => Number.isFinite(unitPrice) ? (value / kgPerUnit) * unitPrice : 0),
                    fulfilledRevenue: Array(n).fill(0)
                };
                perDemandLine.set(String(line.id), result);
                const cropArrays = ensureCropArrays(crop.id);
                for (let i = 0; i < n; i++) cropArrays.target[i] += target[i];
            }

            // CSA
            const csa = plan && plan.csa;
            if (csa && csa.enabled) {
                const boxes = Number(csa.boxesPerWeek);
                if (!Number.isFinite(boxes) || boxes <= 0) {
                    pushWarn(warns, "CSA enabled but boxes/week is not set.");
                } else {
                    const comps = csa.components || [];
                    let componentValuePerBox = 0;
                    let salePricePerBox = 0;
                    let hasValidComponent = false;
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
                        hasValidComponent = true;
                        const unitPrice = resolvePackagePriceForUnit(crop, comp.unit);
                        const componentValue = Number.isFinite(unitPrice) ? qty * unitPrice : 0;
                        if (Number.isFinite(unitPrice)) componentValuePerBox += componentValue;
                        else pushWarn(warns, `CSA component value for ${crop.plant || crop.id} ${comp.unit || "unit"} counted as $0 because no matching package price is set.`);

                        const everyN = Math.max(1, Number(comp.everyNWeeks) || 1);
                        const from = comp.start || csa.start;
                        const to = comp.end || csa.end;

                        if (!hasYmd(from) || !hasYmd(to)) {
                            pushWarn(warns, `CSA component skipped (missing dates) for ${crop.plant || crop.id}`);
                            continue;
                        }
                        if (from > to) {
                            pushWarn(warns, `CSA component skipped (start date after end date) for ${crop.plant || crop.id}`);
                            continue;
                        }

                        const wr = PlanMath.weekRangeForWindowClamped(weeks, from, to);
                        if (!wr) continue;

                        const arr = ensureCropArrays(crop.id);
                        const componentRequest = { cropId: String(crop.id), target: Array(n).fill(0), componentValuePerBox: Math.max(0, componentValue) };
                        csaComponentRequests.push(componentRequest);

                        for (let i = wr.a; i <= wr.b; i++) {
                            const rel = weekOffsetFromWindowStart(weeks, i, from, weekStartDow);
                            if (rel % everyN !== 0) continue;
                            const targetKg = boxes * qty * kgPerUnit;
                            arr.target[i] += targetKg;
                            csaWeekly.target[i] += targetKg;
                            componentRequest.target[i] += targetKg;
                            if (!arr.csaTarget) arr.csaTarget = Array(n).fill(0);
                            arr.csaTarget[i] += targetKg;
                        }
                    }
                    csaWeekly.componentValuePerBox = componentValuePerBox;
                    salePricePerBox = csa.salePriceMode === "manual" && Number.isFinite(Number(csa.salePricePerBox)) && Number(csa.salePricePerBox) >= 0
                        ? Number(csa.salePricePerBox)
                        : componentValuePerBox;
                    csaWeekly.salePricePerBox = salePricePerBox;
                    const activeRange = PlanMath.hasYmd(csa.start) && PlanMath.hasYmd(csa.end) && csa.start <= csa.end
                        ? PlanMath.weekRangeForWindowClamped(weeks, csa.start, csa.end)
                        : null;
                    if (activeRange && hasValidComponent) {
                        for (let i = activeRange.a; i <= activeRange.b; i++) csaWeekly.potentialRevenue[i] = boxes * salePricePerBox;
                    }
                }
            }

            // actual harvest supply
            for (const crop of supplyCrops) {
                if (!crop || !crop.id) continue;

                const arr = ensureCropArrays(crop.id);

                const actualSeries = Array.isArray(crop.__actualHarvestWeeklyKg)
                    ? crop.__actualHarvestWeeklyKg
                    : null;

                if (actualSeries && actualSeries.some(v => Number(v) > 0)) {
                    for (let i = 0; i < n; i++) {
                        arr.supply[i] += Math.max(0, Number(actualSeries[i]) || 0);
                    }
                }
            }

            for (const crop of supplyCrops) {
                if (!crop || !crop.id) continue;
                const arr = ensureCropArrays(crop.id);
                arr.availableSupply = Array(n).fill(0);
                arr.usableSupply = Array(n).fill(0);
                arr.short = Array(n).fill(0);
                arr.surplus = Array(n).fill(0);
                arr.expired = Array(n).fill(0);
                arr.endingInventory = Array(n).fill(0);
                arr.csaUsableSupply = Array(n).fill(0);
                arr.csaShort = Array(n).fill(0);
                const lifetimeWeeks = Math.max(1, Math.ceil(Math.max(0, Number(crop.shelfLifeDays) || 0) / 7));
                const inventory = [];
                const demandResults = Array.from(perDemandLine.values())
                    .filter(result => result.cropId === String(crop.id))
                    .sort((a, b) => {
                        const priorityDifference = (priorityRank.get(a.priority) ?? 1) - (priorityRank.get(b.priority) ?? 1);
                        if (priorityDifference) return priorityDifference;
                        const channelDifference = (channelOrder.get(a.channelId) ?? Number.MAX_SAFE_INTEGER) - (channelOrder.get(b.channelId) ?? Number.MAX_SAFE_INTEGER);
                        if (channelDifference) return channelDifference;
                        return (demandLineOrder.get(String(a.line.id)) ?? 0) - (demandLineOrder.get(String(b.line.id)) ?? 0);
                    });
                const consume = requestedKg => {
                    let remaining = Math.max(0, Number(requestedKg) || 0);
                    let used = 0;
                    while (remaining > 0 && inventory.length) {
                        const batch = inventory[0];
                        const amount = Math.min(remaining, batch.kg);
                        batch.kg -= amount;
                        remaining -= amount;
                        used += amount;
                        if (batch.kg <= 1e-9) inventory.shift();
                    }
                    return { used, short: remaining };
                };
                for (let weekIndex = 0; weekIndex < n; weekIndex++) {
                    const harvestedKg = Math.max(0, Number(arr.supply[weekIndex]) || 0);
                    if (harvestedKg > 0) inventory.push({ kg: harvestedKg, expiresWeek: weekIndex + lifetimeWeeks });
                    while (inventory.length && inventory[0].expiresWeek <= weekIndex) arr.expired[weekIndex] += inventory.shift().kg;
                    arr.availableSupply[weekIndex] = inventory.reduce((sum, batch) => sum + batch.kg, 0);
                    const csaAllocation = consume(arr.csaTarget && arr.csaTarget[weekIndex]);
                    csaWeekly.usableSupply[weekIndex] += csaAllocation.used;
                    csaWeekly.short[weekIndex] += csaAllocation.short;
                    arr.csaUsableSupply[weekIndex] = csaAllocation.used;
                    arr.csaShort[weekIndex] = csaAllocation.short;
                    arr.usableSupply[weekIndex] += csaAllocation.used;
                    arr.short[weekIndex] += csaAllocation.short;
                    for (const result of demandResults) {
                        const allocation = consume(result.target[weekIndex]);
                        result.usableSupply[weekIndex] = allocation.used;
                        result.short[weekIndex] = allocation.short;
                        result.fulfilledRevenue[weekIndex] = Number.isFinite(result.unitPrice)
                            ? (allocation.used / result.kgPerUnit) * result.unitPrice
                            : 0;
                        arr.usableSupply[weekIndex] += allocation.used;
                        arr.short[weekIndex] += allocation.short;
                    }
                    arr.endingInventory[weekIndex] = inventory.reduce((sum, batch) => sum + batch.kg, 0);
                    arr.surplus[weekIndex] = arr.endingInventory[weekIndex];
                }
            }
            for (let weekIndex = 0; weekIndex < n; weekIndex++) {
                let fillRatio = csaComponentRequests.length ? 1 : 0;
                let activeComponent = false;
                for (const request of csaComponentRequests) {
                    const targetKg = Math.max(0, Number(request.target[weekIndex]) || 0);
                    if (targetKg <= 0) continue;
                    activeComponent = true;
                    const cropArrays = perCrop.get(String(request.cropId));
                    const cropTarget = Math.max(0, Number(cropArrays && cropArrays.csaTarget && cropArrays.csaTarget[weekIndex]) || 0);
                    const cropUsed = Math.max(0, Number(cropArrays && cropArrays.csaUsableSupply && cropArrays.csaUsableSupply[weekIndex]) || 0);
                    const componentRatio = cropTarget > 0 ? Math.max(0, Math.min(1, cropUsed / cropTarget)) : 0;
                    fillRatio = Math.min(fillRatio, componentRatio);
                }
                csaWeekly.boxFillRatio[weekIndex] = activeComponent ? fillRatio : 0;
                csaWeekly.fulfilledRevenue[weekIndex] = Math.max(0, Number(csaWeekly.potentialRevenue[weekIndex]) || 0) * csaWeekly.boxFillRatio[weekIndex];
                const activeComponentValue = csaComponentRequests.reduce((sum, request) => {
                    return Math.max(0, Number(request.target[weekIndex]) || 0) > 0
                        ? sum + Math.max(0, Number(request.componentValuePerBox) || 0)
                        : sum;
                }, 0);
                if (activeComponentValue > EPS) {
                    for (const request of csaComponentRequests) {
                        if (Math.max(0, Number(request.target[weekIndex]) || 0) <= 0) continue;
                        const share = Math.max(0, Number(request.componentValuePerBox) || 0) / activeComponentValue;
                        if (share <= 0) continue;
                        const cropRevenue = ensureCsaRevenueArrays(request.cropId);
                        cropRevenue.potential[weekIndex] += Math.max(0, Number(csaWeekly.potentialRevenue[weekIndex]) || 0) * share;
                        cropRevenue.fulfilled[weekIndex] += Math.max(0, Number(csaWeekly.fulfilledRevenue[weekIndex]) || 0) * share;
                    }
                }
            }

            function aggregateDemandResults(results) {
                const aggregate = {
                    target: Array(n).fill(0), usableSupply: Array(n).fill(0), short: Array(n).fill(0),
                    potentialRevenue: Array(n).fill(0), fulfilledRevenue: Array(n).fill(0), lineIds: []
                };
                for (const result of results) {
                    aggregate.lineIds.push(String(result.line.id));
                    for (let i = 0; i < n; i++) {
                        aggregate.target[i] += result.target[i];
                        aggregate.usableSupply[i] += result.usableSupply[i];
                        aggregate.short[i] += result.short[i];
                        aggregate.potentialRevenue[i] += result.potentialRevenue[i];
                        aggregate.fulfilledRevenue[i] += result.fulfilledRevenue[i];
                    }
                }
                return aggregate;
            }

            for (const channel of ((plan && plan.demandChannels) || [])) {
                const channelId = String(channel && channel.id || "");
                perChannel.set(channelId, aggregateDemandResults(Array.from(perDemandLine.values()).filter(result => result.channelId === channelId)));
            }
            for (const priority of ["committed", "target", "optional"]) {
                perPriority.set(priority, aggregateDemandResults(Array.from(perDemandLine.values()).filter(result => result.priority === priority)));
            }
            const committedAggregate = perPriority.get("committed");
            if (committedAggregate && csaWeekly) {
                committedAggregate.lineIds.push("__csa__");
                for (let i = 0; i < n; i++) {
                    committedAggregate.target[i] += Math.max(0, Number(csaWeekly.target[i]) || 0);
                    committedAggregate.usableSupply[i] += Math.max(0, Number(csaWeekly.usableSupply[i]) || 0);
                    committedAggregate.short[i] += Math.max(0, Number(csaWeekly.short[i]) || 0);
                    committedAggregate.potentialRevenue[i] += Math.max(0, Number(csaWeekly.potentialRevenue[i]) || 0);
                    committedAggregate.fulfilledRevenue[i] += Math.max(0, Number(csaWeekly.fulfilledRevenue[i]) || 0);
                }
            }

            // Aggregate all per-crop series into total series before returning.
            for (const v of perCrop.values()) {
                for (let i = 0; i < n; i++) {
                    targetTotal[i] += Math.max(0, Number(v.target[i]) || 0);
                    supplyTotal[i] += Math.max(0, Number(v.supply[i]) || 0);
                    availableSupplyTotal[i] += Math.max(0, Number(v.availableSupply[i]) || 0);
                    usableSupplyTotal[i] += Math.max(0, Number(v.usableSupply[i]) || 0);
                    shortTotal[i] += Math.max(0, Number(v.short[i]) || 0);
                    surplusTotal[i] += Math.max(0, Number(v.surplus[i]) || 0);
                    expiredTotal[i] += Math.max(0, Number(v.expired[i]) || 0);
                    endingInventoryTotal[i] += Math.max(0, Number(v.endingInventory[i]) || 0);
                }
            }

            return {
                weeks,
                targetTotal,
                supplyTotal,
                availableSupplyTotal,
                usableSupplyTotal,
                shortTotal,
                surplusTotal,
                expiredTotal,
                endingInventoryTotal,
                perCrop,
                perDemandLine,
                perChannel,
                perPriority,
                csa: csaWeekly
            };
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
            weekRangeForWindowClamped,
            weekStartMsForDate,
            weekOffsetFromWindowStart,
            findCrop,
            resolvePackagePriceForUnit,
            resolveUnitToKgPerUnit,
            addKgAcrossWeeks,
            addDailyDemandAcrossWeeks,
            addWeeklyDemandAcrossWeeks,
            addMonthlyDemandAcrossWeeks,
            addDemandAcrossWeeks,
            addTotalKgAcrossWindowProrated,
            buildUsableSupplySeries,
            buildPlanChartModel,
            summarizePlanChartModel,
            computePlanWeekly,
            computePlanCropTotals
        };
    })();

    // -------------------- PlanSchema --------------------
    /**
     * Owns the persisted plan shape, runtime normalization, validation, and crop identity rules.
     */
    const PlanSchema = (() => {
        const DEFAULT_DEMAND_CHANNELS = [
            { id: "farm_store", label: "Farm Store", type: "farm_store" },
            { id: "restaurant_1", label: "Restaurant 1", type: "restaurant" },
            { id: "farmers_market", label: "Farmers Market", type: "market" },
            { id: "wholesale", label: "Wholesale", type: "wholesale" }
        ];
        const DEMAND_CHANNEL_TYPES = ["farm_store", "restaurant", "market", "wholesale", "other"];
        const DEMAND_FREQUENCIES = ["day", "week", "month"];
        const DEMAND_PRIORITIES = ["committed", "target", "optional"];
        const HARVEST_WINDOW_SOURCES = ["manual", "actual_harvest", "sowing_window_estimate"]; // CHANGE: persist the selected harvest-window authority.

        function clonePlain(obj) {
            return JSON.parse(JSON.stringify(obj || {}));
        }

        function normMethodId(value) {
            return String(value || "").trim().toLowerCase();
        }

        function inferMethodCategoryFromMethodId(methodId) {
            const normalized = normMethodId(methodId);
            return normalized.indexOf(".") > 0 ? normalized.split(".")[0] : "";
        }

        function normalizeCropMethodFieldsForRuntime(crop) {
            if (!crop) return;
            const methodId = normMethodId(crop.method || crop.methodId);
            const inferredCategoryId = inferMethodCategoryFromMethodId(methodId);
            crop.method = methodId || "direct_sow.field";
            crop.methodCategoryId = String(crop.methodCategoryId || crop.method_category_id || inferredCategoryId || "").trim().toLowerCase();
            if (!crop.methodCategoryId && crop.method === "direct_sow.field") crop.methodCategoryId = "direct_sow";
        }

        function createEmptyPlan(year) {
            return normalizeForRuntime({
                version: 2,
                year: Number(year),
                weekStartDow: 1,
                crops: [],
                demandChannels: clonePlain(DEFAULT_DEMAND_CHANNELS),
                demands: [],
                csa: { enabled: false, boxesPerWeek: 0, start: "", end: "", salePricePerBox: null, salePriceMode: "auto", components: [] }
            }, year);
        }

        function isPositiveFiniteNumber(value) {
            const number = Number(value);
            return Number.isFinite(number) && number > 0;
        }

        function normalizeYieldFieldsForRuntime(crop) {
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

        function normalizeHarvestWindowSourceForRuntime(crop) {
            if (!crop) return "manual";
            const missingSource = !HARVEST_WINDOW_SOURCES.includes(String(crop.harvestWindowSource || ""))
                || crop.__harvestWindowSourceMissing === true;
            const source = missingSource
                ? (crop.useActualHarvest === true ? "actual_harvest" : "manual")
                : String(crop.harvestWindowSource);
            crop.harvestWindowSource = source;
            crop.useActualHarvest = source === "actual_harvest";
            crop.__harvestWindowSourceMissing = missingSource; // CHANGE: allows first estimate response to default legacy/manual rows once.
            return source;
        }

        function setCropHarvestWindowSource(crop, source) {
            if (!crop) return "manual";
            crop.harvestWindowSource = HARVEST_WINDOW_SOURCES.includes(String(source || "")) ? String(source) : "manual";
            crop.useActualHarvest = crop.harvestWindowSource === "actual_harvest";
            crop.__harvestWindowSourceMissing = false;
            return crop.harvestWindowSource;
        }

        function normalizeForRuntime(plan, year) {
            const normalized = plan && typeof plan === "object" ? plan : {};
            normalized.version = 2;
            normalized.year = Number.isFinite(Number(year)) ? Number(year) : Number(normalized.year);
            if (!Number.isFinite(normalized.year)) normalized.year = new Date().getFullYear();
            const weekStartDow = Math.trunc(Number(normalized.weekStartDow));
            normalized.weekStartDow = Number.isFinite(weekStartDow) && weekStartDow >= 0 && weekStartDow <= 6
                ? weekStartDow
                : 1;
            normalized.crops = Array.isArray(normalized.crops) ? normalized.crops : [];
            if (!Array.isArray(normalized.demandChannels)) normalized.demandChannels = clonePlain(DEFAULT_DEMAND_CHANNELS);
            normalized.demands = Array.isArray(normalized.demands) ? normalized.demands : [];

            if (!normalized.csa || typeof normalized.csa !== "object") {
                normalized.csa = { enabled: false, boxesPerWeek: 0, start: "", end: "", salePricePerBox: null, salePriceMode: "auto", components: [] };
            }
            normalized.csa.salePriceMode = normalized.csa.salePriceMode === "manual" ? "manual" : "auto";
            const csaSalePrice = normalized.csa.salePricePerBox === "" || normalized.csa.salePricePerBox === null || normalized.csa.salePricePerBox === undefined ? NaN : Number(normalized.csa.salePricePerBox);
            normalized.csa.salePricePerBox = Number.isFinite(csaSalePrice) && csaSalePrice >= 0 ? csaSalePrice : null;
            normalized.csa.components = Array.isArray(normalized.csa.components) ? normalized.csa.components : [];

            for (const crop of normalized.crops) {
                normalizeCropMethodFieldsForRuntime(crop);
                normalizeYieldFieldsForRuntime(crop);
                normalizeHarvestWindowSourceForRuntime(crop);
                crop.packages = Array.isArray(crop.packages) ? crop.packages : [];
                if (!Number.isFinite(Number(crop.shelfLifeDays))) crop.shelfLifeDays = 0;
                if (!Number.isFinite(Number(crop.germRate)) || Number(crop.germRate) <= 0 || Number(crop.germRate) > 1) {
                    crop.germRate = 1.0;
                }
            }

            return normalized;
        }

        function stripRuntimeFields(plan, options) {
            const forTemplate = !!(options && options.forTemplate);
            delete plan.cropFilterId;
            delete plan.__carryoverCrops;
            if (!forTemplate) delete plan.templateBaseYear;

            for (const crop of (plan.crops || [])) {
                delete crop.__actualHarvestWeeklyKg;
                delete crop.__sync_lastHarvestStart;
                delete crop.__sync_lastHarvestEnd;
                delete crop.__sync_lastAvailEnd;
                delete crop.__kgpp_lastAuto;
                delete crop.__baseKgPerPlant;
                delete crop.__harvestWindowSourceMissing;
                delete crop.savePackagesAsDefault;

                crop.kgPerPlantMode = crop.kgPerPlantMode === "manual" ? "manual" : "auto";
                crop.harvestWindowSource = HARVEST_WINDOW_SOURCES.includes(String(crop.harvestWindowSource || "")) ? String(crop.harvestWindowSource) : "manual";
                crop.useActualHarvest = crop.harvestWindowSource === "actual_harvest";
                delete crop.market;
            }
            for (const demandLine of (plan.demands || [])) delete demandLine.price;
            if (plan.csa) delete plan.csa.__componentValuePerBox;
            return plan;
        }

        function serializeForPersistence(plan, options) {
            const serialized = normalizeForRuntime(clonePlain(plan || {}), plan && plan.year);
            return stripRuntimeFields(serialized, options);
        }

        function normalizeVarietyIdForIdentity(varietyId) {
            if (varietyId === null || varietyId === undefined || varietyId === "") return "";
            return String(varietyId).trim();
        }

        function makeCropIdentityKey(plantId, varietyId) {
            const normalizedPlantId = String(plantId ?? "").trim();
            if (!normalizedPlantId) return "";
            return `pid:${normalizedPlantId}|vid:${normalizeVarietyIdForIdentity(varietyId)}`;
        }

        function getCropIdentityKey(crop) {
            return makeCropIdentityKey(crop && crop.plantId, crop && crop.varietyId);
        }

        function findDuplicateCrop(plan, plantId, varietyId, exceptCropId) {
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

        function findFirstDuplicateCrop(plan) {
            const seen = new Map();
            for (const crop of ((plan && plan.crops) || [])) {
                const key = getCropIdentityKey(crop);
                if (!key) continue;
                if (seen.has(key)) return { first: seen.get(key), second: crop, key };
                seen.set(key, crop);
            }
            return null;
        }

        function makeValidation(scope, code, message, metadata) {
            return { scope, code, message, ...(metadata || {}) };
        }

        function cropTarget(crop, tab, field, extra) {
            return { area: "crop", cropId: String(crop && crop.id || ""), tab, field, ...(extra || {}) };
        }

        function csaTarget(field, extra) {
            return { area: "csa", field, ...(extra || {}) };
        }

        function demandTarget(field, extra) {
            return { area: "demand", field, ...(extra || {}) };
        }

        function validateCrop(crop) {
            const errors = [];
            const cropId = String(crop && crop.id || "");
            const cropName = String(crop && (crop.plant || crop.id) || "Crop");
            if (!crop || typeof crop !== "object") return [makeValidation("crop", "crop.missing", "Add a crop before planning demand.", { field: "crop", target: { area: "crop-list" } })];
            if (!crop.id) errors.push(makeValidation("crop", "crop.missing_id", "This crop row needs an id.", { cropId, field: "id", target: cropTarget(crop, "basics", "id") }));
            if (!crop.plantId) errors.push(makeValidation("crop", "crop.missing_plant_id", `Choose a plant for ${cropName}.`, { cropId, field: "plantId", target: cropTarget(crop, "basics", "plantId") }));
            if (!Number.isFinite(Number(crop.kgPerPlant)) || Number(crop.kgPerPlant) <= 0) {
                errors.push(makeValidation("crop", "crop.invalid_kg_per_plant", `Enter kg/plant greater than 0 for ${cropName}.`, { cropId, field: "kgPerPlant", target: cropTarget(crop, "basics", "kgPerPlant") }));
            }
            if (PlanMath.hasYmd(crop.harvestStart) && PlanMath.hasYmd(crop.harvestEnd) && crop.harvestStart > crop.harvestEnd) {
                errors.push(makeValidation("crop", "crop.reversed_harvest_window", `Set ${cropName} harvest start on or before harvest end.`, { cropId, field: "harvestStart", target: cropTarget(crop, "basics", "harvestStart") }));
            }

            const packageUnitKeys = new Set();
            for (const [packageIndex, pkg] of (crop.packages || []).entries()) {
                const unit = String(pkg.unit || "").trim();
                const unitKey = unit.toLowerCase();
                const baseType = String(pkg.baseType || "").trim().toLowerCase();
                const baseQty = Number(pkg.baseQty);
                const packageLabel = unit || `package ${packageIndex + 1}`;
                if (!unit) errors.push(makeValidation("crop", "crop.package_blank_unit", `Enter a unit for ${cropName} package ${packageIndex + 1}.`, { cropId, packageIndex, field: "unit", target: cropTarget(crop, "packages", "unit", { packageIndex }) }));
                else if (packageUnitKeys.has(unitKey)) errors.push(makeValidation("crop", "crop.package_duplicate_unit", `Use a unique package unit for ${cropName}: ${unit}.`, { cropId, packageIndex, field: "unit", target: cropTarget(crop, "packages", "unit", { packageIndex }) }));
                else packageUnitKeys.add(unitKey);
                if (!Number.isFinite(baseQty) || baseQty <= 0) errors.push(makeValidation("crop", "crop.package_invalid_base_qty", `Enter package quantity greater than 0 for ${cropName} ${packageLabel}.`, { cropId, packageIndex, field: "baseQty", target: cropTarget(crop, "packages", "baseQty", { packageIndex }) }));
                if (baseType !== "kg" && baseType !== "plant" && baseType !== "plants") errors.push(makeValidation("crop", "crop.package_invalid_base_type", `Choose kg or plant for ${cropName} ${packageLabel} package base.`, { cropId, packageIndex, field: "baseType", target: cropTarget(crop, "packages", "baseType", { packageIndex }) }));
                if ((baseType === "plant" || baseType === "plants") && !(Number(crop.kgPerPlant) > 0)) {
                    errors.push(makeValidation("crop", "crop.package_needs_kg_per_plant", `Enter kg/plant before using plant-based packages for ${cropName}.`, { cropId, packageIndex, field: "kgPerPlant", target: cropTarget(crop, "basics", "kgPerPlant", { packageIndex }) }));
                }
            }

            const germinationRate = Number(crop.germRate);
            if (!Number.isFinite(germinationRate) || germinationRate <= 0 || germinationRate > 1) {
                errors.push(makeValidation("crop", "crop.invalid_germination_rate", `Enter germination rate from 0.01 through 1 for ${cropName}.`, { cropId, field: "germRate", target: cropTarget(crop, "basics", "germRate") }));
            }
            return errors;
        }

        function validateCsa(plan) {
            const errors = [];
            if (plan && plan.csa && plan.csa.enabled) {
                if (!Number.isFinite(Number(plan.csa.boxesPerWeek)) || Number(plan.csa.boxesPerWeek) <= 0) {
                    errors.push(makeValidation("csa", "csa.invalid_boxes_per_week", "Enter CSA boxes/week greater than 0.", { field: "boxesPerWeek", target: csaTarget("boxesPerWeek") }));
                }
                if (PlanMath.hasYmd(plan.csa.start) && PlanMath.hasYmd(plan.csa.end) && plan.csa.start > plan.csa.end) {
                    errors.push(makeValidation("csa", "csa.reversed_date_range", "Set CSA start on or before CSA end.", { field: "start", target: csaTarget("start") }));
                }
                for (const [componentIndex, component] of (plan.csa.components || []).entries()) {
                    const crop = PlanMath.findCrop(plan, component.cropId);
                    if (!crop) {
                        errors.push(makeValidation("csa", "csa.component_missing_crop", `Choose a crop for CSA component ${componentIndex + 1}.`, { componentIndex, field: "cropId", target: csaTarget("cropId", { componentIndex }) }));
                        continue;
                    }
                    const cropName = String(crop.plant || crop.id);
                    const from = component.start || plan.csa.start;
                    const to = component.end || plan.csa.end;
                    if (!PlanMath.hasYmd(from) || !PlanMath.hasYmd(to)) {
                        errors.push(makeValidation("csa", "csa.component_missing_dates", `Enter CSA component dates for ${cropName}.`, { cropId: String(crop.id || ""), componentIndex, field: "start", target: csaTarget("start", { componentIndex }) }));
                    }
                    if (PlanMath.hasYmd(from) && PlanMath.hasYmd(to) && from > to) {
                        errors.push(makeValidation("csa", "csa.component_reversed_dates", `Set CSA component start on or before end for ${cropName}.`, { cropId: String(crop.id || ""), componentIndex, field: "start", target: csaTarget("start", { componentIndex }) }));
                    }
                    if (!Number.isFinite(PlanMath.resolveUnitToKgPerUnit(crop, component.unit))) {
                        errors.push(makeValidation("csa", "csa.component_unresolved_unit", `Choose a valid CSA unit for ${cropName}.`, { cropId: String(crop.id || ""), componentIndex, field: "unit", target: csaTarget("unit", { componentIndex }) }));
                    }
                }
            }
            return errors;
        }

        function validateDemand(plan) {
            const errors = [];
            const channels = (plan && plan.demandChannels) || [];
            const demands = (plan && plan.demands) || [];
            const channelIds = new Set();
            for (const channel of channels) {
                const id = String(channel && channel.id || "").trim();
                if (!id) errors.push(makeValidation("demand", "demand.channel_missing_id", "Demand channel needs an id.", { field: "channelId", target: demandTarget("channelId") }));
                else if (channelIds.has(id)) errors.push(makeValidation("demand", "demand.channel_duplicate_id", `Use a unique demand channel id: ${id}.`, { field: "channelId", target: demandTarget("channelId", { channelId: id }) }));
                else channelIds.add(id);
                if (!String(channel && channel.label || "").trim()) errors.push(makeValidation("demand", "demand.channel_missing_label", `Enter a label for demand channel ${id || "unknown"}.`, { field: "label", target: demandTarget("label", { channelId: id }) }));
                if (!DEMAND_CHANNEL_TYPES.includes(String(channel && channel.type || ""))) errors.push(makeValidation("demand", "demand.channel_invalid_type", `Choose a valid type for demand channel ${id || "unknown"}.`, { field: "type", target: demandTarget("type", { channelId: id }) }));
            }
            const demandIds = new Set();
            for (const [lineIndex, line] of demands.entries()) {
                const id = String(line && line.id || "").trim();
                const crop = PlanMath.findCrop(plan, line && line.cropId);
                if (!id) errors.push(makeValidation("demand", "demand.line_missing_id", "Demand line needs an id.", { field: "id", target: demandTarget("id", { lineIndex }) }));
                else if (demandIds.has(id)) errors.push(makeValidation("demand", "demand.line_duplicate_id", `Use a unique demand line id: ${id}.`, { field: "id", target: demandTarget("id", { lineId: id, lineIndex }) }));
                else demandIds.add(id);
                if (!channelIds.has(String(line && line.channelId || ""))) errors.push(makeValidation("demand", "demand.line_missing_channel", `Choose a valid channel for demand line ${id || "unknown"}.`, { field: "channelId", target: demandTarget("channelId", { lineId: id, lineIndex }) }));
                if (!crop) errors.push(makeValidation("demand", "demand.line_missing_crop", `Choose a crop for demand line ${id || "unknown"}.`, { field: "cropId", target: demandTarget("cropId", { lineId: id, lineIndex }) }));
                if (!Number.isFinite(Number(line && line.qty)) || Number(line.qty) <= 0) errors.push(makeValidation("demand", "demand.line_invalid_quantity", `Enter quantity greater than 0 for demand line ${id || "unknown"}.`, { field: "qty", target: demandTarget("qty", { lineId: id, lineIndex }) }));
                if (!DEMAND_FREQUENCIES.includes(String(line && line.frequency || ""))) errors.push(makeValidation("demand", "demand.line_invalid_frequency", `Choose a valid frequency for demand line ${id || "unknown"}.`, { field: "frequency", target: demandTarget("frequency", { lineId: id, lineIndex }) }));
                if (!Number.isInteger(Number(line && line.everyN)) || Number(line.everyN) < 1) errors.push(makeValidation("demand", "demand.line_invalid_every_n", `Enter every value greater than 0 for demand line ${id || "unknown"}.`, { field: "everyN", target: demandTarget("everyN", { lineId: id, lineIndex }) }));
                if (!DEMAND_PRIORITIES.includes(String(line && line.priority || ""))) errors.push(makeValidation("demand", "demand.line_invalid_priority", `Choose a valid priority for demand line ${id || "unknown"}.`, { field: "priority", target: demandTarget("priority", { lineId: id, lineIndex }) }));
                if (!PlanMath.hasYmd(line && line.from) || !PlanMath.hasYmd(line && line.to)) errors.push(makeValidation("demand", "demand.line_missing_dates", `Enter demand dates for line ${id || "unknown"}.`, { field: "from", target: demandTarget("from", { lineId: id, lineIndex }) }));
                if (PlanMath.hasYmd(line && line.from) && PlanMath.hasYmd(line && line.to) && line.from > line.to) errors.push(makeValidation("demand", "demand.line_reversed_dates", `Set demand start on or before end for line ${id || "unknown"}.`, { field: "from", target: demandTarget("from", { lineId: id, lineIndex }) }));
                if (crop && !Number.isFinite(PlanMath.resolveUnitToKgPerUnit(crop, line && line.unit))) errors.push(makeValidation("demand", "demand.line_unresolved_unit", `Choose a valid unit for demand line ${id || "unknown"}.`, { cropId: String(crop.id || ""), field: "unit", target: demandTarget("unit", { lineId: id, lineIndex }) }));
            }
            return errors;
        }

        function validate(plan) {
            const errors = [];
            const crops = (plan && plan.crops) || [];
            for (const crop of crops) errors.push(...validateCrop(crop));

            const duplicate = findFirstDuplicateCrop(plan);
            if (duplicate) errors.push(makeValidation("crop", "crop.duplicate_identity", "Each plant/variety can appear only once in a year plan.", { cropId: String(duplicate.second && duplicate.second.id || ""), field: "varietyId", target: cropTarget(duplicate.second, "basics", "varietyId") }));
            errors.push(...validateDemand(plan));
            errors.push(...validateCsa(plan));
            return errors;
        }

        return {
            clonePlain,
            DEFAULT_DEMAND_CHANNELS,
            DEMAND_CHANNEL_TYPES,
            DEMAND_FREQUENCIES,
            DEMAND_PRIORITIES,
            createEmptyPlan,
            normalizeYieldFieldsForRuntime,
            normalizeForRuntime,
            stripRuntimeFields,
            serializeForPersistence,
            makeCropIdentityKey,
            getCropIdentityKey,
            findDuplicateCrop,
            findFirstDuplicateCrop,
            setCropHarvestWindowSource,
            inferMethodCategoryFromMethodId,
            normalizeCropMethodFieldsForRuntime,
            validateCrop,
            validateDemand,
            validateCsa,
            validate
        };
    })();

    // -------------------- PlanRepository --------------------
    /**
     * Owns all persisted year-plan, template, and unit-default storage contracts.
     */
    const PlanRepository = (() => {
        function readJsonMap(cell, attributeName) {
            const raw = DiagramStore.getCellAttr(cell, attributeName, "");
            const parsed = Env.safeJsonStringParse(raw, null);
            return (parsed && typeof parsed === "object" && !Array.isArray(parsed)) ? parsed : {};
        }

        function writeJsonMap(cell, attributeName, map) {
            if (!cell) return;
            Env.model.beginUpdate();
            try {
                DiagramStore.setCellAttr(cell, attributeName, JSON.stringify(map || {}));
            } finally {
                Env.model.endUpdate();
            }
            Env.graph.refresh(cell);
        }

        function getDiagramRootCell() {
            try { return Env.model.getRoot(); } catch (_) { return null; }
        }

        function findDiagramMetadataCell() {
            const root = getDiagramRootCell();
            if (!root) return null;
            const queue = [root];
            while (queue.length) {
                const cell = queue.shift();
                if (DiagramStore.getCellAttr(cell, Env.ATTRS.PLAN_METADATA_CELL_ATTR, "") === "1") return cell;
                const count = Env.model.getChildCount(cell);
                for (let index = 0; index < count; index++) queue.push(Env.model.getChildAt(cell, index));
            }
            return null;
        }

        /**
         * Creates one invisible vertex so diagram-level JSON is encoded as an XML user object.
         */
        function createDiagramMetadataCell() {
            const parent = Env.graph.getDefaultParent ? Env.graph.getDefaultParent() : getDiagramRootCell();
            if (!parent || typeof Env.graph.insertVertex !== "function") return null;
            const xmlDocument = (typeof mxUtils !== "undefined" && typeof mxUtils.createXmlDocument === "function")
                ? mxUtils.createXmlDocument() : document;
            const value = xmlDocument.createElement("uslYearPlannerMetadata");
            value.setAttribute(Env.ATTRS.PLAN_METADATA_CELL_ATTR, "1");
            const cell = Env.graph.insertVertex(parent, null, value, 0, 0, 0, 0, "shape=none;opacity=0;noLabel=1;locked=1;");
            if (cell && typeof cell.setVisible === "function") cell.setVisible(false);
            if (cell && typeof cell.setConnectable === "function") cell.setConnectable(false);
            return cell;
        }

        function rawCellAttribute(cell, attributeName) {
            return DiagramStore.getCellAttr(cell, attributeName, "");
        }

        function parseJsonMap(raw) {
            const parsed = Env.safeJsonStringParse(raw, null);
            return (parsed && typeof parsed === "object" && !Array.isArray(parsed)) ? parsed : {};
        }

        function readRootJsonMap(attributeName) {
            const metadataCell = findDiagramMetadataCell();
            const metadataRaw = rawCellAttribute(metadataCell, attributeName);
            if (metadataRaw !== "") return parseJsonMap(metadataRaw);
            return readJsonMap(getDiagramRootCell(), attributeName);
        }

        /**
         * Copies both legacy root maps on the first write, then makes the metadata cell canonical.
         */
        function writeRootJsonMap(attributeName, map) {
            const root = getDiagramRootCell();
            Env.model.beginUpdate();
            let metadataCell = null;
            try {
                metadataCell = findDiagramMetadataCell() || createDiagramMetadataCell();
                if (!metadataCell) return;
                for (const legacyAttribute of [Env.ATTRS.PLAN_TEMPLATES_ATTR, Env.ATTRS.PLAN_UNIT_DEFAULTS_ATTR]) {
                    const metadataRaw = rawCellAttribute(metadataCell, legacyAttribute);
                    const legacyRaw = rawCellAttribute(root, legacyAttribute);
                    if (metadataRaw === "" && legacyRaw !== "") DiagramStore.setCellAttr(metadataCell, legacyAttribute, legacyRaw);
                    if (legacyRaw !== "") DiagramStore.setCellAttr(root, legacyAttribute, null);
                }
                DiagramStore.setCellAttr(metadataCell, attributeName, JSON.stringify(map || {}));
            } finally {
                Env.model.endUpdate();
            }
            if (metadataCell) Env.graph.refresh(metadataCell);
        }

        function loadPlanForYear(moduleCell, year) {
            const stored = readJsonMap(moduleCell, Env.ATTRS.PLAN_YEARS_ATTR)[String(year)];
            return (stored && typeof stored === "object" && !Array.isArray(stored))
                ? PlanSchema.normalizeForRuntime(PlanSchema.clonePlain(stored), year)
                : null;
        }

        function savePlanForYear(moduleCell, year, plan) {
            const plans = readJsonMap(moduleCell, Env.ATTRS.PLAN_YEARS_ATTR);
            plans[String(year)] = PlanSchema.serializeForPersistence(plan);
            writeJsonMap(moduleCell, Env.ATTRS.PLAN_YEARS_ATTR, plans);
        }

        function deletePlanForYear(moduleCell, year) {
            const plans = readJsonMap(moduleCell, Env.ATTRS.PLAN_YEARS_ATTR);
            delete plans[String(year)];
            writeJsonMap(moduleCell, Env.ATTRS.PLAN_YEARS_ATTR, plans);
        }

        function daysInMonthLocal(year, monthIndex) {
            return new Date(year, monthIndex + 1, 0).getDate();
        }

        function shiftYmdByYears(ymd, deltaYears) {
            if (!PlanMath.hasYmd(ymd)) return ymd || "";
            const match = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (!match) return ymd;
            const nextYear = Number(match[1]) + Number(deltaYears || 0);
            const monthIndex = Number(match[2]) - 1;
            const safeDay = Math.min(Number(match[3]), daysInMonthLocal(nextYear, monthIndex));
            return PlanMath.toIsoDateLocal(new Date(nextYear, monthIndex, safeDay));
        }

        function shiftFieldYear(target, key, deltaYears) {
            if (target && PlanMath.hasYmd(target[key])) target[key] = shiftYmdByYears(target[key], deltaYears);
        }

        function shiftPlanDateFields(plan, deltaYears) {
            if (!plan || !Number.isFinite(Number(deltaYears)) || Number(deltaYears) === 0) return;
            for (const crop of (plan.crops || [])) {
                shiftFieldYear(crop, "harvestStart", deltaYears);
                shiftFieldYear(crop, "harvestEnd", deltaYears);
            }
            for (const demandLine of (plan.demands || [])) {
                shiftFieldYear(demandLine, "from", deltaYears);
                shiftFieldYear(demandLine, "to", deltaYears);
            }
            if (!plan.csa) return;
            shiftFieldYear(plan.csa, "start", deltaYears);
            shiftFieldYear(plan.csa, "end", deltaYears);
            for (const component of (plan.csa.components || [])) {
                shiftFieldYear(component, "start", deltaYears);
                shiftFieldYear(component, "end", deltaYears);
            }
        }

        function listTemplateNames() {
            return Object.keys(readRootJsonMap(Env.ATTRS.PLAN_TEMPLATES_ATTR)).sort();
        }

        function loadTemplateByName(name) {
            const template = readRootJsonMap(Env.ATTRS.PLAN_TEMPLATES_ATTR)[String(name || "")];
            return (template && typeof template === "object" && !Array.isArray(template)) ? template : null;
        }

        function saveTemplateByName(name, template) {
            const key = String(name || "").trim();
            if (!key) return;
            const templates = readRootJsonMap(Env.ATTRS.PLAN_TEMPLATES_ATTR);
            templates[key] = template;
            writeRootJsonMap(Env.ATTRS.PLAN_TEMPLATES_ATTR, templates);
        }

        function deleteTemplateByName(name) {
            const key = String(name || "").trim();
            if (!key) return;
            const templates = readRootJsonMap(Env.ATTRS.PLAN_TEMPLATES_ATTR);
            delete templates[key];
            writeRootJsonMap(Env.ATTRS.PLAN_TEMPLATES_ATTR, templates);
        }

        function rekeyTemplateToPlan(template, year) {
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
            for (const demandLine of rekeyed.demands) {
                demandLine.cropId = idMap.has(demandLine.cropId) ? idMap.get(demandLine.cropId) : "";
            }
            if (idMap.has(rekeyed.cropFilterId)) rekeyed.cropFilterId = idMap.get(rekeyed.cropFilterId);
            else delete rekeyed.cropFilterId;
            delete rekeyed.templateBaseYear;
            return PlanSchema.normalizeForRuntime(rekeyed, targetYear);
        }

        function getDefaultsForPlant(plantId) {
            const value = readRootJsonMap(Env.ATTRS.PLAN_UNIT_DEFAULTS_ATTR)[String(plantId || "")];
            return Array.isArray(value) ? value : null;
        }

        function saveDefaultsForPlant(plantId, packages) {
            const key = String(plantId || "").trim();
            if (!key) return;
            const defaults = readRootJsonMap(Env.ATTRS.PLAN_UNIT_DEFAULTS_ATTR);
            defaults[key] = Array.isArray(packages) ? packages : [];
            writeRootJsonMap(Env.ATTRS.PLAN_UNIT_DEFAULTS_ATTR, defaults);
        }

        return {
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





























    // -------------------- DiagramPlanReader --------------------
    const DiagramPlanReader = (() => {
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

            const y = Number(selectedYear);
            if (!Number.isFinite(y)) return false;

            const rawStart = String(DiagramStore.getCellAttr(tg, "season_start_year", "")).trim();
            const startY = rawStart ? Number(rawStart) : NaN;

            if (isPerennialTilerGroup(tg)) {
                if (Number.isFinite(startY)) return y >= startY;
                return true;
            }

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
            const endMs = PlanMath.parseYmdLocalToMs(harvestEndYmd(tg));
            return Number.isFinite(endMs) ? new Date(endMs).getFullYear() : NaN;
        }

        function harvestWindowOverlapsYear(tg, year) {
            const startMs = PlanMath.parseYmdLocalToMs(harvestStartYmd(tg));
            const endMs = PlanMath.parseYmdLocalToMs(harvestEndYmd(tg));
            const selectedYear = Number(year);
            if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !Number.isFinite(selectedYear)) return false;
            if (startMs > endMs) return false;

            const yearStartMs = PlanMath.parseYmdLocalToMs(`${selectedYear}-01-01`);
            const yearEndExMs = PlanMath.parseYmdLocalToMs(`${selectedYear + 1}-01-01`);
            const windowStartMs = startMs;
            const windowEndExMs = PlanMath.addDaysMs(endMs, 1);
            return windowStartMs < yearEndExMs && windowEndExMs > yearStartMs;
        }

        function getTilerGroups(moduleCell) {
            return getAllDescendants(Env.model, moduleCell).filter(isTilerGroupCell);
        }

        /**
         * Returns stable crop metadata from every tiler group in the garden module.
         * Database availability and legacy variety-name resolution remain caller concerns.
         */
        function readGardenCropCandidates(moduleCell) {
            const candidates = [];
            for (const tilerGroup of getTilerGroups(moduleCell)) {
                const plantId = String(DiagramStore.getCellAttr(tilerGroup, "plant_id", "") || "").trim();
                if (!plantId) continue;
                candidates.push({
                    plantId,
                    plantName: String(DiagramStore.getCellAttr(tilerGroup, "plant_name", "") || "").trim(),
                    varietyId: String(DiagramStore.getCellAttr(tilerGroup, "variety_id", "") || "").trim() || null,
                    varietyName: String(DiagramStore.getCellAttr(tilerGroup, "variety_name", "") || "").trim()
                });
            }
            return candidates;
        }

        function actualPlantsMapFromTilers(tilerGroups, selectedYear, resolveCropKey) {
            const actualPlantsByCropKey = new Map();
            for (const tilerGroup of tilerGroups) {
                if (!shouldIncludeTilerGroupInYear(tilerGroup, selectedYear, harvestEndLocalYear)) continue;
                const plantCount = Number(DiagramStore.getCellAttr(tilerGroup, "plant_count", ""));
                const count = Number.isFinite(plantCount) && plantCount > 0 ? Math.trunc(plantCount) : 0;
                if (count <= 0) continue;
                const key = resolveCropKey ? resolveCropKey(tilerGroup) : getCropKeyFromTilerGroup(tilerGroup);
                if (!key) continue;
                actualPlantsByCropKey.set(key, (actualPlantsByCropKey.get(key) || 0) + count);
            }
            return actualPlantsByCropKey;
        }

        function actualPlantsMapFromModule(moduleCell, selectedYear) {
            return actualPlantsMapFromTilers(getTilerGroups(moduleCell), selectedYear);
        }

        function buildActualHarvestSeriesFromTilers(tilerGroups, year, weekStarts, cropKeyToKgPerPlant, resolveCropKey) {
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

                const key = resolveCropKey ? resolveCropKey(tilerGroup) : getCropKeyFromTilerGroup(tilerGroup);
                if (!key) continue;
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

        function buildActualHarvestSeriesByCropKey(moduleCell, year, weekStarts, cropKeyToKgPerPlant) {
            return buildActualHarvestSeriesFromTilers(getTilerGroups(moduleCell), year, weekStarts, cropKeyToKgPerPlant);
        }

        function normalizeIdentityName(value) {
            return String(value || "").trim().toLocaleLowerCase();
        }

        /**
         * Resolves legacy variety-name-only tiler groups against unique planned crop identities.
         */
        function createPlanCropKeyResolver(plan, diagnostics) {
            const plannedByPlantAndVarietyName = new Map();
            for (const crop of ((plan && plan.crops) || [])) {
                const plantId = String(crop && crop.plantId || "").trim();
                const varietyId = String((crop && crop.varietyId) ?? "").trim();
                const varietyName = normalizeIdentityName(crop && crop.variety);
                if (!plantId || !varietyId || !varietyName) continue;
                const lookupKey = `${plantId}|${varietyName}`;
                const matches = plannedByPlantAndVarietyName.get(lookupKey) || [];
                matches.push(getCropKeyFromPlanCrop(crop));
                plannedByPlantAndVarietyName.set(lookupKey, matches);
            }

            return tilerGroup => {
                const plantId = String(DiagramStore.getCellAttr(tilerGroup, "plant_id", "") || "").trim();
                const varietyId = String(DiagramStore.getCellAttr(tilerGroup, "variety_id", "") || "").trim();
                if (!plantId || varietyId) return getCropKeyFromTilerGroup(tilerGroup);

                const varietyName = String(DiagramStore.getCellAttr(tilerGroup, "variety_name", "") || "").trim();
                if (!varietyName) return getCropKeyFromTilerGroup(tilerGroup);

                const matches = plannedByPlantAndVarietyName.get(`${plantId}|${normalizeIdentityName(varietyName)}`) || [];
                const plantName = String(DiagramStore.getCellAttr(tilerGroup, "plant_name", "") || plantId).trim();
                const label = `${plantName} - ${varietyName}`;
                if (matches.length === 1) return matches[0];
                diagnostics.push(matches.length > 1
                    ? `Diagram crop "${label}" matches multiple planned varieties and was ignored.`
                    : `Diagram crop "${label}" has no unique planned variety match and was ignored.`);
                return "";
            };
        }

        /**
         * Scans relevant tiler groups once so counts, weekly harvest, and exact ranges share one identity.
         */
        function collectYearFactsFromTilers(tilerGroups, year, weekStarts, cropKeyToKgPerPlant, plan) {
            const diagnostics = [];
            const resolveCropKey = createPlanCropKeyResolver(plan, diagnostics);
            const actualPlantsByCropKey = new Map();
            const actualHarvestSeriesByCropKey = new Map();
            const actualHarvestDateRangeByCropKey = new Map();
            const ensureSeries = key => {
                if (!actualHarvestSeriesByCropKey.has(key)) actualHarvestSeriesByCropKey.set(key, Array(weekStarts.length).fill(0));
                return actualHarvestSeriesByCropKey.get(key);
            };

            for (const tilerGroup of tilerGroups) {
                if (!shouldIncludeTilerGroupInYear(tilerGroup, year, harvestEndLocalYear)) continue;
                const plantCount = Number(DiagramStore.getCellAttr(tilerGroup, "plant_count", ""));
                const count = Number.isFinite(plantCount) && plantCount > 0 ? Math.trunc(plantCount) : 0;
                if (count <= 0) continue;
                const key = resolveCropKey(tilerGroup);
                if (!key) continue;

                actualPlantsByCropKey.set(key, (actualPlantsByCropKey.get(key) || 0) + count);
                const start = harvestStartYmd(tilerGroup);
                const end = harvestEndYmd(tilerGroup);
                const label = String(DiagramStore.getCellAttr(tilerGroup, "plant_name", "") || key).trim();
                if (!PlanMath.hasYmd(start) || !PlanMath.hasYmd(end)) {
                    diagnostics.push(`Diagram harvest window for "${label}" is incomplete and was ignored.`);
                    continue;
                }
                if (start > end) {
                    diagnostics.push(`Diagram harvest window for "${label}" has start date after end date and was ignored.`);
                    continue;
                }
                if (!harvestWindowOverlapsYear(tilerGroup, year)) continue;

                const currentRange = actualHarvestDateRangeByCropKey.get(key);
                actualHarvestDateRangeByCropKey.set(key, {
                    start: currentRange && currentRange.start < start ? currentRange.start : start,
                    end: currentRange && currentRange.end > end ? currentRange.end : end
                });

                const kgPerPlant = Number(cropKeyToKgPerPlant.get(key));
                if (!Number.isFinite(kgPerPlant) || kgPerPlant <= 0) continue;
                PlanMath.addTotalKgAcrossWindowProrated(
                    ensureSeries(key),
                    weekStarts,
                    start,
                    end,
                    count * kgPerPlant,
                    year
                );
            }

            return {
                actualPlantsByCropKey,
                actualHarvestSeriesByCropKey,
                actualHarvestDateRangeByCropKey,
                diagnostics
            };
        }

        /**
         * Scans module descendants once and returns all diagram facts needed by recalculation.
         */
        function readYearFacts(moduleCell, year, weekStarts, cropKeyToKgPerPlant, plan) {
            const tilerGroups = getTilerGroups(moduleCell);
            return collectYearFactsFromTilers(tilerGroups, year, weekStarts, cropKeyToKgPerPlant, plan);
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
            readGardenCropCandidates,
            createPlanCropKeyResolver,
            readYearFacts
        };
    })();


















    // -------------------- PlanRuntimeService --------------------
    /**
     * Mutates the live plan with diagram-derived values and returns a DOM-free render model.
     */
    const PlanRuntimeService = (() => {
        function addDaysYmd(ymd, days) {
            const ms = PlanMath.parseYmdLocalToMs(ymd);
            return Number.isFinite(ms)
                ? PlanMath.toIsoDateLocal(new Date(PlanMath.addDaysMs(ms, days)))
                : null;
        }

        function cropAvailableEndYmd(crop) {
            if (!PlanMath.hasYmd(crop && crop.harvestEnd)) return null;
            return String(crop.harvestEnd);
        }

        function cropHarvestOverlapsYear(crop, year) {
            if (!crop || !PlanMath.hasYmd(crop.harvestStart) || !PlanMath.hasYmd(crop.harvestEnd)) return false;
            const startMs = PlanMath.parseYmdLocalToMs(crop.harvestStart);
            const endMs = PlanMath.parseYmdLocalToMs(crop.harvestEnd);
            const yearStartMs = PlanMath.parseYmdLocalToMs(`${year}-01-01`);
            const yearEndExMs = PlanMath.parseYmdLocalToMs(`${Number(year) + 1}-01-01`);
            return Number.isFinite(startMs) && Number.isFinite(endMs) && startMs <= endMs && startMs < yearEndExMs && PlanMath.addDaysMs(endMs, 1) > yearStartMs;
        }

        function hasEstimatedHarvestWindow(crop) {
            return !!crop
                && PlanMath.hasYmd(crop.estimatedHarvestStart)
                && PlanMath.hasYmd(crop.estimatedHarvestEnd)
                && String(crop.estimatedHarvestStart) <= String(crop.estimatedHarvestEnd);
        }

        function applyEstimatedHarvestWindow(crop) {
            if (!hasEstimatedHarvestWindow(crop)) return false;
            crop.harvestStart = crop.estimatedHarvestStart; // CHANGE: source-driven dates remain visible in the existing date fields.
            crop.harvestEnd = crop.estimatedHarvestEnd; // CHANGE: source-driven dates remain visible in the existing date fields.
            return true;
        }

        function resolveCropHarvestWindowSource(crop, hasActualSeries, exactRange) {
            const source = String(crop && crop.harvestWindowSource || "manual");
            const hasEstimate = hasEstimatedHarvestWindow(crop);

            if (source === "actual_harvest" && hasActualSeries && exactRange) {
                crop.harvestStart = exactRange.start;
                crop.harvestEnd = exactRange.end;
                PlanSchema.setCropHarvestWindowSource(crop, "actual_harvest");
                return "actual_harvest";
            }

            if (source === "sowing_window_estimate" && hasEstimate) {
                applyEstimatedHarvestWindow(crop);
                PlanSchema.setCropHarvestWindowSource(crop, "sowing_window_estimate");
                return "sowing_window_estimate";
            }

            if (source === "sowing_window_estimate" && !crop.estimatedHarvestUnavailableReason) {
                PlanSchema.setCropHarvestWindowSource(crop, "sowing_window_estimate");
                return "sowing_window_estimate";
            } // CHANGE: newly added crops can show a pending sowing window before dates arrive.

            const manualBlankWindow = source === "manual" && !PlanMath.hasYmd(crop.harvestStart) && !PlanMath.hasYmd(crop.harvestEnd);
            if (!hasActualSeries && hasEstimate && (crop.__harvestWindowSourceMissing || manualBlankWindow)) {
                applyEstimatedHarvestWindow(crop);
                PlanSchema.setCropHarvestWindowSource(crop, "sowing_window_estimate");
                return "sowing_window_estimate";
            }

            PlanSchema.setCropHarvestWindowSource(crop, "manual");
            return "manual";
        }

        function buildCarryoverCrops(moduleCell, year, plan) {
            return []; // CHANGE: supply is actual-record backed only; cross-year diagram harvest records are read directly by DiagramPlanReader.
        }

        function legacyShelfExtendedEndYmd(crop, harvestEnd) {
            if (!PlanMath.hasYmd(harvestEnd)) return null;
            const shelfDays = Math.max(0, Math.trunc(Number(crop && crop.shelfLifeDays) || 0));
            return shelfDays > 0 ? addDaysYmd(harvestEnd, shelfDays) : null;
        }

        function ymdMin(a, b) {
            if (!PlanMath.hasYmd(a)) return b;
            if (!PlanMath.hasYmd(b)) return a;
            return a < b ? a : b;
        }

        function ymdMax(a, b) {
            if (!PlanMath.hasYmd(a)) return b;
            if (!PlanMath.hasYmd(b)) return a;
            return a > b ? a : b;
        }

        function clampYmdIntoRange(value, lower, upper) {
            if (!PlanMath.hasYmd(value) || (!PlanMath.hasYmd(lower) && !PlanMath.hasYmd(upper))) return value;
            let clamped = value;
            if (PlanMath.hasYmd(lower) && clamped < lower) clamped = lower;
            if (PlanMath.hasYmd(upper) && clamped > upper) clamped = upper;
            return clamped;
        }

        function shouldAutoReplaceDate(current, lastAutomatic) {
            return !PlanMath.hasYmd(current)
                || (PlanMath.hasYmd(lastAutomatic) && current === lastAutomatic);
        }

        function hasPositiveActualHarvestSeries(series) {
            return Array.isArray(series) && series.some(value => Number(value) > 0);
        }

        function syncCropDatesIfEnabled(plan, crop, oldSnapshot) {
            if (!crop || !crop.syncharvest) return;
            const harvestStart = crop.harvestStart;
            const harvestEnd = crop.harvestEnd;
            const availableEnd = cropAvailableEndYmd(crop);
            const previousHarvestEnd = oldSnapshot && oldSnapshot.he;
            const previousLegacyEnd = legacyShelfExtendedEndYmd(crop, previousHarvestEnd);
            const csa = plan && plan.csa ? plan.csa : null;

            crop.__sync_lastHarvestStart = crop.__sync_lastHarvestStart ?? (oldSnapshot && oldSnapshot.hs) ?? "";
            crop.__sync_lastHarvestEnd = crop.__sync_lastHarvestEnd ?? (oldSnapshot && oldSnapshot.he) ?? "";
            crop.__sync_lastAvailEnd = crop.__sync_lastAvailEnd ?? (oldSnapshot && oldSnapshot.availEnd) ?? "";

            for (const demandLine of ((plan && plan.demands) || [])) {
                if (!demandLine || demandLine.cropId !== crop.id) continue;
                if (previousLegacyEnd && String(demandLine.to || "") === previousLegacyEnd) demandLine.to = previousHarvestEnd;
                if (shouldAutoReplaceDate(demandLine.from, crop.__sync_lastHarvestStart) && PlanMath.hasYmd(harvestStart)) {
                    demandLine.from = harvestStart;
                }
                demandLine.from = clampYmdIntoRange(demandLine.from, harvestStart, availableEnd);

                const lastAutomaticEnd = crop.__sync_lastAvailEnd || crop.__sync_lastHarvestEnd;
                const looksAutomatic = PlanMath.hasYmd(harvestEnd)
                    && PlanMath.hasYmd(demandLine.to)
                    && String(demandLine.to) === String(harvestEnd);
                if (shouldAutoReplaceDate(demandLine.to, lastAutomaticEnd) || looksAutomatic) {
                    if (PlanMath.hasYmd(availableEnd)) demandLine.to = availableEnd;
                    else if (PlanMath.hasYmd(harvestEnd)) demandLine.to = harvestEnd;
                }
                demandLine.to = clampYmdIntoRange(demandLine.to, harvestStart, availableEnd);
            }

            if (csa && Array.isArray(csa.components)) {
                for (const component of csa.components) {
                    if (!component || component.cropId !== crop.id) continue;
                    if (previousLegacyEnd && String(component.end || "") === previousLegacyEnd) component.end = previousHarvestEnd;
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

        function autoFillAndClampCsa(plan) {
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

        function recalculate(moduleCell, year, plan) {
            PlanSchema.normalizeForRuntime(plan, year);
            const selectedYear = Number(plan.year);
            plan.__carryoverCrops = buildCarryoverCrops(moduleCell, selectedYear, plan);
            const weekStartDow = plan.weekStartDow;
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
                plan
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
                const exactRange = diagramFacts.actualHarvestDateRangeByCropKey.get(key);
                const hasActualSeries = hasPositiveActualHarvestSeries(crop.__actualHarvestWeeklyKg);
                resolveCropHarvestWindowSource(crop, hasActualSeries, exactRange); // CHANGE: choose manual, actual, or sowing-window estimate before downstream math.
            }

            for (const crop of plan.crops) syncCropDatesIfEnabled(plan, crop, beforeHarvestById.get(crop.id));
            autoFillAndClampCsa(plan);

            const warnings = Array.from(diagramFacts.diagnostics || []);
            if (plan.__carryoverCrops.length) warnings.push(`${plan.__carryoverCrops.length} prior-year harvest window${plan.__carryoverCrops.length === 1 ? '' : 's'} included as carryover supply.`);
            const weekly = PlanMath.computePlanWeekly(plan, warnings);
            if (plan.csa && weekly && weekly.csa) {
                plan.csa.__componentValuePerBox = Math.max(0, Number(weekly.csa.componentValuePerBox) || 0);
                if (plan.csa.salePriceMode !== "manual") plan.csa.salePricePerBox = Math.max(0, Number(weekly.csa.salePricePerBox) || 0);
            }
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
                    harvestWindowSource: crop.harvestWindowSource || "manual",
                    estimatedHarvestStart: crop.estimatedHarvestStart || "",
                    estimatedHarvestEnd: crop.estimatedHarvestEnd || "",
                    estimatedHarvestUnavailableReason: crop.estimatedHarvestUnavailableReason || "",
                    actualHarvestWeeklyKg: crop.__actualHarvestWeeklyKg
                });
            }

            return {
                plan,
                year: selectedYear,
                weekStarts,
                weekly,
                cropTotals,
                warnings,
                derivedByCropId
            };
        }

        return { recalculate, cropAvailableEndYmd, syncCropDatesIfEnabled, autoFillAndClampCsa, addDaysYmd, hasEstimatedHarvestWindow };
    })();

    const PlanningCore = (() => {
        function clonePlan(plan, year) {
            const fallbackYear = Number(year || plan && plan.year) || new Date().getFullYear();
            const copy = PlanSchema.clonePlain(plan || PlanSchema.createEmptyPlan(fallbackYear));
            PlanSchema.normalizeForRuntime(copy, fallbackYear);
            return copy;
        }

        function sumSeries(series) {
            return (Array.isArray(series) ? series : []).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
        }

        function summarizeAggregate(aggregate) {
            return {
                targetKg: sumSeries(aggregate && aggregate.target),
                usableSupplyKg: sumSeries(aggregate && aggregate.usableSupply),
                shortKg: sumSeries(aggregate && aggregate.short),
                potentialRevenue: sumSeries(aggregate && aggregate.potentialRevenue),
                fulfilledRevenue: sumSeries(aggregate && aggregate.fulfilledRevenue)
            };
        }

        function buildCropSummaries(plan, weekly) {
            return ((plan && plan.crops) || []).map(crop => {
                const arrays = weekly && weekly.perCrop && weekly.perCrop.get(String(crop.id));
                const targetKg = sumSeries(arrays && arrays.target);
                const shortKg = sumSeries(arrays && arrays.short);
                return {
                    cropId: String(crop.id || ""),
                    plantId: String(crop.plantId || ""),
                    varietyId: String(crop.varietyId || ""),
                    label: [crop.plant, crop.variety].filter(Boolean).join(" - ") || String(crop.id || ""),
                    targetKg,
                    harvestKg: sumSeries(arrays && arrays.supply),
                    usableSupplyKg: sumSeries(arrays && arrays.usableSupply),
                    shortKg,
                    surplusKg: sumSeries(arrays && arrays.surplus),
                    status: targetKg <= EPS ? "no_demand" : (shortKg > EPS ? "short" : "satisfied")
                };
            });
        }

        function buildWeekSummaries(plan, weekly) {
            const weeks = weekly && Array.isArray(weekly.weeks) ? weekly.weeks : [];
            return weeks.map((week, weekIndex) => {
                const cropShortages = [];
                for (const crop of ((plan && plan.crops) || [])) {
                    const arrays = weekly.perCrop && weekly.perCrop.get(String(crop.id));
                    const shortKg = Math.max(0, Number(arrays && arrays.short && arrays.short[weekIndex]) || 0);
                    if (shortKg > EPS) cropShortages.push({ cropId: String(crop.id || ""), label: [crop.plant, crop.variety].filter(Boolean).join(" - ") || String(crop.id || ""), shortKg });
                }
                return {
                    weekIndex,
                    start: week && week.ymd || "",
                    targetKg: Math.max(0, Number(weekly.targetTotal && weekly.targetTotal[weekIndex]) || 0),
                    shortKg: Math.max(0, Number(weekly.shortTotal && weekly.shortTotal[weekIndex]) || 0),
                    cropShortages
                };
            });
        }

        function coverageFromRuntime(runtime, warnings) {
            const plan = runtime && runtime.plan;
            const weekly = runtime && runtime.weekly;
            const prioritySummaries = {};
            for (const priority of ["committed", "target", "optional"]) {
                prioritySummaries[priority] = summarizeAggregate(weekly && weekly.perPriority && weekly.perPriority.get(priority));
            }
            return {
                plan,
                year: runtime && runtime.year,
                weekStarts: runtime && runtime.weekStarts || weekly && weekly.weeks || [],
                weekly,
                cropTotals: runtime && runtime.cropTotals || PlanMath.computePlanCropTotals(plan, weekly),
                warnings: Array.from(warnings || runtime && runtime.warnings || []),
                derivedByCropId: runtime && runtime.derivedByCropId || new Map(),
                cropSummaries: buildCropSummaries(plan, weekly),
                weekSummaries: buildWeekSummaries(plan, weekly),
                prioritySummaries,
                totals: {
                    targetKg: sumSeries(weekly && weekly.targetTotal),
                    harvestKg: sumSeries(weekly && weekly.supplyTotal),
                    usableSupplyKg: sumSeries(weekly && weekly.usableSupplyTotal),
                    shortKg: sumSeries(weekly && weekly.shortTotal),
                    surplusKg: sumSeries(weekly && weekly.surplusTotal)
                }
            };
        }

        function computeYearCoverage(input) {
            const options = input || {};
            const plan = clonePlan(options.plan, options.year);
            const year = Number(options.year || plan.year);
            if (options.moduleCell) return coverageFromRuntime(PlanRuntimeService.recalculate(options.moduleCell, year, plan));
            const warnings = [];
            const weekly = PlanMath.computePlanWeekly(plan, warnings);
            return coverageFromRuntime({
                plan,
                year,
                weekStarts: weekly.weeks,
                weekly,
                cropTotals: PlanMath.computePlanCropTotals(plan, weekly),
                warnings,
                derivedByCropId: new Map()
            }, warnings);
        }

        function candidateHarvestSeries(plan, candidate, weekly) {
            const weeks = weekly && weekly.weeks || PlanMath.buildWeekStartsForYearLocal(Number(plan.year), plan.weekStartDow);
            const series = Array(weeks.length).fill(0);
            const kgPerPlant = Number(candidate && candidate.kgPerPlant);
            const plantCount = Math.max(0, Math.trunc(Number(candidate && candidate.plantCount) || 0));
            if (plantCount <= 0 || !Number.isFinite(kgPerPlant) || kgPerPlant <= 0) return series;
            PlanMath.addTotalKgAcrossWindowProrated(series, weeks, candidate.harvestStart, candidate.harvestEnd, plantCount * kgPerPlant, Number(plan.year));
            return series;
        }

        function simulateCandidatePlanting(input) {
            const base = computeYearCoverage(input || {});
            const candidate = input && input.candidate || {};
            const nextPlan = clonePlan(base.plan, base.year);
            const crop = PlanMath.findCrop(nextPlan, candidate.cropId);
            if (!crop) return { base, coverage: base, demandServedKg: 0, projectedSurplusKg: 0, reason: "missing_crop" };
            const addSeries = candidateHarvestSeries(nextPlan, candidate, base.weekly);
            const existingSeries = Array.isArray(crop.__actualHarvestWeeklyKg) ? crop.__actualHarvestWeeklyKg : Array(addSeries.length).fill(0);
            crop.__actualHarvestWeeklyKg = addSeries.map((value, index) => Math.max(0, Number(value) || 0) + Math.max(0, Number(existingSeries[index]) || 0));
            PlanSchema.setCropHarvestWindowSource(crop, "actual_harvest"); // CHANGE: simulated candidate supply behaves like an actual harvest source.
            if (PlanMath.hasYmd(candidate.harvestStart)) crop.harvestStart = candidate.harvestStart;
            if (PlanMath.hasYmd(candidate.harvestEnd)) crop.harvestEnd = candidate.harvestEnd;
            const coverage = computeYearCoverage({ plan: nextPlan, year: base.year });
            return {
                base,
                coverage,
                demandServedKg: Math.max(0, base.totals.shortKg - coverage.totals.shortKg),
                projectedSurplusKg: Math.max(0, coverage.totals.surplusKg - base.totals.surplusKg)
            };
        }

        function recommendPlantCount(input) {
            const coverage = computeYearCoverage(input || {});
            const candidate = input && input.candidate || {};
            const crop = PlanMath.findCrop(coverage.plan, candidate.cropId);
            const kgPerPlant = Number(candidate.kgPerPlant ?? (crop && crop.kgPerPlant));
            if (!crop || !Number.isFinite(kgPerPlant) || kgPerPlant <= 0) return { plantCount: 0, reachableShortKg: 0, reason: "missing_yield" };
            const arrays = coverage.weekly && coverage.weekly.perCrop && coverage.weekly.perCrop.get(String(crop.id));
            const weeks = coverage.weekStarts || [];
            const shelfWeeks = Math.max(0, Math.ceil(Math.max(0, Number(candidate.shelfLifeDays ?? crop.shelfLifeDays) || 0) / 7));
            const range = PlanMath.weekRangeForWindowClamped(weeks, candidate.harvestStart, candidate.harvestEnd);
            if (!range) return { plantCount: 0, reachableShortKg: 0, reason: "no_reachable_horizon" };
            let reachableShortKg = 0;
            const end = Math.min(weeks.length - 1, range.b + shelfWeeks);
            for (let i = range.a; i <= end; i++) reachableShortKg += Math.max(0, Number(arrays && arrays.short && arrays.short[i]) || 0);
            return { plantCount: Math.max(0, Math.ceil(reachableShortKg / kgPerPlant)), reachableShortKg };
        }

        function loadPlanForYear(moduleCell, year) {
            return PlanRepository.loadPlanForYear(moduleCell, year);
        }

        return { computeYearCoverage, simulateCandidatePlanting, recommendPlantCount, summarizeAggregate, loadPlanForYear };
    })();

    window.USL = window.USL || {};
    window.USL.planningCore = Object.assign({}, window.USL.planningCore, PlanningCore);

    // -------------------- Dashboard model --------------------
    /**
     * Produces persistence-safe modal state and presentation metrics from one runtime calculation.
     * This layer has no DOM dependencies so status, dirty-state, and selection rules remain testable.
     */
    const YearPlanDashboard = (() => {
        const EPS = 0.0001;

        function uniqueMessages(messages) {
            const seen = new Set();
            const out = [];
            for (const message of (messages || [])) {
                const text = String(message || "").trim();
                if (!text || seen.has(text)) continue;
                seen.add(text);
                out.push(text);
            }
            return out;
        }

        function validationMessage(result) {
            return String(result && result.message || result || "").trim();
        }

        function validationKey(result) {
            if (!result || typeof result !== "object") return validationMessage(result);
            const target = result.target && typeof result.target === "object" ? JSON.stringify(result.target) : "";
            return `${result.code || ""}|${result.cropId || ""}|${result.packageIndex ?? ""}|${result.componentIndex ?? ""}|${target}|${validationMessage(result)}`;
        }

        function uniqueValidationResults(results) {
            const seen = new Set();
            const out = [];
            for (const result of (results || [])) {
                const message = validationMessage(result);
                if (!message) continue;
                const key = validationKey(result);
                if (seen.has(key)) continue;
                seen.add(key);
                out.push(result);
            }
            return out;
        }

        function persistenceSnapshot(plan) {
            const persistedPlan = PlanSchema.serializeForPersistence(plan || {});
            const packageDefaultCropIds = ((plan && plan.crops) || [])
                .filter(crop => crop && crop.savePackagesAsDefault)
                .map(crop => String(crop.id || ""))
                .sort();
            return JSON.stringify({ persistedPlan, packageDefaultCropIds });
        }

        function resolveSelectedCropId(crops, requestedId, removedIndex) {
            const list = Array.isArray(crops) ? crops : [];
            const wanted = String(requestedId || "");
            if (wanted && list.some(crop => String(crop && crop.id || "") === wanted)) return wanted;
            if (list.length === 0) return "";
            const index = Number.isFinite(Number(removedIndex))
                ? Math.max(0, Math.min(list.length - 1, Math.trunc(Number(removedIndex))))
                : 0;
            return String(list[index] && list[index].id || "");
        }

        function applyCollapsePreferences(state, preferences) {
            const prefs = preferences && typeof preferences === "object" ? preferences : {};
            const top = prefs.top && typeof prefs.top === "object" ? prefs.top : {};
            state.csaExpanded = top.csaExpanded === true;
            state.demandExpanded = top.demandExpanded === false ? false : true;
            state.cropPlanExpanded = top.cropPlanExpanded === false ? false : true;
            state.planCheckExpanded = top.planCheckExpanded === true;
            state.collapsedDemandChannelIds = new Set(Array.isArray(prefs.collapsedDemandChannelIds) ? prefs.collapsedDemandChannelIds.map(String).filter(Boolean) : []);
            state.collapsedDemandLineIds = new Set(Array.isArray(prefs.collapsedDemandLineIds) ? prefs.collapsedDemandLineIds.map(String).filter(Boolean) : []);
            return state;
        }

        function createState(plan, preferences) {
            const crops = (plan && plan.crops) || [];
            return applyCollapsePreferences({
                selectedCropId: resolveSelectedCropId(crops, "", 0),
                activeTab: "basics",
                csaExpanded: false,
                demandExpanded: true,
                collapsedDemandChannelIds: new Set(),
                collapsedDemandLineIds: new Set(),
                cropPlanExpanded: true,
                planCheckExpanded: false,
                hadBlockingErrors: false,
                hadCsaErrors: false,
                hadDemandErrors: false,
                baselineSnapshot: "",
                validationState: "idle",
                lastSavedAt: null,
                closePromptOpen: false,
                extraDiagnostics: [],
                saveValidationErrors: [] // CHANGE: populated only after save attempts so new empty plans do not open invalid.
            }, preferences);
        }

        function markBaseline(state, plan, savedAt) {
            state.baselineSnapshot = persistenceSnapshot(plan);
            state.validationState = "valid";
            state.lastSavedAt = savedAt || null;
            return state.baselineSnapshot;
        }

        function isDirty(state, plan) {
            return !!state && persistenceSnapshot(plan) !== String(state.baselineSnapshot || "");
        }

        function buildMethodOptions(rows, currentValue) {
            const current = String(currentValue || "").trim();
            const seen = new Set();
            const options = [];
            for (const row of (rows || [])) {
                const value = String(row && row.method_id || "").trim();
                if (!value || seen.has(value)) continue;
                seen.add(value);
                options.push({ value, label: String(row.method_name || value), methodCategoryId: String(row && row.method_category_id || "").trim(), unavailable: false });
            }
            if (current && !seen.has(current)) options.unshift({ value: current, label: `${current} (legacy/unavailable)`, methodCategoryId: PlanSchema.inferMethodCategoryFromMethodId(current), unavailable: true });
            return options;
        }

        function formatKg(value) {
            const number = Number(value);
            return Number.isFinite(number) ? `${number.toFixed(1)} kg` : "-";
        }

        function formatYmd(ymd) {
            const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
            if (!match) return "";
            const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(match[2]) - 1];
            return month ? `${month} ${match[3]}` : "";
        }

        function formatMoney(value) {
            const number = Number(value);
            return Number.isFinite(number) ? `$${number.toFixed(2)}` : "-";
        }

        function summarizeDemandAggregate(aggregate) {
            const sum = values => (Array.isArray(values) ? values : []).reduce((total, value) => total + Math.max(0, Number(value) || 0), 0);
            return {
                targetKg: sum(aggregate && aggregate.target),
                usableSupplyKg: sum(aggregate && aggregate.usableSupply),
                shortKg: sum(aggregate && aggregate.short),
                potentialRevenue: sum(aggregate && aggregate.potentialRevenue),
                fulfilledRevenue: sum(aggregate && aggregate.fulfilledRevenue),
                lineCount: Array.isArray(aggregate && aggregate.lineIds) ? aggregate.lineIds.length : 0
            };
        }

        function summarizeCsaWeekly(csaWeekly) {
            const sum = values => (Array.isArray(values) ? values : []).reduce((total, value) => total + Math.max(0, Number(value) || 0), 0);
            return {
                targetKg: sum(csaWeekly && csaWeekly.target),
                usableSupplyKg: sum(csaWeekly && csaWeekly.usableSupply),
                shortKg: sum(csaWeekly && csaWeekly.short),
                potentialRevenue: sum(csaWeekly && csaWeekly.potentialRevenue),
                fulfilledRevenue: sum(csaWeekly && csaWeekly.fulfilledRevenue),
                componentValuePerBox: Math.max(0, Number(csaWeekly && csaWeekly.componentValuePerBox) || 0),
                salePricePerBox: Math.max(0, Number(csaWeekly && csaWeekly.salePricePerBox) || 0)
            };
        }

        function buildCompactStatus(dashboard) {
            const cropCount = Math.max(0, Math.trunc(Number(dashboard && dashboard.cropCount) || 0));
            const parts = [String(Number(dashboard && dashboard.year) || ""), `${cropCount} crop${cropCount === 1 ? "" : "s"}`];
            if (Number(dashboard && dashboard.shortKg) > EPS) parts.push(`Short ${formatKg(dashboard.shortKg)}`);
            else if (Number(dashboard && dashboard.surplusKg) > EPS) parts.push(`Surplus ${formatKg(dashboard.surplusKg)}`);
            if (dashboard && dashboard.dirty) parts.push("Unsaved");
            return parts.filter(Boolean).join(" \u00b7 ");
        }

        function buildCsaSummary(plan) {
            const csa = plan && plan.csa;
            if (!csa || !csa.enabled) return "CSA Box Plan: Off";
            const parts = [`CSA Box Plan: ${Math.max(0, Math.trunc(Number(csa.boxesPerWeek) || 0))} boxes/week`];
            const start = formatYmd(csa.start);
            const end = formatYmd(csa.end);
            if (start || end) parts.push(`${start || "?"}\u2013${end || "?"}`);
            const componentCount = Array.isArray(csa.components) ? csa.components.length : 0;
            parts.push(`${componentCount} component${componentCount === 1 ? "" : "s"}`);
            return parts.join(" \u00b7 ");
        }

        function syncExpansionState(state, dashboard, csaErrors, demandErrors) {
            const hasBlockingErrors = !!(dashboard && dashboard.validationErrors && dashboard.validationErrors.length);
            const hasCsaErrors = !!(csaErrors && csaErrors.length);
            const hasDemandErrors = !!(demandErrors && demandErrors.length);
            const changes = { planCheckChanged: false, csaChanged: false, demandChanged: false };
            if (hasBlockingErrors && !state.hadBlockingErrors && !state.planCheckExpanded) {
                state.planCheckExpanded = true;
                changes.planCheckChanged = true;
            }
            if (hasCsaErrors && !state.hadCsaErrors && !state.csaExpanded) {
                state.csaExpanded = true;
                changes.csaChanged = true;
            }
            if (hasDemandErrors && !state.hadDemandErrors && !state.demandExpanded) {
                state.demandExpanded = true;
                changes.demandChanged = true;
            }
            state.hadBlockingErrors = hasBlockingErrors;
            state.hadCsaErrors = hasCsaErrors;
            state.hadDemandErrors = hasDemandErrors;
            return changes;
        }

        function compute(plan, runtime, options) {
            const settings = options || {};
            const rows = runtime && Array.isArray(runtime.cropTotals) ? runtime.cropTotals : [];
            const rowsById = new Map(rows.map(row => [String(row && row.crop && row.crop.id || ""), row]));
            const weekly = runtime && runtime.weekly;
            const cropMetrics = [];
            let targetKg = 0;
            let supplyKg = 0;
            let shortKg = 0;
            let surplusKg = 0;
            let actualHarvestActive = false;
            let estimatedHarvestActive = false;
            let manualHarvestDates = false;

            for (const crop of ((plan && plan.crops) || [])) {
                const row = rowsById.get(String(crop.id || "")) || { targetKg: 0, supplyKg: 0, plantsReq: NaN, seedsReq: NaN };
                const chartSummary = weekly
                    ? PlanMath.summarizePlanChartModel(PlanMath.buildPlanChartModel(weekly, String(crop.id)))
                    : {
                        targetKg: Math.max(0, Number(row.targetKg) || 0),
                        harvestKg: Math.max(0, Number(row.supplyKg) || 0),
                        usableSupplyKg: Math.min(Math.max(0, Number(row.targetKg) || 0), Math.max(0, Number(row.supplyKg) || 0)),
                        shortKg: Math.max(0, (Number(row.targetKg) || 0) - (Number(row.supplyKg) || 0)),
                        expiredKg: 0
                    };
                const target = chartSummary.targetKg;
                const supply = chartSummary.harvestKg;
                const shortage = chartSummary.shortKg;
                const surplus = Math.max(0, supply - chartSummary.usableSupplyKg);
                const errors = PlanSchema.validateCrop(crop);
                if (target > EPS && (!PlanMath.hasYmd(crop.harvestStart) || !PlanMath.hasYmd(crop.harvestEnd))) {
                    const cropName = String(crop.plant || crop.id);
                    const field = PlanMath.hasYmd(crop.harvestStart) ? "harvestEnd" : "harvestStart";
                    errors.push({ scope: "crop", code: "crop.missing_harvest_window", message: `Enter a harvest window for ${cropName}.`, cropId: String(crop.id || ""), field, target: { area: "crop", cropId: String(crop.id || ""), tab: "basics", field } });
                }
                let status = "OK";

                if (errors.length > 0) status = "Missing data";
                else if (target <= EPS) status = "No demand";
                else if (shortage > EPS && supply + EPS < target) status = "Short";
                else if (shortage > EPS) status = "Expired / timing issue";
                else if (surplus > EPS) status = "Surplus";

                targetKg += target;
                supplyKg += supply;
                shortKg += shortage;
                surplusKg += surplus;
                const derived = runtime && runtime.derivedByCropId && runtime.derivedByCropId.get(String(crop.id));
                const harvestWindowSource = String(crop.harvestWindowSource || "manual");
                actualHarvestActive = actualHarvestActive || (!!derived
                    && Array.isArray(derived.actualHarvestWeeklyKg)
                    && derived.actualHarvestWeeklyKg.some(value => Number(value) > 0)); // CHANGE: actual supply is record-backed regardless of selected harvest-window source.
                estimatedHarvestActive = estimatedHarvestActive || harvestWindowSource === "sowing_window_estimate";
                manualHarvestDates = manualHarvestDates || harvestWindowSource === "manual";

                cropMetrics.push({
                    crop,
                    targetKg: target,
                    supplyKg: supply,
                    shortKg: shortage,
                    surplusKg: surplus,
                    expiredKg: chartSummary.expiredKg,
                    plantsReq: Number(row.plantsReq),
                    seedsReq: Number(row.seedsReq),
                    errors,
                    status
                });
            }

            const validationErrors = uniqueValidationResults([
                ...PlanSchema.validate(plan),
                ...cropMetrics.flatMap(metric => metric.errors),
                ...((settings.extraValidationErrors) || []) // CHANGE: save-only blockers surface through the existing Plan Check diagnostics.
            ]);
            const channelMetrics = ((plan && plan.demandChannels) || []).map(channel => {
                const channelId = String(channel && channel.id || "");
                const summary = summarizeDemandAggregate(weekly && weekly.perChannel && weekly.perChannel.get(channelId));
                summary.lineCount = ((plan && plan.demands) || []).filter(line => String(line && line.channelId || "") === channelId).length;
                const priorityKg = { committed: 0, target: 0, optional: 0 };
                for (const result of (weekly && weekly.perDemandLine ? weekly.perDemandLine.values() : [])) {
                    if (result.channelId !== channelId) continue;
                    priorityKg[result.priority] = (priorityKg[result.priority] || 0) + result.target.reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
                }
                return { channel, ...summary, priorityKg, status: summary.shortKg > EPS ? "Short" : "OK" };
            });
            const priorityMetrics = ["committed", "target", "optional"].map(priority => ({
                priority,
                ...summarizeDemandAggregate(weekly && weekly.perPriority && weekly.perPriority.get(priority))
            }));
            const potentialRevenue = channelMetrics.reduce((sum, metric) => sum + metric.potentialRevenue, 0);
            const fulfilledRevenue = channelMetrics.reduce((sum, metric) => sum + metric.fulfilledRevenue, 0);
            const csaMetric = summarizeCsaWeekly(weekly && weekly.csa);
            const totalPotentialRevenue = potentialRevenue + csaMetric.potentialRevenue;
            const totalFulfilledRevenue = fulfilledRevenue + csaMetric.fulfilledRevenue;
            const shortageWeeks = [];
            if (weekly && Array.isArray(weekly.weeks)) {
                for (let i = 0; i < weekly.weeks.length; i++) {
                    const channelDemandKg = channelMetrics.reduce((sum, metric) => {
                        const aggregate = weekly.perChannel && weekly.perChannel.get(String(metric.channel.id));
                        return sum + Math.max(0, Number(aggregate && aggregate.target && aggregate.target[i]) || 0);
                    }, 0);
                    const channelShortKg = channelMetrics.reduce((sum, metric) => {
                        const aggregate = weekly.perChannel && weekly.perChannel.get(String(metric.channel.id));
                        return sum + Math.max(0, Number(aggregate && aggregate.short && aggregate.short[i]) || 0);
                    }, 0);
                    const csaDemandKg = Math.max(0, Number(weekly.csa && weekly.csa.target[i]) || 0);
                    const csaShortKg = Math.max(0, Number(weekly.csa && weekly.csa.short[i]) || 0);
                    if (channelShortKg + csaShortKg <= EPS) continue;
                    shortageWeeks.push({
                        week: String(weekly.weeks[i] && weekly.weeks[i].iso || ""),
                        channelDemandKg, channelShortKg, csaDemandKg, csaShortKg
                    });
                }
            }
            const diagnostics = uniqueMessages([
                ...((runtime && runtime.warnings) || []),
                ...validationErrors.map(validationMessage),
                ...((settings.extraDiagnostics) || [])
            ]);
            const badges = [];
            if (cropMetrics.some(metric => metric.status === "Missing data")) badges.push("Missing data");
            if (cropMetrics.some(metric => metric.status === "Short")) badges.push("Short");
            if (cropMetrics.some(metric => metric.status === "Expired / timing issue")) badges.push("Expired / timing issue");
            if (cropMetrics.some(metric => metric.status === "Surplus")) badges.push("Surplus");
            if (cropMetrics.length > 0 && cropMetrics.every(metric => metric.status === "OK" || metric.status === "No demand")) badges.push("OK");
            if (actualHarvestActive) badges.push("Actual harvest active");
            if (estimatedHarvestActive) badges.push("Sowing windows");
            if (manualHarvestDates) badges.push("Manual harvest dates");
            if (settings.dirty) badges.push("Unsaved");

            return {
                year: Number(plan && plan.year),
                cropCount: cropMetrics.length,
                targetKg,
                supplyKg,
                shortKg,
                surplusKg,
                warningCount: diagnostics.length,
                validationErrors,
                diagnostics,
                badges,
                dirty: !!settings.dirty,
                cropMetrics,
                cropMetricsById: new Map(cropMetrics.map(metric => [String(metric.crop.id), metric])),
                channelMetrics,
                channelMetricsById: new Map(channelMetrics.map(metric => [String(metric.channel.id), metric])),
                priorityMetrics,
                csaMetric,
                shortageWeeks,
                potentialRevenue,
                fulfilledRevenue,
                totalPotentialRevenue,
                totalFulfilledRevenue
            };
        }

        return {
            createState,
            applyCollapsePreferences,
            markBaseline,
            isDirty,
            persistenceSnapshot,
            resolveSelectedCropId,
            uniqueMessages,
            validationMessage,
            uniqueValidationResults,
            buildMethodOptions,
            formatKg,
            formatMoney,
            formatYmd,
            summarizeDemandAggregate,
            buildCompactStatus,
            buildCsaSummary,
            syncExpansionState,
            compute
        };
    })();

    // -------------------- Modal UI (dashboard) --------------------

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

    const YP_COLORS = Object.freeze({
        primary: "#2f6fed",
        primaryBg: "#eef4ff",
        primarySoft: "#dbe8ff",
        primaryDark: "#1f4fbf",
        success: "#256a36",
        successBg: "#edf8f0",
        successSoft: "#62a96b",
        danger: "#b3261e",
        dangerBg: "#fdebea",
        warning: "#b56a00",
        warningBg: "#fff4df",
        neutral900: "#222",
        neutral700: "#555",
        neutral500: "#777",
        neutral300: "#ddd",
        neutral100: "#f7f7f7"
    });

    /** Defines the chart's visual encodings once for rendering, legend controls, and hover details. */
    const PLAN_CHART_SERIES = Object.freeze([
        { id: "target", label: "Target demand", tooltipLabel: "Target", field: "targetKg", kind: "line", color: YP_COLORS.primary, lineWidth: 2, dash: [], help: "Weekly demand required by channel and CSA plans." },
        { id: "available", label: "Available supply", tooltipLabel: "Available", field: "availableSupplyKg", kind: "dashed-line", color: YP_COLORS.success, lineWidth: 2, dash: [6, 3], help: "Harvested inventory available before weekly demand is allocated." },
        { id: "usable", label: "Usable supply", tooltipLabel: "Usable", field: "usableSupplyKg", kind: "line", color: YP_COLORS.successSoft, lineWidth: 1.5, dash: [], help: "Available supply used to satisfy this week's demand." },
        { id: "harvest", label: "Harvest", tooltipLabel: "Harvested", field: "harvestKg", kind: "bar", color: YP_COLORS.success, fill: YP_COLORS.successBg, help: "Actual harvested weight recorded during the week." }, // CHANGE: harvest series is record-backed only.
        { id: "shortage", label: "Shortage", tooltipLabel: "Short", field: "shortKg", kind: "area", color: YP_COLORS.danger, fill: YP_COLORS.dangerBg, help: "Demand that remains unmet after available supply is used." },
        { id: "expired", label: "Expired", tooltipLabel: "Expired", field: "expiredKg", kind: "point", color: YP_COLORS.warning, help: "Stored harvest that reaches the end of its shelf life this week." }
    ]);

    function isPlanChartSeriesVisible(visibleSeriesIds, seriesId) {
        return !visibleSeriesIds || visibleSeriesIds.has(seriesId);
    }

    function drawPlanChart(canvas, chartModel, visibleSeriesIds) {
        const ctx = canvas.getContext("2d");
        const rows = Array.isArray(chartModel) ? chartModel : [];
        const seriesById = new Map(PLAN_CHART_SERIES.map(series => [series.id, series]));
        if (!ctx) return null;
        const width = canvas.width;
        const height = canvas.height;
        ctx.clearRect(0, 0, width, height);
        if (!rows.length) return null;

        const padLeft = 48;
        const padRight = 14;
        const padTop = 12;
        const padBottom = 28;
        const plotRight = width - padRight;
        const plotBottom = height - padBottom;
        const plotWidth = plotRight - padLeft;
        const plotHeight = plotBottom - padTop;
        const step = plotWidth / rows.length;
        const weekCenters = rows.map((row, index) => padLeft + ((index + 0.5) * step));
        const maxValue = Math.max(1, ...rows.flatMap(row => [
            row.targetKg,
            row.harvestKg,
            row.availableSupplyKg,
            row.usableSupplyKg,
            row.expiredKg
        ]).map(value => Math.max(0, Number(value) || 0)));
        const y = value => plotBottom - ((Math.max(0, Number(value) || 0) / maxValue) * plotHeight);

        ctx.font = "10px Arial";
        ctx.textBaseline = "middle";
        ctx.lineWidth = 1;
        for (let tick = 0; tick <= 4; tick++) {
            const value = maxValue * tick / 4;
            const tickY = y(value);
            ctx.strokeStyle = tick === 0 ? "#999" : "#e4e4e4";
            ctx.beginPath();
            ctx.moveTo(padLeft, tickY);
            ctx.lineTo(plotRight, tickY);
            ctx.stroke();
            ctx.fillStyle = "#555";
            ctx.textAlign = "right";
            ctx.fillText(`${value.toFixed(value >= 10 ? 0 : 1)} kg`, padLeft - 5, tickY);
        }

        let previousMonth = "";
        for (let index = 0; index < rows.length; index++) {
            const week = String(rows[index].week || "");
            const month = week.slice(0, 7);
            if (!month || month === previousMonth) continue;
            const boundaryX = padLeft + (index * step);
            ctx.strokeStyle = "#d4d4d4";
            ctx.beginPath();
            ctx.moveTo(boundaryX, padTop);
            ctx.lineTo(boundaryX, plotBottom);
            ctx.stroke();
            ctx.fillStyle = "#666";
            ctx.textAlign = "left";
            ctx.textBaseline = "alphabetic";
            ctx.fillText(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(week.slice(5, 7)) - 1] || "", boundaryX + 2, height - 8);
            previousMonth = month;
        }

        const barWidth = Math.max(2, Math.min(12, step * 0.58));
        for (let index = 0; index < rows.length; index++) {
            const row = rows[index];
            const centerX = weekCenters[index];
            if (isPlanChartSeriesVisible(visibleSeriesIds, "harvest")) {
                const harvestTop = y(row.harvestKg);
                ctx.fillStyle = seriesById.get("harvest").fill;
                ctx.fillRect(centerX - (barWidth / 2), harvestTop, barWidth, plotBottom - harvestTop);
            }
            if (isPlanChartSeriesVisible(visibleSeriesIds, "shortage") && row.shortKg > 0) {
                const targetY = y(row.targetKg);
                const usableY = y(row.usableSupplyKg);
                ctx.fillStyle = seriesById.get("shortage").fill;
                ctx.fillRect(centerX - (step * 0.38), targetY, step * 0.76, Math.max(2, usableY - targetY));
            }
            if (isPlanChartSeriesVisible(visibleSeriesIds, "expired") && row.expiredKg > 0) {
                ctx.fillStyle = seriesById.get("expired").color;
                ctx.beginPath();
                ctx.arc(centerX, y(row.expiredKg), 3, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        function drawLine(field, color, lineWidth, dash) {
            ctx.strokeStyle = color;
            ctx.lineWidth = lineWidth;
            ctx.setLineDash(dash || []);
            ctx.beginPath();
            for (let index = 0; index < rows.length; index++) {
                const pointY = y(rows[index][field]);
                if (index === 0) ctx.moveTo(weekCenters[index], pointY);
                else ctx.lineTo(weekCenters[index], pointY);
            }
            ctx.stroke();
            ctx.setLineDash([]);
        }

        for (const series of PLAN_CHART_SERIES) {
            if ((series.kind === "line" || series.kind === "dashed-line") && isPlanChartSeriesVisible(visibleSeriesIds, series.id)) {
                drawLine(series.field, series.color, series.lineWidth, series.dash);
            }
        }

        return { rows, weekCenters, plotLeft: padLeft, plotRight, step, maxValue };
    }

    function harvestTimelineMarkers(weekStarts, crop) {
        const weeks = Array.isArray(weekStarts) ? weekStarts : [];
        const markers = new Map();
        const addMarker = (field, label) => {
            const ymd = crop && crop[field];
            if (!PlanMath.hasYmd(ymd)) return;
            const index = PlanMath.weekIndexForDate(weeks, ymd);
            if (index < 0) return;
            const existing = markers.get(index) || [];
            existing.push({ label, ymd });
            markers.set(index, existing);
        };
        addMarker("harvestStart", "S");
        addMarker("harvestEnd", "E");
        return markers;
    }

    /** Builds the selected-crop timeline rows from existing weekly demand, harvest, and inventory arrays. */
    function buildCropTimelineModel(weekStarts, cropWeekly) {
        const weeks = Array.isArray(weekStarts) ? weekStarts : [];
        const source = cropWeekly && typeof cropWeekly === "object" ? cropWeekly : {};
        const length = Math.max(
            weeks.length,
            Array.isArray(source.target) ? source.target.length : 0,
            Array.isArray(source.supply) ? source.supply.length : 0,
            Array.isArray(source.endingInventory) ? source.endingInventory.length : 0,
            Array.isArray(source.surplus) ? source.surplus.length : 0
        );
        const numberAt = (series, index) => Math.max(0, Number(Array.isArray(series) ? series[index] : 0) || 0);
        const rows = [];
        for (let index = 0; index < length; index++) {
            const demandKg = numberAt(source.target, index);
            const harvestKg = numberAt(source.supply, index);
            const inventoryKg = Array.isArray(source.endingInventory)
                ? numberAt(source.endingInventory, index)
                : numberAt(source.surplus, index);
            const usableSupplyKg = numberAt(source.usableSupply, index);
            const shortKg = numberAt(source.short, index);
            const expiredKg = numberAt(source.expired, index);
            const solidBars = [
                { id: "demand", label: "Demand", valueKg: demandKg },
                { id: "inventory", label: "Remaining inventory", valueKg: inventoryKg }
            ]
                .filter(bar => bar.valueKg > EPS)
                .sort((a, b) => (b.valueKg - a.valueKg) || ["demand", "inventory"].indexOf(a.id) - ["demand", "inventory"].indexOf(b.id));
            const bars = harvestKg > EPS
                ? [...solidBars, { id: "harvest", label: "Raw harvest", valueKg: harvestKg }]
                : solidBars; // CHANGE: raw-harvest outline always renders in front of solid bars.
            rows.push({
                week: weeks[index] || null,
                demandKg,
                harvestKg,
                inventoryKg,
                usableSupplyKg,
                shortKg,
                expiredKg,
                bars
            });
        }
        return rows;
    }

    function cropTimelineTooltip(row) {
        const weekLabel = row && row.week && row.week.iso ? row.week.iso : "";
        return [
            weekLabel ? `Week of ${weekLabel}` : "Week",
            `Demand: ${row.demandKg.toFixed(2)} kg`,
            `Raw harvest: ${row.harvestKg.toFixed(2)} kg`,
            `Usable supply: ${row.usableSupplyKg.toFixed(2)} kg`,
            `Remaining inventory: ${row.inventoryKg.toFixed(2)} kg`,
            `Shortfall: ${row.shortKg.toFixed(2)} kg`,
            `Expired: ${row.expiredKg.toFixed(2)} kg`
        ].join("\n");
    }

    function cropTimelineMonthLabel(week, previousWeek) {
        const iso = String(week && week.iso || "");
        const previousIso = String(previousWeek && previousWeek.iso || "");
        const month = iso.slice(5, 7);
        if (!previousIso && month === "12") return ""; // CHANGE: suppress leading prior-year December so it does not collide with January.
        if (!month || month === previousIso.slice(5, 7)) return "";
        return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(month) - 1] || "";
    }

    function formatCropTimelineAxisKg(value) {
        const kg = Math.max(0, Number(value) || 0);
        return `${kg >= 10 ? kg.toFixed(0) : kg.toFixed(1)} kg`;
    }

    function renderCropTimeline(hostEl, weekStarts, cropWeekly, crop) {
        if (!hostEl) return;
        const weeks = Array.isArray(weekStarts) ? weekStarts : [];
        const rows = buildCropTimelineModel(weeks, cropWeekly);
        const maxValue = Math.max(0, ...rows.flatMap(row => [row.demandKg, row.harvestKg, row.inventoryKg]));
        const markersByWeek = harvestTimelineMarkers(weeks, crop);
        hostEl.innerHTML = "";
        hostEl.className = "yp-harvest-timeline yp-crop-timeline"; // CHANGE: retain existing timeline anchor while applying coverage styling.
        hostEl.style.gridTemplateColumns = maxValue > 0
            ? `36px repeat(${Math.max(1, weeks.length)}, minmax(4px, 1fr))`
            : `repeat(${Math.max(1, weeks.length)}, minmax(4px, 1fr))`; // CHANGE: reserve a compact quantity axis only when there is data to scale.
        if (maxValue <= 0 && !markersByWeek.size) {
            hostEl.className = "yp-harvest-empty";
            hostEl.textContent = "No harvest or demand recorded for this crop/year."; // CHANGE: empty state now reflects both series.
            return;
        }
        if (maxValue > 0) {
            const axis = document.createElement("div");
            axis.className = "yp-crop-timeline-y-axis";
            axis.dataset.maxKg = maxValue.toFixed(4);
            const maxLabel = document.createElement("span");
            maxLabel.className = "yp-crop-timeline-y-axis-max";
            maxLabel.textContent = formatCropTimelineAxisKg(maxValue);
            const zeroLabel = document.createElement("span");
            zeroLabel.className = "yp-crop-timeline-y-axis-zero";
            zeroLabel.textContent = "0";
            axis.appendChild(maxLabel);
            axis.appendChild(zeroLabel);
            hostEl.appendChild(axis); // CHANGE: add quantity scale for the compact weekly bars.
        }
        if (maxValue <= 0) {
            const emptyNote = document.createElement("div");
            emptyNote.className = "yp-harvest-empty yp-harvest-empty-note";
            emptyNote.textContent = "No harvest or demand recorded for this crop/year."; // CHANGE: marker-only empty state now reflects both series.
            hostEl.appendChild(emptyNote); // harvest-window marker empty state
        }
        for (let index = 0; index < rows.length; index++) {
            const row = rows[index];
            const week = document.createElement("div");
            week.className = "yp-harvest-week yp-crop-timeline-week";
            week.title = cropTimelineTooltip(row);
            const monthLabel = cropTimelineMonthLabel(row.week, index > 0 ? rows[index - 1].week : null);
            if (monthLabel) {
                week.dataset.monthStart = "true";
                week.dataset.monthLabel = monthLabel;
            }
            for (let order = 0; order < row.bars.length; order++) {
                const item = row.bars[order];
                const intensity = maxValue > 0 ? Math.min(1, item.valueKg / maxValue) : 0;
                const bar = document.createElement("div");
                bar.className = `yp-harvest-bar yp-crop-timeline-bar yp-crop-timeline-bar-${item.id}`; // CHANGE: identify demand, raw harvest, and inventory bars for styling/tests.
                bar.dataset.series = item.id;
                bar.dataset.valueKg = item.valueKg.toFixed(4);
                bar.dataset.renderOrder = String(order);
                bar.style.height = `${Math.max(3, Math.round(4 + 30 * intensity))}px`;
                bar.style.zIndex = String(order + 1);
                bar.title = `${item.label}: ${item.valueKg.toFixed(2)} kg\n${cropTimelineTooltip(row)}`;
                week.appendChild(bar);
            }
            const markers = markersByWeek.get(index) || [];
            if (markers.length) {
                const marker = document.createElement("div");
                marker.className = `yp-harvest-marker ${markers.length > 1 ? "yp-harvest-marker-combined" : (markers[0].label === "S" ? "yp-harvest-marker-start" : "yp-harvest-marker-end")}`;
                marker.setAttribute("data-label", markers.map(item => item.label).join("/"));
                marker.title = markers.map(item => `${item.label === "S" ? "Harvest start" : "Harvest end"} ${item.ymd}`).join(" / ");
                week.appendChild(marker); // harvest-window marker
            }
            hostEl.appendChild(week);
        }
    }

    // ------------ openPlanModal --------------
    // -------------------- Dashboard modal controller --------------------
    /** Owns dashboard DOM construction, event orchestration, persistence, and session-scoped UI state. */
    const YearPlanModalController = (() => {
        function open(moduleCell, year) {
            let currentYear = Number(year);
            const existing = PlanRepository.loadPlanForYear(moduleCell, currentYear);
            let loadedExistingForCurrentYear = !!existing;
            const plan = PlanSchema.normalizeForRuntime(existing || PlanSchema.createEmptyPlan(currentYear), currentYear);
            const state = YearPlanDashboard.createState(plan, YearPlanCollapsePreferences.load(moduleCell, currentYear));
            const session = SessionController.start(moduleCell, currentYear, plan);
            const varietyCache = new Map();
            const methodCache = new Map();
            const addCropOptionById = new Map();
            let addCropOptionsLoadVersion = 0;
            let runtime = null;
            let dashboard = null;
            let refreshTimer = null;
            let pendingRefreshOptions = null;
            let editorRefs = {};
            let demandRefs = {};
            let csaRefs = {};
            let chartHitModel = null;
            const visibleChartSeriesIds = new Set(PLAN_CHART_SERIES.map(series => series.id));

            function pruneCollapseState() {
                const channelIds = new Set((plan.demandChannels || []).map(channel => String(channel && channel.id || "")).filter(Boolean));
                const lineIds = new Set((plan.demands || []).map(line => String(line && line.id || "")).filter(Boolean));
                for (const channelId of Array.from(state.collapsedDemandChannelIds || [])) {
                    if (!channelIds.has(String(channelId))) state.collapsedDemandChannelIds.delete(channelId);
                }
                for (const lineId of Array.from(state.collapsedDemandLineIds || [])) {
                    if (!lineIds.has(String(lineId))) state.collapsedDemandLineIds.delete(lineId);
                }
            }

            function saveCollapsePreferences() {
                pruneCollapseState();
                YearPlanCollapsePreferences.save(moduleCell, currentYear, state);
            }

            const wrap = document.createElement("div");
            wrap.style.cssText = "position:fixed;inset:0;z-index:" + TRELLIS_DIALOG_Z + ";background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;";
            const card = document.createElement("div");
            card.className = "yp-modal-card";
            card.style.cssText = "width:1180px;max-width:97vw;height:92vh;background:#fff;border:1px solid #777;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.25);display:flex;flex-direction:column;overflow:hidden;font:12px Arial,sans-serif;";
            const style = document.createElement("style");
            style.textContent = `
                .yp-modal-card{--yp-primary:${YP_COLORS.primary};--yp-primary-bg:${YP_COLORS.primaryBg};--yp-primary-soft:${YP_COLORS.primarySoft};--yp-primary-dark:${YP_COLORS.primaryDark};--yp-success:${YP_COLORS.success};--yp-success-bg:${YP_COLORS.successBg};--yp-danger:${YP_COLORS.danger};--yp-danger-bg:${YP_COLORS.dangerBg};--yp-warning:${YP_COLORS.warning};--yp-warning-bg:${YP_COLORS.warningBg};--yp-neutral-900:${YP_COLORS.neutral900};--yp-neutral-700:${YP_COLORS.neutral700};--yp-neutral-500:${YP_COLORS.neutral500};--yp-neutral-300:${YP_COLORS.neutral300};--yp-neutral-100:${YP_COLORS.neutral100}}
                .yp-dashboard-grid{display:grid;grid-template-columns:minmax(340px,32%) minmax(0,1fr);gap:12px;align-items:start}
                .yp-scroll-body > * + *{margin-top:10px}
                .yp-strip-box{box-sizing:border-box;border:1px solid var(--yp-neutral-300);border-radius:8px;background:#fff;overflow:hidden}
                .yp-strip-header{box-sizing:border-box;display:flex;align-items:center;gap:10px;width:100%;padding:9px 12px 9px 10px;border:0;background:var(--yp-neutral-100);cursor:pointer;text-align:left;font:12px Arial,sans-serif}
                .yp-strip-title{flex:0 0 auto;font-weight:700;font-size:13px}
                .yp-strip-summary{flex:1 1 auto;min-width:0;color:var(--yp-neutral-700);overflow-wrap:anywhere}
                .yp-strip-toggle{flex:0 0 auto;margin-left:auto;padding-left:4px;color:#333;white-space:nowrap;text-align:right}
                .yp-strip-details{box-sizing:border-box;padding:10px;border-top:1px solid var(--yp-neutral-300)}
                .yp-field-grid{display:grid;grid-template-columns:repeat(2,minmax(220px,1fr));gap:10px}
                .yp-derived-totals{display:grid;grid-template-columns:repeat(3,minmax(110px,1fr));gap:8px;margin-top:12px}
                .yp-derived-tile{border:1px solid var(--yp-neutral-300);border-radius:7px;background:var(--yp-neutral-100);padding:8px;min-width:0}
                .yp-derived-label{font-size:11px;color:var(--yp-neutral-700);font-weight:700;overflow-wrap:anywhere}
                .yp-derived-value{font-size:17px;font-weight:700;color:var(--yp-neutral-900);margin-top:3px}
                .yp-harvest-timeline-section{margin-top:14px;border-top:1px solid var(--yp-neutral-300);padding-top:10px}
                .yp-harvest-timeline-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:7px}
                .yp-harvest-timeline-title{font-weight:700}
                .yp-crop-timeline-legend{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;color:var(--yp-neutral-700);font-size:10px}
                .yp-crop-timeline-legend-item{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
                .yp-crop-timeline-legend-swatch{box-sizing:border-box;display:inline-block;width:14px;height:9px;border-radius:2px}
                .yp-crop-timeline-legend-swatch-demand{border:1px solid #c59b18;background:#ffd95a}
                .yp-crop-timeline-legend-swatch-harvest{border:2px solid #0c3f1a;background:#fff}
                .yp-crop-timeline-legend-swatch-inventory{border:1px solid #4f8b57;background:#62a96b}
                .yp-harvest-timeline{display:grid;grid-template-columns:repeat(52,minmax(4px,1fr));gap:2px;align-items:end;min-height:70px;padding-top:16px;padding-bottom:16px}
                .yp-harvest-week{position:relative;display:flex;align-items:flex-end;min-width:4px;min-height:38px}
                .yp-harvest-bar{height:24px;width:100%;min-width:4px;border:1px solid rgba(0,0,0,.16);border-radius:2px 2px 0 0;background:rgba(48,105,64,.14)}
                .yp-crop-timeline-y-axis{position:relative;box-sizing:border-box;min-height:38px;border-right:1px solid var(--yp-neutral-300);border-bottom:1px solid var(--yp-neutral-300);color:var(--yp-neutral-700);font-size:9px;line-height:1}
                .yp-crop-timeline-y-axis-max{position:absolute;right:5px;top:0;white-space:nowrap}
                .yp-crop-timeline-y-axis-zero{position:absolute;right:5px;bottom:-3px;white-space:nowrap}
                .yp-crop-timeline-week{display:block;border-bottom:1px solid var(--yp-neutral-300)}
                .yp-crop-timeline-week[data-month-start="true"]{border-left:1px solid var(--yp-neutral-300)}
                .yp-crop-timeline-week[data-month-start="true"]::after{content:attr(data-month-label);position:absolute;left:1px;bottom:-14px;color:var(--yp-neutral-700);font-size:9px;line-height:1;white-space:nowrap}
                .yp-crop-timeline-bar{position:absolute;left:50%;bottom:0;box-sizing:border-box;width:100%;transform:translateX(-50%);min-width:3px;border-radius:2px 2px 0 0}
                .yp-crop-timeline-bar-demand{border:1px solid #c59b18;background:#ffd95a}
                .yp-crop-timeline-bar-harvest{border:2px solid #0c3f1a;background:transparent;box-shadow:inset 0 0 0 1px rgba(12,63,26,.36),0 0 0 1px rgba(255,255,255,.78)}
                .yp-crop-timeline-bar-inventory{border:1px solid #4f8b57;background:#62a96b}
                .yp-harvest-marker{position:absolute;left:50%;top:-13px;bottom:0;width:0;border-left:2px solid #7a3f12;transform:translateX(-1px);pointer-events:none}
                .yp-harvest-marker::before{content:attr(data-label);position:absolute;top:-1px;left:50%;transform:translateX(-50%);min-width:12px;height:12px;line-height:12px;border-radius:6px;background:#7a3f12;color:#fff;font-size:9px;font-weight:700;text-align:center}
                .yp-harvest-marker-start{border-left-color:#1f5f99}
                .yp-harvest-marker-start::before{background:#1f5f99}
                .yp-harvest-marker-end{border-left-color:#9a3d2f}
                .yp-harvest-marker-end::before{background:#9a3d2f}
                .yp-harvest-marker-combined{border-left-color:#5c4a8a}
                .yp-harvest-marker-combined::before{background:#5c4a8a;min-width:22px}
                .yp-harvest-empty{color:var(--yp-neutral-700);font-size:11px}
                .yp-harvest-empty-note{grid-column:1/-1;margin-bottom:2px}
                .yp-yield-hint{display:flex;gap:6px;align-items:center;flex-wrap:wrap;color:#666;font-size:11px;margin-top:4px}
                .yp-package-row{display:grid;grid-template-columns:repeat(4,minmax(88px,1fr)) auto;gap:8px;align-items:end;padding:8px;border:1px solid #e1e1e1;border-radius:7px;background:#fcfcfc}
                .yp-package-field{display:flex;flex-direction:column;gap:4px;min-width:0}
                .yp-package-title{font-weight:700;color:#555}
                .yp-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
                .yp-line{display:grid;grid-template-columns:minmax(70px,1fr) 120px 150px 150px auto;gap:8px;align-items:center}
                .yp-demand-channel{border:1px solid #d5d5d5;border-radius:7px;background:#fff;overflow:hidden}
                .yp-demand-channel-header{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px;background:#f8f8f8}
                .yp-demand-channel-summary{flex:1 1 360px;color:var(--yp-neutral-700);overflow-wrap:anywhere}
                .yp-demand-channel-details{padding:9px;border-top:1px solid var(--yp-neutral-300)}
                .yp-demand-line-shell{border:1px solid #e1e1e1;border-radius:6px;background:#fcfcfc;overflow:hidden}
                .yp-demand-line-header{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:7px 8px;background:#fff}
                .yp-demand-line-summary{flex:1 1 320px;min-width:0;color:var(--yp-neutral-700);overflow-wrap:anywhere}
                .yp-demand-line{display:grid;grid-template-columns:repeat(5,minmax(120px,1fr));gap:8px;padding:9px;border:1px solid #e1e1e1;border-radius:6px;background:#fcfcfc}
                .yp-demand-line-details{border:0;border-top:1px solid var(--yp-neutral-300);border-radius:0}
                .yp-header-main{padding:10px 12px 8px;border-bottom:1px solid var(--yp-neutral-300);display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;background:#fff}
                .yp-secondary-toolbar{padding:7px 12px;border-bottom:1px solid var(--yp-neutral-300);display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:var(--yp-neutral-100)}
                .yp-header-status{color:var(--yp-neutral-700);font-weight:700}
                .yp-plan-hero{padding:8px;border:1px solid var(--yp-neutral-300);border-radius:8px;background:linear-gradient(180deg,#fff,var(--yp-neutral-100))}
                .yp-plan-hero-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:6px}
                .yp-plan-hero-title{font-size:16px;font-weight:700;color:var(--yp-neutral-900)}
                .yp-plan-hero-sub{display:none}
                .yp-kpi-grid{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:6px}
                .yp-kpi-tile{border:1px solid var(--yp-neutral-300);border-radius:6px;background:#fff;padding:6px 7px;min-width:0}
                .yp-kpi-tile[data-tone="primary"]{border-color:var(--yp-primary-soft);background:var(--yp-primary-bg)}
                .yp-kpi-tile[data-tone="success"]{border-color:var(--yp-success);background:var(--yp-success-bg)}
                .yp-kpi-tile[data-tone="danger"]{border-color:var(--yp-danger);background:var(--yp-danger-bg)}
                .yp-kpi-tile[data-tone="warning"]{border-color:var(--yp-warning);background:var(--yp-warning-bg)}
                .yp-kpi-label{color:var(--yp-neutral-700);font-size:10px;font-weight:700;text-transform:uppercase}
                .yp-kpi-value{margin-top:3px;font-size:13px;font-weight:700;color:var(--yp-neutral-900);white-space:normal}
                .yp-chip-row{display:flex;flex-wrap:wrap;gap:4px 5px;align-items:center}
                .yp-chip{display:inline-flex;align-items:center;gap:4px;padding:3px 6px;border:1px solid var(--yp-neutral-300);border-radius:999px;background:#fff;color:var(--yp-neutral-900);font:11px Arial,sans-serif;white-space:nowrap}
                .yp-chip strong{font-weight:700}
                .yp-chip[data-tone="primary"]{border-color:var(--yp-primary-soft);background:var(--yp-primary-bg);color:var(--yp-primary-dark)}
                .yp-chip[data-tone="success"]{border-color:var(--yp-success);background:var(--yp-success-bg);color:var(--yp-success)}
                .yp-chip[data-tone="danger"]{border-color:var(--yp-danger);background:var(--yp-danger-bg);color:var(--yp-danger)}
                .yp-chip[data-tone="warning"]{border-color:var(--yp-warning);background:var(--yp-warning-bg);color:var(--yp-warning)}
                .yp-chip[data-clickable="true"]{cursor:pointer}
                .yp-diagnostics-wrap{display:inline-flex;align-items:center;gap:4px;position:relative}
                .yp-diagnostics-trigger{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border:1px solid var(--yp-danger);border-radius:50%;background:#fff;color:var(--yp-danger);font:700 12px Arial,sans-serif;cursor:pointer}
                .yp-diagnostics-popover{position:absolute;z-index:2;top:calc(100% + 4px);right:0;min-width:230px;max-width:320px;padding:7px;border:1px solid var(--yp-danger);border-radius:7px;background:#fff;box-shadow:0 6px 18px rgba(0,0,0,.18);color:var(--yp-neutral-900)}
                .yp-diagnostics-popover[hidden]{display:none}
                .yp-diagnostics-title{font-weight:700;margin-bottom:5px;color:var(--yp-danger)}
                .yp-diagnostics-item{display:block;width:100%;padding:5px 6px;border:0;border-radius:5px;background:#fff;text-align:left;color:var(--yp-neutral-900);font:12px Arial,sans-serif;cursor:pointer}
                .yp-diagnostics-item:hover,.yp-diagnostics-item:focus{background:var(--yp-danger-bg);outline:1px solid var(--yp-danger)}
                .yp-field-highlight{outline:2px solid var(--yp-danger)!important;outline-offset:2px}
                .yp-attention-strip{display:none;margin-top:6px;padding:6px;border:1px solid var(--yp-warning);border-radius:6px;background:var(--yp-warning-bg)}
                .yp-attention-title{font-weight:700;margin-bottom:4px;color:var(--yp-neutral-900)}
                .yp-crop-card{box-sizing:border-box;border:0;border-bottom:1px solid #eee;background:#fff;padding:10px;text-align:left;cursor:pointer;width:100%;overflow-wrap:anywhere}
                .yp-crop-card[data-selected="true"]{background:var(--yp-primary-bg);box-shadow:inset 3px 0 0 var(--yp-primary)}
                .yp-crop-card-name{flex:1 1 140px;min-width:0;font-weight:700;font-size:13px;color:var(--yp-neutral-900);overflow-wrap:anywhere}
                .yp-crop-card-top{display:flex;gap:7px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}
                .yp-crop-card .yp-diagnostics-wrap{flex:1 1 120px;min-width:0;justify-content:flex-end;flex-wrap:wrap}
                .yp-crop-card .yp-chip{white-space:normal;overflow-wrap:anywhere}
                .yp-crop-card-metrics{margin-top:7px;color:var(--yp-neutral-700);font-size:11px;line-height:1.5}
                .yp-chart-legend{display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center;margin:0 0 6px}
                .yp-chart-legend-item{display:inline-flex;align-items:center;gap:6px;padding:4px 7px;border:1px solid #aaa;border-radius:999px;background:#fff;color:var(--yp-neutral-900);cursor:pointer;font:12px Arial,sans-serif}
                .yp-chart-legend-item[aria-pressed="false"]{opacity:.48;background:#f2f2f2;text-decoration:line-through}
                .yp-chart-legend-swatch{position:relative;display:inline-block;flex:0 0 22px;width:22px;height:10px}
                .yp-chart-legend-swatch[data-kind="line"]::before,.yp-chart-legend-swatch[data-kind="dashed-line"]::before{content:"";position:absolute;left:0;right:0;top:4px;border-top:2px solid var(--yp-series-color)}
                .yp-chart-legend-swatch[data-kind="dashed-line"]::before{border-top-style:dashed}
                .yp-chart-legend-swatch[data-kind="bar"]{height:10px;border:1px solid var(--yp-series-color);background:var(--yp-series-fill)}
                .yp-chart-legend-swatch[data-kind="area"]{height:10px;border:1px solid var(--yp-series-color);background:var(--yp-series-fill)}
                .yp-chart-legend-swatch[data-kind="point"]::before{content:"";position:absolute;left:7px;top:1px;width:8px;height:8px;border-radius:50%;background:var(--yp-series-color)}
                @media(max-width:850px){
                    .yp-dashboard-grid{grid-template-columns:1fr}
                    .yp-kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
                    .yp-field-grid,.yp-derived-totals,.yp-package-row{grid-template-columns:1fr}
                    .yp-line{display:flex;flex-wrap:wrap}
                    .yp-demand-line{grid-template-columns:1fr}
                    .yp-plan-check-grid{grid-template-columns:1fr!important}
                }`;
            card.appendChild(style);

            const header = document.createElement("div");
            header.className = "yp-header-main";
            const titleEl = document.createElement("div");
            titleEl.style.cssText = "font-weight:700;font-size:15px;white-space:nowrap;";
            const headerStatus = document.createElement("div");
            headerStatus.className = "yp-header-status";
            const headerActions = document.createElement("div");
            headerActions.className = "yp-row";
            const secondaryToolbar = document.createElement("div");
            secondaryToolbar.className = "yp-secondary-toolbar";
            const headerControls = document.createElement("div");
            headerControls.className = "yp-row";
            const summaryBox = document.createElement("div");
            summaryBox.className = "yp-plan-hero";
            const heroMain = document.createElement("div");
            const attentionBox = document.createElement("div");
            attentionBox.className = "yp-attention-strip";
            summaryBox.appendChild(heroMain);
            summaryBox.appendChild(attentionBox);
            const body = document.createElement("div");
            body.className = "yp-scroll-body";
            body.style.cssText = "padding:12px;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;flex:1 1 0;min-height:0;display:block;";
            body.tabIndex = 0;
            const addRow = document.createElement("div");
            addRow.className = "yp-row";
            addRow.style.marginBottom = "12px";
            const dashboardGrid = document.createElement("div");
            dashboardGrid.className = "yp-dashboard-grid";
            const sidebar = document.createElement("div");
            sidebar.style.cssText = "border:1px solid #ddd;border-radius:8px;background:#fff;overflow:hidden;";
            const sidebarHead = document.createElement("div");
            sidebarHead.style.cssText = "padding:10px;font-weight:700;border-bottom:1px solid #eee;";
            sidebarHead.textContent = "Crops";
            const cropList = document.createElement("div");
            cropList.style.cssText = "display:flex;flex-direction:column;max-height:56vh;overflow:auto;";
            sidebar.appendChild(sidebarHead);
            sidebar.appendChild(cropList);
            const mainColumn = document.createElement("div");
            mainColumn.style.cssText = "display:flex;flex-direction:column;gap:12px;min-width:0;";
            const editorBox = document.createElement("div");
            editorBox.style.cssText = "border:1px solid #ddd;border-radius:8px;background:#fff;min-height:280px;";
            const csaBox = document.createElement("div");
            const demandBox = document.createElement("div");
            const cropPlanBox = document.createElement("div");
            const planCheckBox = document.createElement("div");
            csaBox.dataset.yearPlanStrip = "csa";
            demandBox.dataset.yearPlanStrip = "demand";
            cropPlanBox.dataset.yearPlanStrip = "crop-plan";
            planCheckBox.dataset.yearPlanStrip = "plan-check";
            mainColumn.appendChild(editorBox);
            dashboardGrid.appendChild(sidebar);
            dashboardGrid.appendChild(mainColumn);
            body.appendChild(summaryBox);
            body.appendChild(cropPlanBox);
            body.appendChild(demandBox);
            body.appendChild(csaBox);
            body.appendChild(planCheckBox);

            const planCheckGrid = document.createElement("div");
            planCheckGrid.className = "yp-plan-check-grid";
            planCheckGrid.style.cssText = "display:grid;grid-template-columns:minmax(0,1fr) minmax(340px,1fr);gap:12px;";
            const chartBox = document.createElement("div");
            chartBox.style.position = "relative";
            const chartControls = document.createElement("div");
            chartControls.className = "yp-row";
            chartControls.style.marginBottom = "6px";
            const cropFilterSel = document.createElement("select");
            const planCheckSummary = document.createElement("div");
            planCheckSummary.className = "yp-plan-check-summary";
            planCheckSummary.style.cssText = "display:flex;flex-wrap:wrap;gap:5px 14px;padding:7px 8px;margin-bottom:6px;border:1px solid #e0e0e0;border-radius:6px;background:#fafafa;";
            const chartLegend = document.createElement("div");
            chartLegend.className = "yp-chart-legend";
            chartLegend.setAttribute("role", "group");
            chartLegend.setAttribute("aria-label", "Chart series visibility");
            const chartLegendHelp = document.createElement("div");
            chartLegendHelp.className = "yp-chart-legend-help";
            chartLegendHelp.style.cssText = "margin:-1px 0 6px;color:#666;font-size:11px;";
            chartLegendHelp.textContent = "Toggle chart series. Plan Check calculations and totals are unchanged.";
            const canvas = document.createElement("canvas");
            canvas.width = 900;
            canvas.height = 240;
            canvas.style.cssText = "width:100%;height:240px;border:1px solid #eee;";
            const chartHiddenMessage = document.createElement("div");
            chartHiddenMessage.className = "yp-plan-chart-hidden-message";
            chartHiddenMessage.style.cssText = "display:none;position:absolute;left:50%;top:62%;transform:translate(-50%,-50%);pointer-events:none;padding:6px 9px;border:1px solid #bbb;border-radius:5px;background:rgba(255,255,255,.94);color:#555;font-weight:700;";
            chartHiddenMessage.textContent = "All chart series hidden";
            const chartTooltip = document.createElement("div");
            chartTooltip.className = "yp-plan-chart-tooltip";
            chartTooltip.style.cssText = "display:none;position:absolute;z-index:2;pointer-events:none;min-width:170px;padding:7px 8px;border:1px solid #777;border-radius:5px;background:rgba(255,255,255,.97);box-shadow:0 3px 12px rgba(0,0,0,.18);line-height:1.45;";
            const totalsBox = document.createElement("div");
            const diagnosticsBox = document.createElement("div");
            diagnosticsBox.style.marginTop = "10px";
            chartControls.appendChild(document.createTextNode("Crop filter"));
            chartControls.appendChild(cropFilterSel);
            chartBox.appendChild(chartControls);
            chartBox.appendChild(planCheckSummary);
            chartBox.appendChild(chartLegend);
            chartBox.appendChild(chartLegendHelp);
            chartBox.appendChild(canvas);
            chartBox.appendChild(chartHiddenMessage);
            chartBox.appendChild(chartTooltip);
            planCheckGrid.appendChild(chartBox);
            planCheckGrid.appendChild(totalsBox);

            const footer = document.createElement("div");
            footer.style.cssText = "padding:9px 12px;border-top:1px solid #ccc;background:#fff;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;";
            const footerStatus = document.createElement("div");
            footerStatus.style.color = "#555";
            const footerActions = document.createElement("div");
            footerActions.className = "yp-row";
            const closePrompt = document.createElement("div");
            closePrompt.className = "yp-row";
            closePrompt.style.display = "none";
            closePrompt.appendChild(document.createTextNode("Unsaved changes."));
            footer.appendChild(footerStatus);
            footer.appendChild(footerActions);
            footer.appendChild(closePrompt);

            card.appendChild(header);
            card.appendChild(secondaryToolbar);
            card.appendChild(body);
            card.appendChild(footer);
            wrap.appendChild(card);
            document.body.appendChild(wrap);
            session.ui.modalEl = wrap;
            SessionController.addWindowListener(session, "keydown", event => { if (event.key === "Escape") closeDiagnosticsPopovers(null); });
            SessionController.addWindowListener(session, "click", event => { if (!event.target || !event.target.closest || !event.target.closest(".yp-diagnostics-wrap")) closeDiagnosticsPopovers(null); });

            function getWheelDeltaY(event) {
                if (!event) return 0;
                if (event.deltaMode === 1) return event.deltaY * 16;
                if (event.deltaMode === 2) return event.deltaY * Math.max(1, body.clientHeight);
                return event.deltaY;
            }

            function canScrollElement(element, deltaY) {
                if (!element || element.scrollHeight <= element.clientHeight + 1) return false;
                if (deltaY < 0) return element.scrollTop > 0;
                if (deltaY > 0) return element.scrollTop + element.clientHeight < element.scrollHeight - 1;
                return false;
            }

            function findScrollableElement(target, boundary) {
                let element = target && target.nodeType === 1 ? target : target && target.parentElement;
                while (element && element !== boundary) {
                    const computed = window.getComputedStyle(element);
                    if (/(auto|scroll)/.test(computed.overflowY) && element.scrollHeight > element.clientHeight + 1) return element;
                    element = element.parentElement;
                }
                return null;
            }

            function routeModalWheel(event) {
                const deltaY = getWheelDeltaY(event);
                const scrollHost = findScrollableElement(event.target, card) || body;
                if (canScrollElement(scrollHost, deltaY)) {
                    event.preventDefault();
                    event.stopPropagation();
                    scrollHost.scrollTop += deltaY;
                    return;
                }
                event.stopPropagation();
            }

            wrap.addEventListener("wheel", routeModalWheel, { passive: false, capture: true });
            wrap.addEventListener("mousewheel", routeModalWheel, { passive: false, capture: true });

            function mkBtn(label, variant) {
                const button = document.createElement("button");
                button.type = "button";
                button.textContent = label;
                const semanticVariant = variant === "primary" ? "add" : (variant === "secondary" ? "open" : (variant || "neutral"));
                if (window.Trellis && window.Trellis.ui && typeof window.Trellis.ui.applyButtonStyle === "function") {
                    window.Trellis.ui.applyButtonStyle(button, semanticVariant);
                } else {
                    const styles = {
                        add: "border:1px solid var(--yp-success);background:#fff;color:var(--yp-success);",
                        open: "border:1px solid var(--yp-primary);background:#fff;color:var(--yp-primary);",
                        close: "border:1px solid var(--yp-danger);background:#fff;color:var(--yp-danger);", // NEW
                        neutral: "border:1px solid var(--yp-neutral-500);background:#fff;color:var(--yp-neutral-900);",
                        danger: "border:1px solid var(--yp-danger);background:var(--yp-danger);color:#fff;" // CHANGE
                    };
                    button.style.cssText = `${styles[semanticVariant] || styles.neutral}border-radius:6px;cursor:pointer;padding:6px 10px;font:12px Arial,sans-serif;`;
                    button.setAttribute("data-trellis-button-variant", semanticVariant);
                }
                return button;
            }

            function mkInput(type, value, width) {
                const input = document.createElement("input");
                input.type = type;
                if (value !== null && value !== undefined) input.value = String(value);
                input.style.cssText = "padding:5px 6px;border:1px solid #bbb;border-radius:6px;box-sizing:border-box;";
                if (width) input.style.width = `${width}px`;
                return input;
            }

            function mkSelect(options, value, width) {
                const select = document.createElement("select");
                select.style.cssText = "padding:5px 6px;border:1px solid #bbb;border-radius:6px;box-sizing:border-box;";
                if (width) select.style.width = `${width}px`;
                for (const option of (options || [])) {
                    const element = document.createElement("option");
                    element.value = String(option.value);
                    element.textContent = String(option.label);
                    select.appendChild(element);
                }
                select.value = String(value ?? "");
                return select;
            }

            /**
             * Renders one persistent collapsible strip shell and rebuilds its details only when requested.
             */
            function renderStripBox(box, config) {
                const settings = config || {};
                let shell = box.__yearPlanStrip;
                if (!shell) {
                    box.className = "yp-strip-box";
                    const header = document.createElement("div");
                    header.tabIndex = 0;
                    header.setAttribute("role", "button");
                    header.className = "yp-strip-header";
                    const title = document.createElement("span");
                    title.className = "yp-strip-title";
                    const summary = document.createElement("span");
                    summary.className = "yp-strip-summary";
                    const toggle = document.createElement("span");
                    toggle.className = "yp-strip-toggle";
                    const details = document.createElement("div");
                    details.className = "yp-strip-details";
                    details.id = settings.detailsId || Env.uid("yp-strip-details");
                    header.setAttribute("aria-controls", details.id);
                    header.appendChild(title);
                    header.appendChild(summary);
                    header.appendChild(toggle);
                    box.appendChild(header);
                    box.appendChild(details);
                    shell = { header, title, summary, toggle, details, detailsBuilt: false, onToggle: null };
                    header.addEventListener("click", () => { if (shell.onToggle) shell.onToggle(); });
                    header.addEventListener("keydown", event => { if ((event.key === "Enter" || event.key === " ") && shell.onToggle) { event.preventDefault(); shell.onToggle(); } });
                    box.__yearPlanStrip = shell;
                }
                shell.onToggle = settings.onToggle || null;
                shell.title.textContent = String(settings.title || "");
                shell.summary.innerHTML = "";
                if (Array.isArray(settings.summaryChips)) setChipRow(shell.summary, settings.summaryChips);
                else shell.summary.textContent = String(settings.summaryText || "");
                shell.toggle.textContent = settings.expanded ? "Collapse" : "Expand";
                shell.header.setAttribute("aria-expanded", settings.expanded ? "true" : "false");
                shell.details.style.display = settings.expanded ? "block" : "none";
                const shouldBuild = !!settings.rebuildDetails || (!shell.detailsBuilt && (settings.expanded || settings.mountWhenCollapsed));
                if (shouldBuild && settings.renderDetails) {
                    shell.details.innerHTML = "";
                    settings.renderDetails(shell.details);
                    shell.detailsBuilt = true;
                }
                return shell;
            }

            function cropLabel(crop) {
                const plantName = String(crop && crop.plant || "").trim();
                const varietyName = String(crop && crop.variety || "").trim();
                return plantName && varietyName ? `${plantName} - ${varietyName}` : (plantName || varietyName || String(crop && crop.id || "Crop"));
            }

            const formatKg = YearPlanDashboard.formatKg;
            const formatMoney = YearPlanDashboard.formatMoney;

            function statusTone(status) {
                if (status === "Short" || status === "Missing data") return "danger";
                if (status === "Expired / timing issue") return "warning";
                if (status === "Surplus" || status === "OK") return "success";
                if (status === "Unsaved") return "primary";
                return "neutral";
            }

            function createChip(label, value, tone, onClick) {
                const chip = document.createElement(onClick ? "button" : "span");
                if (onClick) chip.type = "button";
                chip.className = "yp-chip";
                chip.dataset.tone = tone || "neutral";
                if (onClick) chip.dataset.clickable = "true";
                chip.innerHTML = value === undefined || value === null || value === ""
                    ? mxUtils.htmlEntities(String(label || ""))
                    : `<strong>${mxUtils.htmlEntities(String(label || ""))}</strong> ${mxUtils.htmlEntities(String(value))}`;
                if (onClick) chip.addEventListener("click", onClick);
                return chip;
            }

            function validationMessage(result) {
                return YearPlanDashboard.validationMessage(result);
            }

            function cropValidationResults(cropId) {
                const wanted = String(cropId || "");
                return ((dashboard && dashboard.validationErrors) || []).filter(error => error && error.scope === "crop" && String(error.cropId || "") === wanted);
            }

            function cropHasDiagnostics(cropId) {
                return cropValidationResults(cropId).length > 0;
            }

            function csaValidationResults() {
                return ((dashboard && dashboard.validationErrors) || []).filter(error => error && error.scope === "csa");
            }

            function closeDiagnosticsPopovers(except) {
                for (const popover of card.querySelectorAll(".yp-diagnostics-popover")) {
                    if (popover !== except) { popover.hidden = true; if (popover.parentElement) popover.parentElement.dataset.pinned = "false"; }
                }
            }

            function focusAndHighlight(element) {
                if (!element) return false;
                if (element.disabled) return false;
                if (typeof element.focus === "function") element.focus();
                element.classList.add("yp-field-highlight");
                setTimeout(() => { if (element && element.classList) element.classList.remove("yp-field-highlight"); }, 1200);
                if (typeof element.scrollIntoView === "function") element.scrollIntoView({ block: "center", inline: "nearest" });
                return true;
            }

            function findTargetControl(target) {
                if (!target || typeof target !== "object") return null;
                const selectorParts = [`[data-year-plan-field="${String(target.field || "").replace(/"/g, '\\"')}"]`];
                if (target.cropId) selectorParts.push(`[data-crop-id="${String(target.cropId).replace(/"/g, '\\"')}"]`);
                if (target.packageIndex !== undefined) selectorParts.push(`[data-package-index="${String(target.packageIndex).replace(/"/g, '\\"')}"]`);
                if (target.componentIndex !== undefined) selectorParts.push(`[data-csa-component-index="${String(target.componentIndex).replace(/"/g, '\\"')}"]`);
                if (target.channelId) selectorParts.push(`[data-year-plan-demand-channel-id="${String(target.channelId).replace(/"/g, '\\"')}"]`);
                if (target.lineId) selectorParts.push(`[data-year-plan-demand-line-id="${String(target.lineId).replace(/"/g, '\\"')}"]`);
                return card.querySelector(selectorParts.join(""));
            }

            function navigateToValidation(result, fallbackTrigger) {
                const target = result && result.target;
                if (!target || typeof target !== "object") return focusAndHighlight(fallbackTrigger);
                if (target.area === "crop") {
                    const targetTab = target.tab || "basics";
                    const needsCropRender = String(state.selectedCropId || "") !== String(target.cropId || "") || state.activeTab !== targetTab;
                    if (target.cropId && setSelectedCropEverywhere(target.cropId, { expandCropPlan: true, expandPlanCheck: true, activeTab: targetTab }) && needsCropRender) {
                        renderCropList(); renderSelectedEditor(); renderCropPlan(false); renderPlanCheck();
                    }
                } else if (target.area === "csa") {
                    state.csaExpanded = true;
                    renderCsa(true);
                } else if (target.area === "demand") {
                    state.demandExpanded = true;
                    const line = target.lineId
                        ? (plan.demands || []).find(item => String(item && item.id || "") === String(target.lineId))
                        : (plan.demands || [])[Math.max(0, Math.trunc(Number(target.lineIndex) || 0))];
                    if (line) {
                        state.collapsedDemandLineIds.delete(String(line.id || ""));
                        state.collapsedDemandChannelIds.delete(String(line.channelId || ""));
                    } else if (target.channelId) {
                        state.collapsedDemandChannelIds.delete(String(target.channelId));
                    }
                    renderDemandStrip(true);
                } else if (target.area === "crop-list") {
                    state.cropPlanExpanded = true;
                    renderCropPlan(false);
                }
                const control = findTargetControl(target);
                return focusAndHighlight(control) || focusAndHighlight(fallbackTrigger);
            }

            function createDiagnosticsControl(label, results) {
                const diagnostics = (results || []).filter(error => validationMessage(error));
                if (!diagnostics.length) return null;
                const wrapControl = document.createElement("span");
                wrapControl.className = "yp-diagnostics-wrap";
                const trigger = document.createElement("button");
                trigger.type = "button";
                trigger.className = "yp-diagnostics-trigger";
                trigger.textContent = "?";
                trigger.setAttribute("aria-label", label);
                const popover = document.createElement("div");
                popover.className = "yp-diagnostics-popover";
                popover.hidden = true;
                const title = document.createElement("div");
                title.className = "yp-diagnostics-title";
                title.textContent = label;
                popover.appendChild(title);
                for (const result of diagnostics) {
                    const item = document.createElement("button");
                    item.type = "button";
                    item.className = "yp-diagnostics-item";
                    item.textContent = validationMessage(result);
                    item.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); navigateToValidation(result, trigger); });
                    popover.appendChild(item);
                }
                const show = pinned => { closeDiagnosticsPopovers(popover); popover.hidden = false; if (pinned) wrapControl.dataset.pinned = "true"; };
                const hide = () => { if (wrapControl.dataset.pinned !== "true") popover.hidden = true; };
                trigger.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); const nextPinned = wrapControl.dataset.pinned !== "true"; wrapControl.dataset.pinned = nextPinned ? "true" : "false"; if (nextPinned) show(true); else popover.hidden = true; });
                trigger.addEventListener("focus", () => show(false));
                trigger.addEventListener("mouseenter", () => show(false));
                wrapControl.addEventListener("mouseleave", hide);
                wrapControl.addEventListener("click", event => event.stopPropagation());
                wrapControl.appendChild(trigger);
                wrapControl.appendChild(popover);
                return wrapControl;
            }

            function createDiagnosticsChip(label, tone, results, onClick) {
                const wrapControl = document.createElement("span");
                wrapControl.className = "yp-diagnostics-wrap";
                wrapControl.appendChild(createChip(label, "", tone, onClick));
                const diagnostics = createDiagnosticsControl(label, results);
                if (diagnostics) wrapControl.appendChild(diagnostics);
                return wrapControl;
            }

            function setChipRow(host, chips) {
                host.innerHTML = "";
                host.classList.add("yp-chip-row");
                for (const chip of (chips || [])) host.appendChild(chip);
            }

            function createKpiTile(label, value, tone) {
                const tile = document.createElement("div");
                tile.className = "yp-kpi-tile";
                tile.dataset.tone = tone || "neutral";
                const labelEl = document.createElement("div");
                labelEl.className = "yp-kpi-label";
                labelEl.textContent = label;
                const valueEl = document.createElement("div");
                valueEl.className = "yp-kpi-value";
                valueEl.textContent = value;
                tile.appendChild(labelEl);
                tile.appendChild(valueEl);
                return tile;
            }

            function getDashboardStatus() {
                if (!dashboard) return "OK";
                if ((dashboard.validationErrors || []).length || (dashboard.cropMetrics || []).some(metric => metric.status === "Missing data")) return "Missing data";
                if (Number(dashboard.shortKg) > EPS) return "Short";
                if ((dashboard.cropMetrics || []).some(metric => metric.status === "Expired / timing issue")) return "Expired / timing issue";
                return "OK";
            }

            function dashboardChartSummary() {
                return runtime && runtime.weekly
                    ? PlanMath.summarizePlanChartModel(PlanMath.buildPlanChartModel(runtime.weekly, ""))
                    : { targetKg: Number(dashboard && dashboard.targetKg) || 0, usableSupplyKg: Math.max(0, (Number(dashboard && dashboard.targetKg) || 0) - (Number(dashboard && dashboard.shortKg) || 0)), shortKg: Number(dashboard && dashboard.shortKg) || 0, expiredKg: 0, worstShortageKg: 0, worstShortageWeek: "", shortWeeks: 0 };
            }

            function buildAttentionItems(chartSummary) {
                const items = [];
                const add = item => { if (items.length < 8 && item) items.push(item); };
                for (const metric of ((dashboard && dashboard.cropMetrics) || [])) {
                    const cropDiagnostics = cropValidationResults(metric.crop.id);
                    if (metric.status === "Missing data") add(createDiagnosticsChip(`${cropLabel(metric.crop)} missing data`, "danger", cropDiagnostics, () => selectCropFromAttention(metric.crop.id)));
                    else if (cropDiagnostics.length) add(createDiagnosticsChip(`${cropLabel(metric.crop)} diagnostics`, "danger", cropDiagnostics, () => selectCropFromAttention(metric.crop.id)));
                    else if (metric.status === "Short") add(createChip(`${cropLabel(metric.crop)} short ${formatKg(metric.shortKg)}`, "", "danger", () => selectCropFromAttention(metric.crop.id)));
                    else if (metric.status === "Expired / timing issue") add(createChip(`${cropLabel(metric.crop)} timing ${formatKg(metric.shortKg)}`, "", "warning", () => selectCropFromAttention(metric.crop.id)));
                }
                if (chartSummary && chartSummary.expiredKg > EPS) add(createChip(`Expired ${formatKg(chartSummary.expiredKg)}`, "", "warning", () => { state.planCheckExpanded = true; renderPlanCheck(); }));
                if (PlanSchema.validateDemand(plan).length) add(createChip("Demand dates invalid", "", "danger", () => { state.demandExpanded = true; renderDemandStrip(true); }));
                if (PlanSchema.validateCsa(plan).length) add(createDiagnosticsChip("CSA setup issues", "danger", csaValidationResults(), () => { state.csaExpanded = true; renderCsa(true); }));
                if ((dashboard && dashboard.diagnostics || []).length && !items.length) add(createChip("Plan Check has diagnostics", "", "warning", () => { state.planCheckExpanded = true; renderPlanCheck(); }));
                return items;
            }

            function selectCropFromAttention(cropId) {
                if (!setSelectedCropEverywhere(cropId, { expandCropPlan: true, expandPlanCheck: true })) return;
                renderCropList();
                renderSelectedEditor();
                renderCropPlan(false);
                renderPlanCheck();
            }

            function listUnitOptions(crop) {
                const options = [{ value: "kg", label: "kg" }, { value: "g", label: "g" }, { value: "lb", label: "lb" }, { value: "plant", label: "plant" }];
                const seen = new Set(options.map(option => option.value));
                for (const pkg of ((crop && crop.packages) || [])) {
                    const unit = String(pkg && pkg.unit || "").trim();
                    const key = unit.toLowerCase();
                    if (!key || seen.has(key)) continue;
                    seen.add(key);
                    options.push({ value: unit, label: unit });
                }
                return options;
            }

            function defaultUnit(crop) {
                return String(crop && crop.packages && crop.packages[0] && crop.packages[0].unit || "").trim() || "kg";
            }

            function ensureSelectOption(select, value, label) {
                const desired = String(value ?? "");
                if (!desired || Array.from(select.options).some(option => String(option.value) === desired)) return;
                select.appendChild(new Option(label || `${desired} (unavailable)`, desired));
            }

            function setYearPlanField(control, field, metadata) {
                if (!control) return control;
                control.dataset.yearPlanField = String(field || "");
                const data = metadata || {};
                if (data.cropId !== undefined) control.dataset.cropId = String(data.cropId);
                if (data.packageIndex !== undefined) control.dataset.packageIndex = String(data.packageIndex);
                if (data.componentIndex !== undefined) control.dataset.csaComponentIndex = String(data.componentIndex);
                if (data.channelId !== undefined) control.dataset.yearPlanDemandChannelId = String(data.channelId);
                if (data.lineId !== undefined) control.dataset.yearPlanDemandLineId = String(data.lineId);
                return control;
            }

            function hasActualHarvestForCrop(crop) {
                const derived = runtime && runtime.derivedByCropId && runtime.derivedByCropId.get(String(crop && crop.id || ""));
                return !!derived && Array.isArray(derived.actualHarvestWeeklyKg) && derived.actualHarvestWeeklyKg.some(value => Number(value) > 0);
            }

            function hasSowingWindowEstimateForCrop(crop) {
                return PlanRuntimeService.hasEstimatedHarvestWindow(crop);
            }

            function harvestWindowSourceOptions() {
                return [
                    { value: "manual", label: "Manual dates" },
                    { value: "actual_harvest", label: "Actual harvest" },
                    { value: "sowing_window_estimate", label: "Sowing window" }
                ];
            } // CHANGE: expose the mutually exclusive harvest-date sources as one editor control.

            function syncHarvestWindowSourceControl(control, crop, actualAvailable, estimateAvailable) {
                if (!control || !crop) return;
                const source = String(crop.harvestWindowSource || "manual");
                control.value = source;
                for (const option of Array.from(control.options || [])) {
                    option.disabled = (option.value === "actual_harvest" && !actualAvailable)
                        || (option.value === "sowing_window_estimate" && !estimateAvailable && source !== "sowing_window_estimate");
                }
                if ((source === "actual_harvest" && !actualAvailable) || (source === "sowing_window_estimate" && !estimateAvailable)) {
                    control.value = source === "sowing_window_estimate" && !crop.estimatedHarvestUnavailableReason ? "sowing_window_estimate" : "manual";
                }
            } // CHANGE: pending sowing-window crops stay selected until a failed result falls back to manual.

            function selectedCrop() {
                return (plan.crops || []).find(crop => String(crop.id) === String(state.selectedCropId)) || null;
            }

            function setSelectedCropEverywhere(cropId, options) {
                const settings = options || {};
                const crop = (plan.crops || []).find(item => String(item && item.id || "") === String(cropId));
                if (!crop) return false;
                const selectedId = String(crop.id);
                state.selectedCropId = selectedId;
                state.activeTab = settings.activeTab || "basics";
                if (settings.expandCropPlan) state.cropPlanExpanded = true;
                if (settings.expandPlanCheck) state.planCheckExpanded = true;
                if (settings.syncPlanCheck !== false) {
                    plan.cropFilterId = selectedId;
                    cropFilterSel.value = selectedId;
                }
                return true;
            }

            function addField(host, label, control, help) {
                const field = document.createElement("label");
                field.style.cssText = "display:flex;flex-direction:column;gap:4px;min-width:0;";
                const title = document.createElement("span");
                title.style.fontWeight = "700";
                title.textContent = label;
                if (control && !control.style.width) control.style.width = "100%";
                field.appendChild(title);
                field.appendChild(control);
                if (help) {
                    const note = document.createElement("span");
                    note.style.cssText = "color:#666;font-size:11px;";
                    note.textContent = help;
                    field.appendChild(note);
                }
                host.appendChild(field);
                return field;
            }

            function addPackageField(host, label, control) {
                const field = document.createElement("label");
                field.className = "yp-package-field";
                const title = document.createElement("span");
                title.className = "yp-package-title";
                title.textContent = label;
                if (control && !control.style.width) control.style.width = "100%";
                field.appendChild(title);
                field.appendChild(control);
                host.appendChild(field);
                return field;
            }

            function createDerivedTile(label, help) {
                const tile = document.createElement("div");
                tile.className = "yp-derived-tile";
                if (help) tile.title = help;
                const labelEl = document.createElement("div");
                labelEl.className = "yp-derived-label";
                labelEl.textContent = label;
                const valueEl = document.createElement("div");
                valueEl.className = "yp-derived-value";
                valueEl.textContent = "0";
                tile.appendChild(labelEl);
                tile.appendChild(valueEl);
                return { tile, valueEl };
            }

            function resolveDefaultKgPerPlant(crop) {
                let nextYield = Number(crop && crop.baseKgPerPlant);
                const rows = varietyCache.get(String(crop && crop.plantId || "")) || [];
                const row = rows.find(item => String(item.variety_id) === String((crop && crop.varietyId) ?? ""));
                const overrides = row ? Env.safeJsonStringParse(row.overrides_json, null) : null;
                const overrideYield = Number(overrides && (overrides.yield_per_plant_kg ?? overrides.overrides?.yield_per_plant_kg));
                if (Number.isFinite(overrideYield) && overrideYield > 0) nextYield = overrideYield;
                return Number.isFinite(nextYield) && nextYield > 0 ? nextYield : null;
            }

            function updateYieldHint(crop, hint, resetYield) {
                if (!hint) return;
                const defaultYield = resolveDefaultKgPerPlant(crop);
                const defaultText = Number.isFinite(defaultYield) ? `${defaultYield} kg/plant default` : "No default yield available";
                hint.textContent = crop && crop.kgPerPlantMode === "manual"
                    ? `Manual override; ${defaultText}`
                    : `Using ${defaultText}`;
                if (resetYield) resetYield.style.display = crop && crop.kgPerPlantMode === "manual" ? "" : "none";
            }

            /**
             * Keeps one editable date pair valid without rewriting the opposite endpoint.
             */
            function bindPairedDateControls(startInput, endInput, options) {
                const settings = options || {};
                const diagnostic = String(settings.diagnostic || "Start date cannot be after end date.");
                let lastStartValue = String(startInput.value || "");
                let lastEndValue = String(endInput.value || "");

                function updateConstraints() {
                    startInput.max = PlanMath.hasYmd(endInput.value) ? endInput.value : "";
                    endInput.min = PlanMath.hasYmd(startInput.value) ? startInput.value : "";
                }

                function syncFromInputs() {
                    lastStartValue = String(startInput.value || "");
                    lastEndValue = String(endInput.value || "");
                    updateConstraints();
                }

                function removeDiagnostic() {
                    state.extraDiagnostics = (state.extraDiagnostics || []).filter(message => message !== diagnostic);
                }

                function rejectChange(input, previousValue, beforeDateRanges) {
                    input.value = previousValue;
                    state.extraDiagnostics = YearPlanDashboard.uniqueMessages([...(state.extraDiagnostics || []), diagnostic]);
                    state.planCheckExpanded = true;
                    updateConstraints();
                    refreshDerived(beforeDateRanges);
                }

                function handleChange(changedField) {
                    const beforeDateRanges = captureDateRangeSnapshot();
                    const nextStart = String(startInput.value || "");
                    const nextEnd = String(endInput.value || "");
                    if (PlanMath.hasYmd(nextStart) && PlanMath.hasYmd(nextEnd) && nextStart > nextEnd) {
                        rejectChange(
                            changedField === "start" ? startInput : endInput,
                            changedField === "start" ? lastStartValue : lastEndValue,
                            beforeDateRanges
                        );
                        return;
                    }

                    const previousPair = { start: lastStartValue, end: lastEndValue };
                    removeDiagnostic();
                    if (changedField === "start") {
                        lastStartValue = nextStart;
                        if (settings.setStart) settings.setStart(nextStart);
                    } else {
                        lastEndValue = nextEnd;
                        if (settings.setEnd) settings.setEnd(nextEnd);
                    }
                    updateConstraints();
                    if (settings.afterCommit) settings.afterCommit(beforeDateRanges, previousPair, changedField);
                    else refreshDerived(beforeDateRanges);
                }

                startInput.__syncPairedDateState = syncFromInputs;
                endInput.__syncPairedDateState = syncFromInputs;
                syncFromInputs();
                startInput.addEventListener("change", () => handleChange("start"));
                endInput.addEventListener("change", () => handleChange("end"));
            }

            function debounceRefresh(renderOptions) {
                if (renderOptions) pendingRefreshOptions = { ...(pendingRefreshOptions || {}), ...renderOptions };
                if (refreshTimer) clearTimeout(refreshTimer);
                refreshTimer = setTimeout(() => {
                    refreshTimer = null;
                    const options = pendingRefreshOptions;
                    pendingRefreshOptions = null;
                    if (SessionController.isActive(session)) refreshDerived(null, options);
                }, 90);
            }

            function fillTemplateDropdown() {
                templateSel.innerHTML = "";
                templateSel.appendChild(new Option("-- Select template --", ""));
                for (const name of PlanRepository.listTemplateNames()) templateSel.appendChild(new Option(name, name));
            }

            function fillCropFilter() {
                const current = String(plan.cropFilterId || "");
                cropFilterSel.innerHTML = "";
                cropFilterSel.appendChild(new Option("-- All crops --", ""));
                for (const crop of (plan.crops || [])) cropFilterSel.appendChild(new Option(cropLabel(crop), crop.id));
                cropFilterSel.value = (plan.crops || []).some(crop => String(crop.id) === current) ? current : "";
                plan.cropFilterId = cropFilterSel.value;
            }

            function replacePlan(nextPlan, nextYear, loadedExisting) {
                Object.keys(plan).forEach(key => delete plan[key]);
                Object.assign(plan, PlanSchema.normalizeForRuntime(nextPlan, nextYear));
                currentYear = Number(nextYear);
                loadedExistingForCurrentYear = !!loadedExisting;
                plan.year = currentYear;
                state.selectedCropId = YearPlanDashboard.resolveSelectedCropId(plan.crops, "", 0);
                state.activeTab = "basics";
                state.hadBlockingErrors = false;
                state.hadCsaErrors = false;
                state.hadDemandErrors = false;
                state.validationState = "idle";
                state.lastSavedAt = null;
                state.closePromptOpen = false;
                state.extraDiagnostics = [];
                YearPlanDashboard.applyCollapsePreferences(state, YearPlanCollapsePreferences.load(moduleCell, currentYear));
                titleEl.textContent = `Plan Year ${currentYear}`;
                yearInput.value = String(currentYear);
            }

            function renderSummary() {
                const chartSummary = dashboardChartSummary();
                const status = getDashboardStatus();
                const statusText = status === "Expired / timing issue" ? "Warning" : status;
                const statusToneName = status === "Expired / timing issue" ? "warning" : statusTone(status);
                const dirty = YearPlanDashboard.isDirty(state, plan);
                heroMain.innerHTML = "";
                const head = document.createElement("div");
                head.className = "yp-plan-hero-head";
                const titleGroup = document.createElement("div");
                const title = document.createElement("div");
                title.className = "yp-plan-hero-title";
                title.textContent = `${currentYear} Year Plan`;
                const sub = document.createElement("div");
                sub.className = "yp-plan-hero-sub";
                sub.textContent = `${dashboard.cropCount} crop${dashboard.cropCount === 1 ? "" : "s"} planned`;
                titleGroup.appendChild(title);
                titleGroup.appendChild(sub);
                const statusRow = document.createElement("div");
                statusRow.className = "yp-chip-row";
                statusRow.appendChild(createChip("Status", statusText, statusToneName));
                if (dirty) statusRow.appendChild(createChip("Unsaved", "", "primary"));
                head.appendChild(titleGroup);
                head.appendChild(statusRow);
                const grid = document.createElement("div");
                grid.className = "yp-kpi-grid";
                grid.appendChild(createKpiTile("Crops", String(dashboard.cropCount), "neutral"));
                grid.appendChild(createKpiTile("Target", formatKg(chartSummary.targetKg), "primary"));
                grid.appendChild(createKpiTile("Usable supply", formatKg(chartSummary.usableSupplyKg), "success"));
                grid.appendChild(createKpiTile("Total revenue", formatMoney(dashboard.totalFulfilledRevenue), dashboard.totalFulfilledRevenue > EPS ? "success" : "neutral"));
                heroMain.appendChild(head);
                heroMain.appendChild(grid);
                const attentionItems = buildAttentionItems(chartSummary);
                attentionBox.innerHTML = "";
                attentionBox.style.display = attentionItems.length ? "block" : "none";
                if (attentionItems.length) {
                    const label = document.createElement("div");
                    label.className = "yp-attention-title";
                    label.textContent = "Needs attention";
                    const row = document.createElement("div");
                    row.className = "yp-chip-row";
                    for (const item of attentionItems) row.appendChild(item);
                    attentionBox.appendChild(label);
                    attentionBox.appendChild(row);
                }
            }

            function renderCropList() {
                cropList.innerHTML = "";
                if (!dashboard.cropMetrics.length) {
                    const empty = document.createElement("div");
                    empty.style.cssText = "padding:16px;color:#666;";
                    empty.textContent = "No crops in this plan.";
                    cropList.appendChild(empty);
                    return;
                }
                for (const metric of dashboard.cropMetrics) {
                    const selected = String(metric.crop.id) === String(state.selectedCropId);
                    const cardEl = document.createElement("div");
                    cardEl.tabIndex = 0;
                    cardEl.setAttribute("role", "button");
                    cardEl.className = "yp-crop-card";
                    cardEl.dataset.selected = selected ? "true" : "false";
                    cardEl.dataset.cropId = String(metric.crop.id || "");
                    const detail = metric.status === "Short" || metric.status === "Expired / timing issue"
                        ? `${metric.status} ${formatKg(metric.shortKg)}`
                        : metric.status === "Surplus" ? `Surplus ${formatKg(metric.surplusKg)}`
                            : metric.status;
                    const top = document.createElement("div");
                    top.className = "yp-crop-card-top";
                    const name = document.createElement("div");
                    name.className = "yp-crop-card-name";
                    name.textContent = cropLabel(metric.crop);
                    const statusHost = document.createElement("span");
                    statusHost.className = "yp-diagnostics-wrap";
                    statusHost.appendChild(createChip(detail, "", statusTone(metric.status)));
                    const cropDiagnostics = cropHasDiagnostics(metric.crop.id) ? createDiagnosticsControl(`${cropLabel(metric.crop)} diagnostics`, cropValidationResults(metric.crop.id)) : null;
                    if (cropDiagnostics) statusHost.appendChild(cropDiagnostics);
                    top.appendChild(name);
                    top.appendChild(statusHost);
                    const metrics = document.createElement("div");
                    metrics.className = "yp-crop-card-metrics";
                    const requiredPlants = Number.isFinite(metric.plantsReq) && metric.plantsReq > 0 ? Math.ceil(metric.plantsReq) : 0;
                    const actualPlants = Math.max(0, Math.trunc(Number(metric.crop.actualPlants) || 0));
                    metrics.innerHTML = `Target ${mxUtils.htmlEntities(formatKg(metric.targetKg))}<br>Usable ${mxUtils.htmlEntities(formatKg(Math.max(0, metric.targetKg - metric.shortKg)))}<br>Plants ${actualPlants} / ${requiredPlants} required`;
                    cardEl.appendChild(top);
                    cardEl.appendChild(metrics);
                    cardEl.addEventListener("click", () => {
                        if (!setSelectedCropEverywhere(metric.crop.id)) return;
                        renderCropList();
                        renderSelectedEditor();
                        renderDemandStrip(true);
                        renderCropPlan(false);
                        renderPlanCheck();
                    });
                    cardEl.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); cardEl.click(); } });
                    cropList.appendChild(cardEl);
                }
            }

            function syncEditorDerived() {
                const crop = selectedCrop();
                if (!crop || !dashboard) return;
                const metric = dashboard.cropMetricsById.get(String(crop.id));
                if (editorRefs.actual) editorRefs.actual.textContent = String(Math.max(0, Math.trunc(Number(crop.actualPlants) || 0)));
                if (editorRefs.required) editorRefs.required.textContent = String(metric && Number.isFinite(metric.plantsReq) && metric.plantsReq > 0 ? Math.ceil(metric.plantsReq) : 0);
                if (editorRefs.seeds) editorRefs.seeds.textContent = String(metric && Number.isFinite(metric.seedsReq) && metric.seedsReq > 0 ? Math.ceil(metric.seedsReq) : 0);
                if (editorRefs.harvestStart) editorRefs.harvestStart.value = PlanMath.hasYmd(crop.harvestStart) ? crop.harvestStart : "";
                if (editorRefs.harvestEnd) editorRefs.harvestEnd.value = PlanMath.hasYmd(crop.harvestEnd) ? crop.harvestEnd : "";
                const source = String(crop.harvestWindowSource || "manual");
                const actualAvailable = hasActualHarvestForCrop(crop);
                const estimateAvailable = hasSowingWindowEstimateForCrop(crop);
                syncHarvestWindowSourceControl(editorRefs.harvestSource, crop, actualAvailable, estimateAvailable); // CHANGE: one selector replaces the old paired checkboxes.
                if (editorRefs.estimateMessage) {
                    editorRefs.estimateMessage.textContent = estimateAvailable
                        ? `Sowing window ${crop.estimatedHarvestStart} to ${crop.estimatedHarvestEnd}`
                        : (crop.estimatedHarvestUnavailableReason ? `Sowing window unavailable: ${crop.estimatedHarvestUnavailableReason}` : "Sowing window unavailable");
                }
                if (editorRefs.harvestStart && editorRefs.harvestEnd) editorRefs.harvestStart.disabled = editorRefs.harvestEnd.disabled = source !== "manual";
                if (editorRefs.harvestStart && editorRefs.harvestStart.__syncPairedDateState) editorRefs.harvestStart.__syncPairedDateState();
                if (editorRefs.yieldHint) updateYieldHint(crop, editorRefs.yieldHint, editorRefs.resetYield);
                if (editorRefs.harvestTimeline && runtime) {
                    const weeklyCrop = runtime.weekly && runtime.weekly.perCrop && runtime.weekly.perCrop.get(String(crop.id));
                    renderCropTimeline(editorRefs.harvestTimeline, runtime.weekStarts, weeklyCrop, crop); // CHANGE: show demand, raw harvest, and inventory for the selected crop.
                }
            }

            function syncDemandDerived() {
                if (!dashboard || !demandRefs.channelSummaries) return;
                for (const [channelId, summary] of demandRefs.channelSummaries) {
                    const metric = dashboard.channelMetricsById.get(String(channelId));
                    if (metric) setChipRow(summary, buildChannelSummaryChips(metric));
                }
                if (demandRefs.lineSummaries) {
                    for (const [lineId, summary] of demandRefs.lineSummaries) {
                        const line = (plan.demands || []).find(item => String(item && item.id || "") === String(lineId));
                        if (line) setChipRow(summary, demandLineSummaryChips(line, PlanMath.findCrop(plan, line.cropId)));
                    }
                }
            }

            function syncCsaDerived() {
                if (!dashboard || !csaRefs.componentValue || !csaRefs.salePrice) return;
                const metric = dashboard.csaMetric || {};
                csaRefs.componentValue.value = (Math.max(0, Number(metric.componentValuePerBox) || 0)).toFixed(2);
                if (document.activeElement !== csaRefs.salePrice) csaRefs.salePrice.value = (Math.max(0, Number(plan.csa && plan.csa.salePricePerBox) || 0)).toFixed(2);
                if (csaRefs.resetSale) csaRefs.resetSale.disabled = plan.csa && plan.csa.salePriceMode !== "manual";
            }

            function updateChartLegendState() {
                for (const button of chartLegend.querySelectorAll(".yp-chart-legend-item")) {
                    const series = PLAN_CHART_SERIES.find(item => item.id === button.dataset.seriesId);
                    if (!series) continue;
                    const visible = visibleChartSeriesIds.has(series.id);
                    button.setAttribute("aria-pressed", visible ? "true" : "false");
                    button.setAttribute("aria-label", `${series.label}. ${series.help} Currently ${visible ? "shown" : "hidden"}.`);
                    button.title = `${series.label}: ${series.help} Click to ${visible ? "hide" : "show"}.`;
                }
            }

            function renderChartLegend() {
                chartLegend.innerHTML = "";
                for (const series of PLAN_CHART_SERIES) {
                    const button = document.createElement("button");
                    button.type = "button";
                    button.className = "yp-chart-legend-item";
                    button.dataset.seriesId = series.id;
                    const swatch = document.createElement("span");
                    swatch.className = "yp-chart-legend-swatch";
                    swatch.dataset.kind = series.kind;
                    swatch.setAttribute("aria-hidden", "true");
                    swatch.style.setProperty("--yp-series-color", series.color);
                    swatch.style.setProperty("--yp-series-fill", series.fill || series.color);
                    const label = document.createElement("span");
                    label.textContent = series.label;
                    button.appendChild(swatch);
                    button.appendChild(label);
                    button.addEventListener("click", () => {
                        if (visibleChartSeriesIds.has(series.id)) visibleChartSeriesIds.delete(series.id);
                        else visibleChartSeriesIds.add(series.id);
                        chartTooltip.style.display = "none";
                        renderPlanCheck();
                    });
                    chartLegend.appendChild(button);
                }
                updateChartLegendState();
            }

            function sumPositiveValues(values) {
                return (Array.isArray(values) ? values : []).reduce((total, value) => total + Math.max(0, Number(value) || 0), 0);
            }

            function summarizePlanCheckRevenue(cropId) {
                const selectedCropId = String(cropId || "");
                if (!selectedCropId) {
                    return {
                        potentialRevenue: Math.max(0, Number(dashboard.totalPotentialRevenue) || 0),
                        fulfilledRevenue: Math.max(0, Number(dashboard.totalFulfilledRevenue) || 0)
                    };
                }
                let salesPotential = 0;
                let salesFulfilled = 0;
                if (runtime.weekly && runtime.weekly.perDemandLine && typeof runtime.weekly.perDemandLine.forEach === "function") {
                    runtime.weekly.perDemandLine.forEach(result => {
                        if (String(result && result.cropId || "") !== selectedCropId) return;
                        salesPotential += sumPositiveValues(result && result.potentialRevenue);
                        salesFulfilled += sumPositiveValues(result && result.fulfilledRevenue);
                    });
                }
                const csaWeekly = runtime.weekly && runtime.weekly.csa;
                const csaPotentialByCrop = csaWeekly && csaWeekly.potentialRevenueByCropId;
                const csaFulfilledByCrop = csaWeekly && csaWeekly.fulfilledRevenueByCropId;
                return {
                    potentialRevenue: salesPotential + sumPositiveValues(csaPotentialByCrop && csaPotentialByCrop.get ? csaPotentialByCrop.get(selectedCropId) : null),
                    fulfilledRevenue: salesFulfilled + sumPositiveValues(csaFulfilledByCrop && csaFulfilledByCrop.get ? csaFulfilledByCrop.get(selectedCropId) : null)
                };
            }

            function renderPlanCheck() {
                const cropId = String(plan.cropFilterId || "");
                const visibleCrops = cropId
                    ? (plan.crops || []).filter(crop => String(crop && crop.id || "") === cropId)
                    : (plan.crops || []);
                const chartModel = PlanMath.buildPlanChartModel(runtime.weekly, cropId);
                const chartSummary = PlanMath.summarizePlanChartModel(chartModel);
                const scopedRevenue = summarizePlanCheckRevenue(cropId);
                renderStripBox(planCheckBox, {
                    title: "Plan Check",
                    expanded: state.planCheckExpanded,
                    onToggle: () => { state.planCheckExpanded = !state.planCheckExpanded; saveCollapsePreferences(); renderPlanCheck(); },
                    mountWhenCollapsed: true,
                    renderDetails: details => { details.appendChild(planCheckGrid); details.appendChild(diagnosticsBox); }
                });
                if (!state.planCheckExpanded) chartTooltip.style.display = "none";
                updateChartLegendState();
                chartHiddenMessage.style.display = visibleChartSeriesIds.size === 0 ? "block" : "none";
                chartHitModel = drawPlanChart(canvas, chartModel, visibleChartSeriesIds);
                const worstShortage = chartSummary.worstShortageKg > 0
                    ? `${formatKg(chartSummary.worstShortageKg)} \u00b7 Week of ${mxUtils.htmlEntities(chartSummary.worstShortageWeek)}`
                    : "-";
                setChipRow(planCheckSummary, [
                    createChip("Target", formatKg(chartSummary.targetKg), "primary"),
                    createChip("Harvested", formatKg(chartSummary.harvestKg), chartSummary.harvestKg > EPS ? "success" : "neutral"),
                    createChip("Usable", formatKg(chartSummary.usableSupplyKg), chartSummary.usableSupplyKg > EPS ? "success" : "neutral"),
                    createChip("Short", formatKg(chartSummary.shortKg), chartSummary.shortKg > EPS ? "danger" : "success"),
                    createChip("Expired", formatKg(chartSummary.expiredKg), chartSummary.expiredKg > EPS ? "warning" : "neutral"),
                    createChip("Worst shortage", worstShortage, chartSummary.worstShortageKg > EPS ? "danger" : "neutral"),
                    createChip("Short weeks", String(chartSummary.shortWeeks), chartSummary.shortWeeks > 0 ? "danger" : "success"),
                    createChip("Total potential", formatMoney(scopedRevenue.potentialRevenue), "neutral"),
                    createChip("Total fulfilled", formatMoney(scopedRevenue.fulfilledRevenue), scopedRevenue.fulfilledRevenue > EPS ? "success" : "neutral")
                ]);

                const rows = visibleCrops.map(crop => {
                    const summary = PlanMath.summarizePlanChartModel(PlanMath.buildPlanChartModel(runtime.weekly, String(crop.id)));
                    const revenue = summarizePlanCheckRevenue(crop.id);
                    const metric = dashboard.cropMetricsById.get(String(crop.id));
                    return `<tr><td>${mxUtils.htmlEntities(cropLabel(crop))}</td><td>${summary.targetKg.toFixed(1)}</td><td>${summary.harvestKg.toFixed(1)}</td><td>${summary.usableSupplyKg.toFixed(1)}</td><td>${summary.shortKg.toFixed(1)}</td><td>${summary.expiredKg.toFixed(1)}</td><td>${formatMoney(revenue.potentialRevenue)}</td><td>${formatMoney(revenue.fulfilledRevenue)}</td><td>${mxUtils.htmlEntities(metric ? metric.status : "Missing data")}</td></tr>`;
                }).join("");
                const channelRows = dashboard.channelMetrics.map(metric => `<tr><td>${mxUtils.htmlEntities(metric.channel.label || metric.channel.id)}</td><td>${metric.targetKg.toFixed(1)}</td><td>${metric.usableSupplyKg.toFixed(1)}</td><td>${metric.shortKg.toFixed(1)}</td><td>${metric.lineCount}</td><td>${formatMoney(metric.potentialRevenue)}</td><td>${formatMoney(metric.fulfilledRevenue)}</td><td>${mxUtils.htmlEntities(metric.status)}</td></tr>`).join("");
                const priorityRows = dashboard.priorityMetrics.map(metric => `<tr><td>${mxUtils.htmlEntities(metric.priority)}</td><td>${metric.targetKg.toFixed(1)}</td><td>${metric.usableSupplyKg.toFixed(1)}</td><td>${metric.shortKg.toFixed(1)}</td><td>${formatMoney(metric.potentialRevenue)}</td><td>${formatMoney(metric.fulfilledRevenue)}</td></tr>`).join("");
                const shortageRows = dashboard.shortageWeeks.map(row => `<tr><td>${mxUtils.htmlEntities(row.week)}</td><td>${row.csaDemandKg.toFixed(1)}</td><td>${row.csaShortKg.toFixed(1)}</td><td>${row.channelDemandKg.toFixed(1)}</td><td>${row.channelShortKg.toFixed(1)}</td></tr>`).join("");
                totalsBox.innerHTML =
                    `
                    <div style="font-weight:700;margin-bottom:6px;">Plan Check totals</div>
                    <table style="width:100%;border-collapse:collapse;"><thead><tr><th>Crop</th><th>Target</th><th>Harvested</th><th>Usable</th><th>Short</th><th>Expired</th><th>Potential</th><th>Fulfilled</th><th>Status</th></tr></thead><tbody>${rows || '<tr><td colspan="9">No crops.</td></tr>'}</tbody></table>
                    <div style="font-weight:700;margin:10px 0 6px;">Channels</div>
                    <table style="width:100%;border-collapse:collapse;"><thead><tr><th>Channel</th><th>Demand</th><th>Usable</th><th>Short</th><th>Lines</th><th>Potential</th><th>Fulfilled</th><th>Status</th></tr></thead><tbody>${channelRows || '<tr><td colspan="8">No channels.</td></tr>'}</tbody></table>
                    <div style="font-weight:700;margin:10px 0 6px;">Priorities</div>
                    <table style="width:100%;border-collapse:collapse;"><thead><tr><th>Priority</th><th>Demand</th><th>Usable</th><th>Short</th><th>Potential</th><th>Fulfilled</th></tr></thead><tbody>${priorityRows}</tbody></table>
                    <div style="font-weight:700;margin:10px 0 6px;">Shortage weeks</div>
                    <table style="width:100%;border-collapse:collapse;"><thead><tr><th>Week</th><th>CSA demand</th><th>CSA short</th><th>Channel demand</th><th>Channel short</th></tr></thead><tbody>${shortageRows || '<tr><td colspan="5">No shortage weeks.</td></tr>'}</tbody></table>
                    <div style="margin-top:9px;"><strong>Revenue:</strong> Total potential ${formatMoney(dashboard.totalPotentialRevenue)} | Total fulfilled ${formatMoney(dashboard.totalFulfilledRevenue)}. Sales ${formatMoney(dashboard.fulfilledRevenue)} | CSA ${formatMoney(dashboard.csaMetric && dashboard.csaMetric.fulfilledRevenue)}.</div>`;
                for (const cell of totalsBox.querySelectorAll("th,td")) cell.style.cssText = "border:1px solid #ddd;padding:4px;text-align:left;";
                const cropRows = totalsBox.querySelectorAll("table:first-of-type tbody tr");
                visibleCrops.forEach((crop, index) => {
                    const metric = dashboard.cropMetricsById.get(String(crop.id));
                    const statusCell = cropRows[index] && cropRows[index].cells && cropRows[index].cells[8];
                    if (!statusCell || !metric || !cropHasDiagnostics(crop.id)) return;
                    const diagnostics = createDiagnosticsControl(`${cropLabel(crop)} diagnostics`, cropValidationResults(crop.id));
                    if (diagnostics) statusCell.appendChild(document.createTextNode(" "));
                    if (diagnostics) statusCell.appendChild(diagnostics);
                });
                diagnosticsBox.innerHTML = dashboard.diagnostics.length
                    ? `<div style="font-weight:700;margin-bottom:5px;">Plan Check</div><ul style="margin:0 0 0 18px;padding:0;">${dashboard.diagnostics.map(message => `<li>${mxUtils.htmlEntities(message)}</li>`).join("")}</ul>`
                    : `<div style="color:${YP_COLORS.success};font-weight:700;">Plan Check passed.</div>`;
            }

            function renderFooter() {
                const dirty = YearPlanDashboard.isDirty(state, plan);
                reset.textContent = loadedExistingForCurrentYear ? "Reset" : "Clear";
                if (state.validationState === "invalid") footerStatus.textContent = "Validation failed";
                else if (dirty) footerStatus.textContent = "Unsaved changes";
                else if (state.lastSavedAt) footerStatus.textContent = `Last saved ${state.lastSavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
                else footerStatus.textContent = loadedExistingForCurrentYear ? "Loaded saved plan" : "New plan";
                headerStatus.textContent = footerStatus.textContent;
                closePrompt.style.display = state.closePromptOpen ? "flex" : "none";
                footerActions.style.display = state.closePromptOpen ? "none" : "flex";
                headerActions.style.display = state.closePromptOpen ? "none" : "flex";
                if (dashboard) renderSummary();
            }

            function captureDateRangeSnapshot() {
                const csa = plan && plan.csa ? plan.csa : {};
                return {
                    csa: JSON.stringify({
                        start: String(csa.start || ""),
                        end: String(csa.end || ""),
                        components: (Array.isArray(csa.components) ? csa.components : []).map(component => ({
                            cropId: String(component && component.cropId || ""),
                            start: String(component && component.start || ""),
                            end: String(component && component.end || "")
                        }))
                    }),
                    demand: JSON.stringify(((plan && plan.demands) || []).map(line => ({
                        id: String(line && line.id || ""),
                        from: String(line && line.from || ""),
                        to: String(line && line.to || "")
                    })))
                };
            }

            function refreshDerived(beforeDateRanges, renderOptions) {
                const options = renderOptions || {};
                if (((plan && plan.crops) || []).length && state.saveValidationErrors.length) state.saveValidationErrors = []; // CHANGE: clear save-only empty-plan errors as soon as the plan has a crop.
                const beforeRecalculation = captureDateRangeSnapshot();
                runtime = PlanRuntimeService.recalculate(moduleCell, currentYear, plan);
                const dirty = state.baselineSnapshot ? YearPlanDashboard.isDirty(state, plan) : false;
                dashboard = YearPlanDashboard.compute(plan, runtime, { dirty, extraDiagnostics: state.extraDiagnostics, extraValidationErrors: state.saveValidationErrors }); // CHANGE: include save-only validation after failed saves.
                const demandErrors = PlanSchema.validateDemand(plan);
                const hadDemandErrors = state.hadDemandErrors;
                const expansionChanges = YearPlanDashboard.syncExpansionState(state, dashboard, PlanSchema.validateCsa(plan), demandErrors);
                if (demandErrors.length && !hadDemandErrors) {
                    for (const error of demandErrors) {
                        const target = error && error.target || {};
                        const line = target.lineId
                            ? (plan.demands || []).find(item => String(item && item.id || "") === String(target.lineId))
                            : (target.lineIndex !== undefined ? (plan.demands || [])[Math.max(0, Math.trunc(Number(target.lineIndex) || 0))] : null);
                        if (line) {
                            state.collapsedDemandLineIds.delete(String(line.id || ""));
                            state.collapsedDemandChannelIds.delete(String(line.channelId || ""));
                        } else if (target.channelId) {
                            state.collapsedDemandChannelIds.delete(String(target.channelId));
                        } else {
                            for (const item of (plan.demands || [])) state.collapsedDemandChannelIds.delete(String(item && item.channelId || ""));
                        }
                    }
                }
                state.selectedCropId = YearPlanDashboard.resolveSelectedCropId(plan.crops, state.selectedCropId, 0);
                const afterRecalculation = captureDateRangeSnapshot();
                const comparisonSnapshot = beforeDateRanges || beforeRecalculation;
                const csaDatesChanged = comparisonSnapshot.csa !== afterRecalculation.csa
                    || beforeRecalculation.csa !== afterRecalculation.csa;
                const demandDatesChanged = comparisonSnapshot.demand !== afterRecalculation.demand
                    || beforeRecalculation.demand !== afterRecalculation.demand;
                renderSummary();
                renderCropList();
                renderCsa(!!options.rebuildCsa || expansionChanges.csaChanged || (state.csaExpanded && csaDatesChanged));
                renderDemandStrip(!!options.rebuildDemand || expansionChanges.demandChanged || (state.demandExpanded && demandDatesChanged));
                renderCropPlan(false);
                renderPlanCheck();
                renderFooter();
                syncEditorDerived();
                syncDemandDerived();
                syncCsaDerived();
                return runtime;
            }

            async function getVarietyRows(plantId) {
                const key = String(plantId || "");
                let rows = varietyCache.get(key);
                if (!rows) {
                    rows = await DbClient.queryVarietiesByPlantId(key);
                    varietyCache.set(key, rows);
                }
                return rows;
            }

            async function loadVarieties(crop, select) {
                const key = String(crop.plantId || "");
                select.disabled = true;
                try {
                    const rows = await getVarietyRows(key);
                    if (!SessionController.isActive(session) || selectedCrop() !== crop || editorRefs.variety !== select) return;
                    select.innerHTML = "";
                    select.appendChild(new Option("(base plant)", ""));
                    for (const row of rows) select.appendChild(new Option(String(row.variety_name || row.variety_id), String(row.variety_id)));
                    const desired = crop.varietyId == null ? "" : String(crop.varietyId);
                    if (desired && !rows.some(row => String(row.variety_id) === desired)) select.appendChild(new Option(`${crop.variety || desired} (unavailable)`, desired));
                    select.value = desired;
                } catch (error) {
                    if (SessionController.isActive(session)) {
                        select.innerHTML = "";
                        select.appendChild(new Option(crop.variety || "(varieties unavailable)", crop.varietyId == null ? "" : String(crop.varietyId)));
                    }
                } finally {
                    if (SessionController.isActive(session) && editorRefs.variety === select) select.disabled = false;
                }
            }

            async function loadMethods(crop, select, diagnostic) {
                const key = String(crop.plantId || "");
                select.disabled = true;
                try {
                    let rows = methodCache.get(key);
                    if (!rows) {
                        rows = await DbClient.queryPlantingMethodsForPlantId(key);
                        methodCache.set(key, rows);
                    }
                    if (!SessionController.isActive(session) || selectedCrop() !== crop || editorRefs.method !== select) return;
                    select.innerHTML = "";
                    const current = String(crop.method || "").trim();
                    const options = YearPlanDashboard.buildMethodOptions(rows, current);
                    for (const option of options) {
                        const element = new Option(option.label, option.value);
                        element.dataset.methodCategoryId = option.methodCategoryId || "";
                        select.appendChild(element);
                    }
                    diagnostic.textContent = options.some(option => option.value === current && option.unavailable)
                        ? "The saved planting method is not available in current plant metadata. It will be preserved until changed."
                        : "";
                    const selectedOption = options.find(option => option.value === String(crop.method || "")) || null;
                    if (!current && options.length) {
                        crop.method = String(options[0].value);
                        crop.methodCategoryId = String(options[0].methodCategoryId || "");
                    } else if (selectedOption && !crop.methodCategoryId) {
                        crop.methodCategoryId = String(selectedOption.methodCategoryId || "");
                    }
                    select.value = String(crop.method || "");
                    if (!current && crop.method) refreshDerived();
                } catch (error) {
                    if (SessionController.isActive(session)) {
                        select.innerHTML = "";
                        select.appendChild(new Option(String(crop.method || "(unavailable)"), String(crop.method || "")));
                        diagnostic.textContent = "Planting method metadata could not be loaded. The current value is preserved.";
                    }
                } finally {
                    if (SessionController.isActive(session) && editorRefs.method === select) select.disabled = false;
                }
            }

            function renderBasics(crop, content) {
                const grid = document.createElement("div");
                grid.className = "yp-field-grid";
                const plant = mkInput("text", crop.plant || "", 0);
                plant.disabled = true;
                setYearPlanField(plant, "plantId", { cropId: crop.id });
                const varietyRow = document.createElement("div");
                varietyRow.className = "yp-row";
                const variety = document.createElement("select");
                variety.style.cssText = "padding:5px 6px;border:1px solid #bbb;border-radius:6px;flex:1 1 180px;";
                setYearPlanField(variety, "varietyId", { cropId: crop.id });
                const addVariety = mkBtn("+", "add");
                varietyRow.appendChild(variety);
                varietyRow.appendChild(addVariety);
                const kg = mkInput("number", crop.kgPerPlant ?? "");
                setYearPlanField(kg, "kgPerPlant", { cropId: crop.id });
                kg.min = "0";
                const kgHost = document.createElement("div");
                const yieldMeta = document.createElement("div");
                yieldMeta.className = "yp-yield-hint";
                const yieldHint = document.createElement("span");
                const resetYield = mkBtn("Reset", "danger");
                yieldMeta.appendChild(yieldHint); yieldMeta.appendChild(resetYield);
                kgHost.appendChild(kg); kgHost.appendChild(yieldMeta);
                const germ = mkInput("number", crop.germRate ?? 1);
                setYearPlanField(germ, "germRate", { cropId: crop.id });
                germ.min = "0.01"; germ.max = "1"; germ.step = "0.01";
                const harvestStart = mkInput("date", crop.harvestStart || "");
                const harvestEnd = mkInput("date", crop.harvestEnd || "");
                setYearPlanField(harvestStart, "harvestStart", { cropId: crop.id });
                setYearPlanField(harvestEnd, "harvestEnd", { cropId: crop.id });
                const shelf = mkInput("number", crop.shelfLifeDays ?? 0);
                setYearPlanField(shelf, "shelfLifeDays", { cropId: crop.id });
                shelf.min = "0";
                const method = document.createElement("select");
                method.style.cssText = "padding:5px 6px;border:1px solid #bbb;border-radius:6px;width:100%;";
                setYearPlanField(method, "method", { cropId: crop.id });
                const methodDiagnostic = document.createElement("div");
                methodDiagnostic.style.cssText = `color:${YP_COLORS.danger};font-size:11px;margin-top:4px;`;
                const methodHost = document.createElement("div");
                methodHost.appendChild(method); methodHost.appendChild(methodDiagnostic);
                const harvestSource = mkSelect(harvestWindowSourceOptions(), crop.harvestWindowSource || "manual");
                harvestSource.style.width = "100%";
                harvestSource.title = "Choose whether harvest dates are edited manually, read from diagram harvest records, or derived from feasible sowing dates.";
                setYearPlanField(harvestSource, "harvestWindowSource", { cropId: crop.id }); // CHANGE: one source selector replaces two mutually exclusive toggles.
                const syncAvailability = document.createElement("input");
                syncAvailability.type = "checkbox"; syncAvailability.checked = !!crop.syncharvest;
                setYearPlanField(syncAvailability, "syncharvest", { cropId: crop.id });
                const estimateMessage = document.createElement("div");
                estimateMessage.className = "yp-harvest-source-note";
                estimateMessage.style.cssText = "grid-column:1/-1;color:#666;font-size:11px;";
                const syncLabel = document.createElement("label");
                syncLabel.className = "yp-row"; syncLabel.appendChild(syncAvailability); syncLabel.appendChild(document.createTextNode("Sync demand to harvest window"));
                syncLabel.title = "When the crop harvest window changes, update matching demand and CSA dates to stay inside that window.";
                syncAvailability.title = syncLabel.title;
                const actualAvailable = hasActualHarvestForCrop(crop);
                const estimateAvailable = hasSowingWindowEstimateForCrop(crop);
                syncHarvestWindowSourceControl(harvestSource, crop, actualAvailable, estimateAvailable); // CHANGE: disable only unavailable source choices.
                harvestStart.disabled = harvestEnd.disabled = crop.harvestWindowSource !== "manual";
                estimateMessage.textContent = estimateAvailable
                    ? `Sowing window ${crop.estimatedHarvestStart} to ${crop.estimatedHarvestEnd}`
                    : (crop.estimatedHarvestUnavailableReason ? `Sowing window unavailable: ${crop.estimatedHarvestUnavailableReason}` : "Sowing window unavailable");
                addField(grid, "Plant", plant);
                addField(grid, "Variety", varietyRow);
                addField(grid, "Planting method", methodHost);
                addField(grid, "kg/plant", kgHost);
                addField(grid, "Germination rate", germ, "Value from 0.01 through 1.00");
                addField(grid, "Harvest start", harvestStart);
                addField(grid, "Shelf life (days)", shelf); // CHANGE: shelf life now appears before harvest end.
                addField(grid, "Harvest end", harvestEnd); // CHANGE: harvest end is swapped after shelf life.
                addField(grid, "Harvest dates", harvestSource); // CHANGE: source selector follows the harvest date block.
                grid.appendChild(estimateMessage);
                grid.appendChild(syncLabel);
                content.appendChild(grid);
                const totals = document.createElement("div");
                totals.className = "yp-derived-totals";
                const actualTile = createDerivedTile("Actual plants", "Read from diagram planting groups");
                const requiredTile = createDerivedTile("Plants required", "Calculated from target and yield");
                const seedsTile = createDerivedTile("Seeds required", "Calculated from plants required and germination");
                totals.appendChild(actualTile.tile); totals.appendChild(requiredTile.tile); totals.appendChild(seedsTile.tile);
                content.appendChild(totals);
                const timelineSection = document.createElement("div");
                timelineSection.className = "yp-harvest-timeline-section";
                const timelineHead = document.createElement("div");
                timelineHead.className = "yp-harvest-timeline-head";
                const timelineTitle = document.createElement("div");
                timelineTitle.className = "yp-harvest-timeline-title";
                timelineTitle.textContent = "Harvest vs demand by week"; // CHANGE: timeline now compares demand, harvest, and inventory.
                const timelineLegend = document.createElement("div");
                timelineLegend.className = "yp-crop-timeline-legend";
                const addTimelineLegendItem = (label, className) => {
                    const item = document.createElement("span");
                    item.className = "yp-crop-timeline-legend-item";
                    const swatch = document.createElement("span");
                    swatch.className = `yp-crop-timeline-legend-swatch ${className}`;
                    swatch.setAttribute("aria-hidden", "true");
                    item.appendChild(swatch);
                    item.appendChild(document.createTextNode(label));
                    timelineLegend.appendChild(item);
                };
                addTimelineLegendItem("Demand", "yp-crop-timeline-legend-swatch-demand");
                addTimelineLegendItem("Raw harvest", "yp-crop-timeline-legend-swatch-harvest");
                addTimelineLegendItem("Inventory", "yp-crop-timeline-legend-swatch-inventory"); // CHANGE: compact read-only legend for timeline encodings.
                const timeline = document.createElement("div");
                timelineHead.appendChild(timelineTitle); timelineHead.appendChild(timelineLegend);
                timelineSection.appendChild(timelineHead); timelineSection.appendChild(timeline);
                content.appendChild(timelineSection);
                editorRefs = { ...editorRefs, variety, actual: actualTile.valueEl, required: requiredTile.valueEl, seeds: seedsTile.valueEl, harvestStart, harvestEnd, method, harvestSource, estimateMessage, yieldHint, resetYield, harvestTimeline: timeline }; // CHANGE: editor refs track the single harvest-source selector.
                loadVarieties(crop, variety);
                loadMethods(crop, method, methodDiagnostic);
                updateYieldHint(crop, yieldHint, resetYield);

                variety.addEventListener("change", () => {
                    const next = String(variety.value || "");
                    const duplicate = PlanSchema.findDuplicateCrop(plan, crop.plantId, next, crop.id);
                    if (duplicate) {
                        variety.value = crop.varietyId == null ? "" : String(crop.varietyId);
                        state.extraDiagnostics = ["That plant/variety already exists in this year plan."];
                        state.planCheckExpanded = true;
                        refreshDerived();
                        return;
                    }
                    state.extraDiagnostics = [];
                    const rows = varietyCache.get(String(crop.plantId || "")) || [];
                    const row = rows.find(item => String(item.variety_id) === next);
                    crop.varietyId = next ? Number(next) : null;
                    crop.variety = row ? String(row.variety_name || "") : "";
                    const overrides = row ? Env.safeJsonStringParse(row.overrides_json, null) : null;
                    const overrideYield = Number(overrides && (overrides.yield_per_plant_kg ?? overrides.overrides?.yield_per_plant_kg));
                    crop.kgPerPlantMode = "auto";
                    const autoYield = Number.isFinite(overrideYield) && overrideYield > 0 ? overrideYield : Number(crop.baseKgPerPlant);
                    if (Number.isFinite(autoYield) && autoYield > 0) crop.kgPerPlant = autoYield;
                    renderSelectedEditor();
                    refreshDerived();
                    loadAddCropOptions(false);
                });
                addVariety.addEventListener("click", () => {
                    graph.fireEvent(new mxEventObject("usl:openVarietyEditor", "cropId", String(crop.id), "plantId", Number(crop.plantId), "varietyId", crop.varietyId == null ? null : Number(crop.varietyId)));
                });
                kg.addEventListener("input", () => { crop.kgPerPlant = Number(kg.value); crop.kgPerPlantMode = "manual"; updateYieldHint(crop, yieldHint, resetYield); debounceRefresh(); });
                germ.addEventListener("input", () => { crop.germRate = Math.max(0.01, Math.min(1, Number(germ.value) || 1)); debounceRefresh(); });
                method.addEventListener("change", () => {
                    const selectedOption = method.options[method.selectedIndex] || null;
                    crop.method = method.value;
                    crop.methodCategoryId = String(selectedOption && selectedOption.dataset.methodCategoryId || PlanSchema.inferMethodCategoryFromMethodId(method.value));
                    refreshDerived();
                    emitHarvestWindowsNeeded(crop);
                });
                resetYield.addEventListener("click", () => {
                    const defaultYield = resolveDefaultKgPerPlant(crop);
                    crop.kgPerPlantMode = "auto";
                    if (Number.isFinite(defaultYield) && defaultYield > 0) crop.kgPerPlant = defaultYield;
                    renderSelectedEditor();
                    refreshDerived();
                });
                harvestSource.addEventListener("change", () => {
                    PlanSchema.setCropHarvestWindowSource(crop, harvestSource.value); // CHANGE: source selection is stored in the existing enum field.
                    if (crop.harvestWindowSource === "sowing_window_estimate") {
                        crop.harvestStart = crop.estimatedHarvestStart || crop.harvestStart;
                        crop.harvestEnd = crop.estimatedHarvestEnd || crop.harvestEnd;
                    }
                    refreshDerived();
                });
                syncAvailability.addEventListener("change", () => {
                    const beforeDateRanges = captureDateRangeSnapshot();
                    crop.syncharvest = syncAvailability.checked;
                    if (crop.syncharvest) {
                        const before = { hs: crop.harvestStart, he: crop.harvestEnd, availEnd: crop.harvestEnd };
                        PlanRuntimeService.syncCropDatesIfEnabled(plan, crop, before);
                    }
                    refreshDerived(beforeDateRanges);
                });
                bindPairedDateControls(harvestStart, harvestEnd, {
                    diagnostic: `Harvest start date cannot be after end date for "${crop.plant || crop.id}".`,
                    setStart: value => { crop.harvestStart = value; },
                    setEnd: value => { crop.harvestEnd = value; },
                    afterCommit: (beforeDateRanges, previousPair) => {
                        PlanRuntimeService.syncCropDatesIfEnabled(plan, crop, {
                            hs: previousPair.start,
                            he: previousPair.end,
                            availEnd: previousPair.end
                        });
                        refreshDerived(beforeDateRanges);
                    }
                });
                shelf.addEventListener("input", () => {
                    crop.shelfLifeDays = Math.max(0, Math.trunc(Number(shelf.value) || 0));
                    debounceRefresh();
                });
            }

            function buildChannelSummaryChips(metric) {
                if (!metric) return [createChip("No demand", "", "neutral")];
                return [
                    createChip("Demand", formatKg(metric.targetKg), "neutral"),
                    createChip("Usable", formatKg(metric.usableSupplyKg), metric.usableSupplyKg > EPS ? "success" : "neutral"),
                    createChip(metric.shortKg > EPS ? "Short" : "Status", metric.shortKg > EPS ? formatKg(metric.shortKg) : "OK", metric.shortKg > EPS ? "danger" : "success"),
                    createChip("Lines", String(metric.lineCount), "neutral"),
                    createChip("Committed", formatKg(metric.priorityKg.committed), "neutral"),
                    createChip("Target", formatKg(metric.priorityKg.target), "neutral"),
                    createChip("Optional", formatKg(metric.priorityKg.optional), "neutral"),
                    createChip("Potential", formatMoney(metric.potentialRevenue), "neutral"),
                    createChip("Fulfilled", formatMoney(metric.fulfilledRevenue), metric.fulfilledRevenue > EPS ? "success" : "neutral")
                ];
            }

            function formatCompactNumber(value) {
                const number = Number(value);
                if (!Number.isFinite(number)) return "0";
                return Number.isInteger(number) ? String(number) : String(Number(number.toFixed(2)));
            }

            function demandFrequencyLabel(frequency, everyN) {
                const unit = String(frequency || "week");
                const every = Math.max(1, Math.trunc(Number(everyN) || 1));
                if (every === 1) return unit;
                return `every ${every} ${unit}${unit.endsWith("s") ? "" : "s"}`;
            }

            function demandLineSummaryChips(line, crop) {
                const result = runtime && runtime.weekly && runtime.weekly.perDemandLine && runtime.weekly.perDemandLine.get(String(line && line.id || ""));
                const demandKg = result ? sumPositiveValues(result.target) : 0;
                const shortKg = result ? sumPositiveValues(result.short) : 0;
                const potentialRevenue = result ? sumPositiveValues(result.potentialRevenue) : 0;
                const fulfilledRevenue = result ? sumPositiveValues(result.fulfilledRevenue) : 0;
                const from = YearPlanDashboard.formatYmd(line && line.from) || "?";
                const to = YearPlanDashboard.formatYmd(line && line.to) || "?";
                const priorityValue = String(line && line.priority || "target");
                const priorityLabel = priorityValue.charAt(0).toUpperCase() + priorityValue.slice(1);
                return [
                    createChip("Crop", crop ? cropLabel(crop) : String(line && line.cropId || "Crop"), crop ? "primary" : "warning"),
                    createChip("Qty", `${formatCompactNumber(line && line.qty)} ${line && line.unit || "kg"} / ${demandFrequencyLabel(line && line.frequency, line && line.everyN)}`, "neutral"),
                    createChip("Dates", `${from}-${to}`, from === "?" || to === "?" ? "warning" : "neutral"),
                    createChip("Priority", priorityLabel, "neutral"),
                    createChip("Demand", formatKg(demandKg), "neutral"),
                    createChip(shortKg > EPS ? "Short" : "Status", shortKg > EPS ? formatKg(shortKg) : (result ? "OK" : "Not calculated"), shortKg > EPS ? "danger" : (result ? "success" : "warning")),
                    createChip("Potential", formatMoney(potentialRevenue), "neutral"),
                    createChip("Fulfilled", formatMoney(fulfilledRevenue), fulfilledRevenue > EPS ? "success" : "neutral")
                ];
            }

            function createDemandLine(channelId) {
                const crop = (plan.crops || [])[0] || null;
                return {
                    id: Env.uid("demand"),
                    channelId: String(channelId || ""),
                    cropId: crop ? crop.id : "",
                    qty: 1,
                    unit: defaultUnit(crop),
                    frequency: "week",
                    everyN: 1,
                    from: crop && crop.harvestStart || "",
                    to: crop && crop.harvestEnd || "",
                    priority: "target",
                    notes: ""
                };
            }

            function addDemandLine(channelId) {
                if (!(plan.crops || []).length || !(plan.demandChannels || []).some(channel => String(channel.id) === String(channelId))) return;
                const line = createDemandLine(channelId);
                plan.demands.push(line);
                state.collapsedDemandChannelIds.delete(String(channelId));
                state.collapsedDemandLineIds.delete(String(line.id || ""));
                saveCollapsePreferences();
                refreshDerived(null, { rebuildDemand: true });
            }

            function renderDemandLine(line, host) {
                const crop = PlanMath.findCrop(plan, line.cropId);
                const lineId = String(line.id || "");
                const shell = document.createElement("section");
                shell.className = "yp-demand-line-shell";
                shell.dataset.demandLineId = lineId;
                const collapsed = state.collapsedDemandLineIds.has(lineId);
                const header = document.createElement("div");
                header.className = "yp-demand-line-header";
                const toggle = mkBtn(collapsed ? "Expand" : "Collapse", "neutral");
                toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
                const summary = document.createElement("div");
                summary.className = "yp-demand-line-summary";
                setChipRow(summary, demandLineSummaryChips(line, crop));
                demandRefs.lineSummaries.set(lineId, summary);
                header.appendChild(toggle); header.appendChild(summary);
                const row = document.createElement("div");
                row.className = "yp-demand-line yp-demand-line-details";
                row.style.display = collapsed ? "none" : "grid";
                const cropSelect = mkSelect((plan.crops || []).map(item => ({ value: item.id, label: cropLabel(PlanMath.findCrop(plan, item.id)) })), line.cropId || "");
                const qty = mkInput("number", line.qty ?? 1);
                qty.min = "0"; qty.step = "any";
                const unit = mkSelect(listUnitOptions(crop), line.unit || defaultUnit(crop));
                const frequency = mkSelect([{ value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }], line.frequency || "week");
                const every = mkInput("number", line.everyN ?? 1);
                every.min = "1"; every.step = "1";
                const from = mkInput("date", line.from || "");
                const to = mkInput("date", line.to || "");
                const priority = mkSelect([{ value: "committed", label: "Committed" }, { value: "target", label: "Target" }, { value: "optional", label: "Optional" }], line.priority || "target");
                const unitPrice = PlanMath.resolvePackagePriceForUnit(crop, line.unit);
                const price = mkInput("number", Number.isFinite(unitPrice) ? unitPrice : "");
                price.min = "0"; price.step = "any"; price.readOnly = true;
                price.title = "Synced from the matching crop package.";
                const notes = document.createElement("textarea");
                notes.value = String(line.notes || "");
                notes.rows = 2;
                notes.style.cssText = "padding:5px 6px;border:1px solid #bbb;border-radius:6px;box-sizing:border-box;width:100%;resize:vertical;";
                const remove = mkBtn("Remove", "danger");
                setYearPlanField(cropSelect, "cropId", { lineId });
                setYearPlanField(qty, "qty", { lineId });
                setYearPlanField(unit, "unit", { lineId });
                setYearPlanField(frequency, "frequency", { lineId });
                setYearPlanField(every, "everyN", { lineId });
                setYearPlanField(from, "from", { lineId });
                setYearPlanField(to, "to", { lineId });
                setYearPlanField(priority, "priority", { lineId });
                setYearPlanField(price, "price", { lineId });
                setYearPlanField(notes, "notes", { lineId });
                addField(row, "Crop", cropSelect);
                addField(row, "Qty", qty);
                addField(row, "Unit", unit);
                addField(row, "Frequency", frequency);
                addField(row, "Every", every);
                addField(row, "From", from);
                addField(row, "To", to);
                addField(row, "Priority", priority);
                addField(row, "Price", price, "From matching crop package");
                addField(row, "Notes", notes);
                addField(row, "Remove", remove);
                shell.appendChild(header);
                shell.appendChild(row);
                host.appendChild(shell);
                toggle.addEventListener("click", () => {
                    if (collapsed) state.collapsedDemandLineIds.delete(lineId);
                    else state.collapsedDemandLineIds.add(lineId);
                    saveCollapsePreferences();
                    renderDemandStrip(true);
                    syncDemandDerived();
                });
                cropSelect.addEventListener("change", () => {
                    line.cropId = cropSelect.value;
                    line.unit = defaultUnit(PlanMath.findCrop(plan, line.cropId));
                    refreshDerived(null, { rebuildDemand: true });
                });
                qty.addEventListener("input", () => { line.qty = Math.max(0, Number(qty.value) || 0); debounceRefresh(); });
                unit.addEventListener("change", () => { line.unit = unit.value; refreshDerived(null, { rebuildDemand: true }); });
                frequency.addEventListener("change", () => { line.frequency = frequency.value; refreshDerived(); });
                every.addEventListener("input", () => { line.everyN = Math.max(1, Math.trunc(Number(every.value) || 1)); debounceRefresh(); });
                priority.addEventListener("change", () => { line.priority = priority.value; refreshDerived(); });
                notes.addEventListener("input", () => { line.notes = notes.value; renderFooter(); });
                bindPairedDateControls(from, to, {
                    diagnostic: `Demand line start date cannot be after end date for "${crop ? cropLabel(crop) : line.cropId}".`,
                    setStart: value => { line.from = value; },
                    setEnd: value => { line.to = value; }
                });
                remove.addEventListener("click", () => {
                    plan.demands = plan.demands.filter(item => item !== line);
                    state.collapsedDemandLineIds.delete(lineId);
                    saveCollapsePreferences();
                    refreshDerived(null, { rebuildDemand: true });
                });
            }

            function renderDemandChannel(channel, host) {
                const channelId = String(channel.id || "");
                const metric = dashboard && dashboard.channelMetricsById.get(channelId);
                const box = document.createElement("section");
                box.className = "yp-demand-channel";
                box.dataset.demandChannelId = channelId;
                const header = document.createElement("div");
                header.className = "yp-demand-channel-header";
                const label = mkInput("text", channel.label || "");
                label.setAttribute("aria-label", "Channel name");
                label.style.minWidth = "160px";
                const type = mkSelect([
                    { value: "farm_store", label: "Farm store" },
                    { value: "restaurant", label: "Restaurant" },
                    { value: "market", label: "Market" },
                    { value: "wholesale", label: "Wholesale" },
                    { value: "other", label: "Other" }
                ], channel.type || "other", 120);
                type.setAttribute("aria-label", "Channel type");
                setYearPlanField(label, "label", { channelId });
                setYearPlanField(type, "type", { channelId });
                const summary = document.createElement("div");
                summary.className = "yp-demand-channel-summary";
                setChipRow(summary, buildChannelSummaryChips(metric));
                demandRefs.channelSummaries.set(channelId, summary);
                const lines = (plan.demands || []).filter(line => String(line.channelId) === channelId);
                const removeChannel = mkBtn("Remove channel", "danger");
                removeChannel.disabled = lines.length > 0;
                removeChannel.title = lines.length ? "Remove or move all demand lines before removing this channel." : "";
                const collapsed = state.collapsedDemandChannelIds.has(channelId);
                const toggle = mkBtn(collapsed ? "Expand" : "Collapse", "neutral");
                toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
                header.appendChild(label); header.appendChild(type); header.appendChild(summary); header.appendChild(removeChannel); header.appendChild(toggle);
                const details = document.createElement("div");
                details.className = "yp-demand-channel-details";
                details.style.display = collapsed ? "none" : "block";
                const rows = document.createElement("div");
                rows.style.cssText = "display:flex;flex-direction:column;gap:8px;";
                for (const line of lines) renderDemandLine(line, rows);
                if (!lines.length) {
                    const empty = document.createElement("div");
                    empty.style.cssText = "color:#666;padding:4px 0 8px;";
                    empty.textContent = "No demand lines in this channel.";
                    rows.appendChild(empty);
                }
                const add = mkBtn("Add demand line", "add");
                add.style.marginTop = "8px";
                add.disabled = !(plan.crops || []).length;
                add.addEventListener("click", () => addDemandLine(channelId));
                details.appendChild(rows); details.appendChild(add);
                box.appendChild(header); box.appendChild(details); host.appendChild(box);
                label.addEventListener("input", () => { channel.label = label.value; debounceRefresh(); });
                type.addEventListener("change", () => { channel.type = type.value; refreshDerived(); });
                removeChannel.addEventListener("click", () => {
                    if ((plan.demands || []).some(line => String(line.channelId) === channelId)) return;
                    plan.demandChannels = plan.demandChannels.filter(item => item !== channel);
                    state.collapsedDemandChannelIds.delete(channelId);
                    saveCollapsePreferences();
                    refreshDerived(null, { rebuildDemand: true });
                });
                toggle.addEventListener("click", () => {
                    if (collapsed) state.collapsedDemandChannelIds.delete(channelId);
                    else state.collapsedDemandChannelIds.add(channelId);
                    saveCollapsePreferences();
                    renderDemandStrip(true);
                    syncDemandDerived();
                });
            }

            function renderDemand(content) {
                pruneCollapseState();
                demandRefs = { channelSummaries: new Map(), lineSummaries: new Map() };
                const toolbar = document.createElement("div");
                toolbar.className = "yp-row";
                toolbar.style.marginBottom = "9px";
                const addChannel = mkBtn("Add channel", "add");
                const channelSelect = mkSelect((plan.demandChannels || []).map(channel => ({ value: channel.id, label: channel.label || channel.id })), plan.demandChannels && plan.demandChannels[0] ? plan.demandChannels[0].id : "", 180);
                channelSelect.setAttribute("aria-label", "Demand line channel");
                const addLine = mkBtn("Add demand line", "add");
                addLine.disabled = !(plan.crops || []).length || !(plan.demandChannels || []).length;
                toolbar.appendChild(addChannel); toolbar.appendChild(channelSelect); toolbar.appendChild(addLine);
                const channelsHost = document.createElement("div");
                channelsHost.style.cssText = "display:flex;flex-direction:column;gap:9px;";
                content.appendChild(toolbar); content.appendChild(channelsHost);
                for (const channel of (plan.demandChannels || [])) renderDemandChannel(channel, channelsHost);
                if (!(plan.demandChannels || []).length) {
                    const empty = document.createElement("div");
                    empty.style.cssText = "padding:12px;color:#666;text-align:center;";
                    empty.textContent = "Add a demand channel to begin planning sales.";
                    channelsHost.appendChild(empty);
                }
                addChannel.addEventListener("click", () => {
                    const channel = { id: Env.uid("demand_channel"), label: "New Channel", type: "other" };
                    plan.demandChannels.push(channel);
                    state.collapsedDemandChannelIds.delete(channel.id);
                    saveCollapsePreferences();
                    refreshDerived(null, { rebuildDemand: true });
                });
                addLine.addEventListener("click", () => addDemandLine(channelSelect.value));
            }

            function renderDemandStrip(rebuildDetails) {
                const channelCount = (plan.demandChannels || []).length;
                const lineCount = (plan.demands || []).length;
                const demandKg = (dashboard && dashboard.channelMetrics || []).reduce((sum, metric) => sum + metric.targetKg, 0);
                const shortKg = (dashboard && dashboard.channelMetrics || []).reduce((sum, metric) => sum + metric.shortKg, 0);
                renderStripBox(demandBox, {
                    title: "Demand",
                    expanded: state.demandExpanded,
                    summaryChips: [
                        createChip("Channels", String(channelCount), "neutral"),
                        createChip("Lines", String(lineCount), "neutral"),
                        createChip("Demand", formatKg(demandKg), "primary"),
                        createChip("Short", formatKg(shortKg), shortKg > EPS ? "danger" : "success"),
                        createChip("Potential", formatMoney(dashboard && dashboard.potentialRevenue), "neutral"),
                        createChip("Fulfilled", formatMoney(dashboard && dashboard.fulfilledRevenue), (dashboard && dashboard.fulfilledRevenue) > EPS ? "success" : "neutral")
                    ],
                    rebuildDetails: !!rebuildDetails,
                    onToggle: () => {
                        state.demandExpanded = !state.demandExpanded;
                        saveCollapsePreferences();
                        renderDemandStrip(state.demandExpanded);
                        syncDemandDerived();
                    },
                    renderDetails: details => renderDemand(details)
                });
            }

            function renderCropPlan(rebuildDetails) {
                const crop = selectedCrop();
                const cropCount = Array.isArray(plan.crops) ? plan.crops.length : 0;
                renderStripBox(cropPlanBox, {
                    title: "Crop Plan",
                    expanded: state.cropPlanExpanded,
                    summaryChips: [
                        createChip("Crops", String(cropCount), "neutral"),
                        createChip("Selected", crop ? cropLabel(crop) : "No crop selected", crop ? "primary" : "neutral")
                    ],
                    rebuildDetails: !!rebuildDetails,
                    onToggle: () => { state.cropPlanExpanded = !state.cropPlanExpanded; saveCollapsePreferences(); renderCropPlan(false); },
                    renderDetails: details => { details.appendChild(addRow); details.appendChild(dashboardGrid); }
                });
            }

            function renderPackages(crop, content) {
                const defaultLabel = document.createElement("label");
                defaultLabel.className = "yp-row";
                const saveDefault = document.createElement("input");
                saveDefault.type = "checkbox"; saveDefault.checked = !!crop.savePackagesAsDefault;
                defaultLabel.appendChild(saveDefault); defaultLabel.appendChild(document.createTextNode("Save as default for plant"));
                content.appendChild(defaultLabel);
                const rowsHost = document.createElement("div");
                rowsHost.style.cssText = "display:flex;flex-direction:column;gap:7px;margin-top:10px;";
                content.appendChild(rowsHost);
                const add = mkBtn("Add package", "add");
                add.style.marginTop = "8px";
                content.appendChild(add);
                saveDefault.addEventListener("change", () => { crop.savePackagesAsDefault = saveDefault.checked; renderFooter(); });

                function renderRows() {
                    rowsHost.innerHTML = "";
                    crop.packages = Array.isArray(crop.packages) ? crop.packages : [];
                    for (const [packageIndex, pkg] of crop.packages.entries()) {
                        const row = document.createElement("div");
                        row.className = "yp-package-row";
                        row.dataset.packageIndex = String(packageIndex);
                        row.dataset.cropId = String(crop.id || "");
                        const unit = mkInput("text", pkg.unit || "");
                        const baseQty = mkInput("number", pkg.baseQty ?? 1);
                        const baseType = mkSelect([{ value: "kg", label: "kg" }, { value: "plant", label: "plant" }], pkg.baseType || "kg");
                        const price = mkInput("number", Number.isFinite(Number(pkg.price)) ? pkg.price : "");
                        setYearPlanField(unit, "unit", { cropId: crop.id, packageIndex });
                        setYearPlanField(baseQty, "baseQty", { cropId: crop.id, packageIndex });
                        setYearPlanField(baseType, "baseType", { cropId: crop.id, packageIndex });
                        setYearPlanField(price, "price", { cropId: crop.id, packageIndex });
                        const remove = mkBtn("Remove", "danger");
                        addPackageField(row, "Unit", unit);
                        addPackageField(row, "Quantity", baseQty);
                        addPackageField(row, "Base", baseType);
                        addPackageField(row, "Price", price);
                        row.appendChild(remove);
                        rowsHost.appendChild(row);
                        unit.addEventListener("input", () => { pkg.unit = unit.value; debounceRefresh({ rebuildDemand: true, rebuildCsa: true }); });
                        baseQty.addEventListener("input", () => { pkg.baseQty = Math.max(0, Number(baseQty.value) || 0); debounceRefresh(); });
                        baseType.addEventListener("change", () => { pkg.baseType = baseType.value; refreshDerived(); });
                        price.addEventListener("input", () => { pkg.price = price.value === "" ? NaN : Math.max(0, Number(price.value) || 0); debounceRefresh({ rebuildDemand: true }); });
                        remove.addEventListener("click", () => { crop.packages = crop.packages.filter(item => item !== pkg); renderRows(); refreshDerived(null, { rebuildDemand: true, rebuildCsa: true }); });
                    }
                }

                add.addEventListener("click", () => { crop.packages.push({ unit: "kg", baseType: "kg", baseQty: 1, price: NaN }); renderRows(); refreshDerived(null, { rebuildDemand: true, rebuildCsa: true }); });
                renderRows();
            }

            function renderSelectedEditor() {
                editorBox.innerHTML = "";
                editorRefs = {};
                const crop = selectedCrop();
                if (!crop) {
                    const empty = document.createElement("div");
                    empty.style.cssText = "padding:24px;color:#666;text-align:center;";
                    empty.textContent = "Add or select a crop to edit its plan.";
                    editorBox.appendChild(empty);
                    return;
                }
                const head = document.createElement("div");
                head.style.cssText = "padding:10px 12px;border-bottom:1px solid #ddd;display:flex;justify-content:space-between;gap:10px;align-items:center;";
                const title = document.createElement("div");
                title.style.cssText = "font-size:14px;font-weight:700;";
                title.textContent = cropLabel(crop);
                const remove = mkBtn("Remove crop", "danger");
                head.appendChild(title); head.appendChild(remove);
                const tabs = document.createElement("div");
                tabs.style.cssText = "display:flex;gap:4px;padding:8px 10px 0;flex-wrap:wrap;";
                const content = document.createElement("div");
                content.style.padding = "12px";
                for (const tab of [{ id: "basics", label: "Basics" }, { id: "packages", label: "Packages" }]) {
                    const button = mkBtn(tab.label, "neutral");
                    button.addEventListener("click", () => { state.activeTab = tab.id; renderSelectedEditor(); syncEditorDerived(); });
                    tabs.appendChild(button);
                }
                editorBox.appendChild(head); editorBox.appendChild(tabs); editorBox.appendChild(content);
                if (state.activeTab === "packages") renderPackages(crop, content);
                else renderBasics(crop, content);
                remove.addEventListener("click", () => {
                    const index = plan.crops.indexOf(crop);
                    const removedDemandLineIds = (plan.demands || []).filter(line => line.cropId === crop.id).map(line => String(line && line.id || ""));
                    plan.crops = plan.crops.filter(item => item !== crop);
                    plan.demands = (plan.demands || []).filter(line => line.cropId !== crop.id);
                    for (const lineId of removedDemandLineIds) state.collapsedDemandLineIds.delete(lineId);
                    if (plan.csa && Array.isArray(plan.csa.components)) plan.csa.components = plan.csa.components.filter(component => component.cropId !== crop.id);
                    const nextCropId = YearPlanDashboard.resolveSelectedCropId(plan.crops, "", index);
                    if (nextCropId) setSelectedCropEverywhere(nextCropId);
                    else { state.selectedCropId = ""; plan.cropFilterId = ""; cropFilterSel.value = ""; }
                    saveCollapsePreferences();
                    renderSelectedEditor(); fillCropFilter(); refreshDerived(null, { rebuildCsa: true, rebuildDemand: true }); loadAddCropOptions(false);
                });
                syncEditorDerived();
            }

            function renderCsa(rebuildDetails) {
                plan.csa = plan.csa || { enabled: false, boxesPerWeek: 0, start: "", end: "", components: [] };
                const componentCount = Array.isArray(plan.csa.components) ? plan.csa.components.length : 0;
                const start = YearPlanDashboard.formatYmd(plan.csa.start) || "?";
                const end = YearPlanDashboard.formatYmd(plan.csa.end) || "?";
                const csaErrors = PlanSchema.validateCsa(plan);
                const csaMetric = dashboard && dashboard.csaMetric || {};
                renderStripBox(csaBox, {
                    title: "CSA",
                    expanded: state.csaExpanded,
                    summaryChips: [
                        createChip("Status", plan.csa.enabled ? "On" : "Off", plan.csa.enabled ? "success" : "neutral"),
                        createChip("Boxes/week", String(Math.max(0, Math.trunc(Number(plan.csa.boxesPerWeek) || 0))), "neutral"),
                        csaErrors.length ? createDiagnosticsChip("CSA setup issues", "danger", csaErrors, null) : createChip("Dates", `${start}-${end}`, "neutral"),
                        createChip("Components", String(componentCount), "neutral"),
                        createChip("Component value", formatMoney(csaMetric.componentValuePerBox), "neutral"),
                        createChip("Sale value", formatMoney(csaMetric.salePricePerBox), "neutral"),
                        createChip("Potential", formatMoney(csaMetric.potentialRevenue), "neutral"),
                        createChip("Fulfilled", formatMoney(csaMetric.fulfilledRevenue), Number(csaMetric.fulfilledRevenue) > EPS ? "success" : "neutral")
                    ],
                    rebuildDetails: !!rebuildDetails && state.csaExpanded,
                    onToggle: () => { state.csaExpanded = !state.csaExpanded; saveCollapsePreferences(); renderCsa(state.csaExpanded); },
                    renderDetails: renderCsaDetails
                });
            }

            function renderCsaDetails(details) {
                const controls = document.createElement("div");
                controls.className = "yp-row";
                const pricingControls = document.createElement("div");
                pricingControls.className = "yp-row";
                const enabled = document.createElement("input"); enabled.type = "checkbox"; enabled.checked = !!plan.csa.enabled;
                const enabledLabel = document.createElement("label"); enabledLabel.className = "yp-row"; enabledLabel.appendChild(enabled); enabledLabel.appendChild(document.createTextNode("Enable CSA"));
                const boxes = mkInput("number", plan.csa.boxesPerWeek ?? 0, 90);
                const start = mkInput("date", plan.csa.start || "", 145);
                const end = mkInput("date", plan.csa.end || "", 145);
                const componentValue = mkInput("number", Math.max(0, Number(plan.csa.__componentValuePerBox) || 0).toFixed(2), 110);
                componentValue.readOnly = true;
                componentValue.title = "Derived from CSA component quantities and matching crop package prices.";
                const salePrice = mkInput("number", Math.max(0, Number(plan.csa.salePricePerBox) || 0).toFixed(2), 110);
                salePrice.min = "0"; salePrice.step = "any";
                salePrice.title = "Whole-box CSA sale value. Editing makes it manual.";
                const resetSale = mkBtn("Reset", "danger");
                resetSale.title = "Reset sale value to the derived component value.";
                setYearPlanField(enabled, "enabled");
                setYearPlanField(boxes, "boxesPerWeek");
                setYearPlanField(start, "start");
                setYearPlanField(end, "end");
                setYearPlanField(componentValue, "componentValuePerBox");
                setYearPlanField(salePrice, "salePricePerBox");
                controls.appendChild(enabledLabel); controls.appendChild(document.createTextNode("Boxes/week")); controls.appendChild(boxes); controls.appendChild(document.createTextNode("Start")); controls.appendChild(start); controls.appendChild(document.createTextNode("End")); controls.appendChild(end);
                pricingControls.appendChild(document.createTextNode("Component value / box")); pricingControls.appendChild(componentValue); pricingControls.appendChild(document.createTextNode("Sale value / box")); pricingControls.appendChild(salePrice); pricingControls.appendChild(resetSale);
                const rowsHost = document.createElement("div");
                rowsHost.style.cssText = "display:flex;flex-direction:column;gap:7px;margin-top:10px;";
                const add = mkBtn("Add component", "add");
                add.style.marginTop = "8px";
                details.appendChild(controls); details.appendChild(pricingControls); details.appendChild(rowsHost); details.appendChild(add);
                csaRefs = { componentValue, salePrice, resetSale };
                const refreshSummary = () => { renderCsa(false); };
                const syncNonDateControls = () => { plan.csa.enabled = enabled.checked; plan.csa.boxesPerWeek = Math.max(0, Math.trunc(Number(boxes.value) || 0)); refreshSummary(); debounceRefresh(); };
                enabled.addEventListener("change", syncNonDateControls);
                boxes.addEventListener("input", syncNonDateControls);
                salePrice.addEventListener("input", () => { plan.csa.salePriceMode = "manual"; plan.csa.salePricePerBox = Math.max(0, Number(salePrice.value) || 0); refreshSummary(); debounceRefresh(); });
                resetSale.addEventListener("click", () => { plan.csa.salePriceMode = "auto"; plan.csa.salePricePerBox = Math.max(0, Number(plan.csa.__componentValuePerBox) || 0); salePrice.value = plan.csa.salePricePerBox.toFixed(2); refreshSummary(); refreshDerived(); });
                bindPairedDateControls(start, end, {
                    diagnostic: "CSA start date cannot be after end date.",
                    setStart: value => { plan.csa.start = value; },
                    setEnd: value => { plan.csa.end = value; },
                    afterCommit: beforeDateRanges => { refreshSummary(); refreshDerived(beforeDateRanges); }
                });

                function renderRows() {
                    rowsHost.innerHTML = "";
                    plan.csa.components = Array.isArray(plan.csa.components) ? plan.csa.components : [];
                    for (const [componentIndex, component] of plan.csa.components.entries()) {
                        const row = document.createElement("div");
                        row.className = "yp-row";
                        row.dataset.csaComponentIndex = String(componentIndex);
                        const crop = PlanMath.findCrop(plan, component.cropId);
                        const cropSelect = mkSelect((plan.crops || []).map(item => ({ value: item.id, label: cropLabel(item) })), component.cropId || "", 220);
                        const qty = mkInput("number", component.qty ?? 1, 70);
                        const unit = mkSelect(listUnitOptions(crop), component.unit || defaultUnit(crop), 100);
                        const every = mkInput("number", component.everyNWeeks ?? 1, 65);
                        const from = mkInput("date", component.start || plan.csa.start || "", 145);
                        const to = mkInput("date", component.end || plan.csa.end || "", 145);
                        ensureSelectOption(cropSelect, component.cropId, `${component.cropId || "Missing crop"} (unavailable)`);
                        ensureSelectOption(unit, component.unit, `${component.unit || "Missing unit"} (unavailable)`);
                        cropSelect.value = String(component.cropId || "");
                        unit.value = String(component.unit || defaultUnit(crop));
                        setYearPlanField(cropSelect, "cropId", { componentIndex });
                        setYearPlanField(qty, "qty", { componentIndex });
                        setYearPlanField(unit, "unit", { componentIndex });
                        setYearPlanField(every, "everyNWeeks", { componentIndex });
                        setYearPlanField(from, "start", { componentIndex });
                        setYearPlanField(to, "end", { componentIndex });
                        const remove = mkBtn("Remove", "danger");
                        row.appendChild(cropSelect); row.appendChild(qty); row.appendChild(unit); row.appendChild(document.createTextNode("Every")); row.appendChild(every); row.appendChild(document.createTextNode("weeks")); row.appendChild(from); row.appendChild(to); row.appendChild(remove);
                        rowsHost.appendChild(row);
                        cropSelect.addEventListener("change", () => { component.cropId = cropSelect.value; component.unit = defaultUnit(PlanMath.findCrop(plan, component.cropId)); renderRows(); refreshDerived(); });
                        qty.addEventListener("input", () => { component.qty = Math.max(0, Number(qty.value) || 0); debounceRefresh(); });
                        unit.addEventListener("change", () => { component.unit = unit.value; refreshDerived(); });
                        every.addEventListener("input", () => { component.everyNWeeks = Math.max(1, Math.trunc(Number(every.value) || 1)); debounceRefresh(); });
                        bindPairedDateControls(from, to, {
                            diagnostic: `CSA component start date cannot be after end date for "${crop ? crop.plant || crop.id : component.cropId}".`,
                            setStart: value => { component.start = value; },
                            setEnd: value => { component.end = value; }
                        });
                        remove.addEventListener("click", () => { plan.csa.components = plan.csa.components.filter(item => item !== component); renderRows(); refreshSummary(); refreshDerived(); });
                    }
                }
                add.addEventListener("click", () => {
                    const crop = plan.crops && plan.crops[0];
                    plan.csa.components.push({ cropId: crop ? crop.id : "", qty: 1, unit: defaultUnit(crop), everyNWeeks: 1, start: plan.csa.start || "", end: plan.csa.end || "" });
                    state.csaExpanded = true;
                    renderRows(); refreshSummary(); refreshDerived();
                });
                renderRows();
            }

            function renderAll() {
                fillCropFilter();
                renderSelectedEditor();
                renderCropPlan(true);
                refreshDerived(null, { rebuildCsa: true, rebuildDemand: true });
                emitHarvestWindowsNeeded(plan.crops || []); // CHANGE: loaded crops can receive sowing-window estimates, not only newly added crops.
                loadAddCropOptions(false);
            }

            function persistPackageDefaults() {
                for (const crop of (plan.crops || [])) {
                    if (crop.savePackagesAsDefault && crop.plantId && Array.isArray(crop.packages)) PlanRepository.saveDefaultsForPlant(crop.plantId, crop.packages);
                }
            }

            function validateSaveReadiness() {
                return ((plan && plan.crops) || []).length
                    ? []
                    : [{ scope: "plan", code: "plan.empty_crops", message: EMPTY_PLAN_SAVE_MESSAGE, target: { area: "crop-list" } }]; // CHANGE: Save requires an allocatable crop plan.
            }

            function focusSaveValidationFailure() {
                const firstDiagnostics = card.querySelector(".yp-diagnostics-trigger");
                const planCheckHeader = card.querySelector('[data-year-plan-strip="plan-check"] .yp-strip-header');
                if (firstDiagnostics) focusAndHighlight(firstDiagnostics);
                else if (planCheckHeader) focusAndHighlight(planCheckHeader); // CHANGE: empty-plan save failures have only the Plan Check list.
            }

            function saveCurrent(closeAfter) {
                state.saveValidationErrors = validateSaveReadiness(); // CHANGE: save-only rule runs for Save, Save & Close, and prompt Save.
                refreshDerived();
                if (dashboard.validationErrors.length) {
                    state.validationState = "invalid";
                    state.planCheckExpanded = true;
                    if (state.saveValidationErrors.some(error => error && error.code === "plan.empty_crops")) state.cropPlanExpanded = true; // CHANGE: show where to add the required crop.
                    if (PlanSchema.validateCsa(plan).length) state.csaExpanded = true;
                    renderCsa(true); renderPlanCheck(); renderFooter();
                    focusSaveValidationFailure();
                    return false;
                }
                persistPackageDefaults();
                PlanRepository.savePlanForYear(moduleCell, currentYear, plan);
                loadedExistingForCurrentYear = true;
                YearPlanDashboard.markBaseline(state, plan, new Date());
                state.closePromptOpen = false;
                state.saveValidationErrors = []; // CHANGE: clear save-only diagnostics after a successful save.
                state.extraDiagnostics = [];
                refreshDerived();
                if (closeAfter) SessionController.close();
                return true;
            }

            function requestClose() {
                refreshDerived();
                if (!YearPlanDashboard.isDirty(state, plan)) { SessionController.close(); return; }
                state.closePromptOpen = true;
                renderFooter();
            }

            const yearInput = mkInput("number", currentYear, 88);
            yearInput.min = "1900"; yearInput.max = "3000";
            const templateSel = document.createElement("select");
            templateSel.style.cssText = "padding:5px 6px;border:1px solid #bbb;border-radius:6px;min-width:190px;";
            const templateNameInput = mkInput("text", "", 170);
            templateNameInput.placeholder = "Template name";
            const applyTemplate = mkBtn("Apply template", "neutral");
            const saveTemplate = mkBtn("Save template", "add");
            const deleteTemplate = mkBtn("Delete template", "danger");
            const save = mkBtn("Save", "add");
            const saveClose = mkBtn("Save & Close", "add");
            const close = mkBtn("Close", "close"); // CHANGE
            const exportButton = mkBtn("Export", "neutral");
            const reset = mkBtn(loadedExistingForCurrentYear ? "Reset" : "Clear", "danger");
            const promptSave = mkBtn("Save and Close", "add");
            const promptDiscard = mkBtn("Discard", "danger");
            const promptCancel = mkBtn("Cancel", "neutral");
            titleEl.textContent = `Plan Year ${currentYear}`;
            headerControls.appendChild(headerStatus);
            headerActions.appendChild(save); headerActions.appendChild(saveClose); headerActions.appendChild(close);
            header.appendChild(titleEl); header.appendChild(headerControls); header.appendChild(headerActions);
            secondaryToolbar.appendChild(document.createTextNode("Year")); secondaryToolbar.appendChild(yearInput); secondaryToolbar.appendChild(document.createTextNode("Template")); secondaryToolbar.appendChild(templateSel); secondaryToolbar.appendChild(templateNameInput); secondaryToolbar.appendChild(applyTemplate); secondaryToolbar.appendChild(saveTemplate); secondaryToolbar.appendChild(deleteTemplate);
            fillTemplateDropdown();
            saveTemplate.disabled = true;

            const plantSelect = document.createElement("select");
            plantSelect.style.cssText = "padding:6px;border:1px solid #bbb;border-radius:6px;min-width:260px;flex:1 1 260px;";
            const addCrop = mkBtn("Add crop", "add");
            const reloadPlants = mkBtn("Reload crops", "neutral");
            const plantMessage = document.createElement("span");
            plantMessage.style.color = "#666";
            addRow.appendChild(plantSelect); addRow.appendChild(addCrop); addRow.appendChild(reloadPlants); addRow.appendChild(plantMessage);

            footerActions.appendChild(exportButton); footerActions.appendChild(reset);
            closePrompt.appendChild(promptSave); closePrompt.appendChild(promptDiscard); closePrompt.appendChild(promptCancel);

            function appendAddCropOptionGroup(label, options) {
                if (!options.length) return;
                const group = document.createElement("optgroup");
                group.label = label;
                for (const option of options) {
                    const optionId = Env.uid("addcrop");
                    addCropOptionById.set(optionId, option);
                    const element = document.createElement("option");
                    element.value = optionId;
                    element.textContent = option.label;
                    group.appendChild(element);
                }
                plantSelect.appendChild(group);
            }

            function getPlantLifecycle(row) {
                const enabled = [
                    ["annual", Number(row && row.annual) === 1],
                    ["biennial", Number(row && row.biennial) === 1],
                    ["perennial", Number(row && row.perennial) === 1]
                ].filter(item => item[1]);
                return enabled.length === 1 ? enabled[0][0] : "uncategorized";
            }

            function parseVarietyOverrideYield(varietyRow) {
                const overrides = varietyRow ? Env.safeJsonStringParse(varietyRow.overrides_json, null) : null;
                const value = Number(overrides && (overrides.yield_per_plant_kg ?? overrides.overrides?.yield_per_plant_kg));
                return Number.isFinite(value) && value > 0 ? value : NaN;
            }

            async function resolveGardenCropOption(candidate, plantRowsById) {
                const plantId = String(candidate && candidate.plantId || "");
                const row = plantRowsById.get(plantId);
                if (!row) return null;
                let varietyId = candidate && candidate.varietyId ? String(candidate.varietyId) : "";
                let varietyName = String(candidate && candidate.varietyName || "").trim();
                let varietyRow = null;

                if (varietyId || varietyName) {
                    const varietyRows = await getVarietyRows(plantId);
                    if (varietyId) {
                        varietyRow = varietyRows.find(item => String(item.variety_id) === varietyId) || null;
                        if (!varietyName && varietyRow) varietyName = String(varietyRow.variety_name || "").trim();
                    } else {
                        const normalizedName = varietyName.toLocaleLowerCase();
                        const matches = varietyRows.filter(item => String(item.variety_name || "").trim().toLocaleLowerCase() === normalizedName);
                        if (matches.length !== 1) return null;
                        varietyRow = matches[0];
                        varietyId = String(varietyRow.variety_id);
                        varietyName = String(varietyRow.variety_name || varietyName).trim();
                    }
                }

                const plantName = String(row.plant_name || candidate.plantName || "").trim();
                return {
                    source: "garden",
                    plantId,
                    plantName,
                    varietyId: varietyId || null,
                    varietyName,
                    varietyRow,
                    row,
                    lifecycle: getPlantLifecycle(row),
                    label: varietyName ? `${plantName} - ${varietyName}` : plantName
                };
            }

            async function loadAddCropOptions(force) {
                const loadVersion = ++addCropOptionsLoadVersion;
                plantSelect.disabled = true;
                addCrop.disabled = true;
                reloadPlants.disabled = true;
                addCropOptionById.clear();
                plantSelect.innerHTML = "";
                plantSelect.appendChild(new Option("-- Select crop --", ""));
                plantMessage.textContent = "Loading crops...";
                try {
                    if (force) {
                        DbClient.invalidatePlantsBasicCache();
                        varietyCache.clear();
                    }
                    const plants = await DbClient.getPlantsBasicCached();
                    const plantRowsById = new Map(plants.map(row => [String(row.plant_id), row]));
                    const plannedKeys = new Set((plan.crops || []).map(crop => PlanSchema.getCropIdentityKey(crop)).filter(Boolean));
                    const gardenOptions = [];
                    const gardenKeys = new Set();
                    let skippedGardenCount = 0;

                    for (const candidate of DiagramPlanReader.readGardenCropCandidates(moduleCell)) {
                        const option = await resolveGardenCropOption(candidate, plantRowsById);
                        if (!option) { skippedGardenCount += 1; continue; }
                        const key = PlanSchema.makeCropIdentityKey(option.plantId, option.varietyId || "");
                        if (!key || plannedKeys.has(key) || gardenKeys.has(key)) continue;
                        gardenKeys.add(key);
                        gardenOptions.push(option);
                    }

                    if (!SessionController.isActive(session) || loadVersion !== addCropOptionsLoadVersion) return;
                    const byLifecycle = { annual: [], biennial: [], perennial: [], uncategorized: [] };
                    for (const row of plants) {
                        const plantId = String(row.plant_id);
                        const key = PlanSchema.makeCropIdentityKey(plantId, "");
                        if (!key || plannedKeys.has(key) || gardenKeys.has(key)) continue;
                        const plantName = String(row.plant_name || "").trim();
                        const lifecycle = getPlantLifecycle(row);
                        byLifecycle[lifecycle].push({
                            source: "database",
                            plantId,
                            plantName,
                            varietyId: null,
                            varietyName: "",
                            varietyRow: null,
                            row,
                            lifecycle,
                            label: plantName
                        });
                    }

                    const sortOptions = options => options.sort((a, b) => a.label.localeCompare(b.label));
                    plantSelect.innerHTML = "";
                    plantSelect.appendChild(new Option("-- Select crop --", ""));
                    addCropOptionById.clear();
                    appendAddCropOptionGroup("Crops in this garden, not yet in plan", sortOptions(gardenOptions));
                    appendAddCropOptionGroup("Annual crops", sortOptions(byLifecycle.annual));
                    appendAddCropOptionGroup("Biennial crops", sortOptions(byLifecycle.biennial));
                    appendAddCropOptionGroup("Perennial crops", sortOptions(byLifecycle.perennial));
                    appendAddCropOptionGroup("Uncategorized crops", sortOptions(byLifecycle.uncategorized));
                    plantMessage.textContent = skippedGardenCount
                        ? `Skipped ${skippedGardenCount} unavailable garden crop${skippedGardenCount === 1 ? "" : "s"}.`
                        : "";
                } catch (error) {
                    if (SessionController.isActive(session) && loadVersion === addCropOptionsLoadVersion) {
                        addCropOptionById.clear();
                        plantMessage.textContent = String(error && error.message || error);
                    }
                } finally {
                    if (SessionController.isActive(session) && loadVersion === addCropOptionsLoadVersion) {
                        plantSelect.disabled = false;
                        addCrop.disabled = false;
                        reloadPlants.disabled = false;
                    }
                }
            }

            addCrop.addEventListener("click", () => {
                const selectedOption = addCropOptionById.get(String(plantSelect.value || ""));
                if (!selectedOption) return;
                if (PlanSchema.findDuplicateCrop(plan, selectedOption.plantId, selectedOption.varietyId || "", "")) {
                    state.extraDiagnostics = [`Crop already exists for ${selectedOption.label}.`];
                    state.planCheckExpanded = true;
                    refreshDerived();
                    return;
                }
                state.extraDiagnostics = [];
                const plantId = selectedOption.plantId;
                const item = selectedOption.row;
                const defaults = PlanRepository.getDefaultsForPlant(plantId);
                const baseYield = Number(item.yield_per_plant_kg);
                const overrideYield = parseVarietyOverrideYield(selectedOption.varietyRow);
                const cropYield = Number.isFinite(overrideYield) ? overrideYield : baseYield;
                const numericVarietyId = selectedOption.varietyId == null ? NaN : Number(selectedOption.varietyId);
                const crop = {
                    id: Env.uid("crop"), plantId, plant: selectedOption.plantName, method: String(item.default_planting_method || "").trim() || "direct_sow.field",
                    methodCategoryId: String(item.default_planting_method_category || PlanSchema.inferMethodCategoryFromMethodId(item.default_planting_method) || "direct_sow").trim(),
                    varietyId: selectedOption.varietyId == null ? null : (Number.isFinite(numericVarietyId) ? numericVarietyId : selectedOption.varietyId), variety: selectedOption.varietyName, harvestStart: "", harvestEnd: "", harvestWindowSource: "sowing_window_estimate", useActualHarvest: false, syncharvest: false, // CHANGE: new crops default to the sowing-window planning source while dates are requested.
                    shelfLifeDays: 0, baseKgPerPlant: baseYield, kgPerPlant: cropYield,
                    kgPerPlantMode: "auto", actualPlants: 0, germRate: 1,
                    packages: defaults && defaults.length ? PlanSchema.clonePlain(defaults) : [{ unit: "kg", baseType: "kg", baseQty: 1, price: NaN }]
                };
                plan.crops.push(crop);
                setSelectedCropEverywhere(crop.id);
                crop.__harvestWindowSourceMissing = false; // CHANGE: new rows already default to the sowing-window source.
                emitHarvestWindowsNeeded(crop);
                renderAll();
            });
            reloadPlants.addEventListener("click", () => loadAddCropOptions(true));

            yearInput.addEventListener("change", () => {
                const nextYear = Number(yearInput.value);
                if (!Number.isFinite(nextYear) || nextYear < 1900 || nextYear > 3000) { yearInput.value = String(currentYear); return; }
                if (nextYear === currentYear) return;
                if (!saveCurrent(false)) { yearInput.value = String(currentYear); return; }
                const nextExisting = PlanRepository.loadPlanForYear(moduleCell, nextYear);
                replacePlan(nextExisting || PlanSchema.createEmptyPlan(nextYear), nextYear, !!nextExisting);
                renderAll();
                YearPlanDashboard.markBaseline(state, plan, null);
                refreshDerived();
            });
            applyTemplate.addEventListener("click", () => {
                const name = String(templateSel.value || "");
                const template = name && PlanRepository.loadTemplateByName(name);
                if (!template) return;
                replacePlan(PlanRepository.rekeyTemplateToPlan(template, currentYear), currentYear, loadedExistingForCurrentYear);
                renderAll();
            });
            templateSel.addEventListener("change", () => {
                templateNameInput.value = String(templateSel.value || "");
                saveTemplate.disabled = !templateNameInput.value.trim();
            });
            templateNameInput.addEventListener("input", () => { saveTemplate.disabled = !templateNameInput.value.trim(); });
            saveTemplate.addEventListener("click", () => {
                const name = String(templateNameInput.value || "").trim();
                if (!name) return;
                const template = PlanSchema.serializeForPersistence(plan, { forTemplate: true });
                template.templateBaseYear = currentYear; template.year = null;
                PlanRepository.saveTemplateByName(name, template); fillTemplateDropdown(); templateSel.value = name; templateNameInput.value = name; saveTemplate.disabled = false;
            });
            deleteTemplate.addEventListener("click", () => {
                const name = String(templateSel.value || "");
                if (!name || !confirm(`Delete template "${name}"?`)) return;
                PlanRepository.deleteTemplateByName(name); fillTemplateDropdown(); templateNameInput.value = ""; saveTemplate.disabled = true;
            });
            cropFilterSel.addEventListener("change", () => {
                const cropId = String(cropFilterSel.value || "");
                if (cropId) {
                    if (!setSelectedCropEverywhere(cropId, { expandCropPlan: true, syncPlanCheck: true })) return;
                    renderCropList();
                    renderSelectedEditor();
                    renderCropPlan(false);
                    renderPlanCheck();
                    renderFooter();
                    return;
                }
                plan.cropFilterId = "";
                renderPlanCheck();
                renderFooter();
            });
            canvas.addEventListener("mousemove", event => {
                if (!chartHitModel || !chartHitModel.weekCenters.length) return;
                const canvasRect = canvas.getBoundingClientRect();
                const chartRect = chartBox.getBoundingClientRect();
                const canvasX = (event.clientX - canvasRect.left) * (canvas.width / Math.max(1, canvasRect.width));
                if (canvasX < chartHitModel.plotLeft || canvasX > chartHitModel.plotRight) {
                    chartTooltip.style.display = "none";
                    return;
                }
                const index = Math.max(0, Math.min(
                    chartHitModel.rows.length - 1,
                    Math.floor((canvasX - chartHitModel.plotLeft) / chartHitModel.step)
                ));
                const row = chartHitModel.rows[index];
                if (!row) return;
                const tooltipLines = [`<strong>Week of ${mxUtils.htmlEntities(row.week)}</strong>`];
                for (const series of PLAN_CHART_SERIES) {
                    if (visibleChartSeriesIds.has(series.id)) tooltipLines.push(`${series.tooltipLabel}: ${formatKg(row[series.field])}`);
                }
                tooltipLines.push(`Inventory: ${formatKg(row.endingInventoryKg)}`);
                chartTooltip.innerHTML = tooltipLines.join("<br>");
                const maximumLeft = Math.max(4, chartBox.clientWidth - 190);
                chartTooltip.style.left = `${Math.max(4, Math.min(maximumLeft, event.clientX - chartRect.left + 12))}px`;
                chartTooltip.style.top = `${Math.max(35, event.clientY - chartRect.top - 18)}px`;
                chartTooltip.style.display = "block";
            });
            canvas.addEventListener("mouseleave", () => { chartTooltip.style.display = "none"; });
            save.addEventListener("click", () => saveCurrent(false));
            saveClose.addEventListener("click", () => saveCurrent(true));
            promptSave.addEventListener("click", () => saveCurrent(true));
            promptDiscard.addEventListener("click", () => SessionController.close());
            promptCancel.addEventListener("click", () => { state.closePromptOpen = false; renderFooter(); });
            close.addEventListener("click", requestClose);
            exportButton.addEventListener("click", () => {
                const safeName = String(DiagramStore.getCellAttr(moduleCell, "label", "garden")).replace(/[^\w\-]+/g, "_").slice(0, 60);
                downloadJson(`${safeName}_${currentYear}_plan.json`, PlanSchema.serializeForPersistence(plan));
            });
            reset.addEventListener("click", () => {
                if (!confirm(`Clear the saved ${currentYear} plan?`)) return;
                PlanRepository.deletePlanForYear(moduleCell, currentYear);
                replacePlan(PlanSchema.createEmptyPlan(currentYear), currentYear, false);
                state.saveValidationErrors = []; // CHANGE: Reset/Clear deletes the plan instead of saving an empty one.
                renderAll();
                YearPlanDashboard.markBaseline(state, plan, null);
                refreshDerived();
            });

            function emitHarvestWindowsNeeded(crops) {
                const requestedCrops = (Array.isArray(crops) ? crops : [crops]).filter(Boolean);
                if (!requestedCrops.length) return;
                window.dispatchEvent(new CustomEvent("usl:harvestWindowsNeeded", { detail: {
                    moduleCellId: moduleCell.getId ? moduleCell.getId() : moduleCell.id,
                    year: currentYear,
                    crops: requestedCrops.map(crop => ({
                        cropId: crop.id,
                        plantId: crop.plantId,
                        varietyId: crop.varietyId ?? null,
                        methodId: crop.method ?? null,
                        method: crop.method ?? null,
                        methodCategoryId: crop.methodCategoryId ?? null,
                        yieldTargetKg: 0
                    }))
                } }));
            }

            SessionController.addWindowListener(session, "usl:harvestWindowsSuggested", event => {
                const detail = event && event.detail;
                if (!detail || String(detail.moduleCellId || "") !== String(moduleCell.getId ? moduleCell.getId() : moduleCell.id) || Number(detail.year) !== currentYear) return;
                const beforeDateRanges = captureDateRangeSnapshot();
                const byId = new Map((plan.crops || []).map(crop => [String(crop.id), crop]));
                for (const result of (detail.results || [])) {
                    const crop = byId.get(String(result.cropId));
                    if (!crop) continue;
                    if (PlanMath.hasYmd(result.harvestStart) && PlanMath.hasYmd(result.harvestEnd) && result.harvestStart <= result.harvestEnd) {
                        crop.estimatedHarvestStart = result.harvestStart;
                        crop.estimatedHarvestEnd = result.harvestEnd;
                        crop.estimatedHarvestUnavailableReason = "";
                        const manualBlankWindow = crop.harvestWindowSource === "manual" && !PlanMath.hasYmd(crop.harvestStart) && !PlanMath.hasYmd(crop.harvestEnd);
                        if (!hasActualHarvestForCrop(crop) && (crop.__harvestWindowSourceMissing || !crop.harvestWindowSource || manualBlankWindow)) {
                            PlanSchema.setCropHarvestWindowSource(crop, "sowing_window_estimate"); // CHANGE: default estimates only when this crop has no actual harvest records.
                        }
                    } else {
                        crop.estimatedHarvestStart = "";
                        crop.estimatedHarvestEnd = "";
                        crop.estimatedHarvestUnavailableReason = String(result.reason || "No feasible sowing window");
                        if (crop.harvestWindowSource === "sowing_window_estimate") PlanSchema.setCropHarvestWindowSource(crop, "manual");
                    }
                    if (!(Number(crop.shelfLifeDays) > 0) && Number(result.shelfLifeDays) > 0) crop.shelfLifeDays = Math.trunc(Number(result.shelfLifeDays));
                }
                refreshDerived(beforeDateRanges);
            });

            SessionController.addGraphListener(session, graph, "usl:varietyEditorClosed", (sender, event) => {
                const cropId = String(event.getProperty("cropId") || "");
                const crop = (plan.crops || []).find(item => String(item.id) === cropId);
                if (!crop) return;
                varietyCache.delete(String(crop.plantId || ""));
                const action = String(event.getProperty("action") || "");
                const varietyId = event.getProperty("varietyId");
                if (action !== "cancel" && action !== "error" && varietyId !== null && varietyId !== "") {
                    if (!PlanSchema.findDuplicateCrop(plan, crop.plantId, varietyId, crop.id)) {
                        crop.varietyId = Number(varietyId); crop.variety = String(event.getProperty("varietyName") || "");
                    }
                }
                if (selectedCrop() === crop) renderSelectedEditor();
                refreshDerived();
                loadAddCropOptions(false);
            });

            renderChartLegend();
            renderAll();
            YearPlanDashboard.markBaseline(state, plan, null);
            refreshDerived();
            return session;
        }

        return { open };
    })();

    if (window.__USL_YEAR_PLANNER_TEST_HOOK__) {
        window.__uslYearPlannerTestApi = {
            Env,
            DiagramStore,
            DbClient,
            PlanMath,
            PlanSchema,
            PlanRepository,
            DiagramPlanReader,
            PlanRuntimeService,
            PlanningCore,
            CropTimeline: { buildCropTimelineModel }, // CHANGE: expose the render model for focused timeline tests.
            YearPlanCollapsePreferences,
            YearPlanDashboard,
            YearPlanModalController,
            SessionController
        };
    }

    /** Starts the single year-plan modal session. */
    function openPlanModal(moduleCell, year) {
        if (window.Trellis && window.Trellis.interactionModes && typeof window.Trellis.interactionModes.closeActive === "function") {
            const activeMode = window.Trellis.interactionModes.getActive && window.Trellis.interactionModes.getActive();
            if (activeMode && activeMode.mode === "allocate") window.Trellis.interactionModes.closeActive("year-planner-opened");
        }
        return YearPlanModalController.open(moduleCell, year);
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
