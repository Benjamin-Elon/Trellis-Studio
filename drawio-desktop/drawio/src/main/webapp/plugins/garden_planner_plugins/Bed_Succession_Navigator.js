/**
 * Draw.io Plugin: Tiler Group Overlap Navigator (Multi-Cluster, DOM Buttons)
 * - Builds bed-aware and outside-overlap succession clusters per parent.
 * - Keeps bed-contained clusters separate from outside overhang clusters.
 * - Each selected planting cluster gets an above-cluster Occupancy timeline.
 * - Non-active members of each cluster are rendered outline-only (fills/text/images hidden).
 * - Covered plant groups, clusters, and empty beds get DOM selector buttons.
 */
Draw.loadPlugin(function (ui) {
    const graph = ui.editor.graph;
    const model = graph.getModel();

    const TRELLIS_SELECTION_VISUALS_REFRESH_EVENT = 'trellisSelectionVisualsRefresh';

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
    const SELECT_BUTTON_GAP = 4;
    const SELECT_BUTTON_DRAG_HANDLE_SLOT = BTN_SIZE + SELECT_BUTTON_GAP;
    const MINI_RAIL_MIN_W = 380; // CHANGE: the above-cluster Occupancy panel needs room for row labels.
    const MINI_RAIL_MAX_W = 680; // CHANGE: full occupancy rows stay readable without covering excessive canvas width.
    const MINI_RAIL_GAP = 8; // CHANGE: attach the rail above the selected cluster with a small visual gap.
    const DAY_MS = 24 * 60 * 60 * 1000; // CHANGE: normalize occupancy windows for inclusive overlap checks.
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
    const GRAPH_OVERLAY_Z = Object.freeze({ ANNOTATION: 10000, CONNECTION: 10010, CONTROL: 10020, CONTROL_TOP: 10030 });

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

    const ICON_SELECT_ASSEMBLY = 'data:image/svg+xml;utf8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">' +
        '<circle cx="11" cy="11" r="10" fill="white" stroke="black" stroke-width="1"/>' +
        '<rect x="6" y="6" width="5" height="5" rx="1" fill="none" stroke="black" stroke-width="1.2"/>' +
        '<rect x="11" y="11" width="5" height="5" rx="1" fill="none" stroke="black" stroke-width="1.2"/>' +
        '<path d="M10.6 10.6 L11.4 11.4" stroke="black" stroke-width="1.2" stroke-linecap="round"/>' +
        '</svg>'
    );

    const TIME_ATTRS_ASC = ['transplant_date', 'sow_date'];
    const EPS = 0; // inclusive AABB; set >0 to treat near-miss as overlap

    const OVERLAP_MIN_PCT = 0.05;
    const OVERLAP_PCT_MODE = 'smaller';
    const BED_COVERAGE_MIN_PCT = 0.95;
    const COVERED_TARGET_MIN_PCT = 0.80;

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

    function isLodSummary(cell) {
        return !!cell && cell.getAttribute && cell.getAttribute('lod_summary') === '1';
    }

    function findTilerGroupSelection(cell) {
        let cur = cell;
        while (cur) {
            if (isTilerGroup(cur)) return cur;
            if (isLodSummary(cur)) {
                const parent = model.getParent(cur);
                return isTilerGroup(parent) ? parent : null;
            }
            cur = model.getParent(cur);
        }
        return null;
    }

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


    // -------------------- Rotation-aware geometry --------------------
    const GEOM_EPS = 0.000001;

    function toRad(deg) {
        return (Number(deg) || 0) * Math.PI / 180;
    }

    function rotateModelPoint(point, center, angleRad) {
        const dx = point.x - center.x;
        const dy = point.y - center.y;
        const cos = Math.cos(angleRad);
        const sin = Math.sin(angleRad);
        return {
            x: center.x + dx * cos - dy * sin,
            y: center.y + dx * sin + dy * cos
        };
    }

    function getCellRotationDeg(cell) {
        if (!cell) return 0;
        const style = graph.getCellStyle(cell) || {};
        const raw = style[mxConstants.STYLE_ROTATION] != null ? style[mxConstants.STYLE_ROTATION] : style.rotation;
        const n = Number(raw);
        return Number.isFinite(n) ? n : 0;
    }

    function getRotatedRectModel(cell) {
        const rect = getModelRect(cell);
        if (!rect || rect.w <= 0 || rect.h <= 0) return null;
        const center = rectCenterModel(rect);
        const angleDeg = getCellRotationDeg(cell);
        return {
            x: rect.x, y: rect.y, w: rect.w, h: rect.h,
            cx: center.x, cy: center.y, center: center,
            angleDeg: angleDeg, angleRad: toRad(angleDeg)
        };
    }

    function rotatedRectCorners(rotatedRect) {
        if (!rotatedRect) return [];
        const center = rotatedRect.center || { x: rotatedRect.cx, y: rotatedRect.cy };
        const corners = [
            { x: rotatedRect.x, y: rotatedRect.y },
            { x: rotatedRect.x + rotatedRect.w, y: rotatedRect.y },
            { x: rotatedRect.x + rotatedRect.w, y: rotatedRect.y + rotatedRect.h },
            { x: rotatedRect.x, y: rotatedRect.y + rotatedRect.h }
        ];
        return corners.map(p => rotateModelPoint(p, center, rotatedRect.angleRad));
    }

    function pointInRotatedRectModel(point, rotatedRect) {
        if (!point || !rotatedRect) return false;
        const center = rotatedRect.center || { x: rotatedRect.cx, y: rotatedRect.cy };
        const local = rotateModelPoint(point, center, -rotatedRect.angleRad);
        return local.x >= rotatedRect.x - GEOM_EPS &&
            local.x <= rotatedRect.x + rotatedRect.w + GEOM_EPS &&
            local.y >= rotatedRect.y - GEOM_EPS &&
            local.y <= rotatedRect.y + rotatedRect.h + GEOM_EPS;
    }

    function polygonSignedArea(poly) {
        if (!poly || poly.length < 3) return 0;
        let sum = 0;
        for (let i = 0; i < poly.length; i++) {
            const a = poly[i];
            const b = poly[(i + 1) % poly.length];
            sum += a.x * b.y - a.y * b.x;
        }
        return sum / 2;
    }

    function polygonArea(poly) {
        return Math.abs(polygonSignedArea(poly));
    }

    function edgeCross(edgeStart, edgeEnd, point) {
        return (edgeEnd.x - edgeStart.x) * (point.y - edgeStart.y) - (edgeEnd.y - edgeStart.y) * (point.x - edgeStart.x);
    }

    function isInsideClipEdge(point, edgeStart, edgeEnd, clipSign) {
        const cross = edgeCross(edgeStart, edgeEnd, point);
        return clipSign >= 0 ? cross >= -GEOM_EPS : cross <= GEOM_EPS;
    }

    function lineIntersection(a, b, c, d) {
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const cdx = d.x - c.x;
        const cdy = d.y - c.y;
        const denom = abx * cdy - aby * cdx;
        if (Math.abs(denom) <= GEOM_EPS) return b;
        const t = ((c.x - a.x) * cdy - (c.y - a.y) * cdx) / denom;
        return { x: a.x + abx * t, y: a.y + aby * t };
    }

    function convexPolygonIntersection(subject, clip) {
        if (!subject || subject.length < 3 || !clip || clip.length < 3) return [];
        let output = subject.slice();
        const clipSign = polygonSignedArea(clip) >= 0 ? 1 : -1;
        for (let i = 0; i < clip.length; i++) {
            const edgeStart = clip[i];
            const edgeEnd = clip[(i + 1) % clip.length];
            const input = output;
            output = [];
            if (!input.length) break;
            let prev = input[input.length - 1];
            let prevInside = isInsideClipEdge(prev, edgeStart, edgeEnd, clipSign);
            for (const curr of input) {
                const currInside = isInsideClipEdge(curr, edgeStart, edgeEnd, clipSign);
                if (currInside) {
                    if (!prevInside) output.push(lineIntersection(prev, curr, edgeStart, edgeEnd));
                    output.push(curr);
                } else if (prevInside) {
                    output.push(lineIntersection(prev, curr, edgeStart, edgeEnd));
                }
                prev = curr;
                prevInside = currInside;
            }
        }
        return output;
    }

    function rotatedRectIntersectionArea(a, b) {
        const pa = rotatedRectCorners(a);
        const pb = rotatedRectCorners(b);
        const intersection = convexPolygonIntersection(pa, pb);
        const area = polygonArea(intersection);
        return area > GEOM_EPS ? area : 0;
    }

    function segmentIntersectionPoint(a, b, c, d) {
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const cdx = d.x - c.x;
        const cdy = d.y - c.y;
        const denom = abx * cdy - aby * cdx;
        if (Math.abs(denom) <= GEOM_EPS) return null;
        const t = ((c.x - a.x) * cdy - (c.y - a.y) * cdx) / denom;
        const u = ((c.x - a.x) * aby - (c.y - a.y) * abx) / denom;
        if (t < -GEOM_EPS || t > 1 + GEOM_EPS || u < -GEOM_EPS || u > 1 + GEOM_EPS) return null;
        return { x: a.x + abx * t, y: a.y + aby * t };
    }

    function polygonEdges(poly) {
        const edges = [];
        if (!poly || poly.length < 2) return edges;
        for (let i = 0; i < poly.length; i++) edges.push([poly[i], poly[(i + 1) % poly.length]]);
        return edges;
    }

    function polygonVerticalIntervalAt(poly, x) {
        if (!poly || poly.length < 3) return null;
        const ys = [];
        for (const edge of polygonEdges(poly)) {
            const a = edge[0], b = edge[1];
            const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
            if (x < minX - GEOM_EPS || x > maxX + GEOM_EPS) continue;
            if (Math.abs(a.x - b.x) <= GEOM_EPS) {
                ys.push(a.y, b.y);
            } else {
                const t = (x - a.x) / (b.x - a.x);
                if (t >= -GEOM_EPS && t <= 1 + GEOM_EPS) ys.push(a.y + (b.y - a.y) * t);
            }
        }
        if (ys.length < 2) return null;
        ys.sort((a, b) => a - b);
        return { y1: ys[0], y2: ys[ys.length - 1] };
    }

    function mergedIntervalLength(intervals) {
        const sorted = intervals.filter(Boolean).sort((a, b) => a.y1 - b.y1);
        if (!sorted.length) return 0;
        let total = 0;
        let start = sorted[0].y1, end = sorted[0].y2;
        for (let i = 1; i < sorted.length; i++) {
            const cur = sorted[i];
            if (cur.y1 <= end + GEOM_EPS) {
                end = Math.max(end, cur.y2);
            } else {
                total += Math.max(0, end - start);
                start = cur.y1;
                end = cur.y2;
            }
        }
        total += Math.max(0, end - start);
        return total;
    }

    function unionAreaOfConvexPolygons(polys) {
        const clipped = (polys || []).filter(poly => poly && poly.length >= 3 && polygonArea(poly) > GEOM_EPS);
        if (!clipped.length) return 0;
        const xs = [];
        for (const poly of clipped) for (const p of poly) xs.push(p.x);
        for (let i = 0; i < clipped.length; i++) {
            const edgesA = polygonEdges(clipped[i]);
            for (let j = i + 1; j < clipped.length; j++) {
                const edgesB = polygonEdges(clipped[j]);
                for (const a of edgesA) for (const b of edgesB) {
                    const p = segmentIntersectionPoint(a[0], a[1], b[0], b[1]);
                    if (p) xs.push(p.x);
                }
            }
        }
        const sortedXs = Array.from(new Set(xs.map(x => Math.round(x / GEOM_EPS) * GEOM_EPS))).sort((a, b) => a - b);
        let area = 0;
        for (let i = 0; i < sortedXs.length - 1; i++) {
            const x1 = sortedXs[i], x2 = sortedXs[i + 1];
            const width = x2 - x1;
            if (width <= GEOM_EPS) continue;
            const pad = Math.min(width * 0.000001, GEOM_EPS);
            const leftX = x1 + pad;
            const rightX = x2 - pad;
            const leftLen = mergedIntervalLength(clipped.map(poly => polygonVerticalIntervalAt(poly, leftX)));
            const rightLen = mergedIntervalLength(clipped.map(poly => polygonVerticalIntervalAt(poly, rightX)));
            area += width * (leftLen + rightLen) / 2;
        }
        return area > GEOM_EPS ? area : 0;
    }

    function coveredAreaOfTargetByCells(targetCell, coverCells) {
        const targetRect = getRotatedRectModel(targetCell);
        if (!targetRect) return 0;
        const targetPoly = rotatedRectCorners(targetRect);
        const clippedPolys = [];
        for (const cover of (coverCells || [])) {
            const coverRect = getRotatedRectModel(cover);
            if (!coverRect) continue;
            const clipped = convexPolygonIntersection(rotatedRectCorners(coverRect), targetPoly);
            if (clipped.length >= 3 && polygonArea(clipped) > GEOM_EPS) clippedPolys.push(clipped);
        }
        return unionAreaOfConvexPolygons(clippedPolys);
    }

    function targetCoverageFractionByCells(targetCell, coverCells) {
        const targetRect = getRotatedRectModel(targetCell);
        const targetArea = rectAreaModel(targetRect);
        if (targetArea <= 0) return 0;
        return Math.min(1, coveredAreaOfTargetByCells(targetCell, coverCells) / targetArea);
    }

    function coverageFractionOfTargetCellsByCoverCells(targetCells, coverCells) {
        const targetPolys = [];
        for (const target of (targetCells || [])) {
            const targetRect = getRotatedRectModel(target);
            if (targetRect) targetPolys.push(rotatedRectCorners(targetRect));
        }
        const targetArea = unionAreaOfConvexPolygons(targetPolys);
        if (targetArea <= 0) return 0;

        const coveredPolys = [];
        for (const cover of (coverCells || [])) {
            const coverRect = getRotatedRectModel(cover);
            if (!coverRect) continue;
            const coverPoly = rotatedRectCorners(coverRect);
            for (const targetPoly of targetPolys) {
                const clipped = convexPolygonIntersection(coverPoly, targetPoly);
                if (clipped.length >= 3 && polygonArea(clipped) > GEOM_EPS) coveredPolys.push(clipped);
            }
        }

        return Math.min(1, unionAreaOfConvexPolygons(coveredPolys) / targetArea);
    }

    function significantOverlapRotatedRects(a, b) {
        if (!a || !b) return false;
        const ia = rotatedRectIntersectionArea(a, b);
        if (ia <= 0) return false;
        const aa = rectAreaModel(a), ab = rectAreaModel(b);
        if (aa <= 0 || ab <= 0) return false;

        let denom;
        if (OVERLAP_PCT_MODE === 'union') {
            denom = aa + ab - ia;
        } else {
            denom = Math.min(aa, ab);
        }
        if (denom <= 0) return false;
        return ia / denom >= OVERLAP_MIN_PCT;
    }

    function significantOverlapCells(a, b) {
        return significantOverlapRotatedRects(getRotatedRectModel(a), getRotatedRectModel(b));
    }

    function rotationValueFromStyleString(styleText) {
        if (typeof styleText !== 'string') return null;
        const parts = styleText.split(';');
        for (const part of parts) {
            const idx = part.indexOf('=');
            if (idx <= 0) continue;
            const key = part.slice(0, idx);
            if (key === mxConstants.STYLE_ROTATION || key === 'rotation') return part.slice(idx + 1);
        }
        return null;
    }

    function styleChangeTouchesRotation(change) {
        if (!change) return false;
        if (change.key === mxConstants.STYLE_ROTATION || change.key === 'rotation') return true;
        const before = rotationValueFromStyleString(change.previous);
        const after = rotationValueFromStyleString(change.style);
        return before !== after;
    }

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

    function isIrrigationBedAssembly(cell) {
        return !!cell && !!cell.getAttribute && cell.getAttribute('irrigation_assembly') === '1' && cell.getAttribute('irrigation_assembly_type') === 'bed';
    }

    function findIrrigationBedAssemblyAncestor(cell) {
        let cur = cell;
        while (cur) {
            if (isIrrigationBedAssembly(cur)) return cur;
            cur = model.getParent(cur);
        }
        return null;
    }

    function rectContainsPoint(r, px, py) {
        if (!r) return false;
        return px >= r.x && px <= (r.x + r.w) && py >= r.y && py <= (r.y + r.h);
    }

    function rectCenter(r) {
        return (!r) ? null : { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    }

    function findSmallestContainingBed(beds, bedBounds, point) {
        if (!point) return null;
        let chosen = null;
        let chosenArea = Infinity;
        for (let k = 0; k < beds.length; k++) {
            const bed = beds[k];
            const rr = getRotatedRectModel(bed);
            if (!rr && !bedBounds[k]) continue;
            const contains = rr ? pointInRotatedRectModel(point, rr) : rectContainsPoint(bedBounds[k], point.x, point.y);
            if (contains) {
                const a = rr ? rectAreaModel(rr) : rectArea(bedBounds[k]);
                if (a > 0 && a < chosenArea) {
                    chosenArea = a;
                    chosen = bed;
                }
            }
        }
        return chosen;
    }

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

    // -------------------- Model-space geometry helpers --------------------

    function getModelRect(cell) {
        const g = cell ? model.getGeometry(cell) : null;
        if (!g) return null;
        return {
            x: Number(g.x) || 0,
            y: Number(g.y) || 0,
            w: Number(g.width) || 0,
            h: Number(g.height) || 0
        };
    }

    function rectCenterModel(rect) {
        return rect ? { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 } : null;
    }

    function rectAreaModel(rect) {
        return rect ? Math.max(0, rect.w) * Math.max(0, rect.h) : 0;
    }

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
        rafDebounce(refreshAllForSelectionOrAnchor);
    });

    graph.addListener(mxEvent.CELLS_RESIZED, function () {
        rafDebounce(refreshAllForSelectionOrAnchor);
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
    
        withUndoSuppressed(() => {
            model.beginUpdate();
            try {
                graph.setCellStyles('fillOpacity', fillV, cells);
                graph.setCellStyles('textOpacity', textV, cells);
                graph.setCellStyles('imageOpacity', imgV, cells);
                graph.setCellStyles('strokeOpacity', stroke, cells);
            } finally {
                model.endUpdate();
            }
        });
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
    // key -> { order: mxCell[], currentIdx: number, anchorId: string, btnPrev, btnNext, miniRail, dimmed:Set<mxCell> }
    const clusterStates = new Map();
    const bedUnitSelectorState = { btnSelectBed: null, btnSelectPlantings: null, btnSelectBedAssembly: null, unit: null };

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

    function coverageSetKey(ids) {
        return (ids || []).slice().sort().join('|');
    }

    function classifyTilerGroupForBeds(groupCell, beds) {
        const rect = getRotatedRectModel(groupCell);
        const containingBed = rect ? findSmallestContainingBed(beds, [], rect.center) : null;
        if (containingBed && containingBed.id) {
            return { type: 'contained', bedId: containingBed.id, coveredBedIds: [], coveredSetKey: '' };
        }

        const coveredBedIds = [];
        for (const bed of beds) {
            if (!bed || !bed.id) continue;
            if (targetCoverageFractionByCells(bed, [groupCell]) >= BED_COVERAGE_MIN_PCT) coveredBedIds.push(bed.id);
        }

        return {
            type: coveredBedIds.length ? 'outside-covered' : 'outside',
            bedId: null,
            coveredBedIds,
            coveredSetKey: coverageSetKey(coveredBedIds)
        };
    }

    function shouldClusterTilerGroups(a, b) {
        return significantOverlapCells(a, b);
    }

    function buildAllComponentsInParent(parent) {
        const nodes = getSiblingsInParent(parent);
        const n = nodes.length;
        if (n < 1) return [];

        const adj = Array.from({ length: n }, () => []);

        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                if (shouldClusterTilerGroups(nodes[i], nodes[j])) {
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
            comps.push(comp);
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
                miniRail: null, // CHANGE: Mini Rail replaces the old 1/N badge.
                miniRailHeight: 0, // CHANGE: jsdom and draw.io overlays both need deterministic positioning.
                dimmed: new Set(),
                btnDrag: null,
                btnSelectAll: null,
                btnSelectBed: null,
                coveredTargetButtons: [],
            };
            clusterStates.set(key, st);
        } else {
            const oldAnchor = st.anchorId;
            st.order = order;
            const preferredIdx = preferredAnchorId ? order.findIndex(c => c.id === preferredAnchorId) : -1;
            const k = preferredIdx >= 0 ? preferredIdx : order.findIndex(c => c.id === oldAnchor);
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

    function dateAttrISO(cell, attr) {
        const raw = cell && cell.getAttribute ? cell.getAttribute(attr) : null;
        const date = parseISO(raw);
        return date ? date.toISOString().slice(0, 10) : null;
    }

    function plantingOccupancyWindowOf(cell) {
        const perennial = cell && cell.getAttribute && (cell.getAttribute('perennial') === '1' || cell.getAttribute('lifespan_start'));
        const startISO = perennial ? dateAttrISO(cell, 'lifespan_start') : (dateAttrISO(cell, 'transplant_date') || dateAttrISO(cell, 'sow_date'));
        const endISO = perennial ? dateAttrISO(cell, 'lifespan_end') : dateAttrISO(cell, 'harvest_end');
        const start = startISO ? parseISO(startISO) : null;
        const end = endISO ? parseISO(endISO) : null;
        return start && end && end >= start ? { startISO, endISO } : { startISO: null, endISO: null };
    }

    function derivedRelationshipFor(member, selected) {
        if (!member || !selected || !member.getAttribute) return null;
        const selectedId = String(selected.id || '');
        const memberId = String(member.id || '');
        const selectedSourceId = String(selected.getAttribute?.('derived_source_group_id') || '').trim();
        const derivedCell = String(member.getAttribute('derived_source_group_id') || '').trim() === selectedId
            ? member
            : (selectedSourceId && selectedSourceId === memberId ? selected : null);
        if (!derivedCell || !derivedCell.getAttribute) return null;
        const mode = String(derivedCell.getAttribute('derived_mode') || '').trim();
        if (!mode) return null;
        if (mode === 'companion') {
            return {
                mode,
                relationId: String(derivedCell.getAttribute('companion_relation_id') || ''),
                rating: String(derivedCell.getAttribute('companion_rating') || ''),
                companionType: String(derivedCell.getAttribute('companion_type') || ''),
                startOffsetDays: String(derivedCell.getAttribute('companion_start_offset_days') || ''),
                recommendedStartOffsetDays: String(derivedCell.getAttribute('companion_recommended_start_offset_days') || '')
            }; // CHANGE: selected-cluster context restores persisted companion relationship snapshots without inferring persistence for ordinary overlaps.
        }
        if (mode === 'turnover') {
            return { mode, gapDays: String(derivedCell.getAttribute('turnover_gap_days') || '') };
        }
        return null;
    }

    function plantingOccupancyLabel(cell) {
        const plant = cell && cell.getAttribute ? (cell.getAttribute('plant_name') || cell.getAttribute('crop_name') || '') : '';
        const variety = cell && cell.getAttribute ? (cell.getAttribute('variety_name') || cell.getAttribute('variety') || '') : '';
        if (plant && variety) return plant + ' - ' + variety;
        return plant || variety || (cell && cell.getAttribute && (cell.getAttribute('label') || cell.getAttribute('title'))) || (cell && cell.id) || 'Planting';
    }

    function plantingOccupancyCropName(cell) {
        return cell && cell.getAttribute ? String(cell.getAttribute('plant_name') || cell.getAttribute('crop_name') || '').trim() : ''; // CHANGE: scheduler start hints need crop-only labels.
    }

    function plantingOccupancyVarietyName(cell) {
        return cell && cell.getAttribute ? String(cell.getAttribute('variety_name') || cell.getAttribute('variety') || '').trim() : ''; // CHANGE: duplicate crop names can be disambiguated without lengthening every label.
    }

    function isPerennialPlanting(cell) {
        return !!(cell && cell.getAttribute && (cell.getAttribute('perennial') === '1' || cell.getAttribute('lifespan_start'))); // CHANGE: rail display needs perennial-specific clipping while true occupancy remains multi-year.
    }

    function dayNumberFromISO(iso) {
        const date = parseISO(iso);
        return date ? Math.floor(+date / DAY_MS) : null; // CHANGE: compare date-only occupancy ranges inclusively.
    }

    function occupancyRangeFromISO(startISO, endISO) {
        const startDay = dayNumberFromISO(startISO);
        const endDay = dayNumberFromISO(endISO);
        if (startDay == null || endDay == null || endDay < startDay) return null; // CHANGE: incomplete dates are undated, not active.
        return { startISO, endISO, startDay, endDay };
    }

    function trueOccupancyRangeForCell(cell) {
        const window = plantingOccupancyWindowOf(cell);
        return occupancyRangeFromISO(window.startISO, window.endISO); // CHANGE: full perennial lifespan remains the true occupancy range.
    }

    function occupancyRangeForCell(cell) {
        return trueOccupancyRangeForCell(cell); // CHANGE: preserve the existing API semantics for active overlap callers.
    }

    function occupancyRangesOverlap(left, right) {
        return !!(left && right && left.startDay <= right.endDay && right.startDay <= left.endDay); // CHANGE: inclusive temporal overlap.
    }

    function yearRange(year) {
        const y = Math.trunc(Number(year));
        if (!Number.isFinite(y)) return null;
        return occupancyRangeFromISO(y + '-01-01', y + '-12-31'); // CHANGE: perennial-only clusters use a stable current-year rail.
    }

    function rangeYear(range) {
        return range && range.startISO ? Math.trunc(Number(String(range.startISO).slice(0, 4))) : NaN;
    }

    function seasonStartYearOf(cell) {
        const year = Math.trunc(Number(cell && cell.getAttribute && cell.getAttribute('season_start_year')));
        return Number.isFinite(year) ? year : NaN;
    }

    function resolveMiniRailYear(cells, selected, selectedRange) {
        const selectedYear = seasonStartYearOf(selected);
        if (Number.isFinite(selectedYear)) return selectedYear;
        for (const cell of (cells || [])) {
            const year = seasonStartYearOf(cell);
            if (Number.isFinite(year)) return year;
        }
        const rangeStartYear = rangeYear(selectedRange);
        if (Number.isFinite(rangeStartYear)) return rangeStartYear;
        return new Date().getFullYear(); // CHANGE: final fallback only when cluster data has no usable year.
    }

    function clampRangeToSpan(range, span) {
        if (!range || !span || range.startDay > span.maxDay || span.minDay > range.endDay) return null;
        const startDay = Math.max(range.startDay, span.minDay != null ? span.minDay : span.startDay);
        const endDay = Math.min(range.endDay, span.maxDay != null ? span.maxDay : span.endDay);
        if (endDay < startDay) return null;
        const startISO = startDay === range.startDay ? range.startISO : isoFromDayNumber(startDay);
        const endISO = endDay === range.endDay ? range.endISO : isoFromDayNumber(endDay);
        return { startISO, endISO, startDay, endDay }; // CHANGE: display clipping does not change true occupancy.
    }

    function isoFromDayNumber(dayNumber) {
        return new Date(Math.trunc(dayNumber) * DAY_MS).toISOString().slice(0, 10);
    }

    function miniRailAxisSpanForItems(items, year) {
        const yr = yearRange(year);
        const annualRanges = (items || [])
            .filter(item => !item.perennial && item.trueRange && (!yr || occupancyRangesOverlap(item.trueRange, yr)))
            .map(item => item.trueRange);
        if (annualRanges.length) {
            return {
                minDay: Math.min.apply(null, annualRanges.map(range => range.startDay)),
                maxDay: Math.max.apply(null, annualRanges.map(range => range.endDay))
            }; // CHANGE: non-perennial crop windows define the axis, including cross-year windows.
        }
        if (yr) return { minDay: yr.startDay, maxDay: yr.endDay }; // CHANGE: perennial-only fallback avoids multi-year compression.
        return null;
    }

    function miniRailItemForCell(cell, selectedId, selectedRange) {
        const trueRange = trueOccupancyRangeForCell(cell);
        const isSelected = !!cell && String(cell.id || '') === String(selectedId || '');
        return {
            cell,
            cellId: cell && cell.id || '',
            label: plantingOccupancyLabel(cell),
            perennial: isPerennialPlanting(cell),
            trueRange,
            range: trueRange,
            displayRange: trueRange,
            selected: isSelected,
            active: isSelected || (!!trueRange && !!selectedRange && occupancyRangesOverlap(trueRange, selectedRange)) // CHANGE: active means selected or overlapping the selected true occupancy window.
        };
    }

    function miniRailItemsForState(st) {
        const selected = st && st.order && st.order[st.currentIdx] || null;
        const selectedId = selected && selected.id || '';
        const selectedRange = trueOccupancyRangeForCell(selected);
        const items = (st && st.order || []).map(cell => miniRailItemForCell(cell, selectedId, selectedRange));
        const year = resolveMiniRailYear(st && st.order || [], selected, selectedRange);
        const span = miniRailAxisSpanForItems(items, year);
        items.forEach(item => {
            item.displayRange = item.perennial ? clampRangeToSpan(item.trueRange, span) : (span ? clampRangeToSpan(item.trueRange, span) : item.trueRange); // CHANGE: perennials display inside the rail span instead of stretching it.
            item.range = item.displayRange; // CHANGE: keep existing bar rendering paths pointed at display range.
        });
        return items;
    }

    function activeCellsForClusterState(st) {
        return miniRailItemsForState(st).filter(item => item.active).map(item => item.cell).filter(Boolean); // CHANGE: share the rail's temporal model with canvas visibility.
    }

    function orderedOccupancyItemsForCells(cells, selected) {
        const selectedId = selected && selected.id || '';
        const selectedRange = trueOccupancyRangeForCell(selected);
        return orderComponentByTime(cells || []).map(member => {
            const window = plantingOccupancyWindowOf(member);
            const range = trueOccupancyRangeForCell(member);
            return {
                cellId: member.id,
                label: plantingOccupancyLabel(member),
                cropName: plantingOccupancyCropName(member), // CHANGE: expose crop-only labels for scheduler relationship hints.
                varietyName: plantingOccupancyVarietyName(member), // CHANGE: allow duplicate crop-name disambiguation.
                startISO: window.startISO,
                endISO: window.endISO,
                active: String(member.id || '') === String(selectedId || '') || (!!range && !!selectedRange && occupancyRangesOverlap(range, selectedRange)), // CHANGE: bed-primary APIs expose the same active overlap rule as the navigator.
                relationship: derivedRelationshipFor(member, selected)
            };
        });
    }

    function selectedBedOccupancyRecordFor(selected) {
        const bed = resolveOccupiedBedAnchor(selected);
        if (!bed) return null;
        const cells = containedPlantingGroupsForBed(bed);
        if (!cells.some(member => member && member.id === selected.id)) return null;
        return { bed, cells: orderComponentByTime(cells), bounds: getAbsBounds(bed) }; // CHANGE: containing bed is the authoritative companion context when available.
    }

    function miniRailDateTitle(item) {
        if (!item || !item.trueRange) return (item && item.label || 'Planting') + ' - Undated';
        const title = item.label + ' - ' + item.trueRange.startISO + ' to ' + item.trueRange.endISO;
        return item.perennial && item.displayRange ? title + ' (shown clipped to visible year span)' : title; // CHANGE: tooltip keeps full perennial lifespan while explaining clipping.
    }

    function selectedClusterOccupancyFor(cell) {
        const selected = findTilerGroupSelection(cell || graph.getSelectionCell());
        if (!selected) return { selectedId: null, scope: 'cluster', items: [] };
        const parent = model.getParent(selected);
        const components = parent ? buildAllComponentsInParent(parent) : [];
        const component = components.find(members => members.some(member => member && member.id === selected.id)) || [selected];
        const order = orderComponentByTime(component);
        return {
            selectedId: selected.id,
            scope: 'cluster',
            items: orderedOccupancyItemsForCells(order, selected)
        }; // CHANGE: scheduler relationship context follows the spatial overlap cluster, including overhanging plantings outside the bed.
    }

    function selectedBedOccupancyFor(cell) {
        const selected = findTilerGroupSelection(cell || graph.getSelectionCell());
        if (!selected) return { selectedId: null, scope: 'bed', bedId: '', items: [] };
        const bedRecord = selectedBedOccupancyRecordFor(selected);
        if (bedRecord) {
            return {
                selectedId: selected.id,
                scope: 'bed',
                bedId: bedRecord.bed.id || '',
                items: orderedOccupancyItemsForCells(bedRecord.cells, selected),
                bedBounds: bedRecord.bounds
            };
        }
        return { selectedId: selected.id, scope: 'bed', bedId: '', items: [], bedBounds: null }; // CHANGE: bed-only occupancy uses center-in-bed containment instead of overlap clustering.
    }

    function selectedClusterRecordFor(cell) {
        const selected = findTilerGroupSelection(cell || graph.getSelectionCell());
        if (!selected) return null;
        const parent = model.getParent(selected);
        const components = parent ? buildAllComponentsInParent(parent) : [];
        const component = components.find(members => members.some(member => member && member.id === selected.id)) || [selected];
        const ensured = ensureClusterState(component, selected.id);
        return { selected, key: ensured.key, st: ensured.st, component };
    }

    function selectedClusterLayoutContextFor(cell) {
        const record = selectedClusterRecordFor(cell);
        if (!record) return { selectedId: null, cellIds: [], enabledIds: [], clusterBounds: null, bedBounds: null };
        const bedRecord = selectedBedOccupancyRecordFor(record.selected);
        if (bedRecord) {
            const activeIds = orderedOccupancyItemsForCells(bedRecord.cells, record.selected)
                .filter(item => item.active)
                .map(item => String(item.cellId || ''))
                .filter(Boolean);
            return {
                selectedId: record.selected.id,
                scope: 'bed',
                bedId: bedRecord.bed.id || '',
                cellIds: bedRecord.cells.map(member => String(member.id || '')).filter(Boolean),
                enabledIds: activeIds,
                clusterBounds: getClusterBBox(record.key), // CHANGE: panel placement follows the selected geometric cluster, not the containing bed.
                bedBounds: bedRecord.bounds // CHANGE: bed bounds remain available for bed-scoped companion/default context.
            };
        }
        const activeIds = new Set(activeCellsForClusterState(record.st).map(member => String(member.id || '')));
        if (record.selected && record.selected.id) activeIds.add(String(record.selected.id));
        return {
            selectedId: record.selected.id,
            scope: 'cluster',
            cellIds: (record.st.order || []).map(member => String(member.id || '')).filter(Boolean),
            enabledIds: Array.from(activeIds),
            clusterBounds: getClusterBBox(record.key), // CHANGE: overlay positioning uses cluster bounds only, reserving above-cluster space deterministically.
            bedBounds: null
        };
    }

    // -------------------- Per-cluster UI helpers --------------------
    function styleBtn(el) {
        el.style.position = 'absolute';
        el.style.width = BTN_SIZE + 'px';
        el.style.height = BTN_SIZE + 'px';
        el.style.zIndex = String(GRAPH_OVERLAY_Z.CONTROL);
        el.style.cursor = 'pointer';
        el.style.pointerEvents = 'auto';
    }

    function styleSelectBtn(el) {
        el.style.position = 'absolute';
        el.style.width = BTN_SIZE + 'px';
        el.style.height = BTN_SIZE + 'px';
        el.style.zIndex = String(GRAPH_OVERLAY_Z.CONTROL);
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

    function currentSelectionCells() {
        return graph.getSelectionCells ? (graph.getSelectionCells() || []) : (graph.getSelectionCell && graph.getSelectionCell() ? [graph.getSelectionCell()] : []);
    }

    function sameCellSet(a, b) {
        const left = (a || []).map(c => c && c.id).filter(Boolean).sort();
        const right = (b || []).map(c => c && c.id).filter(Boolean).sort();
        if (left.length !== right.length) return false;
        for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
        return true;
    }

    function bedUnitSelectorButton(name, src, alt, title) {
        const host = getHost();
        let b = bedUnitSelectorState[name];
        if (!b) {
            b = document.createElement('img');
            styleSelectBtn(b);
            b.draggable = false;
            b.addEventListener('pointerdown', consumeEvt, { passive: false });
            b.addEventListener('mousedown', consumeEvt, { passive: false });
            b.addEventListener('click', function (evt) { consumeEvt(evt); selectBedUnitTarget(name); });
            bedUnitSelectorState[name] = b;
        }
        b.src = src;
        b.alt = alt;
        b.title = title;
        if (b.parentNode !== host) host.appendChild(b);
        return b;
    }

    function hideBedUnitSelectors() {
        ['btnSelectBed', 'btnSelectPlantings', 'btnSelectBedAssembly'].forEach(name => {
            const b = bedUnitSelectorState[name];
            if (b) b.style.display = 'none';
        });
        bedUnitSelectorState.unit = null;
    }

    function visibleBedUnitSelectorCount() {
        return ['btnSelectBed', 'btnSelectPlantings', 'btnSelectBedAssembly'].reduce((count, name) => {
            const b = bedUnitSelectorState[name];
            return count + (b && b.style.display !== 'none' ? 1 : 0);
        }, 0);
    }

    function selectBedUnitCells(cells, bringToFront) {
        const selected = (cells || []).filter(Boolean);
        if (!selected.length) return;
        const parent = model.getParent(selected[0]);
        if (bringToFront) bringCellsToFrontTemporarilyInParent(parent, selected);
        graph.setSelectionCells(selected);
        if (parent) graph.refresh(parent); else graph.refresh();
        hideBedUnitSelectors();
    }

    function bedUnitTargetCells(name) {
        const unit = bedUnitSelectorState.unit;
        if (!unit) return [];
        if (name === 'btnSelectBed') return unit.bed ? [unit.bed] : [];
        if (name === 'btnSelectPlantings') return unit.plantingGroups || [];
        if (name === 'btnSelectBedAssembly') return unit.bedAssemblies || [];
        return [];
    }

    function selectBedUnitTarget(name) {
        selectBedUnitCells(bedUnitTargetCells(name), name === 'btnSelectBed' || name === 'btnSelectBedAssembly');
    }

    function updateBedUnitSelectorButton(name, targetCells, src, alt, title) {
        const target = (targetCells || []).filter(Boolean);
        const b = bedUnitSelectorButton(name, src, alt, title);
        b.style.display = target.length && !sameCellSet(currentSelectionCells(), target) ? '' : 'none';
        return b;
    }

    function renderBedUnitSelectors(unit) {
        hideBedUnitSelectors();
        if (!unit || !unit.bed || !unit.cells || unit.cells.length < 2) return;
        bedUnitSelectorState.unit = unit;
        updateBedUnitSelectorButton('btnSelectBed', [unit.bed], ICON_SELECT_BEDS, 'Select bed', 'Select containing garden bed');
        updateBedUnitSelectorButton('btnSelectPlantings', unit.plantingGroups, ICON_SELECT, 'Select plantings', 'Select planting groups in this bed');
        updateBedUnitSelectorButton('btnSelectBedAssembly', unit.bedAssemblies, ICON_SELECT_ASSEMBLY, 'Select irrigation assembly', 'Select bed irrigation assembly');
        positionBedUnitSelectors();
    }

    function bedUnitPlantingsMatchCluster(members) {
        return sameCellSet(members, bedUnitTargetCells('btnSelectPlantings'));
    }

    function positionBedUnitSelectors() {
        const unit = bedUnitSelectorState.unit;
        const box = unit && viewBBoxForCells(unit.cells);
        if (!box) { hideBedUnitSelectors(); return; }
        const visible = ['btnSelectBed', 'btnSelectPlantings', 'btnSelectBedAssembly'].map(name => bedUnitSelectorState[name]).filter(b => b && b.style.display !== 'none');
        const baseX = Math.max(0, Math.round(box.x - BTN_SIZE - BTN_INSET + SELECT_BUTTON_DRAG_HANDLE_SLOT));
        const y = Math.round(box.y - BTN_SIZE - BTN_INSET);
        visible.forEach((b, index) => {
            b.style.left = Math.round(baseX + index * (BTN_SIZE + SELECT_BUTTON_GAP)) + 'px';
            b.style.top = y + 'px';
        });
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

    function containedBedForCluster(key) {
        const st = clusterStates.get(key); if (!st || !st.order || !st.order.length) return null;
        const parent = model.getParent(st.order[0]);
        if (!parent) return null;
        const beds = (graph.getChildVertices(parent) || []).filter(isGardenBed);
        const bedId = containedBedIdForComponent(st.order, beds);
        if (!bedId) return null;
        const bed = model.getCell(bedId);
        return bed && model.isVertex(bed) && isGardenBed(bed) ? bed : null;
    }

    function selectContainedBedForCluster(key) {
        const st = clusterStates.get(key); if (!st || !st.order || !st.order.length) return;
        const bed = containedBedForCluster(key);
        if (!bed) return;
        const parent = model.getParent(st.order[0]);
        bringCellsToFrontTemporarilyInParent(parent, [bed]);
        clearVisibilityFor(key);
        graph.setSelectionCells([bed]);
        if (parent) graph.refresh(parent); else graph.refresh();
        hideUIFor(key);
    }

    function ensureContainedBedSelectorFor(key) {
        const host = getHost();
        const st = clusterStates.get(key); if (!st) return;
        const bed = containedBedForCluster(key);
        if (!bed) {
            if (st.btnSelectBed) st.btnSelectBed.style.display = 'none';
            return;
        }

        if (!st.btnSelectBed) {
            const b = document.createElement('img');
            b.src = ICON_SELECT_BEDS;
            b.alt = 'Select bed';
            styleSelectBtn(b);
            b.title = 'Select containing garden bed';
            b.draggable = false;
            b.addEventListener('pointerdown', consumeEvt, { passive: false });
            b.addEventListener('mousedown', consumeEvt, { passive: false });
            b.addEventListener('click', function (evt) {
                consumeEvt(evt);
                selectContainedBedForCluster(key);
            });
            host.appendChild(b);
            st.btnSelectBed = b;
        } else if (st.btnSelectBed.parentNode !== host) {
            host.appendChild(st.btnSelectBed);
        }

        st.btnSelectBed.style.display = '';
    }

    function removeCoveredTargetSelectorsFor(key) {
        const st = clusterStates.get(key); if (!st) return;
        for (const item of (st.coveredTargetButtons || [])) {
            if (item.el && item.el.parentNode) item.el.parentNode.removeChild(item.el);
        }
        st.coveredTargetButtons = [];
    }

    function viewBBoxForCells(cells) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const cell of (cells || [])) {
            const s = getState(cell);
            if (!s) continue;
            minX = Math.min(minX, s.x);
            minY = Math.min(minY, s.y);
            maxX = Math.max(maxX, s.x + s.width);
            maxY = Math.max(maxY, s.y + s.height);
        }
        if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return null;
        return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }

    function bboxCenter(box) {
        return box ? { x: box.x + box.w / 2, y: box.y + box.h / 2 } : null;
    }

    function clampNumber(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function containedBedIdForComponent(members, beds) {
        let bedId = null;
        for (const member of (members || [])) {
            const meta = classifyTilerGroupForBeds(member, beds);
            if (meta.type !== 'contained' || !meta.bedId) return null;
            if (bedId && bedId !== meta.bedId) return null;
            bedId = meta.bedId;
        }
        return bedId;
    }

    function resolveOccupiedBedAnchor(cell) {
        if (!cell || !model.isVertex(cell)) return null;
        if (isGardenBed(cell)) return cell;
        const assembly = findIrrigationBedAssemblyAncestor(cell);
        if (assembly) return containingBedForIrrigationAssembly(assembly);
        const group = findTilerGroupSelection(cell);
        if (!group) return null;
        const parent = model.getParent(group);
        if (!parent) return null;
        const beds = (graph.getChildVertices(parent) || []).filter(isGardenBed);
        const meta = classifyTilerGroupForBeds(group, beds);
        if (meta.type !== 'contained' || !meta.bedId) return null;
        const bed = model.getCell(meta.bedId);
        return bed && model.isVertex(bed) && isGardenBed(bed) ? bed : null;
    }

    function containingBedForIrrigationAssembly(assembly) {
        const directParent = model.getParent(assembly);
        if (directParent && isGardenBed(directParent)) return directParent;
        const parent = directParent || graph.getDefaultParent && graph.getDefaultParent();
        if (!parent) return null;
        const beds = (graph.getChildVertices(parent) || []).filter(isGardenBed);
        const rect = getRotatedRectModel(assembly);
        const bed = rect ? findSmallestContainingBed(beds, [], rect.center) : null;
        return bed && model.isVertex(bed) && isGardenBed(bed) ? bed : null;
    }

    function containedPlantingGroupsForBed(bed) {
        const parent = bed && model.getParent(bed);
        if (!parent) return [];
        const beds = (graph.getChildVertices(parent) || []).filter(isGardenBed);
        return (graph.getChildVertices(parent) || []).filter(cell => {
            if (!isTilerGroup(cell)) return false;
            const meta = classifyTilerGroupForBeds(cell, beds);
            return meta.type === 'contained' && meta.bedId === bed.id;
        });
    }

    function uniqueCells(cells) {
        const seen = new Set();
        const out = [];
        for (const cell of (cells || [])) {
            const id = cell && cell.id;
            if (!id || seen.has(id)) continue;
            seen.add(id);
            out.push(cell);
        }
        return out;
    }

    function containedBedAssembliesForBed(bed) {
        const parent = bed && model.getParent(bed);
        const candidates = [];
        if (parent) candidates.push(...(graph.getChildVertices(parent) || []).filter(isIrrigationBedAssembly));
        candidates.push(...(graph.getChildVertices(bed) || []).filter(isIrrigationBedAssembly));
        return uniqueCells(candidates).filter(assembly => containingBedForIrrigationAssembly(assembly) === bed);
    }

    function resolveOccupiedBedMoveUnit(cell) {
        const bed = resolveOccupiedBedAnchor(cell);
        if (!bed) return null;
        const bedAssemblies = containedBedAssembliesForBed(bed);
        const plantingGroups = containedPlantingGroupsForBed(bed);
        if (!bedAssemblies.length && !plantingGroups.length) return null;
        return { bed, bedAssemblies, plantingGroups, cells: [bed].concat(bedAssemblies, plantingGroups) };
    }

    function makeCoveredPlantTarget(component, coverKey, coverCells) {
        if (!component || !component.length || clusterKeyOf(component) === coverKey) return null;
        const fraction = coverageFractionOfTargetCellsByCoverCells(component, coverCells);
        if (fraction < COVERED_TARGET_MIN_PCT) return null;
        return { type: 'plant', cells: component.slice(), fraction };
    }

    function coveredTargetsForCluster(key, components) {
        const st = clusterStates.get(key); if (!st || !st.order || !st.order.length) return [];
        const parent = model.getParent(st.order[0]);
        if (!parent) return [];
        const coverCells = st.order.slice();
        const coverKey = clusterKeyOf(coverCells);
        const beds = (graph.getChildVertices(parent) || []).filter(isGardenBed);
        const targets = [];
        const coveredPlantBedIds = new Set();
        const occupiedBedIds = new Set();

        for (const component of (components || [])) {
            const bedId = containedBedIdForComponent(component, beds);
            if (bedId) occupiedBedIds.add(bedId);
            const target = makeCoveredPlantTarget(component, coverKey, coverCells);
            if (!target) continue;
            if (bedId) coveredPlantBedIds.add(bedId);
            targets.push(target);
        }

        for (const bed of beds) {
            if (!bed || !bed.id || occupiedBedIds.has(bed.id) || coveredPlantBedIds.has(bed.id)) continue;
            if (targetCoverageFractionByCells(bed, coverCells) >= COVERED_TARGET_MIN_PCT) targets.push({ type: 'bed', cells: [bed], bed });
        }

        return targets;
    }

    function coveredTargetLabel(target) {
        if (!target) return 'Select covered target';
        if (target.type === 'bed') return 'Select covered garden bed';
        return target.cells && target.cells.length > 1 ? 'Select covered plant cluster' : 'Select covered plant group';
    }

    function selectCoveredTarget(key, target) {
        const st = clusterStates.get(key);
        if (!st || !target || !target.cells || !target.cells.length) return;
        const parent = model.getParent(st.order[0]);
        clearVisibilityFor(key);
        if (target.type === 'bed') {
            bringCellsToFrontTemporarilyInParent(parent, target.cells);
            graph.setSelectionCells(target.cells);
        } else if (target.cells.length === 1) {
            bringToFrontAndSelect(target.cells[0]);
        } else {
            graph.setSelectionCells(target.cells);
        }
        if (parent) graph.refresh(parent); else graph.refresh();
        hideUIFor(key);
    }

    function ensureCoveredTargetSelectorsFor(key, components) {
        const host = getHost();
        const st = clusterStates.get(key); if (!st) return;
        removeCoveredTargetSelectorsFor(key);
        const targets = coveredTargetsForCluster(key, components);
        if (!targets.length) return;
        for (const target of targets) {
            const b = document.createElement('img');
            b.src = target.type === 'bed' ? ICON_SELECT_BEDS : ICON_SELECT;
            b.alt = 'Select covered target';
            styleSelectBtn(b);
            b.title = coveredTargetLabel(target);
            b.draggable = false;
            b.addEventListener('pointerdown', consumeEvt, { passive: false });
            b.addEventListener('mousedown', consumeEvt, { passive: false });
            b.addEventListener('click', function (evt) {
                consumeEvt(evt);
                selectCoveredTarget(key, target);
            });
            host.appendChild(b);
            st.coveredTargetButtons.push({ el: b, target });
        }
        positionCoveredTargetSelectorsFor(key);
    }

    function styleMiniRail(el) {
        el.style.position = 'absolute';
        el.style.zIndex = String(GRAPH_OVERLAY_Z.ANNOTATION);
        el.style.boxSizing = 'border-box';
        el.style.padding = '7px 8px 8px';
        el.style.border = '1px solid #c7cdd3';
        el.style.borderRadius = '6px';
        el.style.background = 'rgba(255,255,255,0.96)';
        el.style.boxShadow = '0 2px 8px rgba(60,64,67,0.18)';
        el.style.font = '11px/14px Arial,sans-serif';
        el.style.pointerEvents = 'auto'; // CHANGE: bars are direct selection targets.
        el.style.userSelect = 'none';
    }

    function miniRailMonthLabel(date, includeYear) {
        const options = includeYear
            ? { month: 'short', year: 'numeric', timeZone: 'UTC' }
            : { month: 'short', timeZone: 'UTC' };
        return date.toLocaleString('en-US', options); // CHANGE: endpoint labels need year context without timezone drift.
    }

    function miniRailAxisModel(items) {
        const dated = (items || []).filter(item => item.range);
        if (!dated.length) return { mode: 'undated', labels: ['UNDATED'] }; // CHANGE: explicit axis mode replaces flat month labels.
        const minISO = dated.reduce((min, item) => item.range.startISO < min ? item.range.startISO : min, dated[0].range.startISO);
        const maxISO = dated.reduce((max, item) => item.range.endISO > max ? item.range.endISO : max, dated[0].range.endISO);
        const minParts = String(minISO || '').split('-').map(Number);
        const maxParts = String(maxISO || '').split('-').map(Number);
        if (!Number.isFinite(minParts[0]) || !Number.isFinite(minParts[1]) || !Number.isFinite(maxParts[0]) || !Number.isFinite(maxParts[1])) return { mode: 'undated', labels: ['UNDATED'] };
        const labels = [];
        const cursor = new Date(Date.UTC(minParts[0], minParts[1] - 1, 1));
        const end = new Date(Date.UTC(maxParts[0], maxParts[1] - 1, 1));
        const monthCount = (maxParts[0] - minParts[0]) * 12 + (maxParts[1] - minParts[1]) + 1;
        if (monthCount > 6) {
            return {
                mode: 'endpoints',
                labels: [miniRailMonthLabel(cursor, true), miniRailMonthLabel(end, true)]
            }; // CHANGE: long spans show only start/end month-year labels to avoid header crowding.
        }
        while (+cursor <= +end) {
            labels.push(miniRailMonthLabel(cursor, false).toUpperCase()); // CHANGE: keep compact month ticks for short spans.
            cursor.setUTCMonth(cursor.getUTCMonth() + 1);
        }
        return { mode: 'monthly', labels };
    }

    function miniRailSpan(items) {
        const ranges = (items || []).map(item => item.range).filter(Boolean);
        if (!ranges.length) return null;
        return {
            minDay: Math.min.apply(null, ranges.map(range => range.startDay)),
            maxDay: Math.max.apply(null, ranges.map(range => range.endDay))
        };
    }

    function makeMiniRailBar(key, item, span) {
        const bar = document.createElement('div');
        bar.dataset.occupancyNavigatorBar = '1'; // CHANGE: make exact planting bars easy to test and target.
        bar.dataset.cellId = item.cellId;
        bar.textContent = item.label;
        bar.title = miniRailDateTitle(item);
        bar.style.position = 'absolute'; // CHANGE: date offsets should place bars within each timeline track.
        bar.style.boxSizing = 'border-box';
        bar.style.height = '16px';
        bar.style.marginTop = '3px';
        bar.style.padding = '1px 6px';
        bar.style.borderRadius = '4px';
        bar.style.overflow = 'hidden';
        bar.style.textOverflow = 'ellipsis';
        bar.style.whiteSpace = 'nowrap';
        bar.style.textAlign = 'center';
        bar.style.font = '700 10px/14px Arial,sans-serif';
        bar.style.cursor = 'pointer';

        if (item.range && span) {
            const total = Math.max(1, span.maxDay - span.minDay + 1);
            const leftPct = Math.max(0, Math.min(98, ((item.range.startDay - span.minDay) / total) * 100));
            const rawWidthPct = ((item.range.endDay - item.range.startDay + 1) / total) * 100;
            bar.style.left = leftPct + '%';
            bar.style.width = Math.min(100 - leftPct, Math.max(10, rawWidthPct)) + '%';
        } else {
            bar.style.left = '0';
            bar.style.width = '100%';
            bar.style.borderStyle = 'dashed';
        }

        if (item.selected) {
            bar.style.background = '#e8f0fe';
            bar.style.border = '2px solid #1a73e8';
            bar.style.color = '#174ea6';
            bar.style.lineHeight = '12px';
        } else if (item.active) {
            bar.style.background = '#188038';
            bar.style.border = '1px solid #137333';
            bar.style.color = '#fff';
        } else if (item.range) {
            bar.style.background = '#eef0f2';
            bar.style.border = '1px solid #9aa0a6';
            bar.style.color = '#3c4043';
        } else {
            bar.style.background = '#fff';
            bar.style.border = '1px dashed #9aa0a6';
            bar.style.color = '#5f6368';
        }

        bar.addEventListener('pointerdown', consumeEvt, { passive: false });
        bar.addEventListener('mousedown', consumeEvt, { passive: false });
        bar.addEventListener('click', function (evt) {
            consumeEvt(evt);
            const cell = item.cellId ? model.getCell(item.cellId) : null;
            if (cell && model.isVertex(cell)) bringToFrontAndSelect(cell); // CHANGE: one bar selects one actual planting group.
        });
        return bar;
    }

    function renderMiniRailFor(key) {
        const host = getHost();
        const st = clusterStates.get(key); if (!st) return;
        if (!st.miniRail) {
            const rail = document.createElement('div');
            rail.dataset.occupancyNavigator = '1'; // CHANGE: Occupancy now lives above the cluster instead of inside the selected overlay.
            styleMiniRail(rail);
            host.appendChild(rail);
            st.miniRail = rail;
        } else if (st.miniRail.parentNode !== host) {
            host.appendChild(st.miniRail);
        }
        const rail = st.miniRail;
        const items = miniRailItemsForState(st);
        const span = miniRailSpan(items);
        const axisModel = miniRailAxisModel(items);
        rail.innerHTML = '';
        const title = document.createElement('div');
        title.textContent = 'Occupancy';
        title.style.font = '700 11px/14px Arial,sans-serif';
        title.style.color = '#202124';
        title.style.marginBottom = '4px';
        rail.appendChild(title);
        const axis = document.createElement('div');
        axis.dataset.occupancyNavigatorAxis = '1';
        axis.style.display = 'grid';
        axis.style.gridTemplateColumns = '112px 1fr';
        axis.style.gap = '0';
        axis.style.color = '#3c4043';
        axis.style.font = '700 10px/12px Arial,sans-serif';
        axis.style.marginBottom = '3px';
        const axisLabel = document.createElement('div');
        axisLabel.textContent = 'Planting';
        axisLabel.style.color = '#5f6368';
        axis.appendChild(axisLabel);
        const ticks = document.createElement('div');
        ticks.style.display = 'grid';
        ticks.style.gridTemplateColumns = axisModel.mode === 'monthly' ? 'repeat(' + axisModel.labels.length + ', 1fr)' : (axisModel.mode === 'endpoints' ? '1fr 1fr' : '1fr');
        axisModel.labels.forEach((label, index) => {
            const tick = document.createElement('div');
            tick.textContent = label;
            tick.style.textAlign = axisModel.mode === 'endpoints' ? (index === 0 ? 'left' : 'right') : 'center';
            ticks.appendChild(tick);
        });
        axis.appendChild(ticks);
        rail.appendChild(axis);
        items.forEach(item => {
            const row = document.createElement('div');
            row.dataset.occupancyNavigatorRow = item.cellId;
            row.style.display = 'grid';
            row.style.gridTemplateColumns = '112px 1fr';
            row.style.columnGap = '8px';
            row.style.alignItems = 'center';
            row.style.minHeight = '24px';
            row.style.cursor = 'pointer';
            row.style.fontWeight = item.selected ? '700' : '400';
            row.title = miniRailDateTitle(item);
            row.addEventListener('pointerdown', consumeEvt, { passive: false });
            row.addEventListener('mousedown', consumeEvt, { passive: false });
            row.addEventListener('click', function (evt) {
                consumeEvt(evt);
                const cell = item.cellId ? model.getCell(item.cellId) : null;
                if (cell && model.isVertex(cell)) bringToFrontAndSelect(cell);
            });
            const label = document.createElement('div');
            label.textContent = item.label || 'Planting';
            label.style.minWidth = '0';
            label.style.overflow = 'hidden';
            label.style.textOverflow = 'ellipsis';
            label.style.whiteSpace = 'nowrap';
            label.style.font = '700 10px/14px Arial,sans-serif';
            label.style.color = item.selected ? '#174ea6' : (item.active ? '#202124' : '#5f6368');
            row.appendChild(label);
            const track = document.createElement('div');
            track.dataset.occupancyNavigatorTrack = item.cellId;
            track.style.position = 'relative';
            track.style.height = '20px';
            track.style.borderTop = '1px solid rgba(218,220,224,0.7)';
            track.appendChild(makeMiniRailBar(key, item, span));
            row.appendChild(track);
            rail.appendChild(row);
        });
        st.miniRailHeight = 33 + items.length * 24 + 12; // CHANGE: estimate full occupancy panel height for stable above-cluster placement.
        rail.style.display = '';
    }

    function hideMiniRailFor(key) {
        const st = clusterStates.get(key); if (!st || !st.miniRail) return;
        st.miniRail.style.display = 'none'; // CHANGE: hide with the selected-cluster UI.
    }

    function removeMiniRailFor(key) {
        const st = clusterStates.get(key); if (!st || !st.miniRail) return;
        if (st.miniRail.parentNode) st.miniRail.parentNode.removeChild(st.miniRail); // CHANGE: clean up when a cluster is deleted.
        st.miniRail = null;
        st.miniRailHeight = 0;
    }

    function hideUIFor(key) {
        const st = clusterStates.get(key); if (!st) return;
        if (st.btnPrev) st.btnPrev.style.display = 'none';
        if (st.btnNext) st.btnNext.style.display = 'none';
        hideMiniRailFor(key); // CHANGE: Mini Rail replaces badge visibility.
        if (st.btnSelectAll) st.btnSelectAll.style.display = 'none';
        if (st.btnSelectBed) st.btnSelectBed.style.display = 'none';
        if (st.btnSelectPlantings) st.btnSelectPlantings.style.display = 'none';
        if (st.btnSelectBedAssembly) st.btnSelectBedAssembly.style.display = 'none';
        removeCoveredTargetSelectorsFor(key);

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

    function positionCoveredTargetSelectorsFor(key) {
        const st = clusterStates.get(key); if (!st || !st.coveredTargetButtons || !st.coveredTargetButtons.length) return;
        const coverBox = getClusterBBox(key);
        if (!coverBox) { removeCoveredTargetSelectorsFor(key); return; }
        for (const item of st.coveredTargetButtons) {
            const el = item.el;
            const targetBox = viewBBoxForCells(item.target && item.target.cells);
            const center = bboxCenter(targetBox);
            if (!el || !center) continue;
            const minLeft = coverBox.x;
            const maxLeft = coverBox.x + Math.max(0, coverBox.w - BTN_SIZE);
            const minTop = coverBox.y;
            const maxTop = coverBox.y + Math.max(0, coverBox.h - BTN_SIZE);
            el.style.left = Math.round(clampNumber(center.x - BTN_SIZE / 2, minLeft, maxLeft)) + 'px';
            el.style.top = Math.round(clampNumber(center.y - BTN_SIZE / 2, minTop, maxTop)) + 'px';
            el.style.display = '';
        }
    }


    function positionUIFor(key) {
        const st = clusterStates.get(key); if (!st) return;
        const box = getClusterBBox(key);
        if (!box) { hideUIFor(key); return; }

        const midY = box.y + box.h / 2;
        if (st.btnPrev) {
            st.btnPrev.style.left = Math.round(box.x - BTN_SIZE - BTN_INSET) + 'px';
            st.btnPrev.style.top = Math.round(midY - BTN_SIZE / 2) + 'px';
        }
        if (st.btnNext) {
            st.btnNext.style.left = Math.round(box.x + box.w + BTN_INSET) + 'px';
            st.btnNext.style.top = Math.round(midY - BTN_SIZE / 2) + 'px';
        }

        if (st.miniRail) {
            const railWidth = Math.round(clampNumber(Math.max(box.w, MINI_RAIL_MIN_W), MINI_RAIL_MIN_W, MINI_RAIL_MAX_W)); // CHANGE: size the rail from the selected cluster footprint.
            const railHeight = st.miniRailHeight || 72;
            const left = Math.round(box.x + box.w / 2 - railWidth / 2);
            const aboveTop = Math.round(box.y - railHeight - MINI_RAIL_GAP);
            st.miniRail.style.width = railWidth + 'px';
            st.miniRail.style.left = left + 'px';
            st.miniRail.style.top = aboveTop + 'px'; // CHANGE: occupancy navigator stays vertically above the cluster and does not fall below.
        }

        // place select buttons at the top-left outside corner of the cluster bbox
        if (st.btnSelectAll || st.btnSelectBed) {
            const baseX = Math.round(box.x - BTN_SIZE - BTN_INSET + SELECT_BUTTON_DRAG_HANDLE_SLOT);
            const y = Math.round(box.y - BTN_SIZE - BTN_INSET);
            if (st.btnSelectBed) {
                st.btnSelectBed.style.left = baseX + 'px';
                st.btnSelectBed.style.top = y + 'px';
            }
            if (st.btnSelectAll) {
                const unitOffset = visibleBedUnitSelectorCount() * (BTN_SIZE + SELECT_BUTTON_GAP);
                const x2 = baseX + unitOffset + (st.btnSelectBed && st.btnSelectBed.style.display !== 'none' ? (BTN_SIZE + SELECT_BUTTON_GAP) : 0);
                st.btnSelectAll.style.left = x2 + 'px';
                st.btnSelectAll.style.top = y + 'px';
            }
        }

        positionCoveredTargetSelectorsFor(key);
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

        const active = new Set(activeCellsForClusterState(st));
        const nextDim = new Set(st.order.filter(c => !active.has(c))); // CHANGE: dim only groups outside the selected group's occupancy window.

        // Dim newly added
        const toDim = [];
        nextDim.forEach(c => { if (!st.dimmed.has(c)) toDim.push(c); });
        if (toDim.length) {
            setOutlineOnlyVisibleDeep(toDim, false);
            setOpacityDeep(toDim, SELECTED_TG_OPACITY);
        }

        const activeMembers = st.order.filter(c => active.has(c));
        if (activeMembers.length) {
            setOutlineOnlyVisibleDeep(activeMembers, true); // CHANGE: selected and temporally overlapping groups stay fully visible.
            setOpacityDeep(activeMembers, SELECTED_TG_OPACITY);
        }

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


    // -------------------- NEW: temporary bed-unit front-ordering --------------------
    const parentOrderSnapshots = new Map(); // parentId -> [childId,...]               
    let temporaryFrontedParent = null;
    let temporaryFrontedCellIds = [];

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

        if (temporaryFrontedParent && temporaryFrontedParent !== parent) restoreTemporaryFrontedOrder();

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
        temporaryFrontedCellIds = order.map(c => c && c.id).filter(Boolean);
        withUndoSuppressed(() => {
            model.beginUpdate();
            try {
                for (const c of order) model.add(parent, c, model.getChildCount(parent));
            } finally {
                model.endUpdate();
            }
            temporaryFrontedParent = parent;
            graph.refresh(parent);
        });
    }

    function selectionMatchesTemporaryFrontedCells(cells) {
        const selectedIds = (cells || []).map(c => c && c.id).filter(Boolean).sort();
        const frontedIds = (temporaryFrontedCellIds || []).slice().sort();
        if (!frontedIds.length || selectedIds.length !== frontedIds.length) return false;
        for (let i = 0; i < frontedIds.length; i++) if (frontedIds[i] !== selectedIds[i]) return false;
        return true;
    }

    function restoreTemporaryFrontedOrder() {
        const parent = temporaryFrontedParent;
        temporaryFrontedParent = null;
        temporaryFrontedCellIds = [];
        if (parent) restoreChildOrder(parent);
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
        renderMiniRailFor(key); // CHANGE: update direct-selection timeline after arrow navigation.
        updateControlsVisibilityFor(key);
        positionUIFor(key);
        applyVisibilityFor(key);

    }

    // -------------------- Orchestration --------------------
    function refreshClustersInParent(parent, preferredAnchorId, selectedId) {
        const comps = buildAllComponentsInParent(parent);
        const liveKeys = new Set();

        for (const members of comps) {
            const { key } = ensureClusterState(members, preferredAnchorId);
            liveKeys.add(key);

            // Only show UI/dimming for the cluster containing the selected tiler group
            const isSelectedCluster = selectedId && members.some(c => c.id === selectedId);
            if (!isSelectedCluster) {
                hideUIFor(key);
                clearVisibilityFor(key);
                continue;
            }

            if (members.length >= 2) {
                ensureButtonsFor(key);
                renderMiniRailFor(key); // CHANGE: Mini Rail replaces the selected cluster badge.
                if (bedUnitPlantingsMatchCluster(members)) { if (clusterStates.get(key).btnSelectAll) clusterStates.get(key).btnSelectAll.style.display = 'none'; }
                else ensureSelectAllFor(key);
            }
            updateControlsVisibilityFor(key);
            positionUIFor(key);
            applyVisibilityFor(key);
            ensureCoveredTargetSelectorsFor(key, comps);

        }

        for (const [key, st] of clusterStates.entries()) {
            if (!liveKeys.has(key)) {
                hideUIFor(key);
                clearVisibilityFor(key);
                removeMiniRailFor(key); // CHANGE: detach stale cluster rail before deleting state.
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
        renderBedUnitSelectors(resolveOccupiedBedMoveUnit(sel));
        const selectedTilerGroup = findTilerGroupSelection(sel);
        const preferred = selectedTilerGroup ? selectedTilerGroup.id : null;
        lastSelectedTGId = preferred || null;

        // If no tiler group is selected, hide all cluster UI and restore baseline visuals.
        if (!lastSelectedTGId) {
            for (const [k] of clusterStates.entries()) {
                hideUIFor(k);
                clearVisibilityFor(k);
            }
            return;
        }

        // Drive clustering only for the selection's parent as before
        const selCell = model.getCell(lastSelectedTGId);
        const p = selCell ? model.getParent(selCell) : null;
        if (p) {
            refreshClustersInParent(p, preferred, lastSelectedTGId);
            // Prune clusters not under this parent
            for (const [k, st] of clusterStates.entries()) {
                if (!st.order.every(c => model.getParent(c) === p)) {
                    hideUIFor(k);
                    clearVisibilityFor(k);
                    removeMiniRailFor(k); // CHANGE: remove orphaned rail when selection moves to another parent.
                    clusterStates.delete(k);
                }
            }
            return;
        }

        // Fallback (rare): scan parents but still gate by selected id                 
        const parents = parentsToScan();
        const live = new Set();
        parents.forEach(par => {
            refreshClustersInParent(par, preferred, lastSelectedTGId);
            for (const k of clusterStates.keys()) live.add(k);
        });
        for (const [k, st] of clusterStates.entries()) {
            const exists = st.order.every(c => !!model.getCell(c.id));
            if (!exists) {
                hideUIFor(k);
                clearVisibilityFor(k);
                removeMiniRailFor(k); // CHANGE: remove orphaned rail when cluster cells no longer exist.
                clusterStates.delete(k);
            }
        }
    }


    function repositionAllUI() {
        for (const [key, st] of clusterStates.entries()) {
            // Only reposition visible UI (selected cluster only)                      
            const hasVisibleUI =
                (st.btnPrev && st.btnPrev.style.display !== 'none') ||
                (st.btnSelectAll && st.btnSelectAll.style.display !== 'none') ||
                (st.btnSelectBed && st.btnSelectBed.style.display !== 'none') ||
                (st.miniRail && st.miniRail.style.display !== 'none') || // CHANGE: keep the selected cluster rail attached during pan/zoom.
                (st.coveredTargetButtons && st.coveredTargetButtons.length > 0);
            if (!hasVisibleUI) continue;
            positionUIFor(key);
        }
        positionBedUnitSelectors();
    }


    // -------------------- Events --------------------
    let lastSelectedPlantingId = null;
    let lastSelectedPlantingParent = null;

    graph.getSelectionModel().addListener(mxEvent.CHANGE, function () {
        const sel = graph.getSelectionCell();
        const selectedCells = graph.getSelectionCells ? graph.getSelectionCells() : (sel ? [sel] : []);

        // If we previously brought a bed or bed assembly to front, restore when leaving that exact selection.
        if (temporaryFrontedParent && !selectionMatchesTemporaryFrontedCells(selectedCells)) restoreTemporaryFrontedOrder();

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
    graph.addListener(TRELLIS_SELECTION_VISUALS_REFRESH_EVENT, function () { rafDebounce(refreshAllForSelectionOrAnchor); });

    graph.addListener(mxEvent.ADD_CELLS, function () { rafDebounce(refreshAllForSelectionOrAnchor); });
    graph.addListener(mxEvent.REMOVE_CELLS, function () { rafDebounce(refreshAllForSelectionOrAnchor); });
    graph.getModel().addListener(mxEvent.CHANGE, function (sender, evt) {
        const edit = evt.getProperty('edit');
        const changes = edit && edit.changes ? edit.changes : [];
        const rotationChanged = changes.some(styleChangeTouchesRotation);
        if (rotationChanged) {
            invalidateBoundsCache();
            rafDebounce(refreshAllForSelectionOrAnchor);
        }
    });
    graph.getModel().addListener(mxEvent.UNDO, function () { rafDebounce(refreshAllForSelectionOrAnchor); });
    graph.getModel().addListener(mxEvent.REDO, function () { rafDebounce(refreshAllForSelectionOrAnchor); });

    graph.getView().addListener(mxEvent.SCALE_AND_TRANSLATE, function () {
        repositionAllUI();
    });
    graph.getView().addListener(mxEvent.REPAINT, function () {
        repositionAllUI();
    });

    graph.__trellisBedSuccessionNavigator = Object.assign({}, graph.__trellisBedSuccessionNavigator, {
        getSelectedClusterOccupancy: selectedClusterOccupancyFor,
        getSelectedBedOccupancy: selectedBedOccupancyFor, // CHANGE: bed/layout/capacity callers need center-in-bed occupancy separate from spatial cluster context.
        getSelectedClusterLayoutContext: selectedClusterLayoutContextFor, // CHANGE: selected overlays need cluster bounds and active rows without measuring Occupancy DOM.
        resolveOccupiedBedMoveUnit: resolveOccupiedBedMoveUnit
    });

    // Init
    setTimeout(refreshAllForSelectionOrAnchor, 0);
});
