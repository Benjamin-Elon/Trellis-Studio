const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_DB_PATH = path.join(PROJECT_ROOT, 'trellis_database', 'Trellis_database.sqlite');
const DEFAULT_RUNS_DIR = path.join(PROJECT_ROOT, 'trellis_seed_runs');
const DEFAULT_REPORT_PATH = path.join(DEFAULT_RUNS_DIR, 'sowing_window_diagnostics_report.json');
const DEFAULT_TOLERANCE_DAYS = 14;

function runDiagnostics(options = {}) {
    const projectRoot = options.projectRoot || PROJECT_ROOT;
    const dbPath = path.resolve(options.dbPath || loadConfiguredDbPath(projectRoot) || DEFAULT_DB_PATH);
    const year = Number(options.year || new Date().getFullYear());
    const toleranceDays = Number(options.toleranceDays ?? DEFAULT_TOLERANCE_DAYS);
    const hooks = options.hooks || loadSchedulerHooks(projectRoot);
    const report = {
        ok: true,
        db_path: dbPath,
        year,
        tolerance_days: toleranceDays,
        summary: {
            references: 0,
            within_tolerance: 0,
            outside_tolerance: 0,
            missing_scheduler_window: 0,
            setup_errors: 0
        },
        errors: [],
        rows: []
    };

    let db;
    try {
        db = openDatabase(dbPath, { readonly: true });
        if (!tableExists(db, 'PlantingWindowReferences')) {
            report.ok = false;
            report.errors.push('PlantingWindowReferences table is missing; apply seeder migrations before diagnostics.');
            report.summary.setup_errors = report.errors.length;
            return report;
        }
        const references = loadReferenceRows(db);
        report.summary.references = references.length;
        for (const reference of references) {
            const validationErrors = validateReference(reference);
            if (validationErrors.length) {
                report.ok = false;
                report.errors.push(...validationErrors.map(error => `${referenceLabel(reference)}: ${error}`));
                continue;
            }
            const row = compareReferenceToScheduler(hooks, reference, { year, toleranceDays });
            report.rows.push(row);
            report.summary[row.status] = (report.summary[row.status] || 0) + 1;
        }
    } catch (error) {
        report.ok = false;
        report.errors.push(error && error.message ? error.message : String(error));
    } finally {
        if (db) db.close();
    }
    report.summary.setup_errors = report.errors.length;
    return report;
}

function loadSchedulerHooks(projectRoot = PROJECT_ROOT) {
    const pluginDir = path.join(projectRoot, 'drawio', 'src', 'main', 'webapp', 'plugins', 'garden_planner_plugins');
    const corePaths = [
        'Garden_Scheduler_Shared_Core.js',
        'Garden_Scheduler_Annual_Core.js',
        'Garden_Scheduler_Perennial_Core.js'
    ].map(fileName => path.join(pluginDir, fileName));
    const dialogPath = path.join(pluginDir, 'Garden_Scheduler_Dialog.js');
    const context = vm.createContext({
        console: quietConsole(),
        Date,
        Math,
        Promise,
        setTimeout,
        clearTimeout,
        window: {
            __TRELLIS_PLANTING_SCHEDULER_TEST__: true
        },
        Draw: {
            loadPlugin(register) {
                register({ editor: { graph: {} } });
            }
        }
    });
    for (const corePath of corePaths) {
        vm.runInContext(fs.readFileSync(corePath, 'utf8'), context, { filename: corePath });
    }
    vm.runInContext(fs.readFileSync(dialogPath, 'utf8'), context, { filename: dialogPath });
    if (!context.window.__TRELLIS_PLANTING_SCHEDULER_TEST_HOOKS__) {
        throw new Error('Scheduler test hooks were not installed.');
    }
    return context.window.__TRELLIS_PLANTING_SCHEDULER_TEST_HOOKS__;
}

function loadReferenceRows(db) {
    return db.prepare(`
        SELECT r.reference_id, r.plant_id, r.city_id, r.method_id, r.stage, r.window_label,
               r.start_mm_dd, r.end_mm_dd, r.start_doy, r.end_doy, r.is_cross_year,
               r.confidence, r.summary AS reference_summary,
               p.plant_name,
               c.city_name,
               pm.method_category_id,
               pm.method_name
        FROM PlantingWindowReferences r
        LEFT JOIN Plants p ON p.plant_id = r.plant_id
        LEFT JOIN Cities c ON c.city_id = r.city_id
        LEFT JOIN PlantingMethods pm ON LOWER(TRIM(pm.method_id)) = LOWER(TRIM(r.method_id))
        ORDER BY p.plant_name, c.city_name, r.method_id, r.stage, r.window_label, r.reference_id
    `).all().map(reference => ({
        ...reference,
        plant: reference.plant_id == null ? null : db.prepare('SELECT * FROM Plants WHERE plant_id = ?').get(reference.plant_id),
        city: reference.city_id == null ? null : db.prepare('SELECT * FROM Cities WHERE city_id = ?').get(reference.city_id)
    }));
}

