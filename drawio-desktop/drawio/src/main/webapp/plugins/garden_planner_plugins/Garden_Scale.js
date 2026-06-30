/**
 * Draw.io Plugin: Selection Scale Overlay (Garden Beds + Tiler Groups)
 *
 * Shows one compact unit-aware dimension chip for selected garden beds
 * (garden_bed=1) and tiler groups (tiler_group=1). The chip uses the nearest
 * garden module's unit_system setting, and the same formatter is reused for
 * draw.io's built-in resize hint while garden beds/groups are resized.
 *
 * If a plant circle (plant_tiler=1) is selected, the overlay is shown for its
 * tiler group ancestor.
**/
Draw.loadPlugin(function (ui) {
    const graph = ui && ui.editor && ui.editor.graph;
    if (!graph) return;

    // Prevent double install on the same graph instance. // CHANGE
    if (graph.__gardenScaleOverlayInstalled) return;
    graph.__gardenScaleOverlayInstalled = true;

    // -------------------- Config --------------------
    const PX_PER_CM = 5;
    const DRAW_SCALE = 0.18;
    const CM_PER_FOOT = 30.48; // NEW
    const CM_PER_INCH = 2.54; // NEW

    const MAX_OVERLAYS = 6; // cap to avoid clutter
    const OVERLAY_PADDING = "3px 7px"; // CHANGE
    const OVERLAY_FONT = "12px";
    const OVERLAY_Z = 999;
    const CHIP_Y_OFFSET = 8; // px below rotated bounds, matching draw.io hint intent. // NEW

    const GROUP_LABEL_FONT_PX = 12;
    const GROUP_LABEL_LINE_HEIGHT = 1.25;
    const GROUP_LABEL_BAND_PAD_PX = 6;
    const GROUP_LABEL_BAND_PX = Math.ceil(
        GROUP_LABEL_FONT_PX * GROUP_LABEL_LINE_HEIGHT + GROUP_LABEL_BAND_PAD_PX
    );

    // -------------------- Cell classification --------------------
    function isGardenBed(cell) { // CHANGE
        return !!cell && cell.getAttribute && (
            cell.getAttribute("garden_bed") === "1" ||
            cell.getAttribute("gardenBed") === "1" ||
            cell.getAttribute("is_garden_bed") === "1"
        );
    }

    function isPlantCircle(cell) {
        return !!cell && cell.getAttribute && cell.getAttribute("plant_tiler") === "1";
    }

    function isTilerGroup(cell) {
        return !!cell && cell.getAttribute && cell.getAttribute("tiler_group") === "1";
    }

    function isGardenModule(cell) { // NEW
        return !!cell && cell.getAttribute && cell.getAttribute("garden_module") === "1";
    }

    function getModelParent(cell) { // NEW
        return model && model.getParent ? model.getParent(cell) : null;
    }

    function getCellId(cell) { // NEW
        return cell && cell.getId ? cell.getId() : (cell && cell.id);
    }

    function findTilerGroupAncestor(cell) { // CHANGE
        let cur = cell;
        while (cur) {
            if (isTilerGroup(cur)) return cur;
            cur = getModelParent(cur);
        }
        return null;
    }

    function findGardenModuleAncestor(cell) { // NEW
        let cur = cell;
        while (cur) {
            if (isGardenModule(cur)) return cur;
            cur = getModelParent(cur);
        }
        return null;
    }

    // -------------------- Internal state --------------------
    const model = graph.getModel && graph.getModel();
    if (!model) return;

    const overlaysByCellId = new Map(); // cellId -> { div, cell } // CHANGE
    const activeResizeCellIds = new Set(); // cell ids whose persistent chip should be hidden. // NEW

    // -------------------- Unit conversion and formatting --------------------
    function unitsToCm(units) {
        return Number(units) / (PX_PER_CM * DRAW_SCALE);
    }

    function normalizeUnitSystem(units) { // NEW
        return String(units || "").trim() === "imperial" ? "imperial" : "metric";
    }

    function resolveUnitSystem(cell) { // NEW
        const moduleCell = findGardenModuleAncestor(cell);
        return normalizeUnitSystem(moduleCell && moduleCell.getAttribute ? moduleCell.getAttribute("unit_system") : "");
    }

    function formatMetricLengthCm(cm) { // CHANGE
        if (!Number.isFinite(cm)) return "?";
        if (cm < 100) return `${cm.toFixed(1)} cm`;
        return `${(cm / 100).toFixed(2)} m`;
    }

    function formatImperialLengthCm(cm) { // NEW
        if (!Number.isFinite(cm)) return "?";
        const totalInches = Math.max(0, Math.round(cm / CM_PER_INCH));
        const feet = Math.floor(totalInches / 12);
        const inches = totalInches % 12;
        return `${feet} ft ${inches} in`;
    }

    function formatLengthCm(cm, unitSystem) { // CHANGE
        return normalizeUnitSystem(unitSystem) === "imperial"
            ? formatImperialLengthCm(cm)
            : formatMetricLengthCm(cm);
    }

    function getMeasuredGeometryUnits(cell, bounds) { // NEW
        const source = bounds || (cell && cell.getGeometry ? cell.getGeometry() : null);
        if (!source) return null;

        return {
            width: Number(source.width),
            height: isTilerGroup(cell)
                ? Math.max(0, Number(source.height) - GROUP_LABEL_BAND_PX)
                : Number(source.height)
        };
    }

    function formatDimensionsFromUnits(widthUnits, heightUnits, cell) { // NEW
        const unitSystem = resolveUnitSystem(cell);
        return `${formatLengthCm(unitsToCm(widthUnits), unitSystem)} x ${formatLengthCm(unitsToCm(heightUnits), unitSystem)}`;
    }

    function formatCellDimensions(cell, bounds) { // NEW
        const measured = getMeasuredGeometryUnits(cell, bounds);
        if (!measured) return "";
        return formatDimensionsFromUnits(measured.width, measured.height, cell);
    }

    // -------------------- Target resolution --------------------
    function resolveTargetCellForOverlay(cell) { // CHANGE
        if (!cell) return null;
        if (isGardenBed(cell)) return cell;
        if (isTilerGroup(cell)) return cell;
        if (isPlantCircle(cell)) return findTilerGroupAncestor(cell);
        return null;
    }

    function uniqueById(cells) {
        const seen = new Set();
        const out = [];
        for (const c of cells) {
            const id = getCellId(c);
            if (!id || seen.has(id)) continue;
            seen.add(id);
            out.push(c);
        }
        return out;
    }

    // -------------------- DOM overlay creation --------------------
    function ensureOverlayContainer() { // CHANGE
        const c = graph.container;
        if (!c) return;

        const cs = window.getComputedStyle ? window.getComputedStyle(c) : null;
        if (cs && cs.position === "static") {
            c.style.position = "relative";
        }
    }

    function createOverlayDiv() {
        const div = document.createElement("div");
        div.style.position = "absolute";
        div.style.pointerEvents = "none";
        div.style.zIndex = String(OVERLAY_Z);
        div.style.padding = OVERLAY_PADDING;
        div.style.fontSize = OVERLAY_FONT;
        div.style.borderRadius = "6px";
        div.style.whiteSpace = "nowrap";
        div.style.background = "rgba(0,0,0,0.75)";
        div.style.color = "#fff";
        div.style.boxShadow = "0 1px 3px rgba(0,0,0,0.35)";
        div.style.lineHeight = "16px"; // NEW
        return div;
    }

    // -------------------- Rotation and placement helpers --------------------
    function getRotationDeg(cell) {
        const style = graph.getCellStyle ? (graph.getCellStyle(cell) || {}) : {};
        const key = (typeof mxConstants !== "undefined" && mxConstants.STYLE_ROTATION) ? mxConstants.STYLE_ROTATION : "rotation"; // CHANGE
        const r = style[key] != null ? style[key] : style.rotation;
        const n = Number(r);
        return Number.isFinite(n) ? n : 0;
    }

    function getRotatedBounds(bounds, rotationDeg) { // NEW
        if (typeof mxUtils !== "undefined" && mxUtils.getBoundingBox) {
            return mxUtils.getBoundingBox(bounds, rotationDeg) || bounds;
        }
        return bounds;
    }

    function positionOverlayDiv(entry) { // CHANGE
        const cell = entry.cell;
        const state = graph.view && graph.view.getState ? graph.view.getState(cell) : null;
        if (!state) return false;

        const text = formatCellDimensions(cell);
        if (!text) return true;

        const cellId = getCellId(cell);
        const hiddenForResize = cellId && activeResizeCellIds.has(cellId);
        entry.div.textContent = text;
        entry.div.style.display = hiddenForResize ? "none" : "";
        if (hiddenForResize) return true;

        const bounds = {
            x: Number(state.x) || 0,
            y: Number(state.y) || 0,
            width: Number(state.width) || 0,
            height: Number(state.height) || 0
        };
        const bb = getRotatedBounds(bounds, getRotationDeg(cell));
        const chipWidth = entry.div.clientWidth || entry.div.offsetWidth || 0;

        entry.div.style.left = `${Math.round(bb.x + (bb.width - chipWidth) / 2)}px`;
        entry.div.style.top = `${Math.round(bb.y + bb.height + CHIP_Y_OFFSET)}px`;
        return true;
    }

    // -------------------- Overlay lifecycle --------------------
    function removeOverlayForCellId(cellId) {
        const entry = overlaysByCellId.get(cellId);
        if (!entry) return;
        try {
            if (entry.div && entry.div.parentNode) entry.div.parentNode.removeChild(entry.div); // CHANGE
        } finally {
            overlaysByCellId.delete(cellId);
        }
    }

    function clearAllOverlays() {
        for (const cellId of Array.from(overlaysByCellId.keys())) {
            removeOverlayForCellId(cellId);
        }
    }

    function syncOverlaysToSelection() {
        ensureOverlayContainer();
        if (!graph.container) return;

        const sel = graph.getSelectionCells ? graph.getSelectionCells() : [];
        const targetsRaw = [];

        for (const cell of sel) {
            const t = resolveTargetCellForOverlay(cell);
            if (t) targetsRaw.push(t);
        }

        const targets = uniqueById(targetsRaw).slice(0, MAX_OVERLAYS);
        const keepIds = new Set(targets.map(getCellId));

        for (const existingId of Array.from(overlaysByCellId.keys())) {
            if (!keepIds.has(existingId)) removeOverlayForCellId(existingId);
        }

        for (const cell of targets) {
            const id = getCellId(cell);
            if (!id) continue;

            let entry = overlaysByCellId.get(id);
            if (!entry) {
                entry = { div: createOverlayDiv(), cell }; // CHANGE
                graph.container.appendChild(entry.div);
                overlaysByCellId.set(id, entry);
            } else {
                entry.cell = cell;
            }

            positionOverlayDiv(entry);
        }
    }

    function refreshOverlayPositions() {
        for (const [cellId, entry] of overlaysByCellId.entries()) {
            const ok = positionOverlayDiv(entry);
            if (!ok) removeOverlayForCellId(cellId);
        }
    }

    // -------------------- Resize hint integration --------------------
    function isResizeHandleIndex(index) { // NEW
        if (index == null || typeof mxEvent === "undefined") return false;
        if (index === mxEvent.LABEL_HANDLE || index === mxEvent.ROTATION_HANDLE) return false;
        if (mxEvent.CUSTOM_HANDLE != null && index <= mxEvent.CUSTOM_HANDLE) return false;
        return true;
    }

    function getHandlerTargetCell(handler) { // NEW
        return handler && handler.state ? resolveTargetCellForOverlay(handler.state.cell) : null;
    }

    function markResizeTarget(handler, hidden) { // NEW
        const target = getHandlerTargetCell(handler);
        const id = getCellId(target);
        if (!id) return;

        if (hidden) activeResizeCellIds.add(id);
        else activeResizeCellIds.delete(id);

        refreshOverlayPositions();
    }

    function getHintBoundsForHandler(handler, target) { // NEW
        const raw = handler && handler.unscaledBounds
            ? handler.unscaledBounds
            : (handler && handler.bounds && handler.graph && handler.graph.view && handler.graph.view.scale
                ? {
                    width: handler.bounds.width / handler.graph.view.scale,
                    height: handler.bounds.height / handler.graph.view.scale
                }
                : null);

        return raw ? getMeasuredGeometryUnits(target, raw) : null;
    }

    function replaceResizeHintText(handler) { // NEW
        const target = getHandlerTargetCell(handler);
        if (!target || !handler || !handler.hint || !isResizeHandleIndex(handler.index)) return;

        const measured = getHintBoundsForHandler(handler, target);
        if (!measured) return;

        handler.hint.innerHTML = formatDimensionsFromUnits(measured.width, measured.height, target);
    }

    function installResizeHintWrapper() { // NEW
        if (typeof mxVertexHandler === "undefined" || !mxVertexHandler.prototype) return;
        if (mxVertexHandler.prototype.__gardenScaleHintInstalled) return;
        mxVertexHandler.prototype.__gardenScaleHintInstalled = true;

        const originalMouseDown = mxVertexHandler.prototype.mouseDown;
        const originalMouseUp = mxVertexHandler.prototype.mouseUp;
        const originalReset = mxVertexHandler.prototype.reset;
        const originalUpdateHint = mxVertexHandler.prototype.updateHint;

        mxVertexHandler.prototype.mouseDown = function (sender, me) { // NEW
            const controller = this.graph && this.graph.__gardenScaleController; // NEW
            const handle = this.getHandleForEvent ? this.getHandleForEvent(me) : null;
            const shouldHideChip = !!controller && !!controller.getHandlerTargetCell(this) && controller.isResizeHandleIndex(handle); // CHANGE
            if (shouldHideChip) controller.markResizeTarget(this, true); // CHANGE
            return originalMouseDown.apply(this, arguments);
        };

        mxVertexHandler.prototype.mouseUp = function (sender, me) { // NEW
            const controller = this.graph && this.graph.__gardenScaleController; // NEW
            try {
                return originalMouseUp.apply(this, arguments);
            } finally {
                if (controller) controller.markResizeTarget(this, false); // CHANGE
            }
        };

        mxVertexHandler.prototype.reset = function () { // NEW
            const controller = this.graph && this.graph.__gardenScaleController; // NEW
            try {
                return originalReset.apply(this, arguments);
            } finally {
                if (controller) controller.markResizeTarget(this, false); // CHANGE
            }
        };

        mxVertexHandler.prototype.updateHint = function (me) { // NEW
            originalUpdateHint.apply(this, arguments);
            const controller = this.graph && this.graph.__gardenScaleController; // NEW
            if (controller) controller.replaceResizeHintText(this); // CHANGE
        };
    }

    graph.__gardenScaleController = { // NEW
        getHandlerTargetCell,
        isResizeHandleIndex,
        markResizeTarget,
        replaceResizeHintText
    };

    // -------------------- Test surface --------------------
    window.TrellisGardenScale = window.TrellisGardenScale || {}; // NEW
    window.TrellisGardenScale._test = { // NEW
        unitsToCm,
        formatLengthCm,
        formatMetricLengthCm,
        formatImperialLengthCm,
        formatCellDimensions,
        formatDimensionsFromUnits,
        getMeasuredGeometryUnits,
        resolveUnitSystem,
        resolveTargetCellForOverlay,
        findGardenModuleAncestor,
        isResizeHandleIndex,
        replaceResizeHintText,
        markResizeTarget,
        refreshOverlayPositions,
        activeResizeCellIds
    };

    // -------------------- Event wiring --------------------
    installResizeHintWrapper(); // NEW

    graph.getSelectionModel().addListener(mxEvent.CHANGE, function () {
        syncOverlaysToSelection();
    });

    graph.view.addListener(mxEvent.SCALE, function () {
        refreshOverlayPositions();
    });
    graph.view.addListener(mxEvent.TRANSLATE, function () {
        refreshOverlayPositions();
    });
    graph.view.addListener(mxEvent.SCALE_AND_TRANSLATE, function () {
        refreshOverlayPositions();
    });

    if (graph.container && graph.container.addEventListener) { // CHANGE
        graph.container.addEventListener("scroll", function () {
            refreshOverlayPositions();
        }, { passive: true });
    }

    model.addListener(mxEvent.CHANGE, function () {
        refreshOverlayPositions();
    });

    graph.addListener(mxEvent.DESTROY, function () {
        clearAllOverlays();
    });

    syncOverlaysToSelection();
});
