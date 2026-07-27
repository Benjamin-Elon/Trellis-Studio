const assert = require('node:assert/strict');
const fs = require('node:fs'); // ADDED
const path = require('node:path'); // ADDED
const test = require('node:test');

const {
    loadSchedulerHooks,
    makeCity, // ADDED
    makeInputs,
    makePlant
} = require('./helpers/garden-scheduler-harness.cjs');

const hooks = loadSchedulerHooks();
const schedulerSource = fs.readFileSync(path.join(__dirname, '..', 'drawio', 'src', 'main', 'webapp', 'plugins', 'garden_planner_plugins', 'Garden_Scheduler_Dialog.js'), 'utf8'); // ADDED

function makeCrop(overrides = {}) { // ADDED
    return makePlant(hooks, { // ADDED
        plant_id: overrides.plant_id ?? 1, // ADDED
        plant_name: overrides.plant_name || 'Crop', // ADDED
        abbr: overrides.abbr || '', // ADDED
        ...overrides // ADDED
    }); // ADDED
} // ADDED

test('crop lifecycle classification requires exactly one lifecycle flag', () => { // ADDED
    assert.equal(hooks.getCropLifecycle(makeCrop({ annual: 1, biennial: 0, perennial: 0 })), 'annual'); // ADDED
    assert.equal(hooks.getCropLifecycle(makeCrop({ annual: 0, biennial: 1, perennial: 0 })), 'biennial'); // ADDED
    assert.equal(hooks.getCropLifecycle(makeCrop({ annual: 0, biennial: 0, perennial: 1 })), 'perennial'); // ADDED
    assert.equal(hooks.getCropLifecycle(makeCrop({ annual: 1, biennial: 1, perennial: 0 })), 'uncategorized'); // ADDED
    assert.equal(hooks.getCropLifecycle(makeCrop({ annual: 0, biennial: 0, perennial: 0 })), 'uncategorized'); // ADDED
}); // ADDED

test('lifecycle filter control reads and persists the shared crop filter preference', () => { // ADDED
    const store = new Map([['trellis.scheduler.cropLifecycleFilter', 'perennial']]); // ADDED
    hooks.__testWindow.localStorage = { // ADDED
        getItem: key => store.has(key) ? store.get(key) : null, // ADDED
        setItem: (key, value) => { store.set(key, value); } // ADDED
    }; // ADDED
    const control = hooks.buildLifecycleFilterControl(); // ADDED
    assert.equal(control.value, 'perennial'); // ADDED
    control.value = 'annual'; // ADDED
    control.dispatchEvent(new hooks.__testWindow.document.defaultView.Event('change')); // ADDED
    assert.equal(store.get('trellis.scheduler.cropLifecycleFilter'), 'annual'); // ADDED
}); // ADDED

test('grouped crop options filter by lifecycle and auto-show hidden current selection', () => { // ADDED
    const crops = [ // ADDED
        makeCrop({ plant_id: 1, plant_name: 'Tomato', annual: 1, biennial: 0, perennial: 0 }), // ADDED
        makeCrop({ plant_id: 2, plant_name: 'Rhubarb', annual: 0, biennial: 0, perennial: 1 }) // ADDED
    ]; // ADDED
    const groups = hooks.buildGroupedCropOptions(hooks.makeCropPickerOptions(crops), { // ADDED
        filter: 'perennial', // ADDED
        selectedValue: '1', // ADDED
        includeSelectedWhenFiltered: true // ADDED
    }); // ADDED
    assert.deepEqual(Array.from(groups, group => group.label), ['Current selection', 'Perennial crops']); // ADDED
    assert.deepEqual(Array.from(groups, group => Array.from(group.options, option => option.label)), [['Tomato'], ['Rhubarb']]); // ADDED
}); // ADDED

test('empty lifecycle filter renders an explicit disabled placeholder', () => { // ADDED
    const document = hooks.__testWindow.document; // ADDED
    const select = document.createElement('select'); // ADDED
    hooks.renderGroupedCropOptions(select, [], ''); // ADDED
    assert.equal(select.options.length, 1); // ADDED
    assert.equal(select.options[0].textContent, 'No crops match this filter'); // ADDED
    assert.equal(select.options[0].disabled, true); // ADDED
}); // ADDED

test('sowing-window scoring ranks inside windows before nearest outside windows', () => { // ADDED
    const windows = [ // ADDED
        { id: 'spring', label: 'Spring', startISO: '2026-03-01', endISO: '2026-05-31' }, // ADDED
        { id: 'fall', label: 'Fall', startISO: '2026-08-15', endISO: '2026-09-15' } // ADDED
    ]; // ADDED
    const inside = hooks.scoreSowingWindowsForDate(windows, '2026-04-01'); // ADDED
    const before = hooks.scoreSowingWindowsForDate(windows, '2026-08-01'); // ADDED
    const after = hooks.scoreSowingWindowsForDate(windows, '2026-09-29'); // ADDED
    assert.equal(inside.rankClass, 0); // ADDED
    assert.equal(inside.hint, '66% window left'); // ADDED
    assert.equal(before.rankClass, 1); // ADDED
    assert.equal(before.hint, 'Starts in 14d'); // CHANGED
    assert.equal(after.rankClass, 1); // ADDED
    assert.equal(after.hint, '14d late'); // ADDED
}); // ADDED

test('crop option sorting prefers suitability then name within lifecycle groups', () => { // ADDED
    const crops = [ // ADDED
        makeCrop({ plant_id: 1, plant_name: 'Late Crop', annual: 1, biennial: 0, perennial: 0 }), // ADDED
        makeCrop({ plant_id: 2, plant_name: 'Best Crop', annual: 1, biennial: 0, perennial: 0 }), // ADDED
        makeCrop({ plant_id: 3, plant_name: 'Near Crop', annual: 1, biennial: 0, perennial: 0 }) // ADDED
    ]; // ADDED
    const scores = new Map([ // ADDED
        ['1', { rankClass: 0, percentRemaining: 25, distanceDays: 0, hint: '25% window left' }], // ADDED
        ['2', { rankClass: 0, percentRemaining: 80, distanceDays: 0, hint: '80% window left' }], // ADDED
        ['3', { rankClass: 1, percentRemaining: -1, distanceDays: 2, hint: 'Starts in 2d' }] // CHANGED
    ]); // ADDED
    const groups = hooks.buildGroupedCropOptions(hooks.makeCropPickerOptions(crops, scores), { filter: 'annual' }); // ADDED
    assert.deepEqual(Array.from(groups[0].options, option => option.label), ['Best Crop', 'Late Crop', 'Near Crop']); // ADDED
    assert.equal(groups[0].options[0].displayLabel, 'Best Crop - 80% window left'); // ADDED
}); // ADDED

test('companion metadata annotates crop options without changing suitability order', () => { // ADDED
    const crops = [ // ADDED
        makeCrop({ plant_id: 1, plant_name: 'Late Crop', annual: 1, biennial: 0, perennial: 0 }), // ADDED
        makeCrop({ plant_id: 2, plant_name: 'Best Crop', annual: 1, biennial: 0, perennial: 0 }) // ADDED
    ]; // ADDED
    const scores = new Map([ // ADDED
        ['1', { rankClass: 0, percentRemaining: 25, distanceDays: 0, hint: '25% window left' }], // ADDED
        ['2', { rankClass: 0, percentRemaining: 80, distanceDays: 0, hint: '80% window left' }] // ADDED
    ]); // ADDED
    const metadata = new Map([ // ADDED
        ['1', { known: true, rating: 1, companionType: 'interplant', recommendedStartOffsetDays: 7 }], // ADDED
        ['2', { known: false, recommendedStartOffsetDays: 0 }] // ADDED
    ]); // ADDED
    const groups = hooks.buildGroupedCropOptions(hooks.makeCropPickerOptions(crops, scores, metadata), { filter: 'annual' }); // ADDED
    assert.deepEqual(Array.from(groups[0].options, option => option.label), ['Best Crop', 'Late Crop']); // ADDED
    assert.equal(groups[0].options[1].displayLabel, 'Late Crop - 25% window left - beneficial, interplant, +7d'); // ADDED
}); // ADDED

