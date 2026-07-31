// USL Draw.io Plugin Module: Garden Scheduler annual pure planning core.
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
        dayOfYear,
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
        bedFrostGateShiftDays,
        bedAdjustedTemperatureRecordOnDate,
        bedAdjustedMeanTemperatureOnDate,
        buildDailyTemperatureSeries,
        gddRateForDate,
        meanTemperatureOnDate,
        resolveMethodBehavior,
        validateAutoWindowMethodInputs,
        humanFeasibilityReason
    } = shared;

    const MULTI_WINDOW_MAX_MERGE_GAP_DAYS = 7;
    const MULTI_WINDOW_MIN_LENGTH_DAYS = 3;
    const DIAGNOSTIC_POLICIES = Object.freeze(new Set(['off', 'warn', 'block']));
    const THERMAL_GDD_SCALE_CAP = 2;
    const KILL_TEMP_ESTIMATE_BUFFER_C = 3;

    function monthMeanAt(date, monthlyAvgTemp) {
        return monthlyAvgTemp?.[date.getUTCMonth() + 1] ?? null;
    }
    function clampNumber(value, min, max) {
        if (value == null || value === '') return null;
        const n = Number(value);
        if (!Number.isFinite(n)) return null;
        return Math.max(min, Math.min(max, n));
    }
    function normalizeDiagnosticPolicy(value, fallback = 'warn') {
        const raw = String(value || fallback || 'warn').trim().toLowerCase();
        return DIAGNOSTIC_POLICIES.has(raw) ? raw : fallback;
    }
    function numberOrNull(value) {
        if (value == null || value === '') return null;
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }
    function policyForFactor(plant, factor, fallback = 'warn') {
        const direct = plant?.[`${factor}_policy`];
        if (direct != null && String(direct).trim() !== '') return normalizeDiagnosticPolicy(direct, fallback);
        const generic = plant?.diagnostic_policy;
        if (generic != null && String(generic).trim() !== '') return normalizeDiagnosticPolicy(generic, fallback);
        return fallback;
    }
    function diagnosticLabel(diagnostic) {
        const factor = String(diagnostic?.factor || '').trim();
        const severity = String(diagnostic?.severity || '').trim();
        if (factor === 'photoperiod' && severity === 'info') return 'Photoperiod data missing';
        const factorLabel = ({
            establishment_heat: 'Establishment heat',
            quality_heat: 'Heat',
            photoperiod: 'Photoperiod',
            chilling: 'Chilling'
        })[factor] || factor.replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
        const severityLabel = severity === 'block' ? 'block' : (severity === 'warning' ? 'warning' : severity);
        return [factorLabel, severityLabel].filter(Boolean).join(' ');
    }
    function supportedPhotoperiodLatitude(latitudeDeg) {
        const lat = numberOrNull(latitudeDeg);
        if (lat == null || lat < -66.5 || lat > 66.5) return null;
        return lat;
    }
    function dayLengthHours(date, latitudeDeg) {
        const lat = supportedPhotoperiodLatitude(latitudeDeg);
        if (lat == null) return null;
        const doy = dayOfYear(date);
        const rad = Math.PI / 180;
        const decl = 23.44 * rad * Math.sin((2 * Math.PI / 365) * (doy - 81));
        const phi = lat * rad;
        const cosHourAngle = -Math.tan(phi) * Math.tan(decl);
        if (cosHourAngle >= 1) return 0;
        if (cosHourAngle <= -1) return 24;
        return (24 / Math.PI) * Math.acos(cosHourAngle);
    }
    function daysBetweenInclusive(start, end) {
        return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
    }
    function isOverwinterSpringWindowDate(ctx, gateDate) {
        if (!ctx.overwinterAllowed || !ctx.useCoolingGate || !gateDate) return false;
        const frostDOY = Math.max(1, Math.min(366, Number(ctx.lastSpringFrostDOY || 0) + Number(ctx.springFrostGateShiftDays || 0)));
        return Number.isFinite(frostDOY) && dayOfYear(gateDate) <= frostDOY;
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
            const rate = gddRateForDate(dailyRatesMap, cur);
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
            const rate = gddRateForDate(dailyRatesMap, cur);
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
    function accumulateScaledGDDUntil(startDate, targetGDD, dailyRatesMap, seasonEnd, scaleFactor) {
        let acc = 0;
        let cur = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()));
        const scale = Number.isFinite(Number(scaleFactor)) && Number(scaleFactor) > 0 ? Number(scaleFactor) : 1;
        while (acc < targetGDD) {
            if (seasonEnd && !dateLTE(cur, seasonEnd)) break;
            acc += gddRateForDate(dailyRatesMap, cur) * scale;
            if (acc >= targetGDD) break;
            cur = addDaysUTC(cur, 1);
        }
        return { date: cur, gdd: acc, reached: acc >= targetGDD, scaleFactor: scale };
    }
    function pickFallFrostByRisk(city, risk = 'p50') {
        const p90 = finiteNumberOrNull(city?.first_fall_frost_p90_doy);
        const p50 = finiteNumberOrNull(city?.first_fall_frost_p50_doy);
        const p10 = finiteNumberOrNull(city?.first_fall_frost_p10_doy);
        const plain = finiteNumberOrNull(city?.first_fall_frost_doy);
        if (risk === 'p90') return p90 ?? p50 ?? plain ?? null;
        if (risk === 'p10') return p10 ?? p50 ?? plain ?? null;
        return p50 ?? plain ?? p90 ?? p10 ?? null;
    }
    function dateFromDoyAfter(date, doy, scanEndHard) {
        const normalized = Math.max(1, Math.min(366, Math.round(Number(doy))));
        if (!Number.isFinite(normalized)) return null;
        let candidate = dateFromDOY(date.getUTCFullYear(), normalized);
        if (!candidate || candidate <= date) candidate = dateFromDOY(date.getUTCFullYear() + 1, normalized);
        return candidate && (!scanEndHard || candidate <= scanEndHard) ? candidate : null;
    }
    function firstCropTemperatureDeadlineAfter(ctx, sowDate) {
        const tmin = finiteNumberOrNull(ctx?.env?.Tmin);
        if (tmin == null) return null;
        for (let cur = addDaysUTC(sowDate, 1); cur <= ctx.scanEndHard; cur = addDaysUTC(cur, 1)) {
            const mean = meanTemperatureOnDate(cur, ctx.dailyClimate || ctx.monthlyAvg);
            if (mean != null && mean < tmin) return cur;
        }
        return null;
    }
    function resolveThermalGddDeadline(planner, sowDate) {
        const C = planner.ctx;
        const fallDoy = pickFallFrostByRisk(C.city, C.springFrostRisk);
        const fallDate = fallDoy == null ? null : dateFromDoyAfter(sowDate, fallDoy, C.scanEndHard);
        if (fallDate) return { date: fallDate, source: 'fall frost' };
        const cropDeadline = firstCropTemperatureDeadlineAfter(C, sowDate);
        if (cropDeadline) return { date: cropDeadline, source: 'crop temperature deadline' };
        return { date: C.scanEndHard, source: 'scan hard end' };
    }
    function earlierGddDeadline(left, right) {
        if (!left) return right;
        if (!right) return left;
        return right.date < left.date ? right : left;
    }
    function thermalWarning(type, message, extra = {}) {
        return Object.freeze({ type, severity: 'warning', message, ...extra });
    }
    function thermalYieldFactor(T, cropTemp) {
        const { Tmin, ToptLow, ToptHigh, Tmax } = cropTemp;
        if (T <= Tmin || T >= Tmax) return 0;
        if (T < ToptLow) return (T - Tmin) / Math.max(1e-9, (ToptLow - Tmin));
        if (T <= ToptHigh) return 1;
        return (Tmax - T) / Math.max(1e-9, (Tmax - ToptHigh));
    }
    function weightedMeanTempOverRange(startDate, endDate, monthlyAvgTemp, dailyRatesMap, Tbase = 10, dailyClimate = null, bedProfile = null) {
        let cur = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()));
        const sampleEnd = endDate > startDate ? endDate : addDaysUTC(startDate, 1);
        let sum = 0, n = 0;
        while (cur < sampleEnd) {
            const m = cur.getUTCMonth() + 1;
            let T = dailyClimate ? bedAdjustedMeanTemperatureOnDate(cur, dailyClimate, bedProfile) : null;
            if (T == null) T = bedAdjustedMeanTemperatureOnDate(cur, monthlyAvgTemp, bedProfile);
            if (T == null) T = monthlyAvgTemp?.[m];
            if (T == null) {
                const gdd = gddRateForDate(dailyRatesMap, cur);
                T = gdd > 0 ? (Tbase + gdd) : (Tbase - 2);
            }
            sum += T; n += 1; cur = addDaysUTC(cur, 1);
        }
        return n > 0 ? (sum / n) : Tbase;
    }
    function coldSurvivalThresholdC(plant) {
        const explicit = finiteNumberOrNull(plant?.killtemp_c);
        if (explicit != null) return explicit;
        const tmin = finiteNumberOrNull(plant?.tmin_c);
        return tmin != null ? tmin - KILL_TEMP_ESTIMATE_BUFFER_C : 0;
    }
    function formatColdSurvivalFailureReason(failure) {
        return `cold_survival_temp(min ${failure.min.toFixed(1)}<${failure.threshold.toFixed(1)})`;
    }
    function findColdSurvivalFailure(planner, fieldStartDate, endExclusive) {
        if (!fieldStartDate || !endExclusive || endExclusive <= fieldStartDate) return null;
        const C = planner.ctx;
        const threshold = coldSurvivalThresholdC(C.plant);
        for (let cur = new Date(Date.UTC(fieldStartDate.getUTCFullYear(), fieldStartDate.getUTCMonth(), fieldStartDate.getUTCDate())); cur < endExclusive; cur = addDaysUTC(cur, 1)) {
            const rec = bedAdjustedTemperatureRecordOnDate(cur, C.dailyClimate || C.monthlyAvg, C.bedProfile);
            const min = finiteNumberOrNull(rec?.min);
            if (min != null && min < threshold) {
                return { date: cur, min, threshold, deadline: addDaysUTC(cur, -1) };
            }
        }
        return null;
    }
    function coldSurvivalGddDeadline(planner, fieldStartDate) {
        const failure = findColdSurvivalFailure(planner, fieldStartDate, addDaysUTC(planner.ctx.scanEndHard, 1));
        if (!failure) return null;
        const harvestSafeDeadline = addDaysUTC(failure.date, -Math.max(0, Math.round(planner.ctx.HW_DAYS || 0)));
        return { date: harvestSafeDeadline, source: 'lethal cold', coldFailure: failure };
    }
    function assessColdSurvival(planner, fieldStartDate, harvestEndDate) {
        const failure = findColdSurvivalFailure(planner, fieldStartDate, harvestEndDate);
        if (failure) return { ok: false, reason: formatColdSurvivalFailureReason(failure) };
        return { ok: true };
    }
    function sampleMeanTempOverDays(startDate, days, ctx) {
        const count = Math.max(1, Math.round(Number(days) || 1));
        return weightedMeanTempOverRange(startDate, addDaysUTC(startDate, count), ctx.monthlyAvg, ctx.dailyRates, ctx.Tbase, ctx.dailyClimate, ctx.bedProfile);
    }
    function dateForDiagnosticStage(stage, sowDate, feasibleResult, plant) {
        const normalized = String(stage || '').trim().toLowerCase();
        if (normalized === 'sow' || normalized === 'establishment') return sowDate;
        if (normalized === 'germination' || normalized === 'germ') {
            const germDays = Math.max(0, Math.round(numberOrNull(plant?.days_germ) ?? 0));
            return addDaysUTC(sowDate, germDays);
        }
        if (normalized === 'harvest' || normalized === 'harvest_start' || normalized === 'harvest_quality' || normalized === 'maturity') return feasibleResult?.maturity || feasibleResult?.harvestStart || sowDate;
        if (normalized === 'harvest_end') return feasibleResult?.harvestEnd || feasibleResult?.maturity || sowDate;
        return feasibleResult?.maturity || sowDate;
    }
    function makeDiagnostic({ factor, stage, severity, policy, startDate, endDate, threshold = null, observed = null, message }) {
        return Object.freeze({
            factor,
            stage,
            severity,
            policy,
            startISO: startDate ? fmtISO(startDate) : '',
            endISO: endDate ? fmtISO(endDate) : '',
            threshold,
            observed,
            message
        });
    }
    function evaluateScheduleQualityDiagnostics({ sowDate, feasibleResult, planner }) {
        if (!feasibleResult || !feasibleResult.ok) return [];
        const ctx = planner.ctx;
        const plant = ctx.plant || {};
        const diagnostics = [];

        const establishmentMax = numberOrNull(plant.establishment_temp_max_c);
        const establishmentPolicy = policyForFactor(plant, 'establishment_heat', 'warn');
        if (establishmentMax != null && establishmentPolicy !== 'off') {
            const days = Math.max(1, Math.round(numberOrNull(plant.establishment_heat_window_days) ?? numberOrNull(plant.days_germ) ?? 3));
            const observed = sampleMeanTempOverDays(sowDate, days, ctx);
            if (observed > establishmentMax) diagnostics.push(makeDiagnostic({
                factor: 'establishment_heat',
                stage: 'establishment',
                severity: establishmentPolicy === 'block' ? 'block' : 'warning',
                policy: establishmentPolicy,
                startDate: sowDate,
                endDate: addDaysUTC(sowDate, days),
                threshold: establishmentMax,
                observed: Number(observed.toFixed(1)),
                message: `Establishment heat risk: mean temperature ${observed.toFixed(1)} C exceeds ${establishmentMax} C.`
            }));
        }

        const qualityMax = numberOrNull(plant.quality_temp_max_c);
        const qualityPolicy = policyForFactor(plant, 'quality_heat', 'warn');
        if (qualityMax != null && qualityPolicy !== 'off') {
            const stage = String(plant.heat_stress_stage || 'harvest_quality').trim() || 'harvest_quality';
            const stageDate = dateForDiagnosticStage(stage, sowDate, feasibleResult, plant);
            const observed = sampleMeanTempOverDays(stageDate, Math.max(1, Math.min(ctx.HW_DAYS || 1, 7)), ctx);
            if (observed > qualityMax) diagnostics.push(makeDiagnostic({
                factor: 'quality_heat',
                stage,
                severity: qualityPolicy === 'block' ? 'block' : 'warning',
                policy: qualityPolicy,
                startDate: stageDate,
                endDate: addDaysUTC(stageDate, Math.max(1, Math.min(ctx.HW_DAYS || 1, 7))),
                threshold: qualityMax,
                observed: Number(observed.toFixed(1)),
                message: `Quality heat risk: mean ${stage} temperature ${observed.toFixed(1)} C exceeds ${qualityMax} C.`
            }));
        }

        const criticalDaylength = numberOrNull(plant.critical_daylength_hours);
        const photoperiodResponse = String(plant.photoperiod_response || '').trim().toLowerCase();
        const photoperiodPolicy = policyForFactor(plant, 'photoperiod', 'warn');
        if (criticalDaylength != null && photoperiodResponse && photoperiodResponse !== 'day_neutral' && photoperiodPolicy !== 'off') {
            const stage = String(plant.photoperiod_stage || 'maturity').trim() || 'maturity';
            const stageDate = dateForDiagnosticStage(stage, sowDate, feasibleResult, plant);
            const latitude = numberOrNull(ctx.cityLatitudeDeg);
            const observed = dayLengthHours(stageDate, latitude);
            if (observed == null) {
                diagnostics.push(makeDiagnostic({
                    factor: 'photoperiod',
                    stage,
                    severity: 'info',
                    policy: photoperiodPolicy,
                    startDate: stageDate,
                    endDate: stageDate,
                    threshold: criticalDaylength,
                    observed: null,
                    message: 'Photoperiod data missing: city latitude is missing or outside the supported -66.5 to 66.5 degree range.'
                }));
            } else {
                const mismatch = (photoperiodResponse === 'long_day' && observed < criticalDaylength)
                    || (photoperiodResponse === 'short_day' && observed > criticalDaylength);
                if (mismatch) diagnostics.push(makeDiagnostic({
                    factor: 'photoperiod',
                    stage,
                    severity: photoperiodPolicy === 'block' ? 'block' : 'warning',
                    policy: photoperiodPolicy,
                    startDate: stageDate,
                    endDate: stageDate,
                    threshold: criticalDaylength,
                    observed: Number(observed.toFixed(1)),
                    message: `Photoperiod risk: ${stage} day length ${observed.toFixed(1)} h does not fit ${photoperiodResponse.replace('_', '-')} threshold ${criticalDaylength} h.`
                }));
            }
        }

        const chillingRequired = numberOrNull(plant.chilling_required_days) ?? (numberOrNull(plant.chilling_required_hours) != null ? numberOrNull(plant.chilling_required_hours) / 24 : null);
        const chillingMin = numberOrNull(plant.chilling_temp_min_c) ?? -2;
        const chillingMax = numberOrNull(plant.chilling_temp_max_c) ?? 10;
        const chillingPolicy = policyForFactor(plant, 'chilling', 'warn');
        if (chillingRequired != null && chillingRequired > 0 && chillingPolicy !== 'off') {
            const stage = String(plant.chilling_stage || 'maturity').trim() || 'maturity';
            const stageDate = dateForDiagnosticStage(stage, sowDate, feasibleResult, plant);
            let count = 0;
            for (let d = new Date(sowDate); d < stageDate; d = addDaysUTC(d, 1)) {
                const temp = weightedMeanTempOverRange(d, addDaysUTC(d, 1), ctx.monthlyAvg, ctx.dailyRates, ctx.Tbase, ctx.dailyClimate, ctx.bedProfile);
                if (temp >= chillingMin && temp <= chillingMax) count += 1;
            }
            if (count < chillingRequired) diagnostics.push(makeDiagnostic({
                factor: 'chilling',
                stage,
                severity: chillingPolicy === 'block' ? 'block' : 'warning',
                policy: chillingPolicy,
                startDate: sowDate,
                endDate: stageDate,
                threshold: Number(chillingRequired.toFixed(1)),
                observed: Number(count.toFixed(1)),
                message: `Chilling risk: ${count.toFixed(0)} suitable chilling days before ${stage}, below required ${chillingRequired.toFixed(0)}.`
            }));
        }

        return diagnostics;
    }
    function diagnosticsHaveBlockingPolicy(diagnostics) {
        return (diagnostics || []).some(diagnostic => diagnostic && diagnostic.policy === 'block' && diagnostic.severity === 'block');
    }
    function summarizeWindowDiagnostics(diagnostics) {
        const countsByLabel = new Map();
        for (const diagnostic of diagnostics || []) {
            const label = diagnosticLabel(diagnostic);
            if (label) countsByLabel.set(label, (countsByLabel.get(label) || 0) + 1);
        }
        return Array.from(countsByLabel.keys()).sort().map(label => {
            const count = countsByLabel.get(label) || 0;
            return `${label} (${count} ${count === 1 ? 'date' : 'dates'})`;
        }).join(', ');
    }
    function diagnosticRangeKey(diagnostic) {
        return [
            diagnostic?.factor || '',
            diagnostic?.severity || '',
            diagnostic?.policy || '',
            diagnostic?.stage || '',
            diagnostic?.threshold ?? ''
        ].join('|');
    }
    function compressScheduleQualityDiagnosticRanges(rows) {
        const ranges = [];
        const openByKey = new Map();
        function closeMissingKeys(activeKeys, previousISO) {
            for (const [key, range] of Array.from(openByKey.entries())) {
                if (activeKeys.has(key)) continue;
                range.endISO = previousISO || range.endISO;
                ranges.push(Object.freeze(range));
                openByKey.delete(key);
            }
        }
        let previousISO = '';
        for (const row of rows || []) {
            const sowISO = String(row?.sowISO || '').trim();
            if (!sowISO) continue;
            const diagnostics = Array.isArray(row.diagnostics) ? row.diagnostics : [];
            const activeKeys = new Set(diagnostics.map(diagnosticRangeKey));
            closeMissingKeys(activeKeys, previousISO);
            for (const diagnostic of diagnostics) {
                const key = diagnosticRangeKey(diagnostic);
                const observed = numberOrNull(diagnostic.observed);
                let range = openByKey.get(key);
                if (!range) {
                    range = {
                        factor: diagnostic.factor,
                        severity: diagnostic.severity,
                        policy: diagnostic.policy,
                        stage: diagnostic.stage,
                        label: diagnosticLabel(diagnostic),
                        startISO: sowISO,
                        endISO: sowISO,
                        threshold: diagnostic.threshold ?? null,
                        observedMin: observed,
                        observedMax: observed,
                        messages: []
                    };
                    openByKey.set(key, range);
                }
                range.endISO = sowISO;
                if (observed != null) {
                    range.observedMin = range.observedMin == null ? observed : Math.min(range.observedMin, observed);
                    range.observedMax = range.observedMax == null ? observed : Math.max(range.observedMax, observed);
                }
                if (diagnostic.message && range.messages.indexOf(diagnostic.message) < 0 && range.messages.length < 3) {
                    range.messages.push(diagnostic.message);
                }
            }
            previousISO = sowISO;
        }
        closeMissingKeys(new Set(), previousISO);
        return ranges;
    }
    function evaluateSowDateDiagnostics(inputs, startISO = inputs?.startISO) {
        const sowDate = parseISODateUTCValue(startISO);
        if (!sowDate) {
            return Object.freeze({ feasible: false, reason: 'invalid_sow_date', diagnostics: Object.freeze([]), blockingDiagnostics: Object.freeze([]) });
        }
        const planner = new Planner(inputs);
        const feasibleResult = planner.isSowFeasible(sowDate);
        const diagnostics = feasibleResult.ok ? evaluateScheduleQualityDiagnostics({ sowDate, feasibleResult, planner }) : [];
        const blockingDiagnostics = diagnostics.filter(diagnostic => diagnostic?.policy === 'block' && diagnostic?.severity === 'block');
        return Object.freeze({
            feasible: !!feasibleResult.ok,
            reason: feasibleResult.reason || '',
            diagnostics: Object.freeze(diagnostics.slice()),
            blockingDiagnostics: Object.freeze(blockingDiagnostics),
            feasibleResult
        });
    }

    class Planner {
        constructor(inputs) {
            const { plant, city, planningMode, methodCategoryId, methodId, policy } = inputs;
            const { startDate, seasonEnd, env, dailyRates, monthlyAvg, dailyClimate, scanStart, scanEndHard } = inputs.derived();
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
                annualCrossYearHarvestAllowed: policy.annualCrossYearHarvestAllowed !== false,
                useSoilTempGate: policy.useSoilTempGate,
                soilGateThresholdC: policy.soilGateThresholdC,
                soilGateConsecutiveDays: policy.soilGateConsecutiveDays,
                useSpringFrostGate: policy.useSpringFrostGate,
                springFrostRisk: policy.springFrostRisk,
                lastSpringFrostDOY: pickFrostByRisk(city, policy.springFrostRisk),
                springFrostGateShiftDays: bedFrostGateShiftDays(inputs.bedProfile),
                plant,
                HW_DAYS,
                BUDGET: budget,
                env,
                dailyRates,
                monthlyAvg,
                dailyClimate,
                bedProfile: normalizeBedProfile(inputs.bedProfile), // ADDED: soil gates depend on garden-bed conditions.
                bedProfileSource: inputs.bedProfileSource || 'generic garden bed',
                Tbase: env.Tbase,
                cityLatitudeDeg: finiteNumberOrNull(inputs.cityLatitudeDeg ?? city?.latitude ?? city?.lat), // CHANGED: Cities.latitude is canonical.
                city,
                startDate,
                seasonEnd,
                scanStart,
                sowScanEnd: asUTCDate(scanStart.getUTCFullYear(), 12, 31),
                scanEndHard,
            });
        }

        gddRateOn(d) { return gddRateForDate(this.ctx.dailyRates, d); }
        addDays(d, k) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + k)); }
        withinWindow(d) { return d >= this.ctx.scanStart && d <= this.ctx.scanEndHard; }
        normalizeUtcMidnight(d) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); }
        soilGateOK(startDate) {
            const { soilGateConsecutiveDays, soilGateThresholdC, monthlyAvg, dailyClimate, bedProfile } = this.ctx;
            let cur = new Date(startDate);
            for (let i = 0; i < soilGateConsecutiveDays; i++) {
                const Tsoil = estimateSoilTempC(cur, dailyClimate || monthlyAvg, bedProfile); // ADDED: interpolate city air and adjust for bed conditions.
                if (Tsoil < soilGateThresholdC) return false;
                cur = this.addDays(cur, 1);
            }
            return true;
        }
        checkSpringFrostGate(gateDate) {
            const C = this.ctx;
            if (!C.useSpringFrostGate || !gateDate) return { ok: true };
            if (isOverwinterSpringWindowDate(C, gateDate)) return { ok: true };
            const doy = shared.dayOfYear(gateDate);
            const gateDOY = Math.max(1, Math.min(366, Number(C.lastSpringFrostDOY || 0) + Number(C.springFrostGateShiftDays || 0)));
            if (doy < gateDOY) {
                return { ok: false, reason: `spring_frost_gate(doy ${doy} < ${gateDOY})` };
            }
            return { ok: true };
        }
        checkCoolingGate(gateDate) {
            const C = this.ctx;
            if (!C.useCoolingGate || !gateDate) return { ok: true };
            if (isOverwinterSpringWindowDate(C, gateDate)) return { ok: true };
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
            return assessSowDateForSchedule(this, sowDate);
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
    function validateNonThermalSowDate(planner, sowDate) {
        if (!planner.withinWindow(sowDate) || sowDate > planner.ctx.sowScanEnd) return { ok: false, reason: 'outside_scan_window' };
        const gateDate = getGateDateForCandidate(planner, sowDate);
        if (!gateDate || !planner.withinWindow(gateDate)) return { ok: false, reason: 'gate_outside_scan_window' };
        const frost = planner.checkSpringFrostGate(gateDate);
        if (!frost.ok) return frost;
        const cooling = planner.checkCoolingGate(gateDate);
        if (!cooling.ok) return cooling;
        const soil = planner.checkSoilGate(gateDate);
        if (!soil.ok) return soil;
        return { ok: true, gateDate };
    }
    function formatInsufficientGddBeforeColdReason(available, targetGdd, deadline) {
        const gdd = finiteNumberOrNull(available?.gdd) || 0;
        const target = finiteNumberOrNull(targetGdd) || 0;
        const lethalISO = deadline?.coldFailure?.date ? fmtISO(deadline.coldFailure.date) : 'unknown';
        return `insufficient_gdd_before_cold(gdd ${gdd.toFixed(1)}<${target.toFixed(1)} deadline ${lethalISO})`;
    }
    function resolveInsufficientGddBeforeColdMaturity(planner, sowDate, warnings, deadline, available) {
        const C = planner.ctx;
        if (!(available?.gdd > 0)) {
            return { ok: false, reason: `insufficient_gdd_before_cold_no_heat(deadline ${fmtISO(deadline.coldFailure.date)})` };
        }
        const requiredScale = C.BUDGET.amount / available.gdd;
        if (!Number.isFinite(requiredScale) || requiredScale > THERMAL_GDD_SCALE_CAP) {
            return { ok: false, reason: `insufficient_gdd_before_cold_scale_cap(scale ${Number.isFinite(requiredScale) ? requiredScale.toFixed(2) : 'n/a'}>${THERMAL_GDD_SCALE_CAP.toFixed(2)} deadline ${fmtISO(deadline.coldFailure.date)})` };
        }
        const scheduleScale = requiredScale < THERMAL_GDD_SCALE_CAP ? Math.min(THERMAL_GDD_SCALE_CAP, requiredScale * 1.000001) : requiredScale;
        const scaled = accumulateScaledGDDUntil(sowDate, C.BUDGET.amount, C.dailyRates, deadline.date, scheduleScale);
        warnings.push(thermalWarning('insufficient_gdd_before_cold_scaled_fallback', `There is not enough heat before lethal cold; using ${scheduleScale.toFixed(2)}x scaled GDD through ${fmtISO(deadline.date)} for schedule anchors.`, { scaleFactor: scheduleScale, deadlineISO: fmtISO(deadline.date), lethalColdISO: fmtISO(deadline.coldFailure.date) }));
        return { ok: true, maturity: scaled.date, gddScaleFactor: scheduleScale, deadline };
    }
    function resolveInsufficientGddMaturity(planner, sowDate, warnings) {
        const C = planner.ctx;
        const daysMaturity = finiteNumberOrNull(C.plant?.days_maturity);
        if (daysMaturity != null && daysMaturity > 0) {
            const maturity = addDaysUTC(sowDate, Math.round(daysMaturity));
            warnings.push(thermalWarning('insufficient_gdd_dtm_fallback', `There is not enough growing-degree accumulation to reach maturity; using days to maturity (${Math.round(daysMaturity)} days) for schedule anchors.`));
            return { ok: true, maturity };
        }
        const deadline = resolveThermalGddDeadline(planner, sowDate);
        const available = accumulateGDDUntil(sowDate, C.BUDGET.amount, C.dailyRates, deadline.date);
        if (!(available.gdd > 0)) {
            return { ok: false, reason: 'insufficient_gdd_no_heat' };
        }
        const requiredScale = C.BUDGET.amount / available.gdd;
        if (!Number.isFinite(requiredScale) || requiredScale > THERMAL_GDD_SCALE_CAP) {
            return { ok: false, reason: 'insufficient_gdd_scale_cap' };
        }
        const scaled = accumulateScaledGDDUntil(sowDate, C.BUDGET.amount, C.dailyRates, deadline.date, requiredScale);
        warnings.push(thermalWarning('insufficient_gdd_scaled_fallback', `There is not enough growing-degree accumulation to reach maturity; using ${requiredScale.toFixed(2)}x scaled GDD through the ${deadline.source} for schedule anchors.`, { scaleFactor: requiredScale, deadlineISO: fmtISO(deadline.date), deadlineSource: deadline.source }));
        return { ok: true, maturity: scaled.date, gddScaleFactor: requiredScale, deadline };
    }
    function assessSowDateForSchedule(planner, sowDate, options = {}) {
        const C = planner.ctx;
        const allowThermalWarnings = options.allowThermalWarnings === true;
        const warnings = [];
        const nonThermal = validateNonThermalSowDate(planner, sowDate);
        if (!nonThermal.ok) return nonThermal;
        const fieldStartDate = nonThermal.gateDate || sowDate;
        let mat = null;
        if (C.BUDGET.mode === 'gdd') {
            const thermalDeadline = resolveThermalGddDeadline(planner, sowDate);
            const coldDeadline = coldSurvivalGddDeadline(planner, fieldStartDate);
            const deadline = earlierGddDeadline(thermalDeadline, coldDeadline);
            const acc = accumulateGDDUntil(sowDate, C.BUDGET.amount, C.dailyRates, deadline.date);
            if (acc.reached) mat = acc.date;
            else if (deadline === coldDeadline) {
                if (!allowThermalWarnings) return { ok: false, reason: formatInsufficientGddBeforeColdReason(acc, C.BUDGET.amount, coldDeadline) };
                const fallback = resolveInsufficientGddBeforeColdMaturity(planner, sowDate, warnings, coldDeadline, acc);
                if (!fallback.ok) return fallback;
                mat = fallback.maturity;
            }
            else if (!allowThermalWarnings) return { ok: false, reason: 'insufficient_gdd' };
            else {
                const fallback = resolveInsufficientGddMaturity(planner, sowDate, warnings);
                if (!fallback.ok) return fallback;
                mat = fallback.maturity;
            }
        } else {
            mat = maturityDateFromBudget(sowDate, C.BUDGET, C.dailyRates, C.scanEndHard);
        }
        const fullHarvestEnd = planner.addDays(mat, C.HW_DAYS);
        if (!C.annualCrossYearHarvestAllowed && sowDate.getUTCFullYear() !== fullHarvestEnd.getUTCFullYear()) {
            return { ok: false, reason: 'cross_year_disallowed' };
        }
        const hardEnd = C.scanEndHard;
        const effectiveHarvestEnd = (fullHarvestEnd <= hardEnd) ? fullHarvestEnd : hardEnd;
        const MS_PER_DAY = 24 * 60 * 60 * 1000;
        const harvestSpanDays = Math.max(0, Math.round((effectiveHarvestEnd.getTime() - mat.getTime()) / MS_PER_DAY));
        const minHarvestDays = Math.min(C.HW_DAYS, 3);
        if (harvestSpanDays < minHarvestDays) return { ok: false, reason: 'beyond_hard_end' };
        const survival = assessColdSurvival(planner, fieldStartDate, effectiveHarvestEnd);
        if (!survival.ok) return survival;
        const TmeanHarvest = weightedMeanTempOverRange(mat, effectiveHarvestEnd, C.monthlyAvg, C.dailyRates, C.Tbase, C.dailyClimate, C.bedProfile);
        const { Tmin, Tmax } = C.env;
        if (TmeanHarvest < Tmin) {
            if (!allowThermalWarnings) return { ok: false, reason: `harvest_too_cold(${TmeanHarvest.toFixed(1)}<${Tmin})` };
            warnings.push(thermalWarning('harvest_too_cold', `Expected harvest temperature ${TmeanHarvest.toFixed(1)} C is below the crop minimum ${Tmin} C.`));
        }
        if (TmeanHarvest > Tmax) {
            if (!allowThermalWarnings) return { ok: false, reason: `harvest_too_hot(${TmeanHarvest.toFixed(1)}>${Tmax})` };
            warnings.push(thermalWarning('harvest_too_hot', `Expected harvest temperature ${TmeanHarvest.toFixed(1)} C is above the crop maximum ${Tmax} C.`));
        }
        const truncated = fullHarvestEnd.getTime() > effectiveHarvestEnd.getTime();
        const crossYearHarvest = sowDate.getUTCFullYear() !== effectiveHarvestEnd.getUTCFullYear();
        return { ok: true, maturity: mat, harvestStart: mat, harvestEnd: effectiveHarvestEnd, truncated, crossYearHarvest, TmeanHarvest, warnings: Object.freeze(warnings) };
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
            reason.indexOf('insufficient_gdd_before_cold') === 0 ||
            reason === 'insufficient_gdd';
    }
    function impliedHarvestEndForDate(planner, sow, HW_DAYS) {
        const C = planner.ctx;
        const mat = maturityDateFromBudget(sow, C.BUDGET, C.dailyRates, C.scanEndHard);
        return planner.addDays(mat, Math.max(0, HW_DAYS || 0));
    }
    function meteorologicalSeasonName(date) {
        const month = date.getUTCMonth() + 1;
        if (month >= 3 && month <= 5) return 'Spring';
        if (month >= 6 && month <= 8) return 'Summer';
        if (month >= 9 && month <= 11) return 'Fall';
        return 'Winter';
    }
    function formatShortMonthDay(date) {
        return date.toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
    }
    function labelSowingSeasons(windows) {
        const seasonCounts = Object.create(null);
        return windows.map((win, index) => {
            const mid = addDaysUTC(win.startDate, Math.floor((daysBetweenInclusive(win.startDate, win.endDate) - 1) / 2));
            const season = meteorologicalSeasonName(mid);
            seasonCounts[season] = (seasonCounts[season] || 0) + 1;
            const suffix = seasonCounts[season] > 1 ? ` ${seasonCounts[season]}` : '';
            const label = `${season}${suffix} (${formatShortMonthDay(win.startDate)}-${formatShortMonthDay(win.endDate)})`;
            return Object.freeze({
                id: `window-${index + 1}`,
                label,
                startISO: fmtISO(win.startDate),
                endISO: fmtISO(win.endDate),
                startDate: new Date(win.startDate),
                endDate: new Date(win.endDate),
                diagnostics: Object.freeze((win.diagnostics || []).slice()),
                riskSummary: summarizeWindowDiagnostics(win.diagnostics || []),
                source: Object.freeze({
                    firstFeasibleISO: fmtISO(win.firstFeasibleDate || win.startDate),
                    lastFeasibleISO: fmtISO(win.lastFeasibleDate || win.endDate),
                    mergedGapDays: Number(win.mergedGapDays || 0)
                })
            });
        });
    }
    function smoothFeasibleSowingRanges(ranges, { maxGapDays = MULTI_WINDOW_MAX_MERGE_GAP_DAYS, minLengthDays = MULTI_WINDOW_MIN_LENGTH_DAYS } = {}) {
        const sorted = (ranges || [])
            .filter(range => range && range.startDate instanceof Date && range.endDate instanceof Date)
            .sort((a, b) => a.startDate - b.startDate);
        const merged = [];
        for (const range of sorted) {
            if (!merged.length) {
                merged.push({ ...range, firstFeasibleDate: range.startDate, lastFeasibleDate: range.endDate, mergedGapDays: 0, diagnostics: (range.diagnostics || []).slice() });
                continue;
            }
            const prev = merged[merged.length - 1];
            const gapDays = Math.max(0, Math.round((range.startDate.getTime() - prev.endDate.getTime()) / 86400000) - 1);
            if (gapDays <= maxGapDays) {
                prev.endDate = new Date(range.endDate);
                prev.lastFeasibleDate = new Date(range.endDate);
                prev.mergedGapDays += gapDays;
                prev.diagnostics = (prev.diagnostics || []).concat(range.diagnostics || []);
            } else {
                merged.push({ ...range, firstFeasibleDate: range.startDate, lastFeasibleDate: range.endDate, mergedGapDays: 0, diagnostics: (range.diagnostics || []).slice() });
            }
        }
        return merged.filter(range => daysBetweenInclusive(range.startDate, range.endDate) >= minLengthDays);
    }
    function assignDiagnosticsToSmoothedRanges(ranges, scanRows) {
        return (ranges || []).map(range => {
            const diagnostics = [];
            for (const row of scanRows || []) {
                if (!row?.date || row.date < range.startDate || row.date > range.endDate) continue;
                diagnostics.push(...(row.diagnostics || []));
            }
            return { ...range, diagnostics };
        });
    }
    function computeAnnualSowingSeasons(params) {
        const resolvedHarvestWindowDays = resolveHarvestWindowDays(params.HW_DAYS);
        const { planner, resolvedBehavior } = buildAutoWindowPlanner({
            ...params,
            HW_DAYS: resolvedHarvestWindowDays
        });
        const C = planner.ctx;
        const seasonScanEnd = C.sowScanEnd || asUTCDate(C.scanStart.getUTCFullYear(), 12, 31);
        const sowScanEnd = seasonScanEnd < C.scanEndHard ? seasonScanEnd : C.scanEndHard;
        const ranges = [];
        const scanRows = [];
        let current = null;
        let firstHarvestEnd = null;
        let lastHarvestEnd = null;
        for (let d = new Date(C.scanStart); dateLTE(d, sowScanEnd); d = planner.addDays(d, 1)) {
            const r = planner.isSowFeasible(d);
            const diagnostics = r.ok ? evaluateScheduleQualityDiagnostics({ sowDate: d, feasibleResult: r, planner }) : [];
            scanRows.push({ date: new Date(d), diagnostics });
            const blockedByDiagnostics = diagnosticsHaveBlockingPolicy(diagnostics);
            if (r.ok && !blockedByDiagnostics) {
                if (!current) current = { startDate: new Date(d), endDate: new Date(d), diagnostics: [] };
                current.endDate = new Date(d);
                if (!firstHarvestEnd) firstHarvestEnd = r.harvestEnd;
                if (!lastHarvestEnd || r.harvestEnd > lastHarvestEnd) lastHarvestEnd = r.harvestEnd;
            } else if (current) {
                ranges.push(current);
                current = null;
            }
        }
        if (current) ranges.push(current);
        const smoothedRanges = smoothFeasibleSowingRanges(ranges, params.windowOptions || {});
        const seasons = labelSowingSeasons(assignDiagnosticsToSmoothedRanges(smoothedRanges, scanRows));
        return Object.freeze({
            feasible: seasons.length > 0,
            harvestEndSemantics: HARVEST_END_SEMANTICS,
            seasons, // CHANGED: public annual-core result now uses sowing-season terminology.
            seasonStartYear: C.scanStart.getUTCFullYear(),
            scanStartISO: fmtISO(C.scanStart),
            scanEndISO: fmtISO(sowScanEnd),
            lifecycleScanEndISO: fmtISO(C.scanEndHard),
            resolvedMethod: resolvedBehavior,
            earliestFeasibleSowDate: seasons.length ? new Date(seasons[0].startDate) : null,
            lastFeasibleSowDate: seasons.length ? new Date(seasons[seasons.length - 1].endDate) : null,
            climateEndDate: lastHarvestEnd || firstHarvestEnd || null
        });
    }
    function computeScheduleQualityDiagnosticRangesForPlanner(planner) {
        const C = planner.ctx;
        const seasonScanEnd = asUTCDate(C.scanStart.getUTCFullYear(), 12, 31);
        const sowScanEnd = seasonScanEnd < C.scanEndHard ? seasonScanEnd : C.scanEndHard;
        const rows = [];
        for (let d = new Date(C.scanStart); dateLTE(d, sowScanEnd); d = planner.addDays(d, 1)) {
            const feasibleResult = planner.isSowFeasible(d);
            rows.push({
                sowISO: fmtISO(d),
                diagnostics: feasibleResult.ok ? evaluateScheduleQualityDiagnostics({ sowDate: d, feasibleResult, planner }) : []
            });
        }
        return Object.freeze(compressScheduleQualityDiagnosticRanges(rows));
    }
    function computeScheduleQualityDiagnosticRangesForInputs(inputs) {
        return computeScheduleQualityDiagnosticRangesForPlanner(new Planner(inputs));
    }
    function computeScheduleQualityDiagnosticRanges(params) {
        const resolvedHarvestWindowDays = resolveHarvestWindowDays(params.HW_DAYS);
        const { planner } = buildAutoWindowPlanner({
            ...params,
            HW_DAYS: resolvedHarvestWindowDays
        });
        return computeScheduleQualityDiagnosticRangesForPlanner(planner);
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
            dailyClimate = null,
            scanStart, scanEndHard,
            soilGateThresholdC, soilGateConsecutiveDays,
            startCoolingThresholdC,
            useSpringFrostGate,
            lastSpringFrostDOY,
            daysTransplant,
            overwinterAllowed,
            plantMetadata = null,
            cityLatitudeDeg = null,
            bedProfile = null,
            bedProfileSource = 'generic garden bed'
        } = params;

        const resolvedBehavior = resolveMethodBehavior({ methodCategoryId, methodId });
        validateAutoWindowMethodInputs({ resolvedBehavior, daysTransplant });
        const effectiveScanEndHard = asUTCDate(Math.max(scanEndHard.getUTCFullYear(), scanStart.getUTCFullYear() + 1), 12, 31);
        const fakePlant = {
            start_cooling_threshold_c: startCoolingThresholdC,
            soil_temp_min_plant_c: soilGateThresholdC,
            isPerennial: () => false,
            isBiennial: () => false,
            overwinter_ok: overwinterAllowed ? 1 : 0,
            days_transplant: daysTransplant,
            days_germ: plantMetadata?.days_germ,
            ...(plantMetadata || {}),
            cropTempEnvelope: () => cropTemp,
            firstHarvestBudget: () => budget
        };
        const fakeCity = {
            dailyRates: (_tbase, _year) => dailyRatesMap,
            monthlyMeans: () => monthlyAvgTemp,
            latitude: cityLatitudeDeg, // CHANGED: align test planner city shape with Cities.latitude.
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
            seasonEndISO: effectiveScanEndHard.toISOString().slice(0, 10),
            policy,
            seasonStartYear: scanStart.getUTCFullYear(),
            harvestWindowDays: HW_DAYS,
            bedProfile,
            bedProfileSource,
            dailyClimate: dailyClimate || buildDailyTemperatureSeries({
                startDate: scanStart,
                endDate: effectiveScanEndHard,
                monthlyNormals: monthlyAvgTemp,
                source: 'legacy monthly mean inputs'
            })
        });
        const planner = new Planner(inputs);
        return { planner, ctx: planner.ctx, resolvedBehavior };
    }
    function computeAutoStartEndWindowForward(params) {
        const {
            methodId, methodCategoryId, budget, HW_DAYS,
            dailyRatesMap, monthlyAvgTemp, Tbase, cropTemp,
            dailyClimate = null,
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
            dailyClimate,
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
        const sowScanEnd = C.sowScanEnd || asUTCDate(C.scanStart.getUTCFullYear(), 12, 31);
        let fieldGateStart = new Date(C.scanStart);
        if (useSpringFrostGate && Number.isFinite(lastSpringFrostDOY)) {
            const shiftedDOY = Math.max(1, Math.min(366, Number(lastSpringFrostDOY) + Number(C.springFrostGateShiftDays || 0)));
            const frostDate = dateFromDOY(C.scanStart.getUTCFullYear(), shiftedDOY);
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
    function computeAnnualScheduleResult(inputs, options = {}) {
        const { plant, methodId } = inputs;
        const method = methodId;
        const startDate = parseISODateUTCValue(inputs.startISO);
        if (!startDate) throw new Error('Select a planting date.');
        const { seasonEnd, env, dailyRates } = inputs.derived();
        const planner = new Planner(inputs);
        const feasibility = assessSowDateForSchedule(planner, startDate, { allowThermalWarnings: options.allowThermalWarnings === true });
        if (!feasibility.ok) {
            throw new Error(`Selected sow date is not feasible: ${humanFeasibilityReason(feasibility.reason)}`);
        }
        const warnings = Array.from(feasibility.warnings || []);
        if (feasibility.crossYearHarvest) warnings.push(thermalWarning('cross_year_harvest_allowed', 'Climate-based checks allow this annual harvest to continue into the next calendar year.'));
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
            const message = `Selected sow date yield multiplier ${yieldMultipliers[0].toFixed(2)} is below the minimum ${minYieldMultiplier.toFixed(2)}.`;
            if (options.allowThermalWarnings === true) warnings.push(thermalWarning('yield_multiplier_below_minimum', message));
            else throw new Error(message);
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
            lastScheduledHarvestEndISO: timelines.length ? fmtISO(timelines[timelines.length - 1]?.harvestEnd) : null,
            warnings: Object.freeze(warnings)
        };
    }

    win.USL.scheduler.annualCore = Object.freeze({
        Planner,
        accumulateGDDUntil,
        accumulateGDDBackward,
        maturityDateFromBudget,
        thermalYieldFactor,
        weightedMeanTempOverRange,
        dayLengthHours,
        evaluateScheduleQualityDiagnostics,
        evaluateSowDateDiagnostics,
        diagnosticsHaveBlockingPolicy,
        computeScheduleQualityDiagnosticRanges,
        computeScheduleQualityDiagnosticRangesForInputs,
        computeScheduleQualityDiagnosticRangesForPlanner,
        compressScheduleQualityDiagnosticRanges,
        diagnosticLabel,
        firstCoolingCrossingDate,
        getGateDateForCandidate,
        firstNonSoilStart,
        computeStageDatesForPlanting,
        computeStageTimelineForSchedule,
        classifyIsThermal,
        impliedHarvestEndForDate,
        computeAnnualSowingSeasons,
        buildAutoWindowPlanner,
        computeAutoStartEndWindowForward,
        assessSowDateForSchedule,
        computeAnnualScheduleResult
    });
})(typeof window !== 'undefined' ? window : globalThis);
