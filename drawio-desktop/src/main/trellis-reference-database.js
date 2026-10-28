import { validateJson, textLimit, LIMITS } from './trellis-input-policy.js'; // NEW: reference validators share the pre-decoding policy.
/** Garden reference SQL projections. No operation in this service writes a file. */ // NEW
import '../../drawio/src/main/webapp/js/trellis-reference-core.js'; // NEW
import { randomUUID } from 'node:crypto';
export const referenceCore = globalThis.TrellisReferenceCore;
const quote = value => '"' + referenceCore.identifier(value) + '"';
function defaultSql(value) { // NEW: document schemas can contain literal defaults, never executable expressions.
    if (value == null) return ''; const text = String(value).trim();
    if (/^(?:NULL|-?\d+(?:\.\d+)?|'(?:[^']|'')*'|CURRENT_TIMESTAMP|CURRENT_DATE|CURRENT_TIME)$/i.test(text)) return ' DEFAULT ' + text;
    throw new Error('Unsupported reference column default.');
}
const TABLES = new Set(['Plants', 'PlantVarieties', 'PlantGrowthStages', 'PlantingMethodCategories', 'PlantingMethods', 'PlantAllowedMethodCategories', 'PlantTaskTemplates', 'VarietyTaskTemplates', 'Cities', 'CityWeatherDaily', 'CityWeatherMonthly', 'CityWeatherForecastDaily', 'PlantingWindowReferences', 'Companion_types', 'Companions', 'CompanionEvidence', 'CompanionLayoutGroupDefaults', 'CompanionSetLayoutDefaults', 'NutritionNutrients', 'NutritionRequirements', 'PlantNutritionMappings', 'PlantNutritionValues']); // NEW: operational experiment history is not a reusable definition.
const IMPLIED = { Plants: [['default_planting_method', 'PlantingMethods', 'method_id'], ['default_planting_method_category', 'PlantingMethodCategories', 'method_category_id']], PlantVarieties: [['plant_id', 'Plants', 'plant_id']], Companions: [['p1', 'Plants', 'plant_name'], ['p2', 'Plants', 'plant_name'], ['source_plant_id', 'Plants', 'plant_id'], ['companion_plant_id', 'Plants', 'plant_id'], ['companion_type_id', 'Companion_types', 'companion_type_id']], PlantTaskTemplates: [['plant_id', 'Plants', 'plant_id'], ['method_id', 'PlantingMethods', 'method_id']] }; // CHANGE: older packaged tables predate declared foreign keys.
/** Read schemas as data, never executable DDL supplied by a document. */
export function snapshotDatabase(db) {
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name).filter(name => TABLES.has(name)); // NEW
    const schema = {}, tables = {};
    for (const name of names) {
        const columns = db.prepare('PRAGMA table_info(' + quote(name) + ')').all().map(({ name, type, notnull, dflt_value, pk }) => ({ name, type, notnull, dflt_value, pk }));
        const pk = columns.filter(column => column.pk).sort((a, b) => a.pk - b.pk).map(column => column.name);
        const foreignKeys = db.prepare('PRAGMA foreign_key_list(' + quote(name) + ')').all().map(({ id, seq, table, from, to }) => ({ id, seq, table, from, to }));
        const uniqueIndexes = db.prepare('PRAGMA index_list(' + quote(name) + ')').all().filter(index => index.unique && index.origin !== 'pk'); // NEW
        const uniqueKeys = uniqueIndexes.map(index => db.prepare('PRAGMA index_info(' + quote(index.name) + ')').all().map(column => column.name)).filter(keys => keys.every(Boolean)); // CHANGE
        const normalizedUniqueKeys = name === 'Cities' && uniqueIndexes.some(index => index.name === 'idx_Cities_city_geo_identity') ? [['city_name', 'country_name', 'country_code', 'region_name', 'region_code']] : []; // NEW: express the existing city identity as data instead of copying executable index SQL.
        schema[name] = { columns, pk, foreignKeys, uniqueKeys, normalizedUniqueKeys }; // CHANGE
        tables[name] = db.prepare('SELECT * FROM ' + quote(name) + (pk.length ? ' ORDER BY ' + pk.map(quote).join(',') : ' ORDER BY rowid')).all();
    }
    for (const [table, keys] of Object.entries(IMPLIED)) for (const [from, target, to] of keys) if (schema[table]?.columns.some(column => column.name === from) && schema[target] && !schema[table].foreignKeys.some(fk => fk.from === from)) schema[table].foreignKeys.push({ id: 100 + schema[table].foreignKeys.length, seq: 0, table: target, from, to }); // NEW
    return { schema, tables };
}
/** Apply the current scheduler's additive creation schema in memory. Accepted // NEW
 * documents never run schema maintenance, and their source database is untouched. */ // NEW