test('scheduler crop combobox syncs selection and renders companion badges', () => { // ADDED
    const document = hooks.__testWindow.document; // ADDED
    document.querySelectorAll('.usl-crop-combobox-panel').forEach(panel => panel.remove()); // ADDED
    const select = document.createElement('select'); // ADDED
    document.body.appendChild(select); // ADDED
    const combo = hooks.createSchedulerCropCombobox(select); // ADDED
    const groups = [{ // ADDED
        label: 'Annual crops', // ADDED
        options: [{ // ADDED
            value: '7', // ADDED
            label: 'Basil', // ADDED
            displayLabel: 'Basil - 85% window left - beneficial, interplant, +7d', // CHANGED
            metadata: { known: true, rating: 1, companionType: 'interplant', recommendedStartOffsetDays: 7 } // ADDED
        }] // ADDED
    }]; // ADDED
    hooks.renderGroupedCropOptions(select, groups, ''); // ADDED
    combo.refresh(groups, ''); // ADDED
    combo.root.querySelector('button').click(); // ADDED
    const panel = document.body.querySelector('.usl-crop-combobox-panel'); // ADDED
    assert.ok(panel); // ADDED
    assert.notEqual(panel.parentNode, combo.root); // ADDED
    const option = panel.querySelector('[role="option"]'); // CHANGED
    assert.match(option.textContent, /Basil/); // ADDED
    assert.match(option.textContent, /85% window left/); // ADDED
    assert.match(option.textContent, /beneficial/); // ADDED
    option.click(); // ADDED
    assert.equal(select.value, '7'); // ADDED
}); // ADDED

test('scheduler crop combobox floats outside clipped containers and clamps to viewport', () => { // ADDED
    const document = hooks.__testWindow.document; // ADDED
    document.querySelectorAll('.usl-crop-combobox-panel').forEach(panel => panel.remove()); // ADDED
    const section = document.createElement('div'); // ADDED
    section.className = 'usl-scheduler-section'; // ADDED
    section.style.overflow = 'hidden'; // ADDED
    const select = document.createElement('select'); // ADDED
    section.appendChild(select); // ADDED
    document.body.appendChild(section); // ADDED
    const combo = hooks.createSchedulerCropCombobox(select); // ADDED
    section.appendChild(combo.root); // ADDED
    hooks.renderGroupedCropOptions(select, [{ label: 'Annual crops', options: [{ value: '1', label: 'Beet' }] }], ''); // ADDED
    combo.refresh([{ label: 'Annual crops', options: [{ value: '1', label: 'Beet' }] }], ''); // ADDED
    const button = combo.root.querySelector('button'); // ADDED
    button.getBoundingClientRect = () => ({ left: 100, top: 100, right: 420, bottom: 132, width: 320, height: 32 }); // ADDED
    button.click(); // ADDED
    const panel = document.body.querySelector('.usl-crop-combobox-panel'); // ADDED
    assert.ok(panel); // ADDED
    assert.equal(panel.parentNode, document.body); // ADDED
    assert.equal(panel.style.position, 'fixed'); // ADDED
    assert.equal(panel.style.left, '100px'); // ADDED
    assert.equal(panel.style.top, '136px'); // ADDED
    assert.equal(panel.style.width, '320px'); // ADDED
    assert.ok(Number.parseInt(panel.style.maxHeight, 10) <= 260); // ADDED
}); // ADDED

test('scheduler crop combobox closes on outside click and Escape', () => { // ADDED
    const document = hooks.__testWindow.document; // ADDED
    const EventWindow = document.defaultView; // CHANGED
    document.querySelectorAll('.usl-crop-combobox-panel').forEach(panel => panel.remove()); // ADDED
    const select = document.createElement('select'); // ADDED
    const combo = hooks.createSchedulerCropCombobox(select); // ADDED
    hooks.renderGroupedCropOptions(select, [{ label: 'Annual crops', options: [{ value: '1', label: 'Beet' }] }], ''); // ADDED
    combo.refresh([{ label: 'Annual crops', options: [{ value: '1', label: 'Beet' }] }], ''); // ADDED
    combo.root.querySelector('button').click(); // ADDED
    assert.ok(document.body.querySelector('.usl-crop-combobox-panel')); // ADDED
    document.dispatchEvent(new EventWindow.Event('mousedown', { bubbles: true })); // CHANGED
    assert.equal(document.body.querySelector('.usl-crop-combobox-panel'), null); // ADDED
    combo.root.querySelector('button').click(); // ADDED
    const input = document.body.querySelector('.usl-crop-combobox-panel input'); // ADDED
    const escapeEvent = new EventWindow.Event('keydown', { bubbles: true }); // ADDED
    Object.defineProperty(escapeEvent, 'key', { value: 'Escape' }); // ADDED
    input.dispatchEvent(escapeEvent); // CHANGED
    assert.equal(document.body.querySelector('.usl-crop-combobox-panel'), null); // ADDED
}); // ADDED

test('scheduler crop combobox closes when the owning dialog is removed', async () => { // ADDED
    const document = hooks.__testWindow.document; // ADDED
    document.querySelectorAll('.usl-crop-combobox-panel').forEach(panel => panel.remove()); // ADDED
    const dialog = document.createElement('div'); // ADDED
    dialog.className = 'usl-scheduler-dialog'; // ADDED
    const select = document.createElement('select'); // ADDED
    const combo = hooks.createSchedulerCropCombobox(select); // ADDED
    dialog.appendChild(combo.root); // ADDED
    document.body.appendChild(dialog); // ADDED
    const groups = [{ label: 'Annual crops', options: [{ value: '1', label: 'Beet' }] }]; // ADDED
    hooks.renderGroupedCropOptions(select, groups, ''); // ADDED
    combo.refresh(groups, ''); // ADDED
    combo.root.querySelector('button').click(); // ADDED
    assert.ok(document.body.querySelector('.usl-crop-combobox-panel')); // ADDED
    dialog.remove(); // ADDED
    await new Promise(resolve => setTimeout(resolve, 0)); // ADDED
    assert.equal(document.body.querySelector('.usl-crop-combobox-panel'), null); // ADDED
}); // ADDED

