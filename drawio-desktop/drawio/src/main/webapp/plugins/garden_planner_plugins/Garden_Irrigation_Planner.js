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

    const PLUGIN_VERSION = 4;
    const ACTION_ID = "trellisIrrigationPlanner";
    const CREATE_SOURCE_ACTION_ID = "trellisIrrigationCreateSourceEndpoint";
    const CREATE_BED_ACTION_ID = "trellisIrrigationCreateBedEndpoint";
    const CREATE_BRANCH_ACTION_ID = "trellisIrrigationCreateBranchpointEndpoint";
    const MODE_CHANGED_EVENT = "trellisIrrigationModeChanged";
    const PX_PER_CM = 5;
    const DRAW_SCALE = 0.18;
    const CM_PER_FOOT = 30.48;
    const CM_PER_INCH = 2.54;
    const HUD_SYNC_DEBOUNCE_MS = 200;
    const TRELLIS_DIALOG_Z = 2000000000;
    const IRRIGATION_DRAG_SUPPRESS_THRESHOLD_PX = 4; // CHANGE

    const ATTRS = {
        CATALOG_JSON: "irrigation_catalog_json",
        PATHS_JSON: "irrigation_paths_json",
        ZONES_JSON: "irrigation_zones_json",
        REPORT_JSON: "irrigation_report_json",
        DASHBOARD_JSON: "irrigation_dashboard_summary_json",
        ENDPOINT: "irrigation_endpoint",
        ENDPOINT_TYPE: "irrigation_endpoint_type",
        ENDPOINT_PROFILE_JSON: "irrigation_endpoint_profile_json",
        COMPONENT: "irrigation_component",
        COMPONENT_TYPE: "irrigation_component_type",
        CATALOG_PART_ID: "irrigation_catalog_part_id",
        PART_FLIPPED: "irrigation_part_flipped",
        PART_STATE: "irrigation_part_state",
        PATH_ID: "irrigation_path_id",
        GENERATED: "irrigation_generated",
        PIPE_EDGE: "irrigation_pipe_edge",
        DIRECT_LINK_EDGE: "irrigation_direct_link_edge",
        PIPE_PART_ID: "irrigation_pipe_part_id",
        ASSEMBLY: "irrigation_assembly",
        ASSEMBLY_TYPE: "irrigation_assembly_type",
        LINKED_BED_ID: "irrigation_linked_bed_id",
        BED_PORTS_JSON: "irrigation_bed_ports_json",
        EDGE_SOURCE_PORT: "irrigation_edge_source_port",
        EDGE_TARGET_PORT: "irrigation_edge_target_port",
        BED_TEMPLATE_JSON: "irrigation_bed_template_json",
        BED_SUPPLY_LINE: "irrigation_bed_supply_line",
        BED_LAYOUT: "irrigation_bed_layout"
    };

    const STOCK_AVAILABLE = new Set(["in_stock", "low_stock"]);
    const PURCHASE_NEEDED = new Set(["out_of_stock", "unknown"]);
    const BRANCH_CATEGORIES = new Set(["valve", "manifold", "controller_timer"]);
    const BRANCH_SINGLETON_CATEGORIES = new Set(["backflow", "filter", "regulator", "controller_timer"]);
    const BRIDGE_SUGGESTION_CATEGORIES = new Set(["fitting", "source_adapter"]);
    const ZONE_ORIGIN_TIMER_OUTLET = "timer_outlet";
    const ZONE_ORIGIN_MANUAL = "manual";
    const VALID_STOCK_STATES = ["in_stock", "low_stock", "out_of_stock", "unknown"];
    const ASSEMBLY_PART_WIDTH = 150;
    const ASSEMBLY_PART_HEIGHT = 34;
    const ASSEMBLY_HEADER_SIZE = 28;
    const ASSEMBLY_DEFAULT_WIDTH = 210;
    const ASSEMBLY_CONTRACTED_BED = { width: 220, height: 120 };
    const BED_ASSEMBLY_CONTAINER_STYLE = "rounded=1;whiteSpace=wrap;html=1;container=1;recursiveResize=0;collapsible=0;editable=0;fillColor=none;strokeColor=#666666;fontStyle=1;fontSize=14;align=center;labelPosition=center;verticalLabelPosition=top;verticalAlign=bottom;spacingTop=0;spacingBottom=2;spacingLeft=6;spacingRight=6;labelBackgroundColor=#ffffff;"; // CHANGE
    const PORT_BADGE_SIZE = 22;
    const PORT_BADGE_MIN_WIDTH = 30;
    const PORT_BADGE_MAX_WIDTH = 78;
    const PORT_BADGE_ARROW_SIZE = 6;
    const GRAPH_OVERLAY_Z = Object.freeze({ ANNOTATION: 10000, CONNECTION: 10010, CONTROL: 10020, CONTROL_TOP: 10030 });
    const FIXED_CONNECTOR_TYPES = ["mght", "fght", "mpt", "fpt", "barb", "twist_lock", "push_connect"];
    const PIPE_CONNECTOR_TYPES = new Set(["barb", "twist_lock", "push_connect"]);
    const FIXED_CONNECTOR_SIZES = ["1/4", "1/2", "3/4", "1"];
    const STARTER_CONNECTOR_SIZES = [ // NEW: shared size matrix for generated starter fittings
        { id: "1_4", label: "1/4", cost: 1.25 },
        { id: "1_2", label: "1/2", cost: 2.25 },
        { id: "3_4", label: "3/4", cost: 3.75 },
        { id: "1", label: "1", cost: 5.75 }
    ];
    const PIPE_EDGE_BASE_STYLE = "edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#2f80ed;";
    const PIPE_EDGE_STYLE_MODES = Object.freeze({ straight: "straight", curved: "curved" });
    const GENERATED_PIPE_EDGE_BASE_STYLE = "edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#4d8f6f;";
    const DIRECT_LINK_EDGE_STYLE = "edgeStyle=orthogonalEdgeStyle;rounded=0;dashed=1;html=1;strokeColor=#7c3aed;";
    const CONNECTION_EDGE_ANCHOR_STYLE_KEYS = ["exitX", "exitY", "exitDx", "exitDy", "exitPerimeter", "entryX", "entryY", "entryDx", "entryDy", "entryPerimeter"]; // NEW
    const PART_STATE_PLANNED = "planned";
    const PART_STATE_COMPLETED = "completed";
    const ASSEMBLY_PART_PLANNED_STYLE = "rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#4b5563;fontColor=#111827;fontSize=10;editable=0;deletable=0;resizable=0;connectable=0;";
    const ASSEMBLY_PART_COMPLETED_STYLE = "rounded=1;whiteSpace=wrap;html=1;fillColor=#e8f5e9;strokeColor=#82b366;fontColor=#2f6b3c;fontSize=10;editable=0;deletable=0;resizable=0;connectable=0;";
    const ASSEMBLY_LABEL_PLANNED_FILL = "#ffffff";
    const ASSEMBLY_LABEL_COMPLETED_FILL = "#e8f5e9";
    const HUD_OUTLINE_BLUE = "#2563eb";
    const HUD_OUTLINE_GREEN = "#188038";
    const HUD_OUTLINE_RED = "#b91c1c";

    function applyIrrigationButtonStyle(button, variant, options) {
        if (window.Trellis && window.Trellis.ui && typeof window.Trellis.ui.applyButtonStyle === "function") {
            window.Trellis.ui.applyButtonStyle(button, variant, options);
        } else if (button) {
            const normalized = variant || "neutral"; // CHANGE
            const activeOpen = normalized === "open" && options && options.active === true; // NEW
            const style = { open: ["#2563eb", activeOpen ? "#1e3a8a" : "#1d4ed8", activeOpen ? "#eff6ff" : "#fff"], add: ["#188038", "#166534", "#fff"], close: ["#b91c1c", "#b91c1c", "#fff"], danger: ["#b91c1c", "#fff", "#b91c1c"], neutral: ["#6b7280", "#111827", "#fff"] }[normalized] || ["#6b7280", "#111827", "#fff"]; // NEW
            button.setAttribute("data-trellis-button-variant", normalized); // CHANGE
            button.style.border = "1px solid " + style[0]; // NEW
            button.style.color = style[1]; // NEW
            button.style.background = style[2]; // NEW
            if (activeOpen) button.style.fontWeight = "700"; // NEW
        }
        return button;
    }

    const BED_LAYOUT_PLANNED_STYLE = "rounded=0;whiteSpace=wrap;html=1;fillColor=#e1f5fe;strokeColor=#0288d1;fontSize=8;";
    const BED_LAYOUT_COMPLETED_STYLE = "rounded=0;whiteSpace=wrap;html=1;fillColor=#e8f5e9;strokeColor=#82b366;fontColor=#2f6b3c;fontSize=8;";
    const CONNECTION_COMBOBOX_COLLAPSED_STORAGE_KEY = "trellis.irrigation.connectionCombobox.collapsed.v1";
    const CATALOG_MANAGER_COMPACT_STORAGE_KEY = "trellis.irrigation.catalogManager.compactView.v1"; // NEW
    const BOM_DIALOG_COMPACT_STORAGE_KEY = "trellis.irrigation.bomDialog.compactView.v1"; // NEW
    const BOM_DIALOG_FULL_SIZE = { contentWidth: 960, dialogWidth: 980, dialogHeight: 640 }; // NEW
    const BOM_DIALOG_COMPACT_SIZE = { contentWidth: 860, dialogWidth: 900, dialogHeight: 640 }; // NEW
    const CATALOG_MANAGER_FULL_SIZE = { contentWidth: 1240, dialogWidth: 1280, dialogHeight: 760 }; // NEW
    const CATALOG_MANAGER_COMPACT_SIZE = { contentWidth: 980, dialogWidth: 1020, dialogHeight: 720 }; // NEW
    const CATALOG_MANAGER_COMPACT_LIST_MAX_HEIGHT = Math.floor(CATALOG_MANAGER_COMPACT_SIZE.dialogHeight / 3); // NEW
    const PIPE_EDGE_STROKE_UNIT_IN = 0.25;
    const PIPE_EDGE_MAX_STROKE_WIDTH = 12;
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
        "cap_end",
        "pipe_tubing",
        "drip_tape",
        "dripline",
        "emitter",
        "sprinkler",
        "microspray",
        "bubbler",
        "standpipe"
    ];
    const BROAD_CATALOG_CATEGORIES = [
        { id: "source_supply", label: "Source & supply", categories: ["source_adapter", "pump"] },
        { id: "control_protection", label: "Control & protection", categories: ["backflow", "filter", "regulator", "controller_timer", "valve", "manifold"] },
        { id: "fittings_adapters", label: "Fittings & adapters", categories: ["fitting", "cap_end"] },
        { id: "distribution", label: "Distribution", categories: ["pipe_tubing"] },
        { id: "application", label: "Water application", categories: ["drip_tape", "dripline", "emitter", "sprinkler", "microspray", "bubbler", "standpipe"] }
    ];
    const CATALOG_CATEGORY_LABELS = {
        source_adapter: "Source adapters",
        pump: "Pumps",
        backflow: "Backflow",
        filter: "Filters",
        regulator: "Regulators",
        controller_timer: "Timers",
        valve: "Valves",
        manifold: "Manifolds",
        fitting: "Fittings",
        cap_end: "End caps",
        pipe_tubing: "Pipe/tubing",
        drip_tape: "Drip tape",
        dripline: "Dripline",
        emitter: "Emitters",
        sprinkler: "Sprinklers",
        microspray: "Microsprays",
        bubbler: "Bubblers",
        standpipe: "Standpipes"
    };
    const LOGICAL_CATALOG_CATEGORIES = [
        { id: "source_adapters", label: "Source adapters", broadCategoryId: "source_supply" },
        { id: "pumps", label: "Pumps", broadCategoryId: "source_supply" },
        { id: "backflow", label: "Backflow", broadCategoryId: "control_protection" },
        { id: "filters", label: "Filters", broadCategoryId: "control_protection" },
        { id: "regulators", label: "Regulators", broadCategoryId: "control_protection" },
        { id: "timers", label: "Timers", broadCategoryId: "control_protection" },
        { id: "valves", label: "Valves", broadCategoryId: "control_protection" },
        { id: "manifolds", label: "Manifolds", broadCategoryId: "control_protection" },
        { id: "fittings", label: "Fittings", broadCategoryId: "fittings_adapters" },
        { id: "change_size", label: "Change size", broadCategoryId: "fittings_adapters" },
        { id: "end_caps", label: "End caps", broadCategoryId: "fittings_adapters" },
        { id: "pipe_tubing", label: "Pipe/tubing", broadCategoryId: "distribution" },
        { id: "drip_tape", label: "Drip tape", broadCategoryId: "application" },
        { id: "dripline", label: "Dripline", broadCategoryId: "application" },
        { id: "emitters", label: "Emitters", broadCategoryId: "application" },
        { id: "sprinklers", label: "Sprinklers", broadCategoryId: "application" },
        { id: "microsprays", label: "Microsprays", broadCategoryId: "application" },
        { id: "bubblers", label: "Bubblers", broadCategoryId: "application" },
        { id: "standpipes", label: "Standpipes", broadCategoryId: "application" }
    ];
    const FITTING_INTENT_GROUPS = [ // NEW
        { id: "continue", label: "Continue" },
        { id: "turn", label: "Turn" },
        { id: "branch", label: "Branch" },
        { id: "end_line", label: "End line" },
        { id: "change_size", label: "Change size" },
        { id: "thread_adapters", label: "Thread adapters" },
        { id: "connector_adapters", label: "Connector adapters" },
        { id: "other", label: "Other fittings" }
    ];

    const BED_TEMPLATE_MODEL_BOM = "bom";
    const BED_ASSEMBLY_LABEL_HIDDEN = "hidden";
    const METERS_PER_FOOT = CM_PER_FOOT / 100;
    const BED_TEMPLATE_ROW_ORIENTATIONS = ["width", "height"];
    const BED_TEMPLATE_ANCHOR_CATEGORIES = new Set(["pipe_tubing", "drip_tape", "dripline"]);
    const BED_RECIPE_VERSION = 1;
    const BED_SUPPLY_LINE_STYLE = "rounded=0;whiteSpace=wrap;html=1;fillColor=#d9ead3;strokeColor=#4d8f6f;fontSize=8;editable=0;resizable=0;connectable=0;";
    const LINEAR_PIPE_STYLE_CATEGORIES = new Set(["pipe_tubing", "drip_tape", "dripline"]); // NEW
    const BED_SELF_EMITTING_ROW_CATEGORIES = new Set(["drip_tape", "dripline"]);
    const BED_DEVICE_CATEGORIES = new Set(["emitter", "sprinkler", "microspray", "bubbler", "standpipe"]);
    const ANALYSIS_MODE_BUILD = "build"; // NEW
    const ANALYSIS_MODE_ANALYSIS = "analysis"; // NEW
    const ANALYSIS_DEMAND_CATEGORIES = new Set(["emitter", "sprinkler", "microspray", "bubbler", "standpipe"]); // NEW
    const ANALYSIS_LOW_MARGIN_PSI = 5; // NEW
    const ANALYSIS_DEFAULT_HW_C = 150; // NEW
    const BED_SUPPLY_PIPE_BY_SIZE = { "1/2": "poly_distribution_1_2", "3/4": "poly_mainline_3_4", "1": "poly_mainline_1" };
    const DISCONNECTED_SOURCE_WARNING = "Irrigation tree is disconnected from a source.";

    const BED_TEMPLATES = [
        { id: "drip_tape_bed", label: "Drip tape bed", defaultRows: 2, defaultRowOrientation: "width", lineKind: "drip_tape", pipePartId: "poly_distribution_1_2", requiredParts: [{ partId: "drip_tape_8mil_12in", quantityPerRowMeter: 1 }], flowGpm: 0.5, pressurePsi: 10 }, // CHANGE
        { id: "dripline_bed", label: "Dripline bed", defaultRows: 2, defaultRowOrientation: "width", lineKind: "dripline", pipePartId: "poly_distribution_1_2", requiredParts: [{ partId: "pc_dripline_1_2", quantityPerRowMeter: 1 }], flowGpm: 0.5, pressurePsi: 12 }, // CHANGE
        { id: "overhead_sprinkler_block", label: "Overhead sprinkler block", defaultRows: 3, defaultRowOrientation: "width", lineKind: "sprinkler", pipePartId: "poly_distribution_1_2", requiredParts: [{ partId: "poly_distribution_1_2", quantityPerRowMeter: 1 }, { partId: "overhead_sprinkler_head_30psi", quantityPerRowMeter: 1 }], flowGpm: 2.5, pressurePsi: 30 },
        { id: "nursery_microspray", label: "Nursery/propagation microspray", defaultRows: 3, defaultRowOrientation: "width", lineKind: "microspray", pipePartId: "poly_distribution_1_2", requiredParts: [{ partId: "poly_distribution_1_2", quantityPerRowMeter: 1 }, { partId: "microspray_stake_20psi", quantityPerRowMeter: 1 }], flowGpm: 1.5, pressurePsi: 20 },
        { id: "soaker_row", label: "Soaker row", defaultRows: 2, defaultRowOrientation: "width", lineKind: "dripline", pipePartId: "poly_distribution_1_2", requiredParts: [{ partId: "soaker_row_line_1_2", quantityPerRowMeter: 1 }], flowGpm: 0.5, pressurePsi: 10 }, // CHANGE
        { id: "perennial_bubbler_row", label: "Orchard/perennial bubbler row", defaultRows: 1, defaultRowOrientation: "width", lineKind: "bubbler", pipePartId: "poly_distribution_1_2", requiredParts: [{ partId: "poly_distribution_1_2", quantityPerRowMeter: 1 }, { partId: "bubbler_emitter_1_2", quantityPerRowMeter: 1 }], flowGpm: 1.0, pressurePsi: 15 },
        { id: "manual_hose_standpipe", label: "Manual hose standpipe", defaultRows: 1, defaultRowOrientation: "width", lineKind: "standpipe", pipePartId: "poly_distribution_1_2", requiredParts: [{ partId: "poly_distribution_1_2", quantityPerRowMeter: 1 }, { partId: "hose_standpipe_1_2", quantityPerRowMeter: 1 }], flowGpm: 2.0, pressurePsi: 20 }
    ];

    const GENERATED_CONNECTOR_CATALOG_ITEMS = generateLabelOnlyConnectorParts();
    const GENERATED_THREAD_CONNECTOR_CATALOG_ITEMS = generateThreadConnectorParts();

    const CATALOG_UPGRADE_PART_IDS = new Set([
        "poly_mainline_1",
        "barb_tee_3_4_to_1_2",
        "barb_tee_1",
        "barb_elbow_1",
        "barb_coupler_1",
        "end_cap_1_barb",
        "reducer_1_to_3_4_barb",
        "adapter_3_4_to_1_barb",
        "micro_tubing_1_4",
        "micro_tee_1_4",
        "micro_elbow_1_4",
        "micro_coupler_1_4",
        "micro_goof_plug_1_4",
        "transfer_barb_1_2_to_1_4",
        "adapter_1_4_to_1_2_barb",
        "micro_emitter_0_5_gph",
        "micro_emitter_1_0_gph",
        "micro_emitter_2_0_gph",
        "micro_spray_stake_1_4"
    ].concat(GENERATED_CONNECTOR_CATALOG_ITEMS.map(function (part) { return part.id; })));

    const STARTER_CATALOG_ITEMS = [
        starterPart("hose_vacuum_breaker", "3/4\" FGHT: MGHT hose vacuum breaker", "backflow", 12, 1, 1, input("fght", "3/4"), output("mght", "3/4"), { pressureLossPsi: 1.0 }), // CHANGE
        starterPart("hose_timer_single_zone", "3/4\" FGHT: MGHT hose timer", "controller_timer", 38, 1, 1, input("fght", "3/4"), output("mght", "3/4", "", 5), { pressureLossPsi: 1.5, maxFlowGpm: 5 }), // CHANGE
        starterPart("hose_splitter_2way_3_4_fght_mght", "2-way hose splitter, 3/4\" FGHT: MGHT", "manifold", 16, 1, 2, input("fght", "3/4"), output("mght", "3/4", "", 8), { pressureLossPsi: 1.0, maxFlowGpm: 8 }), // CHANGE
        starterPart("hose_splitter_4way_3_4_fght_mght", "4-way hose manifold, 3/4\" FGHT: MGHT", "manifold", 28, 1, 4, input("fght", "3/4"), output("mght", "3/4", "", 8), { pressureLossPsi: 1.4, maxFlowGpm: 8 }), // CHANGE
        starterPart("fght_to_3_4_mpt_adapter", "3/4\" FGHT: MPT adapter", "source_adapter", 5, 1, 1, input("fght", "3/4"), output("mpt", "3/4"), { pressureLossPsi: 0.2 }), // CHANGE
        starterPart("mght_to_3_4_fpt_adapter", "3/4\" MGHT: FPT adapter", "source_adapter", 5, 1, 1, input("mght", "3/4"), output("fpt", "3/4"), { pressureLossPsi: 0.2 }), // CHANGE
        starterPart("fght_to_3_4_barb_adapter", "3/4\" FGHT: barb adapter", "fitting", 5, 1, 1, input("fght", "3/4"), output("barb", "3/4"), { pressureLossPsi: 0.2 }), // CHANGE
        starterPart("mght_to_3_4_barb_adapter", "3/4\" MGHT: barb adapter", "fitting", 5, 1, 1, input("mght", "3/4"), output("barb", "3/4"), { pressureLossPsi: 0.2 }), // CHANGE
        starterPart("filter_150_mesh_3_4_fpt", "150 mesh filter, 3/4\" FPT", "filter", 26, 1, 1, input("fpt", "3/4"), output("fpt", "3/4"), { pressureLossPsi: 3.0 }), // CHANGE
        starterPart("drip_regulator_25psi_3_4_fpt", "25 psi drip pressure regulator, 3/4\" FPT", "regulator", 18, 1, 1, input("fpt", "3/4"), output("fpt", "3/4"), { pressureLossPsi: 5.0, operatingPressurePsi: 25 }), // CHANGE
        starterPart("spray_regulator_30psi_3_4_fpt", "30 psi spray pressure regulator, 3/4\" FPT", "regulator", 20, 1, 1, input("fpt", "3/4"), output("fpt", "3/4"), { pressureLossPsi: 5.0, operatingPressurePsi: 30 }), // CHANGE
        starterPart("mpt_nipple_3_4", "3/4\" MPT close nipple", "fitting", 3, 1, 1, input("mpt", "3/4"), output("mpt", "3/4"), { pressureLossPsi: 0.1 }), // CHANGE
        starterPart("fpt_coupler_3_4", "3/4\" FPT coupler", "fitting", 3, 1, 1, input("fpt", "3/4"), output("fpt", "3/4"), { pressureLossPsi: 0.1 }), // CHANGE
        starterPart("mpt_to_3_4_barb_adapter", "3/4\" MPT: barb adapter", "fitting", 4, 1, 1, input("mpt", "3/4"), output("barb", "3/4"), { pressureLossPsi: 0.2 }), // CHANGE
        starterPart("fpt_to_3_4_barb_adapter", "3/4\" FPT: barb adapter", "fitting", 4, 1, 1, input("fpt", "3/4"), output("barb", "3/4"), { pressureLossPsi: 0.2 }), // CHANGE
        starterPart("valve_3_4_barb", "3/4\" barb irrigation valve", "valve", 26, 1, 1, input("barb", "3/4"), output("barb", "3/4", "", 8), { pressureLossPsi: 1.0, maxFlowGpm: 8 }), // CHANGE
        starterPart("manifold_4out_3_4_barb", "4-output 3/4\" barb manifold", "manifold", 35, 1, 4, input("barb", "3/4"), output("barb", "3/4", "", 8), { pressureLossPsi: 1.2, maxFlowGpm: 8 }), // CHANGE
        starterPart("barb_tee_3_4", "3/4\" barb tee", "fitting", 3.5, 1, 2, input("barb", "3/4"), output("barb", "3/4"), { pressureLossPsi: 0.2 }), // CHANGE
        starterPart("barb_elbow_3_4", "3/4\" barb elbow", "fitting", 2.5, 1, 1, input("barb", "3/4"), output("barb", "3/4"), { pressureLossPsi: 0.2 }), // CHANGE
        starterPart("barb_coupler_3_4", "3/4\" barb coupler", "fitting", 2.25, 1, 1, input("barb", "3/4"), output("barb", "3/4"), { pressureLossPsi: 0.1 }), // CHANGE
        starterPart("barb_tee_3_4_to_1_2", "3/4\": 1/2\" barb tee", "fitting", 3.75, 1, 2, input("barb", "3/4"), output("barb", "1/2"), { pressureLossPsi: 0.25 }), // CHANGE
        starterPart("reducer_3_4_to_1_2_barb", "3/4\": 1/2\" barb reducer", "fitting", 3, 1, 1, input("barb", "3/4"), output("barb", "1/2"), { pressureLossPsi: 0.3 }), // CHANGE
        starterPart("barb_tee_1_2", "1/2\" barb tee", "fitting", 2, 1, 2, input("barb", "1/2"), output("barb", "1/2"), { pressureLossPsi: 0.2 }), // CHANGE
        starterPart("barb_coupler_1_2", "1/2\" barb coupler", "fitting", 1.5, 1, 1, input("barb", "1/2"), output("barb", "1/2"), { pressureLossPsi: 0.1 }), // CHANGE
        starterPart("end_cap_1_2_barb", "1/2\" barb end cap", "cap_end", 1.25, 1, 0, input("barb", "1/2"), output("", ""), { pressureLossPsi: 0 }), // CHANGE
        starterPart("barb_tee_1", "1\" barb tee", "fitting", 5.5, 1, 2, input("barb", "1"), output("barb", "1"), { pressureLossPsi: 0.2 }), // CHANGE
        starterPart("barb_elbow_1", "1\" barb elbow", "fitting", 4.25, 1, 1, input("barb", "1"), output("barb", "1"), { pressureLossPsi: 0.2 }), // CHANGE
        starterPart("barb_coupler_1", "1\" barb coupler", "fitting", 3.75, 1, 1, input("barb", "1"), output("barb", "1"), { pressureLossPsi: 0.1 }), // CHANGE
        starterPart("end_cap_1_barb", "1\" barb end cap", "cap_end", 2.5, 1, 0, input("barb", "1"), output("", ""), { pressureLossPsi: 0 }), // CHANGE
        starterPart("reducer_1_to_3_4_barb", "1\": 3/4\" barb reducer", "fitting", 4.25, 1, 1, input("barb", "1"), output("barb", "3/4"), { pressureLossPsi: 0.3 }), // CHANGE
        starterPart("adapter_3_4_to_1_barb", "3/4\": 1\" barb adapter", "fitting", 4.25, 1, 1, input("barb", "3/4"), output("barb", "1"), { pressureLossPsi: 0.3 }), // CHANGE
        starterPart("micro_tee_1_4", "1/4\" micro tubing tee", "fitting", 0.75, 1, 2, input("barb", "1/4"), output("barb", "1/4"), { pressureLossPsi: 0.1 }), // CHANGE
        starterPart("micro_elbow_1_4", "1/4\" micro tubing elbow", "fitting", 0.65, 1, 1, input("barb", "1/4"), output("barb", "1/4"), { pressureLossPsi: 0.1 }), // CHANGE
        starterPart("micro_coupler_1_4", "1/4\" micro tubing coupler", "fitting", 0.55, 1, 1, input("barb", "1/4"), output("barb", "1/4"), { pressureLossPsi: 0.05 }), // CHANGE
        starterPart("micro_goof_plug_1_4", "1/4\" goof plug / end plug", "cap_end", 0.35, 1, 0, input("barb", "1/4"), output("", ""), { pressureLossPsi: 0 }), // CHANGE
        starterPart("transfer_barb_1_2_to_1_4", "1/2\": 1/4\" barb transfer adapter", "fitting", 0.85, 1, 1, input("barb", "1/2"), output("barb", "1/4"), { pressureLossPsi: 0.2 }), // CHANGE
        starterPart("adapter_1_4_to_1_2_barb", "1/4\": 1/2\" barb adapter", "fitting", 0.85, 1, 1, input("barb", "1/4"), output("barb", "1/2"), { pressureLossPsi: 0.2 }), // CHANGE
        starterPart("poly_mainline_3_4", "3/4\" poly mainline tubing", "pipe_tubing", 0, 1, 1, input("barb", "3/4"), output("barb", "3/4"), { innerDiameterIn: 0.824, hazenWilliamsC: 150 }, 0.42), // CHANGE
        starterPart("poly_mainline_1", "1\" poly mainline tubing", "pipe_tubing", 0, 1, 1, input("barb", "1"), output("barb", "1"), { innerDiameterIn: 1.049, hazenWilliamsC: 150 }, 0.9), // CHANGE
        starterPart("poly_distribution_1_2", "1/2\" distribution tubing", "pipe_tubing", 0, 1, 1, input("barb", "1/2"), output("barb", "1/2"), { innerDiameterIn: 0.600, hazenWilliamsC: 150 }, 0.18), // CHANGE
        starterPart("micro_tubing_1_4", "1/4\" micro tubing", "pipe_tubing", 0, 1, 1, input("barb", "1/4"), output("barb", "1/4"), { innerDiameterIn: 0.170, hazenWilliamsC: 150 }, 0.12), // CHANGE
        starterPart("drip_tape_8mil_12in", "8 mil drip tape, 12\" emitter spacing", "drip_tape", 14, 1, 1, input("barb", "1/2", "drip"), output("barb", "1/2", "drip"), { flowGpm: 1.3, emitterFlowGph: 0.8, emitterSpacingIn: 12, wettedWidthIn: 12, operatingPressurePsi: 10 }, 0.13), // CHANGE
        starterPart("pc_dripline_1_2", "1/2\" pressure-compensating dripline", "dripline", 32, 1, 1, input("barb", "1/2", "drip"), output("barb", "1/2", "drip"), { flowGpm: 1.0, emitterFlowGph: 0.9, emitterSpacingIn: 18, wettedWidthIn: 12, operatingPressurePsi: 12 }, 0.32), // CHANGE
        starterPart("micro_emitter_0_5_gph", "1/4\" drip emitter, 0.5 gph", "emitter", 0.45, 1, 0, input("barb", "1/4", "drip"), output("", ""), { flowGpm: 0.0083, operatingPressurePsi: 15, coveragePattern: "circle", throwRadiusFt: 0.5 }), // CHANGE
        starterPart("micro_emitter_1_0_gph", "1/4\" drip emitter, 1.0 gph", "emitter", 0.45, 1, 0, input("barb", "1/4", "drip"), output("", ""), { flowGpm: 0.0167, operatingPressurePsi: 15, coveragePattern: "circle", throwRadiusFt: 0.5 }), // CHANGE
        starterPart("micro_emitter_2_0_gph", "1/4\" drip emitter, 2.0 gph", "emitter", 0.45, 1, 0, input("barb", "1/4", "drip"), output("", ""), { flowGpm: 0.0333, operatingPressurePsi: 15, coveragePattern: "circle", throwRadiusFt: 0.5 }), // CHANGE
        starterPart("overhead_sprinkler_head_30psi", "Overhead sprinkler head/nozzle, 30 psi", "sprinkler", 14, 1, 1, input("barb", "1/2", "sprinkler"), output("barb", "1/2", "sprinkler"), { flowGpm: 2.5, operatingPressurePsi: 30, coveragePattern: "circle", throwRadiusFt: 8 }), // CHANGE
        starterPart("microspray_stake_20psi", "Nursery microspray stake, 20 psi", "microspray", 8, 1, 1, input("barb", "1/2", "microspray"), output("barb", "1/2", "microspray"), { flowGpm: 1.5, operatingPressurePsi: 20, coveragePattern: "circle", throwRadiusFt: 6 }), // CHANGE
        starterPart("micro_spray_stake_1_4", "1/4\" micro-spray stake, 20 psi", "microspray", 3.5, 1, 0, input("barb", "1/4", "microspray"), output("", ""), { flowGpm: 0.25, operatingPressurePsi: 20, coveragePattern: "circle", throwRadiusFt: 4 }), // CHANGE
        starterPart("soaker_row_line_1_2", "1/2\" soaker row line", "dripline", 30, 1, 1, input("barb", "1/2", "drip"), output("barb", "1/2", "drip"), { flowGpm: 1.3, emitterFlowGph: 0.8, emitterSpacingIn: 12, wettedWidthIn: 18, operatingPressurePsi: 10 }, 0.30), // CHANGE
        starterPart("bubbler_emitter_1_2", "Perennial bubbler emitter", "bubbler", 5, 1, 1, input("barb", "1/2", "bubbler"), output("barb", "1/2", "bubbler"), { flowGpm: 1.0, operatingPressurePsi: 15, coveragePattern: "circle", throwRadiusFt: 2 }), // CHANGE
        starterPart("hose_standpipe_1_2", "Manual hose standpipe", "standpipe", 22, 1, 1, input("barb", "1/2", "standpipe"), output("barb", "1/2", "standpipe"), { flowGpm: 2.0, operatingPressurePsi: 20 }) // CHANGE
    ].concat(GENERATED_THREAD_CONNECTOR_CATALOG_ITEMS, GENERATED_CONNECTOR_CATALOG_ITEMS);

    let activeIrrigationMode = null;
    let hudSyncTimer = null;
    let hudSyncModuleCell = null;
    let activeConnectionComboboxClose = null;
    let inactiveEntryOverlay = null;
    let inactiveEntryRefreshTimer = null;
    let closingIrrigationModeSession = null;
    let programmaticEdgeInsertDepth = 0;
    let activeIrrigationEditDepth = 0;
    let pendingHudGraphSyncModuleCells = [];
    let irrigationUndoRedoReplayDepth = 0;
    let irrigationDebugQuietDepth = 0;

    installIrrigationUndoRedoReplayGuard();

    function runTrellisHistoryTransaction(metadata, operation) {
        const history = typeof window !== "undefined" && window.Trellis && window.Trellis.history;
        if (history && typeof history.run === "function" && !isTrellisHistoryRestoring()) {
            return history.run(metadata, operation);
        }
        return operation();
    }

    function isTrellisHistoryRestoring() {
        const history = typeof window !== "undefined" && window.Trellis && window.Trellis.history;
        return !!(history && typeof history.isRestoring === "function" && history.isRestoring());
    }

    function runIrrigationEdit(label, fn) {
        if (activeIrrigationEditDepth > 0) return fn();
        return runTrellisHistoryTransaction({ category: "Irrigation", action: label || "edit", origin: "Garden_Irrigation_Planner", title: "Irrigation: " + (label || "edit") }, function () {
            activeIrrigationEditDepth++;
            model.beginUpdate && model.beginUpdate();
            try {
                const result = fn();
                flushQueuedHudGraphStateSync();
                return result;
            } finally {
                try { model.endUpdate && model.endUpdate(); } finally { activeIrrigationEditDepth = Math.max(0, activeIrrigationEditDepth - 1); }
            }
        });
    }

    function queueHudGraphStateSync(moduleCell) {
        if (!moduleCell || pendingHudGraphSyncModuleCells.indexOf(moduleCell) >= 0) return;
        pendingHudGraphSyncModuleCells.push(moduleCell);
    }

    function flushQueuedHudGraphStateSync() {
        if (isTrellisHistoryRestoring()) { pendingHudGraphSyncModuleCells = []; return; }
        const targets = pendingHudGraphSyncModuleCells.slice();
        pendingHudGraphSyncModuleCells = [];
        targets.forEach(function (moduleCell) { syncHudGraphState(moduleCell); });
    }

    function isIrrigationUndoRedoReplay() {
        return irrigationUndoRedoReplayDepth > 0 || graph.__trellisIrrigationUndoRedoReplayDepth > 0;
    }

    function installIrrigationUndoRedoReplayGuard() {
        graph.__trellisIrrigationUndoRedoReplayDepth = graph.__trellisIrrigationUndoRedoReplayDepth || 0;
        if (graph.__trellisIrrigationUndoRedoReplayGuardInstalled) return;
        graph.__trellisIrrigationUndoRedoReplayGuardInstalled = true;
        const um = ui && ui.editor && ui.editor.undoManager;
        if (!um || typeof um.undo !== "function" || typeof um.redo !== "function") return;
        const oldUndo = um.undo.bind(um);
        const oldRedo = um.redo.bind(um);
        um.undo = function () {
            irrigationUndoRedoReplayDepth++;
            graph.__trellisIrrigationUndoRedoReplayDepth++;
            try { return oldUndo(); } finally { irrigationUndoRedoReplayDepth = Math.max(0, irrigationUndoRedoReplayDepth - 1); graph.__trellisIrrigationUndoRedoReplayDepth = Math.max(0, graph.__trellisIrrigationUndoRedoReplayDepth - 1); }
        };
        um.redo = function () {
            irrigationUndoRedoReplayDepth++;
            graph.__trellisIrrigationUndoRedoReplayDepth++;
            try { return oldRedo(); } finally { irrigationUndoRedoReplayDepth = Math.max(0, irrigationUndoRedoReplayDepth - 1); graph.__trellisIrrigationUndoRedoReplayDepth = Math.max(0, graph.__trellisIrrigationUndoRedoReplayDepth - 1); }
        };
    }

    function generateLabelOnlyConnectorParts() {
        const families = [
            { id: "twist_lock", label: "Twist-lock" },
            { id: "push_connect", label: "Push-to-connect" }
        ];
        const sizes = STARTER_CONNECTOR_SIZES;
        const parts = [];
        families.forEach(function (family) {
            sizes.forEach(function (size) {
                parts.push(labelOnlyConnectorPart(family, "coupler", size, size, 1, size.cost, starterConnectorPairName(input(family.id, size.label), output(family.id, size.label)) + " coupler")); // CHANGE
                parts.push(labelOnlyConnectorPart(family, "tee", size, size, 2, size.cost + 0.75, starterConnectorPairName(input(family.id, size.label), output(family.id, size.label)) + " tee")); // CHANGE
                parts.push(labelOnlyConnectorPart(family, "elbow", size, size, 1, size.cost + 0.35, starterConnectorPairName(input(family.id, size.label), output(family.id, size.label)) + " elbow")); // CHANGE
                parts.push(labelOnlyConnectorPart(family, "end_cap", size, null, 0, Math.max(0.75, size.cost - 0.6), starterConnectorName(input(family.id, size.label)) + " end cap")); // CHANGE
            });
            sizes.forEach(function (from) {
                sizes.forEach(function (to) {
                    if (from.id === to.id) return;
                    const cost = Math.max(from.cost, to.cost) + 0.85;
                    parts.push(labelOnlyConnectorPart(family, "adapter", from, to, 1, cost, starterConnectorPairName(input(family.id, from.label), output(family.id, to.label)) + " adapter")); // CHANGE
                });
            });
        });
        return parts;
    }

    function labelOnlyConnectorPart(family, kind, inputSize, outputSize, outputs, cost, name) {
        const id = family.id + "_" + kind + "_" + inputSize.id + (outputSize && outputSize.id !== inputSize.id ? "_to_" + outputSize.id : "");
        return starterPart(id, name, "fitting", cost, 1, outputs, input(family.id, inputSize.label, "", true), output(outputSize ? family.id : "", outputSize ? outputSize.label : "", "", null, !!outputSize), { pressureLossPsi: outputs > 0 ? 0.2 : 0 });
    }

    function generateThreadConnectorParts() {
        const preservedIds = new Set(["mpt_nipple_3_4", "fpt_coupler_3_4", "mpt_to_3_4_barb_adapter", "fpt_to_3_4_barb_adapter"]);
        const pipeFamilies = [
            { id: "barb", label: "barb", costOffset: 0 },
            { id: "twist_lock", label: "twist-lock", costOffset: 0.75 },
            { id: "push_connect", label: "push-to-connect", costOffset: 0.75 }
        ];
        const parts = [];
        function add(part) { if (part && !preservedIds.has(part.id)) parts.push(part); }
        STARTER_CONNECTOR_SIZES.forEach(function (size) {
            add(pipeThreadBasicPart("mpt_nipple", "close nipple", "mpt", size, size.cost + 0.75)); // CHANGE
            add(pipeThreadBasicPart("fpt_coupler", "coupler", "fpt", size, size.cost + 0.75)); // CHANGE
            pipeFamilies.forEach(function (family) {
                add(threadToPipeAdapterPart("mpt", family, size, size.cost + family.costOffset + 1));
                add(threadToPipeAdapterPart("fpt", family, size, size.cost + family.costOffset + 1));
            });
        });
        return parts;
    }

    function pipeThreadBasicPart(prefix, label, connectorType, size, cost) {
        return starterPart(prefix + "_" + size.id, starterConnectorPairName(input(connectorType, size.label), output(connectorType, size.label)) + " " + label, "fitting", cost, 1, 1, input(connectorType, size.label), output(connectorType, size.label), { pressureLossPsi: 0.1 }); // CHANGE
    }

    function threadToPipeAdapterPart(threadType, pipeFamily, size, cost) {
        return starterPart(threadType + "_to_" + size.id + "_" + pipeFamily.id + "_adapter", starterConnectorPairName(input(threadType, size.label), output(pipeFamily.id, size.label, "", null, true)) + " adapter", "fitting", cost, 1, 1, input(threadType, size.label), output(pipeFamily.id, size.label, "", null, true), { pressureLossPsi: 0.2 }); // CHANGE
    }

    function starterConnectorPairName(inputConnector, outputConnector) { // CHANGE
        const inlet = normalizeConnectorRecord(inputConnector || {}); // CHANGE
        const outlet = normalizeConnectorRecord(outputConnector || {}); // CHANGE
        if (!outlet.type || !outlet.nominalSize) return starterConnectorName(inlet); // CHANGE
        if (inlet.type === outlet.type && inlet.nominalSize === outlet.nominalSize) return starterConnectorName(inlet); // CHANGE
        if (inlet.type === outlet.type) return starterSizeName(inlet.nominalSize) + ": " + starterSizeName(outlet.nominalSize) + " " + connectorPartTypeName(inlet.type); // CHANGE
        if (inlet.nominalSize === outlet.nominalSize) return starterSizeName(inlet.nominalSize) + " " + connectorPartTypeName(inlet.type) + ": " + connectorPartTypeName(outlet.type); // CHANGE
        return starterConnectorName(inlet) + ": " + starterConnectorName(outlet); // CHANGE
    }

    function starterConnectorName(connector) { // CHANGE
        const c = normalizeConnectorRecord(connector || {}); // CHANGE
        return [starterSizeName(c.nominalSize), connectorPartTypeName(c.type)].filter(Boolean).join(" "); // CHANGE
    }

    function starterSizeName(size) { // CHANGE
        const normalized = String(size || "").trim(); // CHANGE
        return normalized ? normalized + "\"" : ""; // CHANGE
    }

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
        if (!node) return false;
        let changed = false;
        Object.keys(attrs || {}).forEach(function (key) {
            const value = attrs[key];
            const current = node.getAttribute(key);
            if (value == null || value === "") {
                if (current != null) { node.removeAttribute(key); changed = true; }
            } else {
                const next = String(value);
                if (current !== next) { node.setAttribute(key, next); changed = true; }
            }
        });
        if (!changed) return false;
        if (model.setValue) model.setValue(cell, node);
        else cell.value = node;
        return true;
    }

    function setCellStyle(cell, style) {
        if (!cell) return false;
        const next = String(style || "");
        if (String(cell.style || "") === next) return false;
        if (model.setStyle) model.setStyle(cell, next);
        else cell.style = next;
        return true;
    }

    function styleValue(style, key) {
        const prefix = String(key || "") + "=";
        const token = String(style || "").split(";").find(function (part) { return part.indexOf(prefix) === 0; });
        return token ? token.slice(prefix.length) : "";
    }

    function setStyleValue(style, key, value) {
        const prefix = String(key || "") + "=";
        const parts = String(style || "").split(";").filter(function (part) { return part && part.indexOf(prefix) !== 0; });
        if (value != null && value !== "") parts.push(prefix + value);
        return parts.length ? parts.join(";") + ";" : "";
    }

    function bedAssemblyLabelAboveBedStyle(style) { // CHANGE
        let next = String(style || ""); // CHANGE
        if (/(^|;)swimlane(;|$)/.test(next)) return next; // CHANGE
        if (styleValue(next, "container") !== "1") return next; // CHANGE
        next = setStyleValue(next, "labelPosition", "center"); // CHANGE
        next = setStyleValue(next, "verticalLabelPosition", "top"); // CHANGE
        next = setStyleValue(next, "verticalAlign", "bottom"); // CHANGE
        next = setStyleValue(next, "spacingTop", "0"); // CHANGE
        next = setStyleValue(next, "spacingBottom", "2"); // CHANGE
        return next; // CHANGE
    } // CHANGE

    function syncBedAssemblyLabelStyle(assembly) { // CHANGE
        if (!isBedAssembly(assembly)) return false; // CHANGE
        return setCellStyle(assembly, bedAssemblyLabelAboveBedStyle(assembly.style)); // CHANGE
    } // CHANGE

    function normalizePartState(value) {
        return String(value || "").trim() === PART_STATE_COMPLETED ? PART_STATE_COMPLETED : PART_STATE_PLANNED;
    }

    function partStateForCell(cell) {
        return normalizePartState(getCellAttr(cell, ATTRS.PART_STATE, ""));
    }

    function partStateForRecord(record) {
        return normalizePartState(record && record.partState);
    }

    function isCompletedPartState(state) {
        return normalizePartState(state) === PART_STATE_COMPLETED;
    }

    function assemblyPartStyleForState(state) {
        return isCompletedPartState(state) ? ASSEMBLY_PART_COMPLETED_STYLE : ASSEMBLY_PART_PLANNED_STYLE;
    }

    function bedLayoutStyleForState(state) {
        return isCompletedPartState(state) ? BED_LAYOUT_COMPLETED_STYLE : BED_LAYOUT_PLANNED_STYLE;
    }

    function normalizeLifecycleAttrs(attrs) {
        return Object.assign({ [ATTRS.PART_STATE]: PART_STATE_PLANNED }, attrs || {}, { [ATTRS.PART_STATE]: normalizePartState(attrs && attrs[ATTRS.PART_STATE]) });
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

    function setGeometry(cell, geometryPatch) {
        if (!cell) return;
        const current = getGeometry(cell);
        if (!current) return;
        const next = current.clone ? current.clone() : Object.assign({}, current);
        let changed = false;
        Object.keys(geometryPatch || {}).forEach(function (key) { if (next[key] !== geometryPatch[key]) { next[key] = geometryPatch[key]; changed = true; } });
        if (!changed) return false;
        if (model.setGeometry) model.setGeometry(cell, next);
        else cell.geometry = next;
        return true;
    }

    const GraphStore = {
        getAttr: getCellAttr,
        setAttrs: setCellAttrs,
        getId: getCellId,
        children: getChildCells,
        descendants: collectDescendants,
        geometry: getGeometry,
        setGeometry,
        findById: findCellById,
        readJsonAttr: function (cell, attr, fallback) { return safeJsonParse(getCellAttr(cell, attr, ""), fallback); },
        writeJsonAttr: function (cell, attr, value) { const raw = JSON.stringify(value); if (getCellAttr(cell, attr, "") !== raw) setCellAttrs(cell, { [attr]: raw }); return value; }
    };

    function unitsToCm(units) {
        return Number(units) / (PX_PER_CM * DRAW_SCALE);
    }

    function unitsToAreaM2(widthUnits, heightUnits) {
        const wM = unitsToCm(widthUnits) / 100;
        const hM = unitsToCm(heightUnits) / 100;
        return Math.max(0, wM * hM);
    }

    function readCatalog(moduleCell) {
        const parsed = GraphStore.readJsonAttr(moduleCell, ATTRS.CATALOG_JSON, null);
        const items = parsed && Array.isArray(parsed.items) ? parsed.items : [];
        const version = parsed && Number.isFinite(Number(parsed.version)) ? Number(parsed.version) : (items.length ? 1 : 0);
        return {
            version,
            items: items.map(normalizeCatalogPart).filter(Boolean)
        };
    }

    function writeCatalog(moduleCell, catalog) {
        if (activeIrrigationEditDepth === 0) return runIrrigationEdit("writeCatalog", function () { return writeCatalog(moduleCell, catalog); });
        const items = (catalog && Array.isArray(catalog.items) ? catalog.items : catalog || [])
            .map(normalizeCatalogPart)
            .filter(Boolean);
        GraphStore.writeJsonAttr(moduleCell, ATTRS.CATALOG_JSON, { version: PLUGIN_VERSION, items });
        return { version: PLUGIN_VERSION, items };
    }

    function input(type, nominalSize, method, pipeConnection) {
        return { type: normalizeConnectorType(type), nominalSize: nominalSize || "", pipeConnection: !!pipeConnection };
    }

    function output(type, nominalSize, method, maxFlowGpm, pipeConnection) {
        return { type: normalizeConnectorType(type), nominalSize: nominalSize || "", maxFlowGpm: maxFlowGpm == null ? null : maxFlowGpm, pipeConnection: !!pipeConnection };
    }

    function starterPart(id, name, category, cost, inputs, outputs, inputConnector, outputConnector, specs, unitCost) {
        const starterInput = normalizeConnectorRecord(inputConnector || {});
        const starterOutput = normalizeConnectorRecord(outputConnector || {});
        if (starterInput.type === "barb") starterInput.pipeConnection = true;
        if (starterOutput.type === "barb") starterOutput.pipeConnection = true;
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
                input: starterInput,
                output: starterOutput
            },
            specs: Object.assign({}, specs || {})
        };
    }

    function starterCatalog() {
        return { version: PLUGIN_VERSION, items: STARTER_CATALOG_ITEMS.map(normalizeCatalogPart).filter(Boolean) };
    }

    function starterCatalogUpgradeItems() {
        return STARTER_CATALOG_ITEMS
            .map(normalizeCatalogPart)
            .filter(function (part) { return part && CATALOG_UPGRADE_PART_IDS.has(part.id); });
    }

    function isObsoleteFamilyTubingPart(part) {
        const p = normalizeCatalogPart(part);
        return !!(p && p.category === "pipe_tubing" && (/^(twist_lock|push_connect)_tubing_/).test(p.id));
    }

    function mergeCatalogUpgradeParts(moduleCell, currentCatalog) {
        const current = currentCatalog || readCatalog(moduleCell);
        const items = (current.items || []).filter(function (item) { return !isObsoleteFamilyTubingPart(item); });
        const usedIds = new Set(items.map(function (item) { return item.id; }));
        starterCatalogUpgradeItems().forEach(function (part) {
            if (!usedIds.has(part.id)) {
                usedIds.add(part.id);
                items.push(part);
            }
        });
        return writeCatalog(moduleCell, { items });
    }

    function pruneObsoleteFamilyTubingParts(moduleCell, currentCatalog) {
        const current = currentCatalog || readCatalog(moduleCell);
        if (!(current.items || []).some(isObsoleteFamilyTubingPart)) return current;
        return writeCatalog(moduleCell, { items: (current.items || []).filter(function (item) { return !isObsoleteFamilyTubingPart(item); }) });
    }

    function seedStarterCatalogIfEmpty(moduleCell) {
        const current = readCatalog(moduleCell);
        if (!moduleCell) return current;
        if (current.items.length > 0 && current.version < PLUGIN_VERSION) return mergeCatalogUpgradeParts(moduleCell, current);
        if (current.items.length > 0) return pruneObsoleteFamilyTubingParts(moduleCell, current);
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

    function normalizeConnectorType(type) {
        const normalized = String(type || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
        if (normalized === "twist" || normalized === "twistlock") return "twist_lock";
        if (normalized === "push_connect" || normalized === "push_to_connect" || normalized === "pushconnect") return "push_connect";
        return normalized;
    }

    function isPipeConnectorType(type) {
        return PIPE_CONNECTOR_TYPES.has(normalizeConnectorType(type));
    }

    function connectorUsesPipe(connector) {
        const c = normalizeConnectorRecord(connector);
        return !!(c.pipeConnection || isPipeConnectorType(c.type));
    }

    function pipeStyleConnectorMatches(source, target) {
        if (!source || !target) return { ok: false, reason: "Missing connector." };
        if (!connectorUsesPipe(source) || !connectorUsesPipe(target)) return { ok: false, reason: connectorTypeMismatchReason(source.type, target.type) };
        if (!source.nominalSize || !target.nominalSize) return { ok: false, reason: "Missing connector size." };
        if (source.nominalSize !== target.nominalSize) return { ok: false, reason: "Pipe Edge size mismatch." };
        return { ok: true, reason: "" };
    }

    function connectorTypeLabel(type) {
        const normalized = normalizeConnectorType(type);
        return normalized.replace(/_/g, " ");
    }

    function connectorTypeDisplayLabel(type) {
        const normalized = normalizeConnectorType(type);
        return normalized ? normalized.toUpperCase().replace(/_/g, " ") : "connector?";
    }

    function connectorDisplayLabel(connector) {
        const c = normalizeConnectorRecord(connector);
        const size = c.nominalSize || "size?";
        if (isPipeConnectorType(c.type)) return size;
        return size + " " + connectorTypeDisplayLabel(c.type);
    }

    function connectionDisplayLabel(sourceConnector, targetConnector) {
        const sourceLabel = connectorDisplayLabel(sourceConnector);
        const targetLabel = connectorDisplayLabel(targetConnector);
        return sourceLabel === targetLabel ? sourceLabel : sourceLabel + " -> " + targetLabel;
    }

    function normalizeOperatingPressureSpecs(specs) {
        const source = specs || {};
        const legacy = finiteNumber(source.operatingPressurePsi, null);
        return {
            minOperatingPressurePsi: finiteNumber(source.minOperatingPressurePsi, legacy),
            maxOperatingPressurePsi: finiteNumber(source.maxOperatingPressurePsi, null)
        };
    }

    function normalizeCatalogSpecs(specs) {
        const source = specs || {}; // CHANGE
        const normalized = Object.assign({}, source, normalizeOperatingPressureSpecs(source), normalizeLinearFlowSpecs(source), normalizeCoverageSpecs(source)); // CHANGE
        delete normalized.operatingPressurePsi;
        return normalized;
    }

    function normalizeLinearFlowSpecs(specs) { // NEW
        const source = specs || {}; // NEW
        const emitterFlowGph = finiteNumber(source.emitterFlowGph, null); // NEW
        const emitterSpacingIn = finiteNumber(source.emitterSpacingIn, null); // NEW
        const legacyFlowGpmPerMeter = finiteNumber(source.flowGpmPerMeter, null); // NEW
        const out = { // NEW
            emitterFlowGph, // NEW
            emitterSpacingIn, // NEW
            flowGpmPerFoot: finiteNumber(source.flowGpmPerFoot, null), // NEW
            flowGpmPerMeter: legacyFlowGpmPerMeter, // NEW
            wettedWidthIn: finiteNumber(source.wettedWidthIn, null) // NEW
        }; // NEW
        if (emitterFlowGph > 0 && emitterSpacingIn > 0) { // NEW
            out.flowGpmPerFoot = emitterFlowGph * (12 / emitterSpacingIn) / 60; // NEW
            out.flowGpmPerMeter = out.flowGpmPerFoot / 0.3048; // NEW
        } // NEW
        return out; // NEW
    } // NEW

    function normalizeCoverageSpecs(specs) { // NEW
        const source = specs || {}; // NEW
        const pattern = String(source.coveragePattern || "").trim().toLowerCase().replace(/[\s-]+/g, "_"); // NEW
        return { // NEW
            coveragePattern: ["circle", "arc", "strip", "rectangle"].indexOf(pattern) >= 0 ? pattern : "", // NEW
            throwRadiusFt: finiteNumber(source.throwRadiusFt, null), // NEW
            throwDiameterFt: finiteNumber(source.throwDiameterFt, null), // NEW
            arcDegrees: finiteNumber(source.arcDegrees, null), // NEW
            coverageDirectionDeg: finiteNumber(source.coverageDirectionDeg, null) // NEW
        }; // NEW
    } // NEW

    function unitCostAppliesToCategory(category) {
        return isLinearPipeStyleCategory(category);
    }

    function isLinearPipeStyleCategory(category) { // NEW
        return LINEAR_PIPE_STYLE_CATEGORIES.has(String(category || "").trim()); // NEW
    } // NEW

    function isSelfEmittingLinearCategory(category) { // NEW
        return BED_SELF_EMITTING_ROW_CATEGORIES.has(String(category || "").trim()); // NEW
    } // NEW

    function pipeStyleConnectorFamilyFromPart(part) { // NEW
        const connectors = part && part.connectors || {}; // NEW
        const candidates = [connectors.input || connectors.in, connectors.output || connectors.out]; // NEW
        for (let i = 0; i < candidates.length; i++) { // NEW
            const connector = normalizeConnectorRecord(candidates[i] || {}); // NEW
            if (isPipeConnectorType(connector.type)) return connector.type; // NEW
        } // NEW
        return "barb"; // NEW
    } // NEW

    function inferredLinearConnectors(part, size) { // NEW
        const connectors = part && part.connectors || {}; // NEW
        const inputConnector = normalizeConnectorRecord(connectors.input || connectors.in); // NEW
        const outputConnector = normalizeConnectorRecord(connectors.output || connectors.out); // NEW
        const family = pipeStyleConnectorFamilyFromPart(part); // NEW
        const nominalSize = String(size || inputConnector.nominalSize || outputConnector.nominalSize || "3/4").trim(); // NEW
        const inputPipeConnection = inputConnector.type ? inputConnector.pipeConnection : true; // NEW
        const outputPipeConnection = outputConnector.type ? outputConnector.pipeConnection : true; // NEW
        return { // NEW
            inputs: 1, // NEW
            outputs: 1, // NEW
            input: Object.assign({}, inputConnector, { type: family, nominalSize, pipeConnection: inputPipeConnection }), // NEW
            output: Object.assign({}, outputConnector, { type: family, nominalSize, pipeConnection: outputPipeConnection }) // NEW
        }; // NEW
    } // NEW

    function normalizeLinearPipeStylePart(part, normalized) { // NEW
        if (!normalized || !isLinearPipeStyleCategory(normalized.category)) return normalized; // NEW
        return Object.assign({}, normalized, { connectors: inferredLinearConnectors(part, catalogPipeSizeForRawPart(part, normalized)) }); // NEW
    } // NEW

    function catalogPipeSizeForRawPart(part, normalized) { // NEW
        const connectors = part && part.connectors || normalized && normalized.connectors || {}; // NEW
        const inputConnector = normalizeConnectorRecord(connectors.input || connectors.in); // NEW
        const outputConnector = normalizeConnectorRecord(connectors.output || connectors.out); // NEW
        return inputConnector.nominalSize || outputConnector.nominalSize || "3/4"; // NEW
    }

    function normalizeConnectorRecord(connector) {
        const c = connector || {};
        const type = normalizeConnectorType(c.type || c.connectionType);
        return {
            type,
            nominalSize: String(c.nominalSize || c.size || "").trim(),
            pipeType: String(c.pipeType || "").trim(),
            pipeConnection: c.pipeConnection === true || c.pipeConnection === "true" || c.pipeConnection === "1",
            maxFlowGpm: finiteNumber(c.maxFlowGpm, null),
            minPressurePsi: finiteNumber(c.minPressurePsi, null),
            maxPressurePsi: finiteNumber(c.maxPressurePsi, null)
        };
    }

    function normalizeCatalogPart(part) {
        if (!part || typeof part !== "object") return null;
        const connectors = part.connectors || {};
        const stockQuantity = Math.max(0, finiteNumber(part.stockQuantity, 0));
        const normalized = {
            id: String(part.id || "").trim(),
            name: String(part.name || "").trim(),
            category: String(part.category || "").trim(),
            stockState: VALID_STOCK_STATES.includes(part.stockState) ? part.stockState : "unknown",
            stockQuantity,
            cost: finiteNumber(part.cost, 0),
            unitCost: unitCostAppliesToCategory(part.category) ? finiteNumber(part.unitCost, finiteNumber(part.cost, 0)) : null,
            connectors: {
                inputs: Math.max(0, Math.floor(finiteNumber(connectors.inputs, 0))),
                outputs: Math.max(0, Math.floor(finiteNumber(connectors.outputs, 0))),
                input: normalizeConnectorRecord(connectors.input || connectors.in),
                output: normalizeConnectorRecord(connectors.output || connectors.out)
            },
            specs: normalizeCatalogSpecs(part.specs || {})
        };
        return normalizeLinearPipeStylePart(part, normalized); // CHANGE
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

    function isReversibleFittingPart(part) {
        const p = normalizeCatalogPart(part);
        return !!(p && p.category === "fitting" && p.connectors.inputs === 1 && p.connectors.outputs === 1 && validateCatalogPart(p).ok);
    }

    function stockStateForQuantity(quantity) {
        return finiteNumber(quantity, 0) > 0 ? "in_stock" : "out_of_stock";
    }

    function requiresHydraulicSpecs(part) {
        return ["pipe_tubing", "drip_tape", "dripline", "emitter", "sprinkler", "microspray", "bubbler", "valve", "manifold", "regulator", "filter"].indexOf(part.category) >= 0;
    }

    function hasHydraulicSpecs(part) {
        if (part.category === "pipe_tubing") {
            return Number(part.specs.innerDiameterIn) > 0;
        }
        if (isSelfEmittingLinearCategory(part.category)) return Number(part.specs.flowGpmPerMeter) > 0 || Number(part.specs.flowGpm) >= 0 || Number(part.specs.minOperatingPressurePsi) > 0; // NEW
        return Number(part.specs.flowGpm) >= 0 || Number(part.specs.minOperatingPressurePsi) > 0 || Number(part.specs.pressureLossPsi) >= 0;
    }

    function finiteNumber(value, fallback) {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }

    function nominalSizeInchesForPipeStyle(value) {
        const text = String(value || "").trim();
        if (!text) return null;
        const fraction = text.match(/^([0-9]+(?:\.[0-9]+)?)\/([0-9]+(?:\.[0-9]+)?)$/);
        if (fraction) {
            const numerator = finiteNumber(fraction[1], null);
            const denominator = finiteNumber(fraction[2], null);
            return numerator > 0 && denominator > 0 ? numerator / denominator : null;
        }
        const decimal = finiteNumber(text, null);
        return decimal > 0 ? decimal : null;
    }

    function formatStyleNumber(value) {
        const rounded = Math.round(finiteNumber(value, 0) * 100) / 100;
        return String(rounded).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
    }

    function pipeEdgeStrokeWidthForSize(value) {
        const inches = nominalSizeInchesForPipeStyle(value);
        if (!(inches > 0)) return "";
        return formatStyleNumber(Math.min(PIPE_EDGE_MAX_STROKE_WIDTH, Math.max(1, inches / PIPE_EDGE_STROKE_UNIT_IN)));
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

    function connectorTypesMate(sourceType, targetType) {
        const source = String(sourceType || "").trim();
        const target = String(targetType || "").trim();
        if (!source || !target) return false;
        if (source === "mght" || source === "fght" || target === "mght" || target === "fght") return (source === "mght" && target === "fght") || (source === "fght" && target === "mght");
        if (source === "mpt" || source === "fpt" || target === "mpt" || target === "fpt") return (source === "mpt" && target === "fpt") || (source === "fpt" && target === "mpt");
        return false;
    }

    function connectorTypeMismatchReason(sourceType, targetType) {
        const source = String(sourceType || "").trim();
        const target = String(targetType || "").trim();
        if (!source || !target) return "Connector type mismatch.";
        if (source === "ght" || target === "ght") return "Gendered GHT connector required.";
        if ((source === "mght" && target === "mght") || (source === "fght" && target === "fght")) return "GHT gender mismatch.";
        if ((source === "mpt" && target === "mpt") || (source === "fpt" && target === "fpt")) return "Pipe thread gender mismatch.";
        if (source === target) return "Gendered connector required for non-pipe connection.";
        return "Connector type mismatch.";
    }

    function connectorMatches(source, target, endpointRequirement) {
        if (!source || !target) return { ok: false, reason: "Missing connector." };
        if (!connectorTypesMate(source.type, target.type)) return { ok: false, reason: connectorTypeMismatchReason(source.type, target.type) };
        if (!source.nominalSize || !target.nominalSize) return { ok: false, reason: "Missing connector size." };
        if (source.nominalSize !== target.nominalSize) return { ok: false, reason: "Adapter required for size mismatch." };
        if (source.pipeType && target.pipeType && source.pipeType !== target.pipeType) return { ok: false, reason: "Pipe type mismatch." };
        return { ok: true, reason: "" };
    }

    function pipeConnectorMatches(source, target) {
        return pipeStyleConnectorMatches(source, target);
    }

    function connectorRecordsRequirePipe(sourceConnector, targetConnector) {
        return connectorUsesPipe(sourceConnector) && connectorUsesPipe(targetConnector);
    }

    function connectorRecordsMatch(sourceConnector, targetConnector, endpointRequirement) {
        return connectorRecordsRequirePipe(sourceConnector, targetConnector) ? pipeConnectorMatches(sourceConnector, targetConnector) : connectorMatches(sourceConnector, targetConnector, endpointRequirement);
    }

    function canConnectParts(previousPart, nextPart, endpointRequirement) {
        const prev = normalizeCatalogPart(previousPart);
        const next = normalizeCatalogPart(nextPart);
        if (!prev || !next) return { ok: false, reason: "Missing part." };
        if (prev.connectors.outputs <= 0) return { ok: false, reason: "Previous part has no output connector." };
        if (next.connectors.inputs <= 0) return { ok: false, reason: "Next part has no input connector." };
        return connectorRecordsMatch(prev.connectors.output, next.connectors.input, endpointRequirement);
    }

    function canEndpointConnectToPart(endpointRequirement, nextPart) {
        const req = normalizeEndpointProfile(endpointRequirement);
        const next = normalizeCatalogPart(nextPart);
        if (!next) return { ok: false, reason: "Missing part." };
        if (!req.connectorType || !req.nominalSize) return { ok: false, reason: "Endpoint requirement is incomplete." };
        if (next.connectors.inputs <= 0) return { ok: false, reason: "Next part has no input connector." };
        return connectorRecordsMatch({
            type: req.connectorType,
            nominalSize: req.nominalSize,
            pipeType: req.pipeType || "",
            pipeConnection: !!req.pipeConnection
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
        return connectorRecordsMatch(p.connectors.output, {
            type: req.connectorType,
            nominalSize: req.nominalSize,
            pipeType: req.pipeType || "",
            pipeConnection: !!req.pipeConnection
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
        const entries = (parts || []).map(normalizeSuggestionPartEntry).filter(Boolean); // NEW
        const purchaseParts = entries.map(function (entry) { return entry.part; }).filter(function (part) { return PURCHASE_NEEDED.has(part.stockState); }); // CHANGE
        return {
            partIds: entries.map(function (entry) { return entry.part.id; }), // CHANGE
            parts: entries.map(function (entry) { return { partId: entry.part.id, flipped: !!entry.flipped }; }), // NEW
            labels: entries.map(function (entry) { return installedPartDisplayName(entry.part, entry.flipped); }), // CHANGE
            totalParts: entries.length, // CHANGE
            purchaseNeededParts: purchaseParts.length,
            purchaseNeededCost: purchaseParts.reduce(function (sum, part) { return sum + finiteNumber(part.cost || part.unitCost, 0); }, 0)
        };
    }

    function normalizeSuggestionPartEntry(entry) { // NEW
        const rawPart = entry && entry.part ? entry.part : entry; // NEW
        const part = normalizeCatalogPart(rawPart); // NEW
        if (!part) return null; // NEW
        return { part, flipped: !!(entry && entry.flipped) }; // NEW
    } // NEW

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
                    type: profile.connectorType,
                    nominalSize: profile.nominalSize,
                    pipeType: profile.pipeType || "",
                    pipeConnection: !!profile.pipeConnection,
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
            connectorType: normalizeConnectorType(p.connectorType || p.type),
            nominalSize: String(p.nominalSize || p.size || "").trim(),
            pipeType: String(p.pipeType || "").trim(),
            pipeConnection: p.pipeConnection === true || p.pipeConnection === "true" || p.pipeConnection === "1",
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

    function createVertex(parent, label, x, y, w, h, style, attrs, index) { // CHANGE
        let cell = null;
        const insertIndex = index == null ? null : Math.max(0, Math.min(getChildCells(parent).length, Math.floor(finiteNumber(index, getChildCells(parent).length)))); // NEW
        if (graph.insertVertex) {
            cell = graph.insertVertex(parent, null, label || "", x, y, w, h, style || "");
            if (cell && insertIndex != null && model.add && (model.getParent ? model.getParent(cell) : cell.parent) === parent) model.add(parent, cell, insertIndex); // NEW
        } else if (typeof mxCell !== "undefined" && typeof mxGeometry !== "undefined") {
            cell = new mxCell(label || "", new mxGeometry(x, y, w, h), style || "");
            cell.vertex = true;
            if (model.add) model.add(parent, cell, insertIndex == null ? undefined : insertIndex); // CHANGE
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
                [ATTRS.PART_STATE]: PART_STATE_PLANNED,
                [ATTRS.ENDPOINT_PROFILE_JSON]: JSON.stringify(normalized)
            });
    }

    function createAssemblyLane(moduleCell, label, x, y, type, attrs, size) {
        const laneWidth = size && size.width != null ? size.width : ASSEMBLY_DEFAULT_WIDTH;
        const laneHeight = size && size.height != null ? size.height : assemblyPartLaneHeight(1); // CHANGE
        return createVertex(moduleCell, label || "Assembly", x, y, laneWidth, laneHeight,
            "swimlane;whiteSpace=wrap;html=1;startSize=" + ASSEMBLY_HEADER_SIZE + ";horizontal=1;childLayout=stackLayout;horizontalStack=0;resizeParent=0;resizeLast=0;collapsible=1;rounded=1;fillColor=#ffffff;strokeColor=#666666;fontStyle=1;",
            Object.assign({
                label: label || "Assembly",
                [ATTRS.ASSEMBLY]: "1",
                [ATTRS.ASSEMBLY_TYPE]: type || "parts"
            }, attrs || {}));
    }

    function assemblyPartY(index) { // NEW
        return ASSEMBLY_HEADER_SIZE + Math.max(0, Math.floor(finiteNumber(index, 0))) * ASSEMBLY_PART_HEIGHT; // NEW
    } // NEW

    function assemblyPartLaneHeight(partCount) { // NEW
        return ASSEMBLY_HEADER_SIZE + Math.max(1, Math.floor(finiteNumber(partCount, 1))) * ASSEMBLY_PART_HEIGHT; // NEW
    } // NEW

    function createBedAssemblyContainer(moduleCell, label, x, y, attrs, size) {
        const width = size && size.width != null ? size.width : ASSEMBLY_CONTRACTED_BED.width;
        const height = size && size.height != null ? size.height : ASSEMBLY_CONTRACTED_BED.height;
        return createVertex(moduleCell, label || "Bed Assembly", x, y, width, height,
            BED_ASSEMBLY_CONTAINER_STYLE, // CHANGE
            Object.assign({
                label: label || "Bed Assembly",
                [ATTRS.ASSEMBLY]: "1",
                [ATTRS.ASSEMBLY_TYPE]: "bed"
            }, attrs || {}));
    }

    function resizeAssemblyToChildren(assembly) {
        const parts = assemblyPartCells(assembly);
        const height = assemblyPartLaneHeight(parts.length); // CHANGE
        const width = Math.max(ASSEMBLY_DEFAULT_WIDTH, ASSEMBLY_PART_WIDTH + 40);
        setGeometry(assembly, { width, height });
        if (graph.refresh) graph.refresh(assembly);
    }

    function nextAssemblyPartY(assembly) {
        const parts = assemblyPartCells(assembly);
        return assemblyPartY(parts.length); // CHANGE
    }

    function assemblyPartChildInsertIndex(assembly, partIndex) { // NEW
        const children = getChildCells(assembly); // NEW
        const parts = assemblyPartCells(assembly); // NEW
        const insertPartIndex = Math.max(0, Math.min(parts.length, Math.floor(finiteNumber(partIndex, parts.length)))); // NEW
        if (insertPartIndex >= parts.length) return children.length; // NEW
        const childIndex = children.indexOf(parts[insertPartIndex]); // NEW
        return childIndex < 0 ? children.length : childIndex; // NEW
    } // NEW

    function createAssemblyPartCell(assembly, label, attrs, index) {
        const y = index == null ? nextAssemblyPartY(assembly) : assemblyPartY(index); // CHANGE
        const normalizedAttrs = normalizeLifecycleAttrs(attrs);
        const cell = createVertex(assembly, label || "Irrigation part", 20, y, ASSEMBLY_PART_WIDTH, ASSEMBLY_PART_HEIGHT,
            assemblyPartStyleForState(normalizedAttrs[ATTRS.PART_STATE]),
            normalizedAttrs,
            index == null ? null : assemblyPartChildInsertIndex(assembly, index)); // CHANGE
        resizeAssemblyToChildren(assembly);
        syncAssemblyLifecycleStyle(assembly);
        return cell;
    }

    function updateAssemblyPartCell(cell, part, flipped) { // CHANGE
        if (!cell || !part) return;
        const state = partStateForCell(cell);
        const nextFlipped = flipped == null ? isPartCellFlipped(cell) : !!flipped; // NEW
        setCellAttrs(cell, {
            label: installedPartDisplayName(part, nextFlipped), // CHANGE
            [ATTRS.COMPONENT]: "1",
            [ATTRS.COMPONENT_TYPE]: part.category || "unknown",
            [ATTRS.CATALOG_PART_ID]: part.id || "",
            [ATTRS.PART_STATE]: state,
            [ATTRS.PART_FLIPPED]: nextFlipped ? "1" : "" // NEW
        });
        applyPartCellLifecycleStyle(cell);
        syncAssemblyLifecycleStyle(findAssemblyAncestor(cell));
    }

    function applyPartCellLifecycleStyle(cell) {
        if (!isLifecyclePartTargetCell(cell)) return false;
        return setCellStyle(cell, assemblyPartStyleForState(partStateForCell(cell)));
    }

    function assemblyLifecycleCompleted(assembly) {
        if (!isCenterStableFoldAssembly(assembly)) return false;
        const targets = assemblyPartCells(assembly).filter(isLifecyclePartTargetCell);
        return targets.length > 0 && targets.every(function (cell) { return isCompletedPartState(partStateForCell(cell)); });
    }

    function assemblyLifecycleStyleForState(assembly) {
        let style = cellStyleText(assembly);
        const completed = assemblyLifecycleCompleted(assembly);
        style = setStyleValue(style, "fillColor", completed ? ASSEMBLY_LABEL_COMPLETED_FILL : ASSEMBLY_LABEL_PLANNED_FILL);
        style = setStyleValue(style, "strokeColor", completed ? "#82b366" : "#666666");
        return style;
    }

    function syncAssemblyLifecycleStyle(assembly) {
        if (!isCenterStableFoldAssembly(assembly)) return false;
        return setCellStyle(assembly, assemblyLifecycleStyleForState(assembly));
    }

    function isLifecyclePartTargetCell(cell) {
        if (!cell) return false;
        if (isAssemblyPartCell(cell)) return true;
        if (endpointType(cell) === "branchpoint") return !!getCellAttr(cell, ATTRS.CATALOG_PART_ID, "");
        return endpointType(cell) !== "source" && !!getCellAttr(cell, ATTRS.CATALOG_PART_ID, "");
    }

    function isPartCellFlipped(cell) {
        return getCellAttr(cell, ATTRS.PART_FLIPPED, "") === "1";
    }

    function setPartCellFlipped(cell, flipped) {
        return setCellAttrs(cell, { [ATTRS.PART_FLIPPED]: flipped ? "1" : "" });
    }

    function isReversibleFittingCell(moduleCell, cell) {
        return !!(cell && !isEndpoint(cell) && isReversibleFittingPart(partForCell(moduleCell, cell)));
    }

    function applyPipeEdgeLifecycleStyle(edge, moduleCell, baseStyle) {
        if (!edge || getCellAttr(edge, ATTRS.PIPE_EDGE, "") !== "1") return false;
        const routeBaseStyle = pipeEdgeBaseStyleForMode(pipeEdgeStyleMode(edge), baseStyle || PIPE_EDGE_BASE_STYLE);
        let style = pipeEdgeStyleForPart(moduleCell || findGardenModuleAncestor(edge), getCellAttr(edge, ATTRS.PIPE_PART_ID, ""), routeBaseStyle);
        if (isCompletedPartState(partStateForCell(edge))) style = setStyleValue(setStyleValue(style, "strokeColor", "#82b366"), "dashed", "1");
        style = preserveConnectionEdgeAnchorStyle(edge.style, style); // NEW
        return setCellStyle(edge, style);
    }

    function setPartCellState(cell, state) {
        if (!isLifecyclePartTargetCell(cell)) return false;
        const normalized = normalizePartState(state);
        const changed = setCellAttrs(cell, { [ATTRS.PART_STATE]: normalized });
        const styled = applyPartCellLifecycleStyle(cell);
        const assemblyStyled = syncAssemblyLifecycleStyle(findAssemblyAncestor(cell));
        return assemblyStyled || styled || changed;
    }

    function setPipeEdgeState(edge, state) {
        if (!edge || getCellAttr(edge, ATTRS.PIPE_EDGE, "") !== "1") return false;
        const normalized = normalizePartState(state);
        const changed = setCellAttrs(edge, { [ATTRS.PART_STATE]: normalized });
        return applyPipeEdgeLifecycleStyle(edge, findGardenModuleAncestor(edge), PIPE_EDGE_BASE_STYLE) || changed;
    }

    function createSourceAssembly(moduleCell, label, profile, anchor) {
        if (activeIrrigationEditDepth === 0) return runIrrigationEdit("createSourceAssembly", function () { return createSourceAssembly(moduleCell, label, profile, anchor); });
        const point = anchor || { x: 24, y: 72 };
        const assembly = createAssemblyLane(moduleCell, label || "Source Assembly", point.x, point.y, "source", {});
        const normalized = normalizeEndpointProfile(Object.assign({}, profile || {}, { label: label || "Water Source" }));
        const source = createAssemblyPartCell(assembly, label || "Water Source", {
            label: label || "Water Source",
            [ATTRS.ENDPOINT]: "1",
            [ATTRS.ENDPOINT_TYPE]: "source",
            [ATTRS.ENDPOINT_PROFILE_JSON]: JSON.stringify(normalized)
        });
        return { assembly, source };
    }

    function createPartAssembly(moduleCell, part, anchor, flipped) { // CHANGE
        if (activeIrrigationEditDepth === 0) return runIrrigationEdit("createPartAssembly", function () { return createPartAssembly(moduleCell, part, anchor, flipped); }); // CHANGE
        const point = anchor || { x: 24, y: 72 };
        const assembly = createAssemblyLane(moduleCell, "Assembly", point.x, point.y, "parts", {});
        const partCell = createAssemblyPartCell(assembly, installedPartDisplayName(part, flipped), assemblyPartCellAttrs(part, flipped)); // CHANGE
        return { assembly, partCell };
    }

    function assemblyPartCellAttrs(part, flipped) { // NEW
        const attrs = { // NEW
            label: installedPartDisplayName(part, flipped), // CHANGE
            [ATTRS.COMPONENT]: "1", // NEW
            [ATTRS.COMPONENT_TYPE]: part ? part.category : "unknown", // NEW
            [ATTRS.CATALOG_PART_ID]: part ? part.id : "" // NEW
        }; // NEW
        if (flipped) attrs[ATTRS.PART_FLIPPED] = "1"; // NEW
        return attrs; // NEW
    } // NEW

    function installedPartDisplayName(part, flipped) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        if (!p) return "Irrigation part"; // NEW
        if (!flipped || !isReversibleFittingPart(p)) return p.name || p.id || "Irrigation part"; // NEW
        return starterConnectorPairName(p.connectors.output, p.connectors.input) + " adapter"; // CHANGE
    } // NEW

    function connectorPartNameLabel(connector) { // NEW
        return starterConnectorName(connector) || "size? connector?"; // CHANGE
    } // NEW

    function connectorPartTypeName(type) { // NEW
        const normalized = normalizeConnectorType(type); // NEW
        const labels = { mght: "MGHT", fght: "FGHT", mpt: "MPT", fpt: "FPT", barb: "barb", twist_lock: "twist-lock", push_connect: "push-to-connect" }; // NEW
        return labels[normalized] || connectorTypeLabel(normalized || "connector?"); // NEW
    } // NEW

    function createBedAssembly(moduleCell, bedCell, anchor) {
        if (activeIrrigationEditDepth === 0) return runIrrigationEdit("createBedAssembly", function () { return createBedAssembly(moduleCell, bedCell, anchor); });
        const parent = moduleCell || findGardenModuleAncestor(bedCell);
        const bedGeo = bedSyncedAssemblyGeometry(bedCell);
        const label = (getCellAttr(bedCell, "label", "Bed") || "Bed") + " Assembly";
        if (!getCellAttr(bedCell, ATTRS.BED_PORTS_JSON, "")) writeBedPortConfig(bedCell, defaultBedPortConfig());
        const assembly = createBedAssemblyContainer(parent, label, bedGeo.x, bedGeo.y, {
            [ATTRS.LINKED_BED_ID]: getCellId(bedCell) || "",
            bed_fit_width: "1",
            bed_fit_height: "1"
        }, { width: bedGeo.width, height: bedGeo.height });
        return { assembly, endpoint: assembly };
    }

    function bedSyncedAssemblyGeometry(bedCell) {
        const geo = getGeometry(bedCell) || {};
        return { x: finiteNumber(geo.x, 0), y: finiteNumber(geo.y, 0), width: finiteNumber(geo.width, ASSEMBLY_CONTRACTED_BED.width), height: finiteNumber(geo.height, ASSEMBLY_CONTRACTED_BED.height) };
    }

    function isEndpoint(cell) {
        return !!cell && cell.getAttribute && cell.getAttribute(ATTRS.ENDPOINT) === "1";
    }

    function isAssembly(cell) {
        return !!cell && cell.getAttribute && cell.getAttribute(ATTRS.ASSEMBLY) === "1";
    }

    function assemblyType(cell) {
        return getCellAttr(cell, ATTRS.ASSEMBLY_TYPE, "parts");
    }

    function isBedAssembly(cell) {
        return isAssembly(cell) && assemblyType(cell) === "bed";
    }

    function cellStyleText(cell) {
        return String(cell && (cell.getStyle ? cell.getStyle() : cell.style) || "");
    }

    function isCenterStableFoldAssembly(cell) {
        return isAssembly(cell) && !isBedAssembly(cell) && styleValue(cellStyleText(cell), "collapsible") !== "0";
    }

    function centerAlternateBoundsOnGeometry(geo) {
        if (!geo || !geo.alternateBounds) return false;
        const centerX = finiteNumber(geo.x, 0) + finiteNumber(geo.width, 0) / 2;
        const centerY = finiteNumber(geo.y, 0) + finiteNumber(geo.height, 0) / 2;
        geo.alternateBounds.x = centerX - finiteNumber(geo.alternateBounds.width, 0) / 2;
        geo.alternateBounds.y = centerY - finiteNumber(geo.alternateBounds.height, 0) / 2;
        return true;
    }

    function installCenterStableAssemblyFolding() {
        if (graph.__trellisCenterStableIrrigationAssemblyFoldingInstalled || typeof graph.updateAlternateBounds !== "function") return;
        graph.__trellisCenterStableIrrigationAssemblyFoldingInstalled = true;
        const originalUpdateAlternateBounds = graph.updateAlternateBounds;
        graph.updateAlternateBounds = function (cell, geo, willCollapse) {
            const result = originalUpdateAlternateBounds.apply(this, arguments);
            if (isCenterStableFoldAssembly(cell)) centerAlternateBoundsOnGeometry(geo);
            return result;
        };
    }

    installCenterStableAssemblyFolding();

    function linkedBedModuleForAssembly(assembly) {
        const linkedId = getCellAttr(assembly, ATTRS.LINKED_BED_ID, "");
        const root = (graph.getDefaultParent && graph.getDefaultParent()) || (model.getRoot && model.getRoot()) || null;
        const linkedBed = linkedId && root ? findCellById(root, linkedId) : null;
        return linkedBed ? findGardenModuleAncestor(linkedBed) : null;
    }

    function gardenModuleForBedAssembly(assembly) {
        return findGardenModuleAncestor(assembly) || linkedBedModuleForAssembly(assembly);
    }

    function safeParentForBedAssembly(assembly) {
        return gardenModuleForBedAssembly(assembly) || (graph.getDefaultParent && graph.getDefaultParent()) || (model.getRoot && model.getRoot()) || null;
    }

    function isAllowedBedAssemblyParent(parent, assembly) {
        if (!parent || !assembly) return false;
        const moduleCell = gardenModuleForBedAssembly(assembly);
        if (moduleCell) return parent === moduleCell;
        const defaultParent = graph.getDefaultParent && graph.getDefaultParent();
        return !defaultParent || parent === defaultParent;
    }

    function preserveAbsoluteGeometryForParent(cell, nextParent) {
        const geo = getGeometry(cell);
        if (!geo || !nextParent) return null;
        const absolute = cellBoundsInModel(cell);
        const parentBounds = cellBoundsInModel(nextParent) || { x: 0, y: 0 };
        const nextGeo = geo.clone ? geo.clone() : Object.assign({}, geo);
        nextGeo.x = finiteNumber(absolute && absolute.x, finiteNumber(geo.x, 0)) - finiteNumber(parentBounds.x, 0);
        nextGeo.y = finiteNumber(absolute && absolute.y, finiteNumber(geo.y, 0)) - finiteNumber(parentBounds.y, 0);
        return nextGeo;
    }

    function repairBedAssemblyParenting(cells) {
        const moved = (cells || []).filter(isBedAssembly);
        if (!moved.length) return false;
        let changed = false;
        (graph.__withUndoSuppressed || function (fn) { return fn(); }).call(graph, function () {
            model.beginUpdate && model.beginUpdate();
            try {
                moved.forEach(function (assembly) {
                    const parent = model.getParent ? model.getParent(assembly) : assembly.parent;
                    if (isAllowedBedAssemblyParent(parent, assembly)) return;
                    const safeParent = safeParentForBedAssembly(assembly);
                    if (!safeParent || safeParent === parent) return;
                    const nextGeo = preserveAbsoluteGeometryForParent(assembly, safeParent);
                    moveCellToParent(assembly, safeParent);
                    if (nextGeo) setGeometry(assembly, nextGeo);
                    changed = true;
                });
            } finally {
                model.endUpdate && model.endUpdate();
            }
        });
        if (changed && graph.refresh) graph.refresh();
        return changed;
    }

    function installBedAssemblyParentingGuard() {
        if (graph.__trellisBedAssemblyParentGuardInstalled) return;
        graph.__trellisBedAssemblyParentGuardInstalled = true;
        const originalIsValidDropTarget = graph.isValidDropTarget;
        graph.isValidDropTarget = function (target, cells, evt) {
            const bedAssemblies = (cells || []).filter(isBedAssembly);
            if (bedAssemblies.length && target && !bedAssemblies.every(function (assembly) { return isAllowedBedAssemblyParent(target, assembly); })) return false;
            return originalIsValidDropTarget ? originalIsValidDropTarget.apply(this, arguments) : true;
        };
        if (graph.addListener && typeof mxEvent !== "undefined" && mxEvent.CELLS_MOVED) {
            graph.addListener(mxEvent.CELLS_MOVED, function (_, evt) { repairBedAssemblyParenting(evt && evt.getProperty && evt.getProperty("cells") || []); });
        }
    }

    installBedAssemblyParentingGuard();

    function installAssemblyPartMoveGuard() {
        if (graph.__trellisAssemblyPartMoveGuardInstalled || typeof graph.moveCells !== "function") return;
        graph.__trellisAssemblyPartMoveGuardInstalled = true;
        const originalMoveCells = graph.moveCells;
        graph.moveCells = function (cells) {
            if (activeIrrigationEditDepth > 0) return originalMoveCells.apply(this, arguments);
            const requested = Array.isArray(cells) ? cells : [];
            const movableCells = requested.filter(function (cell) { return !isAssemblyPartCell(cell); });
            if (movableCells.length === requested.length) return originalMoveCells.apply(this, arguments);
            if (!movableCells.length) return requested;
            const args = Array.prototype.slice.call(arguments);
            args[0] = movableCells;
            return originalMoveCells.apply(this, args);
        };
    }

    installAssemblyPartMoveGuard();

    function findAssemblyAncestor(cell) {
        let cur = cell;
        while (cur) {
            if (isAssembly(cur)) return cur;
            cur = model.getParent ? model.getParent(cur) : cur.parent;
        }
        return null;
    }

    function assemblyPartCells(assembly) {
        return getChildCells(assembly).filter(function (cell) { return isAssemblyPartCell(cell); }).sort(function (a, b) {
            const ga = getGeometry(a) || {};
            const gb = getGeometry(b) || {};
            return finiteNumber(ga.y, 0) - finiteNumber(gb.y, 0);
        });
    }

    function isAssemblyPartCell(cell) {
        return !!cell && !isAssembly(cell) && (isEndpoint(cell) || getCellAttr(cell, ATTRS.COMPONENT, "") === "1");
    }

    function firstAssemblyPart(assembly) {
        return assemblyPartCells(assembly)[0] || null;
    }

    function lastAssemblyPart(assembly) {
        const parts = assemblyPartCells(assembly);
        return parts[parts.length - 1] || null;
    }

    function assemblyCanReverse(moduleCell, assembly) { // NEW
        const parts = assemblyPartCells(assembly); // NEW
        return parts.length > 0 && parts.every(function (cell) { const part = partForCell(moduleCell, cell); return !!(part && part.connectors && part.connectors.inputs === 1 && part.connectors.outputs === 1); }); // NEW
    } // NEW

    function bedAssemblyEndpoint(assembly) {
        if (!assembly) return null;
        return assemblyType(assembly) === "bed" ? assembly : collectDescendants(assembly, function (cell) { return isEndpoint(cell) && endpointType(cell) === "bed"; })[0] || null;
    }

    function defaultBedPortConfig() {
        return { version: PLUGIN_VERSION, inputs: 1, outputs: 1, input: input("barb", "1/2", "", true), output: output("barb", "1/2", "", null, true) };
    }

    function bedCellForAssembly(moduleCell, assembly) {
        if (!assembly) return null;
        const linkedId = getCellAttr(assembly, ATTRS.LINKED_BED_ID, "");
        return findCellById(moduleCell || findGardenModuleAncestor(assembly), linkedId) || findBedAncestor(assembly);
    }

    function findBedAssemblyForBed(moduleCell, bedCell) {
        const bedId = getCellId(bedCell) || "";
        if (!bedId) return null;
        const root = moduleCell || findGardenModuleAncestor(bedCell) || bedCell;
        return collectDescendants(root, function (cell) {
            return isAssembly(cell) && assemblyType(cell) === "bed" && getCellAttr(cell, ATTRS.LINKED_BED_ID, "") === bedId;
        })[0] || null;
    }

    function resolveBedTemplateAssembly(moduleCell, bedCell) {
        if (!bedCell) return null;
        return isAssembly(bedCell) && assemblyType(bedCell) === "bed" ? bedCell : findBedAssemblyForBed(moduleCell, bedCell) || (createBedAssembly(moduleCell, bedCell).assembly);
    }

    function readBedPortConfig(bedCell) {
        const saved = safeJsonParse(getCellAttr(bedCell, ATTRS.BED_PORTS_JSON, ""), null) || {};
        const fallback = defaultBedPortConfig();
        return {
            version: PLUGIN_VERSION,
            inputs: Math.max(0, Math.floor(finiteNumber(saved.inputs, fallback.inputs))),
            outputs: Math.max(0, Math.floor(finiteNumber(saved.outputs, fallback.outputs))),
            input: normalizeConnectorRecord(Object.assign({}, fallback.input, saved.input || {})),
            output: normalizeConnectorRecord(Object.assign({}, fallback.output, saved.output || {}))
        };
    }

    function writeBedPortConfig(bedCell, config) {
        if (!bedCell) return defaultBedPortConfig();
        const normalized = readBedPortConfigFromObject(config);
        setCellAttrs(bedCell, { [ATTRS.BED_PORTS_JSON]: JSON.stringify(normalized) });
        return normalized;
    }

    function readBedPortConfigFromObject(config) {
        const fallback = defaultBedPortConfig();
        const saved = config || {};
        return { version: PLUGIN_VERSION, inputs: Math.max(0, Math.floor(finiteNumber(saved.inputs, fallback.inputs))), outputs: Math.max(0, Math.floor(finiteNumber(saved.outputs, fallback.outputs))), input: normalizeConnectorRecord(Object.assign({}, fallback.input, saved.input || {})), output: normalizeConnectorRecord(Object.assign({}, fallback.output, saved.output || {})) };
    }

    function bedTemplateRolePartIds(template) {
        const saved = template || {};
        const partIds = Array.isArray(saved.partIds) ? saved.partIds : [];
        const hasInlet = Object.prototype.hasOwnProperty.call(saved, "inletPartId");
        const hasOutlet = Object.prototype.hasOwnProperty.call(saved, "outletPartId");
        return {
            inletPartId: String(hasInlet ? saved.inletPartId || "" : partIds[0] || ""),
            outletPartId: String(hasOutlet ? saved.outletPartId || "" : partIds[1] || "")
        };
    }

    function bedTemplatePartIds(inletPartId, outletPartId) {
        const ids = [];
        if (inletPartId) ids.push(inletPartId);
        if (outletPartId) ids.push(outletPartId);
        return ids;
    }

    function bedTemplateById(templateId) {
        return BED_TEMPLATES.find(function (entry) { return entry.id === templateId; }) || BED_TEMPLATES[0];
    }

    function bedTemplateLabel(templateId) {
        const template = bedTemplateById(templateId);
        return String(template && template.label || templateId || "").trim();
    }

    function bedTemplateRowDisplayLabel(irrigationType) {
        const labels = { drip_tape: "Drip tape line", dripline: "Dripline line", soaker_hose: "Soaker hose", emitter: "Emitter line", sprinkler: "Sprinkler line", microspray: "Microspray line", bubbler: "Bubbler line", standpipe: "Standpipe" }; // CHANGE
        const key = String(irrigationType || "").trim();
        return labels[key] || "Irrigation line";
    }

    function bedIrrigationMethodLabel(irrigationType) {
        const labels = { drip_tape: "Drip tape", dripline: "Dripline", soaker_hose: "Soaker hose", emitter: "Emitter", sprinkler: "Sprinkler", microspray: "Microspray", bubbler: "Bubbler", standpipe: "Standpipe" }; // CHANGE
        const key = String(irrigationType || "").trim();
        return labels[key] || "";
    }

    function isSoakerRowPart(part) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        return !!(p && p.category === "dripline" && /soaker/i.test([p.id, p.name].join(" "))); // NEW
    } // NEW

    function formatBedEmitterSpacingLabel(value) { // NEW
        const n = finiteNumber(value, null); // NEW
        if (!(n > 0)) return ""; // NEW
        const rounded = Math.round(n * 100) / 100; // NEW
        return String(rounded).replace(/\.0+$/, "") + " in"; // NEW
    } // NEW

    function bedEffectiveEmitterInfo(catalog, record, options) { // NEW
        const saved = record || {}; // NEW
        const rowPart = partById(catalog, saved.rowPartId || saved.anchorPartId); // NEW
        const emitterPart = partById(catalog, saved.emitterPartId); // NEW
        const useStoredCategory = !(options && options.ignoreStoredCategory); // NEW
        let category = ""; // NEW
        let omitSpacing = false; // NEW
        if (isSoakerRowPart(rowPart)) { category = "soaker_hose"; omitSpacing = true; } // NEW
        else if (isSelfEmittingRowPart(rowPart)) category = rowPart.category; // NEW
        else if (emitterPart && emitterPart.category) category = emitterPart.category; // NEW
        else if (useStoredCategory) category = String(saved.irrigationType || "").trim(); // NEW
        if (category === "soaker_hose") omitSpacing = true; // NEW
        const label = bedIrrigationMethodLabel(category); // NEW
        const spacing = omitSpacing ? "" : formatBedEmitterSpacingLabel(saved.spacing && saved.spacing.emitterInches != null ? saved.spacing.emitterInches : saved.emitterSpacingIn); // NEW
        return { category, label, spacing, assemblyLabel: label ? [label, spacing].filter(Boolean).join(" ") : "" }; // NEW
    } // NEW

    function bedTemplatePipePartId(templateId, savedPipePartId) {
        return String(savedPipePartId || (bedTemplateById(templateId) && bedTemplateById(templateId).pipePartId) || "");
    }

    function bedTemplateRolePartMatches(templateDef, part) {
        if (!part || !templateDef) return false;
        return part.category === templateDef.lineKind || part.category === "fitting";
    }

    function normalizeBedRowOrientation(value, templateDef) {
        const selected = String(value || "").trim();
        const fallback = String(templateDef && templateDef.defaultRowOrientation || "width").trim();
        return BED_TEMPLATE_ROW_ORIENTATIONS.indexOf(selected) >= 0 ? selected : (BED_TEMPLATE_ROW_ORIENTATIONS.indexOf(fallback) >= 0 ? fallback : "width");
    }

    function normalizeUnitSystem(value) {
        return String(value || "").trim() === "imperial" ? "imperial" : "metric";
    }

    function resolveModuleUnitSystem(moduleCell) {
        return normalizeUnitSystem(moduleCell && moduleCell.getAttribute ? moduleCell.getAttribute("unit_system") : "");
    }

    function rowSpacingDisplayUnit(moduleCell) {
        return resolveModuleUnitSystem(moduleCell) === "imperial" ? "in" : "cm";
    }

    function rowSpacingCmToDisplayValue(cm, moduleCell) {
        const value = Math.max(0, finiteNumber(cm, 0));
        return resolveModuleUnitSystem(moduleCell) === "imperial" ? value / CM_PER_INCH : value;
    }

    function rowSpacingDisplayValueToCm(value, moduleCell) {
        const n = finiteNumber(value, 0);
        return resolveModuleUnitSystem(moduleCell) === "imperial" ? n * CM_PER_INCH : n;
    }

    function formatRowSpacingDisplayValue(cm, moduleCell) {
        const value = rowSpacingCmToDisplayValue(cm, moduleCell);
        return String(Math.max(0, Math.round(value)));
    }

    function rowLengthMetersForBedGeometry(bedGeo, orientation) {
        const geo = bedGeo || {};
        const units = normalizeBedRowOrientation(orientation) === "height" ? geo.height : geo.width;
        return Math.max(0, unitsToCm(finiteNumber(units, 0)) / 100);
    }

    function rowSpacingSpanUnitsForBedGeometry(bedGeo, orientation) {
        const geo = bedGeo || {};
        return Math.max(0, finiteNumber(normalizeBedRowOrientation(orientation) === "height" ? geo.width : geo.height, 0));
    }

    function rowSpacingSpanCmForBedGeometry(bedGeo, orientation) {
        return unitsToCm(rowSpacingSpanUnitsForBedGeometry(bedGeo, orientation));
    }

    function rowSpacingCmForRows(bedGeo, rows, orientation) {
        const rowCount = Math.max(0, Math.floor(finiteNumber(rows, 0)));
        if (rowCount === 0) return 0;
        return Math.max(0, rowSpacingSpanCmForBedGeometry(bedGeo, orientation) / rowCount);
    }

    function rowsForRowSpacingCm(bedGeo, spacingCm, orientation, fallbackRows) {
        const fallback = Math.max(0, Math.floor(finiteNumber(fallbackRows, 0)));
        const spanCm = rowSpacingSpanCmForBedGeometry(bedGeo, orientation);
        const spacing = finiteNumber(spacingCm, 0);
        if (!(spacing > 0)) return 0;
        if (!(spanCm > 0)) return fallback;
        return Math.max(1, Math.round(spanCm / spacing));
    }

    function normalizeTemplateRequiredParts(templateDef) {
        return (templateDef && Array.isArray(templateDef.requiredParts) ? templateDef.requiredParts : []).map(function (entry) {
            return { partId: String(entry && entry.partId || "").trim(), quantityPerRowMeter: finiteNumber(entry && entry.quantityPerRowMeter, 0) };
        }).filter(function (entry) { return !!entry.partId && entry.quantityPerRowMeter > 0; });
    }

    function catalogPartLargestConnectorSize(part) {
        const p = normalizeCatalogPart(part);
        if (!p || !p.connectors) return 0;
        return Math.max(p.connectors.inputs > 0 ? nominalSizeNumber(p.connectors.input.nominalSize) : 0, p.connectors.outputs > 0 ? nominalSizeNumber(p.connectors.output.nominalSize) : 0);
    }

    function resolveTemplateAnchorPart(catalog, requiredParts) {
        const candidates = (requiredParts || []).map(function (entry, index) {
            const part = normalizeCatalogPart(partById(catalog, entry.partId));
            if (!part || !validateCatalogPart(part).ok || !BED_TEMPLATE_ANCHOR_CATEGORIES.has(part.category)) return null;
            return { part, index, size: catalogPartLargestConnectorSize(part), pipePriority: part.category === "pipe_tubing" ? 0 : 1 };
        }).filter(Boolean);
        candidates.sort(function (a, b) { return (b.size - a.size) || (a.pipePriority - b.pipePriority) || (a.index - b.index); });
        return candidates[0] ? candidates[0].part : null;
    }

    function isSelfEmittingRowPart(part) {
        const p = normalizeCatalogPart(part);
        return !!(p && BED_SELF_EMITTING_ROW_CATEGORIES.has(p.category));
    }

    function templateDefaultRowPartId(catalog, templateDef) {
        const required = normalizeTemplateRequiredParts(templateDef);
        const self = required.map(function (entry) { return partById(catalog, entry.partId); }).find(function (part) { return part && part.category === templateDef.lineKind && isSelfEmittingRowPart(part); });
        if (self) return self.id;
        const pipe = partById(catalog, templateDef && templateDef.pipePartId);
        if (pipe && pipe.category === "pipe_tubing") return pipe.id;
        const row = required.map(function (entry) { return partById(catalog, entry.partId); }).find(function (part) { return part && BED_TEMPLATE_ANCHOR_CATEGORIES.has(part.category); });
        return row ? row.id : "";
    }

    function templateDefaultEmitterPartId(catalog, templateDef, rowPartId) {
        const rowPart = partById(catalog, rowPartId);
        if (isSelfEmittingRowPart(rowPart)) return "";
        const required = normalizeTemplateRequiredParts(templateDef);
        const device = required.map(function (entry) { return partById(catalog, entry.partId); }).find(function (part) { return part && BED_DEVICE_CATEGORIES.has(part.category); });
        return device ? device.id : "";
    }

    function normalizeBedRecipeInput(catalog, templateDef, recipe, options) {
        const saved = recipe || {};
        const useTemplateDefaults = !(options && options.suppressTemplateDefaults); // CHANGE
        const terminalParts = normalizeBedTerminalPartIds(saved);
        const rowPartId = String(saved.rowPartId || (useTemplateDefaults ? templateDefaultRowPartId(catalog, templateDef) : "") || "").trim(); // CHANGE
        const rowPart = partById(catalog, rowPartId);
        const selfEmitting = isSelfEmittingRowPart(rowPart);
        const emitterPartId = selfEmitting ? "" : String(saved.emitterPartId || (useTemplateDefaults ? templateDefaultEmitterPartId(catalog, templateDef, rowPartId) : "") || "").trim(); // CHANGE
        const emitterSpacingIn = selfEmitting ? finiteNumber(rowPart && rowPart.specs && rowPart.specs.emitterSpacingIn, finiteNumber(saved.emitterSpacingIn, 12)) : finiteNumber(saved.emitterSpacingIn, finiteNumber(saved.emitterInches, 12));
        return { inletPartId: String(saved.inletPartId || "").trim(), outletPartId: terminalParts.outletPartId, rowPartId, emitterPartId, rowTakeoffPartId: String(saved.rowTakeoffPartId || "").trim(), rowEndCapPartId: String(saved.rowEndCapPartId || "").trim(), headerEndCapPartId: terminalParts.headerEndCapPartId, emitterSpacingIn, selfEmitting };
    }

    function normalizeBedTerminalPartIds(recipe) {
        const saved = recipe || {};
        const outletPartId = String(saved.outletPartId || "").trim();
        const headerEndCapPartId = String(saved.headerEndCapPartId || "").trim();
        return outletPartId ? { outletPartId, headerEndCapPartId: "" } : { outletPartId: "", headerEndCapPartId };
    }

    function supplyPipePartIdForConnector(catalog, connector) {
        const size = normalizeConnectorRecord(connector).nominalSize;
        const partId = BED_SUPPLY_PIPE_BY_SIZE[size] || "";
        return partId && partById(catalog, partId) ? partId : "";
    }

    function orientedPartSelectEntry(part, flipped) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        return p ? Object.assign({}, p, { name: installedPartDisplayName(p, flipped), connectionFlipped: !!flipped, flipped: !!flipped }) : null; // NEW
    } // NEW

    function bedBoundaryConnectorForOrientation(orientation, role) { // NEW
        return role === "output" ? orientation.inputConnector : orientation.outputConnector; // NEW
    } // NEW

    function bedExternalConnectorForOrientation(orientation, role) { // NEW
        return role === "output" ? orientation.outputConnector : orientation.inputConnector; // NEW
    } // NEW

    function bedBoundarySideForOrientation(orientation, role) { // NEW
        return role === "output" ? orientation.inputSide : orientation.outputSide; // NEW
    } // NEW

    function bedExternalSideForOrientation(orientation, role) { // NEW
        return role === "output" ? orientation.outputSide : orientation.inputSide; // NEW
    } // NEW

    function partConnectorCapacity(part, side) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        return side === "output" ? finiteNumber(p && p.connectors && p.connectors.outputs, 0) : finiteNumber(p && p.connectors && p.connectors.inputs, 0); // NEW
    } // NEW

    function bedBoundaryMatchForPart(part, role, requiredInternalConnector) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        if (!p || !validateCatalogPart(p).ok || p.connectors.inputs <= 0 || p.connectors.outputs <= 0) return null; // NEW
        const matches = partConnectorOrientations(p).map(function (orientation) { // NEW
            const internalConnector = bedBoundaryConnectorForOrientation(orientation, role); // NEW
            const externalConnector = bedExternalConnectorForOrientation(orientation, role); // NEW
            if (!isPipeConnectorType(internalConnector && internalConnector.type)) return null; // CHANGE
            if (requiredInternalConnector && !connectorRecordsMatch(requiredInternalConnector, internalConnector, null).ok) return null; // NEW
            const internalSide = bedBoundarySideForOrientation(orientation, role); // NEW
            const externalSide = bedExternalSideForOrientation(orientation, role); // NEW
            const externalCapacity = partConnectorCapacity(p, externalSide); // NEW
            if (!externalConnector || !(externalCapacity > 0)) return null; // NEW
            return { part: p, flipped: !!orientation.flipped, internalSide, internalConnector, externalSide, externalConnector, externalCapacity }; // NEW
        }).filter(Boolean); // NEW
        matches.sort(function (a, b) { return (nominalSizeNumber(b.internalConnector.nominalSize) - nominalSizeNumber(a.internalConnector.nominalSize)) || (a.flipped === b.flipped ? 0 : (a.flipped ? 1 : -1)); }); // NEW
        return matches[0] || null; // NEW
    } // NEW

    function bedSupplyInfoForInletPart(catalog, inletPartId) { // NEW
        const match = bedBoundaryMatchForPart(partById(catalog, inletPartId), "input", null); // NEW
        const supplyPipePartId = match ? supplyPipePartIdForConnector(catalog, match.internalConnector) : ""; // NEW
        return { match, connector: match && match.internalConnector || null, supplyPipePartId, supplyPipePart: partById(catalog, supplyPipePartId) }; // NEW
    } // NEW

    function rowPartPipeConnector(rowPart) { // NEW
        const p = normalizeCatalogPart(rowPart); // NEW
        if (!p || !p.connectors) return null; // NEW
        if (p.connectors.inputs > 0 && connectorUsesPipe(p.connectors.input)) return p.connectors.input; // NEW
        if (p.connectors.outputs > 0 && connectorUsesPipe(p.connectors.output)) return p.connectors.output; // NEW
        return null; // NEW
    } // NEW

    function rowPartFitsSupply(rowPart, supplyConnector) { // NEW
        const rowConnector = rowPartPipeConnector(rowPart); // NEW
        if (!supplyConnector || !supplyConnector.nominalSize || !rowConnector || !rowConnector.nominalSize) return true; // NEW
        return nominalSizeNumber(rowConnector.nominalSize) <= nominalSizeNumber(supplyConnector.nominalSize); // NEW
    } // NEW

    function orientedFittingMatch(part, inputConnector, outputConnector) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        if (!p || !validateCatalogPart(p).ok) return null; // NEW
        return partConnectorOrientations(p).find(function (orientation) { // NEW
            return connectorRecordsMatch(inputConnector, orientation.inputConnector, null).ok && connectorRecordsMatch(orientation.outputConnector, outputConnector, null).ok; // NEW
        }) || null; // NEW
    } // NEW

    function bedRowTakeoffMatchForPart(catalog, partId, headerPart, rowPart) { // NEW
        const headerConnector = headerPart && headerPart.connectors && headerPart.connectors.output; // NEW
        const rowConnector = rowPart && rowPart.connectors && rowPart.connectors.input; // NEW
        const part = partById(catalog, partId); // NEW
        return part && headerConnector && rowConnector ? orientedFittingMatch(part, headerConnector, rowConnector) : null; // NEW
    } // NEW

    function bedHeaderMatchForPart(catalog, partId, headerPart) {
        const headerConnector = headerPart && headerPart.connectors && headerPart.connectors.output; // CHANGE
        return partId && headerConnector ? bedBoundaryMatchForPart(partById(catalog, partId), "output", headerConnector) : null; // CHANGE
    }

    function rowDeviceCount(rowLengthMeters, spacingIn) {
        const spacingMeters = Math.max(0, finiteNumber(spacingIn, 0) * CM_PER_INCH / 100);
        return spacingMeters > 0 ? Math.ceil(Math.max(0, finiteNumber(rowLengthMeters, 0)) / spacingMeters) : 0;
    }

    function addResolvedBedBomPart(out, role, partId, quantity, unit) {
        const id = String(partId || "").trim();
        const qty = Math.max(0, finiteNumber(quantity, 0));
        if (!id || !(qty > 0)) return;
        out.push({ role, partId: id, quantity: qty, unit: unit || "each" });
    }

    function resolveBedTemplateRecipeBom(catalog, bedGeo, templateDef, rowCount, rowOrientation, recipe) {
        const normalized = normalizeBedRecipeInput(catalog, templateDef, recipe);
        const rowPart = partById(catalog, normalized.rowPartId);
        const inletPart = partById(catalog, normalized.inletPartId);
        const rowLengthMeters = rowLengthMetersForBedGeometry(bedGeo, rowOrientation);
        const headerLengthMeters = rowSpacingSpanCmForBedGeometry(bedGeo, rowOrientation) / 100;
        const totalRowMeters = rowCount * rowLengthMeters;
        const inletSupply = bedSupplyInfoForInletPart(catalog, normalized.inletPartId); // CHANGE
        const inletMatch = inletSupply.match; // CHANGE
        const supplyPipePartId = inletSupply.supplyPipePartId; // CHANGE
        const supplyPipePart = partById(catalog, supplyPipePartId);
        const resolvedBomParts = [];
        const missingPartIds = [];
        function requirePart(partId) { if (partId && !partById(catalog, partId)) missingPartIds.push(partId); }
        requirePart(normalized.inletPartId); requirePart(normalized.outletPartId); requirePart(normalized.rowPartId); requirePart(normalized.emitterPartId); requirePart(normalized.rowTakeoffPartId); requirePart(normalized.rowEndCapPartId); requirePart(normalized.headerEndCapPartId);
        if (normalized.inletPartId && !inletMatch) missingPartIds.push(normalized.inletPartId); // CHANGE
        if (inletMatch && !supplyPipePartId) missingPartIds.push(BED_SUPPLY_PIPE_BY_SIZE[String(inletMatch.internalConnector && inletMatch.internalConnector.nominalSize || "").trim()] || "matching_supply_pipe");
        if (supplyPipePart && rowPart && !rowPartFitsSupply(rowPart, supplyPipePart.connectors && supplyPipePart.connectors.output)) missingPartIds.push("supply_smaller_than_row"); // NEW
        if (supplyPipePart && normalized.rowTakeoffPartId && !bedRowTakeoffMatchForPart(catalog, normalized.rowTakeoffPartId, supplyPipePart, rowPart)) missingPartIds.push(normalized.rowTakeoffPartId); // NEW
        if (rowPart && normalized.rowEndCapPartId && !connectorMatchesPartInput(partById(catalog, normalized.rowEndCapPartId), rowPart.connectors && rowPart.connectors.input)) missingPartIds.push(normalized.rowEndCapPartId); // NEW
        if (supplyPipePart && normalized.headerEndCapPartId && !connectorMatchesPartInput(partById(catalog, normalized.headerEndCapPartId), supplyPipePart.connectors && supplyPipePart.connectors.output)) missingPartIds.push(normalized.headerEndCapPartId); // NEW
        if (supplyPipePartId && normalized.outletPartId && !bedHeaderMatchForPart(catalog, normalized.outletPartId, supplyPipePart)) missingPartIds.push(normalized.outletPartId);
        addResolvedBedBomPart(resolvedBomParts, "inlet", normalized.inletPartId, 1, "each");
        addResolvedBedBomPart(resolvedBomParts, "supply_pipe", supplyPipePartId, headerLengthMeters, "m");
        addResolvedBedBomPart(resolvedBomParts, "row_line", normalized.rowPartId, totalRowMeters, "m");
        addResolvedBedBomPart(resolvedBomParts, "row_takeoff", normalized.rowTakeoffPartId, rowCount, "each");
        addResolvedBedBomPart(resolvedBomParts, "row_end_cap", normalized.rowEndCapPartId, rowCount, "each");
        if (!normalized.selfEmitting) addResolvedBedBomPart(resolvedBomParts, "emitter_device", normalized.emitterPartId, rowCount * rowDeviceCount(rowLengthMeters, normalized.emitterSpacingIn), "each");
        if (normalized.outletPartId) addResolvedBedBomPart(resolvedBomParts, "outlet", normalized.outletPartId, 1, "each");
        else addResolvedBedBomPart(resolvedBomParts, "header_end_cap", normalized.headerEndCapPartId, 1, "each");
        const demandPart = normalized.selfEmitting ? rowPart : partById(catalog, normalized.emitterPartId);
        const deviceQty = normalized.selfEmitting ? totalRowMeters : rowCount * rowDeviceCount(rowLengthMeters, normalized.emitterSpacingIn);
        const flowGpm = normalized.selfEmitting ? finiteNumber(demandPart && demandPart.specs && demandPart.specs.flowGpmPerMeter, 0) * totalRowMeters : finiteNumber(demandPart && demandPart.specs && demandPart.specs.flowGpm, 0) * deviceQty;
        const operatingPressurePsi = Math.max(finiteNumber(rowPart && rowPart.specs && rowPart.specs.minOperatingPressurePsi, 0), finiteNumber(demandPart && demandPart.specs && demandPart.specs.minOperatingPressurePsi, finiteNumber(demandPart && demandPart.specs && demandPart.specs.operatingPressurePsi, 0)));
        return Object.assign({}, normalized, { supplyPipePartId, resolvedBomParts, missingPartIds: uniqueStrings(missingPartIds), demand: { flowGpm, operatingPressurePsi } });
    }

    function computeBedTemplateBom(catalog, bedGeo, templateId, rows, orientation, recipe) {
        const templateDef = bedTemplateById(templateId);
        const rowCount = Math.max(0, Math.floor(finiteNumber(rows, templateDef.defaultRows)));
        const rowOrientation = normalizeBedRowOrientation(orientation, templateDef);
        const rowLengthMeters = rowLengthMetersForBedGeometry(bedGeo, rowOrientation);
        const rowSpacingCm = rowSpacingCmForRows(bedGeo, rowCount, rowOrientation);
        const totalRowMeters = rowCount * rowLengthMeters;
        const required = normalizeTemplateRequiredParts(templateDef);
        const requiredParts = required.map(function (entry) {
            return Object.assign({}, entry, { quantityMeters: rowCount > 0 ? entry.quantityPerRowMeter * totalRowMeters : 0, unit: "m" });
        });
        const missingPartIds = rowCount > 0 ? requiredParts.filter(function (entry) { return !partById(catalog, entry.partId); }).map(function (entry) { return entry.partId; }) : [];
        const anchorPart = rowCount > 0 ? resolveTemplateAnchorPart(catalog, requiredParts) : null;
        const demand = requiredParts.reduce(function (out, entry) {
            const part = partById(catalog, entry.partId);
            out.flowGpm += finiteNumber(part && part.specs && part.specs.flowGpmPerMeter, 0) * finiteNumber(entry.quantityMeters, 0);
            out.operatingPressurePsi = Math.max(out.operatingPressurePsi, finiteNumber(part && part.specs && part.specs.minOperatingPressurePsi, finiteNumber(part && part.specs && part.specs.operatingPressurePsi, 0)));
            return out;
        }, { flowGpm: 0, operatingPressurePsi: 0 });
        if (rowCount > 0 && !(demand.flowGpm > 0)) demand.flowGpm = finiteNumber(templateDef.flowGpm, 0);
        if (rowCount > 0 && !(demand.operatingPressurePsi > 0)) demand.operatingPressurePsi = finiteNumber(templateDef.pressurePsi, 0);
        const recipeBom = recipe ? resolveBedTemplateRecipeBom(catalog, bedGeo, templateDef, rowCount, rowOrientation, recipe) : null;
        const resolvedDemand = recipeBom && recipeBom.demand && recipeBom.demand.flowGpm > 0 ? recipeBom.demand : demand;
        return { templateDef, rowCount, rowOrientation, rowLengthMeters, rowSpacingCm, totalRowMeters, requiredParts, missingPartIds: uniqueStrings(missingPartIds.concat(recipeBom ? recipeBom.missingPartIds : [])), anchorPartId: recipeBom && recipeBom.rowPartId || (anchorPart ? anchorPart.id : ""), demand: resolvedDemand, recipe: recipeBom };
    }

    function connectorForPartSide(part, side) {
        const p = normalizeCatalogPart(part);
        if (!p || !p.connectors) return null;
        if (side === "input" && p.connectors.inputs > 0) return p.connectors.input;
        if (side === "output" && p.connectors.outputs > 0) return p.connectors.output;
        return null;
    }

    function boundaryMatchForAnchor(part, anchorPart) {
        const p = normalizeCatalogPart(part);
        const anchor = normalizeCatalogPart(anchorPart);
        if (!p || !anchor || !validateCatalogPart(p).ok || !validateCatalogPart(anchor).ok) return null;
        const partSides = ["input", "output"];
        const anchorSides = ["input", "output"];
        for (let i = 0; i < partSides.length; i++) {
            const internalSide = partSides[i];
            const internalConnector = connectorForPartSide(p, internalSide);
            if (!internalConnector) continue;
            for (let j = 0; j < anchorSides.length; j++) {
                const anchorConnector = connectorForPartSide(anchor, anchorSides[j]);
                if (!anchorConnector || !ConnectorRules.connectorRecordsMatch(internalConnector, anchorConnector, null).ok) continue;
                const externalSide = internalSide === "input" ? "output" : "input";
                const externalConnector = connectorForPartSide(p, externalSide);
                const externalCapacity = externalSide === "input" ? p.connectors.inputs : p.connectors.outputs;
                if (!externalConnector || !(externalCapacity > 0)) continue;
                return { internalSide, externalSide, externalConnector, externalCapacity, anchorSide: anchorSides[j] };
            }
        }
        return null;
    }

    function boundaryMatchForAnchorRole(part, anchorPart, role) {
        const p = normalizeCatalogPart(part);
        const anchor = normalizeCatalogPart(anchorPart);
        const normalizedRole = role === "output" ? "output" : "input";
        if (!p || !anchor || !validateCatalogPart(p).ok || !validateCatalogPart(anchor).ok) return null;
        const internalSide = normalizedRole === "input" ? "output" : "input";
        const internalConnector = connectorForPartSide(p, internalSide);
        if (!internalConnector) return null;
        const anchorSides = ["input", "output"];
        for (let i = 0; i < anchorSides.length; i++) {
            const anchorConnector = connectorForPartSide(anchor, anchorSides[i]);
            if (!anchorConnector || !ConnectorRules.connectorRecordsMatch(internalConnector, anchorConnector, null).ok) continue;
            const externalSide = internalSide === "input" ? "output" : "input";
            const externalConnector = connectorForPartSide(p, externalSide);
            const externalCapacity = externalSide === "input" ? p.connectors.inputs : p.connectors.outputs;
            if (!externalConnector || !(externalCapacity > 0)) continue;
            return { internalSide, internalConnector, externalSide, externalConnector, externalCapacity, anchorSide: anchorSides[i] };
        }
        return null;
    }

    function bedRolePartOptions(moduleCell, role, selectedPartId, templateId, anchorPartId, preserveSelected) {
        const catalog = readCatalog(moduleCell);
        const templateDef = bedTemplateById(templateId);
        const anchorPart = partById(catalog, anchorPartId);
        const selected = selectedPartId ? partById(catalog, selectedPartId) : null;
        const items = sortCatalogParts(catalog.items).map(normalizeCatalogPart).map(function (part) { // CHANGE
            if (!part || part.category === "pipe_tubing" || !validateCatalogPart(part).ok) return false;
            if (!bedTemplateRolePartMatches(templateDef, part)) return false;
            if (role === "input") { const match = bedBoundaryMatchForPart(part, "input", null); return match ? orientedPartSelectEntry(part, match.flipped) : null; } // CHANGE
            return !!boundaryMatchForAnchorRole(part, anchorPart, role) ? part : null; // CHANGE
        }).filter(Boolean); // CHANGE
        if (preserveSelected !== false && selectedPartId && !items.some(function (part) { return part.id === selectedPartId; })) {
            items.unshift(selected || { id: selectedPartId, name: "Missing part (" + selectedPartId + ")" });
        }
        return items;
    }

    function preserveSelectedPartOption(items, catalog, selectedPartId, preserveSelected) {
        const selected = selectedPartId ? partById(catalog, selectedPartId) : null;
        if (preserveSelected !== false && selectedPartId && !items.some(function (part) { return part.id === selectedPartId; })) items.unshift(selected || { id: selectedPartId, name: "Missing part (" + selectedPartId + ")" });
        return items;
    }

    function bedRowPartOptions(moduleCell, selectedPartId, preserveSelected, supplyConnector) {
        const catalog = readCatalog(moduleCell);
        const items = sortCatalogParts(catalog.items).map(normalizeCatalogPart).filter(function (part) { return part && validateCatalogPart(part).ok && BED_TEMPLATE_ANCHOR_CATEGORIES.has(part.category) && rowPartFitsSupply(part, supplyConnector); }); // CHANGE
        return preserveSelectedPartOption(items, catalog, selectedPartId, preserveSelected);
    }

    function bedEmitterPartOptions(moduleCell, rowPartId, selectedPartId, preserveSelected) {
        const catalog = readCatalog(moduleCell);
        const rowPart = partById(catalog, rowPartId);
        const rowOutput = rowPart && rowPart.connectors && rowPart.connectors.output;
        const items = sortCatalogParts(catalog.items).map(normalizeCatalogPart).filter(function (part) {
            return part && validateCatalogPart(part).ok && BED_DEVICE_CATEGORIES.has(part.category) && (!rowOutput || connectorRecordsMatch(rowOutput, part.connectors.input, null).ok);
        });
        return preserveSelectedPartOption(items, catalog, selectedPartId, preserveSelected);
    }

    function connectorMatchesPartInput(part, connector) {
        const p = normalizeCatalogPart(part);
        return !!(p && p.connectors.inputs > 0 && connectorRecordsMatch(connector, p.connectors.input, null).ok);
    }

    function connectorMatchesPartOutput(part, connector) {
        const p = normalizeCatalogPart(part);
        return !!(p && p.connectors.outputs > 0 && connectorRecordsMatch(p.connectors.output, connector, null).ok);
    }

    function bedFittingPartOptions(moduleCell, role, headerPartId, rowPartId, selectedPartId, preserveSelected) {
        const catalog = readCatalog(moduleCell);
        const headerPart = partById(catalog, headerPartId);
        const rowPart = partById(catalog, rowPartId);
        const headerConnector = headerPart && headerPart.connectors && headerPart.connectors.output;
        const rowConnector = rowPart && rowPart.connectors && rowPart.connectors.input;
        if ((role === "row_takeoff" && (!headerConnector || !rowConnector)) || (role === "header_end_cap" && !headerConnector) || (role === "row_end_cap" && !rowConnector)) return preserveSelectedPartOption([], catalog, selectedPartId, preserveSelected); // NEW
        const items = sortCatalogParts(catalog.items).map(normalizeCatalogPart).map(function (part) { // CHANGE
            if (!part || !validateCatalogPart(part).ok) return false;
            if (role === "row_takeoff") { const match = part.category === "fitting" ? orientedFittingMatch(part, headerConnector, rowConnector) : null; return match ? orientedPartSelectEntry(part, match.flipped) : null; } // CHANGE
            if (role === "row_end_cap") return (part.category === "cap_end" || part.category === "fitting") && part.connectors.outputs <= 0 && connectorMatchesPartInput(part, rowConnector) ? part : null; // CHANGE
            if (role === "header_end_cap") return (part.category === "cap_end" || part.category === "fitting") && part.connectors.outputs <= 0 && connectorMatchesPartInput(part, headerConnector) ? part : null; // CHANGE
            return false;
        }).filter(Boolean); // CHANGE
        return preserveSelectedPartOption(items, catalog, selectedPartId, preserveSelected);
    }

    function bedOutletPartOptions(moduleCell, headerPartId, selectedPartId, preserveSelected) {
        const catalog = readCatalog(moduleCell);
        const headerPart = partById(catalog, headerPartId);
        const headerConnector = headerPart && headerPart.connectors && headerPart.connectors.output; // NEW
        if (!headerConnector) return preserveSelectedPartOption([], catalog, selectedPartId, preserveSelected); // NEW
        const items = sortCatalogParts(catalog.items).map(normalizeCatalogPart).map(function (part) { // CHANGE
            if (!part || part.category === "pipe_tubing" || part.category === "cap_end" || BED_TEMPLATE_ANCHOR_CATEGORIES.has(part.category) || BED_DEVICE_CATEGORIES.has(part.category) || !validateCatalogPart(part).ok) return null; // CHANGE
            const match = bedBoundaryMatchForPart(part, "output", headerConnector); // CHANGE
            return match ? orientedPartSelectEntry(part, match.flipped) : null; // CHANGE
        }).filter(Boolean); // CHANGE
        return preserveSelectedPartOption(items, catalog, selectedPartId, preserveSelected);
    }

    function bedPortConfigFromRecipe(catalog, currentPorts, inletPartId, outletPartId, rowPartId, supplyPipePartId) {
        const fallback = currentPorts || defaultBedPortConfig();
        const supplyPart = partById(catalog, supplyPipePartId);
        const supplyConnector = supplyPart && supplyPart.connectors && supplyPart.connectors.output; // CHANGE
        const inletMatch = bedBoundaryMatchForPart(partById(catalog, inletPartId), "input", supplyConnector); // CHANGE
        const outletMatch = supplyConnector ? bedBoundaryMatchForPart(partById(catalog, outletPartId), "output", supplyConnector) : null; // CHANGE
        return readBedPortConfigFromObject({ inputs: inletMatch ? inletMatch.externalCapacity : fallback.inputs, outputs: outletPartId ? (outletMatch ? outletMatch.externalCapacity : fallback.outputs) : 0, input: inletMatch ? inletMatch.externalConnector : fallback.input, output: outletMatch ? outletMatch.externalConnector : fallback.output });
    }

    function bedPortConfigFromRoleParts(catalog, currentPorts, inletPartId, outletPartId, anchorPartId) {
        const fallback = currentPorts || defaultBedPortConfig();
        const inletPart = inletPartId ? normalizeCatalogPart(partById(catalog, inletPartId)) : null;
        const outletPart = outletPartId ? normalizeCatalogPart(partById(catalog, outletPartId)) : null;
        const anchorPart = anchorPartId ? normalizeCatalogPart(partById(catalog, anchorPartId)) : null;
        const inletMatch = inletPart ? boundaryMatchForAnchorRole(inletPart, anchorPart, "input") : null;
        const outletMatch = outletPart ? boundaryMatchForAnchorRole(outletPart, anchorPart, "output") : null;
        return readBedPortConfigFromObject({
            inputs: inletMatch ? inletMatch.externalCapacity : fallback.inputs,
            outputs: outletPartId ? (outletMatch ? outletMatch.externalCapacity : fallback.outputs) : 0,
            input: inletMatch ? inletMatch.externalConnector : fallback.input,
            output: outletMatch ? outletMatch.externalConnector : fallback.output
        });
    }

    function isAssemblyModeObject(cell) {
        return isAssembly(cell) || !!findAssemblyAncestor(cell);
    }

    function portKey(port) {
        return [port && port.cellId || "", port && port.role || "", String(port && port.index || 0)].join(":");
    }

    function normalizePort(port) {
        return { cellId: String(port && port.cellId || ""), role: String(port && port.role || ""), index: Math.max(0, Math.floor(finiteNumber(port && port.index, 0))) };
    }

    function portCell(moduleCell, port) {
        return findCellById(moduleCell, port && port.cellId);
    }

    function portCapacityForCell(moduleCell, cell, role) {
        if (!cell) return 0;
        if (isAssembly(cell) && assemblyType(cell) === "bed") { const ports = readBedPortConfig(bedCellForAssembly(moduleCell, cell)); return role === "input" ? ports.inputs : ports.outputs; }
        if (endpointType(cell) === "source") return role === "output" ? 1 : 0;
        if (endpointType(cell) === "bed") return role === "input" ? 1 : 0;
        const part = partForCell(moduleCell, cell);
        if (!part || !part.connectors) return 0;
        return Math.max(0, finiteNumber(role === "input" ? part.connectors.inputs : part.connectors.outputs, 0));
    }

    function portConnectorForCell(moduleCell, cell, role) {
        if (!cell) return null;
        if (isAssembly(cell) && assemblyType(cell) === "bed") { const ports = readBedPortConfig(bedCellForAssembly(moduleCell, cell)); return role === "input" ? ports.input : ports.output; }
        if (isEndpoint(cell)) {
            const profile = endpointProfile(cell);
            return endpointProfileAsConnector(profile);
        }
        const part = partForCell(moduleCell, cell);
        if (!part || !part.connectors) return null;
        const flipped = isReversibleFittingCell(moduleCell, cell) && isPartCellFlipped(cell);
        return role === "input" ? (flipped ? part.connectors.output : part.connectors.input) : (flipped ? part.connectors.input : part.connectors.output);
    }

    function collectAssemblyEdges(moduleCell) {
        return collectDescendants(moduleCell, function (cell) {
            return !!cell && !isLegacyGenerated(cell) && (getCellAttr(cell, ATTRS.PIPE_EDGE, "") === "1" || getCellAttr(cell, ATTRS.DIRECT_LINK_EDGE, "") === "1") && getCellAttr(cell, ATTRS.EDGE_SOURCE_PORT, "") !== "";
        });
    }

    function portEdgeMatches(edge, cell, role, index) {
        const attr = role === "output" ? ATTRS.EDGE_SOURCE_PORT : ATTRS.EDGE_TARGET_PORT;
        const endCell = role === "output" ? edge.source : edge.target;
        return endCell === cell && String(getCellAttr(edge, attr, "0")) === String(index || 0);
    }

    function edgesForPort(moduleCell, port) {
        const normalized = normalizePort(port);
        const cell = portCell(moduleCell, normalized);
        if (!cell) return [];
        return collectAssemblyEdges(moduleCell).filter(function (edge) { return portEdgeMatches(edge, cell, normalized.role, normalized.index); });
    }

    function incomingAssemblyEdges(moduleCell, cell) {
        return collectAssemblyEdges(moduleCell).filter(function (edge) { return edge.target === cell; });
    }

    function outgoingAssemblyEdges(moduleCell, cell) {
        return collectAssemblyEdges(moduleCell).filter(function (edge) { return edge.source === cell; });
    }

    function assemblyHasConnectedPortRole(moduleCell, cell, role) {
        if (!moduleCell || !cell) return false;
        return role === "input" ? incomingAssemblyEdges(moduleCell, cell).length > 0 : outgoingAssemblyEdges(moduleCell, cell).length > 0;
    }

    function sourceConnectorFieldsLocked(moduleCell, sourceCell) {
        if (!sourceCell || endpointType(sourceCell) !== "source") return false;
        if (assemblyHasConnectedPortRole(moduleCell, sourceCell, "output")) return true;
        const sourceAssembly = findAssemblyAncestor(sourceCell);
        if (!sourceAssembly || assemblyType(sourceAssembly) !== "source") return false;
        const parts = assemblyPartCells(sourceAssembly);
        const sourceIndex = parts.indexOf(sourceCell);
        return sourceIndex >= 0 && sourceIndex < parts.length - 1;
    }

    function isPortFree(moduleCell, port) {
        const normalized = normalizePort(port);
        const cell = portCell(moduleCell, normalized);
        if (!cell) return false;
        if (normalized.role === "input" && incomingAssemblyEdges(moduleCell, cell).length > 0) return false;
        return edgesForPort(moduleCell, normalized).length === 0;
    }

    function connectedAssembly(assembly) {
        const parts = assemblyPartCells(assembly);
        if (!parts.length) return false;
        if (parts.length > 1 && parts.some(function (part) { return endpointType(part) === "source"; })) return true;
        const moduleCell = findGardenModuleAncestor(assembly);
        return parts.some(function (part) { return incomingAssemblyEdges(moduleCell, part).length || outgoingAssemblyEdges(moduleCell, part).length; });
    }

    function wouldCreateAssemblyCycle(moduleCell, sourceCell, targetCell) {
        const seen = new Set();
        function visit(cell) {
            const id = getCellId(cell);
            if (!id || seen.has(id)) return false;
            if (cell === sourceCell) return true;
            seen.add(id);
            return outgoingAssemblyEdges(moduleCell, cell).some(function (edge) { return visit(edge.target); });
        }
        return visit(targetCell);
    }

    function autoPipePartIdForConnection(moduleCell, sourceConnector, targetConnector) {
        const catalog = readCatalog(moduleCell);
        const pipeSize = sourceConnector && targetConnector && sourceConnector.nominalSize === targetConnector.nominalSize ? sourceConnector.nominalSize : "";
        const candidates = catalog.items.filter(function (part) {
            const p = normalizeCatalogPart(part);
            if (!pipeSize) return false;
            return p && p.category === "pipe_tubing" && validateCatalogPart(p).ok &&
                p.connectors.input.nominalSize === pipeSize &&
                p.connectors.output.nominalSize === pipeSize;
        }).map(normalizeCatalogPart);
        candidates.sort(function (a, b) {
            const stockA = STOCK_AVAILABLE.has(a.stockState) ? 0 : 1;
            const stockB = STOCK_AVAILABLE.has(b.stockState) ? 0 : 1;
            return (stockA - stockB) || (finiteNumber(a.unitCost, a.cost) - finiteNumber(b.unitCost, b.cost)) || String(a.name).localeCompare(String(b.name));
        });
        return candidates[0] ? candidates[0].id : "";
    }

    function connectorsRequirePipe(sourceConnector, targetConnector) {
        return connectorRecordsRequirePipe(sourceConnector, targetConnector);
    }

    function connectorConnectionMode(moduleCell, sourceConnector, targetConnector) {
        if (ConnectorRules.connectorsRequirePipe(sourceConnector, targetConnector)) {
            const pipeMatch = ConnectorRules.pipeConnectorMatches(sourceConnector, targetConnector);
            if (!pipeMatch.ok) { irrigationDebug("connectorConnectionMode:rejected", { reason: pipeMatch.reason, mode: "pipe-match", sourceConnector, targetConnector }); return pipeMatch; }
            const pipePartId = ConnectorRules.autoPipePartIdForConnection(moduleCell, sourceConnector, targetConnector);
            if (!pipePartId) { const rejected = { ok: false, reason: "No compatible pipe part found for this connection." }; irrigationDebug("connectorConnectionMode:rejected", { reason: rejected.reason, mode: "pipe-part", sourceConnector, targetConnector }); return rejected; }
            return { ok: true, reason: "", mode: "pipe", pipePartId };
        }
        const direct = ConnectorRules.connectorMatches(sourceConnector, targetConnector, null);
        if (!direct.ok) irrigationDebug("connectorConnectionMode:rejected", { reason: direct.reason, mode: "direct", sourceConnector, targetConnector });
        return direct.ok ? { ok: true, reason: "", mode: "direct" } : direct;
    }

    function validatePortConnectionStructure(moduleCell, sourcePort, targetPort) {
        const source = normalizePort(sourcePort);
        const target = normalizePort(targetPort);
        if (source.role !== "output" || target.role !== "input") { irrigationDebug("connectionDecision:rejected", { stage: "structure", reason: "Select one output port and one inlet port.", source, target }); return { ok: false, reason: "Select one output port and one inlet port." }; }
        const sourceCell = portCell(moduleCell, source);
        const targetCell = portCell(moduleCell, target);
        if (!sourceCell || !targetCell) { irrigationDebug("connectionDecision:rejected", { stage: "structure", reason: "Selected port is no longer available.", source, target, sourceCell: debugCellSummary(sourceCell), targetCell: debugCellSummary(targetCell) }); return { ok: false, reason: "Selected port is no longer available." }; }
        if (sourceCell === targetCell) { irrigationDebug("connectionDecision:rejected", { stage: "structure", reason: "A part cannot connect to itself.", source, target, sourceCell: debugCellSummary(sourceCell) }); return { ok: false, reason: "A part cannot connect to itself." }; }
        const sourceAssembly = findAssemblyAncestor(sourceCell);
        const targetAssembly = findAssemblyAncestor(targetCell);
        if (sourceAssembly && targetAssembly && sourceAssembly === targetAssembly) { irrigationDebug("connectionDecision:rejected", { stage: "structure", reason: "Selected ports are already in the same assembly.", source, target, sourceCell: debugCellSummary(sourceCell), targetCell: debugCellSummary(targetCell), sourceAssembly: debugCellSummary(sourceAssembly) }); return { ok: false, reason: "Selected ports are already in the same assembly." }; }
        if (sourceAssembly && targetAssembly && sourceAssembly !== targetAssembly) {
            if (assemblyType(sourceAssembly) !== "bed" && lastAssemblyPart(sourceAssembly) !== sourceCell) { irrigationDebug("connectionDecision:rejected", { stage: "structure", reason: "Connect from the last part in the upstream assembly.", source, target, sourceCell: debugCellSummary(sourceCell), lastSourcePart: debugCellSummary(lastAssemblyPart(sourceAssembly)), sourceAssembly: debugCellSummary(sourceAssembly) }); return { ok: false, reason: "Connect from the last part in the upstream assembly." }; }
            if (assemblyType(targetAssembly) !== "bed" && firstAssemblyPart(targetAssembly) !== targetCell) { irrigationDebug("connectionDecision:rejected", { stage: "structure", reason: "Connect to the first part in the downstream assembly.", source, target, targetCell: debugCellSummary(targetCell), firstTargetPart: debugCellSummary(firstAssemblyPart(targetAssembly)), targetAssembly: debugCellSummary(targetAssembly) }); return { ok: false, reason: "Connect to the first part in the downstream assembly." }; }
        }
        if (source.index >= portCapacityForCell(moduleCell, sourceCell, "output")) { irrigationDebug("connectionDecision:rejected", { stage: "structure", reason: "Selected output does not exist.", source, sourceCell: debugCellSummary(sourceCell), outputCapacity: portCapacityForCell(moduleCell, sourceCell, "output") }); return { ok: false, reason: "Selected output does not exist." }; }
        if (target.index >= portCapacityForCell(moduleCell, targetCell, "input")) { irrigationDebug("connectionDecision:rejected", { stage: "structure", reason: "Selected inlet does not exist.", target, targetCell: debugCellSummary(targetCell), inputCapacity: portCapacityForCell(moduleCell, targetCell, "input") }); return { ok: false, reason: "Selected inlet does not exist." }; }
        if (!isPortFree(moduleCell, source)) { irrigationDebug("connectionDecision:rejected", { stage: "structure", reason: "Selected output is already connected.", source, sourceCell: debugCellSummary(sourceCell), edges: edgesForPort(moduleCell, source).map(debugCellSummary) }); return { ok: false, reason: "Selected output is already connected." }; }
        if (!isPortFree(moduleCell, target)) { irrigationDebug("connectionDecision:rejected", { stage: "structure", reason: "Selected inlet is already connected.", target, targetCell: debugCellSummary(targetCell), edges: edgesForPort(moduleCell, target).map(debugCellSummary) }); return { ok: false, reason: "Selected inlet is already connected." }; }
        if (wouldCreateAssemblyCycle(moduleCell, sourceCell, targetCell)) { irrigationDebug("connectionDecision:rejected", { stage: "structure", reason: "Irrigation assemblies must remain a tree.", source, target, sourceCell: debugCellSummary(sourceCell), targetCell: debugCellSummary(targetCell) }); return { ok: false, reason: "Irrigation assemblies must remain a tree." }; }
        return { ok: true, reason: "", source, target, sourceCell, targetCell, sourceAssembly, targetAssembly };
    }

    function connectionDecisionForPorts(moduleCell, sourcePort, targetPort) {
        const structure = ConnectorRules.validatePortConnectionStructure(moduleCell, sourcePort, targetPort);
        if (!structure.ok) { irrigationDebug("connectionDecision:rejected", { stage: "structure-result", reason: structure.reason, sourcePort: normalizePort(sourcePort), targetPort: normalizePort(targetPort) }); return structure; }
        const sourceConnector = ConnectorRules.portConnectorForCell(moduleCell, structure.sourceCell, "output");
        const targetConnector = ConnectorRules.portConnectorForCell(moduleCell, structure.targetCell, "input");
        const compatibility = ConnectorRules.connectionMode(moduleCell, sourceConnector, targetConnector);
        if (!compatibility.ok) { irrigationDebug("connectionDecision:rejected", { stage: "compatibility", reason: compatibility.reason, source: structure.source, target: structure.target, sourceCell: debugCellSummary(structure.sourceCell), targetCell: debugCellSummary(structure.targetCell), sourceConnector, targetConnector }); return compatibility; }
        const sourceCapacity = portCapacityForCell(moduleCell, structure.sourceCell, "output");
        const sourceBed = assemblyType(structure.sourceAssembly) === "bed";
        const targetBed = assemblyType(structure.targetAssembly) === "bed";
        const canMerge = !sourceBed && !targetBed && sourceCapacity <= 1 && structure.sourceAssembly && structure.targetAssembly;
        return Object.assign({}, structure, { mode: compatibility.mode === "pipe" ? "pipe" : (canMerge ? "merge" : "direct"), pipePartId: compatibility.pipePartId || "" });
    }

    function bridgeSuggestionEligibility(moduleCell, sourcePort, targetPort) {
        const structure = ConnectorRules.validatePortConnectionStructure(moduleCell, sourcePort, targetPort);
        if (!structure.ok) return Object.assign({}, structure, { bridgeable: false });
        const sourceConnector = ConnectorRules.portConnectorForCell(moduleCell, structure.sourceCell, "output");
        const targetConnector = ConnectorRules.portConnectorForCell(moduleCell, structure.targetCell, "input");
        const compatibility = ConnectorRules.connectionMode(moduleCell, sourceConnector, targetConnector);
        return compatibility.ok ? Object.assign({}, structure, { ok: false, bridgeable: false, reason: "Selected ports can connect directly." }) : Object.assign({}, structure, { ok: true, bridgeable: true, reason: compatibility.reason, sourceConnector, targetConnector });
    }

    function validatePortConnection(moduleCell, sourcePort, targetPort) {
        const decision = ConnectorRules.connectionDecision(moduleCell, sourcePort, targetPort);
        return decision.ok ? { ok: true, reason: "", mode: decision.mode } : { ok: false, reason: decision.reason };
    }

    function createAssemblyConnection(moduleCell, sourcePort, targetPort) {
        if (activeIrrigationEditDepth === 0) return runIrrigationEdit("createAssemblyConnection", function () { return createAssemblyConnection(moduleCell, sourcePort, targetPort); });
        const decision = ConnectorRules.connectionDecision(moduleCell, sourcePort, targetPort);
        if (!decision.ok) { irrigationDebug("createAssemblyConnection:rejected", { reason: decision.reason, sourcePort: normalizePort(sourcePort), targetPort: normalizePort(targetPort) }); return { ok: false, reason: decision.reason, edge: null, mode: "" }; }
        if (decision.mode === "merge") return mergeAssemblyConnection(moduleCell, decision);
        const attrs = {
            [ATTRS.EDGE_SOURCE_PORT]: String(decision.source.index),
            [ATTRS.EDGE_TARGET_PORT]: String(decision.target.index)
        };
        if (decision.mode === "pipe") { attrs[ATTRS.PIPE_EDGE] = "1"; attrs[ATTRS.PIPE_PART_ID] = decision.pipePartId; attrs[ATTRS.PART_STATE] = PART_STATE_PLANNED; }
        else attrs[ATTRS.DIRECT_LINK_EDGE] = "1";
        const edgeLabel = connectionEdgeDisplayLabelForDecision(moduleCell, decision);
        attrs.label = edgeLabel;
        let edge = null;
        programmaticEdgeInsertDepth++;
        try {
            edge = createEdge(moduleCell, decision.sourceCell, decision.targetCell, edgeLabel, decision.mode === "pipe" ? pipeEdgeStyleForPart(moduleCell, decision.pipePartId, PIPE_EDGE_BASE_STYLE) : DIRECT_LINK_EDGE_STYLE, attrs);
            syncConnectionEdgeVisualAnchors(moduleCell, edge); // NEW
        } finally {
            programmaticEdgeInsertDepth = Math.max(0, programmaticEdgeInsertDepth - 1);
        }
        if (edge && graph.refresh) graph.refresh(edge);
        return { ok: true, reason: "", edge, mode: decision.mode };
    }

    function mergeAssemblyConnection(moduleCell, decision) {
        const sourceAssembly = decision.sourceAssembly;
        const targetAssembly = decision.targetAssembly;
        if (!sourceAssembly || !targetAssembly || sourceAssembly === targetAssembly) return { ok: false, reason: "Assemblies cannot be merged.", edge: null, mode: "merge" };
        model.beginUpdate && model.beginUpdate();
        try {
            const moved = assemblyPartCells(targetAssembly);
            moved.forEach(function (cell) { moveCellToParent(cell, sourceAssembly); });
            reflowAssemblyParts(sourceAssembly);
            removeCellFromParent(targetAssembly);
            return { ok: true, reason: "", edge: null, mode: "merge", assembly: sourceAssembly };
        } finally { model.endUpdate && model.endUpdate(); }
    }

    function retargetConnectionEdge(edge, terminal, isSource) {
        if (!edge || !terminal) return;
        if (model.setTerminal) model.setTerminal(edge, terminal, !!isSource);
        if (isSource) edge.source = terminal;
        else edge.target = terminal;
    }

    function updateConnectionEdgeAttrs(edge, decision) {
        if (!edge || !decision) return;
        if (decision.mode === "pipe") {
            const pipePartId = String(decision.pipePartId || "").trim();
            if (!pipePartId) return;
            setCellAttrs(edge, { [ATTRS.PIPE_EDGE]: "1", [ATTRS.DIRECT_LINK_EDGE]: "", [ATTRS.PIPE_PART_ID]: pipePartId, [ATTRS.PART_STATE]: partStateForCell(edge), [ATTRS.EDGE_SOURCE_PORT]: String(decision.source.index), [ATTRS.EDGE_TARGET_PORT]: String(decision.target.index) });
            applyPipeEdgeLifecycleStyle(edge, findGardenModuleAncestor(edge), PIPE_EDGE_BASE_STYLE);
            syncConnectionEdgeDisplayLabel(findGardenModuleAncestor(edge), edge);
            syncConnectionEdgeVisualAnchors(findGardenModuleAncestor(edge), edge); // NEW
            return;
        }
        else { setCellAttrs(edge, { [ATTRS.PIPE_EDGE]: "", [ATTRS.DIRECT_LINK_EDGE]: "1", [ATTRS.PIPE_PART_ID]: "", [ATTRS.EDGE_SOURCE_PORT]: String(decision.source.index), [ATTRS.EDGE_TARGET_PORT]: String(decision.target.index) }); applyDirectLinkEdgeStyle(edge); syncConnectionEdgeDisplayLabel(findGardenModuleAncestor(edge), edge); syncConnectionEdgeVisualAnchors(findGardenModuleAncestor(edge), edge); } // CHANGE
    }

    function existingEdgeConnectionDecision(moduleCell, sourcePort, targetPort) {
        const source = normalizePort(sourcePort);
        const target = normalizePort(targetPort);
        if (source.role !== "output" || target.role !== "input") return { ok: false, reason: "Select one output port and one inlet port." };
        const sourceCell = portCell(moduleCell, source);
        const targetCell = portCell(moduleCell, target);
        if (!sourceCell || !targetCell) return { ok: false, reason: "Selected port is no longer available." };
        if (sourceCell === targetCell) return { ok: false, reason: "A part cannot connect to itself." };
        const compatibility = ConnectorRules.connectionMode(moduleCell, ConnectorRules.portConnectorForCell(moduleCell, sourceCell, "output"), ConnectorRules.portConnectorForCell(moduleCell, targetCell, "input"));
        return compatibility.ok ? Object.assign({}, compatibility, { source, target, sourceCell, targetCell }) : compatibility;
    }

    function moveCellToParent(cell, parent, index) {
        if (!cell || !parent) return;
        if (model.add) { model.add(parent, cell, index == null ? getChildCells(parent).length : index); return; }
        const oldParent = model.getParent ? model.getParent(cell) : cell.parent;
        if (oldParent && oldParent.children) {
            const oldIndex = oldParent.children.indexOf(cell);
            if (oldIndex >= 0) oldParent.children.splice(oldIndex, 1);
        }
        cell.parent = parent;
        if (!parent.children) parent.children = [];
        parent.children.splice(index == null ? parent.children.length : index, 0, cell);
    }

    function reflowAssemblyParts(assembly) {
        assemblyPartCells(assembly).forEach(function (cell, index) {
            setGeometry(cell, { y: assemblyPartY(index) }); // CHANGE
        });
        resizeAssemblyToChildren(assembly);
    }

    function insertAssemblyPartAt(assembly, part, index, flipped) { // CHANGE
        const parts = assemblyPartCells(assembly);
        const insertIndex = Math.max(0, Math.min(parts.length, Math.floor(finiteNumber(index, parts.length))));
        parts.forEach(function (cell, cellIndex) {
            if (cellIndex >= insertIndex) {
                const geo = getGeometry(cell) || {};
                setGeometry(cell, { y: finiteNumber(geo.y, ASSEMBLY_HEADER_SIZE) + ASSEMBLY_PART_HEIGHT }); // CHANGE
            }
        });
        const cell = createAssemblyPartCell(assembly, installedPartDisplayName(part, flipped), assemblyPartCellAttrs(part, flipped), insertIndex); // CHANGE
        reflowAssemblyParts(assembly);
        return cell;
    }

    function splitAssemblySegment(moduleCell, assembly, startIndex) {
        const parts = assemblyPartCells(assembly);
        const splitIndex = Math.max(0, Math.min(parts.length, Math.floor(finiteNumber(startIndex, parts.length))));
        const moved = parts.slice(splitIndex);
        if (!moved.length) return null;
        const geo = getGeometry(assembly) || {};
        const splitAssembly = createAssemblyLane(moduleCell, "Disconnected Assembly", finiteNumber(geo.x, 24), finiteNumber(geo.y, 72) + finiteNumber(geo.height, 120) + 40, assemblyType(assembly), {});
        moved.forEach(function (cell, index) { moveCellToParent(cell, splitAssembly, index); });
        reflowAssemblyParts(assembly);
        positionSplitAssemblyBelow(assembly, splitAssembly);
        reflowAssemblyParts(splitAssembly);
        return splitAssembly;
    }

    function splitAssemblyPrefix(moduleCell, assembly, endIndex) {
        const parts = assemblyPartCells(assembly);
        const splitEnd = Math.max(0, Math.min(parts.length, Math.floor(finiteNumber(endIndex, 0))));
        const moved = parts.slice(0, splitEnd);
        if (!moved.length) return null;
        const geo = getGeometry(assembly) || {};
        const splitAssembly = createAssemblyLane(moduleCell, "Disconnected Assembly", finiteNumber(geo.x, 24), finiteNumber(geo.y, 72) + finiteNumber(geo.height, 120) + 40, assemblyType(assembly), {});
        moved.forEach(function (cell, index) { moveCellToParent(cell, splitAssembly, index); });
        reflowAssemblyParts(assembly);
        positionSplitAssemblyBelow(assembly, splitAssembly);
        reflowAssemblyParts(splitAssembly);
        return splitAssembly;
    }

    function positionSplitAssemblyBelow(upstreamAssembly, splitAssembly) {
        const upstreamGeo = getGeometry(upstreamAssembly) || {};
        if (!splitAssembly) return;
        setGeometry(splitAssembly, { x: finiteNumber(upstreamGeo.x, 24), y: finiteNumber(upstreamGeo.y, 72) + finiteNumber(upstreamGeo.height, 120) + 40 });
    }

    function managedConnectionEdge(edge) {
        return !!edge && !isLegacyGenerated(edge) && (getCellAttr(edge, ATTRS.PIPE_EDGE, "") === "1" || getCellAttr(edge, ATTRS.DIRECT_LINK_EDGE, "") === "1");
    }

    function boundaryKey(boundary) {
        const b = boundary || {};
        if (b.type === "edge") return "edge:" + String(b.edgeId || "");
        if (b.type === "internal") return ["internal", b.assemblyId || "", b.upstreamId || "", b.downstreamId || ""].join(":");
        return "";
    }

    function edgeBoundary(edge) {
        return edge && managedConnectionEdge(edge) ? { type: "edge", edgeId: getCellId(edge) || "" } : null;
    }

    function internalBoundaryForParts(assembly, upstream, downstream) {
        if (!assembly || !upstream || !downstream) return null;
        return { type: "internal", assemblyId: getCellId(assembly) || "", upstreamId: getCellId(upstream) || "", downstreamId: getCellId(downstream) || "" };
    }

    function normalizeBoundary(boundary) {
        const b = boundary || {};
        if (b.type === "edge") return { type: "edge", edgeId: String(b.edgeId || "") };
        if (b.type === "internal") return { type: "internal", assemblyId: String(b.assemblyId || ""), upstreamId: String(b.upstreamId || ""), downstreamId: String(b.downstreamId || "") };
        return { type: "", edgeId: "", assemblyId: "", upstreamId: "", downstreamId: "" };
    }

    function boundaryForPort(moduleCell, port) {
        const edge = edgesForPort(moduleCell, port)[0];
        return edgeBoundary(edge);
    }

    function uniqueBoundaries(boundaries) {
        const seen = new Set();
        const out = [];
        (boundaries || []).forEach(function (boundary) {
            const normalized = normalizeBoundary(boundary);
            const key = boundaryKey(normalized);
            if (!key || seen.has(key)) return;
            seen.add(key);
            out.push(normalized);
        });
        return out;
    }

    function boundaryExists(moduleCell, boundary) {
        const b = normalizeBoundary(boundary);
        if (b.type === "edge") return !!findCellById(moduleCell, b.edgeId);
        if (b.type !== "internal") return false;
        const assembly = findCellById(moduleCell, b.assemblyId);
        const upstream = findCellById(moduleCell, b.upstreamId);
        const downstream = findCellById(moduleCell, b.downstreamId);
        const parts = assemblyPartCells(assembly);
        return !!assembly && !!upstream && !!downstream && parts.indexOf(upstream) >= 0 && parts[parts.indexOf(upstream) + 1] === downstream;
    }

    function selectedValidBoundaries(session) {
        return uniqueBoundaries(session && session.selectedBoundaries || []).filter(function (boundary) { return boundaryExists(session.moduleCell, boundary); });
    }

    function selectedOccupiedBoundaries(session, ports) {
        const boundaries = selectedValidBoundaries(session);
        (ports || selectedValidPorts(session)).forEach(function (port) {
            const boundary = boundaryForPort(session.moduleCell, port);
            if (boundary) boundaries.push(boundary);
        });
        return uniqueBoundaries(boundaries);
    }

    function resolveSelectedConnectionContext(session) {
        const anchorPort = normalizePort(session && session.inlineActionAnchorPort || {});
        const anchorEdge = anchorPort.cellId ? edgesForPort(session.moduleCell, anchorPort)[0] : null;
        const anchorContext = anchorEdge && managedConnectionEdge(anchorEdge) ? externalConnectionContextForEdge(session.moduleCell, anchorEdge, edgeBoundary(anchorEdge)) : null;
        if (anchorContext && currentSelectionCells().some(function (cell) { return connectionContextTouchesCell(anchorContext, cell); })) return anchorContext;
        const focusedBoundary = normalizeBoundary(session && session.focusedConnectionBoundary || {});
        const focusedContext = boundaryKey(focusedBoundary) ? connectionContextForBoundary(session.moduleCell, focusedBoundary) : null;
        const selectedBoundaryCount = selectedValidBoundaries(session).length;
        if (focusedContext && selectedBoundaryCount <= 1 && currentSelectionCells().some(function (cell) { return connectionContextTouchesCell(focusedContext, cell); })) return focusedContext;
        const selectedEdges = uniqueBoundaries(currentSelectionCells().map(edgeBoundary).filter(Boolean));
        if (selectedEdges.length === 1) return connectionContextForBoundary(session.moduleCell, selectedEdges[0]);
        if (selectedEdges.length > 1) return null;
        const selectedBoundaries = selectedValidBoundaries(session);
        if (selectedBoundaries.length === 1) return connectionContextForBoundary(session.moduleCell, selectedBoundaries[0]);
        const boundaries = uniqueBoundaries(selectedValidBoundaries(session).filter(function (boundary) { return boundaryTouchesCurrentSelection(session.moduleCell, boundary); }));
        if (boundaries.length !== 1) return null;
        return connectionContextForBoundary(session.moduleCell, boundaries[0]);
    }

    function boundaryTouchesCurrentSelection(moduleCell, boundary) {
        const cells = currentSelectionCells();
        if (!cells.length) return false;
        const context = connectionContextForBoundary(moduleCell, boundary);
        if (!context) return false;
        return cells.some(function (cell) { return connectionContextTouchesCell(context, cell); });
    }

    function connectionContextTouchesCell(context, cell) {
        if (!context || !cell) return false;
        if (context.edge && cell === context.edge) return true;
        if (cell === context.sourceCell || cell === context.targetCell || cell === context.assembly) return true;
        if (isAssembly(cell)) return findAssemblyAncestor(context.sourceCell) === cell || findAssemblyAncestor(context.targetCell) === cell;
        const selectedAssembly = findAssemblyAncestor(cell);
        return selectedAssembly && (selectedAssembly === findAssemblyAncestor(context.sourceCell) || selectedAssembly === findAssemblyAncestor(context.targetCell));
    }

    function connectionContextForBoundary(moduleCell, boundary) {
        const b = normalizeBoundary(boundary);
        if (b.type === "edge") return externalConnectionContext(moduleCell, b);
        if (b.type === "internal") return internalConnectionContext(moduleCell, b);
        return null;
    }

    function externalConnectionContext(moduleCell, boundary) {
        const edge = findCellById(moduleCell, boundary.edgeId);
        if (!edge) return null;
        return externalConnectionContextForEdge(moduleCell, edge, boundary);
    }

    function externalConnectionContextForEdge(moduleCell, edge, boundary) {
        const sourceCell = edge.source || (model.getTerminal && model.getTerminal(edge, true));
        const targetCell = edge.target || (model.getTerminal && model.getTerminal(edge, false));
        if (!sourceCell || !targetCell) return null;
        const mode = getCellAttr(edge, ATTRS.DIRECT_LINK_EDGE, "") === "1" ? "direct" : "pipe";
        return {
            kind: "external",
            mode,
            boundary,
            edge,
            sourceCell,
            targetCell,
            sourcePort: portForConnectionEdge(edge, true),
            targetPort: portForConnectionEdge(edge, false),
            pipePartId: getCellAttr(edge, ATTRS.PIPE_PART_ID, ""),
            lengthFt: mode === "pipe" ? measuredEdgeLengthFeet(edge) : 0
        };
    }

    function internalConnectionContext(moduleCell, boundary) {
        const assembly = findCellById(moduleCell, boundary.assemblyId);
        const sourceCell = findCellById(moduleCell, boundary.upstreamId);
        const targetCell = findCellById(moduleCell, boundary.downstreamId);
        if (!assembly || !sourceCell || !targetCell || !boundaryExists(moduleCell, boundary)) return null;
        return {
            kind: "internal",
            mode: "internal",
            boundary,
            assembly,
            sourceCell,
            targetCell,
            sourcePort: { cellId: getCellId(sourceCell), role: "output", index: 0 },
            targetPort: { cellId: getCellId(targetCell), role: "input", index: 0 },
            pipePartId: "",
            lengthFt: 0
        };
    }

    function clearSelectedExternalPortBoundaries(session) {
        session.selectedBoundaries = (session.selectedBoundaries || []).filter(function (boundary) { return normalizeBoundary(boundary).type !== "edge"; });
    }

    function clearSelectedConnectionBoundaries(session) {
        session.selectedBoundaries = [];
        session.focusedConnectionBoundary = null;
        session.inlineActionAnchorPort = null;
    }

    function clearSelectedPortAndBoundaryState(session) {
        if (!session) return false;
        const changed = (session.selectedPorts && session.selectedPorts.length) ||
            (session.selectedBoundaries && session.selectedBoundaries.length) ||
            session.inlineActionAnchorPort || session.focusedConnectionBoundary || session.bridgePorts;
        session.selectedPorts = [];
        session.selectedBoundaries = [];
        session.inlineActionAnchorPort = null;
        session.focusedConnectionBoundary = null;
        session.bridgePorts = null;
        return !!changed;
    }

    function clearPortSelectionForGraphSelection(session) {
        if (!session) return false;
        if (session.preservePortSelectionOnNextGraphSelection) {
            session.preservePortSelectionOnNextGraphSelection = false;
            return false;
        }
        return clearSelectedPortAndBoundaryState(session);
    }

    function toggleSelectedPortBoundary(session, boundary) {
        const normalized = normalizeBoundary(boundary);
        const key = boundaryKey(normalized);
        if (!key) return;
        const current = selectedValidBoundaries(session);
        const selected = current.map(boundaryKey).indexOf(key) >= 0;
        session.selectedPorts = [];
        if (selected) {
            if (boundaryKey(session.focusedConnectionBoundary) === key) session.focusedConnectionBoundary = null;
            if (boundaryKey(boundaryForPort(session.moduleCell, session.inlineActionAnchorPort)) === key) session.inlineActionAnchorPort = null;
            session.selectedBoundaries = current.filter(function (entry) { return boundaryKey(entry) !== key; });
        } else session.selectedBoundaries = [normalized];
    }

    function toggleSelectedBoundary(session, boundary) {
        const normalized = normalizeBoundary(boundary);
        const key = boundaryKey(normalized);
        if (!key) return;
        const selected = selectedValidBoundaries(session).map(boundaryKey).indexOf(key) >= 0;
        session.selectedPorts = [];
        if (selected) clearSelectedConnectionBoundaries(session);
        else session.selectedBoundaries = [normalized];
    }

    function selectBoundary(session, boundary) {
        const normalized = normalizeBoundary(boundary);
        const key = boundaryKey(normalized);
        if (!key) return;
        const current = session.selectedBoundaries || [];
        if (current.map(boundaryKey).indexOf(key) < 0) current.push(normalized);
        session.selectedBoundaries = current;
    }

    function disconnectBoundary(moduleCell, boundary) {
        const b = normalizeBoundary(boundary);
        if (b.type === "edge") {
            const edge = findCellById(moduleCell, b.edgeId);
            if (!edge) return false;
            removeCellFromParent(edge);
            return true;
        }
        if (b.type === "internal") {
            const assembly = findCellById(moduleCell, b.assemblyId);
            const downstream = findCellById(moduleCell, b.downstreamId);
            const parts = assemblyPartCells(assembly);
            const index = parts.indexOf(downstream);
            if (!assembly || index <= 0) return false;
            splitAssemblySegment(moduleCell, assembly, index);
            return true;
        }
        return false;
    }

    function disconnectBoundaries(moduleCell, boundaries) {
        let count = 0;
        uniqueBoundaries(boundaries).forEach(function (boundary) { if (disconnectBoundary(moduleCell, boundary)) count++; });
        return count;
    }

    function externalEdgesForCell(moduleCell, cell) {
        return incomingAssemblyEdges(moduleCell, cell).concat(outgoingAssemblyEdges(moduleCell, cell));
    }

    function externalEdgesForAssemblyCell(moduleCell, assembly) {
        const edges = externalEdgesForCell(moduleCell, assembly);
        assemblyPartCells(assembly).forEach(function (part) {
            externalEdgesForCell(moduleCell, part).forEach(function (edge) { if (edges.indexOf(edge) < 0) edges.push(edge); });
        });
        return edges;
    }

    function deleteAssemblyPartCell(moduleCell, partCell) {
        const assembly = findAssemblyAncestor(partCell);
        const parts = assemblyPartCells(assembly);
        const index = parts.indexOf(partCell);
        if (!assembly || index < 0) return false;
        externalEdgesForCell(moduleCell, partCell).forEach(removeCellFromParent);
        if (index < parts.length - 1) splitAssemblySegment(moduleCell, assembly, index + 1);
        removeCellFromParent(partCell);
        if (assemblyPartCells(assembly).length) reflowAssemblyParts(assembly);
        else removeCellFromParent(assembly);
        return true;
    }

    function partCanReceiveFromConnector(part, connector) {
        const p = normalizeCatalogPart(part);
        if (!p || p.category === "pipe_tubing" || p.connectors.inputs <= 0) return false;
        return partConnectorOrientations(p).some(function (entry) { return connectorRecordsMatch(connector, entry.inputConnector, null).ok; }); // CHANGE
    }

    function partHasPipeCapableInput(part) {
        const p = normalizeCatalogPart(part);
        return !!(p && p.connectors.inputs > 0 && partConnectorOrientations(p).some(function (entry) { return connectorUsesPipe(entry.inputConnector); })); // CHANGE
    }

    function partCanFeedConnector(part, connector) {
        const p = normalizeCatalogPart(part);
        if (!p || p.category === "pipe_tubing" || p.connectors.outputs <= 0) return false;
        return partConnectorOrientations(p).some(function (entry) { return connectorRecordsMatch(entry.outputConnector, connector, null).ok; }); // CHANGE
    }

    function partConnectorOrientations(part) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        if (!p || !p.connectors) return []; // NEW
        const orientations = [{ part: p, flipped: false, inputConnector: p.connectors.input, outputConnector: p.connectors.output, inputSide: "input", outputSide: "output" }]; // CHANGE
        if (isReversibleFittingPart(p)) orientations.push({ part: p, flipped: true, inputConnector: p.connectors.output, outputConnector: p.connectors.input, inputSide: "output", outputSide: "input" }); // CHANGE
        return orientations; // NEW
    } // NEW

    function isExposedAssemblyOutletRow(row) {
        if (!row || row.role !== "output") return false;
        if (row.bedPort) return true;
        const assembly = findAssemblyAncestor(row.cell);
        return !!(assembly && assemblyType(assembly) !== "bed" && lastAssemblyPart(assembly) === row.cell && !internalNeighborForPort(row.cell, "output"));
    }

    function partAllowedForConnectionRow(moduleCell, row, part) {
        if (isExposedAssemblyOutletRow(row) && !partHasPipeCapableInput(part)) { // CHANGE
            const decision = dropdownPartConnectionDecision(moduleCell, row, part); // NEW
            return !!(decision && decision.ok && !decision.pipeRequired); // NEW
        } // CHANGE
        return true;
    }

    function compatibleDropdownParts(moduleCell, cell, role) {
        const connector = ConnectorRules.portConnectorForCell(moduleCell, cell, role);
        return sortCatalogParts(readCatalog(moduleCell).items).map(normalizeCatalogPart).filter(function (part) {
            if (!part || part.category === "pipe_tubing" || !validateCatalogPart(part).ok) return false;
            return role === "output" ? partCanReceiveFromConnector(part, connector) : partCanFeedConnector(part, connector);
        });
    }

    function addPartPickerContext(session) {
        const selectedPort = selectedFreeCompatibilityPort(session);
        if (selectedPort) return addPartContextFromPort(session.moduleCell, selectedPort);
        const selected = graph.getSelectionCell && graph.getSelectionCell();
        const ports = freeBoundaryPortsForCell(session.moduleCell, selected);
        return ports.length === 1 ? addPartContextFromPort(session.moduleCell, ports[0]) : null;
    }

    function addPartContextFromPort(moduleCell, port) {
        const normalized = normalizePort(port);
        const cell = portCell(moduleCell, normalized);
        if (!cell) return null;
        if (isAssembly(cell) && assemblyType(cell) === "bed") return { row: { cell, role: normalized.role, index: normalized.index, bedPort: true }, port: normalized };
        if (endpointType(cell) === "bed") return null;
        return { row: { cell, role: normalized.role, index: normalized.index }, port: normalized };
    }

    function freeBoundaryPortsForCell(moduleCell, cell) {
        const portCellCandidate = boundaryPortCell(cell, "input") || boundaryPortCell(cell, "output");
        if (!portCellCandidate && !(isAssembly(cell) && assemblyType(cell) === "bed")) return [];
        const cells = uniqueCells([boundaryPortCell(cell, "input"), boundaryPortCell(cell, "output")].filter(Boolean));
        const ports = [];
        cells.forEach(function (candidate) {
            ["input", "output"].forEach(function (role) {
                const count = portCapacityForCell(moduleCell, candidate, role);
                for (let index = 0; index < count; index++) {
                    const port = { cellId: getCellId(candidate), role, index };
                    if (isPortFree(moduleCell, port)) ports.push(port);
                }
            });
        });
        return ports;
    }

    function addPartPickerParts(session, context) {
        const baseParts = context ? compatibleDropdownParts(session.moduleCell, context.row.cell, context.row.role).filter(function (part) { return partAllowedForConnectionRow(session.moduleCell, context.row, part); }) : allAddableCatalogParts(session.moduleCell);
        const suppressed = context ? upstreamSingletonCategories(session.moduleCell, context.row) : new Set();
        const parts = baseParts.filter(function (part) { return !suppressed.has(part.category); }); // NEW
        return sortAddPartPickerParts(context ? parts.map(function (part) { return connectionContextPartOption(session.moduleCell, context.row, part); }) : parts); // CHANGE
    }

    function connectionContextPartOption(moduleCell, row, part) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        const decision = dropdownPartConnectionDecision(moduleCell, row, p); // NEW
        if (!p || !decision || !decision.ok) return p || part; // NEW
        return Object.assign({}, p, { name: installedPartDisplayName(p, decision.flipped), connectionFlipped: !!decision.flipped }); // NEW
    } // NEW

    function allAddableCatalogParts(moduleCell) {
        return readCatalog(moduleCell).items.map(normalizeCatalogPart).filter(function (part) {
            return part && part.category !== "pipe_tubing" && validateCatalogPart(part).ok;
        });
    }

    function upstreamSingletonCategories(moduleCell, row) {
        const categories = new Set();
        collectUpstreamBranchParts(moduleCell, row).forEach(function (part) {
            if (BRANCH_SINGLETON_CATEGORIES.has(part.category)) categories.add(part.category);
        });
        return categories;
    }

    function collectUpstreamBranchParts(moduleCell, row) {
        const seeds = row.role === "output" ? [row.cell] : upstreamIrrigationParents(moduleCell, row.cell);
        const stack = seeds.filter(Boolean);
        const seen = new Set();
        const parts = [];
        let foundSource = false;
        while (stack.length) {
            const cell = stack.pop();
            const id = getCellId(cell);
            if (!id || seen.has(id)) continue;
            seen.add(id);
            if (endpointType(cell) === "source") foundSource = true;
            const part = partForCell(moduleCell, cell);
            if (part) parts.push(part);
            upstreamIrrigationParents(moduleCell, cell).forEach(function (parent) { stack.push(parent); });
        }
        return foundSource ? parts : [];
    }

    function addPartContextLabel(moduleCell, context) {
        const cell = context && context.row && context.row.cell;
        const role = context && context.row && context.row.role;
        const connector = ConnectorRules.portConnectorForCell(moduleCell, cell, role);
        return portDisplayPrefix(moduleCell, cell, role).toLowerCase() + " " + ((context.row.index || 0) + 1) + " on " + irrigationCellLabel(cell) + " (" + connectorLabel(connector) + ")"; // CHANGE
    }

    function connectorLabel(connector) {
        if (!connector) return "unknown connector";
        return [connector.nominalSize, connector.type].filter(Boolean).join(" ") || "unknown connector";
    }

    function addPartStockGroupLabel(part) {
        return STOCK_AVAILABLE.has(normalizeCatalogPart(part).stockState) ? "In stock" : "Needs purchase";
    }

    function broadCategorySortIndex(part) {
        return partDisplayCategory(part).broadOrder; // CHANGE
    }

    function sortAddPartPickerParts(parts) {
        return (parts || []).slice().sort(function (a, b) {
            const stockA = STOCK_AVAILABLE.has(normalizeCatalogPart(a).stockState) ? 0 : 1;
            const stockB = STOCK_AVAILABLE.has(normalizeCatalogPart(b).stockState) ? 0 : 1;
            const keyA = catalogPartSortKey(a);
            const keyB = catalogPartSortKey(b);
            return (stockA - stockB) || compareCatalogPartSortKeys(keyA, keyB); // CHANGE
        });
    }

    function appendGroupedPartOptions(select, parts) {
        const groups = groupedPartSelectOptions(parts, { includeStock: true }); // CHANGE
        if (!groups.length) { appendSelectOption(select, "", "No compatible parts"); select.disabled = true; return; } // CHANGE
        groups.forEach(function (entry) { // CHANGE
            const group = document.createElement("optgroup");
            group.label = entry.label; // CHANGE
            entry.parts.forEach(function (part) { appendSelectOption(group, part.id, part.name); }); // CHANGE
            select.appendChild(group);
        });
    }

    function pipeEdgeLabel(moduleCell, edge, port) {
        if (!edge) return portDisplayRole(moduleCell, port) === "output" ? "Available: " + portDisplayLabel(moduleCell, port) + " downstream connection" : "Available: " + portDisplayLabel(moduleCell, port) + " upstream connection"; // CHANGE
        if (getCellAttr(edge, ATTRS.DIRECT_LINK_EDGE, "") === "1") return "Direct: " + edgeConnectionDisplayLabel(moduleCell, edge) + " to " + irrigationCellLabel(normalizePort(port).role === "output" ? edge.target : edge.source);
        const pipe = partById(readCatalog(moduleCell), getCellAttr(edge, ATTRS.PIPE_PART_ID, ""));
        const other = normalizePort(port).role === "output" ? edge.target : edge.source;
        return "Pipe: " + edgeConnectionDisplayLabel(moduleCell, edge) + " " + (pipe ? shortCatalogPartName(pipe) : "auto pipe") + " -> " + irrigationCellLabel(other);
    }

    function shortCatalogPartName(part) {
        const name = String(part && part.name || part && part.id || "").trim();
        return name.replace(/^\s*(?:\d+(?:\.\d+)?|\d+\s*\/\s*\d+)\s*(?:"|in|inch|inches)\s+/i, "").trim() || name; // CHANGE
    }

    function portDisplayLabel(moduleCell, port) {
        const normalized = normalizePort(port);
        return connectorDisplayLabel(ConnectorRules.portConnectorForCell(moduleCell, portCell(moduleCell, normalized), normalized.role));
    }

    function portDisplayRole(moduleCell, cellOrPort, storedRole) { // CHANGE
        const role = String(storedRole || cellOrPort && cellOrPort.role || ""); // CHANGE
        const cell = cellOrPort && cellOrPort.cellId ? portCell(moduleCell, normalizePort(cellOrPort)) : cellOrPort; // CHANGE
        return cell ? portVisualRoleForCell(moduleCell, cell, role) : role; // CHANGE
    } // CHANGE

    function portDisplayPrefix(moduleCell, cellOrPort, storedRole) { // CHANGE
        return portDisplayRole(moduleCell, cellOrPort, storedRole) === "input" ? "Inlet" : "Outlet"; // CHANGE
    } // CHANGE

    function cellPortDisplayLabel(moduleCell, cell, role) {
        return connectorDisplayLabel(ConnectorRules.portConnectorForCell(moduleCell, cell, role));
    }

    function edgeConnectionDisplayLabel(moduleCell, edge) {
        return connectionEdgeDisplayLabel(moduleCell, edge, ConnectorRules.portConnectorForCell(moduleCell, edge && edge.source, "output"), ConnectorRules.portConnectorForCell(moduleCell, edge && edge.target, "input"));
    }

    function internalConnectionDisplayLabel(moduleCell, upstream, downstream) {
        return connectionDisplayLabel(ConnectorRules.portConnectorForCell(moduleCell, upstream, "output"), ConnectorRules.portConnectorForCell(moduleCell, downstream, "input"));
    }

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
        return createBedEndpoint(bedCell, label, Object.assign({ connectorType: "barb", nominalSize: "1/2", pipeConnection: true }, profile || {}));
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
        const parsed = GraphStore.readJsonAttr(moduleCell, ATTRS.PATHS_JSON, null);
        return parsed && Array.isArray(parsed.paths) ? parsed.paths : [];
    }

    function writePaths(moduleCell, paths) {
        if (activeIrrigationEditDepth === 0) return runIrrigationEdit("writePaths", function () { return writePaths(moduleCell, paths); });
        GraphStore.writeJsonAttr(moduleCell, ATTRS.PATHS_JSON, { version: PLUGIN_VERSION, paths: paths || [] });
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
            partStates: (options && options.partStates || []).slice(),
            pipePartId: options && options.pipePartId || "",
            pipePartStates: (options && options.pipePartStates || []).slice(),
            pipeSegments: (options && options.pipeSegments || []).slice(),
            bedDemand: options && options.bedDemand || null,
            componentCellIds: [],
            pipeEdgeIds: [],
            bedTemplateCommitted: false,
            hydraulic: null,
            committedAt: null
        };
    }

    function makeDerivedAssemblyPath(options) {
        const source = options && options.sourceEndpoint;
        const target = options && options.targetEndpoint;
        return {
            id: (options && options.id) || ("assembly_" + sanitizeId(getCellId(source) + "_" + getCellId(target))),
            sourceEndpointId: getCellId(source) || (options && options.sourceEndpointId) || "",
            targetEndpointId: getCellId(target) || (options && options.targetEndpointId) || "",
            targetBedId: options && options.targetBedId || "",
            branchpointIds: (options && options.branchpointIds || []).slice(),
            partIds: (options && options.partIds || []).slice(),
            partStates: (options && options.partStates || []).slice(),
            pipePartId: options && options.pipePartId || "",
            pipePartStates: (options && options.pipePartStates || []).slice(),
            pipeSegments: (options && options.pipeSegments || []).slice(),
            bedDemand: null,
            componentCellIds: [],
            pipeEdgeIds: [],
            pipePartIds: [],
            bedTemplateCommitted: false,
            bedTemplate: null,
            hydraulic: null,
            committedAt: null
        };
    }

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
        if (path && path.bedDemand) return path.bedDemand;
        const template = path && path.bedTemplate;
        if (template && template.demand) return template.demand;
        if (template && Array.isArray(template.partIds)) {
            return template.partIds.reduce(function (out, partId) {
                const part = partById(catalog, partId);
                out.flowGpm += finiteNumber(part && part.specs && part.specs.flowGpm, 0);
                out.operatingPressurePsi = Math.max(out.operatingPressurePsi, finiteNumber(part && part.specs && part.specs.minOperatingPressurePsi, finiteNumber(part && part.specs && part.specs.operatingPressurePsi, 0)));
                return out;
            }, { flowGpm: 0, operatingPressurePsi: 0 });
        }
        return { flowGpm: 0, operatingPressurePsi: 0 };
    }

    function demandFromBedAssembly(moduleCell, bedAssembly) {
        const template = readBedAssemblyTemplateRecord(moduleCell, bedAssembly) || {};
        const demand = template.demand || {};
        return { flowGpm: finiteNumber(demand.flowGpm, 0), operatingPressurePsi: finiteNumber(demand.operatingPressurePsi, 0) };
    }

    function cumulativeBedDemand(moduleCell, bedAssembly) {
        const seen = new Set();
        function visit(assembly) {
            const id = getCellId(assembly);
            if (!id || seen.has(id)) return { flowGpm: 0, operatingPressurePsi: 0 };
            seen.add(id);
            const own = demandFromBedAssembly(moduleCell, assembly);
            return outgoingAssemblyEdges(moduleCell, assembly).reduce(function (total, edge) {
                if (!edge || !edge.target || !isAssembly(edge.target) || assemblyType(edge.target) !== "bed") return total;
                const downstream = visit(edge.target);
                total.flowGpm += downstream.flowGpm;
                total.operatingPressurePsi = Math.max(total.operatingPressurePsi, downstream.operatingPressurePsi);
                return total;
            }, own);
        }
        return visit(bedAssembly);
    }

    function calculatePathHydraulics(moduleCell, path) {
        const catalog = IrrigationCatalog.read(moduleCell);
        const source = findCellById(moduleCell, path.sourceEndpointId);
        if (!source) {
            const bedDemand = Hydraulics.demandFromPath(catalog, path);
            return {
                flowGpm: finiteNumber(bedDemand.flowGpm, 0),
                availablePressurePsi: null,
                operatingPressurePsi: finiteNumber(bedDemand.operatingPressurePsi, 0),
                maxOperatingPressurePsi: null,
                deliveredPressurePsi: null,
                pressureLossPsi: 0,
                requiredPressurePsi: finiteNumber(bedDemand.operatingPressurePsi, 0),
                marginPsi: null,
                ok: false,
                warnings: [DISCONNECTED_SOURCE_WARNING]
            };
        }
        const sourceProfile = endpointProfile(source);
        return Hydraulics.estimatePath({
            catalog,
            sourceProfile,
            bedDemand: Hydraulics.demandFromPath(catalog, path),
            partIds: path.partIds || [],
            pipePartId: path.pipePartId,
            pipeSegments: Hydraulics.pipeSegmentsForPath(moduleCell, path),
            lengthFt: path.pipePartId ? Hydraulics.pathRouteLengthFeet(moduleCell, path) : 0
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
        const catalog = IrrigationCatalog.read(moduleCell);
        const existing = ReportModel.deriveAssemblyPaths(moduleCell).filter(function (other) { return other.id !== path.id; });
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
        const catalog = IrrigationCatalog.read(moduleCell);
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
            const direct = ConnectorRules.connectorRecordsMatch({
                type: endpointProfile(source).connectorType,
                nominalSize: endpointProfile(source).nominalSize,
                pipeType: endpointProfile(source).pipeType || "",
                pipeConnection: !!endpointProfile(source).pipeConnection
            }, {
                type: endpointProfile(target).connectorType,
                nominalSize: endpointProfile(target).nominalSize,
                pipeType: endpointProfile(target).pipeType || "",
                pipeConnection: !!endpointProfile(target).pipeConnection
            }, endpointProfile(target));
            if (!direct.ok) errors.push("Source endpoint cannot connect directly to target endpoint: " + direct.reason);
            return errors;
        }
        const first = parts[0];
        const sourceMatch = ConnectorRules.canEndpointConnectToPart(endpointProfile(source), first);
        if (!sourceMatch.ok) errors.push("Source endpoint cannot connect to " + (first && first.name || partIds[0]) + ": " + sourceMatch.reason);
        for (let i = 1; i < parts.length; i++) {
            const match = ConnectorRules.canConnectParts(parts[i - 1], parts[i], endpointProfile(target));
            if (!match.ok) errors.push((parts[i - 1] && parts[i - 1].name || partIds[i - 1]) + " cannot connect to " + (parts[i] && parts[i].name || partIds[i]) + ": " + match.reason);
        }
        const last = parts[parts.length - 1];
        const targetMatch = ConnectorRules.canPartReachEndpoint(last, endpointProfile(target));
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
        const state = partStateForCell(cell);
        setCellAttrs(cell, {
            label,
            [ATTRS.COMPONENT]: "1",
            [ATTRS.COMPONENT_TYPE]: part ? part.category : "unknown",
            [ATTRS.CATALOG_PART_ID]: partId,
            [ATTRS.PART_STATE]: state,
            [ATTRS.PATH_ID]: pathId,
            [ATTRS.GENERATED]: "1"
        });
        applyPartCellLifecycleStyle(cell);
    }

    function updateGeneratedPipeEdge(edge, pipePartId, pathId) {
        if (!edge) return;
        const moduleCell = findGardenModuleAncestor(edge);
        const state = partStateForCell(edge);
        setCellAttrs(edge, {
            label: pipeEdgeDisplayLabelForPart(moduleCell, pipePartId || "", ConnectorRules.portConnectorForCell(moduleCell, edge.source, "output"), ConnectorRules.portConnectorForCell(moduleCell, edge.target, "input")),
            [ATTRS.PIPE_EDGE]: "1",
            [ATTRS.PIPE_PART_ID]: pipePartId || "",
            [ATTRS.PART_STATE]: state,
            [ATTRS.PATH_ID]: pathId,
            [ATTRS.GENERATED]: "1"
        });
        applyPipeEdgeLifecycleStyle(edge, moduleCell, GENERATED_PIPE_EDGE_BASE_STYLE);
    }

    function commitStagedPath(moduleCell, stagedPath) {
        const catalog = IrrigationCatalog.read(moduleCell);
        const path = Object.assign({}, stagedPath);
        const previous = readPaths(moduleCell).find(function (existing) { return existing.id === path.id; }) || {};
        if (!path.componentCellIds || !path.componentCellIds.length) path.componentCellIds = (previous.componentCellIds || []).slice();
        if (!path.pipeEdgeIds || !path.pipeEdgeIds.length) path.pipeEdgeIds = (previous.pipeEdgeIds || []).slice();
        path.hydraulic = Hydraulics.calculatePath(moduleCell, path);
        const blockers = Hydraulics.validatePathGraph(moduleCell, path)
            .concat(Hydraulics.validatePathCompatibility(moduleCell, path))
            .concat(Hydraulics.validateSharedCapacity(moduleCell, path))
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
                    ASSEMBLY_PART_PLANNED_STYLE,
                    {});
                updateGeneratedComponentCell(component, part, partId, path.id);
                if (component) createdComponents.push(component);
            });

            const chain = [sourceEndpoint].concat(createdComponents).concat([targetEndpoint]).filter(Boolean);
            const reusableEdges = findReusableCells(moduleCell, path.pipeEdgeIds, Math.max(0, chain.length - 1));
            for (let i = 0; i < chain.length - 1; i++) {
                const edgeLabel = pipeEdgeDisplayLabelForPart(moduleCell, path.pipePartId, ConnectorRules.portConnectorForCell(moduleCell, chain[i], "output"), ConnectorRules.portConnectorForCell(moduleCell, chain[i + 1], "input"));
                const edge = reusableEdges[i] || createEdge(parent, chain[i], chain[i + 1], edgeLabel, pipeEdgeStyleForPart(moduleCell, path.pipePartId, GENERATED_PIPE_EDGE_BASE_STYLE), { label: edgeLabel });
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
        if (activeIrrigationEditDepth === 0) return runIrrigationEdit("commitBedTemplate", function () { return commitBedTemplate(moduleCell, pathId, bedCell, template); });
        const linkedBedCell = isAssembly(bedCell) && assemblyType(bedCell) === "bed" ? bedCellForAssembly(moduleCell, bedCell) : bedCell;
        const bedAssembly = isAssembly(bedCell) && assemblyType(bedCell) === "bed" ? bedCell : resolveBedTemplateAssembly(moduleCell, bedCell);
        const previousRecord = bedAssembly ? readBedAssemblyTemplateRecord(moduleCell, bedAssembly) : null;
        const bedGeo = getGeometry(bedAssembly) || getGeometry(linkedBedCell) || { width: 160, height: 80 };
        const catalog = readCatalog(moduleCell); // NEW
        const templateDef = BED_TEMPLATES.find(function (entry) { return entry.id === (template && template.templateId); }) || BED_TEMPLATES[0];
        const roleParts = bedTemplateRolePartIds(template);
        const templateModel = template && template.templateModel === BED_TEMPLATE_MODEL_BOM ? BED_TEMPLATE_MODEL_BOM : "";
        const pipePartId = templateModel === BED_TEMPLATE_MODEL_BOM ? "" : bedTemplatePipePartId(templateDef.id, template && template.pipePartId);
        const partIds = template && Array.isArray(template.partIds) ? template.partIds.slice() : bedTemplatePartIds(roleParts.inletPartId, roleParts.outletPartId);
        const rowCount = Math.max(0, Math.floor(finiteNumber(template && template.spacing && template.spacing.rows, templateDef.defaultRows)));
        const rowOrientation = normalizeBedRowOrientation(template && template.rowOrientation, templateDef);
        const hasAssemblyLabelMode = !!(template && Object.prototype.hasOwnProperty.call(template, "assemblyLabelMode"));
        const spacing = Object.assign({ rows: rowCount, emitterInches: 12, rowSpacingCm: rowSpacingCmForRows(bedGeo, rowCount, rowOrientation) }, template && template.spacing || {});
        spacing.rowSpacingCm = rowSpacingCmForRows(bedGeo, rowCount, rowOrientation);
        const demand = {
            flowGpm: rowCount > 0 ? finiteNumber(template && template.demand && template.demand.flowGpm, templateDef.flowGpm) : 0,
            operatingPressurePsi: rowCount > 0 ? finiteNumber(template && template.demand && template.demand.operatingPressurePsi, templateDef.pressurePsi) : 0
        };
        const record = {
            version: PLUGIN_VERSION,
            pathId,
            templateId: templateDef.id,
            irrigationType: "", // CHANGE
            inletPartId: roleParts.inletPartId,
            outletPartId: roleParts.outletPartId,
            pipePartId,
            partIds,
            partState: normalizePartState(template && template.partState || previousRecord && previousRecord.partState),
            spacing,
            demand,
            assemblyLabelMode: hasAssemblyLabelMode ? String(template.assemblyLabelMode || "") : (templateModel === BED_TEMPLATE_MODEL_BOM ? BED_ASSEMBLY_LABEL_HIDDEN : ""),
            committedAt: new Date().toISOString()
        };
        if (templateModel === BED_TEMPLATE_MODEL_BOM) {
            const terminalParts = normalizeBedTerminalPartIds(template);
            record.templateModel = BED_TEMPLATE_MODEL_BOM;
            record.recipeVersion = finiteNumber(template && template.recipeVersion, template && template.resolvedBomParts ? BED_RECIPE_VERSION : 0);
            record.outletPartId = terminalParts.outletPartId;
            record.rowPartId = String(template && template.rowPartId || "");
            record.emitterPartId = String(template && template.emitterPartId || "");
            record.rowTakeoffPartId = String(template && template.rowTakeoffPartId || "");
            record.rowEndCapPartId = String(template && template.rowEndCapPartId || "");
            record.headerEndCapPartId = terminalParts.headerEndCapPartId;
            record.supplyPipePartId = String(template && template.supplyPipePartId || "");
            record.rowOrientation = rowOrientation;
            record.rowLengthMeters = finiteNumber(template && template.rowLengthMeters, rowLengthMetersForBedGeometry(bedGeo, record.rowOrientation));
            record.rowSpacingCm = finiteNumber(template && template.rowSpacingCm, spacing.rowSpacingCm);
            record.totalRowMeters = finiteNumber(template && template.totalRowMeters, record.rowLengthMeters * rowCount);
            record.requiredParts = (template && Array.isArray(template.requiredParts) ? template.requiredParts : []).map(function (entry) {
                return { partId: String(entry && entry.partId || "").trim(), quantityPerRowMeter: finiteNumber(entry && entry.quantityPerRowMeter, 0), quantityMeters: finiteNumber(entry && entry.quantityMeters, 0), unit: "m" };
            }).filter(function (entry) { return !!entry.partId; });
            record.resolvedBomParts = (template && Array.isArray(template.resolvedBomParts) ? template.resolvedBomParts : []).map(function (entry) {
                return { role: String(entry && entry.role || ""), partId: String(entry && entry.partId || "").trim(), quantity: finiteNumber(entry && entry.quantity, 0), unit: String(entry && entry.unit || "each") };
            }).filter(function (entry) { return !!entry.partId && entry.quantity > 0; });
            if (record.recipeVersion > 0) record.partIds = uniqueStrings([record.inletPartId, record.outletPartId, record.rowPartId, record.emitterPartId, record.rowTakeoffPartId, record.rowEndCapPartId, record.headerEndCapPartId, record.supplyPipePartId].concat(record.resolvedBomParts.map(function (entry) { return entry.partId; }))).filter(Boolean);
            record.anchorPartId = String(template && template.anchorPartId || "");
        }
        record.irrigationType = bedEffectiveEmitterInfo(catalog, record, { ignoreStoredCategory: true }).category; // NEW

        model.beginUpdate && model.beginUpdate();
        try {
            if (!bedAssembly) return record;
            if (bedAssembly) {
                setCellAttrs(bedAssembly, { label: assemblyLabelForTemplateRecord(record, catalog), [ATTRS.BED_TEMPLATE_JSON]: JSON.stringify(record) }); // CHANGE
                createBedTemplateLayoutCells(bedAssembly, pathId, record, getGeometry(bedAssembly) || bedGeo);
            }

        } finally {
            model.endUpdate && model.endUpdate();
        }

        return record;
    }

    function assemblyLabelForTemplateRecord(record, catalog) { // CHANGE
        return record && record.assemblyLabelMode === BED_ASSEMBLY_LABEL_HIDDEN ? "" : (bedEffectiveEmitterInfo(catalog, record).assemblyLabel || "Bed Assembly"); // CHANGE
    }

    function createBedTemplateLayoutCells(bedCell, pathId, record, bedGeo) {
        const assemblyParent = isAssembly(bedCell);
        const inset = assemblyParent ? 8 : 6;
        const contentTop = 0;
        const parentHeight = Number(bedGeo.height || 80);
        const width = Math.max(40, Number(bedGeo.width || 160) - inset * 2);
        const height = Math.max(8, parentHeight - inset * 2);
        const rows = Math.max(0, Math.floor(finiteNumber(record.spacing && record.spacing.rows, 0)));
        const rowOrientation = normalizeBedRowOrientation(record.rowOrientation, bedTemplateById(record.templateId));
        const existingRows = getChildCells(bedCell).filter(function (cell) { return getCellAttr(cell, ATTRS.BED_LAYOUT, "") === "1"; });
        const existingSupply = getChildCells(bedCell).filter(function (cell) { return getCellAttr(cell, ATTRS.BED_SUPPLY_LINE, "") === "1"; })[0] || null;
        const rowStyle = bedLayoutStyleForState(partStateForRecord(record));
        let changed = false;
        if (rows === 0) { existingRows.forEach(function (cell) { removeCellFromParent(cell); changed = true; }); if (existingSupply) { removeCellFromParent(existingSupply); changed = true; } return changed; }
        if (record && record.supplyPipePartId) {
            const savedSupplyGeo = getGeometry(existingSupply) || {};
            const supplyGeo = rowOrientation === "height" ? { x: inset, y: finiteNumber(savedSupplyGeo.y, inset), width, height: 6 } : { x: finiteNumber(savedSupplyGeo.x, inset), y: inset, width: 6, height };
            const supplyAttrs = { label: "Supply line", [ATTRS.BED_SUPPLY_LINE]: "1", [ATTRS.PART_STATE]: partStateForRecord(record), [ATTRS.PATH_ID]: pathId, [ATTRS.GENERATED]: "1", [ATTRS.BED_TEMPLATE_JSON]: JSON.stringify(record) };
            if (!existingSupply) { createVertex(bedCell, supplyAttrs.label, supplyGeo.x, supplyGeo.y, supplyGeo.width, supplyGeo.height, BED_SUPPLY_LINE_STYLE, supplyAttrs); changed = true; }
            else { changed = setGeometry(existingSupply, supplyGeo) || changed; changed = setCellStyle(existingSupply, BED_SUPPLY_LINE_STYLE) || changed; changed = setCellAttrs(existingSupply, supplyAttrs) || changed; }
        } else if (existingSupply) { removeCellFromParent(existingSupply); changed = true; }
        const rowGap = Math.max(0, rowSpacingSpanUnitsForBedGeometry(bedGeo, rowOrientation) / rows);
        for (let i = 0; i < rows; i++) {
            const center = rowGap * (i + 0.5);
            const x = rowOrientation === "height" ? center - 3 : inset;
            const y = rowOrientation === "height" ? inset : contentTop + center - 3;
            const w = rowOrientation === "height" ? 6 : width;
            const h = rowOrientation === "height" ? height : 6;
            const attrs = { label: bedTemplateRowDisplayLabel(record.irrigationType), [ATTRS.BED_LAYOUT]: "1", [ATTRS.PART_STATE]: partStateForRecord(record), [ATTRS.PATH_ID]: pathId, [ATTRS.GENERATED]: "1", [ATTRS.BED_TEMPLATE_JSON]: JSON.stringify(record) };
            const row = existingRows[i] || createVertex(bedCell, attrs.label, x, y, w, h, rowStyle, attrs);
            if (!existingRows[i]) { changed = true; continue; }
            changed = setGeometry(row, { x, y, width: w, height: h }) || changed;
            changed = setCellStyle(row, rowStyle) || changed;
            changed = setCellAttrs(row, attrs) || changed;
        }
        existingRows.slice(rows).forEach(function (cell) { removeCellFromParent(cell); changed = true; });
        return changed;
    }

    function reflowBedTemplateLayout(moduleCell, bedAssembly) {
        const bedCell = bedCellForAssembly(moduleCell, bedAssembly);
        const record = readBedAssemblyTemplateRecord(moduleCell, bedAssembly);
        if (!record) return;
        return refreshBedAssemblyRowsFromTemplate(moduleCell, bedAssembly, bedCell, record);
    }

    function rowMetricRecordForGeometry(moduleCell, record, bedGeo) {
        if (!record || record.templateModel !== BED_TEMPLATE_MODEL_BOM) return { record, recomputed: false };
        const catalog = readCatalog(moduleCell);
        const bom = computeBedTemplateBom(catalog, bedGeo || {}, record.templateId, record.spacing && record.spacing.rows, record.rowOrientation, record.recipeVersion > 0 ? record : null);
        if (bom.rowCount > 0 && (bom.missingPartIds.length || !bom.anchorPartId)) return { record, recomputed: false, missingPartIds: bom.missingPartIds };
        const nextRecord = Object.assign({}, record, { // NEW
            rowOrientation: bom.rowOrientation, // NEW
            rowLengthMeters: bom.rowLengthMeters, // NEW
            rowSpacingCm: bom.rowSpacingCm, // NEW
            totalRowMeters: bom.totalRowMeters, // NEW
            requiredParts: bom.requiredParts, // NEW
            resolvedBomParts: bom.recipe ? bom.recipe.resolvedBomParts : record.resolvedBomParts, // NEW
            supplyPipePartId: bom.recipe ? bom.recipe.supplyPipePartId : record.supplyPipePartId, // NEW
            anchorPartId: bom.anchorPartId, // NEW
            demand: bom.demand, // NEW
            spacing: Object.assign({}, record.spacing || {}, { rows: bom.rowCount, rowSpacingCm: bom.rowSpacingCm }) // NEW
        }); // NEW
        const effective = bedEffectiveEmitterInfo(catalog, nextRecord, { ignoreStoredCategory: true }); // NEW
        if (effective.category) nextRecord.irrigationType = effective.category; // NEW
        return {
            record: nextRecord, // CHANGE
            recomputed: true
        };
    }

    function refreshBedAssemblyRowsFromTemplate(moduleCell, bedAssembly, bedCell, record) {
        if (!bedAssembly || !record) return false;
        const geometry = getGeometry(bedAssembly) || getGeometry(bedCell) || { width: 160, height: 80 };
        const refreshed = rowMetricRecordForGeometry(moduleCell, record, geometry);
        const nextRecord = refreshed.record || record;
        const catalog = readCatalog(moduleCell); // NEW
        let changed = false;
        if (refreshed.recomputed && JSON.stringify(nextRecord) !== JSON.stringify(record)) {
            changed = setCellAttrs(bedAssembly, { [ATTRS.BED_TEMPLATE_JSON]: JSON.stringify(nextRecord) }) || changed;
        }
        changed = setCellAttrs(bedAssembly, { label: assemblyLabelForTemplateRecord(nextRecord, catalog) }) || changed; // CHANGE
        changed = createBedTemplateLayoutCells(bedAssembly, nextRecord.pathId || ("assembly_bed_" + sanitizeId(getCellId(bedCell))), nextRecord, geometry) || changed;
        return changed;
    }

    function syncLinkedBedAssemblyToBed(moduleCell, assembly, bedCell, opts) {
        if (!isBedAssembly(assembly)) return false;
        const linkedBed = bedCell || bedCellForAssembly(moduleCell, assembly);
        if (!linkedBed) return false;
        moduleCell = moduleCell || findGardenModuleAncestor(assembly) || findGardenModuleAncestor(linkedBed);
        const previousLinkedBed = bedCellForAssembly(moduleCell, assembly);
        const previousBedId = getCellId(previousLinkedBed) || "";
        const linkedBedId = getCellId(linkedBed) || "";
        const changingLinkedBed = !!(previousBedId && linkedBedId && previousBedId !== linkedBedId);
        const movingPorts = changingLinkedBed && previousLinkedBed ? readBedPortConfig(previousLinkedBed) : null;
        const fitWidth = !opts || opts.fitWidth !== false;
        const fitHeight = !opts || opts.fitHeight !== false;
        const current = getGeometry(assembly) || {};
        const bedGeo = bedSyncedAssemblyGeometry(linkedBed);
        const next = Object.assign({}, current);
        if (fitWidth) { next.x = bedGeo.x; next.width = bedGeo.width; }
        if (fitHeight) { next.y = bedGeo.y; next.height = bedGeo.height; }
        const ownsTransaction = !(opts && opts.inTransaction);
        let changed = false;
        if (ownsTransaction && model.beginUpdate) model.beginUpdate();
        try {
            if (movingPorts) writeBedPortConfig(linkedBed, movingPorts);
            if (fitWidth || fitHeight) changed = !!setGeometry(assembly, next);
            changed = syncBedAssemblyLabelStyle(assembly) || changed; // CHANGE
            changed = setCellAttrs(assembly, { [ATTRS.LINKED_BED_ID]: getCellId(linkedBed) || "", bed_fit_width: fitWidth ? "1" : "0", bed_fit_height: fitHeight ? "1" : "0" }) || changed;
            changed = syncBedAssemblyRotation(assembly, linkedBed) || changed;
            reflowBedTemplateLayout(moduleCell || findGardenModuleAncestor(assembly), assembly);
            if (changingLinkedBed) changed = clearBedTemplateDataIfUnused(moduleCell, previousLinkedBed, assembly) || changed;
        } finally { if (ownsTransaction && model.endUpdate) model.endUpdate(); }
        if (graph.refresh) graph.refresh(assembly);
        return changed;
    }

    function bedAssemblyFitAxes(assembly) {
        return {
            fitWidth: getCellAttr(assembly, "bed_fit_width", "1") !== "0",
            fitHeight: getCellAttr(assembly, "bed_fit_height", "1") !== "0"
        };
    }

    function linkedBedAssembliesForBed(moduleCell, bedCell) {
        const bedId = getCellId(bedCell) || "";
        if (!moduleCell || !bedId) return [];
        return collectDescendants(moduleCell, function (cell) { return isBedAssembly(cell) && getCellAttr(cell, ATTRS.LINKED_BED_ID, "") === bedId; });
    }

    function normalizeBedIrrigationMethodId(record) {
        return String(record && record.irrigationType || "").trim(); // CHANGE
    }

    function getBedIrrigationMethods(moduleCell, bedCell) {
        const root = moduleCell || findGardenModuleAncestor(bedCell);
        const seen = new Set();
        const methods = [];
        linkedBedAssembliesForBed(root, bedCell).forEach(function (assembly) {
            const record = readBedAssemblyTemplateRecord(root, assembly);
            const id = normalizeBedIrrigationMethodId(record);
            const label = bedIrrigationMethodLabel(id);
            if (!id || !label || seen.has(id)) return;
            seen.add(id);
            methods.push({ id, label });
        });
        return methods;
    }

    function readBedTemplateRecord(bedAssembly) {
        return safeJsonParse(getCellAttr(bedAssembly, ATTRS.BED_TEMPLATE_JSON, ""), null);
    }

    function readBedAssemblyTemplateRecord(moduleCell, assembly) {
        return readBedTemplateRecord(assembly) || safeJsonParse(getCellAttr(bedLayoutRowsForAssembly(assembly)[0], ATTRS.BED_TEMPLATE_JSON, ""), null);
    }

    function bedLayoutRowsForAssembly(assembly) {
        return getChildCells(assembly).filter(function (cell) { return getCellAttr(cell, ATTRS.BED_LAYOUT, "") === "1"; });
    }

    function clearBedTemplateDataIfUnused(moduleCell, bedCell, movedAssembly) {
        if (!bedCell || !moduleCell) return false;
        const bedId = getCellId(bedCell) || "";
        const stillUsed = collectDescendants(moduleCell, function (cell) {
            return cell !== movedAssembly && isBedAssembly(cell) && getCellAttr(cell, ATTRS.LINKED_BED_ID, "") === bedId;
        }).length > 0;
        if (stillUsed) return false;
        return setCellAttrs(bedCell, { [ATTRS.BED_PORTS_JSON]: "" });
    }

    function relinkBedAssemblyToBed(moduleCell, assembly, targetBed, opts) {
        if (!moduleCell || !isBedAssembly(assembly) || !isGardenBed(targetBed)) return false;
        const previousBed = bedCellForAssembly(moduleCell, assembly);
        const previousBedId = getCellId(previousBed) || "";
        const targetBedId = getCellId(targetBed) || "";
        const sameBed = previousBedId && previousBedId === targetBedId;
        const templateRecord = readBedAssemblyTemplateRecord(moduleCell, assembly);
        const portSource = previousBed || targetBed;
        const portConfig = portSource ? readBedPortConfig(portSource) : null;
        const axes = opts && opts.axes ? opts.axes : bedAssemblyFitAxes(assembly);
        let changed = false;
        if (!sameBed && portConfig) writeBedPortConfig(targetBed, portConfig);
        changed = syncLinkedBedAssemblyToBed(moduleCell, assembly, targetBed, { inTransaction: true, fitWidth: !!axes.fitWidth, fitHeight: !!axes.fitHeight }) || changed;
        if (templateRecord) changed = refreshBedAssemblyRowsFromTemplate(moduleCell, assembly, targetBed, templateRecord) || changed;
        if (!sameBed && previousBed) changed = clearBedTemplateDataIfUnused(moduleCell, previousBed, assembly) || changed;
        return changed;
    }

    function rectCenter(bounds) {
        return bounds ? { x: finiteNumber(bounds.x, 0) + finiteNumber(bounds.width, 0) / 2, y: finiteNumber(bounds.y, 0) + finiteNumber(bounds.height, 0) / 2 } : null;
    }

    function rotateModelPoint(point, center, angleDeg) {
        const rad = finiteNumber(angleDeg, 0) * Math.PI / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const dx = finiteNumber(point && point.x, 0) - finiteNumber(center && center.x, 0);
        const dy = finiteNumber(point && point.y, 0) - finiteNumber(center && center.y, 0);
        return { x: finiteNumber(center && center.x, 0) + dx * cos - dy * sin, y: finiteNumber(center && center.y, 0) + dx * sin + dy * cos };
    }

    function cellRotationDeg(cell) {
        const styleRotation = styleValue(cell && cell.style, "rotation");
        return finiteNumber(styleRotation, 0);
    }

    function pointInsideBedBounds(point, bed) {
        const bounds = cellBoundsInModel(bed);
        if (!point || !bounds) return false;
        const center = rectCenter(bounds);
        const local = rotateModelPoint(point, center, -cellRotationDeg(bed));
        return local.x >= bounds.x - 1 && local.x <= bounds.x + bounds.width + 1 && local.y >= bounds.y - 1 && local.y <= bounds.y + bounds.height + 1;
    }

    function containingGardenBedForAssembly(moduleCell, assembly) {
        const center = rectCenter(cellBoundsInModel(assembly));
        if (!moduleCell || !center) return null;
        let chosen = null;
        let chosenArea = Infinity;
        collectGardenBeds(moduleCell).forEach(function (bed) {
            const bounds = cellBoundsInModel(bed);
            const area = bounds ? finiteNumber(bounds.width, 0) * finiteNumber(bounds.height, 0) : 0;
            if (area > 0 && area < chosenArea && pointInsideBedBounds(center, bed)) { chosen = bed; chosenArea = area; }
        });
        return chosen;
    }

    function syncBedAssembliesForMovedOrResizedBeds(cells) {
        const beds = (cells || []).filter(isGardenBed);
        if (!beds.length) return false;
        let changed = false;
        beds.forEach(function (bed) {
            const moduleCell = findGardenModuleAncestor(bed);
            linkedBedAssembliesForBed(moduleCell, bed).forEach(function (assembly) {
                const axes = bedAssemblyFitAxes(assembly);
                changed = syncLinkedBedAssemblyToBed(moduleCell, assembly, bed, { inTransaction: true, fitWidth: axes.fitWidth, fitHeight: axes.fitHeight }) || changed;
            });
        });
        return changed;
    }

    function syncMovedOrResizedBedAssemblies(cells, opts) {
        const assemblies = (cells || []).filter(isBedAssembly);
        if (!assemblies.length) return false;
        let changed = false;
        assemblies.forEach(function (assembly) {
            const moduleCell = findGardenModuleAncestor(assembly) || gardenModuleForBedAssembly(assembly);
            const targetBed = containingGardenBedForAssembly(moduleCell, assembly);
            if (!targetBed) return;
            const currentBed = bedCellForAssembly(moduleCell, assembly);
            const sameBed = currentBed && getCellId(currentBed) === getCellId(targetBed);
            if (sameBed && opts && opts.source === "cells-moved") return;
            const axes = sameBed ? bedAssemblyFitAxes(assembly) : { fitWidth: true, fitHeight: true };
            changed = relinkBedAssemblyToBed(moduleCell, assembly, targetBed, { axes }) || changed;
        });
        return changed;
    }

    function installBedAssemblyGeometryRefreshListeners() {
        if (graph.__trellisBedAssemblyGeometryRefreshInstalled || !graph.addListener || typeof mxEvent === "undefined") return;
        graph.__trellisBedAssemblyGeometryRefreshInstalled = true;
        function handleCells(sender, evt, source) {
            const cells = evt && evt.getProperty && evt.getProperty("cells") || [];
            if (!cells.length) return;
            if (!cells.some(function (cell) { return isGardenBed(cell) || isBedAssembly(cell); })) return;
            runIrrigationEdit("refreshBedLayout", function () {
                const changedBeds = syncBedAssembliesForMovedOrResizedBeds(cells);
                const changedAssemblies = syncMovedOrResizedBedAssemblies(cells, { source });
                if ((changedBeds || changedAssemblies) && activeIrrigationMode) renderIrrigationMode(activeIrrigationMode);
            });
        }
        if (mxEvent.CELLS_MOVED) graph.addListener(mxEvent.CELLS_MOVED, function (sender, evt) { handleCells(sender, evt, "cells-moved"); });
        if (mxEvent.CELLS_RESIZED) graph.addListener(mxEvent.CELLS_RESIZED, function (sender, evt) { handleCells(sender, evt, "cells-resized"); });
    }

    installBedAssemblyGeometryRefreshListeners();

    function syncBedAssemblyRotation(assembly, bedCell) {
        const rotation = styleValue(bedCell && bedCell.style, "rotation");
        return setCellStyle(assembly, setStyleValue(assembly && assembly.style, "rotation", rotation));
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
        return 4.52 * lengthFt * Math.pow(flowGpm, 1.852) / (Math.pow(c, 1.852) * Math.pow(diameterIn, 4.871)); // CHANGE
    }

    function maxOperatingPressureForDemand(catalog, partIds, bedDemand) {
        const explicit = finiteNumber(bedDemand && bedDemand.maxOperatingPressurePsi, null);
        if (explicit != null) return explicit;
        return (partIds || []).reduce(function (current, partId) {
            const part = partById(catalog, partId);
            const maxPsi = finiteNumber(part && part.specs && part.specs.maxOperatingPressurePsi, null);
            if (maxPsi == null) return current;
            return current == null ? maxPsi : Math.min(current, maxPsi);
        }, null);
    }

    function estimatePathHydraulics(args) {
        const catalog = args && args.catalog ? args.catalog : { items: [] };
        const source = normalizeEndpointProfile(args && args.sourceProfile);
        const bedDemand = args && args.bedDemand || {};
        const partIds = args && args.partIds || [];
        const pipePart = partById(catalog, args && args.pipePartId);
        const pipeSegments = normalizeHydraulicPipeSegments(args && args.pipeSegments, catalog);
        const flowGpm = finiteNumber(bedDemand.flowGpm, source.usableFlowGpm || 0);
        const operatingPressurePsi = finiteNumber(bedDemand.operatingPressurePsi, 0);
        const lengthFt = finiteNumber(args && args.lengthFt, 0);
        let pressureLossPsi = 0;
        const warnings = [];

        if (pipeSegments.length) {
            pipeSegments.forEach(function (segment) {
                const pressureLengthFt = segment.hydraulicLengthFt == null ? segment.lengthFt : segment.hydraulicLengthFt; // CHANGE
                if (!segment.part || segment.part.category !== "pipe_tubing") { warnings.push("Pipe part specs missing; pipe pressure loss was not estimated."); return; }
                if (!(pressureLengthFt > 0)) { warnings.push("Pipe edge length is missing; pressure loss was not estimated."); return; } // CHANGE
                pressureLossPsi += Hydraulics.hazenWilliamsPsiLoss({
                    lengthFt: pressureLengthFt, // CHANGE
                    flowGpm,
                    diameterIn: segment.part.specs.innerDiameterIn,
                    c: finiteNumber(segment.part.specs.hazenWilliamsC, 150)
                });
            });
        } else if (pipePart && pipePart.category === "pipe_tubing") {
            pressureLossPsi += Hydraulics.hazenWilliamsPsiLoss({
                lengthFt,
                flowGpm,
                diameterIn: pipePart.specs.innerDiameterIn,
                c: finiteNumber(pipePart.specs.hazenWilliamsC, 150)
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
        const maxOperatingPressurePsi = maxOperatingPressureForDemand(catalog, partIds, bedDemand);
        const deliveredPressurePsi = availablePressurePsi - pressureLossPsi;
        if (source.usableFlowGpm != null && flowGpm > source.usableFlowGpm) warnings.push("Flow demand exceeds source usable flow.");
        if (marginPsi < 0) warnings.push("Required pressure exceeds available source pressure.");
        if (maxOperatingPressurePsi != null && deliveredPressurePsi > maxOperatingPressurePsi) warnings.push("Estimated delivered pressure exceeds maximum operating pressure.");

        return {
            flowGpm,
            availablePressurePsi,
            operatingPressurePsi,
            maxOperatingPressurePsi,
            deliveredPressurePsi,
            pressureLossPsi,
            requiredPressurePsi,
            marginPsi,
            ok: warnings.length === 0,
            warnings
        };
    }

    function normalizeHydraulicPipeSegments(segments, catalog) {
        return (segments || []).map(function (segment) {
            const pipePartId = String(segment && segment.pipePartId || "").trim();
            return {
                edgeId: String(segment && segment.edgeId || "").trim(),
                pipePartId,
                lengthFt: finiteNumber(segment && segment.lengthFt, null),
                hydraulicLengthFt: finiteNumber(segment && segment.hydraulicLengthFt, null), // CHANGE
                part: partById(catalog, pipePartId)
            };
        }).filter(function (segment) { return !!segment.pipePartId; });
    }

    function edgeLengthFeet(edge) {
        const measured = measuredEdgeLengthFeet(edge);
        return measured == null ? 0 : measured;
    }

    function measuredEdgeLengthFeet(edge) {
        const absolutePoints = edgeModelPoints(edge); // CHANGE
        if (absolutePoints.length > 1) return pointPathLengthFeet(absolutePoints); // CHANGE
        const geo = getGeometry(edge);
        if (geo && Array.isArray(geo.points) && geo.points.length > 1) return pointPathLengthFeet(geo.points); // CHANGE
        return edgeEndpointDistanceFeet(edge); // CHANGE
    }

    function measuredPipeRouteLengthFeet(edge) { // CHANGE
        const absolutePoints = edgeModelPoints(edge); // CHANGE
        if (absolutePoints.length > 1) return pointPathLengthFeet(absolutePoints); // CHANGE
        const geo = getGeometry(edge); // CHANGE
        if (geo && Array.isArray(geo.points) && geo.points.length > 1) return pointPathLengthFeet(geo.points); // CHANGE
        return null; // CHANGE
    } // CHANGE

    function edgeModelPoints(edge) { // CHANGE
        const state = graph.view && graph.view.getState ? graph.view.getState(edge) : null; // CHANGE
        const raw = state && Array.isArray(state.absolutePoints) ? state.absolutePoints : []; // CHANGE
        if (!raw.length) return []; // CHANGE
        const scale = finiteNumber(graph.view && graph.view.scale, 1) || 1; // CHANGE
        const translate = graph.view && graph.view.translate ? graph.view.translate : { x: 0, y: 0 }; // CHANGE
        return raw.map(function (point) { // CHANGE
            if (!point) return null; // CHANGE
            return { x: finiteNumber(point.x, 0) / scale - finiteNumber(translate.x, 0), y: finiteNumber(point.y, 0) / scale - finiteNumber(translate.y, 0) }; // CHANGE
        }).filter(Boolean); // CHANGE
    } // CHANGE

    function pointPathLengthFeet(points) { // CHANGE
        let total = 0; // CHANGE
        for (let i = 1; i < points.length; i++) { // CHANGE
            const a = points[i - 1], b = points[i]; // CHANGE
            total += Math.sqrt(Math.pow(Number(b.x) - Number(a.x), 2) + Math.pow(Number(b.y) - Number(a.y), 2)); // CHANGE
        } // CHANGE
        return unitsToCm(total) / CM_PER_FOOT; // CHANGE
    } // CHANGE

    function edgeEndpointDistanceFeet(edge) { // CHANGE
        const source = edge && edge.source; // CHANGE
        const target = edge && edge.target; // CHANGE
        const a = source ? cellBoundsInModel(source) : null; // CHANGE
        const b = target ? cellBoundsInModel(target) : null; // CHANGE
        if (!a || !b) return null; // CHANGE
        const ax = finiteNumber(a.x, 0) + finiteNumber(a.width, 0) / 2; // CHANGE
        const ay = finiteNumber(a.y, 0) + finiteNumber(a.height, 0) / 2; // CHANGE
        const bx = finiteNumber(b.x, 0) + finiteNumber(b.width, 0) / 2; // CHANGE
        const by = finiteNumber(b.y, 0) + finiteNumber(b.height, 0) / 2; // CHANGE
        return unitsToCm(Math.sqrt(Math.pow(bx - ax, 2) + Math.pow(by - ay, 2))) / CM_PER_FOOT; // CHANGE
    }

    function pipeSegmentsForPath(moduleCell, path) {
        if (path && Array.isArray(path.pipeSegments) && path.pipeSegments.length) return path.pipeSegments.slice();
        return (path && path.pipePartIds || []).map(function (pipePartId, index) {
            const edge = findCellById(moduleCell, (path.pipeEdgeIds || [])[index]);
            return { edgeId: getCellId(edge) || (path.pipeEdgeIds || [])[index] || "", pipePartId, lengthFt: measuredEdgeLengthFeet(edge) };
        }).filter(function (segment) { return !!segment.pipePartId; });
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
        if (unitCostAppliesToCategory(part.category)) {
            const lengthFt = pipeSegmentLengthForPart(moduleCell, path, partId);
            return lengthFt > 0 ? finiteNumber(part.unitCost, part.cost || 0) * lengthFt : finiteNumber(part.cost || part.unitCost, 0);
        }
        return finiteNumber(part.cost || part.unitCost, 0);
    }

    function partCostForRequiredMeters(catalog, partId, quantityMeters) {
        const part = partById(catalog, partId);
        if (!part) return 0;
        if (unitCostAppliesToCategory(part.category)) return finiteNumber(part.unitCost, part.cost || 0) * (finiteNumber(quantityMeters, 0) / METERS_PER_FOOT);
        return finiteNumber(part.cost || part.unitCost, 0) * finiteNumber(quantityMeters, 0);
    }

    function pipeSegmentLengthForPart(moduleCell, path, partId) {
        const segments = Hydraulics.pipeSegmentsForPath(moduleCell, path).filter(function (segment) { return segment.pipePartId === partId; });
        if (segments.length) return segments.reduce(function (sum, segment) { return sum + finiteNumber(segment.lengthFt, 0); }, 0);
        return Hydraulics.pathRouteLengthFeet(moduleCell, path);
    }

    function isLinearCatalogPart(part) {
        const p = normalizeCatalogPart(part);
        return !!(p && unitCostAppliesToCategory(p.category));
    }

    function bomDisplayLengthUnit(moduleCell) {
        return resolveModuleUnitSystem(moduleCell) === "imperial" ? "ft" : "m";
    }

    function bomCanonicalQuantityToDisplay(quantity, part, moduleCell) {
        const q = Math.max(0, finiteNumber(quantity, 0));
        return isLinearCatalogPart(part) && bomDisplayLengthUnit(moduleCell) === "m" ? q * METERS_PER_FOOT : q;
    }

    function bomInputQuantityToCanonical(value, part, moduleCell) {
        const q = Math.max(0, finiteNumber(value, 0));
        return isLinearCatalogPart(part) && bomDisplayLengthUnit(moduleCell) === "m" ? q / METERS_PER_FOOT : q;
    }

    function bomCanonicalUnitLabel(part, moduleCell) {
        return isLinearCatalogPart(part) ? bomDisplayLengthUnit(moduleCell) : "ea";
    }

    function bomDisplayUnitLabel(part, moduleCell) {
        return isLinearCatalogPart(part) ? bomCanonicalUnitLabel(part, moduleCell) : ""; // NEW
    }

    function bomDisplayUnitCost(part, moduleCell) {
        const p = normalizeCatalogPart(part);
        if (!p) return 0;
        const base = isLinearCatalogPart(p) ? finiteNumber(p.unitCost, p.cost || 0) : finiteNumber(p.cost || p.unitCost, 0);
        return isLinearCatalogPart(p) && bomDisplayLengthUnit(moduleCell) === "m" ? base / METERS_PER_FOOT : base;
    }

    function bomInputUnitCostToCanonical(value, part, moduleCell) {
        const cost = Math.max(0, finiteNumber(value, 0));
        return isLinearCatalogPart(part) && bomDisplayLengthUnit(moduleCell) === "m" ? cost * METERS_PER_FOOT : cost;
    }

    function formatBomNumber(value, decimals) {
        const n = finiteNumber(value, 0);
        const places = decimals == null ? (Math.abs(n) >= 10 || Math.abs(n - Math.round(n)) < 0.005 ? 1 : 2) : decimals;
        return n.toFixed(places).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
    }

    function bomDisplayQuantityValue(quantity, part, moduleCell) {
        return formatBomNumber(bomCanonicalQuantityToDisplay(quantity, part, moduleCell));
    }

    function formatBomCanonicalQuantity(quantity, part, moduleCell) {
        const unit = bomDisplayUnitLabel(part, moduleCell); // CHANGE
        return bomDisplayQuantityValue(quantity, part, moduleCell) + (unit ? " " + unit : ""); // CHANGE
    }

    function bomLineUnitCost(part, moduleCell) {
        const unit = bomDisplayUnitLabel(part, moduleCell); // CHANGE
        return formatMoney(bomDisplayUnitCost(part, moduleCell)) + (unit ? "/" + unit : ""); // CHANGE
    }

    function createBomAccumulator(catalog) {
        return { catalog, rowsByPartId: new Map() };
    }

    function addBomRequirement(acc, partId, quantity) {
        const part = partById(acc.catalog, partId);
        if (!part) return;
        const id = part.id;
        const row = acc.rowsByPartId.get(id) || { part, partId: id, requiredQuantity: 0, useCount: 0 };
        row.requiredQuantity += Math.max(0, finiteNumber(quantity, 0));
        row.useCount += 1;
        acc.rowsByPartId.set(id, row);
    }

    function addBomPartEach(acc, partId) {
        addBomRequirement(acc, partId, 1);
    }

    function addBomLinearFeet(acc, partId, lengthFt) {
        addBomRequirement(acc, partId, Math.max(0, finiteNumber(lengthFt, 0)));
    }

    function addBomTemplateRequirement(acc, partId, quantityMeters) {
        const part = partById(acc.catalog, partId);
        if (!part) return;
        const qty = isLinearCatalogPart(part) ? finiteNumber(quantityMeters, 0) / METERS_PER_FOOT : finiteNumber(quantityMeters, 0);
        addBomRequirement(acc, partId, qty);
    }

    function addBomResolvedRequirement(acc, entry) {
        const part = partById(acc.catalog, entry && entry.partId);
        if (!part) return;
        const unit = String(entry && entry.unit || "each");
        const quantity = finiteNumber(entry && entry.quantity, 0);
        const canonical = isLinearCatalogPart(part) && unit === "m" ? quantity / METERS_PER_FOOT : quantity;
        addBomRequirement(acc, entry.partId, canonical);
    }

    function pathPartStateAt(path, index) {
        return normalizePartState(path && path.partStates && path.partStates[index]);
    }

    function pathPipeStateAt(path, index) {
        return normalizePartState(path && path.pipePartStates && path.pipePartStates[index]);
    }

    function pathBedTemplateState(path) {
        return partStateForRecord(path && path.bedTemplate);
    }

    function collectPathBomUsage(moduleCell, catalog, path, acc, stateFilter) {
        const targetState = normalizePartState(stateFilter);
        (path.partIds || []).forEach(function (partId, index) { if (pathPartStateAt(path, index) === targetState) addBomPartEach(acc, partId); });
        if (path.pipeSegments && path.pipeSegments.length) {
            (path.pipeSegments || []).forEach(function (segment, index) { if (normalizePartState(segment.partState || pathPipeStateAt(path, index)) === targetState) addBomLinearFeet(acc, segment.pipePartId, segment.lengthFt); });
        } else if (path.pipePartIds && path.pipePartIds.length) {
            (path.pipePartIds || []).forEach(function (pipePartId, index) { if (pathPipeStateAt(path, index) === targetState) addBomLinearFeet(acc, pipePartId, Hydraulics.pipeSegmentLengthForPart(moduleCell, path, pipePartId)); });
        } else if (path.pipePartId) {
            if (pathPipeStateAt(path, 0) === targetState) addBomLinearFeet(acc, path.pipePartId, Hydraulics.pipeSegmentLengthForPart(moduleCell, path, path.pipePartId));
        }
        if (path.bedTemplate && Array.isArray(path.bedTemplate.resolvedBomParts) && path.bedTemplate.resolvedBomParts.length) {
            if (pathBedTemplateState(path) === targetState) path.bedTemplate.resolvedBomParts.forEach(function (entry) { addBomResolvedRequirement(acc, entry); });
        } else if (path.bedTemplate && path.bedTemplate.templateModel === BED_TEMPLATE_MODEL_BOM && Array.isArray(path.bedTemplate.requiredParts)) {
            if (pathBedTemplateState(path) === targetState) path.bedTemplate.requiredParts.forEach(function (entry) { addBomTemplateRequirement(acc, entry.partId, entry.quantityMeters); });
        }
        if (path.bedTemplate && !(Array.isArray(path.bedTemplate.resolvedBomParts) && path.bedTemplate.resolvedBomParts.length) && Array.isArray(path.bedTemplate.partIds)) {
            if (pathBedTemplateState(path) === targetState) path.bedTemplate.partIds.forEach(function (partId) { addBomPartEach(acc, partId); });
        }
    }

    function isBomComponentNode(cell) {
        return isAssemblyPartCell(cell) || isBedAssembly(cell);
    }

    function uniqueCellList(cells) {
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

    function bomComponentNeighborCells(moduleCell, cell) {
        const neighbors = [];
        externalEdgesForCell(moduleCell, cell).forEach(function (edge) {
            const other = edge && edge.source === cell ? edge.target : edge && edge.target === cell ? edge.source : null;
            if (isBomComponentNode(other)) neighbors.push(other);
        });
        if (isAssemblyPartCell(cell)) {
            const upstream = internalNeighborForPort(cell, "input");
            const downstream = internalNeighborForPort(cell, "output");
            if (isBomComponentNode(upstream)) neighbors.push(upstream);
            if (isBomComponentNode(downstream)) neighbors.push(downstream);
        }
        return uniqueCellList(neighbors);
    }

    function bomComponentEdges(moduleCell, cells) {
        const cellIds = new Set((cells || []).map(getCellId).filter(Boolean));
        const seen = new Set();
        const edges = [];
        collectAssemblyEdges(moduleCell).forEach(function (edge) {
            const id = getCellId(edge);
            const sourceId = getCellId(edge && edge.source);
            const targetId = getCellId(edge && edge.target);
            if (!id || seen.has(id) || !cellIds.has(sourceId) || !cellIds.has(targetId)) return;
            seen.add(id);
            edges.push(edge);
        });
        return edges;
    }

    function componentIdForCells(cells) {
        const ids = (cells || []).map(getCellId).filter(Boolean).sort();
        return "bom_component_" + sanitizeId(ids[0] || "empty") + "_" + ids.length;
    }

    function deriveBomComponents(moduleCell) {
        const nodes = collectDescendants(moduleCell, isBomComponentNode);
        const seen = new Set();
        const components = [];
        nodes.forEach(function (seed) {
            const seedId = getCellId(seed);
            if (!seedId || seen.has(seedId)) return;
            const stack = [seed];
            const cells = [];
            while (stack.length) {
                const cell = stack.pop();
                const id = getCellId(cell);
                if (!id || seen.has(id)) continue;
                seen.add(id);
                cells.push(cell);
                bomComponentNeighborCells(moduleCell, cell).forEach(function (neighbor) {
                    const neighborId = getCellId(neighbor);
                    if (neighborId && !seen.has(neighborId)) stack.push(neighbor);
                });
            }
            const edges = bomComponentEdges(moduleCell, cells);
            const sources = cells.filter(function (cell) { return endpointType(cell) === "source"; });
            const bedAssemblies = cells.filter(isBedAssembly);
            const pipeEdges = edges.filter(function (edge) { return getCellAttr(edge, ATTRS.PIPE_EDGE, "") === "1"; });
            const directEdges = edges.filter(function (edge) { return getCellAttr(edge, ATTRS.DIRECT_LINK_EDGE, "") === "1"; });
            const disconnectedFromSource = sources.length === 0;
            components.push({
                id: componentIdForCells(cells),
                cells,
                cellIds: cells.map(getCellId).filter(Boolean),
                sourceEndpointIds: sources.map(getCellId).filter(Boolean),
                bedAssemblyIds: bedAssemblies.map(getCellId).filter(Boolean),
                edgeIds: edges.map(getCellId).filter(Boolean),
                pipeEdgeIds: pipeEdges.map(getCellId).filter(Boolean),
                directEdgeIds: directEdges.map(getCellId).filter(Boolean),
                pipeSegments: pipeEdges.map(function (edge) { return { edgeId: getCellId(edge) || "", pipePartId: getCellAttr(edge, ATTRS.PIPE_PART_ID, ""), partState: partStateForCell(edge), lengthFt: measuredEdgeLengthFeet(edge) }; }).filter(function (segment) { return !!segment.pipePartId; }),
                disconnectedFromSource,
                warnings: disconnectedFromSource ? [DISCONNECTED_SOURCE_WARNING] : []
            });
        });
        return components;
    }

    function collectComponentBomUsage(moduleCell, catalog, component, acc, stateFilter) {
        const targetState = normalizePartState(stateFilter);
        (component && component.cells || []).forEach(function (cell) {
            const partId = getCellAttr(cell, ATTRS.CATALOG_PART_ID, "");
            if (partId && partStateForCell(cell) === targetState) addBomPartEach(acc, partId);
            if (!isBedAssembly(cell)) return;
            const template = readBedAssemblyTemplateRecord(moduleCell, cell);
            if (!template || pathBedTemplateState({ bedTemplate: template }) !== targetState) return;
            if (Array.isArray(template.resolvedBomParts) && template.resolvedBomParts.length) template.resolvedBomParts.forEach(function (entry) { addBomResolvedRequirement(acc, entry); });
            else { if (template.templateModel === BED_TEMPLATE_MODEL_BOM && Array.isArray(template.requiredParts)) template.requiredParts.forEach(function (entry) { addBomTemplateRequirement(acc, entry.partId, entry.quantityMeters); }); if (Array.isArray(template.partIds)) template.partIds.forEach(function (templatePartId) { addBomPartEach(acc, templatePartId); }); }
        });
        (component && component.pipeSegments || []).forEach(function (segment) {
            if (normalizePartState(segment.partState) === targetState) addBomLinearFeet(acc, segment.pipePartId, segment.lengthFt);
        });
    }

    function finalizeBomRows(moduleCell, catalog, rows) {
        return rows.map(function (row) {
            const part = normalizeCatalogPart(row.part);
            const unitCost = isLinearCatalogPart(part) ? finiteNumber(part.unitCost, part.cost || 0) : finiteNumber(part.cost || part.unitCost, 0);
            const requiredQuantity = Math.max(0, finiteNumber(row.requiredQuantity, 0));
            const onHandQuantity = Math.max(0, finiteNumber(part.stockQuantity, 0));
            const shortageQuantity = Math.max(0, requiredQuantity - onHandQuantity);
            return Object.assign({}, row, {
                part,
                requiredQuantity,
                onHandQuantity,
                shortageQuantity,
                unitCost,
                totalCost: requiredQuantity * unitCost,
                purchaseCost: shortageQuantity * unitCost,
                stockState: stockStateForQuantity(onHandQuantity),
                displayUnit: bomCanonicalUnitLabel(part, moduleCell)
            });
        }).filter(function (row) { return row.requiredQuantity > 0; }).sort(compareBomRows);
    }

    function compareBomRows(a, b) {
        const ka = catalogPartSortKey(a.part);
        const kb = catalogPartSortKey(b.part);
        return compareCatalogPartSortKeys(ka, kb); // CHANGE
    }

    function buildBomRows(moduleCell, options) {
        const catalog = options && options.catalog ? options.catalog : IrrigationCatalog.read(moduleCell);
        const components = options && options.components ? options.components : (options && options.paths ? [] : deriveBomComponents(moduleCell));
        const paths = components.length ? [] : (options && options.paths ? options.paths : ReportModel.deriveAssemblyPaths(moduleCell));
        const acc = createBomAccumulator(catalog);
        const completedAcc = createBomAccumulator(catalog);
        if (components.length) components.forEach(function (component) { collectComponentBomUsage(moduleCell, catalog, component, acc, PART_STATE_PLANNED); collectComponentBomUsage(moduleCell, catalog, component, completedAcc, PART_STATE_COMPLETED); });
        else paths.forEach(function (path) { collectPathBomUsage(moduleCell, catalog, path, acc, PART_STATE_PLANNED); collectPathBomUsage(moduleCell, catalog, path, completedAcc, PART_STATE_COMPLETED); });
        let rows = finalizeBomRows(moduleCell, catalog, Array.from(acc.rowsByPartId.values()));
        let completedRows = finalizeBomRows(moduleCell, catalog, Array.from(completedAcc.rowsByPartId.values()));
        const selectedPartIds = uniqueStrings(options && options.selectedPartIds || []);
        if (selectedPartIds.length) {
            const selected = new Set(selectedPartIds);
            rows = rows.filter(function (row) { return selected.has(row.partId); });
            completedRows = completedRows.filter(function (row) { return selected.has(row.partId); });
        }
        const disconnectedComponents = components.filter(function (component) { return component.disconnectedFromSource; });
        return { version: PLUGIN_VERSION, rows, completedRows, catalog, paths, components, selectedPartIds, disconnectedTreeCount: disconnectedComponents.length, disconnectedTreeWarnings: disconnectedComponents.map(function (component) { return { componentId: component.id, warning: DISCONNECTED_SOURCE_WARNING }; }) };
    }

    function collectGardenBeds(moduleCell) {
        return collectDescendants(moduleCell, isGardenBed);
    }

    function bedAreaM2(bed) {
        const geo = getGeometry(bed);
        if (!geo) return 0;
        return unitsToAreaM2(Number(geo.width) || 0, Number(geo.height) || 0);
    }

    function createReportUsage() {
        return { partIds: [], partCosts: [], controlledZones: new Set() };
    }

    function addReportPartUsage(usage, partId, cost, quantityMeters) {
        if (!partId) return;
        usage.partIds.push(partId);
        const entry = { partId, cost: finiteNumber(cost, 0) };
        if (quantityMeters != null) entry.quantityMeters = finiteNumber(quantityMeters, 0);
        usage.partCosts.push(entry);
    }

    function resolvedBomPartCost(catalog, entry) {
        const part = partById(catalog, entry && entry.partId);
        if (!part) return 0;
        const quantity = finiteNumber(entry && entry.quantity, 0);
        if (isLinearCatalogPart(part) && String(entry && entry.unit || "") === "m") return finiteNumber(part.unitCost, part.cost || 0) * (quantity / METERS_PER_FOOT);
        return finiteNumber(part.cost || part.unitCost, 0) * quantity;
    }

    function collectPathReportUsage(moduleCell, catalog, path, usage) {
        (path.partIds || []).forEach(function (partId, index) {
            addReportPartUsage(usage, partId, Hydraulics.partCostForReport(moduleCell, catalog, path, partId));
            const part = partById(catalog, partId);
            if (part && BRANCH_CATEGORIES.has(part.category)) usage.controlledZones.add((path.componentCellIds && path.componentCellIds[index]) || part.id);
        });
        (path.branchpointIds || []).forEach(function (branchId) {
            const branch = GraphStore.findById(moduleCell, branchId);
            const part = partById(catalog, GraphStore.getAttr(branch, ATTRS.CATALOG_PART_ID, ""));
            if (part && BRANCH_CATEGORIES.has(part.category)) usage.controlledZones.add(branchId);
        });
        if (path.pipeSegments && path.pipeSegments.length) {
            (path.pipeSegments || []).forEach(function (segment) {
                const pipePart = partById(catalog, segment.pipePartId);
                addReportPartUsage(usage, segment.pipePartId, finiteNumber(pipePart && pipePart.unitCost, pipePart && pipePart.cost || 0) * finiteNumber(segment.lengthFt, 0));
            });
        } else if (path.pipePartIds && path.pipePartIds.length) {
            (path.pipePartIds || []).forEach(function (pipePartId) { addReportPartUsage(usage, pipePartId, Hydraulics.partCostForReport(moduleCell, catalog, path, pipePartId)); });
        } else if (path.pipePartId) {
            addReportPartUsage(usage, path.pipePartId, Hydraulics.partCostForReport(moduleCell, catalog, path, path.pipePartId));
        }
        if (path.bedTemplate && Array.isArray(path.bedTemplate.resolvedBomParts) && path.bedTemplate.resolvedBomParts.length) {
            path.bedTemplate.resolvedBomParts.forEach(function (entry) { addReportPartUsage(usage, entry.partId, resolvedBomPartCost(catalog, entry), entry.unit === "m" ? entry.quantity : null); });
        } else if (path.bedTemplate && path.bedTemplate.templateModel === BED_TEMPLATE_MODEL_BOM && Array.isArray(path.bedTemplate.requiredParts)) {
            path.bedTemplate.requiredParts.forEach(function (entry) { addReportPartUsage(usage, entry.partId, partCostForRequiredMeters(catalog, entry.partId, entry.quantityMeters), entry.quantityMeters); });
        }
        if (path.bedTemplate && !(Array.isArray(path.bedTemplate.resolvedBomParts) && path.bedTemplate.resolvedBomParts.length) && Array.isArray(path.bedTemplate.partIds)) {
            path.bedTemplate.partIds.forEach(function (partId) { addReportPartUsage(usage, partId, Hydraulics.partCostForReport(moduleCell, catalog, path, partId)); });
        }
    }

    function collectComponentReportUsage(moduleCell, catalog, component, usage) {
        (component && component.cells || []).forEach(function (cell) {
            const partId = getCellAttr(cell, ATTRS.CATALOG_PART_ID, "");
            const part = partById(catalog, partId);
            if (partId) addReportPartUsage(usage, partId, finiteNumber(part && part.cost || part && part.unitCost, 0));
            if (part && BRANCH_CATEGORIES.has(part.category)) usage.controlledZones.add(getCellId(cell) || part.id);
            if (!isBedAssembly(cell)) return;
            const template = readBedAssemblyTemplateRecord(moduleCell, cell);
            if (template && Array.isArray(template.resolvedBomParts) && template.resolvedBomParts.length) template.resolvedBomParts.forEach(function (entry) { addReportPartUsage(usage, entry.partId, resolvedBomPartCost(catalog, entry), entry.unit === "m" ? entry.quantity : null); });
            else { if (template && template.templateModel === BED_TEMPLATE_MODEL_BOM && Array.isArray(template.requiredParts)) template.requiredParts.forEach(function (entry) { addReportPartUsage(usage, entry.partId, partCostForRequiredMeters(catalog, entry.partId, entry.quantityMeters), entry.quantityMeters); }); if (template && Array.isArray(template.partIds)) template.partIds.forEach(function (templatePartId) { addReportPartUsage(usage, templatePartId, Hydraulics.partCostForReport(moduleCell, catalog, { pipePartId: templatePartId }, templatePartId)); }); }
        });
        (component && component.pipeSegments || []).forEach(function (segment) {
            const pipePart = partById(catalog, segment.pipePartId);
            addReportPartUsage(usage, segment.pipePartId, finiteNumber(pipePart && pipePart.unitCost, pipePart && pipePart.cost || 0) * finiteNumber(segment.lengthFt, 0));
        });
    }

    function generateReport(moduleCell) {
        if (activeIrrigationEditDepth === 0) return runIrrigationEdit("generateReport", function () { return generateReport(moduleCell); });
        return persistReportSummary(moduleCell, buildReportSummary(moduleCell));
    }

    function buildReportSummary(moduleCell, options) {
        const catalog = options && options.catalog ? options.catalog : IrrigationCatalog.read(moduleCell);
        const paths = options && options.paths ? options.paths : ReportModel.deriveAssemblyPaths(moduleCell);
        const components = options && options.components ? options.components : deriveBomComponents(moduleCell);
        const beds = options && options.beds ? options.beds : collectGardenBeds(moduleCell);
        const totalBedAreaM2 = beds.reduce(function (sum, bed) { return sum + bedAreaM2(bed); }, 0);
        const irrigatedBedIds = new Set();
        const completeBedIds = new Set();
        const usage = createReportUsage();
        const criticalWarnings = [];
        let worstHydraulicMarginPsi = null;

        if (components.length) components.forEach(function (component) {
            collectComponentReportUsage(moduleCell, catalog, component, usage);
            if (component.disconnectedFromSource) criticalWarnings.push(DISCONNECTED_SOURCE_WARNING);
        });
        paths.forEach(function (path) {
            if (!components.length) collectPathReportUsage(moduleCell, catalog, path, usage);
            if (path.bedTemplateCommitted && path.targetBedId) {
                irrigatedBedIds.add(path.targetBedId);
                const blockers = pathBlockingErrors(path, catalog).concat(Hydraulics.validateSharedCapacity(moduleCell, path));
                if (!blockers.length) completeBedIds.add(path.targetBedId);
                blockers.forEach(function (warning) { if (!(components.length && path.disconnectedFromSource && warning === DISCONNECTED_SOURCE_WARNING)) criticalWarnings.push(warning); });
            }
            if (path.hydraulic && Number.isFinite(Number(path.hydraulic.marginPsi))) {
                const margin = Number(path.hydraulic.marginPsi);
                worstHydraulicMarginPsi = worstHydraulicMarginPsi == null ? margin : Math.min(worstHydraulicMarginPsi, margin);
            }
        });

        const irrigatedAreaM2 = beds
            .filter(function (bed) { return irrigatedBedIds.has(getCellId(bed)); })
            .reduce(function (sum, bed) { return sum + bedAreaM2(bed); }, 0);
        const bom = buildBomRows(moduleCell, components.length ? { catalog, components } : { catalog, paths });
        const bomRows = bom.rows;
        const completedBomRows = bom.completedRows || [];
        const purchaseRows = bomRows.filter(function (row) { return row.shortageQuantity > 0; });
        const purchaseNeededCost = purchaseRows.reduce(function (sum, row) { return sum + finiteNumber(row.purchaseCost, 0); }, 0);
        const plannedDesignValue = bomRows.reduce(function (sum, row) { return sum + finiteNumber(row.totalCost, 0); }, 0);
        const completedDesignValue = completedBomRows.reduce(function (sum, row) { return sum + finiteNumber(row.totalCost, 0); }, 0);
        const totalDesignValue = plannedDesignValue + completedDesignValue;
        const zones = ZoneModel.read(moduleCell);
        const zoneReport = ZoneModel.summary(moduleCell, zones, paths);
        const zoneWarningCount = zoneReport.zones.reduce(function (sum, zone) { return sum + (zone.warnings || []).length; }, 0) + zoneReport.unzonedBedCount + zoneReport.ambiguousBedIds.length;
        const disconnectedComponents = components.filter(function (component) { return component.disconnectedFromSource; });
        const summary = {
            version: PLUGIN_VERSION,
            percentIrrigated: totalBedAreaM2 > 0 ? (irrigatedAreaM2 / totalBedAreaM2) * 100 : 0,
            purchaseNeededCost,
            totalDesignValue,
            plannedDesignValue,
            completedDesignValue,
            completedPartCount: completedBomRows.length,
            completedParts: completedBomRows.map(function (row) { return { partId: row.partId, requiredQuantity: row.requiredQuantity, totalCost: row.totalCost, displayUnit: row.displayUnit }; }),
            zoneCount: zoneReport.zoneCount || usage.controlledZones.size,
            emptyZoneCount: zoneReport.emptyZoneCount,
            unzonedBedCount: zoneReport.unzonedBedCount,
            overCapacityZoneCount: zoneReport.overCapacityZoneCount,
            worstZoneMarginPsi: zoneReport.worstZoneMarginPsi,
            zoneWarningCount,
            zones: zoneReport.zones,
            unzonedBedIds: zoneReport.unzonedBedIds,
            ambiguousZoneBedIds: zoneReport.ambiguousBedIds,
            completeness: beds.length > 0 ? (completeBedIds.size / beds.length) * 100 : 0,
            worstHydraulicMarginPsi,
            purchaseNeededCount: purchaseRows.length,
            disconnectedTreeCount: disconnectedComponents.length,
            disconnectedTreeWarnings: disconnectedComponents.map(function (component) { return { componentId: component.id, warning: DISCONNECTED_SOURCE_WARNING }; }),
            criticalWarningCount: criticalWarnings.length,
            criticalWarnings
        };

        return summary;
    }

    function persistReportSummary(moduleCell, summary) {
        GraphStore.writeJsonAttr(moduleCell, ATTRS.REPORT_JSON, { version: PLUGIN_VERSION, summary });
        GraphStore.writeJsonAttr(moduleCell, ATTRS.DASHBOARD_JSON, summary);
        return summary;
    }

    function pathBlockingErrors(path, catalog) {
        const errors = [];
        (path && path.routeWarnings || []).forEach(function (warning) { errors.push(warning); });
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
        return GraphStore.readJsonAttr(moduleCell, ATTRS.DASHBOARD_JSON, null);
    }

    function normalizeZone(zone) {
        const z = zone || {};
        const originType = z.originType === ZONE_ORIGIN_TIMER_OUTLET ? ZONE_ORIGIN_TIMER_OUTLET : (z.originType === ZONE_ORIGIN_MANUAL ? ZONE_ORIGIN_MANUAL : ZONE_ORIGIN_MANUAL);
        const originCellId = String(z.originCellId || "").trim();
        const outletIndex = Math.max(0, Math.floor(finiteNumber(z.outletIndex, 0)));
        const id = String(z.id || (originType === ZONE_ORIGIN_TIMER_OUTLET ? timerZoneId(originCellId, outletIndex) : "")).trim();
        return {
            id: id || ("zone_manual_" + Date.now()),
            originType,
            originCellId: originType === ZONE_ORIGIN_TIMER_OUTLET ? originCellId : "",
            outletIndex: originType === ZONE_ORIGIN_TIMER_OUTLET ? outletIndex : null,
            alias: String(z.alias || "").trim(),
            inferredBedIds: uniqueStrings(z.inferredBedIds || []),
            pinnedBedIds: uniqueStrings(z.pinnedBedIds || []),
            excludedBedIds: uniqueStrings(z.excludedBedIds || [])
        };
    }

    function readZones(moduleCell) {
        return deriveZones(moduleCell);
    }

    function readZoneOverrides(moduleCell) {
        const parsed = GraphStore.readJsonAttr(moduleCell, ATTRS.ZONES_JSON, null);
        const zones = parsed && Array.isArray(parsed.zones) ? parsed.zones : (Array.isArray(parsed) ? parsed : []);
        return zones.map(normalizeZone).filter(function (zone) { return !!zone.id; });
    }

    function writeZones(moduleCell, zones) {
        return writeZoneOverrides(moduleCell, zones);
    }

    function writeZoneOverrides(moduleCell, zones) {
        if (activeIrrigationEditDepth === 0) return runIrrigationEdit("writeZoneOverrides", function () { return writeZoneOverrides(moduleCell, zones); });
        const normalized = (zones || []).map(persistedZoneOverrideRecord).filter(function (zone) { return zoneHasPersistedZoneIntent(zone); });
        GraphStore.writeJsonAttr(moduleCell, ATTRS.ZONES_JSON, { version: PLUGIN_VERSION, zones: normalized });
        return deriveZones(moduleCell);
    }

    function persistedZoneOverrideRecord(zone) {
        const z = normalizeZone(zone);
        if (z.originType === ZONE_ORIGIN_TIMER_OUTLET) z.inferredBedIds = [];
        return z;
    }

    function zoneHasPersistedZoneIntent(zone) {
        const z = normalizeZone(zone);
        if (z.originType === ZONE_ORIGIN_MANUAL) return true;
        return !!(z.alias || z.pinnedBedIds.length || z.excludedBedIds.length);
    }

    function timerZoneId(timerCellOrId, outletIndex) {
        const id = typeof timerCellOrId === "string" ? timerCellOrId : getCellId(timerCellOrId);
        return "zone_timer_" + sanitizeId(id || "timer") + "_out_" + (Math.max(0, Math.floor(finiteNumber(outletIndex, 0))) + 1);
    }

    function manualZoneId(label) {
        return "zone_manual_" + sanitizeId(label || "zone") + "_" + Date.now();
    }

    function uniqueStrings(values) {
        const seen = new Set();
        const out = [];
        (values || []).forEach(function (value) {
            const text = String(value || "").trim();
            if (!text || seen.has(text)) return;
            seen.add(text);
            out.push(text);
        });
        return out;
    }

    function collectTimerZoneParts(moduleCell) {
        return collectDescendants(moduleCell, function (cell) {
            if (!cell || getCellAttr(cell, ATTRS.COMPONENT, "") !== "1") return false;
            const part = partForCell(moduleCell, cell);
            return !!part && part.category === "controller_timer";
        });
    }

    function deriveInferredTimerZones(moduleCell) {
        const zones = [];
        collectTimerZoneParts(moduleCell).forEach(function (timerCell) {
            const count = Math.max(0, portCapacityForCell(moduleCell, timerCell, "output"));
            for (let index = 0; index < count; index++) {
                zones.push(normalizeZone({
                    id: timerZoneId(timerCell, index),
                    originType: ZONE_ORIGIN_TIMER_OUTLET,
                    originCellId: getCellId(timerCell) || "",
                    outletIndex: index,
                    inferredBedIds: downstreamBedAssemblyIdsFromTimerOutlet(moduleCell, timerCell, index)
                }));
            }
        });
        return zones;
    }

    function downstreamBedAssemblyIdsFromTimerOutlet(moduleCell, timerCell, outletIndex) {
        const seedEdges = outgoingAssemblyEdges(moduleCell, timerCell).filter(function (edge) {
            return String(getCellAttr(edge, ATTRS.EDGE_SOURCE_PORT, "0")) === String(outletIndex || 0);
        });
        const stack = seedEdges.map(function (edge) { return edge.target; }).filter(Boolean);
        const seen = new Set();
        const beds = [];
        while (stack.length) {
            const cell = stack.pop();
            const id = getCellId(cell);
            if (!id || seen.has(id)) continue;
            seen.add(id);
            if (isAssembly(cell) && assemblyType(cell) === "bed") beds.push(id);
            outgoingAssemblyEdges(moduleCell, cell).forEach(function (edge) { if (edge && edge.target) stack.push(edge.target); });
            const internal = internalNeighborForPort(cell, "output");
            if (internal) stack.push(internal);
        }
        return uniqueStrings(beds);
    }

    function syncZones(moduleCell) {
        return deriveZones(moduleCell);
    }

    function deriveZones(moduleCell) {
        const saved = readZoneOverrides(moduleCell);
        const savedById = new Map(saved.map(function (zone) { return [zone.id, zone]; }));
        const inferred = deriveInferredTimerZones(moduleCell);
        const inferredIds = new Set(inferred.map(function (zone) { return zone.id; }));
        const zones = inferred.map(function (zone) {
            const existing = savedById.get(zone.id);
            return normalizeZone(Object.assign({}, zone, {
                alias: existing ? existing.alias : zone.alias,
                pinnedBedIds: existing ? existing.pinnedBedIds : [],
                excludedBedIds: existing ? existing.excludedBedIds : []
            }));
        });
        saved.forEach(function (zone) {
            if (zone.originType === ZONE_ORIGIN_TIMER_OUTLET && inferredIds.has(zone.id)) return;
            zones.push(zone);
        });
        return zones;
    }

    function zoneDisplayName(moduleCell, zone) {
        const z = normalizeZone(zone);
        if (z.alias) return z.alias;
        if (z.originType === ZONE_ORIGIN_TIMER_OUTLET) {
            const timer = findCellById(moduleCell, z.originCellId);
            return irrigationCellLabel(timer) + " outlet " + (finiteNumber(z.outletIndex, 0) + 1);
        }
        return "Manual zone";
    }

    function allBedAssemblyIds(moduleCell) {
        return collectDescendants(moduleCell, function (cell) { return isAssembly(cell) && assemblyType(cell) === "bed"; }).map(getCellId).filter(Boolean);
    }

    function resolveEffectiveZoneMembership(moduleCell, zonesInput) {
        const zones = (zonesInput || readZones(moduleCell)).map(normalizeZone);
        const assignment = new Map(); // bedAssemblyId -> { zoneId, source }
        const ambiguousBedIds = new Set();
        zones.forEach(function (zone) {
            zone.inferredBedIds.forEach(function (bedId) {
                if (zone.excludedBedIds.indexOf(bedId) >= 0) return;
                if (!assignment.has(bedId)) assignment.set(bedId, { zoneId: zone.id, source: "inferred" });
                else if (assignment.get(bedId).source === "inferred" && assignment.get(bedId).zoneId !== zone.id) ambiguousBedIds.add(bedId);
            });
        });
        ambiguousBedIds.forEach(function (bedId) { assignment.delete(bedId); });
        zones.forEach(function (zone) {
            zone.pinnedBedIds.forEach(function (bedId) { assignment.set(bedId, { zoneId: zone.id, source: "pinned" }); });
        });
        const byZoneId = new Map(zones.map(function (zone) { return [zone.id, []]; }));
        assignment.forEach(function (entry, bedId) { if (byZoneId.has(entry.zoneId)) byZoneId.get(entry.zoneId).push(bedId); });
        return { assignment, byZoneId, ambiguousBedIds: Array.from(ambiguousBedIds).sort() };
    }

    function selectedBedAssembliesFromCells(cells) {
        const out = [];
        const seen = new Set();
        (cells || []).forEach(function (cell) {
            const assembly = isAssembly(cell) && assemblyType(cell) === "bed" ? cell : findAssemblyAncestor(cell);
            if (!assembly || assemblyType(assembly) !== "bed") return;
            const id = getCellId(assembly);
            if (!id || seen.has(id)) return;
            seen.add(id);
            out.push(assembly);
        });
        return out;
    }

    function assignBedsToZone(moduleCell, zoneId, bedAssemblyIds) {
        if (activeIrrigationEditDepth === 0) return runIrrigationEdit("assignBedsToZone", function () { return assignBedsToZone(moduleCell, zoneId, bedAssemblyIds); });
        const ids = uniqueStrings(bedAssemblyIds);
        const zones = deriveZones(moduleCell).map(function (zone) {
            const next = normalizeZone(zone);
            next.pinnedBedIds = next.pinnedBedIds.filter(function (id) { return ids.indexOf(id) < 0; });
            next.excludedBedIds = uniqueStrings(next.excludedBedIds.concat(next.inferredBedIds.filter(function (id) { return ids.indexOf(id) >= 0 && next.id !== zoneId; })));
            if (next.id === zoneId) {
                next.pinnedBedIds = uniqueStrings(next.pinnedBedIds.concat(ids));
                next.excludedBedIds = next.excludedBedIds.filter(function (id) { return ids.indexOf(id) < 0; });
            }
            return next;
        });
        return writeZoneOverrides(moduleCell, zones);
    }

    function resetBedZoneOverrides(moduleCell, bedAssemblyIds) {
        if (activeIrrigationEditDepth === 0) return runIrrigationEdit("resetBedZoneOverrides", function () { return resetBedZoneOverrides(moduleCell, bedAssemblyIds); });
        const ids = uniqueStrings(bedAssemblyIds);
        const zones = deriveZones(moduleCell).map(function (zone) {
            const next = normalizeZone(zone);
            next.pinnedBedIds = next.pinnedBedIds.filter(function (id) { return ids.indexOf(id) < 0; });
            next.excludedBedIds = next.excludedBedIds.filter(function (id) { return ids.indexOf(id) < 0; });
            return next;
        });
        return writeZoneOverrides(moduleCell, zones);
    }

    function createManualZone(moduleCell, alias, bedAssemblyIds) {
        if (activeIrrigationEditDepth === 0) return runIrrigationEdit("createManualZone", function () { return createManualZone(moduleCell, alias, bedAssemblyIds); });
        const zones = deriveZones(moduleCell);
        const zone = normalizeZone({ id: manualZoneId(alias || "manual_zone"), originType: ZONE_ORIGIN_MANUAL, alias: alias || "Manual Zone", pinnedBedIds: uniqueStrings(bedAssemblyIds) });
        zones.push(zone);
        writeZoneOverrides(moduleCell, zones);
        if (bedAssemblyIds && bedAssemblyIds.length) assignBedsToZone(moduleCell, zone.id, bedAssemblyIds);
        return zone;
    }

    function updateZoneAlias(moduleCell, zoneId, alias) {
        if (activeIrrigationEditDepth === 0) return runIrrigationEdit("updateZoneAlias", function () { return updateZoneAlias(moduleCell, zoneId, alias); });
        const zones = deriveZones(moduleCell).map(function (zone) {
            const next = normalizeZone(zone);
            if (next.id === zoneId) next.alias = String(alias || "").trim();
            return next;
        });
        return writeZoneOverrides(moduleCell, zones);
    }

    function resetZoneOverrides(moduleCell, zoneId) {
        if (activeIrrigationEditDepth === 0) return runIrrigationEdit("resetZoneOverrides", function () { return resetZoneOverrides(moduleCell, zoneId); });
        const zones = deriveZones(moduleCell).map(function (zone) {
            const next = normalizeZone(zone);
            if (next.id === zoneId) { next.pinnedBedIds = []; next.excludedBedIds = []; }
            return next;
        });
        return writeZoneOverrides(moduleCell, zones);
    }

    function zoneSummary(moduleCell, zonesInput, pathsInput) {
        const zones = zonesInput || deriveZones(moduleCell);
        const paths = pathsInput || deriveAssemblyPaths(moduleCell);
        const membership = resolveEffectiveZoneMembership(moduleCell, zones);
        const pathByTarget = new Map((paths || []).map(function (path) { return [path.targetEndpointId, path]; }));
        const allBeds = allBedAssemblyIds(moduleCell);
        const assignedBeds = new Set();
        let worstZoneMarginPsi = null;
        const details = zones.map(function (zone) {
            const memberIds = (membership.byZoneId.get(zone.id) || []).sort();
            memberIds.forEach(function (id) { assignedBeds.add(id); });
            let demandGpm = 0;
            let worstMarginPsi = null;
            memberIds.forEach(function (bedAssemblyId) {
                const path = pathByTarget.get(bedAssemblyId);
                demandGpm += finiteNumber(path && path.bedDemand && path.bedDemand.flowGpm, 0);
                if (path && path.hydraulic && Number.isFinite(Number(path.hydraulic.marginPsi))) {
                    const margin = Number(path.hydraulic.marginPsi);
                    worstMarginPsi = worstMarginPsi == null ? margin : Math.min(worstMarginPsi, margin);
                }
            });
            const origin = zone.originType === ZONE_ORIGIN_TIMER_OUTLET ? findCellById(moduleCell, zone.originCellId) : null;
            const sourceRoute = origin ? routeAssemblyToSource(moduleCell, origin) : null;
            const sourceProfile = sourceRoute && sourceRoute.source ? endpointProfile(sourceRoute.source) : null;
            const originPart = origin ? partForCell(moduleCell, origin) : null;
            const outletMax = originPart ? finiteNumber(originPart.connectors && originPart.connectors.output && originPart.connectors.output.maxFlowGpm, finiteNumber(originPart.specs && originPart.specs.maxFlowGpm, null)) : null;
            const sourceMax = sourceProfile ? finiteNumber(sourceProfile.usableFlowGpm, null) : null;
            const warnings = [];
            if (zone.originType === ZONE_ORIGIN_MANUAL && !origin) warnings.push("Manual zone is not linked to a timer outlet.");
            if (sourceMax != null && demandGpm > sourceMax) warnings.push("Zone demand exceeds source usable flow.");
            if (outletMax != null && demandGpm > outletMax) warnings.push("Zone demand exceeds timer outlet max flow.");
            if (worstMarginPsi != null && worstMarginPsi < 0) warnings.push("One or more zone paths have negative pressure margin.");
            if (worstMarginPsi != null) worstZoneMarginPsi = worstZoneMarginPsi == null ? worstMarginPsi : Math.min(worstZoneMarginPsi, worstMarginPsi);
            return {
                id: zone.id,
                name: zoneDisplayName(moduleCell, zone),
                originType: zone.originType,
                originCellId: zone.originCellId,
                outletIndex: zone.outletIndex,
                memberBedIds: memberIds,
                demandGpm,
                worstMarginPsi,
                status: !warnings.length ? "ok" : (zone.originType === ZONE_ORIGIN_MANUAL && !origin ? "unknown" : "warning"),
                warnings
            };
        });
        const unzonedBedIds = allBeds.filter(function (bedId) { return !assignedBeds.has(bedId); }).sort();
        return {
            zones: details,
            zoneCount: details.length,
            emptyZoneCount: details.filter(function (zone) { return zone.memberBedIds.length === 0; }).length,
            unzonedBedCount: unzonedBedIds.length,
            unzonedBedIds,
            ambiguousBedIds: membership.ambiguousBedIds,
            overCapacityZoneCount: details.filter(function (zone) { return zone.status === "warning"; }).length,
            worstZoneMarginPsi
        };
    }

    function formatMoney(value) {
        const n = finiteNumber(value, 0);
        return "$" + n.toFixed(n % 1 === 0 ? 0 : 2);
    }

    function openBomDialog(moduleCell, options) {
        seedStarterCatalogIfEmpty(moduleCell);
        const catalog = readCatalog(moduleCell);
        const selectedPartIds = validSelectedScopePartIds(catalog, { selectedPartIds: options && options.selectedPartIds || [] });
        const state = {
            selectedScopeActive: selectedPartIds.length > 0,
            selectedPartIds,
            search: "",
            statusFilter: "",
            broadCategoryFilter: "",
            categoryFilter: "",
            sizeFilter: "",
            rowDrafts: {},
            compactView: bomDialogCompactView(moduleCell), // NEW
            allowClose: false,
            restoreHideDialog: null
        };
        const div = document.createElement("div");
        applyBomDialogSize(div, state); // CHANGE
        const size = bomDialogSize(state); // NEW
        showDialog(div, size.dialogWidth, size.dialogHeight); // CHANGE
        installBomDialogCloseGuard(state);
        renderBomDialog(div, moduleCell, state);
    }

    function bomDialogCompactPreferenceKey(moduleCell) { // NEW
        return catalogManagerCurrentUserId() + ":" + (getCellId(moduleCell) || "module"); // NEW
    } // NEW

    function bomDialogCompactState() { // NEW
        const storage = catalogManagerStorage(); // NEW
        if (!storage) return {}; // NEW
        try { const parsed = JSON.parse(storage.getItem(BOM_DIALOG_COMPACT_STORAGE_KEY) || "{}"); return parsed && typeof parsed === "object" ? parsed : {}; } catch (_) { return {}; } // NEW
    } // NEW

    function bomDialogCompactView(moduleCell) { // NEW
        const state = bomDialogCompactState(); // NEW
        return state[bomDialogCompactPreferenceKey(moduleCell)] === true; // NEW
    } // NEW

    function setBomDialogCompactView(moduleCell, compact) { // NEW
        const storage = catalogManagerStorage(); // NEW
        if (!storage) return; // NEW
        const state = bomDialogCompactState(); // NEW
        state[bomDialogCompactPreferenceKey(moduleCell)] = compact === true; // NEW
        try { storage.setItem(BOM_DIALOG_COMPACT_STORAGE_KEY, JSON.stringify(state)); } catch (_) {} // NEW
    } // NEW

    function bomDialogSize(state) { // NEW
        return state && state.compactView ? BOM_DIALOG_COMPACT_SIZE : BOM_DIALOG_FULL_SIZE; // NEW
    } // NEW

    function applyBomDialogSize(container, state) { // NEW
        const size = bomDialogSize(state); // NEW
        if (container) { // NEW
            container.className = "trellis-irrigation-bom-dialog" + (state && state.compactView ? " compact" : ""); // NEW
            container.style.cssText = "width:" + size.contentWidth + "px;max-width:96vw;max-height:84vh;overflow:auto;font:12px Arial,sans-serif;padding:12px;box-sizing:border-box;"; // NEW
        } // NEW
        const dialog = ui && ui.dialog && ui.dialog.container; // NEW
        if (dialog && dialog.style) { // NEW
            dialog.style.width = (size.dialogWidth + 60) + "px"; // NEW
            dialog.style.height = (size.dialogHeight + 60) + "px"; // NEW
        } // NEW
    } // NEW

    function renderBomDialog(container, moduleCell, state) {
        const view = buildBomDialogViewData(moduleCell, state); // CHANGE: centralize BOM data so in-place refresh and full render stay aligned
        applyBomDialogSize(container, state); // CHANGE: full renders still own dialog content sizing
        const selectedScopePartIds = view.selectedScopePartIds; // CHANGE
        const bom = view.bom; // CHANGE
        const filterOptions = view.filterOptions; // CHANGE
        container.innerHTML = "";

        const titleRow = document.createElement("div");
        titleRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 10px;";
        const title = document.createElement("h2");
        title.textContent = "Irrigation BOM";
        title.style.cssText = "font-size:16px;margin:0;";
        const totalText = document.createElement("div");
        totalText.className = "trellis-irrigation-bom-totals"; // CHANGE: allow search refresh to update totals without replacing controls
        totalText.style.cssText = "font-weight:700;color:#1f2937;";
        updateBomTotalsNode(totalText, view); // CHANGE
        titleRow.appendChild(title);
        titleRow.appendChild(totalText);
        container.appendChild(titleRow);

        if (state.selectedScopeActive) {
            const selectedScopeNotice = document.createElement("div");
            selectedScopeNotice.className = "trellis-irrigation-selected-bom-scope";
            selectedScopeNotice.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 10px;padding:7px 8px;border:1px solid #b6c7e6;background:#eef5ff;color:#1f3b64;";
            const label = document.createElement("span");
            label.textContent = "Showing BOM for " + selectedScopePartIds.length + " selected catalog part" + (selectedScopePartIds.length === 1 ? "" : "s") + ".";
            selectedScopeNotice.appendChild(label);
            selectedScopeNotice.appendChild(button("Show All", function () { state.selectedScopeActive = false; state.selectedPartIds = []; renderBomDialog(container, moduleCell, state); }));
            container.appendChild(selectedScopeNotice);
        }

        if (bom.disconnectedTreeCount > 0) {
            const disconnectedNotice = document.createElement("div");
            disconnectedNotice.className = "trellis-irrigation-disconnected-bom-notice";
            disconnectedNotice.style.cssText = "margin:0 0 10px;padding:7px 8px;border:1px solid #f2c94c;background:#fff8db;color:#6b4e00;";
            disconnectedNotice.textContent = bom.disconnectedTreeCount + " irrigation tree" + (bom.disconnectedTreeCount === 1 ? " is" : "s are") + " disconnected from a source. Connected parts are included in this BOM, but source and hydraulic checks are incomplete.";
            container.appendChild(disconnectedNotice);
        }

        const filterRow = document.createElement("div");
        filterRow.style.cssText = "display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap;";
        const search = document.createElement("input");
        search.type = "search";
        search.className = "trellis-irrigation-bom-search"; // CHANGE: stable hook for tests and focused in-place filtering
        search.placeholder = "Search BOM";
        search.value = state.search || "";
        search.style.cssText = "min-width:160px;padding:4px;border:1px solid #aaa;border-radius:4px;";
        search.addEventListener("input", function () { state.search = search.value; refreshBomDialogResults(container, moduleCell, state); if (search.focus) search.focus(); }); // CHANGE: keep the focused search input mounted while filtering
        filterRow.appendChild(search);
        const statusFilter = document.createElement("select");
        appendSelectOption(statusFilter, "", "All stock");
        appendSelectOption(statusFilter, "in_stock", "In stock");
        appendSelectOption(statusFilter, "shortage", "Needs purchase");
        statusFilter.value = state.statusFilter || "";
        statusFilter.addEventListener("change", function () { state.statusFilter = statusFilter.value; renderBomDialog(container, moduleCell, state); });
        filterRow.appendChild(statusFilter);
        const broadFilter = document.createElement("select");
        broadFilter.className = "trellis-irrigation-bom-broad-filter"; // NEW
        appendSelectOption(broadFilter, "", "All broad categories");
        filterOptions.broadCategories.forEach(function (entry) { appendSelectOption(broadFilter, entry.id, entry.label); });
        broadFilter.value = state.broadCategoryFilter || "";
        broadFilter.addEventListener("change", function () { state.broadCategoryFilter = broadFilter.value; normalizeBomCategoryFilterForBroadCategory(state); renderBomDialog(container, moduleCell, state); }); // CHANGE
        filterRow.appendChild(broadFilter);
        const categoryFilter = document.createElement("select");
        categoryFilter.className = "trellis-irrigation-bom-category-filter"; // NEW
        appendBomCategoryFilterOptions(categoryFilter, state.broadCategoryFilter, filterOptions.logicalCategories.map(function (entry) { return entry.id; })); // CHANGE
        categoryFilter.value = state.categoryFilter || "";
        categoryFilter.addEventListener("change", function () { state.categoryFilter = categoryFilter.value; renderBomDialog(container, moduleCell, state); });
        filterRow.appendChild(categoryFilter);
        const sizeFilter = document.createElement("select");
        appendSelectOption(sizeFilter, "", "All sizes");
        filterOptions.sizes.forEach(function (size) { appendSelectOption(sizeFilter, size, size); });
        sizeFilter.value = state.sizeFilter || "";
        sizeFilter.addEventListener("change", function () { state.sizeFilter = sizeFilter.value; renderBomDialog(container, moduleCell, state); });
        filterRow.appendChild(sizeFilter);
        const compactLabel = document.createElement("label"); // NEW
        compactLabel.style.cssText = "display:flex;align-items:center;gap:5px;"; // NEW
        const compactView = document.createElement("input"); // NEW
        compactView.type = "checkbox"; // NEW
        compactView.className = "trellis-irrigation-bom-compact-view"; // NEW
        compactView.checked = !!state.compactView; // NEW
        compactView.addEventListener("change", function () { state.compactView = compactView.checked; setBomDialogCompactView(moduleCell, state.compactView); state.rowDrafts = {}; renderBomDialog(container, moduleCell, state); }); // NEW
        compactLabel.appendChild(compactView); // NEW
        compactLabel.appendChild(document.createTextNode("Compact view")); // NEW
        filterRow.appendChild(compactLabel); // NEW
        container.appendChild(filterRow);

        container.appendChild(renderBomResults(container, moduleCell, state, view)); // CHANGE

        const controls = document.createElement("div");
        controls.className = "trellis-irrigation-bom-controls"; // CHANGE: anchor in-place result replacement ahead of footer controls
        controls.style.cssText = "display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;justify-content:flex-end;";
        controls.appendChild(button("Export CSV", function () { downloadBomCsv(moduleCell, buildBomDialogViewData(moduleCell, state).visibleRows, state); })); // CHANGE: export current in-place search results
        controls.appendChild(button("Close", function () { closeBomDialog(state); }));
        container.appendChild(controls);
    }

    function buildBomDialogViewData(moduleCell, state) { // CHANGE
        const catalog = readCatalog(moduleCell); // CHANGE
        if (typeof state.compactView !== "boolean") state.compactView = bomDialogCompactView(moduleCell); // CHANGE
        applyBomDialogSize(null, state); // CHANGE: keep parent dialog dimensions synchronized during in-place refresh
        const selectedScopePartIds = validSelectedScopePartIds(catalog, state); // CHANGE
        if (state.selectedScopeActive && selectedScopePartIds.length === 0) state.selectedScopeActive = false; // CHANGE
        const bom = ReportModel.buildBomRows(moduleCell, { catalog, selectedPartIds: state.selectedScopeActive ? selectedScopePartIds : [] }); // CHANGE
        normalizeBomCategoryFilterForBroadCategory(state); // CHANGE
        const visibleRows = bomVisibleRows(bom.rows, state, moduleCell); // CHANGE
        const visibleCompletedRows = bomVisibleRows(bom.completedRows || [], state, moduleCell); // CHANGE
        return { // CHANGE
            catalog, // CHANGE
            selectedScopePartIds, // CHANGE
            bom, // CHANGE
            visibleRows, // CHANGE
            visibleCompletedRows, // CHANGE
            totals: bomTotals(visibleRows), // CHANGE
            completedTotals: bomTotals(visibleCompletedRows), // CHANGE
            filterOptions: catalogFilterOptions({ items: bom.rows.concat(bom.completedRows || []).map(function (row) { return row.part; }) }) // CHANGE
        }; // CHANGE
    } // CHANGE

    function updateBomTotalsNode(totalText, view) { // CHANGE
        if (!totalText || !view) return; // CHANGE
        totalText.textContent = "Planned " + formatMoney(view.totals.totalCost) + " | Purchase " + formatMoney(view.totals.purchaseCost) + " | Completed " + formatMoney(view.completedTotals.totalCost); // CHANGE
    } // CHANGE

    function refreshBomDialogResults(container, moduleCell, state) { // CHANGE
        const view = buildBomDialogViewData(moduleCell, state); // CHANGE
        updateBomTotalsNode(container && container.querySelector && container.querySelector(".trellis-irrigation-bom-totals"), view); // CHANGE
        const current = container && container.querySelector && container.querySelector(".trellis-irrigation-bom-results"); // CHANGE
        const next = renderBomResults(container, moduleCell, state, view); // CHANGE
        if (current && current.parentNode) current.parentNode.replaceChild(next, current); // CHANGE
        else renderBomDialog(container, moduleCell, state); // CHANGE
    } // CHANGE

    function renderBomResults(container, moduleCell, state, view) { // CHANGE
        const results = document.createElement("div"); // CHANGE
        results.className = "trellis-irrigation-bom-results"; // CHANGE
        results.appendChild(renderPlannedBomTable(container, moduleCell, state, view.visibleRows)); // CHANGE
        const completed = renderCompletedBomSection(moduleCell, view.visibleCompletedRows); // CHANGE
        if (completed) results.appendChild(completed); // CHANGE
        return results; // CHANGE
    } // CHANGE

    function renderPlannedBomTable(container, moduleCell, state, visibleRows) { // CHANGE
        const tableWrap = document.createElement("div");
        tableWrap.className = "trellis-irrigation-bom-table-wrap"; // CHANGE
        tableWrap.style.cssText = "overflow:auto;border:1px solid #d1d5db;";
        const table = document.createElement("table");
        table.className = "trellis-irrigation-bom-table"; // NEW
        table.style.cssText = "width:100%;border-collapse:collapse;min-width:" + (state.compactView ? "760px" : "980px") + ";"; // CHANGE
        table.innerHTML = state.compactView ? "<thead><tr><th>Part</th><th>Required</th><th>Stock</th><th>Price</th><th>Shortage</th><th>Total planned</th><th>Purchase</th></tr></thead>" : "<thead><tr><th>Part</th><th>Category</th><th>Size</th><th>Required</th><th>Stock</th><th>Price</th><th>Shortage</th><th>Total planned</th><th>Purchase</th><th>Actions</th></tr></thead>"; // CHANGE
        applyIrrigationTableHeaderStyles(table, "bom"); // NEW
        const tbody = document.createElement("tbody");
        const groupState = { broadId: "", logicalId: "" }; // CHANGE
        const groupCounts = bomGroupCounts(visibleRows); // NEW
        const colspan = state.compactView ? 7 : 10; // NEW
        visibleRows.forEach(function (row) {
            appendBomGroupRowsForPart(tbody, row.part, groupState, groupCounts, colspan); // CHANGE
            tbody.appendChild(renderBomRow(container, moduleCell, state, row));
        });
        if (!visibleRows.length) {
            const emptyRow = document.createElement("tr");
            emptyRow.innerHTML = "<td colspan=\"" + colspan + "\">No planned BOM rows match the current scope and filters.</td>"; // CHANGE
            emptyRow.children[0].style.cssText = "padding:10px;color:#6b7280;font-style:italic;";
            tbody.appendChild(emptyRow);
        }
        table.appendChild(tbody);
        tableWrap.appendChild(table);
        return tableWrap; // CHANGE
    } // CHANGE

    function renderCompletedBomSection(moduleCell, visibleCompletedRows) { // CHANGE
        if (!visibleCompletedRows.length) return null; // CHANGE
        const section = document.createElement("div"); // CHANGE
        section.className = "trellis-irrigation-bom-completed-section"; // CHANGE
        if (visibleCompletedRows.length) {
            const completedTitle = document.createElement("h3");
            completedTitle.textContent = "Completed Parts";
            completedTitle.style.cssText = "font-size:13px;margin:12px 0 6px;color:#1f2937;";
            section.appendChild(completedTitle); // CHANGE
            section.appendChild(renderCompletedBomTable(moduleCell, visibleCompletedRows)); // CHANGE
        }
        return section; // CHANGE
    } // CHANGE

    function renderBomRow(container, moduleCell, state, row) {
        if (state && state.compactView) return renderCompactBomRow(container, moduleCell, state, row); // NEW
        const draft = state.rowDrafts[row.partId] || bomDraftFromRow(row, moduleCell);
        const tr = document.createElement("tr");
        tr.className = "trellis-irrigation-bom-row";
        const onHand = bomCellInput(draft.stockQuantity);
        const unitCost = bomCellInput(draft.unitCost);
        const save = button("Save", function () { saveBomRowDraft(container, moduleCell, state, row, onHand.value, unitCost.value); });
        const undo = button("Undo", function () { delete state.rowDrafts[row.partId]; renderBomDialog(container, moduleCell, state); });
        const dirty = !!state.rowDrafts[row.partId];
        save.style.display = dirty ? "" : "none";
        undo.style.display = dirty ? "" : "none";
        function markDirty() {
            state.rowDrafts[row.partId] = { stockQuantity: onHand.value, unitCost: unitCost.value };
            save.style.display = "";
            undo.style.display = "";
        }
        onHand.addEventListener("input", markDirty);
        unitCost.addEventListener("input", markDirty);
        appendBomCell(tr, row.part.name || row.partId);
        appendBomCell(tr, partDisplayCategory(row.part).logicalLabel); // CHANGE
        appendBomCell(tr, catalogPartSizeLabel(row.part));
        appendBomCell(tr, formatBomCanonicalQuantity(row.requiredQuantity, row.part, moduleCell));
        appendBomInputCell(tr, onHand);
        const unitCostUnit = bomDisplayUnitLabel(row.part, moduleCell); // CHANGE
        appendBomInputCell(tr, unitCost, unitCostUnit ? "/" + unitCostUnit : ""); // CHANGE
        appendBomCell(tr, formatBomCanonicalQuantity(row.shortageQuantity, row.part, moduleCell)); // CHANGE
        appendBomCell(tr, formatMoney(row.totalCost));
        appendBomCell(tr, formatMoney(row.purchaseCost));
        const actions = document.createElement("td");
        actions.style.cssText = "border-bottom:1px solid #e5e7eb;padding:5px;vertical-align:top;display:flex;gap:5px;";
        actions.appendChild(save);
        actions.appendChild(undo);
        tr.appendChild(actions);
        return tr;
    }

    function renderCompactBomRow(container, moduleCell, state, row) { // NEW
        const tr = document.createElement("tr"); // NEW
        tr.className = "trellis-irrigation-bom-row"; // NEW
        tr.dataset.partId = row.partId; // NEW
        appendBomCell(tr, row.part.name || row.partId); // NEW
        appendBomCell(tr, formatBomCanonicalQuantity(row.requiredQuantity, row.part, moduleCell)); // NEW
        appendBomOnHandCell(tr, container, moduleCell, state, row); // NEW
        appendBomPriceCell(tr, container, moduleCell, state, row); // NEW
        appendBomCell(tr, formatBomCanonicalQuantity(row.shortageQuantity, row.part, moduleCell)); // NEW
        appendBomCell(tr, formatMoney(row.totalCost)); // NEW
        appendBomCell(tr, formatMoney(row.purchaseCost)); // NEW
        return tr; // NEW
    } // NEW

    function renderCompletedBomTable(moduleCell, rows) {
        const tableWrap = document.createElement("div");
        tableWrap.style.cssText = "overflow:auto;border:1px solid #c8e6c9;";
        const table = document.createElement("table");
        table.className = "trellis-irrigation-bom-completed-table"; // NEW
        table.style.cssText = "width:100%;border-collapse:collapse;min-width:620px;";
        table.innerHTML = "<thead><tr><th>Part</th><th>Category</th><th>Size</th><th>Completed</th><th>Unit cost</th><th>Installed value</th></tr></thead>";
        applyIrrigationTableHeaderStyles(table, "bom"); // NEW
        const tbody = document.createElement("tbody");
        const groupState = { broadId: "", logicalId: "" }; // NEW
        const groupCounts = bomGroupCounts(rows); // NEW
        (rows || []).forEach(function (row) {
            appendBomGroupRowsForPart(tbody, row.part, groupState, groupCounts, 6); // NEW
            const tr = document.createElement("tr");
            appendBomCell(tr, row.part.name || row.partId);
            appendBomCell(tr, partDisplayCategory(row.part).logicalLabel); // CHANGE
            appendBomCell(tr, catalogPartSizeLabel(row.part));
            appendBomCell(tr, formatBomCanonicalQuantity(row.requiredQuantity, row.part, moduleCell));
            appendBomCell(tr, bomLineUnitCost(row.part, moduleCell));
            appendBomCell(tr, formatMoney(row.totalCost));
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        tableWrap.appendChild(table);
        return tableWrap;
    }

    function bomGroupCounts(rows) { // NEW
        const byBroad = new Map(); // NEW
        (rows || []).forEach(function (row) { // NEW
            const display = partDisplayCategory(row.part); // NEW
            if (!byBroad.has(display.broadId)) byBroad.set(display.broadId, new Set()); // NEW
            byBroad.get(display.broadId).add(display.logicalId); // NEW
        }); // NEW
        return byBroad; // NEW
    } // NEW

    function appendBomGroupRowsForPart(tbody, part, groupState, groupCounts, colspan) { // NEW
        const display = partDisplayCategory(part); // NEW
        if (display.broadId !== groupState.broadId) { // NEW
            groupState.broadId = display.broadId; // NEW
            groupState.logicalId = ""; // NEW
            appendBomGroupRow(tbody, display.broadLabel, colspan, false); // NEW
        } // NEW
        if (bomShouldShowLogicalSubgroup(display, groupCounts) && display.logicalId !== groupState.logicalId) { // NEW
            groupState.logicalId = display.logicalId; // NEW
            appendBomGroupRow(tbody, display.logicalLabel, colspan, true); // NEW
        } // NEW
    } // NEW

    function bomShouldShowLogicalSubgroup(display, groupCounts) { // NEW
        const logicalIds = groupCounts && groupCounts.get(display.broadId); // NEW
        return display.broadId === "fittings_adapters" || !!(logicalIds && logicalIds.size > 1); // NEW
    } // NEW

    function appendBomGroupRow(tbody, label, colspan, subgroup) { // NEW
        const groupRow = document.createElement("tr"); // NEW
        groupRow.className = "trellis-irrigation-bom-group" + (subgroup ? " trellis-irrigation-bom-subgroup" : " trellis-irrigation-bom-broad-group"); // NEW
        groupRow.innerHTML = "<td colspan=\"" + colspan + "\">" + html(label) + "</td>"; // NEW
        groupRow.children[0].style.cssText = subgroup ? "border-bottom:1px solid #e5e7eb;padding:5px 6px 5px 16px;background:#f8fafc;font-weight:700;color:#374151;" : "border-bottom:1px solid #d1d5db;padding:6px;background:#eef2f7;font-weight:700;color:#1f2937;"; // NEW
        tbody.appendChild(groupRow); // NEW
    } // NEW

    function bomCellInput(value) {
        const input = document.createElement("input");
        input.type = "number";
        input.min = "0";
        input.step = "0.01";
        input.value = value == null ? "" : String(value);
        input.style.cssText = "width:86px;box-sizing:border-box;padding:3px;border:1px solid #aaa;border-radius:4px;";
        return input;
    }

    function applyIrrigationTableHeaderStyles(table, kind) { // NEW
        const css = kind === "catalog" ? "border:1px solid #ccc;padding:4px;vertical-align:top;text-align:left;" : "border-bottom:1px solid #e5e7eb;padding:5px;vertical-align:top;text-align:left;"; // NEW
        Array.from((table && table.querySelectorAll && table.querySelectorAll("thead th")) || []).forEach(function (th) { th.style.cssText = css; }); // NEW
    } // NEW

    function appendBomCell(row, text) {
        const td = document.createElement("td");
        td.textContent = text == null ? "" : String(text);
        td.style.cssText = "border-bottom:1px solid #e5e7eb;padding:5px;vertical-align:top;";
        row.appendChild(td);
        return td;
    }

    function appendBomInputCell(row, input, suffix) {
        const td = appendBomCell(row, "");
        td.appendChild(input);
        if (suffix) td.appendChild(document.createTextNode(" " + suffix));
        return td;
    }

    function appendIrrigationPriceInputGroup(td, input, suffix) { // NEW
        const group = document.createElement("span"); // NEW
        group.style.cssText = "display:inline-flex;align-items:center;gap:3px;white-space:nowrap;"; // NEW
        group.appendChild(document.createTextNode("$")); // NEW
        group.appendChild(input); // NEW
        if (suffix) group.appendChild(document.createTextNode(suffix)); // NEW
        td.appendChild(group); // NEW
        return td; // NEW
    } // NEW

    function appendBomOnHandCell(row, container, moduleCell, state, bomRow) { // NEW
        const input = bomCellInput(bomDisplayQuantityValue(bomRow.onHandQuantity, bomRow.part, moduleCell)); // NEW
        input.className = "trellis-irrigation-bom-on-hand-input"; // NEW
        let committed = false; // NEW
        input.addEventListener("click", stopCatalogInputEvent); // NEW
        input.addEventListener("mousedown", stopCatalogInputEvent); // NEW
        input.addEventListener("dblclick", stopCatalogInputEvent); // NEW
        input.addEventListener("keydown", function (evt) { // NEW
            if (evt.key === "Escape") { input.value = bomDisplayQuantityValue(bomRow.onHandQuantity, bomRow.part, moduleCell); committed = true; input.blur(); stopCatalogInputEvent(evt); return; } // NEW
            if (evt.key === "Enter") { committed = true; commitBomOnHandInput(container, moduleCell, state, bomRow, input.value); input.blur(); stopCatalogInputEvent(evt); } // NEW
        }); // NEW
        input.addEventListener("blur", function () { if (!committed) commitBomOnHandInput(container, moduleCell, state, bomRow, input.value); }); // NEW
        const td = appendBomInputCell(row, input, bomDisplayUnitLabel(bomRow.part, moduleCell)); // NEW
        return td; // NEW
    } // NEW

    function appendBomPriceCell(row, container, moduleCell, state, bomRow) { // NEW
        const input = bomCellInput(formatBomNumber(bomDisplayUnitCost(bomRow.part, moduleCell))); // NEW
        input.className = "trellis-irrigation-bom-price-input"; // NEW
        let committed = false; // NEW
        input.addEventListener("click", stopCatalogInputEvent); // NEW
        input.addEventListener("mousedown", stopCatalogInputEvent); // NEW
        input.addEventListener("dblclick", stopCatalogInputEvent); // NEW
        input.addEventListener("keydown", function (evt) { // NEW
            if (evt.key === "Escape") { input.value = formatBomNumber(bomDisplayUnitCost(bomRow.part, moduleCell)); committed = true; input.blur(); stopCatalogInputEvent(evt); return; } // NEW
            if (evt.key === "Enter") { committed = true; commitBomPriceInput(container, moduleCell, state, bomRow, input.value); input.blur(); stopCatalogInputEvent(evt); } // NEW
        }); // NEW
        input.addEventListener("blur", function () { if (!committed) commitBomPriceInput(container, moduleCell, state, bomRow, input.value); }); // NEW
        const td = appendBomCell(row, ""); // CHANGE
        appendIrrigationPriceInputGroup(td, input, bomDisplayUnitLabel(bomRow.part, moduleCell) ? "/" + bomDisplayUnitLabel(bomRow.part, moduleCell) : ""); // CHANGE
        return td; // NEW
    } // NEW

    function bomDraftFromRow(row, moduleCell) {
        return {
            stockQuantity: bomDisplayQuantityValue(row.onHandQuantity, row.part, moduleCell),
            unitCost: formatBomNumber(bomDisplayUnitCost(row.part, moduleCell), 2)
        };
    }

    function saveBomRowDraft(container, moduleCell, state, row, stockQuantityValue, unitCostValue) {
        const quantity = bomInputQuantityToCanonical(stockQuantityValue, row.part, moduleCell);
        const next = Object.assign({}, row.part, {
            stockQuantity: quantity,
            stockState: stockStateForQuantity(quantity)
        });
        if (isLinearCatalogPart(next)) next.unitCost = bomInputUnitCostToCanonical(unitCostValue, next, moduleCell);
        else next.cost = Math.max(0, finiteNumber(unitCostValue, 0));
        runIrrigationEdit("saveBomRow", function () {
            upsertCatalogPart(moduleCell, next);
            ReportModel.syncDashboardState(moduleCell);
        });
        delete state.rowDrafts[row.partId];
        renderBomDialog(container, moduleCell, state);
        if (activeIrrigationMode && activeIrrigationMode.moduleCell === moduleCell) renderIrrigationMode(activeIrrigationMode);
    }

    function commitBomOnHandInput(container, moduleCell, state, row, value) { // NEW
        const quantity = bomInputQuantityToCanonical(value, row.part, moduleCell); // NEW
        if (Math.abs(quantity - finiteNumber(row.part.stockQuantity, 0)) < 0.000001) return; // NEW
        const next = Object.assign({}, row.part, { stockQuantity: quantity, stockState: stockStateForQuantity(quantity) }); // NEW
        runIrrigationEdit("bomStockQuantity", function () { // NEW
            upsertCatalogPart(moduleCell, next); // NEW
            ReportModel.syncDashboardState(moduleCell); // NEW
        }); // NEW
        if (activeIrrigationMode && activeIrrigationMode.moduleCell === moduleCell) renderIrrigationMode(activeIrrigationMode); // NEW
        renderBomDialog(container, moduleCell, state); // NEW
    } // NEW

    function commitBomPriceInput(container, moduleCell, state, row, value) { // NEW
        const displayCost = Math.max(0, finiteNumber(value, 0)); // NEW
        if (Math.abs(displayCost - bomDisplayUnitCost(row.part, moduleCell)) < 0.000001) return; // NEW
        const canonicalCost = bomInputUnitCostToCanonical(value, row.part, moduleCell); // NEW
        const next = isLinearCatalogPart(row.part) ? Object.assign({}, row.part, { unitCost: canonicalCost }) : Object.assign({}, row.part, { cost: canonicalCost }); // NEW
        runIrrigationEdit("bomPrice", function () { // NEW
            upsertCatalogPart(moduleCell, next); // NEW
            ReportModel.syncDashboardState(moduleCell); // NEW
        }); // NEW
        if (activeIrrigationMode && activeIrrigationMode.moduleCell === moduleCell) renderIrrigationMode(activeIrrigationMode); // NEW
        renderBomDialog(container, moduleCell, state); // NEW
    } // NEW

    function bomVisibleRows(rows, state, moduleCell) {
        return (rows || []).filter(function (row) { return bomRowMatchesFilters(row, state, moduleCell); });
    }

    function bomRowMatchesFilters(row, state) {
        const part = row.part;
        const display = partDisplayCategory(part); // NEW
        const search = String(state.search || "").trim().toLowerCase();
        if (search && (String(part.name || "").toLowerCase().indexOf(search) < 0 && String(part.id || "").toLowerCase().indexOf(search) < 0 && String(part.category || "").toLowerCase().indexOf(search) < 0 && display.logicalLabel.toLowerCase().indexOf(search) < 0 && display.broadLabel.toLowerCase().indexOf(search) < 0)) return false; // CHANGE
        if (state.statusFilter === "in_stock" && row.onHandQuantity <= 0) return false;
        if (state.statusFilter === "shortage" && row.shortageQuantity <= 0) return false;
        if (state.categoryFilter && display.logicalId !== state.categoryFilter) return false; // CHANGE
        if (state.broadCategoryFilter && display.broadId !== state.broadCategoryFilter) return false; // CHANGE
        if (state.sizeFilter && catalogPartSizes(part).indexOf(state.sizeFilter) < 0) return false;
        return true;
    }

    function bomTotals(rows) {
        return (rows || []).reduce(function (totals, row) {
            totals.totalCost += finiteNumber(row.totalCost, 0);
            totals.purchaseCost += finiteNumber(row.purchaseCost, 0);
            return totals;
        }, { totalCost: 0, purchaseCost: 0 });
    }

    function bomHasUnsavedDrafts(state) {
        return !!(state && state.rowDrafts && Object.keys(state.rowDrafts).length);
    }

    function closeBomDialog(state) {
        if (bomHasUnsavedDrafts(state) && typeof confirm === "function" && !confirm("Discard unsaved BOM edits?")) return;
        if (state) state.allowClose = true;
        hideDialog();
    }

    function installBomDialogCloseGuard(state) {
        if (!ui || !ui.hideDialog || ui.__trellisBomHideGuard) return;
        const original = ui.hideDialog;
        ui.__trellisBomHideGuard = true;
        state.restoreHideDialog = function () { ui.hideDialog = original; ui.__trellisBomHideGuard = false; };
        ui.hideDialog = function () {
            if (!state.allowClose && bomHasUnsavedDrafts(state) && typeof confirm === "function" && !confirm("Discard unsaved BOM edits?")) return;
            if (state.restoreHideDialog) state.restoreHideDialog();
            return original.apply(ui, arguments);
        };
    }

    function csvEscape(value) {
        const str = String(value == null ? "" : value);
        const escaped = str.replace(/"/g, "\"\"");
        return /[",\n\r]/.test(str) ? "\"" + escaped + "\"" : escaped;
    }

    function buildBomCsv(moduleCell, rows) {
        const csvRows = [];
        function push(values) { csvRows.push(values.map(csvEscape).join(",")); }
        push(["Part", "Broad category", "Category", "Size", "Required", "Stock", "Price", "Shortage", "Total required", "Purchase"]); // CHANGE
        (rows || []).forEach(function (row) {
            const display = partDisplayCategory(row.part); // NEW
            push([
                row.part.name || row.partId,
                display.broadLabel, // CHANGE
                display.logicalLabel, // CHANGE
                catalogPartSizeLabel(row.part),
                formatBomCanonicalQuantity(row.requiredQuantity, row.part, moduleCell),
                formatBomCanonicalQuantity(row.onHandQuantity, row.part, moduleCell),
                bomLineUnitCost(row.part, moduleCell),
                formatBomCanonicalQuantity(row.shortageQuantity, row.part, moduleCell), // CHANGE
                formatMoney(row.totalCost),
                formatMoney(row.purchaseCost)
            ]);
        });
        return csvRows.join("\n");
    }

    function downloadBomCsv(moduleCell, rows, state) {
        const name = sanitizeId(getCellAttr(moduleCell, "label", "") || getCellId(moduleCell) || "garden");
        const suffix = state && state.selectedScopeActive ? "selected" : "all";
        downloadCsv(name + "_irrigation_bom_" + suffix + ".csv", buildBomCsv(moduleCell, rows));
    }

    function downloadCsv(filename, csvText) {
        if (typeof Blob === "undefined" || typeof URL === "undefined" || !document || !document.createElement) return;
        const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        if (document.body) document.body.appendChild(a);
        if (a.click) a.click();
        if (a.remove) a.remove();
        URL.revokeObjectURL(url);
    }

    function openCatalogManager(moduleCell) {
        seedStarterCatalogIfEmpty(moduleCell);
        const catalog = readCatalog(moduleCell);
        const selectedPartIds = selectedCatalogPartIdsFromGraphSelection(moduleCell, catalog);
        const state = { selectedId: selectedPartIds[0] || "", selectedScopeActive: selectedPartIds.length > 0, selectedPartIds, compactView: catalogManagerCompactView(moduleCell) }; // CHANGE
        ensureCatalogManagerResponsiveStyles(); // NEW
        const div = document.createElement("div");
        div.className = "trellis-irrigation-catalog-manager";
        applyCatalogManagerDialogSize(div, state); // CHANGE
        const size = catalogManagerDialogSize(state); // NEW
        showDialog(div, size.dialogWidth, size.dialogHeight); // CHANGE
        renderCatalogManager(div, moduleCell, state);
    }

    function ensureCatalogManagerResponsiveStyles() { // NEW
        if (typeof document === "undefined" || !document.head) return; // CHANGE
        const style = document.getElementById("trellis-irrigation-catalog-responsive-styles") || document.createElement("style"); // CHANGE
        style.id = "trellis-irrigation-catalog-responsive-styles"; // NEW
        style.textContent = [ // NEW
            ".trellis-irrigation-catalog-layout{display:grid;grid-template-columns:minmax(620px,1.08fr) minmax(560px,0.92fr);gap:18px;align-items:start;min-width:0;}", // NEW
            ".trellis-irrigation-catalog-table-wrap{min-width:0;overflow:auto;}", // NEW
            ".trellis-irrigation-catalog-table{width:100%;min-width:620px;border-collapse:collapse;}", // NEW
            ".trellis-irrigation-catalog-manager.compact .trellis-irrigation-catalog-layout{grid-template-columns:1fr;}", // CHANGE
            ".trellis-irrigation-catalog-manager.compact .trellis-irrigation-catalog-table-wrap{max-height:var(--trellis-irrigation-catalog-list-max-height,240px);overflow:auto;}", // NEW
            ".trellis-irrigation-catalog-manager.compact .trellis-irrigation-catalog-table{min-width:360px;}", // NEW
            ".trellis-irrigation-catalog-form{min-width:0;}", // NEW
            "@media (max-width:1180px){.trellis-irrigation-catalog-layout{grid-template-columns:1fr;}.trellis-irrigation-catalog-manager.compact .trellis-irrigation-catalog-layout{grid-template-columns:1fr;}.trellis-irrigation-catalog-table-wrap{width:100%;}}" // CHANGE
        ].join("\n"); // CHANGE
        if (!style.parentNode) document.head.appendChild(style); // CHANGE
    } // NEW

    function selectedCatalogPartIdsFromGraphSelection(moduleCell, catalog) {
        const cells = graph.getSelectionCells ? graph.getSelectionCells() : (graph.getSelectionCell ? [graph.getSelectionCell()].filter(Boolean) : []);
        const seen = new Set();
        const ids = [];
        (cells || []).forEach(function (cell) {
            selectedCatalogPartIdsForSelection(moduleCell, cell).forEach(function (partId) {
                if (!partId || seen.has(partId) || !partById(catalog, partId)) return;
                seen.add(partId);
                ids.push(partId);
            });
        });
        return ids;
    }

    function selectedCatalogPartIdsForSelection(moduleCell, cell) {
        if (!cell || (cell !== moduleCell && findGardenModuleAncestor(cell) !== moduleCell)) return [];
        if (isAssembly(cell) && assemblyType(cell) === "bed") return bedAssemblyCatalogPartIds(moduleCell, cell);
        if (isAssembly(cell)) return assemblyPartCells(cell).map(function (partCell) { return getCellAttr(partCell, ATTRS.CATALOG_PART_ID, ""); }).filter(Boolean);
        if (getCellAttr(cell, ATTRS.PIPE_EDGE, "") === "1") return [getCellAttr(cell, ATTRS.PIPE_PART_ID, "")].filter(Boolean);
        if (getCellAttr(cell, ATTRS.CATALOG_PART_ID, "")) return [getCellAttr(cell, ATTRS.CATALOG_PART_ID, "")];
        return [];
    }

    function bedAssemblyCatalogPartIds(moduleCell, assembly) {
        const template = readBedAssemblyTemplateRecord(moduleCell, assembly);
        if (!template) return [];
        const ids = [];
        pushCatalogPartId(ids, template.inletPartId);
        pushCatalogPartId(ids, template.outletPartId);
        pushCatalogPartId(ids, template.rowPartId);
        pushCatalogPartId(ids, template.emitterPartId);
        pushCatalogPartId(ids, template.rowTakeoffPartId);
        pushCatalogPartId(ids, template.rowEndCapPartId);
        pushCatalogPartId(ids, template.headerEndCapPartId);
        pushCatalogPartId(ids, template.supplyPipePartId);
        (Array.isArray(template.partIds) ? template.partIds : []).forEach(function (partId) { pushCatalogPartId(ids, partId); });
        (Array.isArray(template.resolvedBomParts) ? template.resolvedBomParts : []).forEach(function (entry) { pushCatalogPartId(ids, entry && entry.partId); });
        (Array.isArray(template.requiredParts) ? template.requiredParts : []).forEach(function (entry) { pushCatalogPartId(ids, entry && entry.partId); });
        pushCatalogPartId(ids, template.anchorPartId);
        pushCatalogPartId(ids, template.pipePartId);
        return ids;
    }

    function pushCatalogPartId(ids, partId) {
        const value = String(partId || "").trim();
        if (value) ids.push(value);
    }

    function catalogManagerStorage() { // NEW
        try { return typeof window !== "undefined" && window.localStorage ? window.localStorage : null; } catch (_) { return null; } // NEW
    } // NEW

    function catalogManagerCurrentUserId() { // NEW
        const users = typeof window !== "undefined" && window.Trellis && window.Trellis.users; // NEW
        const user = users && typeof users.getCurrentUser === "function" ? users.getCurrentUser() : null; // NEW
        return String(user && (user.id || user.userId) || "anonymous").trim() || "anonymous"; // NEW
    } // NEW

    function catalogManagerCompactPreferenceKey(moduleCell) { // NEW
        return catalogManagerCurrentUserId() + ":" + (getCellId(moduleCell) || "module"); // NEW
    } // NEW

    function catalogManagerCompactState() { // NEW
        const storage = catalogManagerStorage(); // NEW
        if (!storage) return {}; // NEW
        try { const parsed = JSON.parse(storage.getItem(CATALOG_MANAGER_COMPACT_STORAGE_KEY) || "{}"); return parsed && typeof parsed === "object" ? parsed : {}; } catch (_) { return {}; } // NEW
    } // NEW

    function catalogManagerCompactView(moduleCell) { // NEW
        const state = catalogManagerCompactState(); // NEW
        return state[catalogManagerCompactPreferenceKey(moduleCell)] === true; // NEW
    } // NEW

    function setCatalogManagerCompactView(moduleCell, compact) { // NEW
        const storage = catalogManagerStorage(); // NEW
        if (!storage) return; // NEW
        const state = catalogManagerCompactState(); // NEW
        state[catalogManagerCompactPreferenceKey(moduleCell)] = compact === true; // NEW
        try { storage.setItem(CATALOG_MANAGER_COMPACT_STORAGE_KEY, JSON.stringify(state)); } catch (_) {} // NEW
    } // NEW

    function catalogManagerDialogSize(state) { // NEW
        return state && state.compactView ? CATALOG_MANAGER_COMPACT_SIZE : CATALOG_MANAGER_FULL_SIZE; // NEW
    } // NEW

    function applyCatalogManagerDialogSize(container, state) { // NEW
        const size = catalogManagerDialogSize(state); // NEW
        if (container) { // NEW
            container.className = "trellis-irrigation-catalog-manager" + (state && state.compactView ? " compact" : ""); // NEW
            container.style.cssText = "width:" + size.contentWidth + "px;max-width:96vw;max-height:88vh;overflow:auto;font:12px Arial,sans-serif;padding:12px;box-sizing:border-box;"; // CHANGE
            if (state && state.compactView) container.style.setProperty("--trellis-irrigation-catalog-list-max-height", CATALOG_MANAGER_COMPACT_LIST_MAX_HEIGHT + "px"); // NEW
        } // NEW
        const dialog = ui && ui.dialog && ui.dialog.container; // NEW
        if (dialog && dialog.style) { // NEW
            dialog.style.width = (size.dialogWidth + 60) + "px"; // NEW
            dialog.style.height = (size.dialogHeight + 60) + "px"; // NEW
        } // NEW
    } // NEW

    function validSelectedScopePartIds(catalog, state) {
        const seen = new Set();
        const ids = [];
        (state.selectedPartIds || []).forEach(function (partId) {
            if (!partId || seen.has(partId) || !partById(catalog, partId)) return;
            seen.add(partId);
            ids.push(partId);
        });
        return ids;
    }

    function normalizeCatalogManagerFilters(parts, state) { // NEW
        for (let i = 0; i < 6; i++) { // NEW
            let changed = false; // NEW
            const options = contextualCatalogFilterOptions(parts, state); // NEW
            if (state.broadCategoryFilter && !options.broadCategories.some(function (entry) { return entry.id === state.broadCategoryFilter; })) { state.broadCategoryFilter = ""; changed = true; } // NEW
            if (state.categoryFilter && options.categories.indexOf(state.categoryFilter) < 0) { state.categoryFilter = ""; changed = true; } // NEW
            if (state.sizeFilter && options.sizes.indexOf(state.sizeFilter) < 0) { state.sizeFilter = ""; changed = true; } // NEW
            if (state.connectorTypeFilter && options.connectorTypes.indexOf(state.connectorTypeFilter) < 0) { state.connectorTypeFilter = ""; changed = true; } // NEW
            if (state.connectionFilter && options.connectionCounts.map(String).indexOf(String(state.connectionFilter)) < 0) { state.connectionFilter = ""; changed = true; } // NEW
            if (!changed) return options; // NEW
        } // NEW
        return contextualCatalogFilterOptions(parts, state); // NEW
    } // NEW

    function renderCatalogManager(container, moduleCell, state) {
        const catalog = readCatalog(moduleCell);
        if (!state.partDrafts) state.partDrafts = {};
        if (!state.categoryFilter) state.categoryFilter = "";
        if (!state.broadCategoryFilter) state.broadCategoryFilter = "";
        if (!state.sizeFilter) state.sizeFilter = "";
        if (!state.connectionFilter) state.connectionFilter = "";
        if (!state.connectorTypeFilter) state.connectorTypeFilter = "";
        if (typeof state.compactView !== "boolean") state.compactView = catalogManagerCompactView(moduleCell); // NEW
        applyCatalogManagerDialogSize(container, state); // NEW
        const selectedScopePartIds = validSelectedScopePartIds(catalog, state);
        if (state.selectedScopeActive && selectedScopePartIds.length === 0) state.selectedScopeActive = false;
        const scopedItems = state.selectedScopeActive ? selectedScopePartIds.map(function (partId) { return partById(catalog, partId); }).filter(Boolean) : (catalog.items || []);
        const filterOptions = normalizeCatalogManagerFilters(scopedItems, state); // CHANGE
        const visibleItems = sortCatalogParts(scopedItems.filter(function (part) { return catalogPartMatchesFilters(part, state); }));
        const selected = resolveCatalogManagerSelectedPart(catalog, visibleItems, state, selectedScopePartIds); // CHANGE
        state.selectedId = selected.id;
        container.innerHTML = "";

        const title = document.createElement("h2");
        title.textContent = "Irrigation Catalog";
        title.style.cssText = "font-size:16px;margin:0 0 10px;";
        container.appendChild(title);

        if (state.selectedScopeActive) {
            const selectedScopeNotice = document.createElement("div");
            selectedScopeNotice.className = "trellis-irrigation-selected-catalog-scope";
            selectedScopeNotice.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 10px;padding:7px 8px;border:1px solid #b6c7e6;background:#eef5ff;color:#1f3b64;";
            const label = document.createElement("span");
            label.textContent = "Showing " + selectedScopePartIds.length + " selected catalogue part" + (selectedScopePartIds.length === 1 ? "" : "s") + ".";
            selectedScopeNotice.appendChild(label);
            const showAllBtn = button("Show All", function () { state.selectedScopeActive = false; state.selectedPartIds = []; renderCatalogManager(container, moduleCell, state); });
            showAllBtn.className = "trellis-irrigation-catalog-show-all";
            selectedScopeNotice.appendChild(showAllBtn);
            container.appendChild(selectedScopeNotice);
        }

        const filterRow = document.createElement("div");
        filterRow.style.cssText = "display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap;";
        const broadFilter = document.createElement("select");
        broadFilter.className = "trellis-irrigation-catalog-broad-filter";
        appendSelectOption(broadFilter, "", "All broad categories");
        filterOptions.broadCategories.forEach(function (entry) { appendSelectOption(broadFilter, entry.id, entry.label); });
        broadFilter.value = state.broadCategoryFilter;
        broadFilter.addEventListener("change", function () { state.broadCategoryFilter = broadFilter.value; normalizeCategoryFilterForBroadCategory(state); state.selectedId = ""; renderCatalogManager(container, moduleCell, state); }); // CHANGE
        filterRow.appendChild(broadFilter);
        const categoryFilter = document.createElement("select");
        categoryFilter.className = "trellis-irrigation-catalog-category-filter";
        appendCatalogCategoryOptions(categoryFilter, filterOptions.categories); // CHANGE
        categoryFilter.value = state.categoryFilter;
        categoryFilter.addEventListener("change", function () { state.categoryFilter = categoryFilter.value; state.selectedId = ""; renderCatalogManager(container, moduleCell, state); });
        filterRow.appendChild(categoryFilter);
        const sizeFilter = document.createElement("select");
        sizeFilter.className = "trellis-irrigation-catalog-size-filter";
        appendSelectOption(sizeFilter, "", "All sizes");
        filterOptions.sizes.forEach(function (size) { appendSelectOption(sizeFilter, size, size); });
        sizeFilter.value = state.sizeFilter;
        sizeFilter.addEventListener("change", function () { state.sizeFilter = sizeFilter.value; state.selectedId = ""; renderCatalogManager(container, moduleCell, state); });
        filterRow.appendChild(sizeFilter);
        const connectorTypeFilter = document.createElement("select");
        connectorTypeFilter.className = "trellis-irrigation-catalog-connector-type-filter";
        appendSelectOption(connectorTypeFilter, "", "All connector types");
        filterOptions.connectorTypes.forEach(function (type) { appendSelectOption(connectorTypeFilter, type, connectorTypeLabel(type)); });
        connectorTypeFilter.value = state.connectorTypeFilter;
        connectorTypeFilter.addEventListener("change", function () { state.connectorTypeFilter = connectorTypeFilter.value; state.selectedId = ""; renderCatalogManager(container, moduleCell, state); });
        filterRow.appendChild(connectorTypeFilter);
        const connectionFilter = document.createElement("select");
        connectionFilter.className = "trellis-irrigation-catalog-connection-filter";
        appendSelectOption(connectionFilter, "", "All connections");
        filterOptions.connectionCounts.forEach(function (count) { appendSelectOption(connectionFilter, String(count), count + " connection" + (count === 1 ? "" : "s")); });
        connectionFilter.value = state.connectionFilter;
        connectionFilter.addEventListener("change", function () { state.connectionFilter = connectionFilter.value; state.selectedId = ""; renderCatalogManager(container, moduleCell, state); });
        filterRow.appendChild(connectionFilter);
        const compactLabel = document.createElement("label"); // NEW
        compactLabel.style.cssText = "display:flex;align-items:center;gap:5px;"; // NEW
        const compactView = document.createElement("input"); // NEW
        compactView.type = "checkbox"; // NEW
        compactView.className = "trellis-irrigation-catalog-compact-view"; // NEW
        compactView.checked = !!state.compactView; // NEW
        compactView.addEventListener("change", function () { state.compactView = compactView.checked; setCatalogManagerCompactView(moduleCell, state.compactView); renderCatalogManager(container, moduleCell, state); }); // NEW
        compactLabel.appendChild(compactView); // NEW
        compactLabel.appendChild(document.createTextNode("Compact view")); // NEW
        filterRow.appendChild(compactLabel); // NEW
        container.appendChild(filterRow);

        const layout = document.createElement("div");
        layout.className = "trellis-irrigation-catalog-layout"; // CHANGE
        container.appendChild(layout);

        const tableWrap = document.createElement("div");
        tableWrap.className = "trellis-irrigation-catalog-table-wrap"; // NEW
        const table = document.createElement("table");
        table.className = "trellis-irrigation-catalog-table"; // CHANGE
        table.innerHTML = state.compactView ? "<thead><tr><th>Name</th><th>Stock</th><th>Price</th></tr></thead>" : "<thead><tr><th>Name</th><th>Broad</th><th>Category</th><th>Size</th><th>Connections</th><th>Stock</th><th>Price</th><th>Status</th></tr></thead>"; // CHANGE
        applyIrrigationTableHeaderStyles(table, "catalog"); // NEW
        const tbody = document.createElement("tbody");
        let lastCatalogGroup = "";
        visibleItems.forEach(function (part) {
            const group = catalogGroupLabel(part);
            if (group !== lastCatalogGroup) {
                lastCatalogGroup = group;
                const groupRow = document.createElement("tr");
                groupRow.className = "trellis-irrigation-catalog-group";
                groupRow.innerHTML = "<td colspan=\"" + (state.compactView ? "3" : "8") + "\">" + html(group) + "</td>"; // CHANGE
                groupRow.children[0].style.cssText = "border:1px solid #bbb;padding:5px 6px;background:#eef2f7;font-weight:700;color:#1f2937;";
                tbody.appendChild(groupRow);
            }
            const validation = validateCatalogPart(part);
            const tr = document.createElement("tr");
            tr.style.cursor = "pointer";
            tr.dataset.partId = part.id;
            if (part.id === state.selectedId) tr.style.background = "#e8f1ff";
            appendCatalogCell(tr, part.name || part.id); // CHANGE
            if (!state.compactView) { // NEW
                appendCatalogCell(tr, catalogBroadCategoryLabel(part)); // NEW
                appendCatalogCell(tr, catalogCategoryLabel(part.category)); // CHANGE
                appendCatalogCell(tr, catalogPartSizeLabel(part)); // NEW
                appendCatalogCell(tr, catalogConnectionLabel(part)); // NEW
            } // NEW
            appendCatalogOnHandCell(tr, container, moduleCell, state, part); // CHANGE
            appendCatalogPriceCell(tr, container, moduleCell, state, part); // CHANGE: allow price edits directly from the catalogue list
            if (!state.compactView) appendCatalogCell(tr, validation.ok ? "Ready" : "Needs data"); // NEW
            tr.addEventListener("click", function () {
                selectCatalogPartInPlace(container, moduleCell, state, part.id); // CHANGE
            });
            tbody.appendChild(tr);
        });
        if (visibleItems.length === 0) {
            const emptyRow = document.createElement("tr");
            emptyRow.className = "trellis-irrigation-catalog-empty";
            emptyRow.innerHTML = "<td colspan=\"" + (state.compactView ? "3" : "8") + "\">No catalogue parts match the current filters.</td>"; // CHANGE
            emptyRow.children[0].style.cssText = "border:1px solid #ccc;padding:8px;color:#6b7280;font-style:italic;";
            tbody.appendChild(emptyRow);
        }
        table.appendChild(tbody);
        tableWrap.appendChild(table);
        const addBtn = button("Add Part", function () {
            const next = makeBlankPart(catalog);
            upsertCatalogPart(moduleCell, next);
            state.selectedScopeActive = false;
            state.selectedPartIds = [];
            state.selectedId = next.id;
            renderCatalogManager(container, moduleCell, state);
        });
        addBtn.className = "trellis-irrigation-add-part";
        tableWrap.appendChild(addBtn);
        layout.appendChild(tableWrap);

        layout.appendChild(renderCatalogEditorPanel(container, moduleCell, state, selected)); // CHANGE
    }

    function resolveCatalogManagerSelectedPart(catalog, visibleItems, state, selectedScopePartIds) { // NEW
        if (!state.partDrafts) state.partDrafts = {}; // NEW
        let catalogSelected = partById(catalog, state.selectedId); // NEW
        if (state.selectedScopeActive && (!catalogSelected || selectedScopePartIds.indexOf(catalogSelected.id) < 0)) catalogSelected = visibleItems[0] || partById(catalog, selectedScopePartIds[0]); // NEW
        else if (!catalogSelected) catalogSelected = visibleItems[0] || catalog.items[0] || makeBlankPart(catalog); // NEW
        return normalizeCatalogPart(state.partDrafts[catalogSelected.id] || catalogSelected); // NEW
    } // NEW

    function renderCatalogEditorPanel(container, moduleCell, state, selected) { // NEW
        if (!state.partDrafts) state.partDrafts = {}; // NEW
        const form = buildCatalogPartForm(selected, moduleCell, function (draft) { state.partDrafts[draft.id] = draft; state.selectedId = draft.id; renderCatalogManager(container, moduleCell, state); }); // NEW
        const validation = validateCatalogPart(selected);
        const status = document.createElement("div");
        status.className = "trellis-irrigation-catalog-status";
        status.style.cssText = "margin-top:8px;color:" + (validation.ok ? "#116611" : "#9a4b00") + ";";
        status.textContent = validation.ok ? "Ready for HUD use." : validation.errors.join(" ");
        form.node.appendChild(status);

        const controls = document.createElement("div");
        controls.style.cssText = "display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;";
        controls.appendChild(button("Save Part", function () {
            const next = readCatalogPartForm(form);
            upsertCatalogPart(moduleCell, next);
            delete state.partDrafts[next.id];
            state.selectedId = next.id;
            renderCatalogManager(container, moduleCell, state);
        }));
        controls.appendChild(button("Delete Part", function () {
            deleteCatalogPart(moduleCell, selected.id);
            delete state.partDrafts[selected.id];
            state.selectedId = "";
            renderCatalogManager(container, moduleCell, state);
        }));
        controls.appendChild(button("Close", hideDialog));
        form.node.appendChild(controls);
        return form.node; // NEW
    } // NEW

    function updateCatalogSelectedRowStyles(tableWrap, selectedId) { // NEW
        if (!tableWrap || !tableWrap.querySelectorAll) return; // NEW
        Array.from(tableWrap.querySelectorAll("tr[data-part-id]")).forEach(function (row) { // NEW
            row.style.background = row.dataset.partId === selectedId ? "#e8f1ff" : ""; // NEW
        }); // NEW
    } // NEW

    function selectCatalogPartInPlace(container, moduleCell, state, partId) { // NEW
        const catalog = readCatalog(moduleCell); // NEW
        const selected = partById(catalog, partId); // NEW
        const layout = container && container.querySelector && container.querySelector(".trellis-irrigation-catalog-layout"); // NEW
        const tableWrap = layout && layout.querySelector(".trellis-irrigation-catalog-table-wrap"); // NEW
        const currentForm = layout && layout.querySelector(".trellis-irrigation-catalog-form"); // NEW
        if (!selected || !layout || !tableWrap || !currentForm) { renderCatalogManager(container, moduleCell, state); return; } // NEW
        if (!state.partDrafts) state.partDrafts = {}; // NEW
        state.selectedId = selected.id; // NEW
        delete state.partDrafts[selected.id]; // NEW
        updateCatalogSelectedRowStyles(tableWrap, selected.id); // NEW
        const nextForm = renderCatalogEditorPanel(container, moduleCell, state, normalizeCatalogPart(selected)); // NEW
        layout.replaceChild(nextForm, currentForm); // NEW
    } // NEW

    function appendCatalogCell(row, text) { // NEW
        const td = document.createElement("td"); // NEW
        td.textContent = text == null ? "" : String(text); // NEW
        td.style.cssText = "border:1px solid #ccc;padding:4px;vertical-align:top;"; // NEW
        row.appendChild(td); // NEW
        return td; // NEW
    } // NEW

    function appendCatalogOnHandCell(row, container, moduleCell, state, part) { // NEW
        const td = appendCatalogCell(row, ""); // NEW
        const input = document.createElement("input"); // NEW
        input.type = "number"; // NEW
        input.min = "0"; // NEW
        input.step = "0.01"; // NEW
        input.className = "trellis-irrigation-catalog-on-hand-input"; // NEW
        input.value = bomDisplayQuantityValue(part.stockQuantity, part, moduleCell); // NEW
        input.style.cssText = "width:76px;box-sizing:border-box;padding:3px;border:1px solid #aaa;border-radius:4px;"; // NEW
        let committed = false; // NEW
        input.addEventListener("click", stopCatalogInputEvent); // NEW
        input.addEventListener("mousedown", stopCatalogInputEvent); // NEW
        input.addEventListener("dblclick", stopCatalogInputEvent); // NEW
        input.addEventListener("keydown", function (evt) { // NEW
            if (evt.key === "Escape") { input.value = bomDisplayQuantityValue(part.stockQuantity, part, moduleCell); input.blur(); stopCatalogInputEvent(evt); return; } // NEW
            if (evt.key === "Enter") { committed = true; commitCatalogOnHandInput(container, moduleCell, state, part, input.value); input.blur(); stopCatalogInputEvent(evt); } // NEW
        }); // NEW
        input.addEventListener("blur", function () { if (!committed) commitCatalogOnHandInput(container, moduleCell, state, part, input.value); }); // NEW
        td.appendChild(input); // NEW
        const unit = bomDisplayUnitLabel(part, moduleCell); // CHANGE
        if (unit) td.appendChild(document.createTextNode(" " + unit)); // CHANGE
        return td; // NEW
    } // NEW

    function appendCatalogPriceCell(row, container, moduleCell, state, part) { // NEW
        const td = appendCatalogCell(row, ""); // NEW
        const input = document.createElement("input"); // NEW
        input.type = "number"; // NEW
        input.min = "0"; // NEW
        input.step = "0.01"; // NEW
        input.className = "trellis-irrigation-catalog-price-input"; // NEW
        input.value = formatBomNumber(bomDisplayUnitCost(part, moduleCell)); // NEW
        input.style.cssText = "width:76px;box-sizing:border-box;padding:3px;border:1px solid #aaa;border-radius:4px;"; // NEW
        let committed = false; // NEW
        input.addEventListener("click", stopCatalogInputEvent); // NEW
        input.addEventListener("mousedown", stopCatalogInputEvent); // NEW
        input.addEventListener("dblclick", stopCatalogInputEvent); // NEW
        input.addEventListener("keydown", function (evt) { // NEW
            if (evt.key === "Escape") { input.value = formatBomNumber(bomDisplayUnitCost(part, moduleCell)); input.blur(); stopCatalogInputEvent(evt); return; } // NEW
            if (evt.key === "Enter") { committed = true; commitCatalogPriceInput(container, moduleCell, state, part, input.value); input.blur(); stopCatalogInputEvent(evt); } // NEW
        }); // NEW
        input.addEventListener("blur", function () { if (!committed) commitCatalogPriceInput(container, moduleCell, state, part, input.value); }); // NEW
        const unit = isLinearCatalogPart(part) ? bomDisplayUnitLabel(part, moduleCell) : ""; // NEW
        appendIrrigationPriceInputGroup(td, input, unit ? "/" + unit : ""); // CHANGE
        return td; // NEW
    } // NEW

    function stopCatalogInputEvent(evt) { // NEW
        if (evt && typeof evt.stopPropagation === "function") evt.stopPropagation(); // NEW
    } // NEW

    function commitCatalogOnHandInput(container, moduleCell, state, part, value) { // NEW
        const quantity = bomInputQuantityToCanonical(value, part, moduleCell); // NEW
        if (Math.abs(quantity - finiteNumber(part.stockQuantity, 0)) < 0.000001) return; // NEW
        const next = Object.assign({}, part, { stockQuantity: quantity, stockState: stockStateForQuantity(quantity) }); // NEW
        runIrrigationEdit("catalogStockQuantity", function () { // NEW
            upsertCatalogPart(moduleCell, next); // NEW
            ReportModel.syncDashboardState(moduleCell); // NEW
        }); // NEW
        if (state && state.partDrafts) delete state.partDrafts[part.id]; // NEW
        if (activeIrrigationMode && activeIrrigationMode.moduleCell === moduleCell) renderIrrigationMode(activeIrrigationMode); // NEW
        renderCatalogManager(container, moduleCell, state); // NEW
    } // NEW

    function commitCatalogPriceInput(container, moduleCell, state, part, value) { // NEW
        const displayCost = Math.max(0, finiteNumber(value, 0)); // NEW
        if (Math.abs(displayCost - bomDisplayUnitCost(part, moduleCell)) < 0.000001) return; // NEW
        const canonicalCost = bomInputUnitCostToCanonical(value, part, moduleCell); // NEW
        const next = isLinearCatalogPart(part) ? Object.assign({}, part, { unitCost: canonicalCost }) : Object.assign({}, part, { cost: canonicalCost }); // NEW
        runIrrigationEdit("catalogPrice", function () { // NEW
            upsertCatalogPart(moduleCell, next); // NEW
            ReportModel.syncDashboardState(moduleCell); // NEW
        }); // NEW
        if (state && state.partDrafts) delete state.partDrafts[part.id]; // NEW
        if (activeIrrigationMode && activeIrrigationMode.moduleCell === moduleCell) renderIrrigationMode(activeIrrigationMode); // NEW
        renderCatalogManager(container, moduleCell, state); // NEW
    } // NEW

    function makeBlankPart(catalog) {
        const id = nextCatalogPartId(catalog || { items: [] }, "pipe_tubing");
        return {
            id,
            name: "New irrigation part",
            category: "pipe_tubing",
            stockState: "unknown",
            stockQuantity: 0,
            cost: 1,
            unitCost: 1,
            connectors: {
                inputs: 1,
                outputs: 1,
                input: input("barb", "3/4", "", true),
                output: output("barb", "3/4", "", null, true)
            },
            specs: { innerDiameterIn: 0.75 }
        };
    }

    function catalogPipeSize(part) {
        const p = normalizeCatalogPart(part);
        return p && p.connectors && ((p.connectors.input && p.connectors.input.nominalSize) || (p.connectors.output && p.connectors.output.nominalSize)) || "3/4";
    }

    function pipeVisualNominalSize(part) {
        const p = normalizeCatalogPart(part);
        return p && p.connectors && ((p.connectors.input && p.connectors.input.nominalSize) || (p.connectors.output && p.connectors.output.nominalSize)) || "";
    }

    function pipeEdgeDisplayLabelForPart(moduleCell, pipePartId, sourceConnector, targetConnector) {
        const pipe = partById(readCatalog(moduleCell), pipePartId || "");
        const pipeSize = pipeVisualNominalSize(pipe);
        if (pipeSize) return pipeSize;
        const sourceSize = normalizeConnectorRecord(sourceConnector).nominalSize;
        const targetSize = normalizeConnectorRecord(targetConnector).nominalSize;
        return sourceSize && sourceSize === targetSize ? sourceSize : (sourceSize || targetSize || "size?");
    }

    function pipeEdgeDisplayLabel(moduleCell, edge, sourceConnector, targetConnector) {
        return pipeEdgeDisplayLabelForPart(moduleCell, getCellAttr(edge, ATTRS.PIPE_PART_ID, ""), sourceConnector, targetConnector);
    }

    function connectionEdgeDisplayLabel(moduleCell, edge, sourceConnector, targetConnector) {
        if (getCellAttr(edge, ATTRS.PIPE_EDGE, "") === "1") return pipeEdgeDisplayLabel(moduleCell, edge, sourceConnector, targetConnector);
        return connectionDisplayLabel(sourceConnector, targetConnector);
    }

    function connectionEdgeDisplayLabelForDecision(moduleCell, decision) {
        const sourceConnector = ConnectorRules.portConnectorForCell(moduleCell, decision && decision.sourceCell, "output");
        const targetConnector = ConnectorRules.portConnectorForCell(moduleCell, decision && decision.targetCell, "input");
        if (decision && decision.mode === "pipe") return pipeEdgeDisplayLabelForPart(moduleCell, decision.pipePartId || "", sourceConnector, targetConnector);
        return connectionDisplayLabel(sourceConnector, targetConnector);
    }

    function syncConnectionEdgeDisplayLabel(moduleCell, edge) {
        if (!edge) return false;
        const sourceConnector = ConnectorRules.portConnectorForCell(moduleCell, edge.source, "output");
        const targetConnector = ConnectorRules.portConnectorForCell(moduleCell, edge.target, "input");
        return setCellAttrs(edge, { label: connectionEdgeDisplayLabel(moduleCell, edge, sourceConnector, targetConnector) });
    }

    function preserveConnectionEdgeAnchorStyle(previousStyle, nextStyle) { // NEW
        let style = String(nextStyle || ""); // NEW
        CONNECTION_EDGE_ANCHOR_STYLE_KEYS.forEach(function (key) { // NEW
            const value = styleValue(previousStyle, key); // NEW
            if (value !== "") style = setStyleValue(style, key, value); // NEW
        }); // NEW
        return style; // NEW
    } // NEW

    function connectionPortAnchorX(moduleCell, port) { // NEW
        const normalized = normalizePort(port); // NEW
        const cell = portCell(moduleCell, normalized); // NEW
        const count = Math.max(1, portCapacityForCell(moduleCell, cell, normalized.role)); // NEW
        return formatStyleNumber((normalized.index + 1) / (count + 1)); // NEW
    } // NEW

    function connectionPortAnchorY(moduleCell, port) { // NEW
        return portDisplayRole(moduleCell, port) === "input" ? "0" : "1"; // NEW
    } // NEW

    function setConnectionPortAnchorStyle(moduleCell, style, port, source) { // NEW
        const prefix = source ? "exit" : "entry"; // NEW
        let next = String(style || ""); // NEW
        next = setStyleValue(next, prefix + "X", connectionPortAnchorX(moduleCell, port)); // NEW
        next = setStyleValue(next, prefix + "Y", connectionPortAnchorY(moduleCell, port)); // NEW
        next = setStyleValue(next, prefix + "Dx", "0"); // NEW
        next = setStyleValue(next, prefix + "Dy", "0"); // NEW
        next = setStyleValue(next, prefix + "Perimeter", "0"); // NEW
        return next; // NEW
    } // NEW

    function connectionEdgeVisualAnchorStyle(moduleCell, edge, baseStyle) { // NEW
        let style = String(baseStyle != null ? baseStyle : edge && edge.style || ""); // NEW
        if (!edge) return style; // NEW
        style = setConnectionPortAnchorStyle(moduleCell, style, portForConnectionEdge(edge, true), true); // NEW
        style = setConnectionPortAnchorStyle(moduleCell, style, portForConnectionEdge(edge, false), false); // NEW
        return style; // NEW
    } // NEW

    function syncConnectionEdgeVisualAnchors(moduleCell, edge) { // NEW
        if (!managedConnectionEdge(edge)) return false; // NEW
        return setCellStyle(edge, connectionEdgeVisualAnchorStyle(moduleCell || findGardenModuleAncestor(edge), edge)); // NEW
    } // NEW

    function syncConnectionEdgeVisualAnchorsForCell(moduleCell, cell) { // NEW
        let changed = false; // NEW
        externalEdgesForCell(moduleCell, cell).forEach(function (edge) { changed = syncConnectionEdgeVisualAnchors(moduleCell, edge) || changed; }); // NEW
        return changed; // NEW
    } // NEW

    function syncAllConnectionEdgeVisualAnchors(moduleCell) { // NEW
        let changed = false; // NEW
        collectAssemblyEdges(moduleCell).forEach(function (edge) { changed = syncConnectionEdgeVisualAnchors(moduleCell, edge) || changed; }); // NEW
        return changed; // NEW
    } // NEW

    function pipeEdgeStyleForPart(moduleCell, pipePartId, baseStyle) {
        const pipe = partById(readCatalog(moduleCell), pipePartId);
        const strokeWidth = pipeEdgeStrokeWidthForSize(pipeVisualNominalSize(pipe));
        return strokeWidth ? setStyleValue(baseStyle || PIPE_EDGE_BASE_STYLE, "strokeWidth", strokeWidth) : (baseStyle || PIPE_EDGE_BASE_STYLE);
    }

    function pipeEdgeStyleMode(edge) {
        return styleValue(edge && edge.style, "curved") === "1" ? PIPE_EDGE_STYLE_MODES.curved : PIPE_EDGE_STYLE_MODES.straight;
    }

    function pipeEdgeBaseStyleForMode(mode, baseStyle) {
        let style = String(baseStyle || PIPE_EDGE_BASE_STYLE);
        style = setStyleValue(style, "edgeStyle", "orthogonalEdgeStyle");
        style = setStyleValue(style, "rounded", "0");
        style = setStyleValue(style, "html", "1");
        return setStyleValue(style, "curved", mode === PIPE_EDGE_STYLE_MODES.curved ? "1" : "");
    }

    function setPipeEdgeStyleMode(edge, moduleCell, mode) {
        if (!edge || getCellAttr(edge, ATTRS.PIPE_EDGE, "") !== "1") return false;
        const resolvedModuleCell = moduleCell || findGardenModuleAncestor(edge);
        let style = pipeEdgeStyleForPart(resolvedModuleCell, getCellAttr(edge, ATTRS.PIPE_PART_ID, ""), pipeEdgeBaseStyleForMode(mode, edge.style || PIPE_EDGE_BASE_STYLE));
        if (isCompletedPartState(partStateForCell(edge))) style = setStyleValue(setStyleValue(style, "strokeColor", "#82b366"), "dashed", "1");
        return setCellStyle(edge, style);
    }

    function applyPipeEdgeStyle(edge, moduleCell, pipePartId, baseStyle) {
        return applyPipeEdgeLifecycleStyle(edge, moduleCell, baseStyle || PIPE_EDGE_BASE_STYLE);
    }

    function applyDirectLinkEdgeStyle(edge) {
        return setCellStyle(edge, preserveConnectionEdgeAnchorStyle(edge && edge.style, DIRECT_LINK_EDGE_STYLE)); // CHANGE
    }

    function buildCatalogPartForm(part, moduleCell, onCategoryChange) {
        const node = document.createElement("div");
        node.className = "trellis-irrigation-catalog-form";
        node.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px;";
        const fields = {};
        fields.moduleCell = moduleCell;
        fields.previousPart = part; // NEW
        const connectorOptions = catalogConnectorOptions(moduleCell);
        fields.id = { value: part.id };
        fields.name = addTextField(node, "Name", part.name);
        fields.category = addSelectField(node, "Category", PART_CATEGORIES, part.category, catalogCategoryLabel); // CHANGE
        fields.category.addEventListener("change", function () { if (onCategoryChange) onCategoryChange(readCatalogPartForm({ fields })); });
        fields.stockState = addSelectField(node, "Status", VALID_STOCK_STATES, stockStateForQuantity(part.stockQuantity)); // CHANGE
        fields.stockState.disabled = true;
        fields.stockQuantity = addTextField(node, "Stock", bomDisplayQuantityValue(part.stockQuantity, part, moduleCell)); // CHANGE
        fields.cost = addTextField(node, "Cost", part.cost);
        if (unitCostAppliesToCategory(part.category)) fields.unitCost = addTextField(node, "Unit cost per ft", part.unitCost);
        if (isLinearPipeStyleCategory(part.category)) { // CHANGE
            fields.pipeSize = addSelectField(node, "Pipe size", ensureOptionValue(connectorOptions.sizes, catalogPipeSize(part)), catalogPipeSize(part));
            if (part.category === "pipe_tubing") fields.innerDiameterIn = addTextField(node, "Pipe inner diameter in", part.specs.innerDiameterIn || ""); // CHANGE
            if (isSelfEmittingLinearCategory(part.category)) { // NEW
                fields.emitterFlowGph = addTextField(node, "Emitter flow gph", part.specs.emitterFlowGph || ""); // NEW
                fields.emitterSpacingIn = addTextField(node, "Emitter spacing in", part.specs.emitterSpacingIn || ""); // NEW
                fields.wettedWidthIn = addTextField(node, "Wetted width in", part.specs.wettedWidthIn || ""); // NEW
                fields.minOperatingPressurePsi = addTextField(node, "Min operating psi", part.specs.minOperatingPressurePsi || ""); // NEW
                fields.maxOperatingPressurePsi = addTextField(node, "Max operating psi", part.specs.maxOperatingPressurePsi || ""); // NEW
            } // NEW
        } else {
            fields.inputs = addTextField(node, "Inputs", part.connectors.inputs);
            fields.outputs = addTextField(node, "Outputs", part.connectors.outputs);
            fields.inputType = addSelectField(node, "Input type", ensureOptionValue(connectorOptions.types, part.connectors.input.type), part.connectors.input.type);
            fields.inputSize = addSelectField(node, "Input size", ensureOptionValue(connectorOptions.sizes, part.connectors.input.nominalSize), part.connectors.input.nominalSize);
            fields.outputType = addSelectField(node, "Output type", ensureOptionValue(connectorOptions.types, part.connectors.output.type), part.connectors.output.type);
            fields.outputSize = addSelectField(node, "Output size", ensureOptionValue(connectorOptions.sizes, part.connectors.output.nominalSize), part.connectors.output.nominalSize);
            fields.maxFlowGpm = addTextField(node, "Max flow gpm", part.connectors.output.maxFlowGpm || part.specs.maxFlowGpm || "");
            fields.pressureLossPsi = addTextField(node, "Pressure loss psi", part.specs.pressureLossPsi || "");
            fields.flowGpm = addTextField(node, "Part flow gpm", part.specs.flowGpm || "");
            if (BED_SELF_EMITTING_ROW_CATEGORIES.has(part.category)) fields.emitterSpacingIn = addTextField(node, "Emitter spacing in", part.specs.emitterSpacingIn || "");
            fields.minOperatingPressurePsi = addTextField(node, "Min operating psi", part.specs.minOperatingPressurePsi || "");
            fields.maxOperatingPressurePsi = addTextField(node, "Max operating psi", part.specs.maxOperatingPressurePsi || "");
            if (ANALYSIS_DEMAND_CATEGORIES.has(part.category)) appendCoverageCatalogFields(node, fields, part.specs); // NEW
        }
        return { node, fields };
    }

    function appendCoverageCatalogFields(node, fields, specs) { // NEW
        const source = specs || {}; // NEW
        fields.coveragePattern = addSelectField(node, "Coverage pattern", ["", "circle", "arc", "strip", "rectangle"], source.coveragePattern || "", coveragePatternLabel); // NEW
        fields.throwRadiusFt = addTextField(node, "Throw radius ft", source.throwRadiusFt || ""); // NEW
        fields.arcDegrees = addTextField(node, "Arc degrees", source.arcDegrees || ""); // NEW
        fields.coverageDirectionDeg = addTextField(node, "Coverage direction deg", source.coverageDirectionDeg || ""); // NEW
    } // NEW

    function coveragePatternLabel(pattern) { // NEW
        return pattern ? String(pattern).replace(/_/g, " ") : "none"; // NEW
    } // NEW

    function readCatalogPartForm(form) {
        const maxFlowGpm = form.fields.maxFlowGpm ? finiteNumber(form.fields.maxFlowGpm.value, null) : null;
        const category = form.fields.category.value;
        if (isLinearPipeStyleCategory(category)) { // CHANGE
            const pipeSize = String(form.fields.pipeSize && form.fields.pipeSize.value || form.fields.inputSize && form.fields.inputSize.value || form.fields.outputSize && form.fields.outputSize.value || "3/4").trim();
            return normalizeCatalogPart({
                id: sanitizeId(form.fields.id.value) || "part",
                name: form.fields.name.value.trim(),
                category,
                stockState: stockStateForQuantity(bomInputQuantityToCanonical(form.fields.stockQuantity && form.fields.stockQuantity.value, { category }, form.fields.moduleCell)),
                stockQuantity: bomInputQuantityToCanonical(form.fields.stockQuantity && form.fields.stockQuantity.value, { category }, form.fields.moduleCell),
                cost: finiteNumber(form.fields.cost.value, 0),
                unitCost: form.fields.unitCost ? finiteNumber(form.fields.unitCost.value, finiteNumber(form.fields.cost.value, 0)) : finiteNumber(form.fields.cost.value, 0),
                connectors: inferredLinearConnectors(form.fields.previousPart, pipeSize), // CHANGE
                specs: linearCatalogSpecsFromForm(form.fields, category) // CHANGE
            });
        }
        return normalizeCatalogPart({
            id: sanitizeId(form.fields.id.value) || "part",
            name: form.fields.name.value.trim(),
            category,
            stockState: stockStateForQuantity(bomInputQuantityToCanonical(form.fields.stockQuantity && form.fields.stockQuantity.value, { category }, form.fields.moduleCell)),
            stockQuantity: bomInputQuantityToCanonical(form.fields.stockQuantity && form.fields.stockQuantity.value, { category }, form.fields.moduleCell),
            cost: finiteNumber(form.fields.cost.value, 0),
            unitCost: unitCostAppliesToCategory(category) && form.fields.unitCost ? finiteNumber(form.fields.unitCost.value, finiteNumber(form.fields.cost.value, 0)) : null,
            connectors: {
                inputs: form.fields.inputs ? finiteNumber(form.fields.inputs.value, 1) : 1,
                outputs: form.fields.outputs ? finiteNumber(form.fields.outputs.value, 1) : 1,
                input: { type: form.fields.inputType ? form.fields.inputType.value.trim() : "barb", nominalSize: form.fields.inputSize ? form.fields.inputSize.value.trim() : (form.fields.pipeSize ? form.fields.pipeSize.value.trim() : "3/4") },
                output: { type: form.fields.outputType ? form.fields.outputType.value.trim() : "barb", nominalSize: form.fields.outputSize ? form.fields.outputSize.value.trim() : (form.fields.pipeSize ? form.fields.pipeSize.value.trim() : "3/4"), maxFlowGpm }
            },
            specs: {
                maxFlowGpm,
                pressureLossPsi: form.fields.pressureLossPsi ? finiteNumber(form.fields.pressureLossPsi.value, null) : null,
                flowGpm: form.fields.flowGpm ? finiteNumber(form.fields.flowGpm.value, null) : null,
                emitterSpacingIn: form.fields.emitterSpacingIn ? finiteNumber(form.fields.emitterSpacingIn.value, null) : null,
                minOperatingPressurePsi: form.fields.minOperatingPressurePsi ? finiteNumber(form.fields.minOperatingPressurePsi.value, null) : null,
                maxOperatingPressurePsi: form.fields.maxOperatingPressurePsi ? finiteNumber(form.fields.maxOperatingPressurePsi.value, null) : null,
                coveragePattern: form.fields.coveragePattern ? form.fields.coveragePattern.value : "", // NEW
                throwRadiusFt: form.fields.throwRadiusFt ? finiteNumber(form.fields.throwRadiusFt.value, null) : null, // NEW
                arcDegrees: form.fields.arcDegrees ? finiteNumber(form.fields.arcDegrees.value, null) : null, // NEW
                coverageDirectionDeg: form.fields.coverageDirectionDeg ? finiteNumber(form.fields.coverageDirectionDeg.value, null) : null, // NEW
                innerDiameterIn: null
            }
        });
    }

    function linearCatalogSpecsFromForm(fields, category) { // NEW
        if (category === "pipe_tubing") return { innerDiameterIn: fields.innerDiameterIn ? finiteNumber(fields.innerDiameterIn.value, null) : null }; // NEW
        return { // NEW
            emitterFlowGph: fields.emitterFlowGph ? finiteNumber(fields.emitterFlowGph.value, null) : null, // NEW
            emitterSpacingIn: fields.emitterSpacingIn ? finiteNumber(fields.emitterSpacingIn.value, null) : null, // NEW
            wettedWidthIn: fields.wettedWidthIn ? finiteNumber(fields.wettedWidthIn.value, null) : null, // NEW
            minOperatingPressurePsi: fields.minOperatingPressurePsi ? finiteNumber(fields.minOperatingPressurePsi.value, null) : null, // NEW
            maxOperatingPressurePsi: fields.maxOperatingPressurePsi ? finiteNumber(fields.maxOperatingPressurePsi.value, null) : null // NEW
        }; // NEW
    } // NEW

    function addTextField(parent, label, value) {
        const wrap = document.createElement("label");
        wrap.style.cssText = "display:flex;flex-direction:column;gap:3px;min-width:0;max-width:100%;box-sizing:border-box;overflow:hidden;";
        wrap.textContent = label;
        const input = document.createElement("input");
        input.value = value == null ? "" : String(value);
        input.style.cssText = "width:100%;min-width:0;max-width:100%;box-sizing:border-box;overflow:hidden;padding:4px;border:1px solid #aaa;border-radius:4px;";
        wrap.appendChild(input);
        parent.appendChild(wrap);
        return input;
    }

    function addNumericField(parent, label, value, options) {
        const input = addTextField(parent, label, value);
        input.type = "number";
        input.min = String(options && options.min != null ? options.min : 1);
        input.step = String(options && options.step != null ? options.step : 1);
        input.inputMode = options && options.inputMode || "decimal";
        return input;
    }

    function addCheckboxField(parent, label, value) {
        const wrap = document.createElement("label");
        wrap.style.cssText = "display:flex;align-items:center;gap:6px;";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = !!value;
        wrap.appendChild(input);
        wrap.appendChild(document.createTextNode(label));
        parent.appendChild(wrap);
        return input;
    }

    function addSelectField(parent, label, values, value, labeler) { // CHANGE
        const wrap = document.createElement("label");
        wrap.style.cssText = "display:flex;flex-direction:column;gap:3px;min-width:0;max-width:100%;box-sizing:border-box;overflow:hidden;";
        wrap.textContent = label;
        const select = document.createElement("select");
        values.forEach(function (entry) {
            const option = document.createElement("option");
            option.value = entry;
            option.textContent = labeler ? labeler(entry) : connectorTypeLabel(entry); // CHANGE
            select.appendChild(option);
        });
        select.value = value;
        select.style.cssText = "width:100%;min-width:0;max-width:100%;box-sizing:border-box;overflow:hidden;padding:4px;border:1px solid #aaa;border-radius:4px;";
        wrap.appendChild(select);
        parent.appendChild(wrap);
        return select;
    }

    function addPartSelectField(parent, label, parts, value) {
        const wrap = document.createElement("label");
        wrap.style.cssText = "display:flex;flex-direction:column;gap:3px;min-width:0;max-width:100%;box-sizing:border-box;overflow:hidden;";
        wrap.textContent = label;
        const select = document.createElement("select");
        appendPartSelectOptions(select, parts, { placeholder: "Choose part" }); // CHANGE
        select.value = value || "";
        select.style.cssText = "width:100%;min-width:0;max-width:100%;box-sizing:border-box;overflow:hidden;padding:4px;border:1px solid #aaa;border-radius:4px;";
        wrap.appendChild(select);
        parent.appendChild(wrap);
        return select;
    }

    function setPartSelectOptions(select, parts, value) {
        select.innerHTML = "";
        appendPartSelectOptions(select, parts, { placeholder: "Choose part" }); // CHANGE
        select.value = value || "";
        if (select.value !== (value || "")) select.value = "";
    }

    function appendPartSelectOptions(select, parts, options) { // NEW
        appendSelectOption(select, "", options && options.placeholder || "Choose part"); // NEW
        const grouped = groupedPartSelectOptions(parts, options); // NEW
        grouped.forEach(function (group) { // NEW
            const optgroup = document.createElement("optgroup"); // NEW
            optgroup.label = group.label; // NEW
            group.parts.forEach(function (part) { appendSelectOption(optgroup, part.id, part.name || part.id); }); // NEW
            select.appendChild(optgroup); // NEW
        }); // NEW
    } // NEW

    function groupedPartSelectOptions(parts, options) { // NEW
        const grouped = new Map(); // NEW
        (parts || []).forEach(function (part) { // NEW
            const label = partSelectGroupLabel(part, options); // NEW
            if (!grouped.has(label)) grouped.set(label, []); // NEW
            grouped.get(label).push(part); // NEW
        }); // NEW
        return Array.from(grouped.keys()).map(function (label) { return { label, parts: grouped.get(label) }; }); // NEW
    } // NEW

    function partSelectGroupLabel(part, options) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        const pieces = []; // NEW
        if (options && options.includeStock) pieces.push(addPartStockGroupLabel(p)); // NEW
        pieces.push(catalogCategoryLabel(p && p.category)); // NEW
        const fittingGroup = fittingIntentGroupForPart(part); // CHANGE
        if (fittingGroup) pieces.push(fittingGroup.label); // NEW
        const sizePairGroup = fittingSizePairGroupForPart(part); // NEW
        if (sizePairGroup) pieces.push(sizePairGroup.label); // NEW
        return pieces.filter(Boolean).join(" / "); // NEW
    } // NEW

    function preservePartSelectOption(moduleCell, parts, partId) {
        const selected = String(partId || "").trim();
        const base = (parts || []).slice();
        if (!selected || base.some(function (part) { return part && part.id === selected; })) return base;
        const catalogPart = partById(readCatalog(moduleCell), selected);
        base.push(catalogPart || { id: selected, name: selected });
        return base;
    }

    function catalogConnectorOptions(moduleCell) {
        const types = new Set(FIXED_CONNECTOR_TYPES);
        const sizes = new Set(FIXED_CONNECTOR_SIZES);
        readCatalog(moduleCell).items.map(normalizeCatalogPart).forEach(function (part) {
            if (!part || !part.connectors) return;
            [part.connectors.input, part.connectors.output].forEach(function (connector) {
                if (!connector) return;
                if (connector.type) types.add(connector.type);
                if (connector.nominalSize) sizes.add(connector.nominalSize);
            });
        });
        return {
            types: Array.from(types).sort(function (a, b) { return String(a).localeCompare(String(b)); }),
            sizes: Array.from(sizes).sort(compareNominalSize)
        };
    }

    function compareNominalSize(a, b) {
        return nominalSizeNumber(a) - nominalSizeNumber(b) || String(a).localeCompare(String(b));
    }

    function nominalSizeNumber(value) {
        const text = String(value || "");
        const parts = text.split("/");
        if (parts.length === 2) return finiteNumber(parts[0], 0) / Math.max(1, finiteNumber(parts[1], 1));
        return finiteNumber(text, 999);
    }

    function ensureOptionValue(values, value) {
        const out = (values || []).slice();
        if (value != null && value !== "" && out.indexOf(value) < 0) out.push(value);
        return out;
    }

    function broadCategoryForCatalogCategory(category) {
        const match = BROAD_CATALOG_CATEGORIES.find(function (entry) { return entry.categories.indexOf(category) >= 0; });
        return match || { id: "other", label: "Other", categories: [] };
    }

    function broadCategorySortOrder(broadCategoryId) { // NEW
        const index = BROAD_CATALOG_CATEGORIES.findIndex(function (entry) { return entry.id === broadCategoryId; }); // NEW
        return index < 0 ? BROAD_CATALOG_CATEGORIES.length : index; // NEW
    } // NEW

    function logicalCategoryInfoById(id) { // NEW
        return LOGICAL_CATALOG_CATEGORIES.find(function (entry) { return entry.id === id; }) || null; // NEW
    } // NEW

    function logicalCategorySortOrder(logicalCategoryId) { // NEW
        const index = LOGICAL_CATALOG_CATEGORIES.findIndex(function (entry) { return entry.id === logicalCategoryId; }); // NEW
        return index < 0 ? LOGICAL_CATALOG_CATEGORIES.length : index; // NEW
    } // NEW

    function logicalCategoryForPart(part) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        if (!p) return { id: "other", label: "Other", broadCategoryId: "other" }; // NEW
        if (p.category === "source_adapter") return logicalCategoryInfoById("source_adapters"); // NEW
        if (p.category === "pump") return logicalCategoryInfoById("pumps"); // NEW
        if (p.category === "backflow") return logicalCategoryInfoById("backflow"); // NEW
        if (p.category === "filter") return logicalCategoryInfoById("filters"); // NEW
        if (p.category === "regulator") return logicalCategoryInfoById("regulators"); // NEW
        if (p.category === "controller_timer") return logicalCategoryInfoById("timers"); // NEW
        if (p.category === "valve") return logicalCategoryInfoById("valves"); // NEW
        if (p.category === "manifold") return logicalCategoryInfoById("manifolds"); // NEW
        if (p.category === "cap_end") return logicalCategoryInfoById("end_caps"); // NEW
        if (p.category === "fitting") { // NEW
            const intent = fittingIntentGroupForPart(p); // NEW
            if (intent && intent.id === "end_line") return logicalCategoryInfoById("end_caps"); // NEW
            return fittingIsChangeSizePart(p) ? logicalCategoryInfoById("change_size") : logicalCategoryInfoById("fittings"); // NEW
        } // NEW
        if (p.category === "pipe_tubing") return logicalCategoryInfoById("pipe_tubing"); // NEW
        if (p.category === "drip_tape") return logicalCategoryInfoById("drip_tape"); // NEW
        if (p.category === "dripline") return logicalCategoryInfoById("dripline"); // NEW
        if (p.category === "emitter") return logicalCategoryInfoById("emitters"); // NEW
        if (p.category === "sprinkler") return logicalCategoryInfoById("sprinklers"); // NEW
        if (p.category === "microspray") return logicalCategoryInfoById("microsprays"); // NEW
        if (p.category === "bubbler") return logicalCategoryInfoById("bubblers"); // NEW
        if (p.category === "standpipe") return logicalCategoryInfoById("standpipes"); // NEW
        return { id: "other", label: "Other", broadCategoryId: "other" }; // NEW
    } // NEW

    function fittingIsChangeSizePart(part) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        if (!p || p.category !== "fitting") return false; // NEW
        const connectors = displayedFittingConnectorPair(p); // NEW
        const inputSize = connectors.input && connectors.input.nominalSize || ""; // NEW
        const outputSize = connectors.output && connectors.output.nominalSize || ""; // NEW
        return !!(inputSize && outputSize && inputSize !== outputSize); // NEW
    } // NEW

    function partDisplayCategory(part) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        const logical = logicalCategoryForPart(part); // NEW
        const broad = broadCategoryForCatalogCategory(logical && logical.broadCategoryId === "other" ? "" : p && p.category); // NEW
        return { // NEW
            broadId: logical && logical.broadCategoryId || broad.id, // NEW
            broadLabel: broadCategoryLabelForId(logical && logical.broadCategoryId || broad.id), // NEW
            logicalId: logical && logical.id || "other", // NEW
            logicalLabel: logical && logical.label || "Other", // NEW
            broadOrder: broadCategorySortOrder(logical && logical.broadCategoryId || broad.id), // NEW
            logicalOrder: logicalCategorySortOrder(logical && logical.id) // NEW
        }; // NEW
    } // NEW

    function broadCategoryLabelForId(id) { // NEW
        const match = BROAD_CATALOG_CATEGORIES.find(function (entry) { return entry.id === id; }); // NEW
        return match ? match.label : "Other"; // NEW
    } // NEW

    function logicalCategoriesForBroadCategoryFilter(broadCategoryId) { // NEW
        const broadId = String(broadCategoryId || "").trim(); // NEW
        return LOGICAL_CATALOG_CATEGORIES.filter(function (entry) { return !broadId || entry.broadCategoryId === broadId; }); // NEW
    } // NEW

    function normalizeBomCategoryFilterForBroadCategory(state) { // NEW
        if (!state || !state.broadCategoryFilter || !state.categoryFilter) return; // NEW
        if (!logicalCategoriesForBroadCategoryFilter(state.broadCategoryFilter).some(function (entry) { return entry.id === state.categoryFilter; })) state.categoryFilter = ""; // NEW
    } // NEW

    function appendBomCategoryFilterOptions(select, broadCategoryId, visibleLogicalIds) { // NEW
        const visible = new Set(visibleLogicalIds || []); // NEW
        appendSelectOption(select, "", "All categories"); // NEW
        logicalCategoriesForBroadCategoryFilter(broadCategoryId).forEach(function (entry) { // NEW
            if (!visible.size || visible.has(entry.id)) appendSelectOption(select, entry.id, entry.label); // NEW
        }); // NEW
    } // NEW

    function categoriesForBroadCategoryFilter(broadCategoryId) { // NEW
        const broadId = String(broadCategoryId || "").trim(); // NEW
        if (!broadId) return PART_CATEGORIES.slice(); // NEW
        const match = BROAD_CATALOG_CATEGORIES.find(function (entry) { return entry.id === broadId; }); // NEW
        if (!match) return []; // NEW
        return PART_CATEGORIES.filter(function (category) { return match.categories.indexOf(category) >= 0; }); // NEW
    } // NEW

    function normalizeCategoryFilterForBroadCategory(state) { // NEW
        if (!state || !state.broadCategoryFilter || !state.categoryFilter) return; // NEW
        if (categoriesForBroadCategoryFilter(state.broadCategoryFilter).indexOf(state.categoryFilter) < 0) state.categoryFilter = ""; // NEW
    } // NEW

    function appendCategoryFilterOptions(select, broadCategoryId) { // NEW
        appendSelectOption(select, "", "All categories"); // NEW
        categoriesForBroadCategoryFilter(broadCategoryId).forEach(function (category) { appendSelectOption(select, category, catalogCategoryLabel(category)); }); // NEW
    } // NEW

    function appendCatalogCategoryOptions(select, categories) { // NEW
        appendSelectOption(select, "", "All categories"); // NEW
        (categories || []).forEach(function (category) { appendSelectOption(select, category, catalogCategoryLabel(category)); }); // NEW
    } // NEW

    function catalogBroadCategoryLabel(part) {
        return broadCategoryForCatalogCategory(normalizeCatalogPart(part).category).label;
    }

    function fittingIntentGroupForPart(part) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        if (!p || p.category !== "fitting") return null; // NEW
        const connectors = displayedFittingConnectorPair(part); // CHANGE
        const inputConnector = connectors.input; // CHANGE
        const outputConnector = connectors.output; // CHANGE
        const inputs = Math.max(0, finiteNumber(p.connectors && p.connectors.inputs, 0)); // NEW
        const outputs = Math.max(0, finiteNumber(p.connectors && p.connectors.outputs, 0)); // NEW
        const text = normalizeSearchText([p.id, p.name].filter(Boolean).join(" ")); // NEW
        const inputType = normalizeConnectorType(inputConnector.type); // NEW
        const outputType = normalizeConnectorType(outputConnector.type); // NEW
        const inputSize = inputConnector.nominalSize || ""; // NEW
        const outputSize = outputConnector.nominalSize || ""; // NEW
        if (outputs <= 0 || /\b(?:cap|plug|end)\b/.test(text)) return fittingIntentGroupById("end_line"); // NEW
        if (outputs > 1 || /\b(?:tee|splitter|wye|branch)\b/.test(text)) return fittingIntentGroupById("branch"); // NEW
        if (/\b(?:elbow|90|45|turn)\b/.test(text)) return fittingIntentGroupById("turn"); // NEW
        if (isThreadLikeConnectorType(inputType) || isThreadLikeConnectorType(outputType)) return fittingIntentGroupById("thread_adapters"); // NEW
        if (inputType && outputType && inputType !== outputType) return fittingIntentGroupById("connector_adapters"); // NEW
        if (inputSize && outputSize && inputSize !== outputSize) return fittingIntentGroupById("change_size"); // NEW
        if (inputs === 1 && outputs === 1 && inputType && outputType && inputType === outputType && inputSize === outputSize) return fittingIntentGroupById("continue"); // NEW
        return fittingIntentGroupById("other"); // NEW
    } // NEW

    function fittingIntentGroupById(id) { // NEW
        return FITTING_INTENT_GROUPS.find(function (group) { return group.id === id; }) || FITTING_INTENT_GROUPS[FITTING_INTENT_GROUPS.length - 1]; // NEW
    } // NEW

    function isThreadLikeConnectorType(type) { // NEW
        return ["mght", "fght", "mpt", "fpt"].indexOf(normalizeConnectorType(type)) >= 0; // NEW
    } // NEW

    function fittingSizePairGroupForPart(part) { // NEW
        const intent = fittingIntentGroupForPart(part); // NEW
        if (!intent || intent.id !== "change_size" && intent.id !== "thread_adapters") return null; // NEW
        if (intent.id === "thread_adapters") return fittingThreadPairGroupForPart(part); // CHANGE
        const pair = fittingSizePairLabel(part); // NEW
        return pair ? { id: sanitizeId(pair) || "size_pair", label: pair, sizes: fittingSizePairSortSizes(part) } : null; // CHANGE
    } // NEW

    function fittingThreadPairGroupForPart(part) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        if (!p || p.category !== "fitting") return null; // NEW
        const connectors = displayedFittingConnectorPair(part); // NEW
        const endpoints = [fittingThreadPairEndpoint(connectors.input), fittingThreadPairEndpoint(connectors.output)]; // NEW
        if (endpoints.some(function (endpoint) { return !endpoint; })) return null; // NEW
        endpoints.sort(compareFittingThreadPairEndpoints); // NEW
        const label = endpoints.map(function (endpoint) { return endpoint.label; }).join(" <-> "); // NEW
        return { id: sanitizeId(label) || "thread_pair", label, sizes: endpoints.map(function (endpoint) { return endpoint.size; }), threadTypes: endpoints.map(function (endpoint) { return endpoint.threadType; }) }; // NEW
    } // NEW

    function fittingThreadPairEndpoint(connector) { // NEW
        const c = normalizeConnectorRecord(connector); // NEW
        if (!c.nominalSize) return null; // NEW
        const threadType = isThreadLikeConnectorType(c.type) ? connectorPartTypeName(c.type) : ""; // NEW
        return { size: c.nominalSize, threadType, label: c.nominalSize + (threadType ? " " + threadType : "") }; // NEW
    } // NEW

    function compareFittingThreadPairEndpoints(a, b) { // NEW
        return compareNominalSize(a.size, b.size) || a.threadType.localeCompare(b.threadType) || a.label.localeCompare(b.label); // NEW
    } // NEW

    function fittingSizePairLabel(part) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        if (!p || p.category !== "fitting") return ""; // NEW
        const connectors = displayedFittingConnectorPair(part); // NEW
        const sizes = [connectors.input && connectors.input.nominalSize, connectors.output && connectors.output.nominalSize].filter(Boolean); // NEW
        if (sizes.length < 2) return ""; // NEW
        const sorted = sizes.slice().sort(compareNominalSize); // NEW
        return sorted[0] === sorted[1] ? sorted[0] : sorted[0] + " <-> " + sorted[1]; // NEW
    } // NEW

    function fittingSizePairSortSizes(part) { // NEW
        const connectors = displayedFittingConnectorPair(part); // NEW
        const sizes = [connectors.input && connectors.input.nominalSize, connectors.output && connectors.output.nominalSize].filter(Boolean).sort(compareNominalSize); // NEW
        return sizes.length >= 2 ? sizes : []; // NEW
    } // NEW

    function displayedFittingConnectorPair(part) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        const inputConnector = normalizeConnectorRecord(p && p.connectors && p.connectors.input); // NEW
        const outputConnector = normalizeConnectorRecord(p && p.connectors && p.connectors.output); // NEW
        const flipped = !!(part && (part.connectionFlipped || part.flipped)); // NEW
        return flipped ? { input: outputConnector, output: inputConnector } : { input: inputConnector, output: outputConnector }; // NEW
    } // NEW

    function catalogPartSizes(part) {
        const p = normalizeCatalogPart(part);
        const sizes = new Set();
        if (p.connectors && p.connectors.input && p.connectors.input.nominalSize) sizes.add(p.connectors.input.nominalSize);
        if (p.connectors && p.connectors.output && p.connectors.output.nominalSize) sizes.add(p.connectors.output.nominalSize);
        return Array.from(sizes).sort(compareNominalSize);
    }

    function catalogPartSizeLabel(part) {
        const sizes = catalogPartSizes(part);
        return sizes.length ? sizes.join(", ") : "none";
    }

    function catalogPartConnectorTypes(part) {
        const p = normalizeCatalogPart(part);
        const types = new Set();
        if (p.connectors && p.connectors.input && p.connectors.input.type) types.add(p.connectors.input.type);
        if (p.connectors && p.connectors.output && p.connectors.output.type) types.add(p.connectors.output.type);
        return Array.from(types).sort(function (a, b) { return String(a).localeCompare(String(b)); });
    }

    function catalogPartConnectorTypeLabel(part) {
        const types = catalogPartConnectorTypes(part);
        return types.length ? types.map(connectorTypeLabel).join(", ") : "none";
    }

    function catalogPartConnectionCount(part) {
        const p = normalizeCatalogPart(part);
        return Math.max(0, finiteNumber(p.connectors && p.connectors.inputs, 0)) + Math.max(0, finiteNumber(p.connectors && p.connectors.outputs, 0));
    }

    function catalogConnectionLabel(part) {
        const count = catalogPartConnectionCount(part);
        return count + " total";
    }

    function contextualCatalogFilterOptions(parts, state) { // NEW
        return {
            broadCategories: catalogFilterOptionsForParts(catalogFilterPartsExcept(parts, state, "broadCategoryFilter")).broadCategories, // NEW
            categories: catalogFilterOptionsForParts(catalogFilterPartsExcept(parts, state, "categoryFilter")).categories, // NEW
            sizes: catalogFilterOptionsForParts(catalogFilterPartsExcept(parts, state, "sizeFilter")).sizes, // NEW
            connectorTypes: catalogFilterOptionsForParts(catalogFilterPartsExcept(parts, state, "connectorTypeFilter")).connectorTypes, // NEW
            connectionCounts: catalogFilterOptionsForParts(catalogFilterPartsExcept(parts, state, "connectionFilter")).connectionCounts // NEW
        }; // NEW
    } // NEW

    function catalogFilterPartsExcept(parts, state, exceptFilter) { // NEW
        return (parts || []).filter(function (part) { return catalogPartMatchesFilters(part, state || {}, exceptFilter); }); // NEW
    } // NEW

    function catalogFilterOptions(catalog) { // NEW
        return catalogFilterOptionsForParts(catalog && catalog.items || []); // NEW
    } // NEW

    function catalogFilterOptionsForParts(parts) { // CHANGE
        const broadIds = new Set();
        const categories = new Set(); // NEW
        const logicalCategoryIds = new Set(); // NEW
        const sizes = new Set();
        const connectorTypes = new Set(); // CHANGE
        const connectionCounts = new Set();
        (parts || []).map(normalizeCatalogPart).forEach(function (part) { // CHANGE
            if (!part) return;
            broadIds.add(broadCategoryForCatalogCategory(part.category).id);
            categories.add(part.category); // NEW
            logicalCategoryIds.add(partDisplayCategory(part).logicalId); // NEW
            catalogPartSizes(part).forEach(function (size) { sizes.add(size); });
            catalogPartConnectorTypes(part).forEach(function (type) { connectorTypes.add(type); });
            connectionCounts.add(catalogPartConnectionCount(part));
        });
        return {
            broadCategories: BROAD_CATALOG_CATEGORIES.concat([{ id: "other", label: "Other", categories: [] }]).filter(function (entry) { return broadIds.has(entry.id); }),
            categories: PART_CATEGORIES.filter(function (category) { return categories.has(category); }), // NEW
            logicalCategories: LOGICAL_CATALOG_CATEGORIES.filter(function (entry) { return logicalCategoryIds.has(entry.id); }), // NEW
            sizes: Array.from(sizes).sort(compareNominalSize),
            connectorTypes: Array.from(connectorTypes).sort(function (a, b) { return String(a).localeCompare(String(b)); }),
            connectionCounts: Array.from(connectionCounts).sort(function (a, b) { return a - b; })
        };
    }

    function catalogPartMatchesFilters(part, state, exceptFilter) { // CHANGE
        const p = normalizeCatalogPart(part);
        if (exceptFilter !== "categoryFilter" && state.categoryFilter && p.category !== state.categoryFilter) return false; // CHANGE
        if (exceptFilter !== "broadCategoryFilter" && state.broadCategoryFilter && broadCategoryForCatalogCategory(p.category).id !== state.broadCategoryFilter) return false; // CHANGE
        if (exceptFilter !== "sizeFilter" && state.sizeFilter && catalogPartSizes(p).indexOf(state.sizeFilter) < 0) return false; // CHANGE
        if (exceptFilter !== "connectorTypeFilter" && state.connectorTypeFilter && catalogPartConnectorTypes(p).indexOf(state.connectorTypeFilter) < 0) return false; // CHANGE
        if (exceptFilter !== "connectionFilter" && state.connectionFilter && String(catalogPartConnectionCount(p)) !== String(state.connectionFilter)) return false; // CHANGE
        return true;
    }

    function catalogPartSortKey(part) {
        const p = normalizeCatalogPart(part);
        const size = p && p.connectors && p.connectors.output && p.connectors.output.nominalSize || p && p.connectors && p.connectors.input && p.connectors.input.nominalSize || "";
        const display = partDisplayCategory(p);
        return { category: p && p.category || "", broadOrder: display.broadOrder, logicalOrder: display.logicalOrder, subtypeOrder: catalogPartDisplaySubtypeOrder(p), size, name: p && p.name || p && p.id || "" }; // CHANGE
    }

    function catalogPartDisplaySubtypeOrder(part) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        const display = partDisplayCategory(p); // NEW
        if (display.logicalId === "end_caps" && p && p.category === "fitting") return 1; // NEW
        return 0; // NEW
    } // NEW

    function catalogGroupLabel(part) {
        const key = catalogPartSortKey(part);
        return catalogCategoryLabel(key.category) + " / " + (key.size || "no output size"); // CHANGE
    }

    function sortCatalogParts(parts) {
        return (parts || []).slice().sort(function (a, b) {
            const ka = catalogPartSortKey(a);
            const kb = catalogPartSortKey(b);
            return compareCatalogPartSortKeys(ka, kb); // CHANGE
        });
    }

    function compareCatalogPartSortKeys(a, b) { // NEW
        return (a.broadOrder - b.broadOrder) || (a.logicalOrder - b.logicalOrder) || ((a.subtypeOrder || 0) - (b.subtypeOrder || 0)) || compareNominalSize(a.size, b.size) || a.name.localeCompare(b.name); // CHANGE
    } // NEW

    function sortRawCatalogParts(parts) { // NEW
        return (parts || []).slice().sort(function (a, b) { // NEW
            const ka = catalogPartRawSortKey(a); // NEW
            const kb = catalogPartRawSortKey(b); // NEW
            return ka.category.localeCompare(kb.category) || compareNominalSize(ka.size, kb.size) || ka.name.localeCompare(kb.name); // NEW
        }); // NEW
    } // NEW

    function catalogPartRawSortKey(part) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        const size = p && p.connectors && p.connectors.output && p.connectors.output.nominalSize || p && p.connectors && p.connectors.input && p.connectors.input.nominalSize || ""; // NEW
        return { category: p && p.category || "", size, name: p && p.name || p && p.id || "" }; // NEW
    } // NEW

    function openIrrigationMode(moduleCell, options) {
        const selection = graph.getSelectionCell && graph.getSelectionCell();
        const targetModule = moduleCell || findGardenModuleAncestor(selection) || selection;
        irrigationDebug("openIrrigationMode:start", {
            selection: debugCellSummary(selection),
            requestedModule: debugCellSummary(moduleCell),
            targetModule: debugCellSummary(targetModule),
            options: options || {}
        });
        if (!targetModule || !isGardenModule(targetModule)) {
            irrigationDebug("openIrrigationMode:invalid-module", { targetModule: debugCellSummary(targetModule) });
            alertUser("Select a Trellis garden module first.");
            return null;
        }
        seedStarterCatalogIfEmpty(targetModule);
        closeWizardSessionForModeSwitch();
        closeIrrigationMode();
        removeHudNode(inactiveEntryOverlay);
        inactiveEntryOverlay = null;
        activeIrrigationMode = {
            moduleCell: targetModule,
            hud: null,
            navigator: [],
            targetHighlights: [],
            analysisOverlays: [], // NEW
            warningBadges: [],
            portBadges: [],
            portBadgeNodeByKey: new Map(),
            connectionBadgeNodeByKey: new Map(),
            inlineActionNodes: [],
            zoneBadges: [],
            selectedPorts: [],
            selectedBoundaries: [],
            inlineActionAnchorPort: null,
            lastModelPoint: null,
            preservePortSelectionOnNextGraphSelection: false,
            partPickerVisible: false,
            bedAssemblyPickerVisible: false,
            sourceFormVisible: !!(options && options.sourceForm),
            analysisMode: options && options.analysisMode === ANALYSIS_MODE_ANALYSIS ? ANALYSIS_MODE_ANALYSIS : ANALYSIS_MODE_BUILD, // NEW
            analysisZoneId: "", // NEW
            message: "",
            frontedBedAssemblyId: "",
            selectionLayeringGuard: false,
            dragCandidate: null, // CHANGE
            dragStartPoint: null, // CHANGE
            suppressHudDuringDrag: false, // CHANGE
            listeners: []
        };
        installIrrigationModeListeners(activeIrrigationMode);
        const entrySelection = irrigationModeEntrySelection(activeIrrigationMode, selection, options);
        if (entrySelection) selectCell(entrySelection, false);
        if (options && options.message) activeIrrigationMode.message = options.message;
        if (options && options.preserveViewport) irrigationDebug("openIrrigationMode:preserve-viewport", { targetModule: debugCellSummary(targetModule) });
        else {
            try {
                frameIrrigationWorkspace(targetModule);
            } catch (err) {
                irrigationDebug("openIrrigationMode:frame-error", { message: err && err.message, stack: err && err.stack });
            }
        }
        renderIrrigationMode(activeIrrigationMode);
        dispatchIrrigationModeChanged();
        scheduleIrrigationDebugSnapshot(activeIrrigationMode, "openIrrigationMode:post-render-async");
        return activeIrrigationMode;
    }

    function closeIrrigationMode() {
        const session = activeIrrigationMode;
        if (!session) return;
        if (isIrrigationModeClosing(session)) return;
        closingIrrigationModeSession = session;
        session.closing = true;
        try {
            if (activeConnectionComboboxClose) activeConnectionComboboxClose(false);
            removeHudNode(session.hud);
            session.hud = null;
            removeNodeList(session.navigator);
            removeNodeList(session.targetHighlights);
            removeNodeList(session.analysisOverlays); // NEW
            removeNodeList(session.warningBadges);
            removeNodeList(session.portBadges);
            removeNodeList(session.inlineActionNodes);
            removeNodeList(session.zoneBadges);
            removeIrrigationControlLayerChildren();
            clearIrrigationDragState(session); // CHANGE
            if (session.frontedBedAssemblyId) { reorderIrrigationModuleLayering(session.moduleCell); session.frontedBedAssemblyId = ""; }
            removeIrrigationModeListeners(session);
            activeIrrigationMode = null;
        } finally {
            closingIrrigationModeSession = null;
            session.closing = false;
        }
        scheduleInactiveEntryOverlayRefresh();
        dispatchIrrigationModeChanged();
    }

    function isIrrigationModeClosing(session) {
        return !!(session && (session.closing || closingIrrigationModeSession === session));
    }

    function irrigationModeEntrySelection(session, selection, options) {
        if (options && options.selectCell && isIrrigationHudSelectionTarget(session, options.selectCell)) return options.selectCell;
        return isIrrigationHudSelectionTarget(session, selection) ? selection : session.moduleCell;
    }

    function closeWizardSessionForModeSwitch() {
        hideDialog();
    }

    function installIrrigationModeListeners(session) {
        const selectionModel = graph.getSelectionModel && graph.getSelectionModel();
        if (selectionModel && selectionModel.addListener && typeof mxEvent !== "undefined") {
            const listener = function () { syncSelectedBedAssemblyLayering(session); clearPortSelectionForGraphSelection(session); renderIrrigationMode(session); };
            selectionModel.addListener(mxEvent.CHANGE, listener);
            session.listeners.push({ target: selectionModel, event: mxEvent.CHANGE, listener });
        }
        if (graph.addListener && typeof mxEvent !== "undefined") {
            const mouseListener = function (_, evt) {
                updateSessionPointerFromMxEvent(session, evt);
                if (resolveGraphClickCell(evt)) { clearSelectedPortAndBoundaryState(session); renderIrrigationMode(session); }
            };
            graph.addListener(mxEvent.CLICK, mouseListener);
            session.listeners.push({ target: graph, event: mxEvent.CLICK, listener: mouseListener });
            const edgeAddListener = function (_, evt) { normalizeAddedIrrigationEdges(session, evt && evt.getProperty && evt.getProperty("cells") || []); };
            [mxEvent.CELLS_ADDED, mxEvent.ADD_CELLS].forEach(function (eventName) {
                if (!eventName) return;
                graph.addListener(eventName, edgeAddListener);
                session.listeners.push({ target: graph, event: eventName, listener: edgeAddListener });
            });
            const cellRemoveListener = function (_, evt) { handleRemovedIrrigationCells(session, evt && evt.getProperty && evt.getProperty("cells") || []); };
            [mxEvent.CELLS_REMOVED, mxEvent.REMOVE_CELLS].forEach(function (eventName) {
                if (!eventName) return;
                graph.addListener(eventName, cellRemoveListener);
                session.listeners.push({ target: graph, event: eventName, listener: cellRemoveListener });
            });
        }
        if (model.addListener && typeof mxEvent !== "undefined") {
            const replayRefreshListener = function () { renderIrrigationMode(session); };
            [mxEvent.UNDO, mxEvent.REDO].forEach(function (eventName) {
                if (!eventName) return;
                model.addListener(eventName, replayRefreshListener);
                session.listeners.push({ target: model, event: eventName, listener: replayRefreshListener });
            });
        }
        if (graph.addMouseListener) {
            const mouseListener = {
                mouseDown: function (_, evt) { updateSessionPointerFromMouseEvent(session, evt); beginIrrigationDragCandidate(session, evt); }, // CHANGE
                mouseMove: function (_, evt) { updateSessionPointerFromMouseEvent(session, evt); updateIrrigationDragSuppression(session, evt); }, // CHANGE
                mouseUp: function (_, evt) {
                    updateSessionPointerFromMouseEvent(session, evt);
                    finishIrrigationDragSuppression(session); // CHANGE
                }
            };
            graph.addMouseListener(mouseListener);
            session.listeners.push({ target: graph, mouseListener });
        }
        if (typeof window !== "undefined" && window.addEventListener) { // CHANGE
            const globalDragEndListener = function () { finishIrrigationDragSuppression(session); }; // CHANGE
            ["mouseup", "pointerup", "blur"].forEach(function (eventName) { // CHANGE
                window.addEventListener(eventName, globalDragEndListener); // CHANGE
                session.listeners.push({ domTarget: window, event: eventName, listener: globalDragEndListener }); // CHANGE
            }); // CHANGE
        } // CHANGE
        const view = graph.view;
        if (view && view.addListener && typeof mxEvent !== "undefined") {
            const viewListener = function () { renderIrrigationMode(session); };
            [mxEvent.SCALE, mxEvent.TRANSLATE, mxEvent.SCALE_AND_TRANSLATE].forEach(function (eventName) {
                if (!eventName) return;
                view.addListener(eventName, viewListener);
                session.listeners.push({ target: view, event: eventName, listener: viewListener });
            });
        }
    }

    function removeIrrigationModeListeners(session) {
        (session.listeners || []).forEach(function (entry) {
            if (entry.mouseListener && entry.target && entry.target.removeMouseListener) entry.target.removeMouseListener(entry.mouseListener);
            if (entry.listener && entry.target && entry.target.removeListener) entry.target.removeListener(entry.listener);
            if (entry.listener && entry.domTarget && entry.domTarget.removeEventListener) entry.domTarget.removeEventListener(entry.event, entry.listener); // CHANGE
        });
        session.listeners = [];
    }

    function beginIrrigationDragCandidate(session, evt, options) { // CHANGE
        clearIrrigationDragState(session); // CHANGE
        if (!session || activeIrrigationMode !== session) return false; // CHANGE
        const target = options && options.targetCell ? options.targetCell : resolveMouseEventCell(evt); // CHANGE
        if (!target || !isIrrigationHudSelectionTarget(session, target)) return false; // CHANGE
        const explicitDragCells = options && Array.isArray(options.dragCells) && options.dragCells.length ? options.dragCells : null; // CHANGE
        const selectedCells = explicitDragCells || currentSelectionCells(); // CHANGE
        const dragSelection = selectedCells.length ? selectedCells : [target]; // CHANGE
        if (dragSelection.length > 1 && !dragSelection.some(function (cell) { return cell === target || getCellId(cell) === getCellId(target); })) return false; // CHANGE
        if (!dragSelection.length || !dragSelection.every(function (cell) { return isIrrigationHudSelectionTarget(session, cell); })) return false; // CHANGE
        const point = mouseEventClientPoint(evt); // CHANGE
        if (!point) return false; // CHANGE
        session.dragCandidate = target; // CHANGE
        session.dragStartPoint = point; // CHANGE
        return true; // CHANGE
    } // CHANGE

    function updateIrrigationDragSuppression(session, evt) { // CHANGE
        if (!session || activeIrrigationMode !== session || !session.dragCandidate || session.suppressHudDuringDrag) return false; // CHANGE
        const start = session.dragStartPoint; // CHANGE
        const point = mouseEventClientPoint(evt); // CHANGE
        if (!start || !point) return false; // CHANGE
        const dx = point.x - start.x; // CHANGE
        const dy = point.y - start.y; // CHANGE
        if (Math.sqrt(dx * dx + dy * dy) < IRRIGATION_DRAG_SUPPRESS_THRESHOLD_PX) return false; // CHANGE
        session.suppressHudDuringDrag = true; // CHANGE
        removeIrrigationModeOverlayNodes(session); // CHANGE
        return true; // CHANGE
    } // CHANGE

    function finishIrrigationDragSuppression(session) { // CHANGE
        if (!session) return false; // CHANGE
        const wasSuppressed = !!session.suppressHudDuringDrag; // CHANGE
        clearIrrigationDragState(session); // CHANGE
        if (wasSuppressed && activeIrrigationMode === session) renderIrrigationMode(session); // CHANGE
        return wasSuppressed; // CHANGE
    } // CHANGE

    function beginHudDragSuppression(targetCell, evt, dragCells) { // CHANGE
        return beginIrrigationDragCandidate(activeIrrigationMode, evt, { targetCell, dragCells: dragCells && dragCells.length ? dragCells : [targetCell] }); // CHANGE
    } // CHANGE

    function updateHudDragSuppression(evt) { // CHANGE
        return updateIrrigationDragSuppression(activeIrrigationMode, evt); // CHANGE
    } // CHANGE

    function finishHudDragSuppression() { // CHANGE
        return finishIrrigationDragSuppression(activeIrrigationMode); // CHANGE
    } // CHANGE

    function clearIrrigationDragState(session) { // CHANGE
        if (!session) return; // CHANGE
        session.dragCandidate = null; // CHANGE
        session.dragStartPoint = null; // CHANGE
        session.suppressHudDuringDrag = false; // CHANGE
    } // CHANGE

    function mouseEventClientPoint(evt) { // CHANGE
        const domEvent = evt && evt.getEvent ? evt.getEvent() : evt; // CHANGE
        if (!domEvent) return null; // CHANGE
        if (typeof mxEvent !== "undefined" && mxEvent.getClientX && mxEvent.getClientY) return { x: mxEvent.getClientX(domEvent), y: mxEvent.getClientY(domEvent) }; // CHANGE
        if (domEvent.clientX != null && domEvent.clientY != null) return { x: Number(domEvent.clientX), y: Number(domEvent.clientY) }; // CHANGE
        return null; // CHANGE
    } // CHANGE

    function resolveGraphClickCell(evt) {
        if (!evt) return null;
        if (evt.getProperty) {
            const cell = evt.getProperty("cell");
            if (cell) return cell;
            return resolveDomEventCell(evt.getProperty("event"));
        }
        return resolveMouseEventCell(evt);
    }

    function resolveMouseEventCell(evt) {
        if (!evt) return null;
        if (evt.getCell) return evt.getCell();
        if (evt.getState && evt.getState()) return evt.getState().cell || null;
        return resolveDomEventCell(evt.getEvent && evt.getEvent());
    }

    function resolveDomEventCell(domEvent) {
        if (!domEvent || !graph.getCellAt || !graph.container || typeof mxUtils === "undefined" || !mxUtils.convertPoint || typeof mxEvent === "undefined") return null;
        const point = mxUtils.convertPoint(graph.container, mxEvent.getClientX(domEvent), mxEvent.getClientY(domEvent));
        return graph.getCellAt(point.x, point.y);
    }

    function updateSessionPointerFromMxEvent(session, evt) {
        if (!evt || !evt.getProperty) return;
        updateSessionPointerFromDomEvent(session, evt.getProperty("event"));
    }

    function updateSessionPointerFromMouseEvent(session, evt) {
        if (!evt) return;
        updateSessionPointerFromDomEvent(session, evt.getEvent ? evt.getEvent() : evt);
    }

    function updateSessionPointerFromDomEvent(session, domEvent) {
        if (!session || !domEvent || typeof mxUtils === "undefined" || typeof mxEvent === "undefined" || !graph.container) return;
        const pt = mxUtils.convertPoint(graph.container, mxEvent.getClientX(domEvent), mxEvent.getClientY(domEvent));
        const scale = finiteNumber(graph.view && graph.view.scale, 1) || 1;
        const translate = graph.view && graph.view.translate ? graph.view.translate : { x: 0, y: 0 };
        const modelPoint = { x: pt.x / scale - finiteNumber(translate.x, 0), y: pt.y / scale - finiteNumber(translate.y, 0) };
        session.lastModelPoint = modelPointToModulePoint(session.moduleCell, modelPoint);
    }

    function modelPointToModulePoint(moduleCell, modelPoint) {
        const moduleBounds = cellBoundsInModel(moduleCell) || { x: 0, y: 0 };
        return { x: Math.max(0, Math.round(finiteNumber(modelPoint && modelPoint.x, 24) - finiteNumber(moduleBounds.x, 0))), y: Math.max(0, Math.round(finiteNumber(modelPoint && modelPoint.y, 72) - finiteNumber(moduleBounds.y, 0))) };
    }

    function defaultAssemblyAnchor(session) {
        if (session && session.lastModelPoint) return session.lastModelPoint;
        const moduleGeo = getGeometry(session && session.moduleCell) || {};
        return { x: Math.max(24, finiteNumber(moduleGeo.width, 400) / 2 - ASSEMBLY_DEFAULT_WIDTH / 2), y: 72 };
    }

    function currentSelectionCells() {
        return graph.getSelectionCells ? (graph.getSelectionCells() || []) : (graph.getSelectionCell && graph.getSelectionCell() ? [graph.getSelectionCell()] : []);
    }

    function getActiveIrrigationModule() {
        return activeIrrigationMode && activeIrrigationMode.moduleCell || null;
    }

    function isIrrigationModeActive(moduleCell) {
        if (!activeIrrigationMode) return false;
        return !moduleCell || activeIrrigationMode.moduleCell === moduleCell || getCellId(activeIrrigationMode.moduleCell) === getCellId(moduleCell);
    }

    function dispatchIrrigationModeChanged() {
        if (typeof window === "undefined" || !window.dispatchEvent) return;
        try {
            const detail = { active: !!activeIrrigationMode, moduleCellId: getCellId(getActiveIrrigationModule()) || "" };
            const EventCtor = window.CustomEvent || window.Event;
            if (EventCtor) window.dispatchEvent(new EventCtor(MODE_CHANGED_EVENT, { detail }));
        } catch (_) { }
    }

    function cellBelongsToIrrigationSession(session, cell) {
        if (!session || !cell) return false;
        if (cell === session.moduleCell || getCellId(cell) === getCellId(session.moduleCell)) return true;
        return findGardenModuleAncestor(cell) === session.moduleCell || getCellId(findGardenModuleAncestor(cell)) === getCellId(session.moduleCell);
    }

    function isIrrigationHudSelectionTarget(session, cell) {
        if (!session || !cell || !cellBelongsToIrrigationSession(session, cell)) return false;
        return isGardenModule(cell) || isGardenBed(cell) || isAssemblyModeObject(cell) || isHudIrrigationObject(cell) || isHudPipeEdge(cell);
    }

    function currentSelectionIsIrrigationHudEligible(session) {
        const cells = currentSelectionCells();
        return cells.length > 0 && cells.every(function (cell) { return isIrrigationHudSelectionTarget(session, cell); });
    }

    function selectedAssemblyContextCells() {
        const seen = new Set();
        const out = [];
        currentSelectionCells().forEach(function (cell) {
            if (!isAssemblyModeObject(cell) && !isLifecyclePartTargetCell(cell)) return;
            const id = getCellId(cell);
            if (!id || seen.has(id)) return;
            seen.add(id);
            out.push(cell);
        });
        return out;
    }

    function reorderIrrigationModuleLayering(moduleCell) {
        const tiler = typeof window !== "undefined" && window.USL && window.USL.tiler;
        if (!tiler || typeof tiler.reorderModuleChildrenForLayering !== "function") return;
        const run = function () { tiler.reorderModuleChildrenForLayering(model, moduleCell); };
        (graph.__withUndoSuppressed || function (fn) { return fn(); }).call(graph, run);
    }

    function syncSelectedBedAssemblyLayering(session) {
        if (!session || session.selectionLayeringGuard) return;
        const selected = graph.getSelectionCell && graph.getSelectionCell();
        const selectedBedAssembly = isBedAssembly(selected) ? selected : null;
        const selectedId = getCellId(selectedBedAssembly) || "";
        if (session.frontedBedAssemblyId === selectedId) return;
        session.selectionLayeringGuard = true;
        try {
            if (session.frontedBedAssemblyId) reorderIrrigationModuleLayering(session.moduleCell);
            session.frontedBedAssemblyId = "";
            if (!selectedBedAssembly || !graph.orderCells) return;
            (graph.__withUndoSuppressed || function (fn) { return fn(); }).call(graph, function () { graph.orderCells(false, [selectedBedAssembly]); });
            session.frontedBedAssemblyId = selectedId;
        } finally { session.selectionLayeringGuard = false; }
    }

    function shieldHudEvents(hud) {
        ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "wheel", "keydown", "keypress", "keyup", "beforeinput", "input", "compositionstart", "compositionupdate", "compositionend"].forEach(function (eventName) {
            hud.addEventListener(eventName, function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); });
        });
    }

    function removeIrrigationModeOverlayNodes(session) { // CHANGE
        if (!session) return; // CHANGE
        if (activeConnectionComboboxClose) activeConnectionComboboxClose(false); // CHANGE
        removeHudNode(session.hud); // CHANGE
        session.hud = null; // CHANGE
        removeNodeList(session.navigator); // CHANGE
        removeNodeList(session.targetHighlights); // CHANGE
        removeNodeList(session.analysisOverlays); // NEW
        removeNodeList(session.warningBadges); // CHANGE
        removeNodeList(session.portBadges); // CHANGE
        removeNodeList(session.inlineActionNodes); // CHANGE
        removeNodeList(session.zoneBadges); // CHANGE
        removeIrrigationControlLayerChildren(); // CHANGE
        session.portBadgeNodeByKey = new Map(); // CHANGE
        session.connectionBadgeNodeByKey = new Map(); // CHANGE
    } // CHANGE

    function renderIrrigationMode(session) {
        if (!session || activeIrrigationMode !== session || isIrrigationModeClosing(session)) return;
        removeIrrigationModeOverlayNodes(session); // CHANGE
        if (session.suppressHudDuringDrag) return; // CHANGE

        const selected = graph.getSelectionCell && graph.getSelectionCell();
        const assemblySelection = selectedAssemblyContextCells();
        const inlineAction = resolveInlineConnectionAction(session);
        const hudEligible = currentSelectionIsIrrigationHudEligible(session);
        if (!hudEligible && !inlineAction) return;
        const connectionContext = inlineAction ? null : resolveSelectedConnectionContext(session);
        const bridgeSuggestionPorts = !connectionContext && !inlineAction ? selectedBridgeSuggestionPorts(session) : null; // CHANGE
        const portOnlyContext = !connectionContext && !inlineAction && !bridgeSuggestionPorts ? resolveSelectedFreePortOnlyContext(session) : null; // CHANGE
        const analysisView = session.analysisMode === ANALYSIS_MODE_ANALYSIS ? buildAnalysisView(session.moduleCell, { selectedCells: currentSelectionCells(), zoneId: session.analysisZoneId }) : null; // NEW
        if (analysisView) session.analysisZoneId = analysisView.activeZoneId; // NEW
        if (!inlineAction && hudEligible) {
            const hud = document.createElement("div");
            hud.className = "trellis-irrigation-mode-hud";
            hud.style.cssText = "position:absolute;z-index:1005;width:max-content;max-width:min(460px,calc(100vw - 32px));min-width:0;box-sizing:border-box;overflow:hidden;background:#fff;border:1px solid #777;border-radius:6px;box-shadow:0 3px 12px rgba(0,0,0,.22);padding:8px;font:12px Arial,sans-serif;color:#222;display:flex;flex-direction:column;gap:6px;pointer-events:auto;";
            shieldHudEvents(hud);
            if (analysisView) renderAnalysisHud(session, hud, analysisView); // NEW
            else if (connectionContext) renderConnectionHud(session, hud, connectionContext);
            else if (bridgeSuggestionPorts) renderBridgeSuggestionOnlyHud(session, hud, bridgeSuggestionPorts); // CHANGE
            else if (portOnlyContext) renderPortOnlyHud(session, hud, portOnlyContext);
            else if (assemblySelection.length) renderLocalIrrigationHud(session, hud, assemblySelection);
            else if (isGardenBed(selected)) renderGardenBedHud(session, hud, selected);
            else renderModuleIrrigationHud(session, hud);
            appendOverlayNode(hud);
            session.hud = hud;
            positionHudForSelection(hud, selected, session);
            irrigationDebug("renderIrrigationMode:hud", {
                selected: debugCellSummary(selected),
                isLocal: !!assemblySelection.length || isGardenBed(selected),
                className: hud.className,
                left: hud.style.left,
                top: hud.style.top,
                overlayHost: debugOverlayHostSummary()
            });
        } else session.hud = null;
        if (analysisView) { renderAnalysisOverlays(session, analysisView); return; } // NEW
        renderAssemblyPortBadges(session, assemblySelection);
        renderSelectedExternalPipeHighlights(session);
        renderZoneBadges(session);
        if (isHudIrrigationObject(selected)) renderIrrigationNavigator(session, selected);
        renderIrrigationWarningBadges(session);
        renderInlineConnectionAction(session, inlineAction);
    }

    function renderModuleIrrigationHud(session, hud) {
        hud.className += " trellis-irrigation-module-hud";
        appendIrrigationHudHeader(hud, session, "Irrigation Mode", { bomPartIds: [], syncBeforeBom: true });
        appendHudStatus(hud, session);
        const actions = hudActions();
        actions.appendChild(button("Create Source", function () {
            session.sourceFormVisible = true;
            session.partPickerVisible = false;
            renderIrrigationMode(session);
        }));
        actions.appendChild(button("Add Part", function () {
            session.partPickerVisible = true;
            session.sourceFormVisible = false;
            renderIrrigationMode(session);
        }));
        appendHudActionSection(hud, "Connections", actions);
        if (session.sourceFormVisible) renderSourceForm(session, hud);
        if (session.partPickerVisible) renderAddPartAssemblyForm(session, hud);
        appendModuleSummary(session, hud);
    }

    function renderAnalysisHud(session, hud, view) { // NEW
        hud.className += " trellis-irrigation-analysis-hud"; // NEW
        hud.style.width = "min(460px,calc(100vw - 32px))"; // NEW
        appendIrrigationHudHeader(hud, session, "Irrigation Analysis", { bomPartIds: [], syncBeforeBom: true }); // NEW
        appendHudStatus(hud, session); // NEW
        renderAnalysisZoneSelector(session, hud, view); // NEW
        renderAnalysisSummary(session, hud, view); // NEW
        renderAnalysisIssues(session, hud, view); // NEW
        renderAnalysisSelectedDetails(session, hud, view); // NEW
    } // NEW

    function renderAnalysisZoneSelector(session, hud, view) { // NEW
        const section = hudSection("Zone"); // NEW
        const select = document.createElement("select"); // NEW
        select.className = "trellis-irrigation-analysis-zone-select"; // NEW
        select.style.cssText = "width:100%;min-width:0;box-sizing:border-box;padding:4px;border:1px solid #aaa;border-radius:4px;background:#fff;"; // NEW
        (view.zoneOptions || []).forEach(function (option) { appendSelectOption(select, option.id, option.name); }); // NEW
        select.value = view.activeZoneId || ""; // NEW
        select.addEventListener("change", function () { session.analysisZoneId = select.value; renderIrrigationMode(session); }); // NEW
        section.appendChild(select); // NEW
        hud.appendChild(section); // NEW
    } // NEW

    function renderAnalysisSummary(session, hud, view) { // NEW
        const analysis = view.analysis || {}; // NEW
        const source = analysis.source; // NEW
        const profile = source ? endpointProfile(source) : null; // NEW
        const section = hudSection("Supply / Demand"); // NEW
        section.appendChild(hudText("Demand " + formatGpm(analysis.demandGpm) + ", required " + formatPsi(analysis.requiredPressurePsi) + ".")); // NEW
        section.appendChild(hudText(source ? ("Source " + endpointLabel(source) + ": " + formatGpm(profile && profile.usableFlowGpm) + ", " + formatPsi(profile && profile.staticPressurePsi) + ".") : "Source unknown.")); // NEW
        hud.appendChild(section); // NEW
    } // NEW

    function renderAnalysisIssues(session, hud, view) { // NEW
        const issues = view.analysis && view.analysis.issues || []; // NEW
        const section = hudSection("Issues"); // NEW
        if (!issues.length) section.appendChild(hudText("No analysis issues for the active zone.")); // NEW
        issues.slice(0, 8).forEach(function (issue) { // NEW
            const row = button(analysisIssuePrefix(issue) + issue.message, function () { const cell = findCellById(session.moduleCell, issue.cellId); if (cell) selectCell(cell, true); }); // NEW
            row.className += " trellis-irrigation-analysis-issue"; // NEW
            row.style.cssText += "justify-content:flex-start;text-align:left;width:100%;border-color:" + analysisIssueColor(issue) + ";color:" + analysisIssueColor(issue) + ";background:#fff;"; // NEW
            row.disabled = !issue.cellId; // NEW
            section.appendChild(row); // NEW
        }); // NEW
        if (issues.length > 8) section.appendChild(hudText((issues.length - 8) + " more issues on this zone.")); // NEW
        hud.appendChild(section); // NEW
    } // NEW

    function renderAnalysisSelectedDetails(session, hud, view) { // NEW
        const selected = graph.getSelectionCell && graph.getSelectionCell(); // NEW
        if (!selected) return; // NEW
        const selectedId = getCellId(selected) || ""; // NEW
        const analysis = view.analysis || {}; // NEW
        const pipe = (analysis.pipeLabels || []).find(function (row) { return row.edgeId === selectedId; }); // NEW
        const endpoint = (analysis.endpointLabels || []).find(function (row) { return row.cellId === selectedId || getCellId(findAssemblyAncestor(selected)) === row.cellId; }); // NEW
        if (!pipe && !endpoint) return; // NEW
        const section = hudSection("Selection"); // NEW
        if (pipe) section.appendChild(hudText("Pipe " + formatFeet(pipe.lengthFt) + ", " + formatGpm(pipe.flowGpm) + ", loss " + formatPsi(pipe.pressureLossPsi) + ".")); // NEW
        if (endpoint) section.appendChild(hudText(irrigationCellLabel(endpoint.cell) + ": " + formatGpm(endpoint.flowGpm) + ", delivered " + formatPsi(endpoint.deliveredPressurePsi) + ", margin " + formatPsi(endpoint.marginPsi) + ".")); // NEW
        hud.appendChild(section); // NEW
    } // NEW

    function analysisIssuePrefix(issue) { // NEW
        if (issue && issue.severity === "error") return "Error: "; // NEW
        if (issue && issue.severity === "warning") return "Warning: "; // NEW
        return "Unknown: "; // NEW
    } // NEW

    function analysisIssueColor(issue) { // NEW
        if (issue && issue.severity === "error") return "#b91c1c"; // NEW
        if (issue && issue.severity === "warning") return "#92400e"; // NEW
        return "#374151"; // NEW
    } // NEW

    function formatGpm(value) { // NEW
        const n = finiteNumber(value, null); // NEW
        return n == null ? "unknown gpm" : n.toFixed(n >= 10 ? 1 : 2).replace(/\.0+$/, "") + " gpm"; // NEW
    } // NEW

    function formatPsi(value) { // NEW
        const n = finiteNumber(value, null); // NEW
        return n == null ? "unknown PSI" : n.toFixed(Math.abs(n) >= 10 ? 1 : 2).replace(/\.0+$/, "") + " PSI"; // NEW
    } // NEW

    function renderSourceSelector(session, hud) {
        const sources = collectHudEndpoints(session.moduleCell, "source");
        if (!sources.length) return;
        const wrap = document.createElement("label");
        wrap.style.cssText = "display:flex;flex-direction:column;gap:3px;margin:6px 0;";
        wrap.textContent = "Select Source";
        const select = document.createElement("select");
        select.className = "trellis-irrigation-source-picker";
        appendSelectOption(select, "", "Choose source");
        sources.forEach(function (source) { appendSelectOption(select, getCellId(source), endpointLabel(source)); });
        select.addEventListener("change", function () {
            const source = findCellById(session.moduleCell, select.value);
            if (!source) return;
            selectCell(source, false);
            renderIrrigationMode(session);
        });
        wrap.appendChild(select);
        hud.appendChild(wrap);
    }

    function renderGardenBedHud(session, hud, bedCell) {
        appendIrrigationHudHeader(hud, session, "Garden Bed", { bomPartIds: [] });
        appendHudStatus(hud, session);
        hud.appendChild(hudText("Create a bed assembly for template-driven irrigation estimates."));
        const actions = hudActions();
        actions.appendChild(button("Create Bed Assembly", function () {
            const created = runIrrigationEdit("createBedAssembly", function () { const result = createBedAssembly(session.moduleCell, bedCell, defaultAssemblyAnchor(session)); scheduleHudGraphStateSync(session.moduleCell); return result; });
            selectCell(created.assembly, false);
            renderIrrigationMode(session);
        }));
        appendHudActionSection(hud, "Connections", actions);
    }

    function renderConnectionHud(session, hud, context) {
        hud.className += " trellis-irrigation-connection-hud";
        const lifecycleSelection = context.edge && getCellAttr(context.edge, ATTRS.PIPE_EDGE, "") === "1" ? [context.edge] : [];
        appendIrrigationHudHeader(hud, session, "Connection", { selected: lifecycleSelection, bomPartIds: context.pipePartId ? [context.pipePartId] : [] });
        appendHudStatus(hud, session);
        const route = hudText(connectionRouteLabel(context));
        route.style.fontWeight = "700";
        route.style.overflowWrap = "anywhere";
        hud.appendChild(route);
        hud.appendChild(hudText(connectionSummaryLabel(session.moduleCell, context)));
        appendPipeEdgeStyleControls(session, hud, context);
        const connectionActions = hudActions();
        connectionActions.appendChild(button("Select Upstream", function () { selectConnectionEndpoint(session, context.sourceCell); }));
        connectionActions.appendChild(button("Select Downstream", function () { selectConnectionEndpoint(session, context.targetCell); }));
        appendHudActionSection(hud, "Connections", connectionActions);
        appendHudDangerAction(hud, "Disconnect", function () { disconnectSelectedConnections(session, [context.boundary]); });
    }

    function resolveSelectedFreePortOnlyContext(session) {
        const ports = selectedValidPorts(session);
        if (ports.length !== 1 || selectedValidBoundaries(session).length) return null;
        const port = ports[0];
        if (!isPortFree(session.moduleCell, port)) return null;
        const cell = portCell(session.moduleCell, port);
        if (!cell) return null;
        const bedAssembly = isAssembly(cell) && assemblyType(cell) === "bed" ? cell : null;
        return { port, cell, bedAssembly };
    }

    function renderPortOnlyHud(session, hud, context) {
        hud.className += " trellis-irrigation-port-only-hud";
        hud.style.width = "min(320px,calc(100vw - 32px))";
        hud.style.maxWidth = "min(320px,calc(100vw - 32px))";
        appendPortOnlyHudHeader(hud, portOnlyTitle(session.moduleCell, context));
        if (context.bedAssembly) renderBedPortOnlySelector(session, hud, context.bedAssembly, context.port);
        else renderPartPortOnlySelector(session, hud, context.cell, context.port);
    }

    function renderBridgeSuggestionOnlyHud(session, hud, orderedPorts) { // CHANGE
        hud.className += " trellis-irrigation-suggest-only-hud"; // CHANGE
        hud.style.width = "min(360px,calc(100vw - 32px))"; // CHANGE
        hud.style.maxWidth = "min(360px,calc(100vw - 32px))"; // CHANGE
        session.bridgePorts = orderedPorts; // CHANGE
        appendPortOnlyHudHeader(hud, "Suggest Connection"); // CHANGE
        renderBridgeSuggestions(session, hud, orderedPorts, { hideTitle: true }); // CHANGE
    } // CHANGE

    function appendPortOnlyHudHeader(hud, titleText) {
        const header = document.createElement("div");
        header.className = "trellis-irrigation-hud-header trellis-irrigation-port-only-header";
        header.style.cssText = "border-bottom:1px solid #e5e7eb;padding-bottom:6px;margin-bottom:2px;min-width:0;max-width:100%;box-sizing:border-box;";
        const title = document.createElement("div");
        title.className = "trellis-irrigation-hud-header-title";
        title.style.cssText = "font-weight:700;min-width:0;max-width:100%;box-sizing:border-box;overflow:hidden;text-overflow:ellipsis;";
        title.textContent = String(titleText || "");
        header.appendChild(title);
        hud.appendChild(header);
    }

    function portOnlyTitle(moduleCell, context) {
        const port = normalizePort(context && context.port);
        const cell = context && context.cell;
        if (context && context.bedAssembly) {
            const partId = bedPortSelectedPartId(moduleCell, context.bedAssembly, port.role);
            const part = partId ? partById(readCatalog(moduleCell), partId) : null;
            return part ? (part.name || part.id) : portDisplayPrefix(moduleCell, port) + " " + (port.index + 1);
        }
        const part = partForCell(moduleCell, cell);
        if (part) return part.name || part.id || irrigationCellLabel(cell);
        return endpointType(cell) === "source" ? endpointLabel(cell) : irrigationCellLabel(cell);
    }

    function bedPortSelectedPartId(moduleCell, bedAssembly, role) {
        const saved = readBedAssemblyTemplateRecord(moduleCell, bedAssembly) || {};
        const roleParts = bedTemplateRolePartIds(saved);
        return role === "input" ? roleParts.inletPartId : roleParts.outletPartId;
    }

    function renderPartPortOnlySelector(session, hud, cell, port) {
        const section = hudSection(portDisplayPrefix(session.moduleCell, port) + " " + (port.index + 1));
        const wrap = document.createElement("div");
        wrap.className = "trellis-irrigation-port-only-connection-row";
        wrap.style.cssText = "display:flex;flex-direction:column;gap:5px;margin-top:4px;";
        wrap.appendChild(renderConnectionDropdown(session, { cell, role: port.role, index: port.index, boundaryOnly: false }));
        section.appendChild(wrap);
        hud.appendChild(section);
    }

    function renderBedPortOnlySelector(session, hud, bedAssembly, port) {
        const bedCell = bedCellForAssembly(session.moduleCell, bedAssembly);
        if (!bedCell) return;
        const saved = readBedAssemblyTemplateRecord(session.moduleCell, bedAssembly) || {};
        const draft = bedTemplateDraftFromSaved(session.moduleCell, bedAssembly, bedCell, saved);
        const role = normalizePort(port).role;
        const section = hudSection(portDisplayPrefix(session.moduleCell, port) + " " + (port.index + 1));
        const form = document.createElement("div");
        form.className = "trellis-irrigation-port-only-bed-form";
        form.style.cssText = "display:grid;gap:6px;min-width:0;max-width:100%;box-sizing:border-box;overflow:hidden;";
        const select = role === "input"
            ? addPartSelectField(form, "Inlet part", bedRolePartOptions(session.moduleCell, "input", draft.recipe.inletPartId, draft.templateId, draft.recipe.rowPartId, true), draft.recipe.inletPartId)
            : addPartSelectField(form, "Outlet part", bedOutletPartOptions(session.moduleCell, draft.bom.recipe && draft.bom.recipe.supplyPipePartId, draft.recipe.outletPartId, true), draft.recipe.outletPartId);
        select.addEventListener("change", function () {
            applyBedPortOnlyPartSelection(session, bedAssembly, bedCell, role, select.value);
        });
        section.appendChild(form);
        hud.appendChild(section);
    }

    function bedTemplateDraftFromSaved(moduleCell, bedAssembly, bedCell, saved) {
        const catalog = readCatalog(moduleCell);
        const templateId = saved.templateId || BED_TEMPLATES[0].id;
        const templateDef = bedTemplateById(templateId);
        const rowOrientation = normalizeBedRowOrientation(saved.rowOrientation, templateDef);
        const rows = saved.spacing && saved.spacing.rows != null ? saved.spacing.rows : (templateDef.defaultRows || 2);
        const recipe = normalizeBedRecipeInput(catalog, templateDef, saved);
        const bom = computeBedTemplateBom(catalog, getGeometry(bedAssembly) || getGeometry(bedCell) || {}, templateId, rows, rowOrientation, recipe);
        return { catalog, templateId, templateDef, rowOrientation, rows, recipe, bom };
    }

    function applyBedPortOnlyPartSelection(session, bedAssembly, bedCell, role, partId) {
        const saved = readBedAssemblyTemplateRecord(session.moduleCell, bedAssembly) || {};
        const draft = bedTemplateDraftFromSaved(session.moduleCell, bedAssembly, bedCell, saved);
        const recipe = Object.assign({}, draft.recipe);
        if (role === "input") recipe.inletPartId = String(partId || "").trim();
        else { recipe.outletPartId = String(partId || "").trim(); recipe.headerEndCapPartId = ""; }
        const bom = computeBedTemplateBom(draft.catalog, getGeometry(bedAssembly) || getGeometry(bedCell) || {}, draft.templateId, draft.rows, draft.rowOrientation, recipe);
        if (!validateBedPortOnlyDraft(recipe, bom).ok) { renderIrrigationMode(session); return; }
        runIrrigationEdit("applyBedPortOnlyPart", function () {
            writeBedPortConfig(bedCell, bedPortConfigFromRecipe(draft.catalog, readBedPortConfig(bedCell), recipe.inletPartId, recipe.outletPartId, recipe.rowPartId, bom.recipe && bom.recipe.supplyPipePartId));
            const path = firstAssemblyPathForBedAssembly(session.moduleCell, bedAssembly) || { id: "assembly_bed_" + sanitizeId(getCellId(bedCell)), targetBedId: getCellId(bedCell) || "" };
            commitBedTemplate(session.moduleCell, path.id, bedAssembly, {
                templateId: draft.templateId,
                templateModel: BED_TEMPLATE_MODEL_BOM,
                recipeVersion: BED_RECIPE_VERSION,
                irrigationType: bom.templateDef.lineKind,
                inletPartId: recipe.inletPartId,
                outletPartId: recipe.outletPartId,
                rowPartId: recipe.rowPartId,
                emitterPartId: bom.recipe && bom.recipe.selfEmitting ? "" : recipe.emitterPartId,
                rowTakeoffPartId: recipe.rowTakeoffPartId,
                rowEndCapPartId: recipe.rowEndCapPartId,
                headerEndCapPartId: recipe.outletPartId ? "" : recipe.headerEndCapPartId,
                supplyPipePartId: bom.recipe && bom.recipe.supplyPipePartId || "",
                partIds: uniqueStrings([recipe.inletPartId, recipe.outletPartId, recipe.rowPartId, recipe.emitterPartId, recipe.rowTakeoffPartId, recipe.rowEndCapPartId, recipe.headerEndCapPartId, bom.recipe && bom.recipe.supplyPipePartId]).filter(Boolean),
                rowOrientation: bom.rowOrientation,
                rowLengthMeters: bom.rowLengthMeters,
                rowSpacingCm: bom.rowSpacingCm,
                totalRowMeters: bom.totalRowMeters,
                requiredParts: bom.requiredParts,
                resolvedBomParts: bom.recipe && bom.recipe.resolvedBomParts || [],
                anchorPartId: bom.anchorPartId,
                demand: bom.demand,
                assemblyLabelMode: "",
                spacing: { rows: bom.rowCount, emitterInches: recipe.emitterSpacingIn, rowSpacingCm: bom.rowSpacingCm }
            });
            scheduleHudGraphStateSync(session.moduleCell);
        });
        renderIrrigationMode(session);
    }

    function validateBedPortOnlyDraft(recipe, bom) {
        if (!recipe.inletPartId) return { ok: false };
        if (!recipe.rowPartId || !bom.recipe || !bom.recipe.supplyPipePartId || !bom.anchorPartId) return { ok: false };
        if (!recipe.emitterPartId && !bom.recipe.selfEmitting) return { ok: false };
        if (!recipe.rowTakeoffPartId || !recipe.rowEndCapPartId) return { ok: false };
        if (!recipe.outletPartId && !recipe.headerEndCapPartId) return { ok: false };
        if (bom.missingPartIds.length) return { ok: false };
        return { ok: true };
    }

    function appendPipeEdgeStyleControls(session, hud, context) {
        if (!context || !context.edge || getCellAttr(context.edge, ATTRS.PIPE_EDGE, "") !== "1") return;
        const activeMode = pipeEdgeStyleMode(context.edge);
        const actions = hudActions();
        [PIPE_EDGE_STYLE_MODES.straight, PIPE_EDGE_STYLE_MODES.curved].forEach(function (mode) {
            const label = mode === PIPE_EDGE_STYLE_MODES.curved ? "Curved" : "Straight";
            const styleButton = button(label, function () {
                runIrrigationEdit("pipeEdgeStyle", function () { setPipeEdgeStyleMode(context.edge, session.moduleCell, mode); });
                renderIrrigationMode(session);
            });
            stylePipeEdgeStyleButton(styleButton, activeMode === mode);
            styleButton.setAttribute("aria-pressed", activeMode === mode ? "true" : "false");
            actions.appendChild(styleButton);
        });
        appendHudActionSection(hud, "Style", actions);
    }

    function selectConnectionEndpoint(session, cell) {
        session.selectedPorts = [];
        session.selectedBoundaries = [];
        session.inlineActionAnchorPort = null;
        session.focusedConnectionBoundary = null;
        selectCell(cell, false);
        renderIrrigationMode(session);
    }

    function connectionRouteLabel(context) {
        return irrigationCellLabel(context && context.sourceCell) + " -> " + irrigationCellLabel(context && context.targetCell);
    }

    function connectionPortsLabel(context) {
        const source = normalizePort(context && context.sourcePort);
        const target = normalizePort(context && context.targetPort);
        return "Outlet " + (source.index + 1) + " -> Inlet " + (target.index + 1);
    }

    function connectionSummaryLabel(moduleCell, context) {
        if (!context) return "Connection";
        if (context.kind === "internal") return "Internal connection";
        if (context.mode === "direct") return "Direct link";
        const pipe = partById(readCatalog(moduleCell), context.pipePartId);
        const length = context.lengthFt > 0 ? ", " + formatFeet(context.lengthFt) : "";
        return "Pipe: " + (pipe ? shortCatalogPartName(pipe) : "auto pipe") + length;
    }

    function formatFeet(value) {
        const n = finiteNumber(value, 0);
        if (!(n > 0)) return "";
        return n.toFixed(n >= 10 ? 1 : 2).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1") + " ft";
    }

    function renderLocalIrrigationHud(session, hud, cells) {
        const selected = cells || [];
        const primary = selected[0];
        const primaryAssembly = isAssembly(primary) ? primary : findAssemblyAncestor(primary);
        const primarySource = selected.length === 1 ? sourceEndpointForSelection(primary, primaryAssembly) : null;
        hud.className += " trellis-irrigation-local-hud";
        const headerTitle = primarySource ? createSourceTitleInput(session, primarySource, primaryAssembly) : (selected.length > 1 ? selected.length + " irrigation selections" : irrigationCellLabel(primary));
        appendIrrigationHudHeader(hud, session, headerTitle, { selected, bomPartIds: selectedCatalogPartIdsFromGraphSelection(session.moduleCell, readCatalog(session.moduleCell)) });
        appendHudStatus(hud, session);
        const warning = primary && !isAssembly(primary) ? cellWarning(session.moduleCell, primary) : "";
        if (warning) hud.appendChild(hudWarning(warning));
        session.bridgePorts = null;
        if (primarySource) renderSourceEditFields(session, hud, primarySource);
        if ((primary && endpointType(primary) === "bed") || (primaryAssembly && assemblyType(primaryAssembly) === "bed")) renderBedInletFields(session, hud, primaryAssembly || findAssemblyAncestor(primary));
        renderSelectedZoneControls(session, hud, selected);
        renderSelectedConnectionRows(session, hud, selected);
        const connectionDanger = renderSelectedConnectionActions(session, hud);
        const selectedParts = selectedAssemblyPartCells(selected);
        const selectedAssemblies = selected.filter(isAssembly);
        if (!appendLocalDeleteAction(session, hud, selected, selectedParts, selectedAssemblies) && connectionDanger) appendHudDangerAction(hud, connectionDanger.label, connectionDanger.fn);
    }

    function renderSourceForm(session, hud) {
        const form = document.createElement("div");
        form.className = "trellis-irrigation-source-form";
        form.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px;";
        const label = addTextField(form, "Label", "Water Source " + (collectHudEndpoints(session.moduleCell, "source").length + 1));
        const connectorOptions = catalogConnectorOptions(session.moduleCell);
        const type = addSelectField(form, "Connector", ensureOptionValue(connectorOptions.types, "barb"), "barb");
        const size = addSelectField(form, "Size", ensureOptionValue(connectorOptions.sizes, "3/4"), "3/4");
        const flow = addTextField(form, "Flow gpm", "5");
        const pressure = addTextField(form, "Static psi", "45");
        const commit = button("Commit Source", function () {
            const created = runIrrigationEdit("commitSource", function () { const result = createSourceAssembly(session.moduleCell, label.value.trim() || "Water Source", {
                connectorType: type.value.trim(),
                nominalSize: size.value.trim(),
                usableFlowGpm: finiteNumber(flow.value, 5),
                staticPressurePsi: finiteNumber(pressure.value, 45)
            }, defaultAssemblyAnchor(session)); scheduleHudGraphStateSync(session.moduleCell); return result; });
            session.sourceFormVisible = false;
            selectCell(created.assembly, false);
            renderIrrigationMode(session);
        });
        commit.className = "trellis-irrigation-commit-source";
        form.appendChild(commit);
        hud.appendChild(form);
    }

    function renderAddPartAssemblyForm(session, hud) {
        const form = document.createElement("div");
        form.className = "trellis-irrigation-add-assembly-form";
        form.style.cssText = "display:grid;gap:6px;margin-top:8px;min-width:0;max-width:100%;box-sizing:border-box;overflow:hidden;";
        const context = addPartPickerContext(session);
        form.appendChild(hudText(context ? "Compatible with " + addPartContextLabel(session.moduleCell, context) : "All catalog parts"));
        const select = document.createElement("select");
        select.className = "trellis-irrigation-add-part-picker";
        select.style.cssText = "width:100%;min-width:0;max-width:100%;box-sizing:border-box;overflow:hidden;";
        appendGroupedPartOptions(select, addPartPickerParts(session, context));
        form.appendChild(select);
        form.appendChild(button("Add Part", function () {
            const part = partById(readCatalog(session.moduleCell), select.value);
            if (!part) { session.message = "Choose a catalog part."; renderIrrigationMode(session); return; }
            const result = runIrrigationEdit("addPart", function () { const applied = context && context.row && context.row.bedPort ? applyBedPortPartChoice(session, context.row, part) : (context ? applyConnectionPartChoice(session.moduleCell, context.row, part) : null); if (context) { if (applied && applied.cell) scheduleHudGraphStateSync(session.moduleCell); return applied; } const createdPart = createPartAssembly(session.moduleCell, part, defaultAssemblyAnchor(session)); scheduleHudGraphStateSync(session.moduleCell); return { cell: createdPart.assembly, message: "" }; });
            if (context && (!result || !result.cell)) { session.message = result && result.message || "Part could not be added at the selected connection."; renderIrrigationMode(session); return; }
            const created = { assembly: findAssemblyAncestor(result.cell) || result.cell };
            session.partPickerVisible = false;
            selectCell(created.assembly, false);
            if (result && result.message) session.message = result.message;
            renderIrrigationMode(session);
        }));
        hud.appendChild(form);
    }

    function renderSelectedConnectionActions(session, hud) {
        const ports = selectedValidPorts(session);
        const selectedBoundaries = selectedOccupiedBoundaries(session, ports);
        if (!ports.length && !selectedBoundaries.length) {
            return null;
        }
        const occupied = ports.filter(function (port) { return !!boundaryForPort(session.moduleCell, port); });
        const free = ports.filter(function (port) { return isPortFree(session.moduleCell, port); });
        const actions = hudActions();
        const disconnectDanger = selectedBoundaries.length > 1 || occupied.length > 1 ? { label: "Disconnect", fn: function () { disconnectSelectedConnections(session, selectedBoundaries); } } : null;
        if (free.length === 2) {
            const ordered = orderedConnectionPorts(free);
            if (ordered) {
                const bridge = ConnectorRules.bridgeSuggestionEligibility(session.moduleCell, ordered.source, ordered.target);
                if (bridge.ok) actions.appendChild(button("Suggest Connection", function () { session.bridgePorts = ordered; renderIrrigationMode(session); }));
            }
        }
        appendHudActionSection(hud, "Connections", actions);
        if (session.bridgePorts && free.length === 2) renderBridgeSuggestions(session, hud, session.bridgePorts);
        return disconnectDanger;
    }

    function renderSelectedConnectionRows(session, hud, selectedCells) {
        const rows = selectedConnectionRowSpecs(session.moduleCell, selectedCells);
        if (!rows.length) return;
        const section = hudSection("Connections");
        const wrap = document.createElement("div");
        wrap.className = "trellis-irrigation-connection-rows";
        wrap.style.cssText = "display:flex;flex-direction:column;gap:5px;margin-top:4px;";
        rows.forEach(function (row) { renderConnectionRow(session, wrap, row); });
        section.appendChild(wrap);
        hud.appendChild(section);
    }

    function selectedConnectionRowSpecs(moduleCell, selectedCells) {
        if (!selectedCells || selectedCells.length !== 1) return [];
        const selected = selectedCells[0];
        const rows = [];
        if (isAssembly(selected)) {
            if (assemblyType(selected) === "bed") return rows;
            const first = firstAssemblyPart(selected);
            const last = lastAssemblyPart(selected);
            if (first) appendOccupiedOrFreeBoundaryPortRowSpecs(moduleCell, rows, first, "input");
            if (last) appendOccupiedOrFreeBoundaryPortRowSpecs(moduleCell, rows, last, "output");
            return rows;
        }
        if (isAssemblyPartCell(selected)) {
            appendPortRowSpecs(moduleCell, rows, selected, "input", false);
            appendPortRowSpecs(moduleCell, rows, selected, "output", false);
        }
        return rows;
    }

    function appendPortRowSpecs(moduleCell, rows, cell, role, boundaryOnly) {
        const count = portCapacityForCell(moduleCell, cell, role);
        for (let i = 0; i < count; i++) rows.push({ cell, role, index: i, boundaryOnly: !!boundaryOnly });
    }

    function appendOccupiedOrFreeBoundaryPortRowSpecs(moduleCell, rows, cell, role) {
        const count = portCapacityForCell(moduleCell, cell, role);
        for (let i = 0; i < count; i++) {
            const port = { cellId: getCellId(cell), role, index: i };
            if (edgesForPort(moduleCell, port).length || isPortFree(moduleCell, port)) rows.push({ cell, role, index: i, boundaryOnly: true });
        }
    }

    function renderConnectionRow(session, wrap, row) {
        const port = { cellId: getCellId(row.cell), role: row.role, index: row.index };
        const line = document.createElement("div");
        line.className = "trellis-irrigation-connection-row";
        line.style.cssText = "display:grid;grid-template-columns:72px minmax(110px,1fr);gap:6px;align-items:center;";
        const label = document.createElement("div");
        label.style.cssText = "font-weight:700;";
        label.textContent = portDisplayPrefix(session.moduleCell, row.cell, row.role) + " " + (row.index + 1); // CHANGE
        line.appendChild(label);
        const controls = document.createElement("div");
        controls.style.cssText = "display:flex;flex-direction:column;gap:3px;min-width:0;";
        const edge = edgesForPort(session.moduleCell, port)[0];
        const neighbor = internalNeighborForPort(row.cell, row.role);
        if (edge || neighbor) controls.appendChild(renderConnectionStatus(session, row, edge, neighbor));
        else controls.appendChild(renderConnectionDropdown(session, row));
        if (!edge && !neighbor) { const pipe = document.createElement("div"); pipe.className = "trellis-irrigation-pipe-row"; pipe.style.cssText = "font-size:11px;color:#4b5563;white-space:normal;"; pipe.textContent = connectionRowDetailLabel(session.moduleCell, row, edge, neighbor); controls.appendChild(pipe); }
        line.appendChild(controls);
        wrap.appendChild(line);
    }

    function renderConnectionDropdown(session, row) {
        const current = connectionRowCurrentLabel(session.moduleCell, row);
        const groups = connectionDropdownGroups(session.moduleCell, row);
        const safetyGroups = connectionComboboxSafetyGroups(groups);
        const hasParts = safetyGroups.some(function (group) { return group.parts.length > 0; });
        const root = document.createElement("div");
        root.className = "trellis-irrigation-connection-combobox trellis-irrigation-connection-dropdown";
        root.style.cssText = "position:relative;min-width:0;width:100%;max-width:100%;box-sizing:border-box;";
        const trigger = document.createElement("button");
        trigger.type = "button";
        trigger.className = "trellis-irrigation-connection-combobox-trigger";
        trigger.style.cssText = "min-width:0;width:100%;max-width:100%;padding:4px 22px 4px 6px;border:1px solid #aaa;border-radius:4px;background:#fff;color:#111827;text-align:left;box-sizing:border-box;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;position:relative;";
        trigger.textContent = hasParts ? (current || "No change") : "No compatible parts";
        trigger.setAttribute("aria-haspopup", "listbox");
        trigger.setAttribute("aria-expanded", "false");
        trigger.disabled = !hasParts;
        const chevron = document.createElement("span");
        chevron.textContent = "v";
        chevron.setAttribute("aria-hidden", "true");
        chevron.style.cssText = "position:absolute;right:7px;top:50%;transform:translateY(-50%);font-size:10px;color:#4b5563;";
        trigger.appendChild(chevron);
        root.appendChild(trigger);
        const state = { open: false, query: "", panel: null, search: null, list: null, activeIndex: -1, outsideListener: null, resizeListener: null, blurTimer: null };
        function closeMenu(focusTrigger) {
            if (!state.open) return;
            state.open = false;
            trigger.setAttribute("aria-expanded", "false");
            root.classList.remove("trellis-irrigation-connection-combobox-open");
            if (state.panel && state.panel.parentNode) state.panel.parentNode.removeChild(state.panel);
            state.panel = state.search = state.list = null;
            if (state.outsideListener) document.removeEventListener("mousedown", state.outsideListener);
            if (state.resizeListener && typeof window !== "undefined" && window.removeEventListener) { window.removeEventListener("resize", state.resizeListener); window.removeEventListener("scroll", state.resizeListener, true); }
            state.outsideListener = null;
            state.resizeListener = null;
            if (state.blurTimer) clearTimeout(state.blurTimer);
            state.blurTimer = null;
            if (activeConnectionComboboxClose === closeMenu) activeConnectionComboboxClose = null;
            if (focusTrigger && trigger.focus) trigger.focus();
        }
        function menuContainsNode(node) {
            return !!(node && (root.contains(node) || state.panel && state.panel.contains(node)));
        }
        function clearFocusLossClose() {
            if (state.blurTimer) clearTimeout(state.blurTimer);
            state.blurTimer = null;
        }
        function closeAfterFocusLoss() {
            clearFocusLossClose();
            state.blurTimer = setTimeout(function () { if (!menuContainsNode(document.activeElement)) closeMenu(false); }, 0);
        }
        function optionButtons() {
            return state.panel ? Array.from(state.panel.querySelectorAll(".trellis-irrigation-connection-combobox-option")) : [];
        }
        function focusOption(index) {
            const options = optionButtons();
            if (!options.length) return;
            state.activeIndex = Math.max(0, Math.min(index, options.length - 1));
            options[state.activeIndex].focus();
        }
        function moveOption(delta) {
            const options = optionButtons();
            if (!options.length) return;
            const next = state.activeIndex < 0 ? (delta > 0 ? 0 : options.length - 1) : (state.activeIndex + delta + options.length) % options.length;
            focusOption(next);
        }
        function choosePart(partId) {
            closeMenu(false);
            applyConnectionDropdownSelection(session, row, partId);
        }
        function focusCategoryButton(categoryKey) {
            if (!state.list || !categoryKey) return;
            const buttons = Array.from(state.list.querySelectorAll(".trellis-irrigation-connection-combobox-category,.trellis-irrigation-connection-combobox-fitting-subgroup,.trellis-irrigation-connection-combobox-fitting-size-pair")); // CHANGE
            const button = buttons.find(function (node) { return node.getAttribute("data-category-key") === categoryKey; });
            if (button && button.focus) button.focus();
        }
        function renderPartOption(groupNode, part, indentPx) { // NEW
            state.renderedPartsForList = (state.renderedPartsForList || 0) + 1; // CHANGE
            const option = document.createElement("button"); // NEW
            option.type = "button"; // NEW
            option.className = "trellis-irrigation-connection-combobox-option"; // NEW
            option.setAttribute("role", "option"); // NEW
            option.setAttribute("data-part-id", part.id); // NEW
            option.style.cssText = "display:flex;flex-direction:column;gap:1px;width:100%;padding:5px 8px 5px " + Math.max(18, indentPx || 18) + "px;border:0;border-top:1px solid #f3f4f6;background:#fff;color:#111827;text-align:left;box-sizing:border-box;cursor:pointer;"; // NEW
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
        } // NEW
        function renderFittingSubgroup(groupNode, groupId, subgroup, subgroupIndex, query) { // NEW
            const subgroupKey = connectionComboboxCategoryKey(groupId, "fitting:" + subgroup.id); // NEW
            const subgroupCollapsed = query ? false : connectionComboboxCategoryCollapsed(subgroupKey, subgroupIndex !== 0); // NEW
            const subgroupButton = document.createElement("button"); // NEW
            subgroupButton.type = "button"; // NEW
            subgroupButton.className = "trellis-irrigation-connection-combobox-fitting-subgroup"; // NEW
            subgroupButton.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:6px;width:100%;padding:4px 7px 4px 18px;border:0;border-top:1px solid #eef2f7;background:#fff;color:#4b5563;font-weight:700;text-align:left;box-sizing:border-box;cursor:pointer;"; // NEW
            subgroupButton.setAttribute("data-category-key", subgroupKey); // NEW
            subgroupButton.setAttribute("aria-expanded", subgroupCollapsed ? "false" : "true"); // NEW
            subgroupButton.textContent = (subgroupCollapsed ? "> " : "v ") + subgroup.label + " (" + subgroup.parts.length + ")"; // NEW
            subgroupButton.addEventListener("click", function () { // NEW
                clearFocusLossClose(); // NEW
                connectionComboboxSetCategoryCollapsed(subgroupKey, !subgroupCollapsed); // NEW
                renderList(subgroupKey); // NEW
            }); // NEW
            subgroupButton.addEventListener("keydown", function (ev) { // NEW
                if (ev.key === "ArrowDown") { ev.preventDefault(); focusOption(0); } // NEW
                else if (ev.key === "Escape") { ev.preventDefault(); closeMenu(true); } // NEW
            }); // NEW
            groupNode.appendChild(subgroupButton); // NEW
            if (!subgroupCollapsed) { // CHANGE
                if (subgroup.childGroups && subgroup.childGroups.length) subgroup.childGroups.forEach(function (childGroup, childIndex) { renderFittingSizePairGroup(groupNode, groupId, subgroup, childGroup, childIndex, query); }); // NEW
                if (subgroup.ungroupedParts && subgroup.ungroupedParts.length) subgroup.ungroupedParts.forEach(function (part) { renderPartOption(groupNode, part, 30); }); // NEW
                else if (!subgroup.childGroups || !subgroup.childGroups.length) subgroup.parts.forEach(function (part) { renderPartOption(groupNode, part, 30); }); // CHANGE
            } // CHANGE
        } // NEW
        function renderFittingSizePairGroup(groupNode, groupId, subgroup, childGroup, childIndex, query) { // NEW
            const childKey = connectionComboboxCategoryKey(groupId, "fitting:" + subgroup.id + ":" + childGroup.id); // NEW
            const childCollapsed = query ? false : connectionComboboxCategoryCollapsed(childKey, childIndex !== 0); // NEW
            const childButton = document.createElement("button"); // NEW
            childButton.type = "button"; // NEW
            childButton.className = "trellis-irrigation-connection-combobox-fitting-size-pair"; // NEW
            childButton.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:6px;width:100%;padding:4px 7px 4px 30px;border:0;border-top:1px solid #f3f4f6;background:#fff;color:#6b7280;font-weight:700;text-align:left;box-sizing:border-box;cursor:pointer;"; // NEW
            childButton.setAttribute("data-category-key", childKey); // NEW
            childButton.setAttribute("aria-expanded", childCollapsed ? "false" : "true"); // NEW
            childButton.textContent = (childCollapsed ? "> " : "v ") + childGroup.label + " (" + childGroup.parts.length + ")"; // NEW
            childButton.addEventListener("click", function () { // NEW
                clearFocusLossClose(); // NEW
                connectionComboboxSetCategoryCollapsed(childKey, !childCollapsed); // NEW
                renderList(childKey); // NEW
            }); // NEW
            childButton.addEventListener("keydown", function (ev) { // NEW
                if (ev.key === "ArrowDown") { ev.preventDefault(); focusOption(0); } // NEW
                else if (ev.key === "Escape") { ev.preventDefault(); closeMenu(true); } // NEW
            }); // NEW
            groupNode.appendChild(childButton); // NEW
            if (!childCollapsed) childGroup.parts.forEach(function (part) { renderPartOption(groupNode, part, 42); }); // NEW
        } // NEW
        function renderList(focusCategoryKey) {
            if (!state.list) return;
            state.list.innerHTML = "";
            const query = normalizeSearchText(state.query);
            state.renderedPartsForList = 0; // CHANGE
            safetyGroups.forEach(function (group) {
                const categories = connectionComboboxCategoryGroups(group.parts, query);
                if (!categories.length) return;
                const groupNode = document.createElement("div");
                groupNode.className = "trellis-irrigation-connection-combobox-safety-group trellis-irrigation-connection-combobox-safety-" + group.id;
                const groupLabel = document.createElement("div");
                groupLabel.className = "trellis-irrigation-connection-combobox-safety-label";
                groupLabel.style.cssText = "padding:5px 7px;font-weight:700;color:" + (group.id === "disconnect" ? "#7f1d1d" : "#14532d") + ";background:" + (group.id === "disconnect" ? "#fee2e2" : "#dcfce7") + ";border-top:1px solid #e5e7eb;";
                groupLabel.textContent = group.label;
                groupNode.appendChild(groupLabel);
                categories.forEach(function (category, categoryIndex) {
                    const categoryKey = connectionComboboxCategoryKey(group.id, category.category);
                    const collapsed = query ? false : connectionComboboxCategoryCollapsed(categoryKey, categoryIndex !== 0);
                    const categoryButton = document.createElement("button");
                    categoryButton.type = "button";
                    categoryButton.className = "trellis-irrigation-connection-combobox-category";
                    categoryButton.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:6px;width:100%;padding:5px 7px;border:0;border-top:1px solid #e5e7eb;background:#f9fafb;color:#374151;font-weight:700;text-align:left;box-sizing:border-box;cursor:pointer;";
                    categoryButton.setAttribute("data-category-key", categoryKey);
                    categoryButton.setAttribute("aria-expanded", collapsed ? "false" : "true");
                    categoryButton.textContent = (collapsed ? "> " : "v ") + catalogCategoryLabel(category.category) + " (" + category.parts.length + ")";
                    categoryButton.addEventListener("click", function () {
                        clearFocusLossClose();
                        connectionComboboxSetCategoryCollapsed(categoryKey, !collapsed);
                        renderList(categoryKey);
                    });
                    categoryButton.addEventListener("keydown", function (ev) {
                        if (ev.key === "ArrowDown") { ev.preventDefault(); focusOption(0); }
                        else if (ev.key === "Escape") { ev.preventDefault(); closeMenu(true); }
                    });
                    groupNode.appendChild(categoryButton);
                    if (!collapsed) {
                        if (category.subgroups && category.subgroups.length) category.subgroups.forEach(function (subgroup, subgroupIndex) { renderFittingSubgroup(groupNode, group.id, subgroup, subgroupIndex, query); }); // CHANGE
                        else category.parts.forEach(function (part) { renderPartOption(groupNode, part, 18); }); // CHANGE
                    }
                });
                state.list.appendChild(groupNode);
            });
            if (!state.renderedPartsForList && query) { // CHANGE
                const empty = document.createElement("div");
                empty.className = "trellis-irrigation-connection-combobox-empty";
                empty.style.cssText = "padding:7px;color:#6b7280;";
                empty.textContent = "No matching parts";
                state.list.appendChild(empty);
            }
            state.activeIndex = -1;
            focusCategoryButton(focusCategoryKey);
        }
        function openMenu(focusSearch) {
            if (state.open || !hasParts) return;
            if (activeConnectionComboboxClose) activeConnectionComboboxClose(false);
            state.open = true;
            activeConnectionComboboxClose = closeMenu;
            trigger.setAttribute("aria-expanded", "true");
            root.classList.add("trellis-irrigation-connection-combobox-open");
            const panel = document.createElement("div");
            panel.className = "trellis-irrigation-connection-combobox-panel";
            panel.style.cssText = "position:fixed;z-index:2000;border:1px solid #9ca3af;border-radius:4px;background:#fff;box-shadow:0 6px 18px rgba(0,0,0,.25);overflow:auto;box-sizing:border-box;";
            const search = document.createElement("input");
            search.className = "trellis-irrigation-connection-combobox-search";
            search.type = "search";
            search.placeholder = "Search parts";
            search.value = state.query;
            search.style.cssText = "position:sticky;top:0;z-index:1;width:100%;min-width:0;box-sizing:border-box;padding:6px 7px;border:0;border-bottom:1px solid #d1d5db;outline:none;";
            const list = document.createElement("div");
            list.className = "trellis-irrigation-connection-combobox-list";
            list.setAttribute("role", "listbox");
            panel.appendChild(search);
            panel.appendChild(list);
            connectionComboboxPanelHost().appendChild(panel);
            state.panel = panel;
            state.search = search;
            state.list = list;
            shieldHudEvents(panel);
            search.addEventListener("input", function () { state.query = search.value; renderList(); });
            search.addEventListener("keydown", function (ev) {
                if (ev.key === "ArrowDown") { ev.preventDefault(); focusOption(0); }
                else if (ev.key === "ArrowUp") { ev.preventDefault(); focusOption(optionButtons().length - 1); }
                else if (ev.key === "Escape") { ev.preventDefault(); closeMenu(true); }
                else if (ev.key === "Enter") { const options = optionButtons(); if (options.length) { ev.preventDefault(); options[0].click(); } }
            });
            panel.addEventListener("mousedown", function (ev) { if (ev.stopPropagation) ev.stopPropagation(); });
            panel.addEventListener("focusout", closeAfterFocusLoss);
            state.outsideListener = function (ev) { if (!menuContainsNode(ev.target)) closeMenu(false); };
            state.resizeListener = function () { positionConnectionComboboxPanel(root, trigger, panel); };
            document.addEventListener("mousedown", state.outsideListener);
            if (typeof window !== "undefined" && window.addEventListener) { window.addEventListener("resize", state.resizeListener); window.addEventListener("scroll", state.resizeListener, true); }
            renderList();
            positionConnectionComboboxPanel(root, trigger, panel);
            if (focusSearch && search.focus) search.focus();
        }
        root.addEventListener("focusout", closeAfterFocusLoss);
        trigger.addEventListener("click", function () { state.open ? closeMenu(false) : openMenu(true); });
        trigger.addEventListener("keydown", function (ev) {
            if (ev.key === "ArrowDown" || ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); openMenu(true); }
            else if (ev.key === "Escape") { ev.preventDefault(); closeMenu(true); }
        });
        return root;
    }

    function renderConnectionStatus(session, row, edge, neighbor) {
        const status = document.createElement("div");
        status.className = "trellis-irrigation-connection-status";
        status.style.cssText = "min-width:0;width:100%;padding:3px 4px;border:1px solid #d1d5db;border-radius:4px;background:#f9fafb;color:#374151;box-sizing:border-box;overflow-wrap:anywhere;";
        status.textContent = connectionRowCurrentLabel(session.moduleCell, row);
        status.title = edge || neighbor ? "Connected. Disconnect before changing this connection." : "";
        return status;
    }

    function connectionRowDetailLabel(moduleCell, row, edge, neighbor) {
        if (edge) return pipeEdgeLabel(moduleCell, edge, { cellId: getCellId(row.cell), role: row.role, index: row.index });
        if (neighbor) return "Internal connection: " + internalConnectionDisplayLabel(moduleCell, row.role === "output" ? row.cell : neighbor, row.role === "output" ? neighbor : row.cell);
        return pipeEdgeLabel(moduleCell, null, { cellId: getCellId(row.cell), role: row.role, index: row.index });
    }

    function appendConnectionOptionGroup(select, label, parts) {
        if (!parts.length) return;
        const group = document.createElement("optgroup");
        group.label = label;
        parts.forEach(function (part) { appendSelectOption(group, part.id, part.name); });
        select.appendChild(group);
    }

    function connectionComboboxSafetyGroups(groups) {
        return [
            { id: "keep", label: "Keeps connection", parts: sortConnectionComboboxParts(groups.keep || []) },
            { id: "disconnect", label: "Disconnects existing connection", parts: sortConnectionComboboxParts(groups.disconnect || []) }
        ];
    }

    function connectionComboboxPanelHost() {
        return document && document.body ? document.body : graph.container;
    }

    function positionConnectionComboboxPanel(root, trigger, panel) {
        if (!root || !trigger || !panel || !panel.parentNode) return;
        const viewportWidth = typeof window !== "undefined" && window.innerWidth || document.documentElement && document.documentElement.clientWidth || graph.container && graph.container.clientWidth || 1000;
        const viewportHeight = typeof window !== "undefined" && window.innerHeight || document.documentElement && document.documentElement.clientHeight || graph.container && graph.container.clientHeight || 700;
        const margin = 8;
        const triggerRect = trigger.getBoundingClientRect ? trigger.getBoundingClientRect() : { left: 0, right: 320, top: 0, bottom: 24, width: 320 };
        const hud = root.closest && root.closest(".trellis-irrigation-mode-hud");
        const hudRect = hud && hud.getBoundingClientRect ? hud.getBoundingClientRect() : null;
        const rawLeft = hudRect && hudRect.width > triggerRect.width ? hudRect.left : triggerRect.left;
        const rawWidth = Math.max(triggerRect.width || 0, hudRect && hudRect.width || 0, 360);
        const width = Math.max(180, Math.min(rawWidth, viewportWidth - margin * 2));
        const left = Math.max(margin, Math.min(rawLeft || margin, viewportWidth - width - margin));
        const below = viewportHeight - (triggerRect.bottom || 0) - margin;
        const above = (triggerRect.top || 0) - margin;
        const openUp = below < 180 && above > below;
        const maxHeight = Math.max(120, Math.min(320, openUp ? above : below));
        const top = openUp ? Math.max(margin, (triggerRect.top || margin) - maxHeight - 2) : Math.min(viewportHeight - margin - 120, (triggerRect.bottom || 0) + 2);
        panel.style.left = Math.round(left) + "px";
        panel.style.top = Math.round(Math.max(margin, top)) + "px";
        panel.style.width = Math.round(width) + "px";
        panel.style.maxHeight = Math.round(maxHeight) + "px";
    }

    function connectionComboboxCategoryGroups(parts, query) {
        const grouped = new Map();
        sortConnectionComboboxParts(parts).forEach(function (part) {
            const p = normalizeCatalogPart(part);
            if (!p || query && !connectionComboboxPartMatches(p, query)) return;
            const category = p.category || "uncategorized";
            if (!grouped.has(category)) grouped.set(category, []);
            grouped.get(category).push(p);
        });
        return Array.from(grouped.keys()).sort(compareCatalogCategories).map(function (category) { // CHANGE
            const groupParts = grouped.get(category); // NEW
            return { category, parts: groupParts, subgroups: category === "fitting" ? fittingIntentPartGroups(groupParts) : [] }; // NEW
        }); // CHANGE
    }

    function fittingIntentPartGroups(parts) { // NEW
        const grouped = new Map(); // NEW
        FITTING_INTENT_GROUPS.forEach(function (group) { grouped.set(group.id, []); }); // NEW
        (parts || []).forEach(function (part) { // NEW
            const intent = fittingIntentGroupForPart(part) || fittingIntentGroupById("other"); // NEW
            grouped.get(intent.id).push(part); // NEW
        }); // NEW
        return FITTING_INTENT_GROUPS.map(function (group) { // CHANGE
            const groupParts = grouped.get(group.id) || []; // NEW
            return { id: group.id, label: group.label, parts: groupParts, childGroups: fittingIntentUsesSizePairGroups(group.id) ? fittingSizePairPartGroups(groupParts) : [], ungroupedParts: fittingIntentUsesSizePairGroups(group.id) ? fittingPartsWithoutSizePairGroup(groupParts) : [] }; // CHANGE
        }).filter(function (group) { return group.parts.length > 0; }); // CHANGE
    } // NEW

    function fittingIntentUsesSizePairGroups(intentId) { // NEW
        return intentId === "change_size" || intentId === "thread_adapters"; // NEW
    } // NEW

    function fittingSizePairPartGroups(parts) { // NEW
        const grouped = new Map(); // NEW
        (parts || []).forEach(function (part) { // NEW
            const pair = fittingSizePairGroupForPart(part); // NEW
            if (!pair) return; // NEW
            if (!grouped.has(pair.label)) grouped.set(pair.label, { id: pair.id, label: pair.label, sizes: pair.sizes || [], parts: [] }); // NEW
            grouped.get(pair.label).parts.push(part); // NEW
        }); // NEW
        return Array.from(grouped.values()).sort(function (a, b) { // NEW
            const a0 = a.sizes[0] || ""; // NEW
            const b0 = b.sizes[0] || ""; // NEW
            const first = compareNominalSize(a0, b0); // NEW
            if (first) return first; // NEW
            return compareNominalSize(a.sizes[1] || a0, b.sizes[1] || b0) || a.label.localeCompare(b.label); // NEW
        }); // NEW
    } // NEW

    function fittingPartsWithoutSizePairGroup(parts) { // NEW
        return (parts || []).filter(function (part) { return !fittingSizePairGroupForPart(part); }); // NEW
    } // NEW

    function sortConnectionComboboxParts(parts) {
        return (parts || []).map(normalizeCatalogPart).filter(Boolean).sort(function (a, b) {
            const ka = catalogPartSortKey(a);
            const kb = catalogPartSortKey(b);
            return compareCatalogPartSortKeys(ka, kb); // CHANGE
        });
    }

    function compareCatalogCategories(a, b) {
        const indexA = PART_CATEGORIES.indexOf(a); // CHANGE
        const indexB = PART_CATEGORIES.indexOf(b); // CHANGE
        const sortA = indexA < 0 ? PART_CATEGORIES.length : indexA; // CHANGE
        const sortB = indexB < 0 ? PART_CATEGORIES.length : indexB; // CHANGE
        return (sortA - sortB) || String(a || "").localeCompare(String(b || "")); // CHANGE
    }

    function catalogCategoryLabel(category) {
        return CATALOG_CATEGORY_LABELS[category] || String(category || "Uncategorized").replace(/_/g, " "); // CHANGE
    }

    function normalizeSearchText(value) {
        return String(value || "").trim().toLowerCase();
    }

    function connectionComboboxPartMatches(part, query) {
        if (!query) return true;
        return connectionComboboxPartSearchText(part).indexOf(query) >= 0;
    }

    function connectionComboboxPartSearchText(part) {
        const p = normalizeCatalogPart(part);
        return normalizeSearchText([
            p && p.id,
            p && p.name,
            p && p.category,
            catalogCategoryLabel(p && p.category),
            catalogPartSizeLabel(p),
            catalogPartConnectorTypeLabel(p)
        ].filter(Boolean).join(" "));
    }

    function connectionComboboxPartDetail(part) {
        return [catalogCategoryLabel(part.category), catalogPartSizeLabel(part), catalogPartConnectorTypeLabel(part)].filter(Boolean).join(" | ");
    }

    function connectionComboboxCategoryKey(groupId, category) {
        return String(groupId || "group") + ":" + String(category || "uncategorized");
    }

    function connectionComboboxCollapsedState() {
        const storage = connectionComboboxStorage();
        if (!storage) return {};
        try {
            const parsed = JSON.parse(storage.getItem(CONNECTION_COMBOBOX_COLLAPSED_STORAGE_KEY) || "{}");
            return parsed && typeof parsed === "object" ? parsed : {};
        } catch (_) { return {}; }
    }

    function connectionComboboxCategoryCollapsed(key, defaultCollapsed) {
        const state = connectionComboboxCollapsedState();
        return Object.prototype.hasOwnProperty.call(state, key) ? state[key] === true : !!defaultCollapsed;
    }

    function connectionComboboxSetCategoryCollapsed(key, collapsed) {
        const storage = connectionComboboxStorage();
        if (!storage) return;
        const state = connectionComboboxCollapsedState();
        state[key] = collapsed === true;
        try { storage.setItem(CONNECTION_COMBOBOX_COLLAPSED_STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
    }

    function connectionComboboxStorage() {
        try {
            return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
        } catch (_) { return null; }
    }

    function connectionRowCurrentLabel(moduleCell, row) {
        const port = { cellId: getCellId(row.cell), role: row.role, index: row.index };
        const edge = edgesForPort(moduleCell, port)[0];
        if (edge) return edgeConnectionDisplayLabel(moduleCell, edge) + " connected: " + irrigationCellLabel(row.role === "output" ? edge.target : edge.source);
        const neighbor = internalNeighborForPort(row.cell, row.role);
        return neighbor ? internalConnectionDisplayLabel(moduleCell, row.role === "output" ? row.cell : neighbor, row.role === "output" ? neighbor : row.cell) + " connected: " + irrigationCellLabel(neighbor) : "No change";
    }

    function connectionDropdownGroups(moduleCell, row) {
        const parts = compatibleDropdownParts(moduleCell, row.cell, row.role).filter(function (part) { return partAllowedForConnectionRow(moduleCell, row, part); });
        const occupied = !!internalNeighborForPort(row.cell, row.role) || edgesForPort(moduleCell, { cellId: getCellId(row.cell), role: row.role, index: row.index }).length > 0;
        if (!occupied) return { keep: parts.map(function (part) { return connectionContextPartOption(moduleCell, row, part); }), disconnect: [] }; // CHANGE
        const keep = parts.filter(function (part) { return replacementKeepsExistingConnection(moduleCell, row, part); });
        const keepIds = new Set(keep.map(function (part) { return part.id; }));
        return { keep: keep.map(function (part) { return connectionContextPartOption(moduleCell, row, part); }), disconnect: parts.filter(function (part) { return !keepIds.has(part.id); }).map(function (part) { return connectionContextPartOption(moduleCell, row, part); }) }; // CHANGE
    }

    function replacementKeepsExistingConnection(moduleCell, row, part) {
        const neighbor = internalNeighborForPort(row.cell, row.role);
        if (neighbor) return false;
        const edge = edgesForPort(moduleCell, { cellId: getCellId(row.cell), role: row.role, index: row.index })[0];
        if (!edge) return true;
        if (row.role === "output") return branchCanReuseDownstream(moduleCell, row.cell, part, edge.target);
        return ConnectorRules.connectionMode(moduleCell, ConnectorRules.portConnectorForCell(moduleCell, edge.source, "output"), normalizeCatalogPart(part).connectors.input).ok;
    }

    function internalNeighborForPort(cell, role) {
        const assembly = findAssemblyAncestor(cell);
        const parts = assemblyPartCells(assembly);
        const index = parts.indexOf(cell);
        if (index < 0) return null;
        return role === "input" ? (parts[index - 1] || null) : (parts[index + 1] || null);
    }

    function applyConnectionDropdownSelection(session, row, partId) {
        const part = partById(readCatalog(session.moduleCell), partId);
        if (!part) return;
        const result = runIrrigationEdit("connectionDropdown", function () { const applied = applyConnectionPartChoice(session.moduleCell, row, part); scheduleHudGraphStateSync(session.moduleCell); return applied; });
        session.message = result.message;
        if (result.cell) selectCell(result.cell, false);
        renderIrrigationMode(session);
    }

    function applyConnectionPartChoice(moduleCell, row, part) {
        if (!partAllowedForConnectionRow(moduleCell, row, part)) return { cell: null, message: "Assembly outlets require a pipe-capable part inlet." };
        if (row.role === "output" && portCapacityForCell(moduleCell, row.cell, "output") > 1) return applyBranchOutletChoice(moduleCell, row, part);
        return applyLinearConnectionChoice(moduleCell, row, part);
    }

    function applyBedPortPartChoice(session, row, part) {
        const port = { cellId: getCellId(row.cell), role: row.role, index: row.index };
        if (!isPortFree(session.moduleCell, port)) return { cell: null, message: "Selected bed port is already connected." };
        const decision = dropdownPartConnectionDecision(session.moduleCell, row, part);
        if (!decision.ok) return { cell: null, message: decision.reason || "Part could not be connected to the selected bed port." };
        const created = createPartAssembly(session.moduleCell, part, bedPortPartAnchor(row.cell, row.role, row.index), decision.flipped); // CHANGE
        const partCell = created && created.partCell;
        if (!partCell) return { cell: null, message: "Part could not be created." };
        const sourceCell = row.role === "input" ? partCell : row.cell;
        const targetCell = row.role === "input" ? row.cell : partCell;
        const sourceIndex = row.role === "input" ? 0 : row.index;
        const targetIndex = row.role === "input" ? row.index : 0;
        let edge = null;
        try { edge = ConnectionChainPlanner.createEdge(session.moduleCell, sourceCell, targetCell, decision, sourceIndex, targetIndex); }
        catch (err) { edge = null; }
        if (!edge) { removeCellFromParent(created.assembly); return { cell: null, message: "Part could not be connected to the selected bed port." }; }
        session.selectedPorts = [];
        session.selectedBoundaries = [];
        return { cell: created.assembly, message: "Part added to bed " + (row.role === "input" ? "inlet." : "outlet.") };
    }

    function bedPortPartAnchor(bedAssembly, role, index) {
        const geo = getGeometry(bedAssembly) || {};
        const width = finiteNumber(geo.width, ASSEMBLY_DEFAULT_WIDTH);
        const height = finiteNumber(geo.height, ASSEMBLY_CONTRACTED_BED.height);
        const slotOffset = Math.max(0, Math.floor(finiteNumber(index, 0))) * 28;
        if (role === "input") return { x: finiteNumber(geo.x, 24), y: Math.max(24, finiteNumber(geo.y, 72) - assemblyPartLaneHeight(1) - 40 - slotOffset) }; // CHANGE
        return { x: finiteNumber(geo.x, 24), y: finiteNumber(geo.y, 72) + height + 40 + slotOffset, width };
    }

    function applyLinearConnectionChoice(moduleCell, row, part) {
        const decision = dropdownPartConnectionDecision(moduleCell, row, part); // NEW
        if (!decision.ok) return { cell: null, message: decision.reason || "Part could not be connected to the selected port." }; // NEW
        const assembly = findAssemblyAncestor(row.cell);
        const parts = assemblyPartCells(assembly);
        const index = parts.indexOf(row.cell);
        if (!assembly || index < 0) return { message: "Selected part is no longer available." };
        const edge = edgesForPort(moduleCell, { cellId: getCellId(row.cell), role: row.role, index: row.index })[0];
        const neighbor = internalNeighborForPort(row.cell, row.role);
        if (!edge && !neighbor) { // FIX: free pipe-compatible dropdown choices must create a separate assembly connected by a pipe edge.
            const external = applyExternalPipeDropdownChoice(moduleCell, row, part);
            if (external) return external;
        }
        model.beginUpdate && model.beginUpdate();
        try {
            if (neighbor) {
                if (row.role === "input") splitAssemblyPrefix(moduleCell, assembly, index);
                else splitAssemblySegment(moduleCell, assembly, index + 1);
            }
            const freshIndex = assemblyPartCells(assembly).indexOf(row.cell);
            const inserted = insertAssemblyPartAt(assembly, part, row.role === "input" ? freshIndex : freshIndex + 1, decision.flipped); // CHANGE
            if (edge) retargetLinearConnectionEdgeAfterInsert(moduleCell, edge, row, inserted);
            return { cell: inserted, message: neighbor ? "Connection changed; previous chain segment was split into a disconnected swimlane." : "Part added to connection." };
        } finally { model.endUpdate && model.endUpdate(); }
    }

    function applyExternalPipeDropdownChoice(moduleCell, row, part) {
        return ConnectionChainPlanner.applyExternalPart(moduleCell, row, part);
    }

    function dropdownPartConnectionDecision(moduleCell, row, part) {
        const p = normalizeCatalogPart(part);
        if (!p) return { ok: false, reason: "Selected part is no longer available." };
        const rowConnector = ConnectorRules.portConnectorForCell(moduleCell, row.cell, row.role);
        let fallback = null; // NEW
        const orientations = partConnectorOrientations(p); // NEW
        for (let i = 0; i < orientations.length; i++) { // NEW
            const orientation = orientations[i]; // NEW
            const partConnector = row.role === "input" ? orientation.outputConnector : orientation.inputConnector; // CHANGE
            if (!partConnector) continue; // CHANGE
            const sourceConnector = row.role === "input" ? partConnector : rowConnector; // CHANGE
            const targetConnector = row.role === "input" ? rowConnector : partConnector; // CHANGE
            const decision = Object.assign({ pipeRequired: ConnectorRules.connectorsRequirePipe(sourceConnector, targetConnector), sourceConnector, targetConnector, flipped: orientation.flipped }, ConnectorRules.connectionMode(moduleCell, sourceConnector, targetConnector)); // CHANGE
            if (decision.ok) return decision; // NEW
            if (!fallback) fallback = decision; // NEW
        } // NEW
        return fallback || { ok: false, reason: "Selected part does not have a compatible connector." }; // CHANGE
    }

    function linearDropdownPartAnchor(row) {
        const assembly = findAssemblyAncestor(row.cell);
        const geo = getGeometry(assembly) || getGeometry(row.cell) || {};
        const x = finiteNumber(geo.x, 24);
        const y = finiteNumber(geo.y, 72);
        const height = finiteNumber(geo.height, assemblyPartLaneHeight(1)); // CHANGE
        const slotOffset = Math.max(0, Math.floor(finiteNumber(row.index, 0))) * 28;
        return row.role === "input" ? { x, y: Math.max(24, y - assemblyPartLaneHeight(1) - 40 - slotOffset) } : { x, y: y + height + 40 + slotOffset }; // CHANGE
    }

    function retargetLinearConnectionEdgeAfterInsert(moduleCell, edge, row, inserted) {
        if (row.role === "input") {
            const decision = existingEdgeConnectionDecision(moduleCell, { cellId: getCellId(edge.source), role: "output", index: getCellAttr(edge, ATTRS.EDGE_SOURCE_PORT, "0") }, { cellId: getCellId(inserted), role: "input", index: 0 });
            if (decision.ok) { retargetConnectionEdge(edge, inserted, false); updateConnectionEdgeAttrs(edge, decision); }
            else removeCellFromParent(edge);
            return;
        }
        const decision = existingEdgeConnectionDecision(moduleCell, { cellId: getCellId(inserted), role: "output", index: 0 }, { cellId: getCellId(edge.target), role: "input", index: getCellAttr(edge, ATTRS.EDGE_TARGET_PORT, "0") });
        if (decision.ok) { retargetConnectionEdge(edge, inserted, true); updateConnectionEdgeAttrs(edge, decision); }
        else removeCellFromParent(edge);
    }

    function applyBranchOutletChoice(moduleCell, row, part) {
        const edge = edgesForPort(moduleCell, { cellId: getCellId(row.cell), role: "output", index: row.index })[0];
        const decision = dropdownPartConnectionDecision(moduleCell, row, part); // NEW
        if (!decision.ok) return { cell: null, message: decision.reason || "Part could not be connected to the selected outlet." }; // NEW
        irrigationDebug("branchOutletChoice:start", { sourceCell: debugCellSummary(row.cell), outletIndex: row.index, part: part ? { id: part.id, name: part.name, category: part.category } : null, existingEdge: debugCellSummary(edge) });
        model.beginUpdate && model.beginUpdate();
        try {
            if (edge && branchCanReuseDownstream(moduleCell, row, part, edge.target, decision)) { // CHANGE
                irrigationDebug("branchOutletChoice:reuse-downstream", { sourceCell: debugCellSummary(row.cell), outletIndex: row.index, edge: debugCellSummary(edge), downstream: debugCellSummary(edge.target), part: part ? { id: part.id, name: part.name, category: part.category } : null });
                updateAssemblyPartCell(edge.target, part, decision.flipped); // CHANGE
                const reuseDecision = existingEdgeConnectionDecision(moduleCell, { cellId: getCellId(row.cell), role: "output", index: row.index }, { cellId: getCellId(edge.target), role: "input", index: 0 }); // CHANGE
                if (!reuseDecision.ok) { irrigationDebug("branchOutletChoice:reuse-rejected", { reason: reuseDecision.reason, sourceCell: debugCellSummary(row.cell), outletIndex: row.index, edge: debugCellSummary(edge), downstream: debugCellSummary(edge.target) }); removeCellFromParent(edge); return { cell: edge.target, message: "Old branch disconnected; replacement is not compatible." }; } // CHANGE
                updateConnectionEdgeAttrs(edge, reuseDecision); // CHANGE
                return { cell: edge.target, message: "Branch first part replaced." };
            }
            if (edge) { irrigationDebug("branchOutletChoice:remove-existing-edge", { edge: debugCellSummary(edge), sourceCell: debugCellSummary(row.cell), outletIndex: row.index }); removeCellFromParent(edge); }
            irrigationDebug("branchOutletChoice:create-branch", { sourceCell: debugCellSummary(row.cell), outletIndex: row.index, part: part ? { id: part.id, name: part.name, category: part.category } : null });
            const created = createBranchAssemblyFromOutlet(moduleCell, row, part, decision); // CHANGE
            return { cell: created && created.assembly, message: edge ? "Old branch disconnected; new branch created." : "Branch swimlane created." };
        } finally { model.endUpdate && model.endUpdate(); }
    }

    function branchCanReuseDownstream(moduleCell, row, part, downstreamCell, decision) { // CHANGE
        const p = normalizeCatalogPart(part);
        if (!downstreamCell || !p || p.category === "pipe_tubing" || p.connectors.inputs <= 0) return false;
        if (!decision || !decision.ok) return false; // NEW
        const downstreamAssembly = findAssemblyAncestor(downstreamCell);
        const parts = assemblyPartCells(downstreamAssembly);
        if (parts[0] !== downstreamCell) return false;
        const second = parts[1];
        if (!second) return true;
        const outputConnector = decision.flipped ? p.connectors.input : p.connectors.output; // NEW
        return ConnectorRules.connectorMatches(outputConnector, ConnectorRules.portConnectorForCell(moduleCell, second, "input"), null).ok; // CHANGE
    }

    function createBranchAssemblyFromOutlet(moduleCell, row, part, decision) { // CHANGE
        const sourceAssembly = findAssemblyAncestor(row.cell);
        const sourceGeo = getGeometry(sourceAssembly) || {};
        const anchor = { x: finiteNumber(sourceGeo.x, 24), y: finiteNumber(sourceGeo.y, 72) + finiteNumber(sourceGeo.height, 120) + 40 + row.index * 28 };
        const created = createPartAssembly(moduleCell, part, anchor, decision && decision.flipped); // CHANGE
        const target = firstAssemblyPart(created.assembly);
        irrigationDebug("branchAssemblyFromOutlet:start", { sourceAssembly: debugCellSummary(sourceAssembly), sourceCell: debugCellSummary(row.cell), outletIndex: row.index, targetAssembly: debugCellSummary(created.assembly), targetCell: debugCellSummary(target), part: part ? { id: part.id, name: part.name, category: part.category } : null });
        const result = ConnectorRules.createAssemblyConnection(moduleCell, { cellId: getCellId(row.cell), role: "output", index: row.index }, { cellId: getCellId(target), role: "input", index: 0 });
        irrigationDebug("branchAssemblyFromOutlet:connection-result", { ok: !!(result && result.ok), reason: result && result.reason || "", mode: result && result.mode || "", edge: debugCellSummary(result && result.edge), sourceAssembly: debugCellSummary(sourceAssembly), sourceCell: debugCellSummary(row.cell), outletIndex: row.index, targetAssembly: debugCellSummary(created.assembly), targetCell: debugCellSummary(target) });
        if (!result.ok) irrigationDebug("branchAssemblyFromOutlet:connection-rejected", { reason: result.reason, sourceAssembly: debugCellSummary(sourceAssembly), sourceCell: debugCellSummary(row.cell), outletIndex: row.index, targetAssembly: debugCellSummary(created.assembly), targetCell: debugCellSummary(target) });
        return result.ok ? created : created;
    }

    function normalizeAddedIrrigationEdges(session, cells) {
        if (!session || !Array.isArray(cells)) return;
        if (isIrrigationUndoRedoReplay()) { renderIrrigationMode(session); return; }
        if (programmaticEdgeInsertDepth > 0) { irrigationDebug("normalizeAddedIrrigationEdges:skip-programmatic", { depth: programmaticEdgeInsertDepth, count: cells.length }); return; }
        runIrrigationEdit("normalizeAddedIrrigationEdges", function () { cells.forEach(function (cell) { normalizeAddedIrrigationEdge(session, cell); }); });
    }

    function handleRemovedIrrigationCells(session, cells) {
        if (!session || !Array.isArray(cells) || !cells.length) return;
        if (isIrrigationUndoRedoReplay()) { renderIrrigationMode(session); return; }
        const changed = runIrrigationEdit("handleRemovedIrrigationCells", function () {
            let didChange = false;
            model.beginUpdate && model.beginUpdate();
            try {
            cells.forEach(function (cell) {
                if (managedConnectionEdge(cell)) { didChange = true; return; }
                if (isAssemblyPartCell(cell) && findAssemblyAncestor(cell)) didChange = deleteAssemblyPartCell(session.moduleCell, cell) || didChange;
                else if (isAssembly(cell)) { externalEdgesForAssemblyCell(session.moduleCell, cell).forEach(removeCellFromParent); didChange = true; }
            });
            } finally { model.endUpdate && model.endUpdate(); }
            if (didChange) scheduleHudGraphStateSync(session.moduleCell);
            return didChange;
        });
        if (!changed) return;
        session.selectedPorts = [];
        session.selectedBoundaries = [];
        renderIrrigationMode(session);
    }

    function normalizeAddedIrrigationEdge(session, edge) {
        if (!edge || getCellAttr(edge, ATTRS.PIPE_EDGE, "") === "1") return;
        const sourceTerminal = edge.source || (model.getTerminal && model.getTerminal(edge, true));
        const targetTerminal = edge.target || (model.getTerminal && model.getTerminal(edge, false));
        if (!isAssemblyModeObject(sourceTerminal) || !isAssemblyModeObject(targetTerminal)) return;
        const sourceCell = boundaryPortCell(sourceTerminal, "output");
        const targetCell = boundaryPortCell(targetTerminal, "input");
        const sourcePort = firstFreePort(session.moduleCell, sourceCell, "output");
        const targetPort = firstFreePort(session.moduleCell, targetCell, "input");
        const decision = sourcePort && targetPort ? ConnectorRules.connectionDecision(session.moduleCell, sourcePort, targetPort) : { ok: false, reason: "No available boundary connector." };
        if (!decision.ok) {
            removeCellFromParent(edge);
            session.message = "Connection removed: " + decision.reason;
            renderIrrigationMode(session);
            return;
        }
        if (decision.mode === "merge") {
            removeCellFromParent(edge);
            const result = mergeAssemblyConnection(session.moduleCell, decision);
            session.message = result.ok ? "Assemblies merged." : result.reason;
            scheduleHudGraphStateSync(session.moduleCell);
            renderIrrigationMode(session);
            return;
        }
        model.beginUpdate && model.beginUpdate();
        try {
            retargetConnectionEdge(edge, decision.sourceCell, true);
            retargetConnectionEdge(edge, decision.targetCell, false);
            updateConnectionEdgeAttrs(edge, decision);
        } finally { model.endUpdate && model.endUpdate(); }
        session.message = decision.mode === "pipe" ? "Pipe Edge connected." : "Direct link connected.";
        scheduleHudGraphStateSync(session.moduleCell);
        renderIrrigationMode(session);
    }

    function boundaryPortCell(cell, role) {
        if (isAssembly(cell) && assemblyType(cell) === "bed") return cell;
        if (isAssembly(cell)) return role === "output" ? lastAssemblyPart(cell) : firstAssemblyPart(cell);
        if (isAssemblyPartCell(cell)) return cell;
        return null;
    }

    function firstFreePort(moduleCell, cell, role) {
        const count = portCapacityForCell(moduleCell, cell, role);
        for (let i = 0; i < count; i++) {
            const port = { cellId: getCellId(cell), role, index: i };
            if (isPortFree(moduleCell, port)) return port;
        }
        return null;
    }

    function selectedValidPorts(session) {
        return (session.selectedPorts || []).map(normalizePort).filter(function (port) {
            const cell = portCell(session.moduleCell, port);
            return port.cellId && cell && (port.role === "input" || port.role === "output") && port.index < portCapacityForCell(session.moduleCell, cell, port.role);
        });
    }

    function orderedConnectionPorts(ports) {
        const output = ports.find(function (port) { return port.role === "output"; });
        const input = ports.find(function (port) { return port.role === "input"; });
        return output && input ? { source: output, target: input } : null;
    }

    function portVisualRoleForPort(moduleCell, port) {
        const normalized = normalizePort(port);
        return portDisplayRole(moduleCell, normalized); // CHANGE
    }

    function planningVisualRoleForPort(moduleCell, port) { // NEW
        const normalized = normalizePort(port); // NEW
        const cell = portCell(moduleCell, normalized); // NEW
        return cell && isReversibleFittingCell(moduleCell, cell) && isPartCellFlipped(cell) ? oppositePortRole(normalized.role) : normalized.role; // NEW
    } // NEW

    function orderedVisualConnectionPorts(moduleCell, ports) {
        const normalized = (ports || []).map(normalizePort);
        const output = normalized.find(function (port) { return portVisualRoleForPort(moduleCell, port) === "output"; });
        const input = normalized.find(function (port) { return portVisualRoleForPort(moduleCell, port) === "input"; });
        return output && input ? { source: output, target: input } : null;
    }

    function sameOrderedConnectionPorts(first, second) {
        return !!(first && second && portKey(first.source) === portKey(second.source) && portKey(first.target) === portKey(second.target));
    }

    function storedAndVisualDirectConnectionPorts(moduleCell, ports) {
        const stored = orderedConnectionPorts(ports || []);
        const visual = orderedVisualConnectionPorts(moduleCell, ports || []);
        return sameOrderedConnectionPorts(stored, visual) ? stored : null;
    }

    function connectSelectedPorts(session, sourcePort, targetPort) {
        const result = runIrrigationEdit("connectSelectedPorts", function () { const connected = createAssemblyConnection(session.moduleCell, sourcePort, targetPort); scheduleHudGraphStateSync(session.moduleCell); return connected; });
        session.message = result.ok ? (result.mode === "merge" ? "Assemblies merged." : result.mode === "direct" ? "Direct link connected." : "Pipe Edge connected.") : result.reason;
        if (result.ok) session.selectedPorts = [];
        if (result.ok) session.selectedBoundaries = [];
        renderIrrigationMode(session);
    }

    function oppositePortRole(role) {
        return role === "input" ? "output" : "input";
    }

    function samePortCell(moduleCell, port, cell) {
        return !!cell && portCell(moduleCell, port) === cell;
    }

    function graphYForCell(cell) {
        const state = cellState(cell);
        return finiteNumber(state.y, finiteNumber((getGeometry(cell) || {}).y, 0));
    }

    function selectedObjectHasAnyConnection(moduleCell, cell) {
        if (!cell) return false;
        const assembly = isAssembly(cell) ? cell : findAssemblyAncestor(cell);
        if (assembly) return assemblyPartCells(assembly).length > 1 || externalEdgesForAssemblyCell(moduleCell, assembly).length > 0;
        return externalEdgesForCell(moduleCell, cell).length > 0;
    }

    function debugCatalogPartSummary(part) {
        const p = normalizeCatalogPart(part);
        if (!p || !p.id) return null;
        const validation = validateCatalogPart(p);
        return { id: p.id, name: p.name, category: p.category, inputs: p.connectors.inputs, outputs: p.connectors.outputs, input: p.connectors.input, output: p.connectors.output, reversible: isReversibleFittingPart(p), valid: validation.ok, errors: validation.errors };
    }

    function debugPortSummary(moduleCell, port) {
        const normalized = normalizePort(port);
        const cell = portCell(moduleCell, normalized);
        const visualRole = portVisualRoleForPort(moduleCell, normalized);
        return { port: normalized, key: portKey(normalized), storedRole: normalized.role, visualRole, free: !!(cell && isPortFree(moduleCell, normalized)), connectedObject: !!(cell && selectedObjectHasAnyConnection(moduleCell, cell)), connector: cell ? ConnectorRules.portConnectorForCell(moduleCell, cell, normalized.role) : null, cell: debugCellSummary(cell) };
    }

    function quietIrrigationDebug(fn) {
        irrigationDebugQuietDepth++;
        try { return fn(); } finally { irrigationDebugQuietDepth = Math.max(0, irrigationDebugQuietDepth - 1); }
    }

    function debugFlipPlanSizeMismatchAttempts(moduleCell, plan) {
        return (plan && plan.sizeMismatchAttempts || []).map(function (attempt) {
            return {
                index: attempt.index,
                flipCell: debugCellSummary(attempt.flipCell),
                source: debugPortSummary(moduleCell, attempt.source),
                target: debugPortSummary(moduleCell, attempt.target),
                sourceConnector: attempt.sourceConnector,
                targetConnector: attempt.targetConnector
            };
        });
    }

    function virtualPortAfterFlip(moduleCell, port, flipCell) {
        const normalized = normalizePort(port);
        return samePortCell(moduleCell, normalized, flipCell) ? Object.assign({}, normalized, { role: oppositePortRole(normalized.role) }) : normalized;
    }

    function virtualVisualRoleAfterFlip(moduleCell, port, flipCell) {
        const normalized = normalizePort(port);
        const role = planningVisualRoleForPort(moduleCell, normalized); // CHANGE
        return samePortCell(moduleCell, normalized, flipCell) && isReversibleFittingCell(moduleCell, flipCell) ? oppositePortRole(role) : role;
    }

    function virtualPortConnectorForCell(moduleCell, cell, role, flipCell) {
        if (cell !== flipCell || !isReversibleFittingCell(moduleCell, cell)) return ConnectorRules.portConnectorForCell(moduleCell, cell, role);
        const part = partForCell(moduleCell, cell);
        const flipped = !isPartCellFlipped(cell);
        return role === "input" ? (flipped ? part.connectors.output : part.connectors.input) : (flipped ? part.connectors.input : part.connectors.output);
    }

    function connectionDecisionForPortsWithFlip(moduleCell, sourcePort, targetPort, flipCell) {
        const structure = ConnectorRules.validatePortConnectionStructure(moduleCell, sourcePort, targetPort);
        if (!structure.ok) { irrigationDebug("flipConnectPlan:candidate-rejected", { stage: "structure", reason: structure.reason, source: debugPortSummary(moduleCell, sourcePort), target: debugPortSummary(moduleCell, targetPort), flipCell: debugCellSummary(flipCell) }); return structure; }
        const sourceConnector = virtualPortConnectorForCell(moduleCell, structure.sourceCell, "output", flipCell);
        const targetConnector = virtualPortConnectorForCell(moduleCell, structure.targetCell, "input", flipCell);
        const compatibility = ConnectorRules.connectionMode(moduleCell, sourceConnector, targetConnector);
        if (!compatibility.ok) { irrigationDebug("flipConnectPlan:candidate-rejected", { stage: "compatibility", reason: compatibility.reason, source: debugPortSummary(moduleCell, sourcePort), target: debugPortSummary(moduleCell, targetPort), flipCell: debugCellSummary(flipCell), sourceConnector, targetConnector }); return compatibility; }
        const sourceCapacity = portCapacityForCell(moduleCell, structure.sourceCell, "output");
        const sourceBed = assemblyType(structure.sourceAssembly) === "bed";
        const targetBed = assemblyType(structure.targetAssembly) === "bed";
        const canMerge = !sourceBed && !targetBed && sourceCapacity <= 1 && structure.sourceAssembly && structure.targetAssembly;
        return Object.assign({}, structure, { mode: compatibility.mode === "pipe" ? "pipe" : (canMerge ? "merge" : "direct"), pipePartId: compatibility.pipePartId || "" });
    }

    function orientationCorrectionFlipPlanForPorts(moduleCell, selected, cells, connected, indexes, storedOrdered, visualOrdered) {
        if (!storedOrdered || sameOrderedConnectionPorts(storedOrdered, visualOrdered)) return null;
        irrigationDebug("flipConnectPlan:orientation-correction", { storedOrdered: { source: debugPortSummary(moduleCell, storedOrdered.source), target: debugPortSummary(moduleCell, storedOrdered.target) }, visualOrdered: visualOrdered ? { source: debugPortSummary(moduleCell, visualOrdered.source), target: debugPortSummary(moduleCell, visualOrdered.target) } : null });
        const sizeMismatchAttempts = [];
        for (let i = 0; i < indexes.length; i++) {
            const index = indexes[i];
            const flipCell = cells[index];
            if (connected[index]) { irrigationDebug("flipConnectPlan:candidate-rejected", { stage: "orientation-correction", reason: "Selected part already has a connection.", index, flipCell: debugCellSummary(flipCell) }); continue; }
            if (!isReversibleFittingCell(moduleCell, flipCell)) { irrigationDebug("flipConnectPlan:candidate-rejected", { stage: "orientation-correction", reason: "Selected part is not a reversible one-inlet one-outlet fitting.", index, flipCell: debugCellSummary(flipCell) }); continue; }
            const visualSourceRole = virtualVisualRoleAfterFlip(moduleCell, storedOrdered.source, flipCell);
            const visualTargetRole = virtualVisualRoleAfterFlip(moduleCell, storedOrdered.target, flipCell);
            irrigationDebug("flipConnectPlan:orientation-after-flip", { index, flipCell: debugCellSummary(flipCell), sourceVisualRole: visualSourceRole, targetVisualRole: visualTargetRole, source: debugPortSummary(moduleCell, storedOrdered.source), target: debugPortSummary(moduleCell, storedOrdered.target) });
            if (visualSourceRole !== "output" || visualTargetRole !== "input") { irrigationDebug("flipConnectPlan:candidate-rejected", { stage: "orientation-correction", reason: "Virtual flip did not produce a visual outlet to inlet pair.", index, sourceVisualRole: visualSourceRole, targetVisualRole: visualTargetRole }); continue; }
            const decision = connectionDecisionForPortsWithFlip(moduleCell, storedOrdered.source, storedOrdered.target, flipCell);
            if (decision.ok) { const planned = Object.assign({}, decision, { ok: true, flipCell, flipPort: selected[index], source: storedOrdered.source, target: storedOrdered.target, orientationCorrection: true }); irrigationDebug("flipConnectPlan:accepted", { mode: planned.mode, pipePartId: planned.pipePartId || "", orientationCorrection: true, flipCell: debugCellSummary(flipCell), flipPort: debugPortSummary(moduleCell, selected[index]), source: debugPortSummary(moduleCell, storedOrdered.source), target: debugPortSummary(moduleCell, storedOrdered.target) }); return planned; }
            if (decision.reason === "Pipe Edge size mismatch.") sizeMismatchAttempts.push({ index, flipCell, source: storedOrdered.source, target: storedOrdered.target, sourceConnector: virtualPortConnectorForCell(moduleCell, portCell(moduleCell, storedOrdered.source), "output", flipCell), targetConnector: virtualPortConnectorForCell(moduleCell, portCell(moduleCell, storedOrdered.target), "input", flipCell) });
        }
        return sizeMismatchAttempts.length ? { ok: false, sizeMismatchAttempts } : null;
    }

    function flipConnectPlanForPorts(moduleCell, ports) {
        const selected = (ports || []).map(normalizePort).filter(function (port) { return port.cellId && portCell(moduleCell, port); });
        irrigationDebug("flipConnectPlan:start", { rawPorts: (ports || []).map(normalizePort), selected: selected.map(function (port) { return debugPortSummary(moduleCell, port); }) });
        if (selected.length !== 2 || selected.some(function (port) { return !isPortFree(moduleCell, port); })) { const rejected = { ok: false, reason: "Select two free port badges." }; irrigationDebug("flipConnectPlan:rejected", { reason: rejected.reason, selectedCount: selected.length, selected: selected.map(function (port) { return debugPortSummary(moduleCell, port); }) }); return rejected; }
        const cells = selected.map(function (port) { return portCell(moduleCell, port); });
        if (!cells[0] || !cells[1] || cells[0] === cells[1]) { const rejected = { ok: false, reason: "Select ports on two different parts." }; irrigationDebug("flipConnectPlan:rejected", { reason: rejected.reason, cells: cells.map(debugCellSummary) }); return rejected; }
        const connected = cells.map(function (cell) { return selectedObjectHasAnyConnection(moduleCell, cell); });
        irrigationDebug("flipConnectPlan:connected-state", { connected, cells: cells.map(debugCellSummary) });
        if (connected[0] && connected[1]) { const rejected = { ok: false, reason: "Both selected parts are already connected." }; irrigationDebug("flipConnectPlan:rejected", { reason: rejected.reason, connected, selected: selected.map(function (port) { return debugPortSummary(moduleCell, port); }) }); return rejected; }
        const preferredIndex = connected[0] !== connected[1] ? (connected[0] ? 1 : 0) : (graphYForCell(cells[0]) > graphYForCell(cells[1]) ? 0 : 1);
        const indexes = preferredIndex === 0 ? [0, 1] : [1, 0];
        const sizeMismatchAttempts = [];
        irrigationDebug("flipConnectPlan:preferred-candidate", { preferredIndex, order: indexes, y: cells.map(graphYForCell), selected: selected.map(function (port) { return debugPortSummary(moduleCell, port); }) });
        const storedOrdered = orderedConnectionPorts(selected);
        const visualOrdered = orderedVisualConnectionPorts(moduleCell, selected);
        const orientationPlan = orientationCorrectionFlipPlanForPorts(moduleCell, selected, cells, connected, indexes, storedOrdered, visualOrdered);
        if (orientationPlan && orientationPlan.ok) return orientationPlan;
        if (orientationPlan && orientationPlan.sizeMismatchAttempts) sizeMismatchAttempts.push.apply(sizeMismatchAttempts, orientationPlan.sizeMismatchAttempts);
        for (let i = 0; i < indexes.length; i++) {
            const index = indexes[i];
            const flipCell = cells[index];
            if (connected[index]) { irrigationDebug("flipConnectPlan:candidate-rejected", { stage: "candidate", reason: "Selected part already has a connection.", index, flipCell: debugCellSummary(flipCell) }); continue; }
            if (!isReversibleFittingCell(moduleCell, flipCell)) { irrigationDebug("flipConnectPlan:candidate-rejected", { stage: "candidate", reason: "Selected part is not a reversible one-inlet one-outlet fitting.", index, flipCell: debugCellSummary(flipCell) }); continue; }
            const afterPorts = selected.map(function (port) { return virtualPortAfterFlip(moduleCell, port, flipCell); });
            const ordered = orderedConnectionPorts(afterPorts);
            irrigationDebug("flipConnectPlan:candidate-after-flip", { index, flipCell: debugCellSummary(flipCell), beforePorts: selected.map(function (port) { return debugPortSummary(moduleCell, port); }), afterPorts: afterPorts.map(function (port) { return debugPortSummary(moduleCell, port); }) });
            if (!ordered) { irrigationDebug("flipConnectPlan:candidate-rejected", { stage: "ordering", reason: "Virtual flip did not produce one output and one inlet.", index, afterPorts: afterPorts.map(function (port) { return debugPortSummary(moduleCell, port); }) }); continue; }
            const decision = connectionDecisionForPortsWithFlip(moduleCell, ordered.source, ordered.target, flipCell);
            if (decision.ok) { const planned = Object.assign({}, decision, { ok: true, flipCell, flipPort: selected[index], source: ordered.source, target: ordered.target }); irrigationDebug("flipConnectPlan:accepted", { mode: planned.mode, pipePartId: planned.pipePartId || "", flipCell: debugCellSummary(flipCell), flipPort: debugPortSummary(moduleCell, selected[index]), source: debugPortSummary(moduleCell, ordered.source), target: debugPortSummary(moduleCell, ordered.target) }); return planned; }
            if (decision.reason === "Pipe Edge size mismatch.") sizeMismatchAttempts.push({ index, flipCell, source: ordered.source, target: ordered.target, sourceConnector: virtualPortConnectorForCell(moduleCell, portCell(moduleCell, ordered.source), "output", flipCell), targetConnector: virtualPortConnectorForCell(moduleCell, portCell(moduleCell, ordered.target), "input", flipCell) });
        }
        const rejected = { ok: false, reason: "No reversible fitting can connect the selected ports." };
        if (sizeMismatchAttempts.length) rejected.sizeMismatchAttempts = sizeMismatchAttempts;
        irrigationDebug("flipConnectPlan:rejected", { reason: rejected.reason, selected: selected.map(function (port) { return debugPortSummary(moduleCell, port); }) });
        return rejected;
    }

    function flipAndConnectSelectedPorts(session, ports) {
        const result = runIrrigationEdit("flipAndConnectSelectedPorts", function () {
            const plan = flipConnectPlanForPorts(session.moduleCell, ports);
            irrigationDebug("flipAndConnectSelectedPorts:plan", { ok: !!plan.ok, reason: plan.reason || "", mode: plan.mode || "", flipCell: debugCellSummary(plan.flipCell), source: plan.source ? debugPortSummary(session.moduleCell, plan.source) : null, target: plan.target ? debugPortSummary(session.moduleCell, plan.target) : null });
            if (!plan.ok) return { ok: false, reason: plan.reason, mode: "" };
            const previous = isPartCellFlipped(plan.flipCell);
            irrigationDebug("flipAndConnectSelectedPorts:flip-before", { flipCell: debugCellSummary(plan.flipCell), previousAttr: getCellAttr(plan.flipCell, ATTRS.PART_FLIPPED, ""), previousFlipped: previous });
            setPartCellFlipped(plan.flipCell, !previous);
            syncConnectionEdgeVisualAnchorsForCell(session.moduleCell, plan.flipCell); // NEW
            irrigationDebug("flipAndConnectSelectedPorts:flip-after", { flipCell: debugCellSummary(plan.flipCell), nextAttr: getCellAttr(plan.flipCell, ATTRS.PART_FLIPPED, ""), nextFlipped: isPartCellFlipped(plan.flipCell), source: debugPortSummary(session.moduleCell, plan.source), target: debugPortSummary(session.moduleCell, plan.target) });
            const connected = createAssemblyConnection(session.moduleCell, plan.source, plan.target);
            irrigationDebug("flipAndConnectSelectedPorts:connection-result", { ok: !!connected.ok, reason: connected.reason || "", mode: connected.mode || "", edge: debugCellSummary(connected.edge), flipCell: debugCellSummary(plan.flipCell) });
            if (!connected.ok) { setPartCellFlipped(plan.flipCell, previous); syncConnectionEdgeVisualAnchorsForCell(session.moduleCell, plan.flipCell); irrigationDebug("flipAndConnectSelectedPorts:rollback", { reason: connected.reason || "", restoredAttr: getCellAttr(plan.flipCell, ATTRS.PART_FLIPPED, ""), restoredFlipped: isPartCellFlipped(plan.flipCell), flipCell: debugCellSummary(plan.flipCell) }); return connected; } // CHANGE
            syncConnectionEdgeVisualAnchorsForCell(session.moduleCell, plan.flipCell); // NEW
            scheduleHudGraphStateSync(session.moduleCell);
            return connected;
        });
        session.message = result.ok ? (result.mode === "merge" ? "Fitting flipped and assemblies merged." : result.mode === "direct" ? "Fitting flipped and direct link connected." : "Fitting flipped and pipe edge connected.") : result.reason;
        if (result.ok) session.selectedPorts = [];
        if (result.ok) session.selectedBoundaries = [];
        renderIrrigationMode(session);
    }

    function disconnectSelectedConnections(session, boundaries) {
        const selected = uniqueBoundaries(boundaries && boundaries.length ? boundaries : selectedOccupiedBoundaries(session));
        const disconnected = runIrrigationEdit("disconnectSelectedConnections", function () { let count = 0; model.beginUpdate && model.beginUpdate(); try { count = disconnectBoundaries(session.moduleCell, selected); } finally { model.endUpdate && model.endUpdate(); } scheduleHudGraphStateSync(session.moduleCell); return count; });
        session.selectedPorts = [];
        session.selectedBoundaries = [];
        session.focusedConnectionBoundary = null;
        session.message = disconnected ? "Disconnected " + disconnected + (disconnected === 1 ? " connection." : " connections.") : "No selected connections were occupied.";
        renderIrrigationMode(session);
    }

    function resolveInlineConnectionAction(session) {
        const ports = selectedValidPorts(session);
        const selectedBoundaries = selectedValidBoundaries(session);
        const anchorPort = normalizePort(session && session.inlineActionAnchorPort || {});
        const anchorBoundary = anchorPort.cellId ? boundaryForPort(session.moduleCell, anchorPort) : null;
        const focusedBoundary = normalizeBoundary(session && session.focusedConnectionBoundary || {});
        const selectedKeys = selectedBoundaries.map(boundaryKey);
        const disconnectBoundary = anchorBoundary && selectedKeys.indexOf(boundaryKey(anchorBoundary)) >= 0 ? anchorBoundary : null;
        irrigationDebug("inlineConnectionAction:resolve-start", { ports: ports.map(function (port) { return debugPortSummary(session.moduleCell, port); }), selectedBoundaries, anchorPort: anchorPort.cellId ? debugPortSummary(session.moduleCell, anchorPort) : null, focusedBoundary });
        if (disconnectBoundary && boundaryExists(session.moduleCell, disconnectBoundary)) { irrigationDebug("inlineConnectionAction:resolved", { type: "disconnect", reason: "Selected anchor boundary is occupied.", boundary: disconnectBoundary, anchorPort: debugPortSummary(session.moduleCell, anchorPort) }); return { type: "disconnect", label: "Disconnect", title: "Disconnect selected irrigation connection", boundary: disconnectBoundary, boundaries: [disconnectBoundary], anchorPort }; }
        const focusedDisconnectBoundary = boundaryKey(focusedBoundary) && selectedKeys.indexOf(boundaryKey(focusedBoundary)) >= 0 ? focusedBoundary : null;
        if (focusedDisconnectBoundary && boundaryExists(session.moduleCell, focusedDisconnectBoundary)) { irrigationDebug("inlineConnectionAction:resolved", { type: "disconnect", reason: "Focused selected boundary is occupied.", boundary: focusedDisconnectBoundary }); return { type: "disconnect", label: "Disconnect", title: "Disconnect selected irrigation connection", boundary: focusedDisconnectBoundary, boundaries: [focusedDisconnectBoundary] }; }
        if (ports.length === 2 && selectedBoundaries.length === 0) {
            const free = ports.filter(function (port) { return isPortFree(session.moduleCell, port); });
            const storedOrdered = free.length === 2 ? orderedConnectionPorts(free) : null;
            const visualOrdered = free.length === 2 ? orderedVisualConnectionPorts(session.moduleCell, free) : null;
            const ordered = free.length === 2 ? storedAndVisualDirectConnectionPorts(session.moduleCell, free) : null;
            const direct = ordered ? validatePortConnection(session.moduleCell, ordered.source, ordered.target) : { ok: false };
            irrigationDebug("inlineConnectionAction:selected-pair", { freeCount: free.length, ordered: ordered ? { source: debugPortSummary(session.moduleCell, ordered.source), target: debugPortSummary(session.moduleCell, ordered.target) } : null, storedOrdered: storedOrdered ? { source: debugPortSummary(session.moduleCell, storedOrdered.source), target: debugPortSummary(session.moduleCell, storedOrdered.target) } : null, visualOrdered: visualOrdered ? { source: debugPortSummary(session.moduleCell, visualOrdered.source), target: debugPortSummary(session.moduleCell, visualOrdered.target) } : null, ports: ports.map(function (port) { return debugPortSummary(session.moduleCell, port); }) });
            if (storedOrdered && !ordered) irrigationDebug("inlineConnectionAction:visual-direct-rejected", { reason: "Stored direct pair is not visually outlet to inlet.", storedOrdered: { source: debugPortSummary(session.moduleCell, storedOrdered.source), target: debugPortSummary(session.moduleCell, storedOrdered.target) }, visualOrdered: visualOrdered ? { source: debugPortSummary(session.moduleCell, visualOrdered.source), target: debugPortSummary(session.moduleCell, visualOrdered.target) } : null });
            irrigationDebug("inlineConnectionAction:direct-result", { ok: !!direct.ok, reason: direct.reason || "", mode: direct.mode || "", freeCount: free.length, ordered: ordered ? { source: debugPortSummary(session.moduleCell, ordered.source), target: debugPortSummary(session.moduleCell, ordered.target) } : null });
            if (direct.ok) { irrigationDebug("inlineConnectionAction:resolved", { type: "connect", source: debugPortSummary(session.moduleCell, ordered.source), target: debugPortSummary(session.moduleCell, ordered.target) }); return { type: "connect", label: "Connect", title: "Connect selected irrigation ports", source: ordered.source, target: ordered.target, anchorPort: ports[ports.length - 1] }; }
            const flip = typeof flipConnectPlanForPorts === "function" && free.length === 2 ? flipConnectPlanForPorts(session.moduleCell, free) : { ok: false };
            irrigationDebug("inlineConnectionAction:flip-result", { ok: !!flip.ok, reason: flip.reason || "", mode: flip.mode || "", freeCount: free.length, flipCell: debugCellSummary(flip.flipCell), ports: free.map(function (port) { return debugPortSummary(session.moduleCell, port); }) });
            if (!flip.ok && flip.sizeMismatchAttempts && flip.sizeMismatchAttempts.length) { const mismatchKey = free.map(portKey).sort().join("|") + "|" + flip.sizeMismatchAttempts.map(function (attempt) { return [attempt.sourceConnector && attempt.sourceConnector.nominalSize || "", attempt.targetConnector && attempt.targetConnector.nominalSize || ""].join(">"); }).sort().join(","); if (session.lastFlipSizeMismatchDebugKey !== mismatchKey) { session.lastFlipSizeMismatchDebugKey = mismatchKey; irrigationDebug("inlineConnectionAction:flip-size-mismatch", { attempts: debugFlipPlanSizeMismatchAttempts(session.moduleCell, flip) }); } }
            if (flip.ok) { irrigationDebug("inlineConnectionAction:resolved", { type: "flip-connect", flipCell: debugCellSummary(flip.flipCell), ports: free.map(function (port) { return debugPortSummary(session.moduleCell, port); }) }); return { type: "flip-connect", label: "Flip and Connect", title: "Flip a reversible fitting and connect selected irrigation ports", ports: free, anchorPort: ports[ports.length - 1] }; }
            irrigationDebug("inlineConnectionAction:none", { reason: "Two selected free ports cannot connect directly or by flipping.", directReason: direct.reason || "", flipReason: flip.reason || "", ports: ports.map(function (port) { return debugPortSummary(session.moduleCell, port); }) });
        } else {
            irrigationDebug("inlineConnectionAction:none", { reason: "Inline action requires two selected ports and no selected boundaries.", portCount: ports.length, boundaryCount: selectedBoundaries.length, ports: ports.map(function (port) { return debugPortSummary(session.moduleCell, port); }), selectedBoundaries });
        }
        return null;
    }

    function renderInlineConnectionAction(session, action) {
        if (!action) return;
        const anchor = inlineConnectionActionAnchorNode(session, action) || inlineConnectionActionAnchorBounds(session, action);
        if (!anchor) return;
        const btn = button(action.label, function (ev) {
            if (ev && ev.stopPropagation) ev.stopPropagation();
            if (action.type === "connect") connectSelectedPorts(session, action.source, action.target);
            else if (action.type === "flip-connect") flipAndConnectSelectedPorts(session, action.ports);
            else disconnectSelectedConnections(session, action.boundaries);
        });
        btn.className = "trellis-irrigation-inline-connection-action trellis-irrigation-inline-connection-action-" + action.type;
        btn.title = action.title;
        btn.style.cssText = inlineConnectionActionStyle(action.type);
        shieldHudEvents(btn);
        const layer = appendIrrigationControlNode(btn);
        if (!layer) return;
        positionInlineConnectionAction(btn, anchor, layer.parentNode || graph.container);
        session.inlineActionNodes.push(btn);
    }

    function inlineConnectionActionStyle(type) {
        const disconnect = type === "disconnect";
        const border = disconnect ? "#b91c1c" : "#15803d";
        const background = disconnect ? "#fee2e2" : "#dcfce7";
        const color = disconnect ? "#7f1d1d" : "#14532d";
        return "position:absolute;z-index:" + GRAPH_OVERLAY_Z.CONTROL_TOP + ";padding:5px 8px;border:1px solid " + border + ";border-radius:4px;background:" + background + ";color:" + color + ";box-shadow:0 2px 8px rgba(0,0,0,.20);font:bold 12px Arial,sans-serif;cursor:pointer;white-space:nowrap;box-sizing:border-box;max-width:160px;pointer-events:auto;";
    }

    function inlineConnectionActionAnchorBounds(session, action) {
        if (action.type === "connect" || action.type === "flip-connect") return portBadgeBounds(session, action.anchorPort);
        return boundaryActionAnchorBounds(session, action.boundary);
    }

    function inlineConnectionActionAnchorNode(session, action) {
        if (!session || !action) return null;
        if (action.type === "connect" || action.type === "flip-connect") return portBadgeNodeForPort(session, action.anchorPort);
        const anchorPort = normalizePort(session.inlineActionAnchorPort || {});
        if (anchorPort.cellId) return portBadgeNodeForPort(session, anchorPort);
        if (action.type === "disconnect") return connectionBadgeNodeForBoundary(session, action.boundary);
        return null;
    }

    function portBadgeNodeForPort(session, port) {
        const normalized = normalizePort(port);
        if (!normalized.cellId || !session.portBadgeNodeByKey) return null;
        return session.portBadgeNodeByKey.get(portKey(normalized)) || null;
    }

    function connectionBadgeNodeForBoundary(session, boundary) {
        const key = boundaryKey(boundary);
        if (!key || !session.connectionBadgeNodeByKey) return null;
        return session.connectionBadgeNodeByKey.get(key) || null;
    }

    function boundaryActionAnchorBounds(session, boundary) {
        const normalized = normalizeBoundary(boundary);
        const anchorPort = normalizePort(session.inlineActionAnchorPort || {});
        if (anchorPort.cellId && boundaryKey(boundaryForPort(session.moduleCell, anchorPort)) === boundaryKey(normalized)) return portBadgeBounds(session, anchorPort);
        if (normalized.type === "internal") {
            const upstream = findCellById(session.moduleCell, normalized.upstreamId);
            const downstream = findCellById(session.moduleCell, normalized.downstreamId);
            return upstream && downstream ? internalConnectionBadgeBounds(upstream, downstream) : null;
        }
        const edge = normalized.type === "edge" ? findCellById(session.moduleCell, normalized.edgeId) : null;
        const sourcePort = edge ? portForConnectionEdge(edge, true) : null;
        const targetPort = edge ? portForConnectionEdge(edge, false) : null;
        return portBadgeBounds(session, sourcePort) || portBadgeBounds(session, targetPort);
    }

    function portForConnectionEdge(edge, source) {
        const terminal = source ? edge && edge.source : edge && edge.target;
        if (!terminal) return null;
        return { cellId: getCellId(terminal), role: source ? "output" : "input", index: finiteNumber(getCellAttr(edge, source ? ATTRS.EDGE_SOURCE_PORT : ATTRS.EDGE_TARGET_PORT, 0), 0) };
    }

    function portBadgeBounds(session, port) {
        const normalized = normalizePort(port);
        const cell = portCell(session.moduleCell, normalized);
        if (!cell) return null;
        const state = cellState(cell);
        const total = Math.max(1, Math.floor(finiteNumber(portCapacityForCell(session.moduleCell, cell, normalized.role), 1)));
        const slot = (normalized.index + 1) / (total + 1);
        const width = portBadgeWidthForLabel(portDisplayLabel(session.moduleCell, normalized));
        return { x: state.x + state.width * slot - width / 2, y: normalized.role === "input" ? state.y - PORT_BADGE_SIZE - 4 : state.y + state.height + 4, width, height: PORT_BADGE_SIZE };
    }

    function internalConnectionBadgeBounds(upstream, downstream) {
        const up = cellState(upstream);
        const down = cellState(downstream);
        const width = portBadgeWidthForLabel("C");
        const right = Math.max(finiteNumber(up.x, 0) + finiteNumber(up.width, 0), finiteNumber(down.x, 0) + finiteNumber(down.width, 0));
        return { x: right + 4, y: (up.y + up.height + down.y) / 2 - PORT_BADGE_SIZE / 2, width, height: PORT_BADGE_SIZE };
    }

    function positionInlineConnectionAction(node, anchor, host) {
        const hostNode = host && host.namespaceURI !== "http://www.w3.org/2000/svg" ? host : graph.container;
        const bounds = inlineActionAnchorBoundsInHost(anchor, hostNode);
        if (!bounds) return;
        const gap = 6;
        const width = node.offsetWidth || node.clientWidth || 96;
        const height = node.offsetHeight || node.clientHeight || 28;
        const scrollLeft = finiteNumber(hostNode && hostNode.scrollLeft, 0);
        const scrollTop = finiteNumber(hostNode && hostNode.scrollTop, 0);
        const viewportWidth = hostNode && hostNode.clientWidth ? hostNode.clientWidth : graph.container && graph.container.clientWidth ? graph.container.clientWidth : 10000;
        const viewportHeight = hostNode && hostNode.clientHeight ? hostNode.clientHeight : graph.container && graph.container.clientHeight ? graph.container.clientHeight : 10000;
        const minLeft = scrollLeft + gap;
        const minTop = scrollTop + gap;
        const maxLeft = scrollLeft + viewportWidth - width - gap;
        const maxTop = scrollTop + viewportHeight - height - gap;
        let left = finiteNumber(bounds.x, 0) + finiteNumber(bounds.width, PORT_BADGE_SIZE) + gap;
        if (left + width > scrollLeft + viewportWidth - gap) left = finiteNumber(bounds.x, 0) - width - gap;
        const top = finiteNumber(bounds.y, 0) + finiteNumber(bounds.height, PORT_BADGE_SIZE) / 2 - height / 2;
        node.style.left = Math.round(Math.max(minLeft, Math.min(left, maxLeft))) + "px";
        node.style.top = Math.round(Math.max(minTop, Math.min(top, maxTop))) + "px";
    }

    function inlineActionAnchorBoundsInHost(anchor, host) {
        if (!anchor) return null;
        if (anchor.getBoundingClientRect && host && host.getBoundingClientRect) {
            const rect = anchor.getBoundingClientRect();
            const hostRect = host.getBoundingClientRect();
            return {
                x: finiteNumber(rect.left, 0) - finiteNumber(hostRect.left, 0) + finiteNumber(host.scrollLeft, 0),
                y: finiteNumber(rect.top, 0) - finiteNumber(hostRect.top, 0) + finiteNumber(host.scrollTop, 0),
                width: finiteNumber(rect.width, finiteNumber(rect.right, 0) - finiteNumber(rect.left, 0)),
                height: finiteNumber(rect.height, finiteNumber(rect.bottom, 0) - finiteNumber(rect.top, 0))
            };
        }
        return anchor.x !== undefined || anchor.y !== undefined ? anchor : null;
    }

    function renderBridgeSuggestions(session, hud, orderedPorts, options) { // CHANGE
        const suggestions = bridgeSuggestionsForPorts(session.moduleCell, orderedPorts.source, orderedPorts.target);
        if (!suggestions.length) { hud.appendChild(hudWarning("No bridge path found in the current catalog.")); return; }
        const wrap = document.createElement("div");
        wrap.className = "trellis-irrigation-bridge-suggestions";
        wrap.style.cssText = "display:flex;flex-direction:column;gap:5px;margin-top:6px;";
        if (!(options && options.hideTitle)) wrap.appendChild(hudText("Suggest Connection")); // CHANGE
        appendBridgeSuggestionGroup(session, wrap, "In stock", suggestions.filter(function (suggestion) { return !suggestion.purchaseNeededParts; }), orderedPorts);
        appendBridgeSuggestionGroup(session, wrap, "Needs purchase", suggestions.filter(function (suggestion) { return suggestion.purchaseNeededParts; }), orderedPorts);
        hud.appendChild(wrap);
    }

    function appendBridgeSuggestionGroup(session, wrap, title, suggestions, orderedPorts) {
        if (!suggestions.length) return;
        const header = document.createElement("div");
        header.className = "trellis-irrigation-bridge-group";
        header.style.cssText = "font-weight:700;margin-top:4px;color:#1f2937;";
        header.textContent = title;
        wrap.appendChild(header);
        suggestions.forEach(function (suggestion, index) {
            const label = suggestion.labels.join(" -> ") + " (" + formatMoney(suggestion.purchaseNeededCost) + ")";
            wrap.appendChild(button((index + 1) + ". " + label, function () { applyBridgeSuggestion(session, orderedPorts.source, orderedPorts.target, suggestion); }));
        });
    }

    function bridgeSuggestionsForPorts(moduleCell, sourcePort, targetPort) {
        const bridge = ConnectorRules.bridgeSuggestionEligibility(moduleCell, sourcePort, targetPort);
        if (!bridge.ok) return [];
        const sourceConnector = bridge.sourceConnector;
        const targetConnector = bridge.targetConnector;
        const catalog = readCatalog(moduleCell);
        const sourcePart = { id: "source_port", name: "Selected outlet", category: "source_adapter", stockState: "in_stock", cost: 0, connectors: { inputs: 0, outputs: 1, output: sourceConnector }, specs: {} };
        const targetRequirement = { connectorType: targetConnector.type, nominalSize: targetConnector.nominalSize, pipeType: targetConnector.pipeType || "", pipeConnection: !!targetConnector.pipeConnection };
        const items = sortRawCatalogParts(catalog.items).map(normalizeCatalogPart).filter(function (part) { return part && bridgeSuggestionPartAllowed(part) && validateCatalogPart(part).ok; }); // CHANGE: bridge planning keeps raw candidate order so display taxonomy does not alter selected chains
        const queue = [{ last: sourcePart, parts: [], seen: new Set(["source_port"]) }];
        const results = [];
        while (queue.length && results.length < 40) {
            const state = queue.shift();
            if (state.parts.length > 0 && connectorRecordsMatch(state.last.connectors.output, targetConnector, targetRequirement).ok) {
                results.push(makeHealSuggestion(state.parts));
                continue;
            }
            if (state.parts.length >= 5) continue;
            items.forEach(function (candidate) {
                if (!candidate.id || state.seen.has(candidate.id)) return;
                bridgeSearchPartOptions(candidate).forEach(function (option) { // NEW
                    if (!connectorRecordsMatch(state.last.connectors.output, option.connectors.input, targetRequirement).ok) return; // CHANGE
                    const nextSeen = new Set(Array.from(state.seen)); // CHANGE
                    nextSeen.add(candidate.id); // CHANGE
                    const nextParts = state.parts.concat([{ part: candidate, flipped: option.flipped }]); // NEW
                    if (connectorRecordsMatch(option.connectors.output, targetConnector, targetRequirement).ok) { results.push(makeHealSuggestion(nextParts)); return; } // NEW
                    queue.push({ last: option, parts: nextParts, seen: nextSeen }); // CHANGE
                }); // NEW
            });
        }
        return results.sort(function (a, b) {
            const stockA = a.purchaseNeededParts ? 1 : 0;
            const stockB = b.purchaseNeededParts ? 1 : 0;
            return (stockA - stockB) || (a.purchaseNeededCost - b.purchaseNeededCost) || (a.totalParts - b.totalParts);
        }).slice(0, 5);
    }

    function applyBridgeSuggestion(session, sourcePort, targetPort, suggestion) {
        if (activeIrrigationEditDepth === 0) return runIrrigationEdit("applyBridgeSuggestion", function () { return applyBridgeSuggestion(session, sourcePort, targetPort, suggestion); });
        const sourceCell = portCell(session.moduleCell, sourcePort);
        const targetCell = portCell(session.moduleCell, targetPort);
        const targetAssembly = findAssemblyAncestor(targetCell);
        if (!sourceCell || !targetCell || !targetAssembly) { session.message = "Bridge endpoints are no longer available."; renderIrrigationMode(session); return; }
        const catalog = readCatalog(session.moduleCell); // NEW
        const parts = suggestion.parts ? suggestion.parts.map(function (entry) { return { part: partById(catalog, entry.partId), flipped: !!entry.flipped }; }).filter(function (entry) { return !!entry.part; }) : (suggestion.partIds || []).map(function (partId) { return partById(catalog, partId); }).filter(Boolean); // CHANGE
        const plan = ConnectionChainPlanner.planBridge(session.moduleCell, sourcePort, targetPort, parts);
        const result = plan.ok ? ConnectionChainPlanner.applyBridge(session.moduleCell, plan) : plan;
        const ok = !!(result && result.ok);
        if (!ok) session.message = result && result.reason || "Bridge connection could not be applied.";
        if (ok) { session.message = "Bridge connection applied."; session.selectedPorts = []; session.selectedBoundaries = []; session.bridgePorts = null; }
        scheduleHudGraphStateSync(session.moduleCell);
        renderIrrigationMode(session);
    }

    function bridgeSuggestionPartAllowed(part) {
        const p = normalizeCatalogPart(part);
        return !!(p && BRIDGE_SUGGESTION_CATEGORIES.has(p.category) && p.connectors.inputs === 1 && p.connectors.outputs === 1);
    }

    function bridgeSearchPartOptions(part) { // NEW
        return partConnectorOrientations(part).map(function (orientation) { // NEW
            return Object.assign({}, orientation.part, { // NEW
                flipped: orientation.flipped, // NEW
                connectors: { inputs: 1, outputs: 1, input: orientation.inputConnector, output: orientation.outputConnector } // NEW
            }); // NEW
        }); // NEW
    } // NEW

    function planBridgeConnectionChain(moduleCell, sourcePort, targetPort, parts) {
        const bridge = ConnectorRules.bridgeSuggestionEligibility(moduleCell, sourcePort, targetPort);
        if (!bridge.ok) return Object.assign({}, bridge, { ok: false });
        const partEntries = (parts || []).map(normalizeBridgePlanPartEntry).filter(Boolean); // CHANGE
        if (!partEntries.length) return { ok: false, reason: "No bridge parts selected." };
        if (!partEntries.every(function (entry) { return bridgeSuggestionPartAllowed(entry.part); })) return { ok: false, reason: "Bridge suggestions must use one-inlet, one-outlet adapters or fittings." }; // CHANGE
        const sourceNode = { kind: "existing", cell: bridge.sourceCell, port: normalizePort(sourcePort), outputIndex: bridge.source.index }; // NEW
        const targetNode = { kind: "existing", cell: bridge.targetCell, port: normalizePort(targetPort), inputIndex: bridge.target.index }; // NEW
        const resolved = resolveBridgePartNodes(moduleCell, sourceNode, targetNode, partEntries); // NEW
        if (!resolved.ok) return { ok: false, reason: resolved.reason || "Bridge parts are not compatible." }; // NEW
        const nodes = [sourceNode].concat(resolved.partNodes).concat([targetNode]); // CHANGE
        const plannedEntries = resolved.partNodes.map(function (node) { return { part: node.part, flipped: !!node.flipped }; }); // NEW
        return { ok: true, sourcePort: normalizePort(sourcePort), targetPort: normalizePort(targetPort), sourceCell: bridge.sourceCell, targetCell: bridge.targetCell, parts: plannedEntries.map(function (entry) { return entry.part; }), partEntries: plannedEntries, nodes, hops: resolved.hops, hasPipe: resolved.hops.some(function (hop) { return hop.mode === "pipe"; }) }; // CHANGE
    }

    function normalizeBridgePlanPartEntry(entry) { // NEW
        const hasFixedFlip = !!(entry && typeof entry === "object" && Object.prototype.hasOwnProperty.call(entry, "flipped")); // NEW
        const part = normalizeCatalogPart(entry && entry.part ? entry.part : entry); // NEW
        if (!part) return null; // NEW
        return { part, flipped: !!(entry && entry.flipped), fixedFlipped: hasFixedFlip }; // NEW
    } // NEW

    function bridgePlanNodeOptions(entry, index) { // NEW
        const options = partConnectorOrientations(entry.part); // NEW
        return options.filter(function (option) { return !entry.fixedFlipped || option.flipped === entry.flipped; }).map(function (option) { // NEW
            return { kind: "part", part: entry.part, partIndex: index, inputIndex: 0, outputIndex: 0, flipped: option.flipped }; // NEW
        }); // NEW
    } // NEW

    function resolveBridgePartNodes(moduleCell, sourceNode, targetNode, partEntries) { // NEW
        function walk(index, previousNode, partNodes, hops) { // NEW
            if (index >= partEntries.length) { // NEW
                const finalHop = bridgeHopDecision(moduleCell, previousNode, targetNode); // NEW
                return finalHop.ok ? { ok: true, partNodes, hops: hops.concat([finalHop]) } : finalHop; // NEW
            } // NEW
            let fallback = null; // NEW
            const options = bridgePlanNodeOptions(partEntries[index], index); // NEW
            for (let i = 0; i < options.length; i++) { // NEW
                const node = options[i]; // NEW
                const hop = bridgeHopDecision(moduleCell, previousNode, node); // NEW
                if (!hop.ok) { if (!fallback) fallback = hop; continue; } // NEW
                const resolved = walk(index + 1, node, partNodes.concat([node]), hops.concat([hop])); // NEW
                if (resolved.ok) return resolved; // NEW
                if (!fallback) fallback = resolved; // NEW
            } // NEW
            return fallback || { ok: false, reason: "Bridge parts are not compatible." }; // NEW
        } // NEW
        return walk(0, sourceNode, [], []); // NEW
    } // NEW

    function bridgeHopDecision(moduleCell, sourceNode, targetNode) { // NEW
        const sourceConnector = chainNodeOutputConnector(moduleCell, sourceNode); // NEW
        const targetConnector = chainNodeInputConnector(moduleCell, targetNode); // NEW
        const compatibility = ConnectorRules.connectionMode(moduleCell, sourceConnector, targetConnector); // NEW
        return compatibility.ok ? Object.assign({}, compatibility, { sourceNode, targetNode, sourceConnector, targetConnector }) : Object.assign({}, compatibility, { sourceNode, targetNode, sourceConnector, targetConnector }); // NEW
    } // NEW

    function chainNodeInputConnector(moduleCell, node) {
        if (!node) return null;
        if (node.kind === "existing") return ConnectorRules.portConnectorForCell(moduleCell, node.cell, "input");
        return node.part && node.part.connectors && (node.flipped ? node.part.connectors.output : node.part.connectors.input); // CHANGE
    }

    function chainNodeOutputConnector(moduleCell, node) {
        if (!node) return null;
        if (node.kind === "existing") return ConnectorRules.portConnectorForCell(moduleCell, node.cell, "output");
        return node.part && node.part.connectors && (node.flipped ? node.part.connectors.input : node.part.connectors.output); // CHANGE
    }

    function applyBridgeConnectionChain(moduleCell, plan) {
        if (!plan || !plan.ok) return plan || { ok: false, reason: "Bridge plan is unavailable." };
        const current = ConnectorRules.bridgeSuggestionEligibility(moduleCell, plan.sourcePort, plan.targetPort);
        if (!current.ok) return { ok: false, reason: current.reason || "Bridge endpoints are no longer available." };
        if (!plan.hasPipe) return applyInlineBridgeConnectionChain(moduleCell, plan);
        return applyExternalBridgeConnectionChain(moduleCell, plan);
    }

    function applyExternalPartConnection(moduleCell, row, part) {
        const decision = dropdownPartConnectionDecision(moduleCell, row, part);
        if (!decision || !decision.pipeRequired) return null;
        if (!decision.ok || decision.mode !== "pipe") return { cell: null, message: decision.reason || "Part could not be connected with pipe." };
        const createdAssemblies = [];
        const createdEdges = [];
        try {
            const created = createPartAssembly(moduleCell, part, linearDropdownPartAnchor(row), decision.flipped); // CHANGE
            if (!created || !created.assembly || !created.partCell) throw new Error("Part could not be created.");
            createdAssemblies.push(created.assembly);
            const sourceCell = row.role === "input" ? created.partCell : row.cell;
            const targetCell = row.role === "input" ? row.cell : created.partCell;
            const sourceIndex = row.role === "input" ? 0 : row.index;
            const targetIndex = row.role === "input" ? row.index : 0;
            const edge = createPlannedConnectionEdge(moduleCell, sourceCell, targetCell, decision, sourceIndex, targetIndex);
            if (!edge) throw new Error("Part could not be connected as a separate assembly.");
            createdEdges.push(edge);
            return { cell: created.assembly, message: "Part assembly connected with pipe." };
        } catch (err) {
            createdEdges.forEach(removeCellFromParent);
            createdAssemblies.forEach(removeCellFromParent);
        return { cell: null, message: err && err.message || "Part could not be connected as a separate assembly." };
        }
    }

    function selectedBridgeSuggestionPorts(session) {
        const ports = selectedValidPorts(session);
        if (ports.length !== 2 || selectedValidBoundaries(session).length) return null;
        const free = ports.filter(function (port) { return isPortFree(session.moduleCell, port); });
        const ordered = free.length === 2 ? orderedConnectionPorts(free) : null;
        if (!ordered) return null;
        return ConnectorRules.bridgeSuggestionEligibility(session.moduleCell, ordered.source, ordered.target).ok ? ordered : null;
    }

    function applyInlineBridgeConnectionChain(moduleCell, plan) {
        const targetAssembly = findAssemblyAncestor(plan.targetCell);
        if (!targetAssembly) return { ok: false, reason: "Bridge target assembly is unavailable." };
        const previousRows = assemblyPartCells(targetAssembly).map(function (cell) { return { cell, geometry: Object.assign({}, getGeometry(cell) || {}) }; });
        const previousAssemblyGeometry = Object.assign({}, getGeometry(targetAssembly) || {});
        const inserted = insertBridgePartsBefore(moduleCell, targetAssembly, plan.targetCell, bridgePlanEntries(plan)); // CHANGE
        moveBridgeAssemblies(plan.sourceCell, plan.targetCell);
        const chain = [plan.sourceCell].concat(inserted).concat([plan.targetCell]);
        for (let i = 0; i < chain.length - 1; i++) {
            if (findAssemblyAncestor(chain[i]) === findAssemblyAncestor(chain[i + 1]) && internalNeighborForPort(chain[i], "output") === chain[i + 1]) continue;
            const result = createAssemblyConnection(moduleCell, { cellId: getCellId(chain[i]), role: "output", index: 0 }, { cellId: getCellId(chain[i + 1]), role: "input", index: 0 });
            if (!result.ok) {
                inserted.forEach(removeCellFromParent);
                previousRows.forEach(function (row) { if (row.cell && row.cell.geometry) row.cell.geometry = Object.assign({}, row.geometry); });
                if (targetAssembly.geometry) targetAssembly.geometry = previousAssemblyGeometry;
                return { ok: false, reason: result.reason };
            }
        }
        return { ok: true, createdAssemblies: [], createdEdges: [] };
    }

    function applyExternalBridgeConnectionChain(moduleCell, plan) {
        const sourceAssembly = findAssemblyAncestor(plan.sourceCell);
        const prefixCount = sourceDirectBridgePrefixCount(plan, sourceAssembly);
        const previousSourceRows = sourceAssembly ? assemblyPartCells(sourceAssembly).map(function (cell) { return { cell, geometry: Object.assign({}, getGeometry(cell) || {}) }; }) : [];
        const previousSourceGeometry = sourceAssembly ? Object.assign({}, getGeometry(sourceAssembly) || {}) : null;
        const appendedPrefix = [];
        const createdAssemblies = [];
        const createdEdges = [];
        const insertedTailParts = []; // NEW
        const tailSnapshots = []; // NEW
        try {
            const cellsByPartIndex = new Map();
            appendSourceBridgePrefix(sourceAssembly, plan, prefixCount).forEach(function (cell, index) {
                appendedPrefix.push(cell);
                cellsByPartIndex.set(index, cell);
            });
            const groups = bridgePartGroupsForPlan(plan, prefixCount);
            const tailGroup = finalDirectTailGroupForPlan(moduleCell, plan, groups); // NEW
            const externalGroups = groups.filter(function (group) { return group !== tailGroup; }); // NEW
            let externalGroupIndex = 0; // NEW
            groups.forEach(function (group, groupIndex) {
                if (group === tailGroup) { // NEW
                    const inserted = insertBridgeTailGroupIntoTargetAssembly(moduleCell, plan, group); // NEW
                    insertedTailParts.push.apply(insertedTailParts, inserted.parts); // NEW
                    tailSnapshots.push(inserted.snapshot); // NEW
                    group.partIndexes.forEach(function (partIndex, index) { cellsByPartIndex.set(partIndex, inserted.parts[index]); }); // NEW
                    return; // NEW
                } // NEW
                const created = createBridgePartAssembly(moduleCell, group.parts, bridgeGroupAnchor(plan.sourceCell, plan.targetCell, externalGroupIndex++, externalGroups.length)); // CHANGE
                createdAssemblies.push(created.assembly);
                group.partIndexes.forEach(function (partIndex, index) { cellsByPartIndex.set(partIndex, created.parts[index]); });
            });
            const resolvedNodes = plan.nodes.map(function (node) {
                if (node.kind === "existing") return Object.assign({}, node);
                return Object.assign({}, node, { cell: cellsByPartIndex.get(node.partIndex) });
            });
            for (let i = 0; i < plan.hops.length; i++) {
                const sourceNode = resolvedNodes[i];
                const targetNode = resolvedNodes[i + 1];
                if (!sourceNode.cell || !targetNode.cell) throw new Error("Bridge part could not be created.");
                if (findAssemblyAncestor(sourceNode.cell) === findAssemblyAncestor(targetNode.cell) && internalNeighborForPort(sourceNode.cell, "output") === targetNode.cell) continue;
                if (i === plan.hops.length - 1 && plan.hops[i].mode === "direct") { // CHANGE
                    const result = createAssemblyConnection(moduleCell, { cellId: getCellId(sourceNode.cell), role: "output", index: sourceNode.outputIndex || 0 }, { cellId: getCellId(targetNode.cell), role: "input", index: targetNode.inputIndex || 0 }); // CHANGE
                    if (!result.ok) throw new Error(result.reason || "Bridge connection edge could not be created."); // CHANGE
                    if (result.edge) createdEdges.push(result.edge); // CHANGE
                    continue; // CHANGE
                }
                const edge = createPlannedConnectionEdge(moduleCell, sourceNode.cell, targetNode.cell, plan.hops[i], sourceNode.outputIndex || 0, targetNode.inputIndex || 0);
                if (!edge) throw new Error("Bridge connection edge could not be created.");
                createdEdges.push(edge);
            }
            return { ok: true, createdAssemblies, createdEdges };
        } catch (err) {
            createdEdges.forEach(removeCellFromParent);
            createdAssemblies.forEach(removeCellFromParent);
            insertedTailParts.forEach(removeCellFromParent); // NEW
            tailSnapshots.forEach(restoreBridgeTailTargetSnapshot); // NEW
            appendedPrefix.forEach(removeCellFromParent);
            previousSourceRows.forEach(function (row) { if (row.cell && row.cell.geometry) row.cell.geometry = Object.assign({}, row.geometry); });
            if (sourceAssembly && sourceAssembly.geometry && previousSourceGeometry) sourceAssembly.geometry = previousSourceGeometry;
            return { ok: false, reason: err && err.message || "Bridge connection could not be applied." };
        }
    }

    function finalDirectTailGroupForPlan(moduleCell, plan, groups) { // NEW
        const entries = bridgePlanEntries(plan); // NEW
        if (!plan || !groups || !groups.length || !entries.length || !plan.hops || !plan.hops[entries.length] || plan.hops[entries.length].mode !== "direct") return null; // NEW
        const targetAssembly = findAssemblyAncestor(plan.targetCell); // NEW
        if (!targetAssembly || assemblyType(targetAssembly) === "bed") return null; // NEW
        const lastPartIndex = entries.length - 1; // NEW
        const group = groups.find(function (entry) { return entry.partIndexes.indexOf(lastPartIndex) >= 0; }); // NEW
        if (!group) return null; // NEW
        const lastPart = entries[lastPartIndex] && entries[lastPartIndex].part; // NEW
        const finalDecision = ConnectorRules.connectionMode(moduleCell, partOutputConnectorForOrientation(lastPart, entries[lastPartIndex].flipped), ConnectorRules.portConnectorForCell(moduleCell, plan.targetCell, "input")); // NEW
        return finalDecision.ok && finalDecision.mode === "direct" ? group : null; // NEW
    } // NEW

    function partOutputConnectorForOrientation(part, flipped) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        if (!p || !p.connectors) return null; // NEW
        return flipped ? p.connectors.input : p.connectors.output; // NEW
    } // NEW

    function insertBridgeTailGroupIntoTargetAssembly(moduleCell, plan, group) { // NEW
        const targetAssembly = findAssemblyAncestor(plan.targetCell); // NEW
        if (!targetAssembly) throw new Error("Bridge target assembly is unavailable."); // NEW
        const targetParts = assemblyPartCells(targetAssembly); // NEW
        const targetIndex = targetParts.indexOf(plan.targetCell); // NEW
        if (targetIndex < 0) throw new Error("Bridge target part is unavailable."); // NEW
        const snapshot = { assembly: targetAssembly, geometry: Object.assign({}, getGeometry(targetAssembly) || {}), rows: targetParts.map(function (cell) { return { cell, geometry: Object.assign({}, getGeometry(cell) || {}) }; }) }; // NEW
        const inserted = group.parts.map(function (entry, index) { return createAssemblyPartCell(targetAssembly, installedPartDisplayName(entry.part, entry.flipped), assemblyPartCellAttrs(entry.part, entry.flipped), targetIndex + index); }); // NEW
        const ordered = targetParts.slice(0, targetIndex).concat(inserted, targetParts.slice(targetIndex)); // NEW
        ordered.forEach(function (cell, index) { setGeometry(cell, { y: assemblyPartY(index) }); }); // CHANGE
        resizeAssemblyToChildren(targetAssembly); // NEW
        return { parts: inserted, snapshot }; // NEW
    } // NEW

    function restoreBridgeTailTargetSnapshot(snapshot) { // NEW
        if (!snapshot || !snapshot.assembly) return; // NEW
        (snapshot.rows || []).forEach(function (row) { if (row.cell && row.cell.geometry) row.cell.geometry = Object.assign({}, row.geometry); }); // NEW
        if (snapshot.assembly.geometry) snapshot.assembly.geometry = Object.assign({}, snapshot.geometry || {}); // NEW
    } // NEW

    function sourceDirectBridgePrefixCount(plan, sourceAssembly) {
        if (!plan || !sourceAssembly || assemblyType(sourceAssembly) === "bed") return 0;
        let count = 0;
        while (count < bridgePlanEntries(plan).length && plan.hops[count] && plan.hops[count].mode === "direct") count++; // CHANGE
        return count;
    }

    function appendSourceBridgePrefix(sourceAssembly, plan, count) {
        if (!sourceAssembly || count <= 0) return [];
        const sourceIndex = assemblyPartCells(sourceAssembly).indexOf(plan.sourceCell);
        const insertAt = sourceIndex < 0 ? assemblyPartCells(sourceAssembly).length : sourceIndex + 1;
        const inserted = [];
        const entries = bridgePlanEntries(plan); // NEW
        for (let i = 0; i < count; i++) inserted.push(insertAssemblyPartAt(sourceAssembly, entries[i].part, insertAt + i, entries[i].flipped)); // CHANGE
        return inserted;
    }

    function bridgePartGroupsForPlan(plan, startIndex) {
        const groups = [];
        let current = null;
        bridgePlanEntries(plan).forEach(function (entry, index) { // CHANGE
            if (index < Math.max(0, Math.floor(finiteNumber(startIndex, 0)))) return;
            const hopBefore = plan.hops[index];
            if (!current || hopBefore.mode === "pipe") { current = { parts: [], partIndexes: [] }; groups.push(current); }
            current.parts.push(entry); // CHANGE
            current.partIndexes.push(index);
        });
        return groups;
    }

    function createBridgePartAssembly(moduleCell, parts, anchor) {
        const created = createPartAssembly(moduleCell, parts[0].part, anchor, parts[0].flipped); // CHANGE
        const cells = [created.partCell];
        for (let i = 1; i < parts.length; i++) cells.push(insertAssemblyPartAt(created.assembly, parts[i].part, assemblyPartCells(created.assembly).length, parts[i].flipped)); // CHANGE
        return { assembly: created.assembly, parts: cells };
    }

    function bridgePlanEntries(plan) { // NEW
        if (plan && Array.isArray(plan.partEntries)) return plan.partEntries; // NEW
        return (plan && plan.parts || []).map(function (part) { return { part, flipped: false }; }); // NEW
    } // NEW

    function bridgeGroupAnchor(sourceCell, targetCell, index, count) {
        const sourceAssembly = findAssemblyAncestor(sourceCell) || sourceCell;
        const targetAssembly = findAssemblyAncestor(targetCell) || targetCell;
        const sourceGeo = getGeometry(sourceAssembly) || {};
        const targetGeo = getGeometry(targetAssembly) || {};
        const slot = (index + 1) / (Math.max(1, count) + 1);
        const sourceX = finiteNumber(sourceGeo.x, 24);
        const sourceY = finiteNumber(sourceGeo.y, 72);
        const targetX = finiteNumber(targetGeo.x, sourceX);
        const targetY = finiteNumber(targetGeo.y, sourceY + 160);
        return { x: Math.round(sourceX + (targetX - sourceX) * slot), y: Math.round(sourceY + (targetY - sourceY) * slot) };
    }

    function createPlannedConnectionEdge(moduleCell, sourceCell, targetCell, hop, sourceIndex, targetIndex) {
        const attrs = { [ATTRS.EDGE_SOURCE_PORT]: String(sourceIndex || 0), [ATTRS.EDGE_TARGET_PORT]: String(targetIndex || 0) };
        let style = DIRECT_LINK_EDGE_STYLE;
        if (hop.mode === "pipe") { attrs[ATTRS.PIPE_EDGE] = "1"; attrs[ATTRS.DIRECT_LINK_EDGE] = ""; attrs[ATTRS.PIPE_PART_ID] = hop.pipePartId || ""; attrs[ATTRS.PART_STATE] = PART_STATE_PLANNED; style = pipeEdgeStyleForPart(moduleCell, hop.pipePartId || "", PIPE_EDGE_BASE_STYLE); }
        else { attrs[ATTRS.PIPE_EDGE] = ""; attrs[ATTRS.DIRECT_LINK_EDGE] = "1"; attrs[ATTRS.PIPE_PART_ID] = ""; }
        const label = connectionDisplayLabel(hop.sourceConnector, hop.targetConnector);
        attrs.label = label;
        let edge = null;
        programmaticEdgeInsertDepth++;
        try { edge = createEdge(moduleCell, sourceCell, targetCell, label, style, attrs); syncConnectionEdgeVisualAnchors(moduleCell, edge); } // CHANGE
        finally { programmaticEdgeInsertDepth = Math.max(0, programmaticEdgeInsertDepth - 1); }
        if (edge && graph.refresh) graph.refresh(edge);
        return edge;
    }

    function insertBridgePartsBefore(moduleCell, assembly, beforeCell, parts) {
        const shift = parts.length * ASSEMBLY_PART_HEIGHT; // CHANGE
        const existing = assemblyPartCells(assembly);
        model.beginUpdate && model.beginUpdate();
        try {
            existing.forEach(function (cell) {
                const geo = getGeometry(cell) || {};
                setGeometry(cell, { y: finiteNumber(geo.y, ASSEMBLY_HEADER_SIZE) + shift }); // CHANGE
            });
            const inserted = parts.map(function (part, index) {
                return createAssemblyPartCell(assembly, installedPartDisplayName(part.part, part.flipped), assemblyPartCellAttrs(part.part, part.flipped), index); // CHANGE
            });
            resizeAssemblyToChildren(assembly);
            return inserted;
        } finally { model.endUpdate && model.endUpdate(); }
    }

    function moveBridgeAssemblies(sourceCell, targetCell) {
        const sourceAssembly = findAssemblyAncestor(sourceCell);
        const targetAssembly = findAssemblyAncestor(targetCell);
        if (!sourceAssembly || !targetAssembly || sourceAssembly === targetAssembly) return;
        const sourceGeo = getGeometry(sourceAssembly) || {};
        if (connectedAssembly(sourceAssembly) && !connectedAssembly(targetAssembly)) {
            setGeometry(targetAssembly, { x: finiteNumber(sourceGeo.x, 24), y: finiteNumber(sourceGeo.y, 72) + finiteNumber(sourceGeo.height, 120) + 40 });
        }
    }

    function renderSourceEditFields(session, hud, cell) {
        const profile = endpointProfile(cell);
        const form = document.createElement("div");
        form.className = "trellis-irrigation-source-edit";
        form.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:8px 0;";
        const connectorOptions = catalogConnectorOptions(session.moduleCell);
        const connector = addSelectField(form, "Connector", ensureOptionValue(connectorOptions.types, profile.connectorType || "barb"), profile.connectorType || "barb");
        const size = addSelectField(form, "Size", ensureOptionValue(connectorOptions.sizes, profile.nominalSize || "3/4"), profile.nominalSize || "3/4");
        const lockedConnectorFields = sourceConnectorFieldsLocked(session.moduleCell, cell);
        connector.disabled = lockedConnectorFields;
        size.disabled = lockedConnectorFields;
        const flow = addTextField(form, "Flow gpm", profile.usableFlowGpm == null ? "" : profile.usableFlowGpm);
        const pressure = addTextField(form, "Static psi", profile.staticPressurePsi == null ? "" : profile.staticPressurePsi);
        const save = button("Save Source", function () {
            runIrrigationEdit("saveSourceProfile", function () { const next = normalizeEndpointProfile(Object.assign({}, profile, {
                connectorType: connector.value.trim(),
                nominalSize: size.value.trim(),
                usableFlowGpm: finiteNumber(flow.value, null),
                staticPressurePsi: finiteNumber(pressure.value, null)
            }));
            setCellAttrs(cell, { [ATTRS.ENDPOINT_PROFILE_JSON]: JSON.stringify(next) });
            scheduleHudGraphStateSync(session.moduleCell);
            });
            renderIrrigationMode(session);
        });
        styleHudOutlineButton(save, HUD_OUTLINE_GREEN);
        form.appendChild(save);
        hud.appendChild(form);
    }

    function sourceEndpointForSelection(primary, primaryAssembly) {
        if (endpointType(primary) === "source") return primary;
        if (isAssembly(primary) && assemblyType(primary) === "source") return sourceEndpointInAssembly(primary);
        return null;
    }

    function sourceEndpointInAssembly(assembly) {
        return assemblyPartCells(assembly).filter(function (cell) { return endpointType(cell) === "source"; })[0] || null;
    }

    function createSourceTitleInput(session, sourceCell, assemblyCell) {
        const initialLabel = endpointLabel(sourceCell);
        const input = document.createElement("input");
        input.type = "text";
        input.value = initialLabel;
        input.className = "trellis-irrigation-source-title-input";
        input.setAttribute("aria-label", "Water source title");
        input.style.cssText = "display:block;box-sizing:border-box;width:100%;min-width:0;border:1px solid rgba(75,85,99,.35);border-radius:4px;padding:3px 5px;font:12px Arial,sans-serif;font-weight:600;";
        function stopDomEvent(evt) { if (evt && evt.stopPropagation) evt.stopPropagation(); }
        function stopAndPreventDomEvent(evt) { stopDomEvent(evt); if (evt && evt.preventDefault) evt.preventDefault(); }
        ["mousedown", "mouseup", "click", "dblclick", "pointerdown", "pointerup", "keypress", "keyup"].forEach(function (type) { input.addEventListener(type, stopDomEvent); });
        input.addEventListener("keydown", function (evt) {
            stopDomEvent(evt);
            if (evt.key === "Enter") { input.value = writeSourceTitle(session, sourceCell, assemblyCell, input.value, initialLabel); if (input.blur) input.blur(); stopAndPreventDomEvent(evt); }
            else if (evt.key === "Escape") { input.value = initialLabel; stopAndPreventDomEvent(evt); }
        });
        input.addEventListener("blur", function () { input.value = writeSourceTitle(session, sourceCell, assemblyCell, input.value, initialLabel); });
        return input;
    }

    function writeSourceTitle(session, sourceCell, assemblyCell, label, fallback) {
        const nextLabel = String(label || "").trim() || String(fallback || "Water Source");
        const profile = normalizeEndpointProfile(Object.assign({}, endpointProfile(sourceCell), { label: nextLabel }));
        runIrrigationEdit("renameSource", function () {
            model.beginUpdate && model.beginUpdate();
            try {
                setCellAttrs(sourceCell, { label: nextLabel, [ATTRS.ENDPOINT_PROFILE_JSON]: JSON.stringify(profile) });
                if (assemblyCell && assemblyCell !== sourceCell) setCellAttrs(assemblyCell, { label: nextLabel });
                scheduleHudGraphStateSync(session.moduleCell);
            } finally { model.endUpdate && model.endUpdate(); }
        });
        return nextLabel;
    }

    function renderBedInletFields(session, hud, assemblyCell) {
        const bedAssembly = isAssembly(assemblyCell) ? assemblyCell : findAssemblyAncestor(assemblyCell);
        const bedCell = bedCellForAssembly(session.moduleCell, bedAssembly);
        if (!bedAssembly || !bedCell) return;
        const ports = readBedPortConfig(bedCell);
        const saved = readBedAssemblyTemplateRecord(session.moduleCell, bedAssembly) || {};
        const roleParts = bedTemplateRolePartIds(saved);
        const savedTemplateId = saved.templateId || BED_TEMPLATES[0].id;
        const savedTemplateDef = bedTemplateById(savedTemplateId);
        const initialRowOrientation = normalizeBedRowOrientation(saved.rowOrientation, savedTemplateDef);
        const initialRows = saved.spacing && saved.spacing.rows != null ? saved.spacing.rows : (savedTemplateDef.defaultRows || 2);
        const initialCatalog = readCatalog(session.moduleCell);
        const initialRecipe = normalizeBedRecipeInput(initialCatalog, savedTemplateDef, saved, { suppressTemplateDefaults: true }); // CHANGE
        const initialBom = computeBedTemplateBom(initialCatalog, getGeometry(bedAssembly) || getGeometry(bedCell) || {}, savedTemplateId, initialRows, initialRowOrientation, initialRecipe);
        const initialSupplyPart = partById(initialCatalog, initialBom.recipe && initialBom.recipe.supplyPipePartId); // NEW
        const initialSupplyConnector = initialSupplyPart && initialSupplyPart.connectors && initialSupplyPart.connectors.output; // NEW
        const inletLocked = assemblyHasConnectedPortRole(session.moduleCell, bedAssembly, "input");
        const outletLocked = assemblyHasConnectedPortRole(session.moduleCell, bedAssembly, "output");
        const rowSpacingUnit = rowSpacingDisplayUnit(session.moduleCell);
        const initialRowSpacingCm = finiteNumber(saved.spacing && saved.spacing.rowSpacingCm, initialBom.rowSpacingCm);
        const templateSection = hudSection("Bed Assembly"); // CHANGE
        const narrowTemplate = typeof window !== "undefined" && window.innerWidth && window.innerWidth < 560;
        hud.style.width = narrowTemplate ? "min(460px,calc(100vw - 32px))" : "min(640px,calc(100vw - 32px))";
        hud.style.maxWidth = narrowTemplate ? "min(460px,calc(100vw - 32px))" : "min(640px,calc(100vw - 32px))";
        const form = document.createElement("div");
        form.className = "trellis-irrigation-bed-inlet-form";
        form.style.cssText = "display:grid;grid-template-columns:" + (narrowTemplate ? "minmax(0,1fr)" : "minmax(0,1fr) minmax(0,1fr)") + ";gap:8px 10px;width:100%;min-width:0;max-width:100%;box-sizing:border-box;overflow:hidden;";
        const layoutColumn = document.createElement("div");
        layoutColumn.className = "trellis-irrigation-bed-template-layout-column";
        layoutColumn.style.cssText = "display:grid;gap:6px;min-width:0;max-width:100%;box-sizing:border-box;overflow:hidden;";
        const partsColumn = document.createElement("div");
        partsColumn.className = "trellis-irrigation-bed-template-parts-column";
        partsColumn.style.cssText = "display:grid;gap:6px;min-width:0;max-width:100%;box-sizing:border-box;overflow:hidden;";
        form.appendChild(layoutColumn);
        form.appendChild(partsColumn);
        const orientation = addSelectField(layoutColumn, "Row orientation", BED_TEMPLATE_ROW_ORIENTATIONS, initialRowOrientation);
        const rows = addNumericField(layoutColumn, "Rows", initialRows, { min: 1, step: 1, inputMode: "numeric" });
        const rowSpacing = addNumericField(layoutColumn, "Row spacing " + rowSpacingUnit, formatRowSpacingDisplayValue(initialRowSpacingCm, session.moduleCell), { min: 0, step: 1, inputMode: "numeric" });
        const spacing = addNumericField(layoutColumn, "Emitter spacing in", initialRecipe.emitterSpacingIn || "12", { min: 1, step: 1, inputMode: "decimal" });
        const inletPart = addPartSelectField(partsColumn, "Inlet part", preservePartSelectOption(session.moduleCell, bedRolePartOptions(session.moduleCell, "input", roleParts.inletPartId, savedTemplateId, initialRecipe.rowPartId), inletLocked ? roleParts.inletPartId : ""), roleParts.inletPartId);
        const rowPart = addPartSelectField(partsColumn, "Row part", bedRowPartOptions(session.moduleCell, initialRecipe.rowPartId, true, initialSupplyConnector), initialRecipe.rowPartId); // CHANGE
        const rowTakeoffPart = addPartSelectField(partsColumn, "Row takeoff part", bedFittingPartOptions(session.moduleCell, "row_takeoff", initialBom.recipe && initialBom.recipe.supplyPipePartId, initialRecipe.rowPartId, initialRecipe.rowTakeoffPartId), initialRecipe.rowTakeoffPartId); // CHANGE
        const emitterPart = addPartSelectField(partsColumn, "Emitter/device part", bedEmitterPartOptions(session.moduleCell, initialRecipe.rowPartId, initialRecipe.emitterPartId), initialRecipe.emitterPartId);
        const rowEndCapPart = addPartSelectField(partsColumn, "Row end cap", bedFittingPartOptions(session.moduleCell, "row_end_cap", initialBom.recipe && initialBom.recipe.supplyPipePartId, initialRecipe.rowPartId, initialRecipe.rowEndCapPartId), initialRecipe.rowEndCapPartId);
        const headerEndCapPart = addPartSelectField(partsColumn, "Header end cap", bedFittingPartOptions(session.moduleCell, "header_end_cap", initialBom.recipe && initialBom.recipe.supplyPipePartId, initialRecipe.rowPartId, initialRecipe.headerEndCapPartId), initialRecipe.headerEndCapPartId);
        const outletPart = addPartSelectField(partsColumn, "Outlet part", preservePartSelectOption(session.moduleCell, bedOutletPartOptions(session.moduleCell, initialBom.recipe && initialBom.recipe.supplyPipePartId, roleParts.outletPartId), outletLocked ? roleParts.outletPartId : ""), roleParts.outletPartId);
        inletPart.disabled = inletLocked;
        outletPart.disabled = outletLocked;
        const summary = hudText("");
        summary.className = "trellis-irrigation-bed-template-summary";
        let draftDirty = false;
        function currentBedTemplateGeometry() {
            return getGeometry(bedAssembly) || getGeometry(bedCell) || {};
        }
        function syncRowSpacingFromRows() {
            const templateDef = savedTemplateDef; // CHANGE
            const rowCount = Math.max(0, Math.floor(finiteNumber(rows.value, templateDef.defaultRows)));
            const rowOrientation = normalizeBedRowOrientation(orientation.value, templateDef);
            rowSpacing.value = formatRowSpacingDisplayValue(rowSpacingCmForRows(currentBedTemplateGeometry(), rowCount, rowOrientation), session.moduleCell);
        }
        function syncRowsFromRowSpacing() {
            const templateDef = savedTemplateDef; // CHANGE
            const fallback = Math.max(0, Math.floor(finiteNumber(rows.value, templateDef.defaultRows)));
            const rowOrientation = normalizeBedRowOrientation(orientation.value, templateDef);
            const rowCount = rowsForRowSpacingCm(currentBedTemplateGeometry(), rowSpacingDisplayValueToCm(rowSpacing.value, session.moduleCell), rowOrientation, fallback);
            rows.value = String(rowCount);
            rowSpacing.value = formatRowSpacingDisplayValue(rowSpacingCmForRows(currentBedTemplateGeometry(), rowCount, rowOrientation), session.moduleCell);
        }
        function currentDraft() {
            const templateDef = savedTemplateDef; // CHANGE
            const rowCount = Math.max(0, Math.floor(finiteNumber(rows.value, templateDef.defaultRows)));
            const catalog = readCatalog(session.moduleCell);
            const terminalParts = currentTerminalPartIds();
            const recipeInput = { inletPartId: inletPart.value, outletPartId: terminalParts.outletPartId, rowPartId: rowPart.value, emitterPartId: emitterPart.value, rowTakeoffPartId: rowTakeoffPart.value, rowEndCapPartId: rowEndCapPart.value, headerEndCapPartId: terminalParts.headerEndCapPartId, emitterSpacingIn: finiteNumber(spacing.value, 12) };
            const bom = computeBedTemplateBom(catalog, currentBedTemplateGeometry(), savedTemplateId, rowCount, orientation.value, recipeInput); // CHANGE
            return {
                catalog,
                bom,
                templateId: savedTemplateId, // CHANGE
                inletPartId: String(inletPart.value || "").trim(),
                outletPartId: terminalParts.outletPartId,
                rowPartId: String(rowPart.value || "").trim(),
                emitterPartId: String(emitterPart.value || "").trim(),
                rowTakeoffPartId: String(rowTakeoffPart.value || "").trim(),
                rowEndCapPartId: String(rowEndCapPart.value || "").trim(),
                headerEndCapPartId: terminalParts.headerEndCapPartId,
                rowSpacingCm: bom.rowSpacingCm,
                emitterInches: finiteNumber(spacing.value, 12)
            };
        }
        function bomSummaryText(bom) {
            return "Rows " + bom.rowCount + " x " + bom.rowLengthMeters.toFixed(2) + " m = " + bom.totalRowMeters.toFixed(2) + " row m\nSupply " + (bom.recipe && bom.recipe.supplyPipePartId || "not selected") + ", demand " + bom.demand.flowGpm.toFixed(2) + " gpm, " + bom.demand.operatingPressurePsi.toFixed(0) + " PSI";
        }
        function setTemplateFieldVisible(control, visible) {
            if (control && control.parentNode) control.parentNode.style.display = visible ? "flex" : "none";
        }
        function currentRowPartRecord(catalog) { // NEW
            return partById(catalog || readCatalog(session.moduleCell), rowPart.value); // NEW
        } // NEW
        function currentRowPartIsPipe(catalog) { // NEW
            const selectedRowPart = currentRowPartRecord(catalog); // NEW
            return !!(selectedRowPart && selectedRowPart.category === "pipe_tubing"); // NEW
        } // NEW
        function currentTerminalPartIds() {
            return normalizeBedTerminalPartIds({ outletPartId: outletPart.value, headerEndCapPartId: headerEndCapPart.value });
        }
        function hasInletDependentSelection() { // NEW
            return !!(outletPart.value || rowTakeoffPart.value || headerEndCapPart.value || rowEndCapPart.value || emitterPart.value); // NEW
        } // NEW
        function hasRowDependentSelection() { // NEW
            return !!(rowTakeoffPart.value || rowEndCapPart.value || emitterPart.value); // NEW
        } // NEW
        function syncPrerequisiteLocks(selfEmitting, rowPartIsPipe) { // NEW
            const hasInlet = !!String(inletPart.value || "").trim(); // NEW
            const hasRow = !!String(rowPart.value || "").trim(); // NEW
            inletPart.disabled = !!(inletLocked || hasInletDependentSelection()); // CHANGE
            rowPart.disabled = !hasInlet || hasRowDependentSelection(); // NEW
            outletPart.disabled = !!(outletLocked || !hasInlet); // CHANGE
            headerEndCapPart.disabled = !hasInlet; // NEW
            rowTakeoffPart.disabled = !hasInlet || !hasRow; // NEW
            rowEndCapPart.disabled = !hasRow; // NEW
            emitterPart.disabled = !hasRow || !!selfEmitting; // NEW
            spacing.disabled = !hasRow || !rowPartIsPipe || !!selfEmitting; // CHANGE
        } // NEW
        function syncTerminalPartVisibility(hasSupplyOutlet) {
            const terminalParts = currentTerminalPartIds();
            if (terminalParts.outletPartId) headerEndCapPart.value = "";
            if (terminalParts.headerEndCapPartId) outletPart.value = "";
            setTemplateFieldVisible(headerEndCapPart, !terminalParts.outletPartId);
            setTemplateFieldVisible(outletPart, !!hasSupplyOutlet && !terminalParts.headerEndCapPartId);
        }
        function refreshTemplatePreview(clearInvalidSelections) {
            const draft = currentDraft();
            const bom = draft.bom;
            const supplyPart = partById(draft.catalog, bom.recipe && bom.recipe.supplyPipePartId); // NEW
            const supplyConnector = supplyPart && supplyPart.connectors && supplyPart.connectors.output; // NEW
            const rowPartOptions = bedRowPartOptions(session.moduleCell, rowPart.value, !clearInvalidSelections, supplyConnector); // CHANGE
            const emitterOptions = bedEmitterPartOptions(session.moduleCell, rowPart.value, emitterPart.value, !clearInvalidSelections);
            const inletValue = inletPart.value;
            const outletValue = outletPart.value;
            const inletOptions = bedRolePartOptions(session.moduleCell, "input", inletValue, savedTemplateId, rowPart.value, !clearInvalidSelections); // CHANGE
            const rowTakeoffOptions = bedFittingPartOptions(session.moduleCell, "row_takeoff", bom.recipe && bom.recipe.supplyPipePartId, rowPart.value, rowTakeoffPart.value, !clearInvalidSelections);
            const rowEndCapOptions = bedFittingPartOptions(session.moduleCell, "row_end_cap", bom.recipe && bom.recipe.supplyPipePartId, rowPart.value, rowEndCapPart.value, !clearInvalidSelections);
            const headerEndCapOptions = bedFittingPartOptions(session.moduleCell, "header_end_cap", bom.recipe && bom.recipe.supplyPipePartId, rowPart.value, headerEndCapPart.value, !clearInvalidSelections);
            const outletOptions = bedOutletPartOptions(session.moduleCell, bom.recipe && bom.recipe.supplyPipePartId, outletValue, !clearInvalidSelections);
            setPartSelectOptions(rowPart, rowPartOptions, rowPartOptions.some(function (part) { return part.id === rowPart.value; }) ? rowPart.value : ""); // CHANGE
            setPartSelectOptions(emitterPart, emitterOptions, emitterOptions.some(function (part) { return part.id === emitterPart.value; }) ? emitterPart.value : ""); // CHANGE
            setPartSelectOptions(inletPart, inletLocked ? preservePartSelectOption(session.moduleCell, inletOptions, inletValue) : inletOptions, inletLocked ? inletValue : (inletOptions.some(function (part) { return part.id === inletValue; }) ? inletValue : ""));
            setPartSelectOptions(rowTakeoffPart, rowTakeoffOptions, rowTakeoffOptions.some(function (part) { return part.id === rowTakeoffPart.value; }) ? rowTakeoffPart.value : ""); // CHANGE
            setPartSelectOptions(rowEndCapPart, rowEndCapOptions, rowEndCapOptions.some(function (part) { return part.id === rowEndCapPart.value; }) ? rowEndCapPart.value : ""); // CHANGE
            setPartSelectOptions(headerEndCapPart, headerEndCapOptions, headerEndCapOptions.some(function (part) { return part.id === headerEndCapPart.value; }) ? headerEndCapPart.value : "");
            setPartSelectOptions(outletPart, outletLocked ? preservePartSelectOption(session.moduleCell, outletOptions, outletValue) : outletOptions, outletLocked ? outletValue : (outletOptions.some(function (part) { return part.id === outletValue; }) ? outletValue : "")); // CHANGE
            const selectedRowPart = currentRowPartRecord(draft.catalog); // NEW
            const selfEmitting = isSelfEmittingRowPart(selectedRowPart); // CHANGE
            const rowPartIsPipe = currentRowPartIsPipe(draft.catalog); // NEW
            setTemplateFieldVisible(rows, !!rowPart.value); // NEW
            setTemplateFieldVisible(rowSpacing, !!rowPart.value); // NEW
            setTemplateFieldVisible(spacing, rowPartIsPipe); // NEW
            setTemplateFieldVisible(emitterPart, !!rowPart.value && !selfEmitting); // CHANGE
            if (selfEmitting) spacing.value = String(finiteNumber(selectedRowPart && selectedRowPart.specs && selectedRowPart.specs.emitterSpacingIn, 12)); // CHANGE
            syncTerminalPartVisibility(bom.recipe && bom.recipe.supplyPipePartId);
            syncPrerequisiteLocks(selfEmitting, rowPartIsPipe); // CHANGE
            summary.textContent = bomSummaryText(bom);
            summary.style.color = bom.missingPartIds.length ? "#8a4b00" : "#333";
            return draft;
        }
        function validateBedTemplateDraft(draft) {
            const catalog = draft.catalog;
            const bom = draft.bom;
            const anchorPart = partById(catalog, bom.anchorPartId);
            if (bom.rowCount === 0) return { ok: true, message: "" };
            if (!draft.inletPartId) return { ok: false, message: "Select an inlet part before applying the bed layout." };
            if (!draft.rowPartId) return { ok: false, message: "Select a row part before applying the bed layout." };
            if (!bom.recipe || !bom.recipe.supplyPipePartId) return { ok: false, message: "Cannot apply template. Missing fixed starter supply pipe for the selected inlet size." };
            if (!anchorPart) return { ok: false, message: "Cannot apply template. No compatible row part was found." };
            if (!draft.emitterPartId && !bom.recipe.selfEmitting) return { ok: false, message: "Select an emitter/device part before applying the bed layout." };
            if (!draft.rowTakeoffPartId) return { ok: false, message: "Select a row takeoff part before applying the bed layout." };
            if (!draft.rowEndCapPartId) return { ok: false, message: "Select a row end cap before applying the bed layout." };
            if (!draft.outletPartId && !draft.headerEndCapPartId) return { ok: false, message: "Select a header end cap or outlet part before applying the bed layout." };
            if (bom.missingPartIds.length) return { ok: false, message: "Cannot apply template. Missing required parts: " + bom.missingPartIds.join(", ") + "." };
            return { ok: true, message: "" };
        }
        function commitBedTemplateDraft() {
            if (activeIrrigationMode !== session || isIrrigationModeClosing(session)) return false;
            if (!draftDirty) return false;
            const draft = currentDraft();
            const validation = validateBedTemplateDraft(draft);
            if (!validation.ok) { session.message = validation.message; renderIrrigationMode(session); return false; }
            const bom = draft.bom;
            rows.value = String(bom.rowCount);
            rowSpacing.value = formatRowSpacingDisplayValue(draft.rowSpacingCm, session.moduleCell);
            spacing.value = String(draft.emitterInches);
            runIrrigationEdit("applyBedLayout", function () {
                if (bom.rowCount > 0) writeBedPortConfig(bedCell, bedPortConfigFromRecipe(draft.catalog, ports, draft.inletPartId, draft.outletPartId, draft.rowPartId, bom.recipe && bom.recipe.supplyPipePartId));
                const path = firstAssemblyPathForBedAssembly(session.moduleCell, bedAssembly) || { id: "assembly_bed_" + sanitizeId(getCellId(bedCell)), targetBedId: getCellId(bedCell) || "" };
                commitBedTemplate(session.moduleCell, path.id, bedAssembly, {
                    templateId: draft.templateId,
                    templateModel: BED_TEMPLATE_MODEL_BOM,
                    recipeVersion: BED_RECIPE_VERSION,
                    irrigationType: bom.templateDef.lineKind,
                    inletPartId: draft.inletPartId,
                    outletPartId: draft.outletPartId,
                    rowPartId: draft.rowPartId,
                    emitterPartId: bom.recipe && bom.recipe.selfEmitting ? "" : draft.emitterPartId,
                    rowTakeoffPartId: draft.rowTakeoffPartId,
                    rowEndCapPartId: draft.rowEndCapPartId,
                    headerEndCapPartId: draft.outletPartId ? "" : draft.headerEndCapPartId,
                    supplyPipePartId: bom.recipe && bom.recipe.supplyPipePartId || "",
                    partIds: uniqueStrings([draft.inletPartId, draft.outletPartId, draft.rowPartId, draft.emitterPartId, draft.rowTakeoffPartId, draft.rowEndCapPartId, draft.headerEndCapPartId, bom.recipe && bom.recipe.supplyPipePartId]).filter(Boolean),
                    rowOrientation: bom.rowOrientation,
                    rowLengthMeters: bom.rowLengthMeters,
                    rowSpacingCm: draft.rowSpacingCm,
                    totalRowMeters: bom.totalRowMeters,
                    requiredParts: bom.requiredParts,
                    resolvedBomParts: bom.recipe && bom.recipe.resolvedBomParts || [],
                    anchorPartId: bom.anchorPartId,
                    demand: bom.demand,
                    assemblyLabelMode: "",
                    spacing: { rows: bom.rowCount, emitterInches: draft.emitterInches, rowSpacingCm: draft.rowSpacingCm }
                });
                scheduleHudGraphStateSync(session.moduleCell);
            });
            draftDirty = false;
            session.message = "Bed layout updated.";
            renderIrrigationMode(session);
            return true;
        }
        function markDraftAndRefresh(clearInvalidSelections) {
            if (activeIrrigationMode !== session || isIrrigationModeClosing(session)) return;
            draftDirty = true;
            refreshTemplatePreview(clearInvalidSelections);
        }
        function commitChangedSelect(clearInvalidSelections) {
            if (activeIrrigationMode !== session || isIrrigationModeClosing(session)) return;
            markDraftAndRefresh(clearInvalidSelections);
            if (!currentDraft().outletPartId && !currentDraft().headerEndCapPartId) return;
            commitBedTemplateDraft();
        }
        function commitTextFieldOnEnter(ev) {
            if (!ev || ev.key !== "Enter") return;
            if (activeIrrigationMode !== session || isIrrigationModeClosing(session)) return;
            if (ev.preventDefault) ev.preventDefault();
            draftDirty = true;
            refreshTemplatePreview(false);
            commitBedTemplateDraft();
        }
        orientation.addEventListener("change", function () { syncRowSpacingFromRows(); commitChangedSelect(false); });
        rowPart.addEventListener("change", function () { commitChangedSelect(true); }); // CHANGE
        emitterPart.addEventListener("change", function () { commitChangedSelect(false); });
        inletPart.addEventListener("change", function () { commitChangedSelect(false); });
        rowTakeoffPart.addEventListener("change", function () { commitChangedSelect(false); });
        rowEndCapPart.addEventListener("change", function () { commitChangedSelect(false); });
        headerEndCapPart.addEventListener("change", function () { if (headerEndCapPart.value) { outletPart.value = ""; commitChangedSelect(false); } else markDraftAndRefresh(false); });
        outletPart.addEventListener("change", function () { if (outletPart.value) { headerEndCapPart.value = ""; commitChangedSelect(false); } else markDraftAndRefresh(false); });
        rows.addEventListener("input", function () { syncRowSpacingFromRows(); markDraftAndRefresh(false); });
        rowSpacing.addEventListener("input", function () { syncRowsFromRowSpacing(); markDraftAndRefresh(false); });
        spacing.addEventListener("input", function () { markDraftAndRefresh(false); });
        rows.addEventListener("blur", commitBedTemplateDraft);
        rowSpacing.addEventListener("blur", function () { syncRowsFromRowSpacing(); commitBedTemplateDraft(); });
        spacing.addEventListener("blur", commitBedTemplateDraft);
        rows.addEventListener("keydown", commitTextFieldOnEnter);
        rowSpacing.addEventListener("keydown", function (ev) { if (ev && ev.key === "Enter") syncRowsFromRowSpacing(); commitTextFieldOnEnter(ev); });
        spacing.addEventListener("keydown", commitTextFieldOnEnter);
        templateSection.appendChild(form);
        summary.style.overflowWrap = "anywhere";
        summary.style.whiteSpace = "pre-line";
        templateSection.appendChild(summary);
        if (initialBom.missingPartIds.length) templateSection.appendChild(hudWarning("Required template parts are missing from the catalog: " + initialBom.missingPartIds.join(", ") + "."));
        refreshTemplatePreview(false);
        hud.appendChild(templateSection);
    }

    function renderAssemblyPortBadges(session, selectedCells) {
        allAssemblyBoundaryPortSpecs(session.moduleCell).forEach(function (spec) { renderPortBadge(session, spec.cell, spec.role, spec.index); });
        renderInternalConnectionBadges(session, selectedCells);
    }

    function allAssemblyBoundaryPortSpecs(moduleCell) {
        const seen = new Set();
        const out = [];
        collectDescendants(moduleCell, isAssembly).forEach(function (assembly) {
            if (assemblyType(assembly) === "bed") { appendPortBadgeSpecsForCell(moduleCell, out, seen, assembly, "input"); appendPortBadgeSpecsForCell(moduleCell, out, seen, assembly, "output"); return; }
            const first = firstAssemblyPart(assembly);
            const last = lastAssemblyPart(assembly);
            if (first) appendPortBadgeSpecsForCell(moduleCell, out, seen, first, "input");
            if (last) appendPortBadgeSpecsForCell(moduleCell, out, seen, last, "output");
        });
        return out;
    }

    function appendPortBadgeSpecsForCell(moduleCell, out, seen, cell, role) {
        const count = portCapacityForCell(moduleCell, cell, role);
        for (let index = 0; index < count; index++) {
            const key = [getCellId(cell), role, index].join(":");
            if (!getCellId(cell) || seen.has(key)) continue;
            seen.add(key);
            out.push({ cell, role, index });
        }
    }

    function renderPortBadge(session, cell, role, index) {
        const port = { cellId: getCellId(cell), role, index };
        const visual = portBadgeVisualState(session, port);
        const visualRole = portVisualRoleForCell(session.moduleCell, cell, role);
        const label = cellPortDisplayLabel(session.moduleCell, cell, role);
        const badge = document.createElement("button");
        badge.type = "button";
        badge.className = "trellis-irrigation-port-badge trellis-irrigation-port-badge-" + visual.state;
        renderPortBadgeContent(badge, label, visualRole, visual);
        badge.title = portDisplayPrefix(session.moduleCell, cell, role) + " " + (index + 1) + visual.titleSuffix + " (" + label + ")"; // CHANGE
        badge.style.cssText = portBadgeStyle(visual, label);
        positionPortBadge(badge, cell, visualRole, index, portCapacityForCell(session.moduleCell, cell, role), label);
        badge.addEventListener("click", function (ev) {
            if (ev && ev.stopPropagation) ev.stopPropagation();
            const boundary = boundaryForPort(session.moduleCell, port);
            const bedPort = isAssembly(cell) && assemblyType(cell) === "bed";
            if (boundary) { session.inlineActionAnchorPort = normalizePort(port); session.focusedConnectionBoundary = boundary; toggleSelectedPortBoundary(session, boundary); if (bedPort) session.partPickerVisible = false; }
            else { session.inlineActionAnchorPort = null; session.focusedConnectionBoundary = null; toggleSelectedPort(session, port); if (bedPort) session.partPickerVisible = false; }
            session.bridgePorts = null;
            session.preservePortSelectionOnNextGraphSelection = true;
            selectCell(findAssemblyAncestor(cell) || cell, false);
            renderIrrigationMode(session);
        });
        appendOverlayNode(badge);
        session.portBadges.push(badge);
        if (session.portBadgeNodeByKey) session.portBadgeNodeByKey.set(portKey(port), badge);
    }

    function portBadgeVisualState(session, port) {
        const key = portKey(port);
        const selected = (session.selectedPorts || []).map(portKey).indexOf(key) >= 0;
        const boundary = boundaryForPort(session.moduleCell, port);
        const boundarySelected = boundary && selectedValidBoundaries(session).map(boundaryKey).indexOf(boundaryKey(boundary)) >= 0;
        const occupied = edgesForPort(session.moduleCell, port).length > 0;
        if (boundarySelected) return { state: "selected", titleSuffix: " connected selected" };
        const compatible = !selected && !occupied && isCompatibleTargetPort(session, port);
        if (selected) return { state: "selected", titleSuffix: occupied ? " connected selected" : " free selected" };
        if (compatible) return { state: "compatible", titleSuffix: " free compatible" };
        if (occupied) return { state: "occupied", titleSuffix: " connected" };
        return { state: "normal", titleSuffix: " free" };
    }

    function selectedFreeCompatibilityPort(session) {
        const selected = selectedValidPorts(session);
        const free = selected.filter(function (port) { return isPortFree(session.moduleCell, port); });
        return selected.length === 1 && free.length === 1 ? free[0] : null;
    }

    function isCompatibleTargetPort(session, port) {
        const selected = selectedFreeCompatibilityPort(session);
        if (!selected || !isPortFree(session.moduleCell, port)) return false;
        if (selected.role !== port.role) { const validation = quietIrrigationDebug(function () { return selected.role === "output" ? validatePortConnection(session.moduleCell, selected, port) : validatePortConnection(session.moduleCell, port, selected); }); if (validation.ok) return true; }
        return typeof flipConnectPlanForPorts === "function" && quietIrrigationDebug(function () { return flipConnectPlanForPorts(session.moduleCell, [selected, port]).ok; });
    }

    function canSelectFreePortsTogether(session, selectedPort, targetPort) { // CHANGE
        if (!isPortFree(session.moduleCell, selectedPort) || !isPortFree(session.moduleCell, targetPort)) return true; // CHANGE
        if (isCompatibleTargetPort(Object.assign({}, session, { selectedPorts: [normalizePort(selectedPort)] }), targetPort)) return true; // CHANGE
        const ordered = orderedConnectionPorts([selectedPort, targetPort]); // CHANGE
        return !!(ordered && ConnectorRules.bridgeSuggestionEligibility(session.moduleCell, ordered.source, ordered.target).ok); // CHANGE
    } // CHANGE

    function renderPortBadgeContent(badge, label, role, visual) {
        const text = document.createElement("span");
        text.className = "trellis-irrigation-port-badge-label";
        text.textContent = label;
        text.style.cssText = "display:block;line-height:" + PORT_BADGE_SIZE + "px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
        const cue = document.createElement("span");
        cue.className = "trellis-irrigation-port-badge-arrow trellis-irrigation-port-badge-arrow-" + role;
        cue.setAttribute("aria-hidden", "true");
        cue.style.cssText = portBadgeArrowStyle(role, visual);
        badge.appendChild(text);
        badge.appendChild(cue);
    }

    function portBadgeWidthForLabel(label) {
        return Math.max(PORT_BADGE_MIN_WIDTH, Math.min(PORT_BADGE_MAX_WIDTH, String(label || "").length * 6 + 14));
    }

    function portBadgeArrowStyle(role, visual) {
        const color = visual && visual.state === "compatible" ? "#16a34a" : visual && visual.state === "selected" ? "#1d4ed8" : "#475569";
        const base = "position:absolute;left:50%;width:0;height:0;margin-left:-" + PORT_BADGE_ARROW_SIZE + "px;border-left:" + PORT_BADGE_ARROW_SIZE + "px solid transparent;border-right:" + PORT_BADGE_ARROW_SIZE + "px solid transparent;pointer-events:none;";
        return role === "input" ? base + "bottom:-" + PORT_BADGE_ARROW_SIZE + "px;border-top:" + PORT_BADGE_ARROW_SIZE + "px solid " + color + ";" : base + "top:-" + PORT_BADGE_ARROW_SIZE + "px;border-bottom:" + PORT_BADGE_ARROW_SIZE + "px solid " + color + ";";
    }

    function portBadgeStyle(visual, label) {
        const styles = {
            selected: { border: "3px solid #1d4ed8", background: "#dbeafe", shadow: "0 0 0 3px rgba(29,78,216,.22),0 2px 7px rgba(0,0,0,.24)", color: "#0f172a" },
            compatible: { border: "2px solid #16a34a", background: "#dcfce7", shadow: "0 0 0 3px rgba(22,163,74,.20),0 1px 5px rgba(0,0,0,.18)", color: "#14532d" },
            occupied: { border: "1px solid #2563eb", background: "#dbeafe", shadow: "0 1px 4px rgba(0,0,0,.18)", color: "#1e3a8a" },
            normal: { border: "1px solid #555", background: "#fff", shadow: "0 1px 4px rgba(0,0,0,.18)", color: "#111" }
        };
        const s = styles[visual.state] || styles.normal;
        return "position:absolute;z-index:1002;width:" + portBadgeWidthForLabel(label) + "px;height:" + PORT_BADGE_SIZE + "px;padding:0 5px;border:" + s.border + ";border-radius:4px;background:" + s.background + ";box-shadow:" + s.shadow + ";color:" + s.color + ";font:bold 10px Arial,sans-serif;cursor:pointer;box-sizing:border-box;overflow:visible;";
    }

    function portVisualRoleForCell(moduleCell, cell, role) {
        return role; // CHANGE
    }

    function positionPortBadge(node, cell, role, index, count, label) {
        const state = cellState(cell);
        const total = Math.max(1, Math.floor(finiteNumber(count, 1)));
        const slot = (index + 1) / (total + 1);
        const x = state.x + state.width * slot - portBadgeWidthForLabel(label) / 2;
        const y = role === "input" ? state.y - PORT_BADGE_SIZE - 4 : state.y + state.height + 4;
        node.style.left = Math.round(x) + "px";
        node.style.top = Math.round(y) + "px";
    }

    function toggleSelectedPort(session, port) {
        const key = portKey(port);
        const current = selectedValidPorts(session);
        const existing = current.map(portKey).indexOf(key);
        if (existing >= 0) current.splice(existing, 1);
        else {
            const normalized = normalizePort(port);
            clearSelectedConnectionBoundaries(session);
            const next = current.filter(function (entry) { return entry.cellId !== normalized.cellId; });
            while (next.length >= 2) next.shift();
            if (next.length === 1 && !canSelectFreePortsTogether(session, next[0], normalized)) { session.selectedPorts = [normalized]; return; } // CHANGE
            session.selectedPorts = next.concat([normalized]);
            return;
        }
        session.selectedPorts = current;
    }

    function renderInternalConnectionBadges(session, selectedCells) {
        internalConnectionBoundariesForSelection(session.moduleCell, selectedCells).forEach(function (entry) {
            const badge = document.createElement("button");
            const selected = selectedValidBoundaries(session).map(boundaryKey).indexOf(boundaryKey(entry.boundary)) >= 0;
            const label = internalConnectionDisplayLabel(session.moduleCell, entry.upstream, entry.downstream);
            badge.type = "button";
            badge.className = "trellis-irrigation-internal-connection-badge" + (selected ? " trellis-irrigation-internal-connection-badge-selected" : "");
            badge.textContent = "C";
            badge.title = "Internal connection " + label + ": " + irrigationCellLabel(entry.upstream) + " to " + irrigationCellLabel(entry.downstream);
            badge.style.cssText = internalConnectionBadgeStyle(selected);
            positionInternalConnectionBadge(badge, entry.upstream, entry.downstream);
            badge.addEventListener("click", function (ev) {
                if (ev && ev.stopPropagation) ev.stopPropagation();
                session.inlineActionAnchorPort = null;
                session.focusedConnectionBoundary = selected ? null : entry.boundary;
                toggleSelectedBoundary(session, entry.boundary);
                session.bridgePorts = null;
                session.preservePortSelectionOnNextGraphSelection = true;
                selectCell(entry.assembly, false);
                renderIrrigationMode(session);
            });
            appendOverlayNode(badge);
            session.portBadges.push(badge);
            if (session.connectionBadgeNodeByKey) session.connectionBadgeNodeByKey.set(boundaryKey(entry.boundary), badge);
        });
    }

    function renderSelectedExternalPipeHighlights(session) {
        selectedValidBoundaries(session).forEach(function (boundary) {
            const edge = boundary.type === "edge" ? findCellById(session.moduleCell, boundary.edgeId) : null;
            if (!edge || getCellAttr(edge, ATTRS.PIPE_EDGE, "") !== "1") return;
            const highlight = createPipeEdgeHighlight(edge);
            if (!highlight) return;
            appendOverlayNode(highlight);
            session.targetHighlights.push(highlight);
        });
    }

    function createPipeEdgeHighlight(edge) {
        const points = edgeAbsolutePoints(edge);
        if (points.length >= 2) return createPipePolylineHighlight(edge, points);
        return createPipeBoundsHighlight(edge);
    }

    function pipeHighlightStrokeWidth(edge) {
        return Math.max(7, finiteNumber(styleValue(edge && edge.style, "strokeWidth"), 3) + 4);
    }

    function edgeAbsolutePoints(edge) {
        const state = graph.view && graph.view.getState ? graph.view.getState(edge) : null;
        const raw = state && Array.isArray(state.absolutePoints) ? state.absolutePoints : [];
        return raw.map(function (point) { return point ? { x: finiteNumber(point.x, 0), y: finiteNumber(point.y, 0) } : null; }).filter(Boolean);
    }

    function createPipePolylineHighlight(edge, points) {
        const highlightWidth = pipeHighlightStrokeWidth(edge);
        const bounds = pointBounds(points, highlightWidth + 1);
        const svg = document.createElementNS ? document.createElementNS("http://www.w3.org/2000/svg", "svg") : document.createElement("div");
        if (svg.setAttribute) svg.setAttribute("class", "trellis-irrigation-selected-pipe-highlight");
        if (svg.setAttribute) svg.setAttribute("data-edge-id", getCellId(edge) || "");
        svg.style.cssText = "position:absolute;z-index:999;left:" + Math.round(bounds.x) + "px;top:" + Math.round(bounds.y) + "px;width:" + Math.round(bounds.width) + "px;height:" + Math.round(bounds.height) + "px;pointer-events:none;overflow:visible;";
        if (!document.createElementNS) return svg;
        const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
        line.setAttribute("points", points.map(function (point) { return (point.x - bounds.x) + "," + (point.y - bounds.y); }).join(" "));
        line.setAttribute("fill", "none");
        line.setAttribute("stroke", "#f59e0b");
        line.setAttribute("stroke-width", formatStyleNumber(highlightWidth));
        line.setAttribute("stroke-linecap", "round");
        line.setAttribute("stroke-linejoin", "round");
        line.setAttribute("opacity", ".72");
        svg.appendChild(line);
        return svg;
    }

    function createPipeBoundsHighlight(edge) {
        const state = cellState(edge);
        const width = Math.max(12, finiteNumber(state.width, 0));
        const height = Math.max(12, finiteNumber(state.height, 0));
        const borderWidth = Math.max(3, Math.ceil(pipeHighlightStrokeWidth(edge) / 2));
        const node = document.createElement("div");
        node.className = "trellis-irrigation-selected-pipe-highlight";
        node.setAttribute("data-edge-id", getCellId(edge) || "");
        node.style.cssText = "position:absolute;z-index:999;left:" + Math.round(finiteNumber(state.x, 0) - borderWidth - 1) + "px;top:" + Math.round(finiteNumber(state.y, 0) - borderWidth - 1) + "px;width:" + Math.round(width + (borderWidth + 1) * 2) + "px;height:" + Math.round(height + (borderWidth + 1) * 2) + "px;pointer-events:none;border:" + borderWidth + "px solid #f59e0b;border-radius:6px;box-shadow:0 0 0 3px rgba(245,158,11,.20);box-sizing:border-box;";
        return node;
    }

    function pointBounds(points, padding) {
        const pad = Math.max(0, finiteNumber(padding, 0));
        const xs = points.map(function (point) { return point.x; });
        const ys = points.map(function (point) { return point.y; });
        const minX = Math.min.apply(Math, xs) - pad;
        const minY = Math.min.apply(Math, ys) - pad;
        const maxX = Math.max.apply(Math, xs) + pad;
        const maxY = Math.max.apply(Math, ys) + pad;
        return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
    }

    function internalConnectionBoundariesForSelection(moduleCell, selectedCells) {
        const seen = new Set();
        const out = [];
        (selectedCells || []).forEach(function (cell) {
            const assembly = isAssembly(cell) ? cell : findAssemblyAncestor(cell);
            if (!assembly || assemblyType(assembly) === "bed") return;
            const parts = assemblyPartCells(assembly);
            const selectedIndex = isAssembly(cell) ? -1 : parts.indexOf(cell);
            for (let index = 0; index < parts.length - 1; index++) {
                if (selectedIndex >= 0 && index !== selectedIndex && index + 1 !== selectedIndex) continue;
                const boundary = internalBoundaryForParts(assembly, parts[index], parts[index + 1]);
                const key = boundaryKey(boundary);
                if (!key || seen.has(key)) continue;
                seen.add(key);
                out.push({ boundary, assembly, upstream: parts[index], downstream: parts[index + 1] });
            }
        });
        return out;
    }

    function internalConnectionBadgeStyle(selected) {
        const border = selected ? "3px solid #1d4ed8" : "1px solid #7c3aed";
        const background = selected ? "#dbeafe" : "#f3e8ff";
        const shadow = selected ? "0 0 0 3px rgba(29,78,216,.22),0 2px 7px rgba(0,0,0,.24)" : "0 1px 4px rgba(0,0,0,.18)";
        return "position:absolute;z-index:1003;width:" + portBadgeWidthForLabel("C") + "px;height:" + PORT_BADGE_SIZE + "px;padding:0 5px;border:" + border + ";border-radius:4px;background:" + background + ";box-shadow:" + shadow + ";color:#3b0764;font:bold 10px/" + PORT_BADGE_SIZE + "px Arial,sans-serif;cursor:pointer;box-sizing:border-box;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    }

    function positionInternalConnectionBadge(node, upstream, downstream) {
        const up = cellState(upstream);
        const down = cellState(downstream);
        const x = Math.max(finiteNumber(up.x, 0) + finiteNumber(up.width, 0), finiteNumber(down.x, 0) + finiteNumber(down.width, 0)) + 4;
        const y = (up.y + up.height + down.y) / 2 - PORT_BADGE_SIZE / 2;
        node.style.left = Math.round(x) + "px";
        node.style.top = Math.round(y) + "px";
    }

    function selectedAssemblyPartCells(selected) {
        const seen = new Set();
        const out = [];
        (selected || []).forEach(function (cell) {
            if (!isAssemblyPartCell(cell)) return;
            const id = getCellId(cell);
            if (id && seen.has(id)) return;
            if (id) seen.add(id);
            out.push(cell);
        });
        return out;
    }

    function lifecycleTargetStates(moduleCell, targets) {
        const states = new Set();
        (targets.partCells || []).forEach(function (cell) { states.add(partStateForCell(cell)); });
        (targets.pipeEdges || []).forEach(function (edge) { states.add(partStateForCell(edge)); });
        (targets.bedAssemblies || []).forEach(function (assembly) { states.add(partStateForRecord(readBedAssemblyTemplateRecord(moduleCell, assembly))); });
        return states;
    }

    function lifecycleTargetsForSelection(moduleCell, selected) {
        const partCells = [];
        const pipeEdges = [];
        const bedAssemblies = [];
        const seenParts = new Set();
        const seenEdges = new Set();
        const seenBeds = new Set();
        function pushPart(cell) { const id = getCellId(cell); if (!isLifecyclePartTargetCell(cell) || id && seenParts.has(id)) return; if (id) seenParts.add(id); partCells.push(cell); }
        function pushPipe(edge) { const id = getCellId(edge); if (!edge || getCellAttr(edge, ATTRS.PIPE_EDGE, "") !== "1" || id && seenEdges.has(id)) return; if (id) seenEdges.add(id); pipeEdges.push(edge); }
        function pushBed(assembly) { const id = getCellId(assembly); if (!isBedAssembly(assembly) || id && seenBeds.has(id)) return; if (id) seenBeds.add(id); bedAssemblies.push(assembly); }
        (selected || []).forEach(function (cell) {
            if (isBedAssembly(cell)) { pushBed(cell); return; }
            if (isAssembly(cell)) { assemblyPartCells(cell).forEach(pushPart); externalEdgesForAssemblyCell(moduleCell, cell).forEach(pushPipe); return; }
            if (isLifecyclePartTargetCell(cell)) { pushPart(cell); return; }
            if (getCellAttr(cell, ATTRS.PIPE_EDGE, "") === "1") pushPipe(cell);
        });
        return { partCells, pipeEdges, bedAssemblies, count: partCells.length + pipeEdges.length + bedAssemblies.length };
    }

    function markIrrigationSelectionState(session, selected, state) {
        const normalized = normalizePartState(state);
        const changed = runIrrigationEdit("markIrrigationPartState", function () {
            const targets = lifecycleTargetsForSelection(session.moduleCell, selected);
            let didChange = false;
            model.beginUpdate && model.beginUpdate();
            try {
                targets.partCells.forEach(function (cell) { didChange = setPartCellState(cell, normalized) || didChange; });
                targets.pipeEdges.forEach(function (edge) { didChange = setPipeEdgeState(edge, normalized) || didChange; });
                targets.bedAssemblies.forEach(function (assembly) { didChange = setBedTemplatePartState(session.moduleCell, assembly, normalized) || didChange; });
            } finally { model.endUpdate && model.endUpdate(); }
            if (didChange) scheduleHudGraphStateSync(session.moduleCell);
            return didChange;
        });
        session.message = changed ? "Marked irrigation parts " + normalized + "." : "No irrigation parts changed.";
        renderIrrigationMode(session);
    }

    function setBedTemplatePartState(moduleCell, bedAssembly, state) {
        const record = readBedAssemblyTemplateRecord(moduleCell, bedAssembly);
        if (!record) return false;
        const normalized = normalizePartState(state);
        const next = Object.assign({}, record, { partState: normalized });
        let changed = JSON.stringify(next) !== JSON.stringify(record) ? setCellAttrs(bedAssembly, { [ATTRS.BED_TEMPLATE_JSON]: JSON.stringify(next) }) : false;
        changed = refreshBedAssemblyRowsFromTemplate(moduleCell, bedAssembly, bedCellForAssembly(moduleCell, bedAssembly), next) || changed;
        return changed;
    }

    function deleteAssemblySelection(session, selected) {
        if (activeIrrigationEditDepth === 0) return runIrrigationEdit("deleteAssemblySelection", function () { return deleteAssemblySelection(session, selected); });
        const assemblies = [];
        const parts = [];
        const seen = new Set();
        const seenParts = new Set();
        (selected || []).forEach(function (cell) {
            if (isAssemblyPartCell(cell)) {
                const partId = getCellId(cell);
                if (partId && !seenParts.has(partId)) { seenParts.add(partId); parts.push(cell); }
                return;
            }
            const assembly = isAssembly(cell) ? cell : findAssemblyAncestor(cell);
            const id = getCellId(assembly);
            if (!assembly || !id || seen.has(id)) return;
            seen.add(id);
            assemblies.push(assembly);
        });
        model.beginUpdate && model.beginUpdate();
        try {
            parts.sort(function (a, b) {
                const assemblyA = findAssemblyAncestor(a);
                const assemblyB = findAssemblyAncestor(b);
                if (assemblyA !== assemblyB) return String(getCellId(assemblyA) || "").localeCompare(String(getCellId(assemblyB) || ""));
                return assemblyPartCells(assemblyA).indexOf(b) - assemblyPartCells(assemblyA).indexOf(a);
            }).forEach(function (part) { deleteAssemblyPartCell(session.moduleCell, part); });
            assemblies.forEach(function (assembly) {
                externalEdgesForCell(session.moduleCell, assembly).forEach(removeCellFromParent);
                assemblyPartCells(assembly).forEach(function (part) { externalEdgesForCell(session.moduleCell, part).forEach(removeCellFromParent); });
                removeCellFromParent(assembly);
            });
            selectCell(session.moduleCell, false);
        } finally { model.endUpdate && model.endUpdate(); }
        session.selectedPorts = [];
        session.selectedBoundaries = [];
        scheduleHudGraphStateSync(session.moduleCell);
        renderIrrigationMode(session);
    }

    function renderSelectedZoneControls(session, hud, selectedCells) {
        const bedAssemblies = selectedBedAssembliesFromCells(selectedCells);
        if (!bedAssemblies.length) return;
        const zones = ZoneModel.sync(session.moduleCell);
        const resolved = ZoneModel.resolveMembership(session.moduleCell, zones);
        const bedIds = bedAssemblies.map(getCellId).filter(Boolean);
        const zoneIds = uniqueStrings(bedIds.map(function (id) { const entry = resolved.assignment.get(id); return entry && entry.zoneId || ""; }).filter(Boolean));
        const current = zoneIds.length === 1 ? zones.find(function (zone) { return zone.id === zoneIds[0]; }) : null;
        const wrap = hudSection("Zone");
        wrap.className += " trellis-irrigation-zone-controls";
        wrap.appendChild(hudText("Zone: " + (zoneIds.length === 0 ? "Unzoned" : (zoneIds.length > 1 ? "Mixed" : ZoneModel.displayName(session.moduleCell, current)))));
        const select = document.createElement("select");
        select.className = "trellis-irrigation-zone-picker";
        appendSelectOption(select, "", "Assign to zone...");
        zones.forEach(function (zone) { appendSelectOption(select, zone.id, ZoneModel.displayName(session.moduleCell, zone)); });
        select.addEventListener("change", function () {
            if (!select.value) return;
            runIrrigationEdit("assignZone", function () { ZoneModel.assignBeds(session.moduleCell, select.value, bedIds); HudController.syncGraphState(session.moduleCell); });
            session.message = "Zone assignment updated.";
            renderIrrigationMode(session);
        });
        wrap.appendChild(select);
        const actions = hudActions();
        const editZones = button("Edit Zones", function () { openZoneManager(session.moduleCell, session); });
        editZones.style.border = "1px solid #2563eb"; editZones.style.background = "#eff6ff"; editZones.style.color = "#1e3a8a";
        actions.appendChild(editZones);
        const resetZone = button("Reset Zone", function () {
            runIrrigationEdit("resetZone", function () { ZoneModel.resetBedOverrides(session.moduleCell, bedIds); HudController.syncGraphState(session.moduleCell); });
            session.message = "Zone overrides reset.";
            renderIrrigationMode(session);
        });
        actions.appendChild(styleHudOutlineButton(resetZone, HUD_OUTLINE_RED));
        wrap.appendChild(actions);
        hud.appendChild(wrap);
    }

    function openZoneManager(moduleCell, session) {
        const state = {};
        const div = document.createElement("div");
        div.className = "trellis-irrigation-zone-manager";
        div.style.cssText = "width:880px;max-width:96vw;max-height:84vh;overflow:auto;font:12px Arial,sans-serif;padding:12px;";
        showDialog(div, 900, 620);
        renderZoneManager(div, moduleCell, state, session);
    }

    function renderZoneManager(container, moduleCell, state, session) {
        const zones = ZoneModel.sync(moduleCell);
        const report = ZoneModel.summary(moduleCell, zones, ReportModel.deriveAssemblyPaths(moduleCell));
        container.innerHTML = "";
        const title = document.createElement("h2");
        title.textContent = "Irrigation Zones";
        title.style.cssText = "font-size:16px;margin:0 0 8px;";
        container.appendChild(title);
        container.appendChild(hudText(report.zoneCount + " zones, " + report.unzonedBedCount + " unzoned beds, " + report.overCapacityZoneCount + " capacity warnings."));
        const table = document.createElement("table");
        table.style.cssText = "width:100%;border-collapse:collapse;margin-top:8px;";
        table.innerHTML = "<thead><tr><th>Zone</th><th>Origin</th><th>Beds</th><th>Demand</th><th>Status</th><th>Actions</th></tr></thead>";
        const tbody = document.createElement("tbody");
        report.zones.forEach(function (detail) {
            const zone = zones.find(function (item) { return item.id === detail.id; }) || ZoneModel.normalize({ id: detail.id });
            const tr = document.createElement("tr");
            const nameTd = document.createElement("td");
            const alias = document.createElement("input");
            alias.value = zone.alias || "";
            alias.placeholder = ZoneModel.displayName(moduleCell, zone);
            alias.style.cssText = "width:150px;padding:3px;border:1px solid #aaa;border-radius:4px;";
            nameTd.appendChild(alias);
            const originTd = document.createElement("td");
            originTd.textContent = zone.originType === ZONE_ORIGIN_TIMER_OUTLET ? "Timer outlet " + (finiteNumber(zone.outletIndex, 0) + 1) : "Manual";
            const bedsTd = document.createElement("td");
            bedsTd.textContent = detail.memberBedIds.map(function (id) { return bedAssemblyLabel(moduleCell, findCellById(moduleCell, id)); }).join(", ") || "Empty";
            const demandTd = document.createElement("td");
            demandTd.textContent = finiteNumber(detail.demandGpm, 0).toFixed(2) + " gpm";
            const statusTd = document.createElement("td");
            statusTd.textContent = detail.warnings.length ? detail.warnings.join(" ") : detail.status;
            statusTd.style.color = detail.warnings.length ? "#8a4b00" : "#116611";
            const actionsTd = document.createElement("td");
            actionsTd.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;";
            actionsTd.appendChild(button("Save", function () { runIrrigationEdit("saveZoneAlias", function () { ZoneModel.updateAlias(moduleCell, zone.id, alias.value); HudController.syncGraphState(moduleCell); }); renderZoneManager(container, moduleCell, state, session); if (session) renderIrrigationMode(session); }, "add"));
            actionsTd.appendChild(button("Reset", function () { runIrrigationEdit("resetZoneOverrides", function () { ZoneModel.resetZoneOverrides(moduleCell, zone.id); HudController.syncGraphState(moduleCell); }); renderZoneManager(container, moduleCell, state, session); if (session) renderIrrigationMode(session); }, "danger"));
            detail.memberBedIds.forEach(function (bedId) {
                actionsTd.appendChild(button("Reset " + bedAssemblyLabel(moduleCell, findCellById(moduleCell, bedId)), function () { runIrrigationEdit("resetBedZoneOverride", function () { ZoneModel.resetBedOverrides(moduleCell, [bedId]); HudController.syncGraphState(moduleCell); }); renderZoneManager(container, moduleCell, state, session); if (session) renderIrrigationMode(session); }, "danger"));
            });
            [nameTd, originTd, bedsTd, demandTd, statusTd, actionsTd].forEach(function (td) { td.style.border = "1px solid #ccc"; td.style.padding = "4px"; td.style.verticalAlign = "top"; tr.appendChild(td); });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        container.appendChild(table);
        if (report.unzonedBedIds.length || report.ambiguousBedIds.length) {
            const warn = document.createElement("div");
            warn.style.cssText = "margin-top:8px;color:#8a4b00;line-height:1.35;";
            warn.textContent = (report.unzonedBedIds.length ? "Unzoned: " + report.unzonedBedIds.map(function (id) { return bedAssemblyLabel(moduleCell, findCellById(moduleCell, id)); }).join(", ") + ". " : "") + (report.ambiguousBedIds.length ? "Ambiguous: " + report.ambiguousBedIds.map(function (id) { return bedAssemblyLabel(moduleCell, findCellById(moduleCell, id)); }).join(", ") + "." : "");
            container.appendChild(warn);
        }
        const controls = hudActions();
        controls.appendChild(button("New Manual Zone", function () { runIrrigationEdit("newManualZone", function () { ZoneModel.createManual(moduleCell, "Manual Zone", []); HudController.syncGraphState(moduleCell); }); renderZoneManager(container, moduleCell, state, session); if (session) renderIrrigationMode(session); }, "add"));
        controls.appendChild(button("Close", hideDialog, "close")); // CHANGE
        container.appendChild(controls);
    }

    function bedAssemblyLabel(moduleCell, bedAssembly) {
        const bed = bedCellForAssembly(moduleCell, bedAssembly);
        return getCellAttr(bed, "label", getCellAttr(bedAssembly, "label", getCellId(bedAssembly) || "Bed"));
    }

    function appendModuleSummary(session, hud) {
        const summary = readDashboardSummary(session.moduleCell);
        const text = summary ? "Irrigated " + Math.round(summary.percentIrrigated || 0) + "%, zones " + (summary.zoneCount || 0) + ", zone warnings " + (summary.zoneWarningCount || 0) + "." : "Select a source, part, or bed inlet to work in the diagram.";
        hud.appendChild(hudText(text));
    }

    function appendHudStatus(hud, session) {
        if (!session.message) return;
        hud.appendChild(hudWarning(session.message));
    }

    function hudTitle(text) {
        const title = document.createElement("div");
        title.style.cssText = "font-weight:700;margin-bottom:6px;";
        title.textContent = text;
        return title;
    }

    function appendIrrigationHudHeader(hud, session, titleContent, options) {
        const opts = options || {};
        const header = document.createElement("div");
        header.className = "trellis-irrigation-hud-header";
        header.style.cssText = "display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:start;border-bottom:1px solid #e5e7eb;padding-bottom:6px;margin-bottom:2px;min-width:0;max-width:100%;box-sizing:border-box;";
        const title = document.createElement("div");
        title.className = "trellis-irrigation-hud-header-title";
        title.style.cssText = "font-weight:700;min-width:0;max-width:100%;box-sizing:border-box;overflow:hidden;text-overflow:ellipsis;";
        if (titleContent && titleContent.nodeType) title.appendChild(titleContent);
        else title.textContent = String(titleContent == null ? "" : titleContent);
        const actions = document.createElement("div");
        actions.className = "trellis-irrigation-hud-header-actions";
        actions.style.cssText = "display:flex;align-items:flex-start;justify-content:flex-end;gap:4px;flex-wrap:wrap;min-width:0;max-width:100%;box-sizing:border-box;";
        appendHeaderLifecycleToggle(actions, session, opts.selected || []);
        appendAnalysisModeToggle(actions, session); // NEW
        if (Array.isArray(opts.bomPartIds)) {
            const bom = compactHudButton("BOM", function () {
                if (opts.syncBeforeBom) runIrrigationEdit("bomSync", function () { syncHudGraphState(session.moduleCell); });
                openBomDialog(session.moduleCell, { selectedPartIds: opts.bomPartIds });
            });
            styleHudOutlineButton(bom, HUD_OUTLINE_BLUE);
            actions.appendChild(bom);
        }
        const catalog = compactHudButton("Catalog", function () { openCatalogManager(session.moduleCell); });
        styleHudOutlineButton(catalog, HUD_OUTLINE_BLUE);
        actions.appendChild(catalog);
        const exit = exitIrrigationButton();
        styleCompactHudButton(exit);
        exit.className = (exit.className || "") + " trellis-irrigation-hud-exit-button";
        exit.style.borderColor = "#b91c1c";
        exit.style.color = "#b91c1c";
        actions.appendChild(exit);
        header.appendChild(title);
        header.appendChild(actions);
        hud.appendChild(header);
        return header;
    }

    function appendAnalysisModeToggle(parent, session) { // NEW
        const group = document.createElement("div"); // NEW
        group.className = "trellis-irrigation-analysis-mode-toggle"; // NEW
        group.style.cssText = "display:inline-flex;align-items:center;gap:0;border:1px solid #c7c7cc;border-radius:4px;overflow:hidden;box-sizing:border-box;"; // NEW
        [[ANALYSIS_MODE_BUILD, "Build"], [ANALYSIS_MODE_ANALYSIS, "Analysis"]].forEach(function (entry) { // NEW
            const mode = entry[0]; // NEW
            const btn = compactHudButton(entry[1], function () { // NEW
                session.analysisMode = mode; // NEW
                if (mode === ANALYSIS_MODE_BUILD) session.analysisZoneId = ""; // NEW
                renderIrrigationMode(session); // NEW
            }); // NEW
            styleAnalysisModeSegment(btn, session.analysisMode === mode); // NEW
            btn.setAttribute("aria-pressed", session.analysisMode === mode ? "true" : "false"); // NEW
            group.appendChild(btn); // NEW
        }); // NEW
        parent.appendChild(group); // NEW
        return group; // NEW
    } // NEW

    function styleAnalysisModeSegment(buttonNode, active) { // NEW
        buttonNode.style.border = "0"; // NEW
        buttonNode.style.borderRadius = "0"; // NEW
        buttonNode.style.background = active ? "#ecfeff" : "#fff"; // NEW
        buttonNode.style.color = active ? "#155e75" : "#374151"; // NEW
        buttonNode.style.fontWeight = active ? "700" : "400"; // NEW
    } // NEW

    function compactHudButton(label, fn, variant) {
        const b = button(label, fn, variant || "neutral");
        styleCompactHudButton(b);
        return b;
    }

    function styleCompactHudButton(b) {
        b.style.padding = "3px 6px";
        b.style.font = "12px Arial,sans-serif";
        b.style.whiteSpace = "nowrap";
        b.style.overflowWrap = "normal";
        b.style.border = b.style.border || "1px solid #c7c7cc";
        b.style.borderRadius = "4px";
        b.style.background = b.style.background || "#fff";
        return b;
    }

    function styleHudOutlineButton(b, color) {
        const danger = color === HUD_OUTLINE_RED; // NEW
        applyIrrigationButtonStyle(b, color === HUD_OUTLINE_BLUE ? "open" : (color === HUD_OUTLINE_GREEN ? "add" : (danger ? "danger" : "neutral")), { compact: true }); // CHANGE
        b.style.border = "1px solid " + color;
        b.style.color = danger ? "#fff" : color; // CHANGE
        b.style.background = danger ? color : "#fff"; // CHANGE
        return b;
    }

    function appendHeaderLifecycleToggle(parent, session, selected) {
        const targets = lifecycleTargetsForSelection(session.moduleCell, selected);
        if (!targets.count) return null;
        const states = lifecycleTargetStates(session.moduleCell, targets);
        const plannedOnly = states.size === 1 && states.has(PART_STATE_PLANNED);
        const completedOnly = states.size === 1 && states.has(PART_STATE_COMPLETED);
        const group = document.createElement("div");
        group.className = "trellis-irrigation-lifecycle-toggle";
        group.style.cssText = "display:inline-flex;align-items:center;gap:0;border:1px solid #c7c7cc;border-radius:4px;overflow:hidden;box-sizing:border-box;";
        const planned = compactHudButton("Planned", function () { markIrrigationSelectionState(session, selected, PART_STATE_PLANNED); });
        const completed = compactHudButton("Completed", function () { markIrrigationSelectionState(session, selected, PART_STATE_COMPLETED); });
        styleLifecycleSegment(planned, plannedOnly);
        styleLifecycleSegment(completed, completedOnly);
        planned.setAttribute("aria-pressed", plannedOnly ? "true" : "false");
        completed.setAttribute("aria-pressed", completedOnly ? "true" : "false");
        group.appendChild(planned);
        group.appendChild(completed);
        parent.appendChild(group);
        return group;
    }

    function styleLifecycleSegment(buttonNode, active) {
        buttonNode.style.border = "0";
        buttonNode.style.borderRadius = "0";
        buttonNode.style.background = active ? "#e8f5e9" : "#fff";
        buttonNode.style.color = active ? "#166534" : "#374151";
        buttonNode.style.fontWeight = active ? "700" : "400";
    }

    function stylePipeEdgeStyleButton(buttonNode, active) {
        buttonNode.style.padding = "4px 7px";
        buttonNode.style.border = "1px solid " + (active ? "#2563eb" : "#c7c7cc");
        buttonNode.style.borderRadius = "4px";
        buttonNode.style.background = active ? "#dbeafe" : "#fff";
        buttonNode.style.color = active ? "#1e3a8a" : "#374151";
        buttonNode.style.fontWeight = active ? "700" : "400";
        buttonNode.style.whiteSpace = "nowrap";
    }

    function hudSection(titleText) {
        const section = document.createElement("div");
        section.className = "trellis-irrigation-hud-section";
        section.style.cssText = "display:grid;gap:6px;border-top:1px solid #ddd;padding-top:6px;margin-top:6px;min-width:0;max-width:100%;box-sizing:border-box;overflow:hidden;";
        const title = document.createElement("div");
        title.className = "trellis-irrigation-hud-section-title";
        title.style.cssText = "font-weight:700;min-width:0;max-width:100%;box-sizing:border-box;overflow:hidden;text-overflow:ellipsis;";
        title.textContent = titleText;
        section.appendChild(title);
        return section;
    }

    function hudText(text) {
        const div = document.createElement("div");
        div.style.cssText = "margin:6px 0;color:#333;line-height:1.35;min-width:0;max-width:100%;box-sizing:border-box;overflow-wrap:anywhere;";
        div.textContent = text;
        return div;
    }

    function hudWarning(text) {
        const div = document.createElement("div");
        div.className = "trellis-irrigation-hud-warning";
        div.style.cssText = "margin:6px 0;color:#8a4b00;line-height:1.35;min-width:0;max-width:100%;box-sizing:border-box;overflow-wrap:anywhere;";
        div.textContent = text;
        return div;
    }

    function hudActions() {
        const div = document.createElement("div");
        div.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;min-width:0;max-width:100%;box-sizing:border-box;overflow:hidden;";
        return div;
    }

    function appendHudDangerAction(hud, label, fn) {
        const wrap = document.createElement("div");
        wrap.className = "trellis-irrigation-danger-actions";
        wrap.style.cssText = "display:flex;justify-content:flex-end;gap:6px;border-top:1px solid #f1d5d5;padding-top:6px;margin-top:6px;min-width:0;max-width:100%;box-sizing:border-box;";
        const danger = button(label, fn, "danger"); // CHANGE
        danger.className = (danger.className || "") + " trellis-irrigation-danger-button";
        danger.style.padding = "4px 7px";
        danger.style.border = "1px solid #b91c1c";
        danger.style.borderRadius = "4px";
        danger.style.background = "#b91c1c"; // CHANGE
        danger.style.color = "#fff"; // CHANGE
        danger.style.whiteSpace = "nowrap";
        danger.style.overflowWrap = "normal";
        wrap.appendChild(danger);
        hud.appendChild(wrap);
        return danger;
    }

    function appendLocalDeleteAction(session, hud, selected, selectedParts, selectedAssemblies) {
        const parts = selectedParts || [];
        const assemblies = selectedAssemblies || [];
        if (!parts.length && !assemblies.length) return false;
        const mixed = parts.length > 0 && assemblies.length > 0;
        const label = mixed || parts.length + assemblies.length > 1 ? "Delete Selection" : (parts.length ? "Delete Part" : "Delete Assembly");
        const targets = mixed ? selected : (parts.length ? parts : assemblies);
        appendHudDangerAction(hud, label, function () { deleteAssemblySelection(session, targets); });
        return true;
    }

    function appendHudActionSection(parent, titleText, actions) {
        if (!actions || !actions.childNodes || !actions.childNodes.length) return null;
        const section = hudSection(titleText);
        section.className += " trellis-irrigation-action-section";
        actions.style.marginTop = "0";
        section.appendChild(actions);
        parent.appendChild(section);
        return section;
    }

    function validateHudConnection(moduleCell, source, target) {
        if (!source || !target) return { ok: false, reason: "Select a compatible irrigation target." };
        if (!isHudIrrigationObject(source) || !isHudIrrigationObject(target)) return { ok: false, reason: "Target must be an irrigation source, part, or bed inlet." };
        if (source === target) return { ok: false, reason: "Irrigation trees cannot connect a part to itself." };
        if (endpointType(source) === "bed") return { ok: false, reason: "Bed inlets cannot have downstream children." };
        if (incomingHudEdges(moduleCell, target).length) return { ok: false, reason: "Target already has an upstream parent." };
        if (wouldCreateCycle(moduleCell, source, target)) return { ok: false, reason: "Irrigation trees cannot contain cycles." };
        const maxChildren = outputCapacityForCell(moduleCell, source);
        if (outgoingHudEdges(moduleCell, source).length >= maxChildren) return { ok: false, reason: "Selected part has no free downstream output." };
        return validateHudCompatibility(moduleCell, source, target);
    }

    function validateHudCompatibility(moduleCell, source, target) {
        const sourcePart = partForCell(moduleCell, source);
        const targetPart = partForCell(moduleCell, target);
        if (endpointType(source) === "source" && targetPart) return canEndpointConnectToPart(endpointProfile(source), targetPart);
        if (endpointType(source) === "source" && endpointType(target) === "bed") {
            const direct = connectorRecordsMatch(endpointProfileAsConnector(endpointProfile(source)), endpointProfileAsConnector(endpointProfile(target)), endpointProfile(target));
            return direct.ok ? direct : { ok: false, reason: "Source endpoint cannot connect directly to bed inlet: " + direct.reason };
        }
        if (sourcePart && targetPart) return canConnectParts(sourcePart, targetPart, endpointType(target) === "bed" ? endpointProfile(target) : null);
        if (sourcePart && endpointType(target) === "bed") return canPartReachEndpoint(sourcePart, endpointProfile(target));
        return { ok: false, reason: "Unsupported irrigation connection." };
    }

    function endpointProfileAsConnector(profile) {
        return { type: profile.connectorType, nominalSize: profile.nominalSize, pipeType: profile.pipeType || "", pipeConnection: !!profile.pipeConnection };
    }

    function outputCapacityForCell(moduleCell, cell) {
        if (endpointType(cell) === "source") return 1;
        const part = partForCell(moduleCell, cell);
        return Math.max(0, finiteNumber(part && part.connectors && part.connectors.outputs, 0));
    }

    function wouldCreateCycle(moduleCell, source, target) {
        let cur = source;
        const seen = new Set();
        while (cur) {
            if (cur === target) return true;
            const id = getCellId(cur);
            if (!id || seen.has(id)) return true;
            seen.add(id);
            const incoming = incomingHudEdges(moduleCell, cur)[0];
            cur = incoming && incoming.source;
        }
        return false;
    }

    function partForCell(moduleCell, cell) {
        const partId = getCellAttr(cell, ATTRS.CATALOG_PART_ID, "");
        return partById(readCatalog(moduleCell), partId);
    }

    function isLegacyGenerated(cell) {
        return getCellAttr(cell, ATTRS.GENERATED, "") === "1";
    }

    function isHudIrrigationObject(cell) {
        if (!cell || isLegacyGenerated(cell)) return false;
        return isEndpoint(cell) || getCellAttr(cell, ATTRS.COMPONENT, "") === "1" || (isAssembly(cell) && assemblyType(cell) === "bed");
    }

    function isHudPipeEdge(cell) {
        return !!cell && !isLegacyGenerated(cell) && (getCellAttr(cell, ATTRS.PIPE_EDGE, "") === "1" || getCellAttr(cell, ATTRS.DIRECT_LINK_EDGE, "") === "1");
    }

    function collectHudObjects(moduleCell) {
        return collectDescendants(moduleCell, isHudIrrigationObject);
    }

    function collectHudEndpoints(moduleCell, type) {
        return collectHudObjects(moduleCell).filter(function (cell) { return isEndpoint(cell) && (!type || endpointType(cell) === type); });
    }

    function collectHudPipeEdges(moduleCell) {
        return collectDescendants(moduleCell, isHudPipeEdge);
    }

    function incomingHudEdges(moduleCell, cell) {
        return collectHudPipeEdges(moduleCell).filter(function (edge) { return edge.target === cell; });
    }

    function outgoingHudEdges(moduleCell, cell) {
        return collectHudPipeEdges(moduleCell).filter(function (edge) { return edge.source === cell; });
    }

    function irrigationCellKind(cell) {
        if (endpointType(cell) === "source") return "source";
        if (endpointType(cell) === "bed") return "bed";
        return "part";
    }

    function irrigationCellLabel(cell) {
        if (isEndpoint(cell)) return endpointLabel(cell);
        return getCellAttr(cell, "label", getCellId(cell) || "Irrigation part");
    }

    function cellWarning(moduleCell, cell) {
        if (endpointType(cell) === "source") return hasDownstreamConnection(moduleCell, cell) ? "" : "Source has no downstream irrigation tree.";
        if (!hasSourceRoute(moduleCell, cell)) return "Disconnected irrigation object.";
        const validation = incomingHudEdges(moduleCell, cell)[0];
        if (validation && !validateHudCompatibility(moduleCell, validation.source, cell).ok) return "Incoming connection is incompatible.";
        return "";
    }

    function hasDownstreamConnection(moduleCell, cell) {
        return downstreamIrrigationChildren(moduleCell, cell).length > 0;
    }

    function hasSourceRoute(moduleCell, cell) {
        const stack = [cell];
        const seen = new Set();
        while (stack.length) {
            const cur = stack.pop();
            const id = getCellId(cur);
            if (!id || seen.has(id)) continue;
            if (endpointType(cur) === "source") return true;
            seen.add(id);
            upstreamIrrigationParents(moduleCell, cur).forEach(function (parent) { stack.push(parent); });
        }
        return false;
    }

    function upstreamIrrigationParents(moduleCell, cell) {
        const parents = incomingHudEdges(moduleCell, cell).map(function (edge) { return edge.source; }).filter(Boolean);
        const internal = internalNeighborForPort(cell, "input");
        if (internal) parents.push(internal);
        return uniqueCells(parents);
    }

    function downstreamIrrigationChildren(moduleCell, cell) {
        const children = outgoingHudEdges(moduleCell, cell).map(function (edge) { return edge.target; }).filter(Boolean);
        const internal = internalNeighborForPort(cell, "output");
        if (internal) children.push(internal);
        return uniqueCells(children);
    }

    function renderZoneBadges(session) {
        const zones = ZoneModel.sync(session.moduleCell);
        const resolved = ZoneModel.resolveMembership(session.moduleCell, zones);
        resolved.assignment.forEach(function (entry, bedAssemblyId) {
            const bedAssembly = findCellById(session.moduleCell, bedAssemblyId);
            const zone = zones.find(function (item) { return item.id === entry.zoneId; });
            if (!bedAssembly || !zone) return;
            const badge = document.createElement("div");
            badge.className = "trellis-irrigation-zone-badge";
            badge.title = "Zone: " + ZoneModel.displayName(session.moduleCell, zone);
            badge.textContent = zoneBadgeLabel(session.moduleCell, zone);
            badge.style.cssText = "position:absolute;z-index:997;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:2px 5px;border:1px solid #2563eb;border-radius:4px;background:#eff6ff;color:#1e3a8a;font:bold 11px Arial,sans-serif;";
            positionOverlayBox(badge, bedAssembly, 4);
            badge.style.width = "";
            badge.style.height = "";
            appendOverlayNode(badge);
            session.zoneBadges.push(badge);
        });
    }

    function zoneBadgeLabel(moduleCell, zone) {
        if (zone.alias) return zone.alias;
        if (zone.originType === ZONE_ORIGIN_TIMER_OUTLET) return "Z" + (finiteNumber(zone.outletIndex, 0) + 1);
        return zoneDisplayName(moduleCell, zone);
    }

    function renderAnalysisOverlays(session, view) { // NEW
        const analysis = view && view.analysis || {}; // NEW
        (analysis.coverageOverlays || []).forEach(function (coverage) { if (!coverage.issue) renderAnalysisCoverageOverlay(session, coverage); }); // NEW
        (analysis.pipeLabels || []).forEach(function (pipe) { renderAnalysisPipeLabel(session, pipe); }); // NEW
        (analysis.endpointLabels || []).forEach(function (endpoint) { renderAnalysisEndpointLabel(session, endpoint); }); // NEW
        if (analysis.source) renderAnalysisSourceLabel(session, analysis); // NEW
    } // NEW

    function renderAnalysisPipeLabel(session, pipe) { // NEW
        if (!pipe || !pipe.edge) return; // NEW
        const label = analysisOverlayLabel("trellis-irrigation-analysis-pipe-label", formatGpm(pipe.flowGpm) + "\n" + formatFeet(pipe.lengthFt) + " / " + formatPsi(pipe.pressureLossPsi), analysisLabelColor(pipe.pressureLossPsi == null ? "unknown" : "ok")); // NEW
        positionAnalysisEdgeLabel(label, pipe.edge); // NEW
        appendOverlayNode(label); // NEW
        session.analysisOverlays.push(label); // NEW
    } // NEW

    function renderAnalysisEndpointLabel(session, endpoint) { // NEW
        if (!endpoint || !endpoint.cell) return; // NEW
        const status = endpoint.marginPsi == null ? "unknown" : (endpoint.marginPsi < 0 ? "error" : (endpoint.marginPsi < ANALYSIS_LOW_MARGIN_PSI ? "warning" : "ok")); // NEW
        const label = analysisOverlayLabel("trellis-irrigation-analysis-endpoint-label", formatGpm(endpoint.flowGpm) + "\nmargin " + formatPsi(endpoint.marginPsi), analysisLabelColor(status)); // NEW
        positionOverlayBox(label, endpoint.cell, -18); // NEW
        label.style.width = ""; // NEW
        label.style.height = ""; // NEW
        appendOverlayNode(label); // NEW
        session.analysisOverlays.push(label); // NEW
    } // NEW

    function renderAnalysisSourceLabel(session, analysis) { // NEW
        const source = analysis.source; // NEW
        const profile = endpointProfile(source); // NEW
        const over = profile.usableFlowGpm != null && analysis.demandGpm > profile.usableFlowGpm; // NEW
        const label = analysisOverlayLabel("trellis-irrigation-analysis-source-label", "Source\n" + formatGpm(analysis.demandGpm) + " / " + formatGpm(profile.usableFlowGpm), analysisLabelColor(over ? "error" : "ok")); // NEW
        positionOverlayBox(label, source, -22); // NEW
        label.style.width = ""; // NEW
        label.style.height = ""; // NEW
        appendOverlayNode(label); // NEW
        session.analysisOverlays.push(label); // NEW
    } // NEW

    function renderAnalysisCoverageOverlay(session, coverage) { // NEW
        const cell = coverage && coverage.cell; // NEW
        const bounds = cellBoundsInModel(cell); // NEW
        if (!cell || !bounds) return; // NEW
        const bands = Array.isArray(coverage.bands) ? coverage.bands : []; // NEW
        if (bands.length) { // NEW
            bands.forEach(function (band) { renderAnalysisCoverageBox(session, coverage, band); }); // NEW
            return; // NEW
        } // NEW
        const node = analysisCoverageNode(); // NEW
        if (coverage.pattern === "rectangle" || !coverage.radiusFt) { // NEW
            positionModelBox(node, bounds); // NEW
        } else { // NEW
            const radiusUnits = feetToModelUnits(coverage.radiusFt); // NEW
            const cx = bounds.x + bounds.width / 2; // NEW
            const cy = bounds.y + bounds.height / 2; // NEW
            positionModelBox(node, { x: cx - radiusUnits, y: cy - radiusUnits, width: radiusUnits * 2, height: radiusUnits * 2 }); // NEW
            if (coverage.pattern === "circle" || coverage.pattern === "arc") node.style.borderRadius = "50%"; // NEW
        } // NEW
        appendOverlayNode(node); // NEW
        session.analysisOverlays.push(node); // NEW
    } // NEW

    function renderAnalysisCoverageBox(session, coverage, box) { // NEW
        const node = analysisCoverageNode(); // NEW
        positionModelBox(node, box); // NEW
        appendOverlayNode(node); // NEW
        session.analysisOverlays.push(node); // NEW
    } // NEW

    function analysisCoverageNode() { // NEW
        const node = document.createElement("div"); // NEW
        node.className = "trellis-irrigation-analysis-coverage"; // NEW
        node.title = "Approximate coverage"; // NEW
        node.style.cssText = "position:absolute;z-index:994;pointer-events:none;border:1px dashed #0f766e;background:rgba(20,184,166,.12);box-sizing:border-box;"; // NEW
        return node; // NEW
    } // NEW

    function analysisOverlayLabel(className, text, color) { // NEW
        const label = document.createElement("div"); // NEW
        label.className = className; // NEW
        label.textContent = text; // NEW
        label.style.cssText = "position:absolute;z-index:999;pointer-events:none;white-space:pre;max-width:130px;padding:2px 4px;border:1px solid " + color + ";border-radius:4px;background:#fff;color:" + color + ";font:bold 10px Arial,sans-serif;line-height:1.2;box-shadow:0 1px 4px rgba(0,0,0,.16);"; // NEW
        return label; // NEW
    } // NEW

    function analysisLabelColor(status) { // NEW
        if (status === "error") return "#b91c1c"; // NEW
        if (status === "warning") return "#92400e"; // NEW
        if (status === "unknown") return "#4b5563"; // NEW
        return "#166534"; // NEW
    } // NEW

    function positionAnalysisEdgeLabel(node, edge) { // NEW
        const points = edgeModelPoints(edge); // NEW
        let x = 0, y = 0; // NEW
        if (points.length) { // NEW
            const mid = points[Math.floor(points.length / 2)]; // NEW
            x = finiteNumber(mid && mid.x, 0); // NEW
            y = finiteNumber(mid && mid.y, 0); // NEW
        } else { // NEW
            const a = cellBoundsInModel(edge && edge.source); // NEW
            const b = cellBoundsInModel(edge && edge.target); // NEW
            x = ((a ? a.x + a.width / 2 : 0) + (b ? b.x + b.width / 2 : 0)) / 2; // NEW
            y = ((a ? a.y + a.height / 2 : 0) + (b ? b.y + b.height / 2 : 0)) / 2; // NEW
        } // NEW
        const screen = modelPointToScreenPoint({ x, y }); // NEW
        node.style.left = Math.round(screen.x + 6) + "px"; // NEW
        node.style.top = Math.round(screen.y + 6) + "px"; // NEW
    } // NEW

    function positionModelBox(node, box) { // NEW
        const topLeft = modelPointToScreenPoint({ x: box.x, y: box.y }); // NEW
        const scale = finiteNumber(graph.view && graph.view.scale, 1) || 1; // NEW
        node.style.left = Math.round(topLeft.x) + "px"; // NEW
        node.style.top = Math.round(topLeft.y) + "px"; // NEW
        node.style.width = Math.max(2, Math.round(finiteNumber(box.width, 0) * scale)) + "px"; // NEW
        node.style.height = Math.max(2, Math.round(finiteNumber(box.height, 0) * scale)) + "px"; // NEW
    } // NEW

    function modelPointToScreenPoint(point) { // NEW
        const scale = finiteNumber(graph.view && graph.view.scale, 1) || 1; // NEW
        const translate = graph.view && graph.view.translate ? graph.view.translate : { x: 0, y: 0 }; // NEW
        return { x: (finiteNumber(point && point.x, 0) + finiteNumber(translate.x, 0)) * scale, y: (finiteNumber(point && point.y, 0) + finiteNumber(translate.y, 0)) * scale }; // NEW
    } // NEW

    function feetToModelUnits(feet) { // NEW
        return finiteNumber(feet, 0) * CM_PER_FOOT * PX_PER_CM * DRAW_SCALE; // NEW
    } // NEW

    function renderIrrigationWarningBadges(session) {
        collectHudObjects(session.moduleCell).forEach(function (cell) {
            const warning = cellWarning(session.moduleCell, cell);
            if (!warning) return;
            const badge = document.createElement("div");
            badge.className = "trellis-irrigation-warning-badge";
            badge.title = warning;
            badge.textContent = "!";
            badge.style.cssText = "position:absolute;z-index:998;width:16px;height:16px;line-height:16px;text-align:center;border-radius:8px;background:#f6c343;color:#111;font:bold 11px Arial,sans-serif;";
            positionOverlayBox(badge, cell, -8);
            appendOverlayNode(badge);
            session.warningBadges.push(badge);
        });
    }

    function renderIrrigationNavigator(session, activeCell) {
        const targets = irrigationNavigationTargets(session.moduleCell, activeCell);
        const specs = [
            ["parent", targets.parent, -32, -24, "^"],
            ["child", targets.child, -32, 36, "v"],
            ["prev", targets.previousSibling, -60, 6, "<"],
            ["next", targets.nextSibling, -4, 6, ">"]
        ];
        specs.forEach(function (spec) {
            if (!spec[1]) return;
            const nav = document.createElement("button");
            nav.type = "button";
            nav.className = "trellis-irrigation-nav-" + spec[0];
            nav.textContent = spec[4];
            nav.title = spec[0];
            nav.style.cssText = "position:absolute;z-index:1004;width:22px;height:22px;padding:0;border:1px solid #777;border-radius:4px;background:#fff;cursor:pointer;font:12px Arial,sans-serif;";
            positionNavigatorButton(nav, activeCell, spec[2], spec[3]);
            nav.addEventListener("click", function () { selectCell(spec[1], true); renderIrrigationMode(session); });
            appendOverlayNode(nav);
            session.navigator.push(nav);
        });
    }

    function irrigationNavigationTargets(moduleCell, activeCell) {
        const incoming = incomingHudEdges(moduleCell, activeCell)[0];
        const parent = incoming && incoming.source;
        const children = outgoingHudEdges(moduleCell, activeCell).map(function (edge) { return edge.target; });
        const siblings = parent ? outgoingHudEdges(moduleCell, parent).map(function (edge) { return edge.target; }) : [];
        const index = siblings.indexOf(activeCell);
        return {
            parent: parent || null,
            child: children[0] || null,
            previousSibling: index > 0 ? siblings[index - 1] : null,
            nextSibling: index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null
        };
    }

    function selectCell(cell, center) {
        if (graph.setSelectionCell) graph.setSelectionCell(cell);
        else graph.selectionCell = cell;
        if (center && graph.scrollCellToVisible) graph.scrollCellToVisible(cell, true);
    }

    function deriveHudPaths(moduleCell) {
        const paths = [];
        collectHudEndpoints(moduleCell, "bed").forEach(function (bedEndpoint) {
            const route = routeToSource(moduleCell, bedEndpoint);
            if (!route || !route.source) return;
            const bedCell = findEndpointBed(bedEndpoint);
            const partCells = routeBomPartCells(route.cells);
            const partIds = partCells.map(function (cell) { return getCellAttr(cell, ATTRS.CATALOG_PART_ID, ""); }).filter(Boolean);
            const partStates = partCells.map(partStateForCell);
            const branchIds = route.cells.filter(function (cell) { return BRANCH_CATEGORIES.has(getCellAttr(cell, ATTRS.COMPONENT_TYPE, "")); }).map(getCellId).filter(Boolean);
            const pipeIds = route.edges.map(getCellId).filter(Boolean);
            const pipePartStates = route.edges.map(partStateForCell);
            const path = stagePath({
                id: "hud_" + sanitizeId(getCellId(route.source) + "_" + getCellId(bedEndpoint)),
                sourceEndpoint: route.source,
                targetEndpoint: bedEndpoint,
                targetBedId: getCellId(bedCell) || "",
                branchpointIds: branchIds,
                partIds,
                partStates,
                pipePartId: getCellAttr(route.edges[0], ATTRS.PIPE_PART_ID, "")
            });
            path.componentCellIds = partCells.map(getCellId).filter(Boolean);
            path.pipeEdgeIds = pipeIds;
            path.pipePartStates = pipePartStates;
            path.hydraulic = Hydraulics.calculatePath(moduleCell, path);
            paths.push(path);
        });
        return paths;
    }

    function routeToSource(moduleCell, bedEndpoint) {
        const cells = [];
        const edges = [];
        const seen = new Set();
        let cur = bedEndpoint;
        while (cur) {
            const id = getCellId(cur);
            if (!id || seen.has(id)) return null;
            seen.add(id);
            if (endpointType(cur) === "source") return { source: cur, cells: cells.reverse(), edges: edges.reverse() };
            const incoming = incomingHudEdges(moduleCell, cur)[0];
            if (!incoming) return null;
            cells.push(cur);
            edges.push(incoming);
            cur = incoming.source;
        }
        return null;
    }

    function routeBomPartCells(cells) {
        return (cells || []).filter(function (cell) {
            return !!getCellAttr(cell, ATTRS.CATALOG_PART_ID, "") && (getCellAttr(cell, ATTRS.COMPONENT, "") === "1" || endpointType(cell) === "branchpoint");
        });
    }

    function deriveAssemblyPaths(moduleCell) {
        const paths = [];
        collectDescendants(moduleCell, function (cell) { return isAssembly(cell) && assemblyType(cell) === "bed"; }).forEach(function (bedEndpoint) {
            const route = routeAssemblyToSource(moduleCell, bedEndpoint);
            if (!route) return;
            const bedAssembly = bedEndpoint;
            const bedCell = bedCellForAssembly(moduleCell, bedAssembly);
            const linkedBedId = getCellId(bedCell) || getCellAttr(bedAssembly, ATTRS.LINKED_BED_ID, getCellId(bedAssembly) || "");
            const partCells = routeBomPartCells(route.cells);
            const partIds = partCells.map(function (cell) { return getCellAttr(cell, ATTRS.CATALOG_PART_ID, ""); }).filter(Boolean);
            const partStates = partCells.map(partStateForCell);
            const pipeEdges = route.edges.filter(function (edge) { return getCellAttr(edge, ATTRS.PIPE_EDGE, "") === "1"; });
            const pipeIds = pipeEdges.map(getCellId).filter(Boolean);
            const pipePartIds = pipeEdges.map(function (edge) { return getCellAttr(edge, ATTRS.PIPE_PART_ID, ""); }).filter(Boolean);
            const pipePartStates = pipeEdges.map(partStateForCell);
            const pipeSegments = pipeEdges.map(function (edge) { return { edgeId: getCellId(edge) || "", pipePartId: getCellAttr(edge, ATTRS.PIPE_PART_ID, ""), partState: partStateForCell(edge), lengthFt: measuredEdgeLengthFeet(edge), hydraulicLengthFt: measuredPipeRouteLengthFeet(edge) }; }).filter(function (segment) { return !!segment.pipePartId; }); // CHANGE
            const path = makeDerivedAssemblyPath({
                id: "assembly_" + sanitizeId((getCellId(route.source) || "disconnected") + "_" + getCellId(bedEndpoint)),
                sourceEndpoint: route.source,
                targetEndpoint: bedEndpoint,
                targetBedId: linkedBedId,
                branchpointIds: route.cells.filter(function (cell) { return BRANCH_CATEGORIES.has(getCellAttr(cell, ATTRS.COMPONENT_TYPE, "")); }).map(getCellId).filter(Boolean),
                partIds,
                partStates,
                pipePartId: pipePartIds[0] || "",
                pipeSegments
            });
            path.componentCellIds = partCells.map(getCellId).filter(Boolean);
            path.pipeEdgeIds = pipeIds;
            path.pipePartIds = pipePartIds;
            path.pipePartStates = pipePartStates;
            path.disconnectedFromSource = !!route.disconnectedFromSource;
            path.routeWarnings = route.disconnectedFromSource ? [DISCONNECTED_SOURCE_WARNING] : [];
            const template = readBedAssemblyTemplateRecord(moduleCell, bedAssembly);
            if (template) {
                path.bedTemplateCommitted = true;
                path.bedTemplate = template;
                path.bedDemand = Hydraulics.cumulativeBedDemand(moduleCell, bedAssembly);
            }
            path.hydraulic = Hydraulics.calculatePath(moduleCell, path);
            paths.push(path);
        });
        return paths;
    }

    function routeAssemblyToSource(moduleCell, bedEndpoint) {
        const cells = [];
        const edges = [];
        const seen = new Set();
        let cur = bedEndpoint;
        while (cur) {
            const id = getCellId(cur);
            if (!id || seen.has(id)) return null;
            seen.add(id);
            if (endpointType(cur) === "source") return { source: cur, cells: cells.reverse(), edges: edges.reverse() };
            cells.push(cur);
            const incoming = incomingAssemblyEdges(moduleCell, cur)[0];
            if (incoming) { edges.push(incoming); cur = incoming.source; continue; }
            const internal = internalNeighborForPort(cur, "input");
            if (internal) { cur = internal; continue; }
            return { source: null, cells: cells.reverse(), edges: edges.reverse(), disconnectedFromSource: true };
        }
        return null;
    }

    function analysisIssue(severity, message, cell, code) { // NEW
        return { severity, message, cellId: getCellId(cell) || "", code: code || "" }; // NEW
    } // NEW

    function analysisIssueRank(issue) { // NEW
        return issue && issue.severity === "error" ? 0 : (issue && issue.severity === "warning" ? 1 : 2); // NEW
    } // NEW

    function analysisDemandForCell(moduleCell, catalog, cell) { // NEW
        if (!cell) return null; // NEW
        if (isBedAssembly(cell)) { // NEW
            const demand = demandFromBedAssembly(moduleCell, cell); // NEW
            if (!(demand.flowGpm > 0) && !(demand.operatingPressurePsi > 0)) return null; // NEW
            return { cell, kind: "bed", flowGpm: finiteNumber(demand.flowGpm, 0), operatingPressurePsi: finiteNumber(demand.operatingPressurePsi, 0) }; // NEW
        } // NEW
        const part = partForCell(moduleCell, cell); // NEW
        if (!part || !ANALYSIS_DEMAND_CATEGORIES.has(part.category)) return null; // NEW
        const flowGpm = finiteNumber(part.specs && part.specs.flowGpm, 0); // NEW
        const pressurePsi = finiteNumber(part.specs && part.specs.minOperatingPressurePsi, 0); // NEW
        if (!(flowGpm > 0) && !(pressurePsi > 0)) return null; // NEW
        return { cell, kind: part.category, flowGpm, operatingPressurePsi: pressurePsi, partId: part.id }; // NEW
    } // NEW

    function analysisPipeEdgeRecord(moduleCell, catalog, edge, demandFlowGpm) { // NEW
        const pipePartId = getCellAttr(edge, ATTRS.PIPE_PART_ID, ""); // NEW
        const part = partById(catalog, pipePartId); // NEW
        const lengthFt = measuredEdgeLengthFeet(edge); // NEW
        const hydraulicLengthFt = measuredPipeRouteLengthFeet(edge); // NEW
        const lossLengthFt = hydraulicLengthFt == null ? lengthFt : hydraulicLengthFt; // NEW
        const issues = []; // NEW
        let pressureLossPsi = null; // NEW
        if (!pipePartId) issues.push(analysisIssue("warning", "Pipe part is missing; pressure loss is unknown.", edge, "missing_pipe_part")); // NEW
        else if (!part || part.category !== "pipe_tubing") issues.push(analysisIssue("warning", "Pipe part specs missing; pressure loss is unknown.", edge, "missing_pipe_specs")); // NEW
        else if (!(finiteNumber(part.specs && part.specs.innerDiameterIn, 0) > 0)) issues.push(analysisIssue("warning", "Pipe inner diameter is missing; pressure loss is unknown.", edge, "missing_pipe_diameter")); // NEW
        else if (!(lossLengthFt > 0)) issues.push(analysisIssue("warning", "Pipe length is missing; pressure loss is unknown.", edge, "missing_pipe_length")); // NEW
        else pressureLossPsi = Hydraulics.hazenWilliamsPsiLoss({ lengthFt: lossLengthFt, flowGpm: demandFlowGpm, diameterIn: part.specs.innerDiameterIn, c: finiteNumber(part.specs.hazenWilliamsC, ANALYSIS_DEFAULT_HW_C) }); // NEW
        return { // NEW
            edge, // NEW
            edgeId: getCellId(edge) || "", // NEW
            sourceId: getCellId(edge && edge.source) || "", // NEW
            targetId: getCellId(edge && edge.target) || "", // NEW
            pipePartId, // NEW
            lengthFt: finiteNumber(lengthFt, null), // NEW
            hydraulicLengthFt: finiteNumber(hydraulicLengthFt, null), // NEW
            flowGpm: finiteNumber(demandFlowGpm, 0), // NEW
            pressureLossPsi, // NEW
            issues // NEW
        }; // NEW
    } // NEW

    function analysisCellPressureEffect(moduleCell, cell, pressurePsi) { // NEW
        const part = partForCell(moduleCell, cell); // NEW
        if (!part) return { pressurePsi, lossPsi: 0, regulated: false }; // NEW
        const lossPsi = finiteNumber(part.specs && part.specs.pressureLossPsi, 0); // NEW
        let nextPressure = finiteNumber(pressurePsi, null); // NEW
        if (nextPressure != null) nextPressure -= lossPsi; // NEW
        const regulatorPsi = part.category === "regulator" ? finiteNumber(part.specs && part.specs.minOperatingPressurePsi, null) : null; // NEW
        if (nextPressure != null && regulatorPsi != null && nextPressure >= regulatorPsi) nextPressure = Math.min(nextPressure, regulatorPsi); // NEW
        return { pressurePsi: nextPressure, lossPsi, regulated: regulatorPsi != null }; // NEW
    } // NEW

    function analysisRouteToSource(moduleCell, targetCell) { // NEW
        const cells = []; // NEW
        const edges = []; // NEW
        const seen = new Set(); // NEW
        let cur = targetCell; // NEW
        while (cur) { // NEW
            const id = getCellId(cur); // NEW
            if (!id || seen.has(id)) return { source: null, cells: cells.reverse(), edges: edges.reverse(), issue: analysisIssue("error", "Irrigation graph contains a loop; Analysis supports directed trees only.", cur, "loop") }; // NEW
            seen.add(id); // NEW
            if (endpointType(cur) === "source") return { source: cur, cells: cells.reverse(), edges: edges.reverse(), issue: null }; // NEW
            cells.push(cur); // NEW
            const incoming = incomingAssemblyEdges(moduleCell, cur); // NEW
            if (incoming.length > 1) return { source: null, cells: cells.reverse(), edges: edges.reverse(), issue: analysisIssue("error", "Multiple upstream feeds are unsupported in Analysis mode.", cur, "multiple_upstream") }; // NEW
            if (incoming.length === 1) { edges.push(incoming[0]); cur = incoming[0].source; continue; } // NEW
            const internal = internalNeighborForPort(cur, "input"); // NEW
            if (internal) { cur = internal; continue; } // NEW
            return { source: null, cells: cells.reverse(), edges: edges.reverse(), issue: analysisIssue("error", DISCONNECTED_SOURCE_WARNING, cur, "disconnected") }; // NEW
        } // NEW
        return { source: null, cells: cells.reverse(), edges: edges.reverse(), issue: analysisIssue("error", DISCONNECTED_SOURCE_WARNING, targetCell, "disconnected") }; // NEW
    } // NEW

    function analysisZoneSourceRoute(moduleCell, zone) { // NEW
        const z = ZoneModel.normalize(zone); // NEW
        if (z.originType !== ZONE_ORIGIN_TIMER_OUTLET) return { source: null, origin: null, route: null, issue: analysisIssue("unknown", "Manual zones are not tied to a timer outlet; assign beds to a timer outlet zone for hydraulic analysis.", null, "manual_zone") }; // NEW
        const origin = findCellById(moduleCell, z.originCellId); // NEW
        if (!origin) return { source: null, origin: null, route: null, issue: analysisIssue("error", "Zone timer outlet source part is missing.", null, "missing_zone_origin") }; // NEW
        const route = analysisRouteToSource(moduleCell, origin); // NEW
        return { source: route.source, origin, route, issue: route.issue }; // NEW
    } // NEW

    function analysisBuildActiveZone(moduleCell, zone) { // NEW
        const catalog = IrrigationCatalog.read(moduleCell); // NEW
        const z = ZoneModel.normalize(zone); // NEW
        const sourceRoute = analysisZoneSourceRoute(moduleCell, z); // NEW
        const issues = []; // NEW
        const edgeDemand = new Map(); // NEW
        const nodeIds = new Set(); // NEW
        const edgeIds = new Set(); // NEW
        const demands = []; // NEW
        const demandByCellId = new Map(); // NEW
        if (sourceRoute.issue) issues.push(sourceRoute.issue); // NEW
        const origin = sourceRoute.origin; // NEW
        const outletIndex = finiteNumber(z.outletIndex, 0); // NEW

        function addDemand(demand) { // NEW
            if (!demand || !demand.cell) return; // NEW
            const id = getCellId(demand.cell); // NEW
            if (!id || demandByCellId.has(id)) return; // NEW
            demandByCellId.set(id, demand); // NEW
            demands.push(demand); // NEW
        } // NEW

        function visit(cell, stack, constrainedOutletIndex) { // NEW
            const id = getCellId(cell); // NEW
            if (!id) return { flowGpm: 0, operatingPressurePsi: 0 }; // NEW
            if (stack.has(id)) { issues.push(analysisIssue("error", "Irrigation graph contains a loop; Analysis supports directed trees only.", cell, "loop")); return { flowGpm: 0, operatingPressurePsi: 0 }; } // NEW
            nodeIds.add(id); // NEW
            const incoming = incomingAssemblyEdges(moduleCell, cell); // NEW
            if (cell !== origin && incoming.length > 1) issues.push(analysisIssue("error", "Multiple upstream feeds are unsupported in Analysis mode.", cell, "multiple_upstream")); // NEW
            stack.add(id); // NEW
            const own = analysisDemandForCell(moduleCell, catalog, cell); // NEW
            let total = own ? { flowGpm: own.flowGpm, operatingPressurePsi: own.operatingPressurePsi } : { flowGpm: 0, operatingPressurePsi: 0 }; // NEW
            if (own) addDemand(own); // NEW
            const internal = internalNeighborForPort(cell, "output"); // NEW
            if (internal) { // NEW
                const downstream = visit(internal, stack, null); // NEW
                total.flowGpm += downstream.flowGpm; // NEW
                total.operatingPressurePsi = Math.max(total.operatingPressurePsi, downstream.operatingPressurePsi); // NEW
            } // NEW
            let edges = outgoingAssemblyEdges(moduleCell, cell); // NEW
            if (constrainedOutletIndex != null) edges = edges.filter(function (edge) { return String(getCellAttr(edge, ATTRS.EDGE_SOURCE_PORT, "0")) === String(constrainedOutletIndex); }); // NEW
            edges.forEach(function (edge) { // NEW
                edgeIds.add(getCellId(edge) || ""); // NEW
                const downstream = visit(edge.target, stack, null); // NEW
                edgeDemand.set(getCellId(edge) || "", downstream); // NEW
                total.flowGpm += downstream.flowGpm; // NEW
                total.operatingPressurePsi = Math.max(total.operatingPressurePsi, downstream.operatingPressurePsi); // NEW
            }); // NEW
            stack.delete(id); // NEW
            return total; // NEW
        } // NEW

        const zoneDemand = origin ? visit(origin, new Set(), outletIndex) : { flowGpm: 0, operatingPressurePsi: 0 }; // NEW
        const upstreamEdges = sourceRoute.route && sourceRoute.route.edges || []; // NEW
        upstreamEdges.forEach(function (edge) { // NEW
            edgeIds.add(getCellId(edge) || ""); // NEW
            edgeDemand.set(getCellId(edge) || "", zoneDemand); // NEW
            if (edge.source) nodeIds.add(getCellId(edge.source) || ""); // NEW
            if (edge.target) nodeIds.add(getCellId(edge.target) || ""); // NEW
        }); // NEW
        const pipeEdges = Array.from(edgeIds).map(function (edgeId) { return findCellById(moduleCell, edgeId); }).filter(Boolean); // NEW
        const pipeLabels = pipeEdges.map(function (edge) { // NEW
            const demand = edgeDemand.get(getCellId(edge) || "") || { flowGpm: 0 }; // NEW
            return analysisPipeEdgeRecord(moduleCell, catalog, edge, finiteNumber(demand.flowGpm, 0)); // NEW
        }); // NEW
        pipeLabels.forEach(function (record) { issues.push.apply(issues, record.issues); }); // NEW
        const pipeById = new Map(pipeLabels.map(function (record) { return [record.edgeId, record]; })); // NEW
        const sourceProfile = sourceRoute.source ? endpointProfile(sourceRoute.source) : null; // NEW
        if (sourceRoute.source && (!sourceProfile || sourceProfile.usableFlowGpm == null)) issues.push(analysisIssue("warning", "Source usable flow is missing; flow capacity is unknown.", sourceRoute.source, "missing_source_flow")); // NEW
        if (sourceRoute.source && (!sourceProfile || sourceProfile.staticPressurePsi == null)) issues.push(analysisIssue("warning", "Source static PSI is missing; pressure margin is unknown.", sourceRoute.source, "missing_source_pressure")); // NEW
        if (sourceProfile && sourceProfile.usableFlowGpm != null && zoneDemand.flowGpm > sourceProfile.usableFlowGpm) issues.push(analysisIssue("error", "Active zone demand exceeds source usable flow.", sourceRoute.source, "source_over_capacity")); // NEW
        const originPart = origin ? partForCell(moduleCell, origin) : null; // NEW
        const outletMaxFlow = originPart ? finiteNumber(originPart.connectors && originPart.connectors.output && originPart.connectors.output.maxFlowGpm, finiteNumber(originPart.specs && originPart.specs.maxFlowGpm, null)) : null; // NEW
        if (outletMaxFlow != null && zoneDemand.flowGpm > outletMaxFlow) issues.push(analysisIssue("error", "Active zone demand exceeds timer outlet max flow.", origin, "outlet_over_capacity")); // NEW

        const endpointLabels = demands.map(function (demand) { // NEW
            const route = analysisRouteToSource(moduleCell, demand.cell); // NEW
            if (route.issue) issues.push(route.issue); // NEW
            let delivered = sourceProfile && sourceProfile.staticPressurePsi != null ? finiteNumber(sourceProfile.staticPressurePsi, null) : null; // NEW
            (route.cells || []).forEach(function (cell, index) { // NEW
                const edge = (route.edges || [])[index]; // NEW
                const record = pipeById.get(getCellId(edge) || ""); // NEW
                if (delivered != null && record && record.pressureLossPsi != null) delivered -= record.pressureLossPsi; // NEW
                else if (delivered != null && record) delivered = null; // NEW
                const effect = analysisCellPressureEffect(moduleCell, cell, delivered); // NEW
                delivered = effect.pressurePsi; // NEW
            }); // NEW
            const required = finiteNumber(demand.operatingPressurePsi, 0); // NEW
            const margin = delivered == null ? null : delivered - required; // NEW
            if (margin != null && margin < 0) issues.push(analysisIssue("error", "Estimated delivered pressure is below endpoint requirement.", demand.cell, "negative_margin")); // NEW
            else if (margin != null && margin < ANALYSIS_LOW_MARGIN_PSI) issues.push(analysisIssue("warning", "Estimated pressure margin is low.", demand.cell, "low_margin")); // NEW
            if (!(required > 0)) issues.push(analysisIssue("unknown", "Endpoint operating pressure requirement is missing.", demand.cell, "missing_endpoint_pressure")); // NEW
            return { cell: demand.cell, cellId: getCellId(demand.cell) || "", kind: demand.kind, flowGpm: demand.flowGpm, requiredPressurePsi: required, deliveredPressurePsi: delivered, marginPsi: margin }; // NEW
        }); // NEW

        const coverageOverlays = endpointLabels.map(function (endpoint) { return analysisCoverageForEndpoint(moduleCell, catalog, endpoint.cell); }).filter(Boolean); // NEW
        coverageOverlays.forEach(function (coverage) { if (coverage.issue) issues.push(coverage.issue); }); // NEW
        const sortedIssues = uniqueAnalysisIssues(issues).sort(function (a, b) { return analysisIssueRank(a) - analysisIssueRank(b) || String(a.message).localeCompare(String(b.message)); }); // NEW
        return { zone: z, source: sourceRoute.source, origin, nodeIds: Array.from(nodeIds).filter(Boolean), edgeIds: Array.from(edgeIds).filter(Boolean), demandGpm: zoneDemand.flowGpm, requiredPressurePsi: zoneDemand.operatingPressurePsi, pipeLabels, endpointLabels, coverageOverlays, issues: sortedIssues }; // NEW
    } // NEW

    function uniqueAnalysisIssues(issues) { // NEW
        const seen = new Set(); // NEW
        return (issues || []).filter(function (issue) { // NEW
            if (!issue || !issue.message) return false; // NEW
            const key = [issue.severity, issue.code, issue.cellId, issue.message].join("|"); // NEW
            if (seen.has(key)) return false; // NEW
            seen.add(key); // NEW
            return true; // NEW
        }); // NEW
    } // NEW

    function analysisCoverageForEndpoint(moduleCell, catalog, cell) { // NEW
        const part = partForCell(moduleCell, cell); // NEW
        const record = isBedAssembly(cell) ? readBedAssemblyTemplateRecord(moduleCell, cell) : null; // NEW
        if (record) return analysisCoverageForBedAssembly(moduleCell, catalog, cell, record); // NEW
        const specs = part && part.specs || record && record.coverage || {}; // NEW
        const radiusFt = finiteNumber(specs.throwRadiusFt, finiteNumber(specs.throwDiameterFt, 0) / 2); // NEW
        const pattern = String(specs.coveragePattern || (isBedAssembly(cell) ? "rectangle" : "circle")).trim() || "circle"; // NEW
        if (!(radiusFt > 0) && !isBedAssembly(cell)) return { cell, cellId: getCellId(cell) || "", pattern, radiusFt: null, issue: analysisIssue("unknown", "Coverage footprint specs are missing.", cell, "missing_coverage") }; // NEW
        return { cell, cellId: getCellId(cell) || "", pattern, radiusFt: radiusFt > 0 ? radiusFt : null, arcDegrees: finiteNumber(specs.arcDegrees, null), directionDeg: finiteNumber(specs.coverageDirectionDeg, cellRotationDeg(cell)), issue: null }; // NEW
    } // NEW

    function analysisCoverageForBedAssembly(moduleCell, catalog, cell, record) { // NEW
        const rowPart = partById(catalog, record && (record.rowPartId || record.anchorPartId)); // NEW
        const widthIn = finiteNumber(rowPart && rowPart.specs && rowPart.specs.wettedWidthIn, null); // NEW
        const bands = widthIn > 0 && rowPart && BED_SELF_EMITTING_ROW_CATEGORIES.has(rowPart.category) ? analysisWettedBandsForBed(cell, record, widthIn) : []; // NEW
        return { cell, cellId: getCellId(cell) || "", pattern: "rectangle", radiusFt: null, wettedWidthIn: widthIn, bands, issue: null }; // NEW
    } // NEW

    function analysisWettedBandsForBed(cell, record, wettedWidthIn) { // NEW
        const bounds = cellBoundsInModel(cell); // NEW
        const rows = Math.max(0, Math.floor(finiteNumber(record && record.spacing && record.spacing.rows, 0))); // NEW
        const bandWidthUnits = feetToModelUnits(finiteNumber(wettedWidthIn, 0) / 12); // NEW
        if (!bounds || !(rows > 0) || !(bandWidthUnits > 0)) return []; // NEW
        const rowOrientation = normalizeBedRowOrientation(record && record.rowOrientation, bedTemplateById(record && record.templateId)); // NEW
        const span = rowOrientation === "height" ? bounds.width : bounds.height; // NEW
        const gap = span / rows; // NEW
        const thickness = Math.min(span, bandWidthUnits); // NEW
        const bands = []; // NEW
        for (let i = 0; i < rows; i++) { // NEW
            const center = gap * (i + 0.5); // NEW
            if (rowOrientation === "height") bands.push({ x: bounds.x + center - thickness / 2, y: bounds.y, width: thickness, height: bounds.height }); // NEW
            else bands.push({ x: bounds.x, y: bounds.y + center - thickness / 2, width: bounds.width, height: thickness }); // NEW
        } // NEW
        return bands; // NEW
    } // NEW

    function analysisZoneOptions(moduleCell) { // NEW
        return ZoneModel.sync(moduleCell).map(function (zone) { return { id: zone.id, name: ZoneModel.displayName(moduleCell, zone), zone }; }); // NEW
    } // NEW

    function inferAnalysisZoneId(moduleCell, selectedCells, preferredZoneId) { // NEW
        const options = analysisZoneOptions(moduleCell); // NEW
        if (preferredZoneId && options.some(function (option) { return option.id === preferredZoneId; })) return preferredZoneId; // NEW
        const selected = selectedCells && selectedCells.length ? selectedCells : []; // NEW
        const selectedIds = new Set(selected.map(getCellId).filter(Boolean)); // NEW
        const membership = ZoneModel.resolveMembership(moduleCell, options.map(function (option) { return option.zone; })); // NEW
        for (const cell of selected) { // NEW
            const assembly = isBedAssembly(cell) ? cell : findAssemblyAncestor(cell); // NEW
            const bedId = getCellId(assembly); // NEW
            const assigned = bedId && membership.assignment.get(bedId); // NEW
            if (assigned && assigned.zoneId) return assigned.zoneId; // NEW
        } // NEW
        for (const option of options) { // NEW
            const z = ZoneModel.normalize(option.zone); // NEW
            if (z.originCellId && selectedIds.has(z.originCellId)) return z.id; // NEW
        } // NEW
        for (const option of options) { // NEW
            const analysis = analysisBuildActiveZone(moduleCell, option.zone); // NEW
            if (analysis.nodeIds.some(function (id) { return selectedIds.has(id); }) || analysis.edgeIds.some(function (id) { return selectedIds.has(id); })) return option.id; // NEW
        } // NEW
        return options.length ? options[0].id : ""; // NEW
    } // NEW

    function buildAnalysisView(moduleCell, options) { // NEW
        const zoneOptions = analysisZoneOptions(moduleCell); // NEW
        const selectedCells = options && options.selectedCells || []; // NEW
        const activeZoneId = inferAnalysisZoneId(moduleCell, selectedCells, options && options.zoneId); // NEW
        const activeOption = zoneOptions.find(function (option) { return option.id === activeZoneId; }) || zoneOptions[0] || null; // NEW
        const analysis = activeOption ? analysisBuildActiveZone(moduleCell, activeOption.zone) : null; // NEW
        return { mode: ANALYSIS_MODE_ANALYSIS, zoneOptions, activeZoneId: activeOption && activeOption.id || "", activeZoneName: activeOption && activeOption.name || "No zone", analysis: analysis || { demandGpm: 0, requiredPressurePsi: 0, pipeLabels: [], endpointLabels: [], coverageOverlays: [], issues: [analysisIssue("unknown", "No timer outlet zones found.", moduleCell, "no_zones")], nodeIds: [], edgeIds: [] } }; // NEW
    } // NEW

    function syncHudGraphState(moduleCell) {
        if (isTrellisHistoryRestoring()) return [];
        if (activeIrrigationEditDepth === 0) return runIrrigationEdit("syncHudGraphState", function () { return syncHudGraphState(moduleCell); });
        const paths = ReportModel.deriveAssemblyPaths(moduleCell);
        ReportModel.syncDashboardState(moduleCell, paths);
        return paths;
    }

    function scheduleHudGraphStateSync(moduleCell) {
        if (!moduleCell) return null;
        if (isTrellisHistoryRestoring()) return null;
        if (activeIrrigationEditDepth > 0) { queueHudGraphStateSync(moduleCell); return null; }
        hudSyncModuleCell = moduleCell;
        if (hudSyncTimer && typeof clearTimeout === "function") clearTimeout(hudSyncTimer);
        if (typeof setTimeout !== "function") { if (activeIrrigationMode && activeIrrigationMode.moduleCell === moduleCell) renderIrrigationMode(activeIrrigationMode); return null; }
        hudSyncTimer = setTimeout(function () {
            const target = hudSyncModuleCell;
            hudSyncTimer = null;
            hudSyncModuleCell = null;
            if (isTrellisHistoryRestoring()) return;
            if (target && activeIrrigationMode && activeIrrigationMode.moduleCell === target) renderIrrigationMode(activeIrrigationMode);
        }, HUD_SYNC_DEBOUNCE_MS);
        return null;
    }

    function flushHudGraphStateSync() {
        const target = hudSyncModuleCell;
        if (hudSyncTimer && typeof clearTimeout === "function") clearTimeout(hudSyncTimer);
        hudSyncTimer = null;
        hudSyncModuleCell = null;
        if (isTrellisHistoryRestoring()) { pendingHudGraphSyncModuleCells = []; return []; }
        if (activeIrrigationEditDepth > 0) flushQueuedHudGraphStateSync();
        if (target && activeIrrigationMode && activeIrrigationMode.moduleCell === target) renderIrrigationMode(activeIrrigationMode);
        return [];
    }

    function cancelPendingHudGraphStateSync() {
        if (hudSyncTimer && typeof clearTimeout === "function") clearTimeout(hudSyncTimer);
        hudSyncTimer = null;
        hudSyncModuleCell = null;
        pendingHudGraphSyncModuleCells = [];
    }

    function firstPathForBedEndpoint(moduleCell, inletCell) {
        return deriveHudPaths(moduleCell).find(function (path) { return path.targetEndpointId === getCellId(inletCell); }) || null;
    }

    function firstAssemblyPathForBedAssembly(moduleCell, bedAssembly) {
        return deriveAssemblyPaths(moduleCell).find(function (path) { return path.targetEndpointId === getCellId(bedAssembly); }) || null;
    }

    function deleteHudIrrigationCell(session, cell) {
        if (activeIrrigationEditDepth === 0) return runIrrigationEdit("deleteHudIrrigationCell", function () { return deleteHudIrrigationCell(session, cell); });
        model.beginUpdate && model.beginUpdate();
        try {
            incomingHudEdges(session.moduleCell, cell).concat(outgoingHudEdges(session.moduleCell, cell)).forEach(removeCellFromParent);
            removeCellFromParent(cell);
            selectCell(session.moduleCell, false);
            scheduleHudGraphStateSync(session.moduleCell);
        } finally {
            model.endUpdate && model.endUpdate();
        }
        renderIrrigationMode(session);
    }

    function removeCellFromParent(cell) {
        if (!cell) return;
        if (model.remove) { model.remove(cell); return; }
        const parent = model.getParent ? model.getParent(cell) : cell && cell.parent;
        if (!parent || !parent.children) return;
        const index = parent.children.indexOf(cell);
        if (index >= 0) parent.children.splice(index, 1);
    }

    function appendOverlayNode(node) {
        const host = overlayHost();
        if (host) host.appendChild(node);
        else irrigationDebug("appendOverlayNode:no-host", { nodeClass: node && node.className });
    }

    function appendIrrigationControlNode(node) {
        const host = ensureIrrigationControlLayer();
        if (host) { host.appendChild(node); return host; }
        else irrigationDebug("appendIrrigationControlNode:no-host", { nodeClass: node && node.className });
        return null;
    }

    function overlayHost() {
        const pane = graph.view && graph.view.overlayPane ? graph.view.overlayPane : null;
        if (pane && pane.namespaceURI !== "http://www.w3.org/2000/svg") return pane;
        return graph.container || pane;
    }

    function ensureIrrigationControlLayer() {
        const pane = graph.view && graph.view.overlayPane ? graph.view.overlayPane : null;
        const paneIsSvg = !!(pane && pane.namespaceURI === "http://www.w3.org/2000/svg");
        const baseHost = graph.container || (pane && !paneIsSvg ? pane : null);
        if (!baseHost || baseHost.namespaceURI === "http://www.w3.org/2000/svg") return null;
        const style = typeof window !== "undefined" && window.getComputedStyle ? window.getComputedStyle(baseHost) : null;
        if (style && style.position === "static") baseHost.style.position = "relative";
        let layer = graph.__trellisIrrigationControlLayer && graph.__trellisIrrigationControlLayer.parentNode === baseHost ? graph.__trellisIrrigationControlLayer : null;
        if (!layer && typeof document !== "undefined" && document.createElement) {
            layer = document.createElement("div");
            layer.className = "trellis-irrigation-control-layer";
            layer.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:" + GRAPH_OVERLAY_Z.CONTROL + ";";
            baseHost.appendChild(layer);
            graph.__trellisIrrigationControlLayer = layer;
        }
        return layer;
    }

    function removeHudNode(node) {
        if (node && node.parentNode) node.parentNode.removeChild(node);
    }

    function removeNodeList(nodes) {
        (nodes || []).forEach(removeHudNode);
        if (nodes) nodes.length = 0;
    }

    function removeIrrigationControlLayerChildren() {
        const layer = graph.__trellisIrrigationControlLayer;
        if (!layer || !layer.children) return;
        Array.from(layer.children).forEach(removeHudNode);
    }

    function installInactiveIrrigationEntryOverlay() {
        const selectionModel = graph.getSelectionModel && graph.getSelectionModel();
        if (selectionModel && selectionModel.addListener && typeof mxEvent !== "undefined") selectionModel.addListener(mxEvent.CHANGE, scheduleInactiveEntryOverlayRefresh);
        if (model.addListener && typeof mxEvent !== "undefined") model.addListener(mxEvent.CHANGE, scheduleInactiveEntryOverlayRefresh);
        if (graph.view && graph.view.addListener && typeof mxEvent !== "undefined") {
            [mxEvent.SCALE, mxEvent.TRANSLATE, mxEvent.SCALE_AND_TRANSLATE, mxEvent.REPAINT].forEach(function (eventName) {
                if (eventName) graph.view.addListener(eventName, scheduleInactiveEntryOverlayRefresh);
            });
        }
        if (graph.container && graph.container.addEventListener) graph.container.addEventListener("scroll", scheduleInactiveEntryOverlayRefresh, { passive: true });
        scheduleInactiveEntryOverlayRefresh();
    }

    function scheduleInactiveEntryOverlayRefresh() {
        if (inactiveEntryRefreshTimer != null && typeof clearTimeout === "function") clearTimeout(inactiveEntryRefreshTimer);
        inactiveEntryRefreshTimer = typeof setTimeout === "function" ? setTimeout(function () { inactiveEntryRefreshTimer = null; refreshInactiveEntryOverlay(); }, 0) : null;
        if (inactiveEntryRefreshTimer == null) refreshInactiveEntryOverlay();
    }

    function refreshInactiveEntryOverlay() {
        removeHudNode(inactiveEntryOverlay);
        inactiveEntryOverlay = null;
        if (activeIrrigationMode) return;
        const selected = graph.getSelectionCell && graph.getSelectionCell();
        if (!isInactiveIrrigationEntryTarget(selected)) return;
        const moduleCell = findGardenModuleAncestor(selected);
        if (!moduleCell) return;
        const btn = button("Enter Irrigation Design Mode", function (evt) {
            if (evt && evt.stopPropagation) evt.stopPropagation();
            openIrrigationMode(moduleCell, { selectCell: selected, preserveViewport: true });
        });
        btn.className = "trellis-irrigation-enter-mode";
        btn.style.cssText = "position:absolute;z-index:1005;padding:5px 8px;border:1px solid #2563eb;border-radius:4px;background:#eff6ff;color:#1e3a8a;box-shadow:0 2px 8px rgba(0,0,0,.18);font:bold 12px Arial,sans-serif;cursor:pointer;white-space:nowrap;";
        if (typeof mxEvent !== "undefined" && mxEvent.addListener) mxEvent.addListener(btn, "mousedown", function (evt) { mxEvent.consume(evt); });
        appendOverlayNode(btn);
        positionInactiveEntryOverlay(btn, selected);
        inactiveEntryOverlay = btn;
    }

    function isInactiveIrrigationEntryTarget(cell) {
        return !!cell && (isAssemblyModeObject(cell) || isHudIrrigationObject(cell) || isHudPipeEdge(cell));
    }

    function positionInactiveEntryOverlay(node, cell) {
        const state = cellState(cell);
        const width = node.offsetWidth || node.clientWidth || 170;
        node.style.left = Math.round(Math.max(0, state.x + state.width + 8)) + "px";
        node.style.top = Math.round(Math.max(0, state.y - 2)) + "px";
        node.style.maxWidth = Math.max(120, width) + "px";
    }

    function positionHudForSelection(hud, selected, session) {
        if (isAssemblyModeObject(selected) || isHudIrrigationObject(selected) || isGardenBed(selected)) {
            const state = cellState(selected);
            const width = hud.offsetWidth || hud.clientWidth || 260;
            hud.style.left = Math.round(Math.max(0, state.x - width - 12)) + "px";
            hud.style.top = Math.round(Math.max(0, state.y)) + "px";
            return;
        }
        if (session && session.lastModelPoint) {
            positionHudLeftOfModulePoint(hud, session.moduleCell, session.lastModelPoint);
            return;
        }
        positionModuleHudAtViewportCenter(hud);
    }

    function positionHudLeftOfModulePoint(hud, moduleCell, point) {
        const moduleBounds = cellBoundsInModel(moduleCell) || { x: 0, y: 0 };
        const scale = finiteNumber(graph.view && graph.view.scale, 1) || 1;
        const translate = graph.view && graph.view.translate ? graph.view.translate : { x: 0, y: 0 };
        const modelX = finiteNumber(moduleBounds.x, 0) + finiteNumber(point && point.x, 0);
        const modelY = finiteNumber(moduleBounds.y, 0) + finiteNumber(point && point.y, 0);
        const width = hud.offsetWidth || hud.clientWidth || 260;
        hud.style.left = Math.round(Math.max(0, (modelX + finiteNumber(translate.x, 0)) * scale - width - 12)) + "px";
        hud.style.top = Math.round(Math.max(0, (modelY + finiteNumber(translate.y, 0)) * scale)) + "px";
    }

    function collectIrrigationWorkspaceCells(moduleCell) {
        const cells = collectGardenBeds(moduleCell).slice();
        collectDescendants(moduleCell, isAssembly).forEach(function (cell) { cells.push(cell); });
        collectHudEndpoints(moduleCell, "source").forEach(function (cell) { cells.push(cell); });
        collectHudEndpoints(moduleCell, "bed").forEach(function (cell) { cells.push(cell); });
        return cells.filter(function (cell, index) { return cell && cells.indexOf(cell) === index; });
    }

    function boundsForCells(cells) {
        let bounds = null;
        (cells || []).forEach(function (cell) {
            const geo = cellBoundsInModel(cell);
            if (!geo) return;
            const x = finiteNumber(geo.x, 0);
            const y = finiteNumber(geo.y, 0);
            const width = Math.max(0, finiteNumber(geo.width, 0));
            const height = Math.max(0, finiteNumber(geo.height, 0));
            if (!bounds) bounds = { x, y, width, height };
            else {
                const right = Math.max(bounds.x + bounds.width, x + width);
                const bottom = Math.max(bounds.y + bounds.height, y + height);
                bounds.x = Math.min(bounds.x, x);
                bounds.y = Math.min(bounds.y, y);
                bounds.width = right - bounds.x;
                bounds.height = bottom - bounds.y;
            }
        });
        return bounds;
    }

    function cellBoundsInModel(cell) {
        const state = graph.view && graph.view.getState ? graph.view.getState(cell) : null;
        if (state && Number.isFinite(Number(state.x)) && Number.isFinite(Number(state.y))) {
            const scale = finiteNumber(graph.view && graph.view.scale, 1) || 1;
            const translate = graph.view && graph.view.translate ? graph.view.translate : { x: 0, y: 0 };
            return {
                x: finiteNumber(state.x, 0) / scale - finiteNumber(translate.x, 0),
                y: finiteNumber(state.y, 0) / scale - finiteNumber(translate.y, 0),
                width: finiteNumber(state.width, 0) / scale,
                height: finiteNumber(state.height, 0) / scale
            };
        }
        const geo = getGeometry(cell);
        if (!geo) return null;
        let x = finiteNumber(geo.x, 0);
        let y = finiteNumber(geo.y, 0);
        let parent = model.getParent ? model.getParent(cell) : cell && cell.parent;
        while (parent) {
            const parentGeo = getGeometry(parent);
            if (parentGeo) {
                x += finiteNumber(parentGeo.x, 0);
                y += finiteNumber(parentGeo.y, 0);
            }
            parent = model.getParent ? model.getParent(parent) : parent.parent;
        }
        return { x, y, width: finiteNumber(geo.width, 0), height: finiteNumber(geo.height, 0) };
    }

    function frameIrrigationWorkspace(moduleCell) {
        const workspaceCells = collectIrrigationWorkspaceCells(moduleCell);
        const targetCells = workspaceCells.length ? workspaceCells : [moduleCell];
        const rawBounds = boundsForCells(targetCells);
        const bounds = padBounds(rawBounds, 48);
        irrigationDebug("frameIrrigationWorkspace:bounds", {
            module: debugCellSummary(moduleCell),
            workspaceCells: workspaceCells.map(debugCellSummary),
            targetCells: targetCells.map(debugCellSummary),
            rawBounds,
            paddedBounds: bounds,
            overlayHost: debugOverlayHostSummary()
        });
        if (!bounds) {
            irrigationDebug("frameIrrigationWorkspace:fallback-no-bounds", { method: graph.scrollCellToVisible ? "scrollCellToVisible" : "none" });
            if (graph.scrollCellToVisible) graph.scrollCellToVisible(moduleCell, true);
            return null;
        }
        if (typeof graph.fitWindow === "function") {
            irrigationDebug("frameIrrigationWorkspace:apply", { method: "fitWindow", bounds, border: 16 });
            graph.fitWindow(bounds, 16);
            return bounds;
        }
        if (typeof graph.scrollRectToVisible === "function") {
            irrigationDebug("frameIrrigationWorkspace:apply", { method: "scrollRectToVisible", bounds });
            graph.scrollRectToVisible(bounds);
            return bounds;
        }
        irrigationDebug("frameIrrigationWorkspace:apply", { method: graph.fit ? "fit+scrollCellToVisible" : "scrollCellToVisible", bounds });
        if (typeof graph.fit === "function") graph.fit(48);
        if (graph.scrollCellToVisible) graph.scrollCellToVisible(targetCells[0] || moduleCell, true);
        return bounds;
    }

    function padBounds(bounds, padding) {
        if (!bounds) return null;
        const pad = Math.max(0, finiteNumber(padding, 0));
        return { x: bounds.x - pad, y: bounds.y - pad, width: bounds.width + pad * 2, height: bounds.height + pad * 2 };
    }

    function positionModuleHudAtViewportCenter(hud) {
        const host = overlayHost() || graph.container;
        const width = hud.offsetWidth || hud.clientWidth || 260;
        const height = hud.offsetHeight || hud.clientHeight || 160;
        const left = (host && Number.isFinite(Number(host.scrollLeft)) ? Number(host.scrollLeft) : 0) + (host && host.clientWidth ? host.clientWidth : 800) / 2 - width / 2;
        const top = (host && Number.isFinite(Number(host.scrollTop)) ? Number(host.scrollTop) : 0) + (host && host.clientHeight ? host.clientHeight : 600) / 2 - height / 2;
        hud.style.left = Math.round(Math.max(0, left)) + "px";
        hud.style.top = Math.round(Math.max(0, top)) + "px";
    }

    function irrigationDebug(label, data) {
        if (irrigationDebugQuietDepth > 0) return;
        if (typeof console === "undefined" || !console || !console.log) return;
        try { console.log("[Trellis Irrigation] " + label, data || {}); } catch (_) {}
    }

    function debugCellSummary(cell) {
        if (!cell) return null;
        const geo = getGeometry(cell);
        const moduleCell = isGardenModule(cell) ? cell : findGardenModuleAncestor(cell);
        const assembly = isAssembly(cell) ? cell : findAssemblyAncestor(cell);
        const partId = getCellAttr(cell, ATTRS.CATALOG_PART_ID, "");
        const part = moduleCell && partId ? partForCell(moduleCell, cell) : null;
        return {
            id: getCellId(cell),
            label: getCellAttr(cell, "label", ""),
            gardenModule: isGardenModule(cell),
            gardenBed: isGardenBed(cell),
            endpointType: endpointType(cell),
            assembly: isAssembly(cell),
            assemblyType: isAssembly(cell) ? assemblyType(cell) : "",
            parentAssembly: assembly && assembly !== cell ? { id: getCellId(assembly), type: assemblyType(assembly), label: getCellAttr(assembly, "label", "") } : null,
            catalogPartId: partId,
            part: debugCatalogPartSummary(part),
            flippedAttr: getCellAttr(cell, ATTRS.PART_FLIPPED, ""),
            flipped: isPartCellFlipped(cell),
            generated: isLegacyGenerated(cell),
            geometry: geo ? { x: geo.x, y: geo.y, width: geo.width, height: geo.height } : null,
            modelBounds: cellBoundsInModel(cell)
        };
    }

    function debugOverlayHostSummary() {
        const host = overlayHost() || graph.container;
        if (!host) return null;
        return {
            className: host.className || "",
            id: host.id || "",
            childCount: host.childNodes ? host.childNodes.length : 0,
            scrollLeft: host.scrollLeft || 0,
            scrollTop: host.scrollTop || 0,
            clientWidth: host.clientWidth || 0,
            clientHeight: host.clientHeight || 0
        };
    }

    function scheduleIrrigationDebugSnapshot(session, label) {
        if (typeof setTimeout !== "function") return;
        setTimeout(function () {
            if (!session || activeIrrigationMode !== session) return;
            irrigationDebug(label, {
                hudConnected: !!(session.hud && session.hud.parentNode),
                hudLeft: session.hud && session.hud.style.left,
                hudTop: session.hud && session.hud.style.top,
                overlayHost: debugOverlayHostSummary()
            });
        }, 0);
    }

    function cellState(cell) {
        const state = graph.view && graph.view.getState ? graph.view.getState(cell) : null;
        if (state) return state;
        const geo = getGeometry(cell) || { x: 0, y: 0, width: 80, height: 30 };
        return { x: Number(geo.x || 0), y: Number(geo.y || 0), width: Number(geo.width || 0), height: Number(geo.height || 0) };
    }

    function positionOverlayBox(node, cell, offset) {
        const state = cellState(cell);
        node.style.left = Math.round(state.x + (offset || 0)) + "px";
        node.style.top = Math.round(state.y + (offset || 0)) + "px";
        node.style.width = node.style.width || Math.round(state.width) + "px";
        node.style.height = node.style.height || Math.round(state.height) + "px";
    }

    function positionNavigatorButton(node, cell, dx, dy) {
        const state = cellState(cell);
        node.style.left = Math.round(state.x + state.width + dx) + "px";
        node.style.top = Math.round(state.y + state.height / 2 + dy) + "px";
    }

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

    function button(label, fn, variant) {
        const b = typeof mxUtils !== "undefined" && mxUtils.button ? mxUtils.button(label, fn) : document.createElement("button");
        if (!b.textContent) b.textContent = label;
        if (!(typeof mxUtils !== "undefined" && mxUtils.button)) b.addEventListener("click", fn);
        applyIrrigationButtonStyle(b, variant || (/^Save\b/.test(String(label || "")) ? "add" : "neutral"));
        b.style.maxWidth = "100%";
        b.style.boxSizing = "border-box";
        b.style.whiteSpace = "normal";
        b.style.overflowWrap = "anywhere";
        return b;
    }

    function exitIrrigationButton() {
        const b = button("Exit", closeIrrigationMode);
        const earlyClose = function (ev) {
            if (ev && ev.stopPropagation) ev.stopPropagation();
            closeIrrigationMode();
        };
        if (b.addEventListener) {
            b.addEventListener("pointerdown", earlyClose);
            b.addEventListener("mousedown", earlyClose);
        }
        return b;
    }

    function showDialog(node, w, h) {
        if (ui.showDialog) {
            ui.showDialog(node, w, h, true, true);
            elevateTrellisDialog();
        }
        else if (document && document.body) document.body.appendChild(node);
    }

    function elevateTrellisDialog() {
        const dlg = ui && ui.dialog;
        if (dlg && dlg.bg && dlg.bg.style) dlg.bg.style.zIndex = String(TRELLIS_DIALOG_Z - 1);
        if (dlg && dlg.container && dlg.container.style) dlg.container.style.zIndex = String(TRELLIS_DIALOG_Z);
    }

    function hideDialog() {
        if (ui.hideDialog) ui.hideDialog();
    }

    function alertUser(message) {
        if (ui.alert) ui.alert(message);
        else if (typeof alert !== "undefined") alert(message);
    }

    // Architecture seams: GraphStore owns diagram cell/JSON persistence, ConnectorRules owns connector/port decisions, Hydraulics owns demand/route/capacity checks, ReportModel owns report/dashboard build and writes, ZoneModel owns zone derivation and overrides, and HudController owns UI mode orchestration. Rendering paths must remain write-free; explicit sync/report/write methods persist derived state.
    const IrrigationCatalog = {
        read: readCatalog,
        write: writeCatalog,
        starter: starterCatalog,
        seedIfEmpty: seedStarterCatalogIfEmpty,
        upsert: upsertCatalogPart,
        deletePart: deleteCatalogPart,
        normalizePart: normalizeCatalogPart,
        validatePart: validateCatalogPart,
        mergeUpgradeParts: mergeCatalogUpgradeParts
    };

    const ConnectorRules = {
        normalizeType: normalizeConnectorType,
        normalizeConnector: normalizeConnectorRecord,
        isPipeConnectorType,
        connectorMatches,
        connectorRecordsMatch,
        connectorRecordsRequirePipe,
        connectorsRequirePipe,
        pipeConnectorMatches,
        isReversibleFittingPart,
        isReversibleFittingCell,
        isPartCellFlipped,
        setPartCellFlipped,
        flipConnectPlanForPorts,
        portConnectorForCell,
        portCapacityForCell,
        autoPipePartIdForConnection,
        connectionMode: connectorConnectionMode,
        validatePortConnectionStructure,
        connectionDecision: connectionDecisionForPorts,
        bridgeSuggestionEligibility,
        canConnectParts,
        canEndpointConnectToPart,
        canPartReachEndpoint,
        compatibleFirstParts,
        compatibleNextParts,
        groupPartsByStock,
        healEndpoint,
        validatePortConnection,
        createAssemblyConnection,
        bridgeSuggestionsForPorts,
        applyBridgeSuggestion
    };

    const ConnectionChainPlanner = {
        planBridge: planBridgeConnectionChain,
        applyBridge: applyBridgeConnectionChain,
        applyExternalPart: applyExternalPartConnection,
        createEdge: createPlannedConnectionEdge
    };

    const Hydraulics = {
        demandFromPath,
        demandFromBedAssembly,
        cumulativeBedDemand,
        calculatePath: calculatePathHydraulics,
        estimatePath: estimatePathHydraulics,
        validatePathGraph,
        validatePathCompatibility,
        validateSharedCapacity,
        hydraulicBlockingErrors,
        hazenWilliamsPsiLoss,
        pathRouteLengthFeet,
        pipeSegmentsForPath,
        pipeSegmentLengthForPart,
        partCostForReport,
        partCostForRequiredMeters
    };

    const ZoneModel = {
        normalize: normalizeZone,
        read: readZones,
        write: writeZones,
        sync: syncZones,
        deriveInferredTimerZones,
        resolveMembership: resolveEffectiveZoneMembership,
        summary: zoneSummary,
        assignBeds: assignBedsToZone,
        resetBedOverrides: resetBedZoneOverrides,
        createManual: createManualZone,
        updateAlias: updateZoneAlias,
        resetZoneOverrides,
        displayName: zoneDisplayName
    };

    const AnalysisModel = { // NEW
        buildView: buildAnalysisView, // NEW
        buildActiveZone: analysisBuildActiveZone, // NEW
        inferZoneId: inferAnalysisZoneId, // NEW
        coverageForEndpoint: analysisCoverageForEndpoint // NEW
    }; // NEW

    const ReportModel = {
        buildSummary: buildReportSummary,
        persistSummary: persistReportSummary,
        generate: generateReport,
        readDashboardSummary,
        buildBomRows,
        deriveBomComponents,
        deriveAssemblyPaths,
        syncDashboardState: function (moduleCell, paths) { return persistReportSummary(moduleCell, buildReportSummary(moduleCell, { paths: paths || deriveAssemblyPaths(moduleCell) })); }
    };

    const HudController = {
        open: openIrrigationMode,
        close: closeIrrigationMode,
        render: renderIrrigationMode,
        scheduleSync: scheduleHudGraphStateSync,
        flushSync: flushHudGraphStateSync,
        syncGraphState: syncHudGraphState
    };

    function addActionAndMenus() {
        if (ui.actions && ui.actions.addAction) {
            ui.actions.addAction(ACTION_ID, function () {
                const selection = graph.getSelectionCell && graph.getSelectionCell();
                openIrrigationMode(findGardenModuleAncestor(selection) || selection);
            });
            ui.actions.addAction(CREATE_SOURCE_ACTION_ID, function () {
                const selection = graph.getSelectionCell && graph.getSelectionCell();
                const moduleCell = isGardenModule(selection) ? selection : findGardenModuleAncestor(selection);
                if (!moduleCell) return alertUser("Select a Trellis garden module first.");
                openIrrigationMode(moduleCell, { sourceForm: true, preserveViewport: true });
            });
            ui.actions.addAction(CREATE_BED_ACTION_ID, function () {
                const selection = graph.getSelectionCell && graph.getSelectionCell();
                const bed = isGardenBed(selection) ? selection : findBedAncestor(selection);
                if (!bed) return alertUser("Select a garden bed first.");
                openIrrigationMode(findGardenModuleAncestor(bed), { selectCell: bed, preserveViewport: true });
            });
            ui.actions.addAction(CREATE_BRANCH_ACTION_ID, function () {
                const selection = graph.getSelectionCell && graph.getSelectionCell();
                const moduleCell = isGardenModule(selection) ? selection : findGardenModuleAncestor(selection);
                if (!moduleCell) return alertUser("Select a Trellis garden module first.");
                openIrrigationMode(moduleCell, { message: "Use inlet/outlet selectors to place branch-capable catalog parts.", preserveViewport: true });
            });
        }
    }

    graph.__trellisIrrigationPlanner = {
        attrs: ATTRS,
        categories: PART_CATEGORIES.slice(),
        stockStates: VALID_STOCK_STATES.slice(),
        bedTemplates: BED_TEMPLATES.slice(),
        readCatalog: IrrigationCatalog.read,
        writeCatalog: IrrigationCatalog.write,
        starterCatalog: IrrigationCatalog.starter,
        seedStarterCatalogIfEmpty: IrrigationCatalog.seedIfEmpty,
        upsertCatalogPart: IrrigationCatalog.upsert,
        deleteCatalogPart: IrrigationCatalog.deletePart,
        validateCatalogPart: IrrigationCatalog.validatePart,
        canConnectParts: ConnectorRules.canConnectParts,
        canPartReachEndpoint: ConnectorRules.canPartReachEndpoint,
        compatibleNextParts: ConnectorRules.compatibleNextParts,
        compatibleFirstParts: ConnectorRules.compatibleFirstParts,
        groupPartsByStock: ConnectorRules.groupPartsByStock,
        healEndpoint: ConnectorRules.healEndpoint,
        generateReport: ReportModel.generate,
        readDashboardSummary: ReportModel.readDashboardSummary,
        readZones: ZoneModel.read,
        writeZones: ZoneModel.write,
        syncZones: ZoneModel.sync,
        deriveInferredTimerZones: ZoneModel.deriveInferredTimerZones,
        resolveEffectiveZoneMembership: ZoneModel.resolveMembership,
        zoneSummary: ZoneModel.summary,
        buildAnalysisView: AnalysisModel.buildView, // NEW
        buildBomRows: ReportModel.buildBomRows,
        assignBedsToZone: ZoneModel.assignBeds,
        resetBedZoneOverrides: ZoneModel.resetBedOverrides,
        createManualZone: ZoneModel.createManual,
        openIrrigationMode: HudController.open,
        closeIrrigationMode: HudController.close,
        beginHudDragSuppression, // CHANGE
        updateHudDragSuppression, // CHANGE
        finishHudDragSuppression, // CHANGE
        isIrrigationModeActive,
        getActiveIrrigationModule,
        isBedAssembly,
        getBedIrrigationMethods,
        syncLinkedBedAssemblyToBed,
        openCatalogManager,
        openBomDialog,
        __test: {
            GraphStore,
            IrrigationCatalog,
            ConnectorRules,
            ConnectionChainPlanner,
            Hydraulics,
            ZoneModel,
            AnalysisModel, // NEW
            ReportModel,
            HudController,
            partStates: { planned: PART_STATE_PLANNED, completed: PART_STATE_COMPLETED },
            normalizePartState,
            partStateForCell,
            shortCatalogPartName,
            setPartCellState,
            setPipeEdgeState,
            setBedTemplatePartState,
            lifecycleTargetsForSelection,
            markIrrigationSelectionState,
            normalizeCatalogPart: IrrigationCatalog.normalizePart,
            normalizeEndpointProfile,
            connectorMatches: ConnectorRules.connectorMatches,
            collectGardenBeds,
            collectEndpoints,
            bedAreaM2,
            pathBlockingErrors,
            validatePathGraph: Hydraulics.validatePathGraph,
            validatePathCompatibility: Hydraulics.validatePathCompatibility,
            validateSharedCapacity: Hydraulics.validateSharedCapacity,
            createSourceEndpoint,
            createBedEndpoint,
            createBranchpointEndpoint,
            ensureBedEndpoint,
            buildPairQueue,
            stagePath,
            commitStagedPath,
            commitBedTemplate,
            calculatePathHydraulics: Hydraulics.calculatePath,
            estimatePathHydraulics: Hydraulics.estimatePath,
            hydraulicBlockingErrors: Hydraulics.hydraulicBlockingErrors,
            hazenWilliamsPsiLoss: Hydraulics.hazenWilliamsPsiLoss,
            pathRouteLengthFeet: Hydraulics.pathRouteLengthFeet,
            pipeSegmentsForPath: Hydraulics.pipeSegmentsForPath,
            pipeSegmentLengthForPart: Hydraulics.pipeSegmentLengthForPart,
            partCostForReport: Hydraulics.partCostForReport,
            partCostForRequiredMeters: Hydraulics.partCostForRequiredMeters,
            computeBedTemplateBom,
            buildBomRows: ReportModel.buildBomRows,
            buildBomCsv, // NEW
            bomCanonicalQuantityToDisplay,
            bomInputQuantityToCanonical,
            bomDisplayUnitLabel, // NEW
            bomDisplayUnitCost,
            bomInputUnitCostToCanonical,
            stockStateForQuantity,
            broadCategoryForCatalogCategory, // NEW
            categoriesForBroadCategoryFilter, // NEW
            partDisplayCategory, // NEW
            logicalCategoryForPart, // NEW
            logicalCategoriesForBroadCategoryFilter, // NEW
            fittingIntentGroupForPart, // NEW
            fittingSizePairGroupForPart, // NEW
            fittingIntentPartGroups, // NEW
            selectedCatalogPartIdsForSelection,
            createBedTemplateLayoutCells,
            rowSpacingSpanCmForBedGeometry,
            rowSpacingCmForRows,
            rowsForRowSpacingCm,
            rowSpacingDisplayValueToCm,
            rowSpacingCmToDisplayValue,
            resolveTemplateAnchorPart,
            boundaryMatchForAnchor,
            buildReportSummary: ReportModel.buildSummary,
            persistReportSummary: ReportModel.persistSummary,
            readPaths,
            writePaths,
            normalizeZone: ZoneModel.normalize,
            readZones: ZoneModel.read,
            writeZones: ZoneModel.write,
            syncZones: ZoneModel.sync,
            buildAnalysisView: AnalysisModel.buildView, // NEW
            buildActiveZoneAnalysis: AnalysisModel.buildActiveZone, // NEW
            inferAnalysisZoneId: AnalysisModel.inferZoneId, // NEW
            analysisCoverageForEndpoint: AnalysisModel.coverageForEndpoint, // NEW
            deriveInferredTimerZones: ZoneModel.deriveInferredTimerZones,
            downstreamBedAssemblyIdsFromTimerOutlet,
            resolveEffectiveZoneMembership: ZoneModel.resolveMembership,
            zoneSummary: ZoneModel.summary,
            deriveBomComponents: ReportModel.deriveBomComponents,
            assignBedsToZone: ZoneModel.assignBeds,
            resetBedZoneOverrides: ZoneModel.resetBedOverrides,
            createManualZone: ZoneModel.createManual,
            createSourceAssembly,
            createPartAssembly,
            createBedAssembly,
            isBedAssembly,
            isCenterStableFoldAssembly,
            centerAlternateBoundsOnGeometry,
            getBedIrrigationMethods,
            readBedAssemblyTemplateRecord,
            syncLinkedBedAssemblyToBed,
            createAssemblyConnection: ConnectorRules.createAssemblyConnection,
            validatePortConnection: ConnectorRules.validatePortConnection,
            portConnectorForCell: ConnectorRules.portConnectorForCell,
            isReversibleFittingPart: ConnectorRules.isReversibleFittingPart,
            isReversibleFittingCell: ConnectorRules.isReversibleFittingCell,
            isPartCellFlipped: ConnectorRules.isPartCellFlipped,
            setPartCellFlipped: ConnectorRules.setPartCellFlipped,
            flipConnectPlanForPorts: ConnectorRules.flipConnectPlanForPorts,
            autoPipePartIdForConnection: ConnectorRules.autoPipePartIdForConnection,
            connectionModeForConnectors: ConnectorRules.connectionMode,
            validatePortConnectionStructure: ConnectorRules.validatePortConnectionStructure,
            connectionDecisionForPorts: ConnectorRules.connectionDecision,
            bridgeSuggestionEligibility: ConnectorRules.bridgeSuggestionEligibility,
            applyConnectionPartChoice,
            dropdownPartConnectionDecision,
            selectedValidPorts,
            toggleSelectedPort,
            pipeEdgeStyleMode,
            setPipeEdgeStyleMode,
            syncConnectionEdgeVisualAnchors, // NEW
            syncAllConnectionEdgeVisualAnchors, // NEW
            boundaryForPort,
            internalConnectionBoundariesForSelection,
            disconnectBoundary,
            disconnectBoundaries,
            deleteAssemblyPartCell,
            assemblyCanReverse, // NEW
            positionPortBadge,
            bridgeSuggestionsForPorts: ConnectorRules.bridgeSuggestionsForPorts,
            applyBridgeSuggestion: ConnectorRules.applyBridgeSuggestion,
            deriveAssemblyPaths: ReportModel.deriveAssemblyPaths,
            firstAssemblyPart,
            lastAssemblyPart,
            assemblyPartCells,
            collectAssemblyEdges,
            collectHudObjects,
            collectHudEndpoints,
            collectHudPipeEdges,
            deriveHudPaths,
            syncHudGraphState: HudController.syncGraphState,
            scheduleHudGraphStateSync: HudController.scheduleSync,
            flushHudGraphStateSync: HudController.flushSync,
            beginIrrigationDragCandidate, // CHANGE
            updateIrrigationDragSuppression, // CHANGE
            finishIrrigationDragSuppression, // CHANGE
            clearIrrigationDragState, // CHANGE
            isIrrigationModeActive,
            getActiveIrrigationModule,
            isIrrigationHudSelectionTarget,
            validateHudConnection,
            addPartPickerParts,
            addPartContextFromPort,
            collectUpstreamBranchParts,
            upstreamSingletonCategories,
            sortAddPartPickerParts
        }
    };

    if (typeof window !== "undefined") {
        window.TrellisIrrigationPlanner = graph.__trellisIrrigationPlanner;
        window.addEventListener('trellisHistoryBeforeRestore', function () {
            cancelPendingHudGraphStateSync();
        });
        window.addEventListener('trellisHistoryAfterRestore', function () {
            try { refreshInactiveEntryOverlay(); } catch (e) { }
            try {
                if (!activeIrrigationMode || !activeIrrigationMode.moduleCell) return;
                const moduleId = getCellId(activeIrrigationMode.moduleCell);
                const restoredModule = moduleId && model.getCell ? model.getCell(moduleId) : null;
                if (restoredModule) activeIrrigationMode.moduleCell = restoredModule;
                renderIrrigationMode(activeIrrigationMode);
            } catch (e) { }
        });
    }

    addActionAndMenus();
    installInactiveIrrigationEntryOverlay();
});
