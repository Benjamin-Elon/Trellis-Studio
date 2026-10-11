const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    loadSchedulerHooks,
    makeCity,
    makeInputs,
    makePlant
} = require('./helpers/garden-scheduler-harness.cjs');

const hooks = loadSchedulerHooks();
const schedulerSource = fs.readFileSync(path.join(__dirname, '..', 'drawio', 'src', 'main', 'webapp', 'plugins', 'garden_planner_plugins', 'Garden_Scheduler_Dialog.js'), 'utf8');

function makeCrop(overrides = {}) {
    return makePlant(hooks, {
        plant_id: overrides.plant_id ?? 1,
        plant_name: overrides.plant_name || 'Crop',
        abbr: overrides.abbr || '',
        ...overrides
    });
}

test('crop lifecycle classification requires exactly one lifecycle flag', () => {
    assert.equal(hooks.getCropLifecycle(makeCrop({ annual: 1, biennial: 0, perennial: 0 })), 'annual');
    assert.equal(hooks.getCropLifecycle(makeCrop({ annual: 0, biennial: 1, perennial: 0 })), 'biennial');
    assert.equal(hooks.getCropLifecycle(makeCrop({ annual: 0, biennial: 0, perennial: 1 })), 'perennial');
    assert.equal(hooks.getCropLifecycle(makeCrop({ annual: 1, biennial: 1, perennial: 0 })), 'uncategorized');
    assert.equal(hooks.getCropLifecycle(makeCrop({ annual: 0, biennial: 0, perennial: 0 })), 'uncategorized');
});

test('harvest request method resolver accepts complete and legacy dotted method context', () => {
    assert.deepEqual(JSON.parse(JSON.stringify(hooks.resolveHarvestRequestMethodBehavior({
        methodId: 'direct_sow.field',
        methodCategoryId: 'direct_sow'
    }))), {
        methodCategoryId: 'direct_sow',
        methodId: 'direct_sow.field',
        planningMode: 'direct_sow',
        usesSoilTempGate: true,
        leadDaysMode: 'none'
    });

    assert.equal(hooks.resolveHarvestRequestMethodBehavior({
        methodId: 'transplant.indoor'
    }).methodCategoryId, 'transplant');
});

test('harvest request method resolver rejects missing or mismatched category context', () => {
    assert.throws(
        () => hooks.resolveHarvestRequestMethodBehavior({ methodId: 'direct_sow' }),
        /methodCategoryId is required/
    );
    assert.throws(
        () => hooks.resolveHarvestRequestMethodBehavior({ methodId: 'direct_sow.field', methodCategoryId: 'transplant' }),
        /does not belong to methodCategoryId "transplant"/
    );
});

test('growth stage ratio scales timing and layout with sqrt defaults', () => {
    const plant = makeCrop({
        gdd_to_maturity: 500,
        days_maturity: 50,
        spacing_cm: 30,
        spacing_x_cm: 30,
        spacing_y_cm: 40,
        veg_diameter_cm: 20,
        veg_height_cm: 10
    });
    const stage = hooks.normalizeGrowthStage({
        stage_key: 'microgreens',
        stage_label: 'Microgreens',
        gdd_ratio: 0.25
    });
    const effective = hooks.applyGrowthStageToPlant(plant, stage);
    assert.equal(effective.gdd_to_maturity, 125);
    assert.equal(effective.days_maturity, 12.5);
    assert.equal(effective.spacing_cm, 15);
    assert.equal(effective.spacing_x_cm, 15);
    assert.equal(effective.spacing_y_cm, 20);
    assert.equal(effective.veg_diameter_cm, 10);
    assert.equal(effective.veg_height_cm, 5);
    assert.equal(effective.growth_stage_key, 'microgreens');
});

test('growth stage explicit layout ratios override sqrt derivation', () => {
    const plant = makeCrop({ days_maturity: 100, spacing_cm: 30, veg_diameter_cm: 20, veg_height_cm: 10 });
    const effective = hooks.applyGrowthStageToPlant(plant, hooks.normalizeGrowthStage({
        stage_key: 'baby',
        stage_label: 'Baby',
        gdd_ratio: 0.25,
        spacing_ratio: 0.75,
        plant_diameter_ratio: 0.6,
        plant_height_ratio: 0.8
    }));
    assert.equal(effective.days_maturity, 25);
    assert.equal(effective.spacing_cm, 22.5);
    assert.equal(effective.veg_diameter_cm, 12);
    assert.equal(effective.veg_height_cm, 8);
});

test('missing and legacy saved growth stages normalize for scheduler reopen', () => {
    const missing = hooks.readGrowthStageFromCell({ getAttribute: () => '' });
    assert.equal(missing.stageKey, 'mature');
    assert.equal(missing.gddRatio, 1);
    assert.equal(missing.spacingRatio, 1);

    const attrs = {
        growth_stage_key: 'microgreens',
        growth_stage_label: 'Microgreens',
        growth_stage_gdd_ratio: '0.25',
        growth_stage_spacing_ratio: '0.6',
        growth_stage_diameter_ratio: '0.55',
        growth_stage_height_ratio: '0.5'
    };
    const legacy = hooks.readGrowthStageFromCell({ getAttribute: key => attrs[key] || '' });
    assert.equal(legacy.stageKey, 'microgreens');
    assert.equal(legacy.stageLabel, 'Microgreens');
    assert.equal(legacy.gddRatio, 0.25);
    assert.equal(legacy.spacingRatio, 0.6);
    assert.equal(legacy.plantDiameterRatio, 0.55);
    assert.equal(legacy.plantHeightRatio, 0.5);
    assert.equal(legacy.legacy, true);
});

test('growth stage table schema and editor validation stay aligned', () => {
    assert.match(schedulerSource, /plant_id INTEGER NOT NULL REFERENCES Plants\(plant_id\) ON DELETE CASCADE/);
    assert.match(schedulerSource, /growthStageStatus\.textContent = 'Growing stage error: ' \+ \(e\?\.message \|\| String\(e\)\);/);
    assert.match(schedulerSource, /stages\.push\(normalizeGrowthStage\(Object\.assign\(\{\}, preferred, \{ legacy: true \}\)\)\);/);
    assert.match(schedulerSource, /label: stage\.legacy \? `\$\{stage\.stageLabel\} \(saved\)` : stage\.stageLabel/);
});

test('lifecycle filter control reads and persists the shared crop filter preference', () => {
    const store = new Map([['trellis.scheduler.cropLifecycleFilter', 'perennial']]);
    hooks.__testWindow.localStorage = {
        getItem: key => store.has(key) ? store.get(key) : null,
        setItem: (key, value) => { store.set(key, value); }
    };
    const control = hooks.buildLifecycleFilterControl();
    assert.equal(control.value, 'perennial');
    control.value = 'annual';
    control.dispatchEvent(new hooks.__testWindow.document.defaultView.Event('change'));
    assert.equal(store.get('trellis.scheduler.cropLifecycleFilter'), 'annual');
});

test('grouped crop options filter by lifecycle and auto-show hidden current selection', () => {
    const crops = [
        makeCrop({ plant_id: 1, plant_name: 'Tomato', annual: 1, biennial: 0, perennial: 0 }),
        makeCrop({ plant_id: 2, plant_name: 'Rhubarb', annual: 0, biennial: 0, perennial: 1 })
    ];
    const groups = hooks.buildGroupedCropOptions(hooks.makeCropPickerOptions(crops), {
        filter: 'perennial',
        selectedValue: '1',
        includeSelectedWhenFiltered: true
    });
    assert.deepEqual(Array.from(groups, group => group.label), ['Current selection', 'Perennial crops']);
    assert.deepEqual(Array.from(groups, group => Array.from(group.options, option => option.label)), [['Tomato'], ['Rhubarb']]);
});

test('empty lifecycle filter renders an explicit disabled placeholder', () => {
    const document = hooks.__testWindow.document;
    const select = document.createElement('select');
    hooks.renderGroupedCropOptions(select, [], '');
    assert.equal(select.options.length, 1);
    assert.equal(select.options[0].textContent, 'No crops match this filter');
    assert.equal(select.options[0].disabled, true);
});

test('sowing-window scoring ranks inside windows before nearest outside windows', () => {
    const windows = [
        { id: 'spring', label: 'Spring', startISO: '2026-03-01', endISO: '2026-05-31' },
        { id: 'fall', label: 'Fall', startISO: '2026-08-15', endISO: '2026-09-15' }
    ];
    const inside = hooks.scoreSowingWindowsForDate(windows, '2026-04-01');
    const before = hooks.scoreSowingWindowsForDate(windows, '2026-08-01');
    const after = hooks.scoreSowingWindowsForDate(windows, '2026-09-29');
    assert.equal(inside.rankClass, 0);
    assert.equal(inside.hint, '66% window left');
    assert.equal(before.rankClass, 1);
    assert.equal(before.hint, 'Starts in 14d');
    assert.equal(after.rankClass, 1);
    assert.equal(after.hint, '14d late');
});

test('sowing season selector labels include relative timing', () => {
    const windows = [
        { id: 'spring', label: 'Spring (Mar 1-May 31)', startISO: '2026-03-01', endISO: '2026-05-31' },
        { id: 'winter', label: 'Winter (Nov 22-Dec 31)', startISO: '2026-11-22', endISO: '2026-12-31', riskSummary: '100% window left' }
    ];

    assert.equal(hooks.formatSowingSeasonRelativeTiming(windows[0], '2026-03-15'), '77 days left');
    assert.equal(hooks.formatSowingSeasonRelativeTiming(windows[1], '2026-11-01'), 'Starts in 21 days');
    assert.equal(hooks.formatSowingSeasonRelativeTiming(windows[0], '2026-06-10'), 'Ended 10 days ago');

    const state = hooks.buildSowingSeasonSelectorState({
        sowingSeasons: windows,
        activeSowingSeasonId: 'winter',
        todayISO: '2026-11-01'
    });
    assert.equal(state.options[1].label, 'Winter (Nov 22-Dec 31) - Starts in 21 days - 100% window left');
    assert.equal(state.boundsText, '2026-11-22 to 2026-12-31 - Starts in 21 days');
    assert.equal(state.timingText, 'Starts in 21 days');
});

test('crop option sorting prefers suitability then name within lifecycle groups', () => {
    const crops = [
        makeCrop({ plant_id: 1, plant_name: 'Late Crop', annual: 1, biennial: 0, perennial: 0 }),
        makeCrop({ plant_id: 2, plant_name: 'Best Crop', annual: 1, biennial: 0, perennial: 0 }),
        makeCrop({ plant_id: 3, plant_name: 'Near Crop', annual: 1, biennial: 0, perennial: 0 })
    ];
    const scores = new Map([
        ['1', { rankClass: 0, percentRemaining: 25, distanceDays: 0, hint: '25% window left' }],
        ['2', { rankClass: 0, percentRemaining: 80, distanceDays: 0, hint: '80% window left' }],
        ['3', { rankClass: 1, percentRemaining: -1, distanceDays: 2, hint: 'Starts in 2d' }]
    ]);
    const groups = hooks.buildGroupedCropOptions(hooks.makeCropPickerOptions(crops, scores), { filter: 'annual' });
    assert.deepEqual(Array.from(groups[0].options, option => option.label), ['Best Crop', 'Late Crop', 'Near Crop']);
    assert.equal(groups[0].options[0].displayLabel, 'Best Crop - 80% window left');
});

test('proposeLifecycle returns lifecycle metadata and task preview without graph mutation', async () => {
    const template = {
        version: 2,
        rules: [{
            id: 'prep',
            title: 'Prep {plant}',
            startAnchorStage: 'SOW',
            startOffsetDays: 0,
            startOffsetDirection: 'after',
            endMode: 'fixed_days',
            durationDays: 0,
            repeatMode: 'none'
        }]
    };

    const proposal = await hooks.proposeLifecycle({
        plant: makePlant(hooks, { plant_name: 'Lettuce', days_maturity: 30, harvest_window_days: 7 }),
        city: makeCity(hooks, 18),
        methodId: 'direct_sow.field',
        methodCategoryId: 'direct_sow',
        primaryDateISO: '2026-04-01',
        seasonStartYear: 2026,
        taskTemplate: template
    });

    assert.equal(proposal.ok, true);
    assert.equal(proposal.attributePatch.sow_date, '2026-04-01');
    assert.equal(proposal.attributePatch.harvest_start, '2026-05-01');
    assert.equal(proposal.attributePatch.harvest_end, '2026-05-08');
    assert.equal(proposal.taskPreview.length, 1);
    assert.match(proposal.taskPreview[0].title, /Prep/);
    assert.match(proposal.taskPreview[0].title, /Lettuce/);
});

test('proposeLifecycle can choose the earliest calculable bed-entry day in a week', async () => {
    const proposal = await hooks.proposeLifecycle({
        plant: makePlant(hooks, { plant_name: 'Lettuce', days_maturity: 30, harvest_window_days: 7 }),
        city: makeCity(hooks, 18),
        methodId: 'direct_sow.field',
        methodCategoryId: 'direct_sow',
        weekStartISO: '2026-04-01',
        weekEndISO: '2026-04-07',
        chooseBestFeasibleDay: true,
        seasonStartYear: 2026
    });

    assert.equal(proposal.ok, true);
    assert.equal(proposal.primaryDateISO, '2026-04-01');
    assert.equal(proposal.attributePatch.sow_date, '2026-04-01');
});


test('proposeLifecycleForDemandWindow back-schedules sow date from future demand', async () => {
    const proposal = await hooks.proposeLifecycleForDemandWindow({
        plant: makePlant(hooks, { plant_name: 'Radish', days_maturity: 30, harvest_window_days: 7 }),
        city: makeCity(hooks, 18),
        methodId: 'direct_sow.field',
        methodCategoryId: 'direct_sow',
        targetStartISO: '2026-06-07',
        targetEndISO: '2026-06-13',
        seasonStartYear: 2026
    });

    assert.equal(proposal.ok, true);
    assert.equal(proposal.startISO, '2026-05-14');
    assert.equal(proposal.primaryDateISO, '2026-05-14');
    assert.ok(proposal.attributePatch.harvest_start <= '2026-06-13');
    assert.ok(proposal.attributePatch.harvest_end >= '2026-06-07');
});
test('proposeLifecycle reports overrideable warnings separately from structural failures', async () => {
    const proposal = await hooks.proposeLifecycle({
        plant: makePlant(hooks, { plant_name: 'Lettuce', days_maturity: 30, harvest_window_days: 7 }),
        city: makeCity(hooks, 18),
        methodId: 'direct_sow.field',
        methodCategoryId: 'direct_sow',
        primaryDateISO: '2026-04-01',
        seasonStartYear: 2026,
        minYieldMultiplier: 2
    });

    assert.equal(proposal.ok, true);
    assert.equal(proposal.status, 'warning');
    assert.ok(proposal.warnings.length);

    const failure = await hooks.proposeLifecycle({
        plant: makePlant(hooks, { plant_name: 'Lettuce', days_maturity: 30, harvest_window_days: 7 }),
        city: makeCity(hooks, 18),
        methodId: 'direct_sow.field',
        methodCategoryId: 'direct_sow',
        primaryDateISO: '',
        seasonStartYear: 2026
    });
    assert.equal(failure.ok, false);
    assert.equal(failure.status, 'structural_failure');
});

test('Scheduler exposes Allocate resolver and draft editing contracts', () => {
    assert.equal(typeof hooks.resolvePlantForPlanCrop, 'function');
    assert.equal(typeof hooks.resolveCityForModule, 'function');
    assert.equal(typeof hooks.openDraftScheduleDialog, 'function');
    assert.equal(typeof hooks.openAllocationScheduleDialog, 'function');
    assert.equal(typeof hooks.resolveAllocationDefaultStatus, 'function');
    assert.match(schedulerSource, /resolvePlantForPlanCrop,/);
    assert.match(schedulerSource, /resolveCityForModule,/);
    assert.match(schedulerSource, /openAllocationScheduleDialog/);
    assert.match(schedulerSource, /persistAllocationReusableDefaults/);
    assert.match(schedulerSource, /saveVarietyTemplate/);
});

test('allocation draft target retains dates and rules without becoming a graph cell', () => { // CHANGE
    const fixture = allocationSchedulerFixture();
    const template = { version: 2, rules: [{ id: 'prep', startOffsetDays: 3, startOffsetDirection: 'before', repeatMode: 'none' }] };
    fixture.draft.lifecycle = { attributePatch: { harvest_end: '2026-05-08' }, taskTemplate: template };
    const target = fixture.api.allocationSchedulerTarget(fixture.draft);
    assert.equal(target.getId(), null);
    assert.equal(target.parent, fixture.draft.moduleCell);
    assert.equal(target.getAttribute('variety_id'), '7');
    assert.equal(target.getAttribute('sow_date'), '2026-04-01');
    assert.equal(target.getAttribute('harvest_end'), '2026-05-08');
    assert.equal(target.getAttribute('task_template_json'), JSON.stringify(template));
});

test('allocation reusable task defaults persist actual rules rather than dated task occurrences', async () => { // CHANGE
    const fixture = allocationSchedulerFixture();
    const template = { version: 2, rules: [{ id: 'prep', title: 'Prep {plant}', startAnchorStage: 'SOW', startOffsetDays: 3, startOffsetDirection: 'before', endMode: 'fixed_days', durationDays: 3, repeatMode: 'none' }] };
    fixture.draft.lifecycle = { taskTemplate: template };
    fixture.draft.taskPreview = [{ title: 'Different dated occurrence', startISO: '2026-03-29' }];
    const result = await fixture.api.persistAllocationReusableDefaults(fixture.draft, { defaultStatus: { missing: ['tasks'] } });
    assert.deepEqual(Array.from(result.saved), ['tasks']);
    const write = fixture.writes.find(write => /INSERT INTO VarietyTaskTemplates/i.test(write.sql));
    assert.ok(write);
    assert.ok(write.params.includes(JSON.stringify(template)));
});

