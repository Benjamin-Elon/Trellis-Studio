// USL Draw.io Plugin Module: Garden Scheduler perennial pure planning core. // ADDED
(function (root) {
    'use strict';

    const win = root || {};
    win.USL = win.USL || {};
    win.USL.scheduler = win.USL.scheduler || {};

    const shared = win.USL.scheduler.sharedCore;
    if (!shared) {
        throw new Error('Garden_Scheduler_Perennial_Core.js requires Garden_Scheduler_Shared_Core.js.');
    }

    const {
        HARVEST_END_SEMANTICS,
        fmtISO,
        parseISODateUTCValue,
        isPerennialPlant,
        requirePerennialLifespanYears,
        computePerennialLifespanEndISO
    } = shared;

    function computePerennialScheduleResult(inputs) {
        const { plant, methodId } = inputs;
        const method = methodId;
        const startDate = parseISODateUTCValue(inputs.startISO);
        if (!startDate) {
            throw new Error('Select a planting date.');
        }
        if (!isPerennialPlant(plant)) {
            throw new Error('Perennial scheduler received a non-perennial plant.');
        }

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
        };

        return {
            kind: 'perennial',
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

    win.USL.scheduler.perennialCore = Object.freeze({
        computePerennialScheduleResult
    });
})(typeof window !== 'undefined' ? window : globalThis);
