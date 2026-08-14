// USL Draw.io Plugin Module: Garden Scheduler shared pure helpers.
(function (root) {
    'use strict';

    const win = root || {};
    win.USL = win.USL || {};
    win.USL.scheduler = win.USL.scheduler || {};

    const DEFAULT_HARVEST_WINDOW_DAYS = 7;
    const HARVEST_END_SEMANTICS = 'exclusive';
    const INFERRED_SPRING_FROST_BUFFER_DAYS = 14; // ADDED: shared missing-frost policy for scheduler/runtime callers.
    const INFERRED_FALL_FROST_BUFFER_DAYS = 14; // ADDED: shared missing-fall-frost policy for thermal deadline callers.
    const SPRING_FROST_FALLBACK_DOY = 105; // ADDED: final conservative fallback when monthly lows cannot support inference.
    const SEASON_EXTENSION_EFFECTS = Object.freeze({
        unknown: Object.freeze({ airOffsetC: 0, soilOffsetC: 0, frostShiftDays: 0, minAirTempC: null }),
        none: Object.freeze({ airOffsetC: 0, soilOffsetC: 0, frostShiftDays: 0, minAirTempC: null }),
        row_cover: Object.freeze({ airOffsetC: 0.5, soilOffsetC: 0.5, frostShiftDays: -3, minAirTempC: null }),
        low_tunnel: Object.freeze({ airOffsetC: 1.5, soilOffsetC: 1.0, frostShiftDays: -7, minAirTempC: null }),
        cold_frame: Object.freeze({ airOffsetC: 2.0, soilOffsetC: 1.5, frostShiftDays: -10, minAirTempC: null }),
        greenhouse: Object.freeze({ airOffsetC: 3.0, soilOffsetC: 2.0, frostShiftDays: -21, minAirTempC: null }),
        high_tunnel: Object.freeze({ airOffsetC: 2.5, soilOffsetC: 1.5, frostShiftDays: -14, minAirTempC: null }),
        heated_greenhouse: Object.freeze({ airOffsetC: 5.0, soilOffsetC: 3.0, frostShiftDays: -45, minAirTempC: 5.0 })
    });

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
    function clampNumber(value, min, max) {
        const n = Number(value);
        if (!Number.isFinite(n)) return min;
        return Math.max(min, Math.min(max, n));
    }
    function dateKeyUTC(date) {
        return date ? date.toISOString().slice(0, 10) : '';
    }
    function normalizeTemperatureRecord(record) {
        const scalar = finiteNumberOrNull(record);
        if (scalar != null) return { min: scalar, max: scalar, mean: scalar };
        const min = finiteNumberOrNull(record?.min ?? record?.temp_min_c ?? record?.low);
        const max = finiteNumberOrNull(record?.max ?? record?.temp_max_c ?? record?.high);
        let mean = finiteNumberOrNull(record?.mean ?? record?.temp_mean_c ?? record?.avg);
        if (mean == null && min != null && max != null) mean = (min + max) / 2;
        if (mean == null) return null;
        return {
            min: min == null ? mean : min,
            max: max == null ? mean : max,
            mean
        };
    }
    function monthlyTemperatureNormalsFromCity(city) {
        const out = {};
        for (let m = 1; m <= 12; m++) {
            const min = finiteNumberOrNull(city?.[`avg_monthly_low_c${m}`]);
            const max = finiteNumberOrNull(city?.[`avg_monthly_high_c${m}`]);
            if (min == null && max == null) continue;
            const mean = min != null && max != null ? (min + max) / 2 : (min ?? max);
            out[m] = normalizeTemperatureRecord({ min: min ?? mean, max: max ?? mean, mean });
        }
        return out;
    }
    function normalizeMonthlyTemperatureNormals(monthlyNormals) {
        const out = {};
        for (let m = 1; m <= 12; m++) {
            const rec = normalizeTemperatureRecord(monthlyNormals?.[m]);
            if (rec) out[m] = rec;
        }
        return out;
    }
    function interpolateMonthlyScalarOnDate(date, monthlyNormals, key) {
        const year = date.getUTCFullYear();
        const month = date.getUTCMonth() + 1;
        const current = finiteNumberOrNull(monthlyNormals?.[month]?.[key]);
        if (current == null) return null;
        const currentCenter = Date.UTC(year, month - 1, 15);
        const nextMonth = month === 12 ? 1 : month + 1;
        const prevMonth = month === 1 ? 12 : month - 1;
        const nextYear = month === 12 ? year + 1 : year;
        const prevYear = month === 1 ? year - 1 : year;
        const next = finiteNumberOrNull(monthlyNormals?.[nextMonth]?.[key]);
        const prev = finiteNumberOrNull(monthlyNormals?.[prevMonth]?.[key]);
        const target = Date.UTC(year, month - 1, date.getUTCDate());
        if (target >= currentCenter && next != null) {
            const nextCenter = Date.UTC(nextYear, nextMonth - 1, 15);
            const ratio = (target - currentCenter) / Math.max(1, nextCenter - currentCenter);
            return current + (next - current) * clampNumber(ratio, 0, 1);
        }
        if (target < currentCenter && prev != null) {
            const prevCenter = Date.UTC(prevYear, prevMonth - 1, 15);
            const ratio = (target - prevCenter) / Math.max(1, currentCenter - prevCenter);
            return prev + (current - prev) * clampNumber(ratio, 0, 1);
        }
        return current;
    }
    function interpolateMonthlyTemperatureOnDate(date, monthlyNormals) {
        const min = interpolateMonthlyScalarOnDate(date, monthlyNormals, 'min');
        const max = interpolateMonthlyScalarOnDate(date, monthlyNormals, 'max');
        let mean = interpolateMonthlyScalarOnDate(date, monthlyNormals, 'mean');
        if (mean == null && min != null && max != null) mean = (min + max) / 2;
        return normalizeTemperatureRecord({ min, max, mean });
    }
    function normalizeForecastTemperatureMap(forecastRows) {
        const out = {};
        (forecastRows || []).forEach(function (row) {
            const key = String(row?.forecast_date || row?.weather_date || row?.date || '').slice(0, 10);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
            const rec = normalizeTemperatureRecord(row);
            if (!rec) return;
            const run = String(row?.run_timestamp || row?.fetched_at || '');
            if (!out[key] || run > String(out[key].runTimestamp || '')) {
                out[key] = Object.assign({ runTimestamp: run }, rec);
            }
        });
        return out;
    }
    function forecastBlendWeight(forecastISO, todayISO, weights = null) {
        const forecastDate = parseISODateUTCValue(forecastISO);
        const today = parseISODateUTCValue(todayISO) || asUTCDate(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, new Date().getUTCDate());
        if (!forecastDate || forecastDate < today) return 0;
        const daysAhead = Math.round((forecastDate.getTime() - today.getTime()) / 86400000);
        const w0 = clampNumber(weights?.forecastBlendWeight0To3Days ?? 0.8, 0, 1);
        const w1 = clampNumber(weights?.forecastBlendWeight4To7Days ?? 0.5, 0, 1);
        const w2 = clampNumber(weights?.forecastBlendWeight8To16Days ?? 0.25, 0, 1);
        if (daysAhead <= 3) return w0;
        if (daysAhead <= 7) return w1;
        if (daysAhead <= 16) return w2;
        return 0;
    }
    function blendTemperatureRecords(normalRecord, forecastRecord, weight) {
        const normal = normalizeTemperatureRecord(normalRecord);
        const forecast = normalizeTemperatureRecord(forecastRecord);
        const w = clampNumber(weight, 0, 1);
        if (!normal) return forecast;
        if (!forecast || w <= 0) return normal;
        const blend = (key) => normal[key] + (forecast[key] - normal[key]) * w;
        return normalizeTemperatureRecord({ min: blend('min'), max: blend('max'), mean: blend('mean') });
    }
    function buildDailyTemperatureSeries({
        startDate,
        endDate,
        monthlyNormals,
        forecastRows = [],
        todayISO = null,
        source = 'city monthly normals',
        forecastBlendWeights = null
    }) {
        const monthly = normalizeMonthlyTemperatureNormals(monthlyNormals);
        const forecastByISO = normalizeForecastTemperatureMap(forecastRows);
        const days = {};
        const diagnostics = {
            source,
            forecastBlendDays: 0,
            missingNormalDays: 0
        };
        for (let d = new Date(startDate); d <= endDate; d = addDaysUTC(d, 1)) {
            const key = dateKeyUTC(d);
            const normal = interpolateMonthlyTemperatureOnDate(d, monthly);
            const forecast = forecastByISO[key] || null;
            const weight = forecast ? forecastBlendWeight(key, todayISO, forecastBlendWeights) : 0;
            const record = blendTemperatureRecords(normal, forecast, weight);
            if (!record) {
                diagnostics.missingNormalDays += 1;
                continue;
            }
            if (weight > 0) diagnostics.forecastBlendDays += 1;
            days[key] = Object.freeze(Object.assign({}, record, {
                source: weight > 0 ? 'forecast blend' : source,
                forecastWeight: weight
            }));
        }
        return Object.freeze({ days: Object.freeze(days), diagnostics: Object.freeze(diagnostics) });
    }
    function temperatureRecordOnDate(date, dailyClimateOrMonthly) {
        const key = dateKeyUTC(date);
        const direct = dailyClimateOrMonthly?.days?.[key] || dailyClimateOrMonthly?.[key];
        const normalized = normalizeTemperatureRecord(direct);
        if (normalized) return normalized;
        if (dailyClimateOrMonthly && !dailyClimateOrMonthly.days) {
            return interpolateMonthlyTemperatureOnDate(date, normalizeMonthlyTemperatureNormals(Object.fromEntries(
                Object.keys(dailyClimateOrMonthly || {}).map(function (month) {
                    const mean = finiteNumberOrNull(dailyClimateOrMonthly[month]);
                    return [month, mean == null ? null : { min: mean, max: mean, mean }];
                })
            )));
        }
        return null;
    }
    function meanTemperatureOnDate(date, dailyClimateOrMonthly) {
        const rec = temperatureRecordOnDate(date, dailyClimateOrMonthly);
        return rec ? rec.mean : null;
    }
    function applyBedAirEffectsToTemperatureRecord(record, profile) {
        const rec = normalizeTemperatureRecord(record);
        if (!rec) return null;
        const effects = seasonExtensionEffects(profile);
        const offset = bedAirTemperatureOffsetC(profile);
        let min = rec.min + offset;
        let max = rec.max + offset;
        let mean = rec.mean + offset;
        if (effects.minAirTempC != null) {
            min = Math.max(min, effects.minAirTempC);
            max = Math.max(max, min);
            mean = (min + max) / 2;
        }
        return Object.freeze({ min, max, mean });
    }
    function bedAdjustedTemperatureRecordOnDate(date, dailyClimateOrMonthly, profile = null) {
        return applyBedAirEffectsToTemperatureRecord(temperatureRecordOnDate(date, dailyClimateOrMonthly), profile);
    }
    function bedAdjustedMeanTemperatureOnDate(date, dailyClimateOrMonthly, profile = null) {
        const rec = bedAdjustedTemperatureRecordOnDate(date, dailyClimateOrMonthly, profile);
        return rec ? rec.mean : null;
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
        const pickNum = (key) => finiteNumberOrNull(source[key]);
        return {
            sunExposure: pick('sunExposure', 'full_sun'),
            soilMoisture: pick('soilMoisture', 'moderate'),
            drainage: pick('drainage', 'normal'),
            soilTexture: pick('soilTexture', 'loamy'),
            windExposure: pick('windExposure', 'moderate'),
            frostRisk: pick('frostRisk', 'low'),
            seasonExtension: pick('seasonExtension', pick('season_extension', 'unknown')),
            seasonExtensionAirOffsetC: pickNum('seasonExtensionAirOffsetC') ?? pickNum('season_extension_air_offset_c'),
            seasonExtensionSoilOffsetC: pickNum('seasonExtensionSoilOffsetC') ?? pickNum('season_extension_soil_offset_c'),
            seasonExtensionFrostShiftDays: pickNum('seasonExtensionFrostShiftDays') ?? pickNum('season_extension_frost_shift_days'),
            seasonExtensionMinAirTempC: pickNum('seasonExtensionMinAirTempC') ?? pickNum('season_extension_min_air_temp_c')
        };
    }
    function seasonExtensionEffects(profile) {
        const bed = normalizeBedProfile(profile);
        const key = Object.prototype.hasOwnProperty.call(SEASON_EXTENSION_EFFECTS, bed.seasonExtension) ? bed.seasonExtension : 'unknown';
        const defaults = SEASON_EXTENSION_EFFECTS[key] || SEASON_EXTENSION_EFFECTS.unknown;
        return Object.freeze({
            seasonExtension: key,
            airOffsetC: bed.seasonExtensionAirOffsetC ?? defaults.airOffsetC,
            soilOffsetC: bed.seasonExtensionSoilOffsetC ?? defaults.soilOffsetC,
            frostShiftDays: bed.seasonExtensionFrostShiftDays ?? defaults.frostShiftDays,
            minAirTempC: key === 'heated_greenhouse' ? (bed.seasonExtensionMinAirTempC ?? defaults.minAirTempC) : null
        });
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
        return Math.max(-1.5, Math.min(5.0, offset)) + seasonExtensionEffects(bed).soilOffsetC;
    }
    function bedAirTemperatureOffsetC(profile) {
        const bed = normalizeBedProfile(profile);
        let offset = 0;
        if (bed.sunExposure === 'full_sun') offset += 0.35;
        else if (bed.sunExposure === 'part_sun') offset += 0.1;
        else if (bed.sunExposure === 'part_shade') offset -= 0.35;
        else if (bed.sunExposure === 'shade') offset -= 0.7;
        if (bed.windExposure === 'sheltered') offset += 0.2;
        else if (bed.windExposure === 'exposed') offset -= 0.3;
        if (bed.soilMoisture === 'dry') offset += 0.15;
        else if (bed.soilMoisture === 'wet') offset -= 0.2;
        if (bed.frostRisk === 'none') offset += 0.15;
        else if (bed.frostRisk === 'medium') offset -= 0.2;
        else if (bed.frostRisk === 'high') offset -= 0.4;
        return Math.max(-1.0, Math.min(1.0, offset)) + seasonExtensionEffects(bed).airOffsetC;
    }
    function bedFrostGateShiftDays(profile) {
        const bed = normalizeBedProfile(profile);
        let shift = 0;
        if (bed.frostRisk === 'none') shift = -3;
        else if (bed.frostRisk === 'medium') shift = 5;
        else if (bed.frostRisk === 'high') shift = 10;
        return shift + seasonExtensionEffects(bed).frostShiftDays;
    }
    function estimateSoilTempC(date, monthlyAvgTemp, bedProfile = null) {
        const air = meanTemperatureOnDate(date, monthlyAvgTemp);
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
    function singleSineDailyGdd(tempRecord, tbase, tupper = null) {
        const rec = normalizeTemperatureRecord(tempRecord);
        const lower = finiteNumberOrNull(tbase);
        const upper = finiteNumberOrNull(tupper);
        if (!rec || lower == null) return 0;
        const mean = (rec.min + rec.max) / 2;
        const amp = Math.max(0, (rec.max - rec.min) / 2);
        const samples = 48;
        let total = 0;
        for (let i = 0; i < samples; i++) {
            const theta = ((i + 0.5) / samples) * Math.PI * 2 - Math.PI / 2;
            const rawTemp = mean + amp * Math.sin(theta);
            const cappedTemp = upper == null ? rawTemp : Math.min(rawTemp, upper);
            total += Math.max(0, cappedTemp - lower);
        }
        return total / samples;
    }
    function buildDailyGddMap({ dailyClimate, cropTemp, bedProfile = null, city = null, year = null, gddCalibrationEnabled = true }) {
        const env = cropTemp || {};
        const lower = finiteNumberOrNull(env.Tbase ?? env.tbase_c);
        const upper = finiteNumberOrNull(env.Tmax ?? env.tmax_c);
        const effects = seasonExtensionEffects(bedProfile);
        const bedOffset = bedAirTemperatureOffsetC(bedProfile);
        const raw = {};
        const cityBaseByYear = {};
        let cropTotal = 0;
        Object.keys(dailyClimate?.days || {}).forEach(function (key) {
            const day = dailyClimate.days[key];
            const adjusted = applyBedAirEffectsToTemperatureRecord(day, bedProfile);
            const cropGdd = singleSineDailyGdd(adjusted, lower, upper);
            raw[key] = cropGdd;
            cropTotal += cropGdd;
            const cityBase = finiteNumberOrNull(city?.gdd_base_c);
            if (cityBase != null) {
                const y = key.slice(0, 4);
                cityBaseByYear[y] = (cityBaseByYear[y] || 0) + singleSineDailyGdd(day, cityBase, null);
            }
        });
        const target = finiteNumberOrNull(city?.gdd_annual);
        const scaleByYear = {};
        Object.keys(cityBaseByYear).forEach(function (y) {
            scaleByYear[y] = gddCalibrationEnabled !== false && target != null && target > 0 && cityBaseByYear[y] > 0 ? (target / cityBaseByYear[y]) : 1;
        });
        const out = {};
        Object.keys(raw).forEach(function (key) { out[key] = raw[key] * (scaleByYear[key.slice(0, 4)] || 1); });
        const scaledTotal = Object.keys(out).reduce(function (sum, key) { return sum + out[key]; }, 0);
        const firstYear = year != null ? String(year) : Object.keys(scaleByYear)[0];
        Object.defineProperty(out, '__diagnostics', {
            value: Object.freeze({
                bedAirOffsetC: bedOffset,
                bedSoilOffsetC: bedSoilTemperatureOffsetC(bedProfile),
                bedFrostGateShiftDays: bedFrostGateShiftDays(bedProfile),
                seasonExtension: effects.seasonExtension,
                seasonExtensionMinAirTempC: effects.minAirTempC,
                gddScale: scaleByYear[firstYear] || 1,
                gddScaleByYear: Object.freeze(scaleByYear),
                rawCropAnnualGdd: cropTotal,
                scaledCropAnnualGdd: scaledTotal,
                cityBaseAnnualGdd: cityBaseByYear[firstYear] || null,
                targetGdd: target,
                year
            }),
            enumerable: false
        });
        return out;
    }
    function gddRateForDate(dailyRatesMap, date) {
        const key = dateKeyUTC(date);
        const direct = finiteNumberOrNull(dailyRatesMap?.[key]);
        if (direct != null) return Math.max(0, direct);
        return Math.max(0, dailyRatesMap?.[date.getUTCMonth() + 1] ?? 0);
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
    function clampDoy(value) {
        return Math.max(1, Math.min(366, Math.round(Number(value) || 1))); // ADDED: keep stored and inferred frost dates inside annual scheduler bounds.
    }
    function storedSpringFrostByRisk(city, risk = 'p50') {
        const p90 = finiteNumberOrNull(city?.last_spring_frost_p90_doy);
        const p50 = finiteNumberOrNull(city?.last_spring_frost_p50_doy);
        const p10 = finiteNumberOrNull(city?.last_spring_frost_p10_doy);
        const plain = finiteNumberOrNull(city?.last_spring_frost_doy);
        if (risk === 'p90' && p90 != null) return { doy: clampDoy(p90), source: 'stored', field: 'last_spring_frost_p90_doy' }; // ADDED: prefer requested stored percentile.
        if (risk === 'p10' && p10 != null) return { doy: clampDoy(p10), source: 'stored', field: 'last_spring_frost_p10_doy' }; // ADDED: prefer requested stored percentile.
        if (risk === 'p50' && p50 != null) return { doy: clampDoy(p50), source: 'stored', field: 'last_spring_frost_p50_doy' }; // ADDED: prefer requested stored percentile.
        if (p50 != null) return { doy: clampDoy(p50), source: 'stored', field: 'last_spring_frost_p50_doy' }; // ADDED: keep old shared fallback order before inference.
        if (plain != null) return { doy: clampDoy(plain), source: 'stored', field: 'last_spring_frost_doy' }; // ADDED: keep plain stored frost-date support.
        if (p90 != null) return { doy: clampDoy(p90), source: 'stored', field: 'last_spring_frost_p90_doy' }; // ADDED: use any stored percentile before monthly inference.
        if (p10 != null) return { doy: clampDoy(p10), source: 'stored', field: 'last_spring_frost_p10_doy' }; // ADDED: use any stored percentile before monthly inference.
        return null;
    }
    function monthlyLowC(city, month) {
        const direct = finiteNumberOrNull(city?.[`avg_monthly_low_c${month}`]);
        if (direct != null) return direct;
        const lows = typeof city?.monthlyLows === 'function' ? city.monthlyLows() : null;
        return finiteNumberOrNull(lows?.[month]); // ADDED: support both plain city rows and CityClimate instances.
    }
    function inferSpringFrostFromMonthlyLows(city, { bufferDays = INFERRED_SPRING_FROST_BUFFER_DAYS } = {}) {
        const lows = {};
        for (let month = 1; month <= 12; month += 1) {
            const low = monthlyLowC(city, month);
            if (low != null) lows[month] = low;
        }
        if (Object.keys(lows).length < 2) return null;
        for (let month = 1; month <= 6; month += 1) {
            const low = finiteNumberOrNull(lows[month]);
            if (low == null) continue;
            if (month === 1 && low > 0) {
                return { doy: 1, crossingDoy: 1, bufferDays: 0, source: 'inferred_monthly_normals' }; // ADDED: all-warm spring climates should infer an early frost-safety date.
            }
            const nextLow = finiteNumberOrNull(lows[month + 1]);
            if (nextLow == null) continue;
            if (low <= 0 && nextLow > 0) {
                const currentCenter = dayOfYear(asUTCDate(2026, month, 15));
                const nextCenter = dayOfYear(asUTCDate(2026, month + 1, 15));
                const ratio = (0 - low) / Math.max(1e-6, nextLow - low);
                const crossingDoy = currentCenter + ratio * (nextCenter - currentCenter);
                return {
                    doy: clampDoy(crossingDoy + Math.max(0, Math.round(Number(bufferDays || 0)))),
                    crossingDoy: clampDoy(crossingDoy),
                    bufferDays: Math.max(0, Math.round(Number(bufferDays || 0))),
                    source: 'inferred_monthly_normals'
                }; // ADDED: monthly-low frost approximation with a fixed safety buffer.
            }
        }
        return null;
    }
    function resolveSpringFrostByRisk(city, risk = 'p50') {
        const selectedRisk = ['p10', 'p50', 'p90'].indexOf(String(risk || '')) >= 0 ? String(risk) : 'p50';
        const stored = storedSpringFrostByRisk(city, selectedRisk);
        if (stored) return Object.freeze({ ...stored, risk: selectedRisk });
        const inferred = inferSpringFrostFromMonthlyLows(city);
        if (inferred) return Object.freeze({ ...inferred, risk: selectedRisk });
        return Object.freeze({ doy: SPRING_FROST_FALLBACK_DOY, source: 'fallback', field: null, risk: selectedRisk }); // ADDED: single hard fallback when stored and monthly-normal sources are unavailable.
    }
    function pickFrostByRisk(city, risk = 'p50') {
        return resolveSpringFrostByRisk(city, risk).doy; // CHANGED: preserve numeric API while sharing inference logic.
    }
    function storedFallFrostByRisk(city, risk = 'p50') {
        const p90 = finiteNumberOrNull(city?.first_fall_frost_p90_doy);
        const p50 = finiteNumberOrNull(city?.first_fall_frost_p50_doy);
        const p10 = finiteNumberOrNull(city?.first_fall_frost_p10_doy);
        const plain = finiteNumberOrNull(city?.first_fall_frost_doy);
        if (risk === 'p90' && p90 != null) return { doy: clampDoy(p90), source: 'stored', field: 'first_fall_frost_p90_doy' }; // ADDED: prefer requested stored percentile.
        if (risk === 'p10' && p10 != null) return { doy: clampDoy(p10), source: 'stored', field: 'first_fall_frost_p10_doy' }; // ADDED: prefer requested stored percentile.
        if (risk === 'p50' && p50 != null) return { doy: clampDoy(p50), source: 'stored', field: 'first_fall_frost_p50_doy' }; // ADDED: prefer requested stored percentile.
        if (p50 != null) return { doy: clampDoy(p50), source: 'stored', field: 'first_fall_frost_p50_doy' }; // ADDED: keep spring-style fallback order before inference.
        if (plain != null) return { doy: clampDoy(plain), source: 'stored', field: 'first_fall_frost_doy' }; // ADDED: keep plain stored frost-date support.
        if (p90 != null) return { doy: clampDoy(p90), source: 'stored', field: 'first_fall_frost_p90_doy' }; // ADDED: use any stored percentile before monthly inference.
        if (p10 != null) return { doy: clampDoy(p10), source: 'stored', field: 'first_fall_frost_p10_doy' }; // ADDED: use any stored percentile before monthly inference.
        return null;
    }
    function inferFallFrostFromMonthlyLows(city, { bufferDays = INFERRED_FALL_FROST_BUFFER_DAYS } = {}) {
        const lows = {};
        for (let month = 1; month <= 12; month += 1) {
            const low = monthlyLowC(city, month);
            if (low != null) lows[month] = low;
        }
        if (Object.keys(lows).length < 2) return null;
        for (let month = 7; month <= 12; month += 1) {
            const low = finiteNumberOrNull(lows[month]);
            const nextMonth = month === 12 ? 1 : month + 1;
            const nextLow = finiteNumberOrNull(lows[nextMonth]);
            if (low == null || nextLow == null) continue;
            if (low > 0 && nextLow <= 0) {
                const currentCenter = dayOfYear(asUTCDate(2026, month, 15));
                const nextCenter = month === 12 ? dayOfYear(asUTCDate(2026, 12, 31)) + 15 : dayOfYear(asUTCDate(2026, month + 1, 15));
                const delta = nextLow - low;
                if (Math.abs(delta) < 1e-6) continue;
                const ratio = (0 - low) / delta;
                const crossingDoy = currentCenter + ratio * (nextCenter - currentCenter);
                if (!Number.isFinite(crossingDoy)) continue;
                return {
                    doy: clampDoy(crossingDoy - Math.max(0, Math.round(Number(bufferDays || 0)))),
                    crossingDoy: clampDoy(crossingDoy),
                    bufferDays: Math.max(0, Math.round(Number(bufferDays || 0))),
                    source: 'inferred_monthly_normals'
                }; // ADDED: monthly-low fall frost approximation with an earlier safety deadline.
            }
        }
        return null;
    }
    function resolveFallFrostByRisk(city, risk = 'p50') {
        const selectedRisk = ['p10', 'p50', 'p90'].indexOf(String(risk || '')) >= 0 ? String(risk) : 'p50';
        const stored = storedFallFrostByRisk(city, selectedRisk);
        if (stored) return Object.freeze({ ...stored, risk: selectedRisk });
        const inferred = inferFallFrostFromMonthlyLows(city);
        if (inferred) return Object.freeze({ ...inferred, risk: selectedRisk });
        return Object.freeze({ doy: null, source: 'none', field: null, risk: selectedRisk }); // ADDED: no crossing means no artificial fall frost deadline.
    }
    function pickFallFrostByRisk(city, risk = 'p50') {
        const resolved = resolveFallFrostByRisk(city, risk);
        return resolved.doy == null ? null : resolved.doy; // ADDED: preserve annual-core numeric/null API.
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
        return asCoolingThresholdC(plant?.start_cooling_threshold_c);
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
            overwinterAllowed = false,
            annualCrossYearHarvestAllowed = true,
            gddCalibrationEnabled = true,
            weatherNormalsSource = 'auto',
            forecastBlendWeight0To3Days = 0.8,
            forecastBlendWeight4To7Days = 0.5,
            forecastBlendWeight8To16Days = 0.25
        } = {}) {
            this.overwinterAllowed = !!overwinterAllowed;
            this.annualCrossYearHarvestAllowed = annualCrossYearHarvestAllowed !== false;
            this.useSpringFrostGate = !!useSpringFrostGate;
            this.springFrostRisk = ['p10', 'p50', 'p90'].indexOf(String(springFrostRisk || '')) >= 0 ? String(springFrostRisk) : 'p50';
            const thr = Number(soilGateThresholdC);
            this.soilGateThresholdC = Number.isFinite(thr) ? thr : null;
            this.useSoilTempGate = !!useSoilTempGate && this.soilGateThresholdC != null;
            this.soilGateConsecutiveDays = Math.max(1, Math.min(14, Number(soilGateConsecutiveDays ?? 3)));
            this.gddCalibrationEnabled = gddCalibrationEnabled !== false;
            this.weatherNormalsSource = ['auto', 'city_weather_monthly', 'city_weather_daily', 'city_monthly_columns'].indexOf(String(weatherNormalsSource || '')) >= 0 ? String(weatherNormalsSource) : 'auto';
            this.forecastBlendWeight0To3Days = Math.max(0, Math.min(1, Number(forecastBlendWeight0To3Days ?? 0.8)));
            this.forecastBlendWeight4To7Days = Math.max(0, Math.min(1, Number(forecastBlendWeight4To7Days ?? 0.5)));
            this.forecastBlendWeight8To16Days = Math.max(0, Math.min(1, Number(forecastBlendWeight8To16Days ?? 0.25)));
            Object.freeze(this);
        }

        static fromResolvedBehavior(plant, resolvedBehavior, climatePolicy = null) {
            const threshold = finiteNumberOrNull(plant?.soil_temp_min_plant_c);
            const overwinterAllowed = isCrossYearCrop(plant);
            return new PolicyFlags({
                useSpringFrostGate: true,
                springFrostRisk: climatePolicy?.springFrostRisk || 'p50',
                useSoilTempGate: !!resolvedBehavior?.usesSoilTempGate && threshold != null,
                soilGateThresholdC: threshold,
                soilGateConsecutiveDays: climatePolicy?.soilGateConsecutiveDays ?? 3,
                overwinterAllowed,
                annualCrossYearHarvestAllowed: climatePolicy?.annualCrossYearHarvestAllowed !== false,
                gddCalibrationEnabled: climatePolicy?.gddCalibrationEnabled !== false,
                weatherNormalsSource: climatePolicy?.weatherNormalsSource || 'auto',
                forecastBlendWeight0To3Days: climatePolicy?.forecastBlendWeight0To3Days ?? 0.8,
                forecastBlendWeight4To7Days: climatePolicy?.forecastBlendWeight4To7Days ?? 0.5,
                forecastBlendWeight8To16Days: climatePolicy?.forecastBlendWeight8To16Days ?? 0.25
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
            bedProfileSource = 'generic garden bed',
            dailyClimate = null
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
                bedProfileSource: String(bedProfileSource || 'generic garden bed'),
                dailyClimate
            });
            Object.freeze(this);
        }

        derived() {
            const startDate = new Date(this.startISO + 'T00:00:00Z');
            const seasonEnd = new Date(this.seasonEndISO + 'T00:00:00Z');
            const env = this.plant.cropTempEnvelope();
            const lifecycleScanYears = getPlantScanYears(this.plant);
            const scanYears = !isPerennialPlant(this.plant) && this.policy?.annualCrossYearHarvestAllowed !== false
                ? Math.max(lifecycleScanYears, 2)
                : lifecycleScanYears;
            const scanStart = asUTCDate(this.seasonStartYear, 1, 1);
            const scanEndHard = asUTCDate(this.seasonStartYear + scanYears - 1, 12, 31);
            const year = scanStart.getUTCFullYear();
            const monthlyNormals = monthlyTemperatureNormalsFromCity(this.city);
            const dailyClimate = this.dailyClimate || buildDailyTemperatureSeries({
                startDate: scanStart,
                endDate: scanEndHard,
                monthlyNormals,
                source: 'city monthly normals'
            });
            const monthlyAvg = typeof this.city.monthlyMeans === 'function' ? this.city.monthlyMeans() : {};
            const dailyRates = buildDailyGddMap({
                dailyClimate,
                cropTemp: env,
                bedProfile: this.bedProfile,
                city: this.city,
                year,
                gddCalibrationEnabled: this.policy?.gddCalibrationEnabled !== false
            });
            return { startDate, seasonEnd, year, env, dailyRates, monthlyAvg, dailyClimate, scanStart, scanEndHard };
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
        if (raw.indexOf('insufficient_gdd_before_cold') === 0) return 'There is not enough heat for this crop to mature before lethal cold.';
        if (raw === 'cross_year_disallowed') return 'This planting would extend into another year.';
        if (raw === 'beyond_hard_end') return 'There is not enough season remaining for the harvest window.';
        if (raw.indexOf('cold_survival_temp') === 0 || raw.indexOf('winter_survival_temp') === 0) return 'Temperatures are too cold for this crop to survive.';
        if (raw.indexOf('harvest_too_cold') === 0) return 'Expected harvest temperatures are too cold.';
        if (raw.indexOf('harvest_too_hot') === 0) return 'Expected harvest temperatures are too hot.';
        if (raw.indexOf('error:') === 0) return raw.slice(6).trim() || 'The feasibility check failed.';
        return raw.replace(/_/g, ' ');
    }
    function classifySelectedSowDate({
        perennial = false,
        windowFeasible = false,
        startISO = '',
        sowingSeasons = [],
        activeSowingSeasonId = ''
    } = {}) {
        if (perennial) return { status: 'not_applicable', label: 'Not applicable for perennial planting dates.' };
        const windows = Array.isArray(sowingSeasons) ? sowingSeasons : [];
        if (!windowFeasible || !windows.length) return { status: 'no_window', label: 'No feasible sowing season is available.' };
        const selected = parseISODateUTCValue(startISO);
        if (!selected) return { status: 'missing', label: 'Select a sow date.' };
        const active = windows.find(window => String(window?.id || '') === String(activeSowingSeasonId || ''));
        if (!active) return { status: 'no_active_window', label: 'Select a sowing season.' };
        const earliest = parseISODateUTCValue(active.startISO);
        const latest = parseISODateUTCValue(active.endISO);
        if (!earliest || !latest || selected < earliest || selected > latest) {
            const other = windows.find(window => {
                const start = parseISODateUTCValue(window?.startISO);
                const end = parseISODateUTCValue(window?.endISO);
                return start && end && selected >= start && selected <= end;
            });
            if (other) return { status: 'window_mismatch', label: `The selected sow date belongs to ${other.label || other.id}, not ${active.label || active.id}.` };
            return { status: 'outside_window', label: 'The selected sow date is outside the selected sowing season.' };
        }
        return { status: 'feasible', label: `The selected sow date is in ${active.label || active.id}.` };
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
        sowingSeasons = [],
        activeSowingSeasonId = '',
        firstHarvestISO = '',
        lastHarvestISO = ''
    } = {}) {
        const feasibility = classifySelectedSowDate({ perennial, windowFeasible, startISO, sowingSeasons, activeSowingSeasonId });
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
        INFERRED_SPRING_FROST_BUFFER_DAYS,
        INFERRED_FALL_FROST_BUFFER_DAYS,
        SPRING_FROST_FALLBACK_DOY,
        daysInMonth,
        addDaysUTC,
        asUTCDate,
        dateLTE,
        fmtISO,
        iso,
        shiftDays,
        dayOfYear,
        finiteNumberOrNull,
        clampNumber,
        dateKeyUTC,
        normalizeTemperatureRecord,
        monthlyTemperatureNormalsFromCity,
        normalizeMonthlyTemperatureNormals,
        interpolateMonthlyTemperatureOnDate,
        normalizeForecastTemperatureMap,
        forecastBlendWeight,
        buildDailyTemperatureSeries,
        temperatureRecordOnDate,
        meanTemperatureOnDate,
        applyBedAirEffectsToTemperatureRecord,
        bedAdjustedTemperatureRecordOnDate,
        bedAdjustedMeanTemperatureOnDate,
        monthlyMeanOnDate,
        normalizeBedProfile,
        seasonExtensionEffects,
        bedSoilTemperatureOffsetC,
        bedAirTemperatureOffsetC,
        bedFrostGateShiftDays,
        estimateSoilTempC,
        firstSoilReadyDate,
        annualGddFromMonthlyMeans,
        singleSineDailyGdd,
        buildDailyGddMap,
        gddRateForDate,
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
        resolveSpringFrostByRisk,
        inferSpringFrostFromMonthlyLows,
        pickFrostByRisk,
        resolveFallFrostByRisk,
        inferFallFrostFromMonthlyLows,
        pickFallFrostByRisk,
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
