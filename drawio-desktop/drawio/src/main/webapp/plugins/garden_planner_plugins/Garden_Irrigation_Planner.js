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

    const PLUGIN_VERSION = 4; // CHANGE
    const ACTION_ID = "trellisIrrigationPlanner";
    const CREATE_SOURCE_ACTION_ID = "trellisIrrigationCreateSourceEndpoint";
    const CREATE_BED_ACTION_ID = "trellisIrrigationCreateBedEndpoint";
    const CREATE_BRANCH_ACTION_ID = "trellisIrrigationCreateBranchpointEndpoint";
    const MODE_CHANGED_EVENT = "trellisIrrigationModeChanged"; // NEW
    const PX_PER_CM = 5;
    const DRAW_SCALE = 0.18;
    const CM_PER_FOOT = 30.48;
    const CM_PER_INCH = 2.54; // NEW
    const HUD_SYNC_DEBOUNCE_MS = 200; // NEW
    const TRELLIS_DIALOG_Z = 2000000000; // NEW

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
        PART_STATE: "irrigation_part_state", // NEW
        PATH_ID: "irrigation_path_id",
        GENERATED: "irrigation_generated",
        PIPE_EDGE: "irrigation_pipe_edge",
        DIRECT_LINK_EDGE: "irrigation_direct_link_edge", // NEW
        PIPE_PART_ID: "irrigation_pipe_part_id",
        ASSEMBLY: "irrigation_assembly", // NEW
        ASSEMBLY_TYPE: "irrigation_assembly_type", // NEW
        LINKED_BED_ID: "irrigation_linked_bed_id", // NEW
        BED_PORTS_JSON: "irrigation_bed_ports_json", // NEW
        EDGE_SOURCE_PORT: "irrigation_edge_source_port", // NEW
        EDGE_TARGET_PORT: "irrigation_edge_target_port", // NEW
        BED_TEMPLATE_JSON: "irrigation_bed_template_json",
        BED_SUPPLY_LINE: "irrigation_bed_supply_line", // NEW
        BED_LAYOUT: "irrigation_bed_layout"
    };

    const STOCK_AVAILABLE = new Set(["in_stock", "low_stock"]);
    const PURCHASE_NEEDED = new Set(["out_of_stock", "unknown"]);
    const BRANCH_CATEGORIES = new Set(["valve", "manifold", "controller_timer"]);
    const BRANCH_SINGLETON_CATEGORIES = new Set(["backflow", "filter", "regulator", "controller_timer"]); // NEW
    const BRIDGE_SUGGESTION_CATEGORIES = new Set(["fitting", "source_adapter"]); // NEW
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
    const PORT_BADGE_MIN_WIDTH = 30; // NEW
    const PORT_BADGE_MAX_WIDTH = 78; // NEW
    const PORT_BADGE_ARROW_SIZE = 6; // NEW
    const GRAPH_OVERLAY_Z = Object.freeze({ ANNOTATION: 10000, CONNECTION: 10010, CONTROL: 10020, CONTROL_TOP: 10030 }); // NEW
    const FIXED_CONNECTOR_TYPES = ["mght", "fght", "mpt", "fpt", "barb", "twist_lock", "push_connect"]; // CHANGE
    const PIPE_CONNECTOR_TYPES = new Set(["barb", "twist_lock", "push_connect"]); // NEW
    const FIXED_CONNECTOR_SIZES = ["1/4", "1/2", "3/4", "1"]; // NEW
    const PIPE_EDGE_BASE_STYLE = "edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#2f80ed;"; // NEW
    const GENERATED_PIPE_EDGE_BASE_STYLE = "edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#4d8f6f;"; // NEW
    const DIRECT_LINK_EDGE_STYLE = "edgeStyle=orthogonalEdgeStyle;rounded=0;dashed=1;html=1;strokeColor=#7c3aed;"; // NEW
    const PART_STATE_PLANNED = "planned"; // NEW
    const PART_STATE_COMPLETED = "completed"; // NEW
    const ASSEMBLY_PART_PLANNED_STYLE = "rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#4b5563;fontColor=#111827;fontSize=10;editable=0;deletable=0;resizable=0;connectable=0;"; // NEW
    const ASSEMBLY_PART_COMPLETED_STYLE = "rounded=1;whiteSpace=wrap;html=1;fillColor=#e8f5e9;strokeColor=#82b366;fontColor=#2f6b3c;fontSize=10;editable=0;deletable=0;resizable=0;connectable=0;"; // NEW
    const BED_LAYOUT_PLANNED_STYLE = "rounded=0;whiteSpace=wrap;html=1;fillColor=#e1f5fe;strokeColor=#0288d1;fontSize=8;"; // NEW
    const BED_LAYOUT_COMPLETED_STYLE = "rounded=0;whiteSpace=wrap;html=1;fillColor=#e8f5e9;strokeColor=#82b366;fontColor=#2f6b3c;fontSize=8;"; // NEW
    const CONNECTION_COMBOBOX_COLLAPSED_STORAGE_KEY = "trellis.irrigation.connectionCombobox.collapsed.v1"; // NEW
    const PIPE_EDGE_STROKE_UNIT_IN = 0.25; // NEW
    const PIPE_EDGE_MAX_STROKE_WIDTH = 12; // NEW
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

    const BED_TEMPLATE_MODEL_BOM = "bom"; // NEW
    const BED_ASSEMBLY_LABEL_HIDDEN = "hidden"; // NEW
    const METERS_PER_FOOT = CM_PER_FOOT / 100; // NEW
    const BED_TEMPLATE_ROW_ORIENTATIONS = ["width", "height"]; // NEW
    const BED_TEMPLATE_ANCHOR_CATEGORIES = new Set(["pipe_tubing", "drip_tape", "dripline"]); // NEW
    const BED_RECIPE_VERSION = 1; // NEW
    const BED_SUPPLY_LINE_STYLE = "rounded=0;whiteSpace=wrap;html=1;fillColor=#d9ead3;strokeColor=#4d8f6f;fontSize=8;editable=0;resizable=0;connectable=0;"; // NEW
    const BED_SELF_EMITTING_ROW_CATEGORIES = new Set(["drip_tape", "dripline"]); // NEW
    const BED_DEVICE_CATEGORIES = new Set(["emitter", "sprinkler", "microspray", "bubbler", "standpipe"]); // NEW
    const BED_SUPPLY_PIPE_BY_SIZE = { "1/2": "poly_distribution_1_2", "3/4": "poly_mainline_3_4", "1": "poly_mainline_1" }; // NEW
    const DISCONNECTED_SOURCE_WARNING = "Irrigation tree is disconnected from a source."; // NEW

    const BED_TEMPLATES = [
        { id: "drip_tape_bed", label: "Drip tape bed", defaultRows: 2, defaultRowOrientation: "width", lineKind: "drip_tape", pipePartId: "poly_distribution_1_2", requiredParts: [{ partId: "drip_tape_8mil_12in", quantityPerRowMeter: 1 }], flowGpm: 1.2, pressurePsi: 10 }, // CHANGE
        { id: "dripline_bed", label: "Dripline bed", defaultRows: 2, defaultRowOrientation: "width", lineKind: "dripline", pipePartId: "poly_distribution_1_2", requiredParts: [{ partId: "pc_dripline_1_2", quantityPerRowMeter: 1 }], flowGpm: 1.0, pressurePsi: 12 }, // CHANGE
        { id: "overhead_sprinkler_block", label: "Overhead sprinkler block", defaultRows: 3, defaultRowOrientation: "width", lineKind: "sprinkler", pipePartId: "poly_distribution_1_2", requiredParts: [{ partId: "poly_distribution_1_2", quantityPerRowMeter: 1 }, { partId: "overhead_sprinkler_head_30psi", quantityPerRowMeter: 1 }], flowGpm: 2.5, pressurePsi: 30 }, // CHANGE
        { id: "nursery_microspray", label: "Nursery/propagation microspray", defaultRows: 3, defaultRowOrientation: "width", lineKind: "microspray", pipePartId: "poly_distribution_1_2", requiredParts: [{ partId: "poly_distribution_1_2", quantityPerRowMeter: 1 }, { partId: "microspray_stake_20psi", quantityPerRowMeter: 1 }], flowGpm: 1.5, pressurePsi: 20 }, // CHANGE
        { id: "soaker_row", label: "Soaker row", defaultRows: 2, defaultRowOrientation: "width", lineKind: "dripline", pipePartId: "poly_distribution_1_2", requiredParts: [{ partId: "soaker_row_line_1_2", quantityPerRowMeter: 1 }], flowGpm: 0.8, pressurePsi: 10 }, // CHANGE
        { id: "perennial_bubbler_row", label: "Orchard/perennial bubbler row", defaultRows: 1, defaultRowOrientation: "width", lineKind: "bubbler", pipePartId: "poly_distribution_1_2", requiredParts: [{ partId: "poly_distribution_1_2", quantityPerRowMeter: 1 }, { partId: "bubbler_emitter_1_2", quantityPerRowMeter: 1 }], flowGpm: 1.0, pressurePsi: 15 }, // CHANGE
        { id: "manual_hose_standpipe", label: "Manual hose standpipe", defaultRows: 1, defaultRowOrientation: "width", lineKind: "standpipe", pipePartId: "poly_distribution_1_2", requiredParts: [{ partId: "poly_distribution_1_2", quantityPerRowMeter: 1 }, { partId: "hose_standpipe_1_2", quantityPerRowMeter: 1 }], flowGpm: 2.0, pressurePsi: 20 } // CHANGE
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
        starterPart("drip_tape_8mil_12in", "8 mil drip tape, 12 in emitter spacing", "drip_tape", 42, 1, 1, input("barb", "1/2", "drip"), output("barb", "1/2", "drip"), { flowGpm: 1.2, flowGpmPerMeter: 1.2, emitterSpacingIn: 12, operatingPressurePsi: 10 }), // CHANGE
        starterPart("pc_dripline_1_2", "1/2 in pressure-compensating dripline", "dripline", 48, 1, 1, input("barb", "1/2", "drip"), output("barb", "1/2", "drip"), { flowGpm: 1.0, flowGpmPerMeter: 1.0, emitterSpacingIn: 12, operatingPressurePsi: 12 }), // CHANGE
        starterPart("micro_emitter_0_5_gph", "1/4 in drip emitter, 0.5 gph", "emitter", 0.45, 1, 0, input("barb", "1/4", "drip"), output("", ""), { flowGpm: 0.0083, operatingPressurePsi: 15 }), // NEW
        starterPart("micro_emitter_1_0_gph", "1/4 in drip emitter, 1.0 gph", "emitter", 0.45, 1, 0, input("barb", "1/4", "drip"), output("", ""), { flowGpm: 0.0167, operatingPressurePsi: 15 }), // NEW
        starterPart("micro_emitter_2_0_gph", "1/4 in drip emitter, 2.0 gph", "emitter", 0.45, 1, 0, input("barb", "1/4", "drip"), output("", ""), { flowGpm: 0.0333, operatingPressurePsi: 15 }), // NEW
        starterPart("overhead_sprinkler_head_30psi", "Overhead sprinkler head/nozzle, 30 psi", "sprinkler", 14, 1, 1, input("barb", "1/2", "sprinkler"), output("barb", "1/2", "sprinkler"), { flowGpm: 2.5, flowGpmPerMeter: 2.5, operatingPressurePsi: 30 }), // CHANGE
        starterPart("microspray_stake_20psi", "Nursery microspray stake, 20 psi", "microspray", 8, 1, 1, input("barb", "1/2", "microspray"), output("barb", "1/2", "microspray"), { flowGpm: 1.5, flowGpmPerMeter: 1.5, operatingPressurePsi: 20 }), // CHANGE
        starterPart("micro_spray_stake_1_4", "1/4 in micro-spray stake, 20 psi", "microspray", 3.5, 1, 0, input("barb", "1/4", "microspray"), output("", ""), { flowGpm: 0.25, operatingPressurePsi: 20 }), // NEW
        starterPart("soaker_row_line_1_2", "1/2 in soaker row line", "dripline", 30, 1, 1, input("barb", "1/2", "drip"), output("barb", "1/2", "drip"), { flowGpm: 0.8, flowGpmPerMeter: 0.8, emitterSpacingIn: 12, operatingPressurePsi: 10 }), // CHANGE
        starterPart("bubbler_emitter_1_2", "Perennial bubbler emitter", "bubbler", 5, 1, 1, input("barb", "1/2", "bubbler"), output("barb", "1/2", "bubbler"), { flowGpm: 1.0, flowGpmPerMeter: 1.0, operatingPressurePsi: 15 }), // CHANGE
        starterPart("hose_standpipe_1_2", "Manual hose standpipe", "standpipe", 22, 1, 1, input("barb", "1/2", "standpipe"), output("barb", "1/2", "standpipe"), { flowGpm: 2.0, flowGpmPerMeter: 2.0, operatingPressurePsi: 20 }) // CHANGE
    ].concat(GENERATED_CONNECTOR_CATALOG_ITEMS); // CHANGE

    let activeIrrigationMode = null; // NEW
    let hudSyncTimer = null; // NEW
    let hudSyncModuleCell = null; // NEW
    let activeConnectionComboboxClose = null; // NEW
    let inactiveEntryOverlay = null; // NEW
    let inactiveEntryRefreshTimer = null; // NEW
    let closingIrrigationModeSession = null; // NEW
    let programmaticEdgeInsertDepth = 0; // FIX
    let activeIrrigationEditDepth = 0; // NEW
    let pendingHudGraphSyncModuleCells = []; // NEW
    let irrigationUndoRedoReplayDepth = 0; // NEW

    installIrrigationUndoRedoReplayGuard(); // NEW

    function runTrellisHistoryTransaction(metadata, operation) { // NEW
        const history = typeof window !== "undefined" && window.Trellis && window.Trellis.history; // NEW
        if (history && typeof history.run === "function" && !isTrellisHistoryRestoring()) { // NEW
            return history.run(metadata, operation); // NEW
        } // NEW
        return operation(); // NEW
    } // NEW

    function isTrellisHistoryRestoring() { // NEW
        const history = typeof window !== "undefined" && window.Trellis && window.Trellis.history; // NEW
        return !!(history && typeof history.isRestoring === "function" && history.isRestoring()); // NEW
    } // NEW

    function runIrrigationEdit(label, fn) { // NEW
        if (activeIrrigationEditDepth > 0) return fn(); // NEW
        return runTrellisHistoryTransaction({ category: "Irrigation", action: label || "edit", origin: "Garden_Irrigation_Planner", title: "Irrigation: " + (label || "edit") }, function () { // NEW
            activeIrrigationEditDepth++; // NEW
            model.beginUpdate && model.beginUpdate(); // NEW
            try { // NEW
                const result = fn(); // NEW
                flushQueuedHudGraphStateSync(); // NEW
                return result; // NEW
            } finally { // NEW
                try { model.endUpdate && model.endUpdate(); } finally { activeIrrigationEditDepth = Math.max(0, activeIrrigationEditDepth - 1); } // NEW
            } // NEW
        }); // NEW
    } // NEW

    function queueHudGraphStateSync(moduleCell) { // NEW
        if (!moduleCell || pendingHudGraphSyncModuleCells.indexOf(moduleCell) >= 0) return; // NEW
        pendingHudGraphSyncModuleCells.push(moduleCell); // NEW
    } // NEW

    function flushQueuedHudGraphStateSync() { // NEW
        if (isTrellisHistoryRestoring()) { pendingHudGraphSyncModuleCells = []; return; } // NEW
        const targets = pendingHudGraphSyncModuleCells.slice(); // NEW
        pendingHudGraphSyncModuleCells = []; // NEW
        targets.forEach(function (moduleCell) { syncHudGraphState(moduleCell); }); // NEW
    } // NEW

    function isIrrigationUndoRedoReplay() { // NEW
        return irrigationUndoRedoReplayDepth > 0 || graph.__trellisIrrigationUndoRedoReplayDepth > 0; // NEW
    } // NEW

    function installIrrigationUndoRedoReplayGuard() { // NEW
        graph.__trellisIrrigationUndoRedoReplayDepth = graph.__trellisIrrigationUndoRedoReplayDepth || 0; // NEW
        if (graph.__trellisIrrigationUndoRedoReplayGuardInstalled) return; // NEW
        graph.__trellisIrrigationUndoRedoReplayGuardInstalled = true; // NEW
        const um = ui && ui.editor && ui.editor.undoManager; // NEW
        if (!um || typeof um.undo !== "function" || typeof um.redo !== "function") return; // NEW
        const oldUndo = um.undo.bind(um); // NEW
        const oldRedo = um.redo.bind(um); // NEW
        um.undo = function () { // NEW
            irrigationUndoRedoReplayDepth++; // NEW
            graph.__trellisIrrigationUndoRedoReplayDepth++; // NEW
            try { return oldUndo(); } finally { irrigationUndoRedoReplayDepth = Math.max(0, irrigationUndoRedoReplayDepth - 1); graph.__trellisIrrigationUndoRedoReplayDepth = Math.max(0, graph.__trellisIrrigationUndoRedoReplayDepth - 1); } // NEW
        }; // NEW
        um.redo = function () { // NEW
            irrigationUndoRedoReplayDepth++; // NEW
            graph.__trellisIrrigationUndoRedoReplayDepth++; // NEW
            try { return oldRedo(); } finally { irrigationUndoRedoReplayDepth = Math.max(0, irrigationUndoRedoReplayDepth - 1); graph.__trellisIrrigationUndoRedoReplayDepth = Math.max(0, graph.__trellisIrrigationUndoRedoReplayDepth - 1); } // NEW
        }; // NEW
    } // NEW

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
        if (!node) return false; // CHANGE
        let changed = false; // NEW
        Object.keys(attrs || {}).forEach(function (key) {
            const value = attrs[key];
            const current = node.getAttribute(key); // NEW
            if (value == null || value === "") { // CHANGE
                if (current != null) { node.removeAttribute(key); changed = true; } // CHANGE
            } else { // NEW
                const next = String(value); // NEW
                if (current !== next) { node.setAttribute(key, next); changed = true; } // CHANGE
            } // NEW
        });
        if (!changed) return false; // NEW
        if (model.setValue) model.setValue(cell, node);
        else cell.value = node;
        return true; // NEW
    }

    function setCellStyle(cell, style) { // NEW
        if (!cell) return false; // NEW
        const next = String(style || ""); // NEW
        if (String(cell.style || "") === next) return false; // NEW
        if (model.setStyle) model.setStyle(cell, next); // NEW
        else cell.style = next; // NEW
        return true; // NEW
    } // NEW

    function styleValue(style, key) { // NEW
        const prefix = String(key || "") + "="; // NEW
        const token = String(style || "").split(";").find(function (part) { return part.indexOf(prefix) === 0; }); // NEW
        return token ? token.slice(prefix.length) : ""; // NEW
    } // NEW

    function setStyleValue(style, key, value) { // NEW
        const prefix = String(key || "") + "="; // NEW
        const parts = String(style || "").split(";").filter(function (part) { return part && part.indexOf(prefix) !== 0; }); // NEW
        if (value != null && value !== "") parts.push(prefix + value); // NEW
        return parts.length ? parts.join(";") + ";" : ""; // NEW
    } // NEW

    function normalizePartState(value) { // NEW
        return String(value || "").trim() === PART_STATE_COMPLETED ? PART_STATE_COMPLETED : PART_STATE_PLANNED; // NEW
    } // NEW

    function partStateForCell(cell) { // NEW
        return normalizePartState(getCellAttr(cell, ATTRS.PART_STATE, "")); // NEW
    } // NEW

    function partStateForRecord(record) { // NEW
        return normalizePartState(record && record.partState); // NEW
    } // NEW

    function isCompletedPartState(state) { // NEW
        return normalizePartState(state) === PART_STATE_COMPLETED; // NEW
    } // NEW

    function assemblyPartStyleForState(state) { // NEW
        return isCompletedPartState(state) ? ASSEMBLY_PART_COMPLETED_STYLE : ASSEMBLY_PART_PLANNED_STYLE; // NEW
    } // NEW

    function bedLayoutStyleForState(state) { // NEW
        return isCompletedPartState(state) ? BED_LAYOUT_COMPLETED_STYLE : BED_LAYOUT_PLANNED_STYLE; // NEW
    } // NEW

    function normalizeLifecycleAttrs(attrs) { // NEW
        return Object.assign({ [ATTRS.PART_STATE]: PART_STATE_PLANNED }, attrs || {}, { [ATTRS.PART_STATE]: normalizePartState(attrs && attrs[ATTRS.PART_STATE]) }); // NEW
    } // NEW

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
        let changed = false; // NEW
        Object.keys(geometryPatch || {}).forEach(function (key) { if (next[key] !== geometryPatch[key]) { next[key] = geometryPatch[key]; changed = true; } }); // CHANGE
        if (!changed) return false; // NEW
        if (model.setGeometry) model.setGeometry(cell, next); // NEW
        else cell.geometry = next; // NEW
        return true; // NEW
    } // NEW

    const GraphStore = { // NEW
        getAttr: getCellAttr, // NEW
        setAttrs: setCellAttrs, // NEW
        getId: getCellId, // NEW
        children: getChildCells, // NEW
        descendants: collectDescendants, // NEW
        geometry: getGeometry, // NEW
        setGeometry, // NEW
        findById: findCellById, // NEW
        readJsonAttr: function (cell, attr, fallback) { return safeJsonParse(getCellAttr(cell, attr, ""), fallback); }, // NEW
        writeJsonAttr: function (cell, attr, value) { const raw = JSON.stringify(value); if (getCellAttr(cell, attr, "") !== raw) setCellAttrs(cell, { [attr]: raw }); return value; } // CHANGE
    }; // NEW

    function unitsToCm(units) {
        return Number(units) / (PX_PER_CM * DRAW_SCALE);
    }

    function unitsToAreaM2(widthUnits, heightUnits) {
        const wM = unitsToCm(widthUnits) / 100;
        const hM = unitsToCm(heightUnits) / 100;
        return Math.max(0, wM * hM);
    }

    function readCatalog(moduleCell) {
        const parsed = GraphStore.readJsonAttr(moduleCell, ATTRS.CATALOG_JSON, null); // CHANGE
        const items = parsed && Array.isArray(parsed.items) ? parsed.items : [];
        const version = parsed && Number.isFinite(Number(parsed.version)) ? Number(parsed.version) : (items.length ? 1 : 0); // NEW
        return {
            version, // CHANGE
            items: items.map(normalizeCatalogPart).filter(Boolean)
        };
    }

    function writeCatalog(moduleCell, catalog) {
        if (activeIrrigationEditDepth === 0) return runIrrigationEdit("writeCatalog", function () { return writeCatalog(moduleCell, catalog); }); // NEW
        const items = (catalog && Array.isArray(catalog.items) ? catalog.items : catalog || [])
            .map(normalizeCatalogPart)
            .filter(Boolean);
        GraphStore.writeJsonAttr(moduleCell, ATTRS.CATALOG_JSON, { version: PLUGIN_VERSION, items }); // CHANGE
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

    function isObsoleteFamilyTubingPart(part) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        return !!(p && p.category === "pipe_tubing" && (/^(twist_lock|push_connect)_tubing_/).test(p.id)); // NEW
    } // NEW

    function mergeCatalogUpgradeParts(moduleCell, currentCatalog) { // NEW
        const current = currentCatalog || readCatalog(moduleCell); // NEW
        const items = (current.items || []).filter(function (item) { return !isObsoleteFamilyTubingPart(item); }); // CHANGE
        const usedIds = new Set(items.map(function (item) { return item.id; })); // CHANGE
        starterCatalogUpgradeItems().forEach(function (part) { // NEW
            if (!usedIds.has(part.id)) { // NEW
                usedIds.add(part.id); // NEW
                items.push(part); // NEW
            } // NEW
        }); // NEW
        return writeCatalog(moduleCell, { items }); // NEW
    } // NEW

    function pruneObsoleteFamilyTubingParts(moduleCell, currentCatalog) { // NEW
        const current = currentCatalog || readCatalog(moduleCell); // NEW
        if (!(current.items || []).some(isObsoleteFamilyTubingPart)) return current; // NEW
        return writeCatalog(moduleCell, { items: (current.items || []).filter(function (item) { return !isObsoleteFamilyTubingPart(item); }) }); // NEW
    } // NEW

    function seedStarterCatalogIfEmpty(moduleCell) {
        const current = readCatalog(moduleCell);
        if (!moduleCell) return current; // NEW
        if (current.items.length > 0 && current.version < PLUGIN_VERSION) return mergeCatalogUpgradeParts(moduleCell, current); // NEW
        if (current.items.length > 0) return pruneObsoleteFamilyTubingParts(moduleCell, current); // CHANGE
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
        const normalized = String(type || "").trim().toLowerCase().replace(/[\s-]+/g, "_"); // CHANGE
        if (normalized === "twist" || normalized === "twistlock") return "twist_lock"; // NEW
        if (normalized === "push_connect" || normalized === "push_to_connect" || normalized === "pushconnect") return "push_connect"; // NEW
        return normalized; // CHANGE
    } // CHANGE

    function isPipeConnectorType(type) { // NEW
        return PIPE_CONNECTOR_TYPES.has(normalizeConnectorType(type)); // NEW
    } // NEW

    function connectorUsesPipe(connector) { // NEW
        const c = normalizeConnectorRecord(connector); // CHANGE
        return !!(c.pipeConnection || isPipeConnectorType(c.type)); // CHANGE
    } // NEW

    function pipeStyleConnectorMatches(source, target) { // NEW
        if (!source || !target) return { ok: false, reason: "Missing connector." }; // NEW
        if (!connectorUsesPipe(source) || !connectorUsesPipe(target)) return { ok: false, reason: connectorTypeMismatchReason(source.type, target.type) }; // NEW
        if (!source.nominalSize || !target.nominalSize) return { ok: false, reason: "Missing connector size." }; // NEW
        if (source.nominalSize !== target.nominalSize) return { ok: false, reason: "Pipe Edge size mismatch." }; // NEW
        return { ok: true, reason: "" }; // NEW
    } // NEW

    function connectorTypeLabel(type) { // CHANGE
        const normalized = normalizeConnectorType(type); // CHANGE
        return normalized.replace(/_/g, " "); // CHANGE
    } // CHANGE

    function connectorTypeDisplayLabel(type) { // NEW
        const normalized = normalizeConnectorType(type); // NEW
        return normalized ? normalized.toUpperCase().replace(/_/g, " ") : "connector?"; // NEW
    } // NEW

    function connectorDisplayLabel(connector) { // NEW
        const c = normalizeConnectorRecord(connector); // NEW
        const size = c.nominalSize || "size?"; // NEW
        if (isPipeConnectorType(c.type)) return size; // NEW
        return size + " " + connectorTypeDisplayLabel(c.type); // NEW
    } // NEW

    function connectionDisplayLabel(sourceConnector, targetConnector) { // NEW
        const sourceLabel = connectorDisplayLabel(sourceConnector); // NEW
        const targetLabel = connectorDisplayLabel(targetConnector); // NEW
        return sourceLabel === targetLabel ? sourceLabel : sourceLabel + " -> " + targetLabel; // NEW
    } // NEW

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
        const stockQuantity = Math.max(0, finiteNumber(part.stockQuantity, 0)); // NEW
        return {
            id: String(part.id || "").trim(),
            name: String(part.name || "").trim(),
            category: String(part.category || "").trim(),
            stockState: VALID_STOCK_STATES.includes(part.stockState) ? part.stockState : "unknown",
            stockQuantity, // NEW
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

    function stockStateForQuantity(quantity) { // NEW
        return finiteNumber(quantity, 0) > 0 ? "in_stock" : "out_of_stock"; // NEW
    } // NEW

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

    function nominalSizeInchesForPipeStyle(value) { // NEW
        const text = String(value || "").trim(); // NEW
        if (!text) return null; // NEW
        const fraction = text.match(/^([0-9]+(?:\.[0-9]+)?)\/([0-9]+(?:\.[0-9]+)?)$/); // NEW
        if (fraction) { // NEW
            const numerator = finiteNumber(fraction[1], null); // NEW
            const denominator = finiteNumber(fraction[2], null); // NEW
            return numerator > 0 && denominator > 0 ? numerator / denominator : null; // NEW
        } // NEW
        const decimal = finiteNumber(text, null); // NEW
        return decimal > 0 ? decimal : null; // NEW
    } // NEW

    function formatStyleNumber(value) { // NEW
        const rounded = Math.round(finiteNumber(value, 0) * 100) / 100; // NEW
        return String(rounded).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1"); // NEW
    } // NEW

    function pipeEdgeStrokeWidthForSize(value) { // NEW
        const inches = nominalSizeInchesForPipeStyle(value); // NEW
        if (!(inches > 0)) return ""; // NEW
        return formatStyleNumber(Math.min(PIPE_EDGE_MAX_STROKE_WIDTH, Math.max(1, inches / PIPE_EDGE_STROKE_UNIT_IN))); // NEW
    } // NEW

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
        return pipeStyleConnectorMatches(source, target); // CHANGE
    } // NEW

    function connectorRecordsRequirePipe(sourceConnector, targetConnector) { // NEW
        return connectorUsesPipe(sourceConnector) && connectorUsesPipe(targetConnector); // CHANGE
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
                [ATTRS.PART_STATE]: PART_STATE_PLANNED, // NEW
                [ATTRS.ENDPOINT_PROFILE_JSON]: JSON.stringify(normalized)
            });
    }

    function createAssemblyLane(moduleCell, label, x, y, type, attrs, size) { // CHANGE
        const laneWidth = size && size.width != null ? size.width : ASSEMBLY_DEFAULT_WIDTH; // NEW
        const laneHeight = size && size.height != null ? size.height : ASSEMBLY_HEADER_SIZE + ASSEMBLY_PART_HEIGHT + ASSEMBLY_PART_GAP * 2; // NEW
        return createVertex(moduleCell, label || "Assembly", x, y, laneWidth, laneHeight, // CHANGE
            "swimlane;whiteSpace=wrap;html=1;startSize=" + ASSEMBLY_HEADER_SIZE + ";horizontal=1;childLayout=stackLayout;horizontalStack=0;resizeParent=0;resizeLast=0;collapsible=1;rounded=1;fillColor=#ffffff;strokeColor=#666666;fontStyle=1;", // NEW
            Object.assign({ // NEW
                label: label || "Assembly", // NEW
                [ATTRS.ASSEMBLY]: "1", // NEW
                [ATTRS.ASSEMBLY_TYPE]: type || "parts" // NEW
            }, attrs || {})); // NEW
    } // NEW

    function createBedAssemblyContainer(moduleCell, label, x, y, attrs, size) { // NEW
        const width = size && size.width != null ? size.width : ASSEMBLY_CONTRACTED_BED.width; // NEW
        const height = size && size.height != null ? size.height : ASSEMBLY_CONTRACTED_BED.height; // NEW
        return createVertex(moduleCell, label || "Bed Assembly", x, y, width, height, // NEW
            "rounded=1;whiteSpace=wrap;html=1;container=1;recursiveResize=0;collapsible=0;editable=0;fillColor=none;strokeColor=#666666;fontStyle=1;fontSize=14;align=center;verticalAlign=top;spacingTop=6;spacingLeft=6;spacingRight=6;labelBackgroundColor=#ffffff;", // CHANGE
            Object.assign({ // NEW
                label: label || "Bed Assembly", // NEW
                [ATTRS.ASSEMBLY]: "1", // NEW
                [ATTRS.ASSEMBLY_TYPE]: "bed" // NEW
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
        const normalizedAttrs = normalizeLifecycleAttrs(attrs); // NEW
        const cell = createVertex(assembly, label || "Irrigation part", 20, y, ASSEMBLY_PART_WIDTH, ASSEMBLY_PART_HEIGHT, // NEW
            assemblyPartStyleForState(normalizedAttrs[ATTRS.PART_STATE]), // CHANGE
            normalizedAttrs); // CHANGE
        resizeAssemblyToChildren(assembly); // NEW
        return cell; // NEW
    } // NEW

    function updateAssemblyPartCell(cell, part) { // NEW
        if (!cell || !part) return; // NEW
        const state = partStateForCell(cell); // NEW
        setCellAttrs(cell, { // NEW
            label: part.name || part.id || "Irrigation part", // NEW
            [ATTRS.COMPONENT]: "1", // NEW
            [ATTRS.COMPONENT_TYPE]: part.category || "unknown", // NEW
            [ATTRS.CATALOG_PART_ID]: part.id || "", // CHANGE
            [ATTRS.PART_STATE]: state // NEW
        }); // NEW
        applyPartCellLifecycleStyle(cell); // NEW
    } // NEW

    function applyPartCellLifecycleStyle(cell) { // NEW
        if (!isLifecyclePartTargetCell(cell)) return false; // CHANGE
        return setCellStyle(cell, assemblyPartStyleForState(partStateForCell(cell))); // NEW
    } // NEW

    function isLifecyclePartTargetCell(cell) { // NEW
        if (!cell) return false; // NEW
        if (isAssemblyPartCell(cell)) return true; // NEW
        if (endpointType(cell) === "branchpoint") return !!getCellAttr(cell, ATTRS.CATALOG_PART_ID, ""); // NEW
        return endpointType(cell) !== "source" && !!getCellAttr(cell, ATTRS.CATALOG_PART_ID, ""); // NEW
    } // NEW

    function applyPipeEdgeLifecycleStyle(edge, moduleCell, baseStyle) { // NEW
        if (!edge || getCellAttr(edge, ATTRS.PIPE_EDGE, "") !== "1") return false; // NEW
        let style = pipeEdgeStyleForPart(moduleCell || findGardenModuleAncestor(edge), getCellAttr(edge, ATTRS.PIPE_PART_ID, ""), baseStyle || PIPE_EDGE_BASE_STYLE); // NEW
        if (isCompletedPartState(partStateForCell(edge))) style = setStyleValue(setStyleValue(style, "strokeColor", "#82b366"), "dashed", "1"); // NEW
        return setCellStyle(edge, style); // NEW
    } // NEW

    function setPartCellState(cell, state) { // NEW
        if (!isLifecyclePartTargetCell(cell)) return false; // CHANGE
        const normalized = normalizePartState(state); // NEW
        const changed = setCellAttrs(cell, { [ATTRS.PART_STATE]: normalized }); // NEW
        return applyPartCellLifecycleStyle(cell) || changed; // NEW
    } // NEW

    function setPipeEdgeState(edge, state) { // NEW
        if (!edge || getCellAttr(edge, ATTRS.PIPE_EDGE, "") !== "1") return false; // NEW
        const normalized = normalizePartState(state); // NEW
        const changed = setCellAttrs(edge, { [ATTRS.PART_STATE]: normalized }); // NEW
        return applyPipeEdgeLifecycleStyle(edge, findGardenModuleAncestor(edge), PIPE_EDGE_BASE_STYLE) || changed; // NEW
    } // NEW

    function createSourceAssembly(moduleCell, label, profile, anchor) { // NEW
        if (activeIrrigationEditDepth === 0) return runIrrigationEdit("createSourceAssembly", function () { return createSourceAssembly(moduleCell, label, profile, anchor); }); // NEW
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
        if (activeIrrigationEditDepth === 0) return runIrrigationEdit("createPartAssembly", function () { return createPartAssembly(moduleCell, part, anchor); }); // NEW
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
        if (activeIrrigationEditDepth === 0) return runIrrigationEdit("createBedAssembly", function () { return createBedAssembly(moduleCell, bedCell, anchor); }); // NEW
        const parent = moduleCell || findGardenModuleAncestor(bedCell); // CHANGE
        const bedGeo = bedSyncedAssemblyGeometry(bedCell); // CHANGE
        const label = (getCellAttr(bedCell, "label", "Bed") || "Bed") + " Assembly"; // NEW
        if (!getCellAttr(bedCell, ATTRS.BED_PORTS_JSON, "")) writeBedPortConfig(bedCell, defaultBedPortConfig()); // NEW
        const assembly = createBedAssemblyContainer(parent, label, bedGeo.x, bedGeo.y, { // CHANGE
            [ATTRS.LINKED_BED_ID]: getCellId(bedCell) || "", // CHANGE
            bed_fit_width: "1", // NEW
            bed_fit_height: "1" // NEW
        }, { width: bedGeo.width, height: bedGeo.height }); // CHANGE
        return { assembly, endpoint: assembly }; // CHANGE
    } // NEW

    function bedSyncedAssemblyGeometry(bedCell) { // NEW
        const geo = getGeometry(bedCell) || {}; // NEW
        return { x: finiteNumber(geo.x, 0), y: finiteNumber(geo.y, 0), width: finiteNumber(geo.width, ASSEMBLY_CONTRACTED_BED.width), height: finiteNumber(geo.height, ASSEMBLY_CONTRACTED_BED.height) }; // NEW
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

    function isBedAssembly(cell) { // NEW
        return isAssembly(cell) && assemblyType(cell) === "bed"; // NEW
    } // NEW

    function cellStyleText(cell) { // NEW
        return String(cell && (cell.getStyle ? cell.getStyle() : cell.style) || ""); // NEW
    } // NEW

    function isCenterStableFoldAssembly(cell) { // NEW
        return isAssembly(cell) && !isBedAssembly(cell) && styleValue(cellStyleText(cell), "collapsible") !== "0"; // NEW
    } // NEW

    function centerAlternateBoundsOnGeometry(geo) { // NEW
        if (!geo || !geo.alternateBounds) return false; // NEW
        const centerX = finiteNumber(geo.x, 0) + finiteNumber(geo.width, 0) / 2; // NEW
        const centerY = finiteNumber(geo.y, 0) + finiteNumber(geo.height, 0) / 2; // NEW
        geo.alternateBounds.x = centerX - finiteNumber(geo.alternateBounds.width, 0) / 2; // NEW
        geo.alternateBounds.y = centerY - finiteNumber(geo.alternateBounds.height, 0) / 2; // NEW
        return true; // NEW
    } // NEW

    function installCenterStableAssemblyFolding() { // NEW
        if (graph.__trellisCenterStableIrrigationAssemblyFoldingInstalled || typeof graph.updateAlternateBounds !== "function") return; // NEW
        graph.__trellisCenterStableIrrigationAssemblyFoldingInstalled = true; // NEW
        const originalUpdateAlternateBounds = graph.updateAlternateBounds; // NEW
        graph.updateAlternateBounds = function (cell, geo, willCollapse) { // NEW
            const result = originalUpdateAlternateBounds.apply(this, arguments); // NEW
            if (isCenterStableFoldAssembly(cell)) centerAlternateBoundsOnGeometry(geo); // NEW
            return result; // NEW
        }; // NEW
    } // NEW

    installCenterStableAssemblyFolding(); // NEW

    function linkedBedModuleForAssembly(assembly) { // NEW
        const linkedId = getCellAttr(assembly, ATTRS.LINKED_BED_ID, ""); // NEW
        const root = (graph.getDefaultParent && graph.getDefaultParent()) || (model.getRoot && model.getRoot()) || null; // NEW
        const linkedBed = linkedId && root ? findCellById(root, linkedId) : null; // NEW
        return linkedBed ? findGardenModuleAncestor(linkedBed) : null; // NEW
    } // NEW

    function gardenModuleForBedAssembly(assembly) { // NEW
        return findGardenModuleAncestor(assembly) || linkedBedModuleForAssembly(assembly); // NEW
    } // NEW

    function safeParentForBedAssembly(assembly) { // NEW
        return gardenModuleForBedAssembly(assembly) || (graph.getDefaultParent && graph.getDefaultParent()) || (model.getRoot && model.getRoot()) || null; // NEW
    } // NEW

    function isAllowedBedAssemblyParent(parent, assembly) { // NEW
        if (!parent || !assembly) return false; // NEW
        const moduleCell = gardenModuleForBedAssembly(assembly); // NEW
        if (moduleCell) return parent === moduleCell; // NEW
        const defaultParent = graph.getDefaultParent && graph.getDefaultParent(); // NEW
        return !defaultParent || parent === defaultParent; // NEW
    } // NEW

    function preserveAbsoluteGeometryForParent(cell, nextParent) { // NEW
        const geo = getGeometry(cell); // NEW
        if (!geo || !nextParent) return null; // NEW
        const absolute = cellBoundsInModel(cell); // NEW
        const parentBounds = cellBoundsInModel(nextParent) || { x: 0, y: 0 }; // NEW
        const nextGeo = geo.clone ? geo.clone() : Object.assign({}, geo); // NEW
        nextGeo.x = finiteNumber(absolute && absolute.x, finiteNumber(geo.x, 0)) - finiteNumber(parentBounds.x, 0); // NEW
        nextGeo.y = finiteNumber(absolute && absolute.y, finiteNumber(geo.y, 0)) - finiteNumber(parentBounds.y, 0); // NEW
        return nextGeo; // NEW
    } // NEW

    function repairBedAssemblyParenting(cells) { // NEW
        const moved = (cells || []).filter(isBedAssembly); // NEW
        if (!moved.length) return false; // NEW
        let changed = false; // NEW
        (graph.__withUndoSuppressed || function (fn) { return fn(); }).call(graph, function () { // NEW
            model.beginUpdate && model.beginUpdate(); // NEW
            try { // NEW
                moved.forEach(function (assembly) { // NEW
                    const parent = model.getParent ? model.getParent(assembly) : assembly.parent; // NEW
                    if (isAllowedBedAssemblyParent(parent, assembly)) return; // NEW
                    const safeParent = safeParentForBedAssembly(assembly); // NEW
                    if (!safeParent || safeParent === parent) return; // NEW
                    const nextGeo = preserveAbsoluteGeometryForParent(assembly, safeParent); // NEW
                    moveCellToParent(assembly, safeParent); // NEW
                    if (nextGeo) setGeometry(assembly, nextGeo); // NEW
                    changed = true; // NEW
                }); // NEW
            } finally { // NEW
                model.endUpdate && model.endUpdate(); // NEW
            } // NEW
        }); // NEW
        if (changed && graph.refresh) graph.refresh(); // NEW
        return changed; // NEW
    } // NEW

    function installBedAssemblyParentingGuard() { // NEW
        if (graph.__trellisBedAssemblyParentGuardInstalled) return; // NEW
        graph.__trellisBedAssemblyParentGuardInstalled = true; // NEW
        const originalIsValidDropTarget = graph.isValidDropTarget; // NEW
        graph.isValidDropTarget = function (target, cells, evt) { // NEW
            const bedAssemblies = (cells || []).filter(isBedAssembly); // NEW
            if (bedAssemblies.length && target && !bedAssemblies.every(function (assembly) { return isAllowedBedAssemblyParent(target, assembly); })) return false; // NEW
            return originalIsValidDropTarget ? originalIsValidDropTarget.apply(this, arguments) : true; // NEW
        }; // NEW
        if (graph.addListener && typeof mxEvent !== "undefined" && mxEvent.CELLS_MOVED) { // NEW
            graph.addListener(mxEvent.CELLS_MOVED, function (_, evt) { repairBedAssemblyParenting(evt && evt.getProperty && evt.getProperty("cells") || []); }); // NEW
        } // NEW
    } // NEW

    installBedAssemblyParentingGuard(); // NEW

    function installAssemblyPartMoveGuard() { // NEW
        if (graph.__trellisAssemblyPartMoveGuardInstalled || typeof graph.moveCells !== "function") return; // NEW
        graph.__trellisAssemblyPartMoveGuardInstalled = true; // NEW
        const originalMoveCells = graph.moveCells; // NEW
        graph.moveCells = function (cells) { // NEW
            if (activeIrrigationEditDepth > 0) return originalMoveCells.apply(this, arguments); // NEW
            const requested = Array.isArray(cells) ? cells : []; // NEW
            const movableCells = requested.filter(function (cell) { return !isAssemblyPartCell(cell); }); // NEW
            if (movableCells.length === requested.length) return originalMoveCells.apply(this, arguments); // NEW
            if (!movableCells.length) return requested; // NEW
            const args = Array.prototype.slice.call(arguments); // NEW
            args[0] = movableCells; // NEW
            return originalMoveCells.apply(this, args); // NEW
        }; // NEW
    } // NEW

    installAssemblyPartMoveGuard(); // NEW

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

    function findBedAssemblyForBed(moduleCell, bedCell) { // NEW
        const bedId = getCellId(bedCell) || ""; // NEW
        if (!bedId) return null; // NEW
        const root = moduleCell || findGardenModuleAncestor(bedCell) || bedCell; // NEW
        return collectDescendants(root, function (cell) { // NEW
            return isAssembly(cell) && assemblyType(cell) === "bed" && getCellAttr(cell, ATTRS.LINKED_BED_ID, "") === bedId; // NEW
        })[0] || null; // NEW
    } // NEW

    function resolveBedTemplateAssembly(moduleCell, bedCell) { // NEW
        if (!bedCell) return null; // NEW
        return isAssembly(bedCell) && assemblyType(bedCell) === "bed" ? bedCell : findBedAssemblyForBed(moduleCell, bedCell) || (createBedAssembly(moduleCell, bedCell).assembly); // NEW
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

    function bedTemplateRolePartIds(template) { // NEW
        const saved = template || {}; // NEW
        const partIds = Array.isArray(saved.partIds) ? saved.partIds : []; // NEW
        const hasInlet = Object.prototype.hasOwnProperty.call(saved, "inletPartId"); // NEW
        const hasOutlet = Object.prototype.hasOwnProperty.call(saved, "outletPartId"); // NEW
        return { // NEW
            inletPartId: String(hasInlet ? saved.inletPartId || "" : partIds[0] || ""), // CHANGE
            outletPartId: String(hasOutlet ? saved.outletPartId || "" : partIds[1] || "") // CHANGE
        }; // NEW
    } // NEW

    function bedTemplatePartIds(inletPartId, outletPartId) { // NEW
        const ids = []; // NEW
        if (inletPartId) ids.push(inletPartId); // NEW
        if (outletPartId) ids.push(outletPartId); // NEW
        return ids; // NEW
    } // NEW

    function bedTemplateById(templateId) { // NEW
        return BED_TEMPLATES.find(function (entry) { return entry.id === templateId; }) || BED_TEMPLATES[0]; // NEW
    } // NEW

    function bedTemplateLabel(templateId) { // NEW
        const template = bedTemplateById(templateId); // NEW
        return String(template && template.label || templateId || "").trim(); // NEW
    } // NEW

    function bedTemplateRowDisplayLabel(irrigationType) { // NEW
        const labels = { drip_tape: "Drip line", dripline: "Drip line", sprinkler: "Sprinkler line", microspray: "Microspray line", bubbler: "Bubbler line", standpipe: "Standpipe" }; // NEW
        const key = String(irrigationType || "").trim(); // NEW
        return labels[key] || "Irrigation line"; // NEW
    } // NEW

    function bedIrrigationMethodLabel(irrigationType) { // NEW
        const labels = { drip_tape: "Drip tape", dripline: "Dripline", emitter: "Emitter", sprinkler: "Sprinkler", microspray: "Microspray", bubbler: "Bubbler", standpipe: "Standpipe" }; // NEW
        const key = String(irrigationType || "").trim(); // NEW
        return labels[key] || ""; // NEW
    } // NEW

    function bedTemplatePipePartId(templateId, savedPipePartId) { // NEW
        return String(savedPipePartId || (bedTemplateById(templateId) && bedTemplateById(templateId).pipePartId) || ""); // NEW
    } // NEW

    function bedTemplateRolePartMatches(templateDef, part) { // NEW
        if (!part || !templateDef) return false; // NEW
        return part.category === templateDef.lineKind || part.category === "fitting"; // NEW
    } // NEW

    function normalizeBedRowOrientation(value, templateDef) { // NEW
        const selected = String(value || "").trim(); // NEW
        const fallback = String(templateDef && templateDef.defaultRowOrientation || "width").trim(); // NEW
        return BED_TEMPLATE_ROW_ORIENTATIONS.indexOf(selected) >= 0 ? selected : (BED_TEMPLATE_ROW_ORIENTATIONS.indexOf(fallback) >= 0 ? fallback : "width"); // NEW
    } // NEW

    function normalizeUnitSystem(value) { // NEW
        return String(value || "").trim() === "imperial" ? "imperial" : "metric"; // NEW
    } // NEW

    function resolveModuleUnitSystem(moduleCell) { // NEW
        return normalizeUnitSystem(moduleCell && moduleCell.getAttribute ? moduleCell.getAttribute("unit_system") : ""); // NEW
    } // NEW

    function rowSpacingDisplayUnit(moduleCell) { // NEW
        return resolveModuleUnitSystem(moduleCell) === "imperial" ? "in" : "cm"; // NEW
    } // NEW

    function rowSpacingCmToDisplayValue(cm, moduleCell) { // NEW
        const value = Math.max(0, finiteNumber(cm, 0)); // NEW
        return resolveModuleUnitSystem(moduleCell) === "imperial" ? value / CM_PER_INCH : value; // NEW
    } // NEW

    function rowSpacingDisplayValueToCm(value, moduleCell) { // NEW
        const n = finiteNumber(value, 0); // NEW
        return resolveModuleUnitSystem(moduleCell) === "imperial" ? n * CM_PER_INCH : n; // NEW
    } // NEW

    function formatRowSpacingDisplayValue(cm, moduleCell) { // NEW
        const value = rowSpacingCmToDisplayValue(cm, moduleCell); // NEW
        return String(Math.max(0, Math.round(value))); // CHANGE
    } // NEW

    function rowLengthMetersForBedGeometry(bedGeo, orientation) { // NEW
        const geo = bedGeo || {}; // NEW
        const units = normalizeBedRowOrientation(orientation) === "height" ? geo.height : geo.width; // NEW
        return Math.max(0, unitsToCm(finiteNumber(units, 0)) / 100); // NEW
    } // NEW

    function rowSpacingSpanUnitsForBedGeometry(bedGeo, orientation) { // NEW
        const geo = bedGeo || {}; // NEW
        return Math.max(0, finiteNumber(normalizeBedRowOrientation(orientation) === "height" ? geo.width : geo.height, 0)); // NEW
    } // NEW

    function rowSpacingSpanCmForBedGeometry(bedGeo, orientation) { // NEW
        return unitsToCm(rowSpacingSpanUnitsForBedGeometry(bedGeo, orientation)); // NEW
    } // NEW

    function rowSpacingCmForRows(bedGeo, rows, orientation) { // NEW
        const rowCount = Math.max(0, Math.floor(finiteNumber(rows, 0))); // CHANGE
        if (rowCount === 0) return 0; // NEW
        return Math.max(0, rowSpacingSpanCmForBedGeometry(bedGeo, orientation) / rowCount); // NEW
    } // NEW

    function rowsForRowSpacingCm(bedGeo, spacingCm, orientation, fallbackRows) { // NEW
        const fallback = Math.max(0, Math.floor(finiteNumber(fallbackRows, 0))); // CHANGE
        const spanCm = rowSpacingSpanCmForBedGeometry(bedGeo, orientation); // NEW
        const spacing = finiteNumber(spacingCm, 0); // NEW
        if (!(spacing > 0)) return 0; // CHANGE
        if (!(spanCm > 0)) return fallback; // NEW
        return Math.max(1, Math.round(spanCm / spacing)); // NEW
    } // NEW

    function normalizeTemplateRequiredParts(templateDef) { // NEW
        return (templateDef && Array.isArray(templateDef.requiredParts) ? templateDef.requiredParts : []).map(function (entry) { // NEW
            return { partId: String(entry && entry.partId || "").trim(), quantityPerRowMeter: finiteNumber(entry && entry.quantityPerRowMeter, 0) }; // NEW
        }).filter(function (entry) { return !!entry.partId && entry.quantityPerRowMeter > 0; }); // NEW
    } // NEW

    function catalogPartLargestConnectorSize(part) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        if (!p || !p.connectors) return 0; // NEW
        return Math.max(p.connectors.inputs > 0 ? nominalSizeNumber(p.connectors.input.nominalSize) : 0, p.connectors.outputs > 0 ? nominalSizeNumber(p.connectors.output.nominalSize) : 0); // NEW
    } // NEW

    function resolveTemplateAnchorPart(catalog, requiredParts) { // NEW
        const candidates = (requiredParts || []).map(function (entry, index) { // NEW
            const part = normalizeCatalogPart(partById(catalog, entry.partId)); // NEW
            if (!part || !validateCatalogPart(part).ok || !BED_TEMPLATE_ANCHOR_CATEGORIES.has(part.category)) return null; // NEW
            return { part, index, size: catalogPartLargestConnectorSize(part), pipePriority: part.category === "pipe_tubing" ? 0 : 1 }; // NEW
        }).filter(Boolean); // NEW
        candidates.sort(function (a, b) { return (b.size - a.size) || (a.pipePriority - b.pipePriority) || (a.index - b.index); }); // NEW
        return candidates[0] ? candidates[0].part : null; // NEW
    } // NEW

    function isSelfEmittingRowPart(part) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        return !!(p && BED_SELF_EMITTING_ROW_CATEGORIES.has(p.category)); // NEW
    } // NEW

    function templateDefaultRowPartId(catalog, templateDef) { // NEW
        const required = normalizeTemplateRequiredParts(templateDef); // NEW
        const self = required.map(function (entry) { return partById(catalog, entry.partId); }).find(function (part) { return part && part.category === templateDef.lineKind && isSelfEmittingRowPart(part); }); // NEW
        if (self) return self.id; // NEW
        const pipe = partById(catalog, templateDef && templateDef.pipePartId); // NEW
        if (pipe && pipe.category === "pipe_tubing") return pipe.id; // NEW
        const row = required.map(function (entry) { return partById(catalog, entry.partId); }).find(function (part) { return part && BED_TEMPLATE_ANCHOR_CATEGORIES.has(part.category); }); // NEW
        return row ? row.id : ""; // NEW
    } // NEW

    function templateDefaultEmitterPartId(catalog, templateDef, rowPartId) { // NEW
        const rowPart = partById(catalog, rowPartId); // NEW
        if (isSelfEmittingRowPart(rowPart)) return ""; // NEW
        const required = normalizeTemplateRequiredParts(templateDef); // NEW
        const device = required.map(function (entry) { return partById(catalog, entry.partId); }).find(function (part) { return part && BED_DEVICE_CATEGORIES.has(part.category); }); // NEW
        return device ? device.id : ""; // NEW
    } // NEW

    function normalizeBedRecipeInput(catalog, templateDef, recipe) { // NEW
        const saved = recipe || {}; // NEW
        const rowPartId = String(saved.rowPartId || templateDefaultRowPartId(catalog, templateDef) || "").trim(); // NEW
        const rowPart = partById(catalog, rowPartId); // NEW
        const selfEmitting = isSelfEmittingRowPart(rowPart); // NEW
        const emitterPartId = selfEmitting ? "" : String(saved.emitterPartId || templateDefaultEmitterPartId(catalog, templateDef, rowPartId) || "").trim(); // NEW
        const emitterSpacingIn = selfEmitting ? finiteNumber(rowPart && rowPart.specs && rowPart.specs.emitterSpacingIn, finiteNumber(saved.emitterSpacingIn, 12)) : finiteNumber(saved.emitterSpacingIn, finiteNumber(saved.emitterInches, 12)); // CHANGE
        return { inletPartId: String(saved.inletPartId || "").trim(), outletPartId: String(saved.outletPartId || "").trim(), rowPartId, emitterPartId, rowTakeoffPartId: String(saved.rowTakeoffPartId || "").trim(), rowEndCapPartId: String(saved.rowEndCapPartId || "").trim(), headerEndCapPartId: String(saved.headerEndCapPartId || "").trim(), emitterSpacingIn, selfEmitting }; // NEW
    } // NEW

    function supplyPipePartIdForConnector(catalog, connector) { // NEW
        const size = normalizeConnectorRecord(connector).nominalSize; // CHANGE
        const partId = BED_SUPPLY_PIPE_BY_SIZE[size] || ""; // NEW
        return partId && partById(catalog, partId) ? partId : ""; // NEW
    } // NEW

    function bedHeaderMatchForPart(catalog, partId, headerPart) { // NEW
        return partId ? boundaryMatchForAnchor(partById(catalog, partId), headerPart) : null; // NEW
    } // NEW

    function rowDeviceCount(rowLengthMeters, spacingIn) { // NEW
        const spacingMeters = Math.max(0, finiteNumber(spacingIn, 0) * CM_PER_INCH / 100); // NEW
        return spacingMeters > 0 ? Math.ceil(Math.max(0, finiteNumber(rowLengthMeters, 0)) / spacingMeters) : 0; // NEW
    } // NEW

    function addResolvedBedBomPart(out, role, partId, quantity, unit) { // NEW
        const id = String(partId || "").trim(); // NEW
        const qty = Math.max(0, finiteNumber(quantity, 0)); // NEW
        if (!id || !(qty > 0)) return; // NEW
        out.push({ role, partId: id, quantity: qty, unit: unit || "each" }); // NEW
    } // NEW

    function resolveBedTemplateRecipeBom(catalog, bedGeo, templateDef, rowCount, rowOrientation, recipe) { // NEW
        const normalized = normalizeBedRecipeInput(catalog, templateDef, recipe); // NEW
        const rowPart = partById(catalog, normalized.rowPartId); // NEW
        const inletPart = partById(catalog, normalized.inletPartId); // NEW
        const rowLengthMeters = rowLengthMetersForBedGeometry(bedGeo, rowOrientation); // NEW
        const headerLengthMeters = rowSpacingSpanCmForBedGeometry(bedGeo, rowOrientation) / 100; // NEW
        const totalRowMeters = rowCount * rowLengthMeters; // NEW
        const inletMatch = rowPart ? boundaryMatchForAnchorRole(inletPart, rowPart, "input") : null; // CHANGE
        const supplyPipePartId = inletMatch ? supplyPipePartIdForConnector(catalog, inletMatch.internalConnector) : ""; // NEW
        const supplyPipePart = partById(catalog, supplyPipePartId); // NEW
        const resolvedBomParts = []; // NEW
        const missingPartIds = []; // NEW
        function requirePart(partId) { if (partId && !partById(catalog, partId)) missingPartIds.push(partId); } // NEW
        requirePart(normalized.inletPartId); requirePart(normalized.outletPartId); requirePart(normalized.rowPartId); requirePart(normalized.emitterPartId); requirePart(normalized.rowTakeoffPartId); requirePart(normalized.rowEndCapPartId); requirePart(normalized.headerEndCapPartId); // NEW
        if (normalized.inletPartId && rowPart && !inletMatch) missingPartIds.push(normalized.inletPartId); // NEW
        if (inletMatch && !supplyPipePartId) missingPartIds.push(BED_SUPPLY_PIPE_BY_SIZE[String(inletMatch.internalConnector && inletMatch.internalConnector.nominalSize || "").trim()] || "matching_supply_pipe"); // NEW
        if (supplyPipePartId && normalized.outletPartId && !bedHeaderMatchForPart(catalog, normalized.outletPartId, supplyPipePart)) missingPartIds.push(normalized.outletPartId); // NEW
        addResolvedBedBomPart(resolvedBomParts, "inlet", normalized.inletPartId, 1, "each"); // NEW
        addResolvedBedBomPart(resolvedBomParts, "supply_pipe", supplyPipePartId, headerLengthMeters, "m"); // NEW
        addResolvedBedBomPart(resolvedBomParts, "row_line", normalized.rowPartId, totalRowMeters, "m"); // NEW
        addResolvedBedBomPart(resolvedBomParts, "row_takeoff", normalized.rowTakeoffPartId, rowCount, "each"); // NEW
        addResolvedBedBomPart(resolvedBomParts, "row_end_cap", normalized.rowEndCapPartId, rowCount, "each"); // NEW
        if (!normalized.selfEmitting) addResolvedBedBomPart(resolvedBomParts, "emitter_device", normalized.emitterPartId, rowCount * rowDeviceCount(rowLengthMeters, normalized.emitterSpacingIn), "each"); // NEW
        if (normalized.outletPartId) addResolvedBedBomPart(resolvedBomParts, "outlet", normalized.outletPartId, 1, "each"); // NEW
        else addResolvedBedBomPart(resolvedBomParts, "header_end_cap", normalized.headerEndCapPartId, 1, "each"); // NEW
        const demandPart = normalized.selfEmitting ? rowPart : partById(catalog, normalized.emitterPartId); // NEW
        const deviceQty = normalized.selfEmitting ? totalRowMeters : rowCount * rowDeviceCount(rowLengthMeters, normalized.emitterSpacingIn); // NEW
        const flowGpm = normalized.selfEmitting ? finiteNumber(demandPart && demandPart.specs && demandPart.specs.flowGpmPerMeter, 0) * totalRowMeters : finiteNumber(demandPart && demandPart.specs && demandPart.specs.flowGpm, 0) * deviceQty; // NEW
        const operatingPressurePsi = Math.max(finiteNumber(rowPart && rowPart.specs && rowPart.specs.minOperatingPressurePsi, 0), finiteNumber(demandPart && demandPart.specs && demandPart.specs.minOperatingPressurePsi, finiteNumber(demandPart && demandPart.specs && demandPart.specs.operatingPressurePsi, 0))); // CHANGE
        return Object.assign({}, normalized, { supplyPipePartId, resolvedBomParts, missingPartIds: uniqueStrings(missingPartIds), demand: { flowGpm, operatingPressurePsi } }); // NEW
    } // NEW

    function computeBedTemplateBom(catalog, bedGeo, templateId, rows, orientation, recipe) { // CHANGE
        const templateDef = bedTemplateById(templateId); // NEW
        const rowCount = Math.max(0, Math.floor(finiteNumber(rows, templateDef.defaultRows))); // CHANGE
        const rowOrientation = normalizeBedRowOrientation(orientation, templateDef); // NEW
        const rowLengthMeters = rowLengthMetersForBedGeometry(bedGeo, rowOrientation); // NEW
        const rowSpacingCm = rowSpacingCmForRows(bedGeo, rowCount, rowOrientation); // NEW
        const totalRowMeters = rowCount * rowLengthMeters; // NEW
        const required = normalizeTemplateRequiredParts(templateDef); // NEW
        const requiredParts = required.map(function (entry) { // NEW
            return Object.assign({}, entry, { quantityMeters: rowCount > 0 ? entry.quantityPerRowMeter * totalRowMeters : 0, unit: "m" }); // CHANGE
        }); // NEW
        const missingPartIds = rowCount > 0 ? requiredParts.filter(function (entry) { return !partById(catalog, entry.partId); }).map(function (entry) { return entry.partId; }) : []; // CHANGE
        const anchorPart = rowCount > 0 ? resolveTemplateAnchorPart(catalog, requiredParts) : null; // CHANGE
        const demand = requiredParts.reduce(function (out, entry) { // NEW
            const part = partById(catalog, entry.partId); // NEW
            out.flowGpm += finiteNumber(part && part.specs && part.specs.flowGpmPerMeter, 0) * finiteNumber(entry.quantityMeters, 0); // NEW
            out.operatingPressurePsi = Math.max(out.operatingPressurePsi, finiteNumber(part && part.specs && part.specs.minOperatingPressurePsi, finiteNumber(part && part.specs && part.specs.operatingPressurePsi, 0))); // CHANGE
            return out; // NEW
        }, { flowGpm: 0, operatingPressurePsi: 0 }); // NEW
        if (rowCount > 0 && !(demand.flowGpm > 0)) demand.flowGpm = finiteNumber(templateDef.flowGpm, 0); // CHANGE
        if (rowCount > 0 && !(demand.operatingPressurePsi > 0)) demand.operatingPressurePsi = finiteNumber(templateDef.pressurePsi, 0); // CHANGE
        const recipeBom = recipe ? resolveBedTemplateRecipeBom(catalog, bedGeo, templateDef, rowCount, rowOrientation, recipe) : null; // NEW
        const resolvedDemand = recipeBom && recipeBom.demand && recipeBom.demand.flowGpm > 0 ? recipeBom.demand : demand; // NEW
        return { templateDef, rowCount, rowOrientation, rowLengthMeters, rowSpacingCm, totalRowMeters, requiredParts, missingPartIds: uniqueStrings(missingPartIds.concat(recipeBom ? recipeBom.missingPartIds : [])), anchorPartId: recipeBom && recipeBom.rowPartId || (anchorPart ? anchorPart.id : ""), demand: resolvedDemand, recipe: recipeBom }; // CHANGE
    } // NEW

    function connectorForPartSide(part, side) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        if (!p || !p.connectors) return null; // NEW
        if (side === "input" && p.connectors.inputs > 0) return p.connectors.input; // NEW
        if (side === "output" && p.connectors.outputs > 0) return p.connectors.output; // NEW
        return null; // NEW
    } // NEW

    function boundaryMatchForAnchor(part, anchorPart) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        const anchor = normalizeCatalogPart(anchorPart); // NEW
        if (!p || !anchor || !validateCatalogPart(p).ok || !validateCatalogPart(anchor).ok) return null; // NEW
        const partSides = ["input", "output"]; // NEW
        const anchorSides = ["input", "output"]; // NEW
        for (let i = 0; i < partSides.length; i++) { // NEW
            const internalSide = partSides[i]; // NEW
            const internalConnector = connectorForPartSide(p, internalSide); // NEW
            if (!internalConnector) continue; // NEW
            for (let j = 0; j < anchorSides.length; j++) { // NEW
                const anchorConnector = connectorForPartSide(anchor, anchorSides[j]); // NEW
                if (!anchorConnector || !ConnectorRules.connectorRecordsMatch(internalConnector, anchorConnector, null).ok) continue; // NEW
                const externalSide = internalSide === "input" ? "output" : "input"; // NEW
                const externalConnector = connectorForPartSide(p, externalSide); // NEW
                const externalCapacity = externalSide === "input" ? p.connectors.inputs : p.connectors.outputs; // NEW
                if (!externalConnector || !(externalCapacity > 0)) continue; // NEW
                return { internalSide, externalSide, externalConnector, externalCapacity, anchorSide: anchorSides[j] }; // NEW
            } // NEW
        } // NEW
        return null; // NEW
    } // NEW

    function boundaryMatchForAnchorRole(part, anchorPart, role) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        const anchor = normalizeCatalogPart(anchorPart); // NEW
        const normalizedRole = role === "output" ? "output" : "input"; // NEW
        if (!p || !anchor || !validateCatalogPart(p).ok || !validateCatalogPart(anchor).ok) return null; // NEW
        const internalSide = normalizedRole === "input" ? "output" : "input"; // NEW
        const internalConnector = connectorForPartSide(p, internalSide); // NEW
        if (!internalConnector) return null; // NEW
        const anchorSides = ["input", "output"]; // NEW
        for (let i = 0; i < anchorSides.length; i++) { // NEW
            const anchorConnector = connectorForPartSide(anchor, anchorSides[i]); // NEW
            if (!anchorConnector || !ConnectorRules.connectorRecordsMatch(internalConnector, anchorConnector, null).ok) continue; // NEW
            const externalSide = internalSide === "input" ? "output" : "input"; // NEW
            const externalConnector = connectorForPartSide(p, externalSide); // NEW
            const externalCapacity = externalSide === "input" ? p.connectors.inputs : p.connectors.outputs; // NEW
            if (!externalConnector || !(externalCapacity > 0)) continue; // NEW
            return { internalSide, internalConnector, externalSide, externalConnector, externalCapacity, anchorSide: anchorSides[i] }; // CHANGE
        } // NEW
        return null; // NEW
    } // NEW

    function bedRolePartOptions(moduleCell, role, selectedPartId, templateId, anchorPartId, preserveSelected) { // CHANGE
        const catalog = readCatalog(moduleCell); // NEW
        const templateDef = bedTemplateById(templateId); // NEW
        const anchorPart = partById(catalog, anchorPartId); // CHANGE
        const selected = selectedPartId ? partById(catalog, selectedPartId) : null; // NEW
        const items = sortCatalogParts(catalog.items).map(normalizeCatalogPart).filter(function (part) { // NEW
            if (!part || part.category === "pipe_tubing" || !validateCatalogPart(part).ok) return false; // NEW
            if (!bedTemplateRolePartMatches(templateDef, part)) return false; // NEW
            return !!boundaryMatchForAnchorRole(part, anchorPart, role); // CHANGE
        }); // NEW
        if (preserveSelected !== false && selectedPartId && !items.some(function (part) { return part.id === selectedPartId; })) { // CHANGE
            items.unshift(selected || { id: selectedPartId, name: "Missing part (" + selectedPartId + ")" }); // NEW
        } // NEW
        return items; // NEW
    } // NEW

    function preserveSelectedPartOption(items, catalog, selectedPartId, preserveSelected) { // NEW
        const selected = selectedPartId ? partById(catalog, selectedPartId) : null; // NEW
        if (preserveSelected !== false && selectedPartId && !items.some(function (part) { return part.id === selectedPartId; })) items.unshift(selected || { id: selectedPartId, name: "Missing part (" + selectedPartId + ")" }); // NEW
        return items; // NEW
    } // NEW

    function bedRowPartOptions(moduleCell, selectedPartId, preserveSelected) { // NEW
        const catalog = readCatalog(moduleCell); // NEW
        const items = sortCatalogParts(catalog.items).map(normalizeCatalogPart).filter(function (part) { return part && validateCatalogPart(part).ok && BED_TEMPLATE_ANCHOR_CATEGORIES.has(part.category); }); // NEW
        return preserveSelectedPartOption(items, catalog, selectedPartId, preserveSelected); // NEW
    } // NEW

    function bedEmitterPartOptions(moduleCell, rowPartId, selectedPartId, preserveSelected) { // NEW
        const catalog = readCatalog(moduleCell); // NEW
        const rowPart = partById(catalog, rowPartId); // NEW
        const rowOutput = rowPart && rowPart.connectors && rowPart.connectors.output; // NEW
        const items = sortCatalogParts(catalog.items).map(normalizeCatalogPart).filter(function (part) { // NEW
            return part && validateCatalogPart(part).ok && BED_DEVICE_CATEGORIES.has(part.category) && (!rowOutput || connectorRecordsMatch(rowOutput, part.connectors.input, null).ok); // NEW
        }); // NEW
        return preserveSelectedPartOption(items, catalog, selectedPartId, preserveSelected); // NEW
    } // NEW

    function connectorMatchesPartInput(part, connector) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        return !!(p && p.connectors.inputs > 0 && connectorRecordsMatch(connector, p.connectors.input, null).ok); // NEW
    } // NEW

    function connectorMatchesPartOutput(part, connector) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        return !!(p && p.connectors.outputs > 0 && connectorRecordsMatch(p.connectors.output, connector, null).ok); // NEW
    } // NEW

    function bedFittingPartOptions(moduleCell, role, headerPartId, rowPartId, selectedPartId, preserveSelected) { // NEW
        const catalog = readCatalog(moduleCell); // NEW
        const headerPart = partById(catalog, headerPartId); // NEW
        const rowPart = partById(catalog, rowPartId); // NEW
        const headerConnector = headerPart && headerPart.connectors && headerPart.connectors.output; // NEW
        const rowConnector = rowPart && rowPart.connectors && rowPart.connectors.input; // NEW
        const items = sortCatalogParts(catalog.items).map(normalizeCatalogPart).filter(function (part) { // NEW
            if (!part || !validateCatalogPart(part).ok) return false; // NEW
            if (role === "row_takeoff") return part.category === "fitting" && connectorMatchesPartInput(part, headerConnector) && connectorMatchesPartOutput(part, rowConnector); // NEW
            if (role === "row_end_cap") return (part.category === "cap_end" || part.category === "fitting") && part.connectors.outputs <= 0 && connectorMatchesPartInput(part, rowConnector); // NEW
            if (role === "header_end_cap") return (part.category === "cap_end" || part.category === "fitting") && part.connectors.outputs <= 0 && connectorMatchesPartInput(part, headerConnector); // NEW
            return false; // NEW
        }); // NEW
        return preserveSelectedPartOption(items, catalog, selectedPartId, preserveSelected); // NEW
    } // NEW

    function bedOutletPartOptions(moduleCell, headerPartId, selectedPartId, preserveSelected) { // NEW
        const catalog = readCatalog(moduleCell); // NEW
        const headerPart = partById(catalog, headerPartId); // NEW
        const items = sortCatalogParts(catalog.items).map(normalizeCatalogPart).filter(function (part) { // NEW
            return part && part.category !== "pipe_tubing" && part.category !== "cap_end" && !BED_TEMPLATE_ANCHOR_CATEGORIES.has(part.category) && !BED_DEVICE_CATEGORIES.has(part.category) && validateCatalogPart(part).ok && !!boundaryMatchForAnchorRole(part, headerPart, "output"); // CHANGE
        }); // NEW
        return preserveSelectedPartOption(items, catalog, selectedPartId, preserveSelected); // NEW
    } // NEW

    function bedPortConfigFromRecipe(catalog, currentPorts, inletPartId, outletPartId, rowPartId, supplyPipePartId) { // NEW
        const fallback = currentPorts || defaultBedPortConfig(); // NEW
        const rowPart = partById(catalog, rowPartId); // NEW
        const supplyPart = partById(catalog, supplyPipePartId); // NEW
        const inletMatch = rowPart ? boundaryMatchForAnchorRole(partById(catalog, inletPartId), rowPart, "input") : null; // CHANGE
        const outletMatch = supplyPart ? boundaryMatchForAnchorRole(partById(catalog, outletPartId), supplyPart, "output") : null; // CHANGE
        return readBedPortConfigFromObject({ inputs: inletMatch ? inletMatch.externalCapacity : fallback.inputs, outputs: outletPartId ? (outletMatch ? outletMatch.externalCapacity : fallback.outputs) : 0, input: inletMatch ? inletMatch.externalConnector : fallback.input, output: outletMatch ? outletMatch.externalConnector : fallback.output }); // NEW
    } // NEW

    function bedPortConfigFromRoleParts(catalog, currentPorts, inletPartId, outletPartId, anchorPartId) { // CHANGE
        const fallback = currentPorts || defaultBedPortConfig(); // NEW
        const inletPart = inletPartId ? normalizeCatalogPart(partById(catalog, inletPartId)) : null; // NEW
        const outletPart = outletPartId ? normalizeCatalogPart(partById(catalog, outletPartId)) : null; // NEW
        const anchorPart = anchorPartId ? normalizeCatalogPart(partById(catalog, anchorPartId)) : null; // NEW
        const inletMatch = inletPart ? boundaryMatchForAnchorRole(inletPart, anchorPart, "input") : null; // CHANGE
        const outletMatch = outletPart ? boundaryMatchForAnchorRole(outletPart, anchorPart, "output") : null; // CHANGE
        return readBedPortConfigFromObject({ // NEW
            inputs: inletMatch ? inletMatch.externalCapacity : fallback.inputs, // CHANGE
            outputs: outletPartId ? (outletMatch ? outletMatch.externalCapacity : fallback.outputs) : 0, // CHANGE
            input: inletMatch ? inletMatch.externalConnector : fallback.input, // CHANGE
            output: outletMatch ? outletMatch.externalConnector : fallback.output // CHANGE
        }); // NEW
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
        const pipeSize = sourceConnector && targetConnector && sourceConnector.nominalSize === targetConnector.nominalSize ? sourceConnector.nominalSize : ""; // NEW
        const candidates = catalog.items.filter(function (part) { // NEW
            const p = normalizeCatalogPart(part); // NEW
            if (!pipeSize) return false; // NEW
            return p && p.category === "pipe_tubing" && validateCatalogPart(p).ok && // NEW
                p.connectors.input.nominalSize === pipeSize && // CHANGE
                p.connectors.output.nominalSize === pipeSize; // CHANGE
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
        if (ConnectorRules.connectorsRequirePipe(sourceConnector, targetConnector)) { // CHANGE
            const pipeMatch = ConnectorRules.pipeConnectorMatches(sourceConnector, targetConnector); // CHANGE
            if (!pipeMatch.ok) { irrigationDebug("connectorConnectionMode:rejected", { reason: pipeMatch.reason, mode: "pipe-match", sourceConnector, targetConnector }); return pipeMatch; } // DIAGNOSTIC
            const pipePartId = ConnectorRules.autoPipePartIdForConnection(moduleCell, sourceConnector, targetConnector); // CHANGE
            if (!pipePartId) { const rejected = { ok: false, reason: "No compatible pipe part found for this connection." }; irrigationDebug("connectorConnectionMode:rejected", { reason: rejected.reason, mode: "pipe-part", sourceConnector, targetConnector }); return rejected; } // DIAGNOSTIC
            return { ok: true, reason: "", mode: "pipe", pipePartId }; // NEW
        } // NEW
        const direct = ConnectorRules.connectorMatches(sourceConnector, targetConnector, null); // CHANGE
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
        const structure = ConnectorRules.validatePortConnectionStructure(moduleCell, sourcePort, targetPort); // CHANGE
        if (!structure.ok) { irrigationDebug("connectionDecision:rejected", { stage: "structure-result", reason: structure.reason, sourcePort: normalizePort(sourcePort), targetPort: normalizePort(targetPort) }); return structure; } // DIAGNOSTIC
        const sourceConnector = ConnectorRules.portConnectorForCell(moduleCell, structure.sourceCell, "output"); // CHANGE
        const targetConnector = ConnectorRules.portConnectorForCell(moduleCell, structure.targetCell, "input"); // CHANGE
        const compatibility = ConnectorRules.connectionMode(moduleCell, sourceConnector, targetConnector); // CHANGE
        if (!compatibility.ok) { irrigationDebug("connectionDecision:rejected", { stage: "compatibility", reason: compatibility.reason, source: structure.source, target: structure.target, sourceCell: debugCellSummary(structure.sourceCell), targetCell: debugCellSummary(structure.targetCell), sourceConnector, targetConnector }); return compatibility; } // DIAGNOSTIC
        const sourceCapacity = portCapacityForCell(moduleCell, structure.sourceCell, "output"); // NEW
        const sourceBed = assemblyType(structure.sourceAssembly) === "bed"; // NEW
        const targetBed = assemblyType(structure.targetAssembly) === "bed"; // NEW
        const canMerge = !sourceBed && !targetBed && sourceCapacity <= 1 && structure.sourceAssembly && structure.targetAssembly; // NEW
        return Object.assign({}, structure, { mode: compatibility.mode === "pipe" ? "pipe" : (canMerge ? "merge" : "direct"), pipePartId: compatibility.pipePartId || "" }); // CHANGE
    } // NEW

    function bridgeSuggestionEligibility(moduleCell, sourcePort, targetPort) { // NEW
        const structure = ConnectorRules.validatePortConnectionStructure(moduleCell, sourcePort, targetPort); // NEW
        if (!structure.ok) return Object.assign({}, structure, { bridgeable: false }); // NEW
        const sourceConnector = ConnectorRules.portConnectorForCell(moduleCell, structure.sourceCell, "output"); // NEW
        const targetConnector = ConnectorRules.portConnectorForCell(moduleCell, structure.targetCell, "input"); // NEW
        const compatibility = ConnectorRules.connectionMode(moduleCell, sourceConnector, targetConnector); // NEW
        return compatibility.ok ? Object.assign({}, structure, { ok: false, bridgeable: false, reason: "Selected ports can connect directly." }) : Object.assign({}, structure, { ok: true, bridgeable: true, reason: compatibility.reason, sourceConnector, targetConnector }); // NEW
    } // NEW

    function validatePortConnection(moduleCell, sourcePort, targetPort) { // NEW
        const decision = ConnectorRules.connectionDecision(moduleCell, sourcePort, targetPort); // CHANGE
        return decision.ok ? { ok: true, reason: "", mode: decision.mode } : { ok: false, reason: decision.reason }; // CHANGE
    } // NEW

    function createAssemblyConnection(moduleCell, sourcePort, targetPort) { // NEW
        if (activeIrrigationEditDepth === 0) return runIrrigationEdit("createAssemblyConnection", function () { return createAssemblyConnection(moduleCell, sourcePort, targetPort); }); // NEW
        const decision = ConnectorRules.connectionDecision(moduleCell, sourcePort, targetPort); // CHANGE
        if (!decision.ok) { irrigationDebug("createAssemblyConnection:rejected", { reason: decision.reason, sourcePort: normalizePort(sourcePort), targetPort: normalizePort(targetPort) }); return { ok: false, reason: decision.reason, edge: null, mode: "" }; } // DIAGNOSTIC
        if (decision.mode === "merge") return mergeAssemblyConnection(moduleCell, decision); // NEW
        const attrs = { // NEW
            [ATTRS.EDGE_SOURCE_PORT]: String(decision.source.index), // NEW
            [ATTRS.EDGE_TARGET_PORT]: String(decision.target.index) // NEW
        }; // NEW
        if (decision.mode === "pipe") { attrs[ATTRS.PIPE_EDGE] = "1"; attrs[ATTRS.PIPE_PART_ID] = decision.pipePartId; attrs[ATTRS.PART_STATE] = PART_STATE_PLANNED; } // CHANGE
        else attrs[ATTRS.DIRECT_LINK_EDGE] = "1"; // NEW
        const edgeLabel = connectionEdgeDisplayLabelForDecision(moduleCell, decision); // NEW
        attrs.label = edgeLabel; // NEW
        let edge = null; // FIX
        programmaticEdgeInsertDepth++; // FIX
        try { // FIX
            edge = createEdge(moduleCell, decision.sourceCell, decision.targetCell, edgeLabel, decision.mode === "pipe" ? pipeEdgeStyleForPart(moduleCell, decision.pipePartId, PIPE_EDGE_BASE_STYLE) : DIRECT_LINK_EDGE_STYLE, attrs); // CHANGE
        } finally { // FIX
            programmaticEdgeInsertDepth = Math.max(0, programmaticEdgeInsertDepth - 1); // FIX
        } // FIX
        if (edge && graph.refresh) graph.refresh(edge); // FIX
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
            setCellAttrs(edge, { [ATTRS.PIPE_EDGE]: "1", [ATTRS.DIRECT_LINK_EDGE]: "", [ATTRS.PIPE_PART_ID]: pipePartId, [ATTRS.PART_STATE]: partStateForCell(edge), [ATTRS.EDGE_SOURCE_PORT]: String(decision.source.index), [ATTRS.EDGE_TARGET_PORT]: String(decision.target.index) }); // CHANGE
            applyPipeEdgeLifecycleStyle(edge, findGardenModuleAncestor(edge), PIPE_EDGE_BASE_STYLE); // CHANGE
            syncConnectionEdgeDisplayLabel(findGardenModuleAncestor(edge), edge); // NEW
            return; // CHANGE
        } // CHANGE
        else { setCellAttrs(edge, { [ATTRS.PIPE_EDGE]: "", [ATTRS.DIRECT_LINK_EDGE]: "1", [ATTRS.PIPE_PART_ID]: "", [ATTRS.EDGE_SOURCE_PORT]: String(decision.source.index), [ATTRS.EDGE_TARGET_PORT]: String(decision.target.index) }); applyDirectLinkEdgeStyle(edge); syncConnectionEdgeDisplayLabel(findGardenModuleAncestor(edge), edge); } // CHANGE
    } // NEW

    function existingEdgeConnectionDecision(moduleCell, sourcePort, targetPort) { // NEW
        const source = normalizePort(sourcePort); // NEW
        const target = normalizePort(targetPort); // NEW
        if (source.role !== "output" || target.role !== "input") return { ok: false, reason: "Select one output port and one inlet port." }; // NEW
        const sourceCell = portCell(moduleCell, source); // NEW
        const targetCell = portCell(moduleCell, target); // NEW
        if (!sourceCell || !targetCell) return { ok: false, reason: "Selected port is no longer available." }; // NEW
        if (sourceCell === targetCell) return { ok: false, reason: "A part cannot connect to itself." }; // NEW
        const compatibility = ConnectorRules.connectionMode(moduleCell, ConnectorRules.portConnectorForCell(moduleCell, sourceCell, "output"), ConnectorRules.portConnectorForCell(moduleCell, targetCell, "input")); // CHANGE
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

    function resolveSelectedConnectionContext(session) { // NEW
        const anchorPort = normalizePort(session && session.inlineActionAnchorPort || {}); // NEW
        const anchorEdge = anchorPort.cellId ? edgesForPort(session.moduleCell, anchorPort)[0] : null; // NEW
        const anchorContext = anchorEdge && managedConnectionEdge(anchorEdge) ? externalConnectionContextForEdge(session.moduleCell, anchorEdge, edgeBoundary(anchorEdge)) : null; // NEW
        if (anchorContext && currentSelectionCells().some(function (cell) { return connectionContextTouchesCell(anchorContext, cell); })) return anchorContext; // NEW
        const focusedBoundary = normalizeBoundary(session && session.focusedConnectionBoundary || {}); // NEW
        const focusedContext = boundaryKey(focusedBoundary) ? connectionContextForBoundary(session.moduleCell, focusedBoundary) : null; // NEW
        const selectedBoundaryCount = selectedValidBoundaries(session).length; // NEW
        if (focusedContext && selectedBoundaryCount <= 1 && currentSelectionCells().some(function (cell) { return connectionContextTouchesCell(focusedContext, cell); })) return focusedContext; // NEW
        const selectedEdges = uniqueBoundaries(currentSelectionCells().map(edgeBoundary).filter(Boolean)); // CHANGE
        if (selectedEdges.length === 1) return connectionContextForBoundary(session.moduleCell, selectedEdges[0]); // NEW
        if (selectedEdges.length > 1) return null; // NEW
        const boundaries = uniqueBoundaries(selectedValidBoundaries(session).filter(function (boundary) { return boundaryTouchesCurrentSelection(session.moduleCell, boundary); })); // NEW
        if (boundaries.length !== 1) return null; // NEW
        return connectionContextForBoundary(session.moduleCell, boundaries[0]); // NEW
    } // NEW

    function boundaryTouchesCurrentSelection(moduleCell, boundary) { // NEW
        const cells = currentSelectionCells(); // NEW
        if (!cells.length) return false; // NEW
        const context = connectionContextForBoundary(moduleCell, boundary); // NEW
        if (!context) return false; // NEW
        return cells.some(function (cell) { return connectionContextTouchesCell(context, cell); }); // NEW
    } // NEW

    function connectionContextTouchesCell(context, cell) { // NEW
        if (!context || !cell) return false; // NEW
        if (context.edge && cell === context.edge) return true; // NEW
        if (cell === context.sourceCell || cell === context.targetCell || cell === context.assembly) return true; // NEW
        if (isAssembly(cell)) return findAssemblyAncestor(context.sourceCell) === cell || findAssemblyAncestor(context.targetCell) === cell; // NEW
        const selectedAssembly = findAssemblyAncestor(cell); // NEW
        return selectedAssembly && (selectedAssembly === findAssemblyAncestor(context.sourceCell) || selectedAssembly === findAssemblyAncestor(context.targetCell)); // NEW
    } // NEW

    function connectionContextForBoundary(moduleCell, boundary) { // NEW
        const b = normalizeBoundary(boundary); // NEW
        if (b.type === "edge") return externalConnectionContext(moduleCell, b); // NEW
        if (b.type === "internal") return internalConnectionContext(moduleCell, b); // NEW
        return null; // NEW
    } // NEW

    function externalConnectionContext(moduleCell, boundary) { // NEW
        const edge = findCellById(moduleCell, boundary.edgeId); // NEW
        if (!edge) return null; // NEW
        return externalConnectionContextForEdge(moduleCell, edge, boundary); // NEW
    } // NEW

    function externalConnectionContextForEdge(moduleCell, edge, boundary) { // NEW
        const sourceCell = edge.source || (model.getTerminal && model.getTerminal(edge, true)); // NEW
        const targetCell = edge.target || (model.getTerminal && model.getTerminal(edge, false)); // NEW
        if (!sourceCell || !targetCell) return null; // NEW
        const mode = getCellAttr(edge, ATTRS.DIRECT_LINK_EDGE, "") === "1" ? "direct" : "pipe"; // NEW
        return { // NEW
            kind: "external", // NEW
            mode, // NEW
            boundary, // NEW
            edge, // NEW
            sourceCell, // NEW
            targetCell, // NEW
            sourcePort: portForConnectionEdge(edge, true), // NEW
            targetPort: portForConnectionEdge(edge, false), // NEW
            pipePartId: getCellAttr(edge, ATTRS.PIPE_PART_ID, ""), // NEW
            lengthFt: mode === "pipe" ? measuredEdgeLengthFeet(edge) : 0 // NEW
        }; // NEW
    } // NEW

    function internalConnectionContext(moduleCell, boundary) { // NEW
        const assembly = findCellById(moduleCell, boundary.assemblyId); // NEW
        const sourceCell = findCellById(moduleCell, boundary.upstreamId); // NEW
        const targetCell = findCellById(moduleCell, boundary.downstreamId); // NEW
        if (!assembly || !sourceCell || !targetCell || !boundaryExists(moduleCell, boundary)) return null; // NEW
        return { // NEW
            kind: "internal", // NEW
            mode: "internal", // NEW
            boundary, // NEW
            assembly, // NEW
            sourceCell, // NEW
            targetCell, // NEW
            sourcePort: { cellId: getCellId(sourceCell), role: "output", index: 0 }, // NEW
            targetPort: { cellId: getCellId(targetCell), role: "input", index: 0 }, // NEW
            pipePartId: "", // NEW
            lengthFt: 0 // NEW
        }; // NEW
    } // NEW

    function clearSelectedExternalPortBoundaries(session) { // NEW
        session.selectedBoundaries = (session.selectedBoundaries || []).filter(function (boundary) { return normalizeBoundary(boundary).type !== "edge"; }); // NEW
    } // NEW

    function clearSelectedConnectionBoundaries(session) { // NEW
        session.selectedBoundaries = []; // NEW
        session.focusedConnectionBoundary = null; // NEW
        session.inlineActionAnchorPort = null; // NEW
    } // NEW

    function toggleSelectedPortBoundary(session, boundary) { // NEW
        const normalized = normalizeBoundary(boundary); // NEW
        const key = boundaryKey(normalized); // NEW
        if (!key) return; // NEW
        const current = selectedValidBoundaries(session); // NEW
        const selected = current.map(boundaryKey).indexOf(key) >= 0; // CHANGE
        session.selectedPorts = []; // CHANGE
        if (selected) { // NEW
            if (boundaryKey(session.focusedConnectionBoundary) === key) session.focusedConnectionBoundary = null; // NEW
            if (boundaryKey(boundaryForPort(session.moduleCell, session.inlineActionAnchorPort)) === key) session.inlineActionAnchorPort = null; // NEW
            session.selectedBoundaries = current.filter(function (entry) { return boundaryKey(entry) !== key; }); // CHANGE
        } else session.selectedBoundaries = [normalized]; // CHANGE
    } // NEW

    function toggleSelectedBoundary(session, boundary) { // NEW
        const normalized = normalizeBoundary(boundary); // NEW
        const key = boundaryKey(normalized); // NEW
        if (!key) return; // NEW
        const selected = selectedValidBoundaries(session).map(boundaryKey).indexOf(key) >= 0; // CHANGE
        session.selectedPorts = []; // NEW
        if (selected) clearSelectedConnectionBoundaries(session); // CHANGE
        else session.selectedBoundaries = [normalized]; // CHANGE
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

    function externalEdgesForAssemblyCell(moduleCell, assembly) { // NEW
        const edges = externalEdgesForCell(moduleCell, assembly); // NEW
        assemblyPartCells(assembly).forEach(function (part) { // NEW
            externalEdgesForCell(moduleCell, part).forEach(function (edge) { if (edges.indexOf(edge) < 0) edges.push(edge); }); // NEW
        }); // NEW
        return edges; // NEW
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

    function partHasPipeCapableInput(part) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        return !!(p && p.connectors.inputs > 0 && connectorUsesPipe(p.connectors.input)); // NEW
    } // NEW

    function partCanFeedConnector(part, connector) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        if (!p || p.category === "pipe_tubing" || p.connectors.outputs <= 0) return false; // NEW
        return connectorRecordsMatch(p.connectors.output, connector, null).ok; // CHANGE
    } // NEW

    function isExposedAssemblyOutletRow(row) { // NEW
        if (!row || row.role !== "output") return false; // NEW
        if (row.bedPort) return true; // NEW
        const assembly = findAssemblyAncestor(row.cell); // NEW
        return !!(assembly && assemblyType(assembly) !== "bed" && lastAssemblyPart(assembly) === row.cell && !internalNeighborForPort(row.cell, "output")); // NEW
    } // NEW

    function partAllowedForConnectionRow(moduleCell, row, part) { // NEW
        if (isExposedAssemblyOutletRow(row) && !partHasPipeCapableInput(part)) return false; // NEW
        return true; // NEW
    } // NEW

    function compatibleDropdownParts(moduleCell, cell, role) { // NEW
        const connector = ConnectorRules.portConnectorForCell(moduleCell, cell, role); // CHANGE
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
        if (isAssembly(cell) && assemblyType(cell) === "bed") return { row: { cell, role: normalized.role, index: normalized.index, bedPort: true }, port: normalized }; // CHANGE
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
        const baseParts = context ? compatibleDropdownParts(session.moduleCell, context.row.cell, context.row.role).filter(function (part) { return partAllowedForConnectionRow(session.moduleCell, context.row, part); }) : allAddableCatalogParts(session.moduleCell); // CHANGE
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
        const connector = ConnectorRules.portConnectorForCell(moduleCell, cell, role); // CHANGE
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
        if (!edge) return normalizePort(port).role === "output" ? "Available: " + portDisplayLabel(moduleCell, port) + " downstream connection" : "Available: " + portDisplayLabel(moduleCell, port) + " upstream connection"; // CHANGE
        if (getCellAttr(edge, ATTRS.DIRECT_LINK_EDGE, "") === "1") return "Direct: " + edgeConnectionDisplayLabel(moduleCell, edge) + " to " + irrigationCellLabel(normalizePort(port).role === "output" ? edge.target : edge.source); // CHANGE
        const pipe = partById(readCatalog(moduleCell), getCellAttr(edge, ATTRS.PIPE_PART_ID, "")); // NEW
        const other = normalizePort(port).role === "output" ? edge.target : edge.source; // NEW
        return "Pipe: " + edgeConnectionDisplayLabel(moduleCell, edge) + " " + (pipe ? pipe.name : "auto pipe") + " -> " + irrigationCellLabel(other); // CHANGE
    } // NEW

    function portDisplayLabel(moduleCell, port) { // NEW
        const normalized = normalizePort(port); // NEW
        return connectorDisplayLabel(ConnectorRules.portConnectorForCell(moduleCell, portCell(moduleCell, normalized), normalized.role)); // NEW
    } // NEW

    function cellPortDisplayLabel(moduleCell, cell, role) { // NEW
        return connectorDisplayLabel(ConnectorRules.portConnectorForCell(moduleCell, cell, role)); // NEW
    } // NEW

    function edgeConnectionDisplayLabel(moduleCell, edge) { // NEW
        return connectionEdgeDisplayLabel(moduleCell, edge, ConnectorRules.portConnectorForCell(moduleCell, edge && edge.source, "output"), ConnectorRules.portConnectorForCell(moduleCell, edge && edge.target, "input")); // NEW
    } // NEW

    function internalConnectionDisplayLabel(moduleCell, upstream, downstream) { // NEW
        return connectionDisplayLabel(ConnectorRules.portConnectorForCell(moduleCell, upstream, "output"), ConnectorRules.portConnectorForCell(moduleCell, downstream, "input")); // NEW
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
        const parsed = GraphStore.readJsonAttr(moduleCell, ATTRS.PATHS_JSON, null); // CHANGE
        return parsed && Array.isArray(parsed.paths) ? parsed.paths : [];
    }

    function writePaths(moduleCell, paths) {
        if (activeIrrigationEditDepth === 0) return runIrrigationEdit("writePaths", function () { return writePaths(moduleCell, paths); }); // NEW
        GraphStore.writeJsonAttr(moduleCell, ATTRS.PATHS_JSON, { version: PLUGIN_VERSION, paths: paths || [] }); // CHANGE
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
            partStates: (options && options.partStates || []).slice(), // NEW
            pipePartId: options && options.pipePartId || "",
            pipePartStates: (options && options.pipePartStates || []).slice(), // NEW
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
            partStates: (options && options.partStates || []).slice(), // NEW
            pipePartId: options && options.pipePartId || "", // CHANGE
            pipePartStates: (options && options.pipePartStates || []).slice(), // NEW
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

    function demandFromBedAssembly(moduleCell, bedAssembly) { // NEW
        const template = readBedAssemblyTemplateRecord(moduleCell, bedAssembly) || {}; // CHANGE
        const demand = template.demand || {}; // NEW
        return { flowGpm: finiteNumber(demand.flowGpm, 0), operatingPressurePsi: finiteNumber(demand.operatingPressurePsi, 0) }; // NEW
    } // NEW

    function cumulativeBedDemand(moduleCell, bedAssembly) { // NEW
        const seen = new Set(); // NEW
        function visit(assembly) { // NEW
            const id = getCellId(assembly); // NEW
            if (!id || seen.has(id)) return { flowGpm: 0, operatingPressurePsi: 0 }; // NEW
            seen.add(id); // NEW
            const own = demandFromBedAssembly(moduleCell, assembly); // CHANGE
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
        const catalog = IrrigationCatalog.read(moduleCell); // CHANGE
        const source = findCellById(moduleCell, path.sourceEndpointId);
        if (!source) { // NEW
            const bedDemand = Hydraulics.demandFromPath(catalog, path); // NEW
            return { // NEW
                flowGpm: finiteNumber(bedDemand.flowGpm, 0), // NEW
                availablePressurePsi: null, // NEW
                operatingPressurePsi: finiteNumber(bedDemand.operatingPressurePsi, 0), // NEW
                maxOperatingPressurePsi: null, // NEW
                deliveredPressurePsi: null, // NEW
                pressureLossPsi: 0, // NEW
                requiredPressurePsi: finiteNumber(bedDemand.operatingPressurePsi, 0), // NEW
                marginPsi: null, // NEW
                ok: false, // NEW
                warnings: [DISCONNECTED_SOURCE_WARNING] // NEW
            }; // NEW
        } // NEW
        const sourceProfile = endpointProfile(source);
        return Hydraulics.estimatePath({ // CHANGE
            catalog,
            sourceProfile,
            bedDemand: Hydraulics.demandFromPath(catalog, path), // CHANGE
            partIds: path.partIds || [],
            pipePartId: path.pipePartId,
            pipeSegments: Hydraulics.pipeSegmentsForPath(moduleCell, path), // CHANGE
            lengthFt: path.pipePartId ? Hydraulics.pathRouteLengthFeet(moduleCell, path) : 0 // CHANGE
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
        const catalog = IrrigationCatalog.read(moduleCell); // CHANGE
        const existing = ReportModel.deriveAssemblyPaths(moduleCell).filter(function (other) { return other.id !== path.id; }); // CHANGE
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
        const catalog = IrrigationCatalog.read(moduleCell); // CHANGE
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
            const direct = ConnectorRules.connectorRecordsMatch({ // CHANGE
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
        const sourceMatch = ConnectorRules.canEndpointConnectToPart(endpointProfile(source), first); // CHANGE
        if (!sourceMatch.ok) errors.push("Source endpoint cannot connect to " + (first && first.name || partIds[0]) + ": " + sourceMatch.reason);
        for (let i = 1; i < parts.length; i++) {
            const match = ConnectorRules.canConnectParts(parts[i - 1], parts[i], endpointProfile(target)); // CHANGE
            if (!match.ok) errors.push((parts[i - 1] && parts[i - 1].name || partIds[i - 1]) + " cannot connect to " + (parts[i] && parts[i].name || partIds[i]) + ": " + match.reason);
        }
        const last = parts[parts.length - 1];
        const targetMatch = ConnectorRules.canPartReachEndpoint(last, endpointProfile(target)); // CHANGE
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
        const state = partStateForCell(cell); // NEW
        setCellAttrs(cell, {
            label,
            [ATTRS.COMPONENT]: "1",
            [ATTRS.COMPONENT_TYPE]: part ? part.category : "unknown",
            [ATTRS.CATALOG_PART_ID]: partId,
            [ATTRS.PART_STATE]: state, // NEW
            [ATTRS.PATH_ID]: pathId,
            [ATTRS.GENERATED]: "1"
        });
        applyPartCellLifecycleStyle(cell); // NEW
    }

    function updateGeneratedPipeEdge(edge, pipePartId, pathId) {
        if (!edge) return;
        const moduleCell = findGardenModuleAncestor(edge); // NEW
        const state = partStateForCell(edge); // NEW
        setCellAttrs(edge, {
            label: pipeEdgeDisplayLabelForPart(moduleCell, pipePartId || "", ConnectorRules.portConnectorForCell(moduleCell, edge.source, "output"), ConnectorRules.portConnectorForCell(moduleCell, edge.target, "input")), // NEW
            [ATTRS.PIPE_EDGE]: "1",
            [ATTRS.PIPE_PART_ID]: pipePartId || "",
            [ATTRS.PART_STATE]: state, // NEW
            [ATTRS.PATH_ID]: pathId,
            [ATTRS.GENERATED]: "1"
        });
        applyPipeEdgeLifecycleStyle(edge, moduleCell, GENERATED_PIPE_EDGE_BASE_STYLE); // CHANGE
    }

    function commitStagedPath(moduleCell, stagedPath) {
        const catalog = IrrigationCatalog.read(moduleCell); // CHANGE
        const path = Object.assign({}, stagedPath);
        const previous = readPaths(moduleCell).find(function (existing) { return existing.id === path.id; }) || {};
        if (!path.componentCellIds || !path.componentCellIds.length) path.componentCellIds = (previous.componentCellIds || []).slice();
        if (!path.pipeEdgeIds || !path.pipeEdgeIds.length) path.pipeEdgeIds = (previous.pipeEdgeIds || []).slice();
        path.hydraulic = Hydraulics.calculatePath(moduleCell, path); // CHANGE
        const blockers = Hydraulics.validatePathGraph(moduleCell, path) // CHANGE
            .concat(Hydraulics.validatePathCompatibility(moduleCell, path)) // CHANGE
            .concat(Hydraulics.validateSharedCapacity(moduleCell, path)) // CHANGE
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
                    ASSEMBLY_PART_PLANNED_STYLE, // CHANGE
                    {});
                updateGeneratedComponentCell(component, part, partId, path.id);
                if (component) createdComponents.push(component);
            });

            const chain = [sourceEndpoint].concat(createdComponents).concat([targetEndpoint]).filter(Boolean);
            const reusableEdges = findReusableCells(moduleCell, path.pipeEdgeIds, Math.max(0, chain.length - 1));
            for (let i = 0; i < chain.length - 1; i++) {
                const edgeLabel = pipeEdgeDisplayLabelForPart(moduleCell, path.pipePartId, ConnectorRules.portConnectorForCell(moduleCell, chain[i], "output"), ConnectorRules.portConnectorForCell(moduleCell, chain[i + 1], "input")); // NEW
                const edge = reusableEdges[i] || createEdge(parent, chain[i], chain[i + 1], edgeLabel, pipeEdgeStyleForPart(moduleCell, path.pipePartId, GENERATED_PIPE_EDGE_BASE_STYLE), { label: edgeLabel }); // CHANGE
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
        if (activeIrrigationEditDepth === 0) return runIrrigationEdit("commitBedTemplate", function () { return commitBedTemplate(moduleCell, pathId, bedCell, template); }); // NEW
        const linkedBedCell = isAssembly(bedCell) && assemblyType(bedCell) === "bed" ? bedCellForAssembly(moduleCell, bedCell) : bedCell; // CHANGE
        const bedAssembly = isAssembly(bedCell) && assemblyType(bedCell) === "bed" ? bedCell : resolveBedTemplateAssembly(moduleCell, bedCell); // CHANGE
        const previousRecord = bedAssembly ? readBedAssemblyTemplateRecord(moduleCell, bedAssembly) : null; // NEW
        const bedGeo = getGeometry(bedAssembly) || getGeometry(linkedBedCell) || { width: 160, height: 80 }; // CHANGE
        const templateDef = BED_TEMPLATES.find(function (entry) { return entry.id === (template && template.templateId); }) || BED_TEMPLATES[0];
        const roleParts = bedTemplateRolePartIds(template); // NEW
        const templateModel = template && template.templateModel === BED_TEMPLATE_MODEL_BOM ? BED_TEMPLATE_MODEL_BOM : ""; // NEW
        const pipePartId = templateModel === BED_TEMPLATE_MODEL_BOM ? "" : bedTemplatePipePartId(templateDef.id, template && template.pipePartId); // CHANGE
        const partIds = template && Array.isArray(template.partIds) ? template.partIds.slice() : bedTemplatePartIds(roleParts.inletPartId, roleParts.outletPartId); // CHANGE
        const rowCount = Math.max(0, Math.floor(finiteNumber(template && template.spacing && template.spacing.rows, templateDef.defaultRows))); // CHANGE
        const rowOrientation = normalizeBedRowOrientation(template && template.rowOrientation, templateDef); // NEW
        const hasAssemblyLabelMode = !!(template && Object.prototype.hasOwnProperty.call(template, "assemblyLabelMode")); // NEW
        const spacing = Object.assign({ rows: rowCount, emitterInches: 12, rowSpacingCm: rowSpacingCmForRows(bedGeo, rowCount, rowOrientation) }, template && template.spacing || {}); // CHANGE
        spacing.rowSpacingCm = rowSpacingCmForRows(bedGeo, rowCount, rowOrientation); // NEW
        const demand = {
            flowGpm: rowCount > 0 ? finiteNumber(template && template.demand && template.demand.flowGpm, templateDef.flowGpm) : 0, // CHANGE
            operatingPressurePsi: rowCount > 0 ? finiteNumber(template && template.demand && template.demand.operatingPressurePsi, templateDef.pressurePsi) : 0 // CHANGE
        };
        const record = {
            version: PLUGIN_VERSION,
            pathId,
            templateId: templateDef.id,
            irrigationType: template && template.irrigationType && template.irrigationType !== templateDef.id ? template.irrigationType : templateDef.lineKind, // CHANGE
            inletPartId: roleParts.inletPartId, // NEW
            outletPartId: roleParts.outletPartId, // NEW
            pipePartId, // NEW
            partIds, // CHANGE
            partState: normalizePartState(template && template.partState || previousRecord && previousRecord.partState), // CHANGE
            spacing,
            demand,
            assemblyLabelMode: hasAssemblyLabelMode ? String(template.assemblyLabelMode || "") : (templateModel === BED_TEMPLATE_MODEL_BOM ? BED_ASSEMBLY_LABEL_HIDDEN : ""), // CHANGE
            committedAt: new Date().toISOString()
        };
        if (templateModel === BED_TEMPLATE_MODEL_BOM) { // NEW
            record.templateModel = BED_TEMPLATE_MODEL_BOM; // NEW
            record.recipeVersion = finiteNumber(template && template.recipeVersion, template && template.resolvedBomParts ? BED_RECIPE_VERSION : 0); // NEW
            record.rowPartId = String(template && template.rowPartId || ""); // NEW
            record.emitterPartId = String(template && template.emitterPartId || ""); // NEW
            record.rowTakeoffPartId = String(template && template.rowTakeoffPartId || ""); // NEW
            record.rowEndCapPartId = String(template && template.rowEndCapPartId || ""); // NEW
            record.headerEndCapPartId = String(template && template.headerEndCapPartId || ""); // NEW
            record.supplyPipePartId = String(template && template.supplyPipePartId || ""); // NEW
            record.rowOrientation = rowOrientation; // CHANGE
            record.rowLengthMeters = finiteNumber(template && template.rowLengthMeters, rowLengthMetersForBedGeometry(bedGeo, record.rowOrientation)); // NEW
            record.rowSpacingCm = finiteNumber(template && template.rowSpacingCm, spacing.rowSpacingCm); // NEW
            record.totalRowMeters = finiteNumber(template && template.totalRowMeters, record.rowLengthMeters * rowCount); // NEW
            record.requiredParts = (template && Array.isArray(template.requiredParts) ? template.requiredParts : []).map(function (entry) { // NEW
                return { partId: String(entry && entry.partId || "").trim(), quantityPerRowMeter: finiteNumber(entry && entry.quantityPerRowMeter, 0), quantityMeters: finiteNumber(entry && entry.quantityMeters, 0), unit: "m" }; // NEW
            }).filter(function (entry) { return !!entry.partId; }); // NEW
            record.resolvedBomParts = (template && Array.isArray(template.resolvedBomParts) ? template.resolvedBomParts : []).map(function (entry) { // NEW
                return { role: String(entry && entry.role || ""), partId: String(entry && entry.partId || "").trim(), quantity: finiteNumber(entry && entry.quantity, 0), unit: String(entry && entry.unit || "each") }; // NEW
            }).filter(function (entry) { return !!entry.partId && entry.quantity > 0; }); // NEW
            if (record.recipeVersion > 0) record.partIds = uniqueStrings([record.inletPartId, record.outletPartId, record.rowPartId, record.emitterPartId, record.rowTakeoffPartId, record.rowEndCapPartId, record.headerEndCapPartId, record.supplyPipePartId].concat(record.resolvedBomParts.map(function (entry) { return entry.partId; }))).filter(Boolean); // NEW
            record.anchorPartId = String(template && template.anchorPartId || ""); // NEW
        } // NEW

        model.beginUpdate && model.beginUpdate();
        try {
            if (!bedAssembly) return record; // CHANGE
            if (bedAssembly) { // NEW
                setCellAttrs(bedAssembly, { label: assemblyLabelForTemplateRecord(record), [ATTRS.BED_TEMPLATE_JSON]: JSON.stringify(record) }); // CHANGE
                createBedTemplateLayoutCells(bedAssembly, pathId, record, getGeometry(bedAssembly) || bedGeo); // CHANGE
            } // NEW

        } finally {
            model.endUpdate && model.endUpdate();
        }

        return record;
    }

    function assemblyLabelForTemplateRecord(record) { // NEW
        return record && record.assemblyLabelMode === BED_ASSEMBLY_LABEL_HIDDEN ? "" : bedTemplateLabel(record && record.templateId); // NEW
    } // NEW

    function createBedTemplateLayoutCells(bedCell, pathId, record, bedGeo) {
        const assemblyParent = isAssembly(bedCell); // NEW
        const inset = assemblyParent ? 8 : 6; // NEW
        const contentTop = 0; // CHANGE
        const parentHeight = Number(bedGeo.height || 80); // NEW
        const width = Math.max(40, Number(bedGeo.width || 160) - inset * 2); // CHANGE
        const height = Math.max(8, parentHeight - inset * 2); // CHANGE
        const rows = Math.max(0, Math.floor(finiteNumber(record.spacing && record.spacing.rows, 0))); // CHANGE
        const rowOrientation = normalizeBedRowOrientation(record.rowOrientation, bedTemplateById(record.templateId)); // NEW
        const existingRows = getChildCells(bedCell).filter(function (cell) { return getCellAttr(cell, ATTRS.BED_LAYOUT, "") === "1"; }); // NEW
        const existingSupply = getChildCells(bedCell).filter(function (cell) { return getCellAttr(cell, ATTRS.BED_SUPPLY_LINE, "") === "1"; })[0] || null; // NEW
        const rowStyle = bedLayoutStyleForState(partStateForRecord(record)); // CHANGE
        let changed = false; // NEW
        if (rows === 0) { existingRows.forEach(function (cell) { removeCellFromParent(cell); changed = true; }); if (existingSupply) { removeCellFromParent(existingSupply); changed = true; } return changed; } // CHANGE
        if (record && record.supplyPipePartId) { // NEW
            const savedSupplyGeo = getGeometry(existingSupply) || {}; // NEW
            const supplyGeo = rowOrientation === "height" ? { x: inset, y: finiteNumber(savedSupplyGeo.y, inset), width, height: 6 } : { x: finiteNumber(savedSupplyGeo.x, inset), y: inset, width: 6, height }; // NEW
            const supplyAttrs = { label: "Supply line", [ATTRS.BED_SUPPLY_LINE]: "1", [ATTRS.PART_STATE]: partStateForRecord(record), [ATTRS.PATH_ID]: pathId, [ATTRS.GENERATED]: "1", [ATTRS.BED_TEMPLATE_JSON]: JSON.stringify(record) }; // NEW
            if (!existingSupply) { createVertex(bedCell, supplyAttrs.label, supplyGeo.x, supplyGeo.y, supplyGeo.width, supplyGeo.height, BED_SUPPLY_LINE_STYLE, supplyAttrs); changed = true; } // NEW
            else { changed = setGeometry(existingSupply, supplyGeo) || changed; changed = setCellStyle(existingSupply, BED_SUPPLY_LINE_STYLE) || changed; changed = setCellAttrs(existingSupply, supplyAttrs) || changed; } // NEW
        } else if (existingSupply) { removeCellFromParent(existingSupply); changed = true; } // NEW
        const rowGap = Math.max(0, rowSpacingSpanUnitsForBedGeometry(bedGeo, rowOrientation) / rows); // CHANGE
        for (let i = 0; i < rows; i++) {
            const center = rowGap * (i + 0.5); // NEW
            const x = rowOrientation === "height" ? center - 3 : inset; // CHANGE
            const y = rowOrientation === "height" ? inset : contentTop + center - 3; // CHANGE
            const w = rowOrientation === "height" ? 6 : width; // NEW
            const h = rowOrientation === "height" ? height : 6; // NEW
            const attrs = { label: bedTemplateRowDisplayLabel(record.irrigationType), [ATTRS.BED_LAYOUT]: "1", [ATTRS.PART_STATE]: partStateForRecord(record), [ATTRS.PATH_ID]: pathId, [ATTRS.GENERATED]: "1", [ATTRS.BED_TEMPLATE_JSON]: JSON.stringify(record) }; // CHANGE
            const row = existingRows[i] || createVertex(bedCell, attrs.label, x, y, w, h, rowStyle, attrs); // CHANGE
            if (!existingRows[i]) { changed = true; continue; } // NEW
            changed = setGeometry(row, { x, y, width: w, height: h }) || changed; // NEW
            changed = setCellStyle(row, rowStyle) || changed; // NEW
            changed = setCellAttrs(row, attrs) || changed; // NEW
        }
        existingRows.slice(rows).forEach(function (cell) { removeCellFromParent(cell); changed = true; }); // NEW
        return changed; // NEW
    }

    function reflowBedTemplateLayout(moduleCell, bedAssembly) { // NEW
        const bedCell = bedCellForAssembly(moduleCell, bedAssembly); // NEW
        const record = readBedAssemblyTemplateRecord(moduleCell, bedAssembly); // CHANGE
        if (!record) return; // NEW
        return refreshBedAssemblyRowsFromTemplate(moduleCell, bedAssembly, bedCell, record); // CHANGE
    } // NEW

    function rowMetricRecordForGeometry(moduleCell, record, bedGeo) { // NEW
        if (!record || record.templateModel !== BED_TEMPLATE_MODEL_BOM) return { record, recomputed: false }; // NEW
        const catalog = readCatalog(moduleCell); // NEW
        const bom = computeBedTemplateBom(catalog, bedGeo || {}, record.templateId, record.spacing && record.spacing.rows, record.rowOrientation, record.recipeVersion > 0 ? record : null); // CHANGE
        if (bom.rowCount > 0 && (bom.missingPartIds.length || !bom.anchorPartId)) return { record, recomputed: false, missingPartIds: bom.missingPartIds }; // CHANGE
        return { // NEW
            record: Object.assign({}, record, { // NEW
                rowOrientation: bom.rowOrientation, // NEW
                rowLengthMeters: bom.rowLengthMeters, // NEW
                rowSpacingCm: bom.rowSpacingCm, // NEW
                totalRowMeters: bom.totalRowMeters, // NEW
                requiredParts: bom.requiredParts, // NEW
                resolvedBomParts: bom.recipe ? bom.recipe.resolvedBomParts : record.resolvedBomParts, // NEW
                supplyPipePartId: bom.recipe ? bom.recipe.supplyPipePartId : record.supplyPipePartId, // NEW
                anchorPartId: bom.anchorPartId, // NEW
                demand: bom.demand, // NEW
                spacing: Object.assign({}, record.spacing || {}, { rows: bom.rowCount, rowSpacingCm: bom.rowSpacingCm }) // CHANGE
            }), // NEW
            recomputed: true // NEW
        }; // NEW
    } // NEW

    function refreshBedAssemblyRowsFromTemplate(moduleCell, bedAssembly, bedCell, record) { // NEW
        if (!bedAssembly || !record) return false; // NEW
        const geometry = getGeometry(bedAssembly) || getGeometry(bedCell) || { width: 160, height: 80 }; // NEW
        const refreshed = rowMetricRecordForGeometry(moduleCell, record, geometry); // NEW
        const nextRecord = refreshed.record || record; // NEW
        let changed = false; // NEW
        if (refreshed.recomputed && JSON.stringify(nextRecord) !== JSON.stringify(record)) { // CHANGE
            changed = setCellAttrs(bedAssembly, { [ATTRS.BED_TEMPLATE_JSON]: JSON.stringify(nextRecord) }) || changed; // CHANGE
        } // NEW
        if (nextRecord.assemblyLabelMode === BED_ASSEMBLY_LABEL_HIDDEN) changed = setCellAttrs(bedAssembly, { label: assemblyLabelForTemplateRecord(nextRecord) }) || changed; // CHANGE
        changed = createBedTemplateLayoutCells(bedAssembly, nextRecord.pathId || ("assembly_bed_" + sanitizeId(getCellId(bedCell))), nextRecord, geometry) || changed; // NEW
        return changed; // NEW
    } // NEW

    function syncLinkedBedAssemblyToBed(moduleCell, assembly, bedCell, opts) { // NEW
        if (!isBedAssembly(assembly)) return false; // NEW
        const linkedBed = bedCell || bedCellForAssembly(moduleCell, assembly); // NEW
        if (!linkedBed) return false; // NEW
        moduleCell = moduleCell || findGardenModuleAncestor(assembly) || findGardenModuleAncestor(linkedBed); // CHANGE
        const previousLinkedBed = bedCellForAssembly(moduleCell, assembly); // NEW
        const previousBedId = getCellId(previousLinkedBed) || ""; // NEW
        const linkedBedId = getCellId(linkedBed) || ""; // NEW
        const changingLinkedBed = !!(previousBedId && linkedBedId && previousBedId !== linkedBedId); // NEW
        const movingPorts = changingLinkedBed && previousLinkedBed ? readBedPortConfig(previousLinkedBed) : null; // NEW
        const fitWidth = !opts || opts.fitWidth !== false; // CHANGE
        const fitHeight = !opts || opts.fitHeight !== false; // NEW
        const current = getGeometry(assembly) || {}; // NEW
        const bedGeo = bedSyncedAssemblyGeometry(linkedBed); // CHANGE
        const next = Object.assign({}, current); // NEW
        if (fitWidth) { next.x = bedGeo.x; next.width = bedGeo.width; } // NEW
        if (fitHeight) { next.y = bedGeo.y; next.height = bedGeo.height; } // NEW
        const ownsTransaction = !(opts && opts.inTransaction); // NEW
        let changed = false; // NEW
        if (ownsTransaction && model.beginUpdate) model.beginUpdate(); // NEW
        try { // NEW
            if (movingPorts) writeBedPortConfig(linkedBed, movingPorts); // NEW
            if (fitWidth || fitHeight) changed = !!setGeometry(assembly, next); // CHANGE
            changed = setCellAttrs(assembly, { [ATTRS.LINKED_BED_ID]: getCellId(linkedBed) || "", bed_fit_width: fitWidth ? "1" : "0", bed_fit_height: fitHeight ? "1" : "0" }) || changed; // NEW
            changed = syncBedAssemblyRotation(assembly, linkedBed) || changed; // NEW
            reflowBedTemplateLayout(moduleCell || findGardenModuleAncestor(assembly), assembly); // NEW
            if (changingLinkedBed) changed = clearBedTemplateDataIfUnused(moduleCell, previousLinkedBed, assembly) || changed; // NEW
        } finally { if (ownsTransaction && model.endUpdate) model.endUpdate(); } // NEW
        if (graph.refresh) graph.refresh(assembly); // NEW
        return changed; // NEW
    } // NEW

    function bedAssemblyFitAxes(assembly) { // NEW
        return { // NEW
            fitWidth: getCellAttr(assembly, "bed_fit_width", "1") !== "0", // NEW
            fitHeight: getCellAttr(assembly, "bed_fit_height", "1") !== "0" // NEW
        }; // NEW
    } // NEW

    function linkedBedAssembliesForBed(moduleCell, bedCell) { // NEW
        const bedId = getCellId(bedCell) || ""; // NEW
        if (!moduleCell || !bedId) return []; // NEW
        return collectDescendants(moduleCell, function (cell) { return isBedAssembly(cell) && getCellAttr(cell, ATTRS.LINKED_BED_ID, "") === bedId; }); // NEW
    } // NEW

    function normalizeBedIrrigationMethodId(record) { // NEW
        const template = bedTemplateById(record && record.templateId); // NEW
        return String(record && record.irrigationType || template && template.lineKind || "").trim(); // NEW
    } // NEW

    function getBedIrrigationMethods(moduleCell, bedCell) { // NEW
        const root = moduleCell || findGardenModuleAncestor(bedCell); // NEW
        const seen = new Set(); // NEW
        const methods = []; // NEW
        linkedBedAssembliesForBed(root, bedCell).forEach(function (assembly) { // NEW
            const record = readBedAssemblyTemplateRecord(root, assembly); // NEW
            const id = normalizeBedIrrigationMethodId(record); // NEW
            const label = bedIrrigationMethodLabel(id); // NEW
            if (!id || !label || seen.has(id)) return; // NEW
            seen.add(id); // NEW
            methods.push({ id, label }); // NEW
        }); // NEW
        return methods; // NEW
    } // NEW

    function readBedTemplateRecord(bedAssembly) { // NEW
        return safeJsonParse(getCellAttr(bedAssembly, ATTRS.BED_TEMPLATE_JSON, ""), null); // CHANGE
    } // NEW

    function readBedAssemblyTemplateRecord(moduleCell, assembly) { // NEW
        return readBedTemplateRecord(assembly) || safeJsonParse(getCellAttr(bedLayoutRowsForAssembly(assembly)[0], ATTRS.BED_TEMPLATE_JSON, ""), null); // CHANGE
    } // NEW

    function bedLayoutRowsForAssembly(assembly) { // NEW
        return getChildCells(assembly).filter(function (cell) { return getCellAttr(cell, ATTRS.BED_LAYOUT, "") === "1"; }); // NEW
    } // NEW

    function clearBedTemplateDataIfUnused(moduleCell, bedCell, movedAssembly) { // NEW
        if (!bedCell || !moduleCell) return false; // NEW
        const bedId = getCellId(bedCell) || ""; // NEW
        const stillUsed = collectDescendants(moduleCell, function (cell) { // NEW
            return cell !== movedAssembly && isBedAssembly(cell) && getCellAttr(cell, ATTRS.LINKED_BED_ID, "") === bedId; // NEW
        }).length > 0; // NEW
        if (stillUsed) return false; // NEW
        return setCellAttrs(bedCell, { [ATTRS.BED_PORTS_JSON]: "" }); // CHANGE
    } // NEW

    function relinkBedAssemblyToBed(moduleCell, assembly, targetBed, opts) { // NEW
        if (!moduleCell || !isBedAssembly(assembly) || !isGardenBed(targetBed)) return false; // NEW
        const previousBed = bedCellForAssembly(moduleCell, assembly); // NEW
        const previousBedId = getCellId(previousBed) || ""; // NEW
        const targetBedId = getCellId(targetBed) || ""; // NEW
        const sameBed = previousBedId && previousBedId === targetBedId; // NEW
        const templateRecord = readBedAssemblyTemplateRecord(moduleCell, assembly); // CHANGE
        const portSource = previousBed || targetBed; // NEW
        const portConfig = portSource ? readBedPortConfig(portSource) : null; // NEW
        const axes = opts && opts.axes ? opts.axes : bedAssemblyFitAxes(assembly); // NEW
        let changed = false; // NEW
        if (!sameBed && portConfig) writeBedPortConfig(targetBed, portConfig); // NEW
        changed = syncLinkedBedAssemblyToBed(moduleCell, assembly, targetBed, { inTransaction: true, fitWidth: !!axes.fitWidth, fitHeight: !!axes.fitHeight }) || changed; // NEW
        if (templateRecord) changed = refreshBedAssemblyRowsFromTemplate(moduleCell, assembly, targetBed, templateRecord) || changed; // CHANGE
        if (!sameBed && previousBed) changed = clearBedTemplateDataIfUnused(moduleCell, previousBed, assembly) || changed; // NEW
        return changed; // NEW
    } // NEW

    function rectCenter(bounds) { // NEW
        return bounds ? { x: finiteNumber(bounds.x, 0) + finiteNumber(bounds.width, 0) / 2, y: finiteNumber(bounds.y, 0) + finiteNumber(bounds.height, 0) / 2 } : null; // NEW
    } // NEW

    function rotateModelPoint(point, center, angleDeg) { // NEW
        const rad = finiteNumber(angleDeg, 0) * Math.PI / 180; // NEW
        const cos = Math.cos(rad); // NEW
        const sin = Math.sin(rad); // NEW
        const dx = finiteNumber(point && point.x, 0) - finiteNumber(center && center.x, 0); // NEW
        const dy = finiteNumber(point && point.y, 0) - finiteNumber(center && center.y, 0); // NEW
        return { x: finiteNumber(center && center.x, 0) + dx * cos - dy * sin, y: finiteNumber(center && center.y, 0) + dx * sin + dy * cos }; // NEW
    } // NEW

    function cellRotationDeg(cell) { // NEW
        const styleRotation = styleValue(cell && cell.style, "rotation"); // NEW
        return finiteNumber(styleRotation, 0); // NEW
    } // NEW

    function pointInsideBedBounds(point, bed) { // NEW
        const bounds = cellBoundsInModel(bed); // NEW
        if (!point || !bounds) return false; // NEW
        const center = rectCenter(bounds); // NEW
        const local = rotateModelPoint(point, center, -cellRotationDeg(bed)); // NEW
        return local.x >= bounds.x - 1 && local.x <= bounds.x + bounds.width + 1 && local.y >= bounds.y - 1 && local.y <= bounds.y + bounds.height + 1; // NEW
    } // NEW

    function containingGardenBedForAssembly(moduleCell, assembly) { // NEW
        const center = rectCenter(cellBoundsInModel(assembly)); // NEW
        if (!moduleCell || !center) return null; // NEW
        let chosen = null; // NEW
        let chosenArea = Infinity; // NEW
        collectGardenBeds(moduleCell).forEach(function (bed) { // NEW
            const bounds = cellBoundsInModel(bed); // NEW
            const area = bounds ? finiteNumber(bounds.width, 0) * finiteNumber(bounds.height, 0) : 0; // NEW
            if (area > 0 && area < chosenArea && pointInsideBedBounds(center, bed)) { chosen = bed; chosenArea = area; } // NEW
        }); // NEW
        return chosen; // NEW
    } // NEW

    function syncBedAssembliesForMovedOrResizedBeds(cells) { // NEW
        const beds = (cells || []).filter(isGardenBed); // NEW
        if (!beds.length) return false; // NEW
        let changed = false; // NEW
        beds.forEach(function (bed) { // NEW
            const moduleCell = findGardenModuleAncestor(bed); // NEW
            linkedBedAssembliesForBed(moduleCell, bed).forEach(function (assembly) { // NEW
                const axes = bedAssemblyFitAxes(assembly); // NEW
                changed = syncLinkedBedAssemblyToBed(moduleCell, assembly, bed, { inTransaction: true, fitWidth: axes.fitWidth, fitHeight: axes.fitHeight }) || changed; // NEW
            }); // NEW
        }); // NEW
        return changed; // NEW
    } // NEW

    function syncMovedOrResizedBedAssemblies(cells, opts) { // NEW
        const assemblies = (cells || []).filter(isBedAssembly); // NEW
        if (!assemblies.length) return false; // NEW
        let changed = false; // NEW
        assemblies.forEach(function (assembly) { // NEW
            const moduleCell = findGardenModuleAncestor(assembly) || gardenModuleForBedAssembly(assembly); // NEW
            const targetBed = containingGardenBedForAssembly(moduleCell, assembly); // NEW
            if (!targetBed) return; // NEW
            const currentBed = bedCellForAssembly(moduleCell, assembly); // NEW
            const sameBed = currentBed && getCellId(currentBed) === getCellId(targetBed); // NEW
            if (sameBed && opts && opts.source === "cells-moved") return; // NEW
            const axes = sameBed ? bedAssemblyFitAxes(assembly) : { fitWidth: true, fitHeight: true }; // NEW
            changed = relinkBedAssemblyToBed(moduleCell, assembly, targetBed, { axes }) || changed; // NEW
        }); // NEW
        return changed; // NEW
    } // NEW

    function installBedAssemblyGeometryRefreshListeners() { // NEW
        if (graph.__trellisBedAssemblyGeometryRefreshInstalled || !graph.addListener || typeof mxEvent === "undefined") return; // NEW
        graph.__trellisBedAssemblyGeometryRefreshInstalled = true; // NEW
        function handleCells(sender, evt, source) { // NEW
            const cells = evt && evt.getProperty && evt.getProperty("cells") || []; // NEW
            if (!cells.length) return; // NEW
            if (!cells.some(function (cell) { return isGardenBed(cell) || isBedAssembly(cell); })) return; // NEW
            runIrrigationEdit("refreshBedLayout", function () { // NEW
                const changedBeds = syncBedAssembliesForMovedOrResizedBeds(cells); // NEW
                const changedAssemblies = syncMovedOrResizedBedAssemblies(cells, { source }); // NEW
                if ((changedBeds || changedAssemblies) && activeIrrigationMode) renderIrrigationMode(activeIrrigationMode); // NEW
            }); // NEW
        } // NEW
        if (mxEvent.CELLS_MOVED) graph.addListener(mxEvent.CELLS_MOVED, function (sender, evt) { handleCells(sender, evt, "cells-moved"); }); // NEW
        if (mxEvent.CELLS_RESIZED) graph.addListener(mxEvent.CELLS_RESIZED, function (sender, evt) { handleCells(sender, evt, "cells-resized"); }); // NEW
    } // NEW

    installBedAssemblyGeometryRefreshListeners(); // NEW

    function syncBedAssemblyRotation(assembly, bedCell) { // NEW
        const rotation = styleValue(bedCell && bedCell.style, "rotation"); // NEW
        return setCellStyle(assembly, setStyleValue(assembly && assembly.style, "rotation", rotation)); // NEW
    } // NEW

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
                pressureLossPsi += Hydraulics.hazenWilliamsPsiLoss({ // CHANGE
                    lengthFt: segment.lengthFt, // CHANGE
                    flowGpm, // CHANGE
                    diameterIn: segment.part.specs.innerDiameterIn, // CHANGE
                    c: finiteNumber(segment.part.specs.hazenWilliamsC, 150) // CHANGE
                }); // CHANGE
            }); // CHANGE
        } else if (pipePart && pipePart.category === "pipe_tubing") {
            pressureLossPsi += Hydraulics.hazenWilliamsPsiLoss({ // CHANGE
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

    function partCostForRequiredMeters(catalog, partId, quantityMeters) { // NEW
        const part = partById(catalog, partId); // NEW
        if (!part) return 0; // NEW
        if (unitCostAppliesToCategory(part.category)) return finiteNumber(part.unitCost, part.cost || 0) * (finiteNumber(quantityMeters, 0) / METERS_PER_FOOT); // NEW
        return finiteNumber(part.cost || part.unitCost, 0) * finiteNumber(quantityMeters, 0); // NEW
    } // NEW

    function pipeSegmentLengthForPart(moduleCell, path, partId) { // CHANGE
        const segments = Hydraulics.pipeSegmentsForPath(moduleCell, path).filter(function (segment) { return segment.pipePartId === partId; }); // CHANGE
        if (segments.length) return segments.reduce(function (sum, segment) { return sum + finiteNumber(segment.lengthFt, 0); }, 0); // CHANGE
        return Hydraulics.pathRouteLengthFeet(moduleCell, path); // CHANGE
    } // CHANGE

    function isLinearCatalogPart(part) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        return !!(p && unitCostAppliesToCategory(p.category)); // NEW
    } // NEW

    function bomDisplayLengthUnit(moduleCell) { // NEW
        return resolveModuleUnitSystem(moduleCell) === "imperial" ? "ft" : "m"; // NEW
    } // NEW

    function bomCanonicalQuantityToDisplay(quantity, part, moduleCell) { // NEW
        const q = Math.max(0, finiteNumber(quantity, 0)); // NEW
        return isLinearCatalogPart(part) && bomDisplayLengthUnit(moduleCell) === "m" ? q * METERS_PER_FOOT : q; // NEW
    } // NEW

    function bomInputQuantityToCanonical(value, part, moduleCell) { // NEW
        const q = Math.max(0, finiteNumber(value, 0)); // NEW
        return isLinearCatalogPart(part) && bomDisplayLengthUnit(moduleCell) === "m" ? q / METERS_PER_FOOT : q; // NEW
    } // NEW

    function bomCanonicalUnitLabel(part, moduleCell) { // NEW
        return isLinearCatalogPart(part) ? bomDisplayLengthUnit(moduleCell) : "ea"; // NEW
    } // NEW

    function bomDisplayUnitCost(part, moduleCell) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        if (!p) return 0; // NEW
        const base = isLinearCatalogPart(p) ? finiteNumber(p.unitCost, p.cost || 0) : finiteNumber(p.cost || p.unitCost, 0); // NEW
        return isLinearCatalogPart(p) && bomDisplayLengthUnit(moduleCell) === "m" ? base / METERS_PER_FOOT : base; // NEW
    } // NEW

    function bomInputUnitCostToCanonical(value, part, moduleCell) { // NEW
        const cost = Math.max(0, finiteNumber(value, 0)); // NEW
        return isLinearCatalogPart(part) && bomDisplayLengthUnit(moduleCell) === "m" ? cost * METERS_PER_FOOT : cost; // NEW
    } // NEW

    function formatBomNumber(value, decimals) { // NEW
        const n = finiteNumber(value, 0); // NEW
        const places = decimals == null ? (Math.abs(n) >= 10 || Math.abs(n - Math.round(n)) < 0.005 ? 1 : 2) : decimals; // NEW
        return n.toFixed(places).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1"); // NEW
    } // NEW

    function bomDisplayQuantityValue(quantity, part, moduleCell) { // NEW
        return formatBomNumber(bomCanonicalQuantityToDisplay(quantity, part, moduleCell)); // NEW
    } // NEW

    function formatBomCanonicalQuantity(quantity, part, moduleCell) { // NEW
        return bomDisplayQuantityValue(quantity, part, moduleCell) + " " + bomCanonicalUnitLabel(part, moduleCell); // NEW
    } // NEW

    function bomLineUnitCost(part, moduleCell) { // NEW
        return formatMoney(bomDisplayUnitCost(part, moduleCell)) + "/" + bomCanonicalUnitLabel(part, moduleCell); // NEW
    } // NEW

    function createBomAccumulator(catalog) { // NEW
        return { catalog, rowsByPartId: new Map() }; // NEW
    } // NEW

    function addBomRequirement(acc, partId, quantity) { // NEW
        const part = partById(acc.catalog, partId); // NEW
        if (!part) return; // NEW
        const id = part.id; // NEW
        const row = acc.rowsByPartId.get(id) || { part, partId: id, requiredQuantity: 0, useCount: 0 }; // NEW
        row.requiredQuantity += Math.max(0, finiteNumber(quantity, 0)); // NEW
        row.useCount += 1; // NEW
        acc.rowsByPartId.set(id, row); // NEW
    } // NEW

    function addBomPartEach(acc, partId) { // NEW
        addBomRequirement(acc, partId, 1); // NEW
    } // NEW

    function addBomLinearFeet(acc, partId, lengthFt) { // NEW
        addBomRequirement(acc, partId, Math.max(0, finiteNumber(lengthFt, 0))); // NEW
    } // NEW

    function addBomTemplateRequirement(acc, partId, quantityMeters) { // NEW
        const part = partById(acc.catalog, partId); // NEW
        if (!part) return; // NEW
        const qty = isLinearCatalogPart(part) ? finiteNumber(quantityMeters, 0) / METERS_PER_FOOT : finiteNumber(quantityMeters, 0); // NEW
        addBomRequirement(acc, partId, qty); // NEW
    } // NEW

    function addBomResolvedRequirement(acc, entry) { // NEW
        const part = partById(acc.catalog, entry && entry.partId); // NEW
        if (!part) return; // NEW
        const unit = String(entry && entry.unit || "each"); // NEW
        const quantity = finiteNumber(entry && entry.quantity, 0); // NEW
        const canonical = isLinearCatalogPart(part) && unit === "m" ? quantity / METERS_PER_FOOT : quantity; // NEW
        addBomRequirement(acc, entry.partId, canonical); // NEW
    } // NEW

    function pathPartStateAt(path, index) { // NEW
        return normalizePartState(path && path.partStates && path.partStates[index]); // NEW
    } // NEW

    function pathPipeStateAt(path, index) { // NEW
        return normalizePartState(path && path.pipePartStates && path.pipePartStates[index]); // NEW
    } // NEW

    function pathBedTemplateState(path) { // NEW
        return partStateForRecord(path && path.bedTemplate); // NEW
    } // NEW

    function collectPathBomUsage(moduleCell, catalog, path, acc, stateFilter) { // CHANGE
        const targetState = normalizePartState(stateFilter); // NEW
        (path.partIds || []).forEach(function (partId, index) { if (pathPartStateAt(path, index) === targetState) addBomPartEach(acc, partId); }); // CHANGE
        if (path.pipeSegments && path.pipeSegments.length) { // NEW
            (path.pipeSegments || []).forEach(function (segment, index) { if (normalizePartState(segment.partState || pathPipeStateAt(path, index)) === targetState) addBomLinearFeet(acc, segment.pipePartId, segment.lengthFt); }); // CHANGE
        } else if (path.pipePartIds && path.pipePartIds.length) { // NEW
            (path.pipePartIds || []).forEach(function (pipePartId, index) { if (pathPipeStateAt(path, index) === targetState) addBomLinearFeet(acc, pipePartId, Hydraulics.pipeSegmentLengthForPart(moduleCell, path, pipePartId)); }); // CHANGE
        } else if (path.pipePartId) { // NEW
            if (pathPipeStateAt(path, 0) === targetState) addBomLinearFeet(acc, path.pipePartId, Hydraulics.pipeSegmentLengthForPart(moduleCell, path, path.pipePartId)); // CHANGE
        } // NEW
        if (path.bedTemplate && Array.isArray(path.bedTemplate.resolvedBomParts) && path.bedTemplate.resolvedBomParts.length) { // CHANGE
            if (pathBedTemplateState(path) === targetState) path.bedTemplate.resolvedBomParts.forEach(function (entry) { addBomResolvedRequirement(acc, entry); }); // NEW
        } else if (path.bedTemplate && path.bedTemplate.templateModel === BED_TEMPLATE_MODEL_BOM && Array.isArray(path.bedTemplate.requiredParts)) { // CHANGE
            if (pathBedTemplateState(path) === targetState) path.bedTemplate.requiredParts.forEach(function (entry) { addBomTemplateRequirement(acc, entry.partId, entry.quantityMeters); }); // CHANGE
        } // NEW
        if (path.bedTemplate && !(Array.isArray(path.bedTemplate.resolvedBomParts) && path.bedTemplate.resolvedBomParts.length) && Array.isArray(path.bedTemplate.partIds)) { // CHANGE
            if (pathBedTemplateState(path) === targetState) path.bedTemplate.partIds.forEach(function (partId) { addBomPartEach(acc, partId); }); // CHANGE
        } // NEW
    } // NEW

    function isBomComponentNode(cell) { // NEW
        return isAssemblyPartCell(cell) || isBedAssembly(cell); // NEW
    } // NEW

    function uniqueCellList(cells) { // NEW
        const seen = new Set(); // NEW
        const out = []; // NEW
        (cells || []).forEach(function (cell) { // NEW
            const id = getCellId(cell); // NEW
            if (!id || seen.has(id)) return; // NEW
            seen.add(id); // NEW
            out.push(cell); // NEW
        }); // NEW
        return out; // NEW
    } // NEW

    function bomComponentNeighborCells(moduleCell, cell) { // NEW
        const neighbors = []; // NEW
        externalEdgesForCell(moduleCell, cell).forEach(function (edge) { // NEW
            const other = edge && edge.source === cell ? edge.target : edge && edge.target === cell ? edge.source : null; // NEW
            if (isBomComponentNode(other)) neighbors.push(other); // NEW
        }); // NEW
        if (isAssemblyPartCell(cell)) { // NEW
            const upstream = internalNeighborForPort(cell, "input"); // NEW
            const downstream = internalNeighborForPort(cell, "output"); // NEW
            if (isBomComponentNode(upstream)) neighbors.push(upstream); // NEW
            if (isBomComponentNode(downstream)) neighbors.push(downstream); // NEW
        } // NEW
        return uniqueCellList(neighbors); // NEW
    } // NEW

    function bomComponentEdges(moduleCell, cells) { // NEW
        const cellIds = new Set((cells || []).map(getCellId).filter(Boolean)); // NEW
        const seen = new Set(); // NEW
        const edges = []; // NEW
        collectAssemblyEdges(moduleCell).forEach(function (edge) { // NEW
            const id = getCellId(edge); // NEW
            const sourceId = getCellId(edge && edge.source); // NEW
            const targetId = getCellId(edge && edge.target); // NEW
            if (!id || seen.has(id) || !cellIds.has(sourceId) || !cellIds.has(targetId)) return; // NEW
            seen.add(id); // NEW
            edges.push(edge); // NEW
        }); // NEW
        return edges; // NEW
    } // NEW

    function componentIdForCells(cells) { // NEW
        const ids = (cells || []).map(getCellId).filter(Boolean).sort(); // NEW
        return "bom_component_" + sanitizeId(ids[0] || "empty") + "_" + ids.length; // NEW
    } // NEW

    function deriveBomComponents(moduleCell) { // NEW
        const nodes = collectDescendants(moduleCell, isBomComponentNode); // NEW
        const seen = new Set(); // NEW
        const components = []; // NEW
        nodes.forEach(function (seed) { // NEW
            const seedId = getCellId(seed); // NEW
            if (!seedId || seen.has(seedId)) return; // NEW
            const stack = [seed]; // NEW
            const cells = []; // NEW
            while (stack.length) { // NEW
                const cell = stack.pop(); // NEW
                const id = getCellId(cell); // NEW
                if (!id || seen.has(id)) continue; // NEW
                seen.add(id); // NEW
                cells.push(cell); // NEW
                bomComponentNeighborCells(moduleCell, cell).forEach(function (neighbor) { // NEW
                    const neighborId = getCellId(neighbor); // NEW
                    if (neighborId && !seen.has(neighborId)) stack.push(neighbor); // NEW
                }); // NEW
            } // NEW
            const edges = bomComponentEdges(moduleCell, cells); // NEW
            const sources = cells.filter(function (cell) { return endpointType(cell) === "source"; }); // NEW
            const bedAssemblies = cells.filter(isBedAssembly); // NEW
            const pipeEdges = edges.filter(function (edge) { return getCellAttr(edge, ATTRS.PIPE_EDGE, "") === "1"; }); // NEW
            const directEdges = edges.filter(function (edge) { return getCellAttr(edge, ATTRS.DIRECT_LINK_EDGE, "") === "1"; }); // NEW
            const disconnectedFromSource = sources.length === 0; // NEW
            components.push({ // NEW
                id: componentIdForCells(cells), // NEW
                cells, // NEW
                cellIds: cells.map(getCellId).filter(Boolean), // NEW
                sourceEndpointIds: sources.map(getCellId).filter(Boolean), // NEW
                bedAssemblyIds: bedAssemblies.map(getCellId).filter(Boolean), // NEW
                edgeIds: edges.map(getCellId).filter(Boolean), // NEW
                pipeEdgeIds: pipeEdges.map(getCellId).filter(Boolean), // NEW
                directEdgeIds: directEdges.map(getCellId).filter(Boolean), // NEW
                pipeSegments: pipeEdges.map(function (edge) { return { edgeId: getCellId(edge) || "", pipePartId: getCellAttr(edge, ATTRS.PIPE_PART_ID, ""), partState: partStateForCell(edge), lengthFt: measuredEdgeLengthFeet(edge) }; }).filter(function (segment) { return !!segment.pipePartId; }), // NEW
                disconnectedFromSource, // NEW
                warnings: disconnectedFromSource ? [DISCONNECTED_SOURCE_WARNING] : [] // NEW
            }); // NEW
        }); // NEW
        return components; // NEW
    } // NEW

    function collectComponentBomUsage(moduleCell, catalog, component, acc, stateFilter) { // NEW
        const targetState = normalizePartState(stateFilter); // NEW
        (component && component.cells || []).forEach(function (cell) { // NEW
            const partId = getCellAttr(cell, ATTRS.CATALOG_PART_ID, ""); // NEW
            if (partId && partStateForCell(cell) === targetState) addBomPartEach(acc, partId); // NEW
            if (!isBedAssembly(cell)) return; // NEW
            const template = readBedAssemblyTemplateRecord(moduleCell, cell); // NEW
            if (!template || pathBedTemplateState({ bedTemplate: template }) !== targetState) return; // NEW
            if (Array.isArray(template.resolvedBomParts) && template.resolvedBomParts.length) template.resolvedBomParts.forEach(function (entry) { addBomResolvedRequirement(acc, entry); }); // CHANGE
            else { if (template.templateModel === BED_TEMPLATE_MODEL_BOM && Array.isArray(template.requiredParts)) template.requiredParts.forEach(function (entry) { addBomTemplateRequirement(acc, entry.partId, entry.quantityMeters); }); if (Array.isArray(template.partIds)) template.partIds.forEach(function (templatePartId) { addBomPartEach(acc, templatePartId); }); } // CHANGE
        }); // NEW
        (component && component.pipeSegments || []).forEach(function (segment) { // NEW
            if (normalizePartState(segment.partState) === targetState) addBomLinearFeet(acc, segment.pipePartId, segment.lengthFt); // NEW
        }); // NEW
    } // NEW

    function finalizeBomRows(moduleCell, catalog, rows) { // NEW
        return rows.map(function (row) { // NEW
            const part = normalizeCatalogPart(row.part); // NEW
            const unitCost = isLinearCatalogPart(part) ? finiteNumber(part.unitCost, part.cost || 0) : finiteNumber(part.cost || part.unitCost, 0); // NEW
            const requiredQuantity = Math.max(0, finiteNumber(row.requiredQuantity, 0)); // NEW
            const onHandQuantity = Math.max(0, finiteNumber(part.stockQuantity, 0)); // NEW
            const shortageQuantity = Math.max(0, requiredQuantity - onHandQuantity); // NEW
            return Object.assign({}, row, { // NEW
                part, // NEW
                requiredQuantity, // NEW
                onHandQuantity, // NEW
                shortageQuantity, // NEW
                unitCost, // NEW
                totalCost: requiredQuantity * unitCost, // NEW
                purchaseCost: shortageQuantity * unitCost, // NEW
                stockState: stockStateForQuantity(onHandQuantity), // NEW
                displayUnit: bomCanonicalUnitLabel(part, moduleCell) // NEW
            }); // NEW
        }).filter(function (row) { return row.requiredQuantity > 0; }).sort(compareBomRows); // NEW
    } // NEW

    function compareBomRows(a, b) { // NEW
        const ka = catalogPartSortKey(a.part); // NEW
        const kb = catalogPartSortKey(b.part); // NEW
        return ka.category.localeCompare(kb.category) || compareNominalSize(ka.size, kb.size) || ka.name.localeCompare(kb.name); // NEW
    } // NEW

    function buildBomRows(moduleCell, options) { // NEW
        const catalog = options && options.catalog ? options.catalog : IrrigationCatalog.read(moduleCell); // NEW
        const components = options && options.components ? options.components : (options && options.paths ? [] : deriveBomComponents(moduleCell)); // NEW
        const paths = components.length ? [] : (options && options.paths ? options.paths : ReportModel.deriveAssemblyPaths(moduleCell)); // CHANGE
        const acc = createBomAccumulator(catalog); // NEW
        const completedAcc = createBomAccumulator(catalog); // NEW
        if (components.length) components.forEach(function (component) { collectComponentBomUsage(moduleCell, catalog, component, acc, PART_STATE_PLANNED); collectComponentBomUsage(moduleCell, catalog, component, completedAcc, PART_STATE_COMPLETED); }); // NEW
        else paths.forEach(function (path) { collectPathBomUsage(moduleCell, catalog, path, acc, PART_STATE_PLANNED); collectPathBomUsage(moduleCell, catalog, path, completedAcc, PART_STATE_COMPLETED); }); // CHANGE
        let rows = finalizeBomRows(moduleCell, catalog, Array.from(acc.rowsByPartId.values())); // NEW
        let completedRows = finalizeBomRows(moduleCell, catalog, Array.from(completedAcc.rowsByPartId.values())); // NEW
        const selectedPartIds = uniqueStrings(options && options.selectedPartIds || []); // NEW
        if (selectedPartIds.length) { // NEW
            const selected = new Set(selectedPartIds); // NEW
            rows = rows.filter(function (row) { return selected.has(row.partId); }); // NEW
            completedRows = completedRows.filter(function (row) { return selected.has(row.partId); }); // NEW
        } // NEW
        const disconnectedComponents = components.filter(function (component) { return component.disconnectedFromSource; }); // NEW
        return { version: PLUGIN_VERSION, rows, completedRows, catalog, paths, components, selectedPartIds, disconnectedTreeCount: disconnectedComponents.length, disconnectedTreeWarnings: disconnectedComponents.map(function (component) { return { componentId: component.id, warning: DISCONNECTED_SOURCE_WARNING }; }) }; // CHANGE
    } // NEW

    function collectGardenBeds(moduleCell) {
        return collectDescendants(moduleCell, isGardenBed);
    }

    function bedAreaM2(bed) {
        const geo = getGeometry(bed);
        if (!geo) return 0;
        return unitsToAreaM2(Number(geo.width) || 0, Number(geo.height) || 0);
    }

    function createReportUsage() { // NEW
        return { partIds: [], partCosts: [], controlledZones: new Set() }; // NEW
    } // NEW

    function addReportPartUsage(usage, partId, cost, quantityMeters) { // CHANGE
        if (!partId) return; // NEW
        usage.partIds.push(partId); // NEW
        const entry = { partId, cost: finiteNumber(cost, 0) }; // NEW
        if (quantityMeters != null) entry.quantityMeters = finiteNumber(quantityMeters, 0); // NEW
        usage.partCosts.push(entry); // CHANGE
    } // NEW

    function resolvedBomPartCost(catalog, entry) { // NEW
        const part = partById(catalog, entry && entry.partId); // NEW
        if (!part) return 0; // NEW
        const quantity = finiteNumber(entry && entry.quantity, 0); // NEW
        if (isLinearCatalogPart(part) && String(entry && entry.unit || "") === "m") return finiteNumber(part.unitCost, part.cost || 0) * (quantity / METERS_PER_FOOT); // NEW
        return finiteNumber(part.cost || part.unitCost, 0) * quantity; // NEW
    } // NEW

    function collectPathReportUsage(moduleCell, catalog, path, usage) { // NEW
        (path.partIds || []).forEach(function (partId, index) { // NEW
            addReportPartUsage(usage, partId, Hydraulics.partCostForReport(moduleCell, catalog, path, partId)); // CHANGE
            const part = partById(catalog, partId); // NEW
            if (part && BRANCH_CATEGORIES.has(part.category)) usage.controlledZones.add((path.componentCellIds && path.componentCellIds[index]) || part.id); // NEW
        }); // NEW
        (path.branchpointIds || []).forEach(function (branchId) { // NEW
            const branch = GraphStore.findById(moduleCell, branchId); // NEW
            const part = partById(catalog, GraphStore.getAttr(branch, ATTRS.CATALOG_PART_ID, "")); // NEW
            if (part && BRANCH_CATEGORIES.has(part.category)) usage.controlledZones.add(branchId); // NEW
        }); // NEW
        if (path.pipeSegments && path.pipeSegments.length) { // NEW
            (path.pipeSegments || []).forEach(function (segment) { // NEW
                const pipePart = partById(catalog, segment.pipePartId); // NEW
                addReportPartUsage(usage, segment.pipePartId, finiteNumber(pipePart && pipePart.unitCost, pipePart && pipePart.cost || 0) * finiteNumber(segment.lengthFt, 0)); // NEW
            }); // NEW
        } else if (path.pipePartIds && path.pipePartIds.length) { // NEW
            (path.pipePartIds || []).forEach(function (pipePartId) { addReportPartUsage(usage, pipePartId, Hydraulics.partCostForReport(moduleCell, catalog, path, pipePartId)); }); // CHANGE
        } else if (path.pipePartId) { // NEW
            addReportPartUsage(usage, path.pipePartId, Hydraulics.partCostForReport(moduleCell, catalog, path, path.pipePartId)); // CHANGE
        } // NEW
        if (path.bedTemplate && Array.isArray(path.bedTemplate.resolvedBomParts) && path.bedTemplate.resolvedBomParts.length) { // CHANGE
            path.bedTemplate.resolvedBomParts.forEach(function (entry) { addReportPartUsage(usage, entry.partId, resolvedBomPartCost(catalog, entry), entry.unit === "m" ? entry.quantity : null); }); // NEW
        } else if (path.bedTemplate && path.bedTemplate.templateModel === BED_TEMPLATE_MODEL_BOM && Array.isArray(path.bedTemplate.requiredParts)) { // CHANGE
            path.bedTemplate.requiredParts.forEach(function (entry) { addReportPartUsage(usage, entry.partId, partCostForRequiredMeters(catalog, entry.partId, entry.quantityMeters), entry.quantityMeters); }); // NEW
        } // NEW
        if (path.bedTemplate && !(Array.isArray(path.bedTemplate.resolvedBomParts) && path.bedTemplate.resolvedBomParts.length) && Array.isArray(path.bedTemplate.partIds)) { // CHANGE
            path.bedTemplate.partIds.forEach(function (partId) { addReportPartUsage(usage, partId, Hydraulics.partCostForReport(moduleCell, catalog, path, partId)); }); // CHANGE
        } // NEW
    } // NEW

    function collectComponentReportUsage(moduleCell, catalog, component, usage) { // NEW
        (component && component.cells || []).forEach(function (cell) { // NEW
            const partId = getCellAttr(cell, ATTRS.CATALOG_PART_ID, ""); // NEW
            const part = partById(catalog, partId); // NEW
            if (partId) addReportPartUsage(usage, partId, finiteNumber(part && part.cost || part && part.unitCost, 0)); // NEW
            if (part && BRANCH_CATEGORIES.has(part.category)) usage.controlledZones.add(getCellId(cell) || part.id); // NEW
            if (!isBedAssembly(cell)) return; // NEW
            const template = readBedAssemblyTemplateRecord(moduleCell, cell); // NEW
            if (template && Array.isArray(template.resolvedBomParts) && template.resolvedBomParts.length) template.resolvedBomParts.forEach(function (entry) { addReportPartUsage(usage, entry.partId, resolvedBomPartCost(catalog, entry), entry.unit === "m" ? entry.quantity : null); }); // CHANGE
            else { if (template && template.templateModel === BED_TEMPLATE_MODEL_BOM && Array.isArray(template.requiredParts)) template.requiredParts.forEach(function (entry) { addReportPartUsage(usage, entry.partId, partCostForRequiredMeters(catalog, entry.partId, entry.quantityMeters), entry.quantityMeters); }); if (template && Array.isArray(template.partIds)) template.partIds.forEach(function (templatePartId) { addReportPartUsage(usage, templatePartId, Hydraulics.partCostForReport(moduleCell, catalog, { pipePartId: templatePartId }, templatePartId)); }); } // CHANGE
        }); // NEW
        (component && component.pipeSegments || []).forEach(function (segment) { // NEW
            const pipePart = partById(catalog, segment.pipePartId); // NEW
            addReportPartUsage(usage, segment.pipePartId, finiteNumber(pipePart && pipePart.unitCost, pipePart && pipePart.cost || 0) * finiteNumber(segment.lengthFt, 0)); // NEW
        }); // NEW
    } // NEW

    function generateReport(moduleCell) {
        if (activeIrrigationEditDepth === 0) return runIrrigationEdit("generateReport", function () { return generateReport(moduleCell); }); // NEW
        return persistReportSummary(moduleCell, buildReportSummary(moduleCell)); // CHANGE
    }

    function buildReportSummary(moduleCell, options) { // NEW
        const catalog = options && options.catalog ? options.catalog : IrrigationCatalog.read(moduleCell); // CHANGE
        const paths = options && options.paths ? options.paths : ReportModel.deriveAssemblyPaths(moduleCell); // CHANGE
        const components = options && options.components ? options.components : deriveBomComponents(moduleCell); // NEW
        const beds = options && options.beds ? options.beds : collectGardenBeds(moduleCell); // NEW
        const totalBedAreaM2 = beds.reduce(function (sum, bed) { return sum + bedAreaM2(bed); }, 0);
        const irrigatedBedIds = new Set();
        const completeBedIds = new Set();
        const usage = createReportUsage(); // CHANGE
        const criticalWarnings = [];
        let worstHydraulicMarginPsi = null;

        if (components.length) components.forEach(function (component) { // NEW
            collectComponentReportUsage(moduleCell, catalog, component, usage); // NEW
            if (component.disconnectedFromSource) criticalWarnings.push(DISCONNECTED_SOURCE_WARNING); // NEW
        }); // NEW
        paths.forEach(function (path) {
            if (!components.length) collectPathReportUsage(moduleCell, catalog, path, usage); // CHANGE
            if (path.bedTemplateCommitted && path.targetBedId) {
                irrigatedBedIds.add(path.targetBedId);
                const blockers = pathBlockingErrors(path, catalog).concat(Hydraulics.validateSharedCapacity(moduleCell, path)); // CHANGE
                if (!blockers.length) completeBedIds.add(path.targetBedId);
                blockers.forEach(function (warning) { if (!(components.length && path.disconnectedFromSource && warning === DISCONNECTED_SOURCE_WARNING)) criticalWarnings.push(warning); }); // CHANGE
            }
            if (path.hydraulic && Number.isFinite(Number(path.hydraulic.marginPsi))) {
                const margin = Number(path.hydraulic.marginPsi);
                worstHydraulicMarginPsi = worstHydraulicMarginPsi == null ? margin : Math.min(worstHydraulicMarginPsi, margin);
            }
        });

        const irrigatedAreaM2 = beds
            .filter(function (bed) { return irrigatedBedIds.has(getCellId(bed)); })
            .reduce(function (sum, bed) { return sum + bedAreaM2(bed); }, 0);
        const bom = buildBomRows(moduleCell, components.length ? { catalog, components } : { catalog, paths }); // CHANGE
        const bomRows = bom.rows; // NEW
        const completedBomRows = bom.completedRows || []; // NEW
        const purchaseRows = bomRows.filter(function (row) { return row.shortageQuantity > 0; }); // NEW
        const purchaseNeededCost = purchaseRows.reduce(function (sum, row) { return sum + finiteNumber(row.purchaseCost, 0); }, 0); // CHANGE
        const plannedDesignValue = bomRows.reduce(function (sum, row) { return sum + finiteNumber(row.totalCost, 0); }, 0); // NEW
        const completedDesignValue = completedBomRows.reduce(function (sum, row) { return sum + finiteNumber(row.totalCost, 0); }, 0); // NEW
        const totalDesignValue = plannedDesignValue + completedDesignValue; // CHANGE
        const zones = ZoneModel.read(moduleCell); // CHANGE
        const zoneReport = ZoneModel.summary(moduleCell, zones, paths); // CHANGE
        const zoneWarningCount = zoneReport.zones.reduce(function (sum, zone) { return sum + (zone.warnings || []).length; }, 0) + zoneReport.unzonedBedCount + zoneReport.ambiguousBedIds.length; // NEW
        const disconnectedComponents = components.filter(function (component) { return component.disconnectedFromSource; }); // NEW
        const summary = {
            version: PLUGIN_VERSION,
            percentIrrigated: totalBedAreaM2 > 0 ? (irrigatedAreaM2 / totalBedAreaM2) * 100 : 0,
            purchaseNeededCost,
            totalDesignValue,
            plannedDesignValue, // NEW
            completedDesignValue, // NEW
            completedPartCount: completedBomRows.length, // NEW
            completedParts: completedBomRows.map(function (row) { return { partId: row.partId, requiredQuantity: row.requiredQuantity, totalCost: row.totalCost, displayUnit: row.displayUnit }; }), // NEW
            zoneCount: zoneReport.zoneCount || usage.controlledZones.size, // CHANGE
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
            purchaseNeededCount: purchaseRows.length, // CHANGE
            disconnectedTreeCount: disconnectedComponents.length, // NEW
            disconnectedTreeWarnings: disconnectedComponents.map(function (component) { return { componentId: component.id, warning: DISCONNECTED_SOURCE_WARNING }; }), // NEW
            criticalWarningCount: criticalWarnings.length, // CHANGE
            criticalWarnings // CHANGE
        };

        return summary;
    } // NEW

    function persistReportSummary(moduleCell, summary) { // NEW
        GraphStore.writeJsonAttr(moduleCell, ATTRS.REPORT_JSON, { version: PLUGIN_VERSION, summary }); // NEW
        GraphStore.writeJsonAttr(moduleCell, ATTRS.DASHBOARD_JSON, summary); // NEW
        return summary; // NEW
    } // NEW

    function pathBlockingErrors(path, catalog) {
        const errors = [];
        (path && path.routeWarnings || []).forEach(function (warning) { errors.push(warning); }); // NEW
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
        return GraphStore.readJsonAttr(moduleCell, ATTRS.DASHBOARD_JSON, null); // CHANGE
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
        const parsed = GraphStore.readJsonAttr(moduleCell, ATTRS.ZONES_JSON, null); // CHANGE
        const zones = parsed && Array.isArray(parsed.zones) ? parsed.zones : (Array.isArray(parsed) ? parsed : []); // NEW
        return zones.map(normalizeZone).filter(function (zone) { return !!zone.id; }); // NEW
    } // CHANGE

    function writeZones(moduleCell, zones) { // NEW
        return writeZoneOverrides(moduleCell, zones); // CHANGE
    } // NEW

    function writeZoneOverrides(moduleCell, zones) { // CHANGE
        if (activeIrrigationEditDepth === 0) return runIrrigationEdit("writeZoneOverrides", function () { return writeZoneOverrides(moduleCell, zones); }); // NEW
        const normalized = (zones || []).map(persistedZoneOverrideRecord).filter(function (zone) { return zoneHasPersistedZoneIntent(zone); }); // CHANGE
        GraphStore.writeJsonAttr(moduleCell, ATTRS.ZONES_JSON, { version: PLUGIN_VERSION, zones: normalized }); // CHANGE
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
        if (activeIrrigationEditDepth === 0) return runIrrigationEdit("assignBedsToZone", function () { return assignBedsToZone(moduleCell, zoneId, bedAssemblyIds); }); // NEW
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
        if (activeIrrigationEditDepth === 0) return runIrrigationEdit("resetBedZoneOverrides", function () { return resetBedZoneOverrides(moduleCell, bedAssemblyIds); }); // NEW
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
        if (activeIrrigationEditDepth === 0) return runIrrigationEdit("createManualZone", function () { return createManualZone(moduleCell, alias, bedAssemblyIds); }); // NEW
        const zones = deriveZones(moduleCell); // CHANGE
        const zone = normalizeZone({ id: manualZoneId(alias || "manual_zone"), originType: ZONE_ORIGIN_MANUAL, alias: alias || "Manual Zone", pinnedBedIds: uniqueStrings(bedAssemblyIds) }); // NEW
        zones.push(zone); // NEW
        writeZoneOverrides(moduleCell, zones); // CHANGE
        if (bedAssemblyIds && bedAssemblyIds.length) assignBedsToZone(moduleCell, zone.id, bedAssemblyIds); // NEW
        return zone; // NEW
    } // NEW

    function updateZoneAlias(moduleCell, zoneId, alias) { // NEW
        if (activeIrrigationEditDepth === 0) return runIrrigationEdit("updateZoneAlias", function () { return updateZoneAlias(moduleCell, zoneId, alias); }); // NEW
        const zones = deriveZones(moduleCell).map(function (zone) { // CHANGE
            const next = normalizeZone(zone); // NEW
            if (next.id === zoneId) next.alias = String(alias || "").trim(); // NEW
            return next; // NEW
        }); // NEW
        return writeZoneOverrides(moduleCell, zones); // CHANGE
    } // NEW

    function resetZoneOverrides(moduleCell, zoneId) { // NEW
        if (activeIrrigationEditDepth === 0) return runIrrigationEdit("resetZoneOverrides", function () { return resetZoneOverrides(moduleCell, zoneId); }); // NEW
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

    function openBomDialog(moduleCell, options) { // NEW
        seedStarterCatalogIfEmpty(moduleCell); // NEW
        const catalog = readCatalog(moduleCell); // NEW
        const selectedPartIds = validSelectedScopePartIds(catalog, { selectedPartIds: options && options.selectedPartIds || [] }); // NEW
        const state = { // NEW
            selectedScopeActive: selectedPartIds.length > 0, // NEW
            selectedPartIds, // NEW
            search: "", // NEW
            statusFilter: "", // NEW
            broadCategoryFilter: "", // NEW
            categoryFilter: "", // NEW
            sizeFilter: "", // NEW
            rowDrafts: {}, // NEW
            allowClose: false, // NEW
            restoreHideDialog: null // NEW
        }; // NEW
        const div = document.createElement("div"); // NEW
        div.className = "trellis-irrigation-bom-dialog"; // NEW
        div.style.cssText = "width:960px;max-width:96vw;max-height:84vh;overflow:auto;font:12px Arial,sans-serif;padding:12px;box-sizing:border-box;"; // NEW
        showDialog(div, 980, 640); // NEW
        installBomDialogCloseGuard(state); // NEW
        renderBomDialog(div, moduleCell, state); // NEW
    } // NEW

    function renderBomDialog(container, moduleCell, state) { // NEW
        const catalog = readCatalog(moduleCell); // NEW
        const selectedScopePartIds = validSelectedScopePartIds(catalog, state); // NEW
        if (state.selectedScopeActive && selectedScopePartIds.length === 0) state.selectedScopeActive = false; // NEW
        const bom = ReportModel.buildBomRows(moduleCell, { catalog, selectedPartIds: state.selectedScopeActive ? selectedScopePartIds : [] }); // NEW
        const visibleRows = bomVisibleRows(bom.rows, state, moduleCell); // NEW
        const visibleCompletedRows = bomVisibleRows(bom.completedRows || [], state, moduleCell); // NEW
        const totals = bomTotals(visibleRows); // NEW
        const completedTotals = bomTotals(visibleCompletedRows); // NEW
        const filterOptions = catalogFilterOptions({ items: bom.rows.concat(bom.completedRows || []).map(function (row) { return row.part; }) }); // CHANGE
        container.innerHTML = ""; // NEW

        const titleRow = document.createElement("div"); // NEW
        titleRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 10px;"; // NEW
        const title = document.createElement("h2"); // NEW
        title.textContent = "Irrigation BOM"; // NEW
        title.style.cssText = "font-size:16px;margin:0;"; // NEW
        const totalText = document.createElement("div"); // NEW
        totalText.style.cssText = "font-weight:700;color:#1f2937;"; // NEW
        totalText.textContent = "Planned " + formatMoney(totals.totalCost) + " | Purchase " + formatMoney(totals.purchaseCost) + " | Completed " + formatMoney(completedTotals.totalCost); // CHANGE
        titleRow.appendChild(title); // NEW
        titleRow.appendChild(totalText); // NEW
        container.appendChild(titleRow); // NEW

        if (state.selectedScopeActive) { // NEW
            const selectedScopeNotice = document.createElement("div"); // NEW
            selectedScopeNotice.className = "trellis-irrigation-selected-bom-scope"; // NEW
            selectedScopeNotice.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 10px;padding:7px 8px;border:1px solid #b6c7e6;background:#eef5ff;color:#1f3b64;"; // NEW
            const label = document.createElement("span"); // NEW
            label.textContent = "Showing BOM for " + selectedScopePartIds.length + " selected catalog part" + (selectedScopePartIds.length === 1 ? "" : "s") + "."; // NEW
            selectedScopeNotice.appendChild(label); // NEW
            selectedScopeNotice.appendChild(button("Show All", function () { state.selectedScopeActive = false; state.selectedPartIds = []; renderBomDialog(container, moduleCell, state); })); // NEW
            container.appendChild(selectedScopeNotice); // NEW
        } // NEW

        if (bom.disconnectedTreeCount > 0) { // NEW
            const disconnectedNotice = document.createElement("div"); // NEW
            disconnectedNotice.className = "trellis-irrigation-disconnected-bom-notice"; // NEW
            disconnectedNotice.style.cssText = "margin:0 0 10px;padding:7px 8px;border:1px solid #f2c94c;background:#fff8db;color:#6b4e00;"; // NEW
            disconnectedNotice.textContent = bom.disconnectedTreeCount + " irrigation tree" + (bom.disconnectedTreeCount === 1 ? " is" : "s are") + " disconnected from a source. Connected parts are included in this BOM, but source and hydraulic checks are incomplete."; // NEW
            container.appendChild(disconnectedNotice); // NEW
        } // NEW

        const filterRow = document.createElement("div"); // NEW
        filterRow.style.cssText = "display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap;"; // NEW
        const search = document.createElement("input"); // NEW
        search.type = "search"; // NEW
        search.placeholder = "Search BOM"; // NEW
        search.value = state.search || ""; // NEW
        search.style.cssText = "min-width:160px;padding:4px;border:1px solid #aaa;border-radius:4px;"; // NEW
        search.addEventListener("input", function () { state.search = search.value; renderBomDialog(container, moduleCell, state); }); // NEW
        filterRow.appendChild(search); // NEW
        const statusFilter = document.createElement("select"); // NEW
        appendSelectOption(statusFilter, "", "All stock"); // NEW
        appendSelectOption(statusFilter, "in_stock", "In stock"); // NEW
        appendSelectOption(statusFilter, "shortage", "Needs purchase"); // NEW
        statusFilter.value = state.statusFilter || ""; // NEW
        statusFilter.addEventListener("change", function () { state.statusFilter = statusFilter.value; renderBomDialog(container, moduleCell, state); }); // NEW
        filterRow.appendChild(statusFilter); // NEW
        const broadFilter = document.createElement("select"); // NEW
        appendSelectOption(broadFilter, "", "All broad categories"); // NEW
        filterOptions.broadCategories.forEach(function (entry) { appendSelectOption(broadFilter, entry.id, entry.label); }); // NEW
        broadFilter.value = state.broadCategoryFilter || ""; // NEW
        broadFilter.addEventListener("change", function () { state.broadCategoryFilter = broadFilter.value; renderBomDialog(container, moduleCell, state); }); // NEW
        filterRow.appendChild(broadFilter); // NEW
        const categoryFilter = document.createElement("select"); // NEW
        appendSelectOption(categoryFilter, "", "All categories"); // NEW
        PART_CATEGORIES.forEach(function (category) { appendSelectOption(categoryFilter, category, category.replace(/_/g, " ")); }); // NEW
        categoryFilter.value = state.categoryFilter || ""; // NEW
        categoryFilter.addEventListener("change", function () { state.categoryFilter = categoryFilter.value; renderBomDialog(container, moduleCell, state); }); // NEW
        filterRow.appendChild(categoryFilter); // NEW
        const sizeFilter = document.createElement("select"); // NEW
        appendSelectOption(sizeFilter, "", "All sizes"); // NEW
        filterOptions.sizes.forEach(function (size) { appendSelectOption(sizeFilter, size, size); }); // NEW
        sizeFilter.value = state.sizeFilter || ""; // NEW
        sizeFilter.addEventListener("change", function () { state.sizeFilter = sizeFilter.value; renderBomDialog(container, moduleCell, state); }); // NEW
        filterRow.appendChild(sizeFilter); // NEW
        container.appendChild(filterRow); // NEW

        const tableWrap = document.createElement("div"); // NEW
        tableWrap.style.cssText = "overflow:auto;border:1px solid #d1d5db;"; // NEW
        const table = document.createElement("table"); // NEW
        table.style.cssText = "width:100%;border-collapse:collapse;min-width:980px;"; // NEW
        table.innerHTML = "<thead><tr><th>Part</th><th>Category</th><th>Size</th><th>Stock</th><th>Required</th><th>On hand</th><th>Shortage</th><th>Unit cost</th><th>Total planned</th><th>Purchase</th><th>Actions</th></tr></thead>"; // CHANGE
        const tbody = document.createElement("tbody"); // NEW
        let lastGroup = ""; // NEW
        visibleRows.forEach(function (row) { // NEW
            const group = catalogGroupLabel(row.part); // NEW
            if (group !== lastGroup) { // NEW
                lastGroup = group; // NEW
                const groupRow = document.createElement("tr"); // NEW
                groupRow.className = "trellis-irrigation-bom-group"; // NEW
                groupRow.innerHTML = "<td colspan=\"11\">" + html(group) + "</td>"; // NEW
                groupRow.children[0].style.cssText = "border-bottom:1px solid #d1d5db;padding:6px;background:#eef2f7;font-weight:700;color:#1f2937;"; // NEW
                tbody.appendChild(groupRow); // NEW
            } // NEW
            tbody.appendChild(renderBomRow(container, moduleCell, state, row)); // NEW
        }); // NEW
        if (!visibleRows.length) { // NEW
            const emptyRow = document.createElement("tr"); // NEW
            emptyRow.innerHTML = "<td colspan=\"11\">No planned BOM rows match the current scope and filters.</td>"; // CHANGE
            emptyRow.children[0].style.cssText = "padding:10px;color:#6b7280;font-style:italic;"; // NEW
            tbody.appendChild(emptyRow); // NEW
        } // NEW
        table.appendChild(tbody); // NEW
        tableWrap.appendChild(table); // NEW
        container.appendChild(tableWrap); // NEW

        if (visibleCompletedRows.length) { // NEW
            const completedTitle = document.createElement("h3"); // NEW
            completedTitle.textContent = "Completed Parts"; // NEW
            completedTitle.style.cssText = "font-size:13px;margin:12px 0 6px;color:#1f2937;"; // NEW
            container.appendChild(completedTitle); // NEW
            container.appendChild(renderCompletedBomTable(moduleCell, visibleCompletedRows)); // NEW
        } // NEW

        const controls = document.createElement("div"); // NEW
        controls.style.cssText = "display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;justify-content:flex-end;"; // NEW
        controls.appendChild(button("Export CSV", function () { downloadBomCsv(moduleCell, visibleRows, state); })); // NEW
        controls.appendChild(button("Close", function () { closeBomDialog(state); })); // NEW
        container.appendChild(controls); // NEW
    } // NEW

    function renderBomRow(container, moduleCell, state, row) { // NEW
        const draft = state.rowDrafts[row.partId] || bomDraftFromRow(row, moduleCell); // NEW
        const tr = document.createElement("tr"); // NEW
        tr.className = "trellis-irrigation-bom-row"; // NEW
        const onHand = bomCellInput(draft.stockQuantity); // NEW
        const unitCost = bomCellInput(draft.unitCost); // NEW
        const save = button("Save", function () { saveBomRowDraft(container, moduleCell, state, row, onHand.value, unitCost.value); }); // NEW
        const undo = button("Undo", function () { delete state.rowDrafts[row.partId]; renderBomDialog(container, moduleCell, state); }); // NEW
        const dirty = !!state.rowDrafts[row.partId]; // NEW
        save.style.display = dirty ? "" : "none"; // NEW
        undo.style.display = dirty ? "" : "none"; // NEW
        function markDirty() { // NEW
            state.rowDrafts[row.partId] = { stockQuantity: onHand.value, unitCost: unitCost.value }; // NEW
            save.style.display = ""; // NEW
            undo.style.display = ""; // NEW
        } // NEW
        onHand.addEventListener("input", markDirty); // NEW
        unitCost.addEventListener("input", markDirty); // NEW
        appendBomCell(tr, row.part.name || row.partId); // NEW
        appendBomCell(tr, row.part.category); // NEW
        appendBomCell(tr, catalogPartSizeLabel(row.part)); // NEW
        appendBomCell(tr, row.stockState); // NEW
        appendBomCell(tr, formatBomCanonicalQuantity(row.requiredQuantity, row.part, moduleCell)); // NEW
        appendBomInputCell(tr, onHand); // NEW
        appendBomCell(tr, formatBomCanonicalQuantity(row.shortageQuantity, row.part, moduleCell)); // NEW
        appendBomInputCell(tr, unitCost, "/" + bomCanonicalUnitLabel(row.part, moduleCell)); // NEW
        appendBomCell(tr, formatMoney(row.totalCost)); // NEW
        appendBomCell(tr, formatMoney(row.purchaseCost)); // NEW
        const actions = document.createElement("td"); // NEW
        actions.style.cssText = "border-bottom:1px solid #e5e7eb;padding:5px;vertical-align:top;display:flex;gap:5px;"; // NEW
        actions.appendChild(save); // NEW
        actions.appendChild(undo); // NEW
        tr.appendChild(actions); // NEW
        return tr; // NEW
    } // NEW

    function renderCompletedBomTable(moduleCell, rows) { // NEW
        const tableWrap = document.createElement("div"); // NEW
        tableWrap.style.cssText = "overflow:auto;border:1px solid #c8e6c9;"; // NEW
        const table = document.createElement("table"); // NEW
        table.style.cssText = "width:100%;border-collapse:collapse;min-width:620px;"; // NEW
        table.innerHTML = "<thead><tr><th>Part</th><th>Category</th><th>Size</th><th>Completed</th><th>Unit cost</th><th>Installed value</th></tr></thead>"; // NEW
        const tbody = document.createElement("tbody"); // NEW
        (rows || []).forEach(function (row) { // NEW
            const tr = document.createElement("tr"); // NEW
            appendBomCell(tr, row.part.name || row.partId); // NEW
            appendBomCell(tr, row.part.category); // NEW
            appendBomCell(tr, catalogPartSizeLabel(row.part)); // NEW
            appendBomCell(tr, formatBomCanonicalQuantity(row.requiredQuantity, row.part, moduleCell)); // NEW
            appendBomCell(tr, bomLineUnitCost(row.part, moduleCell)); // NEW
            appendBomCell(tr, formatMoney(row.totalCost)); // NEW
            tbody.appendChild(tr); // NEW
        }); // NEW
        table.appendChild(tbody); // NEW
        tableWrap.appendChild(table); // NEW
        return tableWrap; // NEW
    } // NEW

    function bomCellInput(value) { // NEW
        const input = document.createElement("input"); // NEW
        input.type = "number"; // NEW
        input.min = "0"; // NEW
        input.step = "0.01"; // NEW
        input.value = value == null ? "" : String(value); // NEW
        input.style.cssText = "width:86px;box-sizing:border-box;padding:3px;border:1px solid #aaa;border-radius:4px;"; // NEW
        return input; // NEW
    } // NEW

    function appendBomCell(row, text) { // NEW
        const td = document.createElement("td"); // NEW
        td.textContent = text == null ? "" : String(text); // NEW
        td.style.cssText = "border-bottom:1px solid #e5e7eb;padding:5px;vertical-align:top;"; // NEW
        row.appendChild(td); // NEW
        return td; // NEW
    } // NEW

    function appendBomInputCell(row, input, suffix) { // NEW
        const td = appendBomCell(row, ""); // NEW
        td.appendChild(input); // NEW
        if (suffix) td.appendChild(document.createTextNode(" " + suffix)); // NEW
        return td; // NEW
    } // NEW

    function bomDraftFromRow(row, moduleCell) { // NEW
        return { // NEW
            stockQuantity: bomDisplayQuantityValue(row.onHandQuantity, row.part, moduleCell), // NEW
            unitCost: formatBomNumber(bomDisplayUnitCost(row.part, moduleCell), 2) // NEW
        }; // NEW
    } // NEW

    function saveBomRowDraft(container, moduleCell, state, row, stockQuantityValue, unitCostValue) { // NEW
        const quantity = bomInputQuantityToCanonical(stockQuantityValue, row.part, moduleCell); // NEW
        const next = Object.assign({}, row.part, { // NEW
            stockQuantity: quantity, // NEW
            stockState: stockStateForQuantity(quantity) // NEW
        }); // NEW
        if (isLinearCatalogPart(next)) next.unitCost = bomInputUnitCostToCanonical(unitCostValue, next, moduleCell); // NEW
        else next.cost = Math.max(0, finiteNumber(unitCostValue, 0)); // NEW
        runIrrigationEdit("saveBomRow", function () { // NEW
            upsertCatalogPart(moduleCell, next); // NEW
            ReportModel.syncDashboardState(moduleCell); // NEW
        }); // NEW
        delete state.rowDrafts[row.partId]; // NEW
        renderBomDialog(container, moduleCell, state); // NEW
        if (activeIrrigationMode && activeIrrigationMode.moduleCell === moduleCell) renderIrrigationMode(activeIrrigationMode); // NEW
    } // NEW

    function bomVisibleRows(rows, state, moduleCell) { // NEW
        return (rows || []).filter(function (row) { return bomRowMatchesFilters(row, state, moduleCell); }); // NEW
    } // NEW

    function bomRowMatchesFilters(row, state) { // NEW
        const part = row.part; // NEW
        const search = String(state.search || "").trim().toLowerCase(); // NEW
        if (search && (String(part.name || "").toLowerCase().indexOf(search) < 0 && String(part.id || "").toLowerCase().indexOf(search) < 0 && String(part.category || "").toLowerCase().indexOf(search) < 0)) return false; // NEW
        if (state.statusFilter === "in_stock" && row.onHandQuantity <= 0) return false; // NEW
        if (state.statusFilter === "shortage" && row.shortageQuantity <= 0) return false; // NEW
        if (state.categoryFilter && part.category !== state.categoryFilter) return false; // NEW
        if (state.broadCategoryFilter && broadCategoryForCatalogCategory(part.category).id !== state.broadCategoryFilter) return false; // NEW
        if (state.sizeFilter && catalogPartSizes(part).indexOf(state.sizeFilter) < 0) return false; // NEW
        return true; // NEW
    } // NEW

    function bomTotals(rows) { // NEW
        return (rows || []).reduce(function (totals, row) { // NEW
            totals.totalCost += finiteNumber(row.totalCost, 0); // NEW
            totals.purchaseCost += finiteNumber(row.purchaseCost, 0); // NEW
            return totals; // NEW
        }, { totalCost: 0, purchaseCost: 0 }); // NEW
    } // NEW

    function bomHasUnsavedDrafts(state) { // NEW
        return !!(state && state.rowDrafts && Object.keys(state.rowDrafts).length); // NEW
    } // NEW

    function closeBomDialog(state) { // NEW
        if (bomHasUnsavedDrafts(state) && typeof confirm === "function" && !confirm("Discard unsaved BOM edits?")) return; // NEW
        if (state) state.allowClose = true; // NEW
        hideDialog(); // NEW
    } // NEW

    function installBomDialogCloseGuard(state) { // NEW
        if (!ui || !ui.hideDialog || ui.__trellisBomHideGuard) return; // NEW
        const original = ui.hideDialog; // NEW
        ui.__trellisBomHideGuard = true; // NEW
        state.restoreHideDialog = function () { ui.hideDialog = original; ui.__trellisBomHideGuard = false; }; // NEW
        ui.hideDialog = function () { // NEW
            if (!state.allowClose && bomHasUnsavedDrafts(state) && typeof confirm === "function" && !confirm("Discard unsaved BOM edits?")) return; // NEW
            if (state.restoreHideDialog) state.restoreHideDialog(); // NEW
            return original.apply(ui, arguments); // NEW
        }; // NEW
    } // NEW

    function csvEscape(value) { // NEW
        const str = String(value == null ? "" : value); // NEW
        const escaped = str.replace(/"/g, "\"\""); // NEW
        return /[",\n\r]/.test(str) ? "\"" + escaped + "\"" : escaped; // NEW
    } // NEW

    function buildBomCsv(moduleCell, rows) { // NEW
        const csvRows = []; // NEW
        function push(values) { csvRows.push(values.map(csvEscape).join(",")); } // NEW
        push(["Part", "Category", "Size", "Stock", "Required", "On hand", "Shortage", "Unit cost", "Total required", "Purchase"]); // NEW
        (rows || []).forEach(function (row) { // NEW
            push([ // NEW
                row.part.name || row.partId, // NEW
                row.part.category, // NEW
                catalogPartSizeLabel(row.part), // NEW
                row.stockState, // NEW
                formatBomCanonicalQuantity(row.requiredQuantity, row.part, moduleCell), // NEW
                formatBomCanonicalQuantity(row.onHandQuantity, row.part, moduleCell), // NEW
                formatBomCanonicalQuantity(row.shortageQuantity, row.part, moduleCell), // NEW
                bomLineUnitCost(row.part, moduleCell), // NEW
                formatMoney(row.totalCost), // NEW
                formatMoney(row.purchaseCost) // NEW
            ]); // NEW
        }); // NEW
        return csvRows.join("\n"); // NEW
    } // NEW

    function downloadBomCsv(moduleCell, rows, state) { // NEW
        const name = sanitizeId(getCellAttr(moduleCell, "label", "") || getCellId(moduleCell) || "garden"); // NEW
        const suffix = state && state.selectedScopeActive ? "selected" : "all"; // NEW
        downloadCsv(name + "_irrigation_bom_" + suffix + ".csv", buildBomCsv(moduleCell, rows)); // NEW
    } // NEW

    function downloadCsv(filename, csvText) { // NEW
        if (typeof Blob === "undefined" || typeof URL === "undefined" || !document || !document.createElement) return; // NEW
        const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" }); // NEW
        const url = URL.createObjectURL(blob); // NEW
        const a = document.createElement("a"); // NEW
        a.href = url; // NEW
        a.download = filename; // NEW
        if (document.body) document.body.appendChild(a); // NEW
        if (a.click) a.click(); // NEW
        if (a.remove) a.remove(); // NEW
        URL.revokeObjectURL(url); // NEW
    } // NEW

    function openCatalogManager(moduleCell) {
        seedStarterCatalogIfEmpty(moduleCell);
        const catalog = readCatalog(moduleCell); // NEW
        const selectedPartIds = selectedCatalogPartIdsFromGraphSelection(moduleCell, catalog); // NEW
        const state = { selectedId: selectedPartIds[0] || "", selectedScopeActive: selectedPartIds.length > 0, selectedPartIds }; // CHANGE
        const div = document.createElement("div");
        div.className = "trellis-irrigation-catalog-manager";
        div.style.cssText = "width:900px;max-width:96vw;max-height:84vh;overflow:auto;font:12px Arial,sans-serif;padding:12px;";
        showDialog(div, 920, 620);
        renderCatalogManager(div, moduleCell, state);
    }

    function selectedCatalogPartIdsFromGraphSelection(moduleCell, catalog) { // NEW
        const cells = graph.getSelectionCells ? graph.getSelectionCells() : (graph.getSelectionCell ? [graph.getSelectionCell()].filter(Boolean) : []); // NEW
        const seen = new Set(); // NEW
        const ids = []; // NEW
        (cells || []).forEach(function (cell) { // NEW
            selectedCatalogPartIdsForSelection(moduleCell, cell).forEach(function (partId) { // CHANGE
                if (!partId || seen.has(partId) || !partById(catalog, partId)) return; // NEW
                seen.add(partId); // NEW
                ids.push(partId); // NEW
            }); // CHANGE
        }); // NEW
        return ids; // NEW
    } // NEW

    function selectedCatalogPartIdsForSelection(moduleCell, cell) { // CHANGE
        if (!cell || (cell !== moduleCell && findGardenModuleAncestor(cell) !== moduleCell)) return []; // NEW
        if (isAssembly(cell) && assemblyType(cell) === "bed") return bedAssemblyCatalogPartIds(moduleCell, cell); // NEW
        if (isAssembly(cell)) return assemblyPartCells(cell).map(function (partCell) { return getCellAttr(partCell, ATTRS.CATALOG_PART_ID, ""); }).filter(Boolean); // CHANGE
        if (getCellAttr(cell, ATTRS.PIPE_EDGE, "") === "1") return [getCellAttr(cell, ATTRS.PIPE_PART_ID, "")].filter(Boolean); // NEW
        if (getCellAttr(cell, ATTRS.CATALOG_PART_ID, "")) return [getCellAttr(cell, ATTRS.CATALOG_PART_ID, "")]; // CHANGE
        return []; // NEW
    } // CHANGE

    function bedAssemblyCatalogPartIds(moduleCell, assembly) { // NEW
        const template = readBedAssemblyTemplateRecord(moduleCell, assembly); // CHANGE
        if (!template) return []; // NEW
        const ids = []; // NEW
        pushCatalogPartId(ids, template.inletPartId); // NEW
        pushCatalogPartId(ids, template.outletPartId); // NEW
        pushCatalogPartId(ids, template.rowPartId); // NEW
        pushCatalogPartId(ids, template.emitterPartId); // NEW
        pushCatalogPartId(ids, template.rowTakeoffPartId); // NEW
        pushCatalogPartId(ids, template.rowEndCapPartId); // NEW
        pushCatalogPartId(ids, template.headerEndCapPartId); // NEW
        pushCatalogPartId(ids, template.supplyPipePartId); // NEW
        (Array.isArray(template.partIds) ? template.partIds : []).forEach(function (partId) { pushCatalogPartId(ids, partId); }); // NEW
        (Array.isArray(template.resolvedBomParts) ? template.resolvedBomParts : []).forEach(function (entry) { pushCatalogPartId(ids, entry && entry.partId); }); // NEW
        (Array.isArray(template.requiredParts) ? template.requiredParts : []).forEach(function (entry) { pushCatalogPartId(ids, entry && entry.partId); }); // NEW
        pushCatalogPartId(ids, template.anchorPartId); // NEW
        pushCatalogPartId(ids, template.pipePartId); // NEW
        return ids; // NEW
    } // NEW

    function pushCatalogPartId(ids, partId) { // NEW
        const value = String(partId || "").trim(); // NEW
        if (value) ids.push(value); // NEW
    } // NEW

    function validSelectedScopePartIds(catalog, state) { // NEW
        const seen = new Set(); // NEW
        const ids = []; // NEW
        (state.selectedPartIds || []).forEach(function (partId) { // NEW
            if (!partId || seen.has(partId) || !partById(catalog, partId)) return; // NEW
            seen.add(partId); // NEW
            ids.push(partId); // NEW
        }); // NEW
        return ids; // NEW
    } // NEW

    function renderCatalogManager(container, moduleCell, state) {
        const catalog = readCatalog(moduleCell);
        if (!state.partDrafts) state.partDrafts = {}; // CHANGE
        if (!state.categoryFilter) state.categoryFilter = ""; // NEW
        if (!state.broadCategoryFilter) state.broadCategoryFilter = ""; // NEW
        if (!state.sizeFilter) state.sizeFilter = ""; // NEW
        if (!state.connectionFilter) state.connectionFilter = ""; // NEW
        if (!state.connectorTypeFilter) state.connectorTypeFilter = ""; // NEW
        const selectedScopePartIds = validSelectedScopePartIds(catalog, state); // NEW
        if (state.selectedScopeActive && selectedScopePartIds.length === 0) state.selectedScopeActive = false; // NEW
        const scopedItems = state.selectedScopeActive ? selectedScopePartIds.map(function (partId) { return partById(catalog, partId); }).filter(Boolean) : (catalog.items || []); // NEW
        const filterOptions = catalogFilterOptions(catalog); // NEW
        const visibleItems = sortCatalogParts(scopedItems.filter(function (part) { return catalogPartMatchesFilters(part, state); })); // CHANGE
        let catalogSelected = partById(catalog, state.selectedId); // CHANGE
        if (state.selectedScopeActive && (!catalogSelected || selectedScopePartIds.indexOf(catalogSelected.id) < 0)) catalogSelected = visibleItems[0] || partById(catalog, selectedScopePartIds[0]); // NEW
        else if (!catalogSelected) catalogSelected = visibleItems[0] || catalog.items[0] || makeBlankPart(catalog); // CHANGE
        const selected = normalizeCatalogPart(state.partDrafts[catalogSelected.id] || catalogSelected); // CHANGE
        state.selectedId = selected.id;
        container.innerHTML = "";

        const title = document.createElement("h2");
        title.textContent = "Irrigation Catalog";
        title.style.cssText = "font-size:16px;margin:0 0 10px;";
        container.appendChild(title);

        if (state.selectedScopeActive) { // NEW
            const selectedScopeNotice = document.createElement("div"); // NEW
            selectedScopeNotice.className = "trellis-irrigation-selected-catalog-scope"; // NEW
            selectedScopeNotice.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 10px;padding:7px 8px;border:1px solid #b6c7e6;background:#eef5ff;color:#1f3b64;"; // NEW
            const label = document.createElement("span"); // NEW
            label.textContent = "Showing " + selectedScopePartIds.length + " selected catalogue part" + (selectedScopePartIds.length === 1 ? "" : "s") + "."; // NEW
            selectedScopeNotice.appendChild(label); // NEW
            const showAllBtn = button("Show All", function () { state.selectedScopeActive = false; state.selectedPartIds = []; renderCatalogManager(container, moduleCell, state); }); // NEW
            showAllBtn.className = "trellis-irrigation-catalog-show-all"; // NEW
            selectedScopeNotice.appendChild(showAllBtn); // NEW
            container.appendChild(selectedScopeNotice); // NEW
        } // NEW

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
        table.innerHTML = "<thead><tr><th>Name</th><th>Broad</th><th>Category</th><th>Size</th><th>Connections</th><th>Stock</th><th>On hand</th><th>Status</th></tr></thead>"; // CHANGE
        const tbody = document.createElement("tbody");
        let lastCatalogGroup = ""; // NEW
        visibleItems.forEach(function (part) { // CHANGE
            const group = catalogGroupLabel(part); // NEW
            if (group !== lastCatalogGroup) { // NEW
                lastCatalogGroup = group; // NEW
                const groupRow = document.createElement("tr"); // NEW
                groupRow.className = "trellis-irrigation-catalog-group"; // NEW
                groupRow.innerHTML = "<td colspan=\"8\">" + html(group) + "</td>"; // CHANGE
                groupRow.children[0].style.cssText = "border:1px solid #bbb;padding:5px 6px;background:#eef2f7;font-weight:700;color:#1f2937;"; // NEW
                tbody.appendChild(groupRow); // NEW
            } // NEW
            const validation = validateCatalogPart(part);
            const tr = document.createElement("tr");
            tr.style.cursor = "pointer";
            tr.dataset.partId = part.id;
            if (part.id === state.selectedId) tr.style.background = "#e8f1ff";
            tr.innerHTML = "<td>" + html(part.name || part.id) + "</td><td>" + html(catalogBroadCategoryLabel(part)) + "</td><td>" + html(part.category) + "</td><td>" + html(catalogPartSizeLabel(part)) + "</td><td>" + html(catalogConnectionLabel(part)) + "</td><td>" + html(stockStateForQuantity(part.stockQuantity)) + "</td><td>" + html(formatBomCanonicalQuantity(part.stockQuantity, part, moduleCell)) + "</td><td>" + html(validation.ok ? "Ready" : "Needs data") + "</td>"; // CHANGE
            Array.from(tr.children).forEach(function (td) { td.style.cssText = "border:1px solid #ccc;padding:4px;vertical-align:top;"; });
            tr.addEventListener("click", function () {
                state.selectedId = part.id;
                delete state.partDrafts[part.id]; // CHANGE
                renderCatalogManager(container, moduleCell, state);
            });
            tbody.appendChild(tr);
        });
        if (visibleItems.length === 0) { // NEW
            const emptyRow = document.createElement("tr"); // NEW
            emptyRow.className = "trellis-irrigation-catalog-empty"; // NEW
            emptyRow.innerHTML = "<td colspan=\"8\">No catalogue parts match the current filters.</td>"; // CHANGE
            emptyRow.children[0].style.cssText = "border:1px solid #ccc;padding:8px;color:#6b7280;font-style:italic;"; // NEW
            tbody.appendChild(emptyRow); // NEW
        } // NEW
        table.appendChild(tbody);
        tableWrap.appendChild(table);
        const addBtn = button("Add Part", function () {
            const next = makeBlankPart(catalog);
            upsertCatalogPart(moduleCell, next);
            state.selectedScopeActive = false; // NEW
            state.selectedPartIds = []; // NEW
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
            stockQuantity: 0, // NEW
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

    function catalogPipeSize(part) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        return p && p.connectors && ((p.connectors.input && p.connectors.input.nominalSize) || (p.connectors.output && p.connectors.output.nominalSize)) || "3/4"; // NEW
    } // NEW

    function pipeVisualNominalSize(part) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        return p && p.connectors && ((p.connectors.input && p.connectors.input.nominalSize) || (p.connectors.output && p.connectors.output.nominalSize)) || ""; // NEW
    } // NEW

    function pipeEdgeDisplayLabelForPart(moduleCell, pipePartId, sourceConnector, targetConnector) { // NEW
        const pipe = partById(readCatalog(moduleCell), pipePartId || ""); // NEW
        const pipeSize = pipeVisualNominalSize(pipe); // NEW
        if (pipeSize) return pipeSize; // NEW
        const sourceSize = normalizeConnectorRecord(sourceConnector).nominalSize; // NEW
        const targetSize = normalizeConnectorRecord(targetConnector).nominalSize; // NEW
        return sourceSize && sourceSize === targetSize ? sourceSize : (sourceSize || targetSize || "size?"); // NEW
    } // NEW

    function pipeEdgeDisplayLabel(moduleCell, edge, sourceConnector, targetConnector) { // NEW
        return pipeEdgeDisplayLabelForPart(moduleCell, getCellAttr(edge, ATTRS.PIPE_PART_ID, ""), sourceConnector, targetConnector); // NEW
    } // NEW

    function connectionEdgeDisplayLabel(moduleCell, edge, sourceConnector, targetConnector) { // NEW
        if (getCellAttr(edge, ATTRS.PIPE_EDGE, "") === "1") return pipeEdgeDisplayLabel(moduleCell, edge, sourceConnector, targetConnector); // NEW
        return connectionDisplayLabel(sourceConnector, targetConnector); // NEW
    } // NEW

    function connectionEdgeDisplayLabelForDecision(moduleCell, decision) { // NEW
        const sourceConnector = ConnectorRules.portConnectorForCell(moduleCell, decision && decision.sourceCell, "output"); // NEW
        const targetConnector = ConnectorRules.portConnectorForCell(moduleCell, decision && decision.targetCell, "input"); // NEW
        if (decision && decision.mode === "pipe") return pipeEdgeDisplayLabelForPart(moduleCell, decision.pipePartId || "", sourceConnector, targetConnector); // NEW
        return connectionDisplayLabel(sourceConnector, targetConnector); // NEW
    } // NEW

    function syncConnectionEdgeDisplayLabel(moduleCell, edge) { // NEW
        if (!edge) return false; // NEW
        const sourceConnector = ConnectorRules.portConnectorForCell(moduleCell, edge.source, "output"); // NEW
        const targetConnector = ConnectorRules.portConnectorForCell(moduleCell, edge.target, "input"); // NEW
        return setCellAttrs(edge, { label: connectionEdgeDisplayLabel(moduleCell, edge, sourceConnector, targetConnector) }); // NEW
    } // NEW

    function pipeEdgeStyleForPart(moduleCell, pipePartId, baseStyle) { // NEW
        const pipe = partById(readCatalog(moduleCell), pipePartId); // NEW
        const strokeWidth = pipeEdgeStrokeWidthForSize(pipeVisualNominalSize(pipe)); // NEW
        return strokeWidth ? setStyleValue(baseStyle || PIPE_EDGE_BASE_STYLE, "strokeWidth", strokeWidth) : (baseStyle || PIPE_EDGE_BASE_STYLE); // NEW
    } // NEW

    function applyPipeEdgeStyle(edge, moduleCell, pipePartId, baseStyle) { // NEW
        return applyPipeEdgeLifecycleStyle(edge, moduleCell, baseStyle || PIPE_EDGE_BASE_STYLE); // CHANGE
    } // NEW

    function applyDirectLinkEdgeStyle(edge) { // NEW
        return setCellStyle(edge, DIRECT_LINK_EDGE_STYLE); // NEW
    } // NEW

    function buildCatalogPartForm(part, moduleCell, onCategoryChange) { // CHANGE
        const node = document.createElement("div");
        node.className = "trellis-irrigation-catalog-form";
        node.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px;";
        const fields = {};
        fields.moduleCell = moduleCell; // NEW
        const connectorOptions = catalogConnectorOptions(moduleCell); // NEW
        fields.id = { value: part.id }; // CHANGE
        fields.name = addTextField(node, "Name", part.name);
        fields.category = addSelectField(node, "Category", PART_CATEGORIES, part.category);
        fields.category.addEventListener("change", function () { if (onCategoryChange) onCategoryChange(readCatalogPartForm({ fields })); }); // CHANGE
        fields.stockState = addSelectField(node, "Stock", VALID_STOCK_STATES, stockStateForQuantity(part.stockQuantity)); // CHANGE
        fields.stockState.disabled = true; // NEW
        fields.stockQuantity = addTextField(node, "Quantity on hand", bomDisplayQuantityValue(part.stockQuantity, part, moduleCell)); // NEW
        fields.cost = addTextField(node, "Cost", part.cost);
        if (unitCostAppliesToCategory(part.category)) fields.unitCost = addTextField(node, "Unit cost per ft", part.unitCost); // CHANGE
        if (part.category === "pipe_tubing") { // NEW
            fields.pipeSize = addSelectField(node, "Pipe size", ensureOptionValue(connectorOptions.sizes, catalogPipeSize(part)), catalogPipeSize(part)); // NEW
            fields.innerDiameterIn = addTextField(node, "Pipe inner diameter in", part.specs.innerDiameterIn || ""); // CHANGE
        } else { // NEW
            fields.inputs = addTextField(node, "Inputs", part.connectors.inputs); // CHANGE
            fields.outputs = addTextField(node, "Outputs", part.connectors.outputs); // CHANGE
            fields.inputType = addSelectField(node, "Input type", ensureOptionValue(connectorOptions.types, part.connectors.input.type), part.connectors.input.type); // CHANGE
            fields.inputSize = addSelectField(node, "Input size", ensureOptionValue(connectorOptions.sizes, part.connectors.input.nominalSize), part.connectors.input.nominalSize); // CHANGE
            fields.outputType = addSelectField(node, "Output type", ensureOptionValue(connectorOptions.types, part.connectors.output.type), part.connectors.output.type); // CHANGE
            fields.outputSize = addSelectField(node, "Output size", ensureOptionValue(connectorOptions.sizes, part.connectors.output.nominalSize), part.connectors.output.nominalSize); // CHANGE
            fields.maxFlowGpm = addTextField(node, "Max flow gpm", part.connectors.output.maxFlowGpm || part.specs.maxFlowGpm || ""); // CHANGE
            fields.pressureLossPsi = addTextField(node, "Pressure loss psi", part.specs.pressureLossPsi || ""); // CHANGE
            fields.flowGpm = addTextField(node, "Part flow gpm", part.specs.flowGpm || ""); // CHANGE
            if (BED_SELF_EMITTING_ROW_CATEGORIES.has(part.category)) fields.emitterSpacingIn = addTextField(node, "Emitter spacing in", part.specs.emitterSpacingIn || ""); // NEW
            fields.minOperatingPressurePsi = addTextField(node, "Min operating psi", part.specs.minOperatingPressurePsi || ""); // CHANGE
            fields.maxOperatingPressurePsi = addTextField(node, "Max operating psi", part.specs.maxOperatingPressurePsi || ""); // CHANGE
        } // NEW
        return { node, fields };
    }

    function readCatalogPartForm(form) {
        const maxFlowGpm = form.fields.maxFlowGpm ? finiteNumber(form.fields.maxFlowGpm.value, null) : null; // CHANGE
        const category = form.fields.category.value; // CHANGE
        if (category === "pipe_tubing") { // NEW
            const pipeSize = String(form.fields.pipeSize && form.fields.pipeSize.value || form.fields.inputSize && form.fields.inputSize.value || form.fields.outputSize && form.fields.outputSize.value || "3/4").trim(); // NEW
            return normalizeCatalogPart({ // NEW
                id: sanitizeId(form.fields.id.value) || "part", // NEW
                name: form.fields.name.value.trim(), // NEW
                category, // NEW
                stockState: stockStateForQuantity(bomInputQuantityToCanonical(form.fields.stockQuantity && form.fields.stockQuantity.value, { category }, form.fields.moduleCell)), // CHANGE
                stockQuantity: bomInputQuantityToCanonical(form.fields.stockQuantity && form.fields.stockQuantity.value, { category }, form.fields.moduleCell), // NEW
                cost: finiteNumber(form.fields.cost.value, 0), // NEW
                unitCost: form.fields.unitCost ? finiteNumber(form.fields.unitCost.value, finiteNumber(form.fields.cost.value, 0)) : finiteNumber(form.fields.cost.value, 0), // NEW
                connectors: { // NEW
                    inputs: 1, // NEW
                    outputs: 1, // NEW
                    input: { type: "barb", nominalSize: pipeSize }, // CHANGE
                    output: { type: "barb", nominalSize: pipeSize, maxFlowGpm: null } // CHANGE
                }, // NEW
                specs: { innerDiameterIn: form.fields.innerDiameterIn ? finiteNumber(form.fields.innerDiameterIn.value, null) : null } // NEW
            }); // NEW
        } // NEW
        return normalizeCatalogPart({
            id: sanitizeId(form.fields.id.value) || "part",
            name: form.fields.name.value.trim(),
            category, // CHANGE
            stockState: stockStateForQuantity(bomInputQuantityToCanonical(form.fields.stockQuantity && form.fields.stockQuantity.value, { category }, form.fields.moduleCell)), // CHANGE
            stockQuantity: bomInputQuantityToCanonical(form.fields.stockQuantity && form.fields.stockQuantity.value, { category }, form.fields.moduleCell), // NEW
            cost: finiteNumber(form.fields.cost.value, 0),
            unitCost: unitCostAppliesToCategory(category) && form.fields.unitCost ? finiteNumber(form.fields.unitCost.value, finiteNumber(form.fields.cost.value, 0)) : null, // CHANGE
            connectors: {
                inputs: form.fields.inputs ? finiteNumber(form.fields.inputs.value, 1) : 1, // CHANGE
                outputs: form.fields.outputs ? finiteNumber(form.fields.outputs.value, 1) : 1, // CHANGE
                input: { type: form.fields.inputType ? form.fields.inputType.value.trim() : "barb", nominalSize: form.fields.inputSize ? form.fields.inputSize.value.trim() : (form.fields.pipeSize ? form.fields.pipeSize.value.trim() : "3/4") }, // CHANGE
                output: { type: form.fields.outputType ? form.fields.outputType.value.trim() : "barb", nominalSize: form.fields.outputSize ? form.fields.outputSize.value.trim() : (form.fields.pipeSize ? form.fields.pipeSize.value.trim() : "3/4"), maxFlowGpm } // CHANGE
            },
            specs: {
                maxFlowGpm,
                pressureLossPsi: form.fields.pressureLossPsi ? finiteNumber(form.fields.pressureLossPsi.value, null) : null, // CHANGE
                flowGpm: form.fields.flowGpm ? finiteNumber(form.fields.flowGpm.value, null) : null, // CHANGE
                emitterSpacingIn: form.fields.emitterSpacingIn ? finiteNumber(form.fields.emitterSpacingIn.value, null) : null, // NEW
                minOperatingPressurePsi: form.fields.minOperatingPressurePsi ? finiteNumber(form.fields.minOperatingPressurePsi.value, null) : null, // CHANGE
                maxOperatingPressurePsi: form.fields.maxOperatingPressurePsi ? finiteNumber(form.fields.maxOperatingPressurePsi.value, null) : null, // CHANGE
                innerDiameterIn: null // CHANGE
            }
        });
    }

    function addTextField(parent, label, value) {
        const wrap = document.createElement("label");
        wrap.style.cssText = "display:flex;flex-direction:column;gap:3px;min-width:0;max-width:100%;box-sizing:border-box;overflow:hidden;"; // CHANGE
        wrap.textContent = label;
        const input = document.createElement("input");
        input.value = value == null ? "" : String(value);
        input.style.cssText = "width:100%;min-width:0;max-width:100%;box-sizing:border-box;overflow:hidden;padding:4px;border:1px solid #aaa;border-radius:4px;"; // CHANGE
        wrap.appendChild(input);
        parent.appendChild(wrap);
        return input;
    }

    function addNumericField(parent, label, value, options) { // NEW
        const input = addTextField(parent, label, value); // NEW
        input.type = "number"; // NEW
        input.min = String(options && options.min != null ? options.min : 1); // NEW
        input.step = String(options && options.step != null ? options.step : 1); // NEW
        input.inputMode = options && options.inputMode || "decimal"; // NEW
        return input; // NEW
    } // NEW

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
        wrap.style.cssText = "display:flex;flex-direction:column;gap:3px;min-width:0;max-width:100%;box-sizing:border-box;overflow:hidden;"; // CHANGE
        wrap.textContent = label;
        const select = document.createElement("select");
        values.forEach(function (entry) {
            const option = document.createElement("option");
            option.value = entry;
            option.textContent = connectorTypeLabel(entry); // CHANGE
            select.appendChild(option);
        });
        select.value = value;
        select.style.cssText = "width:100%;min-width:0;max-width:100%;box-sizing:border-box;overflow:hidden;padding:4px;border:1px solid #aaa;border-radius:4px;"; // CHANGE
        wrap.appendChild(select);
        parent.appendChild(wrap);
        return select;
    }

    function addPartSelectField(parent, label, parts, value) { // NEW
        const wrap = document.createElement("label"); // NEW
        wrap.style.cssText = "display:flex;flex-direction:column;gap:3px;min-width:0;max-width:100%;box-sizing:border-box;overflow:hidden;"; // CHANGE
        wrap.textContent = label; // NEW
        const select = document.createElement("select"); // NEW
        appendSelectOption(select, "", "Choose part"); // NEW
        (parts || []).forEach(function (part) { appendSelectOption(select, part.id, part.name || part.id); }); // NEW
        select.value = value || ""; // NEW
        select.style.cssText = "width:100%;min-width:0;max-width:100%;box-sizing:border-box;overflow:hidden;padding:4px;border:1px solid #aaa;border-radius:4px;"; // CHANGE
        wrap.appendChild(select); // NEW
        parent.appendChild(wrap); // NEW
        return select; // NEW
    } // NEW

    function setPartSelectOptions(select, parts, value) { // NEW
        select.innerHTML = ""; // NEW
        appendSelectOption(select, "", "Choose part"); // NEW
        (parts || []).forEach(function (part) { appendSelectOption(select, part.id, part.name || part.id); }); // NEW
        select.value = value || ""; // NEW
        if (select.value !== (value || "")) select.value = ""; // NEW
    } // NEW

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
            portBadgeNodeByKey: new Map(), // NEW
            connectionBadgeNodeByKey: new Map(), // NEW
            inlineActionNodes: [], // NEW
            zoneBadges: [], // NEW
            selectedPorts: [], // NEW
            selectedBoundaries: [], // NEW
            inlineActionAnchorPort: null, // NEW
            lastModelPoint: null, // NEW
            partPickerVisible: false, // NEW
            bedAssemblyPickerVisible: false, // NEW
            sourceFormVisible: !!(options && options.sourceForm), // NEW
            message: "", // NEW
            frontedBedAssemblyId: "", // NEW
            selectionLayeringGuard: false, // NEW
            listeners: [] // NEW
        }; // NEW
        installIrrigationModeListeners(activeIrrigationMode); // NEW
        const entrySelection = irrigationModeEntrySelection(activeIrrigationMode, selection, options); // NEW
        if (entrySelection) selectCell(entrySelection, false); // CHANGE
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
        dispatchIrrigationModeChanged(); // NEW
        scheduleIrrigationDebugSnapshot(activeIrrigationMode, "openIrrigationMode:post-render-async"); // NEW
        return activeIrrigationMode; // NEW
    } // NEW

    function closeIrrigationMode() { // NEW
        const session = activeIrrigationMode; // NEW
        if (!session) return; // NEW
        if (isIrrigationModeClosing(session)) return; // NEW
        closingIrrigationModeSession = session; // NEW
        session.closing = true; // NEW
        try { // NEW
            if (activeConnectionComboboxClose) activeConnectionComboboxClose(false); // NEW
            removeHudNode(session.hud); // NEW
            session.hud = null; // NEW
            removeNodeList(session.navigator); // NEW
            removeNodeList(session.targetHighlights); // NEW
            removeNodeList(session.warningBadges); // NEW
            removeNodeList(session.portBadges); // NEW
            removeNodeList(session.inlineActionNodes); // NEW
            removeNodeList(session.zoneBadges); // NEW
            removeIrrigationControlLayerChildren(); // NEW
            if (session.frontedBedAssemblyId) { reorderIrrigationModuleLayering(session.moduleCell); session.frontedBedAssemblyId = ""; } // NEW
            removeIrrigationModeListeners(session); // NEW
            activeIrrigationMode = null; // NEW
        } finally { // NEW
            closingIrrigationModeSession = null; // NEW
            session.closing = false; // NEW
        } // NEW
        scheduleInactiveEntryOverlayRefresh(); // NEW
        dispatchIrrigationModeChanged(); // NEW
    } // NEW

    function isIrrigationModeClosing(session) { // NEW
        return !!(session && (session.closing || closingIrrigationModeSession === session)); // NEW
    } // NEW

    function irrigationModeEntrySelection(session, selection, options) { // NEW
        if (options && options.selectCell && isIrrigationHudSelectionTarget(session, options.selectCell)) return options.selectCell; // NEW
        return isIrrigationHudSelectionTarget(session, selection) ? selection : session.moduleCell; // NEW
    } // NEW

    function closeWizardSessionForModeSwitch() { // NEW
        hideDialog(); // NEW
    } // NEW

    function installIrrigationModeListeners(session) { // NEW
        const selectionModel = graph.getSelectionModel && graph.getSelectionModel(); // NEW
        if (selectionModel && selectionModel.addListener && typeof mxEvent !== "undefined") { // NEW
            const listener = function () { syncSelectedBedAssemblyLayering(session); renderIrrigationMode(session); }; // CHANGE
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
        if (model.addListener && typeof mxEvent !== "undefined") { // NEW
            const replayRefreshListener = function () { renderIrrigationMode(session); }; // NEW
            [mxEvent.UNDO, mxEvent.REDO].forEach(function (eventName) { // NEW
                if (!eventName) return; // NEW
                model.addListener(eventName, replayRefreshListener); // NEW
                session.listeners.push({ target: model, event: eventName, listener: replayRefreshListener }); // NEW
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

    function getActiveIrrigationModule() { // NEW
        return activeIrrigationMode && activeIrrigationMode.moduleCell || null; // NEW
    } // NEW

    function isIrrigationModeActive(moduleCell) { // NEW
        if (!activeIrrigationMode) return false; // NEW
        return !moduleCell || activeIrrigationMode.moduleCell === moduleCell || getCellId(activeIrrigationMode.moduleCell) === getCellId(moduleCell); // NEW
    } // NEW

    function dispatchIrrigationModeChanged() { // NEW
        if (typeof window === "undefined" || !window.dispatchEvent) return; // NEW
        try { // NEW
            const detail = { active: !!activeIrrigationMode, moduleCellId: getCellId(getActiveIrrigationModule()) || "" }; // NEW
            const EventCtor = window.CustomEvent || window.Event; // NEW
            if (EventCtor) window.dispatchEvent(new EventCtor(MODE_CHANGED_EVENT, { detail })); // NEW
        } catch (_) { } // NEW
    } // NEW

    function cellBelongsToIrrigationSession(session, cell) { // NEW
        if (!session || !cell) return false; // NEW
        if (cell === session.moduleCell || getCellId(cell) === getCellId(session.moduleCell)) return true; // NEW
        return findGardenModuleAncestor(cell) === session.moduleCell || getCellId(findGardenModuleAncestor(cell)) === getCellId(session.moduleCell); // NEW
    } // NEW

    function isIrrigationHudSelectionTarget(session, cell) { // NEW
        if (!session || !cell || !cellBelongsToIrrigationSession(session, cell)) return false; // NEW
        return isGardenModule(cell) || isGardenBed(cell) || isAssemblyModeObject(cell) || isHudIrrigationObject(cell) || isHudPipeEdge(cell); // NEW
    } // NEW

    function currentSelectionIsIrrigationHudEligible(session) { // NEW
        const cells = currentSelectionCells(); // NEW
        return cells.length > 0 && cells.every(function (cell) { return isIrrigationHudSelectionTarget(session, cell); }); // NEW
    } // NEW

    function selectedAssemblyContextCells() { // NEW
        const seen = new Set(); // NEW
        const out = []; // NEW
        currentSelectionCells().forEach(function (cell) { // NEW
            if (!isAssemblyModeObject(cell) && !isLifecyclePartTargetCell(cell)) return; // CHANGE
            const id = getCellId(cell); // NEW
            if (!id || seen.has(id)) return; // NEW
            seen.add(id); // NEW
            out.push(cell); // NEW
        }); // NEW
        return out; // NEW
    } // NEW

    function reorderIrrigationModuleLayering(moduleCell) { // NEW
        const tiler = typeof window !== "undefined" && window.USL && window.USL.tiler; // NEW
        if (!tiler || typeof tiler.reorderModuleChildrenForLayering !== "function") return; // NEW
        const run = function () { tiler.reorderModuleChildrenForLayering(model, moduleCell); }; // NEW
        (graph.__withUndoSuppressed || function (fn) { return fn(); }).call(graph, run); // CHANGE
    } // NEW

    function syncSelectedBedAssemblyLayering(session) { // NEW
        if (!session || session.selectionLayeringGuard) return; // NEW
        const selected = graph.getSelectionCell && graph.getSelectionCell(); // NEW
        const selectedBedAssembly = isBedAssembly(selected) ? selected : null; // NEW
        const selectedId = getCellId(selectedBedAssembly) || ""; // NEW
        if (session.frontedBedAssemblyId === selectedId) return; // NEW
        session.selectionLayeringGuard = true; // NEW
        try { // NEW
            if (session.frontedBedAssemblyId) reorderIrrigationModuleLayering(session.moduleCell); // NEW
            session.frontedBedAssemblyId = ""; // NEW
            if (!selectedBedAssembly || !graph.orderCells) return; // NEW
            (graph.__withUndoSuppressed || function (fn) { return fn(); }).call(graph, function () { graph.orderCells(false, [selectedBedAssembly]); }); // CHANGE
            session.frontedBedAssemblyId = selectedId; // NEW
        } finally { session.selectionLayeringGuard = false; } // NEW
    } // NEW

    function shieldHudEvents(hud) { // NEW
        ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "wheel", "keydown", "keypress", "keyup", "beforeinput", "input", "compositionstart", "compositionupdate", "compositionend"].forEach(function (eventName) { // CHANGE
            hud.addEventListener(eventName, function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); }); // NEW
        }); // NEW
    } // NEW

    function renderIrrigationMode(session) { // NEW
        if (!session || activeIrrigationMode !== session || isIrrigationModeClosing(session)) return; // CHANGE
        if (activeConnectionComboboxClose) activeConnectionComboboxClose(false); // NEW
        removeHudNode(session.hud); // NEW
        removeNodeList(session.navigator); // NEW
        removeNodeList(session.targetHighlights); // NEW
        removeNodeList(session.warningBadges); // NEW
        removeNodeList(session.portBadges); // NEW
        removeNodeList(session.inlineActionNodes); // NEW
        removeNodeList(session.zoneBadges); // NEW
        session.portBadgeNodeByKey = new Map(); // NEW
        session.connectionBadgeNodeByKey = new Map(); // NEW

        const selected = graph.getSelectionCell && graph.getSelectionCell(); // NEW
        const assemblySelection = selectedAssemblyContextCells(); // NEW
        const inlineAction = resolveInlineConnectionAction(session); // CHANGE
        const hudEligible = currentSelectionIsIrrigationHudEligible(session); // NEW
        if (!hudEligible && !inlineAction) return; // CHANGE
        const connectionContext = inlineAction ? null : resolveSelectedConnectionContext(session); // CHANGE
        if (!inlineAction && hudEligible) { // CHANGE
            const hud = document.createElement("div"); // NEW
            hud.className = "trellis-irrigation-mode-hud"; // NEW
            hud.style.cssText = "position:absolute;z-index:1005;width:max-content;max-width:min(460px,calc(100vw - 32px));min-width:0;box-sizing:border-box;overflow:hidden;background:#fff;border:1px solid #777;border-radius:6px;box-shadow:0 3px 12px rgba(0,0,0,.22);padding:8px;font:12px Arial,sans-serif;color:#222;display:flex;flex-direction:column;gap:6px;pointer-events:auto;"; // CHANGE
            shieldHudEvents(hud); // NEW
            if (connectionContext) renderConnectionHud(session, hud, connectionContext); // NEW
            else if (assemblySelection.length) renderLocalIrrigationHud(session, hud, assemblySelection); // CHANGE
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
        } else session.hud = null; // NEW
        renderAssemblyPortBadges(session, assemblySelection); // CHANGE
        renderSelectedExternalPipeHighlights(session); // NEW
        renderZoneBadges(session); // NEW
        if (isHudIrrigationObject(selected)) renderIrrigationNavigator(session, selected); // NEW
        renderIrrigationWarningBadges(session); // NEW
        renderInlineConnectionAction(session, inlineAction); // NEW
    } // NEW

    function renderModuleIrrigationHud(session, hud) { // NEW
        hud.className += " trellis-irrigation-module-hud"; // NEW
        appendIrrigationHudHeader(hud, session, "Irrigation Mode", { bomPartIds: [], syncBeforeBom: true }); // CHANGE
        appendHudStatus(hud, session); // NEW
        const actions = hudActions(); // CHANGE
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
        appendHudActionSection(hud, "Connections", actions); // CHANGE
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
        appendIrrigationHudHeader(hud, session, "Garden Bed", { bomPartIds: [] }); // CHANGE
        appendHudStatus(hud, session); // NEW
        hud.appendChild(hudText("Create a bed assembly for template-driven irrigation estimates.")); // CHANGE
        const actions = hudActions(); // NEW
        actions.appendChild(button("Create Bed Assembly", function () { // CHANGE
            const created = runIrrigationEdit("createBedAssembly", function () { const result = createBedAssembly(session.moduleCell, bedCell, defaultAssemblyAnchor(session)); scheduleHudGraphStateSync(session.moduleCell); return result; }); // CHANGE
            selectCell(created.assembly, false); // CHANGE
            renderIrrigationMode(session); // NEW
        })); // NEW
        appendHudActionSection(hud, "Connections", actions); // NEW
    } // NEW

    function renderConnectionHud(session, hud, context) { // NEW
        hud.className += " trellis-irrigation-connection-hud"; // NEW
        const lifecycleSelection = context.edge && getCellAttr(context.edge, ATTRS.PIPE_EDGE, "") === "1" ? [context.edge] : []; // NEW
        appendIrrigationHudHeader(hud, session, "Connection", { selected: lifecycleSelection, bomPartIds: context.pipePartId ? [context.pipePartId] : [] }); // CHANGE
        appendHudStatus(hud, session); // NEW
        const route = hudText(connectionRouteLabel(context)); // NEW
        route.style.fontWeight = "700"; // NEW
        route.style.overflowWrap = "anywhere"; // NEW
        hud.appendChild(route); // NEW
        hud.appendChild(hudText(connectionSummaryLabel(session.moduleCell, context))); // NEW
        hud.appendChild(hudText(connectionPortsLabel(context))); // NEW
        const connectionActions = hudActions(); // NEW
        connectionActions.appendChild(button("Select Upstream", function () { selectConnectionEndpoint(session, context.sourceCell); })); // CHANGE
        connectionActions.appendChild(button("Select Downstream", function () { selectConnectionEndpoint(session, context.targetCell); })); // CHANGE
        appendHudActionSection(hud, "Connections", connectionActions); // NEW
        appendHudDangerAction(hud, "Disconnect", function () { disconnectSelectedConnections(session, [context.boundary]); }); // CHANGE
    } // NEW

    function selectConnectionEndpoint(session, cell) { // NEW
        session.selectedPorts = []; // NEW
        session.selectedBoundaries = []; // NEW
        session.inlineActionAnchorPort = null; // NEW
        session.focusedConnectionBoundary = null; // NEW
        selectCell(cell, false); // NEW
        renderIrrigationMode(session); // NEW
    } // NEW

    function connectionRouteLabel(context) { // NEW
        return irrigationCellLabel(context && context.sourceCell) + " -> " + irrigationCellLabel(context && context.targetCell); // NEW
    } // NEW

    function connectionPortsLabel(context) { // NEW
        const source = normalizePort(context && context.sourcePort); // NEW
        const target = normalizePort(context && context.targetPort); // NEW
        return "Outlet " + (source.index + 1) + " -> Inlet " + (target.index + 1); // NEW
    } // NEW

    function connectionSummaryLabel(moduleCell, context) { // NEW
        if (!context) return "Connection"; // NEW
        if (context.kind === "internal") return "Internal connection"; // NEW
        if (context.mode === "direct") return "Direct link"; // NEW
        const pipe = partById(readCatalog(moduleCell), context.pipePartId); // NEW
        const length = context.lengthFt > 0 ? ", " + formatFeet(context.lengthFt) : ""; // NEW
        return "Pipe: " + (pipe ? pipe.name : "auto pipe") + length; // NEW
    } // NEW

    function formatFeet(value) { // NEW
        const n = finiteNumber(value, 0); // NEW
        if (!(n > 0)) return ""; // NEW
        return n.toFixed(n >= 10 ? 1 : 2).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1") + " ft"; // NEW
    } // NEW

    function renderLocalIrrigationHud(session, hud, cells) { // CHANGE
        const selected = cells || []; // NEW
        const primary = selected[0]; // NEW
        const primaryAssembly = isAssembly(primary) ? primary : findAssemblyAncestor(primary); // NEW
        const primarySource = selected.length === 1 ? sourceEndpointForSelection(primary, primaryAssembly) : null; // NEW
        hud.className += " trellis-irrigation-local-hud"; // CHANGE
        const headerTitle = primarySource ? createSourceTitleInput(session, primarySource, primaryAssembly) : (selected.length > 1 ? selected.length + " irrigation selections" : irrigationCellLabel(primary)); // CHANGE
        appendIrrigationHudHeader(hud, session, headerTitle, { selected, bomPartIds: selectedCatalogPartIdsFromGraphSelection(session.moduleCell, readCatalog(session.moduleCell)) }); // CHANGE
        appendHudStatus(hud, session); // NEW
        const warning = primary && !isAssembly(primary) ? cellWarning(session.moduleCell, primary) : ""; // CHANGE
        if (warning) hud.appendChild(hudWarning(warning)); // NEW
        if (primarySource) renderSourceEditFields(session, hud, primarySource); // CHANGE
        if ((primary && endpointType(primary) === "bed") || (primaryAssembly && assemblyType(primaryAssembly) === "bed")) renderBedInletFields(session, hud, primaryAssembly || findAssemblyAncestor(primary)); // CHANGE
        renderSelectedZoneControls(session, hud, selected); // NEW
        renderSelectedConnectionRows(session, hud, selected); // NEW
        const connectionDanger = renderSelectedConnectionActions(session, hud); // CHANGE
        if (session.partPickerVisible) renderAddPartAssemblyForm(session, hud); // NEW
        const selectedParts = selectedAssemblyPartCells(selected); // NEW
        const selectedAssemblies = selected.filter(isAssembly); // NEW
        if (!appendLocalDeleteAction(session, hud, selected, selectedParts, selectedAssemblies) && connectionDanger) appendHudDangerAction(hud, connectionDanger.label, connectionDanger.fn); // CHANGE
    } // NEW

    function renderSourceForm(session, hud) { // NEW
        const form = document.createElement("div"); // NEW
        form.className = "trellis-irrigation-source-form"; // NEW
        form.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px;"; // NEW
        const label = addTextField(form, "Label", "Water Source " + (collectHudEndpoints(session.moduleCell, "source").length + 1)); // NEW
        const connectorOptions = catalogConnectorOptions(session.moduleCell); // NEW
        const type = addSelectField(form, "Connector", ensureOptionValue(connectorOptions.types, "barb"), "barb"); // CHANGE
        const size = addSelectField(form, "Size", ensureOptionValue(connectorOptions.sizes, "3/4"), "3/4"); // CHANGE
        const flow = addTextField(form, "Flow gpm", "5"); // NEW
        const pressure = addTextField(form, "Static psi", "45"); // NEW
        const commit = button("Commit Source", function () { // NEW
            const created = runIrrigationEdit("commitSource", function () { const result = createSourceAssembly(session.moduleCell, label.value.trim() || "Water Source", { // CHANGE
                connectorType: type.value.trim(), // NEW
                nominalSize: size.value.trim(), // NEW
                usableFlowGpm: finiteNumber(flow.value, 5), // NEW
                staticPressurePsi: finiteNumber(pressure.value, 45) // NEW
            }, defaultAssemblyAnchor(session)); scheduleHudGraphStateSync(session.moduleCell); return result; }); // CHANGE
            session.sourceFormVisible = false; // NEW
            selectCell(created.assembly, false); // CHANGE
            renderIrrigationMode(session); // NEW
        }); // NEW
        commit.className = "trellis-irrigation-commit-source"; // NEW
        form.appendChild(commit); // NEW
        hud.appendChild(form); // NEW
    } // NEW

    function renderAddPartAssemblyForm(session, hud) { // NEW
        const form = document.createElement("div"); // NEW
        form.className = "trellis-irrigation-add-assembly-form"; // NEW
        form.style.cssText = "display:grid;gap:6px;margin-top:8px;min-width:0;max-width:100%;box-sizing:border-box;overflow:hidden;"; // CHANGE
        const context = addPartPickerContext(session); // NEW
        form.appendChild(hudText(context ? "Compatible with " + addPartContextLabel(session.moduleCell, context) : "All catalog parts")); // NEW
        const select = document.createElement("select"); // NEW
        select.className = "trellis-irrigation-add-part-picker"; // NEW
        select.style.cssText = "width:100%;min-width:0;max-width:100%;box-sizing:border-box;overflow:hidden;"; // CHANGE
        appendGroupedPartOptions(select, addPartPickerParts(session, context)); // CHANGE
        form.appendChild(select); // NEW
        form.appendChild(button("Add Part", function () { // NEW
            const part = partById(readCatalog(session.moduleCell), select.value); // NEW
            if (!part) { session.message = "Choose a catalog part."; renderIrrigationMode(session); return; } // NEW
            const result = runIrrigationEdit("addPart", function () { const applied = context && context.row && context.row.bedPort ? applyBedPortPartChoice(session, context.row, part) : (context ? applyConnectionPartChoice(session.moduleCell, context.row, part) : null); if (context) { if (applied && applied.cell) scheduleHudGraphStateSync(session.moduleCell); return applied; } const createdPart = createPartAssembly(session.moduleCell, part, defaultAssemblyAnchor(session)); scheduleHudGraphStateSync(session.moduleCell); return { cell: createdPart.assembly, message: "" }; }); // CHANGE
            if (context && (!result || !result.cell)) { session.message = result && result.message || "Part could not be added at the selected connection."; renderIrrigationMode(session); return; } // NEW
            const created = { assembly: findAssemblyAncestor(result.cell) || result.cell }; // CHANGE
            session.partPickerVisible = false; // NEW
            selectCell(created.assembly, false); // NEW
            if (result && result.message) session.message = result.message; // NEW
            renderIrrigationMode(session); // NEW
        })); // NEW
        hud.appendChild(form); // NEW
    } // NEW

    function renderSelectedConnectionActions(session, hud) { // CHANGE
        const ports = selectedValidPorts(session); // NEW
        const selectedBoundaries = selectedOccupiedBoundaries(session, ports); // NEW
        if (!ports.length && !selectedBoundaries.length) { // CHANGE
            return null; // CHANGE
        } // NEW
        const occupied = ports.filter(function (port) { return !!boundaryForPort(session.moduleCell, port); }); // CHANGE
        const free = ports.filter(function (port) { return isPortFree(session.moduleCell, port); }); // NEW
        const actions = hudActions(); // NEW
        const disconnectDanger = selectedBoundaries.length > 1 || occupied.length > 1 ? { label: "Disconnect", fn: function () { disconnectSelectedConnections(session, selectedBoundaries); } } : null; // CHANGE
        if (free.length === 2) { // NEW
            const ordered = orderedConnectionPorts(free); // NEW
            if (ordered) { // NEW
                const bridge = ConnectorRules.bridgeSuggestionEligibility(session.moduleCell, ordered.source, ordered.target); // CHANGE
                if (bridge.ok) actions.appendChild(button("Suggest Connection", function () { session.bridgePorts = ordered; renderIrrigationMode(session); })); // CHANGE
            } // NEW
        } // NEW
        appendHudActionSection(hud, "Connections", actions); // CHANGE
        if (session.bridgePorts && free.length === 2) renderBridgeSuggestions(session, hud, session.bridgePorts); // NEW
        return disconnectDanger; // NEW
    } // NEW

    function renderSelectedConnectionRows(session, hud, selectedCells) { // NEW
        const rows = selectedConnectionRowSpecs(session.moduleCell, selectedCells); // NEW
        if (!rows.length) return; // NEW
        const section = hudSection("Connections"); // NEW
        const wrap = document.createElement("div"); // CHANGE
        wrap.className = "trellis-irrigation-connection-rows"; // NEW
        wrap.style.cssText = "display:flex;flex-direction:column;gap:5px;margin-top:4px;"; // NEW
        rows.forEach(function (row) { renderConnectionRow(session, wrap, row); }); // NEW
        section.appendChild(wrap); // NEW
        hud.appendChild(section); // CHANGE
    } // NEW

    function selectedConnectionRowSpecs(moduleCell, selectedCells) { // NEW
        if (!selectedCells || selectedCells.length !== 1) return []; // NEW
        const selected = selectedCells[0]; // NEW
        const rows = []; // NEW
        if (isAssembly(selected)) { // NEW
            if (assemblyType(selected) === "bed") return rows; // CHANGE
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
        const edge = edgesForPort(session.moduleCell, port)[0]; // NEW
        const neighbor = internalNeighborForPort(row.cell, row.role); // NEW
        if (edge || neighbor) controls.appendChild(renderConnectionStatus(session, row, edge, neighbor)); // NEW
        else controls.appendChild(renderConnectionDropdown(session, row)); // CHANGE
        const pipe = document.createElement("div"); // NEW
        pipe.className = "trellis-irrigation-pipe-row"; // NEW
        pipe.style.cssText = "font-size:11px;color:#4b5563;white-space:normal;"; // NEW
        pipe.textContent = connectionRowDetailLabel(session.moduleCell, row, edge, neighbor); // CHANGE
        controls.appendChild(pipe); // NEW
        line.appendChild(controls); // NEW
        wrap.appendChild(line); // NEW
    } // NEW

    function renderConnectionDropdown(session, row) { // NEW
        const current = connectionRowCurrentLabel(session.moduleCell, row); // NEW
        const groups = connectionDropdownGroups(session.moduleCell, row); // NEW
        const safetyGroups = connectionComboboxSafetyGroups(groups); // NEW
        const hasParts = safetyGroups.some(function (group) { return group.parts.length > 0; }); // NEW
        const root = document.createElement("div"); // NEW
        root.className = "trellis-irrigation-connection-combobox trellis-irrigation-connection-dropdown"; // CHANGE
        root.style.cssText = "position:relative;min-width:0;width:100%;max-width:100%;box-sizing:border-box;"; // NEW
        const trigger = document.createElement("button"); // NEW
        trigger.type = "button"; // NEW
        trigger.className = "trellis-irrigation-connection-combobox-trigger"; // NEW
        trigger.style.cssText = "min-width:0;width:100%;max-width:100%;padding:4px 22px 4px 6px;border:1px solid #aaa;border-radius:4px;background:#fff;color:#111827;text-align:left;box-sizing:border-box;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;position:relative;"; // NEW
        trigger.textContent = hasParts ? (current || "No change") : "No compatible parts"; // NEW
        trigger.setAttribute("aria-haspopup", "listbox"); // NEW
        trigger.setAttribute("aria-expanded", "false"); // NEW
        trigger.disabled = !hasParts; // NEW
        const chevron = document.createElement("span"); // NEW
        chevron.textContent = "v"; // NEW
        chevron.setAttribute("aria-hidden", "true"); // NEW
        chevron.style.cssText = "position:absolute;right:7px;top:50%;transform:translateY(-50%);font-size:10px;color:#4b5563;"; // NEW
        trigger.appendChild(chevron); // NEW
        root.appendChild(trigger); // NEW
        const state = { open: false, query: "", panel: null, search: null, list: null, activeIndex: -1, outsideListener: null, resizeListener: null, blurTimer: null }; // CHANGE
        function closeMenu(focusTrigger) { // NEW
            if (!state.open) return; // NEW
            state.open = false; // NEW
            trigger.setAttribute("aria-expanded", "false"); // NEW
            root.classList.remove("trellis-irrigation-connection-combobox-open"); // NEW
            if (state.panel && state.panel.parentNode) state.panel.parentNode.removeChild(state.panel); // NEW
            state.panel = state.search = state.list = null; // NEW
            if (state.outsideListener) document.removeEventListener("mousedown", state.outsideListener); // NEW
            if (state.resizeListener && typeof window !== "undefined" && window.removeEventListener) { window.removeEventListener("resize", state.resizeListener); window.removeEventListener("scroll", state.resizeListener, true); } // NEW
            state.outsideListener = null; // NEW
            state.resizeListener = null; // NEW
            if (state.blurTimer) clearTimeout(state.blurTimer); // NEW
            state.blurTimer = null; // NEW
            if (activeConnectionComboboxClose === closeMenu) activeConnectionComboboxClose = null; // NEW
            if (focusTrigger && trigger.focus) trigger.focus(); // NEW
        } // NEW
        function menuContainsNode(node) { // NEW
            return !!(node && (root.contains(node) || state.panel && state.panel.contains(node))); // NEW
        } // NEW
        function clearFocusLossClose() { // NEW
            if (state.blurTimer) clearTimeout(state.blurTimer); // NEW
            state.blurTimer = null; // NEW
        } // NEW
        function closeAfterFocusLoss() { // NEW
            clearFocusLossClose(); // CHANGE
            state.blurTimer = setTimeout(function () { if (!menuContainsNode(document.activeElement)) closeMenu(false); }, 0); // NEW
        } // NEW
        function optionButtons() { // NEW
            return state.panel ? Array.from(state.panel.querySelectorAll(".trellis-irrigation-connection-combobox-option")) : []; // NEW
        } // NEW
        function focusOption(index) { // NEW
            const options = optionButtons(); // NEW
            if (!options.length) return; // NEW
            state.activeIndex = Math.max(0, Math.min(index, options.length - 1)); // NEW
            options[state.activeIndex].focus(); // NEW
        } // NEW
        function moveOption(delta) { // NEW
            const options = optionButtons(); // NEW
            if (!options.length) return; // NEW
            const next = state.activeIndex < 0 ? (delta > 0 ? 0 : options.length - 1) : (state.activeIndex + delta + options.length) % options.length; // NEW
            focusOption(next); // NEW
        } // NEW
        function choosePart(partId) { // NEW
            closeMenu(false); // NEW
            applyConnectionDropdownSelection(session, row, partId); // NEW
        } // NEW
        function focusCategoryButton(categoryKey) { // NEW
            if (!state.list || !categoryKey) return; // NEW
            const buttons = Array.from(state.list.querySelectorAll(".trellis-irrigation-connection-combobox-category")); // NEW
            const button = buttons.find(function (node) { return node.getAttribute("data-category-key") === categoryKey; }); // NEW
            if (button && button.focus) button.focus(); // NEW
        } // NEW
        function renderList(focusCategoryKey) { // CHANGE
            if (!state.list) return; // NEW
            state.list.innerHTML = ""; // NEW
            const query = normalizeSearchText(state.query); // NEW
            let renderedParts = 0; // NEW
            safetyGroups.forEach(function (group) { // NEW
                const categories = connectionComboboxCategoryGroups(group.parts, query); // NEW
                if (!categories.length) return; // NEW
                const groupNode = document.createElement("div"); // NEW
                groupNode.className = "trellis-irrigation-connection-combobox-safety-group trellis-irrigation-connection-combobox-safety-" + group.id; // NEW
                const groupLabel = document.createElement("div"); // NEW
                groupLabel.className = "trellis-irrigation-connection-combobox-safety-label"; // NEW
                groupLabel.style.cssText = "padding:5px 7px;font-weight:700;color:" + (group.id === "disconnect" ? "#7f1d1d" : "#14532d") + ";background:" + (group.id === "disconnect" ? "#fee2e2" : "#dcfce7") + ";border-top:1px solid #e5e7eb;"; // NEW
                groupLabel.textContent = group.label; // NEW
                groupNode.appendChild(groupLabel); // NEW
                categories.forEach(function (category, categoryIndex) { // NEW
                    const categoryKey = connectionComboboxCategoryKey(group.id, category.category); // NEW
                    const collapsed = query ? false : connectionComboboxCategoryCollapsed(categoryKey, categoryIndex !== 0); // NEW
                    const categoryButton = document.createElement("button"); // NEW
                    categoryButton.type = "button"; // NEW
                    categoryButton.className = "trellis-irrigation-connection-combobox-category"; // NEW
                    categoryButton.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:6px;width:100%;padding:5px 7px;border:0;border-top:1px solid #e5e7eb;background:#f9fafb;color:#374151;font-weight:700;text-align:left;box-sizing:border-box;cursor:pointer;"; // NEW
                    categoryButton.setAttribute("data-category-key", categoryKey); // NEW
                    categoryButton.setAttribute("aria-expanded", collapsed ? "false" : "true"); // NEW
                    categoryButton.textContent = (collapsed ? "> " : "v ") + catalogCategoryLabel(category.category) + " (" + category.parts.length + ")"; // NEW
                    categoryButton.addEventListener("click", function () { // NEW
                        clearFocusLossClose(); // NEW
                        connectionComboboxSetCategoryCollapsed(categoryKey, !collapsed); // NEW
                        renderList(categoryKey); // CHANGE
                    }); // NEW
                    categoryButton.addEventListener("keydown", function (ev) { // NEW
                        if (ev.key === "ArrowDown") { ev.preventDefault(); focusOption(0); } // NEW
                        else if (ev.key === "Escape") { ev.preventDefault(); closeMenu(true); } // NEW
                    }); // NEW
                    groupNode.appendChild(categoryButton); // NEW
                    if (!collapsed) { // NEW
                        category.parts.forEach(function (part) { // NEW
                            renderedParts++; // NEW
                            const option = document.createElement("button"); // NEW
                            option.type = "button"; // NEW
                            option.className = "trellis-irrigation-connection-combobox-option"; // NEW
                            option.setAttribute("role", "option"); // NEW
                            option.setAttribute("data-part-id", part.id); // NEW
                            option.style.cssText = "display:flex;flex-direction:column;gap:1px;width:100%;padding:5px 8px 5px 18px;border:0;border-top:1px solid #f3f4f6;background:#fff;color:#111827;text-align:left;box-sizing:border-box;cursor:pointer;"; // NEW
                            const name = document.createElement("span"); // NEW
                            name.textContent = part.name || part.id; // NEW
                            const detail = document.createElement("span"); // NEW
                            detail.style.cssText = "font-size:11px;color:#6b7280;"; // NEW
                            detail.textContent = connectionComboboxPartDetail(part); // NEW
                            option.appendChild(name); // NEW
                            option.appendChild(detail); // NEW
                            option.addEventListener("click", function () { choosePart(part.id); }); // NEW
                            option.addEventListener("keydown", function (ev) { // NEW
                                if (ev.key === "ArrowDown") { ev.preventDefault(); moveOption(1); } // NEW
                                else if (ev.key === "ArrowUp") { ev.preventDefault(); moveOption(-1); } // NEW
                                else if (ev.key === "Enter") { ev.preventDefault(); choosePart(part.id); } // NEW
                                else if (ev.key === "Escape") { ev.preventDefault(); closeMenu(true); } // NEW
                            }); // NEW
                            groupNode.appendChild(option); // NEW
                        }); // NEW
                    } // NEW
                }); // NEW
                state.list.appendChild(groupNode); // NEW
            }); // NEW
            if (!renderedParts && query) { // NEW
                const empty = document.createElement("div"); // NEW
                empty.className = "trellis-irrigation-connection-combobox-empty"; // NEW
                empty.style.cssText = "padding:7px;color:#6b7280;"; // NEW
                empty.textContent = "No matching parts"; // NEW
                state.list.appendChild(empty); // NEW
            } // NEW
            state.activeIndex = -1; // NEW
            focusCategoryButton(focusCategoryKey); // NEW
        } // NEW
        function openMenu(focusSearch) { // NEW
            if (state.open || !hasParts) return; // NEW
            if (activeConnectionComboboxClose) activeConnectionComboboxClose(false); // NEW
            state.open = true; // NEW
            activeConnectionComboboxClose = closeMenu; // NEW
            trigger.setAttribute("aria-expanded", "true"); // NEW
            root.classList.add("trellis-irrigation-connection-combobox-open"); // NEW
            const panel = document.createElement("div"); // NEW
            panel.className = "trellis-irrigation-connection-combobox-panel"; // NEW
            panel.style.cssText = "position:fixed;z-index:2000;border:1px solid #9ca3af;border-radius:4px;background:#fff;box-shadow:0 6px 18px rgba(0,0,0,.25);overflow:auto;box-sizing:border-box;"; // CHANGE
            const search = document.createElement("input"); // NEW
            search.className = "trellis-irrigation-connection-combobox-search"; // NEW
            search.type = "search"; // NEW
            search.placeholder = "Search parts"; // NEW
            search.value = state.query; // NEW
            search.style.cssText = "position:sticky;top:0;z-index:1;width:100%;min-width:0;box-sizing:border-box;padding:6px 7px;border:0;border-bottom:1px solid #d1d5db;outline:none;"; // NEW
            const list = document.createElement("div"); // NEW
            list.className = "trellis-irrigation-connection-combobox-list"; // NEW
            list.setAttribute("role", "listbox"); // NEW
            panel.appendChild(search); // NEW
            panel.appendChild(list); // NEW
            connectionComboboxPanelHost().appendChild(panel); // CHANGE
            state.panel = panel; // NEW
            state.search = search; // NEW
            state.list = list; // NEW
            shieldHudEvents(panel); // NEW
            search.addEventListener("input", function () { state.query = search.value; renderList(); }); // NEW
            search.addEventListener("keydown", function (ev) { // NEW
                if (ev.key === "ArrowDown") { ev.preventDefault(); focusOption(0); } // NEW
                else if (ev.key === "ArrowUp") { ev.preventDefault(); focusOption(optionButtons().length - 1); } // NEW
                else if (ev.key === "Escape") { ev.preventDefault(); closeMenu(true); } // NEW
                else if (ev.key === "Enter") { const options = optionButtons(); if (options.length) { ev.preventDefault(); options[0].click(); } } // NEW
            }); // NEW
            panel.addEventListener("mousedown", function (ev) { if (ev.stopPropagation) ev.stopPropagation(); }); // NEW
            panel.addEventListener("focusout", closeAfterFocusLoss); // NEW
            state.outsideListener = function (ev) { if (!menuContainsNode(ev.target)) closeMenu(false); }; // CHANGE
            state.resizeListener = function () { positionConnectionComboboxPanel(root, trigger, panel); }; // NEW
            document.addEventListener("mousedown", state.outsideListener); // NEW
            if (typeof window !== "undefined" && window.addEventListener) { window.addEventListener("resize", state.resizeListener); window.addEventListener("scroll", state.resizeListener, true); } // NEW
            renderList(); // NEW
            positionConnectionComboboxPanel(root, trigger, panel); // NEW
            if (focusSearch && search.focus) search.focus(); // NEW
        } // NEW
        root.addEventListener("focusout", closeAfterFocusLoss); // NEW
        trigger.addEventListener("click", function () { state.open ? closeMenu(false) : openMenu(true); }); // NEW
        trigger.addEventListener("keydown", function (ev) { // NEW
            if (ev.key === "ArrowDown" || ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); openMenu(true); } // NEW
            else if (ev.key === "Escape") { ev.preventDefault(); closeMenu(true); } // NEW
        }); // NEW
        return root; // NEW
    } // NEW

    function renderConnectionStatus(session, row, edge, neighbor) { // NEW
        const status = document.createElement("div"); // NEW
        status.className = "trellis-irrigation-connection-status"; // NEW
        status.style.cssText = "min-width:0;width:100%;padding:3px 4px;border:1px solid #d1d5db;border-radius:4px;background:#f9fafb;color:#374151;box-sizing:border-box;overflow-wrap:anywhere;"; // NEW
        status.textContent = connectionRowCurrentLabel(session.moduleCell, row); // NEW
        status.title = edge || neighbor ? "Connected. Disconnect before changing this connection." : ""; // NEW
        return status; // NEW
    } // NEW

    function connectionRowDetailLabel(moduleCell, row, edge, neighbor) { // NEW
        if (edge) return pipeEdgeLabel(moduleCell, edge, { cellId: getCellId(row.cell), role: row.role, index: row.index }); // NEW
        if (neighbor) return "Internal connection: " + internalConnectionDisplayLabel(moduleCell, row.role === "output" ? row.cell : neighbor, row.role === "output" ? neighbor : row.cell); // CHANGE
        return pipeEdgeLabel(moduleCell, null, { cellId: getCellId(row.cell), role: row.role, index: row.index }); // NEW
    } // NEW

    function appendConnectionOptionGroup(select, label, parts) { // NEW
        if (!parts.length) return; // NEW
        const group = document.createElement("optgroup"); // NEW
        group.label = label; // NEW
        parts.forEach(function (part) { appendSelectOption(group, part.id, part.name); }); // NEW
        select.appendChild(group); // NEW
    } // NEW

    function connectionComboboxSafetyGroups(groups) { // NEW
        return [ // NEW
            { id: "keep", label: "Keeps connection", parts: sortConnectionComboboxParts(groups.keep || []) }, // NEW
            { id: "disconnect", label: "Disconnects existing connection", parts: sortConnectionComboboxParts(groups.disconnect || []) } // NEW
        ]; // NEW
    } // NEW

    function connectionComboboxPanelHost() { // NEW
        return document && document.body ? document.body : graph.container; // NEW
    } // NEW

    function positionConnectionComboboxPanel(root, trigger, panel) { // NEW
        if (!root || !trigger || !panel || !panel.parentNode) return; // NEW
        const viewportWidth = typeof window !== "undefined" && window.innerWidth || document.documentElement && document.documentElement.clientWidth || graph.container && graph.container.clientWidth || 1000; // NEW
        const viewportHeight = typeof window !== "undefined" && window.innerHeight || document.documentElement && document.documentElement.clientHeight || graph.container && graph.container.clientHeight || 700; // NEW
        const margin = 8; // NEW
        const triggerRect = trigger.getBoundingClientRect ? trigger.getBoundingClientRect() : { left: 0, right: 320, top: 0, bottom: 24, width: 320 }; // NEW
        const hud = root.closest && root.closest(".trellis-irrigation-mode-hud"); // NEW
        const hudRect = hud && hud.getBoundingClientRect ? hud.getBoundingClientRect() : null; // NEW
        const rawLeft = hudRect && hudRect.width > triggerRect.width ? hudRect.left : triggerRect.left; // NEW
        const rawWidth = Math.max(triggerRect.width || 0, hudRect && hudRect.width || 0, 360); // NEW
        const width = Math.max(180, Math.min(rawWidth, viewportWidth - margin * 2)); // NEW
        const left = Math.max(margin, Math.min(rawLeft || margin, viewportWidth - width - margin)); // NEW
        const below = viewportHeight - (triggerRect.bottom || 0) - margin; // NEW
        const above = (triggerRect.top || 0) - margin; // NEW
        const openUp = below < 180 && above > below; // NEW
        const maxHeight = Math.max(120, Math.min(320, openUp ? above : below)); // NEW
        const top = openUp ? Math.max(margin, (triggerRect.top || margin) - maxHeight - 2) : Math.min(viewportHeight - margin - 120, (triggerRect.bottom || 0) + 2); // NEW
        panel.style.left = Math.round(left) + "px"; // NEW
        panel.style.top = Math.round(Math.max(margin, top)) + "px"; // NEW
        panel.style.width = Math.round(width) + "px"; // NEW
        panel.style.maxHeight = Math.round(maxHeight) + "px"; // NEW
    } // NEW

    function connectionComboboxCategoryGroups(parts, query) { // NEW
        const grouped = new Map(); // NEW
        sortConnectionComboboxParts(parts).forEach(function (part) { // NEW
            const p = normalizeCatalogPart(part); // NEW
            if (!p || query && !connectionComboboxPartMatches(p, query)) return; // NEW
            const category = p.category || "uncategorized"; // NEW
            if (!grouped.has(category)) grouped.set(category, []); // NEW
            grouped.get(category).push(p); // NEW
        }); // NEW
        return Array.from(grouped.keys()).sort(compareCatalogCategories).map(function (category) { return { category, parts: grouped.get(category) }; }); // NEW
    } // NEW

    function sortConnectionComboboxParts(parts) { // NEW
        return (parts || []).map(normalizeCatalogPart).filter(Boolean).sort(function (a, b) { // NEW
            const ka = catalogPartSortKey(a); // NEW
            const kb = catalogPartSortKey(b); // NEW
            return compareCatalogCategories(ka.category, kb.category) || compareNominalSize(ka.size, kb.size) || ka.name.localeCompare(kb.name); // NEW
        }); // NEW
    } // NEW

    function compareCatalogCategories(a, b) { // NEW
        const indexA = PART_CATEGORIES.indexOf(a); // NEW
        const indexB = PART_CATEGORIES.indexOf(b); // NEW
        const sortA = indexA < 0 ? PART_CATEGORIES.length : indexA; // NEW
        const sortB = indexB < 0 ? PART_CATEGORIES.length : indexB; // NEW
        return (sortA - sortB) || String(a || "").localeCompare(String(b || "")); // NEW
    } // NEW

    function catalogCategoryLabel(category) { // NEW
        return String(category || "uncategorized").replace(/_/g, " "); // NEW
    } // NEW

    function normalizeSearchText(value) { // NEW
        return String(value || "").trim().toLowerCase(); // NEW
    } // NEW

    function connectionComboboxPartMatches(part, query) { // NEW
        if (!query) return true; // NEW
        return connectionComboboxPartSearchText(part).indexOf(query) >= 0; // NEW
    } // NEW

    function connectionComboboxPartSearchText(part) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        return normalizeSearchText([ // NEW
            p && p.id, // NEW
            p && p.name, // NEW
            p && p.category, // NEW
            catalogCategoryLabel(p && p.category), // NEW
            catalogPartSizeLabel(p), // NEW
            catalogPartConnectorTypeLabel(p) // NEW
        ].filter(Boolean).join(" ")); // NEW
    } // NEW

    function connectionComboboxPartDetail(part) { // NEW
        return [catalogCategoryLabel(part.category), catalogPartSizeLabel(part), catalogPartConnectorTypeLabel(part)].filter(Boolean).join(" | "); // NEW
    } // NEW

    function connectionComboboxCategoryKey(groupId, category) { // NEW
        return String(groupId || "group") + ":" + String(category || "uncategorized"); // NEW
    } // NEW

    function connectionComboboxCollapsedState() { // NEW
        const storage = connectionComboboxStorage(); // NEW
        if (!storage) return {}; // NEW
        try { // NEW
            const parsed = JSON.parse(storage.getItem(CONNECTION_COMBOBOX_COLLAPSED_STORAGE_KEY) || "{}"); // NEW
            return parsed && typeof parsed === "object" ? parsed : {}; // NEW
        } catch (_) { return {}; } // NEW
    } // NEW

    function connectionComboboxCategoryCollapsed(key, defaultCollapsed) { // NEW
        const state = connectionComboboxCollapsedState(); // NEW
        return Object.prototype.hasOwnProperty.call(state, key) ? state[key] === true : !!defaultCollapsed; // NEW
    } // NEW

    function connectionComboboxSetCategoryCollapsed(key, collapsed) { // NEW
        const storage = connectionComboboxStorage(); // NEW
        if (!storage) return; // NEW
        const state = connectionComboboxCollapsedState(); // NEW
        state[key] = collapsed === true; // NEW
        try { storage.setItem(CONNECTION_COMBOBOX_COLLAPSED_STORAGE_KEY, JSON.stringify(state)); } catch (_) {} // NEW
    } // NEW

    function connectionComboboxStorage() { // NEW
        try { // NEW
            return typeof window !== "undefined" && window.localStorage ? window.localStorage : null; // NEW
        } catch (_) { return null; } // NEW
    } // NEW

    function connectionRowCurrentLabel(moduleCell, row) { // NEW
        const port = { cellId: getCellId(row.cell), role: row.role, index: row.index }; // NEW
        const edge = edgesForPort(moduleCell, port)[0]; // NEW
        if (edge) return edgeConnectionDisplayLabel(moduleCell, edge) + " connected: " + irrigationCellLabel(row.role === "output" ? edge.target : edge.source); // CHANGE
        const neighbor = internalNeighborForPort(row.cell, row.role); // NEW
        return neighbor ? internalConnectionDisplayLabel(moduleCell, row.role === "output" ? row.cell : neighbor, row.role === "output" ? neighbor : row.cell) + " connected: " + irrigationCellLabel(neighbor) : "No change"; // CHANGE
    } // NEW

    function connectionDropdownGroups(moduleCell, row) { // NEW
        const parts = compatibleDropdownParts(moduleCell, row.cell, row.role).filter(function (part) { return partAllowedForConnectionRow(moduleCell, row, part); }); // CHANGE
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
        return ConnectorRules.connectionMode(moduleCell, ConnectorRules.portConnectorForCell(moduleCell, edge.source, "output"), normalizeCatalogPart(part).connectors.input).ok; // CHANGE
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
        const result = runIrrigationEdit("connectionDropdown", function () { const applied = applyConnectionPartChoice(session.moduleCell, row, part); scheduleHudGraphStateSync(session.moduleCell); return applied; }); // CHANGE
        session.message = result.message; // NEW
        if (result.cell) selectCell(result.cell, false); // NEW
        renderIrrigationMode(session); // NEW
    } // NEW

    function applyConnectionPartChoice(moduleCell, row, part) { // NEW
        if (!partAllowedForConnectionRow(moduleCell, row, part)) return { cell: null, message: "Assembly outlets require a pipe-capable part inlet." }; // NEW
        if (row.role === "output" && portCapacityForCell(moduleCell, row.cell, "output") > 1) return applyBranchOutletChoice(moduleCell, row, part); // NEW
        return applyLinearConnectionChoice(moduleCell, row, part); // NEW
    } // NEW

    function applyBedPortPartChoice(session, row, part) { // NEW
        const port = { cellId: getCellId(row.cell), role: row.role, index: row.index }; // NEW
        if (!isPortFree(session.moduleCell, port)) return { cell: null, message: "Selected bed port is already connected." }; // NEW
        const decision = dropdownPartConnectionDecision(session.moduleCell, row, part); // NEW
        if (!decision.ok) return { cell: null, message: decision.reason || "Part could not be connected to the selected bed port." }; // NEW
        const created = createPartAssembly(session.moduleCell, part, bedPortPartAnchor(row.cell, row.role, row.index)); // NEW
        const partCell = created && created.partCell; // NEW
        if (!partCell) return { cell: null, message: "Part could not be created." }; // NEW
        const sourceCell = row.role === "input" ? partCell : row.cell; // NEW
        const targetCell = row.role === "input" ? row.cell : partCell; // NEW
        const sourceIndex = row.role === "input" ? 0 : row.index; // NEW
        const targetIndex = row.role === "input" ? row.index : 0; // NEW
        let edge = null; // NEW
        try { edge = ConnectionChainPlanner.createEdge(session.moduleCell, sourceCell, targetCell, decision, sourceIndex, targetIndex); } // NEW
        catch (err) { edge = null; } // NEW
        if (!edge) { removeCellFromParent(created.assembly); return { cell: null, message: "Part could not be connected to the selected bed port." }; } // NEW
        session.selectedPorts = []; // NEW
        session.selectedBoundaries = []; // NEW
        return { cell: created.assembly, message: "Part added to bed " + (row.role === "input" ? "inlet." : "outlet.") }; // NEW
    } // NEW

    function bedPortPartAnchor(bedAssembly, role, index) { // NEW
        const geo = getGeometry(bedAssembly) || {}; // NEW
        const width = finiteNumber(geo.width, ASSEMBLY_DEFAULT_WIDTH); // NEW
        const height = finiteNumber(geo.height, ASSEMBLY_CONTRACTED_BED.height); // NEW
        const slotOffset = Math.max(0, Math.floor(finiteNumber(index, 0))) * 28; // NEW
        if (role === "input") return { x: finiteNumber(geo.x, 24), y: Math.max(24, finiteNumber(geo.y, 72) - ASSEMBLY_PART_HEIGHT - ASSEMBLY_PART_GAP - ASSEMBLY_HEADER_SIZE - 40 - slotOffset) }; // NEW
        return { x: finiteNumber(geo.x, 24), y: finiteNumber(geo.y, 72) + height + 40 + slotOffset, width }; // NEW
    } // NEW

    function applyLinearConnectionChoice(moduleCell, row, part) { // NEW
        const assembly = findAssemblyAncestor(row.cell); // NEW
        const parts = assemblyPartCells(assembly); // NEW
        const index = parts.indexOf(row.cell); // NEW
        if (!assembly || index < 0) return { message: "Selected part is no longer available." }; // NEW
        const edge = edgesForPort(moduleCell, { cellId: getCellId(row.cell), role: row.role, index: row.index })[0]; // NEW
        const neighbor = internalNeighborForPort(row.cell, row.role); // NEW
        if (!edge && !neighbor) { // FIX: free pipe-compatible dropdown choices must create a separate assembly connected by a pipe edge.
            const external = applyExternalPipeDropdownChoice(moduleCell, row, part); // FIX
            if (external) return external; // FIX
        } // FIX
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

    function applyExternalPipeDropdownChoice(moduleCell, row, part) { // FIX
        return ConnectionChainPlanner.applyExternalPart(moduleCell, row, part); // CHANGE
    } // FIX

    function dropdownPartConnectionDecision(moduleCell, row, part) { // FIX
        const p = normalizeCatalogPart(part); // FIX
        if (!p) return { ok: false, reason: "Selected part is no longer available." }; // FIX
        const rowConnector = ConnectorRules.portConnectorForCell(moduleCell, row.cell, row.role); // FIX
        const partConnector = row.role === "input" ? p.connectors.output : p.connectors.input; // FIX
        if (!partConnector) return { ok: false, reason: "Selected part does not have a compatible connector." }; // FIX
        const sourceConnector = row.role === "input" ? partConnector : rowConnector; // FIX
        const targetConnector = row.role === "input" ? rowConnector : partConnector; // FIX
        return Object.assign({ pipeRequired: ConnectorRules.connectorsRequirePipe(sourceConnector, targetConnector), sourceConnector, targetConnector }, ConnectorRules.connectionMode(moduleCell, sourceConnector, targetConnector)); // CHANGE
    } // FIX

    function linearDropdownPartAnchor(row) { // FIX
        const assembly = findAssemblyAncestor(row.cell); // FIX
        const geo = getGeometry(assembly) || getGeometry(row.cell) || {}; // FIX
        const x = finiteNumber(geo.x, 24); // FIX
        const y = finiteNumber(geo.y, 72); // FIX
        const height = finiteNumber(geo.height, ASSEMBLY_HEADER_SIZE + ASSEMBLY_PART_HEIGHT + ASSEMBLY_PART_GAP * 2); // FIX
        const slotOffset = Math.max(0, Math.floor(finiteNumber(row.index, 0))) * 28; // FIX
        return row.role === "input" ? { x, y: Math.max(24, y - ASSEMBLY_HEADER_SIZE - ASSEMBLY_PART_HEIGHT - ASSEMBLY_PART_GAP - 40 - slotOffset) } : { x, y: y + height + 40 + slotOffset }; // FIX
    } // FIX

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
        if (!ConnectorRules.connectionMode(moduleCell, ConnectorRules.portConnectorForCell(moduleCell, sourceCell, "output"), p.connectors.input).ok) return false; // CHANGE
        const downstreamAssembly = findAssemblyAncestor(downstreamCell); // NEW
        const parts = assemblyPartCells(downstreamAssembly); // NEW
        if (parts[0] !== downstreamCell) return false; // NEW
        const second = parts[1]; // NEW
        if (!second) return true; // NEW
        return ConnectorRules.connectorMatches(p.connectors.output, ConnectorRules.portConnectorForCell(moduleCell, second, "input"), null).ok; // CHANGE
    } // NEW

    function createBranchAssemblyFromOutlet(moduleCell, row, part) { // NEW
        const sourceAssembly = findAssemblyAncestor(row.cell); // NEW
        const sourceGeo = getGeometry(sourceAssembly) || {}; // NEW
        const anchor = { x: finiteNumber(sourceGeo.x, 24), y: finiteNumber(sourceGeo.y, 72) + finiteNumber(sourceGeo.height, 120) + 40 + row.index * 28 }; // NEW
        const created = createPartAssembly(moduleCell, part, anchor); // NEW
        const target = firstAssemblyPart(created.assembly); // NEW
        irrigationDebug("branchAssemblyFromOutlet:start", { sourceAssembly: debugCellSummary(sourceAssembly), sourceCell: debugCellSummary(row.cell), outletIndex: row.index, targetAssembly: debugCellSummary(created.assembly), targetCell: debugCellSummary(target), part: part ? { id: part.id, name: part.name, category: part.category } : null }); // DIAGNOSTIC
        const result = ConnectorRules.createAssemblyConnection(moduleCell, { cellId: getCellId(row.cell), role: "output", index: row.index }, { cellId: getCellId(target), role: "input", index: 0 }); // CHANGE
        irrigationDebug("branchAssemblyFromOutlet:connection-result", { ok: !!(result && result.ok), reason: result && result.reason || "", mode: result && result.mode || "", edge: debugCellSummary(result && result.edge), sourceAssembly: debugCellSummary(sourceAssembly), sourceCell: debugCellSummary(row.cell), outletIndex: row.index, targetAssembly: debugCellSummary(created.assembly), targetCell: debugCellSummary(target) }); // DIAGNOSTIC
        if (!result.ok) irrigationDebug("branchAssemblyFromOutlet:connection-rejected", { reason: result.reason, sourceAssembly: debugCellSummary(sourceAssembly), sourceCell: debugCellSummary(row.cell), outletIndex: row.index, targetAssembly: debugCellSummary(created.assembly), targetCell: debugCellSummary(target) }); // DIAGNOSTIC
        return result.ok ? created : created; // NEW
    } // NEW

    function normalizeAddedIrrigationEdges(session, cells) { // NEW
        if (!session || !Array.isArray(cells)) return; // NEW
        if (isIrrigationUndoRedoReplay()) { renderIrrigationMode(session); return; } // NEW
        if (programmaticEdgeInsertDepth > 0) { irrigationDebug("normalizeAddedIrrigationEdges:skip-programmatic", { depth: programmaticEdgeInsertDepth, count: cells.length }); return; } // DIAGNOSTIC
        runIrrigationEdit("normalizeAddedIrrigationEdges", function () { cells.forEach(function (cell) { normalizeAddedIrrigationEdge(session, cell); }); }); // CHANGE
    } // NEW

    function handleRemovedIrrigationCells(session, cells) { // NEW
        if (!session || !Array.isArray(cells) || !cells.length) return; // NEW
        if (isIrrigationUndoRedoReplay()) { renderIrrigationMode(session); return; } // NEW
        const changed = runIrrigationEdit("handleRemovedIrrigationCells", function () { // CHANGE
            let didChange = false; // NEW
            model.beginUpdate && model.beginUpdate(); // NEW
            try { // NEW
            cells.forEach(function (cell) { // NEW
                if (managedConnectionEdge(cell)) { didChange = true; return; } // CHANGE
                if (isAssemblyPartCell(cell) && findAssemblyAncestor(cell)) didChange = deleteAssemblyPartCell(session.moduleCell, cell) || didChange; // CHANGE
                else if (isAssembly(cell)) { externalEdgesForAssemblyCell(session.moduleCell, cell).forEach(removeCellFromParent); didChange = true; } // CHANGE
            }); // NEW
            } finally { model.endUpdate && model.endUpdate(); } // NEW
            if (didChange) scheduleHudGraphStateSync(session.moduleCell); // NEW
            return didChange; // NEW
        }); // NEW
        if (!changed) return; // NEW
        session.selectedPorts = []; // NEW
        session.selectedBoundaries = []; // NEW
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
        const decision = sourcePort && targetPort ? ConnectorRules.connectionDecision(session.moduleCell, sourcePort, targetPort) : { ok: false, reason: "No available boundary connector." }; // CHANGE
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
        const result = runIrrigationEdit("connectSelectedPorts", function () { const connected = createAssemblyConnection(session.moduleCell, sourcePort, targetPort); scheduleHudGraphStateSync(session.moduleCell); return connected; }); // CHANGE
        session.message = result.ok ? (result.mode === "merge" ? "Assemblies merged." : result.mode === "direct" ? "Direct link connected." : "Pipe Edge connected.") : result.reason; // CHANGE
        if (result.ok) session.selectedPorts = []; // NEW
        if (result.ok) session.selectedBoundaries = []; // NEW
        renderIrrigationMode(session); // NEW
    } // NEW

    function disconnectSelectedConnections(session, boundaries) { // CHANGE
        const selected = uniqueBoundaries(boundaries && boundaries.length ? boundaries : selectedOccupiedBoundaries(session)); // NEW
        const disconnected = runIrrigationEdit("disconnectSelectedConnections", function () { let count = 0; model.beginUpdate && model.beginUpdate(); try { count = disconnectBoundaries(session.moduleCell, selected); } finally { model.endUpdate && model.endUpdate(); } scheduleHudGraphStateSync(session.moduleCell); return count; }); // CHANGE
        session.selectedPorts = []; // NEW
        session.selectedBoundaries = []; // NEW
        session.focusedConnectionBoundary = null; // NEW
        session.message = disconnected ? "Disconnected " + disconnected + (disconnected === 1 ? " connection." : " connections.") : "No selected connections were occupied."; // CHANGE
        renderIrrigationMode(session); // NEW
    } // NEW

    function resolveInlineConnectionAction(session) { // NEW
        const ports = selectedValidPorts(session); // NEW
        const selectedBoundaries = selectedValidBoundaries(session); // NEW
        const anchorPort = normalizePort(session && session.inlineActionAnchorPort || {}); // NEW
        const anchorBoundary = anchorPort.cellId ? boundaryForPort(session.moduleCell, anchorPort) : null; // NEW
        const focusedBoundary = normalizeBoundary(session && session.focusedConnectionBoundary || {}); // NEW
        const selectedKeys = selectedBoundaries.map(boundaryKey); // NEW
        const disconnectBoundary = anchorBoundary && selectedKeys.indexOf(boundaryKey(anchorBoundary)) >= 0 ? anchorBoundary : null; // NEW
        if (disconnectBoundary && boundaryExists(session.moduleCell, disconnectBoundary)) return { type: "disconnect", label: "Disconnect", title: "Disconnect selected irrigation connection", boundary: disconnectBoundary, boundaries: [disconnectBoundary], anchorPort }; // NEW
        const focusedDisconnectBoundary = boundaryKey(focusedBoundary) && selectedKeys.indexOf(boundaryKey(focusedBoundary)) >= 0 ? focusedBoundary : null; // NEW
        if (focusedDisconnectBoundary && boundaryExists(session.moduleCell, focusedDisconnectBoundary)) return { type: "disconnect", label: "Disconnect", title: "Disconnect selected irrigation connection", boundary: focusedDisconnectBoundary, boundaries: [focusedDisconnectBoundary] }; // NEW
        if (ports.length === 2 && selectedBoundaries.length === 0) { // NEW
            const free = ports.filter(function (port) { return isPortFree(session.moduleCell, port); }); // NEW
            const ordered = free.length === 2 ? orderedConnectionPorts(free) : null; // NEW
            const direct = ordered ? validatePortConnection(session.moduleCell, ordered.source, ordered.target) : { ok: false }; // NEW
            if (direct.ok) return { type: "connect", label: "Connect", title: "Connect selected irrigation ports", source: ordered.source, target: ordered.target, anchorPort: ports[ports.length - 1] }; // NEW
        } // NEW
        return null; // NEW
    } // NEW

    function renderInlineConnectionAction(session, action) { // NEW
        if (!action) return; // NEW
        const anchor = inlineConnectionActionAnchorNode(session, action) || inlineConnectionActionAnchorBounds(session, action); // CHANGE
        if (!anchor) return; // NEW
        const btn = button(action.label, function (ev) { // NEW
            if (ev && ev.stopPropagation) ev.stopPropagation(); // NEW
            if (action.type === "connect") connectSelectedPorts(session, action.source, action.target); // NEW
            else disconnectSelectedConnections(session, action.boundaries); // NEW
        }); // NEW
        btn.className = "trellis-irrigation-inline-connection-action trellis-irrigation-inline-connection-action-" + action.type; // NEW
        btn.title = action.title; // NEW
        btn.style.cssText = inlineConnectionActionStyle(action.type); // NEW
        shieldHudEvents(btn); // NEW
        const layer = appendIrrigationControlNode(btn); // CHANGE
        if (!layer) return; // NEW
        positionInlineConnectionAction(btn, anchor, layer.parentNode || graph.container); // CHANGE
        session.inlineActionNodes.push(btn); // NEW
    } // NEW

    function inlineConnectionActionStyle(type) { // NEW
        const disconnect = type === "disconnect"; // NEW
        const border = disconnect ? "#b91c1c" : "#15803d"; // NEW
        const background = disconnect ? "#fee2e2" : "#dcfce7"; // NEW
        const color = disconnect ? "#7f1d1d" : "#14532d"; // NEW
        return "position:absolute;z-index:" + GRAPH_OVERLAY_Z.CONTROL_TOP + ";padding:5px 8px;border:1px solid " + border + ";border-radius:4px;background:" + background + ";color:" + color + ";box-shadow:0 2px 8px rgba(0,0,0,.20);font:bold 12px Arial,sans-serif;cursor:pointer;white-space:nowrap;box-sizing:border-box;max-width:160px;pointer-events:auto;"; // CHANGE
    } // NEW

    function inlineConnectionActionAnchorBounds(session, action) { // NEW
        if (action.type === "connect") return portBadgeBounds(session, action.anchorPort); // NEW
        return boundaryActionAnchorBounds(session, action.boundary); // NEW
    } // NEW

    function inlineConnectionActionAnchorNode(session, action) { // NEW
        if (!session || !action) return null; // NEW
        if (action.type === "connect") return portBadgeNodeForPort(session, action.anchorPort); // NEW
        const anchorPort = normalizePort(session.inlineActionAnchorPort || {}); // NEW
        if (anchorPort.cellId) return portBadgeNodeForPort(session, anchorPort); // NEW
        if (action.type === "disconnect") return connectionBadgeNodeForBoundary(session, action.boundary); // NEW
        return null; // NEW
    } // NEW

    function portBadgeNodeForPort(session, port) { // NEW
        const normalized = normalizePort(port); // NEW
        if (!normalized.cellId || !session.portBadgeNodeByKey) return null; // NEW
        return session.portBadgeNodeByKey.get(portKey(normalized)) || null; // NEW
    } // NEW

    function connectionBadgeNodeForBoundary(session, boundary) { // NEW
        const key = boundaryKey(boundary); // NEW
        if (!key || !session.connectionBadgeNodeByKey) return null; // NEW
        return session.connectionBadgeNodeByKey.get(key) || null; // NEW
    } // NEW

    function boundaryActionAnchorBounds(session, boundary) { // NEW
        const normalized = normalizeBoundary(boundary); // NEW
        const anchorPort = normalizePort(session.inlineActionAnchorPort || {}); // NEW
        if (anchorPort.cellId && boundaryKey(boundaryForPort(session.moduleCell, anchorPort)) === boundaryKey(normalized)) return portBadgeBounds(session, anchorPort); // NEW
        if (normalized.type === "internal") { // NEW
            const upstream = findCellById(session.moduleCell, normalized.upstreamId); // NEW
            const downstream = findCellById(session.moduleCell, normalized.downstreamId); // NEW
            return upstream && downstream ? internalConnectionBadgeBounds(upstream, downstream) : null; // NEW
        } // NEW
        const edge = normalized.type === "edge" ? findCellById(session.moduleCell, normalized.edgeId) : null; // NEW
        const sourcePort = edge ? portForConnectionEdge(edge, true) : null; // NEW
        const targetPort = edge ? portForConnectionEdge(edge, false) : null; // NEW
        return portBadgeBounds(session, sourcePort) || portBadgeBounds(session, targetPort); // NEW
    } // NEW

    function portForConnectionEdge(edge, source) { // NEW
        const terminal = source ? edge && edge.source : edge && edge.target; // NEW
        if (!terminal) return null; // NEW
        return { cellId: getCellId(terminal), role: source ? "output" : "input", index: finiteNumber(getCellAttr(edge, source ? ATTRS.EDGE_SOURCE_PORT : ATTRS.EDGE_TARGET_PORT, 0), 0) }; // NEW
    } // NEW

    function portBadgeBounds(session, port) { // NEW
        const normalized = normalizePort(port); // NEW
        const cell = portCell(session.moduleCell, normalized); // NEW
        if (!cell) return null; // NEW
        const state = cellState(cell); // NEW
        const total = Math.max(1, Math.floor(finiteNumber(portCapacityForCell(session.moduleCell, cell, normalized.role), 1))); // NEW
        const slot = (normalized.index + 1) / (total + 1); // NEW
        const width = portBadgeWidthForLabel(portDisplayLabel(session.moduleCell, normalized)); // NEW
        return { x: state.x + state.width * slot - width / 2, y: normalized.role === "input" ? state.y - PORT_BADGE_SIZE - 4 : state.y + state.height + 4, width, height: PORT_BADGE_SIZE }; // CHANGE
    } // NEW

    function internalConnectionBadgeBounds(upstream, downstream) { // NEW
        const up = cellState(upstream); // NEW
        const down = cellState(downstream); // NEW
        const width = portBadgeWidthForLabel("C"); // CHANGE
        const right = Math.max(finiteNumber(up.x, 0) + finiteNumber(up.width, 0), finiteNumber(down.x, 0) + finiteNumber(down.width, 0)); // NEW
        return { x: right + 4, y: (up.y + up.height + down.y) / 2 - PORT_BADGE_SIZE / 2, width, height: PORT_BADGE_SIZE }; // CHANGE
    } // NEW

    function positionInlineConnectionAction(node, anchor, host) { // CHANGE
        const hostNode = host && host.namespaceURI !== "http://www.w3.org/2000/svg" ? host : graph.container; // NEW
        const bounds = inlineActionAnchorBoundsInHost(anchor, hostNode); // NEW
        if (!bounds) return; // NEW
        const gap = 6; // NEW
        const width = node.offsetWidth || node.clientWidth || 96; // NEW
        const height = node.offsetHeight || node.clientHeight || 28; // NEW
        const scrollLeft = finiteNumber(hostNode && hostNode.scrollLeft, 0); // NEW
        const scrollTop = finiteNumber(hostNode && hostNode.scrollTop, 0); // NEW
        const viewportWidth = hostNode && hostNode.clientWidth ? hostNode.clientWidth : graph.container && graph.container.clientWidth ? graph.container.clientWidth : 10000; // CHANGE
        const viewportHeight = hostNode && hostNode.clientHeight ? hostNode.clientHeight : graph.container && graph.container.clientHeight ? graph.container.clientHeight : 10000; // CHANGE
        const minLeft = scrollLeft + gap; // NEW
        const minTop = scrollTop + gap; // NEW
        const maxLeft = scrollLeft + viewportWidth - width - gap; // NEW
        const maxTop = scrollTop + viewportHeight - height - gap; // NEW
        let left = finiteNumber(bounds.x, 0) + finiteNumber(bounds.width, PORT_BADGE_SIZE) + gap; // CHANGE
        if (left + width > scrollLeft + viewportWidth - gap) left = finiteNumber(bounds.x, 0) - width - gap; // CHANGE
        const top = finiteNumber(bounds.y, 0) + finiteNumber(bounds.height, PORT_BADGE_SIZE) / 2 - height / 2; // CHANGE
        node.style.left = Math.round(Math.max(minLeft, Math.min(left, maxLeft))) + "px"; // CHANGE
        node.style.top = Math.round(Math.max(minTop, Math.min(top, maxTop))) + "px"; // CHANGE
    } // NEW

    function inlineActionAnchorBoundsInHost(anchor, host) { // NEW
        if (!anchor) return null; // NEW
        if (anchor.getBoundingClientRect && host && host.getBoundingClientRect) { // NEW
            const rect = anchor.getBoundingClientRect(); // NEW
            const hostRect = host.getBoundingClientRect(); // NEW
            return { // NEW
                x: finiteNumber(rect.left, 0) - finiteNumber(hostRect.left, 0) + finiteNumber(host.scrollLeft, 0), // NEW
                y: finiteNumber(rect.top, 0) - finiteNumber(hostRect.top, 0) + finiteNumber(host.scrollTop, 0), // NEW
                width: finiteNumber(rect.width, finiteNumber(rect.right, 0) - finiteNumber(rect.left, 0)), // NEW
                height: finiteNumber(rect.height, finiteNumber(rect.bottom, 0) - finiteNumber(rect.top, 0)) // NEW
            }; // NEW
        } // NEW
        return anchor.x !== undefined || anchor.y !== undefined ? anchor : null; // NEW
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
        const bridge = ConnectorRules.bridgeSuggestionEligibility(moduleCell, sourcePort, targetPort); // NEW
        if (!bridge.ok) return []; // NEW
        const sourceConnector = bridge.sourceConnector; // CHANGE
        const targetConnector = bridge.targetConnector; // CHANGE
        const catalog = readCatalog(moduleCell); // NEW
        const sourcePart = { id: "source_port", name: "Selected outlet", category: "source_adapter", stockState: "in_stock", cost: 0, connectors: { inputs: 0, outputs: 1, output: sourceConnector }, specs: {} }; // NEW
        const targetRequirement = { connectorType: targetConnector.type, nominalSize: targetConnector.nominalSize, pipeType: targetConnector.pipeType || "", pipeConnection: !!targetConnector.pipeConnection }; // CHANGE
        const items = sortCatalogParts(catalog.items).map(normalizeCatalogPart).filter(function (part) { return part && bridgeSuggestionPartAllowed(part) && validateCatalogPart(part).ok; }); // CHANGE
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
        if (activeIrrigationEditDepth === 0) return runIrrigationEdit("applyBridgeSuggestion", function () { return applyBridgeSuggestion(session, sourcePort, targetPort, suggestion); }); // NEW
        const sourceCell = portCell(session.moduleCell, sourcePort); // NEW
        const targetCell = portCell(session.moduleCell, targetPort); // NEW
        const targetAssembly = findAssemblyAncestor(targetCell); // NEW
        if (!sourceCell || !targetCell || !targetAssembly) { session.message = "Bridge endpoints are no longer available."; renderIrrigationMode(session); return; } // NEW
        const parts = (suggestion.partIds || []).map(function (partId) { return partById(readCatalog(session.moduleCell), partId); }).filter(Boolean); // NEW
        const plan = ConnectionChainPlanner.planBridge(session.moduleCell, sourcePort, targetPort, parts); // NEW
        const result = plan.ok ? ConnectionChainPlanner.applyBridge(session.moduleCell, plan) : plan; // NEW
        const ok = !!(result && result.ok); // NEW
        if (!ok) session.message = result && result.reason || "Bridge connection could not be applied."; // CHANGE
        if (ok) { session.message = "Bridge connection applied."; session.selectedPorts = []; session.selectedBoundaries = []; session.bridgePorts = null; } // CHANGE
        scheduleHudGraphStateSync(session.moduleCell); // NEW
        renderIrrigationMode(session); // NEW
    } // NEW

    function bridgeSuggestionPartAllowed(part) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        return !!(p && BRIDGE_SUGGESTION_CATEGORIES.has(p.category) && p.connectors.inputs === 1 && p.connectors.outputs === 1); // NEW
    } // NEW

    function planBridgeConnectionChain(moduleCell, sourcePort, targetPort, parts) { // NEW
        const bridge = ConnectorRules.bridgeSuggestionEligibility(moduleCell, sourcePort, targetPort); // NEW
        if (!bridge.ok) return Object.assign({}, bridge, { ok: false }); // NEW
        const normalizedParts = (parts || []).map(normalizeCatalogPart).filter(Boolean); // NEW
        if (!normalizedParts.length) return { ok: false, reason: "No bridge parts selected." }; // NEW
        if (!normalizedParts.every(bridgeSuggestionPartAllowed)) return { ok: false, reason: "Bridge suggestions must use one-inlet, one-outlet adapters or fittings." }; // NEW
        const nodes = [{ kind: "existing", cell: bridge.sourceCell, port: normalizePort(sourcePort), outputIndex: bridge.source.index }].concat(normalizedParts.map(function (part, index) { return { kind: "part", part, partIndex: index, inputIndex: 0, outputIndex: 0 }; })).concat([{ kind: "existing", cell: bridge.targetCell, port: normalizePort(targetPort), inputIndex: bridge.target.index }]); // NEW
        const hops = []; // NEW
        for (let i = 0; i < nodes.length - 1; i++) { // NEW
            const sourceConnector = chainNodeOutputConnector(moduleCell, nodes[i]); // NEW
            const targetConnector = chainNodeInputConnector(moduleCell, nodes[i + 1]); // NEW
            const compatibility = ConnectorRules.connectionMode(moduleCell, sourceConnector, targetConnector); // NEW
            if (!compatibility.ok) return { ok: false, reason: compatibility.reason || "Bridge parts are not compatible." }; // NEW
            hops.push(Object.assign({}, compatibility, { sourceNode: nodes[i], targetNode: nodes[i + 1], sourceConnector, targetConnector })); // NEW
        } // NEW
        return { ok: true, sourcePort: normalizePort(sourcePort), targetPort: normalizePort(targetPort), sourceCell: bridge.sourceCell, targetCell: bridge.targetCell, parts: normalizedParts, nodes, hops, hasPipe: hops.some(function (hop) { return hop.mode === "pipe"; }) }; // NEW
    } // NEW

    function chainNodeInputConnector(moduleCell, node) { // NEW
        if (!node) return null; // NEW
        if (node.kind === "existing") return ConnectorRules.portConnectorForCell(moduleCell, node.cell, "input"); // NEW
        return node.part && node.part.connectors && node.part.connectors.input; // NEW
    } // NEW

    function chainNodeOutputConnector(moduleCell, node) { // NEW
        if (!node) return null; // NEW
        if (node.kind === "existing") return ConnectorRules.portConnectorForCell(moduleCell, node.cell, "output"); // NEW
        return node.part && node.part.connectors && node.part.connectors.output; // NEW
    } // NEW

    function applyBridgeConnectionChain(moduleCell, plan) { // NEW
        if (!plan || !plan.ok) return plan || { ok: false, reason: "Bridge plan is unavailable." }; // NEW
        const current = ConnectorRules.bridgeSuggestionEligibility(moduleCell, plan.sourcePort, plan.targetPort); // NEW
        if (!current.ok) return { ok: false, reason: current.reason || "Bridge endpoints are no longer available." }; // NEW
        if (!plan.hasPipe) return applyInlineBridgeConnectionChain(moduleCell, plan); // NEW
        return applyExternalBridgeConnectionChain(moduleCell, plan); // NEW
    } // NEW

    function applyExternalPartConnection(moduleCell, row, part) { // NEW
        const decision = dropdownPartConnectionDecision(moduleCell, row, part); // NEW
        if (!decision || !decision.pipeRequired) return null; // NEW
        if (!decision.ok || decision.mode !== "pipe") return { cell: null, message: decision.reason || "Part could not be connected with pipe." }; // NEW
        const createdAssemblies = []; // NEW
        const createdEdges = []; // NEW
        try { // NEW
            const created = createPartAssembly(moduleCell, part, linearDropdownPartAnchor(row)); // NEW
            if (!created || !created.assembly || !created.partCell) throw new Error("Part could not be created."); // NEW
            createdAssemblies.push(created.assembly); // NEW
            const sourceCell = row.role === "input" ? created.partCell : row.cell; // NEW
            const targetCell = row.role === "input" ? row.cell : created.partCell; // NEW
            const sourceIndex = row.role === "input" ? 0 : row.index; // NEW
            const targetIndex = row.role === "input" ? row.index : 0; // NEW
            const edge = createPlannedConnectionEdge(moduleCell, sourceCell, targetCell, decision, sourceIndex, targetIndex); // NEW
            if (!edge) throw new Error("Part could not be connected as a separate assembly."); // NEW
            createdEdges.push(edge); // NEW
            return { cell: created.assembly, message: "Part assembly connected with pipe." }; // NEW
        } catch (err) { // NEW
            createdEdges.forEach(removeCellFromParent); // NEW
            createdAssemblies.forEach(removeCellFromParent); // NEW
            return { cell: null, message: err && err.message || "Part could not be connected as a separate assembly." }; // NEW
        } // NEW
    } // NEW

    function applyInlineBridgeConnectionChain(moduleCell, plan) { // NEW
        const targetAssembly = findAssemblyAncestor(plan.targetCell); // NEW
        if (!targetAssembly) return { ok: false, reason: "Bridge target assembly is unavailable." }; // NEW
        const previousRows = assemblyPartCells(targetAssembly).map(function (cell) { return { cell, geometry: Object.assign({}, getGeometry(cell) || {}) }; }); // NEW
        const previousAssemblyGeometry = Object.assign({}, getGeometry(targetAssembly) || {}); // NEW
        const inserted = insertBridgePartsBefore(moduleCell, targetAssembly, plan.targetCell, plan.parts); // NEW
        moveBridgeAssemblies(plan.sourceCell, plan.targetCell); // NEW
        const chain = [plan.sourceCell].concat(inserted).concat([plan.targetCell]); // NEW
        for (let i = 0; i < chain.length - 1; i++) { // NEW
            if (findAssemblyAncestor(chain[i]) === findAssemblyAncestor(chain[i + 1]) && internalNeighborForPort(chain[i], "output") === chain[i + 1]) continue; // NEW
            const result = createAssemblyConnection(moduleCell, { cellId: getCellId(chain[i]), role: "output", index: 0 }, { cellId: getCellId(chain[i + 1]), role: "input", index: 0 }); // NEW
            if (!result.ok) { // NEW
                inserted.forEach(removeCellFromParent); // NEW
                previousRows.forEach(function (row) { if (row.cell && row.cell.geometry) row.cell.geometry = Object.assign({}, row.geometry); }); // NEW
                if (targetAssembly.geometry) targetAssembly.geometry = previousAssemblyGeometry; // NEW
                return { ok: false, reason: result.reason }; // NEW
            } // NEW
        } // NEW
        return { ok: true, createdAssemblies: [], createdEdges: [] }; // NEW
    } // NEW

    function applyExternalBridgeConnectionChain(moduleCell, plan) { // NEW
        const sourceAssembly = findAssemblyAncestor(plan.sourceCell); // NEW
        const prefixCount = sourceDirectBridgePrefixCount(plan, sourceAssembly); // NEW
        const previousSourceRows = sourceAssembly ? assemblyPartCells(sourceAssembly).map(function (cell) { return { cell, geometry: Object.assign({}, getGeometry(cell) || {}) }; }) : []; // NEW
        const previousSourceGeometry = sourceAssembly ? Object.assign({}, getGeometry(sourceAssembly) || {}) : null; // NEW
        const appendedPrefix = []; // NEW
        const createdAssemblies = []; // NEW
        const createdEdges = []; // NEW
        try { // NEW
            const cellsByPartIndex = new Map(); // NEW
            appendSourceBridgePrefix(sourceAssembly, plan, prefixCount).forEach(function (cell, index) { // NEW
                appendedPrefix.push(cell); // NEW
                cellsByPartIndex.set(index, cell); // NEW
            }); // NEW
            const groups = bridgePartGroupsForPlan(plan, prefixCount); // CHANGE
            groups.forEach(function (group, groupIndex) { // NEW
                const created = createBridgePartAssembly(moduleCell, group.parts, bridgeGroupAnchor(plan.sourceCell, plan.targetCell, groupIndex, groups.length)); // NEW
                createdAssemblies.push(created.assembly); // NEW
                group.partIndexes.forEach(function (partIndex, index) { cellsByPartIndex.set(partIndex, created.parts[index]); }); // NEW
            }); // NEW
            const resolvedNodes = plan.nodes.map(function (node) { // NEW
                if (node.kind === "existing") return Object.assign({}, node); // NEW
                return Object.assign({}, node, { cell: cellsByPartIndex.get(node.partIndex) }); // NEW
            }); // NEW
            for (let i = 0; i < plan.hops.length; i++) { // NEW
                const sourceNode = resolvedNodes[i]; // NEW
                const targetNode = resolvedNodes[i + 1]; // NEW
                if (!sourceNode.cell || !targetNode.cell) throw new Error("Bridge part could not be created."); // NEW
                if (findAssemblyAncestor(sourceNode.cell) === findAssemblyAncestor(targetNode.cell) && internalNeighborForPort(sourceNode.cell, "output") === targetNode.cell) continue; // NEW
                const edge = createPlannedConnectionEdge(moduleCell, sourceNode.cell, targetNode.cell, plan.hops[i], sourceNode.outputIndex || 0, targetNode.inputIndex || 0); // NEW
                if (!edge) throw new Error("Bridge connection edge could not be created."); // NEW
                createdEdges.push(edge); // NEW
            } // NEW
            return { ok: true, createdAssemblies, createdEdges }; // NEW
        } catch (err) { // NEW
            createdEdges.forEach(removeCellFromParent); // NEW
            createdAssemblies.forEach(removeCellFromParent); // NEW
            appendedPrefix.forEach(removeCellFromParent); // NEW
            previousSourceRows.forEach(function (row) { if (row.cell && row.cell.geometry) row.cell.geometry = Object.assign({}, row.geometry); }); // NEW
            if (sourceAssembly && sourceAssembly.geometry && previousSourceGeometry) sourceAssembly.geometry = previousSourceGeometry; // NEW
            return { ok: false, reason: err && err.message || "Bridge connection could not be applied." }; // NEW
        } // NEW
    } // NEW

    function sourceDirectBridgePrefixCount(plan, sourceAssembly) { // NEW
        if (!plan || !sourceAssembly || assemblyType(sourceAssembly) === "bed") return 0; // NEW
        let count = 0; // NEW
        while (count < plan.parts.length && plan.hops[count] && plan.hops[count].mode === "direct") count++; // NEW
        return count; // NEW
    } // NEW

    function appendSourceBridgePrefix(sourceAssembly, plan, count) { // NEW
        if (!sourceAssembly || count <= 0) return []; // NEW
        const sourceIndex = assemblyPartCells(sourceAssembly).indexOf(plan.sourceCell); // NEW
        const insertAt = sourceIndex < 0 ? assemblyPartCells(sourceAssembly).length : sourceIndex + 1; // NEW
        const inserted = []; // NEW
        for (let i = 0; i < count; i++) inserted.push(insertAssemblyPartAt(sourceAssembly, plan.parts[i], insertAt + i)); // NEW
        return inserted; // NEW
    } // NEW

    function bridgePartGroupsForPlan(plan, startIndex) { // CHANGE
        const groups = []; // NEW
        let current = null; // NEW
        plan.parts.forEach(function (part, index) { // NEW
            if (index < Math.max(0, Math.floor(finiteNumber(startIndex, 0)))) return; // NEW
            const hopBefore = plan.hops[index]; // NEW
            if (!current || hopBefore.mode === "pipe") { current = { parts: [], partIndexes: [] }; groups.push(current); } // NEW
            current.parts.push(part); // NEW
            current.partIndexes.push(index); // NEW
        }); // NEW
        return groups; // NEW
    } // NEW

    function createBridgePartAssembly(moduleCell, parts, anchor) { // NEW
        const created = createPartAssembly(moduleCell, parts[0], anchor); // NEW
        const cells = [created.partCell]; // NEW
        for (let i = 1; i < parts.length; i++) cells.push(insertAssemblyPartAt(created.assembly, parts[i], assemblyPartCells(created.assembly).length)); // NEW
        return { assembly: created.assembly, parts: cells }; // NEW
    } // NEW

    function bridgeGroupAnchor(sourceCell, targetCell, index, count) { // NEW
        const sourceAssembly = findAssemblyAncestor(sourceCell) || sourceCell; // NEW
        const targetAssembly = findAssemblyAncestor(targetCell) || targetCell; // NEW
        const sourceGeo = getGeometry(sourceAssembly) || {}; // NEW
        const targetGeo = getGeometry(targetAssembly) || {}; // NEW
        const slot = (index + 1) / (Math.max(1, count) + 1); // NEW
        const sourceX = finiteNumber(sourceGeo.x, 24); // NEW
        const sourceY = finiteNumber(sourceGeo.y, 72); // NEW
        const targetX = finiteNumber(targetGeo.x, sourceX); // NEW
        const targetY = finiteNumber(targetGeo.y, sourceY + 160); // NEW
        return { x: Math.round(sourceX + (targetX - sourceX) * slot), y: Math.round(sourceY + (targetY - sourceY) * slot) }; // NEW
    } // NEW

    function createPlannedConnectionEdge(moduleCell, sourceCell, targetCell, hop, sourceIndex, targetIndex) { // NEW
        const attrs = { [ATTRS.EDGE_SOURCE_PORT]: String(sourceIndex || 0), [ATTRS.EDGE_TARGET_PORT]: String(targetIndex || 0) }; // NEW
        let style = DIRECT_LINK_EDGE_STYLE; // NEW
        if (hop.mode === "pipe") { attrs[ATTRS.PIPE_EDGE] = "1"; attrs[ATTRS.DIRECT_LINK_EDGE] = ""; attrs[ATTRS.PIPE_PART_ID] = hop.pipePartId || ""; attrs[ATTRS.PART_STATE] = PART_STATE_PLANNED; style = pipeEdgeStyleForPart(moduleCell, hop.pipePartId || "", PIPE_EDGE_BASE_STYLE); } // CHANGE
        else { attrs[ATTRS.PIPE_EDGE] = ""; attrs[ATTRS.DIRECT_LINK_EDGE] = "1"; attrs[ATTRS.PIPE_PART_ID] = ""; } // CHANGE
        const label = connectionDisplayLabel(hop.sourceConnector, hop.targetConnector); // NEW
        attrs.label = label; // NEW
        let edge = null; // NEW
        programmaticEdgeInsertDepth++; // NEW
        try { edge = createEdge(moduleCell, sourceCell, targetCell, label, style, attrs); } // NEW
        finally { programmaticEdgeInsertDepth = Math.max(0, programmaticEdgeInsertDepth - 1); } // NEW
        if (edge && graph.refresh) graph.refresh(edge); // NEW
        return edge; // NEW
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
        const flow = addTextField(form, "Flow gpm", profile.usableFlowGpm == null ? "" : profile.usableFlowGpm); // NEW
        const pressure = addTextField(form, "Static psi", profile.staticPressurePsi == null ? "" : profile.staticPressurePsi); // NEW
        const save = button("Save Source", function () { // NEW
            runIrrigationEdit("saveSourceProfile", function () { const next = normalizeEndpointProfile(Object.assign({}, profile, { // CHANGE
                connectorType: connector.value.trim(), // NEW
                nominalSize: size.value.trim(), // NEW
                usableFlowGpm: finiteNumber(flow.value, null), // NEW
                staticPressurePsi: finiteNumber(pressure.value, null) // NEW
            })); // NEW
            setCellAttrs(cell, { [ATTRS.ENDPOINT_PROFILE_JSON]: JSON.stringify(next) }); // NEW
            scheduleHudGraphStateSync(session.moduleCell); // CHANGE
            }); // NEW
            renderIrrigationMode(session); // NEW
        }); // NEW
        form.appendChild(save); // NEW
        hud.appendChild(form); // NEW
    } // NEW

    function sourceEndpointForSelection(primary, primaryAssembly) { // NEW
        if (endpointType(primary) === "source") return primary; // NEW
        if (primaryAssembly && assemblyType(primaryAssembly) === "source") return firstAssemblyPart(primaryAssembly); // NEW
        return null; // NEW
    } // NEW

    function createSourceTitleInput(session, sourceCell, assemblyCell) { // CHANGE
        const initialLabel = endpointLabel(sourceCell); // NEW
        const input = document.createElement("input"); // NEW
        input.type = "text"; // NEW
        input.value = initialLabel; // NEW
        input.className = "trellis-irrigation-source-title-input"; // NEW
        input.setAttribute("aria-label", "Water source title"); // NEW
        input.style.cssText = "display:block;box-sizing:border-box;width:100%;min-width:0;border:1px solid rgba(75,85,99,.35);border-radius:4px;padding:3px 5px;font:12px Arial,sans-serif;font-weight:600;"; // CHANGE
        function stopDomEvent(evt) { if (evt && evt.stopPropagation) evt.stopPropagation(); } // NEW
        function stopAndPreventDomEvent(evt) { stopDomEvent(evt); if (evt && evt.preventDefault) evt.preventDefault(); } // NEW
        ["mousedown", "mouseup", "click", "dblclick", "pointerdown", "pointerup", "keypress", "keyup"].forEach(function (type) { input.addEventListener(type, stopDomEvent); }); // NEW
        input.addEventListener("keydown", function (evt) { // NEW
            stopDomEvent(evt); // NEW
            if (evt.key === "Enter") { input.value = writeSourceTitle(session, sourceCell, assemblyCell, input.value, initialLabel); if (input.blur) input.blur(); stopAndPreventDomEvent(evt); } // NEW
            else if (evt.key === "Escape") { input.value = initialLabel; stopAndPreventDomEvent(evt); } // NEW
        }); // NEW
        input.addEventListener("blur", function () { input.value = writeSourceTitle(session, sourceCell, assemblyCell, input.value, initialLabel); }); // NEW
        return input; // CHANGE
    } // NEW

    function writeSourceTitle(session, sourceCell, assemblyCell, label, fallback) { // NEW
        const nextLabel = String(label || "").trim() || String(fallback || "Water Source"); // NEW
        const profile = normalizeEndpointProfile(Object.assign({}, endpointProfile(sourceCell), { label: nextLabel })); // NEW
        runIrrigationEdit("renameSource", function () { // NEW
            model.beginUpdate && model.beginUpdate(); // NEW
            try { // NEW
                setCellAttrs(sourceCell, { label: nextLabel, [ATTRS.ENDPOINT_PROFILE_JSON]: JSON.stringify(profile) }); // NEW
                if (assemblyCell && assemblyCell !== sourceCell) setCellAttrs(assemblyCell, { label: nextLabel }); // NEW
                scheduleHudGraphStateSync(session.moduleCell); // NEW
            } finally { model.endUpdate && model.endUpdate(); } // NEW
        }); // NEW
        return nextLabel; // NEW
    } // NEW

    function renderBedInletFields(session, hud, assemblyCell) { // CHANGE
        const bedAssembly = isAssembly(assemblyCell) ? assemblyCell : findAssemblyAncestor(assemblyCell); // CHANGE
        const bedCell = bedCellForAssembly(session.moduleCell, bedAssembly); // CHANGE
        if (!bedAssembly || !bedCell) return; // CHANGE
        const ports = readBedPortConfig(bedCell); // NEW
        const saved = readBedAssemblyTemplateRecord(session.moduleCell, bedAssembly) || {}; // CHANGE
        const roleParts = bedTemplateRolePartIds(saved); // NEW
        const savedTemplateId = saved.templateId || BED_TEMPLATES[0].id; // NEW
        const savedTemplateDef = bedTemplateById(savedTemplateId); // NEW
        const initialRowOrientation = normalizeBedRowOrientation(saved.rowOrientation, savedTemplateDef); // NEW
        const initialRows = saved.spacing && saved.spacing.rows != null ? saved.spacing.rows : (savedTemplateDef.defaultRows || 2); // CHANGE
        const initialCatalog = readCatalog(session.moduleCell); // NEW
        const initialRecipe = normalizeBedRecipeInput(initialCatalog, savedTemplateDef, saved); // NEW
        const initialBom = computeBedTemplateBom(initialCatalog, getGeometry(bedAssembly) || getGeometry(bedCell) || {}, savedTemplateId, initialRows, initialRowOrientation, initialRecipe); // CHANGE
        const rowSpacingUnit = rowSpacingDisplayUnit(session.moduleCell); // NEW
        const initialRowSpacingCm = finiteNumber(saved.spacing && saved.spacing.rowSpacingCm, initialBom.rowSpacingCm); // NEW
        const templateSection = hudSection("Irrigation Template"); // NEW
        const narrowTemplate = typeof window !== "undefined" && window.innerWidth && window.innerWidth < 560; // NEW
        hud.style.width = narrowTemplate ? "min(460px,calc(100vw - 32px))" : "min(640px,calc(100vw - 32px))"; // NEW
        hud.style.maxWidth = narrowTemplate ? "min(460px,calc(100vw - 32px))" : "min(640px,calc(100vw - 32px))"; // NEW
        const form = document.createElement("div"); // CHANGE
        form.className = "trellis-irrigation-bed-inlet-form"; // CHANGE
        form.style.cssText = "display:grid;grid-template-columns:" + (narrowTemplate ? "minmax(0,1fr)" : "minmax(0,1fr) minmax(0,1fr)") + ";gap:8px 10px;width:100%;min-width:0;max-width:100%;box-sizing:border-box;overflow:hidden;"; // CHANGE
        const layoutColumn = document.createElement("div"); // NEW
        layoutColumn.className = "trellis-irrigation-bed-template-layout-column"; // NEW
        layoutColumn.style.cssText = "display:grid;gap:6px;min-width:0;max-width:100%;box-sizing:border-box;overflow:hidden;"; // NEW
        const partsColumn = document.createElement("div"); // NEW
        partsColumn.className = "trellis-irrigation-bed-template-parts-column"; // NEW
        partsColumn.style.cssText = "display:grid;gap:6px;min-width:0;max-width:100%;box-sizing:border-box;overflow:hidden;"; // NEW
        form.appendChild(layoutColumn); // NEW
        form.appendChild(partsColumn); // NEW
        const templateSelect = addSelectField(layoutColumn, "Template", BED_TEMPLATES.map(function (entry) { return entry.id; }), savedTemplateId); // CHANGE
        const orientation = addSelectField(layoutColumn, "Row orientation", BED_TEMPLATE_ROW_ORIENTATIONS, initialRowOrientation); // CHANGE
        const rows = addNumericField(layoutColumn, "Rows", initialRows, { min: 1, step: 1, inputMode: "numeric" }); // CHANGE
        const rowSpacing = addNumericField(layoutColumn, "Row spacing " + rowSpacingUnit, formatRowSpacingDisplayValue(initialRowSpacingCm, session.moduleCell), { min: 0, step: 1, inputMode: "numeric" }); // CHANGE
        const spacing = addNumericField(layoutColumn, "Emitter spacing in", initialRecipe.emitterSpacingIn || "12", { min: 1, step: 1, inputMode: "decimal" }); // CHANGE
        const rowPart = addPartSelectField(partsColumn, "Row part", bedRowPartOptions(session.moduleCell, initialRecipe.rowPartId), initialRecipe.rowPartId); // CHANGE
        const emitterPart = addPartSelectField(partsColumn, "Emitter/device part", bedEmitterPartOptions(session.moduleCell, initialRecipe.rowPartId, initialRecipe.emitterPartId), initialRecipe.emitterPartId); // CHANGE
        const inletPart = addPartSelectField(partsColumn, "Inlet part", bedRolePartOptions(session.moduleCell, "input", roleParts.inletPartId, savedTemplateId, initialRecipe.rowPartId), roleParts.inletPartId); // CHANGE
        const rowTakeoffPart = addPartSelectField(partsColumn, "Row takeoff part", bedFittingPartOptions(session.moduleCell, "row_takeoff", initialBom.recipe && initialBom.recipe.supplyPipePartId, initialRecipe.rowPartId, initialRecipe.rowTakeoffPartId), initialRecipe.rowTakeoffPartId); // CHANGE
        const rowEndCapPart = addPartSelectField(partsColumn, "Row end cap", bedFittingPartOptions(session.moduleCell, "row_end_cap", initialBom.recipe && initialBom.recipe.supplyPipePartId, initialRecipe.rowPartId, initialRecipe.rowEndCapPartId), initialRecipe.rowEndCapPartId); // CHANGE
        const headerEndCapPart = addPartSelectField(partsColumn, "Header end cap", bedFittingPartOptions(session.moduleCell, "header_end_cap", initialBom.recipe && initialBom.recipe.supplyPipePartId, initialRecipe.rowPartId, initialRecipe.headerEndCapPartId), initialRecipe.headerEndCapPartId); // CHANGE
        const outletPart = addPartSelectField(partsColumn, "Outlet part", bedOutletPartOptions(session.moduleCell, initialBom.recipe && initialBom.recipe.supplyPipePartId, roleParts.outletPartId), roleParts.outletPartId); // CHANGE
        const summary = hudText(""); // NEW
        summary.className = "trellis-irrigation-bed-template-summary"; // NEW
        let draftDirty = false; // NEW
        function currentBedTemplateGeometry() { // NEW
            return getGeometry(bedAssembly) || getGeometry(bedCell) || {}; // NEW
        } // NEW
        function syncRowSpacingFromRows() { // NEW
            const templateDef = bedTemplateById(templateSelect.value); // NEW
            const rowCount = Math.max(0, Math.floor(finiteNumber(rows.value, templateDef.defaultRows))); // CHANGE
            const rowOrientation = normalizeBedRowOrientation(orientation.value, templateDef); // NEW
            rowSpacing.value = formatRowSpacingDisplayValue(rowSpacingCmForRows(currentBedTemplateGeometry(), rowCount, rowOrientation), session.moduleCell); // NEW
        } // NEW
        function syncRowsFromRowSpacing() { // NEW
            const templateDef = bedTemplateById(templateSelect.value); // NEW
            const fallback = Math.max(0, Math.floor(finiteNumber(rows.value, templateDef.defaultRows))); // CHANGE
            const rowOrientation = normalizeBedRowOrientation(orientation.value, templateDef); // NEW
            const rowCount = rowsForRowSpacingCm(currentBedTemplateGeometry(), rowSpacingDisplayValueToCm(rowSpacing.value, session.moduleCell), rowOrientation, fallback); // NEW
            rows.value = String(rowCount); // NEW
            rowSpacing.value = formatRowSpacingDisplayValue(rowSpacingCmForRows(currentBedTemplateGeometry(), rowCount, rowOrientation), session.moduleCell); // NEW
        } // NEW
        function currentDraft() { // NEW
            const templateDef = bedTemplateById(templateSelect.value); // NEW
            const rowCount = Math.max(0, Math.floor(finiteNumber(rows.value, templateDef.defaultRows))); // CHANGE
            const catalog = readCatalog(session.moduleCell); // NEW
            const recipeInput = { inletPartId: inletPart.value, outletPartId: outletPart.value, rowPartId: rowPart.value, emitterPartId: emitterPart.value, rowTakeoffPartId: rowTakeoffPart.value, rowEndCapPartId: rowEndCapPart.value, headerEndCapPartId: headerEndCapPart.value, emitterSpacingIn: finiteNumber(spacing.value, 12) }; // NEW
            const bom = computeBedTemplateBom(catalog, currentBedTemplateGeometry(), templateSelect.value, rowCount, orientation.value, recipeInput); // CHANGE
            return { // NEW
                catalog, // CHANGE
                bom, // NEW
                templateId: templateSelect.value, // NEW
                inletPartId: String(inletPart.value || "").trim(), // NEW
                outletPartId: String(outletPart.value || "").trim(), // NEW
                rowPartId: String(rowPart.value || "").trim(), // NEW
                emitterPartId: String(emitterPart.value || "").trim(), // NEW
                rowTakeoffPartId: String(rowTakeoffPart.value || "").trim(), // NEW
                rowEndCapPartId: String(rowEndCapPart.value || "").trim(), // NEW
                headerEndCapPartId: String(headerEndCapPart.value || "").trim(), // NEW
                rowSpacingCm: bom.rowSpacingCm, // NEW
                emitterInches: finiteNumber(spacing.value, 12) // NEW
            }; // NEW
        } // NEW
        function bomSummaryText(bom) { // NEW
            return "Rows " + bom.rowCount + " x " + bom.rowLengthMeters.toFixed(2) + " m = " + bom.totalRowMeters.toFixed(2) + " row m\nSupply " + (bom.recipe && bom.recipe.supplyPipePartId || "not selected") + ", demand " + bom.demand.flowGpm.toFixed(2) + " gpm, " + bom.demand.operatingPressurePsi.toFixed(0) + " PSI"; // CHANGE
        } // NEW
        function setTemplateFieldVisible(control, visible) { // NEW
            if (control && control.parentNode) control.parentNode.style.display = visible ? "flex" : "none"; // NEW
        } // NEW
        function refreshTemplatePreview(clearInvalidSelections) { // NEW
            const draft = currentDraft(); // NEW
            const bom = draft.bom; // NEW
            const rowPartOptions = bedRowPartOptions(session.moduleCell, rowPart.value, !clearInvalidSelections); // NEW
            const emitterOptions = bedEmitterPartOptions(session.moduleCell, rowPart.value, emitterPart.value, !clearInvalidSelections); // NEW
            const inletOptions = bedRolePartOptions(session.moduleCell, "input", inletPart.value, templateSelect.value, rowPart.value, !clearInvalidSelections); // CHANGE
            const rowTakeoffOptions = bedFittingPartOptions(session.moduleCell, "row_takeoff", bom.recipe && bom.recipe.supplyPipePartId, rowPart.value, rowTakeoffPart.value, !clearInvalidSelections); // NEW
            const rowEndCapOptions = bedFittingPartOptions(session.moduleCell, "row_end_cap", bom.recipe && bom.recipe.supplyPipePartId, rowPart.value, rowEndCapPart.value, !clearInvalidSelections); // NEW
            const headerEndCapOptions = bedFittingPartOptions(session.moduleCell, "header_end_cap", bom.recipe && bom.recipe.supplyPipePartId, rowPart.value, headerEndCapPart.value, !clearInvalidSelections); // NEW
            const outletOptions = bedOutletPartOptions(session.moduleCell, bom.recipe && bom.recipe.supplyPipePartId, outletPart.value, !clearInvalidSelections); // CHANGE
            setPartSelectOptions(rowPart, rowPartOptions, rowPartOptions.some(function (part) { return part.id === rowPart.value; }) ? rowPart.value : (rowPartOptions[0] && rowPartOptions[0].id || "")); // CHANGE
            setPartSelectOptions(emitterPart, emitterOptions, emitterOptions.some(function (part) { return part.id === emitterPart.value; }) ? emitterPart.value : (emitterOptions[0] && emitterOptions[0].id || "")); // CHANGE
            setPartSelectOptions(inletPart, inletOptions, inletOptions.some(function (part) { return part.id === inletPart.value; }) ? inletPart.value : ""); // NEW
            setPartSelectOptions(rowTakeoffPart, rowTakeoffOptions, rowTakeoffOptions.some(function (part) { return part.id === rowTakeoffPart.value; }) ? rowTakeoffPart.value : (rowTakeoffOptions[0] && rowTakeoffOptions[0].id || "")); // CHANGE
            setPartSelectOptions(rowEndCapPart, rowEndCapOptions, rowEndCapOptions.some(function (part) { return part.id === rowEndCapPart.value; }) ? rowEndCapPart.value : (rowEndCapOptions[0] && rowEndCapOptions[0].id || "")); // CHANGE
            setPartSelectOptions(headerEndCapPart, headerEndCapOptions, headerEndCapOptions.some(function (part) { return part.id === headerEndCapPart.value; }) ? headerEndCapPart.value : (headerEndCapOptions[0] && headerEndCapOptions[0].id || "")); // CHANGE
            setPartSelectOptions(outletPart, outletOptions, outletOptions.some(function (part) { return part.id === outletPart.value; }) ? outletPart.value : ""); // NEW
            const selfEmitting = isSelfEmittingRowPart(partById(draft.catalog, rowPart.value)); // NEW
            setTemplateFieldVisible(emitterPart, !selfEmitting); // CHANGE
            spacing.disabled = selfEmitting; // NEW
            if (selfEmitting) spacing.value = String(finiteNumber(partById(draft.catalog, rowPart.value) && partById(draft.catalog, rowPart.value).specs && partById(draft.catalog, rowPart.value).specs.emitterSpacingIn, 12)); // NEW
            setTemplateFieldVisible(outletPart, !!(bom.recipe && bom.recipe.supplyPipePartId)); // CHANGE
            setTemplateFieldVisible(headerEndCapPart, !outletPart.value); // CHANGE
            summary.textContent = bomSummaryText(bom); // NEW
            summary.style.color = bom.missingPartIds.length ? "#8a4b00" : "#333"; // NEW
            return draft; // NEW
        } // NEW
        function validateBedTemplateDraft(draft) { // NEW
            const catalog = draft.catalog; // NEW
            const bom = draft.bom; // NEW
            const anchorPart = partById(catalog, bom.anchorPartId); // NEW
            if (bom.rowCount === 0) return { ok: true, message: "" }; // NEW
            if (!draft.inletPartId) return { ok: false, message: "Select an inlet part before applying the bed layout." }; // NEW
            if (!draft.rowPartId) return { ok: false, message: "Select a row part before applying the bed layout." }; // NEW
            if (!bom.recipe || !bom.recipe.supplyPipePartId) return { ok: false, message: "Cannot apply template. Missing fixed starter supply pipe for the selected inlet size." }; // NEW
            if (!anchorPart) return { ok: false, message: "Cannot apply template. No compatible row part was found." }; // CHANGE
            if (!draft.emitterPartId && !bom.recipe.selfEmitting) return { ok: false, message: "Select an emitter/device part before applying the bed layout." }; // NEW
            if (!draft.rowTakeoffPartId) return { ok: false, message: "Select a row takeoff part before applying the bed layout." }; // NEW
            if (!draft.rowEndCapPartId) return { ok: false, message: "Select a row end cap before applying the bed layout." }; // NEW
            if (!draft.outletPartId && !draft.headerEndCapPartId) return { ok: false, message: "Select a header end cap or outlet part before applying the bed layout." }; // NEW
            if (bom.missingPartIds.length) return { ok: false, message: "Cannot apply template. Missing required parts: " + bom.missingPartIds.join(", ") + "." }; // NEW
            return { ok: true, message: "" }; // NEW
        } // NEW
        function commitBedTemplateDraft() { // NEW
            if (activeIrrigationMode !== session || isIrrigationModeClosing(session)) return false; // NEW
            if (!draftDirty) return false; // NEW
            const draft = currentDraft(); // NEW
            const validation = validateBedTemplateDraft(draft); // NEW
            if (!validation.ok) { session.message = validation.message; renderIrrigationMode(session); return false; } // NEW
            const bom = draft.bom; // NEW
            rows.value = String(bom.rowCount); // NEW
            rowSpacing.value = formatRowSpacingDisplayValue(draft.rowSpacingCm, session.moduleCell); // NEW
            spacing.value = String(draft.emitterInches); // NEW
            runIrrigationEdit("applyBedLayout", function () { // CHANGE
                if (bom.rowCount > 0) writeBedPortConfig(bedCell, bedPortConfigFromRecipe(draft.catalog, ports, draft.inletPartId, draft.outletPartId, draft.rowPartId, bom.recipe && bom.recipe.supplyPipePartId)); // CHANGE
                const path = firstAssemblyPathForBedAssembly(session.moduleCell, bedAssembly) || { id: "assembly_bed_" + sanitizeId(getCellId(bedCell)), targetBedId: getCellId(bedCell) || "" }; // CHANGE
                commitBedTemplate(session.moduleCell, path.id, bedAssembly, { // CHANGE
                    templateId: draft.templateId, // NEW
                    templateModel: BED_TEMPLATE_MODEL_BOM, // NEW
                    recipeVersion: BED_RECIPE_VERSION, // NEW
                    irrigationType: bom.templateDef.lineKind, // CHANGE
                    inletPartId: draft.inletPartId, // NEW
                    outletPartId: draft.outletPartId, // NEW
                    rowPartId: draft.rowPartId, // NEW
                    emitterPartId: bom.recipe && bom.recipe.selfEmitting ? "" : draft.emitterPartId, // NEW
                    rowTakeoffPartId: draft.rowTakeoffPartId, // NEW
                    rowEndCapPartId: draft.rowEndCapPartId, // NEW
                    headerEndCapPartId: draft.outletPartId ? "" : draft.headerEndCapPartId, // NEW
                    supplyPipePartId: bom.recipe && bom.recipe.supplyPipePartId || "", // NEW
                    partIds: uniqueStrings([draft.inletPartId, draft.outletPartId, draft.rowPartId, draft.emitterPartId, draft.rowTakeoffPartId, draft.rowEndCapPartId, draft.headerEndCapPartId, bom.recipe && bom.recipe.supplyPipePartId]).filter(Boolean), // CHANGE
                    rowOrientation: bom.rowOrientation, // NEW
                    rowLengthMeters: bom.rowLengthMeters, // NEW
                    rowSpacingCm: draft.rowSpacingCm, // NEW
                    totalRowMeters: bom.totalRowMeters, // NEW
                    requiredParts: bom.requiredParts, // NEW
                    resolvedBomParts: bom.recipe && bom.recipe.resolvedBomParts || [], // NEW
                    anchorPartId: bom.anchorPartId, // NEW
                    demand: bom.demand, // NEW
                    assemblyLabelMode: "", // CHANGE
                    spacing: { rows: bom.rowCount, emitterInches: draft.emitterInches, rowSpacingCm: draft.rowSpacingCm } // CHANGE
                }); // NEW
                scheduleHudGraphStateSync(session.moduleCell); // CHANGE
            }); // NEW
            draftDirty = false; // NEW
            session.message = "Bed layout updated."; // NEW
            renderIrrigationMode(session); // NEW
            return true; // NEW
        } // NEW
        function markDraftAndRefresh(clearInvalidSelections) { // NEW
            if (activeIrrigationMode !== session || isIrrigationModeClosing(session)) return; // NEW
            draftDirty = true; // NEW
            refreshTemplatePreview(clearInvalidSelections); // NEW
        } // NEW
        function commitChangedSelect(clearInvalidSelections) { // NEW
            if (activeIrrigationMode !== session || isIrrigationModeClosing(session)) return; // NEW
            markDraftAndRefresh(clearInvalidSelections); // NEW
            commitBedTemplateDraft(); // NEW
        } // NEW
        function commitTextFieldOnEnter(ev) { // NEW
            if (!ev || ev.key !== "Enter") return; // NEW
            if (activeIrrigationMode !== session || isIrrigationModeClosing(session)) return; // NEW
            if (ev.preventDefault) ev.preventDefault(); // NEW
            draftDirty = true; // NEW
            refreshTemplatePreview(false); // NEW
            commitBedTemplateDraft(); // NEW
        } // NEW
        templateSelect.addEventListener("change", function () { // NEW
            const templateDef = bedTemplateById(templateSelect.value); // NEW
            const catalog = readCatalog(session.moduleCell); // NEW
            orientation.value = normalizeBedRowOrientation("", templateDef); // CHANGE
            rows.value = templateDef.defaultRows || 1; // CHANGE
            rowPart.value = templateDefaultRowPartId(catalog, templateDef); // NEW
            emitterPart.value = templateDefaultEmitterPartId(catalog, templateDef, rowPart.value); // NEW
            syncRowSpacingFromRows(); // NEW
            commitChangedSelect(true); // CHANGE
        }); // NEW
        orientation.addEventListener("change", function () { syncRowSpacingFromRows(); commitChangedSelect(false); }); // CHANGE
        rowPart.addEventListener("change", function () { emitterPart.value = templateDefaultEmitterPartId(readCatalog(session.moduleCell), bedTemplateById(templateSelect.value), rowPart.value); commitChangedSelect(true); }); // NEW
        emitterPart.addEventListener("change", function () { commitChangedSelect(false); }); // NEW
        inletPart.addEventListener("change", function () { commitChangedSelect(false); }); // NEW
        rowTakeoffPart.addEventListener("change", function () { commitChangedSelect(false); }); // NEW
        rowEndCapPart.addEventListener("change", function () { commitChangedSelect(false); }); // NEW
        headerEndCapPart.addEventListener("change", function () { commitChangedSelect(false); }); // NEW
        outletPart.addEventListener("change", function () { commitChangedSelect(false); }); // NEW
        rows.addEventListener("input", function () { syncRowSpacingFromRows(); markDraftAndRefresh(false); }); // CHANGE
        rowSpacing.addEventListener("input", function () { syncRowsFromRowSpacing(); markDraftAndRefresh(false); }); // NEW
        spacing.addEventListener("input", function () { markDraftAndRefresh(false); }); // NEW
        rows.addEventListener("blur", commitBedTemplateDraft); // NEW
        rowSpacing.addEventListener("blur", function () { syncRowsFromRowSpacing(); commitBedTemplateDraft(); }); // NEW
        spacing.addEventListener("blur", commitBedTemplateDraft); // NEW
        rows.addEventListener("keydown", commitTextFieldOnEnter); // NEW
        rowSpacing.addEventListener("keydown", function (ev) { if (ev && ev.key === "Enter") syncRowsFromRowSpacing(); commitTextFieldOnEnter(ev); }); // NEW
        spacing.addEventListener("keydown", commitTextFieldOnEnter); // NEW
        templateSection.appendChild(form); // NEW
        summary.style.overflowWrap = "anywhere"; // NEW
        summary.style.whiteSpace = "pre-line"; // NEW
        templateSection.appendChild(summary); // NEW
        if (initialBom.missingPartIds.length) templateSection.appendChild(hudWarning("Required template parts are missing from the catalog: " + initialBom.missingPartIds.join(", ") + ".")); // NEW
        refreshTemplatePreview(false); // NEW
        hud.appendChild(templateSection); // NEW
    } // NEW

    function renderAssemblyPortBadges(session, selectedCells) { // CHANGE
        allAssemblyBoundaryPortSpecs(session.moduleCell).forEach(function (spec) { renderPortBadge(session, spec.cell, spec.role, spec.index); }); // CHANGE
        renderInternalConnectionBadges(session, selectedCells); // NEW
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
        const label = cellPortDisplayLabel(session.moduleCell, cell, role); // NEW
        const badge = document.createElement("button"); // NEW
        badge.type = "button"; // NEW
        badge.className = "trellis-irrigation-port-badge trellis-irrigation-port-badge-" + visual.state; // CHANGE
        renderPortBadgeContent(badge, label, role, visual); // NEW
        badge.title = (role === "input" ? "Inlet" : "Outlet") + " " + (index + 1) + visual.titleSuffix + " (" + label + ")"; // CHANGE
        badge.style.cssText = portBadgeStyle(visual, label); // CHANGE
        positionPortBadge(badge, cell, role, index, portCapacityForCell(session.moduleCell, cell, role), label); // CHANGE
        badge.addEventListener("click", function (ev) { // NEW
            if (ev && ev.stopPropagation) ev.stopPropagation(); // NEW
            const boundary = boundaryForPort(session.moduleCell, port); // NEW
            const bedPort = isAssembly(cell) && assemblyType(cell) === "bed"; // NEW
            if (boundary) { session.inlineActionAnchorPort = normalizePort(port); session.focusedConnectionBoundary = boundary; toggleSelectedPortBoundary(session, boundary); if (bedPort) session.partPickerVisible = false; } // CHANGE
            else { session.inlineActionAnchorPort = null; session.focusedConnectionBoundary = null; toggleSelectedPort(session, port); if (bedPort) session.partPickerVisible = (session.selectedPorts || []).map(portKey).indexOf(portKey(port)) >= 0 && isPortFree(session.moduleCell, port); } // CHANGE
            session.bridgePorts = null; // NEW
            selectCell(findAssemblyAncestor(cell) || cell, false); // NEW
            renderIrrigationMode(session); // NEW
        }); // NEW
        appendOverlayNode(badge); // NEW
        session.portBadges.push(badge); // NEW
        if (session.portBadgeNodeByKey) session.portBadgeNodeByKey.set(portKey(port), badge); // NEW
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

    function renderPortBadgeContent(badge, label, role, visual) { // NEW
        const text = document.createElement("span"); // NEW
        text.className = "trellis-irrigation-port-badge-label"; // NEW
        text.textContent = label; // NEW
        text.style.cssText = "display:block;line-height:" + PORT_BADGE_SIZE + "px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"; // NEW
        const cue = document.createElement("span"); // NEW
        cue.className = "trellis-irrigation-port-badge-arrow trellis-irrigation-port-badge-arrow-" + role; // NEW
        cue.setAttribute("aria-hidden", "true"); // NEW
        cue.style.cssText = portBadgeArrowStyle(role, visual); // NEW
        badge.appendChild(text); // NEW
        badge.appendChild(cue); // NEW
    } // NEW

    function portBadgeWidthForLabel(label) { // NEW
        return Math.max(PORT_BADGE_MIN_WIDTH, Math.min(PORT_BADGE_MAX_WIDTH, String(label || "").length * 6 + 14)); // NEW
    } // NEW

    function portBadgeArrowStyle(role, visual) { // NEW
        const color = visual && visual.state === "compatible" ? "#16a34a" : visual && visual.state === "selected" ? "#1d4ed8" : "#475569"; // NEW
        const base = "position:absolute;left:50%;width:0;height:0;margin-left:-" + PORT_BADGE_ARROW_SIZE + "px;border-left:" + PORT_BADGE_ARROW_SIZE + "px solid transparent;border-right:" + PORT_BADGE_ARROW_SIZE + "px solid transparent;pointer-events:none;"; // NEW
        return role === "input" ? base + "bottom:-" + PORT_BADGE_ARROW_SIZE + "px;border-top:" + PORT_BADGE_ARROW_SIZE + "px solid " + color + ";" : base + "top:-" + PORT_BADGE_ARROW_SIZE + "px;border-bottom:" + PORT_BADGE_ARROW_SIZE + "px solid " + color + ";"; // NEW
    } // NEW

    function portBadgeStyle(visual, label) { // NEW
        const styles = { // NEW
            selected: { border: "3px solid #1d4ed8", background: "#dbeafe", shadow: "0 0 0 3px rgba(29,78,216,.22),0 2px 7px rgba(0,0,0,.24)", color: "#0f172a" }, // NEW
            compatible: { border: "2px solid #16a34a", background: "#dcfce7", shadow: "0 0 0 3px rgba(22,163,74,.20),0 1px 5px rgba(0,0,0,.18)", color: "#14532d" }, // NEW
            occupied: { border: "1px solid #2563eb", background: "#dbeafe", shadow: "0 1px 4px rgba(0,0,0,.18)", color: "#1e3a8a" }, // NEW
            normal: { border: "1px solid #555", background: "#fff", shadow: "0 1px 4px rgba(0,0,0,.18)", color: "#111" } // NEW
        }; // NEW
        const s = styles[visual.state] || styles.normal; // NEW
        return "position:absolute;z-index:1002;width:" + portBadgeWidthForLabel(label) + "px;height:" + PORT_BADGE_SIZE + "px;padding:0 5px;border:" + s.border + ";border-radius:4px;background:" + s.background + ";box-shadow:" + s.shadow + ";color:" + s.color + ";font:bold 10px Arial,sans-serif;cursor:pointer;box-sizing:border-box;overflow:visible;"; // CHANGE
    } // NEW

    function positionPortBadge(node, cell, role, index, count, label) { // CHANGE
        const state = cellState(cell); // NEW
        const total = Math.max(1, Math.floor(finiteNumber(count, 1))); // NEW
        const slot = (index + 1) / (total + 1); // NEW
        const x = state.x + state.width * slot - portBadgeWidthForLabel(label) / 2; // CHANGE
        const y = role === "input" ? state.y - PORT_BADGE_SIZE - 4 : state.y + state.height + 4; // CHANGE
        node.style.left = Math.round(x) + "px"; // NEW
        node.style.top = Math.round(y) + "px"; // NEW
    } // NEW

    function toggleSelectedPort(session, port) { // NEW
        const key = portKey(port); // NEW
        const current = selectedValidPorts(session); // CHANGE
        const existing = current.map(portKey).indexOf(key); // CHANGE
        if (existing >= 0) current.splice(existing, 1); // CHANGE
        else { clearSelectedConnectionBoundaries(session); while (current.length >= 2) current.shift(); current.push(normalizePort(port)); } // CHANGE
        session.selectedPorts = current; // NEW
    } // NEW

    function renderInternalConnectionBadges(session, selectedCells) { // NEW
        internalConnectionBoundariesForSelection(session.moduleCell, selectedCells).forEach(function (entry) { // NEW
            const badge = document.createElement("button"); // NEW
            const selected = selectedValidBoundaries(session).map(boundaryKey).indexOf(boundaryKey(entry.boundary)) >= 0; // NEW
            const label = internalConnectionDisplayLabel(session.moduleCell, entry.upstream, entry.downstream); // NEW
            badge.type = "button"; // NEW
            badge.className = "trellis-irrigation-internal-connection-badge" + (selected ? " trellis-irrigation-internal-connection-badge-selected" : ""); // NEW
            badge.textContent = "C"; // CHANGE
            badge.title = "Internal connection " + label + ": " + irrigationCellLabel(entry.upstream) + " to " + irrigationCellLabel(entry.downstream); // CHANGE
            badge.style.cssText = internalConnectionBadgeStyle(selected); // CHANGE
            positionInternalConnectionBadge(badge, entry.upstream, entry.downstream); // CHANGE
            badge.addEventListener("click", function (ev) { // NEW
                if (ev && ev.stopPropagation) ev.stopPropagation(); // NEW
                session.inlineActionAnchorPort = null; // NEW
                session.focusedConnectionBoundary = selected ? null : entry.boundary; // NEW
                toggleSelectedBoundary(session, entry.boundary); // NEW
                session.bridgePorts = null; // NEW
                selectCell(entry.assembly, false); // NEW
                renderIrrigationMode(session); // NEW
            }); // NEW
            appendOverlayNode(badge); // NEW
            session.portBadges.push(badge); // NEW
            if (session.connectionBadgeNodeByKey) session.connectionBadgeNodeByKey.set(boundaryKey(entry.boundary), badge); // NEW
        }); // NEW
    } // NEW

    function renderSelectedExternalPipeHighlights(session) { // NEW
        selectedValidBoundaries(session).forEach(function (boundary) { // NEW
            const edge = boundary.type === "edge" ? findCellById(session.moduleCell, boundary.edgeId) : null; // NEW
            if (!edge || getCellAttr(edge, ATTRS.PIPE_EDGE, "") !== "1") return; // NEW
            const highlight = createPipeEdgeHighlight(edge); // NEW
            if (!highlight) return; // NEW
            appendOverlayNode(highlight); // NEW
            session.targetHighlights.push(highlight); // NEW
        }); // NEW
    } // NEW

    function createPipeEdgeHighlight(edge) { // NEW
        const points = edgeAbsolutePoints(edge); // NEW
        if (points.length >= 2) return createPipePolylineHighlight(edge, points); // NEW
        return createPipeBoundsHighlight(edge); // NEW
    } // NEW

    function pipeHighlightStrokeWidth(edge) { // NEW
        return Math.max(7, finiteNumber(styleValue(edge && edge.style, "strokeWidth"), 3) + 4); // NEW
    } // NEW

    function edgeAbsolutePoints(edge) { // NEW
        const state = graph.view && graph.view.getState ? graph.view.getState(edge) : null; // NEW
        const raw = state && Array.isArray(state.absolutePoints) ? state.absolutePoints : []; // NEW
        return raw.map(function (point) { return point ? { x: finiteNumber(point.x, 0), y: finiteNumber(point.y, 0) } : null; }).filter(Boolean); // NEW
    } // NEW

    function createPipePolylineHighlight(edge, points) { // NEW
        const highlightWidth = pipeHighlightStrokeWidth(edge); // NEW
        const bounds = pointBounds(points, highlightWidth + 1); // CHANGE
        const svg = document.createElementNS ? document.createElementNS("http://www.w3.org/2000/svg", "svg") : document.createElement("div"); // NEW
        if (svg.setAttribute) svg.setAttribute("class", "trellis-irrigation-selected-pipe-highlight"); // CHANGE
        if (svg.setAttribute) svg.setAttribute("data-edge-id", getCellId(edge) || ""); // NEW
        svg.style.cssText = "position:absolute;z-index:999;left:" + Math.round(bounds.x) + "px;top:" + Math.round(bounds.y) + "px;width:" + Math.round(bounds.width) + "px;height:" + Math.round(bounds.height) + "px;pointer-events:none;overflow:visible;"; // NEW
        if (!document.createElementNS) return svg; // NEW
        const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline"); // NEW
        line.setAttribute("points", points.map(function (point) { return (point.x - bounds.x) + "," + (point.y - bounds.y); }).join(" ")); // NEW
        line.setAttribute("fill", "none"); // NEW
        line.setAttribute("stroke", "#f59e0b"); // NEW
        line.setAttribute("stroke-width", formatStyleNumber(highlightWidth)); // CHANGE
        line.setAttribute("stroke-linecap", "round"); // NEW
        line.setAttribute("stroke-linejoin", "round"); // NEW
        line.setAttribute("opacity", ".72"); // NEW
        svg.appendChild(line); // NEW
        return svg; // NEW
    } // NEW

    function createPipeBoundsHighlight(edge) { // NEW
        const state = cellState(edge); // NEW
        const width = Math.max(12, finiteNumber(state.width, 0)); // NEW
        const height = Math.max(12, finiteNumber(state.height, 0)); // NEW
        const borderWidth = Math.max(3, Math.ceil(pipeHighlightStrokeWidth(edge) / 2)); // NEW
        const node = document.createElement("div"); // NEW
        node.className = "trellis-irrigation-selected-pipe-highlight"; // NEW
        node.setAttribute("data-edge-id", getCellId(edge) || ""); // NEW
        node.style.cssText = "position:absolute;z-index:999;left:" + Math.round(finiteNumber(state.x, 0) - borderWidth - 1) + "px;top:" + Math.round(finiteNumber(state.y, 0) - borderWidth - 1) + "px;width:" + Math.round(width + (borderWidth + 1) * 2) + "px;height:" + Math.round(height + (borderWidth + 1) * 2) + "px;pointer-events:none;border:" + borderWidth + "px solid #f59e0b;border-radius:6px;box-shadow:0 0 0 3px rgba(245,158,11,.20);box-sizing:border-box;"; // CHANGE
        return node; // NEW
    } // NEW

    function pointBounds(points, padding) { // NEW
        const pad = Math.max(0, finiteNumber(padding, 0)); // NEW
        const xs = points.map(function (point) { return point.x; }); // NEW
        const ys = points.map(function (point) { return point.y; }); // NEW
        const minX = Math.min.apply(Math, xs) - pad; // NEW
        const minY = Math.min.apply(Math, ys) - pad; // NEW
        const maxX = Math.max.apply(Math, xs) + pad; // NEW
        const maxY = Math.max.apply(Math, ys) + pad; // NEW
        return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) }; // NEW
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
        return "position:absolute;z-index:1003;width:" + portBadgeWidthForLabel("C") + "px;height:" + PORT_BADGE_SIZE + "px;padding:0 5px;border:" + border + ";border-radius:4px;background:" + background + ";box-shadow:" + shadow + ";color:#3b0764;font:bold 10px/" + PORT_BADGE_SIZE + "px Arial,sans-serif;cursor:pointer;box-sizing:border-box;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"; // CHANGE
    } // NEW

    function positionInternalConnectionBadge(node, upstream, downstream) { // NEW
        const up = cellState(upstream); // NEW
        const down = cellState(downstream); // NEW
        const x = Math.max(finiteNumber(up.x, 0) + finiteNumber(up.width, 0), finiteNumber(down.x, 0) + finiteNumber(down.width, 0)) + 4; // CHANGE
        const y = (up.y + up.height + down.y) / 2 - PORT_BADGE_SIZE / 2; // NEW
        node.style.left = Math.round(x) + "px"; // NEW
        node.style.top = Math.round(y) + "px"; // NEW
    } // NEW

    function reverseAssembly(assembly) { // NEW
        if (activeIrrigationEditDepth === 0) return runIrrigationEdit("reverseAssembly", function () { return reverseAssembly(assembly); }); // NEW
        const moduleCell = findGardenModuleAncestor(assembly); // NEW
        if (!assembly || !assemblyCanReverse(moduleCell, assembly)) return; // CHANGE
        const parts = assemblyPartCells(assembly); // NEW
        const ys = parts.map(function (cell) { return finiteNumber((getGeometry(cell) || {}).y, 0); }).sort(function (a, b) { return a - b; }); // NEW
        model.beginUpdate && model.beginUpdate(); // NEW
        try { // NEW
            parts.forEach(function (cell, index) { setGeometry(cell, { y: ys[ys.length - 1 - index] }); }); // NEW
        } finally { model.endUpdate && model.endUpdate(); } // NEW
        scheduleHudGraphStateSync(moduleCell); // NEW
    } // NEW

    function assemblyCanReverse(moduleCell, assembly) { // NEW
        if (!assembly || connectedAssembly(assembly)) return false; // NEW
        const cells = assemblyType(assembly) === "bed" ? [assembly] : assemblyPartCells(assembly); // NEW
        return !cells.some(function (cell) { return portCapacityForCell(moduleCell, cell, "output") > 1; }); // NEW
    } // NEW

    function selectedAssemblyPartCells(selected) { // NEW
        const seen = new Set(); // NEW
        const out = []; // NEW
        (selected || []).forEach(function (cell) { // NEW
            if (!isAssemblyPartCell(cell)) return; // NEW
            const id = getCellId(cell); // NEW
            if (id && seen.has(id)) return; // NEW
            if (id) seen.add(id); // NEW
            out.push(cell); // NEW
        }); // NEW
        return out; // NEW
    } // NEW

    function lifecycleTargetStates(moduleCell, targets) { // CHANGE
        const states = new Set(); // NEW
        (targets.partCells || []).forEach(function (cell) { states.add(partStateForCell(cell)); }); // NEW
        (targets.pipeEdges || []).forEach(function (edge) { states.add(partStateForCell(edge)); }); // NEW
        (targets.bedAssemblies || []).forEach(function (assembly) { states.add(partStateForRecord(readBedAssemblyTemplateRecord(moduleCell, assembly))); }); // CHANGE
        return states; // NEW
    } // NEW

    function lifecycleTargetsForSelection(moduleCell, selected) { // NEW
        const partCells = []; // NEW
        const pipeEdges = []; // NEW
        const bedAssemblies = []; // NEW
        const seenParts = new Set(); // NEW
        const seenEdges = new Set(); // NEW
        const seenBeds = new Set(); // NEW
        function pushPart(cell) { const id = getCellId(cell); if (!isLifecyclePartTargetCell(cell) || id && seenParts.has(id)) return; if (id) seenParts.add(id); partCells.push(cell); } // CHANGE
        function pushPipe(edge) { const id = getCellId(edge); if (!edge || getCellAttr(edge, ATTRS.PIPE_EDGE, "") !== "1" || id && seenEdges.has(id)) return; if (id) seenEdges.add(id); pipeEdges.push(edge); } // NEW
        function pushBed(assembly) { const id = getCellId(assembly); if (!isBedAssembly(assembly) || id && seenBeds.has(id)) return; if (id) seenBeds.add(id); bedAssemblies.push(assembly); } // NEW
        (selected || []).forEach(function (cell) { // NEW
            if (isBedAssembly(cell)) { pushBed(cell); return; } // NEW
            if (isAssembly(cell)) { assemblyPartCells(cell).forEach(pushPart); externalEdgesForAssemblyCell(moduleCell, cell).forEach(pushPipe); return; } // NEW
            if (isLifecyclePartTargetCell(cell)) { pushPart(cell); return; } // CHANGE
            if (getCellAttr(cell, ATTRS.PIPE_EDGE, "") === "1") pushPipe(cell); // NEW
        }); // NEW
        return { partCells, pipeEdges, bedAssemblies, count: partCells.length + pipeEdges.length + bedAssemblies.length }; // NEW
    } // NEW

    function markIrrigationSelectionState(session, selected, state) { // NEW
        const normalized = normalizePartState(state); // NEW
        const changed = runIrrigationEdit("markIrrigationPartState", function () { // NEW
            const targets = lifecycleTargetsForSelection(session.moduleCell, selected); // NEW
            let didChange = false; // NEW
            model.beginUpdate && model.beginUpdate(); // NEW
            try { // NEW
                targets.partCells.forEach(function (cell) { didChange = setPartCellState(cell, normalized) || didChange; }); // NEW
                targets.pipeEdges.forEach(function (edge) { didChange = setPipeEdgeState(edge, normalized) || didChange; }); // NEW
                targets.bedAssemblies.forEach(function (assembly) { didChange = setBedTemplatePartState(session.moduleCell, assembly, normalized) || didChange; }); // NEW
            } finally { model.endUpdate && model.endUpdate(); } // NEW
            if (didChange) scheduleHudGraphStateSync(session.moduleCell); // NEW
            return didChange; // NEW
        }); // NEW
        session.message = changed ? "Marked irrigation parts " + normalized + "." : "No irrigation parts changed."; // NEW
        renderIrrigationMode(session); // NEW
    } // NEW

    function setBedTemplatePartState(moduleCell, bedAssembly, state) { // NEW
        const record = readBedAssemblyTemplateRecord(moduleCell, bedAssembly); // NEW
        if (!record) return false; // NEW
        const normalized = normalizePartState(state); // NEW
        const next = Object.assign({}, record, { partState: normalized }); // NEW
        let changed = JSON.stringify(next) !== JSON.stringify(record) ? setCellAttrs(bedAssembly, { [ATTRS.BED_TEMPLATE_JSON]: JSON.stringify(next) }) : false; // NEW
        changed = refreshBedAssemblyRowsFromTemplate(moduleCell, bedAssembly, bedCellForAssembly(moduleCell, bedAssembly), next) || changed; // NEW
        return changed; // NEW
    } // NEW

    function deleteAssemblySelection(session, selected) { // NEW
        if (activeIrrigationEditDepth === 0) return runIrrigationEdit("deleteAssemblySelection", function () { return deleteAssemblySelection(session, selected); }); // NEW
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
        const zones = ZoneModel.sync(session.moduleCell); // CHANGE
        const resolved = ZoneModel.resolveMembership(session.moduleCell, zones); // CHANGE
        const bedIds = bedAssemblies.map(getCellId).filter(Boolean); // NEW
        const zoneIds = uniqueStrings(bedIds.map(function (id) { const entry = resolved.assignment.get(id); return entry && entry.zoneId || ""; }).filter(Boolean)); // NEW
        const current = zoneIds.length === 1 ? zones.find(function (zone) { return zone.id === zoneIds[0]; }) : null; // NEW
        const wrap = hudSection("Zone"); // CHANGE
        wrap.className += " trellis-irrigation-zone-controls"; // CHANGE
        wrap.appendChild(hudText("Zone: " + (zoneIds.length === 0 ? "Unzoned" : (zoneIds.length > 1 ? "Mixed" : ZoneModel.displayName(session.moduleCell, current))))); // CHANGE
        const select = document.createElement("select"); // NEW
        select.className = "trellis-irrigation-zone-picker"; // NEW
        appendSelectOption(select, "", "Assign to zone..."); // NEW
        zones.forEach(function (zone) { appendSelectOption(select, zone.id, ZoneModel.displayName(session.moduleCell, zone)); }); // CHANGE
        select.addEventListener("change", function () { // NEW
            if (!select.value) return; // NEW
            runIrrigationEdit("assignZone", function () { ZoneModel.assignBeds(session.moduleCell, select.value, bedIds); HudController.syncGraphState(session.moduleCell); }); // CHANGE
            session.message = "Zone assignment updated."; // NEW
            renderIrrigationMode(session); // NEW
        }); // NEW
        wrap.appendChild(select); // NEW
        const actions = hudActions(); // NEW
        actions.appendChild(button("Edit Zones", function () { openZoneManager(session.moduleCell, session); })); // NEW
        actions.appendChild(button("Reset Zone", function () { // NEW
            runIrrigationEdit("resetZone", function () { ZoneModel.resetBedOverrides(session.moduleCell, bedIds); HudController.syncGraphState(session.moduleCell); }); // CHANGE
            session.message = "Zone overrides reset."; // NEW
            renderIrrigationMode(session); // NEW
        })); // NEW
        wrap.appendChild(actions); // CHANGE
        hud.appendChild(wrap); // NEW
    } // NEW

    function openZoneManager(moduleCell, session) { // NEW
        const state = {}; // NEW
        const div = document.createElement("div"); // NEW
        div.className = "trellis-irrigation-zone-manager"; // NEW
        div.style.cssText = "width:880px;max-width:96vw;max-height:84vh;overflow:auto;font:12px Arial,sans-serif;padding:12px;"; // NEW
        showDialog(div, 900, 620); // NEW
        renderZoneManager(div, moduleCell, state, session); // NEW
    } // NEW

    function renderZoneManager(container, moduleCell, state, session) { // NEW
        const zones = ZoneModel.sync(moduleCell); // CHANGE
        const report = ZoneModel.summary(moduleCell, zones, ReportModel.deriveAssemblyPaths(moduleCell)); // CHANGE
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
            const zone = zones.find(function (item) { return item.id === detail.id; }) || ZoneModel.normalize({ id: detail.id }); // CHANGE
            const tr = document.createElement("tr"); // NEW
            const nameTd = document.createElement("td"); // NEW
            const alias = document.createElement("input"); // NEW
            alias.value = zone.alias || ""; // NEW
            alias.placeholder = ZoneModel.displayName(moduleCell, zone); // CHANGE
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
            actionsTd.appendChild(button("Save", function () { runIrrigationEdit("saveZoneAlias", function () { ZoneModel.updateAlias(moduleCell, zone.id, alias.value); HudController.syncGraphState(moduleCell); }); renderZoneManager(container, moduleCell, state, session); if (session) renderIrrigationMode(session); })); // CHANGE
            actionsTd.appendChild(button("Reset", function () { runIrrigationEdit("resetZoneOverrides", function () { ZoneModel.resetZoneOverrides(moduleCell, zone.id); HudController.syncGraphState(moduleCell); }); renderZoneManager(container, moduleCell, state, session); if (session) renderIrrigationMode(session); })); // CHANGE
            detail.memberBedIds.forEach(function (bedId) { // NEW
                actionsTd.appendChild(button("Reset " + bedAssemblyLabel(moduleCell, findCellById(moduleCell, bedId)), function () { runIrrigationEdit("resetBedZoneOverride", function () { ZoneModel.resetBedOverrides(moduleCell, [bedId]); HudController.syncGraphState(moduleCell); }); renderZoneManager(container, moduleCell, state, session); if (session) renderIrrigationMode(session); })); // CHANGE
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
        controls.appendChild(button("New Manual Zone", function () { runIrrigationEdit("newManualZone", function () { ZoneModel.createManual(moduleCell, "Manual Zone", []); HudController.syncGraphState(moduleCell); }); renderZoneManager(container, moduleCell, state, session); if (session) renderIrrigationMode(session); })); // CHANGE
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

    function appendIrrigationHudHeader(hud, session, titleContent, options) { // NEW
        const opts = options || {}; // NEW
        const header = document.createElement("div"); // NEW
        header.className = "trellis-irrigation-hud-header"; // NEW
        header.style.cssText = "display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:start;border-bottom:1px solid #e5e7eb;padding-bottom:6px;margin-bottom:2px;min-width:0;max-width:100%;box-sizing:border-box;"; // NEW
        const title = document.createElement("div"); // NEW
        title.className = "trellis-irrigation-hud-header-title"; // NEW
        title.style.cssText = "font-weight:700;min-width:0;max-width:100%;box-sizing:border-box;overflow:hidden;text-overflow:ellipsis;"; // NEW
        if (titleContent && titleContent.nodeType) title.appendChild(titleContent); // NEW
        else title.textContent = String(titleContent == null ? "" : titleContent); // NEW
        const actions = document.createElement("div"); // NEW
        actions.className = "trellis-irrigation-hud-header-actions"; // NEW
        actions.style.cssText = "display:flex;align-items:flex-start;justify-content:flex-end;gap:4px;flex-wrap:wrap;min-width:0;max-width:100%;box-sizing:border-box;"; // NEW
        appendHeaderLifecycleToggle(actions, session, opts.selected || []); // NEW
        if (Array.isArray(opts.bomPartIds)) { // NEW
            const bom = compactHudButton("BOM", function () { // NEW
                if (opts.syncBeforeBom) runIrrigationEdit("bomSync", function () { syncHudGraphState(session.moduleCell); }); // NEW
                openBomDialog(session.moduleCell, { selectedPartIds: opts.bomPartIds }); // NEW
            }); // NEW
            actions.appendChild(bom); // NEW
        } // NEW
        actions.appendChild(compactHudButton("Catalog", function () { openCatalogManager(session.moduleCell); })); // NEW
        const exit = exitIrrigationButton(); // NEW
        styleCompactHudButton(exit); // NEW
        exit.className = (exit.className || "") + " trellis-irrigation-hud-exit-button"; // NEW
        exit.style.borderColor = "#b91c1c"; // NEW
        exit.style.color = "#b91c1c"; // NEW
        actions.appendChild(exit); // NEW
        header.appendChild(title); // NEW
        header.appendChild(actions); // NEW
        hud.appendChild(header); // NEW
        return header; // NEW
    } // NEW

    function compactHudButton(label, fn) { // NEW
        const b = button(label, fn); // NEW
        styleCompactHudButton(b); // NEW
        return b; // NEW
    } // NEW

    function styleCompactHudButton(b) { // NEW
        b.style.padding = "3px 6px"; // NEW
        b.style.font = "12px Arial,sans-serif"; // NEW
        b.style.whiteSpace = "nowrap"; // NEW
        b.style.overflowWrap = "normal"; // NEW
        b.style.border = b.style.border || "1px solid #c7c7cc"; // NEW
        b.style.borderRadius = "4px"; // NEW
        b.style.background = b.style.background || "#fff"; // NEW
        return b; // NEW
    } // NEW

    function appendHeaderLifecycleToggle(parent, session, selected) { // NEW
        const targets = lifecycleTargetsForSelection(session.moduleCell, selected); // NEW
        if (!targets.count) return null; // NEW
        const states = lifecycleTargetStates(session.moduleCell, targets); // NEW
        const plannedOnly = states.size === 1 && states.has(PART_STATE_PLANNED); // NEW
        const completedOnly = states.size === 1 && states.has(PART_STATE_COMPLETED); // NEW
        const group = document.createElement("div"); // NEW
        group.className = "trellis-irrigation-lifecycle-toggle"; // NEW
        group.style.cssText = "display:inline-flex;align-items:center;gap:0;border:1px solid #c7c7cc;border-radius:4px;overflow:hidden;box-sizing:border-box;"; // NEW
        const planned = compactHudButton("Planned", function () { markIrrigationSelectionState(session, selected, PART_STATE_PLANNED); }); // NEW
        const completed = compactHudButton("Completed", function () { markIrrigationSelectionState(session, selected, PART_STATE_COMPLETED); }); // NEW
        styleLifecycleSegment(planned, plannedOnly); // NEW
        styleLifecycleSegment(completed, completedOnly); // NEW
        planned.setAttribute("aria-pressed", plannedOnly ? "true" : "false"); // NEW
        completed.setAttribute("aria-pressed", completedOnly ? "true" : "false"); // NEW
        group.appendChild(planned); // NEW
        group.appendChild(completed); // NEW
        parent.appendChild(group); // NEW
        return group; // NEW
    } // NEW

    function styleLifecycleSegment(buttonNode, active) { // NEW
        buttonNode.style.border = "0"; // NEW
        buttonNode.style.borderRadius = "0"; // NEW
        buttonNode.style.background = active ? "#e8f5e9" : "#fff"; // NEW
        buttonNode.style.color = active ? "#166534" : "#374151"; // NEW
        buttonNode.style.fontWeight = active ? "700" : "400"; // NEW
    } // NEW

    function hudSection(titleText) { // NEW
        const section = document.createElement("div"); // NEW
        section.className = "trellis-irrigation-hud-section"; // NEW
        section.style.cssText = "display:grid;gap:6px;border-top:1px solid #ddd;padding-top:6px;margin-top:6px;min-width:0;max-width:100%;box-sizing:border-box;overflow:hidden;"; // CHANGE
        const title = document.createElement("div"); // NEW
        title.className = "trellis-irrigation-hud-section-title"; // NEW
        title.style.cssText = "font-weight:700;min-width:0;max-width:100%;box-sizing:border-box;overflow:hidden;text-overflow:ellipsis;"; // CHANGE
        title.textContent = titleText; // NEW
        section.appendChild(title); // NEW
        return section; // NEW
    } // NEW

    function hudText(text) { // NEW
        const div = document.createElement("div"); // NEW
        div.style.cssText = "margin:6px 0;color:#333;line-height:1.35;min-width:0;max-width:100%;box-sizing:border-box;overflow-wrap:anywhere;"; // CHANGE
        div.textContent = text; // NEW
        return div; // NEW
    } // NEW

    function hudWarning(text) { // NEW
        const div = document.createElement("div"); // NEW
        div.className = "trellis-irrigation-hud-warning"; // NEW
        div.style.cssText = "margin:6px 0;color:#8a4b00;line-height:1.35;min-width:0;max-width:100%;box-sizing:border-box;overflow-wrap:anywhere;"; // CHANGE
        div.textContent = text; // NEW
        return div; // NEW
    } // NEW

    function hudActions() { // NEW
        const div = document.createElement("div"); // NEW
        div.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;min-width:0;max-width:100%;box-sizing:border-box;overflow:hidden;"; // CHANGE
        return div; // NEW
    } // NEW

    function appendHudDangerAction(hud, label, fn) { // NEW
        const wrap = document.createElement("div"); // NEW
        wrap.className = "trellis-irrigation-danger-actions"; // NEW
        wrap.style.cssText = "display:flex;justify-content:flex-end;gap:6px;border-top:1px solid #f1d5d5;padding-top:6px;margin-top:6px;min-width:0;max-width:100%;box-sizing:border-box;"; // NEW
        const danger = button(label, fn); // NEW
        danger.className = (danger.className || "") + " trellis-irrigation-danger-button"; // NEW
        danger.style.padding = "4px 7px"; // NEW
        danger.style.border = "1px solid #b91c1c"; // NEW
        danger.style.borderRadius = "4px"; // NEW
        danger.style.background = "#fff"; // NEW
        danger.style.color = "#b91c1c"; // NEW
        danger.style.whiteSpace = "nowrap"; // NEW
        danger.style.overflowWrap = "normal"; // NEW
        wrap.appendChild(danger); // NEW
        hud.appendChild(wrap); // NEW
        return danger; // NEW
    } // NEW

    function appendLocalDeleteAction(session, hud, selected, selectedParts, selectedAssemblies) { // NEW
        const parts = selectedParts || []; // NEW
        const assemblies = selectedAssemblies || []; // NEW
        if (!parts.length && !assemblies.length) return false; // NEW
        const mixed = parts.length > 0 && assemblies.length > 0; // NEW
        const label = mixed || parts.length + assemblies.length > 1 ? "Delete Selection" : (parts.length ? "Delete Part" : "Delete Assembly"); // NEW
        const targets = mixed ? selected : (parts.length ? parts : assemblies); // NEW
        appendHudDangerAction(hud, label, function () { deleteAssemblySelection(session, targets); }); // NEW
        return true; // NEW
    } // NEW

    function appendHudActionSection(parent, titleText, actions) { // NEW
        if (!actions || !actions.childNodes || !actions.childNodes.length) return null; // NEW
        const section = hudSection(titleText); // NEW
        section.className += " trellis-irrigation-action-section"; // NEW
        actions.style.marginTop = "0"; // NEW
        section.appendChild(actions); // NEW
        parent.appendChild(section); // NEW
        return section; // NEW
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
        const zones = ZoneModel.sync(session.moduleCell); // CHANGE
        const resolved = ZoneModel.resolveMembership(session.moduleCell, zones); // CHANGE
        resolved.assignment.forEach(function (entry, bedAssemblyId) { // NEW
            const bedAssembly = findCellById(session.moduleCell, bedAssemblyId); // NEW
            const zone = zones.find(function (item) { return item.id === entry.zoneId; }); // NEW
            if (!bedAssembly || !zone) return; // NEW
            const badge = document.createElement("div"); // NEW
            badge.className = "trellis-irrigation-zone-badge"; // NEW
            badge.title = "Zone: " + ZoneModel.displayName(session.moduleCell, zone); // CHANGE
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
            nav.style.cssText = "position:absolute;z-index:1004;width:22px;height:22px;padding:0;border:1px solid #777;border-radius:4px;background:#fff;cursor:pointer;font:12px Arial,sans-serif;"; // NEW
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
            const partCells = routeBomPartCells(route.cells); // NEW
            const partIds = partCells.map(function (cell) { return getCellAttr(cell, ATTRS.CATALOG_PART_ID, ""); }).filter(Boolean); // CHANGE
            const partStates = partCells.map(partStateForCell); // NEW
            const branchIds = route.cells.filter(function (cell) { return BRANCH_CATEGORIES.has(getCellAttr(cell, ATTRS.COMPONENT_TYPE, "")); }).map(getCellId).filter(Boolean); // NEW
            const pipeIds = route.edges.map(getCellId).filter(Boolean); // NEW
            const pipePartStates = route.edges.map(partStateForCell); // NEW
            const path = stagePath({ // NEW
                id: "hud_" + sanitizeId(getCellId(route.source) + "_" + getCellId(bedEndpoint)), // NEW
                sourceEndpoint: route.source, // NEW
                targetEndpoint: bedEndpoint, // NEW
                targetBedId: getCellId(bedCell) || "", // NEW
                branchpointIds: branchIds, // NEW
                partIds, // NEW
                partStates, // NEW
                pipePartId: getCellAttr(route.edges[0], ATTRS.PIPE_PART_ID, "") // NEW
            }); // NEW
            path.componentCellIds = partCells.map(getCellId).filter(Boolean); // CHANGE
            path.pipeEdgeIds = pipeIds; // NEW
            path.pipePartStates = pipePartStates; // NEW
            path.hydraulic = Hydraulics.calculatePath(moduleCell, path); // CHANGE
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

    function routeBomPartCells(cells) { // NEW
        return (cells || []).filter(function (cell) { // NEW
            return !!getCellAttr(cell, ATTRS.CATALOG_PART_ID, "") && (getCellAttr(cell, ATTRS.COMPONENT, "") === "1" || endpointType(cell) === "branchpoint"); // NEW
        }); // NEW
    } // NEW

    function deriveAssemblyPaths(moduleCell) { // NEW
        const paths = []; // NEW
        collectDescendants(moduleCell, function (cell) { return isAssembly(cell) && assemblyType(cell) === "bed"; }).forEach(function (bedEndpoint) { // CHANGE
            const route = routeAssemblyToSource(moduleCell, bedEndpoint); // CHANGE
            if (!route) return; // CHANGE
            const bedAssembly = bedEndpoint; // CHANGE
            const bedCell = bedCellForAssembly(moduleCell, bedAssembly); // NEW
            const linkedBedId = getCellId(bedCell) || getCellAttr(bedAssembly, ATTRS.LINKED_BED_ID, getCellId(bedAssembly) || ""); // CHANGE
            const partCells = routeBomPartCells(route.cells); // NEW
            const partIds = partCells.map(function (cell) { return getCellAttr(cell, ATTRS.CATALOG_PART_ID, ""); }).filter(Boolean); // CHANGE
            const partStates = partCells.map(partStateForCell); // NEW
            const pipeEdges = route.edges.filter(function (edge) { return getCellAttr(edge, ATTRS.PIPE_EDGE, "") === "1"; }); // NEW
            const pipeIds = pipeEdges.map(getCellId).filter(Boolean); // CHANGE
            const pipePartIds = pipeEdges.map(function (edge) { return getCellAttr(edge, ATTRS.PIPE_PART_ID, ""); }).filter(Boolean); // CHANGE
            const pipePartStates = pipeEdges.map(partStateForCell); // NEW
            const pipeSegments = pipeEdges.map(function (edge) { return { edgeId: getCellId(edge) || "", pipePartId: getCellAttr(edge, ATTRS.PIPE_PART_ID, ""), partState: partStateForCell(edge), lengthFt: measuredEdgeLengthFeet(edge) }; }).filter(function (segment) { return !!segment.pipePartId; }); // CHANGE
            const path = makeDerivedAssemblyPath({ // CHANGE
                id: "assembly_" + sanitizeId((getCellId(route.source) || "disconnected") + "_" + getCellId(bedEndpoint)), // CHANGE
                sourceEndpoint: route.source, // NEW
                targetEndpoint: bedEndpoint, // NEW
                targetBedId: linkedBedId, // NEW
                branchpointIds: route.cells.filter(function (cell) { return BRANCH_CATEGORIES.has(getCellAttr(cell, ATTRS.COMPONENT_TYPE, "")); }).map(getCellId).filter(Boolean), // NEW
                partIds, // NEW
                partStates, // NEW
                pipePartId: pipePartIds[0] || "", // CHANGE
                pipeSegments // CHANGE
            }); // NEW
            path.componentCellIds = partCells.map(getCellId).filter(Boolean); // CHANGE
            path.pipeEdgeIds = pipeIds; // NEW
            path.pipePartIds = pipePartIds; // NEW
            path.pipePartStates = pipePartStates; // NEW
            path.disconnectedFromSource = !!route.disconnectedFromSource; // NEW
            path.routeWarnings = route.disconnectedFromSource ? [DISCONNECTED_SOURCE_WARNING] : []; // NEW
            const template = readBedAssemblyTemplateRecord(moduleCell, bedAssembly); // CHANGE
            if (template) { // NEW
                path.bedTemplateCommitted = true; // NEW
                path.bedTemplate = template; // NEW
                path.bedDemand = Hydraulics.cumulativeBedDemand(moduleCell, bedAssembly); // CHANGE
            } // NEW
            path.hydraulic = Hydraulics.calculatePath(moduleCell, path); // CHANGE
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
            const internal = internalNeighborForPort(cur, "input"); // NEW
            if (internal) { cur = internal; continue; } // NEW
            return { source: null, cells: cells.reverse(), edges: edges.reverse(), disconnectedFromSource: true }; // NEW
        } // NEW
        return null; // NEW
    } // NEW

    function syncHudGraphState(moduleCell) { // NEW
        if (isTrellisHistoryRestoring()) return []; // NEW
        if (activeIrrigationEditDepth === 0) return runIrrigationEdit("syncHudGraphState", function () { return syncHudGraphState(moduleCell); }); // NEW
        const paths = ReportModel.deriveAssemblyPaths(moduleCell); // CHANGE
        ReportModel.syncDashboardState(moduleCell, paths); // CHANGE
        return paths; // NEW
    } // NEW

    function scheduleHudGraphStateSync(moduleCell) { // NEW
        if (!moduleCell) return null; // NEW
        if (isTrellisHistoryRestoring()) return null; // NEW
        if (activeIrrigationEditDepth > 0) { queueHudGraphStateSync(moduleCell); return null; } // NEW
        hudSyncModuleCell = moduleCell; // CHANGE
        if (hudSyncTimer && typeof clearTimeout === "function") clearTimeout(hudSyncTimer); // NEW
        if (typeof setTimeout !== "function") { if (activeIrrigationMode && activeIrrigationMode.moduleCell === moduleCell) renderIrrigationMode(activeIrrigationMode); return null; } // CHANGE
        hudSyncTimer = setTimeout(function () { // NEW
            const target = hudSyncModuleCell; // NEW
            hudSyncTimer = null; // NEW
            hudSyncModuleCell = null; // NEW
            if (isTrellisHistoryRestoring()) return; // NEW
            if (target && activeIrrigationMode && activeIrrigationMode.moduleCell === target) renderIrrigationMode(activeIrrigationMode); // CHANGE
        }, HUD_SYNC_DEBOUNCE_MS); // NEW
        return null; // NEW
    } // NEW

    function flushHudGraphStateSync() { // NEW
        const target = hudSyncModuleCell; // NEW
        if (hudSyncTimer && typeof clearTimeout === "function") clearTimeout(hudSyncTimer); // NEW
        hudSyncTimer = null; // NEW
        hudSyncModuleCell = null; // NEW
        if (isTrellisHistoryRestoring()) { pendingHudGraphSyncModuleCells = []; return []; } // NEW
        if (activeIrrigationEditDepth > 0) flushQueuedHudGraphStateSync(); // NEW
        if (target && activeIrrigationMode && activeIrrigationMode.moduleCell === target) renderIrrigationMode(activeIrrigationMode); // NEW
        return []; // CHANGE
    } // NEW

    function cancelPendingHudGraphStateSync() { // NEW
        if (hudSyncTimer && typeof clearTimeout === "function") clearTimeout(hudSyncTimer); // NEW
        hudSyncTimer = null; // NEW
        hudSyncModuleCell = null; // NEW
        pendingHudGraphSyncModuleCells = []; // NEW
    } // NEW

    function firstPathForBedEndpoint(moduleCell, inletCell) { // NEW
        return deriveHudPaths(moduleCell).find(function (path) { return path.targetEndpointId === getCellId(inletCell); }) || null; // NEW
    } // NEW

    function firstAssemblyPathForBedAssembly(moduleCell, bedAssembly) { // NEW
        return deriveAssemblyPaths(moduleCell).find(function (path) { return path.targetEndpointId === getCellId(bedAssembly); }) || null; // CHANGE
    } // NEW

    function deleteHudIrrigationCell(session, cell) { // NEW
        if (activeIrrigationEditDepth === 0) return runIrrigationEdit("deleteHudIrrigationCell", function () { return deleteHudIrrigationCell(session, cell); }); // NEW
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

    function appendIrrigationControlNode(node) { // NEW
        const host = ensureIrrigationControlLayer(); // NEW
        if (host) { host.appendChild(node); return host; } // CHANGE
        else irrigationDebug("appendIrrigationControlNode:no-host", { nodeClass: node && node.className }); // NEW
        return null; // NEW
    } // NEW

    function overlayHost() { // NEW
        const pane = graph.view && graph.view.overlayPane ? graph.view.overlayPane : null; // NEW
        if (pane && pane.namespaceURI !== "http://www.w3.org/2000/svg") return pane; // CHANGE
        return graph.container || pane; // CHANGE
    } // NEW

    function ensureIrrigationControlLayer() { // NEW
        const pane = graph.view && graph.view.overlayPane ? graph.view.overlayPane : null; // NEW
        const paneIsSvg = !!(pane && pane.namespaceURI === "http://www.w3.org/2000/svg"); // NEW
        const baseHost = graph.container || (pane && !paneIsSvg ? pane : null); // CHANGE
        if (!baseHost || baseHost.namespaceURI === "http://www.w3.org/2000/svg") return null; // NEW
        const style = typeof window !== "undefined" && window.getComputedStyle ? window.getComputedStyle(baseHost) : null; // NEW
        if (style && style.position === "static") baseHost.style.position = "relative"; // NEW
        let layer = graph.__trellisIrrigationControlLayer && graph.__trellisIrrigationControlLayer.parentNode === baseHost ? graph.__trellisIrrigationControlLayer : null; // NEW
        if (!layer && typeof document !== "undefined" && document.createElement) { // NEW
            layer = document.createElement("div"); // NEW
            layer.className = "trellis-irrigation-control-layer"; // NEW
            layer.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:" + GRAPH_OVERLAY_Z.CONTROL + ";"; // NEW
            baseHost.appendChild(layer); // NEW
            graph.__trellisIrrigationControlLayer = layer; // NEW
        } // NEW
        return layer; // NEW
    } // NEW

    function removeHudNode(node) { // NEW
        if (node && node.parentNode) node.parentNode.removeChild(node); // NEW
    } // NEW

    function removeNodeList(nodes) { // NEW
        (nodes || []).forEach(removeHudNode); // NEW
        if (nodes) nodes.length = 0; // NEW
    } // NEW

    function removeIrrigationControlLayerChildren() { // NEW
        const layer = graph.__trellisIrrigationControlLayer; // NEW
        if (!layer || !layer.children) return; // NEW
        Array.from(layer.children).forEach(removeHudNode); // NEW
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
        const b = typeof mxUtils !== "undefined" && mxUtils.button ? mxUtils.button(label, fn) : document.createElement("button"); // CHANGE
        if (!b.textContent) b.textContent = label; // CHANGE
        if (!(typeof mxUtils !== "undefined" && mxUtils.button)) b.addEventListener("click", fn); // CHANGE
        b.style.maxWidth = "100%"; // NEW
        b.style.boxSizing = "border-box"; // NEW
        b.style.whiteSpace = "normal"; // NEW
        b.style.overflowWrap = "anywhere"; // NEW
        return b;
    }

    function exitIrrigationButton() { // NEW
        const b = button("Exit", closeIrrigationMode); // NEW
        const earlyClose = function (ev) { // NEW
            if (ev && ev.stopPropagation) ev.stopPropagation(); // NEW
            closeIrrigationMode(); // NEW
        }; // NEW
        if (b.addEventListener) { // NEW
            b.addEventListener("pointerdown", earlyClose); // NEW
            b.addEventListener("mousedown", earlyClose); // NEW
        } // NEW
        return b; // NEW
    } // NEW

    function showDialog(node, w, h) {
        if (ui.showDialog) { // CHANGE
            ui.showDialog(node, w, h, true, true); // CHANGE
            elevateTrellisDialog(); // NEW
        } // NEW
        else if (document && document.body) document.body.appendChild(node);
    }

    function elevateTrellisDialog() { // NEW
        const dlg = ui && ui.dialog; // NEW
        if (dlg && dlg.bg && dlg.bg.style) dlg.bg.style.zIndex = String(TRELLIS_DIALOG_Z - 1); // NEW
        if (dlg && dlg.container && dlg.container.style) dlg.container.style.zIndex = String(TRELLIS_DIALOG_Z); // NEW
    } // NEW

    function hideDialog() {
        if (ui.hideDialog) ui.hideDialog();
    }

    function alertUser(message) {
        if (ui.alert) ui.alert(message);
        else if (typeof alert !== "undefined") alert(message);
    }

    // Architecture seams: GraphStore owns diagram cell/JSON persistence, ConnectorRules owns connector/port decisions, Hydraulics owns demand/route/capacity checks, ReportModel owns report/dashboard build and writes, ZoneModel owns zone derivation and overrides, and HudController owns UI mode orchestration. Rendering paths must remain write-free; explicit sync/report/write methods persist derived state. // CHANGE
    const IrrigationCatalog = { // NEW
        read: readCatalog, // NEW
        write: writeCatalog, // NEW
        starter: starterCatalog, // NEW
        seedIfEmpty: seedStarterCatalogIfEmpty, // NEW
        upsert: upsertCatalogPart, // NEW
        deletePart: deleteCatalogPart, // NEW
        normalizePart: normalizeCatalogPart, // NEW
        validatePart: validateCatalogPart, // NEW
        mergeUpgradeParts: mergeCatalogUpgradeParts // NEW
    }; // NEW

    const ConnectorRules = { // NEW
        normalizeType: normalizeConnectorType, // NEW
        normalizeConnector: normalizeConnectorRecord, // NEW
        isPipeConnectorType, // NEW
        connectorMatches, // NEW
        connectorRecordsMatch, // NEW
        connectorRecordsRequirePipe, // NEW
        connectorsRequirePipe, // NEW
        pipeConnectorMatches, // NEW
        portConnectorForCell, // NEW
        portCapacityForCell, // NEW
        autoPipePartIdForConnection, // NEW
        connectionMode: connectorConnectionMode, // NEW
        validatePortConnectionStructure, // NEW
        connectionDecision: connectionDecisionForPorts, // NEW
        bridgeSuggestionEligibility, // NEW
        canConnectParts, // NEW
        canEndpointConnectToPart, // NEW
        canPartReachEndpoint, // NEW
        compatibleFirstParts, // NEW
        compatibleNextParts, // NEW
        groupPartsByStock, // NEW
        healEndpoint, // NEW
        validatePortConnection, // NEW
        createAssemblyConnection, // NEW
        bridgeSuggestionsForPorts, // NEW
        applyBridgeSuggestion // NEW
    }; // NEW

    const ConnectionChainPlanner = { // NEW
        planBridge: planBridgeConnectionChain, // NEW
        applyBridge: applyBridgeConnectionChain, // NEW
        applyExternalPart: applyExternalPartConnection, // NEW
        createEdge: createPlannedConnectionEdge // NEW
    }; // NEW

    const Hydraulics = { // NEW
        demandFromPath, // NEW
        demandFromBedAssembly, // CHANGE
        cumulativeBedDemand, // NEW
        calculatePath: calculatePathHydraulics, // NEW
        estimatePath: estimatePathHydraulics, // NEW
        validatePathGraph, // NEW
        validatePathCompatibility, // NEW
        validateSharedCapacity, // NEW
        hydraulicBlockingErrors, // NEW
        hazenWilliamsPsiLoss, // NEW
        pathRouteLengthFeet, // NEW
        pipeSegmentsForPath, // NEW
        pipeSegmentLengthForPart, // NEW
        partCostForReport, // CHANGE
        partCostForRequiredMeters // NEW
    }; // NEW

    const ZoneModel = { // NEW
        normalize: normalizeZone, // NEW
        read: readZones, // NEW
        write: writeZones, // NEW
        sync: syncZones, // NEW
        deriveInferredTimerZones, // NEW
        resolveMembership: resolveEffectiveZoneMembership, // NEW
        summary: zoneSummary, // NEW
        assignBeds: assignBedsToZone, // NEW
        resetBedOverrides: resetBedZoneOverrides, // NEW
        createManual: createManualZone, // CHANGE
        updateAlias: updateZoneAlias, // NEW
        resetZoneOverrides, // NEW
        displayName: zoneDisplayName // NEW
    }; // NEW

    const ReportModel = { // NEW
        buildSummary: buildReportSummary, // NEW
        persistSummary: persistReportSummary, // NEW
        generate: generateReport, // NEW
        readDashboardSummary, // NEW
        buildBomRows, // NEW
        deriveBomComponents, // NEW
        deriveAssemblyPaths, // NEW
        syncDashboardState: function (moduleCell, paths) { return persistReportSummary(moduleCell, buildReportSummary(moduleCell, { paths: paths || deriveAssemblyPaths(moduleCell) })); } // NEW
    }; // NEW

    const HudController = { // NEW
        open: openIrrigationMode, // NEW
        close: closeIrrigationMode, // NEW
        render: renderIrrigationMode, // NEW
        scheduleSync: scheduleHudGraphStateSync, // NEW
        flushSync: flushHudGraphStateSync, // NEW
        syncGraphState: syncHudGraphState // NEW
    }; // NEW

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
                openIrrigationMode(moduleCell, { message: "Use Irrigation Mode Add Part or inlet/outlet selectors to place branch-capable catalog parts.", preserveViewport: true }); // CHANGE
            });
        }
    }

    graph.__trellisIrrigationPlanner = {
        attrs: ATTRS,
        categories: PART_CATEGORIES.slice(),
        stockStates: VALID_STOCK_STATES.slice(),
        bedTemplates: BED_TEMPLATES.slice(),
        readCatalog: IrrigationCatalog.read, // CHANGE
        writeCatalog: IrrigationCatalog.write, // CHANGE
        starterCatalog: IrrigationCatalog.starter, // CHANGE
        seedStarterCatalogIfEmpty: IrrigationCatalog.seedIfEmpty, // CHANGE
        upsertCatalogPart: IrrigationCatalog.upsert, // CHANGE
        deleteCatalogPart: IrrigationCatalog.deletePart, // CHANGE
        validateCatalogPart: IrrigationCatalog.validatePart, // CHANGE
        canConnectParts: ConnectorRules.canConnectParts, // CHANGE
        canPartReachEndpoint: ConnectorRules.canPartReachEndpoint, // CHANGE
        compatibleNextParts: ConnectorRules.compatibleNextParts, // CHANGE
        compatibleFirstParts: ConnectorRules.compatibleFirstParts, // CHANGE
        groupPartsByStock: ConnectorRules.groupPartsByStock, // CHANGE
        healEndpoint: ConnectorRules.healEndpoint, // CHANGE
        generateReport: ReportModel.generate, // CHANGE
        readDashboardSummary: ReportModel.readDashboardSummary, // CHANGE
        readZones: ZoneModel.read, // CHANGE
        writeZones: ZoneModel.write, // CHANGE
        syncZones: ZoneModel.sync, // CHANGE
        deriveInferredTimerZones: ZoneModel.deriveInferredTimerZones, // CHANGE
        resolveEffectiveZoneMembership: ZoneModel.resolveMembership, // CHANGE
        zoneSummary: ZoneModel.summary, // CHANGE
        buildBomRows: ReportModel.buildBomRows, // NEW
        assignBedsToZone: ZoneModel.assignBeds, // CHANGE
        resetBedZoneOverrides: ZoneModel.resetBedOverrides, // CHANGE
        createManualZone: ZoneModel.createManual, // CHANGE
        openIrrigationMode: HudController.open, // CHANGE
        closeIrrigationMode: HudController.close, // CHANGE
        isIrrigationModeActive, // NEW
        getActiveIrrigationModule, // NEW
        isBedAssembly, // NEW
        getBedIrrigationMethods, // NEW
        syncLinkedBedAssemblyToBed, // NEW
        openCatalogManager,
        openBomDialog, // NEW
        __test: {
            GraphStore, // NEW
            IrrigationCatalog, // NEW
            ConnectorRules, // NEW
            ConnectionChainPlanner, // NEW
            Hydraulics, // NEW
            ZoneModel, // NEW
            ReportModel, // NEW
            HudController, // NEW
            partStates: { planned: PART_STATE_PLANNED, completed: PART_STATE_COMPLETED }, // NEW
            normalizePartState, // NEW
            partStateForCell, // NEW
            setPartCellState, // NEW
            setPipeEdgeState, // NEW
            setBedTemplatePartState, // NEW
            lifecycleTargetsForSelection, // NEW
            markIrrigationSelectionState, // NEW
            normalizeCatalogPart: IrrigationCatalog.normalizePart, // CHANGE
            normalizeEndpointProfile,
            connectorMatches: ConnectorRules.connectorMatches, // CHANGE
            collectGardenBeds,
            collectEndpoints,
            bedAreaM2,
            pathBlockingErrors,
            validatePathGraph: Hydraulics.validatePathGraph, // CHANGE
            validatePathCompatibility: Hydraulics.validatePathCompatibility, // CHANGE
            validateSharedCapacity: Hydraulics.validateSharedCapacity, // CHANGE
            createSourceEndpoint, // CHANGE
            createBedEndpoint, // CHANGE
            createBranchpointEndpoint, // CHANGE
            ensureBedEndpoint, // CHANGE
            buildPairQueue, // CHANGE
            stagePath, // CHANGE
            commitStagedPath, // CHANGE
            commitBedTemplate, // CHANGE
            calculatePathHydraulics: Hydraulics.calculatePath, // CHANGE
            estimatePathHydraulics: Hydraulics.estimatePath, // CHANGE
            hydraulicBlockingErrors: Hydraulics.hydraulicBlockingErrors, // NEW
            hazenWilliamsPsiLoss: Hydraulics.hazenWilliamsPsiLoss, // CHANGE
            pathRouteLengthFeet: Hydraulics.pathRouteLengthFeet, // CHANGE
            pipeSegmentsForPath: Hydraulics.pipeSegmentsForPath, // NEW
            pipeSegmentLengthForPart: Hydraulics.pipeSegmentLengthForPart, // NEW
            partCostForReport: Hydraulics.partCostForReport, // CHANGE
            partCostForRequiredMeters: Hydraulics.partCostForRequiredMeters, // NEW
            computeBedTemplateBom, // NEW
            buildBomRows: ReportModel.buildBomRows, // NEW
            bomCanonicalQuantityToDisplay, // NEW
            bomInputQuantityToCanonical, // NEW
            bomDisplayUnitCost, // NEW
            bomInputUnitCostToCanonical, // NEW
            stockStateForQuantity, // NEW
            selectedCatalogPartIdsForSelection, // NEW
            createBedTemplateLayoutCells, // NEW
            rowSpacingSpanCmForBedGeometry, // NEW
            rowSpacingCmForRows, // NEW
            rowsForRowSpacingCm, // NEW
            rowSpacingDisplayValueToCm, // NEW
            rowSpacingCmToDisplayValue, // NEW
            resolveTemplateAnchorPart, // NEW
            boundaryMatchForAnchor, // NEW
            buildReportSummary: ReportModel.buildSummary, // NEW
            persistReportSummary: ReportModel.persistSummary, // NEW
            readPaths,
            writePaths,
            normalizeZone: ZoneModel.normalize, // CHANGE
            readZones: ZoneModel.read, // CHANGE
            writeZones: ZoneModel.write, // CHANGE
            syncZones: ZoneModel.sync, // CHANGE
            deriveInferredTimerZones: ZoneModel.deriveInferredTimerZones, // CHANGE
            downstreamBedAssemblyIdsFromTimerOutlet, // NEW
            resolveEffectiveZoneMembership: ZoneModel.resolveMembership, // CHANGE
            zoneSummary: ZoneModel.summary, // CHANGE
            deriveBomComponents: ReportModel.deriveBomComponents, // NEW
            assignBedsToZone: ZoneModel.assignBeds, // CHANGE
            resetBedZoneOverrides: ZoneModel.resetBedOverrides, // CHANGE
            createManualZone: ZoneModel.createManual, // CHANGE
            createSourceAssembly, // NEW
            createPartAssembly, // NEW
            createBedAssembly, // NEW
            isBedAssembly, // NEW
            isCenterStableFoldAssembly, // NEW
            centerAlternateBoundsOnGeometry, // NEW
            getBedIrrigationMethods, // NEW
            readBedAssemblyTemplateRecord, // NEW
            syncLinkedBedAssemblyToBed, // NEW
            createAssemblyConnection: ConnectorRules.createAssemblyConnection, // CHANGE
            validatePortConnection: ConnectorRules.validatePortConnection, // CHANGE
            portConnectorForCell: ConnectorRules.portConnectorForCell, // NEW
            autoPipePartIdForConnection: ConnectorRules.autoPipePartIdForConnection, // NEW
            connectionModeForConnectors: ConnectorRules.connectionMode, // NEW
            validatePortConnectionStructure: ConnectorRules.validatePortConnectionStructure, // NEW
            connectionDecisionForPorts: ConnectorRules.connectionDecision, // NEW
            bridgeSuggestionEligibility: ConnectorRules.bridgeSuggestionEligibility, // NEW
            applyConnectionPartChoice, // FIX
            dropdownPartConnectionDecision, // FIX
            boundaryForPort, // NEW
            internalConnectionBoundariesForSelection, // NEW
            disconnectBoundary, // NEW
            disconnectBoundaries, // NEW
            deleteAssemblyPartCell, // NEW
            assemblyCanReverse, // NEW
            positionPortBadge, // NEW
            bridgeSuggestionsForPorts: ConnectorRules.bridgeSuggestionsForPorts, // CHANGE
            applyBridgeSuggestion: ConnectorRules.applyBridgeSuggestion, // CHANGE
            deriveAssemblyPaths: ReportModel.deriveAssemblyPaths, // CHANGE
            firstAssemblyPart, // NEW
            lastAssemblyPart, // NEW
            assemblyPartCells, // NEW
            collectAssemblyEdges, // NEW
            collectHudObjects, // NEW
            collectHudEndpoints, // NEW
            collectHudPipeEdges, // NEW
            deriveHudPaths, // NEW
            syncHudGraphState: HudController.syncGraphState, // CHANGE
            scheduleHudGraphStateSync: HudController.scheduleSync, // CHANGE
            flushHudGraphStateSync: HudController.flushSync, // CHANGE
            isIrrigationModeActive, // NEW
            getActiveIrrigationModule, // NEW
            isIrrigationHudSelectionTarget, // NEW
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
        window.addEventListener('trellisHistoryBeforeRestore', function () { // NEW
            cancelPendingHudGraphStateSync(); // NEW
        }); // NEW
        window.addEventListener('trellisHistoryAfterRestore', function () { // NEW
            try { refreshInactiveEntryOverlay(); } catch (e) { } // NEW
            try { // NEW
                if (!activeIrrigationMode || !activeIrrigationMode.moduleCell) return; // NEW
                const moduleId = getCellId(activeIrrigationMode.moduleCell); // NEW
                const restoredModule = moduleId && model.getCell ? model.getCell(moduleId) : null; // NEW
                if (restoredModule) activeIrrigationMode.moduleCell = restoredModule; // NEW
                renderIrrigationMode(activeIrrigationMode); // NEW
            } catch (e) { } // NEW
        }); // NEW
    }

    addActionAndMenus();
    installInactiveIrrigationEntryOverlay(); // NEW
});
