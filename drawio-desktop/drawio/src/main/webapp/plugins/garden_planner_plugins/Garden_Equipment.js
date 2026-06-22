/**
 * Draw.io Plugin: Trellis Garden Equipment
 *
 * Purpose
 * - Stores garden equipment inventory on a Trellis garden module.
 * - Stores task type and capability registries used by Scheduler/Workload plugins.
 * - Checks scheduler tasks for missing required equipment and optional equipment opportunities.
 * - Exposes a small public API at graph.__trellisEquipment for other Trellis plugins.
 *
 * MVP Scope
 * - Standalone menu/dialog entry point.
 * - Equipment inventory editor.
 * - Task type registry editor.
 * - Capability registry editor.
 * - Equipment warnings scanner.
 * - Simple task hour estimation helper.
 *
 * Expected Trellis conventions
 * - Garden modules are mxCells with garden_module="1" or trellis_garden_module="1".
 * - Scheduler task cells may store task_type_id, task_quantity_basis, task_quantity_value,
 *   task_complexity, and task_equipment_ids as XML attributes.
 */
Draw.loadPlugin(function (ui) {
    const graph = ui && ui.editor && ui.editor.graph;
    if (!graph || graph.__trellisEquipmentInstalled) return;
    graph.__trellisEquipmentInstalled = true;

    const model = graph.getModel && graph.getModel();
    if (!model) return;

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    const PLUGIN_VERSION = 1;
    const STYLE_ID = "trellis-garden-equipment-style";
    const ACTION_ID = "trellisGardenEquipment";

    const ATTRS = {
        EQUIPMENT_INVENTORY_JSON: "equipment_inventory_json",
        TASK_TYPE_REGISTRY_JSON: "task_type_registry_json",
        CAPABILITY_REGISTRY_JSON: "equipment_capability_registry_json",
        WORKLOAD_MODEL_JSON: "workload_model_json"
    };

    const TASK_ATTRS = {
        TASK_TYPE_ID: "task_type_id",
        TASK_QUANTITY_BASIS: "task_quantity_basis",
        TASK_QUANTITY_VALUE: "task_quantity_value",
        TASK_COMPLEXITY: "task_complexity",
        TASK_EQUIPMENT_IDS: "task_equipment_ids",
        TASK_ESTIMATED_HOURS: "task_estimated_hours"
    };

    const EVENTS = {
        EQUIPMENT_CHANGED: "trellisEquipmentChanged",
        TASK_TYPES_CHANGED: "trellisTaskTypesChanged",
        CAPABILITIES_CHANGED: "trellisEquipmentCapabilitiesChanged",
        WORKLOAD_ASSUMPTIONS_CHANGED: "trellisWorkloadAssumptionsChanged"
    };

    const EQUIPMENT_STATUSES = [
        "owned",
        "rented",
        "borrowed",
        "unavailable",
        "wishlist",
        "needs_repair"
    ];

    const AVAILABLE_STATUSES = new Set(["owned", "rented", "borrowed"]);

    const EQUIPMENT_CATEGORIES = [
        "hand_tool",
        "pruning",
        "sowing",
        "hauling",
        "digging",
        "irrigation",
        "soil_amendments",
        "harvesting",
        "maintenance",
        "tillage",
        "storage",
        "automation",
        "safety",
        "other"
    ];

    const SKILL_LEVELS = ["none", "basic", "intermediate", "advanced", "specialist"];

    const QUANTITY_BASES = [
        "plants",
        "m2",
        "row_meters",
        "beds",
        "harvest_kg",
        "tasks",
        "irrigation_zones"
    ];

    const DEFAULT_CAPABILITIES = [
        cap("pruning_hand", "Hand Pruning", "pruning", "Cutting and pruning small stems, vines, herbs, and vegetables."),
        cap("pruning_woody", "Woody Pruning", "pruning", "Cutting woody stems or larger perennial growth."),
        cap("direct_sowing_hand", "Hand Direct Sowing", "sowing", "Direct sowing seeds by hand."),
        cap("direct_sowing_precision", "Precision Direct Sowing", "sowing", "Faster or more consistent direct sowing with a seeder or template."),
        cap("seedling_tray_starting", "Seedling Tray Starting", "propagation", "Starting seeds in trays, blocks, or modules."),
        cap("bulk_material_hauling", "Bulk Material Hauling", "hauling", "Moving compost, mulch, soil, harvest bins, or other heavy materials."),
        cap("compost_spreading", "Compost Spreading", "soil_amendments", "Applying compost or amendments across beds."),
        cap("mulch_spreading", "Mulch Spreading", "soil_amendments", "Applying mulch over beds or paths."),
        cap("digging", "Digging", "bed_prep", "Digging holes, trenches, and small bed-prep areas."),
        cap("soil_tilling", "Soil Tilling", "bed_prep", "Broad area soil turning or tillage."),
        cap("broadforking", "Broadforking", "bed_prep", "Loosening compacted soil without inversion."),
        cap("weeding_hand", "Hand Weeding", "maintenance", "Removing weeds manually or with small hand tools."),
        cap("weeding_precision", "Precision Weeding", "maintenance", "Close weeding around crop rows or dense plantings."),
        cap("weed_control_power", "Powered Weed Control", "maintenance", "Using powered tools for weed or edge control."),
        cap("irrigation_manual", "Manual Irrigation", "irrigation", "Watering manually with hose, can, or wand."),
        cap("irrigation_drip", "Drip Irrigation", "irrigation", "Maintaining or using drip irrigation lines."),
        cap("irrigation_timer", "Irrigation Timer", "irrigation", "Reducing recurring watering labor through automated timing."),
        cap("irrigation_zone_control", "Irrigation Zone Control", "irrigation", "Managing multiple watering zones."),
        cap("harvest_cutting", "Harvest Cutting", "harvesting", "Cutting greens, herbs, flowers, or fruiting crops."),
        cap("harvest_transport", "Harvest Transport", "harvesting", "Moving harvested crops from beds to wash/pack/storage."),
        cap("trellising", "Trellising", "crop_care", "Installing or maintaining supports, stakes, cages, or string systems."),
        cap("cleanup_debris", "Debris Cleanup", "maintenance", "Cleaning leaves, trimmings, plant debris, or spent crops.")
    ];

    const DEFAULT_TASK_TYPES = [
        taskType({
            id: "direct_sowing",
            name: "Direct Sowing",
            category: "planting",
            defaultQuantityBasis: "row_meters",
            allowedQuantityBases: ["row_meters", "m2", "beds", "tasks"],
            baseHoursPerUnit: { row_meters: 0.08, m2: 0.12, beds: 0.35, tasks: 0.5 },
            requiredCapabilities: ["direct_sowing_hand"],
            optionalCapabilities: ["direct_sowing_precision"],
            recommendedCapabilities: ["direct_sowing_precision"],
            defaultSetupTimeHours: 0.05,
            defaultCleanupTimeHours: 0.05
        }),
        taskType({
            id: "transplanting",
            name: "Transplanting",
            category: "planting",
            defaultQuantityBasis: "plants",
            allowedQuantityBases: ["plants", "m2", "beds", "tasks"],
            baseHoursPerUnit: { plants: 0.04, m2: 0.18, beds: 0.5, tasks: 0.5 },
            requiredCapabilities: ["digging"],
            optionalCapabilities: ["bulk_material_hauling"],
            recommendedCapabilities: ["bulk_material_hauling"],
            defaultSetupTimeHours: 0.08,
            defaultCleanupTimeHours: 0.08
        }),
        taskType({
            id: "watering",
            name: "Watering",
            category: "irrigation",
            defaultQuantityBasis: "m2",
            allowedQuantityBases: ["m2", "beds", "irrigation_zones", "tasks"],
            baseHoursPerUnit: { m2: 0.04, beds: 0.25, irrigation_zones: 0.2, tasks: 0.25 },
            requiredCapabilities: ["irrigation_manual"],
            optionalCapabilities: ["irrigation_timer", "irrigation_drip", "irrigation_zone_control"],
            recommendedCapabilities: ["irrigation_timer"],
            defaultSetupTimeHours: 0.03,
            defaultCleanupTimeHours: 0.03
        }),
        taskType({
            id: "harvesting",
            name: "Harvesting",
            category: "harvesting",
            defaultQuantityBasis: "harvest_kg",
            allowedQuantityBases: ["harvest_kg", "plants", "m2", "beds", "tasks"],
            baseHoursPerUnit: { harvest_kg: 0.18, plants: 0.03, m2: 0.10, beds: 0.4, tasks: 0.5 },
            requiredCapabilities: [],
            optionalCapabilities: ["harvest_cutting", "harvest_transport", "bulk_material_hauling"],
            recommendedCapabilities: ["harvest_transport"],
            defaultSetupTimeHours: 0.05,
            defaultCleanupTimeHours: 0.12
        }),
        taskType({
            id: "pruning",
            name: "Pruning",
            category: "crop_care",
            defaultQuantityBasis: "plants",
            allowedQuantityBases: ["plants", "m2", "beds", "tasks"],
            baseHoursPerUnit: { plants: 0.08, m2: 0.12, beds: 0.5, tasks: 0.5 },
            requiredCapabilities: ["pruning_hand"],
            optionalCapabilities: ["pruning_woody"],
            recommendedCapabilities: ["pruning_woody"],
            defaultSetupTimeHours: 0.05,
            defaultCleanupTimeHours: 0.08
        }),
        taskType({
            id: "trellising",
            name: "Trellising",
            category: "crop_care",
            defaultQuantityBasis: "plants",
            allowedQuantityBases: ["plants", "row_meters", "beds", "tasks"],
            baseHoursPerUnit: { plants: 0.10, row_meters: 0.18, beds: 0.65, tasks: 0.75 },
            requiredCapabilities: ["trellising"],
            optionalCapabilities: ["bulk_material_hauling"],
            recommendedCapabilities: ["bulk_material_hauling"],
            defaultSetupTimeHours: 0.15,
            defaultCleanupTimeHours: 0.10
        }),
        taskType({
            id: "bed_preparation",
            name: "Bed Preparation",
            category: "bed_prep",
            defaultQuantityBasis: "m2",
            allowedQuantityBases: ["m2", "beds", "tasks"],
            baseHoursPerUnit: { m2: 0.18, beds: 0.75, tasks: 0.75 },
            requiredCapabilities: ["digging"],
            optionalCapabilities: ["broadforking", "soil_tilling", "bulk_material_hauling"],
            recommendedCapabilities: ["broadforking"],
            defaultSetupTimeHours: 0.10,
            defaultCleanupTimeHours: 0.10
        }),
        taskType({
            id: "compost_application",
            name: "Compost Application",
            category: "soil_amendments",
            defaultQuantityBasis: "m2",
            allowedQuantityBases: ["m2", "beds", "tasks"],
            baseHoursPerUnit: { m2: 0.14, beds: 0.6, tasks: 0.75 },
            requiredCapabilities: [],
            optionalCapabilities: ["bulk_material_hauling", "compost_spreading"],
            recommendedCapabilities: ["bulk_material_hauling"],
            defaultSetupTimeHours: 0.10,
            defaultCleanupTimeHours: 0.12
        }),
        taskType({
            id: "mulching",
            name: "Mulching",
            category: "soil_amendments",
            defaultQuantityBasis: "m2",
            allowedQuantityBases: ["m2", "beds", "tasks"],
            baseHoursPerUnit: { m2: 0.12, beds: 0.55, tasks: 0.75 },
            requiredCapabilities: [],
            optionalCapabilities: ["bulk_material_hauling", "mulch_spreading"],
            recommendedCapabilities: ["bulk_material_hauling"],
            defaultSetupTimeHours: 0.10,
            defaultCleanupTimeHours: 0.12
        }),
        taskType({
            id: "weeding",
            name: "Weeding",
            category: "maintenance",
            defaultQuantityBasis: "m2",
            allowedQuantityBases: ["m2", "beds", "row_meters", "tasks"],
            baseHoursPerUnit: { m2: 0.10, beds: 0.45, row_meters: 0.07, tasks: 0.5 },
            requiredCapabilities: ["weeding_hand"],
            optionalCapabilities: ["weeding_precision", "weed_control_power"],
            recommendedCapabilities: ["weeding_precision"],
            defaultSetupTimeHours: 0.04,
            defaultCleanupTimeHours: 0.08
        }),
        taskType({
            id: "seed_starting",
            name: "Seed Starting",
            category: "propagation",
            defaultQuantityBasis: "plants",
            allowedQuantityBases: ["plants", "tasks"],
            baseHoursPerUnit: { plants: 0.025, tasks: 0.5 },
            requiredCapabilities: ["seedling_tray_starting"],
            optionalCapabilities: [],
            recommendedCapabilities: [],
            defaultSetupTimeHours: 0.12,
            defaultCleanupTimeHours: 0.12
        }),
        taskType({
            id: "irrigation_setup",
            name: "Irrigation Setup",
            category: "irrigation",
            defaultQuantityBasis: "irrigation_zones",
            allowedQuantityBases: ["irrigation_zones", "beds", "tasks"],
            baseHoursPerUnit: { irrigation_zones: 0.75, beds: 0.5, tasks: 1.0 },
            requiredCapabilities: ["irrigation_drip"],
            optionalCapabilities: ["irrigation_timer", "irrigation_zone_control"],
            recommendedCapabilities: ["irrigation_timer"],
            defaultSetupTimeHours: 0.25,
            defaultCleanupTimeHours: 0.15
        }),
        taskType({
            id: "cleanup",
            name: "Garden Cleanup",
            category: "maintenance",
            defaultQuantityBasis: "beds",
            allowedQuantityBases: ["beds", "m2", "tasks"],
            baseHoursPerUnit: { beds: 0.4, m2: 0.08, tasks: 0.5 },
            requiredCapabilities: [],
            optionalCapabilities: ["cleanup_debris", "bulk_material_hauling"],
            recommendedCapabilities: ["cleanup_debris"],
            defaultSetupTimeHours: 0.05,
            defaultCleanupTimeHours: 0.10
        })
    ];

    const DEFAULT_EQUIPMENT = [
        equipment({
            id: "eq_wheelbarrow",
            name: "Wheelbarrow",
            category: "hauling",
            status: "owned",
            purchaseCost: 120,
            expectedLifespanYears: 10,
            purchaseDate: "",
            setupTimeHours: 0.05,
            cleanupTimeHours: 0.05,
            capabilities: ["bulk_material_hauling", "harvest_transport"],
            relevantTaskTypes: ["compost_application", "mulching", "harvesting", "cleanup"],
            efficiencyEffects: [effect("compost_application", "hours_multiplier", 0.6, "m2", 1), effect("mulching", "hours_multiplier", 0.65, "m2", 1)],
            storageNotes: "",
            notes: "Standard single-wheel wheelbarrow. Best on level or gently sloped paths."
        }),
        equipment({
            id: "eq_bypass_pruners",
            name: "Bypass Pruners",
            category: "pruning",
            status: "owned",
            purchaseCost: 45,
            expectedLifespanYears: 8,
            setupTimeHours: 0.03,
            cleanupTimeHours: 0.05,
            capabilities: ["pruning_hand", "harvest_cutting"],
            relevantTaskTypes: ["pruning", "harvesting"],
            efficiencyEffects: [effect("pruning", "hours_multiplier", 0.9, "plants", 1)]
        }),
        equipment({
            id: "eq_shovel_round_point",
            name: "Shovel (Round Point)",
            category: "digging",
            status: "owned",
            purchaseCost: 35,
            expectedLifespanYears: 8,
            setupTimeHours: 0.03,
            cleanupTimeHours: 0.05,
            capabilities: ["digging"],
            relevantTaskTypes: ["transplanting", "bed_preparation", "irrigation_setup"]
        }),
        equipment({
            id: "eq_drip_timer",
            name: "Drip Irrigation Timer",
            category: "irrigation",
            status: "wishlist",
            purchaseCost: 65,
            expectedLifespanYears: 5,
            setupTimeHours: 0.2,
            cleanupTimeHours: 0.05,
            capabilities: ["irrigation_timer", "irrigation_zone_control"],
            relevantTaskTypes: ["watering", "irrigation_setup"],
            efficiencyEffects: [effect("watering", "frequency_multiplier", 0.35, "m2", 1)]
        })
    ];

    // -------------------------------------------------------------------------
    // Default factories
    // -------------------------------------------------------------------------

    function cap(id, name, category, description) {
        return { id, name, category, description: description || "" };
    }

    function taskType(overrides) {
        return normalizeTaskType(Object.assign({
            id: "",
            name: "",
            category: "general",
            allowedQuantityBases: ["tasks"],
            defaultQuantityBasis: "tasks",
            baseHoursPerUnit: { tasks: 0.5 },
            requiredCapabilities: [],
            optionalCapabilities: [],
            recommendedCapabilities: [],
            defaultSetupTimeHours: 0,
            defaultCleanupTimeHours: 0,
            complexityModifiers: {
                simple: 0.75,
                normal: 1,
                difficult: 1.5,
                restoration: 2.5
            },
            notes: ""
        }, overrides || {}));
    }

    function equipment(overrides) {
        return normalizeEquipment(Object.assign({
            id: "",
            name: "New Equipment",
            category: "other",
            status: "owned",
            acquisitionMode: "owned",
            purchaseCost: 0,
            rentalCostPerDay: 0,
            replacementCost: 0,
            resaleValue: 0,
            expectedLifespanYears: 5,
            purchaseDate: "",
            replacementDate: "",
            maintenanceFrequency: { basis: "year", every: 1 },
            maintenanceTimeHours: 0,
            maintenanceCost: 0,
            storageNotes: "",
            setupTimeHours: 0,
            cleanupTimeHours: 0,
            capabilities: [],
            relevantCropIds: [],
            relevantTaskTypes: [],
            relevantBedConditions: [],
            efficiencyEffects: [],
            minimumUsefulScale: { value: 0, unit: "tasks" },
            maximumUsefulScale: { value: 0, unit: "tasks" },
            crewSizeMin: 1,
            crewSizeMax: 1,
            skillLevelRequired: "basic",
            availability: { mode: "always", from: "", to: "" },
            usesConsumables: [],
            notes: ""
        }, overrides || {}));
    }

    function effect(taskTypeId, effectType, multiplier, unit, minimumValue) {
        return {
            taskTypeId,
            effectType,
            multiplier: coerceNumber(multiplier, 1),
            minimumScale: { value: coerceNumber(minimumValue, 0), unit: unit || "tasks" },
            maximumScale: null,
            stackable: false,
            notes: ""
        };
    }

    // -------------------------------------------------------------------------
    // Cell attribute and JSON persistence helpers
    // -------------------------------------------------------------------------

    function getCellAttr(cell, attrName) {
        const value = cell && cell.value;
        if (value && typeof value.getAttribute === "function") {
            return value.getAttribute(attrName);
        }
        return null;
    }

    function setCellAttrs(cell, attrs) {
        if (!cell || !attrs) return;

        model.beginUpdate();
        try {
            let value = cell.value;
            let node;

            if (value && typeof value.cloneNode === "function" && typeof value.getAttribute === "function") {
                node = value.cloneNode(true);
            } else {
                node = document.createElement("object");
                if (value != null && value !== "") {
                    node.setAttribute("label", String(value));
                }
            }

            Object.keys(attrs).forEach(function (key) {
                const val = attrs[key];
                if (val == null) node.removeAttribute(key);
                else node.setAttribute(key, String(val));
            });

            model.setValue(cell, node);
        } finally {
            model.endUpdate();
        }
    }

    function readJsonAttr(cell, attrName, fallback) {
        const raw = getCellAttr(cell, attrName);
        if (!raw) return clone(fallback);

        try {
            const parsed = JSON.parse(raw);
            return parsed == null ? clone(fallback) : parsed;
        } catch (err) {
            console.warn("Trellis Equipment: failed to parse", attrName, err);
            return clone(fallback);
        }
    }

    function writeJsonAttr(cell, attrName, value) {
        setCellAttrs(cell, {
            [attrName]: JSON.stringify(value)
        });
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function coerceNumber(value, fallback) {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }

    function splitCsv(value) {
        if (Array.isArray(value)) return value.map(String).map(trim).filter(Boolean);
        return String(value || "").split(",").map(trim).filter(Boolean);
    }

    function trim(value) {
        return String(value == null ? "" : value).trim();
    }

    function makeId(prefix, label) {
        const base = trim(label)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "") || "item";
        return `${prefix}_${base}_${Date.now().toString(36)}`;
    }

    function uniqueById(items) {
        const seen = new Set();
        const out = [];
        (items || []).forEach(function (item) {
            if (!item || !item.id || seen.has(item.id)) return;
            seen.add(item.id);
            out.push(item);
        });
        return out;
    }

    function byName(a, b) {
        return String(a.name || a.id).localeCompare(String(b.name || b.id));
    }

    // -------------------------------------------------------------------------
    // Model normalization
    // -------------------------------------------------------------------------

    function normalizeEquipment(record) {
        const out = Object.assign({}, record || {});
        out.id = trim(out.id) || makeId("eq", out.name || "equipment");
        out.name = trim(out.name) || "Unnamed Equipment";
        out.category = trim(out.category) || "other";
        out.status = EQUIPMENT_STATUSES.indexOf(out.status) >= 0 ? out.status : "owned";
        out.acquisitionMode = trim(out.acquisitionMode) || out.status;
        out.purchaseCost = coerceNumber(out.purchaseCost, 0);
        out.rentalCostPerDay = coerceNumber(out.rentalCostPerDay, 0);
        out.replacementCost = coerceNumber(out.replacementCost, out.purchaseCost || 0);
        out.resaleValue = coerceNumber(out.resaleValue, 0);
        out.expectedLifespanYears = coerceNumber(out.expectedLifespanYears, 0);
        out.maintenanceFrequency = Object.assign({ basis: "year", every: 1 }, out.maintenanceFrequency || {});
        out.maintenanceFrequency.basis = trim(out.maintenanceFrequency.basis) || "year";
        out.maintenanceFrequency.every = coerceNumber(out.maintenanceFrequency.every, 1);
        out.maintenanceTimeHours = coerceNumber(out.maintenanceTimeHours, 0);
        out.maintenanceCost = coerceNumber(out.maintenanceCost, 0);
        out.setupTimeHours = coerceNumber(out.setupTimeHours, 0);
        out.cleanupTimeHours = coerceNumber(out.cleanupTimeHours, 0);
        out.capabilities = splitCsv(out.capabilities);
        out.relevantCropIds = splitCsv(out.relevantCropIds);
        out.relevantTaskTypes = splitCsv(out.relevantTaskTypes);
        out.relevantBedConditions = splitCsv(out.relevantBedConditions);
        out.efficiencyEffects = Array.isArray(out.efficiencyEffects) ? out.efficiencyEffects.map(normalizeEffect) : [];
        out.minimumUsefulScale = Object.assign({ value: 0, unit: "tasks" }, out.minimumUsefulScale || {});
        out.maximumUsefulScale = Object.assign({ value: 0, unit: "tasks" }, out.maximumUsefulScale || {});
        out.minimumUsefulScale.value = coerceNumber(out.minimumUsefulScale.value, 0);
        out.maximumUsefulScale.value = coerceNumber(out.maximumUsefulScale.value, 0);
        out.crewSizeMin = Math.max(1, coerceNumber(out.crewSizeMin, 1));
        out.crewSizeMax = Math.max(out.crewSizeMin, coerceNumber(out.crewSizeMax, out.crewSizeMin));
        out.skillLevelRequired = SKILL_LEVELS.indexOf(out.skillLevelRequired) >= 0 ? out.skillLevelRequired : "basic";
        out.availability = Object.assign({ mode: "always", from: "", to: "" }, out.availability || {});
        out.usesConsumables = Array.isArray(out.usesConsumables) ? out.usesConsumables : [];
        out.purchaseDate = trim(out.purchaseDate);
        out.replacementDate = trim(out.replacementDate);
        out.storageNotes = trim(out.storageNotes);
        out.notes = trim(out.notes);
        return out;
    }

    function normalizeEffect(record) {
        const out = Object.assign({}, record || {});
        out.taskTypeId = trim(out.taskTypeId);
        out.effectType = trim(out.effectType) || "hours_multiplier";
        out.multiplier = coerceNumber(out.multiplier, 1);
        out.minimumScale = Object.assign({ value: 0, unit: "tasks" }, out.minimumScale || {});
        out.maximumScale = out.maximumScale ? Object.assign({ value: 0, unit: "tasks" }, out.maximumScale) : null;
        out.minimumScale.value = coerceNumber(out.minimumScale.value, 0);
        if (out.maximumScale) out.maximumScale.value = coerceNumber(out.maximumScale.value, 0);
        out.stackable = !!out.stackable;
        out.notes = trim(out.notes);
        return out;
    }

    function normalizeTaskType(record) {
        const out = Object.assign({}, record || {});
        out.id = trim(out.id) || makeId("task", out.name || "task_type");
        out.name = trim(out.name) || out.id;
        out.category = trim(out.category) || "general";
        out.allowedQuantityBases = splitCsv(out.allowedQuantityBases);
        if (out.allowedQuantityBases.length === 0) out.allowedQuantityBases = ["tasks"];
        out.defaultQuantityBasis = trim(out.defaultQuantityBasis) || out.allowedQuantityBases[0];
        if (out.allowedQuantityBases.indexOf(out.defaultQuantityBasis) < 0) {
            out.allowedQuantityBases.unshift(out.defaultQuantityBasis);
        }
        out.baseHoursPerUnit = normalizeNumberMap(out.baseHoursPerUnit, { [out.defaultQuantityBasis]: 0.5 });
        out.requiredCapabilities = splitCsv(out.requiredCapabilities);
        out.optionalCapabilities = splitCsv(out.optionalCapabilities);
        out.recommendedCapabilities = splitCsv(out.recommendedCapabilities);
        out.defaultSetupTimeHours = coerceNumber(out.defaultSetupTimeHours, 0);
        out.defaultCleanupTimeHours = coerceNumber(out.defaultCleanupTimeHours, 0);
        out.complexityModifiers = normalizeNumberMap(out.complexityModifiers, {
            simple: 0.75,
            normal: 1,
            difficult: 1.5,
            restoration: 2.5
        });
        out.notes = trim(out.notes);
        return out;
    }

    function normalizeCapability(record) {
        const out = Object.assign({}, record || {});
        out.id = trim(out.id) || makeId("cap", out.name || "capability");
        out.name = trim(out.name) || out.id;
        out.category = trim(out.category) || "general";
        out.description = trim(out.description);
        return out;
    }

    function normalizeNumberMap(value, fallback) {
        if (!value || typeof value !== "object" || Array.isArray(value)) return Object.assign({}, fallback);
        const out = {};
        Object.keys(value).forEach(function (key) {
            out[key] = coerceNumber(value[key], 0);
        });
        return out;
    }

    function mergeDefaults(existing, defaults, normalizer) {
        const byId = new Map();
        (defaults || []).forEach(function (item) { byId.set(item.id, normalizer(item)); });
        (existing || []).forEach(function (item) { byId.set(item.id, normalizer(item)); });
        return Array.from(byId.values()).sort(byName);
    }

    function readEquipmentInventory(moduleCell) {
        const raw = readJsonAttr(moduleCell, ATTRS.EQUIPMENT_INVENTORY_JSON, null);
        const items = Array.isArray(raw && raw.items) ? raw.items : Array.isArray(raw) ? raw : null;
        if (!items) return clone(DEFAULT_EQUIPMENT).map(normalizeEquipment).sort(byName);
        return uniqueById(items.map(normalizeEquipment)).sort(byName);
    }

    function writeEquipmentInventory(moduleCell, inventory) {
        const payload = {
            version: PLUGIN_VERSION,
            updatedAt: Date.now(),
            items: uniqueById((inventory || []).map(normalizeEquipment)).sort(byName)
        };
        writeJsonAttr(moduleCell, ATTRS.EQUIPMENT_INVENTORY_JSON, payload);
        fireTrellisEvent(EVENTS.EQUIPMENT_CHANGED, { moduleCell, inventory: payload.items });
        fireTrellisEvent(EVENTS.WORKLOAD_ASSUMPTIONS_CHANGED, { moduleCell });
    }

    function readTaskTypeRegistry(moduleCell) {
        const raw = readJsonAttr(moduleCell, ATTRS.TASK_TYPE_REGISTRY_JSON, null);
        const items = Array.isArray(raw && raw.items) ? raw.items : Array.isArray(raw) ? raw : [];
        return mergeDefaults(items, DEFAULT_TASK_TYPES, normalizeTaskType);
    }

    function writeTaskTypeRegistry(moduleCell, taskTypes) {
        const payload = {
            version: PLUGIN_VERSION,
            updatedAt: Date.now(),
            items: uniqueById((taskTypes || []).map(normalizeTaskType)).sort(byName)
        };
        writeJsonAttr(moduleCell, ATTRS.TASK_TYPE_REGISTRY_JSON, payload);
        fireTrellisEvent(EVENTS.TASK_TYPES_CHANGED, { moduleCell, taskTypes: payload.items });
        fireTrellisEvent(EVENTS.WORKLOAD_ASSUMPTIONS_CHANGED, { moduleCell });
    }

    function readCapabilityRegistry(moduleCell) {
        const raw = readJsonAttr(moduleCell, ATTRS.CAPABILITY_REGISTRY_JSON, null);
        const items = Array.isArray(raw && raw.items) ? raw.items : Array.isArray(raw) ? raw : [];
        return mergeDefaults(items, DEFAULT_CAPABILITIES, normalizeCapability);
    }

    function writeCapabilityRegistry(moduleCell, capabilities) {
        const payload = {
            version: PLUGIN_VERSION,
            updatedAt: Date.now(),
            items: uniqueById((capabilities || []).map(normalizeCapability)).sort(byName)
        };
        writeJsonAttr(moduleCell, ATTRS.CAPABILITY_REGISTRY_JSON, payload);
        fireTrellisEvent(EVENTS.CAPABILITIES_CHANGED, { moduleCell, capabilities: payload.items });
        fireTrellisEvent(EVENTS.WORKLOAD_ASSUMPTIONS_CHANGED, { moduleCell });
    }

    // -------------------------------------------------------------------------
    // Garden module discovery
    // -------------------------------------------------------------------------

    function isGardenModule(cell) {
        if (!cell) return false;
        return getCellAttr(cell, "garden_module") === "1" ||
            getCellAttr(cell, "trellis_garden_module") === "1" ||
            getCellAttr(cell, "module_type") === "garden";
    }

    function findAncestorGardenModule(cell) {
        let cur = cell;
        while (cur) {
            if (isGardenModule(cur)) return cur;
            cur = model.getParent(cur);
        }
        return null;
    }

    function getActiveGardenModule() {
        const selected = graph.getSelectionCells ? graph.getSelectionCells() : [];

        for (let i = 0; i < selected.length; i += 1) {
            const moduleCell = findAncestorGardenModule(selected[i]);
            if (moduleCell) return moduleCell;
        }

        const root = model.getRoot && model.getRoot();
        const found = findCellDepthFirst(root, isGardenModule);
        return found || null;
    }

    function findCellDepthFirst(root, predicate) {
        if (!root) return null;
        if (predicate(root)) return root;
        const count = model.getChildCount(root);
        for (let i = 0; i < count; i += 1) {
            const found = findCellDepthFirst(model.getChildAt(root, i), predicate);
            if (found) return found;
        }
        return null;
    }

    function getCellLabel(cell) {
        const value = cell && cell.value;
        if (value && typeof value.getAttribute === "function") {
            return value.getAttribute("label") || value.getAttribute("name") || cell.id || "Garden Module";
        }
        return value != null && value !== "" ? String(value) : cell && cell.id ? cell.id : "Garden Module";
    }

    // -------------------------------------------------------------------------
    // Equipment matching and workload support API
    // -------------------------------------------------------------------------

    function isEquipmentAvailable(item) {
        if (!item) return false;
        if (!AVAILABLE_STATUSES.has(item.status)) return false;
        if (item.availability && item.availability.mode === "unavailable") return false;
        return true;
    }

    function findAvailableEquipmentByCapability(capabilityId, inventory) {
        return (inventory || []).filter(function (item) {
            return isEquipmentAvailable(item) && item.capabilities.indexOf(capabilityId) >= 0;
        });
    }

    function checkCapabilities(taskType, inventory) {
        const required = taskType ? taskType.requiredCapabilities || [] : [];
        const optional = taskType ? taskType.optionalCapabilities || [] : [];
        const recommended = taskType ? taskType.recommendedCapabilities || [] : [];

        const requiredMatches = required.map(function (capabilityId) {
            return {
                capabilityId,
                equipment: findAvailableEquipmentByCapability(capabilityId, inventory)
            };
        });

        const optionalMatches = optional.map(function (capabilityId) {
            return {
                capabilityId,
                equipment: findAvailableEquipmentByCapability(capabilityId, inventory)
            };
        });

        const recommendedMatches = recommended.map(function (capabilityId) {
            return {
                capabilityId,
                equipment: findAvailableEquipmentByCapability(capabilityId, inventory)
            };
        });

        return {
            missingRequired: requiredMatches.filter(function (m) { return m.equipment.length === 0; }),
            optionalAvailable: optionalMatches.filter(function (m) { return m.equipment.length > 0; }),
            recommendedMissing: recommendedMatches.filter(function (m) { return m.equipment.length === 0; }),
            requiredMatches,
            optionalMatches,
            recommendedMatches
        };
    }

    function buildTaskEquipmentWarnings(taskCell, moduleCell) {
        const inventory = readEquipmentInventory(moduleCell);
        const taskTypes = readTaskTypeRegistry(moduleCell);
        const taskTypeId = getCellAttr(taskCell, TASK_ATTRS.TASK_TYPE_ID);
        const taskType = taskTypes.find(function (tt) { return tt.id === taskTypeId; });
        const warnings = [];

        if (!taskTypeId) {
            warnings.push({
                type: "missing_task_type",
                severity: "info",
                taskCell,
                message: "Task has no task type assigned."
            });
            return warnings;
        }

        if (!taskType) {
            warnings.push({
                type: "unknown_task_type",
                severity: "warning",
                taskCell,
                taskTypeId,
                message: `Task type '${taskTypeId}' is not in the registry.`
            });
            return warnings;
        }

        const checks = checkCapabilities(taskType, inventory);

        checks.missingRequired.forEach(function (m) {
            warnings.push({
                type: "missing_required_equipment",
                severity: "error",
                taskCell,
                taskTypeId,
                capabilityId: m.capabilityId,
                message: `${taskType.name} requires '${m.capabilityId}', but no available equipment provides it.`
            });
        });

        checks.optionalAvailable.forEach(function (m) {
            warnings.push({
                type: "optional_equipment_available",
                severity: "info",
                taskCell,
                taskTypeId,
                capabilityId: m.capabilityId,
                equipmentIds: m.equipment.map(function (eq) { return eq.id; }),
                message: `${taskType.name} can use optional equipment for '${m.capabilityId}': ${m.equipment.map(function (eq) { return eq.name; }).join(", ")}.`
            });
        });

        checks.recommendedMissing.forEach(function (m) {
            warnings.push({
                type: "recommended_equipment_missing",
                severity: "warning",
                taskCell,
                taskTypeId,
                capabilityId: m.capabilityId,
                message: `${taskType.name} would likely improve with '${m.capabilityId}', but no available equipment provides it.`
            });
        });

        return warnings;
    }

    function findSchedulerTaskCells() {
        const root = model.getRoot && model.getRoot();
        const out = [];
        walkCells(root, function (cell) {
            if (cell && getCellAttr(cell, TASK_ATTRS.TASK_TYPE_ID)) out.push(cell);
        });
        return out;
    }

    function walkCells(cell, visitor) {
        if (!cell) return;
        visitor(cell);
        const count = model.getChildCount(cell);
        for (let i = 0; i < count; i += 1) walkCells(model.getChildAt(cell, i), visitor);
    }

    function buildAllWarnings(moduleCell) {
        const taskCells = findSchedulerTaskCells();
        const warnings = [];
        taskCells.forEach(function (taskCell) {
            warnings.push.apply(warnings, buildTaskEquipmentWarnings(taskCell, moduleCell));
        });
        return warnings;
    }

    function chooseBestEquipmentEffect(taskType, quantity, inventory) {
        const taskTypeId = taskType && taskType.id;
        const available = (inventory || []).filter(isEquipmentAvailable);
        const effects = [];

        available.forEach(function (item) {
            (item.efficiencyEffects || []).forEach(function (eff) {
                if (eff.taskTypeId !== taskTypeId) return;
                if (!effectAppliesToQuantity(eff, quantity)) return;
                effects.push({ equipment: item, effect: eff });
            });
        });

        const hourEffects = effects.filter(function (entry) {
            return entry.effect.effectType === "hours_multiplier";
        });

        if (hourEffects.length === 0) {
            return {
                hoursMultiplier: 1,
                setupTime: 0,
                cleanupTime: 0,
                allocatedMaintenanceTime: 0,
                selectedEquipment: []
            };
        }

        const stackable = hourEffects.filter(function (entry) { return entry.effect.stackable; });
        const primary = hourEffects.filter(function (entry) { return !entry.effect.stackable; })
            .sort(function (a, b) { return a.effect.multiplier - b.effect.multiplier; })[0];

        let hoursMultiplier = primary ? primary.effect.multiplier : 1;
        const selected = primary ? [primary.equipment] : [];

        stackable.forEach(function (entry) {
            hoursMultiplier *= entry.effect.multiplier;
            selected.push(entry.equipment);
        });

        // Prevent unrealistic estimates from excessive stacking.
        hoursMultiplier = Math.max(0.35, Math.min(2.5, hoursMultiplier));

        return {
            hoursMultiplier,
            setupTime: sumUniqueEquipment(selected, "setupTimeHours"),
            cleanupTime: sumUniqueEquipment(selected, "cleanupTimeHours"),
            allocatedMaintenanceTime: 0,
            selectedEquipment: selected
        };
    }

    function effectAppliesToQuantity(effectRecord, quantity) {
        if (!effectRecord) return false;
        const unit = quantity && quantity.unit;
        const value = coerceNumber(quantity && quantity.value, 0);
        const min = effectRecord.minimumScale;
        const max = effectRecord.maximumScale;

        if (min && min.unit && min.unit !== unit) return false;
        if (min && value < coerceNumber(min.value, 0)) return false;
        if (max && max.unit && max.unit !== unit) return false;
        if (max && coerceNumber(max.value, 0) > 0 && value > coerceNumber(max.value, 0)) return false;
        return true;
    }

    function sumUniqueEquipment(items, field) {
        const seen = new Set();
        let total = 0;
        (items || []).forEach(function (item) {
            if (!item || seen.has(item.id)) return;
            seen.add(item.id);
            total += coerceNumber(item[field], 0);
        });
        return total;
    }

    function estimateTaskHours(taskInput, context) {
        const moduleCell = context && context.moduleCell ? context.moduleCell : getActiveGardenModule();
        if (!moduleCell) return { estimatedHours: null, warnings: [{ type: "missing_module", message: "No garden module found." }] };

        const inventory = context && context.inventory ? context.inventory : readEquipmentInventory(moduleCell);
        const taskTypes = context && context.taskTypes ? context.taskTypes : readTaskTypeRegistry(moduleCell);
        const taskTypeId = taskInput.taskTypeId || (taskInput.cell ? getCellAttr(taskInput.cell, TASK_ATTRS.TASK_TYPE_ID) : "");
        const taskType = taskTypes.find(function (tt) { return tt.id === taskTypeId; });

        if (!taskType) {
            return { estimatedHours: null, warnings: [{ type: "unknown_task_type", message: "Unknown task type." }] };
        }

        const quantity = {
            unit: taskInput.quantityBasis || (taskInput.cell ? getCellAttr(taskInput.cell, TASK_ATTRS.TASK_QUANTITY_BASIS) : "") || taskType.defaultQuantityBasis,
            value: coerceNumber(taskInput.quantityValue || (taskInput.cell ? getCellAttr(taskInput.cell, TASK_ATTRS.TASK_QUANTITY_VALUE) : 0), 1)
        };

        const complexity = taskInput.complexity || (taskInput.cell ? getCellAttr(taskInput.cell, TASK_ATTRS.TASK_COMPLEXITY) : "") || "normal";
        const base = coerceNumber(taskType.baseHoursPerUnit[quantity.unit], taskType.baseHoursPerUnit[taskType.defaultQuantityBasis] || 0.5);
        const complexityMultiplier = coerceNumber(taskType.complexityModifiers[complexity], 1);
        const equipmentEffect = chooseBestEquipmentEffect(taskType, quantity, inventory);

        const workHours = base * quantity.value * complexityMultiplier * equipmentEffect.hoursMultiplier;
        const estimatedHours = workHours +
            taskType.defaultSetupTimeHours +
            taskType.defaultCleanupTimeHours +
            equipmentEffect.setupTime +
            equipmentEffect.cleanupTime +
            equipmentEffect.allocatedMaintenanceTime;

        return {
            estimatedHours,
            workHours,
            quantity,
            complexity,
            taskType,
            equipmentEffect,
            warnings: taskInput.cell ? buildTaskEquipmentWarnings(taskInput.cell, moduleCell) : []
        };
    }

    // -------------------------------------------------------------------------
    // Public scheduler-control helper
    // -------------------------------------------------------------------------

    function renderTaskTypeControls(container, taskCell, moduleCell, onChange) {
        if (!container || !taskCell || !moduleCell) return;
        const taskTypes = readTaskTypeRegistry(moduleCell);
        const selectedTaskTypeId = getCellAttr(taskCell, TASK_ATTRS.TASK_TYPE_ID) || "";
        const quantityBasis = getCellAttr(taskCell, TASK_ATTRS.TASK_QUANTITY_BASIS) || "";
        const quantityValue = getCellAttr(taskCell, TASK_ATTRS.TASK_QUANTITY_VALUE) || "";
        const complexity = getCellAttr(taskCell, TASK_ATTRS.TASK_COMPLEXITY) || "normal";

        container.innerHTML = "";
        container.appendChild(fieldLabel("Task Type"));
        const taskSel = selectInput(taskTypes.map(function (tt) { return [tt.id, tt.name]; }), selectedTaskTypeId, function () {
            const taskType = taskTypes.find(function (tt) { return tt.id === taskSel.value; });
            const attrs = { [TASK_ATTRS.TASK_TYPE_ID]: taskSel.value };
            if (taskType && !getCellAttr(taskCell, TASK_ATTRS.TASK_QUANTITY_BASIS)) attrs[TASK_ATTRS.TASK_QUANTITY_BASIS] = taskType.defaultQuantityBasis;
            if (!getCellAttr(taskCell, TASK_ATTRS.TASK_COMPLEXITY)) attrs[TASK_ATTRS.TASK_COMPLEXITY] = "normal";
            setCellAttrs(taskCell, attrs);
            if (typeof onChange === "function") onChange();
        });
        container.appendChild(taskSel);

        container.appendChild(fieldLabel("Quantity Basis"));
        const basisInput = textInput(quantityBasis, function () {
            setCellAttrs(taskCell, { [TASK_ATTRS.TASK_QUANTITY_BASIS]: basisInput.value });
            if (typeof onChange === "function") onChange();
        });
        container.appendChild(basisInput);

        container.appendChild(fieldLabel("Quantity"));
        const qtyInput = numberInput(quantityValue, function () {
            setCellAttrs(taskCell, { [TASK_ATTRS.TASK_QUANTITY_VALUE]: qtyInput.value });
            if (typeof onChange === "function") onChange();
        });
        container.appendChild(qtyInput);

        container.appendChild(fieldLabel("Complexity"));
        const complexitySel = selectInput([["simple", "Simple"], ["normal", "Normal"], ["difficult", "Difficult"], ["restoration", "Restoration"]], complexity, function () {
            setCellAttrs(taskCell, { [TASK_ATTRS.TASK_COMPLEXITY]: complexitySel.value });
            if (typeof onChange === "function") onChange();
        });
        container.appendChild(complexitySel);
    }

    // -------------------------------------------------------------------------
    // UI
    // -------------------------------------------------------------------------

    function ensureStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
.trellis-eq-overlay { position: fixed; inset: 0; z-index: 10030; background: rgba(0,0,0,0.28); display: flex; align-items: center; justify-content: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.trellis-eq-dialog { width: min(1480px, calc(100vw - 52px)); height: min(920px, calc(100vh - 52px)); background: #fff; color: #172018; border-radius: 9px; box-shadow: 0 18px 50px rgba(0,0,0,.32); overflow: hidden; display: flex; flex-direction: column; }
.trellis-eq-header { height: 54px; background: linear-gradient(90deg,#0f3f25,#0b2d1b); color: #fff; display: flex; align-items: center; justify-content: space-between; padding: 0 22px; }
.trellis-eq-title { font-size: 18px; font-weight: 650; }
.trellis-eq-close { border: 0; background: transparent; color: #fff; font-size: 24px; cursor: pointer; line-height: 1; }
.trellis-eq-top { padding: 14px 20px; display: grid; grid-template-columns: 360px repeat(5, 1fr); gap: 14px; border-bottom: 1px solid #e6e9e6; background: #fafbfa; }
.trellis-eq-module-label { font-size: 12px; color: #526052; margin-bottom: 6px; }
.trellis-eq-module-box { height: 36px; border: 1px solid #d8ded8; border-radius: 6px; display: flex; align-items: center; padding: 0 12px; background: #fff; font-size: 14px; }
.trellis-eq-tile { border: 1px solid #e0e4e0; border-radius: 7px; background: #fff; padding: 10px 12px; display: flex; gap: 10px; align-items: center; min-width: 0; }
.trellis-eq-tile-icon { font-size: 25px; width: 30px; text-align: center; }
.trellis-eq-tile-main { font-size: 20px; font-weight: 700; line-height: 1.1; }
.trellis-eq-tile-sub { font-size: 12px; color: #405040; margin-top: 2px; }
.trellis-eq-tabs { display: flex; gap: 22px; padding: 0 20px; border-bottom: 1px solid #dde3dd; background: #fff; height: 48px; align-items: flex-end; }
.trellis-eq-tab { height: 48px; display: flex; align-items: center; gap: 7px; border-bottom: 3px solid transparent; cursor: pointer; font-size: 14px; color: #263226; padding: 0 2px; white-space: nowrap; }
.trellis-eq-tab.active { color: #0d7d35; border-bottom-color: #159447; font-weight: 650; }
.trellis-eq-body { flex: 1; overflow: hidden; display: flex; background: #fff; }
.trellis-eq-pane { flex: 1; display: flex; overflow: hidden; }
.trellis-eq-list-panel { width: 560px; border-right: 1px solid #e3e7e3; padding: 18px; display: flex; flex-direction: column; overflow: hidden; }
.trellis-eq-editor-panel { flex: 1; padding: 18px; overflow: auto; }
.trellis-eq-section-title { font-size: 18px; font-weight: 650; margin-bottom: 14px; }
.trellis-eq-toolbar { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; flex-wrap: wrap; }
.trellis-eq-btn { border: 1px solid #d5dcd5; background: #fff; color: #172018; border-radius: 6px; padding: 7px 12px; cursor: pointer; font-size: 13px; }
.trellis-eq-btn:hover { background: #f5f7f5; }
.trellis-eq-btn.primary { background: #168c42; color: #fff; border-color: #168c42; }
.trellis-eq-btn.danger { color: #9b1c1c; }
.trellis-eq-search { flex: 1; min-width: 160px; border: 1px solid #d5dcd5; border-radius: 6px; height: 34px; padding: 0 9px; }
.trellis-eq-table-wrap { overflow: auto; border: 1px solid #e0e5e0; border-radius: 7px; }
.trellis-eq-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.trellis-eq-table th { text-align: left; padding: 10px 10px; background: #fbfcfb; border-bottom: 1px solid #e0e5e0; position: sticky; top: 0; z-index: 1; }
.trellis-eq-table td { padding: 9px 10px; border-bottom: 1px solid #edf0ed; vertical-align: top; }
.trellis-eq-table tr.selected { background: #eaf6ed; }
.trellis-eq-table tr:hover { background: #f5faf6; cursor: pointer; }
.trellis-eq-badge { display: inline-block; border-radius: 4px; padding: 2px 7px; font-size: 12px; border: 1px solid #d6e7d6; background: #edf8ef; color: #0b6732; margin: 0 4px 4px 0; }
.trellis-eq-badge.warn { background: #fff4e5; color: #8a4a00; border-color: #f2d4a0; }
.trellis-eq-badge.err { background: #fdecec; color: #961d1d; border-color: #f2b6b6; }
.trellis-eq-badge.gray { background: #f2f4f2; color: #4c554c; border-color: #d8ded8; }
.trellis-eq-card { border: 1px solid #e0e5e0; border-radius: 8px; background: #fff; margin-bottom: 14px; }
.trellis-eq-card-head { padding: 12px 14px; font-weight: 650; border-bottom: 1px solid #e8ece8; background: #fbfcfb; display: flex; align-items: center; justify-content: space-between; }
.trellis-eq-card-body { padding: 14px; }
.trellis-eq-form-grid { display: grid; grid-template-columns: repeat(2, minmax(240px, 1fr)); gap: 12px 18px; }
.trellis-eq-form-grid.three { grid-template-columns: repeat(3, minmax(170px, 1fr)); }
.trellis-eq-field label { display: block; font-size: 12px; color: #445044; margin-bottom: 5px; }
.trellis-eq-field input, .trellis-eq-field select, .trellis-eq-field textarea { width: 100%; box-sizing: border-box; border: 1px solid #d5dcd5; border-radius: 6px; padding: 8px 9px; font: inherit; font-size: 13px; background: #fff; }
.trellis-eq-field textarea { min-height: 68px; resize: vertical; font-family: inherit; }
.trellis-eq-field textarea.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; min-height: 120px; }
.trellis-eq-editor-tabs { display: flex; gap: 18px; padding: 0 14px; border-bottom: 1px solid #e4e9e4; }
.trellis-eq-editor-tab { padding: 11px 0 9px; border-bottom: 3px solid transparent; cursor: pointer; font-size: 13px; }
.trellis-eq-editor-tab.active { border-bottom-color: #159447; color: #0d7d35; font-weight: 650; }
.trellis-eq-footer { height: 54px; border-top: 1px solid #dde3dd; display: flex; align-items: center; justify-content: space-between; padding: 0 18px; background: #fafbfa; }
.trellis-eq-footer-left, .trellis-eq-footer-right { display: flex; gap: 10px; align-items: center; }
.trellis-eq-empty { padding: 28px; text-align: center; color: #657065; border: 1px dashed #d6ddd6; border-radius: 8px; background: #fbfcfb; }
.trellis-eq-warning-list { padding: 18px; overflow: auto; width: 100%; }
.trellis-eq-warning { border: 1px solid #e0e5e0; border-radius: 7px; padding: 11px 13px; margin-bottom: 10px; background: #fff; }
.trellis-eq-warning.error { border-color: #f0b4b4; background: #fff8f8; }
.trellis-eq-warning.warning { border-color: #f0d59d; background: #fffaf0; }
.trellis-eq-small-muted { font-size: 12px; color: #667066; }
@media (max-width: 1120px) { .trellis-eq-top { grid-template-columns: 1fr 1fr; } .trellis-eq-pane { flex-direction: column; } .trellis-eq-list-panel { width: auto; height: 42%; border-right: 0; border-bottom: 1px solid #e3e7e3; } }
`;
        document.head.appendChild(style);
    }

    function openEquipmentDialog(moduleCell) {
        moduleCell = moduleCell || getActiveGardenModule();
        if (!moduleCell) {
            alert("Select a Trellis garden module first, or add garden_module=\"1\" to the module cell.");
            return;
        }

        ensureStyles();

        const state = {
            moduleCell,
            inventory: readEquipmentInventory(moduleCell),
            taskTypes: readTaskTypeRegistry(moduleCell),
            capabilities: readCapabilityRegistry(moduleCell),
            activeTab: "inventory",
            activeEquipmentEditorTab: "general",
            activeTaskTypeEditorTab: "general",
            selectedEquipmentId: null,
            selectedTaskTypeId: null,
            selectedCapabilityId: null,
            filter: ""
        };

        if (state.inventory.length) state.selectedEquipmentId = state.inventory[0].id;
        if (state.taskTypes.length) state.selectedTaskTypeId = state.taskTypes[0].id;
        if (state.capabilities.length) state.selectedCapabilityId = state.capabilities[0].id;

        const overlay = document.createElement("div");
        overlay.className = "trellis-eq-overlay";
        document.body.appendChild(overlay);

        function close() {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }

        function saveAll() {
            writeEquipmentInventory(state.moduleCell, state.inventory);
            writeTaskTypeRegistry(state.moduleCell, state.taskTypes);
            writeCapabilityRegistry(state.moduleCell, state.capabilities);
        }

        function saveAndClose() {
            saveAll();
            close();
        }

        function render() {
            overlay.innerHTML = "";
            const dialog = div("trellis-eq-dialog");
            overlay.appendChild(dialog);

            dialog.appendChild(renderHeader(close));
            dialog.appendChild(renderTopSummary(state));
            dialog.appendChild(renderMainTabs(state, render));

            const body = div("trellis-eq-body");
            dialog.appendChild(body);

            if (state.activeTab === "inventory") body.appendChild(renderInventoryPane(state, render));
            else if (state.activeTab === "taskTypes") body.appendChild(renderTaskTypesPane(state, render));
            else if (state.activeTab === "capabilities") body.appendChild(renderCapabilitiesPane(state, render));
            else if (state.activeTab === "efficiency") body.appendChild(renderEfficiencyPane(state, render));
            else if (state.activeTab === "maintenance") body.appendChild(renderMaintenancePane(state));
            else if (state.activeTab === "warnings") body.appendChild(renderWarningsPane(state));

            dialog.appendChild(renderFooter(state, render, saveAll, saveAndClose, close));
        }

        render();
    }

    function renderHeader(close) {
        const header = div("trellis-eq-header");
        header.appendChild(textDiv("trellis-eq-title", "Garden Equipment & Workload Assumptions"));
        const button = buttonEl("×", "trellis-eq-close", close);
        button.title = "Close";
        header.appendChild(button);
        return header;
    }

    function renderTopSummary(state) {
        const top = div("trellis-eq-top");
        const moduleBox = div("");
        moduleBox.appendChild(textDiv("trellis-eq-module-label", "Garden Module:"));
        moduleBox.appendChild(textDiv("trellis-eq-module-box", "🌿  " + getCellLabel(state.moduleCell)));
        top.appendChild(moduleBox);

        const summary = calculateSummary(state);
        top.appendChild(summaryTile("🧰", String(summary.itemCount), "Equipment Items", `${summary.ownedCount} owned`));
        top.appendChild(summaryTile("⚠️", String(summary.missingRequiredCount), "Missing Required", "Capabilities"));
        top.appendChild(summaryTile("★", String(summary.recommendedMissingCount), "Recommended", "Opportunities"));
        top.appendChild(summaryTile("🔧", formatHours(summary.annualMaintenanceHours), "Annual Maintenance", "Estimate"));
        top.appendChild(summaryTile("$", "$" + summary.annualMaintenanceCost.toFixed(0), "Annual Maintenance", "Estimate"));
        return top;
    }

    function calculateSummary(state) {
        const warnings = buildAllWarnings(state.moduleCell);
        return {
            itemCount: state.inventory.length,
            ownedCount: state.inventory.filter(function (eq) { return eq.status === "owned"; }).length,
            missingRequiredCount: warnings.filter(function (w) { return w.type === "missing_required_equipment"; }).length,
            recommendedMissingCount: warnings.filter(function (w) { return w.type === "recommended_equipment_missing"; }).length,
            annualMaintenanceHours: state.inventory.reduce(function (sum, eq) { return sum + annualMaintenanceHours(eq); }, 0),
            annualMaintenanceCost: state.inventory.reduce(function (sum, eq) { return sum + annualMaintenanceCost(eq); }, 0)
        };
    }

    function annualMaintenanceHours(eq) {
        if (!eq || eq.status === "unavailable" || eq.status === "wishlist") return 0;
        if (!eq.maintenanceFrequency || eq.maintenanceFrequency.basis !== "year") return coerceNumber(eq.maintenanceTimeHours, 0);
        const every = Math.max(1, coerceNumber(eq.maintenanceFrequency.every, 1));
        return coerceNumber(eq.maintenanceTimeHours, 0) / every;
    }

    function annualMaintenanceCost(eq) {
        if (!eq || eq.status === "unavailable" || eq.status === "wishlist") return 0;
        if (!eq.maintenanceFrequency || eq.maintenanceFrequency.basis !== "year") return coerceNumber(eq.maintenanceCost, 0);
        const every = Math.max(1, coerceNumber(eq.maintenanceFrequency.every, 1));
        return coerceNumber(eq.maintenanceCost, 0) / every;
    }

    function summaryTile(icon, main, line1, line2) {
        const tile = div("trellis-eq-tile");
        tile.appendChild(textDiv("trellis-eq-tile-icon", icon));
        const text = div("");
        text.appendChild(textDiv("trellis-eq-tile-main", main));
        text.appendChild(textDiv("trellis-eq-tile-sub", line1));
        text.appendChild(textDiv("trellis-eq-tile-sub", line2));
        tile.appendChild(text);
        return tile;
    }

    function renderMainTabs(state, render) {
        const tabs = div("trellis-eq-tabs");
        [
            ["inventory", "▣", "Inventory"],
            ["taskTypes", "☷", "Task Types"],
            ["capabilities", "☰", "Capabilities"],
            ["efficiency", "↕", "Efficiency Rules"],
            ["maintenance", "⚙", "Maintenance & Costs"],
            ["warnings", "⚠", "Warnings"]
        ].forEach(function (tab) {
            const t = textDiv("trellis-eq-tab" + (state.activeTab === tab[0] ? " active" : ""), `${tab[1]}  ${tab[2]}`);
            t.onclick = function () {
                state.activeTab = tab[0];
                render();
            };
            tabs.appendChild(t);
        });
        return tabs;
    }

    function renderInventoryPane(state, render) {
        const pane = div("trellis-eq-pane");
        const listPanel = div("trellis-eq-list-panel");
        const editorPanel = div("trellis-eq-editor-panel");
        pane.appendChild(listPanel);
        pane.appendChild(editorPanel);

        listPanel.appendChild(textDiv("trellis-eq-section-title", "Equipment Inventory"));
        listPanel.appendChild(renderInventoryToolbar(state, render));
        listPanel.appendChild(renderEquipmentTable(state, render));

        const selected = state.inventory.find(function (eq) { return eq.id === state.selectedEquipmentId; });
        editorPanel.appendChild(renderEquipmentEditor(state, selected, render));
        return pane;
    }

    function renderInventoryToolbar(state, render) {
        const toolbar = div("trellis-eq-toolbar");
        toolbar.appendChild(buttonEl("＋ Add", "trellis-eq-btn primary", function () {
            const item = equipment({ id: makeId("eq", "equipment"), name: "New Equipment" });
            state.inventory.push(item);
            state.selectedEquipmentId = item.id;
            render();
        }));
        toolbar.appendChild(buttonEl("Duplicate", "trellis-eq-btn", function () {
            const selected = state.inventory.find(function (eq) { return eq.id === state.selectedEquipmentId; });
            if (!selected) return;
            const copy = normalizeEquipment(Object.assign({}, clone(selected), {
                id: makeId("eq", selected.name),
                name: selected.name + " Copy"
            }));
            state.inventory.push(copy);
            state.selectedEquipmentId = copy.id;
            render();
        }));
        toolbar.appendChild(buttonEl("Delete", "trellis-eq-btn danger", function () {
            if (!state.selectedEquipmentId) return;
            if (!confirm("Delete this equipment item?")) return;
            state.inventory = state.inventory.filter(function (eq) { return eq.id !== state.selectedEquipmentId; });
            state.selectedEquipmentId = state.inventory[0] && state.inventory[0].id || null;
            render();
        }));
        const search = document.createElement("input");
        search.className = "trellis-eq-search";
        search.placeholder = "Search equipment...";
        search.value = state.filter;
        search.oninput = function () { state.filter = search.value; render(); };
        toolbar.appendChild(search);
        return toolbar;
    }

    function renderEquipmentTable(state, render) {
        const wrap = div("trellis-eq-table-wrap");
        const table = document.createElement("table");
        table.className = "trellis-eq-table";
        table.innerHTML = "<thead><tr><th>Name</th><th>Category</th><th>Status</th><th>Key Capabilities</th></tr></thead>";
        const tbody = document.createElement("tbody");
        const q = trim(state.filter).toLowerCase();

        state.inventory
            .filter(function (eq) {
                if (!q) return true;
                return [eq.name, eq.category, eq.status, eq.capabilities.join(" "), eq.relevantTaskTypes.join(" ")]
                    .join(" ").toLowerCase().indexOf(q) >= 0;
            })
            .sort(byName)
            .forEach(function (eq) {
                const tr = document.createElement("tr");
                if (eq.id === state.selectedEquipmentId) tr.className = "selected";
                tr.onclick = function () { state.selectedEquipmentId = eq.id; render(); };
                tr.appendChild(td(eq.name));
                tr.appendChild(td(labelize(eq.category)));
                tr.appendChild(tdBadge(eq.status, eq.status === "owned" || eq.status === "borrowed" ? "" : eq.status === "unavailable" || eq.status === "needs_repair" ? "gray" : "warn"));
                tr.appendChild(td(eq.capabilities.slice(0, 3).join(", ") || "—"));
                tbody.appendChild(tr);
            });

        table.appendChild(tbody);
        wrap.appendChild(table);
        return wrap;
    }

    function renderEquipmentEditor(state, selected, render) {
        if (!selected) return textDiv("trellis-eq-empty", "No equipment selected.");

        const card = div("trellis-eq-card");
        const head = div("trellis-eq-card-head");
        head.appendChild(textNode(`Edit Equipment: ${selected.name}`));
        card.appendChild(head);
        card.appendChild(renderEditorTabs(state, "activeEquipmentEditorTab", [
            ["general", "General"],
            ["links", "Capabilities & Tasks"],
            ["effects", "Efficiency Effects"],
            ["maintenance", "Maintenance & Costs"],
            ["notes", "Notes"]
        ], render));

        const body = div("trellis-eq-card-body");
        card.appendChild(body);

        if (state.activeEquipmentEditorTab === "general") renderEquipmentGeneral(body, selected, render);
        else if (state.activeEquipmentEditorTab === "links") renderEquipmentLinks(body, selected, state, render);
        else if (state.activeEquipmentEditorTab === "effects") renderEquipmentEffects(body, selected, render);
        else if (state.activeEquipmentEditorTab === "maintenance") renderEquipmentMaintenance(body, selected, render);
        else if (state.activeEquipmentEditorTab === "notes") renderEquipmentNotes(body, selected, render);

        return card;
    }

    function renderEquipmentGeneral(body, eq, render) {
        const grid = div("trellis-eq-form-grid");
        grid.appendChild(field("Name", textInput(eq.name, function (e) { eq.name = e.target.value; render(); })));
        grid.appendChild(field("Category", selectInput(EQUIPMENT_CATEGORIES.map(optPair), eq.category, function (e) { eq.category = e.target.value; render(); })));
        grid.appendChild(field("Status", selectInput(EQUIPMENT_STATUSES.map(optPair), eq.status, function (e) { eq.status = e.target.value; render(); })));
        grid.appendChild(field("Skill Level Required", selectInput(SKILL_LEVELS.map(optPair), eq.skillLevelRequired, function (e) { eq.skillLevelRequired = e.target.value; render(); })));
        grid.appendChild(field("Setup Time (hours)", numberInput(eq.setupTimeHours, function (e) { eq.setupTimeHours = coerceNumber(e.target.value, 0); })));
        grid.appendChild(field("Cleanup Time (hours)", numberInput(eq.cleanupTimeHours, function (e) { eq.cleanupTimeHours = coerceNumber(e.target.value, 0); })));
        grid.appendChild(field("Crew Size Min", numberInput(eq.crewSizeMin, function (e) { eq.crewSizeMin = coerceNumber(e.target.value, 1); })));
        grid.appendChild(field("Crew Size Max", numberInput(eq.crewSizeMax, function (e) { eq.crewSizeMax = coerceNumber(e.target.value, 1); })));
        grid.appendChild(field("Minimum Useful Scale Value", numberInput(eq.minimumUsefulScale.value, function (e) { eq.minimumUsefulScale.value = coerceNumber(e.target.value, 0); })));
        grid.appendChild(field("Minimum Useful Scale Unit", selectInput(QUANTITY_BASES.map(optPair), eq.minimumUsefulScale.unit, function (e) { eq.minimumUsefulScale.unit = e.target.value; })));
        grid.appendChild(field("Maximum Useful Scale Value", numberInput(eq.maximumUsefulScale.value, function (e) { eq.maximumUsefulScale.value = coerceNumber(e.target.value, 0); })));
        grid.appendChild(field("Maximum Useful Scale Unit", selectInput(QUANTITY_BASES.map(optPair), eq.maximumUsefulScale.unit, function (e) { eq.maximumUsefulScale.unit = e.target.value; })));
        body.appendChild(grid);
    }

    function renderEquipmentLinks(body, eq, state, render) {
        const grid = div("trellis-eq-form-grid");
        grid.appendChild(field("Capabilities (comma-separated)", textareaInput(eq.capabilities.join(", "), function (e) { eq.capabilities = splitCsv(e.target.value); }, false)));
        grid.appendChild(field("Relevant Task Types (comma-separated)", textareaInput(eq.relevantTaskTypes.join(", "), function (e) { eq.relevantTaskTypes = splitCsv(e.target.value); }, false)));
        grid.appendChild(field("Relevant Crops (comma-separated crop IDs)", textareaInput(eq.relevantCropIds.join(", "), function (e) { eq.relevantCropIds = splitCsv(e.target.value); }, false)));
        grid.appendChild(field("Relevant Bed Conditions (comma-separated)", textareaInput(eq.relevantBedConditions.join(", "), function (e) { eq.relevantBedConditions = splitCsv(e.target.value); }, false)));
        body.appendChild(grid);

        const hint = div("trellis-eq-small-muted");
        hint.textContent = "Prefer capability IDs over specific equipment names. Example: pruning_hand, bulk_material_hauling, irrigation_timer.";
        body.appendChild(hint);
    }

    function renderEquipmentEffects(body, eq, render) {
        const explanation = div("trellis-eq-small-muted");
        explanation.textContent = "Edit efficiency effects as JSON. Start simple: taskTypeId, effectType, multiplier, minimumScale, stackable.";
        body.appendChild(explanation);
        body.appendChild(field("Efficiency Effects JSON", textareaInput(JSON.stringify(eq.efficiencyEffects, null, 2), function (e) {
            try {
                const parsed = JSON.parse(e.target.value || "[]");
                eq.efficiencyEffects = Array.isArray(parsed) ? parsed.map(normalizeEffect) : [];
            } catch (err) {
                // Keep current value until valid JSON is entered.
            }
        }, true)));
    }

    function renderEquipmentMaintenance(body, eq, render) {
        const grid = div("trellis-eq-form-grid");
        grid.appendChild(field("Purchase Cost ($)", numberInput(eq.purchaseCost, function (e) { eq.purchaseCost = coerceNumber(e.target.value, 0); })));
        grid.appendChild(field("Rental Cost / Day ($)", numberInput(eq.rentalCostPerDay, function (e) { eq.rentalCostPerDay = coerceNumber(e.target.value, 0); })));
        grid.appendChild(field("Replacement Cost ($)", numberInput(eq.replacementCost, function (e) { eq.replacementCost = coerceNumber(e.target.value, 0); })));
        grid.appendChild(field("Expected Lifespan (years)", numberInput(eq.expectedLifespanYears, function (e) { eq.expectedLifespanYears = coerceNumber(e.target.value, 0); })));
        grid.appendChild(field("Purchase Date", textInput(eq.purchaseDate, function (e) { eq.purchaseDate = e.target.value; })));
        grid.appendChild(field("Replacement Date", textInput(eq.replacementDate, function (e) { eq.replacementDate = e.target.value; })));
        grid.appendChild(field("Maintenance Basis", selectInput(["year", "hours_used", "task_count", "season"].map(optPair), eq.maintenanceFrequency.basis, function (e) { eq.maintenanceFrequency.basis = e.target.value; render(); })));
        grid.appendChild(field("Maintenance Every", numberInput(eq.maintenanceFrequency.every, function (e) { eq.maintenanceFrequency.every = coerceNumber(e.target.value, 1); })));
        grid.appendChild(field("Maintenance Time (hours)", numberInput(eq.maintenanceTimeHours, function (e) { eq.maintenanceTimeHours = coerceNumber(e.target.value, 0); })));
        grid.appendChild(field("Maintenance Cost ($)", numberInput(eq.maintenanceCost, function (e) { eq.maintenanceCost = coerceNumber(e.target.value, 0); })));
        body.appendChild(grid);
    }

    function renderEquipmentNotes(body, eq, render) {
        const grid = div("trellis-eq-form-grid");
        grid.appendChild(field("Storage Notes", textareaInput(eq.storageNotes, function (e) { eq.storageNotes = e.target.value; }, false)));
        grid.appendChild(field("Notes", textareaInput(eq.notes, function (e) { eq.notes = e.target.value; }, false)));
        body.appendChild(grid);
    }

    function renderTaskTypesPane(state, render) {
        const pane = div("trellis-eq-pane");
        const listPanel = div("trellis-eq-list-panel");
        const editorPanel = div("trellis-eq-editor-panel");
        pane.appendChild(listPanel);
        pane.appendChild(editorPanel);

        listPanel.appendChild(textDiv("trellis-eq-section-title", "Task Type Registry"));
        const toolbar = div("trellis-eq-toolbar");
        toolbar.appendChild(buttonEl("＋ Add", "trellis-eq-btn primary", function () {
            const tt = taskType({ id: makeId("task", "custom"), name: "Custom Task Type" });
            state.taskTypes.push(tt);
            state.selectedTaskTypeId = tt.id;
            render();
        }));
        toolbar.appendChild(buttonEl("Restore Defaults", "trellis-eq-btn", function () {
            state.taskTypes = mergeDefaults(state.taskTypes, DEFAULT_TASK_TYPES, normalizeTaskType);
            render();
        }));
        toolbar.appendChild(buttonEl("Delete", "trellis-eq-btn danger", function () {
            if (!state.selectedTaskTypeId) return;
            if (!confirm("Delete this task type? Existing tasks using this ID may show warnings.")) return;
            state.taskTypes = state.taskTypes.filter(function (tt) { return tt.id !== state.selectedTaskTypeId; });
            state.selectedTaskTypeId = state.taskTypes[0] && state.taskTypes[0].id || null;
            render();
        }));
        listPanel.appendChild(toolbar);
        listPanel.appendChild(renderTaskTypeTable(state, render));

        const selected = state.taskTypes.find(function (tt) { return tt.id === state.selectedTaskTypeId; });
        editorPanel.appendChild(renderTaskTypeEditor(state, selected, render));
        return pane;
    }

    function renderTaskTypeTable(state, render) {
        const wrap = div("trellis-eq-table-wrap");
        const table = document.createElement("table");
        table.className = "trellis-eq-table";
        table.innerHTML = "<thead><tr><th>Name</th><th>Category</th><th>Quantity</th><th>Required</th></tr></thead>";
        const tbody = document.createElement("tbody");
        state.taskTypes.sort(byName).forEach(function (tt) {
            const tr = document.createElement("tr");
            if (tt.id === state.selectedTaskTypeId) tr.className = "selected";
            tr.onclick = function () { state.selectedTaskTypeId = tt.id; render(); };
            tr.appendChild(td(tt.name));
            tr.appendChild(td(labelize(tt.category)));
            tr.appendChild(td(tt.defaultQuantityBasis));
            tr.appendChild(td(tt.requiredCapabilities.join(", ") || "—"));
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        wrap.appendChild(table);
        return wrap;
    }

    function renderTaskTypeEditor(state, tt, render) {
        if (!tt) return textDiv("trellis-eq-empty", "No task type selected.");
        const card = div("trellis-eq-card");
        const head = div("trellis-eq-card-head");
        head.appendChild(textNode(`Edit Task Type: ${tt.name}`));
        card.appendChild(head);
        card.appendChild(renderEditorTabs(state, "activeTaskTypeEditorTab", [["general", "General"], ["rules", "Requirements & Rules"]], render));
        const body = div("trellis-eq-card-body");
        card.appendChild(body);

        if (state.activeTaskTypeEditorTab === "general") {
            const grid = div("trellis-eq-form-grid");
            grid.appendChild(field("ID", textInput(tt.id, function (e) { tt.id = sanitizeId(e.target.value); render(); })));
            grid.appendChild(field("Name", textInput(tt.name, function (e) { tt.name = e.target.value; render(); })));
            grid.appendChild(field("Category", textInput(tt.category, function (e) { tt.category = sanitizeId(e.target.value); })));
            grid.appendChild(field("Default Quantity Basis", selectInput(QUANTITY_BASES.map(optPair), tt.defaultQuantityBasis, function (e) { tt.defaultQuantityBasis = e.target.value; render(); })));
            grid.appendChild(field("Allowed Quantity Bases", textareaInput(tt.allowedQuantityBases.join(", "), function (e) { tt.allowedQuantityBases = splitCsv(e.target.value); }, false)));
            grid.appendChild(field("Base Hours Per Unit JSON", textareaInput(JSON.stringify(tt.baseHoursPerUnit, null, 2), function (e) {
                try { tt.baseHoursPerUnit = normalizeNumberMap(JSON.parse(e.target.value || "{}"), tt.baseHoursPerUnit); } catch (err) {}
            }, true)));
            body.appendChild(grid);
        } else {
            const grid = div("trellis-eq-form-grid");
            grid.appendChild(field("Required Capabilities", textareaInput(tt.requiredCapabilities.join(", "), function (e) { tt.requiredCapabilities = splitCsv(e.target.value); }, false)));
            grid.appendChild(field("Optional Capabilities", textareaInput(tt.optionalCapabilities.join(", "), function (e) { tt.optionalCapabilities = splitCsv(e.target.value); }, false)));
            grid.appendChild(field("Recommended Capabilities", textareaInput(tt.recommendedCapabilities.join(", "), function (e) { tt.recommendedCapabilities = splitCsv(e.target.value); }, false)));
            grid.appendChild(field("Complexity Modifiers JSON", textareaInput(JSON.stringify(tt.complexityModifiers, null, 2), function (e) {
                try { tt.complexityModifiers = normalizeNumberMap(JSON.parse(e.target.value || "{}"), tt.complexityModifiers); } catch (err) {}
            }, true)));
            grid.appendChild(field("Default Setup Time", numberInput(tt.defaultSetupTimeHours, function (e) { tt.defaultSetupTimeHours = coerceNumber(e.target.value, 0); })));
            grid.appendChild(field("Default Cleanup Time", numberInput(tt.defaultCleanupTimeHours, function (e) { tt.defaultCleanupTimeHours = coerceNumber(e.target.value, 0); })));
            grid.appendChild(field("Notes", textareaInput(tt.notes, function (e) { tt.notes = e.target.value; }, false)));
            body.appendChild(grid);
        }
        return card;
    }

    function renderCapabilitiesPane(state, render) {
        const pane = div("trellis-eq-pane");
        const listPanel = div("trellis-eq-list-panel");
        const editorPanel = div("trellis-eq-editor-panel");
        pane.appendChild(listPanel);
        pane.appendChild(editorPanel);

        listPanel.appendChild(textDiv("trellis-eq-section-title", "Capability Registry"));
        const toolbar = div("trellis-eq-toolbar");
        toolbar.appendChild(buttonEl("＋ Add", "trellis-eq-btn primary", function () {
            const c = normalizeCapability({ id: makeId("cap", "custom"), name: "Custom Capability" });
            state.capabilities.push(c);
            state.selectedCapabilityId = c.id;
            render();
        }));
        toolbar.appendChild(buttonEl("Restore Defaults", "trellis-eq-btn", function () {
            state.capabilities = mergeDefaults(state.capabilities, DEFAULT_CAPABILITIES, normalizeCapability);
            render();
        }));
        toolbar.appendChild(buttonEl("Delete", "trellis-eq-btn danger", function () {
            if (!state.selectedCapabilityId) return;
            if (!confirm("Delete this capability from the registry? Equipment and task types that reference it are not automatically changed.")) return;
            state.capabilities = state.capabilities.filter(function (c) { return c.id !== state.selectedCapabilityId; });
            state.selectedCapabilityId = state.capabilities[0] && state.capabilities[0].id || null;
            render();
        }));
        listPanel.appendChild(toolbar);
        listPanel.appendChild(renderCapabilitiesTable(state, render));

        const selected = state.capabilities.find(function (c) { return c.id === state.selectedCapabilityId; });
        editorPanel.appendChild(renderCapabilityEditor(selected, render));
        return pane;
    }

    function renderCapabilitiesTable(state, render) {
        const wrap = div("trellis-eq-table-wrap");
        const table = document.createElement("table");
        table.className = "trellis-eq-table";
        table.innerHTML = "<thead><tr><th>Name</th><th>ID</th><th>Category</th></tr></thead>";
        const tbody = document.createElement("tbody");
        state.capabilities.sort(byName).forEach(function (c) {
            const tr = document.createElement("tr");
            if (c.id === state.selectedCapabilityId) tr.className = "selected";
            tr.onclick = function () { state.selectedCapabilityId = c.id; render(); };
            tr.appendChild(td(c.name));
            tr.appendChild(td(c.id));
            tr.appendChild(td(c.category));
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        wrap.appendChild(table);
        return wrap;
    }

    function renderCapabilityEditor(c, render) {
        if (!c) return textDiv("trellis-eq-empty", "No capability selected.");
        const card = div("trellis-eq-card");
        const head = div("trellis-eq-card-head");
        head.appendChild(textNode(`Edit Capability: ${c.name}`));
        card.appendChild(head);
        const body = div("trellis-eq-card-body");
        const grid = div("trellis-eq-form-grid");
        grid.appendChild(field("ID", textInput(c.id, function (e) { c.id = sanitizeId(e.target.value); render(); })));
        grid.appendChild(field("Name", textInput(c.name, function (e) { c.name = e.target.value; render(); })));
        grid.appendChild(field("Category", textInput(c.category, function (e) { c.category = sanitizeId(e.target.value); })));
        grid.appendChild(field("Description", textareaInput(c.description, function (e) { c.description = e.target.value; }, false)));
        body.appendChild(grid);
        card.appendChild(body);
        return card;
    }

    function renderEfficiencyPane(state, render) {
        const pane = div("trellis-eq-warning-list");
        pane.appendChild(textDiv("trellis-eq-section-title", "Efficiency Rules"));
        const note = div("trellis-eq-card");
        note.appendChild(textDiv("trellis-eq-card-head", "How this MVP handles efficiency"));
        const body = div("trellis-eq-card-body");
        body.appendChild(paragraph("Efficiency rules currently live inside each equipment item as JSON. The workload helper chooses the best non-stackable hours_multiplier for a task type, then applies explicitly stackable effects."));
        body.appendChild(paragraph("Next step: replace raw JSON editing with a structured effect editor that supports hours multipliers, frequency multipliers, setup/cleanup changes, capacity limits, and crew modifiers."));
        note.appendChild(body);
        pane.appendChild(note);

        const tableWrap = div("trellis-eq-table-wrap");
        const table = document.createElement("table");
        table.className = "trellis-eq-table";
        table.innerHTML = "<thead><tr><th>Equipment</th><th>Task Type</th><th>Effect Type</th><th>Multiplier</th><th>Scale</th></tr></thead>";
        const tbody = document.createElement("tbody");
        state.inventory.forEach(function (eq) {
            (eq.efficiencyEffects || []).forEach(function (eff) {
                const tr = document.createElement("tr");
                tr.appendChild(td(eq.name));
                tr.appendChild(td(eff.taskTypeId || "—"));
                tr.appendChild(td(eff.effectType || "—"));
                tr.appendChild(td(String(eff.multiplier)));
                tr.appendChild(td(eff.minimumScale ? `${eff.minimumScale.value} ${eff.minimumScale.unit}+` : "—"));
                tbody.appendChild(tr);
            });
        });
        table.appendChild(tbody);
        tableWrap.appendChild(table);
        pane.appendChild(tableWrap);
        return pane;
    }

    function renderMaintenancePane(state) {
        const pane = div("trellis-eq-warning-list");
        pane.appendChild(textDiv("trellis-eq-section-title", "Maintenance & Costs"));
        const tableWrap = div("trellis-eq-table-wrap");
        const table = document.createElement("table");
        table.className = "trellis-eq-table";
        table.innerHTML = "<thead><tr><th>Equipment</th><th>Status</th><th>Maintenance Basis</th><th>Annual Hours</th><th>Annual Cost</th><th>Replacement</th></tr></thead>";
        const tbody = document.createElement("tbody");
        state.inventory.sort(byName).forEach(function (eq) {
            const tr = document.createElement("tr");
            tr.appendChild(td(eq.name));
            tr.appendChild(td(eq.status));
            tr.appendChild(td(`${eq.maintenanceFrequency.basis} / ${eq.maintenanceFrequency.every}`));
            tr.appendChild(td(formatHours(annualMaintenanceHours(eq))));
            tr.appendChild(td("$" + annualMaintenanceCost(eq).toFixed(2)));
            tr.appendChild(td(eq.replacementDate || (eq.expectedLifespanYears ? `${eq.expectedLifespanYears} yrs` : "—")));
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        tableWrap.appendChild(table);
        pane.appendChild(tableWrap);
        return pane;
    }

    function renderWarningsPane(state) {
        const pane = div("trellis-eq-warning-list");
        pane.appendChild(textDiv("trellis-eq-section-title", "Equipment Warnings"));
        const warnings = buildAllWarnings(state.moduleCell);

        if (warnings.length === 0) {
            pane.appendChild(textDiv("trellis-eq-empty", "No scheduler task equipment warnings found. Assign task_type_id to scheduler task cells to enable warnings."));
            return pane;
        }

        warnings.forEach(function (warning) {
            const item = div("trellis-eq-warning " + (warning.severity || ""));
            item.appendChild(textDiv("", warning.message));
            item.appendChild(textDiv("trellis-eq-small-muted", warning.type));
            pane.appendChild(item);
        });
        return pane;
    }

    function renderEditorTabs(state, key, tabs, render) {
        const wrap = div("trellis-eq-editor-tabs");
        tabs.forEach(function (tab) {
            const item = textDiv("trellis-eq-editor-tab" + (state[key] === tab[0] ? " active" : ""), tab[1]);
            item.onclick = function () { state[key] = tab[0]; render(); };
            wrap.appendChild(item);
        });
        return wrap;
    }

    function renderFooter(state, render, saveAll, saveAndClose, close) {
        const footer = div("trellis-eq-footer");
        const left = div("trellis-eq-footer-left");
        const right = div("trellis-eq-footer-right");

        left.appendChild(buttonEl("⚙ Restore Defaults", "trellis-eq-btn", function () {
            if (!confirm("Restore default equipment, task types, and capabilities? Custom records will be preserved when IDs differ.")) return;
            state.inventory = mergeDefaults(state.inventory, DEFAULT_EQUIPMENT, normalizeEquipment);
            state.taskTypes = mergeDefaults(state.taskTypes, DEFAULT_TASK_TYPES, normalizeTaskType);
            state.capabilities = mergeDefaults(state.capabilities, DEFAULT_CAPABILITIES, normalizeCapability);
            render();
        }));

        right.appendChild(buttonEl("Export…", "trellis-eq-btn", function () {
            exportJson(state);
        }));
        right.appendChild(buttonEl("Import…", "trellis-eq-btn", function () {
            importJson(state, render);
        }));
        right.appendChild(buttonEl("Save", "trellis-eq-btn", saveAll));
        right.appendChild(buttonEl("Save & Close", "trellis-eq-btn primary", saveAndClose));
        right.appendChild(buttonEl("Cancel", "trellis-eq-btn", close));

        footer.appendChild(left);
        footer.appendChild(right);
        return footer;
    }

    function exportJson(state) {
        const payload = {
            version: PLUGIN_VERSION,
            exportedAt: new Date().toISOString(),
            equipment: state.inventory.map(normalizeEquipment),
            taskTypes: state.taskTypes.map(normalizeTaskType),
            capabilities: state.capabilities.map(normalizeCapability)
        };
        const text = JSON.stringify(payload, null, 2);
        const blob = new Blob([text], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "trellis_garden_equipment.json";
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
            URL.revokeObjectURL(url);
            if (a.parentNode) a.parentNode.removeChild(a);
        }, 0);
    }

    function importJson(state, render) {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "application/json";
        input.onchange = function () {
            const file = input.files && input.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function () {
                try {
                    const parsed = JSON.parse(String(reader.result || "{}"));
                    if (Array.isArray(parsed.equipment)) state.inventory = parsed.equipment.map(normalizeEquipment);
                    if (Array.isArray(parsed.taskTypes)) state.taskTypes = mergeDefaults(parsed.taskTypes, DEFAULT_TASK_TYPES, normalizeTaskType);
                    if (Array.isArray(parsed.capabilities)) state.capabilities = mergeDefaults(parsed.capabilities, DEFAULT_CAPABILITIES, normalizeCapability);
                    state.selectedEquipmentId = state.inventory[0] && state.inventory[0].id || null;
                    state.selectedTaskTypeId = state.taskTypes[0] && state.taskTypes[0].id || null;
                    state.selectedCapabilityId = state.capabilities[0] && state.capabilities[0].id || null;
                    render();
                } catch (err) {
                    alert("Could not import JSON: " + err.message);
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    // -------------------------------------------------------------------------
    // Tiny DOM helpers
    // -------------------------------------------------------------------------

    function div(className) {
        const el = document.createElement("div");
        if (className) el.className = className;
        return el;
    }

    function textDiv(className, text) {
        const el = div(className);
        el.textContent = text;
        return el;
    }

    function textNode(text) {
        return document.createTextNode(text);
    }

    function paragraph(text) {
        const p = document.createElement("p");
        p.textContent = text;
        return p;
    }

    function buttonEl(text, className, onClick) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = className || "trellis-eq-btn";
        btn.textContent = text;
        btn.onclick = onClick;
        return btn;
    }

    function td(text) {
        const cell = document.createElement("td");
        cell.textContent = text;
        return cell;
    }

    function tdBadge(text, kind) {
        const cell = document.createElement("td");
        const badge = document.createElement("span");
        badge.className = "trellis-eq-badge " + (kind || "");
        badge.textContent = labelize(text);
        cell.appendChild(badge);
        return cell;
    }

    function field(label, input) {
        const wrap = div("trellis-eq-field");
        const lbl = document.createElement("label");
        lbl.textContent = label;
        wrap.appendChild(lbl);
        wrap.appendChild(input);
        return wrap;
    }

    function fieldLabel(text) {
        const label = document.createElement("label");
        label.textContent = text;
        label.style.display = "block";
        label.style.margin = "8px 0 4px";
        label.style.fontSize = "12px";
        label.style.color = "#445044";
        return label;
    }

    function textInput(value, onInput) {
        const input = document.createElement("input");
        input.type = "text";
        input.value = value == null ? "" : String(value);
        input.oninput = onInput;
        return input;
    }

    function numberInput(value, onInput) {
        const input = document.createElement("input");
        input.type = "number";
        input.step = "0.01";
        input.value = value == null ? "" : String(value);
        input.oninput = onInput;
        return input;
    }

    function textareaInput(value, onInput, mono) {
        const input = document.createElement("textarea");
        if (mono) input.className = "mono";
        input.value = value == null ? "" : String(value);
        input.oninput = onInput;
        return input;
    }

    function selectInput(options, selectedValue, onChange) {
        const select = document.createElement("select");
        (options || []).forEach(function (pair) {
            const option = document.createElement("option");
            option.value = pair[0];
            option.textContent = pair[1];
            if (pair[0] === selectedValue) option.selected = true;
            select.appendChild(option);
        });
        select.onchange = onChange;
        return select;
    }

    function optPair(value) {
        return [value, labelize(value)];
    }

    function labelize(value) {
        return String(value || "")
            .replace(/_/g, " ")
            .replace(/\b\w/g, function (m) { return m.toUpperCase(); });
    }

    function sanitizeId(value) {
        return trim(value).toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
    }

    function formatHours(value) {
        const n = coerceNumber(value, 0);
        if (Math.abs(n - Math.round(n)) < 0.05) return String(Math.round(n)) + " h";
        return n.toFixed(1) + " h";
    }

    // -------------------------------------------------------------------------
    // Draw.io integration
    // -------------------------------------------------------------------------

    function addActionAndMenus() {
        ui.actions.addAction(ACTION_ID, function () {
            openEquipmentDialog(getActiveGardenModule());
        });

        const action = ui.actions.get(ACTION_ID);
        if (action) action.label = "Trellis Equipment…";

        if (ui.menus && ui.menus.get) {
            const extras = ui.menus.get("extras");
            if (extras && !extras.__trellisEquipmentPatched) {
                const oldFunct = extras.funct;
                extras.funct = function (menu, parent) {
                    if (typeof oldFunct === "function") oldFunct.apply(this, arguments);
                    ui.menus.addMenuItems(menu, ["-", ACTION_ID], parent);
                };
                extras.__trellisEquipmentPatched = true;
            }
        }

        patchContextMenu();
    }

    function patchContextMenu() {
        if (!graph.popupMenuHandler || graph.__trellisEquipmentContextPatched) return;
        graph.__trellisEquipmentContextPatched = true;

        const oldFactory = graph.popupMenuHandler.factoryMethod;
        graph.popupMenuHandler.factoryMethod = function (menu, cell, evt) {
            if (typeof oldFactory === "function") oldFactory.apply(this, arguments);

            const moduleCell = cell ? findAncestorGardenModule(cell) : getActiveGardenModule();
            const isRootClick = !cell;
            if (!moduleCell && !isRootClick) return;

            menu.addSeparator();
            menu.addItem("Trellis Equipment…", null, function () {
                openEquipmentDialog(moduleCell || getActiveGardenModule());
            });
        };
    }

    function fireTrellisEvent(name, detail) {
        try {
            if (typeof mxEventObject !== "undefined" && graph.fireEvent) {
                graph.fireEvent(new mxEventObject(name, "detail", detail || {}));
            }
        } catch (err) {
            // Non-fatal: custom DOM event below is enough for many integrations.
        }

        try {
            document.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
        } catch (err) {
            // Ignore older browser edge cases.
        }
    }

    graph.__trellisEquipment = {
        version: PLUGIN_VERSION,
        attrs: ATTRS,
        taskAttrs: TASK_ATTRS,
        events: EVENTS,
        openDialog: openEquipmentDialog,
        getActiveGardenModule: getActiveGardenModule,
        readEquipmentInventory: readEquipmentInventory,
        writeEquipmentInventory: writeEquipmentInventory,
        readTaskTypeRegistry: readTaskTypeRegistry,
        writeTaskTypeRegistry: writeTaskTypeRegistry,
        readCapabilityRegistry: readCapabilityRegistry,
        writeCapabilityRegistry: writeCapabilityRegistry,
        isEquipmentAvailable: isEquipmentAvailable,
        findAvailableEquipmentByCapability: findAvailableEquipmentByCapability,
        checkCapabilities: checkCapabilities,
        buildTaskEquipmentWarnings: buildTaskEquipmentWarnings,
        buildAllWarnings: buildAllWarnings,
        estimateTaskHours: estimateTaskHours,
        renderTaskTypeControls: renderTaskTypeControls,
        defaults: {
            equipment: clone(DEFAULT_EQUIPMENT),
            taskTypes: clone(DEFAULT_TASK_TYPES),
            capabilities: clone(DEFAULT_CAPABILITIES)
        }
    };

    addActionAndMenus();
    fireTrellisEvent("trellisEquipmentPluginReady", { graph, api: graph.__trellisEquipment });
});