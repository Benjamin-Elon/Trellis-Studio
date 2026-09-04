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
    assert.match(schedulerSource, /resolvePlantForPlanCrop,/);
    assert.match(schedulerSource, /resolveCityForModule,/);
    assert.match(schedulerSource, /openDraftScheduleDialog/);
    assert.match(schedulerSource, /renderTaskRows/);
    assert.match(schedulerSource, /Add task/);
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
    assert.equal(patch.companion_offset_x_cm, undefined);
    assert.equal(patch.companion_offset_y_cm, undefined);
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
        buildDraftTilerGroupPreview(activeGraph, groupCell, draft) {
            call = { activeGraph, groupCell, draft };
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
    assert.equal(model.rows[0].groupPreview.label, 'Carrot');
    assert.equal(model.rows[0].groupPreview.rotationDeg, 15);
    assert.equal(model.rows[0].dots.circles[0].label, 'CAR');
    assert.equal(model.rows[0].dots.summarized, true);
    assert.match(model.warning, /Carrot: Preview capped at 1000 of 1002 plants/);
    assert.equal(model.rows[0].groupPreview.lodCollapsed, false);
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
    assert.ok(model.rows[0].dots.circles[0].x < model.rows[0].rect.x);
    assert.ok(model.rows[2].dots.clamped);
    assert.match(model.warning, /Tomato: Clamped inside bed/);
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

    const companionPatch = hooks.plantingLayoutAttributePatch({
        role: 'companion',
        template: 'interplant',
        spacingXCm: 10,
        spacingYCm: 10,
        offsetXCm: 40,
        offsetYCm: 8
    });
    assert.equal(companionPatch.companion_layout_template, undefined);
    assert.equal(companionPatch.companion_offset_x_cm, undefined);
    assert.equal(companionPatch.companion_offset_y_cm, undefined);
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

test('variety options group by manual class, DTM inference, and GDD fallback', () => {
    const groups = hooks.buildGroupedVarietyOptions([
        makeVariety({ variety_id: 1, variety_name: 'Quick', overrides: { days_maturity: 45 } }),
        makeVariety({ variety_id: 2, variety_name: 'Middle', overrides: { days_maturity: 60 } }),
        makeVariety({ variety_id: 3, variety_name: 'Slow', overrides: { days_maturity: 80 } }),
        makeVariety({ variety_id: 4, variety_name: 'Curated Late', maturity_class: 'late', overrides: { days_maturity: 40 } }),
        makeVariety({ variety_id: 5, variety_name: 'Heat Only', overrides: { gdd_to_maturity: 900 } }),
        makeVariety({ variety_id: 6, variety_name: 'Heat Mid', overrides: { gdd_to_maturity: 1200 } }),
        makeVariety({ variety_id: 7, variety_name: 'Heat Late', overrides: { gdd_to_maturity: 1500 } })
    ]);
    assert.deepEqual(Array.from(groups, group => group.label), ['Early varieties', 'Mid varieties', 'Late varieties']);
    assert.deepEqual(Array.from(groups, group => Array.from(group.options, option => option.label)), [
        ['Quick - 45d', 'Heat Only - 900 GDD'],
        ['Middle - 60d', 'Heat Mid - 1200 GDD'],
        ['Curated Late - 40d', 'Slow - 80d', 'Heat Late - 1500 GDD']
    ]);
});

test('variety grouping leaves insufficient inferred data uncategorized but honors manual class', () => {
    const groups = hooks.buildGroupedVarietyOptions([
        makeVariety({ variety_id: 1, variety_name: 'Only One', overrides: { days_maturity: 45 } }),
        makeVariety({ variety_id: 2, variety_name: 'Only Two', overrides: { days_maturity: 55 } }),
        makeVariety({ variety_id: 3, variety_name: 'Manual Early', maturity_class: 'early' })
    ]);
    assert.deepEqual(Array.from(groups, group => group.label), ['Early varieties', 'Uncategorized']);
    assert.deepEqual(Array.from(groups[0].options, option => option.label), ['Manual Early']);
    assert.deepEqual(Array.from(groups[1].options, option => option.label), ['Only One - 45d', 'Only Two - 55d']);
});

test('rendered variety dropdown keeps base plant first and omits empty optgroups', () => {
    const document = hooks.__testWindow.document;
    const select = document.createElement('select');
    const groups = hooks.buildGroupedVarietyOptions([
        makeVariety({ variety_id: 1, variety_name: 'Alpha', maturity_class: 'early' })
    ]);
    hooks.renderGroupedVarietyOptions(select, groups, '1');
    assert.equal(select.options[0].textContent, '(base plant)');
    assert.deepEqual(Array.from(select.querySelectorAll('optgroup'), group => group.label), ['Selection', 'Early varieties']);
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
            { message: 'Selected sow date yield multiplier 0.49 is below the minimum 0.50.' },
            { message: 'There is not enough growing-degree accumulation to reach maturity.' },
            { message: '   ' },
            { type: 'missing_message' }
        ]
    });

    assert.equal(viewState.feasibility.status, 'warning');
    assert.deepEqual(Array.from(viewState.feasibility.warningMessages), [
        'There is not enough growing-degree accumulation to reach maturity.',
        'Selected sow date yield multiplier 0.49 is below the minimum 0.50.'
    ]);
});

test('schedule summary renders warnings as bullet list in double-wide feasibility item', () => {
    const summaryView = hooks.renderScheduleSummary();
    const viewState = makeSummaryViewState({
        scheduleWarnings: [
            { message: 'There is not enough growing-degree accumulation to reach maturity.' },
            { message: 'Selected sow date yield multiplier 0.49 is below the minimum 0.50.' }
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
    assert.match(schedulerSource, /inputsSection\.body\.appendChild\(firstSowRowObj\.row\);\s*inputsSection\.body\.appendChild\(transplantDaysRowObj\.row\);/);
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

test('latest harvest timeline marker reuses today boundary styling', () => {
    assert.match(schedulerSource, /function appendVerticalTimelineBoundary\(\{ percent, label, tooltip, dataAttr \}\)/);
    assert.match(schedulerSource, /label: 'Today'[\s\S]*tooltip: `Today: \$\{model\.todayISO\}`[\s\S]*dataAttr: 'data-usl-today-marker'/);
    assert.match(schedulerSource, /label: model\.latestHarvestBoundary\.label[\s\S]*tooltip: model\.latestHarvestBoundary\.tooltip[\s\S]*dataAttr: 'data-usl-latest-harvest-marker'/);
    assert.match(schedulerSource, /boundary\.style\.borderLeft = '1px dashed #64748b';/);
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
