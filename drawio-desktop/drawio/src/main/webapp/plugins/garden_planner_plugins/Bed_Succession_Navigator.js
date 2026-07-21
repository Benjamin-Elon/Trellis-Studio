/**
 * Draw.io Plugin: Tiler Group Overlap Navigator (Multi-Cluster, DOM Buttons)
 * - Builds bed-aware and outside-overlap succession clusters per parent. // CHANGE
 * - Keeps bed-contained clusters separate from outside overhang clusters. // NEW
 * - Each cluster gets its own Prev/Next controls and index badge.
 * - Non-current members of each cluster are rendered outline-only (fills/text/images hidden).
 * - Covered plant groups, clusters, and empty beds get DOM selector buttons. // CHANGE
 */
Draw.loadPlugin(function (ui) {
    const graph = ui.editor.graph;
    const model = graph.getModel();

    if (graph.__tilerOverlapNavClustersInstalled) return;
    graph.__tilerOverlapNavClustersInstalled = true;

    (function installUndoSuppressor() {
        if (graph.__undoSuppressorInstalled) return;
        graph.__undoSuppressorInstalled = true;

        const um = ui?.editor?.undoManager;
        if (!um || typeof um.undoableEditHappened !== "function") return;

        const old = um.undoableEditHappened.bind(um);

        // Re-entrant counter (supports nested suppression safely)
        graph.__undoSuppressDepth = 0;

        um.undoableEditHappened = function (edit) {
            if (graph.__undoSuppressDepth > 0) return; // ignore these edits
            return old(edit);
        };

        graph.__withUndoSuppressed = function (fn) {
            graph.__undoSuppressDepth++;
            try { return fn(); }
            finally { graph.__undoSuppressDepth--; }
        };
    })();

    function withUndoSuppressed(fn) {
        const w = graph.__withUndoSuppressed;
        return w ? w(fn) : fn();
    }

    // -------------------- Config --------------------
    const BTN_SIZE = 22;
    const BTN_INSET = 6;
    const ICON_PREV = 'data:image/svg+xml;utf8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22">' +
        '<circle cx="11" cy="11" r="10" fill="white" stroke="black" stroke-width="1"/>' +
        '<polygon points="13,6 9,11 13,16" fill="black"/></svg>'
    );
    const ICON_NEXT = 'data:image/svg+xml;utf8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22">' +
        '<circle cx="11" cy="11" r="10" fill="white" stroke="black" stroke-width="1"/>' +
        '<polygon points="9,6 13,11 9,16" fill="black"/></svg>'
    );
    const GRAPH_OVERLAY_Z = Object.freeze({ ANNOTATION: 10000, CONNECTION: 10010, CONTROL: 10020, CONTROL_TOP: 10030 }); // CHANGE

    const ICON_SELECT = 'data:image/svg+xml;utf8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">' +
        '<circle cx="11" cy="11" r="10" fill="white" stroke="black" stroke-width="1"/>' +
        // cursor/selection arrow
        '<path d="M7 5 L7 15 L9.3 12.8 L10.8 16 L12.4 15.4 L10.9 12.2 L14 12 Z" fill="black"/>' +
        '</svg>'
    );

    const ICON_SELECT_BEDS = 'data:image/svg+xml;utf8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">' +
        '<circle cx="11" cy="11" r="10" fill="white" stroke="black" stroke-width="1"/>' +
        // simple "bed" glyph: a rounded rectangle with hatch lines
        '<rect x="6" y="7" width="10" height="8" rx="1.5" ry="1.5" fill="none" stroke="black" stroke-width="1"/>' +
        '<path d="M7 9 H15 M7 11 H15 M7 13 H15" stroke="black" stroke-width="1"/>' +
        '</svg>'
    );

    const TIME_ATTRS_ASC = ['transplant_date', 'sow_date'];
    const EPS = 0; // inclusive AABB; set >0 to treat near-miss as overlap

    const OVERLAP_MIN_PCT = 0.05; // CHANGE
    const OVERLAP_PCT_MODE = 'smaller';
    const BED_COVERAGE_MIN_PCT = 0.95; // NEW
    const COVERED_TARGET_MIN_PCT = 0.80; // NEW

    // overlap thresholds (0..1)
    const OVERLAP_FRAC_SMALL = 0.30; // % of the smaller
    const OVERLAP_FRAC_LARGE = 0.30; // % of the larger
    const OVERLAP_MIN_PX2 = 100;       // ignore microscopic overlaps

    // ---------------- Config ----------------
    const HEIGHT_ATTR = 'veg_height';          // cm (string)
    const DIAM_ATTR = 'veg_diameter_cm';     // cm (string)
    const PLANT_TAG = 'planting';            // optional: if you tag planting cells (recommended)
    const PLANT_TAG_ATTR = 'cellType';         // optional: 'planting'
    const REORDER_DEBOUNCE_MS = 80;

    // -------------------- NEW: canopy ordering --------------------
    function isPlantingCell(cell) {
        if (!cell || !cell.getAttribute) return false;
        // Prefer explicit tag if you use it, otherwise tiler group == planting         
        if (cell.getAttribute(PLANT_TAG_ATTR) === PLANT_TAG) return true;
        return isTilerGroup(cell);
    }

    function toNumOrNaN(v) {
        if (v == null) return NaN;
        const n = parseFloat(String(v).trim());
        return Number.isFinite(n) ? n : NaN;
    }

    function canopyKey(cell) {
        const h = toNumOrNaN(cell.getAttribute(HEIGHT_ATTR));
        const d = toNumOrNaN(cell.getAttribute(DIAM_ATTR));
        // We sort shorter->taller (back->front), so NaN becomes -Infinity              
        const hh = Number.isFinite(h) ? h : NaN;
        const dd = Number.isFinite(d) ? d : NaN;
        return { h: hh, d: dd };
    }

    function canopyCompare(a, b) {
        const ka = canopyKey(a), kb = canopyKey(b);

        // Primary: height                                                              
        const ah = Number.isFinite(ka.h) ? ka.h : -Infinity;
        const bh = Number.isFinite(kb.h) ? kb.h : -Infinity;
        if (ah !== bh) return ah - bh;

        // Fallback: diameter                                                           
        const ad = Number.isFinite(ka.d) ? ka.d : -Infinity;
        const bd = Number.isFinite(kb.d) ? kb.d : -Infinity;
        if (ad !== bd) return ad - bd;

        // Stable tie-break                                                             
        const id1 = a.id || '', id2 = b.id || '';
        return id1 < id2 ? -1 : id1 > id2 ? 1 : 0;
    }

    function snapCanopyOrderInParent(parent) {
        if (!parent) return;

        withUndoSuppressed(() => {
            const childCount = model.getChildCount(parent);
            if (childCount <= 1) return;

            // Gather current child list (includes non-vertices too)                        
            const children = [];
            for (let i = 0; i < childCount; i++) children.push(model.getChildAt(parent, i));

            // Identify planting children and their current slot indices                    
            const plantingSlots = [];
            const plantings = [];
            for (let i = 0; i < children.length; i++) {
                const c = children[i];
                if (model.isVertex(c) && isPlantingCell(c)) {
                    plantingSlots.push(i);
                    plantings.push(c);
                }
            }

            if (plantings.length <= 1) return;

            // Sort: shorter first, taller last (front)                                     
            const sorted = plantings.slice().sort(canopyCompare);

            // Reinsert ONLY plantings into their existing slots (preserve non-plantings)   
            model.beginUpdate();
            try {
                for (let k = 0; k < plantingSlots.length; k++) {
                    const idx = plantingSlots[k];
                    const cell = sorted[k];
                    // model.add moves within same parent; index is the z-order position   
                    model.add(parent, cell, idx);
                }
            } finally {
                model.endUpdate();
            }
            graph.refresh();
        });
    }

    let canopySnapRaf = null;
    function scheduleCanopySnap(parent) {
        if (!parent) return;
        if (canopySnapRaf != null) cancelAnimationFrame(canopySnapRaf);
        canopySnapRaf = requestAnimationFrame(() => {
            canopySnapRaf = null;
            snapCanopyOrderInParent(parent);

            const sel = graph.getSelectionCell();
            if (sel && model.getParent(sel) === parent && isPlantingCell(sel)) {
                bringCellToFrontInParent(sel);
            }
        });
    }


    // debounce
    let rafToken = null;
    function rafDebounce(fn) {
        if (rafToken != null) cancelAnimationFrame(rafToken);
        rafToken = requestAnimationFrame(() => { rafToken = null; fn(); });
    }

    // -------------------- Basic predicates & view helpers --------------------
    function isTilerGroup(cell) {
        return !!cell && cell.getAttribute && cell.getAttribute('tiler_group') === '1';
    }

    function isLodSummary(cell) { // CHANGE
        return !!cell && cell.getAttribute && cell.getAttribute('lod_summary') === '1'; // CHANGE
    } // CHANGE

    function findTilerGroupSelection(cell) { // CHANGE
        let cur = cell; // CHANGE
        while (cur) { // CHANGE
            if (isTilerGroup(cur)) return cur; // CHANGE
            if (isLodSummary(cur)) { // CHANGE
                const parent = model.getParent(cur); // CHANGE
                return isTilerGroup(parent) ? parent : null; // CHANGE
            } // CHANGE
            cur = model.getParent(cur); // CHANGE
        } // CHANGE
        return null; // CHANGE
    } // CHANGE

    function getState(cell) {
        return cell ? graph.view.getState(cell) : null;
    }

    let cachedHost = null;
    function getHost() {
        if (cachedHost) return cachedHost;
        const pane = graph.view && graph.view.overlayPane;
        cachedHost = (pane && getComputedStyle(pane).position === 'absolute') ? pane : graph.container;
        return cachedHost;
    }
    graph.getView().addListener(mxEvent.REPAINT, () => { cachedHost = null; });


    // -------------------- Geometry & overlap --------------------
    const boundsCache = new Map();

    function getAbsBounds(cell) {
        if (!cell) return null;
        const cached = boundsCache.get(cell.id);
        if (cached) return cached;
        const st = graph.view.getState(cell);
        if (st) {
            const b = { x: st.x, y: st.y, w: st.width, h: st.height };
            boundsCache.set(cell.id, b);
            return b;
        }
        return null;
    }

    function invalidateBoundsCache() { boundsCache.clear(); }
    graph.addListener(mxEvent.CELLS_MOVED, invalidateBoundsCache);
    graph.addListener(mxEvent.CELLS_RESIZED, invalidateBoundsCache);
    graph.getView().addListener(mxEvent.SCALE_AND_TRANSLATE, invalidateBoundsCache);


    // -------------------- Rotation-aware geometry -------------------- // NEW
    const GEOM_EPS = 0.000001; // NEW

    function toRad(deg) { // NEW
        return (Number(deg) || 0) * Math.PI / 180; // NEW
    } // NEW

    function rotateModelPoint(point, center, angleRad) { // NEW
        const dx = point.x - center.x; // NEW
        const dy = point.y - center.y; // NEW
        const cos = Math.cos(angleRad); // NEW
        const sin = Math.sin(angleRad); // NEW
        return { // NEW
            x: center.x + dx * cos - dy * sin, // NEW
            y: center.y + dx * sin + dy * cos // NEW
        }; // NEW
    } // NEW

    function getCellRotationDeg(cell) { // NEW
        if (!cell) return 0; // NEW
        const style = graph.getCellStyle(cell) || {}; // NEW
        const raw = style[mxConstants.STYLE_ROTATION] != null ? style[mxConstants.STYLE_ROTATION] : style.rotation; // NEW
        const n = Number(raw); // NEW
        return Number.isFinite(n) ? n : 0; // NEW
    } // NEW

    function getRotatedRectModel(cell) { // NEW
        const rect = getModelRect(cell); // NEW
        if (!rect || rect.w <= 0 || rect.h <= 0) return null; // NEW
        const center = rectCenterModel(rect); // NEW
        const angleDeg = getCellRotationDeg(cell); // NEW
        return { // NEW
            x: rect.x, y: rect.y, w: rect.w, h: rect.h, // NEW
            cx: center.x, cy: center.y, center: center, // NEW
            angleDeg: angleDeg, angleRad: toRad(angleDeg) // NEW
        }; // NEW
    } // NEW

    function rotatedRectCorners(rotatedRect) { // NEW
        if (!rotatedRect) return []; // NEW
        const center = rotatedRect.center || { x: rotatedRect.cx, y: rotatedRect.cy }; // NEW
        const corners = [ // NEW
            { x: rotatedRect.x, y: rotatedRect.y }, // NEW
            { x: rotatedRect.x + rotatedRect.w, y: rotatedRect.y }, // NEW
            { x: rotatedRect.x + rotatedRect.w, y: rotatedRect.y + rotatedRect.h }, // NEW
            { x: rotatedRect.x, y: rotatedRect.y + rotatedRect.h } // NEW
        ]; // NEW
        return corners.map(p => rotateModelPoint(p, center, rotatedRect.angleRad)); // NEW
    } // NEW

    function pointInRotatedRectModel(point, rotatedRect) { // NEW
        if (!point || !rotatedRect) return false; // NEW
        const center = rotatedRect.center || { x: rotatedRect.cx, y: rotatedRect.cy }; // NEW
        const local = rotateModelPoint(point, center, -rotatedRect.angleRad); // NEW
        return local.x >= rotatedRect.x - GEOM_EPS && // NEW
            local.x <= rotatedRect.x + rotatedRect.w + GEOM_EPS && // NEW
            local.y >= rotatedRect.y - GEOM_EPS && // NEW
            local.y <= rotatedRect.y + rotatedRect.h + GEOM_EPS; // NEW
    } // NEW

    function polygonSignedArea(poly) { // NEW
        if (!poly || poly.length < 3) return 0; // NEW
        let sum = 0; // NEW
        for (let i = 0; i < poly.length; i++) { // NEW
            const a = poly[i]; // NEW
            const b = poly[(i + 1) % poly.length]; // NEW
            sum += a.x * b.y - a.y * b.x; // NEW
        } // NEW
        return sum / 2; // NEW
    } // NEW

    function polygonArea(poly) { // NEW
        return Math.abs(polygonSignedArea(poly)); // NEW
    } // NEW

    function edgeCross(edgeStart, edgeEnd, point) { // NEW
        return (edgeEnd.x - edgeStart.x) * (point.y - edgeStart.y) - (edgeEnd.y - edgeStart.y) * (point.x - edgeStart.x); // NEW
    } // NEW

    function isInsideClipEdge(point, edgeStart, edgeEnd, clipSign) { // NEW
        const cross = edgeCross(edgeStart, edgeEnd, point); // NEW
        return clipSign >= 0 ? cross >= -GEOM_EPS : cross <= GEOM_EPS; // NEW
    } // NEW

    function lineIntersection(a, b, c, d) { // NEW
        const abx = b.x - a.x; // NEW
        const aby = b.y - a.y; // NEW
        const cdx = d.x - c.x; // NEW
        const cdy = d.y - c.y; // NEW
        const denom = abx * cdy - aby * cdx; // NEW
        if (Math.abs(denom) <= GEOM_EPS) return b; // NEW
        const t = ((c.x - a.x) * cdy - (c.y - a.y) * cdx) / denom; // NEW
        return { x: a.x + abx * t, y: a.y + aby * t }; // NEW
    } // NEW

    function convexPolygonIntersection(subject, clip) { // NEW
        if (!subject || subject.length < 3 || !clip || clip.length < 3) return []; // NEW
        let output = subject.slice(); // NEW
        const clipSign = polygonSignedArea(clip) >= 0 ? 1 : -1; // NEW
        for (let i = 0; i < clip.length; i++) { // NEW
            const edgeStart = clip[i]; // NEW
            const edgeEnd = clip[(i + 1) % clip.length]; // NEW
            const input = output; // NEW
            output = []; // NEW
            if (!input.length) break; // NEW
            let prev = input[input.length - 1]; // NEW
            let prevInside = isInsideClipEdge(prev, edgeStart, edgeEnd, clipSign); // NEW
            for (const curr of input) { // NEW
                const currInside = isInsideClipEdge(curr, edgeStart, edgeEnd, clipSign); // NEW
                if (currInside) { // NEW
                    if (!prevInside) output.push(lineIntersection(prev, curr, edgeStart, edgeEnd)); // NEW
                    output.push(curr); // NEW
                } else if (prevInside) { // NEW
                    output.push(lineIntersection(prev, curr, edgeStart, edgeEnd)); // NEW
                } // NEW
                prev = curr; // NEW
                prevInside = currInside; // NEW
            } // NEW
        } // NEW
        return output; // NEW
    } // NEW

    function rotatedRectIntersectionArea(a, b) { // NEW
        const pa = rotatedRectCorners(a); // NEW
        const pb = rotatedRectCorners(b); // NEW
        const intersection = convexPolygonIntersection(pa, pb); // NEW
        const area = polygonArea(intersection); // NEW
        return area > GEOM_EPS ? area : 0; // NEW
    } // NEW

    function segmentIntersectionPoint(a, b, c, d) { // NEW
        const abx = b.x - a.x; // NEW
        const aby = b.y - a.y; // NEW
        const cdx = d.x - c.x; // NEW
        const cdy = d.y - c.y; // NEW
        const denom = abx * cdy - aby * cdx; // NEW
        if (Math.abs(denom) <= GEOM_EPS) return null; // NEW
        const t = ((c.x - a.x) * cdy - (c.y - a.y) * cdx) / denom; // NEW
        const u = ((c.x - a.x) * aby - (c.y - a.y) * abx) / denom; // NEW
        if (t < -GEOM_EPS || t > 1 + GEOM_EPS || u < -GEOM_EPS || u > 1 + GEOM_EPS) return null; // NEW
        return { x: a.x + abx * t, y: a.y + aby * t }; // NEW
    } // NEW

    function polygonEdges(poly) { // NEW
        const edges = []; // NEW
        if (!poly || poly.length < 2) return edges; // NEW
        for (let i = 0; i < poly.length; i++) edges.push([poly[i], poly[(i + 1) % poly.length]]); // NEW
        return edges; // NEW
    } // NEW

    function polygonVerticalIntervalAt(poly, x) { // NEW
        if (!poly || poly.length < 3) return null; // NEW
        const ys = []; // NEW
        for (const edge of polygonEdges(poly)) { // NEW
            const a = edge[0], b = edge[1]; // NEW
            const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x); // NEW
            if (x < minX - GEOM_EPS || x > maxX + GEOM_EPS) continue; // NEW
            if (Math.abs(a.x - b.x) <= GEOM_EPS) { // NEW
                ys.push(a.y, b.y); // NEW
            } else { // NEW
                const t = (x - a.x) / (b.x - a.x); // NEW
                if (t >= -GEOM_EPS && t <= 1 + GEOM_EPS) ys.push(a.y + (b.y - a.y) * t); // NEW
            } // NEW
        } // NEW
        if (ys.length < 2) return null; // NEW
        ys.sort((a, b) => a - b); // NEW
        return { y1: ys[0], y2: ys[ys.length - 1] }; // NEW
    } // NEW

    function mergedIntervalLength(intervals) { // NEW
        const sorted = intervals.filter(Boolean).sort((a, b) => a.y1 - b.y1); // NEW
        if (!sorted.length) return 0; // NEW
        let total = 0; // NEW
        let start = sorted[0].y1, end = sorted[0].y2; // NEW
        for (let i = 1; i < sorted.length; i++) { // NEW
            const cur = sorted[i]; // NEW
            if (cur.y1 <= end + GEOM_EPS) { // NEW
                end = Math.max(end, cur.y2); // NEW
            } else { // NEW
                total += Math.max(0, end - start); // NEW
                start = cur.y1; // NEW
                end = cur.y2; // NEW
            } // NEW
        } // NEW
        total += Math.max(0, end - start); // NEW
        return total; // NEW
    } // NEW

    function unionAreaOfConvexPolygons(polys) { // NEW
        const clipped = (polys || []).filter(poly => poly && poly.length >= 3 && polygonArea(poly) > GEOM_EPS); // NEW
        if (!clipped.length) return 0; // NEW
        const xs = []; // NEW
        for (const poly of clipped) for (const p of poly) xs.push(p.x); // NEW
        for (let i = 0; i < clipped.length; i++) { // NEW
            const edgesA = polygonEdges(clipped[i]); // NEW
            for (let j = i + 1; j < clipped.length; j++) { // NEW
                const edgesB = polygonEdges(clipped[j]); // NEW
                for (const a of edgesA) for (const b of edgesB) { // NEW
                    const p = segmentIntersectionPoint(a[0], a[1], b[0], b[1]); // NEW
                    if (p) xs.push(p.x); // NEW
                } // NEW
            } // NEW
        } // NEW
        const sortedXs = Array.from(new Set(xs.map(x => Math.round(x / GEOM_EPS) * GEOM_EPS))).sort((a, b) => a - b); // NEW
        let area = 0; // NEW
        for (let i = 0; i < sortedXs.length - 1; i++) { // NEW
            const x1 = sortedXs[i], x2 = sortedXs[i + 1]; // NEW
            const width = x2 - x1; // NEW
            if (width <= GEOM_EPS) continue; // NEW
            const pad = Math.min(width * 0.000001, GEOM_EPS); // NEW
            const leftX = x1 + pad; // NEW
            const rightX = x2 - pad; // NEW
            const leftLen = mergedIntervalLength(clipped.map(poly => polygonVerticalIntervalAt(poly, leftX))); // NEW
            const rightLen = mergedIntervalLength(clipped.map(poly => polygonVerticalIntervalAt(poly, rightX))); // NEW
            area += width * (leftLen + rightLen) / 2; // NEW
        } // NEW
        return area > GEOM_EPS ? area : 0; // NEW
    } // NEW

    function coveredAreaOfTargetByCells(targetCell, coverCells) { // NEW
        const targetRect = getRotatedRectModel(targetCell); // NEW
        if (!targetRect) return 0; // NEW
        const targetPoly = rotatedRectCorners(targetRect); // NEW
        const clippedPolys = []; // NEW
        for (const cover of (coverCells || [])) { // NEW
            const coverRect = getRotatedRectModel(cover); // NEW
            if (!coverRect) continue; // NEW
            const clipped = convexPolygonIntersection(rotatedRectCorners(coverRect), targetPoly); // NEW
            if (clipped.length >= 3 && polygonArea(clipped) > GEOM_EPS) clippedPolys.push(clipped); // NEW
        } // NEW
        return unionAreaOfConvexPolygons(clippedPolys); // NEW
    } // NEW

    function targetCoverageFractionByCells(targetCell, coverCells) { // NEW
        const targetRect = getRotatedRectModel(targetCell); // NEW
        const targetArea = rectAreaModel(targetRect); // NEW
        if (targetArea <= 0) return 0; // NEW
        return Math.min(1, coveredAreaOfTargetByCells(targetCell, coverCells) / targetArea); // NEW
    } // NEW

    function coverageFractionOfTargetCellsByCoverCells(targetCells, coverCells) { // NEW
        const targetPolys = []; // NEW
        for (const target of (targetCells || [])) { // NEW
            const targetRect = getRotatedRectModel(target); // NEW
            if (targetRect) targetPolys.push(rotatedRectCorners(targetRect)); // NEW
        } // NEW
        const targetArea = unionAreaOfConvexPolygons(targetPolys); // NEW
        if (targetArea <= 0) return 0; // NEW

        const coveredPolys = []; // NEW
        for (const cover of (coverCells || [])) { // NEW
            const coverRect = getRotatedRectModel(cover); // NEW
            if (!coverRect) continue; // NEW
            const coverPoly = rotatedRectCorners(coverRect); // NEW
            for (const targetPoly of targetPolys) { // NEW
                const clipped = convexPolygonIntersection(coverPoly, targetPoly); // NEW
                if (clipped.length >= 3 && polygonArea(clipped) > GEOM_EPS) coveredPolys.push(clipped); // NEW
            } // NEW
        } // NEW

        return Math.min(1, unionAreaOfConvexPolygons(coveredPolys) / targetArea); // NEW
    } // NEW

    function significantOverlapRotatedRects(a, b) { // NEW
        if (!a || !b) return false; // NEW
        const ia = rotatedRectIntersectionArea(a, b); // NEW
        if (ia <= 0) return false; // NEW
        const aa = rectAreaModel(a), ab = rectAreaModel(b); // NEW
        if (aa <= 0 || ab <= 0) return false; // NEW

        let denom; // NEW
        if (OVERLAP_PCT_MODE === 'union') { // NEW
            denom = aa + ab - ia; // NEW
        } else { // NEW
            denom = Math.min(aa, ab); // NEW
        } // NEW
        if (denom <= 0) return false; // NEW
        return ia / denom >= OVERLAP_MIN_PCT; // NEW
    } // NEW

    function significantOverlapCells(a, b) { // NEW
        return significantOverlapRotatedRects(getRotatedRectModel(a), getRotatedRectModel(b)); // NEW
    } // NEW

    function rotationValueFromStyleString(styleText) { // NEW
        if (typeof styleText !== 'string') return null; // NEW
        const parts = styleText.split(';'); // NEW
        for (const part of parts) { // NEW
            const idx = part.indexOf('='); // NEW
            if (idx <= 0) continue; // NEW
            const key = part.slice(0, idx); // NEW
            if (key === mxConstants.STYLE_ROTATION || key === 'rotation') return part.slice(idx + 1); // NEW
        } // NEW
        return null; // NEW
    } // NEW

    function styleChangeTouchesRotation(change) { // NEW
        if (!change) return false; // NEW
        if (change.key === mxConstants.STYLE_ROTATION || change.key === 'rotation') return true; // NEW
        const before = rotationValueFromStyleString(change.previous); // NEW
        const after = rotationValueFromStyleString(change.style); // NEW
        return before !== after; // NEW
    } // NEW

    // -------------------- Significant overlap (area-based) -------------------- 
    function rectArea(r) {
        return (!r) ? 0 : Math.max(0, r.w) * Math.max(0, r.h);
    }

    function rectIntersectionArea(a, b) {
        if (!a || !b) return 0;
        const x1 = Math.max(a.x, b.x);
        const y1 = Math.max(a.y, b.y);
        const x2 = Math.min(a.x + a.w, b.x + b.w);
        const y2 = Math.min(a.y + a.h, b.y + b.h);
        const iw = x2 - x1;
        const ih = y2 - y1;
        if (iw <= 0 || ih <= 0) return 0;  // touching edges/corners => 0         
        return iw * ih;
    }

    function isGardenBed(cell) {
        if (!cell || !cell.getAttribute) return false;
        return cell.getAttribute('garden_bed') === '1' ||
            cell.getAttribute('gardenBed') === '1' ||
            cell.getAttribute('is_garden_bed') === '1';
    }

    function rectContainsPoint(r, px, py) {
        if (!r) return false;
        return px >= r.x && px <= (r.x + r.w) && py >= r.y && py <= (r.y + r.h);
    }

    function rectCenter(r) {
        return (!r) ? null : { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    }

    function findSmallestContainingBed(beds, bedBounds, point) { // CHANGE
        if (!point) return null; // NEW
        let chosen = null; // NEW
        let chosenArea = Infinity; // NEW
        for (let k = 0; k < beds.length; k++) { // NEW
            const bed = beds[k]; // CHANGE
            const rr = getRotatedRectModel(bed); // CHANGE
            if (!rr && !bedBounds[k]) continue; // CHANGE
            const contains = rr ? pointInRotatedRectModel(point, rr) : rectContainsPoint(bedBounds[k], point.x, point.y); // CHANGE
            if (contains) { // CHANGE
                const a = rr ? rectAreaModel(rr) : rectArea(bedBounds[k]); // CHANGE
                if (a > 0 && a < chosenArea) { // NEW
                    chosenArea = a; // NEW
                    chosen = bed; // CHANGE
                } // NEW
            } // NEW
        } // NEW
        return chosen; // NEW
    } // NEW

    function selectionIsOnlyGardenBeds(cells) { // NEW
        const selected = (cells || []).filter(Boolean); // NEW
        return selected.length > 0 && selected.every(c => model.isVertex(c) && isGardenBed(c)); // NEW
    } // NEW

    function significantOverlap(a, b) {
        if (!a || !b) return false;
        const ia = rectIntersectionArea(a, b);
        if (ia <= 0) return false;
        const aa = rectArea(a), ab = rectArea(b);
        if (aa <= 0 || ab <= 0) return false;

        let denom;
        if (OVERLAP_PCT_MODE === 'union') {
            denom = (aa + ab - ia);
        } else {
            denom = Math.min(aa, ab); // 'smaller'                               
        }
        if (denom <= 0) return false;
        const pct = ia / denom;
        return pct >= OVERLAP_MIN_PCT;
    }

    function getSiblingsInParent(parent) {
        const verts = graph.getChildVertices(parent) || [];
        return verts.filter(isTilerGroup);
    }

    // -------------------- prevent beds from being dropped into tiler groups --------------------

    // Returns true if `cell` is a tiler group OR is inside a tiler group (any ancestor)          
    function isInTilerGroup(cell) {
        let p = cell;
        while (p) {
            if (isTilerGroup(p)) return true;
            p = model.getParent(p);
        }
        return false;
    }

    // Find the nearest ancestor (including self) that is a tiler group, else null                
    function findTilerGroupAncestor(cell) {
        let p = cell;
        while (p) {
            if (isTilerGroup(p)) return p;
            p = model.getParent(p);
        }
        return null;
    }

    // -------------------- Model-space geometry helpers -------------------- // CHANGE

    function getModelRect(cell) { // NEW
        const g = cell ? model.getGeometry(cell) : null; // NEW
        if (!g) return null; // NEW
        return { // NEW
            x: Number(g.x) || 0, // NEW
            y: Number(g.y) || 0, // NEW
            w: Number(g.width) || 0, // NEW
            h: Number(g.height) || 0 // NEW
        }; // NEW
    } // NEW

    function rectCenterModel(rect) { // NEW
        return rect ? { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 } : null; // NEW
    } // NEW

    function rectAreaModel(rect) { // NEW
        return rect ? Math.max(0, rect.w) * Math.max(0, rect.h) : 0; // NEW
    } // NEW

    // 1) Primary: block drop target at drag-time                                                  
    (function installBedDropBlock() {
        if (graph.__bedDropBlockInstalled) return;
        graph.__bedDropBlockInstalled = true;

        const origIsValidDropTarget = graph.isValidDropTarget;
        graph.isValidDropTarget = function (target, cells, evt) {
            // If any dragged cell is a garden bed, forbid dropping into tiler groups              
            const dragged = (cells || []).filter(Boolean);
            const anyBed = dragged.some(c => model.isVertex(c) && isGardenBed(c));
            if (anyBed) {
                const tg = target ? findTilerGroupAncestor(target) : null;
                if (tg) return false;
            }
            return origIsValidDropTarget ? origIsValidDropTarget.apply(this, arguments) : true;
        };
    })();

    // 2) Secondary: safety net after moves (undo/redo/programmatic moves/outline drag)            
    function enforceBedsNotInTilerGroups(cells) {
        const moved = (cells || []).filter(Boolean);
        if (!moved.length) return;
    
        const safeParent = graph.getDefaultParent();
    
        withUndoSuppressed(() => {
            model.beginUpdate();
            try {
                for (const c of moved) {
                    if (!model.isVertex(c) || !isGardenBed(c)) continue;
                    const parent = model.getParent(c);
                    if (!parent) continue;
    
                    if (isInTilerGroup(parent)) {
                        const geo = model.getGeometry(c);
                        if (!geo) {
                            model.add(safeParent, c, model.getChildCount(safeParent));
                            continue;
                        }
    
                        const abs = geo.clone();
                        const parentGeo = model.getGeometry(parent);
                        if (parentGeo) { abs.x += parentGeo.x; abs.y += parentGeo.y; }
    
                        model.add(safeParent, c, model.getChildCount(safeParent));
                        model.setGeometry(c, abs);
                    }
                }
            } finally {
                model.endUpdate();
            }
            graph.refresh();
        });
    }
    

    graph.addListener(mxEvent.CELLS_MOVED, function (sender, evt) {
        const cells = evt.getProperty('cells');
        enforceBedsNotInTilerGroups(cells);
        rafDebounce(refreshAllForSelectionOrAnchor); // CHANGE
    });

    graph.addListener(mxEvent.CELLS_RESIZED, function () { // CHANGE
        rafDebounce(refreshAllForSelectionOrAnchor); // NEW
    });


    // -------------------- Time ordering --------------------
    function parseISO(s) {
        if (!s) return null;
        const d = new Date(s);
        return isNaN(+d) ? null : d;
    }

    function timeKey(cell) {
        for (const k of TIME_ATTRS_ASC) {
            const d = parseISO(cell.getAttribute(k));
            if (d) return +d;
        }
        const he = parseISO(cell.getAttribute('harvest_end'));
        return he ? +he : Number.POSITIVE_INFINITY;
    }

    // -------------------- Outline-only dimming (deep) --------------------
    let descendantsCache = new WeakMap();

    function collectVertexTree(root) {
        const out = [];
        const stack = [root];
        while (stack.length) {
            const c = stack.pop();
            if (!c) continue;
            if (model.isVertex(c)) out.push(c);
            const n = model.getChildCount(c);
            for (let i = 0; i < n; i++) stack.push(model.getChildAt(c, i));
        }
        return out;
    }

    function collectVertexTreeCached(root) {
        if (descendantsCache.has(root)) return descendantsCache.get(root);
        const out = collectVertexTree(root);
        descendantsCache.set(root, out);
        return out;
    }

    // -------------------- Config --------------------
    const BASE_TG_OPACITY = '50';
    const SELECTED_TG_OPACITY = '100';

    // -------------------- Outline-only dimming (deep) --------------------


    // In setOutlineOnlyVisibleDeep, swap to use cached:                        
    function setOutlineOnlyVisibleDeep(roots, visible) {
        const cells = [];
        (roots || []).forEach(r => cells.push(...collectVertexTreeCached(r)));
        if (!cells.length) return;
    
        const fillV = String(visible ? 100 : 0);
        const textV = String(visible ? 100 : 0);
        const imgV  = String(visible ? 100 : 0);
        const stroke = '100';
    
        withUndoSuppressed(() => {                                     // NEW
            model.beginUpdate();
            try {
                graph.setCellStyles('fillOpacity', fillV, cells);
                graph.setCellStyles('textOpacity', textV, cells);
                graph.setCellStyles('imageOpacity', imgV, cells);
                graph.setCellStyles('strokeOpacity', stroke, cells);
            } finally {
                model.endUpdate();
            }
        });                                                            // NEW
    }
    

    // deep opacity setter (root + descendants)
    function setOpacityDeep(roots, opacityPct) {
        const cells = [];
        (roots || []).forEach(r => cells.push(...collectVertexTreeCached(r)));
        if (!cells.length) return;
        withUndoSuppressed(() => {
            model.beginUpdate();
            try { graph.setCellStyles('opacity', String(opacityPct), cells); }
            finally { model.endUpdate(); }
        });
    }

    // restore to baseline visuals for a tiler group (deep)
    function restoreBaselineTGDeep(roots) {
        if (!roots || !roots.length) return;
        setOutlineOnlyVisibleDeep(roots, true);
        setOpacityDeep(roots, BASE_TG_OPACITY);
    }

    // Invalidate when tree structure changes:                                   
    graph.addListener(mxEvent.ADD_CELLS, () => { descendantsCache = new WeakMap(); });
    graph.addListener(mxEvent.REMOVE_CELLS, () => { descendantsCache = new WeakMap(); });

    // -------------------- Multi-cluster state --------------------
    // key -> { order: mxCell[], currentIdx: number, anchorId: string, btnPrev, btnNext, badge, dimmed:Set<mxCell> }
    const clusterStates = new Map();

    function clusterKeyOf(members) {
        const ids = members.map(c => c.id || '').sort();
        return ids.join('|');
    }

    function orderComponentByTime(members) {
        return members.slice().sort((a, b) => {
            const t1 = timeKey(a), t2 = timeKey(b);
            if (t1 !== t2) return t1 - t2;
            const id1 = a.id || '', id2 = b.id || '';
            return id1 < id2 ? -1 : id1 > id2 ? 1 : 0;
        });
    }

    function coverageSetKey(ids) { // NEW
        return (ids || []).slice().sort().join('|'); // NEW
    } // NEW

    function classifyTilerGroupForBeds(groupCell, beds) { // NEW
        const rect = getRotatedRectModel(groupCell); // NEW
        const containingBed = rect ? findSmallestContainingBed(beds, [], rect.center) : null; // NEW
        if (containingBed && containingBed.id) { // NEW
            return { type: 'contained', bedId: containingBed.id, coveredBedIds: [], coveredSetKey: '' }; // NEW
        } // NEW

        const coveredBedIds = []; // NEW
        for (const bed of beds) { // NEW
            if (!bed || !bed.id) continue; // NEW
            if (targetCoverageFractionByCells(bed, [groupCell]) >= BED_COVERAGE_MIN_PCT) coveredBedIds.push(bed.id); // NEW
        } // NEW

        return { // NEW
            type: coveredBedIds.length ? 'outside-covered' : 'outside', // NEW
            bedId: null, // NEW
            coveredBedIds, // NEW
            coveredSetKey: coverageSetKey(coveredBedIds) // NEW
        }; // NEW
    } // NEW

    function shouldClusterTilerGroups(a, b) { // CHANGE
        return significantOverlapCells(a, b); // CHANGE
    } // NEW

    function buildAllComponentsInParent(parent) {
        const nodes = getSiblingsInParent(parent);
        const n = nodes.length;
        if (n < 1) return []; // CHANGE

        const adj = Array.from({ length: n }, () => []);

        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                if (shouldClusterTilerGroups(nodes[i], nodes[j])) { // CHANGE
                    adj[i].push(j);
                    adj[j].push(i);
                }
            }
        }

        const seen = new Array(n).fill(false);
        const comps = [];
        for (let i = 0; i < n; i++) {
            if (seen[i]) continue;
            const stack = [i], comp = [];
            seen[i] = true;
            while (stack.length) {
                const v = stack.pop();
                comp.push(nodes[v]);
                for (const w of adj[v]) if (!seen[w]) { seen[w] = true; stack.push(w); }
            }
            comps.push(comp); // CHANGE
        }
        return comps;
    }


    function ensureClusterState(members, preferredAnchorId) {
        const key = clusterKeyOf(members);
        const order = orderComponentByTime(members);
        let st = clusterStates.get(key);
        if (!st) {
            let idx = 0;
            if (preferredAnchorId) {
                const k = order.findIndex(c => c.id === preferredAnchorId);
                if (k >= 0) idx = k;
            }
            st = {
                order,
                currentIdx: idx,
                anchorId: order[idx].id,
                btnPrev: null,
                btnNext: null,
                badge: null,
                dimmed: new Set(),
                btnDrag: null,
                btnSelectAll: null,
                btnSelectBed: null, // NEW
                coveredTargetButtons: [], // CHANGE
            };
            clusterStates.set(key, st);
        } else {
            const oldAnchor = st.anchorId;
            st.order = order;
            const preferredIdx = preferredAnchorId ? order.findIndex(c => c.id === preferredAnchorId) : -1; // CHANGE
            const k = preferredIdx >= 0 ? preferredIdx : order.findIndex(c => c.id === oldAnchor); // CHANGE
            st.currentIdx = k >= 0 ? k : 0;
            st.anchorId = st.order[st.currentIdx].id;
        }
        return { key, st };
    }

    // Earliest start / latest end window for a group                                        
    function plantingWindowOf(cell) {
        // start = transplant_date if present, otherwise sow_date                                  
        const start = parseISO(cell.getAttribute('transplant_date')) ||
            parseISO(cell.getAttribute('sow_date'));

        // end = harvest_end only                                                                  
        const end = parseISO(cell.getAttribute('harvest_end'));

        return (start && end && end >= start) ? { start, end } : null;
    }

    function dateAttrISO(cell, attr) { // NEW
        const raw = cell && cell.getAttribute ? cell.getAttribute(attr) : null; // NEW
        const date = parseISO(raw); // NEW
        return date ? date.toISOString().slice(0, 10) : null; // NEW
    } // NEW

    function plantingOccupancyWindowOf(cell) { // NEW
        const startISO = dateAttrISO(cell, 'transplant_date') || dateAttrISO(cell, 'sow_date'); // NEW
        const endISO = dateAttrISO(cell, 'harvest_end'); // NEW
        const start = startISO ? parseISO(startISO) : null; // NEW
        const end = endISO ? parseISO(endISO) : null; // NEW
        return start && end && end >= start ? { startISO, endISO } : { startISO: null, endISO: null }; // NEW
    } // NEW

    function plantingOccupancyLabel(cell) { // NEW
        const plant = cell && cell.getAttribute ? (cell.getAttribute('plant_name') || cell.getAttribute('crop_name') || '') : ''; // NEW
        const variety = cell && cell.getAttribute ? (cell.getAttribute('variety_name') || cell.getAttribute('variety') || '') : ''; // NEW
        if (plant && variety) return plant + ' - ' + variety; // NEW
        return plant || variety || (cell && cell.getAttribute && (cell.getAttribute('label') || cell.getAttribute('title'))) || (cell && cell.id) || 'Planting'; // NEW
    } // NEW

    function selectedClusterOccupancyFor(cell) { // NEW
        const selected = findTilerGroupSelection(cell || graph.getSelectionCell()); // NEW
        if (!selected) return { selectedId: null, items: [] }; // NEW
        const parent = model.getParent(selected); // NEW
        const components = parent ? buildAllComponentsInParent(parent) : []; // NEW
        const component = components.find(members => members.some(member => member && member.id === selected.id)) || [selected]; // NEW
        const order = orderComponentByTime(component); // NEW
        return { // NEW
            selectedId: selected.id, // NEW
            items: order.map(member => { // NEW
                const window = plantingOccupancyWindowOf(member); // NEW
                return { cellId: member.id, label: plantingOccupancyLabel(member), startISO: window.startISO, endISO: window.endISO }; // NEW
            }) // NEW
        }; // NEW
    } // NEW

    // -------------------- Per-cluster UI helpers --------------------
    function styleBtn(el) {
        el.style.position = 'absolute';
        el.style.width = BTN_SIZE + 'px';
        el.style.height = BTN_SIZE + 'px';
        el.style.zIndex = String(GRAPH_OVERLAY_Z.CONTROL); // CHANGE
        el.style.cursor = 'pointer';
        el.style.pointerEvents = 'auto';
    }

    function styleSelectBtn(el) {
        el.style.position = 'absolute';
        el.style.width = BTN_SIZE + 'px';
        el.style.height = BTN_SIZE + 'px';
        el.style.zIndex = String(GRAPH_OVERLAY_Z.CONTROL); // CHANGE
        el.style.cursor = 'pointer';
        el.style.pointerEvents = 'auto';
        el.style.userSelect = 'none';
    }


    function consumeEvt(evt) {
        if (evt) mxEvent.consume(evt);
    }

    function setNavEnabled(btn, enabled) {
        if (!btn) return;
        btn.dataset.navEnabled = enabled ? '1' : '0';
        btn.style.cursor = enabled ? 'pointer' : 'default';
        btn.style.opacity = enabled ? '1' : '0.35';
    }

    function isNavEnabled(btn) {
        return !!btn && btn.dataset.navEnabled === '1';
    }


    function ensureButtonsFor(key) {
        const host = getHost();
        const st = clusterStates.get(key); if (!st) return;

        if (!st.btnPrev) {
            st.btnPrev = document.createElement('img');
            st.btnPrev.src = ICON_PREV; styleBtn(st.btnPrev); st.btnPrev.title = 'Previous';
            st.btnPrev.draggable = false;

            st.btnPrev.addEventListener('pointerdown', consumeEvt, { passive: false });
            st.btnPrev.addEventListener('mousedown', consumeEvt, { passive: false });

            st.btnPrev.addEventListener('click', function (evt) {
                consumeEvt(evt);
                if (!isNavEnabled(st.btnPrev)) return;
                onCycleCluster(key, -1);
            });

            host.appendChild(st.btnPrev);
        } else if (st.btnPrev.parentNode !== host) { host.appendChild(st.btnPrev); }

        if (!st.btnNext) {
            st.btnNext = document.createElement('img');
            st.btnNext.src = ICON_NEXT; styleBtn(st.btnNext); st.btnNext.title = 'Next';
            st.btnNext.draggable = false;

            st.btnNext.addEventListener('pointerdown', consumeEvt, { passive: false });
            st.btnNext.addEventListener('mousedown', consumeEvt, { passive: false });

            st.btnNext.addEventListener('click', function (evt) {
                consumeEvt(evt);
                if (!isNavEnabled(st.btnNext)) return;
                onCycleCluster(key, +1);
            });

            host.appendChild(st.btnNext);
        } else if (st.btnNext.parentNode !== host) { host.appendChild(st.btnNext); }

        st.btnPrev.style.display = '';
        st.btnNext.style.display = '';
    }

    function ensureSelectAllFor(key) {
        const host = getHost();
        const st = clusterStates.get(key); if (!st) return;

        if (!st.btnSelectAll) {
            const b = document.createElement('img');
            b.src = ICON_SELECT;
            b.alt = 'Select';
            styleSelectBtn(b);
            b.title = 'Select entire cluster';
            b.draggable = false;

            b.addEventListener('pointerdown', consumeEvt, { passive: false });
            b.addEventListener('mousedown', consumeEvt, { passive: false });

            b.addEventListener('click', function (evt) {
                consumeEvt(evt);
                const st2 = clusterStates.get(key);
                if (!st2 || !st2.order || st2.order.length < 2) return;

                const members = st2.order.slice();
                clearVisibilityFor(key);
                graph.setSelectionCells(members);
                graph.refresh();
                hideUIFor(key);
            });

            host.appendChild(b);
            st.btnSelectAll = b;
        } else if (st.btnSelectAll.parentNode !== host) {
            host.appendChild(st.btnSelectAll);
        }

        st.btnSelectAll.style.display = '';
    }

    function containedBedForCluster(key) { // NEW
        const st = clusterStates.get(key); if (!st || !st.order || !st.order.length) return null; // NEW
        const parent = model.getParent(st.order[0]); // NEW
        if (!parent) return null; // NEW
        const beds = (graph.getChildVertices(parent) || []).filter(isGardenBed); // NEW
        const bedId = containedBedIdForComponent(st.order, beds); // NEW
        if (!bedId) return null; // NEW
        const bed = model.getCell(bedId); // NEW
        return bed && model.isVertex(bed) && isGardenBed(bed) ? bed : null; // NEW
    } // NEW

    function selectContainedBedForCluster(key) { // NEW
        const st = clusterStates.get(key); if (!st || !st.order || !st.order.length) return; // NEW
        const bed = containedBedForCluster(key); // NEW
        if (!bed) return; // NEW
        const parent = model.getParent(st.order[0]); // NEW
        bringCellsToFrontTemporarilyInParent(parent, [bed]); // NEW
        clearVisibilityFor(key); // NEW
        graph.setSelectionCells([bed]); // NEW
        if (parent) graph.refresh(parent); else graph.refresh(); // NEW
        hideUIFor(key); // NEW
    } // NEW

    function ensureContainedBedSelectorFor(key) { // NEW
        const host = getHost(); // NEW
        const st = clusterStates.get(key); if (!st) return; // NEW
        const bed = containedBedForCluster(key); // NEW
        if (!bed) { // NEW
            if (st.btnSelectBed) st.btnSelectBed.style.display = 'none'; // NEW
            return; // NEW
        } // NEW

        if (!st.btnSelectBed) { // NEW
            const b = document.createElement('img'); // NEW
            b.src = ICON_SELECT_BEDS; // NEW
            b.alt = 'Select bed'; // NEW
            styleSelectBtn(b); // NEW
            b.title = 'Select containing garden bed'; // NEW
            b.draggable = false; // NEW
            b.addEventListener('pointerdown', consumeEvt, { passive: false }); // NEW
            b.addEventListener('mousedown', consumeEvt, { passive: false }); // NEW
            b.addEventListener('click', function (evt) { // NEW
                consumeEvt(evt); // NEW
                selectContainedBedForCluster(key); // NEW
            }); // NEW
            host.appendChild(b); // NEW
            st.btnSelectBed = b; // NEW
        } else if (st.btnSelectBed.parentNode !== host) { // NEW
            host.appendChild(st.btnSelectBed); // NEW
        } // NEW

        st.btnSelectBed.style.display = ''; // NEW
    } // NEW

    function removeCoveredTargetSelectorsFor(key) { // NEW
        const st = clusterStates.get(key); if (!st) return; // NEW
        for (const item of (st.coveredTargetButtons || [])) { // NEW
            if (item.el && item.el.parentNode) item.el.parentNode.removeChild(item.el); // NEW
        } // NEW
        st.coveredTargetButtons = []; // NEW
    } // NEW

    function viewBBoxForCells(cells) { // NEW
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity; // NEW
        for (const cell of (cells || [])) { // NEW
            const s = getState(cell); // NEW
            if (!s) continue; // NEW
            minX = Math.min(minX, s.x); // NEW
            minY = Math.min(minY, s.y); // NEW
            maxX = Math.max(maxX, s.x + s.width); // NEW
            maxY = Math.max(maxY, s.y + s.height); // NEW
        } // NEW
        if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return null; // NEW
        return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }; // NEW
    } // NEW

    function bboxCenter(box) { // NEW
        return box ? { x: box.x + box.w / 2, y: box.y + box.h / 2 } : null; // NEW
    } // NEW

    function clampNumber(value, min, max) { // NEW
        return Math.max(min, Math.min(max, value)); // NEW
    } // NEW

    function containedBedIdForComponent(members, beds) { // NEW
        let bedId = null; // NEW
        for (const member of (members || [])) { // NEW
            const meta = classifyTilerGroupForBeds(member, beds); // NEW
            if (meta.type !== 'contained' || !meta.bedId) return null; // NEW
            if (bedId && bedId !== meta.bedId) return null; // NEW
            bedId = meta.bedId; // NEW
        } // NEW
        return bedId; // NEW
    } // NEW

    function makeCoveredPlantTarget(component, coverKey, coverCells) { // NEW
        if (!component || !component.length || clusterKeyOf(component) === coverKey) return null; // NEW
        const fraction = coverageFractionOfTargetCellsByCoverCells(component, coverCells); // NEW
        if (fraction < COVERED_TARGET_MIN_PCT) return null; // NEW
        return { type: 'plant', cells: component.slice(), fraction }; // NEW
    } // NEW

    function coveredTargetsForCluster(key, components) { // NEW
        const st = clusterStates.get(key); if (!st || !st.order || !st.order.length) return []; // NEW
        const parent = model.getParent(st.order[0]); // NEW
        if (!parent) return []; // NEW
        const coverCells = st.order.slice(); // NEW
        const coverKey = clusterKeyOf(coverCells); // NEW
        const beds = (graph.getChildVertices(parent) || []).filter(isGardenBed); // NEW
        const targets = []; // NEW
        const coveredPlantBedIds = new Set(); // NEW
        const occupiedBedIds = new Set(); // NEW

        for (const component of (components || [])) { // NEW
            const bedId = containedBedIdForComponent(component, beds); // NEW
            if (bedId) occupiedBedIds.add(bedId); // NEW
            const target = makeCoveredPlantTarget(component, coverKey, coverCells); // NEW
            if (!target) continue; // NEW
            if (bedId) coveredPlantBedIds.add(bedId); // NEW
            targets.push(target); // NEW
        } // NEW

        for (const bed of beds) { // NEW
            if (!bed || !bed.id || occupiedBedIds.has(bed.id) || coveredPlantBedIds.has(bed.id)) continue; // NEW
            if (targetCoverageFractionByCells(bed, coverCells) >= COVERED_TARGET_MIN_PCT) targets.push({ type: 'bed', cells: [bed], bed }); // NEW
        } // NEW

        return targets; // NEW
    } // NEW

    function coveredTargetLabel(target) { // NEW
        if (!target) return 'Select covered target'; // NEW
        if (target.type === 'bed') return 'Select covered garden bed'; // NEW
        return target.cells && target.cells.length > 1 ? 'Select covered plant cluster' : 'Select covered plant group'; // NEW
    } // NEW

    function selectCoveredTarget(key, target) { // NEW
        const st = clusterStates.get(key); // NEW
        if (!st || !target || !target.cells || !target.cells.length) return; // NEW
        const parent = model.getParent(st.order[0]); // NEW
        clearVisibilityFor(key); // NEW
        if (target.type === 'bed') { // NEW
            bringCellsToFrontTemporarilyInParent(parent, target.cells); // NEW
            graph.setSelectionCells(target.cells); // NEW
        } else if (target.cells.length === 1) { // NEW
            bringToFrontAndSelect(target.cells[0]); // NEW
        } else { // NEW
            graph.setSelectionCells(target.cells); // NEW
        } // NEW
        if (parent) graph.refresh(parent); else graph.refresh(); // CHANGE
        hideUIFor(key); // NEW
    } // NEW

    function ensureCoveredTargetSelectorsFor(key, components) { // NEW
        const host = getHost(); // NEW
        const st = clusterStates.get(key); if (!st) return; // NEW
        removeCoveredTargetSelectorsFor(key); // NEW
        const targets = coveredTargetsForCluster(key, components); // NEW
        if (!targets.length) return; // NEW
        for (const target of targets) { // NEW
            const b = document.createElement('img'); // NEW
            b.src = target.type === 'bed' ? ICON_SELECT_BEDS : ICON_SELECT; // NEW
            b.alt = 'Select covered target'; // NEW
            styleSelectBtn(b); // NEW
            b.title = coveredTargetLabel(target); // NEW
            b.draggable = false; // NEW
            b.addEventListener('pointerdown', consumeEvt, { passive: false }); // NEW
            b.addEventListener('mousedown', consumeEvt, { passive: false }); // NEW
            b.addEventListener('click', function (evt) { // NEW
                consumeEvt(evt); // NEW
                selectCoveredTarget(key, target); // NEW
            }); // NEW
            host.appendChild(b); // NEW
            st.coveredTargetButtons.push({ el: b, target }); // NEW
        } // NEW
        positionCoveredTargetSelectorsFor(key); // NEW
    } // NEW

    function ensureBadgeFor(key) {
        const host = getHost();
        const st = clusterStates.get(key); if (!st) return;
        if (!st.badge) {
            const b = document.createElement('div');
            b.style.position = 'absolute';
            b.style.zIndex = String(GRAPH_OVERLAY_Z.ANNOTATION); // CHANGE
            b.style.padding = '2px 6px';
            b.style.font = '12px/16px sans-serif';
            b.style.background = 'rgba(255,255,255,0.9)';
            b.style.border = '1px solid #000';
            b.style.borderRadius = '10px';
            b.style.pointerEvents = 'none';
            b.style.width = '54px';
            b.style.textAlign = 'center';
            host.appendChild(b);
            st.badge = b;
        } else if (st.badge.parentNode !== host) {
            host.appendChild(st.badge);
        }
        st.badge.style.display = '';
    }

    function hideUIFor(key) {
        const st = clusterStates.get(key); if (!st) return;
        if (st.btnPrev) st.btnPrev.style.display = 'none';
        if (st.btnNext) st.btnNext.style.display = 'none';
        if (st.badge) st.badge.style.display = 'none';
        if (st.btnSelectAll) st.btnSelectAll.style.display = 'none';
        if (st.btnSelectBed) st.btnSelectBed.style.display = 'none'; // NEW
        removeCoveredTargetSelectorsFor(key); // CHANGE

    }

    // compute cluster bounding box from member states                         
    function getClusterBBox(key) {
        const st = clusterStates.get(key); if (!st) return null;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const c of st.order) {
            const s = getState(c);
            if (!s) continue;
            if (s.x < minX) minX = s.x;
            if (s.y < minY) minY = s.y;
            const rx = s.x + s.width, ry = s.y + s.height;
            if (rx > maxX) maxX = rx;
            if (ry > maxY) maxY = ry;
        }
        if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return null;
        return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }

    function positionCoveredTargetSelectorsFor(key) { // NEW
        const st = clusterStates.get(key); if (!st || !st.coveredTargetButtons || !st.coveredTargetButtons.length) return; // NEW
        const coverBox = getClusterBBox(key); // NEW
        if (!coverBox) { removeCoveredTargetSelectorsFor(key); return; } // NEW
        for (const item of st.coveredTargetButtons) { // NEW
            const el = item.el; // NEW
            const targetBox = viewBBoxForCells(item.target && item.target.cells); // NEW
            const center = bboxCenter(targetBox); // NEW
            if (!el || !center) continue; // NEW
            const minLeft = coverBox.x; // NEW
            const maxLeft = coverBox.x + Math.max(0, coverBox.w - BTN_SIZE); // NEW
            const minTop = coverBox.y; // NEW
            const maxTop = coverBox.y + Math.max(0, coverBox.h - BTN_SIZE); // NEW
            el.style.left = Math.round(clampNumber(center.x - BTN_SIZE / 2, minLeft, maxLeft)) + 'px'; // NEW
            el.style.top = Math.round(clampNumber(center.y - BTN_SIZE / 2, minTop, maxTop)) + 'px'; // NEW
            el.style.display = ''; // NEW
        } // NEW
    } // NEW


    function positionUIFor(key) {
        const st = clusterStates.get(key); if (!st) return;
        const box = getClusterBBox(key);
        if (!box) { hideUIFor(key); return; }

        const midY = box.y + box.h / 2;
        if (st.btnPrev) { // CHANGE
            st.btnPrev.style.left = Math.round(box.x - BTN_SIZE - BTN_INSET) + 'px'; // CHANGE
            st.btnPrev.style.top = Math.round(midY - BTN_SIZE / 2) + 'px'; // CHANGE
        } // CHANGE
        if (st.btnNext) { // CHANGE
            st.btnNext.style.left = Math.round(box.x + box.w + BTN_INSET) + 'px'; // CHANGE
            st.btnNext.style.top = Math.round(midY - BTN_SIZE / 2) + 'px'; // CHANGE
        } // CHANGE

        const gap = 6, cx = box.x + box.w / 2;
        if (st.badge) { // CHANGE
            st.badge.textContent = (st.currentIdx + 1) + ' / ' + st.order.length; // CHANGE
            const bw = 54, bh = 18; // CHANGE
            st.badge.style.left = Math.round(cx - bw / 2) + 'px'; // CHANGE
            st.badge.style.top = Math.round(box.y - bh - gap) + 'px'; // CHANGE
        } // CHANGE

        // place select buttons at the top-left outside corner of the cluster bbox
        if (st.btnSelectAll || st.btnSelectBed) { // CHANGE
            const baseX = Math.round(box.x - BTN_SIZE - BTN_INSET);
            const y = Math.round(box.y - BTN_SIZE - BTN_INSET);
            const selectGap = 4; // NEW
            if (st.btnSelectBed) { // NEW
                st.btnSelectBed.style.left = baseX + 'px'; // NEW
                st.btnSelectBed.style.top = y + 'px'; // NEW
            } // NEW
            if (st.btnSelectAll) {
                const x2 = baseX + (st.btnSelectBed && st.btnSelectBed.style.display !== 'none' ? (BTN_SIZE + selectGap) : 0); // CHANGE
                st.btnSelectAll.style.left = x2 + 'px'; // CHANGE
                st.btnSelectAll.style.top = y + 'px';
            }
        }

        positionCoveredTargetSelectorsFor(key); // NEW
    }

    function updateControlsVisibilityFor(key) {
        const st = clusterStates.get(key); if (!st) return;
        const last = st.order.length - 1;

        if (st.btnPrev) setNavEnabled(st.btnPrev, st.currentIdx > 0);
        if (st.btnNext) setNavEnabled(st.btnNext, st.currentIdx < last);

    }


    // -------------------- Per-cluster visibility --------------------
    function clearVisibilityFor(key) {
        const st = clusterStates.get(key);
        if (!st) return;

        // Restore ALL members (not only st.dimmed), because current TG is never in dimmed. 
        const members = (st.order || []).slice();
        if (!members.length) return;

        st.dimmed.clear();
        restoreBaselineTGDeep(members);
    }

    function applyVisibilityFor(key) {
        const st = clusterStates.get(key); if (!st) return;
        if (st.order.length < 2) { clearVisibilityFor(key); return; }

        const curr = st.order[st.currentIdx];
        const nextDim = new Set(st.order.filter((c, i) => i !== st.currentIdx));

        // Dim newly added
        const toDim = [];
        nextDim.forEach(c => { if (!st.dimmed.has(c)) toDim.push(c); });
        if (toDim.length) {
            setOutlineOnlyVisibleDeep(toDim, false);
            setOpacityDeep(toDim, SELECTED_TG_OPACITY);
        }

        // Ensure current is fully visible
        setOutlineOnlyVisibleDeep([curr], true);
        setOpacityDeep([curr], SELECTED_TG_OPACITY);

        st.dimmed = nextDim;
    }


    // -------------------- Navigation per cluster --------------------
    function bringCellToFrontInParent(cell) {
        if (!cell) return;
        const p = model.getParent(cell);
        if (!p) return;

        const umWrap = graph.__withUndoSuppressed || ((fn) => fn());

        umWrap(() => {
            model.beginUpdate();
            try {
                model.add(p, cell, model.getChildCount(p));
            } finally {
                model.endUpdate();
            }
            graph.refresh(cell);
        });
    }


    // -------------------- NEW: temporary bed front-ordering --------------------
    const parentOrderSnapshots = new Map(); // parentId -> [childId,...]               
    let lastSelectedBedParent = null;

    function snapshotChildOrder(parent) {
        if (!parent || !parent.id) return;
        if (parentOrderSnapshots.has(parent.id)) return;
        const n = model.getChildCount(parent);
        const ids = [];
        for (let i = 0; i < n; i++) {
            const c = model.getChildAt(parent, i);
            ids.push(c && c.id ? c.id : null);
        }
        parentOrderSnapshots.set(parent.id, ids);
    }

    function restoreChildOrder(parent) {
        if (!parent || !parent.id) return;
        const snap = parentOrderSnapshots.get(parent.id);
        if (!snap) return;

        withUndoSuppressed(() => {
            model.beginUpdate();
            try {
                let idx = 0;
                for (const id of snap) {
                    if (!id) continue;
                    const cell = model.getCell(id);
                    if (!cell) continue;
                    if (model.getParent(cell) !== parent) continue;
                    model.add(parent, cell, idx++);
                }
            } finally {
                model.endUpdate();
            }
            parentOrderSnapshots.delete(parent.id);
            graph.refresh(parent);
        });
    }

    function bringCellsToFrontTemporarilyInParent(parent, cells) {
        if (!parent || !cells || !cells.length) return;

        // Snapshot once, then move target cells to the end in their current order
        snapshotChildOrder(parent);

        // Preserve relative order as currently in parent
        const n = model.getChildCount(parent);
        const order = [];
        const set = new Set(cells.map(c => c && c.id).filter(Boolean));
        for (let i = 0; i < n; i++) {
            const c = model.getChildAt(parent, i);
            if (c && set.has(c.id)) order.push(c);
        }
        if (!order.length) return;
        withUndoSuppressed(() => {
            model.beginUpdate();
            try {
                for (const c of order) model.add(parent, c, model.getChildCount(parent));
            } finally {
                model.endUpdate();
            }
            lastSelectedBedParent = parent;
            graph.refresh(parent);
        });
    }


    function bringToFrontAndSelect(cell) {
        bringCellToFrontInParent(cell);
        graph.setSelectionCell(cell);
        lastSelectedPlantingId = cell ? cell.id : null;
        lastSelectedPlantingParent = cell ? model.getParent(cell) : null;
    }

    function onCycleCluster(key, dir) {
        const st = clusterStates.get(key); if (!st) return;
        let i = st.currentIdx;
        i = (i + dir + st.order.length) % st.order.length;
        st.currentIdx = i;
        st.anchorId = st.order[i].id;
        bringToFrontAndSelect(st.order[i]);

        // keep time order & anchor
        st.order = orderComponentByTime(st.order);
        st.currentIdx = st.order.findIndex(c => c.id === st.anchorId);

        ensureButtonsFor(key);
        ensureBadgeFor(key);
        updateControlsVisibilityFor(key);
        positionUIFor(key);
        applyVisibilityFor(key);

    }

    // -------------------- Orchestration --------------------
    function refreshClustersInParent(parent, preferredAnchorId, selectedId) { // CHANGE
        const comps = buildAllComponentsInParent(parent);
        const liveKeys = new Set();

        for (const members of comps) {
            const { key } = ensureClusterState(members, preferredAnchorId);
            liveKeys.add(key);

            // Only show UI/dimming for the cluster containing the selected tiler group
            const isSelectedCluster = selectedId && members.some(c => c.id === selectedId); // CHANGE
            if (!isSelectedCluster) {
                hideUIFor(key);
                clearVisibilityFor(key);
                continue;
            }

            if (members.length >= 2) { // NEW
                ensureButtonsFor(key); // CHANGE
                ensureBadgeFor(key); // CHANGE
                ensureSelectAllFor(key); // CHANGE
            } // NEW
            ensureContainedBedSelectorFor(key); // NEW
            updateControlsVisibilityFor(key);
            positionUIFor(key);
            applyVisibilityFor(key);
            ensureCoveredTargetSelectorsFor(key, comps); // NEW

        }

        for (const [key, st] of clusterStates.entries()) {
            if (!liveKeys.has(key)) {
                hideUIFor(key);
                clearVisibilityFor(key);
                clusterStates.delete(key);
            }
        }
    }

    // Collect all tiler groups recursively under a root
    function collectAllTilerGroupsRec(root) {
        const out = [];
        const stack = [root];
        while (stack.length) {
            const p = stack.pop();
            const childCount = model.getChildCount(p);
            for (let i = 0; i < childCount; i++) {
                const c = model.getChildAt(p, i);
                if (model.isVertex(c)) {
                    if (isTilerGroup(c)) out.push(c);
                }
                // Recurse into both vertices and groups/containers
                if (model.getChildCount(c) > 0) stack.push(c);
            }
        }
        return out;
    }

    // REPLACE parentsToScan() with grouping by actual immediate parent
    function parentsToScan() {
        const root = model.getRoot();
        const currentLayer = graph.getDefaultParent();
        const layers = [];
        const layerCount = model.getChildCount(root);
        for (let i = 0; i < layerCount; i++) layers.push(model.getChildAt(root, i));

        // Collect all tiler groups across all layers
        const allTGs = [];
        for (const layer of layers) allTGs.push(...collectAllTilerGroupsRec(layer));

        // Group by each tiler group's immediate parent
        const byParent = new Map();
        for (const tg of allTGs) {
            const p = model.getParent(tg);
            if (!byParent.has(p)) byParent.set(p, []);
            byParent.get(p).push(tg);
        }

        // Return only parents that have at least 2 tiler groups (eligible for clustering)
        const parents = [];
        for (const [p, arr] of byParent.entries()) if (arr.length >= 2) parents.push(p);

        // Fallback to current layer if nothing else qualifies (keeps behavior predictable)
        if (!parents.length) parents.push(currentLayer);
        return parents;
    }

    function refreshAllForSelectionOrAnchor() {
        const sel = graph.getSelectionCell();
        const selectedTilerGroup = findTilerGroupSelection(sel); // CHANGE
        const preferred = selectedTilerGroup ? selectedTilerGroup.id : null; // CHANGE
        lastSelectedTGId = preferred || null;

        // If no tiler group is selected, hide all cluster UI and restore baseline visuals.
        if (!lastSelectedTGId) { // CHANGE
            for (const [k] of clusterStates.entries()) {
                hideUIFor(k);
                clearVisibilityFor(k);
            }
            return;
        }

        // Drive clustering only for the selection's parent as before
        const selCell = model.getCell(lastSelectedTGId); // CHANGE
        const p = selCell ? model.getParent(selCell) : null;
        if (p) {
            refreshClustersInParent(p, preferred, lastSelectedTGId); // CHANGE
            // Prune clusters not under this parent
            for (const [k, st] of clusterStates.entries()) {
                if (!st.order.every(c => model.getParent(c) === p)) {
                    hideUIFor(k);
                    clearVisibilityFor(k);
                    clusterStates.delete(k);
                }
            }
            return;
        }

        // Fallback (rare): scan parents but still gate by selected id                 
        const parents = parentsToScan();
        const live = new Set();
        parents.forEach(par => {
            refreshClustersInParent(par, preferred, lastSelectedTGId); // CHANGE
            for (const k of clusterStates.keys()) live.add(k);
        });
        for (const [k, st] of clusterStates.entries()) {
            const exists = st.order.every(c => !!model.getCell(c.id));
            if (!exists) {
                hideUIFor(k);
                clearVisibilityFor(k);
                clusterStates.delete(k);
            }
        }
    }


    function repositionAllUI() {
        for (const [key, st] of clusterStates.entries()) {
            // Only reposition visible UI (selected cluster only)                      
            const hasVisibleUI = // NEW
                (st.btnPrev && st.btnPrev.style.display !== 'none') || // NEW
                (st.btnSelectAll && st.btnSelectAll.style.display !== 'none') || // CHANGE
                (st.btnSelectBed && st.btnSelectBed.style.display !== 'none') || // NEW
                (st.coveredTargetButtons && st.coveredTargetButtons.length > 0); // CHANGE
            if (!hasVisibleUI) continue; // CHANGE
            positionUIFor(key);
        }
    }


    // -------------------- Events --------------------
    let lastSelectedPlantingId = null;
    let lastSelectedPlantingParent = null;

    graph.getSelectionModel().addListener(mxEvent.CHANGE, function () {
        const sel = graph.getSelectionCell();
        const selectedCells = graph.getSelectionCells ? graph.getSelectionCells() : (sel ? [sel] : []); // NEW

        //if we previously brought beds to front, restore when leaving bed selection
        const selectionOnlyBeds = selectionIsOnlyGardenBeds(selectedCells); // CHANGE
        if (lastSelectedBedParent && !selectionOnlyBeds) { // CHANGE
            restoreChildOrder(lastSelectedBedParent);
            lastSelectedBedParent = null;
        }

        const selIsPlanting = sel && model.isVertex(sel) && isPlantingCell(sel);

        // If we just deselected a planting (or switched away), snap canopy in old parent
        if (lastSelectedPlantingId && (!selIsPlanting || sel.id !== lastSelectedPlantingId)) {
            scheduleCanopySnap(lastSelectedPlantingParent);
            lastSelectedPlantingId = null;
            lastSelectedPlantingParent = null;
        }

        // If selecting a planting, bring it to front (temporary) and remember it
        if (selIsPlanting) {
            (graph.__withUndoSuppressed || ((fn) => fn()))(() => {
                graph.orderCells(false, [sel]);
            });
            lastSelectedPlantingId = sel.id;
            lastSelectedPlantingParent = model.getParent(sel);
        }

        rafDebounce(refreshAllForSelectionOrAnchor);
    });

    graph.addListener(mxEvent.ADD_CELLS, function () { rafDebounce(refreshAllForSelectionOrAnchor); });
    graph.addListener(mxEvent.REMOVE_CELLS, function () { rafDebounce(refreshAllForSelectionOrAnchor); });
    graph.getModel().addListener(mxEvent.CHANGE, function (sender, evt) { // NEW
        const edit = evt.getProperty('edit'); // NEW
        const changes = edit && edit.changes ? edit.changes : []; // NEW
        const rotationChanged = changes.some(styleChangeTouchesRotation); // CHANGE
        if (rotationChanged) { // CHANGE
            invalidateBoundsCache(); // NEW
            rafDebounce(refreshAllForSelectionOrAnchor); // NEW
        } // NEW
    }); // NEW
    graph.getModel().addListener(mxEvent.UNDO, function () { rafDebounce(refreshAllForSelectionOrAnchor); });
    graph.getModel().addListener(mxEvent.REDO, function () { rafDebounce(refreshAllForSelectionOrAnchor); });

    graph.getView().addListener(mxEvent.SCALE_AND_TRANSLATE, function () {
        repositionAllUI();
    });
    graph.getView().addListener(mxEvent.REPAINT, function () {
        repositionAllUI();
    });

    graph.__trellisBedSuccessionNavigator = Object.assign({}, graph.__trellisBedSuccessionNavigator, { // NEW
        getSelectedClusterOccupancy: selectedClusterOccupancyFor // NEW
    }); // NEW

    // Init
    setTimeout(refreshAllForSelectionOrAnchor, 0);
});
