// USL Draw.io Plugin Module: Garden Scheduler shared pure helpers. // ADDED
(function (root) {
    'use strict';

    const win = root || {};
    win.USL = win.USL || {};
    win.USL.scheduler = win.USL.scheduler || {};

    const DEFAULT_HARVEST_WINDOW_DAYS = 7;
    const HARVEST_END_SEMANTICS = 'exclusive';

    function daysInMonth(year, month) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }
    function addDaysUTC(d, days) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days)); }
    function asUTCDate(y, m, d) { return new Date(Date.UTC(y, m - 1, d)); }
    function dateLTE(d1, d2) {
        return d1.getUTCFullYear() < d2.getUTCFullYear() ||
            (d1.getUTCFullYear() === d2.getUTCFullYear() && (
                d1.getUTCMonth() < d2.getUTCMonth() ||
                (d1.getUTCMonth() === d2.getUTCMonth() && d1.getUTCDate() <= d2.getUTCDate())
            ));
    }
    function fmtISO(d) { return d ? d.toISOString().slice(0, 10) : ''; }
    function iso(d) { return d ? d.toISOString().slice(0, 10) : null; }
    function shiftDays(isoStr, days) {
        if (!isoStr) return null;
        const d = new Date(isoStr + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + days);
        return iso(d);
    }
    function dayOfYear(d) {
        const start = Date.UTC(d.getUTCFullYear(), 0, 1);
        const ms = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - start;
        return Math.floor(ms / 86400000) + 1;
    }
    function finiteNumberOrNull(value) {
        if (value === null || value === undefined || value === '') return null;
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }
    function monthlyMeanOnDate(date, monthlyAvgTemp) {
        const year = date.getUTCFullYear();
        const month = date.getUTCMonth() + 1;
        const curMean = finiteNumberOrNull(monthlyAvgTemp?.[month]);
        if (curMean == null) return null;
        const curCenter = Date.UTC(year, month - 1, 15);
        const nextMonth = month === 12 ? 1 : month + 1;
        const prevMonth = month === 1 ? 12 : month - 1;
        const nextYear = month === 12 ? year + 1 : year;
        const prevYear = month === 1 ? year - 1 : year;
        const nextMean = finiteNumberOrNull(monthlyAvgTemp?.[nextMonth]);
        const prevMean = finiteNumberOrNull(monthlyAvgTemp?.[prevMonth]);
        const target = Date.UTC(year, month - 1, date.getUTCDate());
        if (target >= curCenter && nextMean != null) {
            const nextCenter = Date.UTC(nextYear, nextMonth - 1, 15);
            const ratio = (target - curCenter) / Math.max(1, nextCenter - curCenter);
            return curMean + (nextMean - curMean) * Math.max(0, Math.min(1, ratio));
        }
        if (target < curCenter && prevMean != null) {
            const prevCenter = Date.UTC(prevYear, prevMonth - 1, 15);
            const ratio = (target - prevCenter) / Math.max(1, curCenter - prevCenter);
            return prevMean + (curMean - prevMean) * Math.max(0, Math.min(1, ratio));
        }
        return curMean;
    }
    function normalizeBedProfile(profile) {
        const source = profile && typeof profile === 'object' ? profile : {};
        const pick = (key, fallback) => String(source[key] || fallback || 'unknown').trim() || 'unknown';
        return {
            sunExposure: pick('sunExposure', 'full_sun'),
            soilMoisture: pick('soilMoisture', 'moderate'),
            drainage: pick('drainage', 'normal'),
            soilTexture: pick('soilTexture', 'loamy'),
            windExposure: pick('windExposure', 'moderate'),
            frostRisk: pick('frostRisk', 'low')
        };
    }
    function bedSoilTemperatureOffsetC(profile) {
        const bed = normalizeBedProfile(profile);
        let offset = 3.0; // ADDED: generic open vegetable beds warm faster than monthly city-air means.
        const add = (value) => { offset += value; };
        if (bed.sunExposure === 'full_sun') add(0.4);
        else if (bed.sunExposure === 'part_sun') add(0.1);
        else if (bed.sunExposure === 'part_shade') add(-0.9);
        else if (bed.sunExposure === 'shade') add(-1.8);
        if (bed.soilMoisture === 'dry') add(0.4);
        else if (bed.soilMoisture === 'moist') add(-0.5);
        else if (bed.soilMoisture === 'wet') add(-1.0);
        if (bed.drainage === 'fast') add(0.3);
        else if (bed.drainage === 'slow') add(-0.6);
        if (bed.soilTexture === 'sandy' || bed.soilTexture === 'amended') add(0.4);
        else if (bed.soilTexture === 'clay') add(-0.5);
        if (bed.windExposure === 'sheltered') add(0.2);
        else if (bed.windExposure === 'exposed') add(-0.5);
        if (bed.frostRisk === 'none') add(0.2);
        else if (bed.frostRisk === 'medium') add(-0.3);
        else if (bed.frostRisk === 'high') add(-0.7);
        return Math.max(-1.5, Math.min(5.0, offset));
    }
    function estimateSoilTempC(date, monthlyAvgTemp, bedProfile = null) {
        const air = monthlyMeanOnDate(date, monthlyAvgTemp);
        if (air == null) return null;
        return air + bedSoilTemperatureOffsetC(bedProfile); // ADDED: bed-aware soil estimate replaces fixed lagged-air heuristic.
    }
    function firstSoilReadyDate({ thresholdC, monthlyAvgTemp, scanStart, scanEndHard, bedProfile = null, consecutiveDays = 3 }) {
        const threshold = finiteNumberOrNull(thresholdC);
        if (threshold == null) return null;
        const days = Math.max(1, Math.round(Number(consecutiveDays) || 1));
        for (let d = new Date(scanStart); d <= scanEndHard; d = addDaysUTC(d, 1)) {
            let ok = true;
            for (let i = 0; i < days; i++) {
                const sample = addDaysUTC(d, i);
                if (sample > scanEndHard) { ok = false; break; }
                const soil = estimateSoilTempC(sample, monthlyAvgTemp, bedProfile);
                if (soil == null || soil < threshold) { ok = false; break; }
            }
            if (ok) return d;
        }
        return null;
    }
    function annualGddFromMonthlyMeans(monthlyAvgTemp, tbase, year, tempOffsetC = 0) {
        const base = Number(tbase);
        if (!Number.isFinite(base)) return null;
        let total = 0;
        for (let m = 1; m <= 12; m++) {
            const mean = finiteNumberOrNull(monthlyAvgTemp?.[m]);
            if (mean == null) continue;
            total += Math.max(0, mean + Number(tempOffsetC || 0) - base) * daysInMonth(year, m);
        }
        return total;
    }
    function solveGddTemperatureOffset({ monthlyAvgTemp, targetGdd, gddBaseC, year }) {
        const target = finiteNumberOrNull(targetGdd);
        const base = finiteNumberOrNull(gddBaseC);
        if (target == null || target <= 0 || base == null) {
            return { usable: false, offsetC: 0, targetGdd: target, gddBaseC: base, uncalibratedGdd: null, calibratedGdd: null };
        }
        const uncalibrated = annualGddFromMonthlyMeans(monthlyAvgTemp, base, year, 0);
        if (uncalibrated == null) {
            return { usable: false, offsetC: 0, targetGdd: target, gddBaseC: base, uncalibratedGdd: null, calibratedGdd: null };
        }
        let lo = -15;
        let hi = 15;
        for (let i = 0; i < 50; i++) {
            const mid = (lo + hi) / 2;
            const gdd = annualGddFromMonthlyMeans(monthlyAvgTemp, base, year, mid);
            if (gdd < target) lo = mid;
            else hi = mid;
        }
        const offset = (lo + hi) / 2;
        return {
            usable: true,
            offsetC: offset,
            targetGdd: target,
            gddBaseC: base,
            uncalibratedGdd: uncalibrated,
            calibratedGdd: annualGddFromMonthlyMeans(monthlyAvgTemp, base, year, offset)
        };
    }
    function applyTemperatureOffsetToMonthlyMeans(monthlyAvgTemp, offsetC = 0) {
        const out = {};
        for (let m = 1; m <= 12; m++) {
            const mean = finiteNumberOrNull(monthlyAvgTemp?.[m]);
            if (mean != null) out[m] = mean + Number(offsetC || 0);
        }
        return out;
    }
    function normId(value) {
        return String(value ?? '').trim().toLowerCase();
    }
    function parseISODateUTCValue(value) {
        const s = String(value ?? '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
        const d = new Date(s + 'T00:00:00Z');
        return Number.isNaN(d.getTime()) ? null : d;
    }
    function resolveStartAfterWindow({
        currentStartISO,
        autoStartISO,
        feasible,
        forceWriteStart,
        hasPersistedSchedule,
        userEditedStartThisSession
    }) {
        const preserveGenuineStart = !!hasPersistedSchedule || !!userEditedStartThisSession;
        if (feasible && (forceWriteStart || !preserveGenuineStart)) return String(autoStartISO || '');
        if (!feasible && !preserveGenuineStart) return '';
        return String(currentStartISO || '');
    }
    function resolveHarvestWindowDays(explicitValue, plant = null) {
        const explicitDays = finiteNumberOrNull(explicitValue);
        if (explicitDays != null && explicitDays >= 0) return Math.round(explicitDays);

        const plantDays = finiteNumberOrNull(plant?.harvest_window_days);
        if (plantDays != null && plantDays >= 0) return Math.round(plantDays);

        return Math.round(Math.max(0, DEFAULT_HARVEST_WINDOW_DAYS));
    }
    function isPerennialPlant(plant) {
        return !!(plant && typeof plant.isPerennial === 'function' && plant.isPerennial());
    }
    function requirePerennialLifespanYears(plant) {
        const lifespanYears = finiteNumberOrNull(plant?.lifespan_years);
        if (lifespanYears == null || lifespanYears < 1) {
            throw new Error(`Perennial "${plant?.plant_name || 'plant'}" requires lifespan_years >= 1.`);
        }
        return Math.floor(lifespanYears);
    }
    function computePerennialLifespanEndISO(fromISO, seasonStartYear, lifespanYears) {
        const start = parseISODateUTCValue(fromISO) || asUTCDate(Number(seasonStartYear), 1, 1);
        const years = Math.max(1, Math.floor(Number(lifespanYears) || 0));
        return asUTCDate(start.getUTCFullYear() + years, 12, 31).toISOString().slice(0, 10);
    }
    async function runUiAsyncOperation(label, fn, onError) {
        try {
            return await fn();
        } catch (e) {
            if (typeof onError === 'function') onError(`${label}: ${e?.message || String(e)}`, e);
            return null;
        }
    }
    function pickFrostByRisk(city, risk = 'p50') {
        const p90 = finiteNumberOrNull(city?.last_spring_frost_p90_doy);
        const p50 = finiteNumberOrNull(city?.last_spring_frost_p50_doy);
        const p10 = finiteNumberOrNull(city?.last_spring_frost_p10_doy);
        const plain = finiteNumberOrNull(city?.last_spring_frost_doy);
        if (risk === 'p90') return p90 ?? p50 ?? plain ?? 1;
        if (risk === 'p10') return p10 ?? p50 ?? plain ?? 1;
        return p50 ?? plain ?? p90 ?? p10 ?? 1;
    }
    function isCrossYearCrop(plant) {
        if (!plant) return false;
        const perennial = typeof plant.isPerennial === 'function' && plant.isPerennial();
        const biennial = typeof plant.isBiennial === 'function' && plant.isBiennial();
        return perennial || biennial || Number(plant.overwinter_ok ?? 0) === 1;
    }
    function getPlantScanYears(plant) {
        if (plant.isPerennial()) {
            const lifespan = Number(plant.lifespan_years);
            if (!Number.isFinite(lifespan) || lifespan < 1) {
                throw new Error('Perennial requires lifespan_years in DB.');
            }
            return Math.floor(lifespan);
        }

        if (plant.isBiennial()) {
            const lifespan = Number(plant.lifespan_years);
            if (!Number.isFinite(lifespan) || lifespan < 2) {
                throw new Error('Biennial requires lifespan_years >= 2 in DB.');
            }
            return Math.floor(lifespan);
        }

        return 1 + (Number(plant.overwinter_ok) === 1 ? 1 : 0);
    }
    function asCoolingThresholdC(v) {
        if (v === null || v === undefined || v === '') return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }
    function coolingGateThresholdC(plant) {
        if (!isCrossYearCrop(plant)) return null; // FIX: heat-stress metadata must not force annual fall-only scheduling
        return asCoolingThresholdC(plant?.start_cooling_threshold_c); // FIX
    }
    function dateFromDOY(year, doy) {
        const d0 = Date.UTC(year, 0, 1);
        return new Date(d0 + (Math.max(1, Math.floor(doy)) - 1) * 86400000);
    }

    class PolicyFlags {
        constructor({
            useSpringFrostGate = true,
            springFrostRisk = 'p50',
            useSoilTempGate = false,
            soilGateThresholdC = null,
            soilGateConsecutiveDays = 3,
            overwinterAllowed = false
        } = {}) {
            this.overwinterAllowed = !!overwinterAllowed;
            this.useSpringFrostGate = !!useSpringFrostGate;
            this.springFrostRisk = springFrostRisk;
            const thr = Number(soilGateThresholdC);
            this.soilGateThresholdC = Number.isFinite(thr) ? thr : null;
            this.useSoilTempGate = !!useSoilTempGate && this.soilGateThresholdC != null;
            this.soilGateConsecutiveDays = Math.max(1, Number(soilGateConsecutiveDays ?? 3));
            Object.freeze(this);
        }

        static fromResolvedBehavior(plant, resolvedBehavior) {
            const threshold = finiteNumberOrNull(plant?.soil_temp_min_plant_c);
            const overwinterAllowed = isCrossYearCrop(plant);
            return new PolicyFlags({
                useSpringFrostGate: true,
                springFrostRisk: 'p50',
                useSoilTempGate: !!resolvedBehavior?.usesSoilTempGate && threshold != null,
                soilGateThresholdC: threshold,
                soilGateConsecutiveDays: 3,
                overwinterAllowed
            });
        }
    }

    class ScheduleInputs {
        constructor({
            plant,
            city,
            planningMode,
            methodCategoryId = "",
            methodId = "",
            startISO,
            seasonEndISO,
            policy,
            seasonStartYear,
            harvestWindowDays,
            minYieldMultiplier = 0,
            varietyId = null,
            varietyName = '',
            bedProfile = null,
            bedProfileSource = 'generic garden bed'
        }) {
            Object.assign(this, {
                plant,
                city,
                planningMode,
                methodCategoryId: normId(methodCategoryId),
                methodId: normId(methodId),
                startISO,
                seasonEndISO,
                policy,
                seasonStartYear: Number(seasonStartYear),
                harvestWindowDays: (harvestWindowDays == null ? null : Number(harvestWindowDays)),
                minYieldMultiplier: Number(minYieldMultiplier),
                varietyId: (varietyId != null ? Number(varietyId) : null),
                varietyName: String(varietyName || ''),
                bedProfile: normalizeBedProfile(bedProfile), // ADDED: carry bed conditions into soil-temperature gates.
                bedProfileSource: String(bedProfileSource || 'generic garden bed') // ADDED
            });
            Object.freeze(this);
        }

        derived() {
            const startDate = new Date(this.startISO + 'T00:00:00Z');
            const seasonEnd = new Date(this.seasonEndISO + 'T00:00:00Z');
            const env = this.plant.cropTempEnvelope();
            const scanYears = getPlantScanYears(this.plant);
            const scanStart = asUTCDate(this.seasonStartYear, 1, 1);
            const scanEndHard = asUTCDate(this.seasonStartYear + scanYears - 1, 12, 31);
            const year = scanStart.getUTCFullYear();
            const dailyRates = this.city.dailyRates(env.Tbase, year);
            const monthlyAvg = typeof this.city.calibratedMonthlyMeans === 'function'
                ? this.city.calibratedMonthlyMeans(year)
                : this.city.monthlyMeans(); // ADDED: use annual-GDD calibrated heat curve when city supports it.
            return { startDate, seasonEnd, year, env, dailyRates, monthlyAvg, scanStart, scanEndHard };
        }
    }

    const METHOD_BEHAVIOR = Object.freeze({
        "transplant.indoor": Object.freeze({ methodCategoryId: "transplant", planningMode: "transplant_indoor", usesSoilTempGate: true, leadDaysMode: "days_transplant" }),
        "transplant.outdoor": Object.freeze({ methodCategoryId: "transplant", planningMode: "transplant_outdoor", usesSoilTempGate: true, leadDaysMode: "none" }),
        "transplant.purchased": Object.freeze({ methodCategoryId: "transplant", planningMode: "transplant_outdoor", usesSoilTempGate: true, leadDaysMode: "none" }),
        "transplant.cutting": Object.freeze({ methodCategoryId: "transplant", planningMode: "transplant_indoor", usesSoilTempGate: true, leadDaysMode: "days_transplant" }),
        "direct_sow.field": Object.freeze({ methodCategoryId: "direct_sow", planningMode: "direct_sow", usesSoilTempGate: true, leadDaysMode: "none" }),
        "direct_sow.pre_germinated": Object.freeze({ methodCategoryId: "direct_sow", planningMode: "direct_sow", usesSoilTempGate: true, leadDaysMode: "none" }),
        "direct_sow.plug": Object.freeze({ methodCategoryId: "direct_sow", planningMode: "transplant_outdoor", usesSoilTempGate: true, leadDaysMode: "none" })
    });

    function resolveMethodBehavior({ methodCategoryId, methodId }) {
        const category = normId(methodCategoryId);
        const id = normId(methodId);
        if (!category) throw new Error("methodCategoryId is required.");
        if (!id) throw new Error("methodId is required.");
        const behavior = METHOD_BEHAVIOR[id];
        if (!behavior) throw new Error(`Unsupported methodId: ${id}`);
        if (behavior.methodCategoryId !== category) {
            throw new Error(`methodId "${id}" does not belong to methodCategoryId "${category}".`);
        }
        if (!id.startsWith(category + ".")) {
            throw new Error(`methodId "${id}" must begin with "${category}."`);
        }
        return {
            methodCategoryId: category,
            methodId: id,
            planningMode: behavior.planningMode,
            usesSoilTempGate: !!behavior.usesSoilTempGate,
            leadDaysMode: String(behavior.leadDaysMode || "none")
        };
    }
    function resolveValidMethodRecord(methodRow, fallbackMethodCategoryId = '') {
        const methodCategoryId = normId(methodRow?.method_category_id ?? fallbackMethodCategoryId ?? '');
        const methodId = normId(methodRow?.method_id);
        return resolveMethodBehavior({ methodCategoryId, methodId });
    }
    function validateAutoWindowMethodInputs({ resolvedBehavior, daysTransplant }) {
        if (!resolvedBehavior || typeof resolvedBehavior !== "object") {
            throw new Error("resolvedBehavior is required.");
        }
        if (resolvedBehavior.leadDaysMode === "days_transplant") {
            const dt = Number(daysTransplant);
            if (!Number.isFinite(dt) || dt <= 0) {
                throw new Error(`methodId "${resolvedBehavior.methodId}" requires daysTransplant > 0.`);
            }
        }
    }
    function humanFeasibilityReason(reason) {
        const raw = String(reason || '').trim();
        if (!raw || raw === 'ok') return 'Feasible';
        if (raw === 'outside_scan_window') return 'The selected date is outside the planning season.';
        if (raw === 'gate_outside_scan_window') return 'The planting or transplant date falls outside the planning season.';
        if (raw.indexOf('spring_frost_gate') === 0) return 'The planting date is before the frost-safety date.';
        if (raw === 'cooling_gate') return 'The crop requires a later seasonal cooling trigger.';
        if (raw === 'soil_gate_missing_date') return 'A soil-temperature check could not be evaluated.';
        if (raw === 'soil_gate') return 'The soil is expected to be too cold on this date.';
        if (raw === 'insufficient_gdd') return 'There is not enough growing-degree accumulation to reach maturity.';
        if (raw === 'cross_year_disallowed') return 'This planting would extend into another year.';
        if (raw === 'beyond_hard_end') return 'There is not enough season remaining for the harvest window.';
        if (raw.indexOf('harvest_too_cold') === 0) return 'Expected harvest temperatures are too cold.';
        if (raw.indexOf('harvest_too_hot') === 0) return 'Expected harvest temperatures are too hot.';
        if (raw.indexOf('error:') === 0) return raw.slice(6).trim() || 'The feasibility check failed.';
        return raw.replace(/_/g, ' ');
    }
    function classifySelectedSowDate({
        perennial = false,
        windowFeasible = false,
        startISO = '',
        earliestISO = '',
        latestISO = ''
    } = {}) {
        if (perennial) return { status: 'not_applicable', label: 'Not applicable for perennial planting dates.' };
        if (!windowFeasible) return { status: 'no_window', label: 'No feasible sowing window is available.' };
        const selected = parseISODateUTCValue(startISO);
        if (!selected) return { status: 'missing', label: 'Select a sow date.' };
        const earliest = parseISODateUTCValue(earliestISO);
        const latest = parseISODateUTCValue(latestISO);
        if (earliest && selected < earliest) return { status: 'early', label: 'The selected sow date is earlier than the feasible window.' };
        if (latest && selected > latest) return { status: 'late', label: 'The selected sow date is later than the feasible window.' };
        return { status: 'feasible', label: 'The selected sow date is feasible.' };
    }
    function buildScheduleViewState({
        perennial = false,
        windowFeasible = false,
        plantName = '',
        varietyName = '',
        cityName = '',
        seasonStartYear = '',
        methodName = '',
        startISO = '',
        earliestISO = '',
        latestISO = '',
        firstHarvestISO = '',
        lastHarvestISO = ''
    } = {}) {
        const feasibility = classifySelectedSowDate({ perennial, windowFeasible, startISO, earliestISO, latestISO });
        return {
            crop: [plantName, varietyName].filter(Boolean).join(' / ') || '(none)',
            context: [cityName, seasonStartYear].filter(value => String(value || '').trim()).join(' / ') || '(none)',
            method: methodName || '(none)',
            selectedDate: startISO || '(not selected)',
            firstHarvest: perennial ? 'Not calculated for perennial schedules' : (firstHarvestISO || '(not available)'),
            harvestEnd: perennial ? 'Not calculated for perennial schedules' : (lastHarvestISO || '(not available)'),
            feasibility
        };
    }

    win.USL.scheduler.sharedCore = Object.freeze({
        DEFAULT_HARVEST_WINDOW_DAYS,
        HARVEST_END_SEMANTICS,
        daysInMonth,
        addDaysUTC,
        asUTCDate,
        dateLTE,
        fmtISO,
        iso,
        shiftDays,
        dayOfYear,
        finiteNumberOrNull,
        monthlyMeanOnDate,
        normalizeBedProfile,
        bedSoilTemperatureOffsetC,
        estimateSoilTempC,
        firstSoilReadyDate,
        annualGddFromMonthlyMeans,
        solveGddTemperatureOffset,
        applyTemperatureOffsetToMonthlyMeans,
        normId,
        parseISODateUTCValue,
        resolveStartAfterWindow,
        resolveHarvestWindowDays,
        isPerennialPlant,
        requirePerennialLifespanYears,
        computePerennialLifespanEndISO,
        runUiAsyncOperation,
        pickFrostByRisk,
        isCrossYearCrop,
        getPlantScanYears,
        asCoolingThresholdC,
        coolingGateThresholdC,
        dateFromDOY,
        PolicyFlags,
        ScheduleInputs,
        METHOD_BEHAVIOR,
        resolveMethodBehavior,
        resolveValidMethodRecord,
        validateAutoWindowMethodInputs,
        humanFeasibilityReason,
        classifySelectedSowDate,
        buildScheduleViewState
    });
})(typeof window !== 'undefined' ? window : globalThis);
