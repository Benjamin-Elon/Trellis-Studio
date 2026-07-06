const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom'); // ADDED

const PLUGIN_DIR = path.join(
    __dirname,
    '..',
    '..',
    'drawio',
    'src',
    'main',
    'webapp',
    'plugins',
    'garden_planner_plugins'
);

const SCHEDULER_PATH = path.join(PLUGIN_DIR, 'Garden_Scheduler_Dialog.js');
const SCHEDULER_CORE_PATHS = [
    'Garden_Scheduler_Shared_Core.js',
    'Garden_Scheduler_Annual_Core.js',
    'Garden_Scheduler_Perennial_Core.js'
].map(fileName => path.join(PLUGIN_DIR, fileName));

function loadSchedulerHooks() {
    const dom = new JSDOM('<!doctype html><html><body></body></html>'); // ADDED
    const context = vm.createContext({
        console,
        Date,
        Math,
        Promise,
        setTimeout,
        clearTimeout,
        document: dom.window.document, // ADDED
        window: {
            __TRELLIS_PLANTING_SCHEDULER_TEST__: true,
            document: dom.window.document // ADDED
        },
        Draw: {
            loadPlugin(register) {
                register({ editor: { graph: {} } });
            }
        }
    });

    for (const corePath of SCHEDULER_CORE_PATHS) {
        vm.runInContext(fs.readFileSync(corePath, 'utf8'), context, {
            filename: corePath
        });
    }
    vm.runInContext(fs.readFileSync(SCHEDULER_PATH, 'utf8'), context, {
        filename: SCHEDULER_PATH
    });

    const hooks = context.window.__TRELLIS_PLANTING_SCHEDULER_TEST_HOOKS__;
    if (!hooks) throw new Error('Garden scheduler test hooks were not installed.');
    hooks.__testWindow = context.window;
    return hooks;
}

function makeCity(hooks, meanC = 20) {
    const row = {
        city_name: 'Test City',
        last_spring_frost_doy: 1
    };
    for (let month = 1; month <= 12; month += 1) {
        row[`avg_monthly_high_c${month}`] = meanC + 2;
        row[`avg_monthly_low_c${month}`] = meanC - 2;
    }
    return new hooks.CityClimate(row);
}

function makePlant(hooks, overrides = {}) {
    return new hooks.PlantModel({
        plant_id: 1,
        plant_name: 'Test Plant',
        annual: 1,
        biennial: 0,
        perennial: 0,
        lifespan_years: 1,
        overwinter_ok: 0,
        days_maturity: 30,
        gdd_to_maturity: null,
        days_transplant: 0,
        days_germ: 5,
        harvest_window_days: 7,
        tbase_c: 5,
        tmin_c: 0,
        topt_low_c: 15,
        topt_high_c: 25,
        tmax_c: 40,
        killtemp_c: null,
        soil_temp_min_plant_c: null,
        start_cooling_threshold_c: null,
        yield_per_plant_kg: 1,
        ...overrides
    });
}

function makeInputs(hooks, {
    plant = makePlant(hooks),
    city = makeCity(hooks),
    planningMode = 'direct_sow',
    methodCategoryId = 'direct_sow',
    methodId = 'direct_sow.field',
    startISO = '2026-04-01',
    seasonEndISO = '2026-12-31',
    seasonStartYear = 2026,
    harvestWindowDays = 7,
    minYieldMultiplier = 0,
    policy = null,
    dailyClimate = null
} = {}) {
    return new hooks.ScheduleInputs({
        plant,
        city,
        planningMode,
        methodCategoryId,
        methodId,
        startISO,
        seasonEndISO,
        policy: policy || new hooks.PolicyFlags({
            useSpringFrostGate: false,
            useSoilTempGate: false,
            overwinterAllowed: plant.isBiennial() || plant.isPerennial() || plant.overwinter_ok === 1
        }),
        seasonStartYear,
        harvestWindowDays,
        minYieldMultiplier,
        dailyClimate
    });
}

function makeRepeatRule(overrides = {}) {
    return {
        id: 'water',
        title: 'Water {plant}',
        startAnchorStage: 'SOW',
        startOffsetDays: 0,
        startOffsetDirection: 'after',
        endMode: 'fixed_days',
        durationDays: 0,
        repeatMode: 'interval',
        repeatEveryDays: 7,
        repeatUntilMode: 'x_times',
        repeatTimes: 5,
        repeatUntilAnchorStage: 'HARVEST_END',
        repeatCutoffOffsetDays: 0,
        repeatCutoffOffsetDirection: 'after',
        ...overrides
    };
}

module.exports = {
    loadSchedulerHooks,
    makeCity,
    makeInputs,
    makePlant,
    makeRepeatRule,
    SCHEDULER_PATH,
    SCHEDULER_CORE_PATHS
};
