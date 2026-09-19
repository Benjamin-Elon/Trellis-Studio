/**
 * Trellis plugin: Year Planner (listens for dashboard Plan button events)
 *
 * Listens:
 *   window event "usl:planYearRequested" with detail:
 *     { moduleCellId: string, dashCellId?: string, year: number }
 *
 * Stores plan JSON on the module cell attribute:
 *   plan_year_json         -> committed valid plan JSON object keyed by year string
 *   plan_year_drafts_json  -> resumable draft plan JSON object keyed by year string
 */
Draw.loadPlugin(function (ui) {
    const graph = ui.editor && ui.editor.graph;
    if (!graph) return;

    const model = graph.getModel();

    // -------------------- Config --------------------
    const PLAN_YEARS_ATTR = "plan_year_json";
    const PLAN_DRAFTS_ATTR = "plan_year_drafts_json"; // CHANGE: drafts persist invalid/incomplete work without changing committed plans.
    const PLAN_TEMPLATES_ATTR = "plan_year_templates";      // (diagram-scoped)
    const PLAN_UNIT_DEFAULTS_ATTR = "plan_unit_defaults";   // (diagram-scoped, per plantId)
    const PLAN_METADATA_CELL_ATTR = "usl_year_planner_metadata";
    const EPS = 0.0001;
    const TRELLIS_DIALOG_Z = 2000000000;
    const EMPTY_PLAN_SAVE_MESSAGE = "Add at least one crop to the year plan before publishing."; // CHANGE: empty plans persist as drafts but cannot become committed plans.
    const DISABLED_CHIP = "Disabled"; // CHANGE: disabled demand sections present one consistent header status.
    const STANDARD_WEIGHT_PACKAGE_UNITS = ["g", "kg", "ounce", "pound"]; // CHANGE: package setup cycles through common weight bases before custom labels.
    const PACKAGE_BASE_OPTIONS = STANDARD_WEIGHT_PACKAGE_UNITS.concat(["plant"]).map(value => ({ value, label: value })); // CHANGE
    const __YP_GLOBAL = window.__uslYearPlannerGlobal || (window.__uslYearPlannerGlobal = {});
    const PLAN_BUTTON_FLASH_EVENT = "usl:yearPlanButtonFlashRequested"; // CHANGE
    const YEAR_PLAN_RETURN_CONTEXTS = __YP_GLOBAL.returnContexts || (__YP_GLOBAL.returnContexts = new Map()); // CHANGE
    const YEAR_PLAN_FLASH_SEEN_KEYS = __YP_GLOBAL.flashSeenKeys || (__YP_GLOBAL.flashSeenKeys = new Set()); // CHANGE

    function cellStableId(cell) {
        return String(cell && (typeof cell.getId === "function" ? cell.getId() : cell.id) || "");
    } // CHANGE

    function yearPlanReturnContextKey(moduleCell, year) {
        return `${cellStableId(moduleCell)}:${String(year || "")}`;
    } // CHANGE

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
                PLAN_DRAFTS_ATTR, // CHANGE
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

        function normalizePickerTreeState(value) {
            const source = value && typeof value === "object" ? value : {};
            const normalized = {};
            for (const key of Object.keys(source)) {
                const ids = normalizeIdList(source[key]);
                if (ids.length) normalized[String(key)] = ids;
            }
            return normalized;
        } // CHANGE: picker expansion state is persisted with the existing per-user planner UI preferences.

        function normalize(record) {
            const source = record && typeof record === "object" ? record : {};
            const top = source.top && typeof source.top === "object" ? source.top : {};
            return {
                top: {
                    cropPlanExpanded: top.cropPlanExpanded === false ? false : true,
                    selfSufficiencyExpanded: top.selfSufficiencyExpanded === true,
                    demandExpanded: top.demandExpanded === false ? false : true,
                    csaExpanded: top.csaExpanded === true,
                    planCheckExpanded: top.planCheckExpanded === true
                },
                collapsedDemandChannelIds: normalizeIdList(source.collapsedDemandChannelIds),
                collapsedDemandLineIds: normalizeIdList(source.collapsedDemandLineIds),
                collapsedSelfSufficiencyLineIds: normalizeIdList(source.collapsedSelfSufficiencyLineIds),
                pickerTreeExpanded: normalizePickerTreeState(source.pickerTreeExpanded) // CHANGE
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
                    selfSufficiencyExpanded: state.selfSufficiencyExpanded,
                    demandExpanded: state.demandExpanded,
                    csaExpanded: state.csaExpanded,
                    planCheckExpanded: state.planCheckExpanded
                },
                collapsedDemandChannelIds: Array.from(state.collapsedDemandChannelIds || []),
                collapsedDemandLineIds: Array.from(state.collapsedDemandLineIds || []),
                collapsedSelfSufficiencyLineIds: Array.from(state.collapsedSelfSufficiencyLineIds || []),
                pickerTreeExpanded: state.pickerTreeExpanded || {} // CHANGE
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
        SELECT variety_id, plant_id, variety_name, maturity_class, overrides_json
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

        async function queryNutritionByPlantIds(plantIds) {
            const ids = Array.from(new Set((plantIds || []).map(value => Number(value)).filter(Number.isFinite)));
            if (!ids.length) return { available: true, mappings: [], values: [] };
            const placeholders = ids.map(() => "?").join(",");
            try {
                const mappings = await queryAll(`
                    SELECT plant_id, fdc_id, fdc_description, fdc_data_type, food_form, match_confidence, source_url, source_note
                    FROM PlantNutritionMappings
                    WHERE food_form = 'raw' AND plant_id IN (${placeholders});`, ids);
                const values = await queryAll(`
                    SELECT v.plant_id, v.nutrient_key, COALESCE(n.nutrient_name, v.nutrient_key) AS nutrient_name,
                           COALESCE(n.unit, '') AS unit, v.amount_per_100g, v.source_fdc_id
                    FROM PlantNutritionValues v
                    LEFT JOIN NutritionNutrients n ON n.nutrient_key = v.nutrient_key
                    WHERE v.plant_id IN (${placeholders});`, ids);
                return { available: true, mappings, values };
            } catch (_) {
                return { available: false, mappings: [], values: [] };
            }
        } // NEW: nutrition data is optional at runtime until the packaged DB has the schema.

        async function queryNutritionRequirements() {
            try {
                const requirements = await queryAll(`
                    SELECT persona_key, nutrient_key, amount_per_day, unit
                    FROM NutritionRequirements
                    ORDER BY persona_key, nutrient_key;`, []);
                return { available: true, requirements };
            } catch (_) {
                return { available: false, requirements: [] };
            }
        } // NEW

        return {
            getDbPath,
            queryAll,
            listPlantsBasicRows,
            getPlantsBasicCached,
            invalidatePlantsBasicCache,
            queryVarietiesByPlantId,
            queryPlantingMethodsForPlantId,
            queryNutritionByPlantIds,
            queryNutritionRequirements
        };
    })();
    window.addEventListener("trellis:database-restored", () => DbClient.invalidatePlantsBasicCache()); // CHANGE: restored DB should not leave stale crop options in memory.























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

        function normalizePackageUnitKey(unit) {
            return String(unit || "").trim().toLowerCase();
        } // CHANGE: demand-like rows may only use package units explicitly defined by the crop.

        function packageUnitOptions(crop) {
            const options = [];
            const seen = new Set();
            for (const pkg of ((crop && crop.packages) || [])) {
                const unit = String(pkg && pkg.unit || "").trim();
                const key = normalizePackageUnitKey(unit);
                if (!key || seen.has(key)) continue;
                seen.add(key);
                options.push({ value: unit, label: unit });
            }
            return options;
        } // CHANGE: package rows are the single source of selectable quantity units.

        function hasPackageUnit(crop, unit) {
            const key = normalizePackageUnitKey(unit);
            if (!key) return false;
            return ((crop && crop.packages) || []).some(pkg => normalizePackageUnitKey(pkg && pkg.unit) === key);
        } // CHANGE

        function resolveUnitToKgPerUnit(crop, unit) {
            const u = normalizePackageUnitKey(unit);
            if (!u) return NaN;

            const packs = (crop && crop.packages) ? crop.packages : [];
            const p = packs.find(x => normalizePackageUnitKey(x && x.unit) === u);
            if (!p) return NaN;

            const baseType = String(p.baseType || "").trim().toLowerCase();
            const baseQty = Number(p.baseQty);
            if (!Number.isFinite(baseQty) || baseQty <= 0) return NaN;

            if (baseType === "g") return baseQty / 1000;
            if (baseType === "kg") return baseQty;
            if (baseType === "ounce") return baseQty * 0.028349523125;
            if (baseType === "pound") return baseQty * 0.45359237;

            if (baseType === "plant" || baseType === "plants") {
                const kgPerPlant = Number(crop.kgPerPlant);
                if (!Number.isFinite(kgPerPlant) || kgPerPlant <= 0) return NaN;
                return baseQty * kgPerPlant;
            }

            return NaN;
        }

        function resolvePackagePriceForUnit(crop, unit) {
            const u = normalizePackageUnitKey(unit);
            if (!u) return NaN;
            const packs = Array.isArray(crop && crop.packages) ? crop.packages : [];
            const pkg = packs.find(item => normalizePackageUnitKey(item && item.unit) === u);
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

        function buildPlanChartModel(weekly, cropId, options) {
            const scope = String(options && options.scope || "combined"); // NEW: Plan Check can inspect self, CSA, sales, or combined demand.
            const source = cropId && weekly && weekly.perCrop
                ? (weekly.perCrop.get(cropId) || weekly.perCrop.get(String(cropId)))
                : null;
            const weeks = weekly && Array.isArray(weekly.weeks) ? weekly.weeks : [];
            const target = source ? scopedSeries(source, scope, "target") : scopedWeeklySeries(weekly, scope, "target"); // CHANGE
            const harvest = source ? source.supply : (weekly && weekly.supplyTotal) || [];
            const available = source ? source.availableSupply : (weekly && weekly.availableSupplyTotal) || [];
            const usable = source ? scopedSeries(source, scope, "usableSupply") : scopedWeeklySeries(weekly, scope, "usableSupply"); // CHANGE
            const short = source ? scopedSeries(source, scope, "short") : scopedWeeklySeries(weekly, scope, "short"); // CHANGE
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

        function scopedSeries(source, scope, field) {
            if (!source) return [];
            const suffix = field.charAt(0).toUpperCase() + field.slice(1);
            if (scope === "self") return source["self" + suffix] || [];
            if (scope === "csa") return source["csa" + suffix] || [];
            if (scope === "sales") return source["sales" + suffix] || [];
            return source[field] || [];
        } // NEW: per-crop scope series share the existing chart row shape.

        function scopedWeeklySeries(weekly, scope, field) {
            if (scope === "self") return weekly && weekly.selfSufficiency && weekly.selfSufficiency[field] || [];
            if (scope === "csa") return weekly && weekly.csa && weekly.csa[field] || [];
            if (scope === "sales") return weekly && weekly.sales && weekly.sales[field] || [];
            const map = { target: "targetTotal", usableSupply: "usableSupplyTotal", short: "shortTotal" };
            return weekly && weekly[map[field] || field] || [];
        } // NEW: aggregate scope series let Plan Check switch demand sources without redrawing logic.

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
            const demandChannelById = new Map(((plan && plan.demandChannels) || []).map(channel => [String(channel && channel.id || ""), channel])); // CHANGE
            const channelOrder = new Map(((plan && plan.demandChannels) || []).map((channel, index) => [String(channel && channel.id || ""), index]));
            const perDemandLine = new Map();
            const perSelfLine = new Map(); // NEW
            const perChannel = new Map();
            const perPriority = new Map();
            const selfWeekly = { target: Array(n).fill(0), usableSupply: Array(n).fill(0), short: Array(n).fill(0), groceryValue: Array(n).fill(0), fulfilledGroceryValue: Array(n).fill(0), groceryValueByCropId: new Map(), fulfilledGroceryValueByCropId: new Map() }; // NEW
            const salesWeekly = { target: Array(n).fill(0), usableSupply: Array(n).fill(0), short: Array(n).fill(0), potentialRevenue: Array(n).fill(0), fulfilledRevenue: Array(n).fill(0) }; // NEW
            const csaWeekly = { target: Array(n).fill(0), usableSupply: Array(n).fill(0), short: Array(n).fill(0), potentialRevenue: Array(n).fill(0), fulfilledRevenue: Array(n).fill(0), boxFillRatio: Array(n).fill(0), potentialRevenueByCropId: new Map(), fulfilledRevenueByCropId: new Map(), componentValuePerBox: 0, salePricePerBox: 0 };
            const csaComponentRequests = [];
            const priorityRank = new Map([["committed", 0], ["target", 1], ["optional", 2]]);

            function ensureSelfValueArrays(cropId) {
                const key = String(cropId || "");
                if (!selfWeekly.groceryValueByCropId.has(key)) selfWeekly.groceryValueByCropId.set(key, Array(n).fill(0));
                if (!selfWeekly.fulfilledGroceryValueByCropId.has(key)) selfWeekly.fulfilledGroceryValueByCropId.set(key, Array(n).fill(0));
                return {
                    potential: selfWeekly.groceryValueByCropId.get(key),
                    fulfilled: selfWeekly.fulfilledGroceryValueByCropId.get(key)
                };
            } // NEW: package prices are reused as estimated grocery value for self-use rows.

            function ensureCsaRevenueArrays(cropId) {
                const key = String(cropId || "");
                if (!csaWeekly.potentialRevenueByCropId.has(key)) csaWeekly.potentialRevenueByCropId.set(key, Array(n).fill(0));
                if (!csaWeekly.fulfilledRevenueByCropId.has(key)) csaWeekly.fulfilledRevenueByCropId.set(key, Array(n).fill(0));
                return {
                    potential: csaWeekly.potentialRevenueByCropId.get(key),
                    fulfilled: csaWeekly.fulfilledRevenueByCropId.get(key)
                };
            }

            const selfSufficiencyEnabled = !(plan && plan.selfSufficiency && plan.selfSufficiency.enabled === false); // CHANGE
            for (const [lineIndex, line] of (selfSufficiencyEnabled ? ((plan && plan.selfSufficiency && plan.selfSufficiency.lines) || []) : []).entries()) { // CHANGE
                const crop = findCrop(plan, line && line.cropId);
                if (!crop) { pushWarn(warns, "Self Sufficiency line skipped (missing crop)."); continue; } // NEW
                const qty = Number(line && line.qty);
                if (!Number.isFinite(qty) || qty <= 0) { pushWarn(warns, `Self Sufficiency line skipped (qty missing) for ${crop.plant || crop.id}`); continue; } // NEW
                if (!hasYmd(line.from) || !hasYmd(line.to)) { pushWarn(warns, `Self Sufficiency line skipped (missing dates) for ${crop.plant || crop.id}`); continue; } // NEW
                if (line.from > line.to) { pushWarn(warns, `Self Sufficiency line skipped (start date after end date) for ${crop.plant || crop.id}`); continue; } // NEW
                const kgPerUnit = resolveUnitToKgPerUnit(crop, line.unit);
                if (!Number.isFinite(kgPerUnit)) { pushWarn(warns, `Self Sufficiency line skipped (unknown unit "${line.unit}") for ${crop.plant || crop.id}`); continue; } // NEW
                const unitPrice = resolvePackagePriceForUnit(crop, line.unit);
                const target = Array(n).fill(0);
                if (!addDemandAcrossWeeks(target, weeks, line, kgPerUnit, weekStartDow)) continue;
                if (!Number.isFinite(unitPrice)) pushWarn(warns, `Self Sufficiency value for ${crop.plant || crop.id} ${line.unit || "unit"} counted as $0 because no matching package price is set.`); // NEW
                const result = {
                    line,
                    cropId: String(crop.id),
                    lineIndex,
                    kgPerUnit,
                    unitPrice,
                    target,
                    usableSupply: Array(n).fill(0),
                    short: Array(n).fill(0),
                    groceryValue: target.map(value => Number.isFinite(unitPrice) ? (value / kgPerUnit) * unitPrice : 0),
                    fulfilledGroceryValue: Array(n).fill(0)
                };
                perSelfLine.set(String(line.id), result);
                const cropArrays = ensureCropArrays(crop.id);
                if (!cropArrays.selfTarget) cropArrays.selfTarget = Array(n).fill(0); // NEW
                const cropValue = ensureSelfValueArrays(crop.id);
                for (let i = 0; i < n; i++) {
                    cropArrays.target[i] += target[i];
                    cropArrays.selfTarget[i] += target[i];
                    selfWeekly.target[i] += target[i];
                    selfWeekly.groceryValue[i] += result.groceryValue[i];
                    cropValue.potential[i] += result.groceryValue[i];
                }
            } // NEW: self-use demand participates in total crop requirements but remains independently reportable.

            for (const [lineIndex, line] of ((plan && plan.demands) || []).entries()) {
                demandLineOrder.set(String(line && line.id || ""), lineIndex);
                const channel = demandChannelById.get(String(line && line.channelId || "")); // CHANGE
                if (channel && channel.enabled === false) continue; // CHANGE
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
                if (!Number.isFinite(unitPrice)) pushWarn(warns, `Demand revenue for ${crop.plant || crop.id} ${line.unit || "unit"} counted as $0 because no matching package price is set.`); // NEW
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
                if (!cropArrays.salesTarget) cropArrays.salesTarget = Array(n).fill(0); // NEW
                for (let i = 0; i < n; i++) {
                    cropArrays.target[i] += target[i];
                    cropArrays.salesTarget[i] += target[i];
                    salesWeekly.target[i] += target[i];
                    salesWeekly.potentialRevenue[i] += result.potentialRevenue[i];
                } // CHANGE: sales-channel demand remains scope-separable from household demand.
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
                    for (const [componentIndex, comp] of comps.entries()) { // CHANGE
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
                        const componentRequest = { cropId: String(crop.id), component: comp, componentIndex, target: Array(n).fill(0), usableSupply: Array(n).fill(0), short: Array(n).fill(0), componentValuePerBox: Math.max(0, componentValue) }; // CHANGE
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
                arr.selfTarget = Array.isArray(arr.selfTarget) ? arr.selfTarget : Array(n).fill(0); // NEW
                arr.selfUsableSupply = Array(n).fill(0); // NEW
                arr.selfShort = Array(n).fill(0); // NEW
                arr.csaUsableSupply = Array(n).fill(0);
                arr.csaShort = Array(n).fill(0);
                arr.salesTarget = Array.isArray(arr.salesTarget) ? arr.salesTarget : Array(n).fill(0); // NEW
                arr.salesUsableSupply = Array(n).fill(0); // NEW
                arr.salesShort = Array(n).fill(0); // NEW
                arr.plantingSourcesByWeek = Array.from({ length: n }, () => new Map()); // CHANGE
                const lifetimeWeeks = Math.max(1, Math.ceil(Math.max(0, Number(crop.shelfLifeDays) || 0) / 7));
                const inventory = [];
                const sourceRows = Array.isArray(crop.__actualHarvestSourceRows) ? crop.__actualHarvestSourceRows : []; // CHANGE
                const ensureSourceMetric = (weekIndex, sourceRow) => { // CHANGE
                    if (!sourceRow || !(sourceRow.sourceId || sourceRow.cellId)) return null;
                    const sourceId = String(sourceRow.sourceId || sourceRow.cellId);
                    const weekMap = arr.plantingSourcesByWeek[weekIndex];
                    if (!weekMap.has(sourceId)) weekMap.set(sourceId, {
                        sourceId,
                        cellId: String(sourceRow.cellId || sourceId),
                        cell: sourceRow.cell || null,
                        label: String(sourceRow.label || "Planting"),
                        plantCount: Math.max(0, Math.trunc(Number(sourceRow.plantCount) || 0)),
                        harvestStart: String(sourceRow.harvestStart || ""),
                        harvestEnd: String(sourceRow.harvestEnd || ""),
                        harvestedKg: 0,
                        carriedInKg: 0,
                        usedKg: 0,
                        endingKg: 0,
                        expiredKg: 0
                    });
                    return weekMap.get(sourceId);
                }; // CHANGE
                const addSourceValue = (weekIndex, sourceRow, field, kg) => { // CHANGE
                    const metric = ensureSourceMetric(weekIndex, sourceRow);
                    if (metric) metric[field] += Math.max(0, Number(kg) || 0);
                }; // CHANGE
                const selfResults = Array.from(perSelfLine.values()).filter(result => result.cropId === String(crop.id)); // NEW
                const demandResults = Array.from(perDemandLine.values())
                    .filter(result => result.cropId === String(crop.id))
                    .sort((a, b) => {
                        const priorityDifference = (priorityRank.get(a.priority) ?? 1) - (priorityRank.get(b.priority) ?? 1);
                        if (priorityDifference) return priorityDifference;
                        const channelDifference = (channelOrder.get(a.channelId) ?? Number.MAX_SAFE_INTEGER) - (channelOrder.get(b.channelId) ?? Number.MAX_SAFE_INTEGER);
                        if (channelDifference) return channelDifference;
                        return (demandLineOrder.get(String(a.line.id)) ?? 0) - (demandLineOrder.get(String(b.line.id)) ?? 0);
                    });
                let activeAllocationWeekIndex = 0; // CHANGE
                const consume = requestedKg => {
                    let remaining = Math.max(0, Number(requestedKg) || 0);
                    let used = 0;
                    while (remaining > 0 && inventory.length) {
                        const batch = inventory[0];
                        const amount = Math.min(remaining, batch.kg);
                        batch.kg -= amount;
                        remaining -= amount;
                        used += amount;
                        addSourceValue(activeAllocationWeekIndex, batch.sourceRow, "usedKg", amount); // CHANGE
                        if (batch.kg <= 1e-9) inventory.shift();
                    }
                    return { used, short: remaining };
                };
                for (let weekIndex = 0; weekIndex < n; weekIndex++) {
                    activeAllocationWeekIndex = weekIndex; // CHANGE
                    while (inventory.length && inventory[0].expiresWeek <= weekIndex) {
                        const expired = inventory.shift();
                        arr.expired[weekIndex] += expired.kg;
                        addSourceValue(weekIndex, expired.sourceRow, "expiredKg", expired.kg); // CHANGE
                    }
                    for (const batch of inventory) addSourceValue(weekIndex, batch.sourceRow, "carriedInKg", batch.kg); // CHANGE
                    const harvestedKg = Math.max(0, Number(arr.supply[weekIndex]) || 0);
                    let sourceHarvestedKg = 0; // CHANGE
                    for (const sourceRow of sourceRows) { // CHANGE
                        const kg = Math.max(0, Number(Array.isArray(sourceRow.weeklyKg) ? sourceRow.weeklyKg[weekIndex] : 0) || 0);
                        if (kg <= EPS) continue;
                        sourceHarvestedKg += kg;
                        addSourceValue(weekIndex, sourceRow, "harvestedKg", kg);
                        inventory.push({ kg, expiresWeek: weekIndex + lifetimeWeeks, sourceRow, weekIndex });
                    }
                    const unattributedHarvestKg = Math.max(0, harvestedKg - sourceHarvestedKg); // CHANGE
                    if (unattributedHarvestKg > EPS) inventory.push({ kg: unattributedHarvestKg, expiresWeek: weekIndex + lifetimeWeeks, sourceRow: null, weekIndex }); // CHANGE
                    arr.availableSupply[weekIndex] = inventory.reduce((sum, batch) => sum + batch.kg, 0);
                    for (const result of selfResults) {
                        const allocation = consume(result.target[weekIndex]);
                        result.usableSupply[weekIndex] = allocation.used;
                        result.short[weekIndex] = allocation.short;
                        result.fulfilledGroceryValue[weekIndex] = Number.isFinite(result.unitPrice)
                            ? (allocation.used / result.kgPerUnit) * result.unitPrice
                            : 0;
                        arr.selfUsableSupply[weekIndex] += allocation.used;
                        arr.selfShort[weekIndex] += allocation.short;
                        arr.usableSupply[weekIndex] += allocation.used;
                        arr.short[weekIndex] += allocation.short;
                        selfWeekly.usableSupply[weekIndex] += allocation.used;
                        selfWeekly.short[weekIndex] += allocation.short;
                        selfWeekly.fulfilledGroceryValue[weekIndex] += result.fulfilledGroceryValue[weekIndex];
                        ensureSelfValueArrays(crop.id).fulfilled[weekIndex] += result.fulfilledGroceryValue[weekIndex];
                    } // NEW: household food is allocated before CSA and sales.
                    const csaAllocation = consume(arr.csaTarget && arr.csaTarget[weekIndex]);
                    csaWeekly.usableSupply[weekIndex] += csaAllocation.used;
                    csaWeekly.short[weekIndex] += csaAllocation.short;
                    arr.csaUsableSupply[weekIndex] = csaAllocation.used;
                    arr.csaShort[weekIndex] = csaAllocation.short;
                    const cropCsaTarget = Math.max(0, Number(arr.csaTarget && arr.csaTarget[weekIndex]) || 0); // CHANGE
                    if (cropCsaTarget > EPS) { // CHANGE
                        for (const request of csaComponentRequests.filter(item => String(item.cropId) === String(crop.id))) { // CHANGE
                            const requestTarget = Math.max(0, Number(request.target[weekIndex]) || 0);
                            if (requestTarget <= EPS) continue;
                            const share = requestTarget / cropCsaTarget;
                            request.usableSupply[weekIndex] += csaAllocation.used * share;
                            request.short[weekIndex] += csaAllocation.short * share;
                        }
                    } // CHANGE
                    arr.usableSupply[weekIndex] += csaAllocation.used;
                    arr.short[weekIndex] += csaAllocation.short;
                    for (const result of demandResults) {
                        const allocation = consume(result.target[weekIndex]);
                        result.usableSupply[weekIndex] = allocation.used;
                        result.short[weekIndex] = allocation.short;
                        result.fulfilledRevenue[weekIndex] = Number.isFinite(result.unitPrice)
                            ? (allocation.used / result.kgPerUnit) * result.unitPrice
                            : 0;
                        arr.salesUsableSupply[weekIndex] += allocation.used; // NEW
                        arr.salesShort[weekIndex] += allocation.short; // NEW
                        salesWeekly.usableSupply[weekIndex] += allocation.used; // NEW
                        salesWeekly.short[weekIndex] += allocation.short; // NEW
                        salesWeekly.fulfilledRevenue[weekIndex] += result.fulfilledRevenue[weekIndex]; // NEW
                        arr.usableSupply[weekIndex] += allocation.used;
                        arr.short[weekIndex] += allocation.short;
                    }
                    arr.endingInventory[weekIndex] = inventory.reduce((sum, batch) => sum + batch.kg, 0);
                    arr.surplus[weekIndex] = arr.endingInventory[weekIndex];
                    for (const batch of inventory) addSourceValue(weekIndex, batch.sourceRow, "endingKg", batch.kg); // CHANGE
                }
                arr.plantingSourcesByWeek = arr.plantingSourcesByWeek.map(weekMap => Array.from(weekMap.values()).filter(row => row.harvestedKg > EPS || row.carriedInKg > EPS || row.usedKg > EPS || row.endingKg > EPS || row.expiredKg > EPS)); // CHANGE
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
            if (committedAggregate && csaWeekly && csa && csa.enabled) { // CHANGE
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
                perSelfLine,
                perChannel,
                perPriority,
                selfSufficiency: selfWeekly,
                sales: salesWeekly,
                csa: csaWeekly,
                csaComponentRequests // CHANGE
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
            packageUnitOptions,
            hasPackageUnit,
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

    // -------------------- NutritionPlanner --------------------
    const NutritionPlanner = (() => {
        const FOCUSED_NUTRIENTS = Object.freeze([
            { key: "energy_kcal", label: "Calories", unit: "kcal" },
            { key: "protein_g", label: "Protein", unit: "g" },
            { key: "fiber_g", label: "Fiber", unit: "g" },
            { key: "vitamin_a_rae_mcg", label: "Vitamin A", unit: "mcg RAE" },
            { key: "vitamin_c_mg", label: "Vitamin C", unit: "mg" },
            { key: "vitamin_k_mcg", label: "Vitamin K", unit: "mcg" },
            { key: "folate_dfe_mcg", label: "Folate", unit: "mcg DFE" },
            { key: "potassium_mg", label: "Potassium", unit: "mg" },
            { key: "iron_mg", label: "Iron", unit: "mg" },
            { key: "calcium_mg", label: "Calcium", unit: "mg" }
        ]);

        function sumSeries(series) {
            return (Array.isArray(series) ? series : []).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
        }

        function rowsFromMap(nutrientsByPlantId) {
            const rows = [];
            if (!nutrientsByPlantId || typeof nutrientsByPlantId.forEach !== "function") return rows;
            nutrientsByPlantId.forEach((value, plantId) => {
                const nutrientRows = value && typeof value.forEach === "function" ? Array.from(value.values()) : (Array.isArray(value) ? value : []);
                for (const row of nutrientRows) rows.push({ ...(row || {}), plant_id: row && row.plant_id !== undefined ? row.plant_id : plantId });
            });
            return rows;
        }

        function normalizeData(data) {
            const source = data && typeof data === "object" ? data : {};
            const available = source.available !== false;
            const values = Array.isArray(source.values) ? source.values : rowsFromMap(source.nutrientsByPlantId);
            const requirements = Array.isArray(source.requirements) ? source.requirements : [];
            const valuesByPlantId = new Map();
            for (const row of values) {
                const plantId = String(row && (row.plant_id ?? row.plantId) || "");
                const key = String(row && row.nutrient_key || "");
                const amount = Number(row && row.amount_per_100g);
                if (!plantId || !key || !Number.isFinite(amount)) continue;
                if (!valuesByPlantId.has(plantId)) valuesByPlantId.set(plantId, new Map());
                valuesByPlantId.get(plantId).set(key, { amountPer100g: Math.max(0, amount), unit: String(row.unit || "") });
            }
            const requirementsByPersona = new Map();
            for (const row of requirements) {
                const persona = String(row && row.persona_key || "");
                const key = String(row && row.nutrient_key || "");
                const amount = Number(row && row.amount_per_day);
                if (!persona || !key || !Number.isFinite(amount)) continue;
                if (!requirementsByPersona.has(persona)) requirementsByPersona.set(persona, new Map());
                requirementsByPersona.get(persona).set(key, { amountPerDay: Math.max(0, amount), unit: String(row.unit || "") });
            }
            return { available, valuesByPlantId, requirementsByPersona };
        }

        function compute(plan, weekly, data) {
            const normalized = normalizeData(data);
            const self = plan && plan.selfSufficiency || {};
            const adults = Math.max(0, Number(self.adults) || 0);
            const children = Math.max(0, Number(self.children) || 0);
            const multiplier = Math.max(0, Number(self.nutritionMultiplier) || 1);
            const totals = new Map(FOCUSED_NUTRIENTS.map(nutrient => [nutrient.key, { requestedAmount: 0, fulfilledAmount: 0 }]));
            const missingCropIds = new Set();
            const missingCropNames = [];
            const perSelfLine = weekly && weekly.perSelfLine;
            if (perSelfLine && typeof perSelfLine.forEach === "function") {
                perSelfLine.forEach(result => {
                    const crop = PlanMath.findCrop(plan, result && result.cropId);
                    const plantId = String(crop && crop.plantId || "");
                    const nutrientValues = normalized.valuesByPlantId.get(plantId);
                    const requestedKg = sumSeries(result && result.target);
                    const fulfilledKg = sumSeries(result && result.usableSupply);
                    if (requestedKg <= EPS && fulfilledKg <= EPS) return;
                    if (!normalized.available) return;
                    if (!plantId || !nutrientValues || !nutrientValues.size) {
                        if (!missingCropIds.has(String(result && result.cropId || ""))) {
                            missingCropIds.add(String(result && result.cropId || ""));
                            missingCropNames.push(crop ? crop.plant || crop.id : String(result && result.cropId || "Unknown crop"));
                        }
                        return;
                    }
                    for (const nutrient of FOCUSED_NUTRIENTS) {
                        const value = nutrientValues.get(nutrient.key);
                        if (!value) continue;
                        const target = totals.get(nutrient.key);
                        target.requestedAmount += requestedKg * 10 * value.amountPer100g;
                        target.fulfilledAmount += fulfilledKg * 10 * value.amountPer100g;
                    }
                });
            }

            const adultReq = normalized.requirementsByPersona.get("adult_19_50") || new Map();
            const childReq = normalized.requirementsByPersona.get("child_1_8") || new Map();
            const rows = FOCUSED_NUTRIENTS.map(nutrient => {
                const requested = totals.get(nutrient.key) || { requestedAmount: 0, fulfilledAmount: 0 };
                const adultAmount = adultReq.get(nutrient.key);
                const childAmount = childReq.get(nutrient.key);
                const requirementAmount = ((Number(adultAmount && adultAmount.amountPerDay) || 0) * adults
                    + (Number(childAmount && childAmount.amountPerDay) || 0) * children) * multiplier * 365;
                return {
                    nutrientKey: nutrient.key,
                    label: nutrient.label,
                    unit: nutrient.unit,
                    requestedAmount: requested.requestedAmount,
                    fulfilledAmount: requested.fulfilledAmount,
                    requirementAmount,
                    requestedCoveragePct: requirementAmount > EPS ? (requested.requestedAmount / requirementAmount) * 100 : 0,
                    fulfilledCoveragePct: requirementAmount > EPS ? (requested.fulfilledAmount / requirementAmount) * 100 : 0
                };
            });
            const warnings = [];
            if (!normalized.available) warnings.push("Nutrition data is not available in this database.");
            for (const name of missingCropNames) warnings.push(`No nutrition mapping for ${name}; excluded from nutrition totals.`);
            return { available: normalized.available, rows, warnings, missingCropNames };
        }

        return { FOCUSED_NUTRIENTS, compute };
    })();

    // -------------------- PlanSchema --------------------
    /**
     * Owns the persisted plan shape, runtime normalization, validation, and crop identity rules.
     */
    const PlanSchema = (() => {
        const DEFAULT_DEMAND_CHANNELS = [
            { id: "farm_store", label: "Farm Store", type: "farm_store", enabled: true }, // CHANGE
            { id: "restaurant_1", label: "Restaurant 1", type: "restaurant", enabled: true }, // CHANGE
            { id: "farmers_market", label: "Farmers Market", type: "market", enabled: true }, // CHANGE
            { id: "wholesale", label: "Wholesale", type: "wholesale", enabled: true } // CHANGE
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
                selfSufficiency: { enabled: true, adults: 0, children: 0, nutritionMultiplier: 1, lines: [] }, // CHANGE: household food planning can be saved while excluded from demand.
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

        function clearUnavailableQuantityUnits(plan) {
            const clearIfUnavailable = line => {
                if (!line || !String(line.unit || "").trim()) return;
                const crop = PlanMath.findCrop(plan, line.cropId);
                if (!crop || !PlanMath.hasPackageUnit(crop, line.unit)) line.unit = ""; // CHANGE: legacy built-in or stale units must be reselected from crop packages.
            };
            for (const line of ((plan && plan.demands) || [])) clearIfUnavailable(line);
            for (const line of ((plan && plan.selfSufficiency && plan.selfSufficiency.lines) || [])) clearIfUnavailable(line);
            for (const component of ((plan && plan.csa && plan.csa.components) || [])) clearIfUnavailable(component);
        } // CHANGE

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
            if (!normalized.selfSufficiency || typeof normalized.selfSufficiency !== "object") normalized.selfSufficiency = {}; // NEW
            normalized.selfSufficiency.enabled = normalized.selfSufficiency.enabled === false ? false : true; // CHANGE
            normalized.selfSufficiency.adults = Math.max(0, Math.trunc(Number(normalized.selfSufficiency.adults) || 0)); // NEW
            normalized.selfSufficiency.children = Math.max(0, Math.trunc(Number(normalized.selfSufficiency.children) || 0)); // NEW
            const nutritionMultiplier = Number(normalized.selfSufficiency.nutritionMultiplier); // NEW
            normalized.selfSufficiency.nutritionMultiplier = Number.isFinite(nutritionMultiplier) && nutritionMultiplier > 0 ? nutritionMultiplier : 1; // NEW
            normalized.selfSufficiency.lines = Array.isArray(normalized.selfSufficiency.lines) ? normalized.selfSufficiency.lines : []; // NEW
            if (!Array.isArray(normalized.demandChannels)) normalized.demandChannels = clonePlain(DEFAULT_DEMAND_CHANNELS);
            for (const channel of normalized.demandChannels) channel.enabled = channel && channel.enabled === false ? false : true; // CHANGE
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
            clearUnavailableQuantityUnits(normalized); // CHANGE

            return normalized;
        }

        function stripRuntimeFields(plan, options) {
            const forTemplate = !!(options && options.forTemplate);
            delete plan.cropFilterId;
            delete plan.__carryoverCrops;
            if (!forTemplate) delete plan.templateBaseYear;

            for (const crop of (plan.crops || [])) {
                delete crop.__actualHarvestWeeklyKg;
                delete crop.__actualHarvestSourceRows; // CHANGE
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
            delete plan.__nutritionData; // NEW: loaded USDA rows are runtime cache, not plan data.
            if (plan.selfSufficiency) delete plan.selfSufficiency.__nutrition; // NEW: analysis output is recalculated and never persisted.
            if (plan.csa) delete plan.csa.__componentValuePerBox;
            return plan;
        }

        function runtimeStrippedCloneInput(plan, options) {
            const source = plan && typeof plan === "object" ? plan : {};
            const copy = Object.assign({}, source);
            if (Array.isArray(source.crops)) copy.crops = source.crops.map(crop => Object.assign({}, crop));
            if (source.selfSufficiency && typeof source.selfSufficiency === "object") copy.selfSufficiency = Object.assign({}, source.selfSufficiency);
            if (source.csa && typeof source.csa === "object") copy.csa = Object.assign({}, source.csa);
            return stripRuntimeFields(copy, options);
        } // CHANGE

        function serializeForPersistence(plan, options) {
            const serialized = normalizeForRuntime(clonePlain(runtimeStrippedCloneInput(plan, options)), plan && plan.year); // CHANGE
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

        function demandLineLabel(line, crop, lineIndex) {
            const plantName = String(crop && crop.plant || "").trim();
            const varietyName = String(crop && crop.variety || "").trim();
            const cropName = plantName && varietyName ? `${plantName} - ${varietyName}` : (plantName || varietyName);
            const unit = String(line && line.unit || "").trim() || "No unit";
            return cropName ? `${cropName}: ${unit}` : `line ${Math.max(0, Number(lineIndex) || 0) + 1}`;
        } // CHANGE: demand validation diagnostics name the crop/unit instead of exposing internal demand ids.

        function selfSufficiencyTarget(field, extra) {
            return { area: "self-sufficiency", field, ...(extra || {}) };
        } // NEW: diagnostics can focus household-planning controls.

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
                errors.push(makeValidation("crop", "crop.reversed_harvest_window", `Set ${cropName} harvest start on or before harvest end.`, { cropId, field: "harvestStart", relatedFields: ["harvestStart", "harvestEnd"], target: cropTarget(crop, "basics", "harvestStart", { relatedFields: ["harvestStart", "harvestEnd"] }) })); // CHANGE
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
                if (!PACKAGE_BASE_OPTIONS.some(option => option.value === baseType) && baseType !== "plants") errors.push(makeValidation("crop", "crop.package_invalid_base_type", `Choose g, kg, ounce, pound, or plant for ${cropName} ${packageLabel} package base.`, { cropId, packageIndex, field: "baseType", target: cropTarget(crop, "packages", "baseType", { packageIndex }) }));
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
                    errors.push(makeValidation("csa", "csa.reversed_date_range", "Set CSA start on or before CSA end.", { field: "start", relatedFields: ["start", "end"], target: csaTarget("start", { relatedFields: ["start", "end"] }) })); // CHANGE
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
                        errors.push(makeValidation("csa", "csa.component_missing_dates", `Enter CSA component dates for ${cropName}.`, { cropId: String(crop.id || ""), componentIndex, field: "start", relatedFields: ["start", "end"], target: csaTarget("start", { componentIndex, relatedFields: ["start", "end"] }) })); // CHANGE
                    }
                    if (PlanMath.hasYmd(from) && PlanMath.hasYmd(to) && from > to) {
                        errors.push(makeValidation("csa", "csa.component_reversed_dates", `Set CSA component start on or before end for ${cropName}.`, { cropId: String(crop.id || ""), componentIndex, field: "start", relatedFields: ["start", "end"], target: csaTarget("start", { componentIndex, relatedFields: ["start", "end"] }) })); // CHANGE
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
                if (channel && channel.enabled === false) continue; // CHANGE
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
                const channel = channels.find(item => String(item && item.id || "") === String(line && line.channelId || "")); // CHANGE
                if (channel && channel.enabled === false) continue; // CHANGE
                const crop = PlanMath.findCrop(plan, line && line.cropId);
                const lineLabel = demandLineLabel(line, crop, lineIndex); // CHANGE
                if (!id) errors.push(makeValidation("demand", "demand.line_missing_id", `Demand line ${lineIndex + 1} needs an id.`, { field: "id", target: demandTarget("id", { lineIndex }) })); // CHANGE
                else if (demandIds.has(id)) errors.push(makeValidation("demand", "demand.line_duplicate_id", `Use a unique demand line id for ${lineLabel}.`, { field: "id", target: demandTarget("id", { lineId: id, lineIndex }) })); // CHANGE
                else demandIds.add(id);
                if (!channelIds.has(String(line && line.channelId || ""))) errors.push(makeValidation("demand", "demand.line_missing_channel", `Choose a valid channel for ${lineLabel}.`, { field: "channelId", target: demandTarget("channelId", { lineId: id, lineIndex }) })); // CHANGE
                if (!crop) errors.push(makeValidation("demand", "demand.line_missing_crop", `Choose a crop for ${lineLabel}.`, { field: "cropId", target: demandTarget("cropId", { lineId: id, lineIndex }) })); // CHANGE
                if (!Number.isFinite(Number(line && line.qty)) || Number(line.qty) <= 0) errors.push(makeValidation("demand", "demand.line_invalid_quantity", `Enter quantity greater than 0 for ${lineLabel}.`, { field: "qty", target: demandTarget("qty", { lineId: id, lineIndex }) })); // CHANGE
                if (!DEMAND_FREQUENCIES.includes(String(line && line.frequency || ""))) errors.push(makeValidation("demand", "demand.line_invalid_frequency", `Choose a valid frequency for ${lineLabel}.`, { field: "frequency", target: demandTarget("frequency", { lineId: id, lineIndex }) })); // CHANGE
                if (!Number.isInteger(Number(line && line.everyN)) || Number(line.everyN) < 1) errors.push(makeValidation("demand", "demand.line_invalid_every_n", `Enter every value greater than 0 for ${lineLabel}.`, { field: "everyN", target: demandTarget("everyN", { lineId: id, lineIndex }) })); // CHANGE
                if (!DEMAND_PRIORITIES.includes(String(line && line.priority || ""))) errors.push(makeValidation("demand", "demand.line_invalid_priority", `Choose a valid priority for ${lineLabel}.`, { field: "priority", target: demandTarget("priority", { lineId: id, lineIndex }) })); // CHANGE
                if (!PlanMath.hasYmd(line && line.from) || !PlanMath.hasYmd(line && line.to)) errors.push(makeValidation("demand", "demand.line_missing_dates", `Enter demand dates for ${lineLabel}.`, { field: "from", relatedFields: ["from", "to"], target: demandTarget("from", { lineId: id, lineIndex, relatedFields: ["from", "to"] }) })); // CHANGE
                if (PlanMath.hasYmd(line && line.from) && PlanMath.hasYmd(line && line.to) && line.from > line.to) errors.push(makeValidation("demand", "demand.line_reversed_dates", `Set demand start on or before end for ${lineLabel}.`, { field: "from", relatedFields: ["from", "to"], target: demandTarget("from", { lineId: id, lineIndex, relatedFields: ["from", "to"] }) })); // CHANGE
                if (crop && !Number.isFinite(PlanMath.resolveUnitToKgPerUnit(crop, line && line.unit))) errors.push(makeValidation("demand", "demand.line_unresolved_unit", `Choose a valid unit for ${lineLabel}.`, { cropId: String(crop.id || ""), field: "unit", target: demandTarget("unit", { lineId: id, lineIndex }) })); // CHANGE
            }
            return errors;
        }

        function validateSelfSufficiency(plan) {
            const errors = [];
            const self = plan && plan.selfSufficiency || {};
            if (self.enabled === false) return errors; // CHANGE
            const lines = Array.isArray(self.lines) ? self.lines : [];
            const lineIds = new Set();
            if ((Number(self.adults) || 0) < 0) errors.push(makeValidation("self-sufficiency", "self.invalid_adults", "Enter adults as 0 or greater.", { field: "adults", target: selfSufficiencyTarget("adults") })); // NEW
            if ((Number(self.children) || 0) < 0) errors.push(makeValidation("self-sufficiency", "self.invalid_children", "Enter children as 0 or greater.", { field: "children", target: selfSufficiencyTarget("children") })); // NEW
            if (!Number.isFinite(Number(self.nutritionMultiplier)) || Number(self.nutritionMultiplier) <= 0) errors.push(makeValidation("self-sufficiency", "self.invalid_multiplier", "Enter nutrition multiplier greater than 0.", { field: "nutritionMultiplier", target: selfSufficiencyTarget("nutritionMultiplier") })); // NEW
            for (const [lineIndex, line] of lines.entries()) {
                const id = String(line && line.id || "").trim();
                const crop = PlanMath.findCrop(plan, line && line.cropId);
                if (!id) errors.push(makeValidation("self-sufficiency", "self.line_missing_id", "Self Sufficiency line needs an id.", { field: "id", target: selfSufficiencyTarget("id", { selfLineIndex: lineIndex }) })); // NEW
                else if (lineIds.has(id)) errors.push(makeValidation("self-sufficiency", "self.line_duplicate_id", `Use a unique Self Sufficiency line id: ${id}.`, { field: "id", target: selfSufficiencyTarget("id", { selfLineId: id, selfLineIndex: lineIndex }) })); // NEW
                else lineIds.add(id);
                if (!crop) errors.push(makeValidation("self-sufficiency", "self.line_missing_crop", `Choose a crop for Self Sufficiency line ${id || "unknown"}.`, { field: "cropId", target: selfSufficiencyTarget("cropId", { selfLineId: id, selfLineIndex: lineIndex }) })); // NEW
                if (!Number.isFinite(Number(line && line.qty)) || Number(line.qty) <= 0) errors.push(makeValidation("self-sufficiency", "self.line_invalid_quantity", `Enter quantity greater than 0 for Self Sufficiency line ${id || "unknown"}.`, { field: "qty", target: selfSufficiencyTarget("qty", { selfLineId: id, selfLineIndex: lineIndex }) })); // NEW
                if (!DEMAND_FREQUENCIES.includes(String(line && line.frequency || ""))) errors.push(makeValidation("self-sufficiency", "self.line_invalid_frequency", `Choose a valid frequency for Self Sufficiency line ${id || "unknown"}.`, { field: "frequency", target: selfSufficiencyTarget("frequency", { selfLineId: id, selfLineIndex: lineIndex }) })); // NEW
                if (!Number.isInteger(Number(line && line.everyN)) || Number(line.everyN) < 1) errors.push(makeValidation("self-sufficiency", "self.line_invalid_every_n", `Enter every value greater than 0 for Self Sufficiency line ${id || "unknown"}.`, { field: "everyN", target: selfSufficiencyTarget("everyN", { selfLineId: id, selfLineIndex: lineIndex }) })); // NEW
                if (!PlanMath.hasYmd(line && line.from) || !PlanMath.hasYmd(line && line.to)) errors.push(makeValidation("self-sufficiency", "self.line_missing_dates", `Enter Self Sufficiency dates for line ${id || "unknown"}.`, { field: "from", relatedFields: ["from", "to"], target: selfSufficiencyTarget("from", { selfLineId: id, selfLineIndex: lineIndex, relatedFields: ["from", "to"] }) })); // CHANGE
                if (PlanMath.hasYmd(line && line.from) && PlanMath.hasYmd(line && line.to) && line.from > line.to) errors.push(makeValidation("self-sufficiency", "self.line_reversed_dates", `Set Self Sufficiency start on or before end for line ${id || "unknown"}.`, { field: "from", relatedFields: ["from", "to"], target: selfSufficiencyTarget("from", { selfLineId: id, selfLineIndex: lineIndex, relatedFields: ["from", "to"] }) })); // CHANGE
                if (crop && !Number.isFinite(PlanMath.resolveUnitToKgPerUnit(crop, line && line.unit))) errors.push(makeValidation("self-sufficiency", "self.line_unresolved_unit", `Choose a valid unit for Self Sufficiency line ${id || "unknown"}.`, { cropId: String(crop.id || ""), field: "unit", target: selfSufficiencyTarget("unit", { selfLineId: id, selfLineIndex: lineIndex }) })); // NEW
            }
            return errors;
        } // NEW: household demand validates separately from sales-channel demand.

        function validate(plan) {
            const errors = [];
            const crops = (plan && plan.crops) || [];
            for (const crop of crops) errors.push(...validateCrop(crop));

            const duplicate = findFirstDuplicateCrop(plan);
            if (duplicate) errors.push(makeValidation("crop", "crop.duplicate_identity", "Each plant/variety can appear only once in a year plan.", { cropId: String(duplicate.second && duplicate.second.id || ""), field: "varietyId", target: cropTarget(duplicate.second, "basics", "varietyId") }));
            errors.push(...validateSelfSufficiency(plan)); // NEW
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
            clearUnavailableQuantityUnits, // CHANGE
            makeCropIdentityKey,
            getCropIdentityKey,
            findDuplicateCrop,
            findFirstDuplicateCrop,
            setCropHarvestWindowSource,
            inferMethodCategoryFromMethodId,
            normalizeCropMethodFieldsForRuntime,
            validateCrop,
            validateSelfSufficiency,
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

        function normalizeDraftRecord(record, year) {
            if (!record || typeof record !== "object" || Array.isArray(record)) return null;
            const rawPlan = (record.plan && typeof record.plan === "object" && !Array.isArray(record.plan)) ? record.plan : null;
            if (!rawPlan) return null;
            return {
                plan: PlanSchema.normalizeForRuntime(PlanSchema.clonePlain(rawPlan), year),
                updatedAt: String(record.updatedAt || "")
            };
        } // CHANGE: draft metadata stays outside the committed plan payload.

        function loadDraftForYear(moduleCell, year) {
            return normalizeDraftRecord(readJsonMap(moduleCell, Env.ATTRS.PLAN_DRAFTS_ATTR)[String(year)], year);
        } // CHANGE

        function saveDraftForYear(moduleCell, year, plan) {
            const drafts = readJsonMap(moduleCell, Env.ATTRS.PLAN_DRAFTS_ATTR);
            const record = {
                plan: PlanSchema.serializeForPersistence(plan),
                updatedAt: new Date().toISOString()
            };
            drafts[String(year)] = record;
            writeJsonMap(moduleCell, Env.ATTRS.PLAN_DRAFTS_ATTR, drafts);
            return normalizeDraftRecord(record, year);
        } // CHANGE

        function deleteDraftForYear(moduleCell, year) {
            const drafts = readJsonMap(moduleCell, Env.ATTRS.PLAN_DRAFTS_ATTR);
            delete drafts[String(year)];
            writeJsonMap(moduleCell, Env.ATTRS.PLAN_DRAFTS_ATTR, drafts);
        } // CHANGE

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
            for (const selfLine of (plan.selfSufficiency && plan.selfSufficiency.lines || [])) {
                shiftFieldYear(selfLine, "from", deltaYears); // NEW: self-use template dates roll forward with the rest of the plan.
                shiftFieldYear(selfLine, "to", deltaYears); // NEW
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
            for (const selfLine of (rekeyed.selfSufficiency && rekeyed.selfSufficiency.lines || [])) {
                selfLine.cropId = idMap.has(selfLine.cropId) ? idMap.get(selfLine.cropId) : ""; // NEW: template self-use rows keep pointing at the copied crop rows.
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
            loadDraftForYear, // CHANGE
            saveDraftForYear, // CHANGE
            deleteDraftForYear, // CHANGE
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

        function cellId(cell) {
            return String(cell && (typeof cell.getId === "function" ? cell.getId() : cell.id) || "");
        } // CHANGE

        function nonGenericBedName(tilerGroup) {
            const parent = tilerGroup && (tilerGroup.parent || tilerGroup.getParent && tilerGroup.getParent());
            const raw = String(
                DiagramStore.getCellAttr(tilerGroup, "bed_name", "")
                || DiagramStore.getCellAttr(parent, "label", "")
                || DiagramStore.getCellAttr(parent, "name", "")
                || ""
            ).trim();
            return raw && raw.toLocaleLowerCase() !== "garden bed" ? raw : "";
        } // CHANGE

        function plantingSourceLabel(tilerGroup, count) {
            const plant = String(DiagramStore.getCellAttr(tilerGroup, "plant_name", "") || "").trim();
            const variety = String(DiagramStore.getCellAttr(tilerGroup, "variety_name", "") || "").trim();
            const bed = nonGenericBedName(tilerGroup);
            const names = [plant, variety].filter(Boolean).join(" / ") || String(DiagramStore.getCellAttr(tilerGroup, "label", "") || "Planting").trim();
            return `${names}${bed ? ` (${bed})` : ""} ${Math.max(0, Math.trunc(Number(count) || 0))} plants`;
        } // CHANGE

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
            const actualHarvestSourceRowsByCropKey = new Map(); // CHANGE
            const ensureSeries = key => {
                if (!actualHarvestSeriesByCropKey.has(key)) actualHarvestSeriesByCropKey.set(key, Array(weekStarts.length).fill(0));
                return actualHarvestSeriesByCropKey.get(key);
            };
            const ensureSourceRows = key => { // CHANGE
                if (!actualHarvestSourceRowsByCropKey.has(key)) actualHarvestSourceRowsByCropKey.set(key, []);
                return actualHarvestSourceRowsByCropKey.get(key);
            }; // CHANGE

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
                const sourceSeries = Array(weekStarts.length).fill(0); // CHANGE
                PlanMath.addTotalKgAcrossWindowProrated(
                    ensureSeries(key),
                    weekStarts,
                    start,
                    end,
                    count * kgPerPlant,
                    year
                );
                PlanMath.addTotalKgAcrossWindowProrated( // CHANGE
                    sourceSeries,
                    weekStarts,
                    start,
                    end,
                    count * kgPerPlant,
                    year
                ); // CHANGE
                ensureSourceRows(key).push({ // CHANGE
                    sourceId: cellId(tilerGroup),
                    cellId: cellId(tilerGroup),
                    cell: tilerGroup,
                    label: plantingSourceLabel(tilerGroup, count),
                    plantCount: count,
                    harvestStart: start,
                    harvestEnd: end,
                    weeklyKg: sourceSeries
                }); // CHANGE
            }

            return {
                actualPlantsByCropKey,
                actualHarvestSeriesByCropKey,
                actualHarvestDateRangeByCropKey,
                actualHarvestSourceRowsByCropKey, // CHANGE
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

            for (const selfLine of ((plan && plan.selfSufficiency && plan.selfSufficiency.lines) || [])) {
                if (!selfLine || selfLine.cropId !== crop.id) continue;
                if (previousLegacyEnd && String(selfLine.to || "") === previousLegacyEnd) selfLine.to = previousHarvestEnd; // NEW
                if (shouldAutoReplaceDate(selfLine.from, crop.__sync_lastHarvestStart) && PlanMath.hasYmd(harvestStart)) {
                    selfLine.from = harvestStart; // NEW: self-use windows track the crop availability window when sync is enabled.
                }
                selfLine.from = clampYmdIntoRange(selfLine.from, harvestStart, availableEnd); // NEW

                const lastAutomaticEnd = crop.__sync_lastAvailEnd || crop.__sync_lastHarvestEnd;
                const looksAutomatic = PlanMath.hasYmd(harvestEnd)
                    && PlanMath.hasYmd(selfLine.to)
                    && String(selfLine.to) === String(harvestEnd);
                if (shouldAutoReplaceDate(selfLine.to, lastAutomaticEnd) || looksAutomatic) {
                    if (PlanMath.hasYmd(availableEnd)) selfLine.to = availableEnd;
                    else if (PlanMath.hasYmd(harvestEnd)) selfLine.to = harvestEnd;
                }
                selfLine.to = clampYmdIntoRange(selfLine.to, harvestStart, availableEnd); // NEW
            }

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
                crop.__actualHarvestSourceRows = diagramFacts.actualHarvestSourceRowsByCropKey.get(key) || []; // CHANGE
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
                    actualHarvestWeeklyKg: crop.__actualHarvestWeeklyKg,
                    actualHarvestSourceRows: crop.__actualHarvestSourceRows // CHANGE
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
            state.selfSufficiencyExpanded = top.selfSufficiencyExpanded === true; // NEW: preserve the self-use strip state.
            state.demandExpanded = top.demandExpanded === false ? false : true;
            state.cropPlanExpanded = top.cropPlanExpanded === false ? false : true;
            state.planCheckExpanded = top.planCheckExpanded === true;
            state.collapsedDemandChannelIds = new Set(Array.isArray(prefs.collapsedDemandChannelIds) ? prefs.collapsedDemandChannelIds.map(String).filter(Boolean) : []);
            state.collapsedDemandLineIds = new Set(Array.isArray(prefs.collapsedDemandLineIds) ? prefs.collapsedDemandLineIds.map(String).filter(Boolean) : []);
            state.collapsedSelfSufficiencyLineIds = new Set(Array.isArray(prefs.collapsedSelfSufficiencyLineIds) ? prefs.collapsedSelfSufficiencyLineIds.map(String).filter(Boolean) : []);
            state.pickerTreeExpanded = prefs.pickerTreeExpanded && typeof prefs.pickerTreeExpanded === "object" ? PlanSchema.clonePlain(prefs.pickerTreeExpanded) : {}; // CHANGE
            return state;
        }

        function createState(plan, preferences) {
            const crops = (plan && plan.crops) || [];
            return applyCollapsePreferences({
                selectedCropId: resolveSelectedCropId(crops, "", 0),
                activeTab: "basics",
                csaExpanded: false,
                selfSufficiencyExpanded: false,
                demandExpanded: true,
                planCheckScope: "combined",
                collapsedDemandChannelIds: new Set(),
                collapsedDemandLineIds: new Set(),
                collapsedSelfSufficiencyLineIds: new Set(),
                pickerTreeExpanded: {}, // CHANGE
                collapsedDiagnosticsSectionIds: new Set(), // NEW: question-mark help sections persist only for the active dialog session.
                cropPlanExpanded: true,
                planCheckExpanded: false,
                hadBlockingErrors: false,
                hadCsaErrors: false,
                hadSelfSufficiencyErrors: false,
                hadDemandErrors: false,
                baselineSnapshot: "",
                validationState: "idle",
                lastSavedAt: null,
                lastDraftSavedAt: null, // CHANGE
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

        function summarizeSelfSufficiencyWeekly(selfWeekly) {
            const sum = values => (Array.isArray(values) ? values : []).reduce((total, value) => total + Math.max(0, Number(value) || 0), 0);
            return {
                targetKg: sum(selfWeekly && selfWeekly.target),
                usableSupplyKg: sum(selfWeekly && selfWeekly.usableSupply),
                shortKg: sum(selfWeekly && selfWeekly.short),
                groceryValue: sum(selfWeekly && selfWeekly.groceryValue),
                fulfilledGroceryValue: sum(selfWeekly && selfWeekly.fulfilledGroceryValue)
            };
        } // NEW: household grocery value mirrors revenue summaries but stays separate from sales.

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

        function syncExpansionState(state, dashboard, csaErrors, demandErrors, selfSufficiencyErrors) {
            const hasBlockingErrors = !!(dashboard && dashboard.validationErrors && dashboard.validationErrors.length);
            const hasCsaErrors = !!(csaErrors && csaErrors.length);
            const hasDemandErrors = !!(demandErrors && demandErrors.length);
            const hasSelfSufficiencyErrors = !!(selfSufficiencyErrors && selfSufficiencyErrors.length);
            const changes = { planCheckChanged: false, csaChanged: false, demandChanged: false, selfSufficiencyChanged: false };
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
            if (hasSelfSufficiencyErrors && !state.hadSelfSufficiencyErrors && !state.selfSufficiencyExpanded) {
                state.selfSufficiencyExpanded = true;
                changes.selfSufficiencyChanged = true;
            }
            state.hadBlockingErrors = hasBlockingErrors;
            state.hadCsaErrors = hasCsaErrors;
            state.hadDemandErrors = hasDemandErrors;
            state.hadSelfSufficiencyErrors = hasSelfSufficiencyErrors;
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
                    errors.push({ scope: "crop", code: "crop.missing_harvest_window", message: `Enter a harvest window for ${cropName}.`, cropId: String(crop.id || ""), field, relatedFields: ["harvestStart", "harvestEnd"], target: { area: "crop", cropId: String(crop.id || ""), tab: "basics", field, relatedFields: ["harvestStart", "harvestEnd"] } }); // CHANGE
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
            const selfSufficiencyMetric = summarizeSelfSufficiencyWeekly(weekly && weekly.selfSufficiency);
            const selfSufficiencyNutrition = NutritionPlanner.compute(plan, weekly, settings.nutritionData || plan.__nutritionData || {});
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
                    const selfDemandKg = Math.max(0, Number(weekly.selfSufficiency && weekly.selfSufficiency.target[i]) || 0);
                    const selfShortKg = Math.max(0, Number(weekly.selfSufficiency && weekly.selfSufficiency.short[i]) || 0);
                    if (channelShortKg + csaShortKg + selfShortKg <= EPS) continue;
                    shortageWeeks.push({
                        week: String(weekly.weeks[i] && weekly.weeks[i].iso || ""),
                        selfDemandKg, selfShortKg, channelDemandKg, channelShortKg, csaDemandKg, csaShortKg
                    });
                }
            }
            const diagnostics = uniqueMessages([
                ...((runtime && runtime.warnings) || []),
                ...validationErrors.map(validationMessage),
                ...((selfSufficiencyNutrition && selfSufficiencyNutrition.warnings) || []),
                ...((plan && plan.selfSufficiency && plan.selfSufficiency.enabled !== false && plan.selfSufficiency.lines || []).length && !((Number(plan.selfSufficiency.adults) || 0) + (Number(plan.selfSufficiency.children) || 0)) ? ["Self Sufficiency has crop demand lines but household size is zero. Nutrition coverage will be 0%."] : []), // CHANGE
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
                selfSufficiencyMetric,
                selfSufficiencyNutrition,
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
            summarizeSelfSufficiencyWeekly,
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
            Array.isArray(source.surplus) ? source.surplus.length : 0,
            Array.isArray(source.sourcesByWeek) ? source.sourcesByWeek.length : 0 // CHANGE
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
                bars,
                sources: source.sourcesByWeek && source.sourcesByWeek[index] || null // CHANGE
            });
        }
        return rows;
    }

    function cropTimelineHasSources(sourceModel) {
        if (!sourceModel) return false;
        if ((sourceModel.plantings || []).length) return true;
        return (sourceModel.demandGroups || []).some(group => group && group.rows && group.rows.length);
    } // CHANGE

    function formatSourceKg(value) {
        const kg = Math.max(0, Number(value) || 0);
        return `${kg >= 10 ? kg.toFixed(1) : kg.toFixed(2)} kg`;
    } // CHANGE

    function sourceMetricText(row, fields) {
        return fields
            .map(item => ({ label: item[0], value: Math.max(0, Number(row && row[item[1]]) || 0) }))
            .filter(item => item.value > EPS)
            .map(item => `${item.label} ${formatSourceKg(item.value)}`)
            .join(" | ");
    } // CHANGE

    function closeCropTimelinePopover(hostEl) {
        if (hostEl && typeof hostEl.__ypCloseTimelinePopover === "function") hostEl.__ypCloseTimelinePopover();
    } // CHANGE

    function renderCropTimelineSourcePopover(hostEl, anchor, row, options) {
        closeCropTimelinePopover(hostEl);
        const sourceModel = row && row.sources;
        if (!cropTimelineHasSources(sourceModel)) return;
        const popover = document.createElement("div");
        popover.className = "yp-crop-timeline-source-popover";
        popover.setAttribute("role", "dialog");
        popover.setAttribute("aria-label", `Sources for week of ${row.week && row.week.iso || ""}`);
        const title = document.createElement("div");
        title.className = "yp-crop-timeline-source-title";
        title.textContent = `Week of ${row.week && row.week.iso || "week"}`;
        popover.appendChild(title);

        function addSection(label, rows, kind) {
            if (!rows || !rows.length) return;
            const section = document.createElement("div");
            section.className = "yp-crop-timeline-source-section";
            const heading = document.createElement("div");
            heading.className = "yp-crop-timeline-source-heading";
            heading.textContent = label;
            section.appendChild(heading);
            for (const sourceRow of rows) {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "yp-crop-timeline-source-row";
                button.dataset.sourceKind = kind;
                const name = document.createElement("span");
                name.className = "yp-crop-timeline-source-name";
                name.textContent = sourceRow.label || "Source";
                const metrics = document.createElement("span");
                metrics.className = "yp-crop-timeline-source-metrics";
                metrics.textContent = kind === "planting"
                    ? sourceMetricText(sourceRow, [["Harvested", "harvestedKg"], ["Carried", "carriedInKg"], ["Used", "usedKg"], ["Ending", "endingKg"], ["Expired", "expiredKg"]])
                    : sourceMetricText(sourceRow, [["Target", "targetKg"], ["Fulfilled", "fulfilledKg"], ["Short", "shortKg"]]);
                button.appendChild(name);
                button.appendChild(metrics);
                button.addEventListener("click", event => {
                    event.preventDefault();
                    event.stopPropagation();
                    closeCropTimelinePopover(hostEl);
                    if (options && typeof options.onActivateSource === "function") options.onActivateSource(sourceRow, kind, row);
                });
                section.appendChild(button);
            }
            popover.appendChild(section);
        }

        addSection("Plantings", sourceModel.plantings || [], "planting");
        for (const group of (sourceModel.demandGroups || [])) addSection(group.label, group.rows || [], group.kind || "demand");
        anchor.appendChild(popover);
        const outside = event => {
            if (popover.contains(event.target) || anchor.contains(event.target)) return;
            closeCropTimelinePopover(hostEl);
        };
        hostEl.__ypCloseTimelinePopover = () => {
            document.removeEventListener("mousedown", outside, true);
            if (popover.parentNode) popover.parentNode.removeChild(popover);
            hostEl.__ypCloseTimelinePopover = null;
        };
        setTimeout(() => document.addEventListener("mousedown", outside, true), 0);
    } // CHANGE

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

    function harvestMarkerText(item) {
        return `${item.label === "S" ? "Harvest start" : "Harvest end"}: ${item.ymd}`;
    } // CHANGE: marker popovers and accessible labels share one exact harvest-date formatter.

    function renderCropTimeline(hostEl, weekStarts, cropWeekly, crop, options) {
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
            return false; // CHANGE
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
            week.dataset.weekIndex = String(index); // CHANGE
            const monthLabel = cropTimelineMonthLabel(row.week, index > 0 ? rows[index - 1].week : null);
            if (monthLabel) {
                week.dataset.monthStart = "true";
                week.dataset.monthLabel = monthLabel;
            }
            if (cropTimelineHasSources(row.sources)) { // CHANGE
                week.tabIndex = 0;
                week.setAttribute("role", "button");
                week.setAttribute("aria-label", `Show sources for week of ${row.week && row.week.iso || "week"}`);
                week.dataset.hasSources = "true";
                const openSources = event => {
                    if (event) {
                        event.preventDefault();
                        event.stopPropagation();
                    }
                    renderCropTimelineSourcePopover(hostEl, week, row, options || {});
                };
                week.addEventListener("click", openSources);
                week.addEventListener("keydown", event => {
                    if (event.key === "Enter" || event.key === " ") openSources(event);
                    else if (event.key === "Escape") closeCropTimelinePopover(hostEl);
                });
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
                const markerText = markers.map(harvestMarkerText);
                const popover = document.createElement("div");
                popover.className = "yp-harvest-marker-popover";
                popover.id = `yp-harvest-marker-popover-${index}-${markers.map(item => item.label).join("-")}`;
                popover.textContent = markerText.join("\n");
                marker.tabIndex = 0;
                marker.setAttribute("aria-label", markerText.join("; "));
                marker.setAttribute("aria-describedby", popover.id);
                marker.appendChild(popover); // CHANGE: harvest-window date popover opens on marker hover/focus.
                week.appendChild(marker); // harvest-window marker
            }
            hostEl.appendChild(week);
        }
        let restoredOpen = false; // CHANGE
        if (options && options.openWeekIndex != null) { // CHANGE
            const requested = Math.max(0, Math.trunc(Number(options.openWeekIndex) || 0));
            const targetWeek = hostEl.querySelector(`.yp-crop-timeline-week[data-week-index="${requested}"][data-has-sources="true"]`);
            if (targetWeek) { targetWeek.click(); restoredOpen = true; } // CHANGE
        }
        return restoredOpen; // CHANGE
    }

    // ------------ openPlanModal --------------
    // -------------------- Dashboard modal controller --------------------
    /** Owns dashboard DOM construction, event orchestration, persistence, and session-scoped UI state. */
    const YearPlanModalController = (() => {
        function parseStoredDate(value) {
            const date = value ? new Date(value) : null;
            return date && Number.isFinite(date.getTime()) ? date : null;
        } // CHANGE

        function open(moduleCell, year) {
            function loadWorkingYear(targetYear) {
                const committed = PlanRepository.loadPlanForYear(moduleCell, targetYear);
                const draft = PlanRepository.loadDraftForYear(moduleCell, targetYear);
                const workingPlan = draft ? draft.plan : (committed || PlanSchema.createEmptyPlan(targetYear));
                return {
                    plan: PlanSchema.normalizeForRuntime(workingPlan, targetYear),
                    loadedCommitted: !!committed,
                    loadedDraft: !!draft,
                    draftUpdatedAt: draft && draft.updatedAt || ""
                };
            } // CHANGE

            let currentYear = Number(year);
            const initialWorkingYear = loadWorkingYear(currentYear); // CHANGE
            let loadedExistingForCurrentYear = initialWorkingYear.loadedCommitted; // CHANGE
            let loadedDraftForCurrentYear = initialWorkingYear.loadedDraft; // CHANGE
            const plan = initialWorkingYear.plan; // CHANGE
            const state = YearPlanDashboard.createState(plan, YearPlanCollapsePreferences.load(moduleCell, currentYear));
            const initialReturnContext = YEAR_PLAN_RETURN_CONTEXTS.get(yearPlanReturnContextKey(moduleCell, currentYear)); // CHANGE
            if (initialReturnContext && (plan.crops || []).some(crop => String(crop && crop.id || "") === String(initialReturnContext.cropId || ""))) { // CHANGE
                state.selectedCropId = String(initialReturnContext.cropId || "");
                state.activeTab = String(initialReturnContext.activeTab || "basics");
                state.pendingTimelineWeekIndex = Number(initialReturnContext.weekIndex);
            } // CHANGE
            state.lastDraftSavedAt = parseStoredDate(initialWorkingYear.draftUpdatedAt); // CHANGE
            const session = SessionController.start(moduleCell, currentYear, plan);
            const varietyCache = new Map();
            const methodCache = new Map();
            let addCropPickerNodes = []; // CHANGE
            let addCropOptionsLoadVersion = 0;
            let pendingAddCropMessage = "";
            let runtime = null;
            let dashboard = null;
            let refreshTimer = null;
            let pendingRefreshOptions = null;
            let editorRefs = {};
            let demandRefs = {};
            let csaRefs = {};
            let chartHitModel = null;
            let nutritionLoadKey = "";
            let nutritionLoadVersion = 0;
            const visibleChartSeriesIds = new Set(PLAN_CHART_SERIES.map(series => series.id));

            function pruneCollapseState() {
                const channelIds = new Set((plan.demandChannels || []).map(channel => String(channel && channel.id || "")).filter(Boolean));
                const lineIds = new Set((plan.demands || []).map(line => String(line && line.id || "")).filter(Boolean));
                const selfLineIds = new Set(((plan.selfSufficiency && plan.selfSufficiency.lines) || []).map(line => String(line && line.id || "")).filter(Boolean));
                for (const channelId of Array.from(state.collapsedDemandChannelIds || [])) {
                    if (!channelIds.has(String(channelId))) state.collapsedDemandChannelIds.delete(channelId);
                }
                for (const lineId of Array.from(state.collapsedDemandLineIds || [])) {
                    if (!lineIds.has(String(lineId))) state.collapsedDemandLineIds.delete(lineId);
                }
                for (const lineId of Array.from(state.collapsedSelfSufficiencyLineIds || [])) {
                    if (!selfLineIds.has(String(lineId))) state.collapsedSelfSufficiencyLineIds.delete(lineId);
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
            card.style.cssText = "position:relative;width:1180px;max-width:97vw;height:92vh;background:#fff;border:1px solid #777;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.25);display:flex;flex-direction:column;overflow:hidden;font:12px Arial,sans-serif;"; // CHANGE: card-local overlay positioning needs a containing block.
            const style = document.createElement("style");
            style.textContent = `
                .yp-modal-card{--yp-primary:${YP_COLORS.primary};--yp-primary-bg:${YP_COLORS.primaryBg};--yp-primary-soft:${YP_COLORS.primarySoft};--yp-primary-dark:${YP_COLORS.primaryDark};--yp-success:${YP_COLORS.success};--yp-success-bg:${YP_COLORS.successBg};--yp-danger:${YP_COLORS.danger};--yp-danger-bg:${YP_COLORS.dangerBg};--yp-warning:${YP_COLORS.warning};--yp-warning-bg:${YP_COLORS.warningBg};--yp-neutral-900:${YP_COLORS.neutral900};--yp-neutral-700:${YP_COLORS.neutral700};--yp-neutral-500:${YP_COLORS.neutral500};--yp-neutral-300:${YP_COLORS.neutral300};--yp-neutral-100:${YP_COLORS.neutral100}}
                .yp-dashboard-grid{display:grid;grid-template-columns:minmax(340px,32%) minmax(0,1fr);gap:12px;align-items:start}
                .yp-scroll-body > * + *{margin-top:10px}
                .yp-strip-box{box-sizing:border-box;border:1px solid var(--yp-neutral-300);border-radius:8px;background:#fff;overflow:hidden}
                .yp-strip-header{box-sizing:border-box;display:flex;align-items:center;gap:10px;width:100%;padding:9px 12px 9px 10px;border:0;background:var(--yp-neutral-100);cursor:pointer;text-align:left;font:12px Arial,sans-serif}
                .yp-strip-title{flex:0 0 auto;font-weight:700;font-size:13px}
                .yp-strip-controls{flex:0 0 auto;display:flex;align-items:center;gap:8px} /* CHANGE */
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
                .yp-crop-timeline-week[data-has-sources="true"]{cursor:pointer}
                .yp-crop-timeline-week[data-has-sources="true"]:focus-visible{outline:2px solid var(--yp-primary);outline-offset:2px}
                .yp-crop-timeline-week[data-month-start="true"]{border-left:1px solid var(--yp-neutral-300)}
                .yp-crop-timeline-week[data-month-start="true"]::after{content:attr(data-month-label);position:absolute;left:1px;bottom:-14px;color:var(--yp-neutral-700);font-size:9px;line-height:1;white-space:nowrap}
                .yp-crop-timeline-bar{position:absolute;left:50%;bottom:0;box-sizing:border-box;width:100%;transform:translateX(-50%);min-width:3px;border-radius:2px 2px 0 0}
                .yp-crop-timeline-bar-demand{border:1px solid #c59b18;background:#ffd95a}
                .yp-crop-timeline-bar-harvest{border:2px solid #0c3f1a;background:transparent;box-shadow:inset 0 0 0 1px rgba(12,63,26,.36),0 0 0 1px rgba(255,255,255,.78)}
                .yp-crop-timeline-bar-inventory{border:1px solid #4f8b57;background:#62a96b}
                .yp-crop-timeline-source-popover{position:absolute;z-index:6;left:50%;top:-8px;transform:translate(-50%,-100%);box-sizing:border-box;width:300px;max-width:min(82vw,340px);max-height:260px;overflow:auto;padding:8px;border:1px solid var(--yp-neutral-700);border-radius:7px;background:#fff;color:var(--yp-neutral-900);box-shadow:0 8px 22px rgba(0,0,0,.22);font:12px Arial,sans-serif;text-align:left}
                .yp-crop-timeline-source-popover::after{content:"";position:absolute;left:50%;bottom:-5px;transform:translateX(-50%) rotate(45deg);width:8px;height:8px;border-right:1px solid var(--yp-neutral-700);border-bottom:1px solid var(--yp-neutral-700);background:#fff}
                .yp-crop-timeline-source-title{font-weight:700;margin-bottom:6px}
                .yp-crop-timeline-source-section + .yp-crop-timeline-source-section{margin-top:7px;padding-top:6px;border-top:1px solid var(--yp-neutral-300)}
                .yp-crop-timeline-source-heading{font-size:11px;font-weight:700;color:var(--yp-neutral-700);margin-bottom:3px}
                .yp-crop-timeline-source-row{display:block;width:100%;box-sizing:border-box;margin:2px 0;padding:5px 6px;border:0;border-radius:5px;background:#fff;text-align:left;color:var(--yp-neutral-900);font:12px Arial,sans-serif;cursor:pointer}
                .yp-crop-timeline-source-row:hover,.yp-crop-timeline-source-row:focus{background:var(--yp-primary-bg);outline:1px solid var(--yp-primary)}
                .yp-crop-timeline-source-name{display:block;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
                .yp-crop-timeline-source-metrics{display:block;margin-top:2px;color:var(--yp-neutral-700);font-size:10px;line-height:1.35;white-space:normal}
                .yp-harvest-marker{position:absolute;left:50%;top:-13px;bottom:0;width:0;border-left:2px solid #7a3f12;transform:translateX(-1px);pointer-events:auto;outline:none}
                .yp-harvest-marker::before{content:attr(data-label);position:absolute;top:-1px;left:50%;transform:translateX(-50%);min-width:12px;height:12px;line-height:12px;border-radius:6px;background:#7a3f12;color:#fff;font-size:9px;font-weight:700;text-align:center}
                .yp-harvest-marker:focus-visible::before{box-shadow:0 0 0 2px #fff,0 0 0 4px var(--yp-primary)}
                .yp-harvest-marker-popover{display:none;position:absolute;left:50%;top:-8px;transform:translate(-50%,-100%);z-index:3;min-width:132px;box-sizing:border-box;padding:5px 7px;border:1px solid var(--yp-neutral-700);border-radius:5px;background:#fff;color:var(--yp-neutral-900);box-shadow:0 5px 14px rgba(0,0,0,.18);font-size:10px;font-weight:700;line-height:1.35;white-space:pre;pointer-events:none;text-align:left}
                .yp-harvest-marker-popover::after{content:"";position:absolute;left:50%;bottom:-5px;transform:translateX(-50%) rotate(45deg);width:8px;height:8px;border-right:1px solid var(--yp-neutral-700);border-bottom:1px solid var(--yp-neutral-700);background:#fff}
                .yp-harvest-marker:hover .yp-harvest-marker-popover,.yp-harvest-marker:focus .yp-harvest-marker-popover{display:block}
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
                .yp-disabled-area{opacity:.62;background:#f6f6f6} /* CHANGE */
                .yp-enabled-toggle{display:inline-flex;align-items:center;gap:5px;font-weight:700;color:var(--yp-neutral-900);cursor:pointer;white-space:nowrap} /* CHANGE */
                .yp-crop-select-shell{position:relative;display:inline-block;vertical-align:middle;min-width:0} /* CHANGE */
                .yp-crop-select-shell select{position:relative;z-index:1;width:100%;color:transparent;background:transparent} /* CHANGE */
                .yp-crop-select-shell select option,.yp-crop-select-shell select optgroup{color:var(--yp-neutral-900)} /* CHANGE */
                .yp-crop-select-display{position:absolute;z-index:0;left:7px;right:24px;top:50%;transform:translateY(-50%);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--yp-neutral-900);pointer-events:none} /* CHANGE */
                .yp-crop-select-shell select:disabled + .yp-crop-select-display{color:var(--yp-neutral-500)} /* CHANGE */
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
                .yp-picker-layer{position:absolute;inset:0;z-index:5;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.62);padding:16px} /* CHANGE */
                .yp-picker-dialog{box-sizing:border-box;width:min(720px,94vw);max-height:76vh;display:flex;flex-direction:column;border:1px solid var(--yp-neutral-500);border-radius:8px;background:#fff;box-shadow:0 10px 28px rgba(0,0,0,.22);overflow:hidden} /* CHANGE */
                .yp-picker-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-bottom:1px solid var(--yp-neutral-300);background:var(--yp-neutral-100)} /* CHANGE */
                .yp-picker-title{font-weight:700;font-size:13px;color:var(--yp-neutral-900)} /* CHANGE */
                .yp-picker-body{padding:10px 12px;overflow:auto;min-height:220px} /* CHANGE */
                .yp-picker-search{width:100%;box-sizing:border-box;margin-bottom:9px;padding:6px 8px;border:1px solid #bbb;border-radius:6px;font:12px Arial,sans-serif} /* CHANGE */
                .yp-picker-tree{display:flex;flex-direction:column;gap:2px} /* CHANGE */
                .yp-picker-row{display:grid;grid-template-columns:20px 20px minmax(0,1fr) auto;gap:5px;align-items:center;min-height:25px;border-radius:5px;padding:2px 5px;color:var(--yp-neutral-900)} /* CHANGE */
                .yp-picker-row[data-disabled="true"]{color:var(--yp-neutral-500)} /* CHANGE */
                .yp-picker-row:hover{background:var(--yp-neutral-100)} /* CHANGE */
                .yp-picker-toggle{width:20px;height:20px;border:0;background:transparent;cursor:pointer;color:inherit;font:12px Arial,sans-serif} /* CHANGE */
                .yp-picker-spacer{width:20px;height:20px} /* CHANGE */
                .yp-picker-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap} /* CHANGE */
                .yp-picker-meta{color:var(--yp-neutral-700);font-size:11px;white-space:nowrap} /* CHANGE */
                .yp-picker-empty{padding:14px;text-align:center;color:var(--yp-neutral-700)} /* CHANGE */
                .yp-picker-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:10px 12px;border-top:1px solid var(--yp-neutral-300);background:#fff} /* CHANGE */
                .yp-picker-warning{color:var(--yp-danger);font-weight:700} /* CHANGE */
                .yp-package-transfer-dialog{width:min(920px,96vw)} /* CHANGE */
                .yp-package-transfer-summary{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;color:var(--yp-neutral-700);font-size:11px;font-weight:700} /* CHANGE */
                .yp-package-transfer-panes{display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:start} /* CHANGE */
                .yp-package-transfer-pane{min-width:0;border:1px solid var(--yp-neutral-300);border-radius:7px;background:#fff;overflow:hidden} /* CHANGE */
                .yp-package-transfer-pane-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 8px;border-bottom:1px solid var(--yp-neutral-300);background:var(--yp-neutral-100);font-weight:700} /* CHANGE */
                .yp-package-transfer-list{display:flex;flex-direction:column;gap:4px;max-height:42vh;overflow:auto;padding:7px} /* CHANGE */
                .yp-package-transfer-crop{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:4px 0 1px;color:var(--yp-neutral-700);font-size:11px;font-weight:700} /* CHANGE */
                .yp-package-transfer-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px;align-items:center;min-height:30px;padding:4px 6px;border-radius:5px;background:#fff} /* CHANGE */
                .yp-package-transfer-row:hover{background:var(--yp-neutral-100)} /* CHANGE */
                .yp-package-transfer-row[data-pending="true"]{background:var(--yp-warning-bg)} /* CHANGE */
                .yp-package-transfer-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap} /* CHANGE */
                .yp-package-transfer-meta{color:var(--yp-neutral-700);font-size:10px;white-space:nowrap} /* CHANGE */
                .yp-package-transfer-empty{padding:12px;text-align:center;color:var(--yp-neutral-700)} /* CHANGE */
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
                .yp-diagnostics-layer{position:absolute;inset:0;z-index:4;pointer-events:none}
                .yp-diagnostics-popover{position:absolute;z-index:2;min-width:230px;max-width:320px;padding:7px;border:1px solid var(--yp-danger);border-radius:7px;background:#fff;box-shadow:0 6px 18px rgba(0,0,0,.18);color:var(--yp-neutral-900);pointer-events:auto}
                .yp-diagnostics-popover[data-tone="warning"]{border-color:var(--yp-warning);max-width:360px;max-height:220px;overflow:auto} /* CHANGE */
                .yp-diagnostics-popover[hidden]{display:none}
                .yp-diagnostics-title{font-weight:700;margin-bottom:5px;color:var(--yp-danger)}
                .yp-diagnostics-popover[data-tone="warning"] .yp-diagnostics-title{color:var(--yp-warning)} /* CHANGE */
                .yp-diagnostics-group-title{margin:6px 0 3px;padding-top:5px;border-top:1px solid var(--yp-neutral-300);font-size:11px;font-weight:700;color:var(--yp-neutral-700)} /* CHANGE */
                .yp-diagnostics-title + .yp-diagnostics-group-title{margin-top:0;padding-top:0;border-top:0} /* CHANGE */
                .yp-diagnostics-section + .yp-diagnostics-section{margin-top:5px;padding-top:5px;border-top:1px solid var(--yp-neutral-300)} /* NEW */
                .yp-diagnostics-section-toggle{box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:4px 5px;border:0;border-radius:5px;background:var(--yp-neutral-100);color:var(--yp-neutral-900);font:700 11px Arial,sans-serif;text-align:left;cursor:pointer} /* NEW */
                .yp-diagnostics-section-toggle:hover,.yp-diagnostics-section-toggle:focus{outline:1px solid var(--yp-neutral-500)} /* NEW */
                .yp-diagnostics-section-count{margin-left:auto;color:var(--yp-neutral-700);font-weight:700} /* NEW */
                .yp-diagnostics-section-cue{flex:0 0 auto;color:var(--yp-neutral-700)} /* NEW */
                .yp-diagnostics-section-body{padding-top:3px} /* NEW */
                .yp-diagnostics-section-body[hidden]{display:none} /* NEW */
                .yp-diagnostics-item{display:block;width:100%;padding:5px 6px;border:0;border-radius:5px;background:#fff;text-align:left;color:var(--yp-neutral-900);font:12px Arial,sans-serif;cursor:pointer}
                .yp-diagnostics-item:hover,.yp-diagnostics-item:focus{background:var(--yp-danger-bg);outline:1px solid var(--yp-danger)}
                .yp-diagnostics-popover[data-tone="warning"] .yp-diagnostics-item:hover,.yp-diagnostics-popover[data-tone="warning"] .yp-diagnostics-item:focus{background:var(--yp-warning-bg);outline:1px solid var(--yp-warning)} /* CHANGE */
                .yp-diagnostics-message{display:block;width:100%;box-sizing:border-box;padding:6px 7px;border-radius:5px;background:#fff;text-align:left;color:var(--yp-neutral-900);font:12px Arial,sans-serif;line-height:1.35;white-space:normal;overflow-wrap:anywhere} /* CHANGE */
                .yp-diagnostics-message + .yp-diagnostics-message{margin-top:3px;border-top:1px solid var(--yp-neutral-300)} /* CHANGE */
                .yp-diagnostics-item-source{display:block;margin-top:2px;color:var(--yp-neutral-700);font-size:10px;font-weight:700} /* CHANGE */
                .yp-field-highlight{outline:2px solid var(--yp-danger)!important;outline-offset:2px}
                .yp-target-highlight{outline:2px solid var(--yp-warning)!important;outline-offset:2px;background:var(--yp-warning-bg)!important} /* CHANGE */
                .yp-attention-strip{display:none;margin-top:6px;padding:6px;border:1px solid var(--yp-warning);border-radius:6px;background:var(--yp-warning-bg)}
                .yp-attention-title{font-weight:700;margin-bottom:4px;color:var(--yp-neutral-900)}
                .yp-crop-search{width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #bbb;border-radius:6px;font:12px Arial,sans-serif} /* CHANGE */
                .yp-crop-search-wrap{padding:8px 10px;border-bottom:1px solid #eee;background:#fff} /* CHANGE */
                .yp-crop-card{box-sizing:border-box;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;min-height:34px;border:0;border-bottom:1px solid #eee;background:#fff;padding:6px 10px;text-align:left;cursor:pointer;width:100%;overflow-wrap:anywhere} /* CHANGE */
                .yp-crop-card[data-selected="true"]{background:var(--yp-primary-bg);box-shadow:inset 3px 0 0 var(--yp-primary)}
                .yp-crop-card-name{min-width:0;font-weight:700;font-size:13px;color:var(--yp-neutral-900);overflow:hidden;text-overflow:ellipsis;white-space:nowrap} /* CHANGE */
                .yp-crop-card .yp-diagnostics-wrap{min-width:0;justify-content:flex-end;flex-wrap:nowrap} /* CHANGE */
                .yp-crop-card .yp-chip{max-width:160px;overflow:hidden;text-overflow:ellipsis} /* CHANGE */
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
            const cropSearchWrap = document.createElement("div"); // CHANGE
            cropSearchWrap.className = "yp-crop-search-wrap"; // CHANGE
            const cropSearchInput = document.createElement("input"); // CHANGE
            cropSearchInput.type = "search"; // CHANGE
            cropSearchInput.className = "yp-crop-search"; // CHANGE
            cropSearchInput.placeholder = "Search crops"; // CHANGE
            cropSearchInput.setAttribute("aria-label", "Search crops"); // CHANGE
            cropSearchWrap.appendChild(cropSearchInput); // CHANGE
            const cropList = document.createElement("div");
            cropList.style.cssText = "display:flex;flex-direction:column;max-height:56vh;overflow:auto;";
            sidebar.appendChild(sidebarHead);
            sidebar.appendChild(cropSearchWrap); // CHANGE
            sidebar.appendChild(cropList);
            const mainColumn = document.createElement("div");
            mainColumn.style.cssText = "display:flex;flex-direction:column;gap:12px;min-width:0;";
            const editorBox = document.createElement("div");
            editorBox.style.cssText = "border:1px solid #ddd;border-radius:8px;background:#fff;min-height:280px;";
            const csaBox = document.createElement("div");
            const demandBox = document.createElement("div");
            const selfSufficiencyBox = document.createElement("div");
            const cropPlanBox = document.createElement("div");
            const planCheckBox = document.createElement("div");
            csaBox.dataset.yearPlanStrip = "csa";
            demandBox.dataset.yearPlanStrip = "demand";
            selfSufficiencyBox.dataset.yearPlanStrip = "self-sufficiency"; // NEW
            cropPlanBox.dataset.yearPlanStrip = "crop-plan";
            planCheckBox.dataset.yearPlanStrip = "plan-check";
            mainColumn.appendChild(editorBox);
            dashboardGrid.appendChild(sidebar);
            dashboardGrid.appendChild(mainColumn);
            body.appendChild(summaryBox);
            body.appendChild(cropPlanBox);
            body.appendChild(selfSufficiencyBox);
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
            const planCheckScopeSel = document.createElement("select");
            const cropFilterSel = document.createElement("select");
            const cropFilterBadgeHost = document.createElement("span"); // CHANGE: selected planned crops can surface package setup warnings beside the selector.
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
            const diagnosticsLayer = document.createElement("div"); // CHANGE
            diagnosticsLayer.className = "yp-diagnostics-layer"; // CHANGE
            chartControls.appendChild(document.createTextNode("Scope"));
            chartControls.appendChild(planCheckScopeSel);
            chartControls.appendChild(document.createTextNode("Crop filter"));
            chartControls.appendChild(cropFilterSel);
            chartControls.appendChild(cropFilterBadgeHost); // CHANGE
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
            card.appendChild(diagnosticsLayer); // CHANGE: popovers render above scrollable content without inheriting clipped overflow.
            wrap.appendChild(card);
            document.body.appendChild(wrap);
            session.ui.modalEl = wrap;
            SessionController.addWindowListener(session, "keydown", event => { if (event.key === "Escape") closeDiagnosticsPopovers(null); });
            SessionController.addWindowListener(session, "click", event => { if (!event.target || !event.target.closest || !event.target.closest(".yp-diagnostics-wrap")) closeDiagnosticsPopovers(null); });
            SessionController.addWindowListener(session, "resize", () => closeDiagnosticsPopovers(null)); // CHANGE: avoid stale absolute popover placement after viewport changes.
            const closeDiagnosticsOnScroll = () => closeDiagnosticsPopovers(null); // CHANGE
            body.addEventListener("scroll", closeDiagnosticsOnScroll); // CHANGE: close instead of letting detached popovers drift while content scrolls.
            session.disposers.push(() => body.removeEventListener("scroll", closeDiagnosticsOnScroll)); // CHANGE

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

            function setButtonSvgIcon(button, svgMarkup, fallbackText) { // CHANGE
                if (!button) return; // CHANGE
                button.textContent = ""; // CHANGE
                if (svgMarkup) button.innerHTML = svgMarkup; // CHANGE
                else button.textContent = String(fallbackText || ""); // CHANGE
            } // CHANGE

            function yearPlanPencilIconSvg() { // CHANGE
                return '<svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" focusable="false" style="display:block"><path d="M11.9 1.7a1.5 1.5 0 0 1 2.1 2.1l-8.4 8.4-3 .8.8-3 8.5-8.3z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M10.8 2.8l2.4 2.4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>'; // CHANGE
            } // CHANGE

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

            function pickerExpandedSet(key) {
                const storageKey = String(key || "");
                state.pickerTreeExpanded = state.pickerTreeExpanded && typeof state.pickerTreeExpanded === "object" ? state.pickerTreeExpanded : {};
                if (!Array.isArray(state.pickerTreeExpanded[storageKey])) state.pickerTreeExpanded[storageKey] = [];
                return new Set(state.pickerTreeExpanded[storageKey].map(String).filter(Boolean));
            } // CHANGE

            function savePickerExpandedSet(key, expanded) {
                const storageKey = String(key || "");
                state.pickerTreeExpanded = state.pickerTreeExpanded && typeof state.pickerTreeExpanded === "object" ? state.pickerTreeExpanded : {};
                state.pickerTreeExpanded[storageKey] = Array.from(expanded || []).map(String).filter(Boolean);
                saveCollapsePreferences();
            } // CHANGE

            function pickerNodeText(node) {
                const parts = [node && node.label, node && node.meta];
                for (const child of ((node && node.children) || [])) parts.push(pickerNodeText(child));
                return parts.join(" ").toLocaleLowerCase();
            } // CHANGE

            function pickerSelectableLeaves(node) {
                const leaves = [];
                const visit = item => {
                    if (!item) return;
                    if (item.selectable && !item.disabled) leaves.push(item);
                    for (const child of (item.children || [])) visit(child);
                };
                visit(node);
                return leaves;
            } // CHANGE

            function pickerFlattenLeaves(nodes) {
                const leaves = [];
                for (const node of (nodes || [])) leaves.push(...pickerSelectableLeaves(node));
                return leaves;
            } // CHANGE

            function openTreePicker(config) {
                const settings = config || {};
                const key = String(settings.key || Env.uid("picker"));
                const roots = Array.isArray(settings.nodes) ? settings.nodes : [];
                const leafOrder = pickerFlattenLeaves(roots).map(node => String(node.id));
                const leafById = new Map();
                const expanded = pickerExpandedSet(key);
                const selected = new Set();
                let query = "";
                let discardWarned = false;
                let closed = false;

                const layer = document.createElement("div");
                layer.className = "yp-picker-layer";
                layer.dataset.yearPlanPicker = key;
                const dialog = document.createElement("div");
                dialog.className = "yp-picker-dialog";
                dialog.setAttribute("role", "dialog");
                dialog.setAttribute("aria-modal", "true");
                const head = document.createElement("div");
                head.className = "yp-picker-head";
                const title = document.createElement("div");
                title.className = "yp-picker-title";
                title.textContent = settings.title || "Select items";
                const close = mkBtn("Close", "neutral");
                head.appendChild(title);
                head.appendChild(close);
                const bodyEl = document.createElement("div");
                bodyEl.className = "yp-picker-body";
                const search = mkInput("search", "", 0);
                search.className = "yp-picker-search";
                search.placeholder = "Search";
                const tree = document.createElement("div");
                tree.className = "yp-picker-tree";
                bodyEl.appendChild(search);
                bodyEl.appendChild(tree);
                const foot = document.createElement("div");
                foot.className = "yp-picker-foot";
                const status = document.createElement("div");
                status.className = "yp-picker-status";
                const warning = document.createElement("div");
                warning.className = "yp-picker-warning";
                const actions = document.createElement("div");
                actions.className = "yp-row";
                const cancel = mkBtn("Cancel", "neutral");
                const add = mkBtn(settings.addLabel || "Add selected", "add");
                actions.appendChild(cancel);
                actions.appendChild(add);
                foot.appendChild(status);
                foot.appendChild(warning);
                foot.appendChild(actions);
                dialog.appendChild(head);
                dialog.appendChild(bodyEl);
                dialog.appendChild(foot);
                layer.appendChild(dialog);
                card.appendChild(layer);

                function rememberLeaf(node) {
                    if (node && node.selectable) leafById.set(String(node.id), node);
                    for (const child of ((node && node.children) || [])) rememberLeaf(child);
                }
                roots.forEach(rememberLeaf);

                function filteredNode(node) {
                    if (!query) return node;
                    const needle = query.toLocaleLowerCase();
                    if (pickerNodeText(node).indexOf(needle) < 0) return null;
                    const copy = { ...node };
                    copy.children = (node.children || []).map(filteredNode).filter(Boolean);
                    return copy;
                }

                function nodeIsExpanded(node) {
                    return !!query || expanded.has(String(node && node.id || ""));
                }

                function setSelection(ids, checked) {
                    for (const id of ids) {
                        if (checked) selected.add(String(id));
                        else selected.delete(String(id));
                    }
                    discardWarned = false;
                    render();
                }

                function descendantIds(node) {
                    return pickerSelectableLeaves(node).map(item => String(item.id));
                }

                function selectedCount(node) {
                    const ids = descendantIds(node);
                    return { selected: ids.filter(id => selected.has(id)).length, total: ids.length, ids };
                }

                function toggleExpanded(node) {
                    if (!node || !(node.children || []).length) return;
                    const id = String(node.id || "");
                    if (expanded.has(id)) expanded.delete(id);
                    else expanded.add(id);
                    savePickerExpandedSet(key, expanded);
                    render();
                }

                function renderNode(node, depth) {
                    const hasChildren = !!((node.children || []).length);
                    const isExpanded = nodeIsExpanded(node);
                    const counts = selectedCount(node);
                    const row = document.createElement("div");
                    row.className = "yp-picker-row";
                    row.dataset.pickerNodeId = String(node.id || "");
                    row.dataset.disabled = node.disabled ? "true" : "false";
                    row.style.paddingLeft = `${5 + Math.max(0, depth) * 18}px`;
                    const toggle = hasChildren ? document.createElement("button") : document.createElement("span");
                    toggle.className = hasChildren ? "yp-picker-toggle" : "yp-picker-spacer";
                    if (hasChildren) {
                        toggle.type = "button";
                        toggle.textContent = isExpanded ? "-" : "+";
                        toggle.setAttribute("aria-label", isExpanded ? "Collapse" : "Expand");
                        toggle.addEventListener("click", event => { event.stopPropagation(); toggleExpanded(node); });
                    }
                    const check = document.createElement("input");
                    check.type = "checkbox";
                    const canSelectGroup = node.selects === "all" && counts.total > 0;
                    const canSelectLeaf = node.selectable && !node.disabled;
                    check.disabled = !(canSelectGroup || canSelectLeaf);
                    check.checked = canSelectLeaf ? selected.has(String(node.id)) : (canSelectGroup && counts.selected === counts.total);
                    check.indeterminate = canSelectGroup && counts.selected > 0 && counts.selected < counts.total;
                    check.addEventListener("change", event => {
                        event.stopPropagation();
                        if (canSelectLeaf) setSelection([String(node.id)], check.checked);
                        else if (canSelectGroup) setSelection(counts.ids, check.checked);
                    });
                    const label = document.createElement("div");
                    label.className = "yp-picker-label";
                    label.textContent = node.label || "";
                    const meta = document.createElement("div");
                    meta.className = "yp-picker-meta";
                    meta.textContent = node.meta || (counts.total ? `${counts.selected}/${counts.total}` : "");
                    row.appendChild(toggle);
                    row.appendChild(check);
                    row.appendChild(label);
                    row.appendChild(meta);
                    row.addEventListener("click", event => {
                        if (event.target === check || event.target === toggle) return;
                        if (node.action && typeof settings.onAction === "function") { // CHANGE
                            closePicker(true); // CHANGE
                            settings.onAction(node); // CHANGE
                            return; // CHANGE
                        } // CHANGE
                        if (node.selects === "base" && node.baseLeafId) {
                            if (hasChildren && !isExpanded) toggleExpanded(node);
                            setSelection([String(node.baseLeafId)], !selected.has(String(node.baseLeafId)));
                            return;
                        }
                        if (canSelectGroup) setSelection(counts.ids, counts.selected < counts.total);
                        else if (canSelectLeaf) setSelection([String(node.id)], !selected.has(String(node.id)));
                        else if (hasChildren) toggleExpanded(node);
                    });
                    tree.appendChild(row);
                    if (hasChildren && isExpanded) {
                        for (const child of (node.children || [])) renderNode(child, depth + 1);
                    }
                }

                function render() {
                    tree.innerHTML = "";
                    const shown = roots.map(filteredNode).filter(Boolean);
                    if (!shown.length) {
                        const empty = document.createElement("div");
                        empty.className = "yp-picker-empty";
                        empty.textContent = query ? "No matches." : (settings.emptyText || "No selectable items.");
                        tree.appendChild(empty);
                    } else {
                        for (const rootNode of shown) renderNode(rootNode, 0);
                    }
                    const selectedLabels = Array.from(selected).map(id => leafById.get(id)).filter(Boolean);
                    status.textContent = `${selectedLabels.length} selected`;
                    warning.textContent = "";
                    add.disabled = !selectedLabels.length;
                }

                function closePicker(force) {
                    if (closed) return;
                    if (!force && selected.size && !discardWarned) {
                        discardWarned = true;
                        warning.textContent = "Selection will be lost. Close again to discard.";
                        return;
                    }
                    closed = true;
                    window.removeEventListener("keydown", onKeyDown, true);
                    if (layer.parentNode) layer.parentNode.removeChild(layer);
                }

                function selectedValuesInOrder() {
                    return leafOrder.filter(id => selected.has(id)).map(id => leafById.get(id)).filter(Boolean).map(node => node.value);
                }

                function onKeyDown(event) {
                    if (event.key === "Escape") {
                        event.preventDefault();
                        event.stopPropagation();
                        closePicker(false);
                    }
                }

                search.addEventListener("input", () => { query = search.value.trim(); render(); });
                add.addEventListener("click", () => {
                    const values = selectedValuesInOrder();
                    if (!values.length) return;
                    if (typeof settings.onAdd === "function") settings.onAdd(values);
                    closePicker(true);
                });
                cancel.addEventListener("click", () => closePicker(false));
                close.addEventListener("click", () => closePicker(false));
                layer.addEventListener("click", event => { if (event.target === layer) closePicker(false); });
                window.addEventListener("keydown", onKeyDown, true);
                render();
                setTimeout(() => search.focus(), 0);
                return { close: () => closePicker(true), layer };
            } // CHANGE: shared searchable tree picker for bulk crop and package selection.

            function captureDetailFocus(details) {
                const active = document.activeElement;
                if (!active || !details || !details.contains(active) || !active.dataset || !active.dataset.yearPlanField) return null;
                const dataset = {};
                for (const key of ["yearPlanField", "cropId", "packageIndex", "csaComponentIndex", "yearPlanDemandChannelId", "yearPlanDemandLineId", "yearPlanSelfLineId", "yearPlanSelfLineIndex"]) {
                    if (active.dataset[key] !== undefined) dataset[key] = String(active.dataset[key]);
                }
                return {
                    dataset,
                    selectionStart: typeof active.selectionStart === "number" ? active.selectionStart : null,
                    selectionEnd: typeof active.selectionEnd === "number" ? active.selectionEnd : null
                };
            } // CHANGE: rebuilding cached strip details should not interrupt editing the same logical field.

            function restoreDetailFocus(details, snapshot) {
                if (!details || !snapshot || !snapshot.dataset || !snapshot.dataset.yearPlanField) return;
                const candidates = Array.from(details.querySelectorAll("[data-year-plan-field]"));
                const target = candidates.find(control => Object.entries(snapshot.dataset).every(([key, value]) => String(control.dataset[key] || "") === value));
                if (!target || target.disabled) return;
                target.focus();
                if (snapshot.selectionStart !== null && typeof target.setSelectionRange === "function") {
                    try { target.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd); } catch (_) { }
                }
            } // CHANGE

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
                    const controls = document.createElement("span"); // CHANGE
                    controls.className = "yp-strip-controls"; // CHANGE
                    const summary = document.createElement("span");
                    summary.className = "yp-strip-summary";
                    const toggle = document.createElement("span");
                    toggle.className = "yp-strip-toggle";
                    const details = document.createElement("div");
                    details.className = "yp-strip-details";
                    details.id = settings.detailsId || Env.uid("yp-strip-details");
                    header.setAttribute("aria-controls", details.id);
                    header.appendChild(title);
                    header.appendChild(controls); // CHANGE
                    header.appendChild(summary);
                    header.appendChild(toggle);
                    box.appendChild(header);
                    box.appendChild(details);
                    shell = { header, title, controls, summary, toggle, details, detailsBuilt: false, onToggle: null }; // CHANGE
                    controls.addEventListener("click", event => event.stopPropagation()); // CHANGE
                    controls.addEventListener("keydown", event => event.stopPropagation()); // CHANGE
                    header.addEventListener("click", () => { if (shell.onToggle) shell.onToggle(); });
                    header.addEventListener("keydown", event => { if ((event.key === "Enter" || event.key === " ") && shell.onToggle) { event.preventDefault(); shell.onToggle(); } });
                    box.__yearPlanStrip = shell;
                }
                shell.onToggle = settings.onToggle || null;
                shell.title.textContent = String(settings.title || "");
                shell.controls.innerHTML = ""; // CHANGE
                if (typeof settings.renderHeaderControls === "function") settings.renderHeaderControls(shell.controls); // CHANGE
                shell.controls.style.display = shell.controls.childNodes.length ? "flex" : "none"; // CHANGE
                shell.summary.innerHTML = "";
                if (Array.isArray(settings.summaryChips)) setChipRow(shell.summary, settings.summaryChips);
                else shell.summary.textContent = String(settings.summaryText || "");
                shell.toggle.textContent = settings.expanded ? "Collapse" : "Expand";
                shell.header.setAttribute("aria-expanded", settings.expanded ? "true" : "false");
                shell.details.style.display = settings.expanded ? "block" : "none";
                const shouldBuild = !!settings.rebuildDetails || (!shell.detailsBuilt && (settings.expanded || settings.mountWhenCollapsed));
                if (shouldBuild && settings.renderDetails) {
                    const focusSnapshot = captureDetailFocus(shell.details); // CHANGE
                    shell.details.innerHTML = "";
                    settings.renderDetails(shell.details);
                    shell.detailsBuilt = true;
                    restoreDetailFocus(shell.details, focusSnapshot); // CHANGE
                }
                return shell;
            }

            function cropLabel(crop) {
                const plantName = String(crop && crop.plant || "").trim();
                const varietyName = String(crop && crop.variety || "").trim();
                return plantName && varietyName ? `${plantName} - ${varietyName}` : (plantName || varietyName || String(crop && crop.id || "Crop"));
            }

            function cropPackageUnitCount(crop) {
                return PlanMath.packageUnitOptions(crop).length;
            } // CHANGE: planned-crop selector badges count usable package units, not blank package rows.

            function cropFilterOptionLabel(crop) {
                const count = cropPackageUnitCount(crop);
                if (!count) return `${cropLabel(crop)} (Needs packages)`;
                return `${cropLabel(crop)} (${count} package${count === 1 ? "" : "s"})`;
            } // CHANGE

            const formatKg = YearPlanDashboard.formatKg;
            const formatMoney = YearPlanDashboard.formatMoney;

            function statusTone(status) {
                if (status === "Short" || status === "Missing data") return "danger";
                if (status === "Expired / timing issue") return "warning";
                if (status === "Surplus" || status === "OK") return "success";
                if (status === "Unsaved") return "primary";
                return "neutral";
            }

            function createChip(label, value, tone, onClick, options) {
                const action = onClick || (options && (options.targets || options.primaryTarget || options.highlightOnlyTarget) ? event => activateYearPlanTarget(options.primaryTarget || options.targets || options.highlightOnlyTarget, options.fallback, event && event.currentTarget) : null); // CHANGE
                const chip = document.createElement(action ? "button" : "span"); // CHANGE
                if (action) chip.type = "button"; // CHANGE
                chip.className = "yp-chip";
                chip.dataset.tone = tone || "neutral";
                if (options && options.chipKind) chip.dataset.chipKind = String(options.chipKind); // CHANGE
                if (action) chip.dataset.clickable = "true"; // CHANGE
                chip.innerHTML = value === undefined || value === null || value === ""
                    ? mxUtils.htmlEntities(String(label || ""))
                    : `<strong>${mxUtils.htmlEntities(String(label || ""))}</strong> ${mxUtils.htmlEntities(String(value))}`;
                if (options && options.title) chip.title = String(options.title); // CHANGE: actionable badges expose their issue list in a native tooltip.
                if (action) chip.addEventListener("click", event => { event.stopPropagation(); action(event); }); // CHANGE
                return chip;
            }

            function createDisabledChip() {
                return createChip(DISABLED_CHIP, "", "neutral"); // CHANGE
            } // CHANGE

            function createEnabledToggle(label, checked, onChange) {
                const wrapper = document.createElement("label");
                wrapper.className = "yp-enabled-toggle";
                wrapper.dataset.keepEnabledWhenSectionDisabled = "true";
                const input = document.createElement("input");
                input.type = "checkbox";
                input.checked = !!checked;
                input.dataset.keepEnabledWhenSectionDisabled = "true";
                wrapper.appendChild(input);
                wrapper.appendChild(document.createTextNode(label));
                input.addEventListener("click", event => event.stopPropagation()); // CHANGE
                input.addEventListener("change", () => onChange(!!input.checked)); // CHANGE
                return wrapper;
            } // CHANGE

            function applyDisabledAreaState(container, disabled) {
                if (!container) return;
                container.classList.toggle("yp-disabled-area", !!disabled);
                if (!disabled) return; // CHANGE: enabled sections keep each control's own business-rule disabled state.
                for (const control of Array.from(container.querySelectorAll("input,select,textarea,button"))) {
                    if (control.dataset && control.dataset.keepEnabledWhenSectionDisabled === "true") continue;
                    if (control.tagName === "BUTTON" && /^(Expand|Collapse)$/.test(String(control.textContent || "").trim())) continue;
                    control.disabled = !!disabled;
                }
            } // CHANGE

            function cropFieldDisplayText(cropId, fallback) {
                const crop = PlanMath.findCrop(plan, cropId);
                const plant = String(crop && crop.plant || "").trim();
                return plant || String(fallback || cropLabel(crop) || cropId || "");
            } // CHANGE

            function wrapDestinationCropSelect(select) {
                const shell = document.createElement("span");
                shell.className = "yp-crop-select-shell";
                shell.style.width = select.style.width || "220px";
                select.style.width = "100%";
                const display = document.createElement("span");
                display.className = "yp-crop-select-display";
                function syncDisplay() {
                    const option = select.options && select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null;
                    display.textContent = cropFieldDisplayText(select.value, option && option.textContent);
                }
                select.addEventListener("change", syncDisplay);
                syncDisplay();
                shell.appendChild(select);
                shell.appendChild(display);
                select.__ypSyncCropDisplay = syncDisplay;
                return shell;
            } // CHANGE

            function validationMessage(result) {
                return YearPlanDashboard.validationMessage(result);
            }

            function validationTooltip(results) {
                return (results || []).map(validationMessage).filter(Boolean).join("\n");
            } // NEW: validation-backed badges reuse the same messages as diagnostics popovers.

            function countedValidationLabel(label, results) {
                return `${label} (${(results || []).length})`;
            } // NEW: aggregate validation badges show how many issues they represent.

            function htmlAttr(value) {
                return mxUtils.htmlEntities(String(value ?? "")).replace(/"/g, "&quot;");
            } // NEW: Plan Check row markers are emitted through innerHTML.

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

            function warningTypeLabel(type) {
                const key = String(type || "");
                if (key === "crop-status") return "Crop status";
                if (key === "crop-packages") return "Crop packages";
                if (key === "demand") return "Demand setup";
                if (key === "self-sufficiency") return "Self Sufficiency setup";
                if (key === "csa") return "CSA setup";
                if (key === "package-prices") return "Package prices";
                if (key === "nutrition") return "Nutrition";
                return "Plan Check";
            } // CHANGE

            function validationWarningType(result) {
                const scope = String(result && result.scope || "");
                if (scope === "demand") return "demand";
                if (scope === "self-sufficiency") return "self-sufficiency";
                if (scope === "csa") return "csa";
                if (scope === "crop") return "crop-packages";
                return "plan-check";
            } // CHANGE

            function validationSourceLabel(result) {
                const scope = String(result && result.scope || "");
                if (scope === "crop") {
                    const crop = PlanMath.findCrop(plan, result && result.cropId);
                    return crop ? cropLabel(crop) : "Crop Plan";
                }
                if (scope === "demand") return "Demand";
                if (scope === "self-sufficiency") return "Self Sufficiency";
                if (scope === "csa") return "CSA";
                return "Plan Check";
            } // CHANGE

            function wholePlanWarningItems() {
                const warnings = [];
                const seen = new Set();
                const add = warning => {
                    const message = String(warning && warning.message || "").trim();
                    if (!message) return;
                    const targetKey = warning && warning.target ? JSON.stringify(warning.target) : "";
                    const key = `${String(warning && warning.type || "")}|${message}|${targetKey}`;
                    if (seen.has(key)) return;
                    seen.add(key);
                    warnings.push({ type: "plan-check", tone: "warning", ...warning, message }); // CHANGE
                };
                const validationMessages = new Set();
                for (const result of ((dashboard && dashboard.validationErrors) || [])) {
                    const message = validationMessage(result);
                    if (!message) continue;
                    validationMessages.add(message);
                    add({ type: validationWarningType(result), tone: "danger", message, target: result && result.target, result, sourceLabel: validationSourceLabel(result) });
                }
                for (const crop of ((plan && plan.crops) || [])) {
                    if (!cropPackageUnitCount(crop)) add({ type: "crop-packages", message: `${cropLabel(crop)} needs a package unit.`, target: { area: "crop", cropId: String(crop.id || ""), tab: "packages", field: "addPackage" }, sourceLabel: cropLabel(crop) }); // CHANGE
                }
                for (const metric of ((dashboard && dashboard.cropMetrics) || [])) {
                    if (!metric || metric.status === "Missing data" || metric.status === "OK" || metric.status === "No demand" || metric.status === "Surplus") continue;
                    const label = metric.status === "Short"
                        ? `${cropLabel(metric.crop)} short ${formatKg(metric.shortKg)}.`
                        : `${cropLabel(metric.crop)} has timing issues: ${formatKg(metric.shortKg)} expired or unavailable.`;
                    add({ type: "crop-status", message: label, target: { area: "plan-check", cropId: String(metric.crop && metric.crop.id || "") }, sourceLabel: cropLabel(metric.crop) }); // CHANGE
                }
                for (const message of ((dashboard && dashboard.diagnostics) || [])) {
                    const text = String(message || "").trim();
                    if (!text || validationMessages.has(text)) continue;
                    const isPrice = /no matching package price is set/i.test(text);
                    const isNutrition = /nutrition|mapping|coverage/i.test(text);
                    add({
                        type: isPrice ? "package-prices" : (isNutrition ? "nutrition" : "plan-check"),
                        message: text,
                        target: isPrice ? firstMissingPackagePriceTarget() : (isNutrition ? { area: "self-sufficiency", section: "nutrition" } : { area: "plan-check", section: "diagnostics" }),
                        sourceLabel: isPrice ? "Packages" : (isNutrition ? "Self Sufficiency" : "Plan Check")
                    }); // CHANGE
                }
                return warnings;
            } // CHANGE

            function createWholePlanDiagnosticsControl(label) {
                return createDiagnosticsControl(label || "All warnings", null, { groupedWarnings: wholePlanWarningItems(), tone: "warning" }); // CHANGE
            } // CHANGE

            function diagnosticsSectionKey(label, sectionId) {
                return `${String(label || "Diagnostics")}|${String(sectionId || "plan-check")}`;
            } // NEW

            function setDiagnosticsSectionCollapsed(key, collapsed) {
                if (!state.collapsedDiagnosticsSectionIds || typeof state.collapsedDiagnosticsSectionIds.add !== "function") state.collapsedDiagnosticsSectionIds = new Set();
                if (collapsed) state.collapsedDiagnosticsSectionIds.add(key);
                else state.collapsedDiagnosticsSectionIds.delete(key);
            } // NEW

            function appendDiagnosticsSection(popover, label, sectionId, titleText, items, trigger) {
                const diagnostics = Array.isArray(items) ? items.filter(item => item && String(item.message || "").trim()) : [];
                if (!diagnostics.length) return;
                const key = diagnosticsSectionKey(label, sectionId);
                const collapsed = !!(state.collapsedDiagnosticsSectionIds && state.collapsedDiagnosticsSectionIds.has(key));
                const section = document.createElement("div");
                section.className = "yp-diagnostics-section";
                section.dataset.sectionId = String(sectionId || "");
                const button = document.createElement("button");
                button.type = "button";
                button.className = "yp-diagnostics-section-toggle";
                const panelId = Env.uid("yp-diagnostics-section");
                button.setAttribute("aria-controls", panelId);
                button.setAttribute("aria-expanded", collapsed ? "false" : "true");
                const title = document.createElement("span");
                title.className = "yp-diagnostics-section-title";
                title.textContent = titleText || "Diagnostics";
                const count = document.createElement("span");
                count.className = "yp-diagnostics-section-count";
                count.textContent = String(diagnostics.length);
                const cue = document.createElement("span");
                cue.className = "yp-diagnostics-section-cue";
                cue.textContent = collapsed ? "Expand" : "Collapse";
                button.appendChild(title);
                button.appendChild(count);
                button.appendChild(cue);
                const panel = document.createElement("div");
                panel.className = "yp-diagnostics-section-body";
                panel.id = panelId;
                panel.hidden = collapsed;
                button.addEventListener("click", event => {
                    event.preventDefault();
                    event.stopPropagation();
                    const nextCollapsed = button.getAttribute("aria-expanded") === "true";
                    setDiagnosticsSectionCollapsed(key, nextCollapsed);
                    button.setAttribute("aria-expanded", nextCollapsed ? "false" : "true");
                    cue.textContent = nextCollapsed ? "Expand" : "Collapse";
                    panel.hidden = nextCollapsed;
                }); // NEW
                for (const item of diagnostics) appendDiagnosticPopoverItem(panel, item, trigger);
                section.appendChild(button);
                section.appendChild(panel);
                popover.appendChild(section);
            } // NEW

            function createWarningChipWithDetails(label, value, tone, onClick, options) {
                const wrapControl = document.createElement("span");
                wrapControl.className = "yp-diagnostics-wrap";
                const primaryTarget = options && (options.primaryTarget || options.targets || options.highlightOnlyTarget); // CHANGE
                const warningItems = Array.isArray(options && options.warningItems)
                    ? options.warningItems
                    : (String(label || "") === "Warnings" ? wholePlanWarningItems() : [{ message: `${label || ""}${value ? " " + value : ""}`.trim(), target: primaryTarget, action: onClick }]); // CHANGE
                wrapControl.appendChild(createActionablePopoverChip(label, value, tone, warningItems, onClick, { ...(options || {}), popoverTitle: options && options.diagnosticsLabel ? String(options.diagnosticsLabel) : "All warnings" })); // CHANGE
                const diagnostics = createWholePlanDiagnosticsControl(options && options.diagnosticsLabel ? String(options.diagnosticsLabel) : "All warnings"); // CHANGE
                if (diagnostics) wrapControl.appendChild(diagnostics);
                return wrapControl;
            } // CHANGE

            function closeDiagnosticsPopovers(except) {
                for (const popover of Array.from(card.querySelectorAll(".yp-diagnostics-popover")).concat(Array.from(diagnosticsLayer.querySelectorAll(".yp-diagnostics-popover")))) { // CHANGE
                    if (popover.__ypDiagnosticsOwner && !popover.__ypDiagnosticsOwner.isConnected) { popover.remove(); continue; } // CHANGE
                    if (popover !== except) {
                        popover.hidden = true;
                        if (popover.__ypDiagnosticsOwner) popover.__ypDiagnosticsOwner.dataset.pinned = "false"; // CHANGE
                    }
                }
            }

            function positionDiagnosticsPopover(trigger, popover) {
                if (!trigger || !popover || !card.isConnected) return;
                if (popover.parentElement !== diagnosticsLayer) diagnosticsLayer.appendChild(popover); // CHANGE
                const cardRect = card.getBoundingClientRect();
                const triggerRect = trigger.getBoundingClientRect();
                popover.hidden = false;
                const maxWidth = popover.dataset.tone === "warning" ? 360 : 320; // CHANGE
                const width = Math.max(230, Math.min(maxWidth, popover.offsetWidth || 230)); // CHANGE
                const height = popover.offsetHeight || 80;
                const gutter = 8;
                const preferredLeft = triggerRect.right - cardRect.left - width;
                const maximumLeft = Math.max(gutter, cardRect.width - width - gutter);
                const left = Math.max(gutter, Math.min(maximumLeft, preferredLeft));
                const belowTop = triggerRect.bottom - cardRect.top + 4;
                const aboveTop = triggerRect.top - cardRect.top - height - 4;
                const fitsBelow = belowTop + height <= cardRect.height - gutter;
                const top = fitsBelow ? belowTop : Math.max(gutter, aboveTop);
                popover.style.left = `${left}px`;
                popover.style.top = `${top}px`;
            } // CHANGE

            function highlightElements(elements, className) {
                const nodes = (Array.isArray(elements) ? elements : [elements]).filter(Boolean);
                if (!nodes.length) return false;
                const highlightClass = className || "yp-field-highlight";
                for (const node of nodes) {
                    if (!node.classList) continue;
                    node.classList.add(highlightClass);
                    setTimeout(() => { if (node && node.classList) node.classList.remove(highlightClass); }, 1200);
                }
                return true;
            } // CHANGE

            function focusAndHighlight(element, relatedElements) {
                const related = (relatedElements || []).filter(Boolean);
                if (!element || element.disabled) {
                    highlightElements(related.length ? related : element, "yp-field-highlight"); // CHANGE
                    return false;
                }
                if (typeof element.focus === "function") element.focus();
                highlightElements([element].concat(related), "yp-field-highlight"); // CHANGE
                if (typeof element.scrollIntoView === "function") element.scrollIntoView({ block: "center", inline: "nearest" });
                return true;
            }

            function scrollToElement(element, block) {
                if (element && typeof element.scrollIntoView === "function") element.scrollIntoView({ block: block || "start", inline: "nearest" });
            } // CHANGE: command buttons should move the modal viewport to the section they reveal.

            function findPlanCheckCropRow(cropId) {
                return Array.from(totalsBox.querySelectorAll("[data-plan-check-crop-id]")).find(row => String(row.dataset.planCheckCropId || "") === String(cropId || "")) || null;
            } // NEW: metric attention badges can land on the exact Plan Check crop row.

            function scrollToPlanCheckCropRow(cropId) {
                const row = findPlanCheckCropRow(cropId);
                scrollToElement(row || planCheckBox, row ? "center" : "start");
            } // NEW

            function scrollToPlanCheck() {
                state.planCheckExpanded = true;
                renderPlanCheck();
                scrollToElement(planCheckBox, "start");
            } // NEW: aggregate Plan Check warnings open the analysis section.

            function scrollAndHighlightTarget(element) {
                if (!element) return false;
                highlightElements(element, "yp-target-highlight");
                scrollToElement(element, "center");
                return true;
            } // CHANGE

            function packageIndexForUnit(crop, unit) {
                const unitKey = String(unit || "").trim().toLowerCase();
                if (!unitKey) return -1;
                return ((crop && crop.packages) || []).findIndex(pkg => String(pkg && pkg.unit || "").trim().toLowerCase() === unitKey);
            } // NEW

            function missingPackagePriceItems() {
                const items = [];
                const seenCropIds = new Set();
                const addCropTarget = (crop, target) => {
                    const cropId = String(crop && crop.id || "");
                    if (!cropId || !target || seenCropIds.has(cropId)) return;
                    seenCropIds.add(cropId);
                    items.push({ message: cropLabel(crop), target }); // CHANGE
                };
                const missingForLine = line => {
                    const crop = PlanMath.findCrop(plan, line && line.cropId);
                    if (!crop || !Number.isFinite(PlanMath.resolveUnitToKgPerUnit(crop, line && line.unit))) return null;
                    if (Number.isFinite(PlanMath.resolvePackagePriceForUnit(crop, line && line.unit))) return null;
                    const packageIndex = packageIndexForUnit(crop, line && line.unit);
                    return packageIndex >= 0 ? { crop, target: { area: "crop", cropId: String(crop.id || ""), tab: "packages", field: "price", packageIndex } } : null; // CHANGE
                };
                for (const line of ((plan && plan.selfSufficiency && plan.selfSufficiency.lines) || [])) {
                    const found = missingForLine(line);
                    if (found) addCropTarget(found.crop, found.target); // CHANGE
                }
                for (const line of ((plan && plan.demands) || [])) {
                    const found = missingForLine(line);
                    if (found) addCropTarget(found.crop, found.target); // CHANGE
                }
                for (const component of ((plan && plan.csa && plan.csa.components) || [])) {
                    const crop = PlanMath.findCrop(plan, component && component.cropId);
                    if (!crop || !Number.isFinite(PlanMath.resolveUnitToKgPerUnit(crop, component && component.unit))) continue;
                    if (Number.isFinite(PlanMath.resolvePackagePriceForUnit(crop, component && component.unit))) continue;
                    const packageIndex = packageIndexForUnit(crop, component && component.unit);
                    if (packageIndex >= 0) addCropTarget(crop, { area: "crop", cropId: String(crop.id || ""), tab: "packages", field: "price", packageIndex }); // CHANGE
                }
                return items;
            } // CHANGE: missing price badges list each affected crop once, with row-level navigation.

            function firstMissingPackagePriceTarget() {
                const first = missingPackagePriceItems()[0]; // CHANGE
                return first && first.target || null; // CHANGE
            } // NEW: price warnings navigate to the package row that can repair the understated value.

            function missingPackagePriceTargetForLine(line) {
                const crop = PlanMath.findCrop(plan, line && line.cropId);
                if (!crop || !Number.isFinite(PlanMath.resolveUnitToKgPerUnit(crop, line && line.unit))) return null;
                if (Number.isFinite(PlanMath.resolvePackagePriceForUnit(crop, line && line.unit))) return null;
                const packageIndex = packageIndexForUnit(crop, line && line.unit);
                return packageIndex >= 0 ? { area: "crop", cropId: String(crop.id || ""), tab: "packages", field: "price", packageIndex } : null;
            } // CHANGE

            function navigateToMissingPackagePrice(event) {
                const target = firstMissingPackagePriceTarget();
                if (!target) return scrollToPlanCheck();
                if (target.cropId) openCropPackages(target.cropId);
                if (!activateYearPlanTarget(target, scrollToPlanCheck, event && event.currentTarget)) scrollToPlanCheck(); // CHANGE
            } // NEW

            function findTargetControl(target) {
                if (!target || typeof target !== "object") return null;
                if (target.area === "crop" && target.field === "addPackage") return findAddPackageButton(); // CHANGE
                const selectorParts = [`[data-year-plan-field="${String(target.field || "").replace(/"/g, '\\"')}"]`];
                if (target.cropId) selectorParts.push(`[data-crop-id="${String(target.cropId).replace(/"/g, '\\"')}"]`);
                if (target.packageIndex !== undefined) selectorParts.push(`[data-package-index="${String(target.packageIndex).replace(/"/g, '\\"')}"]`);
                if (target.componentIndex !== undefined) selectorParts.push(`[data-csa-component-index="${String(target.componentIndex).replace(/"/g, '\\"')}"]`);
                if (target.channelId) selectorParts.push(`[data-year-plan-demand-channel-id="${String(target.channelId).replace(/"/g, '\\"')}"]`);
                if (target.lineId) selectorParts.push(`[data-year-plan-demand-line-id="${String(target.lineId).replace(/"/g, '\\"')}"]`);
                if (target.selfLineId) selectorParts.push(`[data-year-plan-self-line-id="${String(target.selfLineId).replace(/"/g, '\\"')}"]`); // NEW
                if (target.selfLineIndex !== undefined) selectorParts.push(`[data-year-plan-self-line-index="${String(target.selfLineIndex).replace(/"/g, '\\"')}"]`); // NEW
                return card.querySelector(selectorParts.join(""));
            }

            function targetWithField(target, field) {
                return target && field ? { ...target, field } : null;
            } // CHANGE

            function relatedTargetsFor(target, result) {
                const fields = result && Array.isArray(result.relatedFields) ? result.relatedFields : target && target.relatedFields;
                if (fields && fields.length) return fields.map(field => targetWithField(target, field)).filter(Boolean);
                const code = String(result && result.code || "");
                const field = String(target && target.field || "");
                if (/date|harvest_window/i.test(code) || ["from", "start", "harvestStart"].includes(field)) {
                    if (target && target.area === "crop") return [targetWithField(target, "harvestStart"), targetWithField(target, "harvestEnd")];
                    if (target && target.area === "csa" && target.componentIndex !== undefined) return [targetWithField(target, "start"), targetWithField(target, "end")];
                    if (target && target.area === "csa") return [targetWithField(target, "start"), targetWithField(target, "end")];
                    if (target && target.area === "demand") return [targetWithField(target, "from"), targetWithField(target, "to")];
                    if (target && target.area === "self-sufficiency") return [targetWithField(target, "from"), targetWithField(target, "to")];
                }
                return [];
            } // CHANGE

            function revealYearPlanTarget(target) {
                if (!target || typeof target !== "object") return;
                if (target.area === "crop") {
                    const targetTab = target.tab || "basics";
                    const needsCropRender = String(state.selectedCropId || "") !== String(target.cropId || "") || state.activeTab !== targetTab;
                    if (target.cropId && setSelectedCropEverywhere(target.cropId, { expandCropPlan: true, expandPlanCheck: true, activeTab: targetTab }) && needsCropRender) {
                        renderCropList(); renderSelectedEditor(); renderCropPlan(false); renderPlanCheck();
                    }
                } else if (target.area === "csa") {
                    state.csaExpanded = true;
                    renderCsa(true);
                } else if (target.area === "self-sufficiency") {
                    state.selfSufficiencyExpanded = true;
                    const line = target.selfLineId
                        ? ((plan.selfSufficiency && plan.selfSufficiency.lines) || []).find(item => String(item && item.id || "") === String(target.selfLineId))
                        : ((plan.selfSufficiency && plan.selfSufficiency.lines) || [])[Math.max(0, Math.trunc(Number(target.selfLineIndex) || 0))];
                    if (line) state.collapsedSelfSufficiencyLineIds.delete(String(line.id || ""));
                    renderSelfSufficiencyStrip(true);
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
                    syncDemandDerived();
                } else if (target.area === "crop-list") {
                    state.cropPlanExpanded = true;
                    renderCropPlan(false);
                } else if (target.area === "plan-check") {
                    state.planCheckExpanded = true;
                    renderPlanCheck();
                }
            } // CHANGE

            function findHighlightTarget(target) {
                if (!target || typeof target !== "object") return null;
                if (target.area === "plan-check") {
                    if (target.cropId) return findPlanCheckCropRow(target.cropId);
                    if (target.chipKind) return planCheckSummary.querySelector(`.yp-chip[data-chip-kind="${String(target.chipKind).replace(/"/g, '\\"')}"]`);
                    if (target.rowKind) return totalsBox.querySelector(`[data-plan-check-row-kind="${String(target.rowKind).replace(/"/g, '\\"')}"]`);
                    if (target.section === "diagnostics") return diagnosticsBox;
                    if (target.section === "summary") return planCheckSummary; // CHANGE
                    return planCheckBox;
                }
                if (target.area === "demand") {
                    if (target.lineId) return demandBox.querySelector(`[data-demand-line-id="${String(target.lineId).replace(/"/g, '\\"')}"]`); // CHANGE
                    if (target.channelId) return demandBox.querySelector(`[data-demand-channel-id="${String(target.channelId).replace(/"/g, '\\"')}"]`); // CHANGE
                    return demandBox;
                }
                if (target.area === "self-sufficiency") {
                    if (target.section === "nutrition") return selfSufficiencyBox.querySelector("[data-year-plan-nutrition-section]"); // CHANGE
                    if (target.selfLineId) return selfSufficiencyBox.querySelector(`[data-self-line-id="${String(target.selfLineId).replace(/"/g, '\\"')}"]`); // CHANGE
                    return selfSufficiencyBox;
                }
                if (target.area === "csa") {
                    if (target.componentIndex !== undefined) return csaBox.querySelector(`[data-csa-component-index="${String(target.componentIndex).replace(/"/g, '\\"')}"]`); // CHANGE
                    return csaBox;
                }
                if (target.area === "crop") {
                    if (target.cropId) return card.querySelector(`.yp-crop-card[data-crop-id="${String(target.cropId).replace(/"/g, '\\"')}"]`) || editorBox;
                    return cropPlanBox;
                }
                return null;
            } // CHANGE

            function activateYearPlanTarget(targets, fallback, fallbackTrigger, result) {
                const list = (Array.isArray(targets) ? targets : [targets]).filter(Boolean);
                if (!list.length) {
                    if (typeof fallback === "function") fallback();
                    return focusAndHighlight(fallbackTrigger);
                }
                const primary = list[0];
                revealYearPlanTarget(primary);
                const primaryControl = primary.field ? findTargetControl(primary) : null;
                const relatedControls = list.concat(relatedTargetsFor(primary, result)).slice(1).map(findTargetControl).filter(Boolean);
                if (primaryControl && primaryControl.disabled) return focusAndHighlight(fallbackTrigger) || scrollAndHighlightTarget(findHighlightTarget(primary)); // CHANGE
                if (primaryControl && focusAndHighlight(primaryControl, relatedControls)) return true;
                if (relatedControls.length && focusAndHighlight(relatedControls[0], relatedControls.slice(1))) return true;
                if (scrollAndHighlightTarget(findHighlightTarget(primary))) return true;
                if (typeof fallback === "function") fallback();
                return focusAndHighlight(fallbackTrigger);
            } // CHANGE

            function navigateToValidation(result, fallbackTrigger) {
                const target = result && result.target;
                return activateYearPlanTarget([target].concat(relatedTargetsFor(target, result)), null, fallbackTrigger, result); // CHANGE
            }

            function diagnosticItemMessage(item) {
                if (typeof item === "string") return String(item || "").trim();
                return String(item && item.message || validationMessage(item) || "").trim();
            } // CHANGE

            function diagnosticItemIsActionable(item) {
                return !!(item && (item.target || item.action || item.result));
            } // CHANGE

            function activateDiagnosticItem(item, trigger, event) {
                if (event) { event.preventDefault(); event.stopPropagation(); }
                closeDiagnosticsPopovers(null); // CHANGE
                if (item && typeof item.action === "function") return item.action(event);
                if (item && item.result) return navigateToValidation(item.result, trigger);
                if (item && item.target) return activateYearPlanTarget(item.target, null, trigger, item.result);
                return false;
            } // CHANGE

            function appendDiagnosticPopoverItem(popover, item, trigger) {
                const message = diagnosticItemMessage(item);
                if (!message) return;
                const actionable = diagnosticItemIsActionable(item);
                const row = document.createElement(actionable ? "button" : "div");
                if (actionable) row.type = "button";
                row.className = actionable ? "yp-diagnostics-item" : "yp-diagnostics-message";
                row.textContent = message;
                if (item && item.sourceLabel) {
                    const source = document.createElement("span");
                    source.className = "yp-diagnostics-item-source";
                    source.textContent = item.sourceLabel;
                    row.appendChild(source);
                }
                if (actionable) row.addEventListener("click", event => activateDiagnosticItem(item, trigger, event));
                popover.appendChild(row);
            } // CHANGE

            function createActionablePopoverChip(label, value, tone, items, singleAction, options) {
                const diagnostics = (items || []).filter(item => diagnosticItemMessage(item));
                const actionable = diagnostics.filter(diagnosticItemIsActionable);
                if (actionable.length <= 1) {
                    const direct = event => {
                        if (actionable[0]) return activateDiagnosticItem(actionable[0], event && event.currentTarget, event);
                        if (typeof singleAction === "function") return singleAction(event);
                        return false;
                    };
                    return createChip(label, value, tone, actionable.length || singleAction ? direct : null, options);
                }
                const wrapControl = document.createElement("span");
                wrapControl.className = "yp-diagnostics-wrap";
                let popover = null;
                let show = null;
                const chip = createChip(label, value, tone, event => {
                    event.preventDefault(); event.stopPropagation();
                    const nextPinned = wrapControl.dataset.pinned !== "true";
                    wrapControl.dataset.pinned = nextPinned ? "true" : "false";
                    if (nextPinned) show(true);
                    else popover.hidden = true;
                }, options); // CHANGE
                popover = document.createElement("div");
                popover.className = "yp-diagnostics-popover";
                popover.dataset.tone = tone || "neutral";
                popover.hidden = true;
                popover.__ypDiagnosticsOwner = wrapControl;
                const title = document.createElement("div");
                title.className = "yp-diagnostics-title";
                title.textContent = options && options.popoverTitle ? String(options.popoverTitle) : label;
                popover.appendChild(title);
                for (const item of diagnostics) appendDiagnosticPopoverItem(popover, item, chip);
                show = pinned => { closeDiagnosticsPopovers(popover); positionDiagnosticsPopover(chip, popover); if (pinned) wrapControl.dataset.pinned = "true"; };
                const hide = () => { if (wrapControl.dataset.pinned !== "true") popover.hidden = true; };
                chip.addEventListener("focus", () => show(false));
                chip.addEventListener("mouseenter", () => show(false));
                wrapControl.addEventListener("mouseleave", event => { if (!popover.contains(event.relatedTarget)) hide(); });
                popover.addEventListener("mouseleave", hide);
                popover.addEventListener("click", event => event.stopPropagation());
                wrapControl.addEventListener("click", event => event.stopPropagation());
                wrapControl.appendChild(chip);
                diagnosticsLayer.appendChild(popover);
                return wrapControl;
            } // CHANGE: multi-item warning badges open a chooser; single-item badges stay direct.

            function createDiagnosticsControl(label, results, options) {
                const settings = options || {}; // CHANGE
                const warningItems = Array.isArray(settings.groupedWarnings) ? settings.groupedWarnings : null; // CHANGE
                const diagnostics = warningItems || (results || []).filter(error => validationMessage(error)); // CHANGE
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
                if (settings.tone) popover.dataset.tone = String(settings.tone); // CHANGE
                popover.hidden = true;
                popover.__ypDiagnosticsOwner = wrapControl; // CHANGE
                const title = document.createElement("div");
                title.className = "yp-diagnostics-title";
                title.textContent = label;
                popover.appendChild(title);
                if (warningItems) { // CHANGE
                    const groups = new Map(); // CHANGE
                    for (const warning of warningItems) { // CHANGE
                        const key = String(warning && warning.type || "plan-check"); // CHANGE
                        if (!groups.has(key)) groups.set(key, []); // CHANGE
                        groups.get(key).push(warning); // CHANGE
                    } // CHANGE
                    for (const [type, items] of groups) { // CHANGE
                        appendDiagnosticsSection(popover, label, type, warningTypeLabel(type), items, trigger); // CHANGE
                    } // CHANGE
                } else {
                    appendDiagnosticsSection(popover, label, "diagnostics", "Diagnostics", diagnostics.map(result => ({ message: validationMessage(result), target: result && result.target, result })), trigger); // CHANGE
                }
                const show = pinned => { closeDiagnosticsPopovers(popover); positionDiagnosticsPopover(trigger, popover); if (pinned) wrapControl.dataset.pinned = "true"; }; // CHANGE
                const hide = () => { if (wrapControl.dataset.pinned !== "true") popover.hidden = true; };
                trigger.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); const nextPinned = wrapControl.dataset.pinned !== "true"; wrapControl.dataset.pinned = nextPinned ? "true" : "false"; if (nextPinned) show(true); else popover.hidden = true; });
                trigger.addEventListener("focus", () => show(false));
                trigger.addEventListener("mouseenter", () => show(false));
                wrapControl.addEventListener("mouseleave", event => { if (!popover.contains(event.relatedTarget)) hide(); }); // CHANGE
                popover.addEventListener("mouseleave", hide); // CHANGE
                popover.addEventListener("click", event => event.stopPropagation()); // CHANGE
                wrapControl.addEventListener("click", event => event.stopPropagation());
                wrapControl.appendChild(trigger);
                diagnosticsLayer.appendChild(popover); // CHANGE: hidden details should not pollute strip/header textContent.
                return wrapControl;
            }

            function createMessagePopoverChip(label, tone, messages, action, options) {
                const diagnostics = (messages || []).map(message => typeof message === "string" ? { message: String(message || "").trim() } : message).filter(item => diagnosticItemMessage(item)); // CHANGE
                if (diagnostics.some(diagnosticItemIsActionable)) return createActionablePopoverChip(label, "", tone, diagnostics, action, options); // CHANGE
                const chip = createChip(label, "", tone, action, options); // CHANGE
                if (!diagnostics.length) return chip;
                const wrapControl = document.createElement("span");
                wrapControl.className = "yp-diagnostics-wrap";
                const popover = document.createElement("div");
                popover.className = "yp-diagnostics-popover";
                popover.dataset.tone = tone || "neutral";
                popover.hidden = true;
                popover.__ypDiagnosticsOwner = wrapControl; // CHANGE
                const title = document.createElement("div");
                title.className = "yp-diagnostics-title";
                title.textContent = options && options.popoverTitle ? String(options.popoverTitle) : label; // CHANGE
                popover.appendChild(title);
                for (const item of diagnostics) appendDiagnosticPopoverItem(popover, item, chip); // CHANGE
                const show = () => { closeDiagnosticsPopovers(popover); positionDiagnosticsPopover(chip, popover); }; // CHANGE
                const hide = () => { popover.hidden = true; };
                chip.addEventListener("focus", show);
                chip.addEventListener("mouseenter", show);
                wrapControl.addEventListener("mouseleave", event => { if (!popover.contains(event.relatedTarget)) hide(); }); // CHANGE
                popover.addEventListener("mouseleave", hide); // CHANGE
                popover.addEventListener("click", event => event.stopPropagation()); // CHANGE
                wrapControl.appendChild(chip);
                diagnosticsLayer.appendChild(popover); // CHANGE: hidden details should not pollute badge host textContent.
                return wrapControl;
            } // CHANGE: warning attention chips can show formatted plain-message popovers without losing chip clicks.

            function createDiagnosticsChip(label, tone, results, onClick, options) {
                const wrapControl = document.createElement("span");
                wrapControl.className = "yp-diagnostics-wrap";
                const items = (results || []).map(result => ({ message: validationMessage(result), target: result && result.target, result })); // CHANGE
                wrapControl.appendChild(createActionablePopoverChip(label, "", tone, items, onClick, options)); // CHANGE
                const diagnostics = createWholePlanDiagnosticsControl(label); // CHANGE
                if (diagnostics) wrapControl.appendChild(diagnostics);
                return wrapControl;
            }

            function createValidationAttentionChip(label, tone, results, countIssues, fallback) {
                const diagnostics = (results || []).filter(error => validationMessage(error));
                const displayLabel = countIssues ? countedValidationLabel(label, diagnostics) : label;
                const openFirstIssue = event => {
                    const first = diagnostics[0];
                    if (first && navigateToValidation(first, event && event.currentTarget)) return;
                    if (typeof fallback === "function") fallback(event);
                };
                return createDiagnosticsChip(displayLabel, tone, diagnostics, openFirstIssue, { title: validationTooltip(diagnostics) });
            } // NEW: aggregate badges jump to the first issue while the adjacent diagnostics lists every issue.

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
                const priceDiagnostics = ((dashboard && dashboard.diagnostics) || []).filter(message => /no matching package price is set/i.test(String(message || ""))); // NEW
                const priceItems = missingPackagePriceItems(); // CHANGE
                if (priceDiagnostics.length) add(createMessagePopoverChip(`Missing package price${priceItems.length === 1 ? "" : "s"}`, "warning", priceItems.length ? priceItems : priceDiagnostics, navigateToMissingPackagePrice, { popoverTitle: "Missing package prices" })); // CHANGE
                for (const metric of ((dashboard && dashboard.cropMetrics) || [])) {
                    const cropDiagnostics = cropValidationResults(metric.crop.id);
                    if (metric.status === "Missing data") add(createValidationAttentionChip(`${cropLabel(metric.crop)} missing data`, "danger", cropDiagnostics, false, () => selectCropFromAttention(metric.crop.id)));
                    else if (cropDiagnostics.length) add(createValidationAttentionChip(`${cropLabel(metric.crop)} diagnostics`, "danger", cropDiagnostics, false, () => selectCropFromAttention(metric.crop.id)));
                    else if (metric.status === "Short") add(createChip(`${cropLabel(metric.crop)} short ${formatKg(metric.shortKg)}`, "", "danger", () => selectCropFromAttention(metric.crop.id, { highlightPlanCheckRow: true }))); // CHANGE
                    else if (metric.status === "Expired / timing issue") add(createChip(`${cropLabel(metric.crop)} timing ${formatKg(metric.shortKg)}`, "", "warning", () => selectCropFromAttention(metric.crop.id, { highlightPlanCheckRow: true }))); // CHANGE
                }
                if (chartSummary && chartSummary.expiredKg > EPS) add(createChip(`Expired ${formatKg(chartSummary.expiredKg)}`, "", "warning", null, { primaryTarget: { area: "plan-check", chipKind: "expired" }, chipKind: "attention-expired" })); // CHANGE
                const demandErrors = PlanSchema.validateDemand(plan); // NEW
                if (demandErrors.length) add(createValidationAttentionChip("Demand dates invalid", "danger", demandErrors, true, () => { state.demandExpanded = true; renderDemandStrip(true); })); // CHANGE
                const selfErrors = PlanSchema.validateSelfSufficiency(plan); // NEW
                if (selfErrors.length) add(createValidationAttentionChip("Self Sufficiency needs setup", "danger", selfErrors, true, () => { state.selfSufficiencyExpanded = true; renderSelfSufficiencyStrip(true); })); // CHANGE
                const csaErrors = PlanSchema.validateCsa(plan); // NEW
                if (csaErrors.length) add(createValidationAttentionChip("CSA setup issues", "danger", csaErrors, true, () => { state.csaExpanded = true; renderCsa(true); })); // CHANGE
                if ((dashboard && dashboard.diagnostics || []).length && !items.length) add(createChip("Plan Check has diagnostics", "", "warning", null, { title: (dashboard.diagnostics || []).join("\n"), primaryTarget: { area: "plan-check", section: "diagnostics" }, chipKind: "plan-check-diagnostics" })); // CHANGE
                return items;
            }

            function selectCropFromAttention(cropId, options) {
                if (!setSelectedCropEverywhere(cropId, { expandCropPlan: true, expandPlanCheck: true })) return;
                renderCropList();
                renderSelectedEditor();
                renderCropPlan(false);
                renderPlanCheck();
                if (options && options.highlightPlanCheckRow) scrollAndHighlightTarget(findPlanCheckCropRow(cropId)); // CHANGE
                else if (options && options.scrollPlanCheckRow) scrollToPlanCheckCropRow(cropId); // NEW
            } // CHANGE

            const ADD_PACKAGES_UNIT_VALUE = "__trellis_add_packages__"; // CHANGE

            function defaultUnit(crop) {
                const first = PlanMath.packageUnitOptions(crop)[0];
                return first ? String(first.value || "") : "";
            } // CHANGE

            function packageUnitKey(unit) {
                return String(unit || "").trim().toLowerCase();
            } // CHANGE

            function createDefaultPackage(crop) {
                const existing = new Set(((crop && crop.packages) || []).map(pkg => packageUnitKey(pkg && pkg.unit)).filter(Boolean));
                const nextStandard = STANDARD_WEIGHT_PACKAGE_UNITS.find(unit => !existing.has(unit));
                return { unit: nextStandard || "", baseType: nextStandard || "kg", baseQty: 1, price: NaN };
            } // CHANGE

            function packageRowTarget(crop, packageIndex, field) {
                return { area: "crop", cropId: String(crop && crop.id || ""), tab: "packages", field: field || "unit", packageIndex };
            } // CHANGE

            function findPackageRow(target) {
                if (!target || target.area !== "crop" || target.packageIndex === undefined) return null;
                const cropSelector = String(target.cropId || "").replace(/"/g, '\\"');
                const indexSelector = String(target.packageIndex).replace(/"/g, '\\"');
                return editorBox.querySelector(`.yp-package-row[data-crop-id="${cropSelector}"][data-package-index="${indexSelector}"]`);
            } // CHANGE

            function addPackageAndFocusUnit(cropOrId) {
                const crop = typeof cropOrId === "object" ? cropOrId : PlanMath.findCrop(plan, cropOrId);
                if (!crop) return null;
                crop.packages = Array.isArray(crop.packages) ? crop.packages : [];
                crop.packages.push(createDefaultPackage(crop)); // CHANGE
                const packageIndex = crop.packages.length - 1;
                openCropPackages(crop.id);
                const target = packageRowTarget(crop, packageIndex, "unit");
                scrollAndHighlightTarget(findPackageRow(target)); // CHANGE
                activateYearPlanTarget(target, null, null); // CHANGE
                refreshDerived(null, { rebuildSelfSufficiency: true, rebuildDemand: true, rebuildCsa: true }); // CHANGE
                return target;
            } // CHANGE

            function findAddPackageButton() {
                return Array.from(editorBox.querySelectorAll("button")).find(button => button.textContent.trim() === "Add package") || null;
            } // CHANGE

            function openCropPackagesSetup(cropId) {
                openCropPackages(cropId);
                const add = findAddPackageButton();
                if (add && typeof add.focus === "function") add.focus();
                highlightElements(add, "yp-target-highlight");
                scrollToElement(add || editorBox.querySelector("[data-year-plan-packages-section]") || editorBox, "center");
            } // CHANGE: planned-crop package warnings navigate to the corrective Packages action.

            function mkPackageUnitSelect(crop, selectedUnit, width, allowedUnitKeys) {
                const selectedKey = packageUnitKey(selectedUnit);
                const allowed = allowedUnitKeys ? new Set(Array.from(allowedUnitKeys).map(packageUnitKey).filter(Boolean)) : null;
                const options = PlanMath.packageUnitOptions(crop).filter(option => !allowed || allowed.has(packageUnitKey(option && option.value)) || packageUnitKey(option && option.value) === selectedKey); // CHANGE
                const selectedOption = options.find(option => packageUnitKey(option && option.value) === selectedKey);
                const value = selectedOption ? String(selectedOption.value || "") : "";
                const select = mkSelect([], "", width);
                const placeholder = new Option(options.length ? "-- Select package unit --" : "-- Add package unit --", "");
                placeholder.disabled = true;
                select.appendChild(placeholder);
                for (const option of options) select.appendChild(new Option(option.label, option.value));
                const addPackages = new Option("Add packages...", ADD_PACKAGES_UNIT_VALUE);
                addPackages.disabled = !crop;
                select.appendChild(addPackages);
                select.value = value;
                return select;
            } // CHANGE

            function handlePackageUnitSelection(select, cropId, setUnit, refresh) {
                if (select.value === ADD_PACKAGES_UNIT_VALUE) {
                    setUnit("");
                    select.value = "";
                    if (typeof refresh === "function") refresh();
                    if (cropId) addPackageAndFocusUnit(cropId); // CHANGE
                    return;
                }
                setUnit(select.value);
                if (typeof refresh === "function") refresh();
            }

            function demandDestinationKey(kind, destinationId) {
                return `${String(kind || "")}:${String(destinationId || "")}`;
            } // CHANGE

            function demandDestinationPickerKey(kind, destinationId) {
                return `package-picker:${demandDestinationKey(kind, destinationId)}`;
            } // CHANGE

            function demandDestinationRows(kind, destinationId) {
                if (kind === "demand") return (plan.demands || []).filter(line => String(line && line.channelId || "") === String(destinationId || ""));
                if (kind === "self") return (plan.selfSufficiency && plan.selfSufficiency.lines) || [];
                if (kind === "csa") return (plan.csa && plan.csa.components) || [];
                return [];
            } // CHANGE

            function rowCropId(row) {
                return String(row && row.cropId || "");
            } // CHANGE

            function rowUnit(row) {
                return String(row && row.unit || "");
            } // CHANGE

            function usedPackageKeysForDestination(kind, destinationId, cropId, currentRow) {
                const keys = new Set();
                for (const row of demandDestinationRows(kind, destinationId)) {
                    if (row === currentRow || rowCropId(row) !== String(cropId || "")) continue;
                    const key = packageUnitKey(rowUnit(row));
                    if (key) keys.add(key);
                }
                return keys;
            } // CHANGE

            function firstUnusedPackageUnit(crop, kind, destinationId, currentRow) {
                const used = usedPackageKeysForDestination(kind, destinationId, crop && crop.id, currentRow);
                const option = PlanMath.packageUnitOptions(crop).find(item => !used.has(packageUnitKey(item && item.value)));
                return option ? String(option.value || "") : "";
            } // CHANGE

            function allowedPackageKeysForRow(crop, selectedUnit, kind, destinationId, currentRow) {
                const selectedKey = packageUnitKey(selectedUnit);
                const used = usedPackageKeysForDestination(kind, destinationId, crop && crop.id, currentRow);
                const keys = new Set();
                for (const option of PlanMath.packageUnitOptions(crop)) {
                    const key = packageUnitKey(option && option.value);
                    if (!key) continue;
                    if (!used.has(key) || key === selectedKey) keys.add(key);
                }
                return keys;
            } // CHANGE

            function packageCoverageForDestination(kind, destinationId) {
                const included = new Map();
                for (const row of demandDestinationRows(kind, destinationId)) {
                    const cropId = rowCropId(row);
                    const key = packageUnitKey(rowUnit(row));
                    if (!cropId || !key) continue;
                    if (!included.has(cropId)) included.set(cropId, new Set());
                    included.get(cropId).add(key);
                }
                const cropStats = [];
                for (const crop of (plan.crops || [])) {
                    const packages = PlanMath.packageUnitOptions(crop);
                    const used = included.get(String(crop && crop.id || "")) || new Set();
                    const missing = packages.filter(option => !used.has(packageUnitKey(option && option.value)));
                    const present = packages.filter(option => used.has(packageUnitKey(option && option.value)));
                    cropStats.push({ crop, packages, missing, present });
                }
                return cropStats;
            } // CHANGE

            function packageTransferKey(cropId, unit) {
                const cropKey = String(cropId || "");
                const unitKey = packageUnitKey(unit);
                return cropKey && unitKey ? `${cropKey}::${unitKey}` : "";
            } // CHANGE

            function packageTransferCoverage(kind, destinationId) {
                const crops = (plan.crops || []).slice().sort((a, b) => cropLabel(a).localeCompare(cropLabel(b)));
                const packageByKey = new Map();
                const includedRows = [];
                const rows = demandDestinationRows(kind, destinationId);
                for (const [rowIndex, row] of rows.entries()) {
                    const crop = PlanMath.findCrop(plan, rowCropId(row));
                    if (!crop) continue;
                    const unitKey = packageUnitKey(rowUnit(row));
                    if (!unitKey) continue;
                    const option = PlanMath.packageUnitOptions(crop).find(item => packageUnitKey(item && item.value) === unitKey);
                    if (!option) continue;
                    const cropId = String(crop.id || "");
                    const itemKey = packageTransferKey(cropId, option.value);
                    includedRows.push({
                        id: `row:${rowIndex}`,
                        key: itemKey,
                        crop,
                        cropId,
                        unit: String(option.value || ""),
                        label: String(option.label || option.value || ""),
                        row,
                        duplicate: false
                    });
                }
                const seenIncluded = new Set();
                for (const entry of includedRows) {
                    entry.duplicate = seenIncluded.has(entry.key);
                    seenIncluded.add(entry.key);
                }
                for (const crop of crops) {
                    const cropId = String(crop && crop.id || "");
                    for (const option of PlanMath.packageUnitOptions(crop)) {
                        const key = packageTransferKey(cropId, option && option.value);
                        if (!key || packageByKey.has(key)) continue;
                        packageByKey.set(key, {
                            key,
                            crop,
                            cropId,
                            unit: String(option && option.value || ""),
                            label: String(option && option.label || option && option.value || "")
                        });
                    }
                }
                return { crops, packageByKey, includedRows, totalPackages: packageByKey.size };
            } // CHANGE

            function removePackageTransferRows(kind, destinationId, rowsToRemove) {
                const removeSet = new Set(rowsToRemove || []);
                if (!removeSet.size) return;
                if (kind === "demand") {
                    plan.demands = (plan.demands || []).filter(line => {
                        if (!removeSet.has(line)) return true;
                        state.collapsedDemandLineIds.delete(String(line && line.id || ""));
                        return false;
                    });
                    state.collapsedDemandChannelIds.delete(String(destinationId || ""));
                } else if (kind === "self") {
                    plan.selfSufficiency = plan.selfSufficiency || { adults: 0, children: 0, nutritionMultiplier: 1, lines: [] };
                    plan.selfSufficiency.lines = (plan.selfSufficiency.lines || []).filter(line => {
                        if (!removeSet.has(line)) return true;
                        state.collapsedSelfSufficiencyLineIds.delete(String(line && line.id || ""));
                        return false;
                    });
                } else if (kind === "csa") {
                    plan.csa = plan.csa || { enabled: false, boxesPerWeek: 0, start: "", end: "", salePricePerBox: null, salePriceMode: "auto", components: [] };
                    plan.csa.components = (plan.csa.components || []).filter(component => !removeSet.has(component));
                }
            } // CHANGE

            function packageLinkedRows(crop, pkg) { // CHANGE
                const cropId = String(crop && crop.id || ""); // CHANGE
                const unitKey = packageUnitKey(pkg && pkg.unit); // CHANGE
                if (!cropId || !unitKey) return []; // CHANGE
                const rows = []; // CHANGE
                for (const line of (plan.demands || [])) { // CHANGE
                    if (rowCropId(line) === cropId && packageUnitKey(rowUnit(line)) === unitKey) rows.push({ kind: "demand", row: line }); // CHANGE
                } // CHANGE
                for (const line of ((plan.selfSufficiency && plan.selfSufficiency.lines) || [])) { // CHANGE
                    if (rowCropId(line) === cropId && packageUnitKey(rowUnit(line)) === unitKey) rows.push({ kind: "self", row: line }); // CHANGE
                } // CHANGE
                for (const [componentIndex, component] of ((plan.csa && plan.csa.components) || []).entries()) { // CHANGE
                    if (rowCropId(component) === cropId && packageUnitKey(rowUnit(component)) === unitKey) rows.push({ kind: "csa", row: component, componentIndex }); // CHANGE
                } // CHANGE
                return rows; // CHANGE
            } // CHANGE

            function packageLinkedRowLabel(entry) { // CHANGE
                const row = entry && entry.row || {}; // CHANGE
                const crop = PlanMath.findCrop(plan, rowCropId(row)); // CHANGE
                const qty = `${formatCompactNumber(row.qty)} ${row.unit || "No unit"}`; // CHANGE
                const from = YearPlanDashboard.formatYmd(row.from || row.start || (entry.kind === "csa" && plan.csa && plan.csa.start) || "") || "?"; // CHANGE
                const to = YearPlanDashboard.formatYmd(row.to || row.end || (entry.kind === "csa" && plan.csa && plan.csa.end) || "") || "?"; // CHANGE
                if (entry.kind === "demand") { // CHANGE
                    const channel = (plan.demandChannels || []).find(item => String(item && item.id || "") === String(row.channelId || "")); // CHANGE
                    return `Demand - ${String(channel && channel.label || row.channelId || "Channel")}: ${cropLabel(crop)} ${qty} / ${demandFrequencyLabel(row.frequency, row.everyN)} (${from}-${to})`; // CHANGE
                } // CHANGE
                if (entry.kind === "self") return `Self-use - ${cropLabel(crop)} ${qty} / ${demandFrequencyLabel(row.frequency, row.everyN)} (${from}-${to})`; // CHANGE
                return `CSA component ${Number(entry.componentIndex) + 1} - ${cropLabel(crop)} ${qty} (${from}-${to})`; // CHANGE
            } // CHANGE

            function packageDeletionConfirmMessage(crop, pkg, linkedRows) { // CHANGE
                const unit = String(pkg && pkg.unit || "package").trim() || "package"; // CHANGE
                const lines = (linkedRows || []).map(entry => `- ${packageLinkedRowLabel(entry)}`).join("\n"); // CHANGE
                return `Remove package "${unit}" from ${cropLabel(crop)}?\n\nThe following linked rows will also be deleted:\n${lines}\n\nContinue?`; // CHANGE
            } // CHANGE

            function removeLinkedPackageRows(linkedRows) { // CHANGE
                const demandRows = new Set((linkedRows || []).filter(entry => entry.kind === "demand").map(entry => entry.row)); // CHANGE
                const selfRows = new Set((linkedRows || []).filter(entry => entry.kind === "self").map(entry => entry.row)); // CHANGE
                const csaRows = new Set((linkedRows || []).filter(entry => entry.kind === "csa").map(entry => entry.row)); // CHANGE
                if (demandRows.size) { // CHANGE
                    plan.demands = (plan.demands || []).filter(line => { // CHANGE
                        if (!demandRows.has(line)) return true; // CHANGE
                        state.collapsedDemandLineIds.delete(String(line && line.id || "")); // CHANGE
                        return false; // CHANGE
                    }); // CHANGE
                } // CHANGE
                if (selfRows.size && plan.selfSufficiency) { // CHANGE
                    plan.selfSufficiency.lines = ((plan.selfSufficiency && plan.selfSufficiency.lines) || []).filter(line => { // CHANGE
                        if (!selfRows.has(line)) return true; // CHANGE
                        state.collapsedSelfSufficiencyLineIds.delete(String(line && line.id || "")); // CHANGE
                        return false; // CHANGE
                    }); // CHANGE
                } // CHANGE
                if (csaRows.size && plan.csa) plan.csa.components = ((plan.csa && plan.csa.components) || []).filter(component => !csaRows.has(component)); // CHANGE
            } // CHANGE

            function removePackageAndLinkedRows(crop, pkg) { // CHANGE
                const linkedRows = packageLinkedRows(crop, pkg); // CHANGE
                if (linkedRows.length && !confirm(packageDeletionConfirmMessage(crop, pkg, linkedRows))) return false; // CHANGE
                crop.packages = (crop.packages || []).filter(item => item !== pkg); // CHANGE
                removeLinkedPackageRows(linkedRows); // CHANGE
                return true; // CHANGE
            } // CHANGE

            function applyPackageTransferChanges(kind, destinationId, addedPackages, removedRows, callbacks) {
                removePackageTransferRows(kind, destinationId, removedRows);
                if (kind === "demand") {
                    if (!(plan.demandChannels || []).some(channel => String(channel.id) === String(destinationId))) return;
                    for (const selection of (addedPackages || [])) {
                        const line = createDemandLine(destinationId, selection);
                        plan.demands.push(line);
                        state.collapsedDemandLineIds.delete(String(line.id || ""));
                    }
                    state.collapsedDemandChannelIds.delete(String(destinationId || ""));
                    saveCollapsePreferences();
                    refreshDerived(null, { rebuildDemand: true });
                } else if (kind === "self") {
                    plan.selfSufficiency = plan.selfSufficiency || { adults: 0, children: 0, nutritionMultiplier: 1, lines: [] };
                    plan.selfSufficiency.lines = Array.isArray(plan.selfSufficiency.lines) ? plan.selfSufficiency.lines : [];
                    for (const selection of (addedPackages || [])) {
                        const line = createSelfSufficiencyLine(selection);
                        plan.selfSufficiency.lines.push(line);
                        state.collapsedSelfSufficiencyLineIds.delete(String(line.id || ""));
                    }
                    state.selfSufficiencyExpanded = true;
                    saveCollapsePreferences();
                    refreshDerived(null, { rebuildSelfSufficiency: true });
                } else if (kind === "csa") {
                    plan.csa = plan.csa || { enabled: false, boxesPerWeek: 0, start: "", end: "", salePricePerBox: null, salePriceMode: "auto", components: [] };
                    plan.csa.components = Array.isArray(plan.csa.components) ? plan.csa.components : [];
                    for (const selection of (addedPackages || [])) plan.csa.components.push(createCsaComponent(selection));
                    state.csaExpanded = true;
                    if (callbacks && typeof callbacks.renderRows === "function") callbacks.renderRows();
                    if (callbacks && typeof callbacks.refreshSummary === "function") callbacks.refreshSummary();
                    refreshDerived(null, { rebuildCsa: true });
                }
            } // CHANGE

            function openPackageTransferPicker(config) {
                const settings = config || {};
                const kind = String(settings.kind || "");
                const destinationId = String(settings.destinationId || "");
                const coverage = packageTransferCoverage(kind, destinationId);
                const addedKeys = new Set();
                const removedRowIds = new Set();
                const originalByRowId = new Map(coverage.includedRows.map(entry => [entry.id, entry]));
                let query = "";
                let discardWarned = false;
                let editBlocked = false;
                let closed = false;

                const layer = document.createElement("div");
                layer.className = "yp-picker-layer";
                layer.dataset.yearPlanPicker = demandDestinationPickerKey(kind, destinationId);
                const dialog = document.createElement("div");
                dialog.className = "yp-picker-dialog yp-package-transfer-dialog";
                dialog.setAttribute("role", "dialog");
                dialog.setAttribute("aria-modal", "true");
                const head = document.createElement("div");
                head.className = "yp-picker-head";
                const title = document.createElement("div");
                title.className = "yp-picker-title";
                title.textContent = settings.title || "Manage packages";
                const close = mkBtn("Close", "neutral");
                head.appendChild(title);
                head.appendChild(close);
                const bodyEl = document.createElement("div");
                bodyEl.className = "yp-picker-body";
                const search = mkInput("search", "", 0);
                search.className = "yp-picker-search";
                search.placeholder = "Search";
                const summary = document.createElement("div");
                summary.className = "yp-package-transfer-summary";
                const panes = document.createElement("div");
                panes.className = "yp-package-transfer-panes";
                const availablePane = document.createElement("section");
                availablePane.className = "yp-package-transfer-pane";
                const includedPane = document.createElement("section");
                includedPane.className = "yp-package-transfer-pane";
                bodyEl.appendChild(search);
                bodyEl.appendChild(summary);
                bodyEl.appendChild(panes);
                panes.appendChild(availablePane);
                panes.appendChild(includedPane);
                const foot = document.createElement("div");
                foot.className = "yp-picker-foot";
                const status = document.createElement("div");
                status.className = "yp-picker-status";
                const warning = document.createElement("div");
                warning.className = "yp-picker-warning";
                const actions = document.createElement("div");
                actions.className = "yp-row";
                const cancel = mkBtn("Cancel", "neutral");
                const apply = mkBtn("Apply changes", "add");
                actions.appendChild(cancel);
                actions.appendChild(apply);
                foot.appendChild(status);
                foot.appendChild(warning);
                foot.appendChild(actions);
                dialog.appendChild(head);
                dialog.appendChild(bodyEl);
                dialog.appendChild(foot);
                layer.appendChild(dialog);
                card.appendChild(layer);

                function hasPendingChanges() {
                    return addedKeys.size + removedRowIds.size > 0;
                }

                function activeIncludedEntries() {
                    const entries = coverage.includedRows.filter(entry => !removedRowIds.has(entry.id));
                    for (const key of addedKeys) {
                        const item = coverage.packageByKey.get(key);
                        if (!item) continue;
                        entries.push({ ...item, id: `add:${key}`, row: null, pendingAdd: true, duplicate: false });
                    }
                    return entries;
                }

                function activePackageKeys() {
                    return new Set(activeIncludedEntries().map(entry => entry.key));
                }

                function removedEntries() {
                    return Array.from(removedRowIds).map(id => originalByRowId.get(id)).filter(Boolean);
                }

                function availableEntries() {
                    const active = activePackageKeys();
                    const removedByKey = new Set(removedEntries().map(entry => entry.key));
                    const entries = removedEntries().map(entry => ({ ...entry, pendingRemove: true }));
                    for (const item of coverage.packageByKey.values()) {
                        if (active.has(item.key) || removedByKey.has(item.key)) continue;
                        entries.push({ ...item, id: `pkg:${item.key}` });
                    }
                    return entries.sort((a, b) => cropLabel(a.crop).localeCompare(cropLabel(b.crop)) || String(a.label || "").localeCompare(String(b.label || "")));
                }

                function entryMatches(entry) {
                    if (!query) return true;
                    const text = `${cropLabel(entry && entry.crop)} ${entry && entry.label || ""} ${entry && entry.meta || ""}`.toLocaleLowerCase();
                    return text.indexOf(query.toLocaleLowerCase()) >= 0;
                }

                function groupEntries(entries) {
                    const groups = [];
                    const byCrop = new Map();
                    for (const crop of coverage.crops) {
                        const cropId = String(crop && crop.id || "");
                        byCrop.set(cropId, { crop, entries: [] });
                    }
                    for (const entry of entries) {
                        const cropId = String(entry && entry.cropId || "");
                        if (!byCrop.has(cropId)) byCrop.set(cropId, { crop: entry.crop, entries: [] });
                        byCrop.get(cropId).entries.push(entry);
                    }
                    for (const group of byCrop.values()) {
                        const visible = group.entries.filter(entryMatches);
                        if (visible.length) groups.push({ crop: group.crop, entries: visible });
                    }
                    return groups;
                }

                function packageCountLabel(count, total) {
                    return `${count}/${total} package${total === 1 ? "" : "s"}`;
                }

                function setRowAction(entry, side) {
                    if (side === "available") {
                        if (entry.pendingRemove) removedRowIds.delete(entry.id);
                        else addedKeys.add(entry.key);
                    } else if (entry.pendingAdd) {
                        addedKeys.delete(entry.key);
                    } else {
                        removedRowIds.add(entry.id);
                    }
                    discardWarned = false;
                    editBlocked = false;
                    render();
                }

                function renderPane(host, label, countText, actionLabel, entries, side, emptyText) {
                    host.innerHTML = "";
                    const headEl = document.createElement("div");
                    headEl.className = "yp-package-transfer-pane-head";
                    const titleEl = document.createElement("div");
                    titleEl.textContent = `${label} ${countText}`;
                    const all = mkBtn(actionLabel, side === "available" ? "add" : "danger");
                    const groups = groupEntries(entries);
                    all.disabled = !groups.some(group => group.entries.length);
                    all.addEventListener("click", () => {
                        for (const group of groups) for (const entry of group.entries) setRowAction(entry, side);
                    });
                    headEl.appendChild(titleEl);
                    headEl.appendChild(all);
                    const list = document.createElement("div");
                    list.className = "yp-package-transfer-list";
                    host.appendChild(headEl);
                    host.appendChild(list);
                    if (!groups.length) {
                        const empty = document.createElement("div");
                        empty.className = "yp-package-transfer-empty";
                        empty.textContent = emptyText;
                        list.appendChild(empty);
                        return;
                    }
                    for (const group of groups) {
                        const cropHead = document.createElement("div");
                        cropHead.className = "yp-package-transfer-crop";
                        const cropName = document.createElement("div");
                        cropName.textContent = cropLabel(group.crop);
                        const cropCount = document.createElement("div");
                        cropCount.textContent = `${group.entries.length}`;
                        cropHead.appendChild(cropName);
                        cropHead.appendChild(cropCount);
                        list.appendChild(cropHead);
                        for (const entry of group.entries) {
                            const row = document.createElement("div");
                            row.className = "yp-package-transfer-row";
                            row.dataset.transferPackageKey = String(entry.key || "");
                            row.dataset.pending = entry.pendingAdd || entry.pendingRemove ? "true" : "false";
                            const labelEl = document.createElement("div");
                            labelEl.className = "yp-package-transfer-label";
                            labelEl.textContent = entry.label || "";
                            const controls = document.createElement("div");
                            controls.className = "yp-row";
                            if (entry.duplicate || entry.pendingAdd || entry.pendingRemove) {
                                const meta = document.createElement("span");
                                meta.className = "yp-package-transfer-meta";
                                meta.textContent = entry.pendingAdd ? "Will add" : (entry.pendingRemove ? "Undo remove" : "Duplicate row");
                                controls.appendChild(meta);
                            }
                            const action = mkBtn(side === "available" ? "Add" : "Remove", side === "available" ? "add" : "danger");
                            action.addEventListener("click", () => setRowAction(entry, side));
                            controls.appendChild(action);
                            row.appendChild(labelEl);
                            row.appendChild(controls);
                            list.appendChild(row);
                        }
                    }
                }

                function renderNeedsPackages() {
                    const crops = coverage.crops.filter(crop => !PlanMath.packageUnitOptions(crop).length && (!query || cropLabel(crop).toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) >= 0));
                    if (!crops.length) return [];
                    return crops.map(crop => ({
                        key: `needs:${String(crop && crop.id || "")}`,
                        crop,
                        cropId: String(crop && crop.id || ""),
                        label: "No packages",
                        editOnly: true
                    }));
                }

                function renderAvailableWithNeeds() {
                    const entries = availableEntries();
                    const needs = renderNeedsPackages();
                    renderPane(availablePane, "Available", packageCountLabel(Math.max(0, coverage.totalPackages - activePackageKeys().size), coverage.totalPackages), "Add all visible", entries, "available", query ? "No available matches." : "No available packages.");
                    if (!needs.length) return;
                    const list = availablePane.querySelector(".yp-package-transfer-list");
                    const cropHead = document.createElement("div");
                    cropHead.className = "yp-package-transfer-crop";
                    cropHead.textContent = "Needs packages";
                    list.appendChild(cropHead);
                    for (const entry of needs) {
                        const row = document.createElement("div");
                        row.className = "yp-package-transfer-row";
                        const labelEl = document.createElement("div");
                        labelEl.className = "yp-package-transfer-label";
                        labelEl.textContent = cropLabel(entry.crop);
                        const controls = document.createElement("div");
                        controls.className = "yp-row";
                        const meta = document.createElement("span");
                        meta.className = "yp-package-transfer-meta";
                        meta.textContent = "0 packages";
                        const edit = mkBtn("Edit packages", "neutral");
                        edit.addEventListener("click", () => {
                            if (hasPendingChanges()) {
                                editBlocked = true;
                                warning.textContent = "Apply or cancel pending changes before editing packages.";
                                return;
                            }
                            closePicker(true);
                            openCropPackages(entry.cropId);
                        });
                        controls.appendChild(meta);
                        controls.appendChild(edit);
                        row.appendChild(labelEl);
                        row.appendChild(controls);
                        list.appendChild(row);
                    }
                }

                function render() {
                    const included = activeIncludedEntries();
                    const includedUnique = activePackageKeys().size;
                    summary.innerHTML = "";
                    for (const text of [
                        `Total ${coverage.totalPackages} package${coverage.totalPackages === 1 ? "" : "s"}`,
                        `Included ${includedUnique}`,
                        `Available ${Math.max(0, coverage.totalPackages - includedUnique)}`
                    ]) {
                        const item = document.createElement("span");
                        item.textContent = text;
                        summary.appendChild(item);
                    }
                    renderAvailableWithNeeds();
                    renderPane(includedPane, "Included", packageCountLabel(includedUnique, coverage.totalPackages), "Remove all visible", included, "included", query ? "No included matches." : "No included packages.");
                    const addCount = addedKeys.size;
                    const removeCount = removedRowIds.size;
                    status.textContent = hasPendingChanges() ? `Add ${addCount}, remove ${removeCount}` : "No pending changes";
                    if (!editBlocked) warning.textContent = "";
                    apply.disabled = !hasPendingChanges();
                }

                function closePicker(force) {
                    if (closed) return;
                    if (!force && hasPendingChanges() && !discardWarned) {
                        discardWarned = true;
                        warning.textContent = "Pending changes will be lost. Close again to discard.";
                        return;
                    }
                    closed = true;
                    window.removeEventListener("keydown", onKeyDown, true);
                    if (layer.parentNode) layer.parentNode.removeChild(layer);
                }

                function onKeyDown(event) {
                    if (event.key === "Escape") {
                        event.preventDefault();
                        event.stopPropagation();
                        closePicker(false);
                    }
                }

                search.addEventListener("input", () => { query = search.value.trim(); render(); });
                apply.addEventListener("click", () => {
                    if (!hasPendingChanges()) return;
                    const added = Array.from(addedKeys).map(key => coverage.packageByKey.get(key)).filter(Boolean);
                    const removed = Array.from(removedRowIds).map(id => originalByRowId.get(id)).filter(Boolean).map(entry => entry.row);
                    closePicker(true);
                    applyPackageTransferChanges(kind, destinationId, added, removed, settings);
                });
                cancel.addEventListener("click", () => closePicker(false));
                close.addEventListener("click", () => closePicker(false));
                layer.addEventListener("click", event => { if (event.target === layer) closePicker(false); });
                window.addEventListener("keydown", onKeyDown, true);
                render();
                setTimeout(() => search.focus(), 0);
                return { close: () => closePicker(true), layer };
            } // CHANGE

            function removePlanCropAndLinkedRows(crop) { // CHANGE
                const cropId = String(crop && crop.id || ""); // CHANGE
                if (!cropId) return -1; // CHANGE
                const index = (plan.crops || []).indexOf(crop); // CHANGE
                const removedDemandLineIds = (plan.demands || []).filter(line => String(line && line.cropId || "") === cropId).map(line => String(line && line.id || "")); // CHANGE
                const removedSelfLineIds = ((plan.selfSufficiency && plan.selfSufficiency.lines) || []).filter(line => String(line && line.cropId || "") === cropId).map(line => String(line && line.id || "")); // CHANGE
                plan.crops = (plan.crops || []).filter(item => item !== crop); // CHANGE
                if (plan.selfSufficiency && Array.isArray(plan.selfSufficiency.lines)) plan.selfSufficiency.lines = plan.selfSufficiency.lines.filter(line => String(line && line.cropId || "") !== cropId); // CHANGE
                plan.demands = (plan.demands || []).filter(line => String(line && line.cropId || "") !== cropId); // CHANGE
                for (const lineId of removedDemandLineIds) state.collapsedDemandLineIds.delete(lineId); // CHANGE
                for (const lineId of removedSelfLineIds) state.collapsedSelfSufficiencyLineIds.delete(lineId); // CHANGE
                if (plan.csa && Array.isArray(plan.csa.components)) plan.csa.components = plan.csa.components.filter(component => String(component && component.cropId || "") !== cropId); // CHANGE
                return index; // CHANGE
            } // CHANGE

            function cropCoverageLabel(stat) {
                const crop = stat && stat.crop;
                const packages = (stat && stat.packages) || [];
                const missing = (stat && stat.missing) || [];
                if (!packages.length) return `${cropLabel(crop)} (0)`;
                if (!missing.length) return `${cropLabel(crop)} (${packages.length})`;
                return `${cropLabel(crop)} (${missing.length} missing, ${packages.length - missing.length} included)`;
            } // CHANGE

            function handleCropSelectPackageNavigation(select, currentCropId) {
                const nextCrop = PlanMath.findCrop(plan, select && select.value);
                if (!nextCrop || PlanMath.packageUnitOptions(nextCrop).length) return nextCrop;
                select.value = String(currentCropId || "");
                addPackageAndFocusUnit(nextCrop); // CHANGE: choosing a no-package crop is a navigation/repair action, not a row crop change.
                return null;
            } // CHANGE

            function mkCropSelectForDestination(kind, destinationId, selectedCropId, currentRow, width) {
                const stats = packageCoverageForDestination(kind, destinationId).slice().sort((a, b) => cropLabel(a.crop).localeCompare(cropLabel(b.crop)));
                const select = mkSelect([], "", width);
                const groups = [
                    { label: "Missing packages", items: stats.filter(item => item.missing.length) },
                    { label: "All packages included", items: stats.filter(item => item.packages.length && !item.missing.length) },
                    { label: "Needs packages", items: stats.filter(item => !item.packages.length) }
                ];
                for (const groupDef of groups) {
                    if (!groupDef.items.length) continue;
                    const group = document.createElement("optgroup");
                    group.label = groupDef.label;
                    for (const stat of groupDef.items) {
                        const cropId = String(stat.crop && stat.crop.id || "");
                        const option = new Option(cropCoverageLabel(stat), cropId);
                        option.disabled = cropId !== String(selectedCropId || "") && stat.packages.length && !firstUnusedPackageUnit(stat.crop, kind, destinationId, currentRow);
                        group.appendChild(option);
                    }
                    select.appendChild(group);
                }
                ensureSelectOption(select, selectedCropId, `${selectedCropId || "Missing crop"} (unavailable)`);
                select.value = String(selectedCropId || "");
                return select;
            } // CHANGE

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
                if (data.selfLineId !== undefined) control.dataset.yearPlanSelfLineId = String(data.selfLineId); // NEW
                if (data.selfLineIndex !== undefined) control.dataset.yearPlanSelfLineIndex = String(data.selfLineIndex); // NEW
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
                    renderCropFilterPackageBadge(); // CHANGE
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

            function currentNutritionPlantIds() {
                const ids = new Set();
                if (plan && plan.selfSufficiency && plan.selfSufficiency.enabled === false) return []; // CHANGE
                const cropsById = new Map((plan.crops || []).map(crop => [String(crop && crop.id || ""), crop]));
                for (const line of ((plan.selfSufficiency && plan.selfSufficiency.lines) || [])) {
                    const crop = cropsById.get(String(line && line.cropId || ""));
                    const plantId = Number(crop && crop.plantId);
                    if (Number.isFinite(plantId)) ids.add(plantId);
                }
                return Array.from(ids).sort((a, b) => a - b);
            } // NEW

            function scheduleNutritionLoad() {
                const plantIds = currentNutritionPlantIds();
                const key = plantIds.join(",");
                if (!plantIds.length || key === nutritionLoadKey) return;
                const version = ++nutritionLoadVersion;
                nutritionLoadKey = key;
                Promise.all([
                    DbClient.queryNutritionByPlantIds(plantIds),
                    DbClient.queryNutritionRequirements()
                ]).then(([nutritionRows, requirementRows]) => {
                    if (!SessionController.isActive(session) || version !== nutritionLoadVersion) return;
                    plan.__nutritionData = {
                        available: !!(nutritionRows && nutritionRows.available && requirementRows && requirementRows.available),
                        mappings: nutritionRows && nutritionRows.mappings || [],
                        values: nutritionRows && nutritionRows.values || [],
                        requirements: requirementRows && requirementRows.requirements || []
                    };
                    refreshDerived(null, { rebuildSelfSufficiency: true });
                }).catch(() => {
                    if (!SessionController.isActive(session) || version !== nutritionLoadVersion) return;
                    plan.__nutritionData = { available: false, mappings: [], values: [], requirements: [] };
                    refreshDerived(null, { rebuildSelfSufficiency: true });
                });
            } // NEW: DB reads stay asynchronous and only rerender when the self-use crop set changes.

            function fillTemplateDropdown() {
                templateSel.innerHTML = "";
                templateSel.appendChild(new Option("-- Select template --", ""));
                for (const name of PlanRepository.listTemplateNames()) templateSel.appendChild(new Option(name, name));
            }

            function fillCropFilter() {
                const current = String(plan.cropFilterId || "");
                cropFilterSel.innerHTML = "";
                cropFilterSel.appendChild(new Option("-- All crops --", ""));
                for (const crop of (plan.crops || [])) cropFilterSel.appendChild(new Option(cropFilterOptionLabel(crop), crop.id)); // CHANGE
                cropFilterSel.value = (plan.crops || []).some(crop => String(crop.id) === current) ? current : "";
                plan.cropFilterId = cropFilterSel.value;
                renderCropFilterPackageBadge(); // CHANGE
            }

            function renderCropFilterPackageBadge() {
                cropFilterBadgeHost.innerHTML = "";
                const crop = (plan.crops || []).find(item => String(item && item.id || "") === String(cropFilterSel.value || plan.cropFilterId || ""));
                if (!crop || cropPackageUnitCount(crop)) return;
                cropFilterBadgeHost.appendChild(createWarningChipWithDetails("Needs packages", "", "warning", () => openCropPackagesSetup(crop.id), {
                    title: "Open this crop's Packages tab and add a package unit.",
                    primaryTarget: { area: "crop", cropId: String(crop.id || ""), tab: "packages", field: "addPackage" },
                    diagnosticsLabel: "All warnings"
                })); // CHANGE
            } // CHANGE

            function fillPlanCheckScope() {
                const current = ["combined", "self", "csa", "sales"].includes(String(state.planCheckScope || "")) ? String(state.planCheckScope) : "combined";
                planCheckScopeSel.innerHTML = "";
                planCheckScopeSel.appendChild(new Option("Combined", "combined"));
                planCheckScopeSel.appendChild(new Option("Self", "self"));
                planCheckScopeSel.appendChild(new Option("CSA", "csa"));
                planCheckScopeSel.appendChild(new Option("Sales", "sales"));
                planCheckScopeSel.value = current;
                state.planCheckScope = current;
            } // NEW: Plan Check can scope chart and totals without changing persisted demand.

            function replacePlan(nextPlan, nextYear, loadedExisting, loadedDraft, draftUpdatedAt) {
                closeDiagnosticsPopovers(null); // CHANGE
                Object.keys(plan).forEach(key => delete plan[key]);
                Object.assign(plan, PlanSchema.normalizeForRuntime(nextPlan, nextYear));
                currentYear = Number(nextYear);
                loadedExistingForCurrentYear = !!loadedExisting;
                loadedDraftForCurrentYear = !!loadedDraft; // CHANGE
                plan.year = currentYear;
                state.selectedCropId = YearPlanDashboard.resolveSelectedCropId(plan.crops, "", 0);
                state.activeTab = "basics";
                state.hadBlockingErrors = false;
                state.hadCsaErrors = false;
                state.hadSelfSufficiencyErrors = false;
                state.hadDemandErrors = false;
                state.validationState = "idle";
                state.lastSavedAt = null;
                state.lastDraftSavedAt = parseStoredDate(draftUpdatedAt); // CHANGE
                state.closePromptOpen = false;
                state.extraDiagnostics = [];
                state.collapsedSelfSufficiencyLineIds = new Set(); // NEW
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
                statusRow.appendChild(createChip("Status", statusText, statusToneName, null, statusToneName === "warning" || statusToneName === "danger" ? { primaryTarget: { area: "plan-check", section: (dashboard && dashboard.diagnostics || []).length ? "diagnostics" : "summary" } } : null)); // CHANGE
                if (loadedDraftForCurrentYear) statusRow.appendChild(createChip("Draft", "", "primary")); // CHANGE
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
                const searchText = cropMenuSearchText(); // CHANGE
                const visibleMetrics = dashboard.cropMetrics.filter(metric => cropMenuMetricMatches(metric, searchText)); // CHANGE
                if (!visibleMetrics.length) { // CHANGE
                    const empty = document.createElement("div"); // CHANGE
                    empty.style.cssText = "padding:16px;color:#666;"; // CHANGE
                    empty.textContent = "No matching crops."; // CHANGE
                    cropList.appendChild(empty); // CHANGE
                    return; // CHANGE
                } // CHANGE
                for (const metric of visibleMetrics) { // CHANGE
                    const selected = String(metric.crop.id) === String(state.selectedCropId);
                    const cardEl = document.createElement("div");
                    cardEl.tabIndex = 0;
                    cardEl.setAttribute("role", "button");
                    cardEl.className = "yp-crop-card";
                    cardEl.dataset.selected = selected ? "true" : "false";
                    cardEl.dataset.cropId = String(metric.crop.id || "");
                    const detail = cropMenuBadgeLabel(metric); // CHANGE
                    const name = document.createElement("div");
                    name.className = "yp-crop-card-name";
                    name.textContent = cropLabel(metric.crop);
                    name.title = cropLabel(metric.crop); // CHANGE
                    const statusHost = document.createElement("span");
                    statusHost.className = "yp-diagnostics-wrap";
                    statusHost.title = detail; // CHANGE
                    const badgeAction = cropMenuBadgeAction(metric); // CHANGE
                    const cropResults = cropValidationResults(metric.crop.id); // CHANGE
                    const badgeItems = metric.status === "Missing data" && cropResults.length ? cropResults.map(result => ({ message: validationMessage(result), target: result && result.target, result })) : []; // CHANGE
                    statusHost.appendChild(badgeItems.length ? createActionablePopoverChip(detail, "", statusTone(metric.status), badgeItems, badgeAction, { popoverTitle: `${cropLabel(metric.crop)} diagnostics` }) : createChip(detail, "", statusTone(metric.status), badgeAction)); // CHANGE
                    const cropDiagnostics = badgeAction ? createWholePlanDiagnosticsControl(`${cropLabel(metric.crop)} diagnostics`) : (cropHasDiagnostics(metric.crop.id) ? createDiagnosticsControl(`${cropLabel(metric.crop)} diagnostics`, cropResults) : null); // CHANGE
                    if (cropDiagnostics) statusHost.appendChild(cropDiagnostics);
                    cardEl.appendChild(name); // CHANGE
                    cardEl.appendChild(statusHost); // CHANGE
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

            function cropMenuSearchText() { // CHANGE
                return String(cropSearchInput.value || "").trim().toLowerCase(); // CHANGE
            } // CHANGE

            function cropMenuMetricMatches(metric, searchText) { // CHANGE
                if (!searchText) return true; // CHANGE
                return cropLabel(metric && metric.crop).toLowerCase().includes(searchText); // CHANGE
            } // CHANGE

            function cropMenuBadgeAction(metric) { // CHANGE
                if (!metric || !metric.crop) return null; // CHANGE
                if (metric.status === "Short" || metric.status === "Expired / timing issue") return () => selectCropFromAttention(metric.crop.id, { highlightPlanCheckRow: true }); // CHANGE
                if (metric.status === "Missing data") return event => { // CHANGE
                    const first = cropValidationResults(metric.crop.id)[0]; // CHANGE
                    if (first) navigateToValidation(first, event && event.currentTarget); // CHANGE
                    else selectCropFromAttention(metric.crop.id); // CHANGE
                }; // CHANGE
                return null; // CHANGE
            } // CHANGE

            function cropMenuBadgeLabel(metric) { // CHANGE
                if (!metric) return "No demand"; // CHANGE
                if (metric.status === "Short") return `Short ${formatKg(metric.shortKg)}`; // CHANGE
                if (metric.status === "Surplus") return `Surplus ${formatKg(metric.surplusKg)}`; // CHANGE
                if (metric.status === "Expired / timing issue") return `${metric.status} ${formatKg(metric.shortKg)}`; // CHANGE
                return metric.status || "No demand"; // CHANGE
            } // CHANGE

            function compactSourceQty(line) { // CHANGE
                return `${formatCompactNumber(line && line.qty)} ${line && line.unit || "unit"}`;
            } // CHANGE

            function buildCropTimelineSources(crop, cropWeekly) { // CHANGE
                const weekly = runtime && runtime.weekly;
                const weeks = runtime && runtime.weekStarts || weekly && weekly.weeks || [];
                const byWeek = Array.from({ length: Math.max(weeks.length, Array.isArray(cropWeekly && cropWeekly.target) ? cropWeekly.target.length : 0) }, () => ({ plantings: [], demandGroups: [] }));
                const ensureGroup = (weekIndex, key, label, kind) => {
                    const model = byWeek[weekIndex];
                    let group = model.demandGroups.find(item => item.key === key);
                    if (!group) {
                        group = { key, label, kind, rows: [] };
                        model.demandGroups.push(group);
                    }
                    return group;
                };
                const addDemandRow = (weekIndex, groupKey, groupLabel, kind, row) => {
                    if (weekIndex < 0 || weekIndex >= byWeek.length) return;
                    if (Math.max(row.targetKg, row.fulfilledKg, row.shortKg) <= EPS) return;
                    ensureGroup(weekIndex, groupKey, groupLabel, kind).rows.push(row);
                };

                const plantingRows = Array.isArray(cropWeekly && cropWeekly.plantingSourcesByWeek) ? cropWeekly.plantingSourcesByWeek : [];
                for (let i = 0; i < byWeek.length; i++) byWeek[i].plantings = (plantingRows[i] || []).map(row => ({
                    ...row,
                    kind: "planting",
                    target: null
                }));

                if (weekly && weekly.perSelfLine && typeof weekly.perSelfLine.forEach === "function") {
                    weekly.perSelfLine.forEach(result => {
                        if (String(result && result.cropId || "") !== String(crop && crop.id || "")) return;
                        const line = result.line || {};
                        for (let i = 0; i < byWeek.length; i++) addDemandRow(i, "self", "Self Sufficiency", "self-sufficiency", {
                            kind: "self-sufficiency",
                            label: `Self line ${Number(result.lineIndex) + 1} - ${compactSourceQty(line)}`,
                            targetKg: Math.max(0, Number(result.target && result.target[i]) || 0),
                            fulfilledKg: Math.max(0, Number(result.usableSupply && result.usableSupply[i]) || 0),
                            shortKg: Math.max(0, Number(result.short && result.short[i]) || 0),
                            target: { area: "self-sufficiency", selfLineId: String(line.id || ""), selfLineIndex: result.lineIndex }
                        });
                    });
                }

                for (const request of (weekly && weekly.csaComponentRequests || [])) {
                    if (String(request && request.cropId || "") !== String(crop && crop.id || "")) continue;
                    const component = request.component || {};
                    for (let i = 0; i < byWeek.length; i++) addDemandRow(i, "csa", "CSA", "csa", {
                        kind: "csa",
                        label: `CSA component ${Number(request.componentIndex) + 1} - ${compactSourceQty(component)}`,
                        targetKg: Math.max(0, Number(request.target && request.target[i]) || 0),
                        fulfilledKg: Math.max(0, Number(request.usableSupply && request.usableSupply[i]) || 0),
                        shortKg: Math.max(0, Number(request.short && request.short[i]) || 0),
                        target: { area: "csa", componentIndex: request.componentIndex }
                    });
                }

                const channelsById = new Map((plan.demandChannels || []).map(channel => [String(channel && channel.id || ""), channel]));
                if (weekly && weekly.perDemandLine && typeof weekly.perDemandLine.forEach === "function") {
                    weekly.perDemandLine.forEach(result => {
                        if (String(result && result.cropId || "") !== String(crop && crop.id || "")) return;
                        const line = result.line || {};
                        const channel = channelsById.get(String(result.channelId || "")) || {};
                        const channelLabel = String(channel.label || result.channelId || "Demand channel");
                        for (let i = 0; i < byWeek.length; i++) addDemandRow(i, `sales:${String(result.channelId || "")}`, channelLabel, "demand", {
                            kind: "demand",
                            label: `${compactSourceQty(line)} / ${demandFrequencyLabel(line.frequency, line.everyN)}`,
                            targetKg: Math.max(0, Number(result.target && result.target[i]) || 0),
                            fulfilledKg: Math.max(0, Number(result.usableSupply && result.usableSupply[i]) || 0),
                            shortKg: Math.max(0, Number(result.short && result.short[i]) || 0),
                            target: { area: "demand", lineId: String(line.id || ""), channelId: String(result.channelId || "") }
                        });
                    });
                }
                return byWeek;
            } // CHANGE

            function storeTimelineReturnContext(cropId, weekIndex) { // CHANGE
                YEAR_PLAN_RETURN_CONTEXTS.set(yearPlanReturnContextKey(moduleCell, currentYear), {
                    cropId: String(cropId || ""),
                    weekIndex: Math.max(0, Math.trunc(Number(weekIndex) || 0)),
                    activeTab: state.activeTab || "basics"
                });
            } // CHANGE

            function requestPlanButtonFlash() { // CHANGE
                const key = yearPlanReturnContextKey(moduleCell, currentYear);
                const first = !YEAR_PLAN_FLASH_SEEN_KEYS.has(key);
                YEAR_PLAN_FLASH_SEEN_KEYS.add(key);
                try {
                    window.dispatchEvent(new CustomEvent(PLAN_BUTTON_FLASH_EVENT, {
                        detail: { moduleCellId: cellStableId(moduleCell), year: currentYear, durationMs: first ? 4000 : 2000 }
                    }));
                } catch (_) { }
            } // CHANGE

            function activateCropTimelineSource(sourceRow, kind, weekRow) { // CHANGE
                if (kind === "planting") {
                    storeTimelineReturnContext(state.selectedCropId, weekRow && weekRow.week ? PlanMath.weekIndexForDate(runtime.weekStarts || [], weekRow.week.iso) : 0);
                    saveDraftIfDirty();
                    SessionController.close();
                    const target = sourceRow && (sourceRow.cell || Env.model.getCell && Env.model.getCell(sourceRow.cellId));
                    if (target && graph.setSelectionCell) graph.setSelectionCell(target);
                    if (target && graph.scrollCellToVisible) graph.scrollCellToVisible(target, true);
                    requestPlanButtonFlash();
                    return;
                }
                if (sourceRow && sourceRow.target) activateYearPlanTarget(sourceRow.target, null, null);
            } // CHANGE

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
                    const timelineCrop = weeklyCrop ? { ...weeklyCrop, sourcesByWeek: buildCropTimelineSources(crop, weeklyCrop) } : weeklyCrop; // CHANGE
                    const openWeekIndex = Number.isFinite(Number(state.pendingTimelineWeekIndex)) ? Number(state.pendingTimelineWeekIndex) : null; // CHANGE
                    const restoredOpen = renderCropTimeline(editorRefs.harvestTimeline, runtime.weekStarts, timelineCrop, crop, { openWeekIndex, onActivateSource: activateCropTimelineSource }); // CHANGE: show demand, raw harvest, inventory, and source popovers for the selected crop.
                    if (restoredOpen) setTimeout(() => { if (state.pendingTimelineWeekIndex === openWeekIndex) state.pendingTimelineWeekIndex = null; }, 0); // CHANGE
                }
            }

            function syncDemandDerived() {
                if (!dashboard || !demandRefs.channelSummaries) return;
                for (const [channelId, summary] of demandRefs.channelSummaries) {
                    const channel = (plan.demandChannels || []).find(item => String(item && item.id || "") === String(channelId)); // CHANGE
                    const metric = dashboard.channelMetricsById.get(String(channelId));
                    if (metric) setChipRow(summary, channel && channel.enabled === false ? [createDisabledChip()] : buildChannelSummaryChips(metric)); // CHANGE
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
                if (csaRefs.resetSale) csaRefs.resetSale.disabled = (plan.csa && plan.csa.enabled === false) || (plan.csa && plan.csa.salePriceMode !== "manual"); // CHANGE
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

            function summarizePlanCheckRevenue(cropId, scope) {
                const selectedCropId = String(cropId || "");
                const selectedScope = String(scope || "combined");
                const selfMetric = dashboard && dashboard.selfSufficiencyMetric || {};
                const csaMetric = dashboard && dashboard.csaMetric || {};
                if (!selectedCropId) {
                    if (selectedScope === "self") return {
                        potentialRevenue: Math.max(0, Number(selfMetric.groceryValue) || 0),
                        fulfilledRevenue: Math.max(0, Number(selfMetric.fulfilledGroceryValue) || 0)
                    };
                    if (selectedScope === "csa") return {
                        potentialRevenue: Math.max(0, Number(csaMetric.potentialRevenue) || 0),
                        fulfilledRevenue: Math.max(0, Number(csaMetric.fulfilledRevenue) || 0)
                    };
                    if (selectedScope === "sales") return {
                        potentialRevenue: Math.max(0, Number(dashboard.potentialRevenue) || 0),
                        fulfilledRevenue: Math.max(0, Number(dashboard.fulfilledRevenue) || 0)
                    };
                    return {
                        potentialRevenue: Math.max(0, Number(dashboard.totalPotentialRevenue) || 0) + Math.max(0, Number(selfMetric.groceryValue) || 0),
                        fulfilledRevenue: Math.max(0, Number(dashboard.totalFulfilledRevenue) || 0) + Math.max(0, Number(selfMetric.fulfilledGroceryValue) || 0)
                    };
                }
                const selfWeekly = runtime.weekly && runtime.weekly.selfSufficiency;
                const selfPotentialByCrop = selfWeekly && selfWeekly.groceryValueByCropId;
                const selfFulfilledByCrop = selfWeekly && selfWeekly.fulfilledGroceryValueByCropId;
                const selfPotential = sumPositiveValues(selfPotentialByCrop && selfPotentialByCrop.get ? selfPotentialByCrop.get(selectedCropId) : null);
                const selfFulfilled = sumPositiveValues(selfFulfilledByCrop && selfFulfilledByCrop.get ? selfFulfilledByCrop.get(selectedCropId) : null);
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
                const csaPotential = sumPositiveValues(csaPotentialByCrop && csaPotentialByCrop.get ? csaPotentialByCrop.get(selectedCropId) : null);
                const csaFulfilled = sumPositiveValues(csaFulfilledByCrop && csaFulfilledByCrop.get ? csaFulfilledByCrop.get(selectedCropId) : null);
                if (selectedScope === "self") return { potentialRevenue: selfPotential, fulfilledRevenue: selfFulfilled };
                if (selectedScope === "csa") return { potentialRevenue: csaPotential, fulfilledRevenue: csaFulfilled };
                if (selectedScope === "sales") return { potentialRevenue: salesPotential, fulfilledRevenue: salesFulfilled };
                return {
                    potentialRevenue: selfPotential + salesPotential + csaPotential,
                    fulfilledRevenue: selfFulfilled + salesFulfilled + csaFulfilled
                };
            } // CHANGE: value totals now follow the selected Plan Check scope and include household grocery value.

            function renderPlanCheck() {
                const cropId = String(plan.cropFilterId || "");
                const chartScope = ["combined", "self", "csa", "sales"].includes(String(state.planCheckScope || "")) ? String(state.planCheckScope) : "combined";
                planCheckScopeSel.value = chartScope;
                const visibleCrops = cropId
                    ? (plan.crops || []).filter(crop => String(crop && crop.id || "") === cropId)
                    : (plan.crops || []);
                const chartModel = PlanMath.buildPlanChartModel(runtime.weekly, cropId, { scope: chartScope });
                const chartSummary = PlanMath.summarizePlanChartModel(chartModel);
                const scopedRevenue = summarizePlanCheckRevenue(cropId, chartScope);
                const planWarnings = wholePlanWarningItems(); // CHANGE
                const firstWarningTarget = planWarnings.find(warning => warning && warning.target); // CHANGE
                renderStripBox(planCheckBox, {
                    title: "Plan Check",
                    expanded: state.planCheckExpanded,
                    summaryChips: planWarnings.length ? [
                        createWarningChipWithDetails("Warnings", String(planWarnings.length), "warning", null, { primaryTarget: firstWarningTarget && firstWarningTarget.target || { area: "plan-check", section: "diagnostics" }, diagnosticsLabel: "All warnings" })
                    ] : [], // CHANGE
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
                    createChip("Short", formatKg(chartSummary.shortKg), chartSummary.shortKg > EPS ? "danger" : "success", null, chartSummary.shortKg > EPS ? { primaryTarget: { area: "plan-check", rowKind: "shortage-weeks" }, chipKind: "short" } : null), // CHANGE
                    createChip("Expired", formatKg(chartSummary.expiredKg), chartSummary.expiredKg > EPS ? "warning" : "neutral", null, chartSummary.expiredKg > EPS ? { primaryTarget: { area: "plan-check", chipKind: "expired" }, chipKind: "expired" } : null), // CHANGE
                    createChip("Worst shortage", worstShortage, chartSummary.worstShortageKg > EPS ? "danger" : "neutral", null, chartSummary.worstShortageKg > EPS ? { primaryTarget: { area: "plan-check", rowKind: "shortage-weeks" }, chipKind: "worst-shortage" } : null), // CHANGE
                    createChip("Short weeks", String(chartSummary.shortWeeks), chartSummary.shortWeeks > 0 ? "danger" : "success", null, chartSummary.shortWeeks > 0 ? { primaryTarget: { area: "plan-check", rowKind: "shortage-weeks" }, chipKind: "short-weeks" } : null), // CHANGE
                    createChip("Total potential", formatMoney(scopedRevenue.potentialRevenue), "neutral"),
                    createChip("Total fulfilled", formatMoney(scopedRevenue.fulfilledRevenue), scopedRevenue.fulfilledRevenue > EPS ? "success" : "neutral")
                ]);

                const rows = visibleCrops.map(crop => {
                    const summary = PlanMath.summarizePlanChartModel(PlanMath.buildPlanChartModel(runtime.weekly, String(crop.id), { scope: chartScope }));
                    const revenue = summarizePlanCheckRevenue(crop.id, chartScope);
                    const metric = dashboard.cropMetricsById.get(String(crop.id));
                    return `<tr data-plan-check-crop-id="${htmlAttr(crop.id)}" data-plan-check-row-kind="${metric && (metric.status === "Short" || metric.status === "Expired / timing issue" || metric.status === "Missing data") ? "crop-problem" : "crop"}"><td>${mxUtils.htmlEntities(cropLabel(crop))}</td><td>${summary.targetKg.toFixed(1)}</td><td>${summary.harvestKg.toFixed(1)}</td><td>${summary.usableSupplyKg.toFixed(1)}</td><td>${summary.shortKg.toFixed(1)}</td><td>${summary.expiredKg.toFixed(1)}</td><td>${formatMoney(revenue.potentialRevenue)}</td><td>${formatMoney(revenue.fulfilledRevenue)}</td><td>${mxUtils.htmlEntities(metric ? metric.status : "Missing data")}</td></tr>`; // CHANGE: attention navigation can scroll to the matching crop row.
                }).join("");
                const selfMetric = dashboard.selfSufficiencyMetric || {};
                const selfSourceRow = `<tr><td>Self Sufficiency</td><td>${(Number(selfMetric.targetKg) || 0).toFixed(1)}</td><td>${(Number(selfMetric.usableSupplyKg) || 0).toFixed(1)}</td><td>${(Number(selfMetric.shortKg) || 0).toFixed(1)}</td><td>${(plan.selfSufficiency && plan.selfSufficiency.lines || []).length}</td><td>${formatMoney(selfMetric.groceryValue)}</td><td>${formatMoney(selfMetric.fulfilledGroceryValue)}</td><td>${Number(selfMetric.shortKg) > EPS ? "Short" : "OK"}</td></tr>`;
                const csaMetric = dashboard.csaMetric || {};
                const csaSourceRow = `<tr><td>CSA</td><td>${(Number(csaMetric.targetKg) || 0).toFixed(1)}</td><td>${(Number(csaMetric.usableSupplyKg) || 0).toFixed(1)}</td><td>${(Number(csaMetric.shortKg) || 0).toFixed(1)}</td><td>${(plan.csa && plan.csa.components || []).length}</td><td>${formatMoney(csaMetric.potentialRevenue)}</td><td>${formatMoney(csaMetric.fulfilledRevenue)}</td><td>${Number(csaMetric.shortKg) > EPS ? "Short" : "OK"}</td></tr>`;
                const salesChannelRows = dashboard.channelMetrics.map(metric => `<tr><td>${mxUtils.htmlEntities(metric.channel.label || metric.channel.id)}</td><td>${metric.targetKg.toFixed(1)}</td><td>${metric.usableSupplyKg.toFixed(1)}</td><td>${metric.shortKg.toFixed(1)}</td><td>${metric.lineCount}</td><td>${formatMoney(metric.potentialRevenue)}</td><td>${formatMoney(metric.fulfilledRevenue)}</td><td>${mxUtils.htmlEntities(metric.status)}</td></tr>`).join("");
                const channelRows = chartScope === "self"
                    ? selfSourceRow
                    : (chartScope === "csa" ? csaSourceRow : (chartScope === "sales" ? salesChannelRows : selfSourceRow + csaSourceRow + salesChannelRows));
                const priorityRows = (chartScope === "self" || chartScope === "csa")
                    ? ""
                    : dashboard.priorityMetrics.map(metric => `<tr><td>${mxUtils.htmlEntities(metric.priority)}</td><td>${metric.targetKg.toFixed(1)}</td><td>${metric.usableSupplyKg.toFixed(1)}</td><td>${metric.shortKg.toFixed(1)}</td><td>${formatMoney(metric.potentialRevenue)}</td><td>${formatMoney(metric.fulfilledRevenue)}</td></tr>`).join("");
                const shortageRows = dashboard.shortageWeeks.filter(row => {
                    if (chartScope === "self") return Number(row.selfShortKg) > EPS;
                    if (chartScope === "csa") return Number(row.csaShortKg) > EPS;
                    if (chartScope === "sales") return Number(row.channelShortKg) > EPS;
                    return true;
                }).map(row => `<tr data-plan-check-row-kind="shortage-weeks"><td>${mxUtils.htmlEntities(row.week)}</td><td>${row.selfDemandKg.toFixed(1)}</td><td>${row.selfShortKg.toFixed(1)}</td><td>${row.csaDemandKg.toFixed(1)}</td><td>${row.csaShortKg.toFixed(1)}</td><td>${row.channelDemandKg.toFixed(1)}</td><td>${row.channelShortKg.toFixed(1)}</td></tr>`).join(""); // CHANGE
                totalsBox.innerHTML =
                    `
                    <div style="font-weight:700;margin-bottom:6px;">Plan Check totals</div>
                    <table style="width:100%;border-collapse:collapse;"><thead><tr><th>Crop</th><th>Target</th><th>Harvested</th><th>Usable</th><th>Short</th><th>Expired</th><th>Potential</th><th>Fulfilled</th><th>Status</th></tr></thead><tbody>${rows || '<tr><td colspan="9">No crops.</td></tr>'}</tbody></table>
                    <div style="font-weight:700;margin:10px 0 6px;">Channels</div>
                    <table style="width:100%;border-collapse:collapse;"><thead><tr><th>Channel</th><th>Demand</th><th>Usable</th><th>Short</th><th>Lines</th><th>Potential</th><th>Fulfilled</th><th>Status</th></tr></thead><tbody>${channelRows || '<tr><td colspan="8">No channels.</td></tr>'}</tbody></table>
                    <div style="font-weight:700;margin:10px 0 6px;">Priorities</div>
                    <table style="width:100%;border-collapse:collapse;"><thead><tr><th>Priority</th><th>Demand</th><th>Usable</th><th>Short</th><th>Potential</th><th>Fulfilled</th></tr></thead><tbody>${priorityRows || '<tr><td colspan="6">No priority breakdown for this scope.</td></tr>'}</tbody></table>
                    <div style="font-weight:700;margin:10px 0 6px;">Shortage weeks</div>
                    <table style="width:100%;border-collapse:collapse;"><thead><tr><th>Week</th><th>Self demand</th><th>Self short</th><th>CSA demand</th><th>CSA short</th><th>Channel demand</th><th>Channel short</th></tr></thead><tbody>${shortageRows || '<tr><td colspan="7">No shortage weeks.</td></tr>'}</tbody></table>
                    <div style="margin-top:9px;"><strong>Value:</strong> Scope potential ${formatMoney(scopedRevenue.potentialRevenue)} | Scope fulfilled ${formatMoney(scopedRevenue.fulfilledRevenue)}. Self ${formatMoney(selfMetric.fulfilledGroceryValue)} | Sales ${formatMoney(dashboard.fulfilledRevenue)} | CSA ${formatMoney(dashboard.csaMetric && dashboard.csaMetric.fulfilledRevenue)}.</div>`;
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
                const commitReady = isCommitReady(); // CHANGE
                save.textContent = commitReady ? "Save" : "Save draft"; // CHANGE
                saveClose.textContent = commitReady ? "Save & Close" : "Save draft & Close"; // CHANGE
                promptSave.textContent = commitReady ? "Save and Close" : "Save draft and close"; // CHANGE
                exportButton.textContent = loadedDraftForCurrentYear || !commitReady ? "Export draft" : "Export"; // CHANGE
                reset.textContent = loadedDraftForCurrentYear ? "Discard draft" : (loadedExistingForCurrentYear ? "Reset" : "Clear"); // CHANGE
                if (state.validationState === "invalid" && state.lastDraftSavedAt) footerStatus.textContent = `Draft saved ${state.lastDraftSavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}; validation failed`; // CHANGE
                else if (state.validationState === "invalid") footerStatus.textContent = "Validation failed";
                else if (dirty) footerStatus.textContent = "Unsaved changes";
                else if (loadedDraftForCurrentYear && state.lastDraftSavedAt) footerStatus.textContent = `Draft saved ${state.lastDraftSavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`; // CHANGE
                else if (loadedDraftForCurrentYear) footerStatus.textContent = "Loaded draft"; // CHANGE
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
                    }))),
                    selfSufficiency: JSON.stringify(((plan && plan.selfSufficiency && plan.selfSufficiency.lines) || []).map(line => ({
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
                PlanSchema.clearUnavailableQuantityUnits(plan); // CHANGE: package edits immediately clear row units that no longer exist.
                runtime = PlanRuntimeService.recalculate(moduleCell, currentYear, plan);
                const dirty = state.baselineSnapshot ? YearPlanDashboard.isDirty(state, plan) : false;
                dashboard = YearPlanDashboard.compute(plan, runtime, { dirty, extraDiagnostics: state.extraDiagnostics, extraValidationErrors: state.saveValidationErrors }); // CHANGE: include save-only validation after failed saves.
                const demandErrors = PlanSchema.validateDemand(plan);
                const selfSufficiencyErrors = PlanSchema.validateSelfSufficiency(plan);
                const hadDemandErrors = state.hadDemandErrors;
                const hadSelfSufficiencyErrors = state.hadSelfSufficiencyErrors; // NEW
                const expansionChanges = YearPlanDashboard.syncExpansionState(state, dashboard, PlanSchema.validateCsa(plan), demandErrors, selfSufficiencyErrors);
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
                if (selfSufficiencyErrors.length && !hadSelfSufficiencyErrors) { // NEW
                    for (const error of selfSufficiencyErrors) { // NEW
                        const target = error && error.target || {}; // NEW
                        const line = target.selfLineId // NEW
                            ? ((plan.selfSufficiency && plan.selfSufficiency.lines) || []).find(item => String(item && item.id || "") === String(target.selfLineId)) // NEW
                            : (target.selfLineIndex !== undefined ? ((plan.selfSufficiency && plan.selfSufficiency.lines) || [])[Math.max(0, Math.trunc(Number(target.selfLineIndex) || 0))] : null); // NEW
                        if (line) state.collapsedSelfSufficiencyLineIds.delete(String(line.id || "")); // NEW
                    } // NEW
                } // NEW
                state.selectedCropId = YearPlanDashboard.resolveSelectedCropId(plan.crops, state.selectedCropId, 0);
                const afterRecalculation = captureDateRangeSnapshot();
                const comparisonSnapshot = beforeDateRanges || beforeRecalculation;
                const csaDatesChanged = comparisonSnapshot.csa !== afterRecalculation.csa
                    || beforeRecalculation.csa !== afterRecalculation.csa;
                const demandDatesChanged = comparisonSnapshot.demand !== afterRecalculation.demand
                    || beforeRecalculation.demand !== afterRecalculation.demand;
                const selfSufficiencyDatesChanged = comparisonSnapshot.selfSufficiency !== afterRecalculation.selfSufficiency
                    || beforeRecalculation.selfSufficiency !== afterRecalculation.selfSufficiency;
                fillCropFilter(); // CHANGE: planned-crop selector package labels track package edits immediately.
                renderSummary();
                renderCropList();
                renderSelfSufficiencyStrip(!!options.rebuildSelfSufficiency || expansionChanges.selfSufficiencyChanged || (state.selfSufficiencyExpanded && selfSufficiencyDatesChanged));
                renderCsa(!!options.rebuildCsa || expansionChanges.csaChanged || (state.csaExpanded && csaDatesChanged));
                renderDemandStrip(!!options.rebuildDemand || expansionChanges.demandChanged || (state.demandExpanded && demandDatesChanged));
                renderCropPlan(false);
                renderPlanCheck();
                renderFooter();
                syncEditorDerived();
                syncDemandDerived();
                syncCsaDerived();
                closeDiagnosticsPopovers(null); // CHANGE: remove stale layer-hosted popovers after rerenders.
                scheduleNutritionLoad();
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

            const ADD_VARIETY_VALUE = "__ADD_VARIETY__"; // CHANGE
            const TRELLIS_DEFAULT_VARIETY_PROFILES = Object.freeze([ // CHANGE
                { name: "Very early maturity", maturityClass: "very_early" },
                { name: "Early maturity", maturityClass: "early" },
                { name: "Mid maturity", maturityClass: "mid" },
                { name: "Late maturity", maturityClass: "late" },
                { name: "Very late maturity", maturityClass: "very_late" }
            ]); // CHANGE
            const TRELLIS_DEFAULT_VARIETY_ORDER = new Map(TRELLIS_DEFAULT_VARIETY_PROFILES.map((profile, index) => [`${profile.name}|${profile.maturityClass}`, index])); // CHANGE

            function normalizeVarietyMaturityClass(value) { // CHANGE
                const key = String(value || "").trim().toLowerCase(); // CHANGE
                return ["very_early", "early", "mid", "late", "very_late"].includes(key) ? key : ""; // CHANGE
            } // CHANGE

            function trellisDefaultVarietyOrder(row) { // CHANGE
                const name = String(row && row.variety_name || "").trim(); // CHANGE
                const maturityClass = normalizeVarietyMaturityClass(row && row.maturity_class); // CHANGE
                const order = TRELLIS_DEFAULT_VARIETY_ORDER.get(`${name}|${maturityClass}`); // CHANGE
                return Number.isInteger(order) ? order : -1; // CHANGE
            } // CHANGE

            function isTrellisDefaultVariety(row) { // CHANGE
                return trellisDefaultVarietyOrder(row) >= 0; // CHANGE
            } // CHANGE

            function compareUserVarietyRows(a, b) { // CHANGE
                return String(a && (a.variety_name || a.variety_id) || "").localeCompare(String(b && (b.variety_name || b.variety_id) || ""), undefined, { sensitivity: "base" }); // CHANGE
            } // CHANGE

            function compareDefaultVarietyRows(a, b) { // CHANGE
                const ao = trellisDefaultVarietyOrder(a); // CHANGE
                const bo = trellisDefaultVarietyOrder(b); // CHANGE
                if (ao !== bo) return ao - bo; // CHANGE
                return compareUserVarietyRows(a, b); // CHANGE
            } // CHANGE

            function splitVarietyRowsBySource(rows) { // CHANGE
                const defaults = []; // CHANGE
                const users = []; // CHANGE
                for (const row of Array.isArray(rows) ? rows : []) { // CHANGE
                    if (isTrellisDefaultVariety(row)) defaults.push(row); // CHANGE
                    else users.push(row); // CHANGE
                } // CHANGE
                defaults.sort(compareDefaultVarietyRows); // CHANGE
                users.sort(compareUserVarietyRows); // CHANGE
                return { defaults, users }; // CHANGE
            } // CHANGE

            function appendVarietyOptions(select, rows, desired, unavailableLabel) { // CHANGE
                select.innerHTML = ""; // CHANGE
                const { defaults, users } = splitVarietyRowsBySource(rows); // CHANGE
                const makeOption = (label, value) => new Option(String(label), String(value)); // CHANGE
                const appendRowOption = (parent, row) => parent.appendChild(makeOption(String(row.variety_name || row.variety_id), String(row.variety_id))); // CHANGE
                const baseOption = makeOption("(base plant)", ""); // CHANGE
                const addOption = makeOption("Add variety...", ADD_VARIETY_VALUE); // CHANGE
                if (defaults.length && users.length) { // CHANGE
                    select.appendChild(baseOption); // CHANGE
                    const defaultsGroup = document.createElement("optgroup"); // CHANGE
                    defaultsGroup.label = "Trellis defaults"; // CHANGE
                    defaults.forEach(row => appendRowOption(defaultsGroup, row)); // CHANGE
                    select.appendChild(defaultsGroup); // CHANGE
                    const usersGroup = document.createElement("optgroup"); // CHANGE
                    usersGroup.label = "Your varieties"; // CHANGE
                    usersGroup.appendChild(addOption); // CHANGE
                    users.forEach(row => appendRowOption(usersGroup, row)); // CHANGE
                    select.appendChild(usersGroup); // CHANGE
                } else if (defaults.length) { // CHANGE
                    select.appendChild(baseOption); // CHANGE
                    const defaultsGroup = document.createElement("optgroup"); // CHANGE
                    defaultsGroup.label = "Trellis defaults"; // CHANGE
                    defaults.forEach(row => appendRowOption(defaultsGroup, row)); // CHANGE
                    select.appendChild(defaultsGroup); // CHANGE
                    const usersGroup = document.createElement("optgroup"); // CHANGE
                    usersGroup.label = "Your varieties"; // CHANGE
                    usersGroup.appendChild(addOption); // CHANGE
                    select.appendChild(usersGroup); // CHANGE
                } else { // CHANGE
                    select.appendChild(baseOption); // CHANGE
                    select.appendChild(addOption); // CHANGE
                    users.forEach(row => appendRowOption(select, row)); // CHANGE
                } // CHANGE
                if (desired && !rows.some(row => String(row.variety_id) === desired)) select.appendChild(makeOption(`${unavailableLabel || desired} (unavailable)`, desired)); // CHANGE
                select.value = desired && Array.from(select.options).some(option => option.value === desired) ? desired : ""; // CHANGE
            } // CHANGE

            function requestVarietyEditor(plantId, varietyId, cropId) { // CHANGE
                const requestId = Env.uid("variety_request"); // CHANGE
                const detail = { requestId, cropId: cropId ? String(cropId) : "", plantId: Number(plantId), varietyId: varietyId == null || varietyId === "" ? null : Number(varietyId), startVarietyMode: varietyId == null || varietyId === "" ? "add" : "edit" }; // CHANGE
                graph.fireEvent(new mxEventObject("usl:openVarietyEditor", "cropId", detail.cropId, "plantId", detail.plantId, "varietyId", detail.varietyId, "startVarietyMode", detail.startVarietyMode, "requestId", requestId)); // CHANGE
                window.dispatchEvent(new CustomEvent("usl:openVarietyEditor", { detail })); // CHANGE
                return requestId; // CHANGE
            } // CHANGE

            async function loadVarieties(crop, select) {
                const key = String(crop.plantId || "");
                select.disabled = true;
                try {
                    const rows = await getVarietyRows(key);
                    if (!SessionController.isActive(session) || selectedCrop() !== crop || editorRefs.variety !== select) return;
                    const desired = crop.varietyId == null ? "" : String(crop.varietyId);
                    appendVarietyOptions(select, rows, desired, crop.variety); // CHANGE
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
                function syncVarietyActionButton() { // CHANGE
                    const editing = crop.varietyId !== null && crop.varietyId !== undefined && crop.varietyId !== ""; // CHANGE
                    addVariety.title = editing ? "Edit variety" : "Add variety"; // CHANGE
                    addVariety.setAttribute("aria-label", addVariety.title); // CHANGE
                    addVariety.setAttribute("data-year-plan-variety-action", editing ? "edit" : "add"); // CHANGE
                    setButtonSvgIcon(addVariety, editing ? yearPlanPencilIconSvg() : "", "+"); // CHANGE
                } // CHANGE
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
                syncVarietyActionButton(); // CHANGE
                loadVarieties(crop, variety);
                loadMethods(crop, method, methodDiagnostic);
                updateYieldHint(crop, yieldHint, resetYield);

                variety.addEventListener("change", () => {
                    const next = String(variety.value || "");
                    if (next === ADD_VARIETY_VALUE) { // CHANGE
                        variety.value = crop.varietyId == null ? "" : String(crop.varietyId); // CHANGE
                        requestVarietyEditor(crop.plantId, null, crop.id); // CHANGE
                        return; // CHANGE
                    } // CHANGE
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
                    const editing = crop.varietyId !== null && crop.varietyId !== undefined && crop.varietyId !== ""; // CHANGE
                    requestVarietyEditor(crop.plantId, editing ? crop.varietyId : null, crop.id); // CHANGE
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
                    createChip(metric.shortKg > EPS ? "Short" : "Status", metric.shortKg > EPS ? formatKg(metric.shortKg) : "OK", metric.shortKg > EPS ? "danger" : "success", null, metric.shortKg > EPS ? { primaryTarget: { area: "plan-check", rowKind: "shortage-weeks" } } : null), // CHANGE
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

            function demandLineTarget(line, field) {
                return { area: "demand", field, lineId: String(line && line.id || "") }; // CHANGE
            } // CHANGE

            function selfLineTarget(line, field, lineIndex) {
                return { area: "self-sufficiency", field, selfLineId: String(line && line.id || ""), selfLineIndex: lineIndex };
            } // CHANGE

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
                const datesInvalid = from === "?" || to === "?" || (PlanMath.hasYmd(line && line.from) && PlanMath.hasYmd(line && line.to) && line.from > line.to); // CHANGE
                const priceTarget = missingPackagePriceTargetForLine(line); // CHANGE
                return [
                    createChip("Crop", crop ? cropLabel(crop) : String(line && line.cropId || "Crop"), crop ? "primary" : "warning", null, crop ? null : { primaryTarget: demandLineTarget(line, "cropId") }), // CHANGE
                    createChip("Qty", `${formatCompactNumber(line && line.qty)} ${line && line.unit || "No unit"} / ${demandFrequencyLabel(line && line.frequency, line && line.everyN)}`, "neutral"), // CHANGE
                    createChip("Dates", `${from}-${to}`, datesInvalid ? "warning" : "neutral", null, datesInvalid ? { targets: [demandLineTarget(line, "from"), demandLineTarget(line, "to")] } : null), // CHANGE
                    createChip("Priority", priorityLabel, "neutral"),
                    createChip("Demand", formatKg(demandKg), "neutral"),
                    createChip(shortKg > EPS ? "Short" : "Status", shortKg > EPS ? formatKg(shortKg) : (result ? "OK" : "Not calculated"), shortKg > EPS ? "danger" : (result ? "success" : "warning"), null, shortKg > EPS || !result ? { primaryTarget: { area: "demand", lineId: String(line && line.id || ""), channelId: String(line && line.channelId || "") } } : null), // CHANGE
                    createChip("Potential", formatMoney(potentialRevenue), result && !Number.isFinite(result.unitPrice) ? "warning" : "neutral", null, result && !Number.isFinite(result.unitPrice) ? { primaryTarget: priceTarget || demandLineTarget(line, "unit") } : null), // CHANGE: blank package prices still calculate demand but flag understated revenue.
                    createChip("Fulfilled", formatMoney(fulfilledRevenue), fulfilledRevenue > EPS ? "success" : "neutral")
                ];
            }

            function createDemandLine(channelId, packageSelection) {
                const crop = packageSelection && packageSelection.crop ? packageSelection.crop : ((plan.crops || [])[0] || null); // CHANGE
                const unit = packageSelection && packageSelection.unit !== undefined ? String(packageSelection.unit || "") : defaultUnit(crop); // CHANGE
                return {
                    id: Env.uid("demand"),
                    channelId: String(channelId || ""),
                    cropId: crop ? crop.id : "",
                    qty: 1,
                    unit,
                    frequency: "week",
                    everyN: 1,
                    from: crop && crop.harvestStart || "",
                    to: crop && crop.harvestEnd || "",
                    priority: "target",
                    notes: ""
                };
            }

            function openDemandPackagePicker(channelId) {
                openPackageTransferPicker({
                    kind: "demand",
                    destinationId: channelId,
                    title: "Manage demand packages"
                });
            } // CHANGE

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
                const cropSelect = mkCropSelectForDestination("demand", line.channelId, line.cropId || "", line);
                const qty = mkInput("number", line.qty ?? 1);
                qty.min = "0"; qty.step = "any";
                const unit = mkPackageUnitSelect(crop, line.unit || defaultUnit(crop), null, allowedPackageKeysForRow(crop, line.unit, "demand", line.channelId, line)); // CHANGE
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
                addField(row, "Crop", wrapDestinationCropSelect(cropSelect)); // CHANGE
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
                    const nextCrop = handleCropSelectPackageNavigation(cropSelect, line.cropId); // CHANGE
                    if (!nextCrop) return; // CHANGE
                    line.cropId = cropSelect.value;
                    line.unit = firstUnusedPackageUnit(nextCrop, "demand", line.channelId, line); // CHANGE
                    refreshDerived(null, { rebuildDemand: true });
                });
                qty.addEventListener("input", () => { line.qty = Math.max(0, Number(qty.value) || 0); debounceRefresh(); });
                unit.addEventListener("change", () => handlePackageUnitSelection(unit, line.cropId, value => { line.unit = value; }, () => refreshDerived(null, { rebuildDemand: true }))); // CHANGE
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
                const enabled = channel.enabled !== false; // CHANGE
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
                const enabledToggle = createEnabledToggle("Enabled", enabled, checked => { channel.enabled = checked; refreshDerived(null, { rebuildDemand: true }); }); // CHANGE
                const summary = document.createElement("div");
                summary.className = "yp-demand-channel-summary";
                setChipRow(summary, enabled ? buildChannelSummaryChips(metric) : [createDisabledChip()]); // CHANGE
                demandRefs.channelSummaries.set(channelId, summary);
                const lines = (plan.demands || []).filter(line => String(line.channelId) === channelId);
                const removeChannel = mkBtn("Remove channel", "danger");
                removeChannel.disabled = lines.length > 0;
                removeChannel.title = lines.length ? "Remove or move all demand lines before removing this channel." : "";
                const collapsed = state.collapsedDemandChannelIds.has(channelId);
                const toggle = mkBtn(collapsed ? "Expand" : "Collapse", "neutral");
                toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
                header.appendChild(enabledToggle); header.appendChild(label); header.appendChild(type); header.appendChild(summary); header.appendChild(removeChannel); header.appendChild(toggle); // CHANGE
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
                const add = mkBtn("Manage packages", "add"); // CHANGE
                add.style.marginTop = "8px";
                add.disabled = !(plan.crops || []).length; // CHANGE
                add.title = (plan.crops || []).length ? "Add or remove crop packages for this channel." : "Add crops before managing packages."; // CHANGE
                add.addEventListener("click", () => openDemandPackagePicker(channelId)); // CHANGE
                details.appendChild(rows); details.appendChild(add);
                box.appendChild(header); box.appendChild(details); host.appendChild(box);
                applyDisabledAreaState(box, !enabled); // CHANGE
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
                toolbar.appendChild(addChannel); // CHANGE: demand rows are added from each channel's own bulk picker.
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
            }

            function cropAvailabilityEnd(crop) {
                if (!crop || !PlanMath.hasYmd(crop.harvestEnd)) return "";
                const shelfDays = Math.max(0, Math.trunc(Number(crop.shelfLifeDays) || 0));
                return shelfDays > 0 ? (PlanRuntimeService.addDaysYmd(crop.harvestEnd, shelfDays) || crop.harvestEnd) : (PlanRuntimeService.cropAvailableEndYmd(crop) || crop.harvestEnd);
            } // NEW: self-use rows default to the edible availability window, including shelf-life.

            function createSelfSufficiencyLine(packageSelection) {
                const crop = packageSelection && packageSelection.crop ? packageSelection.crop : ((plan.crops || [])[0] || null); // CHANGE
                const unit = packageSelection && packageSelection.unit !== undefined ? String(packageSelection.unit || "") : defaultUnit(crop); // CHANGE
                return {
                    id: Env.uid("self"),
                    cropId: crop ? crop.id : "",
                    qty: 1,
                    unit,
                    frequency: "week",
                    everyN: 1,
                    from: crop && crop.harvestStart || "",
                    to: cropAvailabilityEnd(crop)
                };
            } // NEW

            function openSelfPackagePicker() {
                openPackageTransferPicker({
                    kind: "self",
                    destinationId: "self-use",
                    title: "Manage self-use packages"
                });
            } // CHANGE

            function createCsaComponent(packageSelection) {
                const crop = packageSelection && packageSelection.crop ? packageSelection.crop : ((plan.crops || [])[0] || null);
                const unit = packageSelection && packageSelection.unit !== undefined ? String(packageSelection.unit || "") : defaultUnit(crop);
                return { cropId: crop ? crop.id : "", qty: 1, unit, everyNWeeks: 1, start: plan.csa && plan.csa.start || "", end: plan.csa && plan.csa.end || "" };
            } // CHANGE

            function openCsaPackagePicker(renderRows, refreshSummary) {
                openPackageTransferPicker({
                    kind: "csa",
                    destinationId: "csa",
                    title: "Manage CSA packages",
                    renderRows,
                    refreshSummary
                });
            } // CHANGE

            function selfSufficiencyValidationResults() {
                return ((dashboard && dashboard.validationErrors) || []).filter(error => error && error.scope === "self-sufficiency");
            } // NEW

            function selfLineSummaryChips(line, crop, lineIndex) {
                const result = runtime && runtime.weekly && runtime.weekly.perSelfLine && runtime.weekly.perSelfLine.get(String(line && line.id || ""));
                const demandKg = result ? sumPositiveValues(result.target) : 0;
                const shortKg = result ? sumPositiveValues(result.short) : 0;
                const groceryValue = result ? sumPositiveValues(result.groceryValue) : 0;
                const fulfilledGroceryValue = result ? sumPositiveValues(result.fulfilledGroceryValue) : 0;
                const from = YearPlanDashboard.formatYmd(line && line.from) || "?";
                const to = YearPlanDashboard.formatYmd(line && line.to) || "?";
                const datesInvalid = from === "?" || to === "?" || (PlanMath.hasYmd(line && line.from) && PlanMath.hasYmd(line && line.to) && line.from > line.to); // CHANGE
                const priceTarget = missingPackagePriceTargetForLine(line); // CHANGE
                return [
                    createChip("Crop", crop ? cropLabel(crop) : String(line && line.cropId || "Crop"), crop ? "primary" : "warning", null, crop ? null : { primaryTarget: selfLineTarget(line, "cropId", lineIndex) }), // CHANGE
                    createChip("Qty", `${formatCompactNumber(line && line.qty)} ${line && line.unit || "No unit"} / ${demandFrequencyLabel(line && line.frequency, line && line.everyN)}`, "neutral"), // CHANGE
                    createChip("Dates", `${from}-${to}`, datesInvalid ? "warning" : "neutral", null, datesInvalid ? { targets: [selfLineTarget(line, "from", lineIndex), selfLineTarget(line, "to", lineIndex)] } : null), // CHANGE
                    createChip("Demand", formatKg(demandKg), "neutral"),
                    createChip(shortKg > EPS ? "Short" : "Status", shortKg > EPS ? formatKg(shortKg) : (result ? "OK" : "Not calculated"), shortKg > EPS ? "danger" : (result ? "success" : "warning"), null, shortKg > EPS || !result ? { primaryTarget: { area: "self-sufficiency", selfLineId: String(line && line.id || ""), selfLineIndex: lineIndex } } : null), // CHANGE
                    createChip("Grocery value", formatMoney(groceryValue), result && !Number.isFinite(result.unitPrice) ? "warning" : "neutral", null, result && !Number.isFinite(result.unitPrice) ? { primaryTarget: priceTarget || selfLineTarget(line, "unit", lineIndex) } : null), // CHANGE: blank package prices still calculate demand but flag understated grocery value.
                    createChip("Fulfilled", formatMoney(fulfilledGroceryValue), fulfilledGroceryValue > EPS ? "success" : "neutral")
                ];
            } // NEW

            function openCropPackages(cropId) {
                if (!setSelectedCropEverywhere(cropId, { expandCropPlan: true, syncPlanCheck: false, activeTab: "packages" })) return;
                renderCropList();
                renderSelectedEditor();
                renderCropPlan(true);
                scrollToElement(editorBox.querySelector("[data-year-plan-packages-section]") || editorBox, "start"); // CHANGE
            } // NEW

            function formatNutritionValue(value, unit) {
                const number = Math.max(0, Number(value) || 0);
                const fixed = number >= 100 ? number.toFixed(0) : (number >= 10 ? number.toFixed(1) : number.toFixed(2));
                return `${fixed} ${unit || ""}`.trim();
            } // NEW

            function renderSelfNutrition(details) {
                const nutrition = dashboard && dashboard.selfSufficiencyNutrition;
                if (!nutrition) return;
                const box = document.createElement("div");
                box.dataset.yearPlanNutritionSection = "true"; // CHANGE
                box.style.cssText = "margin:0 0 10px;";
                const title = document.createElement("div");
                title.style.cssText = "font-weight:700;margin-bottom:6px;";
                title.textContent = "Annual nutrition coverage";
                const table = document.createElement("table");
                table.style.cssText = "width:100%;border-collapse:collapse;";
                const rows = (nutrition.rows || []).map(row => `<tr><td>${mxUtils.htmlEntities(row.label)}</td><td>${formatNutritionValue(row.requirementAmount, row.unit)}</td><td>${formatNutritionValue(row.requestedAmount, row.unit)}</td><td>${Math.max(0, Number(row.requestedCoveragePct) || 0).toFixed(0)}%</td><td>${formatNutritionValue(row.fulfilledAmount, row.unit)}</td><td>${Math.max(0, Number(row.fulfilledCoveragePct) || 0).toFixed(0)}%</td></tr>`).join("");
                table.innerHTML = `<thead><tr><th>Nutrient</th><th>Annual need</th><th>Requested</th><th>Target</th><th>Fulfilled</th><th>Covered</th></tr></thead><tbody>${rows}</tbody>`;
                for (const cell of table.querySelectorAll("th,td")) cell.style.cssText = "border:1px solid #ddd;padding:4px;text-align:left;";
                box.appendChild(title);
                box.appendChild(table);
                if (nutrition.warnings && nutrition.warnings.length) {
                    const warning = document.createElement("div");
                    warning.style.cssText = `color:${YP_COLORS.warning};font-size:11px;margin-top:5px;`;
                    warning.textContent = nutrition.warnings.join(" ");
                    box.appendChild(warning);
                }
                details.appendChild(box);
            } // NEW

            function renderSelfSufficiencyLine(line, host, lineIndex) {
                const crop = PlanMath.findCrop(plan, line.cropId);
                const lineId = String(line.id || "");
                const shell = document.createElement("section"); // NEW
                shell.className = "yp-demand-line-shell yp-self-line-shell"; // NEW
                shell.dataset.selfLineId = lineId; // NEW
                shell.dataset.yearPlanSelfLineIndex = String(lineIndex); // NEW
                const collapsed = state.collapsedSelfSufficiencyLineIds.has(lineId); // NEW
                const header = document.createElement("div"); // NEW
                header.className = "yp-demand-line-header yp-self-line-header"; // NEW
                const toggle = mkBtn(collapsed ? "Expand" : "Collapse", "neutral"); // NEW
                toggle.setAttribute("aria-expanded", collapsed ? "false" : "true"); // NEW
                const summary = document.createElement("div"); // NEW
                summary.className = "yp-demand-line-summary yp-self-line-summary"; // NEW
                setChipRow(summary, selfLineSummaryChips(line, crop, lineIndex)); // CHANGE
                header.appendChild(toggle); header.appendChild(summary); // NEW
                const row = document.createElement("div");
                row.className = "yp-demand-line yp-self-line yp-self-line-details"; // NEW
                row.style.display = collapsed ? "none" : "grid"; // NEW
                const cropSelect = mkCropSelectForDestination("self", "self-use", line.cropId || "", line);
                const qty = mkInput("number", line.qty ?? 1);
                qty.min = "0"; qty.step = "any";
                const unit = mkPackageUnitSelect(crop, line.unit || defaultUnit(crop), null, allowedPackageKeysForRow(crop, line.unit, "self", "self-use", line)); // CHANGE
                const frequency = mkSelect([{ value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }], line.frequency || "week");
                const every = mkInput("number", line.everyN ?? 1);
                every.min = "1"; every.step = "1";
                const from = mkInput("date", line.from || "");
                const to = mkInput("date", line.to || "");
                const remove = mkBtn("Remove", "danger");
                const editPackages = mkBtn("Edit packages", "neutral");
                editPackages.disabled = !crop;
                editPackages.title = crop ? "Open this crop's Packages tab." : "Choose a crop before editing packages.";
                ensureSelectOption(cropSelect, line.cropId, `${line.cropId || "Missing crop"} (unavailable)`);
                cropSelect.value = String(line.cropId || "");
                setYearPlanField(cropSelect, "cropId", { selfLineId: lineId, selfLineIndex: lineIndex });
                setYearPlanField(qty, "qty", { selfLineId: lineId, selfLineIndex: lineIndex });
                setYearPlanField(unit, "unit", { selfLineId: lineId, selfLineIndex: lineIndex });
                setYearPlanField(frequency, "frequency", { selfLineId: lineId, selfLineIndex: lineIndex });
                setYearPlanField(every, "everyN", { selfLineId: lineId, selfLineIndex: lineIndex });
                setYearPlanField(from, "from", { selfLineId: lineId, selfLineIndex: lineIndex });
                setYearPlanField(to, "to", { selfLineId: lineId, selfLineIndex: lineIndex });
                addField(row, "Crop", cropSelect);
                addField(row, "Qty", qty);
                addField(row, "Unit", unit, Number.isFinite(PlanMath.resolveUnitToKgPerUnit(crop, line.unit)) ? "" : "Add or repair this unit on the crop Packages tab.");
                addField(row, "Frequency", frequency);
                addField(row, "Every", every);
                addField(row, "From", from);
                addField(row, "To", to);
                addField(row, "Packages", editPackages);
                addField(row, "Remove", remove);
                shell.appendChild(header); // NEW
                shell.appendChild(row); // NEW
                host.appendChild(shell); // NEW
                toggle.addEventListener("click", () => { // NEW
                    if (collapsed) state.collapsedSelfSufficiencyLineIds.delete(lineId); // NEW
                    else state.collapsedSelfSufficiencyLineIds.add(lineId); // NEW
                    saveCollapsePreferences(); // NEW
                    renderSelfSufficiencyStrip(true); // NEW
                }); // NEW
                cropSelect.addEventListener("change", () => {
                    const nextCrop = handleCropSelectPackageNavigation(cropSelect, line.cropId); // CHANGE
                    if (!nextCrop) return; // CHANGE
                    line.cropId = cropSelect.value;
                    line.unit = firstUnusedPackageUnit(nextCrop, "self", "self-use", line); // CHANGE
                    line.from = nextCrop && nextCrop.harvestStart || "";
                    line.to = cropAvailabilityEnd(nextCrop);
                    refreshDerived(null, { rebuildSelfSufficiency: true });
                });
                qty.addEventListener("input", () => { line.qty = Math.max(0, Number(qty.value) || 0); debounceRefresh({ rebuildSelfSufficiency: true }); }); // CHANGE: nutrition coverage is rendered inside cached strip details.
                unit.addEventListener("change", () => handlePackageUnitSelection(unit, line.cropId, value => { line.unit = value; }, () => refreshDerived(null, { rebuildSelfSufficiency: true }))); // CHANGE
                frequency.addEventListener("change", () => { line.frequency = frequency.value; refreshDerived(null, { rebuildSelfSufficiency: true }); }); // CHANGE
                every.addEventListener("input", () => { line.everyN = Math.max(1, Math.trunc(Number(every.value) || 1)); debounceRefresh({ rebuildSelfSufficiency: true }); }); // CHANGE
                editPackages.addEventListener("click", () => { if (line.cropId) openCropPackages(line.cropId); });
                bindPairedDateControls(from, to, {
                    diagnostic: `Self Sufficiency start date cannot be after end date for "${crop ? cropLabel(crop) : line.cropId}".`,
                    setStart: value => { line.from = value; },
                    setEnd: value => { line.to = value; },
                    afterCommit: beforeDateRanges => refreshDerived(beforeDateRanges, { rebuildSelfSufficiency: true }) // CHANGE
                });
                remove.addEventListener("click", () => {
                    plan.selfSufficiency.lines = (plan.selfSufficiency.lines || []).filter(item => item !== line);
                    state.collapsedSelfSufficiencyLineIds.delete(lineId); // NEW
                    saveCollapsePreferences(); // NEW
                    refreshDerived(null, { rebuildSelfSufficiency: true });
                });
            } // NEW

            function renderSelfSufficiency(details) {
                plan.selfSufficiency = plan.selfSufficiency || { adults: 0, children: 0, nutritionMultiplier: 1, lines: [] };
                plan.selfSufficiency.lines = Array.isArray(plan.selfSufficiency.lines) ? plan.selfSufficiency.lines : [];
                const controls = document.createElement("div");
                controls.className = "yp-row";
                controls.style.marginBottom = "9px";
                const adults = mkInput("number", plan.selfSufficiency.adults ?? 0, 90);
                adults.min = "0"; adults.step = "1";
                const children = mkInput("number", plan.selfSufficiency.children ?? 0, 90);
                children.min = "0"; children.step = "1";
                const multiplier = mkInput("number", plan.selfSufficiency.nutritionMultiplier ?? 1, 90);
                multiplier.min = "0.01"; multiplier.step = "0.01";
                const addLine = mkBtn("Manage packages", "add"); // CHANGE
                addLine.disabled = !(plan.crops || []).length; // CHANGE
                addLine.title = (plan.crops || []).length ? "Add or remove crop packages for self-use." : "Add crops before managing packages."; // CHANGE
                setYearPlanField(adults, "adults");
                setYearPlanField(children, "children");
                setYearPlanField(multiplier, "nutritionMultiplier");
                controls.appendChild(document.createTextNode("Adults")); controls.appendChild(adults);
                controls.appendChild(document.createTextNode("Children")); controls.appendChild(children);
                controls.appendChild(document.createTextNode("Nutrition multiplier")); controls.appendChild(multiplier);
                controls.appendChild(addLine);
                const note = document.createElement("div");
                note.style.cssText = "color:#666;font-size:11px;margin:-2px 0 9px;";
                note.textContent = "Nutrition coverage is a planning estimate, not dietary advice. Harvest kg is treated as edible kg.";
                const rowsHost = document.createElement("div");
                rowsHost.style.cssText = "display:flex;flex-direction:column;gap:8px;";
                details.appendChild(controls);
                details.appendChild(note);
                renderSelfNutrition(details);
                details.appendChild(rowsHost);
                plan.selfSufficiency.lines.forEach((line, index) => renderSelfSufficiencyLine(line, rowsHost, index));
                if (!plan.selfSufficiency.lines.length) {
                    const empty = document.createElement("div");
                    empty.style.cssText = "padding:12px;color:#666;text-align:center;";
                    empty.textContent = "Add crop-specific household consumption lines to plan personal use.";
                    rowsHost.appendChild(empty);
                }
                adults.addEventListener("input", () => { plan.selfSufficiency.adults = Math.max(0, Math.trunc(Number(adults.value) || 0)); debounceRefresh({ rebuildSelfSufficiency: true }); }); // CHANGE
                children.addEventListener("input", () => { plan.selfSufficiency.children = Math.max(0, Math.trunc(Number(children.value) || 0)); debounceRefresh({ rebuildSelfSufficiency: true }); }); // CHANGE
                multiplier.addEventListener("input", () => { plan.selfSufficiency.nutritionMultiplier = Math.max(0.01, Number(multiplier.value) || 1); debounceRefresh({ rebuildSelfSufficiency: true }); }); // CHANGE
                addLine.addEventListener("click", () => {
                    openSelfPackagePicker(); // CHANGE
                });
            } // NEW

            function renderSelfSufficiencyStrip(rebuildDetails) {
                const self = plan.selfSufficiency || {};
                const enabled = self.enabled !== false; // CHANGE
                const metric = dashboard && dashboard.selfSufficiencyMetric || {};
                const nutrition = dashboard && dashboard.selfSufficiencyNutrition;
                const lineCount = Array.isArray(self.lines) ? self.lines.length : 0;
                const errors = PlanSchema.validateSelfSufficiency(plan);
                renderStripBox(selfSufficiencyBox, {
                    title: "Self Sufficiency",
                    expanded: state.selfSufficiencyExpanded,
                    renderHeaderControls: host => host.appendChild(createEnabledToggle("Enabled", enabled, checked => { plan.selfSufficiency.enabled = checked; refreshDerived(null, { rebuildSelfSufficiency: true }); })), // CHANGE
                    summaryChips: !enabled ? [createDisabledChip()] : [ // CHANGE
                        createChip("Adults", String(Math.max(0, Math.trunc(Number(self.adults) || 0))), "neutral"),
                        createChip("Children", String(Math.max(0, Math.trunc(Number(self.children) || 0))), "neutral"),
                        errors.length ? createValidationAttentionChip("Setup issues", "danger", errors, true, () => { state.selfSufficiencyExpanded = true; renderSelfSufficiencyStrip(true); }) : createChip("Lines", String(lineCount), "neutral"), // CHANGE
                        createChip("Demand", formatKg(metric.targetKg), "primary"),
                        metric.shortKg > EPS ? createWarningChipWithDetails("Short", formatKg(metric.shortKg), "danger", null, { primaryTarget: { area: "plan-check", rowKind: "shortage-weeks" }, diagnosticsLabel: "All warnings" }) : createChip("Short", formatKg(metric.shortKg), "success"), // CHANGE
                        createChip("Grocery value", formatMoney(metric.groceryValue), "neutral"),
                        createChip("Fulfilled", formatMoney(metric.fulfilledGroceryValue), metric.fulfilledGroceryValue > EPS ? "success" : "neutral"),
                        nutrition && nutrition.available && !(nutrition.missingCropNames && nutrition.missingCropNames.length)
                            ? createChip("Nutrition", "Mapped", "neutral")
                            : createWarningChipWithDetails("Nutrition", nutrition && nutrition.available ? "Partial" : "Unavailable", "warning", null, { primaryTarget: { area: "self-sufficiency", section: "nutrition" }, diagnosticsLabel: "All warnings" }) // CHANGE
                    ],
                    rebuildDetails: !!rebuildDetails,
                    onToggle: () => {
                        state.selfSufficiencyExpanded = !state.selfSufficiencyExpanded;
                        saveCollapsePreferences();
                        renderSelfSufficiencyStrip(state.selfSufficiencyExpanded);
                    },
                    renderDetails: details => { renderSelfSufficiency(details); applyDisabledAreaState(details, !enabled); } // CHANGE
                });
            } // NEW

            function renderDemandStrip(rebuildDetails) {
                const channelCount = (plan.demandChannels || []).length;
                const lineCount = (plan.demands || []).length;
                const demandKg = (dashboard && dashboard.channelMetrics || []).reduce((sum, metric) => sum + metric.targetKg, 0);
                const shortKg = (dashboard && dashboard.channelMetrics || []).reduce((sum, metric) => sum + metric.shortKg, 0);
                const demandErrors = PlanSchema.validateDemand(plan); // CHANGE
                renderStripBox(demandBox, {
                    title: "Demand",
                    expanded: state.demandExpanded,
                    summaryChips: [
                        createChip("Channels", String(channelCount), "neutral"),
                        demandErrors.length ? createValidationAttentionChip("Setup issues", "danger", demandErrors, true, () => { state.demandExpanded = true; renderDemandStrip(true); }) : createChip("Lines", String(lineCount), "neutral"), // CHANGE
                        createChip("Demand", formatKg(demandKg), "primary"),
                        shortKg > EPS ? createWarningChipWithDetails("Short", formatKg(shortKg), "danger", null, { primaryTarget: { area: "plan-check", rowKind: "shortage-weeks" }, diagnosticsLabel: "All warnings" }) : createChip("Short", formatKg(shortKg), "success"), // CHANGE
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
                content.dataset.yearPlanPackagesSection = "true"; // CHANGE
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
                        unit.placeholder = "package label";
                        const baseQty = mkInput("number", pkg.baseQty ?? 1);
                        const currentBaseType = String(pkg.baseType || "kg").trim().toLowerCase();
                        const baseOptions = currentBaseType === "plants" ? PACKAGE_BASE_OPTIONS.concat([{ value: "plants", label: "plants (legacy)" }]) : PACKAGE_BASE_OPTIONS;
                        const baseType = mkSelect(baseOptions, currentBaseType || "kg");
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
                        unit.addEventListener("input", () => { pkg.unit = unit.value; debounceRefresh({ rebuildSelfSufficiency: true, rebuildDemand: true, rebuildCsa: true }); });
                        baseQty.addEventListener("input", () => { pkg.baseQty = Math.max(0, Number(baseQty.value) || 0); debounceRefresh({ rebuildSelfSufficiency: true }); });
                        baseType.addEventListener("change", () => { pkg.baseType = baseType.value; refreshDerived(null, { rebuildSelfSufficiency: true }); });
                        price.addEventListener("input", () => { pkg.price = price.value === "" ? NaN : Math.max(0, Number(price.value) || 0); debounceRefresh({ rebuildSelfSufficiency: true, rebuildDemand: true }); });
                        remove.addEventListener("click", () => { if (!removePackageAndLinkedRows(crop, pkg)) return; renderRows(); refreshDerived(null, { rebuildSelfSufficiency: true, rebuildDemand: true, rebuildCsa: true }); }); // CHANGE
                    }
                }

                add.addEventListener("click", () => {
                    addPackageAndFocusUnit(crop); // CHANGE
                });
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
                    const index = removePlanCropAndLinkedRows(crop); // CHANGE
                    const nextCropId = YearPlanDashboard.resolveSelectedCropId(plan.crops, "", index);
                    if (nextCropId) setSelectedCropEverywhere(nextCropId);
                    else { state.selectedCropId = ""; plan.cropFilterId = ""; cropFilterSel.value = ""; }
                    saveCollapsePreferences();
                    renderSelectedEditor(); fillCropFilter(); refreshDerived(null, { rebuildSelfSufficiency: true, rebuildCsa: true, rebuildDemand: true }); loadAddCropOptions(false);
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
                    renderHeaderControls: host => host.appendChild(createEnabledToggle("Enabled", !!plan.csa.enabled, checked => { plan.csa.enabled = checked; refreshDerived(null, { rebuildCsa: true }); })), // CHANGE
                    summaryChips: !plan.csa.enabled ? [createDisabledChip()] : [ // CHANGE
                        createChip("Boxes/week", String(Math.max(0, Math.trunc(Number(plan.csa.boxesPerWeek) || 0))), "neutral"),
                        csaErrors.length ? createValidationAttentionChip("CSA setup issues", "danger", csaErrors, true, () => { state.csaExpanded = true; renderCsa(true); }) : createChip("Dates", `${start}-${end}`, "neutral"), // CHANGE
                        createChip("Components", String(componentCount), "neutral"),
                        createChip("Component value", formatMoney(csaMetric.componentValuePerBox), "neutral"),
                        createChip("Sale value", formatMoney(csaMetric.salePricePerBox), "neutral"),
                        createChip("Potential", formatMoney(csaMetric.potentialRevenue), "neutral"),
                        createChip("Fulfilled", formatMoney(csaMetric.fulfilledRevenue), Number(csaMetric.fulfilledRevenue) > EPS ? "success" : "neutral")
                    ],
                    rebuildDetails: !!rebuildDetails && state.csaExpanded,
                    onToggle: () => { state.csaExpanded = !state.csaExpanded; saveCollapsePreferences(); renderCsa(state.csaExpanded); },
                    renderDetails: details => { renderCsaDetails(details); applyDisabledAreaState(details, !plan.csa.enabled); } // CHANGE
                });
            }

            function renderCsaDetails(details) {
                const controls = document.createElement("div");
                controls.className = "yp-row";
                const pricingControls = document.createElement("div");
                pricingControls.className = "yp-row";
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
                setYearPlanField(boxes, "boxesPerWeek");
                setYearPlanField(start, "start");
                setYearPlanField(end, "end");
                setYearPlanField(componentValue, "componentValuePerBox");
                setYearPlanField(salePrice, "salePricePerBox");
                controls.appendChild(document.createTextNode("Boxes/week")); controls.appendChild(boxes); controls.appendChild(document.createTextNode("Start")); controls.appendChild(start); controls.appendChild(document.createTextNode("End")); controls.appendChild(end); // CHANGE
                pricingControls.appendChild(document.createTextNode("Component value / box")); pricingControls.appendChild(componentValue); pricingControls.appendChild(document.createTextNode("Sale value / box")); pricingControls.appendChild(salePrice); pricingControls.appendChild(resetSale);
                const rowsHost = document.createElement("div");
                rowsHost.style.cssText = "display:flex;flex-direction:column;gap:7px;margin-top:10px;";
                const add = mkBtn("Manage packages", "add"); // CHANGE
                add.style.marginTop = "8px";
                add.disabled = !(plan.crops || []).length; // CHANGE
                add.title = (plan.crops || []).length ? "Add or remove crop packages for CSA." : "Add crops before managing packages."; // CHANGE
                details.appendChild(controls); details.appendChild(pricingControls); details.appendChild(rowsHost); details.appendChild(add);
                csaRefs = { componentValue, salePrice, resetSale };
                const refreshSummary = () => { renderCsa(false); };
                const syncNonDateControls = () => { plan.csa.boxesPerWeek = Math.max(0, Math.trunc(Number(boxes.value) || 0)); refreshSummary(); debounceRefresh(); }; // CHANGE
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
                        const cropSelect = mkCropSelectForDestination("csa", "csa", component.cropId || "", component, 220); // CHANGE
                        const qty = mkInput("number", component.qty ?? 1, 70);
                        const unit = mkPackageUnitSelect(crop, component.unit || defaultUnit(crop), 130, allowedPackageKeysForRow(crop, component.unit, "csa", "csa", component)); // CHANGE
                        const every = mkInput("number", component.everyNWeeks ?? 1, 65);
                        const from = mkInput("date", component.start || plan.csa.start || "", 145);
                        const to = mkInput("date", component.end || plan.csa.end || "", 145);
                        ensureSelectOption(cropSelect, component.cropId, `${component.cropId || "Missing crop"} (unavailable)`);
                        cropSelect.value = String(component.cropId || "");
                        setYearPlanField(cropSelect, "cropId", { componentIndex });
                        setYearPlanField(qty, "qty", { componentIndex });
                        setYearPlanField(unit, "unit", { componentIndex });
                        setYearPlanField(every, "everyNWeeks", { componentIndex });
                        setYearPlanField(from, "start", { componentIndex });
                        setYearPlanField(to, "end", { componentIndex });
                        const remove = mkBtn("Remove", "danger");
                        row.appendChild(wrapDestinationCropSelect(cropSelect)); row.appendChild(qty); row.appendChild(unit); row.appendChild(document.createTextNode("Every")); row.appendChild(every); row.appendChild(document.createTextNode("weeks")); row.appendChild(from); row.appendChild(to); row.appendChild(remove); // CHANGE
                        rowsHost.appendChild(row);
                        cropSelect.addEventListener("change", () => { const nextCrop = handleCropSelectPackageNavigation(cropSelect, component.cropId); if (!nextCrop) return; component.cropId = cropSelect.value; component.unit = firstUnusedPackageUnit(nextCrop, "csa", "csa", component); renderRows(); refreshDerived(); }); // CHANGE
                        qty.addEventListener("input", () => { component.qty = Math.max(0, Number(qty.value) || 0); debounceRefresh(); });
                        unit.addEventListener("change", () => handlePackageUnitSelection(unit, component.cropId, value => { component.unit = value; }, () => refreshDerived(null, { rebuildCsa: true }))); // CHANGE
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
                    openCsaPackagePicker(renderRows, refreshSummary); // CHANGE
                });
                renderRows();
            }

            function renderAll() {
                fillPlanCheckScope();
                fillCropFilter();
                renderSelectedEditor();
                renderCropPlan(true);
                refreshDerived(null, { rebuildSelfSufficiency: true, rebuildCsa: true, rebuildDemand: true });
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
                    : [{ scope: "plan", code: "plan.empty_crops", message: EMPTY_PLAN_SAVE_MESSAGE, target: { area: "crop-list" } }]; // CHANGE: publishing requires an allocatable crop plan.
            }

            function commitValidationErrors() {
                return YearPlanDashboard.uniqueValidationResults([
                    ...PlanSchema.validate(plan),
                    ...validateSaveReadiness()
                ]);
            } // CHANGE: committed plans stay allocatable; drafts may remain incomplete.

            function isCommitReady() {
                return commitValidationErrors().length === 0;
            } // CHANGE

            function noteDraftSaved(record, validationErrors) {
                loadedDraftForCurrentYear = true;
                state.lastDraftSavedAt = parseStoredDate(record && record.updatedAt) || new Date();
                YearPlanDashboard.markBaseline(state, plan, null);
                state.validationState = (validationErrors || []).length ? "invalid" : "idle";
            } // CHANGE

            function saveDraft(validationErrors) {
                const record = PlanRepository.saveDraftForYear(moduleCell, currentYear, plan);
                noteDraftSaved(record, validationErrors || commitValidationErrors());
                return record;
            } // CHANGE

            function saveDraftIfDirty() {
                if (!YearPlanDashboard.isDirty(state, plan)) return false;
                saveDraft(commitValidationErrors());
                return true;
            } // CHANGE

            session.disposers.push(() => { if (SessionController.isActive(session)) saveDraftIfDirty(); }); // CHANGE: replaced dialogs also preserve dirty work as drafts.

            function focusSaveValidationFailure() {
                const firstDiagnostics = card.querySelector(".yp-diagnostics-trigger");
                const planCheckHeader = card.querySelector('[data-year-plan-strip="plan-check"] .yp-strip-header');
                if (firstDiagnostics) focusAndHighlight(firstDiagnostics);
                else if (planCheckHeader) focusAndHighlight(planCheckHeader); // CHANGE: empty-plan save failures have only the Plan Check list.
            }

            function saveCurrent(closeAfter) {
                state.saveValidationErrors = validateSaveReadiness(); // CHANGE: save-only rule runs for Save/commit readiness and draft diagnostics.
                refreshDerived();
                const validationErrors = commitValidationErrors(); // CHANGE
                if (validationErrors.length) {
                    saveDraft(validationErrors); // CHANGE
                    state.planCheckExpanded = true;
                    if (state.saveValidationErrors.some(error => error && error.code === "plan.empty_crops")) state.cropPlanExpanded = true; // CHANGE: show where to add the required crop.
                    if (PlanSchema.validateCsa(plan).length) state.csaExpanded = true;
                    if (closeAfter) { SessionController.close(); return true; } // CHANGE: Save draft & Close should not block leaving.
                    renderCsa(true); renderPlanCheck(); renderFooter();
                    focusSaveValidationFailure();
                    return true;
                }
                persistPackageDefaults();
                PlanRepository.savePlanForYear(moduleCell, currentYear, plan);
                PlanRepository.deleteDraftForYear(moduleCell, currentYear); // CHANGE
                loadedExistingForCurrentYear = true;
                loadedDraftForCurrentYear = false; // CHANGE
                YearPlanDashboard.markBaseline(state, plan, new Date());
                state.closePromptOpen = false;
                state.saveValidationErrors = []; // CHANGE: clear save-only diagnostics after a successful save.
                state.extraDiagnostics = [];
                state.lastDraftSavedAt = null; // CHANGE
                refreshDerived();
                if (closeAfter) SessionController.close();
                return true;
            }

            function requestClose() {
                refreshDerived();
                saveDraftIfDirty(); // CHANGE: closing preserves unfinished work without prompting.
                SessionController.close(); // CHANGE
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

            const addCropsButton = mkBtn("Add crops", "add"); // CHANGE
            const reloadPlants = mkBtn("Reload crops", "neutral");
            const plantMessage = document.createElement("span");
            plantMessage.style.color = "#666";
            addRow.appendChild(addCropsButton); addRow.appendChild(reloadPlants); addRow.appendChild(plantMessage); // CHANGE

            footerActions.appendChild(exportButton); footerActions.appendChild(reset);
            closePrompt.appendChild(promptSave); closePrompt.appendChild(promptDiscard); closePrompt.appendChild(promptCancel);

            function addCropOptionId(option) {
                return `addcrop:${String(option && option.plantId || "")}:${option && option.varietyId != null ? String(option.varietyId) : "base"}`;
            } // CHANGE

            function makeAddCropLeaf(option, disabled, meta) {
                const id = addCropOptionId(option);
                return {
                    id,
                    label: option.varietyName ? option.varietyName : "Base plant",
                    meta: meta || "",
                    selectable: !disabled,
                    disabled: !!disabled,
                    value: option
                };
            } // CHANGE

            function makeAddVarietyActionNode(plantId) { // CHANGE
                return { // CHANGE
                    id: `addcrop:add-variety:${String(plantId || "")}`, // CHANGE
                    label: "Add variety...", // CHANGE
                    action: "add-variety", // CHANGE
                    plantId: String(plantId || ""), // CHANGE
                    selectable: false, // CHANGE
                    disabled: false // CHANGE
                }; // CHANGE
            } // CHANGE

            function makeAddCropGroupNode(plantId, key, label, children) { // CHANGE
                return { id: `addcrop:${key}:${String(plantId || "")}`, label, children: children || [] }; // CHANGE
            } // CHANGE

            function makeAddCropPlantChildren(group) { // CHANGE
                const children = []; // CHANGE
                if (group.baseLeaf) children.push(group.baseLeaf); // CHANGE
                if (group.defaultLeaves.length && group.userLeaves.length) { // CHANGE
                    children.push(makeAddCropGroupNode(group.plantId, "trellis-defaults", "Trellis defaults", group.defaultLeaves)); // CHANGE
                    children.push(makeAddCropGroupNode(group.plantId, "your-varieties", "Your varieties", [group.addVarietyNode].concat(group.userLeaves))); // CHANGE
                } else if (group.defaultLeaves.length) { // CHANGE
                    children.push(makeAddCropGroupNode(group.plantId, "trellis-defaults", "Trellis defaults", group.defaultLeaves)); // CHANGE
                    children.push(makeAddCropGroupNode(group.plantId, "your-varieties", "Your varieties", [group.addVarietyNode])); // CHANGE
                } else { // CHANGE
                    children.push(group.addVarietyNode); // CHANGE
                    children.push(...group.userLeaves); // CHANGE
                } // CHANGE
                return children; // CHANGE
            } // CHANGE

            function makeAddCropPlantNode(group) { // CHANGE
                const children = makeAddCropPlantChildren(group); // CHANGE
                return {
                    id: `addcrop:plant:${String(group.plantId || group.plantName)}`,
                    label: `${group.plantName || "Crop"} (${group.varietyCount})`,
                    selects: group.baseLeafId ? "base" : null,
                    baseLeafId: group.baseLeafId,
                    children
                };
            } // CHANGE

            function appendAddCropCategory(nodes, label, optionsByPlant) {
                const plants = Array.from(optionsByPlant.values()).sort((a, b) => String(a.plantName || "").localeCompare(String(b.plantName || "")));
                const children = plants.map(group => makeAddCropPlantNode(group)); // CHANGE
                if (children.length) nodes.push({ id: `addcrop:category:${label.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-")}`, label, children }); // CHANGE
            } // CHANGE

            function addOptionToPlantGroup(map, option, disabled, meta) {
                const plantId = String(option && option.plantId || "");
                if (!map.has(plantId)) map.set(plantId, { plantId, plantName: option.plantName, baseLeaf: null, baseLeafId: "", defaultLeaves: [], userLeaves: [], addVarietyNode: makeAddVarietyActionNode(plantId), varietyCount: 0 }); // CHANGE
                const group = map.get(plantId);
                const leaf = makeAddCropLeaf(option, disabled, meta);
                if (option.varietyId == null) {
                    group.baseLeaf = leaf; // CHANGE
                    if (!disabled) group.baseLeafId = leaf.id;
                } else {
                    group.varietyCount += 1; // CHANGE
                    if (isTrellisDefaultVariety(option.varietyRow)) group.defaultLeaves.push(leaf); // CHANGE
                    else group.userLeaves.push(leaf); // CHANGE
                    group.defaultLeaves.sort((a, b) => compareDefaultVarietyRows(a.value && a.value.varietyRow, b.value && b.value.varietyRow)); // CHANGE
                    group.userLeaves.sort((a, b) => String(a.label || "").localeCompare(String(b.label || ""), undefined, { sensitivity: "base" })); // CHANGE
                }
            } // CHANGE

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
                addCropsButton.disabled = true; // CHANGE
                reloadPlants.disabled = true;
                addCropPickerNodes = []; // CHANGE
                plantMessage.textContent = "Loading crops...";
                try {
                    if (force) {
                        DbClient.invalidatePlantsBasicCache();
                        varietyCache.clear();
                    }
                    const plants = await DbClient.getPlantsBasicCached();
                    const plantRowsById = new Map(plants.map(row => [String(row.plant_id), row]));
                    const plannedKeys = new Set((plan.crops || []).map(crop => PlanSchema.getCropIdentityKey(crop)).filter(Boolean));
                    const gardenOptionsByPlant = new Map(); // CHANGE
                    const gardenKeys = new Set();
                    let skippedGardenCount = 0;

                    for (const candidate of DiagramPlanReader.readGardenCropCandidates(moduleCell)) {
                        const option = await resolveGardenCropOption(candidate, plantRowsById);
                        if (!option) { skippedGardenCount += 1; continue; }
                        const key = PlanSchema.makeCropIdentityKey(option.plantId, option.varietyId || "");
                        if (!key || gardenKeys.has(key)) continue; // CHANGE
                        gardenKeys.add(key);
                        addOptionToPlantGroup(gardenOptionsByPlant, option, plannedKeys.has(key), plannedKeys.has(key) ? "Already in plan" : ""); // CHANGE
                    }

                    if (!SessionController.isActive(session) || loadVersion !== addCropOptionsLoadVersion) return;
                    const byLifecycle = { annual: new Map(), biennial: new Map(), perennial: new Map(), uncategorized: new Map() }; // CHANGE
                    for (const row of plants) {
                        const plantId = String(row.plant_id);
                        const plantName = String(row.plant_name || "").trim();
                        const lifecycle = getPlantLifecycle(row);
                        const targetGroup = byLifecycle[lifecycle] || byLifecycle.uncategorized; // CHANGE
                        const baseOption = {
                            source: "database",
                            plantId,
                            plantName,
                            varietyId: null,
                            varietyName: "",
                            varietyRow: null,
                            row,
                            lifecycle,
                            label: plantName
                        };
                        const baseKey = PlanSchema.makeCropIdentityKey(plantId, "");
                        addOptionToPlantGroup(targetGroup, baseOption, plannedKeys.has(baseKey) || gardenKeys.has(baseKey), plannedKeys.has(baseKey) ? "Already in plan" : (gardenKeys.has(baseKey) ? "Shown in garden" : "")); // CHANGE
                        const varietyRows = await getVarietyRows(plantId); // CHANGE
                        for (const varietyRow of varietyRows.slice().sort((a, b) => String(a.variety_name || "").localeCompare(String(b.variety_name || "")))) {
                            const varietyId = String(varietyRow.variety_id);
                            const varietyName = String(varietyRow.variety_name || "").trim();
                            const varietyKey = PlanSchema.makeCropIdentityKey(plantId, varietyId);
                            addOptionToPlantGroup(targetGroup, {
                                source: "database",
                                plantId,
                                plantName,
                                varietyId,
                                varietyName,
                                varietyRow,
                                row,
                                lifecycle,
                                label: `${plantName} - ${varietyName}`
                            }, plannedKeys.has(varietyKey) || gardenKeys.has(varietyKey), plannedKeys.has(varietyKey) ? "Already in plan" : (gardenKeys.has(varietyKey) ? "Shown in garden" : "")); // CHANGE
                        }
                    }

                    const nodes = []; // CHANGE
                    appendAddCropCategory(nodes, "Crops in this garden", gardenOptionsByPlant); // CHANGE
                    appendAddCropCategory(nodes, "Annual crops", byLifecycle.annual); // CHANGE
                    appendAddCropCategory(nodes, "Biennial crops", byLifecycle.biennial); // CHANGE
                    appendAddCropCategory(nodes, "Perennial crops", byLifecycle.perennial); // CHANGE
                    appendAddCropCategory(nodes, "Uncategorized crops", byLifecycle.uncategorized); // CHANGE
                    addCropPickerNodes = nodes; // CHANGE
                    const skippedMessage = skippedGardenCount ? `Skipped ${skippedGardenCount} unavailable garden crop${skippedGardenCount === 1 ? "" : "s"}.` : "";
                    plantMessage.textContent = pendingAddCropMessage || skippedMessage; // CHANGE: preserve auto-add confirmation after the picker refreshes.
                    pendingAddCropMessage = "";
                } catch (error) {
                    if (SessionController.isActive(session) && loadVersion === addCropOptionsLoadVersion) {
                        addCropPickerNodes = []; // CHANGE
                        plantMessage.textContent = String(error && error.message || error);
                    }
                } finally {
                    if (SessionController.isActive(session) && loadVersion === addCropOptionsLoadVersion) {
                        addCropsButton.disabled = !addCropPickerNodes.length; // CHANGE
                        reloadPlants.disabled = false;
                    }
                }
            }

            function createCropFromAddOption(selectedOption) {
                if (!selectedOption) return null;
                if (PlanSchema.findDuplicateCrop(plan, selectedOption.plantId, selectedOption.varietyId || "", "")) {
                    state.extraDiagnostics = [`Crop already exists for ${selectedOption.label}.`];
                    state.planCheckExpanded = true;
                    return null;
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
                    varietyId: selectedOption.varietyId == null ? null : (Number.isFinite(numericVarietyId) ? numericVarietyId : selectedOption.varietyId), variety: selectedOption.varietyName, harvestStart: "", harvestEnd: "", harvestWindowSource: "sowing_window_estimate", useActualHarvest: false, syncharvest: true, // CHANGE: new crops default to synced demand while sowing-window dates are requested.
                    shelfLifeDays: 0, baseKgPerPlant: baseYield, kgPerPlant: cropYield,
                    kgPerPlantMode: "auto", actualPlants: 0, germRate: 1,
                    packages: defaults && defaults.length ? PlanSchema.clonePlain(defaults) : [] // CHANGE: demand units are user-defined packages only.
                };
                crop.__harvestWindowSourceMissing = false; // CHANGE: new rows already default to the sowing-window source.
                return crop;
            } // CHANGE

            function addSelectedCropOptions(options) {
                const added = [];
                for (const selectedOption of (options || [])) {
                    const crop = createCropFromAddOption(selectedOption);
                    if (!crop) continue;
                    plan.crops.push(crop);
                    added.push(crop);
                }
                if (!added.length) { refreshDerived(); return; }
                setSelectedCropEverywhere(added[0].id);
                emitHarvestWindowsNeeded(added);
                pendingAddCropMessage = `Added ${added.length} crop${added.length === 1 ? "" : "s"}.`;
                renderAll();
            } // CHANGE

            function addCropOptionIdentityKey(option) { // CHANGE
                return PlanSchema.makeCropIdentityKey(option && option.plantId, option && option.varietyId || ""); // CHANGE
            } // CHANGE

            function collectAddCropLeaves(nodes) { // CHANGE
                const leaves = []; // CHANGE
                const visit = node => { // CHANGE
                    if (!node) return; // CHANGE
                    if (node.selectable && node.value) leaves.push(node); // CHANGE
                    for (const child of (node.children || [])) visit(child); // CHANGE
                }; // CHANGE
                for (const node of (nodes || [])) visit(node); // CHANGE
                return leaves; // CHANGE
            } // CHANGE

            function applyAddCropTransferChanges(addedOptions, removedCrops, previousSelectedId) { // CHANGE
                const removedIndexes = (removedCrops || []).map(crop => (plan.crops || []).indexOf(crop)).filter(index => index >= 0); // CHANGE
                for (const crop of (removedCrops || [])) removePlanCropAndLinkedRows(crop); // CHANGE
                const added = []; // CHANGE
                for (const selectedOption of (addedOptions || [])) { // CHANGE
                    const crop = createCropFromAddOption(selectedOption); // CHANGE
                    if (!crop) continue; // CHANGE
                    plan.crops.push(crop); // CHANGE
                    added.push(crop); // CHANGE
                } // CHANGE
                if (added.length) setSelectedCropEverywhere(added[0].id); // CHANGE
                else if (previousSelectedId && setSelectedCropEverywhere(previousSelectedId)) { // CHANGE
                    // Keep the current selection when it survived the transfer. // CHANGE
                } else { // CHANGE
                    const fallbackIndex = removedIndexes.length ? Math.min(...removedIndexes) : -1; // CHANGE
                    const nextCropId = YearPlanDashboard.resolveSelectedCropId(plan.crops, "", fallbackIndex); // CHANGE
                    if (nextCropId) setSelectedCropEverywhere(nextCropId); // CHANGE
                    else { state.selectedCropId = ""; plan.cropFilterId = ""; cropFilterSel.value = ""; } // CHANGE
                } // CHANGE
                if (added.length) emitHarvestWindowsNeeded(added); // CHANGE
                if (added.length || (removedCrops || []).length) pendingAddCropMessage = [`Added ${added.length}`, `removed ${(removedCrops || []).length}`].join(", ") + "."; // CHANGE
                saveCollapsePreferences(); // CHANGE
                renderAll(); // CHANGE
                refreshDerived(null, { rebuildSelfSufficiency: true, rebuildCsa: true, rebuildDemand: true }); // CHANGE
                loadAddCropOptions(false); // CHANGE
            } // CHANGE

            function openAddCropPicker() {
                const key = "add-crop"; // CHANGE
                const roots = Array.isArray(addCropPickerNodes) ? addCropPickerNodes : []; // CHANGE
                const leaves = collectAddCropLeaves(roots); // CHANGE
                const leafOrder = leaves.map(node => String(node.id)); // CHANGE
                const leafById = new Map(leaves.map(node => [String(node.id), node])); // CHANGE
                const expanded = pickerExpandedSet(key); // CHANGE
                const originalCrops = (plan.crops || []).slice(); // CHANGE
                const originalByCropId = new Map(originalCrops.map(crop => [String(crop && crop.id || ""), crop])); // CHANGE
                const addedLeafIds = new Set(); // CHANGE
                const removedCropIds = new Set(); // CHANGE
                const previousSelectedId = String(state.selectedCropId || ""); // CHANGE
                let query = ""; // CHANGE
                let discardWarned = false; // CHANGE
                let closed = false; // CHANGE

                const layer = document.createElement("div"); // CHANGE
                layer.className = "yp-picker-layer"; // CHANGE
                layer.dataset.yearPlanPicker = key; // CHANGE
                const dialog = document.createElement("div"); // CHANGE
                dialog.className = "yp-picker-dialog yp-package-transfer-dialog"; // CHANGE
                dialog.setAttribute("role", "dialog"); // CHANGE
                dialog.setAttribute("aria-modal", "true"); // CHANGE
                const head = document.createElement("div"); // CHANGE
                head.className = "yp-picker-head"; // CHANGE
                const title = document.createElement("div"); // CHANGE
                title.className = "yp-picker-title"; // CHANGE
                title.textContent = "Add crops"; // CHANGE
                const close = mkBtn("Close", "neutral"); // CHANGE
                head.appendChild(title); head.appendChild(close); // CHANGE
                const bodyEl = document.createElement("div"); // CHANGE
                bodyEl.className = "yp-picker-body"; // CHANGE
                const search = mkInput("search", "", 0); // CHANGE
                search.className = "yp-picker-search"; // CHANGE
                search.placeholder = "Search"; // CHANGE
                const summary = document.createElement("div"); // CHANGE
                summary.className = "yp-package-transfer-summary"; // CHANGE
                const panes = document.createElement("div"); // CHANGE
                panes.className = "yp-package-transfer-panes"; // CHANGE
                const availablePane = document.createElement("section"); // CHANGE
                availablePane.className = "yp-package-transfer-pane"; // CHANGE
                const includedPane = document.createElement("section"); // CHANGE
                includedPane.className = "yp-package-transfer-pane"; // CHANGE
                panes.appendChild(availablePane); panes.appendChild(includedPane); // CHANGE
                bodyEl.appendChild(search); bodyEl.appendChild(summary); bodyEl.appendChild(panes); // CHANGE
                const foot = document.createElement("div"); // CHANGE
                foot.className = "yp-picker-foot"; // CHANGE
                const status = document.createElement("div"); // CHANGE
                status.className = "yp-picker-status"; // CHANGE
                const warning = document.createElement("div"); // CHANGE
                warning.className = "yp-picker-warning"; // CHANGE
                const actions = document.createElement("div"); // CHANGE
                actions.className = "yp-row"; // CHANGE
                const cancel = mkBtn("Cancel", "neutral"); // CHANGE
                const apply = mkBtn("Apply changes", "add"); // CHANGE
                actions.appendChild(cancel); actions.appendChild(apply); // CHANGE
                foot.appendChild(status); foot.appendChild(warning); foot.appendChild(actions); // CHANGE
                dialog.appendChild(head); dialog.appendChild(bodyEl); dialog.appendChild(foot); // CHANGE
                layer.appendChild(dialog); // CHANGE
                card.appendChild(layer); // CHANGE

                function optionKeyForLeafId(id) { // CHANGE
                    const leaf = leafById.get(String(id)); // CHANGE
                    return addCropOptionIdentityKey(leaf && leaf.value); // CHANGE
                } // CHANGE

                function cropIdentityKey(crop) { // CHANGE
                    return PlanSchema.getCropIdentityKey(crop); // CHANGE
                } // CHANGE

                function activeIdentityKeys() { // CHANGE
                    const keys = new Set(); // CHANGE
                    for (const crop of originalCrops) if (!removedCropIds.has(String(crop && crop.id || ""))) keys.add(cropIdentityKey(crop)); // CHANGE
                    for (const id of addedLeafIds) keys.add(optionKeyForLeafId(id)); // CHANGE
                    return keys; // CHANGE
                } // CHANGE

                function removedIdentityKeys() { // CHANGE
                    const keys = new Set(); // CHANGE
                    for (const id of removedCropIds) keys.add(cropIdentityKey(originalByCropId.get(id))); // CHANGE
                    return keys; // CHANGE
                } // CHANGE

                function leafIsAvailable(node) { // CHANGE
                    if (!node || !node.selectable || node.disabled || !node.value) return false; // CHANGE
                    const keyValue = addCropOptionIdentityKey(node.value); // CHANGE
                    return !!keyValue && !activeIdentityKeys().has(keyValue) && !removedIdentityKeys().has(keyValue); // CHANGE
                } // CHANGE

                function cloneAvailableNode(node) { // CHANGE
                    if (!node) return null; // CHANGE
                    if (node.action) return { ...node, children: [] }; // CHANGE
                    if (node.selectable) return leafIsAvailable(node) ? { ...node, children: [] } : null; // CHANGE
                    const children = (node.children || []).map(cloneAvailableNode).filter(Boolean); // CHANGE
                    const copy = { ...node, children }; // CHANGE
                    if (copy.selects === "base" && (!copy.baseLeafId || !leafIsAvailable(leafById.get(String(copy.baseLeafId))))) { // CHANGE
                        copy.selects = null; // CHANGE
                        copy.baseLeafId = ""; // CHANGE
                    } // CHANGE
                    return children.length || copy.baseLeafId ? copy : null; // CHANGE
                } // CHANGE

                function filteredAvailableNode(node) { // CHANGE
                    if (!query) return node; // CHANGE
                    const needle = query.toLocaleLowerCase(); // CHANGE
                    if (pickerNodeText(node).indexOf(needle) < 0) return null; // CHANGE
                    if (String(node && node.label || "").toLocaleLowerCase().indexOf(needle) >= 0) return node; // CHANGE
                    const copy = { ...node }; // CHANGE
                    copy.children = (node.children || []).map(filteredAvailableNode).filter(Boolean); // CHANGE
                    return copy; // CHANGE
                } // CHANGE

                function availableRoots() { // CHANGE
                    return roots.map(cloneAvailableNode).filter(Boolean).map(filteredAvailableNode).filter(Boolean); // CHANGE
                } // CHANGE

                function availableLeafCount(nodes) { // CHANGE
                    return pickerFlattenLeaves(nodes).length; // CHANGE
                } // CHANGE

                function hasPendingChanges() { // CHANGE
                    return addedLeafIds.size + removedCropIds.size > 0; // CHANGE
                } // CHANGE

                function entryMatchesText(label, meta) { // CHANGE
                    if (!query) return true; // CHANGE
                    return `${label || ""} ${meta || ""}`.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) >= 0; // CHANGE
                } // CHANGE

                function scrollTransferListsToTop() { // CHANGE
                    for (const pane of [availablePane, includedPane]) { // CHANGE
                        const list = pane.querySelector(".yp-package-transfer-list"); // CHANGE
                        if (list) list.scrollTop = 0; // CHANGE
                    } // CHANGE
                } // CHANGE

                function renderAndScrollTransferListsToTop() { // CHANGE
                    render(); // CHANGE
                    scrollTransferListsToTop(); // CHANGE
                } // CHANGE

                function stageAddLeaf(leaf) { // CHANGE
                    if (!leaf || !leafIsAvailable(leaf)) return; // CHANGE
                    addedLeafIds.add(String(leaf.id)); // CHANGE
                    discardWarned = false; // CHANGE
                    renderAndScrollTransferListsToTop(); // CHANGE
                } // CHANGE

                function stageRemoveCrop(crop) { // CHANGE
                    const cropId = String(crop && crop.id || ""); // CHANGE
                    if (!cropId) return; // CHANGE
                    removedCropIds.add(cropId); // CHANGE
                    discardWarned = false; // CHANGE
                    renderAndScrollTransferListsToTop(); // CHANGE
                } // CHANGE

                function renderPaneShell(host, label, countText, actionLabel, action, actionDisabled) { // CHANGE
                    host.innerHTML = ""; // CHANGE
                    const headEl = document.createElement("div"); // CHANGE
                    headEl.className = "yp-package-transfer-pane-head"; // CHANGE
                    const titleEl = document.createElement("div"); // CHANGE
                    titleEl.textContent = `${label} ${countText}`; // CHANGE
                    const all = mkBtn(actionLabel, label === "Available" ? "add" : "danger"); // CHANGE
                    all.disabled = !!actionDisabled; // CHANGE
                    all.addEventListener("click", action); // CHANGE
                    headEl.appendChild(titleEl); headEl.appendChild(all); // CHANGE
                    const list = document.createElement("div"); // CHANGE
                    list.className = "yp-package-transfer-list"; // CHANGE
                    host.appendChild(headEl); host.appendChild(list); // CHANGE
                    return list; // CHANGE
                } // CHANGE

                function renderPendingRemovalRow(list, crop) { // CHANGE
                    const row = document.createElement("div"); // CHANGE
                    row.className = "yp-package-transfer-row"; // CHANGE
                    row.dataset.pending = "true"; // CHANGE
                    const labelEl = document.createElement("div"); // CHANGE
                    labelEl.className = "yp-package-transfer-label"; // CHANGE
                    labelEl.textContent = cropLabel(crop); // CHANGE
                    const controls = document.createElement("div"); // CHANGE
                    controls.className = "yp-row"; // CHANGE
                    const meta = document.createElement("span"); // CHANGE
                    meta.className = "yp-package-transfer-meta"; // CHANGE
                    meta.textContent = "Will remove"; // CHANGE
                    const undo = mkBtn("Add", "add"); // CHANGE
                    undo.addEventListener("click", () => { removedCropIds.delete(String(crop && crop.id || "")); discardWarned = false; renderAndScrollTransferListsToTop(); }); // CHANGE
                    controls.appendChild(meta); controls.appendChild(undo); // CHANGE
                    row.appendChild(labelEl); row.appendChild(controls); // CHANGE
                    list.appendChild(row); // CHANGE
                } // CHANGE

                function renderAvailableNode(node, depth, list) { // CHANGE
                    const hasChildren = !!((node.children || []).length); // CHANGE
                    const isExpanded = !!query || expanded.has(String(node && node.id || "")); // CHANGE
                    const baseLeaf = node.selects === "base" && node.baseLeafId ? leafById.get(String(node.baseLeafId)) : null; // CHANGE
                    const actionLeaf = node.selectable ? node : baseLeaf; // CHANGE
                    const row = document.createElement("div"); // CHANGE
                    row.className = "yp-picker-row"; // CHANGE
                    row.dataset.pickerNodeId = String(node.id || ""); // CHANGE
                    row.dataset.disabled = node.disabled ? "true" : "false"; // CHANGE
                    row.style.paddingLeft = `${5 + Math.max(0, depth) * 18}px`; // CHANGE
                    const toggle = hasChildren ? document.createElement("button") : document.createElement("span"); // CHANGE
                    toggle.className = hasChildren ? "yp-picker-toggle" : "yp-picker-spacer"; // CHANGE
                    if (hasChildren) { // CHANGE
                        toggle.type = "button"; // CHANGE
                        toggle.textContent = isExpanded ? "-" : "+"; // CHANGE
                        toggle.setAttribute("aria-label", isExpanded ? "Collapse" : "Expand"); // CHANGE
                        toggle.addEventListener("click", event => { event.stopPropagation(); if (isExpanded) expanded.delete(String(node.id || "")); else expanded.add(String(node.id || "")); savePickerExpandedSet(key, expanded); render(); }); // CHANGE
                    } // CHANGE
                    const spacer = document.createElement("span"); // CHANGE
                    spacer.className = "yp-picker-spacer"; // CHANGE
                    const label = document.createElement("div"); // CHANGE
                    label.className = "yp-picker-label"; // CHANGE
                    label.textContent = node.label || ""; // CHANGE
                    const controls = document.createElement("div"); // CHANGE
                    controls.className = "yp-row"; // CHANGE
                    if (node.action) { // CHANGE
                        const action = mkBtn("Open", "neutral"); // CHANGE
                        action.addEventListener("click", event => { event.stopPropagation(); closePicker(true); requestVarietyEditor(node.plantId, null, ""); }); // CHANGE
                        controls.appendChild(action); // CHANGE
                    } else if (actionLeaf && leafIsAvailable(actionLeaf)) { // CHANGE
                        const add = mkBtn("Add", "add"); // CHANGE
                        add.addEventListener("click", event => { event.stopPropagation(); stageAddLeaf(actionLeaf); }); // CHANGE
                        controls.appendChild(add); // CHANGE
                    } else { // CHANGE
                        const meta = document.createElement("div"); // CHANGE
                        meta.className = "yp-picker-meta"; // CHANGE
                        const count = availableLeafCount([node]); // CHANGE
                        meta.textContent = count ? String(count) : ""; // CHANGE
                        controls.appendChild(meta); // CHANGE
                    } // CHANGE
                    row.appendChild(toggle); row.appendChild(spacer); row.appendChild(label); row.appendChild(controls); // CHANGE
                    row.addEventListener("click", event => { // CHANGE
                        if (event.target === toggle || event.target.tagName === "BUTTON") return; // CHANGE
                        if (node.action) { closePicker(true); requestVarietyEditor(node.plantId, null, ""); return; } // CHANGE
                        if (actionLeaf && leafIsAvailable(actionLeaf)) stageAddLeaf(actionLeaf); // CHANGE
                        else if (hasChildren) { if (isExpanded) expanded.delete(String(node.id || "")); else expanded.add(String(node.id || "")); savePickerExpandedSet(key, expanded); render(); } // CHANGE
                    }); // CHANGE
                    list.appendChild(row); // CHANGE
                    if (hasChildren && isExpanded) for (const child of (node.children || [])) renderAvailableNode(child, depth + 1, list); // CHANGE
                } // CHANGE

                function renderAvailablePane() { // CHANGE
                    const nodes = availableRoots(); // CHANGE
                    const removed = Array.from(removedCropIds).map(id => originalByCropId.get(id)).filter(Boolean).filter(crop => entryMatchesText(cropLabel(crop), "Will remove")); // CHANGE
                    const count = availableLeafCount(nodes) + removed.length; // CHANGE
                    const list = renderPaneShell(availablePane, "Available", `${count} crop${count === 1 ? "" : "s"}`, "Add all visible", () => { // CHANGE
                        for (const crop of removed) removedCropIds.delete(String(crop && crop.id || "")); // CHANGE
                        for (const leaf of pickerFlattenLeaves(nodes)) addedLeafIds.add(String(leaf.id)); // CHANGE
                        discardWarned = false; renderAndScrollTransferListsToTop(); // CHANGE
                    }, !count); // CHANGE
                    for (const crop of removed) renderPendingRemovalRow(list, crop); // CHANGE
                    if (!nodes.length && !removed.length) { // CHANGE
                        const empty = document.createElement("div"); // CHANGE
                        empty.className = "yp-package-transfer-empty"; // CHANGE
                        empty.textContent = query ? "No available matches." : "No available crops."; // CHANGE
                        list.appendChild(empty); // CHANGE
                    } else { // CHANGE
                        for (const node of nodes) renderAvailableNode(node, 0, list); // CHANGE
                    } // CHANGE
                } // CHANGE

                function includedEntries() { // CHANGE
                    const entries = []; // CHANGE
                    for (const crop of originalCrops) { // CHANGE
                        const cropId = String(crop && crop.id || ""); // CHANGE
                        if (!removedCropIds.has(cropId)) entries.push({ id: cropId, label: cropLabel(crop), meta: "", crop, pendingAdd: false }); // CHANGE
                    } // CHANGE
                    for (const leafId of addedLeafIds) { // CHANGE
                        const leaf = leafById.get(String(leafId)); // CHANGE
                        if (leaf && leaf.value) entries.push({ id: String(leafId), label: leaf.value.label || leaf.label || "Crop", meta: "Will add", leaf, pendingAdd: true }); // CHANGE
                    } // CHANGE
                    return entries.filter(entry => entryMatchesText(entry.label, entry.meta)); // CHANGE
                } // CHANGE

                function renderIncludedPane() { // CHANGE
                    const entries = includedEntries(); // CHANGE
                    const list = renderPaneShell(includedPane, "Included", `${entries.length} crop${entries.length === 1 ? "" : "s"}`, "Remove all visible", () => { // CHANGE
                        for (const entry of entries) { // CHANGE
                            if (entry.pendingAdd) addedLeafIds.delete(entry.id); // CHANGE
                            else removedCropIds.add(entry.id); // CHANGE
                        } // CHANGE
                        discardWarned = false; renderAndScrollTransferListsToTop(); // CHANGE
                    }, !entries.length); // CHANGE
                    if (!entries.length) { // CHANGE
                        const empty = document.createElement("div"); // CHANGE
                        empty.className = "yp-package-transfer-empty"; // CHANGE
                        empty.textContent = query ? "No included matches." : "No included crops."; // CHANGE
                        list.appendChild(empty); // CHANGE
                        return; // CHANGE
                    } // CHANGE
                    for (const entry of entries) { // CHANGE
                        const row = document.createElement("div"); // CHANGE
                        row.className = "yp-package-transfer-row"; // CHANGE
                        row.dataset.pending = entry.pendingAdd ? "true" : "false"; // CHANGE
                        const labelEl = document.createElement("div"); // CHANGE
                        labelEl.className = "yp-package-transfer-label"; // CHANGE
                        labelEl.textContent = entry.label; // CHANGE
                        const controls = document.createElement("div"); // CHANGE
                        controls.className = "yp-row"; // CHANGE
                        if (entry.pendingAdd) { // CHANGE
                            const meta = document.createElement("span"); // CHANGE
                            meta.className = "yp-package-transfer-meta"; // CHANGE
                            meta.textContent = "Will add"; // CHANGE
                            controls.appendChild(meta); // CHANGE
                        } // CHANGE
                        const remove = mkBtn("Remove", "danger"); // CHANGE
                        remove.addEventListener("click", () => { if (entry.pendingAdd) { addedLeafIds.delete(entry.id); discardWarned = false; renderAndScrollTransferListsToTop(); } else stageRemoveCrop(entry.crop); }); // CHANGE
                        controls.appendChild(remove); // CHANGE
                        row.appendChild(labelEl); row.appendChild(controls); // CHANGE
                        list.appendChild(row); // CHANGE
                    } // CHANGE
                } // CHANGE

                function render() { // CHANGE
                    const availableCount = availableLeafCount(availableRoots()) + removedCropIds.size; // CHANGE
                    const includedCount = includedEntries().length; // CHANGE
                    summary.innerHTML = ""; // CHANGE
                    for (const text of [`Included ${includedCount}`, `Available ${availableCount}`, `Pending add ${addedLeafIds.size}`, `Pending remove ${removedCropIds.size}`]) { // CHANGE
                        const item = document.createElement("span"); // CHANGE
                        item.textContent = text; // CHANGE
                        summary.appendChild(item); // CHANGE
                    } // CHANGE
                    renderAvailablePane(); // CHANGE
                    renderIncludedPane(); // CHANGE
                    status.textContent = hasPendingChanges() ? `Add ${addedLeafIds.size}, remove ${removedCropIds.size}` : "No pending changes"; // CHANGE
                    warning.textContent = ""; // CHANGE
                    apply.disabled = !hasPendingChanges(); // CHANGE
                } // CHANGE

                function closePicker(force) { // CHANGE
                    if (closed) return; // CHANGE
                    if (!force && hasPendingChanges() && !discardWarned) { // CHANGE
                        discardWarned = true; // CHANGE
                        warning.textContent = "Pending changes will be lost. Close again to discard."; // CHANGE
                        return; // CHANGE
                    } // CHANGE
                    closed = true; // CHANGE
                    window.removeEventListener("keydown", onKeyDown, true); // CHANGE
                    if (layer.parentNode) layer.parentNode.removeChild(layer); // CHANGE
                } // CHANGE

                function onKeyDown(event) { // CHANGE
                    if (event.key === "Escape") { // CHANGE
                        event.preventDefault(); // CHANGE
                        event.stopPropagation(); // CHANGE
                        closePicker(false); // CHANGE
                    } // CHANGE
                } // CHANGE

                search.addEventListener("input", () => { query = search.value.trim(); render(); }); // CHANGE
                apply.addEventListener("click", () => { // CHANGE
                    if (!hasPendingChanges()) return; // CHANGE
                    if (removedCropIds.size && !confirm(`Remove ${removedCropIds.size} crop${removedCropIds.size === 1 ? "" : "s"} from this year plan? Linked demand, self-use, and CSA rows for removed crops will also be deleted.`)) { // CHANGE
                        warning.textContent = "Changes not applied."; // CHANGE
                        return; // CHANGE
                    } // CHANGE
                    const addedOptions = leafOrder.filter(id => addedLeafIds.has(id)).map(id => leafById.get(id)).filter(Boolean).map(node => node.value); // CHANGE
                    const removedCrops = Array.from(removedCropIds).map(id => originalByCropId.get(id)).filter(Boolean); // CHANGE
                    closePicker(true); // CHANGE
                    applyAddCropTransferChanges(addedOptions, removedCrops, previousSelectedId); // CHANGE
                }); // CHANGE
                cancel.addEventListener("click", () => closePicker(false)); // CHANGE
                close.addEventListener("click", () => closePicker(false)); // CHANGE
                layer.addEventListener("click", event => { if (event.target === layer) closePicker(false); }); // CHANGE
                window.addEventListener("keydown", onKeyDown, true); // CHANGE
                render(); // CHANGE
                setTimeout(() => search.focus(), 0); // CHANGE
            } // CHANGE

            addCropsButton.addEventListener("click", openAddCropPicker); // CHANGE
            reloadPlants.addEventListener("click", () => loadAddCropOptions(true));

            yearInput.addEventListener("change", () => {
                const nextYear = Number(yearInput.value);
                if (!Number.isFinite(nextYear) || nextYear < 1900 || nextYear > 3000) { yearInput.value = String(currentYear); return; }
                if (nextYear === currentYear) return;
                saveDraftIfDirty(); // CHANGE: year changes preserve unfinished work without blocking.
                const nextWorkingYear = loadWorkingYear(nextYear); // CHANGE
                replacePlan(nextWorkingYear.plan, nextYear, nextWorkingYear.loadedCommitted, nextWorkingYear.loadedDraft, nextWorkingYear.draftUpdatedAt); // CHANGE
                renderAll();
                YearPlanDashboard.markBaseline(state, plan, null);
                refreshDerived();
            });
            applyTemplate.addEventListener("click", () => {
                const name = String(templateSel.value || "");
                const template = name && PlanRepository.loadTemplateByName(name);
                if (!template) return;
                replacePlan(PlanRepository.rekeyTemplateToPlan(template, currentYear), currentYear, loadedExistingForCurrentYear, loadedDraftForCurrentYear, state.lastDraftSavedAt && state.lastDraftSavedAt.toISOString ? state.lastDraftSavedAt.toISOString() : ""); // CHANGE
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
            cropSearchInput.addEventListener("input", () => { renderCropList(); }); // CHANGE
            planCheckScopeSel.addEventListener("change", () => {
                state.planCheckScope = String(planCheckScopeSel.value || "combined"); // NEW
                renderPlanCheck(); // NEW
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
                const suffix = loadedDraftForCurrentYear || !isCommitReady() ? "draft_plan" : "plan"; // CHANGE
                downloadJson(`${safeName}_${currentYear}_${suffix}.json`, PlanSchema.serializeForPersistence(plan)); // CHANGE
            });
            reset.addEventListener("click", () => {
                if (loadedDraftForCurrentYear) {
                    if (!confirm(`Discard the saved draft for ${currentYear}?`)) return;
                    PlanRepository.deleteDraftForYear(moduleCell, currentYear); // CHANGE
                    const nextWorkingYear = loadWorkingYear(currentYear); // CHANGE
                    replacePlan(nextWorkingYear.plan, currentYear, nextWorkingYear.loadedCommitted, nextWorkingYear.loadedDraft, nextWorkingYear.draftUpdatedAt); // CHANGE
                } else {
                    if (!confirm(`Clear the saved ${currentYear} plan?`)) return;
                    PlanRepository.deletePlanForYear(moduleCell, currentYear);
                    PlanRepository.deleteDraftForYear(moduleCell, currentYear); // CHANGE
                    replacePlan(PlanSchema.createEmptyPlan(currentYear), currentYear, false, false, ""); // CHANGE
                }
                state.saveValidationErrors = []; // CHANGE: Reset/Clear deletes stored state instead of saving an empty committed plan.
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

            function applyVarietyEditorResult(detail) { // CHANGE
                const cropId = String(detail && detail.cropId || ""); // CHANGE
                const crop = (plan.crops || []).find(item => String(item.id) === cropId) || null; // CHANGE
                const plantId = String((crop && crop.plantId) || (detail && (detail.plantId || detail.plant_id)) || ""); // CHANGE
                if (plantId) varietyCache.delete(plantId); // CHANGE
                const action = String(detail && detail.action || ""); // CHANGE
                const varietyId = detail && (detail.varietyId ?? detail.variety_id); // CHANGE
                if (crop && action !== "cancel" && action !== "error" && varietyId !== null && varietyId !== undefined && varietyId !== "") { // CHANGE
                    if (!PlanSchema.findDuplicateCrop(plan, crop.plantId, varietyId, crop.id)) { // CHANGE
                        const numericVarietyId = Number(varietyId); // CHANGE
                        crop.varietyId = Number.isFinite(numericVarietyId) ? numericVarietyId : varietyId; crop.variety = String(detail.varietyName || detail.variety_name || ""); // CHANGE
                    } // CHANGE
                } // CHANGE
                if (crop && selectedCrop() === crop) renderSelectedEditor(); // CHANGE
                refreshDerived(); // CHANGE
                loadAddCropOptions(false); // CHANGE
            } // CHANGE

            SessionController.addGraphListener(session, graph, "usl:varietyEditorClosed", (sender, event) => { // CHANGE
                applyVarietyEditorResult({ // CHANGE
                    cropId: event.getProperty("cropId"), // CHANGE
                    plantId: event.getProperty("plantId"), // CHANGE
                    action: event.getProperty("action"), // CHANGE
                    varietyId: event.getProperty("varietyId"), // CHANGE
                    varietyName: event.getProperty("varietyName") // CHANGE
                }); // CHANGE
            }); // CHANGE

            SessionController.addWindowListener(session, "usl:varietyEditorSaved", event => { // CHANGE
                applyVarietyEditorResult(event && event.detail || {}); // CHANGE
            }); // CHANGE

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
            NutritionPlanner,
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
