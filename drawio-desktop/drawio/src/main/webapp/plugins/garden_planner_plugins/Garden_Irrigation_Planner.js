/**
 * Draw.io Plugin: Garden Irrigation Planner
 *
 * Market-garden irrigation design support:
 * - Module-scoped irrigation parts catalog.
 * - Explicit source, bed, and branchpoint endpoints.
 * - Diagram-native HUD irrigation mode.
 * - Compatibility-filtered graph connections.
 * - Bed-template commits and dashboard-ready report summaries.
 */
Draw.loadPlugin(function (ui) {
    const graph = ui && ui.editor && ui.editor.graph;
    if (!graph || graph.__trellisIrrigationPlannerInstalled) return;
    graph.__trellisIrrigationPlannerInstalled = true;

    const model = graph.getModel && graph.getModel();
    if (!model) return;

    const PLUGIN_VERSION = 3; // CHANGE
    const ACTION_ID = "trellisIrrigationPlanner";
    const CREATE_SOURCE_ACTION_ID = "trellisIrrigationCreateSourceEndpoint";
    const CREATE_BED_ACTION_ID = "trellisIrrigationCreateBedEndpoint";
    const CREATE_BRANCH_ACTION_ID = "trellisIrrigationCreateBranchpointEndpoint";
    const PX_PER_CM = 5;
    const DRAW_SCALE = 0.18;
    const CM_PER_FOOT = 30.48;
    const HUD_SYNC_DEBOUNCE_MS = 200; // NEW

    const ATTRS = {
        CATALOG_JSON: "irrigation_catalog_json",
        PATHS_JSON: "irrigation_paths_json",
        ZONES_JSON: "irrigation_zones_json", // NEW
        REPORT_JSON: "irrigation_report_json",
        DASHBOARD_JSON: "irrigation_dashboard_summary_json",
        ENDPOINT: "irrigation_endpoint",
        ENDPOINT_TYPE: "irrigation_endpoint_type",
        ENDPOINT_PROFILE_JSON: "irrigation_endpoint_profile_json",
        COMPONENT: "irrigation_component",
        COMPONENT_TYPE: "irrigation_component_type",
        CATALOG_PART_ID: "irrigation_catalog_part_id",
        PATH_ID: "irrigation_path_id",
        GENERATED: "irrigation_generated",
        PIPE_EDGE: "irrigation_pipe_edge",
        DIRECT_LINK_EDGE: "irrigation_direct_link_edge", // NEW
        PIPE_PART_ID: "irrigation_pipe_part_id",
        ASSEMBLY: "irrigation_assembly", // NEW
        ASSEMBLY_TYPE: "irrigation_assembly_type", // NEW
        ASSEMBLY_EXPANDED: "irrigation_assembly_expanded", // NEW
        LINKED_BED_ID: "irrigation_linked_bed_id", // NEW
        BED_PORTS_JSON: "irrigation_bed_ports_json", // NEW
        EDGE_SOURCE_PORT: "irrigation_edge_source_port", // NEW
        EDGE_TARGET_PORT: "irrigation_edge_target_port", // NEW
        BED_TEMPLATE_JSON: "irrigation_bed_template_json",
        BED_LAYOUT: "irrigation_bed_layout"
    };

    const STOCK_AVAILABLE = new Set(["in_stock", "low_stock"]);
    const PURCHASE_NEEDED = new Set(["out_of_stock", "unknown"]);
    const BRANCH_CATEGORIES = new Set(["valve", "manifold", "controller_timer"]);
    const BRANCH_SINGLETON_CATEGORIES = new Set(["backflow", "filter", "regulator", "controller_timer"]); // NEW
    const ZONE_ORIGIN_TIMER_OUTLET = "timer_outlet"; // NEW
    const ZONE_ORIGIN_MANUAL = "manual"; // NEW
    const VALID_STOCK_STATES = ["in_stock", "low_stock", "out_of_stock", "unknown"];
    const ASSEMBLY_PART_WIDTH = 150; // NEW
    const ASSEMBLY_PART_HEIGHT = 34; // NEW
    const ASSEMBLY_PART_GAP = 16; // NEW
    const ASSEMBLY_HEADER_SIZE = 28; // NEW
    const ASSEMBLY_DEFAULT_WIDTH = 210; // NEW
    const ASSEMBLY_CONTRACTED_BED = { width: 220, height: 120 }; // NEW
    const PORT_BADGE_SIZE = 22; // NEW
    const FIXED_CONNECTOR_TYPES = ["mght", "fght", "mpt", "fpt", "barb", "twist_lock", "push_connect"]; // CHANGE
    const FIXED_CONNECTOR_SIZES = ["1/4", "1/2", "3/4", "1"]; // NEW
    const PART_CATEGORIES = [
        "source_adapter",
        "pump",
        "backflow",
        "filter",
        "regulator",
        "controller_timer",
        "valve",
        "manifold",
        "fitting",
        "pipe_tubing",
        "drip_tape",
        "dripline",
        "emitter",
        "sprinkler",
        "microspray",
        "bubbler",
        "standpipe",
        "cap_end"
    ];
    const BROAD_CATALOG_CATEGORIES = [ // NEW
        { id: "source_supply", label: "Source & supply", categories: ["source_adapter", "pump"] }, // NEW
        { id: "control_protection", label: "Control & protection", categories: ["backflow", "filter", "regulator", "controller_timer", "valve"] }, // NEW
        { id: "distribution", label: "Distribution", categories: ["manifold", "fitting", "pipe_tubing", "standpipe"] }, // NEW
        { id: "application", label: "Water application", categories: ["drip_tape", "dripline", "emitter", "sprinkler", "microspray", "bubbler"] }, // NEW
        { id: "termination", label: "Termination", categories: ["cap_end"] } // NEW
    ]; // NEW

    const BED_TEMPLATES = [
        { id: "drip_tape_bed", label: "Drip tape bed", defaultRows: 2, lineKind: "drip_tape", flowGpm: 1.2, pressurePsi: 10 },
        { id: "dripline_bed", label: "Dripline bed", defaultRows: 2, lineKind: "dripline", flowGpm: 1.0, pressurePsi: 12 },
        { id: "overhead_sprinkler_block", label: "Overhead sprinkler block", defaultRows: 3, lineKind: "sprinkler", flowGpm: 2.5, pressurePsi: 30 },
        { id: "nursery_microspray", label: "Nursery/propagation microspray", defaultRows: 3, lineKind: "microspray", flowGpm: 1.5, pressurePsi: 20 },
        { id: "soaker_row", label: "Soaker row", defaultRows: 2, lineKind: "dripline", flowGpm: 0.8, pressurePsi: 10 },
        { id: "perennial_bubbler_row", label: "Orchard/perennial bubbler row", defaultRows: 1, lineKind: "bubbler", flowGpm: 1.0, pressurePsi: 15 },
        { id: "manual_hose_standpipe", label: "Manual hose standpipe", defaultRows: 1, lineKind: "standpipe", flowGpm: 2.0, pressurePsi: 20 }
    ];

    const GENERATED_CONNECTOR_CATALOG_ITEMS = generateLabelOnlyConnectorParts(); // NEW

    const CATALOG_UPGRADE_PART_IDS = new Set([ // CHANGE
        "poly_mainline_1", // NEW
        "barb_tee_1", // NEW
        "barb_elbow_1", // NEW
        "barb_coupler_1", // NEW
        "end_cap_1_barb", // NEW
        "reducer_1_to_3_4_barb", // NEW
        "adapter_3_4_to_1_barb", // NEW
        "micro_tubing_1_4", // NEW
        "micro_tee_1_4", // NEW
        "micro_elbow_1_4", // NEW
        "micro_coupler_1_4", // NEW
        "micro_goof_plug_1_4", // NEW
        "transfer_barb_1_2_to_1_4", // NEW
        "adapter_1_4_to_1_2_barb", // NEW
        "micro_emitter_0_5_gph", // NEW
        "micro_emitter_1_0_gph", // NEW
        "micro_emitter_2_0_gph", // NEW
        "micro_spray_stake_1_4" // CHANGE
    ].concat(GENERATED_CONNECTOR_CATALOG_ITEMS.map(function (part) { return part.id; }))); // CHANGE

    const STARTER_CATALOG_ITEMS = [
        starterPart("hose_vacuum_breaker", "3/4 in FGHT x MGHT hose vacuum breaker", "backflow", 12, 1, 1, input("fght", "3/4"), output("mght", "3/4"), { pressureLossPsi: 1.0 }), // CHANGE
        starterPart("hose_timer_single_zone", "3/4 in FGHT x MGHT hose timer", "controller_timer", 38, 1, 1, input("fght", "3/4"), output("mght", "3/4", "", 5), { pressureLossPsi: 1.5, maxFlowGpm: 5 }), // CHANGE
        starterPart("hose_splitter_2way_3_4_fght_mght", "2-way hose splitter, 3/4 in FGHT x 3/4 in MGHT", "manifold", 16, 1, 2, input("fght", "3/4"), output("mght", "3/4", "", 8), { pressureLossPsi: 1.0, maxFlowGpm: 8 }), // NEW
        starterPart("hose_splitter_4way_3_4_fght_mght", "4-way hose manifold, 3/4 in FGHT x 3/4 in MGHT", "manifold", 28, 1, 4, input("fght", "3/4"), output("mght", "3/4", "", 8), { pressureLossPsi: 1.4, maxFlowGpm: 8 }), // NEW
        starterPart("fght_to_3_4_mpt_adapter", "3/4 in FGHT to 3/4 in MPT adapter", "source_adapter", 5, 1, 1, input("fght", "3/4"), output("mpt", "3/4"), { pressureLossPsi: 0.2 }), // CHANGE
        starterPart("mght_to_3_4_fpt_adapter", "3/4 in MGHT to 3/4 in FPT adapter", "source_adapter", 5, 1, 1, input("mght", "3/4"), output("fpt", "3/4"), { pressureLossPsi: 0.2 }), // NEW
        starterPart("fght_to_3_4_barb_adapter", "3/4 in FGHT to 3/4 in barb adapter", "fitting", 5, 1, 1, input("fght", "3/4"), output("barb", "3/4"), { pressureLossPsi: 0.2 }), // NEW
        starterPart("mght_to_3_4_barb_adapter", "3/4 in MGHT to 3/4 in barb adapter", "fitting", 5, 1, 1, input("mght", "3/4"), output("barb", "3/4"), { pressureLossPsi: 0.2 }), // NEW
        starterPart("filter_150_mesh_3_4_fpt", "150 mesh filter, 3/4 in FPT", "filter", 32, 1, 1, input("fpt", "3/4"), output("fpt", "3/4"), { pressureLossPsi: 2.0 }), // CHANGE
        starterPart("drip_regulator_25psi_3_4_fpt", "25 psi drip pressure regulator, 3/4 in FPT", "regulator", 18, 1, 1, input("fpt", "3/4"), output("fpt", "3/4"), { pressureLossPsi: 1.0, operatingPressurePsi: 25 }),
        starterPart("spray_regulator_30psi_3_4_fpt", "30 psi spray pressure regulator, 3/4 in FPT", "regulator", 20, 1, 1, input("fpt", "3/4"), output("fpt", "3/4"), { pressureLossPsi: 1.0, operatingPressurePsi: 30 }),
        starterPart("mpt_nipple_3_4", "3/4 in MPT close nipple", "fitting", 3, 1, 1, input("mpt", "3/4"), output("mpt", "3/4"), { pressureLossPsi: 0.1 }), // NEW
        starterPart("fpt_coupler_3_4", "3/4 in FPT coupler", "fitting", 3, 1, 1, input("fpt", "3/4"), output("fpt", "3/4"), { pressureLossPsi: 0.1 }), // NEW
        starterPart("mpt_to_3_4_barb_adapter", "3/4 in MPT to 3/4 in barb adapter", "fitting", 4, 1, 1, input("mpt", "3/4"), output("barb", "3/4"), { pressureLossPsi: 0.2 }),
        starterPart("fpt_to_3_4_barb_adapter", "3/4 in FPT to 3/4 in barb adapter", "fitting", 4, 1, 1, input("fpt", "3/4"), output("barb", "3/4"), { pressureLossPsi: 0.2 }),
        starterPart("valve_3_4_barb", "3/4 in barb irrigation valve", "valve", 26, 1, 1, input("barb", "3/4"), output("barb", "3/4", "", 8), { pressureLossPsi: 1.0, maxFlowGpm: 8 }),
        starterPart("manifold_4out_3_4_barb", "4-output 3/4 in barb manifold", "manifold", 35, 1, 4, input("barb", "3/4"), output("barb", "3/4", "", 8), { pressureLossPsi: 1.2, maxFlowGpm: 8 }),
        starterPart("barb_tee_3_4", "3/4 in barb tee", "fitting", 3.5, 1, 2, input("barb", "3/4"), output("barb", "3/4"), { pressureLossPsi: 0.2 }),
        starterPart("barb_elbow_3_4", "3/4 in barb elbow", "fitting", 2.5, 1, 1, input("barb", "3/4"), output("barb", "3/4"), { pressureLossPsi: 0.2 }),
        starterPart("barb_coupler_3_4", "3/4 in barb coupler", "fitting", 2.25, 1, 1, input("barb", "3/4"), output("barb", "3/4"), { pressureLossPsi: 0.1 }),
        starterPart("reducer_3_4_to_1_2_barb", "3/4 in barb to 1/2 in barb reducer", "fitting", 3, 1, 1, input("barb", "3/4"), output("barb", "1/2"), { pressureLossPsi: 0.3 }),
        starterPart("barb_tee_1_2", "1/2 in barb tee", "fitting", 2, 1, 2, input("barb", "1/2"), output("barb", "1/2"), { pressureLossPsi: 0.2 }),
        starterPart("barb_coupler_1_2", "1/2 in barb coupler", "fitting", 1.5, 1, 1, input("barb", "1/2"), output("barb", "1/2"), { pressureLossPsi: 0.1 }),
        starterPart("end_cap_1_2_barb", "1/2 in barb end cap", "cap_end", 1.25, 1, 0, input("barb", "1/2"), output("", ""), { pressureLossPsi: 0 }),
        starterPart("barb_tee_1", "1 in barb tee", "fitting", 5.5, 1, 2, input("barb", "1"), output("barb", "1"), { pressureLossPsi: 0.2 }), // NEW
        starterPart("barb_elbow_1", "1 in barb elbow", "fitting", 4.25, 1, 1, input("barb", "1"), output("barb", "1"), { pressureLossPsi: 0.2 }), // NEW
        starterPart("barb_coupler_1", "1 in barb coupler", "fitting", 3.75, 1, 1, input("barb", "1"), output("barb", "1"), { pressureLossPsi: 0.1 }), // NEW
        starterPart("end_cap_1_barb", "1 in barb end cap", "cap_end", 2.5, 1, 0, input("barb", "1"), output("", ""), { pressureLossPsi: 0 }), // NEW
        starterPart("reducer_1_to_3_4_barb", "1 in barb to 3/4 in barb reducer", "fitting", 4.25, 1, 1, input("barb", "1"), output("barb", "3/4"), { pressureLossPsi: 0.3 }), // NEW
        starterPart("adapter_3_4_to_1_barb", "3/4 in barb to 1 in barb adapter", "fitting", 4.25, 1, 1, input("barb", "3/4"), output("barb", "1"), { pressureLossPsi: 0.3 }), // NEW
        starterPart("micro_tee_1_4", "1/4 in micro tubing tee", "fitting", 0.75, 1, 2, input("barb", "1/4"), output("barb", "1/4"), { pressureLossPsi: 0.1 }), // NEW
        starterPart("micro_elbow_1_4", "1/4 in micro tubing elbow", "fitting", 0.65, 1, 1, input("barb", "1/4"), output("barb", "1/4"), { pressureLossPsi: 0.1 }), // NEW
        starterPart("micro_coupler_1_4", "1/4 in micro tubing coupler", "fitting", 0.55, 1, 1, input("barb", "1/4"), output("barb", "1/4"), { pressureLossPsi: 0.05 }), // NEW
        starterPart("micro_goof_plug_1_4", "1/4 in goof plug / end plug", "cap_end", 0.35, 1, 0, input("barb", "1/4"), output("", ""), { pressureLossPsi: 0 }), // NEW
        starterPart("transfer_barb_1_2_to_1_4", "1/2 in barb to 1/4 in transfer barb", "fitting", 0.85, 1, 1, input("barb", "1/2"), output("barb", "1/4"), { pressureLossPsi: 0.2 }), // NEW
        starterPart("adapter_1_4_to_1_2_barb", "1/4 in barb to 1/2 in barb adapter", "fitting", 0.85, 1, 1, input("barb", "1/4"), output("barb", "1/2"), { pressureLossPsi: 0.2 }), // NEW
        starterPart("poly_mainline_3_4", "3/4 in poly mainline tubing", "pipe_tubing", 0, 1, 1, input("barb", "3/4"), output("barb", "3/4"), { innerDiameterIn: 0.824, hazenWilliamsC: 150 }, 0.65),
        starterPart("poly_mainline_1", "1 in poly mainline tubing", "pipe_tubing", 0, 1, 1, input("barb", "1"), output("barb", "1"), { innerDiameterIn: 1.049, hazenWilliamsC: 150 }, 0.9), // NEW
        starterPart("poly_distribution_1_2", "1/2 in distribution tubing", "pipe_tubing", 0, 1, 1, input("barb", "1/2"), output("barb", "1/2"), { innerDiameterIn: 0.600, hazenWilliamsC: 150 }, 0.32),
        starterPart("micro_tubing_1_4", "1/4 in micro tubing", "pipe_tubing", 0, 1, 1, input("barb", "1/4"), output("barb", "1/4"), { innerDiameterIn: 0.170, hazenWilliamsC: 150 }, 0.12), // NEW
        starterPart("drip_tape_8mil_12in", "8 mil drip tape, 12 in emitter spacing", "drip_tape", 42, 1, 1, input("barb", "1/2", "drip"), output("barb", "1/2", "drip"), { flowGpm: 1.2, operatingPressurePsi: 10 }),
        starterPart("pc_dripline_1_2", "1/2 in pressure-compensating dripline", "dripline", 48, 1, 1, input("barb", "1/2", "drip"), output("barb", "1/2", "drip"), { flowGpm: 1.0, operatingPressurePsi: 12 }),
        starterPart("micro_emitter_0_5_gph", "1/4 in drip emitter, 0.5 gph", "emitter", 0.45, 1, 0, input("barb", "1/4", "drip"), output("", ""), { flowGpm: 0.0083, operatingPressurePsi: 15 }), // NEW
        starterPart("micro_emitter_1_0_gph", "1/4 in drip emitter, 1.0 gph", "emitter", 0.45, 1, 0, input("barb", "1/4", "drip"), output("", ""), { flowGpm: 0.0167, operatingPressurePsi: 15 }), // NEW
        starterPart("micro_emitter_2_0_gph", "1/4 in drip emitter, 2.0 gph", "emitter", 0.45, 1, 0, input("barb", "1/4", "drip"), output("", ""), { flowGpm: 0.0333, operatingPressurePsi: 15 }), // NEW
        starterPart("overhead_sprinkler_head_30psi", "Overhead sprinkler head/nozzle, 30 psi", "sprinkler", 14, 1, 1, input("barb", "1/2", "sprinkler"), output("barb", "1/2", "sprinkler"), { flowGpm: 2.5, operatingPressurePsi: 30 }),
        starterPart("microspray_stake_20psi", "Nursery microspray stake, 20 psi", "microspray", 8, 1, 1, input("barb", "1/2", "microspray"), output("barb", "1/2", "microspray"), { flowGpm: 1.5, operatingPressurePsi: 20 }),
        starterPart("micro_spray_stake_1_4", "1/4 in micro-spray stake, 20 psi", "microspray", 3.5, 1, 0, input("barb", "1/4", "microspray"), output("", ""), { flowGpm: 0.25, operatingPressurePsi: 20 }), // NEW
        starterPart("soaker_row_line_1_2", "1/2 in soaker row line", "dripline", 30, 1, 1, input("barb", "1/2", "drip"), output("barb", "1/2", "drip"), { flowGpm: 0.8, operatingPressurePsi: 10 }),
        starterPart("bubbler_emitter_1_2", "Perennial bubbler emitter", "bubbler", 5, 1, 1, input("barb", "1/2", "bubbler"), output("barb", "1/2", "bubbler"), { flowGpm: 1.0, operatingPressurePsi: 15 }),
        starterPart("hose_standpipe_1_2", "Manual hose standpipe", "standpipe", 22, 1, 1, input("barb", "1/2", "standpipe"), output("barb", "1/2", "standpipe"), { flowGpm: 2.0, operatingPressurePsi: 20 })
    ].concat(GENERATED_CONNECTOR_CATALOG_ITEMS); // CHANGE

    let activeIrrigationMode = null; // NEW
    let hudSyncTimer = null; // NEW
    let hudSyncModuleCell = null; // NEW
    let inactiveEntryOverlay = null; // NEW
    let inactiveEntryRefreshTimer = null; // NEW

    function generateLabelOnlyConnectorParts() { // NEW
        const families = [
            { id: "twist_lock", label: "Twist-lock" },
            { id: "push_connect", label: "Push-to-connect" }
        ]; // NEW
        const sizes = [
            { id: "1_4", label: "1/4", cost: 1.25 },
            { id: "1_2", label: "1/2", cost: 2.25 },
            { id: "3_4", label: "3/4", cost: 3.75 },
            { id: "1", label: "1", cost: 5.75 }
        ]; // NEW
        const parts = []; // NEW
        families.forEach(function (family) { // NEW
            sizes.forEach(function (size) { // NEW
                parts.push(familyTubingPart(family, size)); // CHANGE
                parts.push(labelOnlyConnectorPart(family, "coupler", size, size, 1, size.cost, family.label + " " + size.label + " in coupler")); // NEW
                parts.push(labelOnlyConnectorPart(family, "tee", size, size, 2, size.cost + 0.75, family.label + " " + size.label + " in tee")); // NEW
                parts.push(labelOnlyConnectorPart(family, "elbow", size, size, 1, size.cost + 0.35, family.label + " " + size.label + " in elbow")); // NEW
                parts.push(labelOnlyConnectorPart(family, "end_cap", size, null, 0, Math.max(0.75, size.cost - 0.6), family.label + " " + size.label + " in end cap")); // NEW
            }); // NEW
            sizes.forEach(function (from) { // NEW
                sizes.forEach(function (to) { // NEW
                    if (from.id === to.id) return; // NEW
                    const cost = Math.max(from.cost, to.cost) + 0.85; // NEW
                    parts.push(labelOnlyConnectorPart(family, "adapter", from, to, 1, cost, family.label + " " + from.label + " in to " + to.label + " in adapter")); // CHANGE
                }); // NEW
            }); // NEW
        }); // NEW
        return parts; // NEW
    } // NEW

    function labelOnlyConnectorPart(family, kind, inputSize, outputSize, outputs, cost, name) { // NEW
        const id = family.id + "_" + kind + "_" + inputSize.id + (outputSize && outputSize.id !== inputSize.id ? "_to_" + outputSize.id : ""); // NEW
        return starterPart(id, name, "fitting", cost, 1, outputs, input(family.id, inputSize.label, "", true), output(outputSize ? family.id : "", outputSize ? outputSize.label : "", "", null, !!outputSize), { pressureLossPsi: outputs > 0 ? 0.2 : 0 }); // CHANGE
    } // NEW

    function familyTubingPart(family, size) { // NEW
        const diameters = { "1_4": 0.170, "1_2": 0.600, "3_4": 0.824, "1": 1.049 }; // NEW
        return starterPart(family.id + "_tubing_" + size.id, family.label + " " + size.label + " in tubing", "pipe_tubing", 0, 1, 1, input(family.id, size.label, "", true), output(family.id, size.label, "", null, true), { innerDiameterIn: diameters[size.id] || 0.600, hazenWilliamsC: 150 }, Math.max(0.12, size.cost * 0.18)); // NEW
    } // NEW

    function safeJsonParse(raw, fallback) {
        try {
            return raw ? JSON.parse(String(raw)) : fallback;
        } catch (_) {
            return fallback;
        }
    }

    function createXmlDocument() {
        if (typeof mxUtils !== "undefined" && mxUtils.createXmlDocument) return mxUtils.createXmlDocument();
        return document.implementation.createDocument("", "", null);
    }

    function buildXmlValueForEdit(cell, fallbackTag) {
        if (!cell) return null;
        const value = cell.value;
        if (value && value.nodeType === 1) return value.cloneNode(true);
        const node = createXmlDocument().createElement(fallbackTag || "object");
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
        else cell.value = node;
    }

    function getCellAttr(cell, key, fallback) {
        if (!cell || !cell.getAttribute) return fallback || "";
        const value = cell.getAttribute(key);
        return value == null ? (fallback || "") : String(value);
    }

    function getCellId(cell) {
        return cell && cell.getId ? cell.getId() : (cell && cell.id);
    }

    function getChildCells(parent) {
        const out = [];
        const count = model.getChildCount ? model.getChildCount(parent) : ((parent && parent.children && parent.children.length) || 0);
        for (let i = 0; i < count; i++) {
            const child = model.getChildAt ? model.getChildAt(parent, i) : parent.children[i];
            out.push(child);
        }
        return out;
    }

    function collectDescendants(parent, predicate, out) {
        const result = out || [];
        getChildCells(parent).forEach(function (child) {
            if (!predicate || predicate(child)) result.push(child);
            collectDescendants(child, predicate, result);
        });
        return result;
    }

    function isGardenModule(cell) {
        return !!cell && cell.getAttribute && (
            cell.getAttribute("garden_module") === "1" ||
            cell.getAttribute("trellis_garden_module") === "1"
        );
    }

    function isGardenBed(cell) {
        return !!cell && cell.getAttribute && (
            cell.getAttribute("garden_bed") === "1" ||
            cell.getAttribute("gardenBed") === "1" ||
            cell.getAttribute("is_garden_bed") === "1"
        );
    }

    function findGardenModuleAncestor(cell) {
        let cur = cell;
        while (cur) {
            if (isGardenModule(cur)) return cur;
            cur = model.getParent ? model.getParent(cur) : cur.parent;
        }
        return null;
    }

    function getGeometry(cell) {
        return model.getGeometry ? model.getGeometry(cell) : (cell && cell.geometry);
    }

    function setGeometry(cell, geometryPatch) { // NEW
        if (!cell) return; // NEW
        const current = getGeometry(cell); // NEW
        if (!current) return; // NEW
        const next = current.clone ? current.clone() : Object.assign({}, current); // NEW
        Object.keys(geometryPatch || {}).forEach(function (key) { next[key] = geometryPatch[key]; }); // NEW
        if (model.setGeometry) model.setGeometry(cell, next); // NEW
        else cell.geometry = next; // NEW
    } // NEW

    function unitsToCm(units) {
        return Number(units) / (PX_PER_CM * DRAW_SCALE);
    }

    function unitsToAreaM2(widthUnits, heightUnits) {
        const wM = unitsToCm(widthUnits) / 100;
        const hM = unitsToCm(heightUnits) / 100;
        return Math.max(0, wM * hM);
    }

    function readCatalog(moduleCell) {
        const parsed = safeJsonParse(getCellAttr(moduleCell, ATTRS.CATALOG_JSON, ""), null);
        const items = parsed && Array.isArray(parsed.items) ? parsed.items : [];
        const version = parsed && Number.isFinite(Number(parsed.version)) ? Number(parsed.version) : (items.length ? 1 : 0); // NEW
        return {
            version, // CHANGE
            items: items.map(normalizeCatalogPart).filter(Boolean)
        };
    }

    function writeCatalog(moduleCell, catalog) {
        const items = (catalog && Array.isArray(catalog.items) ? catalog.items : catalog || [])
            .map(normalizeCatalogPart)
            .filter(Boolean);
        setCellAttrs(moduleCell, {
            [ATTRS.CATALOG_JSON]: JSON.stringify({ version: PLUGIN_VERSION, items })
        });
        return { version: PLUGIN_VERSION, items };
    }

    function input(type, nominalSize, method, pipeConnection) { // CHANGE
        return { type: normalizeConnectorType(type), nominalSize: nominalSize || "", pipeConnection: !!pipeConnection }; // CHANGE
    }

    function output(type, nominalSize, method, maxFlowGpm, pipeConnection) { // CHANGE
        return { type: normalizeConnectorType(type), nominalSize: nominalSize || "", maxFlowGpm: maxFlowGpm == null ? null : maxFlowGpm, pipeConnection: !!pipeConnection }; // CHANGE
    }

    function starterPart(id, name, category, cost, inputs, outputs, inputConnector, outputConnector, specs, unitCost) {
        const starterInput = normalizeConnectorRecord(inputConnector || {}); // CHANGE
        const starterOutput = normalizeConnectorRecord(outputConnector || {}); // CHANGE
        if (starterInput.type === "barb") starterInput.pipeConnection = true; // CHANGE
        if (starterOutput.type === "barb") starterOutput.pipeConnection = true; // CHANGE
        return {
            id,
            name,
            category,
            stockState: "unknown",
            cost,
            unitCost: unitCost == null ? cost : unitCost,
            connectors: {
                inputs,
                outputs,
                input: starterInput, // CHANGE
                output: starterOutput // CHANGE
            },
            specs: Object.assign({}, specs || {})
        };
    }

    function starterCatalog() {
        return { version: PLUGIN_VERSION, items: STARTER_CATALOG_ITEMS.map(normalizeCatalogPart).filter(Boolean) };
    }

    function starterCatalogUpgradeItems() { // NEW
        return STARTER_CATALOG_ITEMS // NEW
            .map(normalizeCatalogPart) // NEW
            .filter(function (part) { return part && CATALOG_UPGRADE_PART_IDS.has(part.id); }); // NEW
    } // NEW

    function mergeCatalogUpgradeParts(moduleCell, currentCatalog) { // NEW
        const current = currentCatalog || readCatalog(moduleCell); // NEW
        const usedIds = new Set((current.items || []).map(function (item) { return item.id; })); // NEW
        const items = (current.items || []).slice(); // NEW
        starterCatalogUpgradeItems().forEach(function (part) { // NEW
            if (!usedIds.has(part.id)) { // NEW
                usedIds.add(part.id); // NEW
                items.push(part); // NEW
            } // NEW
        }); // NEW
        return writeCatalog(moduleCell, { items }); // NEW
    } // NEW

    function seedStarterCatalogIfEmpty(moduleCell) {
        const current = readCatalog(moduleCell);
        if (!moduleCell) return current; // NEW
        if (current.items.length > 0 && current.version < PLUGIN_VERSION) return mergeCatalogUpgradeParts(moduleCell, current); // NEW
        if (current.items.length > 0) return current; // CHANGE
        return writeCatalog(moduleCell, starterCatalog());
    }

    function upsertCatalogPart(moduleCell, part) {
        const normalized = normalizeCatalogPart(part);
        if (!normalized || !normalized.id) return readCatalog(moduleCell);
        const catalog = readCatalog(moduleCell);
        const items = catalog.items.filter(function (item) { return item.id !== normalized.id; });
        items.push(normalized);
        items.sort(function (a, b) { return String(a.name || a.id).localeCompare(String(b.name || b.id)); });
        return writeCatalog(moduleCell, { items });
    }

    function deleteCatalogPart(moduleCell, partId) {
        const catalog = readCatalog(moduleCell);
        return writeCatalog(moduleCell, {
            items: catalog.items.filter(function (item) { return item.id !== partId; })
        });
    }

    function nextCatalogPartId(catalog, category) {
        const base = sanitizeId(category || "part") || "part";
        let index = 1;
        const used = new Set((catalog.items || []).map(function (item) { return item.id; }));
        while (used.has(base + "_" + index)) index += 1;
        return base + "_" + index;
    }

    function normalizeConnectorType(type) { // CHANGE
        return String(type || "").trim().toLowerCase(); // CHANGE
    } // CHANGE

    function connectorTypeLabel(type) { // CHANGE
        const normalized = normalizeConnectorType(type); // CHANGE
        return normalized.replace(/_/g, " "); // CHANGE
    } // CHANGE

    function normalizeOperatingPressureSpecs(specs) { // CHANGE
        const source = specs || {}; // CHANGE
        const legacy = finiteNumber(source.operatingPressurePsi, null); // CHANGE
        return { // CHANGE
            minOperatingPressurePsi: finiteNumber(source.minOperatingPressurePsi, legacy), // CHANGE
            maxOperatingPressurePsi: finiteNumber(source.maxOperatingPressurePsi, null) // CHANGE
        }; // CHANGE
    } // CHANGE

    function normalizeCatalogSpecs(specs) { // CHANGE
        const normalized = Object.assign({}, specs || {}, normalizeOperatingPressureSpecs(specs || {})); // CHANGE
        delete normalized.operatingPressurePsi; // CHANGE
        return normalized; // CHANGE
    } // CHANGE

    function unitCostAppliesToCategory(category) { // CHANGE
        return ["pipe_tubing", "drip_tape", "dripline"].indexOf(category) >= 0; // CHANGE
    } // CHANGE

    function normalizeConnectorRecord(connector) {
        const c = connector || {};
        const type = normalizeConnectorType(c.type || c.connectionType); // CHANGE
        return {
            type, // CHANGE
            nominalSize: String(c.nominalSize || c.size || "").trim(),
            pipeType: String(c.pipeType || "").trim(),
            pipeConnection: c.pipeConnection === true || c.pipeConnection === "true" || c.pipeConnection === "1", // CHANGE
            maxFlowGpm: finiteNumber(c.maxFlowGpm, null),
            minPressurePsi: finiteNumber(c.minPressurePsi, null),
            maxPressurePsi: finiteNumber(c.maxPressurePsi, null)
        };
    }

    function normalizeCatalogPart(part) {
        if (!part || typeof part !== "object") return null;
        const connectors = part.connectors || {};
        return {
            id: String(part.id || "").trim(),
            name: String(part.name || "").trim(),
            category: String(part.category || "").trim(),
            stockState: VALID_STOCK_STATES.includes(part.stockState) ? part.stockState : "unknown",
            cost: finiteNumber(part.cost, 0),
            unitCost: unitCostAppliesToCategory(part.category) ? finiteNumber(part.unitCost, finiteNumber(part.cost, 0)) : null, // CHANGE
            connectors: {
                inputs: Math.max(0, Math.floor(finiteNumber(connectors.inputs, 0))),
                outputs: Math.max(0, Math.floor(finiteNumber(connectors.outputs, 0))),
                input: normalizeConnectorRecord(connectors.input || connectors.in),
                output: normalizeConnectorRecord(connectors.output || connectors.out)
            },
            specs: normalizeCatalogSpecs(part.specs || {}) // CHANGE
        };
    }

    function validateCatalogPart(part) {
        const p = normalizeCatalogPart(part);
        const errors = [];
        if (!p || !p.id) errors.push("Part ID is required.");
        if (!p || !p.name) errors.push("Part name is required.");
        if (!p || PART_CATEGORIES.indexOf(p.category) < 0) errors.push("Known production irrigation category is required.");
        if (p && PURCHASE_NEEDED.has(p.stockState) && !(Number(p.cost) > 0 || Number(p.unitCost) > 0)) errors.push("Purchase-needed parts require a cost.");
        if (p && p.connectors.inputs <= 0 && p.connectors.outputs <= 0) errors.push("At least one input or output connector is required.");
        if (p && p.connectors.inputs > 0 && (!p.connectors.input.type || !p.connectors.input.nominalSize)) errors.push("Input connector type and nominal size are required.");
        if (p && p.connectors.outputs > 0 && (!p.connectors.output.type || !p.connectors.output.nominalSize)) errors.push("Output connector type and nominal size are required.");
        if (p && requiresHydraulicSpecs(p) && !hasHydraulicSpecs(p)) errors.push("Hydraulic specs are required for this part.");
        return { ok: errors.length === 0, errors, part: p };
    }

    function requiresHydraulicSpecs(part) {
        return ["pipe_tubing", "drip_tape", "dripline", "emitter", "sprinkler", "microspray", "bubbler", "valve", "manifold", "regulator", "filter"].indexOf(part.category) >= 0;
    }

    function hasHydraulicSpecs(part) {
        if (part.category === "pipe_tubing") {
            return Number(part.specs.innerDiameterIn) > 0; // CHANGE
        }
        return Number(part.specs.flowGpm) >= 0 || Number(part.specs.minOperatingPressurePsi) > 0 || Number(part.specs.pressureLossPsi) >= 0; // CHANGE
    }

    function finiteNumber(value, fallback) {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }

    function sanitizeId(value) {
        return String(value || "")
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "");
    }

    function partById(catalog, id) {
        const items = catalog && Array.isArray(catalog.items) ? catalog.items : catalog || [];
        return items.map(normalizeCatalogPart).find(function (part) { return part && part.id === id; }) || null;
    }

    function connectorTypesMate(sourceType, targetType) { // NEW
        const source = String(sourceType || "").trim(); // NEW
        const target = String(targetType || "").trim(); // NEW
        if (!source || !target) return false; // NEW
        if (source === "mght" || source === "fght" || target === "mght" || target === "fght") return (source === "mght" && target === "fght") || (source === "fght" && target === "mght"); // NEW
        if (source === "mpt" || source === "fpt" || target === "mpt" || target === "fpt") return (source === "mpt" && target === "fpt") || (source === "fpt" && target === "mpt"); // NEW
        return false; // CHANGE
    } // NEW

    function connectorTypeMismatchReason(sourceType, targetType) { // NEW
        const source = String(sourceType || "").trim(); // NEW
        const target = String(targetType || "").trim(); // NEW
        if (!source || !target) return "Connector type mismatch."; // NEW
        if (source === "ght" || target === "ght") return "Gendered GHT connector required."; // NEW
        if ((source === "mght" && target === "mght") || (source === "fght" && target === "fght")) return "GHT gender mismatch."; // NEW
        if ((source === "mpt" && target === "mpt") || (source === "fpt" && target === "fpt")) return "Pipe thread gender mismatch."; // NEW
        if (source === target) return "Gendered connector required for non-pipe connection."; // NEW
        return "Connector type mismatch."; // NEW
    } // NEW

    function connectorMatches(source, target, endpointRequirement) {
        if (!source || !target) return { ok: false, reason: "Missing connector." };
        if (!connectorTypesMate(source.type, target.type)) return { ok: false, reason: connectorTypeMismatchReason(source.type, target.type) }; // CHANGE
        if (!source.nominalSize || !target.nominalSize) return { ok: false, reason: "Missing connector size." };
        if (source.nominalSize !== target.nominalSize) return { ok: false, reason: "Adapter required for size mismatch." };
        if (source.pipeType && target.pipeType && source.pipeType !== target.pipeType) return { ok: false, reason: "Pipe type mismatch." };
        return { ok: true, reason: "" };
    }

    function pipeConnectorMatches(source, target) { // NEW
        if (!source || !target) return { ok: false, reason: "Missing connector." }; // NEW
        if (String(source.type || "").trim() !== String(target.type || "").trim()) return { ok: false, reason: connectorTypeMismatchReason(source.type, target.type) }; // CHANGE
        if (!source.nominalSize || !target.nominalSize) return { ok: false, reason: "Missing connector size." }; // NEW
        if (source.nominalSize !== target.nominalSize) return { ok: false, reason: "Pipe Edge size mismatch." }; // NEW
        return { ok: true, reason: "" }; // NEW
    } // NEW

    function connectorRecordsRequirePipe(sourceConnector, targetConnector) { // NEW
        return !!(sourceConnector && sourceConnector.pipeConnection && targetConnector && targetConnector.pipeConnection); // CHANGE
    } // NEW

    function connectorRecordsMatch(sourceConnector, targetConnector, endpointRequirement) { // NEW
        return connectorRecordsRequirePipe(sourceConnector, targetConnector) ? pipeConnectorMatches(sourceConnector, targetConnector) : connectorMatches(sourceConnector, targetConnector, endpointRequirement); // NEW
    } // NEW

    function canConnectParts(previousPart, nextPart, endpointRequirement) {
        const prev = normalizeCatalogPart(previousPart);
        const next = normalizeCatalogPart(nextPart);
        if (!prev || !next) return { ok: false, reason: "Missing part." };
        if (prev.connectors.outputs <= 0) return { ok: false, reason: "Previous part has no output connector." };
        if (next.connectors.inputs <= 0) return { ok: false, reason: "Next part has no input connector." };
        return connectorRecordsMatch(prev.connectors.output, next.connectors.input, endpointRequirement); // CHANGE
    }

    function canEndpointConnectToPart(endpointRequirement, nextPart) {
        const req = normalizeEndpointProfile(endpointRequirement);
        const next = normalizeCatalogPart(nextPart);
        if (!next) return { ok: false, reason: "Missing part." };
        if (!req.connectorType || !req.nominalSize) return { ok: false, reason: "Endpoint requirement is incomplete." };
        if (next.connectors.inputs <= 0) return { ok: false, reason: "Next part has no input connector." };
        return connectorRecordsMatch({ // CHANGE
            type: req.connectorType,
            nominalSize: req.nominalSize,
            pipeType: req.pipeType || "",
            pipeConnection: !!req.pipeConnection // CHANGE
        }, next.connectors.input, req);
    }

    function compatibleFirstParts(catalog, sourceEndpointProfile, targetEndpointProfile) {
        const items = catalog && Array.isArray(catalog.items) ? catalog.items : catalog || [];
        return items
            .map(normalizeCatalogPart)
            .filter(function (part) { return part && validateCatalogPart(part).ok; })
            .filter(function (part) {
                return canEndpointConnectToPart(sourceEndpointProfile, part).ok &&
                    (!targetEndpointProfile || part.connectors.outputs > 0);
            });
    }

    function canPartReachEndpoint(part, endpointRequirement) {
        const p = normalizeCatalogPart(part);
        const req = normalizeEndpointProfile(endpointRequirement);
        if (!p) return { ok: false, reason: "Missing part." };
        if (!req.connectorType || !req.nominalSize) return { ok: false, reason: "Endpoint requirement is incomplete." };
        if (p.connectors.outputs <= 0) return { ok: false, reason: "Part has no output connector." };
        return connectorRecordsMatch(p.connectors.output, { // CHANGE
            type: req.connectorType,
            nominalSize: req.nominalSize,
            pipeType: req.pipeType || "",
            pipeConnection: !!req.pipeConnection // CHANGE
        }, req);
    }

    function compatibleNextParts(catalog, currentPart, endpointRequirement) {
        const items = catalog && Array.isArray(catalog.items) ? catalog.items : catalog || [];
        return items
            .map(normalizeCatalogPart)
            .filter(function (part) { return part && validateCatalogPart(part).ok; })
            .filter(function (part) { return canConnectParts(currentPart, part, endpointRequirement).ok; });
    }

    function groupPartsByStock(parts) {
        return {
            available: (parts || []).filter(function (part) { return STOCK_AVAILABLE.has(part.stockState); }),
            purchaseNeeded: (parts || []).filter(function (part) { return !STOCK_AVAILABLE.has(part.stockState); })
        };
    }

    function healEndpoint(catalog, currentPart, endpointRequirement, options) {
        const maxDepth = Math.max(1, Math.floor((options && options.maxDepth) || 5));
        const maxResults = Math.max(1, Math.floor((options && options.maxResults) || 5));
        const items = (catalog && Array.isArray(catalog.items) ? catalog.items : catalog || [])
            .map(normalizeCatalogPart)
            .filter(function (part) { return part && validateCatalogPart(part).ok; });
        const byId = new Map(items.map(function (part) { return [part.id, part]; }));
        const start = normalizeCatalogPart(currentPart);
        const queue = [{ last: start, parts: [], seen: new Set([start && start.id]) }];
        const results = [];

        while (queue.length && results.length < maxResults * 8) {
            const state = queue.shift();
            if (state.parts.length > maxDepth) continue;
            if (state.parts.length > 0 && canPartReachEndpoint(state.last, endpointRequirement).ok) {
                results.push(makeHealSuggestion(state.parts));
                continue;
            }
            if (state.parts.length === maxDepth) continue;
            items.forEach(function (candidate) {
                if (!candidate.id || state.seen.has(candidate.id)) return;
                if (!canConnectParts(state.last, candidate, endpointRequirement).ok) return;
                const nextSeen = new Set(Array.from(state.seen));
                nextSeen.add(candidate.id);
                queue.push({ last: candidate, parts: state.parts.concat([byId.get(candidate.id)]), seen: nextSeen });
            });
        }

        return results
            .sort(function (a, b) {
                return (a.totalParts - b.totalParts) ||
                    (a.purchaseNeededParts - b.purchaseNeededParts) ||
                    (a.purchaseNeededCost - b.purchaseNeededCost);
            })
            .slice(0, maxResults);
    }

    function makeHealSuggestion(parts) {
        const purchaseParts = parts.filter(function (part) { return PURCHASE_NEEDED.has(part.stockState); });
        return {
            partIds: parts.map(function (part) { return part.id; }),
            labels: parts.map(function (part) { return part.name; }),
            totalParts: parts.length,
            purchaseNeededParts: purchaseParts.length,
            purchaseNeededCost: purchaseParts.reduce(function (sum, part) { return sum + finiteNumber(part.cost || part.unitCost, 0); }, 0)
        };
    }

    function endpointAsOutputPart(endpointCell) {
        const profile = endpointProfile(endpointCell);
        return {
            id: getCellId(endpointCell) || "endpoint",
            name: endpointLabel(endpointCell),
            category: "source_adapter",
            stockState: "in_stock",
            cost: 0,
            connectors: {
                inputs: 0,
                outputs: 1,
                output: {
                    type: profile.connectorType, // CHANGE
                    nominalSize: profile.nominalSize,
                    pipeType: profile.pipeType || "",
                    pipeConnection: !!profile.pipeConnection, // CHANGE
                    maxFlowGpm: profile.usableFlowGpm
                }
            },
            specs: {}
        };
    }

    function normalizeEndpointProfile(profile) {
        const p = profile || {};
        return {
            label: String(p.label || "").trim(),
            connectorType: normalizeConnectorType(p.connectorType || p.type), // CHANGE
            nominalSize: String(p.nominalSize || p.size || "").trim(),
            pipeType: String(p.pipeType || "").trim(),
            pipeConnection: p.pipeConnection === true || p.pipeConnection === "true" || p.pipeConnection === "1", // CHANGE
            usableFlowGpm: finiteNumber(p.usableFlowGpm, null),
            staticPressurePsi: finiteNumber(p.staticPressurePsi, null)
        };
    }

    function endpointProfile(cell) {
        return normalizeEndpointProfile(safeJsonParse(getCellAttr(cell, ATTRS.ENDPOINT_PROFILE_JSON, ""), {}));
    }

    function endpointLabel(cell) {
        const profile = endpointProfile(cell);
        return profile.label || getCellAttr(cell, "label", getCellId(cell) || "Endpoint");
    }

    function createVertex(parent, label, x, y, w, h, style, attrs) {
        let cell = null;
        if (graph.insertVertex) {
            cell = graph.insertVertex(parent, null, label || "", x, y, w, h, style || "");
        } else if (typeof mxCell !== "undefined" && typeof mxGeometry !== "undefined") {
            cell = new mxCell(label || "", new mxGeometry(x, y, w, h), style || "");
            cell.vertex = true;
            if (model.add) model.add(parent, cell);
        }
        if (cell && attrs) setCellAttrs(cell, attrs);
        return cell;
    }

    function createEdge(parent, source, target, label, style, attrs) {
        let edge = null;
        if (graph.insertEdge) {
            edge = graph.insertEdge(parent, null, label || "", source, target, style || "");
        } else if (typeof mxCell !== "undefined" && typeof mxGeometry !== "undefined") {
            edge = new mxCell(label || "", new mxGeometry(), style || "");
            edge.edge = true;
            edge.source = source;
            edge.target = target;
            if (model.add) model.add(parent, edge);
        }
        if (edge && attrs) setCellAttrs(edge, attrs);
        return edge;
    }

    function createSourceEndpoint(moduleCell, label, profile) {
        const normalized = normalizeEndpointProfile(Object.assign({}, profile || {}, { label }));
        const endpoint = createVertex(moduleCell, label || "Water Source", 24, 72, 80, 34,
            "rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;",
            {
                label: label || "Water Source",
                [ATTRS.ENDPOINT]: "1",
                [ATTRS.ENDPOINT_TYPE]: "source",
                [ATTRS.ENDPOINT_PROFILE_JSON]: JSON.stringify(normalized)
            });
        return endpoint;
    }

    function createBedEndpoint(bedCell, label, profile) {
        const normalized = normalizeEndpointProfile(Object.assign({}, profile || {}, { label }));
        const endpoint = createVertex(bedCell, label || "Irrigation inlet", 8, 8, 72, 24,
            "rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;fontSize=10;",
            {
                label: label || "Irrigation inlet",
                [ATTRS.ENDPOINT]: "1",
                [ATTRS.ENDPOINT_TYPE]: "bed",
                [ATTRS.ENDPOINT_PROFILE_JSON]: JSON.stringify(normalized)
            });
        return endpoint;
    }

    function createBranchpointEndpoint(moduleCell, label, catalogPartId, profile) {
        const normalized = normalizeEndpointProfile(Object.assign({}, profile || {}, { label }));
        return createVertex(moduleCell, label || "Irrigation branch", 130, 72, 92, 34,
            "rounded=1;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;",
            {
                label: label || "Irrigation branch",
                [ATTRS.ENDPOINT]: "1",
                [ATTRS.ENDPOINT_TYPE]: "branchpoint",
                [ATTRS.CATALOG_PART_ID]: catalogPartId || "",
                [ATTRS.ENDPOINT_PROFILE_JSON]: JSON.stringify(normalized)
            });
    }

    function createAssemblyLane(moduleCell, label, x, y, type, attrs) { // NEW
        return createVertex(moduleCell, label || "Assembly", x, y, ASSEMBLY_DEFAULT_WIDTH, ASSEMBLY_HEADER_SIZE + ASSEMBLY_PART_HEIGHT + ASSEMBLY_PART_GAP * 2, // NEW
            "swimlane;whiteSpace=wrap;html=1;startSize=" + ASSEMBLY_HEADER_SIZE + ";horizontal=1;childLayout=stackLayout;horizontalStack=0;resizeParent=0;resizeLast=0;collapsible=1;rounded=1;fillColor=#ffffff;strokeColor=#666666;fontStyle=1;", // NEW
            Object.assign({ // NEW
                label: label || "Assembly", // NEW
                [ATTRS.ASSEMBLY]: "1", // NEW
                [ATTRS.ASSEMBLY_TYPE]: type || "parts" // NEW
            }, attrs || {})); // NEW
    } // NEW

    function resizeAssemblyToChildren(assembly) { // NEW
        const parts = assemblyPartCells(assembly); // NEW
        const minHeight = ASSEMBLY_HEADER_SIZE + ASSEMBLY_PART_GAP + ASSEMBLY_PART_HEIGHT + ASSEMBLY_PART_GAP; // NEW
        const lastBottom = parts.reduce(function (bottom, cell) { const geo = getGeometry(cell) || {}; return Math.max(bottom, finiteNumber(geo.y, 0) + finiteNumber(geo.height, ASSEMBLY_PART_HEIGHT)); }, ASSEMBLY_HEADER_SIZE); // CHANGE
        const height = Math.max(minHeight, lastBottom + ASSEMBLY_PART_GAP); // CHANGE
        const width = Math.max(ASSEMBLY_DEFAULT_WIDTH, ASSEMBLY_PART_WIDTH + 40); // NEW
        setGeometry(assembly, { width, height }); // NEW
        if (graph.refresh) graph.refresh(assembly); // NEW
    } // NEW

    function nextAssemblyPartY(assembly) { // NEW
        const parts = assemblyPartCells(assembly); // NEW
        return ASSEMBLY_HEADER_SIZE + ASSEMBLY_PART_GAP + parts.length * (ASSEMBLY_PART_HEIGHT + ASSEMBLY_PART_GAP); // NEW
    } // NEW

    function createAssemblyPartCell(assembly, label, attrs, index) { // NEW
        const y = index == null ? nextAssemblyPartY(assembly) : ASSEMBLY_HEADER_SIZE + ASSEMBLY_PART_GAP + index * (ASSEMBLY_PART_HEIGHT + ASSEMBLY_PART_GAP); // NEW
        const cell = createVertex(assembly, label || "Irrigation part", 20, y, ASSEMBLY_PART_WIDTH, ASSEMBLY_PART_HEIGHT, // NEW
            "rounded=1;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#666666;fontSize=10;", // NEW
            attrs || {}); // NEW
        resizeAssemblyToChildren(assembly); // NEW
        return cell; // NEW
    } // NEW

    function updateAssemblyPartCell(cell, part) { // NEW
        if (!cell || !part) return; // NEW
        setCellAttrs(cell, { // NEW
            label: part.name || part.id || "Irrigation part", // NEW
            [ATTRS.COMPONENT]: "1", // NEW
            [ATTRS.COMPONENT_TYPE]: part.category || "unknown", // NEW
            [ATTRS.CATALOG_PART_ID]: part.id || "" // NEW
        }); // NEW
    } // NEW

    function createSourceAssembly(moduleCell, label, profile, anchor) { // NEW
        const point = anchor || { x: 24, y: 72 }; // NEW
        const assembly = createAssemblyLane(moduleCell, label || "Source Assembly", point.x, point.y, "source", {}); // NEW
        const normalized = normalizeEndpointProfile(Object.assign({}, profile || {}, { label: label || "Water Source" })); // NEW
        const source = createAssemblyPartCell(assembly, label || "Water Source", { // NEW
            label: label || "Water Source", // NEW
            [ATTRS.ENDPOINT]: "1", // NEW
            [ATTRS.ENDPOINT_TYPE]: "source", // NEW
            [ATTRS.ENDPOINT_PROFILE_JSON]: JSON.stringify(normalized) // NEW
        }); // NEW
        return { assembly, source }; // NEW
    } // NEW

    function createPartAssembly(moduleCell, part, anchor) { // NEW
        const point = anchor || { x: 24, y: 72 }; // NEW
        const assembly = createAssemblyLane(moduleCell, "Assembly", point.x, point.y, "parts", {}); // NEW
        const partCell = createAssemblyPartCell(assembly, part ? part.name : "Irrigation part", { // NEW
            label: part ? part.name : "Irrigation part", // NEW
            [ATTRS.COMPONENT]: "1", // NEW
            [ATTRS.COMPONENT_TYPE]: part ? part.category : "unknown", // NEW
            [ATTRS.CATALOG_PART_ID]: part ? part.id : "" // NEW
        }); // NEW
        return { assembly, partCell }; // NEW
    } // NEW

    function createBedAssembly(moduleCell, bedCell, anchor) { // CHANGE
        const bedGeo = getGeometry(bedCell) || { width: ASSEMBLY_CONTRACTED_BED.width, height: ASSEMBLY_CONTRACTED_BED.height }; // NEW
        const point = bedAssemblyOverlayPoint(bedGeo); // CHANGE
        const size = bedAssemblyOverlaySize(bedGeo); // NEW
        const label = (getCellAttr(bedCell, "label", "Bed") || "Bed") + " Assembly"; // NEW
        if (!getCellAttr(bedCell, ATTRS.BED_PORTS_JSON, "")) writeBedPortConfig(bedCell, defaultBedPortConfig()); // NEW
        const assembly = createAssemblyLane(bedCell, label, point.x, point.y, "bed", { // CHANGE
            [ATTRS.ASSEMBLY_EXPANDED]: "1", // NEW
            [ATTRS.LINKED_BED_ID]: getCellId(bedCell) || "" // NEW
        }); // NEW
        setGeometry(assembly, { width: size.width, height: size.height }); // CHANGE
        setGeometry(assembly, { width: size.width, height: size.height }); // CHANGE
        return { assembly, endpoint: assembly }; // CHANGE
    } // NEW

    function bedAssemblyOverlayPoint(bedGeo) { // NEW
        return { x: 8, y: 8 }; // NEW
    } // NEW

    function bedAssemblyOverlaySize(bedGeo) { // NEW
        const width = Math.max(120, Math.min(ASSEMBLY_DEFAULT_WIDTH, finiteNumber(bedGeo && bedGeo.width, ASSEMBLY_DEFAULT_WIDTH) - 16)); // NEW
        const height = Math.max(70, Math.min(ASSEMBLY_CONTRACTED_BED.height, finiteNumber(bedGeo && bedGeo.height, ASSEMBLY_CONTRACTED_BED.height) - 16)); // NEW
        return { width, height }; // NEW
    } // NEW

    function isEndpoint(cell) {
        return !!cell && cell.getAttribute && cell.getAttribute(ATTRS.ENDPOINT) === "1";
    }

    function isAssembly(cell) { // NEW
        return !!cell && cell.getAttribute && cell.getAttribute(ATTRS.ASSEMBLY) === "1"; // NEW
    } // NEW

    function assemblyType(cell) { // NEW
        return getCellAttr(cell, ATTRS.ASSEMBLY_TYPE, "parts"); // NEW
    } // NEW

    function findAssemblyAncestor(cell) { // NEW
        let cur = cell; // NEW
        while (cur) { // NEW
            if (isAssembly(cur)) return cur; // NEW
            cur = model.getParent ? model.getParent(cur) : cur.parent; // NEW
        } // NEW
        return null; // NEW
    } // NEW

    function assemblyPartCells(assembly) { // NEW
        return getChildCells(assembly).filter(function (cell) { return isAssemblyPartCell(cell); }).sort(function (a, b) { // NEW
            const ga = getGeometry(a) || {}; // NEW
            const gb = getGeometry(b) || {}; // NEW
            return finiteNumber(ga.y, 0) - finiteNumber(gb.y, 0); // NEW
        }); // NEW
    } // NEW

    function isAssemblyPartCell(cell) { // NEW
        return !!cell && !isAssembly(cell) && (isEndpoint(cell) || getCellAttr(cell, ATTRS.COMPONENT, "") === "1"); // NEW
    } // NEW

    function firstAssemblyPart(assembly) { // NEW
        return assemblyPartCells(assembly)[0] || null; // NEW
    } // NEW

    function lastAssemblyPart(assembly) { // NEW
        const parts = assemblyPartCells(assembly); // NEW
        return parts[parts.length - 1] || null; // NEW
    } // NEW

    function bedAssemblyEndpoint(assembly) { // NEW
        if (!assembly) return null; // NEW
        return assemblyType(assembly) === "bed" ? assembly : collectDescendants(assembly, function (cell) { return isEndpoint(cell) && endpointType(cell) === "bed"; })[0] || null; // CHANGE
    } // NEW

    function defaultBedPortConfig() { // NEW
        return { version: PLUGIN_VERSION, inputs: 1, outputs: 1, input: input("barb", "1/2", "", true), output: output("barb", "1/2", "", null, true) }; // CHANGE
    } // NEW

    function bedCellForAssembly(moduleCell, assembly) { // NEW
        if (!assembly) return null; // NEW
        const linkedId = getCellAttr(assembly, ATTRS.LINKED_BED_ID, ""); // NEW
        return findCellById(moduleCell || findGardenModuleAncestor(assembly), linkedId) || findBedAncestor(assembly); // NEW
    } // NEW

    function readBedPortConfig(bedCell) { // NEW
        const saved = safeJsonParse(getCellAttr(bedCell, ATTRS.BED_PORTS_JSON, ""), null) || {}; // NEW
        const fallback = defaultBedPortConfig(); // NEW
        return { // NEW
            version: PLUGIN_VERSION, // NEW
            inputs: Math.max(0, Math.floor(finiteNumber(saved.inputs, fallback.inputs))), // NEW
            outputs: Math.max(0, Math.floor(finiteNumber(saved.outputs, fallback.outputs))), // NEW
            input: normalizeConnectorRecord(Object.assign({}, fallback.input, saved.input || {})), // NEW
            output: normalizeConnectorRecord(Object.assign({}, fallback.output, saved.output || {})) // NEW
        }; // NEW
    } // NEW

    function writeBedPortConfig(bedCell, config) { // NEW
        if (!bedCell) return defaultBedPortConfig(); // NEW
        const normalized = readBedPortConfigFromObject(config); // NEW
        setCellAttrs(bedCell, { [ATTRS.BED_PORTS_JSON]: JSON.stringify(normalized) }); // NEW
        return normalized; // NEW
    } // NEW

    function readBedPortConfigFromObject(config) { // NEW
        const fallback = defaultBedPortConfig(); // NEW
        const saved = config || {}; // NEW
        return { version: PLUGIN_VERSION, inputs: Math.max(0, Math.floor(finiteNumber(saved.inputs, fallback.inputs))), outputs: Math.max(0, Math.floor(finiteNumber(saved.outputs, fallback.outputs))), input: normalizeConnectorRecord(Object.assign({}, fallback.input, saved.input || {})), output: normalizeConnectorRecord(Object.assign({}, fallback.output, saved.output || {})) }; // NEW
    } // NEW

    function isAssemblyModeObject(cell) { // NEW
        return isAssembly(cell) || !!findAssemblyAncestor(cell); // NEW
    } // NEW

    function portKey(port) { // NEW
        return [port && port.cellId || "", port && port.role || "", String(port && port.index || 0)].join(":"); // NEW
    } // NEW

    function normalizePort(port) { // NEW
        return { cellId: String(port && port.cellId || ""), role: String(port && port.role || ""), index: Math.max(0, Math.floor(finiteNumber(port && port.index, 0))) }; // NEW
    } // NEW

    function portCell(moduleCell, port) { // NEW
        return findCellById(moduleCell, port && port.cellId); // NEW
    } // NEW

    function portCapacityForCell(moduleCell, cell, role) { // NEW
        if (!cell) return 0; // NEW
        if (isAssembly(cell) && assemblyType(cell) === "bed") { const ports = readBedPortConfig(bedCellForAssembly(moduleCell, cell)); return role === "input" ? ports.inputs : ports.outputs; } // NEW
        if (endpointType(cell) === "source") return role === "output" ? 1 : 0; // NEW
        if (endpointType(cell) === "bed") return role === "input" ? 1 : 0; // NEW
        const part = partForCell(moduleCell, cell); // NEW
        if (!part || !part.connectors) return 0; // NEW
        return Math.max(0, finiteNumber(role === "input" ? part.connectors.inputs : part.connectors.outputs, 0)); // NEW
    } // NEW

    function portConnectorForCell(moduleCell, cell, role) { // NEW
        if (!cell) return null; // NEW
        if (isAssembly(cell) && assemblyType(cell) === "bed") { const ports = readBedPortConfig(bedCellForAssembly(moduleCell, cell)); return role === "input" ? ports.input : ports.output; } // NEW
        if (isEndpoint(cell)) { // NEW
            const profile = endpointProfile(cell); // NEW
            return endpointProfileAsConnector(profile); // NEW
        } // NEW
        const part = partForCell(moduleCell, cell); // NEW
        if (!part || !part.connectors) return null; // NEW
        return role === "input" ? part.connectors.input : part.connectors.output; // NEW
    } // NEW

    function collectAssemblyEdges(moduleCell) { // NEW
        return collectDescendants(moduleCell, function (cell) { // NEW
            return !!cell && !isLegacyGenerated(cell) && (getCellAttr(cell, ATTRS.PIPE_EDGE, "") === "1" || getCellAttr(cell, ATTRS.DIRECT_LINK_EDGE, "") === "1") && getCellAttr(cell, ATTRS.EDGE_SOURCE_PORT, "") !== ""; // CHANGE
        }); // NEW
    } // NEW

    function portEdgeMatches(edge, cell, role, index) { // NEW
        const attr = role === "output" ? ATTRS.EDGE_SOURCE_PORT : ATTRS.EDGE_TARGET_PORT; // NEW
        const endCell = role === "output" ? edge.source : edge.target; // NEW
        return endCell === cell && String(getCellAttr(edge, attr, "0")) === String(index || 0); // NEW
    } // NEW

    function edgesForPort(moduleCell, port) { // NEW
        const normalized = normalizePort(port); // NEW
        const cell = portCell(moduleCell, normalized); // NEW
        if (!cell) return []; // NEW
        return collectAssemblyEdges(moduleCell).filter(function (edge) { return portEdgeMatches(edge, cell, normalized.role, normalized.index); }); // NEW
    } // NEW

    function incomingAssemblyEdges(moduleCell, cell) { // NEW
        return collectAssemblyEdges(moduleCell).filter(function (edge) { return edge.target === cell; }); // NEW
    } // NEW

    function outgoingAssemblyEdges(moduleCell, cell) { // NEW
        return collectAssemblyEdges(moduleCell).filter(function (edge) { return edge.source === cell; }); // NEW
    } // NEW

    function isPortFree(moduleCell, port) { // NEW
        const normalized = normalizePort(port); // NEW
        const cell = portCell(moduleCell, normalized); // NEW
        if (!cell) return false; // NEW
        if (normalized.role === "input" && incomingAssemblyEdges(moduleCell, cell).length > 0) return false; // NEW
        return edgesForPort(moduleCell, normalized).length === 0; // NEW
    } // NEW

    function connectedAssembly(assembly) { // NEW
        const parts = assemblyPartCells(assembly); // NEW
        if (!parts.length) return false; // NEW
        if (parts.length > 1 && parts.some(function (part) { return endpointType(part) === "source"; })) return true; // NEW
        const moduleCell = findGardenModuleAncestor(assembly); // NEW
        return parts.some(function (part) { return incomingAssemblyEdges(moduleCell, part).length || outgoingAssemblyEdges(moduleCell, part).length; }); // NEW
    } // NEW

    function wouldCreateAssemblyCycle(moduleCell, sourceCell, targetCell) { // NEW
        const seen = new Set(); // NEW
        function visit(cell) { // NEW
            const id = getCellId(cell); // NEW
            if (!id || seen.has(id)) return false; // NEW
            if (cell === sourceCell) return true; // NEW
            seen.add(id); // NEW
            return outgoingAssemblyEdges(moduleCell, cell).some(function (edge) { return visit(edge.target); }); // NEW
        } // NEW
        return visit(targetCell); // NEW
    } // NEW

    function autoPipePartIdForConnection(moduleCell, sourceConnector, targetConnector) { // NEW
        const catalog = readCatalog(moduleCell); // NEW
        const candidates = catalog.items.filter(function (part) { // NEW
            const p = normalizeCatalogPart(part); // NEW
            return p && p.category === "pipe_tubing" && validateCatalogPart(p).ok && // NEW
                pipeConnectorMatches(sourceConnector, p.connectors.input).ok && // CHANGE
                pipeConnectorMatches(p.connectors.output, targetConnector).ok; // CHANGE
        }).map(normalizeCatalogPart); // NEW
        candidates.sort(function (a, b) { // NEW
            const stockA = STOCK_AVAILABLE.has(a.stockState) ? 0 : 1; // NEW
            const stockB = STOCK_AVAILABLE.has(b.stockState) ? 0 : 1; // NEW
            return (stockA - stockB) || (finiteNumber(a.unitCost, a.cost) - finiteNumber(b.unitCost, b.cost)) || String(a.name).localeCompare(String(b.name)); // NEW
        }); // NEW
        return candidates[0] ? candidates[0].id : ""; // NEW
    } // NEW

    function connectorsRequirePipe(sourceConnector, targetConnector) { // NEW
        return connectorRecordsRequirePipe(sourceConnector, targetConnector); // CHANGE
    } // NEW

    function connectorConnectionMode(moduleCell, sourceConnector, targetConnector) { // NEW
        if (connectorsRequirePipe(sourceConnector, targetConnector)) { // NEW
            const pipeMatch = pipeConnectorMatches(sourceConnector, targetConnector); // NEW
            if (!pipeMatch.ok) { irrigationDebug("connectorConnectionMode:rejected", { reason: pipeMatch.reason, mode: "pipe-match", sourceConnector, targetConnector }); return pipeMatch; } // DIAGNOSTIC
            const pipePartId = autoPipePartIdForConnection(moduleCell, sourceConnector, targetConnector); // NEW
            if (!pipePartId) { const rejected = { ok: false, reason: "No compatible pipe part found for this connection." }; irrigationDebug("connectorConnectionMode:rejected", { reason: rejected.reason, mode: "pipe-part", sourceConnector, targetConnector }); return rejected; } // DIAGNOSTIC
            return { ok: true, reason: "", mode: "pipe", pipePartId }; // NEW
        } // NEW
        const direct = connectorMatches(sourceConnector, targetConnector, null); // NEW
        if (!direct.ok) irrigationDebug("connectorConnectionMode:rejected", { reason: direct.reason, mode: "direct", sourceConnector, targetConnector }); // DIAGNOSTIC
        return direct.ok ? { ok: true, reason: "", mode: "direct" } : direct; // NEW
    } // NEW

    function validatePortConnectionStructure(moduleCell, sourcePort, targetPort) { // NEW
        const source = normalizePort(sourcePort); // NEW
        const target = normalizePort(targetPort); // NEW
        if (source.role !== "output" || target.role !== "input") { irrigationDebug("connectionDecision:rejected", { stage: "structure", reason: "Select one output port and one inlet port.", source, target }); return { ok: false, reason: "Select one output port and one inlet port." }; } // DIAGNOSTIC
        const sourceCell = portCell(moduleCell, source); // NEW
        const targetCell = portCell(moduleCell, target); // NEW
        if (!sourceCell || !targetCell) { irrigationDebug("connectionDecision:rejected", { stage: "structure", reason: "Selected port is no longer available.", source, target, sourceCell: debugCellSummary(sourceCell), targetCell: debugCellSummary(targetCell) }); return { ok: false, reason: "Selected port is no longer available." }; } // DIAGNOSTIC
        if (sourceCell === targetCell) { irrigationDebug("connectionDecision:rejected", { stage: "structure", reason: "A part cannot connect to itself.", source, target, sourceCell: debugCellSummary(sourceCell) }); return { ok: false, reason: "A part cannot connect to itself." }; } // DIAGNOSTIC
        const sourceAssembly = findAssemblyAncestor(sourceCell); // NEW
        const targetAssembly = findAssemblyAncestor(targetCell); // NEW
        if (sourceAssembly && targetAssembly && sourceAssembly === targetAssembly) { irrigationDebug("connectionDecision:rejected", { stage: "structure", reason: "Selected ports are already in the same assembly.", source, target, sourceCell: debugCellSummary(sourceCell), targetCell: debugCellSummary(targetCell), sourceAssembly: debugCellSummary(sourceAssembly) }); return { ok: false, reason: "Selected ports are already in the same assembly." }; } // DIAGNOSTIC
        if (sourceAssembly && targetAssembly && sourceAssembly !== targetAssembly) { // NEW
            if (assemblyType(sourceAssembly) !== "bed" && lastAssemblyPart(sourceAssembly) !== sourceCell) { irrigationDebug("connectionDecision:rejected", { stage: "structure", reason: "Connect from the last part in the upstream assembly.", source, target, sourceCell: debugCellSummary(sourceCell), lastSourcePart: debugCellSummary(lastAssemblyPart(sourceAssembly)), sourceAssembly: debugCellSummary(sourceAssembly) }); return { ok: false, reason: "Connect from the last part in the upstream assembly." }; } // DIAGNOSTIC
            if (assemblyType(targetAssembly) !== "bed" && firstAssemblyPart(targetAssembly) !== targetCell) { irrigationDebug("connectionDecision:rejected", { stage: "structure", reason: "Connect to the first part in the downstream assembly.", source, target, targetCell: debugCellSummary(targetCell), firstTargetPart: debugCellSummary(firstAssemblyPart(targetAssembly)), targetAssembly: debugCellSummary(targetAssembly) }); return { ok: false, reason: "Connect to the first part in the downstream assembly." }; } // DIAGNOSTIC
        } // NEW
        if (source.index >= portCapacityForCell(moduleCell, sourceCell, "output")) { irrigationDebug("connectionDecision:rejected", { stage: "structure", reason: "Selected output does not exist.", source, sourceCell: debugCellSummary(sourceCell), outputCapacity: portCapacityForCell(moduleCell, sourceCell, "output") }); return { ok: false, reason: "Selected output does not exist." }; } // DIAGNOSTIC
        if (target.index >= portCapacityForCell(moduleCell, targetCell, "input")) { irrigationDebug("connectionDecision:rejected", { stage: "structure", reason: "Selected inlet does not exist.", target, targetCell: debugCellSummary(targetCell), inputCapacity: portCapacityForCell(moduleCell, targetCell, "input") }); return { ok: false, reason: "Selected inlet does not exist." }; } // DIAGNOSTIC
        if (!isPortFree(moduleCell, source)) { irrigationDebug("connectionDecision:rejected", { stage: "structure", reason: "Selected output is already connected.", source, sourceCell: debugCellSummary(sourceCell), edges: edgesForPort(moduleCell, source).map(debugCellSummary) }); return { ok: false, reason: "Selected output is already connected." }; } // DIAGNOSTIC
        if (!isPortFree(moduleCell, target)) { irrigationDebug("connectionDecision:rejected", { stage: "structure", reason: "Selected inlet is already connected.", target, targetCell: debugCellSummary(targetCell), edges: edgesForPort(moduleCell, target).map(debugCellSummary) }); return { ok: false, reason: "Selected inlet is already connected." }; } // DIAGNOSTIC
        if (wouldCreateAssemblyCycle(moduleCell, sourceCell, targetCell)) { irrigationDebug("connectionDecision:rejected", { stage: "structure", reason: "Irrigation assemblies must remain a tree.", source, target, sourceCell: debugCellSummary(sourceCell), targetCell: debugCellSummary(targetCell) }); return { ok: false, reason: "Irrigation assemblies must remain a tree." }; } // DIAGNOSTIC
        return { ok: true, reason: "", source, target, sourceCell, targetCell, sourceAssembly, targetAssembly }; // NEW
    } // NEW

    function connectionDecisionForPorts(moduleCell, sourcePort, targetPort) { // NEW
        const structure = validatePortConnectionStructure(moduleCell, sourcePort, targetPort); // NEW
        if (!structure.ok) { irrigationDebug("connectionDecision:rejected", { stage: "structure-result", reason: structure.reason, sourcePort: normalizePort(sourcePort), targetPort: normalizePort(targetPort) }); return structure; } // DIAGNOSTIC
        const sourceConnector = portConnectorForCell(moduleCell, structure.sourceCell, "output"); // NEW
        const targetConnector = portConnectorForCell(moduleCell, structure.targetCell, "input"); // NEW
        const compatibility = connectorConnectionMode(moduleCell, sourceConnector, targetConnector); // CHANGE
        if (!compatibility.ok) { irrigationDebug("connectionDecision:rejected", { stage: "compatibility", reason: compatibility.reason, source: structure.source, target: structure.target, sourceCell: debugCellSummary(structure.sourceCell), targetCell: debugCellSummary(structure.targetCell), sourceConnector, targetConnector }); return compatibility; } // DIAGNOSTIC
        const sourceCapacity = portCapacityForCell(moduleCell, structure.sourceCell, "output"); // NEW
        const sourceBed = assemblyType(structure.sourceAssembly) === "bed"; // NEW
        const targetBed = assemblyType(structure.targetAssembly) === "bed"; // NEW
        const canMerge = !sourceBed && !targetBed && sourceCapacity <= 1 && structure.sourceAssembly && structure.targetAssembly; // NEW
        return Object.assign({}, structure, { mode: compatibility.mode === "pipe" ? "pipe" : (canMerge ? "merge" : "direct"), pipePartId: compatibility.pipePartId || "" }); // CHANGE
    } // NEW

    function validatePortConnection(moduleCell, sourcePort, targetPort) { // NEW
        const decision = connectionDecisionForPorts(moduleCell, sourcePort, targetPort); // CHANGE
        return decision.ok ? { ok: true, reason: "", mode: decision.mode } : { ok: false, reason: decision.reason }; // CHANGE
    } // NEW

    function createAssemblyConnection(moduleCell, sourcePort, targetPort) { // NEW
        const decision = connectionDecisionForPorts(moduleCell, sourcePort, targetPort); // CHANGE
        if (!decision.ok) { irrigationDebug("createAssemblyConnection:rejected", { reason: decision.reason, sourcePort: normalizePort(sourcePort), targetPort: normalizePort(targetPort) }); return { ok: false, reason: decision.reason, edge: null, mode: "" }; } // DIAGNOSTIC
        if (decision.mode === "merge") return mergeAssemblyConnection(moduleCell, decision); // NEW
        const attrs = { // NEW
            [ATTRS.EDGE_SOURCE_PORT]: String(decision.source.index), // NEW
            [ATTRS.EDGE_TARGET_PORT]: String(decision.target.index) // NEW
        }; // NEW
        if (decision.mode === "pipe") { attrs[ATTRS.PIPE_EDGE] = "1"; attrs[ATTRS.PIPE_PART_ID] = decision.pipePartId; } // NEW
        else attrs[ATTRS.DIRECT_LINK_EDGE] = "1"; // NEW
        const edge = createEdge(moduleCell, decision.sourceCell, decision.targetCell, "", decision.mode === "pipe" ? "edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#2f80ed;" : "edgeStyle=orthogonalEdgeStyle;rounded=0;dashed=1;html=1;strokeColor=#7c3aed;", attrs); // CHANGE
        return { ok: true, reason: "", edge, mode: decision.mode }; // CHANGE
    } // NEW

    function mergeAssemblyConnection(moduleCell, decision) { // NEW
        const sourceAssembly = decision.sourceAssembly; // NEW
        const targetAssembly = decision.targetAssembly; // NEW
        if (!sourceAssembly || !targetAssembly || sourceAssembly === targetAssembly) return { ok: false, reason: "Assemblies cannot be merged.", edge: null, mode: "merge" }; // NEW
        model.beginUpdate && model.beginUpdate(); // NEW
        try { // NEW
            const moved = assemblyPartCells(targetAssembly); // NEW
            moved.forEach(function (cell) { moveCellToParent(cell, sourceAssembly); }); // NEW
            reflowAssemblyParts(sourceAssembly); // NEW
            removeCellFromParent(targetAssembly); // NEW
            return { ok: true, reason: "", edge: null, mode: "merge", assembly: sourceAssembly }; // NEW
        } finally { model.endUpdate && model.endUpdate(); } // NEW
    } // NEW

    function retargetConnectionEdge(edge, terminal, isSource) { // CHANGE
        if (!edge || !terminal) return; // NEW
        if (model.setTerminal) model.setTerminal(edge, terminal, !!isSource); // NEW
        if (isSource) edge.source = terminal; // NEW
        else edge.target = terminal; // NEW
    } // NEW

    function updateConnectionEdgeAttrs(edge, decision) { // NEW
        if (!edge || !decision) return; // NEW
        if (decision.mode === "pipe") { // CHANGE
            const pipePartId = String(decision.pipePartId || "").trim(); // CHANGE
            if (!pipePartId) return; // CHANGE
            setCellAttrs(edge, { [ATTRS.PIPE_EDGE]: "1", [ATTRS.DIRECT_LINK_EDGE]: "", [ATTRS.PIPE_PART_ID]: pipePartId, [ATTRS.EDGE_SOURCE_PORT]: String(decision.source.index), [ATTRS.EDGE_TARGET_PORT]: String(decision.target.index) }); // CHANGE
            return; // CHANGE
        } // CHANGE
        else setCellAttrs(edge, { [ATTRS.PIPE_EDGE]: "", [ATTRS.DIRECT_LINK_EDGE]: "1", [ATTRS.PIPE_PART_ID]: "", [ATTRS.EDGE_SOURCE_PORT]: String(decision.source.index), [ATTRS.EDGE_TARGET_PORT]: String(decision.target.index) }); // NEW
    } // NEW

    function existingEdgeConnectionDecision(moduleCell, sourcePort, targetPort) { // NEW
        const source = normalizePort(sourcePort); // NEW
        const target = normalizePort(targetPort); // NEW
        if (source.role !== "output" || target.role !== "input") return { ok: false, reason: "Select one output port and one inlet port." }; // NEW
        const sourceCell = portCell(moduleCell, source); // NEW
        const targetCell = portCell(moduleCell, target); // NEW
        if (!sourceCell || !targetCell) return { ok: false, reason: "Selected port is no longer available." }; // NEW
        if (sourceCell === targetCell) return { ok: false, reason: "A part cannot connect to itself." }; // NEW
        const compatibility = connectorConnectionMode(moduleCell, portConnectorForCell(moduleCell, sourceCell, "output"), portConnectorForCell(moduleCell, targetCell, "input")); // NEW
        return compatibility.ok ? Object.assign({}, compatibility, { source, target, sourceCell, targetCell }) : compatibility; // NEW
    } // NEW

    function moveCellToParent(cell, parent, index) { // NEW
        if (!cell || !parent) return; // NEW
        if (model.add) { model.add(parent, cell, index == null ? getChildCells(parent).length : index); return; } // NEW
        const oldParent = model.getParent ? model.getParent(cell) : cell.parent; // NEW
        if (oldParent && oldParent.children) { // NEW
            const oldIndex = oldParent.children.indexOf(cell); // NEW
            if (oldIndex >= 0) oldParent.children.splice(oldIndex, 1); // NEW
        } // NEW
        cell.parent = parent; // NEW
        if (!parent.children) parent.children = []; // NEW
        parent.children.splice(index == null ? parent.children.length : index, 0, cell); // NEW
    } // NEW

    function reflowAssemblyParts(assembly) { // NEW
        assemblyPartCells(assembly).forEach(function (cell, index) { // NEW
            setGeometry(cell, { y: ASSEMBLY_HEADER_SIZE + ASSEMBLY_PART_GAP + index * (ASSEMBLY_PART_HEIGHT + ASSEMBLY_PART_GAP) }); // NEW
        }); // NEW
        resizeAssemblyToChildren(assembly); // NEW
    } // NEW

    function insertAssemblyPartAt(assembly, part, index) { // NEW
        const parts = assemblyPartCells(assembly); // NEW
        const insertIndex = Math.max(0, Math.min(parts.length, Math.floor(finiteNumber(index, parts.length)))); // NEW
        parts.forEach(function (cell, cellIndex) { // NEW
            if (cellIndex >= insertIndex) { // NEW
                const geo = getGeometry(cell) || {}; // NEW
                setGeometry(cell, { y: finiteNumber(geo.y, ASSEMBLY_HEADER_SIZE + ASSEMBLY_PART_GAP) + ASSEMBLY_PART_HEIGHT + ASSEMBLY_PART_GAP }); // NEW
            } // NEW
        }); // NEW
        const cell = createAssemblyPartCell(assembly, part.name, { label: part.name, [ATTRS.COMPONENT]: "1", [ATTRS.COMPONENT_TYPE]: part.category, [ATTRS.CATALOG_PART_ID]: part.id }, insertIndex); // NEW
        reflowAssemblyParts(assembly); // NEW
        return cell; // NEW
    } // NEW

    function splitAssemblySegment(moduleCell, assembly, startIndex) { // NEW
        const parts = assemblyPartCells(assembly); // NEW
        const splitIndex = Math.max(0, Math.min(parts.length, Math.floor(finiteNumber(startIndex, parts.length)))); // NEW
        const moved = parts.slice(splitIndex); // NEW
        if (!moved.length) return null; // NEW
        const geo = getGeometry(assembly) || {}; // NEW
        const splitAssembly = createAssemblyLane(moduleCell, "Disconnected Assembly", finiteNumber(geo.x, 24), finiteNumber(geo.y, 72) + finiteNumber(geo.height, 120) + 40, assemblyType(assembly), {}); // CHANGE
        moved.forEach(function (cell, index) { moveCellToParent(cell, splitAssembly, index); }); // NEW
        reflowAssemblyParts(assembly); // NEW
        positionSplitAssemblyBelow(assembly, splitAssembly); // NEW
        reflowAssemblyParts(splitAssembly); // NEW
        return splitAssembly; // NEW
    } // NEW

    function splitAssemblyPrefix(moduleCell, assembly, endIndex) { // NEW
        const parts = assemblyPartCells(assembly); // NEW
        const splitEnd = Math.max(0, Math.min(parts.length, Math.floor(finiteNumber(endIndex, 0)))); // NEW
        const moved = parts.slice(0, splitEnd); // NEW
        if (!moved.length) return null; // NEW
        const geo = getGeometry(assembly) || {}; // NEW
        const splitAssembly = createAssemblyLane(moduleCell, "Disconnected Assembly", finiteNumber(geo.x, 24), finiteNumber(geo.y, 72) + finiteNumber(geo.height, 120) + 40, assemblyType(assembly), {}); // NEW
        moved.forEach(function (cell, index) { moveCellToParent(cell, splitAssembly, index); }); // NEW
        reflowAssemblyParts(assembly); // NEW
        positionSplitAssemblyBelow(assembly, splitAssembly); // NEW
        reflowAssemblyParts(splitAssembly); // NEW
        return splitAssembly; // NEW
    } // NEW

    function positionSplitAssemblyBelow(upstreamAssembly, splitAssembly) { // NEW
        const upstreamGeo = getGeometry(upstreamAssembly) || {}; // NEW
        if (!splitAssembly) return; // NEW
        setGeometry(splitAssembly, { x: finiteNumber(upstreamGeo.x, 24), y: finiteNumber(upstreamGeo.y, 72) + finiteNumber(upstreamGeo.height, 120) + 40 }); // NEW
    } // NEW

    function managedConnectionEdge(edge) { // NEW
        return !!edge && !isLegacyGenerated(edge) && (getCellAttr(edge, ATTRS.PIPE_EDGE, "") === "1" || getCellAttr(edge, ATTRS.DIRECT_LINK_EDGE, "") === "1"); // NEW
    } // NEW

    function boundaryKey(boundary) { // NEW
        const b = boundary || {}; // NEW
        if (b.type === "edge") return "edge:" + String(b.edgeId || ""); // NEW
        if (b.type === "internal") return ["internal", b.assemblyId || "", b.upstreamId || "", b.downstreamId || ""].join(":"); // NEW
        return ""; // NEW
    } // NEW

    function edgeBoundary(edge) { // NEW
        return edge && managedConnectionEdge(edge) ? { type: "edge", edgeId: getCellId(edge) || "" } : null; // NEW
    } // NEW

    function internalBoundaryForParts(assembly, upstream, downstream) { // NEW
        if (!assembly || !upstream || !downstream) return null; // NEW
        return { type: "internal", assemblyId: getCellId(assembly) || "", upstreamId: getCellId(upstream) || "", downstreamId: getCellId(downstream) || "" }; // NEW
    } // NEW

    function normalizeBoundary(boundary) { // NEW
        const b = boundary || {}; // NEW
        if (b.type === "edge") return { type: "edge", edgeId: String(b.edgeId || "") }; // NEW
        if (b.type === "internal") return { type: "internal", assemblyId: String(b.assemblyId || ""), upstreamId: String(b.upstreamId || ""), downstreamId: String(b.downstreamId || "") }; // NEW
        return { type: "", edgeId: "", assemblyId: "", upstreamId: "", downstreamId: "" }; // NEW
    } // NEW

    function boundaryForPort(moduleCell, port) { // NEW
        const edge = edgesForPort(moduleCell, port)[0]; // NEW
        return edgeBoundary(edge); // NEW
    } // NEW

    function uniqueBoundaries(boundaries) { // NEW
        const seen = new Set(); // NEW
        const out = []; // NEW
        (boundaries || []).forEach(function (boundary) { // NEW
            const normalized = normalizeBoundary(boundary); // NEW
            const key = boundaryKey(normalized); // NEW
            if (!key || seen.has(key)) return; // NEW
            seen.add(key); // NEW
            out.push(normalized); // NEW
        }); // NEW
        return out; // NEW
    } // NEW

    function boundaryExists(moduleCell, boundary) { // NEW
        const b = normalizeBoundary(boundary); // NEW
        if (b.type === "edge") return !!findCellById(moduleCell, b.edgeId); // NEW
        if (b.type !== "internal") return false; // NEW
        const assembly = findCellById(moduleCell, b.assemblyId); // NEW
        const upstream = findCellById(moduleCell, b.upstreamId); // NEW
        const downstream = findCellById(moduleCell, b.downstreamId); // NEW
        const parts = assemblyPartCells(assembly); // NEW
        return !!assembly && !!upstream && !!downstream && parts.indexOf(upstream) >= 0 && parts[parts.indexOf(upstream) + 1] === downstream; // NEW
    } // NEW

    function selectedValidBoundaries(session) { // NEW
        return uniqueBoundaries(session && session.selectedBoundaries || []).filter(function (boundary) { return boundaryExists(session.moduleCell, boundary); }); // NEW
    } // NEW

    function selectedOccupiedBoundaries(session, ports) { // NEW
        const boundaries = selectedValidBoundaries(session); // NEW
        (ports || selectedValidPorts(session)).forEach(function (port) { // NEW
            const boundary = boundaryForPort(session.moduleCell, port); // NEW
            if (boundary) boundaries.push(boundary); // NEW
        }); // NEW
        return uniqueBoundaries(boundaries); // NEW
    } // NEW

    function toggleSelectedBoundary(session, boundary) { // NEW
        const normalized = normalizeBoundary(boundary); // NEW
        const key = boundaryKey(normalized); // NEW
        if (!key) return; // NEW
        const current = session.selectedBoundaries || []; // NEW
        const index = current.map(boundaryKey).indexOf(key); // NEW
        if (index >= 0) current.splice(index, 1); // NEW
        else current.push(normalized); // NEW
        session.selectedBoundaries = current; // NEW
    } // NEW

    function selectBoundary(session, boundary) { // NEW
        const normalized = normalizeBoundary(boundary); // NEW
        const key = boundaryKey(normalized); // NEW
        if (!key) return; // NEW
        const current = session.selectedBoundaries || []; // NEW
        if (current.map(boundaryKey).indexOf(key) < 0) current.push(normalized); // NEW
        session.selectedBoundaries = current; // NEW
    } // NEW

    function disconnectBoundary(moduleCell, boundary) { // NEW
        const b = normalizeBoundary(boundary); // NEW
        if (b.type === "edge") { // NEW
            const edge = findCellById(moduleCell, b.edgeId); // NEW
            if (!edge) return false; // NEW
            removeCellFromParent(edge); // NEW
            return true; // NEW
        } // NEW
        if (b.type === "internal") { // NEW
            const assembly = findCellById(moduleCell, b.assemblyId); // NEW
            const downstream = findCellById(moduleCell, b.downstreamId); // NEW
            const parts = assemblyPartCells(assembly); // NEW
            const index = parts.indexOf(downstream); // NEW
            if (!assembly || index <= 0) return false; // NEW
            splitAssemblySegment(moduleCell, assembly, index); // NEW
            return true; // NEW
        } // NEW
        return false; // NEW
    } // NEW

    function disconnectBoundaries(moduleCell, boundaries) { // NEW
        let count = 0; // NEW
        uniqueBoundaries(boundaries).forEach(function (boundary) { if (disconnectBoundary(moduleCell, boundary)) count++; }); // NEW
        return count; // NEW
    } // NEW

    function externalEdgesForCell(moduleCell, cell) { // NEW
        return incomingAssemblyEdges(moduleCell, cell).concat(outgoingAssemblyEdges(moduleCell, cell)); // NEW
    } // NEW

    function deleteAssemblyPartCell(moduleCell, partCell) { // NEW
        const assembly = findAssemblyAncestor(partCell); // NEW
        const parts = assemblyPartCells(assembly); // NEW
        const index = parts.indexOf(partCell); // NEW
        if (!assembly || index < 0) return false; // NEW
        externalEdgesForCell(moduleCell, partCell).forEach(removeCellFromParent); // NEW
        if (index < parts.length - 1) splitAssemblySegment(moduleCell, assembly, index + 1); // NEW
        removeCellFromParent(partCell); // NEW
        if (assemblyPartCells(assembly).length) reflowAssemblyParts(assembly); // NEW
        else removeCellFromParent(assembly); // NEW
        return true; // NEW
    } // NEW

    function partCanReceiveFromConnector(part, connector) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        if (!p || p.category === "pipe_tubing" || p.connectors.inputs <= 0) return false; // NEW
        return connectorRecordsMatch(connector, p.connectors.input, null).ok; // CHANGE
    } // NEW

    function partCanFeedConnector(part, connector) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        if (!p || p.category === "pipe_tubing" || p.connectors.outputs <= 0) return false; // NEW
        return connectorRecordsMatch(p.connectors.output, connector, null).ok; // CHANGE
    } // NEW

    function compatibleDropdownParts(moduleCell, cell, role) { // NEW
        const connector = portConnectorForCell(moduleCell, cell, role); // NEW
        return sortCatalogParts(readCatalog(moduleCell).items).map(normalizeCatalogPart).filter(function (part) { // NEW
            if (!part || part.category === "pipe_tubing" || !validateCatalogPart(part).ok) return false; // NEW
            return role === "output" ? partCanReceiveFromConnector(part, connector) : partCanFeedConnector(part, connector); // NEW
        }); // NEW
    } // NEW

    function addPartPickerContext(session) { // NEW
        const selectedPort = selectedFreeCompatibilityPort(session); // NEW
        if (selectedPort) return addPartContextFromPort(session.moduleCell, selectedPort); // NEW
        const selected = graph.getSelectionCell && graph.getSelectionCell(); // NEW
        const ports = freeBoundaryPortsForCell(session.moduleCell, selected); // NEW
        return ports.length === 1 ? addPartContextFromPort(session.moduleCell, ports[0]) : null; // NEW
    } // NEW

    function addPartContextFromPort(moduleCell, port) { // NEW
        const normalized = normalizePort(port); // NEW
        const cell = portCell(moduleCell, normalized); // NEW
        if (!cell) return null; // NEW
        if (isAssembly(cell) && assemblyType(cell) === "bed") return null; // NEW
        if (endpointType(cell) === "bed") return null; // NEW
        return { row: { cell, role: normalized.role, index: normalized.index }, port: normalized }; // NEW
    } // NEW

    function freeBoundaryPortsForCell(moduleCell, cell) { // NEW
        const portCellCandidate = boundaryPortCell(cell, "input") || boundaryPortCell(cell, "output"); // NEW
        if (!portCellCandidate && !(isAssembly(cell) && assemblyType(cell) === "bed")) return []; // NEW
        const cells = uniqueCells([boundaryPortCell(cell, "input"), boundaryPortCell(cell, "output")].filter(Boolean)); // NEW
        const ports = []; // NEW
        cells.forEach(function (candidate) { // NEW
            ["input", "output"].forEach(function (role) { // NEW
                const count = portCapacityForCell(moduleCell, candidate, role); // NEW
                for (let index = 0; index < count; index++) { // NEW
                    const port = { cellId: getCellId(candidate), role, index }; // NEW
                    if (isPortFree(moduleCell, port)) ports.push(port); // NEW
                } // NEW
            }); // NEW
        }); // NEW
        return ports; // NEW
    } // NEW

    function addPartPickerParts(session, context) { // NEW
        const baseParts = context ? compatibleDropdownParts(session.moduleCell, context.row.cell, context.row.role) : allAddableCatalogParts(session.moduleCell); // NEW
        const suppressed = context ? upstreamSingletonCategories(session.moduleCell, context.row) : new Set(); // NEW
        return sortAddPartPickerParts(baseParts.filter(function (part) { return !suppressed.has(part.category); })); // NEW
    } // NEW

    function allAddableCatalogParts(moduleCell) { // NEW
        return readCatalog(moduleCell).items.map(normalizeCatalogPart).filter(function (part) { // NEW
            return part && part.category !== "pipe_tubing" && validateCatalogPart(part).ok; // NEW
        }); // NEW
    } // NEW

    function upstreamSingletonCategories(moduleCell, row) { // NEW
        const categories = new Set(); // NEW
        collectUpstreamBranchParts(moduleCell, row).forEach(function (part) { // NEW
            if (BRANCH_SINGLETON_CATEGORIES.has(part.category)) categories.add(part.category); // NEW
        }); // NEW
        return categories; // NEW
    } // NEW

    function collectUpstreamBranchParts(moduleCell, row) { // NEW
        const seeds = row.role === "output" ? [row.cell] : upstreamIrrigationParents(moduleCell, row.cell); // NEW
        const stack = seeds.filter(Boolean); // NEW
        const seen = new Set(); // NEW
        const parts = []; // NEW
        let foundSource = false; // NEW
        while (stack.length) { // NEW
            const cell = stack.pop(); // NEW
            const id = getCellId(cell); // NEW
            if (!id || seen.has(id)) continue; // NEW
            seen.add(id); // NEW
            if (endpointType(cell) === "source") foundSource = true; // NEW
            const part = partForCell(moduleCell, cell); // NEW
            if (part) parts.push(part); // NEW
            upstreamIrrigationParents(moduleCell, cell).forEach(function (parent) { stack.push(parent); }); // NEW
        } // NEW
        return foundSource ? parts : []; // CHANGE
    } // NEW

    function addPartContextLabel(moduleCell, context) { // NEW
        const cell = context && context.row && context.row.cell; // NEW
        const role = context && context.row && context.row.role; // NEW
        const connector = portConnectorForCell(moduleCell, cell, role); // NEW
        return (role === "output" ? "outlet" : "inlet") + " " + ((context.row.index || 0) + 1) + " on " + irrigationCellLabel(cell) + " (" + connectorLabel(connector) + ")"; // NEW
    } // NEW

    function connectorLabel(connector) { // NEW
        if (!connector) return "unknown connector"; // NEW
        return [connector.nominalSize, connector.type].filter(Boolean).join(" ") || "unknown connector"; // NEW
    } // NEW

    function addPartStockGroupLabel(part) { // NEW
        return STOCK_AVAILABLE.has(normalizeCatalogPart(part).stockState) ? "In stock" : "Needs purchase"; // NEW
    } // NEW

    function broadCategorySortIndex(part) { // NEW
        const id = broadCategoryForCatalogCategory(normalizeCatalogPart(part).category).id; // NEW
        const index = BROAD_CATALOG_CATEGORIES.findIndex(function (entry) { return entry.id === id; }); // NEW
        return index < 0 ? BROAD_CATALOG_CATEGORIES.length : index; // NEW
    } // NEW

    function sortAddPartPickerParts(parts) { // NEW
        return (parts || []).slice().sort(function (a, b) { // NEW
            const stockA = STOCK_AVAILABLE.has(normalizeCatalogPart(a).stockState) ? 0 : 1; // NEW
            const stockB = STOCK_AVAILABLE.has(normalizeCatalogPart(b).stockState) ? 0 : 1; // NEW
            const keyA = catalogPartSortKey(a); // NEW
            const keyB = catalogPartSortKey(b); // NEW
            return (stockA - stockB) || (broadCategorySortIndex(a) - broadCategorySortIndex(b)) || keyA.category.localeCompare(keyB.category) || compareNominalSize(keyA.size, keyB.size) || keyA.name.localeCompare(keyB.name); // NEW
        }); // NEW
    } // NEW

    function appendGroupedPartOptions(select, parts) { // NEW
        const grouped = new Map(); // NEW
        (parts || []).forEach(function (part) { // NEW
            const label = addPartStockGroupLabel(part) + " / " + catalogBroadCategoryLabel(part); // NEW
            if (!grouped.has(label)) grouped.set(label, []); // NEW
            grouped.get(label).push(part); // NEW
        }); // NEW
        if (!grouped.size) { appendSelectOption(select, "", "No compatible parts"); select.disabled = true; return; } // NEW
        grouped.forEach(function (groupParts, label) { // NEW
            const group = document.createElement("optgroup"); // NEW
            group.label = label; // NEW
            groupParts.forEach(function (part) { appendSelectOption(group, part.id, part.name); }); // NEW
            select.appendChild(group); // NEW
        }); // NEW
    } // NEW

    function pipeEdgeLabel(moduleCell, edge, port) { // NEW
        if (!edge) return normalizePort(port).role === "output" ? "Available: no downstream pipe" : "Available: no upstream pipe"; // CHANGE
        if (getCellAttr(edge, ATTRS.DIRECT_LINK_EDGE, "") === "1") return "Direct: " + irrigationCellLabel(normalizePort(port).role === "output" ? edge.target : edge.source); // NEW
        const pipe = partById(readCatalog(moduleCell), getCellAttr(edge, ATTRS.PIPE_PART_ID, "")); // NEW
        const other = normalizePort(port).role === "output" ? edge.target : edge.source; // NEW
        return "Pipe: " + (pipe ? pipe.name : "auto pipe") + " -> " + irrigationCellLabel(other); // NEW
    } // NEW

    function endpointType(cell) {
        return getCellAttr(cell, ATTRS.ENDPOINT_TYPE, "");
    }

    function collectEndpoints(moduleCell, type) {
        return collectDescendants(moduleCell, function (cell) {
            return isEndpoint(cell) && (!type || endpointType(cell) === type);
        });
    }

    function findBedAncestor(cell) {
        let cur = cell;
        while (cur) {
            if (isGardenBed(cur)) return cur;
            cur = model.getParent ? model.getParent(cur) : cur.parent;
        }
        return null;
    }

    function findEndpointBed(endpointCell) {
        return findBedAncestor(endpointCell);
    }

    function getSelectedGardenBeds(moduleCell) {
        const selected = graph.getSelectionCells ? (graph.getSelectionCells() || []) : [];
        const beds = selected.filter(isGardenBed);
        if (beds.length) return uniqueCells(beds);
        return collectGardenBeds(moduleCell);
    }

    function uniqueCells(cells) {
        const seen = new Set();
        const out = [];
        (cells || []).forEach(function (cell) {
            const id = getCellId(cell);
            if (!id || seen.has(id)) return;
            seen.add(id);
            out.push(cell);
        });
        return out;
    }

    function ensureBedEndpoint(bedCell, profile) {
        const existing = collectDescendants(bedCell, function (cell) {
            return isEndpoint(cell) && endpointType(cell) === "bed";
        })[0];
        if (existing) return existing;
        const label = (getCellAttr(bedCell, "label", getCellId(bedCell) || "Bed") || "Bed") + " inlet";
        return createBedEndpoint(bedCell, label, Object.assign({ connectorType: "barb", nominalSize: "1/2", pipeConnection: true }, profile || {})); // CHANGE
    }

    function buildPairQueue(moduleCell, sourceEndpoint, bedEndpoints) {
        const sourceId = getCellId(sourceEndpoint);
        return (bedEndpoints || []).map(function (endpoint) {
            const bed = findEndpointBed(endpoint);
            return {
                id: sourceId + "->" + getCellId(endpoint),
                sourceEndpointId: sourceId,
                targetEndpointId: getCellId(endpoint),
                targetBedId: getCellId(bed) || "",
                label: endpointLabel(sourceEndpoint) + " -> " + endpointLabel(endpoint),
                complete: false
            };
        });
    }

    function readPaths(moduleCell) {
        const parsed = safeJsonParse(getCellAttr(moduleCell, ATTRS.PATHS_JSON, ""), null);
        return parsed && Array.isArray(parsed.paths) ? parsed.paths : [];
    }

    function writePaths(moduleCell, paths) {
        setCellAttrs(moduleCell, {
            [ATTRS.PATHS_JSON]: JSON.stringify({ version: PLUGIN_VERSION, paths: paths || [] })
        });
        return paths || [];
    }

    function makePathId(sourceEndpoint, targetEndpoint) {
        return "path_" + String(getCellId(sourceEndpoint) || "source") + "_" + String(getCellId(targetEndpoint) || "target") + "_" + Date.now();
    }

    function stagePath(options) {
        const source = options && options.sourceEndpoint;
        const target = options && options.targetEndpoint;
        const partIds = (options && options.partIds) || [];
        return {
            id: (options && options.id) || makePathId(source, target),
            sourceEndpointId: getCellId(source) || (options && options.sourceEndpointId) || "",
            targetEndpointId: getCellId(target) || (options && options.targetEndpointId) || "",
            targetBedId: options && options.targetBedId || "",
            branchpointIds: (options && options.branchpointIds) || [],
            partIds: partIds.slice(),
            pipePartId: options && options.pipePartId || "",
            pipeSegments: (options && options.pipeSegments || []).slice(), // CHANGE
            bedDemand: options && options.bedDemand || null,
            componentCellIds: [],
            pipeEdgeIds: [],
            bedTemplateCommitted: false,
            hydraulic: null,
            committedAt: null
        };
    }

    function makeDerivedAssemblyPath(options) { // CHANGE
        const source = options && options.sourceEndpoint; // CHANGE
        const target = options && options.targetEndpoint; // CHANGE
        return { // CHANGE
            id: (options && options.id) || ("assembly_" + sanitizeId(getCellId(source) + "_" + getCellId(target))), // CHANGE
            sourceEndpointId: getCellId(source) || (options && options.sourceEndpointId) || "", // CHANGE
            targetEndpointId: getCellId(target) || (options && options.targetEndpointId) || "", // CHANGE
            targetBedId: options && options.targetBedId || "", // CHANGE
            branchpointIds: (options && options.branchpointIds || []).slice(), // CHANGE
            partIds: (options && options.partIds || []).slice(), // CHANGE
            pipePartId: options && options.pipePartId || "", // CHANGE
            pipeSegments: (options && options.pipeSegments || []).slice(), // CHANGE
            bedDemand: null, // CHANGE
            componentCellIds: [], // CHANGE
            pipeEdgeIds: [], // CHANGE
            pipePartIds: [], // CHANGE
            bedTemplateCommitted: false, // CHANGE
            bedTemplate: null, // CHANGE
            hydraulic: null, // CHANGE
            committedAt: null // CHANGE
        }; // CHANGE
    } // CHANGE

    function plannedPathLengthFeet(moduleCell, path) {
        const source = findCellById(moduleCell, path.sourceEndpointId);
        const target = findCellById(moduleCell, path.targetEndpointId);
        const a = getGeometry(source);
        const b = getGeometry(target);
        if (!a || !b) return 0;
        const ax = Number(a.x || 0) + Number(a.width || 0) / 2;
        const ay = Number(a.y || 0) + Number(a.height || 0) / 2;
        const bx = Number(b.x || 0) + Number(b.width || 0) / 2;
        const by = Number(b.y || 0) + Number(b.height || 0) / 2;
        return unitsToCm(Math.sqrt(Math.pow(bx - ax, 2) + Math.pow(by - ay, 2))) / CM_PER_FOOT;
    }

    function demandFromPath(catalog, path) {
        if (path && path.bedDemand) return path.bedDemand; // NEW
        const template = path && path.bedTemplate;
        if (template && template.demand) return template.demand;
        if (template && Array.isArray(template.partIds)) {
            return template.partIds.reduce(function (out, partId) {
                const part = partById(catalog, partId);
                out.flowGpm += finiteNumber(part && part.specs && part.specs.flowGpm, 0);
                out.operatingPressurePsi = Math.max(out.operatingPressurePsi, finiteNumber(part && part.specs && part.specs.minOperatingPressurePsi, finiteNumber(part && part.specs && part.specs.operatingPressurePsi, 0))); // CHANGE
                return out;
            }, { flowGpm: 0, operatingPressurePsi: 0 });
        }
        return { flowGpm: 0, operatingPressurePsi: 0 }; // CHANGE
    }

    function demandFromBedCell(bedCell) { // NEW
        const template = safeJsonParse(getCellAttr(bedCell, ATTRS.BED_TEMPLATE_JSON, ""), null) || {}; // NEW
        const demand = template.demand || {}; // NEW
        return { flowGpm: finiteNumber(demand.flowGpm, 0), operatingPressurePsi: finiteNumber(demand.operatingPressurePsi, 0) }; // NEW
    } // NEW

    function cumulativeBedDemand(moduleCell, bedAssembly) { // NEW
        const seen = new Set(); // NEW
        function visit(assembly) { // NEW
            const id = getCellId(assembly); // NEW
            if (!id || seen.has(id)) return { flowGpm: 0, operatingPressurePsi: 0 }; // NEW
            seen.add(id); // NEW
            const own = demandFromBedCell(bedCellForAssembly(moduleCell, assembly)); // NEW
            return outgoingAssemblyEdges(moduleCell, assembly).reduce(function (total, edge) { // NEW
                if (!edge || !edge.target || !isAssembly(edge.target) || assemblyType(edge.target) !== "bed") return total; // NEW
                const downstream = visit(edge.target); // NEW
                total.flowGpm += downstream.flowGpm; // NEW
                total.operatingPressurePsi = Math.max(total.operatingPressurePsi, downstream.operatingPressurePsi); // NEW
                return total; // NEW
            }, own); // NEW
        } // NEW
        return visit(bedAssembly); // NEW
    } // NEW

    function calculatePathHydraulics(moduleCell, path) {
        const catalog = readCatalog(moduleCell);
        const source = findCellById(moduleCell, path.sourceEndpointId);
        const sourceProfile = endpointProfile(source);
        return estimatePathHydraulics({
            catalog,
            sourceProfile,
            bedDemand: demandFromPath(catalog, path),
            partIds: path.partIds || [],
            pipePartId: path.pipePartId,
            pipeSegments: pipeSegmentsForPath(moduleCell, path), // CHANGE
            lengthFt: path.pipePartId ? pathRouteLengthFeet(moduleCell, path) : 0 // CHANGE
        });
    }

    function validatePathGraph(moduleCell, path) {
        const errors = [];
        const endpointIds = [path.sourceEndpointId].concat(path.branchpointIds || []).concat([path.targetEndpointId]).filter(Boolean);
        const unique = new Set(endpointIds);
        if (unique.size !== endpointIds.length) errors.push("Irrigation paths cannot loop through the same endpoint twice.");
        if (path.sourceEndpointId && path.sourceEndpointId === path.targetEndpointId) errors.push("Source and target endpoint must be different.");
        const source = findCellById(moduleCell, path.sourceEndpointId);
        const target = findCellById(moduleCell, path.targetEndpointId);
        if (!source || !target) errors.push("Source and target endpoints are required.");
        return errors;
    }

    function validateSharedCapacity(moduleCell, path) {
        const errors = [];
        const catalog = readCatalog(moduleCell);
        const existing = deriveAssemblyPaths(moduleCell).filter(function (other) { return other.id !== path.id; }); // CHANGE
        (path.branchpointIds || []).forEach(function (branchId) {
            const branch = findCellById(moduleCell, branchId);
            const part = partById(catalog, getCellAttr(branch, ATTRS.CATALOG_PART_ID, ""));
            if (!part) return;
            const used = existing.filter(function (other) { return (other.branchpointIds || []).indexOf(branchId) >= 0; }).length + 1;
            if (part.connectors.outputs > 0 && used > part.connectors.outputs) {
                errors.push("Branchpoint " + endpointLabel(branch) + " has no free outputs.");
            }
            const maxFlow = finiteNumber(part.connectors.output && part.connectors.output.maxFlowGpm, finiteNumber(part.specs && part.specs.maxFlowGpm, null));
            if (maxFlow != null) {
                const existingFlow = existing.reduce(function (sum, other) {
                    if ((other.branchpointIds || []).indexOf(branchId) < 0) return sum;
                    return sum + finiteNumber(other.hydraulic && other.hydraulic.flowGpm, 0);
                }, 0);
                const nextFlow = finiteNumber(path.hydraulic && path.hydraulic.flowGpm, 0);
                if (existingFlow + nextFlow > maxFlow) errors.push("Branchpoint " + endpointLabel(branch) + " exceeds max flow.");
            }
        });
        return errors;
    }

    function validatePathCompatibility(moduleCell, path) {
        const errors = [];
        const catalog = readCatalog(moduleCell);
        const source = findCellById(moduleCell, path.sourceEndpointId);
        const target = findCellById(moduleCell, path.targetEndpointId);
        const partIds = path.partIds || [];
        const parts = partIds.map(function (partId) { return partById(catalog, partId); });
        parts.forEach(function (part, index) {
            const validation = validateCatalogPart(part);
            if (!validation.ok) errors.push("Invalid catalog part on path " + path.id + ": " + (partIds[index] || "missing") + ".");
        });
        if (path.pipePartId) {
            const pipe = partById(catalog, path.pipePartId);
            const pipeValidation = validateCatalogPart(pipe);
            if (!pipe || pipe.category !== "pipe_tubing" || !pipeValidation.ok) errors.push("Selected pipe is missing required specs for path " + path.id + ".");
        }
        if (!source || !target) return errors;
        if (!parts.length) {
            const direct = connectorRecordsMatch({ // CHANGE
                type: endpointProfile(source).connectorType,
                nominalSize: endpointProfile(source).nominalSize,
                pipeType: endpointProfile(source).pipeType || "",
                pipeConnection: !!endpointProfile(source).pipeConnection // CHANGE
            }, {
                type: endpointProfile(target).connectorType,
                nominalSize: endpointProfile(target).nominalSize,
                pipeType: endpointProfile(target).pipeType || "",
                pipeConnection: !!endpointProfile(target).pipeConnection // CHANGE
            }, endpointProfile(target));
            if (!direct.ok) errors.push("Source endpoint cannot connect directly to target endpoint: " + direct.reason);
            return errors;
        }
        const first = parts[0];
        const sourceMatch = canEndpointConnectToPart(endpointProfile(source), first);
        if (!sourceMatch.ok) errors.push("Source endpoint cannot connect to " + (first && first.name || partIds[0]) + ": " + sourceMatch.reason);
        for (let i = 1; i < parts.length; i++) {
            const match = canConnectParts(parts[i - 1], parts[i], endpointProfile(target));
            if (!match.ok) errors.push((parts[i - 1] && parts[i - 1].name || partIds[i - 1]) + " cannot connect to " + (parts[i] && parts[i].name || partIds[i]) + ": " + match.reason);
        }
        const last = parts[parts.length - 1];
        const targetMatch = canPartReachEndpoint(last, endpointProfile(target));
        if (!targetMatch.ok) errors.push((last && last.name || partIds[partIds.length - 1]) + " cannot reach target endpoint: " + targetMatch.reason);
        return errors;
    }

    function hydraulicBlockingErrors(path) {
        if (!path || !path.hydraulic) return ["Hydraulic calculation is missing for path " + (path && path.id || "") + "."];
        if (path.hydraulic.ok !== false) return [];
        return (path.hydraulic.warnings || []).slice();
    }

    function findReusableCells(moduleCell, ids, expectedCount) {
        const cells = (ids || []).map(function (id) { return findCellById(moduleCell, id); }).filter(Boolean);
        return cells.length === expectedCount ? cells : [];
    }

    function updateGeneratedComponentCell(cell, part, partId, pathId) {
        if (!cell) return;
        const label = part ? part.name : partId;
        setCellAttrs(cell, {
            label,
            [ATTRS.COMPONENT]: "1",
            [ATTRS.COMPONENT_TYPE]: part ? part.category : "unknown",
            [ATTRS.CATALOG_PART_ID]: partId,
            [ATTRS.PATH_ID]: pathId,
            [ATTRS.GENERATED]: "1"
        });
    }

    function updateGeneratedPipeEdge(edge, pipePartId, pathId) {
        if (!edge) return;
        setCellAttrs(edge, {
            [ATTRS.PIPE_EDGE]: "1",
            [ATTRS.PIPE_PART_ID]: pipePartId || "",
            [ATTRS.PATH_ID]: pathId,
            [ATTRS.GENERATED]: "1"
        });
    }

    function commitStagedPath(moduleCell, stagedPath) {
        const catalog = readCatalog(moduleCell);
        const path = Object.assign({}, stagedPath);
        const previous = readPaths(moduleCell).find(function (existing) { return existing.id === path.id; }) || {};
        if (!path.componentCellIds || !path.componentCellIds.length) path.componentCellIds = (previous.componentCellIds || []).slice();
        if (!path.pipeEdgeIds || !path.pipeEdgeIds.length) path.pipeEdgeIds = (previous.pipeEdgeIds || []).slice();
        path.hydraulic = calculatePathHydraulics(moduleCell, path);
        const blockers = validatePathGraph(moduleCell, path)
            .concat(validatePathCompatibility(moduleCell, path))
            .concat(validateSharedCapacity(moduleCell, path))
            .concat(hydraulicBlockingErrors(path));
        if (blockers.length) {
            path.blockingErrors = blockers;
            return path;
        }
        const sourceEndpoint = findCellById(moduleCell, path.sourceEndpointId);
        const targetEndpoint = findCellById(moduleCell, path.targetEndpointId);
        const sourceGeo = getGeometry(sourceEndpoint) || { x: 24, y: 72, width: 80, height: 34 };
        const parent = moduleCell;
        const createdComponents = [];
        const createdEdges = [];
        const x0 = Number(sourceGeo.x || 0) + 110;
        const y0 = Number(sourceGeo.y || 0);

        model.beginUpdate && model.beginUpdate();
        try {
            const reusableComponents = findReusableCells(moduleCell, path.componentCellIds, path.partIds.length);
            path.partIds.forEach(function (partId, index) {
                const part = partById(catalog, partId);
                const label = part ? part.name : partId;
                const component = reusableComponents[index] || createVertex(parent, label, x0 + (index * 96), y0, 84, 34,
                    "rounded=1;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#666666;fontSize=10;",
                    {});
                updateGeneratedComponentCell(component, part, partId, path.id);
                if (component) createdComponents.push(component);
            });

            const chain = [sourceEndpoint].concat(createdComponents).concat([targetEndpoint]).filter(Boolean);
            const reusableEdges = findReusableCells(moduleCell, path.pipeEdgeIds, Math.max(0, chain.length - 1));
            for (let i = 0; i < chain.length - 1; i++) {
                const edge = reusableEdges[i] || createEdge(parent, chain[i], chain[i + 1], "", "edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#4d8f6f;", {});
                if (edge) {
                    edge.source = chain[i];
                    edge.target = chain[i + 1];
                    updateGeneratedPipeEdge(edge, path.pipePartId, path.id);
                }
                if (edge) createdEdges.push(edge);
            }
            path.componentCellIds = createdComponents.map(getCellId).filter(Boolean);
            path.pipeEdgeIds = createdEdges.map(getCellId).filter(Boolean);
            path.committedAt = new Date().toISOString();

            const paths = readPaths(moduleCell).filter(function (existing) { return existing.id !== path.id; });
            paths.push(path);
            writePaths(moduleCell, paths);
        } finally {
            model.endUpdate && model.endUpdate();
        }

        return path;
    }

    function commitBedTemplate(moduleCell, pathId, bedCell, template) {
        const bedGeo = getGeometry(bedCell) || { width: 160, height: 80 };
        const templateDef = BED_TEMPLATES.find(function (entry) { return entry.id === (template && template.templateId); }) || BED_TEMPLATES[0];
        const rowCount = Math.max(1, Math.floor(finiteNumber(template && template.spacing && template.spacing.rows, templateDef.defaultRows)));
        const spacing = Object.assign({ rows: rowCount, emitterInches: 12 }, template && template.spacing || {});
        const demand = {
            flowGpm: finiteNumber(template && template.demand && template.demand.flowGpm, templateDef.flowGpm),
            operatingPressurePsi: finiteNumber(template && template.demand && template.demand.operatingPressurePsi, templateDef.pressurePsi)
        };
        const record = {
            version: PLUGIN_VERSION,
            pathId,
            templateId: templateDef.id,
            irrigationType: template && template.irrigationType || templateDef.lineKind,
            partIds: template && Array.isArray(template.partIds) ? template.partIds.slice() : [],
            spacing,
            demand,
            committedAt: new Date().toISOString()
        };

        model.beginUpdate && model.beginUpdate();
        try {
            setCellAttrs(bedCell, { [ATTRS.BED_TEMPLATE_JSON]: JSON.stringify(record) });
            createBedTemplateLayoutCells(bedCell, pathId, record, bedGeo);

        } finally {
            model.endUpdate && model.endUpdate();
        }

        return record;
    }

    function createBedTemplateLayoutCells(bedCell, pathId, record, bedGeo) {
        getChildCells(bedCell).filter(function (cell) { return getCellAttr(cell, ATTRS.BED_LAYOUT, "") === "1"; }).forEach(removeCellFromParent); // NEW
        const assemblyParent = isAssembly(bedCell); // NEW
        const inset = assemblyParent ? 8 : 6; // NEW
        const labelHeight = assemblyParent ? 14 : 18; // NEW
        const contentTop = assemblyParent ? ASSEMBLY_HEADER_SIZE + 30 : 10; // NEW
        const parentHeight = Number(bedGeo.height || 80); // NEW
        const showLabel = !assemblyParent || parentHeight - contentTop >= 28; // NEW
        const labelY = showLabel ? Math.max(contentTop + 8, parentHeight - labelHeight - 4) : parentHeight - 8; // CHANGE
        const width = Math.max(40, Number(bedGeo.width || 160) - inset * 2); // CHANGE
        const height = Math.max(8, labelY - contentTop); // CHANGE
        const rows = Math.max(1, Math.floor(finiteNumber(record.spacing && record.spacing.rows, 1)));
        const rowGap = height / (rows + 1);
        for (let i = 0; i < rows; i++) {
            const y = Math.round(contentTop + rowGap * (i + 1)); // CHANGE
            createVertex(bedCell, record.irrigationType + " row " + (i + 1), inset, y, width, 6, // CHANGE
                "rounded=0;whiteSpace=wrap;html=1;fillColor=#e1f5fe;strokeColor=#0288d1;fontSize=8;",
                {
                    label: record.irrigationType + " row " + (i + 1),
                    [ATTRS.BED_LAYOUT]: "1",
                    [ATTRS.PATH_ID]: pathId,
                    [ATTRS.GENERATED]: "1",
                    [ATTRS.BED_TEMPLATE_JSON]: JSON.stringify(record)
                });
        }
        if (!showLabel) return; // NEW
        createVertex(bedCell, record.templateId.replace(/_/g, " "), inset, labelY, width, labelHeight, // CHANGE
            "rounded=0;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#999999;fontSize=9;",
            {
                label: record.templateId.replace(/_/g, " "),
                [ATTRS.BED_LAYOUT]: "1",
                [ATTRS.PATH_ID]: pathId,
                [ATTRS.GENERATED]: "1",
                [ATTRS.BED_TEMPLATE_JSON]: JSON.stringify(record)
            });
    }

    function findCellById(root, id) {
        if (!id) return null;
        if (getCellId(root) === id) return root;
        return collectDescendants(root, function (cell) { return getCellId(cell) === id; })[0] || null;
    }

    function hazenWilliamsPsiLoss(input) {
        const lengthFt = finiteNumber(input && input.lengthFt, 0);
        const flowGpm = finiteNumber(input && input.flowGpm, 0);
        const diameterIn = finiteNumber(input && input.diameterIn, 0);
        const c = finiteNumber(input && input.c, 150);
        if (!(lengthFt > 0) || !(flowGpm > 0) || !(diameterIn > 0) || !(c > 0)) return 0;
        const headFt = 4.52 * lengthFt * Math.pow(flowGpm, 1.852) / (Math.pow(c, 1.852) * Math.pow(diameterIn, 4.871));
        return headFt / 2.31;
    }

    function maxOperatingPressureForDemand(catalog, partIds, bedDemand) { // CHANGE
        const explicit = finiteNumber(bedDemand && bedDemand.maxOperatingPressurePsi, null); // CHANGE
        if (explicit != null) return explicit; // CHANGE
        return (partIds || []).reduce(function (current, partId) { // CHANGE
            const part = partById(catalog, partId); // CHANGE
            const maxPsi = finiteNumber(part && part.specs && part.specs.maxOperatingPressurePsi, null); // CHANGE
            if (maxPsi == null) return current; // CHANGE
            return current == null ? maxPsi : Math.min(current, maxPsi); // CHANGE
        }, null); // CHANGE
    } // CHANGE

    function estimatePathHydraulics(args) {
        const catalog = args && args.catalog ? args.catalog : { items: [] };
        const source = normalizeEndpointProfile(args && args.sourceProfile);
        const bedDemand = args && args.bedDemand || {};
        const partIds = args && args.partIds || [];
        const pipePart = partById(catalog, args && args.pipePartId);
        const pipeSegments = normalizeHydraulicPipeSegments(args && args.pipeSegments, catalog); // CHANGE
        const flowGpm = finiteNumber(bedDemand.flowGpm, source.usableFlowGpm || 0);
        const operatingPressurePsi = finiteNumber(bedDemand.operatingPressurePsi, 0);
        const lengthFt = finiteNumber(args && args.lengthFt, 0);
        let pressureLossPsi = 0;
        const warnings = [];

        if (pipeSegments.length) { // CHANGE
            pipeSegments.forEach(function (segment) { // CHANGE
                if (!segment.part || segment.part.category !== "pipe_tubing") { warnings.push("Pipe part specs missing; pipe pressure loss was not estimated."); return; } // CHANGE
                if (!(segment.lengthFt > 0)) { warnings.push("Pipe edge length is missing; pressure loss was not estimated."); return; } // CHANGE
                pressureLossPsi += hazenWilliamsPsiLoss({ // CHANGE
                    lengthFt: segment.lengthFt, // CHANGE
                    flowGpm, // CHANGE
                    diameterIn: segment.part.specs.innerDiameterIn, // CHANGE
                    c: finiteNumber(segment.part.specs.hazenWilliamsC, 150) // CHANGE
                }); // CHANGE
            }); // CHANGE
        } else if (pipePart && pipePart.category === "pipe_tubing") {
            pressureLossPsi += hazenWilliamsPsiLoss({
                lengthFt,
                flowGpm,
                diameterIn: pipePart.specs.innerDiameterIn,
                c: finiteNumber(pipePart.specs.hazenWilliamsC, 150) // CHANGE
            });
        } else if (lengthFt > 0) {
            warnings.push("Pipe part specs missing; pipe pressure loss was not estimated.");
        }

        partIds.forEach(function (partId) {
            const part = partById(catalog, partId);
            pressureLossPsi += finiteNumber(part && part.specs && part.specs.pressureLossPsi, 0);
        });

        const availablePressurePsi = finiteNumber(source.staticPressurePsi, 0);
        const requiredPressurePsi = operatingPressurePsi + pressureLossPsi;
        const marginPsi = availablePressurePsi - requiredPressurePsi;
        const maxOperatingPressurePsi = maxOperatingPressureForDemand(catalog, partIds, bedDemand); // CHANGE
        const deliveredPressurePsi = availablePressurePsi - pressureLossPsi; // CHANGE
        if (source.usableFlowGpm != null && flowGpm > source.usableFlowGpm) warnings.push("Flow demand exceeds source usable flow.");
        if (marginPsi < 0) warnings.push("Required pressure exceeds available source pressure.");
        if (maxOperatingPressurePsi != null && deliveredPressurePsi > maxOperatingPressurePsi) warnings.push("Estimated delivered pressure exceeds maximum operating pressure."); // CHANGE

        return {
            flowGpm,
            availablePressurePsi,
            operatingPressurePsi,
            maxOperatingPressurePsi, // CHANGE
            deliveredPressurePsi, // CHANGE
            pressureLossPsi,
            requiredPressurePsi,
            marginPsi,
            ok: warnings.length === 0,
            warnings
        };
    }

    function normalizeHydraulicPipeSegments(segments, catalog) { // CHANGE
        return (segments || []).map(function (segment) { // CHANGE
            const pipePartId = String(segment && segment.pipePartId || "").trim(); // CHANGE
            return { // CHANGE
                edgeId: String(segment && segment.edgeId || "").trim(), // CHANGE
                pipePartId, // CHANGE
                lengthFt: finiteNumber(segment && segment.lengthFt, null), // CHANGE
                part: partById(catalog, pipePartId) // CHANGE
            }; // CHANGE
        }).filter(function (segment) { return !!segment.pipePartId; }); // CHANGE
    } // CHANGE

    function edgeLengthFeet(edge) {
        const measured = measuredEdgeLengthFeet(edge); // CHANGE
        return measured == null ? 0 : measured; // CHANGE
    }

    function measuredEdgeLengthFeet(edge) { // CHANGE
        const geo = getGeometry(edge);
        if (!geo) return null; // CHANGE
        if (Array.isArray(geo.points) && geo.points.length > 1) {
            let total = 0;
            for (let i = 1; i < geo.points.length; i++) {
                const a = geo.points[i - 1], b = geo.points[i];
                total += Math.sqrt(Math.pow(Number(b.x) - Number(a.x), 2) + Math.pow(Number(b.y) - Number(a.y), 2));
            }
            return unitsToCm(total) / CM_PER_FOOT;
        }
        return null; // CHANGE
    } // CHANGE

    function pipeSegmentsForPath(moduleCell, path) { // CHANGE
        if (path && Array.isArray(path.pipeSegments) && path.pipeSegments.length) return path.pipeSegments.slice(); // CHANGE
        return (path && path.pipePartIds || []).map(function (pipePartId, index) { // CHANGE
            const edge = findCellById(moduleCell, (path.pipeEdgeIds || [])[index]); // CHANGE
            return { edgeId: getCellId(edge) || (path.pipeEdgeIds || [])[index] || "", pipePartId, lengthFt: measuredEdgeLengthFeet(edge) }; // CHANGE
        }).filter(function (segment) { return !!segment.pipePartId; }); // CHANGE
    }

    function pathRouteLengthFeet(moduleCell, path) {
        const edgeLengths = (path.pipeEdgeIds || []).reduce(function (sum, edgeId) {
            return sum + edgeLengthFeet(findCellById(moduleCell, edgeId));
        }, 0);
        return edgeLengths > 0 ? edgeLengths : plannedPathLengthFeet(moduleCell, path);
    }

    function partCostForReport(moduleCell, catalog, path, partId) {
        const part = partById(catalog, partId);
        if (!part) return 0;
        if (unitCostAppliesToCategory(part.category)) { // CHANGE
            const lengthFt = pipeSegmentLengthForPart(moduleCell, path, partId); // CHANGE
            return lengthFt > 0 ? finiteNumber(part.unitCost, part.cost || 0) * lengthFt : finiteNumber(part.cost || part.unitCost, 0); // CHANGE
        } // CHANGE
        return finiteNumber(part.cost || part.unitCost, 0);
    }

    function pipeSegmentLengthForPart(moduleCell, path, partId) { // CHANGE
        const segments = pipeSegmentsForPath(moduleCell, path).filter(function (segment) { return segment.pipePartId === partId; }); // CHANGE
        if (segments.length) return segments.reduce(function (sum, segment) { return sum + finiteNumber(segment.lengthFt, 0); }, 0); // CHANGE
        return pathRouteLengthFeet(moduleCell, path); // CHANGE
    } // CHANGE

    function collectGardenBeds(moduleCell) {
        return collectDescendants(moduleCell, isGardenBed);
    }

    function bedAreaM2(bed) {
        const geo = getGeometry(bed);
        if (!geo) return 0;
        return unitsToAreaM2(Number(geo.width) || 0, Number(geo.height) || 0);
    }

    function generateReport(moduleCell) {
        const catalog = readCatalog(moduleCell);
        const paths = deriveAssemblyPaths(moduleCell); // CHANGE
        const beds = collectGardenBeds(moduleCell);
        const totalBedAreaM2 = beds.reduce(function (sum, bed) { return sum + bedAreaM2(bed); }, 0);
        const irrigatedBedIds = new Set();
        const completeBedIds = new Set();
        const usedPartIds = [];
        const usedPartCosts = [];
        const controlledZones = new Set();
        const criticalWarnings = [];
        let worstHydraulicMarginPsi = null;

        paths.forEach(function (path) {
            (path.partIds || []).forEach(function (partId, index) {
                usedPartIds.push(partId);
                usedPartCosts.push({ partId, cost: partCostForReport(moduleCell, catalog, path, partId) });
                const part = partById(catalog, partId);
                if (part && BRANCH_CATEGORIES.has(part.category)) controlledZones.add((path.componentCellIds && path.componentCellIds[index]) || part.id);
            });
            (path.branchpointIds || []).forEach(function (branchId) {
                const branch = findCellById(moduleCell, branchId);
                const part = partById(catalog, getCellAttr(branch, ATTRS.CATALOG_PART_ID, ""));
                if (part && BRANCH_CATEGORIES.has(part.category)) controlledZones.add(branchId);
            });
            if (path.pipeSegments && path.pipeSegments.length) { // CHANGE
                (path.pipeSegments || []).forEach(function (segment) { // CHANGE
                    const pipePartId = segment.pipePartId; // CHANGE
                    usedPartIds.push(pipePartId); // NEW
                    const lengthFt = finiteNumber(segment.lengthFt, 0); // CHANGE
                    const pipePart = partById(catalog, pipePartId); // NEW
                    usedPartCosts.push({ partId: pipePartId, cost: finiteNumber(pipePart && pipePart.unitCost, pipePart && pipePart.cost || 0) * lengthFt }); // NEW
                }); // CHANGE
            } else if (path.pipePartIds && path.pipePartIds.length) { // CHANGE
                (path.pipePartIds || []).forEach(function (pipePartId) { // CHANGE
                    usedPartIds.push(pipePartId); // CHANGE
                    usedPartCosts.push({ partId: pipePartId, cost: partCostForReport(moduleCell, catalog, path, pipePartId) }); // CHANGE
                }); // CHANGE
            } else if (path.pipePartId) { // CHANGE
                usedPartIds.push(path.pipePartId);
                usedPartCosts.push({ partId: path.pipePartId, cost: partCostForReport(moduleCell, catalog, path, path.pipePartId) });
            }
            if (path.bedTemplate && Array.isArray(path.bedTemplate.partIds)) {
                path.bedTemplate.partIds.forEach(function (partId) {
                    usedPartIds.push(partId);
                    usedPartCosts.push({ partId, cost: partCostForReport(moduleCell, catalog, path, partId) });
                });
            }
            if (path.bedTemplateCommitted && path.targetBedId) {
                irrigatedBedIds.add(path.targetBedId);
                const blockers = pathBlockingErrors(path, catalog).concat(validateSharedCapacity(moduleCell, path));
                if (!blockers.length) completeBedIds.add(path.targetBedId);
                blockers.forEach(function (warning) { criticalWarnings.push(warning); });
            }
            if (path.hydraulic && Number.isFinite(Number(path.hydraulic.marginPsi))) {
                const margin = Number(path.hydraulic.marginPsi);
                worstHydraulicMarginPsi = worstHydraulicMarginPsi == null ? margin : Math.min(worstHydraulicMarginPsi, margin);
            }
        });

        const irrigatedAreaM2 = beds
            .filter(function (bed) { return irrigatedBedIds.has(getCellId(bed)); })
            .reduce(function (sum, bed) { return sum + bedAreaM2(bed); }, 0);
        const purchasePartIds = usedPartIds.filter(function (partId) {
            const part = partById(catalog, partId);
            return part && PURCHASE_NEEDED.has(part.stockState);
        });
        const purchaseNeededCost = usedPartCosts.reduce(function (sum, entry) {
            const part = partById(catalog, entry.partId);
            return PURCHASE_NEEDED.has(part && part.stockState) ? sum + finiteNumber(entry.cost, 0) : sum;
        }, 0);
        const totalDesignValue = usedPartCosts.reduce(function (sum, entry) {
            return sum + finiteNumber(entry.cost, 0);
        }, 0);
        const zones = deriveZones(moduleCell); // CHANGE
        const zoneReport = zoneSummary(moduleCell, zones, paths); // NEW
        const zoneWarningCount = zoneReport.zones.reduce(function (sum, zone) { return sum + (zone.warnings || []).length; }, 0) + zoneReport.unzonedBedCount + zoneReport.ambiguousBedIds.length; // NEW
        const summary = {
            version: PLUGIN_VERSION,
            percentIrrigated: totalBedAreaM2 > 0 ? (irrigatedAreaM2 / totalBedAreaM2) * 100 : 0,
            purchaseNeededCost,
            totalDesignValue,
            zoneCount: zoneReport.zoneCount || controlledZones.size, // CHANGE
            emptyZoneCount: zoneReport.emptyZoneCount, // NEW
            unzonedBedCount: zoneReport.unzonedBedCount, // NEW
            overCapacityZoneCount: zoneReport.overCapacityZoneCount, // NEW
            worstZoneMarginPsi: zoneReport.worstZoneMarginPsi, // NEW
            zoneWarningCount, // NEW
            zones: zoneReport.zones, // NEW
            unzonedBedIds: zoneReport.unzonedBedIds, // NEW
            ambiguousZoneBedIds: zoneReport.ambiguousBedIds, // NEW
            completeness: beds.length > 0 ? (completeBedIds.size / beds.length) * 100 : 0,
            worstHydraulicMarginPsi,
            purchaseNeededCount: purchasePartIds.length,
            criticalWarningCount: criticalWarnings.length,
            criticalWarnings,
            generatedAt: new Date().toISOString()
        };

        setCellAttrs(moduleCell, {
            [ATTRS.REPORT_JSON]: JSON.stringify({ version: PLUGIN_VERSION, summary }), // CHANGE
            [ATTRS.DASHBOARD_JSON]: JSON.stringify(summary)
        });
        return summary;
    }

    function pathBlockingErrors(path, catalog) {
        const errors = [];
        (path.partIds || []).forEach(function (partId) {
            const part = partById(catalog, partId);
            const validation = validateCatalogPart(part);
            if (!validation.ok) errors.push("Invalid catalog part on path " + path.id + ": " + partId);
        });
        if (!path.hydraulic) {
            errors.push("Hydraulic calculation is missing for path " + path.id + ".");
        } else if (path.hydraulic.ok === false) {
            (path.hydraulic.warnings || []).forEach(function (warning) { errors.push(warning); });
        }
        return errors;
    }

    function readDashboardSummary(moduleCell) {
        return safeJsonParse(getCellAttr(moduleCell, ATTRS.DASHBOARD_JSON, ""), null);
    }

    function normalizeZone(zone) { // NEW
        const z = zone || {}; // NEW
        const originType = z.originType === ZONE_ORIGIN_TIMER_OUTLET ? ZONE_ORIGIN_TIMER_OUTLET : (z.originType === ZONE_ORIGIN_MANUAL ? ZONE_ORIGIN_MANUAL : ZONE_ORIGIN_MANUAL); // NEW
        const originCellId = String(z.originCellId || "").trim(); // NEW
        const outletIndex = Math.max(0, Math.floor(finiteNumber(z.outletIndex, 0))); // NEW
        const id = String(z.id || (originType === ZONE_ORIGIN_TIMER_OUTLET ? timerZoneId(originCellId, outletIndex) : "")).trim(); // NEW
        return { // NEW
            id: id || ("zone_manual_" + Date.now()), // NEW
            originType, // NEW
            originCellId: originType === ZONE_ORIGIN_TIMER_OUTLET ? originCellId : "", // NEW
            outletIndex: originType === ZONE_ORIGIN_TIMER_OUTLET ? outletIndex : null, // NEW
            alias: String(z.alias || "").trim(), // NEW
            inferredBedIds: uniqueStrings(z.inferredBedIds || []), // NEW
            pinnedBedIds: uniqueStrings(z.pinnedBedIds || []), // NEW
            excludedBedIds: uniqueStrings(z.excludedBedIds || []) // NEW
        }; // NEW
    } // NEW

    function readZones(moduleCell) { // NEW
        return deriveZones(moduleCell); // CHANGE
    } // NEW

    function readZoneOverrides(moduleCell) { // CHANGE
        const parsed = safeJsonParse(getCellAttr(moduleCell, ATTRS.ZONES_JSON, ""), null); // NEW
        const zones = parsed && Array.isArray(parsed.zones) ? parsed.zones : (Array.isArray(parsed) ? parsed : []); // NEW
        return zones.map(normalizeZone).filter(function (zone) { return !!zone.id; }); // NEW
    } // CHANGE

    function writeZones(moduleCell, zones) { // NEW
        return writeZoneOverrides(moduleCell, zones); // CHANGE
    } // NEW

    function writeZoneOverrides(moduleCell, zones) { // CHANGE
        const normalized = (zones || []).map(persistedZoneOverrideRecord).filter(function (zone) { return zoneHasPersistedZoneIntent(zone); }); // CHANGE
        setCellAttrs(moduleCell, { [ATTRS.ZONES_JSON]: JSON.stringify({ version: PLUGIN_VERSION, zones: normalized }) }); // CHANGE
        return deriveZones(moduleCell); // CHANGE
    } // CHANGE

    function persistedZoneOverrideRecord(zone) { // CHANGE
        const z = normalizeZone(zone); // CHANGE
        if (z.originType === ZONE_ORIGIN_TIMER_OUTLET) z.inferredBedIds = []; // CHANGE
        return z; // CHANGE
    } // CHANGE

    function zoneHasPersistedZoneIntent(zone) { // CHANGE
        const z = normalizeZone(zone); // CHANGE
        if (z.originType === ZONE_ORIGIN_MANUAL) return true; // CHANGE
        return !!(z.alias || z.pinnedBedIds.length || z.excludedBedIds.length); // CHANGE
    } // CHANGE

    function timerZoneId(timerCellOrId, outletIndex) { // NEW
        const id = typeof timerCellOrId === "string" ? timerCellOrId : getCellId(timerCellOrId); // NEW
        return "zone_timer_" + sanitizeId(id || "timer") + "_out_" + (Math.max(0, Math.floor(finiteNumber(outletIndex, 0))) + 1); // NEW
    } // NEW

    function manualZoneId(label) { // NEW
        return "zone_manual_" + sanitizeId(label || "zone") + "_" + Date.now(); // NEW
    } // NEW

    function uniqueStrings(values) { // NEW
        const seen = new Set(); // NEW
        const out = []; // NEW
        (values || []).forEach(function (value) { // NEW
            const text = String(value || "").trim(); // NEW
            if (!text || seen.has(text)) return; // NEW
            seen.add(text); // NEW
            out.push(text); // NEW
        }); // NEW
        return out; // NEW
    } // NEW

    function collectTimerZoneParts(moduleCell) { // NEW
        return collectDescendants(moduleCell, function (cell) { // NEW
            if (!cell || getCellAttr(cell, ATTRS.COMPONENT, "") !== "1") return false; // NEW
            const part = partForCell(moduleCell, cell); // NEW
            return !!part && part.category === "controller_timer"; // NEW
        }); // NEW
    } // NEW

    function deriveInferredTimerZones(moduleCell) { // NEW
        const zones = []; // NEW
        collectTimerZoneParts(moduleCell).forEach(function (timerCell) { // NEW
            const count = Math.max(0, portCapacityForCell(moduleCell, timerCell, "output")); // NEW
            for (let index = 0; index < count; index++) { // NEW
                zones.push(normalizeZone({ // NEW
                    id: timerZoneId(timerCell, index), // NEW
                    originType: ZONE_ORIGIN_TIMER_OUTLET, // NEW
                    originCellId: getCellId(timerCell) || "", // NEW
                    outletIndex: index, // NEW
                    inferredBedIds: downstreamBedAssemblyIdsFromTimerOutlet(moduleCell, timerCell, index) // NEW
                })); // NEW
            } // NEW
        }); // NEW
        return zones; // NEW
    } // NEW

    function downstreamBedAssemblyIdsFromTimerOutlet(moduleCell, timerCell, outletIndex) { // NEW
        const seedEdges = outgoingAssemblyEdges(moduleCell, timerCell).filter(function (edge) { // NEW
            return String(getCellAttr(edge, ATTRS.EDGE_SOURCE_PORT, "0")) === String(outletIndex || 0); // NEW
        }); // NEW
        const stack = seedEdges.map(function (edge) { return edge.target; }).filter(Boolean); // NEW
        const seen = new Set(); // NEW
        const beds = []; // NEW
        while (stack.length) { // NEW
            const cell = stack.pop(); // NEW
            const id = getCellId(cell); // NEW
            if (!id || seen.has(id)) continue; // NEW
            seen.add(id); // NEW
            if (isAssembly(cell) && assemblyType(cell) === "bed") beds.push(id); // NEW
            outgoingAssemblyEdges(moduleCell, cell).forEach(function (edge) { if (edge && edge.target) stack.push(edge.target); }); // NEW
            const internal = internalNeighborForPort(cell, "output"); // NEW
            if (internal) stack.push(internal); // NEW
        } // NEW
        return uniqueStrings(beds); // NEW
    } // NEW

    function syncZones(moduleCell) { // NEW
        return deriveZones(moduleCell); // CHANGE
    } // NEW

    function deriveZones(moduleCell) { // CHANGE
        const saved = readZoneOverrides(moduleCell); // CHANGE
        const savedById = new Map(saved.map(function (zone) { return [zone.id, zone]; })); // NEW
        const inferred = deriveInferredTimerZones(moduleCell); // NEW
        const inferredIds = new Set(inferred.map(function (zone) { return zone.id; })); // NEW
        const zones = inferred.map(function (zone) { // NEW
            const existing = savedById.get(zone.id); // NEW
            return normalizeZone(Object.assign({}, zone, { // NEW
                alias: existing ? existing.alias : zone.alias, // NEW
                pinnedBedIds: existing ? existing.pinnedBedIds : [], // NEW
                excludedBedIds: existing ? existing.excludedBedIds : [] // NEW
            })); // NEW
        }); // NEW
        saved.forEach(function (zone) { // NEW
            if (zone.originType === ZONE_ORIGIN_TIMER_OUTLET && inferredIds.has(zone.id)) return; // NEW
            zones.push(zone); // NEW
        }); // NEW
        return zones; // CHANGE
    } // CHANGE

    function zoneDisplayName(moduleCell, zone) { // NEW
        const z = normalizeZone(zone); // NEW
        if (z.alias) return z.alias; // NEW
        if (z.originType === ZONE_ORIGIN_TIMER_OUTLET) { // NEW
            const timer = findCellById(moduleCell, z.originCellId); // NEW
            return irrigationCellLabel(timer) + " outlet " + (finiteNumber(z.outletIndex, 0) + 1); // NEW
        } // NEW
        return "Manual zone"; // NEW
    } // NEW

    function allBedAssemblyIds(moduleCell) { // NEW
        return collectDescendants(moduleCell, function (cell) { return isAssembly(cell) && assemblyType(cell) === "bed"; }).map(getCellId).filter(Boolean); // NEW
    } // NEW

    function resolveEffectiveZoneMembership(moduleCell, zonesInput) { // NEW
        const zones = (zonesInput || readZones(moduleCell)).map(normalizeZone); // NEW
        const assignment = new Map(); // bedAssemblyId -> { zoneId, source } // NEW
        const ambiguousBedIds = new Set(); // NEW
        zones.forEach(function (zone) { // NEW
            zone.inferredBedIds.forEach(function (bedId) { // NEW
                if (zone.excludedBedIds.indexOf(bedId) >= 0) return; // NEW
                if (!assignment.has(bedId)) assignment.set(bedId, { zoneId: zone.id, source: "inferred" }); // NEW
                else if (assignment.get(bedId).source === "inferred" && assignment.get(bedId).zoneId !== zone.id) ambiguousBedIds.add(bedId); // NEW
            }); // NEW
        }); // NEW
        ambiguousBedIds.forEach(function (bedId) { assignment.delete(bedId); }); // NEW
        zones.forEach(function (zone) { // NEW
            zone.pinnedBedIds.forEach(function (bedId) { assignment.set(bedId, { zoneId: zone.id, source: "pinned" }); }); // NEW
        }); // NEW
        const byZoneId = new Map(zones.map(function (zone) { return [zone.id, []]; })); // NEW
        assignment.forEach(function (entry, bedId) { if (byZoneId.has(entry.zoneId)) byZoneId.get(entry.zoneId).push(bedId); }); // NEW
        return { assignment, byZoneId, ambiguousBedIds: Array.from(ambiguousBedIds).sort() }; // NEW
    } // NEW

    function selectedBedAssembliesFromCells(cells) { // NEW
        const out = []; // NEW
        const seen = new Set(); // NEW
        (cells || []).forEach(function (cell) { // NEW
            const assembly = isAssembly(cell) && assemblyType(cell) === "bed" ? cell : findAssemblyAncestor(cell); // NEW
            if (!assembly || assemblyType(assembly) !== "bed") return; // NEW
            const id = getCellId(assembly); // NEW
            if (!id || seen.has(id)) return; // NEW
            seen.add(id); // NEW
            out.push(assembly); // NEW
        }); // NEW
        return out; // NEW
    } // NEW

    function assignBedsToZone(moduleCell, zoneId, bedAssemblyIds) { // NEW
        const ids = uniqueStrings(bedAssemblyIds); // NEW
        const zones = deriveZones(moduleCell).map(function (zone) { // CHANGE
            const next = normalizeZone(zone); // NEW
            next.pinnedBedIds = next.pinnedBedIds.filter(function (id) { return ids.indexOf(id) < 0; }); // NEW
            next.excludedBedIds = uniqueStrings(next.excludedBedIds.concat(next.inferredBedIds.filter(function (id) { return ids.indexOf(id) >= 0 && next.id !== zoneId; }))); // NEW
            if (next.id === zoneId) { // NEW
                next.pinnedBedIds = uniqueStrings(next.pinnedBedIds.concat(ids)); // NEW
                next.excludedBedIds = next.excludedBedIds.filter(function (id) { return ids.indexOf(id) < 0; }); // NEW
            } // NEW
            return next; // NEW
        }); // NEW
        return writeZoneOverrides(moduleCell, zones); // CHANGE
    } // NEW

    function resetBedZoneOverrides(moduleCell, bedAssemblyIds) { // NEW
        const ids = uniqueStrings(bedAssemblyIds); // NEW
        const zones = deriveZones(moduleCell).map(function (zone) { // CHANGE
            const next = normalizeZone(zone); // NEW
            next.pinnedBedIds = next.pinnedBedIds.filter(function (id) { return ids.indexOf(id) < 0; }); // NEW
            next.excludedBedIds = next.excludedBedIds.filter(function (id) { return ids.indexOf(id) < 0; }); // NEW
            return next; // NEW
        }); // NEW
        return writeZoneOverrides(moduleCell, zones); // CHANGE
    } // NEW

    function createManualZone(moduleCell, alias, bedAssemblyIds) { // NEW
        const zones = deriveZones(moduleCell); // CHANGE
        const zone = normalizeZone({ id: manualZoneId(alias || "manual_zone"), originType: ZONE_ORIGIN_MANUAL, alias: alias || "Manual Zone", pinnedBedIds: uniqueStrings(bedAssemblyIds) }); // NEW
        zones.push(zone); // NEW
        writeZoneOverrides(moduleCell, zones); // CHANGE
        if (bedAssemblyIds && bedAssemblyIds.length) assignBedsToZone(moduleCell, zone.id, bedAssemblyIds); // NEW
        return zone; // NEW
    } // NEW

    function updateZoneAlias(moduleCell, zoneId, alias) { // NEW
        const zones = deriveZones(moduleCell).map(function (zone) { // CHANGE
            const next = normalizeZone(zone); // NEW
            if (next.id === zoneId) next.alias = String(alias || "").trim(); // NEW
            return next; // NEW
        }); // NEW
        return writeZoneOverrides(moduleCell, zones); // CHANGE
    } // NEW

    function resetZoneOverrides(moduleCell, zoneId) { // NEW
        const zones = deriveZones(moduleCell).map(function (zone) { // CHANGE
            const next = normalizeZone(zone); // NEW
            if (next.id === zoneId) { next.pinnedBedIds = []; next.excludedBedIds = []; } // NEW
            return next; // NEW
        }); // NEW
        return writeZoneOverrides(moduleCell, zones); // CHANGE
    } // NEW

    function zoneSummary(moduleCell, zonesInput, pathsInput) { // NEW
        const zones = zonesInput || deriveZones(moduleCell); // CHANGE
        const paths = pathsInput || deriveAssemblyPaths(moduleCell); // CHANGE
        const membership = resolveEffectiveZoneMembership(moduleCell, zones); // NEW
        const pathByTarget = new Map((paths || []).map(function (path) { return [path.targetEndpointId, path]; })); // NEW
        const allBeds = allBedAssemblyIds(moduleCell); // NEW
        const assignedBeds = new Set(); // NEW
        let worstZoneMarginPsi = null; // NEW
        const details = zones.map(function (zone) { // NEW
            const memberIds = (membership.byZoneId.get(zone.id) || []).sort(); // NEW
            memberIds.forEach(function (id) { assignedBeds.add(id); }); // NEW
            let demandGpm = 0; // NEW
            let worstMarginPsi = null; // NEW
            memberIds.forEach(function (bedAssemblyId) { // NEW
                const path = pathByTarget.get(bedAssemblyId); // NEW
                demandGpm += finiteNumber(path && path.bedDemand && path.bedDemand.flowGpm, 0); // NEW
                if (path && path.hydraulic && Number.isFinite(Number(path.hydraulic.marginPsi))) { // NEW
                    const margin = Number(path.hydraulic.marginPsi); // NEW
                    worstMarginPsi = worstMarginPsi == null ? margin : Math.min(worstMarginPsi, margin); // NEW
                } // NEW
            }); // NEW
            const origin = zone.originType === ZONE_ORIGIN_TIMER_OUTLET ? findCellById(moduleCell, zone.originCellId) : null; // NEW
            const sourceRoute = origin ? routeAssemblyToSource(moduleCell, origin) : null; // NEW
            const sourceProfile = sourceRoute && sourceRoute.source ? endpointProfile(sourceRoute.source) : null; // NEW
            const originPart = origin ? partForCell(moduleCell, origin) : null; // NEW
            const outletMax = originPart ? finiteNumber(originPart.connectors && originPart.connectors.output && originPart.connectors.output.maxFlowGpm, finiteNumber(originPart.specs && originPart.specs.maxFlowGpm, null)) : null; // NEW
            const sourceMax = sourceProfile ? finiteNumber(sourceProfile.usableFlowGpm, null) : null; // NEW
            const warnings = []; // NEW
            if (zone.originType === ZONE_ORIGIN_MANUAL && !origin) warnings.push("Manual zone is not linked to a timer outlet."); // NEW
            if (sourceMax != null && demandGpm > sourceMax) warnings.push("Zone demand exceeds source usable flow."); // NEW
            if (outletMax != null && demandGpm > outletMax) warnings.push("Zone demand exceeds timer outlet max flow."); // NEW
            if (worstMarginPsi != null && worstMarginPsi < 0) warnings.push("One or more zone paths have negative pressure margin."); // NEW
            if (worstMarginPsi != null) worstZoneMarginPsi = worstZoneMarginPsi == null ? worstMarginPsi : Math.min(worstZoneMarginPsi, worstMarginPsi); // NEW
            return { // NEW
                id: zone.id, // NEW
                name: zoneDisplayName(moduleCell, zone), // NEW
                originType: zone.originType, // NEW
                originCellId: zone.originCellId, // NEW
                outletIndex: zone.outletIndex, // NEW
                memberBedIds: memberIds, // NEW
                demandGpm, // NEW
                worstMarginPsi, // NEW
                status: !warnings.length ? "ok" : (zone.originType === ZONE_ORIGIN_MANUAL && !origin ? "unknown" : "warning"), // NEW
                warnings // NEW
            }; // NEW
        }); // NEW
        const unzonedBedIds = allBeds.filter(function (bedId) { return !assignedBeds.has(bedId); }).sort(); // NEW
        return { // NEW
            zones: details, // NEW
            zoneCount: details.length, // NEW
            emptyZoneCount: details.filter(function (zone) { return zone.memberBedIds.length === 0; }).length, // NEW
            unzonedBedCount: unzonedBedIds.length, // NEW
            unzonedBedIds, // NEW
            ambiguousBedIds: membership.ambiguousBedIds, // NEW
            overCapacityZoneCount: details.filter(function (zone) { return zone.status === "warning"; }).length, // NEW
            worstZoneMarginPsi // NEW
        }; // NEW
    } // NEW

    function formatMoney(value) {
        const n = finiteNumber(value, 0);
        return "$" + n.toFixed(n % 1 === 0 ? 0 : 2);
    }

    function openCatalogManager(moduleCell) {
        seedStarterCatalogIfEmpty(moduleCell);
        const state = { selectedId: "" };
        const div = document.createElement("div");
        div.className = "trellis-irrigation-catalog-manager";
        div.style.cssText = "width:900px;max-width:96vw;max-height:84vh;overflow:auto;font:12px Arial,sans-serif;padding:12px;";
        showDialog(div, 920, 620);
        renderCatalogManager(div, moduleCell, state);
    }

    function renderCatalogManager(container, moduleCell, state) {
        const catalog = readCatalog(moduleCell);
        if (!state.partDrafts) state.partDrafts = {}; // CHANGE
        if (!state.categoryFilter) state.categoryFilter = ""; // NEW
        if (!state.broadCategoryFilter) state.broadCategoryFilter = ""; // NEW
        if (!state.sizeFilter) state.sizeFilter = ""; // NEW
        if (!state.connectionFilter) state.connectionFilter = ""; // NEW
        if (!state.connectorTypeFilter) state.connectorTypeFilter = ""; // NEW
        const filterOptions = catalogFilterOptions(catalog); // NEW
        const visibleItems = sortCatalogParts(catalog.items.filter(function (part) { return catalogPartMatchesFilters(part, state); })); // CHANGE
        const catalogSelected = partById(catalog, state.selectedId) || visibleItems[0] || catalog.items[0] || makeBlankPart(catalog); // CHANGE
        const selected = normalizeCatalogPart(state.partDrafts[catalogSelected.id] || catalogSelected); // CHANGE
        state.selectedId = selected.id;
        container.innerHTML = "";

        const title = document.createElement("h2");
        title.textContent = "Irrigation Catalog";
        title.style.cssText = "font-size:16px;margin:0 0 10px;";
        container.appendChild(title);

        const filterRow = document.createElement("div"); // NEW
        filterRow.style.cssText = "display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap;"; // CHANGE
        const broadFilter = document.createElement("select"); // NEW
        broadFilter.className = "trellis-irrigation-catalog-broad-filter"; // NEW
        appendSelectOption(broadFilter, "", "All broad categories"); // NEW
        filterOptions.broadCategories.forEach(function (entry) { appendSelectOption(broadFilter, entry.id, entry.label); }); // NEW
        broadFilter.value = state.broadCategoryFilter; // NEW
        broadFilter.addEventListener("change", function () { state.broadCategoryFilter = broadFilter.value; state.selectedId = ""; renderCatalogManager(container, moduleCell, state); }); // NEW
        filterRow.appendChild(broadFilter); // NEW
        const categoryFilter = document.createElement("select"); // NEW
        categoryFilter.className = "trellis-irrigation-catalog-category-filter"; // NEW
        appendSelectOption(categoryFilter, "", "All categories"); // NEW
        PART_CATEGORIES.forEach(function (category) { appendSelectOption(categoryFilter, category, category.replace(/_/g, " ")); }); // NEW
        categoryFilter.value = state.categoryFilter; // NEW
        categoryFilter.addEventListener("change", function () { state.categoryFilter = categoryFilter.value; state.selectedId = ""; renderCatalogManager(container, moduleCell, state); }); // NEW
        filterRow.appendChild(categoryFilter); // NEW
        const sizeFilter = document.createElement("select"); // NEW
        sizeFilter.className = "trellis-irrigation-catalog-size-filter"; // NEW
        appendSelectOption(sizeFilter, "", "All sizes"); // NEW
        filterOptions.sizes.forEach(function (size) { appendSelectOption(sizeFilter, size, size); }); // NEW
        sizeFilter.value = state.sizeFilter; // NEW
        sizeFilter.addEventListener("change", function () { state.sizeFilter = sizeFilter.value; state.selectedId = ""; renderCatalogManager(container, moduleCell, state); }); // NEW
        filterRow.appendChild(sizeFilter); // NEW
        const connectorTypeFilter = document.createElement("select"); // NEW
        connectorTypeFilter.className = "trellis-irrigation-catalog-connector-type-filter"; // NEW
        appendSelectOption(connectorTypeFilter, "", "All connector types"); // NEW
        filterOptions.connectorTypes.forEach(function (type) { appendSelectOption(connectorTypeFilter, type, connectorTypeLabel(type)); }); // NEW
        connectorTypeFilter.value = state.connectorTypeFilter; // NEW
        connectorTypeFilter.addEventListener("change", function () { state.connectorTypeFilter = connectorTypeFilter.value; state.selectedId = ""; renderCatalogManager(container, moduleCell, state); }); // NEW
        filterRow.appendChild(connectorTypeFilter); // NEW
        const connectionFilter = document.createElement("select"); // NEW
        connectionFilter.className = "trellis-irrigation-catalog-connection-filter"; // NEW
        appendSelectOption(connectionFilter, "", "All connections"); // NEW
        filterOptions.connectionCounts.forEach(function (count) { appendSelectOption(connectionFilter, String(count), count + " connection" + (count === 1 ? "" : "s")); }); // NEW
        connectionFilter.value = state.connectionFilter; // NEW
        connectionFilter.addEventListener("change", function () { state.connectionFilter = connectionFilter.value; state.selectedId = ""; renderCatalogManager(container, moduleCell, state); }); // NEW
        filterRow.appendChild(connectionFilter); // NEW
        container.appendChild(filterRow); // NEW

        const layout = document.createElement("div");
        layout.style.cssText = "display:grid;grid-template-columns:minmax(280px,1fr) minmax(340px,1fr);gap:12px;align-items:start;";
        container.appendChild(layout);

        const tableWrap = document.createElement("div");
        const table = document.createElement("table");
        table.style.cssText = "width:100%;border-collapse:collapse;";
        table.innerHTML = "<thead><tr><th>Name</th><th>Broad</th><th>Category</th><th>Size</th><th>Connections</th><th>Stock</th><th>Status</th></tr></thead>"; // CHANGE
        const tbody = document.createElement("tbody");
        let lastCatalogGroup = ""; // NEW
        visibleItems.forEach(function (part) { // CHANGE
            const group = catalogGroupLabel(part); // NEW
            if (group !== lastCatalogGroup) { // NEW
                lastCatalogGroup = group; // NEW
                const groupRow = document.createElement("tr"); // NEW
                groupRow.className = "trellis-irrigation-catalog-group"; // NEW
                groupRow.innerHTML = "<td colspan=\"7\">" + html(group) + "</td>"; // CHANGE
                groupRow.children[0].style.cssText = "border:1px solid #bbb;padding:5px 6px;background:#eef2f7;font-weight:700;color:#1f2937;"; // NEW
                tbody.appendChild(groupRow); // NEW
            } // NEW
            const validation = validateCatalogPart(part);
            const tr = document.createElement("tr");
            tr.style.cursor = "pointer";
            tr.dataset.partId = part.id;
            if (part.id === state.selectedId) tr.style.background = "#e8f1ff";
            tr.innerHTML = "<td>" + html(part.name || part.id) + "</td><td>" + html(catalogBroadCategoryLabel(part)) + "</td><td>" + html(part.category) + "</td><td>" + html(catalogPartSizeLabel(part)) + "</td><td>" + html(catalogConnectionLabel(part)) + "</td><td>" + html(part.stockState) + "</td><td>" + html(validation.ok ? "Ready" : "Needs data") + "</td>"; // CHANGE
            Array.from(tr.children).forEach(function (td) { td.style.cssText = "border:1px solid #ccc;padding:4px;vertical-align:top;"; });
            tr.addEventListener("click", function () {
                state.selectedId = part.id;
                delete state.partDrafts[part.id]; // CHANGE
                renderCatalogManager(container, moduleCell, state);
            });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        tableWrap.appendChild(table);
        const addBtn = button("Add Part", function () {
            const next = makeBlankPart(catalog);
            upsertCatalogPart(moduleCell, next);
            state.selectedId = next.id;
            renderCatalogManager(container, moduleCell, state);
        });
        addBtn.className = "trellis-irrigation-add-part";
        tableWrap.appendChild(addBtn);
        layout.appendChild(tableWrap);

        const form = buildCatalogPartForm(selected, moduleCell, function (draft) { state.partDrafts[draft.id] = draft; state.selectedId = draft.id; renderCatalogManager(container, moduleCell, state); }); // CHANGE
        layout.appendChild(form.node);
        const validation = validateCatalogPart(selected);
        const status = document.createElement("div");
        status.className = "trellis-irrigation-catalog-status";
        status.style.cssText = "margin-top:8px;color:" + (validation.ok ? "#116611" : "#9a4b00") + ";";
        status.textContent = validation.ok ? "Ready for HUD use." : validation.errors.join(" "); // CHANGE
        form.node.appendChild(status);

        const controls = document.createElement("div");
        controls.style.cssText = "display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;";
        controls.appendChild(button("Save Part", function () {
            const next = readCatalogPartForm(form);
            upsertCatalogPart(moduleCell, next);
            delete state.partDrafts[next.id]; // CHANGE
            state.selectedId = next.id;
            renderCatalogManager(container, moduleCell, state);
        }));
        controls.appendChild(button("Delete Part", function () {
            deleteCatalogPart(moduleCell, selected.id);
            delete state.partDrafts[selected.id]; // CHANGE
            state.selectedId = "";
            renderCatalogManager(container, moduleCell, state);
        }));
        controls.appendChild(button("Close", hideDialog));
        form.node.appendChild(controls);
    }

    function makeBlankPart(catalog) {
        const id = nextCatalogPartId(catalog || { items: [] }, "pipe_tubing");
        return {
            id,
            name: "New irrigation part",
            category: "pipe_tubing",
            stockState: "unknown",
            cost: 1,
            unitCost: 1,
            connectors: {
                inputs: 1,
                outputs: 1,
                input: input("barb", "3/4", "", true), // CHANGE
                output: output("barb", "3/4", "", null, true) // CHANGE
            },
            specs: { innerDiameterIn: 0.75 } // CHANGE
        };
    }

    function buildCatalogPartForm(part, moduleCell, onCategoryChange) { // CHANGE
        const node = document.createElement("div");
        node.className = "trellis-irrigation-catalog-form";
        node.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px;";
        const fields = {};
        const connectorOptions = catalogConnectorOptions(moduleCell); // NEW
        fields.id = { value: part.id }; // CHANGE
        fields.name = addTextField(node, "Name", part.name);
        fields.category = addSelectField(node, "Category", PART_CATEGORIES, part.category);
        fields.category.addEventListener("change", function () { if (onCategoryChange) onCategoryChange(readCatalogPartForm({ fields })); }); // CHANGE
        fields.stockState = addSelectField(node, "Stock", VALID_STOCK_STATES, part.stockState);
        fields.cost = addTextField(node, "Cost", part.cost);
        if (unitCostAppliesToCategory(part.category)) fields.unitCost = addTextField(node, "Unit cost per ft", part.unitCost); // CHANGE
        fields.inputs = addTextField(node, "Inputs", part.connectors.inputs);
        fields.outputs = addTextField(node, "Outputs", part.connectors.outputs);
        fields.inputType = addSelectField(node, "Input type", ensureOptionValue(connectorOptions.types, part.connectors.input.type), part.connectors.input.type); // CHANGE
        fields.inputSize = addSelectField(node, "Input size", ensureOptionValue(connectorOptions.sizes, part.connectors.input.nominalSize), part.connectors.input.nominalSize); // CHANGE
        fields.inputPipeConnection = addCheckboxField(node, "Input uses pipe", part.connectors.input.pipeConnection); // CHANGE
        fields.outputType = addSelectField(node, "Output type", ensureOptionValue(connectorOptions.types, part.connectors.output.type), part.connectors.output.type); // CHANGE
        fields.outputSize = addSelectField(node, "Output size", ensureOptionValue(connectorOptions.sizes, part.connectors.output.nominalSize), part.connectors.output.nominalSize); // CHANGE
        fields.outputPipeConnection = addCheckboxField(node, "Output uses pipe", part.connectors.output.pipeConnection); // CHANGE
        fields.maxFlowGpm = addTextField(node, "Max flow gpm", part.connectors.output.maxFlowGpm || part.specs.maxFlowGpm || "");
        fields.pressureLossPsi = addTextField(node, "Pressure loss psi", part.specs.pressureLossPsi || "");
        fields.flowGpm = addTextField(node, "Part flow gpm", part.specs.flowGpm || "");
        fields.minOperatingPressurePsi = addTextField(node, "Min operating psi", part.specs.minOperatingPressurePsi || ""); // CHANGE
        fields.maxOperatingPressurePsi = addTextField(node, "Max operating psi", part.specs.maxOperatingPressurePsi || ""); // CHANGE
        if (part.category === "pipe_tubing") fields.innerDiameterIn = addTextField(node, "Pipe inner diameter in", part.specs.innerDiameterIn || ""); // CHANGE
        return { node, fields };
    }

    function readCatalogPartForm(form) {
        const maxFlowGpm = finiteNumber(form.fields.maxFlowGpm.value, null);
        const category = form.fields.category.value; // CHANGE
        return normalizeCatalogPart({
            id: sanitizeId(form.fields.id.value) || "part",
            name: form.fields.name.value.trim(),
            category, // CHANGE
            stockState: form.fields.stockState.value,
            cost: finiteNumber(form.fields.cost.value, 0),
            unitCost: unitCostAppliesToCategory(category) && form.fields.unitCost ? finiteNumber(form.fields.unitCost.value, finiteNumber(form.fields.cost.value, 0)) : null, // CHANGE
            connectors: {
                inputs: finiteNumber(form.fields.inputs.value, 0),
                outputs: finiteNumber(form.fields.outputs.value, 0),
                input: { type: form.fields.inputType.value.trim(), nominalSize: form.fields.inputSize.value.trim(), pipeConnection: form.fields.inputPipeConnection.checked }, // CHANGE
                output: { type: form.fields.outputType.value.trim(), nominalSize: form.fields.outputSize.value.trim(), maxFlowGpm, pipeConnection: form.fields.outputPipeConnection.checked } // CHANGE
            },
            specs: {
                maxFlowGpm,
                pressureLossPsi: finiteNumber(form.fields.pressureLossPsi.value, null),
                flowGpm: finiteNumber(form.fields.flowGpm.value, null),
                minOperatingPressurePsi: finiteNumber(form.fields.minOperatingPressurePsi.value, null), // CHANGE
                maxOperatingPressurePsi: finiteNumber(form.fields.maxOperatingPressurePsi.value, null), // CHANGE
                innerDiameterIn: category === "pipe_tubing" && form.fields.innerDiameterIn ? finiteNumber(form.fields.innerDiameterIn.value, null) : null // CHANGE
            }
        });
    }

    function addTextField(parent, label, value) {
        const wrap = document.createElement("label");
        wrap.style.cssText = "display:flex;flex-direction:column;gap:3px;";
        wrap.textContent = label;
        const input = document.createElement("input");
        input.value = value == null ? "" : String(value);
        input.style.cssText = "padding:4px;border:1px solid #aaa;border-radius:4px;";
        wrap.appendChild(input);
        parent.appendChild(wrap);
        return input;
    }

    function addCheckboxField(parent, label, value) { // NEW
        const wrap = document.createElement("label"); // NEW
        wrap.style.cssText = "display:flex;align-items:center;gap:6px;"; // NEW
        const input = document.createElement("input"); // NEW
        input.type = "checkbox"; // NEW
        input.checked = !!value; // NEW
        wrap.appendChild(input); // NEW
        wrap.appendChild(document.createTextNode(label)); // NEW
        parent.appendChild(wrap); // NEW
        return input; // NEW
    } // NEW

    function addSelectField(parent, label, values, value) {
        const wrap = document.createElement("label");
        wrap.style.cssText = "display:flex;flex-direction:column;gap:3px;";
        wrap.textContent = label;
        const select = document.createElement("select");
        values.forEach(function (entry) {
            const option = document.createElement("option");
            option.value = entry;
            option.textContent = connectorTypeLabel(entry); // CHANGE
            select.appendChild(option);
        });
        select.value = value;
        select.style.cssText = "padding:4px;border:1px solid #aaa;border-radius:4px;";
        wrap.appendChild(select);
        parent.appendChild(wrap);
        return select;
    }

    function catalogConnectorOptions(moduleCell) { // NEW
        const types = new Set(FIXED_CONNECTOR_TYPES); // NEW
        const sizes = new Set(FIXED_CONNECTOR_SIZES); // NEW
        readCatalog(moduleCell).items.map(normalizeCatalogPart).forEach(function (part) { // NEW
            if (!part || !part.connectors) return; // NEW
            [part.connectors.input, part.connectors.output].forEach(function (connector) { // NEW
                if (!connector) return; // NEW
                if (connector.type) types.add(connector.type); // NEW
                if (connector.nominalSize) sizes.add(connector.nominalSize); // NEW
            }); // NEW
        }); // NEW
        return { // NEW
            types: Array.from(types).sort(function (a, b) { return String(a).localeCompare(String(b)); }), // NEW
            sizes: Array.from(sizes).sort(compareNominalSize) // NEW
        }; // NEW
    } // NEW

    function compareNominalSize(a, b) { // NEW
        return nominalSizeNumber(a) - nominalSizeNumber(b) || String(a).localeCompare(String(b)); // NEW
    } // NEW

    function nominalSizeNumber(value) { // NEW
        const text = String(value || ""); // NEW
        const parts = text.split("/"); // NEW
        if (parts.length === 2) return finiteNumber(parts[0], 0) / Math.max(1, finiteNumber(parts[1], 1)); // NEW
        return finiteNumber(text, 999); // NEW
    } // NEW

    function ensureOptionValue(values, value) { // NEW
        const out = (values || []).slice(); // NEW
        if (value != null && value !== "" && out.indexOf(value) < 0) out.push(value); // NEW
        return out; // NEW
    } // NEW

    function broadCategoryForCatalogCategory(category) { // NEW
        const match = BROAD_CATALOG_CATEGORIES.find(function (entry) { return entry.categories.indexOf(category) >= 0; }); // NEW
        return match || { id: "other", label: "Other", categories: [] }; // NEW
    } // NEW

    function catalogBroadCategoryLabel(part) { // NEW
        return broadCategoryForCatalogCategory(normalizeCatalogPart(part).category).label; // NEW
    } // NEW

    function catalogPartSizes(part) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        const sizes = new Set(); // NEW
        if (p.connectors && p.connectors.input && p.connectors.input.nominalSize) sizes.add(p.connectors.input.nominalSize); // NEW
        if (p.connectors && p.connectors.output && p.connectors.output.nominalSize) sizes.add(p.connectors.output.nominalSize); // NEW
        return Array.from(sizes).sort(compareNominalSize); // NEW
    } // NEW

    function catalogPartSizeLabel(part) { // NEW
        const sizes = catalogPartSizes(part); // NEW
        return sizes.length ? sizes.join(", ") : "none"; // NEW
    } // NEW

    function catalogPartConnectorTypes(part) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        const types = new Set(); // NEW
        if (p.connectors && p.connectors.input && p.connectors.input.type) types.add(p.connectors.input.type); // NEW
        if (p.connectors && p.connectors.output && p.connectors.output.type) types.add(p.connectors.output.type); // NEW
        return Array.from(types).sort(function (a, b) { return String(a).localeCompare(String(b)); }); // NEW
    } // NEW

    function catalogPartConnectorTypeLabel(part) { // NEW
        const types = catalogPartConnectorTypes(part); // NEW
        return types.length ? types.map(connectorTypeLabel).join(", ") : "none"; // NEW
    } // NEW

    function catalogPartConnectionCount(part) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        return Math.max(0, finiteNumber(p.connectors && p.connectors.inputs, 0)) + Math.max(0, finiteNumber(p.connectors && p.connectors.outputs, 0)); // NEW
    } // NEW

    function catalogConnectionLabel(part) { // NEW
        const count = catalogPartConnectionCount(part); // NEW
        return count + " total"; // NEW
    } // NEW

    function catalogFilterOptions(catalog) { // NEW
        const broadIds = new Set(); // NEW
        const sizes = new Set(); // NEW
        const connectorTypes = new Set(FIXED_CONNECTOR_TYPES); // NEW
        const connectionCounts = new Set(); // NEW
        (catalog.items || []).map(normalizeCatalogPart).forEach(function (part) { // NEW
            if (!part) return; // NEW
            broadIds.add(broadCategoryForCatalogCategory(part.category).id); // NEW
            catalogPartSizes(part).forEach(function (size) { sizes.add(size); }); // NEW
            catalogPartConnectorTypes(part).forEach(function (type) { connectorTypes.add(type); }); // NEW
            connectionCounts.add(catalogPartConnectionCount(part)); // NEW
        }); // NEW
        return { // NEW
            broadCategories: BROAD_CATALOG_CATEGORIES.concat([{ id: "other", label: "Other", categories: [] }]).filter(function (entry) { return broadIds.has(entry.id); }), // NEW
            sizes: Array.from(sizes).sort(compareNominalSize), // NEW
            connectorTypes: Array.from(connectorTypes).sort(function (a, b) { return String(a).localeCompare(String(b)); }), // NEW
            connectionCounts: Array.from(connectionCounts).sort(function (a, b) { return a - b; }) // NEW
        }; // NEW
    } // NEW

    function catalogPartMatchesFilters(part, state) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        if (state.categoryFilter && p.category !== state.categoryFilter) return false; // NEW
        if (state.broadCategoryFilter && broadCategoryForCatalogCategory(p.category).id !== state.broadCategoryFilter) return false; // NEW
        if (state.sizeFilter && catalogPartSizes(p).indexOf(state.sizeFilter) < 0) return false; // NEW
        if (state.connectorTypeFilter && catalogPartConnectorTypes(p).indexOf(state.connectorTypeFilter) < 0) return false; // NEW
        if (state.connectionFilter && String(catalogPartConnectionCount(p)) !== String(state.connectionFilter)) return false; // NEW
        return true; // NEW
    } // NEW

    function catalogPartSortKey(part) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        const size = p && p.connectors && p.connectors.output && p.connectors.output.nominalSize || p && p.connectors && p.connectors.input && p.connectors.input.nominalSize || ""; // NEW
        return { category: p && p.category || "", size, name: p && p.name || p && p.id || "" }; // NEW
    } // NEW

    function catalogGroupLabel(part) { // NEW
        const key = catalogPartSortKey(part); // NEW
        return (key.category || "uncategorized").replace(/_/g, " ") + " / " + (key.size || "no output size"); // NEW
    } // NEW

    function sortCatalogParts(parts) { // NEW
        return (parts || []).slice().sort(function (a, b) { // NEW
            const ka = catalogPartSortKey(a); // NEW
            const kb = catalogPartSortKey(b); // NEW
            return ka.category.localeCompare(kb.category) || compareNominalSize(ka.size, kb.size) || ka.name.localeCompare(kb.name); // NEW
        }); // NEW
    } // NEW

    function openIrrigationMode(moduleCell, options) { // NEW
        const selection = graph.getSelectionCell && graph.getSelectionCell(); // NEW
        const targetModule = moduleCell || findGardenModuleAncestor(selection) || selection; // NEW
        irrigationDebug("openIrrigationMode:start", { // NEW
            selection: debugCellSummary(selection), // NEW
            requestedModule: debugCellSummary(moduleCell), // NEW
            targetModule: debugCellSummary(targetModule), // NEW
            options: options || {} // NEW
        }); // NEW
        if (!targetModule || !isGardenModule(targetModule)) { // NEW
            irrigationDebug("openIrrigationMode:invalid-module", { targetModule: debugCellSummary(targetModule) }); // NEW
            alertUser("Select a Trellis garden module first."); // NEW
            return null; // NEW
        } // NEW
        seedStarterCatalogIfEmpty(targetModule); // NEW
        closeWizardSessionForModeSwitch(); // NEW
        closeIrrigationMode(); // NEW
        removeHudNode(inactiveEntryOverlay); // NEW
        inactiveEntryOverlay = null; // NEW
        activeIrrigationMode = { // NEW
            moduleCell: targetModule, // NEW
            hud: null, // NEW
            navigator: [], // NEW
            targetHighlights: [], // NEW
            warningBadges: [], // NEW
            portBadges: [], // NEW
            zoneBadges: [], // NEW
            selectedPorts: [], // NEW
            selectedBoundaries: [], // NEW
            lastModelPoint: null, // NEW
            partPickerVisible: false, // NEW
            bedAssemblyPickerVisible: false, // NEW
            sourceFormVisible: !!(options && options.sourceForm), // NEW
            message: "", // NEW
            listeners: [] // NEW
        }; // NEW
        installIrrigationModeListeners(activeIrrigationMode); // NEW
        if (options && options.selectCell) selectCell(options.selectCell, false); // NEW
        if (options && options.message) activeIrrigationMode.message = options.message; // NEW
        if (options && options.preserveViewport) irrigationDebug("openIrrigationMode:preserve-viewport", { targetModule: debugCellSummary(targetModule) }); // NEW
        else { // NEW
            try { // NEW
                frameIrrigationWorkspace(targetModule); // NEW
            } catch (err) { // NEW
                irrigationDebug("openIrrigationMode:frame-error", { message: err && err.message, stack: err && err.stack }); // NEW
            } // NEW
        } // CHANGE
        renderIrrigationMode(activeIrrigationMode); // NEW
        scheduleIrrigationDebugSnapshot(activeIrrigationMode, "openIrrigationMode:post-render-async"); // NEW
        return activeIrrigationMode; // NEW
    } // NEW

    function closeIrrigationMode() { // NEW
        const session = activeIrrigationMode; // NEW
        if (!session) return; // NEW
        removeHudNode(session.hud); // NEW
        session.hud = null; // NEW
        removeNodeList(session.navigator); // NEW
        removeNodeList(session.targetHighlights); // NEW
        removeNodeList(session.warningBadges); // NEW
        removeNodeList(session.portBadges); // NEW
        removeNodeList(session.zoneBadges); // NEW
        removeIrrigationModeListeners(session); // NEW
        activeIrrigationMode = null; // NEW
        scheduleInactiveEntryOverlayRefresh(); // NEW
    } // NEW

    function closeWizardSessionForModeSwitch() { // NEW
        hideDialog(); // NEW
    } // NEW

    function installIrrigationModeListeners(session) { // NEW
        const selectionModel = graph.getSelectionModel && graph.getSelectionModel(); // NEW
        if (selectionModel && selectionModel.addListener && typeof mxEvent !== "undefined") { // NEW
            const listener = function () { renderIrrigationMode(session); }; // NEW
            selectionModel.addListener(mxEvent.CHANGE, listener); // NEW
            session.listeners.push({ target: selectionModel, event: mxEvent.CHANGE, listener }); // NEW
        } // NEW
        if (graph.addListener && typeof mxEvent !== "undefined") { // NEW
            const mouseListener = function (_, evt) { // NEW
                updateSessionPointerFromMxEvent(session, evt); // NEW
            }; // NEW
            graph.addListener(mxEvent.CLICK, mouseListener); // NEW
            session.listeners.push({ target: graph, event: mxEvent.CLICK, listener: mouseListener }); // NEW
            const edgeAddListener = function (_, evt) { normalizeAddedIrrigationEdges(session, evt && evt.getProperty && evt.getProperty("cells") || []); }; // NEW
            [mxEvent.CELLS_ADDED, mxEvent.ADD_CELLS].forEach(function (eventName) { // NEW
                if (!eventName) return; // NEW
                graph.addListener(eventName, edgeAddListener); // NEW
                session.listeners.push({ target: graph, event: eventName, listener: edgeAddListener }); // NEW
            }); // NEW
            const cellRemoveListener = function (_, evt) { handleRemovedIrrigationCells(session, evt && evt.getProperty && evt.getProperty("cells") || []); }; // NEW
            [mxEvent.CELLS_REMOVED, mxEvent.REMOVE_CELLS].forEach(function (eventName) { // NEW
                if (!eventName) return; // NEW
                graph.addListener(eventName, cellRemoveListener); // NEW
                session.listeners.push({ target: graph, event: eventName, listener: cellRemoveListener }); // NEW
            }); // NEW
        } // NEW
        if (graph.addMouseListener) { // NEW
            const mouseListener = { // NEW
                mouseDown: function (_, evt) { updateSessionPointerFromMouseEvent(session, evt); }, // CHANGE
                mouseMove: function (_, evt) { updateSessionPointerFromMouseEvent(session, evt); }, // CHANGE
                mouseUp: function (_, evt) { // NEW
                    updateSessionPointerFromMouseEvent(session, evt); // NEW
                } // NEW
            }; // NEW
            graph.addMouseListener(mouseListener); // NEW
            session.listeners.push({ target: graph, mouseListener }); // NEW
        } // NEW
        const view = graph.view; // NEW
        if (view && view.addListener && typeof mxEvent !== "undefined") { // NEW
            const viewListener = function () { renderIrrigationMode(session); }; // NEW
            [mxEvent.SCALE, mxEvent.TRANSLATE, mxEvent.SCALE_AND_TRANSLATE].forEach(function (eventName) { // NEW
                if (!eventName) return; // NEW
                view.addListener(eventName, viewListener); // NEW
                session.listeners.push({ target: view, event: eventName, listener: viewListener }); // NEW
            }); // NEW
        } // NEW
    } // NEW

    function removeIrrigationModeListeners(session) { // NEW
        (session.listeners || []).forEach(function (entry) { // NEW
            if (entry.mouseListener && entry.target && entry.target.removeMouseListener) entry.target.removeMouseListener(entry.mouseListener); // NEW
            if (entry.listener && entry.target && entry.target.removeListener) entry.target.removeListener(entry.listener); // CHANGE
        }); // NEW
        session.listeners = []; // NEW
    } // NEW

    function resolveGraphClickCell(evt) { // NEW
        if (!evt) return null; // NEW
        if (evt.getProperty) { // NEW
            const cell = evt.getProperty("cell"); // NEW
            if (cell) return cell; // NEW
            return resolveDomEventCell(evt.getProperty("event")); // NEW
        } // NEW
        return resolveMouseEventCell(evt); // NEW
    } // NEW

    function resolveMouseEventCell(evt) { // NEW
        if (!evt) return null; // NEW
        if (evt.getCell) return evt.getCell(); // NEW
        if (evt.getState && evt.getState()) return evt.getState().cell || null; // NEW
        return resolveDomEventCell(evt.getEvent && evt.getEvent()); // NEW
    } // NEW

    function resolveDomEventCell(domEvent) { // NEW
        if (!domEvent || !graph.getCellAt || !graph.container || typeof mxUtils === "undefined" || !mxUtils.convertPoint || typeof mxEvent === "undefined") return null; // NEW
        const point = mxUtils.convertPoint(graph.container, mxEvent.getClientX(domEvent), mxEvent.getClientY(domEvent)); // NEW
        return graph.getCellAt(point.x, point.y); // NEW
    } // NEW

    function updateSessionPointerFromMxEvent(session, evt) { // NEW
        if (!evt || !evt.getProperty) return; // NEW
        updateSessionPointerFromDomEvent(session, evt.getProperty("event")); // NEW
    } // NEW

    function updateSessionPointerFromMouseEvent(session, evt) { // NEW
        if (!evt) return; // NEW
        updateSessionPointerFromDomEvent(session, evt.getEvent ? evt.getEvent() : evt); // NEW
    } // NEW

    function updateSessionPointerFromDomEvent(session, domEvent) { // NEW
        if (!session || !domEvent || typeof mxUtils === "undefined" || typeof mxEvent === "undefined" || !graph.container) return; // NEW
        const pt = mxUtils.convertPoint(graph.container, mxEvent.getClientX(domEvent), mxEvent.getClientY(domEvent)); // NEW
        const scale = finiteNumber(graph.view && graph.view.scale, 1) || 1; // NEW
        const translate = graph.view && graph.view.translate ? graph.view.translate : { x: 0, y: 0 }; // NEW
        const modelPoint = { x: pt.x / scale - finiteNumber(translate.x, 0), y: pt.y / scale - finiteNumber(translate.y, 0) }; // NEW
        session.lastModelPoint = modelPointToModulePoint(session.moduleCell, modelPoint); // NEW
    } // NEW

    function modelPointToModulePoint(moduleCell, modelPoint) { // NEW
        const moduleBounds = cellBoundsInModel(moduleCell) || { x: 0, y: 0 }; // NEW
        return { x: Math.max(0, Math.round(finiteNumber(modelPoint && modelPoint.x, 24) - finiteNumber(moduleBounds.x, 0))), y: Math.max(0, Math.round(finiteNumber(modelPoint && modelPoint.y, 72) - finiteNumber(moduleBounds.y, 0))) }; // NEW
    } // NEW

    function defaultAssemblyAnchor(session) { // NEW
        if (session && session.lastModelPoint) return session.lastModelPoint; // NEW
        const moduleGeo = getGeometry(session && session.moduleCell) || {}; // NEW
        return { x: Math.max(24, finiteNumber(moduleGeo.width, 400) / 2 - ASSEMBLY_DEFAULT_WIDTH / 2), y: 72 }; // NEW
    } // NEW

    function currentSelectionCells() { // NEW
        return graph.getSelectionCells ? (graph.getSelectionCells() || []) : (graph.getSelectionCell && graph.getSelectionCell() ? [graph.getSelectionCell()] : []); // NEW
    } // NEW

    function selectedAssemblyContextCells() { // NEW
        const seen = new Set(); // NEW
        const out = []; // NEW
        currentSelectionCells().forEach(function (cell) { // NEW
            if (!isAssemblyModeObject(cell)) return; // NEW
            const id = getCellId(cell); // NEW
            if (!id || seen.has(id)) return; // NEW
            seen.add(id); // NEW
            out.push(cell); // NEW
        }); // NEW
        return out; // NEW
    } // NEW

    function renderIrrigationMode(session) { // NEW
        if (!session || activeIrrigationMode !== session) return; // NEW
        removeHudNode(session.hud); // NEW
        removeNodeList(session.navigator); // NEW
        removeNodeList(session.targetHighlights); // NEW
        removeNodeList(session.warningBadges); // NEW
        removeNodeList(session.portBadges); // NEW
        removeNodeList(session.zoneBadges); // NEW

        const selected = graph.getSelectionCell && graph.getSelectionCell(); // NEW
        const assemblySelection = selectedAssemblyContextCells(); // NEW
        const hud = document.createElement("div"); // NEW
        hud.className = "trellis-irrigation-mode-hud"; // NEW
        hud.style.cssText = "position:absolute;z-index:1000;min-width:220px;max-width:360px;background:#fff;border:1px solid #777;border-radius:6px;box-shadow:0 3px 12px rgba(0,0,0,.22);padding:8px;font:12px Arial,sans-serif;color:#222;display:flex;flex-direction:column;gap:6px;"; // CHANGE
        if (assemblySelection.length) renderLocalIrrigationHud(session, hud, assemblySelection); // CHANGE
        else if (isGardenBed(selected)) renderGardenBedHud(session, hud, selected); // NEW
        else renderModuleIrrigationHud(session, hud); // NEW
        appendOverlayNode(hud); // NEW
        session.hud = hud; // NEW
        positionHudForSelection(hud, selected, session); // CHANGE
        irrigationDebug("renderIrrigationMode:hud", { // NEW
            selected: debugCellSummary(selected), // NEW
            isLocal: !!assemblySelection.length || isGardenBed(selected), // CHANGE
            className: hud.className, // NEW
            left: hud.style.left, // NEW
            top: hud.style.top, // NEW
            overlayHost: debugOverlayHostSummary() // NEW
        }); // NEW
        renderAssemblyPortBadges(session, assemblySelection); // CHANGE
        renderZoneBadges(session); // NEW
        if (isHudIrrigationObject(selected)) renderIrrigationNavigator(session, selected); // NEW
        renderIrrigationWarningBadges(session); // NEW
    } // NEW

    function renderModuleIrrigationHud(session, hud) { // NEW
        hud.className += " trellis-irrigation-module-hud"; // NEW
        hud.appendChild(hudTitle("Irrigation Mode")); // NEW
        appendHudStatus(hud, session); // NEW
        const actions = hudActions(); // NEW
        actions.appendChild(button("Create Source", function () { // NEW
            session.sourceFormVisible = true; // NEW
            session.partPickerVisible = false; // NEW
            renderIrrigationMode(session); // NEW
        })); // NEW
        actions.appendChild(button("Add Part", function () { // NEW
            session.partPickerVisible = true; // NEW
            session.sourceFormVisible = false; // NEW
            renderIrrigationMode(session); // NEW
        })); // NEW
        actions.appendChild(button("Zones", function () { openZoneManager(session.moduleCell, session); })); // NEW
        actions.appendChild(button("Catalog", function () { openCatalogManager(session.moduleCell); })); // NEW
        actions.appendChild(button("Report", function () { syncHudGraphState(session.moduleCell); session.message = "Report updated."; renderIrrigationMode(session); })); // NEW
        actions.appendChild(button("Exit", closeIrrigationMode)); // NEW
        hud.appendChild(actions); // NEW
        if (session.sourceFormVisible) renderSourceForm(session, hud); // NEW
        if (session.partPickerVisible) renderAddPartAssemblyForm(session, hud); // NEW
        appendModuleSummary(session, hud); // NEW
    } // NEW

    function renderSourceSelector(session, hud) { // NEW
        const sources = collectHudEndpoints(session.moduleCell, "source"); // NEW
        if (!sources.length) return; // NEW
        const wrap = document.createElement("label"); // NEW
        wrap.style.cssText = "display:flex;flex-direction:column;gap:3px;margin:6px 0;"; // NEW
        wrap.textContent = "Select Source"; // NEW
        const select = document.createElement("select"); // NEW
        select.className = "trellis-irrigation-source-picker"; // NEW
        appendSelectOption(select, "", "Choose source"); // NEW
        sources.forEach(function (source) { appendSelectOption(select, getCellId(source), endpointLabel(source)); }); // NEW
        select.addEventListener("change", function () { // NEW
            const source = findCellById(session.moduleCell, select.value); // NEW
            if (!source) return; // NEW
            selectCell(source, false); // NEW
            renderIrrigationMode(session); // NEW
        }); // NEW
        wrap.appendChild(select); // NEW
        hud.appendChild(wrap); // NEW
    } // NEW

    function renderGardenBedHud(session, hud, bedCell) { // NEW
        hud.appendChild(hudTitle("Garden Bed")); // NEW
        appendHudStatus(hud, session); // NEW
        hud.appendChild(hudText("Create a bed assembly for template-driven irrigation estimates.")); // CHANGE
        const actions = hudActions(); // NEW
        actions.appendChild(button("Create Bed Assembly", function () { // CHANGE
            const created = createBedAssembly(session.moduleCell, bedCell, defaultAssemblyAnchor(session)); // CHANGE
            selectCell(created.assembly, false); // CHANGE
            scheduleHudGraphStateSync(session.moduleCell); // CHANGE
            renderIrrigationMode(session); // NEW
        })); // NEW
        actions.appendChild(button("Catalog", function () { openCatalogManager(session.moduleCell); })); // NEW
        actions.appendChild(button("Exit", closeIrrigationMode)); // NEW
        hud.appendChild(actions); // NEW
    } // NEW

    function renderLocalIrrigationHud(session, hud, cells) { // CHANGE
        const selected = cells || []; // NEW
        const primary = selected[0]; // NEW
        const primaryAssembly = isAssembly(primary) ? primary : findAssemblyAncestor(primary); // NEW
        hud.className += " trellis-irrigation-local-hud"; // CHANGE
        hud.appendChild(hudTitle(selected.length > 1 ? selected.length + " irrigation selections" : irrigationCellLabel(primary))); // CHANGE
        appendHudStatus(hud, session); // NEW
        const warning = primary && !isAssembly(primary) ? cellWarning(session.moduleCell, primary) : ""; // CHANGE
        if (warning) hud.appendChild(hudWarning(warning)); // NEW
        if (primary && endpointType(primary) === "source") renderSourceEditFields(session, hud, primary); // CHANGE
        if ((primary && endpointType(primary) === "bed") || (primaryAssembly && assemblyType(primaryAssembly) === "bed")) renderBedInletFields(session, hud, primaryAssembly || findAssemblyAncestor(primary)); // CHANGE
        renderSelectedZoneControls(session, hud, selected); // NEW
        renderSelectedConnectionRows(session, hud, selected); // NEW
        renderSelectedConnectionActions(session, hud); // CHANGE
        if (session.partPickerVisible) renderAddPartAssemblyForm(session, hud); // NEW
        const actions = hudActions(); // NEW
        actions.appendChild(button("Add Part", function () { session.partPickerVisible = !session.partPickerVisible; renderIrrigationMode(session); })); // NEW
        if (primaryAssembly && assemblyCanReverse(session.moduleCell, primaryAssembly)) actions.appendChild(button("Reverse Assembly", function () { reverseAssembly(primaryAssembly); scheduleHudGraphStateSync(session.moduleCell); renderIrrigationMode(session); })); // CHANGE
        actions.appendChild(button("Zones", function () { openZoneManager(session.moduleCell, session); })); // NEW
        actions.appendChild(button("Catalog", function () { openCatalogManager(session.moduleCell); })); // NEW
        actions.appendChild(button("Delete", function () { deleteAssemblySelection(session, selected); })); // CHANGE
        actions.appendChild(button("Exit", closeIrrigationMode)); // NEW
        hud.appendChild(actions); // NEW
    } // NEW

    function renderSourceForm(session, hud) { // NEW
        const form = document.createElement("div"); // NEW
        form.className = "trellis-irrigation-source-form"; // NEW
        form.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px;"; // NEW
        const label = addTextField(form, "Label", "Water Source " + (collectHudEndpoints(session.moduleCell, "source").length + 1)); // NEW
        const connectorOptions = catalogConnectorOptions(session.moduleCell); // NEW
        const type = addSelectField(form, "Connector", ensureOptionValue(connectorOptions.types, "barb"), "barb"); // CHANGE
        const size = addSelectField(form, "Size", ensureOptionValue(connectorOptions.sizes, "3/4"), "3/4"); // CHANGE
        const pipeConnection = addCheckboxField(form, "Uses pipe", true); // CHANGE
        const flow = addTextField(form, "Flow gpm", "5"); // NEW
        const pressure = addTextField(form, "Static psi", "45"); // NEW
        const commit = button("Commit Source", function () { // NEW
            const created = createSourceAssembly(session.moduleCell, label.value.trim() || "Water Source", { // CHANGE
                connectorType: type.value.trim(), // NEW
                nominalSize: size.value.trim(), // NEW
                pipeConnection: pipeConnection.checked, // CHANGE
                usableFlowGpm: finiteNumber(flow.value, 5), // NEW
                staticPressurePsi: finiteNumber(pressure.value, 45) // NEW
            }, defaultAssemblyAnchor(session)); // CHANGE
            session.sourceFormVisible = false; // NEW
            selectCell(created.assembly, false); // CHANGE
            scheduleHudGraphStateSync(session.moduleCell); // CHANGE
            renderIrrigationMode(session); // NEW
        }); // NEW
        commit.className = "trellis-irrigation-commit-source"; // NEW
        form.appendChild(commit); // NEW
        hud.appendChild(form); // NEW
    } // NEW

    function renderAddPartAssemblyForm(session, hud) { // NEW
        const form = document.createElement("div"); // NEW
        form.className = "trellis-irrigation-add-assembly-form"; // NEW
        form.style.cssText = "display:grid;gap:6px;margin-top:8px;"; // NEW
        const context = addPartPickerContext(session); // NEW
        form.appendChild(hudText(context ? "Compatible with " + addPartContextLabel(session.moduleCell, context) : "All catalog parts")); // NEW
        const select = document.createElement("select"); // NEW
        select.className = "trellis-irrigation-add-part-picker"; // NEW
        appendGroupedPartOptions(select, addPartPickerParts(session, context)); // CHANGE
        form.appendChild(select); // NEW
        form.appendChild(button("Add Part", function () { // NEW
            const part = partById(readCatalog(session.moduleCell), select.value); // NEW
            if (!part) { session.message = "Choose a catalog part."; renderIrrigationMode(session); return; } // NEW
            const result = context ? applyConnectionPartChoice(session.moduleCell, context.row, part) : null; // NEW
            if (context && (!result || !result.cell)) { session.message = result && result.message || "Part could not be added at the selected connection."; renderIrrigationMode(session); return; } // NEW
            const created = result && result.cell ? { assembly: findAssemblyAncestor(result.cell) || result.cell } : createPartAssembly(session.moduleCell, part, defaultAssemblyAnchor(session)); // CHANGE
            session.partPickerVisible = false; // NEW
            selectCell(created.assembly, false); // NEW
            if (result && result.message) session.message = result.message; // NEW
            scheduleHudGraphStateSync(session.moduleCell); // NEW
            renderIrrigationMode(session); // NEW
        })); // NEW
        hud.appendChild(form); // NEW
    } // NEW

    function renderSelectedConnectionActions(session, hud) { // CHANGE
        const ports = selectedValidPorts(session); // NEW
        const selectedBoundaries = selectedOccupiedBoundaries(session, ports); // NEW
        if (!ports.length && !selectedBoundaries.length) { // CHANGE
            hud.appendChild(hudText("Select inlet/outlet badges or internal connection badges to connect or disconnect assemblies.")); // CHANGE
            return; // NEW
        } // NEW
        const occupied = ports.filter(function (port) { return !!boundaryForPort(session.moduleCell, port); }); // CHANGE
        const free = ports.filter(function (port) { return isPortFree(session.moduleCell, port); }); // NEW
        const actions = hudActions(); // NEW
        if (selectedBoundaries.length || occupied.length) actions.appendChild(button("Disconnect Parts", function () { disconnectSelectedConnections(session, selectedBoundaries); })); // CHANGE
        if (free.length === 2) { // NEW
            const ordered = orderedConnectionPorts(free); // NEW
            if (ordered) { // NEW
                const direct = validatePortConnection(session.moduleCell, ordered.source, ordered.target); // NEW
                if (direct.ok) actions.appendChild(button("Connect", function () { connectSelectedPorts(session, ordered.source, ordered.target); })); // NEW
                else actions.appendChild(button("Suggest Connection", function () { session.bridgePorts = ordered; renderIrrigationMode(session); })); // CHANGE
            } // NEW
        } // NEW
        if (actions.childNodes.length) hud.appendChild(actions); // NEW
        if (session.bridgePorts && free.length === 2) renderBridgeSuggestions(session, hud, session.bridgePorts); // NEW
    } // NEW

    function renderSelectedConnectionRows(session, hud, selectedCells) { // NEW
        const rows = selectedConnectionRowSpecs(session.moduleCell, selectedCells); // NEW
        if (!rows.length) return; // NEW
        const wrap = document.createElement("div"); // NEW
        wrap.className = "trellis-irrigation-connection-rows"; // NEW
        wrap.style.cssText = "display:flex;flex-direction:column;gap:5px;margin-top:4px;"; // NEW
        rows.forEach(function (row) { renderConnectionRow(session, wrap, row); }); // NEW
        hud.appendChild(wrap); // NEW
    } // NEW

    function selectedConnectionRowSpecs(moduleCell, selectedCells) { // NEW
        if (!selectedCells || selectedCells.length !== 1) return []; // NEW
        const selected = selectedCells[0]; // NEW
        const rows = []; // NEW
        if (isAssembly(selected)) { // NEW
            if (assemblyType(selected) === "bed") { appendPortRowSpecs(moduleCell, rows, selected, "input", true); appendPortRowSpecs(moduleCell, rows, selected, "output", true); return rows; } // NEW
            const first = firstAssemblyPart(selected); // NEW
            const last = lastAssemblyPart(selected); // NEW
            if (first) appendOccupiedOrFreeBoundaryPortRowSpecs(moduleCell, rows, first, "input"); // CHANGE
            if (last) appendOccupiedOrFreeBoundaryPortRowSpecs(moduleCell, rows, last, "output"); // CHANGE
            return rows; // NEW
        } // NEW
        if (isAssemblyPartCell(selected)) { // NEW
            appendPortRowSpecs(moduleCell, rows, selected, "input", false); // NEW
            appendPortRowSpecs(moduleCell, rows, selected, "output", false); // NEW
        } // NEW
        return rows; // NEW
    } // NEW

    function appendPortRowSpecs(moduleCell, rows, cell, role, boundaryOnly) { // NEW
        const count = portCapacityForCell(moduleCell, cell, role); // NEW
        for (let i = 0; i < count; i++) rows.push({ cell, role, index: i, boundaryOnly: !!boundaryOnly }); // NEW
    } // NEW

    function appendOccupiedOrFreeBoundaryPortRowSpecs(moduleCell, rows, cell, role) { // NEW
        const count = portCapacityForCell(moduleCell, cell, role); // NEW
        for (let i = 0; i < count; i++) { // NEW
            const port = { cellId: getCellId(cell), role, index: i }; // NEW
            if (edgesForPort(moduleCell, port).length || isPortFree(moduleCell, port)) rows.push({ cell, role, index: i, boundaryOnly: true }); // NEW
        } // NEW
    } // NEW

    function renderConnectionRow(session, wrap, row) { // NEW
        const port = { cellId: getCellId(row.cell), role: row.role, index: row.index }; // NEW
        const line = document.createElement("div"); // NEW
        line.className = "trellis-irrigation-connection-row"; // NEW
        line.style.cssText = "display:grid;grid-template-columns:72px minmax(110px,1fr);gap:6px;align-items:center;"; // NEW
        const label = document.createElement("div"); // NEW
        label.style.cssText = "font-weight:700;"; // NEW
        label.textContent = (row.role === "input" ? "Inlet " : "Outlet ") + (row.index + 1); // NEW
        line.appendChild(label); // NEW
        const controls = document.createElement("div"); // NEW
        controls.style.cssText = "display:flex;flex-direction:column;gap:3px;min-width:0;"; // NEW
        controls.appendChild(renderConnectionDropdown(session, row)); // NEW
        const edge = edgesForPort(session.moduleCell, port)[0]; // NEW
        const pipe = document.createElement("div"); // NEW
        pipe.className = "trellis-irrigation-pipe-row"; // NEW
        pipe.style.cssText = "font-size:11px;color:#4b5563;white-space:normal;"; // NEW
        pipe.textContent = pipeEdgeLabel(session.moduleCell, edge, port); // NEW
        controls.appendChild(pipe); // NEW
        line.appendChild(controls); // NEW
        wrap.appendChild(line); // NEW
    } // NEW

    function renderConnectionDropdown(session, row) { // NEW
        const select = document.createElement("select"); // NEW
        select.className = "trellis-irrigation-connection-dropdown"; // NEW
        select.style.cssText = "min-width:0;width:100%;padding:3px;border:1px solid #aaa;border-radius:4px;"; // NEW
        const current = connectionRowCurrentLabel(session.moduleCell, row); // NEW
        appendSelectOption(select, "", current || "No change"); // NEW
        select.options[0].disabled = true; // NEW
        select.selectedIndex = 0; // NEW
        const groups = connectionDropdownGroups(session.moduleCell, row); // NEW
        appendConnectionOptionGroup(select, "Keeps connection", groups.keep); // NEW
        appendConnectionOptionGroup(select, "Disconnects existing connection", groups.disconnect); // NEW
        if (!groups.keep.length && !groups.disconnect.length) { // NEW
            select.disabled = true; // NEW
            select.options[0].textContent = "No compatible parts"; // NEW
        } // NEW
        select.addEventListener("change", function () { // NEW
            applyConnectionDropdownSelection(session, row, select.value); // NEW
        }); // NEW
        return select; // NEW
    } // NEW

    function appendConnectionOptionGroup(select, label, parts) { // NEW
        if (!parts.length) return; // NEW
        const group = document.createElement("optgroup"); // NEW
        group.label = label; // NEW
        parts.forEach(function (part) { appendSelectOption(group, part.id, part.name); }); // NEW
        select.appendChild(group); // NEW
    } // NEW

    function connectionRowCurrentLabel(moduleCell, row) { // NEW
        const port = { cellId: getCellId(row.cell), role: row.role, index: row.index }; // NEW
        const edge = edgesForPort(moduleCell, port)[0]; // NEW
        if (edge) return "Connected: " + irrigationCellLabel(row.role === "output" ? edge.target : edge.source); // NEW
        const neighbor = internalNeighborForPort(row.cell, row.role); // NEW
        return neighbor ? "Connected: " + irrigationCellLabel(neighbor) : "No change"; // NEW
    } // NEW

    function connectionDropdownGroups(moduleCell, row) { // NEW
        const parts = compatibleDropdownParts(moduleCell, row.cell, row.role); // NEW
        const occupied = !!internalNeighborForPort(row.cell, row.role) || edgesForPort(moduleCell, { cellId: getCellId(row.cell), role: row.role, index: row.index }).length > 0; // NEW
        if (!occupied) return { keep: parts, disconnect: [] }; // NEW
        const keep = parts.filter(function (part) { return replacementKeepsExistingConnection(moduleCell, row, part); }); // NEW
        const keepIds = new Set(keep.map(function (part) { return part.id; })); // NEW
        return { keep, disconnect: parts.filter(function (part) { return !keepIds.has(part.id); }) }; // NEW
    } // NEW

    function replacementKeepsExistingConnection(moduleCell, row, part) { // NEW
        const neighbor = internalNeighborForPort(row.cell, row.role); // NEW
        if (neighbor) return false; // NEW
        const edge = edgesForPort(moduleCell, { cellId: getCellId(row.cell), role: row.role, index: row.index })[0]; // NEW
        if (!edge) return true; // NEW
        if (row.role === "output") return branchCanReuseDownstream(moduleCell, row.cell, part, edge.target); // NEW
        return connectorConnectionMode(moduleCell, portConnectorForCell(moduleCell, edge.source, "output"), normalizeCatalogPart(part).connectors.input).ok; // CHANGE
    } // NEW

    function internalNeighborForPort(cell, role) { // NEW
        const assembly = findAssemblyAncestor(cell); // NEW
        const parts = assemblyPartCells(assembly); // NEW
        const index = parts.indexOf(cell); // NEW
        if (index < 0) return null; // NEW
        return role === "input" ? (parts[index - 1] || null) : (parts[index + 1] || null); // NEW
    } // NEW

    function applyConnectionDropdownSelection(session, row, partId) { // NEW
        const part = partById(readCatalog(session.moduleCell), partId); // NEW
        if (!part) return; // NEW
        const result = applyConnectionPartChoice(session.moduleCell, row, part); // NEW
        session.message = result.message; // NEW
        if (result.cell) selectCell(result.cell, false); // NEW
        scheduleHudGraphStateSync(session.moduleCell); // NEW
        renderIrrigationMode(session); // NEW
    } // NEW

    function applyConnectionPartChoice(moduleCell, row, part) { // NEW
        if (row.role === "output" && portCapacityForCell(moduleCell, row.cell, "output") > 1) return applyBranchOutletChoice(moduleCell, row, part); // NEW
        return applyLinearConnectionChoice(moduleCell, row, part); // NEW
    } // NEW

    function applyLinearConnectionChoice(moduleCell, row, part) { // NEW
        const assembly = findAssemblyAncestor(row.cell); // NEW
        const parts = assemblyPartCells(assembly); // NEW
        const index = parts.indexOf(row.cell); // NEW
        if (!assembly || index < 0) return { message: "Selected part is no longer available." }; // NEW
        const edge = edgesForPort(moduleCell, { cellId: getCellId(row.cell), role: row.role, index: row.index })[0]; // NEW
        const neighbor = internalNeighborForPort(row.cell, row.role); // NEW
        model.beginUpdate && model.beginUpdate(); // NEW
        try { // NEW
            if (neighbor) { // CHANGE
                if (row.role === "input") splitAssemblyPrefix(moduleCell, assembly, index); // NEW
                else splitAssemblySegment(moduleCell, assembly, index + 1); // NEW
            } // NEW
            const freshIndex = assemblyPartCells(assembly).indexOf(row.cell); // NEW
            const inserted = insertAssemblyPartAt(assembly, part, row.role === "input" ? freshIndex : freshIndex + 1); // CHANGE
            if (edge) retargetLinearConnectionEdgeAfterInsert(moduleCell, edge, row, inserted); // CHANGE
            return { cell: inserted, message: neighbor ? "Connection changed; previous chain segment was split into a disconnected swimlane." : "Part added to connection." }; // NEW
        } finally { model.endUpdate && model.endUpdate(); } // NEW
    } // NEW

    function retargetLinearConnectionEdgeAfterInsert(moduleCell, edge, row, inserted) { // CHANGE
        if (row.role === "input") { // NEW
            const decision = existingEdgeConnectionDecision(moduleCell, { cellId: getCellId(edge.source), role: "output", index: getCellAttr(edge, ATTRS.EDGE_SOURCE_PORT, "0") }, { cellId: getCellId(inserted), role: "input", index: 0 }); // CHANGE
            if (decision.ok) { retargetConnectionEdge(edge, inserted, false); updateConnectionEdgeAttrs(edge, decision); } // CHANGE
            else removeCellFromParent(edge); // NEW
            return; // NEW
        } // NEW
        const decision = existingEdgeConnectionDecision(moduleCell, { cellId: getCellId(inserted), role: "output", index: 0 }, { cellId: getCellId(edge.target), role: "input", index: getCellAttr(edge, ATTRS.EDGE_TARGET_PORT, "0") }); // CHANGE
        if (decision.ok) { retargetConnectionEdge(edge, inserted, true); updateConnectionEdgeAttrs(edge, decision); } // CHANGE
        else removeCellFromParent(edge); // NEW
    } // NEW

    function applyBranchOutletChoice(moduleCell, row, part) { // NEW
        const edge = edgesForPort(moduleCell, { cellId: getCellId(row.cell), role: "output", index: row.index })[0]; // NEW
        irrigationDebug("branchOutletChoice:start", { sourceCell: debugCellSummary(row.cell), outletIndex: row.index, part: part ? { id: part.id, name: part.name, category: part.category } : null, existingEdge: debugCellSummary(edge) }); // DIAGNOSTIC
        model.beginUpdate && model.beginUpdate(); // NEW
        try { // NEW
            if (edge && branchCanReuseDownstream(moduleCell, row.cell, part, edge.target)) { // NEW
                irrigationDebug("branchOutletChoice:reuse-downstream", { sourceCell: debugCellSummary(row.cell), outletIndex: row.index, edge: debugCellSummary(edge), downstream: debugCellSummary(edge.target), part: part ? { id: part.id, name: part.name, category: part.category } : null }); // DIAGNOSTIC
                updateAssemblyPartCell(edge.target, part); // NEW
                const decision = existingEdgeConnectionDecision(moduleCell, { cellId: getCellId(row.cell), role: "output", index: row.index }, { cellId: getCellId(edge.target), role: "input", index: 0 }); // CHANGE
                if (!decision.ok) { irrigationDebug("branchOutletChoice:reuse-rejected", { reason: decision.reason, sourceCell: debugCellSummary(row.cell), outletIndex: row.index, edge: debugCellSummary(edge), downstream: debugCellSummary(edge.target) }); removeCellFromParent(edge); return { cell: edge.target, message: "Old branch disconnected; replacement is not compatible." }; } // DIAGNOSTIC
                updateConnectionEdgeAttrs(edge, decision); // CHANGE
                return { cell: edge.target, message: "Branch first part replaced." }; // NEW
            } // NEW
            if (edge) { irrigationDebug("branchOutletChoice:remove-existing-edge", { edge: debugCellSummary(edge), sourceCell: debugCellSummary(row.cell), outletIndex: row.index }); removeCellFromParent(edge); } // DIAGNOSTIC
            irrigationDebug("branchOutletChoice:create-branch", { sourceCell: debugCellSummary(row.cell), outletIndex: row.index, part: part ? { id: part.id, name: part.name, category: part.category } : null }); // DIAGNOSTIC
            const created = createBranchAssemblyFromOutlet(moduleCell, row, part); // NEW
            return { cell: created && created.assembly, message: edge ? "Old branch disconnected; new branch created." : "Branch swimlane created." }; // NEW
        } finally { model.endUpdate && model.endUpdate(); } // NEW
    } // NEW

    function branchCanReuseDownstream(moduleCell, sourceCell, part, downstreamCell) { // NEW
        const p = normalizeCatalogPart(part); // CHANGE
        if (!downstreamCell || !p || p.category === "pipe_tubing" || p.connectors.inputs <= 0) return false; // CHANGE
        if (!connectorConnectionMode(moduleCell, portConnectorForCell(moduleCell, sourceCell, "output"), p.connectors.input).ok) return false; // CHANGE
        const downstreamAssembly = findAssemblyAncestor(downstreamCell); // NEW
        const parts = assemblyPartCells(downstreamAssembly); // NEW
        if (parts[0] !== downstreamCell) return false; // NEW
        const second = parts[1]; // NEW
        if (!second) return true; // NEW
        return connectorMatches(p.connectors.output, portConnectorForCell(moduleCell, second, "input"), null).ok; // CHANGE
    } // NEW

    function createBranchAssemblyFromOutlet(moduleCell, row, part) { // NEW
        const sourceAssembly = findAssemblyAncestor(row.cell); // NEW
        const sourceGeo = getGeometry(sourceAssembly) || {}; // NEW
        const anchor = { x: finiteNumber(sourceGeo.x, 24), y: finiteNumber(sourceGeo.y, 72) + finiteNumber(sourceGeo.height, 120) + 40 + row.index * 28 }; // NEW
        const created = createPartAssembly(moduleCell, part, anchor); // NEW
        const target = firstAssemblyPart(created.assembly); // NEW
        irrigationDebug("branchAssemblyFromOutlet:start", { sourceAssembly: debugCellSummary(sourceAssembly), sourceCell: debugCellSummary(row.cell), outletIndex: row.index, targetAssembly: debugCellSummary(created.assembly), targetCell: debugCellSummary(target), part: part ? { id: part.id, name: part.name, category: part.category } : null }); // DIAGNOSTIC
        const result = createAssemblyConnection(moduleCell, { cellId: getCellId(row.cell), role: "output", index: row.index }, { cellId: getCellId(target), role: "input", index: 0 }); // NEW
        irrigationDebug("branchAssemblyFromOutlet:connection-result", { ok: !!(result && result.ok), reason: result && result.reason || "", mode: result && result.mode || "", edge: debugCellSummary(result && result.edge), sourceAssembly: debugCellSummary(sourceAssembly), sourceCell: debugCellSummary(row.cell), outletIndex: row.index, targetAssembly: debugCellSummary(created.assembly), targetCell: debugCellSummary(target) }); // DIAGNOSTIC
        if (!result.ok) irrigationDebug("branchAssemblyFromOutlet:connection-rejected", { reason: result.reason, sourceAssembly: debugCellSummary(sourceAssembly), sourceCell: debugCellSummary(row.cell), outletIndex: row.index, targetAssembly: debugCellSummary(created.assembly), targetCell: debugCellSummary(target) }); // DIAGNOSTIC
        return result.ok ? created : created; // NEW
    } // NEW

    function normalizeAddedIrrigationEdges(session, cells) { // NEW
        if (!session || !Array.isArray(cells)) return; // NEW
        cells.forEach(function (cell) { normalizeAddedIrrigationEdge(session, cell); }); // NEW
    } // NEW

    function handleRemovedIrrigationCells(session, cells) { // NEW
        if (!session || !Array.isArray(cells) || !cells.length) return; // NEW
        let changed = false; // NEW
        model.beginUpdate && model.beginUpdate(); // NEW
        try { // NEW
            cells.forEach(function (cell) { // NEW
                if (managedConnectionEdge(cell)) { changed = true; return; } // NEW
                if (isAssemblyPartCell(cell) && findAssemblyAncestor(cell)) changed = deleteAssemblyPartCell(session.moduleCell, cell) || changed; // NEW
                else if (isAssembly(cell)) { externalEdgesForCell(session.moduleCell, cell).forEach(removeCellFromParent); changed = true; } // NEW
            }); // NEW
        } finally { model.endUpdate && model.endUpdate(); } // NEW
        if (!changed) return; // NEW
        session.selectedPorts = []; // NEW
        session.selectedBoundaries = []; // NEW
        scheduleHudGraphStateSync(session.moduleCell); // NEW
        renderIrrigationMode(session); // NEW
    } // NEW

    function normalizeAddedIrrigationEdge(session, edge) { // NEW
        if (!edge || getCellAttr(edge, ATTRS.PIPE_EDGE, "") === "1") return; // NEW
        const sourceTerminal = edge.source || (model.getTerminal && model.getTerminal(edge, true)); // NEW
        const targetTerminal = edge.target || (model.getTerminal && model.getTerminal(edge, false)); // NEW
        if (!isAssemblyModeObject(sourceTerminal) || !isAssemblyModeObject(targetTerminal)) return; // NEW
        const sourceCell = boundaryPortCell(sourceTerminal, "output"); // NEW
        const targetCell = boundaryPortCell(targetTerminal, "input"); // NEW
        const sourcePort = firstFreePort(session.moduleCell, sourceCell, "output"); // NEW
        const targetPort = firstFreePort(session.moduleCell, targetCell, "input"); // NEW
        const decision = sourcePort && targetPort ? connectionDecisionForPorts(session.moduleCell, sourcePort, targetPort) : { ok: false, reason: "No available boundary connector." }; // CHANGE
        if (!decision.ok) { // CHANGE
            removeCellFromParent(edge); // NEW
            session.message = "Connection removed: " + decision.reason; // CHANGE
            renderIrrigationMode(session); // NEW
            return; // NEW
        } // NEW
        if (decision.mode === "merge") { // NEW
            removeCellFromParent(edge); // NEW
            const result = mergeAssemblyConnection(session.moduleCell, decision); // NEW
            session.message = result.ok ? "Assemblies merged." : result.reason; // NEW
            scheduleHudGraphStateSync(session.moduleCell); // NEW
            renderIrrigationMode(session); // NEW
            return; // NEW
        } // NEW
        model.beginUpdate && model.beginUpdate(); // NEW
        try { // NEW
            retargetConnectionEdge(edge, decision.sourceCell, true); // CHANGE
            retargetConnectionEdge(edge, decision.targetCell, false); // CHANGE
            updateConnectionEdgeAttrs(edge, decision); // CHANGE
        } finally { model.endUpdate && model.endUpdate(); } // NEW
        session.message = decision.mode === "pipe" ? "Pipe Edge connected." : "Direct link connected."; // CHANGE
        scheduleHudGraphStateSync(session.moduleCell); // NEW
        renderIrrigationMode(session); // NEW
    } // NEW

    function boundaryPortCell(cell, role) { // NEW
        if (isAssembly(cell) && assemblyType(cell) === "bed") return cell; // NEW
        if (isAssembly(cell)) return role === "output" ? lastAssemblyPart(cell) : firstAssemblyPart(cell); // CHANGE
        if (isAssemblyPartCell(cell)) return cell; // NEW
        return null; // NEW
    } // NEW

    function firstFreePort(moduleCell, cell, role) { // NEW
        const count = portCapacityForCell(moduleCell, cell, role); // NEW
        for (let i = 0; i < count; i++) { // NEW
            const port = { cellId: getCellId(cell), role, index: i }; // NEW
            if (isPortFree(moduleCell, port)) return port; // NEW
        } // NEW
        return null; // NEW
    } // NEW

    function selectedValidPorts(session) { // NEW
        return (session.selectedPorts || []).map(normalizePort).filter(function (port) { // NEW
            return port.cellId && portCell(session.moduleCell, port) && (port.role === "input" || port.role === "output"); // NEW
        }); // NEW
    } // NEW

    function orderedConnectionPorts(ports) { // NEW
        const output = ports.find(function (port) { return port.role === "output"; }); // NEW
        const input = ports.find(function (port) { return port.role === "input"; }); // NEW
        return output && input ? { source: output, target: input } : null; // NEW
    } // NEW

    function connectSelectedPorts(session, sourcePort, targetPort) { // NEW
        const result = createAssemblyConnection(session.moduleCell, sourcePort, targetPort); // NEW
        session.message = result.ok ? (result.mode === "merge" ? "Assemblies merged." : result.mode === "direct" ? "Direct link connected." : "Pipe Edge connected.") : result.reason; // CHANGE
        if (result.ok) session.selectedPorts = []; // NEW
        if (result.ok) session.selectedBoundaries = []; // NEW
        scheduleHudGraphStateSync(session.moduleCell); // NEW
        renderIrrigationMode(session); // NEW
    } // NEW

    function disconnectSelectedConnections(session, boundaries) { // CHANGE
        const selected = uniqueBoundaries(boundaries && boundaries.length ? boundaries : selectedOccupiedBoundaries(session)); // NEW
        model.beginUpdate && model.beginUpdate(); // NEW
        let disconnected = 0; // NEW
        try { disconnected = disconnectBoundaries(session.moduleCell, selected); } finally { model.endUpdate && model.endUpdate(); } // CHANGE
        session.selectedPorts = []; // NEW
        session.selectedBoundaries = []; // NEW
        session.message = disconnected ? "Disconnected " + disconnected + (disconnected === 1 ? " connection." : " connections.") : "No selected connections were occupied."; // CHANGE
        scheduleHudGraphStateSync(session.moduleCell); // NEW
        renderIrrigationMode(session); // NEW
    } // NEW

    function renderBridgeSuggestions(session, hud, orderedPorts) { // NEW
        const suggestions = bridgeSuggestionsForPorts(session.moduleCell, orderedPorts.source, orderedPorts.target); // NEW
        if (!suggestions.length) { hud.appendChild(hudWarning("No bridge path found in the current catalog.")); return; } // NEW
        const wrap = document.createElement("div"); // NEW
        wrap.className = "trellis-irrigation-bridge-suggestions"; // NEW
        wrap.style.cssText = "display:flex;flex-direction:column;gap:5px;margin-top:6px;"; // NEW
        wrap.appendChild(hudText("Suggest Connection")); // CHANGE
        appendBridgeSuggestionGroup(session, wrap, "In stock", suggestions.filter(function (suggestion) { return !suggestion.purchaseNeededParts; }), orderedPorts); // NEW
        appendBridgeSuggestionGroup(session, wrap, "Needs purchase", suggestions.filter(function (suggestion) { return suggestion.purchaseNeededParts; }), orderedPorts); // NEW
        hud.appendChild(wrap); // NEW
    } // NEW

    function appendBridgeSuggestionGroup(session, wrap, title, suggestions, orderedPorts) { // NEW
        if (!suggestions.length) return; // NEW
        const header = document.createElement("div"); // NEW
        header.className = "trellis-irrigation-bridge-group"; // NEW
        header.style.cssText = "font-weight:700;margin-top:4px;color:#1f2937;"; // NEW
        header.textContent = title; // NEW
        wrap.appendChild(header); // NEW
        suggestions.forEach(function (suggestion, index) { // NEW
            const label = suggestion.labels.join(" -> ") + " (" + formatMoney(suggestion.purchaseNeededCost) + ")"; // NEW
            wrap.appendChild(button((index + 1) + ". " + label, function () { applyBridgeSuggestion(session, orderedPorts.source, orderedPorts.target, suggestion); })); // NEW
        }); // NEW
    } // NEW

    function bridgeSuggestionsForPorts(moduleCell, sourcePort, targetPort) { // NEW
        const sourceCell = portCell(moduleCell, sourcePort); // NEW
        const targetCell = portCell(moduleCell, targetPort); // NEW
        const sourceConnector = portConnectorForCell(moduleCell, sourceCell, "output"); // NEW
        const targetConnector = portConnectorForCell(moduleCell, targetCell, "input"); // NEW
        if (!sourceConnector || !targetConnector) return []; // NEW
        const catalog = readCatalog(moduleCell); // NEW
        const sourcePart = { id: "source_port", name: "Selected outlet", category: "source_adapter", stockState: "in_stock", cost: 0, connectors: { inputs: 0, outputs: 1, output: sourceConnector }, specs: {} }; // NEW
        const targetRequirement = { connectorType: targetConnector.type, nominalSize: targetConnector.nominalSize, pipeType: targetConnector.pipeType || "", pipeConnection: !!targetConnector.pipeConnection }; // CHANGE
        const items = sortCatalogParts(catalog.items).map(normalizeCatalogPart).filter(function (part) { return part && part.category !== "pipe_tubing" && validateCatalogPart(part).ok; }); // NEW
        const queue = [{ last: sourcePart, parts: [], seen: new Set(["source_port"]) }]; // NEW
        const results = []; // NEW
        while (queue.length && results.length < 40) { // NEW
            const state = queue.shift(); // NEW
            if (state.parts.length > 0 && connectorRecordsMatch(state.last.connectors.output, targetConnector, targetRequirement).ok) { // CHANGE
                results.push(makeHealSuggestion(state.parts)); // NEW
                continue; // NEW
            } // NEW
            if (state.parts.length >= 5) continue; // NEW
            items.forEach(function (candidate) { // NEW
                if (!candidate.id || state.seen.has(candidate.id)) return; // NEW
                if (!canConnectParts(state.last, candidate, targetRequirement).ok) return; // NEW
                const nextSeen = new Set(Array.from(state.seen)); // NEW
                nextSeen.add(candidate.id); // NEW
                queue.push({ last: candidate, parts: state.parts.concat([candidate]), seen: nextSeen }); // NEW
            }); // NEW
        } // NEW
        return results.sort(function (a, b) { // NEW
            const stockA = a.purchaseNeededParts ? 1 : 0; // NEW
            const stockB = b.purchaseNeededParts ? 1 : 0; // NEW
            return (stockA - stockB) || (a.purchaseNeededCost - b.purchaseNeededCost) || (a.totalParts - b.totalParts); // NEW
        }).slice(0, 5); // NEW
    } // NEW

    function applyBridgeSuggestion(session, sourcePort, targetPort, suggestion) { // NEW
        const sourceCell = portCell(session.moduleCell, sourcePort); // NEW
        const targetCell = portCell(session.moduleCell, targetPort); // NEW
        const targetAssembly = findAssemblyAncestor(targetCell); // NEW
        if (!sourceCell || !targetCell || !targetAssembly) { session.message = "Bridge endpoints are no longer available."; renderIrrigationMode(session); return; } // NEW
        const parts = (suggestion.partIds || []).map(function (partId) { return partById(readCatalog(session.moduleCell), partId); }).filter(Boolean); // NEW
        const inserted = insertBridgePartsBefore(session.moduleCell, targetAssembly, targetCell, parts); // NEW
        moveBridgeAssemblies(sourceCell, targetCell); // NEW
        const chain = [sourceCell].concat(inserted).concat([targetCell]); // NEW
        let ok = true; // NEW
        for (let i = 0; i < chain.length - 1; i++) { // NEW
            if (findAssemblyAncestor(chain[i]) === findAssemblyAncestor(chain[i + 1]) && internalNeighborForPort(chain[i], "output") === chain[i + 1]) continue; // NEW
            const source = { cellId: getCellId(chain[i]), role: "output", index: 0 }; // NEW
            const target = { cellId: getCellId(chain[i + 1]), role: "input", index: 0 }; // NEW
            const result = createAssemblyConnection(session.moduleCell, source, target); // NEW
            if (!result.ok) { ok = false; session.message = result.reason; break; } // NEW
        } // NEW
        if (ok) { session.message = "Bridge connection applied."; session.selectedPorts = []; session.selectedBoundaries = []; session.bridgePorts = null; } // CHANGE
        scheduleHudGraphStateSync(session.moduleCell); // NEW
        renderIrrigationMode(session); // NEW
    } // NEW

    function insertBridgePartsBefore(moduleCell, assembly, beforeCell, parts) { // NEW
        const shift = parts.length * (ASSEMBLY_PART_HEIGHT + ASSEMBLY_PART_GAP); // NEW
        const existing = assemblyPartCells(assembly); // NEW
        model.beginUpdate && model.beginUpdate(); // NEW
        try { // NEW
            existing.forEach(function (cell) { // NEW
                const geo = getGeometry(cell) || {}; // NEW
                setGeometry(cell, { y: finiteNumber(geo.y, ASSEMBLY_HEADER_SIZE + ASSEMBLY_PART_GAP) + shift }); // NEW
            }); // NEW
            const inserted = parts.map(function (part, index) { // NEW
                return createAssemblyPartCell(assembly, part.name, { label: part.name, [ATTRS.COMPONENT]: "1", [ATTRS.COMPONENT_TYPE]: part.category, [ATTRS.CATALOG_PART_ID]: part.id }, index); // NEW
            }); // NEW
            resizeAssemblyToChildren(assembly); // NEW
            return inserted; // NEW
        } finally { model.endUpdate && model.endUpdate(); } // NEW
    } // NEW

    function moveBridgeAssemblies(sourceCell, targetCell) { // NEW
        const sourceAssembly = findAssemblyAncestor(sourceCell); // NEW
        const targetAssembly = findAssemblyAncestor(targetCell); // NEW
        if (!sourceAssembly || !targetAssembly || sourceAssembly === targetAssembly) return; // NEW
        const sourceGeo = getGeometry(sourceAssembly) || {}; // NEW
        if (connectedAssembly(sourceAssembly) && !connectedAssembly(targetAssembly)) { // NEW
            setGeometry(targetAssembly, { x: finiteNumber(sourceGeo.x, 24), y: finiteNumber(sourceGeo.y, 72) + finiteNumber(sourceGeo.height, 120) + 40 }); // NEW
        } // NEW
    } // NEW

    function renderSourceEditFields(session, hud, cell) { // NEW
        const profile = endpointProfile(cell); // NEW
        const form = document.createElement("div"); // NEW
        form.className = "trellis-irrigation-source-edit"; // NEW
        form.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:8px 0;"; // NEW
        const connectorOptions = catalogConnectorOptions(session.moduleCell); // NEW
        const connector = addSelectField(form, "Connector", ensureOptionValue(connectorOptions.types, profile.connectorType || "barb"), profile.connectorType || "barb"); // CHANGE
        const size = addSelectField(form, "Size", ensureOptionValue(connectorOptions.sizes, profile.nominalSize || "3/4"), profile.nominalSize || "3/4"); // CHANGE
        const pipeConnection = addCheckboxField(form, "Uses pipe", profile.pipeConnection); // CHANGE
        const flow = addTextField(form, "Flow gpm", profile.usableFlowGpm == null ? "" : profile.usableFlowGpm); // NEW
        const pressure = addTextField(form, "Static psi", profile.staticPressurePsi == null ? "" : profile.staticPressurePsi); // NEW
        const save = button("Save Source", function () { // NEW
            const next = normalizeEndpointProfile(Object.assign({}, profile, { // NEW
                connectorType: connector.value.trim(), // NEW
                nominalSize: size.value.trim(), // NEW
                pipeConnection: pipeConnection.checked, // CHANGE
                usableFlowGpm: finiteNumber(flow.value, null), // NEW
                staticPressurePsi: finiteNumber(pressure.value, null) // NEW
            })); // NEW
            setCellAttrs(cell, { [ATTRS.ENDPOINT_PROFILE_JSON]: JSON.stringify(next) }); // NEW
            scheduleHudGraphStateSync(session.moduleCell); // CHANGE
            renderIrrigationMode(session); // NEW
        }); // NEW
        form.appendChild(save); // NEW
        hud.appendChild(form); // NEW
    } // NEW

    function renderBedInletFields(session, hud, assemblyCell) { // CHANGE
        const bedAssembly = isAssembly(assemblyCell) ? assemblyCell : findAssemblyAncestor(assemblyCell); // CHANGE
        const bedCell = bedCellForAssembly(session.moduleCell, bedAssembly); // CHANGE
        if (!bedAssembly || !bedCell) return; // CHANGE
        const ports = readBedPortConfig(bedCell); // NEW
        const connectorOptions = catalogConnectorOptions(session.moduleCell); // NEW
        const saved = safeJsonParse(getCellAttr(bedCell, ATTRS.BED_TEMPLATE_JSON, ""), null) || {}; // NEW
        const form = document.createElement("div"); // NEW
        form.className = "trellis-irrigation-bed-inlet-form"; // NEW
        form.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:8px 0;"; // NEW
        const inputs = addTextField(form, "Inlets", ports.inputs); // NEW
        const outputs = addTextField(form, "Outlets", ports.outputs); // NEW
        const inputConnector = addSelectField(form, "Input connector", ensureOptionValue(connectorOptions.types, ports.input.type || "barb"), ports.input.type || "barb"); // CHANGE
        const inputSize = addSelectField(form, "Input size", ensureOptionValue(connectorOptions.sizes, ports.input.nominalSize || "1/2"), ports.input.nominalSize || "1/2"); // CHANGE
        const inputPipe = addCheckboxField(form, "Input uses pipe", ports.input.pipeConnection); // CHANGE
        const outputConnector = addSelectField(form, "Output connector", ensureOptionValue(connectorOptions.types, ports.output.type || "barb"), ports.output.type || "barb"); // CHANGE
        const outputSize = addSelectField(form, "Output size", ensureOptionValue(connectorOptions.sizes, ports.output.nominalSize || "1/2"), ports.output.nominalSize || "1/2"); // NEW
        const outputPipe = addCheckboxField(form, "Output uses pipe", ports.output.pipeConnection); // CHANGE
        const templateSelect = addSelectField(form, "Template", BED_TEMPLATES.map(function (entry) { return entry.id; }), saved.templateId || BED_TEMPLATES[0].id); // NEW
        const partSelect = addSelectField(form, "Catalog part", sortCatalogParts(readCatalog(session.moduleCell).items).map(function (item) { return item.id; }), saved.partIds && saved.partIds[0] || ""); // CHANGE
        const rows = addTextField(form, "Rows", saved.spacing && saved.spacing.rows || "2"); // NEW
        const spacing = addTextField(form, "Emitter in", saved.spacing && saved.spacing.emitterInches || "12"); // NEW
        const apply = button("Apply Bed Layout", function () { // NEW
            writeBedPortConfig(bedCell, { inputs: finiteNumber(inputs.value, 1), outputs: finiteNumber(outputs.value, 1), input: { type: inputConnector.value.trim(), nominalSize: inputSize.value.trim(), pipeConnection: inputPipe.checked }, output: { type: outputConnector.value.trim(), nominalSize: outputSize.value.trim(), pipeConnection: outputPipe.checked } }); // CHANGE
            const path = firstAssemblyPathForBedAssembly(session.moduleCell, bedAssembly) || { id: "assembly_bed_" + sanitizeId(getCellId(bedCell)), targetBedId: getCellId(bedCell) || "" }; // CHANGE
            commitBedTemplate(session.moduleCell, path.id, bedCell, { // NEW
                templateId: templateSelect.value, // NEW
                irrigationType: templateSelect.value, // NEW
                partIds: partSelect.value ? [partSelect.value] : [], // NEW
                spacing: { rows: finiteNumber(rows.value, 2), emitterInches: finiteNumber(spacing.value, 12) } // NEW
            }); // NEW
            scheduleHudGraphStateSync(session.moduleCell); // CHANGE
            session.message = "Bed layout updated."; // NEW
            renderIrrigationMode(session); // NEW
        }); // NEW
        form.appendChild(apply); // NEW
        hud.appendChild(form); // NEW
        const demand = saved.demand || {}; // NEW
        hud.appendChild(hudText("Demand " + finiteNumber(demand.flowGpm, 0) + " gpm, " + finiteNumber(demand.operatingPressurePsi, 0) + " psi.")); // NEW
    } // NEW

    function renderAssemblyPortBadges(session, selectedCells) { // CHANGE
        allAssemblyBoundaryPortSpecs(session.moduleCell).forEach(function (spec) { renderPortBadge(session, spec.cell, spec.role, spec.index); }); // CHANGE
        renderInternalConnectionBadges(session, selectedCells); // NEW
        renderBedAssemblyResizeBadges(session, selectedCells); // NEW
    } // NEW

    function allAssemblyBoundaryPortSpecs(moduleCell) { // CHANGE
        const seen = new Set(); // NEW
        const out = []; // NEW
        collectDescendants(moduleCell, isAssembly).forEach(function (assembly) { // NEW
            if (assemblyType(assembly) === "bed") { appendPortBadgeSpecsForCell(moduleCell, out, seen, assembly, "input"); appendPortBadgeSpecsForCell(moduleCell, out, seen, assembly, "output"); return; } // CHANGE
            const first = firstAssemblyPart(assembly); // NEW
            const last = lastAssemblyPart(assembly); // NEW
            if (first) appendPortBadgeSpecsForCell(moduleCell, out, seen, first, "input"); // NEW
            if (last) appendPortBadgeSpecsForCell(moduleCell, out, seen, last, "output"); // NEW
        }); // NEW
        return out; // NEW
    } // NEW

    function appendPortBadgeSpecsForCell(moduleCell, out, seen, cell, role) { // NEW
        const count = portCapacityForCell(moduleCell, cell, role); // NEW
        for (let index = 0; index < count; index++) { // NEW
            const key = [getCellId(cell), role, index].join(":"); // NEW
            if (!getCellId(cell) || seen.has(key)) continue; // NEW
            seen.add(key); // NEW
            out.push({ cell, role, index }); // NEW
        } // NEW
    } // NEW

    function renderPortBadge(session, cell, role, index) { // NEW
        const port = { cellId: getCellId(cell), role, index }; // NEW
        const visual = portBadgeVisualState(session, port); // NEW
        const badge = document.createElement("button"); // NEW
        badge.type = "button"; // NEW
        badge.className = "trellis-irrigation-port-badge trellis-irrigation-port-badge-" + visual.state; // CHANGE
        badge.textContent = (role === "input" ? "I" : "O") + (index + 1); // NEW
        badge.title = (role === "input" ? "Inlet" : "Outlet") + " " + (index + 1) + visual.titleSuffix; // CHANGE
        badge.style.cssText = portBadgeStyle(visual); // CHANGE
        positionPortBadge(badge, cell, role, index, portCapacityForCell(session.moduleCell, cell, role)); // CHANGE
        badge.addEventListener("click", function (ev) { // NEW
            if (ev && ev.stopPropagation) ev.stopPropagation(); // NEW
            const boundary = boundaryForPort(session.moduleCell, port); // NEW
            if (boundary) selectBoundary(session, boundary); // CHANGE
            else toggleSelectedPort(session, port); // CHANGE
            session.bridgePorts = null; // NEW
            selectCell(findAssemblyAncestor(cell) || cell, false); // NEW
            renderIrrigationMode(session); // NEW
        }); // NEW
        appendOverlayNode(badge); // NEW
        session.portBadges.push(badge); // NEW
    } // NEW

    function portBadgeVisualState(session, port) { // NEW
        const key = portKey(port); // NEW
        const selected = (session.selectedPorts || []).map(portKey).indexOf(key) >= 0; // NEW
        const boundary = boundaryForPort(session.moduleCell, port); // NEW
        const boundarySelected = boundary && selectedValidBoundaries(session).map(boundaryKey).indexOf(boundaryKey(boundary)) >= 0; // NEW
        const occupied = edgesForPort(session.moduleCell, port).length > 0; // NEW
        if (boundarySelected) return { state: "selected", titleSuffix: " connected selected" }; // NEW
        const compatible = !selected && !occupied && isCompatibleTargetPort(session, port); // NEW
        if (selected) return { state: "selected", titleSuffix: occupied ? " connected selected" : " free selected" }; // NEW
        if (compatible) return { state: "compatible", titleSuffix: " free compatible" }; // NEW
        if (occupied) return { state: "occupied", titleSuffix: " connected" }; // NEW
        return { state: "normal", titleSuffix: " free" }; // NEW
    } // NEW

    function selectedFreeCompatibilityPort(session) { // NEW
        const selected = selectedValidPorts(session); // NEW
        const free = selected.filter(function (port) { return isPortFree(session.moduleCell, port); }); // NEW
        return selected.length === 1 && free.length === 1 ? free[0] : null; // CHANGE
    } // NEW

    function isCompatibleTargetPort(session, port) { // NEW
        const selected = selectedFreeCompatibilityPort(session); // NEW
        if (!selected || selected.role === port.role || !isPortFree(session.moduleCell, port)) return false; // NEW
        const validation = selected.role === "output" ? validatePortConnection(session.moduleCell, selected, port) : validatePortConnection(session.moduleCell, port, selected); // NEW
        return validation.ok; // NEW
    } // NEW

    function portBadgeStyle(visual) { // NEW
        const styles = { // NEW
            selected: { border: "3px solid #1d4ed8", background: "#dbeafe", shadow: "0 0 0 3px rgba(29,78,216,.22),0 2px 7px rgba(0,0,0,.24)", color: "#0f172a" }, // NEW
            compatible: { border: "2px solid #16a34a", background: "#dcfce7", shadow: "0 0 0 3px rgba(22,163,74,.20),0 1px 5px rgba(0,0,0,.18)", color: "#14532d" }, // NEW
            occupied: { border: "1px solid #2563eb", background: "#dbeafe", shadow: "0 1px 4px rgba(0,0,0,.18)", color: "#1e3a8a" }, // NEW
            normal: { border: "1px solid #555", background: "#fff", shadow: "0 1px 4px rgba(0,0,0,.18)", color: "#111" } // NEW
        }; // NEW
        const s = styles[visual.state] || styles.normal; // NEW
        return "position:absolute;z-index:1002;width:" + PORT_BADGE_SIZE + "px;height:" + PORT_BADGE_SIZE + "px;padding:0;border:" + s.border + ";border-radius:4px;background:" + s.background + ";box-shadow:" + s.shadow + ";color:" + s.color + ";font:bold 10px Arial,sans-serif;cursor:pointer;box-sizing:border-box;"; // NEW
    } // NEW

    function positionPortBadge(node, cell, role, index, count) { // CHANGE
        const state = cellState(cell); // NEW
        const total = Math.max(1, Math.floor(finiteNumber(count, 1))); // NEW
        const slot = (index + 1) / (total + 1); // NEW
        const x = state.x + state.width * slot - PORT_BADGE_SIZE / 2; // CHANGE
        const y = role === "input" ? state.y - PORT_BADGE_SIZE - 4 : state.y + state.height + 4; // CHANGE
        node.style.left = Math.round(x) + "px"; // NEW
        node.style.top = Math.round(y) + "px"; // NEW
    } // NEW

    function toggleSelectedPort(session, port) { // NEW
        const key = portKey(port); // NEW
        const existing = (session.selectedPorts || []).map(portKey).indexOf(key); // NEW
        if (existing >= 0) session.selectedPorts.splice(existing, 1); // NEW
        else session.selectedPorts.push(normalizePort(port)); // NEW
    } // NEW

    function renderInternalConnectionBadges(session, selectedCells) { // NEW
        internalConnectionBoundariesForSelection(session.moduleCell, selectedCells).forEach(function (entry) { // NEW
            const badge = document.createElement("button"); // NEW
            const selected = selectedValidBoundaries(session).map(boundaryKey).indexOf(boundaryKey(entry.boundary)) >= 0; // NEW
            badge.type = "button"; // NEW
            badge.className = "trellis-irrigation-internal-connection-badge" + (selected ? " trellis-irrigation-internal-connection-badge-selected" : ""); // NEW
            badge.textContent = "OK"; // CHANGE
            badge.title = "Internal connection: " + irrigationCellLabel(entry.upstream) + " to " + irrigationCellLabel(entry.downstream); // NEW
            badge.style.cssText = internalConnectionBadgeStyle(selected); // NEW
            positionInternalConnectionBadge(badge, entry.upstream, entry.downstream); // NEW
            badge.addEventListener("click", function (ev) { // NEW
                if (ev && ev.stopPropagation) ev.stopPropagation(); // NEW
                toggleSelectedBoundary(session, entry.boundary); // NEW
                session.bridgePorts = null; // NEW
                selectCell(entry.assembly, false); // NEW
                renderIrrigationMode(session); // NEW
            }); // NEW
            appendOverlayNode(badge); // NEW
            session.portBadges.push(badge); // NEW
        }); // NEW
    } // NEW

    function internalConnectionBoundariesForSelection(moduleCell, selectedCells) { // NEW
        const seen = new Set(); // NEW
        const out = []; // NEW
        (selectedCells || []).forEach(function (cell) { // NEW
            const assembly = isAssembly(cell) ? cell : findAssemblyAncestor(cell); // NEW
            if (!assembly || assemblyType(assembly) === "bed") return; // NEW
            const parts = assemblyPartCells(assembly); // NEW
            const selectedIndex = isAssembly(cell) ? -1 : parts.indexOf(cell); // NEW
            for (let index = 0; index < parts.length - 1; index++) { // NEW
                if (selectedIndex >= 0 && index !== selectedIndex && index + 1 !== selectedIndex) continue; // NEW
                const boundary = internalBoundaryForParts(assembly, parts[index], parts[index + 1]); // NEW
                const key = boundaryKey(boundary); // NEW
                if (!key || seen.has(key)) continue; // NEW
                seen.add(key); // NEW
                out.push({ boundary, assembly, upstream: parts[index], downstream: parts[index + 1] }); // NEW
            } // NEW
        }); // NEW
        return out; // NEW
    } // NEW

    function internalConnectionBadgeStyle(selected) { // NEW
        const border = selected ? "3px solid #1d4ed8" : "1px solid #7c3aed"; // NEW
        const background = selected ? "#dbeafe" : "#f3e8ff"; // NEW
        const shadow = selected ? "0 0 0 3px rgba(29,78,216,.22),0 2px 7px rgba(0,0,0,.24)" : "0 1px 4px rgba(0,0,0,.18)"; // NEW
        return "position:absolute;z-index:1003;width:" + PORT_BADGE_SIZE + "px;height:" + PORT_BADGE_SIZE + "px;padding:0;border:" + border + ";border-radius:4px;background:" + background + ";box-shadow:" + shadow + ";color:#3b0764;font:bold 10px Arial,sans-serif;cursor:pointer;box-sizing:border-box;"; // NEW
    } // NEW

    function positionInternalConnectionBadge(node, upstream, downstream) { // NEW
        const up = cellState(upstream); // NEW
        const down = cellState(downstream); // NEW
        const x = Math.min(up.x, down.x) + Math.max(up.width, down.width) / 2 - PORT_BADGE_SIZE / 2; // NEW
        const y = (up.y + up.height + down.y) / 2 - PORT_BADGE_SIZE / 2; // NEW
        node.style.left = Math.round(x) + "px"; // NEW
        node.style.top = Math.round(y) + "px"; // NEW
    } // NEW

    function renderBedAssemblyResizeBadges(session, selectedCells) { // NEW
        (selectedCells || []).forEach(function (cell) { // NEW
            const assembly = isAssembly(cell) ? cell : findAssemblyAncestor(cell); // NEW
            if (!assembly || assemblyType(assembly) !== "bed") return; // NEW
            const badge = document.createElement("button"); // NEW
            badge.type = "button"; // NEW
            const expanded = getCellAttr(assembly, ATTRS.ASSEMBLY_EXPANDED, "") === "1"; // NEW
            badge.textContent = expanded ? "-" : "+"; // NEW
            badge.title = expanded ? "Contract bed assembly" : "Expand to linked bed size"; // NEW
            badge.style.cssText = "position:absolute;z-index:1002;width:22px;height:22px;padding:0;border:1px solid #555;border-radius:4px;background:#fff;font:bold 12px Arial,sans-serif;cursor:pointer;"; // NEW
            positionNavigatorButton(badge, assembly, -26, -26); // NEW
            badge.addEventListener("click", function (ev) { // NEW
                if (ev && ev.stopPropagation) ev.stopPropagation(); // NEW
                toggleBedAssemblyExpanded(session, assembly); // NEW
            }); // NEW
            appendOverlayNode(badge); // NEW
            session.portBadges.push(badge); // NEW
        }); // NEW
    } // NEW

    function toggleBedAssemblyExpanded(session, assembly) { // NEW
        const expanded = getCellAttr(assembly, ATTRS.ASSEMBLY_EXPANDED, "") === "1"; // NEW
        model.beginUpdate && model.beginUpdate(); // NEW
        try { // NEW
            if (expanded) { // NEW
                setCellAttrs(assembly, { [ATTRS.ASSEMBLY_EXPANDED]: "0" }); // NEW
                setGeometry(assembly, { width: ASSEMBLY_CONTRACTED_BED.width, height: ASSEMBLY_CONTRACTED_BED.height }); // NEW
            } else { // NEW
                const bed = findCellById(session.moduleCell, getCellAttr(assembly, ATTRS.LINKED_BED_ID, "")); // NEW
                const bedGeo = getGeometry(bed) || ASSEMBLY_CONTRACTED_BED; // NEW
                setCellAttrs(assembly, { [ATTRS.ASSEMBLY_EXPANDED]: "1" }); // NEW
                setGeometry(assembly, { width: finiteNumber(bedGeo.width, ASSEMBLY_DEFAULT_WIDTH), height: finiteNumber(bedGeo.height, ASSEMBLY_CONTRACTED_BED.height) }); // CHANGE
            } // NEW
        } finally { model.endUpdate && model.endUpdate(); } // NEW
        scheduleHudGraphStateSync(session.moduleCell); // NEW
        renderIrrigationMode(session); // NEW
    } // NEW

    function reverseAssembly(assembly) { // NEW
        if (!assembly || !assemblyCanReverse(findGardenModuleAncestor(assembly), assembly)) return; // CHANGE
        const parts = assemblyPartCells(assembly); // NEW
        const ys = parts.map(function (cell) { return finiteNumber((getGeometry(cell) || {}).y, 0); }).sort(function (a, b) { return a - b; }); // NEW
        model.beginUpdate && model.beginUpdate(); // NEW
        try { // NEW
            parts.forEach(function (cell, index) { setGeometry(cell, { y: ys[ys.length - 1 - index] }); }); // NEW
        } finally { model.endUpdate && model.endUpdate(); } // NEW
    } // NEW

    function assemblyCanReverse(moduleCell, assembly) { // NEW
        if (!assembly || connectedAssembly(assembly)) return false; // NEW
        const cells = assemblyType(assembly) === "bed" ? [assembly] : assemblyPartCells(assembly); // NEW
        return !cells.some(function (cell) { return portCapacityForCell(moduleCell, cell, "output") > 1; }); // NEW
    } // NEW

    function deleteAssemblySelection(session, selected) { // NEW
        const assemblies = []; // NEW
        const parts = []; // NEW
        const seen = new Set(); // NEW
        const seenParts = new Set(); // NEW
        (selected || []).forEach(function (cell) { // NEW
            if (isAssemblyPartCell(cell)) { // NEW
                const partId = getCellId(cell); // NEW
                if (partId && !seenParts.has(partId)) { seenParts.add(partId); parts.push(cell); } // NEW
                return; // NEW
            } // NEW
            const assembly = isAssembly(cell) ? cell : findAssemblyAncestor(cell); // NEW
            const id = getCellId(assembly); // NEW
            if (!assembly || !id || seen.has(id)) return; // NEW
            seen.add(id); // NEW
            assemblies.push(assembly); // NEW
        }); // NEW
        model.beginUpdate && model.beginUpdate(); // NEW
        try { // NEW
            parts.sort(function (a, b) { // NEW
                const assemblyA = findAssemblyAncestor(a); // NEW
                const assemblyB = findAssemblyAncestor(b); // NEW
                if (assemblyA !== assemblyB) return String(getCellId(assemblyA) || "").localeCompare(String(getCellId(assemblyB) || "")); // NEW
                return assemblyPartCells(assemblyA).indexOf(b) - assemblyPartCells(assemblyA).indexOf(a); // NEW
            }).forEach(function (part) { deleteAssemblyPartCell(session.moduleCell, part); }); // NEW
            assemblies.forEach(function (assembly) { // CHANGE
                externalEdgesForCell(session.moduleCell, assembly).forEach(removeCellFromParent); // NEW
                assemblyPartCells(assembly).forEach(function (part) { externalEdgesForCell(session.moduleCell, part).forEach(removeCellFromParent); }); // CHANGE
                removeCellFromParent(assembly); // NEW
            }); // NEW
            selectCell(session.moduleCell, false); // NEW
        } finally { model.endUpdate && model.endUpdate(); } // NEW
        session.selectedPorts = []; // NEW
        session.selectedBoundaries = []; // NEW
        scheduleHudGraphStateSync(session.moduleCell); // NEW
        renderIrrigationMode(session); // NEW
    } // NEW

    function renderSelectedZoneControls(session, hud, selectedCells) { // NEW
        const bedAssemblies = selectedBedAssembliesFromCells(selectedCells); // NEW
        if (!bedAssemblies.length) return; // NEW
        const zones = syncZones(session.moduleCell); // NEW
        const resolved = resolveEffectiveZoneMembership(session.moduleCell, zones); // NEW
        const bedIds = bedAssemblies.map(getCellId).filter(Boolean); // NEW
        const zoneIds = uniqueStrings(bedIds.map(function (id) { const entry = resolved.assignment.get(id); return entry && entry.zoneId || ""; }).filter(Boolean)); // NEW
        const current = zoneIds.length === 1 ? zones.find(function (zone) { return zone.id === zoneIds[0]; }) : null; // NEW
        const wrap = document.createElement("div"); // NEW
        wrap.className = "trellis-irrigation-zone-controls"; // NEW
        wrap.style.cssText = "display:grid;gap:6px;border-top:1px solid #ddd;padding-top:6px;margin-top:4px;"; // NEW
        wrap.appendChild(hudText("Zone: " + (zoneIds.length === 0 ? "Unzoned" : (zoneIds.length > 1 ? "Mixed" : zoneDisplayName(session.moduleCell, current))))); // NEW
        const select = document.createElement("select"); // NEW
        select.className = "trellis-irrigation-zone-picker"; // NEW
        appendSelectOption(select, "", "Assign to zone..."); // NEW
        zones.forEach(function (zone) { appendSelectOption(select, zone.id, zoneDisplayName(session.moduleCell, zone)); }); // NEW
        select.addEventListener("change", function () { // NEW
            if (!select.value) return; // NEW
            assignBedsToZone(session.moduleCell, select.value, bedIds); // NEW
            syncHudGraphState(session.moduleCell); // NEW
            session.message = "Zone assignment updated."; // NEW
            renderIrrigationMode(session); // NEW
        }); // NEW
        wrap.appendChild(select); // NEW
        const actions = hudActions(); // NEW
        actions.appendChild(button("New Zone", function () { // NEW
            const name = typeof prompt !== "undefined" ? (prompt("Zone name", "Manual Zone") || "Manual Zone") : "Manual Zone"; // NEW
            createManualZone(session.moduleCell, name, bedIds); // NEW
            syncHudGraphState(session.moduleCell); // NEW
            session.message = "Manual zone created."; // NEW
            renderIrrigationMode(session); // NEW
        })); // NEW
        actions.appendChild(button("Reset Zone", function () { // NEW
            resetBedZoneOverrides(session.moduleCell, bedIds); // NEW
            syncHudGraphState(session.moduleCell); // NEW
            session.message = "Zone overrides reset."; // NEW
            renderIrrigationMode(session); // NEW
        })); // NEW
        wrap.appendChild(actions); // NEW
        hud.appendChild(wrap); // NEW
    } // NEW

    function openZoneManager(moduleCell, session) { // NEW
        syncHudGraphState(moduleCell); // NEW
        const state = {}; // NEW
        const div = document.createElement("div"); // NEW
        div.className = "trellis-irrigation-zone-manager"; // NEW
        div.style.cssText = "width:880px;max-width:96vw;max-height:84vh;overflow:auto;font:12px Arial,sans-serif;padding:12px;"; // NEW
        showDialog(div, 900, 620); // NEW
        renderZoneManager(div, moduleCell, state, session); // NEW
    } // NEW

    function renderZoneManager(container, moduleCell, state, session) { // NEW
        const zones = syncZones(moduleCell); // NEW
        const report = zoneSummary(moduleCell, zones, deriveAssemblyPaths(moduleCell)); // CHANGE
        container.innerHTML = ""; // NEW
        const title = document.createElement("h2"); // NEW
        title.textContent = "Irrigation Zones"; // NEW
        title.style.cssText = "font-size:16px;margin:0 0 8px;"; // NEW
        container.appendChild(title); // NEW
        container.appendChild(hudText(report.zoneCount + " zones, " + report.unzonedBedCount + " unzoned beds, " + report.overCapacityZoneCount + " capacity warnings.")); // NEW
        const table = document.createElement("table"); // NEW
        table.style.cssText = "width:100%;border-collapse:collapse;margin-top:8px;"; // NEW
        table.innerHTML = "<thead><tr><th>Zone</th><th>Origin</th><th>Beds</th><th>Demand</th><th>Status</th><th>Actions</th></tr></thead>"; // NEW
        const tbody = document.createElement("tbody"); // NEW
        report.zones.forEach(function (detail) { // NEW
            const zone = zones.find(function (item) { return item.id === detail.id; }) || normalizeZone({ id: detail.id }); // NEW
            const tr = document.createElement("tr"); // NEW
            const nameTd = document.createElement("td"); // NEW
            const alias = document.createElement("input"); // NEW
            alias.value = zone.alias || ""; // NEW
            alias.placeholder = zoneDisplayName(moduleCell, zone); // NEW
            alias.style.cssText = "width:150px;padding:3px;border:1px solid #aaa;border-radius:4px;"; // NEW
            nameTd.appendChild(alias); // NEW
            const originTd = document.createElement("td"); // NEW
            originTd.textContent = zone.originType === ZONE_ORIGIN_TIMER_OUTLET ? "Timer outlet " + (finiteNumber(zone.outletIndex, 0) + 1) : "Manual"; // NEW
            const bedsTd = document.createElement("td"); // NEW
            bedsTd.textContent = detail.memberBedIds.map(function (id) { return bedAssemblyLabel(moduleCell, findCellById(moduleCell, id)); }).join(", ") || "Empty"; // NEW
            const demandTd = document.createElement("td"); // NEW
            demandTd.textContent = finiteNumber(detail.demandGpm, 0).toFixed(2) + " gpm"; // NEW
            const statusTd = document.createElement("td"); // NEW
            statusTd.textContent = detail.warnings.length ? detail.warnings.join(" ") : detail.status; // NEW
            statusTd.style.color = detail.warnings.length ? "#8a4b00" : "#116611"; // NEW
            const actionsTd = document.createElement("td"); // NEW
            actionsTd.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;"; // NEW
            actionsTd.appendChild(button("Save", function () { updateZoneAlias(moduleCell, zone.id, alias.value); renderZoneManager(container, moduleCell, state, session); if (session) renderIrrigationMode(session); })); // NEW
            actionsTd.appendChild(button("Reset", function () { resetZoneOverrides(moduleCell, zone.id); syncHudGraphState(moduleCell); renderZoneManager(container, moduleCell, state, session); if (session) renderIrrigationMode(session); })); // NEW
            detail.memberBedIds.forEach(function (bedId) { // NEW
                actionsTd.appendChild(button("Reset " + bedAssemblyLabel(moduleCell, findCellById(moduleCell, bedId)), function () { resetBedZoneOverrides(moduleCell, [bedId]); syncHudGraphState(moduleCell); renderZoneManager(container, moduleCell, state, session); if (session) renderIrrigationMode(session); })); // NEW
            }); // NEW
            [nameTd, originTd, bedsTd, demandTd, statusTd, actionsTd].forEach(function (td) { td.style.border = "1px solid #ccc"; td.style.padding = "4px"; td.style.verticalAlign = "top"; tr.appendChild(td); }); // NEW
            tbody.appendChild(tr); // NEW
        }); // NEW
        table.appendChild(tbody); // NEW
        container.appendChild(table); // NEW
        if (report.unzonedBedIds.length || report.ambiguousBedIds.length) { // NEW
            const warn = document.createElement("div"); // NEW
            warn.style.cssText = "margin-top:8px;color:#8a4b00;line-height:1.35;"; // NEW
            warn.textContent = (report.unzonedBedIds.length ? "Unzoned: " + report.unzonedBedIds.map(function (id) { return bedAssemblyLabel(moduleCell, findCellById(moduleCell, id)); }).join(", ") + ". " : "") + (report.ambiguousBedIds.length ? "Ambiguous: " + report.ambiguousBedIds.map(function (id) { return bedAssemblyLabel(moduleCell, findCellById(moduleCell, id)); }).join(", ") + "." : ""); // NEW
            container.appendChild(warn); // NEW
        } // NEW
        const controls = hudActions(); // NEW
        controls.appendChild(button("New Manual Zone", function () { createManualZone(moduleCell, "Manual Zone", []); syncHudGraphState(moduleCell); renderZoneManager(container, moduleCell, state, session); if (session) renderIrrigationMode(session); })); // NEW
        controls.appendChild(button("Close", hideDialog)); // NEW
        container.appendChild(controls); // NEW
    } // NEW

    function bedAssemblyLabel(moduleCell, bedAssembly) { // NEW
        const bed = bedCellForAssembly(moduleCell, bedAssembly); // NEW
        return getCellAttr(bed, "label", getCellAttr(bedAssembly, "label", getCellId(bedAssembly) || "Bed")); // NEW
    } // NEW

    function appendModuleSummary(session, hud) { // NEW
        const summary = readDashboardSummary(session.moduleCell); // NEW
        const text = summary ? "Irrigated " + Math.round(summary.percentIrrigated || 0) + "%, zones " + (summary.zoneCount || 0) + ", zone warnings " + (summary.zoneWarningCount || 0) + "." : "Select a source, part, or bed inlet to work in the diagram."; // CHANGE
        hud.appendChild(hudText(text)); // NEW
    } // NEW

    function appendHudStatus(hud, session) { // NEW
        if (!session.message) return; // NEW
        hud.appendChild(hudWarning(session.message)); // NEW
    } // NEW

    function hudTitle(text) { // NEW
        const title = document.createElement("div"); // NEW
        title.style.cssText = "font-weight:700;margin-bottom:6px;"; // NEW
        title.textContent = text; // NEW
        return title; // NEW
    } // NEW

    function hudText(text) { // NEW
        const div = document.createElement("div"); // NEW
        div.style.cssText = "margin:6px 0;color:#333;line-height:1.35;"; // NEW
        div.textContent = text; // NEW
        return div; // NEW
    } // NEW

    function hudWarning(text) { // NEW
        const div = document.createElement("div"); // NEW
        div.className = "trellis-irrigation-hud-warning"; // NEW
        div.style.cssText = "margin:6px 0;color:#8a4b00;line-height:1.35;"; // NEW
        div.textContent = text; // NEW
        return div; // NEW
    } // NEW

    function hudActions() { // NEW
        const div = document.createElement("div"); // NEW
        div.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;"; // NEW
        return div; // NEW
    } // NEW

    function validateHudConnection(moduleCell, source, target) { // NEW
        if (!source || !target) return { ok: false, reason: "Select a compatible irrigation target." }; // NEW
        if (!isHudIrrigationObject(source) || !isHudIrrigationObject(target)) return { ok: false, reason: "Target must be an irrigation source, part, or bed inlet." }; // NEW
        if (source === target) return { ok: false, reason: "Irrigation trees cannot connect a part to itself." }; // NEW
        if (endpointType(source) === "bed") return { ok: false, reason: "Bed inlets cannot have downstream children." }; // NEW
        if (incomingHudEdges(moduleCell, target).length) return { ok: false, reason: "Target already has an upstream parent." }; // NEW
        if (wouldCreateCycle(moduleCell, source, target)) return { ok: false, reason: "Irrigation trees cannot contain cycles." }; // NEW
        const maxChildren = outputCapacityForCell(moduleCell, source); // NEW
        if (outgoingHudEdges(moduleCell, source).length >= maxChildren) return { ok: false, reason: "Selected part has no free downstream output." }; // NEW
        return validateHudCompatibility(moduleCell, source, target); // NEW
    } // NEW

    function validateHudCompatibility(moduleCell, source, target) { // NEW
        const sourcePart = partForCell(moduleCell, source); // NEW
        const targetPart = partForCell(moduleCell, target); // NEW
        if (endpointType(source) === "source" && targetPart) return canEndpointConnectToPart(endpointProfile(source), targetPart); // NEW
        if (endpointType(source) === "source" && endpointType(target) === "bed") { // NEW
            const direct = connectorRecordsMatch(endpointProfileAsConnector(endpointProfile(source)), endpointProfileAsConnector(endpointProfile(target)), endpointProfile(target)); // CHANGE
            return direct.ok ? direct : { ok: false, reason: "Source endpoint cannot connect directly to bed inlet: " + direct.reason }; // NEW
        } // NEW
        if (sourcePart && targetPart) return canConnectParts(sourcePart, targetPart, endpointType(target) === "bed" ? endpointProfile(target) : null); // NEW
        if (sourcePart && endpointType(target) === "bed") return canPartReachEndpoint(sourcePart, endpointProfile(target)); // NEW
        return { ok: false, reason: "Unsupported irrigation connection." }; // NEW
    } // NEW

    function endpointProfileAsConnector(profile) { // NEW
        return { type: profile.connectorType, nominalSize: profile.nominalSize, pipeType: profile.pipeType || "", pipeConnection: !!profile.pipeConnection }; // CHANGE
    } // NEW

    function outputCapacityForCell(moduleCell, cell) { // NEW
        if (endpointType(cell) === "source") return 1; // NEW
        const part = partForCell(moduleCell, cell); // NEW
        return Math.max(0, finiteNumber(part && part.connectors && part.connectors.outputs, 0)); // NEW
    } // NEW

    function wouldCreateCycle(moduleCell, source, target) { // NEW
        let cur = source; // NEW
        const seen = new Set(); // NEW
        while (cur) { // NEW
            if (cur === target) return true; // NEW
            const id = getCellId(cur); // NEW
            if (!id || seen.has(id)) return true; // NEW
            seen.add(id); // NEW
            const incoming = incomingHudEdges(moduleCell, cur)[0]; // NEW
            cur = incoming && incoming.source; // NEW
        } // NEW
        return false; // NEW
    } // NEW

    function partForCell(moduleCell, cell) { // NEW
        const partId = getCellAttr(cell, ATTRS.CATALOG_PART_ID, ""); // NEW
        return partById(readCatalog(moduleCell), partId); // NEW
    } // NEW

    function isLegacyGenerated(cell) { // NEW
        return getCellAttr(cell, ATTRS.GENERATED, "") === "1"; // NEW
    } // NEW

    function isHudIrrigationObject(cell) { // NEW
        if (!cell || isLegacyGenerated(cell)) return false; // NEW
        return isEndpoint(cell) || getCellAttr(cell, ATTRS.COMPONENT, "") === "1" || (isAssembly(cell) && assemblyType(cell) === "bed"); // CHANGE
    } // NEW

    function isHudPipeEdge(cell) { // NEW
        return !!cell && !isLegacyGenerated(cell) && (getCellAttr(cell, ATTRS.PIPE_EDGE, "") === "1" || getCellAttr(cell, ATTRS.DIRECT_LINK_EDGE, "") === "1"); // CHANGE
    } // NEW

    function collectHudObjects(moduleCell) { // NEW
        return collectDescendants(moduleCell, isHudIrrigationObject); // NEW
    } // NEW

    function collectHudEndpoints(moduleCell, type) { // NEW
        return collectHudObjects(moduleCell).filter(function (cell) { return isEndpoint(cell) && (!type || endpointType(cell) === type); }); // NEW
    } // NEW

    function collectHudPipeEdges(moduleCell) { // NEW
        return collectDescendants(moduleCell, isHudPipeEdge); // NEW
    } // NEW

    function incomingHudEdges(moduleCell, cell) { // NEW
        return collectHudPipeEdges(moduleCell).filter(function (edge) { return edge.target === cell; }); // NEW
    } // NEW

    function outgoingHudEdges(moduleCell, cell) { // NEW
        return collectHudPipeEdges(moduleCell).filter(function (edge) { return edge.source === cell; }); // NEW
    } // NEW

    function irrigationCellKind(cell) { // NEW
        if (endpointType(cell) === "source") return "source"; // NEW
        if (endpointType(cell) === "bed") return "bed"; // NEW
        return "part"; // NEW
    } // NEW

    function irrigationCellLabel(cell) { // NEW
        if (isEndpoint(cell)) return endpointLabel(cell); // NEW
        return getCellAttr(cell, "label", getCellId(cell) || "Irrigation part"); // NEW
    } // NEW

    function cellWarning(moduleCell, cell) { // NEW
        if (endpointType(cell) === "source") return hasDownstreamConnection(moduleCell, cell) ? "" : "Source has no downstream irrigation tree."; // CHANGE
        if (!hasSourceRoute(moduleCell, cell)) return "Disconnected irrigation object."; // CHANGE
        const validation = incomingHudEdges(moduleCell, cell)[0]; // NEW
        if (validation && !validateHudCompatibility(moduleCell, validation.source, cell).ok) return "Incoming connection is incompatible."; // NEW
        return ""; // NEW
    } // NEW

    function hasDownstreamConnection(moduleCell, cell) { // NEW
        return downstreamIrrigationChildren(moduleCell, cell).length > 0; // NEW
    } // NEW

    function hasSourceRoute(moduleCell, cell) { // NEW
        const stack = [cell]; // CHANGE
        const seen = new Set(); // NEW
        while (stack.length) { // CHANGE
            const cur = stack.pop(); // NEW
            const id = getCellId(cur); // NEW
            if (!id || seen.has(id)) continue; // CHANGE
            if (endpointType(cur) === "source") return true; // NEW
            seen.add(id); // NEW
            upstreamIrrigationParents(moduleCell, cur).forEach(function (parent) { stack.push(parent); }); // CHANGE
        } // NEW
        return false; // NEW
    } // NEW

    function upstreamIrrigationParents(moduleCell, cell) { // NEW
        const parents = incomingHudEdges(moduleCell, cell).map(function (edge) { return edge.source; }).filter(Boolean); // NEW
        const internal = internalNeighborForPort(cell, "input"); // NEW
        if (internal) parents.push(internal); // NEW
        return uniqueCells(parents); // NEW
    } // NEW

    function downstreamIrrigationChildren(moduleCell, cell) { // NEW
        const children = outgoingHudEdges(moduleCell, cell).map(function (edge) { return edge.target; }).filter(Boolean); // NEW
        const internal = internalNeighborForPort(cell, "output"); // NEW
        if (internal) children.push(internal); // NEW
        return uniqueCells(children); // NEW
    } // NEW

    function renderZoneBadges(session) { // NEW
        const zones = syncZones(session.moduleCell); // NEW
        const resolved = resolveEffectiveZoneMembership(session.moduleCell, zones); // NEW
        resolved.assignment.forEach(function (entry, bedAssemblyId) { // NEW
            const bedAssembly = findCellById(session.moduleCell, bedAssemblyId); // NEW
            const zone = zones.find(function (item) { return item.id === entry.zoneId; }); // NEW
            if (!bedAssembly || !zone) return; // NEW
            const badge = document.createElement("div"); // NEW
            badge.className = "trellis-irrigation-zone-badge"; // NEW
            badge.title = "Zone: " + zoneDisplayName(session.moduleCell, zone); // NEW
            badge.textContent = zoneBadgeLabel(session.moduleCell, zone); // NEW
            badge.style.cssText = "position:absolute;z-index:997;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:2px 5px;border:1px solid #2563eb;border-radius:4px;background:#eff6ff;color:#1e3a8a;font:bold 11px Arial,sans-serif;"; // NEW
            positionOverlayBox(badge, bedAssembly, 4); // NEW
            badge.style.width = ""; // NEW
            badge.style.height = ""; // NEW
            appendOverlayNode(badge); // NEW
            session.zoneBadges.push(badge); // NEW
        }); // NEW
    } // NEW

    function zoneBadgeLabel(moduleCell, zone) { // NEW
        if (zone.alias) return zone.alias; // NEW
        if (zone.originType === ZONE_ORIGIN_TIMER_OUTLET) return "Z" + (finiteNumber(zone.outletIndex, 0) + 1); // NEW
        return zoneDisplayName(moduleCell, zone); // NEW
    } // NEW

    function renderIrrigationWarningBadges(session) { // NEW
        collectHudObjects(session.moduleCell).forEach(function (cell) { // NEW
            const warning = cellWarning(session.moduleCell, cell); // NEW
            if (!warning) return; // NEW
            const badge = document.createElement("div"); // NEW
            badge.className = "trellis-irrigation-warning-badge"; // NEW
            badge.title = warning; // NEW
            badge.textContent = "!"; // NEW
            badge.style.cssText = "position:absolute;z-index:998;width:16px;height:16px;line-height:16px;text-align:center;border-radius:8px;background:#f6c343;color:#111;font:bold 11px Arial,sans-serif;"; // NEW
            positionOverlayBox(badge, cell, -8); // NEW
            appendOverlayNode(badge); // NEW
            session.warningBadges.push(badge); // NEW
        }); // NEW
    } // NEW

    function renderIrrigationNavigator(session, activeCell) { // NEW
        const targets = irrigationNavigationTargets(session.moduleCell, activeCell); // NEW
        const specs = [ // NEW
            ["parent", targets.parent, -32, -24, "^"], // NEW
            ["child", targets.child, -32, 36, "v"], // NEW
            ["prev", targets.previousSibling, -60, 6, "<"], // NEW
            ["next", targets.nextSibling, -4, 6, ">"] // NEW
        ]; // NEW
        specs.forEach(function (spec) { // NEW
            if (!spec[1]) return; // NEW
            const nav = document.createElement("button"); // NEW
            nav.type = "button"; // NEW
            nav.className = "trellis-irrigation-nav-" + spec[0]; // NEW
            nav.textContent = spec[4]; // NEW
            nav.title = spec[0]; // NEW
            nav.style.cssText = "position:absolute;z-index:1001;width:22px;height:22px;padding:0;border:1px solid #777;border-radius:4px;background:#fff;cursor:pointer;font:12px Arial,sans-serif;"; // NEW
            positionNavigatorButton(nav, activeCell, spec[2], spec[3]); // NEW
            nav.addEventListener("click", function () { selectCell(spec[1], true); renderIrrigationMode(session); }); // NEW
            appendOverlayNode(nav); // NEW
            session.navigator.push(nav); // NEW
        }); // NEW
    } // NEW

    function irrigationNavigationTargets(moduleCell, activeCell) { // NEW
        const incoming = incomingHudEdges(moduleCell, activeCell)[0]; // NEW
        const parent = incoming && incoming.source; // NEW
        const children = outgoingHudEdges(moduleCell, activeCell).map(function (edge) { return edge.target; }); // NEW
        const siblings = parent ? outgoingHudEdges(moduleCell, parent).map(function (edge) { return edge.target; }) : []; // NEW
        const index = siblings.indexOf(activeCell); // NEW
        return { // NEW
            parent: parent || null, // NEW
            child: children[0] || null, // NEW
            previousSibling: index > 0 ? siblings[index - 1] : null, // NEW
            nextSibling: index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null // NEW
        }; // NEW
    } // NEW

    function selectCell(cell, center) { // NEW
        if (graph.setSelectionCell) graph.setSelectionCell(cell); // NEW
        else graph.selectionCell = cell; // NEW
        if (center && graph.scrollCellToVisible) graph.scrollCellToVisible(cell, true); // NEW
    } // NEW

    function deriveHudPaths(moduleCell) { // NEW
        const paths = []; // NEW
        collectHudEndpoints(moduleCell, "bed").forEach(function (bedEndpoint) { // NEW
            const route = routeToSource(moduleCell, bedEndpoint); // NEW
            if (!route || !route.source) return; // NEW
            const bedCell = findEndpointBed(bedEndpoint); // NEW
            const cellIds = route.cells.map(getCellId).filter(Boolean); // NEW
            const partIds = route.cells.filter(function (cell) { return getCellAttr(cell, ATTRS.COMPONENT, "") === "1"; }).map(function (cell) { return getCellAttr(cell, ATTRS.CATALOG_PART_ID, ""); }).filter(Boolean); // NEW
            const branchIds = route.cells.filter(function (cell) { return BRANCH_CATEGORIES.has(getCellAttr(cell, ATTRS.COMPONENT_TYPE, "")); }).map(getCellId).filter(Boolean); // NEW
            const pipeIds = route.edges.map(getCellId).filter(Boolean); // NEW
            const path = stagePath({ // NEW
                id: "hud_" + sanitizeId(getCellId(route.source) + "_" + getCellId(bedEndpoint)), // NEW
                sourceEndpoint: route.source, // NEW
                targetEndpoint: bedEndpoint, // NEW
                targetBedId: getCellId(bedCell) || "", // NEW
                branchpointIds: branchIds, // NEW
                partIds, // NEW
                pipePartId: getCellAttr(route.edges[0], ATTRS.PIPE_PART_ID, "") // NEW
            }); // NEW
            path.componentCellIds = cellIds.filter(function (id) { // NEW
                const cell = findCellById(moduleCell, id); // NEW
                return cell && getCellAttr(cell, ATTRS.COMPONENT, "") === "1"; // NEW
            }); // NEW
            path.pipeEdgeIds = pipeIds; // NEW
            const template = safeJsonParse(getCellAttr(bedCell, ATTRS.BED_TEMPLATE_JSON, ""), null); // NEW
            if (template) { // NEW
                path.bedTemplateCommitted = true; // NEW
                path.bedTemplate = template; // NEW
                path.bedDemand = template.demand || null; // CHANGE
            } // NEW
            path.hydraulic = calculatePathHydraulics(moduleCell, path); // NEW
            paths.push(path); // NEW
        }); // NEW
        return paths; // NEW
    } // NEW

    function routeToSource(moduleCell, bedEndpoint) { // NEW
        const cells = []; // NEW
        const edges = []; // NEW
        const seen = new Set(); // NEW
        let cur = bedEndpoint; // NEW
        while (cur) { // NEW
            const id = getCellId(cur); // NEW
            if (!id || seen.has(id)) return null; // NEW
            seen.add(id); // NEW
            if (endpointType(cur) === "source") return { source: cur, cells: cells.reverse(), edges: edges.reverse() }; // NEW
            const incoming = incomingHudEdges(moduleCell, cur)[0]; // NEW
            if (!incoming) return null; // NEW
            cells.push(cur); // NEW
            edges.push(incoming); // NEW
            cur = incoming.source; // NEW
        } // NEW
        return null; // NEW
    } // NEW

    function deriveAssemblyPaths(moduleCell) { // NEW
        const paths = []; // NEW
        collectDescendants(moduleCell, function (cell) { return isAssembly(cell) && assemblyType(cell) === "bed"; }).forEach(function (bedEndpoint) { // CHANGE
            const route = routeAssemblyToSource(moduleCell, bedEndpoint); // CHANGE
            if (!route || !route.source) return; // NEW
            const bedAssembly = bedEndpoint; // CHANGE
            const bedCell = bedCellForAssembly(moduleCell, bedAssembly); // NEW
            const linkedBedId = getCellId(bedCell) || getCellAttr(bedAssembly, ATTRS.LINKED_BED_ID, getCellId(bedAssembly) || ""); // CHANGE
            const cellIds = route.cells.map(getCellId).filter(Boolean); // NEW
            const partIds = route.cells.filter(function (cell) { return getCellAttr(cell, ATTRS.COMPONENT, "") === "1"; }).map(function (cell) { return getCellAttr(cell, ATTRS.CATALOG_PART_ID, ""); }).filter(Boolean); // NEW
            const pipeEdges = route.edges.filter(function (edge) { return getCellAttr(edge, ATTRS.PIPE_EDGE, "") === "1"; }); // NEW
            const pipeIds = pipeEdges.map(getCellId).filter(Boolean); // CHANGE
            const pipePartIds = pipeEdges.map(function (edge) { return getCellAttr(edge, ATTRS.PIPE_PART_ID, ""); }).filter(Boolean); // CHANGE
            const pipeSegments = pipeEdges.map(function (edge) { return { edgeId: getCellId(edge) || "", pipePartId: getCellAttr(edge, ATTRS.PIPE_PART_ID, ""), lengthFt: measuredEdgeLengthFeet(edge) }; }).filter(function (segment) { return !!segment.pipePartId; }); // CHANGE
            const path = makeDerivedAssemblyPath({ // CHANGE
                id: "assembly_" + sanitizeId(getCellId(route.source) + "_" + getCellId(bedEndpoint)), // NEW
                sourceEndpoint: route.source, // NEW
                targetEndpoint: bedEndpoint, // NEW
                targetBedId: linkedBedId, // NEW
                branchpointIds: route.cells.filter(function (cell) { return BRANCH_CATEGORIES.has(getCellAttr(cell, ATTRS.COMPONENT_TYPE, "")); }).map(getCellId).filter(Boolean), // NEW
                partIds, // NEW
                pipePartId: pipePartIds[0] || "", // CHANGE
                pipeSegments // CHANGE
            }); // NEW
            path.componentCellIds = cellIds.filter(function (id) { // NEW
                const cell = findCellById(moduleCell, id); // NEW
                return cell && getCellAttr(cell, ATTRS.COMPONENT, "") === "1"; // NEW
            }); // NEW
            path.pipeEdgeIds = pipeIds; // NEW
            path.pipePartIds = pipePartIds; // NEW
            const template = safeJsonParse(getCellAttr(bedCell, ATTRS.BED_TEMPLATE_JSON, ""), null); // CHANGE
            if (template) { // NEW
                path.bedTemplateCommitted = true; // NEW
                path.bedTemplate = template; // NEW
                path.bedDemand = cumulativeBedDemand(moduleCell, bedAssembly); // CHANGE
            } // NEW
            path.hydraulic = calculatePathHydraulics(moduleCell, path); // NEW
            paths.push(path); // NEW
        }); // NEW
        return paths; // NEW
    } // NEW

    function routeAssemblyToSource(moduleCell, bedEndpoint) { // NEW
        const cells = []; // NEW
        const edges = []; // NEW
        const seen = new Set(); // NEW
        let cur = bedEndpoint; // NEW
        while (cur) { // NEW
            const id = getCellId(cur); // NEW
            if (!id || seen.has(id)) return null; // NEW
            seen.add(id); // NEW
            if (endpointType(cur) === "source") return { source: cur, cells: cells.reverse(), edges: edges.reverse() }; // NEW
            cells.push(cur); // NEW
            const incoming = incomingAssemblyEdges(moduleCell, cur)[0]; // NEW
            if (incoming) { edges.push(incoming); cur = incoming.source; continue; } // CHANGE
            cur = internalNeighborForPort(cur, "input"); // NEW
        } // NEW
        return null; // NEW
    } // NEW

    function syncHudGraphState(moduleCell) { // NEW
        const paths = deriveAssemblyPaths(moduleCell); // CHANGE
        generateReport(moduleCell); // NEW
        return paths; // NEW
    } // NEW

    function scheduleHudGraphStateSync(moduleCell) { // NEW
        if (!moduleCell) return null; // NEW
        hudSyncModuleCell = moduleCell; // NEW
        if (hudSyncTimer && typeof clearTimeout === "function") clearTimeout(hudSyncTimer); // NEW
        if (typeof setTimeout !== "function") return syncHudGraphState(moduleCell); // NEW
        hudSyncTimer = setTimeout(function () { // NEW
            const target = hudSyncModuleCell; // NEW
            hudSyncTimer = null; // NEW
            hudSyncModuleCell = null; // NEW
            if (target) syncHudGraphState(target); // NEW
        }, HUD_SYNC_DEBOUNCE_MS); // NEW
        return null; // NEW
    } // NEW

    function flushHudGraphStateSync() { // NEW
        const target = hudSyncModuleCell; // NEW
        if (hudSyncTimer && typeof clearTimeout === "function") clearTimeout(hudSyncTimer); // NEW
        hudSyncTimer = null; // NEW
        hudSyncModuleCell = null; // NEW
        return target ? syncHudGraphState(target) : []; // NEW
    } // NEW

    function firstPathForBedEndpoint(moduleCell, inletCell) { // NEW
        return deriveHudPaths(moduleCell).find(function (path) { return path.targetEndpointId === getCellId(inletCell); }) || null; // NEW
    } // NEW

    function firstAssemblyPathForBedAssembly(moduleCell, bedAssembly) { // NEW
        return deriveAssemblyPaths(moduleCell).find(function (path) { return path.targetEndpointId === getCellId(bedAssembly); }) || null; // CHANGE
    } // NEW

    function deleteHudIrrigationCell(session, cell) { // NEW
        model.beginUpdate && model.beginUpdate(); // NEW
        try { // NEW
            incomingHudEdges(session.moduleCell, cell).concat(outgoingHudEdges(session.moduleCell, cell)).forEach(removeCellFromParent); // NEW
            removeCellFromParent(cell); // NEW
            selectCell(session.moduleCell, false); // NEW
            scheduleHudGraphStateSync(session.moduleCell); // CHANGE
        } finally { // NEW
            model.endUpdate && model.endUpdate(); // NEW
        } // NEW
        renderIrrigationMode(session); // NEW
    } // NEW

    function removeCellFromParent(cell) { // NEW
        if (!cell) return; // NEW
        if (model.remove) { model.remove(cell); return; } // NEW
        const parent = model.getParent ? model.getParent(cell) : cell && cell.parent; // NEW
        if (!parent || !parent.children) return; // NEW
        const index = parent.children.indexOf(cell); // NEW
        if (index >= 0) parent.children.splice(index, 1); // NEW
    } // NEW

    function appendOverlayNode(node) { // NEW
        const host = overlayHost(); // NEW
        if (host) host.appendChild(node); // NEW
        else irrigationDebug("appendOverlayNode:no-host", { nodeClass: node && node.className }); // NEW
    } // NEW

    function overlayHost() { // NEW
        const pane = graph.view && graph.view.overlayPane ? graph.view.overlayPane : null; // NEW
        if (pane && pane.namespaceURI !== "http://www.w3.org/2000/svg") return pane; // CHANGE
        return graph.container || pane; // CHANGE
    } // NEW

    function removeHudNode(node) { // NEW
        if (node && node.parentNode) node.parentNode.removeChild(node); // NEW
    } // NEW

    function removeNodeList(nodes) { // NEW
        (nodes || []).forEach(removeHudNode); // NEW
        if (nodes) nodes.length = 0; // NEW
    } // NEW

    function installInactiveIrrigationEntryOverlay() { // NEW
        const selectionModel = graph.getSelectionModel && graph.getSelectionModel(); // NEW
        if (selectionModel && selectionModel.addListener && typeof mxEvent !== "undefined") selectionModel.addListener(mxEvent.CHANGE, scheduleInactiveEntryOverlayRefresh); // NEW
        if (model.addListener && typeof mxEvent !== "undefined") model.addListener(mxEvent.CHANGE, scheduleInactiveEntryOverlayRefresh); // NEW
        if (graph.view && graph.view.addListener && typeof mxEvent !== "undefined") { // NEW
            [mxEvent.SCALE, mxEvent.TRANSLATE, mxEvent.SCALE_AND_TRANSLATE, mxEvent.REPAINT].forEach(function (eventName) { // NEW
                if (eventName) graph.view.addListener(eventName, scheduleInactiveEntryOverlayRefresh); // NEW
            }); // NEW
        } // NEW
        if (graph.container && graph.container.addEventListener) graph.container.addEventListener("scroll", scheduleInactiveEntryOverlayRefresh, { passive: true }); // NEW
        scheduleInactiveEntryOverlayRefresh(); // NEW
    } // NEW

    function scheduleInactiveEntryOverlayRefresh() { // NEW
        if (inactiveEntryRefreshTimer != null && typeof clearTimeout === "function") clearTimeout(inactiveEntryRefreshTimer); // NEW
        inactiveEntryRefreshTimer = typeof setTimeout === "function" ? setTimeout(function () { inactiveEntryRefreshTimer = null; refreshInactiveEntryOverlay(); }, 0) : null; // NEW
        if (inactiveEntryRefreshTimer == null) refreshInactiveEntryOverlay(); // NEW
    } // NEW

    function refreshInactiveEntryOverlay() { // NEW
        removeHudNode(inactiveEntryOverlay); // NEW
        inactiveEntryOverlay = null; // NEW
        if (activeIrrigationMode) return; // NEW
        const selected = graph.getSelectionCell && graph.getSelectionCell(); // NEW
        if (!isInactiveIrrigationEntryTarget(selected)) return; // NEW
        const moduleCell = findGardenModuleAncestor(selected); // NEW
        if (!moduleCell) return; // NEW
        const btn = button("Enter Irrigation Design Mode", function (evt) { // NEW
            if (evt && evt.stopPropagation) evt.stopPropagation(); // NEW
            openIrrigationMode(moduleCell, { selectCell: selected, preserveViewport: true }); // NEW
        }); // NEW
        btn.className = "trellis-irrigation-enter-mode"; // NEW
        btn.style.cssText = "position:absolute;z-index:1005;padding:5px 8px;border:1px solid #2563eb;border-radius:4px;background:#eff6ff;color:#1e3a8a;box-shadow:0 2px 8px rgba(0,0,0,.18);font:bold 12px Arial,sans-serif;cursor:pointer;white-space:nowrap;"; // NEW
        if (typeof mxEvent !== "undefined" && mxEvent.addListener) mxEvent.addListener(btn, "mousedown", function (evt) { mxEvent.consume(evt); }); // NEW
        appendOverlayNode(btn); // NEW
        positionInactiveEntryOverlay(btn, selected); // NEW
        inactiveEntryOverlay = btn; // NEW
    } // NEW

    function isInactiveIrrigationEntryTarget(cell) { // NEW
        return !!cell && (isAssemblyModeObject(cell) || isHudIrrigationObject(cell) || isHudPipeEdge(cell)); // NEW
    } // NEW

    function positionInactiveEntryOverlay(node, cell) { // NEW
        const state = cellState(cell); // NEW
        const width = node.offsetWidth || node.clientWidth || 170; // NEW
        node.style.left = Math.round(Math.max(0, state.x + state.width + 8)) + "px"; // NEW
        node.style.top = Math.round(Math.max(0, state.y - 2)) + "px"; // NEW
        node.style.maxWidth = Math.max(120, width) + "px"; // NEW
    } // NEW

    function positionHudForSelection(hud, selected, session) { // CHANGE
        if (isAssemblyModeObject(selected) || isHudIrrigationObject(selected) || isGardenBed(selected)) { // CHANGE
            const state = cellState(selected); // NEW
            const width = hud.offsetWidth || hud.clientWidth || 260; // NEW
            hud.style.left = Math.round(Math.max(0, state.x - width - 12)) + "px"; // CHANGE
            hud.style.top = Math.round(Math.max(0, state.y)) + "px"; // CHANGE
            return; // NEW
        } // NEW
        if (session && session.lastModelPoint) { // NEW
            positionHudLeftOfModulePoint(hud, session.moduleCell, session.lastModelPoint); // NEW
            return; // NEW
        } // NEW
        positionModuleHudAtViewportCenter(hud); // CHANGE
    } // NEW

    function positionHudLeftOfModulePoint(hud, moduleCell, point) { // NEW
        const moduleBounds = cellBoundsInModel(moduleCell) || { x: 0, y: 0 }; // NEW
        const scale = finiteNumber(graph.view && graph.view.scale, 1) || 1; // NEW
        const translate = graph.view && graph.view.translate ? graph.view.translate : { x: 0, y: 0 }; // NEW
        const modelX = finiteNumber(moduleBounds.x, 0) + finiteNumber(point && point.x, 0); // NEW
        const modelY = finiteNumber(moduleBounds.y, 0) + finiteNumber(point && point.y, 0); // NEW
        const width = hud.offsetWidth || hud.clientWidth || 260; // NEW
        hud.style.left = Math.round(Math.max(0, (modelX + finiteNumber(translate.x, 0)) * scale - width - 12)) + "px"; // NEW
        hud.style.top = Math.round(Math.max(0, (modelY + finiteNumber(translate.y, 0)) * scale)) + "px"; // NEW
    } // NEW

    function collectIrrigationWorkspaceCells(moduleCell) { // NEW
        const cells = collectGardenBeds(moduleCell).slice(); // NEW
        collectDescendants(moduleCell, isAssembly).forEach(function (cell) { cells.push(cell); }); // NEW
        collectHudEndpoints(moduleCell, "source").forEach(function (cell) { cells.push(cell); }); // NEW
        collectHudEndpoints(moduleCell, "bed").forEach(function (cell) { cells.push(cell); }); // NEW
        return cells.filter(function (cell, index) { return cell && cells.indexOf(cell) === index; }); // NEW
    } // NEW

    function boundsForCells(cells) { // NEW
        let bounds = null; // NEW
        (cells || []).forEach(function (cell) { // NEW
            const geo = cellBoundsInModel(cell); // NEW
            if (!geo) return; // NEW
            const x = finiteNumber(geo.x, 0); // NEW
            const y = finiteNumber(geo.y, 0); // NEW
            const width = Math.max(0, finiteNumber(geo.width, 0)); // NEW
            const height = Math.max(0, finiteNumber(geo.height, 0)); // NEW
            if (!bounds) bounds = { x, y, width, height }; // NEW
            else { // NEW
                const right = Math.max(bounds.x + bounds.width, x + width); // NEW
                const bottom = Math.max(bounds.y + bounds.height, y + height); // NEW
                bounds.x = Math.min(bounds.x, x); // NEW
                bounds.y = Math.min(bounds.y, y); // NEW
                bounds.width = right - bounds.x; // NEW
                bounds.height = bottom - bounds.y; // NEW
            } // NEW
        }); // NEW
        return bounds; // NEW
    } // NEW

    function cellBoundsInModel(cell) { // NEW
        const state = graph.view && graph.view.getState ? graph.view.getState(cell) : null; // NEW
        if (state && Number.isFinite(Number(state.x)) && Number.isFinite(Number(state.y))) { // NEW
            const scale = finiteNumber(graph.view && graph.view.scale, 1) || 1; // NEW
            const translate = graph.view && graph.view.translate ? graph.view.translate : { x: 0, y: 0 }; // NEW
            return { // NEW
                x: finiteNumber(state.x, 0) / scale - finiteNumber(translate.x, 0), // NEW
                y: finiteNumber(state.y, 0) / scale - finiteNumber(translate.y, 0), // NEW
                width: finiteNumber(state.width, 0) / scale, // NEW
                height: finiteNumber(state.height, 0) / scale // NEW
            }; // NEW
        } // NEW
        const geo = getGeometry(cell); // NEW
        if (!geo) return null; // NEW
        let x = finiteNumber(geo.x, 0); // NEW
        let y = finiteNumber(geo.y, 0); // NEW
        let parent = model.getParent ? model.getParent(cell) : cell && cell.parent; // NEW
        while (parent) { // CHANGE
            const parentGeo = getGeometry(parent); // NEW
            if (parentGeo) { // NEW
                x += finiteNumber(parentGeo.x, 0); // NEW
                y += finiteNumber(parentGeo.y, 0); // NEW
            } // NEW
            parent = model.getParent ? model.getParent(parent) : parent.parent; // NEW
        } // NEW
        return { x, y, width: finiteNumber(geo.width, 0), height: finiteNumber(geo.height, 0) }; // NEW
    } // NEW

    function frameIrrigationWorkspace(moduleCell) { // NEW
        const workspaceCells = collectIrrigationWorkspaceCells(moduleCell); // NEW
        const targetCells = workspaceCells.length ? workspaceCells : [moduleCell]; // NEW
        const rawBounds = boundsForCells(targetCells); // NEW
        const bounds = padBounds(rawBounds, 48); // NEW
        irrigationDebug("frameIrrigationWorkspace:bounds", { // NEW
            module: debugCellSummary(moduleCell), // NEW
            workspaceCells: workspaceCells.map(debugCellSummary), // NEW
            targetCells: targetCells.map(debugCellSummary), // NEW
            rawBounds, // NEW
            paddedBounds: bounds, // NEW
            overlayHost: debugOverlayHostSummary() // NEW
        }); // NEW
        if (!bounds) { // NEW
            irrigationDebug("frameIrrigationWorkspace:fallback-no-bounds", { method: graph.scrollCellToVisible ? "scrollCellToVisible" : "none" }); // NEW
            if (graph.scrollCellToVisible) graph.scrollCellToVisible(moduleCell, true); // NEW
            return null; // NEW
        } // NEW
        if (typeof graph.fitWindow === "function") { // NEW
            irrigationDebug("frameIrrigationWorkspace:apply", { method: "fitWindow", bounds, border: 16 }); // NEW
            graph.fitWindow(bounds, 16); // NEW
            return bounds; // NEW
        } // NEW
        if (typeof graph.scrollRectToVisible === "function") { // NEW
            irrigationDebug("frameIrrigationWorkspace:apply", { method: "scrollRectToVisible", bounds }); // NEW
            graph.scrollRectToVisible(bounds); // NEW
            return bounds; // NEW
        } // NEW
        irrigationDebug("frameIrrigationWorkspace:apply", { method: graph.fit ? "fit+scrollCellToVisible" : "scrollCellToVisible", bounds }); // NEW
        if (typeof graph.fit === "function") graph.fit(48); // NEW
        if (graph.scrollCellToVisible) graph.scrollCellToVisible(targetCells[0] || moduleCell, true); // NEW
        return bounds; // NEW
    } // NEW

    function padBounds(bounds, padding) { // NEW
        if (!bounds) return null; // NEW
        const pad = Math.max(0, finiteNumber(padding, 0)); // NEW
        return { x: bounds.x - pad, y: bounds.y - pad, width: bounds.width + pad * 2, height: bounds.height + pad * 2 }; // NEW
    } // NEW

    function positionModuleHudAtViewportCenter(hud) { // NEW
        const host = overlayHost() || graph.container; // NEW
        const width = hud.offsetWidth || hud.clientWidth || 260; // NEW
        const height = hud.offsetHeight || hud.clientHeight || 160; // NEW
        const left = (host && Number.isFinite(Number(host.scrollLeft)) ? Number(host.scrollLeft) : 0) + (host && host.clientWidth ? host.clientWidth : 800) / 2 - width / 2; // NEW
        const top = (host && Number.isFinite(Number(host.scrollTop)) ? Number(host.scrollTop) : 0) + (host && host.clientHeight ? host.clientHeight : 600) / 2 - height / 2; // NEW
        hud.style.left = Math.round(Math.max(0, left)) + "px"; // NEW
        hud.style.top = Math.round(Math.max(0, top)) + "px"; // NEW
    } // NEW

    function irrigationDebug(label, data) { // NEW
        if (typeof console === "undefined" || !console || !console.log) return; // NEW
        try { console.log("[Trellis Irrigation] " + label, data || {}); } catch (_) {} // NEW
    } // NEW

    function debugCellSummary(cell) { // NEW
        if (!cell) return null; // NEW
        const geo = getGeometry(cell); // NEW
        return { // NEW
            id: getCellId(cell), // NEW
            label: getCellAttr(cell, "label", ""), // NEW
            gardenModule: isGardenModule(cell), // NEW
            gardenBed: isGardenBed(cell), // NEW
            endpointType: endpointType(cell), // NEW
            generated: isLegacyGenerated(cell), // NEW
            geometry: geo ? { x: geo.x, y: geo.y, width: geo.width, height: geo.height } : null, // NEW
            modelBounds: cellBoundsInModel(cell) // NEW
        }; // NEW
    } // NEW

    function debugOverlayHostSummary() { // NEW
        const host = overlayHost() || graph.container; // NEW
        if (!host) return null; // NEW
        return { // NEW
            className: host.className || "", // NEW
            id: host.id || "", // NEW
            childCount: host.childNodes ? host.childNodes.length : 0, // NEW
            scrollLeft: host.scrollLeft || 0, // NEW
            scrollTop: host.scrollTop || 0, // NEW
            clientWidth: host.clientWidth || 0, // NEW
            clientHeight: host.clientHeight || 0 // NEW
        }; // NEW
    } // NEW

    function scheduleIrrigationDebugSnapshot(session, label) { // NEW
        if (typeof setTimeout !== "function") return; // NEW
        setTimeout(function () { // NEW
            if (!session || activeIrrigationMode !== session) return; // NEW
            irrigationDebug(label, { // NEW
                hudConnected: !!(session.hud && session.hud.parentNode), // NEW
                hudLeft: session.hud && session.hud.style.left, // NEW
                hudTop: session.hud && session.hud.style.top, // NEW
                overlayHost: debugOverlayHostSummary() // NEW
            }); // NEW
        }, 0); // NEW
    } // NEW

    function cellState(cell) { // NEW
        const state = graph.view && graph.view.getState ? graph.view.getState(cell) : null; // NEW
        if (state) return state; // NEW
        const geo = getGeometry(cell) || { x: 0, y: 0, width: 80, height: 30 }; // NEW
        return { x: Number(geo.x || 0), y: Number(geo.y || 0), width: Number(geo.width || 0), height: Number(geo.height || 0) }; // NEW
    } // NEW

    function positionOverlayBox(node, cell, offset) { // NEW
        const state = cellState(cell); // NEW
        node.style.left = Math.round(state.x + (offset || 0)) + "px"; // NEW
        node.style.top = Math.round(state.y + (offset || 0)) + "px"; // NEW
        node.style.width = node.style.width || Math.round(state.width) + "px"; // NEW
        node.style.height = node.style.height || Math.round(state.height) + "px"; // NEW
    } // NEW

    function positionNavigatorButton(node, cell, dx, dy) { // NEW
        const state = cellState(cell); // NEW
        node.style.left = Math.round(state.x + state.width + dx) + "px"; // NEW
        node.style.top = Math.round(state.y + state.height / 2 + dy) + "px"; // NEW
    } // NEW

    function appendSelectOption(select, value, label) {
        const option = document.createElement("option");
        option.value = value || "";
        option.textContent = label || value || "";
        select.appendChild(option);
    }

    function html(value) {
        if (typeof mxUtils !== "undefined" && mxUtils.htmlEntities) return mxUtils.htmlEntities(String(value == null ? "" : value));
        return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
            return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[ch];
        });
    }

    function button(label, fn) {
        if (typeof mxUtils !== "undefined" && mxUtils.button) return mxUtils.button(label, fn);
        const b = document.createElement("button");
        b.textContent = label;
        b.addEventListener("click", fn);
        return b;
    }

    function showDialog(node, w, h) {
        if (ui.showDialog) ui.showDialog(node, w, h, true, true);
        else if (document && document.body) document.body.appendChild(node);
    }

    function hideDialog() {
        if (ui.hideDialog) ui.hideDialog();
    }

    function alertUser(message) {
        if (ui.alert) ui.alert(message);
        else if (typeof alert !== "undefined") alert(message);
    }

    function addActionAndMenus() {
        if (ui.actions && ui.actions.addAction) {
            ui.actions.addAction(ACTION_ID, function () {
                const selection = graph.getSelectionCell && graph.getSelectionCell();
                openIrrigationMode(findGardenModuleAncestor(selection) || selection); // CHANGE
            });
            ui.actions.addAction(CREATE_SOURCE_ACTION_ID, function () {
                const selection = graph.getSelectionCell && graph.getSelectionCell();
                const moduleCell = isGardenModule(selection) ? selection : findGardenModuleAncestor(selection);
                if (!moduleCell) return alertUser("Select a Trellis garden module first.");
                openIrrigationMode(moduleCell, { sourceForm: true, preserveViewport: true }); // CHANGE
            });
            ui.actions.addAction(CREATE_BED_ACTION_ID, function () {
                const selection = graph.getSelectionCell && graph.getSelectionCell();
                const bed = isGardenBed(selection) ? selection : findBedAncestor(selection);
                if (!bed) return alertUser("Select a garden bed first.");
                openIrrigationMode(findGardenModuleAncestor(bed), { selectCell: bed, preserveViewport: true }); // CHANGE
            });
            ui.actions.addAction(CREATE_BRANCH_ACTION_ID, function () {
                const selection = graph.getSelectionCell && graph.getSelectionCell();
                const moduleCell = isGardenModule(selection) ? selection : findGardenModuleAncestor(selection);
                if (!moduleCell) return alertUser("Select a Trellis garden module first.");
                openIrrigationMode(moduleCell, { message: "Use Add Part on a selected source or part to place branch-capable catalog parts.", preserveViewport: true }); // CHANGE
            });
        }
    }

    graph.__trellisIrrigationPlanner = {
        attrs: ATTRS,
        categories: PART_CATEGORIES.slice(),
        stockStates: VALID_STOCK_STATES.slice(),
        bedTemplates: BED_TEMPLATES.slice(),
        readCatalog,
        writeCatalog,
        starterCatalog,
        seedStarterCatalogIfEmpty,
        upsertCatalogPart,
        deleteCatalogPart,
        validateCatalogPart,
        canConnectParts,
        canPartReachEndpoint,
        compatibleNextParts,
        compatibleFirstParts,
        groupPartsByStock,
        healEndpoint,
        generateReport,
        readDashboardSummary,
        readZones, // NEW
        writeZones, // NEW
        syncZones, // NEW
        deriveInferredTimerZones, // NEW
        resolveEffectiveZoneMembership, // NEW
        zoneSummary, // NEW
        assignBedsToZone, // NEW
        resetBedZoneOverrides, // NEW
        createManualZone, // NEW
        openIrrigationMode, // NEW
        closeIrrigationMode, // NEW
        openCatalogManager,
        __test: {
            normalizeCatalogPart,
            normalizeEndpointProfile,
            connectorMatches, // NEW
            collectGardenBeds,
            collectEndpoints,
            bedAreaM2,
            pathBlockingErrors,
            validatePathGraph,
            validatePathCompatibility,
            validateSharedCapacity,
            createSourceEndpoint, // CHANGE
            createBedEndpoint, // CHANGE
            createBranchpointEndpoint, // CHANGE
            ensureBedEndpoint, // CHANGE
            buildPairQueue, // CHANGE
            stagePath, // CHANGE
            commitStagedPath, // CHANGE
            commitBedTemplate, // CHANGE
            calculatePathHydraulics, // CHANGE
            estimatePathHydraulics, // CHANGE
            hazenWilliamsPsiLoss, // CHANGE
            pathRouteLengthFeet,
            partCostForReport,
            readPaths,
            writePaths,
            normalizeZone, // NEW
            readZones, // NEW
            writeZones, // NEW
            syncZones, // NEW
            deriveInferredTimerZones, // NEW
            downstreamBedAssemblyIdsFromTimerOutlet, // NEW
            resolveEffectiveZoneMembership, // NEW
            zoneSummary, // NEW
            assignBedsToZone, // NEW
            resetBedZoneOverrides, // NEW
            createManualZone, // NEW
            createSourceAssembly, // NEW
            createPartAssembly, // NEW
            createBedAssembly, // NEW
            createAssemblyConnection, // NEW
            validatePortConnection, // NEW
            boundaryForPort, // NEW
            internalConnectionBoundariesForSelection, // NEW
            disconnectBoundary, // NEW
            disconnectBoundaries, // NEW
            deleteAssemblyPartCell, // NEW
            assemblyCanReverse, // NEW
            positionPortBadge, // NEW
            bridgeSuggestionsForPorts, // NEW
            applyBridgeSuggestion, // NEW
            deriveAssemblyPaths, // NEW
            firstAssemblyPart, // NEW
            lastAssemblyPart, // NEW
            assemblyPartCells, // NEW
            collectAssemblyEdges, // NEW
            collectHudObjects, // NEW
            collectHudEndpoints, // NEW
            collectHudPipeEdges, // NEW
            deriveHudPaths, // NEW
            syncHudGraphState, // NEW
            scheduleHudGraphStateSync, // NEW
            flushHudGraphStateSync, // NEW
            validateHudConnection, // CHANGE
            addPartPickerParts, // NEW
            addPartContextFromPort, // NEW
            collectUpstreamBranchParts, // NEW
            upstreamSingletonCategories, // NEW
            sortAddPartPickerParts // NEW
        }
    };

    if (typeof window !== "undefined") {
        window.TrellisIrrigationPlanner = graph.__trellisIrrigationPlanner;
    }

    addActionAndMenus();
    installInactiveIrrigationEntryOverlay(); // NEW
});
