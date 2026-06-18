/**
 * Draw.io Plugin: Tiler Group Overlap Navigator (Multi-Cluster, DOM Buttons)
 * - Detects ANY overlap (edge/corner inclusive) among sibling tiler groups.
 * - Builds all disjoint overlap-connected components ("clusters") per parent.
 * - Each cluster gets its own Prev/Next controls and index badge.
 * - Non-current members of each cluster are rendered outline-only (fills/text/images hidden).
 * - Controls persist even when unselected; they clear only if a cluster disappears.
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

    const OVERLAP_MIN_PCT = 0.40;
    const OVERLAP_PCT_MODE = 'smaller';

    // overlap badges config                                                             
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const OVERLAP_BADGE_W = 34;
    const OVERLAP_BADGE_H = 18;

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
    const BED_FIT_TOLERANCE = 0.25; // NEW
    const EDGE_CIRCLE_CENTER_CONTAINED_PCT = 0.40; // NEW
    const BED_AUTO_FIT_ATTR = 'bed_auto_fit'; // NEW
    const PLANT_DIAGRAM_UNITS_PER_CM = 5 * 0.18; // NEW
    const BED_FIT_GROUP_PADDING_PX = 4; // NEW
    const BED_FIT_GROUP_BASE_AREA_PX2 = 240 * 240; // NEW
    const BED_FIT_GROUP_LABEL_FONT_PX = 12; // NEW
    const BED_FIT_GROUP_LABEL_FONT_MIN_PX = 10; // NEW
    const BED_FIT_GROUP_LABEL_FONT_MAX_PX = 100; // NEW
    const BED_FIT_GROUP_LABEL_LINE_HEIGHT = 1.25; // NEW
    const BED_FIT_GROUP_LABEL_BAND_PAD_PX = 6; // NEW

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

    function findSmallestContainingBed(beds, bedBounds, point) { // NEW
        if (!point) return null; // NEW
        let chosen = null; // NEW
        let chosenArea = Infinity; // NEW
        for (let k = 0; k < beds.length; k++) { // NEW
            const bb = bedBounds[k]; // NEW
            if (!bb) continue; // NEW
            if (rectContainsPoint(bb, point.x, point.y)) { // NEW
                const a = rectArea(bb); // NEW
                if (a > 0 && a < chosenArea) { // NEW
                    chosenArea = a; // NEW
                    chosen = beds[k]; // NEW
                } // NEW
            } // NEW
        } // NEW
        return chosen; // NEW
    } // NEW

    function bedsForCluster(key) {
        const st = clusterStates.get(key);
        if (!st || !st.order || !st.order.length) return [];

        const parent = model.getParent(st.order[0]);
        if (!parent) return [];

        const sibVerts = graph.getChildVertices(parent) || [];
        const beds = sibVerts.filter(isGardenBed);
        if (!beds.length) return [];

        const bedBounds = beds.map(getAbsBounds); // CHANGE
        const chosenIds = new Set();

        for (const tg of st.order) {
            const tgBounds = getAbsBounds(tg); // CHANGE
            for (let i = 0; i < beds.length; i++) { // CHANGE
                if (significantOverlap(tgBounds, bedBounds[i]) && beds[i].id) chosenIds.add(beds[i].id); // CHANGE
            } // CHANGE
        }

        const out = [];
        chosenIds.forEach(id => {
            const cell = model.getCell(id);
            if (cell && model.isVertex(cell) && isGardenBed(cell)) out.push(cell);
        });
        return out;
    }

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

    // -------------------- Bed-aware model-space auto-fit -------------------- // NEW
    let bedFitInProgress = false; // NEW

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

    function findSmallestContainingBedModel(parent, point) { // NEW
        if (!parent || !point) return null; // NEW
        const beds = (graph.getChildVertices(parent) || []).filter(isGardenBed); // NEW
        let chosen = null; // NEW
        let chosenArea = Infinity; // NEW
        for (const bed of beds) { // NEW
            const rect = getModelRect(bed); // NEW
            if (!rect || !rectContainsPoint(rect, point.x, point.y)) continue; // NEW
            const area = rectAreaModel(rect); // NEW
            if (area > 0 && area < chosenArea) { // NEW
                chosen = bed; // NEW
                chosenArea = area; // NEW
            } // NEW
        } // NEW
        return chosen; // NEW
    } // NEW

    function isPlantCircleCell(cell) { // NEW
        return !!cell && cell.getAttribute && cell.getAttribute('plant_tiler') === '1'; // NEW
    } // NEW

    function largestChildPlantCircleDiameter(tg) { // NEW
        let diameter = 0; // NEW
        const childCount = model.getChildCount(tg); // NEW
        for (let i = 0; i < childCount; i++) { // NEW
            const child = model.getChildAt(tg, i); // NEW
            if (!model.isVertex(child) || !isPlantCircleCell(child)) continue; // NEW
            const cg = model.getGeometry(child); // NEW
            if (!cg) continue; // NEW
            diameter = Math.max(diameter, Number(cg.width) || 0, Number(cg.height) || 0); // NEW
        } // NEW
        return diameter; // NEW
    } // NEW

    function getPlantCircleDiameterPx(tg) { // NEW
        const childDiameter = largestChildPlantCircleDiameter(tg); // NEW
        if (childDiameter > 0) return childDiameter; // NEW
        const vegDiameterCm = toNumOrNaN(tg && tg.getAttribute ? tg.getAttribute(DIAM_ATTR) : null); // NEW
        return Number.isFinite(vegDiameterCm) && vegDiameterCm > 0 ? vegDiameterCm * PLANT_DIAGRAM_UNITS_PER_CM : 0; // NEW
    } // NEW

    function allowedOverhangForDiameter(diameter) { // NEW
        return Math.max(0, diameter) * (1 - EDGE_CIRCLE_CENTER_CONTAINED_PCT) / 2; // NEW
    } // NEW

    function clampBedFitNumber(value, min, max) { // NEW
        return Math.max(min, Math.min(max, value)); // NEW
    } // NEW

    function bedFitLabelBandPxForSize(width, height) { // NEW
        const w = Math.max(1, Number(width) || 1); // NEW
        const h = Math.max(1, Number(height) || 1); // NEW
        const scale = Math.sqrt((w * h) / BED_FIT_GROUP_BASE_AREA_PX2); // NEW
        const fontPx = clampBedFitNumber(Math.round(BED_FIT_GROUP_LABEL_FONT_PX * scale), BED_FIT_GROUP_LABEL_FONT_MIN_PX, BED_FIT_GROUP_LABEL_FONT_MAX_PX); // NEW
        return Math.ceil(fontPx * BED_FIT_GROUP_LABEL_LINE_HEIGHT + BED_FIT_GROUP_LABEL_BAND_PAD_PX); // NEW
    } // NEW

    function getPlantingFrameRectModel(tgRect) { // NEW
        if (!tgRect) return null; // NEW
        const bandPx = bedFitLabelBandPxForSize(tgRect.w, tgRect.h); // NEW
        return { // NEW
            x: tgRect.x + BED_FIT_GROUP_PADDING_PX, // NEW
            y: tgRect.y + BED_FIT_GROUP_PADDING_PX + bandPx, // NEW
            w: Math.max(0, tgRect.w - BED_FIT_GROUP_PADDING_PX * 2), // NEW
            h: Math.max(0, tgRect.h - BED_FIT_GROUP_PADDING_PX * 2 - bandPx), // NEW
            bandPx: bandPx // NEW
        }; // NEW
    } // NEW

    function solveOuterHeightForPlantingFrame(innerHeight, outerWidth, seedHeight) { // NEW
        let bandPx = bedFitLabelBandPxForSize(outerWidth, seedHeight); // NEW
        let outerHeight = Math.max(1, innerHeight + BED_FIT_GROUP_PADDING_PX * 2 + bandPx); // NEW
        for (let i = 0; i < 5; i++) { // NEW
            const nextBandPx = bedFitLabelBandPxForSize(outerWidth, outerHeight); // NEW
            const nextOuterHeight = Math.max(1, innerHeight + BED_FIT_GROUP_PADDING_PX * 2 + nextBandPx); // NEW
            if (nextBandPx === bandPx && nearlySameNumber(nextOuterHeight, outerHeight)) break; // NEW
            bandPx = nextBandPx; // NEW
            outerHeight = nextOuterHeight; // NEW
        } // NEW
        return { outerHeight: outerHeight, bandPx: bandPx }; // NEW
    } // NEW

    function collectTilerGroupCandidate(cell, out) { // NEW
        const tg = findTilerGroupAncestor(cell); // NEW
        if (tg && tg.id && !out.has(tg.id)) out.set(tg.id, tg); // NEW
    } // NEW

    function getTilerGroupsFromEventCells(cells) { // NEW
        const out = new Map(); // NEW
        const moved = (cells || []).filter(Boolean); // NEW
        for (const cell of moved) collectTilerGroupCandidate(cell, out); // NEW
        if (!moved.length) { // NEW
            const selected = graph.getSelectionCells ? graph.getSelectionCells() : [graph.getSelectionCell()]; // NEW
            for (const cell of (selected || [])) collectTilerGroupCandidate(cell, out); // NEW
        } // NEW
        return Array.from(out.values()); // NEW
    } // NEW

    function nearlySameNumber(a, b) { // NEW
        return Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.001; // NEW
    } // NEW

    function getPlantCircleBBoxLocal(tg) { // NEW
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity; // NEW
        const childCount = model.getChildCount(tg); // NEW
        for (let i = 0; i < childCount; i++) { // NEW
            const child = model.getChildAt(tg, i); // NEW
            if (!model.isVertex(child) || !isPlantCircleCell(child)) continue; // NEW
            const cg = model.getGeometry(child); // NEW
            if (!cg) continue; // NEW
            const x = Number(cg.x) || 0; // NEW
            const y = Number(cg.y) || 0; // NEW
            const w = Number(cg.width) || 0; // NEW
            const h = Number(cg.height) || 0; // NEW
            if (w <= 0 || h <= 0) continue; // NEW
            minX = Math.min(minX, x); // NEW
            minY = Math.min(minY, y); // NEW
            maxX = Math.max(maxX, x + w); // NEW
            maxY = Math.max(maxY, y + h); // NEW
        } // NEW
        if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return null; // NEW
        return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }; // NEW
    } // NEW

    function shiftPlantCircleChildren(tg, dx, dy) { // NEW
        if (nearlySameNumber(dx, 0) && nearlySameNumber(dy, 0)) return false; // NEW
        let changed = false; // NEW
        const childCount = model.getChildCount(tg); // NEW
        for (let i = 0; i < childCount; i++) { // NEW
            const child = model.getChildAt(tg, i); // NEW
            if (!model.isVertex(child) || !isPlantCircleCell(child)) continue; // NEW
            const cg = model.getGeometry(child); // NEW
            if (!cg) continue; // NEW
            const next = cg.clone(); // NEW
            next.x = (Number(cg.x) || 0) + dx; // NEW
            next.y = (Number(cg.y) || 0) + dy; // NEW
            model.setGeometry(child, next); // NEW
            changed = true; // NEW
        } // NEW
        return changed; // NEW
    } // NEW

    function buildAxisAwareTrimGeometry(tg, bed, bbox, fitWidth, fitHeight, finalWidth, finalHeight, bandPx) { // CHANGE
        const bedCenter = rectCenterModel(getModelRect(bed)); // NEW
        const current = model.getGeometry(tg); // NEW
        if (!bedCenter || !current) return null; // NEW
        const next = current.clone(); // NEW
        if (fitWidth) { // NEW
            const localPlantCenterX = BED_FIT_GROUP_PADDING_PX + bbox.w / 2; // NEW
            next.x = bedCenter.x - localPlantCenterX; // NEW
            next.width = finalWidth; // NEW
        } // NEW
        if (fitHeight) { // NEW
            const localPlantCenterY = BED_FIT_GROUP_PADDING_PX + bandPx + bbox.h / 2; // NEW
            next.y = bedCenter.y - localPlantCenterY; // NEW
            next.height = finalHeight; // NEW
        } // NEW
        return next; // NEW
    } // NEW

    function trimGroupToPlantFootprint(tg, bed, bbox, fitWidth, fitHeight) { // CHANGE
        if (!tg || !bed || !bbox || bbox.w <= 0 || bbox.h <= 0) return false; // NEW
        if (!fitWidth && !fitHeight) return false; // NEW
        const current = model.getGeometry(tg); // NEW
        if (!current) return false; // NEW
        const finalWidth = fitWidth ? Math.max(1, bbox.w + BED_FIT_GROUP_PADDING_PX * 2) : current.width; // CHANGE
        const solved = fitHeight // CHANGE
            ? solveOuterHeightForPlantingFrame(bbox.h, finalWidth, current.height) // CHANGE
            : { outerHeight: current.height, bandPx: bedFitLabelBandPxForSize(finalWidth, current.height) }; // CHANGE
        const next = buildAxisAwareTrimGeometry(tg, bed, bbox, fitWidth, fitHeight, finalWidth, solved.outerHeight, solved.bandPx); // CHANGE
        if (!next) return false; // NEW
        const dx = fitWidth ? BED_FIT_GROUP_PADDING_PX - bbox.x : 0; // CHANGE
        const dy = fitHeight ? BED_FIT_GROUP_PADDING_PX + solved.bandPx - bbox.y : 0; // CHANGE
        const childrenChanged = shiftPlantCircleChildren(tg, dx, dy); // NEW
        const groupChanged = !(nearlySameNumber(current.x, next.x) && nearlySameNumber(current.y, next.y) && nearlySameNumber(current.width, next.width) && nearlySameNumber(current.height, next.height)); // NEW
        if (groupChanged) model.setGeometry(tg, next); // NEW
        return childrenChanged || groupChanged; // NEW
    } // NEW

    function applyBedFitGeometry(tg, bed, allowDragIntoBedFit) { // NEW
        if (!tg || !bed || tg.getAttribute(BED_AUTO_FIT_ATTR) === '0') return null; // CHANGE
        const tgRect = getModelRect(tg); // NEW
        const bedRect = getModelRect(bed); // NEW
        if (!tgRect || !bedRect || bedRect.w <= 0 || bedRect.h <= 0) return null; // CHANGE

        const diameter = getPlantCircleDiameterPx(tg); // NEW
        const overhang = allowedOverhangForDiameter(diameter); // NEW
        const frameRect = getPlantingFrameRectModel(tgRect); // NEW
        if (!frameRect) return null; // CHANGE
        const targetFrameWidth = bedRect.w + overhang * 2; // CHANGE
        const targetFrameHeight = bedRect.h + overhang * 2; // CHANGE
        const widthClose = Math.abs(frameRect.w - targetFrameWidth) <= bedRect.w * BED_FIT_TOLERANCE; // CHANGE
        const heightClose = Math.abs(frameRect.h - targetFrameHeight) <= bedRect.h * BED_FIT_TOLERANCE; // CHANGE
        const canDragFit = allowDragIntoBedFit && diameter < bedRect.w && diameter < bedRect.h; // NEW
        const fitWidth = widthClose || canDragFit; // NEW
        const fitHeight = heightClose || canDragFit; // NEW
        if (!fitWidth && !fitHeight) return null; // CHANGE

        const g = model.getGeometry(tg); // NEW
        if (!g) return null; // CHANGE
        const next = g.clone(); // NEW
        if (fitWidth) { // NEW
            next.x = bedRect.x - overhang - BED_FIT_GROUP_PADDING_PX; // CHANGE
            next.width = targetFrameWidth + BED_FIT_GROUP_PADDING_PX * 2; // CHANGE
        } // NEW
        if (fitHeight) { // NEW
            const solved = solveOuterHeightForPlantingFrame(targetFrameHeight, next.width, next.height); // NEW
            next.y = bedRect.y - overhang - BED_FIT_GROUP_PADDING_PX - solved.bandPx; // CHANGE
            next.height = solved.outerHeight; // CHANGE
        } // NEW
        const geometryChanged = !(nearlySameNumber(g.x, next.x) && nearlySameNumber(g.y, next.y) && nearlySameNumber(g.width, next.width) && nearlySameNumber(g.height, next.height)); // CHANGE
        if (geometryChanged) model.setGeometry(tg, next); // CHANGE
        return { changed: geometryChanged, fitWidth: fitWidth, fitHeight: fitHeight, bed: bed }; // CHANGE
    } // NEW

    function retileAfterBedFit(tg) { // NEW
        const retile = window.USL && window.USL.tiler && window.USL.tiler.retileGroup; // NEW
        if (typeof retile === 'function') { // NEW
            try { retile(graph, tg); return; } catch (e) { try { mxLog.debug('[BedFit] retile failed:', e && e.message ? e.message : e); } catch (_) { } } // NEW
        } // NEW
        graph.refresh(tg); // NEW
    } // NEW

    function finiteMoveDelta(value) { // NEW
        const n = Number(value); // NEW
        return Number.isFinite(n) ? n : null; // NEW
    } // NEW

    function movedWithinSameBed(parent, center, currentBed, moveDx, moveDy) { // NEW
        if (!parent || !center || !currentBed || moveDx == null || moveDy == null) return false; // NEW
        const previousCenter = { x: center.x - moveDx, y: center.y - moveDy }; // NEW
        const previousBed = findSmallestContainingBedModel(parent, previousCenter); // NEW
        return !!previousBed && !!previousBed.id && previousBed.id === currentBed.id; // NEW
    } // NEW

    function normalizeMovedTilerGroupsToBeds(cells, opts) { // NEW
        if (bedFitInProgress) return 0; // NEW
        const groups = getTilerGroupsFromEventCells(cells); // NEW
        if (!groups.length) return 0; // NEW
        const allowDragIntoBedFit = !!(opts && opts.allowDragIntoBedFit); // NEW
        const skipSameBedMoveFit = !!(opts && opts.skipSameBedMoveFit); // NEW
        const moveDx = finiteMoveDelta(opts && opts.moveDx); // NEW
        const moveDy = finiteMoveDelta(opts && opts.moveDy); // NEW
        const changed = []; // NEW
        let trimmed = false; // NEW
        bedFitInProgress = true; // NEW
        model.beginUpdate(); // NEW
        try { // NEW
            for (const tg of groups) { // NEW
                const parent = model.getParent(tg); // NEW
                const center = rectCenterModel(getModelRect(tg)); // NEW
                const bed = findSmallestContainingBedModel(parent, center); // NEW
                if (skipSameBedMoveFit && movedWithinSameBed(parent, center, bed, moveDx, moveDy)) continue; // NEW
                const fitResult = applyBedFitGeometry(tg, bed, allowDragIntoBedFit); // CHANGE
                if (fitResult) changed.push({ tg: tg, bed: fitResult.bed, fitWidth: fitResult.fitWidth, fitHeight: fitResult.fitHeight }); // CHANGE
            } // NEW
            for (const item of changed) retileAfterBedFit(item.tg); // CHANGE
            for (const item of changed) { // NEW
                const bbox = getPlantCircleBBoxLocal(item.tg); // NEW
                if (trimGroupToPlantFootprint(item.tg, item.bed, bbox, item.fitWidth, item.fitHeight)) trimmed = true; // CHANGE
            } // NEW
        } finally { // NEW
            model.endUpdate(); // NEW
            bedFitInProgress = false; // NEW
        } // NEW
        if (trimmed) { // NEW
            for (const item of changed) graph.refresh(item.tg); // NEW
        } // NEW
        return changed.length; // NEW
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
        normalizeMovedTilerGroupsToBeds(cells, { allowDragIntoBedFit: true, skipSameBedMoveFit: true, moveDx: evt.getProperty('dx'), moveDy: evt.getProperty('dy') }); // CHANGE
        rafDebounce(refreshAllForSelectionOrAnchor); // CHANGE
    });

    graph.addListener(mxEvent.CELLS_RESIZED, function (sender, evt) { // NEW
        const cells = evt.getProperty('cells'); // NEW
        normalizeMovedTilerGroupsToBeds(cells, { allowDragIntoBedFit: false }); // NEW
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

    function buildAllComponentsInParent(parent) {
        const nodes = getSiblingsInParent(parent);
        const n = nodes.length;
        if (n < 1) return []; // CHANGE

        const bounds = nodes.map(getAbsBounds);

        // --- NEW: collect beds in same parent and precompute bounds ---
        const sibVerts = graph.getChildVertices(parent) || [];
        const beds = sibVerts.filter(isGardenBed);
        const bedBounds = beds.map(getAbsBounds);

        // Map each TG index -> chosen bed id (or null) based on center-in-bed
        const tgBedId = new Array(n).fill(null);
        for (let i = 0; i < n; i++) {
            const b = bounds[i];
            const c = rectCenter(b);
            const chosen = findSmallestContainingBed(beds, bedBounds, c); // CHANGE
            tgBedId[i] = chosen ? chosen.id : null; // CHANGE
        }

        const adj = Array.from({ length: n }, () => []);

        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                const sameBed = (tgBedId[i] && tgBedId[i] === tgBedId[j]);
                const sigOv = significantOverlap(bounds[i], bounds[j]);
                if (sameBed || sigOv) {
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
            const hasBedMappedMember = comp.some(cell => { // NEW
                const idx = nodes.indexOf(cell); // NEW
                return idx >= 0 && !!tgBedId[idx]; // NEW
            }); // NEW
            if (comp.length >= 2 || hasBedMappedMember) comps.push(comp); // CHANGE
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
                badgePrev: null,
                badgeNext: null,
                btnDrag: null,
                btnSelectAll: null,
                btnSelectBeds: null,
            };
            clusterStates.set(key, st);
        } else {
            const oldAnchor = st.anchorId;
            st.order = order;
            const k = order.findIndex(c => c.id === oldAnchor);
            st.currentIdx = k >= 0 ? k : 0;
            st.anchorId = st.order[st.currentIdx].id;
        }
        return { key, st };
    }

    function hasSuccessionControls(st) { // NEW
        return !!st && !!st.order && st.order.length >= 2; // NEW
    } // NEW


    // Earliest start / latest end window for a group                                        
    function plantingWindowOf(cell) {
        // start = transplant_date if present, otherwise sow_date                                  
        const start = parseISO(cell.getAttribute('transplant_date')) ||
            parseISO(cell.getAttribute('sow_date'));

        // end = harvest_end only                                                                  
        const end = parseISO(cell.getAttribute('harvest_end'));

        return (start && end && end >= start) ? { start, end } : null;
    }

    // Inclusive overlap in whole days                                                       
    function inclusiveOverlapDays(w1, w2) {
        if (!w1 || !w2) return null;
        const s = Math.max(+w1.start, +w2.start);
        const e = Math.min(+w1.end, +w2.end);
        if (e < s) return 0;
        return Math.floor((e - s) / MS_PER_DAY) + 1;
    }

    // -------------------- Overlap badges UI ----------------------------------------------
    function styleOverlapBadge(el) {
        el.style.position = 'absolute';
        el.style.width = OVERLAP_BADGE_W + 'px';
        el.style.height = OVERLAP_BADGE_H + 'px';
        el.style.zIndex = '10000';
        el.style.pointerEvents = 'none';
        el.style.border = '1px solid #000';
        el.style.borderRadius = '10px';
        el.style.background = 'rgba(255,255,255,0.9)';
        el.style.font = '11px/18px sans-serif';
        el.style.textAlign = 'center';
    }

    function ensureOverlapBadgesFor(key) {
        const host = getHost();
        const st = clusterStates.get(key); if (!st) return;
        if (!st.badgePrev) {
            st.badgePrev = document.createElement('div');
            styleOverlapBadge(st.badgePrev);
            host.appendChild(st.badgePrev);
        } else if (st.badgePrev.parentNode !== host) {
            host.appendChild(st.badgePrev);
        }
        if (!st.badgeNext) {
            st.badgeNext = document.createElement('div');
            styleOverlapBadge(st.badgeNext);
            host.appendChild(st.badgeNext);
        } else if (st.badgeNext.parentNode !== host) {
            host.appendChild(st.badgeNext);
        }
        st.badgePrev.style.display = '';
        st.badgeNext.style.display = '';
    }

    function updateOverlapValuesFor(key) {
        const st = clusterStates.get(key); if (!st) return;
        ensureOverlapBadgesFor(key);
        const i = st.currentIdx;
        const curr = st.order[i];
        const wCurr = plantingWindowOf(curr);
        console.debug('[Overlap] current', curr?.id, wCurr);

        let prevText = '–', prevDim = true;
        if (i > 0) {
            const prevCell = st.order[i - 1];
            const wPrev = plantingWindowOf(prevCell);
            const d = inclusiveOverlapDays(wCurr, wPrev);
            console.debug('[Overlap] prev', prevCell?.id, wPrev, 'days=', d);
            if (d == null) { prevText = '–'; prevDim = true; } else { prevText = String(d); prevDim = (d === 0); }
        }
        let nextText = '–', nextDim = true;
        if (i < st.order.length - 1) {
            const nextCell = st.order[i + 1];
            const wNext = plantingWindowOf(nextCell);
            const d = inclusiveOverlapDays(wCurr, wNext);
            console.debug('[Overlap] next', nextCell?.id, wNext, 'days=', d);
            if (d == null) { nextText = '–'; nextDim = true; } else { nextText = String(d); nextDim = (d === 0); }
        }
        st.badgePrev.textContent = prevText;
        st.badgePrev.style.opacity = prevDim ? '0.6' : '1.0';
        st.badgeNext.textContent = nextText;
        st.badgeNext.style.opacity = nextDim ? '0.6' : '1.0';
    }

    function positionOverlapBadgesFor(key) {
        const st = clusterStates.get(key); if (!st) return;
        const box = getClusterBBox(key); if (!box) { hideUIFor(key); return; }
        // Place badges horizontally flush with where buttons would be                        
        const prevLeft = Math.round(box.x - BTN_SIZE - BTN_INSET - OVERLAP_BADGE_W - 4);
        const prevTop = Math.round(box.y + box.h / 2 - OVERLAP_BADGE_H / 2);
        const nextLeft = Math.round(box.x + box.w + BTN_INSET + BTN_SIZE + 4);
        const nextTop = prevTop;
        st.badgePrev.style.left = prevLeft + 'px';
        st.badgePrev.style.top = prevTop + 'px';
        st.badgeNext.style.left = nextLeft + 'px';
        st.badgeNext.style.top = nextTop + 'px';
    }


    // -------------------- Per-cluster UI helpers --------------------
    function styleBtn(el) {
        el.style.position = 'absolute';
        el.style.width = BTN_SIZE + 'px';
        el.style.height = BTN_SIZE + 'px';
        el.style.zIndex = '10000';
        el.style.cursor = 'pointer';
        el.style.pointerEvents = 'auto';
    }

    function styleSelectBtn(el) {
        el.style.position = 'absolute';
        el.style.width = BTN_SIZE + 'px';
        el.style.height = BTN_SIZE + 'px';
        el.style.zIndex = '10000';
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

    function ensureSelectBedsFor(key) {
        const host = getHost();
        const st = clusterStates.get(key); if (!st) return;

        if (!st.btnSelectBeds) {
            const b = document.createElement('img');
            b.src = ICON_SELECT_BEDS;
            b.alt = 'Select beds';
            styleSelectBtn(b);
            b.title = 'Select garden beds (temporary bring-to-front)';
            b.draggable = false;

            b.addEventListener('pointerdown', consumeEvt, { passive: false });
            b.addEventListener('mousedown', consumeEvt, { passive: false });

            b.addEventListener('click', function (evt) {
                consumeEvt(evt);
                const st2 = clusterStates.get(key);
                if (!st2 || !st2.order || !st2.order.length) return;

                const parent = model.getParent(st2.order[0]);
                if (!parent) return;

                const beds = bedsForCluster(key);
                if (!beds.length) return;

                bringCellsToFrontTemporarilyInParent(parent, beds);
                clearVisibilityFor(key);
                graph.setSelectionCells(beds);
                graph.refresh(parent);
                hideUIFor(key);
            });


            host.appendChild(b);
            st.btnSelectBeds = b;
        } else if (st.btnSelectBeds.parentNode !== host) {
            host.appendChild(st.btnSelectBeds);
        }

        st.btnSelectBeds.style.display = '';
    }

    function ensureBadgeFor(key) {
        const host = getHost();
        const st = clusterStates.get(key); if (!st) return;
        if (!st.badge) {
            const b = document.createElement('div');
            b.style.position = 'absolute';
            b.style.zIndex = '10000';
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
        if (st.badgePrev) st.badgePrev.style.display = 'none';
        if (st.badgeNext) st.badgeNext.style.display = 'none';
        if (st.btnSelectAll) st.btnSelectAll.style.display = 'none';
        if (st.btnSelectBeds) st.btnSelectBeds.style.display = 'none';

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
        if (st.btnSelectAll || st.btnSelectBeds) {
            const baseX = Math.round(box.x - BTN_SIZE - BTN_INSET);
            const y = Math.round(box.y - BTN_SIZE - BTN_INSET);
            const gap = 4;

            // Left: beds, Right: cluster (so they read left->right)                     
            if (st.btnSelectBeds) {
                st.btnSelectBeds.style.left = baseX + 'px';
                st.btnSelectBeds.style.top = y + 'px';
            }
            if (st.btnSelectAll) {
                const x2 = baseX + (st.btnSelectBeds ? (BTN_SIZE + gap) : 0);
                st.btnSelectAll.style.left = x2 + 'px';
                st.btnSelectAll.style.top = y + 'px';
            }
        }

        if (hasSuccessionControls(st)) { // NEW
            updateOverlapValuesFor(key); // CHANGE
            positionOverlapBadgesFor(key); // CHANGE
        } // NEW
    }

    function updateControlsVisibilityFor(key) {
        const st = clusterStates.get(key); if (!st) return;
        const last = st.order.length - 1;

        if (st.btnPrev) setNavEnabled(st.btnPrev, st.currentIdx > 0);
        if (st.btnNext) setNavEnabled(st.btnNext, st.currentIdx < last);

        if (st.badgePrev) st.badgePrev.style.opacity = (st.currentIdx > 0) ? '1' : '0.35';
        if (st.badgeNext) st.badgeNext.style.opacity = (st.currentIdx < last) ? '1' : '0.35';
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

        updateOverlapValuesFor(key);
        positionOverlapBadgesFor(key);
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

            if (members.length >= 2) { // NEW
                ensureButtonsFor(key); // CHANGE
                ensureBadgeFor(key); // CHANGE
                ensureSelectAllFor(key); // CHANGE
            } // NEW
            ensureSelectBedsFor(key);
            updateControlsVisibilityFor(key);
            positionUIFor(key);
            applyVisibilityFor(key);

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
        const preferred = sel && isTilerGroup(sel) ? sel.id : null;
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
                clusterStates.delete(k);
            }
        }
    }


    function repositionAllUI() {
        for (const [key, st] of clusterStates.entries()) {
            // Only reposition visible UI (selected cluster only)                      
            const hasVisibleUI = // NEW
                (st.btnPrev && st.btnPrev.style.display !== 'none') || // NEW
                (st.btnSelectBeds && st.btnSelectBeds.style.display !== 'none'); // NEW
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
    graph.getModel().addListener(mxEvent.UNDO, function () { rafDebounce(refreshAllForSelectionOrAnchor); });
    graph.getModel().addListener(mxEvent.REDO, function () { rafDebounce(refreshAllForSelectionOrAnchor); });

    graph.getView().addListener(mxEvent.SCALE_AND_TRANSLATE, function () {
        repositionAllUI();
    });
    graph.getView().addListener(mxEvent.REPAINT, function () {
        repositionAllUI();
    });


    // Init
    setTimeout(refreshAllForSelectionOrAnchor, 0);
});
