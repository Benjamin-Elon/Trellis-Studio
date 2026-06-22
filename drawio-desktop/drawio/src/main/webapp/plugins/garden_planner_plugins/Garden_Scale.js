/**
 * Draw.io Plugin: Selection Scale Overlay (Garden Beds + Tiler Groups)
 *
 * Shows a small overlay on selected garden beds (garden_bed=1) and tiler groups (tiler_group=1)
 * with width/height converted to cm (and m when large).
 *
 * If a plant circle (plant_tiler=1) is selected, the overlay is shown for its tiler group ancestor.
**/
Draw.loadPlugin(function (ui) {
    const graph = ui && ui.editor && ui.editor.graph;
    if (!graph) return;

    // Prevent double install
    if (graph.__gardenScaleOverlayInstalled) return;
    graph.__gardenScaleOverlayInstalled = true;

    // -------------------- Config --------------------
    const PX_PER_CM = 5;
    const DRAW_SCALE = 0.18;

    const MAX_OVERLAYS = 6;               // cap to avoid clutter
    const OVERLAY_PADDING = "2px 6px";
    const OVERLAY_FONT = "12px";
    const OVERLAY_Z = 999;

    const OVERLAY_W_Y_OFFSET = 25;        // px above top edge (width label) // NEW
    const OVERLAY_W_X_OFFSET = 20;         // px from left edge (width label) // NEW
    const OVERLAY_H_X_OFFSET = 70;        // px left of left edge (height label) // NEW
    const OVERLAY_H_Y_OFFSET = 10;         // px from top edge (height label) // NEW    

    const GROUP_LABEL_FONT_PX = 12;
    const GROUP_LABEL_LINE_HEIGHT = 1.25;
    const GROUP_LABEL_BAND_PAD_PX = 6;
    const GROUP_LABEL_BAND_PX = Math.ceil(
        GROUP_LABEL_FONT_PX * GROUP_LABEL_LINE_HEIGHT + GROUP_LABEL_BAND_PAD_PX
    );

    // -------------------- Reused helpers (provided) --------------------
    function isGardenBed(cell) {
        return !!cell && cell.getAttribute && cell.getAttribute("garden_bed") === "1";
    }

    function isPlantCircle(cell) {
        return !!cell && cell.getAttribute && cell.getAttribute("plant_tiler") === "1";
    }

    function isTilerGroup(cell) {
        const ok = !!cell && cell.getAttribute && cell.getAttribute("tiler_group") === "1";
        return ok;
    }

    function findTilerGroupAncestor(graph, cell) {
        const model = graph.getModel();
        let cur = cell;
        while (cur) {
            if (isTilerGroup(cur)) return cur;
            cur = model.getParent(cur);
        }
        return null;
    }

    // -------------------- Internal state --------------------
    const model = graph.getModel();
    const overlaysByCellId = new Map(); // cellId -> { wDiv, hDiv, cell } // CHANGE


    // -------------------- Unit conversion --------------------
    function unitsToCm(units) {
        return Number(units) / (PX_PER_CM * DRAW_SCALE);
    }

    function formatLengthCm(cm) {
        if (!Number.isFinite(cm)) return "?";
        if (cm < 100) return `${cm.toFixed(1)} cm`;            // CHANGE
        return `${(cm / 100).toFixed(2)} m`;                   // CHANGE
    }
    

    // -------------------- Target resolution --------------------
    function resolveTargetCellForOverlay(cell) {
        if (!cell) return null;

        if (isGardenBed(cell)) return cell;
        if (isTilerGroup(cell)) return cell;

        if (isPlantCircle(cell)) {
            return findTilerGroupAncestor(graph, cell);
        }

        return null;
    }

    function uniqueById(cells) {
        const seen = new Set();
        const out = [];
        for (const c of cells) {
            const id = c && c.getId && c.getId();
            if (!id || seen.has(id)) continue;
            seen.add(id);
            out.push(c);
        }
        return out;
    }

    // -------------------- DOM overlay creation --------------------
    function ensureOverlayDiv() {
        // ensure container is positionable
        const c = graph.container;
        if (!c) return;

        const cs = window.getComputedStyle(c);
        if (cs.position === "static") {
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
        return div;
    }
    
    function setOverlayTexts(wDiv, hDiv, wUnits, hUnits) {                       // NEW
        const wCm = unitsToCm(wUnits);                                           // NEW
        const hCm = unitsToCm(hUnits);                                           // NEW
    
        wDiv.textContent = `W: ${formatLengthCm(wCm)}`;                          // NEW
        hDiv.textContent = `H: ${formatLengthCm(hCm)}`;                          // NEW
    }                                                                            // NEW
    
    // -------------------- Rotation helpers -------------------- // NEW
function toRad(deg) { return (Number(deg) || 0) * Math.PI / 180; } // NEW

function getRotationDeg(cell) {                                   // NEW
    const style = graph.getCellStyle(cell) || {};                 // NEW
    // mxGraph typically stores in mxConstants.STYLE_ROTATION ("rotation") // NEW
    const r = (style[mxConstants.STYLE_ROTATION] != null)         // NEW
        ? style[mxConstants.STYLE_ROTATION]                       // NEW
        : style.rotation;                                         // NEW
    const n = Number(r);                                          // NEW
    return Number.isFinite(n) ? n : 0;                             // NEW
}                                                                 // NEW

function rotatePoint(px, py, cx, cy, angRad) {                    // NEW
    const dx = px - cx;                                           // NEW
    const dy = py - cy;                                           // NEW
    const cos = Math.cos(angRad);                                 // NEW
    const sin = Math.sin(angRad);                                 // NEW
    return {                                                      // NEW
        x: cx + dx * cos - dy * sin,                               // NEW
        y: cy + dx * sin + dy * cos                                // NEW
    };                                                            // NEW
}                                                                 // NEW

function addVec(p, vx, vy) {                                      // NEW
    return { x: p.x + vx, y: p.y + vy };                           // NEW
}                                                                 // NEW


function positionOverlayDivs(wDiv, hDiv, cell) {                  // CHANGE
    const state = graph.view.getState(cell);
    if (!state) return false;

    const geo = cell.getGeometry ? cell.getGeometry() : null;
    if (!geo) return true;

    // --- compute measurement units (unchanged) ---
    const wUnits = geo.width;
    const hUnits = isTilerGroup(cell)
        ? Math.max(0, geo.height - GROUP_LABEL_BAND_PX)
        : geo.height;

    setOverlayTexts(wDiv, hDiv, wUnits, hUnits);

    // --- build the rectangle in VIEW coords that we want to anchor to ---
    // state.x/y/width/height are view coords for the bounding box.          // NEW
    let rx = state.x;                                                    // NEW
    let ry = state.y;                                                    // NEW
    let rw = state.width;                                                // NEW
    let rh = state.height;                                               // NEW

    // If tiler group has a top label band, exclude it from the measurement rect. // NEW
    if (isTilerGroup(cell)) {                                            // NEW
        ry = state.y + GROUP_LABEL_BAND_PX;                               // NEW (assumes band at top)
        rh = Math.max(0, state.height - GROUP_LABEL_BAND_PX);             // NEW
    }                                                                     // NEW

    // Center for rotation (use full state bounds center for stability).    // NEW
    const cx = state.x + state.width / 2;                                  // NEW
    const cy = state.y + state.height / 2;                                 // NEW

    const rotDeg = getRotationDeg(cell);                                   // NEW
    const a = toRad(rotDeg);                                               // NEW

    // Midpoints of top edge and left edge (in unrotated rect coords).      // NEW
    const topMid = { x: rx + rw / 2, y: ry };                              // NEW
    const leftMid = { x: rx, y: ry + rh / 2 };                             // NEW

    // Rotate these anchor points around (cx, cy).                           // NEW
    const topMidR = rotatePoint(topMid.x, topMid.y, cx, cy, a);            // NEW
    const leftMidR = rotatePoint(leftMid.x, leftMid.y, cx, cy, a);         // NEW

    // Edge tangents in rotated frame:
    // Top edge tangent points "right" along the edge; left edge tangent points "down". // NEW
    const topT = { x: Math.cos(a), y: Math.sin(a) };                        // NEW
    const leftT = { x: -Math.sin(a), y: Math.cos(a) };                      // NEW

    // Outward normals:
    // Top edge outward is "up" (negative local y) => rotate (0,-1) => (sin,-cos). // NEW
    const topN = { x: Math.sin(a), y: -Math.cos(a) };                       // NEW
    // Left edge outward is "left" (negative local x) => rotate (-1,0) => (-cos,-sin). // NEW
    const leftN = { x: -Math.cos(a), y: -Math.sin(a) };                     // NEW

    // Apply your offsets:
    // - W label: move along top normal by OVERLAY_W_Y_OFFSET and along top tangent by OVERLAY_W_X_OFFSET. // NEW
    const wPt = addVec(
        topMidR,
        topT.x * OVERLAY_W_X_OFFSET + topN.x * OVERLAY_W_Y_OFFSET,
        topT.y * OVERLAY_W_X_OFFSET + topN.y * OVERLAY_W_Y_OFFSET
    ); // NEW

    // - H label: move along left normal by OVERLAY_H_X_OFFSET and along left tangent by OVERLAY_H_Y_OFFSET. // NEW
    const hPt = addVec(
        leftMidR,
        leftT.x * OVERLAY_H_Y_OFFSET + leftN.x * OVERLAY_H_X_OFFSET,
        leftT.y * OVERLAY_H_Y_OFFSET + leftN.y * OVERLAY_H_X_OFFSET
    ); // NEW

    wDiv.style.left = `${Math.round(wPt.x)}px`;                             // CHANGE
    wDiv.style.top  = `${Math.round(wPt.y)}px`;                             // CHANGE

    hDiv.style.left = `${Math.round(hPt.x)}px`;                             // CHANGE
    hDiv.style.top  = `${Math.round(hPt.y)}px`;                             // CHANGE

    return true;
}

    
    // -------------------- Overlay lifecycle --------------------
    function removeOverlayForCellId(cellId) {
        const entry = overlaysByCellId.get(cellId);
        if (!entry) return;
        try {
            if (entry.wDiv && entry.wDiv.parentNode) entry.wDiv.parentNode.removeChild(entry.wDiv); // CHANGE
            if (entry.hDiv && entry.hDiv.parentNode) entry.hDiv.parentNode.removeChild(entry.hDiv); // NEW
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
        ensureOverlayDiv();
    
        const sel = graph.getSelectionCells ? graph.getSelectionCells() : [];
        const targetsRaw = [];
    
        for (const cell of sel) {
            const t = resolveTargetCellForOverlay(cell);
            if (t) targetsRaw.push(t);
        }
    
        const targets = uniqueById(targetsRaw).slice(0, MAX_OVERLAYS);
    
        const keepIds = new Set(targets.map(c => c.getId()));
        for (const existingId of Array.from(overlaysByCellId.keys())) {
            if (!keepIds.has(existingId)) removeOverlayForCellId(existingId);
        }
    
        for (const cell of targets) {
            const id = cell.getId();
            let entry = overlaysByCellId.get(id);
    
            if (!entry) {
                const wDiv = createOverlayDiv();                                  // CHANGE
                const hDiv = createOverlayDiv();                                  // NEW
                graph.container.appendChild(wDiv);                                // CHANGE
                graph.container.appendChild(hDiv);                                // NEW
                entry = { wDiv, hDiv, cell };                                     // CHANGE
                overlaysByCellId.set(id, entry);
            } else {
                entry.cell = cell;
            }
    
            positionOverlayDivs(entry.wDiv, entry.hDiv, cell);                    // CHANGE
        }
    }


function refreshOverlayPositions() {
    for (const [cellId, entry] of overlaysByCellId.entries()) {
        const ok = positionOverlayDivs(entry.wDiv, entry.hDiv, entry.cell);   // CHANGE
        if (!ok) removeOverlayForCellId(cellId);
    }
}


    // -------------------- Event wiring --------------------
    // Selection changes
    graph.getSelectionModel().addListener(mxEvent.CHANGE, function () {
        syncOverlaysToSelection();
    });

    // View changes (zoom/pan)
    graph.view.addListener(mxEvent.SCALE, function () {
        refreshOverlayPositions();
    });
    graph.view.addListener(mxEvent.TRANSLATE, function () {
        refreshOverlayPositions();
    });
    graph.view.addListener(mxEvent.SCALE_AND_TRANSLATE, function () {
        refreshOverlayPositions();
    });

    // Scroll changes (when container scrolls, overlay anchors must move)
    if (graph.container) {
        graph.container.addEventListener("scroll", function () {
            refreshOverlayPositions();
        }, { passive: true });
    }

    // Model changes (resize/move cells)
    model.addListener(mxEvent.CHANGE, function () {
        // If geometry changes, state will update; reposition overlays.
        refreshOverlayPositions();
    });

    // Cleanup if diagram is reset/reloaded in-app
    graph.addListener(mxEvent.DESTROY, function () {
        clearAllOverlays();
    });

    // Initial sync
    syncOverlaysToSelection();
});