test('crop picker row uses custom layout without section overflow workaround', () => { // ADDED
    assert.match(schedulerSource, /plantControlsWrap\.className = 'usl-scheduler-crop-picker-controls'/); // ADDED
    assert.match(schedulerSource, /plantSelectRow\.row\.classList\.add\('usl-scheduler-row--crop-picker'\)/); // ADDED
    assert.match(schedulerSource, /varietyRow\.row\.classList\.add\('usl-scheduler-row--crop-variety'\)/); // ADDED
    assert.match(schedulerSource, /\.usl-scheduler-row-label\{flex:0 0 180px;/); // ADDED
    assert.match(schedulerSource, /\.usl-scheduler-row--crop-picker\{display:grid!important;grid-template-columns:50px minmax\(120px,140px\) minmax\(0,1fr\) auto auto!important/); // CHANGED
    assert.match(schedulerSource, /\.usl-scheduler-row--crop-variety > \.usl-scheduler-row-label\{flex:0 0 50px!important\}/); // CHANGED
    assert.match(schedulerSource, /\.usl-scheduler-crop-combobox-wrap\{grid-column:3;min-width:0!important;width:100%!important\}/); // CHANGED
    assert.match(schedulerSource, /\.usl-crop-combobox-button\{min-height:32px;min-width:0!important;overflow:hidden;/); // ADDED
    assert.match(schedulerSource, /\.usl-scheduler-crop-action\{width:auto!important;min-width:36px!important;flex:0 0 auto!important;white-space:nowrap!important;justify-self:end!important\}/); // CHANGED
    assert.match(schedulerSource, /\.usl-scheduler-row--crop-variety > :not\(label\)\{min-width:0!important\}/); // ADDED
    assert.match(schedulerSource, /@media \(max-width:900px\)\{\.usl-scheduler-row--crop-picker\{grid-template-columns:50px minmax\(120px,1fr\) auto auto!important\}[\s\S]*\.usl-scheduler-crop-action\{grid-row:3\}/); // ADDED
    assert.doesNotMatch(schedulerSource, /\.usl-scheduler-crop-combobox-wrap\{grid-column:3;min-width:280px/); // ADDED
    assert.match(schedulerSource, /\.usl-scheduler-section\{[^}]*overflow:hidden/); // ADDED
    assert.doesNotMatch(schedulerSource, /plantSection\.wrap\.classList\.add\('usl-scheduler-section--allow-popover'\)/); // ADDED
}); // ADDED

test('derived dialogs do not persist resolved city onto the source while opening', () => { // ADDED
    assert.match(schedulerSource, /if \(!openOptions\?\.derivedMode && model && cell && cityInit\.city_id != null\) \{/); // ADDED
    assert.match(schedulerSource, /city_id: city\.city_id != null \? String\(city\.city_id\) : '',/); // CHANGED
}); // ADDED

test('derived save creates sibling after validation and rolls it back on save failure', () => { // ADDED
    assert.match(schedulerSource, /const scheduleResult = computeScheduleResult\(inputs\);[\s\S]*if \(derivedContext\.operation === 'create'\) \{[\s\S]*createdDerivedCell = createSibling\(graph, relationshipSourceCell/); // CHANGED
    assert.match(schedulerSource, /let targetCell = cell;[\s\S]*targetCell = createdDerivedCell;/); // ADDED
    assert.match(schedulerSource, /await applyScheduleToGraph\(ui, targetCell, inputs,[\s\S]*targetAttributePatch: derivedRelationshipPatch[\s\S]*preserveTargetGeometry: !!derivedContext/); // ADDED
    assert.match(schedulerSource, /catch \(saveError\) \{[\s\S]*if \(createdDerivedCell\) removeDerivedSiblingIfPresent\(ui\?\.editor\?\.graph, createdDerivedCell\);[\s\S]*throw saveError/); // ADDED
    assert.match(schedulerSource, /targetGroupId: cell\.id/); // ADDED
}); // ADDED

test('existing derived companion opens companion edit context without forcing sibling creation', () => { // ADDED
    assert.match(schedulerSource, /async function resolveExistingDerivedScheduleContext\(cell, selectedPlant, allPlants, context = \{\}\)/); // ADDED
    assert.match(schedulerSource, /if \(mode !== 'companion'\) return null;/); // ADDED
    assert.match(schedulerSource, /const sourceCell = model\.getCell\(sourceId\);[\s\S]*if \(!sourceCell \|\| !isTilerGroup\(sourceCell\)\) return null;/); // ADDED
    assert.match(schedulerSource, /derived\.operation = 'edit';/); // ADDED
    assert.match(schedulerSource, /derived\.defaultPrimaryStartISO = '';/); // ADDED
    assert.match(schedulerSource, /else \{[\s\S]*derivedContext = await resolveExistingDerivedScheduleContext\(cell, selectedPlant, plants/); // ADDED
    assert.match(schedulerSource, /if \(derivedContext\) dialogPlants = derivedContext\.candidatePlants;/); // ADDED
}); // ADDED

test('companion timing help shows recommended and current actual offsets', () => { // ADDED
    assert.match(schedulerSource, /Recommended offset: [\s\S]*current actual offset:/); // ADDED
    assert.match(schedulerSource, /updateCompanionTimingHelp\(\);[\s\S]*syncStateFromControls\(\);/); // ADDED
    assert.match(schedulerSource, /const scheduleGapHint = document\.createElement\('span'\)/); // ADDED
    assert.match(schedulerSource, /firstSowRowObj\.row\.appendChild\(scheduleGapHint\)/); // ADDED
    assert.match(schedulerSource, /updateScheduleGapHint\(\);/); // ADDED
    assert.match(schedulerSource, /setTooltip\(startInput, \[scheduleGapTooltipText, companionTimingTooltipText\]/); // ADDED
}); // ADDED

test('derived schedule helpers snapshot actual and recommended companion timing separately', () => { // ADDED
    const sourceCell = { // ADDED
        id: 'source-1', // ADDED
        getAttribute: key => ({ plant_id: '11', sow_date: '2026-04-01', harvest_end: '2026-08-01' }[key] || '') // ADDED
    }; // ADDED
    const sourcePlant = makeCrop({ plant_id: 11, annual: 1, biennial: 0, perennial: 0 }); // ADDED
    const targetPlant = makeCrop({ plant_id: 22, annual: 1, biennial: 0, perennial: 0 }); // ADDED
    const result = { timelines: [{ sow: new Date('2026-04-15T00:00:00Z'), harvestEnd: new Date('2026-07-01T00:00:00Z') }] }; // ADDED
    const context = { // ADDED
        mode: 'companion', // ADDED
        sourcePlant, // ADDED
        sourceOccupancy: hooks.sourceOccupancyWindowForDerived(sourceCell, sourcePlant), // ADDED
        relationshipByPlantId: new Map([['22', { relationId: 9, rating: 1, companionType: 'interplant', recommendedStartOffsetDays: 7 }]]) // ADDED
    }; // ADDED
    const patch = hooks.buildDerivedRelationshipPatch(sourceCell, targetPlant, result, context); // ADDED
    assert.equal(patch.derived_mode, 'companion'); // ADDED
    assert.equal(patch.derived_source_group_id, 'source-1'); // ADDED
    assert.equal(patch.derived_source_plant_id, '11'); // ADDED
    assert.equal(patch.derived_target_plant_id, '22'); // ADDED
    assert.equal(patch.companion_start_offset_days, '14'); // ADDED
    assert.equal(patch.companion_recommended_start_offset_days, '7'); // ADDED
}); // ADDED

test('derived companion layout patch materializes template spacing and offsets', () => { // ADDED
    const sourceCell = { // ADDED
        id: 'source-layout', // ADDED
        getGeometry: () => ({ x: 10, y: 20, width: 120, height: 80 }), // ADDED
        getAttribute: key => ({ plant_id: '11', sow_date: '2026-04-01', harvest_end: '2026-08-01', spacing_x_cm: '40', spacing_y_cm: '50' }[key] || '') // ADDED
    }; // ADDED
    const targetPlant = makeCrop({ plant_id: 22, spacing_cm: 30, spacing_x_cm: 25, spacing_y_cm: 35, veg_diameter_cm: 18 }); // ADDED
    const relationship = { relationId: 9, rating: 1, companionType: 'interplant', recommendedStartOffsetDays: 7, layoutTemplate: 'staggered', layoutSpacingXCm: 20, layoutSpacingYCm: 22, layoutOffsetXCm: 12, layoutOffsetYCm: -6 }; // ADDED
    const result = { timelines: [{ sow: new Date('2026-04-15T00:00:00Z'), harvestEnd: new Date('2026-07-01T00:00:00Z') }] }; // ADDED
    const patch = hooks.buildDerivedRelationshipPatch(sourceCell, targetPlant, result, { // ADDED
        mode: 'companion', // ADDED
        sourceOccupancy: hooks.sourceOccupancyWindowForDerived(sourceCell, makeCrop({ plant_id: 11 })), // ADDED
        relationshipByPlantId: new Map([['22', relationship]]) // ADDED
    }); // ADDED
    assert.equal(patch.companion_layout_template, 'staggered'); // ADDED
    assert.equal(patch.spacing_x_cm, '20'); // ADDED
    assert.equal(patch.spacing_y_cm, '22'); // ADDED
    assert.equal(patch.companion_offset_x_cm, '12'); // ADDED
    assert.equal(patch.companion_offset_y_cm, '-6'); // ADDED
    assert.equal(patch.veg_diameter_cm, '18'); // ADDED
}); // ADDED

test('layout preview model renders no-bed and clamps companion placement', () => { // ADDED
    const noBed = hooks.buildLayoutPreviewModel({ requireRealBed: true }); // ADDED
    assert.equal(noBed.status, 'no-bed'); // ADDED
    const model = hooks.buildLayoutPreviewModel({ // ADDED
        bedRect: { x: 0, y: 0, width: 100, height: 60 }, // ADDED
        sourceRect: { x: 70, y: 20, width: 40, height: 30 }, // ADDED
        sourceSpacing: { spacingXCm: 10, spacingYCm: 10 }, // ADDED
        layout: { spacingXCm: 10, spacingYCm: 10, offsetXCm: 80, offsetYCm: 0 }, // ADDED
        showCompanion: true // ADDED
    }); // ADDED
    assert.equal(model.status, 'ok'); // ADDED
    assert.equal(model.clamped, true); // ADDED
    assert.ok(model.companion.x <= 60); // ADDED
    const dense = hooks.computePreviewPlantCircles({ x: 0, y: 0, width: 400, height: 400 }, 1, 1, { maxCircles: 12 }); // ADDED
    assert.equal(dense.circles.length, 12); // ADDED
    assert.equal(dense.summarized, true); // ADDED
}); // ADDED

test('active companion layout templates compute distinct placements', () => { // ADDED
    const anchor = { x: 10, y: 20, width: 100, height: 80 }; // ADDED
    const companion = { x: 10, y: 20, width: 60, height: 40 }; // ADDED
    const bed = { x: 0, y: 0, width: 260, height: 160 }; // ADDED
    const anchorSpacing = { spacingXCm: 40, spacingYCm: 30 }; // ADDED
    const beside = hooks.computeActiveCompanionPlacement(anchor, companion, bed, { template: 'beside', spacingXCm: 20, offsetXCm: 0, offsetYCm: 0 }, anchorSpacing); // ADDED
    const staggered = hooks.computeActiveCompanionPlacement(anchor, companion, bed, { template: 'staggered', offsetXCm: 0, offsetYCm: 0 }, anchorSpacing); // ADDED
    const interplant = hooks.computeActiveCompanionPlacement(anchor, companion, bed, { template: 'interplant', offsetXCm: 0, offsetYCm: 0 }, anchorSpacing); // ADDED
    assert.notDeepEqual({ x: beside.x, y: beside.y }, { x: staggered.x, y: staggered.y }); // ADDED
    assert.notDeepEqual({ x: beside.x, y: beside.y }, { x: interplant.x, y: interplant.y }); // ADDED
    assert.equal(interplant.width, anchor.width); // ADDED
    assert.equal(interplant.height, anchor.height); // ADDED
    assert.equal(interplant.interplant, true); // ADDED
}); // ADDED

test('multi-companion preview model renders anchor and all companions with warnings', () => { // ADDED
    const model = hooks.buildCompanionLayoutPreviewModel({ // ADDED
        bedRect: { x: 0, y: 0, width: 180, height: 120 }, // ADDED
        anchorRow: { plantId: 1, label: 'Carrot', rect: { x: 20, y: 20, width: 80, height: 50 }, spacingXCm: 20, spacingYCm: 20 }, // ADDED
        companionRows: [ // ADDED
            { plantId: 2, label: 'Lettuce', rect: { x: 0, y: 0, width: 40, height: 40 }, template: 'staggered', spacingXCm: 18, spacingYCm: 18, offsetXCm: 0, offsetYCm: 0 }, // ADDED
            { plantId: 3, label: 'Tomato', rect: { x: 0, y: 0, width: 80, height: 80 }, template: 'beside', spacingXCm: 30, spacingYCm: 30, offsetXCm: 120, offsetYCm: 0 } // ADDED
        ], // ADDED
        requireRealBed: true // ADDED
    }); // ADDED
    assert.equal(model.status, 'ok'); // ADDED
    assert.equal(model.rows.length, 3); // ADDED
    assert.equal(model.rows[0].role, 'anchor'); // ADDED
    assert.match(model.warning, /Tomato: Clamped inside bed/); // ADDED
}); // ADDED

test('saved plant-set defaults select their saved anchor when opened from another set member', () => { // ADDED
    const selected = { id: 'lettuce', getAttribute: key => key === 'plant_id' ? '2' : '' }; // ADDED
    const savedAnchor = { id: 'carrot', getAttribute: key => key === 'plant_id' ? '1' : '' }; // ADDED
    const tomato = { id: 'tomato', getAttribute: key => key === 'plant_id' ? '3' : '' }; // ADDED
    const anchor = hooks.selectCompanionLayoutAnchorFromSet([selected, savedAnchor, tomato], { anchorPlantId: 1 }, selected); // ADDED
    assert.equal(anchor.id, 'carrot'); // ADDED
    const fallback = hooks.selectCompanionLayoutAnchorFromSet([selected, tomato], { anchorPlantId: 9 }, selected); // ADDED
    assert.equal(fallback.id, 'lettuce'); // ADDED
}); // ADDED

test('interplant preview offsets alternating row and column parity like the tiler', () => { // ADDED
    const model = hooks.buildCompanionLayoutPreviewModel({ // ADDED
        bedRect: { x: 0, y: 0, width: 160, height: 120 }, // ADDED
        anchorRow: { plantId: 1, label: 'Carrot', rect: { x: 0, y: 0, width: 100, height: 100 }, spacingXCm: 20, spacingYCm: 20 }, // ADDED
        companionRows: [{ plantId: 2, label: 'Lettuce', rect: { x: 0, y: 0, width: 100, height: 100 }, template: 'interplant', spacingXCm: 20, spacingYCm: 20, offsetXCm: 0, offsetYCm: 0 }], // ADDED
        requireRealBed: true // ADDED
    }); // ADDED
    const companionDots = model.rows.find(row => row.role === 'companion').dots.circles; // ADDED
    const row0col0 = companionDots.find(dot => dot.row === 0 && dot.col === 0); // ADDED
    const row0col1 = companionDots.find(dot => dot.row === 0 && dot.col === 1); // ADDED
    const row1col0 = companionDots.find(dot => dot.row === 1 && dot.col === 0); // ADDED
    assert.equal(row0col0.x, 18); // ADDED
    assert.equal(row0col0.y, 18); // ADDED
    assert.equal(row0col1.x, 27); // ADDED
    assert.equal(row0col1.y, 9); // ADDED
    assert.equal(row1col0.x, 9); // ADDED
    assert.equal(row1col0.y, 27); // ADDED
}); // ADDED

test('graph-created companion pairs get an in-memory relationship before DB default save', () => { // ADDED
    const sourcePlant = makeCrop({ plant_id: 11, plant_name: 'Tomato' }); // ADDED
    const companionPlant = makeCrop({ plant_id: 22, plant_name: 'Basil' }); // ADDED
    const relationship = hooks.buildGraphCreatedCompanionRelationship(sourcePlant, companionPlant, { startOffsetDays: -3, layoutTemplate: 'staggered', layoutOffsetXCm: 12 }); // ADDED
    assert.equal(relationship.relationId, ''); // ADDED
    assert.equal(relationship.sourcePlantId, '11'); // ADDED
    assert.equal(relationship.companionPlantId, '22'); // ADDED
    assert.equal(relationship.p1, 'Tomato'); // ADDED
    assert.equal(relationship.p2, 'Basil'); // ADDED
    assert.equal(relationship.recommendedStartOffsetDays, -3); // ADDED
    assert.equal(relationship.layoutTemplate, 'staggered'); // ADDED
    assert.equal(relationship.layoutOffsetXCm, 12); // ADDED
    assert.equal(relationship.graphCreated, true); // ADDED
}); // ADDED

test('derived schedule helpers gate companion lifecycle and compute turnover gaps', () => { // ADDED
    const annual = makeCrop({ plant_id: 1, annual: 1, biennial: 0, perennial: 0 }); // ADDED
    const perennial = makeCrop({ plant_id: 2, annual: 0, biennial: 0, perennial: 1, lifespan_years: 3 }); // ADDED
    assert.equal(hooks.lifecycleEligibleForDerivedCompanion(annual, perennial), false); // ADDED
    assert.equal(hooks.lifecycleEligibleForDerivedCompanion(perennial, annual), true); // ADDED
    const sourceCell = { id: 'source-2', getAttribute: key => ({ plant_id: '1', sow_date: '2026-04-01', harvest_end: '2026-09-15' }[key] || '') }; // ADDED
    const result = { timelines: [{ sow: new Date('2026-09-16T00:00:00Z'), harvestEnd: new Date('2026-10-30T00:00:00Z') }] }; // ADDED
    const patch = hooks.buildDerivedRelationshipPatch(sourceCell, annual, result, { mode: 'turnover', sourcePlant: annual, sourceOccupancy: hooks.sourceOccupancyWindowForDerived(sourceCell, annual) }); // ADDED
    assert.equal(patch.turnover_gap_days, '1'); // ADDED
}); // ADDED

test('scheduler adjacent gap hints render before and after gaps', () => { // ADDED
    const hints = hooks.computeSchedulerAdjacentGapHints([ // ADDED
        { cellId: 'prev', label: 'Lettuce', startISO: '2026-04-01', endISO: '2026-05-01' }, // ADDED
        { cellId: 'current', label: 'Beet', startISO: '2026-05-05', endISO: '2026-06-01' }, // ADDED
        { cellId: 'next', label: 'Carrot', startISO: '2026-06-13', endISO: '2026-07-01' } // ADDED
    ], { startISO: '2026-05-05', endISO: '2026-06-01' }, { excludeCellIds: ['current'], basisLabel: 'current planting' }); // ADDED
    assert.equal(hints.text, 'Before: 4d gap; After: 12d gap'); // ADDED
    assert.match(hints.tooltip, /Before: 4d gap from Lettuce/); // ADDED
    assert.match(hints.tooltip, /After: 12d gap from Carrot/); // ADDED
}); // ADDED

test('scheduler adjacent gap hints label overlaps instead of gaps', () => { // ADDED
    const hints = hooks.computeSchedulerAdjacentGapHints([ // ADDED
        { cellId: 'prev', label: 'Lettuce', startISO: '2026-04-01', endISO: '2026-05-08' }, // ADDED
        { cellId: 'next', label: 'Carrot', startISO: '2026-05-28', endISO: '2026-07-01' } // ADDED
    ], { startISO: '2026-05-05', endISO: '2026-06-01' }, {}); // ADDED
    assert.equal(hints.text, 'Before: overlaps 3d; After: overlaps 4d'); // ADDED
}); // ADDED

test('scheduler adjacent gap hints support companion pair and turnover bases', () => { // ADDED
    const source = { startISO: '2026-05-10', endISO: '2026-07-01' }; // ADDED
    const companion = { startISO: '2026-05-01', endISO: '2026-06-15' }; // ADDED
    const pairWindow = { // ADDED
        startISO: hooks.shiftISODate(source.startISO, -9), // ADDED
        endISO: source.endISO // ADDED
    }; // ADDED
    const companionHints = hooks.computeSchedulerAdjacentGapHints([ // ADDED
        { cellId: 'source', label: 'Source lettuce', startISO: source.startISO, endISO: source.endISO }, // ADDED
        { cellId: 'prev', label: 'Potato', startISO: '2026-03-01', endISO: '2026-04-20' }, // ADDED
        { cellId: 'next', label: 'Carrot', startISO: '2026-07-10', endISO: '2026-08-01' } // ADDED
    ], pairWindow, { excludeCellIds: ['source'], basisLabel: 'source and companion planting pair' }); // ADDED
    assert.equal(companionHints.text, 'Before: 11d gap; After: 9d gap'); // ADDED
    assert.match(companionHints.tooltip, /source and companion planting pair/); // ADDED
    const turnoverHints = hooks.computeSchedulerAdjacentGapHints([ // ADDED
        { cellId: 'source', label: 'Lettuce', startISO: '2026-04-01', endISO: '2026-07-01' }, // ADDED
        { cellId: 'next', label: 'Carrot', startISO: '2026-08-20', endISO: '2026-09-10' } // ADDED
    ], { startISO: '2026-07-02', endISO: '2026-08-01' }, { basisLabel: 'turnover planting' }); // ADDED
    assert.equal(turnoverHints.text, 'Before: 1d gap; After: 19d gap'); // ADDED
}); // ADDED

test('scheduler layout tab wires live SVG preview and context-aware default saving', () => { // ADDED
    assert.match(schedulerSource, /const layoutTab = document\.createElement\('div'\)/); // ADDED
    assert.match(schedulerSource, /const layoutTabBtn = mxUtils\.button\("Layout"/); // ADDED
    assert.match(schedulerSource, /renderLayoutPreviewSvg\(layoutPreview, model\)/); // ADDED
    assert.match(schedulerSource, /saveLayoutDefaultChk\.checked[\s\S]*CompanionRelationshipModel\.ensurePairDefaultsRelationship[\s\S]*CompanionRelationshipModel\.saveLayoutDefaults/); // CHANGED
    assert.match(schedulerSource, /PlantModel\.update\(formState\.plantId, spacingPatch\)/); // ADDED
    assert.match(schedulerSource, /layoutOffsetCm: derivedContext\.mode === 'companion'/); // ADDED
    assert.match(schedulerSource, /writeCellAttribute\(targetCell, 'companion_relation_id', ensured\.relationId/); // CHANGED
    assert.match(schedulerSource, /Companion group layout/); // ADDED
    assert.match(schedulerSource, /applyCompanionGroupLayoutToGraph/); // ADDED
    assert.match(schedulerSource, /CompanionLayoutGroupDefaultModel\.save/); // ADDED
}); // ADDED

test('plant editor exposes layout defaults without a diagram preview', () => { // CHANGED
    assert.match(schedulerSource, /const spacingXInput = makeNullableNumber\(existing\?\.spacing_x_cm/); // ADDED
    assert.match(schedulerSource, /const spacingYInput = makeNullableNumber\(existing\?\.spacing_y_cm/); // ADDED
    assert.match(schedulerSource, /spacing_x_cm: readNullableNumber\(spacingXInput\)/); // ADDED
    assert.match(schedulerSource, /spacing_y_cm: readNullableNumber\(spacingYInput\)/); // ADDED
    assert.doesNotMatch(schedulerSource, /plantLayoutHeading\.textContent = 'Layout'/); // CHANGED
    assert.doesNotMatch(schedulerSource, /plantLayoutPreview/); // ADDED
    assert.match(schedulerSource, /Companion pair layout defaults/); // ADDED
    assert.match(schedulerSource, /CompanionRelationshipModel\.saveLayoutDefaults\(relationship\.relationId, readCompanionLayoutDraft\(\), relationship\)/); // ADDED
}); // ADDED

test('turnover computed-window filtering rejects same-cluster occupancy overlap', () => { // CHANGED
    const sourceCell = { id: 'source-3', getAttribute: key => ({ sow_date: '2026-04-01', harvest_end: '2026-09-15' }[key] || '') }; // ADDED
    const blockedGraph = { __trellisBedSuccessionNavigator: { getSelectedClusterOccupancy: () => ({ items: [ // ADDED
        { cellId: 'source-3', startISO: '2026-04-01', endISO: '2026-09-15' }, // ADDED
        { cellId: 'other', startISO: '2026-10-01', endISO: '2026-11-01' } // ADDED
    ] }) } }; // ADDED
    const clearGraph = { __trellisBedSuccessionNavigator: { getSelectedClusterOccupancy: () => ({ items: [ // ADDED
        { cellId: 'source-3', startISO: '2026-04-01', endISO: '2026-09-15' }, // ADDED
        { cellId: 'other', startISO: '2026-11-15', endISO: '2026-12-01' } // ADDED
    ] }) } }; // ADDED
    const computedWindow = { startISO: '2026-09-16', endISO: '2026-10-23' }; // ADDED
    assert.equal(hooks.turnoverComputedWindowFitsSourceCluster(sourceCell, computedWindow, blockedGraph), false); // CHANGED
    assert.equal(hooks.turnoverComputedWindowFitsSourceCluster(sourceCell, computedWindow, clearGraph), true); // CHANGED
}); // CHANGED

test('turnover candidate filtering uses the computed schedule window', async () => { // ADDED
    const sourceCell = { // ADDED
        id: 'source-4', // ADDED
        getAttribute: key => ({ method_category_id: 'direct_sow', method_id: 'direct_sow.field', sow_date: '2026-04-01', harvest_end: '2026-09-15' }[key] || '') // ADDED
    }; // ADDED
    const candidate = makeCrop({ plant_id: 14, plant_name: 'Computed Turnover', days_maturity: 30, harvest_window_days: 7, annual: 1, biennial: 0, perennial: 0 }); // ADDED
    const city = makeCity(hooks, 22); // ADDED
    const window = await hooks.computeAnnualTurnoverWindowForCandidate(sourceCell, candidate, '2026-09-16', { city, cityName: city.city_name, year: 2026, bedProfile: hooks.normalizeBedProfile(null) }); // ADDED
    assert.ok(window?.startISO, 'expected computed turnover start'); // ADDED
    assert.ok(window?.endISO, 'expected computed turnover harvest end'); // ADDED
    const blockedGraph = { __trellisBedSuccessionNavigator: { getSelectedClusterOccupancy: () => ({ items: [ // ADDED
        { cellId: 'source-4', startISO: '2026-04-01', endISO: '2026-09-15' }, // ADDED
        { cellId: 'other', startISO: window.endISO, endISO: hooks.shiftISODate(window.endISO, 2) } // ADDED
    ] }) } }; // ADDED
    assert.equal(await hooks.turnoverCandidateFitsSourceCluster(sourceCell, candidate, '2026-09-16', { graph: blockedGraph, city, cityName: city.city_name, year: 2026, bedProfile: hooks.normalizeBedProfile(null) }), false); // ADDED
}); // ADDED

test('perennial crop suitability is alphabetic and date-flexible', async () => { // ADDED
    const perennial = makeCrop({ plant_id: 1, plant_name: 'Rhubarb', annual: 0, biennial: 0, perennial: 1, lifespan_years: 3 }); // ADDED
    const score = await hooks.scoreCropSuitability(perennial, {}); // ADDED
    assert.equal(score.hint, 'date-flexible'); // ADDED
    const groups = hooks.buildGroupedCropOptions(hooks.makeCropPickerOptions([ // ADDED
        makeCrop({ plant_id: 2, plant_name: 'Z Perennial', annual: 0, biennial: 0, perennial: 1, lifespan_years: 3 }), // ADDED
        makeCrop({ plant_id: 3, plant_name: 'A Perennial', annual: 0, biennial: 0, perennial: 1, lifespan_years: 3 }) // ADDED
    ]), { filter: 'perennial' }); // ADDED
    assert.deepEqual(Array.from(groups[0].options, option => option.label), ['A Perennial', 'Z Perennial']); // ADDED
}); // ADDED

function makeVariety(overrides = {}) { // ADDED
    return { // ADDED
        variety_id: overrides.variety_id ?? 1, // ADDED
        plant_id: overrides.plant_id ?? 1, // ADDED
        variety_name: overrides.variety_name || 'Variety', // ADDED
        maturity_class: overrides.maturity_class ?? '', // ADDED
        overrides_json: JSON.stringify(overrides.overrides || {}), // ADDED
        ...overrides // ADDED
    }; // ADDED
} // ADDED

test('variety options group by manual class, DTM inference, and GDD fallback', () => { // ADDED
    const groups = hooks.buildGroupedVarietyOptions([ // ADDED
        makeVariety({ variety_id: 1, variety_name: 'Quick', overrides: { days_maturity: 45 } }), // ADDED
        makeVariety({ variety_id: 2, variety_name: 'Middle', overrides: { days_maturity: 60 } }), // ADDED
        makeVariety({ variety_id: 3, variety_name: 'Slow', overrides: { days_maturity: 80 } }), // ADDED
        makeVariety({ variety_id: 4, variety_name: 'Curated Late', maturity_class: 'late', overrides: { days_maturity: 40 } }), // ADDED
        makeVariety({ variety_id: 5, variety_name: 'Heat Only', overrides: { gdd_to_maturity: 900 } }), // ADDED
        makeVariety({ variety_id: 6, variety_name: 'Heat Mid', overrides: { gdd_to_maturity: 1200 } }), // ADDED
        makeVariety({ variety_id: 7, variety_name: 'Heat Late', overrides: { gdd_to_maturity: 1500 } }) // ADDED
    ]); // ADDED
    assert.deepEqual(Array.from(groups, group => group.label), ['Early varieties', 'Mid varieties', 'Late varieties']); // ADDED
    assert.deepEqual(Array.from(groups, group => Array.from(group.options, option => option.label)), [ // ADDED
        ['Quick - 45d', 'Heat Only - 900 GDD'], // ADDED
        ['Middle - 60d', 'Heat Mid - 1200 GDD'], // ADDED
        ['Curated Late - 40d', 'Slow - 80d', 'Heat Late - 1500 GDD'] // ADDED
    ]); // ADDED
}); // ADDED

test('variety grouping leaves insufficient inferred data uncategorized but honors manual class', () => { // ADDED
    const groups = hooks.buildGroupedVarietyOptions([ // ADDED
        makeVariety({ variety_id: 1, variety_name: 'Only One', overrides: { days_maturity: 45 } }), // ADDED
        makeVariety({ variety_id: 2, variety_name: 'Only Two', overrides: { days_maturity: 55 } }), // ADDED
        makeVariety({ variety_id: 3, variety_name: 'Manual Early', maturity_class: 'early' }) // ADDED
    ]); // ADDED
    assert.deepEqual(Array.from(groups, group => group.label), ['Early varieties', 'Uncategorized']); // ADDED
    assert.deepEqual(Array.from(groups[0].options, option => option.label), ['Manual Early']); // ADDED
    assert.deepEqual(Array.from(groups[1].options, option => option.label), ['Only One - 45d', 'Only Two - 55d']); // ADDED
}); // ADDED

test('rendered variety dropdown keeps base plant first and omits empty optgroups', () => { // ADDED
    const document = hooks.__testWindow.document; // ADDED
    const select = document.createElement('select'); // ADDED
    const groups = hooks.buildGroupedVarietyOptions([ // ADDED
        makeVariety({ variety_id: 1, variety_name: 'Alpha', maturity_class: 'early' }) // ADDED
    ]); // ADDED
    hooks.renderGroupedVarietyOptions(select, groups, '1'); // ADDED
    assert.equal(select.children[0].tagName, 'OPTION'); // ADDED
    assert.equal(select.children[0].textContent, '(base plant)'); // ADDED
    assert.deepEqual(Array.from(select.querySelectorAll('optgroup'), group => group.label), ['Early varieties']); // ADDED
    assert.equal(select.value, '1'); // ADDED
}); // ADDED

test('manual variety maturity mismatch warns only when inference is available', () => { // ADDED
    const rows = [ // ADDED
        makeVariety({ variety_id: 1, variety_name: 'Fast', maturity_class: 'late', overrides: { days_maturity: 40 } }), // ADDED
        makeVariety({ variety_id: 2, variety_name: 'Middle', overrides: { days_maturity: 60 } }), // ADDED
        makeVariety({ variety_id: 3, variety_name: 'Slow', overrides: { days_maturity: 80 } }) // ADDED
    ]; // ADDED
    const mismatch = hooks.manualVarietyMaturityMismatch(rows, rows[0]); // ADDED
    assert.equal(mismatch.manualClass, 'late'); // ADDED
    assert.equal(mismatch.inferredClass, 'early'); // ADDED
    assert.equal(mismatch.source, 'days_maturity'); // ADDED
    assert.equal(hooks.manualVarietyMaturityMismatch(rows.slice(0, 2), rows[0]), null); // ADDED
}); // ADDED

test('missing city fallback keeps Set Plant style options grouped alphabetically', () => { // ADDED
    const crops = [ // ADDED
        makeCrop({ plant_id: 1, plant_name: 'Zucchini', annual: 1, biennial: 0, perennial: 0 }), // ADDED
        makeCrop({ plant_id: 2, plant_name: 'Arugula', annual: 1, biennial: 0, perennial: 0 }) // ADDED
    ]; // ADDED
    const groups = hooks.buildGroupedCropOptions(hooks.makeCropPickerOptions(crops), { filter: 'all' }); // ADDED
    assert.equal(groups[0].label, 'Annual crops'); // ADDED
    assert.deepEqual(Array.from(groups[0].options, option => option.label), ['Arugula', 'Zucchini']); // ADDED
    assert.equal(groups[0].options.some(option => /window/.test(option.displayLabel)), false); // ADDED
}); // ADDED

test('date-only crop-menu scoring reuses cached windows instead of queueing recomputation', async () => { // ADDED
    const cache = hooks.makeCropSuitabilityCache(); // ADDED
    hooks.clearCropSuitabilityCache(cache); // ADDED
    const city = makeCity(hooks); // ADDED
    const crop = makeCrop({ plant_id: 11, plant_name: 'Cache Crop', annual: 1, biennial: 0, perennial: 0 }); // ADDED
    const baseContext = { city, cityName: city.city_name, primaryDateISO: '2026-04-01', seasonStartYear: 2026, cache }; // ADDED
    const first = await hooks.scoreCropSuitability(crop, baseContext); // ADDED
    assert.equal(first.pending, undefined); // ADDED
    assert.equal(cache.windowsByKey.size, 1); // ADDED
    const second = await hooks.scoreCropSuitability(crop, { ...baseContext, primaryDateISO: '2026-04-15', deferMissingWindows: true }); // ADDED
    assert.equal(second.pending, undefined); // ADDED
    assert.equal(cache.pendingByKey.size, 0); // ADDED
    assert.equal(cache.queue.length, 0); // ADDED
    assert.equal(cache.windowsByKey.size, 1); // ADDED
}); // ADDED

test('pending annual crop options render calculating hints and remain selectable', async () => { // ADDED
    const cache = hooks.makeCropSuitabilityCache(); // ADDED
    hooks.clearCropSuitabilityCache(cache); // ADDED
    const city = makeCity(hooks); // ADDED
    const crop = makeCrop({ plant_id: 12, plant_name: 'Pending Crop', annual: 1, biennial: 0, perennial: 0 }); // ADDED
    const options = await hooks.scoreCropPickerOptions([crop], { // ADDED
        city, // ADDED
        cityName: city.city_name, // ADDED
        primaryDateISO: '2026-04-01', // ADDED
        seasonStartYear: 2026, // ADDED
        cache, // ADDED
        deferMissingWindows: true // ADDED
    }); // ADDED
    assert.equal(options[0].displayLabel, 'Pending Crop - calculating'); // ADDED
    assert.equal(options[0].score.pending, true); // ADDED
    const groups = hooks.buildGroupedCropOptions(options, { filter: 'annual', selectedValue: '12' }); // ADDED
    assert.equal(groups[0].options[0].value, '12'); // ADDED
    assert.equal(cache.pendingByKey.size, 1); // ADDED
}); // ADDED

test('crop suitability cache key changes with full growing context', () => { // ADDED
    const city = makeCity(hooks); // ADDED
    const crop = makeCrop({ plant_id: 13, plant_name: 'Key Crop', annual: 1, biennial: 0, perennial: 0 }); // ADDED
    const base = { city, cityName: city.city_name, seasonStartYear: 2026, bedProfile: hooks.normalizeBedProfile(null), bedProfileSource: 'generic garden bed' }; // ADDED
    const same = hooks.makeCropWindowCacheKey(crop, { ...base }); // ADDED
    const bedChanged = hooks.makeCropWindowCacheKey(crop, { ...base, bedProfile: hooks.normalizeBedProfile({ soil: 'raised' }), bedProfileSource: 'raised bed' }); // ADDED
    const yearChanged = hooks.makeCropWindowCacheKey(crop, { ...base, seasonStartYear: 2027 }); // ADDED
    assert.equal(hooks.makeCropWindowCacheKey(crop, { ...base }), same); // ADDED
    assert.notEqual(bedChanged, same); // ADDED
    assert.notEqual(yearChanged, same); // ADDED
}); // ADDED

test('selected-crop date fast path selects containing cached sowing season', () => { // ADDED
    const state = { // ADDED
        windowFeasible: true, // ADDED
        startISO: '2026-03-15', // ADDED
        activeSowingSeasonId: 'spring', // ADDED
        sowingSeasons: [ // ADDED
            { id: 'spring', label: 'Spring', startISO: '2026-03-01', endISO: '2026-05-31' }, // ADDED
            { id: 'fall', label: 'Fall', startISO: '2026-08-15', endISO: '2026-09-15' } // ADDED
        ] // ADDED
    }; // ADDED
    const result = hooks.applyDateToExistingSowingWindows(state, { startISO: '2026-08-20' }); // ADDED
    assert.equal(result.applied, true); // ADDED
    assert.equal(state.activeSowingSeasonId, 'fall'); // ADDED
    assert.equal(result.classification.status, 'feasible'); // ADDED
}); // ADDED

test('selected-crop date fast path preserves active season when outside cached windows', () => { // ADDED
    const state = { // ADDED
        windowFeasible: true, // ADDED
        startISO: '2026-03-15', // ADDED
        activeSowingSeasonId: 'spring', // ADDED
        sowingSeasons: [ // ADDED
            { id: 'spring', label: 'Spring', startISO: '2026-03-01', endISO: '2026-05-31' }, // ADDED
            { id: 'fall', label: 'Fall', startISO: '2026-08-15', endISO: '2026-09-15' } // ADDED
        ] // ADDED
    }; // ADDED
    const result = hooks.applyDateToExistingSowingWindows(state, { startISO: '2026-07-01' }); // ADDED
    assert.equal(result.applied, true); // ADDED
    assert.equal(state.activeSowingSeasonId, 'spring'); // ADDED
    assert.equal(result.classification.status, 'outside_window'); // ADDED
}); // ADDED

test('missing selected-crop cached windows require anchor recomputation fallback', () => { // ADDED
    const result = hooks.applyDateToExistingSowingWindows({ windowFeasible: true, sowingSeasons: [], activeSowingSeasonId: '' }, { startISO: '2026-04-01' }); // ADDED
    assert.equal(result.applied, false); // ADDED
    assert.equal(result.reason, 'missing cached windows'); // ADDED
}); // ADDED

test('date and filter handlers use cached fast paths', () => { // ADDED
    assert.match(schedulerSource, /case 'startChanged':[\s\S]*applySelectedDateOnlyFastPath\(\)[\s\S]*await recomputeAnchors\(false, false\);/); // ADDED
    assert.ok(schedulerSource.includes('renderSchedulerCropPicker(currentCropPickerOptions, currentCropPickerSelectedValue); // CHANGED')); // CHANGED
    assert.ok(!schedulerSource.includes("lifecycleFilterSel.addEventListener('change', () => { // ADDED\r\n            renderSchedulerCropPicker(currentCropPickerOptions, plantSel.value); // ADDED\r\n            scheduleCropPickerSuitabilityRefresh(0); // ADDED")); // ADDED
}); // ADDED

test('crop picker selection stays fresh across async refreshes', () => { // ADDED
    assert.match(schedulerSource, /let currentCropPickerSelectedValue = String\(initialPlant\?\.plant_id \?\? plantsLocal\[0\]\?\.plant_id \?\? ''\);/); // ADDED
    assert.match(schedulerSource, /function renderSchedulerCropPicker\(pickerOptions = currentCropPickerOptions, selectedValue = currentCropPickerSelectedValue\)/); // ADDED
    assert.doesNotMatch(schedulerSource, /async function refreshSchedulerCropPickerSuitability\(\) \{[\s\S]*const selectedValue = plantSel\.value;/); // ADDED
    assert.match(schedulerSource, /renderSchedulerCropPicker\(nextOptions, currentCropPickerSelectedValue\);/); // ADDED
    assert.match(schedulerSource, /plantSel\.addEventListener\('change', \(\) => \{[\s\S]*currentCropPickerSelectedValue = String\(plantSel\.value \|\| ''\);[\s\S]*schedulerCropPickerRefreshVersion \+= 1;[\s\S]*renderSchedulerCropPicker\(currentCropPickerOptions, currentCropPickerSelectedValue\);[\s\S]*await handleSchedulePlantChange\(\);/); // ADDED
    assert.match(schedulerSource, /formState\.plantId = Number\(plantSel\.value\);[\s\S]*currentCropPickerSelectedValue = String\(formState\.plantId \|\| ''\);/); // ADDED
}); // ADDED

test('crop changes preserve the visible selected date before recomputing windows', () => { // ADDED
    assert.match(schedulerSource, /const preservedPrimaryDateISO = String\(startInput\.value \|\| ''\)\.trim\(\);/); // ADDED
    assert.match(schedulerSource, /startInput\.value = preservedPrimaryDateISO;[\s\S]*userEditedStartThisSession = true;/); // ADDED
    assert.match(schedulerSource, /case 'plantChanged': \{[\s\S]*await recomputeAnchors\(false, true\);/); // ADDED
}); // ADDED

function makeSummaryViewState(overrides = {}) { // ADDED
    return hooks.buildScheduleViewState({ // ADDED
        windowFeasible: true, // ADDED
        plantName: 'Tomato', // ADDED
        cityName: 'Test City', // ADDED
        seasonStartYear: 2026, // ADDED
        methodName: 'Direct sow', // ADDED
        startISO: '2026-04-01', // ADDED
        sowingSeasons: [{ id: 'spring', label: 'Spring', startISO: '2026-03-01', endISO: '2026-05-31' }], // ADDED
        activeSowingSeasonId: 'spring', // ADDED
        firstHarvestISO: '2026-06-01', // ADDED
        lastHarvestISO: '2026-06-08', // ADDED
        ...overrides // ADDED
    }); // ADDED
} // ADDED

test('schedule summary view state de-duplicates warning bullet messages', () => { // ADDED
    const viewState = makeSummaryViewState({ // ADDED
        scheduleWarnings: [ // ADDED
            { message: 'There is not enough growing-degree accumulation to reach maturity.' }, // ADDED
            { message: 'Selected sow date yield multiplier 0.49 is below the minimum 0.50.' }, // ADDED
            { message: 'There is not enough growing-degree accumulation to reach maturity.' }, // ADDED
            { message: '   ' }, // ADDED
            { type: 'missing_message' } // ADDED
        ] // ADDED
    }); // ADDED

    assert.equal(viewState.feasibility.status, 'warning'); // ADDED
    assert.deepEqual(Array.from(viewState.feasibility.warningMessages), [ // CHANGED
        'There is not enough growing-degree accumulation to reach maturity.', // ADDED
        'Selected sow date yield multiplier 0.49 is below the minimum 0.50.' // ADDED
    ]); // ADDED
}); // ADDED

test('schedule summary renders warnings as bullet list in double-wide feasibility item', () => { // ADDED
    const summaryView = hooks.renderScheduleSummary(); // ADDED
    const viewState = makeSummaryViewState({ // ADDED
        scheduleWarnings: [ // ADDED
            { message: 'There is not enough growing-degree accumulation to reach maturity.' }, // ADDED
            { message: 'Selected sow date yield multiplier 0.49 is below the minimum 0.50.' } // ADDED
        ] // ADDED
    }); // ADDED

    hooks.updateScheduleSummary(summaryView, viewState); // ADDED

    const feasibilityItem = summaryView.fields.feasibility.parentElement; // ADDED
    const warningItems = Array.from(summaryView.fields.feasibility.querySelectorAll('ul.usl-scheduler-summary-warning-list > li'), item => item.textContent); // ADDED
    assert.equal(feasibilityItem.classList.contains('usl-scheduler-summary-item--wide'), true); // ADDED
    assert.deepEqual(warningItems, Array.from(viewState.feasibility.warningMessages)); // CHANGED
}); // ADDED

test('schedule summary keeps non-warning feasibility as plain text', () => { // ADDED
    const summaryView = hooks.renderScheduleSummary(); // ADDED
    const viewState = makeSummaryViewState(); // ADDED

    hooks.updateScheduleSummary(summaryView, viewState); // ADDED

    assert.equal(summaryView.fields.feasibility.querySelector('ul'), null); // ADDED
    assert.equal(summaryView.fields.feasibility.textContent, 'The selected sow date is in Spring.'); // ADDED
}); // ADDED

test('lifecycle marker tooltip shows immediately and avoids native title', () => { // ADDED
    const document = hooks.__testWindow.document; // ADDED
    const win = document.defaultView; // ADDED
    const track = document.createElement('div'); // ADDED
    const marker = document.createElement('button'); // ADDED
    const text = 'HS - First harvest: 2026-05-01\nClick to edit the first task rule starting here.'; // ADDED
    track.style.position = 'relative'; // ADDED
    marker.setAttribute('data-timeline-percent', '50'); // ADDED
    marker.setAttribute('data-timeline-offset-px', '0'); // ADDED
    marker.title = 'Native title should be removed'; // ADDED
    track.appendChild(marker); // ADDED
    document.body.appendChild(track); // ADDED
    hooks.attachLifecycleTimelineMarkerTooltip(marker, track, text); // ADDED

    assert.equal(marker.hasAttribute('title'), false); // ADDED
    assert.equal(marker.getAttribute('aria-label'), text); // ADDED

    marker.dispatchEvent(new win.MouseEvent('mouseenter')); // ADDED
    const tooltip = track.querySelector('.usl-lifecycle-marker-tooltip'); // ADDED
    assert.ok(tooltip); // ADDED
    assert.equal(tooltip.style.display, 'block'); // ADDED
    assert.equal(tooltip.textContent, text); // ADDED

    marker.dispatchEvent(new win.MouseEvent('mouseleave')); // ADDED
    assert.equal(tooltip.style.display, 'none'); // ADDED
    marker.dispatchEvent(new win.FocusEvent('focus')); // ADDED
    assert.equal(tooltip.style.display, 'block'); // ADDED
    marker.dispatchEvent(new win.FocusEvent('blur')); // ADDED
    assert.equal(tooltip.style.display, 'none'); // ADDED
    marker.dispatchEvent(new win.FocusEvent('focus')); // ADDED
    marker.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' })); // ADDED
    assert.equal(tooltip.style.display, 'none'); // ADDED

    let clickCount = 0; // ADDED
    marker.addEventListener('click', () => { clickCount += 1; }); // ADDED
    marker.dispatchEvent(new win.MouseEvent('click')); // ADDED
    assert.equal(clickCount, 1); // ADDED
    track.remove(); // ADDED
}); // ADDED

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