function openDatabase(dbPath, options = {}) {
    const builtin = loadBuiltinSqlite();
    if (builtin) {
        return new builtin.DatabaseSync(dbPath, { readOnly: !!options.readonly }); // Node runtime fallback
    }
    const BetterSqliteDatabase = require('better-sqlite3');
    return new BetterSqliteDatabase(dbPath, options); // Electron-compatible fallback
}

function loadBuiltinSqlite() {
    const originalEmitWarning = process.emitWarning;
    process.emitWarning = function filteredWarning(warning, ...args) {
        const message = typeof warning === 'string' ? warning : String(warning?.message || warning || '');
        const type = typeof args[0] === 'string' ? args[0] : '';
        if (type === 'ExperimentalWarning' && message.includes('SQLite')) return; // keep diagnostic output readable
        return originalEmitWarning.call(process, warning, ...args);
    };
    try {
        return require('node:sqlite');
    } catch (_) {
        return null;
    } finally {
        process.emitWarning = originalEmitWarning;
    }
}

function quietConsole() {
    return {
        ...console,
        log() {},
        info() {},
        debug() {},
        warn() {}
    };
}

function validateReference(reference) {
    const errors = [];
    if (!reference.plant) errors.push(`cannot resolve plant_id ${reference.plant_id}`);
    if (!reference.city) errors.push(`cannot resolve city_id ${reference.city_id}`);
    if (!reference.method_category_id) errors.push(`cannot resolve method_id ${reference.method_id}`);
    if (!['sow', 'transplant'].includes(String(reference.stage || '').trim())) {
        errors.push(`invalid stage ${reference.stage}`);
    }
    if (!Number.isInteger(Number(reference.start_doy)) || Number(reference.start_doy) < 1 || Number(reference.start_doy) > 366) {
        errors.push(`invalid start_doy ${reference.start_doy}`);
    }
    if (!Number.isInteger(Number(reference.end_doy)) || Number(reference.end_doy) < 1 || Number(reference.end_doy) > 366) {
        errors.push(`invalid end_doy ${reference.end_doy}`);
    }
    return errors;
}

function compareReferenceToScheduler(hooks, reference, { year, toleranceDays }) {
    const base = {
        reference_id: reference.reference_id,
        plant_name: reference.plant_name,
        city_name: reference.city_name,
        method_id: reference.method_id,
        method_name: reference.method_name,
        stage: reference.stage,
        window_label: reference.window_label,
        reference_start_mm_dd: reference.start_mm_dd,
        reference_end_mm_dd: reference.end_mm_dd,
        reference_start_doy: Number(reference.start_doy),
        reference_end_doy: Number(reference.end_doy),
        scheduler_start_mm_dd: null,
        scheduler_end_mm_dd: null,
        scheduler_start_doy: null,
        scheduler_end_doy: null,
        delta_start_days: null,
        delta_end_days: null,
        reason: ''
    };
    try {
        const schedulerWindow = computeSchedulerWindow(hooks, reference, year);
        if (!schedulerWindow || !schedulerWindow.start || !schedulerWindow.end) {
            return { ...base, status: 'missing_scheduler_window', reason: schedulerWindow?.reason || 'no_feasible_scheduler_window' };
        }
        const schedulerStartDoy = mmDdToDoy(mmDdFromDate(schedulerWindow.start));
        const schedulerEndDoy = mmDdToDoy(mmDdFromDate(schedulerWindow.end));
        const deltaStart = schedulerStartDoy - Number(reference.start_doy);
        const deltaEnd = schedulerEndDoy - Number(reference.end_doy);
        const withinTolerance = Math.abs(deltaStart) <= toleranceDays && Math.abs(deltaEnd) <= toleranceDays;
        return {
            ...base,
            scheduler_start_mm_dd: mmDdFromDate(schedulerWindow.start),
            scheduler_end_mm_dd: mmDdFromDate(schedulerWindow.end),
            scheduler_start_doy: schedulerStartDoy,
            scheduler_end_doy: schedulerEndDoy,
            delta_start_days: deltaStart,
            delta_end_days: deltaEnd,
            status: withinTolerance ? 'within_tolerance' : 'outside_tolerance',
            reason: withinTolerance ? 'scheduler_window_within_reference_tolerance' : 'scheduler_window_outside_reference_tolerance'
        };
    } catch (error) {
        return { ...base, status: 'missing_scheduler_window', reason: error && error.message ? error.message : String(error) };
    }
}