/** Reference-data bridge exercises real template resolution and the complete scheduler, without Electron or a database write. */ // CHANGE
function allocationSchedulerFixture({ varietyTemplate = null, plantTemplate = null, varietyOverrides = {}, relationships = [], neighbors = [], setDefault = null, trackDefaultWrites = false, missingMethod = false, growthStages = [] } = {}) { // CHANGE: stateful defaults exercise the required-save/readiness loop through real model services.
    let plant, city;
    const writes = [];
    const queries = [];
    const defaultFailure = { key: '' }; // CHANGE: inject one storage failure without replacing production persistence.
    const method = { method_id: 'direct_sow.field', method_category_id: 'direct_sow', method_name: 'Field direct sow', tasks_required_json: '{"sow":true,"prep":true}' }; // CHANGE
    const indoorMethod = { method_id: 'transplant.indoor', method_category_id: 'transplant', method_name: 'Indoor transplant', tasks_required_json: '{"sow":true,"transplant":true}' }; // CHANGE
    const dbBridge = { resolvePath: async () => ({ dbPath: 'allocation-fixture' }), open: async () => ({ dbId: 'fixture' }), close: async () => ({}),
        exec: async (id, sql, params = []) => { // CHANGE
            writes.push({ sql, params }); // CHANGE
            if (defaultFailure.key === 'tasks' && /INSERT INTO VarietyTaskTemplates/.test(sql)) throw new Error('Task default storage failed'); // CHANGE
            if (defaultFailure.key === 'grownFor' && /INSERT INTO PlantGrowthStages/.test(sql)) throw new Error('Grown-for default storage failed'); // CHANGE
            if (trackDefaultWrites) { // CHANGE
                if (/UPDATE PlantVarieties/.test(sql)) varietyOverrides = JSON.parse(params[0]); // CHANGE
                if (/INSERT INTO VarietyTaskTemplates/.test(sql)) varietyTemplate = JSON.parse(params[2]); // CHANGE
                if (/INSERT INTO PlantTaskTemplates/.test(sql)) plantTemplate = JSON.parse(params[2]); // CHANGE
                if (/DELETE FROM PlantGrowthStages/.test(sql)) growthStages = []; // CHANGE
                if (/INSERT INTO PlantGrowthStages/.test(sql)) growthStages.push({ plant_id: params[0], stage_key: params[1], stage_label: params[2], gdd_ratio: params[3], yield_ratio: params[4], active: params[9], is_default: params[10] }); // CHANGE
            } // CHANGE
            return {}; // CHANGE
        }, // CHANGE
        query: async (id, sql, params = []) => {
            queries.push({ sql, params });
            let rows = [];
            if (/FROM\s+Plants\b/i.test(sql)) rows = [plant];
            else if (/FROM\s+Cities\b/i.test(sql)) rows = [city];
            else if (/FROM\s+PlantAllowedMethodCategories\b/i.test(sql)) rows = [{ plant_id: 1, method_category_id: 'direct_sow', method_category_name: 'Direct sow' }, { plant_id: 1, method_category_id: 'transplant', method_category_name: 'Transplant' }]; // CHANGE
            else if (/FROM\s+PlantingMethods\b/i.test(sql)) rows = params.includes('transplant') ? [indoorMethod] : [method]; // CHANGE
            else if (/FROM\s+PlantVarieties\b/i.test(sql)) rows = [{ plant_id: 1, variety_id: 7, variety_name: 'Test variety', overrides_json: JSON.stringify(varietyOverrides) }]; // CHANGE
            else if (/FROM Companions c/i.test(sql)) rows = relationships; // CHANGE
            else if (/FROM CompanionSetLayoutDefaults/i.test(sql) && setDefault && params[0] === setDefault.crop_set_key) rows = [setDefault]; // CHANGE
            else if (/FROM\s+VarietyTaskTemplates\b/i.test(sql) && varietyTemplate && params[0] === 7) rows = [{ template_json: JSON.stringify(varietyTemplate) }];
            else if (/FROM\s+PlantTaskTemplates\b/i.test(sql) && plantTemplate) rows = [{ plant_id: 1, method_id: method.method_id, template_json: JSON.stringify(plantTemplate) }];
            else if (/FROM\s+PlantGrowthStages\b/i.test(sql)) rows = growthStages; // CHANGE
            return { rows };
        }
    };
    const api = loadSchedulerHooks({ dbBridge });
    plant = makePlant(api, { plant_name: 'Lettuce', default_planting_method: missingMethod ? null : method.method_id, default_planting_method_category: method.method_category_id, spacing_cm: 30 }); // CHANGE
    city = makeCity(api); city.city_id = 1;
    const moduleCell = { id: 'module', getAttribute: () => null };
    const bed = { id: 'bed', parent: moduleCell, getAttribute: key => key === 'garden_bed' ? '1' : null, getGeometry: () => ({ x: 0, y: 0, width: 200, height: 100 }) };
    let graphWrites = 0, dialog, onClose;
    const model = { getParent: cell => cell?.parent || null, getRoot: () => ({ children: [] }), getCell: id => neighbors.find(cell => cell.id === id) || null, // CHANGE
        getChildCount: cell => cell?.children?.length || 0, getChildAt: (cell, index) => cell.children[index], beginUpdate() { graphWrites++; }, endUpdate() {}, execute() { graphWrites++; } };
    const graph = { getModel: () => model, getSelectionCell: () => bed, __trellisBedSuccessionNavigator: { getSelectedClusterOccupancy: () => ({ items: [] }) } };
    const ui = { editor: { graph }, showDialog(node, width, height, modal, closable, close) { dialog = node; onClose = close; api.__testWindow.document.body.appendChild(node); }, hideDialog() { dialog?.remove(); onClose?.(); } };
    const draft = { allocationYear: 2026, moduleCell, bed, bedProfile: null, city,
        crop: { plantId: '1', varietyId: '7', label: 'Lettuce - Test variety', method: method.method_id },
        plantResolution: { ok: true, plant, plantId: '1', varietyId: '7', varietyName: 'Test variety' }, actionStartISO: '2026-04-01', targetDemandStartISO: '2026-05-01', targetDemandEndISO: '2026-05-08' }; // CHANGE
    return { api, plant, city, ui, draft, writes, queries, defaultFailure, getOverrides: () => varietyOverrides, getDialog: () => dialog, getGraphWrites: () => graphWrites }; // CHANGE
} // CHANGE

async function waitForSchedulerDialog(fixture) { // CHANGE
    const start = Date.now();
    while (!fixture.getDialog() && Date.now() - start < 10000) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(fixture.getDialog(), 'the full scheduler should open');
    return fixture.getDialog();
} // CHANGE

/** Open explicit required-default setup with the same demand-derived lifecycle used by allocation. */ // CHANGE
async function requiredDefaultsDialog(fixture, focusMissingDefault = null) { // CHANGE
    fixture.draft.lifecycle = await fixture.api.proposeLifecycle({ plant: fixture.plant, city: fixture.city, primaryDateISO: fixture.draft.actionStartISO, methodId: 'direct_sow.field', methodCategoryId: 'direct_sow', seasonStartYear: 2026 }); // CHANGE
    const status = await fixture.api.resolveAllocationDefaultStatus(fixture.draft); // CHANGE
    const pending = fixture.api.openAllocationScheduleDialog(fixture.ui, fixture.draft, { previewOnly: true, defaultStatus: status, requiredDefaults: status.missing, focusMissingDefault }); // CHANGE
    return { pending, dialog: await waitForSchedulerDialog(fixture), status }; // CHANGE
} // CHANGE

for (const key of ['method', 'tasks', 'grownFor']) test(`required ${key} default is highlighted, checked and locked without writes on cancellation`, async () => { // CHANGE
    const template = { version: 2, rules: [] }; // CHANGE
    const fixture = allocationSchedulerFixture({ missingMethod: key === 'method', varietyTemplate: key === 'tasks' ? null : template, growthStages: key === 'grownFor' ? [] : [{ stage_key: 'mature', stage_label: 'Mature', active: 1 }] }); // CHANGE
    const { pending, dialog, status } = await requiredDefaultsDialog(fixture, key); // CHANGE
    assert.deepEqual(Array.from(status.missing), [key]); // CHANGE
    const selector = { method: '[data-allocation-save-lifecycle]', tasks: '[data-allocation-save-tasks]', grownFor: '[data-allocation-save-grown-for]' }[key]; // CHANGE
    const checkbox = dialog.querySelector(selector); assert.ok(checkbox.checked && checkbox.disabled); // CHANGE
    const note = dialog.querySelector(`[data-allocation-required-field="${key}"]`); assert.match(note.textContent, /Required default not saved/); assert.ok(note.parentElement.style.outline.includes('d97706')); // CHANGE
    assert.ok(Array.from(dialog.querySelectorAll('button')).some(button => button.textContent === 'Save defaults & preview')); // CHANGE
    if (key === 'tasks') assert.match(Array.from(dialog.querySelectorAll('button')).find(button => button.textContent.startsWith('Tasks')).textContent, /default required/); // CHANGE
    if (key === 'method') assert.equal(fixture.api.__testWindow.document.activeElement.disabled, false); else assert.equal(fixture.api.__testWindow.document.activeElement, note); // CHANGE
    if (key === 'tasks') Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === 'Schedule').click(); // CHANGE: inspect the fixed dates on their own tab.
    assert.equal(dialog.querySelector('[data-allocation-start-date]').readOnly, true); // CHANGE
    assert.equal(fixture.writes.some(write => /^\s*(INSERT|UPDATE|DELETE)\b/.test(write.sql)), false); // CHANGE
    Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === 'Cancel').click(); await pending; // CHANGE
    assert.equal(fixture.getGraphWrites(), 0); assert.equal(fixture.writes.some(write => /^\s*(INSERT|UPDATE|DELETE)\b/.test(write.sql)), false); // CHANGE
}); // CHANGE

test('required defaults save before creation, preserve variety overrides, return a preview, and do not save twice after Create', async () => { // CHANGE
    const fixture = allocationSchedulerFixture({ trackDefaultWrites: true, missingMethod: true, varietyOverrides: { spacing_cm: 17, notes: 'preserve' } }); // CHANGE
    const { pending, dialog, status } = await requiredDefaultsDialog(fixture, 'method'); assert.equal(status.missing.length, 3); // CHANGE
    const submit = Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === 'Save defaults & preview'); // CHANGE
    submit.click(); submit.dispatchEvent(new dialog.ownerDocument.defaultView.Event('click')); // CHANGE: even queued repeated submission cannot duplicate default writes.
    const result = await pending; assert.equal(result.action, 'preview'); assert.equal(fixture.getGraphWrites(), 0); // CHANGE
    assert.equal((await fixture.api.resolveAllocationDefaultStatus(result.draft)).complete, true); // CHANGE
    assert.equal(fixture.getOverrides().spacing_cm, 17); assert.equal(fixture.getOverrides().notes, 'preserve'); // CHANGE
    const defaultWrites = () => fixture.writes.filter(write => /UPDATE PlantVarieties|INSERT INTO VarietyTaskTemplates|INSERT INTO PlantGrowthStages/.test(write.sql)).length; // CHANGE
    assert.equal(defaultWrites(), 3); assert.equal(result.draft.saveLifecycleDefaults, false); // CHANGE
    await result.draft.commitAllocationDefaults(allocationNeighbor('created', 1, 7)); assert.equal(defaultWrites(), 3); // CHANGE
}); // CHANGE

test('a partial required-default save leaves setup open, lists remaining records, and retries without overwriting the saved method', async () => { // CHANGE
    const fixture = allocationSchedulerFixture({ trackDefaultWrites: true, missingMethod: true, varietyOverrides: { notes: 'preserve' } }); fixture.defaultFailure.key = 'tasks'; // CHANGE
    const { pending, dialog } = await requiredDefaultsDialog(fixture, 'tasks'); // CHANGE
    const submit = Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === 'Save defaults & preview'); submit.click(); // CHANGE
    await waitForAllocationState(() => dialog.textContent.includes('Task default storage failed')); // CHANGE
    assert.equal(fixture.getGraphWrites(), 0); assert.equal((await fixture.api.resolveAllocationDefaultStatus(fixture.draft)).complete, false); // CHANGE
    assert.match(dialog.querySelector('[data-allocation-required-summary]').textContent, /Task recipe, Grown-for stage/); // CHANGE
    assert.equal(dialog.querySelector('[data-allocation-save-lifecycle]').disabled, false); // CHANGE
    fixture.defaultFailure.key = ''; submit.click(); const result = await pending; // CHANGE
    assert.equal(result.action, 'preview'); assert.equal((await fixture.api.resolveAllocationDefaultStatus(result.draft)).complete, true); // CHANGE
    assert.equal(fixture.writes.filter(write => /UPDATE PlantVarieties/.test(write.sql)).length, 1); // CHANGE
    assert.equal(fixture.getOverrides().notes, 'preserve'); // CHANGE
}); // CHANGE

test('allocation Edit opens the full scheduler with fixed crop identity and returns preview without graph writes', async () => { // CHANGE
    const fixture = allocationSchedulerFixture();
    const { api, ui, draft } = fixture;
    const pending = api.openAllocationScheduleDialog(ui, draft, { previewOnly: true, defaultStatus: { complete: true, missing: [] } });
    const dialog = await waitForSchedulerDialog(fixture);
    assert.match(dialog.textContent, /Planting Scheduler/);
    assert.equal(dialog.querySelector('[data-allocation-crop-identity="fixed"]').textContent, draft.crop.label);
    for (const row of dialog.querySelectorAll('.usl-scheduler-row--crop-picker,.usl-scheduler-row--crop-variety')) { // CHANGE: responsive CSS cannot expose mutable crop controls.
        assert.equal(row.style.getPropertyPriority('display'), 'important');
        assert.equal(Array.from(row.querySelectorAll('button, input, select')).every(control => control.disabled), true);
    } // CHANGE
    const grownFor = Array.from(dialog.querySelectorAll('select')).find(select => select.closest('.usl-scheduler-row')?.textContent.includes('Grown for')); // CHANGE
    assert.ok(grownFor && grownFor.disabled, 'Year Plan growth stage must be visible and fixed'); // CHANGE
    const buttons = Array.from(dialog.querySelectorAll('button'));
    assert.ok(buttons.find(node => node.textContent === 'Tasks'));
    assert.ok(buttons.find(node => node.textContent === 'Schedule'));
    const date = Array.from(dialog.querySelectorAll('input[type="date"]')).find(node => node.value === '2026-04-01');
    assert.ok(date);
    assert.equal(date.readOnly, true); // CHANGE: allocation dates remain demand-derived even if an input event is dispatched.
    date.value = '2026-04-02'; date.dispatchEvent(new api.__testWindow.document.defaultView.Event('input', { bubbles: true }));
    buttons.find(node => node.textContent === 'Preview Planting').click();
    const result = await Promise.race([pending, new Promise((resolve, reject) => setTimeout(() => reject(new Error(dialog.textContent.slice(0, 1400))), 1500))]); // CHANGE: failed submission reports the actual inline validation reason.
    assert.equal(result.action, 'preview');
    assert.equal(result.draft.lifecycle.ok, true);
    assert.equal(result.draft.actionStartISO, '2026-04-01'); // CHANGE: lifecycle unlock never enables arbitrary allocation date edits.
    assert.ok(result.draft.taskPreview.length > 0);
    assert.equal(result.draft.lifecycle.attributePatch.task_template_json, JSON.stringify(result.draft.lifecycle.taskTemplate));
    assert.equal(fixture.getGraphWrites(), 0);
    assert.equal(fixture.writes.some(write => /^(INSERT|UPDATE|DELETE)\b/i.test(write.sql.trim())), false);
});

/** Wait for observable async allocation state rather than relying on a fixed recomputation delay. */ // CHANGE
async function waitForAllocationState(predicate) { // CHANGE
    const deadline = Date.now() + 10000; // CHANGE
    while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10)); // CHANGE
    assert.ok(predicate(), 'allocation state should settle'); // CHANGE
} // CHANGE

test('allocation locks lifecycle by default, preserves edits when relocked, and keeps footer defaults on Tasks', async () => { // CHANGE
    const fixture = allocationSchedulerFixture(); // CHANGE
    const pending = fixture.api.openAllocationScheduleDialog(fixture.ui, fixture.draft, { previewOnly: true }); // CHANGE
    const dialog = await waitForSchedulerDialog(fixture); // CHANGE
    const lock = dialog.querySelector('[data-allocation-lifecycle-lock]'); // CHANGE
    const harvest = Array.from(dialog.querySelectorAll('input')).find(input => input.closest('.usl-scheduler-row')?.textContent.includes('Harvest window')); // CHANGE
    const method = Array.from(dialog.querySelectorAll('select')).find(select => select.closest('.usl-scheduler-row')?.textContent.includes('Planting method')); // CHANGE
    assert.ok(lock.checked && harvest.disabled && method.disabled); // CHANGE
    const event = new fixture.api.__testWindow.document.defaultView.Event('change', { bubbles: true }); // CHANGE
    lock.checked = false; lock.dispatchEvent(event); // CHANGE
    assert.equal(harvest.disabled, false); assert.equal(method.disabled, false); // CHANGE
    assert.equal(dialog.querySelector('[data-allocation-start-date]').readOnly, true); // CHANGE
    harvest.value = '11'; lock.checked = true; lock.dispatchEvent(event); // CHANGE
    assert.equal(harvest.value, '11'); assert.equal(harvest.disabled, true); // CHANGE
    Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === 'Tasks').click(); // CHANGE
    await waitForAllocationState(() => dialog.querySelector('.usl-scheduler-tab[data-active="true"]')?.textContent === 'Tasks'); // CHANGE
    assert.ok(dialog.querySelector('.usl-scheduler-footer [data-allocation-save-lifecycle]')); // CHANGE
    assert.equal(dialog.querySelector('[data-allocation-save-lifecycle]').checked, false); // CHANGE
    assert.equal(dialog.querySelector('[data-allocation-save-spacing]').disabled, true); // CHANGE
    Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === 'Cancel').click(); // CHANGE
    assert.equal((await pending).action, 'cancel'); // CHANGE
}); // CHANGE

test('allocation lifecycle edits solve demand and wait for capacity revalidation before Preview', async () => { // CHANGE
    const fixture = allocationSchedulerFixture(); // CHANGE
    let candidate, finishFit; // CHANGE
    const pending = fixture.api.openAllocationScheduleDialog(fixture.ui, fixture.draft, { previewOnly: true, revalidateDraft: draft => { candidate = draft; return new Promise(resolve => { finishFit = resolve; }); } }); // CHANGE
    const dialog = await waitForSchedulerDialog(fixture); // CHANGE
    const view = fixture.api.__testWindow.document.defaultView; // CHANGE
    const lock = dialog.querySelector('[data-allocation-lifecycle-lock]'); // CHANGE
    lock.checked = false; lock.dispatchEvent(new view.Event('change')); // CHANGE
    const harvest = Array.from(dialog.querySelectorAll('input')).find(input => input.closest('.usl-scheduler-row')?.textContent.includes('Harvest window')); // CHANGE
    harvest.value = '14'; harvest.dispatchEvent(new view.Event('input')); // CHANGE
    const preview = Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === 'Preview Planting'); // CHANGE
    assert.equal(preview.disabled, true); // CHANGE
    await waitForAllocationState(() => finishFit); // CHANGE
    assert.ok(candidate.lifecycle.attributePatch.harvest_start <= fixture.draft.targetDemandEndISO); // CHANGE
    assert.ok(candidate.lifecycle.attributePatch.harvest_end >= fixture.draft.targetDemandStartISO); // CHANGE
    finishFit({ ...candidate, ok: true, plantCount: 42, coveragePreview: { updated: true } }); // CHANGE
    await waitForAllocationState(() => !preview.disabled); // CHANGE
    assert.notEqual(dialog.querySelector('[data-allocation-start-date]').value, fixture.draft.actionStartISO); // CHANGE
    preview.click(); // CHANGE
    const result = await pending; // CHANGE
    assert.equal(result.draft.plantCount, 42); assert.equal(result.draft.coveragePreview.updated, true); // CHANGE
    assert.equal(result.draft.lifecycle.harvestWindowDays, 14); // CHANGE
    assert.equal(fixture.getGraphWrites(), 0); // CHANGE
    assert.equal(fixture.writes.some(write => /^(INSERT|UPDATE|DELETE)\b/i.test(write.sql.trim())), false); // CHANGE
}); // CHANGE

