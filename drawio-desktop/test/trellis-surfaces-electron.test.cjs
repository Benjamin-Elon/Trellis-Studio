/** Verify shared styles against production Year Plan DOM before handing layout checks to Chromium. */ // NEW
const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const vm = require('node:vm'); // NEW
const { spawnSync } = require('node:child_process'); // NEW
const test = require('node:test'); // NEW
const { JSDOM } = require('jsdom'); // NEW
const { createYearPlannerHarness, makePlanCrop } = require('./helpers/year-planner-harness.cjs'); // NEW
const project = path.resolve(__dirname, '..'); // NEW
const sharedSource = fs.readFileSync(path.join(project, 'drawio/src/main/webapp/plugins/garden_planner_plugins/Trellis_UI_Cleanup.js'), 'utf8'); // NEW
const output = path.join(project, '.test-artifacts/layered-surfaces'); // NEW

/** Load the entire shared plugin while leaving editor installation to its normal host. */ // NEW
function install(window) { // NEW
    vm.runInNewContext(sharedSource, { window, document: window.document, Draw: { loadPlugin() {} } }); // NEW
} // NEW

test('surface styles install once per document and support an independent owner document', () => { // NEW
    const first = new JSDOM(), second = new JSDOM(); // NEW
    try { // NEW
        install(first.window); install(first.window); // NEW
        first.window.Trellis.ui.ensureSurfaceStyles(first.window.document); // NEW
        first.window.Trellis.ui.ensureSurfaceStyles(second.window.document); // NEW
        first.window.Trellis.ui.ensureSurfaceStyles(second.window.document); // NEW
        assert.equal(first.window.document.querySelectorAll('#trellis-shared-surface-styles').length, 1); // NEW
        assert.equal(second.window.document.querySelectorAll('#trellis-shared-surface-styles').length, 1); // NEW
        assert.equal(second.window.document.querySelector('style').ownerDocument, second.window.document); // NEW
    } finally { first.window.close(); second.window.close(); } // NEW
}); // NEW

/** Serialize live form values too: DOM properties are not all reflected in HTML attributes. */ // NEW
function snapshot(harness, name) { // NEW
    for (const input of harness.document.querySelectorAll('input')) { input.setAttribute('value', input.value); input.toggleAttribute('checked', input.checked); } // NEW
    for (const select of harness.document.querySelectorAll('select')) for (const option of select.options) option.toggleAttribute('selected', option.selected); // NEW
    fs.writeFileSync(path.join(output, name + '.html'), harness.dom.serialize()); // NEW
} // NEW

test('production section hierarchy survives collapse and disabled-state rebuilds and renders in Chromium', { timeout: 120000 }, async () => { // NEW
    fs.mkdirSync(output, { recursive: true }); // NEW
    const h = createYearPlannerHarness(); // NEW
    try { // NEW
        install(h.window); // NEW
        const plan = h.api.PlanSchema.createEmptyPlan(2026); // NEW
        plan.crops.push(makePlanCrop()); // NEW
        plan.demands.push({ id: 'surface_line', channelId: 'farm_store', cropId: 'crop_1', qty: 12, unit: 'kg', frequency: 'week', everyN: 1, from: '2026-06-01', to: '2026-09-30', notes: '' }); // NEW
        h.api.PlanRepository.savePlanForYear(h.moduleCell, 2026, plan); await h.openModal(); // NEW
        const demandHeader = () => h.document.querySelector('[data-year-plan-strip="demand"] .yp-strip-header'); // NEW
        if (demandHeader().getAttribute('aria-expanded') !== 'true') demandHeader().click(); // NEW
        const channel = () => h.document.querySelector('[data-demand-channel-id="farm_store"]'); // NEW
        assert.equal(channel().dataset.trellisSurface, 'inset'); // NEW
        assert.equal(channel().closest('[data-year-plan-strip]').dataset.trellisSurface, 'section'); // NEW
        assert.equal(channel().querySelector('[data-demand-line-id]').dataset.trellisSurface, 'entry'); // NEW
        snapshot(h, 'year-plan-expanded'); // NEW
        [...channel().querySelectorAll('button')].find(button => button.textContent === 'Manage packages').click(); await h.settle(); // NEW
        assert.ok(h.document.querySelector('.yp-picker-dialog')); snapshot(h, 'year-plan-picker'); // NEW
        [...h.document.querySelectorAll('.yp-picker-dialog button')].find(button => button.textContent === 'Close').click(); // NEW
        const collapse = [...channel().querySelectorAll('button')].find(button => button.textContent === 'Collapse'); // NEW
        collapse.click(); assert.equal(channel().querySelector('.yp-demand-channel-details').style.display, 'none'); // NEW
        snapshot(h, 'year-plan-collapsed'); // NEW
        [...channel().querySelectorAll('button')].find(button => button.textContent === 'Expand').click(); // NEW
        const enabled = channel().querySelector('input[type="checkbox"]'); enabled.checked = false; enabled.dispatchEvent(new h.window.Event('change')); // NEW
        assert.ok(channel().classList.contains('yp-disabled-area')); // NEW
        assert.equal(channel().dataset.trellisSurface, 'inset'); snapshot(h, 'year-plan-disabled'); // NEW
        const allocation = createYearPlannerHarness({ allocate: true }), usl = allocation.window.USL; // NEW
        try { // NEW
            install(allocation.window); allocation.api.PlanRepository.savePlanForYear(allocation.moduleCell, 2026, plan); // NEW
            usl.scheduler = { resolveCityForModule: async () => ({ ok: true, city: {} }) }; // NEW
            usl.tiler = { listGardenBeds: () => [], listPlantingFootprints: () => [] }; // NEW
            await usl.allocate.open(allocation.moduleCell, 2026); await allocation.settle(100); snapshot(allocation, 'allocate-panel'); // NEW
        } finally { usl.allocate.close('test'); allocation.dom.window.close(); } // NEW
        const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; // NEW
        const result = spawnSync(require('electron'), [path.join(__dirname, 'helpers/trellis-surfaces-electron.cjs')], { env, windowsHide: true, encoding: 'utf8', timeout: 100000 }); // NEW
        assert.equal(result.error, undefined, result.stderr || result.stdout); // NEW
        assert.equal(result.status, 0, result.stderr || result.stdout); // NEW
        assert.match(result.stdout, /SURFACE_RENDER_OK/); // NEW
    } finally { h.dom.window.close(); } // NEW
}); // NEW
