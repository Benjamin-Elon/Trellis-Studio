// USL Draw.io Plugin: Plant Scheduling (GDD-based, class-refactor)
//
// - Schedule entry is rendered by Vertex_Linking_Standalone.js
// - Fetches plant/city from SQLite via window.dbBridge
// - Computes schedule, plants, timelines, and writes attrs
//
// Key changes in this version:
//  * Class-based encapsulation: PlantModel, CityClimate, PolicyFlags, ScheduleInputs
//  * Overwinter-aware feasibility & scanning
//  * Yield multipliers computed over HARVEST window
//  * UI keeps the same behavior (manual/auto dates, minimum yield filter, preview)
//
// ---------------------------------------------------------------------------------------------

Draw.loadPlugin(function (ui) {
    const graph = ui.editor && ui.editor.graph;
    if (!graph) return;

    console.log("[Scheduler] file instance:", "Planting_Scheduler.js", "STAMP=2026-01-25Txx:yy");

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

    function normId(value) { // FIX: canonicalize method and category identifiers at every boundary
        return String(value ?? '').trim().toLowerCase();
    }

    function resolveStartAfterWindow({
        currentStartISO,
        autoStartISO,
        feasible,
        forceWriteStart,
        hasPersistedSchedule,
        userEditedStartThisSession
    }) { // FIX: keep persisted and session-edited dates distinct from generated defaults
        const preserveGenuineStart = !!hasPersistedSchedule || !!userEditedStartThisSession;
        if (feasible && (forceWriteStart || !preserveGenuineStart)) return String(autoStartISO || '');
        if (!feasible && !preserveGenuineStart) return '';
        return String(currentStartISO || '');
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
            return asCoolingThresholdC(this.start_cooling_threshold_c);
        }
        hasCoolingTrigger() {
            return asCoolingThresholdC(this.start_cooling_threshold_c) != null;
        }


        static async loadByName(name) {
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
            const sql = `
          SELECT plant_id, plant_name, abbr, yield_per_plant_kg, gdd_to_maturity, 
                 tmin_c, topt_low_c, topt_high_c, tmax_c, tbase_c,
                 harvest_window_days, days_maturity, days_transplant, days_germ,
                 direct_sow, transplant, default_planting_method_category, default_planting_method, overwinter_ok, start_cooling_threshold_c,
                 soil_temp_min_plant_c, annual, biennial, perennial, lifespan_years, veg_diameter_cm, spacing_cm                                                                  
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
            const mcid = normId(methodCategoryId);
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
            const seen = new Set();
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
            const normalizedMethodId = normId(methodId);
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
            } : null;
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
            const existingId = finiteNumberOrNull(plantId); // FIX: distinguish insert from update without another connection
            const ids = Array.from(new Set((methodCategoryIds || [])
                .map(normId)
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
            const sql = `
                CREATE TABLE IF NOT EXISTS PlantTaskTemplates (
                  plant_id      INTEGER NOT NULL,
                  method_id     TEXT    NOT NULL,
                  template_json TEXT    NOT NULL,
                  updated_at    TEXT    NOT NULL,
                  PRIMARY KEY (plant_id, method_id)
                );`;
            await execAll(sql, []);
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
            const normalizedMethodId = normId(methodId);
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

        static async savePlantTemplate(plantId, methodId, template) {
            await this.ensureTables();
            const normalizedMethodId = normId(methodId);
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
            await execAll(sql, [Number(plantId), normId(methodId)]);
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
            const sql = `SELECT * FROM Cities ORDER BY city_name;`;
            const rows = await queryAll(sql, []);
            return rows.map(r => new CityClimate(r));
        }

        static async loadByName(name) {
            const sql = `SELECT * FROM Cities WHERE city_name = ? LIMIT 1;`;
            const rows = await queryAll(sql, [name]);
            return rows[0] ? new CityClimate(rows[0]) : null;
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

        dailyRates(tbase, year) {
            const means = this.monthlyMeans();
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
    }


    class PolicyFlags {
        constructor({
            // spring frost gate
            useSpringFrostGate = true,          // default ON for non-overwinter crops
            springFrostRisk = 'p50',            // 'p90' | 'p50' | 'p10'

            // Soil gate
            useSoilTempGate = false,
            soilGateThresholdC = null,
            soilGateConsecutiveDays = 3,

            overwinterAllowed = false
        } = {}) {
            this.overwinterAllowed = !!overwinterAllowed;

            this.useSpringFrostGate = !!useSpringFrostGate; // FIX: overwinter capability does not make early field planting frost-safe
            this.springFrostRisk = springFrostRisk;

            const thr = Number(soilGateThresholdC);
            this.soilGateThresholdC = Number.isFinite(thr) ? thr : null;
            this.useSoilTempGate = !!useSoilTempGate && this.soilGateThresholdC != null;
            this.soilGateConsecutiveDays = Math.max(1, Number(soilGateConsecutiveDays ?? 3));
            Object.freeze(this);
        }

        static fromResolvedBehavior(plant, resolvedBehavior) {
            const threshold = finiteNumberOrNull(plant?.soil_temp_min_plant_c);
            const overwinterAllowed = isCrossYearCrop(plant); // FIX: biennials are cross-year crops

            return new PolicyFlags({
                useSpringFrostGate: true, // FIX: apply the field frost gate to perennials and overwinter-capable crops
                springFrostRisk: 'p50',
                useSoilTempGate: !!resolvedBehavior?.usesSoilTempGate && threshold != null,
                soilGateThresholdC: threshold,
                soilGateConsecutiveDays: 3,
                overwinterAllowed
            });
        }

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





























    class ScheduleInputs {
        constructor({
            plant,
            city,
            planningMode,
            methodCategoryId = "",
            methodId = "",
            startISO,
            seasonEndISO,
            policy,
            seasonStartYear,
            harvestWindowDays,
            minYieldMultiplier = 0,
            varietyId = null,
            varietyName = ''
        }) {
            Object.assign(this, {
                plant,
                city,
                planningMode,
                methodCategoryId: normId(methodCategoryId),
                methodId: normId(methodId),
                startISO,
                seasonEndISO,
                policy,
                seasonStartYear: Number(seasonStartYear),
                harvestWindowDays: (harvestWindowDays == null ? null : Number(harvestWindowDays)),
                minYieldMultiplier: Number(minYieldMultiplier),
                varietyId: (varietyId != null ? Number(varietyId) : null),
                varietyName: String(varietyName || '')
            });
            Object.freeze(this);
        }

        derived() {
            const startDate = new Date(this.startISO + 'T00:00:00Z');
            const seasonEnd = new Date(this.seasonEndISO + 'T00:00:00Z');

            const env = this.plant.cropTempEnvelope();

            const scanYears = getPlantScanYears(this.plant); // FIX: use the same lifecycle calculation in every planner entry point

            const scanStart = asUTCDate(this.seasonStartYear, 1, 1);
            const scanEndHard = asUTCDate(this.seasonStartYear + scanYears - 1, 12, 31);

            const year = scanStart.getUTCFullYear();
            const dailyRates = this.city.dailyRates(env.Tbase, year);
            const monthlyAvg = this.city.monthlyMeans();

            return { startDate, seasonEnd, year, env, dailyRates, monthlyAvg, scanStart, scanEndHard };
        }
    }

    class Planner {
        constructor(inputs) {
            const { plant, city, planningMode, methodCategoryId, methodId, policy } = inputs;
            const { startDate, seasonEnd, env, dailyRates, monthlyAvg, scanStart, scanEndHard } = inputs.derived();
            if (isPerennialPlant(plant)) {
                throw new Error('Perennial schedules use lifespan dates instead of the maturity planner.');
            } // FIX: never request a maturity budget for a perennial
            const budget = plant.firstHarvestBudget();

            const HW_DAYS = resolveHarvestWindowDays(inputs.harvestWindowDays, plant); // FIX: use the canonical fallback

            const coolingThreshold = asCoolingThresholdC(plant.start_cooling_threshold_c);

            let coolingCross = null;
            if (coolingThreshold != null) {
                coolingCross = firstCoolingCrossingDate({
                    thresholdC: coolingThreshold,
                    monthlyAvgTemp: monthlyAvg,
                    scanStart,
                    scanEndHard
                });
            }

            this.ctx = Object.freeze({
                planningMode,
                methodCategoryId: normId(methodCategoryId),
                methodId: normId(methodId),

                useCoolingGate: coolingThreshold != null,
                coolingThresholdC: coolingThreshold,
                coolingCrossDate: coolingCross,
                overwinterAllowed: policy.overwinterAllowed,
                useSoilTempGate: policy.useSoilTempGate,
                soilGateThresholdC: policy.soilGateThresholdC,
                soilGateConsecutiveDays: policy.soilGateConsecutiveDays,
                useSpringFrostGate: policy.useSpringFrostGate,
                springFrostRisk: policy.springFrostRisk,
                lastSpringFrostDOY: pickFrostByRisk(city, policy.springFrostRisk),
                plant,
                HW_DAYS,

                BUDGET: budget,
                env,
                dailyRates,
                monthlyAvg,
                Tbase: env.Tbase,

                startDate,
                seasonEnd,
                scanStart,
                scanEndHard,
            });
        }

        gddRateOn(d) { return (this.ctx.dailyRates[d.getUTCMonth() + 1] ?? 0); }
        addDays(d, k) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + k)); }
        withinWindow(d) { return d >= this.ctx.scanStart && d <= this.ctx.scanEndHard; }

        normalizeUtcMidnight(d) {
            return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
        }

        soilGateOK(startDate) {
            const { soilGateConsecutiveDays, soilGateThresholdC, monthlyAvg } = this.ctx;

            let cur = new Date(startDate);
            for (let i = 0; i < soilGateConsecutiveDays; i++) {
                const lagged = this.addDays(cur, -10);
                const Tair = monthlyAvg[lagged.getUTCMonth() + 1] ?? 0;
                const Tsoil = 1 * Tair - 1;
                if (Tsoil < soilGateThresholdC) return false;
                cur = this.addDays(cur, 1);
            }
            return true;
        }

        checkSpringFrostGate(gateDate) {
            const C = this.ctx;
            if (!C.useSpringFrostGate || !gateDate) return { ok: true };
            const doy = dayOfYear(gateDate);
            if (doy < Number(C.lastSpringFrostDOY || 0)) {
                return { ok: false, reason: `spring_frost_gate(doy ${doy} < ${C.lastSpringFrostDOY})` };
            }
            return { ok: true };
        }

        checkCoolingGate(gateDate) {
            const C = this.ctx;
            if (!C.useCoolingGate || !gateDate) return { ok: true };
            if (!C.coolingCrossDate || gateDate < C.coolingCrossDate) {
                return { ok: false, reason: 'cooling_gate' };
            }
            return { ok: true };
        }

        checkSoilGate(gateDate) {
            const C = this.ctx;
            if (!C.useSoilTempGate) return { ok: true };
            if (!gateDate) return { ok: false, reason: 'soil_gate_missing_date' };
            if (!this.soilGateOK(gateDate)) {
                return { ok: false, reason: 'soil_gate' };
            }
            return { ok: true };
        }

        isSowFeasible(sowDate) {
            const C = this.ctx;

            if (!this.withinWindow(sowDate)) return { ok: false, reason: 'outside_scan_window' };

            let transplantDate = null;
            if (C.planningMode === 'transplant_indoor') {
                const dTrans = Number(C.plant?.days_transplant ?? NaN);
                const daysTrans = Number.isFinite(dTrans) && dTrans > 0 ? Math.round(dTrans) : 0;
                transplantDate = this.addDays(sowDate, daysTrans);
            } else if (C.planningMode === 'transplant_outdoor') {
                transplantDate = new Date(sowDate);
            }

            const gateDate = (C.planningMode === 'direct_sow') ? sowDate : transplantDate;
            if (!gateDate || !this.withinWindow(gateDate)) {
                return { ok: false, reason: 'gate_outside_scan_window' }; // FIX: field/transplant gates must stay inside the scan
            }

            const frost = this.checkSpringFrostGate(gateDate);
            if (!frost.ok) return frost;

            const cooling = this.checkCoolingGate(gateDate);
            if (!cooling.ok) return cooling;

            const soil = this.checkSoilGate(gateDate);
            if (!soil.ok) return soil;

            if (C.BUDGET.mode === 'gdd') {
                const acc = accumulateGDDUntil(sowDate, C.BUDGET.amount, C.dailyRates, C.scanEndHard);
                if (!acc.reached) {
                    return { ok: false, reason: 'insufficient_gdd' };
                }
            }

            const mat = maturityDateFromBudget(sowDate, C.BUDGET, C.dailyRates, C.scanEndHard);
            const fullHarvestEnd = this.addDays(mat, C.HW_DAYS);

            if (!C.overwinterAllowed && sowDate.getUTCFullYear() !== fullHarvestEnd.getUTCFullYear()) {
                return { ok: false, reason: 'cross_year_disallowed' };
            }

            const hardEnd = (C.seasonEnd && C.seasonEnd <= C.scanEndHard) ? C.seasonEnd : C.scanEndHard;

            const effectiveHarvestEnd = (fullHarvestEnd <= hardEnd)
                ? fullHarvestEnd
                : hardEnd;

            const MS_PER_DAY = 24 * 60 * 60 * 1000;
            const harvestSpanDays = Math.max(0, Math.round(
                (effectiveHarvestEnd.getTime() - mat.getTime()) / MS_PER_DAY
            ));

            const minHarvestDays = Math.min(C.HW_DAYS, 3);
            if (harvestSpanDays < minHarvestDays) {
                return { ok: false, reason: 'beyond_hard_end' };
            }

            const TmeanHarvest = weightedMeanTempOverRange(
                mat,
                effectiveHarvestEnd,
                C.monthlyAvg,
                C.dailyRates,
                C.Tbase
            );

            const { Tmin, Tmax } = C.env;
            if (TmeanHarvest < Tmin) return { ok: false, reason: `harvest_too_cold(${TmeanHarvest.toFixed(1)}<${Tmin})` };
            if (TmeanHarvest > Tmax) return { ok: false, reason: `harvest_too_hot(${TmeanHarvest.toFixed(1)}>${Tmax})` };

            const truncated = fullHarvestEnd.getTime() > effectiveHarvestEnd.getTime();
            return {
                ok: true,
                maturity: mat,
                harvestStart: mat,
                harvestEnd: effectiveHarvestEnd,
                truncated,
                TmeanHarvest
            };
        }

        findNextFeasible(startCandidate, maxDays = 366) {
            const startMs = Math.max(
                this.normalizeUtcMidnight(startCandidate).getTime(),
                this.normalizeUtcMidnight(this.ctx.scanStart).getTime()
            );
            let d = new Date(startMs);

            for (let i = 0; i <= maxDays && d <= this.ctx.scanEndHard; i++) {
                const feas = this.isSowFeasible(d);
                if (feas.ok) return { date: d, info: feas };
                d = this.addDays(d, 1);
            }
            return { date: null, info: null };
        }
    }

    async function buildScheduleContextFromForm(formState, selPlant, options = {}) {
        const plant = await resolveEffectivePlant(formState.plantId, formState.varietyId);
        if (!plant) throw new Error('Plant not found for schedule.');

        const city = await CityClimate.loadByName(formState.cityName);
        if (!city) throw new Error('City not found for schedule.');

        const methodCategoryId = normId(formState.methodCategoryId);
        const methodId = normId(formState.methodId);
        const resolvedBehavior = resolveMethodBehavior({ methodCategoryId, methodId });
        const planningMode = resolvedBehavior.planningMode;

        const policy = PolicyFlags.fromResolvedBehavior(plant, resolvedBehavior);

        const varietyId = formState.varietyId != null ? Number(formState.varietyId) : null;
        const varietyName = varietyId
            ? await resolveVarietyName(varietyId, options.currentVarieties)
            : '';

        const inputs = new ScheduleInputs({
            plant,
            city,
            planningMode,
            methodCategoryId: resolvedBehavior.methodCategoryId,
            methodId: resolvedBehavior.methodId,
            startISO: formState.startISO,
            seasonEndISO: formState.seasonEndISO,
            policy,
            seasonStartYear: formState.seasonStartYear,
            harvestWindowDays: formState.harvestWindowDays,
            minYieldMultiplier: formState.minYieldMultiplier,
            varietyId,
            varietyName
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

    function getGateDateForCandidate(planner, sowDate) {
        const C = planner.ctx;
        if (C.planningMode === 'direct_sow') return new Date(sowDate);
        if (C.planningMode === 'transplant_indoor') {
            const dTrans = Number(C.plant?.days_transplant ?? NaN);
            const daysTrans = Number.isFinite(dTrans) && dTrans > 0 ? Math.round(dTrans) : 0;
            return planner.addDays(sowDate, daysTrans);
        }
        if (C.planningMode === 'transplant_outdoor') return new Date(sowDate);
        return new Date(sowDate);
    }

    function firstNonSoilStart(planner, startD) {
        const C = planner.ctx;
        let d = new Date(Math.max(startD.getTime(), C.scanStart.getTime()));        
        for (; d <= C.scanEndHard; d = planner.addDays(d, 1)) {
            const gateDate = getGateDateForCandidate(planner, d);
            if (!C.useSoilTempGate || planner.soilGateOK(gateDate)) return d;
        }
        return null;
    }

    function accumulateGDDUntil(startDate, targetGDD, dailyRatesMap, seasonEnd) {
        let acc = 0;
        let cur = new Date(Date.UTC(startDate.getUTCFullYear(),
            startDate.getUTCMonth(),
            startDate.getUTCDate()));
        while (acc < targetGDD) {
            if (seasonEnd && !dateLTE(cur, seasonEnd)) break;
            const rate = Math.max(0, dailyRatesMap[cur.getUTCMonth() + 1] ?? 0);
            acc += rate;
            if (acc >= targetGDD) break;
            cur = addDaysUTC(cur, 1);
        }
        const reached = acc >= targetGDD;
        return { date: cur, gdd: acc, reached };
    }

    function accumulateGDDBackward(targetDate, targetGDD, dailyRatesMap, seasonStart = null) {
        let acc = 0;
        let cur = addDaysUTC(targetDate, -1);
        while (acc < targetGDD) {
            if (seasonStart && dateLTE(cur, addDaysUTC(seasonStart, -1))) break;
            const rate = Math.max(0, dailyRatesMap[cur.getUTCMonth() + 1] ?? 0);
            acc += rate;
            cur = addDaysUTC(cur, -1);
        }
        return { date: addDaysUTC(cur, 1), gdd: acc };
    }

    function maturityDateFromBudget(startDate, budget, dailyRatesMap, seasonEnd) {
        if (budget.mode === 'days') {
            return addDaysUTC(startDate, Math.max(0, Math.round(budget.amount)));
        }
        return accumulateGDDUntil(startDate, budget.amount, dailyRatesMap, seasonEnd).date;
    }

    // -------------------- Thermal / yield helpers -----------------------------------------

    function thermalYieldFactor(T, cropTemp) {
        const { Tmin, ToptLow, ToptHigh, Tmax } = cropTemp;
        if (T <= Tmin || T >= Tmax) return 0;
        if (T < ToptLow) return (T - Tmin) / Math.max(1e-9, (ToptLow - Tmin));
        if (T <= ToptHigh) return 1;
        return (Tmax - T) / Math.max(1e-9, (Tmax - ToptHigh));
    }
    function weightedMeanTempOverRange(startDate, endDate, monthlyAvgTemp, dailyRatesMap, Tbase = 10) {
        let cur = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()));
        const sampleEnd = endDate > startDate ? endDate : addDaysUTC(startDate, 1); // FIX: sample maturity day for zero-day windows
        let sum = 0, n = 0;
        while (cur < sampleEnd) {
            const m = cur.getUTCMonth() + 1;
            let T = monthlyAvgTemp?.[m];
            if (T == null) {
                const gdd = Math.max(0, dailyRatesMap[cur.getUTCMonth() + 1] ?? 0);
                T = gdd > 0 ? (Tbase + gdd) : (Tbase - 2);
            }
            sum += T; n += 1; cur = addDaysUTC(cur, 1);
        }
        return n > 0 ? (sum / n) : Tbase;
    }

    // -------------------- Soil-temperature gate --------------------------------------------

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



    function monthMeanAt(date, monthlyAvgTemp) {
        return monthlyAvgTemp?.[date.getUTCMonth() + 1] ?? null;
    }

    function firstCoolingCrossingDate({ thresholdC, monthlyAvgTemp, scanStart, scanEndHard }) {
        // Ignore winter cold until the scan has observed a warm month.
        let cursor = asUTCDate(scanStart.getUTCFullYear(), scanStart.getUTCMonth() + 1, 1);
        const end = asUTCDate(scanEndHard.getUTCFullYear(), scanEndHard.getUTCMonth() + 1, 1);
        let armed = false; // FIX: a cooling trigger requires an earlier warm period in the scan window
        let previousWarmMonth = null; // FIX: retain only an adjacent warm month for interpolation
        let previousWarmTemp = null;

        while (dateLTE(cursor, end)) {
            const Tcur = monthMeanAt(cursor, monthlyAvgTemp);
            if (Tcur == null) { // FIX: missing data breaks adjacency and cannot form a crossing
                armed = false;
                previousWarmMonth = null;
                previousWarmTemp = null;
            } else if (Tcur > thresholdC) {
                armed = true;
                previousWarmMonth = new Date(cursor);
                previousWarmTemp = Number(Tcur);
            } else if (armed && previousWarmMonth && previousWarmTemp != null) {
                const expectedNextMonth = asUTCDate(
                    previousWarmMonth.getUTCFullYear(),
                    previousWarmMonth.getUTCMonth() + 2,
                    1
                );
                if (expectedNextMonth.getTime() === cursor.getTime()) { // FIX: interpolate only adjacent monthly observations
                    const dim = daysInMonth(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1);
                    const frac = Math.min(1, Math.max(
                        0,
                        (previousWarmTemp - thresholdC) / Math.max(1e-6, previousWarmTemp - Number(Tcur))
                    ));
                    const day = Math.max(1, Math.min(dim, Math.round(frac * dim)));
                    return asUTCDate(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, day);
                }
                armed = false;
                previousWarmMonth = null;
                previousWarmTemp = null;
            }
            cursor = asUTCDate(cursor.getUTCFullYear(), cursor.getUTCMonth() + 2, 1);
        }

        return null; // FIX: January cold or a climate without an autumn crossing is not a trigger
    }


    function computeStageDatesForPlanting({ sowDate, budget, stageDays, dailyRatesMap, seasonEnd, planningMode }) {
        const maturity = maturityDateFromBudget(sowDate, budget, dailyRatesMap, seasonEnd);
        const harvestDays = resolveHarvestWindowDays(stageDays.harvest_window_days); // FIX: use the canonical fallback
        const harvestStart = maturity;                          // first harvest
        const harvestEnd = addDaysUTC(maturity, harvestDays); // window after first harvest

        const rawGerminationDays = stageDays.germinationDays ?? stageDays.days_germ;
        const germinationDays = finiteNumberOrNull(rawGerminationDays);
        const germ = germinationDays != null && germinationDays >= 0
            ? addDaysUTC(sowDate, Math.round(germinationDays))
            : null; // FIX: germination is calendar days after sowing, independent of maturity
        let transplant = null;
        if (planningMode === 'transplant_outdoor') {
            transplant = new Date(sowDate);
        } else if (planningMode === 'transplant_indoor') {
            const daysToTransplant = Number(stageDays.transplantDays);
            transplant = Number.isFinite(daysToTransplant) && daysToTransplant > 0
                ? addDaysUTC(sowDate, Math.round(daysToTransplant))
                : new Date(sowDate);
        }

        return {
            sow: sowDate,
            germ,
            transplant,
            maturity,
            harvestStart,
            harvestEnd
        };
    }


    function computeStageTimelineForSchedule({ schedule, budget, stageDays, dailyRatesMap, seasonEnd, planningMode }) {

        if (!budget || !Number.isFinite(budget.amount) || budget.amount <= 0) {
            throw new Error('Invalid maturity budget');
        }
        return (schedule || []).map(sow =>
            computeStageDatesForPlanting({ sowDate: sow, budget, stageDays, dailyRatesMap, seasonEnd, planningMode })
        );
    }

    function classifyIsThermal(reason) {
        if (!reason) return false;
        return reason.indexOf('harvest_too_cold') === 0 ||
            reason.indexOf('harvest_too_hot') === 0 ||
            reason === 'insufficient_gdd';
    }

    function impliedHarvestEndForDate(planner, sow, HW_DAYS) {
        const C = planner.ctx;
        const mat = maturityDateFromBudget(sow, C.BUDGET, C.dailyRates, C.scanEndHard);
        return planner.addDays(mat, Math.max(0, HW_DAYS || 0));
    }

    // helper near your other date utils
    function dateFromDOY(year, doy) {
        const d0 = Date.UTC(year, 0, 1);
        return new Date(d0 + (Math.max(1, Math.floor(doy)) - 1) * 86400000);
    }


    const METHOD_BEHAVIOR = Object.freeze({
        "transplant.indoor": Object.freeze({
            methodCategoryId: "transplant",
            planningMode: "transplant_indoor",
            usesSoilTempGate: true,
            leadDaysMode: "days_transplant"
        }),
        "transplant.outdoor": Object.freeze({
            methodCategoryId: "transplant",
            planningMode: "transplant_outdoor",
            usesSoilTempGate: true,
            leadDaysMode: "none"
        }),
        "transplant.purchased": Object.freeze({
            methodCategoryId: "transplant",
            planningMode: "transplant_outdoor",
            usesSoilTempGate: true,
            leadDaysMode: "none"
        }),
        "transplant.cutting": Object.freeze({
            methodCategoryId: "transplant",
            planningMode: "transplant_indoor",
            usesSoilTempGate: true,
            leadDaysMode: "days_transplant"
        }),
        "direct_sow.field": Object.freeze({
            methodCategoryId: "direct_sow",
            planningMode: "direct_sow",
            usesSoilTempGate: true,
            leadDaysMode: "none"
        }),
        "direct_sow.pre_germinated": Object.freeze({
            methodCategoryId: "direct_sow",
            planningMode: "direct_sow",
            usesSoilTempGate: true,
            leadDaysMode: "none"
        }),
        "direct_sow.plug": Object.freeze({
            methodCategoryId: "direct_sow",
            planningMode: "transplant_outdoor",
            usesSoilTempGate: true,
            leadDaysMode: "none"
        })
    });

    function resolveMethodBehavior({ methodCategoryId, methodId }) {
        const category = normId(methodCategoryId);
        const id = normId(methodId);

        if (!category) throw new Error("methodCategoryId is required.");
        if (!id) throw new Error("methodId is required.");

        const behavior = METHOD_BEHAVIOR[id];
        if (!behavior) throw new Error(`Unsupported methodId: ${id}`);

        if (behavior.methodCategoryId !== category) {
            throw new Error(`methodId "${id}" does not belong to methodCategoryId "${category}".`);
        }

        if (!id.startsWith(category + ".")) {
            throw new Error(`methodId "${id}" must begin with "${category}."`);
        }

        return {
            methodCategoryId: category,
            methodId: id,
            planningMode: behavior.planningMode,
            usesSoilTempGate: !!behavior.usesSoilTempGate,
            leadDaysMode: String(behavior.leadDaysMode || "none")
        };
    }

    function resolveValidMethodRecord(methodRow, fallbackMethodCategoryId = '') { // FIX: validate DB method rows consistently
        const methodCategoryId = normId(
            methodRow?.method_category_id ?? fallbackMethodCategoryId ?? ''
        );
        const methodId = normId(methodRow?.method_id);
        return resolveMethodBehavior({ methodCategoryId, methodId });
    }

    function validateAutoWindowMethodInputs({ resolvedBehavior, daysTransplant }) {
        if (!resolvedBehavior || typeof resolvedBehavior !== "object") {
            throw new Error("resolvedBehavior is required.");
        }

        if (resolvedBehavior.leadDaysMode === "days_transplant") {
            const dt = Number(daysTransplant);
            if (!Number.isFinite(dt) || dt <= 0) {
                throw new Error(`methodId "${resolvedBehavior.methodId}" requires daysTransplant > 0.`);
            }
        }
    }


    async function resolveInitialMethodSelection(cell, plant) {
        const cellMethodCategoryId = normId(cell?.getAttribute?.('method_category_id'));
        const cellMethodId = normId(cell?.getAttribute?.('method_id'));
    
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
        const defaultMethodId = normId(plant?.default_planting_method);
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
                });
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
            });
        }
        for (const cat of (allowedCategories || [])) {
            const methodCategoryId = normId(cat?.method_category_id);
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
                        });
                    }
                }
            } catch (e) {
                console.warn('[Scheduler] Skipping invalid allowed method category', {
                    plantId: plant?.plant_id,
                    methodCategoryId,
                    reason: e?.message || String(e)
                });
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










    function buildAutoWindowPlanner(params) {
        const {
            methodId, methodCategoryId, budget, HW_DAYS,
            dailyRatesMap, monthlyAvgTemp, Tbase, cropTemp,
            scanStart, scanEndHard,
            soilGateThresholdC, soilGateConsecutiveDays,
            startCoolingThresholdC,
            useSpringFrostGate,
            lastSpringFrostDOY, // FIX: accept the selected city's frost date
            daysTransplant,
            overwinterAllowed
        } = params;

        const resolvedBehavior = resolveMethodBehavior({ methodCategoryId, methodId });
        validateAutoWindowMethodInputs({ resolvedBehavior, daysTransplant });

        const fakePlant = {
            start_cooling_threshold_c: startCoolingThresholdC,
            soil_temp_min_plant_c: soilGateThresholdC,
            isPerennial: () => false,
            isBiennial: () => false,
            overwinter_ok: overwinterAllowed ? 1 : 0,
            days_transplant: daysTransplant,
            cropTempEnvelope: () => cropTemp,
            firstHarvestBudget: () => budget
        };

        const fakeCity = {
            dailyRates: (_tbase, _year) => dailyRatesMap,
            monthlyMeans: () => monthlyAvgTemp,
            last_spring_frost_p50_doy: lastSpringFrostDOY, // FIX: pass frost data into Planner
            last_spring_frost_doy: lastSpringFrostDOY // FIX: preserve Planner's plain-column fallback
        };

        const policy = new PolicyFlags({
            useSoilTempGate: Number.isFinite(soilGateThresholdC) && resolvedBehavior.usesSoilTempGate,
            soilGateThresholdC,
            soilGateConsecutiveDays,
            overwinterAllowed,
            useSpringFrostGate: !!useSpringFrostGate, // FIX: keep frost gating independent from overwinter support
            springFrostRisk: 'p50'
        });

        const inputs = new ScheduleInputs({
            plant: fakePlant,
            city: fakeCity,
            planningMode: resolvedBehavior.planningMode,
            methodCategoryId: resolvedBehavior.methodCategoryId,
            methodId: resolvedBehavior.methodId,
            startISO: scanStart.toISOString().slice(0, 10),
            seasonEndISO: scanEndHard.toISOString().slice(0, 10),
            policy,
            seasonStartYear: scanStart.getUTCFullYear(),
            harvestWindowDays: HW_DAYS
        });

        const planner = new Planner(inputs);
        return { planner, ctx: planner.ctx, resolvedBehavior };
    }

    // -------------------- Feasibility + window (single pure function) --------------------
    function computeAutoStartEndWindowForward(params) {
        const {
            methodId, methodCategoryId, budget, HW_DAYS,
            dailyRatesMap, monthlyAvgTemp, Tbase, cropTemp,
            scanStart, scanEndHard,
            // gates
            soilGateThresholdC = null, soilGateConsecutiveDays = 3,
            startCoolingThresholdC = null,
            useSpringFrostGate = false,
            lastSpringFrostDOY = null,
            // transplant specifics
            daysTransplant = 0,
            // behavior
            overwinterAllowed = false,
        } = params;

        const resolvedHarvestWindowDays = resolveHarvestWindowDays(HW_DAYS); // FIX: normalize fallback estimates as well as planner feasibility
        const { planner, resolvedBehavior } = buildAutoWindowPlanner({
            methodId, methodCategoryId, budget, HW_DAYS: resolvedHarvestWindowDays, // FIX: pass the canonical value
            dailyRatesMap, monthlyAvgTemp, Tbase, cropTemp,
            scanStart, scanEndHard,
            soilGateThresholdC, soilGateConsecutiveDays,
            startCoolingThresholdC,
            useSpringFrostGate,
            lastSpringFrostDOY, // FIX: forward the caller's frost date instead of using the default DOY
            daysTransplant,
            overwinterAllowed
        });

        const C = planner.ctx;
        const planningMode = resolvedBehavior.planningMode;

        // Limit sow scanning for overwinter crops to the first season year
        const sowScanEnd = overwinterAllowed
            ? asUTCDate(C.scanStart.getUTCFullYear(), 12, 31)
            : C.scanEndHard;

        // --- Build earliest FIELD date (air-gated date) ---
        let fieldGateStart = new Date(C.scanStart);

        // spring frost gate
        if (useSpringFrostGate && Number.isFinite(lastSpringFrostDOY)) {
            const frostDate = dateFromDOY(C.scanStart.getUTCFullYear(), lastSpringFrostDOY);
            if (frostDate > fieldGateStart) fieldGateStart = frostDate;
        }

        // cooling gate (air)
        if (Number.isFinite(startCoolingThresholdC)) {
            const cross = firstCoolingCrossingDate({
                thresholdC: startCoolingThresholdC,
                monthlyAvgTemp,
                scanStart: C.scanStart,
                scanEndHard: C.scanEndHard
            });
            if (cross && cross > fieldGateStart) fieldGateStart = cross;
        }

        // --- Convert fieldGateStart → sow candidate based on method behavior ---
        let sowCandidate = new Date(fieldGateStart);

        if (resolvedBehavior.leadDaysMode === "days_transplant") {
            const dt = Math.max(0, Math.round(Number(daysTransplant) || 0));
            const indoorSow = planner.addDays(fieldGateStart, -dt);
            sowCandidate = indoorSow < C.scanStart ? new Date(C.scanStart) : indoorSow;
        } else {
            sowCandidate = fieldGateStart;
        }

        // --- Walk feasibility from that candidate using full planner logic ---
        const firstNonSoil = resolvedBehavior.usesSoilTempGate
            ? (firstNonSoilStart(planner, sowCandidate) || sowCandidate)
            : sowCandidate;

        let firstOkSow = null;
        let firstOkHarvestStart = null;
        let firstOkHarvestEnd = null;
        let lastOkHarvestEnd = null;
        let lastThermalHarvestEnd = null;
        let lastOkSow = null;

        for (let d = new Date(firstNonSoil); d <= sowScanEnd; d = planner.addDays(d, 1)) {
            const r = planner.isSowFeasible(d);
            if (r.ok) {
                if (!firstOkSow) {
                    firstOkSow = new Date(d);
                    firstOkHarvestStart = r.harvestStart;
                    firstOkHarvestEnd = r.harvestEnd;
                }

                lastOkSow = new Date(d);

                const hEnd = r.harvestEnd;
                if (!lastOkHarvestEnd || hEnd > lastOkHarvestEnd) {
                    lastOkHarvestEnd = hEnd;
                }
            } else {
                const isThermal = classifyIsThermal(r.reason) ||
                    r.reason === 'cross_year_disallowed' ||
                    r.reason === 'beyond_hard_end';
                if (isThermal) {
                    let hEnd = impliedHarvestEndForDate(planner, d, resolvedHarvestWindowDays); // FIX: use the canonical value
                    if (hEnd > C.scanEndHard) hEnd = new Date(C.scanEndHard);
                    if (!lastThermalHarvestEnd || hEnd > lastThermalHarvestEnd) {
                        lastThermalHarvestEnd = hEnd;
                    }
                }
            }
        }

        if (!firstOkSow) {
            console.log('[autoWindow] scan (no feasible)', {
                scanStart: C.scanStart.toISOString().slice(0, 10),
                scanEndHard: C.scanEndHard.toISOString().slice(0, 10),
                methodCategoryId: resolvedBehavior.methodCategoryId,
                methodId: resolvedBehavior.methodId,
                planningMode,
                firstNonSoil: firstNonSoil ? firstNonSoil.toISOString().slice(0, 10) : null,
                lastThermalHarvestEnd: lastThermalHarvestEnd
                    ? lastThermalHarvestEnd.toISOString().slice(0, 10)
                    : null
            });

            return {
                feasible: false, // FIX: absence of a feasible sow date is explicit
                harvestEndSemantics: HARVEST_END_SEMANTICS,
                earliestFeasibleSowDate: null,
                earliestHarvestStartDate: null,
                earliestHarvestEndDate: null,
                lastFeasibleSowDate: null,
                climateEndDate: null
            };
        }

        const earliestFeasibleSow = firstOkSow;
        const lastFeasibleSow = lastOkSow;
        const firstFeasibleHarvestStart = firstOkHarvestStart;
        const firstFeasibleHarvestEnd = firstOkHarvestEnd;
        const lastFeasibleHarvestEnd = lastOkHarvestEnd;

        const fallbackHarvestEnd = lastFeasibleHarvestEnd ||
            firstFeasibleHarvestEnd ||
            lastThermalHarvestEnd ||
            new Date(C.scanEndHard);

        const earliestHarvestStartDate = firstFeasibleHarvestStart || null;
        const earliestHarvestEndDate = firstFeasibleHarvestEnd || earliestFeasibleSow;

        let climateEndDate;
        if (overwinterAllowed) {
            climateEndDate = lastFeasibleHarvestEnd // FIX: retain the full feasible overwinter harvest window
                || earliestHarvestEndDate
                || lastThermalHarvestEnd
                || new Date(C.scanEndHard);
        } else {
            climateEndDate = lastFeasibleHarvestEnd
                || lastThermalHarvestEnd
                || earliestHarvestEndDate
                || new Date(C.scanEndHard);
        }

        console.log('[autoWindow] RESULT', {
            earliestFeasibleSowDate: fmtISO(earliestFeasibleSow),
            earliestHarvestStartDate: earliestHarvestStartDate ? fmtISO(earliestHarvestStartDate) : null,
            earliestHarvestEndDate: fmtISO(earliestHarvestEndDate),
            lastFeasibleSowDate: lastFeasibleSow ? fmtISO(lastFeasibleSow) : null,
            climateEndDate: climateEndDate ? fmtISO(climateEndDate) : null,
            HW_DAYS: resolvedHarvestWindowDays, // FIX: report the canonical value
            methodCategoryId: resolvedBehavior.methodCategoryId,
            methodId: resolvedBehavior.methodId,
            planningMode
        });

        return {
            feasible: true,
            harvestEndSemantics: HARVEST_END_SEMANTICS,
            earliestFeasibleSowDate: earliestFeasibleSow,
            earliestHarvestStartDate,
            earliestHarvestEndDate,
            lastFeasibleSowDate: lastFeasibleSow,
            climateEndDate
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

    function retileAndFitGroupIfAvailable(graph, groupCell, opts = {}) {
        const tiler = window.USL && window.USL.tiler ? window.USL.tiler : null;
        const fit = tiler && typeof tiler.retileAndFitToContainingBed === 'function' ? tiler.retileAndFitToContainingBed : null;
        if (fit) return fit(graph, groupCell, opts);
        const retile = tiler && typeof tiler.retileGroup === 'function' ? tiler.retileGroup : null;
        if (retile) retile(graph, groupCell);
        return null;
    }






































































    // -------------------- UI bits (small DOM helpers) --------------------------------------
    function row(labelText, controlEl) {
        const wrap = document.createElement('div');
        wrap.className = 'usl-scheduler-row';
        wrap.style.display = 'flex';
        wrap.style.alignItems = 'center';
        wrap.style.gap = '8px';
        wrap.style.margin = '6px 0';
        const lab = document.createElement('label');
        lab.className = 'usl-scheduler-row-label';
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

    function encodeMethodSelection(methodCategoryId, methodId) {
        return JSON.stringify([normId(methodCategoryId), normId(methodId)]);
    }

    function decodeMethodSelection(value) {
        try {
            const parsed = JSON.parse(String(value || ''));
            if (!Array.isArray(parsed) || parsed.length !== 2) return null;
            const methodCategoryId = normId(parsed[0]);
            const methodId = normId(parsed[1]);
            if (!methodCategoryId || !methodId) return null;
            return { methodCategoryId, methodId };
        } catch (_) {
            return null;
        }
    }

    function humanFeasibilityReason(reason) {
        const raw = String(reason || '').trim();
        if (!raw || raw === 'ok') return 'Feasible';
        if (raw === 'outside_scan_window') return 'The selected date is outside the planning season.';
        if (raw === 'gate_outside_scan_window') return 'The planting or transplant date falls outside the planning season.';
        if (raw.indexOf('spring_frost_gate') === 0) return 'The planting date is before the frost-safety date.';
        if (raw === 'cooling_gate') return 'The crop requires a later seasonal cooling trigger.';
        if (raw === 'soil_gate_missing_date') return 'A soil-temperature check could not be evaluated.';
        if (raw === 'soil_gate') return 'The soil is expected to be too cold on this date.';
        if (raw === 'insufficient_gdd') return 'There is not enough growing-degree accumulation to reach maturity.';
        if (raw === 'cross_year_disallowed') return 'This planting would extend into another year.';
        if (raw === 'beyond_hard_end') return 'There is not enough season remaining for the harvest window.';
        if (raw.indexOf('harvest_too_cold') === 0) return 'Expected harvest temperatures are too cold.';
        if (raw.indexOf('harvest_too_hot') === 0) return 'Expected harvest temperatures are too hot.';
        if (raw.indexOf('error:') === 0) return raw.slice(6).trim() || 'The feasibility check failed.';
        return raw.replace(/_/g, ' ');
    }

    function classifySelectedSowDate({
        perennial = false,
        windowFeasible = false,
        startISO = '',
        earliestISO = '',
        latestISO = ''
    } = {}) {
        if (perennial) {
            return { status: 'not_applicable', label: 'Not applicable for perennial planting dates.' };
        }
        if (!windowFeasible) {
            return { status: 'no_window', label: 'No feasible sowing window is available.' };
        }
        const selected = parseISODateUTCValue(startISO);
        if (!selected) return { status: 'missing', label: 'Select a sow date.' };
        const earliest = parseISODateUTCValue(earliestISO);
        const latest = parseISODateUTCValue(latestISO);
        if (earliest && selected < earliest) {
            return { status: 'early', label: 'The selected sow date is earlier than the feasible window.' };
        }
        if (latest && selected > latest) {
            return { status: 'late', label: 'The selected sow date is later than the feasible window.' };
        }
        return { status: 'feasible', label: 'The selected sow date is feasible.' };
    }

    function buildScheduleViewState({
        perennial = false,
        windowFeasible = false,
        plantName = '',
        varietyName = '',
        cityName = '',
        seasonStartYear = '',
        methodName = '',
        startISO = '',
        earliestISO = '',
        latestISO = '',
        firstHarvestISO = '',
        lastHarvestISO = ''
    } = {}) {
        const feasibility = classifySelectedSowDate({
            perennial,
            windowFeasible,
            startISO,
            earliestISO,
            latestISO
        });
        return {
            crop: [plantName, varietyName].filter(Boolean).join(' / ') || '(none)',
            context: [cityName, seasonStartYear].filter(value => String(value || '').trim()).join(' / ') || '(none)',
            method: methodName || '(none)',
            selectedDate: startISO || '(not selected)',
            firstHarvest: perennial ? 'Not calculated for perennial schedules' : (firstHarvestISO || '(not available)'),
            harvestEnd: perennial ? 'Not calculated for perennial schedules' : (lastHarvestISO || '(not available)'),
            feasibility
        };
    }

    function renderScheduleSummary() {
        const root = document.createElement('div');
        root.className = 'usl-scheduler-summary';
        root.style.border = '1px solid #93c5fd';
        root.style.background = '#eff6ff';
        root.style.borderRadius = '6px';
        root.style.padding = '10px 12px';
        root.style.marginBottom = '10px';

        const title = document.createElement('div');
        title.className = 'usl-scheduler-summary-title';
        title.textContent = 'Schedule summary';
        title.style.fontWeight = '600';
        title.style.marginBottom = '8px';
        root.appendChild(title);

        const grid = document.createElement('div');
        grid.className = 'usl-scheduler-summary-grid';
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(220px, 1fr))';
        grid.style.gap = '6px 16px';
        root.appendChild(grid);

        const fields = {};
        [
            ['crop', 'Plant / variety'],
            ['context', 'City / year'],
            ['method', 'Planting method'],
            ['selectedDate', 'Selected sow or planting date'],
            ['firstHarvest', 'Expected first harvest'],
            ['harvestEnd', 'Expected harvest end'],
            ['feasibility', 'Feasibility']
        ].forEach(([key, label]) => {
            const item = document.createElement('div');
            item.className = 'usl-scheduler-summary-item';
            const labelEl = document.createElement('div');
            labelEl.className = 'usl-scheduler-summary-label';
            labelEl.textContent = label;
            labelEl.style.fontSize = '11px';
            labelEl.style.color = '#4b5563';
            const valueEl = document.createElement('div');
            valueEl.className = 'usl-scheduler-summary-value';
            valueEl.style.fontSize = '12px';
            valueEl.style.fontWeight = key === 'feasibility' ? '600' : '400';
            item.appendChild(labelEl);
            item.appendChild(valueEl);
            grid.appendChild(item);
            fields[key] = valueEl;
        });

        return { root, fields };
    }

    function updateScheduleSummary(summaryView, viewState) {
        if (!summaryView?.fields || !viewState) return;
        summaryView.fields.crop.textContent = viewState.crop;
        summaryView.fields.context.textContent = viewState.context;
        summaryView.fields.method.textContent = viewState.method;
        summaryView.fields.selectedDate.textContent = viewState.selectedDate;
        summaryView.fields.firstHarvest.textContent = viewState.firstHarvest;
        summaryView.fields.harvestEnd.textContent = viewState.harvestEnd;
        summaryView.fields.feasibility.textContent = viewState.feasibility.label;
        summaryView.fields.feasibility.style.color = viewState.feasibility.status === 'feasible'
            ? '#166534'
            : (viewState.feasibility.status === 'not_applicable' ? '#374151' : '#b91c1c');
    }

    // Scans season feasibility day-by-day.
    async function explainFeasibilityOverSeason(inputs, maxDays = 400, stopAtFirstOk = false) {
        const planner = new Planner(inputs);
        const out = [];
        let d = new Date(Math.max(planner.ctx.startDate, planner.ctx.scanStart));
        for (let i = 0; i < maxDays && d <= planner.ctx.scanEndHard; i++) {
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
        };

        function applyDialogMode(nextMode) {
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
        }

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
            const seen = new Set();
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
                return rows.map(r => normId(r.method_category_id)).filter(Boolean);
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
            const seen = new Set();
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
            const wanted = normId(currentPlantRow?.default_planting_method);

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
                opt.value = normId(m.method_id);
                opt.textContent = m.method_name || m.method_id;
                defaultMethodSel.appendChild(opt);
            }

            const validValues = new Set(Array.from(defaultMethodSel.options).map(o => o.value));
            const fallback = normId(currentPlantRow?.default_planting_method);

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

            { key: 'veg_height_cm', type: 'num_ge0', step: 1 },
            { key: 'veg_diameter_cm', type: 'num_ge0', step: 1 },
            { key: 'spacing_cm', type: 'num_ge0', step: 1 },
        ];

        function readOverrideValue(def, inputEl) {
            if (def.type === 'bool01') return inputEl.checked ? 1 : 0;
            if (def.type === 'int_ge0') return readIntGE0(inputEl);
            if (def.type === 'num_ge0') return readNumGE0(inputEl);
            if (def.type === 'nullable_num') return readNullableNumber(inputEl);
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

        const PLANT_FIELD_BINDINGS = [
            { key: 'plant_name', input: nameInput, kind: 'text', empty: '' },
            { key: 'abbr', input: abbrInput, kind: 'text', empty: '' },

            { key: 'days_germ', input: daysGermInput, kind: 'number', empty: '0' },
            { key: 'days_transplant', input: daysTransInput, kind: 'number', empty: '0' },

            { key: 'yield_per_plant_kg', input: yieldInput, kind: 'nullable-number', empty: '' },
            { key: 'harvest_window_days', input: hwInput, kind: 'nullable-number', empty: '' },

            { key: 'tbase_c', input: tbaseInput, kind: 'nullable-number', empty: '' },
            { key: 'tmin_c', input: tminInput, kind: 'nullable-number', empty: '' },
            { key: 'topt_low_c', input: toptLowInput, kind: 'nullable-number', empty: '' },
            { key: 'topt_high_c', input: toptHighInput, kind: 'nullable-number', empty: '' },
            { key: 'tmax_c', input: tmaxInput, kind: 'nullable-number', empty: '' },

            { key: 'soil_temp_min_plant_c', input: soilMinInput, kind: 'nullable-number', empty: '' },
            { key: 'start_cooling_threshold_c', input: coolThreshInput, kind: 'nullable-number', empty: '' },

            { key: 'veg_height_cm', input: vegHeightInput, kind: 'nullable-number', empty: '' },
            { key: 'veg_diameter_cm', input: vegDiamInput, kind: 'nullable-number', empty: '' },
            { key: 'spacing_cm', input: spacingInput, kind: 'nullable-number', empty: '' },
        ];

        function setBoundInputValue(binding, row) {
            const { key, input, kind, empty = '' } = binding;
            const value = row?.[key];

            if (kind === 'text') {
                input.value = value == null ? empty : String(value);
                return;
            }

            if (kind === 'number' || kind === 'nullable-number') {
                input.value = value == null ? empty : String(value);
                return;
            }

            throw new Error(`Unknown binding kind: ${kind}`);
        }

        function resetBoundPlantFields() {
            for (const binding of PLANT_FIELD_BINDINGS) {
                binding.input.value = binding.empty ?? '';
            }
        }

        function applyBoundPlantFields(row) {
            for (const binding of PLANT_FIELD_BINDINGS) {
                setBoundInputValue(binding, row);
            }
        }

        function setPlantControlsEnabled(enabled) {
            const els = [
                nameInput, abbrInput, typeSel, /* lifespanInput, */ overwinterChk,
                defaultMethodSel, budgetModeSel, gddInput, daysMatInput,
                daysGermInput, daysTransInput, yieldInput, hwInput,
                tbaseInput, tminInput, toptLowInput, toptHighInput, tmaxInput,
                soilMinInput, coolThreshInput,
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

        function applyPlantRowToUI(p) {
            applyBoundPlantFields(p);

            typeSel.value = (p?.perennial === 1) ? 'perennial' : (p?.biennial === 1 ? 'biennial' : 'annual');
            lifespanInput.value = p?.lifespan_years == null ? '' : String(p.lifespan_years);
            overwinterChk.checked = (p?.overwinter_ok === 1);
            syncLifecycleFields();

            const hasGddLocal = Number(p?.gdd_to_maturity ?? 0) > 0;
            budgetModeSel.value = hasGddLocal ? 'gdd' : 'days';
            gddInput.value = p?.gdd_to_maturity == null ? '' : String(p.gdd_to_maturity);
            daysMatInput.value = p?.days_maturity == null ? '' : String(p.days_maturity);
            syncBudgetModeUI();
        }

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
                applyDialogMode(DIALOG_MODE.PLANT_ADD);

                title.textContent = 'Add plant';

                resetBoundPlantFields();

                typeSel.value = 'annual';
                lifespanInput.value = '';
                overwinterChk.checked = false;
                syncLifecycleFields();

                budgetModeSel.value = 'days';
                gddInput.value = '';
                daysMatInput.value = '';
                syncBudgetModeUI();

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
            applyDialogMode(DIALOG_MODE.PLANT_EDIT);
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
            applyDialogMode(DIALOG_MODE.VARIETY_ADD);
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

            applyDialogMode(DIALOG_MODE.VARIETY_EDIT);
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
                        currentVarietyRow = toPlainDict(await PlantVarietyModel.loadById(newVid));
                        await refreshVarietyDropdown(pid, newVid);
                        varietySel.value = String(newVid);
                        applyDialogMode(DIALOG_MODE.VARIETY_EDIT);
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

                const default_planting_method_raw = normId(defaultMethodSel.value);
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
                applyDialogMode(DIALOG_MODE.PLANT_EDIT);
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
                    );
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





















































    function computeScheduleResult(inputs) {
        const { plant, methodId } = inputs;
        const method = methodId;
        const startDate = parseISODateUTCValue(inputs.startISO); // FIX: perennial results do not initialize GDD-derived state
        if (!startDate) {
            throw new Error('Select a planting date.'); // FIX: empty no-window state must not become an invalid Date
        }

        if (isPerennialPlant(plant)) { // FIX: lifespan-only perennials do not require maturity or GDD
            const lifespanYears = requirePerennialLifespanYears(plant);
            const lifespanStartISO = fmtISO(startDate);
            const lifespanEndISO = computePerennialLifespanEndISO(
                lifespanStartISO,
                inputs.seasonStartYear,
                lifespanYears
            );
            const timeline = {
                sow: new Date(startDate),
                germ: null,
                transplant: null,
                maturity: null,
                harvestStart: null,
                harvestEnd: null
            }; // FIX: lifespan-only results carry no annual stage assumptions

            return {
                kind: 'perennial', // FIX: discriminate lifecycle result shapes
                harvestEndSemantics: HARVEST_END_SEMANTICS,
                plant,
                method,
                schedule: [new Date(startDate)],
                timelines: [timeline],
                rows: [{
                    plant: plant.plant_name,
                    method,
                    sow: fmtISO(startDate),
                    germ: fmtISO(timeline.germ),
                    trans: fmtISO(timeline.transplant),
                    harvStart: '',
                    harvEnd: '',
                    mult: '',
                    plantsReq: ''
                }],
                firstScheduledHarvestISO: null,
                lastScheduledHarvestEndISO: null,
                lifespanStartISO,
                lifespanEndISO
            };
        }

        const { seasonEnd, env, dailyRates } = inputs.derived(); // FIX: annual-only maturity inputs
        const planner = new Planner(inputs);
        const feasibility = planner.isSowFeasible(startDate);
        if (!feasibility.ok) {
            throw new Error(`Selected sow date is not feasible: ${humanFeasibilityReason(feasibility.reason)}`);
        }
    
        const budget = plant.firstHarvestBudget();
        if (!budget || !Number.isFinite(budget.amount) || budget.amount <= 0) {
            throw new Error("Invalid maturity budget for " + plant.plant_name);
        }
    
        const schedule = [startDate];
    
        const stageDays = {
            maturityDays: Number.isFinite(Number(plant.days_maturity)) && Number(plant.days_maturity) > 0
                ? Number(plant.days_maturity)
                : (budget.mode === "days" ? Number(budget.amount) : 0),
            transplantDays: Number.isFinite(Number(plant.days_transplant)) ? Number(plant.days_transplant) : 0,
            germinationDays: finiteNumberOrNull(plant.days_germ), // FIX: preserve missing versus explicit zero days
            harvest_window_days: resolveHarvestWindowDays(inputs.harvestWindowDays, plant) // FIX: use the canonical fallback
        };
    
        const timelines = computeStageTimelineForSchedule({
            schedule,
            budget,
            stageDays,
            dailyRatesMap: dailyRates,
            seasonEnd,
            planningMode: inputs.planningMode
        });
    
        const authoritativeTimeline = timelines[0];
        authoritativeTimeline.maturity = new Date(feasibility.maturity);
        authoritativeTimeline.harvestStart = new Date(feasibility.harvestStart);
        authoritativeTimeline.harvestEnd = new Date(feasibility.harvestEnd);

        const yieldMultipliers = [
            thermalYieldFactor(feasibility.TmeanHarvest, env)
        ];

        const minYieldMultiplier = finiteNumberOrNull(inputs.minYieldMultiplier) ?? 0;
        if (yieldMultipliers[0] < minYieldMultiplier) {
            throw new Error(
                `Selected sow date yield multiplier ${yieldMultipliers[0].toFixed(2)} ` +
                `is below the minimum ${minYieldMultiplier.toFixed(2)}.`
            );
        }
    
        const rows = schedule.map((sowDate, idx) => {
            const tl = timelines[idx] || {};
            const mult = Number.isFinite(Number(yieldMultipliers[idx])) ? Number(yieldMultipliers[idx]) : 1;
    
            return {
                plant: plant.plant_name,
                method,
                sow: fmtISO(sowDate),
                germ: fmtISO(tl.germ),
                trans: fmtISO(tl.transplant),
                harvStart: fmtISO(tl.harvestStart),
                harvEnd: fmtISO(tl.harvestEnd),
                mult: mult.toFixed(2),
                plantsReq: ""
            };
        });
    
        return {
            kind: 'annual', // FIX: discriminate lifecycle result shapes
            harvestEndSemantics: HARVEST_END_SEMANTICS,
            plant,
            method,
            schedule,
            timelines,
            rows,
            firstScheduledHarvestISO: timelines[0]?.harvestStart ? fmtISO(timelines[0].harvestStart) : null,
            lastScheduledHarvestEndISO: timelines.length ? fmtISO(timelines[timelines.length - 1]?.harvestEnd) : null
        };
    }










    // -------------------- Dialog builder ---------------------------------------------------
    async function buildScheduleDialog(ui, cell, plants, cities, onSubmit, options) {
        let plantsLocal = Array.isArray(plants) ? plants.slice() : [];
        const {
            selectedPlant: initialPlant,
            earliestFeasibleSowDate,
            lastHarvestDate,
            startNote,
            initialCityName = '',
            hasPersistedSchedule: initialHasPersistedSchedule = false,
            initialWindowFeasible = false
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
        div.style.width = '100%';
        div.style.maxWidth = '96vw';
        div.style.boxSizing = 'border-box';

        const summaryView = renderScheduleSummary();
        div.appendChild(summaryView.root);

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
            });
        }

        const inlineButton = (label, onClick) => {
            const b = mxUtils.button(label, async () => { clearErrorInline(); await onClick(); });
            b.style.marginLeft = '8px';
            return b;
        };

        const contextSection = makeSection('Context');
        const plantSection = makeSection('Crop');
        const windowSection = makeSection('Feasibility');
        const timelineSection = makeSection('Timeline');
        const inputsSection = makeSection('Planting');
        const harvestSection = makeSection('Harvest');

        const contentGrid = document.createElement('div');
        contentGrid.style.display = 'grid';
        contentGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(360px, 1fr))';
        contentGrid.style.gap = '16px';

        const leftColumn = document.createElement('div');
        const rightColumn = document.createElement('div');
        leftColumn.appendChild(plantSection.wrap);
        leftColumn.appendChild(contextSection.wrap);
        leftColumn.appendChild(inputsSection.wrap);
        rightColumn.appendChild(windowSection.wrap);
        rightColumn.appendChild(timelineSection.wrap);
        rightColumn.appendChild(harvestSection.wrap);
        contentGrid.appendChild(leftColumn);
        contentGrid.appendChild(rightColumn);
        div.appendChild(contentGrid);

        const advancedDetails = document.createElement('details');
        advancedDetails.style.marginTop = '14px';
        advancedDetails.style.borderTop = '1px solid #d1d5db';
        const advancedSummary = document.createElement('summary');
        advancedSummary.textContent = 'Advanced';
        advancedSummary.style.cursor = 'pointer';
        advancedSummary.style.fontWeight = '600';
        advancedSummary.style.padding = '10px 0 6px';
        const advancedBody = document.createElement('div');
        advancedDetails.appendChild(advancedSummary);
        advancedDetails.appendChild(advancedBody);
        div.appendChild(advancedDetails);

        function styleCompactActionButton(btn) {
            btn.style.marginLeft = '0';
            btn.style.minWidth = '28px';
            btn.style.padding = '4px 8px';
            btn.style.lineHeight = '1.2';
            return btn;
        }

        function makeSection(title) {
            const wrap = document.createElement('div');
            wrap.className = 'usl-scheduler-section';
            wrap.style.marginTop = '12px';

            const heading = document.createElement('div');
            heading.className = 'usl-scheduler-section-heading';
            heading.textContent = title;
            heading.style.fontWeight = '600';
            heading.style.fontSize = '13px';
            heading.style.padding = '0 0 6px 0';
            heading.style.borderBottom = '1px solid #d1d5db';
            heading.style.marginBottom = '8px';

            const body = document.createElement('div');
            body.className = 'usl-scheduler-section-body';
            wrap.appendChild(heading);
            wrap.appendChild(body);

            return { wrap, body };
        }

        function makeDisplayField(initialValue = '', opts = {}) {
            const el = document.createElement('div');
            el.textContent = initialValue || '';
            el.style.width = '100%';
            el.style.boxSizing = 'border-box';
            el.style.padding = opts.emphasis ? '8px 10px' : '6px 8px';
            el.style.minHeight = opts.emphasis ? '36px' : '32px';
            el.style.border = '1px solid #d1d5db';
            el.style.background = opts.emphasis ? '#eef6ff' : '#f3f4f6';
            el.style.color = '#374151';
            el.style.borderRadius = '4px';
            el.style.display = 'flex';
            el.style.alignItems = 'center';
            if (opts.emphasis) {
                el.style.fontWeight = '600';
                el.style.fontSize = '14px';
                el.style.borderColor = '#93c5fd';
            }
            return el;
        }

        function setDisplayFieldValue(el, value) {
            el.textContent = value || '';
        }

        function fmtShortDate(iso) {
            if (!iso) return '';
            const d = new Date(iso + 'T00:00:00Z');
            return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
        }

        function parseISODateUTC(iso) {
            if (!iso) return null;
            const d = new Date(iso + 'T00:00:00Z');
            return Number.isNaN(d.getTime()) ? null : d;
        }

        function daysBetweenUTC(a, b) {
            const ms = 24 * 60 * 60 * 1000;
            return Math.round((b.getTime() - a.getTime()) / ms);
        }

        // Plant selector
        const plantOpts = (plantsLocal || []).map(p => ({ value: String(p.plant_id), label: p.plant_name + (p.abbr ? ` (${p.abbr})` : '') }));
        const plantSel = makeSelect(plantOpts, plantOpts[0]?.value);

        const plantControlsWrap = document.createElement('div');
        plantControlsWrap.style.display = 'flex';
        plantControlsWrap.style.gap = '8px';
        plantControlsWrap.style.alignItems = 'center';
        plantControlsWrap.appendChild(plantSel);

        const addPlantBtn = styleCompactActionButton(inlineButton('+', async () => {
            try {
                const saved = await openPlantEditorDialog(ui, { mode: 'add', plantId: null, varietyId: null });
                if (!saved) return;

                await reloadPlantsList();
                plantSel.value = String(saved.plant_id);
                await handleSchedulePlantChange(); // FIX: await the async selection workflow directly
            } catch (e) {
                showErrorInline('Add plant error: ' + (e?.message || String(e)));
            }
        }));

        const editPlantBtn = styleCompactActionButton(inlineButton('Edit', async () => {
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
        }));

        plantControlsWrap.appendChild(addPlantBtn);
        plantControlsWrap.appendChild(editPlantBtn);

        const plantSelectRow = row('Plant:', plantControlsWrap);
        plantSection.body.appendChild(plantSelectRow.row);

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

        const plantNameSpan = document.createElement('span');
        plantNameSpan.textContent = selPlant.plant_name;

        // Variety selector + Add button                                       
        const varietySel = document.createElement('select');
        varietySel.style.width = '100%';
        varietySel.style.padding = '6px';

        const varietyControlsWrap = document.createElement('div');
        varietyControlsWrap.style.display = 'flex';
        varietyControlsWrap.style.gap = '8px';
        varietyControlsWrap.style.alignItems = 'center';
        varietyControlsWrap.appendChild(varietySel);

        const addVarietyBtn = styleCompactActionButton(inlineButton('+', async () => {
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
        }));

        varietyControlsWrap.appendChild(addVarietyBtn);

        const editVarietyBtn = styleCompactActionButton(inlineButton('Edit', async () => {
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
        }));

        varietyControlsWrap.appendChild(editVarietyBtn);

        const varietyRow = row('Variety:', varietyControlsWrap);
        plantSection.body.appendChild(varietyRow.row);

        const varietyStatus = document.createElement('div');
        varietyStatus.style.fontSize = '12px';
        varietyStatus.style.color = '#92400e';
        varietyStatus.style.marginTop = '4px';
        varietyStatus.textContent = '';
        plantSection.body.appendChild(varietyStatus);

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
        const cityOpts = cities.map(c => ({ value: c.city_name, label: c.city_name }));
        const cityValue = cityOpts.some(o => o.value === initialCityName)
            ? initialCityName
            : cityOpts[0]?.value;
        const citySel = makeSelect(cityOpts, cityValue);

        // base method select (allowed per plant)
        const methodCategorySel = document.createElement('select');
        methodCategorySel.style.width = '100%';
        methodCategorySel.style.padding = '6px';
        methodCategorySel.style.display = 'none';

        // method select (filtered by method)
        const methodSel = document.createElement('select');
        methodSel.style.width = '100%';
        methodSel.style.padding = '6px';
        methodSel.style.display = 'none';

        const combinedMethodSel = document.createElement('select');
        combinedMethodSel.style.width = '100%';
        combinedMethodSel.style.padding = '6px';

        let currentAllowedMethodCategories = [];   // [{method_category_id, method_category_name}]  
        let currentMethods = [];                  // [{method_id, method_name, method_category_id, ...}] 
        const currentMethodsByCategory = new Map();

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
                });
            }

            currentAllowedMethodCategories = []; // FIX: expose only categories containing a supported method
            currentMethodsByCategory.clear();
            for (const categoryRow of (loadedCategories || [])) {
                const methodCategoryId = normId(categoryRow?.method_category_id);
                if (!methodCategoryId) continue;
                try {
                    const methods = await PlantModel.listMethodsForMethodCategory(methodCategoryId);
                    const validMethods = (methods || []).filter(methodRow => {
                        try {
                            resolveValidMethodRecord(methodRow, methodCategoryId);
                            return true;
                        } catch (_) {
                            return false;
                        }
                    });
                    if (validMethods.length) {
                        currentAllowedMethodCategories.push(categoryRow);
                        currentMethodsByCategory.set(methodCategoryId, validMethods);
                    }
                } catch (e) {
                    console.warn('[Scheduler] Skipping method category option', {
                        plantId: pid,
                        methodCategoryId,
                        reason: e?.message || String(e)
                    });
                }
            }

            if (!currentAllowedMethodCategories.length) {
                currentAllowedMethodCategories = [{
                    method_category_id: 'direct_sow',
                    method_category_name: 'Direct sow'
                }]; // FIX: retain the canonical hard fallback in the dialog
                currentMethodsByCategory.set('direct_sow', [{
                    method_category_id: 'direct_sow',
                    method_id: 'direct_sow.field',
                    method_name: 'Field direct sow'
                }]);
            }

            const opts = (currentAllowedMethodCategories || []).map(mc => ({
                value: normId(mc.method_category_id),
                label: String(mc.method_category_name || mc.method_category_id || '').trim()
            })).filter(o => o.value);

            // Optional but recommended: allow blank selection
            const withBlank = [{ value: '', label: '' }].concat(opts);

            const preferred = normId(preferMethodCategoryId);
            const hasPreferred = preferred && withBlank.some(o => o.value === preferred);

            const desired = hasPreferred ? preferred : (opts[0]?.value ?? '');

            setSelectOptions(methodCategorySel, withBlank, desired);
        }


        async function resetMethodOptionsForMethodCategory(methodCategoryId, { preferMethodId = null } = {}) {
            const mcid = normId(methodCategoryId);
            let loadedMethods = currentMethodsByCategory.get(mcid) || [];
            if (!loadedMethods.length) {
                try {
                    loadedMethods = mcid
                        ? await PlantModel.listMethodsForMethodCategory(mcid)
                        : [];
                } catch (e) {
                    console.warn('[Scheduler] Falling back after method load failure', {
                        methodCategoryId: mcid,
                        reason: e?.message || String(e)
                    });
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
            if (mcid && currentMethods.length) currentMethodsByCategory.set(mcid, currentMethods);

            const opts = (currentMethods || []).map(m => ({
                value: normId(m.method_id),
                label: String(m.method_name || m.method_id || '').trim()
            })).filter(o => o.value);

            const withBlank = [{ value: '', label: '' }].concat(opts);

            const preferred = normId(preferMethodId);
            const hasPreferred = preferred && withBlank.some(o => o.value === preferred);

            const desired = hasPreferred ? preferred : (opts[0]?.value ?? '');

            setSelectOptions(methodSel, withBlank, desired);
        }

        function syncCombinedMethodControl() {
            const desiredValue = encodeMethodSelection(methodCategorySel.value, methodSel.value);
            combinedMethodSel.innerHTML = '';
            currentAllowedMethodCategories.forEach(category => {
                const methodCategoryId = normId(category?.method_category_id);
                const methods = currentMethodsByCategory.get(methodCategoryId) || [];
                if (!methodCategoryId || !methods.length) return;
                const group = document.createElement('optgroup');
                group.label = String(category?.method_category_name || methodCategoryId);
                methods.forEach(method => {
                    const methodId = normId(method?.method_id);
                    if (!methodId) return;
                    const option = document.createElement('option');
                    option.value = encodeMethodSelection(methodCategoryId, methodId);
                    option.textContent = String(method?.method_name || methodId);
                    group.appendChild(option);
                });
                if (group.children.length) combinedMethodSel.appendChild(group);
            });
            if (Array.from(combinedMethodSel.options).some(option => option.value === desiredValue)) {
                combinedMethodSel.value = desiredValue;
            } else if (combinedMethodSel.options[0]) {
                combinedMethodSel.selectedIndex = 0;
            }
            const selected = decodeMethodSelection(combinedMethodSel.value);
            if (selected) {
                methodCategorySel.value = selected.methodCategoryId;
                methodSel.value = selected.methodId;
            }
        }


        // Prefill method category + method from existing cell attrs
        const cellMethodCategoryId0 = (() => {
            const raw = cell?.getAttribute?.('method_category_id');
            const s = String(raw ?? '').trim();
            return normId(s) || null;
        })();

        const cellMethodId0 = (() => {
            const raw = cell?.getAttribute?.('method_id')
            const s = String(raw ?? '').trim();
            return normId(s) || null;
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
        syncCombinedMethodControl();

        // Start/End inputs + auto buttons
        const initialStartISO = fmtISO(earliestFeasibleSowDate); // FIX: allow an explicitly empty no-window state
        const initialEndISO = fmtISO(lastHarvestDate);

        // Read-only auto-computed bounds                                         
        const autoEarliestInput = makeDisplayField(initialStartISO);
        const autoLastSowInput = makeDisplayField(initialStartISO);

        // User-controlled first sow date (used for schedule startISO)                   
        const startInput = makeDate(initialStartISO, false);

        // Auto-computed season end constraint (read-only for annuals, editable for perennials)
        const seasonEndInput = makeDate(initialEndISO, true);

        const harvestStartInput = makeDisplayField('', { emphasis: true });
        const harvestEndInput = makeDisplayField(initialEndISO);
        const daysToFirstHarvestInput = makeDisplayField('');
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
            ?? (new Date()).getUTCFullYear();
        const seasonYearInput = makeNumber(seasonStartYear0, { min: 1900 });
        seasonYearInput.step = '1';

        let taskTemplate = null;
        let taskRules = Array.isArray(taskTemplate?.rules) ? [...taskTemplate.rules] : [];
        // --- task reset helpers ----------------------------------------------------   
        let taskDirty = false;
        let taskTemplateResetRequested = false;
        let plantDefaultTaskDeleteRequested = false;

        const saveDefaultChk = makeCheckbox(false);

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
            cityName: citySel.value,

            // keep both (methodCategoryId is for UI + filtering; methodId is the scheduler “method” everywhere)
            methodCategoryId: methodCategorySel.value,
            methodId: methodSel.value,

            startISO: startInput.value,
            seasonEndISO: seasonEndInput.value,
            seasonStartYear: Number(seasonYearInput.value || (new Date()).getUTCFullYear()),
            harvestWindowDays: (harvestWindowInput.value === '' ? null : Number(harvestWindowInput.value)),
            minYieldMultiplier: Number(minYieldMultInput.value || 0),
            autoEarliestISO: initialStartISO,
            lastFeasibleSowISO: null,
            windowFeasible: mode.perennial || !!initialWindowFeasible,
            firstHarvestISO: null,
            lastHarvestISO: initialEndISO,
            lastHarvestSource: 'auto'
        };


        function syncStateFromControls() {
            formState.plantId = Number(plantSel.value);
            formState.varietyId = (varietySel && varietySel.value) ? Number(varietySel.value) : null;
            formState.cityName = citySel.value;

            formState.methodCategoryId = normId(methodCategorySel.value);
            formState.methodId = normId(methodSel.value);

            formState.startISO = startInput.value;
            formState.seasonEndISO = seasonEndInput.value;
            formState.seasonStartYear = Number(seasonYearInput.value || (new Date()).getUTCFullYear());
            formState.harvestWindowDays = (harvestWindowInput.value === '' ? null : Number(harvestWindowInput.value));
            formState.minYieldMultiplier = Number(minYieldMultInput.value || 0);
        }


        function syncControlsFromState({ start = false, end = false, harvest = false } = {}) {
            if (start) {
                startInput.value = formState.startISO || ''; // FIX: clear fabricated or stale auto dates
            }
            if (end) {
                seasonEndInput.value = formState.seasonEndISO || '';
            }
            if (harvest) {
                if (harvestStartInput) {
                    setDisplayFieldValue(harvestStartInput, formState.firstHarvestISO || '');
                }
                if (harvestEndInput) {
                    setDisplayFieldValue(harvestEndInput, formState.lastHarvestISO || '');
                }
            }
            updateDaysToFirstHarvest();
            updateScheduleSummaryFromState();
        }

        function syncStartDateBounds() {
            if (!startInput) return;
            startInput.min = formState.autoEarliestISO || '';
            startInput.max = formState.lastFeasibleSowISO || '';
        }

        function updateDaysToFirstHarvest() {
            const sow = parseISODateUTC(formState.startISO);
            const harvest = parseISODateUTC(formState.firstHarvestISO);

            if (!sow || !harvest) {
                setDisplayFieldValue(daysToFirstHarvestInput, '');
                return;
            }

            const dtm = daysBetweenUTC(sow, harvest);
            setDisplayFieldValue(daysToFirstHarvestInput, String(dtm));
        }

        // -------------------- Form schema for simple labeled fields ---------------- 
        const FIELD_SCHEMA = [
            { key: 'seasonStartYear', label: 'Season start year:', control: seasonYearInput },
            { key: 'cityName', label: 'City:', control: citySel },
            { key: 'methodSelection', label: 'Planting method:', control: combinedMethodSel },
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
        syncCombinedMethodControl();


        const autoEarliestRowObj = row('Earliest feasible sow:', autoEarliestInput);
        const autoLastSowRowObj = row('Latest feasible sow:', autoLastSowInput);

        const firstSowRowObj = row('Sow date:', startInput);
        if (startNote) firstSowRowObj.row.appendChild(startNoteSpan);

        const endRow = row('Recommended harvest end:', seasonEndInput);
        const harvestStartRowObj = row('Expected first harvest:', harvestStartInput);
        const harvestEndRowObj = row('Expected harvest end:', harvestEndInput);
        const daysToFirstHarvestRowObj = row('Days to first harvest:', daysToFirstHarvestInput);

        appendFieldRows(contextSection.body, fieldRows, ['seasonStartYear', 'cityName', 'methodSelection']);
        const legacyMethodControls = document.createElement('div');
        legacyMethodControls.style.display = 'none';
        legacyMethodControls.appendChild(methodCategorySel);
        legacyMethodControls.appendChild(methodSel);
        contextSection.body.appendChild(legacyMethodControls);

        windowSection.body.appendChild(autoEarliestRowObj.row);
        windowSection.body.appendChild(autoLastSowRowObj.row);
        windowSection.body.appendChild(endRow.row);

        inputsSection.body.appendChild(firstSowRowObj.row);
        appendFieldRows(advancedBody, fieldRows, ['harvestWindowDays', 'minYieldMultiplier']);

        harvestSection.body.appendChild(harvestStartRowObj.row);
        harvestSection.body.appendChild(harvestEndRowObj.row);
        harvestSection.body.appendChild(daysToFirstHarvestRowObj.row);

        const baseStartNote = startNote || '';
        let windowActions = null; // FIX: mode rendering owns perennial-only action visibility

        function updateScheduleSummaryFromState() {
            const varietyOption = varietySel?.selectedOptions?.[0];
            const varietyName = varietySel?.value ? String(varietyOption?.textContent || '').trim() : '';
            const methodName = String(combinedMethodSel?.selectedOptions?.[0]?.textContent || '').trim();
            updateScheduleSummary(summaryView, buildScheduleViewState({
                perennial: mode.perennial,
                windowFeasible: formState.windowFeasible,
                plantName: effectivePlant?.plant_name || selPlant?.plant_name || '',
                varietyName,
                cityName: formState.cityName,
                seasonStartYear: formState.seasonStartYear,
                methodName,
                startISO: formState.startISO,
                earliestISO: formState.autoEarliestISO,
                latestISO: formState.lastFeasibleSowISO,
                firstHarvestISO: formState.firstHarvestISO,
                lastHarvestISO: formState.lastHarvestISO
            }));
        }

        function applyModeToUI() {
            const perennial = mode.perennial;

            if (perennial) {
                firstSowRowObj.label.textContent = 'Planting date:';
                endRow.label.textContent = 'Lifespan end:';
                harvestStartRowObj.row.style.display = 'none';
                harvestEndRowObj.row.style.display = 'none';
                daysToFirstHarvestRowObj.row.style.display = 'none';
            } else {
                firstSowRowObj.label.textContent = 'Sow date:';
                endRow.label.textContent = 'Recommended harvest end:';
                harvestStartRowObj.row.style.display = '';
                harvestEndRowObj.row.style.display = '';
                daysToFirstHarvestRowObj.row.style.display = '';
            }

            autoEarliestRowObj.row.style.display = perennial ? 'none' : '';
            autoLastSowRowObj.row.style.display = perennial ? 'none' : '';
            timelineSection.wrap.style.display = perennial ? 'none' : '';
            if (windowActions) windowActions.style.display = perennial ? 'none' : '';

            seasonEndInput.disabled = !perennial;
            updateScheduleSummaryFromState();
        }


        function updateStartNote() {
            if (!startNoteSpan) return;
            const classification = classifySelectedSowDate({
                perennial: mode.perennial,
                windowFeasible: formState.windowFeasible,
                startISO: formState.startISO,
                earliestISO: formState.autoEarliestISO,
                latestISO: formState.lastFeasibleSowISO
            });
            const parts = [];
            if (!mode.perennial && classification.status !== 'feasible') parts.push(classification.label);
            if (baseStartNote && classification.status === 'no_window' && baseStartNote !== 'No feasible window.') parts.push(baseStartNote);

            startNoteSpan.textContent = parts.join(' ');
        }


        // recomputeAnchors:
        //  - concern: climate feasibility window (earliest sow, last feasible sow, climate last harvest)
        //  - does NOT decide scheduling or yield
        //  - allowed to change seasonEndISO ONLY when called with forceWriteEnd=true
        async function recomputeAnchors(forceWriteStart = false, forceWriteEnd = false) {
            try {
                if (mode.perennial) return true; // FIX: lifespan dates are recomputed by recomputeAll

                syncStateFromControls();

                await refreshEffectivePlant();
                const p = effectivePlant;


                const city = await CityClimate.loadByName(formState.cityName);
                if (!city) throw new Error(`City not found: ${formState.cityName}`);

                const seasonStartYear = formState.seasonStartYear;

                const env = p.cropTempEnvelope();
                const dailyRates = city.dailyRates(env.Tbase, seasonStartYear);
                const monthlyAvgTemp = city.monthlyMeans();
                const budget = p.firstHarvestBudget();

                const HW_DAYS = resolveHarvestWindowDays(formState.harvestWindowDays, p); // FIX: use the canonical fallback

                const overwinterAllowed = isCrossYearCrop(p); // FIX: biennials may harvest in a later year
                const scanStart = asUTCDate(seasonStartYear, 1, 1);
                const scanEndYear = seasonStartYear + getPlantScanYears(p) - 1; // FIX: honor biennial and perennial lifespans
                const scanEndHard = asUTCDate(scanEndYear, 12, 31);

                const soilGateThresholdC = (Number.isFinite(Number(p.soil_temp_min_plant_c))
                    ? Number(p.soil_temp_min_plant_c)
                    : null);

                const methodCategoryId = normId(formState.methodCategoryId);
                const methodId = normId(formState.methodId);
                const daysTransplant = Number.isFinite(Number(p.days_transplant)) ? Number(p.days_transplant) : 0;

                const lsf = pickFrostByRisk(city, 'p50');

                const r = computeAutoStartEndWindowForward({
                    methodCategoryId,
                    methodId,
                    budget,
                    HW_DAYS,
                    dailyRatesMap: dailyRates,
                    monthlyAvgTemp,
                    Tbase: env.Tbase,
                    cropTemp: env,
                    scanStart,
                    scanEndHard,
                    soilGateThresholdC,
                    soilGateConsecutiveDays: 3,
                    startCoolingThresholdC: asCoolingThresholdC(p.start_cooling_threshold_c),
                    useSpringFrostGate: true, // FIX: overwinter support does not disable field frost checks
                    lastSpringFrostDOY: lsf,
                    daysTransplant,
                    overwinterAllowed,
                });

                console.log('[recomputeAnchors] result', {
                    forceWriteStart,
                    forceWriteEnd,
                    startISO_before: formState.startISO,
                    seasonEndISO_before: formState.seasonEndISO,
                    earliestFeasibleSowDate: fmtISO(r.earliestFeasibleSowDate),
                    climateEndDate: r.climateEndDate ? fmtISO(r.climateEndDate) : null,
                    lastFeasibleSowDate: r.lastFeasibleSowDate ? fmtISO(r.lastFeasibleSowDate) : null
                });

                const windowFeasible = r.feasible === true;
                const autoStartISO = windowFeasible
                    ? r.earliestFeasibleSowDate.toISOString().slice(0, 10)
                    : null;
                const lastSowISO = r.lastFeasibleSowDate ? r.lastFeasibleSowDate.toISOString().slice(0, 10) : null;

                const autoHarvestISO = r.climateEndDate
                    ? r.climateEndDate.toISOString().slice(0, 10)
                    : null;

                // Store auto window (for display/guidance)                          
                formState.autoEarliestISO = autoStartISO;
                formState.lastFeasibleSowISO = lastSowISO;
                formState.windowFeasible = windowFeasible;
                formState.firstHarvestISO = null;
                formState.lastHarvestISO = autoHarvestISO;

                // Optionally reset user-chosen first sow date to earliest           
                const preserveGenuineStart = hasPersistedSchedule || userEditedStartThisSession;
                formState.startISO = resolveStartAfterWindow({
                    currentStartISO: formState.startISO,
                    autoStartISO,
                    feasible: windowFeasible,
                    forceWriteStart,
                    hasPersistedSchedule,
                    userEditedStartThisSession
                });
                if (windowFeasible && forceWriteStart) {
                    hasPersistedSchedule = false; // FIX: the replacement is generated, not the stored schedule
                    userEditedStartThisSession = false;
                }

                // let auto window drive season end when requested                      
                if (windowFeasible && forceWriteEnd && r.climateEndDate instanceof Date) {
                    formState.seasonEndISO = r.climateEndDate.toISOString().slice(0, 10);
                } else if (!windowFeasible) {
                    formState.seasonEndISO = ''; // FIX: clear derived end state when the window is infeasible
                }

                // Push values to the read-only controls                              
                if (autoEarliestInput) {
                    setDisplayFieldValue(
                        autoEarliestInput,
                        windowFeasible ? formState.autoEarliestISO : 'No feasible window.'
                    );
                }
                if (autoLastSowInput) {
                    setDisplayFieldValue(autoLastSowInput, formState.lastFeasibleSowISO || '');
                }

                syncControlsFromState({
                    start: forceWriteStart || !preserveGenuineStart || !windowFeasible,
                    end: forceWriteEnd || !windowFeasible,
                    harvest: true
                });

                updateStartNote();
                syncStartDateBounds();
                if (!windowFeasible) {
                    clearComputedHarvestResult();
                    showErrorInline('No feasible window.');
                    return false;
                }
                return true; // FIX: allow dependent recomputation only after valid anchors
            } catch (e) {
                console.warn('recomputeAnchors error:', e);
                clearComputedHarvestResult(); // FIX: anchor failure invalidates all schedule-derived harvest state
                showErrorInline('Scheduling error: ' + (e?.message || String(e)));
                return false;
            }
        }

        // --- mode switcher (annual <-> perennial) ---
        function computePerennialEndISO(fromISO, lifespanYears) {
            return computePerennialLifespanEndISO(
                fromISO,
                Number(seasonYearInput.value),
                lifespanYears
            );
        }

        function setPerennialMode(on, plant) {
            mode = getModeForPlant(plant);

            if (mode.perennial) {
                const lifespanYears = requirePerennialLifespanYears(plant);
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
                formState.firstHarvestISO = null;
                formState.lastHarvestISO = null; // FIX: lifespan end is not a harvest date
                formState.lastScheduleEndISO = formState.seasonEndISO;
                syncStateFromControls();
                formState.windowFeasible = true;

            } else {
                // Non-perennial: reset HW default and clear dirty flag               
                harvestWindowInput.value = (plant?.defaultHW() ?? '').toString();
                syncStateFromControls();
            }

            applyModeToUI();
        }

        // recomputeAll:
        //  - concern: policy: when to let climate auto window override constraint
        //  - enforce: seasonEndISO may only be set in specific reasons
        async function recomputeAll(reason) {
            syncStateFromControls();

            const isPerennial = mode.perennial;

            if (isPerennial) {
                const lifespanYears = requirePerennialLifespanYears(effectivePlant);
                const endISO = computePerennialEndISO(
                    startInput.value,
                    lifespanYears
                );

                seasonEndInput.value = endISO;
                formState.seasonEndISO = endISO;

                formState.firstHarvestISO = null;
                formState.lastHarvestISO = null; // FIX: lifespan-only schedules have no inferred harvest
                formState.lastScheduleEndISO = endISO;
                formState.lastHarvestSource = 'user';
                formState.windowFeasible = true;

                if (harvestStartInput) {
                    setDisplayFieldValue(harvestStartInput, '');
                }
                if (harvestEndInput) {
                    setDisplayFieldValue(harvestEndInput, '');
                }

                updateDaysToFirstHarvest();

                syncStartDateBounds();
                updateTimeline();
                return true;
            }


            switch (reason) {

                case 'varietyChanged': {
                    if (!await recomputeAnchors(true, true)) return false;
                    await recomputeLastHarvestFromSchedule();
                    break;
                }

                case 'yearChanged': {
                    // season → refresh both start and end from feasibility
                    if (!await recomputeAnchors(true, true)) return false;

                    await recomputeLastHarvestFromSchedule();
                    break;
                }

                case 'plantChanged': {
                    // City/method/plant change → respect user sow date if dirty
                    if (!await recomputeAnchors(true, true)) return false;

                    await recomputeLastHarvestFromSchedule();
                    break;
                }

                case 'cityChanged':
                case 'methodChanged': {
                    // City/method change → keep user sow date if dirty,              
                    // but don't force end update unless you want to:                 
                    if (!await recomputeAnchors(false, false)) return false;

                    await recomputeLastHarvestFromSchedule();
                    break;
                }

                case 'startChanged':
                    // User explicitly changed first sow; keep it, but recompute schedule 
                    if (!await recomputeAnchors(false, false)) return false;
                    await recomputeLastHarvestFromSchedule();
                    break;

                case 'hwChanged': {
                    if (!await recomputeAnchors(false, false)) return false;
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
            syncStartDateBounds();
            updateStartNote();
            updateTimeline();
            return true;
        }

        const timelineWrap = document.createElement('div');
        timelineWrap.style.display = 'flex';
        timelineWrap.style.flexDirection = 'column';
        timelineWrap.style.gap = '6px';

        const timelineLabels = document.createElement('div');
        timelineLabels.style.display = 'flex';
        timelineLabels.style.justifyContent = 'space-between';
        timelineLabels.style.fontSize = '12px';
        timelineLabels.style.color = '#6b7280';

        const timelineStartLabel = document.createElement('span');
        const timelineEndLabel = document.createElement('span');
        timelineLabels.appendChild(timelineStartLabel);
        timelineLabels.appendChild(timelineEndLabel);

        const timelineBarWrap = document.createElement('div');
        timelineBarWrap.style.position = 'relative';
        timelineBarWrap.style.height = '26px';

        const timelineBar = document.createElement('div');
        timelineBar.style.position = 'absolute';
        timelineBar.style.left = '0';
        timelineBar.style.right = '0';
        timelineBar.style.top = '11px';
        timelineBar.style.height = '4px';
        timelineBar.style.background = '#d1d5db';
        timelineBar.style.borderRadius = '999px';

        const timelineMarker = document.createElement('div');
        timelineMarker.textContent = '▲';
        timelineMarker.style.position = 'absolute';
        timelineMarker.style.top = '-2px';
        timelineMarker.style.transform = 'translateX(-50%)';
        timelineMarker.style.fontSize = '14px';
        timelineMarker.style.color = '#111827';

        const timelineStatus = document.createElement('div');
        timelineStatus.style.fontSize = '12px';
        timelineStatus.style.color = '#6b7280';

        timelineBarWrap.appendChild(timelineBar);
        timelineBarWrap.appendChild(timelineMarker);
        timelineWrap.appendChild(timelineLabels);
        timelineWrap.appendChild(timelineBarWrap);
        timelineWrap.appendChild(timelineStatus);
        timelineSection.body.appendChild(timelineWrap);

        function updateTimeline() {
            const earliest = parseISODateUTC(formState.autoEarliestISO);
            const latest = parseISODateUTC(formState.lastFeasibleSowISO);
            const sow = parseISODateUTC(formState.startISO);
            const classification = classifySelectedSowDate({
                perennial: mode.perennial,
                windowFeasible: formState.windowFeasible,
                startISO: formState.startISO,
                earliestISO: formState.autoEarliestISO,
                latestISO: formState.lastFeasibleSowISO
            });

            timelineStartLabel.textContent = fmtShortDate(formState.autoEarliestISO);
            timelineEndLabel.textContent = fmtShortDate(formState.lastFeasibleSowISO);

            if (mode.perennial) {
                timelineSection.wrap.style.display = 'none';
                updateScheduleSummaryFromState();
                return;
            }

            timelineSection.wrap.style.display = '';
            if (!earliest || !latest || !sow || latest < earliest) {
                timelineLabels.style.display = 'none';
                timelineBarWrap.style.display = 'none';
                timelineStatus.style.color = '#b91c1c';
                timelineStatus.textContent = classification.label;
                updateScheduleSummaryFromState();
                return;
            }
            timelineLabels.style.display = 'flex';
            timelineBarWrap.style.display = 'block';

            const totalDays = Math.max(1, daysBetweenUTC(earliest, latest));
            const offsetDays = daysBetweenUTC(earliest, sow);
            const ratio = offsetDays / totalDays;
            const clampedRatio = Math.max(0, Math.min(1, ratio));

            timelineMarker.style.left = `${clampedRatio * 100}%`;

            const isInvalid = classification.status !== 'feasible';
            timelineMarker.style.color = isInvalid ? '#b91c1c' : '#111827';
            timelineStatus.style.color = isInvalid ? '#b91c1c' : '#6b7280';
            timelineStatus.textContent = classification.label;
            updateScheduleSummaryFromState();
        }

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
            syncCombinedMethodControl();


            formState.methodCategoryId = normId(methodCategorySel.value);
            formState.methodId = normId(methodSel.value);

            harvestWindowInput.value = (effectivePlant.defaultHW() ?? '');
            formState.harvestWindowDays = (harvestWindowInput.value === '' ? null : Number(harvestWindowInput.value));


            syncStateFromControls();

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
            syncCombinedMethodControl();

            harvestWindowInput.value = (effectivePlant.defaultHW() ?? '');
            formState.harvestWindowDays = (harvestWindowInput.value === '' ? null : Number(harvestWindowInput.value));
            await recomputeAll('varietyChanged');
            await refreshTaskTemplateFromSelection();

        }

        plantSel.addEventListener('change', () => {
            handleSchedulePlantChange().catch(e => {
                showErrorInline('Plant change error: ' + (e?.message || String(e)));
            });
        }); // FIX: delegate native changes to the awaitable handler
        varietySel.addEventListener('change', () => {
            handleScheduleVarietyChange().catch(e => {
                showErrorInline('Variety change error: ' + (e?.message || String(e)));
            });
        }); // FIX: delegate native changes to the awaitable handler


        startInput.addEventListener('input', () => {
            void runUiAsync('Date change error', async () => {
                userEditedStartThisSession = true;
                syncStateFromControls();
                if (mode.perennial) {
                    seasonEndInput.value = computePerennialEndISO(
                        startInput.value,
                        requirePerennialLifespanYears(effectivePlant)
                    );
                    formState.seasonEndISO = seasonEndInput.value;
                    updateStartNote();
                } else {
                    await recomputeAll('startChanged');
                }
            });
        });




        seasonEndInput.addEventListener('input', () => {
            void runUiAsync('Date change error', async () => {
                syncStateFromControls();
            });
        });


        seasonYearInput.addEventListener('input', () => {
            void runUiAsync('Year change error', async () => {
                await recomputeAll('yearChanged');
            });
        });

        harvestWindowInput.addEventListener('input', () => {
            void runUiAsync('Harvest window change error', async () => {
                syncStateFromControls();
                await recomputeAll('hwChanged');
                await refreshTaskTemplateFromSelection();
            });
        });

        minYieldMultInput.addEventListener('input', () => {
            void runUiAsync('Yield change error', async () => {
                syncStateFromControls();
                await recomputeLastHarvestFromSchedule();
            });
        });

        citySel.addEventListener('change', () => {
            void runUiAsync('City change error', async () => {
                await recomputeAll('cityChanged');
            });
        });

        combinedMethodSel.addEventListener('change', () => {
            void runUiAsync('Method change error', async () => {
                const selected = decodeMethodSelection(combinedMethodSel.value);
                if (!selected) throw new Error('Select a planting method.');
                methodCategorySel.value = selected.methodCategoryId;
                await resetMethodOptionsForMethodCategory(selected.methodCategoryId, {
                    preferMethodId: selected.methodId
                });
                methodSel.value = selected.methodId;
                syncCombinedMethodControl();
                syncStateFromControls();
                await recomputeAll('methodChanged');
                await refreshTaskTemplateFromSelection();
                updateTasksHeader({
                    methodCategorySel,
                    methodSel,
                    formState,
                    currentMethodSpan,
                    currentTemplateSourceSpan,
                    taskDirty,
                    taskTemplateSource
                });
            });
        });

        methodCategorySel.addEventListener('change', () => {
            void runUiAsync('Method category change error', async () => {
                syncStateFromControls();

                await resetMethodOptionsForMethodCategory(methodCategorySel.value, {
                    preferMethodId: String(formState.methodId ?? effectivePlant?.default_planting_method ?? '')
                });
                syncCombinedMethodControl();

                syncStateFromControls();

                await recomputeAll('methodChanged');
                await refreshTaskTemplateFromSelection();
                updateTasksHeader({
                    methodCategorySel,
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
            void runUiAsync('Method change error', async () => {
                syncCombinedMethodControl();
                syncStateFromControls();
                await recomputeAll('methodChanged');
                await refreshTaskTemplateFromSelection();
                updateTasksHeader({
                    methodCategorySel,
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
            formState.firstHarvestISO = null;
            formState.lastHarvestISO = null;
            formState.lastScheduleEndISO = null; // FIX: remove stale schedule-derived harvest state

            if (harvestStartInput) setDisplayFieldValue(harvestStartInput, '');
            if (harvestEndInput) setDisplayFieldValue(harvestEndInput, '');
            if (daysToFirstHarvestInput) setDisplayFieldValue(daysToFirstHarvestInput, '');
        }

        function showHarvestRecomputeFailure(message) { // FIX: keep failure cleanup and reporting atomic
            clearComputedHarvestResult();
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


                const {
                    rows,
                    firstScheduledHarvestISO,
                    lastScheduledHarvestEndISO
                } = await computeScheduleResult(inputs);

                console.log('[SCHEDULE RESULT]', {
                    rowsCount: rows?.length,
                    firstRow: rows?.[0],
                    lastRow: rows?.[rows.length - 1],
                    lastScheduledHarvestEndISO
                });

                if (!rows.length || !lastScheduledHarvestEndISO) {
                    console.log('[recomputeLastHarvestFromSchedule] no rows', {
                        startISO: formState.startISO,
                        seasonEndISO: formState.seasonEndISO,
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

                formState.firstHarvestISO = firstScheduledHarvestISO;
                formState.lastScheduleEndISO = lastScheduledHarvestEndISO;
                formState.lastHarvestISO = lastScheduledHarvestEndISO;

                if (harvestStartInput) {
                    setDisplayFieldValue(harvestStartInput, formState.firstHarvestISO || '');
                }
                if (harvestEndInput) {
                    setDisplayFieldValue(harvestEndInput, formState.lastHarvestISO || '');
                }
                updateDaysToFirstHarvest();
                clearHarvestRecomputeFailure(); // FIX: remove a prior recompute error after success

                console.log('[recomputeLastHarvestFromSchedule] scheduleEnd', {
                    lastScheduleEndISO: formState.lastScheduleEndISO
                });

            } catch (e) {
                console.warn('recomputeLastHarvestFromSchedule error:', e);
                showHarvestRecomputeFailure(e?.message || String(e)); // FIX: clear stale values and surface the calculation error
            }
        }




        const btns = document.createElement('div');
        btns.className = 'usl-scheduler-footer-actions';
        btns.style.marginTop = '12px';
        btns.style.display = 'flex';
        btns.style.justifyContent = 'flex-end';

        const explainBtn = mxUtils.button('Explain Sowing Range', async () => {
            try {
                if (mode.perennial) return; // FIX: perennials have no maturity feasibility scan
                syncStateFromControls();

                const { plant, city, inputs } = await buildScheduleContextFromForm(
                    formState,
                    selPlant,
                    { currentVarieties }
                );

                const rows = await explainFeasibilityOverSeason(inputs, 400, false);

                // include plant & city dictionaries
                const plantDict = toPlainDict(plant);
                const cityDict = toPlainDict(city);

                const header = [
                    'Plant data:',
                    JSON.stringify(plantDict, null, 2),
                    '',
                    'City data:',
                    JSON.stringify(cityDict, null, 2),
                    '',
                    'Feasibility scan:'
                ].join('\n');

                const scan = rows.map(r => JSON.stringify(r)).join('\n');
                const text = header + '\n' + scan;

                const div = document.createElement('div');
                div.style.whiteSpace = 'pre'; div.style.maxHeight = '70vh'; div.style.overflow = 'auto';
                div.style.padding = '12px'; div.textContent = text;
                ui.showDialog(div, 720, 480, true, true);



            } catch (e) { showErrorInline('Explain error: ' + e.message); }
        });

        const rightBtns = document.createElement('div');
        rightBtns.className = 'usl-scheduler-action-row';
        rightBtns.style.display = 'flex';
        rightBtns.style.gap = '8px';

        windowActions = document.createElement('div');
        windowActions.style.marginTop = '8px';
        windowActions.appendChild(explainBtn);
        advancedBody.appendChild(windowActions);

        const previewBtn = mxUtils.button('Preview', async () => {
            try {
                syncStateFromControls();
                if (!mode.perennial && !formState.windowFeasible) {
                    throw new Error('No feasible window.');
                }

                const { inputs } = await buildScheduleContextFromForm(
                    formState,
                    selPlant,
                    { currentVarieties }
                );

                const result = computeScheduleResult(inputs);
                if (result.kind === 'perennial') {
                    renderPerennialPreview(ui, result);
                    return;
                }
                const rows = result.rows;
                if (!rows.length) { showErrorInline('No feasible planting dates in the chosen season.'); return; }
                renderPreviewTable(ui, rows);
            } catch (e) { showErrorInline('Preview error: ' + e.message); }
        });


        const okBtn = mxUtils.button('Save', async () => {
            try {
                syncStateFromControls();
                if (!mode.perennial && !formState.windowFeasible) {
                    throw new Error('No feasible window.');
                }

                const { inputs } = await buildScheduleContextFromForm(
                    formState,
                    selPlant,
                    { currentVarieties }
                );

                // Build taskTemplate object from current rules
                taskTemplate = normalizeTaskTemplate({
                    version: 2,
                    rules: taskRules
                });

                // Validate the complete schedule before mutating the DB or graph.
                const scheduleResult = computeScheduleResult(inputs);

                const persistPlantTaskDefault = async () => { // FIX: run DB persistence only after graph mutation succeeds
                    if (saveDefaultChk.checked) {
                        const methodId = normId(formState.methodId);
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
                            methodId: normId(formState.methodId)
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
                    afterGraphUpdate: persistPlantTaskDefault // FIX: undo graph edits if the database write fails
                });
                ui.hideDialog();
            } catch (e) {
                showErrorInline('Scheduling error: ' + e.message);
            }
        });

        const cancelBtn = mxUtils.button('Cancel', () => ui.hideDialog());
        [previewBtn, okBtn, cancelBtn].forEach(b => rightBtns.appendChild(b));
        btns.appendChild(rightBtns);

        await recomputeAll('cityChanged');
        applyModeToUI();
        syncStartDateBounds();
        updateTimeline();


































        // ============================================================================
        // TASK TAB UI
        // ============================================================================

        // 1. Load existing OR resolve from DB fallback chain
        let taskTemplateSource = "unknown";

        const resolved = await resolveTaskTemplate({
            cell,
            plantId: formState.plantId,
            methodId: formState.methodId
        });

        taskTemplate = normalizeTaskTemplate(resolved?.template ?? null);
        taskTemplateSource = resolved?.source ?? "unknown";

        taskRules = Array.isArray(taskTemplate.rules) ? [...taskTemplate.rules] : [];

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

        const taskPreviewSection = document.createElement('div');
        taskPreviewSection.style.border = '1px solid #d1d5db';
        taskPreviewSection.style.borderRadius = '6px';
        taskPreviewSection.style.padding = '10px';
        taskPreviewSection.style.marginBottom = '12px';
        const taskPreviewTitle = document.createElement('div');
        taskPreviewTitle.textContent = 'Generated task timeline';
        taskPreviewTitle.style.fontWeight = '600';
        taskPreviewTitle.style.marginBottom = '8px';
        const taskPreviewControls = document.createElement('div');
        taskPreviewControls.style.display = 'flex';
        taskPreviewControls.style.flexWrap = 'wrap';
        taskPreviewControls.style.alignItems = 'center';
        taskPreviewControls.style.gap = '8px 16px';
        taskPreviewControls.style.marginBottom = '8px';
        const taskPreviewRuleSelectors = document.createElement('div');
        taskPreviewRuleSelectors.style.display = 'flex';
        taskPreviewRuleSelectors.style.flexWrap = 'wrap';
        taskPreviewRuleSelectors.style.gap = '6px 12px';
        const taskPreviewStatus = document.createElement('div');
        taskPreviewStatus.style.fontSize = '11px';
        taskPreviewStatus.style.color = '#6b7280';
        taskPreviewStatus.style.marginBottom = '6px';
        const taskPreviewTimeline = document.createElement('div');
        taskPreviewControls.appendChild(taskPreviewRuleSelectors);
        taskPreviewSection.appendChild(taskPreviewTitle);
        taskPreviewSection.appendChild(taskPreviewControls);
        taskPreviewSection.appendChild(taskPreviewStatus);
        taskPreviewSection.appendChild(taskPreviewTimeline);
        tasksTab.appendChild(taskPreviewSection);

        // "Add Task" button
        const addTaskBtn = mxUtils.button("Add Task", () => openTaskEditor(null, null, addTaskBtn));
        addTaskBtn.style.marginTop = "12px";
        tasksTab.appendChild(addTaskBtn);

        // List container
        const tasksListDiv = document.createElement("div");
        const previewRuleSelections = new Map();
        let generatedPreviewTasks = [];
        let taskPreviewScheduleRange = null;
        let taskPreviewCutoffOmittedRuleKeys = new Set();
        let taskPreviewVersion = 0;

        function restoreFocus(el) { // FIX: restore keyboard focus after task-list DOM updates
            setTimeout(() => {
                if (el?.isConnected && typeof el.focus === "function") el.focus();
            }, 0);
        }

        const restoreBuiltinsBtn = mxUtils.button("Restore missing built-in tasks", async () => {
            try {
                syncStateFromControls();

                const methodTpl = await getDefaultTaskTemplateForPlantingMethods(formState.methodId);
                const defaultRules = Array.isArray(methodTpl?.rules) ? methodTpl.rules : [];

                taskRules = mergeMissingCanonicalRules(taskRules, defaultRules).map(normalizeTaskRule);
                taskDirty = true;
                await refreshTasksTabUI();
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

            buildTaskRuleDisplayOrder(taskRules, generatedPreviewTasks).forEach(({ rule, originalIndex }) => {
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

                const editBtn = mxUtils.button("Edit", () => openTaskEditor(rule, originalIndex, wrap));
                const delBtn = mxUtils.button("Delete", () => {

                    const isBuiltIn = isCanonicalTaskRule(rule);
                    if (isBuiltIn) {
                        const ok = confirm("This is a built-in task for the current method. Delete it from this template?");
                        if (!ok) {
                            restoreFocus(delBtn);
                            return;
                        }
                    }

                    taskRules.splice(originalIndex, 1);
                    taskDirty = true;
                    void refreshTasksTabUI();
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

        function placeTaskEditorAfter(anchorEl) {
            if (anchorEl?.parentNode) {
                anchorEl.parentNode.insertBefore(taskEditorDiv, anchorEl.nextSibling);
            }
        }

        function selectedPreviewRuleKeys() {
            return new Set(
                Array.from(previewRuleSelections.entries())
                    .filter(([, selected]) => selected)
                    .map(([key]) => key)
            );
        }

        function renderTaskPreviewRuleSelectors() {
            const activeKeys = new Set();
            taskPreviewRuleSelectors.innerHTML = '';
            buildTaskRuleDisplayOrder(taskRules, generatedPreviewTasks).forEach(({ rule, originalIndex, key }) => {
                activeKeys.add(key);
                if (!previewRuleSelections.has(key)) previewRuleSelections.set(key, true);
                const label = document.createElement('label');
                label.style.display = 'inline-flex';
                label.style.alignItems = 'center';
                label.style.gap = '4px';
                const checkbox = makeCheckbox(previewRuleSelections.get(key));
                checkbox.addEventListener('change', () => {
                    previewRuleSelections.set(key, checkbox.checked);
                    renderCachedTaskPreview();
                });
                const text = document.createElement('span');
                text.textContent = String(rule?.title || rule?.id || `Task ${originalIndex + 1}`);
                label.appendChild(checkbox);
                label.appendChild(text);
                taskPreviewRuleSelectors.appendChild(label);
            });
            Array.from(previewRuleSelections.keys()).forEach(key => {
                if (!activeKeys.has(key)) previewRuleSelections.delete(key);
            });
        }

        function renderCachedTaskPreview({ message = '', error = '' } = {}) {
            const selectedKeys = selectedPreviewRuleKeys();
            if (!selectedKeys.size && !error) message = 'Select at least one task rule to preview.';
            const visible = updateTaskTimelinePreview({
                container: taskPreviewTimeline,
                generatedTasks: generatedPreviewTasks,
                selectedRuleKeys: selectedKeys,
                scheduleRange: taskPreviewScheduleRange,
                message,
                error
            });
            taskPreviewStatus.textContent = visible.length
                ? `${visible.length} task occurrence${visible.length === 1 ? '' : 's'} shown.`
                : '';
            const cutoffOmittedCount = Array.from(selectedKeys).filter(key => taskPreviewCutoffOmittedRuleKeys.has(key)).length;
            if (cutoffOmittedCount > 0 && !error) {
                taskPreviewStatus.textContent += `${taskPreviewStatus.textContent ? ' ' : ''}${cutoffOmittedCount} selected repeated rule${cutoffOmittedCount === 1 ? '' : 's'} omitted because the cutoff is on or before the first occurrence.`;
            }
        }

        async function updateTaskPreview() {
            const requestVersion = ++taskPreviewVersion;
            syncStateFromControls();
            renderTaskPreviewRuleSelectors();
            if (!taskRules.length) {
                generatedPreviewTasks = [];
                taskPreviewScheduleRange = null;
                taskPreviewCutoffOmittedRuleKeys = new Set();
                renderCachedTaskPreview({ message: 'No task rules are defined.' });
                return;
            }
            if (!mode.perennial && !formState.windowFeasible) {
                generatedPreviewTasks = [];
                taskPreviewScheduleRange = null;
                taskPreviewCutoffOmittedRuleKeys = new Set();
                renderCachedTaskPreview({ error: 'No feasible sowing window is available for task generation.' });
                return;
            }
            try {
                const { inputs } = await buildScheduleContextFromForm(formState, selPlant, { currentVarieties });
                const result = computeScheduleResult(inputs);
                const tasks = await buildTasksForPlan({
                    plant: result.plant,
                    schedule: result.schedule,
                    timelines: result.timelines,
                    taskTemplate: { version: 2, rules: taskRules },
                    varietyName: inputs.varietyName,
                    includePreviewMetadata: true
                });
                if (requestVersion !== taskPreviewVersion) return;
                generatedPreviewTasks = tasks;
                taskPreviewScheduleRange = resolveTaskPreviewScheduleRange(result);
                taskPreviewCutoffOmittedRuleKeys = findRepeatCutoffOmittedRuleKeys({
                    taskTemplate: { version: 2, rules: taskRules },
                    schedule: result.schedule,
                    timelines: result.timelines
                });
                renderTaskPreviewRuleSelectors();
                const selectedKeys = selectedPreviewRuleKeys();
                const generatedKeys = new Set(tasks.map(task => task.previewRuleKey));
                const selectedCutoffOmitted = Array.from(selectedKeys).filter(key => taskPreviewCutoffOmittedRuleKeys.has(key));
                const missingAnchorCount = Array.from(selectedKeys).filter(key => !generatedKeys.has(key) && !taskPreviewCutoffOmittedRuleKeys.has(key)).length;
                renderCachedTaskPreview({
                    message: tasks.length
                        ? ''
                        : (selectedCutoffOmitted.length ? 'No tasks could be generated. Repeat cutoff excluded the selected rule before its first occurrence.' : 'No tasks could be generated. Required schedule anchors may be unavailable.')
                });
                if (missingAnchorCount > 0 && tasks.length) {
                    taskPreviewStatus.textContent += ` ${missingAnchorCount} selected rule${missingAnchorCount === 1 ? '' : 's'} omitted because schedule anchors are unavailable.`;
                }
            } catch (e) {
                if (requestVersion !== taskPreviewVersion) return;
                generatedPreviewTasks = [];
                taskPreviewScheduleRange = null;
                taskPreviewCutoffOmittedRuleKeys = new Set();
                renderCachedTaskPreview({ error: `Task preview error: ${e?.message || String(e)}` });
            }
        }

        async function refreshTasksTabUI() {
            updateTasksHeader({
                methodCategorySel,
                methodSel,
                formState,
                currentMethodSpan,
                currentTemplateSourceSpan,
                taskDirty,
                taskTemplateSource
            });
            await updateTaskPreview();
            renderTasksList();
        }

        async function refreshTaskTemplateFromSelection() {
            syncStateFromControls();
            updateTasksHeader({
                methodCategorySel,
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
                methodId: formState.methodId
            });

            taskTemplate = normalizeTaskTemplate(resolved?.template ?? null);
            taskTemplateSource = resolved?.source ?? "unknown";
            taskRules = Array.isArray(taskTemplate.rules) ? [...taskTemplate.rules] : [];

            taskEditorDiv.innerHTML = '';
            renderTasksList();
            updateTasksHeader({
                methodCategorySel,
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
            methodCategorySel,
            methodSel,
            formState,
            currentMethodSpan,
            currentTemplateSourceSpan,
            taskDirty,
            taskTemplateSource
        });

        function getTaskTypeEditorOptions() {
            const graph = ui && ui.editor && ui.editor.graph;
            const model = graph && typeof graph.getModel === "function" ? graph.getModel() : null;
            const moduleCell = model ? findGardenModuleAncestor(model, cell) : null;
            const equipment = graph && graph.__trellisEquipment;
            if (!equipment || typeof equipment.readTaskTypeRegistry !== "function" || !moduleCell) {
                return { available: false, options: [{ value: "general", label: "General Task" }] };
            }
            const rows = equipment.readTaskTypeRegistry(moduleCell) || [];
            const options = rows
                .map(function (tt) { return { value: normalizeTaskTypeId(tt && tt.id), label: String(tt && (tt.name || tt.id) || "").trim() }; })
                .filter(function (tt) { return tt.value && tt.label; })
                .sort(function (a, b) { return a.label.localeCompare(b.label); });
            if (!options.length) return { available: false, options: [{ value: "general", label: "General Task" }] };
            return { available: true, options: [{ value: "", label: "Choose task type" }].concat(options) };
        }

        async function openTaskEditor(rule, index, anchorEl = null) {
            taskEditorDiv.innerHTML = "";
            placeTaskEditorAfter(anchorEl);

            const editing = !!rule;

            // --------------------------------------------------
            // Editor header
            // --------------------------------------------------
            const editorHeader = document.createElement("div");
            editorHeader.style.marginTop = "14px";
            editorHeader.style.marginBottom = "8px";
            editorHeader.style.paddingTop = "8px";
            editorHeader.style.borderTop = "1px solid #ccc";
            editorHeader.style.fontWeight = "600";
            editorHeader.textContent = editing ? "Edit task" : "Add task";

            taskEditorDiv.appendChild(editorHeader);

            const editorBody = document.createElement("div");
            editorBody.style.display = "flex";
            editorBody.style.flexDirection = "column";
            editorBody.style.gap = "8px";

            editorBody.style.background = "#fafafa";
            editorBody.style.padding = "8px";
            editorBody.style.border = "1px solid #ddd";
            editorBody.style.borderRadius = "4px";

            taskEditorDiv.appendChild(editorBody);

            const r = normalizeTaskRule(
                rule ? JSON.parse(JSON.stringify(rule)) : {
                    id: "rule_" + Date.now(),
                    title: "",
                    startAnchorStage: "SOW",
                    startOffsetDays: 0,
                    startOffsetDirection: "after",
                    endMode: "fixed_days",
                    durationDays: 1,
                    endAnchorStage: null,
                    endAnchorOffsetDays: 0,
                    endAnchorOffsetDirection: "after",
                    repeatMode: "none",
                    repeatEveryDays: 1,
                    repeatUntilMode: "x_times",
                    repeatTimes: 1,
                    repeatUntilAnchorStage: "HARVEST_END",
                    repeatCutoffOffsetDays: 0,
                    repeatCutoffOffsetDirection: "after"
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
            const customTaskRule = !isCanonicalTaskId(r.id);
            const taskTypeState = customTaskRule ? getTaskTypeEditorOptions() : null;
            const taskTypeSel = customTaskRule ? makeSelect(taskTypeState.options, r.taskTypeId || (taskTypeState.available ? "" : "general")) : null;
            if (taskTypeSel && !taskTypeState.available) taskTypeSel.disabled = true;
            const taskTypeRow = customTaskRule ? row("Task Type", taskTypeSel).row : null;

            const startOffsetNum = makeNumber(r.startOffsetDays);
            const startOffsetDir = makeSelect([
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
            const startRow = row("Start", startWrap).row;

            const endModeSel = makeSelect([
                { value: "fixed_days", label: "Fixed duration" },
                { value: "anchor_range", label: "Until anchor" }
            ], r.endMode);

            const endModeRow = row("Duration mode", endModeSel).row;

            const durationNum = makeNumber(r.durationDays ?? 1);
            const durationRow = row("Duration days", durationNum).row;

            const endAnchorOffsetNum = makeNumber(r.endAnchorOffsetDays ?? 0);
            const endAnchorOffsetDir = makeSelect([
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
            const endAnchorRow = row("End anchor", endAnchorWrap).row;

            const repeatCheck = makeCheckbox(r.repeatMode === "interval");
            const repeatModeRow = row("Repeat", repeatCheck).row;

            const repeatConfigDiv = document.createElement("div");
            repeatConfigDiv.style.marginLeft = "20px";

            const repeatEveryNum = makeNumber(r.repeatEveryDays);
            const repeatEveryRow = row("Every (days)", repeatEveryNum).row;

            const repeatUntilModeSel = makeSelect([
                { value: "x_times", label: "Repeat X total times" },
                { value: "until_anchor", label: "Repeat until anchor" }
            ], r.repeatUntilMode);
            const repeatUntilModeRow = row("Stop mode", repeatUntilModeSel).row;

            const repeatTimesNum = makeNumber(r.repeatTimes ?? 1);
            const repeatTimesRow = row("Times", repeatTimesNum).row;

            const repeatCutoffOffsetNum = makeNumber(r.repeatCutoffOffsetDays ?? 0);
            const repeatCutoffOffsetDir = makeSelect([
                { value: "before", label: "before" },
                { value: "after", label: "after" }
            ], r.repeatCutoffOffsetDirection || "after");
            const repeatUntilAnchorSel = makeSelect(
                repeatUntilStageOptions,
                r.repeatUntilAnchorStage || "HARVEST_END"
            );

            const repeatCutoffAnchorWrap = document.createElement("div");
            repeatCutoffAnchorWrap.style.display = "flex";
            repeatCutoffAnchorWrap.style.gap = "8px";
            repeatCutoffAnchorWrap.appendChild(repeatCutoffOffsetNum);
            repeatCutoffAnchorWrap.appendChild(repeatCutoffOffsetDir);
            repeatCutoffAnchorWrap.appendChild(repeatUntilAnchorSel);
            const repeatUntilAnchorRow = row("Cutoff anchor", repeatCutoffAnchorWrap).row;

            repeatConfigDiv.appendChild(repeatEveryRow);
            repeatConfigDiv.appendChild(repeatUntilModeRow);
            repeatConfigDiv.appendChild(repeatTimesRow);
            repeatConfigDiv.appendChild(repeatUntilAnchorRow);

            function setTaskEditorRowVisible(rowEl, visible) {
                rowEl.style.setProperty("display", visible ? "flex" : "none", "important");
            }

            function syncTaskEditorVisibility() {
                const endMode = endModeSel.value;
                const anchorRange = endMode === "anchor_range";
            
                setTaskEditorRowVisible(durationRow, endMode === "fixed_days");
                setTaskEditorRowVisible(endAnchorRow, anchorRange);
            
                if (anchorRange && repeatCheck.checked) {
                    repeatCheck.checked = false;
                }
                repeatCheck.disabled = anchorRange;
            
                const repeating = !anchorRange && repeatCheck.checked;
                repeatConfigDiv.style.display = repeating ? "" : "none";
            
                const untilMode = repeatUntilModeSel.value;
                setTaskEditorRowVisible(repeatTimesRow, repeating && untilMode === "x_times");
                setTaskEditorRowVisible(repeatUntilAnchorRow, repeating);
            }

            endModeSel.addEventListener("change", syncTaskEditorVisibility);
            repeatCheck.addEventListener("change", syncTaskEditorVisibility);
            repeatUntilModeSel.addEventListener("change", syncTaskEditorVisibility);

            editorBody.appendChild(titleRow);
            if (taskTypeRow) editorBody.appendChild(taskTypeRow);
            editorBody.appendChild(startRow);
            editorBody.appendChild(endModeRow);
            editorBody.appendChild(durationRow);
            editorBody.appendChild(endAnchorRow);
            editorBody.appendChild(repeatModeRow);
            editorBody.appendChild(repeatConfigDiv);

            syncTaskEditorVisibility();

            const btnWrap = document.createElement("div");
            btnWrap.style.marginTop = "8px";
            btnWrap.style.display = "flex";
            btnWrap.style.gap = "8px";

            const saveBtn = mxUtils.button("Save", async () => {
                try {
                    r.title = titleInput.value.trim();
                    if (customTaskRule) r.taskTypeId = taskTypeSel.value || (taskTypeState.available ? "" : "general");

                    r.startOffsetDays = Number(startOffsetNum.value);
                    r.startOffsetDirection = startOffsetDir.value;
                    r.startAnchorStage = startAnchorSel.value;

                    r.endMode = endModeSel.value;
                    r.durationDays = (r.endMode === "fixed_days") ? Number(durationNum.value) : null;
                    r.endAnchorStage = (r.endMode === "anchor_range") ? endAnchorSel.value : null;
                    r.endAnchorOffsetDays = (r.endMode === "anchor_range") ? Number(endAnchorOffsetNum.value) : 0;
                    r.endAnchorOffsetDirection = (r.endMode === "anchor_range") ? endAnchorOffsetDir.value : "after";

                    r.repeatMode = (repeatCheck.checked && r.endMode === "fixed_days") ? "interval" : "none";
                    r.repeatEveryDays = Number(repeatEveryNum.value);
                    r.repeatUntilMode = repeatUntilModeSel.value;
                    r.repeatTimes = (r.repeatMode === "interval" && r.repeatUntilMode === "x_times")
                        ? Number(repeatTimesNum.value)
                        : 1;
                    r.repeatUntilAnchorStage = (r.repeatMode === "interval")
                        ? repeatUntilAnchorSel.value
                        : "HARVEST_END";
                    r.repeatCutoffOffsetDays = (r.repeatMode === "interval") ? Number(repeatCutoffOffsetNum.value) : 0;
                    r.repeatCutoffOffsetDirection = (r.repeatMode === "interval") ? repeatCutoffOffsetDir.value : "after";

                    const allowedStages = await getAllowedAnchorStagesForMethod(formState.methodId);
                    const normalized = validateTaskRule(r, { allowedStages, requireTaskType: customTaskRule });
                    try {
                        const { inputs } = await buildScheduleContextFromForm(formState, selPlant, { currentVarieties });
                        const result = computeScheduleResult(inputs);
                        validateTaskRuleAnchorOrder(normalized, { schedule: result.schedule, timelines: result.timelines });
                    } catch (orderErr) {
                        if (/^Start must/.test(String(orderErr?.message || ""))) throw orderErr;
                    }

                    if (!editing && isCanonicalTaskId(r.id)) {
                        throw new Error("Canonical task IDs are reserved.");
                    }

                    if (editing) taskRules[index] = normalized;
                    else taskRules.push(normalized);
                    taskDirty = true;

                    taskEditorDiv.innerHTML = "";
                    await refreshTasksTabUI();
                } catch (e) {
                    showErrorInline("Save task error: " + (e?.message || String(e)));
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
        const resetTasksBtn = mxUtils.button("Reset tasks to plant-default", async () => {
            try {
                syncStateFromControls();

                const methodId = normId(formState.methodId);
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
                await refreshTasksTabUI();
            } catch (e) {
                showErrorInline("Reset tasks error: " + (e?.message || String(e)));
            }
        });

        const taskDefaultsActions = document.createElement('div');
        taskDefaultsActions.style.marginTop = '10px';
        taskDefaultsActions.style.paddingTop = '10px';
        taskDefaultsActions.style.borderTop = '1px solid #d1d5db';
        taskDefaultsActions.style.display = 'flex';
        taskDefaultsActions.style.flexWrap = 'wrap';
        taskDefaultsActions.style.alignItems = 'center';
        taskDefaultsActions.style.gap = '8px';
        taskDefaultsActions.appendChild(resetTasksBtn);
        taskDefaultsActions.appendChild(restoreBuiltinsBtn);
        taskDefaultsActions.appendChild(row("Save these tasks as plant default", saveDefaultChk).row);
        tasksTab.insertBefore(taskDefaultsActions, taskEditorDiv);


        // ============================================================================
        // TABS WRAPPER
        // ============================================================================

        const tabsContainer = document.createElement("div");
        tabsContainer.className = "usl-scheduler-dialog";
        tabsContainer.style.display = "flex";
        tabsContainer.style.flexDirection = "column";
        tabsContainer.style.height = "100%";
        tabsContainer.style.maxWidth = "96vw";
        tabsContainer.style.maxHeight = "85vh";
        tabsContainer.style.overflow = "hidden";
        tabsContainer.style.boxSizing = "border-box";

        const schedulerDialogStyle = document.createElement("style");
        schedulerDialogStyle.textContent = `
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
        `;
        tabsContainer.appendChild(schedulerDialogStyle);

        const dialogHeader = document.createElement("div");
        dialogHeader.className = "usl-scheduler-header";
        const dialogTitle = document.createElement("div");
        dialogTitle.className = "usl-scheduler-title";
        dialogTitle.textContent = "Planting Scheduler";
        const dialogSubtitle = document.createElement("div");
        dialogSubtitle.className = "usl-scheduler-subtitle";
        dialogSubtitle.textContent = (effectivePlant?.plant_name || selPlant?.plant_name || "Schedule") + (hasPersistedSchedule ? " schedule" : " new schedule");
        dialogHeader.appendChild(dialogTitle);
        dialogHeader.appendChild(dialogSubtitle);

        const tabsHeader = document.createElement("div");
        tabsHeader.className = "usl-scheduler-tabs";
        tabsHeader.style.display = "flex";
        tabsHeader.style.gap = "8px";
        tabsHeader.style.marginBottom = "8px";

        const tabsBody = document.createElement("div");
        tabsBody.className = "usl-scheduler-body";
        tabsBody.style.flex = "1";
        tabsBody.style.overflow = "auto";

        function setActiveTabButton(activeButton) {
            Array.from(tabsHeader.children).forEach(button => {
                if (button && button.dataset) button.dataset.active = button === activeButton ? "true" : "false";
            });
        }

        function makeTabButton(label, targetEl) {
            const b = mxUtils.button(label, () => {
                tabsBody.innerHTML = "";
                tabsBody.appendChild(targetEl);
                setActiveTabButton(b);
            });
            b.className = "usl-scheduler-tab";
            b.style.minWidth = "100px";
            return b;
        }

        const scheduleTabBtn = makeTabButton("Schedule", div);

        const tasksTabBtn = mxUtils.button("Tasks", async () => {
            await refreshTaskTemplateFromSelection();
            await refreshTasksTabUI();
            tabsBody.innerHTML = "";
            tabsBody.appendChild(tasksTab);
            setActiveTabButton(tasksTabBtn);
        });
        tasksTabBtn.className = "usl-scheduler-tab";
        tasksTabBtn.style.minWidth = "100px";

        tabsHeader.appendChild(scheduleTabBtn);
        tabsHeader.appendChild(tasksTabBtn);
        tabsBody.appendChild(div);

        const dialogFooter = document.createElement("div");
        dialogFooter.className = "usl-scheduler-footer";
        dialogFooter.appendChild(btns);

        tabsContainer.appendChild(dialogHeader);
        tabsContainer.appendChild(tabsHeader);
        tabsContainer.appendChild(tabsBody);
        tabsContainer.appendChild(dialogFooter);

        // INITIAL RENDER
        renderTasksList();
        setActiveTabButton(scheduleTabBtn);

        ui.showDialog(tabsContainer, 1120, 720, true, true);

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
    const CANONICAL_TASK_TYPE_BY_RULE_ID = Object.freeze({
        prep: "bed_preparation",
        sow: "direct_sowing",
        start: "seedling_starting",
        harden: "hardening_off",
        transplant: "transplanting",
        thin: "thinning_check",
        harvest: "harvesting"
    });

    function isCanonicalTaskId(id) {
        return CANONICAL_TASK_IDS.includes(String(id || "").trim());
    }

    function isCanonicalTaskRule(rule) {
        return isCanonicalTaskId(rule?.id);
    }

    function normalizeTaskTypeId(value) {
        return normId(value).replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
    }

    function resolveTaskRuleTaskTypeId(rule) {
        const normalized = normalizeTaskRule(rule);
        const id = String(normalized.id || "").trim();
        if (isCanonicalTaskId(id)) return CANONICAL_TASK_TYPE_BY_RULE_ID[id] || "general";
        return normalizeTaskTypeId(normalized.taskTypeId) || "general";
    }

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

    function getAllowedAnchorStagesForPlanningMode(planningMode) {
        switch (String(planningMode || "").trim()) {
            case "direct_sow":
                return ["SOW", "GERM", "HARVEST_START", "HARVEST_END"];
            case "transplant_indoor":
            case "transplant_outdoor":
                return ["SOW", "TRANSPLANT", "HARVEST_START", "HARVEST_END"];
            default:
                return ["SOW", "GERM", "TRANSPLANT", "HARVEST_START", "HARVEST_END"];
        }
    }
    
    async function getAllowedAnchorStagesForMethod(methodId) {
        const id = normId(methodId);
    
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
        const r = { ...(rule || {}) };

        // ---------- v1 -> v2 start field migration ----------
        if (r.startAnchorStage == null && r.anchorStage != null) {
            r.startAnchorStage = r.anchorStage;
        }
        if (r.startOffsetDays == null && r.offsetDays != null) {
            r.startOffsetDays = r.offsetDays;
        }
        if (r.startOffsetDirection == null && r.offsetDirection != null) {
            r.startOffsetDirection = r.offsetDirection;
        }

        // ---------- defaults for start ----------
        r.startAnchorStage = String(r.startAnchorStage || "SOW");
        r.startOffsetDays = Number(r.startOffsetDays ?? 0);
        r.startOffsetDirection = (r.startOffsetDirection === "before") ? "before" : "after";

        // ---------- end mode ----------
        if (!r.endMode) {
            if (r.id === "harvest") {
                r.endMode = "anchor_range";
            } else {
                r.endMode = "fixed_days";
            }
        }

        if (r.endMode === "anchor_range") {
            r.durationDays = null;
            r.endAnchorStage = String(r.endAnchorStage || "HARVEST_END");
            r.endAnchorOffsetDays = Number(r.endAnchorOffsetDays ?? 0);
            r.endAnchorOffsetDirection = (r.endAnchorOffsetDirection === "before") ? "before" : "after";
        } else {
            r.endMode = "fixed_days";
            r.durationDays = Number(r.durationDays ?? 1);
            r.endAnchorStage = r.endAnchorStage ?? null;
            r.endAnchorOffsetDays = Number(r.endAnchorOffsetDays ?? 0);
            r.endAnchorOffsetDirection = (r.endAnchorOffsetDirection === "before") ? "before" : "after";
        }

        // ---------- repeat migration ----------
        if (!r.repeatMode) {
            r.repeatMode = (r.repeat === true) ? "interval" : "none";
        }
        r.repeatMode = (r.repeatMode === "interval") ? "interval" : "none";
        r.repeatEveryDays = Number(r.repeatEveryDays ?? 1);
        r.repeatUntilMode = (r.repeatUntilMode === "until_anchor") ? "until_anchor" : "x_times";
        r.repeatTimes = Number(r.repeatTimes ?? r.repeatUntilValue ?? 1);
        r.repeatUntilAnchorStage = String(r.repeatUntilAnchorStage || "HARVEST_END");
        r.repeatCutoffOffsetDays = Number(r.repeatCutoffOffsetDays ?? 0);
        r.repeatCutoffOffsetDirection = (r.repeatCutoffOffsetDirection === "before") ? "before" : "after";
        if (isCanonicalTaskId(r.id)) {
            delete r.taskTypeId;
            delete r.task_type_id;
        } else {
            r.taskTypeId = normalizeTaskTypeId(r.taskTypeId || r.task_type_id);
            delete r.task_type_id;
        }

        return r;
    }

    function normalizeTaskTemplate(template) {
        const src = (template && typeof template === "object") ? template : {};
        const rules = Array.isArray(src.rules) ? src.rules.map(normalizeTaskRule) : [];
        return { version: 2, rules };
    }

    function validateTaskRule(rule, { allowedStages = null, requireTaskType = false } = {}) {
        const r = normalizeTaskRule(rule);
        const rawRepeatUntilMode = rule && Object.prototype.hasOwnProperty.call(rule, "repeatUntilMode") ? String(rule.repeatUntilMode || "") : "";

        if (!String(r.title || "").trim()) throw new Error("Task title is required.");
        if (requireTaskType && !isCanonicalTaskId(r.id) && !String(r.taskTypeId || "").trim()) throw new Error("Task type is required.");
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
            if (rawRepeatUntilMode && rawRepeatUntilMode !== "x_times" && rawRepeatUntilMode !== "until_anchor") {
                throw new Error("Invalid repeat-until mode.");
            }
            if (!Number.isFinite(r.repeatEveryDays) || r.repeatEveryDays < 1) {
                throw new Error("Repeat every days must be at least 1.");
            }
            if (!String(r.repeatUntilAnchorStage || "").trim()) {
                throw new Error("Cutoff anchor is required for repeated tasks.");
            }
            if (!Number.isFinite(r.repeatCutoffOffsetDays) || r.repeatCutoffOffsetDays < 0) {
                throw new Error("Cutoff offset must be 0 or greater.");
            }
            if (Array.isArray(allowedStages) && allowedStages.length) {
                if (!allowedStages.includes(r.repeatUntilAnchorStage)) {
                    throw new Error("Cutoff anchor is not available for the current method.");
                }
            }

            if (r.repeatUntilMode === "x_times") {
                if (!Number.isFinite(r.repeatTimes) || r.repeatTimes < 1) {
                    throw new Error("Repeat times must be at least 1.");
                }
            } else if (r.repeatUntilMode === "until_anchor") {
                // The cutoff anchor already supplies the stop date for this mode.
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
            const cutoffTxt = fmtOffset(
                r.repeatCutoffOffsetDays,
                r.repeatCutoffOffsetDirection,
                r.repeatUntilAnchorStage
            );
            const repeatTxt = (r.repeatUntilMode === "x_times")
                ? `repeat every ${r.repeatEveryDays} days, up to ${r.repeatTimes} time${r.repeatTimes === 1 ? "" : "s"}, until ${cutoffTxt}`
                : `repeat every ${r.repeatEveryDays} days until ${cutoffTxt}`;

            parts.push(repeatTxt);
        }

        return parts.join(" • ");
    }

    function getTaskPreviewRuleKey(rule, ruleIndex) {
        const id = String(rule?.id || 'rule').trim() || 'rule';
        return `${id}::${Number(ruleIndex)}`;
    }

    function normalizeTaskTitleIdentity(value) {
        return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
    }

    function taskTitleContainsIdentity(title, identity) {
        const normalizedTitle = normalizeTaskTitleIdentity(title);
        const normalizedIdentity = normalizeTaskTitleIdentity(identity);
        return !!normalizedIdentity && normalizedTitle.includes(normalizedIdentity);
    }

    function escapeTaskTitleRegExp(value) {
        return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function stripTrailingTaskIdentity(title, identity) {
        const text = String(title || '').trim();
        const identityText = String(identity || '').trim();
        if (!text || !identityText) return text;
        const pattern = new RegExp(`(?:\\s*(?:[-–—:]+|for)?\\s*)${escapeTaskTitleRegExp(identityText)}\\s*$`, 'i');
        return text.replace(pattern, '').trim();
    }

    function cleanTaskActionTitle(title) {
        return String(title || '')
            .replace(/\{plant\}/g, '')
            .replace(/\{succ\}/g, '')
            .replace(/\s+for\s*$/i, '')
            .replace(/\s*[-–—:]+\s*$/g, '')
            .trim();
    }

    function appendCropDisplayNameToTaskAction(actionTitle, cropDisplayName) {
        const action = cleanTaskActionTitle(actionTitle) || 'Task';
        return `${action} – ${cropDisplayName}`;
    }

    function formatCropDisplayName(plantName, varietyName) {
        const plantText = String(plantName || '').trim() || 'Plant';
        const varietyText = String(varietyName || '').trim();
        if (!varietyText) return plantText;
        const normalizedPlant = normalizeTaskTitleIdentity(plantText);
        const normalizedVariety = normalizeTaskTitleIdentity(varietyText);
        if (normalizedPlant === normalizedVariety || normalizedPlant.includes(`(${normalizedVariety})`)) return plantText;
        return `${plantText} (${varietyText})`;
    }

    function buildGeneratedTaskTitle(template, cropDisplayName, plantName, varietyName) {
        const rawTitle = String(template || '').trim();
        const hasPlantToken = /\{plant\}/.test(rawTitle);
        const title = rawTitle.replace(/\{succ\}/g, '');
        if (hasPlantToken) return appendCropDisplayNameToTaskAction(title, cropDisplayName);
        const customTitle = title.trim();
        if (!customTitle) return appendCropDisplayNameToTaskAction('Task', cropDisplayName);
        let actionTitle = stripTrailingTaskIdentity(customTitle, cropDisplayName);
        actionTitle = stripTrailingTaskIdentity(actionTitle, plantName);
        if (varietyName) actionTitle = stripTrailingTaskIdentity(actionTitle, varietyName);
        if (taskTitleContainsIdentity(actionTitle, cropDisplayName)) return actionTitle;
        return appendCropDisplayNameToTaskAction(actionTitle, cropDisplayName);
    }

    function taskAnchorDatesForTimeline(currentTimeline, currentSowDate) {
        return {
            SOW: iso(currentSowDate),
            GERM: iso(currentTimeline.germ),
            TRANSPLANT: iso(currentTimeline.transplant),
            HARVEST_START: iso(currentTimeline.harvestStart),
            HARVEST_END: iso(currentTimeline.harvestEnd)
        };
    }

    function resolveTaskAnchorISO(anchors, stage) {
        let anchorISO = anchors[String(stage || '').trim()] || null;
        if (!anchorISO && stage === 'GERM') anchorISO = anchors.SOW || null;
        return anchorISO;
    }

    function applyTaskAnchorOffset(anchorISO, days, direction) {
        if (!anchorISO) return null;
        const count = Number(days ?? 0);
        return Number.isFinite(count) ? shiftDays(anchorISO, (direction === 'before' ? -1 : 1) * count) : null;
    }

    function resolveTaskRuleRange(rule, anchors) {
        const startAnchorISO = resolveTaskAnchorISO(anchors, rule.startAnchorStage);
        if (!startAnchorISO) return null;
        const startISO = applyTaskAnchorOffset(startAnchorISO, rule.startOffsetDays, rule.startOffsetDirection);
        if (!startISO) return null;

        let endISO = startISO;
        if (rule.endMode === 'fixed_days') {
            const duration = Number(rule.durationDays ?? 0);
            endISO = Number.isFinite(duration) && duration >= 0 ? shiftDays(startISO, duration) : startISO;
        } else if (rule.endMode === 'anchor_range') {
            const endAnchorISO = resolveTaskAnchorISO(anchors, rule.endAnchorStage);
            if (!endAnchorISO) return null;
            endISO = applyTaskAnchorOffset(endAnchorISO, rule.endAnchorOffsetDays, rule.endAnchorOffsetDirection);
            if (!endISO) return null;
        } else {
            return null;
        }

        let rangeStartISO = startISO;
        let rangeEndISO = endISO;
        if (rangeEndISO < rangeStartISO) {
            [rangeStartISO, rangeEndISO] = [rangeEndISO, rangeStartISO];
        }
        return { rangeStartISO, rangeEndISO };
    }

    function resolveRepeatCutoffISO(rule, anchors) {
        const cutoffAnchorISO = resolveTaskAnchorISO(anchors, rule.repeatUntilAnchorStage);
        return applyTaskAnchorOffset(cutoffAnchorISO, rule.repeatCutoffOffsetDays, rule.repeatCutoffOffsetDirection);
    }

    function validateTaskRuleAnchorOrder(rule, { schedule, timelines } = {}) {
        const r = normalizeTaskRule(rule);
        const sowDate = Array.isArray(schedule) ? schedule[0] : schedule;
        const timeline = Array.isArray(timelines) ? timelines[0] : timelines;
        if (!sowDate || !timeline) return r;
        const anchors = taskAnchorDatesForTimeline(timeline, sowDate);
        const startAnchorISO = resolveTaskAnchorISO(anchors, r.startAnchorStage);
        const startISO = applyTaskAnchorOffset(startAnchorISO, r.startOffsetDays, r.startOffsetDirection);
        if (!startISO) return r;

        if (r.endMode === "anchor_range") {
            const endAnchorISO = resolveTaskAnchorISO(anchors, r.endAnchorStage);
            const endISO = applyTaskAnchorOffset(endAnchorISO, r.endAnchorOffsetDays, r.endAnchorOffsetDirection);
            if (endISO && startISO > endISO) {
                throw new Error("Start must be on or before the end anchor.");
            }
        }

        if (r.repeatMode === "interval") {
            const cutoffISO = resolveRepeatCutoffISO(r, anchors);
            if (cutoffISO && startISO > cutoffISO) {
                throw new Error("Start must be on or before the cutoff anchor.");
            }
        }

        return r;
    }

    function findRepeatCutoffOmittedRuleKeys({ taskTemplate, schedule, timelines } = {}) {
        const omitted = new Set();
        const tpl = normalizeTaskTemplate(taskTemplate ?? null);
        const rules = Array.isArray(tpl?.rules) ? tpl.rules : [];
        const sowDate = Array.isArray(schedule) ? schedule[0] : schedule;
        const timeline = Array.isArray(timelines) ? timelines[0] : timelines;
        if (!sowDate || !timeline) return omitted;
        const anchors = taskAnchorDatesForTimeline(timeline, sowDate);

        rules.forEach((sourceRule, ruleIndex) => {
            const rule = normalizeTaskRule(sourceRule);
            if (rule.repeatMode !== 'interval') return;
            const range = resolveTaskRuleRange(rule, anchors);
            const cutoffISO = resolveRepeatCutoffISO(rule, anchors);
            if (!range || !cutoffISO) return;
            if (range.rangeStartISO >= cutoffISO) {
                omitted.add(getTaskPreviewRuleKey(rule, ruleIndex));
            }
        });

        return omitted;
    }

    async function buildTasksForPlan({
        plant,
        schedule,
        timelines,
        taskTemplate,
        varietyName = '',
        includePreviewMetadata = false
    }) {
        const tasks = [];
        const plantName = plant?.plant_name || plant?.abbr || "Plant";
        const cropDisplayName = formatCropDisplayName(plantName, varietyName);
        const tpl = normalizeTaskTemplate(taskTemplate ?? null);
        const rules = Array.isArray(tpl?.rules) ? tpl.rules : [];
        const sowDate = Array.isArray(schedule) ? schedule[0] : schedule;
        const timeline = Array.isArray(timelines) ? timelines[0] : timelines;
        if (!sowDate || !timeline) return tasks;

        function substituteTitle(template) {
            return buildGeneratedTaskTitle(template, cropDisplayName, plantName, varietyName);
        }

        const anchors = taskAnchorDatesForTimeline(timeline, sowDate);
        for (let ruleIndex = 0; ruleIndex < rules.length; ruleIndex++) {
            const rule = normalizeTaskRule(rules[ruleIndex]);
            validateTaskRuleAnchorOrder(rule, { schedule: sowDate, timelines: timeline });
            const range = resolveTaskRuleRange(rule, anchors);
            if (!range) continue;
            const { rangeStartISO, rangeEndISO } = range;

            const occurrences = [];
            if (rule.repeatMode !== 'interval') {
                occurrences.push({ startISO: rangeStartISO, endISO: rangeEndISO });
            } else {
                const every = Number(rule.repeatEveryDays ?? 0);
                if (!Number.isFinite(every) || every < 1) continue;
                const cutoffISO = resolveRepeatCutoffISO(rule, anchors);
                if (!cutoffISO) continue;
                if (rule.repeatUntilMode === 'x_times') {
                    const times = Number(rule.repeatTimes ?? 1);
                    if (!Number.isFinite(times) || times < 1) continue;
                    let currentStart = rangeStartISO;
                    let currentEnd = rangeEndISO;
                    for (let occurrenceIndex = 0; occurrenceIndex < times; occurrenceIndex++) {
                        if (currentStart >= cutoffISO) break;
                        occurrences.push({ startISO: currentStart, endISO: currentEnd });
                        currentStart = shiftDays(currentStart, every);
                        currentEnd = shiftDays(currentEnd, every);
                    }
                } else if (rule.repeatUntilMode === 'until_anchor') {
                    let currentStart = rangeStartISO;
                    let currentEnd = rangeEndISO;
                    while (currentStart < cutoffISO) {
                        occurrences.push({ startISO: currentStart, endISO: currentEnd });
                        currentStart = shiftDays(currentStart, every);
                        currentEnd = shiftDays(currentEnd, every);
                    }
                } else {
                    continue;
                }
            }

            const title = substituteTitle(rule.title) || `Task for ${cropDisplayName}`;
            const previewRuleKey = getTaskPreviewRuleKey(rule, ruleIndex);
            occurrences.forEach((occurrence, occurrenceIndex) => {
                if (!occurrence.startISO && !occurrence.endISO) return;
                const task = {
                    title,
                    startISO: occurrence.startISO || occurrence.endISO,
                    endISO: occurrence.endISO || occurrence.startISO,
                    plant_name: plantName,
                    variety_name: String(varietyName || '').trim(),
                    rule_id: rule.id || null,
                    task_type_id: resolveTaskRuleTaskTypeId(rule),
                    startAnchorStage: rule.startAnchorStage,
                    endMode: rule.endMode
                };
                if (includePreviewMetadata) {
                    Object.defineProperties(task, {
                        previewRuleKey: { value: previewRuleKey, enumerable: false },
                        previewRuleIndex: { value: ruleIndex, enumerable: false },
                        previewOccurrenceIndex: { value: occurrenceIndex, enumerable: false }
                    });
                }
                tasks.push(task);
            });
        }
        return tasks;
    }

    function filterPreviewTasks(tasks, selectedRuleKeys) {
        const selected = selectedRuleKeys instanceof Set ? selectedRuleKeys : new Set(selectedRuleKeys || []);
        return (Array.isArray(tasks) ? tasks : []).filter(task => selected.has(task.previewRuleKey));
    }

    function buildTaskRuleDisplayOrder(taskRules, generatedTasks) {
        const firstOccurrenceByRule = new Map();
        (Array.isArray(generatedTasks) ? generatedTasks : []).forEach(task => {
            const key = task.previewRuleKey;
            const startISO = String(task.startISO || '');
            if (!key || !startISO) return;
            const current = firstOccurrenceByRule.get(key);
            if (!current || startISO < current) firstOccurrenceByRule.set(key, startISO);
        });
        return (Array.isArray(taskRules) ? taskRules : [])
            .map((rule, originalIndex) => ({
                rule,
                originalIndex,
                key: getTaskPreviewRuleKey(rule, originalIndex),
                firstOccurrenceISO: firstOccurrenceByRule.get(getTaskPreviewRuleKey(rule, originalIndex)) || null
            }))
            .sort((left, right) => {
                if (left.firstOccurrenceISO && right.firstOccurrenceISO) {
                    const dateOrder = left.firstOccurrenceISO.localeCompare(right.firstOccurrenceISO);
                    if (dateOrder !== 0) return dateOrder;
                } else if (left.firstOccurrenceISO) {
                    return -1;
                } else if (right.firstOccurrenceISO) {
                    return 1;
                }
                return left.originalIndex - right.originalIndex;
            });
    }

    function groupPreviewTasksByRule(tasks) {
        const groupsByKey = new Map();
        (Array.isArray(tasks) ? tasks : []).forEach((task, taskIndex) => {
            const key = task.previewRuleKey || `${String(task.rule_id || 'rule')}::${taskIndex}`;
            if (!groupsByKey.has(key)) {
                groupsByKey.set(key, {
                    key,
                    title: task.title,
                    originalIndex: Number(task.previewRuleIndex ?? taskIndex),
                    firstOccurrenceISO: String(task.startISO || ''),
                    occurrences: []
                });
            }
            const group = groupsByKey.get(key);
            group.occurrences.push(task);
            if (task.startISO && (!group.firstOccurrenceISO || task.startISO < group.firstOccurrenceISO)) {
                group.firstOccurrenceISO = task.startISO;
            }
        });
        return Array.from(groupsByKey.values())
            .map(group => ({
                ...group,
                occurrences: group.occurrences.slice().sort((left, right) => {
                    const startOrder = String(left.startISO || '').localeCompare(String(right.startISO || ''));
                    if (startOrder !== 0) return startOrder;
                    return String(left.endISO || '').localeCompare(String(right.endISO || ''));
                })
            }))
            .sort((left, right) => {
                const dateOrder = left.firstOccurrenceISO.localeCompare(right.firstOccurrenceISO);
                if (dateOrder !== 0) return dateOrder;
                return left.originalIndex - right.originalIndex;
            });
    }

    function resolveTaskPreviewScheduleRange(result) {
        const startISO = result?.kind === 'perennial'
            ? String(result.lifespanStartISO || '')
            : fmtISO(result?.schedule?.[0]);
        const endISO = result?.kind === 'perennial'
            ? String(result.lifespanEndISO || '')
            : String(result?.lastScheduledHarvestEndISO || '');
        const start = parseISODateUTCValue(startISO);
        const end = parseISODateUTCValue(endISO);
        if (!start || !end || end < start) return null;
        return { startISO: fmtISO(start), endISO: fmtISO(end) };
    }

    function renderTaskTimelinePreview(container, { tasks = [], scheduleRange = null, message = '', error = '' } = {}) {
        container.innerHTML = '';
        if (error || message || !tasks.length) {
            const empty = document.createElement('div');
            empty.textContent = error || message || 'No tasks are available for the current preview selection.';
            empty.style.padding = '10px';
            empty.style.border = `1px solid ${error ? '#fca5a5' : '#d1d5db'}`;
            empty.style.background = error ? '#fef2f2' : '#f9fafb';
            empty.style.color = error ? '#991b1b' : '#4b5563';
            container.appendChild(empty);
            return;
        }

        const rangeStart = parseISODateUTCValue(scheduleRange?.startISO);
        const rangeEnd = parseISODateUTCValue(scheduleRange?.endISO);
        if (!rangeStart || !rangeEnd || rangeEnd < rangeStart) {
            renderTaskTimelinePreview(container, { error: 'The schedule does not contain valid preview bounds.' });
            return;
        }
        const totalDays = Math.max(1, Math.round((rangeEnd - rangeStart) / 86400000));

        const labels = document.createElement('div');
        labels.style.display = 'grid';
        labels.style.gridTemplateColumns = '190px 1fr';
        labels.style.gap = '8px';
        const spacer = document.createElement('div');
        const dateScale = document.createElement('div');
        dateScale.style.display = 'flex';
        dateScale.style.justifyContent = 'space-between';
        dateScale.style.fontSize = '11px';
        dateScale.style.color = '#6b7280';
        const startLabel = document.createElement('span');
        const endLabel = document.createElement('span');
        startLabel.textContent = fmtISO(rangeStart);
        endLabel.textContent = fmtISO(rangeEnd);
        dateScale.appendChild(startLabel);
        dateScale.appendChild(endLabel);
        labels.appendChild(spacer);
        labels.appendChild(dateScale);
        container.appendChild(labels);

        groupPreviewTasksByRule(tasks).forEach(group => {
            const rowEl = document.createElement('div');
            rowEl.style.display = 'grid';
            rowEl.style.gridTemplateColumns = '190px 1fr';
            rowEl.style.gap = '8px';
            rowEl.style.alignItems = 'center';
            rowEl.style.margin = '5px 0';
            const taskLabel = document.createElement('div');
            taskLabel.textContent = group.title;
            taskLabel.title = `${group.occurrences.length} occurrence${group.occurrences.length === 1 ? '' : 's'}`;
            taskLabel.style.fontSize = '12px';
            taskLabel.style.overflow = 'hidden';
            taskLabel.style.textOverflow = 'ellipsis';
            taskLabel.style.whiteSpace = 'nowrap';
            const track = document.createElement('div');
            track.style.position = 'relative';
            track.style.height = '16px';
            track.style.background = '#e5e7eb';
            track.style.borderRadius = '3px';
            group.occurrences.forEach(task => {
                const taskStart = parseISODateUTCValue(task.startISO);
                const taskEnd = parseISODateUTCValue(task.endISO);
                if (!taskStart || !taskEnd) return;
                if (taskEnd < rangeStart || taskStart > rangeEnd) return;
                const clippedStart = new Date(Math.max(taskStart.getTime(), rangeStart.getTime()));
                const clippedEnd = new Date(Math.min(taskEnd.getTime(), rangeEnd.getTime()));
                const offsetDays = Math.round((clippedStart - rangeStart) / 86400000);
                const durationDays = Math.max(0, Math.round((clippedEnd - clippedStart) / 86400000));
                const leftPercent = Math.max(0, Math.min(99, (offsetDays / totalDays) * 100));
                const widthPercent = Math.max(1, Math.min(100 - leftPercent, (Math.max(1, durationDays) / totalDays) * 100));
                const bar = document.createElement('div');
                bar.style.position = 'absolute';
                bar.style.left = `${leftPercent}%`;
                bar.style.width = `${widthPercent}%`;
                bar.style.height = '100%';
                bar.style.background = '#2563eb';
                bar.style.borderRadius = '3px';
                bar.title = `${task.title}: ${task.startISO} to ${task.endISO}`;
                track.appendChild(bar);
            });
            rowEl.appendChild(taskLabel);
            rowEl.appendChild(track);
            container.appendChild(rowEl);
        });
    }

    function updateTaskTimelinePreview({
        container,
        generatedTasks = [],
        selectedRuleKeys = new Set(),
        scheduleRange = null,
        message = '',
        error = ''
    } = {}) {
        const tasks = filterPreviewTasks(generatedTasks, selectedRuleKeys);
        renderTaskTimelinePreview(container, { tasks, scheduleRange, message, error });
        return tasks;
    }

    async function getPlantingMethodById(methodId) {
        const normalizedMethodId = normId(methodId);
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
        } : null;
    }

    // -------------------- Rule library --------------------------

    function prettySourceLabel(src) {
        const map = {
            cell: "Cell override",
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
    
        currentMethodSpan.textContent = `Method: ${methodCategoryName} / ${methodName}`;
    
        const dirtyLabel = taskDirty ? " • Dirty" : "";
        currentTemplateSourceSpan.textContent =
            `Source: ${prettySourceLabel(taskTemplateSource)}${dirtyLabel}`;
    }

    async function resolveTaskTemplate({ cell, plantId, methodId }) {
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

        const pTpl = await TaskTemplateModel.loadPlantTemplate(plantId, methodId);
        if (pTpl) {
            return { template: pTpl, source: "plant" };
        }

        const methodTpl = await getDefaultTaskTemplateForPlantingMethods(methodId);
        if (methodTpl) {
            return { template: methodTpl, source: "method_builtin" };
        }

        return { template: null, source: "none" };
    }

    function prepAnchorForPlanningMode(planningMode) {
        return planningMode === "direct_sow" ? "SOW" : "TRANSPLANT";
    }

    function taskRuleLibraryForPlanningMode(planningMode) {
        const prepAnchor = prepAnchorForPlanningMode(planningMode);

        return {
            prep: {
                id: "prep",
                title: "Prep bed – {plant}",
                startAnchorStage: prepAnchor,
                startOffsetDays: 3,
                startOffsetDirection: "before",
                endMode: "fixed_days",
                durationDays: 3,
                endAnchorStage: null,
                endAnchorOffsetDays: 0,
                endAnchorOffsetDirection: "after",
                repeatMode: "none",
                repeatEveryDays: 1,
                repeatUntilMode: "x_times",
                repeatTimes: 1,
                repeatUntilAnchorStage: "HARVEST_END",
                repeatCutoffOffsetDays: 0,
                repeatCutoffOffsetDirection: "after"
            },
            sow: {
                id: "sow",
                title: "Sow – {plant}",
                startAnchorStage: "SOW",
                startOffsetDays: 0,
                startOffsetDirection: "after",
                endMode: "fixed_days",
                durationDays: 7,
                endAnchorStage: null,
                endAnchorOffsetDays: 0,
                endAnchorOffsetDirection: "after",
                repeatMode: "none",
                repeatEveryDays: 1,
                repeatUntilMode: "x_times",
                repeatTimes: 1,
                repeatUntilAnchorStage: "HARVEST_END",
                repeatCutoffOffsetDays: 0,
                repeatCutoffOffsetDirection: "after"
            },
            start: {
                id: "start",
                title: "Start indoors – {plant}",
                startAnchorStage: "SOW",
                startOffsetDays: 0,
                startOffsetDirection: "after",
                endMode: "fixed_days",
                durationDays: 0,
                endAnchorStage: null,
                endAnchorOffsetDays: 0,
                endAnchorOffsetDirection: "after",
                repeatMode: "none",
                repeatEveryDays: 1,
                repeatUntilMode: "x_times",
                repeatTimes: 1,
                repeatUntilAnchorStage: "HARVEST_END",
                repeatCutoffOffsetDays: 0,
                repeatCutoffOffsetDirection: "after"
            },
            harden: {
                id: "harden",
                title: "Harden off – {plant}",
                startAnchorStage: "TRANSPLANT",
                startOffsetDays: 7,
                startOffsetDirection: "before",
                endMode: "fixed_days",
                durationDays: 7,
                endAnchorStage: null,
                endAnchorOffsetDays: 0,
                endAnchorOffsetDirection: "after",
                repeatMode: "none",
                repeatEveryDays: 1,
                repeatUntilMode: "x_times",
                repeatTimes: 1,
                repeatUntilAnchorStage: "HARVEST_END",
                repeatCutoffOffsetDays: 0,
                repeatCutoffOffsetDirection: "after"
            },
            transplant: {
                id: "transplant",
                title: "Transplant – {plant}",
                startAnchorStage: "TRANSPLANT",
                startOffsetDays: 0,
                startOffsetDirection: "after",
                endMode: "fixed_days",
                durationDays: 7,
                endAnchorStage: null,
                endAnchorOffsetDays: 0,
                endAnchorOffsetDirection: "after",
                repeatMode: "none",
                repeatEveryDays: 1,
                repeatUntilMode: "x_times",
                repeatTimes: 1,
                repeatUntilAnchorStage: "HARVEST_END",
                repeatCutoffOffsetDays: 0,
                repeatCutoffOffsetDirection: "after"
            },
            thin: {
                id: "thin",
                title: "Thin / check – {plant}",
                startAnchorStage: "GERM",
                startOffsetDays: 7,
                startOffsetDirection: "after",
                endMode: "fixed_days",
                durationDays: 7,
                endAnchorStage: null,
                endAnchorOffsetDays: 0,
                endAnchorOffsetDirection: "after",
                repeatMode: "none",
                repeatEveryDays: 1,
                repeatUntilMode: "x_times",
                repeatTimes: 1,
                repeatUntilAnchorStage: "HARVEST_END",
                repeatCutoffOffsetDays: 0,
                repeatCutoffOffsetDirection: "after"
            },
            harvest: {
                id: "harvest",
                title: "Harvest – {plant}",
                startAnchorStage: "HARVEST_START",
                startOffsetDays: 0,
                startOffsetDirection: "after",
                endMode: "anchor_range",
                durationDays: null,
                endAnchorStage: "HARVEST_END",
                endAnchorOffsetDays: 0,
                endAnchorOffsetDirection: "after",
                repeatMode: "none",
                repeatEveryDays: 1,
                repeatUntilMode: "x_times",
                repeatTimes: 1,
                repeatUntilAnchorStage: "HARVEST_END",
                repeatCutoffOffsetDays: 0,
                repeatCutoffOffsetDirection: "after"
            }
        };
    }

    function applyTaskOverrides(rule, override) {
        const base = normalizeTaskRule(rule);
        if (!override || typeof override !== "object") return { ...base };
        return normalizeTaskRule({ ...base, ...override });
    }

    // -------------------- Default template from method --------------------------

    async function getDefaultTaskTemplateForPlantingMethods(methodId) {
        if (!methodId) return null;
    
        const method = await getPlantingMethodById(methodId);
        if (!method) return null;
    
        const resolved = resolveMethodBehavior({
            methodCategoryId: method.method_category_id,
            methodId: method.method_id
        });
    
        const lib = taskRuleLibraryForPlanningMode(resolved.planningMode);

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
            city_name: String(city.city_name || ''),
            method_category_id: normId(inputs.methodCategoryId),
            method_id: normId(inputs.methodId),
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

    function applyCellAttributePatch(cell, patch, model = null) {
        for (const [key, value] of Object.entries(patch || {})) {
            writeCellAttribute(cell, key, value, model);
        }
    }

    function restoreCellAttributeSnapshot(cell, snapshot, model = null) {
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
        const method = normId(inputs.methodId);
    
        const result = options.result || computeScheduleResult(inputs);
        const schedule = result.schedule;
        const timelines = result.timelines;

        async function emitTasksForPlan({
            method,
            plant,
            cell,
            schedule,
            timelines,
            plantId = null,
            varietyId = null,
            varietyName = '',
            methodCategoryId = null,
            methodId = null,
            taskTemplate = null
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
                varietyName,
                methodCategoryId,
                methodId
            });

            const detail = {
                mode: "replace", // FIX: make replacement semantics explicit
                tasks,
                plantName: plant.plant_name,
                varietyName: String(varietyName || ''),
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
        const attributePatch = buildScheduleAttributePatch(inputs, result, options);
        const attributeSnapshot = snapshotCellAttributes(cell, Object.keys(attributePatch));

        const applyGraphPatch = async () => {
            model.beginUpdate();
            try {
                applyCellAttributePatch(cell, attributePatch, model);
            } finally {
                model.endUpdate();
            }
            graph.refresh(cell);
        };

        const restoreGraphPatch = async () => {
            model.beginUpdate();
            try {
                restoreCellAttributeSnapshot(cell, attributeSnapshot, model);
            } finally {
                model.endUpdate();
            }
            graph.refresh(cell);
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
                varietyName: inputs?.varietyName ?? '',
                methodCategoryId: normId(inputs?.methodCategoryId),
                methodId: normId(inputs?.methodId),
                taskTemplate: options.taskTemplate ?? null // FIX: do not reread task_template_json after mutation
            }),
            finalizeGraph: async () => {
                retileAndFitGroupIfAvailable(graph, cell, { source: 'schedule-save' });
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
        const year = storedSeasonYear != null && storedSeasonYear >= 1900 && storedSeasonYear <= 3000
            ? Math.trunc(storedSeasonYear)
            : (storedSowDate ? storedSowDate.getUTCFullYear() : currentYear);
        const hasPersistedSchedule = storedSowDate != null;
        const groupCityName = (cell && cell.getAttribute && cell.getAttribute('city_name')) || null;
        const initialCityName = groupCityName || (cities[0].city_name || cities[0]);

        const initialMethodSelection = await resolveInitialMethodSelection(cell, selectedPlant);
        const initialMethodCategoryId = initialMethodSelection.methodCategoryId;
        const initialMethodId = initialMethodSelection.methodId;
        const initialResolvedBehavior = initialMethodSelection.resolvedBehavior;

        const cityInit = await CityClimate.loadByName(initialCityName);
        if (!cityInit) throw new Error(`City not found: ${initialCityName}`);

        const selectedIsPerennial = isPerennialPlant(selectedPlant);
        const perennialLifespanYears = selectedIsPerennial
            ? requirePerennialLifespanYears(selectedPlant)
            : null;
        const budget = selectedIsPerennial ? null : selectedPlant.firstHarvestBudget();

        // --- compute initial auto anchors safely ---
        const overwinterAllowed0 = isCrossYearCrop(selectedPlant); // FIX: biennials may harvest in a later year
        const scanStart = asUTCDate(year, 1, 1);
        const scanEndHard = asUTCDate(year + getPlantScanYears(selectedPlant) - 1, 12, 31); // FIX: use lifecycle-aware scan bounds


        const HW_DAYS = resolveHarvestWindowDays(null, selectedPlant); // FIX: use the canonical fallback

        let initialWindowFeasible = selectedIsPerennial;
        let earliestFeasibleSowDate = selectedIsPerennial
            ? new Date(storedSowDate || scanStart)
            : null;
        let climateEndDate = selectedIsPerennial
            ? parseISODateUTCValue(computePerennialLifespanEndISO(
                fmtISO(storedSowDate || scanStart),
                year,
                perennialLifespanYears
            ))
            : null;
        let lastHarvestDate = selectedIsPerennial ? climateEndDate : null;

        if (!selectedIsPerennial && Number.isFinite(HW_DAYS)) {
            const env = selectedPlant.cropTempEnvelope(); // FIX: annual-only maturity inputs
            const dailyRates = cityInit.dailyRates(env.Tbase, year);
            const monthlyAvgTemp = cityInit.monthlyMeans();
            const initialWindow = computeAutoStartEndWindowForward({
                methodCategoryId: initialMethodCategoryId,
                methodId: initialMethodId,
                budget: budget,
                HW_DAYS: HW_DAYS,
                dailyRatesMap: dailyRates,
                monthlyAvgTemp: monthlyAvgTemp,
                Tbase: env.Tbase,
                cropTemp: env,
                scanStart,
                scanEndHard,
                soilGateThresholdC: finiteNumberOrNull(selectedPlant.soil_temp_min_plant_c),
                soilGateConsecutiveDays: 3,
                startCoolingThresholdC: asCoolingThresholdC(selectedPlant.start_cooling_threshold_c),
                useSpringFrostGate: true, // FIX: keep spring frost checks for overwinter-capable plants
                lastSpringFrostDOY: pickFrostByRisk(cityInit, 'p50'),
                daysTransplant: Number.isFinite(Number(selectedPlant.days_transplant))
                    ? Number(selectedPlant.days_transplant)
                    : 0,
                overwinterAllowed: overwinterAllowed0
            });

            initialWindowFeasible = initialWindow.feasible === true;
            earliestFeasibleSowDate = initialWindow.earliestFeasibleSowDate;
            climateEndDate = initialWindow.climateEndDate;
            lastHarvestDate = initialWindow.climateEndDate; // FIX: initialize the displayed annual end from the feasible window
        }

        // no stray reassignments like: earliestFeasibleSowDate = a; lastHarvestDate = b;  <-- remove these

        let previewStart = storedSowDate || earliestFeasibleSowDate;
        if (!selectedIsPerennial && storedHarvestEndDate) {
            lastHarvestDate = storedHarvestEndDate;
        }
        let startNote = initialWindowFeasible || selectedIsPerennial ? '' : 'No feasible window.';

        // If we have a finite harvest window, we can run feasibility tweaks.
        // (For perennials / null HW_DAYS we skip this step but still open the dialog.)
        if (!selectedIsPerennial && initialWindowFeasible && Number.isFinite(HW_DAYS) && !hasPersistedSchedule) {
            const inputs0 = new ScheduleInputs({
                plant: selectedPlant,
                city: cityInit,
                planningMode: initialResolvedBehavior.planningMode,
                methodCategoryId: initialMethodCategoryId,
                methodId: initialMethodId,
                startISO: earliestFeasibleSowDate.toISOString().slice(0, 10),
                seasonEndISO: climateEndDate.toISOString().slice(0, 10),
                policy: PolicyFlags.fromResolvedBehavior(selectedPlant, initialResolvedBehavior),
                seasonStartYear: year,
                harvestWindowDays: HW_DAYS
            });

            const planner0 = new Planner(inputs0);
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
            lastHarvestDate,
            startNote,
            initialCityName,
            hasPersistedSchedule,
            initialWindowFeasible
        });
    }



















































    const USL_DEBUG_HARVEST_WINDOWS = true;

    // -------------------- Public API --------------------------------------------------------
    async function listPlantOptions() {
        const plants = await PlantModel.listBasic();
        return plants.map(function (plant) {
            return {
                id: String(plant.plant_id),
                name: String(plant.plant_name || plant.abbr || plant.plant_id),
                abbr: String(plant.abbr || ""),
                annual: Number(plant.annual || 0),
                biennial: Number(plant.biennial || 0),
                perennial: Number(plant.perennial || 0)
            };
        });
    }

    window.USL = window.USL || {};
    window.USL.scheduler = Object.assign({}, window.USL.scheduler, {
        openScheduleDialog: (ui, cell) => openScheduleDialog(ui, cell),
        openSetPlantDialog: (ui, cell) => openSetPlantDialog(ui, cell),
        listPlantOptions: listPlantOptions
    });
    window.openUSLScheduleDialog = window.USL.scheduler.openScheduleDialog;

    async function openSetPlantDialog(ui, cell) {
        if (!ui || !ui.editor || !ui.editor.graph) throw new Error('Draw.io UI is unavailable.');
        if (!isTilerGroup(cell)) throw new Error('Set Plant requires a tiler group.');

        const graph = ui.editor.graph;
        const model = graph.getModel();
        const allPlants = await PlantModel.listBasic();
        if (!allPlants.length) { mxUtils.alert('No plants found in database.'); return; }

        const div = document.createElement('div');
        div.style.padding = '12px';
        div.style.width = '420px';
        const title = document.createElement('div');
        title.textContent = 'Select Plant';
        title.style.fontWeight = '600';
        title.style.marginBottom = '8px';
        div.appendChild(title);

        const sel = document.createElement('select');
        sel.style.width = '100%';
        sel.style.padding = '6px';
        sel.style.margin = '8px 0';
        allPlants.forEach(p => {
            const opt = document.createElement('option');
            opt.value = String(p.plant_id);
            opt.textContent = p.plant_name + (p.abbr ? ` (${p.abbr})` : '');
            sel.appendChild(opt);
        });
        div.appendChild(sel);

        const btns = document.createElement('div');
        btns.style.display = 'flex';
        btns.style.justifyContent = 'flex-end';
        btns.style.gap = '8px';

        const ok = mxUtils.button('OK', async () => {
            const id = Number(sel.value);
            const row = await PlantModel.loadById(id);
            if (!row) { mxUtils.alert('Plant not found.'); return; }
            ui.hideDialog();

            model.beginUpdate();
            try {
                const gardenParent = findGardenModuleAncestor(model, cell);
                if (gardenParent) {
                    const inheritedCity = gardenParent.getAttribute('city_name');
                    if (inheritedCity) setAttr(cell, 'city_name', inheritedCity);
                }

                setAttr(cell, 'plant_id', String(row.plant_id));
                setAttr(cell, 'plant_name', row.plant_name);
                if (row.abbr) setAttr(cell, 'plant_abbr', row.abbr);
                setAttr(cell, 'plant_locked', '1');
                setAttr(cell, 'label', row.plant_name + ' group');

                applyPlantSpacingToGroup(cell, row);

                retileAndFitGroupIfAvailable(graph, cell, { source: 'set-plant', inTransaction: true });
                graph.refresh(cell);
            } finally {
                model.endUpdate();
            }
        });
        const cancel = mxUtils.button('Cancel', () => ui.hideDialog());
        btns.appendChild(ok);
        btns.appendChild(cancel);
        div.appendChild(btns);
        ui.showDialog(div, 440, 220, true, true);
    }

    if (window.USL_SCHEDULER_TESTING) {
        window.USL.scheduler.__test = {
            PlantModel,
            CityClimate,
            PolicyFlags,
            ScheduleInputs,
            Planner,
            computeAutoStartEndWindowForward,
            getPlantScanYears,
            isCrossYearCrop, // FIX: expose lifecycle behavior to the opt-in regression harness
            resolveHarvestWindowDays, // FIX: expose fallback behavior to the opt-in regression harness
            computeStageDatesForPlanting, // FIX: expose calendar-stage behavior to the opt-in regression harness
            normId,
            resolveStartAfterWindow
        }; // FIX: expose pure planner internals only when the regression harness opts in
    }

    // -------------------- Plugin entry: add popup menu item --------------------------------
    function installSchedulerPlugin(ui) { // FIX: install from the existing outer plugin registration
        const graph = ui.editor.graph;

        // Schedule entry is now rendered by Vertex_Linking_Standalone.js so it can live inside the linked-task overlay.

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

                const cityName = String(moduleCell.getAttribute?.("city_name") || "").trim();
                if (!cityName) {
                    emitHarvestWindowsSuggested(moduleCellId, year, crops.map(c => ({
                        cropId: c.cropId, harvestStart: null, harvestEnd: null, shelfLifeDays: null,
                        reason: "Module city_name not set"
                    })));
                    return;
                }

                const results = [];
                for (const req of crops) {
                    results.push(await suggestHarvestWindowForCropReq(req, cityName, year));
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

        async function suggestHarvestWindowForCropReq(req, cityName, year) {
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

                const city = await CityClimate.loadByName(cityName);
                if (!city) return { cropId, harvestStart: null, harvestEnd: null, shelfLifeDays: null, reason: "City not found" };

                const methodId = normId(req?.methodId);
                const methodCategoryId = normId(req?.methodCategoryId);
                
                const resolvedBehavior = resolveMethodBehavior({
                    methodCategoryId,
                    methodId
                });
                
                const planningMode = resolvedBehavior.planningMode;
                const policy = PolicyFlags.fromResolvedBehavior(plant, resolvedBehavior);

                const hw = resolveHarvestWindowDays(req?.harvestWindowDays, plant); // FIX: share the scheduler's 7-day fallback

                const inputs = new ScheduleInputs({
                    plant,
                    city,
                    planningMode,
                    methodCategoryId: resolvedBehavior.methodCategoryId, // FIX: preserve the resolved method context
                    methodId: resolvedBehavior.methodId, // FIX: preserve the resolved method context
                    startISO: `${year}-01-01`,
                    seasonEndISO: `${year + getPlantScanYears(plant) - 1}-12-31`, // FIX: allow overwinter and multi-year harvests
                    policy,
                    seasonStartYear: year,
                    harvestWindowDays: hw,
                    varietyId,
                    varietyName: ""
                });

                const planner = new Planner(inputs);
                const C = planner.ctx;

                const maxSpanDays = Math.ceil((C.scanEndHard.getTime() - C.scanStart.getTime()) / 86400000) + 2;

                const first = planner.findNextFeasible(C.scanStart, maxSpanDays);
                if (!first?.date || !first?.info?.ok) {
                    return { cropId, harvestStart: null, harvestEnd: null, shelfLifeDays: null, reason: "No feasible sow date found in scan window" };
                }

                const last = findPrevFeasible(planner, C.scanEndHard, maxSpanDays);

                const shelfLifeDays =
                    Number.isFinite(Number(plant.shelf_life_days)) ? Number(plant.shelf_life_days) : null;

                // We approximate crop harvest window as:
                // earliest harvest start from earliest feasible sow,
                // latest harvest end from latest feasible sow.
                if (!last?.date || !last?.info?.ok) {
                    return {
                        cropId,
                        harvestStart: toYmdUTC(first.info.harvestStart),
                        harvestEnd: toYmdUTC(first.info.harvestEnd),
                        shelfLifeDays,
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

    if (typeof window !== 'undefined' && window.__TRELLIS_PLANTING_SCHEDULER_TEST__) { // FIX: opt-in test surface only
        window.__TRELLIS_PLANTING_SCHEDULER_TEST_HOOKS__ = {
            PlantModel,
            CityClimate,
            PolicyFlags,
            ScheduleInputs,
            Planner,
            applyPlantOverrides,
            computeScheduleResult,
            computeStageDatesForPlanting,
            computePerennialLifespanEndISO,
            firstCoolingCrossingDate,
            getPlantScanYears,
            resolveHarvestWindowDays,
            resolveInitialMethodSelection,
            resolveMethodBehavior,
            resolveValidMethodRecord,
            runUiAsyncOperation,
            computeAutoStartEndWindowForward,
            normId,
            encodeMethodSelection,
            decodeMethodSelection,
            humanFeasibilityReason,
            classifySelectedSowDate,
            buildScheduleViewState,
            taskRuleLibraryForPlanningMode,
            resolveTaskRuleTaskTypeId,
            normalizeTaskRule,
            validateTaskRule,
            validateTaskRuleAnchorOrder,
            describeTaskRule,
            buildTasksForPlan,
            findRepeatCutoffOmittedRuleKeys,
            filterPreviewTasks,
            getTaskPreviewRuleKey,
            buildTaskRuleDisplayOrder,
            groupPreviewTasksByRule,
            resolveTaskPreviewScheduleRange,
            resolveStartAfterWindow,
            buildScheduleAttributePatch,
            snapshotCellAttributes,
            applyCellAttributePatch,
            restoreCellAttributeSnapshot,
            runCompensatedSaveSteps
        };
        return; // FIX: tests do not install Draw.io menus
    }

    installSchedulerPlugin(ui); // FIX: avoid nested plugin registration

})
