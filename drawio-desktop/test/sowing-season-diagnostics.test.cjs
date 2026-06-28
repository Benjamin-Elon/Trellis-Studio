const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    mmDdToDoy,
    openDatabase,
    runDiagnostics
} = require('../scripts/trellis_seed_sowing_season_diagnostics.cjs');

const projectRoot = path.join(__dirname, '..');

function withTempDb(fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trellis-window-diagnostics-'));
    const dbPath = path.join(dir, 'Trellis_database.sqlite');
    const db = openDatabase(dbPath);
    try {
        createSchema(db);
        seedMethod(db);
        seedCity(db, 1, 'Mild City');
        seedPlant(db, 1, 'Fast Lettuce');
        return fn(db, dbPath);
    } finally {
        db.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function createSchema(db) {
    db.exec(`
        CREATE TABLE Plants (
            plant_id INTEGER PRIMARY KEY,
            plant_name TEXT,
            annual INTEGER,
            biennial INTEGER,
            perennial INTEGER,
            lifespan_years INTEGER,
            overwinter_ok INTEGER,
            days_maturity INTEGER,
            gdd_to_maturity REAL,
            days_transplant INTEGER,
            days_germ INTEGER,
            harvest_window_days INTEGER,
            tbase_c REAL,
            tmin_c REAL,
            topt_low_c REAL,
            topt_high_c REAL,
            tmax_c REAL,
            yield_per_plant_kg REAL,
            soil_temp_min_plant_c REAL,
            start_cooling_threshold_c REAL
        );
        CREATE TABLE Cities (
            city_id INTEGER PRIMARY KEY,
            city_name TEXT,
            gdd_annual REAL,
            gdd_base_c REAL,
            last_spring_frost_doy INTEGER,
            last_spring_frost_p50_doy INTEGER,
            avg_monthly_low_c1 REAL,
            avg_monthly_high_c1 REAL,
            avg_monthly_low_c2 REAL,
            avg_monthly_high_c2 REAL,
            avg_monthly_low_c3 REAL,
            avg_monthly_high_c3 REAL,
            avg_monthly_low_c4 REAL,
            avg_monthly_high_c4 REAL,
            avg_monthly_low_c5 REAL,
            avg_monthly_high_c5 REAL,
            avg_monthly_low_c6 REAL,
            avg_monthly_high_c6 REAL,
            avg_monthly_low_c7 REAL,
            avg_monthly_high_c7 REAL,
            avg_monthly_low_c8 REAL,
            avg_monthly_high_c8 REAL,
            avg_monthly_low_c9 REAL,
            avg_monthly_high_c9 REAL,
            avg_monthly_low_c10 REAL,
            avg_monthly_high_c10 REAL,
            avg_monthly_low_c11 REAL,
            avg_monthly_high_c11 REAL,
            avg_monthly_low_c12 REAL,
            avg_monthly_high_c12 REAL
        );
        CREATE TABLE PlantingMethods (
            method_id TEXT PRIMARY KEY,
            method_category_id TEXT,
            method_name TEXT,
            tasks_required_json TEXT
        );
        CREATE TABLE PlantingWindowReferences (
            reference_id INTEGER PRIMARY KEY,
            plant_id INTEGER,
            city_id INTEGER,
            method_id TEXT,
            stage TEXT,
            window_label TEXT,
            start_mm_dd TEXT,
            end_mm_dd TEXT,
            start_doy INTEGER,
            end_doy INTEGER,
            is_cross_year INTEGER,
            confidence TEXT,
            summary TEXT
        );
    `);
}

function seedMethod(db) {
    db.prepare(`
        INSERT INTO PlantingMethods (method_id, method_category_id, method_name, tasks_required_json)
        VALUES ('direct_sow.field', 'direct_sow', 'Direct sow in field', '[]')
    `).run();
}

function seedCity(db, cityId, cityName) {
    const columns = ['city_id', 'city_name', 'gdd_annual', 'gdd_base_c', 'last_spring_frost_doy', 'last_spring_frost_p50_doy'];
    const values = [cityId, cityName, null, 5, 1, 1];
    for (let month = 1; month <= 12; month += 1) {
        columns.push(`avg_monthly_low_c${month}`, `avg_monthly_high_c${month}`);
        values.push(18, 22);
    }
    db.prepare(`
        INSERT INTO Cities (${columns.join(', ')})
        VALUES (${columns.map(() => '?').join(', ')})
    `).run(...values);
}

function seedPlant(db, plantId, plantName) {
    db.prepare(`
        INSERT INTO Plants (
            plant_id, plant_name, annual, biennial, perennial, lifespan_years, overwinter_ok,
            days_maturity, gdd_to_maturity, days_transplant, days_germ, harvest_window_days,
            tbase_c, tmin_c, topt_low_c, topt_high_c, tmax_c, yield_per_plant_kg,
            soil_temp_min_plant_c, start_cooling_threshold_c
        )
        VALUES (?, ?, 1, 0, 0, 1, 0, 30, NULL, 0, 5, 7, 5, 0, 12, 22, 35, 0.25, NULL, NULL)
    `).run(plantId, plantName);
}

function seedReference(db, overrides = {}) {
    const row = {
        plant_id: 1,
        city_id: 1,
        method_id: 'direct_sow.field',
        stage: 'sow',
        window_label: 'late_reference',
        start_mm_dd: '12-01',
        end_mm_dd: '12-15',
        start_doy: mmDdToDoy('12-01'),
        end_doy: mmDdToDoy('12-15'),
        is_cross_year: 0,
        confidence: 'medium',
        summary: 'Deliberately late reference for report-only mismatch.',
        ...overrides
    };
    db.prepare(`
        INSERT INTO PlantingWindowReferences (
            plant_id, city_id, method_id, stage, window_label, start_mm_dd, end_mm_dd,
            start_doy, end_doy, is_cross_year, confidence, summary
        )
        VALUES (
            ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?
        )
    `).run(
        row.plant_id, row.city_id, row.method_id, row.stage, row.window_label, row.start_mm_dd, row.end_mm_dd,
        row.start_doy, row.end_doy, row.is_cross_year, row.confidence, row.summary
    );
}

test('sowing-season diagnostic reports scheduler mismatch without failing', () => {
    withTempDb((db, dbPath) => {
        seedReference(db);

        const report = runDiagnostics({ dbPath, year: 2026, projectRoot, toleranceDays: 7 });

        assert.equal(report.ok, true);
        assert.equal(report.summary.references, 1);
        assert.equal(report.summary.outside_tolerance, 1);
        assert.equal(report.rows[0].status, 'outside_tolerance');
        assert.equal(report.rows[0].plant_name, 'Fast Lettuce');
        assert.equal(report.rows[0].city_name, 'Mild City');
    });
});

test('sowing-season diagnostic fails setup for unresolved dependencies', () => {
    withTempDb((db, dbPath) => {
        seedReference(db, { plant_id: 999 });

        const report = runDiagnostics({ dbPath, year: 2026, projectRoot });

        assert.equal(report.ok, false);
        assert.equal(report.summary.setup_errors, 1);
        assert.match(report.errors[0], /cannot resolve plant_id 999/);
    });
});

test('sowing-season diagnostic fails setup for malformed reference rows', () => {
    withTempDb((db, dbPath) => {
        seedReference(db, { stage: 'bad_stage' });

        const report = runDiagnostics({ dbPath, year: 2026, projectRoot });

        assert.equal(report.ok, false);
        assert.equal(report.summary.setup_errors, 1);
        assert.match(report.errors[0], /invalid stage bad_stage/);
    });
});
