/** Domain editor recovery must not run the planner's ordinary close-time draft persistence. */ // NEW
const test = require('node:test'); // NEW
const assert = require('node:assert/strict'); // NEW
const { createYearPlannerHarness, makePlanCrop } = require('./helpers/year-planner-harness.cjs'); // NEW
function fixture(t) { // NEW
    const h = createYearPlannerHarness(); t.after(() => h.dom.window.close()); const calls = []; let editor, active = true, denied = false; // NEW
    h.window.Trellis = { sharing: { getInfo: () => ({ managed: true }), registerEditor(config) { editor = config; return { active: () => active, touch: () => calls.push('touch'), acquire: async () => { calls.push('claim'); if (denied) { config.discard(); throw new Error('Another editor has the hold'); } return true; }, dispose(release) { active = false; calls.push(release ? 'release' : 'dispose'); } }; } } }; // NEW
    return { h, calls, editor: () => editor, deny() { denied = true; } }; // NEW
} // NEW
test('year planner registers one garden target, views without claiming, and requests access on a real edit', async t => { // NEW
    const f = fixture(t), { h } = f, plan = h.api.PlanSchema.createEmptyPlan(2026); plan.crops.push(makePlanCrop()); h.api.PlanRepository.savePlanForYear(h.moduleCell, 2026, plan); // NEW
    await h.openModal(2026); assert.equal(f.calls.length, 0); assert.deepEqual(Array.from(f.editor().targets), ['["","module"]']); // NEW
    const field = h.document.querySelector('[data-year-plan-field="kgPerPlant"]'); assert.ok(field); h.setControlValue(field, 2); await h.settle(120); // NEW
    assert.ok(f.calls.includes('touch')); assert.equal(f.editor().capture().plan.crops[0].kgPerPlant, 2); // NEW
    const year = h.document.querySelector('[data-trellis-quickstart="plan-year"]'); h.setControlValue(year, 2027, 'change'); await h.settle(120); // NEW
    assert.equal(f.editor().capture().year, 2027); assert.deepEqual(Array.from(f.editor().targets), ['["","module"]']); assert.equal(f.calls.includes('release'), false); // NEW
}); // NEW
test('forced planner close preserves a capturable incomplete plan and suppresses draft autosave', async t => { // NEW
    const f = fixture(t), session = await f.h.openModal(2026); session.plan.selfSufficiency.adults = 3; // NEW
    assert.equal(f.editor().capture().plan.selfSufficiency.adults, 3); f.editor().discard(); await f.h.settle(); // NEW
    assert.equal(f.h.api.PlanRepository.loadDraftForYear(f.h.moduleCell, 2026), null); assert.equal(f.h.api.PlanRepository.loadPlanForYear(f.h.moduleCell, 2026), null); // NEW
    assert.equal(session.ui.modalEl, null); // NEW
}); // NEW
test('handoff saves incomplete plans through existing draft semantics; denied access cannot persist them', async t => { // NEW
    const f = fixture(t), session = await f.h.openModal(2026); session.plan.selfSufficiency.adults = 3; // NEW
    assert.equal(await f.editor().save(), true); assert.equal(f.h.api.PlanRepository.loadDraftForYear(f.h.moduleCell, 2026).plan.selfSufficiency.adults, 3); // NEW
    assert.equal(f.h.api.PlanRepository.loadPlanForYear(f.h.moduleCell, 2026), null); f.editor().discard(); // NEW
    const rejected = fixture(t), draft = await rejected.h.openModal(2026); draft.plan.selfSufficiency.adults = 4; rejected.deny(); // NEW
    assert.equal(await rejected.editor().save(), false); assert.equal(rejected.h.api.PlanRepository.loadDraftForYear(rejected.h.moduleCell, 2026), null); // NEW
}); // NEW
