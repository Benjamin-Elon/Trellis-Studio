// USL Draw.io Plugin: Garden Scheduler dialog and runtime facade.
//
// - Schedule entry is rendered by Vertex_Linking_Standalone.js
// - Fetches plant/city from SQLite via window.dbBridge
// - Computes schedule, plants, timelines, and writes attrs
//
// Key changes in this version:
//  * Dialog facade uses shared scheduler core classes for schedule inputs and planning.
//  * Overwinter-aware feasibility & scanning
//  * Yield multipliers computed over HARVEST window
//  * UI keeps the same behavior (manual/auto dates, minimum yield filter, preview)
//  * Loads shared, annual, and perennial scheduler cores before runtime installation.
//
// ---------------------------------------------------------------------------------------------

(function installGardenSchedulerCoreLoader(root) {
    if (!root) return;
    root.USL = root.USL || {};
    root.USL.scheduler = root.USL.scheduler || {};

    const CORE_FILES = [
        'Garden_Scheduler_Shared_Core.js',
        'Garden_Scheduler_Annual_Core.js',
        'Garden_Scheduler_Perennial_Core.js'
    ];

    function coreBasePath() {
        try {
            const src = root.document && root.document.currentScript && root.document.currentScript.src;
            if (src) return src.replace(/Garden_Scheduler_Dialog\.js(?:[?#].*)?$/, '');
        } catch (_) { }
        return 'plugins/garden_planner_plugins/';
    }

    function validateCores() {
        const scheduler = root.USL && root.USL.scheduler;
        const shared = scheduler && scheduler.sharedCore;
        const annual = scheduler && scheduler.annualCore;
        const perennial = scheduler && scheduler.perennialCore;
        if (!shared || typeof shared.ScheduleInputs !== 'function' || typeof shared.resolveHarvestWindowDays !== 'function') {
            throw new Error('Garden scheduler shared core did not expose the expected API.');
        }
        if (!annual || typeof annual.Planner !== 'function' || typeof annual.computeAnnualScheduleResult !== 'function') {
            throw new Error('Garden scheduler annual core did not expose the expected API.');
        }
        if (!perennial || typeof perennial.computePerennialScheduleResult !== 'function') {
            throw new Error('Garden scheduler perennial core did not expose the expected API.');
        }
        return { shared, annual, perennial };
    }

    const loader = root.USL.scheduler.__coreLoader || {
        ready: false,
        error: null,
        callbacks: []
    };

    function finish(error) {
        loader.error = error || null;
        loader.ready = !error;
        const callbacks = loader.callbacks.splice(0);
        callbacks.forEach(function (callback) {
            try { callback(loader.error); } catch (e) { console.error('[Garden Scheduler] core-loader callback failed', e); }
        });
    }

    loader.whenReady = function (callback) {
        if (loader.ready || loader.error) {
            callback(loader.error);
            return;
        }
        loader.callbacks.push(callback);
    };
    loader.validate = validateCores;

    function loadNext(index, basePath) {
        if (index >= CORE_FILES.length) {
            try { validateCores(); finish(null); } catch (e) { finish(e); }
            return;
        }
        const fileName = CORE_FILES[index];
        if (typeof root.mxscript !== 'function') {
            finish(new Error('mxscript is unavailable; cannot load ' + fileName + '.'));
            return;
        }
        root.mxscript(basePath + fileName, function () {
            loadNext(index + 1, basePath);
        }, null, null, null, function (message, error) {
            finish(error || new Error(message || ('Failed to load ' + fileName + '.')));
        });
    }

    root.USL.scheduler.__coreLoader = loader;
    try {
        validateCores();
        finish(null);
    } catch (_) {
        loadNext(0, coreBasePath());
    }
})(typeof window !== 'undefined' ? window : globalThis);

Draw.loadPlugin(function (ui) {
    const graph = ui.editor && ui.editor.graph;
    if (!graph) return;

    console.log("[Scheduler] file instance:", "Garden_Scheduler_Dialog.js", "STAMP=2026-06-24-split");

    const TRELLIS_DIALOG_Z = 2000000000;

    function applySharedButtonStyle(button, variant, options) {
        const semanticVariant = variant || 'neutral';
        if (!button) return button;
        if (window.Trellis && window.Trellis.ui && typeof window.Trellis.ui.applyButtonStyle === 'function') {
            window.Trellis.ui.applyButtonStyle(button, semanticVariant, options || {});
        } else if (button.setAttribute) {
            const activeOpen = semanticVariant === 'open' && options && options.active === true; // NEW
            const style = { open: ['#2563eb', activeOpen ? '#1e3a8a' : '#1d4ed8', activeOpen ? '#eff6ff' : '#fff'], add: ['#188038', '#166534', '#fff'], close: ['#b91c1c', '#b91c1c', '#fff'], danger: ['#b91c1c', '#fff', '#b91c1c'], neutral: ['#6b7280', '#111827', '#fff'] }[semanticVariant] || ['#6b7280', '#111827', '#fff']; // NEW
            button.setAttribute('data-trellis-button-variant', semanticVariant);
            button.style.border = '1px solid ' + style[0]; // NEW
            button.style.color = style[1]; // NEW
            button.style.background = style[2]; // NEW
            if (activeOpen) button.style.fontWeight = '700'; // NEW
        }
        return button;
    }

    // -------------------- Logging ---------------------------------------------------------
    function log() { try { mxLog.debug.apply(mxLog, ["[USL-Schedule]"].concat([].slice.call(arguments))); } catch (_) {/*noop*/ } }

    function elevateTrellisDialog(dialogUi) {
        const dlg = dialogUi && dialogUi.dialog;
        if (!dlg) return;
        if (dlg.bg && dlg.bg.style) dlg.bg.style.zIndex = String(TRELLIS_DIALOG_Z - 1);
        if (dlg.container && dlg.container.style) dlg.container.style.zIndex = String(TRELLIS_DIALOG_Z);
    }

    // -------------------- Small utils (dates, math) --------------------------------------
    function daysInMonth(year, month) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }
    function addDaysUTC(d, days) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days)); }
    function asUTCDate(y, m, d) { return new Date(Date.UTC(y, m - 1, d)); }
    function daysBetweenUTC(a, b) { return Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000)); }
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
    function normalizeLatitudeDeg(value) {
        const n = finiteNumberOrNull(value);
        if (n == null) return null;
        if (n < -66.5 || n > 66.5) throw new Error('City latitude must be between -66.5 and 66.5 decimal degrees.');
        return n;
    }
    let sharedCore = null;
    let annualCore = null;
    let perennialCore = null;
    function bindRequiredSchedulerCores() {
        const scheduler = typeof window !== 'undefined' && window.USL && window.USL.scheduler
            ? window.USL.scheduler
            : null;
        sharedCore = scheduler && scheduler.sharedCore;
        annualCore = scheduler && scheduler.annualCore;
        perennialCore = scheduler && scheduler.perennialCore;
        if (!sharedCore || !annualCore || !perennialCore) {
            throw new Error('Garden scheduler requires shared, annual, and perennial core modules.');
        }
        return { sharedCore, annualCore, perennialCore };
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
        return sharedCore.normalizeBedProfile(profile);
    }
    function bedSoilTemperatureOffsetC(profile) {
        return sharedCore.bedSoilTemperatureOffsetC(profile);
    }
    function estimateSoilTempC(date, monthlyAvgTemp, bedProfile = null) {
        return sharedCore.estimateSoilTempC(date, monthlyAvgTemp, bedProfile);
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

    function normId(value) { // FIX: canonicalize method and category identifiers at every boundary
        return String(value ?? '').trim().toLowerCase();
    }

    const ORPHAN_SOWING_SEASON_ID = '__saved_date_outside_seasons';

    function isOrphanSowingSeasonId(value) {
        return String(value || '') === ORPHAN_SOWING_SEASON_ID;
    }

    function localTodayISO(now = new Date()) {
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }

    function defaultStartForActiveSowingSeason(activeWindow, todayISO = '') {
        if (!activeWindow) return '';
        return sowDateInWindow(todayISO, activeWindow) ? String(todayISO) : String(activeWindow.startISO || '');
    }

    function defaultStartForSowingSeasons(windows, todayISO = '') {
        const normalized = normalizeSowingSeasons(windows);
        if (!normalized.length) return '';
        const activeId = pickDefaultSowingSeasonId(normalized, { todayISO });
        const activeWindow = normalized.find(window => window.id === String(activeId || '').trim()) || normalized[0];
        return defaultStartForActiveSowingSeason(activeWindow, todayISO);
    }

    function defaultPrimaryStartForSowingSeasons(windows, { todayISO = '', methodId = '', effectiveTransplantDays = 0 } = {}) {
        const visibleWindows = projectSowingSeasonsForPrimaryDate(windows, methodId, effectiveTransplantDays);
        return defaultStartForSowingSeasons(visibleWindows, todayISO);
    }

    function resolveStartAfterWindow({
        currentStartISO,
        activeWindow,
        feasible,
        forceWriteStart,
        hasPersistedSchedule,
        userEditedStartThisSession,
        todayISO = '',
        generatedStartISO = ''
    }) { // CHANGED: active sowing seasons own generated defaults
        const preserveGenuineStart = !!hasPersistedSchedule || !!userEditedStartThisSession;
        if (feasible && (forceWriteStart || !preserveGenuineStart)) return String(generatedStartISO || '') || defaultStartForActiveSowingSeason(activeWindow, todayISO);
        if (!feasible && !preserveGenuineStart) return '';
        return String(currentStartISO || '');
    }

    function resolveInitialPreviewStartForScheduleDialog({
        storedSowDate,
        earliestFeasibleSowDate,
        selectedIsPerennial = false,
        initialWindowFeasible = false,
        sowingSeasons = [],
        todayISO = '',
        methodId = '',
        effectiveTransplantDays = 0
    } = {}) {
        if (storedSowDate || selectedIsPerennial) return storedSowDate || earliestFeasibleSowDate || null;
        if (!initialWindowFeasible) return parseISODateUTCValue(todayISO) || earliestFeasibleSowDate || null;
        const windows = normalizeSowingSeasons(sowingSeasons);
        if (!windows.length) return earliestFeasibleSowDate || null;
        const defaultPrimaryStartISO = defaultPrimaryStartForSowingSeasons(windows, { todayISO, methodId, effectiveTransplantDays });
        const defaultStartISO = sowDateFromPrimaryDate(defaultPrimaryStartISO, methodId, effectiveTransplantDays);
        return parseISODateUTCValue(defaultStartISO) || earliestFeasibleSowDate || null;
    }

    const TRANSPLANT_DATE_INPUT_METHOD_IDS = Object.freeze(['transplant.indoor', 'transplant.cutting']);

    function methodUsesTransplantDateInput(methodIdOrBehavior) {
        const methodId = normId(methodIdOrBehavior?.methodId ?? methodIdOrBehavior);
        return TRANSPLANT_DATE_INPUT_METHOD_IDS.indexOf(methodId) >= 0;
    }

    function normalizeTransplantDays(value) {
        const n = finiteNumberOrNull(value);
        if (n == null || n < 0) return null;
        return Math.round(n);
    }

    function plantDefaultTransplantDays(plant) {
        return normalizeTransplantDays(plant?.days_transplant) ?? 0;
    }

    function readCellTransplantDaysOverride(cell) {
        const valueNode = cell?.value;
        const hasAttr = typeof valueNode?.hasAttribute === 'function'
            ? valueNode.hasAttribute('days_transplant')
            : cell?.getAttribute?.('days_transplant') != null;
        if (!hasAttr) return null;
        const raw = cell?.getAttribute?.('days_transplant') ?? valueNode?.getAttribute?.('days_transplant');
        return normalizeTransplantDays(raw);
    }

    function resolveTransplantDaysConfig(plant, { methodId = '', overrideEnabled = false, overrideValue = null } = {}) {
        const plantDefaultDays = plantDefaultTransplantDays(plant);
        const explicitDays = overrideEnabled ? normalizeTransplantDays(overrideValue) : null;
        const effectiveDays = explicitDays == null ? plantDefaultDays : explicitDays;
        return {
            plantDefaultDays,
            overrideEnabled: !!overrideEnabled && methodUsesTransplantDateInput(methodId),
            overrideValue: explicitDays,
            effectiveDays
        };
    }

    function requireEffectiveTransplantDays(methodId, effectiveDays) {
        if (methodUsesTransplantDateInput(methodId) && !(Number.isFinite(Number(effectiveDays)) && Number(effectiveDays) > 0)) {
            throw new Error(`methodId "${normId(methodId)}" requires transplant days > 0.`);
        }
    }

    function applyEffectiveTransplantDaysToPlant(plant, effectiveDays) {
        const days = normalizeTransplantDays(effectiveDays);
        if (!plant || days == null || days === plantDefaultTransplantDays(plant)) return plant;
        const row = toPlainDict(plant);
        row.days_transplant = days;
        return new PlantModel(row);
    }

    const DEFAULT_GROWTH_STAGE_KEY = 'mature';
    const DEFAULT_GROWTH_STAGE_LABEL = 'Mature';
    const MIN_GROWTH_STAGE_RATIO = 0.01;
    const MAX_GROWTH_STAGE_RATIO = 10;
    const MIN_GROWTH_STAGE_LAYOUT_RATIO = 0.1;
    const MAX_GROWTH_STAGE_LAYOUT_RATIO = 10;

    function normalizeGrowthStageKey(value) {
        return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    }

    function positiveFiniteOrNull(value) {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? n : null;
    }

    function clampGrowthRatio(value, min = MIN_GROWTH_STAGE_RATIO, max = MAX_GROWTH_STAGE_RATIO) {
        const n = positiveFiniteOrNull(value);
        if (n == null) return null;
        return Math.min(max, Math.max(min, n));
    }

    function deriveGrowthStageLayoutRatio(gddRatio) {
        const ratio = clampGrowthRatio(gddRatio) ?? 1;
        return Math.min(MAX_GROWTH_STAGE_LAYOUT_RATIO, Math.max(MIN_GROWTH_STAGE_LAYOUT_RATIO, Math.sqrt(ratio)));
    }

    function normalizeGrowthStage(row, fallback = null) {
        const source = row || {};
        const fallbackStage = fallback || {};
        const key = normalizeGrowthStageKey(source.stage_key || source.stageKey || fallbackStage.stageKey || fallbackStage.stage_key) || DEFAULT_GROWTH_STAGE_KEY;
        const label = String(source.stage_label || source.stageLabel || fallbackStage.stageLabel || fallbackStage.stage_label || DEFAULT_GROWTH_STAGE_LABEL).trim() || DEFAULT_GROWTH_STAGE_LABEL;
        const gddRatio = clampGrowthRatio(source.gdd_ratio ?? source.gddRatio ?? fallbackStage.gddRatio ?? fallbackStage.gdd_ratio) ?? 1;
        const derivedLayoutRatio = deriveGrowthStageLayoutRatio(gddRatio);
        const spacingRatio = clampGrowthRatio(source.spacing_ratio ?? source.spacingRatio ?? fallbackStage.spacingRatio ?? fallbackStage.spacing_ratio, MIN_GROWTH_STAGE_LAYOUT_RATIO, MAX_GROWTH_STAGE_LAYOUT_RATIO) ?? derivedLayoutRatio;
        const diameterRatio = clampGrowthRatio(source.plant_diameter_ratio ?? source.plantDiameterRatio ?? fallbackStage.plantDiameterRatio ?? fallbackStage.plant_diameter_ratio, MIN_GROWTH_STAGE_LAYOUT_RATIO, MAX_GROWTH_STAGE_LAYOUT_RATIO) ?? derivedLayoutRatio;
        const heightRatio = clampGrowthRatio(source.plant_height_ratio ?? source.plantHeightRatio ?? fallbackStage.plantHeightRatio ?? fallbackStage.plant_height_ratio, MIN_GROWTH_STAGE_LAYOUT_RATIO, MAX_GROWTH_STAGE_LAYOUT_RATIO) ?? derivedLayoutRatio;
        return Object.freeze({
            stageId: finiteNumberOrNull(source.stage_id ?? source.stageId ?? fallbackStage.stageId ?? fallbackStage.stage_id),
            plantId: finiteNumberOrNull(source.plant_id ?? source.plantId ?? fallbackStage.plantId ?? fallbackStage.plant_id),
            stageKey: key,
            stageLabel: label,
            gddRatio,
            spacingRatio,
            plantDiameterRatio: diameterRatio,
            plantHeightRatio: heightRatio,
            sortOrder: finiteNumberOrNull(source.sort_order ?? source.sortOrder ?? fallbackStage.sortOrder ?? fallbackStage.sort_order) ?? 0,
            active: Number(source.active ?? fallbackStage.active ?? 1) === 0 ? 0 : 1,
            isDefault: Number(source.is_default ?? source.isDefault ?? fallbackStage.isDefault ?? fallbackStage.is_default ?? (key === DEFAULT_GROWTH_STAGE_KEY ? 1 : 0)) === 1 ? 1 : 0,
            legacy: !!source.legacy
        });
    }

    function defaultGrowthStage() {
        return normalizeGrowthStage({
            stage_key: DEFAULT_GROWTH_STAGE_KEY,
            stage_label: DEFAULT_GROWTH_STAGE_LABEL,
            gdd_ratio: 1,
            spacing_ratio: 1,
            plant_diameter_ratio: 1,
            plant_height_ratio: 1,
            sort_order: 0,
            active: 1,
            is_default: 1
        });
    }

    function stageIsDefaultMature(stage) {
        const normalized = normalizeGrowthStage(stage);
        return normalized.stageKey === DEFAULT_GROWTH_STAGE_KEY
            && Math.abs(normalized.gddRatio - 1) < 0.000001
            && Math.abs(normalized.spacingRatio - 1) < 0.000001
            && Math.abs(normalized.plantDiameterRatio - 1) < 0.000001
            && Math.abs(normalized.plantHeightRatio - 1) < 0.000001;
    }

    function readGrowthStageFromCell(cell) {
        const key = normalizeGrowthStageKey(cell?.getAttribute?.('growth_stage_key'));
        if (!key) return defaultGrowthStage();
        return normalizeGrowthStage({
            stage_key: key,
            stage_label: cell?.getAttribute?.('growth_stage_label') || key,
            gdd_ratio: cell?.getAttribute?.('growth_stage_gdd_ratio') || 1,
            spacing_ratio: cell?.getAttribute?.('growth_stage_spacing_ratio') || null,
            plant_diameter_ratio: cell?.getAttribute?.('growth_stage_diameter_ratio') || null,
            plant_height_ratio: cell?.getAttribute?.('growth_stage_height_ratio') || null,
            legacy: true
        });
    }

    function scalePositiveField(row, key, ratio) {
        const base = positiveFiniteOrNull(row[key]);
        const scale = positiveFiniteOrNull(ratio);
        if (base == null || scale == null) return;
        row[key] = base * scale;
    }

    function applyGrowthStageToPlant(plant, stage) {
        const growthStage = normalizeGrowthStage(stage);
        if (!plant || stageIsDefaultMature(growthStage)) return plant;
        const row = toPlainDict(plant);
        scalePositiveField(row, 'gdd_to_maturity', growthStage.gddRatio);
        scalePositiveField(row, 'days_maturity', growthStage.gddRatio);
        scalePositiveField(row, 'spacing_cm', growthStage.spacingRatio);
        scalePositiveField(row, 'spacing_x_cm', growthStage.spacingRatio);
        scalePositiveField(row, 'spacing_y_cm', growthStage.spacingRatio);
        scalePositiveField(row, 'veg_diameter_cm', growthStage.plantDiameterRatio);
        scalePositiveField(row, 'veg_height_cm', growthStage.plantHeightRatio);
        row.growth_stage_key = growthStage.stageKey;
        row.growth_stage_label = growthStage.stageLabel;
        row.growth_stage_gdd_ratio = growthStage.gddRatio;
        row.growth_stage_spacing_ratio = growthStage.spacingRatio;
        row.growth_stage_diameter_ratio = growthStage.plantDiameterRatio;
        row.growth_stage_height_ratio = growthStage.plantHeightRatio;
        return new PlantModel(row);
    }

    function shiftISODateByDays(value, days) {
        const date = parseISODateUTCValue(value);
        if (!date) return '';
        return fmtISO(addDaysUTC(date, Number(days) || 0));
    }

    function sowDateFromPrimaryDate(primaryDateISO, methodId, effectiveTransplantDays) {
        return methodUsesTransplantDateInput(methodId)
            ? shiftISODateByDays(primaryDateISO, -Math.max(0, Number(effectiveTransplantDays) || 0))
            : String(primaryDateISO || '').trim();
    }

    function primaryDateFromSowDate(sowDateISO, methodId, effectiveTransplantDays) {
        return methodUsesTransplantDateInput(methodId)
            ? shiftISODateByDays(sowDateISO, Math.max(0, Number(effectiveTransplantDays) || 0))
            : String(sowDateISO || '').trim();
    }

    function formatShortMonthDayUTC(date) {
        return date.toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
    }

    function labelProjectedSowingSeason(window, startDate, endDate) {
        const baseLabel = String(window?.label || '').replace(/\s*\([^)]*\)\s*$/, '').trim() || 'Season';
        return `${baseLabel} (${formatShortMonthDayUTC(startDate)}-${formatShortMonthDayUTC(endDate)})`;
    }

    function projectSowingSeasonForPrimaryDate(window, methodId, effectiveTransplantDays) {
        const normalized = normalizeSowingSeason(window);
        if (!normalized || !methodUsesTransplantDateInput(methodId)) return normalized;
        const startDate = addDaysUTC(parseISODateUTCValue(normalized.startISO), Math.max(0, Number(effectiveTransplantDays) || 0));
        const endDate = addDaysUTC(parseISODateUTCValue(normalized.endISO), Math.max(0, Number(effectiveTransplantDays) || 0));
        return {
            ...normalized,
            label: labelProjectedSowingSeason(normalized, startDate, endDate),
            startISO: fmtISO(startDate),
            endISO: fmtISO(endDate)
        };
    }

    function projectSowingSeasonsForPrimaryDate(windows, methodId, effectiveTransplantDays) {
        return normalizeSowingSeasons(windows).map(window => projectSowingSeasonForPrimaryDate(window, methodId, effectiveTransplantDays)).filter(Boolean);
    }

    function isPerennialPlant(plant) { // FIX: keep lifespan-only schedules out of maturity-budget code paths
        return !!(plant && typeof plant.isPerennial === 'function' && plant.isPerennial());
    }

    function requirePerennialLifespanYears(plant) { // FIX: validate the sole required duration for perennial schedules
        const lifespanYears = finiteNumberOrNull(plant?.lifespan_years);
        if (lifespanYears == null || lifespanYears < 1) {
            throw new Error(`Perennial "${plant?.plant_name || 'plant'}" requires lifespan_years >= 1.`);
        }
        return Math.floor(lifespanYears);
    }

    function computePerennialLifespanEndISO(fromISO, seasonStartYear, lifespanYears) { // FIX: centralize lifespan-based schedule ends
        const start = parseISODateUTCValue(fromISO) || asUTCDate(Number(seasonStartYear), 1, 1);
        const years = Math.max(1, Math.floor(Number(lifespanYears) || 0));
        return asUTCDate(start.getUTCFullYear() + years, 12, 31).toISOString().slice(0, 10);
    }

    async function runUiAsyncOperation(label, fn, onError) { // FIX: testable async UI error boundary
        try {
            return await fn();
        } catch (e) {
            if (typeof onError === 'function') onError(`${label}: ${e?.message || String(e)}`, e);
            return null;
        }
    }

    const DEFAULT_HARVEST_WINDOW_DAYS = 7; // FIX: use one fallback across every scheduling entry point
    const HARVEST_END_SEMANTICS = 'exclusive'; // FIX: harvestEnd is the first instant outside the harvest window

    // Resolves user, plant, and fallback values while preserving an explicit zero-day window.
    function resolveHarvestWindowDays(explicitValue, plant = null) { // FIX: centralize harvest-window normalization
        const explicitDays = finiteNumberOrNull(explicitValue);
        if (explicitDays != null && explicitDays >= 0) return Math.round(explicitDays); // FIX: return whole calendar days

        const plantDays = finiteNumberOrNull(plant?.harvest_window_days);
        if (plantDays != null && plantDays >= 0) return Math.round(plantDays); // FIX: normalize stored defaults too

        return Math.round(Math.max(0, DEFAULT_HARVEST_WINDOW_DAYS)); // FIX: guarantee a non-negative integer fallback
    }
    function parseISODateUTCValue(value) {
        const s = String(value ?? '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
        const d = new Date(s + 'T00:00:00Z');
        return Number.isNaN(d.getTime()) ? null : d;
    }
    function isUsableDate(value) {
        return value instanceof Date && !Number.isNaN(value.getTime());
    }
    function pickFrostByRisk(city, risk = 'p50') {
        return sharedCore.resolveSpringFrostByRisk(city, risk).doy; // CHANGED: use the shared stored/inferred/fallback frost resolver.
    }

    let __dbPathCached = null;

    async function getDbPath() {
        if (__dbPathCached) {
            return __dbPathCached;
        }

        if (!window.dbBridge || typeof window.dbBridge.resolvePath !== "function") {
            throw new Error("dbBridge.resolvePath not available; add dbResolvePath wiring");
        }

        const r = await window.dbBridge.resolvePath({
            dbName: "Trellis_database.sqlite"
            // seedRelPath omitted -> main uses its default ../../trellis_database/Trellis_database.sqlite
            // reset: true // only for testing if you want to re-copy seed
        });

        __dbPathCached = r.dbPath;

        return __dbPathCached;
    }

    // -------------------- DB helpers (open → exec/run → close) ------------------------------

    async function queryAllOnDb(dbId, sql, params = []) {
        if (!window.dbBridge || typeof window.dbBridge.query !== 'function') {
            throw new Error('dbBridge.query not available');
        }
        const res = await window.dbBridge.query(dbId, sql, params || []);
        return Array.isArray(res?.rows) ? res.rows : [];
    }

    async function execRunOnDb(dbId, sql, params = []) {
        try {
            if (typeof window.dbBridge.exec === "function") {
                return await window.dbBridge.exec(dbId, sql, params || []);
            }
            if (typeof window.dbBridge.run === "function") {
                return await window.dbBridge.run(dbId, sql, params || []);
            }
            throw new Error("dbBridge.exec/run not available");
        } catch (e) {
            console.error("[DB RUN FAIL]", { dbId, sql, params, message: e?.message || String(e) }); // <-- PLACE HERE
            throw e;
        }
    }

    async function withDbWrite(fn) {
        const dbPath = await getDbPath();
        const opened = await window.dbBridge.open(dbPath, { readOnly: false });
        try {
            return await fn(opened.dbId);
        } finally {
            try { await window.dbBridge.close(opened.dbId); } catch (_) { }
        }
    }

    async function withDbTransaction(fn) { // FIX: keep related database writes atomic
        return await withDbWrite(async (dbId) => { // FIX: use one connection for the full transaction
            await execRunOnDb(dbId, "BEGIN;"); // FIX: begin before any related record changes
            try {
                const result = await fn(dbId); // FIX: run all writes inside the transaction
                await execRunOnDb(dbId, "COMMIT;"); // FIX: publish only after every write succeeds
                return result;
            } catch (e) {
                try { await execRunOnDb(dbId, "ROLLBACK;"); } catch (_) { } // FIX: discard partial writes
                throw e;
            }
        });
    }

    async function queryAll(sql, params) {
        if (!window.dbBridge || typeof window.dbBridge.open !== 'function') {
            throw new Error('dbBridge not available; check preload/main wiring');
        }
        const dbPath = await getDbPath();
        const opened = await window.dbBridge.open(dbPath, { readOnly: true });
        try {
            const res = await window.dbBridge.query(opened.dbId, sql, params);
            return Array.isArray(res?.rows) ? res.rows : [];
        } finally {
            try { await window.dbBridge.close(opened.dbId); } catch (_) { }
        }
    }

    async function execAll(sql, params) {
        if (!window.dbBridge || typeof window.dbBridge.open !== 'function') {
            throw new Error('dbBridge not available; check preload/main wiring');
        }

        const dbPath = await getDbPath();
        const opened = await window.dbBridge.open(dbPath, { readOnly: false });

        try {
            if (typeof window.dbBridge.exec === 'function') {
                await window.dbBridge.exec(opened.dbId, sql, params || []);
            } else if (typeof window.dbBridge.run === 'function') {
                await window.dbBridge.run(opened.dbId, sql, params || []);
            } else {
                throw new Error('dbBridge.exec/run not available');
            }
        } finally {
            try { await window.dbBridge.close(opened.dbId); } catch (_) { }
        }
    }

    const PHYSIOLOGY_PLANT_COLUMNS = Object.freeze({
        establishment_temp_max_c: 'REAL',
        establishment_heat_window_days: 'INTEGER',
        establishment_heat_policy: 'TEXT',
        quality_temp_max_c: 'REAL',
        heat_stress_stage: 'TEXT',
        quality_heat_policy: 'TEXT',
        photoperiod_response: 'TEXT',
        critical_daylength_hours: 'REAL',
        photoperiod_stage: 'TEXT',
        photoperiod_policy: 'TEXT',
        chilling_required_days: 'REAL',
        chilling_required_hours: 'REAL',
        chilling_temp_min_c: 'REAL',
        chilling_temp_max_c: 'REAL',
        chilling_stage: 'TEXT',
        chilling_policy: 'TEXT',
        killtemp_c: 'REAL',
        diagnostic_policy: 'TEXT',
        spacing_x_cm: 'REAL',
        spacing_y_cm: 'REAL'
    });
    const PHYSIOLOGY_CITY_COLUMNS = Object.freeze({ // CHANGED: scheduler owns lightweight city geography columns for grouped city selection.
        country_name: 'TEXT',
        country_code: 'TEXT',
        region_name: 'TEXT',
        region_code: 'TEXT'
    });
    const COMPANION_LAYOUT_TEMPLATES = Object.freeze(['beside', 'interplant', 'staggered']);
    const COMPANION_TIMING_COLUMNS = Object.freeze({
        source_plant_id: 'INTEGER',
        companion_plant_id: 'INTEGER',
        start_offset_days: 'INTEGER',
        layout_template: 'TEXT',
        layout_spacing_x_cm: 'REAL',
        layout_spacing_y_cm: 'REAL',
        layout_offset_x_cm: 'REAL',
        layout_offset_y_cm: 'REAL'
    });
    let schedulerPhysiologySchemaEnsured = false;

    async function ensureTableColumns(dbId, tableName, columns) {
        const tableRows = await queryAllOnDb(dbId, `SELECT name FROM sqlite_master WHERE type='table' AND name=?;`, [tableName]);
        if (!tableRows.length) return;
        const existing = new Set((await queryAllOnDb(dbId, `PRAGMA table_info(${tableName});`, [])).map(row => String(row.name || '').toLowerCase()));
        for (const [column, type] of Object.entries(columns)) {
            if (existing.has(column.toLowerCase())) continue;
            await execRunOnDb(dbId, `ALTER TABLE ${tableName} ADD COLUMN ${column} ${type};`, []);
        }
    }

    async function ensureSchedulerPhysiologySchema() {
        if (schedulerPhysiologySchemaEnsured) return;
        await withDbWrite(async dbId => {
            await ensureTableColumns(dbId, 'Plants', PHYSIOLOGY_PLANT_COLUMNS);
            await ensureTableColumns(dbId, 'Cities', PHYSIOLOGY_CITY_COLUMNS);
            await ensureTableColumns(dbId, 'Companions', COMPANION_TIMING_COLUMNS);
            await execRunOnDb(dbId, `CREATE TABLE IF NOT EXISTS CompanionLayoutGroupDefaults (
                group_default_id INTEGER PRIMARY KEY AUTOINCREMENT,
                plant_set_key TEXT NOT NULL,
                anchor_plant_id INTEGER NOT NULL,
                layout_json TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(plant_set_key, anchor_plant_id)
            );`, []);
            await execRunOnDb(dbId, `CREATE TABLE IF NOT EXISTS CompanionSetLayoutDefaults (
                set_default_id INTEGER PRIMARY KEY AUTOINCREMENT,
                crop_set_key TEXT NOT NULL UNIQUE,
                layout_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );`, []); // CHANGE: anchorless companion-set defaults are keyed only by the unordered active crop set.
            await execRunOnDb(dbId, `CREATE TABLE IF NOT EXISTS PlantGrowthStages (
                stage_id INTEGER PRIMARY KEY AUTOINCREMENT,
                plant_id INTEGER NOT NULL REFERENCES Plants(plant_id) ON DELETE CASCADE,
                stage_key TEXT NOT NULL,
                stage_label TEXT NOT NULL,
                gdd_ratio REAL NOT NULL,
                spacing_ratio REAL,
                plant_diameter_ratio REAL,
                plant_height_ratio REAL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                active INTEGER NOT NULL DEFAULT 1,
                is_default INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(plant_id, stage_key)
            );`, []);
            await execRunOnDb(dbId, `CREATE INDEX IF NOT EXISTS idx_PlantGrowthStages_plant_id ON PlantGrowthStages (plant_id);`, []);
        });
        schedulerPhysiologySchemaEnsured = true;
    }


    // -------------------- Models ----------------------------------------------------------
    class PlantModel {
        constructor(row) {
            Object.assign(this, row);
            this.annual = Number(this.annual ?? 0);
            this.biennial = Number(this.biennial ?? 0);
            this.perennial = Number(this.perennial ?? 0);
            this.lifespan_years = Number(this.lifespan_years ?? NaN); // may be null/NaN
            this.overwinter_ok = Number(this.overwinter_ok ?? 0);
        }
        isAnnual() { return this.annual === 1; }
        isBiennial() { return this.biennial === 1; }
        isPerennial() { return this.perennial === 1; }

        // In PlantModel constructor (no change needed; Object.assign handles it)
        // Optional helpers:
        startCoolingThresholdC() {
            return coolingGateThresholdC(this); // FIX: annual heat thresholds are not fall gates
        }
        hasCoolingTrigger() {
            return coolingGateThresholdC(this) != null;
        }


        static async loadByName(name) {
            await ensureSchedulerPhysiologySchema();
            const sql = `
          SELECT *,
                 COALESCE(direct_sow,0) AS direct_sow,
                 COALESCE(transplant,0) AS transplant,
                 COALESCE(overwinter_ok,0) AS overwinter_ok
          FROM Plants
          WHERE plant_name = ?
          LIMIT 1;`;
            const rows = await queryAll(sql, [name]);
            return rows[0] ? new PlantModel(rows[0]) : null;
        }

        static async loadById(id) {
            await ensureSchedulerPhysiologySchema();
            const sql = `
          SELECT *,
                 COALESCE(direct_sow,0) AS direct_sow,
                 COALESCE(transplant,0) AS transplant,
                 COALESCE(overwinter_ok,0) AS overwinter_ok
          FROM Plants
          WHERE plant_id = ?;`;
            const rows = await queryAll(sql, [id]);
            return rows[0] ? new PlantModel(rows[0]) : null;
        }

        static async listBasic() {
            await ensureSchedulerPhysiologySchema();
            const sql = `
          SELECT plant_id, plant_name, abbr, yield_per_plant_kg, gdd_to_maturity, 
                 tmin_c, topt_low_c, topt_high_c, tmax_c, tbase_c, killtemp_c,
                 harvest_window_days, days_maturity, days_transplant, days_germ,
                 direct_sow, transplant, default_planting_method_category, default_planting_method, overwinter_ok, start_cooling_threshold_c,
                  soil_temp_min_plant_c, annual, biennial, perennial, lifespan_years, veg_diameter_cm, spacing_cm, spacing_x_cm, spacing_y_cm,
                 establishment_temp_max_c, establishment_heat_window_days, establishment_heat_policy,
                 quality_temp_max_c, heat_stress_stage, quality_heat_policy,
                 photoperiod_response, critical_daylength_hours, photoperiod_stage, photoperiod_policy,
                 chilling_required_days, chilling_required_hours, chilling_temp_min_c, chilling_temp_max_c, chilling_stage, chilling_policy, diagnostic_policy
          FROM Plants
          WHERE abbr IS NOT NULL
          ORDER BY plant_name;`;
            const rows = await queryAll(sql, []);
            return rows.map(r => new PlantModel(r));
        }

        static async listAllowedMethodCategoriesForPlant(plantId) {
            const sql = `
              SELECT pam.plant_id,
                     pam.method_category_id,
                     pmc.method_category_name
              FROM PlantAllowedMethodCategories AS pam
              JOIN PlantingMethodCategories AS pmc
                ON LOWER(TRIM(pmc.method_category_id)) = LOWER(TRIM(pam.method_category_id))
              WHERE pam.plant_id = ?
              ORDER BY CASE
                         WHEN TRIM(pam.method_category_id) = LOWER(TRIM(pam.method_category_id)) THEN 0
                         ELSE 1
                       END,
                       LOWER(TRIM(pam.method_category_id));`;
            const rows = await queryAll(sql, [Number(plantId)]);
            const seen = new Set(); // FIX: collapse invalid case-only duplicates deterministically
            return rows.flatMap(row => {
                const methodCategoryId = normId(row?.method_category_id);
                if (!methodCategoryId || seen.has(methodCategoryId)) return [];
                seen.add(methodCategoryId);
                return [{ ...row, method_category_id: methodCategoryId }];
            });
        }


        static async listMethodsForMethodCategory(methodCategoryId) {
            const mcid = normId(methodCategoryId);
            if (!mcid) return [];

            const sql = `
              SELECT method_id,
                     method_category_id,
                     method_name,
                     tasks_required_json
              FROM PlantingMethods
              WHERE LOWER(TRIM(method_category_id)) = ?
              ORDER BY CASE
                         WHEN TRIM(method_id) = LOWER(TRIM(method_id)) THEN 0
                         ELSE 1
                       END,
                       LOWER(TRIM(method_id)),
                       method_name;`;
            const rows = await queryAll(sql, [mcid]);
            const seen = new Set();
            return rows.flatMap(row => {
                const methodId = normId(row?.method_id);
                if (!methodId || seen.has(methodId)) return [];
                seen.add(methodId);
                return [{
                    ...row,
                    method_id: methodId,
                    method_category_id: normId(row?.method_category_id || mcid)
                }];
            });
        }


        static async getMethodById(methodId) {
            const normalizedMethodId = normId(methodId);
            if (!normalizedMethodId) return null;

            const sql = `
                SELECT method_category_id, method_id, method_name, tasks_required_json
                FROM PlantingMethods
                WHERE LOWER(TRIM(method_id)) = ?
                ORDER BY CASE
                           WHEN TRIM(method_id) = LOWER(TRIM(method_id)) THEN 0
                           ELSE 1
                         END,
                         method_id
                LIMIT 1;`;
            const rows = await queryAll(sql, [normalizedMethodId]);
            return rows[0] ? {
                ...rows[0],
                method_id: normId(rows[0].method_id),
                method_category_id: normId(rows[0].method_category_id)
            } : null;
        }


        gddRequired() {
            const a = Number(this.gdd_to_maturity);
            if (Number.isFinite(a) && a > 0) return a;
            const b = Number(this.days_maturity);
            if (Number.isFinite(b) && b > 0) return b;
            throw new Error(`Plant "${this.plant_name}": requires gdd_to_maturity or days_maturity in DB.`);
        }



        defaultHW() {
            return resolveHarvestWindowDays(null, this); // FIX: normalize missing or invalid plant defaults
        }

        cropTempEnvelope() {
            const Tbase = Number(this.tbase_c ?? 10);
            return {
                Tmin: Number(this.tmin_c ?? 0),
                ToptLow: Number(this.topt_low_c ?? (Tbase + 6)),
                ToptHigh: Number(this.topt_high_c ?? (Tbase + 14)),
                Tmax: Number(this.tmax_c ?? (Tbase + 24)),
                Tbase
            };
        }

        yieldPerPlant() {
            return Number(this.yield_per_plant_kg ?? 0.25);
        }

        // Amount UNTIL FIRST HARVEST, with units
        firstHarvestBudget() {
            const days = Number(this.days_maturity);
            const gdd = Number(this.gdd_to_maturity);

            const isTruePerennial = this.isPerennial() && !(Number(this.overwinter_ok) === 1 && this.isAnnual());

            // True perennials: prefer explicit days
            if (isTruePerennial && Number.isFinite(days) && days > 0)
                return { mode: 'days', amount: days };

            // Overwintered annuals (e.g., garlic): prefer GDD if present
            if (Number(this.overwinter_ok) === 1 && Number.isFinite(gdd) && gdd > 0)
                return { mode: 'gdd', amount: gdd };

            // Otherwise: prefer GDD, else days
            if (Number.isFinite(gdd) && gdd > 0) return { mode: 'gdd', amount: gdd };
            if (Number.isFinite(days) && days > 0) return { mode: 'days', amount: days };

            throw new Error(`Plant "${this.plant_name}": needs gdd_to_maturity or days_maturity.`);
        }

        static async create(patch) {
            await ensureSchedulerPhysiologySchema();
            const cols = [];
            const qs = [];
            const vals = [];
            for (const [k, v] of Object.entries(patch || {})) {
                if (v === undefined) continue;
                if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new Error('Invalid column: ' + k);
                cols.push(k);
                qs.push('?');
                vals.push(v === undefined ? null : v);
            }
            if (!cols.length) throw new Error('No fields to create plant.');

            const insertSql = `INSERT INTO Plants (${cols.join(', ')}) VALUES (${qs.join(', ')});`;

            return await withDbWrite(async (dbId) => {
                await execRunOnDb(dbId, "BEGIN;");
                try {
                    await execRunOnDb(dbId, insertSql, vals);
                    const idRows = await queryAllOnDb(dbId, "SELECT last_insert_rowid() AS id;", []);
                    const newId = Number(idRows?.[0]?.id);
                    const rows = await queryAllOnDb(dbId, "SELECT * FROM Plants WHERE plant_id = ?;", [newId]);
                    await execRunOnDb(dbId, "COMMIT;");
                    return rows[0] ? new PlantModel(rows[0]) : null;
                } catch (e) {
                    try { await execRunOnDb(dbId, "ROLLBACK;"); } catch (_) { }
                    throw e;
                }
            });
        }

        static async update(plantId, patch) {
            await ensureSchedulerPhysiologySchema();
            const id = Number(plantId);
            if (!Number.isFinite(id)) throw new Error('Invalid plantId');

            const sets = [];
            const vals = [];
            for (const [k, v] of Object.entries(patch || {})) {
                if (v === undefined) continue;
                if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new Error('Invalid column: ' + k);
                sets.push(`${k} = ?`);
                vals.push(v === undefined ? null : v);
            }
            if (!sets.length) return await PlantModel.loadById(id);

            vals.push(id);
            const sql = `UPDATE Plants SET ${sets.join(', ')} WHERE plant_id = ?;`;

            console.log("[PlantModel.update] patch keys =", Object.keys(patch || {}));
            console.log("[PlantModel.update] default_planting_method =", patch?.default_planting_method);

            await execAll(sql, vals);

            return await PlantModel.loadById(id);
        }

        static async saveWithAllowedMethodCategories(plantId, patch, methodCategoryIds) { // FIX: save plant and allowed methods together
            await ensureSchedulerPhysiologySchema();
            const existingId = finiteNumberOrNull(plantId); // FIX: distinguish insert from update without another connection
            const ids = Array.from(new Set((methodCategoryIds || [])
                .map(normId)
                .filter(Boolean))); // FIX: normalize duplicate category selections

            if (!ids.length) throw new Error('Enable at least one method'); // FIX: enforce the editor invariant in the model operation

            return await withDbTransaction(async (dbId) => { // FIX: make the plant and junction-table writes atomic
                let savedId = existingId;
                const entries = Object.entries(patch || {}).filter(([, value]) => value !== undefined);

                for (const [key] of entries) {
                    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error('Invalid column: ' + key); // FIX: retain dynamic-column validation
                }
                if (!entries.length) throw new Error('No fields to save plant.'); // FIX: avoid an invalid empty statement

                if (savedId != null) {
                    const sets = entries.map(([key]) => `${key} = ?`);
                    const values = entries.map(([, value]) => value);
                    values.push(savedId);
                    await execRunOnDb(dbId, `UPDATE Plants SET ${sets.join(', ')} WHERE plant_id = ?;`, values); // FIX: update on the shared transaction
                } else {
                    const columns = entries.map(([key]) => key);
                    const values = entries.map(([, value]) => value);
                    const placeholders = columns.map(() => '?');
                    await execRunOnDb(
                        dbId,
                        `INSERT INTO Plants (${columns.join(', ')}) VALUES (${placeholders.join(', ')});`,
                        values
                    ); // FIX: insert on the shared transaction
                    const idRows = await queryAllOnDb(dbId, "SELECT last_insert_rowid() AS id;", []); // FIX: resolve the inserted ID on the same connection
                    savedId = Number(idRows?.[0]?.id);
                }

                if (!Number.isFinite(savedId)) throw new Error('Save succeeded but plant_id is missing'); // FIX: prevent junction writes without a valid owner

                await execRunOnDb(
                    dbId,
                    "DELETE FROM PlantAllowedMethodCategories WHERE plant_id = ?;",
                    [savedId]
                ); // FIX: replace the allowed-method set within the transaction

                for (const methodCategoryId of ids) {
                    await execRunOnDb(
                        dbId,
                        "INSERT OR IGNORE INTO PlantAllowedMethodCategories (plant_id, method_category_id) VALUES (?, ?);",
                        [savedId, methodCategoryId]
                    ); // FIX: keep each junction insert in the same transaction
                }

                const rows = await queryAllOnDb(dbId, "SELECT * FROM Plants WHERE plant_id = ?;", [savedId]); // FIX: return the transaction's saved row
                if (!rows[0]) throw new Error(`Plant not found after save: ${savedId}`); // FIX: roll back junction changes when the owner row is missing
                return new PlantModel(rows[0]);
            });
        }
    }


    class CompanionRelationshipModel {
        static async listForSourcePlant(plantId) {
            const sourceId = Number(plantId);
            if (!Number.isFinite(sourceId)) return [];
            await ensureSchedulerPhysiologySchema();
            const sql = `
                SELECT c.relation_id,
                       c.source_plant_id,
                       c.companion_plant_id,
                       c.start_offset_days,
                       c.p1,
                       c.p2,
                       c.rating,
                       c.companion_type,
                       c.companion_type_id,
                       c.layout_template,
                       c.layout_spacing_x_cm,
                       c.layout_spacing_y_cm,
                       c.layout_offset_x_cm,
                       c.layout_offset_y_cm,
                       ce.evidence_level,
                       ce.review_status,
                       ce.source_url,
                       ce.source_note,
                       ce.summary
                FROM Companions c
                LEFT JOIN CompanionEvidence ce ON ce.relation_id = c.relation_id
                WHERE (c.source_plant_id = ? OR c.companion_plant_id = ?)
                  AND c.source_plant_id IS NOT NULL
                  AND c.companion_plant_id IS NOT NULL
                ORDER BY c.rating DESC, LOWER(COALESCE(c.companion_type,'')), c.relation_id;`;
            const rows = await queryAll(sql, [sourceId, sourceId]);
            const byKey = new Map();
            rows.forEach(row => {
                const forward = Number(row.source_plant_id) === sourceId;
                const companionPlantId = forward ? Number(row.companion_plant_id) : Number(row.source_plant_id);
                if (!Number.isFinite(companionPlantId)) return;
                const recommended = finiteNumberOrNull(row.start_offset_days) ?? 0;
                const key = `${row.relation_id || ''}:${companionPlantId}`;
                if (!byKey.has(key)) {
                    byKey.set(key, {
                        relationId: row.relation_id != null ? String(row.relation_id) : '',
                        sourcePlantId: String(sourceId),
                        companionPlantId: String(companionPlantId),
                        storedSourcePlantId: row.source_plant_id != null ? String(row.source_plant_id) : '',
                        storedCompanionPlantId: row.companion_plant_id != null ? String(row.companion_plant_id) : '',
                        direction: forward ? 'forward' : 'inverse',
                        recommendedStartOffsetDays: forward ? recommended : -recommended,
                        storedStartOffsetDays: recommended,
                        rating: row.rating,
                        companionType: row.companion_type || '',
                        companionTypeId: row.companion_type_id != null ? String(row.companion_type_id) : '',
                        layoutTemplate: normalizeCompanionLayoutTemplate(row.layout_template),
                        layoutSpacingXCm: finiteNumberOrNull(row.layout_spacing_x_cm),
                        layoutSpacingYCm: finiteNumberOrNull(row.layout_spacing_y_cm),
                        layoutOffsetXCm: forward ? finiteNumberOrNull(row.layout_offset_x_cm) : (finiteNumberOrNull(row.layout_offset_x_cm) == null ? null : -finiteNumberOrNull(row.layout_offset_x_cm)),
                        layoutOffsetYCm: forward ? finiteNumberOrNull(row.layout_offset_y_cm) : (finiteNumberOrNull(row.layout_offset_y_cm) == null ? null : -finiteNumberOrNull(row.layout_offset_y_cm)),
                        p1: row.p1 || '',
                        p2: row.p2 || '',
                        evidence: []
                    });
                }
                if (row.evidence_level || row.summary || row.source_url || row.source_note) {
                    byKey.get(key).evidence.push({
                        evidenceLevel: row.evidence_level || '',
                        reviewStatus: row.review_status || '',
                        sourceUrl: row.source_url || '',
                        sourceNote: row.source_note || '',
                        summary: row.summary || ''
                    });
                }
            });
            return Array.from(byKey.values());
        }
        static async saveLayoutDefaults(relationId, layout, relationship = null) {
            const id = finiteNumberOrNull(relationId);
            if (id == null) throw new Error('Companion relationship is required before saving layout defaults.');
            await ensureSchedulerPhysiologySchema();
            const inverse = String(relationship?.direction || '').toLowerCase() === 'inverse';
            const offsetX = layoutNumberOrNull(layout?.offsetXCm);
            const offsetY = layoutNumberOrNull(layout?.offsetYCm);
            const normalized = {
                layout_template: normalizeCompanionLayoutTemplate(layout?.template) || null,
                layout_spacing_x_cm: layoutNumberOrNull(layout?.spacingXCm),
                layout_spacing_y_cm: layoutNumberOrNull(layout?.spacingYCm),
                layout_offset_x_cm: inverse && offsetX != null ? -offsetX : offsetX,
                layout_offset_y_cm: inverse && offsetY != null ? -offsetY : offsetY
            };
            await withDbTransaction(async dbId => {
                await execRunOnDb(dbId, `UPDATE Companions
                    SET layout_template=?, layout_spacing_x_cm=?, layout_spacing_y_cm=?, layout_offset_x_cm=?, layout_offset_y_cm=?
                    WHERE relation_id=?;`, [
                    normalized.layout_template,
                    normalized.layout_spacing_x_cm,
                    normalized.layout_spacing_y_cm,
                    normalized.layout_offset_x_cm,
                    normalized.layout_offset_y_cm,
                    id
                ]);
            });
            return String(id);
        }
        static async ensurePairDefaultsRelationship(sourcePlant, companionPlant, relationship = null, opts = {}) {
            const existingId = finiteNumberOrNull(relationship?.relationId);
            if (existingId != null) return Object.assign({}, relationship, { relationId: String(existingId) });
            const sourceId = finiteNumberOrNull(sourcePlant?.plant_id ?? relationship?.sourcePlantId ?? relationship?.storedSourcePlantId);
            const companionId = finiteNumberOrNull(companionPlant?.plant_id ?? relationship?.companionPlantId ?? relationship?.storedCompanionPlantId);
            if (sourceId == null || companionId == null) throw new Error('Source and companion plants are required before saving pair defaults.');
            await ensureSchedulerPhysiologySchema();
            const existing = (await CompanionRelationshipModel.listForSourcePlant(sourceId)).find(rel => String(rel.companionPlantId) === String(companionId));
            if (existing?.relationId) return existing;
            const sourceName = String(sourcePlant?.plant_name || relationship?.p1 || `Plant ${sourceId}`);
            const companionName = String(companionPlant?.plant_name || relationship?.p2 || `Plant ${companionId}`);
            const startOffsetDays = layoutNumberOrNull(opts.startOffsetDays ?? relationship?.recommendedStartOffsetDays ?? relationship?.storedStartOffsetDays) ?? 0;
            let relationId = '';
            await withDbTransaction(async dbId => {
                await execRunOnDb(dbId, `INSERT INTO Companions
                    (p1, p2, rating, companion_type, source_plant_id, companion_plant_id, start_offset_days)
                    VALUES (?, ?, ?, ?, ?, ?, ?);`, [
                    sourceName,
                    companionName,
                    0,
                    'user',
                    sourceId,
                    companionId,
                    startOffsetDays
                ]);
                const rows = await queryAllOnDb(dbId, 'SELECT last_insert_rowid() AS relation_id;', []);
                relationId = String(rows?.[0]?.relation_id || '');
            });
            if (!relationId) throw new Error('Pair default relationship was inserted but no relation_id was returned.');
            return Object.assign(buildGraphCreatedCompanionRelationship(sourcePlant, companionPlant, { startOffsetDays }), {
                relationId,
                known: true,
                graphCreated: true,
                companionType: 'user',
                rating: 0
            });
        }
    }

    class CompanionLayoutGroupDefaultModel {
        static plantSetKey(plantIds) {
            return Array.from(new Set((plantIds || [])
                .map(id => finiteNumberOrNull(id))
                .filter(id => id != null)
                .map(id => String(Math.trunc(id)))))
                .sort((a, b) => Number(a) - Number(b))
                .join('+');
        }

        static normalizeLayout(layout, plantIds, anchorPlantId) {
            const key = CompanionLayoutGroupDefaultModel.plantSetKey(plantIds);
            const anchorId = finiteNumberOrNull(anchorPlantId);
            const rows = Array.isArray(layout?.rows) ? layout.rows : [];
            return {
                version: 1,
                plantSetKey: key,
                anchorPlantId: anchorId,
                rows: rows.map(row => ({
                    role: row?.role === 'anchor' ? 'anchor' : 'companion',
                    plantId: finiteNumberOrNull(row?.plantId),
                    plantName: String(row?.plantName || ''),
                    template: normalizeCompanionLayoutTemplate(row?.template) || (row?.role === 'anchor' ? '' : 'beside'),
                    spacingXCm: layoutNumberOrNull(row?.spacingXCm),
                    spacingYCm: layoutNumberOrNull(row?.spacingYCm),
                    vegDiameterCm: layoutNumberOrNull(row?.vegDiameterCm),
                    offsetXCm: layoutNumberOrNull(row?.offsetXCm),
                    offsetYCm: layoutNumberOrNull(row?.offsetYCm)
                })).filter(row => row.plantId != null)
            };
        }

        static parseRow(row) {
            if (!row) return null;
            try {
                const parsed = JSON.parse(row.layout_json || '{}');
                return Object.assign({}, parsed, {
                    groupDefaultId: String(row.group_default_id || ''),
                    plantSetKey: row.plant_set_key || parsed.plantSetKey || '',
                    anchorPlantId: finiteNumberOrNull(row.anchor_plant_id ?? parsed.anchorPlantId),
                    updatedAt: row.updated_at || ''
                });
            } catch (_) {
                return null;
            }
        }

        static async load(plantIds, anchorPlantId = null) {
            const key = CompanionLayoutGroupDefaultModel.plantSetKey(plantIds);
            if (!key) return null;
            await ensureSchedulerPhysiologySchema();
            const anchorId = finiteNumberOrNull(anchorPlantId);
            const rows = anchorId == null
                ? await queryAll('SELECT * FROM CompanionLayoutGroupDefaults WHERE plant_set_key = ? ORDER BY updated_at DESC LIMIT 1;', [key])
                : await queryAll('SELECT * FROM CompanionLayoutGroupDefaults WHERE plant_set_key = ? AND anchor_plant_id = ? LIMIT 1;', [key, anchorId]);
            return CompanionLayoutGroupDefaultModel.parseRow(rows[0]);
        }

        static async listForPlant(plantId) {
            const id = finiteNumberOrNull(plantId);
            if (id == null) return [];
            await ensureSchedulerPhysiologySchema();
            const token = String(Math.trunc(id));
            const rows = await queryAll(`SELECT * FROM CompanionLayoutGroupDefaults
                WHERE plant_set_key = ? OR plant_set_key LIKE ? OR plant_set_key LIKE ? OR plant_set_key LIKE ?
                ORDER BY updated_at DESC;`, [token, `${token}+%`, `%+${token}+%`, `%+${token}`]);
            return rows.map(row => CompanionLayoutGroupDefaultModel.parseRow(row)).filter(Boolean);
        }

        static async save(plantIds, anchorPlantId, layout) {
            const key = CompanionLayoutGroupDefaultModel.plantSetKey(plantIds);
            const anchorId = finiteNumberOrNull(anchorPlantId);
            if (!key || anchorId == null) throw new Error('Plant set and anchor plant are required before saving group layout defaults.');
            const normalized = CompanionLayoutGroupDefaultModel.normalizeLayout(layout, plantIds, anchorId);
            await ensureSchedulerPhysiologySchema();
            await withDbTransaction(async dbId => {
                await execRunOnDb(dbId, `INSERT INTO CompanionLayoutGroupDefaults
                    (plant_set_key, anchor_plant_id, layout_json, updated_at)
                    VALUES (?, ?, ?, datetime('now'))
                    ON CONFLICT(plant_set_key, anchor_plant_id) DO UPDATE SET
                        layout_json = excluded.layout_json,
                        updated_at = excluded.updated_at;`, [key, anchorId, JSON.stringify(normalized)]);
            });
            return normalized;
        }
    }

    class CompanionSetLayoutDefaultModel {
        static identityToken(row, broad = false) {
            if (!broad && row?.identityKey) return String(row.identityKey || '').trim();
            const plantId = finiteNumberOrNull(row?.plantId ?? row?.plant_id);
            const varietyId = broad ? null : finiteNumberOrNull(row?.varietyId ?? row?.variety_id);
            if (varietyId != null) return `v:${Math.trunc(varietyId)}`;
            if (plantId != null) return `p:${Math.trunc(plantId)}`;
            return '';
        }

        static cropSetKey(rows, broad = false) {
            return Array.from(new Set((rows || []).map(row => CompanionSetLayoutDefaultModel.identityToken(row, broad)).filter(Boolean)))
                .sort()
                .join('+'); // CHANGE: unordered crop/variety identities replace anchor-specific companion layout keys.
        }

        static normalizeLayout(rows, broad = false) {
            const normalizedRows = [];
            const seen = new Set();
            for (const row of rows || []) {
                const identityKey = CompanionSetLayoutDefaultModel.identityToken(row, broad);
                if (!identityKey || seen.has(identityKey)) continue;
                seen.add(identityKey);
                normalizedRows.push({
                    identityKey,
                    plantId: finiteNumberOrNull(row?.plantId ?? row?.plant_id),
                    varietyId: broad ? null : finiteNumberOrNull(row?.varietyId ?? row?.variety_id),
                    plantName: String(row?.plantName || row?.plant_name || ''),
                    varietyName: String(row?.varietyName || row?.variety_name || ''),
                    label: String(row?.label || row?.plantName || row?.plant_name || 'Planting'),
                    spacingXCm: layoutNumberOrNull(row?.spacingXCm),
                    spacingYCm: layoutNumberOrNull(row?.spacingYCm),
                    offsetXCm: layoutNumberOrNull(row?.offsetXCm),
                    offsetYCm: layoutNumberOrNull(row?.offsetYCm)
                });
            }
            return { version: 1, cropSetKey: CompanionSetLayoutDefaultModel.cropSetKey(normalizedRows, false), rows: normalizedRows };
        }

        static parseRow(row) {
            if (!row) return null;
            try {
                const parsed = JSON.parse(row.layout_json || '{}');
                return Object.assign({}, parsed, {
                    setDefaultId: String(row.set_default_id || ''),
                    cropSetKey: row.crop_set_key || parsed.cropSetKey || '',
                    updatedAt: row.updated_at || ''
                });
            } catch (_) {
                return null;
            }
        }

        static async loadByKey(key) {
            const cropSetKey = String(key || '').trim();
            if (!cropSetKey) return null;
            await ensureSchedulerPhysiologySchema();
            const rows = await queryAll('SELECT * FROM CompanionSetLayoutDefaults WHERE crop_set_key = ? LIMIT 1;', [cropSetKey]);
            return CompanionSetLayoutDefaultModel.parseRow(rows[0]);
        }

        static async loadForRows(rows) {
            const exactKey = CompanionSetLayoutDefaultModel.cropSetKey(rows, false);
            const broadKey = CompanionSetLayoutDefaultModel.cropSetKey(rows, true);
            return {
                exactKey,
                broadKey,
                default: await CompanionSetLayoutDefaultModel.loadByKey(exactKey) || (broadKey !== exactKey ? await CompanionSetLayoutDefaultModel.loadByKey(broadKey) : null)
            }; // CHANGE: variety-specific set defaults fall back to plant-level set defaults.
        }

        static async save(rows) {
            const normalized = CompanionSetLayoutDefaultModel.normalizeLayout(rows, false);
            if (!normalized.cropSetKey || normalized.rows.length < 2) throw new Error('At least two crop identities are required before saving a set default.');
            await ensureSchedulerPhysiologySchema();
            await withDbTransaction(async dbId => {
                await execRunOnDb(dbId, `INSERT INTO CompanionSetLayoutDefaults
                    (crop_set_key, layout_json, updated_at)
                    VALUES (?, ?, datetime('now'))
                    ON CONFLICT(crop_set_key) DO UPDATE SET
                        layout_json = excluded.layout_json,
                        updated_at = excluded.updated_at;`, [normalized.cropSetKey, JSON.stringify(normalized)]);
            });
            return normalized;
        }
    }























    class TaskTemplateModel {
        static async ensureTables() {
            const plantTemplateSql = `
                CREATE TABLE IF NOT EXISTS PlantTaskTemplates (
                  plant_id      INTEGER NOT NULL,
                  method_id     TEXT    NOT NULL,
                  template_json TEXT    NOT NULL,
                  updated_at    TEXT    NOT NULL,
                  PRIMARY KEY (plant_id, method_id)
                );`;
            const varietyTemplateSql = `
                CREATE TABLE IF NOT EXISTS VarietyTaskTemplates (
                  variety_id    INTEGER NOT NULL,
                  method_id     TEXT    NOT NULL,
                  template_json TEXT    NOT NULL,
                  updated_at    TEXT    NOT NULL,
                  PRIMARY KEY (variety_id, method_id)
                );`;
            await execAll(plantTemplateSql, []); // FIX: dbBridge.exec prepares one SQL statement per call
            await execAll(varietyTemplateSql, []); // FIX: keep table creation single-statement for better-sqlite3
        }

        static _safeParseTemplateRow(row) {
            if (!row) return null;
            try {
                const tpl = JSON.parse(row.template_json);
                return tpl && typeof tpl === 'object' ? tpl : null;
            } catch (_) {
                return null;
            }
        }

        static async loadPlantTemplate(plantId, methodId) {
            await this.ensureTables();
            const normalizedMethodId = normId(methodId);
            const sql = `
                SELECT template_json
                FROM PlantTaskTemplates
                WHERE plant_id = ? AND LOWER(TRIM(method_id)) = ?
                ORDER BY CASE
                           WHEN TRIM(method_id) = LOWER(TRIM(method_id)) THEN 0
                           ELSE 1
                         END,
                         method_id
                LIMIT 1;`;
            const rows = await queryAll(sql, [Number(plantId), normalizedMethodId]);
            return this._safeParseTemplateRow(rows[0] || null);
        }

        static async loadVarietyTemplate(varietyId, methodId) {
            await this.ensureTables();
            const vid = Number(varietyId);
            const normalizedMethodId = normId(methodId);
            if (!Number.isFinite(vid) || !normalizedMethodId) return null;
            const sql = `
                SELECT template_json
                FROM VarietyTaskTemplates
                WHERE variety_id = ? AND LOWER(TRIM(method_id)) = ?
                ORDER BY CASE
                           WHEN TRIM(method_id) = LOWER(TRIM(method_id)) THEN 0
                           ELSE 1
                         END,
                         method_id
                LIMIT 1;`;
            const rows = await queryAll(sql, [vid, normalizedMethodId]);
            return this._safeParseTemplateRow(rows[0] || null);
        }

        static async loadMethodBuiltinTemplate(methodId) {
            return getDefaultTaskTemplateForPlantingMethods(methodId);
        }

        static async savePlantTemplate(plantId, methodId, template) {
            await this.ensureTables();
            const normalizedMethodId = normId(methodId);
            if (!normalizedMethodId) throw new Error('methodId is required.');
            const json = JSON.stringify(template ?? {});
            const now = new Date().toISOString();
            await withDbTransaction(async dbId => { // FIX: replace case-only task-template duplicates atomically
                await execRunOnDb(dbId, `
                    DELETE FROM PlantTaskTemplates
                    WHERE plant_id = ? AND LOWER(TRIM(method_id)) = ?;`,
                [Number(plantId), normalizedMethodId]);
                await execRunOnDb(dbId, `
                    INSERT INTO PlantTaskTemplates (plant_id, method_id, template_json, updated_at)
                    VALUES (?, ?, ?, ?);`,
                [Number(plantId), normalizedMethodId, json, now]);
            });
        }

        static async saveForSelection({ plantId, methodId, template }) {
            return this.savePlantTemplate(plantId, methodId, template);
        }

        static async deletePlantTemplate(plantId, methodId) {
            await this.ensureTables();
            const sql = `
              DELETE FROM PlantTaskTemplates
              WHERE plant_id = ? AND LOWER(TRIM(method_id)) = ?;`;
            await execAll(sql, [Number(plantId), normId(methodId)]);
        }

        static async deleteForSelection({ plantId, methodId }) {
            return this.deletePlantTemplate(plantId, methodId);
        }
    }

























    // =====================================================================
    // PlantVarietyModel (JSON overrides)                                    
    // =====================================================================
    const VARIETY_MATURITY_CLASS_LABELS = Object.freeze({
        early: 'Early varieties',
        mid: 'Mid varieties',
        late: 'Late varieties',
        uncategorized: 'Uncategorized'
    });
    const VARIETY_MATURITY_CLASS_ORDER = Object.freeze(['early', 'mid', 'late', 'uncategorized']);

    function normalizeVarietyMaturityClass(value) {
        const key = String(value || '').trim().toLowerCase();
        return key === 'early' || key === 'mid' || key === 'late' ? key : '';
    }

    function varietyOverridesObject(row) {
        if (!row) return {};
        if (row.overrides && typeof row.overrides === 'object' && !Array.isArray(row.overrides)) return row.overrides;
        return PlantVarietyModel._parseOverrides(row.overrides_json);
    }

    function varietyPositiveOverride(row, key) {
        const n = finiteNumberOrNull(varietyOverridesObject(row)[key]);
        return n != null && n > 0 ? n : null;
    }

    function varietyMaturitySortName(row) {
        return String(row && (row.variety_name || row.variety_id) || '').trim().toLocaleLowerCase();
    }

    function maturityClassForRank(index, total) {
        if (!Number.isFinite(total) || total < 3) return '';
        return ['early', 'mid', 'late'][Math.min(2, Math.floor((Math.max(0, index) * 3) / total))] || '';
    }

    function sortMaturityRows(rows, metricKey) {
        return Array.from(rows).sort((a, b) => {
            const av = varietyPositiveOverride(a, metricKey) ?? Number.POSITIVE_INFINITY;
            const bv = varietyPositiveOverride(b, metricKey) ?? Number.POSITIVE_INFINITY;
            if (av !== bv) return av - bv;
            return varietyMaturitySortName(a).localeCompare(varietyMaturitySortName(b));
        });
    }

    function makeVarietyRowKey(row) {
        const id = row && row.variety_id != null ? String(row.variety_id) : '';
        return id || `name:${String(row && row.variety_name || '').trim().toLocaleLowerCase()}`;
    }

    function inferVarietyMaturityClasses(varieties) {
        const inferred = new Map();
        const rows = Array.isArray(varieties) ? varieties : [];
        const dtmRows = sortMaturityRows(rows.filter(row => varietyPositiveOverride(row, 'days_maturity') != null), 'days_maturity');
        if (dtmRows.length >= 3) {
            dtmRows.forEach((row, index) => inferred.set(makeVarietyRowKey(row), { className: maturityClassForRank(index, dtmRows.length), source: 'days_maturity' }));
        }
        const gddRows = sortMaturityRows(rows.filter(row => varietyPositiveOverride(row, 'gdd_to_maturity') != null), 'gdd_to_maturity');
        if (gddRows.length >= 3) {
            gddRows.forEach((row, index) => {
                if (varietyPositiveOverride(row, 'days_maturity') != null) return;
                inferred.set(makeVarietyRowKey(row), { className: maturityClassForRank(index, gddRows.length), source: 'gdd_to_maturity' });
            });
        }
        return inferred;
    }

    function formatVarietyMaturitySuffix(row) {
        const dtm = varietyPositiveOverride(row, 'days_maturity');
        if (dtm != null) return `${Math.round(dtm)}d`;
        const gdd = varietyPositiveOverride(row, 'gdd_to_maturity');
        if (gdd != null) return `${Math.round(gdd)} GDD`;
        return '';
    }

    function formatVarietyOptionLabel(row) {
        const name = String(row && (row.variety_name || row.variety_id) || '').trim();
        const suffix = formatVarietyMaturitySuffix(row);
        return suffix ? `${name} - ${suffix}` : name;
    }

    function compareVarietyGroupOptions(a, b) {
        const ad = varietyPositiveOverride(a.row, 'days_maturity');
        const bd = varietyPositiveOverride(b.row, 'days_maturity');
        if (ad != null || bd != null) {
            if (ad == null) return 1;
            if (bd == null) return -1;
            if (ad !== bd) return ad - bd;
        }
        const ag = varietyPositiveOverride(a.row, 'gdd_to_maturity');
        const bg = varietyPositiveOverride(b.row, 'gdd_to_maturity');
        if (ag != null || bg != null) {
            if (ag == null) return 1;
            if (bg == null) return -1;
            if (ag !== bg) return ag - bg;
        }
        return String(a.label || '').localeCompare(String(b.label || ''));
    }

    function buildGroupedVarietyOptions(varieties) {
        const inferred = inferVarietyMaturityClasses(varieties);
        const byClass = new Map(VARIETY_MATURITY_CLASS_ORDER.map(key => [key, []]));
        for (const row of Array.isArray(varieties) ? varieties : []) {
            const manual = normalizeVarietyMaturityClass(row && row.maturity_class);
            const inferredClass = inferred.get(makeVarietyRowKey(row))?.className || '';
            const className = manual || inferredClass || 'uncategorized';
            byClass.get(className).push({
                value: String(row.variety_id),
                label: formatVarietyOptionLabel(row),
                row,
                manualClass: manual,
                inferredClass
            });
        }
        return VARIETY_MATURITY_CLASS_ORDER
            .map(key => ({ key, label: VARIETY_MATURITY_CLASS_LABELS[key], options: byClass.get(key).sort(compareVarietyGroupOptions) }))
            .filter(group => group.options.length > 0);
    }

    function buildVarietyPickerGroups(varieties, { includeBase = true, includeNew = false, newValue = '__NEW__' } = {}) {
        const groups = [];
        const selectionOptions = [];
        if (includeBase) selectionOptions.push({ value: '', label: '(base plant)', displayLabel: '(base plant)' });
        if (includeNew) selectionOptions.push({ value: newValue, label: 'New variety...', displayLabel: 'New variety...' });
        if (selectionOptions.length) groups.push({ key: 'selection', label: 'Selection', options: selectionOptions });
        return groups.concat(buildGroupedVarietyOptions(varieties));
    }

    function renderGroupedVarietyOptions(selectEl, groups, selectedValue = '') {
        const pickerGroups = buildVarietyPickerGroups([], { includeBase: true, includeNew: false })
            .concat(groups || []);
        renderGroupedSelectOptions(selectEl, pickerGroups, selectedValue, { emptyLabel: 'No varieties match' });
        const valid = new Set(Array.from(selectEl.options).map(option => option.value));
        selectEl.value = valid.has(String(selectedValue || '')) ? String(selectedValue || '') : '';
    }

    function manualVarietyMaturityMismatch(varieties, varietyRow) {
        const manual = normalizeVarietyMaturityClass(varietyRow && varietyRow.maturity_class);
        if (!manual) return null;
        const inferred = inferVarietyMaturityClasses(varieties).get(makeVarietyRowKey(varietyRow));
        if (!inferred || !inferred.className || inferred.className === manual) return null;
        return { manualClass: manual, inferredClass: inferred.className, source: inferred.source };
    }

    class PlantVarietyModel {
        constructor(row) {
            Object.assign(this, row);
            this.variety_id = Number(this.variety_id);
            this.plant_id = Number(this.plant_id);
            this.maturity_class = normalizeVarietyMaturityClass(this.maturity_class);
        }

        static async ensureTable() {
            const sql = `
                    CREATE TABLE IF NOT EXISTS PlantVarieties (
                        variety_id     INTEGER PRIMARY KEY AUTOINCREMENT,
                        plant_id       INTEGER NOT NULL,
                        variety_name   TEXT NOT NULL,
                        maturity_class TEXT,
                        overrides_json TEXT NOT NULL,
                        created_at     TEXT NOT NULL,
                        updated_at     TEXT NOT NULL
                    );`;
            await execAll(sql, []);

            const columns = new Set((await queryAll(`PRAGMA table_info(PlantVarieties);`, [])).map(row => String(row.name || '').toLowerCase()));
            if (!columns.has('maturity_class')) await execAll(`ALTER TABLE PlantVarieties ADD COLUMN maturity_class TEXT;`, []);

            await execAll(
                `CREATE INDEX IF NOT EXISTS idx_PlantVarieties_plant_id
                     ON PlantVarieties (plant_id);`,
                []
            );

            await execAll(
                `CREATE UNIQUE INDEX IF NOT EXISTS idx_PlantVarieties_unique
                     ON PlantVarieties (plant_id, variety_name);`,
                []
            );
        }

        static _parseOverrides(jsonStr) {
            if (jsonStr == null || jsonStr === '') return {};
            try {
                const o = JSON.parse(jsonStr);
                return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
            } catch (e) {
                console.warn('Bad overrides_json in PlantVarieties', e);
                return {};
            }
        }

        overridesObject() {
            return PlantVarietyModel._parseOverrides(this.overrides_json);
        }

        static async listByPlantId(plantId) {
            await this.ensureTable();
            const pid = Number(plantId);
            if (!Number.isFinite(pid)) return [];

            const sql = `
                    SELECT variety_id, plant_id, variety_name, maturity_class, overrides_json, created_at, updated_at
                    FROM PlantVarieties
                    WHERE plant_id = ?
                    ORDER BY variety_name COLLATE NOCASE;`;
            const rows = await queryAll(sql, [pid]);
            return rows.map(r => new PlantVarietyModel(r));
        }

        static async loadById(varietyId) {
            await this.ensureTable();
            const vid = Number(varietyId);
            if (!Number.isFinite(vid)) return null;

            const sql = `
                    SELECT variety_id, plant_id, variety_name, maturity_class, overrides_json, created_at, updated_at
                    FROM PlantVarieties
                    WHERE variety_id = ?
                    LIMIT 1;`;
            const rows = await queryAll(sql, [vid]);
            return rows[0] ? new PlantVarietyModel(rows[0]) : null;
        }

        static async create({ plantId, varietyName, maturityClass, overrides }) {
            await this.ensureTable();
            const pid = Number(plantId);
            if (!Number.isFinite(pid)) throw new Error('create: invalid plantId');

            const name = String(varietyName ?? '').trim();
            if (!name) throw new Error('create: varietyName is required');

            const obj = (overrides && typeof overrides === 'object') ? overrides : {};
            const json = JSON.stringify(obj);
            const normalizedMaturityClass = normalizeVarietyMaturityClass(maturityClass) || null;
            const now = new Date().toISOString();

            const sql = `
                    INSERT INTO PlantVarieties (plant_id, variety_name, maturity_class, overrides_json, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?);`;
            await execAll(sql, [pid, name, normalizedMaturityClass, json, now, now]);

            // Return the created row (SQLite last_insert_rowid not exposed here)        
            const rows = await queryAll(
                `SELECT variety_id, plant_id, variety_name, maturity_class, overrides_json, created_at, updated_at
                     FROM PlantVarieties
                     WHERE plant_id = ? AND variety_name = ?
                     LIMIT 1;`,
                [pid, name]
            );
            return rows[0] ? new PlantVarietyModel(rows[0]) : null;
        }

        static async update(payload) {
            await this.ensureTable();
            const { varietyId, varietyName, overrides } = payload || {};
            const vid = Number(varietyId);
            if (!Number.isFinite(vid)) throw new Error('update: invalid varietyId');

            const name = (varietyName == null) ? null : String(varietyName).trim();
            const json = (overrides == null) ? null : JSON.stringify(
                (overrides && typeof overrides === 'object') ? overrides : {}
            );
            const now = new Date().toISOString();

            // Build dynamic update: only set provided fields                            
            const sets = [];
            const params = [];
            if (name != null) { sets.push('variety_name = ?'); params.push(name); }
            if (Object.prototype.hasOwnProperty.call(payload || {}, 'maturityClass')) { sets.push('maturity_class = ?'); params.push(normalizeVarietyMaturityClass(payload.maturityClass) || null); }
            if (json != null) { sets.push('overrides_json = ?'); params.push(json); }
            sets.push('updated_at = ?'); params.push(now);
            params.push(vid);

            const sql = `
                    UPDATE PlantVarieties
                    SET ${sets.join(', ')}
                    WHERE variety_id = ?;`;
            await execAll(sql, params);

            return await this.loadById(vid);
        }

        static async deleteById(varietyId) {
            await this.ensureTable();
            const vid = Number(varietyId);
            if (!Number.isFinite(vid)) return;
            const sql = `DELETE FROM PlantVarieties WHERE variety_id = ?;`;
            await execAll(sql, [vid]);
        }
    }

    class PlantGrowthStageModel {
        constructor(row) {
            Object.assign(this, normalizeGrowthStage(row));
            this.stage_id = finiteNumberOrNull(row?.stage_id);
            this.plant_id = finiteNumberOrNull(row?.plant_id);
            this.stage_key = this.stageKey;
            this.stage_label = this.stageLabel;
            this.gdd_ratio = this.gddRatio;
            this.spacing_ratio = row?.spacing_ratio == null || row?.spacing_ratio === '' ? null : this.spacingRatio;
            this.plant_diameter_ratio = row?.plant_diameter_ratio == null || row?.plant_diameter_ratio === '' ? null : this.plantDiameterRatio;
            this.plant_height_ratio = row?.plant_height_ratio == null || row?.plant_height_ratio === '' ? null : this.plantHeightRatio;
            this.sort_order = this.sortOrder;
            this.active = this.active;
            this.is_default = this.isDefault;
            this.created_at = row?.created_at || '';
            this.updated_at = row?.updated_at || '';
        }

        static async ensureTable() {
            await ensureSchedulerPhysiologySchema();
        }

        static async listByPlantId(plantId, { includeInactive = false } = {}) {
            await this.ensureTable();
            const pid = Number(plantId);
            if (!Number.isFinite(pid)) return [];
            const whereActive = includeInactive ? '' : 'AND active <> 0';
            const rows = await queryAll(`
                SELECT stage_id, plant_id, stage_key, stage_label, gdd_ratio, spacing_ratio,
                       plant_diameter_ratio, plant_height_ratio, sort_order, active, is_default,
                       created_at, updated_at
                FROM PlantGrowthStages
                WHERE plant_id = ? ${whereActive}
                ORDER BY is_default DESC, sort_order ASC, stage_label COLLATE NOCASE;`, [pid]);
            return rows.map(row => new PlantGrowthStageModel(row));
        }

        static async saveForPlant(plantId, stages) {
            await this.ensureTable();
            const pid = Number(plantId);
            if (!Number.isFinite(pid)) throw new Error('Invalid plantId for growth stages.');
            const normalized = (Array.isArray(stages) ? stages : [])
                .map(row => {
                    const source = row || {};
                    return {
                        stage: normalizeGrowthStage(Object.assign({}, source, { plant_id: pid })),
                        spacingRatioOverride: clampGrowthRatio(source.spacing_ratio ?? source.spacingRatio, MIN_GROWTH_STAGE_LAYOUT_RATIO, MAX_GROWTH_STAGE_LAYOUT_RATIO),
                        diameterRatioOverride: clampGrowthRatio(source.plant_diameter_ratio ?? source.plantDiameterRatio, MIN_GROWTH_STAGE_LAYOUT_RATIO, MAX_GROWTH_STAGE_LAYOUT_RATIO),
                        heightRatioOverride: clampGrowthRatio(source.plant_height_ratio ?? source.plantHeightRatio, MIN_GROWTH_STAGE_LAYOUT_RATIO, MAX_GROWTH_STAGE_LAYOUT_RATIO)
                    };
                })
                .filter(entry => entry.stage.stageKey);
            const seen = new Set();
            const unique = [];
            normalized.forEach(entry => {
                const stage = entry.stage;
                if (seen.has(stage.stageKey)) return;
                seen.add(stage.stageKey);
                unique.push(entry);
            });
            await withDbTransaction(async dbId => {
                await execRunOnDb(dbId, 'DELETE FROM PlantGrowthStages WHERE plant_id = ?;', [pid]);
                const now = new Date().toISOString();
                for (let index = 0; index < unique.length; index += 1) {
                    const entry = unique[index];
                    const stage = entry.stage;
                    await execRunOnDb(dbId, `INSERT INTO PlantGrowthStages (
                        plant_id, stage_key, stage_label, gdd_ratio, spacing_ratio,
                        plant_diameter_ratio, plant_height_ratio, sort_order, active, is_default,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`, [
                        pid,
                        stage.stageKey,
                        stage.stageLabel,
                        stage.gddRatio,
                        entry.spacingRatioOverride,
                        entry.diameterRatioOverride,
                        entry.heightRatioOverride,
                        Number.isFinite(Number(stage.sortOrder)) ? Number(stage.sortOrder) : index,
                        stage.active,
                        stage.isDefault,
                        now,
                        now
                    ]);
                }
            });
            return this.listByPlantId(pid, { includeInactive: true });
        }
    }

    // =====================================================================
    // helper to apply overrides to a base plant row          
    // =====================================================================
    function applyPlantOverrides(basePlantRow, overridesObj) {
        const out = Object.assign({}, basePlantRow || {});
        const o = (overridesObj && typeof overridesObj === 'object') ? overridesObj : {};
        Object.keys(o).forEach(k => { out[k] = o[k]; });
        return out;
    }

    async function resolveEffectivePlant(plantId, varietyId = null) {
        const pid = Number(plantId);
        if (!Number.isFinite(pid)) return null;
    
        const basePlant = await PlantModel.loadById(pid);
        if (!basePlant) return null;
    
        const vid = Number(varietyId);
        if (!Number.isFinite(vid)) {
            return basePlant;
        }
    
        const variety = await PlantVarietyModel.loadById(vid);
        if (!variety) {
            return basePlant;
        }
    
        // Safety: ensure the variety belongs to the requested plant
        if (Number(variety.plant_id) !== pid) {
            console.warn("[resolveEffectivePlant] variety does not belong to plant", {
                plantId: pid,
                varietyId: vid,
                varietyPlantId: variety.plant_id
            });
            return basePlant;
        }
    
        const overrides = variety.overridesObject();
        const mergedRow = applyPlantOverrides(toPlainDict(basePlant), overrides);
    
        // Preserve canonical ids/names
        mergedRow.plant_id = basePlant.plant_id;
        mergedRow.plant_name = basePlant.plant_name;
        mergedRow.abbr = basePlant.abbr;
    
        return new PlantModel(mergedRow);
    }

    async function resolveVarietyName(varietyId, currentVarieties = null) {
        const vid = Number(varietyId);
        if (!Number.isFinite(vid)) return '';
    
        if (Array.isArray(currentVarieties)) {
            const found = currentVarieties.find(v => Number(v?.variety_id) === vid);
            if (found) {
                return String(found.variety_name || '').trim();
            }
        }
    
        const row = await PlantVarietyModel.loadById(vid);
        return row ? String(row.variety_name || '').trim() : '';
    }

    class CityClimate {
        constructor(row) {
            Object.assign(this, row);
        }

        static async loadAll() {
            await ensureSchedulerPhysiologySchema();
            const sql = `SELECT * FROM Cities ORDER BY city_name;`;
            const rows = await queryAll(sql, []);
            return rows.map(r => new CityClimate(r));
        }

        static async loadByName(name) {
            await ensureSchedulerPhysiologySchema();
            const sql = `SELECT * FROM Cities WHERE city_name = ? LIMIT 1;`;
            const rows = await queryAll(sql, [name]);
            return rows[0] ? new CityClimate(rows[0]) : null;
        }

        static async loadUniqueByName(name) {
            await ensureSchedulerPhysiologySchema();
            const trimmed = String(name || '').trim();
            if (!trimmed) return null;
            const rows = await queryAll(`SELECT * FROM Cities WHERE city_name = ? LIMIT 2;`, [trimmed]);
            return rows.length === 1 ? new CityClimate(rows[0]) : null;
        }

        static async loadById(cityId) {
            await ensureSchedulerPhysiologySchema();
            const id = Number(cityId);
            if (!Number.isFinite(id)) return null;
            const rows = await queryAll(`SELECT * FROM Cities WHERE city_id = ? LIMIT 1;`, [id]);
            return rows[0] ? new CityClimate(rows[0]) : null;
        }

        static async resolve({ cityId = null, cityName = '' } = {}) {
            return (await CityClimate.loadById(cityId)) || (cityName ? await CityClimate.loadByName(cityName) : null);
        }

        static async resolveUniqueNameFallback({ cityId = null, cityName = '' } = {}) {
            return (await CityClimate.loadById(cityId)) || (cityName ? await CityClimate.loadUniqueByName(cityName) : null);
        }

        static async updateLatitude(cityName, latitudeDeg) {
            await ensureSchedulerPhysiologySchema();
            const name = String(cityName || '').trim();
            if (!name) throw new Error('Select a city before saving latitude.');
            const normalized = normalizeLatitudeDeg(latitudeDeg);
            await withDbWrite(async dbId => {
                await execRunOnDb(dbId, 'UPDATE Cities SET latitude = ? WHERE city_name = ?;', [normalized, name]);
                const rows = await queryAllOnDb(dbId, 'SELECT changes() AS changes;', []);
                if (!Number(rows?.[0]?.changes)) throw new Error(`City not found: ${name}`);
            });
            return normalized;
        }

        monthlyHighs() {
            const out = {};
            for (let m = 1; m <= 12; m++) out[m] = this[`avg_monthly_high_c${m}`];
            return out;
        }

        monthlyLows() {
            const out = {};
            for (let m = 1; m <= 12; m++) out[m] = this[`avg_monthly_low_c${m}`];
            return out;
        }

        monthlyMeans() {
            const highs = this.monthlyHighs(), lows = this.monthlyLows();
            const out = {};
            for (let m = 1; m <= 12; m++) {
                const hi = highs[m], lo = lows[m];
                if (hi == null || lo == null) continue;
                out[m] = (Number(hi) + Number(lo)) / 2;
            }
            return out;
        }

        gddCalibration(year) {
            return solveGddTemperatureOffset({
                monthlyAvgTemp: this.monthlyMeans(),
                targetGdd: this.gdd_annual,
                gddBaseC: this.gdd_base_c,
                year
            }); // ADDED: align monthly heat curve with city annual GDD metadata when possible.
        }

        calibratedMonthlyMeans(year) {
            const raw = this.monthlyMeans();
            const calibration = this.gddCalibration(year);
            return applyTemperatureOffsetToMonthlyMeans(raw, calibration.usable ? calibration.offsetC : 0);
        }

        dailyRates(tbase, year, climatePolicy = null) {
            const means = climatePolicy?.gddCalibrationEnabled === false ? this.monthlyMeans() : this.calibratedMonthlyMeans(year); // CHANGED: allow climate policy to disable city GDD calibration.
            const gddMonthly = {};
            for (let m = 1; m <= 12; m++) {
                const Tm = means?.[m];
                const dim = daysInMonth(year, m);
                gddMonthly[m] = (Tm == null) ? 0 : Math.max(0, Tm - tbase) * dim;
            }
            const daily = {};
            for (let m = 1; m <= 12; m++) {
                const dim = daysInMonth(year, m);
                daily[m] = dim > 0 ? (gddMonthly[m] / dim) : 0;
            }
            return daily;
        }

        async loadDailyClimateModel({ scanStart, scanEndHard, todayISO = null, climatePolicy = null } = {}) {
            const start = scanStart || asUTCDate(new Date().getUTCFullYear(), 1, 1);
            const end = scanEndHard || asUTCDate(start.getUTCFullYear(), 12, 31);
            const fallbackNormals = sharedCore.monthlyTemperatureNormalsFromCity(this);
            let monthlyNormals = fallbackNormals;
            let source = 'city monthly normals';
            const cityId = Number(this.city_id);
            let forecastRows = [];
            const normalizedPolicy = normalizeClimateModelPatch(climatePolicy || {});
            const normalsSource = normalizedPolicy.weatherNormalsSource || DEFAULT_CLIMATE_MODEL_POLICY.weatherNormalsSource;

            if (Number.isFinite(cityId)) {
                try {
                    const monthlyRows = normalsSource === 'city_weather_daily' || normalsSource === 'city_monthly_columns' ? [] : await queryAll(`
                        SELECT CAST(substr(weather_month, 6, 2) AS INTEGER) AS month,
                               AVG(temp_min_c) AS min,
                               AVG(temp_max_c) AS max,
                               AVG(temp_mean_c) AS mean
                        FROM CityWeatherMonthly
                        WHERE city_id = ?
                        GROUP BY CAST(substr(weather_month, 6, 2) AS INTEGER)
                        ORDER BY month;
                    `, [cityId]);
                    const monthlyFromWeather = {};
                    (monthlyRows || []).forEach(function (row) {
                        const month = Number(row.month);
                        if (month >= 1 && month <= 12) monthlyFromWeather[month] = row;
                    });
                    if (Object.keys(monthlyFromWeather).length) {
                        monthlyNormals = monthlyFromWeather;
                        source = 'CityWeatherMonthly normals';
                    } else if (normalsSource !== 'city_weather_monthly' && normalsSource !== 'city_monthly_columns') {
                        const dailyRows = await queryAll(`
                            SELECT CAST(substr(weather_date, 6, 2) AS INTEGER) AS month,
                                   AVG(temp_min_c) AS min,
                                   AVG(temp_max_c) AS max,
                                   AVG(temp_mean_c) AS mean
                            FROM CityWeatherDaily
                            WHERE city_id = ?
                            GROUP BY CAST(substr(weather_date, 6, 2) AS INTEGER)
                            ORDER BY month;
                        `, [cityId]);
                        const monthlyFromDaily = {};
                        (dailyRows || []).forEach(function (row) {
                            const month = Number(row.month);
                            if (month >= 1 && month <= 12) monthlyFromDaily[month] = row;
                        });
                        if (Object.keys(monthlyFromDaily).length) {
                            monthlyNormals = monthlyFromDaily;
                            source = 'CityWeatherDaily monthly normals';
                        }
                    }
                } catch (e) {
                    console.warn('[Scheduler] Weather normals unavailable; using city monthly normals', e?.message || String(e));
                }

                try {
                    forecastRows = await queryAll(`
                        SELECT forecast_date, temp_min_c, temp_max_c, temp_mean_c, run_timestamp
                        FROM CityWeatherForecastDaily
                        WHERE city_id = ?
                          AND forecast_date BETWEEN ? AND ?
                        ORDER BY forecast_date, run_timestamp;
                    `, [cityId, fmtISO(start), fmtISO(end)]);
                } catch (e) {
                    console.warn('[Scheduler] Forecast weather unavailable; using normals only', e?.message || String(e));
                    forecastRows = [];
                }
            }

            return sharedCore.buildDailyTemperatureSeries({
                startDate: start,
                endDate: end,
                monthlyNormals,
                forecastRows,
                todayISO,
                source,
                forecastBlendWeights: normalizedPolicy
            });
        }
    }

    async function saveSchedulerCityLatitude({ cityName, latitudeValue, cities, recomputeAll, updateTaskPreview }) {
        const normalized = normalizeLatitudeDeg(latitudeValue);
        await CityClimate.updateLatitude(cityName, normalized);
        const cachedCity = (cities || []).find(city => String(city.city_name || '') === String(cityName || ''));
        if (cachedCity) cachedCity.latitude = normalized;
        if (typeof recomputeAll === 'function') await recomputeAll('cityChanged');
        if (typeof updateTaskPreview === 'function') await updateTaskPreview();
        return normalized;
    }

    const CLIMATE_MODEL_DEFAULTS_ATTR = 'scheduler_climate_model_defaults_json';
    const CLIMATE_MODEL_PLANT_OVERRIDES_ATTR = 'scheduler_climate_model_plant_overrides_json';
    const DEFAULT_CLIMATE_MODEL_POLICY = Object.freeze({
        springFrostRisk: 'p50',
        weatherNormalsSource: 'auto',
        forecastBlendWeight0To3Days: 0.8,
        forecastBlendWeight4To7Days: 0.5,
        forecastBlendWeight8To16Days: 0.25,
        soilGateConsecutiveDays: 3,
        gddCalibrationEnabled: true,
        annualCrossYearHarvestAllowed: true
    });
    const CLIMATE_MODEL_PARAMETER_SCHEMA = Object.freeze([
        Object.freeze({ key: 'springFrostRisk', label: 'Spring frost risk', type: 'enum', options: [['p10', 'p10'], ['p50', 'p50'], ['p90', 'p90']] }),
        Object.freeze({ key: 'weatherNormalsSource', label: 'Weather normals source', type: 'enum', options: [['auto', 'Auto'], ['city_weather_monthly', 'Monthly weather'], ['city_weather_daily', 'Daily weather'], ['city_monthly_columns', 'City monthly columns']] }),
        Object.freeze({ key: 'forecastBlendWeight0To3Days', label: 'Forecast blend 0-3 days', type: 'number', min: 0, max: 1, step: 0.01 }),
        Object.freeze({ key: 'forecastBlendWeight4To7Days', label: 'Forecast blend 4-7 days', type: 'number', min: 0, max: 1, step: 0.01 }),
        Object.freeze({ key: 'forecastBlendWeight8To16Days', label: 'Forecast blend 8-16 days', type: 'number', min: 0, max: 1, step: 0.01 }),
        Object.freeze({ key: 'soilGateConsecutiveDays', label: 'Soil-ready days', type: 'integer', min: 1, max: 14, step: 1 }),
        Object.freeze({ key: 'gddCalibrationEnabled', label: 'GDD calibration', type: 'boolean' })
    ]);

    function normalizeClimateModelPatch(raw) {
        const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
        const out = {};
        if (['p10', 'p50', 'p90'].indexOf(String(source.springFrostRisk || '')) >= 0) out.springFrostRisk = String(source.springFrostRisk);
        if (['auto', 'city_weather_monthly', 'city_weather_daily', 'city_monthly_columns'].indexOf(String(source.weatherNormalsSource || '')) >= 0) out.weatherNormalsSource = String(source.weatherNormalsSource);
        ['forecastBlendWeight0To3Days', 'forecastBlendWeight4To7Days', 'forecastBlendWeight8To16Days'].forEach(function (key) {
            const n = finiteNumberOrNull(source[key]);
            if (n != null) out[key] = Math.max(0, Math.min(1, n));
        });
        const soilDays = finiteNumberOrNull(source.soilGateConsecutiveDays);
        if (soilDays != null) out.soilGateConsecutiveDays = Math.max(1, Math.min(14, Math.round(soilDays)));
        if (source.gddCalibrationEnabled === true || source.gddCalibrationEnabled === false) out.gddCalibrationEnabled = !!source.gddCalibrationEnabled;
        if (source.annualCrossYearHarvestAllowed === true || source.annualCrossYearHarvestAllowed === false) out.annualCrossYearHarvestAllowed = !!source.annualCrossYearHarvestAllowed;
        return out;
    }

    function mergeClimateModelPolicy(gardenPatch, plantPatch) {
        return Object.assign({}, DEFAULT_CLIMATE_MODEL_POLICY, normalizeClimateModelPatch(gardenPatch), normalizeClimateModelPatch(plantPatch));
    }

    function readClimateModelJsonAttr(cell, attrName, fallback) {
        const raw = cell?.getAttribute?.(attrName);
        if (!raw) return fallback;
        const parsed = safeJsonParse(String(raw), fallback);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
    }

    function normalizeClimateCityKey(cityName) {
        return String(cityName || '').trim().toLowerCase();
    }

    function buildClimatePlantOverrideKey(cityName, plantId) {
        return `${normalizeClimateCityKey(cityName)}::${Number(plantId)}`;
    }

    function readClimateModelGardenPatch(moduleCell) {
        return normalizeClimateModelPatch(readClimateModelJsonAttr(moduleCell, CLIMATE_MODEL_DEFAULTS_ATTR, {}));
    }

    function readClimateModelPlantOverrideMap(moduleCell) {
        return readClimateModelJsonAttr(moduleCell, CLIMATE_MODEL_PLANT_OVERRIDES_ATTR, {});
    }

    function readClimateModelPlantPatch(moduleCell, cityName, plantId) {
        const map = readClimateModelPlantOverrideMap(moduleCell);
        return normalizeClimateModelPatch(map[buildClimatePlantOverrideKey(cityName, plantId)] || {});
    }

    function resolveClimateModelPolicy(moduleCell, cityName, plantId, draftPlantPatch = null) {
        const gardenPatch = readClimateModelGardenPatch(moduleCell);
        const savedPlantPatch = readClimateModelPlantPatch(moduleCell, cityName, plantId);
        const plantPatch = draftPlantPatch == null ? savedPlantPatch : normalizeClimateModelPatch(draftPlantPatch);
        const effective = mergeClimateModelPolicy(gardenPatch, plantPatch);
        const sources = {};
        CLIMATE_MODEL_PARAMETER_SCHEMA.forEach(function (def) {
            if (Object.prototype.hasOwnProperty.call(plantPatch, def.key)) sources[def.key] = 'Plant override';
            else if (Object.prototype.hasOwnProperty.call(gardenPatch, def.key)) sources[def.key] = 'Garden default';
            else sources[def.key] = 'Built-in default';
        });
        return { effective, sources, gardenPatch, plantPatch, overrideKey: buildClimatePlantOverrideKey(cityName, plantId) };
    }

    function stringifyClimateModelAttr(value) {
        const normalized = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        return Object.keys(normalized).length ? JSON.stringify(normalized) : null;
    }

    function setTooltip(el, text) {
        if (!el) return;
        el.title = String(text || '');
    }

    function formatClimateModelDoyDate(doy, year) {
        const n = finiteNumberOrNull(doy);
        const y = Math.trunc(Number(year));
        if (n == null || !Number.isFinite(y)) return '';
        return dateFromDOY(y, n).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    }

    function resolveFrostRiskTip(city, risk, year) {
        const resolution = sharedCore.resolveSpringFrostByRisk(city, risk); // CHANGED: report the same frost source used by schedule validation.
        const selectedRisk = resolution.risk || 'p50';
        if (resolution.source === 'stored' && resolution.field !== 'last_spring_frost_doy') {
            return {
                text: `${formatClimateModelDoyDate(resolution.doy, year)} (${selectedRisk})`,
                tooltip: `Selected ${selectedRisk} frost date is DOY ${Math.round(resolution.doy)} for ${city?.city_name || 'the selected city'}.`
            };
        }
        if (resolution.source === 'stored') {
            return {
                text: `No ${selectedRisk}; using ${formatClimateModelDoyDate(resolution.doy, year)}`,
                tooltip: `No ${selectedRisk} frost date is stored for ${city?.city_name || 'the selected city'}; using ${resolution.field || 'a stored frost field'} value ${Math.round(resolution.doy)}.`
            };
        }
        if (resolution.source === 'inferred_monthly_normals') {
            const crossingText = resolution.crossingDoy ? ` after the monthly-low 0 C crossing near DOY ${Math.round(resolution.crossingDoy)}` : '';
            return {
                text: `Inferred ${formatClimateModelDoyDate(resolution.doy, year)} (${selectedRisk})`,
                tooltip: `No stored ${selectedRisk} or plain spring frost date exists for ${city?.city_name || 'the selected city'}; inferred from monthly low normals${crossingText}, plus ${resolution.bufferDays || 0} safety days.`
            };
        }
        return {
            text: `No ${selectedRisk}; using ${formatClimateModelDoyDate(resolution.doy, year)}`,
            tooltip: `No stored or monthly-normal spring frost date could be resolved for ${city?.city_name || 'the selected city'}; using scheduler fallback DOY ${Math.round(resolution.doy)}.`
        };
    }

    function countMonthlyNormals(monthlyNormals) {
        return Object.keys(sharedCore.normalizeMonthlyTemperatureNormals(monthlyNormals) || {}).length;
    }

    async function countCityWeatherMonthlyRows(cityId) {
        if (!Number.isFinite(Number(cityId))) return 0;
        try {
            const rows = await queryAll(`
                SELECT COUNT(*) AS count
                FROM (
                    SELECT CAST(substr(weather_month, 6, 2) AS INTEGER) AS month
                    FROM CityWeatherMonthly
                    WHERE city_id = ?
                    GROUP BY CAST(substr(weather_month, 6, 2) AS INTEGER)
                ) AS months;`, [Number(cityId)]);
            return Number(rows?.[0]?.count || 0);
        } catch (_) {
            return 0;
        }
    }

    async function countCityWeatherDailyMonthlyRows(cityId) {
        if (!Number.isFinite(Number(cityId))) return 0;
        try {
            const rows = await queryAll(`
                SELECT COUNT(*) AS count
                FROM (
                    SELECT CAST(substr(weather_date, 6, 2) AS INTEGER) AS month
                    FROM CityWeatherDaily
                    WHERE city_id = ?
                    GROUP BY CAST(substr(weather_date, 6, 2) AS INTEGER)
                ) AS months;`, [Number(cityId)]);
            return Number(rows?.[0]?.count || 0);
        } catch (_) {
            return 0;
        }
    }

    async function resolveWeatherNormalsSourceStatus(city, requestedSource) {
        const source = normalizeClimateModelPatch({ weatherNormalsSource: requestedSource }).weatherNormalsSource || 'auto';
        const cityId = Number(city?.city_id);
        const monthlyCount = await countCityWeatherMonthlyRows(cityId);
        const dailyCount = await countCityWeatherDailyMonthlyRows(cityId);
        const cityColumnCount = countMonthlyNormals(sharedCore.monthlyTemperatureNormalsFromCity(city));
        let actual = 'city monthly columns';
        let text = '';
        if (source === 'auto') {
            if (monthlyCount > 0) actual = 'CityWeatherMonthly';
            else if (dailyCount > 0) actual = 'CityWeatherDaily';
            else actual = cityColumnCount > 0 ? 'city monthly columns' : 'no normals';
            text = actual === 'no normals' ? 'Auto: no normals found' : `Auto: using ${actual}`;
        } else if (source === 'city_weather_monthly') {
            actual = monthlyCount > 0 ? 'CityWeatherMonthly' : (cityColumnCount > 0 ? 'city monthly columns' : 'no normals');
            text = monthlyCount > 0 ? 'Monthly weather available' : `Monthly weather missing; using ${actual}`;
        } else if (source === 'city_weather_daily') {
            actual = dailyCount > 0 ? 'CityWeatherDaily' : (cityColumnCount > 0 ? 'city monthly columns' : 'no normals');
            text = dailyCount > 0 ? 'Daily weather available' : `Daily weather missing; using ${actual}`;
        } else {
            actual = cityColumnCount > 0 ? 'city monthly columns' : 'no normals';
            text = cityColumnCount > 0 ? 'City monthly columns available' : 'City monthly columns missing';
        }
        return {
            text,
            tooltip: `Requested source: ${source}. Monthly weather months: ${monthlyCount}; daily weather months: ${dailyCount}; city monthly column months: ${cityColumnCount}. Actual source: ${actual}.`
        };
    }

    function prettifyBedConditionValue(value) {
        const raw = String(value || 'unknown').trim() || 'unknown';
        return raw.replace(/_/g, ' ');
    }

    function formatGardenName(moduleCell) {
        return String(moduleCell?.getAttribute?.('garden_name') || moduleCell?.getAttribute?.('label') || 'Garden').trim() || 'Garden';
    }


    class PolicyFlags {
        constructor({
            // spring frost gate
            useSpringFrostGate = true,          // default ON for non-overwinter crops
            springFrostRisk = 'p50',            // 'p90' | 'p50' | 'p10'

            // Soil gate
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

            this.useSpringFrostGate = !!useSpringFrostGate; // FIX: overwinter capability does not make early field planting frost-safe
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
            const overwinterAllowed = isCrossYearCrop(plant); // FIX: biennials are cross-year crops
            const modelPolicy = mergeClimateModelPolicy(null, climatePolicy);

            return new PolicyFlags({
                useSpringFrostGate: true, // FIX: apply the field frost gate to perennials and overwinter-capable crops
                springFrostRisk: modelPolicy.springFrostRisk,
                useSoilTempGate: !!resolvedBehavior?.usesSoilTempGate && threshold != null,
                soilGateThresholdC: threshold,
                soilGateConsecutiveDays: modelPolicy.soilGateConsecutiveDays,
                overwinterAllowed,
                annualCrossYearHarvestAllowed: modelPolicy.annualCrossYearHarvestAllowed !== false,
                gddCalibrationEnabled: modelPolicy.gddCalibrationEnabled,
                weatherNormalsSource: modelPolicy.weatherNormalsSource,
                forecastBlendWeight0To3Days: modelPolicy.forecastBlendWeight0To3Days,
                forecastBlendWeight4To7Days: modelPolicy.forecastBlendWeight4To7Days,
                forecastBlendWeight8To16Days: modelPolicy.forecastBlendWeight8To16Days
            });
        }

    }

    // Cross-year capability is a lifecycle property, independent of frost-gate policy.
    function isCrossYearCrop(plant) { // FIX: centralize lifecycle scheduling rules
        if (!plant) return false;
        const perennial = typeof plant.isPerennial === 'function' && plant.isPerennial();
        const biennial = typeof plant.isBiennial === 'function' && plant.isBiennial();
        return perennial || biennial || Number(plant.overwinter_ok ?? 0) === 1; // FIX: centralize lifecycle policy
    }

    function getPlantScanYears(plant) { // FIX: centralize lifecycle-aware scan bounds
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

    function annualSchedulerScanEndYear(plant, year) {
        const lifecycleEndYear = Number(year) + getPlantScanYears(plant) - 1;
        return isPerennialPlant(plant) ? lifecycleEndYear : Math.max(lifecycleEndYear, Number(year) + 1);
    }

    const CROP_LIFECYCLE_FILTER_STORAGE_KEY = 'trellis.scheduler.cropLifecycleFilter';
    const CROP_LIFECYCLE_ORDER = Object.freeze(['annual', 'biennial', 'perennial', 'uncategorized']);
    const CROP_LIFECYCLE_LABELS = Object.freeze({
        annual: 'Annual crops',
        biennial: 'Biennial crops',
        perennial: 'Perennial crops',
        uncategorized: 'Uncategorized crops'
    });

    function getCropLifecycle(plant) {
        const flags = [
            ['annual', Number(plant?.annual) === 1],
            ['biennial', Number(plant?.biennial) === 1],
            ['perennial', Number(plant?.perennial) === 1]
        ].filter(([, enabled]) => enabled);
        return flags.length === 1 ? flags[0][0] : 'uncategorized';
    }

    function normalizeCropLifecycleFilter(value) {
        const normalized = String(value || '').trim().toLowerCase();
        return normalized === 'all' || CROP_LIFECYCLE_ORDER.indexOf(normalized) >= 0 ? normalized : 'all';
    }

    function readPersistedCropLifecycleFilter() {
        try {
            const storage = typeof window !== 'undefined' ? window.localStorage : null;
            return normalizeCropLifecycleFilter(storage && storage.getItem(CROP_LIFECYCLE_FILTER_STORAGE_KEY));
        } catch (_) {
            return 'all';
        }
    }

    function persistCropLifecycleFilter(value) {
        const normalized = normalizeCropLifecycleFilter(value);
        try {
            const storage = typeof window !== 'undefined' ? window.localStorage : null;
            if (storage) storage.setItem(CROP_LIFECYCLE_FILTER_STORAGE_KEY, normalized);
        } catch (_) { }
        return normalized;
    }

    function buildLifecycleFilterControl(initialValue = null) {
        const sel = document.createElement('select');
        sel.style.padding = '6px';
        sel.style.maxWidth = '132px';
        [
            ['all', 'All types'],
            ['annual', 'Annual'],
            ['biennial', 'Biennial'],
            ['perennial', 'Perennial'],
            ['uncategorized', 'Uncategorized']
        ].forEach(([value, label]) => {
            const opt = document.createElement('option');
            opt.value = value;
            opt.textContent = label;
            sel.appendChild(opt);
        });
        sel.value = normalizeCropLifecycleFilter(initialValue || readPersistedCropLifecycleFilter());
        sel.addEventListener('change', () => { persistCropLifecycleFilter(sel.value); });
        setTooltip(sel, 'Filter crop choices by lifecycle. This preference is shared by Scheduler and Set Plant.');
        return sel;
    }

    function cropPickerBaseLabel(plant) {
        const name = String(plant?.plant_name || plant?.name || plant?.abbr || plant?.plant_id || '').trim();
        const abbr = String(plant?.abbr || '').trim();
        return name + (abbr && abbr !== name ? ` (${abbr})` : '');
    }

    function inferMethodCategoryFromMethodId(methodId) {
        const normalized = normId(methodId);
        if (normalized.indexOf('.') > 0) return normalized.split('.')[0];
        return '';
    }

    function resolveHarvestRequestMethodBehavior(req) {
        const methodId = normId(req?.methodId || req?.method);
        const methodCategoryId = normId(req?.methodCategoryId || inferMethodCategoryFromMethodId(methodId));
        return resolveMethodBehavior({ methodCategoryId, methodId });
    }

    function resolveCandidateMethodSelection(plant) {
        const methodId = normId(plant?.default_planting_method || '');
        const methodCategoryId = normId(plant?.default_planting_method_category || inferMethodCategoryFromMethodId(methodId));
        const attempts = [
            { methodCategoryId, methodId },
            { methodCategoryId: 'direct_sow', methodId: 'direct_sow.field' }
        ];
        for (const attempt of attempts) {
            try {
                return resolveMethodBehavior(attempt);
            } catch (_) { }
        }
        return null;
    }

    function scoreSowingWindowsForDate(windows, selectedISO) {
        const selected = parseISODateUTCValue(selectedISO);
        const normalized = normalizeSowingSeasons(windows);
        if (!selected || !normalized.length) return { rankClass: 3, hint: '', percentRemaining: -1, distanceDays: Infinity, selectedWindow: null };
        let outside = null;
        for (const windowRow of normalized) {
            const start = parseISODateUTCValue(windowRow.startISO);
            const end = parseISODateUTCValue(windowRow.endISO);
            if (!start || !end) continue;
            if (selected >= start && selected <= end) {
                const totalDays = Math.max(1, daysBetweenUTC(start, end));
                const remainingDays = Math.max(0, daysBetweenUTC(selected, end));
                const percentRemaining = Math.max(0, Math.min(100, Math.round((remainingDays / totalDays) * 100)));
                return { rankClass: 0, hint: `${percentRemaining}% window left`, percentRemaining, distanceDays: 0, selectedWindow: windowRow };
            }
            const beforeDays = Math.abs(daysBetweenUTC(selected, start));
            const afterDays = Math.abs(daysBetweenUTC(selected, end));
            const candidate = selected < start
                ? { rankClass: 1, hint: `Starts in ${beforeDays}d`, percentRemaining: -1, distanceDays: beforeDays, selectedWindow: windowRow }
                : { rankClass: 1, hint: `${afterDays}d late`, percentRemaining: -1, distanceDays: afterDays, selectedWindow: windowRow };
            if (!outside || candidate.distanceDays < outside.distanceDays) outside = candidate;
        }
        return outside || { rankClass: 3, hint: '', percentRemaining: -1, distanceDays: Infinity, selectedWindow: null };
    }

    const SHARED_CROP_SUITABILITY_CACHE = {
        dailyClimateByKey: new Map(),
        windowsByKey: new Map(),
        pendingByKey: new Map(),
        errorsByKey: new Map(),
        queue: [],
        queueRunning: false,
        listeners: new Set()
    };

    function makeCropSuitabilityCache() {
        return SHARED_CROP_SUITABILITY_CACHE;
    }

    function clearCropSuitabilityCache(cache = makeCropSuitabilityCache()) {
        if (!cache) return;
        cache.dailyClimateByKey?.clear?.();
        cache.windowsByKey?.clear?.();
        cache.pendingByKey?.clear?.();
        cache.errorsByKey?.clear?.();
        if (Array.isArray(cache.queue)) cache.queue.length = 0;
        cache.queueRunning = false;
    }

    function stableStringifyCropCacheValue(value) {
        if (value == null || typeof value !== 'object') return JSON.stringify(value);
        if (Array.isArray(value)) return `[${value.map(stableStringifyCropCacheValue).join(',')}]`;
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringifyCropCacheValue(value[key])}`).join(',')}}`;
    }

    function cropSuitabilityPlantSignature(plant) {
        return stableStringifyCropCacheValue({
            plant_id: plant?.plant_id ?? null,
            annual: Number(plant?.annual) || 0,
            biennial: Number(plant?.biennial) || 0,
            perennial: Number(plant?.perennial) || 0,
            overwinter_ok: Number(plant?.overwinter_ok) || 0,
            default_planting_method: normId(plant?.default_planting_method || ''),
            default_planting_method_category: normId(plant?.default_planting_method_category || ''),
            days_transplant: finiteNumberOrNull(plant?.days_transplant),
            days_maturity: finiteNumberOrNull(plant?.days_maturity),
            gdd_to_maturity: finiteNumberOrNull(plant?.gdd_to_maturity),
            harvest_window_days: finiteNumberOrNull(plant?.harvest_window_days),
            tbase_c: finiteNumberOrNull(plant?.tbase_c),
            tmin_c: finiteNumberOrNull(plant?.tmin_c),
            topt_low_c: finiteNumberOrNull(plant?.topt_low_c),
            topt_high_c: finiteNumberOrNull(plant?.topt_high_c),
            tmax_c: finiteNumberOrNull(plant?.tmax_c),
            killtemp_c: finiteNumberOrNull(plant?.killtemp_c),
            soil_temp_min_plant_c: finiteNumberOrNull(plant?.soil_temp_min_plant_c),
            start_cooling_threshold_c: finiteNumberOrNull(plant?.start_cooling_threshold_c)
        });
    }

    function makeCropSuitabilityContextKey(context = {}) {
        const city = context.city || {};
        return stableStringifyCropCacheValue({
            city_id: city.city_id ?? context.cityId ?? null,
            city_name: city.city_name || context.cityName || '',
            latitude: finiteNumberOrNull(city.latitude ?? city.lat),
            seasonStartYear: Number.isFinite(Number(context.seasonStartYear)) ? Math.trunc(Number(context.seasonStartYear)) : null,
            climatePolicy: context.climatePolicy || null,
            bedProfile: context.bedProfile || normalizeBedProfile(null),
            bedProfileSource: context.bedProfileSource || 'generic garden bed'
        });
    }

    function makeCropWindowCacheKey(plant, context = {}) {
        return `${makeCropSuitabilityContextKey(context)}|${cropSuitabilityPlantSignature(plant)}|method:${normId(context.methodId || plant?.default_planting_method || '')}|category:${normId(context.methodCategoryId || plant?.default_planting_method_category || '')}|transplant:${finiteNumberOrNull(context.transplantDays ?? plant?.days_transplant) ?? 0}`;
    }

    function pendingCropSuitabilityScore(plant, reason = 'calculating') {
        const lifecycle = getCropLifecycle(plant);
        const label = cropPickerBaseLabel(plant);
        if (lifecycle === 'perennial') return { lifecycle, label, rankClass: 2, hint: 'date-flexible', percentRemaining: -1, distanceDays: Infinity };
        return { lifecycle, label, rankClass: 3, hint: reason, percentRemaining: -1, distanceDays: Infinity, pending: reason === 'calculating' };
    }

    function emitCropSuitabilityCacheUpdate(cache, detail = {}) {
        if (!cache || !cache.listeners) return;
        cache.listeners.forEach(listener => { try { listener(detail); } catch (e) { console.warn('[Scheduler] Crop suitability cache listener failed:', e); } });
    }

    function subscribeCropSuitabilityCache(cache, listener) {
        if (!cache || typeof listener !== 'function') return function () { };
        cache.listeners.add(listener);
        return function unsubscribeCropSuitabilityCache() { cache.listeners.delete(listener); };
    }

    function scheduleCropSuitabilityQueuePump(cache) {
        if (!cache || cache.queueRunning) return;
        cache.queueRunning = true;
        const scheduler = (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function')
            ? window.requestIdleCallback.bind(window)
            : (fn => setTimeout(fn, 0));
        scheduler(async () => {
            const task = cache.queue.shift();
            if (!task) { cache.queueRunning = false; return; }
            try {
                const windows = await computePreparedCropSuitabilityWindows(task.prepared);
                cache.windowsByKey.set(task.key, { windows, contextKey: task.prepared.contextKey });
                cache.errorsByKey.delete(task.key);
            } catch (e) {
                cache.errorsByKey.set(task.key, String(e?.message || e));
            } finally {
                cache.pendingByKey.delete(task.key);
                emitCropSuitabilityCacheUpdate(cache, { key: task.key, contextKey: task.prepared.contextKey });
                cache.queueRunning = false;
                if (cache.queue.length) scheduleCropSuitabilityQueuePump(cache);
            }
        });
    }

    async function loadSuitabilityDailyClimate(city, scanStart, scanEndHard, climatePolicy, cache) {
        const key = `${city?.city_id ?? (city?.city_name || '')}|${fmtISO(scanStart)}|${fmtISO(scanEndHard)}|${JSON.stringify(climatePolicy || {})}`;
        if (cache && cache.dailyClimateByKey.has(key)) return cache.dailyClimateByKey.get(key);
        const dailyClimate = await city.loadDailyClimateModel({ scanStart, scanEndHard, climatePolicy });
        if (cache) cache.dailyClimateByKey.set(key, dailyClimate);
        return dailyClimate;
    }

    function prepareCropSuitabilityScoring(plant, context = {}) {
        const lifecycle = getCropLifecycle(plant);
        const label = cropPickerBaseLabel(plant);
        if (lifecycle === 'perennial') return { lifecycle, label, perennial: true };
        const city = context.city || null;
        const primaryDateISO = String(context.primaryDateISO || '').trim();
        if (!city || !primaryDateISO) return { lifecycle, label, missingContext: true };
        const method = resolveCandidateMethodSelection(plant);
        if (!method) throw new Error('No supported planting method.');
        const transplantDays = plantDefaultTransplantDays(plant);
        requireEffectiveTransplantDays(method.methodId, transplantDays);
        const effectivePlant = applyEffectiveTransplantDaysToPlant(plant, transplantDays);
        const selectedSowISO = sowDateFromPrimaryDate(primaryDateISO, method.methodId, transplantDays);
        const selectedDate = parseISODateUTCValue(selectedSowISO);
        const seasonStartYear = Number.isFinite(Number(context.seasonStartYear))
            ? Math.trunc(Number(context.seasonStartYear))
            : (selectedDate ? selectedDate.getUTCFullYear() : (new Date()).getUTCFullYear());
        const scanStart = asUTCDate(seasonStartYear, 1, 1);
        const scanEndHard = asUTCDate(annualSchedulerScanEndYear(effectivePlant, seasonStartYear), 12, 31);
        const climateResolution = resolveClimateModelPolicy(context.climateModelModuleCell || null, city.city_name || context.cityName || '', effectivePlant.plant_id, null);
        const climatePolicy = climateResolution.effective;
        const env = effectivePlant.cropTempEnvelope();
        const cacheContext = {
            ...context,
            city,
            climatePolicy,
            methodCategoryId: method.methodCategoryId,
            methodId: method.methodId,
            transplantDays
        };
        return {
            lifecycle,
            label,
            plant,
            effectivePlant,
            city,
            method,
            transplantDays,
            selectedSowISO,
            seasonStartYear,
            scanStart,
            scanEndHard,
            climatePolicy,
            env,
            contextKey: makeCropSuitabilityContextKey(cacheContext),
            cacheKey: makeCropWindowCacheKey(effectivePlant, cacheContext),
            bedProfile: context.bedProfile || normalizeBedProfile(null),
            bedProfileSource: context.bedProfileSource || 'generic garden bed',
            cache: context.cache || makeCropSuitabilityCache()
        };
    }

    async function computePreparedCropSuitabilityWindows(prepared) {
        const dailyClimate = await loadSuitabilityDailyClimate(prepared.city, prepared.scanStart, prepared.scanEndHard, prepared.climatePolicy, prepared.cache);
        return annualCore.computeAnnualSowingSeasons({
            methodCategoryId: prepared.method.methodCategoryId,
            methodId: prepared.method.methodId,
            budget: prepared.effectivePlant.firstHarvestBudget(),
            HW_DAYS: resolveHarvestWindowDays(null, prepared.effectivePlant),
            dailyRatesMap: prepared.city.dailyRates(prepared.env.Tbase, prepared.seasonStartYear, prepared.climatePolicy),
            monthlyAvgTemp: prepared.city.monthlyMeans(),
            dailyClimate,
            Tbase: prepared.env.Tbase,
            cropTemp: prepared.env,
            scanStart: prepared.scanStart,
            scanEndHard: prepared.scanEndHard,
            soilGateThresholdC: finiteNumberOrNull(prepared.effectivePlant.soil_temp_min_plant_c),
            soilGateConsecutiveDays: prepared.climatePolicy.soilGateConsecutiveDays,
            startCoolingThresholdC: asCoolingThresholdC(prepared.effectivePlant.start_cooling_threshold_c),
            useSpringFrostGate: true,
            lastSpringFrostDOY: pickFrostByRisk(prepared.city, prepared.climatePolicy.springFrostRisk),
            daysTransplant: prepared.transplantDays,
            overwinterAllowed: isCrossYearCrop(prepared.effectivePlant),
            plantMetadata: prepared.effectivePlant,
            cityLatitudeDeg: finiteNumberOrNull(prepared.city.latitude ?? prepared.city.lat),
            bedProfile: prepared.bedProfile,
            bedProfileSource: prepared.bedProfileSource
        }).seasons;
    }

    function getOrQueueCropWindowComputation(prepared) {
        const cache = prepared.cache || makeCropSuitabilityCache();
        if (cache.windowsByKey.has(prepared.cacheKey)) return { state: 'ready', windows: cache.windowsByKey.get(prepared.cacheKey).windows };
        if (cache.errorsByKey.has(prepared.cacheKey)) return { state: 'error', error: cache.errorsByKey.get(prepared.cacheKey) };
        if (cache.pendingByKey.has(prepared.cacheKey)) return { state: 'pending' };
        cache.pendingByKey.set(prepared.cacheKey, { contextKey: prepared.contextKey });
        cache.queue.push({ key: prepared.cacheKey, prepared });
        scheduleCropSuitabilityQueuePump(cache);
        return { state: 'pending' };
    }

    function scoreCropFromCachedWindows(plant, windows, selectedSowISO) {
        const lifecycle = getCropLifecycle(plant);
        const label = cropPickerBaseLabel(plant);
        return { lifecycle, label, ...scoreSowingWindowsForDate(windows, selectedSowISO) };
    }

    async function scoreCropSuitability(plant, context = {}) {
        const lifecycle = getCropLifecycle(plant);
        const label = cropPickerBaseLabel(plant);
        if (lifecycle === 'perennial') return { lifecycle, label, rankClass: 2, hint: 'date-flexible', percentRemaining: -1, distanceDays: Infinity };
        try {
            const prepared = prepareCropSuitabilityScoring(plant, context);
            if (prepared.perennial) return { lifecycle, label, rankClass: 2, hint: 'date-flexible', percentRemaining: -1, distanceDays: Infinity };
            if (prepared.missingContext) return { lifecycle, label, rankClass: 3, hint: '', percentRemaining: -1, distanceDays: Infinity };
            const cache = prepared.cache;
            const cached = cache.windowsByKey.get(prepared.cacheKey);
            if (cached) return scoreCropFromCachedWindows(plant, cached.windows, prepared.selectedSowISO);
            if (cache.errorsByKey.has(prepared.cacheKey)) return { lifecycle, label, rankClass: 3, hint: '', percentRemaining: -1, distanceDays: Infinity, error: cache.errorsByKey.get(prepared.cacheKey) };
            if (context.deferMissingWindows) {
                getOrQueueCropWindowComputation(prepared);
                return pendingCropSuitabilityScore(plant);
            }
            const windows = await computePreparedCropSuitabilityWindows(prepared);
            cache.windowsByKey.set(prepared.cacheKey, { windows, contextKey: prepared.contextKey });
            return scoreCropFromCachedWindows(plant, windows, prepared.selectedSowISO);
        } catch (e) {
            return { lifecycle, label, rankClass: 3, hint: '', percentRemaining: -1, distanceDays: Infinity, error: String(e?.message || e) };
        }
    }

    function compareCropPickerOptions(left, right) {
        const lScore = left.score || {};
        const rScore = right.score || {};
        const lLifecycle = getCropLifecycle(left.plant);
        const rLifecycle = getCropLifecycle(right.plant);
        if (lLifecycle === 'perennial' || rLifecycle === 'perennial') return String(left.label || '').localeCompare(String(right.label || ''));
        const rankDelta = Number(lScore.rankClass ?? 3) - Number(rScore.rankClass ?? 3);
        if (rankDelta) return rankDelta;
        if (Number(lScore.rankClass) === 0) {
            const percentDelta = Number(rScore.percentRemaining ?? -1) - Number(lScore.percentRemaining ?? -1);
            if (percentDelta) return percentDelta;
        }
        if (Number(lScore.rankClass) === 1) {
            const distanceDelta = Number(lScore.distanceDays ?? Infinity) - Number(rScore.distanceDays ?? Infinity);
            if (distanceDelta) return distanceDelta;
        }
        return String(left.label || '').localeCompare(String(right.label || ''));
    }

    function companionRatingLabel(rating) {
        const value = Number(rating);
        if (value > 0) return 'beneficial';
        if (value < 0) return 'antagonistic';
        return 'mixed';
    }

    function formatSignedDays(days) {
        const n = Number(days);
        if (!Number.isFinite(n) || n === 0) return 'same day';
        return (n > 0 ? '+' : '') + Math.trunc(n) + 'd';
    }

    function companionPickerHint(metadata) {
        if (!metadata) return '';
        if (!metadata.known) return 'no known companion relationship';
        const parts = [companionRatingLabel(metadata.rating)];
        if (metadata.companionType) parts.push(metadata.companionType);
        parts.push(formatSignedDays(metadata.recommendedStartOffsetDays));
        return parts.filter(Boolean).join(', ');
    }

    function makeCropPickerOptions(plants, scoreByPlantId = new Map(), metadataByPlantId = new Map()) {
        return (plants || []).map(plant => {
            const label = cropPickerBaseLabel(plant);
            const score = scoreByPlantId.get(String(plant?.plant_id)) || null;
            const metadata = metadataByPlantId.get(String(plant?.plant_id)) || null;
            const metadataHint = companionPickerHint(metadata);
            const scoreHint = score?.hint || '';
            const hint = [scoreHint, metadataHint].filter(Boolean).join(' - ');
            return {
                value: String(plant?.plant_id),
                label,
                displayLabel: hint ? `${label} - ${hint}` : label,
                lifecycle: getCropLifecycle(plant),
                plant,
                score,
                metadata
            };
        });
    }

    function buildGroupedPlantOptions(plants, { selectedValue = '', includeSelectedWhenFiltered = true } = {}) {
        return buildGroupedCropOptions(makeCropPickerOptions(plants || []), {
            filter: 'all',
            selectedValue,
            includeSelectedWhenFiltered
        });
    }

    function renderGroupedSelectOptions(selectEl, groups, selectedValue = '', { emptyLabel = 'No options match' } = {}) {
        selectEl.innerHTML = '';
        const selected = String(selectedValue || '');
        if (!(groups || []).some(group => group.options && group.options.length)) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = emptyLabel;
            opt.disabled = true;
            selectEl.appendChild(opt);
            return;
        }
        (groups || []).forEach(groupSpec => {
            const group = document.createElement('optgroup');
            group.label = groupSpec.label;
            (groupSpec.options || []).forEach(optionSpec => {
                const opt = document.createElement('option');
                opt.value = String(optionSpec.value);
                opt.textContent = optionSpec.displayLabel || optionSpec.label;
                group.appendChild(opt);
            });
            if (group.children.length) selectEl.appendChild(group);
        });
        if (selected && Array.from(selectEl.options).some(option => option.value === selected)) selectEl.value = selected;
    }

    function buildGroupedCropOptions(options, { filter = 'all', selectedValue = '', includeSelectedWhenFiltered = true } = {}) {
        const normalizedFilter = normalizeCropLifecycleFilter(filter);
        const selected = String(selectedValue || '');
        const byLifecycle = { annual: [], biennial: [], perennial: [], uncategorized: [] };
        let selectedOption = null;
        (options || []).forEach(option => {
            if (String(option.value) === selected) selectedOption = option;
            if (normalizedFilter !== 'all' && option.lifecycle !== normalizedFilter) return;
            byLifecycle[option.lifecycle || 'uncategorized'].push(option);
        });
        Object.keys(byLifecycle).forEach(key => byLifecycle[key].sort(compareCropPickerOptions));
        const groups = [];
        const visibleHasSelected = selected && CROP_LIFECYCLE_ORDER.some(key => byLifecycle[key].some(option => String(option.value) === selected));
        if (includeSelectedWhenFiltered && selectedOption && !visibleHasSelected) groups.push({ label: 'Current selection', options: [selectedOption] });
        CROP_LIFECYCLE_ORDER.forEach(key => {
            if (byLifecycle[key].length) groups.push({ label: CROP_LIFECYCLE_LABELS[key], options: byLifecycle[key] });
        });
        return groups;
    }

    function renderGroupedCropOptions(selectEl, groups, selectedValue = '') {
        renderGroupedSelectOptions(selectEl, groups, selectedValue, { emptyLabel: 'No crops match this filter' });
    }

    function createSchedulerCropCombobox(selectEl, options = {}) {
        const root = document.createElement('div');
        root.className = options.className || 'usl-crop-combobox';
        root.style.width = '100%';
        selectEl.style.display = 'none';
        const doc = selectEl.ownerDocument || document;
        const ownerWindow = doc.defaultView || window;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'usl-crop-combobox-button';
        button.style.width = '100%';
        button.style.textAlign = 'left';
        button.style.padding = '6px 8px';
        button.style.border = '1px solid #bbb';
        button.style.borderRadius = '6px';
        button.style.background = '#fff';
        const panel = document.createElement('div');
        panel.className = 'usl-crop-combobox-panel';
        panel.style.position = 'fixed';
        panel.style.zIndex = '2000000100';
        panel.style.maxHeight = '260px';
        panel.style.overflow = 'auto';
        panel.style.border = '1px solid #bbb';
        panel.style.borderRadius = '6px';
        panel.style.background = '#fff';
        panel.style.boxShadow = '0 4px 14px rgba(0,0,0,.12)';
        panel.style.display = 'none';
        const input = document.createElement('input');
        input.type = 'search';
        input.placeholder = options.placeholder || 'Search crops...';
        input.style.width = 'calc(100% - 12px)';
        input.style.margin = '6px';
        input.style.boxSizing = 'border-box';
        const list = document.createElement('div');
        panel.appendChild(input);
        panel.appendChild(list);
        root.appendChild(selectEl);
        root.appendChild(button);
        let groupsCache = [];
        let selectedLabel = '';
        let panelOpen = false;
        let teardownObserver = null;
        function getViewportRect() {
            const dialog = root.closest?.('.usl-scheduler-dialog');
            const rect = dialog?.getBoundingClientRect?.();
            if (rect && rect.width > 0 && rect.height > 0) return rect;
            return {
                left: 0,
                top: 0,
                right: Number(ownerWindow.innerWidth || doc.documentElement?.clientWidth || 1024),
                bottom: Number(ownerWindow.innerHeight || doc.documentElement?.clientHeight || 768),
                width: Number(ownerWindow.innerWidth || doc.documentElement?.clientWidth || 1024),
                height: Number(ownerWindow.innerHeight || doc.documentElement?.clientHeight || 768)
            };
        }
        function positionPanel() {
            if (!panelOpen) return;
            const triggerRect = button.getBoundingClientRect();
            const viewportRect = getViewportRect();
            const margin = 8;
            const preferredWidth = Math.max(Number(triggerRect.width || 0), 280);
            const maxWidth = Math.max(180, viewportRect.right - viewportRect.left - (margin * 2));
            const width = Math.min(preferredWidth, maxWidth);
            let left = Number(triggerRect.left || viewportRect.left + margin);
            left = Math.min(left, viewportRect.right - width - margin);
            left = Math.max(viewportRect.left + margin, left);
            const belowTop = Number(triggerRect.bottom || triggerRect.top || viewportRect.top) + 4;
            const availableBelow = viewportRect.bottom - belowTop - margin;
            const availableAbove = Number(triggerRect.top || viewportRect.top) - viewportRect.top - margin;
            const openAbove = availableBelow < 140 && availableAbove > availableBelow;
            const maxHeight = Math.max(120, Math.min(260, openAbove ? availableAbove : availableBelow));
            const top = openAbove
                ? Math.max(viewportRect.top + margin, Number(triggerRect.top || viewportRect.top) - maxHeight - 4)
                : Math.max(viewportRect.top + margin, belowTop);
            panel.style.left = `${Math.round(left)}px`;
            panel.style.top = `${Math.round(top)}px`;
            panel.style.width = `${Math.round(width)}px`;
            panel.style.maxHeight = `${Math.round(maxHeight)}px`;
        }
        function detachPanelListeners() {
            doc.removeEventListener('mousedown', handleOutsideMouseDown, true);
            doc.removeEventListener('scroll', positionPanel, true);
            ownerWindow.removeEventListener('resize', positionPanel);
            if (teardownObserver) teardownObserver.disconnect();
            teardownObserver = null;
        }
        function close() {
            if (!panelOpen) return;
            panelOpen = false;
            detachPanelListeners();
            panel.style.display = 'none';
            panel.remove();
        }
        function handleOutsideMouseDown(evt) {
            const target = evt.target;
            if (root.contains(target) || panel.contains(target)) return;
            close();
        }
        function watchDialogTeardown() {
            const Observer = ownerWindow.MutationObserver || (typeof MutationObserver === 'function' ? MutationObserver : null);
            if (!Observer) return;
            teardownObserver = new Observer(() => {
                if (panelOpen && !root.isConnected) close();
            });
            teardownObserver.observe(doc.body || doc.documentElement, { childList: true, subtree: true });
        }
        function open() {
            if (panelOpen) return;
            panelOpen = true;
            renderList(input.value);
            (doc.body || doc.documentElement).appendChild(panel);
            panel.style.display = 'block';
            positionPanel();
            doc.addEventListener('mousedown', handleOutsideMouseDown, true);
            doc.addEventListener('scroll', positionPanel, true);
            ownerWindow.addEventListener('resize', positionPanel);
            watchDialogTeardown();
            input.focus();
        }
        function optionTitle(option) {
            if (typeof options.optionTitle === 'function') return options.optionTitle(option);
            const meta = option && option.metadata;
            if (!meta) return option?.displayLabel || option?.label || '';
            const evidence = (meta.evidence || []).map(item => item.summary || item.sourceNote || item.sourceUrl).filter(Boolean).slice(0, 2).join('\n');
            return [option.displayLabel || option.label, evidence].filter(Boolean).join('\n');
        }
        function choose(option) {
            if (!option) return;
            selectEl.value = String(option.value);
            selectedLabel = option.displayLabel || option.label || '';
            button.textContent = selectedLabel;
            close();
            const EventCtor = selectEl.ownerDocument?.defaultView?.Event || (typeof Event === 'function' ? Event : null);
            if (EventCtor) selectEl.dispatchEvent(new EventCtor('change'));
        }
        function makeBadge(text, color) {
            const badge = document.createElement('span');
            badge.textContent = text;
            badge.style.fontSize = '10px';
            badge.style.fontWeight = '700';
            badge.style.color = color || '#374151';
            badge.style.marginLeft = '6px';
            return badge;
        }
        function renderOption(option) {
            const row = document.createElement('button');
            row.type = 'button';
            row.setAttribute('role', 'option');
            row.style.display = 'block';
            row.style.width = '100%';
            row.style.textAlign = 'left';
            row.style.border = '0';
            row.style.borderRadius = '0';
            row.style.padding = '6px 8px';
            row.style.background = String(option.value) === String(selectEl.value) ? '#eff6ff' : '#fff';
            row.style.color = '#111827';
            row.title = optionTitle(option);
            const label = document.createElement('span');
            label.textContent = option.displayLabel || option.label || '';
            row.appendChild(label);
            const meta = option.metadata;
            if (meta) {
                if (meta.known) row.appendChild(makeBadge(companionRatingLabel(meta.rating), Number(meta.rating) < 0 ? '#b91c1c' : '#166534'));
                else row.appendChild(makeBadge('unknown', '#6b7280'));
                if (meta.known) row.appendChild(makeBadge(formatSignedDays(meta.recommendedStartOffsetDays), '#1d4ed8'));
            }
            row.addEventListener('click', () => choose(option));
            return row;
        }
        function renderList(filterText = '') {
            const q = String(filterText || '').trim().toLocaleLowerCase();
            list.innerHTML = '';
            (groupsCache || []).forEach(group => {
                const matching = (group.options || []).filter(option => {
                    const haystack = typeof options.searchText === 'function'
                        ? options.searchText(option)
                        : (option.displayLabel || option.label || '');
                    return !q || String(haystack || '').toLocaleLowerCase().includes(q);
                });
                if (!matching.length) return;
                const heading = document.createElement('div');
                heading.textContent = group.label;
                heading.style.padding = '6px 8px 3px';
                heading.style.fontSize = '10px';
                heading.style.fontWeight = '700';
                heading.style.color = '#6b7280';
                list.appendChild(heading);
                matching.forEach(option => list.appendChild(renderOption(option)));
            });
            if (!list.children.length) {
                const empty = document.createElement('div');
                empty.textContent = options.emptyText || 'No crops match';
                empty.style.padding = '8px';
                empty.style.color = '#6b7280';
                list.appendChild(empty);
            }
        }
        button.addEventListener('click', () => { panelOpen ? close() : open(); });
        input.addEventListener('input', () => { renderList(input.value); positionPanel(); });
        input.addEventListener('keydown', evt => { if (evt.key === 'Escape') { close(); button.focus(); } });
        return {
            root,
            refresh(groups, selectedValue = '') {
                groupsCache = groups || [];
                const selected = String(selectedValue || selectEl.value || '');
                const option = groupsCache.flatMap(group => group.options || []).find(item => String(item.value) === selected);
                selectedLabel = option ? (option.displayLabel || option.label || '') : (selectEl.options[selectEl.selectedIndex]?.textContent || options.buttonFallback || 'Select crop');
                button.textContent = selectedLabel;
                renderList(input.value);
                positionPanel();
            }
        };
    }

    async function scoreCropPickerOptions(plants, context = {}) {
        const cache = context.cache || makeCropSuitabilityCache();
        const scoreByPlantId = new Map();
        for (const plant of (plants || [])) {
            scoreByPlantId.set(String(plant?.plant_id), await scoreCropSuitability(plant, { ...context, cache }));
        }
        return makeCropPickerOptions(plants, scoreByPlantId, context.metadataByPlantId || new Map());
    }





























    async function buildScheduleContextFromForm(formState, selPlant, options = {}) {
        const basePlant = await resolveEffectivePlant(formState.plantId, formState.varietyId);
        if (!basePlant) throw new Error('Plant not found for schedule.');

        const city = await CityClimate.resolve({ cityId: formState.cityId, cityName: formState.cityName });
        if (!city) throw new Error('City not found for schedule.');

        const methodCategoryId = normId(formState.methodCategoryId);
        const methodId = normId(formState.methodId);
        const resolvedBehavior = resolveMethodBehavior({ methodCategoryId, methodId });
        const planningMode = resolvedBehavior.planningMode;
        const transplantDaysConfig = resolveTransplantDaysConfig(basePlant, {
            methodId,
            overrideEnabled: formState.transplantDaysOverrideEnabled,
            overrideValue: formState.transplantDaysOverrideValue
        });
        requireEffectiveTransplantDays(methodId, transplantDaysConfig.effectiveDays);
        const transplantAdjustedPlant = applyEffectiveTransplantDaysToPlant(basePlant, transplantDaysConfig.effectiveDays);
        const growthStage = normalizeGrowthStage(formState.growthStage || defaultGrowthStage());
        const plant = applyGrowthStageToPlant(transplantAdjustedPlant, growthStage);

        const climateResolution = resolveClimateModelPolicy(
            options.climateModelModuleCell || formState.climateModelModuleCell || null,
            formState.cityName,
            formState.plantId,
            formState.climateModelDraftPatch
        );
        formState.climateModelPolicy = climateResolution.effective;
        const policy = PolicyFlags.fromResolvedBehavior(plant, resolvedBehavior, climateResolution.effective);

        const varietyId = formState.varietyId != null ? Number(formState.varietyId) : null;
        const varietyName = varietyId
            ? await resolveVarietyName(varietyId, options.currentVarieties)
            : '';
        const scanStart = asUTCDate(Number(formState.seasonStartYear), 1, 1);
        const scanEndHard = asUTCDate(annualSchedulerScanEndYear(plant, Number(formState.seasonStartYear)), 12, 31);
        const dailyClimateKey = `${city.city_name || formState.cityName}|${fmtISO(scanStart)}|${fmtISO(scanEndHard)}|${JSON.stringify(climateResolution.effective)}`;
        const cachedDailyClimate = formState.dailyClimateKey === dailyClimateKey ? formState.dailyClimate : null;
        const dailyClimate = options.dailyClimate || cachedDailyClimate || await city.loadDailyClimateModel({ scanStart, scanEndHard, climatePolicy: climateResolution.effective });
        formState.dailyClimate = dailyClimate;
        formState.dailyClimateKey = dailyClimateKey;
        const scheduleEndISO = resolveScheduleInputEndISO(formState, plant, scanEndHard); // ADDED: annual display harvest dates are not hard caps.

        const inputs = new sharedCore.ScheduleInputs({
            plant,
            city,
            planningMode,
            methodCategoryId: resolvedBehavior.methodCategoryId,
            methodId: resolvedBehavior.methodId,
            startISO: formState.startISO,
            seasonEndISO: scheduleEndISO, // FIX: use lifecycle/lifespan end, not annual latest-harvest display state.
            policy,
            seasonStartYear: formState.seasonStartYear,
            harvestWindowDays: formState.harvestWindowDays,
            minYieldMultiplier: formState.minYieldMultiplier,
            varietyId,
            varietyName,
            bedProfile: options.bedProfile || formState.bedProfile || null, // ADDED: reuse resolved bed conditions for soil gates.
            bedProfileSource: options.bedProfileSource || formState.bedProfileSource || 'generic garden bed',
            dailyClimate
        });

        return {
            plant,
            city,
            planningMode: resolvedBehavior.planningMode, // FIX: return the resolved planning behavior, not the method id
            methodCategoryId: resolvedBehavior.methodCategoryId,
            methodId: resolvedBehavior.methodId,
            resolvedBehavior,
            policy,
            inputs,
            transplantDaysConfig,
            growthStage
        };
    }

    function resolveScheduleInputEndISO(formState, plant, scanEndHard) {
        if (isPerennialPlant(plant)) return formState.seasonEndISO || fmtISO(scanEndHard);
        return fmtISO(scanEndHard); // ADDED: annual latest-harvest display state must not constrain feasibility.
    }

    // Convert model instance to plain {column: value} dict (primitives only)           
    function toPlainDict(obj) {
        const out = {};
        if (!obj) return out;
        for (const k of Object.keys(obj)) {
            const v = obj[k];
            if (v == null) continue;
            const t = typeof v;
            if (t === 'function') continue;
            if (t === 'object') continue;
            out[k] = v;
        }
        return out;
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



    // helper near your other date utils
    function dateFromDOY(year, doy) {
        const d0 = Date.UTC(year, 0, 1);
        return new Date(d0 + (Math.max(1, Math.floor(doy)) - 1) * 86400000);
    }


    const METHOD_BEHAVIOR = Object.freeze({
        "transplant.indoor": Object.freeze({
            methodCategoryId: "transplant",
            planningMode: "transplant_indoor",
            usesSoilTempGate: true,
            leadDaysMode: "days_transplant"
        }),
        "transplant.outdoor": Object.freeze({
            methodCategoryId: "transplant",
            planningMode: "transplant_outdoor",
            usesSoilTempGate: true,
            leadDaysMode: "none"
        }),
        "transplant.purchased": Object.freeze({
            methodCategoryId: "transplant",
            planningMode: "transplant_outdoor",
            usesSoilTempGate: true,
            leadDaysMode: "none"
        }),
        "transplant.cutting": Object.freeze({
            methodCategoryId: "transplant",
            planningMode: "transplant_indoor",
            usesSoilTempGate: true,
            leadDaysMode: "days_transplant"
        }),
        "direct_sow.field": Object.freeze({
            methodCategoryId: "direct_sow",
            planningMode: "direct_sow",
            usesSoilTempGate: true,
            leadDaysMode: "none"
        }),
        "direct_sow.pre_germinated": Object.freeze({
            methodCategoryId: "direct_sow",
            planningMode: "direct_sow",
            usesSoilTempGate: true,
            leadDaysMode: "none"
        }),
        "direct_sow.plug": Object.freeze({
            methodCategoryId: "direct_sow",
            planningMode: "transplant_outdoor",
            usesSoilTempGate: true,
            leadDaysMode: "none"
        })
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

    function resolveValidMethodRecord(methodRow, fallbackMethodCategoryId = '') { // FIX: validate DB method rows consistently
        const methodCategoryId = normId(
            methodRow?.method_category_id ?? fallbackMethodCategoryId ?? ''
        );
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


    async function resolveInitialMethodSelection(cell, plant) {
        const cellMethodCategoryId = normId(cell?.getAttribute?.('method_category_id'));
        const cellMethodId = normId(cell?.getAttribute?.('method_id'));
    
        // 1) Prefer fully-specified cell selection
        if (cellMethodCategoryId && cellMethodId) {
            try {
                const resolved = resolveMethodBehavior({
                    methodCategoryId: cellMethodCategoryId,
                    methodId: cellMethodId
                });
    
                return {
                    methodCategoryId: resolved.methodCategoryId,
                    methodId: resolved.methodId,
                    resolvedBehavior: resolved
                };
            } catch (_) {
                // fall through
            }
        }
    
        // 2) Plant default planting method
        const defaultMethodId = normId(plant?.default_planting_method);
        if (defaultMethodId) {
            try { // FIX: an invalid plant default must not block the scheduler
                const methodRow = await PlantModel.getMethodById(defaultMethodId);
                if (methodRow) {
                    const resolved = resolveValidMethodRecord(methodRow);
                    return {
                        methodCategoryId: resolved.methodCategoryId,
                        methodId: resolved.methodId,
                        resolvedBehavior: resolved
                    };
                }
            } catch (e) {
                console.warn('[Scheduler] Ignoring invalid plant default method', {
                    plantId: plant?.plant_id,
                    methodId: defaultMethodId,
                    reason: e?.message || String(e)
                });
            }
        }
    
        // 3) First allowed category + first method in that category
        let allowedCategories = [];
        try {
            allowedCategories = await PlantModel.listAllowedMethodCategoriesForPlant(Number(plant?.plant_id));
        } catch (e) {
            console.warn('[Scheduler] Unable to load allowed method categories', {
                plantId: plant?.plant_id,
                reason: e?.message || String(e)
            });
        }
        for (const cat of (allowedCategories || [])) {
            const methodCategoryId = normId(cat?.method_category_id);
            if (!methodCategoryId) continue;

            try { // FIX: skip invalid categories and method records independently
                const methods = await PlantModel.listMethodsForMethodCategory(methodCategoryId);
                for (const methodRow of (methods || [])) {
                    try {
                        const resolved = resolveValidMethodRecord(methodRow, methodCategoryId);
                        return {
                            methodCategoryId: resolved.methodCategoryId,
                            methodId: resolved.methodId,
                            resolvedBehavior: resolved
                        };
                    } catch (e) {
                        console.warn('[Scheduler] Skipping invalid allowed method record', {
                            plantId: plant?.plant_id,
                            methodCategoryId,
                            methodId: methodRow?.method_id,
                            reason: e?.message || String(e)
                        });
                    }
                }
            } catch (e) {
                console.warn('[Scheduler] Skipping invalid allowed method category', {
                    plantId: plant?.plant_id,
                    methodCategoryId,
                    reason: e?.message || String(e)
                });
            }
        }
    
        // 4) Final hard fallback
        const resolved = resolveMethodBehavior({
            methodCategoryId: 'direct_sow',
            methodId: 'direct_sow.field'
        });
    
        return {
            methodCategoryId: resolved.methodCategoryId,
            methodId: resolved.methodId,
            resolvedBehavior: resolved
        };
    }















































    // -------------------- Graph helpers ----------------------------------------------------
    function setAttr(cell, k, v) {
        const nextValue = v == null ? '' : String(v);
        const val = cell && cell.value;
        if (!val || !val.setAttribute) return;
        if (cell.getAttribute && String(cell.getAttribute(k) ?? '') === nextValue) return;

        const model = graph && typeof graph.getModel === 'function' ? graph.getModel() : null;
        if (model && typeof model.execute === 'function' && typeof mxCellAttributeChange === 'function') {
            model.execute(new mxCellAttributeChange(cell, k, nextValue));
        } else {
            val.setAttribute(k, nextValue);
        }
    }
    function getAttr(cell, k) { return cell && cell.getAttribute ? cell.getAttribute(k) : null; }
    function isTilerGroup(cell) { return !!cell && cell.getAttribute && cell.getAttribute('tiler_group') === '1'; }

    function requireCanSchedulePlantingGroup(cell) {
        if (!isTilerGroup(cell)) throw new Error('Scheduler requires a planting group.');
        const users = typeof window !== 'undefined' && window.Trellis && window.Trellis.users;
        if (users && typeof users.isEnabled === 'function' && users.isEnabled() && typeof users.canManagePlanting === 'function' && !users.canManagePlanting(cell)) {
            throw new Error('You do not have permission to schedule this planting group.');
        }
    }
    function isGardenBedCell(cell) {
        return !!cell && cell.getAttribute && (
            cell.getAttribute('garden_bed') === '1' ||
            cell.getAttribute('gardenBed') === '1' ||
            cell.getAttribute('is_garden_bed') === '1'
        ); // ADDED: scheduler can reuse existing bed-condition cells without a schema change.
    }
    function cellCenterPoint(cell) {
        const model = graph && graph.getModel ? graph.getModel() : null;
        const geo = model && cell ? model.getGeometry(cell) : null;
        if (!geo) return null;
        return { x: Number(geo.x || 0) + Number(geo.width || 0) / 2, y: Number(geo.y || 0) + Number(geo.height || 0) / 2 };
    }
    function pointInCellBounds(point, cell) {
        const model = graph && graph.getModel ? graph.getModel() : null;
        const geo = model && cell ? model.getGeometry(cell) : null;
        if (!point || !geo) return false;
        const x = Number(geo.x || 0), y = Number(geo.y || 0), w = Number(geo.width || 0), h = Number(geo.height || 0);
        return point.x >= x && point.x <= x + w && point.y >= y && point.y <= y + h;
    }
    function findContainingBedForScheduleCell(cell) {
        const model = graph && graph.getModel ? graph.getModel() : null;
        if (!model || !cell) return null;
        for (let cur = cell; cur; cur = model.getParent(cur)) {
            if (isGardenBedCell(cur)) return cur;
        }
        const parent = model.getParent(cell);
        const point = cellCenterPoint(cell);
        const siblings = parent && graph.getChildVertices ? graph.getChildVertices(parent) : [];
        let chosen = null, chosenArea = Infinity;
        (siblings || []).forEach(function (candidate) {
            if (!isGardenBedCell(candidate) || !pointInCellBounds(point, candidate)) return;
            const geo = model.getGeometry(candidate);
            const area = Math.max(0, Number(geo?.width || 0)) * Math.max(0, Number(geo?.height || 0));
            if (area > 0 && area < chosenArea) { chosen = candidate; chosenArea = area; }
        });
        return chosen;
    }
    function resolveScheduleBedContext(cell) {
        const bed = findContainingBedForScheduleCell(cell);
        const bedsApi = typeof window !== 'undefined' ? window.TrellisGardenBeds : null;
        if (bed && bedsApi && typeof bedsApi.readBedConditions === 'function') {
            return {
                profile: normalizeBedProfile(bedsApi.readBedConditions(bed)),
                source: `garden bed${bed.id ? ' ' + bed.id : ''}`
            }; // ADDED: use configured bed conditions when available.
        }
        return { profile: normalizeBedProfile(null), source: 'generic garden bed' };
    }
    function normalizeCompanionLayoutTemplate(value) {
        const normalized = String(value || '').trim().toLowerCase();
        return COMPANION_LAYOUT_TEMPLATES.includes(normalized) ? normalized : '';
    }
    function buildGraphCreatedCompanionRelationship(sourcePlant, companionPlant, attrs = {}) {
        const sourcePlantId = String(sourcePlant?.plant_id ?? attrs.sourcePlantId ?? attrs.storedSourcePlantId ?? '').trim();
        const companionPlantId = String(companionPlant?.plant_id ?? attrs.companionPlantId ?? attrs.storedCompanionPlantId ?? '').trim();
        if (!sourcePlantId || !companionPlantId) return null;
        const recommendedStartOffsetDays = layoutNumberOrNull(attrs.recommendedStartOffsetDays ?? attrs.startOffsetDays ?? attrs.storedStartOffsetDays) ?? 0;
        return {
            relationId: String(attrs.relationId || ''),
            sourcePlantId,
            companionPlantId,
            storedSourcePlantId: sourcePlantId,
            storedCompanionPlantId: companionPlantId,
            direction: 'forward',
            recommendedStartOffsetDays,
            storedStartOffsetDays: recommendedStartOffsetDays,
            rating: attrs.rating == null ? null : attrs.rating,
            companionType: String(attrs.companionType || ''),
            companionTypeId: String(attrs.companionTypeId || ''),
            layoutTemplate: normalizeCompanionLayoutTemplate(attrs.layoutTemplate),
            layoutSpacingXCm: layoutNumberOrNull(attrs.layoutSpacingXCm),
            layoutSpacingYCm: layoutNumberOrNull(attrs.layoutSpacingYCm),
            layoutOffsetXCm: layoutNumberOrNull(attrs.layoutOffsetXCm),
            layoutOffsetYCm: layoutNumberOrNull(attrs.layoutOffsetYCm),
            p1: String(sourcePlant?.plant_name || attrs.p1 || ''),
            p2: String(companionPlant?.plant_name || attrs.p2 || ''),
            evidence: [],
            known: !!attrs.known,
            graphCreated: true
        };
    }
    function layoutNumberOrNull(value) {
        const n = finiteNumberOrNull(value);
        return n == null ? null : n;
    }
    function plantSpacingDefaults(plant) {
        const fallback = layoutNumberOrNull(plant?.spacing_cm) ?? 30;
        return {
            spacingCm: fallback,
            spacingXCm: layoutNumberOrNull(plant?.spacing_x_cm) ?? fallback,
            spacingYCm: layoutNumberOrNull(plant?.spacing_y_cm) ?? fallback,
            vegDiameterCm: layoutNumberOrNull(plant?.veg_diameter_cm),
            vegHeightCm: layoutNumberOrNull(plant?.veg_height_cm)
        };
    }
    function companionLayoutDefaultsForRelationship(relationship) {
        return {
            template: normalizeCompanionLayoutTemplate(relationship?.layoutTemplate) || 'beside',
            spacingXCm: layoutNumberOrNull(relationship?.layoutSpacingXCm),
            spacingYCm: layoutNumberOrNull(relationship?.layoutSpacingYCm),
            offsetXCm: layoutNumberOrNull(relationship?.layoutOffsetXCm),
            offsetYCm: layoutNumberOrNull(relationship?.layoutOffsetYCm)
        };
    }
    function resolveCompanionLayout(sourceCell, targetPlant, relationship, overrides = {}) {
        const targetSpacing = plantSpacingDefaults(targetPlant);
        const relLayout = companionLayoutDefaultsForRelationship(relationship);
        const template = normalizeCompanionLayoutTemplate(overrides.template) || relLayout.template;
        const spacingXCm = layoutNumberOrNull(overrides.spacingXCm) ?? relLayout.spacingXCm ?? targetSpacing.spacingXCm;
        const spacingYCm = layoutNumberOrNull(overrides.spacingYCm) ?? relLayout.spacingYCm ?? targetSpacing.spacingYCm;
        const sourceSpacingX = layoutNumberOrNull(sourceCell?.getAttribute?.('spacing_x_cm')) ?? layoutNumberOrNull(sourceCell?.getAttribute?.('spacing_cm')) ?? 30;
        const sourceSpacingY = layoutNumberOrNull(sourceCell?.getAttribute?.('spacing_y_cm')) ?? layoutNumberOrNull(sourceCell?.getAttribute?.('spacing_cm')) ?? 30;
        const sourceGeo = sourceCell?.getGeometry?.();
        const pxPerCm = 5 * 0.18; // ADDED: matches Plant_Tiler.js toPx without coupling to private helpers.
        const sourceWidthCm = sourceGeo ? Math.max(0, Number(sourceGeo.width || 0)) / pxPerCm : sourceSpacingX;
        const defaultOffset = template === 'interplant'
            ? { x: sourceSpacingX / 2, y: 0 }
            : (template === 'staggered' ? { x: sourceSpacingX / 2, y: sourceSpacingY / 2 } : { x: sourceWidthCm + Math.max(sourceSpacingX, spacingXCm), y: 0 });
        const offsetXCm = layoutNumberOrNull(overrides.offsetXCm) ?? relLayout.offsetXCm ?? defaultOffset.x;
        const offsetYCm = layoutNumberOrNull(overrides.offsetYCm) ?? relLayout.offsetYCm ?? defaultOffset.y;
        return { template, spacingXCm, spacingYCm, offsetXCm, offsetYCm, vegDiameterCm: targetSpacing.vegDiameterCm, vegHeightCm: targetSpacing.vegHeightCm };
    }
    function companionLayoutAttributePatch(layout) {
        const patch = {
            companion_layout_template: layout.template || '',
            companion_offset_x_cm: layout.offsetXCm == null ? '' : String(layout.offsetXCm),
            companion_offset_y_cm: layout.offsetYCm == null ? '' : String(layout.offsetYCm),
            companion_layout_spacing_x_cm: layout.spacingXCm == null ? '' : String(layout.spacingXCm),
            companion_layout_spacing_y_cm: layout.spacingYCm == null ? '' : String(layout.spacingYCm)
        };
        if (layout.spacingXCm != null) patch.spacing_x_cm = String(layout.spacingXCm);
        if (layout.spacingYCm != null) patch.spacing_y_cm = String(layout.spacingYCm);
        if (layout.vegDiameterCm != null) patch.veg_diameter_cm = String(layout.vegDiameterCm);
        if (layout.vegHeightCm != null) patch.veg_height_cm = String(layout.vegHeightCm);
        return patch;
    }
    function plantingLayoutAttributePatch(layout) { // ADDED: persist current layout rows independently of reusable defaults.
        const patch = {};
        if (layout?.spacingXCm != null) patch.spacing_x_cm = String(layout.spacingXCm);
        if (layout?.spacingYCm != null) patch.spacing_y_cm = String(layout.spacingYCm);
        if (layout?.spacingXCm != null && layout?.spacingYCm != null && layout.spacingXCm === layout.spacingYCm) patch.spacing_cm = String(layout.spacingXCm);
        if (layout?.vegDiameterCm != null) patch.veg_diameter_cm = String(layout.vegDiameterCm);
        if (layout?.vegHeightCm != null) patch.veg_height_cm = String(layout.vegHeightCm);
        if (layout?.offsetXCm != null) patch.layout_offset_x_cm = String(layout.offsetXCm);
        if (layout?.offsetYCm != null) patch.layout_offset_y_cm = String(layout.offsetYCm);
        if (layout?.companionLegacy === true) Object.assign(patch, companionLayoutAttributePatch(layout)); // CHANGE: ordinary planting layout patches never write companion metadata.
        return patch;
    }
    function graphRectForCell(cell) {
        const geo = cell?.getGeometry?.();
        if (!geo) return null;
        const model = graph && typeof graph.getModel === 'function' ? graph.getModel() : null;
        let x = Number(geo.x || 0), y = Number(geo.y || 0);
        for (let cur = model?.getParent?.(cell); cur; cur = model.getParent(cur)) {
            const pg = cur?.getGeometry?.();
            if (pg) { x += Number(pg.x || 0); y += Number(pg.y || 0); }
        }
        return { x, y, width: Number(geo.width || 0), height: Number(geo.height || 0) };
    }
    function graphCellById(activeGraph, id) {
        const model = activeGraph && typeof activeGraph.getModel === 'function' ? activeGraph.getModel() : null;
        const cellId = String(id || '').trim();
        return cellId && model && typeof model.getCell === 'function' ? model.getCell(cellId) : null;
    }
    function absoluteParentOffsetForCell(activeGraph, cell) {
        const model = activeGraph && typeof activeGraph.getModel === 'function' ? activeGraph.getModel() : null;
        let x = 0, y = 0;
        for (let cur = model?.getParent?.(cell); cur; cur = model.getParent(cur)) {
            const geo = cur?.getGeometry?.();
            if (geo) { x += Number(geo.x || 0); y += Number(geo.y || 0); }
        }
        return { x, y };
    }
    function setCellAbsoluteRect(activeGraph, cell, rect, model = null) {
        const geo = cell?.getGeometry?.();
        if (!geo || !rect) return false;
        const parentOffset = absoluteParentOffsetForCell(activeGraph, cell);
        const nextGeo = geo.clone ? geo.clone() : Object.assign({}, geo);
        nextGeo.x = Number(rect.x || 0) - parentOffset.x;
        nextGeo.y = Number(rect.y || 0) - parentOffset.y;
        nextGeo.width = Number(rect.width || geo.width || 0);
        nextGeo.height = Number(rect.height || geo.height || 0);
        if (model && typeof model.setGeometry === 'function') model.setGeometry(cell, nextGeo);
        else if (cell.setGeometry) cell.setGeometry(nextGeo);
        else cell.geometry = nextGeo;
        return true;
    }
    function cellPlantId(cell) {
        return finiteNumberOrNull(cell?.getAttribute?.('plant_id') ?? cell?.getAttribute?.('derived_target_plant_id'));
    }
    function cellLayoutLabel(cell) {
        const plant = String(cell?.getAttribute?.('plant_name') || cell?.getAttribute?.('crop_name') || '').trim();
        const label = String(cell?.getAttribute?.('label') || cell?.id || '').trim();
        return plant || label || 'Planting';
    }
    function companionSourceGroupId(cell) {
        return String(cell?.getAttribute?.('derived_mode') || '').trim().toLowerCase() === 'companion'
            ? String(cell?.getAttribute?.('derived_source_group_id') || '').trim()
            : '';
    }
    function resolveCompanionLayoutAnchorCell(activeGraph, selectedCell) {
        const sourceId = companionSourceGroupId(selectedCell);
        const sourceCell = sourceId ? graphCellById(activeGraph, sourceId) : null;
        return sourceCell && isTilerGroup(sourceCell) ? sourceCell : selectedCell;
    }
    function companionLayoutClusterForSelection(activeGraph, selectedCell) {
        const model = activeGraph && typeof activeGraph.getModel === 'function' ? activeGraph.getModel() : null;
        const root = resolveCompanionLayoutAnchorCell(activeGraph, selectedCell);
        if (!model || !root || !isTilerGroup(root)) return { root: null, members: [], bed: null };
        const bed = findContainingBedForScheduleCell(root);
        const bedId = String(bed?.id || '');
        const parent = model.getParent(root);
        const siblings = parent && activeGraph && typeof activeGraph.getChildVertices === 'function' ? activeGraph.getChildVertices(parent) : [];
        const companions = (siblings || []).filter(candidate => {
            if (!candidate || candidate === root || !isTilerGroup(candidate)) return false;
            if (companionSourceGroupId(candidate) !== String(root.id || '')) return false;
            if (!bed) return true;
            return String(findContainingBedForScheduleCell(candidate)?.id || '') === bedId;
        });
        return { root, members: [root].concat(companions), bed };
    }
    function selectCompanionLayoutAnchorFromSet(cells, savedDefault, fallbackAnchor) {
        const savedAnchorPlantId = finiteNumberOrNull(savedDefault?.anchorPlantId);
        if (savedAnchorPlantId == null) return fallbackAnchor || cells?.[0] || null;
        return (cells || []).find(candidate => cellPlantId(candidate) === savedAnchorPlantId) || fallbackAnchor || cells?.[0] || null;
    }
    function collectLinkedCompanionLayoutCells(activeGraph, selectedCell, savedDefault = null) {
        const cluster = companionLayoutClusterForSelection(activeGraph, selectedCell);
        const anchor = selectCompanionLayoutAnchorFromSet(cluster.members, savedDefault, cluster.root);
        const companions = (cluster.members || []).filter(candidate => candidate && candidate !== anchor);
        return { anchor, companions, bed: cluster.bed, members: cluster.members, root: cluster.root };
    }
    function clampPreviewCircleAxis(value, min, max) {
        if (max < min) return min + (max - min) / 2;
        return Math.max(min, Math.min(max, value));
    }
    function computePreviewPlantCircles(groupRect, spacingXCm, spacingYCm, opts = {}) {
        const pxPerCm = 5 * 0.18;
        const spacingX = Math.max(1, (layoutNumberOrNull(spacingXCm) ?? 30) * pxPerCm);
        const spacingY = Math.max(1, (layoutNumberOrNull(spacingYCm) ?? 30) * pxPerCm);
        const maxCircles = Math.max(1, Math.trunc(layoutNumberOrNull(opts.maxCircles) ?? 5000));
        const vegDiameterPx = (layoutNumberOrNull(opts.vegDiameterCm) ?? 0) * pxPerCm;
        const radius = vegDiameterPx > 0 ? Math.max(2.4, vegDiameterPx / 2) : Math.max(2.4, Math.min(spacingX, spacingY) * 0.32);
        const cols = Math.max(1, Math.floor(Math.max(1, groupRect.width) / spacingX));
        const rows = Math.max(1, Math.floor(Math.max(1, groupRect.height) / spacingY));
        const total = rows * cols;
        const count = Math.min(total, maxCircles);
        const circles = [];
        const originX = layoutNumberOrNull(opts.originX) ?? groupRect.x;
        const originY = layoutNumberOrNull(opts.originY) ?? groupRect.y;
        const bounds = opts.clampRect || groupRect;
        const minX = Number(bounds.x || 0) + radius;
        const minY = Number(bounds.y || 0) + radius;
        const maxX = Number(bounds.x || 0) + Math.max(0, Number(bounds.width || 0)) - radius;
        const maxY = Number(bounds.y || 0) + Math.max(0, Number(bounds.height || 0)) - radius;
        let clamped = false;
        for (let i = 0; i < count; i++) {
            const r = Math.floor(i / cols);
            const c = i % cols;
            const rawX = originX + spacingX / 2 + c * spacingX;
            const rawY = originY + spacingY / 2 + r * spacingY;
            const x = clampPreviewCircleAxis(rawX, minX, maxX);
            const y = clampPreviewCircleAxis(rawY, minY, maxY);
            if (Math.abs(x - rawX) > 0.01 || Math.abs(y - rawY) > 0.01) clamped = true;
            circles.push({
                x,
                y,
                row: r,
                col: c,
                r: radius
            });
        }
        return { circles, total, summarized: total > count, clamped };
    }
    function buildLayoutPreviewModel({ bedRect = null, sourceRect = null, layout = null, sourceSpacing = null, companionLabel = 'Companion', sourceLabel = 'Source', requireRealBed = false, showCompanion = true } = {}) {
        if (!bedRect && requireRealBed) return { status: 'no-bed', message: 'No containing garden bed for this planting.' };
        const pxPerCm = 5 * 0.18;
        const bed = bedRect || { x: 0, y: 0, width: 420, height: 180, generic: true };
        const source = sourceRect || { x: bed.x + bed.width * 0.15, y: bed.y + bed.height * 0.2, width: bed.width * 0.34, height: bed.height * 0.55 };
        const offsetX = (layoutNumberOrNull(layout?.offsetXCm) ?? 0) * pxPerCm;
        const offsetY = (layoutNumberOrNull(layout?.offsetYCm) ?? 0) * pxPerCm;
        const rawCompanion = showCompanion ? { x: source.x, y: source.y, width: source.width, height: source.height } : null;
        const companion = rawCompanion ? { ...rawCompanion } : null;
        let clamped = false;
        if (companion) {
            const minX = bed.x, minY = bed.y;
            const maxX = bed.x + Math.max(0, bed.width - companion.width);
            const maxY = bed.y + Math.max(0, bed.height - companion.height);
            const nextX = Math.max(minX, Math.min(maxX, companion.x));
            const nextY = Math.max(minY, Math.min(maxY, companion.y));
            if (Math.abs(nextX - companion.x) > 0.01 || Math.abs(nextY - companion.y) > 0.01) clamped = true;
            companion.x = nextX; companion.y = nextY;
        }
        const sourceCircles = computePreviewPlantCircles(source, sourceSpacing?.spacingXCm ?? 30, sourceSpacing?.spacingYCm ?? 30, { vegDiameterCm: sourceSpacing?.vegDiameterCm });
        const companionCircles = companion ? computePreviewPlantCircles(companion, layout?.spacingXCm ?? 30, layout?.spacingYCm ?? 30, { vegDiameterCm: layout?.vegDiameterCm, originX: bed.x + offsetX, originY: bed.y + offsetY, clampRect: bed }) : { circles: [], total: 0, summarized: false };
        clamped = clamped || !!companionCircles.clamped;
        return { status: 'ok', bed, source, companion, sourceLabel, companionLabel, layout: layout || {}, sourceCircles, companionCircles, clamped, warning: clamped ? 'Preview placement is clamped inside the bed.' : '' };
    }
    function bedRelativeRectForLayoutRow(row, fallbackRect, bedRect) { // ADDED: preview and save share bed-relative offset semantics.
        const pxPerCm = 5 * 0.18;
        const fallback = fallbackRect || { x: bedRect?.x || 0, y: bedRect?.y || 0, width: 120, height: 80 };
        const offsetX = layoutNumberOrNull(row?.offsetXCm);
        const offsetY = layoutNumberOrNull(row?.offsetYCm);
        return {
            x: offsetX == null || !bedRect ? fallback.x : bedRect.x + offsetX * pxPerCm,
            y: offsetY == null || !bedRect ? fallback.y : bedRect.y + offsetY * pxPerCm,
            width: Number(fallback.width || 0),
            height: Number(fallback.height || 0)
        };
    }
    function clampRectInsideRect(rect, bounds) {
        const next = Object.assign({}, rect || {});
        const width = Math.max(0, Number(next.width || 0));
        const height = Math.max(0, Number(next.height || 0));
        const minX = Number(bounds?.x || 0);
        const minY = Number(bounds?.y || 0);
        const maxX = minX + Math.max(0, Number(bounds?.width || 0) - width);
        const maxY = minY + Math.max(0, Number(bounds?.height || 0) - height);
        const rawX = Number(next.x || 0);
        const rawY = Number(next.y || 0);
        next.x = Math.max(minX, Math.min(maxX, rawX));
        next.y = Math.max(minY, Math.min(maxY, rawY));
        next.width = width;
        next.height = height;
        next.clamped = Math.abs(next.x - rawX) > 0.01 || Math.abs(next.y - rawY) > 0.01;
        return next;
    }
    function computeActiveCompanionPlacement(anchorRect, companionRect, bedRect, row = {}, anchorSpacing = {}) {
        const pxPerCm = 5 * 0.18;
        const anchor = anchorRect || { x: 0, y: 0, width: 120, height: 80 };
        const companion = companionRect || { x: anchor.x, y: anchor.y, width: anchor.width, height: anchor.height };
        const template = normalizeCompanionLayoutTemplate(row.template) || 'beside';
        const offsetX = (layoutNumberOrNull(row.offsetXCm) ?? 0) * pxPerCm;
        const offsetY = (layoutNumberOrNull(row.offsetYCm) ?? 0) * pxPerCm;
        const anchorSpacingX = layoutNumberOrNull(anchorSpacing.spacingXCm) ?? 30;
        const anchorSpacingY = layoutNumberOrNull(anchorSpacing.spacingYCm) ?? 30;
        const rowSpacingX = layoutNumberOrNull(row.spacingXCm) ?? anchorSpacingX;
        let raw;
        if (template === 'interplant') {
            raw = { x: anchor.x + offsetX, y: anchor.y + offsetY, width: anchor.width, height: anchor.height };
        } else if (template === 'staggered') {
            raw = { x: anchor.x + anchorSpacingX * pxPerCm / 2 + offsetX, y: anchor.y + anchorSpacingY * pxPerCm / 2 + offsetY, width: companion.width, height: companion.height };
        } else {
            raw = { x: anchor.x + anchor.width + Math.max(anchorSpacingX, rowSpacingX) * pxPerCm + offsetX, y: anchor.y + offsetY, width: companion.width, height: companion.height };
        }
        const placed = bedRect ? clampRectInsideRect(raw, bedRect) : Object.assign({ clamped: false }, raw);
        return Object.assign(placed, { template, rawX: raw.x, rawY: raw.y, interplant: template === 'interplant' });
    }
    function previewGridOriginForLayoutRow(bedRect, row, rect) {
        const pxPerCm = 5 * 0.18;
        const offsetX = layoutNumberOrNull(row?.offsetXCm);
        const offsetY = layoutNumberOrNull(row?.offsetYCm);
        return {
            x: offsetX == null || !bedRect ? rect.x : bedRect.x + offsetX * pxPerCm,
            y: offsetY == null || !bedRect ? rect.y : bedRect.y + offsetY * pxPerCm
        };
    }
    function computePreviewCirclesForLayoutRow(rect, row, anchorSpacing = {}, bedRect = null) {
        const spacingX = layoutNumberOrNull(row?.spacingXCm) ?? 30;
        const spacingY = layoutNumberOrNull(row?.spacingYCm) ?? 30;
        const origin = previewGridOriginForLayoutRow(bedRect, row, rect);
        const dots = computePreviewPlantCircles(rect, spacingX, spacingY, { maxCircles: 5000, vegDiameterCm: row?.vegDiameterCm, originX: origin.x, originY: origin.y, clampRect: bedRect || rect });
        if (normalizeCompanionLayoutTemplate(row?.template) !== 'interplant') return dots;
        const pxPerCm = 5 * 0.18;
        const dx = (layoutNumberOrNull(anchorSpacing.spacingXCm) ?? spacingX) * pxPerCm / 2;
        const dy = (layoutNumberOrNull(anchorSpacing.spacingYCm) ?? spacingY) * pxPerCm / 2;
        const radius = Math.max(0, Number(dots.circles[0]?.r || 0));
        const bounds = bedRect || rect;
        const minX = Number(bounds.x || 0) + radius;
        const minY = Number(bounds.y || 0) + radius;
        const maxX = Number(bounds.x || 0) + Math.max(0, Number(bounds.width || 0)) - radius;
        const maxY = Number(bounds.y || 0) + Math.max(0, Number(bounds.height || 0)) - radius;
        dots.circles = dots.circles.map(p => {
            const offset = ((Number(p.row) || 0) + (Number(p.col) || 0)) % 2 === 0;
            const rawX = p.x + (offset ? dx : 0);
            const rawY = p.y + (offset ? dy : 0);
            const x = clampPreviewCircleAxis(rawX, minX, maxX);
            const y = clampPreviewCircleAxis(rawY, minY, maxY);
            if (Math.abs(x - rawX) > 0.01 || Math.abs(y - rawY) > 0.01) dots.clamped = true;
            return {
                x,
                y,
                row: p.row,
                col: p.col,
                r: p.r
            };
        });
        return dots;
    }
    function buildCompanionLayoutPreviewModel({ bedRect = null, anchorRow = null, companionRows = [], requireRealBed = true } = {}) {
        if (!bedRect && requireRealBed) return { status: 'no-bed', message: 'No containing garden bed for this companion group.' };
        const bed = bedRect || { x: 0, y: 0, width: 520, height: 240, generic: true };
        const fallbackAnchorRect = anchorRow?.rect || { x: bed.x + bed.width * 0.1, y: bed.y + bed.height * 0.25, width: bed.width * 0.32, height: bed.height * 0.45 };
        const anchorRect = clampRectInsideRect(fallbackAnchorRect, bed);
        const anchorDots = computePreviewCirclesForLayoutRow(anchorRect, anchorRow, {}, bed);
        const anchorWarning = anchorDots.clamped ? 'Clamped inside bed.' : '';
        const anchorSpacing = {
            spacingXCm: layoutNumberOrNull(anchorRow?.spacingXCm) ?? 30,
            spacingYCm: layoutNumberOrNull(anchorRow?.spacingYCm) ?? 30
        };
        const rows = [{
            role: 'anchor',
            label: anchorRow?.label || 'Anchor',
            cellId: anchorRow?.cellId || '',
            plantId: anchorRow?.plantId ?? null,
            rect: anchorRect,
            rawRect: { x: anchorRect.rawX, y: anchorRect.rawY, width: anchorRect.width, height: anchorRect.height },
            dots: anchorDots,
            className: 'usl-layout-preview-source',
            dotClassName: 'usl-layout-preview-source-dot',
            warning: anchorWarning
        }];
        const warnings = anchorWarning ? [`${anchorRow?.label || 'Anchor'}: ${anchorWarning}`] : [];
        (companionRows || []).forEach((row, index) => {
            const currentRect = row?.rect || { x: anchorRect.x, y: anchorRect.y, width: anchorRect.width, height: anchorRect.height };
            const placed = clampRectInsideRect(currentRect, bed);
            const template = normalizeCompanionLayoutTemplate(row?.template) || 'beside';
            placed.template = template;
            placed.rawX = currentRect.x;
            placed.rawY = currentRect.y;
            const dots = computePreviewCirclesForLayoutRow(placed, row, anchorSpacing, bed);
            const warning = (placed.clamped || dots.clamped) ? 'Clamped inside bed.' : '';
            if (warning) warnings.push(`${row?.label || 'Companion'}: ${warning}`);
            rows.push({
                role: 'companion',
                label: row?.label || `Companion ${index + 1}`,
                cellId: row?.cellId || '',
                plantId: row?.plantId ?? null,
                template,
                rect: placed,
                rawRect: { x: placed.rawX, y: placed.rawY, width: placed.width, height: placed.height },
                dots,
                className: `usl-layout-preview-companion usl-layout-preview-companion-${template}`,
                dotClassName: `usl-layout-preview-companion-dot usl-layout-preview-companion-dot-${template}`,
                warning
            });
        });
        const summarized = rows.some(row => row.dots?.summarized);
        return { status: 'ok', mode: 'multi-companion', bed, rows, warning: [warnings.join(' '), summarized ? 'Dense layout summarized.' : ''].filter(Boolean).join(' ') };
    }
    function renderLayoutPreviewSvg(container, model) {
        if (!container) return;
        container.innerHTML = '';
        if (!model || model.status !== 'ok') {
            const empty = document.createElement('div');
            empty.className = 'usl-layout-preview-empty';
            empty.textContent = model?.message || 'No layout preview available.';
            container.appendChild(empty);
            return;
        }
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const pad = 16;
        const viewX = model.bed.x - pad, viewY = model.bed.y - pad;
        svg.setAttribute('viewBox', `${viewX} ${viewY} ${model.bed.width + pad * 2} ${model.bed.height + pad * 2}`);
        svg.setAttribute('class', 'usl-layout-preview-svg');
        function rect(r, cls) {
            const el = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            el.setAttribute('x', r.x); el.setAttribute('y', r.y); el.setAttribute('width', r.width); el.setAttribute('height', r.height);
            el.setAttribute('class', cls);
            svg.appendChild(el);
            return el;
        }
        function text(x, y, value, cls) {
            const el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            el.setAttribute('x', x); el.setAttribute('y', y); el.setAttribute('class', cls); el.textContent = value;
            svg.appendChild(el);
        }
        if (model.mode === 'multi-companion') {
            rect(model.bed, 'usl-layout-preview-bed');
            (model.rows || []).forEach(row => {
                rect(row.rect, row.className || 'usl-layout-preview-companion');
            });
            (model.rows || []).forEach(row => {
                (row.dots?.circles || []).forEach(p => { const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); c.setAttribute('cx', p.x); c.setAttribute('cy', p.y); c.setAttribute('r', p.r || (row.role === 'anchor' ? 2.6 : 2.35)); c.setAttribute('class', row.dotClassName || 'usl-layout-preview-companion-dot'); svg.appendChild(c); });
            });
            (model.rows || []).forEach(row => text(row.rect.x + 4, row.rect.y + 12, row.label || '', 'usl-layout-preview-label'));
            if (model.warning) text(model.bed.x + 4, model.bed.y + model.bed.height - 6, model.warning, 'usl-layout-preview-warning');
            container.appendChild(svg);
            return;
        }
        rect(model.bed, 'usl-layout-preview-bed');
        rect(model.source, 'usl-layout-preview-source');
        if (model.companion) rect(model.companion, 'usl-layout-preview-companion');
        (model.sourceCircles.circles || []).forEach(p => { const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); c.setAttribute('cx', p.x); c.setAttribute('cy', p.y); c.setAttribute('r', p.r || 2.6); c.setAttribute('class', 'usl-layout-preview-source-dot'); svg.appendChild(c); });
        (model.companionCircles.circles || []).forEach(p => { const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); c.setAttribute('cx', p.x); c.setAttribute('cy', p.y); c.setAttribute('r', p.r || 2.4); c.setAttribute('class', 'usl-layout-preview-companion-dot'); svg.appendChild(c); });
        text(model.source.x + 4, model.source.y + 12, model.sourceLabel, 'usl-layout-preview-label');
        if (model.companion) text(model.companion.x + 4, model.companion.y + 12, model.companionLabel, 'usl-layout-preview-label');
        if (model.warning || model.sourceCircles.summarized || model.companionCircles.summarized) {
            text(model.bed.x + 4, model.bed.y + model.bed.height - 6, [model.warning, model.sourceCircles.summarized || model.companionCircles.summarized ? 'Dense layout summarized.' : ''].filter(Boolean).join(' '), 'usl-layout-preview-warning');
        }
        container.appendChild(svg);
    }
    // --- helpers: find garden module ancestor & scoped board lookup ---
    function isGardenModule(cell) {
        return !!(cell && cell.getAttribute && cell.getAttribute('garden_module') === '1');
    }
    function findGardenModuleAncestor(model, cell) {
        if (!cell) return null;
        const m = model;
        let cur = cell;
        while (cur) {
            if (isGardenModule(cur)) return cur;
            cur = m.getParent(cur);
        }
        return null;
    }
    function defaultGroupStyle() {
        return [
            'shape=rectangle', 'strokeColor=#2563eb', 'dashed=1', 'fillColor=none',
            'dashPattern=3 3', 'fontSize=12', 'align=center', 'verticalAlign=top',
            'resizable=1', 'movable=1', 'deletable=1', 'editable=0', 'whiteSpace=nowrap', 'html=0'
        ].join(';');
    }
    function createXmlValue(tag, attrs) {
        const doc = mxUtils.createXmlDocument();
        const node = doc.createElement(tag);
        Object.keys(attrs || {}).forEach(k => node.setAttribute(k, String(attrs[k])));
        return node;
    }
    function applyPlantSpacingToGroup(groupCell, plantRow) {
        if (!groupCell || !plantRow) return;

        const sx = plantRow.spacing_x_cm;
        const sy = plantRow.spacing_y_cm;
        const s = plantRow.spacing_cm;
        const vd = plantRow.veg_diameter_cm;
        const vh = plantRow.veg_height_cm;

        const hasVal = (v) => v !== undefined && v !== null && v !== '';

        // Derive canonical spacing X/Y: prefer explicit x/y, fall back to spacing_cm    
        let spacingX = hasVal(sx) ? sx : (hasVal(s) ? s : null);
        let spacingY = hasVal(sy) ? sy : (hasVal(s) ? s : null);

        if (hasVal(spacingX)) {
            setAttr(groupCell, 'spacing_x_cm', spacingX);
        }
        if (hasVal(spacingY)) {
            setAttr(groupCell, 'spacing_y_cm', spacingY);
        }
        if (hasVal(s)) {
            setAttr(groupCell, 'spacing_cm', s);
        }

        if (hasVal(vd)) {
            setAttr(groupCell, 'veg_diameter_cm', vd);
        }
        if (hasVal(vh)) {
            setAttr(groupCell, 'veg_height_cm', vh);
        }
    }

    function retileAndFitGroupIfAvailable(graph, groupCell, opts = {}) {
        const tiler = window.USL && window.USL.tiler ? window.USL.tiler : null;
        const fit = tiler && typeof tiler.retileAndFitToContainingBed === 'function' ? tiler.retileAndFitToContainingBed : null;
        if (fit) return fit(graph, groupCell, opts);
        const retile = tiler && typeof tiler.retileGroup === 'function' ? tiler.retileGroup : null;
        if (retile) retile(graph, groupCell);
        return null;
    }

    function requestSelectionVisualsRefresh(graph, cell) {
        if (!graph || typeof graph.fireEvent !== 'function') return;
        try { graph.fireEvent(new mxEventObject('trellisSelectionVisualsRefresh', 'cell', cell)); } catch (_) { }
    }






































































    // -------------------- UI bits (small DOM helpers) --------------------------------------
    function row(labelText, controlEl) {
        const wrap = document.createElement('div');
        wrap.className = 'usl-scheduler-row';
        wrap.style.display = 'flex';
        wrap.style.alignItems = 'center';
        wrap.style.gap = '8px';
        wrap.style.margin = '6px 0';
        const lab = document.createElement('label');
        lab.className = 'usl-scheduler-row-label';
        lab.textContent = labelText;
        lab.style.display = 'inline-block';
        lab.style.minWidth = '180px';
        wrap.appendChild(lab);
        wrap.appendChild(controlEl);
        return { row: wrap, label: lab, control: controlEl };
    }
    function makeSelect(options, initialValue) {
        const sel = document.createElement('select');
        sel.style.width = '100%'; sel.style.padding = '6px';
        options.forEach(o => {
            const opt = document.createElement('option');
            opt.value = o.value; opt.textContent = o.label;
            sel.appendChild(opt);
        });
        if (initialValue != null) sel.value = String(initialValue);
        return sel;
    }
    function normalizeCityGeoText(value) {
        return String(value == null ? '' : value).trim();
    }
    function cityCountryLabel(city) {
        return normalizeCityGeoText(city?.country_name) || normalizeCityGeoText(city?.country_code) || 'Uncategorized';
    }
    function cityRegionLabel(city) {
        const name = normalizeCityGeoText(city?.region_name);
        const code = normalizeCityGeoText(city?.region_code);
        if (name && code && name.toLowerCase() !== code.toLowerCase()) return `${name} (${code})`;
        return name || code || 'Uncategorized';
    }
    function cityDisplayLabel(city) {
        return normalizeCityGeoText(city?.city_name) || '(unnamed city)';
    }
    function citySearchText(city) {
        return [cityDisplayLabel(city), cityCountryLabel(city), cityRegionLabel(city), normalizeCityGeoText(city?.country_code), normalizeCityGeoText(city?.region_code)].join(' ').toLowerCase();
    }
    function sortedCities(cities) {
        return (cities || []).slice().sort((a, b) => {
            const av = [cityCountryLabel(a), cityRegionLabel(a), cityDisplayLabel(a)].join('\u0000').toLowerCase();
            const bv = [cityCountryLabel(b), cityRegionLabel(b), cityDisplayLabel(b)].join('\u0000').toLowerCase();
            return av.localeCompare(bv);
        });
    }
    function makeCityTreePicker(cities, initialValue) {
        let cityRows = sortedCities(cities);
        let currentValue = String(initialValue || (cityRows[0]?.city_id ?? cityRows[0]?.city_name ?? ''));
        let isOpen = false;
        const root = document.createElement('div');
        root.className = 'usl-city-picker';
        root.tabIndex = 0;
        root.style.position = 'relative';
        root.style.width = '100%';
        root.style.font = '12px Arial,sans-serif';
        const button = document.createElement('button');
        button.type = 'button';
        button.style.width = '100%';
        button.style.padding = '6px';
        button.style.border = '1px solid #bbb';
        button.style.borderRadius = '6px';
        button.style.background = '#fff';
        button.style.textAlign = 'left';
        button.style.font = '12px Arial,sans-serif';
        const panel = document.createElement('div');
        panel.style.position = 'absolute';
        panel.style.zIndex = '10000';
        panel.style.left = '0';
        panel.style.right = '0';
        panel.style.top = '100%';
        panel.style.marginTop = '3px';
        panel.style.padding = '6px';
        panel.style.border = '1px solid #bbb';
        panel.style.borderRadius = '6px';
        panel.style.background = '#fff';
        panel.style.boxShadow = '0 8px 20px rgba(0,0,0,0.18)';
        panel.style.display = 'none';
        const search = document.createElement('input');
        search.type = 'search';
        search.placeholder = 'Search city, country, or region';
        search.style.width = '100%';
        search.style.marginBottom = '6px';
        const list = document.createElement('div');
        list.style.maxHeight = '260px';
        list.style.overflow = 'auto';
        panel.appendChild(search);
        panel.appendChild(list);
        root.appendChild(button);
        root.appendChild(panel);

        function selectedCity() {
            return cityRows.find(city => String(city.city_id ?? city.city_name) === currentValue) || null;
        }
        function updateButton() {
            const city = selectedCity();
            button.textContent = city ? `${cityDisplayLabel(city)} - ${cityCountryLabel(city)} / ${cityRegionLabel(city)}` : 'Select a city...';
        }
        function closePicker() {
            isOpen = false;
            panel.style.display = 'none';
        }
        function openPicker() {
            isOpen = true;
            panel.style.display = 'block';
            renderList();
            search.focus();
        }
        function chooseCity(city) {
            currentValue = String(city.city_id ?? city.city_name);
            updateButton();
            closePicker();
            root.dispatchEvent(new Event('change', { bubbles: true }));
        }
        function appendGroupHeader(text, level) {
            const header = document.createElement('div');
            header.textContent = text;
            header.style.fontWeight = level === 1 ? '700' : '600';
            header.style.margin = level === 1 ? '8px 0 3px' : '5px 0 2px 12px';
            header.style.color = '#374151';
            list.appendChild(header);
        }
        function appendCity(city) {
            const item = document.createElement('button');
            item.type = 'button';
            item.textContent = cityDisplayLabel(city);
            item.style.display = 'block';
            item.style.width = '100%';
            item.style.margin = '1px 0';
            item.style.padding = '4px 6px 4px 24px';
            item.style.border = '0';
            item.style.borderRadius = '4px';
            item.style.background = String(city.city_id ?? city.city_name) === currentValue ? '#e5f0ff' : '#fff';
            item.style.textAlign = 'left';
            item.style.font = '12px Arial,sans-serif';
            item.addEventListener('click', () => chooseCity(city));
            list.appendChild(item);
        }
        function renderList() {
            const filter = String(search.value || '').trim().toLowerCase();
            const visible = cityRows.filter(city => !filter || citySearchText(city).indexOf(filter) >= 0);
            list.innerHTML = '';
            if (!visible.length) {
                const empty = document.createElement('div');
                empty.textContent = 'No matching cities';
                empty.style.color = '#6b7280';
                empty.style.padding = '6px';
                list.appendChild(empty);
                return;
            }
            let lastCountry = null;
            let lastRegion = null;
            visible.forEach(city => {
                const country = cityCountryLabel(city);
                const region = cityRegionLabel(city);
                if (country !== lastCountry) {
                    appendGroupHeader(country, 1);
                    lastCountry = country;
                    lastRegion = null;
                }
                if (region !== lastRegion) {
                    appendGroupHeader(region, 2);
                    lastRegion = region;
                }
                appendCity(city);
            });
        }
        Object.defineProperty(root, 'value', {
            get() { return currentValue; },
            set(value) { currentValue = String(value || ''); updateButton(); }
        });
        root.setCities = function (nextCities, selectedValue) {
            cityRows = sortedCities(nextCities);
            currentValue = String(selectedValue || (cityRows[0]?.city_id ?? cityRows[0]?.city_name ?? ''));
            updateButton();
            renderList();
        };
        button.addEventListener('click', () => { isOpen ? closePicker() : openPicker(); });
        search.addEventListener('input', renderList);
        search.addEventListener('keydown', evt => {
            if (evt.key === 'Escape') { evt.preventDefault(); closePicker(); button.focus(); }
            if (evt.key === 'Enter') {
                const first = cityRows.find(city => !search.value || citySearchText(city).indexOf(String(search.value).trim().toLowerCase()) >= 0);
                if (first) { evt.preventDefault(); chooseCity(first); }
            }
        });
        document.addEventListener('mousedown', evt => { if (isOpen && !root.contains(evt.target)) closePicker(); });
        updateButton();
        renderList();
        return root;
    }
    function makeNumber(initial, { min = null } = {}) {
        const el = document.createElement('input'); el.type = 'number';
        el.value = String(initial ?? 0); if (min != null) el.min = String(min);
        return el;
    }
    function makeCheckbox(initialChecked, disabled = false) {
        const el = document.createElement('input'); el.type = 'checkbox';
        el.checked = !!initialChecked; el.disabled = !!disabled;
        return el;
    }
    function makeDate(valueISO, disabled = true) {
        const el = document.createElement('input'); el.type = 'date';
        el.value = valueISO; el.disabled = !!disabled;
        return el;
    }

    function makeNullableNumber(initial, { min = null, step = null } = {}) {
        const el = document.createElement('input');
        el.type = 'number';
        el.value = (initial == null || initial === '') ? '' : String(initial);
        if (min != null) el.min = String(min);
        if (step != null) el.step = String(step);
        el.style.width = '100%'; el.style.padding = '6px';
        return el;
    }

    function readNullableNumber(inputEl) {
        const s = String(inputEl?.value ?? '').trim();
        if (s === '') return null;
        const n = Number(s);
        if (!Number.isFinite(n)) throw new Error('Invalid number');
        return n;
    }

    function readIntGE0(inputEl) {
        const n = Number(String(inputEl?.value ?? '').trim());
        if (!Number.isFinite(n) || n < 0) throw new Error('Expected integer >= 0');
        return Math.trunc(n);
    }

    function readOptionalIntGE1(inputEl) {
        const s = String(inputEl?.value ?? '').trim();
        if (s === '') return null;
        const n = Number(s);
        if (!Number.isFinite(n) || n < 1) throw new Error('Expected integer >= 1');
        return Math.trunc(n);
    }

    function readNumGE0(inputEl) {
        const n = Number(String(inputEl?.value ?? '').trim());
        if (!Number.isFinite(n) || n < 0) throw new Error('Expected number >= 0');
        return n;
    }


    // -------------------- View helpers (schema → rows, layout) --------------------------  
    function buildFieldRows(schema, rowFactory = row) {
        const fieldRows = {};
        const ordered = [];
        schema.forEach(def => {
            const r = rowFactory(def.label, def.control);
            if (def.tooltip) { setTooltip(r.label, def.tooltip); setTooltip(def.control, def.tooltip); }
            fieldRows[def.key] = r;
            ordered.push({ key: def.key, row: r.row, meta: def, view: r });
        });
        return { fieldRows, ordered };
    }

    function appendFieldRows(container, fieldRows, keys) {
        keys.forEach(k => {
            const fr = fieldRows[k];
            if (fr && fr.row) container.appendChild(fr.row);
        });
    }

    function encodeMethodSelection(methodCategoryId, methodId) {
        return JSON.stringify([normId(methodCategoryId), normId(methodId)]);
    }

    function decodeMethodSelection(value) {
        try {
            const parsed = JSON.parse(String(value || ''));
            if (!Array.isArray(parsed) || parsed.length !== 2) return null;
            const methodCategoryId = normId(parsed[0]);
            const methodId = normId(parsed[1]);
            if (!methodCategoryId || !methodId) return null;
            return { methodCategoryId, methodId };
        } catch (_) {
            return null;
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

    function normalizeSowingSeason(window) {
        if (!window) return null;
        const startISO = String(window.startISO || '').trim();
        const endISO = String(window.endISO || '').trim();
        if (!parseISODateUTCValue(startISO) || !parseISODateUTCValue(endISO)) return null;
        return {
            id: String(window.id || '').trim() || `${startISO}_${endISO}`,
            label: String(window.label || '').trim() || `${startISO} to ${endISO}`,
            startISO,
            endISO,
            diagnostics: Array.isArray(window.diagnostics) ? window.diagnostics.slice() : [],
            riskSummary: String(window.riskSummary || '').trim(),
            source: window.source || null
        };
    }
    function normalizeSowingSeasons(windows) {
        return (Array.isArray(windows) ? windows : []).map(normalizeSowingSeason).filter(Boolean);
    }
    function getActiveSowingSeason(formState) {
        const windows = normalizeSowingSeasons(formState?.sowingSeasons);
        const activeId = String(formState?.activeSowingSeasonId || '').trim();
        return windows.find(window => window.id === activeId) || null;
    }
    function sowDateInWindow(startISO, window) {
        const selected = parseISODateUTCValue(startISO);
        const earliest = parseISODateUTCValue(window?.startISO);
        const latest = parseISODateUTCValue(window?.endISO);
        return !!(selected && earliest && latest && selected >= earliest && selected <= latest);
    }
    function findSowingSeasonForDate(windows, startISO) {
        return normalizeSowingSeasons(windows).find(window => sowDateInWindow(startISO, window)) || null;
    }
    function formatSowingSeasonsSummary(windows) {
        const normalized = normalizeSowingSeasons(windows);
        if (!normalized.length) return 'No feasible sowing seasons.';
        return normalized.map(window => {
            const risk = window.riskSummary ? ` [${window.riskSummary}]` : '';
            const details = (window.diagnostics || []).slice(0, 6).map(diagnostic => diagnostic?.message).filter(Boolean);
            return `${window.label}: ${window.startISO} to ${window.endISO}${risk}${details.length ? `\n  ${details.join('\n  ')}` : ''}`;
        }).join('\n');
    }
    function buildSowingSeasonSelectorState({
        sowingSeasons = [],
        activeSowingSeasonId = '',
        startISO = ''
    } = {}) {
        const windows = normalizeSowingSeasons(sowingSeasons);
        const options = [];
        if (isOrphanSowingSeasonId(activeSowingSeasonId)) {
            const suffix = startISO ? ` (${startISO})` : '';
            options.push({ value: ORPHAN_SOWING_SEASON_ID, label: `Saved date outside seasons${suffix}`, disabled: true });
        }
        if (!windows.length && !options.length) {
            options.push({ value: '', label: 'No feasible sowing season', disabled: false });
        } else {
            windows.forEach(window => options.push({ value: window.id, label: window.riskSummary ? `${window.label} - ${window.riskSummary}` : window.label, disabled: false }));
        }
        const activeWindow = windows.find(window => window.id === String(activeSowingSeasonId || '').trim()) || null;
        const selectedValue = options.some(option => option.value === activeSowingSeasonId) ? String(activeSowingSeasonId || '') : '';
        return {
            options,
            value: selectedValue,
            activeWindow,
            boundsText: activeWindow ? `${activeWindow.startISO} to ${activeWindow.endISO}` : ''
        };
    }
    function pickDefaultSowingSeasonId(windows, { savedStartISO = '', todayISO = '' } = {}) {
        const normalized = normalizeSowingSeasons(windows);
        if (!normalized.length) return '';
        const savedWindow = findSowingSeasonForDate(normalized, savedStartISO);
        if (savedWindow) return savedWindow.id;
        const today = parseISODateUTCValue(todayISO);
        if (today) {
            const futureWindow = normalized.find(window => {
                const end = parseISODateUTCValue(window.endISO);
                return end && end >= today;
            });
            if (futureWindow) return futureWindow.id;
        }
        return normalized[0].id;
    }
    function resolveStartForSowingSeasonSwitch(windows, activeSowingSeasonId, currentStartISO = '') {
        const activeWindow = normalizeSowingSeasons(windows).find(window => window.id === String(activeSowingSeasonId || '').trim());
        if (activeWindow && sowDateInWindow(currentStartISO, activeWindow)) return String(currentStartISO || '').trim();
        return activeWindow ? activeWindow.startISO : '';
    }
    function classifySelectedSowDate({
        perennial = false,
        windowFeasible = false,
        startISO = '',
        sowingSeasons = [],
        activeSowingSeasonId = ''
    } = {}) {
        if (perennial) return { status: 'not_applicable', label: 'Not applicable for perennial planting dates.' };
        if (!windowFeasible || !normalizeSowingSeasons(sowingSeasons).length) return { status: 'no_window', label: 'No feasible sowing season is available.' };
        const selected = parseISODateUTCValue(startISO);
        if (!selected) return { status: 'missing', label: 'Select a sow date.' };
        if (isOrphanSowingSeasonId(activeSowingSeasonId)) return { status: 'outside_window', label: 'The saved sow date is outside the selectable sowing seasons.' };
        const activeWindow = normalizeSowingSeasons(sowingSeasons).find(window => window.id === String(activeSowingSeasonId || '').trim());
        if (!activeWindow) return { status: 'no_active_window', label: 'Select a sowing season.' };
        if (!sowDateInWindow(startISO, activeWindow)) {
            const otherWindow = findSowingSeasonForDate(sowingSeasons, startISO);
            if (otherWindow) return { status: 'window_mismatch', label: `The selected sow date belongs to ${otherWindow.label}, not ${activeWindow.label}.` };
            return { status: 'outside_window', label: 'The selected sow date is outside the selected sowing season.' };
        }
        return { status: 'feasible', label: `The selected sow date is in ${activeWindow.label}.` };
    }
    function applyDateToExistingSowingWindows(formState, { startISO = '' } = {}) {
        if (!formState || formState.windowFeasible !== true) return { applied: false, reason: 'no feasible cached windows' };
        const windows = normalizeSowingSeasons(formState.sowingSeasons);
        if (!windows.length) return { applied: false, reason: 'missing cached windows' };
        const normalizedStartISO = String(startISO || '').trim();
        if (!parseISODateUTCValue(normalizedStartISO)) return { applied: false, reason: 'invalid selected date' };
        formState.startISO = normalizedStartISO;
        const containingWindow = findSowingSeasonForDate(windows, normalizedStartISO);
        if (containingWindow) formState.activeSowingSeasonId = containingWindow.id;
        return {
            applied: true,
            activeSowingSeasonId: formState.activeSowingSeasonId,
            classification: classifySelectedSowDate({
                perennial: false,
                windowFeasible: formState.windowFeasible,
                startISO: formState.startISO,
                sowingSeasons: formState.sowingSeasons,
                activeSowingSeasonId: formState.activeSowingSeasonId
            })
        };
    }
    function summarizeScheduleWarnings(warnings) {
        const list = Array.isArray(warnings) ? warnings.filter(warning => warning && warning.message) : [];
        if (!list.length) return '';
        return list.map(warning => String(warning.message || '').trim()).filter(Boolean).join(' ');
    }
    function normalizeScheduleSummaryWarningMessages(warnings) {
        const messages = [];
        const seen = new Set();
        (Array.isArray(warnings) ? warnings : []).forEach(warning => {
            const message = String(warning?.message || '').trim();
            if (!message || seen.has(message)) return;
            seen.add(message);
            messages.push(message);
        });
        return messages;
    }
    function requireFeasibleSowingSeasonSelection(args) {
        const classification = classifySelectedSowDate(args);
        if (!args?.perennial && classification.status === 'missing') throw new Error(classification.label);
        return classification;
    }
    function clampPercent(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return 0;
        return Math.max(0, Math.min(100, n));
    }
    function timelineDaysBetween(start, end) {
        if (!isUsableDate(start) || !isUsableDate(end)) return 0;
        return Math.round((end.getTime() - start.getTime()) / 86400000);
    }
    function timelinePercentForDate(date, rangeStart, totalDays) {
        if (!isUsableDate(date) || !isUsableDate(rangeStart) || !Number.isFinite(totalDays) || totalDays <= 0) return null;
        return clampPercent((timelineDaysBetween(rangeStart, date) / totalDays) * 100);
    }
    function buildLifecycleTimelineBounds({ plant = null, seasonStartYear = null } = {}) {
        const year = Math.round(finiteNumberOrNull(seasonStartYear) ?? new Date().getUTCFullYear());
        const scanYears = Math.max(1, Math.round(finiteNumberOrNull(plant ? getPlantScanYears(plant) : 1) ?? 1));
        const start = asUTCDate(year, 1, 1);
        const end = asUTCDate(year + scanYears - 1, 12, 31);
        return { start, end, startISO: fmtISO(start), endISO: fmtISO(end), multiYear: start.getUTCFullYear() !== end.getUTCFullYear() };
    }
    function lifecycleTimelineLabel(stage) {
        const labels = {
            SOW: 'Sow',
            GERM: 'Germ',
            TRANSPLANT: 'Transplant',
            MATURITY: 'Maturity',
            HARVEST_START: 'First harvest',
            HARVEST_END: 'Harvest end'
        };
        return labels[stage] || String(stage || 'Milestone');
    }
    function lifecycleTimelineAbbreviation(stage) {
        const abbreviations = {
            SOW: 'S',
            TRANSPLANT: 'T',
            HARVEST_START: 'HS',
            HARVEST_END: 'HE'
        };
        return abbreviations[stage] || '';
    }
    function lifecycleTimelineTooltipText(milestone) {
        if (!milestone) return '';
        const abbr = milestone.abbr || lifecycleTimelineAbbreviation(milestone.stage);
        const label = milestone.label || lifecycleTimelineLabel(milestone.stage);
        const iso = milestone.iso || '';
        const base = `${abbr} - ${label}: ${iso}`;
        if (milestone.stage === 'SOW') return `${base}\nClick to focus sow date.`;
        if (milestone.hasTaskRule) return `${base}\nClick to edit the first task rule starting here.`;
        return base;
    }
    function lifecycleTimelineDateLabel(isoValue, multiYear = false) {
        const d = parseISODateUTCValue(isoValue);
        if (!d) return '';
        const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
        const base = `${month} ${d.getUTCDate()}`;
        return multiYear ? `${base}, ${d.getUTCFullYear()}` : base;
    }
    function buildLifecycleTimelineAxisMarkers(bounds, totalDays) {
        const start = bounds?.start;
        const end = bounds?.end;
        if (!isUsableDate(start) || !isUsableDate(end) || end < start) return { months: [], years: [] };
        const spanDays = Math.max(1, Number.isFinite(Number(totalDays)) ? Number(totalDays) : timelineDaysBetween(start, end));
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const quarterMonthIndexes = new Set([0, 3, 6, 9]);
        const months = [];
        const years = [];
        const startYear = start.getUTCFullYear();
        const endYear = end.getUTCFullYear();
        for (let year = startYear; year <= endYear; year += 1) {
            const yearDate = asUTCDate(year, 1, 1);
            if (yearDate >= start && yearDate <= end) {
                years.push({
                    iso: fmtISO(yearDate),
                    label: String(year),
                    percent: timelinePercentForDate(yearDate, start, spanDays) ?? 0
                });
            }
            for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
                if (!quarterMonthIndexes.has(monthIndex)) continue;
                const monthDate = asUTCDate(year, monthIndex + 1, 1);
                if (monthDate < start || monthDate > end) continue;
                months.push({
                    iso: fmtISO(monthDate),
                    label: monthNames[monthIndex],
                    percent: timelinePercentForDate(monthDate, start, spanDays) ?? 0
                });
            }
        }
        return { months, years };
    }
    function layoutLifecycleTimelineMarkerOffsets(milestones, trackWidth, minCenterGapPx = 24) {
        const count = Array.isArray(milestones) ? milestones.length : 0;
        const width = Number(trackWidth);
        const gap = Math.max(1, Number(minCenterGapPx) || 24);
        if (!count || !Number.isFinite(width) || width <= 0) return Array.from({ length: count }, () => 0);
        const points = milestones.map((milestone, index) => ({
            index,
            percent: Number(milestone?.percent),
            center: (Number(milestone?.percent) / 100) * width
        })).filter(point => Number.isFinite(point.percent) && Number.isFinite(point.center));
        const offsets = Array.from({ length: count }, () => 0);
        points.sort((a, b) => a.center - b.center || a.index - b.index);
        let cluster = [];
        const flushCluster = () => {
            if (!cluster.length) return;
            const middle = (cluster.length - 1) / 2;
            cluster.forEach((point, clusterIndex) => {
                const rawOffset = (clusterIndex - middle) * gap;
                const minCenter = gap / 2;
                const maxCenter = width - (gap / 2);
                const adjustedCenter = Math.min(maxCenter, Math.max(minCenter, point.center + rawOffset));
                offsets[point.index] = adjustedCenter - point.center;
            });
            cluster = [];
        };
        points.forEach(point => {
            const previous = cluster[cluster.length - 1];
            if (previous && point.center - previous.center >= gap) flushCluster();
            cluster.push(point);
        });
        flushCluster();
        return offsets;
    }
    function attachLifecycleTimelineMarkerTooltip(marker, trackWrap, text) {
        if (!marker || !trackWrap) return null;
        const doc = marker.ownerDocument || document;
        marker.removeAttribute('title');
        marker.setAttribute('aria-label', String(text || ''));
        function getTooltip() {
            if (trackWrap.__uslLifecycleMarkerTooltip) return trackWrap.__uslLifecycleMarkerTooltip;
            const tooltip = doc.createElement('div');
            tooltip.className = 'usl-lifecycle-marker-tooltip';
            tooltip.setAttribute('role', 'tooltip');
            tooltip.style.position = 'absolute';
            tooltip.style.top = '0';
            tooltip.style.zIndex = '5';
            tooltip.style.display = 'none';
            tooltip.style.maxWidth = '220px';
            tooltip.style.padding = '4px 6px';
            tooltip.style.borderRadius = '4px';
            tooltip.style.background = '#111827';
            tooltip.style.color = '#fff';
            tooltip.style.fontSize = '11px';
            tooltip.style.lineHeight = '1.25';
            tooltip.style.whiteSpace = 'pre-line';
            tooltip.style.pointerEvents = 'none';
            trackWrap.__uslLifecycleMarkerTooltip = tooltip;
            trackWrap.appendChild(tooltip);
            return tooltip;
        }
        const hide = () => {
            const tooltip = trackWrap.__uslLifecycleMarkerTooltip;
            if (tooltip) tooltip.style.display = 'none';
        };
        const show = () => {
            const tooltip = getTooltip();
            const percent = Number(marker.getAttribute('data-timeline-percent'));
            const offset = Number(marker.getAttribute('data-timeline-offset-px') || 0);
            tooltip.textContent = String(text || '');
            tooltip.style.left = Number.isFinite(percent) ? `calc(${percent}% + ${Number.isFinite(offset) ? offset : 0}px)` : marker.style.left;
            tooltip.style.transform = Number.isFinite(percent) && percent <= 5 ? 'translateX(0)' : (Number.isFinite(percent) && percent >= 95 ? 'translateX(-100%)' : 'translateX(-50%)');
            tooltip.style.display = 'block';
        };
        marker.addEventListener('mouseenter', show);
        marker.addEventListener('mouseleave', hide);
        marker.addEventListener('focus', show);
        marker.addEventListener('blur', hide);
        marker.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
        return { show, hide };
    }
    function buildLifecycleTimelineMilestone(stage, dateValue, options = {}) {
        const date = dateValue instanceof Date ? dateValue : parseISODateUTCValue(dateValue);
        if (!date) return null;
        return {
            stage,
            iso: fmtISO(date),
            abbr: lifecycleTimelineAbbreviation(stage),
            label: options.label || lifecycleTimelineLabel(stage),
            visible: options.visible !== false,
            taskStage: options.taskStage || null
        };
    }
    function buildLifecycleTimelineViewModel({
        plant = null,
        perennial = false,
        seasonStartYear = null,
        startISO = '',
        sowingSeasons = [],
        latestHarvestEndISO = '',
        scheduleResult = null,
        todayISO = null,
        taskRules = [],
        generatedTasks = []
    } = {}) {
        if (perennial) return { hidden: true, reason: 'perennial' };
        let bounds = buildLifecycleTimelineBounds({ plant, seasonStartYear });
        const firstTimelineForBounds = Array.isArray(scheduleResult?.timelines) ? scheduleResult.timelines[0] : null;
        const scheduleEndForBounds = parseISODateUTCValue(scheduleResult?.lastScheduledHarvestEndISO) || parseISODateUTCValue(firstTimelineForBounds?.harvestEnd);
        const latestHarvestEndForBounds = parseISODateUTCValue(latestHarvestEndISO);
        const endForBounds = [scheduleEndForBounds, latestHarvestEndForBounds]
            .filter(date => date && date > bounds.end)
            .sort((left, right) => right.getTime() - left.getTime())[0] || null;
        if (endForBounds) {
            bounds = { ...bounds, end: endForBounds, endISO: fmtISO(endForBounds), multiYear: true };
        }
        const totalDays = Math.max(1, timelineDaysBetween(bounds.start, bounds.end));
        const bands = normalizeSowingSeasons(sowingSeasons).map(window => {
            const start = parseISODateUTCValue(window.startISO);
            const end = parseISODateUTCValue(window.endISO);
            if (!start || !end || end < bounds.start || start > bounds.end) return null;
            const clippedStart = new Date(Math.max(start.getTime(), bounds.start.getTime()));
            const clippedEnd = new Date(Math.min(end.getTime(), bounds.end.getTime()));
            const left = timelinePercentForDate(clippedStart, bounds.start, totalDays);
            const right = timelinePercentForDate(clippedEnd, bounds.start, totalDays);
            return {
                id: window.id,
                label: window.label,
                startISO: fmtISO(clippedStart),
                endISO: fmtISO(clippedEnd),
                leftPercent: left ?? 0,
                widthPercent: Math.max(0.8, clampPercent((right ?? 0) - (left ?? 0)))
            };
        }).filter(Boolean);
        const firstTimeline = Array.isArray(scheduleResult?.timelines) ? scheduleResult.timelines[0] : null;
        const sowDate = Array.isArray(scheduleResult?.schedule) ? scheduleResult.schedule[0] : parseISODateUTCValue(startISO);
        const rawMilestones = [
            buildLifecycleTimelineMilestone('SOW', sowDate || startISO, { taskStage: 'SOW' }),
            buildLifecycleTimelineMilestone('GERM', firstTimeline?.germ, { visible: false, taskStage: 'GERM' }),
            buildLifecycleTimelineMilestone('TRANSPLANT', firstTimeline?.transplant, { taskStage: 'TRANSPLANT' }),
            buildLifecycleTimelineMilestone('MATURITY', firstTimeline?.maturity, { visible: false }),
            buildLifecycleTimelineMilestone('HARVEST_START', firstTimeline?.harvestStart, { taskStage: 'HARVEST_START' }),
            buildLifecycleTimelineMilestone('HARVEST_END', firstTimeline?.harvestEnd, { taskStage: 'HARVEST_END' })
        ].filter(Boolean);
        const seenStageDates = new Set();
        const milestones = rawMilestones.filter(milestone => {
            const key = `${milestone.stage}:${milestone.iso}`;
            if (seenStageDates.has(key)) return false;
            seenStageDates.add(key);
            return true;
        }).map(milestone => {
            const percent = timelinePercentForDate(parseISODateUTCValue(milestone.iso), bounds.start, totalDays);
            const taskMatch = milestone.taskStage ? findFirstLifecycleTimelineTaskRule(taskRules, milestone.taskStage, generatedTasks) : null;
            const enriched = {
                ...milestone,
                percent,
                dateLabel: lifecycleTimelineDateLabel(milestone.iso, bounds.multiYear),
                hasTaskRule: !!taskMatch,
                taskRuleIndex: taskMatch ? taskMatch.originalIndex : null
            };
            return { ...enriched, tooltip: lifecycleTimelineTooltipText(enriched) };
        }).filter(milestone => Number.isFinite(Number(milestone.percent)));
        const visibleMilestones = milestones.filter(milestone => milestone.visible);
        const latestHarvestBoundaryPercent = latestHarvestEndForBounds && latestHarvestEndForBounds >= bounds.start && latestHarvestEndForBounds <= bounds.end
            ? timelinePercentForDate(latestHarvestEndForBounds, bounds.start, totalDays)
            : null;
        const latestHarvestBoundary = Number.isFinite(Number(latestHarvestBoundaryPercent)) ? {
            iso: fmtISO(latestHarvestEndForBounds),
            label: 'Latest harvest',
            abbr: 'LH',
            percent: latestHarvestBoundaryPercent,
            tooltip: `Latest harvest: ${fmtISO(latestHarvestEndForBounds)}`
        } : null;
        const todayDate = parseISODateUTCValue(todayISO || fmtISO(new Date()));
        const todayPercent = todayDate && todayDate >= bounds.start && todayDate <= bounds.end
            ? timelinePercentForDate(todayDate, bounds.start, totalDays)
            : null;
        return {
            hidden: false,
            bounds,
            totalDays,
            bands,
            axis: buildLifecycleTimelineAxisMarkers(bounds, totalDays),
            milestones,
            visibleMilestones,
            latestHarvestBoundary,
            todayISO: todayPercent == null ? null : fmtISO(todayDate),
            todayPercent
        };
    }
    function findFirstLifecycleTimelineTaskRule(taskRules, stage, generatedTasks = []) {
        const wanted = String(stage || '').trim();
        if (!wanted) return null;
        const ordered = buildTaskRuleDisplayOrder(taskRules, generatedTasks);
        return ordered.find(entry => normalizeTaskRule(entry.rule).startAnchorStage === wanted) || null;
    }
    function describeBlockingScheduleQualityDiagnostics(blockingDiagnostics) {
        const diagnostics = Array.isArray(blockingDiagnostics) ? blockingDiagnostics : [];
        const labels = Array.from(new Set(diagnostics.map(diagnostic => annualCore.diagnosticLabel ? annualCore.diagnosticLabel(diagnostic) : diagnostic.factor).filter(Boolean)));
        const messages = diagnostics.map(diagnostic => diagnostic?.message).filter(Boolean);
        return [
            labels.length ? `Blocked by ${labels.join(', ')}.` : 'Blocked by schedule quality diagnostics.',
            messages.slice(0, 3).join(' ')
        ].filter(Boolean).join(' ');
    }
    function requireNoBlockingScheduleQualityDiagnostics(inputs) {
        if (!inputs || isPerennialPlant(inputs.plant)) return null;
        const result = annualCore.evaluateSowDateDiagnostics(inputs, inputs.startISO);
        if (result.blockingDiagnostics && result.blockingDiagnostics.length) {
            throw new Error(describeBlockingScheduleQualityDiagnostics(result.blockingDiagnostics));
        }
        return result;
    }

    function buildScheduleViewState({
        perennial = false,
        windowFeasible = false,
        plantName = '',
        varietyName = '',
        cityName = '',
        seasonStartYear = '',
        startISO = '',
        dateInputMode = 'sow',
        sowingSeasons = [],
        activeSowingSeasonId = '',
        scheduleWarnings = []
    } = {}) {
        let feasibility = classifySelectedSowDate({
            perennial,
            windowFeasible,
            startISO,
            sowingSeasons,
            activeSowingSeasonId
        });
        const warningMessages = normalizeScheduleSummaryWarningMessages(scheduleWarnings);
        if (!perennial && warningMessages.length) {
            feasibility = { status: 'warning', label: warningMessages.join(' '), warningMessages };
        }
        if (!perennial && dateInputMode === 'transplant' && feasibility?.label) {
            feasibility = {
                ...feasibility,
                label: String(feasibility.label)
                    .replace(/sow date/g, 'transplant date')
                    .replace(/Sow date/g, 'Transplant date')
                    .replace(/sowing season/g, 'transplant season')
                    .replace(/sowing seasons/g, 'transplant seasons')
            };
        }
        return {
            crop: [plantName, varietyName].filter(Boolean).join(' / ') || '(none)',
            context: [cityName, seasonStartYear].filter(value => String(value || '').trim()).join(' / ') || '(none)',
            feasibility
        };
    }

    function renderScheduleSummary() {
        const root = document.createElement('div');
        root.className = 'usl-scheduler-summary';
        root.style.border = '1px solid #93c5fd';
        root.style.background = '#eff6ff';
        root.style.borderRadius = '6px';
        root.style.padding = '10px 12px';
        root.style.marginBottom = '10px';

        const title = document.createElement('div');
        title.className = 'usl-scheduler-summary-title';
        title.textContent = 'Schedule summary';
        title.style.fontWeight = '600';
        title.style.marginBottom = '8px';
        root.appendChild(title);

        const grid = document.createElement('div');
        grid.className = 'usl-scheduler-summary-grid';
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(220px, 1fr))';
        grid.style.gap = '6px 16px';
        root.appendChild(grid);

        const fields = {};
        [
            ['crop', 'Plant / variety'],
            ['context', 'City / year'],
            ['feasibility', 'Feasibility']
        ].forEach(([key, label]) => {
            const item = document.createElement('div');
            item.className = key === 'feasibility' ? 'usl-scheduler-summary-item usl-scheduler-summary-item--wide' : 'usl-scheduler-summary-item';
            const labelEl = document.createElement('div');
            labelEl.className = 'usl-scheduler-summary-label';
            labelEl.textContent = label;
            labelEl.style.fontSize = '11px';
            labelEl.style.color = '#4b5563';
            const valueEl = document.createElement('div');
            valueEl.className = 'usl-scheduler-summary-value';
            valueEl.style.fontSize = '12px';
            valueEl.style.fontWeight = key === 'feasibility' ? '600' : '400';
            item.appendChild(labelEl);
            item.appendChild(valueEl);
            grid.appendChild(item);
            fields[key] = valueEl;
        });

        return { root, fields };
    }

    function updateScheduleSummary(summaryView, viewState) {
        if (!summaryView?.fields || !viewState) return;
        summaryView.fields.crop.textContent = viewState.crop;
        summaryView.fields.context.textContent = viewState.context;
        const feasibilityField = summaryView.fields.feasibility;
        feasibilityField.textContent = '';
        if (viewState.feasibility.status === 'warning' && Array.isArray(viewState.feasibility.warningMessages) && viewState.feasibility.warningMessages.length) {
            const list = document.createElement('ul');
            list.className = 'usl-scheduler-summary-warning-list';
            viewState.feasibility.warningMessages.forEach(message => {
                const item = document.createElement('li');
                item.textContent = message;
                list.appendChild(item);
            });
            feasibilityField.appendChild(list);
        } else {
            feasibilityField.textContent = viewState.feasibility.label;
        }
        feasibilityField.style.color = viewState.feasibility.status === 'feasible'
            ? '#166534'
            : (viewState.feasibility.status === 'warning' ? '#92400e' : (viewState.feasibility.status === 'not_applicable' ? '#374151' : '#b91c1c'));
    }

    // Scans season feasibility day-by-day.
    async function explainFeasibilityOverSeason(inputs, maxDays = null, stopAtFirstOk = false, options = {}) {
        const planner = new annualCore.Planner(inputs);
        const out = [];
        const scanStart = isUsableDate(options.scanStartDate) ? options.scanStartDate : planner.ctx.scanStart;
        const defaultScanEnd = planner.ctx.overwinterAllowed ? planner.ctx.scanEndHard : (planner.ctx.sowScanEnd || planner.ctx.scanEndHard);
        const scanEnd = isUsableDate(options.scanEndDate) ? options.scanEndDate : defaultScanEnd;
        const spanDays = Math.max(0, Math.ceil((scanEnd.getTime() - scanStart.getTime()) / 86400000) + 1);
        const scanLimit = Number.isFinite(Number(maxDays)) && Number(maxDays) > 0 ? Math.min(Math.floor(Number(maxDays)), spanDays) : spanDays; // FIX: callers may now request a first-season-only explain scan.
        let d = new Date(scanStart); // FIX: explain scans from the requested diagnostic start, even when selected start is blank.
        for (let i = 0; i < scanLimit && d <= scanEnd; i++) {
            try {
                const r = planner.isSowFeasible(d);
                if (r && r.ok) {
                    out.push({
                        date: fmtISO(d),
                        ok: true,
                        reason: r.reason || 'ok',
                        maturity: fmtISO(r.maturity || null),
                        harvestEnd: fmtISO(r.harvestEnd || null),
                        TmeanHarvest: Number.isFinite(r.TmeanHarvest) ? r.TmeanHarvest.toFixed(1) : ''
                    });
                    if (stopAtFirstOk) break;
                } else {
                    out.push({
                        date: fmtISO(d),
                        ok: false,
                        reason: (r && r.reason) ? r.reason : 'unknown'
                    });
                }
            } catch (e) {
                out.push({ date: fmtISO(d), ok: false, reason: 'error:' + (e?.message || 'unknown') });
            }
            d = addDaysUTC(d, 1);
        }
        return out;
    }

    function compressFeasibilityScanRanges(rows) {
        const ranges = [];
        (rows || []).forEach(function (row) {
            if (!row || !row.date) return;
            const normalized = normalizeFeasibilityReason(row);
            const last = ranges[ranges.length - 1];
            if (last && last.ok === normalized.ok && last.reason === normalized.reason && isNextISODate(last.end, row.date)) {
                last.end = row.date;
                last.days += 1;
                last.last = row;
                last.lastDetail = normalized.detail;
                return;
            }
            ranges.push({
                start: row.date,
                end: row.date,
                days: 1,
                ok: normalized.ok,
                reason: normalized.reason,
                label: normalized.label,
                firstDetail: normalized.detail,
                lastDetail: normalized.detail,
                first: row,
                last: row
            });
        });
        return ranges.map(function (range) {
            const out = {
                start: range.start,
                end: range.end,
                days: range.days,
                ok: range.ok,
                reason: range.reason,
                label: range.label
            };
            if (range.firstDetail || range.lastDetail) {
                out.first_detail = range.firstDetail || '';
                out.last_detail = range.lastDetail || '';
                out.detail = range.firstDetail === range.lastDetail
                    ? (range.firstDetail || '')
                    : [range.firstDetail, range.lastDetail].filter(Boolean).join(' -> ');
            }
            if (range.ok) {
                out.first_maturity = range.first?.maturity || '';
                out.last_maturity = range.last?.maturity || '';
                out.first_harvest_end = range.first?.harvestEnd || '';
                out.last_harvest_end = range.last?.harvestEnd || '';
            }
            return out;
        });
    }

    function normalizeFeasibilityReason(row) {
        if (row && row.ok) return { ok: true, reason: 'ok', detail: '', label: 'Feasible' };
        const raw = String(row?.reason || 'unknown').trim();
        const match = raw.match(/^([A-Za-z0-9_]+)\((.*)\)$/);
        if (match) {
            return { ok: false, reason: match[1], detail: match[2], label: compactFeasibilityReasonLabel(match[1]) };
        }
        if (raw.indexOf('error:') === 0) {
            return { ok: false, reason: 'error', detail: raw.slice(6).trim(), label: 'The feasibility check failed.' };
        }
        return { ok: false, reason: raw || 'unknown', detail: '', label: compactFeasibilityReasonLabel(raw) };
    }

    function compactFeasibilityReasonLabel(reason) {
        const raw = String(reason || '').trim();
        if (raw === 'ok') return 'Feasible';
        if (raw === 'spring_frost_gate') return 'Before frost-safety date.';
        if (raw === 'soil_gate') return 'Soil below planting threshold.';
        if (raw === 'insufficient_gdd') return 'Not enough remaining heat to reach maturity.';
        if (raw.indexOf('insufficient_gdd_before_cold') === 0) return 'Not enough heat before lethal cold.';
        if (raw === 'harvest_too_cold') return 'Expected harvest temperatures are too cold.';
        if (raw === 'harvest_too_hot') return 'Expected harvest temperatures are too hot.';
        return humanFeasibilityReason(raw);
    }

    function formatFeasibilityScanRanges(rows) {
        const ranges = compressFeasibilityScanRanges(rows);
        if (!ranges.length) return 'scan_not_run: no daily feasibility rows were produced';
        return ranges.map(function (range) {
            const dateText = range.start === range.end ? range.start : `${range.start} to ${range.end}`;
            const parts = [
                `${dateText} (${range.days} day${range.days === 1 ? '' : 's'})`,
                range.ok ? 'ok' : range.reason,
                range.label
            ];
            if (range.detail) parts.push(`detail ${range.detail}`);
            if (range.ok) {
                parts.push(`maturity ${range.first_maturity || 'n/a'} -> ${range.last_maturity || 'n/a'}`);
                parts.push(`harvest end ${range.first_harvest_end || 'n/a'} -> ${range.last_harvest_end || 'n/a'}`);
            }
            return parts.join(' | ');
        }).join('\n');
    }

    function bestBeforeColdGddDetail(range) {
        const detail = String(range?.detail || '').trim();
        const matches = Array.from(detail.matchAll(/gdd\s+([0-9.]+)<([0-9.]+)\s+deadline\s+([0-9-]+)/g));
        if (!matches.length) return '';
        const best = matches.reduce((current, match) => {
            const usable = Number(match[1]);
            return !current || usable > current.usable ? { usable, target: Number(match[2]), deadline: match[3] } : current;
        }, null);
        return best ? `best usable GDD ${best.usable.toFixed(1)}<${best.target.toFixed(1)} before ${best.deadline}` : '';
    }

    function buildFeasibilityBlockingSummary(inputs, rows) {
        const ranges = compressFeasibilityScanRanges(rows);
        if (!ranges.length) return 'Blocking sequence:\n- scan_not_run: no daily feasibility rows were produced';
        const blockers = ranges.filter(range => !range.ok);
        if (!blockers.length) return 'Feasible sowing range found.\nBlocking sequence:\n- none';
        const primary = findPrimaryFeasibilityBlocker(blockers);
        const derived = inputs.derived();
        const budget = inputs.plant.firstHarvestBudget();
        const gddDiagnostics = derived.dailyRates?.__diagnostics || {};
        const cropAnnualGdd = finiteNumberOrNull(gddDiagnostics.scaledCropAnnualGdd) ?? annualGddFromMonthlyMeans(derived.monthlyAvg, derived.env.Tbase, derived.year, 0);
        const lines = [ranges.some(range => range.ok) ? 'Feasible sowing range found.' : 'No feasible sowing season found.', 'Blocking sequence:'];
        blockers.forEach(function (range) {
            const dateText = range.start === range.end ? range.start : `${range.start} to ${range.end}`;
            lines.push(`- ${dateText}: ${range.reason} (${range.label})`);
        });
        if (primary) {
            lines.push(`Primary blocker after frost/soil readiness: ${primary.reason}`);
            if (primary.reason === 'insufficient_gdd_before_cold' && budget.mode === 'gdd') {
                const detail = bestBeforeColdGddDetail(primary);
                lines.push(detail ? `GDD check: ${detail}.` : `GDD check: crop needs ${Number(budget.amount).toFixed(1)} GDD before lethal cold.`);
            } else if (primary.reason === 'insufficient_gdd' && budget.mode === 'gdd') {
                lines.push(`GDD check: crop needs ${Number(budget.amount).toFixed(1)} GDD; calibrated crop-base estimate is ${Number(cropAnnualGdd).toFixed(1)} GDD.`);
            }
        }
        return lines.join('\n');
    }

    function findPrimaryFeasibilityBlocker(blockers) {
        if (!blockers || !blockers.length) return null;
        return blockers.find(range => !['spring_frost_gate', 'soil_gate'].includes(range.reason)) || blockers[0];
    }

    function isNextISODate(leftISO, rightISO) {
        const left = parseISODateUTCValue(leftISO);
        const right = parseISODateUTCValue(rightISO);
        return !!left && !!right && addDaysUTC(left, 1).getTime() === right.getTime();
    }

    function effectiveHardEndForDiagnostics(inputs, derived) {
        if (!isPerennialPlant(inputs?.plant)) {
            return { date: derived.scanEndHard, source: inputs?.policy?.overwinterAllowed ? 'overwinter scan end' : 'lifecycle scan end' }; // FIX: annual latest-harvest display dates are not hard caps.
        }
        if (inputs?.policy?.overwinterAllowed) {
            return { date: derived.scanEndHard, source: 'overwinter scan end' };
        }
        if (isUsableDate(derived.seasonEnd) && derived.seasonEnd <= derived.scanEndHard) {
            return { date: derived.seasonEnd, source: 'season end' };
        }
        return { date: derived.scanEndHard, source: 'scan end fallback' };
    }

    function buildFeasibilityDiagnosticsModel(inputs, rows, options = {}) { // CHANGED: share diagnostics data between text output and the explain dialog UI.
        const plant = inputs.plant;
        const city = inputs.city;
        const derived = inputs.derived();
        const budget = plant.firstHarvestBudget();
        const calibration = typeof city.gddCalibration === 'function'
            ? city.gddCalibration(derived.year)
            : solveGddTemperatureOffset({
                monthlyAvgTemp: city.monthlyMeans(),
                targetGdd: city.gdd_annual,
                gddBaseC: city.gdd_base_c,
                year: derived.year
            }); // ADDED: diagnostics can explain annual-GDD calibration even outside CityClimate.
        const rawMonthly = city.monthlyMeans();
        const gddDiagnostics = derived.dailyRates?.__diagnostics || {};
        const climateDiagnostics = derived.dailyClimate?.diagnostics || {};
        const cropAnnualGdd = finiteNumberOrNull(gddDiagnostics.scaledCropAnnualGdd) ?? annualGddFromMonthlyMeans(derived.monthlyAvg, derived.env.Tbase, derived.year, 0);
        const uncalibratedCropAnnualGdd = finiteNumberOrNull(gddDiagnostics.rawCropAnnualGdd) ?? annualGddFromMonthlyMeans(rawMonthly, derived.env.Tbase, derived.year, 0);
        const soilThreshold = finiteNumberOrNull(inputs.policy?.soilGateThresholdC);
        const firstReady = soilThreshold == null ? null : firstSoilReadyDate({
            thresholdC: soilThreshold,
            monthlyAvgTemp: derived.dailyClimate || derived.monthlyAvg,
            scanStart: derived.scanStart,
            scanEndHard: derived.scanEndHard,
            bedProfile: inputs.bedProfile,
            consecutiveDays: inputs.policy?.soilGateConsecutiveDays || 3
        });
        const firstFailure = (rows || []).find(row => row && row.ok === false) || null;
        const firstOk = (rows || []).find(row => row && row.ok === true) || null;
        const reasonCounts = {};
        (rows || []).forEach(function (row) {
            if (!row || row.ok) return;
            const reason = normalizeFeasibilityReason(row).reason;
            reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
        });
        const topReasons = Object.keys(reasonCounts)
            .sort((a, b) => reasonCounts[b] - reasonCounts[a])
            .slice(0, 5)
            .map(reason => `${reason}: ${reasonCounts[reason]}`);
        const scanRows = Array.isArray(rows) ? rows.length : 0;
        const scanStart = options.scanStartISO || rows?.[0]?.date || fmtISO(derived.scanStart);
        const scanEnd = options.scanEndISO || rows?.[rows.length - 1]?.date || fmtISO(derived.scanEndHard);
        const hardEnd = effectiveHardEndForDiagnostics(inputs, derived);
        const selectedStart = parseISODateUTCValue(inputs.startISO); // FIX: invalid selected dates must not break diagnostics.
        const fmtNum = value => Number.isFinite(Number(value)) ? Number(value).toFixed(1) : 'n/a';
        const policy = inputs.policy || {};
        const scanLines = [
            options.scanLabel ? `Scan purpose: ${options.scanLabel}` : null,
            `Scan range: ${scanStart} to ${scanEnd}, ${scanRows} day${scanRows === 1 ? '' : 's'}`,
            `Lifecycle scan end: ${fmtISO(derived.scanEndHard)}`,
            `Effective hard end: ${fmtISO(hardEnd.date)} (${hardEnd.source})`,
            scanRows ? null : `Scan status: scan_not_run selected start=${inputs.startISO || 'blank'} parsed=${selectedStart ? fmtISO(selectedStart) : 'invalid'}`
        ].filter(Boolean);
        const blockingLines = buildFeasibilityBlockingSummary(inputs, rows).split('\n');
        const sections = [
            { title: 'Scan', lines: scanLines },
            { title: 'Blocking sequence', lines: blockingLines.filter(line => line !== 'Blocking sequence:') },
            {
                title: 'Soil and bed',
                lines: [
                    `Soil threshold: ${soilThreshold == null ? 'n/a' : fmtNum(soilThreshold) + ' C'}`,
                    `Estimated first soil-ready date: ${firstReady ? fmtISO(firstReady) : 'none in scan'}`,
                    `Bed model: ${inputs.bedProfileSource || 'generic garden bed'} ${JSON.stringify(normalizeBedProfile(inputs.bedProfile))}`
                ]
            },
            {
                title: 'Climate and GDD',
                lines: [
                    `Climate model: ${climateDiagnostics.source || 'city monthly normals'}; forecast blend days ${Number(climateDiagnostics.forecastBlendDays || 0)}`,
                    `Policy: frost ${policy.springFrostRisk || 'p50'}, normals ${policy.weatherNormalsSource || 'auto'}, soil-ready ${policy.soilGateConsecutiveDays || 3} days, GDD calibration ${policy.gddCalibrationEnabled === false ? 'disabled' : 'enabled'}`,
                    `Forecast weights: 0-3d ${fmtNum(policy.forecastBlendWeight0To3Days ?? 0.8)}, 4-7d ${fmtNum(policy.forecastBlendWeight4To7Days ?? 0.5)}, 8-16d ${fmtNum(policy.forecastBlendWeight8To16Days ?? 0.25)}`,
                    `City annual GDD: ${fmtNum(calibration.targetGdd)} at base ${fmtNum(calibration.gddBaseC)} C`,
                    `Temperature calibration offset: not used; daily GDD is scaled instead`,
                    `GDD calibration scale: ${fmtNum(gddDiagnostics.gddScale || 1)}; city base-GDD ${fmtNum(gddDiagnostics.cityBaseAnnualGdd)} -> target ${policy.gddCalibrationEnabled === false ? 'disabled' : fmtNum(gddDiagnostics.targetGdd)}`,
                    `Bed frost-gate shift: ${sharedCore.bedFrostGateShiftDays(inputs.bedProfile)} days; bed GDD air shift: ${fmtNum(gddDiagnostics.bedAirOffsetC)} C`,
                    `Crop-base annual GDD estimate: ${fmtNum(uncalibratedCropAnnualGdd)} raw -> ${fmtNum(cropAnnualGdd)} calibrated at base ${fmtNum(derived.env.Tbase)} C`,
                    `Crop maturity target: ${budget.mode === 'gdd' ? fmtNum(budget.amount) + ' GDD' : String(Math.round(budget.amount)) + ' days'}`
                ]
            },
            {
                title: 'Outcomes',
                lines: [
                    `First failing gate: ${firstFailure ? `${firstFailure.date} ${firstFailure.reason} (${humanFeasibilityReason(firstFailure.reason)})` : 'none in scan'}`,
                    `First feasible sow date: ${firstOk ? firstOk.date : 'none in scan'}`,
                    `Failure summary: ${topReasons.length ? topReasons.join(', ') : 'none'}`
                ]
            }
        ];
        const textLines = [
            'Diagnostics:',
            ...scanLines,
            ...blockingLines,
            ...sections[2].lines,
            ...sections[3].lines,
            ...sections[4].lines
        ];
        return { sections, text: textLines.filter(Boolean).join('\n') };
    }

    function buildFeasibilityDiagnostics(inputs, rows) {
        return buildFeasibilityDiagnosticsModel(inputs, rows).text; // CHANGED: preserve the existing plain-text diagnostics contract.
    }

    function appendExplainSection(parent, titleText) { // ADDED: create consistent sections inside the explain dialog.
        const section = document.createElement('section');
        section.style.marginBottom = '14px';

        const title = document.createElement('div');
        title.textContent = titleText;
        title.style.fontWeight = '600';
        title.style.fontSize = '13px';
        title.style.paddingBottom = '6px';
        title.style.borderBottom = '1px solid #d1d5db';
        title.style.marginBottom = '8px';
        section.appendChild(title);

        parent.appendChild(section);
        return section;
    }

    function appendExplainLineList(parent, lines) { // ADDED: render diagnostic lines without losing their original wording.
        const list = document.createElement('div');
        list.style.display = 'grid';
        list.style.gridTemplateColumns = 'minmax(170px, max-content) minmax(0, 1fr)';
        list.style.gap = '5px 12px';
        list.style.fontSize = '12px';
        (lines || []).forEach(function (line) {
            appendExplainDiagnosticLine(list, line);
        });
        parent.appendChild(list);
    }

    function appendExplainDiagnosticLine(parent, line) { // ADDED: split simple "Label: value" rows for readability.
        const text = String(line || '');
        const colonIndex = text.indexOf(':');
        const isBullet = text.indexOf('- ') === 0;
        if (colonIndex > 0 && !isBullet) {
            const label = document.createElement('div');
            label.textContent = text.slice(0, colonIndex);
            label.style.color = '#4b5563';
            label.style.fontWeight = '600';
            const value = document.createElement('div');
            value.textContent = text.slice(colonIndex + 1).trim();
            value.style.minWidth = '0';
            value.style.overflowWrap = 'anywhere';
            parent.appendChild(label);
            parent.appendChild(value);
            return;
        }

        const row = document.createElement('div');
        row.textContent = text;
        row.style.gridColumn = '1 / -1';
        row.style.overflowWrap = 'anywhere';
        if (isBullet) row.style.paddingLeft = '12px';
        parent.appendChild(row);
    }

    function appendExplainDiagnostics(parent, diagnosticsModel, titleText = 'Diagnostics') { // CHANGED: render grouped diagnostics in the explain dialog.
        const section = appendExplainSection(parent, titleText);
        (diagnosticsModel.sections || []).forEach(function (group) {
            const groupEl = document.createElement('div');
            groupEl.style.marginBottom = '10px';
            const groupTitle = document.createElement('div');
            groupTitle.textContent = group.title;
            groupTitle.style.fontWeight = '600';
            groupTitle.style.fontSize = '12px';
            groupTitle.style.marginBottom = '5px';
            groupEl.appendChild(groupTitle);
            appendExplainLineList(groupEl, group.lines);
            section.appendChild(groupEl);
        });
    }

    function appendExplainScanRanges(parent, ranges, titleText = 'Feasibility scan ranges') { // CHANGED: render compressed feasibility ranges as a table.
        const section = appendExplainSection(parent, titleText);
        if (!ranges.length) {
            const empty = document.createElement('div');
            empty.textContent = 'scan_not_run: no daily feasibility rows were produced';
            empty.style.fontSize = '12px';
            empty.style.color = '#92400e';
            empty.style.background = '#fffbeb';
            empty.style.border = '1px solid #f59e0b';
            empty.style.padding = '8px';
            section.appendChild(empty);
            return;
        }

        const wrap = document.createElement('div');
        wrap.style.overflowX = 'auto';
        const table = document.createElement('table');
        table.style.borderCollapse = 'collapse';
        table.style.width = '100%';
        table.style.minWidth = '840px';
        table.style.fontSize = '12px';
        const headers = ['Date range', 'Days', 'Status', 'Reason', 'Detail', 'Maturity', 'Harvest end'];
        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        headers.forEach(function (header) {
            const th = document.createElement('th');
            th.textContent = header;
            th.style.border = '1px solid #ddd';
            th.style.padding = '6px 8px';
            th.style.background = '#f3f4f6';
            th.style.fontWeight = '600';
            th.style.textAlign = 'left';
            headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        ranges.forEach(function (range) {
            const dateText = range.start === range.end ? range.start : `${range.start} to ${range.end}`;
            const values = [
                dateText,
                `${range.days}`,
                range.ok ? 'Feasible' : 'Blocked',
                range.ok ? 'ok' : range.reason,
                range.detail || '',
                range.ok ? `${range.first_maturity || 'n/a'} -> ${range.last_maturity || 'n/a'}` : '',
                range.ok ? `${range.first_harvest_end || 'n/a'} -> ${range.last_harvest_end || 'n/a'}` : ''
            ];
            const tr = document.createElement('tr');
            values.forEach(function (value, index) {
                const td = document.createElement('td');
                td.textContent = value;
                td.style.border = '1px solid #eee';
                td.style.padding = '6px 8px';
                td.style.verticalAlign = 'top';
                td.style.overflowWrap = index === 4 ? 'anywhere' : 'normal';
                if (index === 2) td.style.fontWeight = '600';
                if (index === 2) td.style.color = range.ok ? '#166534' : '#92400e';
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        wrap.appendChild(table);
        section.appendChild(wrap);
    }

    function formatScheduleQualityDiagnosticRanges(ranges) {
        const normalized = Array.isArray(ranges) ? ranges : [];
        if (!normalized.length) return 'No schedule quality diagnostics.';
        return normalized.map(range => {
            const observed = range.observedMin == null && range.observedMax == null
                ? 'n/a'
                : (range.observedMin === range.observedMax ? String(range.observedMin) : `${range.observedMin} to ${range.observedMax}`);
            const messages = (range.messages || []).filter(Boolean).join(' | ');
            return `${range.label || range.factor}: ${range.startISO} to ${range.endISO}; severity=${range.severity}; policy=${range.policy}; stage=${range.stage}; threshold=${range.threshold ?? 'n/a'}; observed=${observed}${messages ? `; ${messages}` : ''}`;
        }).join('\n');
    }

    function appendScheduleQualityDiagnosticRanges(parent, ranges) {
        const section = appendExplainSection(parent, 'Schedule quality diagnostic ranges');
        if (!ranges || !ranges.length) {
            const empty = document.createElement('div');
            empty.textContent = 'No heat, photoperiod, chilling, or missing-data diagnostics were produced.';
            empty.style.fontSize = '12px';
            empty.style.color = '#166534';
            section.appendChild(empty);
            return;
        }
        const wrap = document.createElement('div');
        wrap.style.overflowX = 'auto';
        const table = document.createElement('table');
        table.style.borderCollapse = 'collapse';
        table.style.width = '100%';
        table.style.minWidth = '860px';
        table.style.fontSize = '12px';
        const headers = ['Sow date range', 'Risk', 'Severity', 'Policy', 'Stage', 'Threshold', 'Observed', 'Details'];
        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        headers.forEach(header => {
            const th = document.createElement('th');
            th.textContent = header;
            th.style.border = '1px solid #ddd';
            th.style.padding = '6px 8px';
            th.style.background = '#f3f4f6';
            th.style.fontWeight = '600';
            th.style.textAlign = 'left';
            headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        table.appendChild(thead);
        const tbody = document.createElement('tbody');
        ranges.forEach(range => {
            const observed = range.observedMin == null && range.observedMax == null
                ? ''
                : (range.observedMin === range.observedMax ? String(range.observedMin) : `${range.observedMin} to ${range.observedMax}`);
            const values = [
                range.startISO === range.endISO ? range.startISO : `${range.startISO} to ${range.endISO}`,
                range.label || range.factor || '',
                range.severity || '',
                range.policy || '',
                range.stage || '',
                range.threshold == null ? '' : String(range.threshold),
                observed,
                (range.messages || []).join(' | ')
            ];
            const tr = document.createElement('tr');
            values.forEach((value, index) => {
                const td = document.createElement('td');
                td.textContent = value;
                td.style.border = '1px solid #eee';
                td.style.padding = '6px 8px';
                td.style.verticalAlign = 'top';
                td.style.overflowWrap = index === 7 ? 'anywhere' : 'normal';
                if (index === 2) td.style.color = value === 'block' ? '#b91c1c' : (value === 'warning' ? '#92400e' : '#4b5563');
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        wrap.appendChild(table);
        section.appendChild(wrap);
    }

    function appendExplainPreSection(parent, title, text) { // ADDED: keep raw plant and city dictionaries available.
        const section = appendExplainSection(parent, title);
        const pre = document.createElement('pre');
        pre.textContent = text;
        pre.style.margin = '0';
        pre.style.padding = '8px';
        pre.style.background = '#f9fafb';
        pre.style.border = '1px solid #e5e7eb';
        pre.style.overflow = 'auto';
        pre.style.maxHeight = '220px';
        pre.style.fontSize = '12px';
        section.appendChild(pre);
    }

    async function copyExplainTextToClipboard(text) { // ADDED: copy works in browsers that expose clipboard APIs.
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(text);
            return;
        }
        fallbackCopyExplainText(text);
    }

    function fallbackCopyExplainText(text) { // ADDED: support draw.io desktop webviews without navigator.clipboard.
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', 'readonly');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            if (!document.execCommand('copy')) throw new Error('Copy command was not accepted.');
        } finally {
            document.body.removeChild(textarea);
        }
    }

    function renderExplainSowingRangeDialog(ui, diagnosticsModel, ranges, plantText, cityText, fullText, options = {}) { // CHANGED: structured explain dialog renderer.
        const div = document.createElement('div');
        div.style.boxSizing = 'border-box';
        div.style.display = 'flex';
        div.style.flexDirection = 'column';
        div.style.height = '100%';
        div.style.maxHeight = '640px';
        div.style.padding = '12px';

        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.justifyContent = 'space-between';
        header.style.gap = '8px';
        header.style.marginBottom = '10px';
        const title = document.createElement('div');
        title.textContent = 'Explain Sowing Range';
        title.style.fontWeight = '600';
        title.style.fontSize = '14px';
        header.appendChild(title);
        const copyBtn = mxUtils.button('Copy Text', async () => {
            try {
                await copyExplainTextToClipboard(fullText);
                copyBtn.textContent = 'Copied';
                setTimeout(() => { copyBtn.textContent = 'Copy Text'; }, 1200);
            } catch (copyError) {
                copyBtn.textContent = 'Copy failed';
                copyBtn.title = copyError?.message || String(copyError);
                setTimeout(() => { copyBtn.textContent = 'Copy Text'; }, 1600);
            }
        });
        applySharedButtonStyle(copyBtn, 'neutral');
        header.appendChild(copyBtn);
        div.appendChild(header);

        const body = document.createElement('div');
        body.style.flex = '1';
        body.style.minHeight = '0';
        body.style.overflow = 'auto';
        body.style.paddingRight = '2px';
        appendExplainDiagnostics(body, diagnosticsModel, options.diagnosticsTitle || 'Diagnostics');
        if (options.sowingSeasonsText) appendExplainPreSection(body, 'Derived sowing seasons', options.sowingSeasonsText);
        appendScheduleQualityDiagnosticRanges(body, options.scheduleQualityDiagnosticRanges || []);
        appendExplainScanRanges(body, ranges, options.scanTitle || 'Feasibility scan ranges');
        if (options.lifecycleDiagnosticsModel) appendExplainDiagnostics(body, options.lifecycleDiagnosticsModel, 'Lifecycle support diagnostics');
        if (options.lifecycleRanges) appendExplainScanRanges(body, options.lifecycleRanges, 'Lifecycle support scan ranges');
        appendExplainPreSection(body, 'Plant data', plantText);
        appendExplainPreSection(body, 'City data', cityText);
        div.appendChild(body);

        ui.showDialog(div, 960, 640, true, true);
        elevateTrellisDialog(ui);
    }

    function showCommitDialog(ui, {
        container,
        width,
        height,
        modal = true,
        closable = true
    } = {}) {
        return new Promise((resolve) => {
            let settled = false;
            const originalHide = ui.hideDialog.bind(ui);

            function settle(val) {
                if (settled) return;
                settled = true;
                ui.hideDialog = originalHide;
                resolve(val);
            }

            ui.hideDialog = function () {
                // Only treat it as a cancel if THIS dialog is the active one                   
                const active = ui.dialog && ui.dialog.container;
                const isThis = active === container || container.contains(active);
                try {
                    originalHide();
                } finally {
                    if (isThis) settle(null);
                }
            };

            // commit channel                                                                    
            container.__commit = (val) => {
                settle(val);
                // Close after settling; hideDialog wrapper is already restored                 
                try { originalHide(); } catch (_) { }
            };

            // explicit cancel channel (optional, but clearer at call sites)                      
            container.__cancel = () => {
                ui.hideDialog();
            };

            ui.showDialog(container, width, height, modal, closable);
            elevateTrellisDialog(ui);
        });
    }

    function renderPreviewTable(ui, rows) {
        const div = document.createElement('div');
        div.style.padding = '12px';
        div.style.maxWidth = '840px';
        div.style.maxHeight = '70vh';
        div.style.overflow = 'auto';

        const title = document.createElement('div');
        title.textContent = 'Schedule Preview';
        title.style.fontWeight = '600';
        title.style.marginBottom = '8px';
        div.appendChild(title);

        const table = document.createElement('table');
        table.style.borderCollapse = 'collapse';
        table.style.width = '100%';

        const headers = [
            'Plant', 'Method',
            'Sow', 'Germ', 'Transplant', 'Harvest Start', 'Harvest End',
            'Yield Multiplier', 'Plants Required'
        ];
        const thead = document.createElement('thead');
        const trh = document.createElement('tr');
        headers.forEach(h => {
            const th = document.createElement('th');
            th.textContent = h;
            th.style.border = '1px solid #ddd';
            th.style.padding = '6px 8px';
            th.style.background = '#f3f4f6';
            th.style.fontWeight = '600';
            th.style.textAlign = 'left';
            trh.appendChild(th);
        });
        thead.appendChild(trh);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        rows.forEach(r => {
            const tr = document.createElement('tr');
            [
                r.plant, r.method,
                r.sow, r.germ, r.trans, r.harvStart, r.harvEnd,
                r.mult, r.plantsReq
            ].forEach(val => {
                const td = document.createElement('td');
                td.textContent = String(val ?? '');
                td.style.border = '1px solid #eee';
                td.style.padding = '6px 8px';
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);

        div.appendChild(table);

        const btns = document.createElement('div');
        btns.style.marginTop = '12px';
        btns.style.textAlign = 'right';
        const closeBtn = mxUtils.button('Close', () => ui.hideDialog());
        applySharedButtonStyle(closeBtn, 'close'); // CHANGE
        btns.appendChild(closeBtn);
        div.appendChild(btns);

        ui.showDialog(div, 860, 480, true, true);
        elevateTrellisDialog(ui);
    }

    function renderPerennialPreview(ui, result) { // FIX: preview perennials without annual stage columns
        const div = document.createElement('div');
        div.style.padding = '12px';
        div.style.width = '420px';

        const title = document.createElement('div');
        title.textContent = 'Perennial Lifespan Preview';
        title.style.fontWeight = '600';
        title.style.marginBottom = '10px';
        div.appendChild(title);

        [
            ['Plant', result?.plant?.plant_name || ''],
            ['Planting date', result?.lifespanStartISO || ''],
            ['Lifespan end', result?.lifespanEndISO || '']
        ].forEach(([label, value]) => div.appendChild(row(label + ':', makeDisplayValue(value)).row));

        const btns = document.createElement('div');
        btns.style.marginTop = '12px';
        btns.style.textAlign = 'right';
        const closeBtn = mxUtils.button('Close', () => ui.hideDialog());
        applySharedButtonStyle(closeBtn, 'close'); // CHANGE
        btns.appendChild(closeBtn);
        div.appendChild(btns);
        ui.showDialog(div, 440, 240, true, true);
        elevateTrellisDialog(ui);

        function makeDisplayValue(value) {
            const span = document.createElement('span');
            span.textContent = String(value || '');
            return span;
        }
    }



























    async function openPlantEditorDialog(ui, { mode, plantId = null, varietyId = null, startVarietyMode = null } = {}) {

        console.group('[PlantEditorDialog] OPEN');
        console.log('params:', { mode, plantId, varietyId, startVarietyMode });
        console.log('isEdit:', mode === 'edit');
        console.groupEnd();

        const isEdit = mode === 'edit';
        let existing = null;
        if (isEdit) {
            console.log('[PlantEditorDialog] loading plant for edit:', plantId);
            existing = await PlantModel.loadById(Number(plantId));
        }

        function showErrorInline(msg) {
            errorBar.textContent = String(msg || 'Unknown error');
            errorBar.style.display = '';
        }

        function parsePositiveId(v) {
            if (v === null || v === undefined) return null;
            const s = String(v).trim();
            if (!s) return null;
            const n = Number(s);
            if (!Number.isFinite(n) || n <= 0) return null;
            return n;
        }

        const initialPlantId = parsePositiveId(plantId);
        const initialVarietyId = parsePositiveId(varietyId);

        const initialStartVarietyMode = (startVarietyMode === 'add' || startVarietyMode === 'edit') ? startVarietyMode : null;

        let currentPlantId = isEdit ? Number(plantId) : initialPlantId;
        let currentPlantRow = existing ? toPlainDict(existing) : null;
        let currentPlantMode = isEdit ? "edit" : (initialPlantId ? "edit" : "add");

        const NEW_PLANT_VALUE = "__NEW_PLANT__";
        const NEW_VARIETY_VALUE = "__NEW__";
        let currentVarietyMode = null; // 'add' | 'edit' | null       

        let currentVarietyId = null;
        let currentVarietyRow = null;
        let varietiesCache = [];
        let plantEditorSections = [];

        const DIALOG_MODE = {
            PLANT_ADD: 'plant_add',
            PLANT_EDIT: 'plant_edit',
            VARIETY_ADD: 'variety_add',
            VARIETY_EDIT: 'variety_edit'
        };

        function applyDialogMode(nextMode) {
            switch (nextMode) {
                case DIALOG_MODE.PLANT_ADD:
                    currentPlantMode = 'add';
                    currentVarietyMode = null;
                    currentVarietyId = null;
                    currentVarietyRow = null;
                    setPlantControlsEnabled(true);
                    setInlineOverridesVisible(false);
                    varietyNameRow.row.style.display = 'none';
                    maturityClassRow.row.style.display = 'none';
                    maturityClassWarning.style.display = 'none';
                    break;

                case DIALOG_MODE.PLANT_EDIT:
                    currentPlantMode = 'edit';
                    currentVarietyMode = null;
                    currentVarietyId = null;
                    currentVarietyRow = null;
                    setPlantControlsEnabled(true);
                    setInlineOverridesVisible(false);
                    varietyNameRow.row.style.display = 'none';
                    maturityClassRow.row.style.display = 'none';
                    maturityClassWarning.style.display = 'none';
                    break;

                case DIALOG_MODE.VARIETY_ADD:
                    currentVarietyMode = 'add';
                    currentVarietyId = null;
                    currentVarietyRow = null;
                    setPlantControlsEnabled(false);
                    setInlineOverridesVisible(true);
                    varietyNameRow.row.style.display = 'flex';
                    maturityClassRow.row.style.display = 'flex';
                    refreshInlineBaseHints();
                    refreshMaturityClassWarning();
                    break;

                case DIALOG_MODE.VARIETY_EDIT:
                    currentVarietyMode = 'edit';
                    setPlantControlsEnabled(false);
                    setInlineOverridesVisible(true);
                    varietyNameRow.row.style.display = 'flex';
                    maturityClassRow.row.style.display = 'flex';
                    refreshInlineBaseHints();
                    refreshMaturityClassWarning();
                    break;

                default:
                    throw new Error(`Unknown dialog mode: ${nextMode}`);
            }

            syncSaveButtonLabel();
            refreshPlantEditorSectionSummaries();
            syncPlantEditorSectionOpenState();
        }

        const div = document.createElement('div');
        div.className = 'usl-plant-editor';
        div.style.padding = '12px';
        div.style.width = '900px';
        div.style.maxWidth = 'calc(96vw - 24px)';
        div.style.boxSizing = 'border-box';
        div.style.maxHeight = '70vh';
        div.style.overflow = 'auto';

        const plantEditorStyle = document.createElement('style');
        plantEditorStyle.textContent = `
            .usl-plant-editor.usl-plant-editor-variety-mode .usl-plant-editor-override-row{
                display:grid!important;
                grid-template-columns:180px minmax(180px,1fr) 250px;
                gap:8px!important;
                align-items:center!important;
                flex-wrap:nowrap!important;
                margin:6px 0!important;
            }
            .usl-plant-editor.usl-plant-editor-variety-mode .usl-plant-editor-override-row > .usl-scheduler-row-label{
                flex:none!important;
                min-width:0!important;
            }
            .usl-plant-editor.usl-plant-editor-variety-mode .usl-plant-editor-override-row > :not(label):not(.usl-plant-editor-override-controls){
                min-width:0!important;
            }
            .usl-plant-editor.usl-plant-editor-variety-mode .usl-plant-editor-override-row > :not(label):not(.usl-plant-editor-override-controls):not(input[type="checkbox"]){
                width:100%!important;
            }
            .usl-plant-editor.usl-plant-editor-variety-mode .usl-plant-editor-override-controls{
                flex:0 0 250px!important;
                min-width:0!important;
                display:flex;
                gap:6px;
                align-items:center;
                justify-content:flex-end;
            }
            .usl-plant-editor.usl-plant-editor-variety-mode .usl-plant-editor-override-controls input:not([type="checkbox"]){
                flex:0 0 120px;
                width:120px!important;
            }
            .usl-plant-editor.usl-plant-editor-variety-mode .usl-plant-editor-override-base{
                flex:1 1 auto;
                min-width:0;
                overflow:hidden;
                text-overflow:ellipsis;
                white-space:nowrap;
            }
            .usl-plant-editor-layout-panel{
                margin-top:12px;
                padding-top:10px;
                border-top:1px solid #d1d5db;
            }
            .usl-plant-editor-layout-heading{
                font-weight:700;
                font-size:13px;
                margin:0 0 8px 0;
            }
            .usl-plant-editor-layout-actions{
                display:flex;
                gap:8px;
                align-items:center;
                flex-wrap:wrap;
                margin:8px 0;
            }
            .usl-layout-preview{
                min-height:150px;
                border:1px solid #d1d5db;
                border-radius:6px;
                background:#f8fafc;
                overflow:hidden;
                margin-top:8px;
            }
            .usl-layout-preview-svg{
                display:block;
                width:100%;
                height:150px;
            }
            .usl-layout-preview-bed{fill:#f8fafc;stroke:#64748b;stroke-width:2}
            .usl-layout-preview-source{fill:#dcfce7;stroke:#166534;stroke-width:1.5}
            .usl-layout-preview-companion{fill:#dbeafe;stroke:#1d4ed8;stroke-width:1.5}
            .usl-layout-preview-source-dot{fill:#166534;opacity:.78}
            .usl-layout-preview-companion-dot{fill:#1d4ed8;opacity:.78}
            .usl-layout-preview-label{font-size:10px;font-weight:700;fill:#111827}
            .usl-layout-preview-warning{font-size:10px;font-weight:700;fill:#92400e}
            .usl-layout-preview-empty{
                min-height:150px;
                display:flex;
                align-items:center;
                justify-content:center;
                padding:12px;
                color:#4b5563;
                box-sizing:border-box;
                text-align:center;
            }
            .usl-layout-status{
                color:#4b5563;
                margin-top:6px;
                min-height:16px;
            }
            .usl-plant-editor-sections{
                display:grid;
                gap:8px;
            }
            .usl-plant-editor-section{
                border:1px solid #d1d5db;
                border-radius:7px;
                background:#fff;
                overflow:hidden;
            }
            .usl-plant-editor-section-header{
                width:100%;
                border:0;
                background:#f8fafc;
                color:#111827;
                cursor:pointer;
                display:grid;
                grid-template-columns:auto minmax(0,1fr) auto;
                gap:8px;
                align-items:center;
                padding:8px 10px;
                text-align:left;
                font:12px Arial,sans-serif;
            }
            .usl-plant-editor-section-title{
                font-weight:700;
                min-width:0;
            }
            .usl-plant-editor-section-summary{
                min-width:0;
                display:flex;
                gap:5px;
                flex-wrap:wrap;
                justify-content:flex-end;
            }
            .usl-plant-editor-chip{
                border:1px solid #d1d5db;
                border-radius:999px;
                background:#fff;
                color:#374151;
                padding:1px 6px;
                font-size:11px;
                line-height:16px;
                max-width:170px;
                overflow:hidden;
                text-overflow:ellipsis;
                white-space:nowrap;
            }
            .usl-plant-editor-chip-warning{
                border-color:#f59e0b;
                color:#92400e;
                background:#fffbeb;
            }
            .usl-plant-editor-section-toggle{
                color:#4b5563;
                font-weight:700;
            }
            .usl-plant-editor-section-body{
                padding:8px 10px 10px;
            }
            .usl-companion-defaults-list{
                margin-top:10px;
                border-top:1px solid #e5e7eb;
                padding-top:8px;
                display:grid;
                gap:5px;
            }
            .usl-companion-defaults-heading{font-weight:700;color:#374151;font-size:12px}
            .usl-companion-defaults-empty,.usl-companion-defaults-item{font-size:12px;color:#4b5563}
            .usl-companion-defaults-item{border:1px solid #e5e7eb;border-radius:6px;background:#fff;padding:6px 8px}
            .usl-growth-stage-table{
                display:grid;
                grid-template-columns:90px minmax(130px,1fr) repeat(4,78px) 56px 56px 34px;
                gap:6px;
                align-items:center;
                font-size:12px;
            }
            .usl-growth-stage-table input{
                min-width:0;
                padding:4px 5px;
                border:1px solid #d1d5db;
                border-radius:4px;
                box-sizing:border-box;
            }
            .usl-growth-stage-table .usl-growth-stage-header{
                color:#4b5563;
                font-weight:700;
            }
            @media (max-width:760px){
                .usl-plant-editor.usl-plant-editor-variety-mode .usl-plant-editor-override-row{
                    grid-template-columns:minmax(0,1fr);
                }
                .usl-plant-editor.usl-plant-editor-variety-mode .usl-plant-editor-override-controls{
                    justify-content:flex-start;
                    flex-wrap:wrap;
                }
                .usl-plant-editor-section-header{
                    grid-template-columns:minmax(0,1fr) auto;
                }
                .usl-plant-editor-section-summary{
                    grid-column:1 / -1;
                    justify-content:flex-start;
                }
            }
        `;
        div.appendChild(plantEditorStyle);

        const title = document.createElement('div');
        title.textContent = isEdit ? 'Edit plant' : 'Add plant';
        title.style.fontWeight = '600';
        title.style.marginBottom = '10px';
        div.appendChild(title);

        // -------------------- DB helpers (local) --------------------
        async function listActiveMethodCategories() {
            const sql = `
              SELECT method_category_id, method_category_name
              FROM PlantingMethodCategories
              ORDER BY CASE
                         WHEN TRIM(method_category_id) = LOWER(TRIM(method_category_id)) THEN 0
                         ELSE 1
                       END,
                       LOWER(TRIM(method_category_id)),
                       method_category_name;`;
            const rows = await queryAll(sql, []);
            const seen = new Set();
            return rows.flatMap(category => {
                const methodCategoryId = normId(category.method_category_id);
                if (!methodCategoryId || seen.has(methodCategoryId)) return [];
                seen.add(methodCategoryId);
                return [{ ...category, method_category_id: methodCategoryId }];
            });
        }


        async function listAllowedmethodCategoryIdsForPlant(pid) {
            const sql = `
              SELECT method_category_id
              FROM PlantAllowedMethodCategories
              WHERE plant_id = ?;`;
            try {
                const rows = await queryAll(sql, [pid]);
                return rows.map(r => normId(r.method_category_id)).filter(Boolean);
            } catch (_) {
                // legacy fallback unchanged
                const row = await PlantModel.loadById(Number(pid));
                const p = row ? toPlainDict(row) : null;
                const out = [];
                if (p?.direct_sow === 1) out.push('direct_sow');
                if (p?.transplant === 1) out.push('transplant');
                return out;
            }
        }

        async function fetchMethodsForAllowedMethodCategories(methodCategoryIds) {
            if (!methodCategoryIds || methodCategoryIds.length === 0) return [];
            const placeholders = methodCategoryIds.map(() => '?').join(',');
            const sql = `
              SELECT method_id, method_name, method_category_id, tasks_required_json
              FROM PlantingMethods
              WHERE LOWER(TRIM(method_category_id)) IN (${placeholders})
              ORDER BY CASE
                         WHEN TRIM(method_id) = LOWER(TRIM(method_id)) THEN 0
                         ELSE 1
                       END,
                       LOWER(TRIM(method_id)),
                       method_name;`;
            const rows = await queryAll(sql, methodCategoryIds.map(normId));
            const seen = new Set();
            return rows.flatMap(method => {
                const methodId = normId(method.method_id);
                if (!methodId || seen.has(methodId)) return [];
                seen.add(methodId);
                return [{
                    ...method,
                    method_id: methodId,
                    method_category_id: normId(method.method_category_id)
                }];
            });
        }


        async function listPlantsBasic() {
            const sql = `
        SELECT plant_id, plant_name, abbr, annual, biennial, perennial
        FROM Plants
        ORDER BY plant_name;`;
            return await queryAll(sql, []);
        }

        async function listVarietiesForPlant(pid) {
            await PlantVarietyModel.ensureTable();
            // ASSUMPTION: table name PlantVarieties; change if your schema differs
            const sql = `
        SELECT variety_id, variety_name, maturity_class, overrides_json
        FROM PlantVarieties
        WHERE plant_id = ?
        ORDER BY variety_name;`;
            try {
                return await queryAll(sql, [pid]);
            } catch (e) {
                console.warn("listVarietiesForPlant failed; check table name", e);
                return [];
            }
        }

        // -------------------- Top selectors (Plant + Variety) --------------------   
        const selectorWrap = document.createElement('div');
        selectorWrap.style.display = 'flex';
        selectorWrap.style.gap = '8px';
        selectorWrap.style.alignItems = 'center';
        selectorWrap.style.marginBottom = '10px';

        const plantSel = document.createElement('select');
        plantSel.style.padding = '6px';
        plantSel.style.flex = '1';

        const varietySel = document.createElement('select');
        varietySel.style.padding = '6px';
        varietySel.style.flex = '1';

        const plantEditorPlantCombo = createSchedulerCropCombobox(plantSel, {
            className: 'usl-plant-editor-combobox',
            placeholder: 'Search plants...',
            emptyText: 'No plants match',
            buttonFallback: 'Select plant'
        });
        const plantEditorVarietyCombo = createSchedulerCropCombobox(varietySel, {
            className: 'usl-plant-editor-combobox',
            placeholder: 'Search varieties...',
            emptyText: 'No varieties match',
            buttonFallback: 'Select variety'
        });
        plantEditorPlantCombo.root.style.flex = '1 1 0';
        plantEditorVarietyCombo.root.style.flex = '1 1 0';

        const addPlantBtn = mxUtils.button('Add plant', async () => {
            try {
                plantSel.value = NEW_PLANT_VALUE;
                await handlePlantEditorPlantChange(); // FIX: await the async selection workflow directly
            } catch (e) {
                showErrorInline('Add plant error: ' + (e?.message || String(e)));
            }
        });
        applySharedButtonStyle(addPlantBtn, 'add');

        const addVarBtn = mxUtils.button('Add variety', async () => {
            try {
                const pid = Number(currentPlantId);
                if (!Number.isFinite(pid)) {
                    showErrorInline('Save the plant first');
                    return;
                }
                varietySel.value = NEW_VARIETY_VALUE;
                await handlePlantEditorVarietyChange(); // FIX: await the async selection workflow directly
            } catch (e) {
                showErrorInline('Add variety error: ' + (e?.message || String(e)));
            }
        });

        applySharedButtonStyle(addVarBtn, 'add');

        selectorWrap.appendChild(plantEditorPlantCombo.root);
        selectorWrap.appendChild(plantEditorVarietyCombo.root);
        selectorWrap.appendChild(addPlantBtn);
        selectorWrap.appendChild(addVarBtn);
        div.appendChild(selectorWrap);

        // -------------------- Layout (single column; inline overrides) --------------------
        const leftCol = document.createElement('div');
        leftCol.style.minWidth = '0';
        leftCol.className = 'usl-plant-editor-sections';
        div.appendChild(leftCol);

        function plantEditorNode(item) {
            return item && item.row ? item.row : item;
        }

        function makePlantEditorChip(text, kind = '') {
            const chip = document.createElement('span');
            chip.className = 'usl-plant-editor-chip' + (kind ? ` usl-plant-editor-chip-${kind}` : '');
            chip.textContent = String(text || '');
            return chip;
        }

        function createPlantEditorSection(titleText, items, options = {}) {
            const section = document.createElement('section');
            section.className = 'usl-plant-editor-section';
            const header = document.createElement('button');
            header.type = 'button';
            header.className = 'usl-plant-editor-section-header';
            const titleEl = document.createElement('span');
            titleEl.className = 'usl-plant-editor-section-title';
            titleEl.textContent = titleText;
            const summary = document.createElement('span');
            summary.className = 'usl-plant-editor-section-summary';
            const toggle = document.createElement('span');
            toggle.className = 'usl-plant-editor-section-toggle';
            const body = document.createElement('div');
            body.className = 'usl-plant-editor-section-body';
            (items || []).forEach(item => {
                const node = plantEditorNode(item);
                if (node) body.appendChild(node);
            });
            let open = options.defaultOpen !== false;
            function setOpen(nextOpen) {
                open = !!nextOpen;
                body.style.display = open ? '' : 'none';
                toggle.textContent = open ? 'v' : '>';
                section.setAttribute('data-open', open ? 'true' : 'false');
            }
            function refreshSummary() {
                summary.innerHTML = '';
                const chips = typeof options.summaryProvider === 'function' ? options.summaryProvider() : [];
                (chips || []).filter(Boolean).slice(0, 5).forEach(chip => {
                    summary.appendChild(makePlantEditorChip(chip.text || chip, chip.kind || ''));
                });
            }
            header.appendChild(titleEl);
            header.appendChild(summary);
            header.appendChild(toggle);
            header.addEventListener('click', () => setOpen(!open));
            section.appendChild(header);
            section.appendChild(body);
            setOpen(open);
            refreshSummary();
            return {
                section,
                key: options.key || titleText,
                overrideKeys: options.overrideKeys || [],
                setOpen,
                refreshSummary
            };
        }

        function labelForSelectValue(selectEl) {
            const opt = selectEl && selectEl.options ? selectEl.options[selectEl.selectedIndex] : null;
            return String(opt?.textContent || '').trim();
        }

        function formatEditorNumber(value, suffix = '') {
            const n = finiteNumberOrNull(value);
            if (n == null) return '';
            const rounded = Math.abs(n) >= 10 ? Math.round(n) : Math.round(n * 100) / 100;
            return `${rounded}${suffix}`;
        }

        function countCheckedOverrides(keys) {
            return (keys || []).filter(key => overrideInlineByKey[key]?.chk?.checked).length;
        }

        function sectionOverrideChip(keys) {
            const count = countCheckedOverrides(keys);
            return count ? { text: `${count} override${count === 1 ? '' : 's'}`, kind: 'warning' } : null;
        }

        function refreshPlantEditorSectionSummaries() {
            (plantEditorSections || []).forEach(section => section.refreshSummary());
        }

        function syncPlantEditorSectionOpenState() {
            if (!plantEditorSections || !plantEditorSections.length) return;
            const varietyMode = currentVarietyMode === 'add' || currentVarietyMode === 'edit';
            plantEditorSections.forEach(section => {
                if (!varietyMode) {
                    section.setOpen(section.key === 'basics' || section.key === 'maturity');
                    return;
                }
                const hasOverrides = countCheckedOverrides(section.overrideKeys) > 0;
                const hasWarning = section.key === 'basics' && maturityClassWarning.style.display !== 'none';
                section.setOpen(section.key === 'basics' || hasOverrides || hasWarning);
            });
        }

        // --- Identity ---
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.value = existing?.plant_name ?? '';
        nameInput.style.width = '100%';
        nameInput.style.padding = '6px';

        const abbrInput = document.createElement('input');
        abbrInput.type = 'text';
        abbrInput.value = existing?.abbr ?? '';
        abbrInput.style.width = '100%';
        abbrInput.style.padding = '6px';

        const varietyNameInput = document.createElement('input');
        varietyNameInput.type = 'text';
        varietyNameInput.value = '';
        varietyNameInput.style.width = '100%';
        varietyNameInput.style.padding = '6px';

        const varietyNameRow = row('Variety name:', varietyNameInput);
        varietyNameRow.row.style.display = 'none';
        const maturityClassSel = makeSelect([
            { value: '', label: '' },
            { value: 'early', label: 'Early' },
            { value: 'mid', label: 'Mid' },
            { value: 'late', label: 'Late' }
        ], '');
        const maturityClassRow = row('Maturity class:', maturityClassSel);
        maturityClassRow.row.style.display = 'none';
        const maturityClassWarning = document.createElement('div');
        maturityClassWarning.style.display = 'none';
        maturityClassWarning.style.fontSize = '12px';
        maturityClassWarning.style.color = '#92400e';
        maturityClassWarning.style.margin = '0 0 8px 150px';

        const plantNameRow = row('Plant name:', nameInput);
        leftCol.appendChild(plantNameRow.row);
        leftCol.appendChild(varietyNameRow.row);
        leftCol.appendChild(maturityClassRow.row);
        leftCol.appendChild(maturityClassWarning);
        const abbrRow = row('Abbreviation (abbr):', abbrInput);
        leftCol.appendChild(abbrRow.row);

        function buildDraftVarietyRowForMaturityWarning() {
            return {
                variety_id: currentVarietyId || `draft:${String(varietyNameInput.value || '').trim().toLocaleLowerCase()}`,
                plant_id: currentPlantId,
                variety_name: String(varietyNameInput.value || '').trim(),
                maturity_class: maturityClassSel.value,
                overrides_json: JSON.stringify(buildOverridesFromUI())
            };
        }

        function varietiesForMaturityWarning(draftRow) {
            const draftKey = makeVarietyRowKey(draftRow);
            const rows = Array.from(varietiesCache || []).filter(row => makeVarietyRowKey(row) !== draftKey);
            rows.push(draftRow);
            return rows;
        }

        function refreshMaturityClassWarning() {
            const draftRow = buildDraftVarietyRowForMaturityWarning();
            const mismatch = manualVarietyMaturityMismatch(varietiesForMaturityWarning(draftRow), draftRow);
            if (!mismatch) {
                maturityClassWarning.style.display = 'none';
                maturityClassWarning.textContent = '';
                refreshPlantEditorSectionSummaries();
                syncPlantEditorSectionOpenState();
                return;
            }
            const manualLabel = VARIETY_MATURITY_CLASS_LABELS[mismatch.manualClass].replace(' varieties', '');
            const inferredLabel = VARIETY_MATURITY_CLASS_LABELS[mismatch.inferredClass].replace(' varieties', '');
            const sourceLabel = mismatch.source === 'days_maturity' ? 'DTM' : 'GDD';
            maturityClassWarning.textContent = `Manual class is ${manualLabel}, but ${sourceLabel} ranking suggests ${inferredLabel}. Saving is allowed.`;
            maturityClassWarning.style.display = 'block';
            refreshPlantEditorSectionSummaries();
            syncPlantEditorSectionOpenState();
        }
        maturityClassSel.addEventListener('change', refreshMaturityClassWarning);
        varietyNameInput.addEventListener('input', refreshMaturityClassWarning);

        // --- Lifecycle ---
        const typeSel = makeSelect([
            { value: 'annual', label: 'Annual' },
            { value: 'biennial', label: 'Biennial' },
            { value: 'perennial', label: 'Perennial' }
        ], (existing?.perennial === 1) ? 'perennial' : (existing?.biennial === 1 ? 'biennial' : 'annual'));

        const lifespanInput = makeNullableNumber(existing?.lifespan_years ?? null, { min: 1, step: 1 });
        const overwinterChk = makeCheckbox(existing?.overwinter_ok === 1);

        const lifecycleRow = row('Lifecycle:', typeSel);
        leftCol.appendChild(lifecycleRow.row);

        const lifeRow = row('Lifespan (years):', lifespanInput);
        leftCol.appendChild(lifeRow.row);

        const overwinterRow = row('Overwinter OK:', overwinterChk);
        leftCol.appendChild(overwinterRow.row);

        function lifecycleToFixedYears(lifecycle) {
            if (lifecycle === 'annual') return 1;
            if (lifecycle === 'biennial') return 2;
            return null; // perennial is variable                                             
        }

        function syncLifecycleFields() {
            const lifecycle = typeSel.value;
            const fixed = lifecycleToFixedYears(lifecycle);

            if (fixed != null) {
                lifespanInput.value = String(fixed);
                lifespanInput.disabled = true;
                lifespanInput.min = '0';
                return;
            }

            // Perennial: enabled (unless variety-mode disables later) and min 3            
            lifespanInput.min = '3';
            const cur = Number(String(lifespanInput.value || '').trim());
            if (!Number.isFinite(cur) || cur < 3) lifespanInput.value = '3';
            lifespanInput.disabled = false;
        }

        syncLifecycleFields();
        typeSel.addEventListener('change', syncLifecycleFields);

        // --- Methods (DB-driven checkboxes) ---
        const methodsBox = document.createElement('div');
        methodsBox.style.display = 'flex';
        methodsBox.style.flexDirection = 'column';
        methodsBox.style.gap = '6px';

        const allowedMethodsRow = row('Allowed methods:', methodsBox);
        leftCol.appendChild(allowedMethodsRow.row);

        const methodChecksById = new Map(); // method_category_id -> checkbox                      

        const categories = await listActiveMethodCategories();
        const allowedInitial = isEdit ? await listAllowedmethodCategoryIdsForPlant(Number(plantId)) : [];
        const allowedInitialSet = new Set(allowedInitial);

        for (const c of categories) {
            const chk = makeCheckbox(allowedInitialSet.has(c.method_category_id));
            methodChecksById.set(c.method_category_id, chk);
            methodsBox.appendChild(row(c.method_category_name + ':', chk).row);
        }


        function getAllowedmethodCategoryIdsFromUI() {
            const ids = [];
            for (const [mid, chk] of methodChecksById.entries()) {
                if (chk.checked) ids.push(mid);
            }
            return ids;
        }

        // --- Default planting method (filtered by allowed methods) ---
        const defaultMethodSel = document.createElement('select');
        defaultMethodSel.style.padding = '6px';
        defaultMethodSel.style.width = '100%';
        const defaultMethodRow = row('Default planting method:', defaultMethodSel);
        leftCol.appendChild(defaultMethodRow.row);

        function selectDefaultMethodFromPlantRow() {
            const wanted = normId(currentPlantRow?.default_planting_method);

            if (!wanted) return;

            const valid = new Set(Array.from(defaultMethodSel.options).map(o => String(o.value)));
            if (valid.has(wanted)) {
                defaultMethodSel.value = wanted;
            } else {
                console.warn("[DefaultMethod] saved value not in options", { wanted });
            }
        }

        async function rebuildDefaultMethodOptions() {
            const allowed = getAllowedmethodCategoryIdsFromUI();
            const previous = defaultMethodSel.value;

            defaultMethodSel.innerHTML = '';

            const autoOpt = document.createElement('option');
            autoOpt.value = '';
            autoOpt.textContent = '';
            defaultMethodSel.appendChild(autoOpt);

            const methods = await fetchMethodsForAllowedMethodCategories(allowed);
            for (const m of methods) {
                const opt = document.createElement('option');
                opt.value = normId(m.method_id);
                opt.textContent = m.method_name || m.method_id;
                defaultMethodSel.appendChild(opt);
            }

            const validValues = new Set(Array.from(defaultMethodSel.options).map(o => o.value));
            const fallback = normId(currentPlantRow?.default_planting_method);

            defaultMethodSel.value = validValues.has(previous)
                ? previous
                : (validValues.has(fallback) ? fallback : '');
        }

        await rebuildDefaultMethodOptions();
        selectDefaultMethodFromPlantRow();

        for (const chk of methodChecksById.values()) {
            chk.addEventListener('change', async () => {
                await rebuildDefaultMethodOptions();
                selectDefaultMethodFromPlantRow();
            });
        }

        // -------------------- Inline override system --------------------
        function fmtBaseVal(key) {
            const v = currentPlantRow ? currentPlantRow[key] : null;
            if (v == null || v === '') return '(null)';
            return String(v);
        }

        const overrideInlineByKey = {}; // key -> { def, chk, input, wrap, baseHint }     

        function makeInlineOverrideControls(def) {
            const wrap = document.createElement('div');
            wrap.style.display = 'flex';
            wrap.style.gap = '6px';
            wrap.style.alignItems = 'center';
            wrap.style.justifyContent = 'flex-end';

            const chk = makeCheckbox(false);

            let input = null;
            if (def.type === 'bool01') input = makeCheckbox(false);
            else if (def.type === 'int_ge0') input = makeNullableNumber(null, { min: 0, step: 1 });
            else if (def.type === 'num_ge0') input = makeNullableNumber(null, { min: 0, step: def.step ?? 0.1 });
            else if (def.type === 'nullable_num') input = makeNullableNumber(null, { step: def.step ?? 0.1 });
            else {
                input = document.createElement('input');
                input.type = 'text';
            }

            if (def.type !== 'bool01') {
                input.style.width = '120px';
                input.style.padding = '6px';
            } else {
                input.style.marginLeft = '2px';
            }

            input.disabled = true;

            chk.addEventListener('change', () => {
                input.disabled = !chk.checked;
                if (!chk.checked) {
                    if (def.type === 'bool01') input.checked = false;
                    else input.value = '';
                }
                refreshPlantEditorSectionSummaries();
                syncPlantEditorSectionOpenState();
            });

            const baseHint = document.createElement('span');
            baseHint.className = 'usl-plant-editor-override-base';
            baseHint.textContent = 'Base: ' + fmtBaseVal(def.key);
            baseHint.style.fontSize = '12px';
            baseHint.style.opacity = '0.75';
            baseHint.style.whiteSpace = 'nowrap';

            wrap.appendChild(chk);
            wrap.appendChild(input);
            wrap.appendChild(baseHint);
            wrap.classList.add('usl-plant-editor-override-controls');

            wrap.style.display = 'none'; // hidden until variety mode
            return { wrap, chk, input, baseHint };
        }

        function attachInlineOverrideToRow(rowObj, def) {
            rowObj.row.classList.add('usl-plant-editor-override-row');
            rowObj.row.style.display = 'flex';
            rowObj.row.style.alignItems = 'center';
            rowObj.row.style.gap = '8px';

            const o = makeInlineOverrideControls(def);
            rowObj.row.appendChild(o.wrap);

            overrideInlineByKey[def.key] = { def, chk: o.chk, input: o.input, wrap: o.wrap, baseHint: o.baseHint };
        }

        function setInlineOverridesVisible(show) {
            div.classList.toggle('usl-plant-editor-variety-mode', !!show);
            for (const key of Object.keys(overrideInlineByKey)) {
                overrideInlineByKey[key].wrap.style.display = show ? 'flex' : 'none';
            }
        }

        function refreshInlineBaseHints() {
            for (const key of Object.keys(overrideInlineByKey)) {
                overrideInlineByKey[key].baseHint.textContent = 'Base: ' + fmtBaseVal(key);
            }
        }

        const OVERRIDE_SCHEMA = [
            { key: 'days_maturity', type: 'int_ge0' },
            { key: 'gdd_to_maturity', type: 'num_ge0', step: 1 },
            { key: 'days_germ', type: 'int_ge0' },
            { key: 'days_transplant', type: 'int_ge0' },
            { key: 'yield_per_plant_kg', type: 'num_ge0', step: 0.001 },
            { key: 'harvest_window_days', type: 'int_ge0' },

            { key: 'soil_temp_min_plant_c', type: 'nullable_num', step: 0.1 },
            { key: 'start_cooling_threshold_c', type: 'nullable_num', step: 0.1 },
            { key: 'overwinter_ok', type: 'bool01' },

            { key: 'tbase_c', type: 'nullable_num', step: 0.1 },
            { key: 'tmin_c', type: 'nullable_num', step: 0.1 },
            { key: 'topt_low_c', type: 'nullable_num', step: 0.1 },
            { key: 'topt_high_c', type: 'nullable_num', step: 0.1 },
            { key: 'tmax_c', type: 'nullable_num', step: 0.1 },
            { key: 'killtemp_c', type: 'nullable_num', step: 0.1 },

            { key: 'establishment_temp_max_c', type: 'nullable_num', step: 0.1 },
            { key: 'establishment_heat_window_days', type: 'int_ge0' },
            { key: 'establishment_heat_policy', type: 'text' },
            { key: 'quality_temp_max_c', type: 'nullable_num', step: 0.1 },
            { key: 'heat_stress_stage', type: 'text' },
            { key: 'quality_heat_policy', type: 'text' },
            { key: 'photoperiod_response', type: 'text' },
            { key: 'critical_daylength_hours', type: 'nullable_num', step: 0.1 },
            { key: 'photoperiod_stage', type: 'text' },
            { key: 'photoperiod_policy', type: 'text' },
            { key: 'chilling_required_days', type: 'nullable_num', step: 0.1 },
            { key: 'chilling_required_hours', type: 'nullable_num', step: 1 },
            { key: 'chilling_temp_min_c', type: 'nullable_num', step: 0.1 },
            { key: 'chilling_temp_max_c', type: 'nullable_num', step: 0.1 },
            { key: 'chilling_stage', type: 'text' },
            { key: 'chilling_policy', type: 'text' },
            { key: 'diagnostic_policy', type: 'text' },

            { key: 'veg_height_cm', type: 'num_ge0', step: 1 },
            { key: 'veg_diameter_cm', type: 'num_ge0', step: 1 },
            { key: 'spacing_cm', type: 'num_ge0', step: 1 },
        ];

        function readOverrideValue(def, inputEl) {
            if (def.type === 'bool01') return inputEl.checked ? 1 : 0;
            if (def.type === 'int_ge0') return readIntGE0(inputEl);
            if (def.type === 'num_ge0') return readNumGE0(inputEl);
            if (def.type === 'nullable_num') return readNullableNumber(inputEl);
            if (def.type === 'text') return String(inputEl.value || '').trim() || null;
            return null;
        }

        function applyOverridesToUI(overridesObj) {
            for (const key of Object.keys(overrideInlineByKey)) {
                const { def, chk, input } = overrideInlineByKey[key];
                const has = Object.prototype.hasOwnProperty.call(overridesObj, key);
                chk.checked = has;
                input.disabled = !has;

                if (def.type === 'bool01') input.checked = has ? (Number(overridesObj[key] ?? 0) === 1) : false;
                else input.value = has ? String(overridesObj[key] ?? '') : '';
            }
            refreshPlantEditorSectionSummaries();
        }

        function buildOverridesFromUI() {
            const out = {};
            for (const key of Object.keys(overrideInlineByKey)) {
                const { def, chk, input } = overrideInlineByKey[key];
                if (!chk.checked) continue;
                out[key] = readOverrideValue(def, input);
            }
            return out;
        }

        // --- Maturity budget ---
        const hasGdd = Number(existing?.gdd_to_maturity ?? 0) > 0;
        const budgetModeSel = makeSelect([
            { value: 'gdd', label: 'GDD to maturity' },
            { value: 'days', label: 'Days to maturity' }
        ], hasGdd ? 'gdd' : 'days');

        const gddInput = makeNullableNumber(existing?.gdd_to_maturity ?? null, { min: 0, step: 1 });
        const daysMatInput = makeNullableNumber(existing?.days_maturity ?? null, { min: 0, step: 1 });

        const maturityBudgetRow = row('Maturity budget:', budgetModeSel);
        leftCol.appendChild(maturityBudgetRow.row);

        const gddRow = row('GDD to maturity:', gddInput);
        leftCol.appendChild(gddRow.row);
        attachInlineOverrideToRow(gddRow, { key: 'gdd_to_maturity', type: 'num_ge0', step: 1 });

        const daysRow = row('Days to maturity:', daysMatInput);
        leftCol.appendChild(daysRow.row);
        attachInlineOverrideToRow(daysRow, { key: 'days_maturity', type: 'int_ge0' });
        for (const key of ['days_maturity', 'gdd_to_maturity']) {
            const controls = overrideInlineByKey[key];
            if (!controls) continue;
            controls.chk.addEventListener('change', refreshMaturityClassWarning);
            controls.input.addEventListener('input', refreshMaturityClassWarning);
            controls.input.addEventListener('change', refreshMaturityClassWarning);
        }

        function syncBudgetModeUI() {
            const mode = budgetModeSel.value;
            gddRow.row.style.display = (mode === 'gdd') ? 'flex' : 'none';
            daysRow.row.style.display = (mode === 'days') ? 'flex' : 'none';
        }

        syncBudgetModeUI();
        budgetModeSel.addEventListener('change', syncBudgetModeUI);

        // --- Timing ---
        const daysGermInput = makeNullableNumber(existing?.days_germ ?? 0, { min: 0, step: 1 });
        const daysTransInput = makeNullableNumber(existing?.days_transplant ?? 0, { min: 0, step: 1 });

        const daysGermRow = row('Days to germ:', daysGermInput);
        leftCol.appendChild(daysGermRow.row);
        attachInlineOverrideToRow(daysGermRow, { key: 'days_germ', type: 'int_ge0' });

        const daysTransRow = row('Days to transplant:', daysTransInput);
        leftCol.appendChild(daysTransRow.row);
        attachInlineOverrideToRow(daysTransRow, { key: 'days_transplant', type: 'int_ge0' });

        // --- Yield ---
        const yieldInput = makeNullableNumber(existing?.yield_per_plant_kg ?? null, { min: 0, step: 0.001 });
        const hwInput = makeNullableNumber(existing?.harvest_window_days ?? null, { min: 0, step: 1 });

        const yieldRow = row('Yield per plant (kg):', yieldInput);
        leftCol.appendChild(yieldRow.row);
        attachInlineOverrideToRow(yieldRow, { key: 'yield_per_plant_kg', type: 'num_ge0', step: 0.001 });

        const hwRow = row('Harvest window (days):', hwInput);
        leftCol.appendChild(hwRow.row);
        attachInlineOverrideToRow(hwRow, { key: 'harvest_window_days', type: 'int_ge0' });

        // --- Temperature envelope ---
        const tbaseInput = makeNullableNumber(existing?.tbase_c ?? null, { step: 0.1 });
        const tminInput = makeNullableNumber(existing?.tmin_c ?? null, { step: 0.1 });
        const toptLowInput = makeNullableNumber(existing?.topt_low_c ?? null, { step: 0.1 });
        const toptHighInput = makeNullableNumber(existing?.topt_high_c ?? null, { step: 0.1 });
        const tmaxInput = makeNullableNumber(existing?.tmax_c ?? null, { step: 0.1 });
        const killTempInput = makeNullableNumber(existing?.killtemp_c ?? null, { step: 0.1 });

        const tbaseRow = row('Tbase (C):', tbaseInput);
        leftCol.appendChild(tbaseRow.row);
        attachInlineOverrideToRow(tbaseRow, { key: 'tbase_c', type: 'nullable_num', step: 0.1 });

        const tminRow = row('Tmin (C):', tminInput);
        leftCol.appendChild(tminRow.row);
        attachInlineOverrideToRow(tminRow, { key: 'tmin_c', type: 'nullable_num', step: 0.1 });

        const toptLowRow = row('Topt low (C):', toptLowInput);
        leftCol.appendChild(toptLowRow.row);
        attachInlineOverrideToRow(toptLowRow, { key: 'topt_low_c', type: 'nullable_num', step: 0.1 });

        const toptHighRow = row('Topt high (C):', toptHighInput);
        leftCol.appendChild(toptHighRow.row);
        attachInlineOverrideToRow(toptHighRow, { key: 'topt_high_c', type: 'nullable_num', step: 0.1 });

        const tmaxRow = row('Tmax (C):', tmaxInput);
        leftCol.appendChild(tmaxRow.row);
        attachInlineOverrideToRow(tmaxRow, { key: 'tmax_c', type: 'nullable_num', step: 0.1 });

        const killTempRow = row('Kill temp (C):', killTempInput);
        leftCol.appendChild(killTempRow.row);
        attachInlineOverrideToRow(killTempRow, { key: 'killtemp_c', type: 'nullable_num', step: 0.1 });

        // --- Gates ---
        const soilMinInput = makeNullableNumber(existing?.soil_temp_min_plant_c ?? null, { step: 0.1 });
        const coolThreshInput = makeNullableNumber(existing?.start_cooling_threshold_c ?? null, { step: 0.1 });

        const soilMinRow = row('Soil temp min plant (C):', soilMinInput);
        leftCol.appendChild(soilMinRow.row);
        attachInlineOverrideToRow(soilMinRow, { key: 'soil_temp_min_plant_c', type: 'nullable_num', step: 0.1 });

        const coolThreshRow = row('Start cooling threshold (C):', coolThreshInput);
        leftCol.appendChild(coolThreshRow.row);
        attachInlineOverrideToRow(coolThreshRow, { key: 'start_cooling_threshold_c', type: 'nullable_num', step: 0.1 });

        // --- Heat, light, and chilling diagnostics ---
        const policyOptions = [
            { value: '', label: '' },
            { value: 'off', label: 'Off' },
            { value: 'warn', label: 'Warn' },
            { value: 'block', label: 'Block' }
        ];
        const stageOptions = [
            { value: '', label: '' },
            { value: 'establishment', label: 'Establishment' },
            { value: 'germination', label: 'Germination' },
            { value: 'maturity', label: 'Maturity' },
            { value: 'harvest_quality', label: 'Harvest quality' },
            { value: 'harvest_end', label: 'Harvest end' }
        ];
        const photoperiodResponseOptions = [
            { value: '', label: '' },
            { value: 'day_neutral', label: 'Day neutral' },
            { value: 'long_day', label: 'Long day' },
            { value: 'short_day', label: 'Short day' }
        ];
        const establishmentMaxInput = makeNullableNumber(existing?.establishment_temp_max_c ?? null, { step: 0.1 });
        const establishmentDaysInput = makeNullableNumber(existing?.establishment_heat_window_days ?? null, { min: 0, step: 1 });
        const establishmentPolicySel = makeSelect(policyOptions, existing?.establishment_heat_policy || '');
        const qualityMaxInput = makeNullableNumber(existing?.quality_temp_max_c ?? null, { step: 0.1 });
        const heatStageSel = makeSelect(stageOptions, existing?.heat_stress_stage || '');
        const qualityPolicySel = makeSelect(policyOptions, existing?.quality_heat_policy || '');
        const photoperiodResponseSel = makeSelect(photoperiodResponseOptions, existing?.photoperiod_response || '');
        const criticalDaylengthInput = makeNullableNumber(existing?.critical_daylength_hours ?? null, { min: 0, step: 0.1 });
        const photoperiodStageSel = makeSelect(stageOptions, existing?.photoperiod_stage || '');
        const photoperiodPolicySel = makeSelect(policyOptions, existing?.photoperiod_policy || '');
        const chillingDaysInput = makeNullableNumber(existing?.chilling_required_days ?? null, { min: 0, step: 0.1 });
        const chillingHoursInput = makeNullableNumber(existing?.chilling_required_hours ?? null, { min: 0, step: 1 });
        const chillingMinInput = makeNullableNumber(existing?.chilling_temp_min_c ?? null, { step: 0.1 });
        const chillingMaxInput = makeNullableNumber(existing?.chilling_temp_max_c ?? null, { step: 0.1 });
        const chillingStageSel = makeSelect(stageOptions, existing?.chilling_stage || '');
        const chillingPolicySel = makeSelect(policyOptions, existing?.chilling_policy || '');
        const diagnosticPolicySel = makeSelect(policyOptions, existing?.diagnostic_policy || '');

        const establishmentMaxRow = row('Establishment max temp (C):', establishmentMaxInput);
        leftCol.appendChild(establishmentMaxRow.row);
        attachInlineOverrideToRow(establishmentMaxRow, { key: 'establishment_temp_max_c', type: 'nullable_num', step: 0.1 });
        const establishmentDaysRow = row('Establishment heat days:', establishmentDaysInput);
        leftCol.appendChild(establishmentDaysRow.row);
        attachInlineOverrideToRow(establishmentDaysRow, { key: 'establishment_heat_window_days', type: 'int_ge0' });
        const establishmentPolicyRow = row('Establishment heat policy:', establishmentPolicySel);
        leftCol.appendChild(establishmentPolicyRow.row);
        attachInlineOverrideToRow(establishmentPolicyRow, { key: 'establishment_heat_policy', type: 'text' });
        const qualityMaxRow = row('Quality max temp (C):', qualityMaxInput);
        leftCol.appendChild(qualityMaxRow.row);
        attachInlineOverrideToRow(qualityMaxRow, { key: 'quality_temp_max_c', type: 'nullable_num', step: 0.1 });
        const heatStageRow = row('Heat stress stage:', heatStageSel);
        leftCol.appendChild(heatStageRow.row);
        attachInlineOverrideToRow(heatStageRow, { key: 'heat_stress_stage', type: 'text' });
        const qualityPolicyRow = row('Quality heat policy:', qualityPolicySel);
        leftCol.appendChild(qualityPolicyRow.row);
        attachInlineOverrideToRow(qualityPolicyRow, { key: 'quality_heat_policy', type: 'text' });
        const photoperiodResponseRow = row('Photoperiod response:', photoperiodResponseSel);
        leftCol.appendChild(photoperiodResponseRow.row);
        attachInlineOverrideToRow(photoperiodResponseRow, { key: 'photoperiod_response', type: 'text' });
        const criticalDaylengthRow = row('Critical daylength (h):', criticalDaylengthInput);
        leftCol.appendChild(criticalDaylengthRow.row);
        attachInlineOverrideToRow(criticalDaylengthRow, { key: 'critical_daylength_hours', type: 'nullable_num', step: 0.1 });
        const photoperiodStageRow = row('Photoperiod stage:', photoperiodStageSel);
        leftCol.appendChild(photoperiodStageRow.row);
        attachInlineOverrideToRow(photoperiodStageRow, { key: 'photoperiod_stage', type: 'text' });
        const photoperiodPolicyRow = row('Photoperiod policy:', photoperiodPolicySel);
        leftCol.appendChild(photoperiodPolicyRow.row);
        attachInlineOverrideToRow(photoperiodPolicyRow, { key: 'photoperiod_policy', type: 'text' });
        const chillingDaysRow = row('Chilling required days:', chillingDaysInput);
        leftCol.appendChild(chillingDaysRow.row);
        attachInlineOverrideToRow(chillingDaysRow, { key: 'chilling_required_days', type: 'nullable_num', step: 0.1 });
        const chillingHoursRow = row('Chilling required hours:', chillingHoursInput);
        leftCol.appendChild(chillingHoursRow.row);
        attachInlineOverrideToRow(chillingHoursRow, { key: 'chilling_required_hours', type: 'nullable_num', step: 1 });
        const chillingMinRow = row('Chilling min temp (C):', chillingMinInput);
        leftCol.appendChild(chillingMinRow.row);
        attachInlineOverrideToRow(chillingMinRow, { key: 'chilling_temp_min_c', type: 'nullable_num', step: 0.1 });
        const chillingMaxRow = row('Chilling max temp (C):', chillingMaxInput);
        leftCol.appendChild(chillingMaxRow.row);
        attachInlineOverrideToRow(chillingMaxRow, { key: 'chilling_temp_max_c', type: 'nullable_num', step: 0.1 });
        const chillingStageRow = row('Chilling stage:', chillingStageSel);
        leftCol.appendChild(chillingStageRow.row);
        attachInlineOverrideToRow(chillingStageRow, { key: 'chilling_stage', type: 'text' });
        const chillingPolicyRow = row('Chilling policy:', chillingPolicySel);
        leftCol.appendChild(chillingPolicyRow.row);
        attachInlineOverrideToRow(chillingPolicyRow, { key: 'chilling_policy', type: 'text' });
        const diagnosticPolicyRow = row('Default diagnostic policy:', diagnosticPolicySel);
        leftCol.appendChild(diagnosticPolicyRow.row);
        attachInlineOverrideToRow(diagnosticPolicyRow, { key: 'diagnostic_policy', type: 'text' });

        // --- Vegetative geometry ---
        const vegHeightInput = makeNullableNumber(existing?.veg_height_cm ?? null, { min: 0, step: 1 });
        const vegDiamInput = makeNullableNumber(existing?.veg_diameter_cm ?? null, { min: 0, step: 1 });
        const spacingInput = makeNullableNumber(existing?.spacing_cm ?? null, { min: 0, step: 1 });
        const spacingXInput = makeNullableNumber(existing?.spacing_x_cm ?? null, { min: 0, step: 1 });
        const spacingYInput = makeNullableNumber(existing?.spacing_y_cm ?? null, { min: 0, step: 1 });

        const vegHeightRow = row('Veg height (cm):', vegHeightInput);
        leftCol.appendChild(vegHeightRow.row);
        attachInlineOverrideToRow(vegHeightRow, { key: 'veg_height_cm', type: 'num_ge0', step: 1 });

        const vegDiamRow = row('Veg diameter (cm):', vegDiamInput);
        leftCol.appendChild(vegDiamRow.row);
        attachInlineOverrideToRow(vegDiamRow, { key: 'veg_diameter_cm', type: 'num_ge0', step: 1 });

        const spacingRow = row('Spacing (cm):', spacingInput);
        leftCol.appendChild(spacingRow.row);
        attachInlineOverrideToRow(spacingRow, { key: 'spacing_cm', type: 'num_ge0', step: 1 });
        const spacingXRow = row('Spacing X (cm):', spacingXInput);
        leftCol.appendChild(spacingXRow.row);
        attachInlineOverrideToRow(spacingXRow, { key: 'spacing_x_cm', type: 'num_ge0', step: 1 });
        const spacingYRow = row('Spacing Y (cm):', spacingYInput);
        leftCol.appendChild(spacingYRow.row);
        attachInlineOverrideToRow(spacingYRow, { key: 'spacing_y_cm', type: 'num_ge0', step: 1 });

        const growthStagePanel = document.createElement('div');
        growthStagePanel.className = 'usl-plant-editor-layout-panel';
        const growthStageHeading = document.createElement('div');
        growthStageHeading.className = 'usl-plant-editor-layout-heading';
        growthStageHeading.textContent = 'Growing stages';
        growthStagePanel.appendChild(growthStageHeading);
        const growthStageTable = document.createElement('div');
        growthStageTable.className = 'usl-growth-stage-table';
        growthStagePanel.appendChild(growthStageTable);
        const growthStageActions = document.createElement('div');
        growthStageActions.className = 'usl-plant-editor-layout-actions';
        const addGrowthStageBtn = mxUtils.button('Add stage', () => {
            addGrowthStageEditorRow({
                stage_key: '',
                stage_label: '',
                gdd_ratio: 1,
                spacing_ratio: '',
                plant_diameter_ratio: '',
                plant_height_ratio: '',
                active: 1,
                is_default: 0
            });
        });
        applySharedButtonStyle(addGrowthStageBtn, 'add');
        growthStageActions.appendChild(addGrowthStageBtn);
        growthStagePanel.appendChild(growthStageActions);
        const growthStageStatus = document.createElement('div');
        growthStageStatus.className = 'usl-layout-status';
        growthStagePanel.appendChild(growthStageStatus);
        leftCol.appendChild(growthStagePanel);
        let growthStageEditorRows = [];

        const companionLayoutPanel = document.createElement('div');
        companionLayoutPanel.className = 'usl-plant-editor-layout-panel';
        companionLayoutPanel.style.display = 'none'; // CHANGE: pair layout authoring moved out of Plant Editor; set defaults live in the diagram spacing overlay.
        const companionLayoutHeading = document.createElement('div');
        companionLayoutHeading.className = 'usl-plant-editor-layout-heading';
        companionLayoutHeading.textContent = '';
        companionLayoutPanel.appendChild(companionLayoutHeading);
        const companionLayoutRelSel = document.createElement('select');
        companionLayoutRelSel.style.width = '100%';
        companionLayoutRelSel.style.padding = '6px';
        companionLayoutPanel.appendChild(row('Pair:', companionLayoutRelSel).row);
        const companionLayoutTemplateSel = makeSelect([
            { value: 'beside', label: 'Beside' },
            { value: 'interplant', label: 'Interplant' },
            { value: 'staggered', label: 'Staggered' }
        ], 'beside');
        const companionLayoutSpacingXInput = makeNullableNumber('', { min: 0.1, step: 0.1 });
        const companionLayoutSpacingYInput = makeNullableNumber('', { min: 0.1, step: 0.1 });
        const companionLayoutOffsetXInput = makeNullableNumber('', { step: 0.1 });
        const companionLayoutOffsetYInput = makeNullableNumber('', { step: 0.1 });
        companionLayoutPanel.appendChild(row('Template:', companionLayoutTemplateSel).row);
        companionLayoutPanel.appendChild(row('Spacing X (cm):', companionLayoutSpacingXInput).row);
        companionLayoutPanel.appendChild(row('Spacing Y (cm):', companionLayoutSpacingYInput).row);
        companionLayoutPanel.appendChild(row('Offset X (cm):', companionLayoutOffsetXInput).row);
        companionLayoutPanel.appendChild(row('Offset Y (cm):', companionLayoutOffsetYInput).row);
        const companionLayoutActions = document.createElement('div');
        companionLayoutActions.className = 'usl-plant-editor-layout-actions';
        const companionLayoutSaveBtn = mxUtils.button('Save', async () => {
            companionLayoutStatus.textContent = ''; // CHANGE: legacy pair-default editor is intentionally inert.
        });
        applySharedButtonStyle(companionLayoutSaveBtn, 'add');
        companionLayoutActions.appendChild(companionLayoutSaveBtn);
        companionLayoutPanel.appendChild(companionLayoutActions);
        const companionLayoutStatus = document.createElement('div');
        companionLayoutStatus.className = 'usl-layout-status';
        const companionGroupDefaultsList = document.createElement('div');
        companionGroupDefaultsList.className = 'usl-companion-defaults-list';
        companionLayoutPanel.appendChild(companionGroupDefaultsList);
        companionLayoutPanel.appendChild(companionLayoutStatus);
        leftCol.appendChild(companionLayoutPanel);
        let companionLayoutRelationships = [];

        function plantEditorSpacingDraft() {
            const fallback = readNullableNumber(spacingInput) ?? 30;
            return {
                spacingCm: fallback,
                spacingXCm: readNullableNumber(spacingXInput) ?? fallback,
                spacingYCm: readNullableNumber(spacingYInput) ?? fallback,
                vegDiameterCm: readNullableNumber(vegDiamInput)
            };
        }
        function refreshPlantEditorLayoutPreview() {
            return;
        }
        function addGrowthStageCell(text, className) {
            const cell = document.createElement('div');
            cell.textContent = text;
            if (className) cell.className = className;
            growthStageTable.appendChild(cell);
            return cell;
        }
        function rebuildGrowthStageTableHeader() {
            growthStageTable.innerHTML = '';
            ['Key', 'Label', 'GDD', 'Spacing', 'Diameter', 'Height', 'Active', 'Default', ''].forEach(label => addGrowthStageCell(label, 'usl-growth-stage-header'));
        }
        function makeGrowthStageNumberInput(value, placeholder = '') {
            const input = makeNullableNumber(value == null ? '' : value, { min: 0.01, step: 0.01 });
            input.placeholder = placeholder;
            return input;
        }
        function addGrowthStageEditorRow(stageLike) {
            const raw = stageLike || {};
            const stage = normalizeGrowthStage(raw);
            const keyInput = document.createElement('input');
            keyInput.type = 'text';
            keyInput.value = stage.stageKey === DEFAULT_GROWTH_STAGE_KEY && raw.stage_key === '' ? '' : stage.stageKey;
            const labelInput = document.createElement('input');
            labelInput.type = 'text';
            labelInput.value = stage.stageLabel === DEFAULT_GROWTH_STAGE_LABEL && raw.stage_label === '' ? '' : stage.stageLabel;
            const gddInput = makeGrowthStageNumberInput(stage.gddRatio);
            const spacingInputLocal = makeGrowthStageNumberInput(raw.spacing_ratio ?? raw.spacingRatio ?? '', 'sqrt');
            const diameterInput = makeGrowthStageNumberInput(raw.plant_diameter_ratio ?? raw.plantDiameterRatio ?? '', 'sqrt');
            const heightInput = makeGrowthStageNumberInput(raw.plant_height_ratio ?? raw.plantHeightRatio ?? '', 'sqrt');
            const activeInput = makeCheckbox(Number(raw.active ?? stage.active) !== 0);
            const defaultInput = makeCheckbox(Number(raw.is_default ?? raw.isDefault ?? stage.isDefault) === 1);
            const removeBtn = mxUtils.button('x', () => {
                growthStageEditorRows = growthStageEditorRows.filter(item => item.removeBtn !== removeBtn);
                renderGrowthStageRows(growthStageEditorRows.map(readGrowthStageEditorRow).filter(Boolean));
            });
            applySharedButtonStyle(removeBtn, 'danger', { compact: true }); // CHANGE
            [keyInput, labelInput, gddInput, spacingInputLocal, diameterInput, heightInput].forEach(input => {
                input.addEventListener('input', refreshGrowthStageStatus);
                input.addEventListener('change', refreshGrowthStageStatus);
            });
            defaultInput.addEventListener('change', () => {
                if (defaultInput.checked) growthStageEditorRows.forEach(rowState => { if (rowState.defaultInput !== defaultInput) rowState.defaultInput.checked = false; });
                refreshGrowthStageStatus();
            });
            growthStageEditorRows.push({ keyInput, labelInput, gddInput, spacingInputLocal, diameterInput, heightInput, activeInput, defaultInput, removeBtn });
            [keyInput, labelInput, gddInput, spacingInputLocal, diameterInput, heightInput, activeInput, defaultInput, removeBtn].forEach(el => growthStageTable.appendChild(el));
            refreshGrowthStageStatus();
        }
        function readGrowthStageEditorRow(rowState) {
            const key = normalizeGrowthStageKey(rowState.keyInput.value || rowState.labelInput.value);
            const label = String(rowState.labelInput.value || rowState.keyInput.value || '').trim();
            if (!key && !label) return null;
            const gddRatio = positiveFiniteOrNull(rowState.gddInput.value);
            if (gddRatio == null) throw new Error(`Growing stage "${label || key}" requires GDD ratio > 0.`);
            return {
                stage_key: key,
                stage_label: label || key,
                gdd_ratio: gddRatio,
                spacing_ratio: positiveFiniteOrNull(rowState.spacingInputLocal.value),
                plant_diameter_ratio: positiveFiniteOrNull(rowState.diameterInput.value),
                plant_height_ratio: positiveFiniteOrNull(rowState.heightInput.value),
                active: rowState.activeInput.checked ? 1 : 0,
                is_default: rowState.defaultInput.checked ? 1 : 0
            };
        }
        function readGrowthStageEditorRows() {
            const rows = growthStageEditorRows.map(readGrowthStageEditorRow).filter(Boolean);
            const seen = new Set();
            rows.forEach(stage => {
                if (seen.has(stage.stage_key)) throw new Error(`Duplicate growing stage key: ${stage.stage_key}`);
                seen.add(stage.stage_key);
            });
            return rows;
        }
        function renderGrowthStageRows(stages) {
            rebuildGrowthStageTableHeader();
            growthStageEditorRows = [];
            (Array.isArray(stages) ? stages : []).forEach(stage => addGrowthStageEditorRow(stage));
            if (!growthStageEditorRows.length) addGrowthStageEditorRow(defaultGrowthStage());
            refreshGrowthStageStatus();
        }
        function refreshGrowthStageStatus() {
            try {
                const rows = growthStageEditorRows.map(readGrowthStageEditorRow).filter(Boolean);
                growthStageStatus.textContent = rows.length ? `${rows.length} growing stage${rows.length === 1 ? '' : 's'} configured.` : 'No growing stages configured; scheduler uses Mature at 1.0.';
                refreshPlantEditorSectionSummaries();
            } catch (e) {
                growthStageStatus.textContent = 'Growing stage error: ' + (e?.message || String(e));
                refreshPlantEditorSectionSummaries();
            }
        }
        async function refreshGrowthStageEditorForPlant(pid) {
            const plantIdNumber = Number(pid);
            if (!Number.isFinite(plantIdNumber)) {
                renderGrowthStageRows([defaultGrowthStage()]);
                return;
            }
            const rows = await PlantGrowthStageModel.listByPlantId(plantIdNumber, { includeInactive: true });
            renderGrowthStageRows(rows.length ? rows : [defaultGrowthStage()]);
        }

        function selectedCompanionLayoutRelationship() {
            const key = String(companionLayoutRelSel.value || '');
            return companionLayoutRelationships.find(rel => String(rel.relationId || '') === key) || null;
        }
        function plantEditorRowById(id) {
            const key = String(id || '');
            return (plantRows || []).find(plant => String(plant?.plant_id || '') === key) || null;
        }
        function readCompanionLayoutDraft() {
            return {
                template: normalizeCompanionLayoutTemplate(companionLayoutTemplateSel.value) || 'beside',
                spacingXCm: readNullableNumber(companionLayoutSpacingXInput),
                spacingYCm: readNullableNumber(companionLayoutSpacingYInput),
                offsetXCm: readNullableNumber(companionLayoutOffsetXInput),
                offsetYCm: readNullableNumber(companionLayoutOffsetYInput)
            };
        }
        function writeCompanionLayoutControls(relationship) {
            const companionPlant = plantEditorRowById(relationship?.companionPlantId);
            const layout = relationship ? resolveCompanionLayout(null, companionPlant, relationship, {}) : null;
            companionLayoutTemplateSel.value = layout?.template || 'beside';
            companionLayoutSpacingXInput.value = layout?.spacingXCm == null ? '' : String(layout.spacingXCm);
            companionLayoutSpacingYInput.value = layout?.spacingYCm == null ? '' : String(layout.spacingYCm);
            companionLayoutOffsetXInput.value = layout?.offsetXCm == null ? '' : String(layout.offsetXCm);
            companionLayoutOffsetYInput.value = layout?.offsetYCm == null ? '' : String(layout.offsetYCm);
            refreshCompanionLayoutPreview();
        }
        function refreshCompanionLayoutPreview() {
            const relationship = selectedCompanionLayoutRelationship();
            if (!relationship) companionLayoutStatus.textContent = Number.isFinite(Number(currentPlantId)) ? 'No companion pairs found for this plant.' : 'Save or select a plant to edit companion pair defaults.';
            else companionLayoutStatus.textContent = 'Pair layout defaults are used as fallbacks for scheduler groups.';
            refreshPlantEditorSectionSummaries();
        }
        async function refreshCompanionGroupDefaultsList() {
            companionGroupDefaultsList.innerHTML = ''; // CHANGE: Plant Editor no longer displays pair or set layout defaults.
        }
        async function refreshCompanionLayoutDefaultsUI(preferredRelationId = null) {
            companionLayoutRelationships = []; // CHANGE: companion relationship data remains for scheduling recommendations, not Plant Editor layout controls.
            companionLayoutRelSel.innerHTML = '';
            if (!companionLayoutRelationships.length) {
                const opt = document.createElement('option');
                opt.value = '';
                opt.textContent = '';
                companionLayoutRelSel.appendChild(opt);
            }
            for (const rel of companionLayoutRelationships) {
                const plant = plantEditorRowById(rel.companionPlantId);
                const opt = document.createElement('option');
                opt.value = String(rel.relationId || '');
                opt.textContent = `${String(currentPlantRow?.plant_name || nameInput.value || 'Plant')} + ${String(plant?.plant_name || rel.p2 || rel.p1 || rel.companionPlantId)}`;
                companionLayoutRelSel.appendChild(opt);
            }
            const preferred = String(preferredRelationId || companionLayoutRelSel.value || '');
            const valid = new Set(Array.from(companionLayoutRelSel.options).map(opt => opt.value));
            companionLayoutRelSel.value = valid.has(preferred) ? preferred : String(companionLayoutRelationships[0]?.relationId || '');
            const hasRelationship = !!selectedCompanionLayoutRelationship();
            [companionLayoutTemplateSel, companionLayoutSpacingXInput, companionLayoutSpacingYInput, companionLayoutOffsetXInput, companionLayoutOffsetYInput, companionLayoutSaveBtn].forEach(el => { if (el) el.disabled = !hasRelationship; });
            writeCompanionLayoutControls(selectedCompanionLayoutRelationship());
            await refreshCompanionGroupDefaultsList();
            refreshPlantEditorSectionSummaries();
        }
        [spacingInput, spacingXInput, spacingYInput, vegDiamInput, nameInput].forEach(control => {
            control.addEventListener('input', () => { refreshPlantEditorLayoutPreview(); refreshCompanionLayoutPreview(); });
            control.addEventListener('change', () => { refreshPlantEditorLayoutPreview(); refreshCompanionLayoutPreview(); });
        });
        companionLayoutRelSel.addEventListener('change', () => writeCompanionLayoutControls(selectedCompanionLayoutRelationship()));
        [companionLayoutTemplateSel, companionLayoutSpacingXInput, companionLayoutSpacingYInput, companionLayoutOffsetXInput, companionLayoutOffsetYInput].forEach(control => {
            control.addEventListener('input', refreshCompanionLayoutPreview);
            control.addEventListener('change', refreshCompanionLayoutPreview);
        });
        // Attach overwinter override to the overwinter row (base is checkbox)
        attachInlineOverrideToRow(overwinterRow, { key: 'overwinter_ok', type: 'bool01' });

        // hide overrides by default
        setInlineOverridesVisible(false);

        const maturityOverrideKeys = ['gdd_to_maturity', 'days_maturity', 'days_germ', 'days_transplant'];
        const yieldOverrideKeys = ['yield_per_plant_kg', 'harvest_window_days'];
        const climateOverrideKeys = [
            'tbase_c', 'tmin_c', 'topt_low_c', 'topt_high_c', 'tmax_c', 'killtemp_c',
            'soil_temp_min_plant_c', 'start_cooling_threshold_c',
            'establishment_temp_max_c', 'establishment_heat_window_days', 'establishment_heat_policy',
            'quality_temp_max_c', 'heat_stress_stage', 'quality_heat_policy',
            'photoperiod_response', 'critical_daylength_hours', 'photoperiod_stage', 'photoperiod_policy',
            'chilling_required_days', 'chilling_required_hours', 'chilling_temp_min_c', 'chilling_temp_max_c',
            'chilling_stage', 'chilling_policy', 'diagnostic_policy'
        ];
        const layoutOverrideKeys = ['veg_height_cm', 'veg_diameter_cm', 'spacing_cm', 'spacing_x_cm', 'spacing_y_cm'];

        function summarizeBasicsSection() {
            const chips = [];
            const plantName = String(nameInput.value || '').trim();
            if (plantName) chips.push(plantName);
            if (currentVarietyMode === 'add' || currentVarietyMode === 'edit') {
                const varietyName = String(varietyNameInput.value || '').trim();
                if (varietyName) chips.push(varietyName);
                const maturityLabel = labelForSelectValue(maturityClassSel);
                if (maturityLabel) chips.push(maturityLabel);
            }
            if (maturityClassWarning.style.display !== 'none') chips.push({ text: 'Maturity mismatch', kind: 'warning' });
            return chips;
        }

        function summarizeLifecycleSection() {
            const chips = [labelForSelectValue(typeSel)].filter(Boolean);
            const methodCount = getAllowedmethodCategoryIdsFromUI().length;
            if (methodCount) chips.push(`${methodCount} method${methodCount === 1 ? '' : 's'}`);
            const defaultMethod = labelForSelectValue(defaultMethodSel);
            if (defaultMethod) chips.push(defaultMethod);
            if (overwinterChk.checked) chips.push('Overwinter');
            const overrideChip = sectionOverrideChip(['overwinter_ok']);
            if (overrideChip) chips.push(overrideChip);
            return chips;
        }

        function summarizeMaturitySection() {
            const chips = [];
            if (budgetModeSel.value === 'gdd') {
                const gdd = formatEditorNumber(gddInput.value, ' GDD');
                if (gdd) chips.push(gdd);
            } else {
                const days = formatEditorNumber(daysMatInput.value, 'd');
                if (days) chips.push(days);
            }
            const germ = formatEditorNumber(daysGermInput.value, 'd germ');
            const transplant = formatEditorNumber(daysTransInput.value, 'd transplant');
            if (germ) chips.push(germ);
            if (transplant) chips.push(transplant);
            const overrideChip = sectionOverrideChip(maturityOverrideKeys);
            if (overrideChip) chips.push(overrideChip);
            return chips;
        }

        function summarizeYieldSection() {
            const chips = [];
            const yieldValue = formatEditorNumber(yieldInput.value, ' kg/plant');
            const harvestWindow = formatEditorNumber(hwInput.value, 'd harvest');
            if (yieldValue) chips.push(yieldValue);
            if (harvestWindow) chips.push(harvestWindow);
            const overrideChip = sectionOverrideChip(yieldOverrideKeys);
            if (overrideChip) chips.push(overrideChip);
            return chips;
        }

        function summarizeClimateSection() {
            const chips = [];
            const tmin = formatEditorNumber(tminInput.value, 'C');
            const tmax = formatEditorNumber(tmaxInput.value, 'C');
            if (tmin || tmax) chips.push([tmin || '?', tmax || '?'].join(' to '));
            const soilMin = formatEditorNumber(soilMinInput.value, 'C soil');
            if (soilMin) chips.push(soilMin);
            const diagnostic = labelForSelectValue(diagnosticPolicySel);
            if (diagnostic) chips.push(`${diagnostic} diagnostics`);
            if (!tmin && !tmax && !formatEditorNumber(tbaseInput.value, '')) chips.push({ text: 'Missing climate', kind: 'warning' });
            const overrideChip = sectionOverrideChip(climateOverrideKeys);
            if (overrideChip) chips.push(overrideChip);
            return chips;
        }

        function summarizeLayoutSection() {
            const chips = [];
            const spacingX = formatEditorNumber(spacingXInput.value, 'cm');
            const spacingY = formatEditorNumber(spacingYInput.value, 'cm');
            const spacing = formatEditorNumber(spacingInput.value, 'cm');
            if (spacingX || spacingY) chips.push(`${spacingX || '?'} x ${spacingY || '?'}`);
            else if (spacing) chips.push(spacing);
            const diameter = formatEditorNumber(vegDiamInput.value, 'cm diameter');
            const height = formatEditorNumber(vegHeightInput.value, 'cm high');
            if (diameter) chips.push(diameter);
            if (height) chips.push(height);
            const overrideChip = sectionOverrideChip(layoutOverrideKeys);
            if (overrideChip) chips.push(overrideChip);
            return chips;
        }

        function summarizeGrowingStagesSection() {
            const count = growthStageEditorRows.length;
            return count ? [`${count} stage${count === 1 ? '' : 's'}`] : ['No stages'];
        }

        function summarizeCompanionSection() {
            const pairCount = companionLayoutRelationships.length;
            return pairCount ? [`${pairCount} pair${pairCount === 1 ? '' : 's'}`] : ['No pairs'];
        }

        plantEditorSections = [
            createPlantEditorSection('Basics', [plantNameRow, varietyNameRow, maturityClassRow, maturityClassWarning, abbrRow], {
                key: 'basics',
                defaultOpen: true,
                summaryProvider: summarizeBasicsSection
            }),
            createPlantEditorSection('Lifecycle & Methods', [lifecycleRow, lifeRow, overwinterRow, allowedMethodsRow, defaultMethodRow], {
                key: 'lifecycle',
                defaultOpen: false,
                overrideKeys: ['overwinter_ok'],
                summaryProvider: summarizeLifecycleSection
            }),
            createPlantEditorSection('Maturity & Timing', [maturityBudgetRow, gddRow, daysRow, daysGermRow, daysTransRow], {
                key: 'maturity',
                defaultOpen: true,
                overrideKeys: maturityOverrideKeys,
                summaryProvider: summarizeMaturitySection
            }),
            createPlantEditorSection('Yield', [yieldRow, hwRow], {
                key: 'yield',
                defaultOpen: false,
                overrideKeys: yieldOverrideKeys,
                summaryProvider: summarizeYieldSection
            }),
            createPlantEditorSection('Climate', [
                tbaseRow, tminRow, toptLowRow, toptHighRow, tmaxRow, killTempRow,
                soilMinRow, coolThreshRow,
                establishmentMaxRow, establishmentDaysRow, establishmentPolicyRow,
                qualityMaxRow, heatStageRow, qualityPolicyRow,
                photoperiodResponseRow, criticalDaylengthRow, photoperiodStageRow, photoperiodPolicyRow,
                chillingDaysRow, chillingHoursRow, chillingMinRow, chillingMaxRow, chillingStageRow, chillingPolicyRow,
                diagnosticPolicyRow
            ], {
                key: 'climate',
                defaultOpen: false,
                overrideKeys: climateOverrideKeys,
                summaryProvider: summarizeClimateSection
            }),
            createPlantEditorSection('Spacing/Layout', [vegHeightRow, vegDiamRow, spacingRow, spacingXRow, spacingYRow], {
                key: 'layout',
                defaultOpen: false,
                overrideKeys: layoutOverrideKeys,
                summaryProvider: summarizeLayoutSection
            }),
            createPlantEditorSection('Growing Stages', [growthStagePanel], { // CHANGE: keep growth stages browseable as a first-class editor section.
                key: 'growthStages',
                defaultOpen: false,
                summaryProvider: summarizeGrowingStagesSection
            })
        ];
        plantEditorSections.forEach(section => leftCol.appendChild(section.section));
        syncPlantEditorSectionOpenState();

        const PLANT_FIELD_BINDINGS = [
            { key: 'plant_name', input: nameInput, kind: 'text', empty: '' },
            { key: 'abbr', input: abbrInput, kind: 'text', empty: '' },

            { key: 'days_germ', input: daysGermInput, kind: 'number', empty: '0' },
            { key: 'days_transplant', input: daysTransInput, kind: 'number', empty: '0' },

            { key: 'yield_per_plant_kg', input: yieldInput, kind: 'nullable-number', empty: '' },
            { key: 'harvest_window_days', input: hwInput, kind: 'nullable-number', empty: '' },

            { key: 'tbase_c', input: tbaseInput, kind: 'nullable-number', empty: '' },
            { key: 'tmin_c', input: tminInput, kind: 'nullable-number', empty: '' },
            { key: 'topt_low_c', input: toptLowInput, kind: 'nullable-number', empty: '' },
            { key: 'topt_high_c', input: toptHighInput, kind: 'nullable-number', empty: '' },
            { key: 'tmax_c', input: tmaxInput, kind: 'nullable-number', empty: '' },
            { key: 'killtemp_c', input: killTempInput, kind: 'nullable-number', empty: '' },

            { key: 'soil_temp_min_plant_c', input: soilMinInput, kind: 'nullable-number', empty: '' },
            { key: 'start_cooling_threshold_c', input: coolThreshInput, kind: 'nullable-number', empty: '' },

            { key: 'establishment_temp_max_c', input: establishmentMaxInput, kind: 'nullable-number', empty: '' },
            { key: 'establishment_heat_window_days', input: establishmentDaysInput, kind: 'nullable-number', empty: '' },
            { key: 'establishment_heat_policy', input: establishmentPolicySel, kind: 'text', empty: '' },
            { key: 'quality_temp_max_c', input: qualityMaxInput, kind: 'nullable-number', empty: '' },
            { key: 'heat_stress_stage', input: heatStageSel, kind: 'text', empty: '' },
            { key: 'quality_heat_policy', input: qualityPolicySel, kind: 'text', empty: '' },
            { key: 'photoperiod_response', input: photoperiodResponseSel, kind: 'text', empty: '' },
            { key: 'critical_daylength_hours', input: criticalDaylengthInput, kind: 'nullable-number', empty: '' },
            { key: 'photoperiod_stage', input: photoperiodStageSel, kind: 'text', empty: '' },
            { key: 'photoperiod_policy', input: photoperiodPolicySel, kind: 'text', empty: '' },
            { key: 'chilling_required_days', input: chillingDaysInput, kind: 'nullable-number', empty: '' },
            { key: 'chilling_required_hours', input: chillingHoursInput, kind: 'nullable-number', empty: '' },
            { key: 'chilling_temp_min_c', input: chillingMinInput, kind: 'nullable-number', empty: '' },
            { key: 'chilling_temp_max_c', input: chillingMaxInput, kind: 'nullable-number', empty: '' },
            { key: 'chilling_stage', input: chillingStageSel, kind: 'text', empty: '' },
            { key: 'chilling_policy', input: chillingPolicySel, kind: 'text', empty: '' },
            { key: 'diagnostic_policy', input: diagnosticPolicySel, kind: 'text', empty: '' },

            { key: 'veg_height_cm', input: vegHeightInput, kind: 'nullable-number', empty: '' },
            { key: 'veg_diameter_cm', input: vegDiamInput, kind: 'nullable-number', empty: '' },
            { key: 'spacing_cm', input: spacingInput, kind: 'nullable-number', empty: '' },
            { key: 'spacing_x_cm', input: spacingXInput, kind: 'nullable-number', empty: '' },
            { key: 'spacing_y_cm', input: spacingYInput, kind: 'nullable-number', empty: '' },
        ];

        const sectionSummaryControls = [
            nameInput, abbrInput, varietyNameInput, maturityClassSel, typeSel, lifespanInput, overwinterChk,
            defaultMethodSel, budgetModeSel, gddInput, daysMatInput, daysGermInput, daysTransInput,
            yieldInput, hwInput, tbaseInput, tminInput, toptLowInput, toptHighInput, tmaxInput, killTempInput,
            soilMinInput, coolThreshInput, establishmentMaxInput, establishmentDaysInput, establishmentPolicySel,
            qualityMaxInput, heatStageSel, qualityPolicySel, photoperiodResponseSel, criticalDaylengthInput,
            photoperiodStageSel, photoperiodPolicySel, chillingDaysInput, chillingHoursInput, chillingMinInput,
            chillingMaxInput, chillingStageSel, chillingPolicySel, diagnosticPolicySel,
            vegHeightInput, vegDiamInput, spacingInput, spacingXInput, spacingYInput
        ];
        sectionSummaryControls.forEach(control => {
            if (!control) return;
            control.addEventListener('input', refreshPlantEditorSectionSummaries);
            control.addEventListener('change', refreshPlantEditorSectionSummaries);
        });
        for (const chk of methodChecksById.values()) chk.addEventListener('change', refreshPlantEditorSectionSummaries);
        for (const key of Object.keys(overrideInlineByKey)) {
            const controls = overrideInlineByKey[key];
            controls?.input?.addEventListener?.('input', refreshPlantEditorSectionSummaries);
            controls?.input?.addEventListener?.('change', refreshPlantEditorSectionSummaries);
        }

        function setBoundInputValue(binding, row) {
            const { key, input, kind, empty = '' } = binding;
            const value = row?.[key];

            if (kind === 'text') {
                input.value = value == null ? empty : String(value);
                return;
            }

            if (kind === 'number' || kind === 'nullable-number') {
                input.value = value == null ? empty : String(value);
                return;
            }

            throw new Error(`Unknown binding kind: ${kind}`);
        }

        function resetBoundPlantFields() {
            for (const binding of PLANT_FIELD_BINDINGS) {
                binding.input.value = binding.empty ?? '';
            }
        }

        function applyBoundPlantFields(row) {
            for (const binding of PLANT_FIELD_BINDINGS) {
                setBoundInputValue(binding, row);
            }
        }

        function setPlantControlsEnabled(enabled) {
            const els = [
                nameInput, abbrInput, typeSel, /* lifespanInput, */ overwinterChk,
                defaultMethodSel, budgetModeSel, gddInput, daysMatInput,
                daysGermInput, daysTransInput, yieldInput, hwInput,
                tbaseInput, tminInput, toptLowInput, toptHighInput, tmaxInput,
                soilMinInput, coolThreshInput,
                establishmentMaxInput, establishmentDaysInput, establishmentPolicySel,
                qualityMaxInput, heatStageSel, qualityPolicySel,
                photoperiodResponseSel, criticalDaylengthInput, photoperiodStageSel, photoperiodPolicySel,
                chillingDaysInput, chillingHoursInput, chillingMinInput, chillingMaxInput, chillingStageSel, chillingPolicySel,
                diagnosticPolicySel,
                vegHeightInput, vegDiamInput, spacingInput, spacingXInput, spacingYInput
            ];

            for (const el of els) {
                if (!el) continue;
                el.disabled = !enabled;
            }

            for (const chk of methodChecksById.values()) chk.disabled = !enabled;

            // Lifespan obeys lifecycle + global enabled flag                               
            syncLifecycleFields();
            const isPerennial = (String(typeSel.value) === 'perennial');
            lifespanInput.disabled = (!enabled) || (!isPerennial);
        }

        async function refreshAllowedMethodCategoriesUIForPlant(pid) {
            const allowed = await listAllowedmethodCategoryIdsForPlant(Number(pid));
            const allowedSet = new Set(allowed);
            for (const [mid, chk] of methodChecksById.entries()) {
                chk.checked = allowedSet.has(mid);
            }
            await rebuildDefaultMethodOptions();
            refreshPlantEditorSectionSummaries();
        }

        async function refreshVarietyDropdown(pid, preferredVarietyId = null) {
            varietiesCache = Number.isFinite(Number(pid)) ? await listVarietiesForPlant(Number(pid)) : [];

            const prev = String(preferredVarietyId ?? varietySel.value ?? '');
            const hasPlant = Number.isFinite(Number(currentPlantId));
            const groups = hasPlant
                ? buildVarietyPickerGroups(varietiesCache, { includeBase: true, includeNew: true, newValue: NEW_VARIETY_VALUE })
                : [{ label: 'Selection', options: [{ value: '', label: 'Save plant before varieties', displayLabel: 'Save plant before varieties' }] }];
            renderGroupedSelectOptions(varietySel, groups, prev, { emptyLabel: 'No varieties match' });

            const valid = new Set(Array.from(varietySel.options).map(o => o.value));
            varietySel.value = valid.has(prev) ? prev : '';

            addVarBtn.disabled = !hasPlant;
            plantEditorVarietyCombo.refresh(groups, varietySel.value);
        }

        function applyPlantRowToUI(p) {
            applyBoundPlantFields(p);

            typeSel.value = (p?.perennial === 1) ? 'perennial' : (p?.biennial === 1 ? 'biennial' : 'annual');
            lifespanInput.value = p?.lifespan_years == null ? '' : String(p.lifespan_years);
            overwinterChk.checked = (p?.overwinter_ok === 1);
            syncLifecycleFields();

            const hasGddLocal = Number(p?.gdd_to_maturity ?? 0) > 0;
            budgetModeSel.value = hasGddLocal ? 'gdd' : 'days';
            gddInput.value = p?.gdd_to_maturity == null ? '' : String(p.gdd_to_maturity);
            daysMatInput.value = p?.days_maturity == null ? '' : String(p.days_maturity);
            syncBudgetModeUI();
        }

        async function loadPlantIntoForm(pidOrNull, preferredVarietyId = null, preferredStartVarietyMode = null) {
            console.group('[PlantEditorDialog] loadPlantIntoForm');
            console.log('pidOrNull:', pidOrNull);
            console.log('currentPlantMode (before):', currentPlantMode);
            console.groupEnd();

            const pidNum = Number(pidOrNull);
            if (!pidOrNull || !Number.isFinite(pidNum) || pidNum <= 0) {
                console.log('[PlantEditorDialog] entering ADD plant reset path');
                currentPlantId = null;
                currentPlantRow = null;
                applyDialogMode(DIALOG_MODE.PLANT_ADD);

                title.textContent = 'Add plant';

                resetBoundPlantFields();

                typeSel.value = 'annual';
                lifespanInput.value = '';
                overwinterChk.checked = false;
                syncLifecycleFields();

                budgetModeSel.value = 'days';
                gddInput.value = '';
                daysMatInput.value = '';
                syncBudgetModeUI();

                // Reset methods + default method                                        
                for (const chk of methodChecksById.values()) chk.checked = false;
                await rebuildDefaultMethodOptions();
                defaultMethodSel.value = '';

                // Reset variety UI
                await refreshVarietyDropdown(null);

                refreshPlantEditorLayoutPreview();
                await refreshGrowthStageEditorForPlant(null);
                await refreshCompanionLayoutDefaultsUI();
                return;
            }


            const pid = pidNum;
            const rowObj = await PlantModel.loadById(pid);
            if (!rowObj) throw new Error('Plant not found');

            currentPlantId = pid;
            currentPlantRow = toPlainDict(rowObj);
            applyDialogMode(DIALOG_MODE.PLANT_EDIT);
            title.textContent = 'Edit plant';

            applyPlantRowToUI(currentPlantRow);
            refreshPlantEditorLayoutPreview();
            refreshInlineBaseHints();
            await refreshAllowedMethodCategoriesUIForPlant(pid);
            selectDefaultMethodFromPlantRow();
            await refreshGrowthStageEditorForPlant(pid);
            await refreshCompanionLayoutDefaultsUI();

            await refreshVarietyDropdown(pid, preferredVarietyId);

            const wantVid = Number.isFinite(Number(preferredVarietyId)) ? Number(preferredVarietyId) : null;
            const vSel = String(varietySel.value || '').trim();

            const forceAdd = preferredStartVarietyMode === 'add';
            const forceEdit = preferredStartVarietyMode === 'edit';

            if (forceAdd) {
                varietySel.value = NEW_VARIETY_VALUE;
                startNewVarietyMode();
                return;
            }

            if (wantVid && vSel && vSel !== NEW_VARIETY_VALUE && Number(vSel) === wantVid) {
                await loadVarietyIntoOverrides(wantVid);
                return;
            }

            if (forceEdit && vSel && vSel !== NEW_VARIETY_VALUE) {
                await loadVarietyIntoOverrides(Number(vSel));
                return;
            }

        }

        function startNewVarietyMode() {
            varietyNameInput.value = '';
            maturityClassSel.value = '';
            applyOverridesToUI({});
            applyDialogMode(DIALOG_MODE.VARIETY_ADD);
        }

        async function loadVarietyIntoOverrides(varietyId) {
            const pid = Number(currentPlantId);
            if (!Number.isFinite(pid)) return;

            const vid = Number(varietyId);
            if (!Number.isFinite(vid)) return;

            const vrow = await PlantVarietyModel.loadById(vid);
            if (!vrow) throw new Error('Variety not found');

            currentVarietyId = vid;
            currentVarietyRow = toPlainDict(vrow);
            currentVarietyMode = 'edit';

            let overrides = {};
            try {
                const raw = currentVarietyRow?.overrides_json;
                if (raw) {
                    const obj = JSON.parse(String(raw));
                    if (obj && typeof obj === 'object' && !Array.isArray(obj)) overrides = obj;
                }
            } catch (_) { overrides = {}; }

            varietyNameInput.value = String(currentVarietyRow?.variety_name ?? '');
            maturityClassSel.value = normalizeVarietyMaturityClass(currentVarietyRow?.maturity_class);
            applyOverridesToUI(overrides);
            refreshMaturityClassWarning();

            applyDialogMode(DIALOG_MODE.VARIETY_EDIT);
        }

        // -------------------- Populate plant dropdown --------------------
        const plantRows = await listPlantsBasic();
        function buildPlantEditorPlantGroups(selectedValue = plantSel.value) {
            return [{
                label: 'Selection',
                options: [
                    { value: '', label: '(select plant)', displayLabel: '(select plant)' },
                    { value: NEW_PLANT_VALUE, label: 'New plant...', displayLabel: 'New plant...' }
                ]
            }].concat(buildGroupedPlantOptions(plantRows, { selectedValue, includeSelectedWhenFiltered: false }));
        }
        function refreshPlantEditorPlantPicker(selectedValue = plantSel.value) {
            const groups = buildPlantEditorPlantGroups(selectedValue);
            renderGroupedSelectOptions(plantSel, groups, selectedValue, { emptyLabel: 'No plants match' });
            plantEditorPlantCombo.refresh(groups, plantSel.value || selectedValue);
        }

        refreshPlantEditorPlantPicker(Number.isFinite(Number(currentPlantId)) ? String(currentPlantId) : '');

        // --- Buttons ---
        const btns = document.createElement('div');
        btns.style.marginTop = '12px';
        btns.style.display = 'flex';
        btns.style.justifyContent = 'flex-end';
        btns.style.gap = '8px';

        const cancelBtn = mxUtils.button('Cancel', () => div.__cancel());
        applySharedButtonStyle(cancelBtn, 'close'); // CHANGE

        const saveBtn = mxUtils.button('Save', async () => {
            try {
                // -------------------- Variety mode (add/edit) --------------------
                if (currentVarietyMode === 'add' || currentVarietyMode === 'edit') {
                    const pid = Number(currentPlantId);
                    if (!Number.isFinite(pid)) throw new Error('Save the plant first');

                    const varietyName = String(varietyNameInput.value || '').trim();
                    if (!varietyName) throw new Error('Variety name is required');

                    const overrides = buildOverridesFromUI();

                    let savedVar = null;
                    if (currentVarietyMode === 'edit') {
                        const vid = Number(currentVarietyId);
                        if (!Number.isFinite(vid)) throw new Error('Select a variety');
                        savedVar = await PlantVarietyModel.update({
                            varietyId: vid,
                            varietyName,
                            maturityClass: maturityClassSel.value,
                            overrides
                        });
                    } else {
                        savedVar = await PlantVarietyModel.create({
                            plantId: pid,
                            varietyName,
                            maturityClass: maturityClassSel.value,
                            overrides
                        });
                    }

                    const newVid = Number(savedVar?.variety_id);
                    if (Number.isFinite(newVid)) {
                        currentVarietyId = newVid;
                        currentVarietyRow = toPlainDict(await PlantVarietyModel.loadById(newVid));
                        await refreshVarietyDropdown(pid, newVid);
                        varietySel.value = String(newVid);
                        applyDialogMode(DIALOG_MODE.VARIETY_EDIT);
                    } else {
                        await refreshVarietyDropdown(pid, null);
                    }

                    div.__commit(savedVar);

                    return;
                }

                // -------------------- Plant mode --------------------
                const plant_name = String(nameInput.value || '').trim();
                if (!plant_name) throw new Error('Plant name is required');

                const lifecycle = typeSel.value;
                const annual = (lifecycle === 'annual') ? 1 : 0;
                const biennial = (lifecycle === 'biennial') ? 1 : 0;
                const perennial = (lifecycle === 'perennial') ? 1 : 0;

                let lifespan_years = null;

                if (perennial) {
                    lifespan_years = readNullableNumber(lifespanInput);
                    if (!(Number.isFinite(Number(lifespan_years)) && Number(lifespan_years) >= 3)) {
                        throw new Error('Perennials require lifespan_years >= 3');
                    }
                } else {
                    lifespan_years = annual ? 1 : 2;
                }

                const allowedmethodCategoryIds = getAllowedmethodCategoryIdsFromUI();
                if (!allowedmethodCategoryIds.length) throw new Error('Enable at least one method');

                const default_planting_method_raw = normId(defaultMethodSel.value);
                const default_planting_method = default_planting_method_raw ? default_planting_method_raw : null;

                const overwinter_ok = overwinterChk.checked ? 1 : 0;

                const budgetMode = budgetModeSel.value;
                const gdd_to_maturity = (budgetMode === 'gdd') ? readNullableNumber(gddInput) : null;
                const days_maturity = (budgetMode === 'days') ? readNullableNumber(daysMatInput) : null;

                if (budgetMode === 'gdd' && !(Number.isFinite(Number(gdd_to_maturity)) && Number(gdd_to_maturity) > 0)) { // FIX: match scheduler requirements
                    throw new Error('GDD to maturity must be greater than 0'); // FIX: prevent saving an unusable plant
                }
                if (budgetMode === 'days' && !(Number.isFinite(Number(days_maturity)) && Number(days_maturity) > 0)) { // FIX: match scheduler requirements
                    throw new Error('Days to maturity must be greater than 0'); // FIX: prevent saving an unusable plant
                }

                const patch = {
                    plant_name,
                    abbr: String(abbrInput.value || '').trim() || null,
                    annual, biennial, perennial,
                    lifespan_years,
                    overwinter_ok,
                    default_planting_method,
                    gdd_to_maturity, days_maturity,
                    days_germ: readIntGE0(daysGermInput),
                    days_transplant: readIntGE0(daysTransInput),
                    yield_per_plant_kg: readNullableNumber(yieldInput),
                    harvest_window_days: (hwInput.value === '' ? null : readIntGE0(hwInput)),
                    tbase_c: readNullableNumber(tbaseInput),
                    tmin_c: readNullableNumber(tminInput),
                    topt_low_c: readNullableNumber(toptLowInput),
                    topt_high_c: readNullableNumber(toptHighInput),
                    tmax_c: readNullableNumber(tmaxInput),
                    killtemp_c: readNullableNumber(killTempInput),
                    soil_temp_min_plant_c: readNullableNumber(soilMinInput),
                    start_cooling_threshold_c: readNullableNumber(coolThreshInput),
                    establishment_temp_max_c: readNullableNumber(establishmentMaxInput),
                    establishment_heat_window_days: (establishmentDaysInput.value === '' ? null : readIntGE0(establishmentDaysInput)),
                    establishment_heat_policy: String(establishmentPolicySel.value || '').trim() || null,
                    quality_temp_max_c: readNullableNumber(qualityMaxInput),
                    heat_stress_stage: String(heatStageSel.value || '').trim() || null,
                    quality_heat_policy: String(qualityPolicySel.value || '').trim() || null,
                    photoperiod_response: String(photoperiodResponseSel.value || '').trim() || null,
                    critical_daylength_hours: readNullableNumber(criticalDaylengthInput),
                    photoperiod_stage: String(photoperiodStageSel.value || '').trim() || null,
                    photoperiod_policy: String(photoperiodPolicySel.value || '').trim() || null,
                    chilling_required_days: readNullableNumber(chillingDaysInput),
                    chilling_required_hours: readNullableNumber(chillingHoursInput),
                    chilling_temp_min_c: readNullableNumber(chillingMinInput),
                    chilling_temp_max_c: readNullableNumber(chillingMaxInput),
                    chilling_stage: String(chillingStageSel.value || '').trim() || null,
                    chilling_policy: String(chillingPolicySel.value || '').trim() || null,
                    diagnostic_policy: String(diagnosticPolicySel.value || '').trim() || null,

                    veg_height_cm: readNullableNumber(vegHeightInput),
                    veg_diameter_cm: readNullableNumber(vegDiamInput),
                    spacing_cm: readNullableNumber(spacingInput),
                    spacing_x_cm: readNullableNumber(spacingXInput),
                    spacing_y_cm: readNullableNumber(spacingYInput)
                };

                const plantIdToSave = currentPlantMode === 'edit' ? Number(currentPlantId) : null; // FIX: provide one atomic save path
                if (currentPlantMode === 'edit' && !Number.isFinite(plantIdToSave)) throw new Error('Select a plant'); // FIX: validate before opening the transaction
                const saved = await PlantModel.saveWithAllowedMethodCategories(
                    plantIdToSave,
                    patch,
                    allowedmethodCategoryIds
                ); // FIX: commit the plant and allowed-method records together

                const savedId = Number(saved?.plant_id ?? currentPlantId);
                if (!Number.isFinite(savedId)) throw new Error('Save succeeded but plant_id is missing');
                await PlantGrowthStageModel.saveForPlant(savedId, readGrowthStageEditorRows());

                // After save, sync dialog state to saved plant
                currentPlantId = savedId;
                plantSel.value = String(savedId);
                refreshPlantEditorPlantPicker(String(savedId));
                currentPlantRow = toPlainDict(await PlantModel.loadById(savedId));
                applyDialogMode(DIALOG_MODE.PLANT_EDIT);
                refreshInlineBaseHints();

                await refreshAllowedMethodCategoriesUIForPlant(savedId);
                await refreshVarietyDropdown(savedId, null);
                await refreshGrowthStageEditorForPlant(savedId);

                div.__commit(saved);
            } catch (e) {
                showErrorInline('Save error: ' + (e?.message || String(e)));
            }
        });
        applySharedButtonStyle(saveBtn, 'add');

        function syncSaveButtonLabel() {
            if (!saveBtn) return;
            if (currentVarietyMode === 'add') saveBtn.textContent = 'Save variety';
            else if (currentVarietyMode === 'edit') saveBtn.textContent = 'Save variety';
            else saveBtn.textContent = 'Save plant';
        }

        // Choose initial dropdown selection based on dialog mode and inputs                  
        const initialPlantSelValue = isEdit
            ? String(parsePositiveId(plantId) ?? '')
            : (initialPlantId ? String(initialPlantId) : NEW_PLANT_VALUE);

        plantSel.value = initialPlantSelValue;
        refreshPlantEditorPlantPicker(initialPlantSelValue);

        console.log('[PlantEditorDialog] calling loadPlantIntoForm with:', {
            initialPlantId,
            plantId_raw: plantId,
            initialPlantSelValue
        });

        await loadPlantIntoForm(
            initialPlantSelValue === NEW_PLANT_VALUE ? null : Number(initialPlantSelValue),
            initialVarietyId,
            initialStartVarietyMode
        );

        async function handlePlantEditorPlantChange() { // FIX: provide an awaitable plant-editor workflow
            try {
                const raw = String(plantSel.value || '').trim();
                refreshPlantEditorPlantPicker(raw);

                if (raw === NEW_PLANT_VALUE) {
                    await loadPlantIntoForm(null);
                    syncSaveButtonLabel();
                    return;
                }

                const pid = raw ? Number(raw) : null;
                await loadPlantIntoForm(Number.isFinite(Number(pid)) ? pid : null);
            } catch (e) {
                showErrorInline('Load plant error: ' + (e?.message || String(e)));
            }
        }

        async function handlePlantEditorVarietyChange() { // FIX: provide an awaitable variety-editor workflow
            try {
                const v = String(varietySel.value || '').trim();
                const hasPlant = Number.isFinite(Number(currentPlantId));
                const groups = hasPlant
                    ? buildVarietyPickerGroups(varietiesCache, { includeBase: true, includeNew: true, newValue: NEW_VARIETY_VALUE })
                    : [{ label: 'Selection', options: [{ value: '', label: 'Save plant before varieties', displayLabel: 'Save plant before varieties' }] }];
                plantEditorVarietyCombo.refresh(groups, v);

                addVarBtn.disabled = !hasPlant;

                if (!v) {
                    applyDialogMode(
                        Number.isFinite(Number(currentPlantId))
                            ? DIALOG_MODE.PLANT_EDIT
                            : DIALOG_MODE.PLANT_ADD
                    );
                    return;
                }

                if (v === NEW_VARIETY_VALUE) {
                    if (!hasPlant) {
                        showErrorInline('Save the plant first');
                        varietySel.value = '';
                        return;
                    }
                    startNewVarietyMode();
                    return;
                }

                await loadVarietyIntoOverrides(Number(v));
            } catch (e) {
                showErrorInline('Load variety error: ' + (e?.message || String(e)));
            }
        }

        plantSel.addEventListener('change', handlePlantEditorPlantChange); // FIX: delegate native changes to the awaitable handler
        varietySel.addEventListener('change', handlePlantEditorVarietyChange); // FIX: delegate native changes to the awaitable handler

        btns.appendChild(cancelBtn);
        btns.appendChild(saveBtn);
        div.appendChild(btns);

        return await showCommitDialog(ui, { container: div, width: 940, height: 620, modal: true, closable: true });
    }





















































    function computeScheduleResult(inputs) {
        const { plant } = inputs;
        const startDate = parseISODateUTCValue(inputs.startISO); // FIX: perennial results do not initialize GDD-derived state
        if (!startDate) {
            throw new Error('Select a planting date.'); // FIX: empty no-window state must not become an invalid Date
        }
        return isPerennialPlant(plant)
            ? perennialCore.computePerennialScheduleResult(inputs)
            : annualCore.computeAnnualScheduleResult(inputs, { allowThermalWarnings: true });
    }










    // -------------------- Dialog builder ---------------------------------------------------
    async function buildScheduleDialog(ui, cell, plants, cities, onSubmit, options) {
        let plantsLocal = Array.isArray(plants) ? plants.slice() : [];
        const {
            selectedPlant: initialPlant,
            earliestFeasibleSowDate,
            lastHarvestDate,
            latestHarvestEndDate = lastHarvestDate,
            selectedHarvestEndDate = lastHarvestDate,
            startNote,
            initialCityId = null,
            initialCityName = '',
            hasPersistedSchedule: initialHasPersistedSchedule = false,
            initialWindowFeasible = false,
            bedProfile: scheduleBedProfile = normalizeBedProfile(null),
            bedProfileSource: scheduleBedProfileSource = 'generic garden bed',
            dailyClimate: initialDailyClimate = null,
            dailyClimateKey: initialDailyClimateKey = '',
            initialTransplantDaysOverrideValue = null,
            derivedContext = null
        } = options || {};
        const cropMetadataByPlantId = derivedContext?.metadataByPlantId || new Map();
        const initialGrowthStage = readGrowthStageFromCell(cell);
        let hasPersistedSchedule = !!initialHasPersistedSchedule; // FIX: provenance changes after an automatic replacement

        // Helper to centralize plant mode (perennial vs annual/biennial)          
        function getModeForPlant(plant) {
            const perennial = !!(plant && plant.isPerennial && plant.isPerennial());
            return { perennial };
        }

        async function reloadPlantsList() {
            const prev = plantSel.value;
            plantsLocal = derivedContext?.candidatePlants ? derivedContext.candidatePlants.slice() : await PlantModel.listBasic();
            renderSchedulerCropPicker(makeCropPickerOptions(plantsLocal, new Map(), cropMetadataByPlantId), prev);
            if (!findPlantById(Number(plantSel.value)) && plantsLocal[0]) {
                plantSel.value = String(plantsLocal[0].plant_id);
            }
        }


        const div = document.createElement('div');
        div.style.padding = '12px';
        div.style.width = '100%';
        div.style.maxWidth = '96vw';
        div.style.boxSizing = 'border-box';

        const summaryView = renderScheduleSummary();
        div.appendChild(summaryView.root);

        // ---- inline error bar --------------------------------------------------- 
        const errorBar = document.createElement('div');
        errorBar.style.display = 'none';
        errorBar.style.marginBottom = '8px';
        errorBar.style.padding = '8px';
        errorBar.style.border = '1px solid #f59e0b';
        errorBar.style.background = '#fffbeb';
        errorBar.style.color = '#92400e';
        errorBar.style.fontSize = '12px';
        div.appendChild(errorBar);

        function showErrorInline(msg) {
            errorBar.textContent = String(msg || 'Unknown error');
            errorBar.style.display = '';
        }

        function clearErrorInline() {
            errorBar.textContent = '';
            errorBar.style.display = 'none';
        }

        async function runUiAsync(label, fn) { // FIX: contain async event-handler failures in the dialog
            clearErrorInline();
            return runUiAsyncOperation(label, fn, (message, e) => {
                console.warn(`[Scheduler UI] ${label} failed:`, e);
                showErrorInline(message);
            });
        }

        function styleTrellisButton(button, variant, options) {
            return applySharedButtonStyle(button, variant || 'neutral', options || {});
        }

        const inlineButton = (label, onClick, variant) => {
            const b = mxUtils.button(label, async () => { clearErrorInline(); await onClick(); });
            styleTrellisButton(b, variant || 'neutral', { compact: true });
            b.style.marginLeft = '8px';
            return b;
        };

        const contextSection = makeSection('Context');
        contextSection.wrap.classList.add('usl-scheduler-section--allow-popover');
        const plantSection = makeSection('Crop');
        const windowSection = makeSection('Feasibility');
        const timelineSection = makeSection('Timeline');
        const inputsSection = makeSection('Planting');
        const harvestSection = makeSection('Harvest');

        const contentGrid = document.createElement('div');
        contentGrid.style.display = 'grid';
        contentGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(360px, 1fr))';
        contentGrid.style.gap = '16px';

        const leftColumn = document.createElement('div');
        const rightColumn = document.createElement('div');
        leftColumn.appendChild(plantSection.wrap);
        leftColumn.appendChild(contextSection.wrap);
        leftColumn.appendChild(inputsSection.wrap);
        rightColumn.appendChild(windowSection.wrap);
        rightColumn.appendChild(timelineSection.wrap);
        rightColumn.appendChild(harvestSection.wrap);
        contentGrid.appendChild(leftColumn);
        contentGrid.appendChild(rightColumn);
        div.appendChild(contentGrid);

        const advancedDetails = document.createElement('details');
        advancedDetails.style.marginTop = '14px';
        advancedDetails.style.borderTop = '1px solid #d1d5db';
        const advancedSummary = document.createElement('summary');
        advancedSummary.textContent = 'Advanced';
        advancedSummary.style.cursor = 'pointer';
        advancedSummary.style.fontWeight = '600';
        advancedSummary.style.padding = '10px 0 6px';
        const advancedBody = document.createElement('div');
        advancedDetails.appendChild(advancedSummary);
        advancedDetails.appendChild(advancedBody);
        div.appendChild(advancedDetails);

        function styleCompactActionButton(btn, variant) {
            styleTrellisButton(btn, variant || 'neutral', { compact: true });
            btn.style.marginLeft = '0';
            btn.style.minWidth = '28px';
            btn.style.padding = '4px 8px';
            btn.style.lineHeight = '1.2';
            return btn;
        }

        function makeSection(title) {
            const wrap = document.createElement('div');
            wrap.className = 'usl-scheduler-section';
            wrap.style.marginTop = '12px';

            const heading = document.createElement('div');
            heading.className = 'usl-scheduler-section-heading';
            heading.textContent = title;
            heading.style.fontWeight = '600';
            heading.style.fontSize = '13px';
            heading.style.padding = '0 0 6px 0';
            heading.style.borderBottom = '1px solid #d1d5db';
            heading.style.marginBottom = '8px';

            const body = document.createElement('div');
            body.className = 'usl-scheduler-section-body';
            wrap.appendChild(heading);
            wrap.appendChild(body);

            return { wrap, body };
        }

        function makeDisplayField(initialValue = '', opts = {}) {
            const el = document.createElement('div');
            el.textContent = initialValue || '';
            el.style.width = '100%';
            el.style.boxSizing = 'border-box';
            el.style.padding = opts.emphasis ? '8px 10px' : '6px 8px';
            el.style.minHeight = opts.emphasis ? '36px' : '32px';
            el.style.border = '1px solid #d1d5db';
            el.style.background = opts.emphasis ? '#eef6ff' : '#f3f4f6';
            el.style.color = '#374151';
            el.style.borderRadius = '4px';
            el.style.display = 'flex';
            el.style.alignItems = 'center';
            if (opts.emphasis) {
                el.style.fontWeight = '600';
                el.style.fontSize = '14px';
                el.style.borderColor = '#93c5fd';
            }
            return el;
        }

        function setDisplayFieldValue(el, value) {
            el.textContent = value || '';
        }

        function fmtShortDate(iso) {
            if (!iso) return '';
            const d = new Date(iso + 'T00:00:00Z');
            return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
        }

        function parseISODateUTC(iso) {
            if (!iso) return null;
            const d = new Date(iso + 'T00:00:00Z');
            return Number.isNaN(d.getTime()) ? null : d;
        }

        function daysBetweenUTC(a, b) {
            const ms = 24 * 60 * 60 * 1000;
            return Math.round((b.getTime() - a.getTime()) / ms);
        }

        // Plant selector
        let currentCropPickerOptions = makeCropPickerOptions(plantsLocal, new Map(), cropMetadataByPlantId);
        let currentCropPickerSelectedValue = String(initialPlant?.plant_id ?? plantsLocal[0]?.plant_id ?? '');
        const lifecycleFilterSel = buildLifecycleFilterControl();
        const plantSel = document.createElement('select');
        plantSel.style.width = '100%';
        plantSel.style.padding = '6px';
        plantSel.style.flex = '1';
        const cropCombo = createSchedulerCropCombobox(plantSel);

        function renderSchedulerCropPicker(pickerOptions = currentCropPickerOptions, selectedValue = currentCropPickerSelectedValue) {
            currentCropPickerOptions = pickerOptions || [];
            currentCropPickerSelectedValue = String(selectedValue || currentCropPickerSelectedValue || '');
            const groups = buildGroupedCropOptions(currentCropPickerOptions, {
                filter: lifecycleFilterSel.value,
                selectedValue: currentCropPickerSelectedValue,
                includeSelectedWhenFiltered: true
            });
            renderGroupedCropOptions(plantSel, groups, currentCropPickerSelectedValue);
            cropCombo.refresh(groups, plantSel.value || currentCropPickerSelectedValue);
        }

        renderSchedulerCropPicker(currentCropPickerOptions, currentCropPickerSelectedValue);

        const plantControlsWrap = document.createElement('div');
        plantControlsWrap.className = 'usl-scheduler-crop-picker-controls';
        lifecycleFilterSel.classList.add('usl-scheduler-crop-filter');
        cropCombo.root.classList.add('usl-scheduler-crop-combobox-wrap');
        plantControlsWrap.appendChild(lifecycleFilterSel);
        plantControlsWrap.appendChild(cropCombo.root);

        const addPlantBtn = styleCompactActionButton(inlineButton('+', async () => {
            try {
                const saved = await openPlantEditorDialog(ui, { mode: 'add', plantId: null, varietyId: null });
                if (!saved) return;

                await reloadPlantsList();
                plantSel.value = String(saved.plant_id);
                await handleSchedulePlantChange(); // FIX: await the async selection workflow directly
            } catch (e) {
                showErrorInline('Add plant error: ' + (e?.message || String(e)));
            }
        }, 'add'), 'add');

        const editPlantBtn = styleCompactActionButton(inlineButton('Edit', async () => {
            try {
                syncStateFromControls();

                const pid = Number(plantSel.value);
                if (!Number.isFinite(pid)) return;

                const vid = Number(formState.varietyId);
                const saved = await openPlantEditorDialog(ui, {
                    mode: 'edit',
                    plantId: pid,
                });

                if (!saved) return;

                const savedPid = Number(saved?.plant_id ?? pid);
                const savedVid = Number(saved?.variety_id ?? vid);

                await afterPlantOrVarietySaved({
                    preferPlantId: savedPid,
                    preferVarietyId: Number.isFinite(savedVid) ? savedVid : null
                });
            } catch (e) {
                showErrorInline('Edit plant error: ' + (e?.message || String(e)));
            }
        }, 'open'), 'open');

        addPlantBtn.classList.add('usl-scheduler-crop-action');
        editPlantBtn.classList.add('usl-scheduler-crop-action');
        plantControlsWrap.appendChild(addPlantBtn);
        plantControlsWrap.appendChild(editPlantBtn);

        const plantSelectRow = row('Plant:', plantControlsWrap);
        plantSelectRow.row.classList.add('usl-scheduler-row--crop-picker');
        plantSection.body.appendChild(plantSelectRow.row);

        const findPlantById = (id) => (plantsLocal || []).find(p => Number(p.plant_id) === Number(id)) || null;

        const fallbackId = Number.isFinite(Number(plantSel.value)) ? Number(plantSel.value) : (plantsLocal[0] ? Number(plantsLocal[0].plant_id) : null);
        const initId = Number.isFinite(Number(initialPlant?.plant_id))
            ? Number(initialPlant.plant_id)
            : fallbackId;

        if (!Number.isFinite(initId)) {
            showErrorInline('No plants available.');
            return;
        }

        plantSel.value = String(initId);
        let selPlant = findPlantById(initId);
        if (!selPlant) selPlant = await PlantModel.loadById(initId);
        if (!selPlant) { showErrorInline('Plant not found.'); return; }

        let mode = getModeForPlant(selPlant);

        let baseEffectivePlant = selPlant;
        let effectivePlant = selPlant;

        function setSelectOptions(selectEl, opts, selectedValue) {
            selectEl.innerHTML = '';
            (opts || []).forEach(o => {
                const opt = document.createElement('option');
                opt.value = String(o.value);
                opt.textContent = o.label;
                selectEl.appendChild(opt);
            });
            if (selectedValue != null) selectEl.value = String(selectedValue);
        }

        function selectedGrowthStage() {
            const key = normalizeGrowthStageKey(growthStageSel.value);
            return currentGrowthStages.find(stage => stage.stageKey === key) || currentGrowthStages.find(stage => stage.isDefault === 1) || defaultGrowthStage();
        }

        async function refreshGrowthStageOptionsForPlant(plantId, preferredStage = null) {
            const preferred = normalizeGrowthStage(preferredStage || formState?.growthStage || initialGrowthStage || defaultGrowthStage());
            const rows = await PlantGrowthStageModel.listByPlantId(plantId);
            const stages = rows.length ? rows.map(row => normalizeGrowthStage(row)) : [defaultGrowthStage()];
            if (preferred.stageKey && !stages.some(stage => stage.stageKey === preferred.stageKey)) {
                stages.push(normalizeGrowthStage(Object.assign({}, preferred, { legacy: true })));
            }
            currentGrowthStages = stages.sort((a, b) => (b.isDefault - a.isDefault) || (a.sortOrder - b.sortOrder) || a.stageLabel.localeCompare(b.stageLabel));
            setSelectOptions(growthStageSel, currentGrowthStages.map(stage => ({
                value: stage.stageKey,
                label: stage.legacy ? `${stage.stageLabel} (saved)` : stage.stageLabel
            })), preferred.stageKey || currentGrowthStages[0]?.stageKey || DEFAULT_GROWTH_STAGE_KEY);
            if (!growthStageSel.value && currentGrowthStages[0]) growthStageSel.value = currentGrowthStages[0].stageKey;
            formState.growthStageKey = normalizeGrowthStageKey(growthStageSel.value);
            formState.growthStage = selectedGrowthStage();
        }

        async function refreshEffectivePlant() {
            baseEffectivePlant = await resolveEffectivePlant(
                formState.plantId,
                formState.varietyId
            );
            if (!baseEffectivePlant) {
                baseEffectivePlant = selPlant;
            }
            const transplantDaysConfig = resolveTransplantDaysConfig(baseEffectivePlant, {
                methodId: formState.methodId,
                overrideEnabled: formState.transplantDaysOverrideEnabled,
                overrideValue: formState.transplantDaysOverrideValue
            });
            const transplantAdjustedPlant = applyEffectiveTransplantDaysToPlant(baseEffectivePlant, transplantDaysConfig.effectiveDays);
            effectivePlant = applyGrowthStageToPlant(transplantAdjustedPlant, formState.growthStage || selectedGrowthStage());
            mode = getModeForPlant(effectivePlant);
        }

        async function afterPlantOrVarietySaved({ preferPlantId = null, preferVarietyId = null } = {}) {
            await reloadPlantsList();

            if (Number.isFinite(Number(preferPlantId))) {
                plantSel.value = String(preferPlantId);
            }
            await handleSchedulePlantChange({ preferVarietyId }); // FIX: run one ordered post-save update chain
        }

        const plantNameSpan = document.createElement('span');
        plantNameSpan.textContent = selPlant.plant_name;

        // Variety selector + Add button                                       
        const varietySel = document.createElement('select');
        varietySel.style.width = '100%';
        varietySel.style.padding = '6px';
        const scheduleVarietyCombo = createSchedulerCropCombobox(varietySel, {
            className: 'usl-scheduler-variety-combobox',
            placeholder: 'Search varieties...',
            emptyText: 'No varieties match',
            buttonFallback: 'Select variety'
        });
        scheduleVarietyCombo.root.style.flex = '1 1 auto';

        const varietyControlsWrap = document.createElement('div');
        varietyControlsWrap.style.display = 'flex';
        varietyControlsWrap.style.gap = '8px';
        varietyControlsWrap.style.alignItems = 'center';
        varietyControlsWrap.appendChild(scheduleVarietyCombo.root);

        const addVarietyBtn = styleCompactActionButton(inlineButton('+', async () => {
            try {
                syncStateFromControls();

                const pid = Number(formState.plantId);
                if (!Number.isFinite(pid)) {
                    showErrorInline('Select a plant first');
                    return;
                }

                const saved = await openPlantEditorDialog(ui, {
                    mode: 'add',
                    plantId: pid,
                    startVarietyMode: 'add'
                });
                if (!saved) return;

                await reloadVarietyOptionsForPlant(pid);

                const savedId = Number(saved?.variety_id ?? saved?.varietyId ?? saved?.id);
                if (Number.isFinite(savedId)) varietySel.value = String(savedId);
                if (Number.isFinite(savedId)) renderScheduleVarietyPicker(String(savedId));

                await handleScheduleVarietyChange(); // FIX: await the shared variety selection workflow
            } catch (e) {
                showErrorInline('Add variety error: ' + (e?.message || String(e)));
            }
        }, 'add'), 'add');

        varietyControlsWrap.appendChild(addVarietyBtn);

        const editVarietyBtn = styleCompactActionButton(inlineButton('Edit', async () => {
            try {
                syncStateFromControls();

                const pid = Number(formState.plantId);
                const vid = Number(formState.varietyId);
                if (!Number.isFinite(pid)) { showErrorInline('Select a plant first'); return; }
                if (!Number.isFinite(vid)) { setVarietyStatus('Select a variety to edit.'); return; }

                setVarietyStatus('');
                const saved = await openPlantEditorDialog(ui, {
                    mode: 'add',
                    plantId: pid,
                    varietyId: vid,
                    startVarietyMode: 'edit'
                });
                if (!saved) return;

                await reloadVarietyOptionsForPlant(pid);

                const savedId = Number(saved?.variety_id ?? saved?.varietyId ?? vid);
                varietySel.value = String(savedId);
                renderScheduleVarietyPicker(String(savedId));

                await handleScheduleVarietyChange(); // FIX: await the shared variety selection workflow
            } catch (e) {
                setVarietyStatus('Edit variety error: ' + (e?.message || String(e)));
            }
        }, 'open'), 'open');

        varietyControlsWrap.appendChild(editVarietyBtn);

        const varietyRow = row('Variety:', varietyControlsWrap);
        varietyRow.row.classList.add('usl-scheduler-row--crop-variety');
        plantSection.body.appendChild(varietyRow.row);

        const varietyStatus = document.createElement('div');
        varietyStatus.style.fontSize = '12px';
        varietyStatus.style.color = '#92400e';
        varietyStatus.style.marginTop = '4px';
        varietyStatus.textContent = '';
        plantSection.body.appendChild(varietyStatus);

        function setVarietyStatus(msg) {
            varietyStatus.textContent = msg || '';
        }

        function syncVarietyButtons() {
            const hasVariety = !!(varietySel && varietySel.value);
            editVarietyBtn.disabled = !hasVariety;
            if (!hasVariety) setVarietyStatus('');
        }

        let currentVarieties = [];
        function renderScheduleVarietyPicker(selectedVarietyId = varietySel.value) {
            const sel = Number.isFinite(Number(selectedVarietyId)) ? String(selectedVarietyId) : '';
            const groups = buildVarietyPickerGroups(currentVarieties, { includeBase: true, includeNew: false });
            renderGroupedSelectOptions(varietySel, groups, sel, { emptyLabel: 'No varieties match' });
            scheduleVarietyCombo.refresh(groups, varietySel.value || sel);
        }
        async function reloadVarietyOptionsForPlant(plantId, selectedVarietyId = null) {
            currentVarieties = await PlantVarietyModel.listByPlantId(Number(plantId));
            renderScheduleVarietyPicker(selectedVarietyId);
        }


        // City & Method & Method
        const cityOpts = cities.map(c => ({ value: String(c.city_id ?? c.city_name), label: c.city_name, city: c }));
        const initialCityKey = initialCityId != null ? String(initialCityId) : '';
        const cityValue = cityOpts.some(o => o.value === initialCityKey)
            ? initialCityKey
            : (cityOpts.find(o => o.label === initialCityName)?.value || initialCityKey || initialCityName);
        const citySel = makeCityTreePicker(cities, cityValue);
        setTooltip(citySel, 'City climate is resolved by city_id when available. Edit city latitude and climate data from Garden Settings.');
        function selectedCityOption() {
            return cityOpts.find(o => String(o.value) === String(citySel.value)) || null;
        }
        function selectedCityRow() {
            const opt = selectedCityOption();
            return opt ? opt.city : null;
        }

        // base method select (allowed per plant)
        const methodCategorySel = document.createElement('select');
        methodCategorySel.style.width = '100%';
        methodCategorySel.style.padding = '6px';
        methodCategorySel.style.display = 'none';

        // method select (filtered by method)
        const methodSel = document.createElement('select');
        methodSel.style.width = '100%';
        methodSel.style.padding = '6px';
        methodSel.style.display = 'none';

        const combinedMethodSel = document.createElement('select');
        combinedMethodSel.style.width = '100%';
        combinedMethodSel.style.padding = '6px';

        let currentAllowedMethodCategories = [];   // [{method_category_id, method_category_name}]  
        let currentMethods = [];                  // [{method_id, method_name, method_category_id, ...}] 
        const currentMethodsByCategory = new Map();

        async function resetMethodOptionsForPlant(plantId, { preferMethodCategoryId = null } = {}) {
            const pid = Number(plantId);
            let loadedCategories = [];
            try {
                loadedCategories = Number.isFinite(pid)
                    ? await PlantModel.listAllowedMethodCategoriesForPlant(pid)
                    : [];
            } catch (e) {
                console.warn('[Scheduler] Falling back after allowed-category load failure', {
                    plantId: pid,
                    reason: e?.message || String(e)
                });
            }

            currentAllowedMethodCategories = []; // FIX: expose only categories containing a supported method
            currentMethodsByCategory.clear();
            for (const categoryRow of (loadedCategories || [])) {
                const methodCategoryId = normId(categoryRow?.method_category_id);
                if (!methodCategoryId) continue;
                try {
                    const methods = await PlantModel.listMethodsForMethodCategory(methodCategoryId);
                    const validMethods = (methods || []).filter(methodRow => {
                        try {
                            resolveValidMethodRecord(methodRow, methodCategoryId);
                            return true;
                        } catch (_) {
                            return false;
                        }
                    });
                    if (validMethods.length) {
                        currentAllowedMethodCategories.push(categoryRow);
                        currentMethodsByCategory.set(methodCategoryId, validMethods);
                    }
                } catch (e) {
                    console.warn('[Scheduler] Skipping method category option', {
                        plantId: pid,
                        methodCategoryId,
                        reason: e?.message || String(e)
                    });
                }
            }

            if (!currentAllowedMethodCategories.length) {
                currentAllowedMethodCategories = [{
                    method_category_id: 'direct_sow',
                    method_category_name: 'Direct sow'
                }]; // FIX: retain the canonical hard fallback in the dialog
                currentMethodsByCategory.set('direct_sow', [{
                    method_category_id: 'direct_sow',
                    method_id: 'direct_sow.field',
                    method_name: 'Field direct sow'
                }]);
            }

            const opts = (currentAllowedMethodCategories || []).map(mc => ({
                value: normId(mc.method_category_id),
                label: String(mc.method_category_name || mc.method_category_id || '').trim()
            })).filter(o => o.value);

            // Optional but recommended: allow blank selection
            const withBlank = [{ value: '', label: '' }].concat(opts);

            const preferred = normId(preferMethodCategoryId);
            const hasPreferred = preferred && withBlank.some(o => o.value === preferred);

            const desired = hasPreferred ? preferred : (opts[0]?.value ?? '');

            setSelectOptions(methodCategorySel, withBlank, desired);
        }


        async function resetMethodOptionsForMethodCategory(methodCategoryId, { preferMethodId = null } = {}) {
            const mcid = normId(methodCategoryId);
            let loadedMethods = currentMethodsByCategory.get(mcid) || [];
            if (!loadedMethods.length) {
                try {
                    loadedMethods = mcid
                        ? await PlantModel.listMethodsForMethodCategory(mcid)
                        : [];
                } catch (e) {
                    console.warn('[Scheduler] Falling back after method load failure', {
                        methodCategoryId: mcid,
                        reason: e?.message || String(e)
                    });
                }
            }

            currentMethods = (loadedMethods || []).filter(methodRow => { // FIX: invalid DB methods must not enter the UI
                try {
                    resolveValidMethodRecord(methodRow, mcid);
                    return true;
                } catch (e) {
                    console.warn('[Scheduler] Skipping invalid method option', {
                        methodCategoryId: mcid,
                        methodId: methodRow?.method_id,
                        reason: e?.message || String(e)
                    });
                    return false;
                }
            });

            if (!currentMethods.length && mcid.toLowerCase() === 'direct_sow') {
                currentMethods = [{
                    method_category_id: 'direct_sow',
                    method_id: 'direct_sow.field',
                    method_name: 'Field direct sow'
                }]; // FIX: preserve the final canonical fallback without requiring a valid DB row
            }
            if (mcid && currentMethods.length) currentMethodsByCategory.set(mcid, currentMethods);

            const opts = (currentMethods || []).map(m => ({
                value: normId(m.method_id),
                label: String(m.method_name || m.method_id || '').trim()
            })).filter(o => o.value);

            const withBlank = [{ value: '', label: '' }].concat(opts);

            const preferred = normId(preferMethodId);
            const hasPreferred = preferred && withBlank.some(o => o.value === preferred);

            const desired = hasPreferred ? preferred : (opts[0]?.value ?? '');

            setSelectOptions(methodSel, withBlank, desired);
        }

        function syncCombinedMethodControl() {
            const desiredValue = encodeMethodSelection(methodCategorySel.value, methodSel.value);
            combinedMethodSel.innerHTML = '';
            currentAllowedMethodCategories.forEach(category => {
                const methodCategoryId = normId(category?.method_category_id);
                const methods = currentMethodsByCategory.get(methodCategoryId) || [];
                if (!methodCategoryId || !methods.length) return;
                const group = document.createElement('optgroup');
                group.label = String(category?.method_category_name || methodCategoryId);
                methods.forEach(method => {
                    const methodId = normId(method?.method_id);
                    if (!methodId) return;
                    const option = document.createElement('option');
                    option.value = encodeMethodSelection(methodCategoryId, methodId);
                    option.textContent = String(method?.method_name || methodId);
                    group.appendChild(option);
                });
                if (group.children.length) combinedMethodSel.appendChild(group);
            });
            if (Array.from(combinedMethodSel.options).some(option => option.value === desiredValue)) {
                combinedMethodSel.value = desiredValue;
            } else if (combinedMethodSel.options[0]) {
                combinedMethodSel.selectedIndex = 0;
            }
            const selected = decodeMethodSelection(combinedMethodSel.value);
            if (selected) {
                methodCategorySel.value = selected.methodCategoryId;
                methodSel.value = selected.methodId;
            }
        }


        // Prefill method category + method from existing cell attrs
        const cellMethodCategoryId0 = (() => {
            const raw = cell?.getAttribute?.('method_category_id');
            const s = String(raw ?? '').trim();
            return normId(s) || null;
        })();

        const cellMethodId0 = (() => {
            const raw = cell?.getAttribute?.('method_id')
            const s = String(raw ?? '').trim();
            return normId(s) || null;
        })();


        // initialize method category + method for initial plant (prefer persisted per-cell selection)
        await resetMethodOptionsForPlant(selPlant.plant_id, {
            preferMethodCategoryId: cellMethodCategoryId0
        });

        const preferredMethod0 = String(
            cellMethodId0
            ?? effectivePlant?.default_planting_method
            ?? ''
        );

        await resetMethodOptionsForMethodCategory(methodCategorySel.value, {
            preferMethodId: preferredMethod0
        });
        syncCombinedMethodControl();

        // Start/End inputs + auto buttons
        const initialStartISO = fmtISO(earliestFeasibleSowDate); // FIX: allow an explicitly empty no-window state
        const initialLatestHarvestEndISO = fmtISO(latestHarvestEndDate);
        const initialSelectedHarvestEndISO = fmtISO(selectedHarvestEndDate);
        const transplantDaysOverrideInitial = normalizeTransplantDays(initialTransplantDaysOverrideValue);

        // User-selectable derived sowing season
        const sowingSeasonSel = makeSelect([], '');
        const sowingSeasonBoundsInput = makeDisplayField('');

        // User-controlled first sow date (used for schedule startISO)                   
        const derivedPrimaryStartISO = String(derivedContext?.defaultPrimaryStartISO || '').trim();
        const initialPrimaryDateISO = derivedPrimaryStartISO || primaryDateFromSowDate(initialStartISO, methodSel.value, transplantDaysOverrideInitial ?? plantDefaultTransplantDays(effectivePlant));
        const initialInternalStartISO = derivedPrimaryStartISO
            ? sowDateFromPrimaryDate(derivedPrimaryStartISO, methodSel.value, transplantDaysOverrideInitial ?? plantDefaultTransplantDays(effectivePlant))
            : initialStartISO;
        const startInput = makeDate(initialPrimaryDateISO, false);

        // Auto-computed season end constraint (read-only for annuals, editable for perennials)
        const seasonEndInput = makeDate(initialLatestHarvestEndISO, true);

        const harvestStartInput = makeDisplayField('', { emphasis: true });
        const harvestEndInput = makeDisplayField(initialSelectedHarvestEndISO);
        const daysToFirstHarvestInput = makeDisplayField('');
        let userEditedStartThisSession = false; // FIX: distinguish session intent from persisted state
        let generatedStartThisSession = !hasPersistedSchedule && !mode.perennial && !!initialInternalStartISO;
        let latestScheduleResult = null;

        const startNoteSpan = document.createElement('span');
        startNoteSpan.style.marginLeft = '8px'; startNoteSpan.style.fontSize = '12px'; startNoteSpan.style.color = '#92400e';
        startNoteSpan.textContent = startNote || '';
        const scheduleGapHint = document.createElement('span');
        scheduleGapHint.style.marginLeft = '8px';
        scheduleGapHint.style.fontSize = '12px';
        scheduleGapHint.style.color = '#6b7280';
        scheduleGapHint.style.display = 'none';
        let scheduleGapTooltipText = '';
        let companionTimingTooltipText = '';
        function updatePrimaryDateTooltip() {
            setTooltip(startInput, [scheduleGapTooltipText, companionTimingTooltipText].filter(Boolean).join('\n\n'));
        }
        const companionTimingHelp = document.createElement('span');
        companionTimingHelp.style.marginLeft = '8px';
        companionTimingHelp.style.fontSize = '12px';
        companionTimingHelp.style.color = '#374151';
        function updateCompanionTimingHelp() {
            if (derivedContext?.mode !== 'companion') { companionTimingTooltipText = ''; updatePrimaryDateTooltip(); return; }
            const plantId = String(plantSel?.value || selPlant?.plant_id || '');
            const rel = derivedContext.relationshipByPlantId?.get?.(plantId);
            const recommended = Number(rel?.recommendedStartOffsetDays ?? 0);
            const actual = daysDeltaISO(derivedContext.sourceOccupancy?.startISO, startInput.value);
            const text = 'Recommended offset: ' + formatSignedDays(recommended) + '; current actual offset: ' + (actual == null ? 'n/a' : formatSignedDays(actual)) + '. Saved actual offset is computed when the schedule is saved.';
            companionTimingHelp.textContent = text;
            companionTimingTooltipText = text;
            updatePrimaryDateTooltip();
            setTooltip(companionTimingHelp, text);
        }
        updateCompanionTimingHelp();

        // --- Harvest window
        const hwDefault = effectivePlant.defaultHW();
        const harvestWindowInput = makeNullableNumber(hwDefault ?? null, { min: 0, step: 1 });
        const growthStageSel = makeSelect([{ value: initialGrowthStage.stageKey, label: initialGrowthStage.stageLabel }], initialGrowthStage.stageKey);
        let currentGrowthStages = [initialGrowthStage];
        const minYieldMultInput = makeNumber(0.50, { min: 0 }); minYieldMultInput.step = '0.01';
        minYieldMultInput.max = '1';
        const transplantDaysOverrideChk = makeCheckbox(transplantDaysOverrideInitial != null);
        const transplantDaysInput = makeNullableNumber(transplantDaysOverrideInitial, { min: 1, step: 1 });
        const transplantDaysWrap = document.createElement('div');
        transplantDaysWrap.style.display = 'flex';
        transplantDaysWrap.style.alignItems = 'center';
        transplantDaysWrap.style.gap = '8px';
        transplantDaysWrap.style.width = '100%';
        const transplantDaysOverrideLabel = document.createElement('label');
        transplantDaysOverrideLabel.style.display = 'flex';
        transplantDaysOverrideLabel.style.alignItems = 'center';
        transplantDaysOverrideLabel.style.gap = '4px';
        transplantDaysOverrideLabel.style.whiteSpace = 'nowrap';
        transplantDaysOverrideLabel.appendChild(transplantDaysOverrideChk);
        transplantDaysOverrideLabel.appendChild(document.createTextNode('Override'));
        const transplantDaysBaseHint = document.createElement('span');
        transplantDaysBaseHint.style.fontSize = '11px';
        transplantDaysBaseHint.style.color = '#6b7280';
        transplantDaysWrap.appendChild(transplantDaysOverrideLabel);
        transplantDaysWrap.appendChild(transplantDaysInput);
        transplantDaysWrap.appendChild(transplantDaysBaseHint);

        // --- Season control (single field) ---
        const seasonStartYear0 = finiteNumberOrNull(cell.getAttribute?.('season_start_year'))
            ?? earliestFeasibleSowDate?.getUTCFullYear?.()
            ?? (new Date()).getUTCFullYear();
        const seasonYearInput = makeNumber(seasonStartYear0, { min: 1900 });
        seasonYearInput.step = '1';

        let taskTemplate = null;
        let taskRules = Array.isArray(taskTemplate?.rules) ? [...taskTemplate.rules] : [];
        // --- task reset helpers ----------------------------------------------------   
        let taskDirty = false;
        let taskTemplateResetRequested = false;
        let plantDefaultTaskDeleteRequested = false;

        const saveDefaultChk = makeCheckbox(false);
        const climateModelModuleCell = (() => {
            const graph = ui?.editor?.graph;
            const model = graph && typeof graph.getModel === 'function' ? graph.getModel() : null;
            return model ? findGardenModuleAncestor(model, cell) : null;
        })();

        // Prefill plant/variety from existing cell attrs
        const cellVarietyId0 = (() => {
            const raw = cell?.getAttribute?.('variety_id');
            const n = Number(raw);
            return Number.isFinite(n) && n > 0 ? n : null;
        })();

        // --- Central form state ---------------------------------------------------- 
        const formState = {
            plantId: initId,
            varietyId: cellVarietyId0,
            cityId: finiteNumberOrNull(selectedCityRow()?.city_id) ?? finiteNumberOrNull(initialCityId),
            cityName: String(selectedCityRow()?.city_name || selectedCityOption()?.label || initialCityName || ''),

            // keep both (methodCategoryId is for UI + filtering; methodId is the scheduler “method” everywhere)
            methodCategoryId: methodCategorySel.value,
            methodId: methodSel.value,

            startISO: initialInternalStartISO,
            seasonEndISO: mode.perennial ? seasonEndInput.value : '', // CHANGED: reserve seasonEndISO for perennial lifespan end.
            latestHarvestEndISO: mode.perennial ? '' : initialLatestHarvestEndISO, // ADDED: annual display output is not a scheduling constraint.
            seasonStartYear: Number(seasonYearInput.value || (new Date()).getUTCFullYear()),
            growthStageKey: initialGrowthStage.stageKey,
            growthStage: initialGrowthStage,
            harvestWindowDays: (harvestWindowInput.value === '' ? null : Number(harvestWindowInput.value)),
            minYieldMultiplier: Number(minYieldMultInput.value || 0),
            sowingSeasons: [],
            activeSowingSeasonId: '',
            windowFeasible: mode.perennial || !!initialWindowFeasible,
            firstHarvestISO: null,
            lastHarvestISO: mode.perennial ? null : initialSelectedHarvestEndISO,
            lastHarvestSource: 'auto',
            bedProfile: normalizeBedProfile(scheduleBedProfile), // ADDED: keep bed-aware soil modeling stable across form recomputes.
            bedProfileSource: String(scheduleBedProfileSource || 'generic garden bed'),
            dailyClimate: initialDailyClimate,
            dailyClimateKey: initialDailyClimateKey,
            climateModelModuleCell,
            climateModelDraftPatch: null,
            climateModelPolicy: DEFAULT_CLIMATE_MODEL_POLICY,
            scheduleWarnings: [],
            transplantDaysOverrideEnabled: transplantDaysOverrideInitial != null,
            transplantDaysOverrideValue: transplantDaysOverrideInitial
        };
        const layoutTab = document.createElement('div');
        layoutTab.className = 'usl-scheduler-layout-tab';
        const layoutTemplateSel = makeSelect([
            { value: 'beside', label: 'Beside' },
            { value: 'interplant', label: 'Interplant' },
            { value: 'staggered', label: 'Staggered' }
        ], 'beside');
        const layoutSpacingXInput = makeNullableNumber('', { min: 0.1, step: 0.1 });
        const layoutSpacingYInput = makeNullableNumber('', { min: 0.1, step: 0.1 });
        const layoutOffsetXInput = makeNullableNumber('', { step: 0.1 });
        const layoutOffsetYInput = makeNullableNumber('', { step: 0.1 });
        const saveLayoutDefaultChk = makeCheckbox(false);
        const layoutPreview = document.createElement('div');
        layoutPreview.className = 'usl-layout-preview';
        const layoutStatus = document.createElement('div');
        layoutStatus.className = 'usl-layout-status';
        const layoutGroupEditor = document.createElement('div');
        layoutGroupEditor.className = 'usl-companion-layout-editor';
        let singleLayoutSectionWrap = null;
        let groupLayoutSectionWrap = null;
        let companionLayoutEditorState = null;
        let companionLayoutEditorLoadToken = 0;

        function currentLayoutRelationship() {
            return derivedContext?.mode === 'companion' ? derivedContext.relationshipByPlantId?.get?.(String(plantSel?.value || '')) : null;
        }
        function selectedLayoutPlant() {
            return effectivePlant || findPlantById(Number(plantSel.value)) || selPlant;
        }
        function readLayoutDraftFromControls() {
            return {
                template: normalizeCompanionLayoutTemplate(layoutTemplateSel.value) || 'beside',
                spacingXCm: readNullableNumber(layoutSpacingXInput),
                spacingYCm: readNullableNumber(layoutSpacingYInput),
                offsetXCm: readNullableNumber(layoutOffsetXInput),
                offsetYCm: readNullableNumber(layoutOffsetYInput)
            };
        }
        function writeLayoutControlsFromSelection() {
            const targetPlant = selectedLayoutPlant();
            const relationship = currentLayoutRelationship();
            const layout = derivedContext?.mode === 'companion'
                ? resolveCompanionLayout(derivedContext.sourceCell || cell, targetPlant, relationship, {})
                : resolveCompanionLayout(cell, targetPlant, null, { template: 'beside', offsetXCm: 0, offsetYCm: 0 });
            layoutTemplateSel.value = layout.template || 'beside';
            layoutSpacingXInput.value = layout.spacingXCm == null ? '' : String(layout.spacingXCm);
            layoutSpacingYInput.value = layout.spacingYCm == null ? '' : String(layout.spacingYCm);
            layoutOffsetXInput.value = derivedContext?.mode === 'companion' ? (layout.offsetXCm == null ? '' : String(layout.offsetXCm)) : '0';
            layoutOffsetYInput.value = derivedContext?.mode === 'companion' ? (layout.offsetYCm == null ? '' : String(layout.offsetYCm)) : '0';
            layoutTemplateSel.disabled = derivedContext?.mode !== 'companion';
            layoutOffsetXInput.disabled = derivedContext?.mode !== 'companion';
            layoutOffsetYInput.disabled = derivedContext?.mode !== 'companion';
            saveLayoutDefaultChk.checked = false;
            companionLayoutEditorState = null; // CHANGE: schedule saves no longer prepare anchor-based companion layout state.
            if (singleLayoutSectionWrap) singleLayoutSectionWrap.style.display = 'none'; // CHANGE
            if (groupLayoutSectionWrap) groupLayoutSectionWrap.style.display = 'none'; // CHANGE
        }
        function syncLayoutDraftFromControls() {
            if (companionLayoutEditorState?.active) {
                const groupDraft = readCompanionGroupLayoutDraftFromEditor();
                const selectedPlantId = String(formState.plantId || plantSel?.value || '');
                const companionDraft = groupDraft?.rows?.find(row => row.role === 'companion' && String(row.plantId || '') === selectedPlantId)
                    || groupDraft?.rows?.find(row => row.role === 'companion')
                    || groupDraft?.rows?.[0]
                    || {};
                if (derivedContext?.mode === 'companion') {
                    derivedContext.groupLayoutDraft = groupDraft;
                    derivedContext.layoutDraft = companionDraft;
                }
                return companionDraft;
            }
            const draft = readLayoutDraftFromControls();
            formState.layoutTemplate = draft.template;
            formState.layoutSpacingXCm = draft.spacingXCm;
            formState.layoutSpacingYCm = draft.spacingYCm;
            formState.layoutOffsetXCm = draft.offsetXCm;
            formState.layoutOffsetYCm = draft.offsetYCm;
            if (derivedContext?.mode === 'companion') derivedContext.layoutDraft = draft;
            return draft;
        }
        function plantForLayoutCell(layoutCell) {
            return findPlantById(cellPlantId(layoutCell)) || null;
        }
        function readCellLayoutNumber(layoutCell, key) {
            return layoutNumberOrNull(layoutCell?.getAttribute?.(key));
        }
        function bedRelativeOffsetForCell(layoutCell, bedCell) {
            const pxPerCm = 5 * 0.18;
            const rect = graphRectForCell(layoutCell);
            const bedRect = graphRectForCell(bedCell);
            if (!rect || !bedRect) {
                return {
                    x: readCellLayoutNumber(layoutCell, 'layout_offset_x_cm') ?? 0,
                    y: readCellLayoutNumber(layoutCell, 'layout_offset_y_cm') ?? 0
                };
            }
            return {
                x: readCellLayoutNumber(layoutCell, 'layout_offset_x_cm') ?? ((rect.x - bedRect.x) / pxPerCm),
                y: readCellLayoutNumber(layoutCell, 'layout_offset_y_cm') ?? ((rect.y - bedRect.y) / pxPerCm)
            };
        }
        function rowInitialSnapshot(rowState) {
            return {
                template: rowState.template || '',
                spacingXCm: rowState.spacingXCm,
                spacingYCm: rowState.spacingYCm,
                vegDiameterCm: rowState.vegDiameterCm,
                offsetXCm: rowState.offsetXCm,
                offsetYCm: rowState.offsetYCm
            };
        }
        function writeLayoutRowControls(rowState, snapshot) {
            if (rowState.templateControl) rowState.templateControl.value = normalizeCompanionLayoutTemplate(snapshot.template) || 'beside';
            if (rowState.spacingXControl) rowState.spacingXControl.value = snapshot.spacingXCm == null ? '' : String(snapshot.spacingXCm);
            if (rowState.spacingYControl) rowState.spacingYControl.value = snapshot.spacingYCm == null ? '' : String(snapshot.spacingYCm);
            if (rowState.vegDiameterControl) rowState.vegDiameterControl.value = snapshot.vegDiameterCm == null ? '' : String(snapshot.vegDiameterCm);
            if (rowState.offsetXControl) rowState.offsetXControl.value = snapshot.offsetXCm == null ? '' : String(snapshot.offsetXCm);
            if (rowState.offsetYControl) rowState.offsetYControl.value = snapshot.offsetYCm == null ? '' : String(snapshot.offsetYCm);
        }
        function readAnchorLayoutRow(anchorCell, bedCell) {
            const plant = plantForLayoutCell(anchorCell);
            const defaults = plantSpacingDefaults(plant);
            const offsets = bedRelativeOffsetForCell(anchorCell, bedCell);
            return {
                role: 'anchor',
                cell: anchorCell,
                cellId: String(anchorCell?.id || ''),
                plantId: cellPlantId(anchorCell),
                plantName: plant?.plant_name || cellLayoutLabel(anchorCell),
                label: plant?.plant_name || cellLayoutLabel(anchorCell),
                rect: graphRectForCell(anchorCell),
                spacingXCm: readCellLayoutNumber(anchorCell, 'spacing_x_cm') ?? readCellLayoutNumber(anchorCell, 'spacing_cm') ?? defaults.spacingXCm,
                spacingYCm: readCellLayoutNumber(anchorCell, 'spacing_y_cm') ?? readCellLayoutNumber(anchorCell, 'spacing_cm') ?? defaults.spacingYCm,
                vegDiameterCm: readCellLayoutNumber(anchorCell, 'veg_diameter_cm') ?? defaults.vegDiameterCm,
                offsetXCm: offsets.x,
                offsetYCm: offsets.y
            };
        }
        function relationshipForCompanionLayoutCell(anchorCell, companionCell) {
            const targetPlant = plantForLayoutCell(companionCell);
            const key = String(targetPlant?.plant_id || cellPlantId(companionCell) || '');
            const existing = key ? derivedContext?.relationshipByPlantId?.get?.(key) : null;
            if (existing) return existing;
            const sourcePlant = plantForLayoutCell(anchorCell) || derivedContext?.sourcePlant || null;
            return buildGraphCreatedCompanionRelationship(sourcePlant, targetPlant, {
                startOffsetDays: finiteNumberOrNull(companionCell?.getAttribute?.('companion_start_offset_days')) ?? 0,
                layoutTemplate: companionCell?.getAttribute?.('companion_layout_template') || '',
                layoutSpacingXCm: finiteNumberOrNull(companionCell?.getAttribute?.('companion_layout_spacing_x_cm')),
                layoutSpacingYCm: finiteNumberOrNull(companionCell?.getAttribute?.('companion_layout_spacing_y_cm')),
                layoutOffsetXCm: finiteNumberOrNull(companionCell?.getAttribute?.('companion_offset_x_cm')),
                layoutOffsetYCm: finiteNumberOrNull(companionCell?.getAttribute?.('companion_offset_y_cm')),
                known: !!companionCell?.getAttribute?.('companion_relation_id')
            });
        }
        function defaultCompanionBedOffset(anchorCell, bedCell, relationship, fallback) {
            const sourceOffset = bedRelativeOffsetForCell(anchorCell, bedCell);
            const hasStoredOffset = relationship && (relationship.layoutOffsetXCm != null || relationship.layoutOffsetYCm != null);
            return {
                x: hasStoredOffset ? fallback.offsetXCm : sourceOffset.x + (layoutNumberOrNull(fallback.offsetXCm) ?? 0),
                y: hasStoredOffset ? fallback.offsetYCm : sourceOffset.y + (layoutNumberOrNull(fallback.offsetYCm) ?? 0)
            };
        }
        function readCompanionLayoutRow(anchorCell, companionCell, bedCell) {
            const targetPlant = plantForLayoutCell(companionCell) || selectedLayoutPlant();
            const relationship = relationshipForCompanionLayoutCell(anchorCell, companionCell);
            const fallback = resolveCompanionLayout(anchorCell, targetPlant, relationship, {});
            const template = normalizeCompanionLayoutTemplate(companionCell?.getAttribute?.('companion_layout_template')) || fallback.template;
            const offsets = {
                x: readCellLayoutNumber(companionCell, 'companion_offset_x_cm') ?? readCellLayoutNumber(companionCell, 'layout_offset_x_cm') ?? bedRelativeOffsetForCell(companionCell, bedCell).x,
                y: readCellLayoutNumber(companionCell, 'companion_offset_y_cm') ?? readCellLayoutNumber(companionCell, 'layout_offset_y_cm') ?? bedRelativeOffsetForCell(companionCell, bedCell).y
            };
            return {
                role: 'companion',
                cell: companionCell,
                cellId: String(companionCell?.id || ''),
                plantId: cellPlantId(companionCell),
                plantName: targetPlant?.plant_name || cellLayoutLabel(companionCell),
                label: targetPlant?.plant_name || cellLayoutLabel(companionCell),
                rect: graphRectForCell(companionCell),
                template,
                spacingXCm: readCellLayoutNumber(companionCell, 'spacing_x_cm') ?? readCellLayoutNumber(companionCell, 'companion_layout_spacing_x_cm') ?? fallback.spacingXCm,
                spacingYCm: readCellLayoutNumber(companionCell, 'spacing_y_cm') ?? readCellLayoutNumber(companionCell, 'companion_layout_spacing_y_cm') ?? fallback.spacingYCm,
                vegDiameterCm: readCellLayoutNumber(companionCell, 'veg_diameter_cm') ?? fallback.vegDiameterCm,
                offsetXCm: offsets.x,
                offsetYCm: offsets.y,
                relationship
            };
        }
        function readDraftCompanionLayoutRow(anchorCell, bedCell) {
            const targetPlant = selectedLayoutPlant();
            const relationship = currentLayoutRelationship();
            const fallback = resolveCompanionLayout(anchorCell, targetPlant, relationship, {});
            const offsets = defaultCompanionBedOffset(anchorCell, bedCell, relationship, fallback);
            return {
                role: 'companion',
                cell: null,
                cellId: '',
                plantId: targetPlant?.plant_id ?? formState.plantId,
                plantName: targetPlant?.plant_name || 'Companion',
                label: targetPlant?.plant_name || 'Companion',
                rect: graphRectForCell(anchorCell),
                template: fallback.template,
                spacingXCm: fallback.spacingXCm,
                spacingYCm: fallback.spacingYCm,
                vegDiameterCm: fallback.vegDiameterCm,
                offsetXCm: offsets.x,
                offsetYCm: offsets.y,
                relationship
            };
        }
        function applySavedGroupDefaultToRows(anchorRow, companionRows, savedDefault) {
            const rows = Array.isArray(savedDefault?.rows) ? savedDefault.rows : [];
            if (!rows.length) return;
            const byPlant = new Map(rows.map(row => [String(row.plantId || ''), row]));
            const savedAnchor = byPlant.get(String(anchorRow.plantId || ''));
            if (savedAnchor) {
                anchorRow.spacingXCm = layoutNumberOrNull(savedAnchor.spacingXCm) ?? anchorRow.spacingXCm;
                anchorRow.spacingYCm = layoutNumberOrNull(savedAnchor.spacingYCm) ?? anchorRow.spacingYCm;
                anchorRow.vegDiameterCm = layoutNumberOrNull(savedAnchor.vegDiameterCm) ?? anchorRow.vegDiameterCm;
            }
            companionRows.forEach(row => {
                const saved = byPlant.get(String(row.plantId || ''));
                if (!saved) return;
                row.template = normalizeCompanionLayoutTemplate(saved.template) || row.template;
                row.spacingXCm = layoutNumberOrNull(saved.spacingXCm) ?? row.spacingXCm;
                row.spacingYCm = layoutNumberOrNull(saved.spacingYCm) ?? row.spacingYCm;
                row.vegDiameterCm = layoutNumberOrNull(saved.vegDiameterCm) ?? row.vegDiameterCm;
                row.offsetXCm = layoutNumberOrNull(saved.offsetXCm) ?? row.offsetXCm;
                row.offsetYCm = layoutNumberOrNull(saved.offsetYCm) ?? row.offsetYCm;
            });
        }
        function makeGroupLayoutNumberControl(value, opts = {}) {
            const input = makeNullableNumber(value == null ? '' : String(value), opts);
            input.className = 'usl-companion-layout-input';
            return input;
        }
        function appendCompanionLayoutEditorRow(rowState) {
            rowState.initial = rowInitialSnapshot(rowState);
            const rowEl = document.createElement('div');
            rowEl.className = `usl-companion-layout-row usl-companion-layout-row--${rowState.role}`;
            const name = document.createElement('div');
            name.className = 'usl-companion-layout-name';
            name.textContent = rowState.role === 'anchor' ? `${rowState.label} (anchor)` : rowState.label;
            rowEl.appendChild(name);
            if (rowState.role === 'companion') {
                rowState.templateControl = makeSelect([
                    { value: 'beside', label: 'Beside' },
                    { value: 'interplant', label: 'Interplant' },
                    { value: 'staggered', label: 'Staggered' }
                ], rowState.template || 'beside');
                rowEl.appendChild(rowState.templateControl);
            } else {
                const anchorTag = document.createElement('span');
                anchorTag.className = 'usl-companion-layout-anchor-tag';
                anchorTag.textContent = rowState.role === 'anchor' && derivedContext?.mode === 'companion' ? 'Anchor' : '';
                rowEl.appendChild(anchorTag);
            }
            rowState.spacingXControl = makeGroupLayoutNumberControl(rowState.spacingXCm, { min: 0.1, step: 0.1 });
            rowState.spacingYControl = makeGroupLayoutNumberControl(rowState.spacingYCm, { min: 0.1, step: 0.1 });
            rowState.vegDiameterControl = makeGroupLayoutNumberControl(rowState.vegDiameterCm, { min: 0.1, step: 0.1 });
            rowEl.appendChild(rowState.spacingXControl);
            rowEl.appendChild(rowState.spacingYControl);
            rowEl.appendChild(rowState.vegDiameterControl);
            rowState.offsetXControl = makeGroupLayoutNumberControl(rowState.offsetXCm, { step: 0.1 });
            rowState.offsetYControl = makeGroupLayoutNumberControl(rowState.offsetYCm, { step: 0.1 });
            rowEl.appendChild(rowState.offsetXControl);
            rowEl.appendChild(rowState.offsetYControl);
            rowState.warningEl = document.createElement('div');
            rowState.warningEl.className = 'usl-companion-layout-warning';
            rowEl.appendChild(rowState.warningEl);
            rowState.revertButton = mxUtils.button('Revert', () => revertCompanionLayoutRow(rowState));
            rowState.revertButton.disabled = true;
            applySharedButtonStyle(rowState.revertButton, 'neutral');
            rowEl.appendChild(rowState.revertButton);
            rowState.rowEl = rowEl;
            const controls = [rowState.templateControl, rowState.spacingXControl, rowState.spacingYControl, rowState.vegDiameterControl, rowState.offsetXControl, rowState.offsetYControl].filter(Boolean);
            controls.forEach(control => {
                control.addEventListener('input', () => markCompanionLayoutRowChanged(rowState));
                control.addEventListener('change', () => markCompanionLayoutRowChanged(rowState));
            });
            layoutGroupEditor.appendChild(rowEl);
        }
        function markCompanionLayoutRowChanged(rowState) {
            rowState.changed = true;
            if (rowState.revertButton) rowState.revertButton.disabled = false;
            refreshLayoutPreview();
        }
        function revertCompanionLayoutRow(rowState) {
            if (!rowState?.initial) return;
            writeLayoutRowControls(rowState, rowState.initial);
            rowState.changed = false;
            if (rowState.revertButton) rowState.revertButton.disabled = true;
            refreshLayoutPreview();
        }
        function readCompanionGroupLayoutDraftFromEditor() {
            const state = companionLayoutEditorState;
            if (!state?.active) return null;
            const rows = (state.rows || []).map(row => {
                const draft = {
                    role: row.role,
                    cell: row.cell,
                    cellId: row.cellId,
                    plantId: row.plantId,
                    plantName: row.plantName,
                    label: row.label,
                    rect: row.rect,
                    spacingXCm: readNullableNumber(row.spacingXControl),
                    spacingYCm: readNullableNumber(row.spacingYControl),
                    vegDiameterCm: readNullableNumber(row.vegDiameterControl),
                    offsetXCm: readNullableNumber(row.offsetXControl),
                    offsetYCm: readNullableNumber(row.offsetYControl),
                    changed: !!row.changed
                };
                if (row.role === 'companion') {
                    draft.template = normalizeCompanionLayoutTemplate(row.templateControl?.value) || 'beside';
                    draft.relationship = row.relationship;
                }
                return draft;
            });
            return {
                anchorCell: state.anchor,
                bed: state.bed,
                plantSetKey: CompanionSetLayoutDefaultModel.cropSetKey(rows), // CHANGE: hidden legacy editor uses the anchorless set key if reached.
                anchorPlantId: rows.find(row => row.role === 'anchor')?.plantId ?? null,
                rows
            };
        }
        function refreshCompanionGroupLayoutPreview() {
            const draft = readCompanionGroupLayoutDraftFromEditor();
            if (!draft) return false;
            const anchorRow = draft.rows.find(row => row.role === 'anchor');
            const companionRows = draft.rows.filter(row => row.role === 'companion');
            const model = buildCompanionLayoutPreviewModel({
                bedRect: graphRectForCell(draft.bed),
                anchorRow,
                companionRows,
                requireRealBed: true
            });
            renderLayoutPreviewSvg(layoutPreview, model);
            layoutStatus.textContent = model.warning || (model.status === 'no-bed' ? model.message : '');
            if (model.status === 'ok') {
                const rowModels = new Map((model.rows || []).map(row => [String(row.cellId || row.plantId || row.role || ''), row]));
                (companionLayoutEditorState.rows || []).forEach(row => {
                    if (!row.warningEl) return;
                    row.warningEl.textContent = rowModels.get(String(row.cellId || row.plantId || row.role || ''))?.warning || '';
                });
            }
            return true;
        }
        async function rebuildCompanionGroupLayoutEditor() {
            const token = ++companionLayoutEditorLoadToken;
            const activeGraph = ui?.editor?.graph;
            const initialLinked = collectLinkedCompanionLayoutCells(activeGraph, cell);
            const initialPlantIds = (initialLinked.members || []).map(member => cellPlantId(member));
            if (derivedContext?.mode === 'companion' && formState.plantId != null && !initialPlantIds.some(id => String(id || '') === String(formState.plantId))) initialPlantIds.push(formState.plantId);
            const setInfo = initialPlantIds.length
                ? await CompanionSetLayoutDefaultModel.loadForRows(initialPlantIds.map(plantId => ({ plantId })))
                : null; // CHANGE: legacy group editor fallback reads anchorless set defaults.
            const saved = setInfo?.default || null;
            if (token !== companionLayoutEditorLoadToken) return;
            const linked = collectLinkedCompanionLayoutCells(activeGraph, cell, saved);
            const anchorCell = linked.anchor || cell;
            const bedCell = linked.bed || findContainingBedForScheduleCell(anchorCell);
            const needsDraftCompanion = derivedContext?.mode === 'companion' && linked.companions.length === 0;
            const hasEditor = !!anchorCell;
            companionLayoutEditorState = hasEditor ? { active: true, anchor: anchorCell, companions: linked.companions, bed: bedCell, rows: [] } : null;
            if (singleLayoutSectionWrap) singleLayoutSectionWrap.style.display = 'none';
            if (groupLayoutSectionWrap) groupLayoutSectionWrap.style.display = hasEditor ? '' : 'none';
            layoutGroupEditor.innerHTML = '';
            if (!hasEditor) return;
            const header = document.createElement('div');
            header.className = 'usl-companion-layout-row usl-companion-layout-row--header';
            ['Planting', 'Template', 'Spacing X', 'Spacing Y', 'Veg diam.', 'Offset X', 'Offset Y', 'Warning', 'Revert'].forEach(label => { const el = document.createElement('div'); el.textContent = label; header.appendChild(el); });
            layoutGroupEditor.appendChild(header);
            const anchorRow = readAnchorLayoutRow(anchorCell, bedCell);
            const companionRows = linked.companions.map(companionCell => readCompanionLayoutRow(anchorCell, companionCell, bedCell));
            if (needsDraftCompanion) companionRows.push(readDraftCompanionLayoutRow(anchorCell, bedCell));
            applySavedGroupDefaultToRows(anchorRow, companionRows, saved);
            companionLayoutEditorState.savedDefault = saved;
            companionLayoutEditorState.rows = [anchorRow].concat(companionRows);
            companionLayoutEditorState.rows.forEach(rowState => appendCompanionLayoutEditorRow(rowState));
            refreshCompanionGroupLayoutPreview();
        }
        async function applyCompanionGroupLayoutToGraph() {
            const draft = readCompanionGroupLayoutDraftFromEditor();
            if (!draft) throw new Error('No companion layout group is available to apply.');
            const activeGraph = ui?.editor?.graph;
            const model = activeGraph?.getModel?.();
            if (!activeGraph || !model) throw new Error('Graph is unavailable.');
            const anchorRow = draft.rows.find(row => row.role === 'anchor');
            const companionRows = draft.rows.filter(row => row.role === 'companion');
            const preview = buildCompanionLayoutPreviewModel({ bedRect: graphRectForCell(draft.bed), anchorRow, companionRows, requireRealBed: true });
            if (preview.status !== 'ok') throw new Error(preview.message || 'Layout preview is unavailable.');
            const byCell = new Map(preview.rows.map(row => [String(row.cellId || row.plantId || row.role || ''), row]));
            model.beginUpdate();
            try {
                const tiler = window.USL && window.USL.tiler ? window.USL.tiler : null;
                draft.rows.forEach(row => {
                    if (!row.cell) return;
                    const patch = plantingLayoutAttributePatch(row);
                    const previewRow = byCell.get(String(row.cellId || row.plantId || row.role || ''));
                    if (row.role === 'companion') {
                        patch.companion_layout_anchor_group_id = ''; // CHANGE: legacy pair metadata is cleared rather than refreshed.
                        patch.companion_layout_interplant = ''; // CHANGE
                        patch.companion_layout_clamped = ''; // CHANGE
                    }
                    if (row.role === 'anchor') patch.layout_clamped = previewRow?.dots?.clamped || previewRow?.rect?.clamped ? '1' : '';
                    applyCellAttributePatch(row.cell, patch, model);
                    if (tiler && typeof tiler.retileGroup === 'function') tiler.retileGroup(activeGraph, row.cell, { inTransaction: true, preferInPlace: true });
                });
            } finally {
                model.endUpdate();
            }
            draft.rows.forEach(row => { if (row.cell) activeGraph.refresh?.(row.cell); });
            layoutStatus.textContent = preview.warning || 'Layout applied.';
            (companionLayoutEditorState?.rows || []).forEach(row => { row.changed = false; if (row.revertButton) row.revertButton.disabled = true; });
            refreshCompanionGroupLayoutPreview();
        }
        async function saveCompanionGroupLayoutDefaults() {
            const draft = readCompanionGroupLayoutDraftFromEditor();
            if (!draft) throw new Error('No companion layout group is available to save.');
            await CompanionSetLayoutDefaultModel.save(draft.rows); // CHANGE: even dormant layout default saves target the split, anchorless model.
            layoutStatus.textContent = 'Group layout defaults saved.';
            (companionLayoutEditorState?.rows || []).forEach(row => { row.changed = false; if (row.revertButton) row.revertButton.disabled = true; });
        }
        function buildLayoutGraphApplication(targetCell) { // ADDED: apply row-editor spacing, offsets, and retile intent during Save.
            const draft = readCompanionGroupLayoutDraftFromEditor();
            if (!draft) {
                const layout = readLayoutDraftFromControls();
                return {
                    targetPatch: plantingLayoutAttributePatch(Object.assign({ role: derivedContext?.mode === 'companion' ? 'companion' : 'anchor' }, layout)),
                    targetRect: null,
                    extraAttributePatches: []
                };
            }
            const anchorRow = draft.rows.find(row => row.role === 'anchor');
            const companionRows = draft.rows.filter(row => row.role === 'companion');
            const preview = buildCompanionLayoutPreviewModel({ bedRect: graphRectForCell(draft.bed), anchorRow, companionRows, requireRealBed: true });
            if (preview.status !== 'ok') throw new Error(preview.message || 'Layout preview is unavailable.');
            const selectedPlantId = String(formState.plantId || plantSel?.value || '');
            const targetRow = draft.rows.find(row => row.cell && row.cell === targetCell)
                || draft.rows.find(row => row.role === 'companion' && String(row.plantId || '') === selectedPlantId)
                || draft.rows.find(row => row.cell && row.cell.id && targetCell?.id && String(row.cell.id) === String(targetCell.id))
                || draft.rows[0];
            const rowPatch = row => {
                const patch = plantingLayoutAttributePatch(row);
                if (row.role === 'companion') {
                    patch.companion_layout_anchor_group_id = ''; // CHANGE: hidden legacy editor cannot persist companion-anchor metadata.
                    patch.companion_layout_interplant = ''; // CHANGE
                }
                return patch;
            };
            const extraAttributePatches = draft.rows
                .filter(row => row.cell && row !== targetRow)
                .map(row => ({ cell: row.cell, patch: rowPatch(row), retile: true }));
            return {
                targetPatch: rowPatch(targetRow),
                targetRect: null,
                extraAttributePatches
            };
        }
        function layoutOffsetForDerivedCreation() { // ADDED: pass the requested bed-relative grid origin into sibling creation.
            const draft = readCompanionGroupLayoutDraftFromEditor();
            if (!draft) {
                const layout = readLayoutDraftFromControls();
                return { x: finiteNumberOrNull(layout.offsetXCm) || 0, y: finiteNumberOrNull(layout.offsetYCm) || 0 };
            }
            const selectedPlantId = String(formState.plantId || plantSel?.value || '');
            const companion = draft.rows.find(row => row.role === 'companion' && String(row.plantId || '') === selectedPlantId)
                || draft.rows.find(row => row.role === 'companion');
            if (!companion) return { x: 0, y: 0 };
            return {
                x: finiteNumberOrNull(companion.offsetXCm) || 0,
                y: finiteNumberOrNull(companion.offsetYCm) || 0
            };
        }
        function refreshLayoutPreview() {
            try {
                if (refreshCompanionGroupLayoutPreview()) return;
                const draft = syncLayoutDraftFromControls();
                const anchorCell = derivedContext?.sourceCell || cell;
                const bed = findContainingBedForScheduleCell(anchorCell);
                const bedRect = graphRectForCell(bed);
                const sourceRect = graphRectForCell(anchorCell);
                const sourceSpacing = {
                    spacingXCm: layoutNumberOrNull(anchorCell?.getAttribute?.('spacing_x_cm')) ?? layoutNumberOrNull(anchorCell?.getAttribute?.('spacing_cm')) ?? 30,
                    spacingYCm: layoutNumberOrNull(anchorCell?.getAttribute?.('spacing_y_cm')) ?? layoutNumberOrNull(anchorCell?.getAttribute?.('spacing_cm')) ?? 30
                };
                const model = buildLayoutPreviewModel({
                    bedRect,
                    sourceRect,
                    sourceSpacing,
                    layout: draft,
                    sourceLabel: schedulerCellLabelForGap(anchorCell),
                    companionLabel: selectedLayoutPlant()?.plant_name || 'Companion',
                    requireRealBed: true,
                    showCompanion: derivedContext?.mode === 'companion'
                });
                renderLayoutPreviewSvg(layoutPreview, model);
                layoutStatus.textContent = model.warning || (model.status === 'no-bed' ? model.message : '');
            } catch (e) {
                layoutStatus.textContent = 'Layout preview error: ' + (e?.message || String(e));
            }
        }
        function appendLayoutTabControls() {
            const layoutSection = makeSection('Layout');
            layoutSection.body.appendChild(row('Template:', layoutTemplateSel).row);
            layoutSection.body.appendChild(row('Spacing X (cm):', layoutSpacingXInput).row);
            layoutSection.body.appendChild(row('Spacing Y (cm):', layoutSpacingYInput).row);
            layoutSection.body.appendChild(row('Offset X (cm):', layoutOffsetXInput).row);
            layoutSection.body.appendChild(row('Offset Y (cm):', layoutOffsetYInput).row);
            const saveRow = row(derivedContext?.mode === 'companion' ? 'Save pair default:' : 'Save plant default:', saveLayoutDefaultChk);
            layoutSection.body.appendChild(saveRow.row);
            layoutTab.appendChild(layoutSection.wrap);
            singleLayoutSectionWrap = layoutSection.wrap;
            singleLayoutSectionWrap.style.display = 'none';
            const groupSection = makeSection('Planting layout');
            const intro = document.createElement('div');
            intro.className = 'usl-companion-layout-note';
            intro.textContent = 'Preview updates while editing. Changes are applied to the planting when Save is selected.';
            groupSection.body.appendChild(intro);
            groupSection.body.appendChild(layoutGroupEditor);
            groupSection.body.appendChild(row(derivedContext?.mode === 'companion' ? 'Save layout default:' : 'Save plant default:', saveLayoutDefaultChk).row);
            layoutTab.appendChild(groupSection.wrap);
            groupLayoutSectionWrap = groupSection.wrap;
            const previewSection = makeSection('Bed preview');
            previewSection.body.appendChild(layoutPreview);
            previewSection.body.appendChild(layoutStatus);
            layoutTab.appendChild(previewSection.wrap);
        }
        [layoutTemplateSel, layoutSpacingXInput, layoutSpacingYInput, layoutOffsetXInput, layoutOffsetYInput].forEach(control => {
            control.addEventListener('input', refreshLayoutPreview);
            control.addEventListener('change', refreshLayoutPreview);
        });

        function currentMethodUsesTransplantDateInput() {
            return !mode.perennial && methodUsesTransplantDateInput(formState.methodId);
        }

        function currentTransplantDaysConfig() {
            return resolveTransplantDaysConfig(baseEffectivePlant || effectivePlant, {
                methodId: formState.methodId,
                overrideEnabled: formState.transplantDaysOverrideEnabled,
                overrideValue: formState.transplantDaysOverrideValue
            });
        }

        function displayPrimaryDateISO(startISO = formState.startISO) {
            return primaryDateFromSowDate(startISO, formState.methodId, currentTransplantDaysConfig().effectiveDays);
        }

        function internalSowDateISO(primaryDateISO = startInput.value) {
            return sowDateFromPrimaryDate(primaryDateISO, formState.methodId, currentTransplantDaysConfig().effectiveDays);
        }

        function selectedSeasonStartYear() {
            const year = finiteNumberOrNull(seasonYearInput.value);
            if (year != null && year >= 1900 && year <= 3000) return Math.trunc(year);
            return currentYear;
        }

        function selectedYearDateBounds() {
            const year = selectedSeasonStartYear();
            return {
                year,
                minISO: `${year}-01-01`,
                maxISO: `${year}-12-31`
            };
        }

        function clampPrimaryDateToSelectedYear() {
            const raw = String(startInput.value || '').trim();
            if (!parseISODateUTCValue(raw)) return false;
            const bounds = selectedYearDateBounds();
            if (raw < bounds.minISO) {
                startInput.value = bounds.minISO;
                return true;
            }
            if (raw > bounds.maxISO) {
                startInput.value = bounds.maxISO;
                return true;
            }
            return false;
        }

        function displaySowingSeasons() {
            return projectSowingSeasonsForPrimaryDate(formState.sowingSeasons, formState.methodId, currentTransplantDaysConfig().effectiveDays);
        }

        let schedulerCropPickerRefreshTimer = null;
        let schedulerCropPickerRefreshVersion = 0;
        const schedulerCropSuitabilityCache = makeCropSuitabilityCache();
        subscribeCropSuitabilityCache(schedulerCropSuitabilityCache, () => { scheduleCropPickerSuitabilityRefresh(0); });

        async function refreshSchedulerCropPickerSuitability() {
            const refreshVersion = ++schedulerCropPickerRefreshVersion;
            try {
                const city = await CityClimate.resolve({ cityId: formState.cityId, cityName: formState.cityName });
                const context = city ? {
                    city,
                    cityName: formState.cityName,
                    primaryDateISO: startInput.value || displayPrimaryDateISO(formState.startISO),
                    seasonStartYear: formState.seasonStartYear,
                    climateModelModuleCell,
                    bedProfile: formState.bedProfile,
                    bedProfileSource: formState.bedProfileSource,
                    cache: schedulerCropSuitabilityCache,
                    metadataByPlantId: cropMetadataByPlantId,
                    deferMissingWindows: true
                } : null;
                const nextOptions = context
                    ? await scoreCropPickerOptions(plantsLocal, context)
                    : makeCropPickerOptions(plantsLocal, new Map(), cropMetadataByPlantId);
                if (refreshVersion !== schedulerCropPickerRefreshVersion) return;
                renderSchedulerCropPicker(nextOptions, currentCropPickerSelectedValue);
            } catch (e) {
                console.warn('[Scheduler] Crop suitability ranking failed; falling back to grouped crop order.', e);
                if (refreshVersion === schedulerCropPickerRefreshVersion) renderSchedulerCropPicker(makeCropPickerOptions(plantsLocal, new Map(), cropMetadataByPlantId), currentCropPickerSelectedValue);
            }
        }

        function scheduleCropPickerSuitabilityRefresh(delayMs = 160) {
            if (schedulerCropPickerRefreshTimer) clearTimeout(schedulerCropPickerRefreshTimer);
            schedulerCropPickerRefreshTimer = setTimeout(() => {
                schedulerCropPickerRefreshTimer = null;
                void refreshSchedulerCropPickerSuitability();
            }, Math.max(0, Number(delayMs) || 0));
        }

        function syncStartInputFromState() {
            startInput.value = displayPrimaryDateISO(formState.startISO);
        }

        function displayDateClassification(classification) {
            if (!currentMethodUsesTransplantDateInput() || !classification?.label) return classification;
            return {
                ...classification,
                label: String(classification.label)
                    .replace(/sow date/g, 'transplant date')
                    .replace(/Sow date/g, 'Transplant date')
                    .replace(/sowing season/g, 'transplant season')
                    .replace(/sowing seasons/g, 'transplant seasons')
            };
        }


        function syncStateFromControls() {
            formState.plantId = Number(plantSel.value);
            formState.varietyId = (varietySel && varietySel.value) ? Number(varietySel.value) : null;
            const selectedCity = selectedCityRow();
            formState.cityId = finiteNumberOrNull(selectedCity?.city_id) ?? finiteNumberOrNull(initialCityId);
            formState.cityName = String(selectedCity?.city_name || selectedCityOption()?.label || initialCityName || '');

            formState.methodCategoryId = normId(methodCategorySel.value);
            formState.methodId = normId(methodSel.value);

            const usesTransplantDate = methodUsesTransplantDateInput(formState.methodId);
            formState.transplantDaysOverrideEnabled = usesTransplantDate && !!transplantDaysOverrideChk.checked;
            formState.transplantDaysOverrideValue = formState.transplantDaysOverrideEnabled ? readOptionalIntGE1(transplantDaysInput) : null;
            clampPrimaryDateToSelectedYear();
            formState.startISO = internalSowDateISO(startInput.value);
            formState.activeSowingSeasonId = sowingSeasonSel.value || formState.activeSowingSeasonId || '';
            if (mode.perennial) formState.seasonEndISO = seasonEndInput.value;
            else formState.latestHarvestEndISO = seasonEndInput.value;
            formState.seasonStartYear = selectedSeasonStartYear();
            formState.growthStageKey = normalizeGrowthStageKey(growthStageSel.value);
            formState.growthStage = selectedGrowthStage();
            formState.harvestWindowDays = (harvestWindowInput.value === '' ? null : Number(harvestWindowInput.value));
            formState.minYieldMultiplier = Number(minYieldMultInput.value || 0);
            syncLayoutDraftFromControls();
        }

        function selectedVarietyName() {
            const selectedId = String(varietySel?.value || '').trim();
            if (!selectedId) return '';
            const row = currentVarieties.find(item => String(item.variety_id) === selectedId);
            return row ? String(row.variety_name || '').trim() : '';
        }

        function schedulerCellLabelForGap(cellArg) {
            const plant = String(cellArg?.getAttribute?.('plant_name') || cellArg?.getAttribute?.('crop_name') || '').trim();
            const variety = String(cellArg?.getAttribute?.('variety_name') || cellArg?.getAttribute?.('variety') || '').trim();
            return [plant, variety].filter(Boolean).join(' - ') || String(cellArg?.getAttribute?.('label') || cellArg?.id || 'Planting');
        }

        function schedulerClusterOccupancyItemsForGap() {
            const graph = ui?.editor?.graph;
            const api = graph?.__trellisBedSuccessionNavigator;
            const anchorCell = derivedContext?.sourceCell || cell;
            if (api && typeof api.getSelectedClusterOccupancy === 'function') {
                try {
                    const result = api.getSelectedClusterOccupancy(anchorCell);
                    if (result && Array.isArray(result.items)) return result.items;
                } catch (_) { }
            }
            if (derivedContext?.sourceOccupancy) {
                return [{
                    cellId: String(derivedContext.sourceCell?.id || ''),
                    label: schedulerCellLabelForGap(derivedContext.sourceCell || cell),
                    startISO: derivedContext.sourceOccupancy.startISO,
                    endISO: derivedContext.sourceOccupancy.endISO
                }];
            }
            return [];
        }

        function currentSchedulerTargetGapWindow() {
            const resultStartISO = derivedOccupancyStartISO(latestScheduleResult);
            const resultEndISO = derivedOccupancyEndISO(latestScheduleResult);
            const startISO = resultStartISO || startInput.value || displayPrimaryDateISO(formState.startISO);
            const endISO = resultEndISO || (mode.perennial ? formState.seasonEndISO : (formState.lastScheduleEndISO || formState.lastHarvestISO || harvestEndInput.textContent || ''));
            return startISO && endISO ? { startISO, endISO } : null;
        }

        function currentSchedulerGapWindowAndExclusions() {
            const targetWindow = currentSchedulerTargetGapWindow();
            if (!targetWindow) return null;
            const excludeCellIds = [];
            let basisLabel = 'current planting';
            if (derivedContext?.mode === 'companion') {
                const sourceId = String(derivedContext.sourceCell?.id || '');
                const currentId = String(cell?.id || '');
                if (currentId && currentId !== sourceId) excludeCellIds.push(currentId); // CHANGE: companion creation compares against the source; companion editing excludes only the edited target.
                return {
                    window: targetWindow, // CHANGE: start-field occupancy context follows the companion's own schedule window.
                    excludeCellIds,
                    basisLabel: 'companion planting'
                };
            }
            if (cell?.id) excludeCellIds.push(String(cell.id));
            if (derivedContext?.mode === 'turnover') {
                basisLabel = 'turnover planting';
                excludeCellIds.splice(0, excludeCellIds.length);
            }
            return { window: targetWindow, excludeCellIds, basisLabel };
        }

        function updateScheduleGapHint() {
            const context = currentSchedulerGapWindowAndExclusions();
            const hints = context ? computeSchedulerAdjacentGapHints(schedulerClusterOccupancyItemsForGap(), context.window, {
                excludeCellIds: context.excludeCellIds,
                basisLabel: context.basisLabel
            }) : null;
            const text = hints?.text || '';
            scheduleGapHint.textContent = text;
            scheduleGapHint.style.display = text ? '' : 'none';
            scheduleGapTooltipText = ''; // CHANGE: occupancy relationship context is shown inline beside Start, not duplicated into native tooltips.
            setTooltip(scheduleGapHint, '');
            updatePrimaryDateTooltip();
        }


        function syncControlsFromState({ start = false, end = false, harvest = false } = {}) {
            if (start) {
                syncStartInputFromState();
                if (clampPrimaryDateToSelectedYear()) {
                    formState.startISO = internalSowDateISO(startInput.value);
                }
            }
            if (end) {
                seasonEndInput.value = mode.perennial ? (formState.seasonEndISO || '') : (formState.latestHarvestEndISO || '');
            }
            if (harvest) {
                if (harvestStartInput) {
                    setDisplayFieldValue(harvestStartInput, formState.firstHarvestISO || '');
                }
                if (harvestEndInput) {
                    setDisplayFieldValue(harvestEndInput, formState.lastHarvestISO || '');
                }
            }
            updateDaysToFirstHarvest();
            updateScheduleSummaryFromState();
            updateScheduleGapHint();
        }

        function refreshSowingSeasonSelector() {
            const visibleWindows = displaySowingSeasons();
            const selectorState = buildSowingSeasonSelectorState({
                sowingSeasons: visibleWindows,
                activeSowingSeasonId: formState.activeSowingSeasonId,
                startISO: displayPrimaryDateISO(formState.startISO)
            });
            while (sowingSeasonSel.firstChild) sowingSeasonSel.removeChild(sowingSeasonSel.firstChild);
            selectorState.options.forEach(optionState => {
                const opt = document.createElement('option');
                opt.value = optionState.value;
                opt.textContent = optionState.label;
                opt.disabled = !!optionState.disabled;
                sowingSeasonSel.appendChild(opt);
            });
            sowingSeasonSel.value = selectorState.value;
            setDisplayFieldValue(sowingSeasonBoundsInput, selectorState.boundsText);
        }

        function syncStartDateBounds() {
            if (!startInput) return;
            const bounds = selectedYearDateBounds();
            startInput.min = bounds.minISO;
            startInput.max = bounds.maxISO;
        }

        function updateDaysToFirstHarvest() {
            const sow = parseISODateUTC(formState.startISO);
            const harvest = parseISODateUTC(formState.firstHarvestISO);

            if (!sow || !harvest) {
                setDisplayFieldValue(daysToFirstHarvestInput, '');
                return;
            }

            const dtm = daysBetweenUTC(sow, harvest);
            setDisplayFieldValue(daysToFirstHarvestInput, String(dtm));
        }

        // -------------------- Form schema for simple labeled fields ---------------- 
        const FIELD_SCHEMA = [
            { key: 'seasonStartYear', label: 'Season start year:', control: seasonYearInput },
            { key: 'methodSelection', label: 'Planting method:', control: combinedMethodSel },
            { key: 'growthStage', label: 'Grown for:', control: growthStageSel, tooltip: 'Growth stage scales maturity timing and layout from crop-level stage ratios.' },
            { key: 'harvestWindowDays', label: 'Harvest window days:', control: harvestWindowInput },
            { key: 'minYieldMultiplier', label: 'Minimum yield multiplier:', control: minYieldMultInput },
        ];

        const { fieldRows } = buildFieldRows(FIELD_SCHEMA);
        // ----------------------------------------------------------

        // Load varieties and preselect from cell
        await reloadVarietyOptionsForPlant(formState.plantId, formState.varietyId);
        syncVarietyButtons();

        // Ensure the selected value actually exists; if not, fall back to base plant
        if (formState.varietyId != null && !String(varietySel.value)) {
            formState.varietyId = null;
        }

        await refreshGrowthStageOptionsForPlant(formState.plantId, initialGrowthStage);
        syncStateFromControls();
        await refreshEffectivePlant();
        await resetMethodOptionsForPlant(formState.plantId, {
            preferMethodCategoryId: String(formState.methodCategoryId ?? cellMethodCategoryId0 ?? '')
        });

        await resetMethodOptionsForMethodCategory(methodCategorySel.value, {
            preferMethodId: String(formState.methodId ?? cellMethodId0 ?? effectivePlant?.default_planting_method ?? '')
        });
        syncCombinedMethodControl();


        const sowingSeasonRowObj = row('Sowing season:', sowingSeasonSel);
        const sowingSeasonBoundsRowObj = row('Sowing window:', sowingSeasonBoundsInput);
        setTooltip(sowingSeasonRowObj.label, 'Selectable season generated from the annual scheduler feasibility scan.');
        setTooltip(sowingSeasonSel, 'Choose the feasible sowing season to schedule within.');
        setTooltip(sowingSeasonBoundsRowObj.label, 'Date bounds for the selected sowing season.');
        setTooltip(sowingSeasonBoundsInput, 'Earliest and latest sow dates for the selected sowing season.');

        const firstSowRowObj = row('Sow date:', startInput);
        if (startNote) firstSowRowObj.row.appendChild(startNoteSpan);
        firstSowRowObj.row.appendChild(scheduleGapHint);
        if (derivedContext?.mode === 'companion') firstSowRowObj.row.appendChild(companionTimingHelp);
        const transplantDaysRowObj = row('Transplant lead days:', transplantDaysWrap);
        setTooltip(transplantDaysRowObj.label, 'Days from sowing to transplant for this planting group.');
        setTooltip(transplantDaysInput, 'Unchecked: inherit the plant or variety default. Checked: save a group-specific days_transplant override.');

        const endRow = row('Lifespan end:', seasonEndInput);
        const harvestStartRowObj = row('Expected first harvest:', harvestStartInput);
        const harvestEndRowObj = row('Expected harvest end:', harvestEndInput);
        const daysToFirstHarvestRowObj = row('Days to first harvest:', daysToFirstHarvestInput);

        appendFieldRows(contextSection.body, fieldRows, ['seasonStartYear', 'methodSelection', 'growthStage']);
        const legacyMethodControls = document.createElement('div');
        legacyMethodControls.style.display = 'none';
        legacyMethodControls.appendChild(methodCategorySel);
        legacyMethodControls.appendChild(methodSel);
        contextSection.body.appendChild(legacyMethodControls);

        const contextSummary = document.createElement('div');
        contextSummary.style.marginTop = '8px';
        contextSummary.style.padding = '6px 8px';
        contextSummary.style.border = '1px solid #d1d5db';
        contextSummary.style.background = '#f9fafb';
        contextSummary.style.borderRadius = '4px';
        contextSummary.style.fontSize = '12px';
        contextSummary.style.color = '#374151';
        contextSection.body.appendChild(contextSummary);

        function refreshContextSummary() {
            const bed = normalizeBedProfile(formState.bedProfile);
            const gardenName = formatGardenName(climateModelModuleCell);
            const cityName = String(formState.cityName || citySel.value || '').trim() || '(no city)';
            const bedSource = String(formState.bedProfileSource || 'generic garden bed');
            const bedText = `sun ${prettifyBedConditionValue(bed.sunExposure)}; moisture ${prettifyBedConditionValue(bed.soilMoisture)}; drainage ${prettifyBedConditionValue(bed.drainage)}; texture ${prettifyBedConditionValue(bed.soilTexture)}; frost ${prettifyBedConditionValue(bed.frostRisk)}`;
            contextSummary.textContent = `${gardenName} | ${cityName} | ${bedSource} | ${bedText}`;
            setTooltip(contextSummary, `Garden: ${gardenName}\nCity: ${cityName}\nBed source: ${bedSource}\nBed conditions: ${bedText}`);
        }

        windowSection.body.appendChild(sowingSeasonRowObj.row);
        windowSection.body.appendChild(sowingSeasonBoundsRowObj.row);
        windowSection.body.appendChild(endRow.row);

        inputsSection.body.appendChild(firstSowRowObj.row);
        inputsSection.body.appendChild(transplantDaysRowObj.row);
        const climateSection = makeSection('Climate model');
        climateSection.wrap.style.marginTop = '10px';
        advancedBody.appendChild(climateSection.wrap);
        const climateControlByKey = {};
        const setAsGardenClimateDefaultChk = makeCheckbox(false);
        let climateTipVersion = 0;

        function makeClimateOverrideInput(def) {
            if (def.type === 'enum') {
                return makeSelect(def.options.map(([value, label]) => ({ value, label })), DEFAULT_CLIMATE_MODEL_POLICY[def.key]);
            }
            if (def.type === 'boolean') {
                return makeCheckbox(DEFAULT_CLIMATE_MODEL_POLICY[def.key]);
            }
            const input = makeNullableNumber(DEFAULT_CLIMATE_MODEL_POLICY[def.key], { min: def.min, step: def.step });
            input.max = String(def.max);
            return input;
        }

        function readClimateOverrideInputValue(def, input) {
            if (def.type === 'boolean') return !!input.checked;
            if (def.type === 'enum') return String(input.value || DEFAULT_CLIMATE_MODEL_POLICY[def.key]);
            const n = finiteNumberOrNull(input.value);
            if (def.type === 'integer') return Math.max(def.min, Math.min(def.max, Math.round(n ?? DEFAULT_CLIMATE_MODEL_POLICY[def.key])));
            return Math.max(def.min, Math.min(def.max, n ?? DEFAULT_CLIMATE_MODEL_POLICY[def.key]));
        }

        function setClimateOverrideInputValue(def, input, value) {
            const normalized = normalizeClimateModelPatch({ [def.key]: value });
            const next = Object.prototype.hasOwnProperty.call(normalized, def.key) ? normalized[def.key] : DEFAULT_CLIMATE_MODEL_POLICY[def.key];
            if (def.type === 'boolean') input.checked = !!next;
            else input.value = String(next);
        }

        function formatClimateModelValue(def, value) {
            if (def.type === 'boolean') return value ? 'Enabled' : 'Disabled';
            if (def.type === 'number') return Number(value).toFixed(2);
            return String(value);
        }

        function climateModelTooltipFor(def) {
            const map = {
                springFrostRisk: 'Frost percentile used for the field frost gate. The tip shows the selected season-year date when city data exists.',
                weatherNormalsSource: 'Preferred source for monthly temperature normals. Auto chooses monthly weather, daily weather, then city monthly columns.',
                forecastBlendWeight0To3Days: 'Weight applied to forecast temperatures for dates 0-3 days ahead. 1 uses forecast only; 0 uses normals only.',
                forecastBlendWeight4To7Days: 'Weight applied to forecast temperatures for dates 4-7 days ahead.',
                forecastBlendWeight8To16Days: 'Weight applied to forecast temperatures for dates 8-16 days ahead.',
                soilGateConsecutiveDays: 'Number of consecutive days the estimated soil temperature must meet the crop threshold.',
                gddCalibrationEnabled: 'When enabled, daily crop GDD is scaled to the city annual GDD target when city GDD metadata exists.'
            };
            return map[def.key] || def.label;
        }

        async function refreshClimateModelTips() {
            const version = ++climateTipVersion;
            let city = null;
            try { city = await CityClimate.resolve({ cityId: formState.cityId, cityName: formState.cityName }); } catch (_) { city = null; }
            if (version !== climateTipVersion) return;
            const policy = formState.climateModelPolicy || DEFAULT_CLIMATE_MODEL_POLICY;
            const frostControl = climateControlByKey.springFrostRisk;
            if (frostControl) {
                const tip = city ? resolveFrostRiskTip(city, policy.springFrostRisk, formState.seasonStartYear) : { text: 'City not found', tooltip: 'The selected city could not be loaded, so no frost date can be shown.' };
                frostControl.tip.textContent = tip.text;
                setTooltip(frostControl.tip, tip.tooltip);
                setTooltip(frostControl.effective, `${frostControl.effective.textContent}. ${tip.tooltip}`);
            }
            const weatherControl = climateControlByKey.weatherNormalsSource;
            if (weatherControl) {
                let status = { text: 'Checking source...', tooltip: 'Checking weather source availability.' };
                if (city) {
                    try { status = await resolveWeatherNormalsSourceStatus(city, policy.weatherNormalsSource); }
                    catch (e) { status = { text: 'Source check failed', tooltip: e?.message || String(e) }; }
                } else {
                    status = { text: 'City not found', tooltip: 'The selected city could not be loaded, so weather-source availability cannot be checked.' };
                }
                if (version !== climateTipVersion) return;
                weatherControl.tip.textContent = status.text;
                setTooltip(weatherControl.tip, status.tooltip);
                setTooltip(weatherControl.effective, `${weatherControl.effective.textContent}. ${status.tooltip}`);
            }
        }

        function buildClimateModelPatchFromControls() {
            const patch = {};
            CLIMATE_MODEL_PARAMETER_SCHEMA.forEach(function (def) {
                const control = climateControlByKey[def.key];
                if (!control || control.defaultChk.checked) return;
                patch[def.key] = readClimateOverrideInputValue(def, control.input);
            });
            return normalizeClimateModelPatch(patch);
        }

        function refreshClimateModelControls({ preserveDraft = true } = {}) {
            const saved = resolveClimateModelPolicy(climateModelModuleCell, formState.cityName, formState.plantId, null);
            const draft = preserveDraft ? formState.climateModelDraftPatch : saved.plantPatch;
            formState.climateModelDraftPatch = normalizeClimateModelPatch(draft);
            const resolved = resolveClimateModelPolicy(climateModelModuleCell, formState.cityName, formState.plantId, formState.climateModelDraftPatch);
            formState.climateModelPolicy = resolved.effective;
            CLIMATE_MODEL_PARAMETER_SCHEMA.forEach(function (def) {
                const control = climateControlByKey[def.key];
                if (!control) return;
                const hasOverride = Object.prototype.hasOwnProperty.call(formState.climateModelDraftPatch, def.key);
                control.defaultChk.checked = !hasOverride;
                control.input.disabled = !hasOverride;
                setClimateOverrideInputValue(def, control.input, hasOverride ? formState.climateModelDraftPatch[def.key] : resolved.effective[def.key]);
                control.effective.textContent = `${formatClimateModelValue(def, resolved.effective[def.key])} (${resolved.sources[def.key]})`;
                setTooltip(control.input, climateModelTooltipFor(def));
                setTooltip(control.effective, `${def.label}: ${formatClimateModelValue(def, resolved.effective[def.key])}; source ${resolved.sources[def.key]}. ${climateModelTooltipFor(def)}`);
            });
            void refreshClimateModelTips();
        }

        function handleClimateModelControlChanged() {
            formState.climateModelDraftPatch = buildClimateModelPatchFromControls();
            refreshClimateModelControls({ preserveDraft: true });
        }

        function buildClimateModelModuleAttributePatch() {
            if (!climateModelModuleCell) return null;
            const plantPatch = buildClimateModelPatchFromControls();
            const overrideMap = readClimateModelPlantOverrideMap(climateModelModuleCell);
            const normalizedMap = {};
            Object.keys(overrideMap || {}).forEach(function (key) {
                const patch = normalizeClimateModelPatch(overrideMap[key]);
                if (Object.keys(patch).length) normalizedMap[key] = patch;
            });
            const overrideKey = buildClimatePlantOverrideKey(formState.cityName, formState.plantId);
            if (Object.keys(plantPatch).length) normalizedMap[overrideKey] = plantPatch;
            else delete normalizedMap[overrideKey];
            const patch = { [CLIMATE_MODEL_PLANT_OVERRIDES_ATTR]: stringifyClimateModelAttr(normalizedMap) };
            if (setAsGardenClimateDefaultChk.checked) {
                patch[CLIMATE_MODEL_DEFAULTS_ATTR] = stringifyClimateModelAttr(plantPatch);
            }
            return { cell: climateModelModuleCell, patch };
        }

        CLIMATE_MODEL_PARAMETER_SCHEMA.forEach(function (def) {
            const rowWrap = document.createElement('div');
            rowWrap.style.display = 'grid';
            rowWrap.style.gridTemplateColumns = '180px 90px minmax(120px, 1fr) minmax(160px, 1fr)';
            rowWrap.style.gap = '8px';
            rowWrap.style.alignItems = 'center';
            rowWrap.style.margin = '6px 0';

            const label = document.createElement('label');
            label.textContent = def.label;
            label.style.fontSize = '13px';
            setTooltip(label, climateModelTooltipFor(def));

            const defaultLabel = document.createElement('label');
            defaultLabel.style.display = 'flex';
            defaultLabel.style.gap = '4px';
            defaultLabel.style.alignItems = 'center';
            const defaultChk = makeCheckbox(true);
            defaultLabel.appendChild(defaultChk);
            defaultLabel.appendChild(document.createTextNode('Default'));
            setTooltip(defaultLabel, `Checked: inherit ${def.label} from the garden model or built-in scheduler default. Unchecked: save a plant override for this city and plant.`);

            const input = makeClimateOverrideInput(def);
            input.disabled = true;

            const effective = document.createElement('div');
            effective.style.fontSize = '12px';
            effective.style.color = '#4b5563';

            const tip = document.createElement('div');
            tip.style.fontSize = '11px';
            tip.style.color = '#6b7280';
            tip.style.lineHeight = '1.25';

            const effectiveWrap = document.createElement('div');
            effectiveWrap.appendChild(effective);
            effectiveWrap.appendChild(tip);

            rowWrap.appendChild(label);
            rowWrap.appendChild(defaultLabel);
            rowWrap.appendChild(input);
            rowWrap.appendChild(effectiveWrap);
            climateSection.body.appendChild(rowWrap);
            climateControlByKey[def.key] = { def, defaultChk, input, effective, tip };

            defaultChk.addEventListener('change', () => {
                input.disabled = defaultChk.checked;
                handleClimateModelControlChanged();
                void runUiAsync('Climate model change error', async () => { await recomputeAll('climateModelChanged'); });
            });
            input.addEventListener('input', () => {
                handleClimateModelControlChanged();
                void runUiAsync('Climate model change error', async () => { await recomputeAll('climateModelChanged'); });
            });
            input.addEventListener('change', () => {
                handleClimateModelControlChanged();
                void runUiAsync('Climate model change error', async () => { await recomputeAll('climateModelChanged'); });
            });
        });

        const setDefaultRow = row('Set as default climate model for this garden:', setAsGardenClimateDefaultChk);
        setTooltip(setDefaultRow.label, 'When checked on Save, the unchecked climate override rows become the garden-level climate defaults.');
        setTooltip(setAsGardenClimateDefaultChk, 'Save the currently unchecked climate rows as defaults for this garden module.');
        climateSection.body.appendChild(setDefaultRow.row);
        refreshClimateModelControls({ preserveDraft: false });
        refreshContextSummary();

        appendFieldRows(harvestSection.body, fieldRows, ['harvestWindowDays', 'minYieldMultiplier']);
        harvestSection.body.appendChild(daysToFirstHarvestRowObj.row);

        const baseStartNote = startNote || '';
        let windowActions = null; // FIX: mode rendering owns perennial-only action visibility

        function updateScheduleSummaryFromState() {
            const varietyName = selectedVarietyName();
            const methodName = String(combinedMethodSel?.selectedOptions?.[0]?.textContent || '').trim();
            updateScheduleSummary(summaryView, buildScheduleViewState({
                perennial: mode.perennial,
                windowFeasible: formState.windowFeasible,
                plantName: effectivePlant?.plant_name || selPlant?.plant_name || '',
                varietyName,
                cityName: formState.cityName,
                seasonStartYear: formState.seasonStartYear,
                methodName,
                startISO: formState.startISO,
                selectedDateISO: displayPrimaryDateISO(formState.startISO),
                dateInputMode: currentMethodUsesTransplantDateInput() ? 'transplant' : 'sow',
                sowingSeasons: formState.sowingSeasons,
                activeSowingSeasonId: formState.activeSowingSeasonId,
                firstHarvestISO: formState.firstHarvestISO,
                lastHarvestISO: formState.lastHarvestISO,
                scheduleWarnings: formState.scheduleWarnings
            }));
        }

        function updateTransplantDaysControls() {
            const visible = currentMethodUsesTransplantDateInput();
            transplantDaysRowObj.row.style.display = visible ? '' : 'none';
            transplantDaysOverrideChk.disabled = !visible;
            transplantDaysInput.disabled = !visible || !transplantDaysOverrideChk.checked;
            const plantDays = plantDefaultTransplantDays(baseEffectivePlant || effectivePlant);
            transplantDaysBaseHint.textContent = visible ? `Plant default: ${plantDays}` : '';
            if (visible && !transplantDaysOverrideChk.checked) transplantDaysInput.value = plantDays > 0 ? String(plantDays) : '';
        }

        function applyModeToUI() {
            const perennial = mode.perennial;
            const transplantDateInput = currentMethodUsesTransplantDateInput();

            if (perennial) {
                firstSowRowObj.label.textContent = 'Planting date:';
                endRow.label.textContent = 'Lifespan end:';
                endRow.row.style.display = '';
                harvestStartRowObj.row.style.display = 'none';
                harvestEndRowObj.row.style.display = 'none';
                daysToFirstHarvestRowObj.row.style.display = 'none';
            } else {
                firstSowRowObj.label.textContent = transplantDateInput ? 'Transplant date:' : 'Sow date:';
                sowingSeasonRowObj.label.textContent = transplantDateInput ? 'Transplant season:' : 'Sowing season:';
                sowingSeasonBoundsRowObj.label.textContent = transplantDateInput ? 'Transplant window:' : 'Sowing window:';
                endRow.row.style.display = 'none';
                harvestStartRowObj.row.style.display = '';
                harvestEndRowObj.row.style.display = '';
                daysToFirstHarvestRowObj.row.style.display = '';
            }

            sowingSeasonRowObj.row.style.display = perennial ? 'none' : '';
            sowingSeasonBoundsRowObj.row.style.display = perennial ? 'none' : '';
            timelineSection.wrap.style.display = perennial ? 'none' : '';
            if (windowActions) windowActions.style.display = perennial ? 'none' : '';

            seasonEndInput.disabled = !perennial;
            updateTransplantDaysControls();
            refreshSowingSeasonSelector();
            updateScheduleSummaryFromState();
        }


        function updateStartNote() {
            if (!startNoteSpan) return;
            const classification = displayDateClassification(classifySelectedSowDate({
                perennial: mode.perennial,
                windowFeasible: formState.windowFeasible,
                startISO: formState.startISO,
                sowingSeasons: formState.sowingSeasons,
                activeSowingSeasonId: formState.activeSowingSeasonId
        }, 'open'), 'open');
            const parts = [];
            const warningText = summarizeScheduleWarnings(formState.scheduleWarnings);
            if (warningText) parts.push(warningText);
            if (!mode.perennial && classification.status !== 'feasible') parts.push(classification.label);
            if (baseStartNote && classification.status === 'no_window' && baseStartNote !== 'No feasible window.') parts.push(baseStartNote);

            startNoteSpan.textContent = parts.join(' ');
        }

        function syncScheduleWarningState(warnings = []) {
            formState.scheduleWarnings = Array.isArray(warnings) ? Array.from(warnings) : [];
            updateStartNote();
            updateScheduleSummaryFromState();
        }

        function clearScheduleWarningState() {
            syncScheduleWarningState([]);
        }

        function requireSelectedScheduleDate() {
            if (mode.perennial) return;
            if (!parseISODateUTCValue(formState.startISO)) throw new Error(currentMethodUsesTransplantDateInput() ? 'Select a transplant date.' : 'Select a sow date.');
        }


        // recomputeAnchors:
        //  - concern: climate feasibility window (earliest sow, last feasible sow, climate last harvest)
        //  - does NOT decide scheduling or yield
        //  - allowed to change latestHarvestEndISO ONLY when called with forceWriteEnd=true
        async function recomputeAnchors(forceWriteStart = false, forceWriteEnd = false) {
            try {
                if (mode.perennial) return true; // FIX: lifespan dates are recomputed by recomputeAll

                syncStateFromControls();
                clearScheduleWarningState();

                await refreshEffectivePlant();
                const p = effectivePlant;


                const city = await CityClimate.resolve({ cityId: formState.cityId, cityName: formState.cityName });
                if (!city) throw new Error(`City not found: ${formState.cityName}`);

                const seasonStartYear = formState.seasonStartYear;

                const env = p.cropTempEnvelope();
                const budget = p.firstHarvestBudget();

                const HW_DAYS = resolveHarvestWindowDays(formState.harvestWindowDays, p); // FIX: use the canonical fallback

                const overwinterAllowed = isCrossYearCrop(p); // FIX: biennials may harvest in a later year
                const scanStart = asUTCDate(seasonStartYear, 1, 1);
                const scanEndYear = annualSchedulerScanEndYear(p, seasonStartYear);
                const scanEndHard = asUTCDate(scanEndYear, 12, 31);
                const climateResolution = resolveClimateModelPolicy(climateModelModuleCell, formState.cityName, formState.plantId, formState.climateModelDraftPatch);
                const climatePolicy = climateResolution.effective;
                formState.climateModelPolicy = climatePolicy;
                const dailyClimate = await city.loadDailyClimateModel({ scanStart, scanEndHard, climatePolicy });
                formState.dailyClimate = dailyClimate;
                formState.dailyClimateKey = `${city.city_name || formState.cityName}|${fmtISO(scanStart)}|${fmtISO(scanEndHard)}|${JSON.stringify(climatePolicy)}`;
                const dailyRates = city.dailyRates(env.Tbase, seasonStartYear, climatePolicy);
                const monthlyAvgTemp = city.monthlyMeans(); // CHANGED: physical temperatures stay unshifted; GDD scaling is in daily climate rates.

                const soilGateThresholdC = (Number.isFinite(Number(p.soil_temp_min_plant_c))
                    ? Number(p.soil_temp_min_plant_c)
                    : null);

                const methodCategoryId = normId(formState.methodCategoryId);
                const methodId = normId(formState.methodId);
                const daysTransplant = Number.isFinite(Number(p.days_transplant)) ? Number(p.days_transplant) : 0;

                const lsf = pickFrostByRisk(city, climatePolicy.springFrostRisk);

                const r = annualCore.computeAnnualSowingSeasons({
                    methodCategoryId,
                    methodId,
                    budget,
                    HW_DAYS,
                    dailyRatesMap: dailyRates,
                    monthlyAvgTemp,
                    dailyClimate,
                    Tbase: env.Tbase,
                    cropTemp: env,
                    scanStart,
                    scanEndHard,
                    soilGateThresholdC,
                    soilGateConsecutiveDays: climatePolicy.soilGateConsecutiveDays,
                    startCoolingThresholdC: asCoolingThresholdC(p.start_cooling_threshold_c),
                    useSpringFrostGate: true, // FIX: overwinter support does not disable field frost checks
                    lastSpringFrostDOY: lsf,
                    daysTransplant,
                    overwinterAllowed,
                    plantMetadata: p,
                    cityLatitudeDeg: finiteNumberOrNull(city.latitude ?? city.lat),
                    bedProfile: formState.bedProfile,
                    bedProfileSource: formState.bedProfileSource
                });

                console.log('[recomputeAnchors] result', {
                    forceWriteStart,
                    forceWriteEnd,
                    startISO_before: formState.startISO,
                    latestHarvestEndISO_before: formState.latestHarvestEndISO,
                    sowingSeasons: r.seasons ? r.seasons.map(season => season.label) : [],
                    climateEndDate: r.climateEndDate ? fmtISO(r.climateEndDate) : null,
                    lastFeasibleSowDate: r.lastFeasibleSowDate ? fmtISO(r.lastFeasibleSowDate) : null
                });

                const windows = normalizeSowingSeasons(r.seasons);
                const windowFeasible = windows.length > 0;
                const todayISO = localTodayISO();
                const currentActive = windows.find(window => window.id === formState.activeSowingSeasonId);
                const savedWindow = hasPersistedSchedule && !userEditedStartThisSession
                    ? findSowingSeasonForDate(windows, formState.startISO)
                    : null;
                const savedDateIsOrphan = hasPersistedSchedule && !userEditedStartThisSession && !!formState.startISO && !savedWindow;
                const defaultVisibleWindows = projectSowingSeasonsForPrimaryDate(windows, formState.methodId, currentTransplantDaysConfig().effectiveDays);
                const nextActiveId = savedWindow
                    ? savedWindow.id
                    : (savedDateIsOrphan ? ORPHAN_SOWING_SEASON_ID : ((!forceWriteStart && currentActive) ? currentActive.id : pickDefaultSowingSeasonId(defaultVisibleWindows, { savedStartISO: hasPersistedSchedule ? displayPrimaryDateISO(formState.startISO) : '', todayISO })));
                const defaultVisibleWindow = defaultVisibleWindows.find(window => window.id === String(nextActiveId || '').trim()) || null;
                const defaultPrimaryStartISO = defaultVisibleWindow
                    ? defaultStartForActiveSowingSeason(defaultVisibleWindow, todayISO)
                    : defaultPrimaryStartForSowingSeasons(windows, { todayISO, methodId: formState.methodId, effectiveTransplantDays: currentTransplantDaysConfig().effectiveDays });
                const defaultInternalStartISO = sowDateFromPrimaryDate(defaultPrimaryStartISO, formState.methodId, currentTransplantDaysConfig().effectiveDays);

                const autoHarvestISO = r.climateEndDate
                    ? r.climateEndDate.toISOString().slice(0, 10)
                    : null;

                // Store selectable sowing seasons for display/guidance.
                formState.sowingSeasons = windows;
                formState.activeSowingSeasonId = nextActiveId;
                formState.windowFeasible = windowFeasible;
                formState.firstHarvestISO = null;
                formState.lastHarvestISO = autoHarvestISO;

                // Optionally reset user-chosen first sow date to earliest           
                const preserveGenuineStart = hasPersistedSchedule || userEditedStartThisSession;
                const activeWindow = getActiveSowingSeason(formState);
                formState.startISO = resolveStartAfterWindow({
                    currentStartISO: formState.startISO,
                    activeWindow,
                    feasible: windowFeasible,
                    forceWriteStart,
                    hasPersistedSchedule,
                    userEditedStartThisSession,
                    todayISO,
                    generatedStartISO: defaultInternalStartISO
                });
                generatedStartThisSession = windowFeasible && !preserveGenuineStart && !!formState.startISO;
                if (windowFeasible && forceWriteStart) {
                    hasPersistedSchedule = false; // FIX: the replacement is generated, not the stored schedule
                    userEditedStartThisSession = false;
                    generatedStartThisSession = !!formState.startISO;
                }

                // let auto window drive the annual latest-harvest display date when requested
                if (windowFeasible && forceWriteEnd && r.climateEndDate instanceof Date) {
                    formState.latestHarvestEndISO = r.climateEndDate.toISOString().slice(0, 10);
                } else if (!windowFeasible) {
                    formState.latestHarvestEndISO = ''; // FIX: clear derived annual display end when the window is infeasible
                }

                refreshSowingSeasonSelector();

                syncControlsFromState({
                    start: forceWriteStart || !preserveGenuineStart || !windowFeasible,
                    end: forceWriteEnd || !windowFeasible,
                    harvest: true
                });

                updateStartNote();
                syncStartDateBounds();
                if (!windowFeasible) {
                    clearComputedHarvestResult();
                    showErrorInline('No feasible window.');
                    return false;
                }
                clearErrorInline(); // FIX: clear stale no-window warning after feasibility recovers
                return true; // FIX: allow dependent recomputation only after valid anchors
            } catch (e) {
                console.warn('recomputeAnchors error:', e);
                clearComputedHarvestResult(); // FIX: anchor failure invalidates all schedule-derived harvest state
                showErrorInline('Scheduling error: ' + (e?.message || String(e)));
                return false;
            }
        }

        // --- mode switcher (annual <-> perennial) ---
        function computePerennialEndISO(fromISO, lifespanYears) {
            return computePerennialLifespanEndISO(
                fromISO,
                Number(seasonYearInput.value),
                lifespanYears
            );
        }

        function setPerennialMode(on, plant) {
            mode = getModeForPlant(plant);

            if (mode.perennial) {
                const lifespanYears = requirePerennialLifespanYears(plant);
                // Ensure start date exists                                           
                if (!startInput.value) {
                    const sISO = asUTCDate(Number(seasonYearInput.value), 1, 1)
                        .toISOString().slice(0, 10);
                    startInput.value = sISO;
                }

                // Compute lifespan end based on current start                         
                seasonEndInput.value = computePerennialEndISO(
                    startInput.value,
                    lifespanYears
                );

                formState.startISO = startInput.value;
                formState.seasonEndISO = seasonEndInput.value;
                formState.latestHarvestEndISO = ''; // ADDED: perennial lifespan end is not annual display state.
                formState.firstHarvestISO = null;
                formState.lastHarvestISO = null; // FIX: lifespan end is not a harvest date
                clearScheduleWarningState();
                formState.lastScheduleEndISO = formState.seasonEndISO;
                syncStateFromControls();
                formState.sowingSeasons = [];
                formState.activeSowingSeasonId = '';
                formState.windowFeasible = true;

            } else {
                // Non-perennial: reset HW default and clear dirty flag               
                harvestWindowInput.value = (plant?.defaultHW() ?? '').toString();
                formState.seasonEndISO = ''; // ADDED: annual schedules use lifecycle scan end internally.
                syncStateFromControls();
            }

            applyModeToUI();
        }

        function applySelectedDateOnlyFastPath() {
            if (mode.perennial) return false;
            const result = applyDateToExistingSowingWindows(formState, { startISO: internalSowDateISO(startInput.value) });
            if (!result.applied) return false;
            refreshSowingSeasonSelector();
            updateStartNote();
            syncStartDateBounds();
            return true;
        }

        // recomputeAll:
        //  - concern: policy: when to let climate auto window override constraint
        //  - enforce: annual latestHarvestEndISO and perennial seasonEndISO stay separate
        async function recomputeAll(reason) {
            syncStateFromControls();
            refreshContextSummary();
            void refreshClimateModelTips();

            const isPerennial = mode.perennial;

            if (isPerennial) {
                const lifespanYears = requirePerennialLifespanYears(effectivePlant);
                const endISO = computePerennialEndISO(
                    startInput.value,
                    lifespanYears
                );

                seasonEndInput.value = endISO;
                formState.seasonEndISO = endISO;
                formState.latestHarvestEndISO = ''; // ADDED: perennial lifespan end is not annual display state.

                formState.firstHarvestISO = null;
                formState.lastHarvestISO = null; // FIX: lifespan-only schedules have no inferred harvest
                clearScheduleWarningState();
                formState.lastScheduleEndISO = endISO;
                formState.lastHarvestSource = 'user';
                formState.windowFeasible = true;

                if (harvestStartInput) {
                    setDisplayFieldValue(harvestStartInput, '');
                }
                if (harvestEndInput) {
                    setDisplayFieldValue(harvestEndInput, '');
                }

                updateDaysToFirstHarvest();

                syncStartDateBounds();
                applyModeToUI();
                updateTimeline();
                updateScheduleGapHint();
                refreshContextSummary();
                void refreshClimateModelTips();
                return true;
            }


            switch (reason) {

                case 'growthStageChanged':
                case 'varietyChanged': {
                    await recomputeAnchors(false, true); // CHANGED: crop changes preserve the visible selected date.
                    await recomputeLastHarvestFromSchedule();
                    break;
                }

                case 'yearChanged': {
                    // season → refresh both start and end from feasibility
                    await recomputeAnchors(true, true);

                    await recomputeLastHarvestFromSchedule();
                    break;
                }

                case 'plantChanged': {
                    // City/method/plant change → respect user sow date if dirty
                    await recomputeAnchors(false, true); // CHANGED: crop changes preserve the visible selected date.

                    await recomputeLastHarvestFromSchedule();
                    break;
                }

                case 'cityChanged':
                case 'climateModelChanged':
                case 'methodChanged': {
                    // City/method change → keep user sow date if dirty,              
                    // but don't force end update unless you want to:                 
                    await recomputeAnchors(false, false);

                    await recomputeLastHarvestFromSchedule();
                    break;
                }

                case 'startChanged':
                    // User explicitly changed first sow; keep it, but recompute schedule 
                    if (!applySelectedDateOnlyFastPath()) await recomputeAnchors(false, false);
                    await recomputeLastHarvestFromSchedule();
                    break;

                case 'hwChanged': {
                    await recomputeAnchors(false, false);
                    await recomputeLastHarvestFromSchedule();
                    break;
                }

            }

            // Keep everything in sync, including schedule-derived last harvest
            syncControlsFromState({
                start: true,
                end: true,
                harvest: true
            });
            syncStartDateBounds();
            applyModeToUI();
            updateStartNote();
            updateTimeline();
            refreshContextSummary();
            void refreshClimateModelTips();
            return true;
        }

        let generatedPreviewTasks = []; // CHANGED: lifecycle task dots share the task preview display order.

        const timelineWrap = document.createElement('div');
        timelineWrap.style.display = 'flex';
        timelineWrap.style.flexDirection = 'column';
        timelineWrap.style.gap = '6px';

        timelineSection.body.appendChild(timelineWrap); // CHANGED: lifecycle renderer owns timeline contents.

        function makeTimelineSmallText(text = '') {
            const el = document.createElement('div');
            el.textContent = text;
            el.style.fontSize = '11px';
            el.style.color = '#6b7280';
            el.style.lineHeight = '1.25';
            return el;
        }

        function applyLifecycleTimelineMarkerOffsets(trackWrap) {
            const markers = Array.from(trackWrap.querySelectorAll('button[data-usl-lifecycle-marker="1"]'));
            const rect = trackWrap.getBoundingClientRect ? trackWrap.getBoundingClientRect() : null;
            const trackWidth = Number(rect?.width || trackWrap.clientWidth || 0);
            const offsets = layoutLifecycleTimelineMarkerOffsets(markers.map(marker => ({
                percent: Number(marker.getAttribute('data-timeline-percent'))
            })), trackWidth, 24);
            markers.forEach((marker, index) => {
                const percent = Number(marker.getAttribute('data-timeline-percent'));
                const offset = Number(offsets[index] || 0);
                marker.setAttribute('data-timeline-offset-px', String(offset));
                marker.style.left = Number.isFinite(percent) && offset ? `calc(${percent}% + ${offset}px)` : `${percent}%`;
            });
        }

        function renderLifecycleTimelineTrack(model, classification) {
            const trackWrap = document.createElement('div');
            trackWrap.style.position = 'relative';
            trackWrap.style.height = '58px';
            trackWrap.style.marginTop = '2px';
            const rail = document.createElement('div');
            rail.style.position = 'absolute';
            rail.style.left = '0';
            rail.style.right = '0';
            rail.style.top = '24px';
            rail.style.height = '8px';
            rail.style.background = classification.status === 'feasible' ? '#e5e7eb' : '#fee2e2';
            rail.style.borderRadius = '999px';
            trackWrap.appendChild(rail);

            model.bands.forEach(band => {
                const bandEl = document.createElement('div');
                bandEl.style.position = 'absolute';
                bandEl.style.left = `${band.leftPercent}%`;
                bandEl.style.width = `${band.widthPercent}%`;
                bandEl.style.top = '20px';
                bandEl.style.height = '16px';
                bandEl.style.background = '#bbf7d0';
                bandEl.style.border = '1px solid #86efac';
                bandEl.style.borderRadius = '999px';
                bandEl.style.opacity = '0.78';
                setTooltip(bandEl, `${band.label}: ${band.startISO} to ${band.endISO}`);
                trackWrap.appendChild(bandEl);
            });

            function appendVerticalTimelineBoundary({ percent, label, tooltip, dataAttr }) {
                if (!Number.isFinite(Number(percent))) return;
                const boundary = document.createElement('div');
                if (dataAttr) boundary.setAttribute(dataAttr, '1');
                boundary.style.position = 'absolute';
                boundary.style.left = `${percent}%`;
                boundary.style.top = '8px';
                boundary.style.height = '42px';
                boundary.style.borderLeft = '1px dashed #64748b';
                boundary.style.transform = 'translateX(-50%)';
                boundary.style.opacity = '0.65';
                const labelEl = document.createElement('div');
                labelEl.textContent = label;
                labelEl.style.position = 'absolute';
                labelEl.style.left = `${percent}%`;
                labelEl.style.top = '0';
                labelEl.style.transform = timelineAxisLabelTransform(percent);
                labelEl.style.fontSize = '10px';
                labelEl.style.lineHeight = '1';
                labelEl.style.color = '#64748b';
                labelEl.style.whiteSpace = 'nowrap';
                setTooltip(boundary, tooltip);
                setTooltip(labelEl, tooltip);
                trackWrap.appendChild(boundary);
                trackWrap.appendChild(labelEl);
            }

            if (model.todayPercent != null) {
                appendVerticalTimelineBoundary({
                    percent: model.todayPercent,
                    label: 'Today',
                    tooltip: `Today: ${model.todayISO}`,
                    dataAttr: 'data-usl-today-marker'
                });
            }

            if (model.latestHarvestBoundary) {
                appendVerticalTimelineBoundary({
                    percent: model.latestHarvestBoundary.percent,
                    label: model.latestHarvestBoundary.label,
                    tooltip: model.latestHarvestBoundary.tooltip,
                    dataAttr: 'data-usl-latest-harvest-marker'
                });
            }

            model.visibleMilestones.forEach(milestone => {
                const marker = document.createElement('button');
                marker.type = 'button';
                marker.textContent = milestone.abbr;
                marker.setAttribute('aria-label', milestone.tooltip);
                marker.setAttribute('data-usl-lifecycle-marker', '1');
                marker.setAttribute('data-timeline-percent', String(milestone.percent));
                marker.setAttribute('data-timeline-offset-px', '0');
                marker.style.position = 'absolute';
                marker.style.left = `${milestone.percent}%`;
                marker.style.top = '16px';
                marker.style.width = '24px';
                marker.style.height = '24px';
                marker.style.padding = '0';
                marker.style.borderRadius = '50%';
                marker.style.border = milestone.stage === 'SOW' ? '2px solid #111827' : '2px solid #2563eb';
                marker.style.background = '#fff';
                marker.style.boxSizing = 'border-box';
                marker.style.color = '#111827';
                marker.style.fontSize = '10px';
                marker.style.fontWeight = '700';
                marker.style.lineHeight = '20px';
                marker.style.textAlign = 'center';
                marker.style.transform = 'translateX(-50%)';
                marker.style.cursor = 'pointer';
                marker.style.zIndex = '2';
                attachLifecycleTimelineMarkerTooltip(marker, trackWrap, milestone.tooltip);
                marker.addEventListener('click', () => {
                    void runUiAsync('Timeline action error', async () => {
                        await handleLifecycleMilestoneClick(milestone);
                    });
                });
                if (milestone.hasTaskRule && milestone.stage !== 'SOW') {
                    const dot = document.createElement('span');
                    dot.style.position = 'absolute';
                    dot.style.right = '-2px';
                    dot.style.top = '-2px';
                    dot.style.width = '7px';
                    dot.style.height = '7px';
                    dot.style.borderRadius = '50%';
                    dot.style.background = '#f59e0b';
                    dot.style.border = '1px solid #fff';
                    marker.appendChild(dot);
                }
                trackWrap.appendChild(marker);
            });
            return trackWrap;
        }

        function timelineAxisLabelTransform(percent) {
            const n = Number(percent);
            if (Number.isFinite(n) && n <= 1) return 'translateX(0)';
            if (Number.isFinite(n) && n >= 99) return 'translateX(-100%)';
            return 'translateX(-50%)';
        }

        function renderLifecycleTimelineAxis(model) {
            const axis = model?.axis || { months: [], years: [] };
            const wrap = document.createElement('div');
            wrap.style.position = 'relative';
            wrap.style.height = '34px';
            wrap.style.marginTop = '-6px';
            wrap.style.marginBottom = '2px';
            const monthRow = document.createElement('div');
            monthRow.style.position = 'relative';
            monthRow.style.height = '19px';
            axis.months.forEach(marker => {
                const tick = document.createElement('div');
                tick.style.position = 'absolute';
                tick.style.left = `${marker.percent}%`;
                tick.style.top = '0';
                tick.style.height = '6px';
                tick.style.borderLeft = '1px solid #cbd5e1';
                tick.style.transform = 'translateX(-50%)';
                monthRow.appendChild(tick);
                const label = document.createElement('div');
                label.textContent = marker.label;
                label.style.position = 'absolute';
                label.style.left = `${marker.percent}%`;
                label.style.top = '7px';
                label.style.transform = timelineAxisLabelTransform(marker.percent);
                label.style.fontSize = '10px';
                label.style.lineHeight = '1';
                label.style.color = '#64748b';
                label.style.whiteSpace = 'nowrap';
                setTooltip(label, `${marker.label}: ${marker.iso}`);
                monthRow.appendChild(label);
            });
            const yearRow = document.createElement('div');
            yearRow.style.position = 'relative';
            yearRow.style.height = '15px';
            axis.years.forEach(marker => {
                const label = document.createElement('div');
                label.textContent = marker.label;
                label.style.position = 'absolute';
                label.style.left = `${marker.percent}%`;
                label.style.top = '1px';
                label.style.transform = timelineAxisLabelTransform(marker.percent);
                label.style.fontSize = '10px';
                label.style.lineHeight = '1';
                label.style.fontWeight = '600';
                label.style.color = '#475569';
                label.style.whiteSpace = 'nowrap';
                setTooltip(label, `Year ${marker.label}: ${marker.iso}`);
                yearRow.appendChild(label);
            });
            wrap.appendChild(monthRow);
            wrap.appendChild(yearRow);
            return wrap;
        }

        function renderLifecycleTimelineModel(model, classification) {
            timelineWrap.innerHTML = '';
            if (!model || model.hidden) {
                timelineSection.wrap.style.display = 'none';
                return;
            }
            timelineSection.wrap.style.display = '';
            const bounds = document.createElement('div');
            bounds.style.display = 'flex';
            bounds.style.justifyContent = 'space-between';
            bounds.style.gap = '8px';
            bounds.style.fontSize = '11px';
            bounds.style.color = '#6b7280';
            const startLabel = document.createElement('span');
            const endLabel = document.createElement('span');
            startLabel.textContent = lifecycleTimelineDateLabel(model.bounds.startISO, true);
            endLabel.textContent = lifecycleTimelineDateLabel(model.bounds.endISO, true);
            bounds.appendChild(startLabel);
            bounds.appendChild(endLabel);
            timelineWrap.appendChild(bounds);
            const track = renderLifecycleTimelineTrack(model, classification);
            timelineWrap.appendChild(track);
            applyLifecycleTimelineMarkerOffsets(track);
            timelineWrap.appendChild(renderLifecycleTimelineAxis(model));
            const status = makeTimelineSmallText(classification.label);
            status.style.color = classification.status === 'feasible' ? '#166534' : '#b91c1c';
            timelineWrap.appendChild(status);
        }

        async function handleLifecycleMilestoneClick(milestone) {
            if (milestone?.stage === 'SOW') {
                startInput.focus();
                return;
            }
            if (!milestone?.hasTaskRule || !milestone.taskStage) return;
            await refreshTaskTemplateFromSelection();
            await refreshTasksTabUI();
            const match = findFirstLifecycleTimelineTaskRule(taskRules, milestone.taskStage, generatedPreviewTasks);
            if (!match) return;
            tabsBody.innerHTML = '';
            tabsBody.appendChild(tasksTab);
            setActiveTabButton(tasksTabBtn);
            const taskRowIndex = buildTaskRuleDisplayOrder(taskRules, generatedPreviewTasks).findIndex(entry => entry.originalIndex === match.originalIndex);
            const taskRowEl = taskRowIndex >= 0 ? tasksListDiv.children[taskRowIndex] : null;
            await openTaskEditor(match.rule, match.originalIndex, taskRowEl);
        }

        function updateTimeline() {
            const classification = classifySelectedSowDate({
                perennial: mode.perennial,
                windowFeasible: formState.windowFeasible,
                startISO: formState.startISO,
                sowingSeasons: formState.sowingSeasons,
                activeSowingSeasonId: formState.activeSowingSeasonId
            });
            const model = buildLifecycleTimelineViewModel({
                plant: effectivePlant,
                perennial: mode.perennial,
                seasonStartYear: formState.seasonStartYear,
                startISO: formState.startISO,
                sowingSeasons: formState.sowingSeasons,
                latestHarvestEndISO: formState.latestHarvestEndISO,
                scheduleResult: latestScheduleResult,
                taskRules,
                generatedTasks: generatedPreviewTasks
            });
            renderLifecycleTimelineModel(model, classification);
            updateScheduleSummaryFromState();
        }

        async function handleSchedulePlantChange({ preferVarietyId = null } = {}) { // FIX: provide an awaitable schedule plant workflow
            const preservedPrimaryDateISO = String(startInput.value || '').trim();
            const applyDerivedCompanionDefault = derivedContext?.mode === 'companion' && !userEditedStartThisSession;
            const preserveDerivedGeneratedDate = !!derivedContext?.mode && derivedContext.mode !== 'companion' && !hasPersistedSchedule && !userEditedStartThisSession;
            const preservePrimaryDate = !!parseISODateUTCValue(preservedPrimaryDateISO) && !applyDerivedCompanionDefault && (hasPersistedSchedule || userEditedStartThisSession || preserveDerivedGeneratedDate);
            const newPlant = findPlantById(Number(plantSel.value)); if (!newPlant) return;
            selPlant = newPlant; plantNameSpan.textContent = newPlant.plant_name;

            mode = getModeForPlant(selPlant);

            formState.plantId = Number(plantSel.value);
            currentCropPickerSelectedValue = String(formState.plantId || '');

            const preferredVarietyId = Number(preferVarietyId);
            const hasPreferredVariety = Number.isFinite(preferredVarietyId) && preferredVarietyId > 0;
            await reloadVarietyOptionsForPlant(
                formState.plantId,
                hasPreferredVariety ? preferredVarietyId : null
            ); // FIX: complete variety selection before resolving the effective plant
            formState.varietyId = hasPreferredVariety && varietySel.value
                ? Number(varietySel.value)
                : null;
            syncVarietyButtons();
            await refreshGrowthStageOptionsForPlant(formState.plantId, defaultGrowthStage());
            await refreshEffectivePlant();


            await resetMethodOptionsForPlant(formState.plantId, {
                preferMethodCategoryId: String(formState.methodCategoryId ?? cellMethodCategoryId0 ?? '')
            });

            await resetMethodOptionsForMethodCategory(methodCategorySel.value, {
                preferMethodId: String(formState.methodId ?? cellMethodId0 ?? effectivePlant?.default_planting_method ?? '')
            });
            syncCombinedMethodControl();


            formState.methodCategoryId = normId(methodCategorySel.value);
            formState.methodId = normId(methodSel.value);

            harvestWindowInput.value = (effectivePlant.defaultHW() ?? '');
            formState.harvestWindowDays = (harvestWindowInput.value === '' ? null : Number(harvestWindowInput.value));


            if (preservePrimaryDate) {
                startInput.value = preservedPrimaryDateISO;
                userEditedStartThisSession = !hasPersistedSchedule;
                generatedStartThisSession = preserveDerivedGeneratedDate;
            } else if (applyDerivedCompanionDefault) {
                const rel = derivedContext.relationshipByPlantId?.get?.(String(formState.plantId));
                const recommended = Number(rel?.recommendedStartOffsetDays ?? 0);
                startInput.value = shiftISODate(derivedContext.sourceOccupancy.startISO, recommended);
                userEditedStartThisSession = false;
                generatedStartThisSession = true;
                updateCompanionTimingHelp();
            } else if (generatedStartThisSession) {
                startInput.value = '';
                sowingSeasonSel.value = '';
                formState.startISO = '';
                formState.activeSowingSeasonId = '';
                userEditedStartThisSession = false;
                generatedStartThisSession = false;
            }
            updateCompanionTimingHelp();
            writeLayoutControlsFromSelection();
            refreshLayoutPreview();
            syncStateFromControls();
            refreshClimateModelControls({ preserveDraft: false });

            if (effectivePlant.isPerennial()) {
                setPerennialMode(true, effectivePlant);
            } else {
                setPerennialMode(false, effectivePlant);
            }


            // Let the orchestrator recompute feasibility + schedule                      
            await recomputeAll('plantChanged');
            await refreshTaskTemplateFromSelection();
            scheduleCropPickerSuitabilityRefresh();
        }

        async function handleScheduleVarietyChange() { // FIX: provide an awaitable schedule variety workflow
            syncVarietyButtons();
            syncStateFromControls();
            await refreshEffectivePlant();
            await resetMethodOptionsForPlant(formState.plantId, {
                preferMethodCategoryId: String(formState.methodCategoryId ?? cellMethodCategoryId0 ?? '')
            });

            await resetMethodOptionsForMethodCategory(methodCategorySel.value, {
                preferMethodId: String(formState.methodId ?? effectivePlant?.default_planting_method ?? '')
            });
            syncCombinedMethodControl();

            harvestWindowInput.value = (effectivePlant.defaultHW() ?? '');
            formState.harvestWindowDays = (harvestWindowInput.value === '' ? null : Number(harvestWindowInput.value));
            await recomputeAll('varietyChanged');
            writeLayoutControlsFromSelection();
            refreshLayoutPreview();
            await refreshTaskTemplateFromSelection();
            scheduleCropPickerSuitabilityRefresh();

        }

        lifecycleFilterSel.addEventListener('change', () => {
            renderSchedulerCropPicker(currentCropPickerOptions, currentCropPickerSelectedValue);
        });

        plantSel.addEventListener('change', () => {
            currentCropPickerSelectedValue = String(plantSel.value || '');
            schedulerCropPickerRefreshVersion += 1;
            renderSchedulerCropPicker(currentCropPickerOptions, currentCropPickerSelectedValue);
            void runUiAsync('Plant change error', async () => { // FIX: clear stale inline warnings before crop recompute
                await handleSchedulePlantChange();
            });
        }); // FIX: route native crop changes through the shared async boundary
        varietySel.addEventListener('change', () => {
            void runUiAsync('Variety change error', async () => { // FIX: clear stale inline warnings before variety recompute
                await handleScheduleVarietyChange();
            });
        }); // FIX: route native variety changes through the shared async boundary


        startInput.addEventListener('input', () => {
            void runUiAsync('Date change error', async () => {
                userEditedStartThisSession = true;
                generatedStartThisSession = false;
                clampPrimaryDateToSelectedYear();
                syncStateFromControls();
                updateCompanionTimingHelp();
                refreshLayoutPreview();
                if (mode.perennial) {
                    seasonEndInput.value = computePerennialEndISO(
                        startInput.value,
                        requirePerennialLifespanYears(effectivePlant)
                    );
                    formState.seasonEndISO = seasonEndInput.value;
                    formState.latestHarvestEndISO = '';
                    updateStartNote();
                } else {
                    await recomputeAll('startChanged');
                }
                scheduleCropPickerSuitabilityRefresh();
            });
        });

        sowingSeasonSel.addEventListener('change', () => {
            void runUiAsync('Sowing season change error', async () => {
                formState.activeSowingSeasonId = sowingSeasonSel.value || '';
                formState.startISO = resolveStartForSowingSeasonSwitch(formState.sowingSeasons, formState.activeSowingSeasonId, formState.startISO);
                syncStartInputFromState();
                clampPrimaryDateToSelectedYear();
                formState.startISO = internalSowDateISO(startInput.value);
                userEditedStartThisSession = false;
                generatedStartThisSession = !hasPersistedSchedule && !mode.perennial && !!formState.startISO;
                syncStartDateBounds();
                refreshSowingSeasonSelector();
                updateStartNote();
                await recomputeLastHarvestFromSchedule();
                await refreshTasksTabUI();
            });
        });




        seasonEndInput.addEventListener('input', () => {
            void runUiAsync('Date change error', async () => {
                syncStateFromControls();
            });
        });


        seasonYearInput.addEventListener('input', () => {
            void runUiAsync('Year change error', async () => {
                clampPrimaryDateToSelectedYear();
                syncStartDateBounds();
                await recomputeAll('yearChanged');
                scheduleCropPickerSuitabilityRefresh();
            });
        });

        harvestWindowInput.addEventListener('input', () => {
            void runUiAsync('Harvest window change error', async () => {
                syncStateFromControls();
                await recomputeAll('hwChanged');
                await refreshTaskTemplateFromSelection();
                scheduleCropPickerSuitabilityRefresh();
            });
        });

        growthStageSel.addEventListener('change', () => {
            void runUiAsync('Growth stage change error', async () => {
                syncStateFromControls();
                await refreshEffectivePlant();
                writeLayoutControlsFromSelection();
                refreshLayoutPreview();
                await recomputeAll('growthStageChanged');
                await refreshTaskTemplateFromSelection();
                scheduleCropPickerSuitabilityRefresh();
            });
        });

        minYieldMultInput.addEventListener('input', () => {
            void runUiAsync('Yield change error', async () => {
                syncStateFromControls();
                await recomputeLastHarvestFromSchedule();
            });
        });

        function handleTransplantDaysChanged() {
            void runUiAsync('Transplant days change error', async () => {
                syncStateFromControls();
                await refreshEffectivePlant();
                syncStartInputFromState();
                updateTransplantDaysControls();
                await recomputeAll('methodChanged');
                await refreshTaskTemplateFromSelection();
                scheduleCropPickerSuitabilityRefresh();
            });
        }

        transplantDaysOverrideChk.addEventListener('change', handleTransplantDaysChanged);
        transplantDaysInput.addEventListener('input', handleTransplantDaysChanged);

        citySel.addEventListener('change', () => {
            void runUiAsync('City change error', async () => {
                syncStateFromControls();
                refreshClimateModelControls({ preserveDraft: false });
                await recomputeAll('cityChanged');
                scheduleCropPickerSuitabilityRefresh();
            });
        });

        combinedMethodSel.addEventListener('change', () => {
            void runUiAsync('Method change error', async () => {
                const selected = decodeMethodSelection(combinedMethodSel.value);
                if (!selected) throw new Error('Select a planting method.');
                methodCategorySel.value = selected.methodCategoryId;
                await resetMethodOptionsForMethodCategory(selected.methodCategoryId, {
                    preferMethodId: selected.methodId
                });
                methodSel.value = selected.methodId;
                syncCombinedMethodControl();
                syncStateFromControls();
                await recomputeAll('methodChanged');
                await refreshTaskTemplateFromSelection();
                scheduleCropPickerSuitabilityRefresh();
                updateTasksHeader({
                    methodCategorySel,
                    methodSel,
                    formState,
                    currentMethodSpan,
                    currentTemplateSourceSpan,
                    taskDirty,
                    taskTemplateSource
                });
            });
        });

        methodCategorySel.addEventListener('change', () => {
            void runUiAsync('Method category change error', async () => {
                syncStateFromControls();

                await resetMethodOptionsForMethodCategory(methodCategorySel.value, {
                    preferMethodId: String(formState.methodId ?? effectivePlant?.default_planting_method ?? '')
                });
                syncCombinedMethodControl();

                syncStateFromControls();

                await recomputeAll('methodChanged');
                await refreshTaskTemplateFromSelection();
                scheduleCropPickerSuitabilityRefresh();
                updateTasksHeader({
                    methodCategorySel,
                    methodSel,
                    formState,
                    currentMethodSpan,
                    currentTemplateSourceSpan,
                    taskDirty,
                    taskTemplateSource
                });
            });
        });



        methodSel.addEventListener('change', () => {
            void runUiAsync('Method change error', async () => {
                syncCombinedMethodControl();
                syncStateFromControls();
                await recomputeAll('methodChanged');
                await refreshTaskTemplateFromSelection();
                scheduleCropPickerSuitabilityRefresh();
                updateTasksHeader({
                    methodCategorySel,
                    methodSel,
                    formState,
                    currentMethodSpan,
                    currentTemplateSourceSpan,
                    taskDirty,
                    taskTemplateSource
                });
            });
        });

        // recomputeLastHarvestFromSchedule:
        //  - concern: full schedule under current constraint
        //  - NEVER changes seasonEndISO, only lastScheduleEndISO / lastHarvestISO
        let harvestRecomputeErrorVisible = false; // FIX: track only errors owned by harvest recomputation

        function clearComputedHarvestResult() { // FIX: clear all schedule-derived harvest output together
            latestScheduleResult = null;
            formState.firstHarvestISO = null;
            formState.lastHarvestISO = null;
            formState.lastScheduleEndISO = null; // FIX: remove stale schedule-derived harvest state

            if (harvestStartInput) setDisplayFieldValue(harvestStartInput, '');
            if (harvestEndInput) setDisplayFieldValue(harvestEndInput, '');
            if (daysToFirstHarvestInput) setDisplayFieldValue(daysToFirstHarvestInput, '');
            updateScheduleGapHint();
        }

        function showHarvestRecomputeFailure(message) { // FIX: keep failure cleanup and reporting atomic
            clearComputedHarvestResult();
            clearScheduleWarningState();
            harvestRecomputeErrorVisible = true;
            showErrorInline('Schedule calculation error: ' + String(message || 'No harvest result was produced.')); // FIX: make recompute failures visible
        }

        function clearHarvestRecomputeFailure() {
            if (!harvestRecomputeErrorVisible) return;
            harvestRecomputeErrorVisible = false;
            clearErrorInline(); // FIX: clear the prior recompute error after recovery
        }

        async function recomputeLastHarvestFromSchedule() {
            try {
                syncStateFromControls();

                const { inputs } = await buildScheduleContextFromForm(formState, selPlant, {
                    currentVarieties
                });


                const result = await computeScheduleResult(inputs);
                latestScheduleResult = result;
                syncScheduleWarningState(result.warnings || []);
                const {
                    rows,
                    firstScheduledHarvestISO,
                    lastScheduledHarvestEndISO
                } = result;

                console.log('[SCHEDULE RESULT]', {
                    rowsCount: rows?.length,
                    firstRow: rows?.[0],
                    lastRow: rows?.[rows.length - 1],
                    lastScheduledHarvestEndISO
                });

                if (!rows.length || !lastScheduledHarvestEndISO) {
                    console.log('[recomputeLastHarvestFromSchedule] no rows', {
                        startISO: formState.startISO,
                        scheduleEndISO: inputs.seasonEndISO,
                        latestHarvestEndISO: formState.latestHarvestEndISO,
                        harvestWindowDays: formState.harvestWindowDays,
                    });

                    showHarvestRecomputeFailure('No harvest result was produced for the current schedule.'); // FIX: clear stale values and report the failure
                    return;
                }

                console.log('[recomputeLastHarvestFromSchedule] rows summary', {
                    count: rows.length,
                    first: rows[0],
                    last: rows[rows.length - 1]
                });

                formState.firstHarvestISO = firstScheduledHarvestISO;
                formState.lastScheduleEndISO = lastScheduledHarvestEndISO;
                formState.lastHarvestISO = lastScheduledHarvestEndISO;

                if (harvestStartInput) {
                    setDisplayFieldValue(harvestStartInput, formState.firstHarvestISO || '');
                }
                if (harvestEndInput) {
                    setDisplayFieldValue(harvestEndInput, formState.lastHarvestISO || '');
                }
                updateDaysToFirstHarvest();
                updateScheduleGapHint();
                clearHarvestRecomputeFailure(); // FIX: remove a prior recompute error after success

                console.log('[recomputeLastHarvestFromSchedule] scheduleEnd', {
                    lastScheduleEndISO: formState.lastScheduleEndISO
                });

            } catch (e) {
                console.warn('recomputeLastHarvestFromSchedule error:', e);
                showHarvestRecomputeFailure(e?.message || String(e)); // FIX: clear stale values and surface the calculation error
            }
        }




        const btns = document.createElement('div');
        btns.className = 'usl-scheduler-footer-actions';
        btns.style.marginTop = '12px';
        btns.style.display = 'flex';
        btns.style.justifyContent = 'flex-end';

        const explainBtn = mxUtils.button('Explain Sowing Range', async () => {
            try {
                if (mode.perennial) return; // FIX: perennials have no maturity feasibility scan
                syncStateFromControls();

                const { plant, city, inputs } = await buildScheduleContextFromForm(
                    formState,
                    selPlant,
                    {
                        currentVarieties,
                        bedProfile: formState.bedProfile,
                        bedProfileSource: formState.bedProfileSource
                    } // ADDED: explanations use the same bed-aware soil model as scheduling.
                );

                const explainDerived = inputs.derived();
                const firstSeasonScanEnd = asUTCDate(explainDerived.scanStart.getUTCFullYear(), 12, 31);
                const usePrimarySowScan = inputs.policy?.annualCrossYearHarvestAllowed !== false && firstSeasonScanEnd < explainDerived.scanEndHard;
                const primaryScanOptions = usePrimarySowScan ? { scanEndDate: firstSeasonScanEnd } : {};
                const rows = await explainFeasibilityOverSeason(inputs, null, false, primaryScanOptions);
                const diagnosticsModel = buildFeasibilityDiagnosticsModel(inputs, rows, usePrimarySowScan ? {
                    scanLabel: 'Primary first-season sowing season',
                    scanStartISO: fmtISO(explainDerived.scanStart),
                    scanEndISO: fmtISO(firstSeasonScanEnd)
                } : {});
                const diagnostics = diagnosticsModel.text;
                const scanSummary = formatFeasibilityScanRanges(rows); // FIX: dialog shows compact reason ranges instead of daily JSON.
                const scanRanges = compressFeasibilityScanRanges(rows);
                const sowingSeasonsText = formatSowingSeasonsSummary(formState.sowingSeasons);
                const scheduleQualityDiagnosticRanges = annualCore.computeScheduleQualityDiagnosticRangesForInputs(inputs);
                const scheduleQualityDiagnosticsText = formatScheduleQualityDiagnosticRanges(scheduleQualityDiagnosticRanges);
                const lifecycleRows = usePrimarySowScan ? await explainFeasibilityOverSeason(inputs, null, false, { scanEndDate: explainDerived.scanEndHard }) : null;
                const lifecycleDiagnosticsModel = lifecycleRows ? buildFeasibilityDiagnosticsModel(inputs, lifecycleRows, {
                    scanLabel: 'Lifecycle support through maturity and harvest',
                    scanStartISO: fmtISO(explainDerived.scanStart),
                    scanEndISO: fmtISO(explainDerived.scanEndHard)
                }) : null;
                const lifecycleScanRanges = lifecycleRows ? compressFeasibilityScanRanges(lifecycleRows) : null;
                const lifecycleScanSummary = lifecycleRows ? formatFeasibilityScanRanges(lifecycleRows) : '';

                // include plant & city dictionaries
                const plantDict = toPlainDict(plant);
                const cityDict = toPlainDict(city);
                const plantText = JSON.stringify(plantDict, null, 2);
                const cityText = JSON.stringify(cityDict, null, 2);

                const textParts = [
                    diagnostics,
                    '',
                    'Derived sowing seasons:',
                    sowingSeasonsText,
                    '',
                    'Schedule quality diagnostic ranges:',
                    scheduleQualityDiagnosticsText,
                    '',
                    usePrimarySowScan ? 'Primary first-season sowing scan ranges:' : 'Feasibility scan ranges:',
                    scanSummary,
                    lifecycleDiagnosticsModel ? '' : null,
                    lifecycleDiagnosticsModel ? lifecycleDiagnosticsModel.text : null,
                    lifecycleScanSummary ? '' : null,
                    lifecycleScanSummary ? 'Lifecycle support scan ranges:' : null,
                    lifecycleScanSummary || null,
                    '',
                    'Plant data:',
                    plantText,
                    '',
                    'City data:',
                    cityText
                ].filter(value => value != null).join('\n');

                renderExplainSowingRangeDialog(ui, diagnosticsModel, scanRanges, plantText, cityText, textParts, {
                    diagnosticsTitle: usePrimarySowScan ? 'Primary sowing diagnostics' : 'Diagnostics',
                    scanTitle: usePrimarySowScan ? 'Primary first-season sowing scan ranges' : 'Feasibility scan ranges',
                    sowingSeasonsText,
                    scheduleQualityDiagnosticRanges,
                    lifecycleDiagnosticsModel,
                    lifecycleRanges: lifecycleScanRanges
                });



            } catch (e) { showErrorInline('Explain error: ' + e.message); }
        });

        applySharedButtonStyle(explainBtn, 'open');

        const rightBtns = document.createElement('div');
        rightBtns.className = 'usl-scheduler-action-row';
        rightBtns.style.display = 'flex';
        rightBtns.style.gap = '8px';

        windowActions = document.createElement('div');
        windowActions.style.marginTop = '8px';
        windowActions.appendChild(explainBtn);
        advancedBody.appendChild(windowActions);

        const previewBtn = mxUtils.button('Preview', async () => {
            try {
                syncStateFromControls();
                requireSelectedScheduleDate();

                const { inputs } = await buildScheduleContextFromForm(
                    formState,
                    selPlant,
                    { currentVarieties }
                );
                requireNoBlockingScheduleQualityDiagnostics(inputs);

                const result = computeScheduleResult(inputs);
                syncScheduleWarningState(result.warnings || []);
                if (result.kind === 'perennial') {
                    renderPerennialPreview(ui, result);
                    return;
                }
                const rows = result.rows;
                if (!rows.length) { showErrorInline('No feasible planting dates in the chosen season.'); return; }
                renderPreviewTable(ui, rows);
            } catch (e) { clearScheduleWarningState(); showErrorInline('Preview error: ' + e.message); }
        });


        applySharedButtonStyle(previewBtn, 'neutral');

        const okBtn = mxUtils.button('Save', async () => {
            try {
                syncStateFromControls();
                requireSelectedScheduleDate();

                const { inputs } = await buildScheduleContextFromForm(
                    formState,
                    selPlant,
                    { currentVarieties }
                );
                requireNoBlockingScheduleQualityDiagnostics(inputs);

                // Build taskTemplate object from current rules
                taskTemplate = normalizeTaskTemplate({
                    version: 2,
                    rules: taskRules
                });

                // Validate the complete schedule before mutating the DB or graph.
                const scheduleResult = computeScheduleResult(inputs);
                syncScheduleWarningState(scheduleResult.warnings || []);
                const activeWindow = getActiveSowingSeason(formState);
                handleClimateModelControlChanged();
                const climateModelAttributePatch = buildClimateModelModuleAttributePatch();

                const persistPlantTaskDefault = async () => { // FIX: run DB persistence only after graph mutation succeeds
                    if (saveDefaultChk.checked) {
                        const methodId = normId(formState.methodId);
                        if (!methodId) {
                            throw new Error('Select a planting method before saving a plant default.');
                        }

                        await TaskTemplateModel.saveForSelection({
                            plantId: formState.plantId,
                            methodId,
                            template: taskTemplate
                        });
                    } else if (plantDefaultTaskDeleteRequested) {
                        await TaskTemplateModel.deleteForSelection({
                            plantId: formState.plantId,
                            methodId: normId(formState.methodId)
                        });
                    }
                    if (saveLayoutDefaultChk.checked) {
                        const layoutDraft = syncLayoutDraftFromControls();
                        if (derivedContext?.mode === 'companion') {
                            try {
                                const relationship = currentLayoutRelationship();
                                const sourcePlantForPair = derivedContext.sourcePlant || null;
                                const companionPlantForPair = selectedLayoutPlant();
                                const actualStartOffsetDays = derivedContext.sourceOccupancy ? daysDeltaISO(derivedContext.sourceOccupancy.startISO, derivedOccupancyStartISO(scheduleResult)) : null;
                                const ensured = await CompanionRelationshipModel.ensurePairDefaultsRelationship(sourcePlantForPair, companionPlantForPair, relationship, { startOffsetDays: actualStartOffsetDays });
                                await CompanionRelationshipModel.saveLayoutDefaults(ensured.relationId, layoutDraft, ensured);
                                const companionKey = String(companionPlantForPair?.plant_id || '');
                                if (companionKey) {
                                    derivedContext.relationshipByPlantId?.set?.(companionKey, Object.assign({}, ensured, {
                                        layoutTemplate: layoutDraft.template,
                                        layoutSpacingXCm: layoutDraft.spacingXCm,
                                        layoutSpacingYCm: layoutDraft.spacingYCm,
                                        layoutOffsetXCm: layoutDraft.offsetXCm,
                                        layoutOffsetYCm: layoutDraft.offsetYCm
                                    }));
                                    derivedContext.metadataByPlantId?.set?.(companionKey, Object.assign({ known: true }, ensured));
                                }
                                if (targetCell && ensured.relationId) writeCellAttribute(targetCell, 'companion_relation_id', '', ui?.editor?.graph?.getModel?.() || null); // CHANGE: relationship ids are recommendation data, not planting identity.
                            } catch (e) {
                                throw new Error('Save pair default error: ' + (e?.message || String(e)));
                            }
                        } else {
                            const spacingPatch = {};
                            if (layoutDraft.spacingXCm != null) spacingPatch.spacing_x_cm = layoutDraft.spacingXCm;
                            if (layoutDraft.spacingYCm != null) spacingPatch.spacing_y_cm = layoutDraft.spacingYCm;
                            if (layoutDraft.spacingXCm != null && layoutDraft.spacingYCm != null && layoutDraft.spacingXCm === layoutDraft.spacingYCm) spacingPatch.spacing_cm = layoutDraft.spacingXCm;
                            if (!Object.keys(spacingPatch).length) throw new Error('Enter spacing before saving the plant layout default.');
                            await PlantModel.update(formState.plantId, spacingPatch);
                        }
                    }
                };

                const taskTemplateJson = taskDirty
                    ? JSON.stringify(taskTemplate)
                    : (taskTemplateResetRequested ? "" : undefined);

                let targetCell = cell;
                let createdDerivedCell = null;
                let derivedRelationshipPatch = {};
                let layoutGraphApplication = null;
                const graphForLayoutDefaults = ui?.editor?.graph;
                let spacingLayoutBaseline = !derivedContext ? await captureSpacingLayoutContext(graphForLayoutDefaults, targetCell) : null; // CHANGE: snapshot old bed overlap before schedule dates mutate.
                let forceCompanionSetDefaults = false;
                if (derivedContext) {
                    const graph = ui?.editor?.graph;
                    const relationshipSourceCell = derivedContext.sourceCell || cell;
                    syncLayoutDraftFromControls();
                    derivedRelationshipPatch = buildDerivedRelationshipPatch(relationshipSourceCell, inputs.plant, scheduleResult, derivedContext);
                    if (derivedContext.operation === 'create') {
                        const createSibling = getTilerSiblingCreator(graph);
                        if (!createSibling) throw new Error('Plant tiler sibling creation API is unavailable.');
                        const creationOffset = derivedContext.mode === 'companion' ? layoutOffsetForDerivedCreation() : null;
                        createdDerivedCell = createSibling(graph, relationshipSourceCell, {
                            source: 'scheduler-' + derivedContext.mode,
                            attributes: derivedRelationshipPatch,
                            layoutOffsetCm: creationOffset,
                            onPlacementWarning: message => showErrorInline(message)
                        });
                        if (!createdDerivedCell) throw new Error('Could not create derived plant group.');
                        targetCell = createdDerivedCell;
                        forceCompanionSetDefaults = derivedContext.mode === 'companion'; // CHANGE: newly guided companion plantings should adopt the current set/plant defaults immediately.
                    }
                }
                layoutGraphApplication = buildLayoutGraphApplication(targetCell);
                const targetLayoutPatch = Object.assign({}, derivedRelationshipPatch, layoutGraphApplication.targetPatch || {});

                try {
                    await applyScheduleToGraph(ui, targetCell, inputs, {
                    result: scheduleResult,
                    taskTemplateJson,
                    taskTemplate, // FIX: generate tasks from the in-memory template saved by this action
                    sowingSeasonId: activeWindow?.id || '',
                    sowingSeasonLabel: activeWindow?.label || '',
                    transplantDaysOverrideEnabled: formState.transplantDaysOverrideEnabled,
                    effectiveTransplantDays: inputs?.plant?.days_transplant,
                    targetAttributePatch: targetLayoutPatch,
                    targetGeometryRect: layoutGraphApplication.targetRect,
                    preserveTargetGeometry: !!derivedContext,
                    extraAttributePatches: (layoutGraphApplication.extraAttributePatches || []).concat(climateModelAttributePatch ? [climateModelAttributePatch] : []),
                    applyCompanionSetDefaults: true,
                    spacingLayoutBaseline,
                    forceCompanionSetDefaults,
                    afterGraphUpdate: persistPlantTaskDefault // FIX: undo graph edits if the database write fails
                    });
                } catch (saveError) {
                    if (createdDerivedCell) removeDerivedSiblingIfPresent(ui?.editor?.graph, createdDerivedCell);
                    throw saveError;
                }
                ui.hideDialog();
            } catch (e) {
                clearScheduleWarningState();
                showErrorInline('Scheduling error: ' + e.message);
            }
        });

        applySharedButtonStyle(okBtn, 'add');

        const cancelBtn = mxUtils.button('Cancel', () => ui.hideDialog());
        applySharedButtonStyle(cancelBtn, 'neutral');
        [previewBtn, okBtn, cancelBtn].forEach(b => rightBtns.appendChild(b));
        btns.appendChild(rightBtns);

        await recomputeAll('cityChanged');
        applyModeToUI();
        syncStartDateBounds();
        updateTimeline();


































        // ============================================================================
        // TASK TAB UI
        // ============================================================================

        // 1. Load existing OR resolve from DB fallback chain
        let taskTemplateSource = "unknown";

        const resolved = await resolveTaskTemplate({
            cell,
            plantId: formState.plantId,
            varietyId: formState.varietyId,
            methodId: formState.methodId
        });

        taskTemplate = normalizeTaskTemplate(resolved?.template ?? null);
        taskTemplateSource = resolved?.source ?? "unknown";

        taskRules = Array.isArray(taskTemplate.rules) ? [...taskTemplate.rules] : [];

        // 2. Build the Tasks tab body
        const tasksTab = document.createElement("div");
        // Current method/method category header                                            
        const tasksHeaderRow = document.createElement("div");
        tasksHeaderRow.style.display = "flex";
        tasksHeaderRow.style.justifyContent = "space-between";
        tasksHeaderRow.style.alignItems = "center";
        tasksHeaderRow.style.gap = "8px";
        tasksHeaderRow.style.marginBottom = "10px";


        const currentMethodSpan = document.createElement("div");
        currentMethodSpan.style.fontWeight = "600";
        currentMethodSpan.textContent = "Method: (loading…)";

        const currentTemplateSourceSpan = document.createElement("div");
        currentTemplateSourceSpan.style.fontSize = "12px";
        currentTemplateSourceSpan.style.opacity = "0.85";
        currentTemplateSourceSpan.textContent = "Source: (loading…)";

        const leftHeaderCol = document.createElement("div");
        leftHeaderCol.style.display = "flex";
        leftHeaderCol.style.flexDirection = "column";
        leftHeaderCol.style.gap = "2px";
        leftHeaderCol.appendChild(currentMethodSpan);
        leftHeaderCol.appendChild(currentTemplateSourceSpan);

        tasksHeaderRow.appendChild(leftHeaderCol);

        tasksTab.appendChild(tasksHeaderRow);

        const taskPreviewSection = document.createElement('div');
        taskPreviewSection.style.border = '1px solid #d1d5db';
        taskPreviewSection.style.borderRadius = '6px';
        taskPreviewSection.style.padding = '10px';
        taskPreviewSection.style.marginBottom = '12px';
        const taskPreviewTitle = document.createElement('div');
        taskPreviewTitle.textContent = 'Generated task timeline';
        taskPreviewTitle.style.fontWeight = '600';
        taskPreviewTitle.style.marginBottom = '8px';
        const taskPreviewControls = document.createElement('div');
        taskPreviewControls.style.display = 'flex';
        taskPreviewControls.style.flexWrap = 'wrap';
        taskPreviewControls.style.alignItems = 'center';
        taskPreviewControls.style.gap = '8px 16px';
        taskPreviewControls.style.marginBottom = '8px';
        const taskPreviewRuleSelectors = document.createElement('div');
        taskPreviewRuleSelectors.style.display = 'flex';
        taskPreviewRuleSelectors.style.flexWrap = 'wrap';
        taskPreviewRuleSelectors.style.gap = '6px 12px';
        const taskPreviewStatus = document.createElement('div');
        taskPreviewStatus.style.fontSize = '11px';
        taskPreviewStatus.style.color = '#6b7280';
        taskPreviewStatus.style.marginBottom = '6px';
        const taskPreviewTimeline = document.createElement('div');
        taskPreviewControls.appendChild(taskPreviewRuleSelectors);
        taskPreviewSection.appendChild(taskPreviewTitle);
        taskPreviewSection.appendChild(taskPreviewControls);
        taskPreviewSection.appendChild(taskPreviewStatus);
        taskPreviewSection.appendChild(taskPreviewTimeline);
        tasksTab.appendChild(taskPreviewSection);

        // "Add Task" button
        const addTaskBtn = mxUtils.button("Add Task", () => openTaskEditor(null, null, addTaskBtn));
        applySharedButtonStyle(addTaskBtn, 'add');
        addTaskBtn.style.marginTop = "12px";
        tasksTab.appendChild(addTaskBtn);

        // List container
        const tasksListDiv = document.createElement("div");
        const previewRuleSelections = new Map();
        let taskPreviewScheduleRange = null;
        let taskPreviewCutoffOmittedRuleKeys = new Set();
        let taskPreviewVersion = 0;

        function restoreFocus(el) { // FIX: restore keyboard focus after task-list DOM updates
            setTimeout(() => {
                if (el?.isConnected && typeof el.focus === "function") el.focus();
            }, 0);
        }

        const restoreBuiltinsBtn = mxUtils.button("Restore missing built-in tasks", async () => {
            try {
                syncStateFromControls();

                const methodTpl = await getDefaultTaskTemplateForPlantingMethods(formState.methodId);
                const defaultRules = Array.isArray(methodTpl?.rules) ? methodTpl.rules : [];

                taskRules = mergeMissingCanonicalRules(taskRules, defaultRules).map(normalizeTaskRule);
                taskDirty = true;
                await refreshTasksTabUI();
            } catch (e) {
                showErrorInline("Restore built-in tasks error: " + (e?.message || String(e)));
            }
        });

        // Render list
        function renderTasksList() {
            tasksListDiv.innerHTML = "";
            if (!taskRules.length) {
                const empty = document.createElement("div");
                empty.textContent = "No tasks defined.";
                tasksListDiv.appendChild(empty);
                return;
            }

            buildTaskRuleDisplayOrder(taskRules, generatedPreviewTasks).forEach(({ rule, originalIndex }) => {
                const wrap = document.createElement("div");
                wrap.style.border = "1px solid #ddd";
                wrap.style.margin = "6px 0";
                wrap.style.padding = "6px";
                wrap.style.display = "flex";
                wrap.style.justifyContent = "space-between";

                const summary = document.createElement("div");
                summary.textContent = describeTaskRule(rule);

                if (isCanonicalTaskRule(rule)) {
                    summary.textContent += " • Built-in";
                }

                const btnWrap = document.createElement("div");
                btnWrap.style.display = "flex";
                btnWrap.style.gap = "6px";

                const editBtn = mxUtils.button("Edit", () => openTaskEditor(rule, originalIndex, wrap));
                const delBtn = mxUtils.button("Delete", () => {

                    const isBuiltIn = isCanonicalTaskRule(rule);
                    if (isBuiltIn) {
                        const ok = confirm("This is a built-in task for the current method. Delete it from this template?");
                        if (!ok) {
                            restoreFocus(delBtn);
                            return;
                        }
                    }

                    taskRules.splice(originalIndex, 1);
                    taskDirty = true;
                    void refreshTasksTabUI();
                    restoreFocus(addTaskBtn);
                });
                applySharedButtonStyle(editBtn, 'open');
                applySharedButtonStyle(delBtn, 'danger');

                btnWrap.appendChild(editBtn);
                btnWrap.appendChild(delBtn);

                wrap.appendChild(summary);
                wrap.appendChild(btnWrap);
                tasksListDiv.appendChild(wrap);
            });
        }

        tasksTab.appendChild(tasksListDiv);

        // 3. Task editor (inline)
        const taskEditorDiv = document.createElement("div");
        tasksTab.appendChild(taskEditorDiv);

        function placeTaskEditorAfter(anchorEl) {
            if (anchorEl?.parentNode) {
                anchorEl.parentNode.insertBefore(taskEditorDiv, anchorEl.nextSibling);
            }
        }

        function selectedPreviewRuleKeys() {
            return new Set(
                Array.from(previewRuleSelections.entries())
                    .filter(([, selected]) => selected)
                    .map(([key]) => key)
            );
        }

        function renderTaskPreviewRuleSelectors() {
            const activeKeys = new Set();
            taskPreviewRuleSelectors.innerHTML = '';
            buildTaskRuleDisplayOrder(taskRules, generatedPreviewTasks).forEach(({ rule, originalIndex, key }) => {
                activeKeys.add(key);
                if (!previewRuleSelections.has(key)) previewRuleSelections.set(key, true);
                const label = document.createElement('label');
                label.style.display = 'inline-flex';
                label.style.alignItems = 'center';
                label.style.gap = '4px';
                const checkbox = makeCheckbox(previewRuleSelections.get(key));
                checkbox.addEventListener('change', () => {
                    previewRuleSelections.set(key, checkbox.checked);
                    renderCachedTaskPreview();
                });
                const text = document.createElement('span');
                text.textContent = String(rule?.title || rule?.id || `Task ${originalIndex + 1}`);
                label.appendChild(checkbox);
                label.appendChild(text);
                taskPreviewRuleSelectors.appendChild(label);
            });
            Array.from(previewRuleSelections.keys()).forEach(key => {
                if (!activeKeys.has(key)) previewRuleSelections.delete(key);
            });
        }

        function renderCachedTaskPreview({ message = '', error = '' } = {}) {
            const selectedKeys = selectedPreviewRuleKeys();
            if (!selectedKeys.size && !error) message = 'Select at least one task rule to preview.';
            const visible = updateTaskTimelinePreview({
                container: taskPreviewTimeline,
                generatedTasks: generatedPreviewTasks,
                selectedRuleKeys: selectedKeys,
                scheduleRange: taskPreviewScheduleRange,
                message,
                error
            });
            taskPreviewStatus.textContent = visible.length
                ? `${visible.length} task occurrence${visible.length === 1 ? '' : 's'} shown.`
                : '';
            const cutoffOmittedCount = Array.from(selectedKeys).filter(key => taskPreviewCutoffOmittedRuleKeys.has(key)).length;
            if (cutoffOmittedCount > 0 && !error) {
                taskPreviewStatus.textContent += `${taskPreviewStatus.textContent ? ' ' : ''}${cutoffOmittedCount} selected repeated rule${cutoffOmittedCount === 1 ? '' : 's'} omitted because the cutoff is on or before the first occurrence.`;
            }
        }

        async function updateTaskPreview() {
            const requestVersion = ++taskPreviewVersion;
            syncStateFromControls();
            renderTaskPreviewRuleSelectors();
            if (!taskRules.length) {
                generatedPreviewTasks = [];
                taskPreviewScheduleRange = null;
                taskPreviewCutoffOmittedRuleKeys = new Set();
                renderCachedTaskPreview({ message: 'No task rules are defined.' });
                return;
            }
            try { requireSelectedScheduleDate(); } catch (e) {
                generatedPreviewTasks = [];
                taskPreviewScheduleRange = null;
                taskPreviewCutoffOmittedRuleKeys = new Set();
                clearScheduleWarningState();
                renderCachedTaskPreview({ error: e?.message || String(e) });
                return;
            }
            try {
                const { inputs } = await buildScheduleContextFromForm(formState, selPlant, { currentVarieties });
                requireNoBlockingScheduleQualityDiagnostics(inputs);
                const result = computeScheduleResult(inputs);
                syncScheduleWarningState(result.warnings || []);
                const tasks = await buildTasksForPlan({
                    plant: result.plant,
                    schedule: result.schedule,
                    timelines: result.timelines,
                    taskTemplate: { version: 2, rules: taskRules },
                    methodCategoryId: inputs.methodCategoryId,
                    methodId: inputs.methodId,
                    varietyName: inputs.varietyName,
                    includePreviewMetadata: true
                });
                if (requestVersion !== taskPreviewVersion) return;
                generatedPreviewTasks = tasks;
                taskPreviewScheduleRange = resolveTaskPreviewScheduleRange(result);
                taskPreviewCutoffOmittedRuleKeys = findRepeatCutoffOmittedRuleKeys({
                    taskTemplate: { version: 2, rules: taskRules },
                    schedule: result.schedule,
                    timelines: result.timelines
                });
                renderTaskPreviewRuleSelectors();
                const selectedKeys = selectedPreviewRuleKeys();
                const generatedKeys = new Set(tasks.map(task => task.previewRuleKey));
                const selectedCutoffOmitted = Array.from(selectedKeys).filter(key => taskPreviewCutoffOmittedRuleKeys.has(key));
                const missingAnchorCount = Array.from(selectedKeys).filter(key => !generatedKeys.has(key) && !taskPreviewCutoffOmittedRuleKeys.has(key)).length;
                renderCachedTaskPreview({
                    message: tasks.length
                        ? ''
                        : (selectedCutoffOmitted.length ? 'No tasks could be generated. Repeat cutoff excluded the selected rule before its first occurrence.' : 'No tasks could be generated. Required schedule anchors may be unavailable.')
                });
                if (missingAnchorCount > 0 && tasks.length) {
                    taskPreviewStatus.textContent += ` ${missingAnchorCount} selected rule${missingAnchorCount === 1 ? '' : 's'} omitted because schedule anchors are unavailable.`;
                }
            } catch (e) {
                if (requestVersion !== taskPreviewVersion) return;
                generatedPreviewTasks = [];
                taskPreviewScheduleRange = null;
                taskPreviewCutoffOmittedRuleKeys = new Set();
                clearScheduleWarningState();
                renderCachedTaskPreview({ error: `Task preview error: ${e?.message || String(e)}` });
            }
        }

        async function refreshTasksTabUI() {
            updateTasksHeader({
                methodCategorySel,
                methodSel,
                formState,
                currentMethodSpan,
                currentTemplateSourceSpan,
                taskDirty,
                taskTemplateSource
            });
            await updateTaskPreview();
            renderTasksList();
            updateTimeline();
        }

        async function refreshTaskTemplateFromSelection() {
            syncStateFromControls();
            updateTasksHeader({
                methodCategorySel,
                methodSel,
                formState,
                currentMethodSpan,
                currentTemplateSourceSpan,
                taskDirty,
                taskTemplateSource
            });

            // Do not overwrite if the cell already has a per-plan template
            const raw = String(cell?.getAttribute?.('task_template_json') || '').trim();
            const hasCellTpl = raw.length > 0;
            if (hasCellTpl || taskDirty) return;

            const resolved = await resolveTaskTemplate({
                cell,
                plantId: formState.plantId,
                varietyId: formState.varietyId,
                methodId: formState.methodId
            });

            taskTemplate = normalizeTaskTemplate(resolved?.template ?? null);
            taskTemplateSource = resolved?.source ?? "unknown";
            taskRules = Array.isArray(taskTemplate.rules) ? [...taskTemplate.rules] : [];

            taskEditorDiv.innerHTML = '';
            renderTasksList();
            updateTasksHeader({
                methodCategorySel,
                methodSel,
                formState,
                currentMethodSpan,
                currentTemplateSourceSpan,
                taskDirty,
                taskTemplateSource
            });
        }

        syncStateFromControls();
        updateTasksHeader({
            methodCategorySel,
            methodSel,
            formState,
            currentMethodSpan,
            currentTemplateSourceSpan,
            taskDirty,
            taskTemplateSource
        });

        function getTaskTypeEditorOptions() {
            const graph = ui && ui.editor && ui.editor.graph;
            const model = graph && typeof graph.getModel === "function" ? graph.getModel() : null;
            const moduleCell = model ? findGardenModuleAncestor(model, cell) : null;
            const equipment = graph && graph.__trellisEquipment;
            if (!equipment || typeof equipment.readTaskTypeRegistry !== "function" || !moduleCell) {
                return { available: false, options: [{ value: "general", label: "General Task" }] };
            }
            const rows = equipment.readTaskTypeRegistry(moduleCell) || [];
            const options = rows
                .map(function (tt) { return { value: normalizeTaskTypeId(tt && tt.id), label: String(tt && (tt.name || tt.id) || "").trim() }; })
                .filter(function (tt) { return tt.value && tt.label; })
                .sort(function (a, b) { return a.label.localeCompare(b.label); });
            if (!options.length) return { available: false, options: [{ value: "general", label: "General Task" }] };
            return { available: true, options: [{ value: "", label: "Choose task type" }].concat(options) };
        }

        async function openTaskEditor(rule, index, anchorEl = null) {
            taskEditorDiv.innerHTML = "";
            placeTaskEditorAfter(anchorEl);

            const editing = !!rule;

            // --------------------------------------------------
            // Editor header
            // --------------------------------------------------
            const editorHeader = document.createElement("div");
            editorHeader.style.marginTop = "14px";
            editorHeader.style.marginBottom = "8px";
            editorHeader.style.paddingTop = "8px";
            editorHeader.style.borderTop = "1px solid #ccc";
            editorHeader.style.fontWeight = "600";
            editorHeader.textContent = editing ? "Edit task" : "Add task";

            taskEditorDiv.appendChild(editorHeader);

            const editorBody = document.createElement("div");
            editorBody.style.display = "flex";
            editorBody.style.flexDirection = "column";
            editorBody.style.gap = "8px";

            editorBody.style.background = "#fafafa";
            editorBody.style.padding = "8px";
            editorBody.style.border = "1px solid #ddd";
            editorBody.style.borderRadius = "4px";

            taskEditorDiv.appendChild(editorBody);

            const r = normalizeTaskRule(
                rule ? JSON.parse(JSON.stringify(rule)) : {
                    id: "rule_" + Date.now(),
                    title: "",
                    startAnchorStage: "SOW",
                    startOffsetDays: 0,
                    startOffsetDirection: "after",
                    endMode: "fixed_days",
                    durationDays: 1,
                    endAnchorStage: null,
                    endAnchorOffsetDays: 0,
                    endAnchorOffsetDirection: "after",
                    repeatMode: "none",
                    repeatEveryDays: 1,
                    repeatUntilMode: "x_times",
                    repeatTimes: 1,
                    repeatUntilAnchorStage: "HARVEST_END",
                    repeatCutoffOffsetDays: 0,
                    repeatCutoffOffsetDirection: "after"
                }
            );

            const allowedStages = await getAllowedAnchorStagesForMethod(formState.methodId);
            let stageOptions = allowedStages.map(k => ({
                value: k,
                label: TASK_STAGE_LABELS[k] || k
            }));

            function appendLegacyOptionIfMissing(options, value) {
                const v = String(value || "").trim();
                if (!v) return options;
                if (options.some(o => o.value === v)) return options;
                return options.concat([{
                    value: v,
                    label: `${humanStageLabel(v)} (not available for current method)`
                }]);
            }

            const startStageOptions = appendLegacyOptionIfMissing(stageOptions, r.startAnchorStage);
            const endStageOptions = appendLegacyOptionIfMissing(stageOptions, r.endAnchorStage);
            const repeatUntilStageOptions = appendLegacyOptionIfMissing(stageOptions, r.repeatUntilAnchorStage);

            const titleInput = document.createElement("input");
            titleInput.type = "text";
            titleInput.value = r.title;
            const titleRow = row("Title", titleInput).row;
            const customTaskRule = !isCanonicalTaskId(r.id);
            const taskTypeState = customTaskRule ? getTaskTypeEditorOptions() : null;
            const taskTypeSel = customTaskRule ? makeSelect(taskTypeState.options, r.taskTypeId || (taskTypeState.available ? "" : "general")) : null;
            if (taskTypeSel && !taskTypeState.available) taskTypeSel.disabled = true;
            const taskTypeRow = customTaskRule ? row("Task Type", taskTypeSel).row : null;

            const startOffsetNum = makeNumber(r.startOffsetDays);
            const startOffsetDir = makeSelect([
                { value: "before", label: "before" },
                { value: "after", label: "after" }
            ], r.startOffsetDirection);
            const startAnchorSel = makeSelect(startStageOptions, r.startAnchorStage);

            const startWrap = document.createElement("div");
            startWrap.style.display = "flex";
            startWrap.style.gap = "8px";
            startWrap.appendChild(startOffsetNum);
            startWrap.appendChild(startOffsetDir);
            startWrap.appendChild(startAnchorSel);
            const startRow = row("Start", startWrap).row;

            const endModeSel = makeSelect([
                { value: "fixed_days", label: "Fixed duration" },
                { value: "anchor_range", label: "Until anchor" }
            ], r.endMode);

            const endModeRow = row("Duration mode", endModeSel).row;

            const durationNum = makeNumber(r.durationDays ?? 1);
            const durationRow = row("Duration days", durationNum).row;

            const endAnchorOffsetNum = makeNumber(r.endAnchorOffsetDays ?? 0);
            const endAnchorOffsetDir = makeSelect([
                { value: "before", label: "before" },
                { value: "after", label: "after" }
            ], r.endAnchorOffsetDirection || "after");
            const endAnchorSel = makeSelect(
                endStageOptions,
                r.endAnchorStage || "HARVEST_END"
            );

            const endAnchorWrap = document.createElement("div");
            endAnchorWrap.style.display = "flex";
            endAnchorWrap.style.gap = "8px";
            endAnchorWrap.appendChild(endAnchorOffsetNum);
            endAnchorWrap.appendChild(endAnchorOffsetDir);
            endAnchorWrap.appendChild(endAnchorSel);
            const endAnchorRow = row("End anchor", endAnchorWrap).row;

            const repeatCheck = makeCheckbox(r.repeatMode === "interval");
            const repeatModeRow = row("Repeat", repeatCheck).row;

            const repeatConfigDiv = document.createElement("div");
            repeatConfigDiv.style.marginLeft = "20px";

            const repeatEveryNum = makeNumber(r.repeatEveryDays);
            const repeatEveryRow = row("Every (days)", repeatEveryNum).row;

            const repeatUntilModeSel = makeSelect([
                { value: "x_times", label: "Repeat X total times" },
                { value: "until_anchor", label: "Repeat until anchor" }
            ], r.repeatUntilMode);
            const repeatUntilModeRow = row("Stop mode", repeatUntilModeSel).row;

            const repeatTimesNum = makeNumber(r.repeatTimes ?? 1);
            const repeatTimesRow = row("Times", repeatTimesNum).row;

            const repeatCutoffOffsetNum = makeNumber(r.repeatCutoffOffsetDays ?? 0);
            const repeatCutoffOffsetDir = makeSelect([
                { value: "before", label: "before" },
                { value: "after", label: "after" }
            ], r.repeatCutoffOffsetDirection || "after");
            const repeatUntilAnchorSel = makeSelect(
                repeatUntilStageOptions,
                r.repeatUntilAnchorStage || "HARVEST_END"
            );

            const repeatCutoffAnchorWrap = document.createElement("div");
            repeatCutoffAnchorWrap.style.display = "flex";
            repeatCutoffAnchorWrap.style.gap = "8px";
            repeatCutoffAnchorWrap.appendChild(repeatCutoffOffsetNum);
            repeatCutoffAnchorWrap.appendChild(repeatCutoffOffsetDir);
            repeatCutoffAnchorWrap.appendChild(repeatUntilAnchorSel);
            const repeatUntilAnchorRow = row("Cutoff anchor", repeatCutoffAnchorWrap).row;

            repeatConfigDiv.appendChild(repeatEveryRow);
            repeatConfigDiv.appendChild(repeatUntilModeRow);
            repeatConfigDiv.appendChild(repeatTimesRow);
            repeatConfigDiv.appendChild(repeatUntilAnchorRow);

            function setTaskEditorRowVisible(rowEl, visible) {
                rowEl.style.setProperty("display", visible ? "flex" : "none", "important");
            }

            function syncTaskEditorVisibility() {
                const endMode = endModeSel.value;
                const anchorRange = endMode === "anchor_range";
            
                setTaskEditorRowVisible(durationRow, endMode === "fixed_days");
                setTaskEditorRowVisible(endAnchorRow, anchorRange);
            
                if (anchorRange && repeatCheck.checked) {
                    repeatCheck.checked = false;
                }
                repeatCheck.disabled = anchorRange;
            
                const repeating = !anchorRange && repeatCheck.checked;
                repeatConfigDiv.style.display = repeating ? "" : "none";
            
                const untilMode = repeatUntilModeSel.value;
                setTaskEditorRowVisible(repeatTimesRow, repeating && untilMode === "x_times");
                setTaskEditorRowVisible(repeatUntilAnchorRow, repeating);
            }

            endModeSel.addEventListener("change", syncTaskEditorVisibility);
            repeatCheck.addEventListener("change", syncTaskEditorVisibility);
            repeatUntilModeSel.addEventListener("change", syncTaskEditorVisibility);

            editorBody.appendChild(titleRow);
            if (taskTypeRow) editorBody.appendChild(taskTypeRow);
            editorBody.appendChild(startRow);
            editorBody.appendChild(endModeRow);
            editorBody.appendChild(durationRow);
            editorBody.appendChild(endAnchorRow);
            editorBody.appendChild(repeatModeRow);
            editorBody.appendChild(repeatConfigDiv);

            syncTaskEditorVisibility();

            const btnWrap = document.createElement("div");
            btnWrap.style.marginTop = "8px";
            btnWrap.style.display = "flex";
            btnWrap.style.gap = "8px";

            const saveBtn = mxUtils.button("Save", async () => {
                try {
                    r.title = titleInput.value.trim();
                    if (customTaskRule) r.taskTypeId = taskTypeSel.value || (taskTypeState.available ? "" : "general");

                    r.startOffsetDays = Number(startOffsetNum.value);
                    r.startOffsetDirection = startOffsetDir.value;
                    r.startAnchorStage = startAnchorSel.value;

                    r.endMode = endModeSel.value;
                    r.durationDays = (r.endMode === "fixed_days") ? Number(durationNum.value) : null;
                    r.endAnchorStage = (r.endMode === "anchor_range") ? endAnchorSel.value : null;
                    r.endAnchorOffsetDays = (r.endMode === "anchor_range") ? Number(endAnchorOffsetNum.value) : 0;
                    r.endAnchorOffsetDirection = (r.endMode === "anchor_range") ? endAnchorOffsetDir.value : "after";

                    r.repeatMode = (repeatCheck.checked && r.endMode === "fixed_days") ? "interval" : "none";
                    r.repeatEveryDays = Number(repeatEveryNum.value);
                    r.repeatUntilMode = repeatUntilModeSel.value;
                    r.repeatTimes = (r.repeatMode === "interval" && r.repeatUntilMode === "x_times")
                        ? Number(repeatTimesNum.value)
                        : 1;
                    r.repeatUntilAnchorStage = (r.repeatMode === "interval")
                        ? repeatUntilAnchorSel.value
                        : "HARVEST_END";
                    r.repeatCutoffOffsetDays = (r.repeatMode === "interval") ? Number(repeatCutoffOffsetNum.value) : 0;
                    r.repeatCutoffOffsetDirection = (r.repeatMode === "interval") ? repeatCutoffOffsetDir.value : "after";

                    const allowedStages = await getAllowedAnchorStagesForMethod(formState.methodId);
                    const normalized = validateTaskRule(r, { allowedStages, requireTaskType: customTaskRule });
                    try {
                        const { inputs } = await buildScheduleContextFromForm(formState, selPlant, { currentVarieties });
                        const result = computeScheduleResult(inputs);
                        validateTaskRuleAnchorOrder(normalized, { schedule: result.schedule, timelines: result.timelines });
                    } catch (orderErr) {
                        if (/^Start must/.test(String(orderErr?.message || ""))) throw orderErr;
                    }

                    if (!editing && isCanonicalTaskId(r.id)) {
                        throw new Error("Canonical task IDs are reserved.");
                    }

                    if (editing) taskRules[index] = normalized;
                    else taskRules.push(normalized);
                    taskDirty = true;

                    taskEditorDiv.innerHTML = "";
                    await refreshTasksTabUI();
                } catch (e) {
                    showErrorInline("Save task error: " + (e?.message || String(e)));
                }
            });

            const cancelBtn = mxUtils.button("Cancel", () => {
                taskEditorDiv.innerHTML = "";
            });
            applySharedButtonStyle(saveBtn, 'add');
            applySharedButtonStyle(cancelBtn, 'neutral');

            btnWrap.appendChild(saveBtn);
            btnWrap.appendChild(cancelBtn);
            taskEditorDiv.appendChild(btnWrap);
        }


        // Reset to defaults button
        const resetTasksBtn = mxUtils.button("Reset tasks to plant-default", async () => {
            try {
                syncStateFromControls();

                const methodId = normId(formState.methodId);
                const methodTemplate = methodId
                    ? await getDefaultTaskTemplateForPlantingMethods(methodId)
                    : null;

                taskTemplate = normalizeTaskTemplate(methodTemplate);
                taskTemplateSource = methodTemplate ? "method_builtin" : "none";
                taskRules = Array.isArray(taskTemplate.rules) ? [...taskTemplate.rules] : [];
                taskTemplateResetRequested = true;
                plantDefaultTaskDeleteRequested = true;
                taskDirty = false;
                taskEditorDiv.innerHTML = "";
                await refreshTasksTabUI();
            } catch (e) {
                showErrorInline("Reset tasks error: " + (e?.message || String(e)));
            }
        });

        applySharedButtonStyle(resetTasksBtn, 'danger');

        const taskDefaultsActions = document.createElement('div');
        taskDefaultsActions.style.marginTop = '10px';
        taskDefaultsActions.style.paddingTop = '10px';
        taskDefaultsActions.style.borderTop = '1px solid #d1d5db';
        taskDefaultsActions.style.display = 'flex';
        taskDefaultsActions.style.flexWrap = 'wrap';
        taskDefaultsActions.style.alignItems = 'center';
        taskDefaultsActions.style.gap = '8px';
        taskDefaultsActions.appendChild(resetTasksBtn);
        taskDefaultsActions.appendChild(restoreBuiltinsBtn);
        taskDefaultsActions.appendChild(row("Save these tasks as plant default", saveDefaultChk).row);
        tasksTab.insertBefore(taskDefaultsActions, taskEditorDiv);

        applySharedButtonStyle(restoreBuiltinsBtn, 'neutral');
        writeLayoutControlsFromSelection(); // CHANGE: keep derived creation defaults available after moving layout editing to the diagram overlay.


        // ============================================================================
        // TABS WRAPPER
        // ============================================================================

        const tabsContainer = document.createElement("div");
        tabsContainer.className = "usl-scheduler-dialog";
        tabsContainer.style.display = "flex";
        tabsContainer.style.flexDirection = "column";
        tabsContainer.style.height = "100%";
        tabsContainer.style.maxWidth = "96vw";
        tabsContainer.style.maxHeight = "85vh";
        tabsContainer.style.overflow = "hidden";
        tabsContainer.style.boxSizing = "border-box";

        const schedulerDialogStyle = document.createElement("style");
        schedulerDialogStyle.textContent = `
            .usl-scheduler-dialog{--usl-primary:#2563eb;--usl-primary-bg:#eff6ff;--usl-primary-soft:#93c5fd;--usl-primary-dark:#1d4ed8;--usl-success:#166534;--usl-success-bg:#f0fdf4;--usl-danger:#b91c1c;--usl-danger-bg:#fef2f2;--usl-warning:#92400e;--usl-warning-bg:#fffbeb;--usl-neutral-900:#172018;--usl-neutral-700:#4b5563;--usl-neutral-500:#777;--usl-neutral-300:#d1d5db;--usl-neutral-100:#f8f8f8;background:#fff;color:var(--usl-neutral-900);font:12px Arial,sans-serif;width:100%;min-width:0}
            .usl-scheduler-header{padding:10px 12px 8px;border-bottom:1px solid var(--usl-neutral-300);display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;background:#fff}
            .usl-scheduler-title{font-weight:700;font-size:15px;white-space:nowrap;color:var(--usl-neutral-900)}
            .usl-scheduler-subtitle{color:var(--usl-neutral-700);font-weight:700;overflow-wrap:anywhere}
            .usl-scheduler-tabs{padding:7px 12px;border-bottom:1px solid var(--usl-neutral-300);display:flex!important;gap:8px!important;align-items:center;flex-wrap:wrap;background:var(--usl-neutral-100);margin-bottom:0!important}
            .usl-scheduler-tab{border:1px solid var(--usl-neutral-500)!important;background:#fff!important;color:var(--usl-neutral-900)!important;border-radius:6px!important;cursor:pointer!important;padding:6px 10px!important;font:12px Arial,sans-serif!important;min-width:100px!important}
            .usl-scheduler-tab[data-active="true"]{background:var(--usl-neutral-100)!important;color:var(--usl-neutral-900)!important;box-shadow:inset 0 -2px 0 var(--usl-neutral-900)!important}
            .usl-scheduler-body{flex:1 1 0!important;min-height:0;overflow-y:auto!important;overflow-x:hidden;padding:12px;overscroll-behavior:contain;background:#fff}
            .usl-scheduler-footer{padding:9px 12px;border-top:1px solid #ccc;background:#fff;display:flex;justify-content:flex-end;align-items:center;gap:10px;flex-wrap:wrap}
            .usl-scheduler-footer-actions{margin-top:0!important;display:flex!important;justify-content:flex-end!important;gap:8px;flex-wrap:wrap}
            .usl-scheduler-action-row{display:flex!important;gap:8px!important;flex-wrap:wrap;justify-content:flex-end}
            .usl-scheduler-dialog button{border:1px solid var(--usl-neutral-500);background:#fff;color:var(--usl-neutral-900);border-radius:6px;cursor:pointer;padding:6px 10px;font:12px Arial,sans-serif}
            .usl-scheduler-dialog button[data-trellis-button-variant="open"]{border-color:var(--usl-primary);color:var(--usl-primary-dark)}
            .usl-scheduler-dialog button[data-trellis-button-variant="add"]{border-color:var(--usl-success);color:var(--usl-success)}
            .usl-scheduler-dialog button[data-trellis-button-variant="danger"]{border-color:var(--usl-danger);color:var(--usl-danger)}
            .usl-scheduler-dialog button:hover{background:var(--usl-neutral-100)}
            .usl-scheduler-dialog button[data-trellis-button-variant="open"]:hover{background:var(--usl-primary-bg)}
            .usl-scheduler-dialog button[data-trellis-button-variant="add"]:hover{background:var(--usl-success-bg)}
            .usl-scheduler-dialog button[data-trellis-button-variant="danger"]:hover{background:var(--usl-danger-bg)}
            .usl-scheduler-dialog input,.usl-scheduler-dialog select,.usl-scheduler-dialog textarea{padding:5px 6px;border:1px solid #bbb;border-radius:6px;box-sizing:border-box;font:12px Arial,sans-serif;max-width:100%}
            .usl-scheduler-dialog input[type="checkbox"]{width:auto;padding:0;border:0}
            .usl-scheduler-row > input[type="checkbox"]{flex:0 0 auto}
            .usl-scheduler-dialog input:disabled,.usl-scheduler-dialog select:disabled{background:#f3f4f6;color:#6b7280}
            .usl-scheduler-row{display:flex!important;gap:8px!important;align-items:center!important;flex-wrap:wrap;margin:6px 0!important}
            .usl-scheduler-row-label{flex:0 0 180px;min-width:0!important;font-weight:700;color:var(--usl-neutral-700)}
            .usl-scheduler-row > :not(label){flex:1 1 220px;min-width:0}
            .usl-scheduler-row--crop-picker{display:grid!important;grid-template-columns:50px minmax(120px,140px) minmax(0,1fr) auto auto!important;align-items:center!important;gap:8px!important}
            .usl-scheduler-row--crop-picker > .usl-scheduler-row-label{grid-column:1;flex:none!important}
            .usl-scheduler-row--crop-picker > .usl-scheduler-crop-picker-controls{display:contents!important;flex:none!important;min-width:0!important}
            .usl-scheduler-crop-filter{grid-column:2;width:100%!important;min-width:120px!important}
            .usl-scheduler-crop-combobox-wrap{grid-column:3;min-width:0!important;width:100%!important}
            .usl-scheduler-crop-action{width:auto!important;min-width:36px!important;flex:0 0 auto!important;white-space:nowrap!important;justify-self:end!important}
            .usl-scheduler-row--crop-variety > .usl-scheduler-row-label{flex:0 0 50px!important}
            .usl-scheduler-row--crop-variety > :not(label){min-width:0!important}
            .usl-scheduler-row--crop-variety select{min-width:0!important}
            .usl-crop-combobox-button{min-height:32px;min-width:0!important;overflow:hidden;white-space:normal;overflow-wrap:anywhere}
            .usl-crop-combobox-panel{box-sizing:border-box}
            .usl-scheduler-section{border:1px solid var(--usl-neutral-300);border-radius:8px;background:#fff;overflow:hidden;margin-top:12px!important}
            .usl-scheduler-section--allow-popover{overflow:visible}
            .usl-scheduler-section-heading{padding:9px 10px!important;border-bottom:1px solid var(--usl-neutral-300)!important;margin-bottom:0!important;background:var(--usl-neutral-100);font-weight:700!important;font-size:13px!important}
            .usl-scheduler-section-body{padding:10px}
            .usl-scheduler-summary{border:1px solid var(--usl-neutral-300)!important;border-radius:8px!important;background:linear-gradient(180deg,#fff,var(--usl-neutral-100))!important;margin-bottom:10px!important}
            .usl-scheduler-summary-title{font-size:16px;font-weight:700!important;color:var(--usl-neutral-900)}
            .usl-scheduler-summary-grid{display:grid!important;grid-template-columns:repeat(4,minmax(120px,1fr))!important;gap:6px!important}
            .usl-scheduler-summary-item{border:1px solid var(--usl-neutral-300);border-radius:6px;background:#fff;padding:6px 7px;min-width:0}
            .usl-scheduler-summary-item--wide{grid-column:span 2!important}
            .usl-scheduler-summary-label{color:var(--usl-neutral-700)!important;font-size:10px!important;font-weight:700;text-transform:uppercase}
            .usl-scheduler-summary-value{margin-top:3px;font-size:13px!important;font-weight:700!important;color:var(--usl-neutral-900);white-space:normal;overflow-wrap:anywhere}
            .usl-scheduler-summary-warning-list{margin:3px 0 0 16px!important;padding:0!important}
            .usl-scheduler-summary-warning-list li{margin:0 0 2px 0!important;padding:0!important}
            .usl-scheduler-dialog details{border:1px solid var(--usl-neutral-300)!important;border-radius:8px;background:#fff;margin-top:12px!important;overflow:hidden}
            .usl-scheduler-dialog summary{padding:9px 10px!important;background:var(--usl-neutral-100);border-bottom:1px solid var(--usl-neutral-300);font-weight:700!important}
            .usl-layout-preview{min-height:260px;border:1px solid var(--usl-neutral-300);border-radius:8px;background:#f9fafb;display:flex;align-items:center;justify-content:center;overflow:hidden}
            .usl-layout-preview-svg{width:100%;height:260px;display:block;background:#f9fafb}
            .usl-layout-preview-bed{fill:#eef2ff;stroke:#4f46e5;stroke-width:2}
            .usl-layout-preview-source{fill:rgba(37,99,235,.12);stroke:#2563eb;stroke-width:1.5;stroke-dasharray:4 3}
            .usl-layout-preview-companion{fill:rgba(22,101,52,.12);stroke:#166534;stroke-width:1.5;stroke-dasharray:4 3}
            .usl-layout-preview-source-dot{fill:#2563eb}
            .usl-layout-preview-companion-dot{fill:#16a34a}
            .usl-layout-preview-label{font:11px Arial,sans-serif;fill:#172018;font-weight:700}
            .usl-layout-preview-warning{font:11px Arial,sans-serif;fill:#92400e;font-weight:700}
            .usl-layout-preview-empty{padding:18px;color:#92400e;font-weight:700;text-align:center}
            .usl-layout-status{margin-top:8px;color:#92400e;font-weight:700;min-height:16px}
            .usl-companion-layout-note{font-size:12px;color:var(--usl-neutral-700);margin-bottom:8px}
            .usl-companion-layout-editor{display:grid;gap:4px;overflow-x:auto}
            .usl-companion-layout-row{display:grid;grid-template-columns:minmax(120px,1.4fr) minmax(100px,.9fr) 78px 78px 78px 78px 78px minmax(100px,1fr) 72px;gap:6px;align-items:center;min-width:860px}
            .usl-companion-layout-row--header{font-size:10px;text-transform:uppercase;color:var(--usl-neutral-700);font-weight:700;border-bottom:1px solid var(--usl-neutral-300);padding-bottom:4px}
            .usl-companion-layout-row--anchor{background:rgba(37,99,235,.06)}
            .usl-companion-layout-name{font-weight:700;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
            .usl-companion-layout-anchor-tag{font-size:12px;color:var(--usl-neutral-700)}
            .usl-companion-layout-input{width:72px!important;box-sizing:border-box}
            .usl-companion-layout-warning{font-size:11px;color:#92400e;font-weight:700;min-height:14px}
            .usl-companion-layout-changed{font-size:11px;color:#2563eb;font-weight:700;min-height:14px}
            .usl-companion-layout-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px}
            .usl-layout-preview-companion-interplant{fill:rgba(217,119,6,.13);stroke:#b45309}
            .usl-layout-preview-companion-staggered{fill:rgba(22,163,74,.12);stroke:#15803d}
            .usl-layout-preview-companion-beside{fill:rgba(14,165,233,.12);stroke:#0369a1}
            .usl-layout-preview-companion-dot-interplant{fill:#d97706}
            .usl-layout-preview-companion-dot-staggered{fill:#16a34a}
            .usl-layout-preview-companion-dot-beside{fill:#0284c7}
            @media (max-width:900px){.usl-scheduler-row--crop-picker{grid-template-columns:50px minmax(120px,1fr) auto auto!important}.usl-scheduler-crop-combobox-wrap{grid-column:2 / -1;min-width:0!important}.usl-scheduler-crop-action{grid-row:3}.usl-scheduler-crop-action:first-of-type{grid-column:3}.usl-scheduler-crop-action:last-of-type{grid-column:4}}
            @media (max-width:760px){.usl-scheduler-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}.usl-scheduler-row-label{flex-basis:100%}.usl-scheduler-body{padding:10px}.usl-scheduler-title{white-space:normal}}
            @media (max-width:640px){.usl-scheduler-row--crop-picker{grid-template-columns:1fr auto auto!important}.usl-scheduler-row--crop-picker > .usl-scheduler-row-label{grid-column:1 / -1}.usl-scheduler-row--crop-variety > .usl-scheduler-row-label{flex-basis:100%!important}.usl-scheduler-crop-filter{grid-column:1 / -1}.usl-scheduler-crop-combobox-wrap{grid-column:1 / -1;min-width:0!important}}
        `;
        tabsContainer.appendChild(schedulerDialogStyle);

        const dialogHeader = document.createElement("div");
        dialogHeader.className = "usl-scheduler-header";
        const dialogTitle = document.createElement("div");
        dialogTitle.className = "usl-scheduler-title";
        dialogTitle.textContent = "Planting Scheduler";
        const dialogSubtitle = document.createElement("div");
        dialogSubtitle.className = "usl-scheduler-subtitle";
        dialogSubtitle.textContent = (effectivePlant?.plant_name || selPlant?.plant_name || "Schedule") + (hasPersistedSchedule ? " schedule" : " new schedule");
        dialogHeader.appendChild(dialogTitle);
        dialogHeader.appendChild(dialogSubtitle);

        const tabsHeader = document.createElement("div");
        tabsHeader.className = "usl-scheduler-tabs";
        tabsHeader.style.display = "flex";
        tabsHeader.style.gap = "8px";
        tabsHeader.style.marginBottom = "8px";

        const tabsBody = document.createElement("div");
        tabsBody.className = "usl-scheduler-body";
        tabsBody.style.flex = "1";
        tabsBody.style.overflow = "auto";

        function setActiveTabButton(activeButton) {
            Array.from(tabsHeader.children).forEach(button => {
                if (button && button.dataset) button.dataset.active = button === activeButton ? "true" : "false";
            });
        }

        function makeTabButton(label, targetEl) {
            const b = mxUtils.button(label, () => {
                tabsBody.innerHTML = "";
                tabsBody.appendChild(targetEl);
                setActiveTabButton(b);
            });
            b.className = "usl-scheduler-tab";
            applySharedButtonStyle(b, 'neutral');
            b.style.minWidth = "100px";
            return b;
        }

        const scheduleTabBtn = makeTabButton("Schedule", div);

        const tasksTabBtn = mxUtils.button("Tasks", async () => {
            await refreshTaskTemplateFromSelection();
            await refreshTasksTabUI();
            tabsBody.innerHTML = "";
            tabsBody.appendChild(tasksTab);
            setActiveTabButton(tasksTabBtn);
        });
        tasksTabBtn.className = "usl-scheduler-tab";
        applySharedButtonStyle(tasksTabBtn, 'neutral');
        tasksTabBtn.style.minWidth = "100px";
        tabsHeader.appendChild(scheduleTabBtn);
        tabsHeader.appendChild(tasksTabBtn);
        tabsBody.appendChild(div);

        const dialogFooter = document.createElement("div");
        dialogFooter.className = "usl-scheduler-footer";
        dialogFooter.appendChild(btns);

        tabsContainer.appendChild(dialogHeader);
        tabsContainer.appendChild(tabsHeader);
        tabsContainer.appendChild(tabsBody);
        tabsContainer.appendChild(dialogFooter);

        // INITIAL RENDER
        renderTasksList();
        setActiveTabButton(scheduleTabBtn);
        scheduleCropPickerSuitabilityRefresh(0);

        ui.showDialog(tabsContainer, 1120, 720, true, true);
        elevateTrellisDialog(ui);

    }







































    // ============================================================================
    // Task Template Model (method-driven + Cell Persistence)
    // ============================================================================

    // canonical stage names
    const TASK_STAGE_LABELS = {
        SOW: "Sow",
        GERM: "Germination",
        TRANSPLANT: "Transplant",
        HARVEST_START: "Harvest start",
        HARVEST_END: "Harvest end"
    };

    const METHOD_TASK_STAGE_POLICY = Object.freeze({
        "transplant.indoor": {
            allowedStages: ["SOW", "TRANSPLANT", "HARVEST_START", "HARVEST_END"]
        },
        "transplant.outdoor": {
            allowedStages: ["SOW", "TRANSPLANT", "HARVEST_START", "HARVEST_END"]
        },
        "transplant.purchased": {
            allowedStages: ["TRANSPLANT", "HARVEST_START", "HARVEST_END"]
        },
        "transplant.cutting": {
            allowedStages: ["SOW", "TRANSPLANT", "HARVEST_START", "HARVEST_END"]
        },
        "direct_sow.field": {
            allowedStages: ["SOW", "GERM", "HARVEST_START", "HARVEST_END"]
        },
        "direct_sow.pre_germinated": {
            allowedStages: ["SOW", "GERM", "HARVEST_START", "HARVEST_END"]
        },
        "direct_sow.plug": {
            allowedStages: ["TRANSPLANT", "HARVEST_START", "HARVEST_END"]
        }
    });

    const CANONICAL_TASK_IDS = ["prep", "sow", "start", "harden", "transplant", "thin", "harvest"];
    const CANONICAL_TASK_TYPE_BY_RULE_ID = Object.freeze({
        prep: "bed_preparation",
        sow: "direct_sowing",
        start: "seedling_starting",
        harden: "hardening_off",
        transplant: "transplanting",
        thin: "thinning_check",
        harvest: "harvesting"
    });

    function isCanonicalTaskId(id) {
        return CANONICAL_TASK_IDS.includes(String(id || "").trim());
    }

    function isCanonicalTaskRule(rule) {
        return isCanonicalTaskId(rule?.id);
    }

    function normalizeTaskTypeId(value) {
        return normId(value).replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
    }

    function resolveTaskRuleTaskTypeId(rule) {
        const normalized = normalizeTaskRule(rule);
        const id = String(normalized.id || "").trim();
        if (isCanonicalTaskId(id)) return CANONICAL_TASK_TYPE_BY_RULE_ID[id] || "general";
        return normalizeTaskTypeId(normalized.taskTypeId) || "general";
    }

    function mergeMissingCanonicalRules(currentRules, defaultRules) {
        const current = Array.isArray(currentRules) ? currentRules : [];
        const defaults = Array.isArray(defaultRules) ? defaultRules : [];

        const existingIds = new Set(
            current
                .map(r => String(r?.id || "").trim())
                .filter(Boolean)
        );

        const merged = [...current];

        for (const rule of defaults) {
            const id = String(rule?.id || "").trim();
            if (!id) continue;
            if (!isCanonicalTaskId(id)) continue;
            if (existingIds.has(id)) continue;

            merged.push(normalizeTaskRule(rule));
        }

        const canonicalIndex = new Map(
            CANONICAL_TASK_IDS.map((id, idx) => [id, idx])
        );

        return merged
            .map((rule, originalIndex) => ({ rule, originalIndex }))
            .sort((a, b) => {
                const aId = String(a.rule?.id || "").trim();
                const bId = String(b.rule?.id || "").trim();

                const aCanonical = canonicalIndex.has(aId);
                const bCanonical = canonicalIndex.has(bId);

                if (aCanonical && bCanonical) {
                    return canonicalIndex.get(aId) - canonicalIndex.get(bId);
                }

                if (aCanonical) return -1;
                if (bCanonical) return 1;

                return a.originalIndex - b.originalIndex;
            })
            .map(x => x.rule);
    }

    function getAllowedAnchorStagesForPlanningMode(planningMode) {
        switch (String(planningMode || "").trim()) {
            case "direct_sow":
                return ["SOW", "GERM", "HARVEST_START", "HARVEST_END"];
            case "transplant_indoor":
            case "transplant_outdoor":
                return ["SOW", "TRANSPLANT", "HARVEST_START", "HARVEST_END"];
            default:
                return ["SOW", "GERM", "TRANSPLANT", "HARVEST_START", "HARVEST_END"];
        }
    }
    
    async function getAllowedAnchorStagesForMethod(methodId) {
        const id = normId(methodId);
    
        if (!id) {
            return ["SOW", "GERM", "TRANSPLANT", "HARVEST_START", "HARVEST_END"];
        }
    
        const policy = METHOD_TASK_STAGE_POLICY[id];
        if (policy && Array.isArray(policy.allowedStages) && policy.allowedStages.length) {
            return [...policy.allowedStages];
        }
    
        const method = await getPlantingMethodById(id);
        if (!method) {
            return ["SOW", "GERM", "TRANSPLANT", "HARVEST_START", "HARVEST_END"];
        }
    
        const resolved = resolveMethodBehavior({
            methodCategoryId: method.method_category_id,
            methodId: method.method_id
        });
    
        return getAllowedAnchorStagesForPlanningMode(resolved.planningMode);
    }

    function humanStageLabel(stage) {
        return TASK_STAGE_LABELS[stage] || stage;
    }

    // -------------------- DB access (method) -----------------------------------

    function safeJsonParse(s, fallback) {
        try { return JSON.parse(s); } catch (_) { return fallback; }
    }

    function normalizeTaskRule(rule) {
        const r = { ...(rule || {}) };

        // ---------- v1 -> v2 start field migration ----------
        if (r.startAnchorStage == null && r.anchorStage != null) {
            r.startAnchorStage = r.anchorStage;
        }
        if (r.startOffsetDays == null && r.offsetDays != null) {
            r.startOffsetDays = r.offsetDays;
        }
        if (r.startOffsetDirection == null && r.offsetDirection != null) {
            r.startOffsetDirection = r.offsetDirection;
        }

        // ---------- defaults for start ----------
        r.startAnchorStage = String(r.startAnchorStage || "SOW");
        r.startOffsetDays = Number(r.startOffsetDays ?? 0);
        r.startOffsetDirection = (r.startOffsetDirection === "before") ? "before" : "after";

        // ---------- end mode ----------
        if (!r.endMode) {
            if (r.id === "harvest") {
                r.endMode = "anchor_range";
            } else {
                r.endMode = "fixed_days";
            }
        }

        if (r.endMode === "anchor_range") {
            r.durationDays = null;
            r.endAnchorStage = String(r.endAnchorStage || "HARVEST_END");
            r.endAnchorOffsetDays = Number(r.endAnchorOffsetDays ?? 0);
            r.endAnchorOffsetDirection = (r.endAnchorOffsetDirection === "before") ? "before" : "after";
        } else {
            r.endMode = "fixed_days";
            r.durationDays = Number(r.durationDays ?? 1);
            r.endAnchorStage = r.endAnchorStage ?? null;
            r.endAnchorOffsetDays = Number(r.endAnchorOffsetDays ?? 0);
            r.endAnchorOffsetDirection = (r.endAnchorOffsetDirection === "before") ? "before" : "after";
        }

        // ---------- repeat migration ----------
        if (!r.repeatMode) {
            r.repeatMode = (r.repeat === true) ? "interval" : "none";
        }
        r.repeatMode = (r.repeatMode === "interval") ? "interval" : "none";
        r.repeatEveryDays = Number(r.repeatEveryDays ?? 1);
        r.repeatUntilMode = (r.repeatUntilMode === "until_anchor") ? "until_anchor" : "x_times";
        r.repeatTimes = Number(r.repeatTimes ?? r.repeatUntilValue ?? 1);
        r.repeatUntilAnchorStage = String(r.repeatUntilAnchorStage || "HARVEST_END");
        r.repeatCutoffOffsetDays = Number(r.repeatCutoffOffsetDays ?? 0);
        r.repeatCutoffOffsetDirection = (r.repeatCutoffOffsetDirection === "before") ? "before" : "after";
        if (isCanonicalTaskId(r.id)) {
            delete r.taskTypeId;
            delete r.task_type_id;
        } else {
            r.taskTypeId = normalizeTaskTypeId(r.taskTypeId || r.task_type_id);
            delete r.task_type_id;
        }

        return r;
    }

    function normalizeTaskTemplate(template) {
        const src = (template && typeof template === "object") ? template : {};
        const rules = Array.isArray(src.rules) ? src.rules.map(normalizeTaskRule) : [];
        return { version: 2, rules };
    }

    function validateTaskRule(rule, { allowedStages = null, requireTaskType = false } = {}) {
        const r = normalizeTaskRule(rule);
        const rawRepeatUntilMode = rule && Object.prototype.hasOwnProperty.call(rule, "repeatUntilMode") ? String(rule.repeatUntilMode || "") : "";

        if (!String(r.title || "").trim()) throw new Error("Task title is required.");
        if (requireTaskType && !isCanonicalTaskId(r.id) && !String(r.taskTypeId || "").trim()) throw new Error("Task type is required.");
        if (!String(r.startAnchorStage || "").trim()) throw new Error("Start anchor is required.");
        if (!Number.isFinite(r.startOffsetDays) || r.startOffsetDays < 0) {
            throw new Error("Start offset must be 0 or greater.");
        }

        if (Array.isArray(allowedStages) && allowedStages.length) {
            if (!allowedStages.includes(r.startAnchorStage)) {
                throw new Error("Start anchor is not available for the current method.");
            }
        }

        if (r.endMode === "fixed_days") {
            if (!Number.isFinite(r.durationDays) || r.durationDays < 0) {
                throw new Error("Duration days must be 0 or greater.");
            }
        } else if (r.endMode === "anchor_range") {
            if (!String(r.endAnchorStage || "").trim()) {
                throw new Error("End anchor is required for anchor-range tasks.");
            }
            if (Array.isArray(allowedStages) && allowedStages.length) {
                if (!allowedStages.includes(r.endAnchorStage)) {
                    throw new Error("End anchor is not available for the current method.");
                }
            }
        } else {
            throw new Error("Invalid end mode.");
        }

        if (r.repeatMode === "interval") {
            if (rawRepeatUntilMode && rawRepeatUntilMode !== "x_times" && rawRepeatUntilMode !== "until_anchor") {
                throw new Error("Invalid repeat-until mode.");
            }
            if (!Number.isFinite(r.repeatEveryDays) || r.repeatEveryDays < 1) {
                throw new Error("Repeat every days must be at least 1.");
            }
            if (!String(r.repeatUntilAnchorStage || "").trim()) {
                throw new Error("Cutoff anchor is required for repeated tasks.");
            }
            if (!Number.isFinite(r.repeatCutoffOffsetDays) || r.repeatCutoffOffsetDays < 0) {
                throw new Error("Cutoff offset must be 0 or greater.");
            }
            if (Array.isArray(allowedStages) && allowedStages.length) {
                if (!allowedStages.includes(r.repeatUntilAnchorStage)) {
                    throw new Error("Cutoff anchor is not available for the current method.");
                }
            }

            if (r.repeatUntilMode === "x_times") {
                if (!Number.isFinite(r.repeatTimes) || r.repeatTimes < 1) {
                    throw new Error("Repeat times must be at least 1.");
                }
            } else if (r.repeatUntilMode === "until_anchor") {
                // The cutoff anchor already supplies the stop date for this mode.
            } else {
                throw new Error("Invalid repeat-until mode.");
            }
        }

        return r;
    }

    function describeTaskRule(rule) {
        const r = normalizeTaskRule(rule);

        function fmtOffset(days, dir, stage) {
            const n = Number(days ?? 0);
            const label = humanStageLabel(stage);

            if (!Number.isFinite(n) || n === 0) return label;

            return `${n} day${n === 1 ? "" : "s"} ${dir} ${label}`;
        }

        const parts = [];

        parts.push(r.title);

        // timing
        const startTxt = fmtOffset(
            r.startOffsetDays,
            r.startOffsetDirection,
            r.startAnchorStage
        );

        if (r.endMode === "anchor_range") {
            const endLabel = humanStageLabel(r.endAnchorStage);

            if (r.startOffsetDays === 0 &&
                r.endAnchorOffsetDays === 0 &&
                r.startAnchorStage === "HARVEST_START" &&
                r.endAnchorStage === "HARVEST_END") {

                parts.push("Harvest window");

            } else {
                const endTxt = fmtOffset(
                    r.endAnchorOffsetDays,
                    r.endAnchorOffsetDirection,
                    r.endAnchorStage
                );

                parts.push(`${startTxt} → ${endTxt}`);
            }

        } else {
            parts.push(startTxt);

            if (r.durationDays > 1) {
                parts.push(`${r.durationDays} days`);
            }
        }

        if (r.repeatMode === "interval") {
            const cutoffTxt = fmtOffset(
                r.repeatCutoffOffsetDays,
                r.repeatCutoffOffsetDirection,
                r.repeatUntilAnchorStage
            );
            const repeatTxt = (r.repeatUntilMode === "x_times")
                ? `repeat every ${r.repeatEveryDays} days, up to ${r.repeatTimes} time${r.repeatTimes === 1 ? "" : "s"}, until ${cutoffTxt}`
                : `repeat every ${r.repeatEveryDays} days until ${cutoffTxt}`;

            parts.push(repeatTxt);
        }

        return parts.join(" • ");
    }

    function getTaskPreviewRuleKey(rule, ruleIndex) {
        const id = String(rule?.id || 'rule').trim() || 'rule';
        return `${id}::${Number(ruleIndex)}`;
    }

    function normalizeTaskTitleIdentity(value) {
        return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
    }

    function taskTitleContainsIdentity(title, identity) {
        const normalizedTitle = normalizeTaskTitleIdentity(title);
        const normalizedIdentity = normalizeTaskTitleIdentity(identity);
        return !!normalizedIdentity && normalizedTitle.includes(normalizedIdentity);
    }

    function escapeTaskTitleRegExp(value) {
        return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function stripTrailingTaskIdentity(title, identity) {
        const text = String(title || '').trim();
        const identityText = String(identity || '').trim();
        if (!text || !identityText) return text;
        const pattern = new RegExp(`(?:\\s*(?:[-–—:]+|for)?\\s*)${escapeTaskTitleRegExp(identityText)}\\s*$`, 'i');
        return text.replace(pattern, '').trim();
    }

    function cleanTaskActionTitle(title) {
        return String(title || '')
            .replace(/\{plant\}/g, '')
            .replace(/\{succ\}/g, '')
            .replace(/\s+for\s*$/i, '')
            .replace(/\s*[-–—:]+\s*$/g, '')
            .trim();
    }

    function appendCropDisplayNameToTaskAction(actionTitle, cropDisplayName) {
        const action = cleanTaskActionTitle(actionTitle) || 'Task';
        return `${action} – ${cropDisplayName}`;
    }

    function formatCropDisplayName(plantName, varietyName) {
        const plantText = String(plantName || '').trim() || 'Plant';
        const varietyText = String(varietyName || '').trim();
        if (!varietyText) return plantText;
        const normalizedPlant = normalizeTaskTitleIdentity(plantText);
        const normalizedVariety = normalizeTaskTitleIdentity(varietyText);
        if (normalizedPlant === normalizedVariety || normalizedPlant.includes(`(${normalizedVariety})`)) return plantText;
        return `${plantText} (${varietyText})`;
    }

    function buildGeneratedTaskTitle(template, cropDisplayName, plantName, varietyName) {
        const rawTitle = String(template || '').trim();
        const hasPlantToken = /\{plant\}/.test(rawTitle);
        const title = rawTitle.replace(/\{succ\}/g, '');
        if (hasPlantToken) return appendCropDisplayNameToTaskAction(title, cropDisplayName);
        const customTitle = title.trim();
        if (!customTitle) return appendCropDisplayNameToTaskAction('Task', cropDisplayName);
        let actionTitle = stripTrailingTaskIdentity(customTitle, cropDisplayName);
        actionTitle = stripTrailingTaskIdentity(actionTitle, plantName);
        if (varietyName) actionTitle = stripTrailingTaskIdentity(actionTitle, varietyName);
        if (taskTitleContainsIdentity(actionTitle, cropDisplayName)) return actionTitle;
        return appendCropDisplayNameToTaskAction(actionTitle, cropDisplayName);
    }

    function taskAnchorDatesForTimeline(currentTimeline, currentSowDate) {
        return {
            SOW: iso(currentSowDate),
            GERM: iso(currentTimeline.germ),
            TRANSPLANT: iso(currentTimeline.transplant),
            HARVEST_START: iso(currentTimeline.harvestStart),
            HARVEST_END: iso(currentTimeline.harvestEnd)
        };
    }

    function resolveTaskAnchorISO(anchors, stage) {
        let anchorISO = anchors[String(stage || '').trim()] || null;
        if (!anchorISO && stage === 'GERM') anchorISO = anchors.SOW || null;
        return anchorISO;
    }

    function applyTaskAnchorOffset(anchorISO, days, direction) {
        if (!anchorISO) return null;
        const count = Number(days ?? 0);
        return Number.isFinite(count) ? shiftDays(anchorISO, (direction === 'before' ? -1 : 1) * count) : null;
    }

    function resolveTaskRuleRange(rule, anchors) {
        const startAnchorISO = resolveTaskAnchorISO(anchors, rule.startAnchorStage);
        if (!startAnchorISO) return null;
        const startISO = applyTaskAnchorOffset(startAnchorISO, rule.startOffsetDays, rule.startOffsetDirection);
        if (!startISO) return null;

        let endISO = startISO;
        if (rule.endMode === 'fixed_days') {
            const duration = Number(rule.durationDays ?? 0);
            endISO = Number.isFinite(duration) && duration >= 0 ? shiftDays(startISO, duration) : startISO;
        } else if (rule.endMode === 'anchor_range') {
            const endAnchorISO = resolveTaskAnchorISO(anchors, rule.endAnchorStage);
            if (!endAnchorISO) return null;
            endISO = applyTaskAnchorOffset(endAnchorISO, rule.endAnchorOffsetDays, rule.endAnchorOffsetDirection);
            if (!endISO) return null;
        } else {
            return null;
        }

        let rangeStartISO = startISO;
        let rangeEndISO = endISO;
        if (rangeEndISO < rangeStartISO) {
            [rangeStartISO, rangeEndISO] = [rangeEndISO, rangeStartISO];
        }
        return { rangeStartISO, rangeEndISO };
    }

    function resolveRepeatCutoffISO(rule, anchors) {
        const cutoffAnchorISO = resolveTaskAnchorISO(anchors, rule.repeatUntilAnchorStage);
        return applyTaskAnchorOffset(cutoffAnchorISO, rule.repeatCutoffOffsetDays, rule.repeatCutoffOffsetDirection);
    }

    function clampHardeningRuleToTransplantLeadWindow(rule, anchors, methodId) {
        const r = normalizeTaskRule(rule);
        if (!methodUsesTransplantDateInput(methodId) || r.id !== "harden" || r.startAnchorStage !== "TRANSPLANT" || r.startOffsetDirection !== "before") return r;
        const leadDays = daysDeltaISO(anchors.SOW, anchors.TRANSPLANT);
        if (!(Number.isFinite(leadDays) && leadDays >= 0)) return r;
        const clampedOffset = Math.min(Math.max(0, Math.round(Number(r.startOffsetDays) || 0)), leadDays);
        if (clampedOffset === r.startOffsetDays) return r;
        return {
            ...r,
            startOffsetDays: clampedOffset, // FIX: keep hardening inside the sow/start-to-transplant lead window.
            durationDays: r.endMode === "fixed_days" ? Math.min(Math.max(0, Number(r.durationDays) || 0), clampedOffset) : r.durationDays // FIX: avoid hardening continuing after transplant when the offset is shortened.
        };
    }

    function validateTaskRuleAnchorOrder(rule, { schedule, timelines } = {}) {
        const r = normalizeTaskRule(rule);
        const sowDate = Array.isArray(schedule) ? schedule[0] : schedule;
        const timeline = Array.isArray(timelines) ? timelines[0] : timelines;
        if (!sowDate || !timeline) return r;
        const anchors = taskAnchorDatesForTimeline(timeline, sowDate);
        const startAnchorISO = resolveTaskAnchorISO(anchors, r.startAnchorStage);
        const startISO = applyTaskAnchorOffset(startAnchorISO, r.startOffsetDays, r.startOffsetDirection);
        if (!startISO) return r;

        if (r.endMode === "anchor_range") {
            const endAnchorISO = resolveTaskAnchorISO(anchors, r.endAnchorStage);
            const endISO = applyTaskAnchorOffset(endAnchorISO, r.endAnchorOffsetDays, r.endAnchorOffsetDirection);
            if (endISO && startISO > endISO) {
                throw new Error("Start must be on or before the end anchor.");
            }
        }

        if (r.repeatMode === "interval") {
            const cutoffISO = resolveRepeatCutoffISO(r, anchors);
            if (cutoffISO && startISO > cutoffISO) {
                throw new Error("Start must be on or before the cutoff anchor.");
            }
        }

        return r;
    }

    function findRepeatCutoffOmittedRuleKeys({ taskTemplate, schedule, timelines } = {}) {
        const omitted = new Set();
        const tpl = normalizeTaskTemplate(taskTemplate ?? null);
        const rules = Array.isArray(tpl?.rules) ? tpl.rules : [];
        const sowDate = Array.isArray(schedule) ? schedule[0] : schedule;
        const timeline = Array.isArray(timelines) ? timelines[0] : timelines;
        if (!sowDate || !timeline) return omitted;
        const anchors = taskAnchorDatesForTimeline(timeline, sowDate);

        rules.forEach((sourceRule, ruleIndex) => {
            const rule = normalizeTaskRule(sourceRule);
            if (rule.repeatMode !== 'interval') return;
            const range = resolveTaskRuleRange(rule, anchors);
            const cutoffISO = resolveRepeatCutoffISO(rule, anchors);
            if (!range || !cutoffISO) return;
            if (range.rangeStartISO >= cutoffISO) {
                omitted.add(getTaskPreviewRuleKey(rule, ruleIndex));
            }
        });

        return omitted;
    }

    async function buildTasksForPlan({
        plant,
        schedule,
        timelines,
        taskTemplate,
        methodCategoryId = '',
        methodId = '',
        varietyName = '',
        includePreviewMetadata = false
    }) {
        const tasks = [];
        const plantName = plant?.plant_name || plant?.abbr || "Plant";
        const cropDisplayName = formatCropDisplayName(plantName, varietyName);
        const tpl = normalizeTaskTemplate(taskTemplate ?? null);
        const rules = Array.isArray(tpl?.rules) ? tpl.rules : [];
        const sowDate = Array.isArray(schedule) ? schedule[0] : schedule;
        const timeline = Array.isArray(timelines) ? timelines[0] : timelines;
        if (!sowDate || !timeline) return tasks;

        function substituteTitle(template) {
            return buildGeneratedTaskTitle(template, cropDisplayName, plantName, varietyName);
        }

        const anchors = taskAnchorDatesForTimeline(timeline, sowDate);
        for (let ruleIndex = 0; ruleIndex < rules.length; ruleIndex++) {
            const rule = clampHardeningRuleToTransplantLeadWindow(rules[ruleIndex], anchors, methodId);
            validateTaskRuleAnchorOrder(rule, { schedule: sowDate, timelines: timeline });
            const range = resolveTaskRuleRange(rule, anchors);
            if (!range) continue;
            const { rangeStartISO, rangeEndISO } = range;

            const occurrences = [];
            if (rule.repeatMode !== 'interval') {
                occurrences.push({ startISO: rangeStartISO, endISO: rangeEndISO });
            } else {
                const every = Number(rule.repeatEveryDays ?? 0);
                if (!Number.isFinite(every) || every < 1) continue;
                const cutoffISO = resolveRepeatCutoffISO(rule, anchors);
                if (!cutoffISO) continue;
                if (rule.repeatUntilMode === 'x_times') {
                    const times = Number(rule.repeatTimes ?? 1);
                    if (!Number.isFinite(times) || times < 1) continue;
                    let currentStart = rangeStartISO;
                    let currentEnd = rangeEndISO;
                    for (let occurrenceIndex = 0; occurrenceIndex < times; occurrenceIndex++) {
                        if (currentStart >= cutoffISO) break;
                        occurrences.push({ startISO: currentStart, endISO: currentEnd });
                        currentStart = shiftDays(currentStart, every);
                        currentEnd = shiftDays(currentEnd, every);
                    }
                } else if (rule.repeatUntilMode === 'until_anchor') {
                    let currentStart = rangeStartISO;
                    let currentEnd = rangeEndISO;
                    while (currentStart < cutoffISO) {
                        occurrences.push({ startISO: currentStart, endISO: currentEnd });
                        currentStart = shiftDays(currentStart, every);
                        currentEnd = shiftDays(currentEnd, every);
                    }
                } else {
                    continue;
                }
            }

            const title = substituteTitle(rule.title) || `Task for ${cropDisplayName}`;
            const previewRuleKey = getTaskPreviewRuleKey(rule, ruleIndex);
            occurrences.forEach((occurrence, occurrenceIndex) => {
                if (!occurrence.startISO && !occurrence.endISO) return;
                const schedulerTaskKey = `${previewRuleKey}::${occurrenceIndex}`;
                const task = {
                    title,
                    startISO: occurrence.startISO || occurrence.endISO,
                    endISO: occurrence.endISO || occurrence.startISO,
                    plant_name: plantName,
                    variety_name: String(varietyName || '').trim(),
                    rule_id: rule.id || null,
                    task_type_id: resolveTaskRuleTaskTypeId(rule),
                    scheduler_rule_id: rule.id || null,
                    scheduler_anchor_stage: rule.startAnchorStage,
                    scheduler_method_category_id: normId(methodCategoryId),
                    scheduler_method_id: normId(methodId),
                    scheduler_task_key: schedulerTaskKey,
                    scheduler_occurrence_index: occurrenceIndex,
                    startAnchorStage: rule.startAnchorStage,
                    endMode: rule.endMode
                };
                if (includePreviewMetadata) {
                    Object.defineProperties(task, {
                        previewRuleKey: { value: previewRuleKey, enumerable: false },
                        previewRuleIndex: { value: ruleIndex, enumerable: false },
                        previewOccurrenceIndex: { value: occurrenceIndex, enumerable: false }
                    });
                }
                tasks.push(task);
            });
        }
        return tasks;
    }

    function filterPreviewTasks(tasks, selectedRuleKeys) {
        const selected = selectedRuleKeys instanceof Set ? selectedRuleKeys : new Set(selectedRuleKeys || []);
        return (Array.isArray(tasks) ? tasks : []).filter(task => selected.has(task.previewRuleKey));
    }

    function buildTaskRuleDisplayOrder(taskRules, generatedTasks) {
        const firstOccurrenceByRule = new Map();
        (Array.isArray(generatedTasks) ? generatedTasks : []).forEach(task => {
            const key = task.previewRuleKey;
            const startISO = String(task.startISO || '');
            if (!key || !startISO) return;
            const current = firstOccurrenceByRule.get(key);
            if (!current || startISO < current) firstOccurrenceByRule.set(key, startISO);
        });
        return (Array.isArray(taskRules) ? taskRules : [])
            .map((rule, originalIndex) => ({
                rule,
                originalIndex,
                key: getTaskPreviewRuleKey(rule, originalIndex),
                firstOccurrenceISO: firstOccurrenceByRule.get(getTaskPreviewRuleKey(rule, originalIndex)) || null
            }))
            .sort((left, right) => {
                if (left.firstOccurrenceISO && right.firstOccurrenceISO) {
                    const dateOrder = left.firstOccurrenceISO.localeCompare(right.firstOccurrenceISO);
                    if (dateOrder !== 0) return dateOrder;
                } else if (left.firstOccurrenceISO) {
                    return -1;
                } else if (right.firstOccurrenceISO) {
                    return 1;
                }
                return left.originalIndex - right.originalIndex;
            });
    }

    function groupPreviewTasksByRule(tasks) {
        const groupsByKey = new Map();
        (Array.isArray(tasks) ? tasks : []).forEach((task, taskIndex) => {
            const key = task.previewRuleKey || `${String(task.rule_id || 'rule')}::${taskIndex}`;
            if (!groupsByKey.has(key)) {
                groupsByKey.set(key, {
                    key,
                    title: task.title,
                    originalIndex: Number(task.previewRuleIndex ?? taskIndex),
                    firstOccurrenceISO: String(task.startISO || ''),
                    occurrences: []
                });
            }
            const group = groupsByKey.get(key);
            group.occurrences.push(task);
            if (task.startISO && (!group.firstOccurrenceISO || task.startISO < group.firstOccurrenceISO)) {
                group.firstOccurrenceISO = task.startISO;
            }
        });
        return Array.from(groupsByKey.values())
            .map(group => ({
                ...group,
                occurrences: group.occurrences.slice().sort((left, right) => {
                    const startOrder = String(left.startISO || '').localeCompare(String(right.startISO || ''));
                    if (startOrder !== 0) return startOrder;
                    return String(left.endISO || '').localeCompare(String(right.endISO || ''));
                })
            }))
            .sort((left, right) => {
                const dateOrder = left.firstOccurrenceISO.localeCompare(right.firstOccurrenceISO);
                if (dateOrder !== 0) return dateOrder;
                return left.originalIndex - right.originalIndex;
            });
    }

    function resolveTaskPreviewScheduleRange(result) {
        const startISO = result?.kind === 'perennial'
            ? String(result.lifespanStartISO || '')
            : fmtISO(result?.schedule?.[0]);
        const endISO = result?.kind === 'perennial'
            ? String(result.lifespanEndISO || '')
            : String(result?.lastScheduledHarvestEndISO || '');
        const start = parseISODateUTCValue(startISO);
        const end = parseISODateUTCValue(endISO);
        if (!start || !end || end < start) return null;
        return { startISO: fmtISO(start), endISO: fmtISO(end) };
    }

    function resolveTaskPreviewDisplayRange(scheduleRange, tasks = []) {
        let rangeStart = parseISODateUTCValue(scheduleRange?.startISO);
        let rangeEnd = parseISODateUTCValue(scheduleRange?.endISO);
        if (!rangeStart || !rangeEnd || rangeEnd < rangeStart) return scheduleRange || null;
        (Array.isArray(tasks) ? tasks : []).forEach(task => {
            const taskStart = parseISODateUTCValue(task?.startISO);
            const taskEnd = parseISODateUTCValue(task?.endISO);
            if (!taskStart || !taskEnd || taskEnd < taskStart) return;
            if (taskStart && taskStart < rangeStart) rangeStart = taskStart;
            if (taskEnd && taskEnd > rangeEnd) rangeEnd = taskEnd;
        });
        return { startISO: fmtISO(rangeStart), endISO: fmtISO(rangeEnd) };
    }

    function renderTaskTimelinePreview(container, { tasks = [], scheduleRange = null, message = '', error = '' } = {}) {
        container.innerHTML = '';
        if (error || message || !tasks.length) {
            const empty = document.createElement('div');
            empty.textContent = error || message || 'No tasks are available for the current preview selection.';
            empty.style.padding = '10px';
            empty.style.border = `1px solid ${error ? '#fca5a5' : '#d1d5db'}`;
            empty.style.background = error ? '#fef2f2' : '#f9fafb';
            empty.style.color = error ? '#991b1b' : '#4b5563';
            container.appendChild(empty);
            return;
        }

        const rangeStart = parseISODateUTCValue(scheduleRange?.startISO);
        const rangeEnd = parseISODateUTCValue(scheduleRange?.endISO);
        if (!rangeStart || !rangeEnd || rangeEnd < rangeStart) {
            renderTaskTimelinePreview(container, { error: 'The schedule does not contain valid preview bounds.' });
            return;
        }
        const totalDays = Math.max(1, Math.round((rangeEnd - rangeStart) / 86400000));

        const labels = document.createElement('div');
        labels.style.display = 'grid';
        labels.style.gridTemplateColumns = '190px 1fr';
        labels.style.gap = '8px';
        const spacer = document.createElement('div');
        const dateScale = document.createElement('div');
        dateScale.style.display = 'flex';
        dateScale.style.justifyContent = 'space-between';
        dateScale.style.fontSize = '11px';
        dateScale.style.color = '#6b7280';
        const startLabel = document.createElement('span');
        const endLabel = document.createElement('span');
        startLabel.textContent = fmtISO(rangeStart);
        endLabel.textContent = fmtISO(rangeEnd);
        dateScale.appendChild(startLabel);
        dateScale.appendChild(endLabel);
        labels.appendChild(spacer);
        labels.appendChild(dateScale);
        container.appendChild(labels);

        groupPreviewTasksByRule(tasks).forEach(group => {
            const rowEl = document.createElement('div');
            rowEl.style.display = 'grid';
            rowEl.style.gridTemplateColumns = '190px 1fr';
            rowEl.style.gap = '8px';
            rowEl.style.alignItems = 'center';
            rowEl.style.margin = '5px 0';
            const taskLabel = document.createElement('div');
            taskLabel.textContent = group.title;
            taskLabel.title = `${group.occurrences.length} occurrence${group.occurrences.length === 1 ? '' : 's'}`;
            taskLabel.style.fontSize = '12px';
            taskLabel.style.overflow = 'hidden';
            taskLabel.style.textOverflow = 'ellipsis';
            taskLabel.style.whiteSpace = 'nowrap';
            const track = document.createElement('div');
            track.style.position = 'relative';
            track.style.height = '16px';
            track.style.background = '#e5e7eb';
            track.style.borderRadius = '3px';
            group.occurrences.forEach(task => {
                const taskStart = parseISODateUTCValue(task.startISO);
                const taskEnd = parseISODateUTCValue(task.endISO);
                if (!taskStart || !taskEnd) return;
                if (taskEnd < rangeStart || taskStart > rangeEnd) return;
                const clippedStart = new Date(Math.max(taskStart.getTime(), rangeStart.getTime()));
                const clippedEnd = new Date(Math.min(taskEnd.getTime(), rangeEnd.getTime()));
                const offsetDays = Math.round((clippedStart - rangeStart) / 86400000);
                const durationDays = Math.max(0, Math.round((clippedEnd - clippedStart) / 86400000));
                const leftPercent = Math.max(0, Math.min(99, (offsetDays / totalDays) * 100));
                const widthPercent = Math.max(1, Math.min(100 - leftPercent, (Math.max(1, durationDays) / totalDays) * 100));
                const bar = document.createElement('div');
                bar.style.position = 'absolute';
                bar.style.left = `${leftPercent}%`;
                bar.style.width = `${widthPercent}%`;
                bar.style.height = '100%';
                bar.style.background = '#2563eb';
                bar.style.borderRadius = '3px';
                bar.title = `${task.title}: ${task.startISO} to ${task.endISO}`;
                track.appendChild(bar);
            });
            rowEl.appendChild(taskLabel);
            rowEl.appendChild(track);
            container.appendChild(rowEl);
        });
    }

    function updateTaskTimelinePreview({
        container,
        generatedTasks = [],
        selectedRuleKeys = new Set(),
        scheduleRange = null,
        message = '',
        error = ''
    } = {}) {
        const tasks = filterPreviewTasks(generatedTasks, selectedRuleKeys);
        const displayRange = resolveTaskPreviewDisplayRange(scheduleRange, tasks);
        renderTaskTimelinePreview(container, { tasks, scheduleRange: displayRange, message, error });
        return tasks;
    }

    async function getPlantingMethodById(methodId) {
        const normalizedMethodId = normId(methodId);
        if (!normalizedMethodId) return null;
        const sql = `
        SELECT method_id, method_name, method_category_id, tasks_required_json
        FROM PlantingMethods
        WHERE LOWER(TRIM(method_id)) = ?
        ORDER BY CASE
                   WHEN TRIM(method_id) = LOWER(TRIM(method_id)) THEN 0
                   ELSE 1
                 END,
                 method_id
        LIMIT 1;`;
        const rows = await queryAll(sql, [normalizedMethodId]);
        return rows[0] ? {
            ...rows[0],
            method_id: normId(rows[0].method_id),
            method_category_id: normId(rows[0].method_category_id)
        } : null;
    }

    // -------------------- Rule library --------------------------

    function prettySourceLabel(src) {
        const map = {
            cell: "Cell override",
            variety: "Variety default",
            plant: "Plant default",
            method_builtin: "Built-in method template",
            none: "No template",
            unknown: "Unknown"
        };
        return map[src] || String(src || "unknown");
    }

    function updateTasksHeader({
        methodCategorySel,
        methodSel,
        formState,
        currentMethodSpan,
        currentTemplateSourceSpan,
        taskDirty,
        taskTemplateSource
    }) {
        const methodCategoryName = (() => {
            const opt = methodCategorySel?.selectedOptions?.[0];
            const label = opt ? String(opt.textContent || "").trim() : "";
            return label || String(formState?.methodCategoryId || "").trim() || "(none)";
        })();
    
        const methodName = (() => {
            const opt = methodSel?.selectedOptions?.[0];
            const label = opt ? String(opt.textContent || "").trim() : "";
            return label || String(formState?.methodId || "").trim() || "(none)";
        })();
    
        currentMethodSpan.textContent = `Method: ${methodCategoryName} / ${methodName}`;
    
        const dirtyLabel = taskDirty ? " • Dirty" : "";
        currentTemplateSourceSpan.textContent =
            `Source: ${prettySourceLabel(taskTemplateSource)}${dirtyLabel}`;
    }

    async function resolveTaskTemplate({ cell, plantId, varietyId = null, methodId }) {
        const raw = String(cell?.getAttribute?.("task_template_json") ?? "").trim();
        if (raw.length > 0) {
            try {
                const tpl = JSON.parse(raw);
                if (tpl && typeof tpl === "object") {
                    return { template: tpl, source: "cell" };
                }
            } catch (_) {
                console.warn("Invalid task_template_json");
            }
        }

        const vTpl = await TaskTemplateModel.loadVarietyTemplate(varietyId, methodId);
        if (vTpl) {
            return { template: vTpl, source: "variety" };
        }

        const pTpl = await TaskTemplateModel.loadPlantTemplate(plantId, methodId);
        if (pTpl) {
            return { template: pTpl, source: "plant" };
        }

        const methodTpl = await TaskTemplateModel.loadMethodBuiltinTemplate(methodId);
        if (methodTpl) {
            return { template: methodTpl, source: "method_builtin" };
        }

        return { template: null, source: "none" };
    }

    function prepAnchorForPlanningMode(planningMode) {
        return planningMode === "direct_sow" ? "SOW" : "TRANSPLANT";
    }

    function taskRuleLibraryForPlanningMode(planningMode) {
        const prepAnchor = prepAnchorForPlanningMode(planningMode);

        return {
            prep: {
                id: "prep",
                title: "Prep bed – {plant}",
                startAnchorStage: prepAnchor,
                startOffsetDays: 3,
                startOffsetDirection: "before",
                endMode: "fixed_days",
                durationDays: 3,
                endAnchorStage: null,
                endAnchorOffsetDays: 0,
                endAnchorOffsetDirection: "after",
                repeatMode: "none",
                repeatEveryDays: 1,
                repeatUntilMode: "x_times",
                repeatTimes: 1,
                repeatUntilAnchorStage: "HARVEST_END",
                repeatCutoffOffsetDays: 0,
                repeatCutoffOffsetDirection: "after"
            },
            sow: {
                id: "sow",
                title: "Sow – {plant}",
                startAnchorStage: "SOW",
                startOffsetDays: 0,
                startOffsetDirection: "after",
                endMode: "fixed_days",
                durationDays: 7,
                endAnchorStage: null,
                endAnchorOffsetDays: 0,
                endAnchorOffsetDirection: "after",
                repeatMode: "none",
                repeatEveryDays: 1,
                repeatUntilMode: "x_times",
                repeatTimes: 1,
                repeatUntilAnchorStage: "HARVEST_END",
                repeatCutoffOffsetDays: 0,
                repeatCutoffOffsetDirection: "after"
            },
            start: {
                id: "start",
                title: "Start indoors – {plant}",
                startAnchorStage: "SOW",
                startOffsetDays: 0,
                startOffsetDirection: "after",
                endMode: "fixed_days",
                durationDays: 0,
                endAnchorStage: null,
                endAnchorOffsetDays: 0,
                endAnchorOffsetDirection: "after",
                repeatMode: "none",
                repeatEveryDays: 1,
                repeatUntilMode: "x_times",
                repeatTimes: 1,
                repeatUntilAnchorStage: "HARVEST_END",
                repeatCutoffOffsetDays: 0,
                repeatCutoffOffsetDirection: "after"
            },
            harden: {
                id: "harden",
                title: "Harden off – {plant}",
                startAnchorStage: "TRANSPLANT",
                startOffsetDays: 7,
                startOffsetDirection: "before",
                endMode: "fixed_days",
                durationDays: 7,
                endAnchorStage: null,
                endAnchorOffsetDays: 0,
                endAnchorOffsetDirection: "after",
                repeatMode: "none",
                repeatEveryDays: 1,
                repeatUntilMode: "x_times",
                repeatTimes: 1,
                repeatUntilAnchorStage: "HARVEST_END",
                repeatCutoffOffsetDays: 0,
                repeatCutoffOffsetDirection: "after"
            },
            transplant: {
                id: "transplant",
                title: "Transplant – {plant}",
                startAnchorStage: "TRANSPLANT",
                startOffsetDays: 0,
                startOffsetDirection: "after",
                endMode: "fixed_days",
                durationDays: 7,
                endAnchorStage: null,
                endAnchorOffsetDays: 0,
                endAnchorOffsetDirection: "after",
                repeatMode: "none",
                repeatEveryDays: 1,
                repeatUntilMode: "x_times",
                repeatTimes: 1,
                repeatUntilAnchorStage: "HARVEST_END",
                repeatCutoffOffsetDays: 0,
                repeatCutoffOffsetDirection: "after"
            },
            thin: {
                id: "thin",
                title: "Thin / check – {plant}",
                startAnchorStage: "GERM",
                startOffsetDays: 7,
                startOffsetDirection: "after",
                endMode: "fixed_days",
                durationDays: 7,
                endAnchorStage: null,
                endAnchorOffsetDays: 0,
                endAnchorOffsetDirection: "after",
                repeatMode: "none",
                repeatEveryDays: 1,
                repeatUntilMode: "x_times",
                repeatTimes: 1,
                repeatUntilAnchorStage: "HARVEST_END",
                repeatCutoffOffsetDays: 0,
                repeatCutoffOffsetDirection: "after"
            },
            harvest: {
                id: "harvest",
                title: "Harvest – {plant}",
                startAnchorStage: "HARVEST_START",
                startOffsetDays: 0,
                startOffsetDirection: "after",
                endMode: "anchor_range",
                durationDays: null,
                endAnchorStage: "HARVEST_END",
                endAnchorOffsetDays: 0,
                endAnchorOffsetDirection: "after",
                repeatMode: "none",
                repeatEveryDays: 1,
                repeatUntilMode: "x_times",
                repeatTimes: 1,
                repeatUntilAnchorStage: "HARVEST_END",
                repeatCutoffOffsetDays: 0,
                repeatCutoffOffsetDirection: "after"
            }
        };
    }

    function applyTaskOverrides(rule, override) {
        const base = normalizeTaskRule(rule);
        if (!override || typeof override !== "object") return { ...base };
        return normalizeTaskRule({ ...base, ...override });
    }

    function normalizeMethodRequiredTasks(methodId, required) {
        const normalized = required && typeof required === "object" ? { ...required } : {};
        if (normId(methodId) === "transplant.purchased" && !Object.prototype.hasOwnProperty.call(normalized, "harden")) {
            normalized.harden = true; // FIX: existing databases should gain purchased-transplant hardening unless explicitly opted out.
        }
        return normalized;
    }

    // -------------------- Default template from method --------------------------

    async function getDefaultTaskTemplateForPlantingMethods(methodId) {
        if (!methodId) return null;
    
        const method = await getPlantingMethodById(methodId);
        if (!method) return null;
    
        const resolved = resolveMethodBehavior({
            methodCategoryId: method.method_category_id,
            methodId: method.method_id
        });
    
        const lib = taskRuleLibraryForPlanningMode(resolved.planningMode);

        const required = normalizeMethodRequiredTasks(resolved.methodId, safeJsonParse(method.tasks_required_json, {}) || {});
        const orderedIds = ["prep", "sow", "start", "harden", "transplant", "thin", "harvest"];

        const rules = [];
        for (const id of orderedIds) {
            if (id === "harvest") {
                const override = (required.harvest && typeof required.harvest === "object")
                    ? required.harvest
                    : null;
                rules.push(applyTaskOverrides(lib.harvest, override));
                continue;
            }

            const req = required[id];
            if (!req) continue;
            if (!lib[id]) continue;

            const override = (req && typeof req === "object") ? req : null;
            rules.push(applyTaskOverrides(lib[id], override));
        }

        const allowedStages = await getAllowedAnchorStagesForMethod(methodId); // FIX: enforce method-specific built-in anchors
        const validRules = rules.flatMap((rule) => {
            try {
                return [validateTaskRule(rule, { allowedStages })];
            } catch (e) {
                console.warn("[TaskTemplate] Skipping unsupported built-in task rule", { // FIX: surface filtered method data
                    methodId: String(methodId),
                    ruleId: String(rule?.id || ""),
                    reason: e?.message || String(e)
                });
                return [];
            }
        });

        if (!validRules.length) return null;

        return normalizeTaskTemplate({ version: 2, rules: validRules }); // FIX: expose only rules valid for the method
    }




































































    function buildScheduleAttributePatch(inputs, result, options = {}) { // FIX: define the complete graph mutation before applying it
        const { plant, city } = inputs;
        const env = plant.cropTempEnvelope(); // FIX: persistence needs Tbase, not perennial GDD rates
        const perennial = result?.kind === 'perennial';
        const timeline = result?.timelines?.[0] || {};
        const sowDate = result?.schedule?.[0] || null;
        const budget = perennial ? null : plant.firstHarvestBudget();
        const fmt = d => d instanceof Date && !Number.isNaN(d.getTime()) ? fmtISO(d) : '';
        const yieldPerPlant = typeof plant.yieldPerPlant === 'function'
            ? plant.yieldPerPlant()
            : plant.yield_per_plant_kg;
        const numericYield = Number(yieldPerPlant);
        const growthStage = normalizeGrowthStage({
            stage_key: plant.growth_stage_key || inputs.growthStageKey || DEFAULT_GROWTH_STAGE_KEY,
            stage_label: plant.growth_stage_label || inputs.growthStageLabel || DEFAULT_GROWTH_STAGE_LABEL,
            gdd_ratio: plant.growth_stage_gdd_ratio ?? inputs.growthStageGddRatio ?? 1,
            spacing_ratio: plant.growth_stage_spacing_ratio ?? inputs.growthStageSpacingRatio,
            plant_diameter_ratio: plant.growth_stage_diameter_ratio ?? inputs.growthStageDiameterRatio,
            plant_height_ratio: plant.growth_stage_height_ratio ?? inputs.growthStageHeightRatio
        });
        const stageLabelSuffix = stageIsDefaultMature(growthStage) ? '' : ' - ' + growthStage.stageLabel;
        const patch = {
            season_start_year: String(inputs.seasonStartYear),
            days_maturity: perennial || budget?.mode !== 'days' ? '' : String(budget.amount),
            gdd_to_maturity: perennial || budget?.mode !== 'gdd' ? '' : String(budget.amount),
            lifespan_start: perennial ? String(result.lifespanStartISO || '') : '',
            lifespan_end: perennial ? String(result.lifespanEndISO || '') : '',
            variety_id: String(inputs.varietyId ?? ''),
            variety_name: String(inputs.varietyName || ''),
            start_cooling_threshold_c: String(finiteNumberOrNull(plant.start_cooling_threshold_c) ?? ''),
            label: plant.plant_name + stageLabelSuffix + ' group',
            plant_id: String(plant.plant_id),
            plant_name: String(plant.plant_name || ''),
            plant_abbr: String(plant.abbr || ''),
            growth_stage_key: stageIsDefaultMature(growthStage) ? '' : growthStage.stageKey,
            growth_stage_label: stageIsDefaultMature(growthStage) ? '' : growthStage.stageLabel,
            growth_stage_gdd_ratio: stageIsDefaultMature(growthStage) ? '' : String(growthStage.gddRatio),
            growth_stage_spacing_ratio: stageIsDefaultMature(growthStage) ? '' : String(growthStage.spacingRatio),
            growth_stage_diameter_ratio: stageIsDefaultMature(growthStage) ? '' : String(growthStage.plantDiameterRatio),
            growth_stage_height_ratio: stageIsDefaultMature(growthStage) ? '' : String(growthStage.plantHeightRatio),
            annual: plant.isAnnual && plant.isAnnual() ? '1' : '0',
            biennial: plant.isBiennial && plant.isBiennial() ? '1' : '0',
            perennial: plant.isPerennial && plant.isPerennial() ? '1' : '0',
            city_id: city.city_id != null ? String(city.city_id) : '',
            city_name: String(city.city_name || ''),
            method_category_id: normId(inputs.methodCategoryId),
            method_id: normId(inputs.methodId),
            sowing_season_id: perennial ? '' : String(options.sowingSeasonId || ''),
            sowing_season_label: perennial ? '' : String(options.sowingSeasonLabel || ''),
            sowing_window_id: null, // CHANGED: remove stale pre-rename scheduler metadata on resave.
            sowing_window_label: null, // CHANGED: remove stale pre-rename scheduler metadata on resave.
            tbase_c: String(env.Tbase),
            sow_date: fmt(sowDate),
            days_transplant: options.transplantDaysOverrideEnabled && methodUsesTransplantDateInput(inputs.methodId) ? String(options.effectiveTransplantDays ?? '') : null, // FIX: persist overrides only for methods that use transplant lead days.
            germ_date: perennial ? '' : fmt(timeline.germ),
            transplant_date: perennial ? '' : fmt(timeline.transplant),
            maturity_date: perennial ? '' : fmt(timeline.maturity),
            harvest_start: perennial ? '' : fmt(timeline.harvestStart),
            harvest_end: perennial ? '' : fmt(timeline.harvestEnd),
            plant_yield: String(Number.isFinite(numericYield) && numericYield > 0 ? numericYield : 0),
            yield_unit: 'kg'
        };

        if (options.taskTemplateJson !== undefined) {
            patch.task_template_json = String(options.taskTemplateJson ?? '');
        }

        const hasValue = value => value !== undefined && value !== null && value !== '';
        const spacingX = hasValue(plant.spacing_x_cm) ? plant.spacing_x_cm : plant.spacing_cm;
        const spacingY = hasValue(plant.spacing_y_cm) ? plant.spacing_y_cm : plant.spacing_cm;
        if (hasValue(spacingX)) patch.spacing_x_cm = String(spacingX);
        if (hasValue(spacingY)) patch.spacing_y_cm = String(spacingY);
        if (hasValue(plant.spacing_cm)) patch.spacing_cm = String(plant.spacing_cm);
        if (hasValue(plant.veg_diameter_cm)) patch.veg_diameter_cm = String(plant.veg_diameter_cm);
        if (hasValue(plant.veg_height_cm)) patch.veg_height_cm = String(plant.veg_height_cm);

        return patch;
    }

    function snapshotCellAttributes(cell, keys) { // FIX: retain absent versus empty attribute state
        const value = cell?.value;
        const snapshot = {};
        for (const key of keys || []) {
            const present = typeof value?.hasAttribute === 'function'
                ? value.hasAttribute(key)
                : cell?.getAttribute?.(key) != null;
            snapshot[key] = {
                present,
                value: present ? String(cell?.getAttribute?.(key) ?? value?.getAttribute?.(key) ?? '') : null
            };
        }
        return snapshot;
    }

    function writeCellAttribute(cell, key, value, model = null) { // FIX: support true removal during rollback
        const node = cell?.value;
        if (!node) return;
        const nextValue = value == null ? null : String(value);
        if (model && typeof model.execute === 'function' && typeof mxCellAttributeChange === 'function') {
            model.execute(new mxCellAttributeChange(cell, key, nextValue));
            return;
        }
        if (nextValue == null) {
            if (typeof node.removeAttribute === 'function') node.removeAttribute(key);
        } else if (typeof node.setAttribute === 'function') {
            node.setAttribute(key, nextValue);
        }
    }

    function applyCellAttributePatch(cell, patch, model = null) {
        for (const [key, value] of Object.entries(patch || {})) {
            writeCellAttribute(cell, key, value, model);
        }
    }

    function restoreCellAttributeSnapshot(cell, snapshot, model = null) {
        for (const [key, prior] of Object.entries(snapshot || {})) {
            writeCellAttribute(cell, key, prior.present ? prior.value : null, model);
        }
    }

    async function runCompensatedSaveSteps({
        applyGraphPatch,
        persist,
        finalizeGraph,
        restoreGraphPatch
    }) { // FIX: centralize graph compensation for every required save step
        let graphPatchStarted = false;
        try {
            if (typeof persist === 'function') await persist();
            if (typeof applyGraphPatch === 'function') { graphPatchStarted = true; await applyGraphPatch(); }
            if (typeof finalizeGraph === 'function') await finalizeGraph();
        } catch (error) {
            if (graphPatchStarted) {
                try {
                    await restoreGraphPatch();
                } catch (rollbackError) {
                    console.error('[Scheduler] Graph attribute rollback failed', rollbackError);
                }
            }
            throw error;
        }
    }


    async function applyScheduleToGraph(ui, cell, inputs, options = {}) {
        requireCanSchedulePlantingGroup(cell);
        const { plant, city } = inputs;
        const method = normId(inputs.methodId);
    
        const result = options.result || computeScheduleResult(inputs);
        const schedule = result.schedule;
        const timelines = result.timelines;

        function runTrellisHistoryTransaction(metadata, operation) {
            const history = typeof window !== "undefined" && window.Trellis && window.Trellis.history;
            if (history && typeof history.run === "function" && !(typeof history.isRestoring === "function" && history.isRestoring())) {
                return history.run(metadata, operation);
            }
            return operation();
        }

        function getSchedulerTaskReplacementCommand() {
            const tasksApi = typeof window !== "undefined" && window.USL && window.USL.tasks;
            return tasksApi && typeof tasksApi.applySchedulerTaskReplacement === "function" ? tasksApi.applySchedulerTaskReplacement : null;
        }

        async function buildTaskReplacementForPlan({
            method,
            plant,
            cell,
            schedule,
            timelines,
            plantId = null,
            varietyId = null,
            varietyName = '',
            methodCategoryId = null,
            methodId = null,
            taskTemplate = null
        }) {
            const tasks = await buildTasksForPlan({
                method,
                plant,
                cell,
                schedule,
                timelines,
                taskTemplate,
                plantId,
                varietyId,
                varietyName,
                methodCategoryId,
                methodId
            });

            return {
                mode: options.taskDispatchMode || "replace",
                tasks,
                plantName: plant.plant_name,
                varietyName: String(varietyName || ''),
                targetGroupId: cell.id
            };
        }

        const graph = ui.editor.graph;
        const model = graph.getModel();
        const attributePatch = buildScheduleAttributePatch(inputs, result, options);
        Object.assign(attributePatch, options.targetAttributePatch || {});
        const attributeSnapshot = snapshotCellAttributes(cell, Object.keys(attributePatch));
        const geometrySnapshot = cell?.getGeometry?.()?.clone?.() || null;
        const extraAttributePatches = (options.extraAttributePatches || []).filter(spec => spec && spec.cell && spec.patch);
        const extraAttributeSnapshots = extraAttributePatches.map(spec => ({
            cell: spec.cell,
            snapshot: snapshotCellAttributes(spec.cell, Object.keys(spec.patch)),
            geometry: spec.cell?.getGeometry?.()?.clone?.() || null
        }));
        const taskReplacement = await buildTaskReplacementForPlan({
            method,
            plant,
            cell,
            schedule,
            timelines,
            plantId: Number(inputs?.plant?.plant_id ?? null),
            varietyId: inputs?.varietyId ?? null,
            varietyName: inputs?.varietyName ?? '',
            methodCategoryId: normId(inputs?.methodCategoryId),
            methodId: normId(inputs?.methodId),
            taskTemplate: options.taskTemplate ?? null
        });
        const applySchedulerTaskReplacement = getSchedulerTaskReplacementCommand();
        if (!applySchedulerTaskReplacement) throw new Error("Cannot save schedule tasks: Task manager command is unavailable.");

        const applyGraphPatch = async () => {
            return runTrellisHistoryTransaction({ category: "Garden scheduling", action: "saveSchedule", origin: "Garden_Scheduler_Dialog", title: "Save schedule and generated tasks", affectedCellIds: [cell && cell.id].filter(Boolean), tags: ["Tasks"] }, function () {
                model.beginUpdate();
                try {
                    applyCellAttributePatch(cell, attributePatch, model);
                    if (options.targetGeometryRect) setCellAbsoluteRect(graph, cell, options.targetGeometryRect, model);
                    extraAttributePatches.forEach(spec => {
                        applyCellAttributePatch(spec.cell, spec.patch, model);
                        if (spec.geometryRect) setCellAbsoluteRect(graph, spec.cell, spec.geometryRect, model);
                    });
                    applySchedulerTaskReplacement(taskReplacement, { insideUpdate: true });
                    const tiler = window.USL && window.USL.tiler ? window.USL.tiler : null;
                    extraAttributePatches.forEach(spec => {
                        if (spec.retile && tiler && typeof tiler.retileGroup === 'function') tiler.retileGroup(graph, spec.cell, { inTransaction: true, preferInPlace: true });
                    });
                    if (options.preserveTargetGeometry) {
                        if (tiler && typeof tiler.retileGroup === 'function') tiler.retileGroup(graph, cell, { inTransaction: true });
                    } else {
                        retileAndFitGroupIfAvailable(graph, cell, { source: 'schedule-save' });
                    }
                } finally {
                    model.endUpdate();
                }
                graph.refresh(cell);
                extraAttributePatches.forEach(spec => graph.refresh(spec.cell));
            });
        };

        const restoreGraphPatch = async () => {
            model.beginUpdate();
            try {
                restoreCellAttributeSnapshot(cell, attributeSnapshot, model);
                if (geometrySnapshot && typeof model.setGeometry === 'function') model.setGeometry(cell, geometrySnapshot);
                extraAttributeSnapshots.forEach(spec => restoreCellAttributeSnapshot(spec.cell, spec.snapshot, model));
                extraAttributeSnapshots.forEach(spec => { if (spec.geometry && typeof model.setGeometry === 'function') model.setGeometry(spec.cell, spec.geometry); });
            } finally {
                model.endUpdate();
            }
            graph.refresh(cell);
            extraAttributeSnapshots.forEach(spec => graph.refresh(spec.cell));
        };

        await runCompensatedSaveSteps({
            applyGraphPatch,
            persist: options.afterGraphUpdate,
            finalizeGraph: async () => {
                if (options.applyCompanionSetDefaults) {
                    await applyScheduleCompanionSetDefaults(graph, cell, options.spacingLayoutBaseline || null, { force: !!options.forceCompanionSetDefaults }); // CHANGE: schedule saves can reapply anchorless companion-set defaults after occupancy changes.
                }
                graph.refresh(cell);
                requestSelectionVisualsRefresh(graph, cell);
            },
            restoreGraphPatch
        });
    }

    function readGraphCellAttribute(cell, key) {
        if (cell && typeof cell.getAttribute === 'function') return cell.getAttribute(key);
        return cell?.value && typeof cell.value.getAttribute === 'function' ? cell.value.getAttribute(key) : null;
    }

    function normalizeLinkedCellIds(value) {
        return Array.from(new Set(String(value == null ? '' : value)
            .split(',')
            .map(id => id.trim())
            .filter(Boolean)));
    }

    function lifecycleRankForPlant(plant) {
        const lifecycle = getCropLifecycle(plant);
        if (lifecycle === 'annual') return 1;
        if (lifecycle === 'biennial') return 2;
        if (lifecycle === 'perennial') return 3;
        return 1;
    }

    function lifecycleEligibleForDerivedCompanion(sourcePlant, candidatePlant) {
        return lifecycleRankForPlant(candidatePlant) <= lifecycleRankForPlant(sourcePlant);
    }

    function sourceOccupancyWindowForDerived(cell, plant = null) {
        const perennial = plant ? isPerennialPlant(plant) : String(cell?.getAttribute?.('lifespan_start') || '').trim();
        const startISO = perennial
            ? String(cell?.getAttribute?.('lifespan_start') || '').trim()
            : (String(cell?.getAttribute?.('transplant_date') || '').trim() || String(cell?.getAttribute?.('sow_date') || '').trim());
        const endISO = perennial
            ? String(cell?.getAttribute?.('lifespan_end') || '').trim()
            : String(cell?.getAttribute?.('harvest_end') || '').trim();
        const start = parseISODateUTCValue(startISO);
        const end = parseISODateUTCValue(endISO);
        if (!start || !end || end < start) return null;
        return { startISO, endISO, start, end };
    }

    function shiftISODate(iso, days) {
        const date = parseISODateUTCValue(iso);
        if (!date) return '';
        date.setUTCDate(date.getUTCDate() + Math.trunc(Number(days) || 0));
        return fmtISO(date);
    }

    function derivedOccupancyStartISO(result) {
        if (result?.kind === 'perennial') return String(result.lifespanStartISO || '');
        const first = Array.isArray(result?.timelines) ? result.timelines[0] : null;
        return fmtISO(first?.transplant) || fmtISO(first?.sow);
    }

    function derivedOccupancyEndISO(result) {
        if (result?.kind === 'perennial') return String(result.lifespanEndISO || '');
        const first = Array.isArray(result?.timelines) ? result.timelines[0] : null;
        return fmtISO(first?.harvestEnd);
    }

    function daysDeltaISO(fromISO, toISO) {
        const from = parseISODateUTCValue(fromISO);
        const to = parseISODateUTCValue(toISO);
        if (!from || !to) return null;
        return Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
    }

    function isoRangesOverlap(leftStartISO, leftEndISO, rightStartISO, rightEndISO) {
        const leftStart = parseISODateUTCValue(leftStartISO);
        const leftEnd = parseISODateUTCValue(leftEndISO);
        const rightStart = parseISODateUTCValue(rightStartISO);
        const rightEnd = parseISODateUTCValue(rightEndISO);
        return !!(leftStart && leftEnd && rightStart && rightEnd && leftStart <= rightEnd && rightStart <= leftEnd);
    }

    function minISODate(leftISO, rightISO) {
        const left = parseISODateUTCValue(leftISO);
        const right = parseISODateUTCValue(rightISO);
        if (!left) return rightISO || '';
        if (!right) return leftISO || '';
        return left <= right ? leftISO : rightISO;
    }

    function maxISODate(leftISO, rightISO) {
        const left = parseISODateUTCValue(leftISO);
        const right = parseISODateUTCValue(rightISO);
        if (!left) return rightISO || '';
        if (!right) return leftISO || '';
        return left >= right ? leftISO : rightISO;
    }

    function schedulerGapLabelParts(item) {
        const rawLabel = String(item?.label || item?.cellId || 'Planting').trim();
        const explicitCrop = String(item?.cropName || item?.plantName || item?.crop_name || item?.plant_name || '').trim();
        const explicitVariety = String(item?.varietyName || item?.variety || item?.variety_name || '').trim();
        if (explicitCrop) return { cropName: explicitCrop, varietyName: explicitVariety };
        const parts = rawLabel.split(/\s+-\s+/);
        return { cropName: String(parts[0] || rawLabel || 'Planting').trim(), varietyName: explicitVariety || String(parts.slice(1).join(' - ') || '').trim() }; // CHANGE: tolerate legacy labels that already combine crop and variety.
    }

    function normalizeSchedulerGapItem(item) {
        const startISO = String(item?.startISO || '').trim();
        const endISO = String(item?.endISO || '').trim();
        const start = parseISODateUTCValue(startISO);
        const end = parseISODateUTCValue(endISO);
        if (!start || !end) return null;
        const labelParts = schedulerGapLabelParts(item); // CHANGE: keep inline relationship labels crop-first while preserving variety for duplicate names.
        return {
            cellId: String(item?.cellId || '').trim(),
            label: String(item?.label || item?.cellId || 'Planting').trim(),
            cropName: labelParts.cropName,
            varietyName: labelParts.varietyName,
            startISO,
            endISO,
            start,
            end
        };
    }

    function schedulerGapDisplayLabels(items) {
        const counts = new Map();
        (items || []).forEach(item => {
            const key = String(item?.cropName || item?.label || 'Planting').trim().toLowerCase();
            counts.set(key, (counts.get(key) || 0) + 1);
        });
        const labels = new Map();
        (items || []).forEach(item => {
            const crop = String(item?.cropName || item?.label || 'Planting').trim();
            const key = crop.toLowerCase();
            const variety = String(item?.varietyName || '').trim();
            labels.set(item, counts.get(key) > 1 && variety ? `${crop} - ${variety}` : crop); // CHANGE: use variety only when crop-only inline labels would collide.
        });
        return labels;
    }

    function schedulerGapDaysLabel(deltaDays) {
        const delta = Number(deltaDays);
        if (!Number.isFinite(delta)) return '';
        if (delta === 0) return 'same day';
        return `${Math.abs(delta)}d`;
    }

    function schedulerOverlapStartLabel(adjacent, currentWindow, displayLabel) {
        const delta = daysDeltaISO(adjacent?.startISO, currentWindow?.startISO);
        const days = schedulerGapDaysLabel(delta);
        if (!days) return '';
        if (delta === 0) return `Starts same day as ${displayLabel}`;
        return `Starts ${days} ${delta > 0 ? 'after' : 'before'} ${displayLabel}`; // CHANGE: overlapping occupancy reports start-date delta, not overlap length.
    }

    function schedulerNonOverlapGapLabel(side, adjacent, currentWindow, displayLabel) {
        const delta = side === 'before'
            ? daysDeltaISO(adjacent?.endISO, currentWindow?.startISO)
            : daysDeltaISO(currentWindow?.endISO, adjacent?.startISO);
        const days = schedulerGapDaysLabel(delta);
        if (!days) return '';
        return side === 'before' ? `${days} gap after ${displayLabel}` : `${days} gap before ${displayLabel}`; // CHANGE: non-overlap text is neighbor-relative for quick scanning.
    }

    function schedulerRelationshipTooltip(label, adjacent, currentWindow, kind) {
        const range = adjacent?.startISO && adjacent?.endISO ? `${adjacent.startISO} to ${adjacent.endISO}` : '';
        const basis = currentWindow?.startISO && currentWindow?.endISO ? `${currentWindow.startISO} to ${currentWindow.endISO}` : '';
        return [label, range ? `${adjacent?.label || 'Planting'}: ${range}` : '', basis ? `Candidate: ${basis}` : '', kind ? `Relation: ${kind}` : ''].filter(Boolean).join('\n'); // CHANGE: inline text stays complete; tooltip keeps exact dates for verification.
    }

    function schedulerNearestOverlapHints(overlaps, currentWindow, maxCount) {
        return (overlaps || [])
            .slice()
            .sort((a, b) => {
                const startDelta = Math.abs(daysDeltaISO(a.startISO, currentWindow.startISO) ?? Infinity) - Math.abs(daysDeltaISO(b.startISO, currentWindow.startISO) ?? Infinity);
                if (startDelta !== 0) return startDelta;
                const startOrder = a.start - b.start;
                if (startOrder !== 0) return startOrder;
                return String(a.label || '').localeCompare(String(b.label || ''));
            })
            .slice(0, Math.max(0, Math.trunc(Number(maxCount) || 0))); // CHANGE: cap dense overlaps so the start row remains readable.
    }

    function schedulerAdjacentNonOverlapHints(items, currentWindow) {
        const before = (items || [])
            .filter(item => item.end < currentWindow.start)
            .sort((a, b) => b.end - a.end)[0] || null;
        const after = (items || [])
            .filter(item => item.start > currentWindow.end)
            .sort((a, b) => a.start - b.start)[0] || null;
        return { before, after }; // CHANGE: adjacency ignores overlapping occupancy; overlaps are handled as start deltas.
    }

    function schedulerRelationshipHintForItem(kind, side, item, currentWindow, displayLabel) {
        const text = kind === 'overlap'
            ? schedulerOverlapStartLabel(item, currentWindow, displayLabel)
            : schedulerNonOverlapGapLabel(side, item, currentWindow, displayLabel);
        return text ? {
            item,
            side,
            kind,
            text,
            tooltip: schedulerRelationshipTooltip(text, item, currentWindow, kind)
        } : null;
    }

    function computeSchedulerAdjacentGapHints(items, currentWindow, options = {}) {
        const currentStart = parseISODateUTCValue(currentWindow?.startISO);
        const currentEnd = parseISODateUTCValue(currentWindow?.endISO);
        if (!currentStart || !currentEnd || currentEnd < currentStart) return { before: null, after: null, overlaps: [], text: '', tooltip: '' };
        const excludeIds = new Set((options.excludeCellIds || []).map(id => String(id || '').trim()).filter(Boolean));
        const normalized = (items || [])
            .map(normalizeSchedulerGapItem)
            .filter(item => item && !excludeIds.has(item.cellId));
        const windowWithDates = Object.assign({}, currentWindow, { start: currentStart, end: currentEnd });
        const overlaps = normalized.filter(item => item.start <= currentEnd && currentStart <= item.end);
        const maxOverlapHints = Math.max(1, Math.trunc(Number(options.maxOverlapHints) || 2));
        const selectedOverlaps = schedulerNearestOverlapHints(overlaps, windowWithDates, maxOverlapHints);
        const adjacent = schedulerAdjacentNonOverlapHints(normalized, windowWithDates);
        const displayedItems = selectedOverlaps.length ? selectedOverlaps : [adjacent.before, adjacent.after].filter(Boolean);
        const labels = schedulerGapDisplayLabels(displayedItems);
        const overlapHints = selectedOverlaps
            .map(item => schedulerRelationshipHintForItem('overlap', null, item, currentWindow, labels.get(item) || item.cropName || item.label))
            .filter(Boolean);
        const beforeHint = !overlapHints.length && adjacent.before
            ? schedulerRelationshipHintForItem('gap', 'before', adjacent.before, currentWindow, labels.get(adjacent.before) || adjacent.before.cropName || adjacent.before.label)
            : null;
        const afterHint = !overlapHints.length && adjacent.after
            ? schedulerRelationshipHintForItem('gap', 'after', adjacent.after, currentWindow, labels.get(adjacent.after) || adjacent.after.cropName || adjacent.after.label)
            : null;
        const overflow = overlaps.length > selectedOverlaps.length ? `+${overlaps.length - selectedOverlaps.length} more` : '';
        const text = overlapHints.length
            ? overlapHints.map(hint => hint.text).concat(overflow ? [overflow] : []).join('; ')
            : [beforeHint?.text, afterHint?.text].filter(Boolean).join('; ');
        const basis = options.basisLabel ? `Basis: ${options.basisLabel} (${currentWindow.startISO} to ${currentWindow.endISO}).` : '';
        const tooltip = [basis].concat(overlapHints.map(hint => hint.tooltip), beforeHint?.tooltip, afterHint?.tooltip).filter(Boolean).join('\n\n');
        return { before: beforeHint, after: afterHint, overlaps: overlapHints, text, tooltip }; // CHANGE: keep legacy before/after fields while adding overlap-specific hints.
    }

    function getBedOccupancyItemsForDerived(sourceCell, graph) {
        const api = graph?.__trellisBedSuccessionNavigator;
        if (api && typeof api.getSelectedBedOccupancy === 'function') {
            const result = api.getSelectedBedOccupancy(sourceCell);
            if (result && Array.isArray(result.items)) return result.items;
        } // CHANGE: turnover capacity is bed-contained and must not count overhanging cluster members.
        if (api && typeof api.getSelectedClusterOccupancy === 'function') {
            const result = api.getSelectedClusterOccupancy(sourceCell);
            if (result && Array.isArray(result.items)) return result.items;
        } // CHANGE: legacy fallback preserves behavior when the navigator has not exposed the bed-only API yet.
        const sourceWindow = sourceOccupancyWindowForDerived(sourceCell, null);
        return sourceWindow ? [{ cellId: sourceCell?.id || '', startISO: sourceWindow.startISO, endISO: sourceWindow.endISO }] : [];
    }

    function turnoverComputedWindowFitsSourceCluster(sourceCell, computedWindow, graph) {
        if (!computedWindow?.startISO || !computedWindow?.endISO) return false;
        const sourceId = String(sourceCell?.id || '');
        return !getBedOccupancyItemsForDerived(sourceCell, graph).some(item => {
            if (String(item?.cellId || '') === sourceId) return false;
            return isoRangesOverlap(computedWindow.startISO, computedWindow.endISO, item?.startISO, item?.endISO);
        });
    }

    async function computeAnnualTurnoverWindowForCandidate(sourceCell, candidatePlant, defaultPrimaryStartISO, context = {}) {
        if (!candidatePlant?.isAnnual?.() || !defaultPrimaryStartISO || !context.city) return null;
        try {
            const city = context.city;
            const cityName = String(city.city_name || context.cityName || '');
            const year = Math.trunc(Number(context.year || parseISODateUTCValue(defaultPrimaryStartISO)?.getUTCFullYear()));
            if (!Number.isFinite(year)) return null;
            const methodSelection = await resolveInitialMethodSelection(sourceCell, candidatePlant);
            const transplantOverride = normalizeTransplantDays(readCellTransplantDaysOverride(sourceCell));
            const transplantConfig = resolveTransplantDaysConfig(candidatePlant, {
                methodId: methodSelection.methodId,
                overrideEnabled: transplantOverride != null,
                overrideValue: transplantOverride
            });
            requireEffectiveTransplantDays(methodSelection.methodId, transplantConfig.effectiveDays);
            const effectivePlant = applyEffectiveTransplantDaysToPlant(candidatePlant, transplantConfig.effectiveDays);
            const scanStart = asUTCDate(year, 1, 1);
            const scanEndHard = asUTCDate(annualSchedulerScanEndYear(effectivePlant, year), 12, 31);
            const climateResolution = resolveClimateModelPolicy(context.moduleCell, cityName, effectivePlant.plant_id, null);
            const dailyClimate = await city.loadDailyClimateModel({ scanStart, scanEndHard, climatePolicy: climateResolution.effective });
            const startISO = sowDateFromPrimaryDate(defaultPrimaryStartISO, methodSelection.methodId, transplantConfig.effectiveDays);
            const inputs = new sharedCore.ScheduleInputs({
                plant: effectivePlant,
                city,
                planningMode: methodSelection.resolvedBehavior.planningMode,
                methodCategoryId: methodSelection.methodCategoryId,
                methodId: methodSelection.methodId,
                startISO,
                seasonEndISO: fmtISO(scanEndHard),
                policy: PolicyFlags.fromResolvedBehavior(effectivePlant, methodSelection.resolvedBehavior, climateResolution.effective),
                seasonStartYear: year,
                harvestWindowDays: resolveHarvestWindowDays(null, effectivePlant),
                bedProfile: context.bedProfile || normalizeBedProfile(null),
                bedProfileSource: context.bedProfileSource || 'generic garden bed',
                dailyClimate
            });
            const result = computeScheduleResult(inputs);
            const occupancyStartISO = derivedOccupancyStartISO(result);
            const occupancyEndISO = derivedOccupancyEndISO(result);
            return occupancyStartISO && occupancyEndISO ? { startISO: occupancyStartISO, endISO: occupancyEndISO, result } : null;
        } catch (_) {
            return null;
        }
    }

    async function turnoverCandidateFitsSourceCluster(sourceCell, candidatePlant, defaultPrimaryStartISO, context = {}) {
        const graph = context?.graph || context;
        const computedWindow = await computeAnnualTurnoverWindowForCandidate(sourceCell, candidatePlant, defaultPrimaryStartISO, context);
        return turnoverComputedWindowFitsSourceCluster(sourceCell, computedWindow, graph);
    }

    function getTilerSiblingCreator(graph) {
        const tiler = window.USL && window.USL.tiler ? window.USL.tiler : null;
        return tiler && typeof tiler.createSiblingTilerGroupFromSource === 'function' ? tiler.createSiblingTilerGroupFromSource : null;
    }

    function removeDerivedSiblingIfPresent(graph, cell) {
        if (!graph || !cell) return;
        try { graph.removeCells([cell]); } catch (_) { }
    }

    function buildDerivedRelationshipPatch(sourceCell, targetPlant, result, derivedContext) {
        if (!sourceCell || !derivedContext) return {};
        const mode = String(derivedContext.mode || '').trim();
        if (mode === 'companion') {
            const relationship = derivedContext.relationshipByPlantId?.get?.(String(targetPlant?.plant_id)) || null;
            const layout = resolveCompanionLayout(sourceCell, targetPlant, relationship, derivedContext.layoutDraft || {});
            return plantingLayoutAttributePatch(layout); // CHANGE: guided companion creation persists as a normal planting, not a derived relationship.
        }
        const patch = {
            derived_mode: mode,
            derived_source_group_id: String(sourceCell.id || ''),
            derived_source_plant_id: String(sourceCell.getAttribute?.('plant_id') || ''),
            derived_target_plant_id: String(targetPlant?.plant_id || '')
        };
        const sourceWindow = derivedContext.sourceOccupancy || sourceOccupancyWindowForDerived(sourceCell, derivedContext.sourcePlant);
        const targetStartISO = derivedOccupancyStartISO(result);
        if (mode === 'turnover') {
            const gap = sourceWindow ? daysDeltaISO(sourceWindow.endISO, targetStartISO) : null;
            patch.turnover_gap_days = gap == null ? '' : String(gap);
        }
        return patch;
    }

    async function prepareDerivedScheduleContext(mode, sourceCell, sourcePlant, allPlants, context = {}) {
        const normalizedMode = String(mode || '').trim().toLowerCase();
        const graph = context?.graph || context;
        if (normalizedMode !== 'companion' && normalizedMode !== 'turnover') throw new Error('Unknown derived schedule mode.');
        const sourceOccupancy = sourceOccupancyWindowForDerived(sourceCell, sourcePlant);
        if (!sourceOccupancy) throw new Error('Derived scheduling requires complete source occupancy dates.');
        const sourcePlantId = Number(sourcePlant?.plant_id ?? sourceCell?.getAttribute?.('plant_id'));
        const sourceRank = lifecycleRankForPlant(sourcePlant);
        const all = (allPlants || []).filter(plant => Number(plant?.plant_id) !== sourcePlantId);
        const metadataByPlantId = new Map();
        const relationshipByPlantId = new Map();
        let candidatePlants = [];
        let defaultPrimaryStartISO = sourceOccupancy.startISO;
        let initialRecommendedStartOffsetDays = 0;
        if (normalizedMode === 'companion') {
            const relationships = await CompanionRelationshipModel.listForSourcePlant(sourcePlantId);
            relationships.forEach(rel => relationshipByPlantId.set(String(rel.companionPlantId), rel));
            const known = all.filter(plant => relationshipByPlantId.has(String(plant?.plant_id)) && lifecycleEligibleForDerivedCompanion(sourcePlant, plant));
            candidatePlants = known.length ? known : all.filter(plant => lifecycleEligibleForDerivedCompanion(sourcePlant, plant));
            candidatePlants.forEach(plant => {
                const key = String(plant?.plant_id);
                const rel = relationshipByPlantId.get(key);
                if (!rel) relationshipByPlantId.set(key, buildGraphCreatedCompanionRelationship(sourcePlant, plant, { known: false }));
                metadataByPlantId.set(key, rel ? Object.assign({ known: true }, rel) : { known: false, recommendedStartOffsetDays: 0, rating: null, evidence: [] });
            });
            const firstRel = candidatePlants.length ? relationshipByPlantId.get(String(candidatePlants[0]?.plant_id)) : null;
            initialRecommendedStartOffsetDays = Number(firstRel?.recommendedStartOffsetDays ?? 0);
            defaultPrimaryStartISO = shiftISODate(sourceOccupancy.startISO, initialRecommendedStartOffsetDays);
        } else {
            if (!sourcePlant?.isAnnual?.()) throw new Error('Turnover scheduling is available only for annual source groups.');
            defaultPrimaryStartISO = shiftISODate(sourceOccupancy.endISO, 1);
            const annualCandidates = all.filter(plant => plant?.isAnnual?.());
            for (const plant of annualCandidates) {
                if (await turnoverCandidateFitsSourceCluster(sourceCell, plant, defaultPrimaryStartISO, Object.assign({}, context, { graph }))) candidatePlants.push(plant);
            }
        }
        return {
            operation: 'create',
            mode: normalizedMode,
            sourceCell,
            sourcePlant,
            sourceOccupancy,
            sourceRank,
            candidatePlants,
            metadataByPlantId,
            relationshipByPlantId,
            defaultPrimaryStartISO,
            initialRecommendedStartOffsetDays
        };
    }

    async function resolveExistingDerivedScheduleContext(cell, selectedPlant, allPlants, context = {}) {
        const graph = context?.graph || context;
        const model = graph && typeof graph.getModel === 'function' ? graph.getModel() : null;
        const mode = String(cell?.getAttribute?.('derived_mode') || '').trim().toLowerCase();
        if (mode !== 'companion') return null;
        const sourceId = String(cell?.getAttribute?.('derived_source_group_id') || '').trim();
        if (!sourceId || !model || typeof model.getCell !== 'function') return null;
        const sourceCell = model.getCell(sourceId);
        if (!sourceCell || !isTilerGroup(sourceCell)) return null;
        const sourcePlantId = finiteNumberOrNull(sourceCell.getAttribute?.('plant_id'));
        const sourcePlantName = String(sourceCell.getAttribute?.('plant_name') || '').trim();
        let sourcePlant = sourcePlantId != null ? await PlantModel.loadById(sourcePlantId) : null;
        if (!sourcePlant && sourcePlantName) sourcePlant = await PlantModel.loadByName(sourcePlantName);
        if (!sourcePlant) return null;
        const derived = await prepareDerivedScheduleContext('companion', sourceCell, sourcePlant, allPlants, context);
        const targetPlantId = String(selectedPlant?.plant_id || cell?.getAttribute?.('plant_id') || '').trim();
        if (selectedPlant && targetPlantId && !derived.candidatePlants.some(plant => String(plant?.plant_id) === targetPlantId)) {
            derived.candidatePlants.unshift(selectedPlant);
            if (!derived.metadataByPlantId.has(targetPlantId)) {
                const rel = derived.relationshipByPlantId.get(targetPlantId);
                derived.metadataByPlantId.set(targetPlantId, rel ? Object.assign({ known: true }, rel) : { known: false, recommendedStartOffsetDays: 0, rating: null, evidence: [] });
            }
        }
        if (selectedPlant && targetPlantId && !finiteNumberOrNull(derived.relationshipByPlantId.get(targetPlantId)?.relationId)) {
            const graphRelationship = buildGraphCreatedCompanionRelationship(sourcePlant, selectedPlant, {
                startOffsetDays: finiteNumberOrNull(cell.getAttribute?.('companion_start_offset_days')) ?? 0,
                layoutTemplate: cell.getAttribute?.('companion_layout_template') || '',
                layoutSpacingXCm: finiteNumberOrNull(cell.getAttribute?.('companion_layout_spacing_x_cm')),
                layoutSpacingYCm: finiteNumberOrNull(cell.getAttribute?.('companion_layout_spacing_y_cm')),
                layoutOffsetXCm: finiteNumberOrNull(cell.getAttribute?.('companion_offset_x_cm')),
                layoutOffsetYCm: finiteNumberOrNull(cell.getAttribute?.('companion_offset_y_cm')),
                known: false
            });
            if (graphRelationship) derived.relationshipByPlantId.set(targetPlantId, graphRelationship);
        }
        derived.operation = 'edit';
        derived.targetCell = cell;
        derived.defaultPrimaryStartISO = '';
        return derived;
    }

    function showDerivedScheduleEmptyState(ui, mode, message) {
        const root = document.createElement('div');
        root.style.padding = '18px';
        root.style.maxWidth = '420px';
        const title = document.createElement('div');
        title.textContent = mode === 'turnover' ? 'No turnover crops fit' : 'No companion crops available';
        title.style.fontSize = '16px';
        title.style.fontWeight = '700';
        title.style.marginBottom = '8px';
        const body = document.createElement('div');
        body.textContent = message;
        body.style.fontSize = '13px';
        body.style.lineHeight = '1.4';
        body.style.color = '#374151';
        const actions = document.createElement('div');
        actions.style.textAlign = 'right';
        actions.style.marginTop = '16px';
        const closeBtn = mxUtils.button('Close', () => ui.hideDialog());
        applySharedButtonStyle(closeBtn, 'close'); // CHANGE
        actions.appendChild(closeBtn);
        root.appendChild(title);
        root.appendChild(body);
        root.appendChild(actions);
        ui.showDialog(root, 430, 160, true, true);
        elevateTrellisDialog(ui);
    }




    // -------------------- Orchestrator: open schedule dialog --------------------------------
    async function openScheduleDialog(ui, cell, openOptions = {}) {
        requireCanSchedulePlantingGroup(cell);
        // 1) Load reference data
        const plants = await PlantModel.listBasic();
        const cities = await CityClimate.loadAll();
        if (!cities.length) throw new Error('Cities not available');
        const graph = ui?.editor?.graph;
        const model = graph && typeof graph.getModel === 'function' ? graph.getModel() : null;
        const climateModelModuleCell = model ? findGardenModuleAncestor(model, cell) : null;

        // 2) Selected plant: prefer the stable ID and retain name lookup for legacy cells
        const plantIdAttr = finiteNumberOrNull(cell && cell.getAttribute && cell.getAttribute('plant_id')); // FIX: read the stable persisted identity
        const plantNameAttr = cell && cell.getAttribute && cell.getAttribute('plant_name');
        let selectedPlant = null;
        if (plantIdAttr != null) {
            selectedPlant = await PlantModel.loadById(plantIdAttr); // FIX: plant renames no longer orphan saved schedules
        }
        if (!selectedPlant && plantNameAttr) {
            selectedPlant = await PlantModel.loadByName(plantNameAttr);
        }
        if (!selectedPlant) {
            if (plantIdAttr != null || plantNameAttr) {
                throw new Error(`Plant not found: ${plantIdAttr ?? plantNameAttr}`); // FIX: report the persisted identity that failed
            }
            if (!plants.length) throw new Error('No plants available');
            selectedPlant = plants[0];
        }
        let dialogPlants = plants;
        let derivedContext = null;
        const sourcePlantForDerived = selectedPlant;

        // 3) Initial city & method
        const now = new Date();
        const currentYear = now.getFullYear();
        const todayISO = localTodayISO(now);
        const todayUTC = parseISODateUTCValue(todayISO);
        const storedSowDate = parseISODateUTCValue(cell?.getAttribute?.('sow_date'));
        const storedHarvestEndDate = parseISODateUTCValue(cell?.getAttribute?.('harvest_end'));
        const storedSeasonYear = finiteNumberOrNull(cell?.getAttribute?.('season_start_year'));
        const initialTransplantDaysOverrideValue = readCellTransplantDaysOverride(cell);
        const scheduleBedContext = resolveScheduleBedContext(cell); // ADDED: resolve bed conditions once for scheduler soil modeling.
        const year = storedSeasonYear != null && storedSeasonYear >= 1900 && storedSeasonYear <= 3000
            ? Math.trunc(storedSeasonYear)
            : (storedSowDate ? storedSowDate.getUTCFullYear() : currentYear);
        const hasPersistedSchedule = storedSowDate != null;
        const groupCityId = finiteNumberOrNull(cell?.getAttribute?.('city_id')) ?? finiteNumberOrNull(climateModelModuleCell?.getAttribute?.('city_id'));
        const groupCityName = (cell && cell.getAttribute && cell.getAttribute('city_name')) || climateModelModuleCell?.getAttribute?.('city_name') || null;
        const idMatch = cities.find(city => groupCityId != null && Number(city.city_id) === Number(groupCityId));
        const nameMatches = groupCityName ? cities.filter(city => String(city.city_name || '') === String(groupCityName)) : [];
        if (!idMatch && groupCityName && nameMatches.length > 1) throw new Error(`City name is ambiguous; select a city in Garden Settings: ${groupCityName}`);
        const initialCityRow = idMatch
            || (nameMatches.length === 1 ? nameMatches[0] : null); // CHANGED: old city_name backfill is safe only when the name is unique.
        const initialCityId = finiteNumberOrNull(initialCityRow?.city_id) ?? groupCityId;
        const initialCityName = initialCityRow?.city_name || groupCityName || '';
        if (initialCityId == null && !initialCityName) throw new Error('Scheduler city is not set. Select a city in Garden Settings before scheduling.');

        const cityInit = await CityClimate.resolveUniqueNameFallback({ cityId: initialCityId, cityName: initialCityName });
        if (!cityInit) throw new Error(`City not found: ${initialCityName}`);
        if (!openOptions?.derivedMode && model && cell && cityInit.city_id != null) {
            model.beginUpdate();
            try {
                setAttr(cell, 'city_id', String(cityInit.city_id));
                setAttr(cell, 'city_name', String(cityInit.city_name || initialCityName));
            } finally {
                model.endUpdate();
            }
        }

        if (openOptions?.derivedMode) {
            derivedContext = await prepareDerivedScheduleContext(openOptions.derivedMode, cell, sourcePlantForDerived, plants, {
                graph,
                city: cityInit,
                cityName: initialCityName,
                year,
                moduleCell: climateModelModuleCell,
                bedProfile: scheduleBedContext.profile,
                bedProfileSource: scheduleBedContext.source
            });
            dialogPlants = derivedContext.candidatePlants;
            if (!dialogPlants.length) {
                showDerivedScheduleEmptyState(ui, openOptions.derivedMode, openOptions.derivedMode === 'turnover' ? 'No annual crops have enough same-footprint capacity from the source harvest through their projected harvest end.' : 'No lifecycle-eligible companion crops are available for this source.');
                return;
            }
            selectedPlant = dialogPlants[0];
        }
        else {
            derivedContext = null; // CHANGE: legacy companion cells edit as ordinary plantings; old metadata remains inert.
        }

        const initialMethodSelection = await resolveInitialMethodSelection(cell, selectedPlant);
        const initialMethodCategoryId = initialMethodSelection.methodCategoryId;
        const initialMethodId = initialMethodSelection.methodId;
        const initialResolvedBehavior = initialMethodSelection.resolvedBehavior;
        const initialTransplantDaysConfig = resolveTransplantDaysConfig(selectedPlant, {
            methodId: initialMethodId,
            overrideEnabled: initialTransplantDaysOverrideValue != null,
            overrideValue: initialTransplantDaysOverrideValue
        });
        const selectedPlantForSchedule = applyEffectiveTransplantDaysToPlant(selectedPlant, initialTransplantDaysConfig.effectiveDays);
        const initialClimateResolution = resolveClimateModelPolicy(climateModelModuleCell, initialCityName, selectedPlantForSchedule.plant_id, null);
        const initialClimatePolicy = initialClimateResolution.effective;

        const selectedIsPerennial = isPerennialPlant(selectedPlantForSchedule);
        const perennialLifespanYears = selectedIsPerennial
            ? requirePerennialLifespanYears(selectedPlantForSchedule)
            : null;
        const budget = selectedIsPerennial ? null : selectedPlantForSchedule.firstHarvestBudget();

        // --- compute initial auto anchors safely ---
        const overwinterAllowed0 = isCrossYearCrop(selectedPlantForSchedule);
        const scanStart = asUTCDate(year, 1, 1);
        const scanEndHard = asUTCDate(annualSchedulerScanEndYear(selectedPlantForSchedule, year), 12, 31);


        const HW_DAYS = resolveHarvestWindowDays(null, selectedPlantForSchedule);

        let initialWindowFeasible = selectedIsPerennial;
        let earliestFeasibleSowDate = selectedIsPerennial
            ? new Date(storedSowDate || scanStart)
            : null;
        let climateEndDate = selectedIsPerennial
            ? parseISODateUTCValue(computePerennialLifespanEndISO(
                fmtISO(storedSowDate || scanStart),
                year,
                perennialLifespanYears
            ))
            : null;
        let latestHarvestEndDate = selectedIsPerennial ? climateEndDate : null;
        let selectedHarvestEndDate = selectedIsPerennial ? climateEndDate : null;
        let initialDailyClimate = null;
        let initialSowingSeasons = [];

        if (!selectedIsPerennial && Number.isFinite(HW_DAYS)) {
            requireEffectiveTransplantDays(initialMethodId, initialTransplantDaysConfig.effectiveDays);
            const env = selectedPlantForSchedule.cropTempEnvelope();
            const dailyClimate = await cityInit.loadDailyClimateModel({ scanStart, scanEndHard, climatePolicy: initialClimatePolicy });
            initialDailyClimate = dailyClimate;
            const dailyRates = cityInit.dailyRates(env.Tbase, year, initialClimatePolicy);
            const monthlyAvgTemp = cityInit.monthlyMeans(); // CHANGED: physical temperatures stay unshifted; GDD scaling is in daily climate rates.
            const initialWindow = annualCore.computeAnnualSowingSeasons({
                methodCategoryId: initialMethodCategoryId,
                methodId: initialMethodId,
                budget: budget,
                HW_DAYS: HW_DAYS,
                dailyRatesMap: dailyRates,
                monthlyAvgTemp: monthlyAvgTemp,
                dailyClimate: dailyClimate,
                Tbase: env.Tbase,
                cropTemp: env,
                scanStart,
                scanEndHard,
                soilGateThresholdC: finiteNumberOrNull(selectedPlantForSchedule.soil_temp_min_plant_c),
                soilGateConsecutiveDays: initialClimatePolicy.soilGateConsecutiveDays,
                startCoolingThresholdC: asCoolingThresholdC(selectedPlantForSchedule.start_cooling_threshold_c),
                useSpringFrostGate: true, // FIX: keep spring frost checks for overwinter-capable plants
                lastSpringFrostDOY: pickFrostByRisk(cityInit, initialClimatePolicy.springFrostRisk),
                daysTransplant: initialTransplantDaysConfig.effectiveDays,
                overwinterAllowed: overwinterAllowed0,
                plantMetadata: selectedPlantForSchedule,
                cityLatitudeDeg: finiteNumberOrNull(cityInit.latitude ?? cityInit.lat),
                bedProfile: scheduleBedContext.profile,
                bedProfileSource: scheduleBedContext.source
            });

            initialWindowFeasible = initialWindow.feasible === true;
            initialSowingSeasons = Array.isArray(initialWindow.seasons) ? Array.from(initialWindow.seasons) : [];
            earliestFeasibleSowDate = initialWindow.seasons?.[0]?.startDate || initialWindow.earliestFeasibleSowDate;
            climateEndDate = initialWindow.climateEndDate;
            latestHarvestEndDate = initialWindow.climateEndDate; // FIX: initialize the annual latest-harvest display from the feasible window
            selectedHarvestEndDate = initialWindow.climateEndDate;
        }

        // no stray reassignments like: earliestFeasibleSowDate = a; selectedHarvestEndDate = b;  <-- remove these

        let previewStart = resolveInitialPreviewStartForScheduleDialog({
            storedSowDate,
            earliestFeasibleSowDate,
            selectedIsPerennial,
            initialWindowFeasible,
            sowingSeasons: initialSowingSeasons,
            todayISO,
            methodId: initialMethodId,
            effectiveTransplantDays: initialTransplantDaysConfig.effectiveDays
        });
        if (!selectedIsPerennial && storedHarvestEndDate) {
            selectedHarvestEndDate = storedHarvestEndDate;
        }
        let startNote = initialWindowFeasible || selectedIsPerennial ? '' : 'No feasible window.';

        // If we have a finite harvest window, we can run feasibility tweaks.
        // (For perennials / null HW_DAYS we skip this step but still open the dialog.)
        if (!selectedIsPerennial && initialWindowFeasible && Number.isFinite(HW_DAYS) && !hasPersistedSchedule && !initialSowingSeasons.length) {
            const inputs0 = new sharedCore.ScheduleInputs({
                plant: selectedPlantForSchedule,
                city: cityInit,
                planningMode: initialResolvedBehavior.planningMode,
                methodCategoryId: initialMethodCategoryId,
                methodId: initialMethodId,
                startISO: earliestFeasibleSowDate.toISOString().slice(0, 10),
                seasonEndISO: fmtISO(scanEndHard), // FIX: initial annual feasibility checks use lifecycle end, not latest harvest display.
                policy: PolicyFlags.fromResolvedBehavior(selectedPlantForSchedule, initialResolvedBehavior, initialClimatePolicy),
                seasonStartYear: year,
                harvestWindowDays: HW_DAYS,
                bedProfile: scheduleBedContext.profile,
                bedProfileSource: scheduleBedContext.source,
                dailyClimate: initialDailyClimate
            });

            const planner0 = new annualCore.Planner(inputs0);
            const feasToday = planner0.isSowFeasible(todayUTC);
            const feasStart = planner0.isSowFeasible(previewStart);

            if (dateLTE(previewStart, addDaysUTC(todayUTC, -1))) {
                if (feasToday.ok) {
                    startNote = `Start date was before today; set to today (${todayUTC.toISOString().slice(0, 10)}).`;
                    previewStart = todayUTC;
                } else {
                    const nxt = planner0.findNextFeasible(todayUTC, 366);
                    if (nxt.date) {
                        startNote = `Start date was before today; advanced to next valid date (${nxt.date.toISOString().slice(0, 10)}).`;
                        previewStart = nxt.date;
                    } else {
                        startNote = `No valid start date remains this season.`;
                    }
                }
            }
        }

        // Always open the dialog (even when HW_DAYS is null/perennial)
        await buildScheduleDialog(ui, cell, dialogPlants, cities, async (_form) => { /* handled inside builder */ }, {
            selectedPlant,
            earliestFeasibleSowDate: previewStart,
            lastHarvestDate: selectedHarvestEndDate, // CHANGED: retained for older builder call sites.
            latestHarvestEndDate,
            selectedHarvestEndDate,
            startNote,
            initialCityId,
            initialCityName,
            hasPersistedSchedule,
            initialWindowFeasible,
            bedProfile: scheduleBedContext.profile,
            bedProfileSource: scheduleBedContext.source,
            dailyClimate: initialDailyClimate,
            dailyClimateKey: initialDailyClimate ? `${cityInit.city_name || initialCityName}|${fmtISO(scanStart)}|${fmtISO(scanEndHard)}|${JSON.stringify(initialClimatePolicy)}` : '',
            initialTransplantDaysOverrideValue,
            derivedContext
        });
    }

    async function openDerivedScheduleDialog(ui, sourceCell, options = {}) {
        const mode = String(options?.mode || '').trim().toLowerCase();
        if (mode !== 'companion' && mode !== 'turnover') throw new Error('Derived scheduler mode must be companion or turnover.');
        return openScheduleDialog(ui, sourceCell, { derivedMode: mode });
    }



















































    const USL_DEBUG_HARVEST_WINDOWS = true;

    // -------------------- Public API --------------------------------------------------------
    async function listPlantOptions() {
        const plants = await PlantModel.listBasic();
        return plants.map(function (plant) {
            return {
                id: String(plant.plant_id),
                name: String(plant.plant_name || plant.abbr || plant.plant_id),
                abbr: String(plant.abbr || ""),
                annual: Number(plant.annual || 0),
                biennial: Number(plant.biennial || 0),
                perennial: Number(plant.perennial || 0)
            };
        });
    }

    async function resolvePlantForPlanCrop(options = {}) {
        const plantId = Number(options.plantId);
        if (!Number.isFinite(plantId)) return { ok: false, reason: "missing_plant_id" };
        const varietyId = options.varietyId == null || options.varietyId === "" ? null : Number(options.varietyId);
        const plant = await resolveEffectivePlant(plantId, varietyId);
        if (!plant) return { ok: false, reason: "plant_not_found" };
        const varietyName = Number.isFinite(varietyId) ? await resolveVarietyName(varietyId) : "";
        return {
            ok: true,
            plant,
            plantId: String(plantId),
            varietyId: Number.isFinite(varietyId) ? String(varietyId) : "",
            varietyName,
            label: [plant.plant_name, varietyName].filter(Boolean).join(" - ") || String(plantId)
        };
    }

    async function resolveCityForModule(moduleCell) {
        const cityId = moduleCell && moduleCell.getAttribute ? moduleCell.getAttribute("city_id") : "";
        const cityName = moduleCell && moduleCell.getAttribute ? moduleCell.getAttribute("city_name") : "";
        const city = await CityClimate.resolveUniqueNameFallback({ cityId, cityName });
        if (!city) return { ok: false, reason: cityName || cityId ? "city_not_found" : "missing_city" };
        return { ok: true, city };
    }

    function shiftISODate(iso, days) {
        const d = parseISODateUTCValue(iso);
        if (!d) return "";
        d.setUTCDate(d.getUTCDate() + Number(days || 0));
        return fmtISO(d);
    }

    function datesBetweenISO(startISO, endISO) {
        const out = [];
        let cur = parseISODateUTCValue(startISO);
        const end = parseISODateUTCValue(endISO);
        if (!cur || !end) return out;
        while (cur.getTime() <= end.getTime()) {
            out.push(fmtISO(cur));
            cur.setUTCDate(cur.getUTCDate() + 1);
        }
        return out;
    }

    async function proposeLifecycle(options = {}) {
        try {
            const plant = options.plant instanceof PlantModel ? options.plant : new PlantModel(options.plant || {});
            const city = options.city instanceof CityClimate ? options.city : new CityClimate(options.city || {});
            const methodId = normId(options.methodId || plant.default_planting_method || "direct_sow.field");
            const behavior = resolveMethodBehavior({ methodCategoryId: options.methodCategoryId || "", methodId });
            const effectiveTransplantDays = normalizeTransplantDays(options.effectiveTransplantDays ?? plant.days_transplant) ?? 0;
            let primaryDateISO = String(options.primaryDateISO || options.bedEntryDateISO || options.startISO || "").trim();
            const weekStartISO = String(options.weekStartISO || "").trim();
            const weekEndISO = String(options.weekEndISO || "").trim() || (weekStartISO ? shiftISODate(weekStartISO, 6) : "");
            if (options.chooseBestFeasibleDay && weekStartISO) {
                const candidates = datesBetweenISO(weekStartISO, weekEndISO || weekStartISO);
                let chosen = "";
                for (const candidateISO of candidates) {
                    const candidateStartISO = behavior.planningMode === "transplant_indoor"
                        ? sowDateFromPrimaryDate(candidateISO, methodId, effectiveTransplantDays)
                        : candidateISO;
                    try {
                        const candidateInputs = new sharedCore.ScheduleInputs({
                            plant,
                            city,
                            planningMode: behavior.planningMode,
                            methodCategoryId: behavior.methodCategoryId,
                            methodId,
                            startISO: candidateStartISO,
                            seasonEndISO: String(options.seasonEndISO || `${Number(options.seasonStartYear || candidateStartISO.slice(0, 4))}-12-31`),
                            seasonStartYear: Number(options.seasonStartYear || candidateStartISO.slice(0, 4)),
                            harvestWindowDays: resolveHarvestWindowDays(plant, options.harvestWindowDays),
                            minYieldMultiplier: Number(options.minYieldMultiplier || 0),
                            policy: options.policy || new PolicyFlags({
                                useSpringFrostGate: options.useSpringFrostGate !== false,
                                useSoilTempGate: options.useSoilTempGate !== false && behavior.usesSoilTempGate !== false,
                                overwinterAllowed: plant.isBiennial() || plant.isPerennial() || plant.overwinter_ok === 1
                            }),
                            dailyClimate: options.dailyClimate || null,
                            bedProfile: normalizeBedProfile(options.bedProfile || null),
                            bedProfileSource: String(options.bedProfileSource || "allocation bed")
                        });
                        computeScheduleResult(candidateInputs);
                        chosen = candidateISO;
                        break;
                    } catch (_) { }
                }
                primaryDateISO = chosen || candidates[0] || primaryDateISO;
            }
            const startISO = behavior.planningMode === "transplant_indoor"
                ? sowDateFromPrimaryDate(primaryDateISO, methodId, effectiveTransplantDays)
                : primaryDateISO;
            const seasonStartYear = Number(options.seasonStartYear || (startISO ? Number(startISO.slice(0, 4)) : new Date().getFullYear()));
            const inputs = new sharedCore.ScheduleInputs({
                plant,
                city,
                planningMode: behavior.planningMode,
                methodCategoryId: behavior.methodCategoryId,
                methodId,
                startISO,
                seasonEndISO: String(options.seasonEndISO || `${seasonStartYear}-12-31`),
                seasonStartYear,
                harvestWindowDays: resolveHarvestWindowDays(plant, options.harvestWindowDays),
                minYieldMultiplier: Number(options.minYieldMultiplier || 0),
                policy: options.policy || new PolicyFlags({
                    useSpringFrostGate: options.useSpringFrostGate !== false,
                    useSoilTempGate: options.useSoilTempGate !== false && behavior.usesSoilTempGate !== false,
                    overwinterAllowed: plant.isBiennial() || plant.isPerennial() || plant.overwinter_ok === 1
                }),
                dailyClimate: options.dailyClimate || null,
                bedProfile: normalizeBedProfile(options.bedProfile || null),
                bedProfileSource: String(options.bedProfileSource || "allocation bed")
            });
            const result = computeScheduleResult(inputs);
            const taskTemplate = options.taskTemplate === undefined
                ? null
                : options.taskTemplate;
            const tasks = await buildTasksForPlan({
                plant,
                schedule: result && result.schedule,
                timelines: result && result.timelines,
                taskTemplate,
                methodCategoryId: behavior.methodCategoryId,
                methodId,
                varietyName: String(options.varietyName || ""),
                includePreviewMetadata: true
            });
            const attributePatch = buildScheduleAttributePatch(inputs, result, {
                effectiveTransplantDays,
                transplantDaysOverrideEnabled: options.effectiveTransplantDays != null,
                taskTemplateJson: taskTemplate == null ? undefined : JSON.stringify(taskTemplate)
            });
            const scheduleWarnings = Array.isArray(result && result.warnings) ? Array.from(result.warnings) : [];
            return {
                ok: true,
                status: scheduleWarnings.length ? "warning" : "compatible",
                warnings: scheduleWarnings,
                methodId,
                methodCategoryId: behavior.methodCategoryId,
                planningMode: behavior.planningMode,
                primaryDateISO,
                startISO,
                result,
                attributePatch,
                taskPreview: tasks
            };
        } catch (error) {
            return {
                ok: false,
                status: "structural_failure",
                reason: error && error.message ? error.message : String(error || "Unable to calculate lifecycle."),
                taskPreview: []
            };
        }
    }

    async function openDraftScheduleDialog(ui, draft, callbacks = {}) {
        const current = Object.assign({}, draft || {});
        const proposal = current.lifecycle || current.scheduleProposal || null;
        const tasks = (Array.isArray(current.taskPreview) ? current.taskPreview : (proposal && Array.isArray(proposal.taskPreview) ? proposal.taskPreview : [])).map(function (task) {
            return Object.assign({}, task || {});
        });
        const div = document.createElement("div");
        div.style.cssText = "padding:14px;font:12px Arial,sans-serif;color:#111827;display:flex;flex-direction:column;gap:10px;max-height:70vh;overflow:auto;";
        const title = document.createElement("div");
        title.style.cssText = "font-weight:700;font-size:15px;";
        title.textContent = "Edit Allocation Tasks";
        div.appendChild(title);
        const hint = document.createElement("div");
        hint.style.cssText = "color:#4b5563;line-height:1.35;";
        hint.textContent = "Review the generated task schedule before creating the planting.";
        div.appendChild(hint);
        const list = document.createElement("div");
        list.style.cssText = "display:flex;flex-direction:column;gap:6px;border:1px solid #e5e7eb;border-radius:6px;padding:8px;background:#f9fafb;";
        function renderTaskRows() {
            list.innerHTML = "";
            if (!tasks.length) {
                const empty = document.createElement("div");
                empty.textContent = "No generated tasks.";
                list.appendChild(empty);
                return;
            }
            tasks.forEach(function (task, index) {
                const row = document.createElement("div");
                row.style.cssText = "display:grid;grid-template-columns:105px minmax(0,1fr) auto;gap:6px;align-items:center;";
                const date = document.createElement("input");
                date.type = "date";
                date.value = String(task.startISO || task.start || "");
                date.style.cssText = "width:100%;box-sizing:border-box;";
                date.addEventListener("change", function () {
                    task.startISO = String(date.value || "");
                    task.start = task.startISO;
                });
                const titleInput = document.createElement("input");
                titleInput.type = "text";
                titleInput.value = String(task.title || task.name || "Task");
                titleInput.style.cssText = "width:100%;box-sizing:border-box;";
                titleInput.addEventListener("input", function () {
                    task.title = String(titleInput.value || "");
                    task.name = task.title;
                });
                const remove = document.createElement("button");
                remove.type = "button";
                remove.textContent = "Remove";
                remove.style.cssText = "border:1px solid #b91c1c;color:#b91c1c;background:#fff;border-radius:4px;padding:4px 7px;cursor:pointer;";
                remove.addEventListener("click", function () {
                    tasks.splice(index, 1);
                    renderTaskRows();
                });
                row.appendChild(date);
                row.appendChild(titleInput);
                row.appendChild(remove);
                list.appendChild(row);
            });
        }
        renderTaskRows();
        div.appendChild(list);
        const addTask = document.createElement("button");
        addTask.type = "button";
        addTask.textContent = "Add task";
        addTask.style.cssText = "align-self:flex-start;border:1px solid #2563eb;color:#1d4ed8;background:#fff;border-radius:4px;padding:5px 10px;cursor:pointer;";
        addTask.addEventListener("click", function () {
            tasks.push({ startISO: "", title: "New task" });
            renderTaskRows();
        });
        div.appendChild(addTask);
        const prefLabel = document.createElement("label");
        prefLabel.style.cssText = "display:flex;align-items:center;gap:8px;padding:8px;border:1px solid #188038;border-radius:6px;background:#f0fff4;font-weight:700;";
        const pref = document.createElement("input");
        pref.type = "checkbox";
        pref.checked = true;
        prefLabel.appendChild(pref);
        prefLabel.appendChild(document.createTextNode("Save these tasks as plant default"));
        div.appendChild(prefLabel);
        const buttons = document.createElement("div");
        buttons.style.cssText = "display:flex;justify-content:flex-end;gap:8px;";
        const cancel = document.createElement("button");
        cancel.textContent = "Cancel";
        const save = document.createElement("button");
        save.textContent = "Save";
        save.style.cssText = "border:1px solid #188038;color:#166534;background:#fff;border-radius:4px;padding:5px 10px;cursor:pointer;";
        cancel.style.cssText = "border:1px solid #6b7280;color:#111827;background:#fff;border-radius:4px;padding:5px 10px;cursor:pointer;";
        buttons.appendChild(cancel);
        buttons.appendChild(save);
        div.appendChild(buttons);

        return await new Promise(function (resolve) {
            cancel.addEventListener("click", function () {
                if (ui && typeof ui.hideDialog === "function") ui.hideDialog();
                resolve(null);
            });
            save.addEventListener("click", function () {
                const next = Object.assign({}, current, {
                    taskPreview: tasks,
                    saveTasksAsPlantDefault: pref.checked
                });
                if (callbacks && typeof callbacks.onSave === "function") callbacks.onSave(next);
                if (ui && typeof ui.hideDialog === "function") ui.hideDialog();
                resolve(next);
            });
            ui.showDialog(div, 520, 420, true, true);
            elevateTrellisDialog(ui);
        });
    }

    function spacingLayoutContextForCell(activeGraph, cell) {
        const api = activeGraph && activeGraph.__trellisBedSuccessionNavigator;
        if (api && typeof api.getSelectedClusterLayoutContext === 'function') {
            const context = api.getSelectedClusterLayoutContext(cell);
            if (context && Array.isArray(context.cellIds) && context.cellIds.length) return context;
        }
        return {
            selectedId: cell && cell.id || null,
            cellIds: cell && cell.id ? [cell.id] : [],
            enabledIds: cell && cell.id ? [cell.id] : [],
            clusterBounds: null // CHANGE: spacing fallback exposes only model/layout context, not Occupancy DOM bounds.
        };
    }

    function spacingCellRole(cell) {
        return 'planting'; // CHANGE: spacing rows are no longer anchored companion roles.
    }

    function spacingBedOffsetForCell(cell, bed) {
        const pxPerCm = 5 * 0.18;
        const rect = graphRectForCell(cell);
        const bedRect = graphRectForCell(bed);
        return {
            x: layoutNumberOrNull(cell?.getAttribute?.('layout_offset_x_cm')) ?? (rect && bedRect ? (rect.x - bedRect.x) / pxPerCm : 0),
            y: layoutNumberOrNull(cell?.getAttribute?.('layout_offset_y_cm')) ?? (rect && bedRect ? (rect.y - bedRect.y) / pxPerCm : 0)
        };
    }

    function spacingPlantDefaultLayout(plant) {
        const defaults = plantSpacingDefaults(plant);
        return { spacingXCm: defaults.spacingXCm, spacingYCm: defaults.spacingYCm, offsetXCm: 0, offsetYCm: 0 }; // CHANGE: plant-default reset delegates final geometry normalization to the tiler.
    }

    function spacingIdentityForCell(cell) {
        return {
            plantId: cellPlantId(cell),
            varietyId: finiteNumberOrNull(cell?.getAttribute?.('variety_id')),
            plantName: String(cell?.getAttribute?.('plant_name') || ''),
            varietyName: String(cell?.getAttribute?.('variety_name') || '')
        }; // CHANGE: set defaults distinguish varieties but can fall back to plant-level keys.
    }

    function setDefaultRowForSpacingRow(setDefault, row) {
        const rows = Array.isArray(setDefault?.rows) ? setDefault.rows : [];
        const exact = CompanionSetLayoutDefaultModel.identityToken(row, false);
        const broad = CompanionSetLayoutDefaultModel.identityToken(row, true);
        return rows.find(item => String(item.identityKey || '') === exact)
            || rows.find(item => String(item.identityKey || '') === broad)
            || null;
    }

    function rowWithAppliedLayout(row, layout) {
        return Object.assign({}, row, {
            spacingXCm: layoutNumberOrNull(layout?.spacingXCm) ?? row.spacingXCm,
            spacingYCm: layoutNumberOrNull(layout?.spacingYCm) ?? row.spacingYCm,
            offsetXCm: layoutNumberOrNull(layout?.offsetXCm) ?? row.offsetXCm,
            offsetYCm: layoutNumberOrNull(layout?.offsetYCm) ?? row.offsetYCm
        }); // CHANGE: companion-set defaults persist only ordinary planting layout fields.
    }

    async function buildSpacingLayoutRows(activeGraph, selectedCell) {
        const model = activeGraph && typeof activeGraph.getModel === 'function' ? activeGraph.getModel() : null;
        const context = spacingLayoutContextForCell(activeGraph, selectedCell);
        const enabledIds = new Set((context.enabledIds || context.cellIds || []).map(id => String(id || '')));
        const rows = [];
        for (const cellId of context.cellIds || []) {
            const cell = model && typeof model.getCell === 'function' ? model.getCell(cellId) : null;
            if (!cell || !isTilerGroup(cell)) continue;
            const plantId = cellPlantId(cell);
            const plant = plantId != null ? await PlantModel.loadById(plantId) : null;
            const defaults = plantSpacingDefaults(plant);
            const bed = findContainingBedForScheduleCell(cell);
            const offsets = spacingBedOffsetForCell(cell, bed);
            const identity = spacingIdentityForCell(cell);
            rows.push({
                cellId: String(cell.id || ''),
                selected: String(cell.id || '') === String(context.selectedId || ''),
                enabled: enabledIds.has(String(cell.id || '')),
                role: spacingCellRole(cell),
                label: cellLayoutLabel(cell),
                plantId,
                varietyId: identity.varietyId,
                plantName: plant?.plant_name || cell?.getAttribute?.('plant_name') || '',
                varietyName: identity.varietyName,
                identityKey: CompanionSetLayoutDefaultModel.identityToken(identity, false),
                spacingXCm: layoutNumberOrNull(cell.getAttribute?.('spacing_x_cm')) ?? layoutNumberOrNull(cell.getAttribute?.('spacing_cm')) ?? defaults.spacingXCm,
                spacingYCm: layoutNumberOrNull(cell.getAttribute?.('spacing_y_cm')) ?? layoutNumberOrNull(cell.getAttribute?.('spacing_cm')) ?? defaults.spacingYCm,
                offsetXCm: offsets.x,
                offsetYCm: offsets.y,
                plantDefaultLayout: spacingPlantDefaultLayout(plant),
                rect: graphRectForCell(cell),
                bedRect: graphRectForCell(bed)
            }); // CHANGE: diagram overlay receives editable spacing rows without owning scheduler internals.
        }
        const activeRows = rows.filter(row => row.enabled && row.plantId != null);
        const setInfo = activeRows.length > 1 ? await CompanionSetLayoutDefaultModel.loadForRows(activeRows) : { exactKey: '', broadKey: '', default: null };
        return Object.assign({}, context, {
            rows,
            activeSetKey: setInfo.exactKey,
            activeBroadSetKey: setInfo.broadKey,
            setDefault: setInfo.default,
            hasSetDefault: !!setInfo.default
        }); // CHANGE: spacing context carries anchorless set-default availability for the overlay.
    }

    function normalizeSpacingDraftRows(rows) {
        return (rows || []).map(row => Object.assign({}, row, {
            spacingXCm: layoutNumberOrNull(row.spacingXCm),
            spacingYCm: layoutNumberOrNull(row.spacingYCm),
            offsetXCm: layoutNumberOrNull(row.offsetXCm),
            offsetYCm: layoutNumberOrNull(row.offsetYCm)
        }));
    }

    function validateSpacingDraft(rows) {
        const errors = [];
        normalizeSpacingDraftRows(rows).forEach(row => {
            if (!row.enabled) return;
            const label = row.label || row.cellId || 'Planting';
            if (!(row.spacingXCm > 0)) errors.push(label + ': Spacing X must be a positive number.');
            if (!(row.spacingYCm > 0)) errors.push(label + ': Spacing Y must be a positive number.');
            if (row.offsetXCm == null) errors.push(label + ': Offset X must be a finite number.');
            if (row.offsetYCm == null) errors.push(label + ': Offset Y must be a finite number.');
        });
        return { ok: errors.length === 0, errors };
    }

    function buildSpacingPreviewModel(rows) {
        const previewRows = normalizeSpacingDraftRows(rows).filter(row => row.enabled).map(row => {
            const fallbackRect = row.rect || { x: 0, y: 0, width: 120, height: 80 };
            const rect = row.bedRect ? clampRectInsideRect(bedRelativeRectForLayoutRow(row, fallbackRect, row.bedRect), row.bedRect) : fallbackRect;
            const dots = computePreviewCirclesForLayoutRow(rect, row, {}, row.bedRect || null);
            return Object.assign({}, row, { rect, dots, warning: rect.clamped || dots.clamped ? 'Clamped inside bed.' : '' });
        });
        return {
            status: 'ok',
            rows: previewRows,
            warning: previewRows.filter(row => row.warning).map(row => (row.label || row.cellId) + ': ' + row.warning).join(' ')
        };
    }

    async function saveSpacingDefaultsForRows(rows, activeGraph, model) {
        const enabled = normalizeSpacingDraftRows(rows).filter(row => row.enabled);
        if (enabled.filter(row => row.plantId != null).length > 1) {
            await CompanionSetLayoutDefaultModel.save(enabled);
            return;
        }
        for (const row of enabled) {
            if (row.plantId == null) continue;
            const patch = {};
            if (row.spacingXCm != null) patch.spacing_x_cm = row.spacingXCm;
            if (row.spacingYCm != null) patch.spacing_y_cm = row.spacingYCm;
            if (row.spacingXCm != null && row.spacingYCm != null && row.spacingXCm === row.spacingYCm) patch.spacing_cm = row.spacingXCm;
            if (Object.keys(patch).length) await PlantModel.update(row.plantId, patch);
        }
    }

    async function applyLayoutRowsToGraph(activeGraph, rows) {
        const model = activeGraph && typeof activeGraph.getModel === 'function' ? activeGraph.getModel() : null;
        if (!activeGraph || !model) throw new Error('Graph is unavailable.');
        const editable = normalizeSpacingDraftRows(rows).filter(row => row.enabled);
        model.beginUpdate();
        try {
            const tiler = window.USL && window.USL.tiler ? window.USL.tiler : null;
            editable.forEach(row => {
                const cell = graphCellById(activeGraph, row.cellId);
                if (!cell) return;
                applyCellAttributePatch(cell, plantingLayoutAttributePatch(row), model);
                if (tiler && typeof tiler.retileGroup === 'function') tiler.retileGroup(activeGraph, cell, { inTransaction: true, preferInPlace: true });
            });
        } finally {
            model.endUpdate();
        }
        editable.forEach(row => {
            const cell = graphCellById(activeGraph, row.cellId);
            if (cell && typeof activeGraph.refresh === 'function') activeGraph.refresh(cell);
        });
        if (typeof activeGraph.fireEvent === 'function' && typeof mxEventObject === 'function') {
            activeGraph.fireEvent(new mxEventObject('trellisSelectionVisualsRefresh'));
        }
        return { ok: true, appliedCellIds: editable.map(row => row.cellId) };
    }

    async function applySetDefault(activeGraph, context) {
        const setDefault = context && context.setDefault;
        if (!setDefault) throw new Error('No set default is saved for the active companion set.');
        const rows = (context.rows || []).map(row => {
            if (!row.enabled) return row;
            return rowWithAppliedLayout(row, setDefaultRowForSpacingRow(setDefault, row) || row.plantDefaultLayout);
        });
        return applyLayoutRowsToGraph(activeGraph, rows); // CHANGE: manual set-default restore uses the same graph application path as spacing edits.
    }

    function normalizedLayoutNumber(value) {
        const n = layoutNumberOrNull(value);
        return n == null ? null : Math.round(n * 1000) / 1000;
    }

    function spacingLayoutMatches(row, layout) {
        if (!row || !layout) return false;
        return normalizedLayoutNumber(row.spacingXCm) === normalizedLayoutNumber(layout.spacingXCm)
            && normalizedLayoutNumber(row.spacingYCm) === normalizedLayoutNumber(layout.spacingYCm)
            && normalizedLayoutNumber(row.offsetXCm) === normalizedLayoutNumber(layout.offsetXCm)
            && normalizedLayoutNumber(row.offsetYCm) === normalizedLayoutNumber(layout.offsetYCm); // CHANGE: manual-edit protection compares the user-editable spacing/offset fields only.
    }

    function activeSpacingRows(context) {
        return (context?.rows || []).filter(row => row && row.enabled && row.plantId != null);
    }

    function spacingContextKey(context) {
        const rows = activeSpacingRows(context);
        return rows.length > 1 ? CompanionSetLayoutDefaultModel.cropSetKey(rows, false) : '';
    }

    async function captureSpacingLayoutContext(activeGraph, cell) {
        try {
            return cell ? await buildSpacingLayoutRows(activeGraph, cell) : null;
        } catch (_) {
            return null;
        }
    }

    async function applyScheduleCompanionSetDefaults(activeGraph, cell, beforeContext, options = {}) {
        const afterContext = await captureSpacingLayoutContext(activeGraph, cell);
        if (!afterContext) return null;
        const beforeKey = spacingContextKey(beforeContext);
        const afterKey = spacingContextKey(afterContext);
        if (!options.force && beforeKey === afterKey) return null;

        const beforeRowsByCell = new Map((beforeContext?.rows || []).map(row => [String(row.cellId || ''), row]));
        const afterRowsByCell = new Map((afterContext.rows || []).map(row => [String(row.cellId || ''), row]));
        const targetIds = new Set();
        activeSpacingRows(afterContext).forEach(row => targetIds.add(String(row.cellId || '')));
        activeSpacingRows(beforeContext).forEach(row => targetIds.add(String(row.cellId || '')));

        const rowsToApply = [];
        targetIds.forEach(cellId => {
            const afterRow = afterRowsByCell.get(cellId);
            if (!afterRow) return;
            const beforeRow = beforeRowsByCell.get(cellId);
            const previousDefault = setDefaultRowForSpacingRow(beforeContext?.setDefault, beforeRow);
            const safe = !!options.force
                || spacingLayoutMatches(afterRow, previousDefault)
                || spacingLayoutMatches(afterRow, beforeRow?.plantDefaultLayout);
            if (!safe) return;
            const nextLayout = afterKey
                ? (setDefaultRowForSpacingRow(afterContext.setDefault, afterRow) || afterRow.plantDefaultLayout)
                : afterRow.plantDefaultLayout;
            if (!nextLayout) return;
            rowsToApply.push(rowWithAppliedLayout(Object.assign({}, afterRow, { enabled: true }), nextLayout));
        });
        if (!rowsToApply.length) return { ok: true, appliedCellIds: [] };
        return applyLayoutRowsToGraph(activeGraph, rowsToApply); // CHANGE: schedule changes reapply set/plant defaults without overwriting manual layout edits.
    }

    async function applySpacingDraft(activeGraph, rows, options = {}) {
        const model = activeGraph && typeof activeGraph.getModel === 'function' ? activeGraph.getModel() : null;
        if (!activeGraph || !model) throw new Error('Graph is unavailable.');
        const normalized = normalizeSpacingDraftRows(rows);
        const validation = validateSpacingDraft(normalized);
        if (!validation.ok) throw new Error(validation.errors.join('\n'));
        if (options.saveDefaults) await saveSpacingDefaultsForRows(normalized, activeGraph, model);
        return applyLayoutRowsToGraph(activeGraph, normalized);
    }

    const layoutTools = {
        buildSpacingLayoutRows,
        validateSpacingDraft,
        buildSpacingPreviewModel,
        applySpacingDraft,
        applySetDefault,
        normalizeCompanionLayoutTemplate
    };

    window.USL = window.USL || {};
    window.USL.scheduler = Object.assign({}, window.USL.scheduler, {
        openScheduleDialog: (ui, cell) => openScheduleDialog(ui, cell),
        openDerivedScheduleDialog: (ui, sourceCell, options) => openDerivedScheduleDialog(ui, sourceCell, options),
        openSetPlantDialog: (ui, cell) => openSetPlantDialog(ui, cell),
        listPlantOptions: listPlantOptions,
        resolvePlantForPlanCrop,
        resolveCityForModule,
        proposeLifecycle,
        openDraftScheduleDialog,
        layoutTools
    });
    window.openUSLScheduleDialog = window.USL.scheduler.openScheduleDialog;

    async function openSetPlantDialog(ui, cell) {
        if (!ui || !ui.editor || !ui.editor.graph) throw new Error('Draw.io UI is unavailable.');
        if (!isTilerGroup(cell)) throw new Error('Set Plant requires a tiler group.');

        const graph = ui.editor.graph;
        const model = graph.getModel();
        const allPlants = await PlantModel.listBasic();
        if (!allPlants.length) { mxUtils.alert('No plants found in database.'); return; }
        const gardenParent = findGardenModuleAncestor(model, cell);
        const today = new Date();
        const todayISO = localTodayISO(today);
        const cityId = finiteNumberOrNull(cell?.getAttribute?.('city_id')) ?? finiteNumberOrNull(gardenParent?.getAttribute?.('city_id'));
        const cityName = String(cell?.getAttribute?.('city_name') || gardenParent?.getAttribute?.('city_name') || '').trim();
        const setPlantCity = (cityId != null || cityName) ? await CityClimate.resolve({ cityId, cityName }) : null;
        const setPlantBedContext = resolveScheduleBedContext(cell);
        const setPlantCropSuitabilityCache = makeCropSuitabilityCache();
        const setPlantScoringContext = setPlantCity ? {
            city: setPlantCity,
            cityName: setPlantCity.city_name || cityName,
            primaryDateISO: todayISO,
            seasonStartYear: today.getFullYear(),
            climateModelModuleCell: gardenParent,
            bedProfile: setPlantBedContext.profile,
            bedProfileSource: setPlantBedContext.source,
            cache: setPlantCropSuitabilityCache,
            deferMissingWindows: true
        } : null;
        let setPlantCropOptions = setPlantCity
            ? await scoreCropPickerOptions(allPlants, setPlantScoringContext)
            : makeCropPickerOptions(allPlants);

        const div = document.createElement('div');
        div.style.padding = '12px';
        div.style.width = '420px';
        const title = document.createElement('div');
        title.textContent = 'Select Plant';
        title.style.fontWeight = '600';
        title.style.marginBottom = '8px';
        div.appendChild(title);

        const filterSel = buildLifecycleFilterControl();
        filterSel.style.margin = '8px 0 0 0';
        div.appendChild(filterSel);

        const sel = document.createElement('select');
        sel.style.width = '100%';
        sel.style.padding = '6px';
        sel.style.margin = '8px 0';
        function renderSetPlantCropPicker(selectedValue = sel.value) {
            const groups = buildGroupedCropOptions(setPlantCropOptions, {
                filter: filterSel.value,
                selectedValue,
                includeSelectedWhenFiltered: true
            });
            renderGroupedCropOptions(sel, groups, selectedValue);
        }
        const initialSetPlantId = String(cell?.getAttribute?.('plant_id') || allPlants[0]?.plant_id || '');
        renderSetPlantCropPicker(initialSetPlantId);
        if (setPlantScoringContext) {
            subscribeCropSuitabilityCache(setPlantCropSuitabilityCache, async () => {
                setPlantCropOptions = await scoreCropPickerOptions(allPlants, setPlantScoringContext);
                renderSetPlantCropPicker(sel.value);
            });
        }
        filterSel.addEventListener('change', () => renderSetPlantCropPicker(sel.value));
        div.appendChild(sel);

        const btns = document.createElement('div');
        btns.style.display = 'flex';
        btns.style.justifyContent = 'flex-end';
        btns.style.gap = '8px';

        const ok = mxUtils.button('OK', async () => {
            const id = Number(sel.value);
            if (!Number.isFinite(id)) { mxUtils.alert('Select a plant.'); return; }
            const row = await PlantModel.loadById(id);
            if (!row) { mxUtils.alert('Plant not found.'); return; }
            ui.hideDialog();

            model.beginUpdate();
            try {
                if (gardenParent) {
                    const inheritedCityId = gardenParent.getAttribute('city_id');
                    const inheritedCity = gardenParent.getAttribute('city_name');
                    if (inheritedCityId) setAttr(cell, 'city_id', inheritedCityId);
                    if (inheritedCity) setAttr(cell, 'city_name', inheritedCity);
                }

                setAttr(cell, 'plant_id', String(row.plant_id));
                setAttr(cell, 'plant_name', row.plant_name);
                if (row.abbr) setAttr(cell, 'plant_abbr', row.abbr);
                setAttr(cell, 'plant_locked', '1');
                setAttr(cell, 'label', row.plant_name + ' group');

                applyPlantSpacingToGroup(cell, row);

                retileAndFitGroupIfAvailable(graph, cell, { source: 'set-plant', inTransaction: true });
                graph.refresh(cell);
            } finally {
                model.endUpdate();
            }
        });
        const cancel = mxUtils.button('Cancel', () => ui.hideDialog());
        applySharedButtonStyle(ok, 'add');
        applySharedButtonStyle(cancel, 'neutral');
        btns.appendChild(ok);
        btns.appendChild(cancel);
        div.appendChild(btns);
        ui.showDialog(div, 440, 260, true, true);
        elevateTrellisDialog(ui);
    }

    if (window.USL_SCHEDULER_TESTING) {
        bindRequiredSchedulerCores();
        window.USL.scheduler.__test = {
            PlantModel,
            TaskTemplateModel,
            CompanionLayoutGroupDefaultModel,
            CompanionSetLayoutDefaultModel,
            PlantGrowthStageModel,
            CityClimate,
            PolicyFlags,
            ScheduleInputs: sharedCore.ScheduleInputs,
            Planner: annualCore.Planner,
            computeAutoStartEndWindowForward: annualCore.computeAutoStartEndWindowForward,
            computeAnnualSowingSeasons: annualCore.computeAnnualSowingSeasons,
            getPlantScanYears,
            isCrossYearCrop, // FIX: expose lifecycle behavior to the opt-in regression harness
            resolveHarvestWindowDays, // FIX: expose fallback behavior to the opt-in regression harness
            resolveSpringFrostByRisk: sharedCore.resolveSpringFrostByRisk, // ADDED: expose shared frost inference for regression tests.
            resolveFallFrostByRisk: sharedCore.resolveFallFrostByRisk, // ADDED: expose shared fall frost inference for regression tests.
            resolveFrostRiskTip, // ADDED: expose frost-source UI text for regression tests.
            normalizeGrowthStage,
            readGrowthStageFromCell,
            deriveGrowthStageLayoutRatio,
            applyGrowthStageToPlant,
            computeStageDatesForPlanting: annualCore.computeStageDatesForPlanting, // CHANGED: expose canonical annual core behavior.
            buildLifecycleTimelineViewModel,
            buildLifecycleTimelineAxisMarkers,
            lifecycleTimelineAbbreviation,
            lifecycleTimelineTooltipText,
            layoutLifecycleTimelineMarkerOffsets,
            attachLifecycleTimelineMarkerTooltip,
            findFirstLifecycleTimelineTaskRule,
            buildGraphCreatedCompanionRelationship,
            normalizeCompanionLayoutTemplate,
            resolveCompanionLayout,
            companionLayoutAttributePatch,
            plantingLayoutAttributePatch,
            buildLayoutPreviewModel,
            buildCompanionLayoutPreviewModel,
            computeActiveCompanionPlacement,
            selectCompanionLayoutAnchorFromSet,
            computePreviewPlantCircles,
            layoutTools,
            normId,
            resolveStartAfterWindow
        }; // FIX: expose pure planner internals only when the regression harness opts in
    }

    // -------------------- Plugin entry: add popup menu item --------------------------------
    function installSchedulerPlugin(ui) { // FIX: install from the existing outer plugin registration
        const graph = ui.editor.graph;

        // Schedule entry is now rendered by Vertex_Linking_Standalone.js so it can live inside the linked-task overlay.

        // --- Harvest window bridge (installed once) ---
        if (!graph.__uslHarvestWindowsBridgeInstalled) {
            graph.__uslHarvestWindowsBridgeInstalled = true;

            window.addEventListener("usl:harvestWindowsNeeded", async (ev) => {
                const d = ev?.detail;
                if (!d) return;

                const moduleCellId = String(d.moduleCellId || "").trim();
                const year = Number(d.year);
                const crops = Array.isArray(d.crops) ? d.crops : [];
                if (!moduleCellId || !Number.isFinite(year) || year < 1900 || year > 3000) return;
                if (!crops.length) return;

                const moduleCell = graph.getModel().getCell(moduleCellId);
                if (!moduleCell) return;

                const cityId = finiteNumberOrNull(moduleCell.getAttribute?.("city_id"));
                const cityName = String(moduleCell.getAttribute?.("city_name") || "").trim();
                if (cityId == null && !cityName) {
                    emitHarvestWindowsSuggested(moduleCellId, year, crops.map(c => ({
                        cropId: c.cropId, harvestStart: null, harvestEnd: null, shelfLifeDays: null,
                        reason: "Module city_id/city_name not set"
                    })));
                    return;
                }

                const results = [];
                for (const req of crops) {
                    results.push(await suggestHarvestWindowForCropReq(req, { cityId, cityName }, year, moduleCell));
                }
                emitHarvestWindowsSuggested(moduleCellId, year, results);
            });
        }

        function emitHarvestWindowsSuggested(moduleCellId, year, results) {
            if (USL_DEBUG_HARVEST_WINDOWS) {
                console.groupCollapsed('[USL][Scheduler] emit usl:harvestWindowsSuggested');
                console.log('moduleCellId:', moduleCellId);
                console.log('year:', year);
                console.log('results:', JSON.parse(JSON.stringify(results)));
                console.groupEnd();
            }

            try {
                window.dispatchEvent(new CustomEvent("usl:harvestWindowsSuggested", {
                    detail: { moduleCellId, year, results }
                }));
            } catch (e) {
                console.error('[USL][Scheduler] Failed to dispatch usl:harvestWindowsSuggested', e);
            }
        }

        console.log("[Scheduler] defining normalizeUtcMidnight now");

        function normalizeUtcMidnight(d) {
            return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
        }

        function toYmdUTC(d) {
            if (!d) return null;
            return normalizeUtcMidnight(d).toISOString().slice(0, 10);
        }

        function findPrevFeasible(planner, endCandidate, maxDays) {
            let d = normalizeUtcMidnight(endCandidate);
            const C = planner.ctx;

            if (d > C.scanEndHard) d = normalizeUtcMidnight(C.scanEndHard);
            if (d < C.scanStart) return { date: null, info: null };

            for (let i = 0; i <= maxDays && d >= C.scanStart; i++) {
                const info = planner.isSowFeasible(d);
                if (info.ok) return { date: d, info };
                d = planner.addDays(d, -1);
            }
            return { date: null, info: null };
        }

        function annualSchedulerScanEndYear(plant, year) {
            const lifecycleEndYear = Number(year) + getPlantScanYears(plant) - 1;
            return isPerennialPlant(plant) ? lifecycleEndYear : Math.max(lifecycleEndYear, Number(year) + 1);
        }

        function isTilerGroupCell(cell) {
            return !!cell && cell.getAttribute && cell.getAttribute('tiler_group') === '1';
        }

        function collectTilerGroupsInModule(moduleCell) {
            const model = graph && graph.getModel ? graph.getModel() : null;
            const out = [];
            function visit(cell) {
                if (!cell) return;
                if (isTilerGroupCell(cell)) out.push(cell);
                const count = model && model.getChildCount ? model.getChildCount(cell) : 0;
                for (let i = 0; i < count; i++) visit(model.getChildAt(cell, i));
                if (!count && graph.getChildVertices) (graph.getChildVertices(cell) || []).forEach(visit);
            }
            visit(moduleCell);
            return out;
        }

        function tilerMatchesHarvestRequest(tiler, req) {
            const plantId = String(req?.plantId ?? '').trim();
            const varietyId = req?.varietyId == null || req.varietyId === '' ? '' : String(req.varietyId).trim();
            if (!plantId || String(tiler.getAttribute?.('plant_id') || '').trim() !== plantId) return false;
            const tilerVarietyId = String(tiler.getAttribute?.('variety_id') || '').trim();
            return !varietyId || !tilerVarietyId || tilerVarietyId === varietyId;
        }

        function inferHarvestRequestBedContexts(req, moduleCell) {
            const matches = moduleCell ? collectTilerGroupsInModule(moduleCell).filter(tiler => tilerMatchesHarvestRequest(tiler, req)) : [];
            const contexts = [];
            const seen = new Set();
            for (const tiler of matches) {
                const ctx = resolveScheduleBedContext(tiler);
                const key = JSON.stringify(ctx.profile);
                if (seen.has(key)) continue;
                seen.add(key);
                contexts.push(ctx);
            }
            return contexts.length ? contexts : [{ profile: normalizeBedProfile(null), source: 'generic garden bed' }];
        }

        function mergeHarvestWindowSuggestions(cropId, results) {
            const ok = (results || []).filter(result => result && result.harvestStart && result.harvestEnd);
            if (!ok.length) return (results && results[0]) || { cropId, harvestStart: null, harvestEnd: null, shelfLifeDays: null, reason: 'No feasible bed-context harvest windows' };
            const harvestStart = ok.reduce((latest, result) => latest > result.harvestStart ? latest : result.harvestStart, ok[0].harvestStart);
            const harvestEnd = ok.reduce((earliest, result) => earliest < result.harvestEnd ? earliest : result.harvestEnd, ok[0].harvestEnd);
            const shelfLifeDays = ok.find(result => result.shelfLifeDays != null)?.shelfLifeDays ?? null;
            if (harvestStart > harvestEnd) return { cropId, harvestStart: null, harvestEnd: null, shelfLifeDays, reason: 'Matching beds have non-overlapping feasible harvest windows' };
            const differing = new Set(ok.map(result => `${result.harvestStart}|${result.harvestEnd}`)).size > 1;
            return { cropId, harvestStart, harvestEnd, shelfLifeDays, reason: differing ? 'Conservative intersection across matching bed conditions' : undefined };
        }

        async function suggestHarvestWindowForCropReq(req, cityRef, year, moduleCell = null) {
            const cropId = String(req?.cropId || "");
            const plantId = (req?.plantId != null) ? Number(req.plantId) : NaN;
            const varietyId = (req?.varietyId != null && req.varietyId !== "") ? Number(req.varietyId) : null;

            if (!cropId || !Number.isFinite(plantId)) {
                return { cropId, harvestStart: null, harvestEnd: null, shelfLifeDays: null, reason: "Missing cropId/plantId" };
            }

            try {
                const contexts = inferHarvestRequestBedContexts(req, moduleCell);
                const results = [];
                for (const bedContext of contexts) results.push(await suggestHarvestWindowForCropReqInBed(req, cityRef, year, moduleCell, bedContext));
                return mergeHarvestWindowSuggestions(cropId, results);
            } catch (e) {
                return { cropId, harvestStart: null, harvestEnd: null, shelfLifeDays: null, reason: String(e?.message || e) };
            }
        }

        async function suggestHarvestWindowForCropReqInBed(req, cityRef, year, moduleCell = null, bedContext = null) {
            const cropId = String(req?.cropId || "");
            const plantId = (req?.plantId != null) ? Number(req.plantId) : NaN;
            const varietyId = (req?.varietyId != null && req.varietyId !== "") ? Number(req.varietyId) : null;

            try {
                const plant = await resolveEffectivePlant(plantId, varietyId);
                if (!plant) return { cropId, harvestStart: null, harvestEnd: null, shelfLifeDays: null, reason: "Plant not found" };
                if (isPerennialPlant(plant)) { // FIX: harvest suggestions require an explicit maturity model
                    requirePerennialLifespanYears(plant);
                    return {
                        cropId,
                        harvestStart: null,
                        harvestEnd: null,
                        shelfLifeDays: null,
                        reason: "Perennial harvest timing requires maturity data"
                    };
                }

                const city = await CityClimate.resolve(cityRef || {});
                if (!city) return { cropId, harvestStart: null, harvestEnd: null, shelfLifeDays: null, reason: "City not found" };
                const cityName = String(city.city_name || cityRef?.cityName || "");

                const resolvedBehavior = resolveHarvestRequestMethodBehavior(req);
                
                const planningMode = resolvedBehavior.planningMode;
                const climateResolution = resolveClimateModelPolicy(moduleCell, cityName, plantId, null);
                const policy = PolicyFlags.fromResolvedBehavior(plant, resolvedBehavior, climateResolution.effective);

                const hw = resolveHarvestWindowDays(req?.harvestWindowDays, plant); // FIX: share the scheduler's 7-day fallback
                const scanStart = asUTCDate(year, 1, 1);
                const scanEndHard = asUTCDate(annualSchedulerScanEndYear(plant, year), 12, 31);
                const dailyClimate = await city.loadDailyClimateModel({ scanStart, scanEndHard, climatePolicy: climateResolution.effective });

                const inputs = new sharedCore.ScheduleInputs({
                    plant,
                    city,
                    planningMode,
                    methodCategoryId: resolvedBehavior.methodCategoryId, // FIX: preserve the resolved method context
                    methodId: resolvedBehavior.methodId, // FIX: preserve the resolved method context
                    startISO: `${year}-01-01`,
                    seasonEndISO: fmtISO(scanEndHard),
                    policy,
                    seasonStartYear: year,
                    harvestWindowDays: hw,
                    varietyId,
                    varietyName: "",
                    bedProfile: bedContext?.profile || normalizeBedProfile(null),
                    bedProfileSource: bedContext?.source || 'generic garden bed',
                    dailyClimate
                });

                const planner = new annualCore.Planner(inputs);
                const C = planner.ctx;

                const maxSpanDays = Math.ceil((C.scanEndHard.getTime() - C.scanStart.getTime()) / 86400000) + 2;

                const first = planner.findNextFeasible(C.scanStart, maxSpanDays);
                if (!first?.date || !first?.info?.ok) {
                    return { cropId, harvestStart: null, harvestEnd: null, shelfLifeDays: null, reason: "No feasible sow date found in scan window" };
                }

                const last = findPrevFeasible(planner, C.sowScanEnd || asUTCDate(year, 12, 31), maxSpanDays);

                const shelfLifeDays =
                    Number.isFinite(Number(plant.shelf_life_days)) ? Number(plant.shelf_life_days) : null;

                // We approximate crop harvest window as:
                // earliest harvest start from earliest feasible sow,
                // latest harvest end from latest feasible sow.
                if (!last?.date || !last?.info?.ok) {
                    return {
                        cropId,
                        harvestStart: toYmdUTC(first.info.harvestStart),
                        harvestEnd: toYmdUTC(first.info.harvestEnd),
                        shelfLifeDays,
                        reason: "No late-season feasible sow date found"
                    };
                }

                // ordering sanity
                if (last.info.harvestEnd < first.info.harvestStart) {
                    return {
                        cropId,
                        harvestStart: toYmdUTC(first.info.harvestStart),
                        harvestEnd: toYmdUTC(first.info.harvestEnd),
                        shelfLifeDays,
                        reason: "Late harvest end < early harvest start (constraints)"
                    };
                }

                return {
                    cropId,
                    harvestStart: toYmdUTC(first.info.harvestStart),
                    harvestEnd: toYmdUTC(last.info.harvestEnd),
                    shelfLifeDays
                };
            } catch (e) {
                return { cropId, harvestStart: null, harvestEnd: null, shelfLifeDays: null, reason: String(e?.message || e) };
            }
        }




































    }

    function installDisabledSchedulerApi(coreError) {
        const message = 'Garden Scheduler core modules failed to load: ' + (coreError?.message || String(coreError || 'unknown error'));
        function showDisabledMessage(uiArg) {
            if (uiArg && typeof uiArg.showError === 'function') {
                uiArg.showError('Garden Scheduler unavailable', message);
                return;
            }
            if (typeof mxUtils !== 'undefined' && typeof mxUtils.alert === 'function') {
                mxUtils.alert(message);
                return;
            }
            console.error('[Garden Scheduler]', message);
        }
        window.USL = window.USL || {};
        window.USL.scheduler = Object.assign({}, window.USL.scheduler, {
            loadError: message,
            openScheduleDialog: function (uiArg) { showDisabledMessage(uiArg); },
            openDerivedScheduleDialog: function (uiArg) { showDisabledMessage(uiArg); },
            openSetPlantDialog: function (uiArg) { showDisabledMessage(uiArg); },
            listPlantOptions: async function () { throw new Error(message); },
            resolvePlantForPlanCrop: async function () { return { ok: false, reason: message }; },
            resolveCityForModule: async function () { return { ok: false, reason: message }; },
            proposeLifecycle: async function () { return { ok: false, status: "structural_failure", reason: message, taskPreview: [] }; },
            openDraftScheduleDialog: async function () { throw new Error(message); }
        });
        window.openUSLScheduleDialog = window.USL.scheduler.openScheduleDialog;
    }

    function installSchedulerPluginAfterCoreLoad(ui) {
        const loader = window.USL && window.USL.scheduler && window.USL.scheduler.__coreLoader;
        if (!loader || typeof loader.whenReady !== 'function') {
            installDisabledSchedulerApi(new Error('Garden scheduler core loader is unavailable.'));
            return;
        }
        loader.whenReady(function (coreError) {
            if (coreError) {
                installDisabledSchedulerApi(coreError);
                return;
            }
            try {
                if (typeof loader.validate === 'function') loader.validate();
                bindRequiredSchedulerCores();
                installSchedulerPlugin(ui);
            } catch (e) {
                installDisabledSchedulerApi(e);
            }
        });
    }

    if (typeof window !== 'undefined' && window.__TRELLIS_PLANTING_SCHEDULER_TEST__) { // FIX: opt-in test surface only
        bindRequiredSchedulerCores();
        window.__TRELLIS_PLANTING_SCHEDULER_TEST_HOOKS__ = {
            PlantModel,
            CityClimate,
            PolicyFlags,
            ScheduleInputs: sharedCore.ScheduleInputs,
            Planner: annualCore.Planner,
            applyPlantOverrides,
            normalizeGrowthStage,
            readGrowthStageFromCell,
            deriveGrowthStageLayoutRatio,
            applyGrowthStageToPlant,
            computeScheduleResult,
            computeStageDatesForPlanting: annualCore.computeStageDatesForPlanting,
            computePerennialLifespanEndISO,
            firstCoolingCrossingDate: annualCore.firstCoolingCrossingDate,
            getPlantScanYears,
            getCropLifecycle,
            buildLifecycleFilterControl,
            buildGroupedCropOptions,
            renderGroupedCropOptions,
            buildGroupedVarietyOptions,
            renderGroupedVarietyOptions,
            inferVarietyMaturityClasses,
            manualVarietyMaturityMismatch,
            normalizeVarietyMaturityClass,
            makeCropPickerOptions,
            createSchedulerCropCombobox,
            scoreSowingWindowsForDate,
            scoreCropSuitability,
            scoreCropPickerOptions,
            compareCropPickerOptions,
            makeCropSuitabilityCache,
            clearCropSuitabilityCache,
            makeCropSuitabilityContextKey,
            makeCropWindowCacheKey,
            getOrQueueCropWindowComputation,
            scoreCropFromCachedWindows,
            applyDateToExistingSowingWindows,
            normalizeCropLifecycleFilter,
            persistCropLifecycleFilter,
            readPersistedCropLifecycleFilter,
            resolveHarvestWindowDays,
            resolveSpringFrostByRisk: sharedCore.resolveSpringFrostByRisk, // ADDED: expose shared frost inference for regression tests.
            inferSpringFrostFromMonthlyLows: sharedCore.inferSpringFrostFromMonthlyLows, // ADDED: expose monthly-normal frost inference for focused tests.
            resolveFallFrostByRisk: sharedCore.resolveFallFrostByRisk, // ADDED: expose shared fall frost inference for regression tests.
            inferFallFrostFromMonthlyLows: sharedCore.inferFallFrostFromMonthlyLows, // ADDED: expose monthly-normal fall frost inference for focused tests.
            resolveFrostRiskTip, // ADDED: expose frost-source UI text for regression tests.
            resolveHarvestRequestMethodBehavior,
            resolveInitialMethodSelection,
            resolveMethodBehavior,
            resolveValidMethodRecord,
            TaskTemplateModel,
            resolveTaskTemplate,
            runUiAsyncOperation,
            computeAutoStartEndWindowForward: annualCore.computeAutoStartEndWindowForward,
            computeAnnualSowingSeasons: annualCore.computeAnnualSowingSeasons,
            evaluateSowDateDiagnostics: annualCore.evaluateSowDateDiagnostics,
            computeScheduleQualityDiagnosticRanges: annualCore.computeScheduleQualityDiagnosticRanges,
            computeScheduleQualityDiagnosticRangesForInputs: annualCore.computeScheduleQualityDiagnosticRangesForInputs,
            compressScheduleQualityDiagnosticRanges: annualCore.compressScheduleQualityDiagnosticRanges,
            diagnosticLabel: annualCore.diagnosticLabel,
            normId,
            monthlyMeanOnDate,
            normalizeBedProfile,
            estimateSoilTempC,
            firstSoilReadyDate,
            annualGddFromMonthlyMeans,
            solveGddTemperatureOffset,
            explainFeasibilityOverSeason,
            compressFeasibilityScanRanges,
            formatFeasibilityScanRanges,
            buildFeasibilityBlockingSummary,
            buildFeasibilityDiagnostics,
            normalizeSowingSeasons,
            ORPHAN_SOWING_SEASON_ID,
            methodUsesTransplantDateInput,
            readCellTransplantDaysOverride,
            resolveTransplantDaysConfig,
            sowDateFromPrimaryDate,
            primaryDateFromSowDate,
            projectSowingSeasonForPrimaryDate,
            projectSowingSeasonsForPrimaryDate,
            formatSowingSeasonsSummary,
            formatScheduleQualityDiagnosticRanges,
            buildSowingSeasonSelectorState,
            pickDefaultSowingSeasonId,
            defaultPrimaryStartForSowingSeasons,
            defaultStartForActiveSowingSeason,
            resolveInitialPreviewStartForScheduleDialog,
            findSowingSeasonForDate,
            resolveStartForSowingSeasonSwitch,
            encodeMethodSelection,
            decodeMethodSelection,
            humanFeasibilityReason,
            classifySelectedSowDate,
            requireFeasibleSowingSeasonSelection,
            requireNoBlockingScheduleQualityDiagnostics,
            describeBlockingScheduleQualityDiagnostics,
            normalizeLatitudeDeg,
            saveSchedulerCityLatitude,
            resolvePlantForPlanCrop,
            resolveCityForModule,
            proposeLifecycle,
            openDraftScheduleDialog,
            buildScheduleViewState,
            renderScheduleSummary,
            updateScheduleSummary,
            buildLifecycleTimelineViewModel,
            buildLifecycleTimelineAxisMarkers,
            lifecycleTimelineAbbreviation,
            lifecycleTimelineTooltipText,
            layoutLifecycleTimelineMarkerOffsets,
            attachLifecycleTimelineMarkerTooltip,
            findFirstLifecycleTimelineTaskRule,
            taskRuleLibraryForPlanningMode,
            resolveTaskRuleTaskTypeId,
            normalizeTaskRule,
            validateTaskRule,
            validateTaskRuleAnchorOrder,
            describeTaskRule,
            buildTasksForPlan,
            CompanionLayoutGroupDefaultModel,
            CompanionSetLayoutDefaultModel,
            findRepeatCutoffOmittedRuleKeys,
            filterPreviewTasks,
            getTaskPreviewRuleKey,
            buildTaskRuleDisplayOrder,
            groupPreviewTasksByRule,
            resolveTaskPreviewScheduleRange,
            resolveTaskPreviewDisplayRange,
            resolveStartAfterWindow,
            requireCanSchedulePlantingGroup,
            buildScheduleAttributePatch,
            snapshotCellAttributes,
            applyCellAttributePatch,
            restoreCellAttributeSnapshot,
            runCompensatedSaveSteps,
            readGraphCellAttribute,
            normalizeLinkedCellIds,
            lifecycleRankForPlant,
            lifecycleEligibleForDerivedCompanion,
            sourceOccupancyWindowForDerived,
            shiftISODate,
            daysDeltaISO,
            isoRangesOverlap,
            computeSchedulerAdjacentGapHints,
            computeAnnualTurnoverWindowForCandidate,
            turnoverComputedWindowFitsSourceCluster,
            turnoverCandidateFitsSourceCluster,
            buildDerivedRelationshipPatch,
            buildGraphCreatedCompanionRelationship,
            normalizeCompanionLayoutTemplate,
            resolveCompanionLayout,
            companionLayoutAttributePatch,
            plantingLayoutAttributePatch,
            buildLayoutPreviewModel,
            buildCompanionLayoutPreviewModel,
            computeActiveCompanionPlacement,
            selectCompanionLayoutAnchorFromSet,
            computePreviewPlantCircles,
            companionRatingLabel,
            formatSignedDays,
            sharedCore,
            annualCore,
            perennialCore
        };
        return; // FIX: tests do not install Draw.io menus
    }

    installSchedulerPluginAfterCoreLoad(ui);

})