export function prepareDefaultSnapshot(snapshot) { // NEW
    const result = referenceCore.clone(snapshot); // NEW
    // Mirrors the existing additive scheduler maintenance, exclusively for a new snapshot. // NEW
    const additions = { Plants: { establishment_temp_max_c: 'REAL', establishment_heat_window_days: 'INTEGER', establishment_heat_policy: 'TEXT', quality_temp_max_c: 'REAL', heat_stress_stage: 'TEXT', quality_heat_policy: 'TEXT', photoperiod_response: 'TEXT', critical_daylength_hours: 'REAL', photoperiod_stage: 'TEXT', photoperiod_policy: 'TEXT', chilling_required_days: 'REAL', chilling_required_hours: 'REAL', chilling_temp_min_c: 'REAL', chilling_temp_max_c: 'REAL', chilling_stage: 'TEXT', chilling_policy: 'TEXT', killtemp_c: 'REAL', diagnostic_policy: 'TEXT', spacing_x_cm: 'REAL', spacing_y_cm: 'REAL', allowed_overhang_pct: 'REAL' }, Cities: { country_name: 'TEXT', country_code: 'TEXT', region_name: 'TEXT', region_code: 'TEXT' } }; // NEW
    for (const [table, columns] of Object.entries(additions)) if (result.schema[table]) for (const [name, type] of Object.entries(columns)) if (!result.schema[table].columns.some(column => column.name === name)) { result.schema[table].columns.push({ name, type, notnull: 0, dflt_value: null, pk: 0 }); for (const row of result.tables[table]) row[name] = null; } // CHANGE
    for (const row of result.tables.Plants || []) if (row.allowed_overhang_pct == null) row.allowed_overhang_pct = 30; // NEW: capture the scheduler's effective legacy default.
    if (!result.schema.CompanionSetLayoutDefaults) { // NEW
        const fields = [['set_default_id', 'INTEGER', 1, 0], ['crop_set_key', 'TEXT', 0, 1], ['layout_json', 'TEXT', 0, 1], ['updated_at', 'TEXT', 0, 1]]; // NEW
        result.schema.CompanionSetLayoutDefaults = { columns: fields.map(([name, type, pk, notnull]) => ({ name, type, pk, notnull, dflt_value: null })), pk: ['set_default_id'], foreignKeys: [], uniqueKeys: [['crop_set_key']] }; result.tables.CompanionSetLayoutDefaults = []; // CHANGE
    } // NEW
    return result; // NEW
} // NEW
/** Build a private, bounded-lifetime in-memory view. SQLite validates full row constraints here. */
export function materialize(Database, store, manifestId) {
    const snapshot = referenceCore.project(store, manifestId), db = new Database(':memory:');
    try {
        db.transaction(() => {
            for (const [name, table] of Object.entries(snapshot.schema)) {
                const generatedKey = table.pk.length === 1 && table.columns.find(column => column.name === table.pk[0])?.type.toUpperCase() === 'INTEGER' ? table.pk[0] : null; // NEW
                const columns = table.columns.map(column => quote(column.name) + ' ' + (column.type || 'TEXT') + (column.name === generatedKey ? ' PRIMARY KEY AUTOINCREMENT' : '') + (column.notnull ? ' NOT NULL' : '') + defaultSql(column.dflt_value)); // CHANGE: deleted numeric keys are never reassigned to a different portable entity.
                if (table.pk.length && !generatedKey) columns.push('PRIMARY KEY (' + table.pk.map(quote).join(',') + ')'); // CHANGE
                for (const keys of table.uniqueKeys || []) columns.push('UNIQUE (' + keys.map(quote).join(',') + ')'); // NEW
                // Foreign references are validated by the portable core, including composite dependencies.
                db.exec('CREATE TABLE ' + quote(name) + ' (' + columns.join(',') + ')');
                for (const [index, keys] of (table.normalizedUniqueKeys || []).entries()) db.exec('CREATE UNIQUE INDEX ' + quote(name + '_normalized_' + index) + ' ON ' + quote(name) + '(' + keys.map(key => "lower(trim(coalesce(" + quote(key) + ", '')))" ).join(',') + ')'); // NEW
                const names = table.columns.map(column => column.name), insert = db.prepare('INSERT INTO ' + quote(name) + ' (' + names.map(quote).join(',') + ') VALUES (' + names.map(() => '?').join(',') + ')');
                for (const row of snapshot.tables[name]) insert.run(names.map(column => row[column] ?? null));
            }
        })();
        return db;
    } catch (error) { db.close(); throw error; }
}
/** Handles are bound to their renderer and captured garden; selection never changes a running view. */
export function createReferenceDatabaseService({ Database, readDefaults }) {
    const scopes = new Map(), handles = new Map();
    function scope(owner, scopeId) { const entry = scopes.get(scopeId); if (!entry || entry.owner !== owner) throw new Error('Reference view is unavailable. Reopen the garden dialog.'); return entry; }
    function handle(owner, dbId) { const entry = handles.get(dbId); if (!entry || entry.owner !== owner) throw new Error('Reference connection is unavailable.'); return scope(owner, entry.scopeId); }
    function release(owner, scopeId) {
        const entry = scope(owner, scopeId); entry.db.close(); scopes.delete(scopeId);
        for (const [id, handle] of handles) if (handle.scopeId === scopeId) handles.delete(id);
    }
    return {
        async request(owner, method, input = {}) {
            validateJson(input); textLimit(JSON.stringify(input), LIMITS.diagram); // NEW: complete document projections use the document budget; exchanged proposals are bounded separately.
            if (method === 'defaults') { const db = await readDefaults(); try { return { snapshot: prepareDefaultSnapshot(db.transaction(() => snapshotDatabase(db))()) }; } finally { db.close(); } } // CHANGE: one read transaction captures a consistent creation source.
            if (method === 'validate') { const db = materialize(Database, input.store, input.manifestId || input.store.current); db.close(); return { ok: true }; }
            if (method === 'create') {
                if ([...scopes.values()].filter(entry => entry.owner === owner).length >= 128) throw new Error('Close unused garden dialogs before opening more reference views.');
                const store = referenceCore.clone(input.store), manifestId = input.manifestId || store.current;
                const db = materialize(Database, store, manifestId), scopeId = randomUUID();
                scopes.set(scopeId, { owner, db, store, manifestId, editable: input.editable === true }); // CHANGE
                return { scopeId };
            }
            if (method === 'release') { release(owner, input.scopeId); return { ok: true }; }
            if (method === 'snapshot') { const entry = scope(owner, input.scopeId), snapshot = snapshotDatabase(entry.db); snapshot.schema = referenceCore.clone(entry.store.schema); return { snapshot }; } // CHANGE: projections do not redefine the captured portable schema.
            if (method === 'open') { scope(owner, input.scopeId); const dbId = randomUUID(); handles.set(dbId, { owner, scopeId: input.scopeId, readOnly: input.readOnly !== false }); return { dbId }; }
            if (method === 'close') { handle(owner, input.dbId); handles.delete(input.dbId); return { ok: true }; }
            const entry = handle(owner, input.dbId), connection = handles.get(input.dbId);
            if (method === 'query') {
                const statement = entry.db.prepare(input.sql);
                if (!statement.readonly) throw new Error('Reference queries must be read-only.');
                return { rows: input.params == null ? statement.all() : statement.all(input.params) };
            }
            if (method === 'exec') {
                if (!entry.editable || connection.readOnly) throw new Error('Accepted garden references are read-only.');
                // An editor can change rows in the private draft, never schemas or attached databases.
                if (/^\s*(?:BEGIN(?:\s+(?:DEFERRED|IMMEDIATE|EXCLUSIVE))?(?:\s+TRANSACTION)?|COMMIT(?:\s+TRANSACTION)?|ROLLBACK(?:\s+TRANSACTION)?(?:\s+TO(?:\s+SAVEPOINT)?\s+[A-Za-z_]\w*)?|SAVEPOINT\s+[A-Za-z_]\w*|RELEASE(?:\s+SAVEPOINT)?\s+[A-Za-z_]\w*)\s*;?\s*$/i.test(input.sql)) { entry.db.exec(input.sql); return { changes: 0 }; } // CHANGE: never execute additional statements hidden after a transaction command.
                if (/^\s*(?:CREATE\s+(?:TABLE|INDEX)\s+IF\s+NOT\s+EXISTS)\b/i.test(input.sql)) return { changes: 0 }; // Existing editor schema checks are inert on captured schemas.
                if (!/^\s*(?:INSERT|UPDATE|DELETE)\b/i.test(input.sql)) throw new Error('Reference schema changes require an explicit upgrade.');
                const statement = entry.db.prepare(input.sql), info = input.params == null ? statement.run() : statement.run(input.params);
                return { changes: info.changes, lastInsertRowid: String(info.lastInsertRowid) };
            }
            throw new Error('Unsupported reference database operation.');
        },
        closeOwner(owner) { for (const [scopeId, entry] of scopes) if (entry.owner === owner) release(owner, scopeId); }
    };
}
