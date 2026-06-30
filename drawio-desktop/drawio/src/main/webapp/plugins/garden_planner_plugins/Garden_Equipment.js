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

    const EFFECT_TYPES = ["hours_multiplier"]; // NEW
    const COMPLEXITY_KEYS = ["simple", "normal", "difficult", "restoration"]; // NEW
    const FIELD_TOOLTIPS = { // NEW
        "Purchase Cost ($)": "Original purchase price for reference; it is not included in the yearly replacement reserve.", // NEW
        "Rental Cost / Day ($)": "Daily rental price for rented equipment; it is not included in the yearly replacement reserve.", // NEW
        "Replacement Cost ($)": "Gross future cost to replace this item; used in yearly replacement reserve estimates.", // NEW
        "Expected Lifespan (years)": "Expected service life in whole years. Replacement reserve is zero when this is zero.", // NEW
        "Purchase Date": "Optional purchase date used to calculate the replacement date.", // NEW
        "Override Replacement Date": "Enable this to manually set replacement date instead of calculating it from purchase date and lifespan.", // NEW
        "Replacement Date": "Calculated from purchase date and lifespan unless override is enabled.", // NEW
        "Maintenance Basis": "How recurring maintenance is scheduled for this item.", // NEW
        "Maintenance Every": "Frequency interval for the selected maintenance basis.", // NEW
        "Maintenance Time (hours)": "Labor required each maintenance interval.", // NEW
        "Maintenance Cost ($)": "Recurring maintenance cost each interval; separate from replacement reserve.", // NEW
        "ID": "Stable internal ID used by saved equipment links and cross-plugin references." // NEW
    }; // NEW
    const ROW_FIELD_TOOLTIPS = { // NEW
        "Task Type": "Task type this efficiency rule applies to.", // NEW
        "Type": "Efficiency effect type. Equipment currently supports hours multipliers.", // NEW
        "Multiplier": "Task hours multiplier. Values below 1 reduce estimated hours; values above 1 increase them.", // NEW
        "Minimum": "Minimum task scale before this efficiency rule applies.", // NEW
        "Unit": "Quantity unit for the minimum scale.", // NEW
        "Stack": "Allow this effect to stack with the best non-stackable equipment effect.", // NEW
        "Maximum Scale": "Optional maximum task scale for this rule. Leave zero for no maximum.", // NEW
        "Max Unit": "Quantity unit for the maximum scale.", // NEW
        "Key": "Quantity basis key for this task type.", // NEW
        "Value": "Hours value for this quantity basis." // NEW
    }; // NEW

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
            id: "general",
            name: "General Task",
            category: "general",
            defaultQuantityBasis: "tasks",
            allowedQuantityBases: ["tasks"],
            baseHoursPerUnit: { tasks: 0.5 },
            requiredCapabilities: [],
            optionalCapabilities: [],
            recommendedCapabilities: [],
            defaultSetupTimeHours: 0,
            defaultCleanupTimeHours: 0
        }),
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
            id: "hardening_off",
            name: "Hardening Off",
            category: "crop_care",
            defaultQuantityBasis: "plants",
            allowedQuantityBases: ["plants", "tasks"],
            baseHoursPerUnit: { plants: 0.02, tasks: 0.25 },
            requiredCapabilities: [],
            optionalCapabilities: ["seedling_tray_starting", "bulk_material_hauling"],
            recommendedCapabilities: [],
            defaultSetupTimeHours: 0.03,
            defaultCleanupTimeHours: 0.03
        }),
        taskType({
            id: "thinning_check",
            name: "Thinning Check",
            category: "crop_care",
            defaultQuantityBasis: "plants",
            allowedQuantityBases: ["plants", "row_meters", "beds", "tasks"],
            baseHoursPerUnit: { plants: 0.015, row_meters: 0.05, beds: 0.25, tasks: 0.25 },
            requiredCapabilities: [],
            optionalCapabilities: ["weeding_hand", "weeding_precision"],
            recommendedCapabilities: [],
            defaultSetupTimeHours: 0.02,
            defaultCleanupTimeHours: 0.03
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
            id: "seedling_starting",
            name: "Seedling Starting",
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

    const CANONICAL_TASK_TYPE_IDS = new Set(DEFAULT_TASK_TYPES.map(function (tt) { return tt.id; })); // NEW

    const FALLBACK_BED_CONDITION_GROUPS = [ // NEW
        conditionGroup("sunExposure", "Sun exposure", [["full_sun", "Full sun"], ["part_sun", "Part sun"], ["part_shade", "Part shade"], ["shade", "Shade"]]), // NEW
        conditionGroup("soilMoisture", "Soil moisture", [["dry", "Dry"], ["moderate", "Moderate"], ["moist", "Moist"], ["wet", "Wet"]]), // NEW
        conditionGroup("drainage", "Drainage", [["fast", "Fast drainage"], ["normal", "Normal drainage"], ["slow", "Slow drainage"]]), // NEW
        conditionGroup("soilTexture", "Soil texture", [["sandy", "Sandy"], ["loamy", "Loamy"], ["clay", "Clay"], ["mixed", "Mixed"], ["amended", "Amended"]]), // NEW
        conditionGroup("fertility", "Fertility", [["low", "Low"], ["medium", "Medium"], ["high", "High"]]), // NEW
        conditionGroup("irrigation", "Irrigation", [["none", "None"], ["manual", "Manual"], ["drip", "Drip"], ["sprinkler", "Sprinkler"], ["self_watering", "Self watering"]]), // NEW
        conditionGroup("trellis", "Trellis", [["none", "None"], ["available", "Available"], ["required_structure", "Structure required"]]), // NEW
        conditionGroup("seasonExtension", "Season extension", [["none", "None"], ["row_cover", "Row cover"], ["low_tunnel", "Low tunnel"], ["cold_frame", "Cold frame"], ["greenhouse", "Greenhouse"], ["high_tunnel", "High tunnel"], ["heated_greenhouse", "Heated greenhouse"]]), // NEW
        conditionGroup("cropProtection", "Crop protection", [["none", "None"], ["shade_cloth", "Shade cloth"], ["insect_netting", "Insect netting"], ["bird_netting", "Bird netting"], ["hail_netting", "Hail netting"]]), // NEW
        conditionGroup("windExposure", "Wind exposure", [["sheltered", "Sheltered"], ["moderate", "Moderate"], ["exposed", "Exposed"]]), // NEW
        conditionGroup("frostRisk", "Frost risk", [["none", "None"], ["low", "Low"], ["medium", "Medium"], ["high", "High"]]), // NEW
        conditionGroup("bedUse", "Bed use", [["annuals", "Annuals"], ["perennials", "Perennials"], ["nursery", "Nursery"], ["seed_starting", "Seed starting"], ["mixed", "Mixed"], ["resting", "Resting"]]) // NEW
    ]; // NEW

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

    function conditionGroup(fieldKey, label, options) { // NEW
        return { // NEW
            id: fieldKey, // NEW
            name: label, // NEW
            options: (options || []).map(function (pair) { // NEW
                return { id: fieldKey + ":" + pair[0], fieldKey: fieldKey, value: pair[0], name: pair[1], category: label }; // NEW
            }) // NEW
        }; // NEW
    } // NEW

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

    function coerceWholeYears(value, fallback) { // NEW
        return Math.max(0, Math.round(coerceNumber(value, fallback))); // NEW
    } // NEW

    function isIsoDate(value) { // NEW
        const text = trim(value); // NEW
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false; // NEW
        const parts = text.split("-").map(Number); // NEW
        const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])); // NEW
        return date.getUTCFullYear() === parts[0] && date.getUTCMonth() === parts[1] - 1 && date.getUTCDate() === parts[2]; // NEW
    } // NEW

    function daysInMonth(year, monthOneBased) { // NEW
        return new Date(Date.UTC(year, monthOneBased, 0)).getUTCDate(); // NEW
    } // NEW

    function formatIsoDate(year, monthOneBased, day) { // NEW
        return [ // NEW
            String(year).padStart(4, "0"), // NEW
            String(monthOneBased).padStart(2, "0"), // NEW
            String(day).padStart(2, "0") // NEW
        ].join("-"); // NEW
    } // NEW

    function calculateReplacementDate(purchaseDate, expectedLifespanYears) { // NEW
        if (!isIsoDate(purchaseDate)) return ""; // NEW
        const years = coerceWholeYears(expectedLifespanYears, 0); // NEW
        if (years <= 0) return ""; // NEW
        const parts = trim(purchaseDate).split("-").map(Number); // NEW
        const targetYear = parts[0] + years; // NEW
        const targetDay = Math.min(parts[2], daysInMonth(targetYear, parts[1])); // NEW
        return formatIsoDate(targetYear, parts[1], targetDay); // NEW
    } // NEW

    function syncCalculatedReplacementDate(eq) { // NEW
        if (!eq || eq.replacementDateOverride) return; // NEW
        eq.replacementDate = calculateReplacementDate(eq.purchaseDate, eq.expectedLifespanYears); // NEW
    } // NEW

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
        out.expectedLifespanYears = coerceWholeYears(out.expectedLifespanYears, 0); // CHANGE
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
        out.purchaseDate = trim(out.purchaseDate); // CHANGE
        out.replacementDate = trim(out.replacementDate); // CHANGE
        const hadReplacementOverride = Object.prototype.hasOwnProperty.call(record || {}, "replacementDateOverride"); // NEW
        const calculatedReplacementDate = calculateReplacementDate(out.purchaseDate, out.expectedLifespanYears); // NEW
        out.replacementDateOverride = hadReplacementOverride // NEW
            ? !!out.replacementDateOverride // NEW
            : !!out.replacementDate && (!calculatedReplacementDate || out.replacementDate !== calculatedReplacementDate); // NEW
        syncCalculatedReplacementDate(out); // NEW
        out.storageNotes = trim(out.storageNotes);
        out.notes = trim(out.notes);
        return out;
    }

    function normalizeEffect(record) {
        const out = Object.assign({}, record || {});
        out.taskTypeId = trim(out.taskTypeId);
        const incomingType = trim(out.effectType) || "hours_multiplier"; // NEW
        out.effectType = incomingType === "frequency_multiplier" ? "hours_multiplier" : incomingType; // CHANGE
        if (EFFECT_TYPES.indexOf(out.effectType) < 0) out.effectType = "hours_multiplier"; // NEW
        out.multiplier = coerceNumber(out.multiplier, 1);
        out.minimumScale = Object.assign({ value: 0, unit: "tasks" }, out.minimumScale || {});
        out.maximumScale = out.maximumScale ? Object.assign({ value: 0, unit: "tasks" }, out.maximumScale) : null;
        out.minimumScale.value = coerceNumber(out.minimumScale.value, 0);
        if (out.maximumScale) out.maximumScale.value = coerceNumber(out.maximumScale.value, 0);
        out.stackable = !!out.stackable;
        out.notes = trim(out.notes);
        if (incomingType === "frequency_multiplier" && out.notes.indexOf("Converted from frequency_multiplier.") < 0) { // NEW
            out.notes = trim("Converted from frequency_multiplier. " + out.notes); // NEW
        } // NEW
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

    function buildRegistrySet(items) { // NEW
        return new Set((items || []).map(function (item) { return item && item.id; }).filter(Boolean)); // NEW
    } // NEW

    function pushValidation(report, severity, message) { // NEW
        report.items.push({ severity, message }); // NEW
        if (severity === "error") report.errors += 1; // NEW
        else report.warnings += 1; // NEW
    } // NEW

    function validateUniqueIds(records, label, report) { // NEW
        const seen = new Set(); // NEW
        (records || []).forEach(function (record) { // NEW
            const id = trim(record && record.id); // NEW
            if (!id) pushValidation(report, "error", `${label} has a blank ID.`); // NEW
            else if (seen.has(id)) pushValidation(report, "error", `${label} '${id}' is duplicated.`); // NEW
            seen.add(id); // NEW
        }); // NEW
    } // NEW

    function validateNumberMap(map, owner, report) { // NEW
        Object.keys(map || {}).forEach(function (key) { // NEW
            if (!key) pushValidation(report, "error", `${owner} has a blank rate key.`); // NEW
            if (!Number.isFinite(Number(map[key]))) pushValidation(report, "error", `${owner} has an invalid number for '${key}'.`); // NEW
        }); // NEW
    } // NEW

    function validateEquipmentState(inventory, taskTypes, capabilities) { // NEW
        const report = { errors: 0, warnings: 0, items: [] }; // NEW
        const taskIds = buildRegistrySet(taskTypes); // NEW
        const capabilityIds = buildRegistrySet(capabilities); // NEW
        validateUniqueIds(inventory, "Equipment", report); // NEW
        validateUniqueIds(taskTypes, "Task type", report); // NEW
        validateUniqueIds(capabilities, "Capability", report); // NEW

        (inventory || []).forEach(function (eq) { // NEW
            if (eq.purchaseDate && !isIsoDate(eq.purchaseDate)) pushValidation(report, "error", `${eq.name} has an invalid purchase date.`); // NEW
            if (eq.replacementDate && !isIsoDate(eq.replacementDate)) pushValidation(report, "error", `${eq.name} has an invalid replacement date.`); // NEW
            (eq.capabilities || []).forEach(function (id) { // NEW
                if (!capabilityIds.has(id)) pushValidation(report, "error", `${eq.name} references missing capability '${id}'.`); // NEW
            }); // NEW
            (eq.relevantTaskTypes || []).forEach(function (id) { // NEW
                if (!taskIds.has(id)) pushValidation(report, "error", `${eq.name} references missing task type '${id}'.`); // NEW
            }); // NEW
            (eq.efficiencyEffects || []).forEach(function (eff, index) { // NEW
                if (!taskIds.has(eff.taskTypeId)) pushValidation(report, "error", `${eq.name} effect ${index + 1} references missing task type '${eff.taskTypeId}'.`); // NEW
                if (EFFECT_TYPES.indexOf(eff.effectType) < 0) pushValidation(report, "error", `${eq.name} effect ${index + 1} has unsupported type '${eff.effectType}'.`); // NEW
                if (!Number.isFinite(Number(eff.multiplier)) || Number(eff.multiplier) <= 0) pushValidation(report, "error", `${eq.name} effect ${index + 1} needs a positive multiplier.`); // NEW
                if (!eff.minimumScale || QUANTITY_BASES.indexOf(eff.minimumScale.unit) < 0) pushValidation(report, "error", `${eq.name} effect ${index + 1} has an invalid minimum scale unit.`); // NEW
                if (eff.maximumScale && eff.maximumScale.value > 0 && QUANTITY_BASES.indexOf(eff.maximumScale.unit) < 0) pushValidation(report, "error", `${eq.name} effect ${index + 1} has an invalid maximum scale unit.`); // NEW
            }); // NEW
        }); // NEW

        (taskTypes || []).forEach(function (tt) { // NEW
            if ((tt.allowedQuantityBases || []).indexOf(tt.defaultQuantityBasis) < 0) pushValidation(report, "error", `${tt.name} default quantity basis is not allowed.`); // NEW
            validateNumberMap(tt.baseHoursPerUnit, `${tt.name} base hours`, report); // NEW
            validateNumberMap(tt.complexityModifiers, `${tt.name} complexity`, report); // NEW
            ["requiredCapabilities", "optionalCapabilities", "recommendedCapabilities"].forEach(function (fieldName) { // NEW
                (tt[fieldName] || []).forEach(function (id) { // NEW
                    if (!capabilityIds.has(id)) pushValidation(report, "error", `${tt.name} ${fieldName} references missing capability '${id}'.`); // NEW
                }); // NEW
            }); // NEW
        }); // NEW

        return report; // NEW
    } // NEW

    function validateState(state) { // NEW
        return validateEquipmentState(state.inventory, state.taskTypes, state.capabilities); // NEW
    } // NEW

    function canSaveState(state) { // NEW
        const report = validateState(state); // NEW
        state.validationReport = report; // NEW
        return report.errors === 0; // NEW
    } // NEW

    function replaceListId(list, oldId, newId) { // NEW
        return uniqueStrings((list || []).map(function (id) { return id === oldId ? newId : id; })); // NEW
    } // NEW

    function removeListId(list, removedId) { // NEW
        return (list || []).filter(function (id) { return id !== removedId; }); // NEW
    } // NEW

    function uniqueStrings(list) { // NEW
        const seen = new Set(); // NEW
        const out = []; // NEW
        (list || []).forEach(function (value) { // NEW
            const id = trim(value); // NEW
            if (!id || seen.has(id)) return; // NEW
            seen.add(id); // NEW
            out.push(id); // NEW
        }); // NEW
        return out; // NEW
    } // NEW

    function describeCapabilityReferences(state, capabilityId) { // NEW
        const refs = []; // NEW
        (state.inventory || []).forEach(function (eq) { // NEW
            if ((eq.capabilities || []).indexOf(capabilityId) >= 0) refs.push(`${eq.name} equipment capability`); // NEW
        }); // NEW
        (state.taskTypes || []).forEach(function (tt) { // NEW
            ["requiredCapabilities", "optionalCapabilities", "recommendedCapabilities"].forEach(function (fieldName) { // NEW
                if ((tt[fieldName] || []).indexOf(capabilityId) >= 0) refs.push(`${tt.name} ${labelize(fieldName)}`); // NEW
            }); // NEW
        }); // NEW
        return refs; // NEW
    } // NEW

    function describeTaskTypeReferences(state, taskTypeId) { // NEW
        const refs = []; // NEW
        (state.inventory || []).forEach(function (eq) { // NEW
            if ((eq.relevantTaskTypes || []).indexOf(taskTypeId) >= 0) refs.push(`${eq.name} relevant task type`); // NEW
            (eq.efficiencyEffects || []).forEach(function (eff) { // NEW
                if (eff.taskTypeId === taskTypeId) refs.push(`${eq.name} efficiency effect`); // NEW
            }); // NEW
        }); // NEW
        return refs; // NEW
    } // NEW

    function previewReferenceMessage(action, id, refs) { // NEW
        if (!refs.length) return `${action} '${id}'?`; // NEW
        return `${action} '${id}' and update ${refs.length} reference(s)?\n\n` + refs.slice(0, 12).join("\n") + (refs.length > 12 ? "\n..." : ""); // NEW
    } // NEW

    function renameCapabilityId(state, oldId, newId) { // NEW
        newId = sanitizeId(newId); // NEW
        if (!newId || newId === oldId) return false; // NEW
        if ((state.capabilities || []).some(function (c) { return c.id === newId; })) { alert("A capability with that ID already exists."); return false; } // NEW
        const refs = describeCapabilityReferences(state, oldId); // NEW
        if (!confirm(previewReferenceMessage("Rename capability", oldId, refs))) return false; // NEW
        state.capabilities.forEach(function (c) { if (c.id === oldId) c.id = newId; }); // NEW
        state.inventory.forEach(function (eq) { eq.capabilities = replaceListId(eq.capabilities, oldId, newId); }); // NEW
        state.taskTypes.forEach(function (tt) { // NEW
            tt.requiredCapabilities = replaceListId(tt.requiredCapabilities, oldId, newId); // NEW
            tt.optionalCapabilities = replaceListId(tt.optionalCapabilities, oldId, newId); // NEW
            tt.recommendedCapabilities = replaceListId(tt.recommendedCapabilities, oldId, newId); // NEW
        }); // NEW
        state.selectedCapabilityId = newId; // NEW
        return true; // NEW
    } // NEW

    function deleteCapabilityId(state, capabilityId) { // NEW
        const refs = describeCapabilityReferences(state, capabilityId); // NEW
        if (!confirm(previewReferenceMessage("Delete capability", capabilityId, refs))) return false; // NEW
        state.capabilities = state.capabilities.filter(function (c) { return c.id !== capabilityId; }); // NEW
        state.inventory.forEach(function (eq) { eq.capabilities = removeListId(eq.capabilities, capabilityId); }); // NEW
        state.taskTypes.forEach(function (tt) { // NEW
            tt.requiredCapabilities = removeListId(tt.requiredCapabilities, capabilityId); // NEW
            tt.optionalCapabilities = removeListId(tt.optionalCapabilities, capabilityId); // NEW
            tt.recommendedCapabilities = removeListId(tt.recommendedCapabilities, capabilityId); // NEW
        }); // NEW
        state.selectedCapabilityId = state.capabilities[0] && state.capabilities[0].id || null; // NEW
        return true; // NEW
    } // NEW

    function renameTaskTypeId(state, oldId, newId) { // NEW
        newId = sanitizeId(newId); // NEW
        if (!newId || newId === oldId) return false; // NEW
        if ((state.taskTypes || []).some(function (tt) { return tt.id === newId; })) { alert("A task type with that ID already exists."); return false; } // NEW
        const refs = describeTaskTypeReferences(state, oldId); // NEW
        if (!confirm(previewReferenceMessage("Rename task type", oldId, refs))) return false; // NEW
        state.taskTypes.forEach(function (tt) { if (tt.id === oldId) tt.id = newId; }); // NEW
        state.inventory.forEach(function (eq) { // NEW
            eq.relevantTaskTypes = replaceListId(eq.relevantTaskTypes, oldId, newId); // NEW
            (eq.efficiencyEffects || []).forEach(function (eff) { if (eff.taskTypeId === oldId) eff.taskTypeId = newId; }); // NEW
        }); // NEW
        state.selectedTaskTypeId = newId; // NEW
        return true; // NEW
    } // NEW

    function deleteTaskTypeId(state, taskTypeId) { // NEW
        const refs = describeTaskTypeReferences(state, taskTypeId); // NEW
        if (!confirm(previewReferenceMessage("Delete task type", taskTypeId, refs))) return false; // NEW
        state.taskTypes = state.taskTypes.filter(function (tt) { return tt.id !== taskTypeId; }); // NEW
        state.inventory.forEach(function (eq) { // NEW
            eq.relevantTaskTypes = removeListId(eq.relevantTaskTypes, taskTypeId); // NEW
            eq.efficiencyEffects = (eq.efficiencyEffects || []).filter(function (eff) { return eff.taskTypeId !== taskTypeId; }); // NEW
        }); // NEW
        state.selectedTaskTypeId = state.taskTypes[0] && state.taskTypes[0].id || null; // NEW
        return true; // NEW
    } // NEW

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
        const capabilityNames = registryNameMap(readCapabilityRegistry(moduleCell)); // NEW
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
                message: `${taskType.name} requires ${lookupName(capabilityNames, m.capabilityId)}, but no available equipment provides it.` // CHANGE
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
                message: `${taskType.name} can use optional equipment for ${lookupName(capabilityNames, m.capabilityId)}: ${m.equipment.map(function (eq) { return eq.name; }).join(", ")}.` // CHANGE
            });
        });

        checks.recommendedMissing.forEach(function (m) {
            warnings.push({
                type: "recommended_equipment_missing",
                severity: "warning",
                taskCell,
                taskTypeId,
                capabilityId: m.capabilityId,
                message: `${taskType.name} would likely improve with ${lookupName(capabilityNames, m.capabilityId)}, but no available equipment provides it.` // CHANGE
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
        const taskSel = selectInput(groupedTaskTypeSelectOptions(taskTypes, "", selectedTaskTypeId), selectedTaskTypeId, function () { // CHANGE
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

    function requestCropOptions(state, render) { // NEW
        const scheduler = typeof window !== "undefined" && window.USL && window.USL.scheduler; // NEW
        if (!scheduler || typeof scheduler.listPlantOptions !== "function") { // NEW
            state.cropOptionsStatus = "failed"; // NEW
            state.cropOptionsError = "Plant catalog is not available."; // NEW
            return; // NEW
        } // NEW
        state.cropOptionsStatus = "loading"; // NEW
        Promise.resolve() // NEW
            .then(function () { return scheduler.listPlantOptions(); }) // NEW
            .then(function (rows) { // NEW
                state.cropOptions = normalizeCropOptions(rows); // NEW
                state.cropOptionsStatus = "loaded"; // NEW
                state.cropOptionsError = ""; // NEW
                render(); // NEW
            }) // NEW
            .catch(function (err) { // NEW
                state.cropOptions = []; // NEW
                state.cropOptionsStatus = "failed"; // NEW
                state.cropOptionsError = err && err.message ? err.message : "Plant catalog failed to load."; // NEW
                render(); // NEW
            }); // NEW
    } // NEW

    function normalizeCropOptions(rows) { // NEW
        return (Array.isArray(rows) ? rows : []).map(function (row) { // NEW
            const id = trim(row && (row.id != null ? row.id : row.plant_id)); // NEW
            const name = trim(row && (row.name || row.plant_name || row.abbr || id)); // NEW
            if (!id || !name) return null; // NEW
            return { id: id, name: name, category: cropLifecycleGroup(row) }; // NEW
        }).filter(Boolean).sort(byName); // NEW
    } // NEW

    function cropLifecycleGroup(row) { // NEW
        if (Number(row && row.perennial) === 1) return "Perennials"; // NEW
        if (Number(row && row.biennial) === 1) return "Biennials"; // NEW
        if (Number(row && row.annual) === 1) return "Annuals"; // NEW
        return "Uncategorized"; // NEW
    } // NEW

    function getBedConditionOptionGroups() { // NEW
        const api = typeof window !== "undefined" && window.TrellisGardenBeds; // NEW
        if (api && typeof api.listConditionOptionGroups === "function") { // NEW
            return normalizeOptionGroups(api.listConditionOptionGroups()); // NEW
        } // NEW
        return clone(FALLBACK_BED_CONDITION_GROUPS); // NEW
    } // NEW

    function sanitizeChecklistBackedSelections(state) { // NEW
        const cropIds = state.cropOptionsStatus === "loaded" ? new Set(state.cropOptions.map(function (item) { return item.id; })) : null; // NEW
        const conditionIds = new Set(flattenOptionGroups(state.bedConditionGroups).map(function (item) { return item.id; })); // NEW
        (state.inventory || []).forEach(function (eq) { // NEW
            if (cropIds) eq.relevantCropIds = (eq.relevantCropIds || []).filter(function (id) { return cropIds.has(id); }); // NEW
            eq.relevantBedConditions = (eq.relevantBedConditions || []).filter(function (id) { return conditionIds.has(id); }); // NEW
        }); // NEW
    } // NEW

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
.trellis-eq-top { padding: 14px 20px; display: grid; grid-template-columns: 320px repeat(6, 1fr); gap: 14px; border-bottom: 1px solid #e6e9e6; background: #fafbfa; } /* CHANGE */
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
.trellis-eq-validation { margin: 12px 18px 0; border: 1px solid #f0d59d; background: #fffaf0; color: #5c3b00; border-radius: 7px; padding: 9px 12px; font-size: 12px; } /* NEW */
.trellis-eq-validation.error { border-color: #f0b4b4; background: #fff8f8; color: #7a1717; } /* NEW */
.trellis-eq-validation-title { font-weight: 650; margin-bottom: 4px; } /* NEW */
.trellis-eq-validation ul { margin: 5px 0 0 18px; padding: 0; } /* NEW */
.trellis-eq-row-editor { border: 1px solid #e0e5e0; border-radius: 7px; overflow: hidden; margin-top: 10px; } /* NEW */
.trellis-eq-row { display: grid; grid-template-columns: repeat(6, minmax(100px, 1fr)) 70px; gap: 8px; align-items: end; padding: 10px; border-bottom: 1px solid #edf0ed; } /* NEW */
.trellis-eq-row:last-child { border-bottom: 0; } /* NEW */
.trellis-eq-row.compact { grid-template-columns: minmax(160px, 1.2fr) minmax(90px, .8fr) 70px; } /* NEW */
.trellis-eq-row label { display: block; font-size: 11px; color: #445044; margin-bottom: 4px; } /* NEW */
.trellis-eq-row input, .trellis-eq-row select, .trellis-eq-row textarea { width: 100%; box-sizing: border-box; border: 1px solid #d5dcd5; border-radius: 6px; padding: 7px 8px; font: inherit; font-size: 12px; } /* NEW */
.trellis-eq-checklist { border: 1px solid #dce2dc; border-radius: 7px; padding: 9px; background: #fff; max-height: 240px; overflow: auto; } /* NEW */
.trellis-eq-checklist-search { width: 100%; box-sizing: border-box; border: 1px solid #d5dcd5; border-radius: 6px; height: 30px; padding: 0 8px; margin-bottom: 8px; } /* NEW */
.trellis-eq-check-group { border-top: 1px solid #edf0ed; padding-top: 7px; margin-top: 7px; } /* NEW */
.trellis-eq-check-group:first-of-type { border-top: 0; padding-top: 0; } /* NEW */
.trellis-eq-check-group-head { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 650; color: #283428; padding: 4px 2px; } /* NEW */
.trellis-eq-check-group-head input { width: auto; } /* NEW */
.trellis-eq-check-group-empty { display: none; color: #778177; font-size: 12px; padding: 5px 2px; } /* NEW */
.trellis-eq-check-option { display: flex; align-items: flex-start; gap: 7px; padding: 5px 2px; font-size: 12px; } /* NEW */
.trellis-eq-check-option input { width: auto; margin-top: 2px; } /* NEW */
.trellis-eq-table-group td { background: #f6f8f6; color: #314031; font-weight: 650; } /* NEW */
.trellis-eq-table-subgroup td { background: #fbfcfb; color: #5f695f; font-size: 12px; font-weight: 650; } /* NEW */
.trellis-eq-id-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; } /* NEW */
.trellis-eq-id-code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: #f3f5f3; border: 1px solid #dbe1db; border-radius: 5px; padding: 6px 8px; } /* NEW */
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
            filter: "", // CHANGE
            capabilityFilter: "", // NEW
            taskTypeFilter: "", // NEW
            cropFilter: "", // NEW
            bedConditionFilter: "", // NEW
            cropOptions: [], // NEW
            cropOptionsStatus: "loading", // NEW
            cropOptionsError: "", // NEW
            bedConditionGroups: getBedConditionOptionGroups(), // NEW
            validationReport: null // NEW
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
            sanitizeChecklistBackedSelections(state); // NEW
            if (!canSaveState(state)) { // NEW
                render(); // NEW
                alert("Fix equipment validation errors before saving."); // NEW
                return false; // NEW
            } // NEW
            writeEquipmentInventory(state.moduleCell, state.inventory);
            writeTaskTypeRegistry(state.moduleCell, state.taskTypes);
            writeCapabilityRegistry(state.moduleCell, state.capabilities);
            state.validationReport = null; // NEW
            return true; // NEW
        }

        function saveAndClose() {
            if (saveAll()) close(); // CHANGE
        }

        function render() {
            overlay.innerHTML = "";
            const dialog = div("trellis-eq-dialog");
            overlay.appendChild(dialog);

            dialog.appendChild(renderHeader(close));
            dialog.appendChild(renderTopSummary(state));
            dialog.appendChild(renderMainTabs(state, render));
            dialog.appendChild(renderValidationPanel(state)); // NEW

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

        requestCropOptions(state, render); // NEW
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
        top.appendChild(summaryTile("$", "$" + summary.annualMaintenanceCost.toFixed(0), "Annual Maintenance", "Estimate", "Estimated yearly recurring maintenance cost from maintenance settings.")); // CHANGE
        top.appendChild(summaryTile("$", "$" + summary.yearlyReplacementReserve.toFixed(0), "Yearly Replacement", "Reserve Estimate", "Estimated yearly reserve to replace owned equipment: replacement cost divided by expected lifespan.")); // NEW
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
            annualMaintenanceCost: state.inventory.reduce(function (sum, eq) { return sum + annualMaintenanceCost(eq); }, 0), // CHANGE
            yearlyReplacementReserve: state.inventory.reduce(function (sum, eq) { return sum + yearlyReplacementReserve(eq); }, 0) // NEW
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

    function yearlyReplacementReserve(eq) { // NEW
        if (!eq || (eq.status !== "owned" && eq.status !== "needs_repair")) return 0; // NEW
        const lifespan = coerceWholeYears(eq.expectedLifespanYears, 0); // NEW
        if (lifespan <= 0) return 0; // NEW
        return Math.max(0, coerceNumber(eq.replacementCost, 0)) / lifespan; // NEW
    } // NEW

    function summaryTile(icon, main, line1, line2, tooltip) { // CHANGE
        const tile = div("trellis-eq-tile");
        const help = tooltip || `${line1} ${line2}`; // NEW
        applyTooltip(tile, help); // CHANGE
        tile.appendChild(textDiv("trellis-eq-tile-icon", icon));
        const text = div("");
        text.appendChild(textDiv("trellis-eq-tile-main", main));
        text.appendChild(textDiv("trellis-eq-tile-sub", line1));
        text.appendChild(textDiv("trellis-eq-tile-sub", line2));
        tile.appendChild(text);
        tile.setAttribute("aria-label", `${main} ${line1} ${line2}. ${help}`); // CHANGE
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
            applyTooltip(t, `Open ${tab[2]} tab.`); // NEW
            t.setAttribute("role", "button"); // NEW
            t.setAttribute("aria-label", `Open ${tab[2]} tab.`); // NEW
            t.onclick = function () {
                state.activeTab = tab[0];
                render();
            };
            tabs.appendChild(t);
        });
        return tabs;
    }

    function renderValidationPanel(state) { // NEW
        const report = state.validationReport; // NEW
        const panel = div("trellis-eq-validation" + (report && report.errors ? " error" : "")); // NEW
        if (!report || (!report.errors && !report.warnings)) { // NEW
            panel.style.display = "none"; // NEW
            return panel; // NEW
        } // NEW
        panel.appendChild(textDiv("trellis-eq-validation-title", `${report.errors} error(s), ${report.warnings} warning(s)`)); // NEW
        const list = document.createElement("ul"); // NEW
        report.items.slice(0, 8).forEach(function (item) { // NEW
            const li = document.createElement("li"); // NEW
            li.textContent = item.message; // NEW
            list.appendChild(li); // NEW
        }); // NEW
        if (report.items.length > 8) { // NEW
            const li = document.createElement("li"); // NEW
            li.textContent = `${report.items.length - 8} more issue(s).`; // NEW
            list.appendChild(li); // NEW
        } // NEW
        panel.appendChild(list); // NEW
        return panel; // NEW
    } // NEW

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
        applyTooltip(search, "Filter equipment by name, category, status, capability, or task type."); // NEW
        search.value = state.filter;
        search.oninput = function () { state.filter = search.value; filterEquipmentRows(search); }; // CHANGE
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
                return [eq.name, eq.category, eq.status, eq.capabilities.map(function (id) { return capabilityDisplayName(state, id); }).join(" "), eq.relevantTaskTypes.map(function (id) { return taskTypeDisplayName(state, id); }).join(" ")] // CHANGE
                    .join(" ").toLowerCase().indexOf(q) >= 0;
            })
            .sort(byName)
            .forEach(function (eq) {
                const tr = document.createElement("tr");
                tr.setAttribute("data-filter-text", [eq.name, eq.category, eq.status, eq.capabilities.map(function (id) { return capabilityDisplayName(state, id); }).join(" "), eq.relevantTaskTypes.map(function (id) { return taskTypeDisplayName(state, id); }).join(" ")].join(" ").toLowerCase()); // CHANGE
                if (eq.id === state.selectedEquipmentId) tr.className = "selected";
                tr.onclick = function () { state.selectedEquipmentId = eq.id; render(); };
                tr.appendChild(td(eq.name));
                tr.appendChild(td(labelize(eq.category)));
                tr.appendChild(tdBadge(eq.status, eq.status === "owned" || eq.status === "borrowed" ? "" : eq.status === "unavailable" || eq.status === "needs_repair" ? "gray" : "warn"));
                tr.appendChild(td(eq.capabilities.slice(0, 3).map(function (id) { return capabilityDisplayName(state, id); }).join(", ") || "—")); // CHANGE
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
        else if (state.activeEquipmentEditorTab === "effects") renderEquipmentEffects(body, selected, state, render); // CHANGE
        else if (state.activeEquipmentEditorTab === "maintenance") renderEquipmentMaintenance(body, selected, render);
        else if (state.activeEquipmentEditorTab === "notes") renderEquipmentNotes(body, selected, render);

        return card;
    }

    function renderEquipmentGeneral(body, eq, render) {
        const grid = div("trellis-eq-form-grid");
        grid.appendChild(field("Name", textInput(eq.name, function (e) { eq.name = e.target.value; }, render))); // CHANGE
        grid.appendChild(field("Primary Category", selectInput(EQUIPMENT_CATEGORIES.map(optPair), eq.category, function (e) { eq.category = e.target.value; render(); }))); // CHANGE
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
        grid.appendChild(field("Capabilities", renderGroupedChecklist(groupedOptions(state.capabilities, eq.capabilities, eq.category), eq.capabilities, state.capabilityFilter, function (value) { state.capabilityFilter = value; }, function (id, checked) { eq.capabilities = updateCheckedList(eq.capabilities, id, checked); render(); }, function (ids, checked) { eq.capabilities = updateCheckedLists(eq.capabilities, ids, checked); render(); }))); // CHANGE
        grid.appendChild(field("Relevant Task Types", renderGroupedChecklist(groupedTaskTypeOptions(state.taskTypes, eq.relevantTaskTypes, eq.category), eq.relevantTaskTypes, state.taskTypeFilter, function (value) { state.taskTypeFilter = value; }, function (id, checked) { eq.relevantTaskTypes = updateCheckedList(eq.relevantTaskTypes, id, checked); render(); }, function (ids, checked) { eq.relevantTaskTypes = updateCheckedLists(eq.relevantTaskTypes, ids, checked); render(); }))); // CHANGE
        grid.appendChild(field("Relevant Crops", renderRelevantCropsControl(eq, state, render))); // CHANGE
        grid.appendChild(field("Relevant Bed Conditions", renderGroupedChecklist(state.bedConditionGroups, eq.relevantBedConditions, state.bedConditionFilter, function (value) { state.bedConditionFilter = value; }, function (id, checked) { eq.relevantBedConditions = updateCheckedList(eq.relevantBedConditions, id, checked); render(); }, function (ids, checked) { eq.relevantBedConditions = updateCheckedLists(eq.relevantBedConditions, ids, checked); render(); }))); // CHANGE
        body.appendChild(grid);

        const hint = div("trellis-eq-small-muted");
        hint.textContent = "Prefer capability IDs over specific equipment names. Example: pruning_hand, bulk_material_hauling, irrigation_timer.";
        body.appendChild(hint);
    }

    function renderEquipmentEffects(body, eq, state, render) { // CHANGE
        const explanation = div("trellis-eq-small-muted");
        explanation.textContent = "Effects reduce or increase task hours. Only hours multipliers are supported in this standalone editor."; // CHANGE
        body.appendChild(explanation);

        const addBtn = buttonEl("Add Effect", "trellis-eq-btn primary", function () { // NEW
            eq.efficiencyEffects.push(normalizeEffect({ // NEW
                taskTypeId: state.taskTypes[0] && state.taskTypes[0].id || "", // NEW
                effectType: "hours_multiplier", // NEW
                multiplier: 1, // NEW
                minimumScale: { value: 0, unit: "tasks" }, // NEW
                maximumScale: null, // NEW
                stackable: false, // NEW
                notes: "" // NEW
            })); // NEW
            render(); // NEW
        }); // NEW
        body.appendChild(addBtn); // NEW

        const editor = div("trellis-eq-row-editor"); // NEW
        if (!eq.efficiencyEffects.length) editor.appendChild(textDiv("trellis-eq-empty", "No efficiency effects defined.")); // NEW
        eq.efficiencyEffects.forEach(function (eff, index) { // NEW
            const row = div("trellis-eq-row"); // NEW
            row.appendChild(rowField("Task Type", selectInput(groupedTaskTypeSelectOptions(state.taskTypes, eq.category, eff.taskTypeId), eff.taskTypeId, function (e) { eff.taskTypeId = e.target.value; render(); }))); // CHANGE
            row.appendChild(rowField("Type", selectInput([["hours_multiplier", "Hours Multiplier"]], eff.effectType, function () { eff.effectType = "hours_multiplier"; }))); // NEW
            row.appendChild(rowField("Multiplier", numberInput(eff.multiplier, function (e) { eff.multiplier = coerceNumber(e.target.value, 1); }))); // NEW
            row.appendChild(rowField("Minimum", numberInput(eff.minimumScale.value, function (e) { eff.minimumScale.value = coerceNumber(e.target.value, 0); }))); // NEW
            row.appendChild(rowField("Unit", selectInput(QUANTITY_BASES.map(optPair), eff.minimumScale.unit, function (e) { eff.minimumScale.unit = e.target.value; render(); }))); // NEW
            row.appendChild(rowField("Stack", checkboxInput(eff.stackable, function (e) { eff.stackable = e.target.checked; }))); // NEW
            row.appendChild(buttonEl("Delete", "trellis-eq-btn danger", function () { eq.efficiencyEffects.splice(index, 1); render(); })); // NEW
            editor.appendChild(row); // NEW

            const notesRow = div("trellis-eq-row compact"); // NEW
            notesRow.appendChild(rowField("Notes", textInput(eff.notes, function (e) { eff.notes = e.target.value; }))); // NEW
            notesRow.appendChild(rowField("Maximum Scale", numberInput(eff.maximumScale ? eff.maximumScale.value : 0, function (e) { setEffectMaximumScale(eff, e.target.value, eff.maximumScale && eff.maximumScale.unit || eff.minimumScale.unit); }))); // NEW
            notesRow.appendChild(rowField("Max Unit", selectInput(QUANTITY_BASES.map(optPair), eff.maximumScale && eff.maximumScale.unit || eff.minimumScale.unit, function (e) { setEffectMaximumScale(eff, eff.maximumScale && eff.maximumScale.value || 0, e.target.value); render(); }))); // NEW
            editor.appendChild(notesRow); // NEW
        }); // NEW
        body.appendChild(editor); // NEW
    }

    function renderEquipmentMaintenance(body, eq, render) {
        const grid = div("trellis-eq-form-grid");
        let replacementDateControl = null; // NEW
        function refreshReplacementDateControl() { // NEW
            if (!replacementDateControl) return; // NEW
            replacementDateControl.value = isIsoDate(eq.replacementDate) ? eq.replacementDate : ""; // NEW
            replacementDateControl.disabled = !eq.replacementDateOverride; // NEW
        } // NEW
        grid.appendChild(field("Purchase Cost ($)", numberInput(eq.purchaseCost, function (e) { eq.purchaseCost = coerceNumber(e.target.value, 0); })));
        grid.appendChild(field("Rental Cost / Day ($)", numberInput(eq.rentalCostPerDay, function (e) { eq.rentalCostPerDay = coerceNumber(e.target.value, 0); })));
        grid.appendChild(field("Replacement Cost ($)", numberInput(eq.replacementCost, function (e) { eq.replacementCost = coerceNumber(e.target.value, 0); })));
        grid.appendChild(field("Expected Lifespan (years)", wholeNumberInput(eq.expectedLifespanYears, function (e) { eq.expectedLifespanYears = coerceWholeYears(e.target.value, 0); syncCalculatedReplacementDate(eq); refreshReplacementDateControl(); }))); // CHANGE
        grid.appendChild(field("Purchase Date", dateInput(eq.purchaseDate, function (e) { eq.purchaseDate = e.target.value; syncCalculatedReplacementDate(eq); refreshReplacementDateControl(); }))); // CHANGE
        grid.appendChild(field("Override Replacement Date", checkboxInput(eq.replacementDateOverride, function (e) { eq.replacementDateOverride = e.target.checked; syncCalculatedReplacementDate(eq); refreshReplacementDateControl(); }))); // NEW
        replacementDateControl = dateInput(eq.replacementDate, function (e) { eq.replacementDate = e.target.value; }, null, !eq.replacementDateOverride); // NEW
        grid.appendChild(field("Replacement Date", replacementDateControl)); // CHANGE
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
            if (deleteTaskTypeId(state, state.selectedTaskTypeId)) render(); // CHANGE
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
        groupedTaskTypesForRegistry(state.taskTypes).forEach(function (group) { // CHANGE
            tbody.appendChild(tableGroupRow(group.name, 4)); // NEW
            appendTaskTypeRegistryRows(tbody, state, render, group.canonical, "Canonical Tasks"); // NEW
            appendTaskTypeRegistryRows(tbody, state, render, group.other, "Other Tasks"); // NEW
        }); // CHANGE
        table.appendChild(tbody);
        wrap.appendChild(table);
        return wrap;
    }

    function appendTaskTypeRegistryRows(tbody, state, render, items, label) { // NEW
        if (!items.length) return; // NEW
        tbody.appendChild(tableSubgroupRow(label, 4)); // NEW
        items.forEach(function (tt) { // NEW
            const tr = document.createElement("tr"); // NEW
            if (tt.id === state.selectedTaskTypeId) tr.className = "selected"; // NEW
            tr.onclick = function () { state.selectedTaskTypeId = tt.id; render(); }; // NEW
            tr.appendChild(td(tt.name)); // NEW
            tr.appendChild(td(labelize(tt.category))); // NEW
            tr.appendChild(td(tt.defaultQuantityBasis)); // NEW
            tr.appendChild(td(tt.requiredCapabilities.map(function (id) { return capabilityDisplayName(state, id); }).join(", ") || "—")); // NEW
            tbody.appendChild(tr); // NEW
        }); // NEW
    } // NEW

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
            grid.appendChild(field("ID", renderIdControl(tt.id, function () { const next = prompt("New task type ID:", tt.id); if (next != null && renameTaskTypeId(state, tt.id, next)) render(); }))); // CHANGE
            grid.appendChild(field("Name", textInput(tt.name, function (e) { tt.name = e.target.value; }, render))); // CHANGE
            grid.appendChild(field("Category", textInput(tt.category, function (e) { tt.category = sanitizeId(e.target.value); })));
            grid.appendChild(field("Default Quantity Basis", selectInput(QUANTITY_BASES.map(optPair), tt.defaultQuantityBasis, function (e) { tt.defaultQuantityBasis = e.target.value; render(); })));
            grid.appendChild(field("Allowed Quantity Bases", renderQuantityBasisChecklist(tt.allowedQuantityBases, function (id, checked) { tt.allowedQuantityBases = updateCheckedList(tt.allowedQuantityBases, id, checked); if (tt.allowedQuantityBases.indexOf(tt.defaultQuantityBasis) < 0) tt.defaultQuantityBasis = tt.allowedQuantityBases[0] || "tasks"; render(); }))); // CHANGE
            grid.appendChild(field("Base Hours Per Unit", renderNumberMapEditor(tt.baseHoursPerUnit, tt.allowedQuantityBases, function (key, value) { tt.baseHoursPerUnit[key] = coerceNumber(value, 0); }, function (key) { delete tt.baseHoursPerUnit[key]; render(); }))); // CHANGE
            body.appendChild(grid);
        } else {
            const grid = div("trellis-eq-form-grid");
            grid.appendChild(field("Required Capabilities", renderGroupedChecklist(groupedOptions(state.capabilities, tt.requiredCapabilities, tt.category), tt.requiredCapabilities, state.capabilityFilter, function (value) { state.capabilityFilter = value; }, function (id, checked) { tt.requiredCapabilities = updateCheckedList(tt.requiredCapabilities, id, checked); render(); }, function (ids, checked) { tt.requiredCapabilities = updateCheckedLists(tt.requiredCapabilities, ids, checked); render(); }))); // CHANGE
            grid.appendChild(field("Optional Capabilities", renderGroupedChecklist(groupedOptions(state.capabilities, tt.optionalCapabilities, tt.category), tt.optionalCapabilities, state.capabilityFilter, function (value) { state.capabilityFilter = value; }, function (id, checked) { tt.optionalCapabilities = updateCheckedList(tt.optionalCapabilities, id, checked); render(); }, function (ids, checked) { tt.optionalCapabilities = updateCheckedLists(tt.optionalCapabilities, ids, checked); render(); }))); // CHANGE
            grid.appendChild(field("Recommended Capabilities", renderGroupedChecklist(groupedOptions(state.capabilities, tt.recommendedCapabilities, tt.category), tt.recommendedCapabilities, state.capabilityFilter, function (value) { state.capabilityFilter = value; }, function (id, checked) { tt.recommendedCapabilities = updateCheckedList(tt.recommendedCapabilities, id, checked); render(); }, function (ids, checked) { tt.recommendedCapabilities = updateCheckedLists(tt.recommendedCapabilities, ids, checked); render(); }))); // CHANGE
            grid.appendChild(field("Complexity Modifiers", renderNumberMapEditor(tt.complexityModifiers, COMPLEXITY_KEYS, function (key, value) { tt.complexityModifiers[key] = coerceNumber(value, 1); }, null))); // CHANGE
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
            if (deleteCapabilityId(state, state.selectedCapabilityId)) render(); // CHANGE
        }));
        listPanel.appendChild(toolbar);
        listPanel.appendChild(renderCapabilitiesTable(state, render));

        const selected = state.capabilities.find(function (c) { return c.id === state.selectedCapabilityId; });
        editorPanel.appendChild(renderCapabilityEditor(state, selected, render)); // CHANGE
        return pane;
    }

    function renderCapabilitiesTable(state, render) {
        const wrap = div("trellis-eq-table-wrap");
        const table = document.createElement("table");
        table.className = "trellis-eq-table";
        table.innerHTML = "<thead><tr><th>Name</th><th>Category</th><th>Description</th></tr></thead>"; // CHANGE
        const tbody = document.createElement("tbody");
        state.capabilities.sort(byName).forEach(function (c) {
            const tr = document.createElement("tr");
            if (c.id === state.selectedCapabilityId) tr.className = "selected";
            tr.onclick = function () { state.selectedCapabilityId = c.id; render(); };
            tr.appendChild(td(c.name));
            tr.appendChild(td(labelize(c.category))); // CHANGE
            tr.appendChild(td(c.description || "—")); // CHANGE
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        wrap.appendChild(table);
        return wrap;
    }

    function renderCapabilityEditor(state, c, render) { // CHANGE
        if (!c) return textDiv("trellis-eq-empty", "No capability selected.");
        const card = div("trellis-eq-card");
        const head = div("trellis-eq-card-head");
        head.appendChild(textNode(`Edit Capability: ${c.name}`));
        card.appendChild(head);
        const body = div("trellis-eq-card-body");
        const grid = div("trellis-eq-form-grid");
        grid.appendChild(field("ID", renderIdControl(c.id, function () { const next = prompt("New capability ID:", c.id); if (next != null && renameCapabilityId(state, c.id, next)) render(); }))); // CHANGE
        grid.appendChild(field("Name", textInput(c.name, function (e) { c.name = e.target.value; }, render))); // CHANGE
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
        note.appendChild(textDiv("trellis-eq-card-head", "How equipment efficiency is applied")); // CHANGE
        const body = div("trellis-eq-card-body");
        body.appendChild(paragraph("Efficiency rules live inside each equipment item and use hours multipliers only. The workload helper chooses the best non-stackable multiplier for a task type, then applies explicitly stackable effects.")); // CHANGE
        body.appendChild(paragraph("Legacy frequency multipliers are converted to hours multipliers during normalization and import so older saved data remains usable.")); // CHANGE
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
                tr.appendChild(td(taskTypeDisplayName(state, eff.taskTypeId) || "—")); // CHANGE
                tr.appendChild(td(labelize(eff.effectType || "hours_multiplier"))); // CHANGE
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
            applyTooltip(item, `Open ${tab[1]} editor section.`); // NEW
            item.setAttribute("role", "button"); // NEW
            item.setAttribute("aria-label", `Open ${tab[1]} editor section.`); // NEW
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
        right.appendChild(buttonEl("Save", "trellis-eq-btn", saveAll, "Save equipment changes to the selected garden module.")); // CHANGE
        right.appendChild(buttonEl("Save & Close", "trellis-eq-btn primary", saveAndClose, "Save changes and close the equipment dialog.")); // CHANGE
        right.appendChild(buttonEl("Cancel", "trellis-eq-btn", close, "Close without saving unsaved changes.")); // CHANGE

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
                    const parsed = JSON.parse(String(reader.result || "{}")); // CHANGE
                    const preview = buildImportPreview(state, parsed); // NEW
                    if (preview.report.errors) { // NEW
                        state.validationReport = preview.report; // NEW
                        render(); // NEW
                        alert("Import blocked by validation errors."); // NEW
                        return; // NEW
                    } // NEW
                    if (!confirm(preview.message)) return; // NEW
                    state.inventory = preview.inventory; // CHANGE
                    state.taskTypes = preview.taskTypes; // CHANGE
                    state.capabilities = preview.capabilities; // CHANGE
                    state.selectedEquipmentId = state.inventory[0] && state.inventory[0].id || null; // CHANGE
                    state.selectedTaskTypeId = state.taskTypes[0] && state.taskTypes[0].id || null; // CHANGE
                    state.selectedCapabilityId = state.capabilities[0] && state.capabilities[0].id || null; // CHANGE
                    state.validationReport = preview.report.warnings ? preview.report : null; // NEW
                    render();
                } catch (err) {
                    alert("Could not import JSON: " + err.message);
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    function mergeImportedById(existing, imported, normalizer) { // NEW
        const byId = new Map(); // NEW
        (existing || []).forEach(function (item) { byId.set(item.id, normalizer(item)); }); // NEW
        (imported || []).forEach(function (item) { const normalized = normalizer(item); byId.set(normalized.id, normalized); }); // NEW
        return Array.from(byId.values()).sort(byName); // NEW
    } // NEW

    function buildImportPreview(state, parsed) { // NEW
        const importedEquipment = Array.isArray(parsed.equipment) ? parsed.equipment.map(normalizeEquipment) : []; // NEW
        const importedTaskTypes = Array.isArray(parsed.taskTypes) ? parsed.taskTypes.map(normalizeTaskType) : []; // NEW
        const importedCapabilities = Array.isArray(parsed.capabilities) ? parsed.capabilities.map(normalizeCapability) : []; // NEW
        const inventory = importedEquipment.length ? mergeImportedById(state.inventory, importedEquipment, normalizeEquipment) : state.inventory.map(normalizeEquipment); // NEW
        const taskTypes = importedTaskTypes.length ? mergeImportedById(state.taskTypes, importedTaskTypes, normalizeTaskType) : state.taskTypes.map(normalizeTaskType); // NEW
        const capabilities = importedCapabilities.length ? mergeImportedById(state.capabilities, importedCapabilities, normalizeCapability) : state.capabilities.map(normalizeCapability); // NEW
        const report = validateEquipmentState(inventory, taskTypes, capabilities); // NEW
        const message = [ // NEW
            "Import and merge these records?", // NEW
            "", // NEW
            `${importedEquipment.length} equipment item(s)`, // NEW
            `${importedTaskTypes.length} task type(s)`, // NEW
            `${importedCapabilities.length} capability record(s)`, // NEW
            "", // NEW
            "Imported records replace existing records with the same ID." // NEW
        ].join("\n"); // NEW
        return { inventory, taskTypes, capabilities, report, message }; // NEW
    } // NEW

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

    function applyTooltip(el, tooltip) { // NEW
        const text = trim(tooltip); // NEW
        if (!el || !text) return el; // NEW
        el.title = text; // NEW
        return el; // NEW
    } // NEW

    function textNode(text) {
        return document.createTextNode(text);
    }

    function paragraph(text) {
        const p = document.createElement("p");
        p.textContent = text;
        return p;
    }

    function buttonEl(text, className, onClick, tooltip) { // CHANGE
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = className || "trellis-eq-btn";
        btn.textContent = text;
        btn.onclick = onClick;
        applyTooltip(btn, tooltip || trim(text)); // NEW
        btn.setAttribute("aria-label", tooltip || trim(text)); // NEW
        return btn;
    }

    function checkboxInput(checked, onChange) { // NEW
        const input = document.createElement("input"); // NEW
        input.type = "checkbox"; // NEW
        input.checked = !!checked; // NEW
        input.onchange = onChange; // NEW
        return input; // NEW
    } // NEW

    function rowField(label, input, tooltip) { // CHANGE
        const wrap = div(""); // NEW
        const lbl = document.createElement("label"); // NEW
        lbl.textContent = label; // NEW
        const help = tooltip || ROW_FIELD_TOOLTIPS[label]; // NEW
        applyTooltip(wrap, help); // NEW
        applyTooltip(lbl, help); // NEW
        applyTooltip(input, help); // NEW
        wrap.appendChild(lbl); // NEW
        wrap.appendChild(input); // NEW
        return wrap; // NEW
    } // NEW

    function registryNameMap(items) { // NEW
        const out = Object.create(null); // NEW
        (items || []).forEach(function (item) { if (item && item.id) out[item.id] = item.name || item.id; }); // NEW
        return out; // NEW
    } // NEW

    function lookupName(map, id) { // NEW
        return map && map[id] ? map[id] : id; // NEW
    } // NEW

    function capabilityDisplayName(state, id) { // NEW
        const item = (state.capabilities || []).find(function (capability) { return capability.id === id; }); // NEW
        return item ? item.name : id; // NEW
    } // NEW

    function taskTypeDisplayName(state, id) { // NEW
        const item = (state.taskTypes || []).find(function (taskTypeRecord) { return taskTypeRecord.id === id; }); // NEW
        return item ? item.name : id; // NEW
    } // NEW

    function normalizeOptionGroups(groups) { // NEW
        return (groups || []).map(function (group) { // NEW
            if (group && Array.isArray(group.options)) { // NEW
                return { id: group.id || group.name || "other", name: group.name || labelize(group.id || "other"), options: (group.options || []).map(normalizeOptionItem).filter(Boolean).sort(byName) }; // NEW
            } // NEW
            return null; // NEW
        }).filter(function (group) { return group && group.options.length; }); // NEW
    } // NEW

    function normalizeOptionItem(item) { // NEW
        if (!item) return null; // NEW
        const id = trim(item.id); // NEW
        if (!id) return null; // NEW
        return Object.assign({}, item, { id: id, name: trim(item.name) || id, category: trim(item.category) || "general" }); // NEW
    } // NEW

    function flattenOptionGroups(groups) { // NEW
        const out = []; // NEW
        normalizeOptionGroups(groups).forEach(function (group) { out.push.apply(out, group.options); }); // NEW
        return out; // NEW
    } // NEW

    function groupedOptions(options, selectedIds, primaryCategory) { // NEW
        const selected = new Set(selectedIds || []); // NEW
        const byCategory = new Map(); // NEW
        (options || []).map(normalizeOptionItem).filter(Boolean).forEach(function (item) { // NEW
            const category = trim(item.category) || "general"; // NEW
            if (!byCategory.has(category)) byCategory.set(category, []); // NEW
            byCategory.get(category).push(item); // NEW
        }); // NEW
        return orderCategoryKeys(Array.from(byCategory.keys()), primaryCategory, selectedCategories(byCategory, selected)).map(function (category) { // NEW
            return { id: category, name: groupLabel(category), options: byCategory.get(category).sort(byName) }; // NEW
        }); // NEW
    } // NEW

    function groupedTaskTypeOptions(taskTypes, selectedIds, primaryCategory) { // NEW
        const groups = groupedOptions(taskTypes, selectedIds, primaryCategory); // NEW
        groups.forEach(function (group) { group.options = sortTaskTypeOptions(group.options); }); // NEW
        return groups; // NEW
    } // NEW

    function groupedTaskTypeSelectOptions(taskTypes, primaryCategory, selectedId) { // NEW
        return groupedTaskTypeOptions(taskTypes, selectedId ? [selectedId] : [], primaryCategory); // NEW
    } // NEW

    function sortTaskTypeOptions(items) { // NEW
        return (items || []).slice().sort(function (a, b) { // NEW
            const aCanonical = CANONICAL_TASK_TYPE_IDS.has(a.id) ? 0 : 1; // NEW
            const bCanonical = CANONICAL_TASK_TYPE_IDS.has(b.id) ? 0 : 1; // NEW
            if (aCanonical !== bCanonical) return aCanonical - bCanonical; // NEW
            return byName(a, b); // NEW
        }); // NEW
    } // NEW

    function selectedCategories(byCategory, selected) { // NEW
        const out = []; // NEW
        byCategory.forEach(function (items, category) { // NEW
            if (items.some(function (item) { return selected.has(item.id); })) out.push(category); // NEW
        }); // NEW
        return out; // NEW
    } // NEW

    function orderCategoryKeys(keys, primaryCategory, selectedCategoryKeys) { // NEW
        const present = new Set(keys || []); // NEW
        const out = []; // NEW
        function add(category) { if (category && present.has(category) && out.indexOf(category) < 0) out.push(category); } // NEW
        add(trim(primaryCategory)); // NEW
        add("general"); // NEW
        (selectedCategoryKeys || []).sort(categoryCompare).forEach(add); // NEW
        keys.slice().sort(categoryCompare).forEach(add); // NEW
        return out; // NEW
    } // NEW

    function categoryCompare(a, b) { // NEW
        return groupLabel(a).localeCompare(groupLabel(b)); // NEW
    } // NEW

    function groupLabel(category) { // NEW
        const value = trim(category) || "general"; // NEW
        return /[\s]/.test(value) ? value : labelize(value); // NEW
    } // NEW

    function groupedTaskTypesForRegistry(taskTypes) { // NEW
        const byCategory = new Map(); // NEW
        (taskTypes || []).forEach(function (tt) { // NEW
            const category = trim(tt.category) || "general"; // NEW
            if (!byCategory.has(category)) byCategory.set(category, { id: category, name: groupLabel(category), canonical: [], other: [] }); // NEW
            byCategory.get(category)[CANONICAL_TASK_TYPE_IDS.has(tt.id) ? "canonical" : "other"].push(tt); // NEW
        }); // NEW
        return Array.from(byCategory.values()).sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (group) { // NEW
            group.canonical.sort(byName); // NEW
            group.other.sort(byName); // NEW
            return group; // NEW
        }); // NEW
    } // NEW

    function renderRelevantCropsControl(eq, state, render) { // NEW
        if (state.cropOptionsStatus === "loading") return textDiv("trellis-eq-empty", "Loading crop catalog..."); // NEW
        if (state.cropOptionsStatus !== "loaded") { // NEW
            const wrap = div(""); // NEW
            wrap.appendChild(textDiv("trellis-eq-small-muted", state.cropOptionsError || "Crop catalog is unavailable; edit stored crop IDs directly.")); // NEW
            wrap.appendChild(textareaInput(eq.relevantCropIds.join(", "), function (e) { eq.relevantCropIds = splitCsv(e.target.value); }, false)); // NEW
            return wrap; // NEW
        } // NEW
        return renderGroupedChecklist(groupedOptions(state.cropOptions, eq.relevantCropIds, ""), eq.relevantCropIds, state.cropFilter, function (value) { state.cropFilter = value; }, function (id, checked) { eq.relevantCropIds = updateCheckedList(eq.relevantCropIds, id, checked); render(); }, function (ids, checked) { eq.relevantCropIds = updateCheckedLists(eq.relevantCropIds, ids, checked); render(); }); // NEW
    } // NEW

    function renderChecklist(options, selectedIds, filterValue, onFilter, onToggle) { // NEW
        return renderGroupedChecklist(groupedOptions(options, selectedIds, ""), selectedIds, filterValue, onFilter, onToggle, function (ids, checked) { // CHANGE
            ids.forEach(function (id) { onToggle(id, checked); }); // CHANGE
        }); // NEW
    } // NEW

    function renderGroupedChecklist(groups, selectedIds, filterValue, onFilter, onToggle, onToggleGroup) { // NEW
        const wrap = div("trellis-eq-checklist"); // NEW
        const search = document.createElement("input"); // NEW
        search.className = "trellis-eq-checklist-search"; // NEW
        search.placeholder = "Search..."; // NEW
        applyTooltip(search, "Search visible options by display name."); // NEW
        search.value = filterValue || ""; // NEW
        search.oninput = function () { onFilter(search.value); filterChecklistOptions(wrap, search.value); }; // CHANGE
        wrap.appendChild(search); // NEW
        const selected = new Set(selectedIds || []); // NEW
        normalizeOptionGroups(groups).forEach(function (group) { // NEW
            const groupEl = div("trellis-eq-check-group"); // NEW
            groupEl.setAttribute("data-group-name", String(group.name || group.id || "")); // NEW
            const ids = group.options.map(function (item) { return item.id; }); // NEW
            const checkedCount = ids.filter(function (id) { return selected.has(id); }).length; // NEW
            const head = document.createElement("label"); // NEW
            head.className = "trellis-eq-check-group-head"; // NEW
            const groupInput = checkboxInput(ids.length > 0 && checkedCount === ids.length, function (e) { onToggleGroup(ids, e.target.checked); }); // NEW
            groupInput.indeterminate = checkedCount > 0 && checkedCount < ids.length; // NEW
            applyTooltip(groupInput, `Select or clear all ${group.name || group.id || "group"} options.`); // NEW
            groupInput.setAttribute("aria-label", `Select or clear all ${group.name || group.id || "group"} options.`); // NEW
            const groupText = document.createElement("span"); // NEW
            groupText.textContent = group.name || group.id || "Other"; // NEW
            head.appendChild(groupInput); // NEW
            head.appendChild(groupText); // NEW
            groupEl.appendChild(head); // NEW
            group.options.forEach(function (item) { // NEW
                const label = document.createElement("label"); // NEW
                label.className = "trellis-eq-check-option"; // NEW
                label.setAttribute("data-filter-text", String(item.name || "").toLowerCase()); // CHANGE
                const input = checkboxInput(selected.has(item.id), function (e) { onToggle(item.id, e.target.checked); }); // NEW
                const text = document.createElement("span"); // NEW
                text.textContent = item.name || item.id; // CHANGE
                label.appendChild(input); // NEW
                label.appendChild(text); // NEW
                groupEl.appendChild(label); // NEW
            }); // NEW
            groupEl.appendChild(textDiv("trellis-eq-check-group-empty", "No matches")); // NEW
            wrap.appendChild(groupEl); // NEW
        }); // NEW
        filterChecklistOptions(wrap, filterValue); // NEW
        return wrap; // NEW
    } // NEW

    function renderQuantityBasisChecklist(selectedIds, onToggle) { // NEW
        const options = QUANTITY_BASES.map(function (id) { return { id, name: labelize(id), category: "quantity" }; }); // NEW
        return renderChecklist(options, selectedIds, "", function () {}, onToggle); // NEW
    } // NEW

    function renderNumberMapEditor(map, orderedKeys, onValue, onDelete) { // NEW
        const editor = div("trellis-eq-row-editor"); // NEW
        const requiredKeys = new Set(orderedKeys || []); // NEW
        const keys = uniqueStrings((orderedKeys || []).concat(Object.keys(map || {}))); // NEW
        if (!keys.length) editor.appendChild(textDiv("trellis-eq-empty", "No rows available.")); // NEW
        keys.forEach(function (key) { // NEW
            if (map[key] == null) map[key] = 0; // NEW
            const row = div("trellis-eq-row compact"); // NEW
            row.appendChild(rowField("Key", textDiv("trellis-eq-id-code", key))); // NEW
            row.appendChild(rowField("Value", numberInput(map[key], function (e) { onValue(key, e.target.value); }))); // NEW
            row.appendChild(onDelete && !requiredKeys.has(key) ? buttonEl("Delete", "trellis-eq-btn danger", function () { onDelete(key); }) : textDiv("", "")); // CHANGE
            editor.appendChild(row); // NEW
        }); // NEW
        return editor; // NEW
    } // NEW

    function renderIdControl(id, onRename) { // NEW
        const wrap = div("trellis-eq-id-row"); // NEW
        wrap.appendChild(applyTooltip(textDiv("trellis-eq-id-code", id), "Stable internal ID used by saved links and cross-plugin references.")); // CHANGE
        wrap.appendChild(buttonEl("Rename", "trellis-eq-btn", onRename, "Rename this internal ID and update dependent references.")); // CHANGE
        return wrap; // NEW
    } // NEW

    function updateCheckedList(list, id, checked) { // NEW
        const set = new Set(list || []); // NEW
        if (checked) set.add(id); // NEW
        else set.delete(id); // NEW
        return Array.from(set).sort(); // NEW
    } // NEW

    function updateCheckedLists(list, ids, checked) { // NEW
        const set = new Set(list || []); // NEW
        (ids || []).forEach(function (id) { // NEW
            if (checked) set.add(id); // NEW
            else set.delete(id); // NEW
        }); // NEW
        return Array.from(set).sort(); // NEW
    } // NEW

    function filterChecklistOptions(container, value) { // NEW
        const q = trim(value).toLowerCase(); // NEW
        Array.from(container.querySelectorAll(".trellis-eq-check-option")).forEach(function (option) { // NEW
            const text = option.getAttribute("data-filter-text") || ""; // NEW
            option.style.display = !q || text.indexOf(q) >= 0 ? "" : "none"; // NEW
        }); // NEW
        Array.from(container.querySelectorAll(".trellis-eq-check-group")).forEach(function (group) { // NEW
            const visible = Array.from(group.querySelectorAll(".trellis-eq-check-option")).some(function (option) { return option.style.display !== "none"; }); // NEW
            group.style.display = visible ? "" : "none"; // NEW
        }); // NEW
    } // NEW

    function filterEquipmentRows(searchInput) { // NEW
        const q = trim(searchInput && searchInput.value).toLowerCase(); // NEW
        const panel = searchInput && searchInput.closest(".trellis-eq-list-panel"); // NEW
        Array.from(panel ? panel.querySelectorAll("tbody tr") : []).forEach(function (row) { // NEW
            const text = row.getAttribute("data-filter-text") || ""; // NEW
            row.style.display = !q || text.indexOf(q) >= 0 ? "" : "none"; // NEW
        }); // NEW
    } // NEW

    function setEffectMaximumScale(effectRecord, value, unit) { // NEW
        const numeric = coerceNumber(value, 0); // NEW
        effectRecord.maximumScale = numeric > 0 ? { value: numeric, unit: unit || "tasks" } : null; // NEW
    } // NEW

    function td(text) {
        const cell = document.createElement("td");
        cell.textContent = text;
        return cell;
    }

    function tableGroupRow(label, colspan) { // NEW
        const tr = document.createElement("tr"); // NEW
        tr.className = "trellis-eq-table-group"; // NEW
        const cell = td(label); // NEW
        cell.colSpan = colspan; // NEW
        tr.appendChild(cell); // NEW
        return tr; // NEW
    } // NEW

    function tableSubgroupRow(label, colspan) { // NEW
        const tr = document.createElement("tr"); // NEW
        tr.className = "trellis-eq-table-subgroup"; // NEW
        const cell = td(label); // NEW
        cell.colSpan = colspan; // NEW
        tr.appendChild(cell); // NEW
        return tr; // NEW
    } // NEW

    function tdBadge(text, kind) {
        const cell = document.createElement("td");
        const badge = document.createElement("span");
        badge.className = "trellis-eq-badge " + (kind || "");
        badge.textContent = labelize(text);
        cell.appendChild(badge);
        return cell;
    }

    function field(label, input, tooltip) { // CHANGE
        const wrap = div("trellis-eq-field");
        const lbl = document.createElement("label");
        lbl.textContent = label;
        const help = tooltip || FIELD_TOOLTIPS[label]; // NEW
        applyTooltip(wrap, help); // NEW
        applyTooltip(lbl, help); // NEW
        applyTooltip(input, help); // NEW
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

    function textInput(value, onInput, onBlur) { // CHANGE
        const input = document.createElement("input");
        input.type = "text";
        input.value = value == null ? "" : String(value);
        input.oninput = onInput;
        if (onBlur) input.onblur = onBlur; // NEW
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

    function wholeNumberInput(value, onInput) { // NEW
        const input = numberInput(value, onInput); // NEW
        input.step = "1"; // NEW
        input.min = "0"; // NEW
        return input; // NEW
    } // NEW

    function dateInput(value, onInput, onBlur, disabled) { // NEW
        const input = document.createElement("input"); // NEW
        input.type = "date"; // NEW
        input.value = isIsoDate(value) ? value : ""; // NEW
        input.oninput = onInput; // NEW
        if (onBlur) input.onblur = onBlur; // NEW
        input.disabled = !!disabled; // NEW
        return input; // NEW
    } // NEW

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
            if (pair && Array.isArray(pair.options)) { // NEW
                const group = document.createElement("optgroup"); // NEW
                group.label = pair.name || pair.label || pair.id || "Other"; // NEW
                pair.options.forEach(function (item) { appendSelectOption(group, item, selectedValue); }); // NEW
                select.appendChild(group); // NEW
            } else { // NEW
                appendSelectOption(select, pair, selectedValue); // CHANGE
            } // NEW
        });
        select.onchange = onChange;
        return select;
    }

    function appendSelectOption(parent, pair, selectedValue) { // NEW
        const option = document.createElement("option"); // NEW
        const value = Array.isArray(pair) ? pair[0] : pair && pair.id; // NEW
        const label = Array.isArray(pair) ? pair[1] : pair && pair.name; // NEW
        option.value = value; // NEW
        option.textContent = label || value; // NEW
        if (value === selectedValue) option.selected = true; // NEW
        parent.appendChild(option); // NEW
    } // NEW

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
        __test: { // NEW
            normalizeEquipment: normalizeEquipment, // NEW
            normalizeTaskType: normalizeTaskType, // NEW
            normalizeCapability: normalizeCapability, // NEW
            normalizeEffect: normalizeEffect, // NEW
            validateEquipmentState: validateEquipmentState, // NEW
            buildImportPreview: buildImportPreview, // NEW
            renameCapabilityId: renameCapabilityId, // NEW
            renameTaskTypeId: renameTaskTypeId, // NEW
            deleteCapabilityId: deleteCapabilityId, // NEW
            deleteTaskTypeId: deleteTaskTypeId, // CHANGE
            calculateReplacementDate: calculateReplacementDate, // NEW
            isIsoDate: isIsoDate, // CHANGE
            yearlyReplacementReserve: yearlyReplacementReserve // NEW
        }, // NEW
        defaults: {
            equipment: clone(DEFAULT_EQUIPMENT),
            taskTypes: clone(DEFAULT_TASK_TYPES),
            capabilities: clone(DEFAULT_CAPABILITIES)
        }
    };

    addActionAndMenus();
    fireTrellisEvent("trellisEquipmentPluginReady", { graph, api: graph.__trellisEquipment });
});