function computeSchedulerWindow(hooks, reference, year) {
    const plant = new hooks.PlantModel(reference.plant);
    if (plant.isPerennial()) {
        return { reason: 'perennial_auto_window_not_compared' };
    }
    const city = new hooks.CityClimate(reference.city);
    const methodCategoryId = normId(reference.method_category_id);
    const methodId = normId(reference.method_id);
    const behavior = hooks.resolveMethodBehavior({ methodCategoryId, methodId });
    const env = plant.cropTempEnvelope();
    const budget = plant.firstHarvestBudget();
    const scanStart = asUTCDate(year, 1, 1);
    const scanEndHard = asUTCDate(year + hooks.getPlantScanYears(plant) - 1, 12, 31);
    const daysTransplant = finiteNumberOrDefault(plant.days_transplant, 0);
    const soilGateThresholdC = finiteNumberOrNull(plant.soil_temp_min_plant_c);
    const result = hooks.computeAutoStartEndWindowForward({
        methodCategoryId,
        methodId,
        budget,
        HW_DAYS: hooks.sharedCore.resolveHarvestWindowDays(null, plant),
        dailyRatesMap: city.dailyRates(env.Tbase, year),
        monthlyAvgTemp: city.calibratedMonthlyMeans(year),
        Tbase: env.Tbase,
        cropTemp: env,
        scanStart,
        scanEndHard,
        soilGateThresholdC,
        soilGateConsecutiveDays: 3,
        startCoolingThresholdC: hooks.sharedCore.asCoolingThresholdC(plant.start_cooling_threshold_c),
        useSpringFrostGate: true,
        lastSpringFrostDOY: hooks.sharedCore.pickFrostByRisk(city, 'p50'),
        daysTransplant,
        overwinterAllowed: hooks.sharedCore.isCrossYearCrop(plant),
        bedProfile: null,
        bedProfileSource: 'generic garden bed' // diagnostic default
    });
    if (!result.feasible) return { reason: 'no_feasible_scheduler_window' };
    let start = result.earliestFeasibleSowDate;
    let end = result.lastFeasibleSowDate;
    if (String(reference.stage) === 'transplant' && behavior.leadDaysMode === 'days_transplant') {
        start = addDaysUTC(start, daysTransplant);
        end = addDaysUTC(end, daysTransplant);
    }
    return { start, end };
}

function printReportSummary(report) {
    console.log(`Sowing-window diagnostics: ${report.ok ? 'ok' : 'failed'}`);
    console.log(`DB: ${report.db_path}`);
    console.log(`Year: ${report.year}`);
    console.log(`References: ${report.summary.references}`);
    console.log(`Within tolerance: ${report.summary.within_tolerance}`);
    console.log(`Outside tolerance: ${report.summary.outside_tolerance}`);
    console.log(`Missing scheduler window: ${report.summary.missing_scheduler_window}`);
    if (report.errors.length) {
        console.log('Errors:');
        for (const error of report.errors) console.log(`- ${error}`);
    }
}

function loadConfiguredDbPath(projectRoot) {
    const configPath = path.join(projectRoot, 'trellis_seed.config.json');
    if (!fs.existsSync(configPath)) return null;
    try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        return config.db_path ? path.resolve(projectRoot, config.db_path) : null;
    } catch (_) {
        return null;
    }
}

function tableExists(db, tableName) {
    return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tableName);
}

function referenceLabel(reference) {
    return [
        reference.plant_name || `plant_id=${reference.plant_id}`,
        reference.city_name || `city_id=${reference.city_id}`,
        reference.method_id,
        reference.stage,
        reference.window_label
    ].filter(Boolean).join(' / ');
}

function normId(value) {
    return String(value || '').trim().toLowerCase();
}

function asUTCDate(year, month, day) {
    return new Date(Date.UTC(year, month - 1, day));
}

function addDaysUTC(date, days) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function finiteNumberOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function finiteNumberOrDefault(value, fallback) {
    const number = finiteNumberOrNull(value);
    return number == null ? fallback : number;
}

function mmDdFromDate(date) {
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${month}-${day}`;
}

function mmDdToDoy(value) {
    const parts = String(value || '').split('-').map(part => Number(part));
    if (parts.length !== 2 || !Number.isInteger(parts[0]) || !Number.isInteger(parts[1])) return null;
    const monthDays = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const [month, day] = parts;
    if (month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]) return null;
    return monthDays.slice(0, month - 1).reduce((sum, item) => sum + item, 0) + day;
}

function parseArgs(argv) {
    const args = {};
    for (let index = 0; index < argv.length; index += 1) {
        const item = argv[index];
        if (item === '--db') args.dbPath = argv[++index];
        else if (item === '--out') args.outPath = argv[++index];
        else if (item === '--year') args.year = Number(argv[++index]);
        else if (item === '--tolerance-days') args.toleranceDays = Number(argv[++index]);
        else if (item === '--help' || item === '-h') args.help = true;
        else throw new Error(`Unknown argument: ${item}`);
    }
    return args;
}

function printHelp() {
    console.log('Usage: node ./scripts/trellis_seed_sowing_window_diagnostics.cjs [--db path] [--out path] [--year 2026] [--tolerance-days 14]');
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printHelp();
        return;
    }
    const outPath = path.resolve(args.outPath || DEFAULT_REPORT_PATH);
    const report = runDiagnostics(args);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
    printReportSummary(report);
    console.log(`Report: ${outPath}`);
    if (!report.ok) process.exitCode = 1;
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(error && error.message ? error.message : String(error));
        process.exitCode = 1;
    }
}

module.exports = {
    runDiagnostics,
    loadSchedulerHooks,
    compareReferenceToScheduler,
    computeSchedulerWindow,
    mmDdToDoy,
    openDatabase
};
