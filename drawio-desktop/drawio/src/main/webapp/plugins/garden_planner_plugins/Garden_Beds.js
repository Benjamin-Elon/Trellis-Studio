/**
 * Draw.io Plugin: Garden Beds
 *
 * Stores growing-condition metadata on Trellis garden beds,
 * then renders selected-bed overlays from that saved metadata.
 */
Draw.loadPlugin(function (ui) {
    const graph = ui && ui.editor && ui.editor.graph;
    if (!graph || graph.__gardenBedsInstalled) return;
    graph.__gardenBedsInstalled = true;

    const model = graph.getModel && graph.getModel();
    if (!model) return;
    const GRAPH_OVERLAY_Z = Object.freeze({ ANNOTATION: 10000, CONNECTION: 10010, CONTROL: 10020, CONTROL_TOP: 10030 });
    const TRELLIS_DIALOG_Z = 2000000000;
    const BED_NAME_FALLBACK = "Garden Bed";
    const OVERLAY_MIN_WIDTH = 190;
    const OVERLAY_PADDING_X = 16;
    const OVERLAY_ROW_GAP = 6;
    const OVERLAY_MIN_LABEL_WIDTH = 72;
    const OVERLAY_AVG_CHAR_WIDTH = 7;
    const OVERLAY_CONTROL_CHROME_WIDTH = 24;
    const CM_PER_INCH = 2.54;

    function applyBedButtonStyle(button, variant, options) {
        if (window.Trellis && window.Trellis.ui && typeof window.Trellis.ui.applyButtonStyle === "function") {
            window.Trellis.ui.applyButtonStyle(button, variant, options);
        } else if (button) {
            button.setAttribute("data-trellis-button-variant", variant || "neutral");
        }
        return button;
    }

    function bedButton(label, onClick, variant, options) {
        return applyBedButtonStyle(mxUtils.button(label, onClick), variant || "neutral", options);
    }

    const ATTRS = {
        BED_JSON: "bed_conditions_json",
        SEASON_EXTENSION_DEFAULTS_JSON: "season_extension_defaults_json"
    };

    const IDENTITY_MIRROR_ATTRS = {
        bedType: "bed_type",
        bedHeightCm: "bed_height_cm",
        userBedName: "user_bed_name"
    };

    const MIRROR_ATTRS = {
        sunExposure: "sun_exposure",
        soilMoisture: "soil_moisture",
        drainage: "drainage",
        soilTexture: "soil_texture",
        fertility: "fertility",
        irrigation: "irrigation",
        trellis: "trellis",
        seasonExtension: "season_extension",
        cropProtection: "crop_protection",
        bedUse: "bed_use",
        windExposure: "wind_exposure",
        frostRisk: "frost_risk",
        seasonExtensionAirOffsetC: "season_extension_air_offset_c",
        seasonExtensionSoilOffsetC: "season_extension_soil_offset_c",
        seasonExtensionFrostShiftDays: "season_extension_frost_shift_days",
        seasonExtensionMinAirTempC: "season_extension_min_air_temp_c"
    };

    const FIELD_DEFS = [
        { key: "sunExposure", label: "Sun exposure", values: ["unknown", "full_sun", "part_sun", "part_shade", "shade"], fallback: "unknown" },
        { key: "soilMoisture", label: "Soil moisture", values: ["unknown", "dry", "moderate", "moist", "wet"], fallback: "unknown" },
        { key: "drainage", label: "Drainage", values: ["unknown", "fast", "normal", "slow"], fallback: "unknown" },
        { key: "soilTexture", label: "Soil texture", values: ["unknown", "sandy", "loamy", "clay", "mixed", "amended"], fallback: "unknown" },
        { key: "fertility", label: "Fertility", values: ["unknown", "low", "medium", "high"], fallback: "unknown" },
        { key: "irrigation", label: "Irrigation", values: ["unknown", "none", "manual", "drip", "sprinkler", "self_watering"], fallback: "unknown" },
        { key: "trellis", label: "Trellis", values: ["unknown", "none", "available", "required_structure"], fallback: "unknown" },
        { key: "seasonExtension", label: "Season extension", values: ["unknown", "none", "row_cover", "low_tunnel", "cold_frame", "greenhouse", "high_tunnel", "heated_greenhouse"], fallback: "unknown" },
        { key: "cropProtection", label: "Crop protection", values: ["unknown", "none", "shade_cloth", "insect_netting", "bird_netting", "hail_netting"], fallback: "unknown" },
        { key: "windExposure", label: "Wind exposure", values: ["unknown", "sheltered", "moderate", "exposed"], fallback: "unknown" },
        { key: "frostRisk", label: "Frost risk", values: ["unknown", "none", "low", "medium", "high"], fallback: "unknown" },
        { key: "bedUse", label: "Bed use", values: ["unknown", "annuals", "perennials", "nursery", "seed_starting", "mixed", "resting"], fallback: "unknown" }
    ];

    const BED_TYPE_FIELD = { key: "bedType", label: "Bed type", values: ["unknown", "field", "raised_bed", "hugelkultur", "container", "greenhouse_bench", "wicking_bed"], fallback: "unknown" };

    const FIELD_BY_KEY = FIELD_DEFS.reduce(function (out, field) {
        out[field.key] = field;
        return out;
    }, Object.create(null));

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

    const VALUE_LABELS = {
        unknown: "Unknown",
        full_sun: "Full sun",
        part_sun: "Part sun",
        part_shade: "Part shade",
        shade: "Shade",
        dry: "Dry",
        moderate: "Moderate",
        moist: "Moist",
        wet: "Wet",
        fast: "Fast drainage",
        normal: "Normal drainage",
        slow: "Slow drainage",
        sandy: "Sandy",
        loamy: "Loamy",
        clay: "Clay",
        mixed: "Mixed",
        amended: "Amended",
        low: "Low",
        medium: "Medium",
        high: "High",
        none: "None",
        manual: "Manual",
        drip: "Drip",
        sprinkler: "Sprinkler",
        self_watering: "Self watering",
        available: "Available",
        required_structure: "Structure required",
        row_cover: "Row cover",
        low_tunnel: "Low tunnel",
        cold_frame: "Cold frame",
        greenhouse: "Greenhouse",
        high_tunnel: "High tunnel",
        heated_greenhouse: "Heated greenhouse",
        shade_cloth: "Shade cloth",
        insect_netting: "Insect netting",
        bird_netting: "Bird netting",
        hail_netting: "Hail netting",
        sheltered: "Sheltered",
        exposed: "Exposed",
        annuals: "Annuals",
        perennials: "Perennials",
        nursery: "Nursery",
        seed_starting: "Seed starting",
        resting: "Resting",
        field: "Field",
        raised_bed: "Raised bed",
        hugelkultur: "Hugelkultur",
        container: "Container",
        greenhouse_bench: "Greenhouse bench",
        wicking_bed: "Wicking bed"
    };

    const PRESETS = {
        "": { label: "Choose preset", values: {} },
        sunny_vegetable: { label: "Sunny vegetable bed", values: { sunExposure: "full_sun", soilMoisture: "moderate", drainage: "normal", soilTexture: "loamy", fertility: "high", irrigation: "unknown", trellis: "unknown", bedUse: "annuals" } },
        shady_greens: { label: "Shady greens bed", values: { sunExposure: "part_shade", soilMoisture: "moist", drainage: "normal", fertility: "medium", irrigation: "unknown", trellis: "unknown", bedUse: "annuals" } },
        dry_herb: { label: "Dry herb bed", values: { sunExposure: "full_sun", soilMoisture: "dry", drainage: "fast", soilTexture: "sandy", fertility: "low", irrigation: "unknown", trellis: "unknown", bedUse: "perennials" } },
        wet_moist: { label: "Wet/moist bed", values: { sunExposure: "part_sun", soilMoisture: "moist", drainage: "slow", fertility: "medium", irrigation: "none", trellis: "unknown", bedUse: "unknown" } },
        nursery: { label: "Nursery bed", values: { sunExposure: "part_sun", soilMoisture: "moderate", drainage: "normal", fertility: "medium", irrigation: "unknown", trellis: "unknown", bedUse: "nursery" } },
        greenhouse: { label: "Greenhouse bed", values: { sunExposure: "full_sun", soilMoisture: "moderate", drainage: "normal", soilTexture: "amended", fertility: "high", irrigation: "drip", trellis: "unknown", seasonExtension: "greenhouse", cropProtection: "unknown", windExposure: "sheltered", frostRisk: "low", bedUse: "seed_starting" } },
        perennial: { label: "Perennial bed", values: { sunExposure: "full_sun", soilMoisture: "moderate", drainage: "normal", fertility: "medium", irrigation: "unknown", trellis: "unknown", bedUse: "perennials" } },
        resting: { label: "Resting bed", values: { sunExposure: "unknown", soilMoisture: "unknown", drainage: "unknown", fertility: "low", irrigation: "unknown", trellis: "unknown", bedUse: "resting" } }
    };

    let copiedProfile = null;
    const selectedBedOverlays = new Map();

    function isGardenBed(cell) {
        if (!cell || !cell.getAttribute) return false;
        return cell.getAttribute("garden_bed") === "1" || cell.getAttribute("gardenBed") === "1" || cell.getAttribute("is_garden_bed") === "1";
    }

    function getCellAttr(cell, key, fallback) {
        if (!cell || !cell.getAttribute) return fallback || "";
        const value = cell.getAttribute(key);
        return value == null ? (fallback || "") : String(value);
    }

    function normalizeBedName(value) {
        const trimmed = String(value == null ? "" : value).trim();
        return trimmed || BED_NAME_FALLBACK;
    }

    function normalizeUserBedName(value) {
        return String(value == null ? "" : value).trim();
    }

    function getBedName(cell) {
        if (!cell) return BED_NAME_FALLBACK;
        const value = cell.value;
        if (value && value.nodeType === 1) return normalizeBedName(value.getAttribute("label") || value.getAttribute("name"));
        return normalizeBedName(value);
    }

    function createXmlDocument() {
        if (typeof mxUtils !== "undefined" && mxUtils.createXmlDocument) return mxUtils.createXmlDocument();
        return document.implementation.createDocument("", "", null);
    }

    function buildXmlValueForEdit(cell) {
        if (!cell) return null;
        const value = cell.value;
        if (value && value.nodeType === 1) return value.cloneNode(true);
        const node = createXmlDocument().createElement("object");
        if (typeof value === "string" && value) node.setAttribute("label", value);
        return node;
    }

    function setCellAttrs(cell, attrs) {
        const node = buildXmlValueForEdit(cell);
        if (!node) return;
        Object.keys(attrs || {}).forEach(function (key) {
            const value = attrs[key];
            if (value == null || value === "") node.removeAttribute(key);
            else node.setAttribute(key, String(value));
        });
        if (model.setValue) model.setValue(cell, node);
    }

    function writeBedName(bedCell, name) {
        if (!isGardenBed(bedCell)) return "";
        const next = normalizeUserBedName(name);
        const current = readBedConditions(bedCell);
        if (current.userBedName === next && getBedName(bedCell) === buildGeneratedBedLabel(current, bedCell)) return next;
        current.userBedName = next;
        writeBedConditions(bedCell, current, { writeIdentityLabel: true });
        return next;
    }

    function nowIso() {
        return new Date().toISOString();
    }

    function valueLabel(value) {
        return VALUE_LABELS[value] || String(value || "").replace(/_/g, " ");
    }

    function listConditionOptionGroups() {
        return FIELD_DEFS.filter(function (field) { return field.key !== "irrigation"; }).map(function (field) {
            return {
                id: field.key,
                name: field.label,
                options: field.values.filter(function (value) { return value !== "unknown"; }).map(function (value) {
                    return { id: field.key + ":" + value, fieldKey: field.key, value: value, name: valueLabel(value), category: field.label };
                })
            };
        }).filter(function (group) { return group.options.length > 0; });
    }

    function normalizeEnumValue(key, value) {
        const field = key === "bedType" ? BED_TYPE_FIELD : FIELD_BY_KEY[key];
        const raw = String(value == null ? "" : value).trim();
        if (!field || field.values.indexOf(raw) < 0) return field ? field.fallback : "";
        return raw;
    }

    function finiteNumberOrNull(value) {
        if (value === null || value === undefined || value === "") return null;
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }

    function normalizePositiveOptionalNumber(value) {
        const n = finiteNumberOrNull(value);
        return n != null && n > 0 ? Math.round(n * 100) / 100 : null;
    }

    function normalizeOptionalNumber(value) {
        const n = finiteNumberOrNull(value);
        return n == null ? null : Math.round(n * 100) / 100;
    }

    function profileHasOwnIdentity(profile) {
        const source = profile && typeof profile === "object" ? profile : {};
        return Object.prototype.hasOwnProperty.call(source, "bedType") || Object.prototype.hasOwnProperty.call(source, "bed_type") ||
            Object.prototype.hasOwnProperty.call(source, "bedHeightCm") || Object.prototype.hasOwnProperty.call(source, "bed_height_cm") ||
            Object.prototype.hasOwnProperty.call(source, "userBedName") || Object.prototype.hasOwnProperty.call(source, "user_bed_name");
    }

    function profileHasMeaningfulIdentity(profile) {
        const source = profile && typeof profile === "object" ? profile : {};
        return normalizeEnumValue("bedType", source.bedType ?? source.bed_type) !== "unknown" ||
            normalizePositiveOptionalNumber(source.bedHeightCm ?? source.bed_height_cm) != null ||
            !!normalizeUserBedName(source.userBedName ?? source.user_bed_name);
    }

    function seasonExtensionDefaults(value) {
        const key = Object.prototype.hasOwnProperty.call(SEASON_EXTENSION_EFFECTS, value) ? value : "unknown";
        return SEASON_EXTENSION_EFFECTS[key] || SEASON_EXTENSION_EFFECTS.unknown;
    }

    function normalizeSeasonExtensionDefault(key, source) {
        const defaults = seasonExtensionDefaults(key);
        const p = source && typeof source === "object" ? source : {};
        return {
            airOffsetC: normalizeOptionalNumber(p.airOffsetC) ?? defaults.airOffsetC,
            soilOffsetC: normalizeOptionalNumber(p.soilOffsetC) ?? defaults.soilOffsetC,
            frostShiftDays: normalizeOptionalNumber(p.frostShiftDays) ?? defaults.frostShiftDays,
            minAirTempC: key === "heated_greenhouse" ? (normalizeOptionalNumber(p.minAirTempC) ?? defaults.minAirTempC) : null
        };
    }

    function parseSeasonExtensionDefaults(raw) {
        if (!raw) return {};
        try {
            const parsed = JSON.parse(raw);
            const source = parsed && typeof parsed === "object" && parsed.defaults && typeof parsed.defaults === "object" ? parsed.defaults : parsed;
            const out = {};
            FIELD_BY_KEY.seasonExtension.values.forEach(function (key) {
                if (key === "unknown" || key === "none" || !source || typeof source[key] !== "object") return;
                out[key] = normalizeSeasonExtensionDefault(key, source[key]);
            });
            return out;
        } catch (e) {
            return {};
        }
    }

    function readModuleSeasonExtensionDefaults(moduleCell) {
        return parseSeasonExtensionDefaults(getCellAttr(moduleCell, ATTRS.SEASON_EXTENSION_DEFAULTS_JSON, ""));
    }

    function resolveSeasonExtensionDefault(targetCell, key) {
        const normalizedKey = normalizeEnumValue("seasonExtension", key);
        const moduleCell = findGardenModuleAncestor(targetCell);
        const moduleDefaults = readModuleSeasonExtensionDefaults(moduleCell);
        return moduleDefaults[normalizedKey] || seasonExtensionDefaults(normalizedKey);
    }

    function writeModuleSeasonExtensionDefault(targetCell, key, effect) {
        const normalizedKey = normalizeEnumValue("seasonExtension", key);
        const moduleCell = findGardenModuleAncestor(targetCell);
        if (!moduleCell || normalizedKey === "unknown" || normalizedKey === "none") return null;
        const moduleDefaults = readModuleSeasonExtensionDefaults(moduleCell);
        moduleDefaults[normalizedKey] = normalizeSeasonExtensionDefault(normalizedKey, effect);
        const attrs = {};
        attrs[ATTRS.SEASON_EXTENSION_DEFAULTS_JSON] = JSON.stringify({ schemaVersion: 1, defaults: moduleDefaults });
        setCellAttrs(moduleCell, attrs);
        return moduleDefaults[normalizedKey];
    }

    function seasonExtensionEffects(profile) {
        const p = profile && typeof profile === "object" ? profile : {};
        const key = normalizeEnumValue("seasonExtension", p.seasonExtension);
        const defaults = seasonExtensionDefaults(key);
        return {
            seasonExtension: key,
            airOffsetC: normalizeOptionalNumber(p.seasonExtensionAirOffsetC) ?? defaults.airOffsetC,
            soilOffsetC: normalizeOptionalNumber(p.seasonExtensionSoilOffsetC) ?? defaults.soilOffsetC,
            frostShiftDays: normalizeOptionalNumber(p.seasonExtensionFrostShiftDays) ?? defaults.frostShiftDays,
            minAirTempC: key === "heated_greenhouse" ? (normalizeOptionalNumber(p.seasonExtensionMinAirTempC) ?? defaults.minAirTempC) : null
        };
    }

    function mergeIdentityAttrsIntoProfile(cell, source) {
        const out = Object.assign({}, source || {});
        if (!profileHasOwnIdentity(out) && cell && cell.getAttribute) {
            const bedType = getCellAttr(cell, IDENTITY_MIRROR_ATTRS.bedType, "");
            const bedHeightCm = getCellAttr(cell, IDENTITY_MIRROR_ATTRS.bedHeightCm, "");
            const userBedName = getCellAttr(cell, IDENTITY_MIRROR_ATTRS.userBedName, "");
            if (bedType) out.bed_type = bedType;
            if (bedHeightCm) out.bed_height_cm = bedHeightCm;
            if (userBedName) out.user_bed_name = userBedName;
        }
        return out;
    }

    function cellHasIdentityAttrs(cell) {
        return !!(cell && cell.getAttribute && (
            getCellAttr(cell, IDENTITY_MIRROR_ATTRS.bedType, "") ||
            getCellAttr(cell, IDENTITY_MIRROR_ATTRS.bedHeightCm, "") ||
            getCellAttr(cell, IDENTITY_MIRROR_ATTRS.userBedName, "")
        ));
    }

    function isValidPresetKey(key) {
        return !!key && !!PRESETS[key];
    }

    function getPresetFieldKeys(presetKey) {
        const preset = isValidPresetKey(presetKey) ? PRESETS[presetKey] : null;
        const values = (preset && preset.values) || {};
        return Object.keys(values).filter(function (key) { return values[key] !== "unknown"; });
    }

    function doesProfileMatchPreset(profile, presetKey) {
        if (!isValidPresetKey(presetKey)) return false;
        const values = PRESETS[presetKey].values || {};
        return getPresetFieldKeys(presetKey).every(function (key) {
            return normalizeEnumValue(key, profile[key]) === normalizeEnumValue(key, values[key]);
        });
    }

    function normalizeProfile(profile, options) {
        const source = profile && typeof profile === "object" ? profile : {};
        const out = { schemaVersion: 1 };
        out.bedType = normalizeEnumValue("bedType", source.bedType ?? source.bed_type);
        out.bedHeightCm = normalizePositiveOptionalNumber(source.bedHeightCm ?? source.bed_height_cm);
        out.userBedName = normalizeUserBedName(source.userBedName ?? source.user_bed_name);
        FIELD_DEFS.forEach(function (field) {
            out[field.key] = normalizeEnumValue(field.key, source[field.key]);
        });
        out.irrigation = "unknown";
        const presetKey = String(source.presetKey || "").trim();
        if (options && options.allowPreset && isValidPresetKey(presetKey)) out.presetKey = presetKey;
        out.notes = String(source.notes || "").trim();
        out.seasonExtensionAirOffsetC = normalizeOptionalNumber(source.seasonExtensionAirOffsetC ?? source.season_extension_air_offset_c);
        out.seasonExtensionSoilOffsetC = normalizeOptionalNumber(source.seasonExtensionSoilOffsetC ?? source.season_extension_soil_offset_c);
        out.seasonExtensionFrostShiftDays = normalizeOptionalNumber(source.seasonExtensionFrostShiftDays ?? source.season_extension_frost_shift_days);
        out.seasonExtensionMinAirTempC = out.seasonExtension === "heated_greenhouse"
            ? normalizeOptionalNumber(source.seasonExtensionMinAirTempC ?? source.season_extension_min_air_temp_c)
            : null;
        out.lastUpdated = String(source.lastUpdated || (options && options.keepExistingDate ? "" : nowIso()));
        return out;
    }

    function parseProfileRecord(cell, attrName) {
        const options = { keepExistingDate: true, allowPreset: attrName === ATTRS.BED_JSON };
        const raw = getCellAttr(cell, attrName, "");
        if (!raw) return { raw: "", invalid: false, profile: normalizeProfile(mergeIdentityAttrsIntoProfile(cell, {}), options) };
        try {
            return { raw: raw, invalid: false, profile: normalizeProfile(mergeIdentityAttrsIntoProfile(cell, JSON.parse(raw)), options) };
        } catch (e) {
            return { raw: raw, invalid: true, profile: normalizeProfile(mergeIdentityAttrsIntoProfile(cell, {}), options) };
        }
    }

    function readBedConditions(bedCell) {
        return parseProfileRecord(bedCell, ATTRS.BED_JSON).profile;
    }

    function buildMirrorAttrs(profile) {
        const attrs = {};
        Object.keys(MIRROR_ATTRS).forEach(function (key) {
            attrs[MIRROR_ATTRS[key]] = profile[key];
        });
        return attrs;
    }

    function buildIdentityMirrorAttrs(profile) {
        const attrs = {};
        attrs[IDENTITY_MIRROR_ATTRS.bedType] = profile.bedType === "unknown" ? null : profile.bedType;
        attrs[IDENTITY_MIRROR_ATTRS.bedHeightCm] = profile.bedHeightCm == null ? null : profile.bedHeightCm;
        attrs[IDENTITY_MIRROR_ATTRS.userBedName] = profile.userBedName || null;
        return attrs;
    }

    function formatDisplayNumber(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return "";
        const rounded = Math.round(n * 10) / 10;
        return Number.isInteger(rounded) ? String(rounded) : String(rounded);
    }

    function heightCmToDisplayValue(cm, units) {
        const n = normalizePositiveOptionalNumber(cm);
        if (n == null) return "";
        return units === "imperial" ? formatDisplayNumber(n / CM_PER_INCH) : formatDisplayNumber(n);
    }

    function displayHeightToCm(value, units) {
        const n = finiteNumberOrNull(value);
        if (n == null || n <= 0) return null;
        return Math.round((units === "imperial" ? n * CM_PER_INCH : n) * 100) / 100;
    }

    function formatBedHeight(cm, units) {
        const value = heightCmToDisplayValue(cm, units);
        if (!value) return "";
        return value + " " + (units === "imperial" ? "in" : "cm");
    }

    function buildGeneratedBedLabel(profile, bedCell) {
        const normalized = normalizeProfile(profile, { keepExistingDate: true, allowPreset: true });
        const parts = [];
        if (normalized.bedType !== "unknown") {
            let prefix = valueLabel(normalized.bedType);
            const height = formatBedHeight(normalized.bedHeightCm, resolveUnitSystem(bedCell));
            if (height) prefix += " (" + height + ")";
            parts.push(prefix);
        }
        if (normalized.userBedName) parts.push(normalized.userBedName);
        return parts.length ? parts.join(" - ") : BED_NAME_FALLBACK;
    }

    function shouldWriteGeneratedLabel(bedCell, sourceProfile, normalizedProfile, options) {
        if (options && options.writeIdentityLabel) return true;
        if (profileHasMeaningfulIdentity(sourceProfile) || profileHasMeaningfulIdentity(normalizedProfile)) return true;
        return cellHasIdentityAttrs(bedCell);
    }

    function writeBedConditions(bedCell, profile, options) {
        if (!isGardenBed(bedCell)) return null;
        const source = mergeIdentityAttrsIntoProfile(bedCell, profile);
        const normalized = normalizeProfile(source, { allowPreset: true });
        const attrs = buildMirrorAttrs(normalized);
        Object.assign(attrs, buildIdentityMirrorAttrs(normalized));
        attrs[ATTRS.BED_JSON] = JSON.stringify(normalized);
        if (shouldWriteGeneratedLabel(bedCell, source, normalized, options)) attrs.label = buildGeneratedBedLabel(normalized, bedCell);
        setCellAttrs(bedCell, attrs);
        refreshSelectedBedOverlaysSoon();
        return normalized;
    }

    function clearBedConditions(bedCell) {
        if (!isGardenBed(bedCell)) return;
        const current = readBedConditions(bedCell);
        const keepIdentity = profileHasMeaningfulIdentity(current) || cellHasIdentityAttrs(bedCell);
        const identityOnly = keepIdentity ? normalizeProfile({ bedType: current.bedType, bedHeightCm: current.bedHeightCm, userBedName: current.userBedName }, { allowPreset: true }) : null;
        const attrs = { [ATTRS.BED_JSON]: keepIdentity ? JSON.stringify(identityOnly) : null };
        Object.keys(MIRROR_ATTRS).forEach(function (key) {
            attrs[MIRROR_ATTRS[key]] = null;
        });
        if (keepIdentity) {
            Object.assign(attrs, buildIdentityMirrorAttrs(identityOnly));
            attrs.label = buildGeneratedBedLabel(identityOnly, bedCell);
        }
        setCellAttrs(bedCell, attrs);
        refreshSelectedBedOverlaysSoon();
    }

    function isMeaningfulOverride(key, value) {
        if (key === "irrigation") return !!value && value !== "unknown";
        if (key === "trellis") return value === "none" || value === "available" || value === "required_structure";
        return !!value && value !== "unknown";
    }

    function derivedIrrigationDisplayValue(bedCell) {
        const moduleCell = findGardenModuleAncestor(bedCell);
        const planner = graph.__trellisIrrigationPlanner || (typeof window !== "undefined" && window.TrellisIrrigationPlanner);
        if (!planner || typeof planner.getBedIrrigationMethods !== "function") return "unknown";
        const methods = planner.getBedIrrigationMethods(moduleCell, bedCell) || [];
        const labels = methods.map(function (method) { return String(method && method.label || "").trim(); }).filter(Boolean);
        return labels.length ? labels.join(", ") : "unknown";
    }

    function getDisplayBedConditions(bedCell) {
        const bedRecord = parseProfileRecord(bedCell, ATTRS.BED_JSON);
        const out = normalizeProfile({}, { keepExistingDate: true });
        FIELD_DEFS.forEach(function (field) {
            if (field.key === "irrigation") return;
            const value = bedRecord.profile[field.key];
            if (isMeaningfulOverride(field.key, value)) out[field.key] = value;
        });
        out.irrigation = derivedIrrigationDisplayValue(bedCell);
        if (bedRecord.profile.notes) out.notes = bedRecord.profile.notes;
        if (isValidPresetKey(bedRecord.profile.presetKey)) out.presetKey = bedRecord.profile.presetKey;
        out.lastUpdated = bedRecord.profile.lastUpdated || "";
        return out;
    }

    function isBedCompatibleWithCrop() {
        return { compatible: true, hardFailures: [], warnings: [] };
    }

    function scoreBedSuitability() {
        return { score: 0, reasons: [] };
    }

    function getCellId(cell) {
        return cell && cell.getId ? cell.getId() : (cell && cell.id);
    }

    function collectSelectedBeds(fallbackBed) {
        const cells = graph.getSelectionCells ? (graph.getSelectionCells() || []) : [];
        const byId = new Map();
        cells.forEach(function (cell) {
            if (isGardenBed(cell)) byId.set(getCellId(cell), cell);
        });
        if (!byId.size && fallbackBed) byId.set(getCellId(fallbackBed), fallbackBed);
        return Array.from(byId.values());
    }

    function makeSelect(field, value) {
        const select = document.createElement("select");
        select.style.width = "100%";
        field.values.forEach(function (optionValue) {
            const option = document.createElement("option");
            option.value = optionValue;
            option.textContent = valueLabel(optionValue);
            select.appendChild(option);
        });
        select.value = normalizeEnumValue(field.key, value);
        return select;
    }

    function makeReadOnlyText(value) {
        const span = document.createElement("span");
        span.textContent = valueLabel(value);
        span.setAttribute("data-bed-derived-irrigation", "1");
        span.style.display = "block";
        span.style.padding = "3px 0";
        span.style.color = "#374151";
        span.style.fontWeight = "600";
        return span;
    }

    function appendSection(container, title) {
        const section = document.createElement("div");
        section.style.borderTop = "1px solid #e5e7eb";
        section.style.paddingTop = "8px";
        section.style.marginTop = "8px";
        const label = document.createElement("div");
        label.textContent = title;
        label.style.fontWeight = "bold";
        label.style.marginBottom = "6px";
        section.appendChild(label);
        container.appendChild(section);
        return section;
    }

    function appendField(section, field, input) {
        const row = document.createElement("label");
        row.style.display = "grid";
        row.style.gridTemplateColumns = "130px 1fr";
        row.style.alignItems = "center";
        row.style.gap = "8px";
        row.style.marginBottom = "6px";
        const text = document.createElement("span");
        text.textContent = field.label;
        row.appendChild(text);
        row.appendChild(input);
        section.appendChild(row);
    }

    function isGardenModule(cell) {
        return !!cell && cell.getAttribute && cell.getAttribute("garden_module") === "1";
    }

    function findGardenModuleAncestor(cell) {
        for (let cur = cell; cur; cur = model.getParent ? model.getParent(cur) : null) {
            if (isGardenModule(cur)) return cur;
        }
        return null;
    }

    function resolveUnitSystem(cell) {
        const moduleCell = findGardenModuleAncestor(cell);
        return String(moduleCell && moduleCell.getAttribute ? moduleCell.getAttribute("unit_system") : "").trim() === "imperial" ? "imperial" : "metric";
    }

    function cToDisplayTemp(c, units) {
        const n = Number(c);
        if (!Number.isFinite(n)) return "";
        return units === "imperial" ? String(Math.round((n * 9 / 5 + 32) * 100) / 100) : String(Math.round(n * 100) / 100);
    }

    function displayTempToC(value, units) {
        const n = finiteNumberOrNull(value);
        if (n == null) return null;
        return units === "imperial" ? Math.round(((n - 32) * 5 / 9) * 100) / 100 : Math.round(n * 100) / 100;
    }

    function makeNumberInput(value) {
        const input = document.createElement("input");
        input.type = "number";
        input.step = "0.1";
        input.value = value == null ? "" : String(value);
        input.style.width = "100%";
        return input;
    }

    function formatSigned(value, suffix) {
        const n = Number(value);
        if (!Number.isFinite(n)) return "";
        return `${n > 0 ? "+" : ""}${Math.round(n * 100) / 100}${suffix || ""}`;
    }

    function conditionDialogHeight() {
        const viewportHeight = typeof window !== "undefined" && Number.isFinite(Number(window.innerHeight)) ? Number(window.innerHeight) : 730;
        return Math.max(360, Math.min(650, viewportHeight - 80));
    }

    function makeSeasonExtensionAdvancedSection(container, targetCell, current, controls) {
        const units = resolveUnitSystem(targetCell);
        const tempLabel = units === "imperial" ? "F" : "C";
        const section = appendSection(container, "Advanced season extension");
        section.setAttribute("data-bed-season-extension-advanced", "1");
        const defaultsRow = document.createElement("div");
        defaultsRow.style.display = "flex";
        defaultsRow.style.alignItems = "center";
        defaultsRow.style.justifyContent = "space-between";
        defaultsRow.style.gap = "8px";
        defaultsRow.style.margin = "2px 0 8px";
        const defaults = document.createElement("div");
        defaults.style.flex = "1 1 auto";
        defaults.style.fontSize = "12px";
        defaults.style.color = "#374151";
        defaultsRow.appendChild(defaults);
        const airInput = makeNumberInput(current.seasonExtensionAirOffsetC == null ? "" : cToDisplayTemp(current.seasonExtensionAirOffsetC, units));
        const soilInput = makeNumberInput(current.seasonExtensionSoilOffsetC == null ? "" : cToDisplayTemp(current.seasonExtensionSoilOffsetC, units));
        const frostInput = makeNumberInput(current.seasonExtensionFrostShiftDays);
        const minInput = makeNumberInput(current.seasonExtensionMinAirTempC == null ? "" : cToDisplayTemp(current.seasonExtensionMinAirTempC, units));
        const saveDefaultsButton = bedButton("Set as defaults", function () {
            const key = controls.seasonExtension.value;
            const effect = readInputsAsEffect(key, resolveSeasonExtensionDefault(targetCell, key));
            model.beginUpdate();
            try {
                writeModuleSeasonExtensionDefault(targetCell, key, effect);
            } finally {
                model.endUpdate();
            }
            refresh();
        });
        defaultsRow.appendChild(saveDefaultsButton);
        section.appendChild(defaultsRow);
        controls.seasonExtensionAirOffsetC = airInput;
        controls.seasonExtensionSoilOffsetC = soilInput;
        controls.seasonExtensionFrostShiftDays = frostInput;
        controls.seasonExtensionMinAirTempC = minInput;
        appendField(section, { label: `Air offset (${tempLabel})` }, airInput);
        appendField(section, { label: `Soil offset (${tempLabel})` }, soilInput);
        appendField(section, { label: "Frost shift (days)" }, frostInput);
        appendField(section, { label: `Min air (${tempLabel})` }, minInput);
        function setInputsFromEffect(effect) {
            airInput.value = cToDisplayTemp(effect.airOffsetC, units);
            soilInput.value = cToDisplayTemp(effect.soilOffsetC, units);
            frostInput.value = effect.frostShiftDays == null ? "" : String(effect.frostShiftDays);
            minInput.value = effect.minAirTempC == null ? "" : cToDisplayTemp(effect.minAirTempC, units);
        }
        function readInputsAsEffect(key, fallback) {
            return {
                airOffsetC: displayTempToC(airInput.value, units) ?? fallback.airOffsetC,
                soilOffsetC: displayTempToC(soilInput.value, units) ?? fallback.soilOffsetC,
                frostShiftDays: normalizeOptionalNumber(frostInput.value) ?? fallback.frostShiftDays,
                minAirTempC: key === "heated_greenhouse" ? (displayTempToC(minInput.value, units) ?? fallback.minAirTempC) : null
            };
        }
        function refresh(options) {
            const key = controls.seasonExtension.value;
            const show = key && key !== "unknown" && key !== "none";
            const effect = resolveSeasonExtensionDefault(targetCell, key);
            if (options && options.resetValues) setInputsFromEffect(effect);
            section.style.display = show ? "block" : "none";
            saveDefaultsButton.style.display = show ? "" : "none";
            minInput.parentNode.style.display = key === "heated_greenhouse" ? "grid" : "none";
            defaults.textContent = show
                ? `Defaults: air ${formatSigned(units === "imperial" ? effect.airOffsetC * 9 / 5 : effect.airOffsetC, " " + tempLabel)}, soil ${formatSigned(units === "imperial" ? effect.soilOffsetC * 9 / 5 : effect.soilOffsetC, " " + tempLabel)}, frost ${formatSigned(effect.frostShiftDays, " days")}${key === "heated_greenhouse" ? `, min ${cToDisplayTemp(effect.minAirTempC, units)} ${tempLabel}` : ""}. Blank fields use defaults.`
                : "";
        }
        controls.seasonExtension.addEventListener("change", function () { refresh({ resetValues: true }); });
        refresh();
        return { units, section, refresh };
    }

    function elevateBedConditionsDialog() {
        const dlg = ui && ui.dialog;
        if (dlg && dlg.bg && dlg.bg.style) dlg.bg.style.zIndex = String(TRELLIS_DIALOG_Z - 1);
        if (dlg && dlg.container && dlg.container.style) dlg.container.style.zIndex = String(TRELLIS_DIALOG_Z);
    }

    function showConditionEditorDialog(targetCell) {
        const current = readBedConditions(targetCell);
        const dialogHeight = conditionDialogHeight();
        const div = document.createElement("div");
        div.style.fontSize = "13px";
        div.style.display = "flex";
        div.style.flexDirection = "column";
        div.style.height = "100%";
        div.style.maxHeight = dialogHeight + "px";
        const body = document.createElement("div");
        body.setAttribute("data-bed-conditions-dialog-body", "1");
        body.style.flex = "1 1 auto";
        body.style.minHeight = "0px";
        body.style.overflowY = "auto";
        body.style.padding = "14px";
        div.appendChild(body);
        const title = document.createElement("h3");
        title.textContent = "Bed Conditions";
        title.style.margin = "0 0 10px";
        body.appendChild(title);

        const controls = Object.create(null);
        const identityUnits = resolveUnitSystem(targetCell);
        const identity = appendSection(body, "Bed Identity");
        controls.bedType = makeSelect(BED_TYPE_FIELD, current.bedType);
        appendField(identity, BED_TYPE_FIELD, controls.bedType);
        controls.bedHeight = makeNumberInput(heightCmToDisplayValue(current.bedHeightCm, identityUnits));
        controls.bedHeight.step = identityUnits === "imperial" ? "0.5" : "1";
        controls.bedHeight.min = "0";
        appendField(identity, { label: "Height (" + (identityUnits === "imperial" ? "in" : "cm") + ")" }, controls.bedHeight);
        controls.userBedName = document.createElement("input");
        controls.userBedName.type = "text";
        controls.userBedName.value = current.userBedName || "";
        controls.userBedName.style.width = "100%";
        appendField(identity, { label: "User name" }, controls.userBedName);

        const presetRow = document.createElement("label");
        presetRow.style.display = "grid";
        presetRow.style.gridTemplateColumns = "130px 1fr";
        presetRow.style.alignItems = "center";
        presetRow.style.gap = "8px";
        const presetSelect = document.createElement("select");
        Object.keys(PRESETS).forEach(function (key) {
            const option = document.createElement("option");
            option.value = key;
            option.textContent = PRESETS[key].label;
            presetSelect.appendChild(option);
        });
        if (current.presetKey) presetSelect.value = current.presetKey;
        presetRow.appendChild(document.createTextNode("Preset"));
        presetRow.appendChild(presetSelect);
        body.appendChild(presetRow);

        const growing = appendSection(body, "Growing Conditions");
        ["sunExposure", "windExposure", "frostRisk", "soilMoisture", "drainage", "soilTexture", "fertility"].forEach(function (key) {
            controls[key] = makeSelect(FIELD_BY_KEY[key], current[key]);
            appendField(growing, FIELD_BY_KEY[key], controls[key]);
        });

        const infra = appendSection(body, "Infrastructure");
        appendField(infra, FIELD_BY_KEY.irrigation, makeReadOnlyText(derivedIrrigationDisplayValue(targetCell)));
        ["trellis", "seasonExtension", "cropProtection"].forEach(function (key) {
            controls[key] = makeSelect(FIELD_BY_KEY[key], current[key]);
            appendField(infra, FIELD_BY_KEY[key], controls[key]);
        });
        const advancedSeasonExtension = makeSeasonExtensionAdvancedSection(infra, targetCell, current, controls);

        const use = appendSection(body, "Use");
        controls.bedUse = makeSelect(FIELD_BY_KEY.bedUse, current.bedUse);
        appendField(use, FIELD_BY_KEY.bedUse, controls.bedUse);

        const notesInput = document.createElement("textarea");
        notesInput.value = current.notes || "";
        notesInput.rows = 3;
        notesInput.style.width = "100%";
        appendField(use, { label: "Notes" }, notesInput);

        presetSelect.addEventListener("change", function () {
            const preset = PRESETS[presetSelect.value];
            const presetValues = (preset && preset.values) || {};
            Object.keys(presetValues).forEach(function (key) {
                if (controls[key]) controls[key].value = presetValues[key];
            });
            advancedSeasonExtension.refresh({ resetValues: Object.prototype.hasOwnProperty.call(presetValues, "seasonExtension") });
        });

        function readDialogProfile() {
            const next = {};
            next.bedType = controls.bedType.value;
            next.bedHeightCm = displayHeightToCm(controls.bedHeight.value, identityUnits);
            next.userBedName = controls.userBedName.value;
            FIELD_DEFS.forEach(function (field) { next[field.key] = controls[field.key] ? controls[field.key].value : "unknown"; });
            next.seasonExtensionAirOffsetC = displayTempToC(controls.seasonExtensionAirOffsetC.value, advancedSeasonExtension.units);
            next.seasonExtensionSoilOffsetC = displayTempToC(controls.seasonExtensionSoilOffsetC.value, advancedSeasonExtension.units);
            next.seasonExtensionFrostShiftDays = normalizeOptionalNumber(controls.seasonExtensionFrostShiftDays.value);
            next.seasonExtensionMinAirTempC = next.seasonExtension === "heated_greenhouse"
                ? displayTempToC(controls.seasonExtensionMinAirTempC.value, advancedSeasonExtension.units)
                : null;
            next.presetKey = presetSelect.value;
            next.notes = notesInput.value;
            return next;
        }

        const footer = document.createElement("div");
        footer.style.flex = "0 0 auto";
        footer.style.padding = "0 14px 14px";
        const actionRow = document.createElement("div");
        actionRow.style.display = "flex";
        actionRow.style.justifyContent = "space-between";
        actionRow.style.alignItems = "center";
        actionRow.style.gap = "8px";
        actionRow.style.marginTop = "12px";
        actionRow.style.paddingTop = "10px";
        actionRow.style.borderTop = "1px solid #e5e7eb";
        const secondaryButtons = document.createElement("div");
        secondaryButtons.style.display = "flex";
        secondaryButtons.style.gap = "8px";
        actionRow.appendChild(document.createElement("span"));
        secondaryButtons.appendChild(bedButton("Copy", function () { copiedProfile = normalizeProfile(readDialogProfile(), { allowPreset: true }); }, "neutral"));
        secondaryButtons.appendChild(bedButton("Paste", function () {
            if (!copiedProfile) { ui.alert("No copied bed conditions are available."); return; }
            const targets = collectSelectedBeds(targetCell);
            model.beginUpdate();
            try { targets.forEach(function (target) { writeBedConditions(target, copiedProfile, { writeIdentityLabel: true }); }); }
            finally { model.endUpdate(); }
            ui.hideDialog();
        }, "add"));
        secondaryButtons.appendChild(bedButton("Clear", function () {
            const targets = collectSelectedBeds(targetCell);
            model.beginUpdate();
            try { targets.forEach(clearBedConditions); }
            finally { model.endUpdate(); }
            ui.hideDialog();
        }, "danger"));

        actionRow.appendChild(secondaryButtons);
        footer.appendChild(actionRow);

        const buttonRow = document.createElement("div");
        buttonRow.style.display = "flex";
        buttonRow.style.justifyContent = "flex-end";
        buttonRow.style.gap = "8px";
        buttonRow.style.marginTop = "12px";
        buttonRow.appendChild(bedButton("Cancel", function () { ui.hideDialog(); }, "neutral"));
        buttonRow.appendChild(bedButton("Save", function () {
            if (String(controls.bedHeight.value || "").trim() && displayHeightToCm(controls.bedHeight.value, identityUnits) == null) { ui.alert("Bed height must be greater than 0."); controls.bedHeight.focus(); return; }
            model.beginUpdate();
            try {
                writeBedConditions(targetCell, readDialogProfile(), { writeIdentityLabel: true });
            } finally {
                model.endUpdate();
            }
            ui.hideDialog();
        }, "add"));
        footer.appendChild(buttonRow);
        div.appendChild(footer);
        ui.showDialog(div, 520, dialogHeight, true, true);
        elevateBedConditionsDialog();
    }

    function isOverlayDisplayValue(key, value) {
        if (!value || value === "unknown") return false;
        if (key === "trellis" && value === "none") return false;
        if ((key === "seasonExtension" || key === "cropProtection") && value === "none") return false;
        return true;
    }

    function addHeadingRow(rows, label) {
        rows.push({ type: "heading", label: label });
    }

    function makeOverlayValueRow(field, value) {
        return { label: field.label, value: valueLabel(value) };
    }

    function isPresetOverride(profile, presetKey, field) {
        const preset = isValidPresetKey(presetKey) ? PRESETS[presetKey] : null;
        if (!preset || !Object.prototype.hasOwnProperty.call(preset.values || {}, field.key)) return false;
        return normalizeEnumValue(field.key, profile && profile[field.key]) !== normalizeEnumValue(field.key, preset.values[field.key]);
    }

    function buildOverlayRows(profile) {
        const rows = [];
        const presetKey = profile && isValidPresetKey(profile.presetKey) ? profile.presetKey : "";
        const presetFields = new Set(getPresetFieldKeys(presetKey));
        if (presetKey) rows.push({ label: "Preset", value: PRESETS[presetKey].label });
        const presetOverrides = [];
        const additional = [];
        FIELD_DEFS.forEach(function (field) {
            const value = profile && profile[field.key];
            if (!isOverlayDisplayValue(field.key, value)) return;
            if (presetFields.has(field.key)) {
                if (isPresetOverride(profile, presetKey, field)) presetOverrides.push(makeOverlayValueRow(field, value));
                return;
            }
            additional.push(makeOverlayValueRow(field, value));
        });
        if (presetOverrides.length) {
            addHeadingRow(rows, "Preset overrides");
            Array.prototype.push.apply(rows, presetOverrides);
        }
        if (presetKey && additional.length) addHeadingRow(rows, "Additional");
        Array.prototype.push.apply(rows, additional);
        if (profile && profile.notes) rows.push({ type: "notes", label: "Notes", value: profile.notes });
        return rows;
    }

    function stopGraphDomEvent(evt) {
        if (evt && evt.stopPropagation) evt.stopPropagation();
    }

    function stopAndPreventGraphDomEvent(evt) {
        stopGraphDomEvent(evt);
        if (evt && evt.preventDefault) evt.preventDefault();
    }

    function estimateOverlayTextWidth(value) {
        const lines = String(value == null ? "" : value).split(/\r?\n/);
        return lines.reduce(function (max, line) { return Math.max(max, line.length * OVERLAY_AVG_CHAR_WIDTH); }, 0);
    }

    function estimateSelectedBedOverlayLayout(rows) {
        let width = OVERLAY_MIN_WIDTH;
        let labelColumnWidth = OVERLAY_MIN_LABEL_WIDTH;
        const sourceRows = rows || [];
        function includeContentWidth(contentWidth) { width = Math.max(width, Math.ceil(OVERLAY_PADDING_X + contentWidth)); }
        includeContentWidth(estimateOverlayTextWidth("Set Bed Conditions") + OVERLAY_CONTROL_CHROME_WIDTH);
        if (!sourceRows.length) includeContentWidth(estimateOverlayTextWidth("No set conditions"));
        sourceRows.forEach(function (row) {
            if (row.type === "heading") {
                includeContentWidth(estimateOverlayTextWidth(row.label));
                return;
            }
            if (row.type === "notes") {
                includeContentWidth(Math.max(estimateOverlayTextWidth(row.label), estimateOverlayTextWidth(row.value)));
                return;
            }
            labelColumnWidth = Math.max(labelColumnWidth, estimateOverlayTextWidth(row.label));
        }, "neutral");
        sourceRows.forEach(function (row) {
            if (row.type === "heading" || row.type === "notes") return;
            includeContentWidth(labelColumnWidth + OVERLAY_ROW_GAP + estimateOverlayTextWidth(row.value));
        });
        return { width: Math.ceil(width), labelColumnWidth: Math.ceil(labelColumnWidth) };
    }

    function createSelectedBedOverlay() {
        const div = document.createElement("div");
        div.className = "trellis-bed-conditions-overlay";
        div.style.position = "absolute";
        div.style.pointerEvents = "auto";
        div.style.zIndex = String(GRAPH_OVERLAY_Z.CONTROL);
        div.style.boxSizing = "border-box";
        div.style.minWidth = OVERLAY_MIN_WIDTH + "px";
        div.style.padding = "8px";
        div.style.borderRadius = "6px";
        div.style.fontSize = "12px";
        div.style.lineHeight = "16px";
        div.style.color = "#111827";
        div.style.background = "rgba(255, 255, 255, 0.96)";
        div.style.border = "1px solid rgba(75, 85, 99, 0.45)";
        div.style.boxShadow = "0 2px 7px rgba(0,0,0,0.18)";
        return div;
    }

    function createBedNameInput(entry) {
        const initialName = readBedConditions(entry.cell).userBedName || "";
        const input = document.createElement("input");
        input.type = "text";
        input.value = initialName;
        input.setAttribute("aria-label", "User name");
        input.style.boxSizing = "border-box";
        input.style.display = "block";
        input.style.width = "100%";
        input.style.minWidth = "0";
        input.style.marginBottom = "6px";
        input.style.fontWeight = "600";
        input.style.border = "1px solid rgba(75, 85, 99, 0.35)";
        input.style.borderRadius = "4px";
        input.style.padding = "3px 5px";
        input.style.fontSize = "12px";
        input.style.lineHeight = "16px";
        ["mousedown", "mouseup", "click", "dblclick", "pointerdown", "pointerup"].forEach(function (type) {
            input.addEventListener(type, stopGraphDomEvent);
        });
        input.addEventListener("keydown", function (evt) {
            stopGraphDomEvent(evt);
            if (evt.key === "Enter") {
                input.value = writeBedName(entry.cell, input.value);
                if (input.blur) input.blur();
                stopAndPreventGraphDomEvent(evt);
            } else if (evt.key === "Escape") {
                input.value = initialName;
                stopAndPreventGraphDomEvent(evt);
            }
        });
        ["keypress", "keyup"].forEach(function (type) { input.addEventListener(type, stopGraphDomEvent); });
        input.addEventListener("blur", function () { input.value = writeBedName(entry.cell, input.value); });
        return input;
    }

    function ensureOverlayContainer() {
        if (!graph.container) return;
        const style = window.getComputedStyle ? window.getComputedStyle(graph.container) : null;
        if (style && style.position === "static") graph.container.style.position = "relative";
    }

    function renderSelectedBedOverlay(entry) {
        entry.div.innerHTML = "";
        const rows = buildOverlayRows(getDisplayBedConditions(entry.cell));
        const layout = estimateSelectedBedOverlayLayout(rows);
        entry.div.style.width = layout.width + "px";
        entry.div.appendChild(createBedNameInput(entry));
        const button = bedButton("Set Bed Conditions", function () { showConditionEditorDialog(entry.cell); }, "open");
        button.style.display = "block";
        button.style.width = "100%";
        button.style.marginBottom = "6px";
        entry.div.appendChild(button);
        if (!rows.length) {
            const empty = document.createElement("div");
            empty.textContent = "No set conditions";
            empty.style.color = "#6b7280";
            entry.div.appendChild(empty);
            return;
        }
        rows.forEach(function (row) {
            if (row.type === "heading") {
                const heading = document.createElement("div");
                heading.textContent = row.label;
                heading.style.marginTop = "6px";
                heading.style.paddingTop = "5px";
                heading.style.borderTop = "1px solid rgba(209, 213, 219, 0.8)";
                heading.style.color = "#374151";
                heading.style.fontWeight = "700";
                entry.div.appendChild(heading);
                return;
            }
            if (row.type === "notes") {
                const notes = document.createElement("div");
                notes.style.marginTop = "8px";
                notes.style.paddingTop = "6px";
                notes.style.borderTop = "1px solid rgba(209, 213, 219, 0.8)";
                const notesLabel = document.createElement("div");
                notesLabel.textContent = row.label;
                notesLabel.style.color = "#374151";
                notesLabel.style.fontWeight = "700";
                const notesValue = document.createElement("div");
                notesValue.textContent = row.value;
                notesValue.style.marginTop = "3px";
                notesValue.style.whiteSpace = "pre-wrap";
                notesValue.style.wordBreak = "break-word";
                notes.appendChild(notesLabel);
                notes.appendChild(notesValue);
                entry.div.appendChild(notes);
                return;
            }
            const line = document.createElement("div");
            line.style.display = "grid";
            line.style.gridTemplateColumns = layout.labelColumnWidth + "px 1fr";
            line.style.gap = "6px";
            line.style.marginTop = "3px";
            const label = document.createElement("span");
            label.textContent = row.label;
            label.style.color = "#4b5563";
            label.style.whiteSpace = "nowrap";
            const value = document.createElement("span");
            value.textContent = row.value;
            value.style.fontWeight = "600";
            value.style.whiteSpace = "nowrap";
            line.appendChild(label);
            line.appendChild(value);
            entry.div.appendChild(line);
        });
    }

    function selectedBedOverlayWidth(entry) {
        const styledWidth = Number.parseFloat(entry && entry.div && entry.div.style ? entry.div.style.width : "");
        if (Number.isFinite(styledWidth) && styledWidth > 0) return styledWidth;
        return (entry && entry.div && entry.div.offsetWidth) || OVERLAY_MIN_WIDTH;
    }

    function positionSelectedBedOverlay(entry) {
        const state = graph.view && graph.view.getState ? graph.view.getState(entry.cell) : null;
        if (!state) return false;
        const width = selectedBedOverlayWidth(entry);
        const gap = 8;
        const overlayHeight = entry.div.offsetHeight || 0;
        const left = Math.round(state.x - width - gap); // CHANGE: selected bed overlays intentionally do not clamp to the viewport
        const top = Math.round(state.y + ((state.height || 0) - overlayHeight) / 2); // CHANGE: selected bed overlays intentionally do not clamp to the viewport
        entry.div.style.left = left + "px";
        entry.div.style.top = top + "px";
        return true;
    }

    function removeSelectedBedOverlay(cellId) {
        const entry = selectedBedOverlays.get(cellId);
        if (!entry) return;
        if (entry.div && entry.div.parentNode) entry.div.parentNode.removeChild(entry.div);
        selectedBedOverlays.delete(cellId);
    }

    function clearSelectedBedOverlays() {
        Array.from(selectedBedOverlays.keys()).forEach(removeSelectedBedOverlay);
    }

    function visitModelCells(cell, visitor) {
        if (!cell || !visitor) return;
        visitor(cell);
        const count = model.getChildCount ? model.getChildCount(cell) : 0;
        for (let i = 0; i < count; i++) visitModelCells(model.getChildAt(cell, i), visitor);
    }

    function syncGeneratedBedLabels() {
        if (syncGeneratedBedLabels.running || !model.getRoot) return;
        const updates = [];
        visitModelCells(model.getRoot(), function (cell) {
            if (!isGardenBed(cell)) return;
            const profile = readBedConditions(cell);
            if (!cellHasIdentityAttrs(cell) && !profileHasMeaningfulIdentity(profile)) return;
            const nextLabel = buildGeneratedBedLabel(profile, cell);
            if (getBedName(cell) !== nextLabel) updates.push({ cell: cell, label: nextLabel });
        });
        if (!updates.length) return;
        syncGeneratedBedLabels.running = true;
        model.beginUpdate && model.beginUpdate();
        try { updates.forEach(function (entry) { setCellAttrs(entry.cell, { label: entry.label }); }); }
        finally { if (model.endUpdate) model.endUpdate(); syncGeneratedBedLabels.running = false; }
    }

    function isIrrigationModeActiveForBedOverlay() {
        const planner = graph.__trellisIrrigationPlanner || (typeof window !== "undefined" && window.TrellisIrrigationPlanner);
        return !!(planner && typeof planner.isIrrigationModeActive === "function" && planner.isIrrigationModeActive());
    }

    function getSelectedGardenBedsForOverlay() {
        const cells = graph.getSelectionCells ? (graph.getSelectionCells() || []) : [];
        if (!cells.length || cells.some(function (cell) { return !isGardenBed(cell); })) return [];
        const byId = new Map();
        cells.forEach(function (cell) { byId.set(getCellId(cell), cell); });
        return Array.from(byId.values());
    }

    function syncSelectedBedOverlays() {
        ensureOverlayContainer();
        if (!graph.container) return;
        if (isIrrigationModeActiveForBedOverlay()) { clearSelectedBedOverlays(); return; }
        const beds = getSelectedGardenBedsForOverlay();
        const keep = new Set();
        beds.forEach(function (bed) {
            const id = getCellId(bed);
            if (!id) return;
            keep.add(id);
            let entry = selectedBedOverlays.get(id);
            if (!entry) {
                entry = { cell: bed, div: createSelectedBedOverlay() };
                graph.container.appendChild(entry.div);
                selectedBedOverlays.set(id, entry);
            }
            entry.cell = bed;
            renderSelectedBedOverlay(entry);
            if (!positionSelectedBedOverlay(entry)) removeSelectedBedOverlay(id);
        });
        Array.from(selectedBedOverlays.keys()).forEach(function (id) {
            if (!keep.has(id)) removeSelectedBedOverlay(id);
        });
    }

    function refreshSelectedBedOverlaysSoon() {
        if (refreshSelectedBedOverlaysSoon.pending) return;
        refreshSelectedBedOverlaysSoon.pending = true;
        setTimeout(function () { refreshSelectedBedOverlaysSoon.pending = false; syncGeneratedBedLabels(); syncSelectedBedOverlays(); }, 0);
    }

    const selectionModel = graph.getSelectionModel ? graph.getSelectionModel() : null;
    model.addListener && model.addListener(mxEvent.CHANGE, refreshSelectedBedOverlaysSoon);
    if (selectionModel && selectionModel.addListener) selectionModel.addListener(mxEvent.CHANGE, refreshSelectedBedOverlaysSoon);
    if (graph.view && graph.view.addListener) {
        graph.view.addListener(mxEvent.SCALE, refreshSelectedBedOverlaysSoon);
        graph.view.addListener(mxEvent.TRANSLATE, refreshSelectedBedOverlaysSoon);
        graph.view.addListener(mxEvent.SCALE_AND_TRANSLATE, refreshSelectedBedOverlaysSoon);
    }
    if (graph.container && graph.container.addEventListener) graph.container.addEventListener("scroll", refreshSelectedBedOverlaysSoon, { passive: true });
    if (typeof window !== "undefined" && window.addEventListener) window.addEventListener("trellisIrrigationModeChanged", refreshSelectedBedOverlaysSoon);
    graph.addListener && graph.addListener(mxEvent.DESTROY, clearSelectedBedOverlays);

    window.TrellisGardenBeds = {
        getDisplayBedConditions: getDisplayBedConditions,
        readBedConditions: readBedConditions,
        writeBedConditions: writeBedConditions,
        clearBedConditions: clearBedConditions,
        listConditionOptionGroups: listConditionOptionGroups,
        isGardenBed: isGardenBed,
        isBedCompatibleWithCrop: isBedCompatibleWithCrop,
        scoreBedSuitability: scoreBedSuitability,
        seasonExtensionEffects: seasonExtensionEffects,
        _test: {
            buildOverlayRows: buildOverlayRows,
            normalizeProfile: normalizeProfile,
            seasonExtensionEffects: seasonExtensionEffects,
            seasonExtensionDefaults: seasonExtensionDefaults,
            listConditionOptionGroups: listConditionOptionGroups,
            parseProfileRecord: parseProfileRecord,
            getDisplayBedConditions: getDisplayBedConditions,
            getBedName: getBedName,
            writeBedName: writeBedName,
            buildGeneratedBedLabel: buildGeneratedBedLabel,
            heightCmToDisplayValue: heightCmToDisplayValue,
            displayHeightToCm: displayHeightToCm,
            estimateSelectedBedOverlayLayout: estimateSelectedBedOverlayLayout,
            showConditionEditorDialog: showConditionEditorDialog,
            syncSelectedBedOverlays: syncSelectedBedOverlays,
            syncGeneratedBedLabels: syncGeneratedBedLabels,
            collectSelectedBeds: collectSelectedBeds
        }
    };
    window.TrellisBedConditions = window.TrellisGardenBeds;

    refreshSelectedBedOverlaysSoon();
});
