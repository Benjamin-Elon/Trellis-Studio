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
        bedAdjustedTemperatureRecordOnDate, // ADDED
        bedAdjustedMeanTemperatureOnDate, // ADDED
        buildDailyTemperatureSeries,
        gddRateForDate,
        meanTemperatureOnDate,
        resolveMethodBehavior,
        validateAutoWindowMethodInputs,
        humanFeasibilityReason
    } = shared;

    const MULTI_WINDOW_MAX_MERGE_GAP_DAYS = 7; // ADDED
    const MULTI_WINDOW_MIN_LENGTH_DAYS = 3; // ADDED
    const DIAGNOSTIC_POLICIES = Object.freeze(new Set(['off', 'warn', 'block'])); // ADDED
    const THERMAL_GDD_SCALE_CAP = 2; // ADDED
    const KILL_TEMP_ESTIMATE_BUFFER_C = 3; // CHANGED

    function monthMeanAt(date, monthlyAvgTemp) {
        return monthlyAvgTemp?.[date.getUTCMonth() + 1] ?? null;
    }
    function clampNumber(value, min, max) { // ADDED
        if (value == null || value === '') return null; // ADDED
        const n = Number(value); // ADDED
        if (!Number.isFinite(n)) return null; // ADDED
        return Math.max(min, Math.min(max, n)); // ADDED
    }
    function normalizeDiagnosticPolicy(value, fallback = 'warn') { // ADDED
        const raw = String(value || fallback || 'warn').trim().toLowerCase(); // ADDED
        return DIAGNOSTIC_POLICIES.has(raw) ? raw : fallback; // ADDED
    }
    function numberOrNull(value) { // ADDED
        if (value == null || value === '') return null; // ADDED
        const n = Number(value); // ADDED
        return Number.isFinite(n) ? n : null; // ADDED
    }
    function policyForFactor(plant, factor, fallback = 'warn') { // ADDED
        const direct = plant?.[`${factor}_policy`]; // ADDED
        if (direct != null && String(direct).trim() !== '') return normalizeDiagnosticPolicy(direct, fallback); // ADDED
        const generic = plant?.diagnostic_policy; // ADDED
        if (generic != null && String(generic).trim() !== '') return normalizeDiagnosticPolicy(generic, fallback); // ADDED
        return fallback; // ADDED
    }
    function diagnosticLabel(diagnostic) { // ADDED
        const factor = String(diagnostic?.factor || '').trim(); // ADDED
        const severity = String(diagnostic?.severity || '').trim(); // ADDED
        if (factor === 'photoperiod' && severity === 'info') return 'Photoperiod data missing'; // ADDED
        const factorLabel = ({ // ADDED
            establishment_heat: 'Establishment heat', // ADDED
            quality_heat: 'Heat', // ADDED
            photoperiod: 'Photoperiod', // ADDED
            chilling: 'Chilling' // ADDED
        })[factor] || factor.replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase()); // ADDED
        const severityLabel = severity === 'block' ? 'block' : (severity === 'warning' ? 'warning' : severity); // ADDED
        return [factorLabel, severityLabel].filter(Boolean).join(' '); // ADDED
    }
    function supportedPhotoperiodLatitude(latitudeDeg) { // ADDED
        const lat = numberOrNull(latitudeDeg); // ADDED
        if (lat == null || lat < -66.5 || lat > 66.5) return null; // ADDED
        return lat; // ADDED
    }
    function dayLengthHours(date, latitudeDeg) { // ADDED
        const lat = supportedPhotoperiodLatitude(latitudeDeg); // CHANGED
        if (lat == null) return null; // ADDED
        const doy = dayOfYear(date); // ADDED
        const rad = Math.PI / 180; // ADDED
        const decl = 23.44 * rad * Math.sin((2 * Math.PI / 365) * (doy - 81)); // ADDED
        const phi = lat * rad; // ADDED
        const cosHourAngle = -Math.tan(phi) * Math.tan(decl); // ADDED
        if (cosHourAngle >= 1) return 0; // ADDED
        if (cosHourAngle <= -1) return 24; // ADDED
        return (24 / Math.PI) * Math.acos(cosHourAngle); // ADDED
    }
    function daysBetweenInclusive(start, end) { // ADDED
        return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
    }
    function isOverwinterSpringWindowDate(ctx, gateDate) { // ADDED
        if (!ctx.overwinterAllowed || !ctx.useCoolingGate || !gateDate) return false; // ADDED
        const frostDOY = Math.max(1, Math.min(366, Number(ctx.lastSpringFrostDOY || 0) + Number(ctx.springFrostGateShiftDays || 0))); // ADDED
        return Number.isFinite(frostDOY) && dayOfYear(gateDate) <= frostDOY; // ADDED
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
    function accumulateScaledGDDUntil(startDate, targetGDD, dailyRatesMap, seasonEnd, scaleFactor) { // ADDED
        let acc = 0; // ADDED
        let cur = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate())); // ADDED
        const scale = Number.isFinite(Number(scaleFactor)) && Number(scaleFactor) > 0 ? Number(scaleFactor) : 1; // ADDED
        while (acc < targetGDD) { // ADDED
            if (seasonEnd && !dateLTE(cur, seasonEnd)) break; // ADDED
            acc += gddRateForDate(dailyRatesMap, cur) * scale; // ADDED
            if (acc >= targetGDD) break; // ADDED
            cur = addDaysUTC(cur, 1); // ADDED
        } // ADDED
        return { date: cur, gdd: acc, reached: acc >= targetGDD, scaleFactor: scale }; // ADDED
    } // ADDED
    function pickFallFrostByRisk(city, risk = 'p50') { // ADDED
        const p90 = finiteNumberOrNull(city?.first_fall_frost_p90_doy); // ADDED
        const p50 = finiteNumberOrNull(city?.first_fall_frost_p50_doy); // ADDED
        const p10 = finiteNumberOrNull(city?.first_fall_frost_p10_doy); // ADDED
        const plain = finiteNumberOrNull(city?.first_fall_frost_doy); // ADDED
        if (risk === 'p90') return p90 ?? p50 ?? plain ?? null; // ADDED
        if (risk === 'p10') return p10 ?? p50 ?? plain ?? null; // ADDED
        return p50 ?? plain ?? p90 ?? p10 ?? null; // ADDED
    } // ADDED
    function dateFromDoyAfter(date, doy, scanEndHard) { // ADDED
        const normalized = Math.max(1, Math.min(366, Math.round(Number(doy)))); // ADDED
        if (!Number.isFinite(normalized)) return null; // ADDED
        let candidate = dateFromDOY(date.getUTCFullYear(), normalized); // ADDED
        if (!candidate || candidate <= date) candidate = dateFromDOY(date.getUTCFullYear() + 1, normalized); // ADDED
        return candidate && (!scanEndHard || candidate <= scanEndHard) ? candidate : null; // ADDED
    } // ADDED
    function firstCropTemperatureDeadlineAfter(ctx, sowDate) { // ADDED
        const tmin = finiteNumberOrNull(ctx?.env?.Tmin); // ADDED
        if (tmin == null) return null; // ADDED
        for (let cur = addDaysUTC(sowDate, 1); cur <= ctx.scanEndHard; cur = addDaysUTC(cur, 1)) { // ADDED
            const mean = meanTemperatureOnDate(cur, ctx.dailyClimate || ctx.monthlyAvg); // ADDED
            if (mean != null && mean < tmin) return cur; // ADDED
        } // ADDED
        return null; // ADDED
    } // ADDED
    function resolveThermalGddDeadline(planner, sowDate) { // ADDED
        const C = planner.ctx; // ADDED
        const fallDoy = pickFallFrostByRisk(C.city, C.springFrostRisk); // ADDED
        const fallDate = fallDoy == null ? null : dateFromDoyAfter(sowDate, fallDoy, C.scanEndHard); // ADDED
        if (fallDate) return { date: fallDate, source: 'fall frost' }; // ADDED
        const cropDeadline = firstCropTemperatureDeadlineAfter(C, sowDate); // ADDED
        if (cropDeadline) return { date: cropDeadline, source: 'crop temperature deadline' }; // ADDED
        return { date: C.scanEndHard, source: 'scan hard end' }; // ADDED
    } // ADDED
    function earlierGddDeadline(left, right) { // ADDED
        if (!left) return right; // ADDED
        if (!right) return left; // ADDED
        return right.date < left.date ? right : left; // ADDED
    } // ADDED
    function thermalWarning(type, message, extra = {}) { // ADDED
        return Object.freeze({ type, severity: 'warning', message, ...extra }); // ADDED
    } // ADDED
    function thermalYieldFactor(T, cropTemp) {
        const { Tmin, ToptLow, ToptHigh, Tmax } = cropTemp;
        if (T <= Tmin || T >= Tmax) return 0;
        if (T < ToptLow) return (T - Tmin) / Math.max(1e-9, (ToptLow - Tmin));
        if (T <= ToptHigh) return 1;
        return (Tmax - T) / Math.max(1e-9, (Tmax - ToptHigh));
    }
    function weightedMeanTempOverRange(startDate, endDate, monthlyAvgTemp, dailyRatesMap, Tbase = 10, dailyClimate = null, bedProfile = null) { // CHANGED
        let cur = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()));
        const sampleEnd = endDate > startDate ? endDate : addDaysUTC(startDate, 1);
        let sum = 0, n = 0;
        while (cur < sampleEnd) {
            const m = cur.getUTCMonth() + 1;
            let T = dailyClimate ? bedAdjustedMeanTemperatureOnDate(cur, dailyClimate, bedProfile) : null; // CHANGED
            if (T == null) T = bedAdjustedMeanTemperatureOnDate(cur, monthlyAvgTemp, bedProfile); // CHANGED
            if (T == null) T = monthlyAvgTemp?.[m]; // ADDED
            if (T == null) {
                const gdd = gddRateForDate(dailyRatesMap, cur);
                T = gdd > 0 ? (Tbase + gdd) : (Tbase - 2);
            }
            sum += T; n += 1; cur = addDaysUTC(cur, 1);
        }
        return n > 0 ? (sum / n) : Tbase;
    }
    function coldSurvivalThresholdC(plant) { // CHANGED
        const explicit = finiteNumberOrNull(plant?.killtemp_c); // ADDED
        if (explicit != null) return explicit; // ADDED
        const tmin = finiteNumberOrNull(plant?.tmin_c); // CHANGED
        return tmin != null ? tmin - KILL_TEMP_ESTIMATE_BUFFER_C : 0; // CHANGED
    } // CHANGED
    function formatColdSurvivalFailureReason(failure) { // ADDED
        return `cold_survival_temp(min ${failure.min.toFixed(1)}<${failure.threshold.toFixed(1)})`; // ADDED
    } // ADDED
    function findColdSurvivalFailure(planner, fieldStartDate, endExclusive) { // ADDED
        if (!fieldStartDate || !endExclusive || endExclusive <= fieldStartDate) return null; // ADDED
        const C = planner.ctx; // ADDED
        const threshold = coldSurvivalThresholdC(C.plant); // CHANGED
        for (let cur = new Date(Date.UTC(fieldStartDate.getUTCFullYear(), fieldStartDate.getUTCMonth(), fieldStartDate.getUTCDate())); cur < endExclusive; cur = addDaysUTC(cur, 1)) { // CHANGED
            const rec = bedAdjustedTemperatureRecordOnDate(cur, C.dailyClimate || C.monthlyAvg, C.bedProfile); // ADDED
            const min = finiteNumberOrNull(rec?.min); // ADDED
            if (min != null && min < threshold) { // ADDED
                return { date: cur, min, threshold, deadline: addDaysUTC(cur, -1) }; // CHANGED
            } // ADDED
        } // ADDED
        return null; // ADDED
    } // ADDED
    function coldSurvivalGddDeadline(planner, fieldStartDate) { // ADDED
        const failure = findColdSurvivalFailure(planner, fieldStartDate, addDaysUTC(planner.ctx.scanEndHard, 1)); // ADDED
        if (!failure) return null; // ADDED
        const harvestSafeDeadline = addDaysUTC(failure.date, -Math.max(0, Math.round(planner.ctx.HW_DAYS || 0))); // CHANGED
        return { date: harvestSafeDeadline, source: 'lethal cold', coldFailure: failure }; // CHANGED
    } // ADDED
    function assessColdSurvival(planner, fieldStartDate, harvestEndDate) { // CHANGED
        const failure = findColdSurvivalFailure(planner, fieldStartDate, harvestEndDate); // CHANGED
        if (failure) return { ok: false, reason: formatColdSurvivalFailureReason(failure) }; // CHANGED
        return { ok: true }; // ADDED
    } // CHANGED
    function sampleMeanTempOverDays(startDate, days, ctx) { // ADDED
        const count = Math.max(1, Math.round(Number(days) || 1)); // ADDED
        return weightedMeanTempOverRange(startDate, addDaysUTC(startDate, count), ctx.monthlyAvg, ctx.dailyRates, ctx.Tbase, ctx.dailyClimate, ctx.bedProfile); // CHANGED
    }
    function dateForDiagnosticStage(stage, sowDate, feasibleResult, plant) { // ADDED
        const normalized = String(stage || '').trim().toLowerCase(); // ADDED
        if (normalized === 'sow' || normalized === 'establishment') return sowDate; // ADDED
        if (normalized === 'germination' || normalized === 'germ') { // ADDED
            const germDays = Math.max(0, Math.round(numberOrNull(plant?.days_germ) ?? 0)); // ADDED
            return addDaysUTC(sowDate, germDays); // ADDED
        } // ADDED
        if (normalized === 'harvest' || normalized === 'harvest_start' || normalized === 'harvest_quality' || normalized === 'maturity') return feasibleResult?.maturity || feasibleResult?.harvestStart || sowDate; // ADDED
        if (normalized === 'harvest_end') return feasibleResult?.harvestEnd || feasibleResult?.maturity || sowDate; // ADDED
        return feasibleResult?.maturity || sowDate; // ADDED
    }
    function makeDiagnostic({ factor, stage, severity, policy, startDate, endDate, threshold = null, observed = null, message }) { // ADDED
        return Object.freeze({ // ADDED
            factor, // ADDED
            stage, // ADDED
            severity, // ADDED
            policy, // ADDED
            startISO: startDate ? fmtISO(startDate) : '', // ADDED
            endISO: endDate ? fmtISO(endDate) : '', // ADDED
            threshold, // ADDED
            observed, // ADDED
            message // ADDED
        }); // ADDED
    }
    function evaluateScheduleQualityDiagnostics({ sowDate, feasibleResult, planner }) { // ADDED
        if (!feasibleResult || !feasibleResult.ok) return []; // ADDED
        const ctx = planner.ctx; // ADDED
        const plant = ctx.plant || {}; // ADDED
        const diagnostics = []; // ADDED

        const establishmentMax = numberOrNull(plant.establishment_temp_max_c); // ADDED
        const establishmentPolicy = policyForFactor(plant, 'establishment_heat', 'warn'); // ADDED
        if (establishmentMax != null && establishmentPolicy !== 'off') { // ADDED
            const days = Math.max(1, Math.round(numberOrNull(plant.establishment_heat_window_days) ?? numberOrNull(plant.days_germ) ?? 3)); // ADDED
            const observed = sampleMeanTempOverDays(sowDate, days, ctx); // ADDED
            if (observed > establishmentMax) diagnostics.push(makeDiagnostic({ // ADDED
                factor: 'establishment_heat', // ADDED
                stage: 'establishment', // ADDED
                severity: establishmentPolicy === 'block' ? 'block' : 'warning', // ADDED
                policy: establishmentPolicy, // ADDED
                startDate: sowDate, // ADDED
                endDate: addDaysUTC(sowDate, days), // ADDED
                threshold: establishmentMax, // ADDED
                observed: Number(observed.toFixed(1)), // ADDED
                message: `Establishment heat risk: mean temperature ${observed.toFixed(1)} C exceeds ${establishmentMax} C.` // ADDED
            })); // ADDED
        } // ADDED

        const qualityMax = numberOrNull(plant.quality_temp_max_c); // ADDED
        const qualityPolicy = policyForFactor(plant, 'quality_heat', 'warn'); // ADDED
        if (qualityMax != null && qualityPolicy !== 'off') { // ADDED
            const stage = String(plant.heat_stress_stage || 'harvest_quality').trim() || 'harvest_quality'; // ADDED
            const stageDate = dateForDiagnosticStage(stage, sowDate, feasibleResult, plant); // ADDED
            const observed = sampleMeanTempOverDays(stageDate, Math.max(1, Math.min(ctx.HW_DAYS || 1, 7)), ctx); // ADDED
            if (observed > qualityMax) diagnostics.push(makeDiagnostic({ // ADDED
                factor: 'quality_heat', // ADDED
                stage, // ADDED
                severity: qualityPolicy === 'block' ? 'block' : 'warning', // ADDED
                policy: qualityPolicy, // ADDED
                startDate: stageDate, // ADDED
                endDate: addDaysUTC(stageDate, Math.max(1, Math.min(ctx.HW_DAYS || 1, 7))), // ADDED
                threshold: qualityMax, // ADDED
                observed: Number(observed.toFixed(1)), // ADDED
                message: `Quality heat risk: mean ${stage} temperature ${observed.toFixed(1)} C exceeds ${qualityMax} C.` // ADDED
            })); // ADDED
        } // ADDED

        const criticalDaylength = numberOrNull(plant.critical_daylength_hours); // ADDED
        const photoperiodResponse = String(plant.photoperiod_response || '').trim().toLowerCase(); // ADDED
        const photoperiodPolicy = policyForFactor(plant, 'photoperiod', 'warn'); // ADDED
        if (criticalDaylength != null && photoperiodResponse && photoperiodResponse !== 'day_neutral' && photoperiodPolicy !== 'off') { // ADDED
            const stage = String(plant.photoperiod_stage || 'maturity').trim() || 'maturity'; // ADDED
            const stageDate = dateForDiagnosticStage(stage, sowDate, feasibleResult, plant); // ADDED
            const latitude = numberOrNull(ctx.cityLatitudeDeg); // ADDED
            const observed = dayLengthHours(stageDate, latitude); // ADDED
            if (observed == null) { // ADDED
                diagnostics.push(makeDiagnostic({ // ADDED
                    factor: 'photoperiod', // ADDED
                    stage, // ADDED
                    severity: 'info', // ADDED
                    policy: photoperiodPolicy, // ADDED
                    startDate: stageDate, // ADDED
                    endDate: stageDate, // ADDED
                    threshold: criticalDaylength, // ADDED
                    observed: null, // ADDED
                    message: 'Photoperiod data missing: city latitude is missing or outside the supported -66.5 to 66.5 degree range.' // CHANGED
                })); // ADDED
            } else { // ADDED
                const mismatch = (photoperiodResponse === 'long_day' && observed < criticalDaylength) // ADDED
                    || (photoperiodResponse === 'short_day' && observed > criticalDaylength); // ADDED
                if (mismatch) diagnostics.push(makeDiagnostic({ // ADDED
                    factor: 'photoperiod', // ADDED
                    stage, // ADDED
                    severity: photoperiodPolicy === 'block' ? 'block' : 'warning', // ADDED
                    policy: photoperiodPolicy, // ADDED
                    startDate: stageDate, // ADDED
                    endDate: stageDate, // ADDED
                    threshold: criticalDaylength, // ADDED
                    observed: Number(observed.toFixed(1)), // ADDED
                    message: `Photoperiod risk: ${stage} day length ${observed.toFixed(1)} h does not fit ${photoperiodResponse.replace('_', '-')} threshold ${criticalDaylength} h.` // ADDED
                })); // ADDED
            } // ADDED
        } // ADDED

        const chillingRequired = numberOrNull(plant.chilling_required_days) ?? (numberOrNull(plant.chilling_required_hours) != null ? numberOrNull(plant.chilling_required_hours) / 24 : null); // ADDED
        const chillingMin = numberOrNull(plant.chilling_temp_min_c) ?? -2; // ADDED
        const chillingMax = numberOrNull(plant.chilling_temp_max_c) ?? 10; // ADDED
        const chillingPolicy = policyForFactor(plant, 'chilling', 'warn'); // ADDED
        if (chillingRequired != null && chillingRequired > 0 && chillingPolicy !== 'off') { // ADDED
            const stage = String(plant.chilling_stage || 'maturity').trim() || 'maturity'; // ADDED
            const stageDate = dateForDiagnosticStage(stage, sowDate, feasibleResult, plant); // ADDED
            let count = 0; // ADDED
            for (let d = new Date(sowDate); d < stageDate; d = addDaysUTC(d, 1)) { // CHANGED
                const temp = weightedMeanTempOverRange(d, addDaysUTC(d, 1), ctx.monthlyAvg, ctx.dailyRates, ctx.Tbase, ctx.dailyClimate, ctx.bedProfile); // CHANGED
                if (temp >= chillingMin && temp <= chillingMax) count += 1; // ADDED
            } // ADDED
            if (count < chillingRequired) diagnostics.push(makeDiagnostic({ // ADDED
                factor: 'chilling', // ADDED
                stage, // ADDED
                severity: chillingPolicy === 'block' ? 'block' : 'warning', // ADDED
                policy: chillingPolicy, // ADDED
                startDate: sowDate, // CHANGED
                endDate: stageDate, // ADDED
                threshold: Number(chillingRequired.toFixed(1)), // ADDED
                observed: Number(count.toFixed(1)), // ADDED
                message: `Chilling risk: ${count.toFixed(0)} suitable chilling days before ${stage}, below required ${chillingRequired.toFixed(0)}.` // ADDED
            })); // ADDED
        } // ADDED

        return diagnostics; // ADDED
    }
    function diagnosticsHaveBlockingPolicy(diagnostics) { // ADDED
        return (diagnostics || []).some(diagnostic => diagnostic && diagnostic.policy === 'block' && diagnostic.severity === 'block'); // ADDED
    }
    function summarizeWindowDiagnostics(diagnostics) { // ADDED
        const countsByLabel = new Map(); // CHANGED
        for (const diagnostic of diagnostics || []) { // ADDED
            const label = diagnosticLabel(diagnostic); // ADDED
            if (label) countsByLabel.set(label, (countsByLabel.get(label) || 0) + 1); // CHANGED
        } // ADDED
        return Array.from(countsByLabel.keys()).sort().map(label => { // CHANGED
            const count = countsByLabel.get(label) || 0; // ADDED
            return `${label} (${count} ${count === 1 ? 'date' : 'dates'})`; // ADDED
        }).join(', '); // CHANGED
    }
    function diagnosticRangeKey(diagnostic) { // ADDED
        return [ // ADDED
            diagnostic?.factor || '', // ADDED
            diagnostic?.severity || '', // ADDED
            diagnostic?.policy || '', // ADDED
            diagnostic?.stage || '', // ADDED
            diagnostic?.threshold ?? '' // ADDED
        ].join('|'); // ADDED
    }
    function compressScheduleQualityDiagnosticRanges(rows) { // ADDED
        const ranges = []; // ADDED
        const openByKey = new Map(); // ADDED
        function closeMissingKeys(activeKeys, previousISO) { // ADDED
            for (const [key, range] of Array.from(openByKey.entries())) { // ADDED
                if (activeKeys.has(key)) continue; // ADDED
                range.endISO = previousISO || range.endISO; // ADDED
                ranges.push(Object.freeze(range)); // ADDED
                openByKey.delete(key); // ADDED
            } // ADDED
        } // ADDED
        let previousISO = ''; // ADDED
        for (const row of rows || []) { // ADDED
            const sowISO = String(row?.sowISO || '').trim(); // ADDED
            if (!sowISO) continue; // ADDED
            const diagnostics = Array.isArray(row.diagnostics) ? row.diagnostics : []; // ADDED
            const activeKeys = new Set(diagnostics.map(diagnosticRangeKey)); // ADDED
            closeMissingKeys(activeKeys, previousISO); // ADDED
            for (const diagnostic of diagnostics) { // ADDED
                const key = diagnosticRangeKey(diagnostic); // ADDED
                const observed = numberOrNull(diagnostic.observed); // ADDED
                let range = openByKey.get(key); // ADDED
                if (!range) { // ADDED
                    range = { // ADDED
                        factor: diagnostic.factor, // ADDED
                        severity: diagnostic.severity, // ADDED
                        policy: diagnostic.policy, // ADDED
                        stage: diagnostic.stage, // ADDED
                        label: diagnosticLabel(diagnostic), // ADDED
                        startISO: sowISO, // ADDED
                        endISO: sowISO, // ADDED
                        threshold: diagnostic.threshold ?? null, // ADDED
                        observedMin: observed, // ADDED
                        observedMax: observed, // ADDED
                        messages: [] // ADDED
                    }; // ADDED
                    openByKey.set(key, range); // ADDED
                } // ADDED
                range.endISO = sowISO; // ADDED
                if (observed != null) { // ADDED
                    range.observedMin = range.observedMin == null ? observed : Math.min(range.observedMin, observed); // ADDED
                    range.observedMax = range.observedMax == null ? observed : Math.max(range.observedMax, observed); // ADDED
                } // ADDED
                if (diagnostic.message && range.messages.indexOf(diagnostic.message) < 0 && range.messages.length < 3) { // ADDED
                    range.messages.push(diagnostic.message); // ADDED
                } // ADDED
            } // ADDED
            previousISO = sowISO; // ADDED
        } // ADDED
        closeMissingKeys(new Set(), previousISO); // ADDED
        return ranges; // ADDED
    }
    function evaluateSowDateDiagnostics(inputs, startISO = inputs?.startISO) { // ADDED
        const sowDate = parseISODateUTCValue(startISO); // ADDED
        if (!sowDate) { // ADDED
            return Object.freeze({ feasible: false, reason: 'invalid_sow_date', diagnostics: Object.freeze([]), blockingDiagnostics: Object.freeze([]) }); // ADDED
        } // ADDED
        const planner = new Planner(inputs); // ADDED
        const feasibleResult = planner.isSowFeasible(sowDate); // ADDED
        const diagnostics = feasibleResult.ok ? evaluateScheduleQualityDiagnostics({ sowDate, feasibleResult, planner }) : []; // ADDED
        const blockingDiagnostics = diagnostics.filter(diagnostic => diagnostic?.policy === 'block' && diagnostic?.severity === 'block'); // ADDED
        return Object.freeze({ // ADDED
            feasible: !!feasibleResult.ok, // ADDED
            reason: feasibleResult.reason || '', // ADDED
            diagnostics: Object.freeze(diagnostics.slice()), // ADDED
            blockingDiagnostics: Object.freeze(blockingDiagnostics), // ADDED
            feasibleResult // ADDED
        }); // ADDED
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
                annualCrossYearHarvestAllowed: policy.annualCrossYearHarvestAllowed !== false, // ADDED
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
                bedProfileSource: inputs.bedProfileSource || 'generic garden bed', // ADDED
                Tbase: env.Tbase,
                cityLatitudeDeg: finiteNumberOrNull(inputs.cityLatitudeDeg ?? city?.latitude ?? city?.lat), // CHANGED: Cities.latitude is canonical.
                city, // ADDED
                startDate,
                seasonEnd,
                scanStart,
                sowScanEnd: asUTCDate(scanStart.getUTCFullYear(), 12, 31), // ADDED
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
            if (isOverwinterSpringWindowDate(C, gateDate)) return { ok: true }; // ADDED
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
            if (isOverwinterSpringWindowDate(C, gateDate)) return { ok: true }; // ADDED
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
            return assessSowDateForSchedule(this, sowDate); // CHANGED
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
    function validateNonThermalSowDate(planner, sowDate) { // ADDED
        if (!planner.withinWindow(sowDate) || sowDate > planner.ctx.sowScanEnd) return { ok: false, reason: 'outside_scan_window' }; // CHANGED
        const gateDate = getGateDateForCandidate(planner, sowDate); // ADDED
        if (!gateDate || !planner.withinWindow(gateDate)) return { ok: false, reason: 'gate_outside_scan_window' }; // ADDED
        const frost = planner.checkSpringFrostGate(gateDate); // ADDED
        if (!frost.ok) return frost; // ADDED
        const cooling = planner.checkCoolingGate(gateDate); // ADDED
        if (!cooling.ok) return cooling; // ADDED
        const soil = planner.checkSoilGate(gateDate); // ADDED
        if (!soil.ok) return soil; // ADDED
        return { ok: true, gateDate }; // ADDED
    } // ADDED
    function formatInsufficientGddBeforeColdReason(available, targetGdd, deadline) { // ADDED
        const gdd = finiteNumberOrNull(available?.gdd) || 0; // ADDED
        const target = finiteNumberOrNull(targetGdd) || 0; // ADDED
        const lethalISO = deadline?.coldFailure?.date ? fmtISO(deadline.coldFailure.date) : 'unknown'; // ADDED
        return `insufficient_gdd_before_cold(gdd ${gdd.toFixed(1)}<${target.toFixed(1)} deadline ${lethalISO})`; // ADDED
    } // ADDED
    function resolveInsufficientGddBeforeColdMaturity(planner, sowDate, warnings, deadline, available) { // ADDED
        const C = planner.ctx; // ADDED
        if (!(available?.gdd > 0)) { // ADDED
            return { ok: false, reason: `insufficient_gdd_before_cold_no_heat(deadline ${fmtISO(deadline.coldFailure.date)})` }; // ADDED
        } // ADDED
        const requiredScale = C.BUDGET.amount / available.gdd; // ADDED
        if (!Number.isFinite(requiredScale) || requiredScale > THERMAL_GDD_SCALE_CAP) { // ADDED
            return { ok: false, reason: `insufficient_gdd_before_cold_scale_cap(scale ${Number.isFinite(requiredScale) ? requiredScale.toFixed(2) : 'n/a'}>${THERMAL_GDD_SCALE_CAP.toFixed(2)} deadline ${fmtISO(deadline.coldFailure.date)})` }; // ADDED
        } // ADDED
        const scheduleScale = requiredScale < THERMAL_GDD_SCALE_CAP ? Math.min(THERMAL_GDD_SCALE_CAP, requiredScale * 1.000001) : requiredScale; // ADDED
        const scaled = accumulateScaledGDDUntil(sowDate, C.BUDGET.amount, C.dailyRates, deadline.date, scheduleScale); // CHANGED
        warnings.push(thermalWarning('insufficient_gdd_before_cold_scaled_fallback', `There is not enough heat before lethal cold; using ${scheduleScale.toFixed(2)}x scaled GDD through ${fmtISO(deadline.date)} for schedule anchors.`, { scaleFactor: scheduleScale, deadlineISO: fmtISO(deadline.date), lethalColdISO: fmtISO(deadline.coldFailure.date) })); // CHANGED
        return { ok: true, maturity: scaled.date, gddScaleFactor: scheduleScale, deadline }; // CHANGED
    } // ADDED
    function resolveInsufficientGddMaturity(planner, sowDate, warnings) { // ADDED
        const C = planner.ctx; // ADDED
        const daysMaturity = finiteNumberOrNull(C.plant?.days_maturity); // ADDED
        if (daysMaturity != null && daysMaturity > 0) { // ADDED
            const maturity = addDaysUTC(sowDate, Math.round(daysMaturity)); // ADDED
            warnings.push(thermalWarning('insufficient_gdd_dtm_fallback', `There is not enough growing-degree accumulation to reach maturity; using days to maturity (${Math.round(daysMaturity)} days) for schedule anchors.`)); // ADDED
            return { ok: true, maturity }; // ADDED
        } // ADDED
        const deadline = resolveThermalGddDeadline(planner, sowDate); // ADDED
        const available = accumulateGDDUntil(sowDate, C.BUDGET.amount, C.dailyRates, deadline.date); // ADDED
        if (!(available.gdd > 0)) { // ADDED
            return { ok: false, reason: 'insufficient_gdd_no_heat' }; // ADDED
        } // ADDED
        const requiredScale = C.BUDGET.amount / available.gdd; // ADDED
        if (!Number.isFinite(requiredScale) || requiredScale > THERMAL_GDD_SCALE_CAP) { // ADDED
            return { ok: false, reason: 'insufficient_gdd_scale_cap' }; // ADDED
        } // ADDED
        const scaled = accumulateScaledGDDUntil(sowDate, C.BUDGET.amount, C.dailyRates, deadline.date, requiredScale); // ADDED
        warnings.push(thermalWarning('insufficient_gdd_scaled_fallback', `There is not enough growing-degree accumulation to reach maturity; using ${requiredScale.toFixed(2)}x scaled GDD through the ${deadline.source} for schedule anchors.`, { scaleFactor: requiredScale, deadlineISO: fmtISO(deadline.date), deadlineSource: deadline.source })); // ADDED
        return { ok: true, maturity: scaled.date, gddScaleFactor: requiredScale, deadline }; // ADDED
    } // ADDED
    function assessSowDateForSchedule(planner, sowDate, options = {}) { // ADDED
        const C = planner.ctx; // ADDED
        const allowThermalWarnings = options.allowThermalWarnings === true; // ADDED
        const warnings = []; // ADDED
        const nonThermal = validateNonThermalSowDate(planner, sowDate); // ADDED
        if (!nonThermal.ok) return nonThermal; // ADDED
        const fieldStartDate = nonThermal.gateDate || sowDate; // ADDED
        let mat = null; // ADDED
        if (C.BUDGET.mode === 'gdd') { // ADDED
            const thermalDeadline = resolveThermalGddDeadline(planner, sowDate); // ADDED
            const coldDeadline = coldSurvivalGddDeadline(planner, fieldStartDate); // ADDED
            const deadline = earlierGddDeadline(thermalDeadline, coldDeadline); // ADDED
            const acc = accumulateGDDUntil(sowDate, C.BUDGET.amount, C.dailyRates, deadline.date); // CHANGED
            if (acc.reached) mat = acc.date; // ADDED
            else if (deadline === coldDeadline) { // ADDED
                if (!allowThermalWarnings) return { ok: false, reason: formatInsufficientGddBeforeColdReason(acc, C.BUDGET.amount, coldDeadline) }; // ADDED
                const fallback = resolveInsufficientGddBeforeColdMaturity(planner, sowDate, warnings, coldDeadline, acc); // ADDED
                if (!fallback.ok) return fallback; // ADDED
                mat = fallback.maturity; // ADDED
            } // ADDED
            else if (!allowThermalWarnings) return { ok: false, reason: 'insufficient_gdd' }; // CHANGED
            else { // ADDED
                const fallback = resolveInsufficientGddMaturity(planner, sowDate, warnings); // ADDED
                if (!fallback.ok) return fallback; // ADDED
                mat = fallback.maturity; // ADDED
            } // ADDED
        } else { // ADDED
            mat = maturityDateFromBudget(sowDate, C.BUDGET, C.dailyRates, C.scanEndHard); // ADDED
        } // ADDED
        const fullHarvestEnd = planner.addDays(mat, C.HW_DAYS); // ADDED
        if (!C.annualCrossYearHarvestAllowed && sowDate.getUTCFullYear() !== fullHarvestEnd.getUTCFullYear()) { // CHANGED
            return { ok: false, reason: 'cross_year_disallowed' }; // ADDED
        } // ADDED
        const hardEnd = C.scanEndHard; // ADDED
        const effectiveHarvestEnd = (fullHarvestEnd <= hardEnd) ? fullHarvestEnd : hardEnd; // ADDED
        const MS_PER_DAY = 24 * 60 * 60 * 1000; // ADDED
        const harvestSpanDays = Math.max(0, Math.round((effectiveHarvestEnd.getTime() - mat.getTime()) / MS_PER_DAY)); // ADDED
        const minHarvestDays = Math.min(C.HW_DAYS, 3); // ADDED
        if (harvestSpanDays < minHarvestDays) return { ok: false, reason: 'beyond_hard_end' }; // ADDED
        const survival = assessColdSurvival(planner, fieldStartDate, effectiveHarvestEnd); // CHANGED
        if (!survival.ok) return survival; // ADDED
        const TmeanHarvest = weightedMeanTempOverRange(mat, effectiveHarvestEnd, C.monthlyAvg, C.dailyRates, C.Tbase, C.dailyClimate, C.bedProfile); // CHANGED
        const { Tmin, Tmax } = C.env; // ADDED
        if (TmeanHarvest < Tmin) { // ADDED
            if (!allowThermalWarnings) return { ok: false, reason: `harvest_too_cold(${TmeanHarvest.toFixed(1)}<${Tmin})` }; // ADDED
            warnings.push(thermalWarning('harvest_too_cold', `Expected harvest temperature ${TmeanHarvest.toFixed(1)} C is below the crop minimum ${Tmin} C.`)); // ADDED
        } // ADDED
        if (TmeanHarvest > Tmax) { // ADDED
            if (!allowThermalWarnings) return { ok: false, reason: `harvest_too_hot(${TmeanHarvest.toFixed(1)}>${Tmax})` }; // ADDED
            warnings.push(thermalWarning('harvest_too_hot', `Expected harvest temperature ${TmeanHarvest.toFixed(1)} C is above the crop maximum ${Tmax} C.`)); // ADDED
        } // ADDED
        const truncated = fullHarvestEnd.getTime() > effectiveHarvestEnd.getTime(); // ADDED
        const crossYearHarvest = sowDate.getUTCFullYear() !== effectiveHarvestEnd.getUTCFullYear(); // ADDED
        return { ok: true, maturity: mat, harvestStart: mat, harvestEnd: effectiveHarvestEnd, truncated, crossYearHarvest, TmeanHarvest, warnings: Object.freeze(warnings) }; // CHANGED
    } // ADDED
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
            reason.indexOf('insufficient_gdd_before_cold') === 0 || // ADDED
            reason === 'insufficient_gdd';
    }
    function impliedHarvestEndForDate(planner, sow, HW_DAYS) {
        const C = planner.ctx;
        const mat = maturityDateFromBudget(sow, C.BUDGET, C.dailyRates, C.scanEndHard);
        return planner.addDays(mat, Math.max(0, HW_DAYS || 0));
    }
    function meteorologicalSeasonName(date) { // ADDED
        const month = date.getUTCMonth() + 1; // ADDED
        if (month >= 3 && month <= 5) return 'Spring'; // ADDED
        if (month >= 6 && month <= 8) return 'Summer'; // ADDED
        if (month >= 9 && month <= 11) return 'Fall'; // ADDED
        return 'Winter'; // ADDED
    }
    function formatShortMonthDay(date) { // ADDED
        return date.toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }); // ADDED
    }
    function labelSowingSeasons(windows) { // ADDED
        const seasonCounts = Object.create(null); // ADDED
        return windows.map((win, index) => { // ADDED
            const mid = addDaysUTC(win.startDate, Math.floor((daysBetweenInclusive(win.startDate, win.endDate) - 1) / 2)); // ADDED
            const season = meteorologicalSeasonName(mid); // ADDED
            seasonCounts[season] = (seasonCounts[season] || 0) + 1; // ADDED
            const suffix = seasonCounts[season] > 1 ? ` ${seasonCounts[season]}` : ''; // ADDED
            const label = `${season}${suffix} (${formatShortMonthDay(win.startDate)}-${formatShortMonthDay(win.endDate)})`; // ADDED
            return Object.freeze({ // ADDED
                id: `window-${index + 1}`, // ADDED
                label, // ADDED
                startISO: fmtISO(win.startDate), // ADDED
                endISO: fmtISO(win.endDate), // ADDED
                startDate: new Date(win.startDate), // ADDED
                endDate: new Date(win.endDate), // ADDED
                diagnostics: Object.freeze((win.diagnostics || []).slice()), // ADDED
                riskSummary: summarizeWindowDiagnostics(win.diagnostics || []), // ADDED
                source: Object.freeze({ // ADDED
                    firstFeasibleISO: fmtISO(win.firstFeasibleDate || win.startDate), // ADDED
                    lastFeasibleISO: fmtISO(win.lastFeasibleDate || win.endDate), // ADDED
                    mergedGapDays: Number(win.mergedGapDays || 0) // ADDED
                }) // ADDED
            }); // ADDED
        }); // ADDED
    }
    function smoothFeasibleSowingRanges(ranges, { maxGapDays = MULTI_WINDOW_MAX_MERGE_GAP_DAYS, minLengthDays = MULTI_WINDOW_MIN_LENGTH_DAYS } = {}) { // ADDED
        const sorted = (ranges || []) // ADDED
            .filter(range => range && range.startDate instanceof Date && range.endDate instanceof Date) // ADDED
            .sort((a, b) => a.startDate - b.startDate); // ADDED
        const merged = []; // ADDED
        for (const range of sorted) { // ADDED
            if (!merged.length) { // ADDED
                merged.push({ ...range, firstFeasibleDate: range.startDate, lastFeasibleDate: range.endDate, mergedGapDays: 0, diagnostics: (range.diagnostics || []).slice() }); // CHANGED
                continue; // ADDED
            } // ADDED
            const prev = merged[merged.length - 1]; // ADDED
            const gapDays = Math.max(0, Math.round((range.startDate.getTime() - prev.endDate.getTime()) / 86400000) - 1); // ADDED
            if (gapDays <= maxGapDays) { // ADDED
                prev.endDate = new Date(range.endDate); // ADDED
                prev.lastFeasibleDate = new Date(range.endDate); // ADDED
                prev.mergedGapDays += gapDays; // ADDED
                prev.diagnostics = (prev.diagnostics || []).concat(range.diagnostics || []); // ADDED
            } else { // ADDED
                merged.push({ ...range, firstFeasibleDate: range.startDate, lastFeasibleDate: range.endDate, mergedGapDays: 0, diagnostics: (range.diagnostics || []).slice() }); // CHANGED
            } // ADDED
        } // ADDED
        return merged.filter(range => daysBetweenInclusive(range.startDate, range.endDate) >= minLengthDays); // ADDED
    }
    function assignDiagnosticsToSmoothedRanges(ranges, scanRows) { // ADDED
        return (ranges || []).map(range => { // ADDED
            const diagnostics = []; // ADDED
            for (const row of scanRows || []) { // ADDED
                if (!row?.date || row.date < range.startDate || row.date > range.endDate) continue; // ADDED
                diagnostics.push(...(row.diagnostics || [])); // ADDED
            } // ADDED
            return { ...range, diagnostics }; // ADDED
        }); // ADDED
    }
    function computeAnnualSowingSeasons(params) { // ADDED
        const resolvedHarvestWindowDays = resolveHarvestWindowDays(params.HW_DAYS); // ADDED
        const { planner, resolvedBehavior } = buildAutoWindowPlanner({ // ADDED
            ...params, // ADDED
            HW_DAYS: resolvedHarvestWindowDays // ADDED
        }); // ADDED
        const C = planner.ctx; // ADDED
        const seasonScanEnd = C.sowScanEnd || asUTCDate(C.scanStart.getUTCFullYear(), 12, 31); // CHANGED
        const sowScanEnd = seasonScanEnd < C.scanEndHard ? seasonScanEnd : C.scanEndHard; // ADDED
        const ranges = []; // ADDED
        const scanRows = []; // ADDED
        let current = null; // ADDED
        let firstHarvestEnd = null; // ADDED
        let lastHarvestEnd = null; // ADDED
        for (let d = new Date(C.scanStart); dateLTE(d, sowScanEnd); d = planner.addDays(d, 1)) { // ADDED
            const r = planner.isSowFeasible(d); // ADDED
            const diagnostics = r.ok ? evaluateScheduleQualityDiagnostics({ sowDate: d, feasibleResult: r, planner }) : []; // ADDED
            scanRows.push({ date: new Date(d), diagnostics }); // ADDED
            const blockedByDiagnostics = diagnosticsHaveBlockingPolicy(diagnostics); // ADDED
            if (r.ok && !blockedByDiagnostics) { // CHANGED
                if (!current) current = { startDate: new Date(d), endDate: new Date(d), diagnostics: [] }; // CHANGED
                current.endDate = new Date(d); // ADDED
                if (!firstHarvestEnd) firstHarvestEnd = r.harvestEnd; // ADDED
                if (!lastHarvestEnd || r.harvestEnd > lastHarvestEnd) lastHarvestEnd = r.harvestEnd; // ADDED
            } else if (current) { // ADDED
                ranges.push(current); // ADDED
                current = null; // ADDED
            } // ADDED
        } // ADDED
        if (current) ranges.push(current); // ADDED
        const smoothedRanges = smoothFeasibleSowingRanges(ranges, params.windowOptions || {}); // ADDED
        const seasons = labelSowingSeasons(assignDiagnosticsToSmoothedRanges(smoothedRanges, scanRows)); // CHANGED
        return Object.freeze({ // ADDED
            feasible: seasons.length > 0, // ADDED
            harvestEndSemantics: HARVEST_END_SEMANTICS, // ADDED
            seasons, // CHANGED: public annual-core result now uses sowing-season terminology.
            seasonStartYear: C.scanStart.getUTCFullYear(), // ADDED
            scanStartISO: fmtISO(C.scanStart), // ADDED
            scanEndISO: fmtISO(sowScanEnd), // ADDED
            lifecycleScanEndISO: fmtISO(C.scanEndHard), // ADDED
            resolvedMethod: resolvedBehavior, // ADDED
            earliestFeasibleSowDate: seasons.length ? new Date(seasons[0].startDate) : null, // ADDED
            lastFeasibleSowDate: seasons.length ? new Date(seasons[seasons.length - 1].endDate) : null, // ADDED
            climateEndDate: lastHarvestEnd || firstHarvestEnd || null // ADDED
        }); // ADDED
    }
    function computeScheduleQualityDiagnosticRangesForPlanner(planner) { // ADDED
        const C = planner.ctx; // ADDED
        const seasonScanEnd = asUTCDate(C.scanStart.getUTCFullYear(), 12, 31); // ADDED
        const sowScanEnd = seasonScanEnd < C.scanEndHard ? seasonScanEnd : C.scanEndHard; // ADDED
        const rows = []; // ADDED
        for (let d = new Date(C.scanStart); dateLTE(d, sowScanEnd); d = planner.addDays(d, 1)) { // ADDED
            const feasibleResult = planner.isSowFeasible(d); // ADDED
            rows.push({ // ADDED
                sowISO: fmtISO(d), // ADDED
                diagnostics: feasibleResult.ok ? evaluateScheduleQualityDiagnostics({ sowDate: d, feasibleResult, planner }) : [] // ADDED
            }); // ADDED
        } // ADDED
        return Object.freeze(compressScheduleQualityDiagnosticRanges(rows)); // ADDED
    }
    function computeScheduleQualityDiagnosticRangesForInputs(inputs) { // ADDED
        return computeScheduleQualityDiagnosticRangesForPlanner(new Planner(inputs)); // ADDED
    }
    function computeScheduleQualityDiagnosticRanges(params) { // ADDED
        const resolvedHarvestWindowDays = resolveHarvestWindowDays(params.HW_DAYS); // ADDED
        const { planner } = buildAutoWindowPlanner({ // ADDED
            ...params, // ADDED
            HW_DAYS: resolvedHarvestWindowDays // ADDED
        }); // ADDED
        return computeScheduleQualityDiagnosticRangesForPlanner(planner); // ADDED
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
            plantMetadata = null, // ADDED
            cityLatitudeDeg = null, // ADDED
            bedProfile = null,
            bedProfileSource = 'generic garden bed'
        } = params;

        const resolvedBehavior = resolveMethodBehavior({ methodCategoryId, methodId });
        validateAutoWindowMethodInputs({ resolvedBehavior, daysTransplant });
        const effectiveScanEndHard = asUTCDate(Math.max(scanEndHard.getUTCFullYear(), scanStart.getUTCFullYear() + 1), 12, 31); // ADDED
        const fakePlant = {
            start_cooling_threshold_c: startCoolingThresholdC,
            soil_temp_min_plant_c: soilGateThresholdC,
            isPerennial: () => false,
            isBiennial: () => false,
            overwinter_ok: overwinterAllowed ? 1 : 0,
            days_transplant: daysTransplant,
            days_germ: plantMetadata?.days_germ, // ADDED
            ...(plantMetadata || {}), // ADDED
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
            seasonEndISO: effectiveScanEndHard.toISOString().slice(0, 10), // CHANGED
            policy,
            seasonStartYear: scanStart.getUTCFullYear(),
            harvestWindowDays: HW_DAYS,
            bedProfile,
            bedProfileSource,
            dailyClimate: dailyClimate || buildDailyTemperatureSeries({
                startDate: scanStart,
                endDate: effectiveScanEndHard, // CHANGED
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
        const sowScanEnd = C.sowScanEnd || asUTCDate(C.scanStart.getUTCFullYear(), 12, 31); // CHANGED
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
    function computeAnnualScheduleResult(inputs, options = {}) { // CHANGED
        const { plant, methodId } = inputs;
        const method = methodId;
        const startDate = parseISODateUTCValue(inputs.startISO);
        if (!startDate) throw new Error('Select a planting date.');
        const { seasonEnd, env, dailyRates } = inputs.derived();
        const planner = new Planner(inputs);
        const feasibility = assessSowDateForSchedule(planner, startDate, { allowThermalWarnings: options.allowThermalWarnings === true }); // CHANGED
        if (!feasibility.ok) {
            throw new Error(`Selected sow date is not feasible: ${humanFeasibilityReason(feasibility.reason)}`);
        }
        const warnings = Array.from(feasibility.warnings || []); // ADDED
        if (feasibility.crossYearHarvest) warnings.push(thermalWarning('cross_year_harvest_allowed', 'Climate-based checks allow this annual harvest to continue into the next calendar year.')); // ADDED
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
            const message = `Selected sow date yield multiplier ${yieldMultipliers[0].toFixed(2)} is below the minimum ${minYieldMultiplier.toFixed(2)}.`; // ADDED
            if (options.allowThermalWarnings === true) warnings.push(thermalWarning('yield_multiplier_below_minimum', message)); // ADDED
            else throw new Error(message); // CHANGED
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
            warnings: Object.freeze(warnings) // ADDED
        };
    }

    win.USL.scheduler.annualCore = Object.freeze({
        Planner,
        accumulateGDDUntil,
        accumulateGDDBackward,
        maturityDateFromBudget,
        thermalYieldFactor,
        weightedMeanTempOverRange,
        dayLengthHours, // ADDED
        evaluateScheduleQualityDiagnostics, // ADDED
        evaluateSowDateDiagnostics, // ADDED
        diagnosticsHaveBlockingPolicy, // ADDED
        computeScheduleQualityDiagnosticRanges, // ADDED
        computeScheduleQualityDiagnosticRangesForInputs, // ADDED
        computeScheduleQualityDiagnosticRangesForPlanner, // ADDED
        compressScheduleQualityDiagnosticRanges, // ADDED
        diagnosticLabel, // ADDED
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
        assessSowDateForSchedule, // ADDED
        computeAnnualScheduleResult
    });
})(typeof window !== 'undefined' ? window : globalThis);
