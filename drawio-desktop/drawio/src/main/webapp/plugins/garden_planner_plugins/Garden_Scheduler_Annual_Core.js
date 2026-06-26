// USL Draw.io Plugin Module: Garden Scheduler annual pure planning core. // ADDED
(function (root) {
    'use strict';

    const win = root || {};
    win.USL = win.USL || {};
    win.USL.scheduler = win.USL.scheduler || {};

    const shared = win.USL.scheduler.sharedCore;
    if (!shared) {
        throw new Error('Garden_Scheduler_Annual_Core.js requires Garden_Scheduler_Shared_Core.js.');
    }

    const {
        HARVEST_END_SEMANTICS,
        daysInMonth,
        addDaysUTC,
        asUTCDate,
        dateLTE,
        fmtISO,
        finiteNumberOrNull,
        normId,
        parseISODateUTCValue,
        resolveHarvestWindowDays,
        isPerennialPlant,
        pickFrostByRisk,
        PolicyFlags,
        ScheduleInputs,
        asCoolingThresholdC,
        coolingGateThresholdC,
        dateFromDOY,
        normalizeBedProfile,
        estimateSoilTempC,
        resolveMethodBehavior,
        validateAutoWindowMethodInputs,
        humanFeasibilityReason
    } = shared;

    function monthMeanAt(date, monthlyAvgTemp) {
        return monthlyAvgTemp?.[date.getUTCMonth() + 1] ?? null;
    }
    function firstCoolingCrossingDate({ thresholdC, monthlyAvgTemp, scanStart, scanEndHard }) {
        let cursor = asUTCDate(scanStart.getUTCFullYear(), scanStart.getUTCMonth() + 1, 1);
        const end = asUTCDate(scanEndHard.getUTCFullYear(), scanEndHard.getUTCMonth() + 1, 1);
        let armed = false;
        let previousWarmMonth = null;
        let previousWarmTemp = null;

        while (dateLTE(cursor, end)) {
            const Tcur = monthMeanAt(cursor, monthlyAvgTemp);
            if (Tcur == null) {
                armed = false;
                previousWarmMonth = null;
                previousWarmTemp = null;
            } else if (Tcur > thresholdC) {
                armed = true;
                previousWarmMonth = new Date(cursor);
                previousWarmTemp = Number(Tcur);
            } else if (armed && previousWarmMonth && previousWarmTemp != null) {
                const expectedNextMonth = asUTCDate(
                    previousWarmMonth.getUTCFullYear(),
                    previousWarmMonth.getUTCMonth() + 2,
                    1
                );
                if (expectedNextMonth.getTime() === cursor.getTime()) {
                    const dim = daysInMonth(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1);
                    const frac = Math.min(1, Math.max(
                        0,
                        (previousWarmTemp - thresholdC) / Math.max(1e-6, previousWarmTemp - Number(Tcur))
                    ));
                    const day = Math.max(1, Math.min(dim, Math.round(frac * dim)));
                    return asUTCDate(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, day);
                }
                armed = false;
                previousWarmMonth = null;
                previousWarmTemp = null;
            }
            cursor = asUTCDate(cursor.getUTCFullYear(), cursor.getUTCMonth() + 2, 1);
        }
        return null;
    }
    function accumulateGDDUntil(startDate, targetGDD, dailyRatesMap, seasonEnd) {
        let acc = 0;
        let cur = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()));
        while (acc < targetGDD) {
            if (seasonEnd && !dateLTE(cur, seasonEnd)) break;
            const rate = Math.max(0, dailyRatesMap[cur.getUTCMonth() + 1] ?? 0);
            acc += rate;
            if (acc >= targetGDD) break;
            cur = addDaysUTC(cur, 1);
        }
        const reached = acc >= targetGDD;
        return { date: cur, gdd: acc, reached };
    }
    function accumulateGDDBackward(targetDate, targetGDD, dailyRatesMap, seasonStart = null) {
        let acc = 0;
        let cur = addDaysUTC(targetDate, -1);
        while (acc < targetGDD) {
            if (seasonStart && dateLTE(cur, addDaysUTC(seasonStart, -1))) break;
            const rate = Math.max(0, dailyRatesMap[cur.getUTCMonth() + 1] ?? 0);
            acc += rate;
            cur = addDaysUTC(cur, -1);
        }
        return { date: addDaysUTC(cur, 1), gdd: acc };
    }
    function maturityDateFromBudget(startDate, budget, dailyRatesMap, seasonEnd) {
        if (budget.mode === 'days') {
            return addDaysUTC(startDate, Math.max(0, Math.round(budget.amount)));
        }
        return accumulateGDDUntil(startDate, budget.amount, dailyRatesMap, seasonEnd).date;
    }
    function thermalYieldFactor(T, cropTemp) {
        const { Tmin, ToptLow, ToptHigh, Tmax } = cropTemp;
        if (T <= Tmin || T >= Tmax) return 0;
        if (T < ToptLow) return (T - Tmin) / Math.max(1e-9, (ToptLow - Tmin));
        if (T <= ToptHigh) return 1;
        return (Tmax - T) / Math.max(1e-9, (Tmax - ToptHigh));
    }
    function weightedMeanTempOverRange(startDate, endDate, monthlyAvgTemp, dailyRatesMap, Tbase = 10) {
        let cur = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()));
        const sampleEnd = endDate > startDate ? endDate : addDaysUTC(startDate, 1);
        let sum = 0, n = 0;
        while (cur < sampleEnd) {
            const m = cur.getUTCMonth() + 1;
            let T = monthlyAvgTemp?.[m];
            if (T == null) {
                const gdd = Math.max(0, dailyRatesMap[cur.getUTCMonth() + 1] ?? 0);
                T = gdd > 0 ? (Tbase + gdd) : (Tbase - 2);
            }
            sum += T; n += 1; cur = addDaysUTC(cur, 1);
        }
        return n > 0 ? (sum / n) : Tbase;
    }

    class Planner {
        constructor(inputs) {
            const { plant, city, planningMode, methodCategoryId, methodId, policy } = inputs;
            const { startDate, seasonEnd, env, dailyRates, monthlyAvg, scanStart, scanEndHard } = inputs.derived();
            if (isPerennialPlant(plant)) {
                throw new Error('Perennial schedules use lifespan dates instead of the maturity planner.');
            }
            const budget = plant.firstHarvestBudget();
            const HW_DAYS = resolveHarvestWindowDays(inputs.harvestWindowDays, plant);
            const coolingThreshold = coolingGateThresholdC(plant); // FIX: only cross-year crops use fall cooling gates
            let coolingCross = null;
            if (coolingThreshold != null) {
                coolingCross = firstCoolingCrossingDate({ thresholdC: coolingThreshold, monthlyAvgTemp: monthlyAvg, scanStart, scanEndHard });
            }
            this.ctx = Object.freeze({
                planningMode,
                methodCategoryId: normId(methodCategoryId),
                methodId: normId(methodId),
                useCoolingGate: coolingThreshold != null,
                coolingThresholdC: coolingThreshold,
                coolingCrossDate: coolingCross,
                overwinterAllowed: policy.overwinterAllowed,
                useSoilTempGate: policy.useSoilTempGate,
                soilGateThresholdC: policy.soilGateThresholdC,
                soilGateConsecutiveDays: policy.soilGateConsecutiveDays,
                useSpringFrostGate: policy.useSpringFrostGate,
                springFrostRisk: policy.springFrostRisk,
                lastSpringFrostDOY: pickFrostByRisk(city, policy.springFrostRisk),
                plant,
                HW_DAYS,
                BUDGET: budget,
                env,
                dailyRates,
                monthlyAvg,
                bedProfile: normalizeBedProfile(inputs.bedProfile), // ADDED: soil gates depend on garden-bed conditions.
                bedProfileSource: inputs.bedProfileSource || 'generic garden bed', // ADDED
                Tbase: env.Tbase,
                startDate,
                seasonEnd,
                scanStart,
                scanEndHard,
            });
        }

        gddRateOn(d) { return (this.ctx.dailyRates[d.getUTCMonth() + 1] ?? 0); }
        addDays(d, k) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + k)); }
        withinWindow(d) { return d >= this.ctx.scanStart && d <= this.ctx.scanEndHard; }
        normalizeUtcMidnight(d) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); }
        soilGateOK(startDate) {
            const { soilGateConsecutiveDays, soilGateThresholdC, monthlyAvg, bedProfile } = this.ctx;
            let cur = new Date(startDate);
            for (let i = 0; i < soilGateConsecutiveDays; i++) {
                const Tsoil = estimateSoilTempC(cur, monthlyAvg, bedProfile); // ADDED: interpolate city air and adjust for bed conditions.
                if (Tsoil < soilGateThresholdC) return false;
                cur = this.addDays(cur, 1);
            }
            return true;
        }
        checkSpringFrostGate(gateDate) {
            const C = this.ctx;
            if (!C.useSpringFrostGate || !gateDate) return { ok: true };
            const doy = shared.dayOfYear(gateDate);
            if (doy < Number(C.lastSpringFrostDOY || 0)) {
                return { ok: false, reason: `spring_frost_gate(doy ${doy} < ${C.lastSpringFrostDOY})` };
            }
            return { ok: true };
        }
        checkCoolingGate(gateDate) {
            const C = this.ctx;
            if (!C.useCoolingGate || !gateDate) return { ok: true };
            if (!C.coolingCrossDate || gateDate < C.coolingCrossDate) return { ok: false, reason: 'cooling_gate' };
            return { ok: true };
        }
        checkSoilGate(gateDate) {
            const C = this.ctx;
            if (!C.useSoilTempGate) return { ok: true };
            if (!gateDate) return { ok: false, reason: 'soil_gate_missing_date' };
            if (!this.soilGateOK(gateDate)) return { ok: false, reason: 'soil_gate' };
            return { ok: true };
        }
        isSowFeasible(sowDate) {
            const C = this.ctx;
            if (!this.withinWindow(sowDate)) return { ok: false, reason: 'outside_scan_window' };

            let transplantDate = null;
            if (C.planningMode === 'transplant_indoor') {
                const dTrans = Number(C.plant?.days_transplant ?? NaN);
                const daysTrans = Number.isFinite(dTrans) && dTrans > 0 ? Math.round(dTrans) : 0;
                transplantDate = this.addDays(sowDate, daysTrans);
            } else if (C.planningMode === 'transplant_outdoor') {
                transplantDate = new Date(sowDate);
            }

            const gateDate = (C.planningMode === 'direct_sow') ? sowDate : transplantDate;
            if (!gateDate || !this.withinWindow(gateDate)) return { ok: false, reason: 'gate_outside_scan_window' };

            const frost = this.checkSpringFrostGate(gateDate);
            if (!frost.ok) return frost;
            const cooling = this.checkCoolingGate(gateDate);
            if (!cooling.ok) return cooling;
            const soil = this.checkSoilGate(gateDate);
            if (!soil.ok) return soil;

            if (C.BUDGET.mode === 'gdd') {
                const acc = accumulateGDDUntil(sowDate, C.BUDGET.amount, C.dailyRates, C.scanEndHard);
                if (!acc.reached) return { ok: false, reason: 'insufficient_gdd' };
            }

            const mat = maturityDateFromBudget(sowDate, C.BUDGET, C.dailyRates, C.scanEndHard);
            const fullHarvestEnd = this.addDays(mat, C.HW_DAYS);
            if (!C.overwinterAllowed && sowDate.getUTCFullYear() !== fullHarvestEnd.getUTCFullYear()) {
                return { ok: false, reason: 'cross_year_disallowed' };
            }

            const hardEnd = (C.seasonEnd && C.seasonEnd <= C.scanEndHard) ? C.seasonEnd : C.scanEndHard;
            const effectiveHarvestEnd = (fullHarvestEnd <= hardEnd) ? fullHarvestEnd : hardEnd;
            const MS_PER_DAY = 24 * 60 * 60 * 1000;
            const harvestSpanDays = Math.max(0, Math.round((effectiveHarvestEnd.getTime() - mat.getTime()) / MS_PER_DAY));
            const minHarvestDays = Math.min(C.HW_DAYS, 3);
            if (harvestSpanDays < minHarvestDays) return { ok: false, reason: 'beyond_hard_end' };

            const TmeanHarvest = weightedMeanTempOverRange(mat, effectiveHarvestEnd, C.monthlyAvg, C.dailyRates, C.Tbase);
            const { Tmin, Tmax } = C.env;
            if (TmeanHarvest < Tmin) return { ok: false, reason: `harvest_too_cold(${TmeanHarvest.toFixed(1)}<${Tmin})` };
            if (TmeanHarvest > Tmax) return { ok: false, reason: `harvest_too_hot(${TmeanHarvest.toFixed(1)}>${Tmax})` };

            const truncated = fullHarvestEnd.getTime() > effectiveHarvestEnd.getTime();
            return { ok: true, maturity: mat, harvestStart: mat, harvestEnd: effectiveHarvestEnd, truncated, TmeanHarvest };
        }
        findNextFeasible(startCandidate, maxDays = 366) {
            const startMs = Math.max(
                this.normalizeUtcMidnight(startCandidate).getTime(),
                this.normalizeUtcMidnight(this.ctx.scanStart).getTime()
            );
            let d = new Date(startMs);
            for (let i = 0; i <= maxDays && d <= this.ctx.scanEndHard; i++) {
                const feas = this.isSowFeasible(d);
                if (feas.ok) return { date: d, info: feas };
                d = this.addDays(d, 1);
            }
            return { date: null, info: null };
        }
    }

    function getGateDateForCandidate(planner, sowDate) {
        const C = planner.ctx;
        if (C.planningMode === 'direct_sow') return new Date(sowDate);
        if (C.planningMode === 'transplant_indoor') {
            const dTrans = Number(C.plant?.days_transplant ?? NaN);
            const daysTrans = Number.isFinite(dTrans) && dTrans > 0 ? Math.round(dTrans) : 0;
            return planner.addDays(sowDate, daysTrans);
        }
        if (C.planningMode === 'transplant_outdoor') return new Date(sowDate);
        return new Date(sowDate);
    }
    function firstNonSoilStart(planner, startD) {
        const C = planner.ctx;
        let d = new Date(Math.max(startD.getTime(), C.scanStart.getTime()));
        for (; d <= C.scanEndHard; d = planner.addDays(d, 1)) {
            const gateDate = getGateDateForCandidate(planner, d);
            if (!C.useSoilTempGate || planner.soilGateOK(gateDate)) return d;
        }
        return null;
    }
    function classifyIsThermal(reason) {
        if (!reason) return false;
        return reason.indexOf('harvest_too_cold') === 0 ||
            reason.indexOf('harvest_too_hot') === 0 ||
            reason === 'insufficient_gdd';
    }
    function impliedHarvestEndForDate(planner, sow, HW_DAYS) {
        const C = planner.ctx;
        const mat = maturityDateFromBudget(sow, C.BUDGET, C.dailyRates, C.scanEndHard);
        return planner.addDays(mat, Math.max(0, HW_DAYS || 0));
    }
    function computeStageDatesForPlanting({ sowDate, budget, stageDays, dailyRatesMap, seasonEnd, planningMode }) {
        const maturity = maturityDateFromBudget(sowDate, budget, dailyRatesMap, seasonEnd);
        const harvestDays = resolveHarvestWindowDays(stageDays.harvest_window_days);
        const harvestStart = maturity;
        const harvestEnd = addDaysUTC(maturity, harvestDays);
        const rawGerminationDays = stageDays.germinationDays ?? stageDays.days_germ;
        const germinationDays = finiteNumberOrNull(rawGerminationDays);
        const germ = germinationDays != null && germinationDays >= 0
            ? addDaysUTC(sowDate, Math.round(germinationDays))
            : null;
        let transplant = null;
        if (planningMode === 'transplant_outdoor') {
            transplant = new Date(sowDate);
        } else if (planningMode === 'transplant_indoor') {
            const daysToTransplant = Number(stageDays.transplantDays);
            transplant = Number.isFinite(daysToTransplant) && daysToTransplant > 0
                ? addDaysUTC(sowDate, Math.round(daysToTransplant))
                : new Date(sowDate);
        }
        return { sow: sowDate, germ, transplant, maturity, harvestStart, harvestEnd };
    }
    function computeStageTimelineForSchedule({ schedule, budget, stageDays, dailyRatesMap, seasonEnd, planningMode }) {
        if (!budget || !Number.isFinite(budget.amount) || budget.amount <= 0) {
            throw new Error('Invalid maturity budget');
        }
        return (schedule || []).map(sow =>
            computeStageDatesForPlanting({ sowDate: sow, budget, stageDays, dailyRatesMap, seasonEnd, planningMode })
        );
    }
    function buildAutoWindowPlanner(params) {
        const {
            methodId, methodCategoryId, budget, HW_DAYS,
            dailyRatesMap, monthlyAvgTemp, Tbase, cropTemp,
            scanStart, scanEndHard,
            soilGateThresholdC, soilGateConsecutiveDays,
            startCoolingThresholdC,
            useSpringFrostGate,
            lastSpringFrostDOY,
            daysTransplant,
            overwinterAllowed,
            bedProfile = null,
            bedProfileSource = 'generic garden bed'
        } = params;

        const resolvedBehavior = resolveMethodBehavior({ methodCategoryId, methodId });
        validateAutoWindowMethodInputs({ resolvedBehavior, daysTransplant });
        const fakePlant = {
            start_cooling_threshold_c: startCoolingThresholdC,
            soil_temp_min_plant_c: soilGateThresholdC,
            isPerennial: () => false,
            isBiennial: () => false,
            overwinter_ok: overwinterAllowed ? 1 : 0,
            days_transplant: daysTransplant,
            cropTempEnvelope: () => cropTemp,
            firstHarvestBudget: () => budget
        };
        const fakeCity = {
            dailyRates: (_tbase, _year) => dailyRatesMap,
            monthlyMeans: () => monthlyAvgTemp,
            last_spring_frost_p50_doy: lastSpringFrostDOY,
            last_spring_frost_doy: lastSpringFrostDOY
        };
        const policy = new PolicyFlags({
            useSoilTempGate: Number.isFinite(soilGateThresholdC) && resolvedBehavior.usesSoilTempGate,
            soilGateThresholdC,
            soilGateConsecutiveDays,
            overwinterAllowed,
            useSpringFrostGate: !!useSpringFrostGate,
            springFrostRisk: 'p50'
        });
        const inputs = new ScheduleInputs({
            plant: fakePlant,
            city: fakeCity,
            planningMode: resolvedBehavior.planningMode,
            methodCategoryId: resolvedBehavior.methodCategoryId,
            methodId: resolvedBehavior.methodId,
            startISO: scanStart.toISOString().slice(0, 10),
            seasonEndISO: scanEndHard.toISOString().slice(0, 10),
            policy,
            seasonStartYear: scanStart.getUTCFullYear(),
            harvestWindowDays: HW_DAYS,
            bedProfile,
            bedProfileSource
        });
        const planner = new Planner(inputs);
        return { planner, ctx: planner.ctx, resolvedBehavior };
    }
    function computeAutoStartEndWindowForward(params) {
        const {
            methodId, methodCategoryId, budget, HW_DAYS,
            dailyRatesMap, monthlyAvgTemp, Tbase, cropTemp,
            scanStart, scanEndHard,
            soilGateThresholdC = null, soilGateConsecutiveDays = 3,
            startCoolingThresholdC = null,
            useSpringFrostGate = false,
            lastSpringFrostDOY = null,
            daysTransplant = 0,
            overwinterAllowed = false,
            bedProfile = null,
            bedProfileSource = 'generic garden bed'
        } = params;

        const resolvedHarvestWindowDays = resolveHarvestWindowDays(HW_DAYS);
        const { planner, resolvedBehavior } = buildAutoWindowPlanner({
            methodId, methodCategoryId, budget, HW_DAYS: resolvedHarvestWindowDays,
            dailyRatesMap, monthlyAvgTemp, Tbase, cropTemp,
            scanStart, scanEndHard,
            soilGateThresholdC, soilGateConsecutiveDays,
            startCoolingThresholdC,
            useSpringFrostGate,
            lastSpringFrostDOY,
            daysTransplant,
            overwinterAllowed,
            bedProfile,
            bedProfileSource
        });
        const C = planner.ctx;
        const planningMode = resolvedBehavior.planningMode;
        const sowScanEnd = overwinterAllowed ? asUTCDate(C.scanStart.getUTCFullYear(), 12, 31) : C.scanEndHard;
        let fieldGateStart = new Date(C.scanStart);
        if (useSpringFrostGate && Number.isFinite(lastSpringFrostDOY)) {
            const frostDate = dateFromDOY(C.scanStart.getUTCFullYear(), lastSpringFrostDOY);
            if (frostDate > fieldGateStart) fieldGateStart = frostDate;
        }
        if (overwinterAllowed && Number.isFinite(startCoolingThresholdC)) { // FIX: annual heat thresholds are not fall gates
            const cross = firstCoolingCrossingDate({ thresholdC: startCoolingThresholdC, monthlyAvgTemp, scanStart: C.scanStart, scanEndHard: C.scanEndHard });
            if (cross && cross > fieldGateStart) fieldGateStart = cross;
        }
        let sowCandidate = new Date(fieldGateStart);
        if (resolvedBehavior.leadDaysMode === "days_transplant") {
            const dt = Math.max(0, Math.round(Number(daysTransplant) || 0));
            const indoorSow = planner.addDays(fieldGateStart, -dt);
            sowCandidate = indoorSow < C.scanStart ? new Date(C.scanStart) : indoorSow;
        } else {
            sowCandidate = fieldGateStart;
        }
        const firstNonSoil = resolvedBehavior.usesSoilTempGate ? (firstNonSoilStart(planner, sowCandidate) || sowCandidate) : sowCandidate;
        let firstOkSow = null;
        let firstOkHarvestStart = null;
        let firstOkHarvestEnd = null;
        let lastOkHarvestEnd = null;
        let lastThermalHarvestEnd = null;
        let lastOkSow = null;

        for (let d = new Date(firstNonSoil); d <= sowScanEnd; d = planner.addDays(d, 1)) {
            const r = planner.isSowFeasible(d);
            if (r.ok) {
                if (!firstOkSow) {
                    firstOkSow = new Date(d);
                    firstOkHarvestStart = r.harvestStart;
                    firstOkHarvestEnd = r.harvestEnd;
                }
                lastOkSow = new Date(d);
                const hEnd = r.harvestEnd;
                if (!lastOkHarvestEnd || hEnd > lastOkHarvestEnd) lastOkHarvestEnd = hEnd;
            } else {
                const isThermal = classifyIsThermal(r.reason) || r.reason === 'cross_year_disallowed' || r.reason === 'beyond_hard_end';
                if (isThermal) {
                    let hEnd = impliedHarvestEndForDate(planner, d, resolvedHarvestWindowDays);
                    if (hEnd > C.scanEndHard) hEnd = new Date(C.scanEndHard);
                    if (!lastThermalHarvestEnd || hEnd > lastThermalHarvestEnd) lastThermalHarvestEnd = hEnd;
                }
            }
        }
        if (!firstOkSow) {
            return {
                feasible: false,
                harvestEndSemantics: HARVEST_END_SEMANTICS,
                earliestFeasibleSowDate: null,
                earliestHarvestStartDate: null,
                earliestHarvestEndDate: null,
                lastFeasibleSowDate: null,
                climateEndDate: null
            };
        }
        const earliestFeasibleSow = firstOkSow;
        const lastFeasibleSow = lastOkSow;
        const earliestHarvestStartDate = firstOkHarvestStart || null;
        const earliestHarvestEndDate = firstOkHarvestEnd || earliestFeasibleSow;
        const climateEndDate = overwinterAllowed
            ? (lastOkHarvestEnd || earliestHarvestEndDate || lastThermalHarvestEnd || new Date(C.scanEndHard))
            : (lastOkHarvestEnd || lastThermalHarvestEnd || earliestHarvestEndDate || new Date(C.scanEndHard));
        return {
            feasible: true,
            harvestEndSemantics: HARVEST_END_SEMANTICS,
            earliestFeasibleSowDate: earliestFeasibleSow,
            earliestHarvestStartDate,
            earliestHarvestEndDate,
            lastFeasibleSowDate: lastFeasibleSow,
            climateEndDate
        };
    }
    function computeAnnualScheduleResult(inputs) {
        const { plant, methodId } = inputs;
        const method = methodId;
        const startDate = parseISODateUTCValue(inputs.startISO);
        if (!startDate) throw new Error('Select a planting date.');
        const { seasonEnd, env, dailyRates } = inputs.derived();
        const planner = new Planner(inputs);
        const feasibility = planner.isSowFeasible(startDate);
        if (!feasibility.ok) {
            throw new Error(`Selected sow date is not feasible: ${humanFeasibilityReason(feasibility.reason)}`);
        }
        const budget = plant.firstHarvestBudget();
        if (!budget || !Number.isFinite(budget.amount) || budget.amount <= 0) {
            throw new Error("Invalid maturity budget for " + plant.plant_name);
        }
        const schedule = [startDate];
        const stageDays = {
            maturityDays: Number.isFinite(Number(plant.days_maturity)) && Number(plant.days_maturity) > 0
                ? Number(plant.days_maturity)
                : (budget.mode === "days" ? Number(budget.amount) : 0),
            transplantDays: Number.isFinite(Number(plant.days_transplant)) ? Number(plant.days_transplant) : 0,
            germinationDays: finiteNumberOrNull(plant.days_germ),
            harvest_window_days: resolveHarvestWindowDays(inputs.harvestWindowDays, plant)
        };
        const timelines = computeStageTimelineForSchedule({
            schedule,
            budget,
            stageDays,
            dailyRatesMap: dailyRates,
            seasonEnd,
            planningMode: inputs.planningMode
        });
        const authoritativeTimeline = timelines[0];
        authoritativeTimeline.maturity = new Date(feasibility.maturity);
        authoritativeTimeline.harvestStart = new Date(feasibility.harvestStart);
        authoritativeTimeline.harvestEnd = new Date(feasibility.harvestEnd);
        const yieldMultipliers = [thermalYieldFactor(feasibility.TmeanHarvest, env)];
        const minYieldMultiplier = finiteNumberOrNull(inputs.minYieldMultiplier) ?? 0;
        if (yieldMultipliers[0] < minYieldMultiplier) {
            throw new Error(
                `Selected sow date yield multiplier ${yieldMultipliers[0].toFixed(2)} ` +
                `is below the minimum ${minYieldMultiplier.toFixed(2)}.`
            );
        }
        const rows = schedule.map((sowDate, idx) => {
            const tl = timelines[idx] || {};
            const mult = Number.isFinite(Number(yieldMultipliers[idx])) ? Number(yieldMultipliers[idx]) : 1;
            return {
                plant: plant.plant_name,
                method,
                sow: fmtISO(sowDate),
                germ: fmtISO(tl.germ),
                trans: fmtISO(tl.transplant),
                harvStart: fmtISO(tl.harvestStart),
                harvEnd: fmtISO(tl.harvestEnd),
                mult: mult.toFixed(2),
                plantsReq: ""
            };
        });
        return {
            kind: 'annual',
            harvestEndSemantics: HARVEST_END_SEMANTICS,
            plant,
            method,
            schedule,
            timelines,
            rows,
            firstScheduledHarvestISO: timelines[0]?.harvestStart ? fmtISO(timelines[0].harvestStart) : null,
            lastScheduledHarvestEndISO: timelines.length ? fmtISO(timelines[timelines.length - 1]?.harvestEnd) : null
        };
    }

    win.USL.scheduler.annualCore = Object.freeze({
        Planner,
        accumulateGDDUntil,
        accumulateGDDBackward,
        maturityDateFromBudget,
        thermalYieldFactor,
        weightedMeanTempOverRange,
        firstCoolingCrossingDate,
        getGateDateForCandidate,
        firstNonSoilStart,
        computeStageDatesForPlanting,
        computeStageTimelineForSchedule,
        classifyIsThermal,
        impliedHarvestEndForDate,
        buildAutoWindowPlanner,
        computeAutoStartEndWindowForward,
        computeAnnualScheduleResult
    });
})(typeof window !== 'undefined' ? window : globalThis);
