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

    const PLUGIN_VERSION = 1;
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
        PIPE_PART_ID: "irrigation_pipe_part_id",
        ASSEMBLY: "irrigation_assembly", // NEW
        ASSEMBLY_TYPE: "irrigation_assembly_type", // NEW
        ASSEMBLY_EXPANDED: "irrigation_assembly_expanded", // NEW
        LINKED_BED_ID: "irrigation_linked_bed_id", // NEW
        EDGE_SOURCE_PORT: "irrigation_edge_source_port", // NEW
        EDGE_TARGET_PORT: "irrigation_edge_target_port", // NEW
        BED_TEMPLATE_JSON: "irrigation_bed_template_json",
        BED_LAYOUT: "irrigation_bed_layout"
    };

    const STOCK_AVAILABLE = new Set(["in_stock", "low_stock"]);
    const PURCHASE_NEEDED = new Set(["out_of_stock", "unknown"]);
    const BRANCH_CATEGORIES = new Set(["valve", "manifold", "controller_timer"]);
    const VALID_STOCK_STATES = ["in_stock", "low_stock", "out_of_stock", "unknown"];
    const ASSEMBLY_PART_WIDTH = 150; // NEW
    const ASSEMBLY_PART_HEIGHT = 34; // NEW
    const ASSEMBLY_PART_GAP = 16; // NEW
    const ASSEMBLY_HEADER_SIZE = 28; // NEW
    const ASSEMBLY_DEFAULT_WIDTH = 210; // NEW
    const ASSEMBLY_CONTRACTED_BED = { width: 220, height: 120 }; // NEW
    const PORT_BADGE_SIZE = 22; // NEW
    const FIXED_CONNECTOR_TYPES = ["ght", "mpt", "fpt", "barb"]; // NEW
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

    const STARTER_CATALOG_ITEMS = [
        starterPart("hose_vacuum_breaker", "3/4 in GHT hose vacuum breaker", "backflow", 12, 1, 1, input("ght", "3/4"), output("ght", "3/4"), { pressureLossPsi: 1.0 }),
        starterPart("hose_timer_single_zone", "3/4 in GHT hose timer", "controller_timer", 38, 1, 1, input("ght", "3/4"), output("ght", "3/4", "", 5), { pressureLossPsi: 1.5, maxFlowGpm: 5 }),
        starterPart("ght_to_3_4_mpt_adapter", "3/4 in GHT to 3/4 in MPT adapter", "source_adapter", 5, 1, 1, input("ght", "3/4"), output("mpt", "3/4"), { pressureLossPsi: 0.2 }),
        starterPart("filter_150_mesh_3_4_fpt", "150 mesh filter, 3/4 in FPT", "filter", 32, 1, 1, input("mpt", "3/4"), output("fpt", "3/4"), { pressureLossPsi: 2.0 }),
        starterPart("drip_regulator_25psi_3_4_fpt", "25 psi drip pressure regulator, 3/4 in FPT", "regulator", 18, 1, 1, input("fpt", "3/4"), output("fpt", "3/4"), { pressureLossPsi: 1.0, operatingPressurePsi: 25 }),
        starterPart("spray_regulator_30psi_3_4_fpt", "30 psi spray pressure regulator, 3/4 in FPT", "regulator", 20, 1, 1, input("fpt", "3/4"), output("fpt", "3/4"), { pressureLossPsi: 1.0, operatingPressurePsi: 30 }),
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
        starterPart("poly_mainline_3_4", "3/4 in poly mainline tubing", "pipe_tubing", 0, 1, 1, input("barb", "3/4"), output("barb", "3/4"), { innerDiameterIn: 0.824, hazenWilliamsC: 150 }, 0.65),
        starterPart("poly_distribution_1_2", "1/2 in distribution tubing", "pipe_tubing", 0, 1, 1, input("barb", "1/2"), output("barb", "1/2"), { innerDiameterIn: 0.600, hazenWilliamsC: 150 }, 0.32),
        starterPart("drip_tape_8mil_12in", "8 mil drip tape, 12 in emitter spacing", "drip_tape", 42, 1, 1, input("barb", "1/2", "drip"), output("barb", "1/2", "drip"), { flowGpm: 1.2, operatingPressurePsi: 10 }),
        starterPart("pc_dripline_1_2", "1/2 in pressure-compensating dripline", "dripline", 48, 1, 1, input("barb", "1/2", "drip"), output("barb", "1/2", "drip"), { flowGpm: 1.0, operatingPressurePsi: 12 }),
        starterPart("overhead_sprinkler_head_30psi", "Overhead sprinkler head/nozzle, 30 psi", "sprinkler", 14, 1, 1, input("barb", "1/2", "sprinkler"), output("barb", "1/2", "sprinkler"), { flowGpm: 2.5, operatingPressurePsi: 30 }),
        starterPart("microspray_stake_20psi", "Nursery microspray stake, 20 psi", "microspray", 8, 1, 1, input("barb", "1/2", "microspray"), output("barb", "1/2", "microspray"), { flowGpm: 1.5, operatingPressurePsi: 20 }),
        starterPart("soaker_row_line_1_2", "1/2 in soaker row line", "dripline", 30, 1, 1, input("barb", "1/2", "drip"), output("barb", "1/2", "drip"), { flowGpm: 0.8, operatingPressurePsi: 10 }),
        starterPart("bubbler_emitter_1_2", "Perennial bubbler emitter", "bubbler", 5, 1, 1, input("barb", "1/2", "bubbler"), output("barb", "1/2", "bubbler"), { flowGpm: 1.0, operatingPressurePsi: 15 }),
        starterPart("hose_standpipe_1_2", "Manual hose standpipe", "standpipe", 22, 1, 1, input("barb", "1/2", "standpipe"), output("barb", "1/2", "standpipe"), { flowGpm: 2.0, operatingPressurePsi: 20 })
    ];

    let activeIrrigationMode = null; // NEW
    let hudSyncTimer = null; // NEW
    let hudSyncModuleCell = null; // NEW

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
        return {
            version: PLUGIN_VERSION,
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

    function input(type, nominalSize, method) {
        return { type: type || "", nominalSize: nominalSize || "", method: method || "" };
    }

    function output(type, nominalSize, method, maxFlowGpm) {
        return { type: type || "", nominalSize: nominalSize || "", method: method || "", maxFlowGpm: maxFlowGpm == null ? null : maxFlowGpm };
    }

    function starterPart(id, name, category, cost, inputs, outputs, inputConnector, outputConnector, specs, unitCost) {
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
                input: inputConnector,
                output: outputConnector
            },
            specs: Object.assign({}, specs || {})
        };
    }

    function starterCatalog() {
        return { version: PLUGIN_VERSION, items: STARTER_CATALOG_ITEMS.map(normalizeCatalogPart).filter(Boolean) };
    }

    function seedStarterCatalogIfEmpty(moduleCell) {
        const current = readCatalog(moduleCell);
        if (!moduleCell || current.items.length > 0) return current;
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

    function normalizeConnectorRecord(connector) {
        const c = connector || {};
        return {
            type: String(c.type || c.connectionType || "").trim(),
            nominalSize: String(c.nominalSize || c.size || "").trim(),
            pipeType: String(c.pipeType || "").trim(),
            method: String(c.method || "").trim(),
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
            unitCost: finiteNumber(part.unitCost, finiteNumber(part.cost, 0)),
            connectors: {
                inputs: Math.max(0, Math.floor(finiteNumber(connectors.inputs, 0))),
                outputs: Math.max(0, Math.floor(finiteNumber(connectors.outputs, 0))),
                input: normalizeConnectorRecord(connectors.input || connectors.in),
                output: normalizeConnectorRecord(connectors.output || connectors.out)
            },
            specs: Object.assign({}, part.specs || {})
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
            return Number(part.specs.innerDiameterIn) > 0 && Number(part.specs.hazenWilliamsC) > 0;
        }
        return Number(part.specs.flowGpm) >= 0 || Number(part.specs.operatingPressurePsi) > 0 || Number(part.specs.pressureLossPsi) >= 0;
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

    function connectorMatches(source, target, endpointRequirement) {
        if (!source || !target) return { ok: false, reason: "Missing connector." };
        if (!source.type || !target.type || source.type !== target.type) return { ok: false, reason: "Connector type mismatch." };
        if (!source.nominalSize || !target.nominalSize) return { ok: false, reason: "Missing connector size." };
        if (source.nominalSize !== target.nominalSize) return { ok: false, reason: "Adapter required for size mismatch." };
        const method = endpointRequirement && endpointRequirement.method;
        if (method && source.method && source.method !== method) return { ok: false, reason: "Source method mismatch." };
        if (method && target.method && target.method !== method) return { ok: false, reason: "Target method mismatch." };
        if (source.pipeType && target.pipeType && source.pipeType !== target.pipeType) return { ok: false, reason: "Pipe type mismatch." };
        return { ok: true, reason: "" };
    }

    function canConnectParts(previousPart, nextPart, endpointRequirement) {
        const prev = normalizeCatalogPart(previousPart);
        const next = normalizeCatalogPart(nextPart);
        if (!prev || !next) return { ok: false, reason: "Missing part." };
        if (prev.connectors.outputs <= 0) return { ok: false, reason: "Previous part has no output connector." };
        if (next.connectors.inputs <= 0) return { ok: false, reason: "Next part has no input connector." };
        return connectorMatches(prev.connectors.output, next.connectors.input, endpointRequirement);
    }

    function canEndpointConnectToPart(endpointRequirement, nextPart) {
        const req = normalizeEndpointProfile(endpointRequirement);
        const next = normalizeCatalogPart(nextPart);
        if (!next) return { ok: false, reason: "Missing part." };
        if (!req.connectorType || !req.nominalSize) return { ok: false, reason: "Endpoint requirement is incomplete." };
        if (next.connectors.inputs <= 0) return { ok: false, reason: "Next part has no input connector." };
        return connectorMatches({
            type: req.connectorType,
            nominalSize: req.nominalSize,
            pipeType: req.pipeType || "",
            method: req.method || ""
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
        return connectorMatches(p.connectors.output, {
            type: req.connectorType,
            nominalSize: req.nominalSize,
            pipeType: req.pipeType || "",
            method: req.method || ""
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
                    type: profile.connectorType,
                    nominalSize: profile.nominalSize,
                    pipeType: profile.pipeType || "",
                    method: profile.method || "",
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
            connectorType: String(p.connectorType || p.type || "").trim(),
            nominalSize: String(p.nominalSize || p.size || "").trim(),
            pipeType: String(p.pipeType || "").trim(),
            method: String(p.method || "").trim(),
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
        const height = Math.max(minHeight, ASSEMBLY_HEADER_SIZE + ASSEMBLY_PART_GAP + parts.length * ASSEMBLY_PART_HEIGHT + Math.max(0, parts.length - 1) * ASSEMBLY_PART_GAP + ASSEMBLY_PART_GAP); // NEW
        const width = Math.max(ASSEMBLY_DEFAULT_WIDTH, ASSEMBLY_PART_WIDTH + 40); // NEW
        setGeometry(assembly, { width, height }); // NEW
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

    function createBedAssembly(moduleCell, bedCell, anchor) { // NEW
        const bedGeo = getGeometry(bedCell) || { width: ASSEMBLY_CONTRACTED_BED.width, height: ASSEMBLY_CONTRACTED_BED.height }; // NEW
        const point = anchor || { x: 24, y: 72 }; // NEW
        const label = (getCellAttr(bedCell, "label", "Bed") || "Bed") + " Assembly"; // NEW
        const assembly = createAssemblyLane(moduleCell, label, point.x, point.y, "bed", { // NEW
            [ATTRS.ASSEMBLY_EXPANDED]: "1", // NEW
            [ATTRS.LINKED_BED_ID]: getCellId(bedCell) || "" // NEW
        }); // NEW
        setGeometry(assembly, { width: finiteNumber(bedGeo.width, ASSEMBLY_DEFAULT_WIDTH), height: finiteNumber(bedGeo.height, ASSEMBLY_CONTRACTED_BED.height) }); // CHANGE
        const endpoint = createAssemblyPartCell(assembly, (getCellAttr(bedCell, "label", "Bed") || "Bed") + " inlet", { // NEW
            label: (getCellAttr(bedCell, "label", "Bed") || "Bed") + " inlet", // NEW
            [ATTRS.ENDPOINT]: "1", // NEW
            [ATTRS.ENDPOINT_TYPE]: "bed", // NEW
            [ATTRS.ENDPOINT_PROFILE_JSON]: JSON.stringify(normalizeEndpointProfile({ label: "Bed inlet", connectorType: "barb", nominalSize: "1/2", method: "drip" })) // NEW
        }); // NEW
        setGeometry(assembly, { width: finiteNumber(bedGeo.width, ASSEMBLY_DEFAULT_WIDTH), height: finiteNumber(bedGeo.height, ASSEMBLY_CONTRACTED_BED.height) }); // CHANGE
        return { assembly, endpoint }; // NEW
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
        if (endpointType(cell) === "source") return role === "output" ? 1 : 0; // NEW
        if (endpointType(cell) === "bed") return role === "input" ? 1 : 0; // NEW
        const part = partForCell(moduleCell, cell); // NEW
        if (!part || !part.connectors) return 0; // NEW
        return Math.max(0, finiteNumber(role === "input" ? part.connectors.inputs : part.connectors.outputs, 0)); // NEW
    } // NEW

    function portConnectorForCell(moduleCell, cell, role) { // NEW
        if (!cell) return null; // NEW
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
            return !!cell && !isLegacyGenerated(cell) && getCellAttr(cell, ATTRS.PIPE_EDGE, "") === "1" && getCellAttr(cell, ATTRS.EDGE_SOURCE_PORT, "") !== ""; // NEW
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
                connectorMatches(sourceConnector, p.connectors.input, null).ok && // NEW
                connectorMatches(p.connectors.output, targetConnector, null).ok; // NEW
        }).map(normalizeCatalogPart); // NEW
        candidates.sort(function (a, b) { // NEW
            const stockA = STOCK_AVAILABLE.has(a.stockState) ? 0 : 1; // NEW
            const stockB = STOCK_AVAILABLE.has(b.stockState) ? 0 : 1; // NEW
            return (stockA - stockB) || (finiteNumber(a.unitCost, a.cost) - finiteNumber(b.unitCost, b.cost)) || String(a.name).localeCompare(String(b.name)); // NEW
        }); // NEW
        return candidates[0] ? candidates[0].id : ""; // NEW
    } // NEW

    function validatePortConnection(moduleCell, sourcePort, targetPort) { // NEW
        const source = normalizePort(sourcePort); // NEW
        const target = normalizePort(targetPort); // NEW
        if (source.role !== "output" || target.role !== "input") return { ok: false, reason: "Select one output port and one inlet port." }; // NEW
        const sourceCell = portCell(moduleCell, source); // NEW
        const targetCell = portCell(moduleCell, target); // NEW
        if (!sourceCell || !targetCell) return { ok: false, reason: "Selected port is no longer available." }; // NEW
        if (sourceCell === targetCell) return { ok: false, reason: "A part cannot connect to itself." }; // NEW
        const sourceAssembly = findAssemblyAncestor(sourceCell); // NEW
        const targetAssembly = findAssemblyAncestor(targetCell); // NEW
        if (sourceAssembly && targetAssembly && sourceAssembly !== targetAssembly) { // NEW
            if (lastAssemblyPart(sourceAssembly) !== sourceCell) return { ok: false, reason: "Connect from the last part in the upstream assembly." }; // NEW
            if (firstAssemblyPart(targetAssembly) !== targetCell) return { ok: false, reason: "Connect to the first part in the downstream assembly." }; // NEW
        } // NEW
        if (source.index >= portCapacityForCell(moduleCell, sourceCell, "output")) return { ok: false, reason: "Selected output does not exist." }; // NEW
        if (target.index >= portCapacityForCell(moduleCell, targetCell, "input")) return { ok: false, reason: "Selected inlet does not exist." }; // NEW
        if (!isPortFree(moduleCell, source)) return { ok: false, reason: "Selected output is already connected." }; // NEW
        if (!isPortFree(moduleCell, target)) return { ok: false, reason: "Selected inlet is already connected." }; // NEW
        if (wouldCreateAssemblyCycle(moduleCell, sourceCell, targetCell)) return { ok: false, reason: "Irrigation assemblies must remain a tree." }; // NEW
        const sourceConnector = portConnectorForCell(moduleCell, sourceCell, "output"); // NEW
        const targetConnector = portConnectorForCell(moduleCell, targetCell, "input"); // NEW
        const match = connectorMatches(sourceConnector, targetConnector, endpointType(targetCell) === "bed" ? endpointProfile(targetCell) : null); // NEW
        return match.ok ? { ok: true, reason: "" } : match; // NEW
    } // NEW

    function createAssemblyConnection(moduleCell, sourcePort, targetPort) { // NEW
        const validation = validatePortConnection(moduleCell, sourcePort, targetPort); // NEW
        if (!validation.ok) return { ok: false, reason: validation.reason, edge: null }; // NEW
        const source = normalizePort(sourcePort); // NEW
        const target = normalizePort(targetPort); // NEW
        const sourceCell = portCell(moduleCell, source); // NEW
        const targetCell = portCell(moduleCell, target); // NEW
        const pipePartId = autoPipePartIdForConnection(moduleCell, portConnectorForCell(moduleCell, sourceCell, "output"), portConnectorForCell(moduleCell, targetCell, "input")); // NEW
        const edge = createEdge(moduleCell, sourceCell, targetCell, "", "edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#2f80ed;", { // NEW
            [ATTRS.PIPE_EDGE]: "1", // NEW
            [ATTRS.PIPE_PART_ID]: pipePartId, // NEW
            [ATTRS.EDGE_SOURCE_PORT]: String(source.index), // NEW
            [ATTRS.EDGE_TARGET_PORT]: String(target.index) // NEW
        }); // NEW
        return { ok: true, reason: "", edge }; // NEW
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
        return createBedEndpoint(bedCell, label, Object.assign({ connectorType: "barb", nominalSize: "1/2", method: "" }, profile || {}));
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
            bedDemand: options && options.bedDemand || null,
            componentCellIds: [],
            pipeEdgeIds: [],
            bedTemplateCommitted: false,
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
        const template = path && path.bedTemplate;
        if (template && template.demand) return template.demand;
        if (template && Array.isArray(template.partIds)) {
            return template.partIds.reduce(function (out, partId) {
                const part = partById(catalog, partId);
                out.flowGpm += finiteNumber(part && part.specs && part.specs.flowGpm, 0);
                out.operatingPressurePsi = Math.max(out.operatingPressurePsi, finiteNumber(part && part.specs && part.specs.operatingPressurePsi, 0));
                return out;
            }, { flowGpm: 0, operatingPressurePsi: 0 });
        }
        return path && path.bedDemand || { flowGpm: 0, operatingPressurePsi: 0 };
    }

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
            lengthFt: pathRouteLengthFeet(moduleCell, path) // CHANGE
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
        const existing = readPaths(moduleCell).filter(function (other) { return other.id !== path.id; });
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
            const direct = connectorMatches({
                type: endpointProfile(source).connectorType,
                nominalSize: endpointProfile(source).nominalSize,
                pipeType: endpointProfile(source).pipeType || "",
                method: endpointProfile(source).method || ""
            }, {
                type: endpointProfile(target).connectorType,
                nominalSize: endpointProfile(target).nominalSize,
                pipeType: endpointProfile(target).pipeType || "",
                method: endpointProfile(target).method || ""
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

            const paths = readPaths(moduleCell);
            paths.forEach(function (path) {
                if (path.id === pathId) {
                    path.targetBedId = getCellId(bedCell) || path.targetBedId || "";
                    path.bedTemplateCommitted = true;
                    path.bedTemplate = record;
                    path.hydraulic = calculatePathHydraulics(moduleCell, path);
                    path.blockingErrors = validateSharedCapacity(moduleCell, path).concat(hydraulicBlockingErrors(path));
                }
            });
            writePaths(moduleCell, paths);
        } finally {
            model.endUpdate && model.endUpdate();
        }

        return record;
    }

    function createBedTemplateLayoutCells(bedCell, pathId, record, bedGeo) {
        const width = Math.max(80, Number(bedGeo.width || 160) - 12);
        const height = Math.max(40, Number(bedGeo.height || 80) - 20);
        const rows = Math.max(1, Math.floor(finiteNumber(record.spacing && record.spacing.rows, 1)));
        const rowGap = height / (rows + 1);
        for (let i = 0; i < rows; i++) {
            const y = Math.round(10 + rowGap * (i + 1));
            createVertex(bedCell, record.irrigationType + " row " + (i + 1), 6, y, width, 6,
                "rounded=0;whiteSpace=wrap;html=1;fillColor=#e1f5fe;strokeColor=#0288d1;fontSize=8;",
                {
                    label: record.irrigationType + " row " + (i + 1),
                    [ATTRS.BED_LAYOUT]: "1",
                    [ATTRS.PATH_ID]: pathId,
                    [ATTRS.GENERATED]: "1",
                    [ATTRS.BED_TEMPLATE_JSON]: JSON.stringify(record)
                });
        }
        createVertex(bedCell, record.templateId.replace(/_/g, " "), 6, Math.max(10, Number(bedGeo.height || 80) - 24), width, 18,
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

    function estimatePathHydraulics(args) {
        const catalog = args && args.catalog ? args.catalog : { items: [] };
        const source = normalizeEndpointProfile(args && args.sourceProfile);
        const bedDemand = args && args.bedDemand || {};
        const partIds = args && args.partIds || [];
        const pipePart = partById(catalog, args && args.pipePartId);
        const flowGpm = finiteNumber(bedDemand.flowGpm, source.usableFlowGpm || 0);
        const operatingPressurePsi = finiteNumber(bedDemand.operatingPressurePsi, 0);
        const lengthFt = finiteNumber(args && args.lengthFt, 0);
        let pressureLossPsi = 0;
        const warnings = [];

        if (pipePart && pipePart.category === "pipe_tubing") {
            pressureLossPsi += hazenWilliamsPsiLoss({
                lengthFt,
                flowGpm,
                diameterIn: pipePart.specs.innerDiameterIn,
                c: pipePart.specs.hazenWilliamsC
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
        if (source.usableFlowGpm != null && flowGpm > source.usableFlowGpm) warnings.push("Flow demand exceeds source usable flow.");
        if (marginPsi < 0) warnings.push("Required pressure exceeds available source pressure.");

        return {
            flowGpm,
            availablePressurePsi,
            operatingPressurePsi,
            pressureLossPsi,
            requiredPressurePsi,
            marginPsi,
            ok: warnings.length === 0,
            warnings
        };
    }

    function edgeLengthFeet(edge) {
        const geo = getGeometry(edge);
        if (!geo) return 0;
        if (Array.isArray(geo.points) && geo.points.length > 1) {
            let total = 0;
            for (let i = 1; i < geo.points.length; i++) {
                const a = geo.points[i - 1], b = geo.points[i];
                total += Math.sqrt(Math.pow(Number(b.x) - Number(a.x), 2) + Math.pow(Number(b.y) - Number(a.y), 2));
            }
            return unitsToCm(total) / CM_PER_FOOT;
        }
        return 0;
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
        if (part.category === "pipe_tubing") return finiteNumber(part.unitCost, part.cost || 0) * pathRouteLengthFeet(moduleCell, path);
        return finiteNumber(part.cost || part.unitCost, 0);
    }

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
        const paths = readPaths(moduleCell);
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
            if (path.pipePartIds && path.pipePartIds.length) { // NEW
                (path.pipePartIds || []).forEach(function (pipePartId, edgeIndex) { // NEW
                    usedPartIds.push(pipePartId); // NEW
                    const edge = findCellById(moduleCell, (path.pipeEdgeIds || [])[edgeIndex]); // NEW
                    const lengthFt = edgeLengthFeet(edge) || pathRouteLengthFeet(moduleCell, path); // NEW
                    const pipePart = partById(catalog, pipePartId); // NEW
                    usedPartCosts.push({ partId: pipePartId, cost: finiteNumber(pipePart && pipePart.unitCost, pipePart && pipePart.cost || 0) * lengthFt }); // NEW
                }); // NEW
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
        const summary = {
            version: PLUGIN_VERSION,
            percentIrrigated: totalBedAreaM2 > 0 ? (irrigatedAreaM2 / totalBedAreaM2) * 100 : 0,
            purchaseNeededCost,
            totalDesignValue,
            zoneCount: controlledZones.size,
            completeness: beds.length > 0 ? (completeBedIds.size / beds.length) * 100 : 0,
            worstHydraulicMarginPsi,
            purchaseNeededCount: purchasePartIds.length,
            criticalWarningCount: criticalWarnings.length,
            criticalWarnings,
            generatedAt: new Date().toISOString()
        };

        setCellAttrs(moduleCell, {
            [ATTRS.REPORT_JSON]: JSON.stringify({ version: PLUGIN_VERSION, paths, summary }),
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
        if (!state.categoryFilter) state.categoryFilter = ""; // NEW
        if (!state.broadCategoryFilter) state.broadCategoryFilter = ""; // NEW
        if (!state.sizeFilter) state.sizeFilter = ""; // NEW
        if (!state.connectionFilter) state.connectionFilter = ""; // NEW
        const filterOptions = catalogFilterOptions(catalog); // NEW
        const visibleItems = sortCatalogParts(catalog.items.filter(function (part) { return catalogPartMatchesFilters(part, state); })); // CHANGE
        const selected = partById(catalog, state.selectedId) || visibleItems[0] || catalog.items[0] || makeBlankPart(catalog); // CHANGE
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

        const form = buildCatalogPartForm(selected, moduleCell); // CHANGE
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
            state.selectedId = next.id;
            renderCatalogManager(container, moduleCell, state);
        }));
        controls.appendChild(button("Delete Part", function () {
            deleteCatalogPart(moduleCell, selected.id);
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
                input: { type: "barb", nominalSize: "3/4", method: "drip" },
                output: { type: "barb", nominalSize: "3/4", method: "drip" }
            },
            specs: { innerDiameterIn: 0.75, hazenWilliamsC: 150 }
        };
    }

    function buildCatalogPartForm(part, moduleCell) { // CHANGE
        const node = document.createElement("div");
        node.className = "trellis-irrigation-catalog-form";
        node.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px;";
        const fields = {};
        const connectorOptions = catalogConnectorOptions(moduleCell); // NEW
        fields.id = addTextField(node, "ID", part.id);
        fields.name = addTextField(node, "Name", part.name);
        fields.category = addSelectField(node, "Category", PART_CATEGORIES, part.category);
        fields.stockState = addSelectField(node, "Stock", VALID_STOCK_STATES, part.stockState);
        fields.cost = addTextField(node, "Cost", part.cost);
        fields.unitCost = addTextField(node, "Unit cost", part.unitCost);
        fields.inputs = addTextField(node, "Inputs", part.connectors.inputs);
        fields.outputs = addTextField(node, "Outputs", part.connectors.outputs);
        fields.inputType = addSelectField(node, "Input type", ensureOptionValue(connectorOptions.types, part.connectors.input.type), part.connectors.input.type); // CHANGE
        fields.inputSize = addSelectField(node, "Input size", ensureOptionValue(connectorOptions.sizes, part.connectors.input.nominalSize), part.connectors.input.nominalSize); // CHANGE
        fields.outputType = addSelectField(node, "Output type", ensureOptionValue(connectorOptions.types, part.connectors.output.type), part.connectors.output.type); // CHANGE
        fields.outputSize = addSelectField(node, "Output size", ensureOptionValue(connectorOptions.sizes, part.connectors.output.nominalSize), part.connectors.output.nominalSize); // CHANGE
        fields.method = addTextField(node, "Method", part.connectors.output.method || part.connectors.input.method);
        fields.maxFlowGpm = addTextField(node, "Max flow gpm", part.connectors.output.maxFlowGpm || part.specs.maxFlowGpm || "");
        fields.pressureLossPsi = addTextField(node, "Pressure loss psi", part.specs.pressureLossPsi || "");
        fields.flowGpm = addTextField(node, "Part flow gpm", part.specs.flowGpm || "");
        fields.operatingPressurePsi = addTextField(node, "Operating psi", part.specs.operatingPressurePsi || "");
        fields.innerDiameterIn = addTextField(node, "Pipe inner diameter in", part.specs.innerDiameterIn || "");
        fields.hazenWilliamsC = addTextField(node, "Hazen-Williams C", part.specs.hazenWilliamsC || "");
        return { node, fields };
    }

    function readCatalogPartForm(form) {
        const method = form.fields.method.value.trim();
        const maxFlowGpm = finiteNumber(form.fields.maxFlowGpm.value, null);
        return normalizeCatalogPart({
            id: sanitizeId(form.fields.id.value) || "part",
            name: form.fields.name.value.trim(),
            category: form.fields.category.value,
            stockState: form.fields.stockState.value,
            cost: finiteNumber(form.fields.cost.value, 0),
            unitCost: finiteNumber(form.fields.unitCost.value, finiteNumber(form.fields.cost.value, 0)),
            connectors: {
                inputs: finiteNumber(form.fields.inputs.value, 0),
                outputs: finiteNumber(form.fields.outputs.value, 0),
                input: { type: form.fields.inputType.value.trim(), nominalSize: form.fields.inputSize.value.trim(), method },
                output: { type: form.fields.outputType.value.trim(), nominalSize: form.fields.outputSize.value.trim(), method, maxFlowGpm }
            },
            specs: {
                maxFlowGpm,
                pressureLossPsi: finiteNumber(form.fields.pressureLossPsi.value, null),
                flowGpm: finiteNumber(form.fields.flowGpm.value, null),
                operatingPressurePsi: finiteNumber(form.fields.operatingPressurePsi.value, null),
                innerDiameterIn: finiteNumber(form.fields.innerDiameterIn.value, null),
                hazenWilliamsC: finiteNumber(form.fields.hazenWilliamsC.value, null)
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

    function addSelectField(parent, label, values, value) {
        const wrap = document.createElement("label");
        wrap.style.cssText = "display:flex;flex-direction:column;gap:3px;";
        wrap.textContent = label;
        const select = document.createElement("select");
        values.forEach(function (entry) {
            const option = document.createElement("option");
            option.value = entry;
            option.textContent = entry.replace(/_/g, " ");
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
        const connectionCounts = new Set(); // NEW
        (catalog.items || []).map(normalizeCatalogPart).forEach(function (part) { // NEW
            if (!part) return; // NEW
            broadIds.add(broadCategoryForCatalogCategory(part.category).id); // NEW
            catalogPartSizes(part).forEach(function (size) { sizes.add(size); }); // NEW
            connectionCounts.add(catalogPartConnectionCount(part)); // NEW
        }); // NEW
        return { // NEW
            broadCategories: BROAD_CATALOG_CATEGORIES.concat([{ id: "other", label: "Other", categories: [] }]).filter(function (entry) { return broadIds.has(entry.id); }), // NEW
            sizes: Array.from(sizes).sort(compareNominalSize), // NEW
            connectionCounts: Array.from(connectionCounts).sort(function (a, b) { return a - b; }) // NEW
        }; // NEW
    } // NEW

    function catalogPartMatchesFilters(part, state) { // NEW
        const p = normalizeCatalogPart(part); // NEW
        if (state.categoryFilter && p.category !== state.categoryFilter) return false; // NEW
        if (state.broadCategoryFilter && broadCategoryForCatalogCategory(p.category).id !== state.broadCategoryFilter) return false; // NEW
        if (state.sizeFilter && catalogPartSizes(p).indexOf(state.sizeFilter) < 0) return false; // NEW
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
        activeIrrigationMode = { // NEW
            moduleCell: targetModule, // NEW
            hud: null, // NEW
            navigator: [], // NEW
            targetHighlights: [], // NEW
            warningBadges: [], // NEW
            portBadges: [], // NEW
            selectedPorts: [], // NEW
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
        syncHudGraphState(targetModule); // NEW
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
        removeIrrigationModeListeners(session); // NEW
        activeIrrigationMode = null; // NEW
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
        if (assemblySelection.length) renderAssemblyPortBadges(session, assemblySelection); // NEW
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
        renderSelectedPortActions(session, hud); // NEW
        const actions = hudActions(); // NEW
        if (primaryAssembly && !connectedAssembly(primaryAssembly)) actions.appendChild(button("Reverse Assembly", function () { reverseAssembly(primaryAssembly); scheduleHudGraphStateSync(session.moduleCell); renderIrrigationMode(session); })); // NEW
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
        const type = addSelectField(form, "Connector", ensureOptionValue(connectorOptions.types, "ght"), "ght"); // CHANGE
        const size = addSelectField(form, "Size", ensureOptionValue(connectorOptions.sizes, "3/4"), "3/4"); // CHANGE
        const flow = addTextField(form, "Flow gpm", "5"); // NEW
        const pressure = addTextField(form, "Static psi", "45"); // NEW
        const commit = button("Commit Source", function () { // NEW
            const created = createSourceAssembly(session.moduleCell, label.value.trim() || "Water Source", { // CHANGE
                connectorType: type.value.trim(), // NEW
                nominalSize: size.value.trim(), // NEW
                method: "", // NEW
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
        const select = document.createElement("select"); // NEW
        sortCatalogParts(readCatalog(session.moduleCell).items.filter(function (part) { return part.category !== "pipe_tubing" && validateCatalogPart(part).ok; })).forEach(function (part) { // NEW
            appendSelectOption(select, part.id, part.name); // NEW
        }); // NEW
        form.appendChild(select); // NEW
        form.appendChild(button("Add Part", function () { // NEW
            const part = partById(readCatalog(session.moduleCell), select.value); // NEW
            if (!part) { session.message = "Choose a catalog part."; renderIrrigationMode(session); return; } // NEW
            const created = createPartAssembly(session.moduleCell, part, defaultAssemblyAnchor(session)); // NEW
            session.partPickerVisible = false; // NEW
            selectCell(created.assembly, false); // NEW
            scheduleHudGraphStateSync(session.moduleCell); // NEW
            renderIrrigationMode(session); // NEW
        })); // NEW
        hud.appendChild(form); // NEW
    } // NEW

    function renderSelectedPortActions(session, hud) { // NEW
        const ports = selectedValidPorts(session); // NEW
        if (!ports.length) { // NEW
            hud.appendChild(hudText("Select inlet/outlet badges to connect or disconnect assemblies.")); // NEW
            return; // NEW
        } // NEW
        const occupied = ports.filter(function (port) { return edgesForPort(session.moduleCell, port).length > 0; }); // NEW
        const free = ports.filter(function (port) { return isPortFree(session.moduleCell, port); }); // NEW
        const actions = hudActions(); // NEW
        if (occupied.length) actions.appendChild(button("Disconnect Selected", function () { disconnectSelectedPorts(session, occupied); })); // NEW
        if (free.length === 2) { // NEW
            const ordered = orderedConnectionPorts(free); // NEW
            if (ordered) { // NEW
                const direct = validatePortConnection(session.moduleCell, ordered.source, ordered.target); // NEW
                if (direct.ok) actions.appendChild(button("Connect", function () { connectSelectedPorts(session, ordered.source, ordered.target); })); // NEW
                else actions.appendChild(button("Bridge Connection", function () { session.bridgePorts = ordered; renderIrrigationMode(session); })); // NEW
            } // NEW
        } // NEW
        if (actions.childNodes.length) hud.appendChild(actions); // NEW
        if (session.bridgePorts && free.length === 2) renderBridgeSuggestions(session, hud, session.bridgePorts); // NEW
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
        session.message = result.ok ? "Assemblies connected." : result.reason; // NEW
        if (result.ok) session.selectedPorts = []; // NEW
        scheduleHudGraphStateSync(session.moduleCell); // NEW
        renderIrrigationMode(session); // NEW
    } // NEW

    function disconnectSelectedPorts(session, ports) { // NEW
        const seen = new Set(); // NEW
        const edges = []; // NEW
        ports.forEach(function (port) { // NEW
            edgesForPort(session.moduleCell, port).forEach(function (edge) { // NEW
                const id = getCellId(edge); // NEW
                if (!id || seen.has(id)) return; // NEW
                seen.add(id); // NEW
                edges.push(edge); // NEW
            }); // NEW
        }); // NEW
        model.beginUpdate && model.beginUpdate(); // NEW
        try { edges.forEach(removeCellFromParent); } finally { model.endUpdate && model.endUpdate(); } // NEW
        session.selectedPorts = []; // NEW
        session.message = edges.length ? "Selected connection badges disconnected." : "No selected connections were occupied."; // NEW
        scheduleHudGraphStateSync(session.moduleCell); // NEW
        renderIrrigationMode(session); // NEW
    } // NEW

    function renderBridgeSuggestions(session, hud, orderedPorts) { // NEW
        const suggestions = bridgeSuggestionsForPorts(session.moduleCell, orderedPorts.source, orderedPorts.target); // NEW
        if (!suggestions.length) { hud.appendChild(hudWarning("No bridge path found in the current catalog.")); return; } // NEW
        const wrap = document.createElement("div"); // NEW
        wrap.className = "trellis-irrigation-bridge-suggestions"; // NEW
        wrap.style.cssText = "display:flex;flex-direction:column;gap:5px;margin-top:6px;"; // NEW
        wrap.appendChild(hudText("Bridge Connection")); // NEW
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
        const targetRequirement = { connectorType: targetConnector.type, nominalSize: targetConnector.nominalSize, pipeType: targetConnector.pipeType || "", method: targetConnector.method || "" }; // NEW
        const items = sortCatalogParts(catalog.items).map(normalizeCatalogPart).filter(function (part) { return part && part.category !== "pipe_tubing" && validateCatalogPart(part).ok; }); // NEW
        const queue = [{ last: sourcePart, parts: [], seen: new Set(["source_port"]) }]; // NEW
        const results = []; // NEW
        while (queue.length && results.length < 40) { // NEW
            const state = queue.shift(); // NEW
            if (state.parts.length > 0 && connectorMatches(state.last.connectors.output, targetConnector, targetRequirement).ok) { // NEW
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
            const source = { cellId: getCellId(chain[i]), role: "output", index: 0 }; // NEW
            const target = { cellId: getCellId(chain[i + 1]), role: "input", index: 0 }; // NEW
            const result = createAssemblyConnection(session.moduleCell, source, target); // NEW
            if (!result.ok) { ok = false; session.message = result.reason; break; } // NEW
        } // NEW
        if (ok) { session.message = "Bridge connection applied."; session.selectedPorts = []; session.bridgePorts = null; } // NEW
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
        const connector = addSelectField(form, "Connector", ensureOptionValue(connectorOptions.types, profile.connectorType || "ght"), profile.connectorType || "ght"); // CHANGE
        const size = addSelectField(form, "Size", ensureOptionValue(connectorOptions.sizes, profile.nominalSize || "3/4"), profile.nominalSize || "3/4"); // CHANGE
        const flow = addTextField(form, "Flow gpm", profile.usableFlowGpm == null ? "" : profile.usableFlowGpm); // NEW
        const pressure = addTextField(form, "Static psi", profile.staticPressurePsi == null ? "" : profile.staticPressurePsi); // NEW
        const save = button("Save Source", function () { // NEW
            const next = normalizeEndpointProfile(Object.assign({}, profile, { // NEW
                connectorType: connector.value.trim(), // NEW
                nominalSize: size.value.trim(), // NEW
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
        const bedCell = isAssembly(assemblyCell) ? assemblyCell : findAssemblyAncestor(assemblyCell); // CHANGE
        if (!bedCell) return; // NEW
        const saved = safeJsonParse(getCellAttr(bedCell, ATTRS.BED_TEMPLATE_JSON, ""), null) || {}; // NEW
        const form = document.createElement("div"); // NEW
        form.className = "trellis-irrigation-bed-inlet-form"; // NEW
        form.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:8px 0;"; // NEW
        const templateSelect = addSelectField(form, "Template", BED_TEMPLATES.map(function (entry) { return entry.id; }), saved.templateId || BED_TEMPLATES[0].id); // NEW
        const partSelect = addSelectField(form, "Catalog part", sortCatalogParts(readCatalog(session.moduleCell).items).map(function (item) { return item.id; }), saved.partIds && saved.partIds[0] || ""); // CHANGE
        const rows = addTextField(form, "Rows", saved.spacing && saved.spacing.rows || "2"); // NEW
        const spacing = addTextField(form, "Emitter in", saved.spacing && saved.spacing.emitterInches || "12"); // NEW
        const apply = button("Apply Bed Layout", function () { // NEW
            const path = firstAssemblyPathForBedAssembly(session.moduleCell, bedCell) || { id: "assembly_bed_" + sanitizeId(getCellId(bedCell)), targetBedId: getCellAttr(bedCell, ATTRS.LINKED_BED_ID, getCellId(bedCell) || "") }; // CHANGE
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

    function renderAssemblyPortBadges(session, selectedCells) { // NEW
        const cells = portBadgeCellsForSelection(selectedCells); // NEW
        cells.forEach(function (cell) { // NEW
            ["input", "output"].forEach(function (role) { // NEW
                const count = portCapacityForCell(session.moduleCell, cell, role); // NEW
                for (let i = 0; i < count; i++) renderPortBadge(session, cell, role, i); // NEW
            }); // NEW
        }); // NEW
        renderBedAssemblyResizeBadges(session, selectedCells); // NEW
    } // NEW

    function portBadgeCellsForSelection(selectedCells) { // NEW
        const seen = new Set(); // NEW
        const out = []; // NEW
        (selectedCells || []).forEach(function (cell) { // NEW
            const cells = isAssembly(cell) ? [firstAssemblyPart(cell), lastAssemblyPart(cell)] : [cell]; // NEW
            cells.forEach(function (partCell) { // NEW
                if (!partCell || !isAssemblyPartCell(partCell)) return; // NEW
                const id = getCellId(partCell); // NEW
                if (!id || seen.has(id)) return; // NEW
                seen.add(id); // NEW
                out.push(partCell); // NEW
            }); // NEW
        }); // NEW
        return out; // NEW
    } // NEW

    function renderPortBadge(session, cell, role, index) { // NEW
        const port = { cellId: getCellId(cell), role, index }; // NEW
        const occupied = edgesForPort(session.moduleCell, port).length > 0; // NEW
        const selected = (session.selectedPorts || []).map(portKey).indexOf(portKey(port)) >= 0; // NEW
        const badge = document.createElement("button"); // NEW
        badge.type = "button"; // NEW
        badge.className = "trellis-irrigation-port-badge"; // NEW
        badge.textContent = (role === "input" ? "I" : "O") + (index + 1); // NEW
        badge.title = (role === "input" ? "Inlet" : "Outlet") + " " + (index + 1) + (occupied ? " connected" : " free"); // NEW
        badge.style.cssText = "position:absolute;z-index:1002;width:" + PORT_BADGE_SIZE + "px;height:" + PORT_BADGE_SIZE + "px;padding:0;border:1px solid " + (selected ? "#1d4ed8" : "#555") + ";border-radius:4px;background:" + (occupied ? "#dbeafe" : "#fff") + ";box-shadow:0 1px 4px rgba(0,0,0,.18);font:bold 10px Arial,sans-serif;cursor:pointer;"; // NEW
        positionPortBadge(badge, cell, role, index); // NEW
        badge.addEventListener("click", function (ev) { // NEW
            if (ev && ev.stopPropagation) ev.stopPropagation(); // NEW
            toggleSelectedPort(session, port); // NEW
            session.bridgePorts = null; // NEW
            renderIrrigationMode(session); // NEW
        }); // NEW
        appendOverlayNode(badge); // NEW
        session.portBadges.push(badge); // NEW
    } // NEW

    function positionPortBadge(node, cell, role, index) { // NEW
        const state = cellState(cell); // NEW
        const x = role === "input" ? state.x - PORT_BADGE_SIZE - 4 : state.x + state.width + 4; // NEW
        const y = state.y + 4 + index * (PORT_BADGE_SIZE + 4); // NEW
        node.style.left = Math.round(x) + "px"; // NEW
        node.style.top = Math.round(y) + "px"; // NEW
    } // NEW

    function toggleSelectedPort(session, port) { // NEW
        const key = portKey(port); // NEW
        const existing = (session.selectedPorts || []).map(portKey).indexOf(key); // NEW
        if (existing >= 0) session.selectedPorts.splice(existing, 1); // NEW
        else session.selectedPorts.push(normalizePort(port)); // NEW
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
        if (!assembly || connectedAssembly(assembly)) return; // NEW
        const parts = assemblyPartCells(assembly); // NEW
        const ys = parts.map(function (cell) { return finiteNumber((getGeometry(cell) || {}).y, 0); }).sort(function (a, b) { return a - b; }); // NEW
        model.beginUpdate && model.beginUpdate(); // NEW
        try { // NEW
            parts.forEach(function (cell, index) { setGeometry(cell, { y: ys[ys.length - 1 - index] }); }); // NEW
        } finally { model.endUpdate && model.endUpdate(); } // NEW
    } // NEW

    function deleteAssemblySelection(session, selected) { // NEW
        const assemblies = []; // NEW
        const seen = new Set(); // NEW
        (selected || []).forEach(function (cell) { // NEW
            const assembly = isAssembly(cell) ? cell : findAssemblyAncestor(cell); // NEW
            const id = getCellId(assembly); // NEW
            if (!assembly || !id || seen.has(id)) return; // NEW
            seen.add(id); // NEW
            assemblies.push(assembly); // NEW
        }); // NEW
        model.beginUpdate && model.beginUpdate(); // NEW
        try { // NEW
            assemblies.forEach(function (assembly) { // NEW
                assemblyPartCells(assembly).forEach(function (part) { incomingAssemblyEdges(session.moduleCell, part).concat(outgoingAssemblyEdges(session.moduleCell, part)).forEach(removeCellFromParent); }); // NEW
                removeCellFromParent(assembly); // NEW
            }); // NEW
            selectCell(session.moduleCell, false); // NEW
        } finally { model.endUpdate && model.endUpdate(); } // NEW
        session.selectedPorts = []; // NEW
        scheduleHudGraphStateSync(session.moduleCell); // NEW
        renderIrrigationMode(session); // NEW
    } // NEW

    function appendModuleSummary(session, hud) { // NEW
        const summary = readDashboardSummary(session.moduleCell); // NEW
        const text = summary ? "Irrigated " + Math.round(summary.percentIrrigated || 0) + "%, completeness " + Math.round(summary.completeness || 0) + "%, warnings " + (summary.criticalWarningCount || 0) + "." : "Select a source, part, or bed inlet to work in the diagram."; // NEW
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
            const direct = connectorMatches(endpointProfileAsConnector(endpointProfile(source)), endpointProfileAsConnector(endpointProfile(target)), endpointProfile(target)); // NEW
            return direct.ok ? direct : { ok: false, reason: "Source endpoint cannot connect directly to bed inlet: " + direct.reason }; // NEW
        } // NEW
        if (sourcePart && targetPart) return canConnectParts(sourcePart, targetPart, endpointType(target) === "bed" ? endpointProfile(target) : null); // NEW
        if (sourcePart && endpointType(target) === "bed") return canPartReachEndpoint(sourcePart, endpointProfile(target)); // NEW
        return { ok: false, reason: "Unsupported irrigation connection." }; // NEW
    } // NEW

    function endpointProfileAsConnector(profile) { // NEW
        return { type: profile.connectorType, nominalSize: profile.nominalSize, pipeType: profile.pipeType || "", method: profile.method || "" }; // NEW
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
        return isEndpoint(cell) || getCellAttr(cell, ATTRS.COMPONENT, "") === "1"; // NEW
    } // NEW

    function isHudPipeEdge(cell) { // NEW
        return !!cell && !isLegacyGenerated(cell) && getCellAttr(cell, ATTRS.PIPE_EDGE, "") === "1"; // NEW
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
        if (endpointType(cell) === "source") return outgoingHudEdges(moduleCell, cell).length ? "" : "Source has no downstream irrigation tree."; // NEW
        if (!hasSourceRoute(moduleCell, cell)) return "Disconnected irrigation object."; // CHANGE
        const validation = incomingHudEdges(moduleCell, cell)[0]; // NEW
        if (validation && !validateHudCompatibility(moduleCell, validation.source, cell).ok) return "Incoming connection is incompatible."; // NEW
        return ""; // NEW
    } // NEW

    function hasSourceRoute(moduleCell, cell) { // NEW
        let cur = cell; // NEW
        const seen = new Set(); // NEW
        while (cur) { // NEW
            const id = getCellId(cur); // NEW
            if (!id || seen.has(id)) return false; // NEW
            if (endpointType(cur) === "source") return true; // NEW
            seen.add(id); // NEW
            const incoming = incomingHudEdges(moduleCell, cur)[0]; // NEW
            cur = incoming && incoming.source; // NEW
        } // NEW
        return false; // NEW
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
                path.bedDemand = template.demand || null; // NEW
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
        collectDescendants(moduleCell, function (cell) { return isEndpoint(cell) && endpointType(cell) === "bed" && assemblyType(findAssemblyAncestor(cell)) === "bed"; }).forEach(function (bedEndpoint) { // NEW
            const route = routeAssemblyToSource(moduleCell, bedEndpoint); // NEW
            if (!route || !route.source) return; // NEW
            const bedAssembly = findAssemblyAncestor(bedEndpoint); // NEW
            const linkedBedId = getCellAttr(bedAssembly, ATTRS.LINKED_BED_ID, getCellId(bedAssembly) || ""); // NEW
            const cellIds = route.cells.map(getCellId).filter(Boolean); // NEW
            const partIds = route.cells.filter(function (cell) { return getCellAttr(cell, ATTRS.COMPONENT, "") === "1"; }).map(function (cell) { return getCellAttr(cell, ATTRS.CATALOG_PART_ID, ""); }).filter(Boolean); // NEW
            const pipeIds = route.edges.map(getCellId).filter(Boolean); // NEW
            const pipePartIds = route.edges.map(function (edge) { return getCellAttr(edge, ATTRS.PIPE_PART_ID, ""); }).filter(Boolean); // NEW
            const path = stagePath({ // NEW
                id: "assembly_" + sanitizeId(getCellId(route.source) + "_" + getCellId(bedEndpoint)), // NEW
                sourceEndpoint: route.source, // NEW
                targetEndpoint: bedEndpoint, // NEW
                targetBedId: linkedBedId, // NEW
                branchpointIds: route.cells.filter(function (cell) { return BRANCH_CATEGORIES.has(getCellAttr(cell, ATTRS.COMPONENT_TYPE, "")); }).map(getCellId).filter(Boolean), // NEW
                partIds, // NEW
                pipePartId: pipePartIds[0] || "" // NEW
            }); // NEW
            path.componentCellIds = cellIds.filter(function (id) { // NEW
                const cell = findCellById(moduleCell, id); // NEW
                return cell && getCellAttr(cell, ATTRS.COMPONENT, "") === "1"; // NEW
            }); // NEW
            path.pipeEdgeIds = pipeIds; // NEW
            path.pipePartIds = pipePartIds; // NEW
            const template = safeJsonParse(getCellAttr(bedAssembly, ATTRS.BED_TEMPLATE_JSON, ""), null); // NEW
            if (template) { // NEW
                path.bedTemplateCommitted = true; // NEW
                path.bedTemplate = template; // NEW
                path.bedDemand = template.demand || null; // NEW
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
            if (!incoming) return null; // NEW
            edges.push(incoming); // NEW
            cur = incoming.source; // NEW
        } // NEW
        return null; // NEW
    } // NEW

    function syncHudGraphState(moduleCell) { // NEW
        const paths = deriveAssemblyPaths(moduleCell); // CHANGE
        writePaths(moduleCell, paths); // NEW
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
        return deriveAssemblyPaths(moduleCell).find(function (path) { return path.targetEndpointId === getCellId(firstAssemblyPart(bedAssembly)); }) || null; // NEW
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
        openIrrigationMode, // NEW
        closeIrrigationMode, // NEW
        openCatalogManager,
        __test: {
            normalizeCatalogPart,
            normalizeEndpointProfile,
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
            createSourceAssembly, // NEW
            createPartAssembly, // NEW
            createBedAssembly, // NEW
            createAssemblyConnection, // NEW
            validatePortConnection, // NEW
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
            validateHudConnection // NEW
        }
    };

    if (typeof window !== "undefined") {
        window.TrellisIrrigationPlanner = graph.__trellisIrrigationPlanner;
    }

    addActionAndMenus();
});
