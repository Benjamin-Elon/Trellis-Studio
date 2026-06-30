// USL Draw.io Plugin: Garden Scheduler dialog and runtime facade. // CHANGED
//
// - Schedule entry is rendered by Vertex_Linking_Standalone.js
// - Fetches plant/city from SQLite via window.dbBridge
// - Computes schedule, plants, timelines, and writes attrs
//
// Key changes in this version:
//  * Dialog facade uses shared scheduler core classes for schedule inputs and planning. // CHANGED
//  * Overwinter-aware feasibility & scanning
//  * Yield multipliers computed over HARVEST window
//  * UI keeps the same behavior (manual/auto dates, minimum yield filter, preview)
//  * Loads shared, annual, and perennial scheduler cores before runtime installation. // ADDED
//
// ---------------------------------------------------------------------------------------------

(function installGardenSchedulerCoreLoader(root) { // ADDED
    if (!root) return; // ADDED
    root.USL = root.USL || {}; // ADDED
    root.USL.scheduler = root.USL.scheduler || {}; // ADDED

    const CORE_FILES = [ // ADDED
        'Garden_Scheduler_Shared_Core.js', // ADDED
        'Garden_Scheduler_Annual_Core.js', // ADDED
        'Garden_Scheduler_Perennial_Core.js' // ADDED
    ]; // ADDED

    function coreBasePath() { // ADDED
        try { // ADDED
            const src = root.document && root.document.currentScript && root.document.currentScript.src; // ADDED
            if (src) return src.replace(/Garden_Scheduler_Dialog\.js(?:[?#].*)?$/, ''); // ADDED
        } catch (_) { } // ADDED
        return 'plugins/garden_planner_plugins/'; // ADDED
    } // ADDED

    function validateCores() { // ADDED
        const scheduler = root.USL && root.USL.scheduler; // ADDED
        const shared = scheduler && scheduler.sharedCore; // ADDED
        const annual = scheduler && scheduler.annualCore; // ADDED
        const perennial = scheduler && scheduler.perennialCore; // ADDED
        if (!shared || typeof shared.ScheduleInputs !== 'function' || typeof shared.resolveHarvestWindowDays !== 'function') { // ADDED
            throw new Error('Garden scheduler shared core did not expose the expected API.'); // ADDED
        } // ADDED
        if (!annual || typeof annual.Planner !== 'function' || typeof annual.computeAnnualScheduleResult !== 'function') { // ADDED
            throw new Error('Garden scheduler annual core did not expose the expected API.'); // ADDED
        } // ADDED
        if (!perennial || typeof perennial.computePerennialScheduleResult !== 'function') { // ADDED
            throw new Error('Garden scheduler perennial core did not expose the expected API.'); // ADDED
        } // ADDED
        return { shared, annual, perennial }; // ADDED
    } // ADDED

    const loader = root.USL.scheduler.__coreLoader || { // ADDED
        ready: false, // ADDED
        error: null, // ADDED
        callbacks: [] // ADDED
    }; // ADDED

    function finish(error) { // ADDED
        loader.error = error || null; // ADDED
        loader.ready = !error; // ADDED
        const callbacks = loader.callbacks.splice(0); // ADDED
        callbacks.forEach(function (callback) { // ADDED
            try { callback(loader.error); } catch (e) { console.error('[Garden Scheduler] core-loader callback failed', e); } // ADDED
        }); // ADDED
    } // ADDED

    loader.whenReady = function (callback) { // ADDED
        if (loader.ready || loader.error) { // ADDED
            callback(loader.error); // ADDED
            return; // ADDED
        } // ADDED
        loader.callbacks.push(callback); // ADDED
    }; // ADDED
    loader.validate = validateCores; // ADDED

    function loadNext(index, basePath) { // ADDED
        if (index >= CORE_FILES.length) { // ADDED
            try { validateCores(); finish(null); } catch (e) { finish(e); } // ADDED
            return; // ADDED
        } // ADDED
        const fileName = CORE_FILES[index]; // ADDED
        if (typeof root.mxscript !== 'function') { // ADDED
            finish(new Error('mxscript is unavailable; cannot load ' + fileName + '.')); // ADDED
            return; // ADDED
        } // ADDED
        root.mxscript(basePath + fileName, function () { // ADDED
            loadNext(index + 1, basePath); // ADDED
        }, null, null, null, function (message, error) { // ADDED
            finish(error || new Error(message || ('Failed to load ' + fileName + '.'))); // ADDED
        }); // ADDED
    } // ADDED

    root.USL.scheduler.__coreLoader = loader; // ADDED
    try { // ADDED
        validateCores(); // ADDED
        finish(null); // ADDED
    } catch (_) { // ADDED
        loadNext(0, coreBasePath()); // ADDED
    } // ADDED
})(typeof window !== 'undefined' ? window : globalThis); // ADDED

Draw.loadPlugin(function (ui) {
    const graph = ui.editor && ui.editor.graph;
    if (!graph) return;

    console.log("[Scheduler] file instance:", "Garden_Scheduler_Dialog.js", "STAMP=2026-06-24-split"); // CHANGED

    // -------------------- Logging ---------------------------------------------------------
    function log() { try { mxLog.debug.apply(mxLog, ["[USL-Schedule]"].concat([].slice.call(arguments))); } catch (_) {/*noop*/ } }

    // -------------------- Small utils (dates, math) --------------------------------------
    function daysInMonth(year, month) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }
    function addDaysUTC(d, days) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days)); }
    function asUTCDate(y, m, d) { return new Date(Date.UTC(y, m - 1, d)); }
    function dateLTE(d1, d2) {
        return d1.getUTCFullYear() < d2.getUTCFullYear() ||
            (d1.getUTCFullYear() === d2.getUTCFullYear() && (
                d1.getUTCMonth() < d2.getUTCMonth() ||
                (d1.getUTCMonth() === d2.getUTCMonth() && d1.getUTCDate() <= d2.getUTCDate())
            ));
    }
    function fmtISO(d) { return d ? d.toISOString().slice(0, 10) : ''; }
    function iso(d) { return d ? d.toISOString().slice(0, 10) : null; }
    function shiftDays(isoStr, days) {
        if (!isoStr) return null;
        const d = new Date(isoStr + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + days);
        return iso(d);
    }

    function dayOfYear(d) {
        const start = Date.UTC(d.getUTCFullYear(), 0, 1);
        const ms = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - start;
        return Math.floor(ms / 86400000) + 1;
    }
    function finiteNumberOrNull(value) {
        if (value === null || value === undefined || value === '') return null;
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }
    function normalizeLatitudeDeg(value) { // ADDED
        const n = finiteNumberOrNull(value); // ADDED
        if (n == null) return null; // ADDED
        if (n < -66.5 || n > 66.5) throw new Error('City latitude must be between -66.5 and 66.5 decimal degrees.'); // CHANGED
        return n; // ADDED
    }
    let sharedCore = null; // CHANGED
    let annualCore = null; // CHANGED
    let perennialCore = null; // CHANGED
    function bindRequiredSchedulerCores() { // CHANGED
        const scheduler = typeof window !== 'undefined' && window.USL && window.USL.scheduler
            ? window.USL.scheduler
            : null;
        sharedCore = scheduler && scheduler.sharedCore;
        annualCore = scheduler && scheduler.annualCore;
        perennialCore = scheduler && scheduler.perennialCore;
        if (!sharedCore || !annualCore || !perennialCore) {
            throw new Error('Garden scheduler requires shared, annual, and perennial core modules.');
        }
        return { sharedCore, annualCore, perennialCore };
    }
    function monthlyMeanOnDate(date, monthlyAvgTemp) {
        const year = date.getUTCFullYear();
        const month = date.getUTCMonth() + 1;
        const curMean = finiteNumberOrNull(monthlyAvgTemp?.[month]);
        if (curMean == null) return null;
        const curCenter = Date.UTC(year, month - 1, 15);
        const nextMonth = month === 12 ? 1 : month + 1;
        const prevMonth = month === 1 ? 12 : month - 1;
        const nextYear = month === 12 ? year + 1 : year;
        const prevYear = month === 1 ? year - 1 : year;
        const nextMean = finiteNumberOrNull(monthlyAvgTemp?.[nextMonth]);
        const prevMean = finiteNumberOrNull(monthlyAvgTemp?.[prevMonth]);
        const target = Date.UTC(year, month - 1, date.getUTCDate());
        if (target >= curCenter && nextMean != null) {
            const nextCenter = Date.UTC(nextYear, nextMonth - 1, 15);
            const ratio = (target - curCenter) / Math.max(1, nextCenter - curCenter);
            return curMean + (nextMean - curMean) * Math.max(0, Math.min(1, ratio));
        }
        if (target < curCenter && prevMean != null) {
            const prevCenter = Date.UTC(prevYear, prevMonth - 1, 15);
            const ratio = (target - prevCenter) / Math.max(1, curCenter - prevCenter);
            return prevMean + (curMean - prevMean) * Math.max(0, Math.min(1, ratio));
        }
        return curMean;
    }
    function normalizeBedProfile(profile) {
        const source = profile && typeof profile === 'object' ? profile : {};
        const pick = (key, fallback) => String(source[key] || fallback || 'unknown').trim() || 'unknown';
        return {
            sunExposure: pick('sunExposure', 'full_sun'),
            soilMoisture: pick('soilMoisture', 'moderate'),
            drainage: pick('drainage', 'normal'),
            soilTexture: pick('soilTexture', 'loamy'),
            windExposure: pick('windExposure', 'moderate'),
            frostRisk: pick('frostRisk', 'low')
        };
    }
    function bedSoilTemperatureOffsetC(profile) {
        const bed = normalizeBedProfile(profile);
        let offset = 3.0; // ADDED: generic open vegetable beds warm faster than monthly city-air means.
        const add = (value) => { offset += value; };
        if (bed.sunExposure === 'full_sun') add(0.4);
        else if (bed.sunExposure === 'part_sun') add(0.1);
        else if (bed.sunExposure === 'part_shade') add(-0.9);
        else if (bed.sunExposure === 'shade') add(-1.8);
        if (bed.soilMoisture === 'dry') add(0.4);
        else if (bed.soilMoisture === 'moist') add(-0.5);
        else if (bed.soilMoisture === 'wet') add(-1.0);
        if (bed.drainage === 'fast') add(0.3);
        else if (bed.drainage === 'slow') add(-0.6);
        if (bed.soilTexture === 'sandy' || bed.soilTexture === 'amended') add(0.4);
        else if (bed.soilTexture === 'clay') add(-0.5);
        if (bed.windExposure === 'sheltered') add(0.2);
        else if (bed.windExposure === 'exposed') add(-0.5);
        if (bed.frostRisk === 'none') add(0.2);
        else if (bed.frostRisk === 'medium') add(-0.3);
        else if (bed.frostRisk === 'high') add(-0.7);
        return Math.max(-1.5, Math.min(5.0, offset));
    }
    function estimateSoilTempC(date, monthlyAvgTemp, bedProfile = null) {
        const air = sharedCore.meanTemperatureOnDate(date, monthlyAvgTemp); // CHANGED
        if (air == null) return null;
        return air + bedSoilTemperatureOffsetC(bedProfile); // ADDED: bed-aware soil estimate replaces fixed lagged-air heuristic.
    }
    function firstSoilReadyDate({ thresholdC, monthlyAvgTemp, scanStart, scanEndHard, bedProfile = null, consecutiveDays = 3 }) {
        const threshold = finiteNumberOrNull(thresholdC);
        if (threshold == null) return null;
        const days = Math.max(1, Math.round(Number(consecutiveDays) || 1));
        for (let d = new Date(scanStart); d <= scanEndHard; d = addDaysUTC(d, 1)) {
            let ok = true;
            for (let i = 0; i < days; i++) {
                const sample = addDaysUTC(d, i);
                if (sample > scanEndHard) { ok = false; break; }
                const soil = estimateSoilTempC(sample, monthlyAvgTemp, bedProfile);
                if (soil == null || soil < threshold) { ok = false; break; }
            }
            if (ok) return d;
        }
        return null;
    }
    function annualGddFromMonthlyMeans(monthlyAvgTemp, tbase, year, tempOffsetC = 0) {
        const base = Number(tbase);
        if (!Number.isFinite(base)) return null;
        let total = 0;
        for (let m = 1; m <= 12; m++) {
            const mean = finiteNumberOrNull(monthlyAvgTemp?.[m]);
            if (mean == null) continue;
            total += Math.max(0, mean + Number(tempOffsetC || 0) - base) * daysInMonth(year, m);
        }
        return total;
    }
    function solveGddTemperatureOffset({ monthlyAvgTemp, targetGdd, gddBaseC, year }) {
        const target = finiteNumberOrNull(targetGdd);
        const base = finiteNumberOrNull(gddBaseC);
        if (target == null || target <= 0 || base == null) {
            return { usable: false, offsetC: 0, targetGdd: target, gddBaseC: base, uncalibratedGdd: null, calibratedGdd: null };
        }
        const uncalibrated = annualGddFromMonthlyMeans(monthlyAvgTemp, base, year, 0);
        if (uncalibrated == null) {
            return { usable: false, offsetC: 0, targetGdd: target, gddBaseC: base, uncalibratedGdd: null, calibratedGdd: null };
        }
        let lo = -15;
        let hi = 15;
        for (let i = 0; i < 50; i++) {
            const mid = (lo + hi) / 2;
            const gdd = annualGddFromMonthlyMeans(monthlyAvgTemp, base, year, mid);
            if (gdd < target) lo = mid;
            else hi = mid;
        }
        const offset = (lo + hi) / 2;
        return {
            usable: true,
            offsetC: offset,
            targetGdd: target,
            gddBaseC: base,
            uncalibratedGdd: uncalibrated,
            calibratedGdd: annualGddFromMonthlyMeans(monthlyAvgTemp, base, year, offset)
        };
    }
    function applyTemperatureOffsetToMonthlyMeans(monthlyAvgTemp, offsetC = 0) {
        const out = {};
        for (let m = 1; m <= 12; m++) {
            const mean = finiteNumberOrNull(monthlyAvgTemp?.[m]);
            if (mean != null) out[m] = mean + Number(offsetC || 0);
        }
        return out;
    }

    function normId(value) { // FIX: canonicalize method and category identifiers at every boundary
        return String(value ?? '').trim().toLowerCase();
    }

    const ORPHAN_SOWING_SEASON_ID = '__saved_date_outside_seasons'; // ADDED

    function isOrphanSowingSeasonId(value) { // ADDED
        return String(value || '') === ORPHAN_SOWING_SEASON_ID; // ADDED
    }

    function defaultStartForActiveSowingSeason(activeWindow, todayISO = '') { // ADDED
        if (!activeWindow) return ''; // ADDED
        return sowDateInWindow(todayISO, activeWindow) ? String(todayISO) : String(activeWindow.startISO || ''); // ADDED
    }

    function resolveStartAfterWindow({
        currentStartISO,
        activeWindow,
        feasible,
        forceWriteStart,
        hasPersistedSchedule,
        userEditedStartThisSession,
        todayISO = ''
    }) { // CHANGED: active sowing seasons own generated defaults
        const preserveGenuineStart = !!hasPersistedSchedule || !!userEditedStartThisSession; // CHANGED
        if (feasible && (forceWriteStart || !preserveGenuineStart)) return defaultStartForActiveSowingSeason(activeWindow, todayISO); // CHANGED
        if (!feasible && !preserveGenuineStart) return ''; // CHANGED
        return String(currentStartISO || ''); // CHANGED
    }

    function isPerennialPlant(plant) { // FIX: keep lifespan-only schedules out of maturity-budget code paths
        return !!(plant && typeof plant.isPerennial === 'function' && plant.isPerennial());
    }

    function requirePerennialLifespanYears(plant) { // FIX: validate the sole required duration for perennial schedules
        const lifespanYears = finiteNumberOrNull(plant?.lifespan_years);
        if (lifespanYears == null || lifespanYears < 1) {
            throw new Error(`Perennial "${plant?.plant_name || 'plant'}" requires lifespan_years >= 1.`);
        }
        return Math.floor(lifespanYears);
    }

    function computePerennialLifespanEndISO(fromISO, seasonStartYear, lifespanYears) { // FIX: centralize lifespan-based schedule ends
        const start = parseISODateUTCValue(fromISO) || asUTCDate(Number(seasonStartYear), 1, 1);
        const years = Math.max(1, Math.floor(Number(lifespanYears) || 0));
        return asUTCDate(start.getUTCFullYear() + years, 12, 31).toISOString().slice(0, 10);
    }

    async function runUiAsyncOperation(label, fn, onError) { // FIX: testable async UI error boundary
        try {
            return await fn();
        } catch (e) {
            if (typeof onError === 'function') onError(`${label}: ${e?.message || String(e)}`, e);
            return null;
        }
    }

    const DEFAULT_HARVEST_WINDOW_DAYS = 7; // FIX: use one fallback across every scheduling entry point
    const HARVEST_END_SEMANTICS = 'exclusive'; // FIX: harvestEnd is the first instant outside the harvest window

    // Resolves user, plant, and fallback values while preserving an explicit zero-day window.
    function resolveHarvestWindowDays(explicitValue, plant = null) { // FIX: centralize harvest-window normalization
        const explicitDays = finiteNumberOrNull(explicitValue);
        if (explicitDays != null && explicitDays >= 0) return Math.round(explicitDays); // FIX: return whole calendar days

        const plantDays = finiteNumberOrNull(plant?.harvest_window_days);
        if (plantDays != null && plantDays >= 0) return Math.round(plantDays); // FIX: normalize stored defaults too

        return Math.round(Math.max(0, DEFAULT_HARVEST_WINDOW_DAYS)); // FIX: guarantee a non-negative integer fallback
    }
    function parseISODateUTCValue(value) {
        const s = String(value ?? '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
        const d = new Date(s + 'T00:00:00Z');
        return Number.isNaN(d.getTime()) ? null : d;
    }
    function isUsableDate(value) { // ADDED
        return value instanceof Date && !Number.isNaN(value.getTime()); // ADDED
    } // ADDED
    function pickFrostByRisk(city, risk = 'p50') {
        // fallbacks: specific percentile → pX → plain
        const p90 = finiteNumberOrNull(city?.last_spring_frost_p90_doy);
        const p50 = finiteNumberOrNull(city?.last_spring_frost_p50_doy);
        const p10 = finiteNumberOrNull(city?.last_spring_frost_p10_doy);
        const plain = finiteNumberOrNull(city?.last_spring_frost_doy);
        if (risk === 'p90' && p90 != null) return p90;
        if (risk === 'p50' && p50 != null) return p50;
        if (risk === 'p10' && p10 != null) return p10;
        if (plain != null) return plain;
        // worst-case: mid-April DOY=105 (safe-ish default for many temperate zones)
        return 105;
    }

    let __dbPathCached = null;

    async function getDbPath() {
        if (__dbPathCached) {
            return __dbPathCached;
        }

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

    // -------------------- DB helpers (open → exec/run → close) ------------------------------

    async function queryAllOnDb(dbId, sql, params = []) {
        if (!window.dbBridge || typeof window.dbBridge.query !== 'function') {
            throw new Error('dbBridge.query not available');
        }
        const res = await window.dbBridge.query(dbId, sql, params || []);
        return Array.isArray(res?.rows) ? res.rows : [];
    }

    async function execRunOnDb(dbId, sql, params = []) {
        try {
            if (typeof window.dbBridge.exec === "function") {
                return await window.dbBridge.exec(dbId, sql, params || []);
            }
            if (typeof window.dbBridge.run === "function") {
                return await window.dbBridge.run(dbId, sql, params || []);
            }
            throw new Error("dbBridge.exec/run not available");
        } catch (e) {
            console.error("[DB RUN FAIL]", { dbId, sql, params, message: e?.message || String(e) }); // <-- PLACE HERE
            throw e;
        }
    }

    async function withDbWrite(fn) {
        const dbPath = await getDbPath();
        const opened = await window.dbBridge.open(dbPath, { readOnly: false });
        try {
            return await fn(opened.dbId);
        } finally {
            try { await window.dbBridge.close(opened.dbId); } catch (_) { }
        }
    }

    async function withDbTransaction(fn) { // FIX: keep related database writes atomic
        return await withDbWrite(async (dbId) => { // FIX: use one connection for the full transaction
            await execRunOnDb(dbId, "BEGIN;"); // FIX: begin before any related record changes
            try {
                const result = await fn(dbId); // FIX: run all writes inside the transaction
                await execRunOnDb(dbId, "COMMIT;"); // FIX: publish only after every write succeeds
                return result;
            } catch (e) {
                try { await execRunOnDb(dbId, "ROLLBACK;"); } catch (_) { } // FIX: discard partial writes
                throw e;
            }
        });
    }

    async function queryAll(sql, params) {
        if (!window.dbBridge || typeof window.dbBridge.open !== 'function') {
            throw new Error('dbBridge not available; check preload/main wiring');
        }
        const dbPath = await getDbPath();
        const opened = await window.dbBridge.open(dbPath, { readOnly: true });
        try {
            const res = await window.dbBridge.query(opened.dbId, sql, params);
            return Array.isArray(res?.rows) ? res.rows : [];
        } finally {
            try { await window.dbBridge.close(opened.dbId); } catch (_) { }
        }
    }

    async function execAll(sql, params) {
        if (!window.dbBridge || typeof window.dbBridge.open !== 'function') {
            throw new Error('dbBridge not available; check preload/main wiring');
        }

        const dbPath = await getDbPath();
        const opened = await window.dbBridge.open(dbPath, { readOnly: false });

        try {
            if (typeof window.dbBridge.exec === 'function') {
                await window.dbBridge.exec(opened.dbId, sql, params || []);
            } else if (typeof window.dbBridge.run === 'function') {
                await window.dbBridge.run(opened.dbId, sql, params || []);
            } else {
                throw new Error('dbBridge.exec/run not available');
            }
        } finally {
            try { await window.dbBridge.close(opened.dbId); } catch (_) { }
        }
    }

    const PHYSIOLOGY_PLANT_COLUMNS = Object.freeze({ // ADDED
        establishment_temp_max_c: 'REAL', // ADDED
        establishment_heat_window_days: 'INTEGER', // ADDED
        establishment_heat_policy: 'TEXT', // ADDED
        quality_temp_max_c: 'REAL', // ADDED
        heat_stress_stage: 'TEXT', // ADDED
        quality_heat_policy: 'TEXT', // ADDED
        photoperiod_response: 'TEXT', // ADDED
        critical_daylength_hours: 'REAL', // ADDED
        photoperiod_stage: 'TEXT', // ADDED
        photoperiod_policy: 'TEXT', // ADDED
        chilling_required_days: 'REAL', // ADDED
        chilling_required_hours: 'REAL', // ADDED
        chilling_temp_min_c: 'REAL', // ADDED
        chilling_temp_max_c: 'REAL', // ADDED
        chilling_stage: 'TEXT', // ADDED
        chilling_policy: 'TEXT', // ADDED
        diagnostic_policy: 'TEXT' // ADDED
    }); // ADDED
    const PHYSIOLOGY_CITY_COLUMNS = Object.freeze({ // CHANGED: scheduler owns lightweight city geography columns for grouped city selection.
        country_name: 'TEXT', // ADDED
        country_code: 'TEXT', // ADDED
        region_name: 'TEXT', // ADDED
        region_code: 'TEXT' // ADDED
    }); // CHANGED
    let schedulerPhysiologySchemaEnsured = false; // ADDED

    async function ensureTableColumns(dbId, tableName, columns) { // ADDED
        const existing = new Set((await queryAllOnDb(dbId, `PRAGMA table_info(${tableName});`, [])).map(row => String(row.name || '').toLowerCase())); // ADDED
        for (const [column, type] of Object.entries(columns)) { // ADDED
            if (existing.has(column.toLowerCase())) continue; // ADDED
            await execRunOnDb(dbId, `ALTER TABLE ${tableName} ADD COLUMN ${column} ${type};`, []); // ADDED
        } // ADDED
    }

    async function ensureSchedulerPhysiologySchema() { // ADDED
        if (schedulerPhysiologySchemaEnsured) return; // ADDED
        await withDbWrite(async dbId => { // ADDED
            await ensureTableColumns(dbId, 'Plants', PHYSIOLOGY_PLANT_COLUMNS); // ADDED
            await ensureTableColumns(dbId, 'Cities', PHYSIOLOGY_CITY_COLUMNS); // ADDED
        }); // ADDED
        schedulerPhysiologySchemaEnsured = true; // ADDED
    }


    // -------------------- Models ----------------------------------------------------------
    class PlantModel {
        constructor(row) {
            Object.assign(this, row);
            this.annual = Number(this.annual ?? 0);
            this.biennial = Number(this.biennial ?? 0);
            this.perennial = Number(this.perennial ?? 0);
            this.lifespan_years = Number(this.lifespan_years ?? NaN); // may be null/NaN
            this.overwinter_ok = Number(this.overwinter_ok ?? 0);
        }
        isAnnual() { return this.annual === 1; }
        isBiennial() { return this.biennial === 1; }
        isPerennial() { return this.perennial === 1; }

        // In PlantModel constructor (no change needed; Object.assign handles it)
        // Optional helpers:
        startCoolingThresholdC() {
            return coolingGateThresholdC(this); // FIX: annual heat thresholds are not fall gates
        }
        hasCoolingTrigger() {
            return coolingGateThresholdC(this) != null; // FIX
        }


        static async loadByName(name) {
            await ensureSchedulerPhysiologySchema(); // ADDED
            const sql = `
          SELECT *,
                 COALESCE(direct_sow,0) AS direct_sow,
                 COALESCE(transplant,0) AS transplant,
                 COALESCE(overwinter_ok,0) AS overwinter_ok
          FROM Plants
          WHERE plant_name = ?
          LIMIT 1;`;
            const rows = await queryAll(sql, [name]);
            return rows[0] ? new PlantModel(rows[0]) : null;
        }

        static async loadById(id) {
            await ensureSchedulerPhysiologySchema(); // ADDED
            const sql = `
          SELECT *,
                 COALESCE(direct_sow,0) AS direct_sow,
                 COALESCE(transplant,0) AS transplant,
                 COALESCE(overwinter_ok,0) AS overwinter_ok
          FROM Plants
          WHERE plant_id = ?;`;
            const rows = await queryAll(sql, [id]);
            return rows[0] ? new PlantModel(rows[0]) : null;
        }

        static async listBasic() {
            await ensureSchedulerPhysiologySchema(); // ADDED
            const sql = `
          SELECT plant_id, plant_name, abbr, yield_per_plant_kg, gdd_to_maturity, 
                 tmin_c, topt_low_c, topt_high_c, tmax_c, tbase_c,
                 harvest_window_days, days_maturity, days_transplant, days_germ,
                 direct_sow, transplant, default_planting_method_category, default_planting_method, overwinter_ok, start_cooling_threshold_c,
                 soil_temp_min_plant_c, annual, biennial, perennial, lifespan_years, veg_diameter_cm, spacing_cm,
                 establishment_temp_max_c, establishment_heat_window_days, establishment_heat_policy,
                 quality_temp_max_c, heat_stress_stage, quality_heat_policy,
                 photoperiod_response, critical_daylength_hours, photoperiod_stage, photoperiod_policy,
                 chilling_required_days, chilling_required_hours, chilling_temp_min_c, chilling_temp_max_c, chilling_stage, chilling_policy, diagnostic_policy
          FROM Plants
          WHERE abbr IS NOT NULL
          ORDER BY plant_name;`;
            const rows = await queryAll(sql, []);
            return rows.map(r => new PlantModel(r));
        }

        static async listAllowedMethodCategoriesForPlant(plantId) {
            const sql = `
              SELECT pam.plant_id,
                     pam.method_category_id,
                     pmc.method_category_name
              FROM PlantAllowedMethodCategories AS pam
              JOIN PlantingMethodCategories AS pmc
                ON LOWER(TRIM(pmc.method_category_id)) = LOWER(TRIM(pam.method_category_id))
              WHERE pam.plant_id = ?
              ORDER BY CASE
                         WHEN TRIM(pam.method_category_id) = LOWER(TRIM(pam.method_category_id)) THEN 0
                         ELSE 1
                       END,
                       LOWER(TRIM(pam.method_category_id));`;
            const rows = await queryAll(sql, [Number(plantId)]);
            const seen = new Set(); // FIX: collapse invalid case-only duplicates deterministically
            return rows.flatMap(row => {
                const methodCategoryId = normId(row?.method_category_id);
                if (!methodCategoryId || seen.has(methodCategoryId)) return [];
                seen.add(methodCategoryId);
                return [{ ...row, method_category_id: methodCategoryId }];
            });
        }


        static async listMethodsForMethodCategory(methodCategoryId) {
            const mcid = normId(methodCategoryId); // FIX
            if (!mcid) return [];

            const sql = `
              SELECT method_id,
                     method_category_id,
                     method_name,
                     tasks_required_json
              FROM PlantingMethods
              WHERE LOWER(TRIM(method_category_id)) = ?
              ORDER BY CASE
                         WHEN TRIM(method_id) = LOWER(TRIM(method_id)) THEN 0
                         ELSE 1
                       END,
                       LOWER(TRIM(method_id)),
                       method_name;`;
            const rows = await queryAll(sql, [mcid]);
            const seen = new Set(); // FIX
            return rows.flatMap(row => {
                const methodId = normId(row?.method_id);
                if (!methodId || seen.has(methodId)) return [];
                seen.add(methodId);
                return [{
                    ...row,
                    method_id: methodId,
                    method_category_id: normId(row?.method_category_id || mcid)
                }];
            });
        }


        static async getMethodById(methodId) {
            const normalizedMethodId = normId(methodId); // FIX
            if (!normalizedMethodId) return null;

            const sql = `
                SELECT method_category_id, method_id, method_name, tasks_required_json
                FROM PlantingMethods
                WHERE LOWER(TRIM(method_id)) = ?
                ORDER BY CASE
                           WHEN TRIM(method_id) = LOWER(TRIM(method_id)) THEN 0
                           ELSE 1
                         END,
                         method_id
                LIMIT 1;`;
            const rows = await queryAll(sql, [normalizedMethodId]);
            return rows[0] ? {
                ...rows[0],
                method_id: normId(rows[0].method_id),
                method_category_id: normId(rows[0].method_category_id)
            } : null; // FIX
        }


        gddRequired() {
            const a = Number(this.gdd_to_maturity);
            if (Number.isFinite(a) && a > 0) return a;
            const b = Number(this.days_maturity);
            if (Number.isFinite(b) && b > 0) return b;
            throw new Error(`Plant "${this.plant_name}": requires gdd_to_maturity or days_maturity in DB.`);
        }



        defaultHW() {
            return resolveHarvestWindowDays(null, this); // FIX: normalize missing or invalid plant defaults
        }

        cropTempEnvelope() {
            const Tbase = Number(this.tbase_c ?? 10);
            return {
                Tmin: Number(this.tmin_c ?? 0),
                ToptLow: Number(this.topt_low_c ?? (Tbase + 6)),
                ToptHigh: Number(this.topt_high_c ?? (Tbase + 14)),
                Tmax: Number(this.tmax_c ?? (Tbase + 24)),
                Tbase
            };
        }

        yieldPerPlant() {
            return Number(this.yield_per_plant_kg ?? 0.25);
        }

        // Amount UNTIL FIRST HARVEST, with units
        firstHarvestBudget() {
            const days = Number(this.days_maturity);
            const gdd = Number(this.gdd_to_maturity);

            const isTruePerennial = this.isPerennial() && !(Number(this.overwinter_ok) === 1 && this.isAnnual());

            // True perennials: prefer explicit days
            if (isTruePerennial && Number.isFinite(days) && days > 0)
                return { mode: 'days', amount: days };

            // Overwintered annuals (e.g., garlic): prefer GDD if present
            if (Number(this.overwinter_ok) === 1 && Number.isFinite(gdd) && gdd > 0)
                return { mode: 'gdd', amount: gdd };

            // Otherwise: prefer GDD, else days
            if (Number.isFinite(gdd) && gdd > 0) return { mode: 'gdd', amount: gdd };
            if (Number.isFinite(days) && days > 0) return { mode: 'days', amount: days };

            throw new Error(`Plant "${this.plant_name}": needs gdd_to_maturity or days_maturity.`);
        }

        static async create(patch) {
            await ensureSchedulerPhysiologySchema(); // ADDED
            const cols = [];
            const qs = [];
            const vals = [];
            for (const [k, v] of Object.entries(patch || {})) {
                if (v === undefined) continue;
                if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new Error('Invalid column: ' + k);
                cols.push(k);
                qs.push('?');
                vals.push(v === undefined ? null : v);
            }
            if (!cols.length) throw new Error('No fields to create plant.');

            const insertSql = `INSERT INTO Plants (${cols.join(', ')}) VALUES (${qs.join(', ')});`;

            return await withDbWrite(async (dbId) => {
                await execRunOnDb(dbId, "BEGIN;");
                try {
                    await execRunOnDb(dbId, insertSql, vals);
                    const idRows = await queryAllOnDb(dbId, "SELECT last_insert_rowid() AS id;", []);
                    const newId = Number(idRows?.[0]?.id);
                    const rows = await queryAllOnDb(dbId, "SELECT * FROM Plants WHERE plant_id = ?;", [newId]);
                    await execRunOnDb(dbId, "COMMIT;");
                    return rows[0] ? new PlantModel(rows[0]) : null;
                } catch (e) {
                    try { await execRunOnDb(dbId, "ROLLBACK;"); } catch (_) { }
                    throw e;
                }
            });
        }

        static async update(plantId, patch) {
            await ensureSchedulerPhysiologySchema(); // ADDED
            const id = Number(plantId);
            if (!Number.isFinite(id)) throw new Error('Invalid plantId');

            const sets = [];
            const vals = [];
            for (const [k, v] of Object.entries(patch || {})) {
                if (v === undefined) continue;
                if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new Error('Invalid column: ' + k);
                sets.push(`${k} = ?`);
                vals.push(v === undefined ? null : v);
            }
            if (!sets.length) return await PlantModel.loadById(id);

            vals.push(id);
            const sql = `UPDATE Plants SET ${sets.join(', ')} WHERE plant_id = ?;`;

            console.log("[PlantModel.update] patch keys =", Object.keys(patch || {}));
            console.log("[PlantModel.update] default_planting_method =", patch?.default_planting_method);

            await execAll(sql, vals);

            return await PlantModel.loadById(id);
        }

        static async saveWithAllowedMethodCategories(plantId, patch, methodCategoryIds) { // FIX: save plant and allowed methods together
            await ensureSchedulerPhysiologySchema(); // ADDED
            const existingId = finiteNumberOrNull(plantId); // FIX: distinguish insert from update without another connection
            const ids = Array.from(new Set((methodCategoryIds || [])
                .map(normId) // FIX
                .filter(Boolean))); // FIX: normalize duplicate category selections

            if (!ids.length) throw new Error('Enable at least one method'); // FIX: enforce the editor invariant in the model operation

            return await withDbTransaction(async (dbId) => { // FIX: make the plant and junction-table writes atomic
                let savedId = existingId;
                const entries = Object.entries(patch || {}).filter(([, value]) => value !== undefined);

                for (const [key] of entries) {
                    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error('Invalid column: ' + key); // FIX: retain dynamic-column validation
                }
                if (!entries.length) throw new Error('No fields to save plant.'); // FIX: avoid an invalid empty statement

                if (savedId != null) {
                    const sets = entries.map(([key]) => `${key} = ?`);
                    const values = entries.map(([, value]) => value);
                    values.push(savedId);
                    await execRunOnDb(dbId, `UPDATE Plants SET ${sets.join(', ')} WHERE plant_id = ?;`, values); // FIX: update on the shared transaction
                } else {
                    const columns = entries.map(([key]) => key);
                    const values = entries.map(([, value]) => value);
                    const placeholders = columns.map(() => '?');
                    await execRunOnDb(
                        dbId,
                        `INSERT INTO Plants (${columns.join(', ')}) VALUES (${placeholders.join(', ')});`,
                        values
                    ); // FIX: insert on the shared transaction
                    const idRows = await queryAllOnDb(dbId, "SELECT last_insert_rowid() AS id;", []); // FIX: resolve the inserted ID on the same connection
                    savedId = Number(idRows?.[0]?.id);
                }

                if (!Number.isFinite(savedId)) throw new Error('Save succeeded but plant_id is missing'); // FIX: prevent junction writes without a valid owner

                await execRunOnDb(
                    dbId,
                    "DELETE FROM PlantAllowedMethodCategories WHERE plant_id = ?;",
                    [savedId]
                ); // FIX: replace the allowed-method set within the transaction

                for (const methodCategoryId of ids) {
                    await execRunOnDb(
                        dbId,
                        "INSERT OR IGNORE INTO PlantAllowedMethodCategories (plant_id, method_category_id) VALUES (?, ?);",
                        [savedId, methodCategoryId]
                    ); // FIX: keep each junction insert in the same transaction
                }

                const rows = await queryAllOnDb(dbId, "SELECT * FROM Plants WHERE plant_id = ?;", [savedId]); // FIX: return the transaction's saved row
                if (!rows[0]) throw new Error(`Plant not found after save: ${savedId}`); // FIX: roll back junction changes when the owner row is missing
                return new PlantModel(rows[0]);
            });
        }
    }























    class TaskTemplateModel {
        static async ensureTables() {
            const plantTemplateSql = `
                CREATE TABLE IF NOT EXISTS PlantTaskTemplates (
                  plant_id      INTEGER NOT NULL,
                  method_id     TEXT    NOT NULL,
                  template_json TEXT    NOT NULL,
                  updated_at    TEXT    NOT NULL,
                  PRIMARY KEY (plant_id, method_id)
                );`;
            const varietyTemplateSql = `
                CREATE TABLE IF NOT EXISTS VarietyTaskTemplates (
                  variety_id    INTEGER NOT NULL,
                  method_id     TEXT    NOT NULL,
                  template_json TEXT    NOT NULL,
                  updated_at    TEXT    NOT NULL,
                  PRIMARY KEY (variety_id, method_id)
                );`;
            await execAll(plantTemplateSql, []); // FIX: dbBridge.exec prepares one SQL statement per call
            await execAll(varietyTemplateSql, []); // FIX: keep table creation single-statement for better-sqlite3
        }

        static _safeParseTemplateRow(row) {
            if (!row) return null;
            try {
                const tpl = JSON.parse(row.template_json);
                return tpl && typeof tpl === 'object' ? tpl : null;
            } catch (_) {
                return null;
            }
        }

        static async loadPlantTemplate(plantId, methodId) {
            await this.ensureTables();
            const normalizedMethodId = normId(methodId); // FIX
            const sql = `
                SELECT template_json
                FROM PlantTaskTemplates
                WHERE plant_id = ? AND LOWER(TRIM(method_id)) = ?
                ORDER BY CASE
                           WHEN TRIM(method_id) = LOWER(TRIM(method_id)) THEN 0
                           ELSE 1
                         END,
                         method_id
                LIMIT 1;`;
            const rows = await queryAll(sql, [Number(plantId), normalizedMethodId]);
            return this._safeParseTemplateRow(rows[0] || null);
        }

        static async loadVarietyTemplate(varietyId, methodId) {
            await this.ensureTables();
            const vid = Number(varietyId);
            const normalizedMethodId = normId(methodId); // FIX
            if (!Number.isFinite(vid) || !normalizedMethodId) return null;
            const sql = `
                SELECT template_json
                FROM VarietyTaskTemplates
                WHERE variety_id = ? AND LOWER(TRIM(method_id)) = ?
                ORDER BY CASE
                           WHEN TRIM(method_id) = LOWER(TRIM(method_id)) THEN 0
                           ELSE 1
                         END,
                         method_id
                LIMIT 1;`;
            const rows = await queryAll(sql, [vid, normalizedMethodId]);
            return this._safeParseTemplateRow(rows[0] || null);
        }

        static async loadMethodBuiltinTemplate(methodId) {
            return getDefaultTaskTemplateForPlantingMethods(methodId); // ADDED
        }

        static async savePlantTemplate(plantId, methodId, template) {
            await this.ensureTables();
            const normalizedMethodId = normId(methodId); // FIX
            if (!normalizedMethodId) throw new Error('methodId is required.');
            const json = JSON.stringify(template ?? {});
            const now = new Date().toISOString();
            await withDbTransaction(async dbId => { // FIX: replace case-only task-template duplicates atomically
                await execRunOnDb(dbId, `
                    DELETE FROM PlantTaskTemplates
                    WHERE plant_id = ? AND LOWER(TRIM(method_id)) = ?;`,
                [Number(plantId), normalizedMethodId]);
                await execRunOnDb(dbId, `
                    INSERT INTO PlantTaskTemplates (plant_id, method_id, template_json, updated_at)
                    VALUES (?, ?, ?, ?);`,
                [Number(plantId), normalizedMethodId, json, now]);
            });
        }

        static async saveForSelection({ plantId, methodId, template }) {
            return this.savePlantTemplate(plantId, methodId, template);
        }

        static async deletePlantTemplate(plantId, methodId) {
            await this.ensureTables();
            const sql = `
              DELETE FROM PlantTaskTemplates
              WHERE plant_id = ? AND LOWER(TRIM(method_id)) = ?;`;
            await execAll(sql, [Number(plantId), normId(methodId)]); // FIX
        }

        static async deleteForSelection({ plantId, methodId }) {
            return this.deletePlantTemplate(plantId, methodId);
        }
    }

























    // =====================================================================
    // PlantVarietyModel (JSON overrides)                                    
    // =====================================================================
    class PlantVarietyModel {
        constructor(row) {
            Object.assign(this, row);
            this.variety_id = Number(this.variety_id);
            this.plant_id = Number(this.plant_id);
        }

        static async ensureTable() {
            const sql = `
                    CREATE TABLE IF NOT EXISTS PlantVarieties (
                        variety_id     INTEGER PRIMARY KEY AUTOINCREMENT,
                        plant_id       INTEGER NOT NULL,
                        variety_name   TEXT NOT NULL,
                        overrides_json TEXT NOT NULL,
                        created_at     TEXT NOT NULL,
                        updated_at     TEXT NOT NULL
                    );`;
            await execAll(sql, []);

            await execAll(
                `CREATE INDEX IF NOT EXISTS idx_PlantVarieties_plant_id
                     ON PlantVarieties (plant_id);`,
                []
            );

            await execAll(
                `CREATE UNIQUE INDEX IF NOT EXISTS idx_PlantVarieties_unique
                     ON PlantVarieties (plant_id, variety_name);`,
                []
            );
        }

        static _parseOverrides(jsonStr) {
            if (jsonStr == null || jsonStr === '') return {};
            try {
                const o = JSON.parse(jsonStr);
                return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
            } catch (e) {
                console.warn('Bad overrides_json in PlantVarieties', e);
                return {};
            }
        }

        overridesObject() {
            return PlantVarietyModel._parseOverrides(this.overrides_json);
        }

        static async listByPlantId(plantId) {
            await this.ensureTable();
            const pid = Number(plantId);
            if (!Number.isFinite(pid)) return [];

            const sql = `
                    SELECT variety_id, plant_id, variety_name, overrides_json, created_at, updated_at
                    FROM PlantVarieties
                    WHERE plant_id = ?
                    ORDER BY variety_name COLLATE NOCASE;`;
            const rows = await queryAll(sql, [pid]);
            return rows.map(r => new PlantVarietyModel(r));
        }

        static async loadById(varietyId) {
            await this.ensureTable();
            const vid = Number(varietyId);
            if (!Number.isFinite(vid)) return null;

            const sql = `
                    SELECT variety_id, plant_id, variety_name, overrides_json, created_at, updated_at
                    FROM PlantVarieties
                    WHERE variety_id = ?
                    LIMIT 1;`;
            const rows = await queryAll(sql, [vid]);
            return rows[0] ? new PlantVarietyModel(rows[0]) : null;
        }

        static async create({ plantId, varietyName, overrides }) {
            await this.ensureTable();
            const pid = Number(plantId);
            if (!Number.isFinite(pid)) throw new Error('create: invalid plantId');

            const name = String(varietyName ?? '').trim();
            if (!name) throw new Error('create: varietyName is required');

            const obj = (overrides && typeof overrides === 'object') ? overrides : {};
            const json = JSON.stringify(obj);
            const now = new Date().toISOString();

            const sql = `
                    INSERT INTO PlantVarieties (plant_id, variety_name, overrides_json, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?);`;
            await execAll(sql, [pid, name, json, now, now]);

            // Return the created row (SQLite last_insert_rowid not exposed here)        
            const rows = await queryAll(
                `SELECT variety_id, plant_id, variety_name, overrides_json, created_at, updated_at
                     FROM PlantVarieties
                     WHERE plant_id = ? AND variety_name = ?
                     LIMIT 1;`,
                [pid, name]
            );
            return rows[0] ? new PlantVarietyModel(rows[0]) : null;
        }

        static async update({ varietyId, varietyName, overrides }) {
            await this.ensureTable();
            const vid = Number(varietyId);
            if (!Number.isFinite(vid)) throw new Error('update: invalid varietyId');

            const name = (varietyName == null) ? null : String(varietyName).trim();
            const json = (overrides == null) ? null : JSON.stringify(
                (overrides && typeof overrides === 'object') ? overrides : {}
            );
            const now = new Date().toISOString();

            // Build dynamic update: only set provided fields                            
            const sets = [];
            const params = [];
            if (name != null) { sets.push('variety_name = ?'); params.push(name); }
            if (json != null) { sets.push('overrides_json = ?'); params.push(json); }
            sets.push('updated_at = ?'); params.push(now);
            params.push(vid);

            const sql = `
                    UPDATE PlantVarieties
                    SET ${sets.join(', ')}
                    WHERE variety_id = ?;`;
            await execAll(sql, params);

            return await this.loadById(vid);
        }

        static async deleteById(varietyId) {
            await this.ensureTable();
            const vid = Number(varietyId);
            if (!Number.isFinite(vid)) return;
            const sql = `DELETE FROM PlantVarieties WHERE variety_id = ?;`;
            await execAll(sql, [vid]);
        }
    }

    // =====================================================================
    // helper to apply overrides to a base plant row          
    // =====================================================================
    function applyPlantOverrides(basePlantRow, overridesObj) {
        const out = Object.assign({}, basePlantRow || {});
        const o = (overridesObj && typeof overridesObj === 'object') ? overridesObj : {};
        Object.keys(o).forEach(k => { out[k] = o[k]; });
        return out;
    }

    async function resolveEffectivePlant(plantId, varietyId = null) {
        const pid = Number(plantId);
        if (!Number.isFinite(pid)) return null;
    
        const basePlant = await PlantModel.loadById(pid);
        if (!basePlant) return null;
    
        const vid = Number(varietyId);
        if (!Number.isFinite(vid)) {
            return basePlant;
        }
    
        const variety = await PlantVarietyModel.loadById(vid);
        if (!variety) {
            return basePlant;
        }
    
        // Safety: ensure the variety belongs to the requested plant
        if (Number(variety.plant_id) !== pid) {
            console.warn("[resolveEffectivePlant] variety does not belong to plant", {
                plantId: pid,
                varietyId: vid,
                varietyPlantId: variety.plant_id
            });
            return basePlant;
        }
    
        const overrides = variety.overridesObject();
        const mergedRow = applyPlantOverrides(toPlainDict(basePlant), overrides);
    
        // Preserve canonical ids/names
        mergedRow.plant_id = basePlant.plant_id;
        mergedRow.plant_name = basePlant.plant_name;
        mergedRow.abbr = basePlant.abbr;
    
        return new PlantModel(mergedRow);
    }

    async function resolveVarietyName(varietyId, currentVarieties = null) {
        const vid = Number(varietyId);
        if (!Number.isFinite(vid)) return '';
    
        if (Array.isArray(currentVarieties)) {
            const found = currentVarieties.find(v => Number(v?.variety_id) === vid);
            if (found) {
                return String(found.variety_name || '').trim();
            }
        }
    
        const row = await PlantVarietyModel.loadById(vid);
        return row ? String(row.variety_name || '').trim() : '';
    }

    class CityClimate {
        constructor(row) {
            Object.assign(this, row);
        }

        static async loadAll() {
            await ensureSchedulerPhysiologySchema(); // ADDED
            const sql = `SELECT * FROM Cities ORDER BY city_name;`;
            const rows = await queryAll(sql, []);
            return rows.map(r => new CityClimate(r));
        }

        static async loadByName(name) {
            await ensureSchedulerPhysiologySchema(); // ADDED
            const sql = `SELECT * FROM Cities WHERE city_name = ? LIMIT 1;`;
            const rows = await queryAll(sql, [name]);
            return rows[0] ? new CityClimate(rows[0]) : null;
        }

        static async loadUniqueByName(name) { // ADDED
            await ensureSchedulerPhysiologySchema(); // ADDED
            const trimmed = String(name || '').trim(); // ADDED
            if (!trimmed) return null; // ADDED
            const rows = await queryAll(`SELECT * FROM Cities WHERE city_name = ? LIMIT 2;`, [trimmed]); // ADDED
            return rows.length === 1 ? new CityClimate(rows[0]) : null; // ADDED
        }

        static async loadById(cityId) { // ADDED
            await ensureSchedulerPhysiologySchema(); // ADDED
            const id = Number(cityId); // ADDED
            if (!Number.isFinite(id)) return null; // ADDED
            const rows = await queryAll(`SELECT * FROM Cities WHERE city_id = ? LIMIT 1;`, [id]); // ADDED
            return rows[0] ? new CityClimate(rows[0]) : null; // ADDED
        }

        static async resolve({ cityId = null, cityName = '' } = {}) { // ADDED
            return (await CityClimate.loadById(cityId)) || (cityName ? await CityClimate.loadByName(cityName) : null); // ADDED
        }

        static async resolveUniqueNameFallback({ cityId = null, cityName = '' } = {}) { // ADDED
            return (await CityClimate.loadById(cityId)) || (cityName ? await CityClimate.loadUniqueByName(cityName) : null); // ADDED
        }

        static async updateLatitude(cityName, latitudeDeg) { // ADDED
            await ensureSchedulerPhysiologySchema(); // ADDED
            const name = String(cityName || '').trim(); // ADDED
            if (!name) throw new Error('Select a city before saving latitude.'); // ADDED
            const normalized = normalizeLatitudeDeg(latitudeDeg); // ADDED
            await withDbWrite(async dbId => { // ADDED
                await execRunOnDb(dbId, 'UPDATE Cities SET latitude = ? WHERE city_name = ?;', [normalized, name]); // CHANGED
                const rows = await queryAllOnDb(dbId, 'SELECT changes() AS changes;', []); // ADDED
                if (!Number(rows?.[0]?.changes)) throw new Error(`City not found: ${name}`); // ADDED
            }); // ADDED
            return normalized; // ADDED
        }

        monthlyHighs() {
            const out = {};
            for (let m = 1; m <= 12; m++) out[m] = this[`avg_monthly_high_c${m}`];
            return out;
        }

        monthlyLows() {
            const out = {};
            for (let m = 1; m <= 12; m++) out[m] = this[`avg_monthly_low_c${m}`];
            return out;
        }

        monthlyMeans() {
            const highs = this.monthlyHighs(), lows = this.monthlyLows();
            const out = {};
            for (let m = 1; m <= 12; m++) {
                const hi = highs[m], lo = lows[m];
                if (hi == null || lo == null) continue;
                out[m] = (Number(hi) + Number(lo)) / 2;
            }
            return out;
        }

        gddCalibration(year) {
            return solveGddTemperatureOffset({
                monthlyAvgTemp: this.monthlyMeans(),
                targetGdd: this.gdd_annual,
                gddBaseC: this.gdd_base_c,
                year
            }); // ADDED: align monthly heat curve with city annual GDD metadata when possible.
        }

        calibratedMonthlyMeans(year) {
            const raw = this.monthlyMeans();
            const calibration = this.gddCalibration(year);
            return applyTemperatureOffsetToMonthlyMeans(raw, calibration.usable ? calibration.offsetC : 0); // ADDED
        }

        dailyRates(tbase, year, climatePolicy = null) { // CHANGED
            const means = climatePolicy?.gddCalibrationEnabled === false ? this.monthlyMeans() : this.calibratedMonthlyMeans(year); // CHANGED: allow climate policy to disable city GDD calibration.
            const gddMonthly = {};
            for (let m = 1; m <= 12; m++) {
                const Tm = means?.[m];
                const dim = daysInMonth(year, m);
                gddMonthly[m] = (Tm == null) ? 0 : Math.max(0, Tm - tbase) * dim;
            }
            const daily = {};
            for (let m = 1; m <= 12; m++) {
                const dim = daysInMonth(year, m);
                daily[m] = dim > 0 ? (gddMonthly[m] / dim) : 0;
            }
            return daily;
        }

        async loadDailyClimateModel({ scanStart, scanEndHard, todayISO = null, climatePolicy = null } = {}) { // CHANGED
            const start = scanStart || asUTCDate(new Date().getUTCFullYear(), 1, 1); // ADDED
            const end = scanEndHard || asUTCDate(start.getUTCFullYear(), 12, 31); // ADDED
            const fallbackNormals = sharedCore.monthlyTemperatureNormalsFromCity(this); // CHANGED
            let monthlyNormals = fallbackNormals; // ADDED
            let source = 'city monthly normals'; // ADDED
            const cityId = Number(this.city_id); // ADDED
            let forecastRows = []; // ADDED
            const normalizedPolicy = normalizeClimateModelPatch(climatePolicy || {}); // ADDED
            const normalsSource = normalizedPolicy.weatherNormalsSource || DEFAULT_CLIMATE_MODEL_POLICY.weatherNormalsSource; // ADDED

            if (Number.isFinite(cityId)) { // ADDED
                try { // ADDED
                    const monthlyRows = normalsSource === 'city_weather_daily' || normalsSource === 'city_monthly_columns' ? [] : await queryAll(` // CHANGED
                        SELECT CAST(substr(weather_month, 6, 2) AS INTEGER) AS month,
                               AVG(temp_min_c) AS min,
                               AVG(temp_max_c) AS max,
                               AVG(temp_mean_c) AS mean
                        FROM CityWeatherMonthly
                        WHERE city_id = ?
                        GROUP BY CAST(substr(weather_month, 6, 2) AS INTEGER)
                        ORDER BY month;
                    `, [cityId]); // ADDED
                    const monthlyFromWeather = {}; // ADDED
                    (monthlyRows || []).forEach(function (row) { // ADDED
                        const month = Number(row.month); // ADDED
                        if (month >= 1 && month <= 12) monthlyFromWeather[month] = row; // ADDED
                    }); // ADDED
                    if (Object.keys(monthlyFromWeather).length) { // ADDED
                        monthlyNormals = monthlyFromWeather; // ADDED
                        source = 'CityWeatherMonthly normals'; // ADDED
                    } else if (normalsSource !== 'city_weather_monthly' && normalsSource !== 'city_monthly_columns') { // CHANGED
                        const dailyRows = await queryAll(`
                            SELECT CAST(substr(weather_date, 6, 2) AS INTEGER) AS month,
                                   AVG(temp_min_c) AS min,
                                   AVG(temp_max_c) AS max,
                                   AVG(temp_mean_c) AS mean
                            FROM CityWeatherDaily
                            WHERE city_id = ?
                            GROUP BY CAST(substr(weather_date, 6, 2) AS INTEGER)
                            ORDER BY month;
                        `, [cityId]); // ADDED
                        const monthlyFromDaily = {}; // ADDED
                        (dailyRows || []).forEach(function (row) { // ADDED
                            const month = Number(row.month); // ADDED
                            if (month >= 1 && month <= 12) monthlyFromDaily[month] = row; // ADDED
                        }); // ADDED
                        if (Object.keys(monthlyFromDaily).length) { // ADDED
                            monthlyNormals = monthlyFromDaily; // ADDED
                            source = 'CityWeatherDaily monthly normals'; // ADDED
                        } // ADDED
                    } // ADDED
                } catch (e) { // ADDED
                    console.warn('[Scheduler] Weather normals unavailable; using city monthly normals', e?.message || String(e)); // ADDED
                } // ADDED

                try { // ADDED
                    forecastRows = await queryAll(`
                        SELECT forecast_date, temp_min_c, temp_max_c, temp_mean_c, run_timestamp
                        FROM CityWeatherForecastDaily
                        WHERE city_id = ?
                          AND forecast_date BETWEEN ? AND ?
                        ORDER BY forecast_date, run_timestamp;
                    `, [cityId, fmtISO(start), fmtISO(end)]); // ADDED
                } catch (e) { // ADDED
                    console.warn('[Scheduler] Forecast weather unavailable; using normals only', e?.message || String(e)); // ADDED
                    forecastRows = []; // ADDED
                } // ADDED
            } // ADDED

            return sharedCore.buildDailyTemperatureSeries({ // CHANGED
                startDate: start, // ADDED
                endDate: end, // ADDED
                monthlyNormals, // ADDED
                forecastRows, // ADDED
                todayISO, // ADDED
                source, // ADDED
                forecastBlendWeights: normalizedPolicy // ADDED
            }); // ADDED
        }
    }

    async function saveSchedulerCityLatitude({ cityName, latitudeValue, cities, recomputeAll, updateTaskPreview }) { // ADDED
        const normalized = normalizeLatitudeDeg(latitudeValue); // ADDED
        await CityClimate.updateLatitude(cityName, normalized); // ADDED
        const cachedCity = (cities || []).find(city => String(city.city_name || '') === String(cityName || '')); // ADDED
        if (cachedCity) cachedCity.latitude = normalized; // CHANGED
        if (typeof recomputeAll === 'function') await recomputeAll('cityChanged'); // ADDED
        if (typeof updateTaskPreview === 'function') await updateTaskPreview(); // ADDED
        return normalized; // ADDED
    }

    const CLIMATE_MODEL_DEFAULTS_ATTR = 'scheduler_climate_model_defaults_json'; // ADDED
    const CLIMATE_MODEL_PLANT_OVERRIDES_ATTR = 'scheduler_climate_model_plant_overrides_json'; // ADDED
    const DEFAULT_CLIMATE_MODEL_POLICY = Object.freeze({ // ADDED
        springFrostRisk: 'p50', // ADDED
        weatherNormalsSource: 'auto', // ADDED
        forecastBlendWeight0To3Days: 0.8, // ADDED
        forecastBlendWeight4To7Days: 0.5, // ADDED
        forecastBlendWeight8To16Days: 0.25, // ADDED
        soilGateConsecutiveDays: 3, // ADDED
        gddCalibrationEnabled: true // ADDED
    }); // ADDED
    const CLIMATE_MODEL_PARAMETER_SCHEMA = Object.freeze([ // ADDED
        Object.freeze({ key: 'springFrostRisk', label: 'Spring frost risk', type: 'enum', options: [['p10', 'p10'], ['p50', 'p50'], ['p90', 'p90']] }), // ADDED
        Object.freeze({ key: 'weatherNormalsSource', label: 'Weather normals source', type: 'enum', options: [['auto', 'Auto'], ['city_weather_monthly', 'Monthly weather'], ['city_weather_daily', 'Daily weather'], ['city_monthly_columns', 'City monthly columns']] }), // ADDED
        Object.freeze({ key: 'forecastBlendWeight0To3Days', label: 'Forecast blend 0-3 days', type: 'number', min: 0, max: 1, step: 0.01 }), // ADDED
        Object.freeze({ key: 'forecastBlendWeight4To7Days', label: 'Forecast blend 4-7 days', type: 'number', min: 0, max: 1, step: 0.01 }), // ADDED
        Object.freeze({ key: 'forecastBlendWeight8To16Days', label: 'Forecast blend 8-16 days', type: 'number', min: 0, max: 1, step: 0.01 }), // ADDED
        Object.freeze({ key: 'soilGateConsecutiveDays', label: 'Soil-ready days', type: 'integer', min: 1, max: 14, step: 1 }), // ADDED
        Object.freeze({ key: 'gddCalibrationEnabled', label: 'GDD calibration', type: 'boolean' }) // ADDED
    ]); // ADDED

    function normalizeClimateModelPatch(raw) { // ADDED
        const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}; // ADDED
        const out = {}; // ADDED
        if (['p10', 'p50', 'p90'].indexOf(String(source.springFrostRisk || '')) >= 0) out.springFrostRisk = String(source.springFrostRisk); // ADDED
        if (['auto', 'city_weather_monthly', 'city_weather_daily', 'city_monthly_columns'].indexOf(String(source.weatherNormalsSource || '')) >= 0) out.weatherNormalsSource = String(source.weatherNormalsSource); // ADDED
        ['forecastBlendWeight0To3Days', 'forecastBlendWeight4To7Days', 'forecastBlendWeight8To16Days'].forEach(function (key) { // ADDED
            const n = finiteNumberOrNull(source[key]); // ADDED
            if (n != null) out[key] = Math.max(0, Math.min(1, n)); // ADDED
        }); // ADDED
        const soilDays = finiteNumberOrNull(source.soilGateConsecutiveDays); // ADDED
        if (soilDays != null) out.soilGateConsecutiveDays = Math.max(1, Math.min(14, Math.round(soilDays))); // ADDED
        if (source.gddCalibrationEnabled === true || source.gddCalibrationEnabled === false) out.gddCalibrationEnabled = !!source.gddCalibrationEnabled; // ADDED
        return out; // ADDED
    } // ADDED

    function mergeClimateModelPolicy(gardenPatch, plantPatch) { // ADDED
        return Object.assign({}, DEFAULT_CLIMATE_MODEL_POLICY, normalizeClimateModelPatch(gardenPatch), normalizeClimateModelPatch(plantPatch)); // ADDED
    } // ADDED

    function readClimateModelJsonAttr(cell, attrName, fallback) { // ADDED
        const raw = cell?.getAttribute?.(attrName); // ADDED
        if (!raw) return fallback; // ADDED
        const parsed = safeJsonParse(String(raw), fallback); // ADDED
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback; // ADDED
    } // ADDED

    function normalizeClimateCityKey(cityName) { // ADDED
        return String(cityName || '').trim().toLowerCase(); // ADDED
    } // ADDED

    function buildClimatePlantOverrideKey(cityName, plantId) { // ADDED
        return `${normalizeClimateCityKey(cityName)}::${Number(plantId)}`; // ADDED
    } // ADDED

    function readClimateModelGardenPatch(moduleCell) { // ADDED
        return normalizeClimateModelPatch(readClimateModelJsonAttr(moduleCell, CLIMATE_MODEL_DEFAULTS_ATTR, {})); // ADDED
    } // ADDED

    function readClimateModelPlantOverrideMap(moduleCell) { // ADDED
        return readClimateModelJsonAttr(moduleCell, CLIMATE_MODEL_PLANT_OVERRIDES_ATTR, {}); // ADDED
    } // ADDED

    function readClimateModelPlantPatch(moduleCell, cityName, plantId) { // ADDED
        const map = readClimateModelPlantOverrideMap(moduleCell); // ADDED
        return normalizeClimateModelPatch(map[buildClimatePlantOverrideKey(cityName, plantId)] || {}); // ADDED
    } // ADDED

    function resolveClimateModelPolicy(moduleCell, cityName, plantId, draftPlantPatch = null) { // ADDED
        const gardenPatch = readClimateModelGardenPatch(moduleCell); // ADDED
        const savedPlantPatch = readClimateModelPlantPatch(moduleCell, cityName, plantId); // ADDED
        const plantPatch = draftPlantPatch == null ? savedPlantPatch : normalizeClimateModelPatch(draftPlantPatch); // ADDED
        const effective = mergeClimateModelPolicy(gardenPatch, plantPatch); // ADDED
        const sources = {}; // ADDED
        CLIMATE_MODEL_PARAMETER_SCHEMA.forEach(function (def) { // ADDED
            if (Object.prototype.hasOwnProperty.call(plantPatch, def.key)) sources[def.key] = 'Plant override'; // ADDED
            else if (Object.prototype.hasOwnProperty.call(gardenPatch, def.key)) sources[def.key] = 'Garden default'; // ADDED
            else sources[def.key] = 'Built-in default'; // ADDED
        }); // ADDED
        return { effective, sources, gardenPatch, plantPatch, overrideKey: buildClimatePlantOverrideKey(cityName, plantId) }; // ADDED
    } // ADDED

    function stringifyClimateModelAttr(value) { // ADDED
        const normalized = value && typeof value === 'object' && !Array.isArray(value) ? value : {}; // ADDED
        return Object.keys(normalized).length ? JSON.stringify(normalized) : null; // CHANGED
    } // ADDED

    function setTooltip(el, text) { // ADDED
        if (!el) return; // ADDED
        el.title = String(text || ''); // ADDED
    } // ADDED

    function formatClimateModelDoyDate(doy, year) { // ADDED
        const n = finiteNumberOrNull(doy); // ADDED
        const y = Math.trunc(Number(year)); // ADDED
        if (n == null || !Number.isFinite(y)) return ''; // ADDED
        return dateFromDOY(y, n).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); // ADDED
    } // ADDED

    function resolveFrostRiskTip(city, risk, year) { // ADDED
        const selectedRisk = ['p10', 'p50', 'p90'].indexOf(String(risk || '')) >= 0 ? String(risk) : 'p50'; // ADDED
        const selectedValue = finiteNumberOrNull(city?.[`last_spring_frost_${selectedRisk}_doy`]); // ADDED
        const plainValue = finiteNumberOrNull(city?.last_spring_frost_doy); // ADDED
        if (selectedValue != null) { // ADDED
            return { // ADDED
                text: `${formatClimateModelDoyDate(selectedValue, year)} (${selectedRisk})`, // ADDED
                tooltip: `Selected ${selectedRisk} frost date is DOY ${Math.round(selectedValue)} for ${city?.city_name || 'the selected city'}.` // ADDED
            }; // ADDED
        } // ADDED
        if (plainValue != null) { // ADDED
            return { // ADDED
                text: `No ${selectedRisk}; using ${formatClimateModelDoyDate(plainValue, year)}`, // ADDED
                tooltip: `No ${selectedRisk} frost date is stored for ${city?.city_name || 'the selected city'}; using the plain last_spring_frost_doy value ${Math.round(plainValue)}.` // ADDED
            }; // ADDED
        } // ADDED
        return { // ADDED
            text: `No ${selectedRisk}; using ${formatClimateModelDoyDate(105, year)}`, // ADDED
            tooltip: `No ${selectedRisk} or plain frost date is stored for ${city?.city_name || 'the selected city'}; using scheduler fallback DOY 105.` // ADDED
        }; // ADDED
    } // ADDED

    function countMonthlyNormals(monthlyNormals) { // ADDED
        return Object.keys(sharedCore.normalizeMonthlyTemperatureNormals(monthlyNormals) || {}).length; // ADDED
    } // ADDED

    async function countCityWeatherMonthlyRows(cityId) { // ADDED
        if (!Number.isFinite(Number(cityId))) return 0; // ADDED
        try { // ADDED
            const rows = await queryAll(` // ADDED
                SELECT COUNT(*) AS count
                FROM (
                    SELECT CAST(substr(weather_month, 6, 2) AS INTEGER) AS month
                    FROM CityWeatherMonthly
                    WHERE city_id = ?
                    GROUP BY CAST(substr(weather_month, 6, 2) AS INTEGER)
                ) AS months;`, [Number(cityId)]); // ADDED
            return Number(rows?.[0]?.count || 0); // ADDED
        } catch (_) { // ADDED
            return 0; // ADDED
        } // ADDED
    } // ADDED

    async function countCityWeatherDailyMonthlyRows(cityId) { // ADDED
        if (!Number.isFinite(Number(cityId))) return 0; // ADDED
        try { // ADDED
            const rows = await queryAll(` // ADDED
                SELECT COUNT(*) AS count
                FROM (
                    SELECT CAST(substr(weather_date, 6, 2) AS INTEGER) AS month
                    FROM CityWeatherDaily
                    WHERE city_id = ?
                    GROUP BY CAST(substr(weather_date, 6, 2) AS INTEGER)
                ) AS months;`, [Number(cityId)]); // ADDED
            return Number(rows?.[0]?.count || 0); // ADDED
        } catch (_) { // ADDED
            return 0; // ADDED
        } // ADDED
    } // ADDED

    async function resolveWeatherNormalsSourceStatus(city, requestedSource) { // ADDED
        const source = normalizeClimateModelPatch({ weatherNormalsSource: requestedSource }).weatherNormalsSource || 'auto'; // ADDED
        const cityId = Number(city?.city_id); // ADDED
        const monthlyCount = await countCityWeatherMonthlyRows(cityId); // ADDED
        const dailyCount = await countCityWeatherDailyMonthlyRows(cityId); // ADDED
        const cityColumnCount = countMonthlyNormals(sharedCore.monthlyTemperatureNormalsFromCity(city)); // ADDED
        let actual = 'city monthly columns'; // ADDED
        let text = ''; // ADDED
        if (source === 'auto') { // ADDED
            if (monthlyCount > 0) actual = 'CityWeatherMonthly'; // ADDED
            else if (dailyCount > 0) actual = 'CityWeatherDaily'; // ADDED
            else actual = cityColumnCount > 0 ? 'city monthly columns' : 'no normals'; // ADDED
            text = actual === 'no normals' ? 'Auto: no normals found' : `Auto: using ${actual}`; // ADDED
        } else if (source === 'city_weather_monthly') { // ADDED
            actual = monthlyCount > 0 ? 'CityWeatherMonthly' : (cityColumnCount > 0 ? 'city monthly columns' : 'no normals'); // ADDED
            text = monthlyCount > 0 ? 'Monthly weather available' : `Monthly weather missing; using ${actual}`; // ADDED
        } else if (source === 'city_weather_daily') { // ADDED
            actual = dailyCount > 0 ? 'CityWeatherDaily' : (cityColumnCount > 0 ? 'city monthly columns' : 'no normals'); // ADDED
            text = dailyCount > 0 ? 'Daily weather available' : `Daily weather missing; using ${actual}`; // ADDED
        } else { // ADDED
            actual = cityColumnCount > 0 ? 'city monthly columns' : 'no normals'; // ADDED
            text = cityColumnCount > 0 ? 'City monthly columns available' : 'City monthly columns missing'; // ADDED
        } // ADDED
        return { // ADDED
            text, // ADDED
            tooltip: `Requested source: ${source}. Monthly weather months: ${monthlyCount}; daily weather months: ${dailyCount}; city monthly column months: ${cityColumnCount}. Actual source: ${actual}.` // ADDED
        }; // ADDED
    } // ADDED

    function prettifyBedConditionValue(value) { // ADDED
        const raw = String(value || 'unknown').trim() || 'unknown'; // ADDED
        return raw.replace(/_/g, ' '); // ADDED
    } // ADDED

    function formatGardenName(moduleCell) { // ADDED
        return String(moduleCell?.getAttribute?.('garden_name') || moduleCell?.getAttribute?.('label') || 'Garden').trim() || 'Garden'; // ADDED
    } // ADDED


    class PolicyFlags {
        constructor({
            // spring frost gate
            useSpringFrostGate = true,          // default ON for non-overwinter crops
            springFrostRisk = 'p50',            // 'p90' | 'p50' | 'p10'

            // Soil gate
            useSoilTempGate = false,
            soilGateThresholdC = null,
            soilGateConsecutiveDays = 3,

            overwinterAllowed = false,
            gddCalibrationEnabled = true, // ADDED
            weatherNormalsSource = 'auto', // ADDED
            forecastBlendWeight0To3Days = 0.8, // ADDED
            forecastBlendWeight4To7Days = 0.5, // ADDED
            forecastBlendWeight8To16Days = 0.25 // ADDED
        } = {}) {
            this.overwinterAllowed = !!overwinterAllowed;

            this.useSpringFrostGate = !!useSpringFrostGate; // FIX: overwinter capability does not make early field planting frost-safe
            this.springFrostRisk = ['p10', 'p50', 'p90'].indexOf(String(springFrostRisk || '')) >= 0 ? String(springFrostRisk) : 'p50'; // CHANGED

            const thr = Number(soilGateThresholdC);
            this.soilGateThresholdC = Number.isFinite(thr) ? thr : null;
            this.useSoilTempGate = !!useSoilTempGate && this.soilGateThresholdC != null;
            this.soilGateConsecutiveDays = Math.max(1, Math.min(14, Number(soilGateConsecutiveDays ?? 3))); // CHANGED
            this.gddCalibrationEnabled = gddCalibrationEnabled !== false; // ADDED
            this.weatherNormalsSource = ['auto', 'city_weather_monthly', 'city_weather_daily', 'city_monthly_columns'].indexOf(String(weatherNormalsSource || '')) >= 0 ? String(weatherNormalsSource) : 'auto'; // ADDED
            this.forecastBlendWeight0To3Days = Math.max(0, Math.min(1, Number(forecastBlendWeight0To3Days ?? 0.8))); // ADDED
            this.forecastBlendWeight4To7Days = Math.max(0, Math.min(1, Number(forecastBlendWeight4To7Days ?? 0.5))); // ADDED
            this.forecastBlendWeight8To16Days = Math.max(0, Math.min(1, Number(forecastBlendWeight8To16Days ?? 0.25))); // ADDED
            Object.freeze(this);
        }

        static fromResolvedBehavior(plant, resolvedBehavior, climatePolicy = null) { // CHANGED
            const threshold = finiteNumberOrNull(plant?.soil_temp_min_plant_c); // CHANGED
            const overwinterAllowed = isCrossYearCrop(plant); // FIX: biennials are cross-year crops
            const modelPolicy = mergeClimateModelPolicy(null, climatePolicy); // ADDED

            return new PolicyFlags({ // CHANGED
                useSpringFrostGate: true, // FIX: apply the field frost gate to perennials and overwinter-capable crops
                springFrostRisk: modelPolicy.springFrostRisk, // CHANGED
                useSoilTempGate: !!resolvedBehavior?.usesSoilTempGate && threshold != null, // CHANGED
                soilGateThresholdC: threshold, // CHANGED
                soilGateConsecutiveDays: modelPolicy.soilGateConsecutiveDays, // CHANGED
                overwinterAllowed, // CHANGED
                gddCalibrationEnabled: modelPolicy.gddCalibrationEnabled, // ADDED
                weatherNormalsSource: modelPolicy.weatherNormalsSource, // ADDED
                forecastBlendWeight0To3Days: modelPolicy.forecastBlendWeight0To3Days, // ADDED
                forecastBlendWeight4To7Days: modelPolicy.forecastBlendWeight4To7Days, // ADDED
                forecastBlendWeight8To16Days: modelPolicy.forecastBlendWeight8To16Days // ADDED
            }); // CHANGED
        } // CHANGED

    }

    // Cross-year capability is a lifecycle property, independent of frost-gate policy.
    function isCrossYearCrop(plant) { // FIX: centralize lifecycle scheduling rules
        if (!plant) return false;
        const perennial = typeof plant.isPerennial === 'function' && plant.isPerennial();
        const biennial = typeof plant.isBiennial === 'function' && plant.isBiennial();
        return perennial || biennial || Number(plant.overwinter_ok ?? 0) === 1; // FIX: centralize lifecycle policy
    }

    function getPlantScanYears(plant) { // FIX: centralize lifecycle-aware scan bounds
        if (plant.isPerennial()) {
            const lifespan = Number(plant.lifespan_years);
            if (!Number.isFinite(lifespan) || lifespan < 1) {
                throw new Error('Perennial requires lifespan_years in DB.');
            }
            return Math.floor(lifespan);
        }

        if (plant.isBiennial()) {
            const lifespan = Number(plant.lifespan_years);
            if (!Number.isFinite(lifespan) || lifespan < 2) {
                throw new Error('Biennial requires lifespan_years >= 2 in DB.');
            }
            return Math.floor(lifespan);
        }

        return 1 + (Number(plant.overwinter_ok) === 1 ? 1 : 0);
    }





























    async function buildScheduleContextFromForm(formState, selPlant, options = {}) {
        const plant = await resolveEffectivePlant(formState.plantId, formState.varietyId);
        if (!plant) throw new Error('Plant not found for schedule.');

        const city = await CityClimate.resolve({ cityId: formState.cityId, cityName: formState.cityName }); // CHANGED
        if (!city) throw new Error('City not found for schedule.');

        const methodCategoryId = normId(formState.methodCategoryId); // FIX
        const methodId = normId(formState.methodId); // FIX
        const resolvedBehavior = resolveMethodBehavior({ methodCategoryId, methodId });
        const planningMode = resolvedBehavior.planningMode;

        const climateResolution = resolveClimateModelPolicy( // ADDED
            options.climateModelModuleCell || formState.climateModelModuleCell || null, // ADDED
            formState.cityName, // ADDED
            formState.plantId, // ADDED
            formState.climateModelDraftPatch // ADDED
        ); // ADDED
        formState.climateModelPolicy = climateResolution.effective; // ADDED
        const policy = PolicyFlags.fromResolvedBehavior(plant, resolvedBehavior, climateResolution.effective); // CHANGED

        const varietyId = formState.varietyId != null ? Number(formState.varietyId) : null;
        const varietyName = varietyId
            ? await resolveVarietyName(varietyId, options.currentVarieties)
            : '';
        const scanStart = asUTCDate(Number(formState.seasonStartYear), 1, 1); // ADDED
        const scanEndHard = asUTCDate(Number(formState.seasonStartYear) + getPlantScanYears(plant) - 1, 12, 31); // ADDED
        const dailyClimateKey = `${city.city_name || formState.cityName}|${fmtISO(scanStart)}|${fmtISO(scanEndHard)}|${JSON.stringify(climateResolution.effective)}`; // CHANGED
        const cachedDailyClimate = formState.dailyClimateKey === dailyClimateKey ? formState.dailyClimate : null; // ADDED
        const dailyClimate = options.dailyClimate || cachedDailyClimate || await city.loadDailyClimateModel({ scanStart, scanEndHard, climatePolicy: climateResolution.effective }); // CHANGED
        formState.dailyClimate = dailyClimate; // ADDED
        formState.dailyClimateKey = dailyClimateKey; // ADDED
        const scheduleEndISO = resolveScheduleInputEndISO(formState, plant, scanEndHard); // ADDED: annual display harvest dates are not hard caps.

        const inputs = new sharedCore.ScheduleInputs({ // CHANGED
            plant,
            city,
            planningMode,
            methodCategoryId: resolvedBehavior.methodCategoryId, // CHANGED
            methodId: resolvedBehavior.methodId, // CHANGED
            startISO: formState.startISO,
            seasonEndISO: scheduleEndISO, // FIX: use lifecycle/lifespan end, not annual latest-harvest display state.
            policy,
            seasonStartYear: formState.seasonStartYear,
            harvestWindowDays: formState.harvestWindowDays,
            minYieldMultiplier: formState.minYieldMultiplier,
            varietyId,
            varietyName,
            bedProfile: options.bedProfile || formState.bedProfile || null, // ADDED: reuse resolved bed conditions for soil gates.
            bedProfileSource: options.bedProfileSource || formState.bedProfileSource || 'generic garden bed', // ADDED
            dailyClimate // ADDED
        });

        return {
            plant,
            city,
            planningMode: resolvedBehavior.planningMode, // FIX: return the resolved planning behavior, not the method id
            methodCategoryId: resolvedBehavior.methodCategoryId,
            methodId: resolvedBehavior.methodId,
            resolvedBehavior,
            policy,
            inputs
        };
    }

    function resolveScheduleInputEndISO(formState, plant, scanEndHard) { // ADDED
        if (isPerennialPlant(plant)) return formState.seasonEndISO || fmtISO(scanEndHard); // ADDED
        return fmtISO(scanEndHard); // ADDED: annual latest-harvest display state must not constrain feasibility.
    } // ADDED

    // Convert model instance to plain {column: value} dict (primitives only)           
    function toPlainDict(obj) {
        const out = {};
        if (!obj) return out;
        for (const k of Object.keys(obj)) {
            const v = obj[k];
            if (v == null) continue;
            const t = typeof v;
            if (t === 'function') continue;
            if (t === 'object') continue;
            out[k] = v;
        }
        return out;
    }

    function asCoolingThresholdC(v) {
        if (v === null || v === undefined || v === '') return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }
    function coolingGateThresholdC(plant) {
        if (!isCrossYearCrop(plant)) return null; // FIX: heat-stress metadata must not force annual fall-only scheduling
        return asCoolingThresholdC(plant?.start_cooling_threshold_c); // FIX
    }



    // helper near your other date utils
    function dateFromDOY(year, doy) {
        const d0 = Date.UTC(year, 0, 1);
        return new Date(d0 + (Math.max(1, Math.floor(doy)) - 1) * 86400000);
    }


    const METHOD_BEHAVIOR = Object.freeze({ // CHANGED
        "transplant.indoor": Object.freeze({ // CHANGED
            methodCategoryId: "transplant", // CHANGED
            planningMode: "transplant_indoor", // CHANGED
            usesSoilTempGate: true, // CHANGED
            leadDaysMode: "days_transplant" // CHANGED
        }), // CHANGED
        "transplant.outdoor": Object.freeze({ // CHANGED
            methodCategoryId: "transplant", // CHANGED
            planningMode: "transplant_outdoor", // CHANGED
            usesSoilTempGate: true, // CHANGED
            leadDaysMode: "none" // CHANGED
        }), // CHANGED
        "transplant.purchased": Object.freeze({ // CHANGED
            methodCategoryId: "transplant", // CHANGED
            planningMode: "transplant_outdoor", // CHANGED
            usesSoilTempGate: true, // CHANGED
            leadDaysMode: "none" // CHANGED
        }), // CHANGED
        "transplant.cutting": Object.freeze({ // CHANGED
            methodCategoryId: "transplant", // CHANGED
            planningMode: "transplant_indoor", // CHANGED
            usesSoilTempGate: true, // CHANGED
            leadDaysMode: "days_transplant" // CHANGED
        }), // CHANGED
        "direct_sow.field": Object.freeze({ // CHANGED
            methodCategoryId: "direct_sow", // CHANGED
            planningMode: "direct_sow", // CHANGED
            usesSoilTempGate: true, // CHANGED
            leadDaysMode: "none" // CHANGED
        }), // CHANGED
        "direct_sow.pre_germinated": Object.freeze({ // CHANGED
            methodCategoryId: "direct_sow", // CHANGED
            planningMode: "direct_sow", // CHANGED
            usesSoilTempGate: true, // CHANGED
            leadDaysMode: "none" // CHANGED
        }), // CHANGED
        "direct_sow.plug": Object.freeze({ // CHANGED
            methodCategoryId: "direct_sow", // CHANGED
            planningMode: "transplant_outdoor", // CHANGED
            usesSoilTempGate: true, // CHANGED
            leadDaysMode: "none" // CHANGED
        }) // CHANGED
    }); // CHANGED

    function resolveMethodBehavior({ methodCategoryId, methodId }) { // CHANGED
        const category = normId(methodCategoryId); // FIX
        const id = normId(methodId); // FIX

        if (!category) throw new Error("methodCategoryId is required."); // CHANGED
        if (!id) throw new Error("methodId is required."); // CHANGED

        const behavior = METHOD_BEHAVIOR[id]; // CHANGED
        if (!behavior) throw new Error(`Unsupported methodId: ${id}`); // CHANGED

        if (behavior.methodCategoryId !== category) { // CHANGED
            throw new Error(`methodId "${id}" does not belong to methodCategoryId "${category}".`); // CHANGED
        } // CHANGED

        if (!id.startsWith(category + ".")) { // CHANGED
            throw new Error(`methodId "${id}" must begin with "${category}."`); // CHANGED
        } // CHANGED

        return { // CHANGED
            methodCategoryId: category, // CHANGED
            methodId: id, // CHANGED
            planningMode: behavior.planningMode, // CHANGED
            usesSoilTempGate: !!behavior.usesSoilTempGate, // CHANGED
            leadDaysMode: String(behavior.leadDaysMode || "none") // CHANGED
        }; // CHANGED
    } // CHANGED

    function resolveValidMethodRecord(methodRow, fallbackMethodCategoryId = '') { // FIX: validate DB method rows consistently
        const methodCategoryId = normId(
            methodRow?.method_category_id ?? fallbackMethodCategoryId ?? ''
        );
        const methodId = normId(methodRow?.method_id);
        return resolveMethodBehavior({ methodCategoryId, methodId });
    }

    function validateAutoWindowMethodInputs({ resolvedBehavior, daysTransplant }) { // CHANGED
        if (!resolvedBehavior || typeof resolvedBehavior !== "object") { // CHANGED
            throw new Error("resolvedBehavior is required."); // CHANGED
        } // CHANGED

        if (resolvedBehavior.leadDaysMode === "days_transplant") { // CHANGED
            const dt = Number(daysTransplant); // CHANGED
            if (!Number.isFinite(dt) || dt <= 0) { // CHANGED
                throw new Error(`methodId "${resolvedBehavior.methodId}" requires daysTransplant > 0.`); // CHANGED
            } // CHANGED
        } // CHANGED
    } // CHANGED


    async function resolveInitialMethodSelection(cell, plant) {
        const cellMethodCategoryId = normId(cell?.getAttribute?.('method_category_id')); // FIX
        const cellMethodId = normId(cell?.getAttribute?.('method_id')); // FIX
    
        // 1) Prefer fully-specified cell selection
        if (cellMethodCategoryId && cellMethodId) {
            try {
                const resolved = resolveMethodBehavior({
                    methodCategoryId: cellMethodCategoryId,
                    methodId: cellMethodId
                });
    
                return {
                    methodCategoryId: resolved.methodCategoryId,
                    methodId: resolved.methodId,
                    resolvedBehavior: resolved
                };
            } catch (_) {
                // fall through
            }
        }
    
        // 2) Plant default planting method
        const defaultMethodId = normId(plant?.default_planting_method); // FIX
        if (defaultMethodId) {
            try { // FIX: an invalid plant default must not block the scheduler
                const methodRow = await PlantModel.getMethodById(defaultMethodId);
                if (methodRow) {
                    const resolved = resolveValidMethodRecord(methodRow);
                    return {
                        methodCategoryId: resolved.methodCategoryId,
                        methodId: resolved.methodId,
                        resolvedBehavior: resolved
                    };
                }
            } catch (e) {
                console.warn('[Scheduler] Ignoring invalid plant default method', {
                    plantId: plant?.plant_id,
                    methodId: defaultMethodId,
                    reason: e?.message || String(e)
                }); // FIX
            }
        }
    
        // 3) First allowed category + first method in that category
        let allowedCategories = [];
        try {
            allowedCategories = await PlantModel.listAllowedMethodCategoriesForPlant(Number(plant?.plant_id));
        } catch (e) {
            console.warn('[Scheduler] Unable to load allowed method categories', {
                plantId: plant?.plant_id,
                reason: e?.message || String(e)
            }); // FIX
        }
        for (const cat of (allowedCategories || [])) {
            const methodCategoryId = normId(cat?.method_category_id); // FIX
            if (!methodCategoryId) continue;

            try { // FIX: skip invalid categories and method records independently
                const methods = await PlantModel.listMethodsForMethodCategory(methodCategoryId);
                for (const methodRow of (methods || [])) {
                    try {
                        const resolved = resolveValidMethodRecord(methodRow, methodCategoryId);
                        return {
                            methodCategoryId: resolved.methodCategoryId,
                            methodId: resolved.methodId,
                            resolvedBehavior: resolved
                        };
                    } catch (e) {
                        console.warn('[Scheduler] Skipping invalid allowed method record', {
                            plantId: plant?.plant_id,
                            methodCategoryId,
                            methodId: methodRow?.method_id,
                            reason: e?.message || String(e)
                        }); // FIX
                    }
                }
            } catch (e) {
                console.warn('[Scheduler] Skipping invalid allowed method category', {
                    plantId: plant?.plant_id,
                    methodCategoryId,
                    reason: e?.message || String(e)
                }); // FIX
            }
        }
    
        // 4) Final hard fallback
        const resolved = resolveMethodBehavior({
            methodCategoryId: 'direct_sow',
            methodId: 'direct_sow.field'
        });
    
        return {
            methodCategoryId: resolved.methodCategoryId,
            methodId: resolved.methodId,
            resolvedBehavior: resolved
        };
    }















































    // -------------------- Graph helpers ----------------------------------------------------
    function setAttr(cell, k, v) {
        const nextValue = v == null ? '' : String(v);
        const val = cell && cell.value;
        if (!val || !val.setAttribute) return;
        if (cell.getAttribute && String(cell.getAttribute(k) ?? '') === nextValue) return;

        const model = graph && typeof graph.getModel === 'function' ? graph.getModel() : null;
        if (model && typeof model.execute === 'function' && typeof mxCellAttributeChange === 'function') {
            model.execute(new mxCellAttributeChange(cell, k, nextValue));
        } else {
            val.setAttribute(k, nextValue);
        }
    }
    function getAttr(cell, k) { return cell && cell.getAttribute ? cell.getAttribute(k) : null; }
    function isTilerGroup(cell) { return !!cell && cell.getAttribute && cell.getAttribute('tiler_group') === '1'; }
    function isGardenBedCell(cell) {
        return !!cell && cell.getAttribute && (
            cell.getAttribute('garden_bed') === '1' ||
            cell.getAttribute('gardenBed') === '1' ||
            cell.getAttribute('is_garden_bed') === '1'
        ); // ADDED: scheduler can reuse existing bed-condition cells without a schema change.
    }
    function cellCenterPoint(cell) {
        const model = graph && graph.getModel ? graph.getModel() : null;
        const geo = model && cell ? model.getGeometry(cell) : null;
        if (!geo) return null;
        return { x: Number(geo.x || 0) + Number(geo.width || 0) / 2, y: Number(geo.y || 0) + Number(geo.height || 0) / 2 };
    }
    function pointInCellBounds(point, cell) {
        const model = graph && graph.getModel ? graph.getModel() : null;
        const geo = model && cell ? model.getGeometry(cell) : null;
        if (!point || !geo) return false;
        const x = Number(geo.x || 0), y = Number(geo.y || 0), w = Number(geo.width || 0), h = Number(geo.height || 0);
        return point.x >= x && point.x <= x + w && point.y >= y && point.y <= y + h;
    }
    function findContainingBedForScheduleCell(cell) {
        const model = graph && graph.getModel ? graph.getModel() : null;
        if (!model || !cell) return null;
        for (let cur = cell; cur; cur = model.getParent(cur)) {
            if (isGardenBedCell(cur)) return cur;
        }
        const parent = model.getParent(cell);
        const point = cellCenterPoint(cell);
        const siblings = parent && graph.getChildVertices ? graph.getChildVertices(parent) : [];
        let chosen = null, chosenArea = Infinity;
        (siblings || []).forEach(function (candidate) {
            if (!isGardenBedCell(candidate) || !pointInCellBounds(point, candidate)) return;
            const geo = model.getGeometry(candidate);
            const area = Math.max(0, Number(geo?.width || 0)) * Math.max(0, Number(geo?.height || 0));
            if (area > 0 && area < chosenArea) { chosen = candidate; chosenArea = area; }
        });
        return chosen;
    }
    function resolveScheduleBedContext(cell) {
        const bed = findContainingBedForScheduleCell(cell);
        const bedsApi = typeof window !== 'undefined' ? window.TrellisGardenBeds : null;
        if (bed && bedsApi && typeof bedsApi.readBedConditions === 'function') {
            return {
                profile: normalizeBedProfile(bedsApi.readBedConditions(bed)),
                source: `garden bed${bed.id ? ' ' + bed.id : ''}`
            }; // ADDED: use configured bed conditions when available.
        }
        return { profile: normalizeBedProfile(null), source: 'generic garden bed' }; // ADDED
    }
    // --- helpers: find garden module ancestor & scoped board lookup ---
    function isGardenModule(cell) {
        return !!(cell && cell.getAttribute && cell.getAttribute('garden_module') === '1');
    }
    function findGardenModuleAncestor(model, cell) {
        if (!cell) return null;
        const m = model;
        let cur = cell;
        while (cur) {
            if (isGardenModule(cur)) return cur;
            cur = m.getParent(cur);
        }
        return null;
    }
    function defaultGroupStyle() {
        return [
            'shape=rectangle', 'strokeColor=#2563eb', 'dashed=1', 'fillColor=none',
            'dashPattern=3 3', 'fontSize=12', 'align=center', 'verticalAlign=top',
            'resizable=1', 'movable=1', 'deletable=1', 'editable=0', 'whiteSpace=nowrap', 'html=0'
        ].join(';');
    }
    function createXmlValue(tag, attrs) {
        const doc = mxUtils.createXmlDocument();
        const node = doc.createElement(tag);
        Object.keys(attrs || {}).forEach(k => node.setAttribute(k, String(attrs[k])));
        return node;
    }
    function applyPlantSpacingToGroup(groupCell, plantRow) {
        if (!groupCell || !plantRow) return;

        const sx = plantRow.spacing_x_cm;
        const sy = plantRow.spacing_y_cm;
        const s = plantRow.spacing_cm;
        const vd = plantRow.veg_diameter_cm;

        const hasVal = (v) => v !== undefined && v !== null && v !== '';

        // Derive canonical spacing X/Y: prefer explicit x/y, fall back to spacing_cm    
        let spacingX = hasVal(sx) ? sx : (hasVal(s) ? s : null);
        let spacingY = hasVal(sy) ? sy : (hasVal(s) ? s : null);

        if (hasVal(spacingX)) {
            setAttr(groupCell, 'spacing_x_cm', spacingX);
        }
        if (hasVal(spacingY)) {
            setAttr(groupCell, 'spacing_y_cm', spacingY);
        }
        if (hasVal(s)) {
            setAttr(groupCell, 'spacing_cm', s);
        }

        if (hasVal(vd)) {
            setAttr(groupCell, 'veg_diameter_cm', vd);
        }
    }

    function retileAndFitGroupIfAvailable(graph, groupCell, opts = {}) { // CHANGE
        const tiler = window.USL && window.USL.tiler ? window.USL.tiler : null; // CHANGE
        const fit = tiler && typeof tiler.retileAndFitToContainingBed === 'function' ? tiler.retileAndFitToContainingBed : null; // CHANGE
        if (fit) return fit(graph, groupCell, opts); // CHANGE
        const retile = tiler && typeof tiler.retileGroup === 'function' ? tiler.retileGroup : null; // CHANGE
        if (retile) retile(graph, groupCell); // CHANGE
        return null; // CHANGE
    } // CHANGE






































































    // -------------------- UI bits (small DOM helpers) --------------------------------------
    function row(labelText, controlEl) {
        const wrap = document.createElement('div');
        wrap.className = 'usl-scheduler-row'; // CHANGE
        wrap.style.display = 'flex';
        wrap.style.alignItems = 'center';
        wrap.style.gap = '8px';
        wrap.style.margin = '6px 0';
        const lab = document.createElement('label');
        lab.className = 'usl-scheduler-row-label'; // CHANGE
        lab.textContent = labelText;
        lab.style.display = 'inline-block';
        lab.style.minWidth = '180px';
        wrap.appendChild(lab);
        wrap.appendChild(controlEl);
        return { row: wrap, label: lab, control: controlEl };
    }
    function makeSelect(options, initialValue) {
        const sel = document.createElement('select');
        sel.style.width = '100%'; sel.style.padding = '6px';
        options.forEach(o => {
            const opt = document.createElement('option');
            opt.value = o.value; opt.textContent = o.label;
            sel.appendChild(opt);
        });
        if (initialValue != null) sel.value = String(initialValue);
        return sel;
    }
    function normalizeCityGeoText(value) { // ADDED
        return String(value == null ? '' : value).trim(); // ADDED
    } // ADDED
    function cityCountryLabel(city) { // ADDED
        return normalizeCityGeoText(city?.country_name) || normalizeCityGeoText(city?.country_code) || 'Uncategorized'; // ADDED
    } // ADDED
    function cityRegionLabel(city) { // ADDED
        const name = normalizeCityGeoText(city?.region_name); // ADDED
        const code = normalizeCityGeoText(city?.region_code); // ADDED
        if (name && code && name.toLowerCase() !== code.toLowerCase()) return `${name} (${code})`; // ADDED
        return name || code || 'Uncategorized'; // ADDED
    } // ADDED
    function cityDisplayLabel(city) { // ADDED
        return normalizeCityGeoText(city?.city_name) || '(unnamed city)'; // ADDED
    } // ADDED
    function citySearchText(city) { // ADDED
        return [cityDisplayLabel(city), cityCountryLabel(city), cityRegionLabel(city), normalizeCityGeoText(city?.country_code), normalizeCityGeoText(city?.region_code)].join(' ').toLowerCase(); // ADDED
    } // ADDED
    function sortedCities(cities) { // ADDED
        return (cities || []).slice().sort((a, b) => { // ADDED
            const av = [cityCountryLabel(a), cityRegionLabel(a), cityDisplayLabel(a)].join('\u0000').toLowerCase(); // ADDED
            const bv = [cityCountryLabel(b), cityRegionLabel(b), cityDisplayLabel(b)].join('\u0000').toLowerCase(); // ADDED
            return av.localeCompare(bv); // ADDED
        }); // ADDED
    } // ADDED
    function makeCityTreePicker(cities, initialValue) { // ADDED
        let cityRows = sortedCities(cities); // ADDED
        let currentValue = String(initialValue || (cityRows[0]?.city_id ?? cityRows[0]?.city_name ?? '')); // ADDED
        let isOpen = false; // ADDED
        const root = document.createElement('div'); // ADDED
        root.className = 'usl-city-picker'; // ADDED
        root.tabIndex = 0; // ADDED
        root.style.position = 'relative'; // ADDED
        root.style.width = '100%'; // ADDED
        root.style.font = '12px Arial,sans-serif'; // ADDED
        const button = document.createElement('button'); // ADDED
        button.type = 'button'; // ADDED
        button.style.width = '100%'; // ADDED
        button.style.padding = '6px'; // ADDED
        button.style.border = '1px solid #bbb'; // ADDED
        button.style.borderRadius = '6px'; // ADDED
        button.style.background = '#fff'; // ADDED
        button.style.textAlign = 'left'; // ADDED
        button.style.font = '12px Arial,sans-serif'; // ADDED
        const panel = document.createElement('div'); // ADDED
        panel.style.position = 'absolute'; // ADDED
        panel.style.zIndex = '10000'; // ADDED
        panel.style.left = '0'; // ADDED
        panel.style.right = '0'; // ADDED
        panel.style.top = '100%'; // ADDED
        panel.style.marginTop = '3px'; // ADDED
        panel.style.padding = '6px'; // ADDED
        panel.style.border = '1px solid #bbb'; // ADDED
        panel.style.borderRadius = '6px'; // ADDED
        panel.style.background = '#fff'; // ADDED
        panel.style.boxShadow = '0 8px 20px rgba(0,0,0,0.18)'; // ADDED
        panel.style.display = 'none'; // ADDED
        const search = document.createElement('input'); // ADDED
        search.type = 'search'; // ADDED
        search.placeholder = 'Search city, country, or region'; // ADDED
        search.style.width = '100%'; // ADDED
        search.style.marginBottom = '6px'; // ADDED
        const list = document.createElement('div'); // ADDED
        list.style.maxHeight = '260px'; // ADDED
        list.style.overflow = 'auto'; // ADDED
        panel.appendChild(search); // ADDED
        panel.appendChild(list); // ADDED
        root.appendChild(button); // ADDED
        root.appendChild(panel); // ADDED

        function selectedCity() { // ADDED
            return cityRows.find(city => String(city.city_id ?? city.city_name) === currentValue) || null; // ADDED
        } // ADDED
        function updateButton() { // ADDED
            const city = selectedCity(); // ADDED
            button.textContent = city ? `${cityDisplayLabel(city)} - ${cityCountryLabel(city)} / ${cityRegionLabel(city)}` : 'Select a city...'; // ADDED
        } // ADDED
        function closePicker() { // ADDED
            isOpen = false; // ADDED
            panel.style.display = 'none'; // ADDED
        } // ADDED
        function openPicker() { // ADDED
            isOpen = true; // ADDED
            panel.style.display = 'block'; // ADDED
            renderList(); // ADDED
            search.focus(); // ADDED
        } // ADDED
        function chooseCity(city) { // ADDED
            currentValue = String(city.city_id ?? city.city_name); // ADDED
            updateButton(); // ADDED
            closePicker(); // ADDED
            root.dispatchEvent(new Event('change', { bubbles: true })); // ADDED
        } // ADDED
        function appendGroupHeader(text, level) { // ADDED
            const header = document.createElement('div'); // ADDED
            header.textContent = text; // ADDED
            header.style.fontWeight = level === 1 ? '700' : '600'; // ADDED
            header.style.margin = level === 1 ? '8px 0 3px' : '5px 0 2px 12px'; // ADDED
            header.style.color = '#374151'; // ADDED
            list.appendChild(header); // ADDED
        } // ADDED
        function appendCity(city) { // ADDED
            const item = document.createElement('button'); // ADDED
            item.type = 'button'; // ADDED
            item.textContent = cityDisplayLabel(city); // ADDED
            item.style.display = 'block'; // ADDED
            item.style.width = '100%'; // ADDED
            item.style.margin = '1px 0'; // ADDED
            item.style.padding = '4px 6px 4px 24px'; // ADDED
            item.style.border = '0'; // ADDED
            item.style.borderRadius = '4px'; // ADDED
            item.style.background = String(city.city_id ?? city.city_name) === currentValue ? '#e5f0ff' : '#fff'; // ADDED
            item.style.textAlign = 'left'; // ADDED
            item.style.font = '12px Arial,sans-serif'; // ADDED
            item.addEventListener('click', () => chooseCity(city)); // ADDED
            list.appendChild(item); // ADDED
        } // ADDED
        function renderList() { // ADDED
            const filter = String(search.value || '').trim().toLowerCase(); // ADDED
            const visible = cityRows.filter(city => !filter || citySearchText(city).indexOf(filter) >= 0); // ADDED
            list.innerHTML = ''; // ADDED
            if (!visible.length) { // ADDED
                const empty = document.createElement('div'); // ADDED
                empty.textContent = 'No matching cities'; // ADDED
                empty.style.color = '#6b7280'; // ADDED
                empty.style.padding = '6px'; // ADDED
                list.appendChild(empty); // ADDED
                return; // ADDED
            } // ADDED
            let lastCountry = null; // ADDED
            let lastRegion = null; // ADDED
            visible.forEach(city => { // ADDED
                const country = cityCountryLabel(city); // ADDED
                const region = cityRegionLabel(city); // ADDED
                if (country !== lastCountry) { // ADDED
                    appendGroupHeader(country, 1); // ADDED
                    lastCountry = country; // ADDED
                    lastRegion = null; // ADDED
                } // ADDED
                if (region !== lastRegion) { // ADDED
                    appendGroupHeader(region, 2); // ADDED
                    lastRegion = region; // ADDED
                } // ADDED
                appendCity(city); // ADDED
            }); // ADDED
        } // ADDED
        Object.defineProperty(root, 'value', { // ADDED
            get() { return currentValue; }, // ADDED
            set(value) { currentValue = String(value || ''); updateButton(); } // ADDED
        }); // ADDED
        root.setCities = function (nextCities, selectedValue) { // ADDED
            cityRows = sortedCities(nextCities); // ADDED
            currentValue = String(selectedValue || (cityRows[0]?.city_id ?? cityRows[0]?.city_name ?? '')); // ADDED
            updateButton(); // ADDED
            renderList(); // ADDED
        }; // ADDED
        button.addEventListener('click', () => { isOpen ? closePicker() : openPicker(); }); // ADDED
        search.addEventListener('input', renderList); // ADDED
        search.addEventListener('keydown', evt => { // ADDED
            if (evt.key === 'Escape') { evt.preventDefault(); closePicker(); button.focus(); } // ADDED
            if (evt.key === 'Enter') { // ADDED
                const first = cityRows.find(city => !search.value || citySearchText(city).indexOf(String(search.value).trim().toLowerCase()) >= 0); // ADDED
                if (first) { evt.preventDefault(); chooseCity(first); } // ADDED
            } // ADDED
        }); // ADDED
        document.addEventListener('mousedown', evt => { if (isOpen && !root.contains(evt.target)) closePicker(); }); // ADDED
        updateButton(); // ADDED
        renderList(); // ADDED
        return root; // ADDED
    } // ADDED
    function makeNumber(initial, { min = null } = {}) {
        const el = document.createElement('input'); el.type = 'number';
        el.value = String(initial ?? 0); if (min != null) el.min = String(min);
        return el;
    }
    function makeCheckbox(initialChecked, disabled = false) {
        const el = document.createElement('input'); el.type = 'checkbox';
        el.checked = !!initialChecked; el.disabled = !!disabled;
        return el;
    }
    function makeDate(valueISO, disabled = true) {
        const el = document.createElement('input'); el.type = 'date';
        el.value = valueISO; el.disabled = !!disabled;
        return el;
    }

    function makeNullableNumber(initial, { min = null, step = null } = {}) {
        const el = document.createElement('input');
        el.type = 'number';
        el.value = (initial == null || initial === '') ? '' : String(initial);
        if (min != null) el.min = String(min);
        if (step != null) el.step = String(step);
        el.style.width = '100%'; el.style.padding = '6px';
        return el;
    }

    function readNullableNumber(inputEl) {
        const s = String(inputEl?.value ?? '').trim();
        if (s === '') return null;
        const n = Number(s);
        if (!Number.isFinite(n)) throw new Error('Invalid number');
        return n;
    }

    function readIntGE0(inputEl) {
        const n = Number(String(inputEl?.value ?? '').trim());
        if (!Number.isFinite(n) || n < 0) throw new Error('Expected integer >= 0');
        return Math.trunc(n);
    }

    function readNumGE0(inputEl) {
        const n = Number(String(inputEl?.value ?? '').trim());
        if (!Number.isFinite(n) || n < 0) throw new Error('Expected number >= 0');
        return n;
    }


    // -------------------- View helpers (schema → rows, layout) --------------------------  
    function buildFieldRows(schema, rowFactory = row) {
        const fieldRows = {};
        const ordered = [];
        schema.forEach(def => {
            const r = rowFactory(def.label, def.control);
            if (def.tooltip) { setTooltip(r.label, def.tooltip); setTooltip(def.control, def.tooltip); } // ADDED
            fieldRows[def.key] = r;
            ordered.push({ key: def.key, row: r.row, meta: def, view: r });
        });
        return { fieldRows, ordered };
    }

    function appendFieldRows(container, fieldRows, keys) {
        keys.forEach(k => {
            const fr = fieldRows[k];
            if (fr && fr.row) container.appendChild(fr.row);
        });
    }

    function encodeMethodSelection(methodCategoryId, methodId) { // ADDED
        return JSON.stringify([normId(methodCategoryId), normId(methodId)]); // ADDED
    } // ADDED

    function decodeMethodSelection(value) { // ADDED
        try { // ADDED
            const parsed = JSON.parse(String(value || '')); // ADDED
            if (!Array.isArray(parsed) || parsed.length !== 2) return null; // ADDED
            const methodCategoryId = normId(parsed[0]); // ADDED
            const methodId = normId(parsed[1]); // ADDED
            if (!methodCategoryId || !methodId) return null; // ADDED
            return { methodCategoryId, methodId }; // ADDED
        } catch (_) { // ADDED
            return null; // ADDED
        } // ADDED
    } // ADDED

    function humanFeasibilityReason(reason) { // ADDED
        const raw = String(reason || '').trim(); // ADDED
        if (!raw || raw === 'ok') return 'Feasible'; // ADDED
        if (raw === 'outside_scan_window') return 'The selected date is outside the planning season.'; // ADDED
        if (raw === 'gate_outside_scan_window') return 'The planting or transplant date falls outside the planning season.'; // ADDED
        if (raw.indexOf('spring_frost_gate') === 0) return 'The planting date is before the frost-safety date.'; // ADDED
        if (raw === 'cooling_gate') return 'The crop requires a later seasonal cooling trigger.'; // ADDED
        if (raw === 'soil_gate_missing_date') return 'A soil-temperature check could not be evaluated.'; // ADDED
        if (raw === 'soil_gate') return 'The soil is expected to be too cold on this date.'; // ADDED
        if (raw === 'insufficient_gdd') return 'There is not enough growing-degree accumulation to reach maturity.'; // ADDED
        if (raw === 'cross_year_disallowed') return 'This planting would extend into another year.'; // ADDED
        if (raw === 'beyond_hard_end') return 'There is not enough season remaining for the harvest window.'; // ADDED
        if (raw.indexOf('harvest_too_cold') === 0) return 'Expected harvest temperatures are too cold.'; // ADDED
        if (raw.indexOf('harvest_too_hot') === 0) return 'Expected harvest temperatures are too hot.'; // ADDED
        if (raw.indexOf('error:') === 0) return raw.slice(6).trim() || 'The feasibility check failed.'; // ADDED
        return raw.replace(/_/g, ' '); // ADDED
    } // ADDED

    function normalizeSowingSeason(window) { // ADDED
        if (!window) return null; // ADDED
        const startISO = String(window.startISO || '').trim(); // ADDED
        const endISO = String(window.endISO || '').trim(); // ADDED
        if (!parseISODateUTCValue(startISO) || !parseISODateUTCValue(endISO)) return null; // ADDED
        return { // ADDED
            id: String(window.id || '').trim() || `${startISO}_${endISO}`, // ADDED
            label: String(window.label || '').trim() || `${startISO} to ${endISO}`, // ADDED
            startISO, // ADDED
            endISO, // ADDED
            diagnostics: Array.isArray(window.diagnostics) ? window.diagnostics.slice() : [], // ADDED
            riskSummary: String(window.riskSummary || '').trim(), // ADDED
            source: window.source || null // ADDED
        }; // ADDED
    } // ADDED
    function normalizeSowingSeasons(windows) { // ADDED
        return (Array.isArray(windows) ? windows : []).map(normalizeSowingSeason).filter(Boolean); // ADDED
    } // ADDED
    function getActiveSowingSeason(formState) { // ADDED
        const windows = normalizeSowingSeasons(formState?.sowingSeasons); // ADDED
        const activeId = String(formState?.activeSowingSeasonId || '').trim(); // ADDED
        return windows.find(window => window.id === activeId) || null; // ADDED
    } // ADDED
    function sowDateInWindow(startISO, window) { // ADDED
        const selected = parseISODateUTCValue(startISO); // ADDED
        const earliest = parseISODateUTCValue(window?.startISO); // ADDED
        const latest = parseISODateUTCValue(window?.endISO); // ADDED
        return !!(selected && earliest && latest && selected >= earliest && selected <= latest); // ADDED
    } // ADDED
    function findSowingSeasonForDate(windows, startISO) { // ADDED
        return normalizeSowingSeasons(windows).find(window => sowDateInWindow(startISO, window)) || null; // ADDED
    } // ADDED
    function formatSowingSeasonsSummary(windows) { // ADDED
        const normalized = normalizeSowingSeasons(windows); // ADDED
        if (!normalized.length) return 'No feasible sowing seasons.'; // ADDED
        return normalized.map(window => { // CHANGED
            const risk = window.riskSummary ? ` [${window.riskSummary}]` : ''; // ADDED
            const details = (window.diagnostics || []).slice(0, 6).map(diagnostic => diagnostic?.message).filter(Boolean); // ADDED
            return `${window.label}: ${window.startISO} to ${window.endISO}${risk}${details.length ? `\n  ${details.join('\n  ')}` : ''}`; // CHANGED
        }).join('\n'); // CHANGED
    } // ADDED
    function buildSowingSeasonSelectorState({ // ADDED
        sowingSeasons = [], // ADDED
        activeSowingSeasonId = '', // ADDED
        startISO = '' // ADDED
    } = {}) { // ADDED
        const windows = normalizeSowingSeasons(sowingSeasons); // ADDED
        const options = []; // ADDED
        if (isOrphanSowingSeasonId(activeSowingSeasonId)) { // ADDED
            const suffix = startISO ? ` (${startISO})` : ''; // ADDED
            options.push({ value: ORPHAN_SOWING_SEASON_ID, label: `Saved date outside seasons${suffix}`, disabled: true }); // ADDED
        } // ADDED
        if (!windows.length && !options.length) { // CHANGED
            options.push({ value: '', label: 'No feasible sowing season', disabled: false }); // ADDED
        } else { // ADDED
            windows.forEach(window => options.push({ value: window.id, label: window.riskSummary ? `${window.label} - ${window.riskSummary}` : window.label, disabled: false })); // CHANGED
        } // ADDED
        const activeWindow = windows.find(window => window.id === String(activeSowingSeasonId || '').trim()) || null; // ADDED
        const selectedValue = options.some(option => option.value === activeSowingSeasonId) ? String(activeSowingSeasonId || '') : ''; // ADDED
        return { // ADDED
            options, // ADDED
            value: selectedValue, // ADDED
            activeWindow, // ADDED
            boundsText: activeWindow ? `${activeWindow.startISO} to ${activeWindow.endISO}` : '' // ADDED
        }; // ADDED
    } // ADDED
    function pickDefaultSowingSeasonId(windows, { savedStartISO = '', todayISO = '' } = {}) { // ADDED
        const normalized = normalizeSowingSeasons(windows); // ADDED
        if (!normalized.length) return ''; // ADDED
        const savedWindow = findSowingSeasonForDate(normalized, savedStartISO); // ADDED
        if (savedWindow) return savedWindow.id; // ADDED
        const today = parseISODateUTCValue(todayISO); // ADDED
        if (today) { // ADDED
            const futureWindow = normalized.find(window => { // ADDED
                const end = parseISODateUTCValue(window.endISO); // ADDED
                return end && end >= today; // ADDED
            }); // ADDED
            if (futureWindow) return futureWindow.id; // ADDED
        } // ADDED
        return normalized[0].id; // ADDED
    } // ADDED
    function resolveStartForSowingSeasonSwitch(windows, activeSowingSeasonId, currentStartISO = '') { // CHANGED
        const activeWindow = normalizeSowingSeasons(windows).find(window => window.id === String(activeSowingSeasonId || '').trim()); // ADDED
        if (activeWindow && sowDateInWindow(currentStartISO, activeWindow)) return String(currentStartISO || '').trim(); // ADDED
        return activeWindow ? activeWindow.startISO : ''; // ADDED
    } // ADDED
    function classifySelectedSowDate({ // CHANGED
        perennial = false, // CHANGED
        windowFeasible = false, // CHANGED
        startISO = '', // CHANGED
        sowingSeasons = [], // ADDED
        activeSowingSeasonId = '' // ADDED
    } = {}) { // CHANGED
        if (perennial) return { status: 'not_applicable', label: 'Not applicable for perennial planting dates.' }; // CHANGED
        if (!windowFeasible || !normalizeSowingSeasons(sowingSeasons).length) return { status: 'no_window', label: 'No feasible sowing season is available.' }; // CHANGED
        const selected = parseISODateUTCValue(startISO); // CHANGED
        if (!selected) return { status: 'missing', label: 'Select a sow date.' }; // CHANGED
        if (isOrphanSowingSeasonId(activeSowingSeasonId)) return { status: 'outside_window', label: 'The saved sow date is outside the selectable sowing seasons.' }; // ADDED
        const activeWindow = normalizeSowingSeasons(sowingSeasons).find(window => window.id === String(activeSowingSeasonId || '').trim()); // ADDED
        if (!activeWindow) return { status: 'no_active_window', label: 'Select a sowing season.' }; // ADDED
        if (!sowDateInWindow(startISO, activeWindow)) { // CHANGED
            const otherWindow = findSowingSeasonForDate(sowingSeasons, startISO); // ADDED
            if (otherWindow) return { status: 'window_mismatch', label: `The selected sow date belongs to ${otherWindow.label}, not ${activeWindow.label}.` }; // ADDED
            return { status: 'outside_window', label: 'The selected sow date is outside the selected sowing season.' }; // CHANGED
        } // CHANGED
        return { status: 'feasible', label: `The selected sow date is in ${activeWindow.label}.` }; // CHANGED
    } // CHANGED
    function summarizeScheduleWarnings(warnings) { // ADDED
        const list = Array.isArray(warnings) ? warnings.filter(warning => warning && warning.message) : []; // ADDED
        if (!list.length) return ''; // ADDED
        return list.map(warning => String(warning.message || '').trim()).filter(Boolean).join(' '); // ADDED
    } // ADDED
    function requireFeasibleSowingSeasonSelection(args) { // ADDED
        const classification = classifySelectedSowDate(args); // ADDED
        if (!args?.perennial && classification.status === 'missing') throw new Error(classification.label); // CHANGED
        return classification; // ADDED
    } // ADDED
    function clampPercent(value) { // ADDED
        const n = Number(value); // ADDED
        if (!Number.isFinite(n)) return 0; // ADDED
        return Math.max(0, Math.min(100, n)); // ADDED
    } // ADDED
    function timelineDaysBetween(start, end) { // ADDED
        if (!isUsableDate(start) || !isUsableDate(end)) return 0; // ADDED
        return Math.round((end.getTime() - start.getTime()) / 86400000); // ADDED
    } // ADDED
    function timelinePercentForDate(date, rangeStart, totalDays) { // ADDED
        if (!isUsableDate(date) || !isUsableDate(rangeStart) || !Number.isFinite(totalDays) || totalDays <= 0) return null; // ADDED
        return clampPercent((timelineDaysBetween(rangeStart, date) / totalDays) * 100); // ADDED
    } // ADDED
    function buildLifecycleTimelineBounds({ plant = null, seasonStartYear = null } = {}) { // ADDED
        const year = Math.round(finiteNumberOrNull(seasonStartYear) ?? new Date().getUTCFullYear()); // ADDED
        const scanYears = Math.max(1, Math.round(finiteNumberOrNull(plant ? getPlantScanYears(plant) : 1) ?? 1)); // ADDED
        const start = asUTCDate(year, 1, 1); // ADDED
        const end = asUTCDate(year + scanYears - 1, 12, 31); // ADDED
        return { start, end, startISO: fmtISO(start), endISO: fmtISO(end), multiYear: start.getUTCFullYear() !== end.getUTCFullYear() }; // ADDED
    } // ADDED
    function lifecycleTimelineLabel(stage) { // ADDED
        const labels = { // ADDED
            SOW: 'Sow', // ADDED
            GERM: 'Germ', // ADDED
            TRANSPLANT: 'Transplant', // ADDED
            MATURITY: 'Maturity', // ADDED
            HARVEST_START: 'First harvest', // ADDED
            HARVEST_END: 'Harvest end' // ADDED
        }; // ADDED
        return labels[stage] || String(stage || 'Milestone'); // ADDED
    } // ADDED
    function lifecycleTimelineDateLabel(isoValue, multiYear = false) { // ADDED
        const d = parseISODateUTCValue(isoValue); // ADDED
        if (!d) return ''; // ADDED
        const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]; // ADDED
        const base = `${month} ${d.getUTCDate()}`; // ADDED
        return multiYear ? `${base}, ${d.getUTCFullYear()}` : base; // ADDED
    } // ADDED
    function buildLifecycleTimelineAxisMarkers(bounds, totalDays) { // ADDED
        const start = bounds?.start; // ADDED
        const end = bounds?.end; // ADDED
        if (!isUsableDate(start) || !isUsableDate(end) || end < start) return { months: [], years: [] }; // ADDED
        const spanDays = Math.max(1, Number.isFinite(Number(totalDays)) ? Number(totalDays) : timelineDaysBetween(start, end)); // ADDED
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; // ADDED
        const quarterMonthIndexes = new Set([0, 3, 6, 9]); // ADDED
        const months = []; // ADDED
        const years = []; // ADDED
        const startYear = start.getUTCFullYear(); // ADDED
        const endYear = end.getUTCFullYear(); // ADDED
        for (let year = startYear; year <= endYear; year += 1) { // ADDED
            const yearDate = asUTCDate(year, 1, 1); // ADDED
            if (yearDate >= start && yearDate <= end) { // ADDED
                years.push({ // ADDED
                    iso: fmtISO(yearDate), // ADDED
                    label: String(year), // ADDED
                    percent: timelinePercentForDate(yearDate, start, spanDays) ?? 0 // ADDED
                }); // ADDED
            } // ADDED
            for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) { // ADDED
                if (!quarterMonthIndexes.has(monthIndex)) continue; // ADDED
                const monthDate = asUTCDate(year, monthIndex + 1, 1); // ADDED
                if (monthDate < start || monthDate > end) continue; // ADDED
                months.push({ // ADDED
                    iso: fmtISO(monthDate), // ADDED
                    label: monthNames[monthIndex], // ADDED
                    percent: timelinePercentForDate(monthDate, start, spanDays) ?? 0 // ADDED
                }); // ADDED
            } // ADDED
        } // ADDED
        return { months, years }; // ADDED
    } // ADDED
    function buildLifecycleTimelineMilestone(stage, dateValue, options = {}) { // ADDED
        const date = dateValue instanceof Date ? dateValue : parseISODateUTCValue(dateValue); // ADDED
        if (!date) return null; // ADDED
        return { // ADDED
            stage, // ADDED
            iso: fmtISO(date), // ADDED
            label: options.label || lifecycleTimelineLabel(stage), // ADDED
            visible: options.visible !== false, // ADDED
            taskStage: options.taskStage || null // ADDED
        }; // ADDED
    } // ADDED
    function assignLifecycleTimelineLabelRows(milestones, minGapPercent = 14, maxRows = 3) { // ADDED
        const rows = Array.from({ length: Math.max(1, maxRows) }, () => []); // ADDED
        const sorted = (Array.isArray(milestones) ? milestones : []) // ADDED
            .filter(milestone => milestone && milestone.visible && Number.isFinite(Number(milestone.percent))) // ADDED
            .slice() // ADDED
            .sort((a, b) => a.percent - b.percent); // ADDED
        sorted.forEach(milestone => { // ADDED
            let target = rows[0]; // ADDED
            for (const row of rows) { // ADDED
                const last = row[row.length - 1]; // ADDED
                if (!last || Math.abs(milestone.percent - last.percent) >= minGapPercent) { target = row; break; } // ADDED
            } // ADDED
            target.push(milestone); // ADDED
        }); // ADDED
        return rows.filter(row => row.length); // ADDED
    } // ADDED
    function buildLifecycleTimelineViewModel({ // ADDED
        plant = null, // ADDED
        perennial = false, // ADDED
        seasonStartYear = null, // ADDED
        startISO = '', // ADDED
        sowingSeasons = [], // ADDED
        scheduleResult = null, // ADDED
        todayISO = null, // ADDED
        taskRules = [], // ADDED
        generatedTasks = [] // ADDED
    } = {}) { // ADDED
        if (perennial) return { hidden: true, reason: 'perennial' }; // ADDED
        const bounds = buildLifecycleTimelineBounds({ plant, seasonStartYear }); // ADDED
        const totalDays = Math.max(1, timelineDaysBetween(bounds.start, bounds.end)); // ADDED
        const bands = normalizeSowingSeasons(sowingSeasons).map(window => { // ADDED
            const start = parseISODateUTCValue(window.startISO); // ADDED
            const end = parseISODateUTCValue(window.endISO); // ADDED
            if (!start || !end || end < bounds.start || start > bounds.end) return null; // ADDED
            const clippedStart = new Date(Math.max(start.getTime(), bounds.start.getTime())); // ADDED
            const clippedEnd = new Date(Math.min(end.getTime(), bounds.end.getTime())); // ADDED
            const left = timelinePercentForDate(clippedStart, bounds.start, totalDays); // ADDED
            const right = timelinePercentForDate(clippedEnd, bounds.start, totalDays); // ADDED
            return { // ADDED
                id: window.id, // ADDED
                label: window.label, // ADDED
                startISO: fmtISO(clippedStart), // ADDED
                endISO: fmtISO(clippedEnd), // ADDED
                leftPercent: left ?? 0, // ADDED
                widthPercent: Math.max(0.8, clampPercent((right ?? 0) - (left ?? 0))) // ADDED
            }; // ADDED
        }).filter(Boolean); // ADDED
        const firstTimeline = Array.isArray(scheduleResult?.timelines) ? scheduleResult.timelines[0] : null; // ADDED
        const sowDate = Array.isArray(scheduleResult?.schedule) ? scheduleResult.schedule[0] : parseISODateUTCValue(startISO); // ADDED
        const rawMilestones = [ // ADDED
            buildLifecycleTimelineMilestone('SOW', sowDate || startISO, { taskStage: 'SOW' }), // ADDED
            buildLifecycleTimelineMilestone('GERM', firstTimeline?.germ, { visible: false, taskStage: 'GERM' }), // ADDED
            buildLifecycleTimelineMilestone('TRANSPLANT', firstTimeline?.transplant, { taskStage: 'TRANSPLANT' }), // ADDED
            buildLifecycleTimelineMilestone('MATURITY', firstTimeline?.maturity, { visible: false }), // ADDED
            buildLifecycleTimelineMilestone('HARVEST_START', firstTimeline?.harvestStart, { taskStage: 'HARVEST_START' }), // ADDED
            buildLifecycleTimelineMilestone('HARVEST_END', firstTimeline?.harvestEnd, { taskStage: 'HARVEST_END' }) // ADDED
        ].filter(Boolean); // ADDED
        const seenStageDates = new Set(); // ADDED
        const milestones = rawMilestones.filter(milestone => { // ADDED
            const key = `${milestone.stage}:${milestone.iso}`; // ADDED
            if (seenStageDates.has(key)) return false; // ADDED
            seenStageDates.add(key); // ADDED
            return true; // ADDED
        }).map(milestone => { // ADDED
            const percent = timelinePercentForDate(parseISODateUTCValue(milestone.iso), bounds.start, totalDays); // ADDED
            const taskMatch = milestone.taskStage ? findFirstLifecycleTimelineTaskRule(taskRules, milestone.taskStage, generatedTasks) : null; // ADDED
            return { // ADDED
                ...milestone, // ADDED
                percent, // ADDED
                dateLabel: lifecycleTimelineDateLabel(milestone.iso, bounds.multiYear), // ADDED
                hasTaskRule: !!taskMatch, // ADDED
                taskRuleIndex: taskMatch ? taskMatch.originalIndex : null // ADDED
            }; // ADDED
        }).filter(milestone => Number.isFinite(Number(milestone.percent))); // ADDED
        const visibleMilestones = milestones.filter(milestone => milestone.visible); // ADDED
        const todayDate = parseISODateUTCValue(todayISO || fmtISO(new Date())); // ADDED
        const todayPercent = todayDate && todayDate >= bounds.start && todayDate <= bounds.end // ADDED
            ? timelinePercentForDate(todayDate, bounds.start, totalDays) // ADDED
            : null; // ADDED
        return { // ADDED
            hidden: false, // ADDED
            bounds, // ADDED
            totalDays, // ADDED
            bands, // ADDED
            axis: buildLifecycleTimelineAxisMarkers(bounds, totalDays), // ADDED
            milestones, // ADDED
            visibleMilestones, // ADDED
            labelRows: assignLifecycleTimelineLabelRows(visibleMilestones), // ADDED
            details: milestones.map(milestone => `${milestone.label}: ${milestone.iso}`), // ADDED
            todayISO: todayPercent == null ? null : fmtISO(todayDate), // ADDED
            todayPercent // ADDED
        }; // ADDED
    } // ADDED
    function findFirstLifecycleTimelineTaskRule(taskRules, stage, generatedTasks = []) { // ADDED
        const wanted = String(stage || '').trim(); // ADDED
        if (!wanted) return null; // ADDED
        const ordered = buildTaskRuleDisplayOrder(taskRules, generatedTasks); // ADDED
        return ordered.find(entry => normalizeTaskRule(entry.rule).startAnchorStage === wanted) || null; // ADDED
    } // ADDED
    function describeBlockingScheduleQualityDiagnostics(blockingDiagnostics) { // ADDED
        const diagnostics = Array.isArray(blockingDiagnostics) ? blockingDiagnostics : []; // ADDED
        const labels = Array.from(new Set(diagnostics.map(diagnostic => annualCore.diagnosticLabel ? annualCore.diagnosticLabel(diagnostic) : diagnostic.factor).filter(Boolean))); // ADDED
        const messages = diagnostics.map(diagnostic => diagnostic?.message).filter(Boolean); // ADDED
        return [ // ADDED
            labels.length ? `Blocked by ${labels.join(', ')}.` : 'Blocked by schedule quality diagnostics.', // ADDED
            messages.slice(0, 3).join(' ') // ADDED
        ].filter(Boolean).join(' '); // ADDED
    }
    function requireNoBlockingScheduleQualityDiagnostics(inputs) { // ADDED
        if (!inputs || isPerennialPlant(inputs.plant)) return null; // ADDED
        const result = annualCore.evaluateSowDateDiagnostics(inputs, inputs.startISO); // ADDED
        if (result.blockingDiagnostics && result.blockingDiagnostics.length) { // ADDED
            throw new Error(describeBlockingScheduleQualityDiagnostics(result.blockingDiagnostics)); // ADDED
        } // ADDED
        return result; // ADDED
    }

    function buildScheduleViewState({ // ADDED
        perennial = false, // ADDED
        windowFeasible = false, // ADDED
        plantName = '', // ADDED
        varietyName = '', // ADDED
        cityName = '', // ADDED
        seasonStartYear = '', // ADDED
        methodName = '', // ADDED
        startISO = '', // ADDED
        sowingSeasons = [], // CHANGED
        activeSowingSeasonId = '', // ADDED
        firstHarvestISO = '', // ADDED
        lastHarvestISO = '', // CHANGED
        scheduleWarnings = [] // ADDED
    } = {}) { // ADDED
        let feasibility = classifySelectedSowDate({ // CHANGED
            perennial, // ADDED
            windowFeasible, // ADDED
            startISO, // ADDED
            sowingSeasons, // CHANGED
            activeSowingSeasonId // ADDED
        }); // ADDED
        const warningText = summarizeScheduleWarnings(scheduleWarnings); // ADDED
        if (!perennial && warningText) { // ADDED
            feasibility = { status: 'warning', label: warningText }; // ADDED
        } // ADDED
        return { // ADDED
            crop: [plantName, varietyName].filter(Boolean).join(' / ') || '(none)', // ADDED
            context: [cityName, seasonStartYear].filter(value => String(value || '').trim()).join(' / ') || '(none)', // ADDED
            method: methodName || '(none)', // ADDED
            selectedDate: startISO || '(not selected)', // ADDED
            firstHarvest: perennial ? 'Not calculated for perennial schedules' : (firstHarvestISO || '(not available)'), // ADDED
            harvestEnd: perennial ? 'Not calculated for perennial schedules' : (lastHarvestISO || '(not available)'), // ADDED
            feasibility // ADDED
        }; // ADDED
    } // ADDED

    function renderScheduleSummary() { // ADDED
        const root = document.createElement('div'); // ADDED
        root.className = 'usl-scheduler-summary'; // CHANGE
        root.style.border = '1px solid #93c5fd'; // ADDED
        root.style.background = '#eff6ff'; // ADDED
        root.style.borderRadius = '6px'; // ADDED
        root.style.padding = '10px 12px'; // ADDED
        root.style.marginBottom = '10px'; // ADDED

        const title = document.createElement('div'); // ADDED
        title.className = 'usl-scheduler-summary-title'; // CHANGE
        title.textContent = 'Schedule summary'; // ADDED
        title.style.fontWeight = '600'; // ADDED
        title.style.marginBottom = '8px'; // ADDED
        root.appendChild(title); // ADDED

        const grid = document.createElement('div'); // ADDED
        grid.className = 'usl-scheduler-summary-grid'; // CHANGE
        grid.style.display = 'grid'; // ADDED
        grid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(220px, 1fr))'; // ADDED
        grid.style.gap = '6px 16px'; // ADDED
        root.appendChild(grid); // ADDED

        const fields = {}; // ADDED
        [ // ADDED
            ['crop', 'Plant / variety'], // ADDED
            ['context', 'City / year'], // ADDED
            ['method', 'Planting method'], // ADDED
            ['selectedDate', 'Selected sow or planting date'], // ADDED
            ['firstHarvest', 'Expected first harvest'], // ADDED
            ['harvestEnd', 'Expected harvest end'], // ADDED
            ['feasibility', 'Feasibility'] // ADDED
        ].forEach(([key, label]) => { // ADDED
            const item = document.createElement('div'); // ADDED
            item.className = 'usl-scheduler-summary-item'; // CHANGE
            const labelEl = document.createElement('div'); // ADDED
            labelEl.className = 'usl-scheduler-summary-label'; // CHANGE
            labelEl.textContent = label; // ADDED
            labelEl.style.fontSize = '11px'; // ADDED
            labelEl.style.color = '#4b5563'; // ADDED
            const valueEl = document.createElement('div'); // ADDED
            valueEl.className = 'usl-scheduler-summary-value'; // CHANGE
            valueEl.style.fontSize = '12px'; // ADDED
            valueEl.style.fontWeight = key === 'feasibility' ? '600' : '400'; // ADDED
            item.appendChild(labelEl); // ADDED
            item.appendChild(valueEl); // ADDED
            grid.appendChild(item); // ADDED
            fields[key] = valueEl; // ADDED
        }); // ADDED

        return { root, fields }; // ADDED
    } // ADDED

    function updateScheduleSummary(summaryView, viewState) { // ADDED
        if (!summaryView?.fields || !viewState) return; // ADDED
        summaryView.fields.crop.textContent = viewState.crop; // ADDED
        summaryView.fields.context.textContent = viewState.context; // ADDED
        summaryView.fields.method.textContent = viewState.method; // ADDED
        summaryView.fields.selectedDate.textContent = viewState.selectedDate; // ADDED
        summaryView.fields.firstHarvest.textContent = viewState.firstHarvest; // ADDED
        summaryView.fields.harvestEnd.textContent = viewState.harvestEnd; // ADDED
        summaryView.fields.feasibility.textContent = viewState.feasibility.label; // ADDED
        summaryView.fields.feasibility.style.color = viewState.feasibility.status === 'feasible' // ADDED
            ? '#166534' // ADDED
            : (viewState.feasibility.status === 'warning' ? '#92400e' : (viewState.feasibility.status === 'not_applicable' ? '#374151' : '#b91c1c')); // CHANGED
    } // ADDED

    // Scans season feasibility day-by-day.
    async function explainFeasibilityOverSeason(inputs, maxDays = null, stopAtFirstOk = false, options = {}) { // CHANGED
        const planner = new annualCore.Planner(inputs); // CHANGED
        const out = [];
        const scanStart = isUsableDate(options.scanStartDate) ? options.scanStartDate : planner.ctx.scanStart; // ADDED
        const scanEnd = isUsableDate(options.scanEndDate) ? options.scanEndDate : planner.ctx.scanEndHard; // ADDED
        const spanDays = Math.max(0, Math.ceil((scanEnd.getTime() - scanStart.getTime()) / 86400000) + 1); // CHANGED
        const scanLimit = Number.isFinite(Number(maxDays)) && Number(maxDays) > 0 ? Math.min(Math.floor(Number(maxDays)), spanDays) : spanDays; // FIX: callers may now request a first-season-only explain scan.
        let d = new Date(scanStart); // FIX: explain scans from the requested diagnostic start, even when selected start is blank.
        for (let i = 0; i < scanLimit && d <= scanEnd; i++) { // CHANGED
            try {
                const r = planner.isSowFeasible(d);
                if (r && r.ok) {
                    out.push({
                        date: fmtISO(d),
                        ok: true,
                        reason: r.reason || 'ok',
                        maturity: fmtISO(r.maturity || null),
                        harvestEnd: fmtISO(r.harvestEnd || null),
                        TmeanHarvest: Number.isFinite(r.TmeanHarvest) ? r.TmeanHarvest.toFixed(1) : ''
                    });
                    if (stopAtFirstOk) break;
                } else {
                    out.push({
                        date: fmtISO(d),
                        ok: false,
                        reason: (r && r.reason) ? r.reason : 'unknown'
                    });
                }
            } catch (e) {
                out.push({ date: fmtISO(d), ok: false, reason: 'error:' + (e?.message || 'unknown') });
            }
            d = addDaysUTC(d, 1);
        }
        return out;
    }

    function compressFeasibilityScanRanges(rows) {
        const ranges = [];
        (rows || []).forEach(function (row) {
            if (!row || !row.date) return;
            const normalized = normalizeFeasibilityReason(row);
            const last = ranges[ranges.length - 1];
            if (last && last.ok === normalized.ok && last.reason === normalized.reason && isNextISODate(last.end, row.date)) {
                last.end = row.date;
                last.days += 1;
                last.last = row;
                last.lastDetail = normalized.detail;
                return;
            }
            ranges.push({
                start: row.date,
                end: row.date,
                days: 1,
                ok: normalized.ok,
                reason: normalized.reason,
                label: normalized.label,
                firstDetail: normalized.detail,
                lastDetail: normalized.detail,
                first: row,
                last: row
            });
        });
        return ranges.map(function (range) {
            const out = {
                start: range.start,
                end: range.end,
                days: range.days,
                ok: range.ok,
                reason: range.reason,
                label: range.label
            };
            if (range.firstDetail || range.lastDetail) {
                out.first_detail = range.firstDetail || '';
                out.last_detail = range.lastDetail || '';
                out.detail = range.firstDetail === range.lastDetail
                    ? (range.firstDetail || '')
                    : [range.firstDetail, range.lastDetail].filter(Boolean).join(' -> ');
            }
            if (range.ok) {
                out.first_maturity = range.first?.maturity || '';
                out.last_maturity = range.last?.maturity || '';
                out.first_harvest_end = range.first?.harvestEnd || '';
                out.last_harvest_end = range.last?.harvestEnd || '';
            }
            return out;
        });
    }

    function normalizeFeasibilityReason(row) {
        if (row && row.ok) return { ok: true, reason: 'ok', detail: '', label: 'Feasible' };
        const raw = String(row?.reason || 'unknown').trim();
        const match = raw.match(/^([A-Za-z0-9_]+)\((.*)\)$/);
        if (match) {
            return { ok: false, reason: match[1], detail: match[2], label: compactFeasibilityReasonLabel(match[1]) };
        }
        if (raw.indexOf('error:') === 0) {
            return { ok: false, reason: 'error', detail: raw.slice(6).trim(), label: 'The feasibility check failed.' };
        }
        return { ok: false, reason: raw || 'unknown', detail: '', label: compactFeasibilityReasonLabel(raw) };
    }

    function compactFeasibilityReasonLabel(reason) {
        const raw = String(reason || '').trim();
        if (raw === 'ok') return 'Feasible';
        if (raw === 'spring_frost_gate') return 'Before frost-safety date.';
        if (raw === 'soil_gate') return 'Soil below planting threshold.';
        if (raw === 'insufficient_gdd') return 'Not enough remaining heat to reach maturity.';
        if (raw === 'harvest_too_cold') return 'Expected harvest temperatures are too cold.';
        if (raw === 'harvest_too_hot') return 'Expected harvest temperatures are too hot.';
        return humanFeasibilityReason(raw);
    }

    function formatFeasibilityScanRanges(rows) {
        const ranges = compressFeasibilityScanRanges(rows);
        if (!ranges.length) return 'scan_not_run: no daily feasibility rows were produced';
        return ranges.map(function (range) {
            const dateText = range.start === range.end ? range.start : `${range.start} to ${range.end}`;
            const parts = [
                `${dateText} (${range.days} day${range.days === 1 ? '' : 's'})`,
                range.ok ? 'ok' : range.reason,
                range.label
            ];
            if (range.detail) parts.push(`detail ${range.detail}`);
            if (range.ok) {
                parts.push(`maturity ${range.first_maturity || 'n/a'} -> ${range.last_maturity || 'n/a'}`);
                parts.push(`harvest end ${range.first_harvest_end || 'n/a'} -> ${range.last_harvest_end || 'n/a'}`);
            }
            return parts.join(' | ');
        }).join('\n');
    }

    function buildFeasibilityBlockingSummary(inputs, rows) {
        const ranges = compressFeasibilityScanRanges(rows);
        if (!ranges.length) return 'Blocking sequence:\n- scan_not_run: no daily feasibility rows were produced';
        const blockers = ranges.filter(range => !range.ok);
        if (!blockers.length) return 'Feasible sowing range found.\nBlocking sequence:\n- none';
        const primary = findPrimaryFeasibilityBlocker(blockers);
        const derived = inputs.derived();
        const budget = inputs.plant.firstHarvestBudget();
        const gddDiagnostics = derived.dailyRates?.__diagnostics || {}; // ADDED
        const cropAnnualGdd = finiteNumberOrNull(gddDiagnostics.scaledCropAnnualGdd) ?? annualGddFromMonthlyMeans(derived.monthlyAvg, derived.env.Tbase, derived.year, 0); // CHANGED
        const lines = [ranges.some(range => range.ok) ? 'Feasible sowing range found.' : 'No feasible sowing season found.', 'Blocking sequence:'];
        blockers.forEach(function (range) {
            const dateText = range.start === range.end ? range.start : `${range.start} to ${range.end}`;
            lines.push(`- ${dateText}: ${range.reason} (${range.label})`);
        });
        if (primary) {
            lines.push(`Primary blocker after frost/soil readiness: ${primary.reason}`);
            if (primary.reason === 'insufficient_gdd' && budget.mode === 'gdd') {
                lines.push(`GDD check: crop needs ${Number(budget.amount).toFixed(1)} GDD; calibrated crop-base estimate is ${Number(cropAnnualGdd).toFixed(1)} GDD.`);
            }
        }
        return lines.join('\n');
    }

    function findPrimaryFeasibilityBlocker(blockers) {
        if (!blockers || !blockers.length) return null;
        return blockers.find(range => !['spring_frost_gate', 'soil_gate'].includes(range.reason)) || blockers[0];
    }

    function isNextISODate(leftISO, rightISO) {
        const left = parseISODateUTCValue(leftISO);
        const right = parseISODateUTCValue(rightISO);
        return !!left && !!right && addDaysUTC(left, 1).getTime() === right.getTime();
    }

    function effectiveHardEndForDiagnostics(inputs, derived) { // ADDED
        if (!isPerennialPlant(inputs?.plant)) { // ADDED
            return { date: derived.scanEndHard, source: inputs?.policy?.overwinterAllowed ? 'overwinter scan end' : 'lifecycle scan end' }; // FIX: annual latest-harvest display dates are not hard caps.
        } // ADDED
        if (inputs?.policy?.overwinterAllowed) { // ADDED
            return { date: derived.scanEndHard, source: 'overwinter scan end' }; // ADDED
        } // ADDED
        if (isUsableDate(derived.seasonEnd) && derived.seasonEnd <= derived.scanEndHard) { // ADDED
            return { date: derived.seasonEnd, source: 'season end' }; // ADDED
        } // ADDED
        return { date: derived.scanEndHard, source: 'scan end fallback' }; // ADDED
    } // ADDED

    function buildFeasibilityDiagnosticsModel(inputs, rows, options = {}) { // CHANGED: share diagnostics data between text output and the explain dialog UI.
        const plant = inputs.plant;
        const city = inputs.city;
        const derived = inputs.derived();
        const budget = plant.firstHarvestBudget();
        const calibration = typeof city.gddCalibration === 'function'
            ? city.gddCalibration(derived.year)
            : solveGddTemperatureOffset({
                monthlyAvgTemp: city.monthlyMeans(),
                targetGdd: city.gdd_annual,
                gddBaseC: city.gdd_base_c,
                year: derived.year
            }); // ADDED: diagnostics can explain annual-GDD calibration even outside CityClimate.
        const rawMonthly = city.monthlyMeans();
        const gddDiagnostics = derived.dailyRates?.__diagnostics || {}; // ADDED
        const climateDiagnostics = derived.dailyClimate?.diagnostics || {}; // ADDED
        const cropAnnualGdd = finiteNumberOrNull(gddDiagnostics.scaledCropAnnualGdd) ?? annualGddFromMonthlyMeans(derived.monthlyAvg, derived.env.Tbase, derived.year, 0); // CHANGED
        const uncalibratedCropAnnualGdd = finiteNumberOrNull(gddDiagnostics.rawCropAnnualGdd) ?? annualGddFromMonthlyMeans(rawMonthly, derived.env.Tbase, derived.year, 0); // CHANGED
        const soilThreshold = finiteNumberOrNull(inputs.policy?.soilGateThresholdC);
        const firstReady = soilThreshold == null ? null : firstSoilReadyDate({
            thresholdC: soilThreshold,
            monthlyAvgTemp: derived.dailyClimate || derived.monthlyAvg, // CHANGED
            scanStart: derived.scanStart,
            scanEndHard: derived.scanEndHard,
            bedProfile: inputs.bedProfile,
            consecutiveDays: inputs.policy?.soilGateConsecutiveDays || 3
        });
        const firstFailure = (rows || []).find(row => row && row.ok === false) || null;
        const firstOk = (rows || []).find(row => row && row.ok === true) || null;
        const reasonCounts = {};
        (rows || []).forEach(function (row) {
            if (!row || row.ok) return;
            const reason = normalizeFeasibilityReason(row).reason;
            reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
        });
        const topReasons = Object.keys(reasonCounts)
            .sort((a, b) => reasonCounts[b] - reasonCounts[a])
            .slice(0, 5)
            .map(reason => `${reason}: ${reasonCounts[reason]}`);
        const scanRows = Array.isArray(rows) ? rows.length : 0;
        const scanStart = options.scanStartISO || rows?.[0]?.date || fmtISO(derived.scanStart); // CHANGED
        const scanEnd = options.scanEndISO || rows?.[rows.length - 1]?.date || fmtISO(derived.scanEndHard); // CHANGED
        const hardEnd = effectiveHardEndForDiagnostics(inputs, derived); // ADDED
        const selectedStart = parseISODateUTCValue(inputs.startISO); // FIX: invalid selected dates must not break diagnostics.
        const fmtNum = value => Number.isFinite(Number(value)) ? Number(value).toFixed(1) : 'n/a';
        const policy = inputs.policy || {}; // ADDED
        const scanLines = [ // ADDED
            options.scanLabel ? `Scan purpose: ${options.scanLabel}` : null, // ADDED
            `Scan range: ${scanStart} to ${scanEnd}, ${scanRows} day${scanRows === 1 ? '' : 's'}`,
            `Lifecycle scan end: ${fmtISO(derived.scanEndHard)}`, // ADDED
            `Effective hard end: ${fmtISO(hardEnd.date)} (${hardEnd.source})`, // ADDED
            scanRows ? null : `Scan status: scan_not_run selected start=${inputs.startISO || 'blank'} parsed=${selectedStart ? fmtISO(selectedStart) : 'invalid'}`
        ].filter(Boolean); // ADDED
        const blockingLines = buildFeasibilityBlockingSummary(inputs, rows).split('\n'); // ADDED
        const sections = [ // ADDED
            { title: 'Scan', lines: scanLines },
            { title: 'Blocking sequence', lines: blockingLines.filter(line => line !== 'Blocking sequence:') },
            {
                title: 'Soil and bed',
                lines: [
                    `Soil threshold: ${soilThreshold == null ? 'n/a' : fmtNum(soilThreshold) + ' C'}`,
                    `Estimated first soil-ready date: ${firstReady ? fmtISO(firstReady) : 'none in scan'}`,
                    `Bed model: ${inputs.bedProfileSource || 'generic garden bed'} ${JSON.stringify(normalizeBedProfile(inputs.bedProfile))}`
                ]
            },
            {
                title: 'Climate and GDD',
                lines: [
                    `Climate model: ${climateDiagnostics.source || 'city monthly normals'}; forecast blend days ${Number(climateDiagnostics.forecastBlendDays || 0)}`, // CHANGED
                    `Policy: frost ${policy.springFrostRisk || 'p50'}, normals ${policy.weatherNormalsSource || 'auto'}, soil-ready ${policy.soilGateConsecutiveDays || 3} days, GDD calibration ${policy.gddCalibrationEnabled === false ? 'disabled' : 'enabled'}`, // CHANGED
                    `Forecast weights: 0-3d ${fmtNum(policy.forecastBlendWeight0To3Days ?? 0.8)}, 4-7d ${fmtNum(policy.forecastBlendWeight4To7Days ?? 0.5)}, 8-16d ${fmtNum(policy.forecastBlendWeight8To16Days ?? 0.25)}`, // ADDED
                    `City annual GDD: ${fmtNum(calibration.targetGdd)} at base ${fmtNum(calibration.gddBaseC)} C`,
                    `Temperature calibration offset: not used; daily GDD is scaled instead`,
                    `GDD calibration scale: ${fmtNum(gddDiagnostics.gddScale || 1)}; city base-GDD ${fmtNum(gddDiagnostics.cityBaseAnnualGdd)} -> target ${policy.gddCalibrationEnabled === false ? 'disabled' : fmtNum(gddDiagnostics.targetGdd)}`, // CHANGED
                    `Bed frost-gate shift: ${sharedCore.bedFrostGateShiftDays(inputs.bedProfile)} days; bed GDD air shift: ${fmtNum(gddDiagnostics.bedAirOffsetC)} C`,
                    `Crop-base annual GDD estimate: ${fmtNum(uncalibratedCropAnnualGdd)} raw -> ${fmtNum(cropAnnualGdd)} calibrated at base ${fmtNum(derived.env.Tbase)} C`,
                    `Crop maturity target: ${budget.mode === 'gdd' ? fmtNum(budget.amount) + ' GDD' : String(Math.round(budget.amount)) + ' days'}`
                ]
            },
            {
                title: 'Outcomes',
                lines: [
                    `First failing gate: ${firstFailure ? `${firstFailure.date} ${firstFailure.reason} (${humanFeasibilityReason(firstFailure.reason)})` : 'none in scan'}`,
                    `First feasible sow date: ${firstOk ? firstOk.date : 'none in scan'}`,
                    `Failure summary: ${topReasons.length ? topReasons.join(', ') : 'none'}`
                ]
            }
        ]; // ADDED
        const textLines = [ // ADDED
            'Diagnostics:',
            ...scanLines,
            ...blockingLines,
            ...sections[2].lines,
            ...sections[3].lines,
            ...sections[4].lines
        ]; // ADDED
        return { sections, text: textLines.filter(Boolean).join('\n') }; // ADDED
    }

    function buildFeasibilityDiagnostics(inputs, rows) {
        return buildFeasibilityDiagnosticsModel(inputs, rows).text; // CHANGED: preserve the existing plain-text diagnostics contract.
    }

    function appendExplainSection(parent, titleText) { // ADDED: create consistent sections inside the explain dialog.
        const section = document.createElement('section'); // ADDED
        section.style.marginBottom = '14px'; // ADDED

        const title = document.createElement('div'); // ADDED
        title.textContent = titleText; // ADDED
        title.style.fontWeight = '600'; // ADDED
        title.style.fontSize = '13px'; // ADDED
        title.style.paddingBottom = '6px'; // ADDED
        title.style.borderBottom = '1px solid #d1d5db'; // ADDED
        title.style.marginBottom = '8px'; // ADDED
        section.appendChild(title); // ADDED

        parent.appendChild(section); // ADDED
        return section; // ADDED
    }

    function appendExplainLineList(parent, lines) { // ADDED: render diagnostic lines without losing their original wording.
        const list = document.createElement('div'); // ADDED
        list.style.display = 'grid'; // ADDED
        list.style.gridTemplateColumns = 'minmax(170px, max-content) minmax(0, 1fr)'; // ADDED
        list.style.gap = '5px 12px'; // ADDED
        list.style.fontSize = '12px'; // ADDED
        (lines || []).forEach(function (line) { // ADDED
            appendExplainDiagnosticLine(list, line); // ADDED
        }); // ADDED
        parent.appendChild(list); // ADDED
    }

    function appendExplainDiagnosticLine(parent, line) { // ADDED: split simple "Label: value" rows for readability.
        const text = String(line || ''); // ADDED
        const colonIndex = text.indexOf(':'); // ADDED
        const isBullet = text.indexOf('- ') === 0; // ADDED
        if (colonIndex > 0 && !isBullet) { // ADDED
            const label = document.createElement('div'); // ADDED
            label.textContent = text.slice(0, colonIndex); // ADDED
            label.style.color = '#4b5563'; // ADDED
            label.style.fontWeight = '600'; // ADDED
            const value = document.createElement('div'); // ADDED
            value.textContent = text.slice(colonIndex + 1).trim(); // ADDED
            value.style.minWidth = '0'; // ADDED
            value.style.overflowWrap = 'anywhere'; // ADDED
            parent.appendChild(label); // ADDED
            parent.appendChild(value); // ADDED
            return; // ADDED
        }

        const row = document.createElement('div'); // ADDED
        row.textContent = text; // ADDED
        row.style.gridColumn = '1 / -1'; // ADDED
        row.style.overflowWrap = 'anywhere'; // ADDED
        if (isBullet) row.style.paddingLeft = '12px'; // ADDED
        parent.appendChild(row); // ADDED
    }

    function appendExplainDiagnostics(parent, diagnosticsModel, titleText = 'Diagnostics') { // CHANGED: render grouped diagnostics in the explain dialog.
        const section = appendExplainSection(parent, titleText); // CHANGED
        (diagnosticsModel.sections || []).forEach(function (group) { // ADDED
            const groupEl = document.createElement('div'); // ADDED
            groupEl.style.marginBottom = '10px'; // ADDED
            const groupTitle = document.createElement('div'); // ADDED
            groupTitle.textContent = group.title; // ADDED
            groupTitle.style.fontWeight = '600'; // ADDED
            groupTitle.style.fontSize = '12px'; // ADDED
            groupTitle.style.marginBottom = '5px'; // ADDED
            groupEl.appendChild(groupTitle); // ADDED
            appendExplainLineList(groupEl, group.lines); // ADDED
            section.appendChild(groupEl); // ADDED
        }); // ADDED
    }

    function appendExplainScanRanges(parent, ranges, titleText = 'Feasibility scan ranges') { // CHANGED: render compressed feasibility ranges as a table.
        const section = appendExplainSection(parent, titleText); // CHANGED
        if (!ranges.length) { // ADDED
            const empty = document.createElement('div'); // ADDED
            empty.textContent = 'scan_not_run: no daily feasibility rows were produced'; // ADDED
            empty.style.fontSize = '12px'; // ADDED
            empty.style.color = '#92400e'; // ADDED
            empty.style.background = '#fffbeb'; // ADDED
            empty.style.border = '1px solid #f59e0b'; // ADDED
            empty.style.padding = '8px'; // ADDED
            section.appendChild(empty); // ADDED
            return; // ADDED
        }

        const wrap = document.createElement('div'); // ADDED
        wrap.style.overflowX = 'auto'; // ADDED
        const table = document.createElement('table'); // ADDED
        table.style.borderCollapse = 'collapse'; // ADDED
        table.style.width = '100%'; // ADDED
        table.style.minWidth = '840px'; // ADDED
        table.style.fontSize = '12px'; // ADDED
        const headers = ['Date range', 'Days', 'Status', 'Reason', 'Detail', 'Maturity', 'Harvest end']; // ADDED
        const thead = document.createElement('thead'); // ADDED
        const headRow = document.createElement('tr'); // ADDED
        headers.forEach(function (header) { // ADDED
            const th = document.createElement('th'); // ADDED
            th.textContent = header; // ADDED
            th.style.border = '1px solid #ddd'; // ADDED
            th.style.padding = '6px 8px'; // ADDED
            th.style.background = '#f3f4f6'; // ADDED
            th.style.fontWeight = '600'; // ADDED
            th.style.textAlign = 'left'; // ADDED
            headRow.appendChild(th); // ADDED
        }); // ADDED
        thead.appendChild(headRow); // ADDED
        table.appendChild(thead); // ADDED

        const tbody = document.createElement('tbody'); // ADDED
        ranges.forEach(function (range) { // ADDED
            const dateText = range.start === range.end ? range.start : `${range.start} to ${range.end}`; // ADDED
            const values = [ // ADDED
                dateText,
                `${range.days}`,
                range.ok ? 'Feasible' : 'Blocked',
                range.ok ? 'ok' : range.reason,
                range.detail || '',
                range.ok ? `${range.first_maturity || 'n/a'} -> ${range.last_maturity || 'n/a'}` : '',
                range.ok ? `${range.first_harvest_end || 'n/a'} -> ${range.last_harvest_end || 'n/a'}` : ''
            ]; // ADDED
            const tr = document.createElement('tr'); // ADDED
            values.forEach(function (value, index) { // ADDED
                const td = document.createElement('td'); // ADDED
                td.textContent = value; // ADDED
                td.style.border = '1px solid #eee'; // ADDED
                td.style.padding = '6px 8px'; // ADDED
                td.style.verticalAlign = 'top'; // ADDED
                td.style.overflowWrap = index === 4 ? 'anywhere' : 'normal'; // ADDED
                if (index === 2) td.style.fontWeight = '600'; // ADDED
                if (index === 2) td.style.color = range.ok ? '#166534' : '#92400e'; // ADDED
                tr.appendChild(td); // ADDED
            }); // ADDED
            tbody.appendChild(tr); // ADDED
        }); // ADDED
        table.appendChild(tbody); // ADDED
        wrap.appendChild(table); // ADDED
        section.appendChild(wrap); // ADDED
    }

    function formatScheduleQualityDiagnosticRanges(ranges) { // ADDED
        const normalized = Array.isArray(ranges) ? ranges : []; // ADDED
        if (!normalized.length) return 'No schedule quality diagnostics.'; // ADDED
        return normalized.map(range => { // ADDED
            const observed = range.observedMin == null && range.observedMax == null
                ? 'n/a'
                : (range.observedMin === range.observedMax ? String(range.observedMin) : `${range.observedMin} to ${range.observedMax}`); // ADDED
            const messages = (range.messages || []).filter(Boolean).join(' | '); // ADDED
            return `${range.label || range.factor}: ${range.startISO} to ${range.endISO}; severity=${range.severity}; policy=${range.policy}; stage=${range.stage}; threshold=${range.threshold ?? 'n/a'}; observed=${observed}${messages ? `; ${messages}` : ''}`; // ADDED
        }).join('\n'); // ADDED
    }

    function appendScheduleQualityDiagnosticRanges(parent, ranges) { // ADDED
        const section = appendExplainSection(parent, 'Schedule quality diagnostic ranges'); // ADDED
        if (!ranges || !ranges.length) { // ADDED
            const empty = document.createElement('div'); // ADDED
            empty.textContent = 'No heat, photoperiod, chilling, or missing-data diagnostics were produced.'; // ADDED
            empty.style.fontSize = '12px'; // ADDED
            empty.style.color = '#166534'; // ADDED
            section.appendChild(empty); // ADDED
            return; // ADDED
        } // ADDED
        const wrap = document.createElement('div'); // ADDED
        wrap.style.overflowX = 'auto'; // ADDED
        const table = document.createElement('table'); // ADDED
        table.style.borderCollapse = 'collapse'; // ADDED
        table.style.width = '100%'; // ADDED
        table.style.minWidth = '860px'; // ADDED
        table.style.fontSize = '12px'; // ADDED
        const headers = ['Sow date range', 'Risk', 'Severity', 'Policy', 'Stage', 'Threshold', 'Observed', 'Details']; // ADDED
        const thead = document.createElement('thead'); // ADDED
        const headRow = document.createElement('tr'); // ADDED
        headers.forEach(header => { // ADDED
            const th = document.createElement('th'); // ADDED
            th.textContent = header; // ADDED
            th.style.border = '1px solid #ddd'; // ADDED
            th.style.padding = '6px 8px'; // ADDED
            th.style.background = '#f3f4f6'; // ADDED
            th.style.fontWeight = '600'; // ADDED
            th.style.textAlign = 'left'; // ADDED
            headRow.appendChild(th); // ADDED
        }); // ADDED
        thead.appendChild(headRow); // ADDED
        table.appendChild(thead); // ADDED
        const tbody = document.createElement('tbody'); // ADDED
        ranges.forEach(range => { // ADDED
            const observed = range.observedMin == null && range.observedMax == null
                ? ''
                : (range.observedMin === range.observedMax ? String(range.observedMin) : `${range.observedMin} to ${range.observedMax}`); // ADDED
            const values = [ // ADDED
                range.startISO === range.endISO ? range.startISO : `${range.startISO} to ${range.endISO}`, // ADDED
                range.label || range.factor || '', // ADDED
                range.severity || '', // ADDED
                range.policy || '', // ADDED
                range.stage || '', // ADDED
                range.threshold == null ? '' : String(range.threshold), // ADDED
                observed, // ADDED
                (range.messages || []).join(' | ') // ADDED
            ]; // ADDED
            const tr = document.createElement('tr'); // ADDED
            values.forEach((value, index) => { // ADDED
                const td = document.createElement('td'); // ADDED
                td.textContent = value; // ADDED
                td.style.border = '1px solid #eee'; // ADDED
                td.style.padding = '6px 8px'; // ADDED
                td.style.verticalAlign = 'top'; // ADDED
                td.style.overflowWrap = index === 7 ? 'anywhere' : 'normal'; // ADDED
                if (index === 2) td.style.color = value === 'block' ? '#b91c1c' : (value === 'warning' ? '#92400e' : '#4b5563'); // ADDED
                tr.appendChild(td); // ADDED
            }); // ADDED
            tbody.appendChild(tr); // ADDED
        }); // ADDED
        table.appendChild(tbody); // ADDED
        wrap.appendChild(table); // ADDED
        section.appendChild(wrap); // ADDED
    }

    function appendExplainPreSection(parent, title, text) { // ADDED: keep raw plant and city dictionaries available.
        const section = appendExplainSection(parent, title); // ADDED
        const pre = document.createElement('pre'); // ADDED
        pre.textContent = text; // ADDED
        pre.style.margin = '0'; // ADDED
        pre.style.padding = '8px'; // ADDED
        pre.style.background = '#f9fafb'; // ADDED
        pre.style.border = '1px solid #e5e7eb'; // ADDED
        pre.style.overflow = 'auto'; // ADDED
        pre.style.maxHeight = '220px'; // ADDED
        pre.style.fontSize = '12px'; // ADDED
        section.appendChild(pre); // ADDED
    }

    async function copyExplainTextToClipboard(text) { // ADDED: copy works in browsers that expose clipboard APIs.
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') { // ADDED
            await navigator.clipboard.writeText(text); // ADDED
            return; // ADDED
        }
        fallbackCopyExplainText(text); // ADDED
    }

    function fallbackCopyExplainText(text) { // ADDED: support draw.io desktop webviews without navigator.clipboard.
        const textarea = document.createElement('textarea'); // ADDED
        textarea.value = text; // ADDED
        textarea.setAttribute('readonly', 'readonly'); // ADDED
        textarea.style.position = 'fixed'; // ADDED
        textarea.style.left = '-9999px'; // ADDED
        textarea.style.top = '0'; // ADDED
        document.body.appendChild(textarea); // ADDED
        textarea.select(); // ADDED
        try { // ADDED
            if (!document.execCommand('copy')) throw new Error('Copy command was not accepted.'); // ADDED
        } finally { // ADDED
            document.body.removeChild(textarea); // ADDED
        }
    }

    function renderExplainSowingRangeDialog(ui, diagnosticsModel, ranges, plantText, cityText, fullText, options = {}) { // CHANGED: structured explain dialog renderer.
        const div = document.createElement('div'); // ADDED
        div.style.boxSizing = 'border-box'; // ADDED
        div.style.display = 'flex'; // ADDED
        div.style.flexDirection = 'column'; // ADDED
        div.style.height = '100%'; // ADDED
        div.style.maxHeight = '640px'; // ADDED
        div.style.padding = '12px'; // ADDED

        const header = document.createElement('div'); // ADDED
        header.style.display = 'flex'; // ADDED
        header.style.alignItems = 'center'; // ADDED
        header.style.justifyContent = 'space-between'; // ADDED
        header.style.gap = '8px'; // ADDED
        header.style.marginBottom = '10px'; // ADDED
        const title = document.createElement('div'); // ADDED
        title.textContent = 'Explain Sowing Range'; // ADDED
        title.style.fontWeight = '600'; // ADDED
        title.style.fontSize = '14px'; // ADDED
        header.appendChild(title); // ADDED
        const copyBtn = mxUtils.button('Copy Text', async () => { // ADDED
            try { // ADDED
                await copyExplainTextToClipboard(fullText); // ADDED
                copyBtn.textContent = 'Copied'; // ADDED
                setTimeout(() => { copyBtn.textContent = 'Copy Text'; }, 1200); // ADDED
            } catch (copyError) { // ADDED
                copyBtn.textContent = 'Copy failed'; // ADDED
                copyBtn.title = copyError?.message || String(copyError); // ADDED
                setTimeout(() => { copyBtn.textContent = 'Copy Text'; }, 1600); // ADDED
            }
        }); // ADDED
        header.appendChild(copyBtn); // ADDED
        div.appendChild(header); // ADDED

        const body = document.createElement('div'); // ADDED
        body.style.flex = '1'; // ADDED
        body.style.minHeight = '0'; // ADDED
        body.style.overflow = 'auto'; // ADDED
        body.style.paddingRight = '2px'; // ADDED
        appendExplainDiagnostics(body, diagnosticsModel, options.diagnosticsTitle || 'Diagnostics'); // CHANGED
        if (options.sowingSeasonsText) appendExplainPreSection(body, 'Derived sowing seasons', options.sowingSeasonsText); // ADDED
        appendScheduleQualityDiagnosticRanges(body, options.scheduleQualityDiagnosticRanges || []); // ADDED
        appendExplainScanRanges(body, ranges, options.scanTitle || 'Feasibility scan ranges'); // CHANGED
        if (options.lifecycleDiagnosticsModel) appendExplainDiagnostics(body, options.lifecycleDiagnosticsModel, 'Lifecycle support diagnostics'); // ADDED
        if (options.lifecycleRanges) appendExplainScanRanges(body, options.lifecycleRanges, 'Lifecycle support scan ranges'); // ADDED
        appendExplainPreSection(body, 'Plant data', plantText); // ADDED
        appendExplainPreSection(body, 'City data', cityText); // ADDED
        div.appendChild(body); // ADDED

        ui.showDialog(div, 960, 640, true, true); // CHANGED
    }

    function showCommitDialog(ui, {
        container,
        width,
        height,
        modal = true,
        closable = true
    } = {}) {
        return new Promise((resolve) => {
            let settled = false;
            const originalHide = ui.hideDialog.bind(ui);

            function settle(val) {
                if (settled) return;
                settled = true;
                ui.hideDialog = originalHide;
                resolve(val);
            }

            ui.hideDialog = function () {
                // Only treat it as a cancel if THIS dialog is the active one                   
                const active = ui.dialog && ui.dialog.container;
                const isThis = active === container || container.contains(active);
                try {
                    originalHide();
                } finally {
                    if (isThis) settle(null);
                }
            };

            // commit channel                                                                    
            container.__commit = (val) => {
                settle(val);
                // Close after settling; hideDialog wrapper is already restored                 
                try { originalHide(); } catch (_) { }
            };

            // explicit cancel channel (optional, but clearer at call sites)                      
            container.__cancel = () => {
                ui.hideDialog();
            };

            ui.showDialog(container, width, height, modal, closable);
        });
    }

    function renderPreviewTable(ui, rows) {
        const div = document.createElement('div');
        div.style.padding = '12px';
        div.style.maxWidth = '840px';
        div.style.maxHeight = '70vh';
        div.style.overflow = 'auto';

        const title = document.createElement('div');
        title.textContent = 'Schedule Preview';
        title.style.fontWeight = '600';
        title.style.marginBottom = '8px';
        div.appendChild(title);

        const table = document.createElement('table');
        table.style.borderCollapse = 'collapse';
        table.style.width = '100%';

        const headers = [
            'Plant', 'Method',
            'Sow', 'Germ', 'Transplant', 'Harvest Start', 'Harvest End',
            'Yield Multiplier', 'Plants Required'
        ];
        const thead = document.createElement('thead');
        const trh = document.createElement('tr');
        headers.forEach(h => {
            const th = document.createElement('th');
            th.textContent = h;
            th.style.border = '1px solid #ddd';
            th.style.padding = '6px 8px';
            th.style.background = '#f3f4f6';
            th.style.fontWeight = '600';
            th.style.textAlign = 'left';
            trh.appendChild(th);
        });
        thead.appendChild(trh);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        rows.forEach(r => {
            const tr = document.createElement('tr');
            [
                r.plant, r.method,
                r.sow, r.germ, r.trans, r.harvStart, r.harvEnd,
                r.mult, r.plantsReq
            ].forEach(val => {
                const td = document.createElement('td');
                td.textContent = String(val ?? '');
                td.style.border = '1px solid #eee';
                td.style.padding = '6px 8px';
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);

        div.appendChild(table);

        const btns = document.createElement('div');
        btns.style.marginTop = '12px';
        btns.style.textAlign = 'right';
        const closeBtn = mxUtils.button('Close', () => ui.hideDialog());
        btns.appendChild(closeBtn);
        div.appendChild(btns);

        ui.showDialog(div, 860, 480, true, true);
    }

    function renderPerennialPreview(ui, result) { // FIX: preview perennials without annual stage columns
        const div = document.createElement('div');
        div.style.padding = '12px';
        div.style.width = '420px';

        const title = document.createElement('div');
        title.textContent = 'Perennial Lifespan Preview';
        title.style.fontWeight = '600';
        title.style.marginBottom = '10px';
        div.appendChild(title);

        [
            ['Plant', result?.plant?.plant_name || ''],
            ['Planting date', result?.lifespanStartISO || ''],
            ['Lifespan end', result?.lifespanEndISO || '']
        ].forEach(([label, value]) => div.appendChild(row(label + ':', makeDisplayValue(value)).row));

        const btns = document.createElement('div');
        btns.style.marginTop = '12px';
        btns.style.textAlign = 'right';
        btns.appendChild(mxUtils.button('Close', () => ui.hideDialog()));
        div.appendChild(btns);
        ui.showDialog(div, 440, 240, true, true);

        function makeDisplayValue(value) {
            const span = document.createElement('span');
            span.textContent = String(value || '');
            return span;
        }
    }



























    async function openPlantEditorDialog(ui, { mode, plantId = null, varietyId = null, startVarietyMode = null } = {}) {

        console.group('[PlantEditorDialog] OPEN');
        console.log('params:', { mode, plantId, varietyId, startVarietyMode });
        console.log('isEdit:', mode === 'edit');
        console.groupEnd();

        const isEdit = mode === 'edit';
        let existing = null;
        if (isEdit) {
            console.log('[PlantEditorDialog] loading plant for edit:', plantId);
            existing = await PlantModel.loadById(Number(plantId));
        }

        function showErrorInline(msg) {
            errorBar.textContent = String(msg || 'Unknown error');
            errorBar.style.display = '';
        }

        function parsePositiveId(v) {
            if (v === null || v === undefined) return null;
            const s = String(v).trim();
            if (!s) return null;
            const n = Number(s);
            if (!Number.isFinite(n) || n <= 0) return null;
            return n;
        }

        const initialPlantId = parsePositiveId(plantId);
        const initialVarietyId = parsePositiveId(varietyId);

        const initialStartVarietyMode = (startVarietyMode === 'add' || startVarietyMode === 'edit') ? startVarietyMode : null;

        let currentPlantId = isEdit ? Number(plantId) : initialPlantId;
        let currentPlantRow = existing ? toPlainDict(existing) : null;
        let currentPlantMode = isEdit ? "edit" : (initialPlantId ? "edit" : "add");

        const NEW_PLANT_VALUE = "__NEW_PLANT__";
        const NEW_VARIETY_VALUE = "__NEW__";
        let currentVarietyMode = null; // 'add' | 'edit' | null       

        let currentVarietyId = null;
        let currentVarietyRow = null;
        let varietiesCache = [];

        const DIALOG_MODE = {
            PLANT_ADD: 'plant_add',
            PLANT_EDIT: 'plant_edit',
            VARIETY_ADD: 'variety_add',
            VARIETY_EDIT: 'variety_edit'
        }; // ADDED

        function applyDialogMode(nextMode) { // ADDED
            switch (nextMode) {
                case DIALOG_MODE.PLANT_ADD:
                    currentPlantMode = 'add';
                    currentVarietyMode = null;
                    currentVarietyId = null;
                    currentVarietyRow = null;
                    setPlantControlsEnabled(true);
                    setInlineOverridesVisible(false);
                    varietyNameRow.row.style.display = 'none';
                    break;

                case DIALOG_MODE.PLANT_EDIT:
                    currentPlantMode = 'edit';
                    currentVarietyMode = null;
                    currentVarietyId = null;
                    currentVarietyRow = null;
                    setPlantControlsEnabled(true);
                    setInlineOverridesVisible(false);
                    varietyNameRow.row.style.display = 'none';
                    break;

                case DIALOG_MODE.VARIETY_ADD:
                    currentVarietyMode = 'add';
                    currentVarietyId = null;
                    currentVarietyRow = null;
                    setPlantControlsEnabled(false);
                    setInlineOverridesVisible(true);
                    varietyNameRow.row.style.display = 'flex';
                    refreshInlineBaseHints();
                    break;

                case DIALOG_MODE.VARIETY_EDIT:
                    currentVarietyMode = 'edit';
                    setPlantControlsEnabled(false);
                    setInlineOverridesVisible(true);
                    varietyNameRow.row.style.display = 'flex';
                    refreshInlineBaseHints();
                    break;

                default:
                    throw new Error(`Unknown dialog mode: ${nextMode}`);
            }

            syncSaveButtonLabel();
        } // ADDED

        const div = document.createElement('div');
        div.style.padding = '12px';
        div.style.width = '640px';
        div.style.maxHeight = '70vh';
        div.style.overflow = 'auto';

        const title = document.createElement('div');
        title.textContent = isEdit ? 'Edit plant' : 'Add plant';
        title.style.fontWeight = '600';
        title.style.marginBottom = '10px';
        div.appendChild(title);

        // -------------------- DB helpers (local) --------------------
        async function listActiveMethodCategories() {
            const sql = `
              SELECT method_category_id, method_category_name
              FROM PlantingMethodCategories
              ORDER BY CASE
                         WHEN TRIM(method_category_id) = LOWER(TRIM(method_category_id)) THEN 0
                         ELSE 1
                       END,
                       LOWER(TRIM(method_category_id)),
                       method_category_name;`;
            const rows = await queryAll(sql, []);
            const seen = new Set(); // FIX
            return rows.flatMap(category => {
                const methodCategoryId = normId(category.method_category_id);
                if (!methodCategoryId || seen.has(methodCategoryId)) return [];
                seen.add(methodCategoryId);
                return [{ ...category, method_category_id: methodCategoryId }];
            });
        }


        async function listAllowedmethodCategoryIdsForPlant(pid) {
            const sql = `
              SELECT method_category_id
              FROM PlantAllowedMethodCategories
              WHERE plant_id = ?;`;
            try {
                const rows = await queryAll(sql, [pid]);
                return rows.map(r => normId(r.method_category_id)).filter(Boolean); // FIX
            } catch (_) {
                // legacy fallback unchanged
                const row = await PlantModel.loadById(Number(pid));
                const p = row ? toPlainDict(row) : null;
                const out = [];
                if (p?.direct_sow === 1) out.push('direct_sow');
                if (p?.transplant === 1) out.push('transplant');
                return out;
            }
        }

        async function fetchMethodsForAllowedMethodCategories(methodCategoryIds) {
            if (!methodCategoryIds || methodCategoryIds.length === 0) return [];
            const placeholders = methodCategoryIds.map(() => '?').join(',');
            const sql = `
              SELECT method_id, method_name, method_category_id, tasks_required_json
              FROM PlantingMethods
              WHERE LOWER(TRIM(method_category_id)) IN (${placeholders})
              ORDER BY CASE
                         WHEN TRIM(method_id) = LOWER(TRIM(method_id)) THEN 0
                         ELSE 1
                       END,
                       LOWER(TRIM(method_id)),
                       method_name;`;
            const rows = await queryAll(sql, methodCategoryIds.map(normId));
            const seen = new Set(); // FIX
            return rows.flatMap(method => {
                const methodId = normId(method.method_id);
                if (!methodId || seen.has(methodId)) return [];
                seen.add(methodId);
                return [{
                    ...method,
                    method_id: methodId,
                    method_category_id: normId(method.method_category_id)
                }];
            });
        }


        async function listPlantsBasic() {
            const sql = `
        SELECT plant_id, plant_name
        FROM Plants
        ORDER BY plant_name;`;
            return await queryAll(sql, []);
        }

        async function listVarietiesForPlant(pid) {
            // ASSUMPTION: table name PlantVarieties; change if your schema differs
            const sql = `
        SELECT variety_id, variety_name
        FROM PlantVarieties
        WHERE plant_id = ?
        ORDER BY variety_name;`;
            try {
                return await queryAll(sql, [pid]);
            } catch (e) {
                console.warn("listVarietiesForPlant failed; check table name", e);
                return [];
            }
        }

        // -------------------- Top selectors (Plant + Variety) --------------------   
        const selectorWrap = document.createElement('div');
        selectorWrap.style.display = 'flex';
        selectorWrap.style.gap = '8px';
        selectorWrap.style.alignItems = 'center';
        selectorWrap.style.marginBottom = '10px';

        const plantSel = document.createElement('select');
        plantSel.style.padding = '6px';
        plantSel.style.flex = '1';

        const varietySel = document.createElement('select');
        varietySel.style.padding = '6px';
        varietySel.style.flex = '1';

        const addPlantBtn = mxUtils.button('Add plant', async () => {
            try {
                plantSel.value = NEW_PLANT_VALUE;
                await handlePlantEditorPlantChange(); // FIX: await the async selection workflow directly
            } catch (e) {
                showErrorInline('Add plant error: ' + (e?.message || String(e)));
            }
        });

        const addVarBtn = mxUtils.button('Add variety', async () => {
            try {
                const pid = Number(currentPlantId);
                if (!Number.isFinite(pid)) {
                    showErrorInline('Save the plant first');
                    return;
                }
                varietySel.value = NEW_VARIETY_VALUE;
                await handlePlantEditorVarietyChange(); // FIX: await the async selection workflow directly
            } catch (e) {
                showErrorInline('Add variety error: ' + (e?.message || String(e)));
            }
        });

        selectorWrap.appendChild(plantSel);
        selectorWrap.appendChild(varietySel);
        selectorWrap.appendChild(addPlantBtn);
        selectorWrap.appendChild(addVarBtn);
        div.appendChild(selectorWrap);

        // -------------------- Layout (single column; inline overrides) --------------------
        const leftCol = document.createElement('div');
        leftCol.style.minWidth = '0';
        div.appendChild(leftCol);

        // --- Identity ---
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.value = existing?.plant_name ?? '';
        nameInput.style.width = '100%';
        nameInput.style.padding = '6px';

        const abbrInput = document.createElement('input');
        abbrInput.type = 'text';
        abbrInput.value = existing?.abbr ?? '';
        abbrInput.style.width = '100%';
        abbrInput.style.padding = '6px';

        const varietyNameInput = document.createElement('input');
        varietyNameInput.type = 'text';
        varietyNameInput.value = '';
        varietyNameInput.style.width = '100%';
        varietyNameInput.style.padding = '6px';

        const varietyNameRow = row('Variety name:', varietyNameInput);
        varietyNameRow.row.style.display = 'none';

        leftCol.appendChild(row('Plant name:', nameInput).row);
        leftCol.appendChild(varietyNameRow.row);
        leftCol.appendChild(row('Abbreviation (abbr):', abbrInput).row);

        // --- Lifecycle ---
        const typeSel = makeSelect([
            { value: 'annual', label: 'Annual' },
            { value: 'biennial', label: 'Biennial' },
            { value: 'perennial', label: 'Perennial' }
        ], (existing?.perennial === 1) ? 'perennial' : (existing?.biennial === 1 ? 'biennial' : 'annual'));

        const lifespanInput = makeNullableNumber(existing?.lifespan_years ?? null, { min: 1, step: 1 });
        const overwinterChk = makeCheckbox(existing?.overwinter_ok === 1);

        const lifecycleRow = row('Lifecycle:', typeSel);
        leftCol.appendChild(lifecycleRow.row);

        const lifeRow = row('Lifespan (years):', lifespanInput);
        leftCol.appendChild(lifeRow.row);

        const overwinterRow = row('Overwinter OK:', overwinterChk);
        leftCol.appendChild(overwinterRow.row);

        function lifecycleToFixedYears(lifecycle) {
            if (lifecycle === 'annual') return 1;
            if (lifecycle === 'biennial') return 2;
            return null; // perennial is variable                                             
        }

        function syncLifecycleFields() {
            const lifecycle = typeSel.value;
            const fixed = lifecycleToFixedYears(lifecycle);

            if (fixed != null) {
                lifespanInput.value = String(fixed);
                lifespanInput.disabled = true;
                lifespanInput.min = '0';
                return;
            }

            // Perennial: enabled (unless variety-mode disables later) and min 3            
            lifespanInput.min = '3';
            const cur = Number(String(lifespanInput.value || '').trim());
            if (!Number.isFinite(cur) || cur < 3) lifespanInput.value = '3';
            lifespanInput.disabled = false;
        }

        syncLifecycleFields();
        typeSel.addEventListener('change', syncLifecycleFields);

        // --- Methods (DB-driven checkboxes) ---
        const methodsBox = document.createElement('div');
        methodsBox.style.display = 'flex';
        methodsBox.style.flexDirection = 'column';
        methodsBox.style.gap = '6px';

        leftCol.appendChild(row('Allowed methods:', methodsBox).row);

        const methodChecksById = new Map(); // method_category_id -> checkbox                      

        const categories = await listActiveMethodCategories();
        const allowedInitial = isEdit ? await listAllowedmethodCategoryIdsForPlant(Number(plantId)) : [];
        const allowedInitialSet = new Set(allowedInitial);

        for (const c of categories) {
            const chk = makeCheckbox(allowedInitialSet.has(c.method_category_id));
            methodChecksById.set(c.method_category_id, chk);
            methodsBox.appendChild(row(c.method_category_name + ':', chk).row);
        }


        function getAllowedmethodCategoryIdsFromUI() {
            const ids = [];
            for (const [mid, chk] of methodChecksById.entries()) {
                if (chk.checked) ids.push(mid);
            }
            return ids;
        }

        // --- Default planting method (filtered by allowed methods) ---
        const defaultMethodSel = document.createElement('select');
        defaultMethodSel.style.padding = '6px';
        defaultMethodSel.style.width = '100%';
        leftCol.appendChild(row('Default planting method:', defaultMethodSel).row);

        function selectDefaultMethodFromPlantRow() {
            const wanted = normId(currentPlantRow?.default_planting_method); // FIX

            if (!wanted) return;

            const valid = new Set(Array.from(defaultMethodSel.options).map(o => String(o.value)));
            if (valid.has(wanted)) {
                defaultMethodSel.value = wanted;
            } else {
                console.warn("[DefaultMethod] saved value not in options", { wanted });
            }
        }

        async function rebuildDefaultMethodOptions() {
            const allowed = getAllowedmethodCategoryIdsFromUI();
            const previous = defaultMethodSel.value;

            defaultMethodSel.innerHTML = '';

            const autoOpt = document.createElement('option');
            autoOpt.value = '';
            autoOpt.textContent = '';
            defaultMethodSel.appendChild(autoOpt);

            const methods = await fetchMethodsForAllowedMethodCategories(allowed);
            for (const m of methods) {
                const opt = document.createElement('option');
                opt.value = normId(m.method_id); // FIX
                opt.textContent = m.method_name || m.method_id;
                defaultMethodSel.appendChild(opt);
            }

            const validValues = new Set(Array.from(defaultMethodSel.options).map(o => o.value));
            const fallback = normId(currentPlantRow?.default_planting_method); // FIX

            defaultMethodSel.value = validValues.has(previous)
                ? previous
                : (validValues.has(fallback) ? fallback : '');
        }

        await rebuildDefaultMethodOptions();
        selectDefaultMethodFromPlantRow();

        for (const chk of methodChecksById.values()) {
            chk.addEventListener('change', async () => {
                await rebuildDefaultMethodOptions();
                selectDefaultMethodFromPlantRow();
            });
        }

        // -------------------- Inline override system --------------------
        function fmtBaseVal(key) {
            const v = currentPlantRow ? currentPlantRow[key] : null;
            if (v == null || v === '') return '(null)';
            return String(v);
        }

        const overrideInlineByKey = {}; // key -> { def, chk, input, wrap, baseHint }     

        function makeInlineOverrideControls(def) {
            const wrap = document.createElement('div');
            wrap.style.display = 'flex';
            wrap.style.gap = '6px';
            wrap.style.alignItems = 'center';
            wrap.style.justifyContent = 'flex-end';

            const chk = makeCheckbox(false);

            let input = null;
            if (def.type === 'bool01') input = makeCheckbox(false);
            else if (def.type === 'int_ge0') input = makeNullableNumber(null, { min: 0, step: 1 });
            else if (def.type === 'num_ge0') input = makeNullableNumber(null, { min: 0, step: def.step ?? 0.1 });
            else if (def.type === 'nullable_num') input = makeNullableNumber(null, { step: def.step ?? 0.1 });
            else {
                input = document.createElement('input');
                input.type = 'text';
            }

            if (def.type !== 'bool01') {
                input.style.width = '120px';
                input.style.padding = '6px';
            } else {
                input.style.marginLeft = '2px';
            }

            input.disabled = true;

            chk.addEventListener('change', () => {
                input.disabled = !chk.checked;
                if (!chk.checked) {
                    if (def.type === 'bool01') input.checked = false;
                    else input.value = '';
                }
            });

            const baseHint = document.createElement('span');
            baseHint.textContent = 'Base: ' + fmtBaseVal(def.key);
            baseHint.style.fontSize = '12px';
            baseHint.style.opacity = '0.75';
            baseHint.style.whiteSpace = 'nowrap';

            wrap.appendChild(chk);
            wrap.appendChild(input);
            wrap.appendChild(baseHint);

            wrap.style.display = 'none'; // hidden until variety mode
            return { wrap, chk, input, baseHint };
        }

        function attachInlineOverrideToRow(rowObj, def) {
            rowObj.row.style.display = 'flex';
            rowObj.row.style.alignItems = 'center';
            rowObj.row.style.gap = '8px';

            const o = makeInlineOverrideControls(def);
            rowObj.row.appendChild(o.wrap);

            overrideInlineByKey[def.key] = { def, chk: o.chk, input: o.input, wrap: o.wrap, baseHint: o.baseHint };
        }

        function setInlineOverridesVisible(show) {
            for (const key of Object.keys(overrideInlineByKey)) {
                overrideInlineByKey[key].wrap.style.display = show ? 'flex' : 'none';
            }
        }

        function refreshInlineBaseHints() {
            for (const key of Object.keys(overrideInlineByKey)) {
                overrideInlineByKey[key].baseHint.textContent = 'Base: ' + fmtBaseVal(key);
            }
        }

        const OVERRIDE_SCHEMA = [
            { key: 'days_maturity', type: 'int_ge0' },
            { key: 'gdd_to_maturity', type: 'num_ge0', step: 1 },
            { key: 'days_germ', type: 'int_ge0' },
            { key: 'days_transplant', type: 'int_ge0' },
            { key: 'yield_per_plant_kg', type: 'num_ge0', step: 0.001 },
            { key: 'harvest_window_days', type: 'int_ge0' },

            { key: 'soil_temp_min_plant_c', type: 'nullable_num', step: 0.1 },
            { key: 'start_cooling_threshold_c', type: 'nullable_num', step: 0.1 },
            { key: 'overwinter_ok', type: 'bool01' },

            { key: 'tbase_c', type: 'nullable_num', step: 0.1 },
            { key: 'tmin_c', type: 'nullable_num', step: 0.1 },
            { key: 'topt_low_c', type: 'nullable_num', step: 0.1 },
            { key: 'topt_high_c', type: 'nullable_num', step: 0.1 },
            { key: 'tmax_c', type: 'nullable_num', step: 0.1 },

            { key: 'establishment_temp_max_c', type: 'nullable_num', step: 0.1 }, // ADDED
            { key: 'establishment_heat_window_days', type: 'int_ge0' }, // ADDED
            { key: 'establishment_heat_policy', type: 'text' }, // ADDED
            { key: 'quality_temp_max_c', type: 'nullable_num', step: 0.1 }, // ADDED
            { key: 'heat_stress_stage', type: 'text' }, // ADDED
            { key: 'quality_heat_policy', type: 'text' }, // ADDED
            { key: 'photoperiod_response', type: 'text' }, // ADDED
            { key: 'critical_daylength_hours', type: 'nullable_num', step: 0.1 }, // ADDED
            { key: 'photoperiod_stage', type: 'text' }, // ADDED
            { key: 'photoperiod_policy', type: 'text' }, // ADDED
            { key: 'chilling_required_days', type: 'nullable_num', step: 0.1 }, // ADDED
            { key: 'chilling_required_hours', type: 'nullable_num', step: 1 }, // ADDED
            { key: 'chilling_temp_min_c', type: 'nullable_num', step: 0.1 }, // ADDED
            { key: 'chilling_temp_max_c', type: 'nullable_num', step: 0.1 }, // ADDED
            { key: 'chilling_stage', type: 'text' }, // ADDED
            { key: 'chilling_policy', type: 'text' }, // ADDED
            { key: 'diagnostic_policy', type: 'text' }, // ADDED

            { key: 'veg_height_cm', type: 'num_ge0', step: 1 },
            { key: 'veg_diameter_cm', type: 'num_ge0', step: 1 },
            { key: 'spacing_cm', type: 'num_ge0', step: 1 },
        ];

        function readOverrideValue(def, inputEl) {
            if (def.type === 'bool01') return inputEl.checked ? 1 : 0;
            if (def.type === 'int_ge0') return readIntGE0(inputEl);
            if (def.type === 'num_ge0') return readNumGE0(inputEl);
            if (def.type === 'nullable_num') return readNullableNumber(inputEl);
            if (def.type === 'text') return String(inputEl.value || '').trim() || null; // ADDED
            return null;
        }

        function applyOverridesToUI(overridesObj) {
            for (const key of Object.keys(overrideInlineByKey)) {
                const { def, chk, input } = overrideInlineByKey[key];
                const has = Object.prototype.hasOwnProperty.call(overridesObj, key);
                chk.checked = has;
                input.disabled = !has;

                if (def.type === 'bool01') input.checked = has ? (Number(overridesObj[key] ?? 0) === 1) : false;
                else input.value = has ? String(overridesObj[key] ?? '') : '';
            }
        }

        function buildOverridesFromUI() {
            const out = {};
            for (const key of Object.keys(overrideInlineByKey)) {
                const { def, chk, input } = overrideInlineByKey[key];
                if (!chk.checked) continue;
                out[key] = readOverrideValue(def, input);
            }
            return out;
        }

        // --- Maturity budget ---
        const hasGdd = Number(existing?.gdd_to_maturity ?? 0) > 0;
        const budgetModeSel = makeSelect([
            { value: 'gdd', label: 'GDD to maturity' },
            { value: 'days', label: 'Days to maturity' }
        ], hasGdd ? 'gdd' : 'days');

        const gddInput = makeNullableNumber(existing?.gdd_to_maturity ?? null, { min: 0, step: 1 });
        const daysMatInput = makeNullableNumber(existing?.days_maturity ?? null, { min: 0, step: 1 });

        leftCol.appendChild(row('Maturity budget:', budgetModeSel).row);

        const gddRow = row('GDD to maturity:', gddInput);
        leftCol.appendChild(gddRow.row);
        attachInlineOverrideToRow(gddRow, { key: 'gdd_to_maturity', type: 'num_ge0', step: 1 });

        const daysRow = row('Days to maturity:', daysMatInput);
        leftCol.appendChild(daysRow.row);
        attachInlineOverrideToRow(daysRow, { key: 'days_maturity', type: 'int_ge0' });

        function syncBudgetModeUI() {
            const mode = budgetModeSel.value;
            gddRow.row.style.display = (mode === 'gdd') ? 'flex' : 'none';
            daysRow.row.style.display = (mode === 'days') ? 'flex' : 'none';
        }

        syncBudgetModeUI();
        budgetModeSel.addEventListener('change', syncBudgetModeUI);

        // --- Timing ---
        const daysGermInput = makeNullableNumber(existing?.days_germ ?? 0, { min: 0, step: 1 });
        const daysTransInput = makeNullableNumber(existing?.days_transplant ?? 0, { min: 0, step: 1 });

        const daysGermRow = row('Days to germ:', daysGermInput);
        leftCol.appendChild(daysGermRow.row);
        attachInlineOverrideToRow(daysGermRow, { key: 'days_germ', type: 'int_ge0' });

        const daysTransRow = row('Days to transplant:', daysTransInput);
        leftCol.appendChild(daysTransRow.row);
        attachInlineOverrideToRow(daysTransRow, { key: 'days_transplant', type: 'int_ge0' });

        // --- Yield ---
        const yieldInput = makeNullableNumber(existing?.yield_per_plant_kg ?? null, { min: 0, step: 0.001 });
        const hwInput = makeNullableNumber(existing?.harvest_window_days ?? null, { min: 0, step: 1 });

        const yieldRow = row('Yield per plant (kg):', yieldInput);
        leftCol.appendChild(yieldRow.row);
        attachInlineOverrideToRow(yieldRow, { key: 'yield_per_plant_kg', type: 'num_ge0', step: 0.001 });

        const hwRow = row('Harvest window (days):', hwInput);
        leftCol.appendChild(hwRow.row);
        attachInlineOverrideToRow(hwRow, { key: 'harvest_window_days', type: 'int_ge0' });

        // --- Temperature envelope ---
        const tbaseInput = makeNullableNumber(existing?.tbase_c ?? null, { step: 0.1 });
        const tminInput = makeNullableNumber(existing?.tmin_c ?? null, { step: 0.1 });
        const toptLowInput = makeNullableNumber(existing?.topt_low_c ?? null, { step: 0.1 });
        const toptHighInput = makeNullableNumber(existing?.topt_high_c ?? null, { step: 0.1 });
        const tmaxInput = makeNullableNumber(existing?.tmax_c ?? null, { step: 0.1 });

        const tbaseRow = row('Tbase (C):', tbaseInput);
        leftCol.appendChild(tbaseRow.row);
        attachInlineOverrideToRow(tbaseRow, { key: 'tbase_c', type: 'nullable_num', step: 0.1 });

        const tminRow = row('Tmin (C):', tminInput);
        leftCol.appendChild(tminRow.row);
        attachInlineOverrideToRow(tminRow, { key: 'tmin_c', type: 'nullable_num', step: 0.1 });

        const toptLowRow = row('Topt low (C):', toptLowInput);
        leftCol.appendChild(toptLowRow.row);
        attachInlineOverrideToRow(toptLowRow, { key: 'topt_low_c', type: 'nullable_num', step: 0.1 });

        const toptHighRow = row('Topt high (C):', toptHighInput);
        leftCol.appendChild(toptHighRow.row);
        attachInlineOverrideToRow(toptHighRow, { key: 'topt_high_c', type: 'nullable_num', step: 0.1 });

        const tmaxRow = row('Tmax (C):', tmaxInput);
        leftCol.appendChild(tmaxRow.row);
        attachInlineOverrideToRow(tmaxRow, { key: 'tmax_c', type: 'nullable_num', step: 0.1 });

        // --- Gates ---
        const soilMinInput = makeNullableNumber(existing?.soil_temp_min_plant_c ?? null, { step: 0.1 });
        const coolThreshInput = makeNullableNumber(existing?.start_cooling_threshold_c ?? null, { step: 0.1 });

        const soilMinRow = row('Soil temp min plant (C):', soilMinInput);
        leftCol.appendChild(soilMinRow.row);
        attachInlineOverrideToRow(soilMinRow, { key: 'soil_temp_min_plant_c', type: 'nullable_num', step: 0.1 });

        const coolThreshRow = row('Start cooling threshold (C):', coolThreshInput);
        leftCol.appendChild(coolThreshRow.row);
        attachInlineOverrideToRow(coolThreshRow, { key: 'start_cooling_threshold_c', type: 'nullable_num', step: 0.1 });

        // --- Heat, light, and chilling diagnostics --- // ADDED
        const policyOptions = [ // ADDED
            { value: '', label: '' }, // ADDED
            { value: 'off', label: 'Off' }, // ADDED
            { value: 'warn', label: 'Warn' }, // ADDED
            { value: 'block', label: 'Block' } // ADDED
        ]; // ADDED
        const stageOptions = [ // ADDED
            { value: '', label: '' }, // ADDED
            { value: 'establishment', label: 'Establishment' }, // ADDED
            { value: 'germination', label: 'Germination' }, // ADDED
            { value: 'maturity', label: 'Maturity' }, // ADDED
            { value: 'harvest_quality', label: 'Harvest quality' }, // ADDED
            { value: 'harvest_end', label: 'Harvest end' } // ADDED
        ]; // ADDED
        const photoperiodResponseOptions = [ // ADDED
            { value: '', label: '' }, // ADDED
            { value: 'day_neutral', label: 'Day neutral' }, // ADDED
            { value: 'long_day', label: 'Long day' }, // ADDED
            { value: 'short_day', label: 'Short day' } // ADDED
        ]; // ADDED
        const establishmentMaxInput = makeNullableNumber(existing?.establishment_temp_max_c ?? null, { step: 0.1 }); // ADDED
        const establishmentDaysInput = makeNullableNumber(existing?.establishment_heat_window_days ?? null, { min: 0, step: 1 }); // ADDED
        const establishmentPolicySel = makeSelect(policyOptions, existing?.establishment_heat_policy || ''); // ADDED
        const qualityMaxInput = makeNullableNumber(existing?.quality_temp_max_c ?? null, { step: 0.1 }); // ADDED
        const heatStageSel = makeSelect(stageOptions, existing?.heat_stress_stage || ''); // ADDED
        const qualityPolicySel = makeSelect(policyOptions, existing?.quality_heat_policy || ''); // ADDED
        const photoperiodResponseSel = makeSelect(photoperiodResponseOptions, existing?.photoperiod_response || ''); // ADDED
        const criticalDaylengthInput = makeNullableNumber(existing?.critical_daylength_hours ?? null, { min: 0, step: 0.1 }); // ADDED
        const photoperiodStageSel = makeSelect(stageOptions, existing?.photoperiod_stage || ''); // ADDED
        const photoperiodPolicySel = makeSelect(policyOptions, existing?.photoperiod_policy || ''); // ADDED
        const chillingDaysInput = makeNullableNumber(existing?.chilling_required_days ?? null, { min: 0, step: 0.1 }); // ADDED
        const chillingHoursInput = makeNullableNumber(existing?.chilling_required_hours ?? null, { min: 0, step: 1 }); // ADDED
        const chillingMinInput = makeNullableNumber(existing?.chilling_temp_min_c ?? null, { step: 0.1 }); // ADDED
        const chillingMaxInput = makeNullableNumber(existing?.chilling_temp_max_c ?? null, { step: 0.1 }); // ADDED
        const chillingStageSel = makeSelect(stageOptions, existing?.chilling_stage || ''); // ADDED
        const chillingPolicySel = makeSelect(policyOptions, existing?.chilling_policy || ''); // ADDED
        const diagnosticPolicySel = makeSelect(policyOptions, existing?.diagnostic_policy || ''); // ADDED

        const establishmentMaxRow = row('Establishment max temp (C):', establishmentMaxInput); // ADDED
        rightCol.appendChild(establishmentMaxRow.row); // ADDED
        attachInlineOverrideToRow(establishmentMaxRow, { key: 'establishment_temp_max_c', type: 'nullable_num', step: 0.1 }); // ADDED
        const establishmentDaysRow = row('Establishment heat days:', establishmentDaysInput); // ADDED
        rightCol.appendChild(establishmentDaysRow.row); // ADDED
        attachInlineOverrideToRow(establishmentDaysRow, { key: 'establishment_heat_window_days', type: 'int_ge0' }); // ADDED
        const establishmentPolicyRow = row('Establishment heat policy:', establishmentPolicySel); // ADDED
        rightCol.appendChild(establishmentPolicyRow.row); // ADDED
        attachInlineOverrideToRow(establishmentPolicyRow, { key: 'establishment_heat_policy', type: 'text' }); // ADDED
        const qualityMaxRow = row('Quality max temp (C):', qualityMaxInput); // ADDED
        rightCol.appendChild(qualityMaxRow.row); // ADDED
        attachInlineOverrideToRow(qualityMaxRow, { key: 'quality_temp_max_c', type: 'nullable_num', step: 0.1 }); // ADDED
        const heatStageRow = row('Heat stress stage:', heatStageSel); // ADDED
        rightCol.appendChild(heatStageRow.row); // ADDED
        attachInlineOverrideToRow(heatStageRow, { key: 'heat_stress_stage', type: 'text' }); // ADDED
        const qualityPolicyRow = row('Quality heat policy:', qualityPolicySel); // ADDED
        rightCol.appendChild(qualityPolicyRow.row); // ADDED
        attachInlineOverrideToRow(qualityPolicyRow, { key: 'quality_heat_policy', type: 'text' }); // ADDED
        const photoperiodResponseRow = row('Photoperiod response:', photoperiodResponseSel); // ADDED
        rightCol.appendChild(photoperiodResponseRow.row); // ADDED
        attachInlineOverrideToRow(photoperiodResponseRow, { key: 'photoperiod_response', type: 'text' }); // ADDED
        const criticalDaylengthRow = row('Critical daylength (h):', criticalDaylengthInput); // ADDED
        rightCol.appendChild(criticalDaylengthRow.row); // ADDED
        attachInlineOverrideToRow(criticalDaylengthRow, { key: 'critical_daylength_hours', type: 'nullable_num', step: 0.1 }); // ADDED
        const photoperiodStageRow = row('Photoperiod stage:', photoperiodStageSel); // ADDED
        rightCol.appendChild(photoperiodStageRow.row); // ADDED
        attachInlineOverrideToRow(photoperiodStageRow, { key: 'photoperiod_stage', type: 'text' }); // ADDED
        const photoperiodPolicyRow = row('Photoperiod policy:', photoperiodPolicySel); // ADDED
        rightCol.appendChild(photoperiodPolicyRow.row); // ADDED
        attachInlineOverrideToRow(photoperiodPolicyRow, { key: 'photoperiod_policy', type: 'text' }); // ADDED
        const chillingDaysRow = row('Chilling required days:', chillingDaysInput); // ADDED
        rightCol.appendChild(chillingDaysRow.row); // ADDED
        attachInlineOverrideToRow(chillingDaysRow, { key: 'chilling_required_days', type: 'nullable_num', step: 0.1 }); // ADDED
        const chillingHoursRow = row('Chilling required hours:', chillingHoursInput); // ADDED
        rightCol.appendChild(chillingHoursRow.row); // ADDED
        attachInlineOverrideToRow(chillingHoursRow, { key: 'chilling_required_hours', type: 'nullable_num', step: 1 }); // ADDED
        const chillingMinRow = row('Chilling min temp (C):', chillingMinInput); // ADDED
        rightCol.appendChild(chillingMinRow.row); // ADDED
        attachInlineOverrideToRow(chillingMinRow, { key: 'chilling_temp_min_c', type: 'nullable_num', step: 0.1 }); // ADDED
        const chillingMaxRow = row('Chilling max temp (C):', chillingMaxInput); // ADDED
        rightCol.appendChild(chillingMaxRow.row); // ADDED
        attachInlineOverrideToRow(chillingMaxRow, { key: 'chilling_temp_max_c', type: 'nullable_num', step: 0.1 }); // ADDED
        const chillingStageRow = row('Chilling stage:', chillingStageSel); // ADDED
        rightCol.appendChild(chillingStageRow.row); // ADDED
        attachInlineOverrideToRow(chillingStageRow, { key: 'chilling_stage', type: 'text' }); // ADDED
        const chillingPolicyRow = row('Chilling policy:', chillingPolicySel); // ADDED
        rightCol.appendChild(chillingPolicyRow.row); // ADDED
        attachInlineOverrideToRow(chillingPolicyRow, { key: 'chilling_policy', type: 'text' }); // ADDED
        const diagnosticPolicyRow = row('Default diagnostic policy:', diagnosticPolicySel); // ADDED
        rightCol.appendChild(diagnosticPolicyRow.row); // ADDED
        attachInlineOverrideToRow(diagnosticPolicyRow, { key: 'diagnostic_policy', type: 'text' }); // ADDED

        // --- Vegetative geometry ---
        const vegHeightInput = makeNullableNumber(existing?.veg_height_cm ?? null, { min: 0, step: 1 });
        const vegDiamInput = makeNullableNumber(existing?.veg_diameter_cm ?? null, { min: 0, step: 1 });
        const spacingInput = makeNullableNumber(existing?.spacing_cm ?? null, { min: 0, step: 1 });

        const vegHeightRow = row('Veg height (cm):', vegHeightInput);
        leftCol.appendChild(vegHeightRow.row);
        attachInlineOverrideToRow(vegHeightRow, { key: 'veg_height_cm', type: 'num_ge0', step: 1 });

        const vegDiamRow = row('Veg diameter (cm):', vegDiamInput);
        leftCol.appendChild(vegDiamRow.row);
        attachInlineOverrideToRow(vegDiamRow, { key: 'veg_diameter_cm', type: 'num_ge0', step: 1 });

        const spacingRow = row('Spacing (cm):', spacingInput);
        leftCol.appendChild(spacingRow.row);
        attachInlineOverrideToRow(spacingRow, { key: 'spacing_cm', type: 'num_ge0', step: 1 });
        // Attach overwinter override to the overwinter row (base is checkbox)
        attachInlineOverrideToRow(overwinterRow, { key: 'overwinter_ok', type: 'bool01' });

        // hide overrides by default
        setInlineOverridesVisible(false);

        const PLANT_FIELD_BINDINGS = [ // ADDED
            { key: 'plant_name', input: nameInput, kind: 'text', empty: '' }, // ADDED
            { key: 'abbr', input: abbrInput, kind: 'text', empty: '' }, // ADDED

            { key: 'days_germ', input: daysGermInput, kind: 'number', empty: '0' }, // ADDED
            { key: 'days_transplant', input: daysTransInput, kind: 'number', empty: '0' }, // ADDED

            { key: 'yield_per_plant_kg', input: yieldInput, kind: 'nullable-number', empty: '' }, // ADDED
            { key: 'harvest_window_days', input: hwInput, kind: 'nullable-number', empty: '' }, // ADDED

            { key: 'tbase_c', input: tbaseInput, kind: 'nullable-number', empty: '' }, // ADDED
            { key: 'tmin_c', input: tminInput, kind: 'nullable-number', empty: '' }, // ADDED
            { key: 'topt_low_c', input: toptLowInput, kind: 'nullable-number', empty: '' }, // ADDED
            { key: 'topt_high_c', input: toptHighInput, kind: 'nullable-number', empty: '' }, // ADDED
            { key: 'tmax_c', input: tmaxInput, kind: 'nullable-number', empty: '' }, // ADDED

            { key: 'soil_temp_min_plant_c', input: soilMinInput, kind: 'nullable-number', empty: '' }, // ADDED
            { key: 'start_cooling_threshold_c', input: coolThreshInput, kind: 'nullable-number', empty: '' }, // ADDED

            { key: 'establishment_temp_max_c', input: establishmentMaxInput, kind: 'nullable-number', empty: '' }, // ADDED
            { key: 'establishment_heat_window_days', input: establishmentDaysInput, kind: 'nullable-number', empty: '' }, // ADDED
            { key: 'establishment_heat_policy', input: establishmentPolicySel, kind: 'text', empty: '' }, // ADDED
            { key: 'quality_temp_max_c', input: qualityMaxInput, kind: 'nullable-number', empty: '' }, // ADDED
            { key: 'heat_stress_stage', input: heatStageSel, kind: 'text', empty: '' }, // ADDED
            { key: 'quality_heat_policy', input: qualityPolicySel, kind: 'text', empty: '' }, // ADDED
            { key: 'photoperiod_response', input: photoperiodResponseSel, kind: 'text', empty: '' }, // ADDED
            { key: 'critical_daylength_hours', input: criticalDaylengthInput, kind: 'nullable-number', empty: '' }, // ADDED
            { key: 'photoperiod_stage', input: photoperiodStageSel, kind: 'text', empty: '' }, // ADDED
            { key: 'photoperiod_policy', input: photoperiodPolicySel, kind: 'text', empty: '' }, // ADDED
            { key: 'chilling_required_days', input: chillingDaysInput, kind: 'nullable-number', empty: '' }, // ADDED
            { key: 'chilling_required_hours', input: chillingHoursInput, kind: 'nullable-number', empty: '' }, // ADDED
            { key: 'chilling_temp_min_c', input: chillingMinInput, kind: 'nullable-number', empty: '' }, // ADDED
            { key: 'chilling_temp_max_c', input: chillingMaxInput, kind: 'nullable-number', empty: '' }, // ADDED
            { key: 'chilling_stage', input: chillingStageSel, kind: 'text', empty: '' }, // ADDED
            { key: 'chilling_policy', input: chillingPolicySel, kind: 'text', empty: '' }, // ADDED
            { key: 'diagnostic_policy', input: diagnosticPolicySel, kind: 'text', empty: '' }, // ADDED

            { key: 'veg_height_cm', input: vegHeightInput, kind: 'nullable-number', empty: '' }, // ADDED
            { key: 'veg_diameter_cm', input: vegDiamInput, kind: 'nullable-number', empty: '' }, // ADDED
            { key: 'spacing_cm', input: spacingInput, kind: 'nullable-number', empty: '' }, // ADDED
        ]; // ADDED

        function setBoundInputValue(binding, row) { // ADDED
            const { key, input, kind, empty = '' } = binding; // ADDED
            const value = row?.[key]; // ADDED

            if (kind === 'text') { // ADDED
                input.value = value == null ? empty : String(value); // ADDED
                return; // ADDED
            } // ADDED

            if (kind === 'number' || kind === 'nullable-number') { // ADDED
                input.value = value == null ? empty : String(value); // ADDED
                return; // ADDED
            } // ADDED

            throw new Error(`Unknown binding kind: ${kind}`); // ADDED
        } // ADDED

        function resetBoundPlantFields() { // ADDED
            for (const binding of PLANT_FIELD_BINDINGS) { // ADDED
                binding.input.value = binding.empty ?? ''; // ADDED
            } // ADDED
        } // ADDED

        function applyBoundPlantFields(row) { // ADDED
            for (const binding of PLANT_FIELD_BINDINGS) { // ADDED
                setBoundInputValue(binding, row); // ADDED
            } // ADDED
        } // ADDED

        function setPlantControlsEnabled(enabled) {
            const els = [
                nameInput, abbrInput, typeSel, /* lifespanInput, */ overwinterChk,
                defaultMethodSel, budgetModeSel, gddInput, daysMatInput,
                daysGermInput, daysTransInput, yieldInput, hwInput,
                tbaseInput, tminInput, toptLowInput, toptHighInput, tmaxInput,
                soilMinInput, coolThreshInput,
                establishmentMaxInput, establishmentDaysInput, establishmentPolicySel,
                qualityMaxInput, heatStageSel, qualityPolicySel,
                photoperiodResponseSel, criticalDaylengthInput, photoperiodStageSel, photoperiodPolicySel,
                chillingDaysInput, chillingHoursInput, chillingMinInput, chillingMaxInput, chillingStageSel, chillingPolicySel,
                diagnosticPolicySel,
                vegHeightInput, vegDiamInput, spacingInput
            ];

            for (const el of els) {
                if (!el) continue;
                el.disabled = !enabled;
            }

            for (const chk of methodChecksById.values()) chk.disabled = !enabled;

            // Lifespan obeys lifecycle + global enabled flag                               
            syncLifecycleFields();
            const isPerennial = (String(typeSel.value) === 'perennial');
            lifespanInput.disabled = (!enabled) || (!isPerennial);
        }

        async function refreshAllowedMethodCategoriesUIForPlant(pid) {
            const allowed = await listAllowedmethodCategoryIdsForPlant(Number(pid));
            const allowedSet = new Set(allowed);
            for (const [mid, chk] of methodChecksById.entries()) {
                chk.checked = allowedSet.has(mid);
            }
            await rebuildDefaultMethodOptions();
        }

        async function refreshVarietyDropdown(pid, preferredVarietyId = null) {
            varietiesCache = Number.isFinite(Number(pid)) ? await listVarietiesForPlant(Number(pid)) : [];

            const prev = String(preferredVarietyId ?? varietySel.value ?? '');
            varietySel.innerHTML = '';

            const none = document.createElement('option');
            none.value = '';
            none.textContent = '';
            varietySel.appendChild(none);

            const newOpt = document.createElement('option');
            newOpt.value = NEW_VARIETY_VALUE;
            newOpt.textContent = 'New variety…';
            varietySel.appendChild(newOpt);

            for (const v of varietiesCache) {
                const opt = document.createElement('option');
                opt.value = String(v.variety_id);
                opt.textContent = String(v.variety_name || v.variety_id);
                varietySel.appendChild(opt);
            }

            const valid = new Set(Array.from(varietySel.options).map(o => o.value));
            varietySel.value = valid.has(prev) ? prev : '';

            const hasPlant = Number.isFinite(Number(currentPlantId));
            addVarBtn.disabled = !hasPlant;
        }

        function applyPlantRowToUI(p) { // CHANGED
            applyBoundPlantFields(p); // ADDED

            typeSel.value = (p?.perennial === 1) ? 'perennial' : (p?.biennial === 1 ? 'biennial' : 'annual'); // CHANGED
            lifespanInput.value = p?.lifespan_years == null ? '' : String(p.lifespan_years); // CHANGED
            overwinterChk.checked = (p?.overwinter_ok === 1); // CHANGED
            syncLifecycleFields(); // CHANGED

            const hasGddLocal = Number(p?.gdd_to_maturity ?? 0) > 0; // CHANGED
            budgetModeSel.value = hasGddLocal ? 'gdd' : 'days'; // CHANGED
            gddInput.value = p?.gdd_to_maturity == null ? '' : String(p.gdd_to_maturity); // CHANGED
            daysMatInput.value = p?.days_maturity == null ? '' : String(p.days_maturity); // CHANGED
            syncBudgetModeUI(); // CHANGED
        } // CHANGED

        async function loadPlantIntoForm(pidOrNull, preferredVarietyId = null, preferredStartVarietyMode = null) {
            console.group('[PlantEditorDialog] loadPlantIntoForm');
            console.log('pidOrNull:', pidOrNull);
            console.log('currentPlantMode (before):', currentPlantMode);
            console.groupEnd();

            const pidNum = Number(pidOrNull);
            if (!pidOrNull || !Number.isFinite(pidNum) || pidNum <= 0) {
                console.log('[PlantEditorDialog] entering ADD plant reset path');
                currentPlantId = null;
                currentPlantRow = null;
                applyDialogMode(DIALOG_MODE.PLANT_ADD); // CHANGED

                title.textContent = 'Add plant';

                resetBoundPlantFields(); // ADDED

                typeSel.value = 'annual'; // CHANGED
                lifespanInput.value = ''; // CHANGED
                overwinterChk.checked = false; // CHANGED
                syncLifecycleFields(); // CHANGED

                budgetModeSel.value = 'days'; // CHANGED
                gddInput.value = ''; // CHANGED
                daysMatInput.value = ''; // CHANGED
                syncBudgetModeUI(); // CHANGED

                // Reset methods + default method                                        
                for (const chk of methodChecksById.values()) chk.checked = false;
                await rebuildDefaultMethodOptions();
                defaultMethodSel.value = '';

                // Reset variety UI                                                      
                varietiesCache = [];
                varietySel.innerHTML = '';
                const none = document.createElement('option');
                none.value = '';
                none.textContent = '';
                varietySel.appendChild(none);
                addVarBtn.disabled = true;

                return;
            }


            const pid = pidNum;
            const rowObj = await PlantModel.loadById(pid);
            if (!rowObj) throw new Error('Plant not found');

            currentPlantId = pid;
            currentPlantRow = toPlainDict(rowObj);
            applyDialogMode(DIALOG_MODE.PLANT_EDIT); // CHANGED
            title.textContent = 'Edit plant';

            applyPlantRowToUI(currentPlantRow);
            refreshInlineBaseHints();
            await refreshAllowedMethodCategoriesUIForPlant(pid);
            selectDefaultMethodFromPlantRow();

            await refreshVarietyDropdown(pid, preferredVarietyId);

            const wantVid = Number.isFinite(Number(preferredVarietyId)) ? Number(preferredVarietyId) : null;
            const vSel = String(varietySel.value || '').trim();

            const forceAdd = preferredStartVarietyMode === 'add';
            const forceEdit = preferredStartVarietyMode === 'edit';

            if (forceAdd) {
                varietySel.value = NEW_VARIETY_VALUE;
                startNewVarietyMode();
                return;
            }

            if (wantVid && vSel && vSel !== NEW_VARIETY_VALUE && Number(vSel) === wantVid) {
                await loadVarietyIntoOverrides(wantVid);
                return;
            }

            if (forceEdit && vSel && vSel !== NEW_VARIETY_VALUE) {
                await loadVarietyIntoOverrides(Number(vSel));
                return;
            }

        }

        function startNewVarietyMode() {
            varietyNameInput.value = '';
            applyOverridesToUI({});
            applyDialogMode(DIALOG_MODE.VARIETY_ADD); // CHANGED
        }

        async function loadVarietyIntoOverrides(varietyId) {
            const pid = Number(currentPlantId);
            if (!Number.isFinite(pid)) return;

            const vid = Number(varietyId);
            if (!Number.isFinite(vid)) return;

            const vrow = await PlantVarietyModel.loadById(vid);
            if (!vrow) throw new Error('Variety not found');

            currentVarietyId = vid;
            currentVarietyRow = toPlainDict(vrow);
            currentVarietyMode = 'edit';

            let overrides = {};
            try {
                const raw = currentVarietyRow?.overrides_json;
                if (raw) {
                    const obj = JSON.parse(String(raw));
                    if (obj && typeof obj === 'object' && !Array.isArray(obj)) overrides = obj;
                }
            } catch (_) { overrides = {}; }

            varietyNameInput.value = String(currentVarietyRow?.variety_name ?? '');
            applyOverridesToUI(overrides);

            applyDialogMode(DIALOG_MODE.VARIETY_EDIT); // CHANGED
        }

        // -------------------- Populate plant dropdown --------------------
        const plantRows = await listPlantsBasic();
        plantSel.innerHTML = '';

        const emptyPlantOpt = document.createElement('option');
        emptyPlantOpt.value = '';
        emptyPlantOpt.textContent = '';
        plantSel.appendChild(emptyPlantOpt);

        const newPlantOpt = document.createElement('option');
        newPlantOpt.value = NEW_PLANT_VALUE;
        newPlantOpt.textContent = 'New plant…';
        plantSel.appendChild(newPlantOpt);

        for (const p of plantRows) {
            const opt = document.createElement('option');
            opt.value = String(p.plant_id);
            opt.textContent = String(p.plant_name || p.plant_id);
            plantSel.appendChild(opt);
        }

        plantSel.value = Number.isFinite(Number(currentPlantId)) ? String(currentPlantId) : '';

        // --- Buttons ---
        const btns = document.createElement('div');
        btns.style.marginTop = '12px';
        btns.style.display = 'flex';
        btns.style.justifyContent = 'flex-end';
        btns.style.gap = '8px';

        const cancelBtn = mxUtils.button('Cancel', () => div.__cancel());

        const saveBtn = mxUtils.button('Save', async () => {
            try {
                // -------------------- Variety mode (add/edit) --------------------
                if (currentVarietyMode === 'add' || currentVarietyMode === 'edit') {
                    const pid = Number(currentPlantId);
                    if (!Number.isFinite(pid)) throw new Error('Save the plant first');

                    const varietyName = String(varietyNameInput.value || '').trim();
                    if (!varietyName) throw new Error('Variety name is required');

                    const overrides = buildOverridesFromUI();

                    let savedVar = null;
                    if (currentVarietyMode === 'edit') {
                        const vid = Number(currentVarietyId);
                        if (!Number.isFinite(vid)) throw new Error('Select a variety');
                        savedVar = await PlantVarietyModel.update({
                            varietyId: vid,
                            varietyName,
                            overrides
                        });
                    } else {
                        savedVar = await PlantVarietyModel.create({
                            plantId: pid,
                            varietyName,
                            overrides
                        });
                    }

                    const newVid = Number(savedVar?.variety_id);
                    if (Number.isFinite(newVid)) {
                        currentVarietyId = newVid;
                        currentVarietyRow = toPlainDict(await PlantVarietyModel.loadById(newVid)); // CHANGED
                        await refreshVarietyDropdown(pid, newVid);
                        varietySel.value = String(newVid);
                        applyDialogMode(DIALOG_MODE.VARIETY_EDIT); // CHANGED
                    } else {
                        await refreshVarietyDropdown(pid, null);
                    }

                    div.__commit(savedVar);

                    return;
                }

                // -------------------- Plant mode --------------------
                const plant_name = String(nameInput.value || '').trim();
                if (!plant_name) throw new Error('Plant name is required');

                const lifecycle = typeSel.value;
                const annual = (lifecycle === 'annual') ? 1 : 0;
                const biennial = (lifecycle === 'biennial') ? 1 : 0;
                const perennial = (lifecycle === 'perennial') ? 1 : 0;

                let lifespan_years = null;

                if (perennial) {
                    lifespan_years = readNullableNumber(lifespanInput);
                    if (!(Number.isFinite(Number(lifespan_years)) && Number(lifespan_years) >= 3)) {
                        throw new Error('Perennials require lifespan_years >= 3');
                    }
                } else {
                    lifespan_years = annual ? 1 : 2;
                }

                const allowedmethodCategoryIds = getAllowedmethodCategoryIdsFromUI();
                if (!allowedmethodCategoryIds.length) throw new Error('Enable at least one method');

                const default_planting_method_raw = normId(defaultMethodSel.value); // FIX
                const default_planting_method = default_planting_method_raw ? default_planting_method_raw : null;

                const overwinter_ok = overwinterChk.checked ? 1 : 0;

                const budgetMode = budgetModeSel.value;
                const gdd_to_maturity = (budgetMode === 'gdd') ? readNullableNumber(gddInput) : null;
                const days_maturity = (budgetMode === 'days') ? readNullableNumber(daysMatInput) : null;

                if (budgetMode === 'gdd' && !(Number.isFinite(Number(gdd_to_maturity)) && Number(gdd_to_maturity) > 0)) { // FIX: match scheduler requirements
                    throw new Error('GDD to maturity must be greater than 0'); // FIX: prevent saving an unusable plant
                }
                if (budgetMode === 'days' && !(Number.isFinite(Number(days_maturity)) && Number(days_maturity) > 0)) { // FIX: match scheduler requirements
                    throw new Error('Days to maturity must be greater than 0'); // FIX: prevent saving an unusable plant
                }

                const patch = {
                    plant_name,
                    abbr: String(abbrInput.value || '').trim() || null,
                    annual, biennial, perennial,
                    lifespan_years,
                    overwinter_ok,
                    default_planting_method,
                    gdd_to_maturity, days_maturity,
                    days_germ: readIntGE0(daysGermInput),
                    days_transplant: readIntGE0(daysTransInput),
                    yield_per_plant_kg: readNullableNumber(yieldInput),
                    harvest_window_days: (hwInput.value === '' ? null : readIntGE0(hwInput)),
                    tbase_c: readNullableNumber(tbaseInput),
                    tmin_c: readNullableNumber(tminInput),
                    topt_low_c: readNullableNumber(toptLowInput),
                    topt_high_c: readNullableNumber(toptHighInput),
                    tmax_c: readNullableNumber(tmaxInput),
                    soil_temp_min_plant_c: readNullableNumber(soilMinInput),
                    start_cooling_threshold_c: readNullableNumber(coolThreshInput),
                    establishment_temp_max_c: readNullableNumber(establishmentMaxInput), // ADDED
                    establishment_heat_window_days: (establishmentDaysInput.value === '' ? null : readIntGE0(establishmentDaysInput)), // ADDED
                    establishment_heat_policy: String(establishmentPolicySel.value || '').trim() || null, // ADDED
                    quality_temp_max_c: readNullableNumber(qualityMaxInput), // ADDED
                    heat_stress_stage: String(heatStageSel.value || '').trim() || null, // ADDED
                    quality_heat_policy: String(qualityPolicySel.value || '').trim() || null, // ADDED
                    photoperiod_response: String(photoperiodResponseSel.value || '').trim() || null, // ADDED
                    critical_daylength_hours: readNullableNumber(criticalDaylengthInput), // ADDED
                    photoperiod_stage: String(photoperiodStageSel.value || '').trim() || null, // ADDED
                    photoperiod_policy: String(photoperiodPolicySel.value || '').trim() || null, // ADDED
                    chilling_required_days: readNullableNumber(chillingDaysInput), // ADDED
                    chilling_required_hours: readNullableNumber(chillingHoursInput), // ADDED
                    chilling_temp_min_c: readNullableNumber(chillingMinInput), // ADDED
                    chilling_temp_max_c: readNullableNumber(chillingMaxInput), // ADDED
                    chilling_stage: String(chillingStageSel.value || '').trim() || null, // ADDED
                    chilling_policy: String(chillingPolicySel.value || '').trim() || null, // ADDED
                    diagnostic_policy: String(diagnosticPolicySel.value || '').trim() || null, // ADDED

                    veg_height_cm: readNullableNumber(vegHeightInput),
                    veg_diameter_cm: readNullableNumber(vegDiamInput),
                    spacing_cm: readNullableNumber(spacingInput)
                };

                const plantIdToSave = currentPlantMode === 'edit' ? Number(currentPlantId) : null; // FIX: provide one atomic save path
                if (currentPlantMode === 'edit' && !Number.isFinite(plantIdToSave)) throw new Error('Select a plant'); // FIX: validate before opening the transaction
                const saved = await PlantModel.saveWithAllowedMethodCategories(
                    plantIdToSave,
                    patch,
                    allowedmethodCategoryIds
                ); // FIX: commit the plant and allowed-method records together

                const savedId = Number(saved?.plant_id ?? currentPlantId);
                if (!Number.isFinite(savedId)) throw new Error('Save succeeded but plant_id is missing');

                // After save, sync dialog state to saved plant
                currentPlantId = savedId;
                plantSel.value = String(savedId);
                currentPlantRow = toPlainDict(await PlantModel.loadById(savedId));
                applyDialogMode(DIALOG_MODE.PLANT_EDIT); // CHANGED
                refreshInlineBaseHints();

                await refreshAllowedMethodCategoriesUIForPlant(savedId);
                await refreshVarietyDropdown(savedId, null);

                div.__commit(saved);
            } catch (e) {
                showErrorInline('Save error: ' + (e?.message || String(e)));
            }
        });

        function syncSaveButtonLabel() {
            if (!saveBtn) return;
            if (currentVarietyMode === 'add') saveBtn.textContent = 'Save variety';
            else if (currentVarietyMode === 'edit') saveBtn.textContent = 'Save variety';
            else saveBtn.textContent = 'Save plant';
        }

        // Choose initial dropdown selection based on dialog mode and inputs                  
        const initialPlantSelValue = isEdit
            ? String(parsePositiveId(plantId) ?? '')
            : (initialPlantId ? String(initialPlantId) : NEW_PLANT_VALUE);

        plantSel.value = initialPlantSelValue;

        console.log('[PlantEditorDialog] calling loadPlantIntoForm with:', {
            initialPlantId,
            plantId_raw: plantId,
            initialPlantSelValue
        });

        await loadPlantIntoForm(
            initialPlantSelValue === NEW_PLANT_VALUE ? null : Number(initialPlantSelValue),
            initialVarietyId,
            initialStartVarietyMode
        );

        async function handlePlantEditorPlantChange() { // FIX: provide an awaitable plant-editor workflow
            try {
                const raw = String(plantSel.value || '').trim();

                if (raw === NEW_PLANT_VALUE) {
                    await loadPlantIntoForm(null);
                    syncSaveButtonLabel();
                    return;
                }

                const pid = raw ? Number(raw) : null;
                await loadPlantIntoForm(Number.isFinite(Number(pid)) ? pid : null);
            } catch (e) {
                showErrorInline('Load plant error: ' + (e?.message || String(e)));
            }
        }

        async function handlePlantEditorVarietyChange() { // FIX: provide an awaitable variety-editor workflow
            try {
                const v = String(varietySel.value || '').trim();
                const hasPlant = Number.isFinite(Number(currentPlantId));

                addVarBtn.disabled = !hasPlant;

                if (!v) {
                    applyDialogMode(
                        Number.isFinite(Number(currentPlantId))
                            ? DIALOG_MODE.PLANT_EDIT
                            : DIALOG_MODE.PLANT_ADD
                    ); // CHANGED
                    return;
                }

                if (v === NEW_VARIETY_VALUE) {
                    if (!hasPlant) {
                        showErrorInline('Save the plant first');
                        varietySel.value = '';
                        return;
                    }
                    startNewVarietyMode();
                    return;
                }

                await loadVarietyIntoOverrides(Number(v));
            } catch (e) {
                showErrorInline('Load variety error: ' + (e?.message || String(e)));
            }
        }

        plantSel.addEventListener('change', handlePlantEditorPlantChange); // FIX: delegate native changes to the awaitable handler
        varietySel.addEventListener('change', handlePlantEditorVarietyChange); // FIX: delegate native changes to the awaitable handler

        btns.appendChild(cancelBtn);
        btns.appendChild(saveBtn);
        div.appendChild(btns);

        return await showCommitDialog(ui, { container: div, width: 680, height: 620, modal: true, closable: true });
    }





















































    function computeScheduleResult(inputs) { // ADDED
        const { plant } = inputs; // CHANGED
        const startDate = parseISODateUTCValue(inputs.startISO); // FIX: perennial results do not initialize GDD-derived state
        if (!startDate) {
            throw new Error('Select a planting date.'); // FIX: empty no-window state must not become an invalid Date
        }
        return isPerennialPlant(plant)
            ? perennialCore.computePerennialScheduleResult(inputs)
            : annualCore.computeAnnualScheduleResult(inputs, { allowThermalWarnings: true }); // CHANGED
    }










    // -------------------- Dialog builder ---------------------------------------------------
    async function buildScheduleDialog(ui, cell, plants, cities, onSubmit, options) {
        let plantsLocal = Array.isArray(plants) ? plants.slice() : [];
        const {
            selectedPlant: initialPlant,
            earliestFeasibleSowDate,
            lastHarvestDate,
            latestHarvestEndDate = lastHarvestDate, // ADDED
            selectedHarvestEndDate = lastHarvestDate, // ADDED
            startNote,
            initialCityId = null, // ADDED
            initialCityName = '',
            hasPersistedSchedule: initialHasPersistedSchedule = false,
            initialWindowFeasible = false,
            bedProfile: scheduleBedProfile = normalizeBedProfile(null),
            bedProfileSource: scheduleBedProfileSource = 'generic garden bed',
            dailyClimate: initialDailyClimate = null, // CHANGED
            dailyClimateKey: initialDailyClimateKey = '' // CHANGED
        } = options || {};
        let hasPersistedSchedule = !!initialHasPersistedSchedule; // FIX: provenance changes after an automatic replacement

        // Helper to centralize plant mode (perennial vs annual/biennial)          
        function getModeForPlant(plant) {
            const perennial = !!(plant && plant.isPerennial && plant.isPerennial());
            return { perennial };
        }

        async function reloadPlantsList() {
            const prev = plantSel.value;
            plantsLocal = await PlantModel.listBasic();
            const opts = (plantsLocal || []).map(p => ({
                value: String(p.plant_id),
                label: p.plant_name + (p.abbr ? ` (${p.abbr})` : '')
            }));
            setSelectOptions(plantSel, opts, prev);
            if (!findPlantById(Number(plantSel.value)) && opts[0]) {
                plantSel.value = String(opts[0].value);
            }
        }


        const div = document.createElement('div');
        div.style.padding = '12px';
        div.style.width = '100%'; // CHANGED
        div.style.maxWidth = '96vw'; // CHANGED
        div.style.boxSizing = 'border-box'; // CHANGED

        const summaryView = renderScheduleSummary(); // ADDED
        div.appendChild(summaryView.root); // ADDED

        // ---- inline error bar --------------------------------------------------- 
        const errorBar = document.createElement('div');
        errorBar.style.display = 'none';
        errorBar.style.marginBottom = '8px';
        errorBar.style.padding = '8px';
        errorBar.style.border = '1px solid #f59e0b';
        errorBar.style.background = '#fffbeb';
        errorBar.style.color = '#92400e';
        errorBar.style.fontSize = '12px';
        div.appendChild(errorBar);

        function showErrorInline(msg) {
            errorBar.textContent = String(msg || 'Unknown error');
            errorBar.style.display = '';
        }

        function clearErrorInline() {
            errorBar.textContent = '';
            errorBar.style.display = 'none';
        }

        async function runUiAsync(label, fn) { // FIX: contain async event-handler failures in the dialog
            clearErrorInline();
            return runUiAsyncOperation(label, fn, (message, e) => {
                console.warn(`[Scheduler UI] ${label} failed:`, e);
                showErrorInline(message);
            }); // FIX
        }

        const inlineButton = (label, onClick) => {
            const b = mxUtils.button(label, async () => { clearErrorInline(); await onClick(); });
            b.style.marginLeft = '8px';
            return b;
        };

        const contextSection = makeSection('Context'); // CHANGED
        contextSection.wrap.classList.add('usl-scheduler-section--allow-popover'); // ADDED
        const plantSection = makeSection('Crop'); // CHANGED
        const windowSection = makeSection('Feasibility'); // CHANGED
        const timelineSection = makeSection('Timeline'); // CHANGED
        const inputsSection = makeSection('Planting'); // CHANGED
        const harvestSection = makeSection('Harvest'); // CHANGED

        const contentGrid = document.createElement('div'); // ADDED
        contentGrid.style.display = 'grid'; // ADDED
        contentGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(360px, 1fr))'; // ADDED
        contentGrid.style.gap = '16px'; // ADDED

        const leftColumn = document.createElement('div'); // ADDED
        const rightColumn = document.createElement('div'); // ADDED
        leftColumn.appendChild(plantSection.wrap); // ADDED
        leftColumn.appendChild(contextSection.wrap); // ADDED
        leftColumn.appendChild(inputsSection.wrap); // ADDED
        rightColumn.appendChild(windowSection.wrap); // ADDED
        rightColumn.appendChild(timelineSection.wrap); // ADDED
        rightColumn.appendChild(harvestSection.wrap); // ADDED
        contentGrid.appendChild(leftColumn); // ADDED
        contentGrid.appendChild(rightColumn); // ADDED
        div.appendChild(contentGrid); // ADDED

        const advancedDetails = document.createElement('details'); // ADDED
        advancedDetails.style.marginTop = '14px'; // ADDED
        advancedDetails.style.borderTop = '1px solid #d1d5db'; // ADDED
        const advancedSummary = document.createElement('summary'); // ADDED
        advancedSummary.textContent = 'Advanced'; // ADDED
        advancedSummary.style.cursor = 'pointer'; // ADDED
        advancedSummary.style.fontWeight = '600'; // ADDED
        advancedSummary.style.padding = '10px 0 6px'; // ADDED
        const advancedBody = document.createElement('div'); // ADDED
        advancedDetails.appendChild(advancedSummary); // ADDED
        advancedDetails.appendChild(advancedBody); // ADDED
        div.appendChild(advancedDetails); // ADDED

        function styleCompactActionButton(btn) { // CHANGED
            btn.style.marginLeft = '0'; // CHANGED
            btn.style.minWidth = '28px'; // CHANGED
            btn.style.padding = '4px 8px'; // CHANGED
            btn.style.lineHeight = '1.2'; // CHANGED
            return btn; // CHANGED
        } // CHANGED

        function makeSection(title) { // CHANGED
            const wrap = document.createElement('div'); // CHANGED
            wrap.className = 'usl-scheduler-section'; // CHANGE
            wrap.style.marginTop = '12px'; // CHANGED

            const heading = document.createElement('div'); // CHANGED
            heading.className = 'usl-scheduler-section-heading'; // CHANGE
            heading.textContent = title; // CHANGED
            heading.style.fontWeight = '600'; // CHANGED
            heading.style.fontSize = '13px'; // CHANGED
            heading.style.padding = '0 0 6px 0'; // CHANGED
            heading.style.borderBottom = '1px solid #d1d5db'; // CHANGED
            heading.style.marginBottom = '8px'; // CHANGED

            const body = document.createElement('div'); // CHANGED
            body.className = 'usl-scheduler-section-body'; // CHANGE
            wrap.appendChild(heading); // CHANGED
            wrap.appendChild(body); // CHANGED

            return { wrap, body }; // CHANGED
        } // CHANGED

        function makeDisplayField(initialValue = '', opts = {}) { // CHANGED
            const el = document.createElement('div'); // CHANGED
            el.textContent = initialValue || ''; // CHANGED
            el.style.width = '100%'; // CHANGED
            el.style.boxSizing = 'border-box'; // CHANGED
            el.style.padding = opts.emphasis ? '8px 10px' : '6px 8px'; // CHANGED
            el.style.minHeight = opts.emphasis ? '36px' : '32px'; // CHANGED
            el.style.border = '1px solid #d1d5db'; // CHANGED
            el.style.background = opts.emphasis ? '#eef6ff' : '#f3f4f6'; // CHANGED
            el.style.color = '#374151'; // CHANGED
            el.style.borderRadius = '4px'; // CHANGED
            el.style.display = 'flex'; // CHANGED
            el.style.alignItems = 'center'; // CHANGED
            if (opts.emphasis) { // CHANGED
                el.style.fontWeight = '600'; // CHANGED
                el.style.fontSize = '14px'; // CHANGED
                el.style.borderColor = '#93c5fd'; // CHANGED
            } // CHANGED
            return el; // CHANGED
        } // CHANGED

        function setDisplayFieldValue(el, value) { // CHANGED
            el.textContent = value || ''; // CHANGED
        } // CHANGED

        function fmtShortDate(iso) { // CHANGED
            if (!iso) return ''; // CHANGED
            const d = new Date(iso + 'T00:00:00Z'); // CHANGED
            return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); // CHANGED
        } // CHANGED

        function parseISODateUTC(iso) { // CHANGED
            if (!iso) return null; // CHANGED
            const d = new Date(iso + 'T00:00:00Z'); // CHANGED
            return Number.isNaN(d.getTime()) ? null : d; // CHANGED
        } // CHANGED

        function daysBetweenUTC(a, b) { // CHANGED
            const ms = 24 * 60 * 60 * 1000; // CHANGED
            return Math.round((b.getTime() - a.getTime()) / ms); // CHANGED
        } // CHANGED

        // Plant selector
        const plantOpts = (plantsLocal || []).map(p => ({ value: String(p.plant_id), label: p.plant_name + (p.abbr ? ` (${p.abbr})` : '') }));
        const plantSel = makeSelect(plantOpts, plantOpts[0]?.value);

        const plantControlsWrap = document.createElement('div');
        plantControlsWrap.style.display = 'flex';
        plantControlsWrap.style.gap = '8px';
        plantControlsWrap.style.alignItems = 'center';
        plantControlsWrap.appendChild(plantSel);

        const addPlantBtn = styleCompactActionButton(inlineButton('+', async () => { // CHANGED
            try {
                const saved = await openPlantEditorDialog(ui, { mode: 'add', plantId: null, varietyId: null });
                if (!saved) return;

                await reloadPlantsList();
                plantSel.value = String(saved.plant_id);
                await handleSchedulePlantChange(); // FIX: await the async selection workflow directly
            } catch (e) {
                showErrorInline('Add plant error: ' + (e?.message || String(e)));
            }
        })); // CHANGED

        const editPlantBtn = styleCompactActionButton(inlineButton('Edit', async () => { // CHANGED
            try {
                syncStateFromControls();

                const pid = Number(plantSel.value);
                if (!Number.isFinite(pid)) return;

                const vid = Number(formState.varietyId);
                const saved = await openPlantEditorDialog(ui, {
                    mode: 'edit',
                    plantId: pid,
                });

                if (!saved) return;

                const savedPid = Number(saved?.plant_id ?? pid);
                const savedVid = Number(saved?.variety_id ?? vid);

                await afterPlantOrVarietySaved({
                    preferPlantId: savedPid,
                    preferVarietyId: Number.isFinite(savedVid) ? savedVid : null
                });
            } catch (e) {
                showErrorInline('Edit plant error: ' + (e?.message || String(e)));
            }
        })); // CHANGED

        plantControlsWrap.appendChild(addPlantBtn);
        plantControlsWrap.appendChild(editPlantBtn);

        const plantSelectRow = row('Plant:', plantControlsWrap); // CHANGED
        plantSection.body.appendChild(plantSelectRow.row); // CHANGED

        const findPlantById = (id) => (plantsLocal || []).find(p => Number(p.plant_id) === Number(id)) || null;

        const fallbackId = (plantOpts[0] ? Number(plantOpts[0].value) : null);
        const initId = Number.isFinite(Number(initialPlant?.plant_id))
            ? Number(initialPlant.plant_id)
            : fallbackId;

        if (!Number.isFinite(initId)) {
            showErrorInline('No plants available.');
            return;
        }

        plantSel.value = String(initId);
        let selPlant = findPlantById(initId);
        if (!selPlant) selPlant = await PlantModel.loadById(initId);
        if (!selPlant) { showErrorInline('Plant not found.'); return; }

        let mode = getModeForPlant(selPlant);

        let effectivePlant = selPlant;

        function setSelectOptions(selectEl, opts, selectedValue) {
            selectEl.innerHTML = '';
            (opts || []).forEach(o => {
                const opt = document.createElement('option');
                opt.value = String(o.value);
                opt.textContent = o.label;
                selectEl.appendChild(opt);
            });
            if (selectedValue != null) selectEl.value = String(selectedValue);
        }

        async function refreshEffectivePlant() {
            effectivePlant = await resolveEffectivePlant(
                formState.plantId,
                formState.varietyId
            );
            if (!effectivePlant) {
                effectivePlant = selPlant;
            }
            mode = getModeForPlant(effectivePlant);
        }

        async function afterPlantOrVarietySaved({ preferPlantId = null, preferVarietyId = null } = {}) {
            await reloadPlantsList();

            if (Number.isFinite(Number(preferPlantId))) {
                plantSel.value = String(preferPlantId);
            }
            await handleSchedulePlantChange({ preferVarietyId }); // FIX: run one ordered post-save update chain
        }

        const plantNameSpan = document.createElement('span'); // CHANGED
        plantNameSpan.textContent = selPlant.plant_name; // CHANGED

        // Variety selector + Add button                                       
        const varietySel = document.createElement('select');
        varietySel.style.width = '100%';
        varietySel.style.padding = '6px';

        const varietyControlsWrap = document.createElement('div');
        varietyControlsWrap.style.display = 'flex';
        varietyControlsWrap.style.gap = '8px';
        varietyControlsWrap.style.alignItems = 'center';
        varietyControlsWrap.appendChild(varietySel);

        const addVarietyBtn = styleCompactActionButton(inlineButton('+', async () => { // CHANGED
            try {
                syncStateFromControls();

                const pid = Number(formState.plantId);
                if (!Number.isFinite(pid)) {
                    showErrorInline('Select a plant first');
                    return;
                }

                const saved = await openPlantEditorDialog(ui, {
                    mode: 'add',
                    plantId: pid,
                    startVarietyMode: 'add'
                });
                if (!saved) return;

                await reloadVarietyOptionsForPlant(pid);

                const savedId = Number(saved?.variety_id ?? saved?.varietyId ?? saved?.id);
                if (Number.isFinite(savedId)) varietySel.value = String(savedId);

                await handleScheduleVarietyChange(); // FIX: await the shared variety selection workflow
            } catch (e) {
                showErrorInline('Add variety error: ' + (e?.message || String(e)));
            }
        })); // CHANGED

        varietyControlsWrap.appendChild(addVarietyBtn);

        const editVarietyBtn = styleCompactActionButton(inlineButton('Edit', async () => { // CHANGED
            try {
                syncStateFromControls();

                const pid = Number(formState.plantId);
                const vid = Number(formState.varietyId);
                if (!Number.isFinite(pid)) { showErrorInline('Select a plant first'); return; }
                if (!Number.isFinite(vid)) { setVarietyStatus('Select a variety to edit.'); return; }

                setVarietyStatus('');
                const saved = await openPlantEditorDialog(ui, {
                    mode: 'add',
                    plantId: pid,
                    varietyId: vid,
                    startVarietyMode: 'edit'
                });
                if (!saved) return;

                await reloadVarietyOptionsForPlant(pid);

                const savedId = Number(saved?.variety_id ?? saved?.varietyId ?? vid);
                varietySel.value = String(savedId);

                await handleScheduleVarietyChange(); // FIX: await the shared variety selection workflow
            } catch (e) {
                setVarietyStatus('Edit variety error: ' + (e?.message || String(e)));
            }
        })); // CHANGED

        varietyControlsWrap.appendChild(editVarietyBtn);

        const varietyRow = row('Variety:', varietyControlsWrap); // CHANGED
        plantSection.body.appendChild(varietyRow.row); // CHANGED

        const varietyStatus = document.createElement('div');
        varietyStatus.style.fontSize = '12px';
        varietyStatus.style.color = '#92400e';
        varietyStatus.style.marginTop = '4px';
        varietyStatus.textContent = '';
        plantSection.body.appendChild(varietyStatus); // CHANGED

        function setVarietyStatus(msg) {
            varietyStatus.textContent = msg || '';
        }

        function syncVarietyButtons() {
            const hasVariety = !!(varietySel && varietySel.value);
            editVarietyBtn.disabled = !hasVariety;
            if (!hasVariety) setVarietyStatus('');
        }

        let currentVarieties = [];
        async function reloadVarietyOptionsForPlant(plantId, selectedVarietyId = null) {
            currentVarieties = await PlantVarietyModel.listByPlantId(Number(plantId));
            const opts = [{ value: '', label: '(base plant)' }]
                .concat(currentVarieties.map(v => ({
                    value: String(v.variety_id),
                    label: String(v.variety_name)
                })));
            const sel = Number.isFinite(Number(selectedVarietyId)) ? String(selectedVarietyId) : '';
            setSelectOptions(varietySel, opts, sel);
        }


        // City & Method & Method
        const cityOpts = cities.map(c => ({ value: String(c.city_id ?? c.city_name), label: c.city_name, city: c })); // CHANGED
        const initialCityKey = initialCityId != null ? String(initialCityId) : ''; // ADDED
        const cityValue = cityOpts.some(o => o.value === initialCityKey)
            ? initialCityKey
            : (cityOpts.find(o => o.label === initialCityName)?.value || cityOpts[0]?.value); // CHANGED
        const citySel = makeCityTreePicker(cities, cityValue); // CHANGED
        setTooltip(citySel, 'City climate is resolved by city_id when available. Edit city latitude and climate data from Garden Settings.'); // ADDED
        function selectedCityOption() { // ADDED
            return cityOpts.find(o => String(o.value) === String(citySel.value)) || cityOpts[0] || null; // ADDED
        } // ADDED
        function selectedCityRow() { // ADDED
            const opt = selectedCityOption(); // ADDED
            return opt ? opt.city : null; // ADDED
        } // ADDED

        // base method select (allowed per plant)
        const methodCategorySel = document.createElement('select');
        methodCategorySel.style.width = '100%';
        methodCategorySel.style.padding = '6px';
        methodCategorySel.style.display = 'none'; // ADDED

        // method select (filtered by method)
        const methodSel = document.createElement('select');
        methodSel.style.width = '100%';
        methodSel.style.padding = '6px';
        methodSel.style.display = 'none'; // ADDED

        const combinedMethodSel = document.createElement('select'); // ADDED
        combinedMethodSel.style.width = '100%'; // ADDED
        combinedMethodSel.style.padding = '6px'; // ADDED

        let currentAllowedMethodCategories = [];   // [{method_category_id, method_category_name}]  
        let currentMethods = [];                  // [{method_id, method_name, method_category_id, ...}] 
        const currentMethodsByCategory = new Map(); // ADDED

        async function resetMethodOptionsForPlant(plantId, { preferMethodCategoryId = null } = {}) {
            const pid = Number(plantId);
            let loadedCategories = [];
            try {
                loadedCategories = Number.isFinite(pid)
                    ? await PlantModel.listAllowedMethodCategoriesForPlant(pid)
                    : [];
            } catch (e) {
                console.warn('[Scheduler] Falling back after allowed-category load failure', {
                    plantId: pid,
                    reason: e?.message || String(e)
                }); // FIX
            }

            currentAllowedMethodCategories = []; // FIX: expose only categories containing a supported method
            currentMethodsByCategory.clear(); // ADDED
            for (const categoryRow of (loadedCategories || [])) {
                const methodCategoryId = normId(categoryRow?.method_category_id); // FIX
                if (!methodCategoryId) continue;
                try {
                    const methods = await PlantModel.listMethodsForMethodCategory(methodCategoryId);
                    const validMethods = (methods || []).filter(methodRow => { // CHANGED
                        try {
                            resolveValidMethodRecord(methodRow, methodCategoryId);
                            return true;
                        } catch (_) {
                            return false;
                        }
                    });
                    if (validMethods.length) { // CHANGED
                        currentAllowedMethodCategories.push(categoryRow); // CHANGED
                        currentMethodsByCategory.set(methodCategoryId, validMethods); // ADDED
                    } // CHANGED
                } catch (e) {
                    console.warn('[Scheduler] Skipping method category option', {
                        plantId: pid,
                        methodCategoryId,
                        reason: e?.message || String(e)
                    }); // FIX
                }
            }

            if (!currentAllowedMethodCategories.length) {
                currentAllowedMethodCategories = [{
                    method_category_id: 'direct_sow',
                    method_category_name: 'Direct sow'
                }]; // FIX: retain the canonical hard fallback in the dialog
                currentMethodsByCategory.set('direct_sow', [{ // ADDED
                    method_category_id: 'direct_sow', // ADDED
                    method_id: 'direct_sow.field', // ADDED
                    method_name: 'Field direct sow' // ADDED
                }]); // ADDED
            }

            const opts = (currentAllowedMethodCategories || []).map(mc => ({
                value: normId(mc.method_category_id), // FIX
                label: String(mc.method_category_name || mc.method_category_id || '').trim()
            })).filter(o => o.value);

            // Optional but recommended: allow blank selection
            const withBlank = [{ value: '', label: '' }].concat(opts);

            const preferred = normId(preferMethodCategoryId); // FIX
            const hasPreferred = preferred && withBlank.some(o => o.value === preferred);

            const desired = hasPreferred ? preferred : (opts[0]?.value ?? '');

            setSelectOptions(methodCategorySel, withBlank, desired);
        }


        async function resetMethodOptionsForMethodCategory(methodCategoryId, { preferMethodId = null } = {}) {
            const mcid = normId(methodCategoryId); // FIX
            let loadedMethods = currentMethodsByCategory.get(mcid) || []; // CHANGED
            if (!loadedMethods.length) { // ADDED
                try {
                    loadedMethods = mcid
                        ? await PlantModel.listMethodsForMethodCategory(mcid)
                        : [];
                } catch (e) {
                    console.warn('[Scheduler] Falling back after method load failure', {
                        methodCategoryId: mcid,
                        reason: e?.message || String(e)
                    }); // FIX
                }
            }

            currentMethods = (loadedMethods || []).filter(methodRow => { // FIX: invalid DB methods must not enter the UI
                try {
                    resolveValidMethodRecord(methodRow, mcid);
                    return true;
                } catch (e) {
                    console.warn('[Scheduler] Skipping invalid method option', {
                        methodCategoryId: mcid,
                        methodId: methodRow?.method_id,
                        reason: e?.message || String(e)
                    });
                    return false;
                }
            });

            if (!currentMethods.length && mcid.toLowerCase() === 'direct_sow') {
                currentMethods = [{
                    method_category_id: 'direct_sow',
                    method_id: 'direct_sow.field',
                    method_name: 'Field direct sow'
                }]; // FIX: preserve the final canonical fallback without requiring a valid DB row
            }
            if (mcid && currentMethods.length) currentMethodsByCategory.set(mcid, currentMethods); // ADDED

            const opts = (currentMethods || []).map(m => ({
                value: normId(m.method_id), // FIX
                label: String(m.method_name || m.method_id || '').trim()
            })).filter(o => o.value);

            const withBlank = [{ value: '', label: '' }].concat(opts);

            const preferred = normId(preferMethodId); // FIX
            const hasPreferred = preferred && withBlank.some(o => o.value === preferred);

            const desired = hasPreferred ? preferred : (opts[0]?.value ?? '');

            setSelectOptions(methodSel, withBlank, desired);
        }

        function syncCombinedMethodControl() { // ADDED
            const desiredValue = encodeMethodSelection(methodCategorySel.value, methodSel.value); // ADDED
            combinedMethodSel.innerHTML = ''; // ADDED
            currentAllowedMethodCategories.forEach(category => { // ADDED
                const methodCategoryId = normId(category?.method_category_id); // ADDED
                const methods = currentMethodsByCategory.get(methodCategoryId) || []; // ADDED
                if (!methodCategoryId || !methods.length) return; // ADDED
                const group = document.createElement('optgroup'); // ADDED
                group.label = String(category?.method_category_name || methodCategoryId); // ADDED
                methods.forEach(method => { // ADDED
                    const methodId = normId(method?.method_id); // ADDED
                    if (!methodId) return; // ADDED
                    const option = document.createElement('option'); // ADDED
                    option.value = encodeMethodSelection(methodCategoryId, methodId); // ADDED
                    option.textContent = String(method?.method_name || methodId); // ADDED
                    group.appendChild(option); // ADDED
                }); // ADDED
                if (group.children.length) combinedMethodSel.appendChild(group); // ADDED
            }); // ADDED
            if (Array.from(combinedMethodSel.options).some(option => option.value === desiredValue)) { // ADDED
                combinedMethodSel.value = desiredValue; // ADDED
            } else if (combinedMethodSel.options[0]) { // ADDED
                combinedMethodSel.selectedIndex = 0; // ADDED
            } // ADDED
            const selected = decodeMethodSelection(combinedMethodSel.value); // ADDED
            if (selected) { // ADDED
                methodCategorySel.value = selected.methodCategoryId; // ADDED
                methodSel.value = selected.methodId; // ADDED
            } // ADDED
        } // ADDED


        // Prefill method category + method from existing cell attrs
        const cellMethodCategoryId0 = (() => {
            const raw = cell?.getAttribute?.('method_category_id');
            const s = String(raw ?? '').trim();
            return normId(s) || null; // FIX
        })();

        const cellMethodId0 = (() => {
            const raw = cell?.getAttribute?.('method_id')
            const s = String(raw ?? '').trim();
            return normId(s) || null; // FIX
        })();


        // initialize method category + method for initial plant (prefer persisted per-cell selection)
        await resetMethodOptionsForPlant(selPlant.plant_id, {
            preferMethodCategoryId: cellMethodCategoryId0
        });

        const preferredMethod0 = String(
            cellMethodId0
            ?? effectivePlant?.default_planting_method
            ?? ''
        );

        await resetMethodOptionsForMethodCategory(methodCategorySel.value, {
            preferMethodId: preferredMethod0
        });
        syncCombinedMethodControl(); // ADDED

        // Start/End inputs + auto buttons
        const initialStartISO = fmtISO(earliestFeasibleSowDate); // FIX: allow an explicitly empty no-window state
        const initialLatestHarvestEndISO = fmtISO(latestHarvestEndDate); // ADDED
        const initialSelectedHarvestEndISO = fmtISO(selectedHarvestEndDate); // ADDED

        // User-selectable derived sowing season // ADDED
        const sowingSeasonSel = makeSelect([], ''); // ADDED
        const sowingSeasonBoundsInput = makeDisplayField(''); // ADDED

        // User-controlled first sow date (used for schedule startISO)                   
        const startInput = makeDate(initialStartISO, false);

        // Auto-computed season end constraint (read-only for annuals, editable for perennials)
        const seasonEndInput = makeDate(initialLatestHarvestEndISO, true); // CHANGED

        const harvestStartInput = makeDisplayField('', { emphasis: true }); // CHANGED
        const harvestEndInput = makeDisplayField(initialSelectedHarvestEndISO); // CHANGED
        const daysToFirstHarvestInput = makeDisplayField(''); // CHANGED
        let userEditedStartThisSession = false; // FIX: distinguish session intent from persisted state

        const startNoteSpan = document.createElement('span');
        startNoteSpan.style.marginLeft = '8px'; startNoteSpan.style.fontSize = '12px'; startNoteSpan.style.color = '#92400e';
        startNoteSpan.textContent = startNote || '';

        // --- Harvest window
        const hwDefault = effectivePlant.defaultHW();
        const harvestWindowInput = makeNullableNumber(hwDefault ?? null, { min: 0, step: 1 });
        const minYieldMultInput = makeNumber(0.50, { min: 0 }); minYieldMultInput.step = '0.01';
        minYieldMultInput.max = '1';

        // --- Season control (single field) ---
        const seasonStartYear0 = finiteNumberOrNull(cell.getAttribute?.('season_start_year'))
            ?? earliestFeasibleSowDate?.getUTCFullYear?.()
            ?? (new Date()).getUTCFullYear(); // FIX
        const seasonYearInput = makeNumber(seasonStartYear0, { min: 1900 });
        seasonYearInput.step = '1';

        let taskTemplate = null;
        let taskRules = Array.isArray(taskTemplate?.rules) ? [...taskTemplate.rules] : [];
        // --- task reset helpers ----------------------------------------------------   
        let taskDirty = false;
        let taskTemplateResetRequested = false;
        let plantDefaultTaskDeleteRequested = false;

        const saveDefaultChk = makeCheckbox(false);
        const climateModelModuleCell = (() => { // ADDED
            const graph = ui?.editor?.graph; // ADDED
            const model = graph && typeof graph.getModel === 'function' ? graph.getModel() : null; // ADDED
            return model ? findGardenModuleAncestor(model, cell) : null; // ADDED
        })(); // ADDED

        // Prefill plant/variety from existing cell attrs
        const cellVarietyId0 = (() => {
            const raw = cell?.getAttribute?.('variety_id');
            const n = Number(raw);
            return Number.isFinite(n) && n > 0 ? n : null;
        })();

        // --- Central form state ---------------------------------------------------- 
        const formState = {
            plantId: initId,
            varietyId: cellVarietyId0,
            cityId: finiteNumberOrNull(selectedCityRow()?.city_id), // ADDED
            cityName: String(selectedCityRow()?.city_name || selectedCityOption()?.label || ''), // CHANGED

            // keep both (methodCategoryId is for UI + filtering; methodId is the scheduler “method” everywhere)
            methodCategoryId: methodCategorySel.value,
            methodId: methodSel.value,

            startISO: startInput.value,
            seasonEndISO: mode.perennial ? seasonEndInput.value : '', // CHANGED: reserve seasonEndISO for perennial lifespan end.
            latestHarvestEndISO: mode.perennial ? '' : initialLatestHarvestEndISO, // ADDED: annual display output is not a scheduling constraint.
            seasonStartYear: Number(seasonYearInput.value || (new Date()).getUTCFullYear()),
            harvestWindowDays: (harvestWindowInput.value === '' ? null : Number(harvestWindowInput.value)),
            minYieldMultiplier: Number(minYieldMultInput.value || 0),
            sowingSeasons: [], // ADDED
            activeSowingSeasonId: '', // ADDED
            windowFeasible: mode.perennial || !!initialWindowFeasible, // FIX
            firstHarvestISO: null, // CHANGED
            lastHarvestISO: mode.perennial ? null : initialSelectedHarvestEndISO, // CHANGED
            lastHarvestSource: 'auto',
            bedProfile: normalizeBedProfile(scheduleBedProfile), // ADDED: keep bed-aware soil modeling stable across form recomputes.
            bedProfileSource: String(scheduleBedProfileSource || 'generic garden bed'), // ADDED
            dailyClimate: initialDailyClimate, // ADDED
            dailyClimateKey: initialDailyClimateKey, // CHANGED
            climateModelModuleCell, // ADDED
            climateModelDraftPatch: null, // ADDED
            climateModelPolicy: DEFAULT_CLIMATE_MODEL_POLICY, // CHANGED
            scheduleWarnings: [] // ADDED
        };


        function syncStateFromControls() {
            formState.plantId = Number(plantSel.value);
            formState.varietyId = (varietySel && varietySel.value) ? Number(varietySel.value) : null;
            const selectedCity = selectedCityRow(); // ADDED
            formState.cityId = finiteNumberOrNull(selectedCity?.city_id); // ADDED
            formState.cityName = String(selectedCity?.city_name || selectedCityOption()?.label || ''); // CHANGED

            formState.methodCategoryId = normId(methodCategorySel.value); // FIX
            formState.methodId = normId(methodSel.value); // FIX

            formState.startISO = startInput.value;
            formState.activeSowingSeasonId = sowingSeasonSel.value || formState.activeSowingSeasonId || ''; // ADDED
            if (mode.perennial) formState.seasonEndISO = seasonEndInput.value; // CHANGED
            else formState.latestHarvestEndISO = seasonEndInput.value; // ADDED
            formState.seasonStartYear = Number(seasonYearInput.value || (new Date()).getUTCFullYear());
            formState.harvestWindowDays = (harvestWindowInput.value === '' ? null : Number(harvestWindowInput.value));
            formState.minYieldMultiplier = Number(minYieldMultInput.value || 0);
        }


        function syncControlsFromState({ start = false, end = false, harvest = false } = {}) { // CHANGED
            if (start) {
                startInput.value = formState.startISO || ''; // FIX: clear fabricated or stale auto dates
            }
            if (end) {
                seasonEndInput.value = mode.perennial ? (formState.seasonEndISO || '') : (formState.latestHarvestEndISO || ''); // CHANGED
            }
            if (harvest) { // CHANGED
                if (harvestStartInput) {
                    setDisplayFieldValue(harvestStartInput, formState.firstHarvestISO || ''); // CHANGED
                }
                if (harvestEndInput) {
                    setDisplayFieldValue(harvestEndInput, formState.lastHarvestISO || ''); // CHANGED
                }
            }
            updateDaysToFirstHarvest(); // CHANGED
            updateScheduleSummaryFromState(); // ADDED
        }

        function refreshSowingSeasonSelector() { // ADDED
            const selectorState = buildSowingSeasonSelectorState({ // ADDED
                sowingSeasons: formState.sowingSeasons, // ADDED
                activeSowingSeasonId: formState.activeSowingSeasonId, // ADDED
                startISO: formState.startISO // ADDED
            }); // ADDED
            while (sowingSeasonSel.firstChild) sowingSeasonSel.removeChild(sowingSeasonSel.firstChild); // ADDED
            selectorState.options.forEach(optionState => { // ADDED
                const opt = document.createElement('option'); // ADDED
                opt.value = optionState.value; // ADDED
                opt.textContent = optionState.label; // ADDED
                opt.disabled = !!optionState.disabled; // ADDED
                sowingSeasonSel.appendChild(opt); // ADDED
            }); // ADDED
            sowingSeasonSel.value = selectorState.value; // ADDED
            setDisplayFieldValue(sowingSeasonBoundsInput, selectorState.boundsText); // ADDED
        } // ADDED

        function syncStartDateBounds() { // CHANGED
            if (!startInput) return; // CHANGED
            startInput.min = ''; // CHANGED
            startInput.max = ''; // CHANGED
        } // CHANGED

        function updateDaysToFirstHarvest() { // CHANGED
            const sow = parseISODateUTC(formState.startISO); // CHANGED
            const harvest = parseISODateUTC(formState.firstHarvestISO); // CHANGED

            if (!sow || !harvest) { // CHANGED
                setDisplayFieldValue(daysToFirstHarvestInput, ''); // CHANGED
                return; // CHANGED
            } // CHANGED

            const dtm = daysBetweenUTC(sow, harvest); // CHANGED
            setDisplayFieldValue(daysToFirstHarvestInput, String(dtm)); // CHANGED
        } // CHANGED

        // -------------------- Form schema for simple labeled fields ---------------- 
        const FIELD_SCHEMA = [
            { key: 'seasonStartYear', label: 'Season start year:', control: seasonYearInput },
            { key: 'cityName', label: 'City:', control: citySel, tooltip: 'City climate is resolved by city_id when available; Garden Settings owns city climate edits.' }, // CHANGED
            { key: 'methodSelection', label: 'Planting method:', control: combinedMethodSel }, // CHANGED
            { key: 'harvestWindowDays', label: 'Harvest window days:', control: harvestWindowInput },
            { key: 'minYieldMultiplier', label: 'Minimum yield multiplier:', control: minYieldMultInput },
        ];

        const { fieldRows } = buildFieldRows(FIELD_SCHEMA);
        // ----------------------------------------------------------

        // Load varieties and preselect from cell                                     
        await reloadVarietyOptionsForPlant(formState.plantId, formState.varietyId);
        syncVarietyButtons();

        // Ensure the selected value actually exists; if not, fall back to base plant 
        if (formState.varietyId != null && !String(varietySel.value)) {
            formState.varietyId = null;
        }

        syncStateFromControls();
        await refreshEffectivePlant();
        await resetMethodOptionsForPlant(formState.plantId, {
            preferMethodCategoryId: String(formState.methodCategoryId ?? cellMethodCategoryId0 ?? '')
        });

        await resetMethodOptionsForMethodCategory(methodCategorySel.value, {
            preferMethodId: String(formState.methodId ?? cellMethodId0 ?? effectivePlant?.default_planting_method ?? '')
        });
        syncCombinedMethodControl(); // ADDED


        const sowingSeasonRowObj = row('Sowing season:', sowingSeasonSel); // ADDED
        const sowingSeasonBoundsRowObj = row('Sowing window:', sowingSeasonBoundsInput); // CHANGED
        setTooltip(sowingSeasonRowObj.label, 'Selectable season generated from the annual scheduler feasibility scan.'); // ADDED
        setTooltip(sowingSeasonSel, 'Choose the feasible sowing season to schedule within.'); // ADDED
        setTooltip(sowingSeasonBoundsRowObj.label, 'Date bounds for the selected sowing season.'); // ADDED
        setTooltip(sowingSeasonBoundsInput, 'Earliest and latest sow dates for the selected sowing season.'); // ADDED

        const firstSowRowObj = row('Sow date:', startInput); // CHANGED
        if (startNote) firstSowRowObj.row.appendChild(startNoteSpan); // CHANGED

        const endRow = row('Latest harvest end:', seasonEndInput); // CHANGED
        const harvestStartRowObj = row('Expected first harvest:', harvestStartInput); // CHANGED
        const harvestEndRowObj = row('Expected harvest end:', harvestEndInput); // CHANGED
        const daysToFirstHarvestRowObj = row('Days to first harvest:', daysToFirstHarvestInput); // CHANGED

        appendFieldRows(contextSection.body, fieldRows, ['seasonStartYear', 'cityName', 'methodSelection']); // CHANGED
        const legacyMethodControls = document.createElement('div'); // ADDED
        legacyMethodControls.style.display = 'none'; // ADDED
        legacyMethodControls.appendChild(methodCategorySel); // ADDED
        legacyMethodControls.appendChild(methodSel); // ADDED
        contextSection.body.appendChild(legacyMethodControls); // ADDED

        const contextSummary = document.createElement('div'); // ADDED
        contextSummary.style.marginTop = '8px'; // ADDED
        contextSummary.style.padding = '6px 8px'; // ADDED
        contextSummary.style.border = '1px solid #d1d5db'; // ADDED
        contextSummary.style.background = '#f9fafb'; // ADDED
        contextSummary.style.borderRadius = '4px'; // ADDED
        contextSummary.style.fontSize = '12px'; // ADDED
        contextSummary.style.color = '#374151'; // ADDED
        contextSection.body.appendChild(contextSummary); // ADDED

        function refreshContextSummary() { // ADDED
            const bed = normalizeBedProfile(formState.bedProfile); // ADDED
            const gardenName = formatGardenName(climateModelModuleCell); // ADDED
            const cityName = String(formState.cityName || citySel.value || '').trim() || '(no city)'; // ADDED
            const bedSource = String(formState.bedProfileSource || 'generic garden bed'); // ADDED
            const bedText = `sun ${prettifyBedConditionValue(bed.sunExposure)}; moisture ${prettifyBedConditionValue(bed.soilMoisture)}; drainage ${prettifyBedConditionValue(bed.drainage)}; texture ${prettifyBedConditionValue(bed.soilTexture)}; frost ${prettifyBedConditionValue(bed.frostRisk)}`; // ADDED
            contextSummary.textContent = `${gardenName} | ${cityName} | ${bedSource} | ${bedText}`; // ADDED
            setTooltip(contextSummary, `Garden: ${gardenName}\nCity: ${cityName}\nBed source: ${bedSource}\nBed conditions: ${bedText}`); // ADDED
        } // ADDED

        windowSection.body.appendChild(sowingSeasonRowObj.row); // CHANGED
        windowSection.body.appendChild(sowingSeasonBoundsRowObj.row); // CHANGED
        windowSection.body.appendChild(endRow.row); // CHANGED

        inputsSection.body.appendChild(firstSowRowObj.row); // CHANGED
        const climateSection = makeSection('Climate model'); // ADDED
        climateSection.wrap.style.marginTop = '10px'; // ADDED
        advancedBody.appendChild(climateSection.wrap); // ADDED
        const climateControlByKey = {}; // ADDED
        const setAsGardenClimateDefaultChk = makeCheckbox(false); // ADDED
        let climateTipVersion = 0; // ADDED

        function makeClimateOverrideInput(def) { // ADDED
            if (def.type === 'enum') { // ADDED
                return makeSelect(def.options.map(([value, label]) => ({ value, label })), DEFAULT_CLIMATE_MODEL_POLICY[def.key]); // ADDED
            } // ADDED
            if (def.type === 'boolean') { // ADDED
                return makeCheckbox(DEFAULT_CLIMATE_MODEL_POLICY[def.key]); // ADDED
            } // ADDED
            const input = makeNullableNumber(DEFAULT_CLIMATE_MODEL_POLICY[def.key], { min: def.min, step: def.step }); // ADDED
            input.max = String(def.max); // ADDED
            return input; // ADDED
        } // ADDED

        function readClimateOverrideInputValue(def, input) { // ADDED
            if (def.type === 'boolean') return !!input.checked; // ADDED
            if (def.type === 'enum') return String(input.value || DEFAULT_CLIMATE_MODEL_POLICY[def.key]); // ADDED
            const n = finiteNumberOrNull(input.value); // ADDED
            if (def.type === 'integer') return Math.max(def.min, Math.min(def.max, Math.round(n ?? DEFAULT_CLIMATE_MODEL_POLICY[def.key]))); // ADDED
            return Math.max(def.min, Math.min(def.max, n ?? DEFAULT_CLIMATE_MODEL_POLICY[def.key])); // ADDED
        } // ADDED

        function setClimateOverrideInputValue(def, input, value) { // ADDED
            const normalized = normalizeClimateModelPatch({ [def.key]: value }); // ADDED
            const next = Object.prototype.hasOwnProperty.call(normalized, def.key) ? normalized[def.key] : DEFAULT_CLIMATE_MODEL_POLICY[def.key]; // ADDED
            if (def.type === 'boolean') input.checked = !!next; // ADDED
            else input.value = String(next); // ADDED
        } // ADDED

        function formatClimateModelValue(def, value) { // ADDED
            if (def.type === 'boolean') return value ? 'Enabled' : 'Disabled'; // ADDED
            if (def.type === 'number') return Number(value).toFixed(2); // ADDED
            return String(value); // ADDED
        } // ADDED

        function climateModelTooltipFor(def) { // ADDED
            const map = { // ADDED
                springFrostRisk: 'Frost percentile used for the field frost gate. The tip shows the selected season-year date when city data exists.', // ADDED
                weatherNormalsSource: 'Preferred source for monthly temperature normals. Auto chooses monthly weather, daily weather, then city monthly columns.', // ADDED
                forecastBlendWeight0To3Days: 'Weight applied to forecast temperatures for dates 0-3 days ahead. 1 uses forecast only; 0 uses normals only.', // ADDED
                forecastBlendWeight4To7Days: 'Weight applied to forecast temperatures for dates 4-7 days ahead.', // ADDED
                forecastBlendWeight8To16Days: 'Weight applied to forecast temperatures for dates 8-16 days ahead.', // ADDED
                soilGateConsecutiveDays: 'Number of consecutive days the estimated soil temperature must meet the crop threshold.', // ADDED
                gddCalibrationEnabled: 'When enabled, daily crop GDD is scaled to the city annual GDD target when city GDD metadata exists.' // ADDED
            }; // ADDED
            return map[def.key] || def.label; // ADDED
        } // ADDED

        async function refreshClimateModelTips() { // ADDED
            const version = ++climateTipVersion; // ADDED
            let city = null; // ADDED
            try { city = await CityClimate.resolve({ cityId: formState.cityId, cityName: formState.cityName }); } catch (_) { city = null; } // CHANGED
            if (version !== climateTipVersion) return; // ADDED
            const policy = formState.climateModelPolicy || DEFAULT_CLIMATE_MODEL_POLICY; // ADDED
            const frostControl = climateControlByKey.springFrostRisk; // ADDED
            if (frostControl) { // ADDED
                const tip = city ? resolveFrostRiskTip(city, policy.springFrostRisk, formState.seasonStartYear) : { text: 'City not found', tooltip: 'The selected city could not be loaded, so no frost date can be shown.' }; // ADDED
                frostControl.tip.textContent = tip.text; // ADDED
                setTooltip(frostControl.tip, tip.tooltip); // ADDED
                setTooltip(frostControl.effective, `${frostControl.effective.textContent}. ${tip.tooltip}`); // ADDED
            } // ADDED
            const weatherControl = climateControlByKey.weatherNormalsSource; // ADDED
            if (weatherControl) { // ADDED
                let status = { text: 'Checking source...', tooltip: 'Checking weather source availability.' }; // ADDED
                if (city) { // ADDED
                    try { status = await resolveWeatherNormalsSourceStatus(city, policy.weatherNormalsSource); } // ADDED
                    catch (e) { status = { text: 'Source check failed', tooltip: e?.message || String(e) }; } // ADDED
                } else { // ADDED
                    status = { text: 'City not found', tooltip: 'The selected city could not be loaded, so weather-source availability cannot be checked.' }; // ADDED
                } // ADDED
                if (version !== climateTipVersion) return; // ADDED
                weatherControl.tip.textContent = status.text; // ADDED
                setTooltip(weatherControl.tip, status.tooltip); // ADDED
                setTooltip(weatherControl.effective, `${weatherControl.effective.textContent}. ${status.tooltip}`); // ADDED
            } // ADDED
        } // ADDED

        function buildClimateModelPatchFromControls() { // ADDED
            const patch = {}; // ADDED
            CLIMATE_MODEL_PARAMETER_SCHEMA.forEach(function (def) { // ADDED
                const control = climateControlByKey[def.key]; // ADDED
                if (!control || control.defaultChk.checked) return; // ADDED
                patch[def.key] = readClimateOverrideInputValue(def, control.input); // ADDED
            }); // ADDED
            return normalizeClimateModelPatch(patch); // ADDED
        } // ADDED

        function refreshClimateModelControls({ preserveDraft = true } = {}) { // ADDED
            const saved = resolveClimateModelPolicy(climateModelModuleCell, formState.cityName, formState.plantId, null); // ADDED
            const draft = preserveDraft ? formState.climateModelDraftPatch : saved.plantPatch; // ADDED
            formState.climateModelDraftPatch = normalizeClimateModelPatch(draft); // ADDED
            const resolved = resolveClimateModelPolicy(climateModelModuleCell, formState.cityName, formState.plantId, formState.climateModelDraftPatch); // ADDED
            formState.climateModelPolicy = resolved.effective; // ADDED
            CLIMATE_MODEL_PARAMETER_SCHEMA.forEach(function (def) { // ADDED
                const control = climateControlByKey[def.key]; // ADDED
                if (!control) return; // ADDED
                const hasOverride = Object.prototype.hasOwnProperty.call(formState.climateModelDraftPatch, def.key); // ADDED
                control.defaultChk.checked = !hasOverride; // ADDED
                control.input.disabled = !hasOverride; // ADDED
                setClimateOverrideInputValue(def, control.input, hasOverride ? formState.climateModelDraftPatch[def.key] : resolved.effective[def.key]); // ADDED
                control.effective.textContent = `${formatClimateModelValue(def, resolved.effective[def.key])} (${resolved.sources[def.key]})`; // ADDED
                setTooltip(control.input, climateModelTooltipFor(def)); // ADDED
                setTooltip(control.effective, `${def.label}: ${formatClimateModelValue(def, resolved.effective[def.key])}; source ${resolved.sources[def.key]}. ${climateModelTooltipFor(def)}`); // ADDED
            }); // ADDED
            void refreshClimateModelTips(); // ADDED
        } // ADDED

        function handleClimateModelControlChanged() { // ADDED
            formState.climateModelDraftPatch = buildClimateModelPatchFromControls(); // ADDED
            refreshClimateModelControls({ preserveDraft: true }); // ADDED
        } // ADDED

        function buildClimateModelModuleAttributePatch() { // ADDED
            if (!climateModelModuleCell) return null; // ADDED
            const plantPatch = buildClimateModelPatchFromControls(); // ADDED
            const overrideMap = readClimateModelPlantOverrideMap(climateModelModuleCell); // ADDED
            const normalizedMap = {}; // ADDED
            Object.keys(overrideMap || {}).forEach(function (key) { // ADDED
                const patch = normalizeClimateModelPatch(overrideMap[key]); // ADDED
                if (Object.keys(patch).length) normalizedMap[key] = patch; // ADDED
            }); // ADDED
            const overrideKey = buildClimatePlantOverrideKey(formState.cityName, formState.plantId); // ADDED
            if (Object.keys(plantPatch).length) normalizedMap[overrideKey] = plantPatch; // ADDED
            else delete normalizedMap[overrideKey]; // ADDED
            const patch = { [CLIMATE_MODEL_PLANT_OVERRIDES_ATTR]: stringifyClimateModelAttr(normalizedMap) }; // ADDED
            if (setAsGardenClimateDefaultChk.checked) { // ADDED
                patch[CLIMATE_MODEL_DEFAULTS_ATTR] = stringifyClimateModelAttr(plantPatch); // ADDED
            } // ADDED
            return { cell: climateModelModuleCell, patch }; // ADDED
        } // ADDED

        CLIMATE_MODEL_PARAMETER_SCHEMA.forEach(function (def) { // ADDED
            const rowWrap = document.createElement('div'); // ADDED
            rowWrap.style.display = 'grid'; // ADDED
            rowWrap.style.gridTemplateColumns = '180px 90px minmax(120px, 1fr) minmax(160px, 1fr)'; // ADDED
            rowWrap.style.gap = '8px'; // ADDED
            rowWrap.style.alignItems = 'center'; // ADDED
            rowWrap.style.margin = '6px 0'; // ADDED

            const label = document.createElement('label'); // ADDED
            label.textContent = def.label; // ADDED
            label.style.fontSize = '13px'; // ADDED
            setTooltip(label, climateModelTooltipFor(def)); // ADDED

            const defaultLabel = document.createElement('label'); // ADDED
            defaultLabel.style.display = 'flex'; // ADDED
            defaultLabel.style.gap = '4px'; // ADDED
            defaultLabel.style.alignItems = 'center'; // ADDED
            const defaultChk = makeCheckbox(true); // ADDED
            defaultLabel.appendChild(defaultChk); // ADDED
            defaultLabel.appendChild(document.createTextNode('Default')); // ADDED
            setTooltip(defaultLabel, `Checked: inherit ${def.label} from the garden model or built-in scheduler default. Unchecked: save a plant override for this city and plant.`); // ADDED

            const input = makeClimateOverrideInput(def); // ADDED
            input.disabled = true; // ADDED

            const effective = document.createElement('div'); // ADDED
            effective.style.fontSize = '12px'; // ADDED
            effective.style.color = '#4b5563'; // ADDED

            const tip = document.createElement('div'); // ADDED
            tip.style.fontSize = '11px'; // ADDED
            tip.style.color = '#6b7280'; // ADDED
            tip.style.lineHeight = '1.25'; // ADDED

            const effectiveWrap = document.createElement('div'); // ADDED
            effectiveWrap.appendChild(effective); // ADDED
            effectiveWrap.appendChild(tip); // ADDED

            rowWrap.appendChild(label); // ADDED
            rowWrap.appendChild(defaultLabel); // ADDED
            rowWrap.appendChild(input); // ADDED
            rowWrap.appendChild(effectiveWrap); // ADDED
            climateSection.body.appendChild(rowWrap); // ADDED
            climateControlByKey[def.key] = { def, defaultChk, input, effective, tip }; // ADDED

            defaultChk.addEventListener('change', () => { // ADDED
                input.disabled = defaultChk.checked; // ADDED
                handleClimateModelControlChanged(); // ADDED
                void runUiAsync('Climate model change error', async () => { await recomputeAll('climateModelChanged'); }); // ADDED
            }); // ADDED
            input.addEventListener('input', () => { // ADDED
                handleClimateModelControlChanged(); // ADDED
                void runUiAsync('Climate model change error', async () => { await recomputeAll('climateModelChanged'); }); // ADDED
            }); // ADDED
            input.addEventListener('change', () => { // ADDED
                handleClimateModelControlChanged(); // ADDED
                void runUiAsync('Climate model change error', async () => { await recomputeAll('climateModelChanged'); }); // ADDED
            }); // ADDED
        }); // ADDED

        const setDefaultRow = row('Set as default climate model for this garden:', setAsGardenClimateDefaultChk); // ADDED
        setTooltip(setDefaultRow.label, 'When checked on Save, the unchecked climate override rows become the garden-level climate defaults.'); // ADDED
        setTooltip(setAsGardenClimateDefaultChk, 'Save the currently unchecked climate rows as defaults for this garden module.'); // ADDED
        climateSection.body.appendChild(setDefaultRow.row); // ADDED
        refreshClimateModelControls({ preserveDraft: false }); // ADDED
        refreshContextSummary(); // ADDED

        appendFieldRows(harvestSection.body, fieldRows, ['harvestWindowDays', 'minYieldMultiplier']); // CHANGED
        harvestSection.body.appendChild(harvestStartRowObj.row); // CHANGED
        harvestSection.body.appendChild(harvestEndRowObj.row); // CHANGED
        harvestSection.body.appendChild(daysToFirstHarvestRowObj.row); // CHANGED

        const baseStartNote = startNote || '';
        let windowActions = null; // FIX: mode rendering owns perennial-only action visibility

        function updateScheduleSummaryFromState() { // ADDED
            const varietyOption = varietySel?.selectedOptions?.[0]; // ADDED
            const varietyName = varietySel?.value ? String(varietyOption?.textContent || '').trim() : ''; // ADDED
            const methodName = String(combinedMethodSel?.selectedOptions?.[0]?.textContent || '').trim(); // ADDED
            updateScheduleSummary(summaryView, buildScheduleViewState({ // ADDED
                perennial: mode.perennial, // ADDED
                windowFeasible: formState.windowFeasible, // ADDED
                plantName: effectivePlant?.plant_name || selPlant?.plant_name || '', // ADDED
                varietyName, // ADDED
                cityName: formState.cityName, // ADDED
                seasonStartYear: formState.seasonStartYear, // ADDED
                methodName, // ADDED
                startISO: formState.startISO, // ADDED
                sowingSeasons: formState.sowingSeasons, // CHANGED
                activeSowingSeasonId: formState.activeSowingSeasonId, // ADDED
                firstHarvestISO: formState.firstHarvestISO, // ADDED
                lastHarvestISO: formState.lastHarvestISO, // CHANGED
                scheduleWarnings: formState.scheduleWarnings // ADDED
            })); // ADDED
        } // ADDED

        function applyModeToUI() {
            const perennial = mode.perennial;

            if (perennial) {
                firstSowRowObj.label.textContent = 'Planting date:'; // CHANGED
                endRow.label.textContent = 'Lifespan end:'; // CHANGED
                harvestStartRowObj.row.style.display = 'none'; // CHANGED
                harvestEndRowObj.row.style.display = 'none'; // CHANGED
                daysToFirstHarvestRowObj.row.style.display = 'none'; // CHANGED
            } else {
                firstSowRowObj.label.textContent = 'Sow date:'; // CHANGED
                endRow.label.textContent = 'Latest harvest end:'; // CHANGED
                harvestStartRowObj.row.style.display = ''; // CHANGED
                harvestEndRowObj.row.style.display = ''; // CHANGED
                daysToFirstHarvestRowObj.row.style.display = ''; // CHANGED
            }

            sowingSeasonRowObj.row.style.display = perennial ? 'none' : ''; // CHANGED
            sowingSeasonBoundsRowObj.row.style.display = perennial ? 'none' : ''; // CHANGED
            timelineSection.wrap.style.display = perennial ? 'none' : ''; // CHANGED
            if (windowActions) windowActions.style.display = perennial ? 'none' : ''; // FIX

            seasonEndInput.disabled = !perennial; // CHANGED
            updateScheduleSummaryFromState(); // ADDED
        }


        function updateStartNote() {
            if (!startNoteSpan) return;
            const classification = classifySelectedSowDate({ // CHANGED
                perennial: mode.perennial, // CHANGED
                windowFeasible: formState.windowFeasible, // CHANGED
                startISO: formState.startISO, // CHANGED
                sowingSeasons: formState.sowingSeasons, // CHANGED
                activeSowingSeasonId: formState.activeSowingSeasonId // ADDED
            }); // CHANGED
            const parts = [];
            const warningText = summarizeScheduleWarnings(formState.scheduleWarnings); // ADDED
            if (warningText) parts.push(warningText); // ADDED
            if (!mode.perennial && classification.status !== 'feasible') parts.push(classification.label); // CHANGED
            if (baseStartNote && classification.status === 'no_window' && baseStartNote !== 'No feasible window.') parts.push(baseStartNote); // CHANGED

            startNoteSpan.textContent = parts.join(' ');
        }

        function syncScheduleWarningState(warnings = []) { // ADDED
            formState.scheduleWarnings = Array.isArray(warnings) ? Array.from(warnings) : []; // ADDED
            updateStartNote(); // ADDED
            updateScheduleSummaryFromState(); // ADDED
        } // ADDED

        function clearScheduleWarningState() { // ADDED
            syncScheduleWarningState([]); // ADDED
        } // ADDED

        function requireSelectedScheduleDate() { // CHANGED
            if (mode.perennial) return; // CHANGED
            if (!parseISODateUTCValue(formState.startISO)) throw new Error('Select a sow date.'); // CHANGED
        } // ADDED


        // recomputeAnchors:
        //  - concern: climate feasibility window (earliest sow, last feasible sow, climate last harvest)
        //  - does NOT decide scheduling or yield
        //  - allowed to change latestHarvestEndISO ONLY when called with forceWriteEnd=true
        async function recomputeAnchors(forceWriteStart = false, forceWriteEnd = false) {
            try {
                if (mode.perennial) return true; // FIX: lifespan dates are recomputed by recomputeAll

                syncStateFromControls();
                clearScheduleWarningState(); // ADDED

                await refreshEffectivePlant();
                const p = effectivePlant;


                const city = await CityClimate.resolve({ cityId: formState.cityId, cityName: formState.cityName }); // CHANGED
                if (!city) throw new Error(`City not found: ${formState.cityName}`); // FIX

                const seasonStartYear = formState.seasonStartYear;

                const env = p.cropTempEnvelope();
                const budget = p.firstHarvestBudget();

                const HW_DAYS = resolveHarvestWindowDays(formState.harvestWindowDays, p); // FIX: use the canonical fallback

                const overwinterAllowed = isCrossYearCrop(p); // FIX: biennials may harvest in a later year
                const scanStart = asUTCDate(seasonStartYear, 1, 1);
                const scanEndYear = seasonStartYear + getPlantScanYears(p) - 1; // FIX: honor biennial and perennial lifespans
                const scanEndHard = asUTCDate(scanEndYear, 12, 31);
                const climateResolution = resolveClimateModelPolicy(climateModelModuleCell, formState.cityName, formState.plantId, formState.climateModelDraftPatch); // ADDED
                const climatePolicy = climateResolution.effective; // ADDED
                formState.climateModelPolicy = climatePolicy; // ADDED
                const dailyClimate = await city.loadDailyClimateModel({ scanStart, scanEndHard, climatePolicy }); // CHANGED
                formState.dailyClimate = dailyClimate; // ADDED
                formState.dailyClimateKey = `${city.city_name || formState.cityName}|${fmtISO(scanStart)}|${fmtISO(scanEndHard)}|${JSON.stringify(climatePolicy)}`; // CHANGED
                const dailyRates = city.dailyRates(env.Tbase, seasonStartYear, climatePolicy); // CHANGED
                const monthlyAvgTemp = city.monthlyMeans(); // CHANGED: physical temperatures stay unshifted; GDD scaling is in daily climate rates.

                const soilGateThresholdC = (Number.isFinite(Number(p.soil_temp_min_plant_c))
                    ? Number(p.soil_temp_min_plant_c)
                    : null);

                const methodCategoryId = normId(formState.methodCategoryId); // FIX
                const methodId = normId(formState.methodId); // FIX
                const daysTransplant = Number.isFinite(Number(p.days_transplant)) ? Number(p.days_transplant) : 0;

                const lsf = pickFrostByRisk(city, climatePolicy.springFrostRisk); // CHANGED

                const r = annualCore.computeAnnualSowingSeasons({ // CHANGED
                    methodCategoryId, // CHANGED
                    methodId, // CHANGED
                    budget,
                    HW_DAYS,
                    dailyRatesMap: dailyRates,
                    monthlyAvgTemp,
                    dailyClimate, // ADDED
                    Tbase: env.Tbase,
                    cropTemp: env,
                    scanStart,
                    scanEndHard,
                    soilGateThresholdC,
                    soilGateConsecutiveDays: climatePolicy.soilGateConsecutiveDays, // CHANGED
                    startCoolingThresholdC: asCoolingThresholdC(p.start_cooling_threshold_c),
                    useSpringFrostGate: true, // FIX: overwinter support does not disable field frost checks
                    lastSpringFrostDOY: lsf,
                    daysTransplant,
                    overwinterAllowed,
                    plantMetadata: p, // ADDED
                    cityLatitudeDeg: finiteNumberOrNull(city.latitude ?? city.lat), // CHANGED
                    bedProfile: formState.bedProfile, // ADDED
                    bedProfileSource: formState.bedProfileSource // ADDED
                });

                console.log('[recomputeAnchors] result', {
                    forceWriteStart,
                    forceWriteEnd,
                    startISO_before: formState.startISO,
                    latestHarvestEndISO_before: formState.latestHarvestEndISO, // CHANGED
                    sowingSeasons: r.seasons ? r.seasons.map(season => season.label) : [], // CHANGED
                    climateEndDate: r.climateEndDate ? fmtISO(r.climateEndDate) : null, // CHANGED
                    lastFeasibleSowDate: r.lastFeasibleSowDate ? fmtISO(r.lastFeasibleSowDate) : null
                });

                const windows = normalizeSowingSeasons(r.seasons); // CHANGED
                const windowFeasible = windows.length > 0; // CHANGED
                const today = new Date(); // ADDED
                const todayISO = fmtISO(asUTCDate(today.getUTCFullYear(), today.getUTCMonth() + 1, today.getUTCDate())); // ADDED
                const currentActive = windows.find(window => window.id === formState.activeSowingSeasonId); // ADDED
                const savedWindow = hasPersistedSchedule && !userEditedStartThisSession
                    ? findSowingSeasonForDate(windows, formState.startISO)
                    : null; // ADDED
                const savedDateIsOrphan = hasPersistedSchedule && !userEditedStartThisSession && !!formState.startISO && !savedWindow; // ADDED
                const nextActiveId = savedWindow
                    ? savedWindow.id
                    : (savedDateIsOrphan ? ORPHAN_SOWING_SEASON_ID : ((!forceWriteStart && currentActive) ? currentActive.id : pickDefaultSowingSeasonId(windows, { savedStartISO: hasPersistedSchedule ? formState.startISO : '', todayISO }))); // CHANGED

                const autoHarvestISO = r.climateEndDate
                    ? r.climateEndDate.toISOString().slice(0, 10)
                    : null; // CHANGED

                // Store selectable sowing seasons for display/guidance. // CHANGED
                formState.sowingSeasons = windows; // CHANGED
                formState.activeSowingSeasonId = nextActiveId; // ADDED
                formState.windowFeasible = windowFeasible; // CHANGED
                formState.firstHarvestISO = null; // CHANGED
                formState.lastHarvestISO = autoHarvestISO; // ADDED

                // Optionally reset user-chosen first sow date to earliest           
                const preserveGenuineStart = hasPersistedSchedule || userEditedStartThisSession; // FIX
                const activeWindow = getActiveSowingSeason(formState); // ADDED
                formState.startISO = resolveStartAfterWindow({
                    currentStartISO: formState.startISO,
                    activeWindow,
                    feasible: windowFeasible,
                    forceWriteStart,
                    hasPersistedSchedule,
                    userEditedStartThisSession,
                    todayISO
                }); // FIX
                if (windowFeasible && forceWriteStart) {
                    hasPersistedSchedule = false; // FIX: the replacement is generated, not the stored schedule
                    userEditedStartThisSession = false; // FIX
                }

                // let auto window drive the annual latest-harvest display date when requested
                if (windowFeasible && forceWriteEnd && r.climateEndDate instanceof Date) {
                    formState.latestHarvestEndISO = r.climateEndDate.toISOString().slice(0, 10); // CHANGED
                } else if (!windowFeasible) {
                    formState.latestHarvestEndISO = ''; // FIX: clear derived annual display end when the window is infeasible
                }

                refreshSowingSeasonSelector(); // ADDED

                syncControlsFromState({
                    start: forceWriteStart || !preserveGenuineStart || !windowFeasible,
                    end: forceWriteEnd || !windowFeasible,
                    harvest: true
                });

                updateStartNote();
                syncStartDateBounds(); // CHANGED
                if (!windowFeasible) {
                    clearComputedHarvestResult(); // FIX
                    showErrorInline('No feasible window.'); // FIX
                    return false;
                }
                clearErrorInline(); // FIX: clear stale no-window warning after feasibility recovers
                return true; // FIX: allow dependent recomputation only after valid anchors
            } catch (e) {
                console.warn('recomputeAnchors error:', e);
                clearComputedHarvestResult(); // FIX: anchor failure invalidates all schedule-derived harvest state
                showErrorInline('Scheduling error: ' + (e?.message || String(e)));
                return false; // FIX
            }
        }

        // --- mode switcher (annual <-> perennial) ---
        function computePerennialEndISO(fromISO, lifespanYears) {
            return computePerennialLifespanEndISO(
                fromISO,
                Number(seasonYearInput.value),
                lifespanYears
            ); // FIX
        }

        function setPerennialMode(on, plant) {
            mode = getModeForPlant(plant);

            if (mode.perennial) {
                const lifespanYears = requirePerennialLifespanYears(plant); // FIX
                // Ensure start date exists                                           
                if (!startInput.value) {
                    const sISO = asUTCDate(Number(seasonYearInput.value), 1, 1)
                        .toISOString().slice(0, 10);
                    startInput.value = sISO;
                }

                // Compute lifespan end based on current start                         
                seasonEndInput.value = computePerennialEndISO(
                    startInput.value,
                    lifespanYears
                );

                formState.startISO = startInput.value;
                formState.seasonEndISO = seasonEndInput.value;
                formState.latestHarvestEndISO = ''; // ADDED: perennial lifespan end is not annual display state.
                formState.firstHarvestISO = null; // CHANGED
                formState.lastHarvestISO = null; // FIX: lifespan end is not a harvest date
                clearScheduleWarningState(); // CHANGED
                formState.lastScheduleEndISO = formState.seasonEndISO; // CHANGED
                syncStateFromControls();
                formState.sowingSeasons = []; // ADDED
                formState.activeSowingSeasonId = ''; // ADDED
                formState.windowFeasible = true; // FIX

            } else {
                // Non-perennial: reset HW default and clear dirty flag               
                harvestWindowInput.value = (plant?.defaultHW() ?? '').toString();
                formState.seasonEndISO = ''; // ADDED: annual schedules use lifecycle scan end internally.
                syncStateFromControls();
            }

            applyModeToUI();
        }

        // recomputeAll:
        //  - concern: policy: when to let climate auto window override constraint
        //  - enforce: annual latestHarvestEndISO and perennial seasonEndISO stay separate
        async function recomputeAll(reason) {
            syncStateFromControls();
            refreshContextSummary(); // ADDED
            void refreshClimateModelTips(); // ADDED

            const isPerennial = mode.perennial;

            if (isPerennial) {
                const lifespanYears = requirePerennialLifespanYears(effectivePlant); // FIX
                const endISO = computePerennialEndISO(
                    startInput.value,
                    lifespanYears
                );

                seasonEndInput.value = endISO;
                formState.seasonEndISO = endISO;
                formState.latestHarvestEndISO = ''; // ADDED: perennial lifespan end is not annual display state.

                formState.firstHarvestISO = null; // CHANGED
                formState.lastHarvestISO = null; // FIX: lifespan-only schedules have no inferred harvest
                clearScheduleWarningState(); // CHANGED
                formState.lastScheduleEndISO = endISO; // CHANGED
                formState.lastHarvestSource = 'user'; // CHANGED
                formState.windowFeasible = true; // FIX

                if (harvestStartInput) {
                    setDisplayFieldValue(harvestStartInput, ''); // CHANGED
                }
                if (harvestEndInput) {
                    setDisplayFieldValue(harvestEndInput, ''); // FIX
                }

                updateDaysToFirstHarvest(); // CHANGED

                syncStartDateBounds(); // CHANGED
                updateTimeline(); // CHANGED
                refreshContextSummary(); // ADDED
                void refreshClimateModelTips(); // ADDED
                return true; // FIX
            }


            switch (reason) {

                case 'varietyChanged': {
                    await recomputeAnchors(true, true); // CHANGED
                    await recomputeLastHarvestFromSchedule();
                    break;
                }

                case 'yearChanged': {
                    // season → refresh both start and end from feasibility
                    await recomputeAnchors(true, true); // CHANGED

                    await recomputeLastHarvestFromSchedule();
                    break;
                }

                case 'plantChanged': {
                    // City/method/plant change → respect user sow date if dirty
                    await recomputeAnchors(true, true); // CHANGED

                    await recomputeLastHarvestFromSchedule();
                    break;
                }

                case 'cityChanged':
                case 'climateModelChanged': // ADDED
                case 'methodChanged': {
                    // City/method change → keep user sow date if dirty,              
                    // but don't force end update unless you want to:                 
                    await recomputeAnchors(false, false); // CHANGED

                    await recomputeLastHarvestFromSchedule();
                    break;
                }

                case 'startChanged':
                    // User explicitly changed first sow; keep it, but recompute schedule 
                    await recomputeAnchors(false, false); // CHANGED
                    await recomputeLastHarvestFromSchedule();
                    break;

                case 'hwChanged': {
                    await recomputeAnchors(false, false); // CHANGED
                    await recomputeLastHarvestFromSchedule();
                    break;
                }

            }

            // Keep everything in sync, including schedule-derived last harvest
            syncControlsFromState({
                start: true,
                end: true,
                harvest: true
            });
            syncStartDateBounds(); // CHANGED
            updateStartNote();
            updateTimeline(); // CHANGED
            refreshContextSummary(); // ADDED
            void refreshClimateModelTips(); // ADDED
            return true; // FIX
        }

        let latestScheduleResult = null; // ADDED
        let generatedPreviewTasks = []; // CHANGED: lifecycle task dots share the task preview display order.

        const timelineWrap = document.createElement('div'); // CHANGED
        timelineWrap.style.display = 'flex'; // CHANGED
        timelineWrap.style.flexDirection = 'column'; // CHANGED
        timelineWrap.style.gap = '6px'; // CHANGED

        timelineSection.body.appendChild(timelineWrap); // CHANGED: lifecycle renderer owns timeline contents.

        function makeTimelineSmallText(text = '') { // ADDED
            const el = document.createElement('div'); // ADDED
            el.textContent = text; // ADDED
            el.style.fontSize = '11px'; // ADDED
            el.style.color = '#6b7280'; // ADDED
            el.style.lineHeight = '1.25'; // ADDED
            return el; // ADDED
        } // ADDED

        function renderLifecycleTimelineTrack(model, classification) { // ADDED
            const trackWrap = document.createElement('div'); // ADDED
            trackWrap.style.position = 'relative'; // ADDED
            trackWrap.style.height = '58px'; // ADDED
            trackWrap.style.marginTop = '2px'; // ADDED
            const rail = document.createElement('div'); // ADDED
            rail.style.position = 'absolute'; // ADDED
            rail.style.left = '0'; // ADDED
            rail.style.right = '0'; // ADDED
            rail.style.top = '24px'; // ADDED
            rail.style.height = '8px'; // ADDED
            rail.style.background = classification.status === 'feasible' ? '#e5e7eb' : '#fee2e2'; // ADDED
            rail.style.borderRadius = '999px'; // ADDED
            trackWrap.appendChild(rail); // ADDED

            model.bands.forEach(band => { // ADDED
                const bandEl = document.createElement('div'); // ADDED
                bandEl.style.position = 'absolute'; // ADDED
                bandEl.style.left = `${band.leftPercent}%`; // ADDED
                bandEl.style.width = `${band.widthPercent}%`; // ADDED
                bandEl.style.top = '20px'; // ADDED
                bandEl.style.height = '16px'; // ADDED
                bandEl.style.background = '#bbf7d0'; // ADDED
                bandEl.style.border = '1px solid #86efac'; // ADDED
                bandEl.style.borderRadius = '999px'; // ADDED
                bandEl.style.opacity = '0.78'; // ADDED
                setTooltip(bandEl, `${band.label}: ${band.startISO} to ${band.endISO}`); // ADDED
                trackWrap.appendChild(bandEl); // ADDED
            }); // ADDED

            if (model.todayPercent != null) { // ADDED
                const today = document.createElement('div'); // ADDED
                today.style.position = 'absolute'; // ADDED
                today.style.left = `${model.todayPercent}%`; // ADDED
                today.style.top = '8px'; // ADDED
                today.style.height = '42px'; // ADDED
                today.style.borderLeft = '1px dashed #64748b'; // ADDED
                today.style.transform = 'translateX(-50%)'; // ADDED
                today.style.opacity = '0.65'; // ADDED
                setTooltip(today, `Today: ${model.todayISO}`); // ADDED
                trackWrap.appendChild(today); // ADDED
            } // ADDED

            model.visibleMilestones.forEach(milestone => { // ADDED
                const marker = document.createElement('button'); // ADDED
                marker.type = 'button'; // ADDED
                marker.style.position = 'absolute'; // ADDED
                marker.style.left = `${milestone.percent}%`; // ADDED
                marker.style.top = '16px'; // ADDED
                marker.style.width = '22px'; // ADDED
                marker.style.height = '22px'; // ADDED
                marker.style.padding = '0'; // ADDED
                marker.style.borderRadius = '50%'; // ADDED
                marker.style.border = milestone.stage === 'SOW' ? '2px solid #111827' : '2px solid #2563eb'; // ADDED
                marker.style.background = '#fff'; // ADDED
                marker.style.transform = 'translateX(-50%)'; // ADDED
                marker.style.cursor = 'pointer'; // ADDED
                marker.style.zIndex = '2'; // ADDED
                setTooltip(marker, `${milestone.label}: ${milestone.iso}${milestone.stage === 'SOW' ? '\nClick to focus sow date.' : (milestone.hasTaskRule ? '\nClick to edit the first task rule starting here.' : '')}`); // ADDED
                marker.addEventListener('click', () => { // ADDED
                    void runUiAsync('Timeline action error', async () => { // ADDED
                        await handleLifecycleMilestoneClick(milestone); // CHANGED
                    }); // ADDED
                }); // ADDED
                if (milestone.hasTaskRule && milestone.stage !== 'SOW') { // ADDED
                    const dot = document.createElement('span'); // ADDED
                    dot.style.position = 'absolute'; // ADDED
                    dot.style.right = '-2px'; // ADDED
                    dot.style.top = '-2px'; // ADDED
                    dot.style.width = '7px'; // ADDED
                    dot.style.height = '7px'; // ADDED
                    dot.style.borderRadius = '50%'; // ADDED
                    dot.style.background = '#f59e0b'; // ADDED
                    dot.style.border = '1px solid #fff'; // ADDED
                    marker.appendChild(dot); // ADDED
                } // ADDED
                trackWrap.appendChild(marker); // ADDED
            }); // ADDED
            return trackWrap; // ADDED
        } // ADDED

        function timelineAxisLabelTransform(percent) { // ADDED
            const n = Number(percent); // ADDED
            if (Number.isFinite(n) && n <= 1) return 'translateX(0)'; // ADDED
            if (Number.isFinite(n) && n >= 99) return 'translateX(-100%)'; // ADDED
            return 'translateX(-50%)'; // ADDED
        } // ADDED

        function renderLifecycleTimelineAxis(model) { // ADDED
            const axis = model?.axis || { months: [], years: [] }; // ADDED
            const wrap = document.createElement('div'); // ADDED
            wrap.style.position = 'relative'; // ADDED
            wrap.style.height = '34px'; // ADDED
            wrap.style.marginTop = '-6px'; // ADDED
            wrap.style.marginBottom = '2px'; // ADDED
            const monthRow = document.createElement('div'); // ADDED
            monthRow.style.position = 'relative'; // ADDED
            monthRow.style.height = '19px'; // ADDED
            axis.months.forEach(marker => { // ADDED
                const tick = document.createElement('div'); // ADDED
                tick.style.position = 'absolute'; // ADDED
                tick.style.left = `${marker.percent}%`; // ADDED
                tick.style.top = '0'; // ADDED
                tick.style.height = '6px'; // ADDED
                tick.style.borderLeft = '1px solid #cbd5e1'; // ADDED
                tick.style.transform = 'translateX(-50%)'; // ADDED
                monthRow.appendChild(tick); // ADDED
                const label = document.createElement('div'); // ADDED
                label.textContent = marker.label; // ADDED
                label.style.position = 'absolute'; // ADDED
                label.style.left = `${marker.percent}%`; // ADDED
                label.style.top = '7px'; // ADDED
                label.style.transform = timelineAxisLabelTransform(marker.percent); // ADDED
                label.style.fontSize = '10px'; // ADDED
                label.style.lineHeight = '1'; // ADDED
                label.style.color = '#64748b'; // ADDED
                label.style.whiteSpace = 'nowrap'; // ADDED
                setTooltip(label, `${marker.label}: ${marker.iso}`); // ADDED
                monthRow.appendChild(label); // ADDED
            }); // ADDED
            const yearRow = document.createElement('div'); // ADDED
            yearRow.style.position = 'relative'; // ADDED
            yearRow.style.height = '15px'; // ADDED
            axis.years.forEach(marker => { // ADDED
                const label = document.createElement('div'); // ADDED
                label.textContent = marker.label; // ADDED
                label.style.position = 'absolute'; // ADDED
                label.style.left = `${marker.percent}%`; // ADDED
                label.style.top = '1px'; // ADDED
                label.style.transform = timelineAxisLabelTransform(marker.percent); // ADDED
                label.style.fontSize = '10px'; // ADDED
                label.style.lineHeight = '1'; // ADDED
                label.style.fontWeight = '600'; // ADDED
                label.style.color = '#475569'; // ADDED
                label.style.whiteSpace = 'nowrap'; // ADDED
                setTooltip(label, `Year ${marker.label}: ${marker.iso}`); // ADDED
                yearRow.appendChild(label); // ADDED
            }); // ADDED
            wrap.appendChild(monthRow); // ADDED
            wrap.appendChild(yearRow); // ADDED
            return wrap; // ADDED
        } // ADDED

        function renderLifecycleTimelineLabelRows(model) { // ADDED
            const wrap = document.createElement('div'); // ADDED
            wrap.style.display = 'flex'; // ADDED
            wrap.style.flexDirection = 'column'; // ADDED
            wrap.style.gap = '2px'; // ADDED
            wrap.style.minHeight = '32px'; // ADDED
            model.labelRows.slice(0, 3).forEach(row => { // ADDED
                const rowEl = document.createElement('div'); // ADDED
                rowEl.style.position = 'relative'; // ADDED
                rowEl.style.height = '16px'; // ADDED
                row.forEach(milestone => { // ADDED
                    const label = document.createElement('div'); // ADDED
                    label.textContent = `${milestone.label} ${milestone.dateLabel}`; // ADDED
                    label.style.position = 'absolute'; // ADDED
                    label.style.left = `${milestone.percent}%`; // ADDED
                    label.style.transform = 'translateX(-50%)'; // ADDED
                    label.style.maxWidth = '120px'; // ADDED
                    label.style.fontSize = '10px'; // ADDED
                    label.style.lineHeight = '1.15'; // ADDED
                    label.style.color = '#374151'; // ADDED
                    label.style.whiteSpace = 'nowrap'; // ADDED
                    label.style.overflow = 'hidden'; // ADDED
                    label.style.textOverflow = 'ellipsis'; // ADDED
                    setTooltip(label, `${milestone.label}: ${milestone.iso}`); // ADDED
                    rowEl.appendChild(label); // ADDED
                }); // ADDED
                wrap.appendChild(rowEl); // ADDED
            }); // ADDED
            return wrap; // ADDED
        } // ADDED

        function renderLifecycleTimelineModel(model, classification) { // ADDED
            timelineWrap.innerHTML = ''; // ADDED
            if (!model || model.hidden) { // ADDED
                timelineSection.wrap.style.display = 'none'; // CHANGED
                return; // ADDED
            } // ADDED
            timelineSection.wrap.style.display = ''; // CHANGED
            const bounds = document.createElement('div'); // ADDED
            bounds.style.display = 'flex'; // ADDED
            bounds.style.justifyContent = 'space-between'; // ADDED
            bounds.style.gap = '8px'; // ADDED
            bounds.style.fontSize = '11px'; // ADDED
            bounds.style.color = '#6b7280'; // ADDED
            const startLabel = document.createElement('span'); // ADDED
            const endLabel = document.createElement('span'); // ADDED
            startLabel.textContent = lifecycleTimelineDateLabel(model.bounds.startISO, true); // ADDED
            endLabel.textContent = lifecycleTimelineDateLabel(model.bounds.endISO, true); // ADDED
            bounds.appendChild(startLabel); // ADDED
            bounds.appendChild(endLabel); // ADDED
            timelineWrap.appendChild(bounds); // ADDED
            timelineWrap.appendChild(renderLifecycleTimelineTrack(model, classification)); // ADDED
            timelineWrap.appendChild(renderLifecycleTimelineAxis(model)); // ADDED
            timelineWrap.appendChild(renderLifecycleTimelineLabelRows(model)); // ADDED
            const details = makeTimelineSmallText(model.details.length ? model.details.join(' | ') : 'No lifecycle milestones are available for the current schedule.'); // ADDED
            details.style.overflowWrap = 'anywhere'; // ADDED
            timelineWrap.appendChild(details); // ADDED
            const status = makeTimelineSmallText(classification.label); // ADDED
            status.style.color = classification.status === 'feasible' ? '#166534' : '#b91c1c'; // ADDED
            timelineWrap.appendChild(status); // ADDED
        } // ADDED

        async function handleLifecycleMilestoneClick(milestone) { // CHANGED
            if (milestone?.stage === 'SOW') { // ADDED
                startInput.focus(); // ADDED
                return; // ADDED
            } // ADDED
            if (!milestone?.hasTaskRule || !milestone.taskStage) return; // ADDED
            await refreshTaskTemplateFromSelection(); // ADDED
            await refreshTasksTabUI(); // ADDED
            const match = findFirstLifecycleTimelineTaskRule(taskRules, milestone.taskStage, generatedPreviewTasks); // ADDED
            if (!match) return; // ADDED
            tabsBody.innerHTML = ''; // ADDED
            tabsBody.appendChild(tasksTab); // ADDED
            setActiveTabButton(tasksTabBtn); // ADDED
            const taskRowIndex = buildTaskRuleDisplayOrder(taskRules, generatedPreviewTasks).findIndex(entry => entry.originalIndex === match.originalIndex); // ADDED
            const taskRowEl = taskRowIndex >= 0 ? tasksListDiv.children[taskRowIndex] : null; // ADDED
            await openTaskEditor(match.rule, match.originalIndex, taskRowEl); // CHANGED
        } // ADDED

        function updateTimeline() { // CHANGED
            const classification = classifySelectedSowDate({ // ADDED
                perennial: mode.perennial, // ADDED
                windowFeasible: formState.windowFeasible, // ADDED
                startISO: formState.startISO, // ADDED
                sowingSeasons: formState.sowingSeasons, // CHANGED
                activeSowingSeasonId: formState.activeSowingSeasonId // ADDED
            }); // ADDED
            const model = buildLifecycleTimelineViewModel({ // ADDED
                plant: effectivePlant, // ADDED
                perennial: mode.perennial, // ADDED
                seasonStartYear: formState.seasonStartYear, // ADDED
                startISO: formState.startISO, // ADDED
                sowingSeasons: formState.sowingSeasons, // ADDED
                scheduleResult: latestScheduleResult, // ADDED
                taskRules, // ADDED
                generatedTasks: generatedPreviewTasks // CHANGED
            }); // ADDED
            renderLifecycleTimelineModel(model, classification); // ADDED
            updateScheduleSummaryFromState(); // ADDED
        } // CHANGED

        async function handleSchedulePlantChange({ preferVarietyId = null } = {}) { // FIX: provide an awaitable schedule plant workflow
            const newPlant = findPlantById(Number(plantSel.value)); if (!newPlant) return;
            selPlant = newPlant; plantNameSpan.textContent = newPlant.plant_name;

            mode = getModeForPlant(selPlant);

            formState.plantId = Number(plantSel.value);

            const preferredVarietyId = Number(preferVarietyId);
            const hasPreferredVariety = Number.isFinite(preferredVarietyId) && preferredVarietyId > 0;
            await reloadVarietyOptionsForPlant(
                formState.plantId,
                hasPreferredVariety ? preferredVarietyId : null
            ); // FIX: complete variety selection before resolving the effective plant
            formState.varietyId = hasPreferredVariety && varietySel.value
                ? Number(varietySel.value)
                : null;
            syncVarietyButtons();
            await refreshEffectivePlant();


            await resetMethodOptionsForPlant(formState.plantId, {
                preferMethodCategoryId: String(formState.methodCategoryId ?? cellMethodCategoryId0 ?? '')
            });

            await resetMethodOptionsForMethodCategory(methodCategorySel.value, {
                preferMethodId: String(formState.methodId ?? cellMethodId0 ?? effectivePlant?.default_planting_method ?? '')
            });
            syncCombinedMethodControl(); // ADDED


            formState.methodCategoryId = normId(methodCategorySel.value); // FIX
            formState.methodId = normId(methodSel.value); // FIX

            harvestWindowInput.value = (effectivePlant.defaultHW() ?? '');
            formState.harvestWindowDays = (harvestWindowInput.value === '' ? null : Number(harvestWindowInput.value));


            syncStateFromControls();
            refreshClimateModelControls({ preserveDraft: false }); // ADDED

            if (effectivePlant.isPerennial()) {
                setPerennialMode(true, effectivePlant);
            } else {
                setPerennialMode(false, effectivePlant);
            }


            // Let the orchestrator recompute feasibility + schedule                      
            await recomputeAll('plantChanged');
            await refreshTaskTemplateFromSelection();
        }

        async function handleScheduleVarietyChange() { // FIX: provide an awaitable schedule variety workflow
            syncVarietyButtons();
            syncStateFromControls();
            await refreshEffectivePlant();
            await resetMethodOptionsForPlant(formState.plantId, {
                preferMethodCategoryId: String(formState.methodCategoryId ?? cellMethodCategoryId0 ?? '')
            });

            await resetMethodOptionsForMethodCategory(methodCategorySel.value, {
                preferMethodId: String(formState.methodId ?? effectivePlant?.default_planting_method ?? '')
            });
            syncCombinedMethodControl(); // ADDED

            harvestWindowInput.value = (effectivePlant.defaultHW() ?? '');
            formState.harvestWindowDays = (harvestWindowInput.value === '' ? null : Number(harvestWindowInput.value));
            await recomputeAll('varietyChanged');
            await refreshTaskTemplateFromSelection();

        }

        plantSel.addEventListener('change', () => {
            void runUiAsync('Plant change error', async () => { // FIX: clear stale inline warnings before crop recompute
                await handleSchedulePlantChange();
            });
        }); // FIX: route native crop changes through the shared async boundary
        varietySel.addEventListener('change', () => {
            void runUiAsync('Variety change error', async () => { // FIX: clear stale inline warnings before variety recompute
                await handleScheduleVarietyChange();
            });
        }); // FIX: route native variety changes through the shared async boundary


        startInput.addEventListener('input', () => {
            void runUiAsync('Date change error', async () => { // FIX
                userEditedStartThisSession = true; // FIX
                syncStateFromControls();
                if (mode.perennial) {
                    seasonEndInput.value = computePerennialEndISO(
                        startInput.value,
                        requirePerennialLifespanYears(effectivePlant)
                    );
                    formState.seasonEndISO = seasonEndInput.value;
                    formState.latestHarvestEndISO = ''; // ADDED
                    updateStartNote();
                } else {
                    await recomputeAll('startChanged');
                }
            });
        });

        sowingSeasonSel.addEventListener('change', () => { // ADDED
            void runUiAsync('Sowing season change error', async () => { // ADDED
                formState.activeSowingSeasonId = sowingSeasonSel.value || ''; // ADDED
                formState.startISO = resolveStartForSowingSeasonSwitch(formState.sowingSeasons, formState.activeSowingSeasonId, startInput.value || formState.startISO); // CHANGED
                startInput.value = formState.startISO; // ADDED
                userEditedStartThisSession = true; // CHANGED
                syncStartDateBounds(); // ADDED
                refreshSowingSeasonSelector(); // ADDED
                updateStartNote(); // ADDED
                await recomputeLastHarvestFromSchedule(); // ADDED
                await refreshTasksTabUI(); // CHANGED
            }); // ADDED
        }); // ADDED




        seasonEndInput.addEventListener('input', () => {
            void runUiAsync('Date change error', async () => { // FIX
                syncStateFromControls();
            });
        });


        seasonYearInput.addEventListener('input', () => {
            void runUiAsync('Year change error', async () => { // FIX
                await recomputeAll('yearChanged');
            });
        });

        harvestWindowInput.addEventListener('input', () => {
            void runUiAsync('Harvest window change error', async () => { // FIX
                syncStateFromControls();
                await recomputeAll('hwChanged');
                await refreshTaskTemplateFromSelection();
            });
        });

        minYieldMultInput.addEventListener('input', () => {
            void runUiAsync('Yield change error', async () => { // FIX
                syncStateFromControls();
                await recomputeLastHarvestFromSchedule();
            });
        });

        citySel.addEventListener('change', () => {
            void runUiAsync('City change error', async () => { // FIX
                syncStateFromControls(); // ADDED
                refreshClimateModelControls({ preserveDraft: false }); // ADDED
                await recomputeAll('cityChanged');
            });
        });

        combinedMethodSel.addEventListener('change', () => { // ADDED
            void runUiAsync('Method change error', async () => { // ADDED
                const selected = decodeMethodSelection(combinedMethodSel.value); // ADDED
                if (!selected) throw new Error('Select a planting method.'); // ADDED
                methodCategorySel.value = selected.methodCategoryId; // ADDED
                await resetMethodOptionsForMethodCategory(selected.methodCategoryId, { // ADDED
                    preferMethodId: selected.methodId // ADDED
                }); // ADDED
                methodSel.value = selected.methodId; // ADDED
                syncCombinedMethodControl(); // ADDED
                syncStateFromControls(); // ADDED
                await recomputeAll('methodChanged'); // ADDED
                await refreshTaskTemplateFromSelection(); // ADDED
                updateTasksHeader({ // ADDED
                    methodCategorySel, // ADDED
                    methodSel, // ADDED
                    formState, // ADDED
                    currentMethodSpan, // ADDED
                    currentTemplateSourceSpan, // ADDED
                    taskDirty, // ADDED
                    taskTemplateSource // ADDED
                }); // ADDED
            }); // ADDED
        }); // ADDED

        methodCategorySel.addEventListener('change', () => {
            void runUiAsync('Method category change error', async () => { // FIX
                syncStateFromControls();

                await resetMethodOptionsForMethodCategory(methodCategorySel.value, {
                    preferMethodId: String(formState.methodId ?? effectivePlant?.default_planting_method ?? '')
                });
                syncCombinedMethodControl(); // ADDED

                syncStateFromControls();

                await recomputeAll('methodChanged');
                await refreshTaskTemplateFromSelection();
                updateTasksHeader({
                    methodCategorySel, // CHANGED
                    methodSel,
                    formState,
                    currentMethodSpan,
                    currentTemplateSourceSpan,
                    taskDirty,
                    taskTemplateSource
                });
            });
        });



        methodSel.addEventListener('change', () => {
            void runUiAsync('Method change error', async () => { // FIX
                syncCombinedMethodControl(); // ADDED
                syncStateFromControls();
                await recomputeAll('methodChanged');
                await refreshTaskTemplateFromSelection();
                updateTasksHeader({
                    methodCategorySel, // CHANGED
                    methodSel,
                    formState,
                    currentMethodSpan,
                    currentTemplateSourceSpan,
                    taskDirty,
                    taskTemplateSource
                });
            });
        });

        // recomputeLastHarvestFromSchedule:
        //  - concern: full schedule under current constraint
        //  - NEVER changes seasonEndISO, only lastScheduleEndISO / lastHarvestISO
        let harvestRecomputeErrorVisible = false; // FIX: track only errors owned by harvest recomputation

        function clearComputedHarvestResult() { // FIX: clear all schedule-derived harvest output together
            latestScheduleResult = null; // ADDED
            formState.firstHarvestISO = null;
            formState.lastHarvestISO = null;
            formState.lastScheduleEndISO = null; // FIX: remove stale schedule-derived harvest state

            if (harvestStartInput) setDisplayFieldValue(harvestStartInput, '');
            if (harvestEndInput) setDisplayFieldValue(harvestEndInput, '');
            if (daysToFirstHarvestInput) setDisplayFieldValue(daysToFirstHarvestInput, '');
        }

        function showHarvestRecomputeFailure(message) { // FIX: keep failure cleanup and reporting atomic
            clearComputedHarvestResult();
            clearScheduleWarningState(); // ADDED
            harvestRecomputeErrorVisible = true;
            showErrorInline('Schedule calculation error: ' + String(message || 'No harvest result was produced.')); // FIX: make recompute failures visible
        }

        function clearHarvestRecomputeFailure() {
            if (!harvestRecomputeErrorVisible) return;
            harvestRecomputeErrorVisible = false;
            clearErrorInline(); // FIX: clear the prior recompute error after recovery
        }

        async function recomputeLastHarvestFromSchedule() {
            try {
                syncStateFromControls();

                const { inputs } = await buildScheduleContextFromForm(formState, selPlant, {
                    currentVarieties
                });


                const result = await computeScheduleResult(inputs); // CHANGED
                latestScheduleResult = result; // ADDED
                syncScheduleWarningState(result.warnings || []); // ADDED
                const {
                    rows,
                    firstScheduledHarvestISO, // CHANGED
                    lastScheduledHarvestEndISO
                } = result; // CHANGED

                console.log('[SCHEDULE RESULT]', {
                    rowsCount: rows?.length,
                    firstRow: rows?.[0],
                    lastRow: rows?.[rows.length - 1],
                    lastScheduledHarvestEndISO
                });

                if (!rows.length || !lastScheduledHarvestEndISO) {
                    console.log('[recomputeLastHarvestFromSchedule] no rows', {
                        startISO: formState.startISO,
                        scheduleEndISO: inputs.seasonEndISO, // CHANGED
                        latestHarvestEndISO: formState.latestHarvestEndISO, // ADDED
                        harvestWindowDays: formState.harvestWindowDays,
                    });

                    showHarvestRecomputeFailure('No harvest result was produced for the current schedule.'); // FIX: clear stale values and report the failure
                    return;
                }

                console.log('[recomputeLastHarvestFromSchedule] rows summary', {
                    count: rows.length,
                    first: rows[0],
                    last: rows[rows.length - 1]
                });

                formState.firstHarvestISO = firstScheduledHarvestISO; // CHANGED
                formState.lastScheduleEndISO = lastScheduledHarvestEndISO;
                formState.lastHarvestISO = lastScheduledHarvestEndISO;

                if (harvestStartInput) {
                    setDisplayFieldValue(harvestStartInput, formState.firstHarvestISO || ''); // CHANGED
                }
                if (harvestEndInput) {
                    setDisplayFieldValue(harvestEndInput, formState.lastHarvestISO || ''); // CHANGED
                }
                updateDaysToFirstHarvest(); // CHANGED
                clearHarvestRecomputeFailure(); // FIX: remove a prior recompute error after success

                console.log('[recomputeLastHarvestFromSchedule] scheduleEnd', {
                    lastScheduleEndISO: formState.lastScheduleEndISO
                });

            } catch (e) {
                console.warn('recomputeLastHarvestFromSchedule error:', e);
                showHarvestRecomputeFailure(e?.message || String(e)); // FIX: clear stale values and surface the calculation error
            }
        }




        const btns = document.createElement('div'); // CHANGED
        btns.className = 'usl-scheduler-footer-actions'; // CHANGE
        btns.style.marginTop = '12px'; // CHANGED
        btns.style.display = 'flex'; // CHANGED
        btns.style.justifyContent = 'flex-end'; // CHANGED

        const explainBtn = mxUtils.button('Explain Sowing Range', async () => { // CHANGED
            try {
                if (mode.perennial) return; // FIX: perennials have no maturity feasibility scan
                syncStateFromControls();

                const { plant, city, inputs } = await buildScheduleContextFromForm(
                    formState,
                    selPlant,
                    {
                        currentVarieties,
                        bedProfile: formState.bedProfile,
                        bedProfileSource: formState.bedProfileSource
                    } // ADDED: explanations use the same bed-aware soil model as scheduling.
                );

                const explainDerived = inputs.derived(); // ADDED
                const firstSeasonScanEnd = asUTCDate(explainDerived.scanStart.getUTCFullYear(), 12, 31); // ADDED
                const usePrimarySowScan = !!inputs.policy?.overwinterAllowed && firstSeasonScanEnd < explainDerived.scanEndHard; // ADDED
                const primaryScanOptions = usePrimarySowScan ? { scanEndDate: firstSeasonScanEnd } : {}; // ADDED
                const rows = await explainFeasibilityOverSeason(inputs, null, false, primaryScanOptions); // CHANGED
                const diagnosticsModel = buildFeasibilityDiagnosticsModel(inputs, rows, usePrimarySowScan ? { // CHANGED
                    scanLabel: 'Primary first-season sowing season', // ADDED
                    scanStartISO: fmtISO(explainDerived.scanStart), // ADDED
                    scanEndISO: fmtISO(firstSeasonScanEnd) // ADDED
                } : {}); // CHANGED
                const diagnostics = diagnosticsModel.text; // CHANGED
                const scanSummary = formatFeasibilityScanRanges(rows); // FIX: dialog shows compact reason ranges instead of daily JSON.
                const scanRanges = compressFeasibilityScanRanges(rows); // ADDED
                const sowingSeasonsText = formatSowingSeasonsSummary(formState.sowingSeasons); // ADDED
                const scheduleQualityDiagnosticRanges = annualCore.computeScheduleQualityDiagnosticRangesForInputs(inputs); // ADDED
                const scheduleQualityDiagnosticsText = formatScheduleQualityDiagnosticRanges(scheduleQualityDiagnosticRanges); // ADDED
                const lifecycleRows = usePrimarySowScan ? await explainFeasibilityOverSeason(inputs) : null; // ADDED
                const lifecycleDiagnosticsModel = lifecycleRows ? buildFeasibilityDiagnosticsModel(inputs, lifecycleRows, { // ADDED
                    scanLabel: 'Lifecycle support through maturity and harvest', // ADDED
                    scanStartISO: fmtISO(explainDerived.scanStart), // ADDED
                    scanEndISO: fmtISO(explainDerived.scanEndHard) // ADDED
                }) : null; // ADDED
                const lifecycleScanRanges = lifecycleRows ? compressFeasibilityScanRanges(lifecycleRows) : null; // ADDED
                const lifecycleScanSummary = lifecycleRows ? formatFeasibilityScanRanges(lifecycleRows) : ''; // ADDED

                // include plant & city dictionaries
                const plantDict = toPlainDict(plant);
                const cityDict = toPlainDict(city);
                const plantText = JSON.stringify(plantDict, null, 2); // ADDED
                const cityText = JSON.stringify(cityDict, null, 2); // ADDED

                const textParts = [ // CHANGED
                    diagnostics,
                    '',
                    'Derived sowing seasons:',
                    sowingSeasonsText,
                    '',
                    'Schedule quality diagnostic ranges:',
                    scheduleQualityDiagnosticsText,
                    '',
                    usePrimarySowScan ? 'Primary first-season sowing scan ranges:' : 'Feasibility scan ranges:',
                    scanSummary,
                    lifecycleDiagnosticsModel ? '' : null,
                    lifecycleDiagnosticsModel ? lifecycleDiagnosticsModel.text : null,
                    lifecycleScanSummary ? '' : null,
                    lifecycleScanSummary ? 'Lifecycle support scan ranges:' : null,
                    lifecycleScanSummary || null,
                    '',
                    'Plant data:',
                    plantText, // CHANGED
                    '',
                    'City data:',
                    cityText // CHANGED
                ].filter(value => value != null).join('\n'); // CHANGED

                renderExplainSowingRangeDialog(ui, diagnosticsModel, scanRanges, plantText, cityText, textParts, { // CHANGED
                    diagnosticsTitle: usePrimarySowScan ? 'Primary sowing diagnostics' : 'Diagnostics', // ADDED
                    scanTitle: usePrimarySowScan ? 'Primary first-season sowing scan ranges' : 'Feasibility scan ranges', // ADDED
                    sowingSeasonsText, // ADDED
                    scheduleQualityDiagnosticRanges, // ADDED
                    lifecycleDiagnosticsModel, // ADDED
                    lifecycleRanges: lifecycleScanRanges // ADDED
                }); // CHANGED



            } catch (e) { showErrorInline('Explain error: ' + e.message); }
        });

        const rightBtns = document.createElement('div'); // CHANGED
        rightBtns.className = 'usl-scheduler-action-row'; // CHANGE
        rightBtns.style.display = 'flex'; // CHANGED
        rightBtns.style.gap = '8px'; // CHANGED

        windowActions = document.createElement('div'); // FIX
        windowActions.style.marginTop = '8px'; // CHANGED
        windowActions.appendChild(explainBtn); // CHANGED
        advancedBody.appendChild(windowActions); // CHANGED

        const previewBtn = mxUtils.button('Preview', async () => {
            try {
                syncStateFromControls();
                requireSelectedScheduleDate(); // CHANGED

                const { inputs } = await buildScheduleContextFromForm(
                    formState,
                    selPlant,
                    { currentVarieties }
                );
                requireNoBlockingScheduleQualityDiagnostics(inputs); // ADDED

                const result = computeScheduleResult(inputs); // FIX
                syncScheduleWarningState(result.warnings || []); // ADDED
                if (result.kind === 'perennial') {
                    renderPerennialPreview(ui, result); // FIX
                    return;
                }
                const rows = result.rows;
                if (!rows.length) { showErrorInline('No feasible planting dates in the chosen season.'); return; }
                renderPreviewTable(ui, rows);
            } catch (e) { clearScheduleWarningState(); showErrorInline('Preview error: ' + e.message); } // CHANGED
        });


        const okBtn = mxUtils.button('Save', async () => { // CHANGED
            try {
                syncStateFromControls();
                requireSelectedScheduleDate(); // CHANGED

                const { inputs } = await buildScheduleContextFromForm(
                    formState,
                    selPlant,
                    { currentVarieties }
                );
                requireNoBlockingScheduleQualityDiagnostics(inputs); // ADDED

                // Build taskTemplate object from current rules
                taskTemplate = normalizeTaskTemplate({ // CHANGED
                    version: 2, // CHANGED
                    rules: taskRules // CHANGED
                }); // CHANGED

                // Validate the complete schedule before mutating the DB or graph.
                const scheduleResult = computeScheduleResult(inputs);
                syncScheduleWarningState(scheduleResult.warnings || []); // ADDED
                const activeWindow = getActiveSowingSeason(formState); // ADDED
                handleClimateModelControlChanged(); // ADDED
                const climateModelAttributePatch = buildClimateModelModuleAttributePatch(); // ADDED

                const persistPlantTaskDefault = async () => { // FIX: run DB persistence only after graph mutation succeeds
                    if (saveDefaultChk.checked) {
                        const methodId = normId(formState.methodId); // FIX
                        if (!methodId) {
                            throw new Error('Select a planting method before saving a plant default.');
                        }

                        await TaskTemplateModel.saveForSelection({
                            plantId: formState.plantId,
                            methodId,
                            template: taskTemplate
                        });
                    } else if (plantDefaultTaskDeleteRequested) {
                        await TaskTemplateModel.deleteForSelection({
                            plantId: formState.plantId,
                            methodId: normId(formState.methodId) // FIX
                        });
                    }
                };

                const taskTemplateJson = taskDirty
                    ? JSON.stringify(taskTemplate)
                    : (taskTemplateResetRequested ? "" : undefined);

                await applyScheduleToGraph(ui, cell, inputs, {
                    result: scheduleResult,
                    taskTemplateJson,
                    taskTemplate, // FIX: generate tasks from the in-memory template saved by this action
                    sowingSeasonId: activeWindow?.id || '', // ADDED
                    sowingSeasonLabel: activeWindow?.label || '', // ADDED
                    extraAttributePatches: climateModelAttributePatch ? [climateModelAttributePatch] : [], // ADDED
                    afterGraphUpdate: persistPlantTaskDefault // FIX: undo graph edits if the database write fails
                });
                ui.hideDialog();
            } catch (e) {
                clearScheduleWarningState(); // ADDED
                showErrorInline('Scheduling error: ' + e.message);
            }
        });

        const cancelBtn = mxUtils.button('Cancel', () => ui.hideDialog());
        [previewBtn, okBtn, cancelBtn].forEach(b => rightBtns.appendChild(b));
        btns.appendChild(rightBtns); // CHANGE

        await recomputeAll('cityChanged'); // CHANGED
        applyModeToUI(); // CHANGED
        syncStartDateBounds(); // CHANGED
        updateTimeline(); // CHANGED


































        // ============================================================================
        // TASK TAB UI
        // ============================================================================

        // 1. Load existing OR resolve from DB fallback chain
        let taskTemplateSource = "unknown";

        const resolved = await resolveTaskTemplate({
            cell,
            plantId: formState.plantId,
            varietyId: formState.varietyId,
            methodId: formState.methodId
        });

        taskTemplate = normalizeTaskTemplate(resolved?.template ?? null); // CHANGED
        taskTemplateSource = resolved?.source ?? "unknown";

        taskRules = Array.isArray(taskTemplate.rules) ? [...taskTemplate.rules] : []; // CHANGED

        // 2. Build the Tasks tab body
        const tasksTab = document.createElement("div");
        // Current method/method category header                                            
        const tasksHeaderRow = document.createElement("div");
        tasksHeaderRow.style.display = "flex";
        tasksHeaderRow.style.justifyContent = "space-between";
        tasksHeaderRow.style.alignItems = "center";
        tasksHeaderRow.style.gap = "8px";
        tasksHeaderRow.style.marginBottom = "10px";


        const currentMethodSpan = document.createElement("div");
        currentMethodSpan.style.fontWeight = "600";
        currentMethodSpan.textContent = "Method: (loading…)";

        const currentTemplateSourceSpan = document.createElement("div");
        currentTemplateSourceSpan.style.fontSize = "12px";
        currentTemplateSourceSpan.style.opacity = "0.85";
        currentTemplateSourceSpan.textContent = "Source: (loading…)";

        const leftHeaderCol = document.createElement("div");
        leftHeaderCol.style.display = "flex";
        leftHeaderCol.style.flexDirection = "column";
        leftHeaderCol.style.gap = "2px";
        leftHeaderCol.appendChild(currentMethodSpan);
        leftHeaderCol.appendChild(currentTemplateSourceSpan);

        tasksHeaderRow.appendChild(leftHeaderCol);

        tasksTab.appendChild(tasksHeaderRow);

        const taskPreviewSection = document.createElement('div'); // ADDED
        taskPreviewSection.style.border = '1px solid #d1d5db'; // ADDED
        taskPreviewSection.style.borderRadius = '6px'; // ADDED
        taskPreviewSection.style.padding = '10px'; // ADDED
        taskPreviewSection.style.marginBottom = '12px'; // ADDED
        const taskPreviewTitle = document.createElement('div'); // ADDED
        taskPreviewTitle.textContent = 'Generated task timeline'; // ADDED
        taskPreviewTitle.style.fontWeight = '600'; // ADDED
        taskPreviewTitle.style.marginBottom = '8px'; // ADDED
        const taskPreviewControls = document.createElement('div'); // ADDED
        taskPreviewControls.style.display = 'flex'; // ADDED
        taskPreviewControls.style.flexWrap = 'wrap'; // ADDED
        taskPreviewControls.style.alignItems = 'center'; // ADDED
        taskPreviewControls.style.gap = '8px 16px'; // ADDED
        taskPreviewControls.style.marginBottom = '8px'; // ADDED
        const taskPreviewRuleSelectors = document.createElement('div'); // ADDED
        taskPreviewRuleSelectors.style.display = 'flex'; // ADDED
        taskPreviewRuleSelectors.style.flexWrap = 'wrap'; // ADDED
        taskPreviewRuleSelectors.style.gap = '6px 12px'; // ADDED
        const taskPreviewStatus = document.createElement('div'); // ADDED
        taskPreviewStatus.style.fontSize = '11px'; // ADDED
        taskPreviewStatus.style.color = '#6b7280'; // ADDED
        taskPreviewStatus.style.marginBottom = '6px'; // ADDED
        const taskPreviewTimeline = document.createElement('div'); // ADDED
        taskPreviewControls.appendChild(taskPreviewRuleSelectors); // ADDED
        taskPreviewSection.appendChild(taskPreviewTitle); // ADDED
        taskPreviewSection.appendChild(taskPreviewControls); // ADDED
        taskPreviewSection.appendChild(taskPreviewStatus); // ADDED
        taskPreviewSection.appendChild(taskPreviewTimeline); // ADDED
        tasksTab.appendChild(taskPreviewSection); // ADDED

        // "Add Task" button
        const addTaskBtn = mxUtils.button("Add Task", () => openTaskEditor(null, null, addTaskBtn)); // CHANGED
        addTaskBtn.style.marginTop = "12px";
        tasksTab.appendChild(addTaskBtn);

        // List container
        const tasksListDiv = document.createElement("div");
        const previewRuleSelections = new Map(); // ADDED
        let taskPreviewScheduleRange = null; // ADDED
        let taskPreviewCutoffOmittedRuleKeys = new Set(); // ADDED
        let taskPreviewVersion = 0; // ADDED

        function restoreFocus(el) { // FIX: restore keyboard focus after task-list DOM updates
            setTimeout(() => {
                if (el?.isConnected && typeof el.focus === "function") el.focus();
            }, 0);
        }

        const restoreBuiltinsBtn = mxUtils.button("Restore missing built-in tasks", async () => { // CHANGED
            try {
                syncStateFromControls();

                const methodTpl = await getDefaultTaskTemplateForPlantingMethods(formState.methodId);
                const defaultRules = Array.isArray(methodTpl?.rules) ? methodTpl.rules : [];

                taskRules = mergeMissingCanonicalRules(taskRules, defaultRules).map(normalizeTaskRule);
                taskDirty = true;
                await refreshTasksTabUI(); // CHANGED
            } catch (e) {
                showErrorInline("Restore built-in tasks error: " + (e?.message || String(e)));
            }
        });

        // Render list
        function renderTasksList() {
            tasksListDiv.innerHTML = "";
            if (!taskRules.length) {
                const empty = document.createElement("div");
                empty.textContent = "No tasks defined.";
                tasksListDiv.appendChild(empty);
                return;
            }

            buildTaskRuleDisplayOrder(taskRules, generatedPreviewTasks).forEach(({ rule, originalIndex }) => { // CHANGED
                const wrap = document.createElement("div");
                wrap.style.border = "1px solid #ddd";
                wrap.style.margin = "6px 0";
                wrap.style.padding = "6px";
                wrap.style.display = "flex";
                wrap.style.justifyContent = "space-between";

                const summary = document.createElement("div");
                summary.textContent = describeTaskRule(rule);

                if (isCanonicalTaskRule(rule)) {
                    summary.textContent += " • Built-in";
                }

                const btnWrap = document.createElement("div");
                btnWrap.style.display = "flex";
                btnWrap.style.gap = "6px";

                const editBtn = mxUtils.button("Edit", () => openTaskEditor(rule, originalIndex, wrap)); // CHANGED
                const delBtn = mxUtils.button("Delete", () => {

                    const isBuiltIn = isCanonicalTaskRule(rule);
                    if (isBuiltIn) {
                        const ok = confirm("This is a built-in task for the current method. Delete it from this template?");
                        if (!ok) {
                            restoreFocus(delBtn);
                            return;
                        }
                    }

                    taskRules.splice(originalIndex, 1); // CHANGED
                    taskDirty = true;
                    void refreshTasksTabUI(); // CHANGED
                    restoreFocus(addTaskBtn);
                });

                btnWrap.appendChild(editBtn);
                btnWrap.appendChild(delBtn);

                wrap.appendChild(summary);
                wrap.appendChild(btnWrap);
                tasksListDiv.appendChild(wrap);
            });
        }

        tasksTab.appendChild(tasksListDiv);

        // 3. Task editor (inline)
        const taskEditorDiv = document.createElement("div");
        tasksTab.appendChild(taskEditorDiv);

        function placeTaskEditorAfter(anchorEl) { // ADDED
            if (anchorEl?.parentNode) { // ADDED
                anchorEl.parentNode.insertBefore(taskEditorDiv, anchorEl.nextSibling); // ADDED
            } // ADDED
        } // ADDED

        function selectedPreviewRuleKeys() { // ADDED
            return new Set( // ADDED
                Array.from(previewRuleSelections.entries()) // ADDED
                    .filter(([, selected]) => selected) // ADDED
                    .map(([key]) => key) // ADDED
            ); // ADDED
        } // ADDED

        function renderTaskPreviewRuleSelectors() { // ADDED
            const activeKeys = new Set(); // ADDED
            taskPreviewRuleSelectors.innerHTML = ''; // ADDED
            buildTaskRuleDisplayOrder(taskRules, generatedPreviewTasks).forEach(({ rule, originalIndex, key }) => { // CHANGED
                activeKeys.add(key); // ADDED
                if (!previewRuleSelections.has(key)) previewRuleSelections.set(key, true); // ADDED
                const label = document.createElement('label'); // ADDED
                label.style.display = 'inline-flex'; // ADDED
                label.style.alignItems = 'center'; // ADDED
                label.style.gap = '4px'; // ADDED
                const checkbox = makeCheckbox(previewRuleSelections.get(key)); // ADDED
                checkbox.addEventListener('change', () => { // ADDED
                    previewRuleSelections.set(key, checkbox.checked); // ADDED
                    renderCachedTaskPreview(); // ADDED
                }); // ADDED
                const text = document.createElement('span'); // ADDED
                text.textContent = String(rule?.title || rule?.id || `Task ${originalIndex + 1}`); // CHANGED
                label.appendChild(checkbox); // ADDED
                label.appendChild(text); // ADDED
                taskPreviewRuleSelectors.appendChild(label); // ADDED
            }); // ADDED
            Array.from(previewRuleSelections.keys()).forEach(key => { // ADDED
                if (!activeKeys.has(key)) previewRuleSelections.delete(key); // ADDED
            }); // ADDED
        } // ADDED

        function renderCachedTaskPreview({ message = '', error = '' } = {}) { // ADDED
            const selectedKeys = selectedPreviewRuleKeys(); // ADDED
            if (!selectedKeys.size && !error) message = 'Select at least one task rule to preview.'; // ADDED
            const visible = updateTaskTimelinePreview({ // ADDED
                container: taskPreviewTimeline, // ADDED
                generatedTasks: generatedPreviewTasks, // ADDED
                selectedRuleKeys: selectedKeys, // ADDED
                scheduleRange: taskPreviewScheduleRange, // ADDED
                message, // ADDED
                error // ADDED
            }); // ADDED
            taskPreviewStatus.textContent = visible.length // ADDED
                ? `${visible.length} task occurrence${visible.length === 1 ? '' : 's'} shown.` // ADDED
                : ''; // ADDED
            const cutoffOmittedCount = Array.from(selectedKeys).filter(key => taskPreviewCutoffOmittedRuleKeys.has(key)).length; // ADDED
            if (cutoffOmittedCount > 0 && !error) { // ADDED
                taskPreviewStatus.textContent += `${taskPreviewStatus.textContent ? ' ' : ''}${cutoffOmittedCount} selected repeated rule${cutoffOmittedCount === 1 ? '' : 's'} omitted because the cutoff is on or before the first occurrence.`; // ADDED
            } // ADDED
        } // ADDED

        async function updateTaskPreview() { // ADDED
            const requestVersion = ++taskPreviewVersion; // ADDED
            syncStateFromControls(); // ADDED
            renderTaskPreviewRuleSelectors(); // ADDED
            if (!taskRules.length) { // ADDED
                generatedPreviewTasks = []; // ADDED
                taskPreviewScheduleRange = null; // ADDED
                taskPreviewCutoffOmittedRuleKeys = new Set(); // ADDED
                renderCachedTaskPreview({ message: 'No task rules are defined.' }); // ADDED
                return; // ADDED
            } // ADDED
            try { requireSelectedScheduleDate(); } catch (e) { // CHANGED
                generatedPreviewTasks = []; // ADDED
                taskPreviewScheduleRange = null; // ADDED
                taskPreviewCutoffOmittedRuleKeys = new Set(); // ADDED
                clearScheduleWarningState(); // ADDED
                renderCachedTaskPreview({ error: e?.message || String(e) }); // CHANGED
                return; // ADDED
            } // CHANGED
            try { // ADDED
                const { inputs } = await buildScheduleContextFromForm(formState, selPlant, { currentVarieties }); // ADDED
                requireNoBlockingScheduleQualityDiagnostics(inputs); // ADDED
                const result = computeScheduleResult(inputs); // ADDED
                syncScheduleWarningState(result.warnings || []); // ADDED
                const tasks = await buildTasksForPlan({ // ADDED
                    plant: result.plant, // ADDED
                    schedule: result.schedule, // ADDED
                    timelines: result.timelines, // ADDED
                    taskTemplate: { version: 2, rules: taskRules }, // ADDED
                    varietyName: inputs.varietyName, // ADDED
                    includePreviewMetadata: true // ADDED
                }); // ADDED
                if (requestVersion !== taskPreviewVersion) return; // ADDED
                generatedPreviewTasks = tasks; // ADDED
                taskPreviewScheduleRange = resolveTaskPreviewScheduleRange(result); // ADDED
                taskPreviewCutoffOmittedRuleKeys = findRepeatCutoffOmittedRuleKeys({ // ADDED
                    taskTemplate: { version: 2, rules: taskRules }, // ADDED
                    schedule: result.schedule, // ADDED
                    timelines: result.timelines // ADDED
                }); // ADDED
                renderTaskPreviewRuleSelectors(); // ADDED
                const selectedKeys = selectedPreviewRuleKeys(); // ADDED
                const generatedKeys = new Set(tasks.map(task => task.previewRuleKey)); // ADDED
                const selectedCutoffOmitted = Array.from(selectedKeys).filter(key => taskPreviewCutoffOmittedRuleKeys.has(key)); // ADDED
                const missingAnchorCount = Array.from(selectedKeys).filter(key => !generatedKeys.has(key) && !taskPreviewCutoffOmittedRuleKeys.has(key)).length; // CHANGED
                renderCachedTaskPreview({ // ADDED
                    message: tasks.length // ADDED
                        ? '' // ADDED
                        : (selectedCutoffOmitted.length ? 'No tasks could be generated. Repeat cutoff excluded the selected rule before its first occurrence.' : 'No tasks could be generated. Required schedule anchors may be unavailable.') // CHANGED
                }); // ADDED
                if (missingAnchorCount > 0 && tasks.length) { // ADDED
                    taskPreviewStatus.textContent += ` ${missingAnchorCount} selected rule${missingAnchorCount === 1 ? '' : 's'} omitted because schedule anchors are unavailable.`; // ADDED
                } // ADDED
            } catch (e) { // ADDED
                if (requestVersion !== taskPreviewVersion) return; // ADDED
                generatedPreviewTasks = []; // ADDED
                taskPreviewScheduleRange = null; // ADDED
                taskPreviewCutoffOmittedRuleKeys = new Set(); // ADDED
                clearScheduleWarningState(); // ADDED
                renderCachedTaskPreview({ error: `Task preview error: ${e?.message || String(e)}` }); // ADDED
            } // ADDED
        } // ADDED

        async function refreshTasksTabUI() { // ADDED
            updateTasksHeader({ // ADDED
                methodCategorySel, // ADDED
                methodSel, // ADDED
                formState, // ADDED
                currentMethodSpan, // ADDED
                currentTemplateSourceSpan, // ADDED
                taskDirty, // ADDED
                taskTemplateSource // ADDED
            }); // ADDED
            await updateTaskPreview(); // ADDED
            renderTasksList(); // CHANGED
            updateTimeline(); // ADDED
        } // ADDED

        async function refreshTaskTemplateFromSelection() {
            syncStateFromControls();
            updateTasksHeader({
                methodCategorySel, // CHANGED
                methodSel,
                formState,
                currentMethodSpan,
                currentTemplateSourceSpan,
                taskDirty,
                taskTemplateSource
            });

            // Do not overwrite if the cell already has a per-plan template
            const raw = String(cell?.getAttribute?.('task_template_json') || '').trim();
            const hasCellTpl = raw.length > 0;
            if (hasCellTpl || taskDirty) return;

            const resolved = await resolveTaskTemplate({
                cell,
                plantId: formState.plantId,
                varietyId: formState.varietyId,
                methodId: formState.methodId
            });

            taskTemplate = normalizeTaskTemplate(resolved?.template ?? null); // CHANGED
            taskTemplateSource = resolved?.source ?? "unknown"; // CHANGED
            taskRules = Array.isArray(taskTemplate.rules) ? [...taskTemplate.rules] : []; // CHANGED

            taskEditorDiv.innerHTML = '';
            renderTasksList();
            updateTasksHeader({
                methodCategorySel, // CHANGED
                methodSel,
                formState,
                currentMethodSpan,
                currentTemplateSourceSpan,
                taskDirty,
                taskTemplateSource
            });
        }

        syncStateFromControls();
        updateTasksHeader({
            methodCategorySel, // CHANGED
            methodSel,
            formState,
            currentMethodSpan,
            currentTemplateSourceSpan,
            taskDirty,
            taskTemplateSource
        });

        function getTaskTypeEditorOptions() { // NEW
            const graph = ui && ui.editor && ui.editor.graph; // NEW
            const model = graph && typeof graph.getModel === "function" ? graph.getModel() : null; // NEW
            const moduleCell = model ? findGardenModuleAncestor(model, cell) : null; // NEW
            const equipment = graph && graph.__trellisEquipment; // NEW
            if (!equipment || typeof equipment.readTaskTypeRegistry !== "function" || !moduleCell) { // NEW
                return { available: false, options: [{ value: "general", label: "General Task" }] }; // NEW
            } // NEW
            const rows = equipment.readTaskTypeRegistry(moduleCell) || []; // NEW
            const options = rows // NEW
                .map(function (tt) { return { value: normalizeTaskTypeId(tt && tt.id), label: String(tt && (tt.name || tt.id) || "").trim() }; }) // NEW
                .filter(function (tt) { return tt.value && tt.label; }) // NEW
                .sort(function (a, b) { return a.label.localeCompare(b.label); }); // NEW
            if (!options.length) return { available: false, options: [{ value: "general", label: "General Task" }] }; // NEW
            return { available: true, options: [{ value: "", label: "Choose task type" }].concat(options) }; // NEW
        } // NEW

        async function openTaskEditor(rule, index, anchorEl = null) { // CHANGED
            taskEditorDiv.innerHTML = "";
            placeTaskEditorAfter(anchorEl); // ADDED

            const editing = !!rule;

            // --------------------------------------------------
            // Editor header
            // --------------------------------------------------
            const editorHeader = document.createElement("div"); // CHANGED
            editorHeader.style.marginTop = "14px"; // CHANGED
            editorHeader.style.marginBottom = "8px"; // CHANGED
            editorHeader.style.paddingTop = "8px"; // CHANGED
            editorHeader.style.borderTop = "1px solid #ccc"; // CHANGED
            editorHeader.style.fontWeight = "600"; // CHANGED
            editorHeader.textContent = editing ? "Edit task" : "Add task"; // CHANGED

            taskEditorDiv.appendChild(editorHeader); // CHANGED

            const editorBody = document.createElement("div"); // CHANGED
            editorBody.style.display = "flex"; // CHANGED
            editorBody.style.flexDirection = "column"; // CHANGED
            editorBody.style.gap = "8px"; // CHANGED

            editorBody.style.background = "#fafafa";
            editorBody.style.padding = "8px";
            editorBody.style.border = "1px solid #ddd";
            editorBody.style.borderRadius = "4px";

            taskEditorDiv.appendChild(editorBody); // CHANGED

            const r = normalizeTaskRule( // CHANGED
                rule ? JSON.parse(JSON.stringify(rule)) : { // CHANGED
                    id: "rule_" + Date.now(),
                    title: "",
                    startAnchorStage: "SOW", // CHANGED
                    startOffsetDays: 0, // CHANGED
                    startOffsetDirection: "after", // CHANGED
                    endMode: "fixed_days", // CHANGED
                    durationDays: 1,
                    endAnchorStage: null, // CHANGED
                    endAnchorOffsetDays: 0, // CHANGED
                    endAnchorOffsetDirection: "after", // CHANGED
                    repeatMode: "none", // CHANGED
                    repeatEveryDays: 1,
                    repeatUntilMode: "x_times",
                    repeatTimes: 1, // CHANGED
                    repeatUntilAnchorStage: "HARVEST_END", // CHANGED
                    repeatCutoffOffsetDays: 0, // ADDED
                    repeatCutoffOffsetDirection: "after" // ADDED
                }
            );

            const allowedStages = await getAllowedAnchorStagesForMethod(formState.methodId);
            let stageOptions = allowedStages.map(k => ({
                value: k,
                label: TASK_STAGE_LABELS[k] || k
            }));

            function appendLegacyOptionIfMissing(options, value) {
                const v = String(value || "").trim();
                if (!v) return options;
                if (options.some(o => o.value === v)) return options;
                return options.concat([{
                    value: v,
                    label: `${humanStageLabel(v)} (not available for current method)`
                }]);
            }

            const startStageOptions = appendLegacyOptionIfMissing(stageOptions, r.startAnchorStage);
            const endStageOptions = appendLegacyOptionIfMissing(stageOptions, r.endAnchorStage);
            const repeatUntilStageOptions = appendLegacyOptionIfMissing(stageOptions, r.repeatUntilAnchorStage);

            const titleInput = document.createElement("input");
            titleInput.type = "text";
            titleInput.value = r.title;
            const titleRow = row("Title", titleInput).row;
            const customTaskRule = !isCanonicalTaskId(r.id); // NEW
            const taskTypeState = customTaskRule ? getTaskTypeEditorOptions() : null; // NEW
            const taskTypeSel = customTaskRule ? makeSelect(taskTypeState.options, r.taskTypeId || (taskTypeState.available ? "" : "general")) : null; // NEW
            if (taskTypeSel && !taskTypeState.available) taskTypeSel.disabled = true; // NEW
            const taskTypeRow = customTaskRule ? row("Task Type", taskTypeSel).row : null; // NEW

            const startOffsetNum = makeNumber(r.startOffsetDays); // CHANGED
            const startOffsetDir = makeSelect([ // CHANGED
                { value: "before", label: "before" },
                { value: "after", label: "after" }
            ], r.startOffsetDirection);
            const startAnchorSel = makeSelect(startStageOptions, r.startAnchorStage);

            const startWrap = document.createElement("div");
            startWrap.style.display = "flex";
            startWrap.style.gap = "8px";
            startWrap.appendChild(startOffsetNum);
            startWrap.appendChild(startOffsetDir);
            startWrap.appendChild(startAnchorSel);
            const startRow = row("Start", startWrap).row; // CHANGED

            const endModeSel = makeSelect([ // CHANGED
                { value: "fixed_days", label: "Fixed duration" },
                { value: "anchor_range", label: "Until anchor" }
            ], r.endMode);

            const endModeRow = row("Duration mode", endModeSel).row; // CHANGED

            const durationNum = makeNumber(r.durationDays ?? 1); // CHANGED
            const durationRow = row("Duration days", durationNum).row; // CHANGED

            const endAnchorOffsetNum = makeNumber(r.endAnchorOffsetDays ?? 0); // CHANGED
            const endAnchorOffsetDir = makeSelect([ // CHANGED
                { value: "before", label: "before" },
                { value: "after", label: "after" }
            ], r.endAnchorOffsetDirection || "after");
            const endAnchorSel = makeSelect(
                endStageOptions,
                r.endAnchorStage || "HARVEST_END"
            );

            const endAnchorWrap = document.createElement("div");
            endAnchorWrap.style.display = "flex";
            endAnchorWrap.style.gap = "8px";
            endAnchorWrap.appendChild(endAnchorOffsetNum);
            endAnchorWrap.appendChild(endAnchorOffsetDir);
            endAnchorWrap.appendChild(endAnchorSel);
            const endAnchorRow = row("End anchor", endAnchorWrap).row; // CHANGED

            const repeatCheck = makeCheckbox(r.repeatMode === "interval"); // CHANGED
            const repeatModeRow = row("Repeat", repeatCheck).row; // CHANGED

            const repeatConfigDiv = document.createElement("div");
            repeatConfigDiv.style.marginLeft = "20px";

            const repeatEveryNum = makeNumber(r.repeatEveryDays);
            const repeatEveryRow = row("Every (days)", repeatEveryNum).row;

            const repeatUntilModeSel = makeSelect([ // CHANGED
                { value: "x_times", label: "Repeat X total times" },
                { value: "until_anchor", label: "Repeat until anchor" }
            ], r.repeatUntilMode);
            const repeatUntilModeRow = row("Stop mode", repeatUntilModeSel).row; // CHANGED

            const repeatTimesNum = makeNumber(r.repeatTimes ?? 1); // CHANGED
            const repeatTimesRow = row("Times", repeatTimesNum).row;

            const repeatCutoffOffsetNum = makeNumber(r.repeatCutoffOffsetDays ?? 0); // ADDED
            const repeatCutoffOffsetDir = makeSelect([ // ADDED
                { value: "before", label: "before" }, // ADDED
                { value: "after", label: "after" } // ADDED
            ], r.repeatCutoffOffsetDirection || "after"); // ADDED
            const repeatUntilAnchorSel = makeSelect(
                repeatUntilStageOptions,
                r.repeatUntilAnchorStage || "HARVEST_END"
            );

            const repeatCutoffAnchorWrap = document.createElement("div"); // ADDED
            repeatCutoffAnchorWrap.style.display = "flex"; // ADDED
            repeatCutoffAnchorWrap.style.gap = "8px"; // ADDED
            repeatCutoffAnchorWrap.appendChild(repeatCutoffOffsetNum); // ADDED
            repeatCutoffAnchorWrap.appendChild(repeatCutoffOffsetDir); // ADDED
            repeatCutoffAnchorWrap.appendChild(repeatUntilAnchorSel); // ADDED
            const repeatUntilAnchorRow = row("Cutoff anchor", repeatCutoffAnchorWrap).row; // CHANGED

            repeatConfigDiv.appendChild(repeatEveryRow);
            repeatConfigDiv.appendChild(repeatUntilModeRow);
            repeatConfigDiv.appendChild(repeatTimesRow);
            repeatConfigDiv.appendChild(repeatUntilAnchorRow);

            function setTaskEditorRowVisible(rowEl, visible) { // ADDED
                rowEl.style.setProperty("display", visible ? "flex" : "none", "important"); // ADDED
            } // ADDED

            function syncTaskEditorVisibility() {
                const endMode = endModeSel.value;
                const anchorRange = endMode === "anchor_range";
            
                setTaskEditorRowVisible(durationRow, endMode === "fixed_days"); // CHANGED
                setTaskEditorRowVisible(endAnchorRow, anchorRange); // CHANGED
            
                if (anchorRange && repeatCheck.checked) { // CHANGED
                    repeatCheck.checked = false; // CHANGED
                }
                repeatCheck.disabled = anchorRange; // CHANGED
            
                const repeating = !anchorRange && repeatCheck.checked; // CHANGED
                repeatConfigDiv.style.display = repeating ? "" : "none";
            
                const untilMode = repeatUntilModeSel.value;
                setTaskEditorRowVisible(repeatTimesRow, repeating && untilMode === "x_times"); // CHANGED
                setTaskEditorRowVisible(repeatUntilAnchorRow, repeating); // CHANGED
            }

            endModeSel.addEventListener("change", syncTaskEditorVisibility); // CHANGED
            repeatCheck.addEventListener("change", syncTaskEditorVisibility); // CHANGED
            repeatUntilModeSel.addEventListener("change", syncTaskEditorVisibility); // CHANGED

            editorBody.appendChild(titleRow);
            if (taskTypeRow) editorBody.appendChild(taskTypeRow); // NEW
            editorBody.appendChild(startRow); // CHANGED
            editorBody.appendChild(endModeRow); // CHANGED
            editorBody.appendChild(durationRow);
            editorBody.appendChild(endAnchorRow); // CHANGED
            editorBody.appendChild(repeatModeRow); // CHANGED
            editorBody.appendChild(repeatConfigDiv);

            syncTaskEditorVisibility(); // CHANGED

            const btnWrap = document.createElement("div");
            btnWrap.style.marginTop = "8px";
            btnWrap.style.display = "flex";
            btnWrap.style.gap = "8px";

            const saveBtn = mxUtils.button("Save", async () => {
                try {
                    r.title = titleInput.value.trim();
                    if (customTaskRule) r.taskTypeId = taskTypeSel.value || (taskTypeState.available ? "" : "general"); // NEW

                    r.startOffsetDays = Number(startOffsetNum.value); // CHANGED
                    r.startOffsetDirection = startOffsetDir.value; // CHANGED
                    r.startAnchorStage = startAnchorSel.value; // CHANGED

                    r.endMode = endModeSel.value; // CHANGED
                    r.durationDays = (r.endMode === "fixed_days") ? Number(durationNum.value) : null; // CHANGED
                    r.endAnchorStage = (r.endMode === "anchor_range") ? endAnchorSel.value : null; // CHANGED
                    r.endAnchorOffsetDays = (r.endMode === "anchor_range") ? Number(endAnchorOffsetNum.value) : 0; // CHANGED
                    r.endAnchorOffsetDirection = (r.endMode === "anchor_range") ? endAnchorOffsetDir.value : "after"; // CHANGED

                    r.repeatMode = (repeatCheck.checked && r.endMode === "fixed_days") ? "interval" : "none"; // CHANGED
                    r.repeatEveryDays = Number(repeatEveryNum.value); // CHANGED
                    r.repeatUntilMode = repeatUntilModeSel.value; // CHANGED
                    r.repeatTimes = (r.repeatMode === "interval" && r.repeatUntilMode === "x_times")
                        ? Number(repeatTimesNum.value)
                        : 1; // CHANGED
                    r.repeatUntilAnchorStage = (r.repeatMode === "interval") // CHANGED
                        ? repeatUntilAnchorSel.value
                        : "HARVEST_END"; // CHANGED
                    r.repeatCutoffOffsetDays = (r.repeatMode === "interval") ? Number(repeatCutoffOffsetNum.value) : 0; // ADDED
                    r.repeatCutoffOffsetDirection = (r.repeatMode === "interval") ? repeatCutoffOffsetDir.value : "after"; // ADDED

                    const allowedStages = await getAllowedAnchorStagesForMethod(formState.methodId);
                    const normalized = validateTaskRule(r, { allowedStages, requireTaskType: customTaskRule }); // CHANGE
                    try { // ADDED
                        const { inputs } = await buildScheduleContextFromForm(formState, selPlant, { currentVarieties }); // ADDED
                        const result = computeScheduleResult(inputs); // ADDED
                        validateTaskRuleAnchorOrder(normalized, { schedule: result.schedule, timelines: result.timelines }); // ADDED
                    } catch (orderErr) { // ADDED
                        if (/^Start must/.test(String(orderErr?.message || ""))) throw orderErr; // ADDED
                    } // ADDED

                    if (!editing && isCanonicalTaskId(r.id)) {
                        throw new Error("Canonical task IDs are reserved.");
                    }

                    if (editing) taskRules[index] = normalized; // CHANGED
                    else taskRules.push(normalized); // CHANGED
                    taskDirty = true;

                    taskEditorDiv.innerHTML = "";
                    await refreshTasksTabUI(); // CHANGED
                } catch (e) {
                    showErrorInline("Save task error: " + (e?.message || String(e))); // CHANGED
                }
            });

            const cancelBtn = mxUtils.button("Cancel", () => {
                taskEditorDiv.innerHTML = "";
            });

            btnWrap.appendChild(saveBtn);
            btnWrap.appendChild(cancelBtn);
            taskEditorDiv.appendChild(btnWrap);
        }


        // Reset to defaults button
        const resetTasksBtn = mxUtils.button("Reset tasks to plant-default", async () => { // CHANGED
            try {
                syncStateFromControls();

                const methodId = normId(formState.methodId); // FIX
                const methodTemplate = methodId
                    ? await getDefaultTaskTemplateForPlantingMethods(methodId)
                    : null;

                taskTemplate = normalizeTaskTemplate(methodTemplate);
                taskTemplateSource = methodTemplate ? "method_builtin" : "none";
                taskRules = Array.isArray(taskTemplate.rules) ? [...taskTemplate.rules] : [];
                taskTemplateResetRequested = true;
                plantDefaultTaskDeleteRequested = true;
                taskDirty = false;
                taskEditorDiv.innerHTML = "";
                await refreshTasksTabUI(); // CHANGED
            } catch (e) {
                showErrorInline("Reset tasks error: " + (e?.message || String(e)));
            }
        });

        const taskDefaultsActions = document.createElement('div'); // ADDED
        taskDefaultsActions.style.marginTop = '10px'; // ADDED
        taskDefaultsActions.style.paddingTop = '10px'; // ADDED
        taskDefaultsActions.style.borderTop = '1px solid #d1d5db'; // ADDED
        taskDefaultsActions.style.display = 'flex'; // ADDED
        taskDefaultsActions.style.flexWrap = 'wrap'; // ADDED
        taskDefaultsActions.style.alignItems = 'center'; // ADDED
        taskDefaultsActions.style.gap = '8px'; // ADDED
        taskDefaultsActions.appendChild(resetTasksBtn); // ADDED
        taskDefaultsActions.appendChild(restoreBuiltinsBtn); // ADDED
        taskDefaultsActions.appendChild(row("Save these tasks as plant default", saveDefaultChk).row); // CHANGED
        tasksTab.insertBefore(taskDefaultsActions, taskEditorDiv); // ADDED


        // ============================================================================
        // TABS WRAPPER
        // ============================================================================

        const tabsContainer = document.createElement("div");
        tabsContainer.className = "usl-scheduler-dialog"; // CHANGE
        tabsContainer.style.display = "flex";
        tabsContainer.style.flexDirection = "column";
        tabsContainer.style.height = "100%";
        tabsContainer.style.maxWidth = "96vw"; // ADDED
        tabsContainer.style.maxHeight = "85vh"; // ADDED
        tabsContainer.style.overflow = "hidden"; // ADDED
        tabsContainer.style.boxSizing = "border-box"; // ADDED

        const schedulerDialogStyle = document.createElement("style"); // NEW
        schedulerDialogStyle.textContent = ` /* NEW */
            .usl-scheduler-dialog{--usl-primary:#2563eb;--usl-primary-bg:#eff6ff;--usl-primary-soft:#93c5fd;--usl-primary-dark:#1d4ed8;--usl-success:#166534;--usl-success-bg:#f0fdf4;--usl-danger:#b91c1c;--usl-danger-bg:#fef2f2;--usl-warning:#92400e;--usl-warning-bg:#fffbeb;--usl-neutral-900:#172018;--usl-neutral-700:#4b5563;--usl-neutral-500:#777;--usl-neutral-300:#d1d5db;--usl-neutral-100:#f8f8f8;background:#fff;color:var(--usl-neutral-900);font:12px Arial,sans-serif;width:100%;min-width:0}
            .usl-scheduler-header{padding:10px 12px 8px;border-bottom:1px solid var(--usl-neutral-300);display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;background:#fff}
            .usl-scheduler-title{font-weight:700;font-size:15px;white-space:nowrap;color:var(--usl-neutral-900)}
            .usl-scheduler-subtitle{color:var(--usl-neutral-700);font-weight:700;overflow-wrap:anywhere}
            .usl-scheduler-tabs{padding:7px 12px;border-bottom:1px solid var(--usl-neutral-300);display:flex!important;gap:8px!important;align-items:center;flex-wrap:wrap;background:var(--usl-neutral-100);margin-bottom:0!important}
            .usl-scheduler-tab{border:1px solid var(--usl-primary)!important;background:#fff!important;color:var(--usl-primary)!important;border-radius:6px!important;cursor:pointer!important;padding:6px 10px!important;font:12px Arial,sans-serif!important;min-width:100px!important}
            .usl-scheduler-tab[data-active="true"]{background:var(--usl-primary)!important;color:#fff!important}
            .usl-scheduler-body{flex:1 1 0!important;min-height:0;overflow-y:auto!important;overflow-x:hidden;padding:12px;overscroll-behavior:contain;background:#fff}
            .usl-scheduler-footer{padding:9px 12px;border-top:1px solid #ccc;background:#fff;display:flex;justify-content:flex-end;align-items:center;gap:10px;flex-wrap:wrap}
            .usl-scheduler-footer-actions{margin-top:0!important;display:flex!important;justify-content:flex-end!important;gap:8px;flex-wrap:wrap}
            .usl-scheduler-action-row{display:flex!important;gap:8px!important;flex-wrap:wrap;justify-content:flex-end}
            .usl-scheduler-dialog button{border:1px solid var(--usl-neutral-500);background:#fff;color:var(--usl-neutral-900);border-radius:6px;cursor:pointer;padding:6px 10px;font:12px Arial,sans-serif}
            .usl-scheduler-dialog button:hover{border-color:var(--usl-primary);color:var(--usl-primary)}
            .usl-scheduler-dialog input,.usl-scheduler-dialog select,.usl-scheduler-dialog textarea{padding:5px 6px;border:1px solid #bbb;border-radius:6px;box-sizing:border-box;font:12px Arial,sans-serif;max-width:100%}
            .usl-scheduler-dialog input[type="checkbox"]{width:auto;padding:0;border:0}
            .usl-scheduler-row > input[type="checkbox"]{flex:0 0 auto}
            .usl-scheduler-dialog input:disabled,.usl-scheduler-dialog select:disabled{background:#f3f4f6;color:#6b7280}
            .usl-scheduler-row{display:flex!important;gap:8px!important;align-items:center!important;flex-wrap:wrap;margin:6px 0!important}
            .usl-scheduler-row-label{flex:0 0 180px;min-width:0!important;font-weight:700;color:var(--usl-neutral-700)}
            .usl-scheduler-row > :not(label){flex:1 1 220px;min-width:0}
            .usl-scheduler-section{border:1px solid var(--usl-neutral-300);border-radius:8px;background:#fff;overflow:hidden;margin-top:12px!important}
            .usl-scheduler-section--allow-popover{overflow:visible}
            .usl-scheduler-section-heading{padding:9px 10px!important;border-bottom:1px solid var(--usl-neutral-300)!important;margin-bottom:0!important;background:var(--usl-neutral-100);font-weight:700!important;font-size:13px!important}
            .usl-scheduler-section-body{padding:10px}
            .usl-scheduler-summary{border:1px solid var(--usl-neutral-300)!important;border-radius:8px!important;background:linear-gradient(180deg,#fff,var(--usl-neutral-100))!important;margin-bottom:10px!important}
            .usl-scheduler-summary-title{font-size:16px;font-weight:700!important;color:var(--usl-neutral-900)}
            .usl-scheduler-summary-grid{display:grid!important;grid-template-columns:repeat(4,minmax(120px,1fr))!important;gap:6px!important}
            .usl-scheduler-summary-item{border:1px solid var(--usl-neutral-300);border-radius:6px;background:#fff;padding:6px 7px;min-width:0}
            .usl-scheduler-summary-label{color:var(--usl-neutral-700)!important;font-size:10px!important;font-weight:700;text-transform:uppercase}
            .usl-scheduler-summary-value{margin-top:3px;font-size:13px!important;font-weight:700!important;color:var(--usl-neutral-900);white-space:normal;overflow-wrap:anywhere}
            .usl-scheduler-dialog details{border:1px solid var(--usl-neutral-300)!important;border-radius:8px;background:#fff;margin-top:12px!important;overflow:hidden}
            .usl-scheduler-dialog summary{padding:9px 10px!important;background:var(--usl-neutral-100);border-bottom:1px solid var(--usl-neutral-300);font-weight:700!important}
            @media (max-width:760px){.usl-scheduler-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}.usl-scheduler-row-label{flex-basis:100%}.usl-scheduler-body{padding:10px}.usl-scheduler-title{white-space:normal}}
        `; // NEW
        tabsContainer.appendChild(schedulerDialogStyle); // NEW

        const dialogHeader = document.createElement("div"); // NEW
        dialogHeader.className = "usl-scheduler-header"; // NEW
        const dialogTitle = document.createElement("div"); // NEW
        dialogTitle.className = "usl-scheduler-title"; // NEW
        dialogTitle.textContent = "Planting Scheduler"; // NEW
        const dialogSubtitle = document.createElement("div"); // NEW
        dialogSubtitle.className = "usl-scheduler-subtitle"; // NEW
        dialogSubtitle.textContent = (effectivePlant?.plant_name || selPlant?.plant_name || "Schedule") + (hasPersistedSchedule ? " schedule" : " new schedule"); // NEW
        dialogHeader.appendChild(dialogTitle); // NEW
        dialogHeader.appendChild(dialogSubtitle); // NEW

        const tabsHeader = document.createElement("div");
        tabsHeader.className = "usl-scheduler-tabs"; // CHANGE
        tabsHeader.style.display = "flex";
        tabsHeader.style.gap = "8px";
        tabsHeader.style.marginBottom = "8px";

        const tabsBody = document.createElement("div");
        tabsBody.className = "usl-scheduler-body"; // CHANGE
        tabsBody.style.flex = "1";
        tabsBody.style.overflow = "auto";

        function setActiveTabButton(activeButton) { // NEW
            Array.from(tabsHeader.children).forEach(button => { // NEW
                if (button && button.dataset) button.dataset.active = button === activeButton ? "true" : "false"; // NEW
            }); // NEW
        } // NEW

        function makeTabButton(label, targetEl) { // CHANGE
            const b = mxUtils.button(label, () => { // CHANGE
                tabsBody.innerHTML = "";
                tabsBody.appendChild(targetEl);
                setActiveTabButton(b); // NEW
            }); // CHANGE
            b.className = "usl-scheduler-tab"; // NEW
            b.style.minWidth = "100px";
            return b;
        }

        const scheduleTabBtn = makeTabButton("Schedule", div);

        const tasksTabBtn = mxUtils.button("Tasks", async () => {
            await refreshTaskTemplateFromSelection();
            await refreshTasksTabUI(); // CHANGED
            tabsBody.innerHTML = "";
            tabsBody.appendChild(tasksTab);
            setActiveTabButton(tasksTabBtn); // NEW
        });
        tasksTabBtn.className = "usl-scheduler-tab"; // NEW
        tasksTabBtn.style.minWidth = "100px";

        tabsHeader.appendChild(scheduleTabBtn);
        tabsHeader.appendChild(tasksTabBtn);
        tabsBody.appendChild(div);

        const dialogFooter = document.createElement("div"); // NEW
        dialogFooter.className = "usl-scheduler-footer"; // NEW
        dialogFooter.appendChild(btns); // NEW

        tabsContainer.appendChild(dialogHeader); // NEW
        tabsContainer.appendChild(tabsHeader); // CHANGE
        tabsContainer.appendChild(tabsBody); // CHANGE
        tabsContainer.appendChild(dialogFooter); // NEW

        // INITIAL RENDER
        renderTasksList();
        setActiveTabButton(scheduleTabBtn); // NEW

        ui.showDialog(tabsContainer, 1120, 720, true, true); // CHANGED

    }







































    // ============================================================================
    // Task Template Model (method-driven + Cell Persistence)
    // ============================================================================

    // canonical stage names
    const TASK_STAGE_LABELS = {
        SOW: "Sow",
        GERM: "Germination",
        TRANSPLANT: "Transplant",
        HARVEST_START: "Harvest start",
        HARVEST_END: "Harvest end"
    };

    const METHOD_TASK_STAGE_POLICY = Object.freeze({
        "transplant.indoor": {
            allowedStages: ["SOW", "TRANSPLANT", "HARVEST_START", "HARVEST_END"]
        },
        "transplant.outdoor": {
            allowedStages: ["SOW", "TRANSPLANT", "HARVEST_START", "HARVEST_END"]
        },
        "transplant.purchased": {
            allowedStages: ["TRANSPLANT", "HARVEST_START", "HARVEST_END"]
        },
        "transplant.cutting": {
            allowedStages: ["SOW", "TRANSPLANT", "HARVEST_START", "HARVEST_END"]
        },
        "direct_sow.field": {
            allowedStages: ["SOW", "GERM", "HARVEST_START", "HARVEST_END"]
        },
        "direct_sow.pre_germinated": {
            allowedStages: ["SOW", "GERM", "HARVEST_START", "HARVEST_END"]
        },
        "direct_sow.plug": {
            allowedStages: ["TRANSPLANT", "HARVEST_START", "HARVEST_END"]
        }
    });

    const CANONICAL_TASK_IDS = ["prep", "sow", "start", "harden", "transplant", "thin", "harvest"];
    const CANONICAL_TASK_TYPE_BY_RULE_ID = Object.freeze({ // NEW
        prep: "bed_preparation", // NEW
        sow: "direct_sowing", // NEW
        start: "seedling_starting", // NEW
        harden: "hardening_off", // NEW
        transplant: "transplanting", // NEW
        thin: "thinning_check", // NEW
        harvest: "harvesting" // NEW
    }); // NEW

    function isCanonicalTaskId(id) {
        return CANONICAL_TASK_IDS.includes(String(id || "").trim());
    }

    function isCanonicalTaskRule(rule) {
        return isCanonicalTaskId(rule?.id);
    }

    function normalizeTaskTypeId(value) { // NEW
        return normId(value).replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, ""); // NEW
    } // NEW

    function resolveTaskRuleTaskTypeId(rule) { // NEW
        const normalized = normalizeTaskRule(rule); // NEW
        const id = String(normalized.id || "").trim(); // NEW
        if (isCanonicalTaskId(id)) return CANONICAL_TASK_TYPE_BY_RULE_ID[id] || "general"; // NEW
        return normalizeTaskTypeId(normalized.taskTypeId) || "general"; // NEW
    } // NEW

    function mergeMissingCanonicalRules(currentRules, defaultRules) {
        const current = Array.isArray(currentRules) ? currentRules : [];
        const defaults = Array.isArray(defaultRules) ? defaultRules : [];

        const existingIds = new Set(
            current
                .map(r => String(r?.id || "").trim())
                .filter(Boolean)
        );

        const merged = [...current];

        for (const rule of defaults) {
            const id = String(rule?.id || "").trim();
            if (!id) continue;
            if (!isCanonicalTaskId(id)) continue;
            if (existingIds.has(id)) continue;

            merged.push(normalizeTaskRule(rule));
        }

        const canonicalIndex = new Map(
            CANONICAL_TASK_IDS.map((id, idx) => [id, idx])
        );

        return merged
            .map((rule, originalIndex) => ({ rule, originalIndex }))
            .sort((a, b) => {
                const aId = String(a.rule?.id || "").trim();
                const bId = String(b.rule?.id || "").trim();

                const aCanonical = canonicalIndex.has(aId);
                const bCanonical = canonicalIndex.has(bId);

                if (aCanonical && bCanonical) {
                    return canonicalIndex.get(aId) - canonicalIndex.get(bId);
                }

                if (aCanonical) return -1;
                if (bCanonical) return 1;

                return a.originalIndex - b.originalIndex;
            })
            .map(x => x.rule);
    }

    function getAllowedAnchorStagesForPlanningMode(planningMode) { // CHANGED
        switch (String(planningMode || "").trim()) { // CHANGED
            case "direct_sow": // CHANGED
                return ["SOW", "GERM", "HARVEST_START", "HARVEST_END"]; // CHANGED
            case "transplant_indoor": // CHANGED
            case "transplant_outdoor": // CHANGED
                return ["SOW", "TRANSPLANT", "HARVEST_START", "HARVEST_END"]; // CHANGED
            default: // CHANGED
                return ["SOW", "GERM", "TRANSPLANT", "HARVEST_START", "HARVEST_END"]; // CHANGED
        } // CHANGED
    } // CHANGED
    
    async function getAllowedAnchorStagesForMethod(methodId) {
        const id = normId(methodId); // FIX
    
        if (!id) {
            return ["SOW", "GERM", "TRANSPLANT", "HARVEST_START", "HARVEST_END"];
        }
    
        const policy = METHOD_TASK_STAGE_POLICY[id];
        if (policy && Array.isArray(policy.allowedStages) && policy.allowedStages.length) {
            return [...policy.allowedStages];
        }
    
        const method = await getPlantingMethodById(id);
        if (!method) {
            return ["SOW", "GERM", "TRANSPLANT", "HARVEST_START", "HARVEST_END"];
        }
    
        const resolved = resolveMethodBehavior({
            methodCategoryId: method.method_category_id,
            methodId: method.method_id
        });
    
        return getAllowedAnchorStagesForPlanningMode(resolved.planningMode);
    }

    function humanStageLabel(stage) {
        return TASK_STAGE_LABELS[stage] || stage;
    }

    // -------------------- DB access (method) -----------------------------------

    function safeJsonParse(s, fallback) {
        try { return JSON.parse(s); } catch (_) { return fallback; }
    }

    function normalizeTaskRule(rule) {
        const r = { ...(rule || {}) }; // CHANGED

        // ---------- v1 -> v2 start field migration ---------- // CHANGED
        if (r.startAnchorStage == null && r.anchorStage != null) {
            r.startAnchorStage = r.anchorStage; // CHANGED
        }
        if (r.startOffsetDays == null && r.offsetDays != null) {
            r.startOffsetDays = r.offsetDays; // CHANGED
        }
        if (r.startOffsetDirection == null && r.offsetDirection != null) {
            r.startOffsetDirection = r.offsetDirection; // CHANGED
        }

        // ---------- defaults for start ---------- // CHANGED
        r.startAnchorStage = String(r.startAnchorStage || "SOW"); // CHANGED
        r.startOffsetDays = Number(r.startOffsetDays ?? 0); // CHANGED
        r.startOffsetDirection = (r.startOffsetDirection === "before") ? "before" : "after"; // CHANGED

        // ---------- end mode ---------- // CHANGED
        if (!r.endMode) { // CHANGED
            if (r.id === "harvest") {
                r.endMode = "anchor_range"; // CHANGED
            } else {
                r.endMode = "fixed_days"; // CHANGED
            }
        }

        if (r.endMode === "anchor_range") { // CHANGED
            r.durationDays = null; // CHANGED
            r.endAnchorStage = String(r.endAnchorStage || "HARVEST_END");
            r.endAnchorOffsetDays = Number(r.endAnchorOffsetDays ?? 0); // CHANGED
            r.endAnchorOffsetDirection = (r.endAnchorOffsetDirection === "before") ? "before" : "after"; // CHANGED
        } else {
            r.endMode = "fixed_days"; // CHANGED
            r.durationDays = Number(r.durationDays ?? 1); // CHANGED
            r.endAnchorStage = r.endAnchorStage ?? null; // CHANGED
            r.endAnchorOffsetDays = Number(r.endAnchorOffsetDays ?? 0); // CHANGED
            r.endAnchorOffsetDirection = (r.endAnchorOffsetDirection === "before") ? "before" : "after"; // CHANGED
        }

        // ---------- repeat migration ---------- // CHANGED
        if (!r.repeatMode) { // CHANGED
            r.repeatMode = (r.repeat === true) ? "interval" : "none"; // CHANGED
        }
        r.repeatMode = (r.repeatMode === "interval") ? "interval" : "none"; // CHANGED
        r.repeatEveryDays = Number(r.repeatEveryDays ?? 1); // CHANGED
        r.repeatUntilMode = (r.repeatUntilMode === "until_anchor") ? "until_anchor" : "x_times"; // CHANGED
        r.repeatTimes = Number(r.repeatTimes ?? r.repeatUntilValue ?? 1); // CHANGED
        r.repeatUntilAnchorStage = String(r.repeatUntilAnchorStage || "HARVEST_END"); // CHANGED
        r.repeatCutoffOffsetDays = Number(r.repeatCutoffOffsetDays ?? 0); // ADDED
        r.repeatCutoffOffsetDirection = (r.repeatCutoffOffsetDirection === "before") ? "before" : "after"; // ADDED
        if (isCanonicalTaskId(r.id)) { // NEW
            delete r.taskTypeId; // NEW
            delete r.task_type_id; // NEW
        } else { // NEW
            r.taskTypeId = normalizeTaskTypeId(r.taskTypeId || r.task_type_id); // NEW
            delete r.task_type_id; // NEW
        } // NEW

        return r; // CHANGED
    }

    function normalizeTaskTemplate(template) {
        const src = (template && typeof template === "object") ? template : {}; // CHANGED
        const rules = Array.isArray(src.rules) ? src.rules.map(normalizeTaskRule) : []; // CHANGED
        return { version: 2, rules }; // CHANGED
    }

    function validateTaskRule(rule, { allowedStages = null, requireTaskType = false } = {}) { // CHANGE
        const r = normalizeTaskRule(rule);
        const rawRepeatUntilMode = rule && Object.prototype.hasOwnProperty.call(rule, "repeatUntilMode") ? String(rule.repeatUntilMode || "") : ""; // ADDED

        if (!String(r.title || "").trim()) throw new Error("Task title is required.");
        if (requireTaskType && !isCanonicalTaskId(r.id) && !String(r.taskTypeId || "").trim()) throw new Error("Task type is required."); // NEW
        if (!String(r.startAnchorStage || "").trim()) throw new Error("Start anchor is required.");
        if (!Number.isFinite(r.startOffsetDays) || r.startOffsetDays < 0) {
            throw new Error("Start offset must be 0 or greater.");
        }

        if (Array.isArray(allowedStages) && allowedStages.length) {
            if (!allowedStages.includes(r.startAnchorStage)) {
                throw new Error("Start anchor is not available for the current method.");
            }
        }

        if (r.endMode === "fixed_days") {
            if (!Number.isFinite(r.durationDays) || r.durationDays < 0) {
                throw new Error("Duration days must be 0 or greater.");
            }
        } else if (r.endMode === "anchor_range") {
            if (!String(r.endAnchorStage || "").trim()) {
                throw new Error("End anchor is required for anchor-range tasks.");
            }
            if (Array.isArray(allowedStages) && allowedStages.length) {
                if (!allowedStages.includes(r.endAnchorStage)) {
                    throw new Error("End anchor is not available for the current method.");
                }
            }
        } else {
            throw new Error("Invalid end mode.");
        }

        if (r.repeatMode === "interval") {
            if (rawRepeatUntilMode && rawRepeatUntilMode !== "x_times" && rawRepeatUntilMode !== "until_anchor") { // ADDED
                throw new Error("Invalid repeat-until mode."); // ADDED
            } // ADDED
            if (!Number.isFinite(r.repeatEveryDays) || r.repeatEveryDays < 1) {
                throw new Error("Repeat every days must be at least 1.");
            }
            if (!String(r.repeatUntilAnchorStage || "").trim()) { // CHANGED
                throw new Error("Cutoff anchor is required for repeated tasks."); // CHANGED
            }
            if (!Number.isFinite(r.repeatCutoffOffsetDays) || r.repeatCutoffOffsetDays < 0) { // ADDED
                throw new Error("Cutoff offset must be 0 or greater."); // ADDED
            }
            if (Array.isArray(allowedStages) && allowedStages.length) { // CHANGED
                if (!allowedStages.includes(r.repeatUntilAnchorStage)) { // CHANGED
                    throw new Error("Cutoff anchor is not available for the current method."); // CHANGED
                }
            }

            if (r.repeatUntilMode === "x_times") {
                if (!Number.isFinite(r.repeatTimes) || r.repeatTimes < 1) {
                    throw new Error("Repeat times must be at least 1.");
                }
            } else if (r.repeatUntilMode === "until_anchor") {
                // The cutoff anchor already supplies the stop date for this mode. // CHANGED
            } else {
                throw new Error("Invalid repeat-until mode.");
            }
        }

        return r;
    }

    function describeTaskRule(rule) {
        const r = normalizeTaskRule(rule);

        function fmtOffset(days, dir, stage) {
            const n = Number(days ?? 0);
            const label = humanStageLabel(stage);

            if (!Number.isFinite(n) || n === 0) return label;

            return `${n} day${n === 1 ? "" : "s"} ${dir} ${label}`;
        }

        const parts = [];

        parts.push(r.title);

        // timing
        const startTxt = fmtOffset(
            r.startOffsetDays,
            r.startOffsetDirection,
            r.startAnchorStage
        );

        if (r.endMode === "anchor_range") {
            const endLabel = humanStageLabel(r.endAnchorStage);

            if (r.startOffsetDays === 0 &&
                r.endAnchorOffsetDays === 0 &&
                r.startAnchorStage === "HARVEST_START" &&
                r.endAnchorStage === "HARVEST_END") {

                parts.push("Harvest window");

            } else {
                const endTxt = fmtOffset(
                    r.endAnchorOffsetDays,
                    r.endAnchorOffsetDirection,
                    r.endAnchorStage
                );

                parts.push(`${startTxt} → ${endTxt}`);
            }

        } else {
            parts.push(startTxt);

            if (r.durationDays > 1) {
                parts.push(`${r.durationDays} days`);
            }
        }

        if (r.repeatMode === "interval") {
            const cutoffTxt = fmtOffset( // ADDED
                r.repeatCutoffOffsetDays, // ADDED
                r.repeatCutoffOffsetDirection, // ADDED
                r.repeatUntilAnchorStage // ADDED
            ); // ADDED
            const repeatTxt = (r.repeatUntilMode === "x_times")
                ? `repeat every ${r.repeatEveryDays} days, up to ${r.repeatTimes} time${r.repeatTimes === 1 ? "" : "s"}, until ${cutoffTxt}` // CHANGED
                : `repeat every ${r.repeatEveryDays} days until ${cutoffTxt}`; // CHANGED

            parts.push(repeatTxt);
        }

        return parts.join(" • ");
    }

    function getTaskPreviewRuleKey(rule, ruleIndex) { // ADDED
        const id = String(rule?.id || 'rule').trim() || 'rule'; // ADDED
        return `${id}::${Number(ruleIndex)}`; // ADDED
    } // ADDED

    function normalizeTaskTitleIdentity(value) { // ADDED
        return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase(); // ADDED
    } // ADDED

    function taskTitleContainsIdentity(title, identity) { // ADDED
        const normalizedTitle = normalizeTaskTitleIdentity(title); // ADDED
        const normalizedIdentity = normalizeTaskTitleIdentity(identity); // ADDED
        return !!normalizedIdentity && normalizedTitle.includes(normalizedIdentity); // ADDED
    } // ADDED

    function escapeTaskTitleRegExp(value) { // ADDED
        return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // ADDED
    } // ADDED

    function stripTrailingTaskIdentity(title, identity) { // ADDED
        const text = String(title || '').trim(); // ADDED
        const identityText = String(identity || '').trim(); // ADDED
        if (!text || !identityText) return text; // ADDED
        const pattern = new RegExp(`(?:\\s*(?:[-–—:]+|for)?\\s*)${escapeTaskTitleRegExp(identityText)}\\s*$`, 'i'); // ADDED
        return text.replace(pattern, '').trim(); // ADDED
    } // ADDED

    function cleanTaskActionTitle(title) { // ADDED
        return String(title || '') // ADDED
            .replace(/\{plant\}/g, '') // ADDED
            .replace(/\{succ\}/g, '') // ADDED
            .replace(/\s+for\s*$/i, '') // ADDED
            .replace(/\s*[-–—:]+\s*$/g, '') // ADDED
            .trim(); // ADDED
    } // ADDED

    function appendCropDisplayNameToTaskAction(actionTitle, cropDisplayName) { // ADDED
        const action = cleanTaskActionTitle(actionTitle) || 'Task'; // ADDED
        return `${action} – ${cropDisplayName}`; // ADDED
    } // ADDED

    function formatCropDisplayName(plantName, varietyName) { // ADDED
        const plantText = String(plantName || '').trim() || 'Plant'; // ADDED
        const varietyText = String(varietyName || '').trim(); // ADDED
        if (!varietyText) return plantText; // ADDED
        const normalizedPlant = normalizeTaskTitleIdentity(plantText); // ADDED
        const normalizedVariety = normalizeTaskTitleIdentity(varietyText); // ADDED
        if (normalizedPlant === normalizedVariety || normalizedPlant.includes(`(${normalizedVariety})`)) return plantText; // ADDED
        return `${plantText} (${varietyText})`; // ADDED
    } // ADDED

    function buildGeneratedTaskTitle(template, cropDisplayName, plantName, varietyName) { // ADDED
        const rawTitle = String(template || '').trim(); // ADDED
        const hasPlantToken = /\{plant\}/.test(rawTitle); // ADDED
        const title = rawTitle.replace(/\{succ\}/g, ''); // ADDED
        if (hasPlantToken) return appendCropDisplayNameToTaskAction(title, cropDisplayName); // CHANGED
        const customTitle = title.trim(); // ADDED
        if (!customTitle) return appendCropDisplayNameToTaskAction('Task', cropDisplayName); // CHANGED
        let actionTitle = stripTrailingTaskIdentity(customTitle, cropDisplayName); // ADDED
        actionTitle = stripTrailingTaskIdentity(actionTitle, plantName); // ADDED
        if (varietyName) actionTitle = stripTrailingTaskIdentity(actionTitle, varietyName); // ADDED
        if (taskTitleContainsIdentity(actionTitle, cropDisplayName)) return actionTitle; // CHANGED
        return appendCropDisplayNameToTaskAction(actionTitle, cropDisplayName); // CHANGED
    } // ADDED

    function taskAnchorDatesForTimeline(currentTimeline, currentSowDate) { // ADDED
        return { // ADDED
            SOW: iso(currentSowDate), // ADDED
            GERM: iso(currentTimeline.germ), // ADDED
            TRANSPLANT: iso(currentTimeline.transplant), // ADDED
            HARVEST_START: iso(currentTimeline.harvestStart), // ADDED
            HARVEST_END: iso(currentTimeline.harvestEnd) // ADDED
        }; // ADDED
    } // ADDED

    function resolveTaskAnchorISO(anchors, stage) { // ADDED
        let anchorISO = anchors[String(stage || '').trim()] || null; // ADDED
        if (!anchorISO && stage === 'GERM') anchorISO = anchors.SOW || null; // ADDED
        return anchorISO; // ADDED
    } // ADDED

    function applyTaskAnchorOffset(anchorISO, days, direction) { // ADDED
        if (!anchorISO) return null; // ADDED
        const count = Number(days ?? 0); // ADDED
        return Number.isFinite(count) ? shiftDays(anchorISO, (direction === 'before' ? -1 : 1) * count) : null; // ADDED
    } // ADDED

    function resolveTaskRuleRange(rule, anchors) { // ADDED
        const startAnchorISO = resolveTaskAnchorISO(anchors, rule.startAnchorStage); // ADDED
        if (!startAnchorISO) return null; // ADDED
        const startISO = applyTaskAnchorOffset(startAnchorISO, rule.startOffsetDays, rule.startOffsetDirection); // ADDED
        if (!startISO) return null; // ADDED

        let endISO = startISO; // ADDED
        if (rule.endMode === 'fixed_days') { // ADDED
            const duration = Number(rule.durationDays ?? 0); // ADDED
            endISO = Number.isFinite(duration) && duration >= 0 ? shiftDays(startISO, duration) : startISO; // ADDED
        } else if (rule.endMode === 'anchor_range') { // ADDED
            const endAnchorISO = resolveTaskAnchorISO(anchors, rule.endAnchorStage); // ADDED
            if (!endAnchorISO) return null; // ADDED
            endISO = applyTaskAnchorOffset(endAnchorISO, rule.endAnchorOffsetDays, rule.endAnchorOffsetDirection); // ADDED
            if (!endISO) return null; // ADDED
        } else { // ADDED
            return null; // ADDED
        } // ADDED

        let rangeStartISO = startISO; // ADDED
        let rangeEndISO = endISO; // ADDED
        if (rangeEndISO < rangeStartISO) { // ADDED
            [rangeStartISO, rangeEndISO] = [rangeEndISO, rangeStartISO]; // ADDED
        } // ADDED
        return { rangeStartISO, rangeEndISO }; // ADDED
    } // ADDED

    function resolveRepeatCutoffISO(rule, anchors) { // ADDED
        const cutoffAnchorISO = resolveTaskAnchorISO(anchors, rule.repeatUntilAnchorStage); // ADDED
        return applyTaskAnchorOffset(cutoffAnchorISO, rule.repeatCutoffOffsetDays, rule.repeatCutoffOffsetDirection); // ADDED
    } // ADDED

    function validateTaskRuleAnchorOrder(rule, { schedule, timelines } = {}) { // ADDED
        const r = normalizeTaskRule(rule); // ADDED
        const sowDate = Array.isArray(schedule) ? schedule[0] : schedule; // ADDED
        const timeline = Array.isArray(timelines) ? timelines[0] : timelines; // ADDED
        if (!sowDate || !timeline) return r; // ADDED
        const anchors = taskAnchorDatesForTimeline(timeline, sowDate); // ADDED
        const startAnchorISO = resolveTaskAnchorISO(anchors, r.startAnchorStage); // ADDED
        const startISO = applyTaskAnchorOffset(startAnchorISO, r.startOffsetDays, r.startOffsetDirection); // ADDED
        if (!startISO) return r; // ADDED

        if (r.endMode === "anchor_range") { // ADDED
            const endAnchorISO = resolveTaskAnchorISO(anchors, r.endAnchorStage); // ADDED
            const endISO = applyTaskAnchorOffset(endAnchorISO, r.endAnchorOffsetDays, r.endAnchorOffsetDirection); // ADDED
            if (endISO && startISO > endISO) { // ADDED
                throw new Error("Start must be on or before the end anchor."); // ADDED
            } // ADDED
        } // ADDED

        if (r.repeatMode === "interval") { // ADDED
            const cutoffISO = resolveRepeatCutoffISO(r, anchors); // ADDED
            if (cutoffISO && startISO > cutoffISO) { // ADDED
                throw new Error("Start must be on or before the cutoff anchor."); // ADDED
            } // ADDED
        } // ADDED

        return r; // ADDED
    } // ADDED

    function findRepeatCutoffOmittedRuleKeys({ taskTemplate, schedule, timelines } = {}) { // ADDED
        const omitted = new Set(); // ADDED
        const tpl = normalizeTaskTemplate(taskTemplate ?? null); // ADDED
        const rules = Array.isArray(tpl?.rules) ? tpl.rules : []; // ADDED
        const sowDate = Array.isArray(schedule) ? schedule[0] : schedule; // ADDED
        const timeline = Array.isArray(timelines) ? timelines[0] : timelines; // ADDED
        if (!sowDate || !timeline) return omitted; // ADDED
        const anchors = taskAnchorDatesForTimeline(timeline, sowDate); // ADDED

        rules.forEach((sourceRule, ruleIndex) => { // ADDED
            const rule = normalizeTaskRule(sourceRule); // ADDED
            if (rule.repeatMode !== 'interval') return; // ADDED
            const range = resolveTaskRuleRange(rule, anchors); // ADDED
            const cutoffISO = resolveRepeatCutoffISO(rule, anchors); // ADDED
            if (!range || !cutoffISO) return; // ADDED
            if (range.rangeStartISO >= cutoffISO) { // ADDED
                omitted.add(getTaskPreviewRuleKey(rule, ruleIndex)); // ADDED
            } // ADDED
        }); // ADDED

        return omitted; // ADDED
    } // ADDED

    async function buildTasksForPlan({ // ADDED
        plant, // ADDED
        schedule, // ADDED
        timelines, // ADDED
        taskTemplate, // ADDED
        varietyName = '', // ADDED
        includePreviewMetadata = false // ADDED
    }) { // ADDED
        const tasks = []; // ADDED
        const plantName = plant?.plant_name || plant?.abbr || "Plant"; // ADDED
        const cropDisplayName = formatCropDisplayName(plantName, varietyName); // ADDED
        const tpl = normalizeTaskTemplate(taskTemplate ?? null); // ADDED
        const rules = Array.isArray(tpl?.rules) ? tpl.rules : []; // ADDED
        const sowDate = Array.isArray(schedule) ? schedule[0] : schedule; // ADDED
        const timeline = Array.isArray(timelines) ? timelines[0] : timelines; // ADDED
        if (!sowDate || !timeline) return tasks; // ADDED

        function substituteTitle(template) { // ADDED
            return buildGeneratedTaskTitle(template, cropDisplayName, plantName, varietyName); // CHANGED
        } // ADDED

        const anchors = taskAnchorDatesForTimeline(timeline, sowDate); // CHANGED
        for (let ruleIndex = 0; ruleIndex < rules.length; ruleIndex++) { // ADDED
            const rule = normalizeTaskRule(rules[ruleIndex]); // ADDED
            validateTaskRuleAnchorOrder(rule, { schedule: sowDate, timelines: timeline }); // ADDED
            const range = resolveTaskRuleRange(rule, anchors); // CHANGED
            if (!range) continue; // ADDED
            const { rangeStartISO, rangeEndISO } = range; // ADDED

            const occurrences = []; // ADDED
            if (rule.repeatMode !== 'interval') { // ADDED
                occurrences.push({ startISO: rangeStartISO, endISO: rangeEndISO }); // ADDED
            } else { // ADDED
                const every = Number(rule.repeatEveryDays ?? 0); // ADDED
                if (!Number.isFinite(every) || every < 1) continue; // ADDED
                const cutoffISO = resolveRepeatCutoffISO(rule, anchors); // ADDED
                if (!cutoffISO) continue; // ADDED
                if (rule.repeatUntilMode === 'x_times') { // ADDED
                    const times = Number(rule.repeatTimes ?? 1); // ADDED
                    if (!Number.isFinite(times) || times < 1) continue; // ADDED
                    let currentStart = rangeStartISO; // ADDED
                    let currentEnd = rangeEndISO; // ADDED
                    for (let occurrenceIndex = 0; occurrenceIndex < times; occurrenceIndex++) { // ADDED
                        if (currentStart >= cutoffISO) break; // ADDED
                        occurrences.push({ startISO: currentStart, endISO: currentEnd }); // ADDED
                        currentStart = shiftDays(currentStart, every); // ADDED
                        currentEnd = shiftDays(currentEnd, every); // ADDED
                    } // ADDED
                } else if (rule.repeatUntilMode === 'until_anchor') { // ADDED
                    let currentStart = rangeStartISO; // ADDED
                    let currentEnd = rangeEndISO; // ADDED
                    while (currentStart < cutoffISO) { // CHANGED
                        occurrences.push({ startISO: currentStart, endISO: currentEnd }); // ADDED
                        currentStart = shiftDays(currentStart, every); // ADDED
                        currentEnd = shiftDays(currentEnd, every); // ADDED
                    } // ADDED
                } else { // ADDED
                    continue; // ADDED
                } // ADDED
            } // ADDED

            const title = substituteTitle(rule.title) || `Task for ${cropDisplayName}`; // CHANGED
            const previewRuleKey = getTaskPreviewRuleKey(rule, ruleIndex); // ADDED
            occurrences.forEach((occurrence, occurrenceIndex) => { // ADDED
                if (!occurrence.startISO && !occurrence.endISO) return; // ADDED
                const task = { // ADDED
                    title, // ADDED
                    startISO: occurrence.startISO || occurrence.endISO, // ADDED
                    endISO: occurrence.endISO || occurrence.startISO, // ADDED
                    plant_name: plantName, // ADDED
                    variety_name: String(varietyName || '').trim(), // ADDED
                    rule_id: rule.id || null, // ADDED
                    task_type_id: resolveTaskRuleTaskTypeId(rule), // NEW
                    startAnchorStage: rule.startAnchorStage, // ADDED
                    endMode: rule.endMode // ADDED
                }; // ADDED
                if (includePreviewMetadata) { // ADDED
                    Object.defineProperties(task, { // ADDED
                        previewRuleKey: { value: previewRuleKey, enumerable: false }, // ADDED
                        previewRuleIndex: { value: ruleIndex, enumerable: false }, // ADDED
                        previewOccurrenceIndex: { value: occurrenceIndex, enumerable: false } // ADDED
                    }); // ADDED
                } // ADDED
                tasks.push(task); // ADDED
            }); // ADDED
        } // ADDED
        return tasks; // ADDED
    } // ADDED

    function filterPreviewTasks(tasks, selectedRuleKeys) { // CHANGED
        const selected = selectedRuleKeys instanceof Set ? selectedRuleKeys : new Set(selectedRuleKeys || []); // ADDED
        return (Array.isArray(tasks) ? tasks : []).filter(task => selected.has(task.previewRuleKey)); // CHANGED
    } // ADDED

    function buildTaskRuleDisplayOrder(taskRules, generatedTasks) { // ADDED
        const firstOccurrenceByRule = new Map(); // ADDED
        (Array.isArray(generatedTasks) ? generatedTasks : []).forEach(task => { // ADDED
            const key = task.previewRuleKey; // ADDED
            const startISO = String(task.startISO || ''); // ADDED
            if (!key || !startISO) return; // ADDED
            const current = firstOccurrenceByRule.get(key); // ADDED
            if (!current || startISO < current) firstOccurrenceByRule.set(key, startISO); // ADDED
        }); // ADDED
        return (Array.isArray(taskRules) ? taskRules : []) // ADDED
            .map((rule, originalIndex) => ({ // ADDED
                rule, // ADDED
                originalIndex, // ADDED
                key: getTaskPreviewRuleKey(rule, originalIndex), // ADDED
                firstOccurrenceISO: firstOccurrenceByRule.get(getTaskPreviewRuleKey(rule, originalIndex)) || null // ADDED
            })) // ADDED
            .sort((left, right) => { // ADDED
                if (left.firstOccurrenceISO && right.firstOccurrenceISO) { // ADDED
                    const dateOrder = left.firstOccurrenceISO.localeCompare(right.firstOccurrenceISO); // ADDED
                    if (dateOrder !== 0) return dateOrder; // ADDED
                } else if (left.firstOccurrenceISO) { // ADDED
                    return -1; // ADDED
                } else if (right.firstOccurrenceISO) { // ADDED
                    return 1; // ADDED
                } // ADDED
                return left.originalIndex - right.originalIndex; // ADDED
            }); // ADDED
    } // ADDED

    function groupPreviewTasksByRule(tasks) { // ADDED
        const groupsByKey = new Map(); // ADDED
        (Array.isArray(tasks) ? tasks : []).forEach((task, taskIndex) => { // ADDED
            const key = task.previewRuleKey || `${String(task.rule_id || 'rule')}::${taskIndex}`; // ADDED
            if (!groupsByKey.has(key)) { // ADDED
                groupsByKey.set(key, { // ADDED
                    key, // ADDED
                    title: task.title, // ADDED
                    originalIndex: Number(task.previewRuleIndex ?? taskIndex), // ADDED
                    firstOccurrenceISO: String(task.startISO || ''), // ADDED
                    occurrences: [] // ADDED
                }); // ADDED
            } // ADDED
            const group = groupsByKey.get(key); // ADDED
            group.occurrences.push(task); // ADDED
            if (task.startISO && (!group.firstOccurrenceISO || task.startISO < group.firstOccurrenceISO)) { // ADDED
                group.firstOccurrenceISO = task.startISO; // ADDED
            } // ADDED
        }); // ADDED
        return Array.from(groupsByKey.values()) // ADDED
            .map(group => ({ // ADDED
                ...group, // ADDED
                occurrences: group.occurrences.slice().sort((left, right) => { // ADDED
                    const startOrder = String(left.startISO || '').localeCompare(String(right.startISO || '')); // ADDED
                    if (startOrder !== 0) return startOrder; // ADDED
                    return String(left.endISO || '').localeCompare(String(right.endISO || '')); // ADDED
                }) // ADDED
            })) // ADDED
            .sort((left, right) => { // ADDED
                const dateOrder = left.firstOccurrenceISO.localeCompare(right.firstOccurrenceISO); // ADDED
                if (dateOrder !== 0) return dateOrder; // ADDED
                return left.originalIndex - right.originalIndex; // CHANGED
            }); // ADDED
    } // ADDED

    function resolveTaskPreviewScheduleRange(result) { // ADDED
        const startISO = result?.kind === 'perennial' // ADDED
            ? String(result.lifespanStartISO || '') // ADDED
            : fmtISO(result?.schedule?.[0]); // ADDED
        const endISO = result?.kind === 'perennial' // ADDED
            ? String(result.lifespanEndISO || '') // ADDED
            : String(result?.lastScheduledHarvestEndISO || ''); // ADDED
        const start = parseISODateUTCValue(startISO); // ADDED
        const end = parseISODateUTCValue(endISO); // ADDED
        if (!start || !end || end < start) return null; // ADDED
        return { startISO: fmtISO(start), endISO: fmtISO(end) }; // ADDED
    } // ADDED

    function resolveTaskPreviewDisplayRange(scheduleRange, tasks = []) { // NEW
        let rangeStart = parseISODateUTCValue(scheduleRange?.startISO); // NEW
        let rangeEnd = parseISODateUTCValue(scheduleRange?.endISO); // NEW
        if (!rangeStart || !rangeEnd || rangeEnd < rangeStart) return scheduleRange || null; // NEW
        (Array.isArray(tasks) ? tasks : []).forEach(task => { // NEW
            const taskStart = parseISODateUTCValue(task?.startISO); // NEW
            const taskEnd = parseISODateUTCValue(task?.endISO); // NEW
            if (!taskStart || !taskEnd || taskEnd < taskStart) return; // FIX
            if (taskStart && taskStart < rangeStart) rangeStart = taskStart; // FIX
            if (taskEnd && taskEnd > rangeEnd) rangeEnd = taskEnd; // FIX
        }); // NEW
        return { startISO: fmtISO(rangeStart), endISO: fmtISO(rangeEnd) }; // NEW
    } // NEW

    function renderTaskTimelinePreview(container, { tasks = [], scheduleRange = null, message = '', error = '' } = {}) { // CHANGED
        container.innerHTML = ''; // ADDED
        if (error || message || !tasks.length) { // ADDED
            const empty = document.createElement('div'); // ADDED
            empty.textContent = error || message || 'No tasks are available for the current preview selection.'; // ADDED
            empty.style.padding = '10px'; // ADDED
            empty.style.border = `1px solid ${error ? '#fca5a5' : '#d1d5db'}`; // ADDED
            empty.style.background = error ? '#fef2f2' : '#f9fafb'; // ADDED
            empty.style.color = error ? '#991b1b' : '#4b5563'; // ADDED
            container.appendChild(empty); // ADDED
            return; // ADDED
        } // ADDED

        const rangeStart = parseISODateUTCValue(scheduleRange?.startISO); // CHANGED
        const rangeEnd = parseISODateUTCValue(scheduleRange?.endISO); // CHANGED
        if (!rangeStart || !rangeEnd || rangeEnd < rangeStart) { // CHANGED
            renderTaskTimelinePreview(container, { error: 'The schedule does not contain valid preview bounds.' }); // CHANGED
            return; // ADDED
        } // ADDED
        const totalDays = Math.max(1, Math.round((rangeEnd - rangeStart) / 86400000)); // ADDED

        const labels = document.createElement('div'); // ADDED
        labels.style.display = 'grid'; // ADDED
        labels.style.gridTemplateColumns = '190px 1fr'; // ADDED
        labels.style.gap = '8px'; // ADDED
        const spacer = document.createElement('div'); // ADDED
        const dateScale = document.createElement('div'); // ADDED
        dateScale.style.display = 'flex'; // ADDED
        dateScale.style.justifyContent = 'space-between'; // ADDED
        dateScale.style.fontSize = '11px'; // ADDED
        dateScale.style.color = '#6b7280'; // ADDED
        const startLabel = document.createElement('span'); // ADDED
        const endLabel = document.createElement('span'); // ADDED
        startLabel.textContent = fmtISO(rangeStart); // ADDED
        endLabel.textContent = fmtISO(rangeEnd); // ADDED
        dateScale.appendChild(startLabel); // ADDED
        dateScale.appendChild(endLabel); // ADDED
        labels.appendChild(spacer); // ADDED
        labels.appendChild(dateScale); // ADDED
        container.appendChild(labels); // ADDED

        groupPreviewTasksByRule(tasks).forEach(group => { // CHANGED
            const rowEl = document.createElement('div'); // ADDED
            rowEl.style.display = 'grid'; // ADDED
            rowEl.style.gridTemplateColumns = '190px 1fr'; // ADDED
            rowEl.style.gap = '8px'; // ADDED
            rowEl.style.alignItems = 'center'; // ADDED
            rowEl.style.margin = '5px 0'; // ADDED
            const taskLabel = document.createElement('div'); // ADDED
            taskLabel.textContent = group.title; // CHANGED
            taskLabel.title = `${group.occurrences.length} occurrence${group.occurrences.length === 1 ? '' : 's'}`; // CHANGED
            taskLabel.style.fontSize = '12px'; // ADDED
            taskLabel.style.overflow = 'hidden'; // ADDED
            taskLabel.style.textOverflow = 'ellipsis'; // ADDED
            taskLabel.style.whiteSpace = 'nowrap'; // ADDED
            const track = document.createElement('div'); // ADDED
            track.style.position = 'relative'; // ADDED
            track.style.height = '16px'; // ADDED
            track.style.background = '#e5e7eb'; // ADDED
            track.style.borderRadius = '3px'; // ADDED
            group.occurrences.forEach(task => { // ADDED
                const taskStart = parseISODateUTCValue(task.startISO); // ADDED
                const taskEnd = parseISODateUTCValue(task.endISO); // ADDED
                if (!taskStart || !taskEnd) return; // ADDED
                if (taskEnd < rangeStart || taskStart > rangeEnd) return; // ADDED
                const clippedStart = new Date(Math.max(taskStart.getTime(), rangeStart.getTime())); // ADDED
                const clippedEnd = new Date(Math.min(taskEnd.getTime(), rangeEnd.getTime())); // ADDED
                const offsetDays = Math.round((clippedStart - rangeStart) / 86400000); // CHANGED
                const durationDays = Math.max(0, Math.round((clippedEnd - clippedStart) / 86400000)); // CHANGED
                const leftPercent = Math.max(0, Math.min(99, (offsetDays / totalDays) * 100)); // CHANGED
                const widthPercent = Math.max(1, Math.min(100 - leftPercent, (Math.max(1, durationDays) / totalDays) * 100)); // ADDED
                const bar = document.createElement('div'); // ADDED
                bar.style.position = 'absolute'; // ADDED
                bar.style.left = `${leftPercent}%`; // CHANGED
                bar.style.width = `${widthPercent}%`; // CHANGED
                bar.style.height = '100%'; // ADDED
                bar.style.background = '#2563eb'; // ADDED
                bar.style.borderRadius = '3px'; // ADDED
                bar.title = `${task.title}: ${task.startISO} to ${task.endISO}`; // ADDED
                track.appendChild(bar); // ADDED
            }); // ADDED
            rowEl.appendChild(taskLabel); // ADDED
            rowEl.appendChild(track); // ADDED
            container.appendChild(rowEl); // ADDED
        }); // ADDED
    } // ADDED

    function updateTaskTimelinePreview({ // ADDED
        container, // ADDED
        generatedTasks = [], // ADDED
        selectedRuleKeys = new Set(), // ADDED
        scheduleRange = null, // ADDED
        message = '', // ADDED
        error = '' // ADDED
    } = {}) { // ADDED
        const tasks = filterPreviewTasks(generatedTasks, selectedRuleKeys); // CHANGED
        const displayRange = resolveTaskPreviewDisplayRange(scheduleRange, tasks); // FIX
        renderTaskTimelinePreview(container, { tasks, scheduleRange: displayRange, message, error }); // FIX
        return tasks; // ADDED
    } // ADDED

    async function getPlantingMethodById(methodId) {
        const normalizedMethodId = normId(methodId); // FIX
        if (!normalizedMethodId) return null;
        const sql = `
        SELECT method_id, method_name, method_category_id, tasks_required_json
        FROM PlantingMethods
        WHERE LOWER(TRIM(method_id)) = ?
        ORDER BY CASE
                   WHEN TRIM(method_id) = LOWER(TRIM(method_id)) THEN 0
                   ELSE 1
                 END,
                 method_id
        LIMIT 1;`;
        const rows = await queryAll(sql, [normalizedMethodId]);
        return rows[0] ? {
            ...rows[0],
            method_id: normId(rows[0].method_id),
            method_category_id: normId(rows[0].method_category_id)
        } : null; // FIX
    }

    // -------------------- Rule library --------------------------

    function prettySourceLabel(src) {
        const map = {
            cell: "Cell override",
            variety: "Variety default",
            plant: "Plant default",
            method_builtin: "Built-in method template",
            none: "No template",
            unknown: "Unknown"
        };
        return map[src] || String(src || "unknown");
    }

    function updateTasksHeader({
        methodCategorySel,
        methodSel,
        formState,
        currentMethodSpan,
        currentTemplateSourceSpan,
        taskDirty,
        taskTemplateSource
    }) {
        const methodCategoryName = (() => {
            const opt = methodCategorySel?.selectedOptions?.[0];
            const label = opt ? String(opt.textContent || "").trim() : "";
            return label || String(formState?.methodCategoryId || "").trim() || "(none)";
        })();
    
        const methodName = (() => {
            const opt = methodSel?.selectedOptions?.[0];
            const label = opt ? String(opt.textContent || "").trim() : "";
            return label || String(formState?.methodId || "").trim() || "(none)";
        })();
    
        currentMethodSpan.textContent = `Method: ${methodCategoryName} / ${methodName}`; // CHANGED
    
        const dirtyLabel = taskDirty ? " • Dirty" : "";
        currentTemplateSourceSpan.textContent =
            `Source: ${prettySourceLabel(taskTemplateSource)}${dirtyLabel}`;
    }

    async function resolveTaskTemplate({ cell, plantId, varietyId = null, methodId }) {
        const raw = String(cell?.getAttribute?.("task_template_json") ?? "").trim();
        if (raw.length > 0) {
            try {
                const tpl = JSON.parse(raw);
                if (tpl && typeof tpl === "object") {
                    return { template: tpl, source: "cell" };
                }
            } catch (_) {
                console.warn("Invalid task_template_json");
            }
        }

        const vTpl = await TaskTemplateModel.loadVarietyTemplate(varietyId, methodId);
        if (vTpl) {
            return { template: vTpl, source: "variety" };
        }

        const pTpl = await TaskTemplateModel.loadPlantTemplate(plantId, methodId);
        if (pTpl) {
            return { template: pTpl, source: "plant" };
        }

        const methodTpl = await TaskTemplateModel.loadMethodBuiltinTemplate(methodId); // CHANGED
        if (methodTpl) {
            return { template: methodTpl, source: "method_builtin" };
        }

        return { template: null, source: "none" };
    }

    function prepAnchorForPlanningMode(planningMode) { // CHANGED
        return planningMode === "direct_sow" ? "SOW" : "TRANSPLANT"; // CHANGED
    } // CHANGED

    function taskRuleLibraryForPlanningMode(planningMode) {
        const prepAnchor = prepAnchorForPlanningMode(planningMode);

        return {
            prep: {
                id: "prep",
                title: "Prep bed – {plant}", // CHANGED
                startAnchorStage: prepAnchor, // CHANGED
                startOffsetDays: 3, // CHANGED
                startOffsetDirection: "before", // CHANGED
                endMode: "fixed_days", // CHANGED
                durationDays: 3,
                endAnchorStage: null, // CHANGED
                endAnchorOffsetDays: 0, // CHANGED
                endAnchorOffsetDirection: "after", // CHANGED
                repeatMode: "none", // CHANGED
                repeatEveryDays: 1, // CHANGED
                repeatUntilMode: "x_times", // CHANGED
                repeatTimes: 1, // CHANGED
                repeatUntilAnchorStage: "HARVEST_END", // CHANGED
                repeatCutoffOffsetDays: 0, // ADDED
                repeatCutoffOffsetDirection: "after" // ADDED
            },
            sow: {
                id: "sow",
                title: "Sow – {plant}", // CHANGED
                startAnchorStage: "SOW", // CHANGED
                startOffsetDays: 0, // CHANGED
                startOffsetDirection: "after", // CHANGED
                endMode: "fixed_days", // CHANGED
                durationDays: 7,
                endAnchorStage: null, // CHANGED
                endAnchorOffsetDays: 0, // CHANGED
                endAnchorOffsetDirection: "after", // CHANGED
                repeatMode: "none", // CHANGED
                repeatEveryDays: 1, // CHANGED
                repeatUntilMode: "x_times", // CHANGED
                repeatTimes: 1, // CHANGED
                repeatUntilAnchorStage: "HARVEST_END", // CHANGED
                repeatCutoffOffsetDays: 0, // ADDED
                repeatCutoffOffsetDirection: "after" // ADDED
            },
            start: {
                id: "start",
                title: "Start indoors – {plant}", // CHANGED
                startAnchorStage: "SOW", // CHANGED
                startOffsetDays: 0, // CHANGED
                startOffsetDirection: "after", // CHANGED
                endMode: "fixed_days", // CHANGED
                durationDays: 0,
                endAnchorStage: null, // CHANGED
                endAnchorOffsetDays: 0, // CHANGED
                endAnchorOffsetDirection: "after", // CHANGED
                repeatMode: "none", // CHANGED
                repeatEveryDays: 1, // CHANGED
                repeatUntilMode: "x_times", // CHANGED
                repeatTimes: 1, // CHANGED
                repeatUntilAnchorStage: "HARVEST_END", // CHANGED
                repeatCutoffOffsetDays: 0, // ADDED
                repeatCutoffOffsetDirection: "after" // ADDED
            },
            harden: {
                id: "harden",
                title: "Harden off – {plant}", // CHANGED
                startAnchorStage: "TRANSPLANT", // CHANGED
                startOffsetDays: 7, // CHANGED
                startOffsetDirection: "before", // CHANGED
                endMode: "fixed_days", // CHANGED
                durationDays: 7,
                endAnchorStage: null, // CHANGED
                endAnchorOffsetDays: 0, // CHANGED
                endAnchorOffsetDirection: "after", // CHANGED
                repeatMode: "none", // CHANGED
                repeatEveryDays: 1, // CHANGED
                repeatUntilMode: "x_times", // CHANGED
                repeatTimes: 1, // CHANGED
                repeatUntilAnchorStage: "HARVEST_END", // CHANGED
                repeatCutoffOffsetDays: 0, // ADDED
                repeatCutoffOffsetDirection: "after" // ADDED
            },
            transplant: {
                id: "transplant",
                title: "Transplant – {plant}", // CHANGED
                startAnchorStage: "TRANSPLANT", // CHANGED
                startOffsetDays: 0, // CHANGED
                startOffsetDirection: "after", // CHANGED
                endMode: "fixed_days", // CHANGED
                durationDays: 7,
                endAnchorStage: null, // CHANGED
                endAnchorOffsetDays: 0, // CHANGED
                endAnchorOffsetDirection: "after", // CHANGED
                repeatMode: "none", // CHANGED
                repeatEveryDays: 1, // CHANGED
                repeatUntilMode: "x_times", // CHANGED
                repeatTimes: 1, // CHANGED
                repeatUntilAnchorStage: "HARVEST_END", // CHANGED
                repeatCutoffOffsetDays: 0, // ADDED
                repeatCutoffOffsetDirection: "after" // ADDED
            },
            thin: {
                id: "thin",
                title: "Thin / check – {plant}", // CHANGED
                startAnchorStage: "GERM", // CHANGED
                startOffsetDays: 7, // CHANGED
                startOffsetDirection: "after", // CHANGED
                endMode: "fixed_days", // CHANGED
                durationDays: 7,
                endAnchorStage: null, // CHANGED
                endAnchorOffsetDays: 0, // CHANGED
                endAnchorOffsetDirection: "after", // CHANGED
                repeatMode: "none", // CHANGED
                repeatEveryDays: 1, // CHANGED
                repeatUntilMode: "x_times", // CHANGED
                repeatTimes: 1, // CHANGED
                repeatUntilAnchorStage: "HARVEST_END", // CHANGED
                repeatCutoffOffsetDays: 0, // ADDED
                repeatCutoffOffsetDirection: "after" // ADDED
            },
            harvest: {
                id: "harvest",
                title: "Harvest – {plant}", // CHANGED
                startAnchorStage: "HARVEST_START", // CHANGED
                startOffsetDays: 0, // CHANGED
                startOffsetDirection: "after", // CHANGED
                endMode: "anchor_range", // CHANGED
                durationDays: null, // CHANGED
                endAnchorStage: "HARVEST_END", // CHANGED
                endAnchorOffsetDays: 0, // CHANGED
                endAnchorOffsetDirection: "after", // CHANGED
                repeatMode: "none", // CHANGED
                repeatEveryDays: 1, // CHANGED
                repeatUntilMode: "x_times", // CHANGED
                repeatTimes: 1, // CHANGED
                repeatUntilAnchorStage: "HARVEST_END", // CHANGED
                repeatCutoffOffsetDays: 0, // ADDED
                repeatCutoffOffsetDirection: "after" // ADDED
            }
        };
    }

    function applyTaskOverrides(rule, override) {
        const base = normalizeTaskRule(rule); // CHANGED
        if (!override || typeof override !== "object") return { ...base }; // CHANGED
        return normalizeTaskRule({ ...base, ...override }); // CHANGED
    }

    // -------------------- Default template from method --------------------------

    async function getDefaultTaskTemplateForPlantingMethods(methodId) { // CHANGED
        if (!methodId) return null;
    
        const method = await getPlantingMethodById(methodId);
        if (!method) return null;
    
        const resolved = resolveMethodBehavior({ // CHANGED
            methodCategoryId: method.method_category_id, // CHANGED
            methodId: method.method_id // CHANGED
        }); // CHANGED
    
        const lib = taskRuleLibraryForPlanningMode(resolved.planningMode); // CHANGED

        const required = safeJsonParse(method.tasks_required_json, {}) || {};
        const orderedIds = ["prep", "sow", "start", "harden", "transplant", "thin", "harvest"];

        const rules = [];
        for (const id of orderedIds) {
            if (id === "harvest") {
                const override = (required.harvest && typeof required.harvest === "object")
                    ? required.harvest
                    : null;
                rules.push(applyTaskOverrides(lib.harvest, override));
                continue;
            }

            const req = required[id];
            if (!req) continue;
            if (!lib[id]) continue;

            const override = (req && typeof req === "object") ? req : null;
            rules.push(applyTaskOverrides(lib[id], override));
        }

        const allowedStages = await getAllowedAnchorStagesForMethod(methodId); // FIX: enforce method-specific built-in anchors
        const validRules = rules.flatMap((rule) => {
            try {
                return [validateTaskRule(rule, { allowedStages })];
            } catch (e) {
                console.warn("[TaskTemplate] Skipping unsupported built-in task rule", { // FIX: surface filtered method data
                    methodId: String(methodId),
                    ruleId: String(rule?.id || ""),
                    reason: e?.message || String(e)
                });
                return [];
            }
        });

        if (!validRules.length) return null;

        return normalizeTaskTemplate({ version: 2, rules: validRules }); // FIX: expose only rules valid for the method
    }




































































    function buildScheduleAttributePatch(inputs, result, options = {}) { // FIX: define the complete graph mutation before applying it
        const { plant, city } = inputs;
        const env = plant.cropTempEnvelope(); // FIX: persistence needs Tbase, not perennial GDD rates
        const perennial = result?.kind === 'perennial';
        const timeline = result?.timelines?.[0] || {};
        const sowDate = result?.schedule?.[0] || null;
        const budget = perennial ? null : plant.firstHarvestBudget();
        const fmt = d => d instanceof Date && !Number.isNaN(d.getTime()) ? fmtISO(d) : '';
        const yieldPerPlant = typeof plant.yieldPerPlant === 'function'
            ? plant.yieldPerPlant()
            : plant.yield_per_plant_kg;
        const numericYield = Number(yieldPerPlant);
        const patch = {
            season_start_year: String(inputs.seasonStartYear),
            days_maturity: perennial || budget?.mode !== 'days' ? '' : String(budget.amount),
            gdd_to_maturity: perennial || budget?.mode !== 'gdd' ? '' : String(budget.amount),
            lifespan_start: perennial ? String(result.lifespanStartISO || '') : '',
            lifespan_end: perennial ? String(result.lifespanEndISO || '') : '',
            variety_id: String(inputs.varietyId ?? ''),
            variety_name: String(inputs.varietyName || ''),
            start_cooling_threshold_c: String(finiteNumberOrNull(plant.start_cooling_threshold_c) ?? ''),
            label: plant.plant_name + ' group',
            plant_id: String(plant.plant_id),
            plant_name: String(plant.plant_name || ''),
            plant_abbr: String(plant.abbr || ''),
            city_id: city.city_id != null ? String(city.city_id) : '', // ADDED
            city_name: String(city.city_name || ''),
            method_category_id: normId(inputs.methodCategoryId),
            method_id: normId(inputs.methodId),
            sowing_season_id: perennial ? '' : String(options.sowingSeasonId || ''), // ADDED
            sowing_season_label: perennial ? '' : String(options.sowingSeasonLabel || ''), // ADDED
            sowing_window_id: null, // CHANGED: remove stale pre-rename scheduler metadata on resave.
            sowing_window_label: null, // CHANGED: remove stale pre-rename scheduler metadata on resave.
            tbase_c: String(env.Tbase),
            sow_date: fmt(sowDate),
            germ_date: perennial ? '' : fmt(timeline.germ),
            transplant_date: perennial ? '' : fmt(timeline.transplant),
            maturity_date: perennial ? '' : fmt(timeline.maturity),
            harvest_start: perennial ? '' : fmt(timeline.harvestStart),
            harvest_end: perennial ? '' : fmt(timeline.harvestEnd),
            plant_yield: String(Number.isFinite(numericYield) && numericYield > 0 ? numericYield : 0),
            yield_unit: 'kg'
        };

        if (options.taskTemplateJson !== undefined) {
            patch.task_template_json = String(options.taskTemplateJson ?? '');
        }

        const hasValue = value => value !== undefined && value !== null && value !== '';
        const spacingX = hasValue(plant.spacing_x_cm) ? plant.spacing_x_cm : plant.spacing_cm;
        const spacingY = hasValue(plant.spacing_y_cm) ? plant.spacing_y_cm : plant.spacing_cm;
        if (hasValue(spacingX)) patch.spacing_x_cm = String(spacingX);
        if (hasValue(spacingY)) patch.spacing_y_cm = String(spacingY);
        if (hasValue(plant.spacing_cm)) patch.spacing_cm = String(plant.spacing_cm);
        if (hasValue(plant.veg_diameter_cm)) patch.veg_diameter_cm = String(plant.veg_diameter_cm);

        return patch;
    }

    function snapshotCellAttributes(cell, keys) { // FIX: retain absent versus empty attribute state
        const value = cell?.value;
        const snapshot = {};
        for (const key of keys || []) {
            const present = typeof value?.hasAttribute === 'function'
                ? value.hasAttribute(key)
                : cell?.getAttribute?.(key) != null;
            snapshot[key] = {
                present,
                value: present ? String(cell?.getAttribute?.(key) ?? value?.getAttribute?.(key) ?? '') : null
            };
        }
        return snapshot;
    }

    function writeCellAttribute(cell, key, value, model = null) { // FIX: support true removal during rollback
        const node = cell?.value;
        if (!node) return;
        const nextValue = value == null ? null : String(value);
        if (model && typeof model.execute === 'function' && typeof mxCellAttributeChange === 'function') {
            model.execute(new mxCellAttributeChange(cell, key, nextValue));
            return;
        }
        if (nextValue == null) {
            if (typeof node.removeAttribute === 'function') node.removeAttribute(key);
        } else if (typeof node.setAttribute === 'function') {
            node.setAttribute(key, nextValue);
        }
    }

    function applyCellAttributePatch(cell, patch, model = null) { // FIX
        for (const [key, value] of Object.entries(patch || {})) {
            writeCellAttribute(cell, key, value, model);
        }
    }

    function restoreCellAttributeSnapshot(cell, snapshot, model = null) { // FIX
        for (const [key, prior] of Object.entries(snapshot || {})) {
            writeCellAttribute(cell, key, prior.present ? prior.value : null, model);
        }
    }

    async function runCompensatedSaveSteps({
        applyGraphPatch,
        persist,
        emitTasks,
        finalizeGraph,
        restoreGraphPatch
    }) { // FIX: centralize graph compensation for every required save step
        try {
            await applyGraphPatch();
            if (typeof persist === 'function') await persist();
            if (typeof emitTasks === 'function') await emitTasks();
            if (typeof finalizeGraph === 'function') await finalizeGraph();
        } catch (error) {
            try {
                await restoreGraphPatch();
            } catch (rollbackError) {
                console.error('[Scheduler] Graph attribute rollback failed', rollbackError);
            }
            throw error;
        }
    }


    async function applyScheduleToGraph(ui, cell, inputs, options = {}) {
        const { plant, city } = inputs;
        const method = normId(inputs.methodId); // FIX
    
        const result = options.result || computeScheduleResult(inputs);
        const schedule = result.schedule; // NEW
        const timelines = result.timelines; // NEW

        async function emitTasksForPlan({
            method,
            plant,
            cell,
            schedule,
            timelines,
            plantId = null,
            varietyId = null,
            varietyName = '', // ADDED
            methodCategoryId = null,
            methodId = null,
            taskTemplate = null // FIX
        }) {
            const tasks = await buildTasksForPlan({
                method,
                plant,
                cell,
                schedule,
                timelines,
                taskTemplate,
                plantId,
                varietyId,
                varietyName, // ADDED
                methodCategoryId,
                methodId
            });

            const detail = {
                mode: "replace", // FIX: make replacement semantics explicit
                tasks,
                plantName: plant.plant_name,
                varietyName: String(varietyName || ''), // ADDED
                targetGroupId: cell.id
            };

            if (typeof CustomEvent !== "function") {
                throw new Error("Cannot emit scheduled tasks: CustomEvent is unavailable."); // FIX: task emission is required for save success
            }
            if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") {
                throw new Error("Cannot emit scheduled tasks: window.dispatchEvent is unavailable."); // FIX: task emission is required for save success
            }

            window.dispatchEvent(new CustomEvent("tasksCreated", { detail })); // FIX: propagate dispatch failures to the save flow

            return tasks;
        }

        const graph = ui.editor.graph;
        const model = graph.getModel();
        const attributePatch = buildScheduleAttributePatch(inputs, result, options); // FIX
        const attributeSnapshot = snapshotCellAttributes(cell, Object.keys(attributePatch)); // FIX
        const extraAttributePatches = (options.extraAttributePatches || []).filter(spec => spec && spec.cell && spec.patch); // ADDED
        const extraAttributeSnapshots = extraAttributePatches.map(spec => ({ // ADDED
            cell: spec.cell, // ADDED
            snapshot: snapshotCellAttributes(spec.cell, Object.keys(spec.patch)) // ADDED
        })); // ADDED

        const applyGraphPatch = async () => {
            model.beginUpdate();
            try {
                applyCellAttributePatch(cell, attributePatch, model);
                extraAttributePatches.forEach(spec => applyCellAttributePatch(spec.cell, spec.patch, model)); // ADDED
            } finally {
                model.endUpdate();
            }
            graph.refresh(cell);
            extraAttributePatches.forEach(spec => graph.refresh(spec.cell)); // ADDED
        };

        const restoreGraphPatch = async () => {
            model.beginUpdate();
            try {
                restoreCellAttributeSnapshot(cell, attributeSnapshot, model);
                extraAttributeSnapshots.forEach(spec => restoreCellAttributeSnapshot(spec.cell, spec.snapshot, model)); // ADDED
            } finally {
                model.endUpdate();
            }
            graph.refresh(cell);
            extraAttributeSnapshots.forEach(spec => graph.refresh(spec.cell)); // ADDED
        };

        await runCompensatedSaveSteps({
            applyGraphPatch,
            persist: options.afterGraphUpdate,
            emitTasks: async () => emitTasksForPlan({ // FIX: task emission participates in rollback-protected save success
                method,
                plant,
                cell,
                schedule,
                timelines,
                plantId: Number(inputs?.plant?.plant_id ?? null),
                varietyId: inputs?.varietyId ?? null,
                varietyName: inputs?.varietyName ?? '', // ADDED
                methodCategoryId: normId(inputs?.methodCategoryId), // FIX
                methodId: normId(inputs?.methodId), // FIX
                taskTemplate: options.taskTemplate ?? null // FIX: do not reread task_template_json after mutation
            }),
            finalizeGraph: async () => {
                retileAndFitGroupIfAvailable(graph, cell, { source: 'schedule-save' }); // CHANGE
                graph.refresh(cell);
            },
            restoreGraphPatch
        });
    }

























































    // -------------------- Orchestrator: open schedule dialog --------------------------------
    async function openScheduleDialog(ui, cell) {
        // 1) Load reference data
        const plants = await PlantModel.listBasic();
        const cities = await CityClimate.loadAll();
        if (!cities.length) throw new Error('Cities not available');
        const graph = ui?.editor?.graph; // ADDED
        const model = graph && typeof graph.getModel === 'function' ? graph.getModel() : null; // ADDED
        const climateModelModuleCell = model ? findGardenModuleAncestor(model, cell) : null; // ADDED

        // 2) Selected plant: prefer the stable ID and retain name lookup for legacy cells
        const plantIdAttr = finiteNumberOrNull(cell && cell.getAttribute && cell.getAttribute('plant_id')); // FIX: read the stable persisted identity
        const plantNameAttr = cell && cell.getAttribute && cell.getAttribute('plant_name');
        let selectedPlant = null;
        if (plantIdAttr != null) {
            selectedPlant = await PlantModel.loadById(plantIdAttr); // FIX: plant renames no longer orphan saved schedules
        }
        if (!selectedPlant && plantNameAttr) {
            selectedPlant = await PlantModel.loadByName(plantNameAttr);
        }
        if (!selectedPlant) {
            if (plantIdAttr != null || plantNameAttr) {
                throw new Error(`Plant not found: ${plantIdAttr ?? plantNameAttr}`); // FIX: report the persisted identity that failed
            }
            if (!plants.length) throw new Error('No plants available');
            selectedPlant = plants[0];
        }

        // 3) Initial city & method
        const now = new Date();
        const currentYear = now.getUTCFullYear();
        const todayUTC = new Date(Date.UTC(currentYear, now.getUTCMonth(), now.getUTCDate()));
        const storedSowDate = parseISODateUTCValue(cell?.getAttribute?.('sow_date'));
        const storedHarvestEndDate = parseISODateUTCValue(cell?.getAttribute?.('harvest_end'));
        const storedSeasonYear = finiteNumberOrNull(cell?.getAttribute?.('season_start_year'));
        const scheduleBedContext = resolveScheduleBedContext(cell); // ADDED: resolve bed conditions once for scheduler soil modeling.
        const year = storedSeasonYear != null && storedSeasonYear >= 1900 && storedSeasonYear <= 3000
            ? Math.trunc(storedSeasonYear)
            : (storedSowDate ? storedSowDate.getUTCFullYear() : currentYear);
        const hasPersistedSchedule = storedSowDate != null; // FIX
        const groupCityId = finiteNumberOrNull(cell?.getAttribute?.('city_id')) ?? finiteNumberOrNull(climateModelModuleCell?.getAttribute?.('city_id')); // ADDED
        const groupCityName = (cell && cell.getAttribute && cell.getAttribute('city_name')) || climateModelModuleCell?.getAttribute?.('city_name') || null; // CHANGED
        const idMatch = cities.find(city => groupCityId != null && Number(city.city_id) === Number(groupCityId)); // ADDED
        const nameMatches = groupCityName ? cities.filter(city => String(city.city_name || '') === String(groupCityName)) : []; // ADDED
        if (!idMatch && groupCityName && nameMatches.length > 1) throw new Error(`City name is ambiguous; select a city in Garden Settings: ${groupCityName}`); // ADDED
        const initialCityRow = idMatch // CHANGED
            || (nameMatches.length === 1 ? nameMatches[0] : null) // CHANGED: old city_name backfill is safe only when the name is unique.
            || cities[0]; // ADDED
        const initialCityId = finiteNumberOrNull(initialCityRow?.city_id); // ADDED
        const initialCityName = initialCityRow?.city_name || groupCityName || (cities[0].city_name || cities[0]); // CHANGED

        const initialMethodSelection = await resolveInitialMethodSelection(cell, selectedPlant);
        const initialMethodCategoryId = initialMethodSelection.methodCategoryId;
        const initialMethodId = initialMethodSelection.methodId;
        const initialResolvedBehavior = initialMethodSelection.resolvedBehavior;

        const cityInit = await CityClimate.resolveUniqueNameFallback({ cityId: initialCityId, cityName: initialCityName }); // CHANGED
        if (!cityInit) throw new Error(`City not found: ${initialCityName}`);
        if (model && cell && cityInit.city_id != null) { // ADDED
            model.beginUpdate(); // ADDED
            try { // ADDED
                setAttr(cell, 'city_id', String(cityInit.city_id)); // ADDED
                setAttr(cell, 'city_name', String(cityInit.city_name || initialCityName)); // ADDED
            } finally { // ADDED
                model.endUpdate(); // ADDED
            } // ADDED
        } // ADDED
        const initialClimateResolution = resolveClimateModelPolicy(climateModelModuleCell, initialCityName, selectedPlant.plant_id, null); // ADDED
        const initialClimatePolicy = initialClimateResolution.effective; // ADDED

        const selectedIsPerennial = isPerennialPlant(selectedPlant); // FIX
        const perennialLifespanYears = selectedIsPerennial
            ? requirePerennialLifespanYears(selectedPlant)
            : null; // FIX
        const budget = selectedIsPerennial ? null : selectedPlant.firstHarvestBudget(); // FIX

        // --- compute initial auto anchors safely ---
        const overwinterAllowed0 = isCrossYearCrop(selectedPlant); // FIX: biennials may harvest in a later year
        const scanStart = asUTCDate(year, 1, 1);
        const scanEndHard = asUTCDate(year + getPlantScanYears(selectedPlant) - 1, 12, 31); // FIX: use lifecycle-aware scan bounds


        const HW_DAYS = resolveHarvestWindowDays(null, selectedPlant); // FIX: use the canonical fallback

        let initialWindowFeasible = selectedIsPerennial; // FIX
        let earliestFeasibleSowDate = selectedIsPerennial
            ? new Date(storedSowDate || scanStart)
            : null; // FIX
        let climateEndDate = selectedIsPerennial
            ? parseISODateUTCValue(computePerennialLifespanEndISO(
                fmtISO(storedSowDate || scanStart),
                year,
                perennialLifespanYears
            ))
            : null; // FIX
        let latestHarvestEndDate = selectedIsPerennial ? climateEndDate : null; // CHANGED
        let selectedHarvestEndDate = selectedIsPerennial ? climateEndDate : null; // ADDED
        let initialDailyClimate = null; // ADDED

        if (!selectedIsPerennial && Number.isFinite(HW_DAYS)) { // FIX
            const env = selectedPlant.cropTempEnvelope(); // FIX: annual-only maturity inputs
            const dailyClimate = await cityInit.loadDailyClimateModel({ scanStart, scanEndHard, climatePolicy: initialClimatePolicy }); // CHANGED
            initialDailyClimate = dailyClimate; // ADDED
            const dailyRates = cityInit.dailyRates(env.Tbase, year, initialClimatePolicy); // CHANGED
            const monthlyAvgTemp = cityInit.monthlyMeans(); // CHANGED: physical temperatures stay unshifted; GDD scaling is in daily climate rates.
            const initialWindow = annualCore.computeAnnualSowingSeasons({ // CHANGED
                methodCategoryId: initialMethodCategoryId,
                methodId: initialMethodId,
                budget: budget,
                HW_DAYS: HW_DAYS,
                dailyRatesMap: dailyRates,
                monthlyAvgTemp: monthlyAvgTemp,
                dailyClimate: dailyClimate, // ADDED
                Tbase: env.Tbase,
                cropTemp: env,
                scanStart,
                scanEndHard,
                soilGateThresholdC: finiteNumberOrNull(selectedPlant.soil_temp_min_plant_c),
                soilGateConsecutiveDays: initialClimatePolicy.soilGateConsecutiveDays, // CHANGED
                startCoolingThresholdC: asCoolingThresholdC(selectedPlant.start_cooling_threshold_c),
                useSpringFrostGate: true, // FIX: keep spring frost checks for overwinter-capable plants
                lastSpringFrostDOY: pickFrostByRisk(cityInit, initialClimatePolicy.springFrostRisk), // CHANGED
                daysTransplant: Number.isFinite(Number(selectedPlant.days_transplant))
                    ? Number(selectedPlant.days_transplant)
                    : 0,
                overwinterAllowed: overwinterAllowed0,
                plantMetadata: selectedPlant, // ADDED
                cityLatitudeDeg: finiteNumberOrNull(cityInit.latitude ?? cityInit.lat), // CHANGED
                bedProfile: scheduleBedContext.profile, // ADDED
                bedProfileSource: scheduleBedContext.source // ADDED
            });

            initialWindowFeasible = initialWindow.feasible === true; // FIX
            earliestFeasibleSowDate = initialWindow.seasons?.[0]?.startDate || initialWindow.earliestFeasibleSowDate; // CHANGED
            climateEndDate = initialWindow.climateEndDate; // FIX
            latestHarvestEndDate = initialWindow.climateEndDate; // FIX: initialize the annual latest-harvest display from the feasible window
            selectedHarvestEndDate = initialWindow.climateEndDate; // ADDED
        }

        // no stray reassignments like: earliestFeasibleSowDate = a; selectedHarvestEndDate = b;  <-- remove these

        let previewStart = storedSowDate || earliestFeasibleSowDate;
        if (!selectedIsPerennial && storedHarvestEndDate) {
            selectedHarvestEndDate = storedHarvestEndDate; // CHANGED
        }
        let startNote = initialWindowFeasible || selectedIsPerennial ? '' : 'No feasible window.'; // FIX

        // If we have a finite harvest window, we can run feasibility tweaks.
        // (For perennials / null HW_DAYS we skip this step but still open the dialog.)
        if (!selectedIsPerennial && initialWindowFeasible && Number.isFinite(HW_DAYS) && !hasPersistedSchedule) { // FIX
            const inputs0 = new sharedCore.ScheduleInputs({ // CHANGED
                plant: selectedPlant,
                city: cityInit,
                planningMode: initialResolvedBehavior.planningMode,
                methodCategoryId: initialMethodCategoryId,
                methodId: initialMethodId,
                startISO: earliestFeasibleSowDate.toISOString().slice(0, 10),
                seasonEndISO: fmtISO(scanEndHard), // FIX: initial annual feasibility checks use lifecycle end, not latest harvest display.
                policy: PolicyFlags.fromResolvedBehavior(selectedPlant, initialResolvedBehavior, initialClimatePolicy), // CHANGED
                seasonStartYear: year,
                harvestWindowDays: HW_DAYS,
                bedProfile: scheduleBedContext.profile, // ADDED
                bedProfileSource: scheduleBedContext.source, // ADDED
                dailyClimate: initialDailyClimate // ADDED
            });

            const planner0 = new annualCore.Planner(inputs0); // CHANGED
            const feasToday = planner0.isSowFeasible(todayUTC);
            const feasStart = planner0.isSowFeasible(previewStart);

            if (dateLTE(previewStart, addDaysUTC(todayUTC, -1))) {
                if (feasToday.ok) {
                    startNote = `Start date was before today; set to today (${todayUTC.toISOString().slice(0, 10)}).`;
                    previewStart = todayUTC;
                } else {
                    const nxt = planner0.findNextFeasible(todayUTC, 366);
                    if (nxt.date) {
                        startNote = `Start date was before today; advanced to next valid date (${nxt.date.toISOString().slice(0, 10)}).`;
                        previewStart = nxt.date;
                    } else {
                        startNote = `No valid start date remains this season.`;
                    }
                }
            }
        }

        // Always open the dialog (even when HW_DAYS is null/perennial)
        await buildScheduleDialog(ui, cell, plants, cities, async (_form) => { /* handled inside builder */ }, {
            selectedPlant,
            earliestFeasibleSowDate: previewStart,
            lastHarvestDate: selectedHarvestEndDate, // CHANGED: retained for older builder call sites.
            latestHarvestEndDate, // ADDED
            selectedHarvestEndDate, // ADDED
            startNote,
            initialCityId, // ADDED
            initialCityName,
            hasPersistedSchedule,
            initialWindowFeasible,
            bedProfile: scheduleBedContext.profile, // ADDED
            bedProfileSource: scheduleBedContext.source, // ADDED
            dailyClimate: initialDailyClimate, // CHANGED
            dailyClimateKey: initialDailyClimate ? `${cityInit.city_name || initialCityName}|${fmtISO(scanStart)}|${fmtISO(scanEndHard)}|${JSON.stringify(initialClimatePolicy)}` : '' // CHANGED
        });
    }



















































    const USL_DEBUG_HARVEST_WINDOWS = true;

    // -------------------- Public API --------------------------------------------------------
    async function listPlantOptions() { // NEW
        const plants = await PlantModel.listBasic(); // NEW
        return plants.map(function (plant) { // NEW
            return { // NEW
                id: String(plant.plant_id), // NEW
                name: String(plant.plant_name || plant.abbr || plant.plant_id), // NEW
                abbr: String(plant.abbr || ""), // NEW
                annual: Number(plant.annual || 0), // NEW
                biennial: Number(plant.biennial || 0), // NEW
                perennial: Number(plant.perennial || 0) // NEW
            }; // NEW
        }); // NEW
    } // NEW

    window.USL = window.USL || {};
    window.USL.scheduler = Object.assign({}, window.USL.scheduler, {
        openScheduleDialog: (ui, cell) => openScheduleDialog(ui, cell),
        openSetPlantDialog: (ui, cell) => openSetPlantDialog(ui, cell), // CHANGE
        listPlantOptions: listPlantOptions // NEW
    });
    window.openUSLScheduleDialog = window.USL.scheduler.openScheduleDialog;

    async function openSetPlantDialog(ui, cell) { // ADDED
        if (!ui || !ui.editor || !ui.editor.graph) throw new Error('Draw.io UI is unavailable.'); // ADDED
        if (!isTilerGroup(cell)) throw new Error('Set Plant requires a tiler group.'); // ADDED

        const graph = ui.editor.graph; // ADDED
        const model = graph.getModel(); // ADDED
        const allPlants = await PlantModel.listBasic(); // ADDED
        if (!allPlants.length) { mxUtils.alert('No plants found in database.'); return; } // ADDED

        const div = document.createElement('div'); // ADDED
        div.style.padding = '12px'; // ADDED
        div.style.width = '420px'; // ADDED
        const title = document.createElement('div'); // ADDED
        title.textContent = 'Select Plant'; // ADDED
        title.style.fontWeight = '600'; // ADDED
        title.style.marginBottom = '8px'; // ADDED
        div.appendChild(title); // ADDED

        const sel = document.createElement('select'); // ADDED
        sel.style.width = '100%'; // ADDED
        sel.style.padding = '6px'; // ADDED
        sel.style.margin = '8px 0'; // ADDED
        allPlants.forEach(p => { // ADDED
            const opt = document.createElement('option'); // ADDED
            opt.value = String(p.plant_id); // ADDED
            opt.textContent = p.plant_name + (p.abbr ? ` (${p.abbr})` : ''); // ADDED
            sel.appendChild(opt); // ADDED
        }); // ADDED
        div.appendChild(sel); // ADDED

        const btns = document.createElement('div'); // ADDED
        btns.style.display = 'flex'; // ADDED
        btns.style.justifyContent = 'flex-end'; // ADDED
        btns.style.gap = '8px'; // ADDED

        const ok = mxUtils.button('OK', async () => { // ADDED
            const id = Number(sel.value); // ADDED
            const row = await PlantModel.loadById(id); // ADDED
            if (!row) { mxUtils.alert('Plant not found.'); return; } // ADDED
            ui.hideDialog(); // ADDED

            model.beginUpdate(); // ADDED
            try { // ADDED
                const gardenParent = findGardenModuleAncestor(model, cell); // ADDED
                if (gardenParent) { // ADDED
                    const inheritedCityId = gardenParent.getAttribute('city_id'); // ADDED
                    const inheritedCity = gardenParent.getAttribute('city_name'); // ADDED
                    if (inheritedCityId) setAttr(cell, 'city_id', inheritedCityId); // ADDED
                    if (inheritedCity) setAttr(cell, 'city_name', inheritedCity); // ADDED
                } // ADDED

                setAttr(cell, 'plant_id', String(row.plant_id)); // ADDED
                setAttr(cell, 'plant_name', row.plant_name); // ADDED
                if (row.abbr) setAttr(cell, 'plant_abbr', row.abbr); // ADDED
                setAttr(cell, 'plant_locked', '1'); // ADDED
                setAttr(cell, 'label', row.plant_name + ' group'); // ADDED

                applyPlantSpacingToGroup(cell, row); // ADDED

                retileAndFitGroupIfAvailable(graph, cell, { source: 'set-plant', inTransaction: true }); // CHANGE
                graph.refresh(cell); // ADDED
            } finally { // ADDED
                model.endUpdate(); // ADDED
            } // ADDED
        }); // ADDED
        const cancel = mxUtils.button('Cancel', () => ui.hideDialog()); // ADDED
        btns.appendChild(ok); // ADDED
        btns.appendChild(cancel); // ADDED
        div.appendChild(btns); // ADDED
        ui.showDialog(div, 440, 220, true, true); // ADDED
    } // ADDED

    if (window.USL_SCHEDULER_TESTING) {
        bindRequiredSchedulerCores(); // CHANGED
        window.USL.scheduler.__test = {
            PlantModel,
            TaskTemplateModel,
            CityClimate,
            PolicyFlags,
            ScheduleInputs: sharedCore.ScheduleInputs, // CHANGED
            Planner: annualCore.Planner, // CHANGED
            computeAutoStartEndWindowForward: annualCore.computeAutoStartEndWindowForward, // CHANGED
            computeAnnualSowingSeasons: annualCore.computeAnnualSowingSeasons, // ADDED
            getPlantScanYears,
            isCrossYearCrop, // FIX: expose lifecycle behavior to the opt-in regression harness
            resolveHarvestWindowDays, // FIX: expose fallback behavior to the opt-in regression harness
            computeStageDatesForPlanting: annualCore.computeStageDatesForPlanting, // CHANGED: expose canonical annual core behavior.
            buildLifecycleTimelineViewModel, // ADDED
            buildLifecycleTimelineAxisMarkers, // ADDED
            findFirstLifecycleTimelineTaskRule, // ADDED
            normId, // FIX
            resolveStartAfterWindow // FIX
        }; // FIX: expose pure planner internals only when the regression harness opts in
    }

    // -------------------- Plugin entry: add popup menu item --------------------------------
    function installSchedulerPlugin(ui) { // FIX: install from the existing outer plugin registration
        const graph = ui.editor.graph;

        // Schedule entry is now rendered by Vertex_Linking_Standalone.js so it can live inside the linked-task overlay. // CHANGED

        // --- Harvest window bridge (installed once) ---
        if (!graph.__uslHarvestWindowsBridgeInstalled) {
            graph.__uslHarvestWindowsBridgeInstalled = true;
            console.log('[USL][Scheduler] harvest windows bridge installed'); // debug

            window.addEventListener("usl:harvestWindowsNeeded", async (ev) => {
                console.log("[Scheduler] suggest fn head:", String(suggestHarvestWindowForCropReq).slice(0, 120));
                console.log("[Scheduler] normalize in listener scope:", typeof normalizeUtcMidnight);

                const d = ev?.detail;
                if (!d) return;

                const moduleCellId = String(d.moduleCellId || "").trim();
                const year = Number(d.year);
                const crops = Array.isArray(d.crops) ? d.crops : [];
                if (!moduleCellId || !Number.isFinite(year) || year < 1900 || year > 3000) return;
                if (!crops.length) return;

                const moduleCell = graph.getModel().getCell(moduleCellId);
                if (!moduleCell) return;

                const cityId = finiteNumberOrNull(moduleCell.getAttribute?.("city_id")); // ADDED
                const cityName = String(moduleCell.getAttribute?.("city_name") || "").trim();
                if (cityId == null && !cityName) {
                    emitHarvestWindowsSuggested(moduleCellId, year, crops.map(c => ({
                        cropId: c.cropId, harvestStart: null, harvestEnd: null, shelfLifeDays: null,
                        reason: "Module city_id/city_name not set" // CHANGED
                    })));
                    return;
                }

                const results = [];
                for (const req of crops) {
                    results.push(await suggestHarvestWindowForCropReq(req, { cityId, cityName }, year, moduleCell)); // CHANGED
                }
                emitHarvestWindowsSuggested(moduleCellId, year, results);
            });
        }

        function emitHarvestWindowsSuggested(moduleCellId, year, results) {
            if (USL_DEBUG_HARVEST_WINDOWS) {
                console.groupCollapsed('[USL][Scheduler] emit usl:harvestWindowsSuggested');
                console.log('moduleCellId:', moduleCellId);
                console.log('year:', year);
                console.log('results:', JSON.parse(JSON.stringify(results)));
                console.groupEnd();
            }

            try {
                window.dispatchEvent(new CustomEvent("usl:harvestWindowsSuggested", {
                    detail: { moduleCellId, year, results }
                }));
            } catch (e) {
                console.error('[USL][Scheduler] Failed to dispatch usl:harvestWindowsSuggested', e);
            }
        }

        console.log("[Scheduler] defining normalizeUtcMidnight now");

        function normalizeUtcMidnight(d) {
            return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
        }

        function toYmdUTC(d) {
            if (!d) return null;
            return normalizeUtcMidnight(d).toISOString().slice(0, 10);
        }

        function findPrevFeasible(planner, endCandidate, maxDays) {
            let d = normalizeUtcMidnight(endCandidate);
            const C = planner.ctx;

            if (d > C.scanEndHard) d = normalizeUtcMidnight(C.scanEndHard);
            if (d < C.scanStart) return { date: null, info: null };

            for (let i = 0; i <= maxDays && d >= C.scanStart; i++) {
                const info = planner.isSowFeasible(d);
                if (info.ok) return { date: d, info };
                d = planner.addDays(d, -1);
            }
            return { date: null, info: null };
        }

        async function suggestHarvestWindowForCropReq(req, cityRef, year, moduleCell = null) { // CHANGED
            const cropId = String(req?.cropId || "");
            const plantId = (req?.plantId != null) ? Number(req.plantId) : NaN;
            const varietyId = (req?.varietyId != null && req.varietyId !== "") ? Number(req.varietyId) : null;

            if (!cropId || !Number.isFinite(plantId)) {
                return { cropId, harvestStart: null, harvestEnd: null, shelfLifeDays: null, reason: "Missing cropId/plantId" };
            }

            try {
                const plant = await resolveEffectivePlant(plantId, varietyId);
                if (!plant) return { cropId, harvestStart: null, harvestEnd: null, shelfLifeDays: null, reason: "Plant not found" };
                if (isPerennialPlant(plant)) { // FIX: harvest suggestions require an explicit maturity model
                    requirePerennialLifespanYears(plant);
                    return {
                        cropId,
                        harvestStart: null,
                        harvestEnd: null,
                        shelfLifeDays: null,
                        reason: "Perennial harvest timing requires maturity data"
                    };
                }

                const city = await CityClimate.resolve(cityRef || {}); // CHANGED
                if (!city) return { cropId, harvestStart: null, harvestEnd: null, shelfLifeDays: null, reason: "City not found" };
                const cityName = String(city.city_name || cityRef?.cityName || ""); // ADDED

                const methodId = normId(req?.methodId); // FIX
                const methodCategoryId = normId(req?.methodCategoryId); // FIX
                
                const resolvedBehavior = resolveMethodBehavior({
                    methodCategoryId,
                    methodId
                });
                
                const planningMode = resolvedBehavior.planningMode;
                const climateResolution = resolveClimateModelPolicy(moduleCell, cityName, plantId, null); // ADDED
                const policy = PolicyFlags.fromResolvedBehavior(plant, resolvedBehavior, climateResolution.effective); // CHANGED

                const hw = resolveHarvestWindowDays(req?.harvestWindowDays, plant); // FIX: share the scheduler's 7-day fallback
                const scanStart = asUTCDate(year, 1, 1); // ADDED
                const scanEndHard = asUTCDate(year + getPlantScanYears(plant) - 1, 12, 31); // ADDED
                const dailyClimate = await city.loadDailyClimateModel({ scanStart, scanEndHard, climatePolicy: climateResolution.effective }); // CHANGED

                const inputs = new sharedCore.ScheduleInputs({ // CHANGED
                    plant,
                    city,
                    planningMode,
                    methodCategoryId: resolvedBehavior.methodCategoryId, // FIX: preserve the resolved method context
                    methodId: resolvedBehavior.methodId, // FIX: preserve the resolved method context
                    startISO: `${year}-01-01`,
                    seasonEndISO: `${year + getPlantScanYears(plant) - 1}-12-31`, // FIX: allow overwinter and multi-year harvests
                    policy,
                    seasonStartYear: year,
                    harvestWindowDays: hw, // CHANGED
                    varietyId,
                    varietyName: "",
                    dailyClimate // ADDED
                });

                const planner = new annualCore.Planner(inputs); // CHANGED
                const C = planner.ctx;

                const maxSpanDays = Math.ceil((C.scanEndHard.getTime() - C.scanStart.getTime()) / 86400000) + 2;

                const first = planner.findNextFeasible(C.scanStart, maxSpanDays);
                if (!first?.date || !first?.info?.ok) {
                    return { cropId, harvestStart: null, harvestEnd: null, shelfLifeDays: null, reason: "No feasible sow date found in scan window" };
                }

                const last = findPrevFeasible(planner, C.scanEndHard, maxSpanDays);

                const shelfLifeDays =
                    Number.isFinite(Number(plant.shelf_life_days)) ? Number(plant.shelf_life_days) : null; // CHANGED

                // We approximate crop harvest window as:
                // earliest harvest start from earliest feasible sow,
                // latest harvest end from latest feasible sow. // CHANGED
                if (!last?.date || !last?.info?.ok) {
                    return {
                        cropId,
                        harvestStart: toYmdUTC(first.info.harvestStart),
                        harvestEnd: toYmdUTC(first.info.harvestEnd),
                        shelfLifeDays, // CHANGED
                        reason: "No late-season feasible sow date found"
                    };
                }

                // ordering sanity
                if (last.info.harvestEnd < first.info.harvestStart) {
                    return {
                        cropId,
                        harvestStart: toYmdUTC(first.info.harvestStart),
                        harvestEnd: toYmdUTC(first.info.harvestEnd),
                        shelfLifeDays,
                        reason: "Late harvest end < early harvest start (constraints)"
                    };
                }

                return {
                    cropId,
                    harvestStart: toYmdUTC(first.info.harvestStart),
                    harvestEnd: toYmdUTC(last.info.harvestEnd),
                    shelfLifeDays
                };
            } catch (e) {
                return { cropId, harvestStart: null, harvestEnd: null, shelfLifeDays: null, reason: String(e?.message || e) };
            }
        }




































    }

    function installDisabledSchedulerApi(coreError) { // ADDED
        const message = 'Garden Scheduler core modules failed to load: ' + (coreError?.message || String(coreError || 'unknown error')); // ADDED
        function showDisabledMessage(uiArg) { // ADDED
            if (uiArg && typeof uiArg.showError === 'function') { // ADDED
                uiArg.showError('Garden Scheduler unavailable', message); // ADDED
                return; // ADDED
            } // ADDED
            if (typeof mxUtils !== 'undefined' && typeof mxUtils.alert === 'function') { // ADDED
                mxUtils.alert(message); // ADDED
                return; // ADDED
            } // ADDED
            console.error('[Garden Scheduler]', message); // ADDED
        } // ADDED
        window.USL = window.USL || {}; // ADDED
        window.USL.scheduler = Object.assign({}, window.USL.scheduler, { // ADDED
            loadError: message, // ADDED
            openScheduleDialog: function (uiArg) { showDisabledMessage(uiArg); }, // ADDED
            openSetPlantDialog: function (uiArg) { showDisabledMessage(uiArg); }, // ADDED
            listPlantOptions: async function () { throw new Error(message); } // ADDED
        }); // ADDED
        window.openUSLScheduleDialog = window.USL.scheduler.openScheduleDialog; // ADDED
    } // ADDED

    function installSchedulerPluginAfterCoreLoad(ui) { // ADDED
        const loader = window.USL && window.USL.scheduler && window.USL.scheduler.__coreLoader; // ADDED
        if (!loader || typeof loader.whenReady !== 'function') { // ADDED
            installDisabledSchedulerApi(new Error('Garden scheduler core loader is unavailable.')); // ADDED
            return; // ADDED
        } // ADDED
        loader.whenReady(function (coreError) { // ADDED
            if (coreError) { // ADDED
                installDisabledSchedulerApi(coreError); // ADDED
                return; // ADDED
            } // ADDED
            try { // ADDED
                if (typeof loader.validate === 'function') loader.validate(); // ADDED
                bindRequiredSchedulerCores(); // CHANGED
                installSchedulerPlugin(ui); // ADDED
            } catch (e) { // ADDED
                installDisabledSchedulerApi(e); // ADDED
            } // ADDED
        }); // ADDED
    } // ADDED

    if (typeof window !== 'undefined' && window.__TRELLIS_PLANTING_SCHEDULER_TEST__) { // FIX: opt-in test surface only
        bindRequiredSchedulerCores(); // CHANGED
        window.__TRELLIS_PLANTING_SCHEDULER_TEST_HOOKS__ = {
            PlantModel,
            CityClimate,
            PolicyFlags,
            ScheduleInputs: sharedCore.ScheduleInputs, // CHANGED
            Planner: annualCore.Planner, // CHANGED
            applyPlantOverrides,
            computeScheduleResult,
            computeStageDatesForPlanting: annualCore.computeStageDatesForPlanting, // CHANGED
            computePerennialLifespanEndISO,
            firstCoolingCrossingDate: annualCore.firstCoolingCrossingDate, // CHANGED
            getPlantScanYears,
            resolveHarvestWindowDays,
            resolveInitialMethodSelection,
            resolveMethodBehavior,
            resolveValidMethodRecord,
            TaskTemplateModel, // ADDED
            resolveTaskTemplate,
            runUiAsyncOperation,
            computeAutoStartEndWindowForward: annualCore.computeAutoStartEndWindowForward, // CHANGED
            computeAnnualSowingSeasons: annualCore.computeAnnualSowingSeasons, // ADDED
            evaluateSowDateDiagnostics: annualCore.evaluateSowDateDiagnostics, // ADDED
            computeScheduleQualityDiagnosticRanges: annualCore.computeScheduleQualityDiagnosticRanges, // ADDED
            computeScheduleQualityDiagnosticRangesForInputs: annualCore.computeScheduleQualityDiagnosticRangesForInputs, // ADDED
            compressScheduleQualityDiagnosticRanges: annualCore.compressScheduleQualityDiagnosticRanges, // ADDED
            diagnosticLabel: annualCore.diagnosticLabel, // ADDED
            normId,
            monthlyMeanOnDate, // ADDED
            normalizeBedProfile, // ADDED
            estimateSoilTempC, // ADDED
            firstSoilReadyDate, // ADDED
            annualGddFromMonthlyMeans, // ADDED
            solveGddTemperatureOffset, // ADDED
            explainFeasibilityOverSeason, // ADDED
            compressFeasibilityScanRanges, // ADDED
            formatFeasibilityScanRanges, // ADDED
            buildFeasibilityBlockingSummary, // ADDED
            buildFeasibilityDiagnostics, // ADDED
            normalizeSowingSeasons, // ADDED
            ORPHAN_SOWING_SEASON_ID, // ADDED
            formatSowingSeasonsSummary, // ADDED
            formatScheduleQualityDiagnosticRanges, // ADDED
            buildSowingSeasonSelectorState, // ADDED
            pickDefaultSowingSeasonId, // ADDED
            defaultStartForActiveSowingSeason, // ADDED
            findSowingSeasonForDate, // ADDED
            resolveStartForSowingSeasonSwitch, // ADDED
            encodeMethodSelection, // ADDED
            decodeMethodSelection, // ADDED
            humanFeasibilityReason, // ADDED
            classifySelectedSowDate, // ADDED
            requireFeasibleSowingSeasonSelection, // ADDED
            requireNoBlockingScheduleQualityDiagnostics, // ADDED
            describeBlockingScheduleQualityDiagnostics, // ADDED
            normalizeLatitudeDeg, // ADDED
            saveSchedulerCityLatitude, // ADDED
            buildScheduleViewState, // ADDED
            buildLifecycleTimelineViewModel, // ADDED
            buildLifecycleTimelineAxisMarkers, // ADDED
            findFirstLifecycleTimelineTaskRule, // ADDED
            taskRuleLibraryForPlanningMode, // ADDED
            resolveTaskRuleTaskTypeId, // NEW
            normalizeTaskRule, // ADDED
            validateTaskRule, // ADDED
            validateTaskRuleAnchorOrder, // ADDED
            describeTaskRule, // ADDED
            buildTasksForPlan, // ADDED
            findRepeatCutoffOmittedRuleKeys, // ADDED
            filterPreviewTasks, // ADDED
            getTaskPreviewRuleKey, // ADDED
            buildTaskRuleDisplayOrder, // ADDED
            groupPreviewTasksByRule, // ADDED
            resolveTaskPreviewScheduleRange, // ADDED
            resolveTaskPreviewDisplayRange, // NEW
            resolveStartAfterWindow,
            buildScheduleAttributePatch,
            snapshotCellAttributes,
            applyCellAttributePatch,
            restoreCellAttributeSnapshot,
            runCompensatedSaveSteps,
            sharedCore, // CHANGED
            annualCore, // CHANGED
            perennialCore // CHANGED
        };
        return; // FIX: tests do not install Draw.io menus
    }

    installSchedulerPluginAfterCoreLoad(ui); // CHANGED

})