test('allocation discards older fits and blocks Preview when the latest bed fit fails', async () => { // CHANGE
    const fixture = allocationSchedulerFixture(); // CHANGE
    const fits = []; // CHANGE
    const pending = fixture.api.openAllocationScheduleDialog(fixture.ui, fixture.draft, { previewOnly: true, revalidateDraft: draft => new Promise(resolve => { fits.push({ draft, resolve }); }) }); // CHANGE
    const dialog = await waitForSchedulerDialog(fixture); // CHANGE
    const view = fixture.api.__testWindow.document.defaultView; // CHANGE
    const lock = dialog.querySelector('[data-allocation-lifecycle-lock]'); // CHANGE
    lock.checked = false; lock.dispatchEvent(new view.Event('change')); // CHANGE
    const harvest = Array.from(dialog.querySelectorAll('input')).find(input => input.closest('.usl-scheduler-row')?.textContent.includes('Harvest window')); // CHANGE
    const preview = Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === 'Preview Planting'); // CHANGE
    harvest.value = '14'; harvest.dispatchEvent(new view.Event('input')); // CHANGE
    await waitForAllocationState(() => fits.length === 1); // CHANGE
    harvest.value = '10'; harvest.dispatchEvent(new view.Event('input')); // CHANGE
    await waitForAllocationState(() => fits.length === 2); // CHANGE
    fits[1].resolve({ ...fits[1].draft, ok: false, reason: 'No capacity for this lifecycle' }); // CHANGE
    await waitForAllocationState(() => dialog.textContent.includes('No capacity for this lifecycle')); // CHANGE
    fits[0].resolve({ ...fits[0].draft, ok: true }); // CHANGE
    await new Promise(resolve => setTimeout(resolve, 20)); // CHANGE
    assert.equal(preview.disabled, true); // CHANGE
    assert.equal(dialog.querySelector('[data-allocation-timing-comparisons]').children.length, 0); // CHANGE
    Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === 'Cancel').click(); // CHANGE
    assert.equal((await pending).action, 'cancel'); // CHANGE
}); // CHANGE

test('allocation indoor method and lead-day edits refit demand and use transplant dates for offsets', async () => { // CHANGE
    const fixture = allocationSchedulerFixture({ neighbors: [allocationNeighbor('other', 2)] }); // CHANGE
    fixture.plant.days_transplant = 14; // CHANGE
    fixture.draft.harvestEnd = '2026-06-01'; // CHANGE
    fixture.draft.bedOccupancy = [{ groupId: 'other', bedId: 'bed', plantId: 2, plantName: 'Carrot', bedEntryISO: '2026-04-01', harvestEndISO: '2026-06-01' }]; // CHANGE
    const pending = fixture.api.openAllocationScheduleDialog(fixture.ui, fixture.draft, { previewOnly: true }); // CHANGE
    const dialog = await waitForSchedulerDialog(fixture); // CHANGE
    const view = fixture.api.__testWindow.document.defaultView; // CHANGE
    const lock = dialog.querySelector('[data-allocation-lifecycle-lock]'); // CHANGE
    lock.checked = false; lock.dispatchEvent(new view.Event('change')); // CHANGE
    const method = Array.from(dialog.querySelectorAll('select')).find(select => Array.from(select.options).some(option => option.textContent === 'Indoor transplant')); // CHANGE
    const indoor = Array.from(method.options).find(option => option.textContent === 'Indoor transplant'); // CHANGE
    method.value = indoor.value; method.dispatchEvent(new view.Event('change')); // CHANGE
    const preview = Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === 'Preview Planting'); // CHANGE
    await waitForAllocationState(() => !preview.disabled && dialog.textContent.includes('Transplant date:')); // CHANGE
    const leadRow = Array.from(dialog.querySelectorAll('.usl-scheduler-row')).find(row => row.textContent.includes('Transplant lead')); // CHANGE
    const override = leadRow.querySelector('input[type="checkbox"]'); // CHANGE
    override.checked = true; override.dispatchEvent(new view.Event('change')); // CHANGE
    const lead = leadRow.querySelector('input[type="number"]'); // CHANGE
    lead.value = '21'; lead.dispatchEvent(new view.Event('input')); // CHANGE
    await waitForAllocationState(() => !preview.disabled); // CHANGE
    preview.click(); const result = (await pending).draft; // CHANGE
    assert.equal(result.methodId, 'transplant.indoor'); assert.equal(result.lifecycle.effectiveTransplantDays, 21); // CHANGE
    assert.equal(result.lifecycle.attributePatch.transplant_date, result.lifecycle.primaryDateISO); // CHANGE
    const actual = (new Date(result.lifecycle.primaryDateISO) - new Date('2026-04-01')) / 86400000; // CHANGE
    assert.equal(result.bedTimingComparisons[0].actualOffsetDays, actual); // CHANGE
    assert.ok(result.lifecycle.attributePatch.harvest_start <= fixture.draft.targetDemandEndISO); // CHANGE
    assert.ok(result.lifecycle.attributePatch.harvest_end >= fixture.draft.targetDemandStartISO); // CHANGE
}); // CHANGE

test('allocation no feasible demand fit clears harvest dates and blocks both Preview actions', async () => { // CHANGE
    const fixture = allocationSchedulerFixture(); // CHANGE
    fixture.draft.targetDemandStartISO = '2026-01-01'; fixture.draft.targetDemandEndISO = '2026-01-07'; // CHANGE: there is no in-year start that can mature in the first demand week.
    const pending = fixture.api.openAllocationScheduleDialog(fixture.ui, fixture.draft, { previewOnly: true }); // CHANGE
    const dialog = await waitForSchedulerDialog(fixture); // CHANGE
    const view = fixture.api.__testWindow.document.defaultView; // CHANGE
    const lock = dialog.querySelector('[data-allocation-lifecycle-lock]'); // CHANGE
    lock.checked = false; lock.dispatchEvent(new view.Event('change')); // CHANGE
    const harvest = Array.from(dialog.querySelectorAll('input')).find(input => input.closest('.usl-scheduler-row')?.textContent.includes('Harvest window')); // CHANGE
    harvest.value = '14'; harvest.dispatchEvent(new view.Event('input')); // CHANGE
    await waitForAllocationState(() => dialog.textContent.includes('No allocation fit:')); // CHANGE
    for (const name of ['Preview', 'Preview Planting']) assert.equal(Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === name).disabled, true); // CHANGE
    assert.equal(dialog.querySelector('[data-allocation-timing-comparisons]').children.length, 0); // CHANGE
    Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === 'Cancel').click(); // CHANGE
    await pending; // CHANGE
    assert.equal(fixture.writes.some(write => /^(INSERT|UPDATE|DELETE)\b/i.test(write.sql.trim())), false); // CHANGE
}); // CHANGE

test('allocation compares bed entry against all overlapping crops and omits off-axis markers', () => { // CHANGE
    const fixture = allocationSchedulerFixture(); // CHANGE
    const draft = { ...fixture.draft, lifecycle: { result: { timelines: [{ sow: new Date('2026-04-01'), transplant: new Date('2026-04-15'), harvestEnd: new Date('2026-06-01') }] } }, bedOccupancy: [ // CHANGE
        { groupId: 'a', bedId: 'bed', plantId: 2, plantName: 'Carrot', varietyName: 'Early', bedEntryISO: '2026-04-01', harvestEndISO: '2026-05-01' }, // CHANGE
        { groupId: 'b', bedId: 'bed', plantId: 2, plantName: 'Carrot', bedEntryISO: '2026-04-15', harvestEndISO: '2026-06-01' }, // CHANGE
        { groupId: 'old', bedId: 'bed', plantId: 3, plantName: 'Rosemary', bedEntryISO: '2020-01-01', harvestEndISO: '2030-01-01' }, // CHANGE
        { groupId: 'elsewhere', bedId: 'other', plantId: 2, bedEntryISO: '2026-04-01', harvestEndISO: '2026-06-01' }, // CHANGE
        { groupId: 'later', bedId: 'bed', plantId: 2, bedEntryISO: '2026-07-01', harvestEndISO: '2026-08-01' }, // CHANGE
        { groupId: 'bad', bedId: 'bed', plantId: 2, bedEntryISO: 'invalid', harvestEndISO: '2026-08-01' }, // CHANGE
        { groupId: 'bad-calendar', bedId: 'bed', plantId: 2, bedEntryISO: '2026-02-30', harvestEndISO: '2026-08-01' }, null, 'malformed' // CHANGE
    ] }; // CHANGE
    const rows = fixture.api.buildAllocationTimingComparisons(draft, [{ companionPlantId: 2, relationship: { recommendedStartOffsetDays: -7 } }]); // CHANGE
    assert.deepEqual(Array.from(rows, row => row.cellId), ['old', 'a', 'b']); // CHANGE
    assert.equal(rows[1].actualOffsetDays, 14); assert.equal(rows[1].recommendedOffsetDays, 7); assert.equal(rows[1].differenceDays, 7); // CHANGE
    assert.equal(rows[2].actualOffsetDays, 0); assert.equal(rows[0].recommendedOffsetDays, null); // CHANGE
    assert.equal(fixture.api.buildAllocationTimingComparisons({ ...draft, bedOccupancy: {} }).length, 0); // CHANGE
    assert.equal(fixture.api.buildAllocationTimingComparisons(draft, [null]).length, 3); // CHANGE
    const timeline = fixture.api.buildLifecycleTimelineViewModel({ seasonStartYear: 2026, overlappingPlantings: rows }); // CHANGE
    assert.deepEqual(Array.from(timeline.overlappingStarts, row => row.cellId), ['a', 'b']); // CHANGE
    assert.equal(timeline.bounds.startISO, '2026-01-01'); // CHANGE
    const direct = fixture.api.buildAllocationTimingComparisons({ ...draft, lifecycle: { result: { timelines: [{ sow: new Date('2026-04-01'), harvestEnd: new Date('2026-06-01') }] } } }); // CHANGE
    assert.equal(direct.find(row => row.cellId === 'a').actualOffsetDays, 0); // CHANGE
}); // CHANGE

test('allocation lifecycle defaults are opt-in and merge selected-variety overrides without timing writes', async () => { // CHANGE
    const fixture = allocationSchedulerFixture({ varietyOverrides: { days_maturity: 50, yield_per_plant_kg: 2 } }); // CHANGE
    const draft = { ...fixture.draft, methodId: 'transplant.indoor', methodCategoryId: 'transplant', lifecycle: { effectiveTransplantDays: 21, harvestWindowDays: 14 } }; // CHANGE
    await fixture.api.persistAllocationReusableDefaults(draft, { defaultStatus: { missing: [] } }); // CHANGE
    assert.equal(fixture.writes.some(write => /UPDATE\s+(Plants|PlantVarieties)/i.test(write.sql)), false); // CHANGE
    await fixture.api.persistAllocationReusableDefaults({ ...draft, saveLifecycleDefaults: true }, { defaultStatus: { missing: [] } }); // CHANGE
    const update = fixture.writes.find(write => /UPDATE\s+PlantVarieties/i.test(write.sql)); // CHANGE
    const saved = JSON.parse(update.params[0]); // CHANGE
    assert.deepEqual(saved, { days_maturity: 50, yield_per_plant_kg: 2, default_planting_method: 'transplant.indoor', default_planting_method_category: 'transplant', days_transplant: 21, harvest_window_days: 14 }); // CHANGE
    assert.equal(fixture.writes.some(write => /UPDATE\s+Plants\b|(?:UPDATE|INSERT INTO)\s+Companions\b/i.test(write.sql)), false); // CHANGE
    const merged = fixture.api.applyPlantOverrides({ default_planting_method: 'direct_sow.field', default_planting_method_category: 'direct_sow' }, { default_planting_method: 'transplant.indoor' }); // CHANGE
    assert.equal(merged.default_planting_method_category, 'transplant'); // CHANGE
    assert.equal(fixture.api.applyPlantOverrides(merged, { default_planting_method: '' }).default_planting_method, 'transplant.indoor'); // CHANGE
}); // CHANGE

test('allocation plant lifecycle defaults require first-time opt-in and variety methods preserve explicit selection and inheritance', async () => { // CHANGE
    const fixture = allocationSchedulerFixture({ varietyOverrides: { default_planting_method: 'transplant.indoor', default_planting_method_category: 'transplant', days_transplant: 21 } }); // CHANGE
    const draft = { ...fixture.draft, crop: { ...fixture.draft.crop, varietyId: '' }, plantResolution: { ...fixture.draft.plantResolution, varietyId: null }, methodId: 'transplant.indoor', methodCategoryId: 'transplant', lifecycle: { effectiveTransplantDays: 21, harvestWindowDays: 14 } }; // CHANGE
    await fixture.api.persistAllocationReusableDefaults(draft, { defaultStatus: { missing: ['method'] } }); // CHANGE
    assert.equal(fixture.writes.some(write => /UPDATE\s+Plants\b/i.test(write.sql)), false); // CHANGE
    await fixture.api.persistAllocationReusableDefaults({ ...draft, saveLifecycleDefaults: true }, { defaultStatus: { missing: ['method'] } }); // CHANGE
    const update = fixture.writes.find(write => /UPDATE\s+Plants\b/i.test(write.sql)); // CHANGE
    assert.ok(update); assert.ok(update.params.includes('transplant.indoor')); assert.ok(update.params.includes(14)); // CHANGE
    const effective = (await fixture.api.resolvePlantForPlanCrop({ plantId: 1, varietyId: 7 })).plant; // CHANGE
    assert.equal(effective.default_planting_method, 'transplant.indoor'); assert.equal(effective.days_transplant, 21); // CHANGE
    const base = (await fixture.api.resolvePlantForPlanCrop({ plantId: 1, varietyId: null })).plant; // CHANGE
    assert.equal(base.default_planting_method, 'direct_sow.field'); // CHANGE
    const explicit = await fixture.api.proposeLifecycle({ plant: effective, city: fixture.city, methodId: 'direct_sow.field', methodCategoryId: 'direct_sow', primaryDateISO: '2026-04-01', seasonStartYear: 2026, harvestWindowDays: 7 }); // CHANGE
    assert.equal(explicit.ok, true); assert.equal(explicit.methodId, 'direct_sow.field'); // CHANGE: an explicit allocation/Year Plan method takes priority over variety defaults.
}); // CHANGE

/** Minimal planted cell with actual spacing, for defaults captured after successful creation. */ // CHANGE
function allocationNeighbor(id, plantId, varietyId = '') { // CHANGE
    const attrs = { plant_id: String(plantId), variety_id: String(varietyId), plant_name: 'Carrot', spacing_x_cm: '20', spacing_y_cm: '25', layout_offset_x_cm: '3', layout_offset_y_cm: '4' }; // CHANGE
    return { id, getAttribute: key => attrs[key] ?? null, getGeometry: () => ({ x: 0, y: 0, width: 100, height: 100 }) }; // CHANGE
} // CHANGE

test('allocation spacing default starts unchecked for new active sets and explicit opt-in persists only after creation', async () => { // CHANGE
    const neighbor = allocationNeighbor('carrot', 2); // CHANGE
    const fixture = allocationSchedulerFixture({ neighbors: [neighbor] }); // CHANGE
    fixture.draft.bedOccupancy = [{ groupId: 'carrot', bedId: 'bed', plantId: 2, plantName: 'Carrot', bedEntryISO: '2026-04-01', harvestEndISO: '2026-06-01' }]; // CHANGE
    fixture.draft.lifecycle = await fixture.api.proposeLifecycle({ plant: fixture.plant, city: fixture.city, primaryDateISO: fixture.draft.actionStartISO, methodId: 'direct_sow.field', methodCategoryId: 'direct_sow', seasonStartYear: 2026 }); // CHANGE
    const pending = fixture.api.openAllocationScheduleDialog(fixture.ui, fixture.draft, { previewOnly: true, defaultStatus: { missing: [] } }); // CHANGE
    const dialog = await waitForSchedulerDialog(fixture); // CHANGE
    const spacing = dialog.querySelector('[data-allocation-save-spacing]'); // CHANGE
    assert.equal(spacing.checked, false); assert.equal(spacing.disabled, false); // CHANGE: new sets also require explicit permission to save reusable spacing defaults.
    assert.equal(dialog.querySelectorAll('[data-allocation-timing-row]').length, 1); // CHANGE
    assert.equal(dialog.querySelectorAll('[data-allocation-overlap-start]').length, 1); // CHANGE
    assert.match(dialog.querySelector('[data-allocation-timing-comparisons]').textContent, /No recommended offset/); // CHANGE
    spacing.checked = true; // CHANGE: persistence is authorized by the user's explicit checkbox choice, read when Preview is requested.
    Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === 'Preview Planting').click(); // CHANGE
    const result = await pending; // CHANGE
    assert.equal(result.draft.saveSpacingDefaults, true); // CHANGE
    assert.equal(fixture.writes.some(write => /INSERT INTO CompanionSetLayoutDefaults/i.test(write.sql)), false); // CHANGE
    await assert.rejects(result.draft.commitAllocationDefaults(), /created planting/); // CHANGE
    const created = allocationNeighbor('created', 1, 7); // CHANGE
    await result.draft.commitAllocationDefaults(created); // CHANGE
    const insert = fixture.writes.find(write => /INSERT INTO CompanionSetLayoutDefaults/i.test(write.sql)); // CHANGE
    assert.ok(insert); // CHANGE
    const saved = insert.params.map(param => { try { return JSON.parse(param); } catch { return null; } }).find(value => value?.rows); // CHANGE
    assert.equal(saved.rows.length, 2); // CHANGE
    const proposed = saved.rows.find(row => row.varietyId === 7); // CHANGE
    assert.equal(proposed.spacingXCm, 20); assert.equal(proposed.offsetXCm, 3); // CHANGE
    assert.equal(fixture.writes.some(write => /(?:UPDATE|INSERT INTO)\s+Companions\b/i.test(write.sql)), false); // CHANGE
}); // CHANGE

test('allocation spacing default starts unchecked for existing exact and broad defaults and preserves explicit choice on reopen', async () => { // CHANGE
    for (const broad of [false, true]) { // CHANGE
        const fixture = allocationSchedulerFixture({ neighbors: [allocationNeighbor('carrot', 2)], setDefault: { crop_set_key: broad ? 'p:1+p:2' : 'p:2+v:7', layout_json: '{"rows":[]}' } }); // CHANGE
        fixture.draft.bedOccupancy = [{ groupId: 'carrot', bedId: 'bed', plantId: 2, bedEntryISO: '2026-04-01', harvestEndISO: '2026-06-01' }]; // CHANGE
        fixture.draft.lifecycle = await fixture.api.proposeLifecycle({ plant: fixture.plant, city: fixture.city, primaryDateISO: fixture.draft.actionStartISO, methodId: 'direct_sow.field', methodCategoryId: 'direct_sow', seasonStartYear: 2026 }); // CHANGE
        let pending = fixture.api.openAllocationScheduleDialog(fixture.ui, fixture.draft, { previewOnly: true }); // CHANGE
        let dialog = await waitForSchedulerDialog(fixture); // CHANGE
        const spacing = dialog.querySelector('[data-allocation-save-spacing]'); // CHANGE
        assert.equal(spacing.checked, false); assert.equal(spacing.disabled, false); // CHANGE
        Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === 'Cancel').click(); // CHANGE
        await pending; // CHANGE
        fixture.draft.saveSpacingDefaults = true; // CHANGE
        pending = fixture.api.openAllocationScheduleDialog(fixture.ui, fixture.draft, { previewOnly: true }); // CHANGE
        await waitForAllocationState(() => fixture.getDialog() !== dialog); // CHANGE
        dialog = fixture.getDialog(); // CHANGE
        assert.equal(dialog.querySelector('[data-allocation-save-spacing]').checked, true); // CHANGE
        Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === 'Cancel').click(); // CHANGE
        await pending; // CHANGE
    } // CHANGE
}); // CHANGE

test('allocation recommendation lookup preserves missing timing and normalizes both stored relationship directions', async () => { // CHANGE
    const fixture = allocationSchedulerFixture({ relationships: [ // CHANGE
        { relation_id: 1, source_plant_id: 1, companion_plant_id: 2, start_offset_days: 7, rating: 1 }, // CHANGE
        { relation_id: 2, source_plant_id: 3, companion_plant_id: 1, start_offset_days: 10, rating: 1 }, // CHANGE
        { relation_id: 3, source_plant_id: 1, companion_plant_id: 4, start_offset_days: null, rating: 1 } // CHANGE
    ] }); // CHANGE
    const relationships = await fixture.api.__testWindow.USL.scheduler.listAllocationOverlapRelationships(1); // CHANGE
    const draft = { ...fixture.draft, harvestEnd: '2026-06-01', bedOccupancy: [2, 3, 4].map(plantId => ({ groupId: String(plantId), bedId: 'bed', plantId, bedEntryISO: '2026-04-01', harvestEndISO: '2026-06-01' })) }; // CHANGE
    const comparisons = fixture.api.buildAllocationTimingComparisons(draft, relationships); // CHANGE
    assert.deepEqual(Array.from(comparisons, row => row.recommendedOffsetDays), [-7, 10, null]); // CHANGE
}); // CHANGE

test('allocation cancellation during revalidation cannot publish a fitted result', async () => { // CHANGE
    const fixture = allocationSchedulerFixture(); // CHANGE
    let fit; // CHANGE
    const pending = fixture.api.openAllocationScheduleDialog(fixture.ui, fixture.draft, { previewOnly: true, revalidateDraft: draft => new Promise(resolve => { fit = () => resolve({ ...draft, ok: true }); }) }); // CHANGE
    const dialog = await waitForSchedulerDialog(fixture); // CHANGE
    const view = fixture.api.__testWindow.document.defaultView; // CHANGE
    const lock = dialog.querySelector('[data-allocation-lifecycle-lock]'); // CHANGE
    lock.checked = false; lock.dispatchEvent(new view.Event('change')); // CHANGE
    const harvest = Array.from(dialog.querySelectorAll('input')).find(input => input.closest('.usl-scheduler-row')?.textContent.includes('Harvest window')); // CHANGE
    harvest.value = '12'; harvest.dispatchEvent(new view.Event('input')); // CHANGE
    await waitForAllocationState(() => fit); // CHANGE
    Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === 'Cancel').click(); // CHANGE
    assert.equal((await pending).action, 'cancel'); // CHANGE
    const date = dialog.querySelector('[data-allocation-start-date]').value; // CHANGE
    fit(); await new Promise(resolve => setTimeout(resolve, 30)); // CHANGE
    assert.equal(dialog.querySelector('[data-allocation-start-date]').value, date); // CHANGE
    assert.equal(fixture.getGraphWrites(), 0); // CHANGE
}); // CHANGE

test('lifecycle proposals resolve variety, plant, and method task defaults and respect explicit empty rules', async () => { // CHANGE
    const template = title => ({ version: 2, rules: [{ id: 'sow', title, startAnchorStage: 'SOW', endMode: 'fixed_days', durationDays: 0, repeatMode: 'none' }] });
    for (const [options, source, title] of [[{ varietyTemplate: template('Variety task'), plantTemplate: template('Plant task') }, 'variety', 'Variety task'], [{ plantTemplate: template('Plant task') }, 'plant', 'Plant task'], [{}, 'method_builtin', 'Sow']]) {
        const fixture = allocationSchedulerFixture(options);
        const proposal = await fixture.api.proposeLifecycle({ plant: fixture.plant, city: fixture.city, varietyId: 7, methodId: 'direct_sow.field', methodCategoryId: 'direct_sow', primaryDateISO: '2026-04-01', seasonStartYear: 2026 }); // CHANGE
        assert.equal(proposal.ok, true, proposal.reason);
        assert.equal(proposal.taskTemplateSource, source);
        assert.ok(proposal.taskPreview.some(task => task.title.includes(title)));
        const empty = await fixture.api.proposeLifecycle({ plant: fixture.plant, city: fixture.city, methodId: 'direct_sow.field', methodCategoryId: 'direct_sow', primaryDateISO: '2026-04-01', seasonStartYear: 2026, taskTemplate: { version: 2, rules: [] } }); // CHANGE
        assert.equal(empty.ok, true);
        assert.equal(empty.taskPreview.length, 0);
    }
});

test('full allocation scheduler cancellation and dismissal retain the draft without writes', async () => { // CHANGE
    for (const dismissal of ['Cancel', 'close']) {
        const fixture = allocationSchedulerFixture();
        const original = JSON.stringify(fixture.draft.crop);
        const pending = fixture.api.openAllocationScheduleDialog(fixture.ui, fixture.draft, { previewOnly: true });
        const dialog = await waitForSchedulerDialog(fixture);
        if (dismissal === 'close') fixture.ui.hideDialog();
        else Array.from(dialog.querySelectorAll('button')).find(node => node.textContent === 'Cancel').click();
        assert.equal((await pending).action, 'cancel');
        assert.equal(JSON.stringify(fixture.draft.crop), original);
        assert.equal(fixture.getGraphWrites(), 0);
        assert.equal(fixture.writes.some(write => /^(INSERT|UPDATE|DELETE)\b/i.test(write.sql.trim())), false);
    }
});

test('full allocation scheduler preserves explicitly empty rules when returning to preview', async () => { // CHANGE
    const fixture = allocationSchedulerFixture();
    fixture.draft.lifecycle = { taskTemplate: { version: 2, rules: [] }, taskTemplateSource: 'explicit' };
    const pending = fixture.api.openAllocationScheduleDialog(fixture.ui, fixture.draft, { previewOnly: true, defaultStatus: { complete: true, missing: [] } });
    const dialog = await waitForSchedulerDialog(fixture);
    Array.from(dialog.querySelectorAll('button')).find(node => node.textContent === 'Preview Planting').click();
    const result = await pending;
    assert.equal(result.draft.taskPreview.length, 0);
    assert.equal(result.draft.lifecycle.taskTemplate.rules.length, 0);
    assert.equal(fixture.getGraphWrites(), 0);
});

test('shared allocation result preserves relative task rules, rejects crop changes, and uses the fixed Year Plan growth-stage geometry', async () => { // CHANGE
    const fixture = allocationSchedulerFixture();
    const inputs = new fixture.api.ScheduleInputs({ ...makeInputs(fixture.api, { plant: fixture.api.applyGrowthStageToPlant(fixture.plant, fixture.api.normalizeGrowthStage({ stage_key: 'baby', stage_label: 'Baby', gdd_ratio: 0.25 })), city: fixture.city }), varietyId: 7, varietyName: 'Test variety' }); // CHANGE: scheduler inputs are immutable.
    const template = { version: 2, rules: [{ id: 'water', title: 'Water {plant}', startAnchorStage: 'SOW', startOffsetDays: 2, startOffsetDirection: 'after', endMode: 'fixed_days', durationDays: 1, repeatMode: 'interval', repeatEveryDays: 2, repeatUntilMode: 'x_times', repeatTimes: 3, repeatUntilAnchorStage: 'HARVEST_END' }] };
    const result = fixture.api.computeScheduleResult(inputs);
    const stageDraft = { ...fixture.draft, crop: { ...fixture.draft.crop, growthStageKey: 'baby', growthStageLabel: 'Baby' } }; // CHANGE
    const reviewed = await fixture.api.buildAllocationSchedulerResult(stageDraft, inputs, result, template); // CHANGE
    await assert.rejects(() => fixture.api.buildAllocationSchedulerResult(fixture.draft, inputs, result, template), /growth stage cannot change/); // CHANGE
    assert.equal(reviewed.lifecycle.taskTemplate, template);
    assert.equal(reviewed.taskPreview.length, 3);
    assert.equal(reviewed.plantResolution.plant.spacing_cm, 15);
    assert.equal(reviewed.lifecycle.attributePatch.spacing_cm, '15');
    await assert.rejects(() => fixture.api.buildAllocationSchedulerResult({ ...fixture.draft, crop: { ...fixture.draft.crop, plantId: '2' } }, inputs, result, template), /cannot change/);
});

test('companion metadata annotates crop options without changing suitability order', () => {
    const crops = [
        makeCrop({ plant_id: 1, plant_name: 'Late Crop', annual: 1, biennial: 0, perennial: 0 }),
        makeCrop({ plant_id: 2, plant_name: 'Best Crop', annual: 1, biennial: 0, perennial: 0 })
    ];
    const scores = new Map([
        ['1', { rankClass: 0, percentRemaining: 25, distanceDays: 0, hint: '25% window left' }],
        ['2', { rankClass: 0, percentRemaining: 80, distanceDays: 0, hint: '80% window left' }]
    ]);
    const metadata = new Map([
        ['1', { known: true, rating: 1, companionType: 'interplant', recommendedStartOffsetDays: 7 }],
        ['2', { known: false, recommendedStartOffsetDays: 0 }]
    ]);
    const groups = hooks.buildGroupedCropOptions(hooks.makeCropPickerOptions(crops, scores, metadata), { filter: 'annual' });
    assert.deepEqual(Array.from(groups[0].options, option => option.label), ['Best Crop', 'Late Crop']);
    assert.equal(groups[0].options[1].displayLabel, 'Late Crop - 25% window left - beneficial, interplant, +7d');
});

test('scheduler crop combobox syncs selection and renders companion badges', () => {
    const document = hooks.__testWindow.document;
    document.querySelectorAll('.usl-crop-combobox-panel').forEach(panel => panel.remove());
    const select = document.createElement('select');
    document.body.appendChild(select);
    const combo = hooks.createSchedulerCropCombobox(select);
    const groups = [{
        label: 'Annual crops',
        options: [{
            value: '7',
            label: 'Basil',
            displayLabel: 'Basil - 85% window left - beneficial, interplant, +7d',
            metadata: { known: true, rating: 1, companionType: 'interplant', recommendedStartOffsetDays: 7 }
        }]
    }];
    hooks.renderGroupedCropOptions(select, groups, '');
    combo.refresh(groups, '');
    combo.root.querySelector('button').click();
    const panel = document.body.querySelector('.usl-crop-combobox-panel');
    assert.ok(panel);
    assert.notEqual(panel.parentNode, combo.root);
    const option = panel.querySelector('[role="option"]');
    assert.match(option.textContent, /Basil/);
    assert.match(option.textContent, /85% window left/);
    assert.match(option.textContent, /beneficial/);
    option.click();
    assert.equal(select.value, '7');
});

test('scheduler crop combobox floats outside clipped containers and clamps to viewport', () => {
    const document = hooks.__testWindow.document;
    document.querySelectorAll('.usl-crop-combobox-panel').forEach(panel => panel.remove());
    const section = document.createElement('div');
    section.className = 'usl-scheduler-section';
    section.style.overflow = 'hidden';
    const select = document.createElement('select');
    section.appendChild(select);
    document.body.appendChild(section);
    const combo = hooks.createSchedulerCropCombobox(select);
    section.appendChild(combo.root);
    hooks.renderGroupedCropOptions(select, [{ label: 'Annual crops', options: [{ value: '1', label: 'Beet' }] }], '');
    combo.refresh([{ label: 'Annual crops', options: [{ value: '1', label: 'Beet' }] }], '');
    const button = combo.root.querySelector('button');
    button.getBoundingClientRect = () => ({ left: 100, top: 100, right: 420, bottom: 132, width: 320, height: 32 });
    button.click();
    const panel = document.body.querySelector('.usl-crop-combobox-panel');
    assert.ok(panel);
    assert.equal(panel.parentNode, document.body);
    assert.equal(panel.style.position, 'fixed');
    assert.equal(panel.style.left, '100px');
    assert.equal(panel.style.top, '136px');
    assert.equal(panel.style.width, '320px');
    assert.ok(Number.parseInt(panel.style.maxHeight, 10) <= 260);
});

test('scheduler crop combobox closes on outside click and Escape', () => {
    const document = hooks.__testWindow.document;
    const EventWindow = document.defaultView;
    document.querySelectorAll('.usl-crop-combobox-panel').forEach(panel => panel.remove());
    const select = document.createElement('select');
    const combo = hooks.createSchedulerCropCombobox(select);
    hooks.renderGroupedCropOptions(select, [{ label: 'Annual crops', options: [{ value: '1', label: 'Beet' }] }], '');
    combo.refresh([{ label: 'Annual crops', options: [{ value: '1', label: 'Beet' }] }], '');
    combo.root.querySelector('button').click();
    assert.ok(document.body.querySelector('.usl-crop-combobox-panel'));
    document.dispatchEvent(new EventWindow.Event('mousedown', { bubbles: true }));
    assert.equal(document.body.querySelector('.usl-crop-combobox-panel'), null);
    combo.root.querySelector('button').click();
    const input = document.body.querySelector('.usl-crop-combobox-panel input');
    const escapeEvent = new EventWindow.Event('keydown', { bubbles: true });
    Object.defineProperty(escapeEvent, 'key', { value: 'Escape' });
    input.dispatchEvent(escapeEvent);
    assert.equal(document.body.querySelector('.usl-crop-combobox-panel'), null);
});

test('scheduler crop combobox closes when the owning dialog is removed', async () => {
    const document = hooks.__testWindow.document;
    document.querySelectorAll('.usl-crop-combobox-panel').forEach(panel => panel.remove());
    const dialog = document.createElement('div');
    dialog.className = 'usl-scheduler-dialog';
    const select = document.createElement('select');
    const combo = hooks.createSchedulerCropCombobox(select);
    dialog.appendChild(combo.root);
    document.body.appendChild(dialog);
    const groups = [{ label: 'Annual crops', options: [{ value: '1', label: 'Beet' }] }];
    hooks.renderGroupedCropOptions(select, groups, '');
    combo.refresh(groups, '');
    combo.root.querySelector('button').click();
    assert.ok(document.body.querySelector('.usl-crop-combobox-panel'));
    dialog.remove();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(document.body.querySelector('.usl-crop-combobox-panel'), null);
});

test('crop picker row uses custom layout without section overflow workaround', () => {
    assert.match(schedulerSource, /plantControlsWrap\.className = 'usl-scheduler-crop-picker-controls'/);
    assert.match(schedulerSource, /plantSelectRow\.row\.classList\.add\('usl-scheduler-row--crop-picker'\)/);
    assert.match(schedulerSource, /varietyRow\.row\.classList\.add\('usl-scheduler-row--crop-variety'\)/);
    assert.match(schedulerSource, /\.usl-scheduler-row-label\{flex:0 0 180px;/);
    assert.match(schedulerSource, /\.usl-scheduler-row--crop-picker\{display:grid!important;grid-template-columns:50px minmax\(120px,140px\) minmax\(0,1fr\) auto auto!important/);
    assert.match(schedulerSource, /\.usl-scheduler-row--crop-variety > \.usl-scheduler-row-label\{flex:0 0 50px!important\}/);
    assert.match(schedulerSource, /\.usl-scheduler-crop-combobox-wrap\{grid-column:3;min-width:0!important;width:100%!important\}/);
    assert.match(schedulerSource, /\.usl-crop-combobox-button\{min-height:32px;min-width:0!important;overflow:hidden;/);
    assert.match(schedulerSource, /\.usl-scheduler-crop-action\{width:auto!important;min-width:36px!important;flex:0 0 auto!important;white-space:nowrap!important;justify-self:end!important\}/);
    assert.match(schedulerSource, /\.usl-scheduler-row--crop-variety > :not\(label\)\{min-width:0!important\}/);
    assert.match(schedulerSource, /@media \(max-width:900px\)\{\.usl-scheduler-row--crop-picker\{grid-template-columns:50px minmax\(120px,1fr\) auto auto!important\}[\s\S]*\.usl-scheduler-crop-action\{grid-row:3\}/);
    assert.doesNotMatch(schedulerSource, /\.usl-scheduler-crop-combobox-wrap\{grid-column:3;min-width:280px/);
    assert.match(schedulerSource, /\.usl-scheduler-section\{[^}]*overflow:hidden/);
    assert.doesNotMatch(schedulerSource, /plantSection\.wrap\.classList\.add\('usl-scheduler-section--allow-popover'\)/);
});

test('derived dialogs do not persist resolved city onto the source while opening', () => {
    assert.match(schedulerSource, /if \(!openOptions\?\.derivedMode && model && cell && cityInit\.city_id != null\) \{/);
    assert.match(schedulerSource, /city_id: city\.city_id != null \? String\(city\.city_id\) : '',/);
});

test('scheduler requires inherited city instead of silently falling back to first city', () => {
    assert.match(schedulerSource, /Scheduler city is not set\. Select a city in Garden Settings before scheduling\./);
    assert.doesNotMatch(schedulerSource, /const initialCityRow =[\s\S]*\|\| cities\[0\];/);
    assert.doesNotMatch(schedulerSource, /cityOpts\.find\(o => o\.label === initialCityName\)\?\.value \|\| cityOpts\[0\]\?\.value/);
});

test('derived save creates sibling after validation and rolls it back on save failure', () => {
    assert.match(schedulerSource, /const scheduleResult = computeScheduleResult\(inputs\);[\s\S]*if \(derivedContext\.operation === 'create'\) \{[\s\S]*createdDerivedCell = createSibling\(graph, relationshipSourceCell/);
    assert.match(schedulerSource, /let targetCell = cell;[\s\S]*targetCell = createdDerivedCell;/);
    assert.match(schedulerSource, /const targetLayoutPatch = Object\.assign\(\{\}, derivedRelationshipPatch, layoutGraphApplication\.targetPatch \|\| \{\}\);/);
    assert.match(schedulerSource, /await applyScheduleToGraph\(ui, targetCell, inputs,[\s\S]*targetAttributePatch: targetLayoutPatch[\s\S]*preserveTargetGeometry: !!derivedContext/);
    assert.match(schedulerSource, /catch \(saveError\) \{[\s\S]*if \(createdDerivedCell\) removeDerivedSiblingIfPresent\(ui\?\.editor\?\.graph, createdDerivedCell\);[\s\S]*throw saveError/);
    assert.match(schedulerSource, /targetGroupId: cell\.id/);
});

test('existing legacy companion metadata opens as an ordinary schedule edit', () => {
    assert.match(schedulerSource, /async function resolveExistingDerivedScheduleContext\(cell, selectedPlant, allPlants, context = \{\}\)/);
    assert.match(schedulerSource, /if \(mode !== 'companion'\) return null;/);
    assert.match(schedulerSource, /const sourceCell = model\.getCell\(sourceId\);[\s\S]*if \(!sourceCell \|\| !isTilerGroup\(sourceCell\)\) return null;/);
    assert.match(schedulerSource, /derived\.operation = 'edit';/);
    assert.match(schedulerSource, /derived\.defaultPrimaryStartISO = '';/);
    assert.match(schedulerSource, /else \{[\s\S]*derivedContext = null; \/\/ CHANGE: legacy companion cells edit as ordinary plantings; old metadata remains inert\./);
    assert.doesNotMatch(schedulerSource, /derivedContext = await resolveExistingDerivedScheduleContext\(cell, selectedPlant, plants/);
});

test('companion timing help shows recommended and current actual offsets', () => {
    assert.match(schedulerSource, /Recommended offset: [\s\S]*current actual offset:/);
    assert.match(schedulerSource, /updateCompanionTimingHelp\(\);[\s\S]*syncStateFromControls\(\);/);
    assert.match(schedulerSource, /const scheduleGapHint = document\.createElement\('span'\)/);
    assert.match(schedulerSource, /firstSowRowObj\.row\.appendChild\(scheduleGapHint\)/);
    assert.match(schedulerSource, /updateScheduleGapHint\(\);/);
    assert.match(schedulerSource, /scheduleGapTooltipText = ''; \/\/ CHANGE: occupancy relationship context is shown inline beside Start/); // CHANGE: occupancy hints no longer duplicate into the Start tooltip.
    assert.match(schedulerSource, /setTooltip\(startInput, \[scheduleGapTooltipText, companionTimingTooltipText\]/); // CHANGE: companion timing remains the only populated Start tooltip contributor.
});

test('guided companion creation writes ordinary layout, not relationship identity metadata', () => {
    const sourceCell = {
        id: 'source-1',
        getAttribute: key => ({ plant_id: '11', sow_date: '2026-04-01', harvest_end: '2026-08-01' }[key] || '')
    };
    const sourcePlant = makeCrop({ plant_id: 11, annual: 1, biennial: 0, perennial: 0 });
    const targetPlant = makeCrop({ plant_id: 22, annual: 1, biennial: 0, perennial: 0 });
    const result = { timelines: [{ sow: new Date('2026-04-15T00:00:00Z'), harvestEnd: new Date('2026-07-01T00:00:00Z') }] };
    const context = {
        mode: 'companion',
        sourcePlant,
        sourceOccupancy: hooks.sourceOccupancyWindowForDerived(sourceCell, sourcePlant),
        relationshipByPlantId: new Map([['22', { relationId: 9, rating: 1, companionType: 'interplant', recommendedStartOffsetDays: 7 }]])
    };
    const patch = hooks.buildDerivedRelationshipPatch(sourceCell, targetPlant, result, context);
    assert.equal(patch.derived_mode, undefined);
    assert.equal(patch.derived_source_group_id, undefined);
    assert.equal(patch.derived_source_plant_id, undefined);
    assert.equal(patch.derived_target_plant_id, undefined);
    assert.equal(patch.companion_start_offset_days, undefined);
    assert.equal(patch.companion_recommended_start_offset_days, undefined);
});

test('guided companion layout patch materializes only ordinary spacing and offsets', () => {
    const sourceCell = {
        id: 'source-layout',
        getGeometry: () => ({ x: 10, y: 20, width: 120, height: 80 }),
        getAttribute: key => ({ plant_id: '11', sow_date: '2026-04-01', harvest_end: '2026-08-01', spacing_x_cm: '40', spacing_y_cm: '50' }[key] || '')
    };
    const targetPlant = makeCrop({ plant_id: 22, spacing_cm: 30, spacing_x_cm: 25, spacing_y_cm: 35, veg_diameter_cm: 18 });
    const relationship = { relationId: 9, rating: 1, companionType: 'interplant', recommendedStartOffsetDays: 7, layoutTemplate: 'staggered', layoutSpacingXCm: 20, layoutSpacingYCm: 22, layoutOffsetXCm: 12, layoutOffsetYCm: -6 };
    const result = { timelines: [{ sow: new Date('2026-04-15T00:00:00Z'), harvestEnd: new Date('2026-07-01T00:00:00Z') }] };
    const patch = hooks.buildDerivedRelationshipPatch(sourceCell, targetPlant, result, {
        mode: 'companion',
        sourceOccupancy: hooks.sourceOccupancyWindowForDerived(sourceCell, makeCrop({ plant_id: 11 })),
        relationshipByPlantId: new Map([['22', relationship]])
    });
    assert.equal(patch.companion_layout_template, undefined);
    assert.equal(patch.spacing_x_cm, '20');
    assert.equal(patch.spacing_y_cm, '22');
    assert.equal(patch.companion_offset_x_cm, null);
    assert.equal(patch.companion_offset_y_cm, null);
    assert.equal(patch.layout_offset_x_cm, '12');
    assert.equal(patch.layout_offset_y_cm, '-6');
    assert.equal(patch.veg_diameter_cm, '18');
});

test('layout preview model renders no-bed and clamps companion placement', () => {
    const noBed = hooks.buildLayoutPreviewModel({ requireRealBed: true });
    assert.equal(noBed.status, 'no-bed');
    const model = hooks.buildLayoutPreviewModel({
        bedRect: { x: 0, y: 0, width: 100, height: 60 },
        sourceRect: { x: 70, y: 20, width: 40, height: 30 },
        sourceSpacing: { spacingXCm: 10, spacingYCm: 10 },
        layout: { spacingXCm: 10, spacingYCm: 10, offsetXCm: 80, offsetYCm: 0 },
        showCompanion: true
    });
    assert.equal(model.status, 'ok');
    assert.equal(model.clamped, true);
    assert.ok(model.companion.x <= 60);
    const dense = hooks.computePreviewPlantCircles({ x: 0, y: 0, width: 400, height: 400 }, 1, 1, { maxCircles: 12 });
    assert.equal(dense.circles.length, 12);
    assert.equal(dense.summarized, true);
    const normalDense = hooks.computePreviewPlantCircles({ x: 0, y: 0, width: 40, height: 40 }, 1, 1);
    assert.equal(normalDense.circles.length, normalDense.total);
    assert.equal(normalDense.summarized, false);
    assert.ok(normalDense.circles[0].r > 2);
});

test('spacing preview model uses tiler-faithful draft group copies with a 1000 circle cap', () => {
    let call = null;
    const cell = {
        id: 'carrot-group',
        getAttribute: key => ({ tiler_group: '1', plant_abbr: 'CAR', label: 'Carrot' }[key] || '')
    };
    const graph = {
        getModel() {
            return {
                getCell(id) {
                    return id === 'carrot-group' ? cell : null;
                }
            };
        }
    };
    hooks.__testWindow.USL = hooks.__testWindow.USL || {};
    hooks.__testWindow.USL.tiler = {
        buildDraftTilerGroupPreview(activeGraph, groupCell, draft, opts) {
            call = { activeGraph, groupCell, draft, opts };
            return {
                status: 'ok',
                rect: draft.rect,
                label: 'Carrot',
                abbr: 'CAR',
                groupLabelFontPx: 12,
                groupLabelBandPx: 21,
                rotationDeg: 15,
                circles: [{ x: 14, y: 28, r: 7, label: 'CAR', fontPx: 8 }],
                total: 1002,
                rendered: 1000,
                capped: true,
                lodCollapsed: false
            };
        }
    };

    const model = hooks.layoutTools.buildSpacingPreviewModel(graph, [{
        cellId: 'carrot-group',
        enabled: true,
        label: 'Carrot',
        rect: { x: 10, y: 20, width: 90, height: 70 },
        spacingXCm: 20,
        spacingYCm: 25,
        offsetXCm: 3,
        offsetYCm: 4
    }]);

    assert.equal(call.activeGraph, graph);
    assert.equal(call.groupCell, cell);
    assert.equal(call.draft.maxCircles, 1000);
    assert.equal(JSON.stringify(call.opts), '{}');
    assert.equal(model.rows[0].groupPreview.label, 'Carrot');
    assert.equal(model.rows[0].groupPreview.rotationDeg, 15);
    assert.equal(model.rows[0].dots.circles[0].label, 'CAR');
    assert.equal(model.rows[0].dots.summarized, true);
    assert.match(model.warning, /Carrot: Preview capped at 1000 of 1002 plants/);
    assert.equal(model.rows[0].groupPreview.lodCollapsed, false);
});

test('spacing preview model supports upright bed context rows without status noise', () => {
    let calls = [];
    const bed = { id: 'bed-1', getAttribute: key => ({ garden_bed: '1', label: 'Bed 1' }[key] || '') };
    const edited = { id: 'carrot-group', getAttribute: key => ({ tiler_group: '1', plant_abbr: 'CAR', label: 'Carrot' }[key] || '') };
    const context = { id: 'lettuce-group', getAttribute: key => ({ tiler_group: '1', plant_abbr: 'LET', label: 'Lettuce' }[key] || '') };
    const graph = {
        getModel() {
            return {
                getCell(id) {
                    return ({ 'bed-1': bed, 'carrot-group': edited, 'lettuce-group': context }[id] || null);
                }
            };
        }
    };
    hooks.__testWindow.USL = hooks.__testWindow.USL || {};
    hooks.__testWindow.USL.tiler = {
        buildDraftTilerGroupPreview(activeGraph, groupCell, draft, opts) {
            calls.push({ activeGraph, groupCell, draft, opts });
            return {
                status: 'ok',
                rect: draft.rect,
                label: groupCell.id,
                abbr: groupCell.id.slice(0, 3).toUpperCase(),
                groupLabelFontPx: 12,
                groupLabelBandPx: 21,
                rotationDeg: opts.rotationDeg,
                circles: [],
                total: 0,
                actual: 0,
                rendered: 0,
                capped: false,
                lodCollapsed: false
            };
        }
    };

    const model = hooks.layoutTools.buildSpacingPreviewModel(graph, [
        {
            cellId: 'carrot-group',
            bedId: 'bed-1',
            enabled: true,
            previewUnrotated: true,
            label: 'Carrot',
            rect: { x: 10, y: 20, width: 90, height: 70 },
            bedRect: { x: 0, y: 0, width: 200, height: 100 }
        },
        {
            cellId: 'lettuce-group',
            bedId: 'bed-1',
            enabled: false,
            previewOnly: true,
            previewUnrotated: true,
            label: 'Lettuce',
            rect: { x: 100, y: 20, width: 70, height: 70 },
            bedRect: { x: 0, y: 0, width: 200, height: 100 }
        }
    ]);

    assert.equal(calls.length, 2);
    assert.equal(calls[0].opts.rotationDeg, 0);
    assert.equal(calls[1].opts.rotationDeg, 0);
    assert.equal(JSON.stringify(model.bedPreview), JSON.stringify({ cellId: 'bed-1', rect: { x: 0, y: 0, width: 200, height: 100 } }));
    assert.equal(model.status, 'invalid');
    assert.match(model.warning, /Carrot: No plants remain inside the planting area/);
    assert.doesNotMatch(model.warning, /Lettuce/);
});

test('active companion layout templates compute distinct placements', () => {
    const anchor = { x: 10, y: 20, width: 100, height: 80 };
    const companion = { x: 10, y: 20, width: 60, height: 40 };
    const bed = { x: 0, y: 0, width: 260, height: 160 };
    const anchorSpacing = { spacingXCm: 40, spacingYCm: 30 };
    const beside = hooks.computeActiveCompanionPlacement(anchor, companion, bed, { template: 'beside', spacingXCm: 20, offsetXCm: 0, offsetYCm: 0 }, anchorSpacing);
    const staggered = hooks.computeActiveCompanionPlacement(anchor, companion, bed, { template: 'staggered', offsetXCm: 0, offsetYCm: 0 }, anchorSpacing);
    const interplant = hooks.computeActiveCompanionPlacement(anchor, companion, bed, { template: 'interplant', offsetXCm: 0, offsetYCm: 0 }, anchorSpacing);
    assert.notDeepEqual({ x: beside.x, y: beside.y }, { x: staggered.x, y: staggered.y });
    assert.notDeepEqual({ x: beside.x, y: beside.y }, { x: interplant.x, y: interplant.y });
    assert.equal(interplant.width, anchor.width);
    assert.equal(interplant.height, anchor.height);
    assert.equal(interplant.interplant, true);
});

test('multi-companion preview model renders anchor and all companions with warnings', () => {
    const model = hooks.buildCompanionLayoutPreviewModel({
        bedRect: { x: 0, y: 0, width: 180, height: 120 },
        anchorRow: { plantId: 1, label: 'Carrot', rect: { x: 20, y: 20, width: 80, height: 50 }, spacingXCm: 20, spacingYCm: 20, offsetXCm: 10, offsetYCm: 10 },
        companionRows: [
            { plantId: 2, label: 'Lettuce', rect: { x: 0, y: 0, width: 40, height: 40 }, template: 'staggered', spacingXCm: 18, spacingYCm: 18, offsetXCm: 20, offsetYCm: 12 },
            { plantId: 3, label: 'Tomato', rect: { x: 0, y: 0, width: 80, height: 80 }, template: 'beside', spacingXCm: 30, spacingYCm: 30, offsetXCm: 300, offsetYCm: 0 }
        ],
        requireRealBed: true
    });
    assert.equal(model.status, 'ok');
    assert.equal(model.rows.length, 3);
    assert.equal(model.rows[0].role, 'anchor');
    assert.equal(model.rows[0].rect.x, 20);
    assert.equal(model.rows[1].rect.x, 0);
    assert.ok(model.rows[0].dots.circles[0].x > model.rows[0].rect.x); // CHANGE: positive planting offsets move the internal grid rightward.
    assert.ok(model.rows[2].dots.omitted > 0); // CHANGE: out-of-bed offset centers are omitted rather than clamped.
    assert.match(model.warning, /Tomato: Plants outside bed omitted/);
});

test('saved plant-set defaults select their saved anchor when opened from another set member', () => {
    const selected = { id: 'lettuce', getAttribute: key => key === 'plant_id' ? '2' : '' };
    const savedAnchor = { id: 'carrot', getAttribute: key => key === 'plant_id' ? '1' : '' };
    const tomato = { id: 'tomato', getAttribute: key => key === 'plant_id' ? '3' : '' };
    const anchor = hooks.selectCompanionLayoutAnchorFromSet([selected, savedAnchor, tomato], { anchorPlantId: 1 }, selected);
    assert.equal(anchor.id, 'carrot');
    const fallback = hooks.selectCompanionLayoutAnchorFromSet([selected, tomato], { anchorPlantId: 9 }, selected);
    assert.equal(fallback.id, 'lettuce');
});

test('interplant preview offsets alternating row and column parity like the tiler', () => {
    const model = hooks.buildCompanionLayoutPreviewModel({
        bedRect: { x: 0, y: 0, width: 160, height: 120 },
        anchorRow: { plantId: 1, label: 'Carrot', rect: { x: 0, y: 0, width: 100, height: 100 }, spacingXCm: 20, spacingYCm: 20 },
        companionRows: [{ plantId: 2, label: 'Lettuce', rect: { x: 0, y: 0, width: 100, height: 100 }, template: 'interplant', spacingXCm: 20, spacingYCm: 20, offsetXCm: 0, offsetYCm: 0 }],
        requireRealBed: true
    });
    const companionDots = model.rows.find(row => row.role === 'companion').dots.circles;
    const row0col0 = companionDots.find(dot => dot.row === 0 && dot.col === 0);
    const row0col1 = companionDots.find(dot => dot.row === 0 && dot.col === 1);
    const row1col0 = companionDots.find(dot => dot.row === 1 && dot.col === 0);
    assert.equal(row0col0.x, 18);
    assert.equal(row0col0.y, 18);
    assert.equal(row0col1.x, 27);
    assert.equal(row0col1.y, 9);
    assert.equal(row1col0.x, 9);
    assert.equal(row1col0.y, 27);
});

test('layout patches write spacing and bed-relative offsets for current planting rows', () => {
    const patch = hooks.plantingLayoutAttributePatch({
        role: 'anchor',
        spacingXCm: 18,
        spacingYCm: 24,
        vegDiameterCm: 12,
        offsetXCm: 30,
        offsetYCm: 6
    });
    assert.equal(patch.spacing_x_cm, '18');
    assert.equal(patch.spacing_y_cm, '24');
    assert.equal(patch.veg_diameter_cm, '12');
    assert.equal(patch.layout_offset_x_cm, '30');
    assert.equal(patch.layout_offset_y_cm, '6');
    assert.equal(patch.companion_offset_x_cm, null);
    assert.equal(patch.companion_offset_y_cm, null);

    const companionPatch = hooks.plantingLayoutAttributePatch({
        role: 'companion',
        template: 'interplant',
        spacingXCm: 10,
        spacingYCm: 10,
        offsetXCm: 40,
        offsetYCm: 8
    });
    assert.equal(companionPatch.companion_layout_template, undefined);
    assert.equal(companionPatch.companion_offset_x_cm, null);
    assert.equal(companionPatch.companion_offset_y_cm, null);
    assert.equal(companionPatch.layout_offset_x_cm, '40');
    assert.equal(companionPatch.layout_offset_y_cm, '8');
});

test('companion set layout defaults use unordered crop identities and collapse duplicates', () => {
    const rows = [
        { plantId: 2, varietyId: 20, plantName: 'Basil', varietyName: 'Thai', spacingXCm: 18, spacingYCm: 20, offsetXCm: 3, offsetYCm: 4 },
        { plantId: 1, plantName: 'Tomato', spacingXCm: 50, spacingYCm: 60, offsetXCm: 0, offsetYCm: 0 },
        { plantId: 2, varietyId: 20, plantName: 'Basil duplicate', spacingXCm: 99, spacingYCm: 99, offsetXCm: 9, offsetYCm: 9 }
    ];
    assert.equal(hooks.CompanionSetLayoutDefaultModel.cropSetKey(rows), 'p:1+v:20'); // CHANGE: set defaults are unordered and variety-specific when a variety exists.
    assert.equal(hooks.CompanionSetLayoutDefaultModel.cropSetKey(rows, true), 'p:1+p:2'); // CHANGE: plant-level fallback ignores varieties.
    const normalized = hooks.CompanionSetLayoutDefaultModel.normalizeLayout(rows);
    assert.equal(normalized.cropSetKey, 'p:1+v:20');
    assert.equal(normalized.rows.length, 2);
    assert.deepEqual(JSON.parse(JSON.stringify(normalized.rows.map(row => row.identityKey))), ['v:20', 'p:1']);
    assert.equal(Object.prototype.hasOwnProperty.call(normalized.rows[0], 'template'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(normalized.rows[0], 'anchorPlantId'), false);
});

test('graph-created companion pairs get an in-memory relationship before DB default save', () => {
    const sourcePlant = makeCrop({ plant_id: 11, plant_name: 'Tomato' });
    const companionPlant = makeCrop({ plant_id: 22, plant_name: 'Basil' });
    const relationship = hooks.buildGraphCreatedCompanionRelationship(sourcePlant, companionPlant, { startOffsetDays: -3, layoutTemplate: 'staggered', layoutOffsetXCm: 12 });
    assert.equal(relationship.relationId, '');
    assert.equal(relationship.sourcePlantId, '11');
    assert.equal(relationship.companionPlantId, '22');
    assert.equal(relationship.p1, 'Tomato');
    assert.equal(relationship.p2, 'Basil');
    assert.equal(relationship.recommendedStartOffsetDays, -3);
    assert.equal(relationship.layoutTemplate, 'staggered');
    assert.equal(relationship.layoutOffsetXCm, 12);
    assert.equal(relationship.graphCreated, true);
});

test('scheduler companion layout reads prefer current planting offsets over legacy companion offsets', () => {
    assert.match(schedulerSource, /layoutOffsetXCm: finiteNumberOrNull\(companionCell\?\.getAttribute\?\.\('layout_offset_x_cm'\)\) \?\? finiteNumberOrNull\(companionCell\?\.getAttribute\?\.\('companion_offset_x_cm'\)\)/); // CHANGE: graph-created relationship fallback must not shadow edited planting offsets.
    assert.match(schedulerSource, /layoutOffsetYCm: finiteNumberOrNull\(companionCell\?\.getAttribute\?\.\('layout_offset_y_cm'\)\) \?\? finiteNumberOrNull\(companionCell\?\.getAttribute\?\.\('companion_offset_y_cm'\)\)/);
    assert.match(schedulerSource, /x: readCellLayoutNumber\(companionCell, 'layout_offset_x_cm'\) \?\? readCellLayoutNumber\(companionCell, 'companion_offset_x_cm'\)/); // CHANGE: companion rows display the canonical planting offset when both attrs exist.
    assert.match(schedulerSource, /y: readCellLayoutNumber\(companionCell, 'layout_offset_y_cm'\) \?\? readCellLayoutNumber\(companionCell, 'companion_offset_y_cm'\)/);
    assert.match(schedulerSource, /layoutOffsetXCm: finiteNumberOrNull\(cell\.getAttribute\?\.\('layout_offset_x_cm'\)\) \?\? finiteNumberOrNull\(cell\.getAttribute\?\.\('companion_offset_x_cm'\)\)/); // CHANGE: legacy schedule edits preserve fallback without overriding canonical offsets.
});

test('derived schedule helpers gate companion lifecycle and compute turnover gaps', () => {
    const annual = makeCrop({ plant_id: 1, annual: 1, biennial: 0, perennial: 0 });
    const perennial = makeCrop({ plant_id: 2, annual: 0, biennial: 0, perennial: 1, lifespan_years: 3 });
    assert.equal(hooks.lifecycleEligibleForDerivedCompanion(annual, perennial), false);
    assert.equal(hooks.lifecycleEligibleForDerivedCompanion(perennial, annual), true);
    const sourceCell = { id: 'source-2', getAttribute: key => ({ plant_id: '1', sow_date: '2026-04-01', harvest_end: '2026-09-15' }[key] || '') };
    const result = { timelines: [{ sow: new Date('2026-09-16T00:00:00Z'), harvestEnd: new Date('2026-10-30T00:00:00Z') }] };
    const patch = hooks.buildDerivedRelationshipPatch(sourceCell, annual, result, { mode: 'turnover', sourcePlant: annual, sourceOccupancy: hooks.sourceOccupancyWindowForDerived(sourceCell, annual) });
    assert.equal(patch.turnover_gap_days, '1');
});

test('scheduler adjacent gap hints render before and after gaps', () => {
    const hints = hooks.computeSchedulerAdjacentGapHints([
        { cellId: 'prev', label: 'Lettuce', cropName: 'Lettuce', startISO: '2026-04-01', endISO: '2026-05-01' },
        { cellId: 'current', label: 'Beet', cropName: 'Beet', startISO: '2026-05-05', endISO: '2026-06-01' },
        { cellId: 'next', label: 'Carrot', cropName: 'Carrot', startISO: '2026-06-13', endISO: '2026-07-01' }
    ], { startISO: '2026-05-05', endISO: '2026-06-01' }, { excludeCellIds: ['current'], basisLabel: 'current planting' });
    assert.equal(hints.text, '4d gap after Lettuce; 12d gap before Carrot'); // CHANGE: non-overlap text is neighbor-relative.
    assert.match(hints.tooltip, /4d gap after Lettuce/);
    assert.match(hints.tooltip, /12d gap before Carrot/);
});

test('scheduler adjacent gap hints label overlaps by occupancy start delta', () => {
    const hints = hooks.computeSchedulerAdjacentGapHints([
        { cellId: 'prev', label: 'Lettuce', cropName: 'Lettuce', startISO: '2026-05-01', endISO: '2026-05-08' },
        { cellId: 'next', label: 'Carrot', cropName: 'Carrot', startISO: '2026-05-28', endISO: '2026-07-01' }
    ], { startISO: '2026-05-05', endISO: '2026-06-01' }, {});
    assert.equal(hints.text, 'Starts 4d after Lettuce; Starts 23d before Carrot'); // CHANGE: overlaps report start relationship instead of overlap duration.
    assert.equal(hints.overlaps.length, 2);
});

test('scheduler classifies occupancy overlaps by companion rating', () => {
    assert.equal(hooks.schedulerConflictKindFromRelationship({ known: true, rating: 1 }), 'companion');
    assert.equal(hooks.schedulerConflictKindFromRelationship({ known: true, rating: 0 }), 'companion');
    assert.equal(hooks.schedulerConflictKindFromRelationship({ known: true, rating: -1 }), 'incompatible');
    assert.equal(hooks.schedulerConflictKindFromRelationship(null), 'unknown');

    const relationships = new Map([
        ['2', { known: true, rating: -1 }],
        ['3', { known: true, rating: 1 }]
    ]);
    const incompatible = hooks.classifySchedulerOccupancyConflict({ plantId: '2', label: 'Fennel' }, relationships); // CHANGE
    assert.equal(incompatible.kind, 'incompatible'); // CHANGE
    assert.equal(incompatible.severity, 'block'); // CHANGE
    assert.equal(incompatible.label, 'Fennel'); // CHANGE
    assert.equal(incompatible.message, 'Incompatible overlap with Fennel'); // CHANGE
    assert.equal(incompatible.relationship.rating, -1); // CHANGE
    assert.equal(hooks.classifySchedulerOccupancyConflict({ plantId: '3', label: 'Basil' }, relationships).kind, 'companion');
    assert.equal(hooks.classifySchedulerOccupancyConflict({ plantId: '4', label: 'Mystery crop' }, relationships).kind, 'unknown');
});

test('bed-first scheduler entrypoint is separate from strict planting-group scheduler', () => {
    assert.match(schedulerSource, /async function openBedScheduleDialog\(ui, bedCell, openOptions = \{\}\)/);
    assert.match(schedulerSource, /openBedScheduleDialog: \(ui, bedCell, options\) => openBedScheduleDialog\(ui, bedCell, options\)/);
    assert.match(schedulerSource, /async function openScheduleDialog\(ui, cell, openOptions = \{\}\) \{\s*requireCanSchedulePlantingGroup\(cell\);/);
    assert.match(schedulerSource, /createTargetCell: bedTargetCreation && bedTargetCreation\.createTargetCell/);
});

test('scheduler start hints use selected-cluster occupancy context', () => {
    const hints = hooks.computeSchedulerAdjacentGapHints([
        { cellId: 'overhang', label: 'Apple', cropName: 'Apple', startISO: '2025-01-01', endISO: '2030-12-31' }
    ], { startISO: '2026-05-05', endISO: '2026-06-01' }, {});
    assert.equal(hints.text, 'Starts 489d after Apple'); // CHANGE: cluster-supplied overhanging perennials can be referenced by Start context.
    assert.match(schedulerSource, /function schedulerClusterOccupancyItemsForGap\(\)[\s\S]*getSelectedClusterOccupancy\(anchorCell\)/); // CHANGE: Start relationship hints intentionally use spatial cluster context.
});

test('scheduler adjacent gap hints cap multiple overlaps and disambiguate duplicate crop names', () => {
    const capped = hooks.computeSchedulerAdjacentGapHints([
        { cellId: 'a', label: 'Lettuce', cropName: 'Lettuce', startISO: '2026-05-01', endISO: '2026-05-20' },
        { cellId: 'b', label: 'Basil', cropName: 'Basil', startISO: '2026-05-07', endISO: '2026-05-22' },
        { cellId: 'c', label: 'Spinach', cropName: 'Spinach', startISO: '2026-04-20', endISO: '2026-06-01' }
    ], { startISO: '2026-05-05', endISO: '2026-05-12' }, {});
    assert.equal(capped.text, 'Starts 2d before Basil; Starts 4d after Lettuce; +1 more'); // CHANGE: show nearest overlapping starts only.

    const duplicates = hooks.computeSchedulerAdjacentGapHints([
        { cellId: 'l1', label: 'Lettuce - Buttercrunch', cropName: 'Lettuce', varietyName: 'Buttercrunch', startISO: '2026-05-01', endISO: '2026-05-20' },
        { cellId: 'l2', label: 'Lettuce - Romaine', cropName: 'Lettuce', varietyName: 'Romaine', startISO: '2026-05-12', endISO: '2026-05-25' }
    ], { startISO: '2026-05-10', endISO: '2026-05-18' }, {});
    assert.equal(duplicates.text, 'Starts 2d before Lettuce - Romaine; Starts 9d after Lettuce - Buttercrunch'); // CHANGE: duplicate crop names use variety inline.
});

test('scheduler adjacent gap hints hide when no comparable plantings exist', () => {
    const hints = hooks.computeSchedulerAdjacentGapHints([
        { cellId: 'current', label: 'Beet', cropName: 'Beet', startISO: '2026-05-05', endISO: '2026-06-01' }
    ], { startISO: '2026-05-05', endISO: '2026-06-01' }, { excludeCellIds: ['current'] });
    assert.equal(hints.text, ''); // CHANGE: empty selected-cluster comparison does not add low-value text.
    assert.equal(hints.tooltip, '');
});

test('scheduler adjacent gap hints support companion-own window and turnover bases', () => {
    const source = { startISO: '2026-05-10', endISO: '2026-07-01' };
    const companion = { startISO: '2026-05-01', endISO: '2026-06-15' };
    const companionHints = hooks.computeSchedulerAdjacentGapHints([
        { cellId: 'source', label: 'Source lettuce', cropName: 'Lettuce', startISO: source.startISO, endISO: source.endISO },
        { cellId: 'prev', label: 'Potato', cropName: 'Potato', startISO: '2026-03-01', endISO: '2026-04-20' },
        { cellId: 'next', label: 'Carrot', cropName: 'Carrot', startISO: '2026-07-10', endISO: '2026-08-01' }
    ], companion, { basisLabel: 'companion planting' });
    assert.equal(companionHints.text, 'Starts 9d before Lettuce'); // CHANGE: companion start context uses the companion window and includes the source planting.
    assert.match(companionHints.tooltip, /companion planting/);
    assert.match(schedulerSource, /basisLabel:\s*'companion planting'/); // CHANGE: builder-level companion context no longer uses a combined pair window.
    assert.doesNotMatch(schedulerSource, /source and companion planting pair/);
    const turnoverHints = hooks.computeSchedulerAdjacentGapHints([
        { cellId: 'source', label: 'Lettuce', cropName: 'Lettuce', startISO: '2026-04-01', endISO: '2026-07-01' },
        { cellId: 'next', label: 'Carrot', cropName: 'Carrot', startISO: '2026-08-20', endISO: '2026-09-10' }
    ], { startISO: '2026-07-02', endISO: '2026-08-01' }, { basisLabel: 'turnover planting' });
    assert.equal(turnoverHints.text, '1d gap after Lettuce; 19d gap before Carrot'); // CHANGE: turnover keeps source/next gap context with new wording.
});

test('scheduler dialog removes Layout tab while exposing diagram spacing tools', () => {
    assert.match(schedulerSource, /const scheduleTabBtn = makeTabButton\("Schedule", div\)/);
    assert.match(schedulerSource, /const tasksTabBtn = mxUtils\.button\("Tasks"/);
    assert.match(schedulerSource, /tabsHeader\.appendChild\(scheduleTabBtn\);[\s\S]*tabsHeader\.appendChild\(tasksTabBtn\);/);
    assert.doesNotMatch(schedulerSource, /const layoutTabBtn = mxUtils\.button\("Layout"/); // CHANGE: physical layout editing moved out of the scheduler dialog.
    assert.doesNotMatch(schedulerSource, /tabsHeader\.appendChild\(layoutTabBtn\)/);
    assert.match(schedulerSource, /const layoutTools = \{[\s\S]*buildSpacingLayoutRows[\s\S]*validateSpacingDraft[\s\S]*buildSpacingPreviewModel[\s\S]*applySpacingDraft/); // CHANGE: diagram overlay uses a narrow scheduler layout service.
    assert.match(schedulerSource, /layoutOffsetForDerivedCreation\(\)/);
    assert.match(schedulerSource, /writeCellAttribute\(targetCell, 'companion_relation_id', '',/); // CHANGE: legacy relation metadata is cleared instead of refreshed.
    assert.match(schedulerSource, /targetGeometryRect: layoutGraphApplication\.targetRect/);
    assert.match(schedulerSource, /extraAttributePatches: \(layoutGraphApplication\.extraAttributePatches/);
    assert.match(schedulerSource, /CompanionSetLayoutDefaultModel\.save/);
    assert.match(schedulerSource, /applySetDefault/);
    assert.match(schedulerSource, /applyScheduleCompanionSetDefaults/);
    assert.doesNotMatch(schedulerSource, /mxUtils\.button\('Apply layout'/);
    assert.doesNotMatch(schedulerSource, /Save changed defaults/);
    assert.doesNotMatch(schedulerSource, /geometryRect: rowRect/);
});

test('plant editor exposes layout defaults without a diagram preview', () => {
    assert.match(schedulerSource, /const spacingXInput = makeNullableNumber\(existing\?\.spacing_x_cm/);
    assert.match(schedulerSource, /const spacingYInput = makeNullableNumber\(existing\?\.spacing_y_cm/);
    assert.match(schedulerSource, /spacing_x_cm: readNullableNumber\(spacingXInput\)/);
    assert.match(schedulerSource, /spacing_y_cm: readNullableNumber\(spacingYInput\)/);
    assert.doesNotMatch(schedulerSource, /plantLayoutHeading\.textContent = 'Layout'/);
    assert.doesNotMatch(schedulerSource, /plantLayoutPreview/);
    assert.doesNotMatch(schedulerSource, /Companion pair layout defaults/);
    assert.doesNotMatch(schedulerSource, /CompanionRelationshipModel\.saveLayoutDefaults\(relationship\.relationId, readCompanionLayoutDraft\(\), relationship\)/);
});

test('plant editor yield inputs use tenth-step affordance without rejecting precise values', () => { // CHANGE
    assert.match(schedulerSource, /const YIELD_INPUT_PREFERRED_STEP = 0\.1;/); // CHANGE
    assert.match(schedulerSource, /function configurePreferredNumberStep\(input, preferredStep\)[\s\S]*input\.step = 'any';[\s\S]*input\.dataset\.preferredStep/); // CHANGE
    assert.match(schedulerSource, /const yieldInput = configurePreferredNumberStep\(makeNullableNumber\(existing\?\.yield_per_plant_kg \?\? null, \{ min: 0, step: 'any' \}\), YIELD_INPUT_PREFERRED_STEP\);/); // CHANGE
    assert.match(schedulerSource, /\{ key: 'yield_per_plant_kg', type: 'num_ge0', step: 'any', preferredStep: YIELD_INPUT_PREFERRED_STEP \}/); // CHANGE
    assert.doesNotMatch(schedulerSource, /yield_per_plant_kg[\s\S]{0,120}step: 0\.001/); // CHANGE
}); // CHANGE

test('add variety editor focuses and temporarily highlights the variety name field', () => { // CHANGE
    assert.match(schedulerSource, /\.usl-plant-editor-field-highlight\{/); // CHANGE
    assert.match(schedulerSource, /function focusAndHighlightVarietyNameField\(\) \{[\s\S]*basics\.setOpen\(true\)[\s\S]*varietyNameInput[\s\S]*classList\.add\('usl-plant-editor-field-highlight'\)[\s\S]*setTimeout\(\(\) => \{ if \(target && target\.classList\) target\.classList\.remove\('usl-plant-editor-field-highlight'\); \}, 1200\)[\s\S]*target\.focus/); // CHANGE
    assert.match(schedulerSource, /const commitPromise = showCommitDialog\(ui, \{ container: div, width: 940, height: 620, modal: true, closable: true \}\);[\s\S]*if \(initialStartVarietyMode === 'add'\) focusAndHighlightVarietyNameField\(\);[\s\S]*return await commitPromise/); // CHANGE
}); // CHANGE

test('turnover computed-window filtering rejects same-bed occupancy overlap', () => {
    const sourceCell = { id: 'source-3', getAttribute: key => ({ sow_date: '2026-04-01', harvest_end: '2026-09-15' }[key] || '') };
    const blockedGraph = { __trellisBedSuccessionNavigator: { getSelectedBedOccupancy: () => ({ items: [
        { cellId: 'source-3', startISO: '2026-04-01', endISO: '2026-09-15' },
        { cellId: 'other', startISO: '2026-10-01', endISO: '2026-11-01' }
    ] }) } };
    const clearGraph = { __trellisBedSuccessionNavigator: { getSelectedBedOccupancy: () => ({ items: [
        { cellId: 'source-3', startISO: '2026-04-01', endISO: '2026-09-15' },
        { cellId: 'other', startISO: '2026-11-15', endISO: '2026-12-01' }
    ] }) } };
    const computedWindow = { startISO: '2026-09-16', endISO: '2026-10-23' };
    assert.equal(hooks.turnoverComputedWindowFitsSourceCluster(sourceCell, computedWindow, blockedGraph), false);
    assert.equal(hooks.turnoverComputedWindowFitsSourceCluster(sourceCell, computedWindow, clearGraph), true);
});

test('turnover capacity ignores overhanging cluster occupancy when bed API is present', () => {
    const sourceCell = { id: 'source-5', getAttribute: key => ({ sow_date: '2026-04-01', harvest_end: '2026-09-15' }[key] || '') };
    const graph = { __trellisBedSuccessionNavigator: {
        getSelectedBedOccupancy: () => ({ items: [
            { cellId: 'source-5', startISO: '2026-04-01', endISO: '2026-09-15' }
        ] }),
        getSelectedClusterOccupancy: () => ({ items: [
            { cellId: 'source-5', startISO: '2026-04-01', endISO: '2026-09-15' },
            { cellId: 'overhang', startISO: '2026-10-01', endISO: '2026-11-01' }
        ] })
    } };
    const computedWindow = { startISO: '2026-09-16', endISO: '2026-10-23' };
    assert.equal(hooks.turnoverComputedWindowFitsSourceCluster(sourceCell, computedWindow, graph), true); // CHANGE: turnover capacity follows bed-contained occupancy instead of broader cluster context.
    assert.match(schedulerSource, /getSelectedBedOccupancy\(sourceCell\)/); // CHANGE: derived turnover filtering prefers the new bed-only navigator API.
});

test('turnover candidate filtering uses the computed schedule window', async () => {
    const sourceCell = {
        id: 'source-4',
        getAttribute: key => ({ method_category_id: 'direct_sow', method_id: 'direct_sow.field', sow_date: '2026-04-01', harvest_end: '2026-09-15' }[key] || '')
    };
    const candidate = makeCrop({ plant_id: 14, plant_name: 'Computed Turnover', days_maturity: 30, harvest_window_days: 7, annual: 1, biennial: 0, perennial: 0 });
    const city = makeCity(hooks, 22);
    const window = await hooks.computeAnnualTurnoverWindowForCandidate(sourceCell, candidate, '2026-09-16', { city, cityName: city.city_name, year: 2026, bedProfile: hooks.normalizeBedProfile(null) });
    assert.ok(window?.startISO, 'expected computed turnover start');
    assert.ok(window?.endISO, 'expected computed turnover harvest end');
    const blockedGraph = { __trellisBedSuccessionNavigator: { getSelectedBedOccupancy: () => ({ items: [
        { cellId: 'source-4', startISO: '2026-04-01', endISO: '2026-09-15' },
        { cellId: 'other', startISO: window.endISO, endISO: hooks.shiftISODate(window.endISO, 2) }
    ] }) } };
    assert.equal(await hooks.turnoverCandidateFitsSourceCluster(sourceCell, candidate, '2026-09-16', { graph: blockedGraph, city, cityName: city.city_name, year: 2026, bedProfile: hooks.normalizeBedProfile(null) }), false);
});

test('perennial crop suitability is alphabetic and date-flexible', async () => {
    const perennial = makeCrop({ plant_id: 1, plant_name: 'Rhubarb', annual: 0, biennial: 0, perennial: 1, lifespan_years: 3 });
    const score = await hooks.scoreCropSuitability(perennial, {});
    assert.equal(score.hint, 'date-flexible');
    const groups = hooks.buildGroupedCropOptions(hooks.makeCropPickerOptions([
        makeCrop({ plant_id: 2, plant_name: 'Z Perennial', annual: 0, biennial: 0, perennial: 1, lifespan_years: 3 }),
        makeCrop({ plant_id: 3, plant_name: 'A Perennial', annual: 0, biennial: 0, perennial: 1, lifespan_years: 3 })
    ]), { filter: 'perennial' });
    assert.deepEqual(Array.from(groups[0].options, option => option.label), ['A Perennial', 'Z Perennial']);
});

function makeVariety(overrides = {}) {
    return {
        variety_id: overrides.variety_id ?? 1,
        plant_id: overrides.plant_id ?? 1,
        variety_name: overrides.variety_name || 'Variety',
        maturity_class: overrides.maturity_class ?? '',
        overrides_json: JSON.stringify(overrides.overrides || {}),
        ...overrides
    };
}

test('variety options group exact Trellis defaults separately from user varieties', () => {
    const groups = hooks.buildGroupedVarietyOptions([
        makeVariety({ variety_id: 1, variety_name: 'Late maturity', maturity_class: 'late', overrides: { days_maturity: 70 } }),
        makeVariety({ variety_id: 2, variety_name: 'Roma', maturity_class: 'early', overrides: { days_maturity: 50 } }),
        makeVariety({ variety_id: 3, variety_name: 'Very early maturity', maturity_class: 'very_early', overrides: { days_maturity: 40 } }),
        makeVariety({ variety_id: 4, variety_name: 'Black Krim', overrides: { days_maturity: 80 } }),
        makeVariety({ variety_id: 5, variety_name: 'Mid maturity', maturity_class: 'mid', overrides: { days_maturity: 60 } })
    ]);
    assert.deepEqual(Array.from(groups, group => group.label), ['Trellis defaults', 'Your varieties']);
    assert.deepEqual(Array.from(groups, group => Array.from(group.options, option => option.label)), [
        ['Very early maturity - 40d', 'Mid maturity - 60d', 'Late maturity - 70d'],
        ['Black Krim - 80d', 'Roma - 50d']
    ]);
});

test('variety options require exact generic name and class for Trellis defaults', () => {
    const groups = hooks.buildGroupedVarietyOptions([
        makeVariety({ variety_id: 1, variety_name: 'Very early maturity', maturity_class: 'early' }),
        makeVariety({ variety_id: 2, variety_name: 'Early maturity', maturity_class: 'early' }),
        makeVariety({ variety_id: 3, variety_name: 'Very Quick', maturity_class: 'very_early' })
    ]);
    assert.deepEqual(Array.from(groups, group => group.label), ['Trellis defaults', 'Your varieties']);
    assert.deepEqual(Array.from(groups[0].options, option => option.label), ['Early maturity']);
    assert.deepEqual(Array.from(groups[1].options, option => option.label), ['Very early maturity', 'Very Quick']);
});

test('variety picker uses flat user-only list and defaults-only add group', () => {
    const userOnly = hooks.buildVarietyPickerGroups([
        makeVariety({ variety_id: 1, variety_name: 'Zebra' }),
        makeVariety({ variety_id: 2, variety_name: 'Alpha' })
    ], { includeBase: true, includeNew: true, newValue: '__NEW__' });
    assert.equal(userOnly.length, 1);
    assert.equal(userOnly[0].flat, true);
    assert.deepEqual(Array.from(userOnly[0].options, option => option.label), ['(base plant)', 'Add variety...', 'Alpha', 'Zebra']);

    const defaultsOnly = hooks.buildVarietyPickerGroups([
        makeVariety({ variety_id: 3, variety_name: 'Very late maturity', maturity_class: 'very_late' })
    ], { includeBase: true, includeNew: true, newValue: '__NEW__' });
    assert.deepEqual(Array.from(defaultsOnly, group => group.label), ['Selection', 'Trellis defaults', 'Your varieties']);
    assert.deepEqual(Array.from(defaultsOnly[2].options, option => option.label), ['Add variety...']);
});

test('rendered variety dropdown keeps base plant first and source groups', () => {
    const document = hooks.__testWindow.document;
    const select = document.createElement('select');
    const groups = hooks.buildGroupedVarietyOptions([
        makeVariety({ variety_id: 1, variety_name: 'Early maturity', maturity_class: 'early' }),
        makeVariety({ variety_id: 2, variety_name: 'Alpha', maturity_class: 'early' })
    ]);
    hooks.renderGroupedVarietyOptions(select, groups, '1');
    assert.equal(select.options[0].textContent, '(base plant)');
    assert.deepEqual(Array.from(select.querySelectorAll('optgroup'), group => group.label), ['Trellis defaults', 'Your varieties']);
    assert.equal(select.value, '1');
});

test('manual variety maturity mismatch warns only when inference is available', () => {
    const rows = [
        makeVariety({ variety_id: 1, variety_name: 'Fast', maturity_class: 'late', overrides: { days_maturity: 40 } }),
        makeVariety({ variety_id: 2, variety_name: 'Middle', overrides: { days_maturity: 60 } }),
        makeVariety({ variety_id: 3, variety_name: 'Slow', overrides: { days_maturity: 80 } })
    ];
    const mismatch = hooks.manualVarietyMaturityMismatch(rows, rows[0]);
    assert.equal(mismatch.manualClass, 'late');
    assert.equal(mismatch.inferredClass, 'early');
    assert.equal(mismatch.source, 'days_maturity');
    assert.equal(hooks.manualVarietyMaturityMismatch(rows.slice(0, 2), rows[0]), null);
});

test('missing city fallback keeps Set Plant style options grouped alphabetically', () => {
    const crops = [
        makeCrop({ plant_id: 1, plant_name: 'Zucchini', annual: 1, biennial: 0, perennial: 0 }),
        makeCrop({ plant_id: 2, plant_name: 'Arugula', annual: 1, biennial: 0, perennial: 0 })
    ];
    const groups = hooks.buildGroupedCropOptions(hooks.makeCropPickerOptions(crops), { filter: 'all' });
    assert.equal(groups[0].label, 'Annual crops');
    assert.deepEqual(Array.from(groups[0].options, option => option.label), ['Arugula', 'Zucchini']);
    assert.equal(groups[0].options.some(option => /window/.test(option.displayLabel)), false);
});

test('date-only crop-menu scoring reuses cached windows instead of queueing recomputation', async () => {
    const cache = hooks.makeCropSuitabilityCache();
    hooks.clearCropSuitabilityCache(cache);
    const city = makeCity(hooks);
    const crop = makeCrop({ plant_id: 11, plant_name: 'Cache Crop', annual: 1, biennial: 0, perennial: 0 });
    const baseContext = { city, cityName: city.city_name, primaryDateISO: '2026-04-01', seasonStartYear: 2026, cache };
    const first = await hooks.scoreCropSuitability(crop, baseContext);
    assert.equal(first.pending, undefined);
    assert.equal(cache.windowsByKey.size, 1);
    const second = await hooks.scoreCropSuitability(crop, { ...baseContext, primaryDateISO: '2026-04-15', deferMissingWindows: true });
    assert.equal(second.pending, undefined);
    assert.equal(cache.pendingByKey.size, 0);
    assert.equal(cache.queue.length, 0);
    assert.equal(cache.windowsByKey.size, 1);
});

test('pending annual crop options render calculating hints and remain selectable', async () => {
    const cache = hooks.makeCropSuitabilityCache();
    hooks.clearCropSuitabilityCache(cache);
    const city = makeCity(hooks);
    const crop = makeCrop({ plant_id: 12, plant_name: 'Pending Crop', annual: 1, biennial: 0, perennial: 0 });
    const options = await hooks.scoreCropPickerOptions([crop], {
        city,
        cityName: city.city_name,
        primaryDateISO: '2026-04-01',
        seasonStartYear: 2026,
        cache,
        deferMissingWindows: true
    });
    assert.equal(options[0].displayLabel, 'Pending Crop - calculating');
    assert.equal(options[0].score.pending, true);
    const groups = hooks.buildGroupedCropOptions(options, { filter: 'annual', selectedValue: '12' });
    assert.equal(groups[0].options[0].value, '12');
    assert.equal(cache.pendingByKey.size, 1);
});

test('crop suitability cache key changes with full growing context', () => {
    const city = makeCity(hooks);
    const crop = makeCrop({ plant_id: 13, plant_name: 'Key Crop', annual: 1, biennial: 0, perennial: 0 });
    const base = { city, cityName: city.city_name, seasonStartYear: 2026, bedProfile: hooks.normalizeBedProfile(null), bedProfileSource: 'generic garden bed' };
    const same = hooks.makeCropWindowCacheKey(crop, { ...base });
    const bedChanged = hooks.makeCropWindowCacheKey(crop, { ...base, bedProfile: hooks.normalizeBedProfile({ soil: 'raised' }), bedProfileSource: 'raised bed' });
    const yearChanged = hooks.makeCropWindowCacheKey(crop, { ...base, seasonStartYear: 2027 });
    assert.equal(hooks.makeCropWindowCacheKey(crop, { ...base }), same);
    assert.notEqual(bedChanged, same);
    assert.notEqual(yearChanged, same);
});

test('selected-crop date fast path selects containing cached sowing season', () => {
    const state = {
        windowFeasible: true,
        startISO: '2026-03-15',
        activeSowingSeasonId: 'spring',
        sowingSeasons: [
            { id: 'spring', label: 'Spring', startISO: '2026-03-01', endISO: '2026-05-31' },
            { id: 'fall', label: 'Fall', startISO: '2026-08-15', endISO: '2026-09-15' }
        ]
    };
    const result = hooks.applyDateToExistingSowingWindows(state, { startISO: '2026-08-20' });
    assert.equal(result.applied, true);
    assert.equal(state.activeSowingSeasonId, 'fall');
    assert.equal(result.classification.status, 'feasible');
});

test('selected-crop date fast path preserves active season when outside cached windows', () => {
    const state = {
        windowFeasible: true,
        startISO: '2026-03-15',
        activeSowingSeasonId: 'spring',
        sowingSeasons: [
            { id: 'spring', label: 'Spring', startISO: '2026-03-01', endISO: '2026-05-31' },
            { id: 'fall', label: 'Fall', startISO: '2026-08-15', endISO: '2026-09-15' }
        ]
    };
    const result = hooks.applyDateToExistingSowingWindows(state, { startISO: '2026-07-01' });
    assert.equal(result.applied, true);
    assert.equal(state.activeSowingSeasonId, 'spring');
    assert.equal(result.classification.status, 'outside_window');
});

test('missing selected-crop cached windows require anchor recomputation fallback', () => {
    const result = hooks.applyDateToExistingSowingWindows({ windowFeasible: true, sowingSeasons: [], activeSowingSeasonId: '' }, { startISO: '2026-04-01' });
    assert.equal(result.applied, false);
    assert.equal(result.reason, 'missing cached windows');
});

test('date and filter handlers use cached fast paths', () => {
    assert.match(schedulerSource, /case 'startChanged':[\s\S]*applySelectedDateOnlyFastPath\(\)[\s\S]*await recomputeAnchors\(false, false\);/);
    assert.ok(schedulerSource.includes('renderSchedulerCropPicker(currentCropPickerOptions, currentCropPickerSelectedValue);'));
    assert.ok(!schedulerSource.includes("lifecycleFilterSel.addEventListener('change', () => {\r\n            renderSchedulerCropPicker(currentCropPickerOptions, plantSel.value);\r\n            scheduleCropPickerSuitabilityRefresh(0);"));
});

test('growth stage dropdown change recomputes scheduler anchors and harvest dates', () => {
    const handlerStart = schedulerSource.indexOf("growthStageSel.addEventListener('change'");
    const handlerEnd = schedulerSource.indexOf("minYieldMultInput.addEventListener", handlerStart);
    assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, 'expected growth stage change handler');
    const handlerBody = schedulerSource.slice(handlerStart, handlerEnd);
    assert.match(handlerBody, /await recomputeAll\('growthStageChanged'\)/);

    assert.match(
        schedulerSource,
        /case 'growthStageChanged':\s*[\r\n]+\s*case 'varietyChanged': \{[\s\S]*await recomputeAnchors\(false, true\);[\s\S]*await recomputeLastHarvestFromSchedule\(\);/
    );
});

test('crop picker selection stays fresh across async refreshes', () => {
    assert.match(schedulerSource, /let currentCropPickerSelectedValue = String\(initialPlant\?\.plant_id \?\? plantsLocal\[0\]\?\.plant_id \?\? ''\);/);
    assert.match(schedulerSource, /function renderSchedulerCropPicker\(pickerOptions = currentCropPickerOptions, selectedValue = currentCropPickerSelectedValue\)/);
    assert.doesNotMatch(schedulerSource, /async function refreshSchedulerCropPickerSuitability\(\) \{[\s\S]*const selectedValue = plantSel\.value;/);
    assert.match(schedulerSource, /renderSchedulerCropPicker\(nextOptions, currentCropPickerSelectedValue\);/);
    assert.match(schedulerSource, /plantSel\.addEventListener\('change', \(\) => \{[\s\S]*currentCropPickerSelectedValue = String\(plantSel\.value \|\| ''\);[\s\S]*schedulerCropPickerRefreshVersion \+= 1;[\s\S]*renderSchedulerCropPicker\(currentCropPickerOptions, currentCropPickerSelectedValue\);[\s\S]*await handleSchedulePlantChange\(\);/);
    assert.match(schedulerSource, /formState\.plantId = Number\(plantSel\.value\);[\s\S]*currentCropPickerSelectedValue = String\(formState\.plantId \|\| ''\);/);
});

test('crop changes preserve only genuine selected dates before recomputing windows', () => {
    assert.match(schedulerSource, /const preservedPrimaryDateISO = String\(startInput\.value \|\| ''\)\.trim\(\);/);
    assert.match(schedulerSource, /const preservePrimaryDate = .*hasPersistedSchedule \|\| userEditedStartThisSession \|\| preserveDerivedGeneratedDate/);
    assert.match(schedulerSource, /else if \(generatedStartThisSession\) \{[\s\S]*startInput\.value = '';[\s\S]*sowingSeasonSel\.value = '';[\s\S]*formState\.activeSowingSeasonId = '';/);
    assert.match(schedulerSource, /startInput\.addEventListener\('input'[\s\S]*userEditedStartThisSession = true;[\s\S]*generatedStartThisSession = false;/);
    assert.match(schedulerSource, /sowingSeasonSel\.addEventListener\('change'[\s\S]*userEditedStartThisSession = false;[\s\S]*generatedStartThisSession = !hasPersistedSchedule && !mode\.perennial && !!formState\.startISO;/);
    assert.match(schedulerSource, /case 'plantChanged': \{[\s\S]*await recomputeAnchors\(false, true\);/);
});

function makeSummaryViewState(overrides = {}) {
    return hooks.buildScheduleViewState({
        windowFeasible: true,
        plantName: 'Tomato',
        cityName: 'Test City',
        seasonStartYear: 2026,
        methodName: 'Direct sow',
        startISO: '2026-04-01',
        sowingSeasons: [{ id: 'spring', label: 'Spring', startISO: '2026-03-01', endISO: '2026-05-31' }],
        activeSowingSeasonId: 'spring',
        firstHarvestISO: '2026-06-01',
        lastHarvestISO: '2026-06-08',
        ...overrides
    });
}

test('schedule summary view state de-duplicates warning bullet messages', () => {
    const viewState = makeSummaryViewState({
        scheduleWarnings: [
            { message: 'There is not enough growing-degree accumulation to reach maturity.' },
            { message: 'Selected date predicts a 51% yield reduction (49% of normal yield), below your 50% minimum.' }, // CHANGE: summary tests use the user-facing yield risk wording.
            { message: 'There is not enough growing-degree accumulation to reach maturity.' },
            { message: '   ' },
            { type: 'missing_message' }
        ]
    });

    assert.equal(viewState.feasibility.status, 'warning');
    assert.deepEqual(Array.from(viewState.feasibility.warningMessages), [
        'There is not enough growing-degree accumulation to reach maturity.',
        'Selected date predicts a 51% yield reduction (49% of normal yield), below your 50% minimum.' // CHANGE: summary warning de-dupe preserves the new low-yield message.
    ]);
});

test('schedule summary renders warnings as bullet list in double-wide feasibility item', () => {
    const summaryView = hooks.renderScheduleSummary();
    const viewState = makeSummaryViewState({
        scheduleWarnings: [
            { message: 'There is not enough growing-degree accumulation to reach maturity.' },
            { message: 'Selected date predicts a 51% yield reduction (49% of normal yield), below your 50% minimum.' } // CHANGE: rendered bullet copy matches the scheduler low-yield message.
        ]
    });

    hooks.updateScheduleSummary(summaryView, viewState);

    assert.deepEqual(Object.keys(summaryView.fields), ['crop', 'context', 'feasibility']);
    assert.equal(summaryView.root.textContent.includes('Expected first harvest'), false);
    assert.equal(summaryView.root.textContent.includes('Expected harvest end'), false);
    const feasibilityItem = summaryView.fields.feasibility.parentElement;
    const warningItems = Array.from(summaryView.fields.feasibility.querySelectorAll('ul.usl-scheduler-summary-warning-list > li'), item => item.textContent);
    assert.equal(feasibilityItem.classList.contains('usl-scheduler-summary-item--wide'), true);
    assert.deepEqual(warningItems, Array.from(viewState.feasibility.warningMessages));
});

test('scheduler hides duplicate harvest and context fields from main sections', () => {
    assert.match(schedulerSource, /appendFieldRows\(contextSection\.body, fieldRows, \['seasonStartYear', 'methodSelection', 'growthStage'\]\)/);
    assert.doesNotMatch(schedulerSource, /appendFieldRows\(contextSection\.body, fieldRows, \[[^\]]*'cityName'/);
    assert.match(schedulerSource, /inputsSection\.body\.appendChild\(firstSowRowObj\.row\);[\s\S]*inputsSection\.body\.appendChild\(transplantDaysRowObj\.row\);/); // CHANGE: allocation comparison and lock rows sit between date and transplant controls.
    assert.doesNotMatch(schedulerSource, /contextSection\.body\.appendChild\(transplantDaysRowObj\.row\)/);
    assert.match(schedulerSource, /endRow\.row\.style\.display = 'none';/);
    assert.doesNotMatch(schedulerSource, /harvestSection\.body\.appendChild\(harvestStartRowObj\.row\)/);
    assert.doesNotMatch(schedulerSource, /harvestSection\.body\.appendChild\(harvestEndRowObj\.row\)/);
});

test('scheduler year selector owns visible date bounds and clamping', () => {
    assert.match(schedulerSource, /function selectedSeasonStartYear\(\)[\s\S]*return currentYear;/);
    assert.match(schedulerSource, /function selectedYearDateBounds\(\)[\s\S]*minISO: `\$\{year\}-01-01`[\s\S]*maxISO: `\$\{year\}-12-31`/);
    assert.match(schedulerSource, /function clampPrimaryDateToSelectedYear\(\)[\s\S]*startInput\.value = bounds\.minISO;[\s\S]*startInput\.value = bounds\.maxISO;/);
    assert.match(schedulerSource, /function syncStartDateBounds\(\)[\s\S]*startInput\.min = bounds\.minISO;[\s\S]*startInput\.max = bounds\.maxISO;/);
    assert.match(schedulerSource, /seasonYearInput\.addEventListener\('input'[\s\S]*clampPrimaryDateToSelectedYear\(\);[\s\S]*syncStartDateBounds\(\);[\s\S]*await recomputeAll\('yearChanged'\);/);
    assert.doesNotMatch(schedulerSource, /function syncSeasonStartYearFromPrimaryDate/);
});

test('today timeline boundary is blue while latest harvest remains neutral', () => {
    assert.match(schedulerSource, /function appendVerticalTimelineBoundary\(\{ percent, label, tooltip, dataAttr, lineColor = '#64748b', labelColor = '#64748b' \}\)/);
    assert.match(schedulerSource, /label: 'Today'[\s\S]*tooltip: `Today: \$\{model\.todayISO\}`[\s\S]*dataAttr: 'data-usl-today-marker'[\s\S]*lineColor: '#2563eb'[\s\S]*labelColor: '#1d4ed8'/);
    assert.match(schedulerSource, /label: model\.latestHarvestBoundary\.label[\s\S]*tooltip: model\.latestHarvestBoundary\.tooltip[\s\S]*dataAttr: 'data-usl-latest-harvest-marker'/);
    assert.match(schedulerSource, /boundary\.style\.borderLeft = '1px dashed ' \+ lineColor;/);
    assert.match(schedulerSource, /labelEl\.textContent = label;/);
});

test('schedule summary keeps non-warning feasibility as plain text', () => {
    const summaryView = hooks.renderScheduleSummary();
    const viewState = makeSummaryViewState();

    hooks.updateScheduleSummary(summaryView, viewState);

    assert.equal(summaryView.fields.feasibility.querySelector('ul'), null);
    assert.equal(summaryView.fields.feasibility.textContent, 'The selected sow date is in Spring.');
});

test('lifecycle marker tooltip shows immediately and avoids native title', () => {
    const document = hooks.__testWindow.document;
    const win = document.defaultView;
    const track = document.createElement('div');
    const marker = document.createElement('button');
    const text = 'HS - First harvest: 2026-05-01\nClick to edit the first task rule starting here.';
    track.style.position = 'relative';
    marker.setAttribute('data-timeline-percent', '50');
    marker.setAttribute('data-timeline-offset-px', '0');
    marker.title = 'Native title should be removed';
    track.appendChild(marker);
    document.body.appendChild(track);
    hooks.attachLifecycleTimelineMarkerTooltip(marker, track, text);

    assert.equal(marker.hasAttribute('title'), false);
    assert.equal(marker.getAttribute('aria-label'), text);

    marker.dispatchEvent(new win.MouseEvent('mouseenter'));
    const tooltip = track.querySelector('.usl-lifecycle-marker-tooltip');
    assert.ok(tooltip);
    assert.equal(tooltip.style.display, 'block');
    assert.equal(tooltip.textContent, text);

    marker.dispatchEvent(new win.MouseEvent('mouseleave'));
    assert.equal(tooltip.style.display, 'none');
    marker.dispatchEvent(new win.FocusEvent('focus'));
    assert.equal(tooltip.style.display, 'block');
    marker.dispatchEvent(new win.FocusEvent('blur'));
    assert.equal(tooltip.style.display, 'none');
    marker.dispatchEvent(new win.FocusEvent('focus'));
    marker.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(tooltip.style.display, 'none');

    let clickCount = 0;
    marker.addEventListener('click', () => { clickCount += 1; });
    marker.dispatchEvent(new win.MouseEvent('click'));
    assert.equal(clickCount, 1);
    track.remove();
});

test('annual task preview fallback range remains sow through harvest', () => {
    const result = hooks.computeScheduleResult(makeInputs(hooks, { startISO: '2026-04-01' }));
    const range = hooks.resolveTaskPreviewScheduleRange(result);

    assert.deepEqual({ ...range }, {
        startISO: '2026-04-01',
        endISO: result.lastScheduledHarvestEndISO
    });
    assert.deepEqual({ ...hooks.resolveTaskPreviewDisplayRange(range, []) }, { ...range });
});

test('perennial task preview fallback range remains lifespan start through end', () => {
    const plant = makePlant(hooks, { annual: 0, perennial: 1, lifespan_years: 3 });
    const result = hooks.computeScheduleResult(makeInputs(hooks, { plant, startISO: '2026-04-15' }));
    const range = hooks.resolveTaskPreviewScheduleRange(result);

    assert.deepEqual({ ...range }, {
        startISO: result.lifespanStartISO,
        endISO: result.lifespanEndISO
    });
    assert.deepEqual({ ...hooks.resolveTaskPreviewDisplayRange(range, []) }, { ...range });
});

test('visible pre-sow task expands generated task timeline start', async () => {
    const plant = makePlant(hooks);
    const result = hooks.computeScheduleResult(makeInputs(hooks, { plant, startISO: '2026-04-01' }));
    const scheduleRange = hooks.resolveTaskPreviewScheduleRange(result);
    const tasks = await hooks.buildTasksForPlan({
        plant,
        schedule: result.schedule,
        timelines: result.timelines,
        includePreviewMetadata: true,
        taskTemplate: {
            version: 2,
            rules: [{
                id: 'prep',
                title: 'Prep bed',
                startAnchorStage: 'SOW',
                startOffsetDays: 7,
                startOffsetDirection: 'before',
                endMode: 'fixed_days',
                durationDays: 0
            }]
        }
    });
    const displayRange = hooks.resolveTaskPreviewDisplayRange(scheduleRange, tasks);

    assert.equal(tasks[0].startISO, '2026-03-25');
    assert.deepEqual({ ...displayRange }, {
        startISO: '2026-03-25',
        endISO: scheduleRange.endISO
    });
});

test('unchecked pre-sow task does not expand generated task timeline start', async () => {
    const plant = makePlant(hooks);
    const result = hooks.computeScheduleResult(makeInputs(hooks, { plant, startISO: '2026-04-01' }));
    const scheduleRange = hooks.resolveTaskPreviewScheduleRange(result);
    const rules = [
        {
            id: 'prep',
            title: 'Prep bed',
            startAnchorStage: 'SOW',
            startOffsetDays: 7,
            startOffsetDirection: 'before',
            endMode: 'fixed_days',
            durationDays: 0
        },
        {
            id: 'water',
            title: 'Water {plant}',
            startAnchorStage: 'SOW',
            startOffsetDays: 0,
            startOffsetDirection: 'after',
            endMode: 'fixed_days',
            durationDays: 0
        }
    ];
    const tasks = await hooks.buildTasksForPlan({
        plant,
        schedule: result.schedule,
        timelines: result.timelines,
        includePreviewMetadata: true,
        taskTemplate: { version: 2, rules }
    });
    const visibleTasks = hooks.filterPreviewTasks(tasks, new Set(['water::1']));
    const displayRange = hooks.resolveTaskPreviewDisplayRange(scheduleRange, visibleTasks);

    assert.deepEqual(Array.from(visibleTasks, task => task.startISO), ['2026-04-01']);
    assert.deepEqual({ ...displayRange }, { ...scheduleRange });
});

test('visible task after harvest extends generated task timeline end', () => {
    const result = hooks.computeScheduleResult(makeInputs(hooks, { startISO: '2026-04-01' }));
    const scheduleRange = hooks.resolveTaskPreviewScheduleRange(result);
    const displayRange = hooks.resolveTaskPreviewDisplayRange(scheduleRange, [
        { title: 'Late cleanup', startISO: scheduleRange.endISO, endISO: '2026-06-01' },
        { title: 'Invalid task', startISO: 'not-a-date', endISO: 'also-bad' }
    ]);

    assert.deepEqual({ ...displayRange }, {
        startISO: scheduleRange.startISO,
        endISO: '2026-06-01'
    });
});

test('generated task timeline renders blue today marker only inside display range', () => {
    const document = hooks.__testWindow.document;
    const container = document.createElement('div');
    const tasks = [{ title: 'Water', startISO: '2026-04-10', endISO: '2026-04-12', previewRuleKey: 'water::0' }];
    document.body.appendChild(container);

    hooks.renderTaskTimelinePreview(container, {
        tasks,
        scheduleRange: { startISO: '2026-04-01', endISO: '2026-05-01' },
        todayISO: '2026-04-15'
    });

    const todayLabel = container.querySelector('[data-usl-task-timeline-today-label="1"]');
    const todayMarkers = Array.from(container.querySelectorAll('[data-usl-task-timeline-today-marker="1"]'));
    assert.equal(todayLabel.textContent, 'Today');
    assert.equal(todayLabel.style.color, 'rgb(29, 78, 216)');
    assert.ok(todayMarkers.length >= 2);
    assert.ok(todayMarkers.every(marker => marker.style.borderLeft.includes('rgb(37, 99, 235)') || marker.style.borderLeft.includes('#2563eb')));

    hooks.renderTaskTimelinePreview(container, {
        tasks,
        scheduleRange: { startISO: '2026-04-01', endISO: '2026-05-01' },
        todayISO: '2026-08-01'
    });

    assert.equal(container.querySelector('[data-usl-task-timeline-today-label="1"]'), null);
    assert.equal(container.querySelector('[data-usl-task-timeline-today-marker="1"]'), null);
});

test('generated task timeline renders adaptive calendar ticks', () => {
    const document = hooks.__testWindow.document;
    const container = document.createElement('div');
    const tasks = [{ title: 'Water', startISO: '2026-01-10', endISO: '2026-01-12', previewRuleKey: 'water::0' }];
    document.body.appendChild(container);

    hooks.renderTaskTimelinePreview(container, {
        tasks,
        scheduleRange: { startISO: '2026-01-01', endISO: '2026-05-01' },
        todayISO: '2025-12-01'
    });
    assert.deepEqual(Array.from(container.querySelectorAll('[data-usl-task-timeline-month-label="1"]')).map(label => label.textContent), ['Jan', 'Feb', 'Mar', 'Apr', 'May']);

    hooks.renderTaskTimelinePreview(container, {
        tasks,
        scheduleRange: { startISO: '2026-01-01', endISO: '2026-10-01' },
        todayISO: '2025-12-01'
    });
    assert.deepEqual(Array.from(container.querySelectorAll('[data-usl-task-timeline-month-label="1"]')).map(label => label.textContent), ['Jan', 'Apr', 'Jul', 'Oct']);

    hooks.renderTaskTimelinePreview(container, {
        tasks: [{ title: 'Plan', startISO: '2026-12-20', endISO: '2027-01-05', previewRuleKey: 'plan::0' }],
        scheduleRange: { startISO: '2026-11-15', endISO: '2027-02-15' },
        todayISO: '2025-12-01'
    });
    assert.deepEqual(Array.from(container.querySelectorAll('[data-usl-task-timeline-year-label="1"]')).map(label => label.textContent), ['2027']);
});

// CHANGE: yield defaults are independent of timing and layout and are recorded for reopening.
test('growth-stage yield ratio scales resolved variety yield without changing the source plant', () => {
    const plant = makeCrop({ yield_per_plant_kg: 2.5, days_maturity: 100, spacing_cm: 40 });
    const stage = hooks.normalizeGrowthStage({ stage_key: 'baby', stage_label: 'Baby', gdd_ratio: 0.25, yield_ratio: 0.2 });
    const effective = hooks.applyGrowthStageToPlant(plant, stage);
    assert.equal(effective.yield_per_plant_kg, 0.5);
    assert.equal(plant.yield_per_plant_kg, 2.5);
    assert.equal(effective.days_maturity, 25);
    assert.equal(effective.spacing_cm, 20);
    assert.equal(effective.growth_stage_yield_ratio, 0.2);
    assert.equal(hooks.normalizeGrowthStage({ stage_key: 'baby' }).yieldRatio, 1);
    const saved = hooks.readGrowthStageFromCell({ getAttribute: key => ({ growth_stage_key: 'baby', growth_stage_yield_ratio: '0.2' })[key] });
    assert.equal(saved.yieldRatio, 0.2);
}); // CHANGE

// CHANGE: run the additive stage migration and round-trip against SQLite rather than matching SQL strings.
test('existing stage database upgrades yield defaults, saves ratios and blocks inactive custom stages', async t => {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:'); t.after(() => db.close());
    db.exec(`CREATE TABLE Plants (plant_id INTEGER PRIMARY KEY); INSERT INTO Plants VALUES (1);
        CREATE TABLE PlantGrowthStages (stage_id INTEGER PRIMARY KEY, plant_id INTEGER, stage_key TEXT, stage_label TEXT, gdd_ratio REAL, spacing_ratio REAL, plant_diameter_ratio REAL, plant_height_ratio REAL, sort_order INTEGER, active INTEGER, is_default INTEGER, created_at TEXT, updated_at TEXT, UNIQUE(plant_id, stage_key));
        INSERT INTO PlantGrowthStages VALUES (1, 1, 'baby', 'Baby', 0.25, NULL, NULL, NULL, 0, 1, 0, '', '');`);
    const bridge = { resolvePath: async () => ({ dbPath: 'stage-test' }), open: async () => ({ dbId: 'stage-test' }), close: async () => {},
        query: async (id, sql, params = []) => ({ rows: db.prepare(sql).all(...params) }),
        exec: async (id, sql, params = []) => { if (params.length) return db.prepare(sql).run(...params); db.exec(sql); return {}; } };
    const api = loadSchedulerHooks({ dbBridge: bridge });
    const rows = await api.PlantGrowthStageModel.listByPlantId(1);
    assert.equal(rows[0].yieldRatio, 1);
    assert.equal(db.prepare('SELECT yield_ratio FROM PlantGrowthStages').get().yield_ratio, 1);
    let notifications = 0; api.__testWindow.addEventListener('usl:growthStagesSaved', () => notifications++);
    await api.PlantGrowthStageModel.saveForPlant(1, [{ stage_key: 'baby', stage_label: 'Baby', gdd_ratio: 0.25, yield_ratio: 0.2, active: 1 }]);
    assert.equal((await api.resolveGrowthStageForPlanCrop(1, 'baby')).stage.yieldRatio, 0.2);
    assert.equal(notifications, 1);
    db.exec('UPDATE PlantGrowthStages SET active = 0');
    assert.equal((await api.resolveGrowthStageForPlanCrop(1, 'baby')).ok, false);
    assert.equal((await api.resolveGrowthStageForPlanCrop(1, '')).stage.stageKey, 'mature');
    assert.equal((await api.PlantGrowthStageModel.listByPlantId(1, { includeInactive: true })).length, 1);
}); // CHANGE

// CHANGE: exercise the Python seeder's actual Apply output through the scheduler's database resolver.
test('seeded stage yield multiplies the seeded variety override in the scheduler', async t => { // CHANGE
    const { execFileSync } = require('node:child_process'); // CHANGE
    const { DatabaseSync } = require('node:sqlite'); // CHANGE
    const project = path.resolve(__dirname, '..'); // CHANGE
    const artifactRoot = path.join(project, 'test-results'); // CHANGE
    fs.mkdirSync(artifactRoot, { recursive: true }); // CHANGE
    const temporaryDirectory = fs.mkdtempSync(path.join(artifactRoot, 'seed-yield-integration-')); // CHANGE
    let db = null; // CHANGE
    t.after(() => { // CHANGE
        if (db) db.close(); // CHANGE: close SQLite before cleanup, including on assertion failures and Windows.
        assert.ok(path.resolve(temporaryDirectory).startsWith(path.resolve(artifactRoot) + path.sep)); // CHANGE: check the cleanup target stays inside the test artifact directory.
        fs.rmSync(temporaryDirectory, { recursive: true, force: true }); // CHANGE
    }); // CHANGE
    const databasePath = path.join(temporaryDirectory, 'seeded.sqlite'); // CHANGE
    const seedScript = `
import json, shutil, sqlite3, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from trellis_seed.db import apply_run
from trellis_seed.jsonio import write_json
shutil.copy2(sys.argv[2], sys.argv[3])
with sqlite3.connect(sys.argv[3]) as conn:
    plant_id=conn.execute("SELECT plant_id FROM Plants WHERE plant_name='Lettuce'").fetchone()[0]
run_dir=Path(sys.argv[4])
write_json(run_dir/'generated'/'PlantGrowthStages.json', [{'plant_id':plant_id, 'stage_key':'seed_baby', 'stage_label':'Seed Baby', 'gdd_ratio':0.25, 'yield_ratio':0.2}])
write_json(run_dir/'generated'/'PlantVarieties.json', [{'plant_id':plant_id, 'variety_name':'Seed yield integration', 'overrides':{'yield_per_plant_kg':2.5}}])
apply_run(run_dir, Path(sys.argv[3]))
with sqlite3.connect(sys.argv[3]) as conn:
    variety_id=conn.execute("SELECT variety_id FROM PlantVarieties WHERE plant_id=? AND variety_name='Seed yield integration'", [plant_id]).fetchone()[0]
print(json.dumps({'plantId':plant_id, 'varietyId':variety_id}))
`; // CHANGE: only a disposable database copy is seeded; no provider or installed database is involved.
    const identity = JSON.parse(execFileSync('python', ['-c', seedScript, path.join(project, 'scripts'), path.join(project, 'trellis_database', 'Trellis_database.sqlite'), databasePath, path.join(temporaryDirectory, 'run')], { encoding: 'utf8' })); // CHANGE
    db = new DatabaseSync(databasePath); // CHANGE
    const bridge = { resolvePath: async () => ({ dbPath: databasePath }), open: async () => ({ dbId: 'seed-yield-integration' }), close: async () => {}, // CHANGE
        query: async (id, sql, params = []) => ({ rows: db.prepare(sql).all(...params) }), // CHANGE
        exec: async (id, sql, params = []) => { if (params.length) return db.prepare(sql).run(...params); db.exec(sql); return {}; } }; // CHANGE
    const api = loadSchedulerHooks({ dbBridge: bridge }); // CHANGE
    const resolved = await api.resolvePlantForPlanCrop({ ...identity, growthStageKey: 'seed_baby' }); // CHANGE
    assert.equal(resolved.ok, true, resolved.reason); // CHANGE
    assert.equal(resolved.growthStage.yieldRatio, 0.2); // CHANGE
    assert.equal(resolved.plant.yield_per_plant_kg, 0.5); // CHANGE
    assert.equal(db.prepare("SELECT yield_ratio FROM PlantGrowthStages WHERE plant_id=? AND stage_key='seed_baby'").get(identity.plantId).yield_ratio, 0.2); // CHANGE
}); // CHANGE
