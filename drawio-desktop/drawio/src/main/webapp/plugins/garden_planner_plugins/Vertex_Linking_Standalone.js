/**
 * Draw.io Plugin: Manual Vertex Linker with Highlight and Shift+Click Navigation
 * - Right-click to link/unlink selected vertices
 * - Highlights linked vertices and draws dashed edges
 * - Shift+Click cycles between linked vertices
 */
Draw.loadPlugin(function (ui) {
    const graph = ui.editor.graph;
    let model = graph.getModel();

    const LINK_ATTR = 'linkedTo';
    const HL_TAG_KEY = 'manualLinkHL';
    const HL_OLD_COLOR = 'manualLinkOldColor';
    const HL_OLD_WIDTH = 'manualLinkOldWidth';
    graph.__ctrlToggleHandled = false;

    // -------------------- Helpers --------------------

    function asVertexArray(cells) {                                                          
        if (!cells) return [];                                                               
        const m = graph.getModel();                                                          
        const out = [];                                                                      
        const seen = new Set();                                                              
    
        for (const raw of cells) {                                                           
            const c = normalizeForLinkingAndPrimary(raw);                                    
            if (!c || !m.isVertex(c)) continue;                                              
            if (seen.has(c.id)) continue;                                                    
            seen.add(c.id);                                                                  
            out.push(c);                                                                     
        }                                                                                    
        return out;                                                                          
    }                                                                                        
    

    function ensureValueIsElementUndoable(cell) {                                     
        if (!cell) return null;                                                      
        const v = cell.value;                                                        
        if (v && typeof v !== 'string' && v.getAttribute) return v;                   

        const doc = mxUtils.createXmlDocument();                                      
        const obj = doc.createElement('object');                                      
        if (typeof v === 'string') obj.setAttribute('label', v);                      
        else obj.setAttribute('label', '');                                           

        // Make this change undoable                                                   
        const change = new mxValueChange(cell, obj);                                   
        model.execute(change);                                                        
        return cell.value;                                                            
    }

    // ---- Undoable helpers ----
    function setCellAttrUndoable(cell, attr, value) {
        ensureValueIsElementUndoable(cell);                                           
        const change = new mxCellAttributeChange(cell, attr, value);
        model.execute(change);
    }


    function getAttr(cell, key) {
        const v = cell && cell.value;
        return (v && v.getAttribute) ? v.getAttribute(key) : null;
    }

    function isKanbanCard(cell) {
        return !!cell && getAttr(cell, 'kanban_card') === '1';
    }

    function findLaneAncestor(cell) {
        const m = graph.getModel();
        let cur = cell ? m.getParent(cell) : null;
        while (cur) {
            if (getAttr(cur, 'lane_key')) return cur;
            cur = m.getParent(cur);
        }
        return null;
    }


    function setStylesUndoable(cells, key, value) {
        if (!cells || !cells.length) return;
        graph.setCellStyles(key, value, cells); // produces mxStyleChange (undoable)
    }


    function getRawStyleValue(cell, key) {
        const s = (cell && cell.getStyle && cell.getStyle()) || '';
        const m = s.match(new RegExp('(?:^|;)' + key + '=([^;]*)'));
        return m ? m[1] : null;
    }
    function isRealColor(c) {
        if (!c) return false;
        const v = String(c).trim().toLowerCase();
        if (v === 'none' || v === 'default') return false;
        return true;
    }

    function getLaneColorForCard(card) {
        if (!isKanbanCard(card)) return null;
        const lane = findLaneAncestor(card);
        if (!lane) {
            console.log('[ManualLinker] getLaneColorForCard: no lane for card',
                card && card.id);
            return null;
        }

        const style = lane.getStyle ? lane.getStyle() : '';
        const laneFill = getRawStyleValue(lane, 'swimlaneFillColor');
        const laneFillColor = getRawStyleValue(lane, 'fillColor');
        const laneStroke = getRawStyleValue(lane, 'strokeColor');

        let picked = null;
        if (isRealColor(laneFill)) picked = laneFill;
        else if (isRealColor(laneFillColor)) picked = laneFillColor;
        else if (isRealColor(laneStroke)) picked = laneStroke;

        console.log('[ManualLinker] getLaneColorForCard', {
            cardId: card && card.id,
            laneId: lane && lane.id,
            laneStyle: style,
            laneFill,
            laneFillColor,
            laneStroke,
            pickedColor: picked
        });

        return picked;
    }

    function getLinkLaneColor(a, b) {
        const c = getLaneColorForCard(a) || getLaneColorForCard(b) || null;
        console.log('[ManualLinker] getLinkLaneColor', {
            aId: a && a.id,
            bId: b && b.id,
            color: c
        });
        return c;
    }



    function captureOriginalStrokeIfMissing(cell) {
        const val = ensureValueIsElementUndoable(cell);
        const hasOldColor = val.getAttribute(HL_OLD_COLOR) != null;
        const hasOldWidth = val.getAttribute(HL_OLD_WIDTH) != null;
        if (!hasOldColor) {
            const prevColor = getRawStyleValue(cell, 'strokeColor') || '';
            setCellAttrUndoable(cell, HL_OLD_COLOR, prevColor);
        }
        if (!hasOldWidth) {
            const prevWidth = getRawStyleValue(cell, 'strokeWidth') || '';
            setCellAttrUndoable(cell, HL_OLD_WIDTH, prevWidth);
        }
        setCellAttrUndoable(cell, HL_TAG_KEY, '1');
    }

    function restoreOriginalStrokeIfAny(cells) {
        if (!cells || !cells.length) return;
        const toNullColor = [], toNullWidth = [], setColor = [], setWidth = [];
        for (const c of cells) {
            const v = c && c.value && c.value.getAttribute ? c.value : null;
            if (!v) continue;
            const oldColor = v.getAttribute(HL_OLD_COLOR);
            const oldWidth = v.getAttribute(HL_OLD_WIDTH);
            if (oldColor != null) {
                if (oldColor === '') toNullColor.push(c); else setColor.push([c, oldColor]);
            }
            if (oldWidth != null) {
                if (oldWidth === '') toNullWidth.push(c); else setWidth.push([c, oldWidth]);
            }
        }
        if (toNullColor.length) setStylesUndoable(toNullColor, mxConstants.STYLE_STROKECOLOR, null);
        if (toNullWidth.length) setStylesUndoable(toNullWidth, mxConstants.STYLE_STROKEWIDTH, null);
        // In restoreOriginalStrokeIfAny:
        if (setColor.length) { for (const [c, val] of setColor) setStylesUndoable([c], mxConstants.STYLE_STROKECOLOR, val); }
        if (setWidth.length) { for (const [c, val] of setWidth) setStylesUndoable([c], mxConstants.STYLE_STROKEWIDTH, val); }

        for (const c of cells) {
            setCellAttrUndoable(c, HL_TAG_KEY, null);
            setCellAttrUndoable(c, HL_OLD_COLOR, null);
            setCellAttrUndoable(c, HL_OLD_WIDTH, null);
        }
    }


    // HTML string helpers
    // --- Raw label extractor: plain text from cell.value, no placeholders ---
    // Config: strip %placeholder% tokens? Set to false if you want to keep them.
    const STRIP_PLACEHOLDERS = true;

    function decodeBasicEntities(s) {
        // minimal decode for common entities used in labels
        return s
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
    }

    function stripHtmlAndPlaceholders(s) {
        // Remove HTML tags
        s = s.replace(/<[^>]*>/g, '');
        // Decode common entities
        s = decodeBasicEntities(s);
        // Optionally remove %placeholder% tokens
        if (STRIP_PLACEHOLDERS) s = s.replace(/%[^%]+%/g, '');
        // Normalize whitespace
        return s.replace(/\s+/g, ' ').trim();
    }

    function getRawTextLabel(cell) {
        if (!cell) return '';
        const v = cell.value;
        if (v == null) return '';

        if (typeof v === 'string') {
            return stripHtmlAndPlaceholders(v);
        }

        // XML <object> case
        if (v.getAttribute) {
            // Prefer explicit 'label' attribute if present
            const lbl = v.getAttribute('label');
            if (lbl != null && lbl !== '') return stripHtmlAndPlaceholders(lbl);
            // Fallback: textContent of the node subtree (plain text)
            let txt = '';
            try { txt = v.textContent || ''; } catch (_) { }
            return stripHtmlAndPlaceholders(txt);
        }

        // Fallback
        return stripHtmlAndPlaceholders(String(v));
    }


    // Track which vertices we highlighted last time (for precise clearing)
    const highlightedIds = new Set();

    function markHighlighted(cell) {
        if (cell && cell.id) highlightedIds.add(cell.id);
    }

    const highlightDomCache = new Map(); // cellId -> { stroke, strokeWidth }





    // Center of a vertex from the current view state (with Kanban fallback)        
    function getCellCenter(cell) {
        if (!cell) return null;

        const view = graph.getView();
        const m = graph.getModel();

        // First try the cell itself                                               
        let st = view.getState(cell);
        if (st && m.isVisible(cell)) {
            return {
                x: st.x + st.width / 2,
                y: st.y + st.height / 2,
                w: st.width,
                h: st.height
            };
        }

        // Fallback: if this is a Kanban task card that is currently hidden,       
        // anchor overlays to its parent lane instead of dropping the link.        
        if (isKanbanCard(cell)) {
            const lane = findLaneAncestor(cell);
            if (lane) {
                const laneState = view.getState(lane);
                if (laneState && m.isVisible(lane)) {
                    return {
                        x: laneState.x + laneState.width / 2,
                        y: laneState.y + laneState.height / 2,
                        w: laneState.width,
                        h: laneState.height
                    };
                }
            }
        }

        // No usable geometry                                                      
        return null;
    }


    // Decide which side of `src` is closest to `dst` by comparing deltas
    function sideToward(srcCenter, dstCenter) {
        const dx = dstCenter.x - srcCenter.x;
        const dy = dstCenter.y - srcCenter.y;
        if (Math.abs(dx) >= Math.abs(dy)) {
            return dx >= 0 ? 'right' : 'left';
        } else {
            return dy >= 0 ? 'bottom' : 'top';
        }
    }


    // Remove a one-way link (undoable) when the other cell is missing
    function removeOneWayLink(cell, otherId) {
        const set = getLinkSet(cell);
        if (set.delete(otherId)) setLinkSet(cell, set); // setLinkSet is undoable
    }


    function normalizeLinks(cell) {
        const b = pruneBrokenLinks(cell);
        const w = pruneOneWayLinks(cell);
        return { removed: b.removed + w, broken: b.removed, oneWay: w };
    }


    // Compute evenly spaced normalized t positions (0..1) for n links along a side.
    // Ensures a minimum gap (minGapPx) and maximum gap (maxGapPx) in screen pixels,
    // spanning at most sideLenPx, centered on the side.
    function boundedEvenTPositions(n, sideLenPx, minGapPx, maxGapPx, marginPx) {
        if (n <= 0 || sideLenPx <= 0) return [];
        if (n === 1) return [0.5]; // Single link: center it.

        // --- (1) Compute the natural span and enforce both bounds ---
        const desiredSpan = Math.min(sideLenPx, maxGapPx * (n - 1));
        const minSpan = Math.min(sideLenPx, minGapPx * (n - 1));
        const spanPx = Math.max(minSpan, desiredSpan);

        // --- (2) Compute actual gap and start offset (centered span) ---
        const gapPx = spanPx / (n - 1);
        const startPx = (sideLenPx - spanPx) / 2;

        // --- (3) Normalize to [0,1] and apply corner margin ---
        const eps = Math.min(marginPx / sideLenPx, 0.49);
        const toT = (px) => Math.max(eps, Math.min(1 - eps, px / sideLenPx));

        const t = new Array(n);
        for (let i = 0; i < n; i++) {
            const posPx = startPx + i * gapPx;
            t[i] = toT(posPx);
        }
        return t;
    }




    // For an origin and its linked target cells, return a map: id -> {side, t}
    // Adds a pixel cap per adjacent link (default 10px), and a small corner margin (default 4px).
    function computeExitParamsForOrigin(origin, targets, maxGapPx = 10, marginPx = 4) {
        const srcC = getCellCenter(origin);
        const groups = { left: [], right: [], top: [], bottom: [] };

        for (const tcell of targets) {
            const dstC = getCellCenter(tcell);
            if (!srcC || !dstC) continue;
            const side = sideToward(srcC, dstC);
            groups[side].push(tcell);
        }

        const map = new Map(); // targetId -> {side, t}
        for (const side of ['left', 'right', 'top', 'bottom']) {
            const arr = groups[side];
            const n = arr.length;
            if (n === 0) continue;

            // Stable order for nicer spacing
            if (side === 'left' || side === 'right') {
                arr.sort((a, b) => (getCellCenter(a)?.y || 0) - (getCellCenter(b)?.y || 0));
            } else {
                arr.sort((a, b) => (getCellCenter(a)?.x || 0) - (getCellCenter(b)?.x || 0));
            }

            // Side length in pixels from origin’s state
            const sideLenPx = (side === 'left' || side === 'right') ? srcC.h : srcC.w;

            // Compute capped t positions
            const tVals = boundedEvenTPositions(n, sideLenPx, 10 /* minGapPx */, 20 /* maxGapPx */, marginPx);

            for (let i = 0; i < n; i++) {
                map.set(arr[i].id, { side, t: tVals[i] });
            }
        }
        return map;
    }


    // ---- Anchor helpers for overlay line geometry --------------------------------------- 
    function anchorOnSide(center, side, t) {
        // center: {x, y, w, h}, side: 'left'|'right'|'top'|'bottom', t in [0,1]           
        const c = center;
        const tt = Math.max(0, Math.min(1, t == null ? 0.5 : t));
        if (!c) return null;
        if (side === 'left') {
            return { x: c.x - c.w / 2, y: c.y - c.h / 2 + tt * c.h };
        }
        if (side === 'right') {
            return { x: c.x + c.w / 2, y: c.y - c.h / 2 + tt * c.h };
        }
        if (side === 'top') {
            return { x: c.x - c.w / 2 + tt * c.w, y: c.y - c.h / 2 };
        }
        if (side === 'bottom') {
            return { x: c.x - c.w / 2 + tt * c.w, y: c.y + c.h / 2 };
        }
        // Fallback: center                                                                 
        return { x: c.x, y: c.y };
    }


    // ------------------ LANE STATUS EDGE VISIBILITY POLICY ------------------      

    const UPCOMING_LANES = new Set([
        'UPCOMING_YEAR',
        'UPCOMING_MONTH',
        'UPCOMING_WEEK'
    ]);

    const ACTIVE_LANES = new Set([
        'TODO_STAGED',
        'TODO',
        'DOING'
    ]);

    const DONE_LANES = new Set([
        'DONE',
        'DONE_WEEK',
        'DONE_MONTH',
        'DONE_YEAR',
        'ARCHIVED'
    ]);

    function mapStatusToKey(raw) {
        if (!raw) return null;
        raw = String(raw).trim().toUpperCase();

        if (raw.includes('UPCOMING')) {
            if (raw.includes('YEAR')) return 'UPCOMING_YEAR';
            if (raw.includes('MONTH')) return 'UPCOMING_MONTH';
            return 'UPCOMING_WEEK';
        }

        if (raw.includes('STAGED')) return 'TODO_STAGED';
        if (raw === 'TODO') return 'TODO';
        if (raw === 'DOING') return 'DOING';

        if (raw.includes('DONE')) {
            if (raw.includes('WEEK')) return 'DONE_WEEK';
            if (raw.includes('MONTH')) return 'DONE_MONTH';
            if (raw.includes('YEAR')) return 'DONE_YEAR';
            return 'DONE';
        }

        if (raw.includes('ARCHIVED')) return 'ARCHIVED';

        return raw;
    }

    function parseDateMaybe(d) {
        if (!d) return null;
        const t = Date.parse(d);
        return Number.isFinite(t) ? t : null;
    }

    function getStartDate(cell) {
        return parseDateMaybe(getAttr(cell, 'start'));
    }

    // Primary: read status from lane_key; fallback to card.status if present        
    function getLaneStatusKeyForTask(card) {
        if (!card) return null;
        const lane = findLaneAncestor(card);
        let laneRaw = lane ? getAttr(lane, 'lane_key') : null;

        if (laneRaw) {
            const key = String(laneRaw).trim().toUpperCase();
            console.log('[LaneStatus] from lane_key', { cardId: card.id, laneId: lane && lane.id, laneRaw, key });
            return key || null;
        }

        const statusRaw = getAttr(card, 'status');
        const mapped = mapStatusToKey(statusRaw);
        console.log('[LaneStatus] from status', { cardId: card.id, statusRaw, mapped });
        return mapped;
    }


    function isTilerGroup(cell) {
        return !!cell && getAttr(cell, 'tiler_group') === '1';
    }

    function findTilerGroupAncestor(cell) {                                                  
        const m = graph.getModel();                                                          
        let cur = cell;                                                                      
        while (cur) {                                                                        
            if (isTilerGroup(cur)) return cur;                                               
            cur = m.getParent(cur);                                                          
        }                                                                                    
        return null;                                                                         
    }                                                                                        

    function normalizeForLinkingAndPrimary(cell) {                                           
        if (!cell) return null;                                                              
        const tg = findTilerGroupAncestor(cell);                                             
        // If it's inside a tiler group (including the group itself), operate on the group  
        return tg || cell;                                                                   
    }                                                                                        


    /**                                                                             
     * Decide whether to show the edge from `source` → `target` using lane          
     * status and start dates.                                                      
     */
    function shouldShowEdgeInternal(source, target) {

        const sid = source ? source.id : null;
        const tid = target ? target.id : null;

        const sourceIsTiler = isTilerGroup(source);
        const targetIsTask = isKanbanCard(target);

        console.log("[EdgePolicy] ENTER", {
            sourceId: sid,
            targetId: tid,
            sourceIsTiler,
            targetIsTask
        });

        // For anything other than tiler-group → task-card, always show edge:
        if (!sourceIsTiler || !targetIsTask) {
            console.log("[EdgePolicy] NOT tiler→task → SHOW");
            return true;
        }

        // Status is defined by the TARGET task (its lane/status), not the tiler.
        const key = getLaneStatusKeyForTask(target);

        console.log("[EdgePolicy] laneKey", {
            taskId: tid,
            laneKey: key,
            rawStatus: getAttr(target, 'status'),
            laneAncestor: (function () {
                const lane = findLaneAncestor(target);
                return lane ? { id: lane.id, lane_key: getAttr(lane, 'lane_key') } : null;
            })()
        });

        if (!key) {
            console.log("[EdgePolicy] NO LANE KEY → SHOW");
            return true;
        }

        // ACTIVE lanes: always show edges to tasks in active lanes
        if (ACTIVE_LANES.has(key)) {
            console.log("[EdgePolicy] ACTIVE lane → SHOW");
            return true;
        }

        // For non-active lanes (UPCOMING + DONE), compute best card PER LANE KEY.   
        const model = graph.getModel();
        const ids = Array.from(getLinkSet(source));
        const now = Date.now();

        // UPCOMING: earliest future start date per upcoming lane key                
        const bestUpcomingByKey = new Map(); // key -> { cell, time }               

        // DONE: most recent start date per done lane key (fallback to first).      
        const bestDoneByKey = new Map();    // key -> { cell, time }                
        const firstDoneByKey = new Map();   // key -> cell                          

        for (const id of ids) {
            const other = model.getCell(id);
            if (!other || !model.isVertex(other)) continue;

            const otherKey = getLaneStatusKeyForTask(other);
            if (!otherKey) continue;

            const t = getStartDate(other);

            // --- UPCOMING group: per-lane earliest future start date ---          
            if (UPCOMING_LANES.has(otherKey)) {
                if (t == null || t < now) continue;
                const current = bestUpcomingByKey.get(otherKey);
                if (!current || t < current.time) {
                    bestUpcomingByKey.set(otherKey, { cell: other, time: t });
                }
            }
            // --- DONE/ARCHIVED group: per-lane most recent start date ---         
            else if (DONE_LANES.has(otherKey)) {
                if (!firstDoneByKey.has(otherKey)) {
                    firstDoneByKey.set(otherKey, other);
                }
                const current = bestDoneByKey.get(otherKey);
                if (t != null) {
                    if (!current || current.time == null || t > current.time) {
                        bestDoneByKey.set(otherKey, { cell: other, time: t });
                    }
                }
            }
        }

        const bestUpcomingEntry = bestUpcomingByKey.get(key) || null;
        const bestDoneEntry = bestDoneByKey.get(key) ||
            (firstDoneByKey.has(key) ? { cell: firstDoneByKey.get(key), time: null } : null);

        console.log("[EdgePolicy] BEST per lane", {
            laneKey: key,
            bestUpcomingId: bestUpcomingEntry ? bestUpcomingEntry.cell.id : null,
            bestDoneId: bestDoneEntry ? bestDoneEntry.cell.id : null
        });

        // UPCOMING lanes: only show edge to the chosen upcoming card for this lane 
        if (UPCOMING_LANES.has(key)) {
            const show = !!bestUpcomingEntry && bestUpcomingEntry.cell === target;
            console.log("[EdgePolicy] UPCOMING lane →", show ? "SHOW" : "HIDE");
            return show;
        }

        // DONE / ARCHIVED lanes: only show edge to the chosen done card for this lane 
        if (DONE_LANES.has(key)) {
            const show = !!bestDoneEntry && bestDoneEntry.cell === target;
            console.log("[EdgePolicy] DONE lane →", show ? "SHOW" : "HIDE");
            return show;
        }

        // Fallback: hide
        console.log("[EdgePolicy] FALLBACK → HIDE");
        return false;
    }



    // -------------------- View-only Link Overlay Manager --------------------               (replaces previous block)
    // Pure DOM-based overlays using mxPolyline + mxText; no model changes, no undo impact. 
    const linkOverlays = (function () {
        const registry = new Map(); // pairKey -> entry                                    
        // entry: { srcId, trgId, exitHint, color, label, poly, labelElt }                 

        function pairKey(aId, bId) {
            if (!aId || !bId) return null;
            return (aId < bId) ? (aId + '|' + bId) : (bId + '|' + aId);
        }

        function getOverlayPane() {
            const view = graph.getView && graph.getView();
            return view && view.getOverlayPane ? view.getOverlayPane() : null;
        }

        // Compute line endpoints from current cell geometry + exitHint                    
        function computePointsFor(entry) {
            const m = model;
            const a = m.getCell(entry.srcId);
            const b = m.getCell(entry.trgId);
            if (!a || !b) return null;

            const srcC = getCellCenter(a);
            const dstC = getCellCenter(b);
            if (!srcC || !dstC) return null;

            let srcPt = null;
            const hint = entry.exitHint;
            if (hint && hint.side) {
                srcPt = anchorOnSide(srcC, hint.side, hint.t);
            }
            if (!srcPt) {
                srcPt = { x: srcC.x, y: srcC.y };
            }

            const trgSide = sideToward(dstC, srcC);
            const trgPt = anchorOnSide(dstC, trgSide, 0.5);
            if (!trgPt) return null;

            return [
                new mxPoint(srcPt.x, srcPt.y),
                new mxPoint(trgPt.x, trgPt.y)
            ];
        }

        // Create or update text label near the source side                               
        function createOrUpdateLabel(entry, pts) {
            const pane = getOverlayPane();
            const label = entry.label || '';
            if (!pane || !pts || pts.length < 2 || !label.trim()) {
                // No label or no geometry → remove any existing label                     
                if (entry.labelElt && entry.labelElt.node && entry.labelElt.node.parentNode) {
                    entry.labelElt.node.parentNode.removeChild(entry.labelElt.node);
                }
                entry.labelElt = null;
                if (label.trim()) {
                }
                return;
            }

            const p0 = pts[0];
            const p1 = pts[1];

            // Defensive: ensure we have finite coordinates                               
            if (!isFinite(p0.x) || !isFinite(p0.y) || !isFinite(p1.x) || !isFinite(p1.y)) {
                return;
            }

            const r = (typeof LABEL_NEAR_SRC_RATIO === 'number'
                ? LABEL_NEAR_SRC_RATIO
                : 0.15);
            const lx = p0.x + r * (p1.x - p0.x);
            const ly = p0.y + r * (p1.y - p0.y);

            if (!isFinite(lx) || !isFinite(ly)) {
                return;
            }

            if (entry.labelElt && entry.labelElt.node &&
                entry.labelElt.node.parentNode === pane) {
                // Update existing mxText
                entry.labelElt.value = label;
                entry.labelElt.bounds.x = lx;
                entry.labelElt.bounds.y = ly;
                entry.labelElt.redraw();
            } else {
                // Remove old, if any
                if (entry.labelElt && entry.labelElt.node && entry.labelElt.node.parentNode) {
                    entry.labelElt.node.parentNode.removeChild(entry.labelElt.node);
                }

                // --- CREATE NEW LABEL -------------------------------------------------------
                const bounds = new mxRectangle(lx, ly, 1, 1);

                const txt = new mxText(
                    label,
                    bounds,
                    mxConstants.ALIGN_LEFT,
                    mxConstants.ALIGN_MIDDLE,
                    '#000000',
                    mxConstants.FONT_BOLD,
                    11,
                    '#000000',
                    '#ffffff',
                    '#000000'
                );
                txt.dialect = graph.dialect;
                txt.init(pane);
                txt.redraw();

                if (txt.node) {
                    txt.node.__manualLinkMeta = {
                        srcId: entry.srcId,
                        trgId: entry.trgId
                    };
                    txt.node.style.pointerEvents = 'all';                        // ensure click
                    mxEvent.addListener(txt.node, 'mousedown', function (evt) {
                        const isShift = mxEvent.isShiftDown(evt);
                        const isLeft = (evt.button === 0);

                        if (isShift && isLeft) {
                            navigateOverlayLink(
                                txt.node.__manualLinkMeta, evt
                            );
                        }
                    });
                }

                entry.labelElt = txt;

            }
        }


        function createOrUpdatePolyline(entry) {
            const pane = getOverlayPane();
            const pts = computePointsFor(entry);
            if (!pane || !pts) {
                // Remove any existing poly and label if we can no longer compute geometry 
                if (entry.poly && entry.poly.node && entry.poly.node.parentNode) {
                    entry.poly.node.parentNode.removeChild(entry.poly.node);
                }
                if (entry.labelElt && entry.labelElt.node && entry.labelElt.node.parentNode) {
                    entry.labelElt.node.parentNode.removeChild(entry.labelElt.node);
                }
                entry.poly = null;
                entry.labelElt = null;
                return;
            }

            const stroke = entry.color || '#ff0000';

            if (entry.poly && entry.poly.node &&
                entry.poly.node.parentNode === pane) {
                entry.poly.points = pts;
                entry.poly.stroke = stroke;
                entry.poly.redraw();
            } else {
                // Remove old instance if attached elsewhere                               
                if (entry.poly && entry.poly.node && entry.poly.node.parentNode) {
                    entry.poly.node.parentNode.removeChild(entry.poly.node);
                }

                const poly = new mxPolyline(pts, stroke, 3);
                poly.dialect = graph.dialect;
                poly.init(pane);
                poly.redraw();

                if (poly.node) {
                    poly.node.__manualLinkMeta = {
                        srcId: entry.srcId,
                        trgId: entry.trgId
                    };
                    poly.node.style.pointerEvents = 'stroke';                     // ensure hit
                    mxEvent.addListener(poly.node, 'mousedown', function (evt) {
                        const isShift = mxEvent.isShiftDown(evt);
                        const isLeft = (evt.button === 0);

                        if (isShift && isLeft) {
                            navigateOverlayLink(
                                poly.node.__manualLinkMeta, evt
                            );
                        }
                    });
                }

                entry.poly = poly;
            }

            // Label: create/update based on current points                                
            createOrUpdateLabel(entry, pts);
        }

        /**
         * Set or replace the overlay line between two vertices.
         * - a, b: vertex cells
         * - exitHint: {side, t} from computeExitParamsForOrigin (may be null)
         * - color: stroke color
         * - label: plain text label
         */
        function setLinkOverlay(a, b, exitHint, color, label) {
            if (!a || !b || a === b) return;
            const aId = a.id, bId = b.id;
            const key = pairKey(aId, bId);
            if (!key) return;

            let entry = registry.get(key);
            if (!entry) {
                entry = {
                    srcId: aId,
                    trgId: bId,
                    exitHint: exitHint || null,
                    color: color || '#ff0000',
                    label: label || '',
                    poly: null,
                    labelElt: null
                };
                registry.set(key, entry);
            } else {
                entry.exitHint = exitHint || null;
                entry.color = color || '#ff0000';
                entry.label = label || '';
            }

            createOrUpdatePolyline(entry);
        }

        function clearAll() {
            for (const entry of registry.values()) {
                if (entry.poly && entry.poly.node && entry.poly.node.parentNode) {
                    entry.poly.node.parentNode.removeChild(entry.poly.node);
                }
                if (entry.labelElt && entry.labelElt.node && entry.labelElt.node.parentNode) {
                    entry.labelElt.node.parentNode.removeChild(entry.labelElt.node);
                }
            }
            registry.clear();
        }

        function getLinkMetaForNode(node) {                                                // UNCHANGED
            let cur = node;
            while (cur) {
                if (cur.__manualLinkMeta) return cur.__manualLinkMeta;
                cur = cur.parentNode;
            }
            return null;
        }

        function refreshAll() {
            for (const entry of registry.values()) {
                createOrUpdatePolyline(entry);
            }
        }

        return {
            setLinkOverlay,
            clearAll,
            getLinkMetaForNode,
            refreshAll
        };
    })();


    // Primary flag persistence
    const PRIMARY_ATTR = 'manualLinkPrimary'; // string '1' means primary

    function isPrimary(cell) {
        if (!cell) return false;
        const val = ensureValueIsElementUndoable(cell); // ensures XML <object>
        return val.getAttribute(PRIMARY_ATTR) === '1';
    }

    // setPrimary
    function setPrimary(cell, flag) {
        setCellAttrUndoable(cell, PRIMARY_ATTR, flag ? '1' : null);
    }


    // Partition a vertex array into Primaries (P) and Secondaries (S)
    function derivePrimariesAndSecondaries(verts) {
        const P = [], S = [];
        for (const v of verts) (isPrimary(v) ? P : S).push(v);
        return { P, S };
    }


    // Works for arbitrarily nested children
    function selectAndReveal(cell) {
        if (!cell) return;
        const m = graph.getModel();

        m.beginUpdate();
        try {
            // Walk up to the root, making every ancestor visible and expanded
            let anc = cell;
            while (anc) {
                const parent = m.getParent(anc);

                if (parent) {
                    // Ensure ancestor is visible (layers/groups/swimlanes)
                    if (!m.isVisible(parent)) m.setVisible(parent, true);

                    // If ancestor is collapsed, expand it
                    if (graph.isCellCollapsed(parent)) {
                        // false = expand (unfold)
                        graph.foldCells(false, false, [parent]);
                    }
                }

                anc = parent;
            }
        } finally {
            m.endUpdate();
        }

        // If the cell itself isn't selectable, pick nearest selectable ancestor
        let target = cell;
        while (target && !graph.isCellSelectable(target)) {
            target = m.getParent(target);
        }

        if (target) {
            graph.setSelectionCell(target);
            graph.scrollCellToVisible(target, true); // recenter/zoom into view
        }
    }


    // Navigate between endpoints of an overlay link                        
    function navigateOverlayLink(meta, evt) {
        if (!meta) return;
        const m = graph.getModel();
        const src = m.getCell(meta.srcId);
        const trg = m.getCell(meta.trgId);
        if (!src && !trg) return;

        const curSel = graph.getSelectionCell();
        let next = null;
        if (curSel && src && curSel === src && trg) next = trg;
        else if (curSel && trg && curSel === trg && src) next = src;
        else next = src || trg;

        if (next) {
            selectAndReveal(next);
            graph.scrollCellToVisible(next, true);
        }

        if (evt) {
            mxEvent.consume(evt);
            if (evt.stopPropagation) evt.stopPropagation();
            if (evt.preventDefault) evt.preventDefault();
        }
    }


    function computeApplicablePairsForLinking(verts) {                                  
        const { P, S } = derivePrimariesAndSecondaries(verts);                          
        const pairs = [];                                                              

        if (P.length > 0) {                                                            
            for (const a of P) for (const b of S) {                                     
                if (a && b && a !== b) pairs.push([a, b]);                              
            }
        } else {                                                                       
            for (let i = 0; i < verts.length; i++) {                                   
                for (let j = i + 1; j < verts.length; j++) {                           
                    const a = verts[i], b = verts[j];                                  
                    if (a && b && a !== b) pairs.push([a, b]);                          
                }
            }
        }
        return pairs;                                                                  
    }

    function isPairLinked(a, b) {                                                      
        if (!a || !b) return false;                                                    
        const aSet = getLinkSet(a);                                                    
        return aSet.has(b.id);                                                         
    }

    function countLinkedPairs(pairs) {                                                 
        let linked = 0;                                                                
        for (const [a, b] of pairs) {                                                  
            if (isPairLinked(a, b) && isPairLinked(b, a)) linked++;                    
        }
        return linked;                                                                 
    }

    function unlinkRespectingPrimaries(verts) {                                        
        const pairs = computeApplicablePairsForLinking(verts);                         
        let removed = 0;                                                               

        model.beginUpdate();                                                           
        try {
            for (const [a, b] of pairs) {                                              
                if (removeBidirectionalLink(a, b)) {                                   
                    removed++;                                                         
                    graph.refresh(a);                                                  
                    graph.refresh(b);                                                  
                }
            }
        } finally { model.endUpdate(); }                                               

        if (removed > 0) {                                                             
            try { graph.fireEvent(new mxEventObject('linksChanged', 'cells', verts)); } catch (_) { } 
        }
        return { pairs: pairs.length, removed };                                       
    }


    // Link respecting primaries:
    // If any primaries, link every Primary ↔ every Secondary only.
    // If no primaries, link all pairs (existing behavior).
    function linkRespectingPrimaries(verts) {
        const { P, S } = derivePrimariesAndSecondaries(verts);
        let pairs = 0, changes = 0;

        model.beginUpdate();
        try {
            if (P.length > 0) {
                // Only P×S
                for (const a of P) for (const b of S) {
                    if (a === b) continue;
                    pairs++;
                    if (addBidirectionalLink(a, b)) {
                        changes++; graph.refresh(a); graph.refresh(b);
                    }
                }
            } else {
                // No primaries → all pairs
                for (let i = 0; i < verts.length; i++) {
                    for (let j = i + 1; j < verts.length; j++) {
                        const a = verts[i], b = verts[j];
                        pairs++;
                        if (addBidirectionalLink(a, b)) {
                            changes++; graph.refresh(a); graph.refresh(b);
                        }
                    }
                }
            }
        } finally { model.endUpdate(); }

        if (changes > 0) {
            try { graph.fireEvent(new mxEventObject('linksChanged', 'cells', verts)); } catch (_) { }
        }
        return { pairs, changes };
    }


    function getLinkSet(cell) {
        if (!cell) return new Set();
        const val = cell.value;
        const raw = (val && val.getAttribute) ? val.getAttribute(LINK_ATTR) : null;
        if (!raw) return new Set();
        return new Set(String(raw).split(',').map(s => s.trim()).filter(Boolean));
    }

    // setLinkSet
    function setLinkSet(cell, idSet) {
        if (!cell) return;
        setCellAttrUndoable(cell, LINK_ATTR, Array.from(idSet).join(','));
    }


    // ---------- Helpers (near link helpers) ---------------------------------------------------------

    function removeIdsFromLinkSet(cell, idsToRemove) {
        const set = getLinkSet(cell);
        let changed = false, removed = 0;
        for (const id of idsToRemove) {
            if (set.delete(id)) { changed = true; removed++; }
        }
        if (changed) setLinkSet(cell, set);
        return { changed, removed };
    }



    // Unlink this vertex from every linked partner; returns {checked, removed}
    function unlinkAllFor(cell) {
        const ids = Array.from(getLinkSet(cell));
        let checked = 0, removed = 0;

        const m = graph.getModel();
        m.beginUpdate();
        try {
            for (const id of ids) {
                const other = m.getCell(id);
                if (!other || !m.isVertex(other)) continue;
                checked++;
                if (removeBidirectionalLink(cell, other)) {
                    removed++;
                    graph.refresh(cell);
                    graph.refresh(other);
                }
            }
        } finally {
            m.endUpdate();
        }

        if (removed > 0) {
            try { graph.fireEvent(new mxEventObject('linksChanged', 'cells', [cell])); } catch (_) { }
        }
        return { checked, removed };
    }


    // Add bidirectional link
    function addBidirectionalLink(a, b) {
        if (!a || !b || a === b) return false;
        const aSet = getLinkSet(a);
        const bSet = getLinkSet(b);
        let changed = false;

        if (!aSet.has(b.id)) { aSet.add(b.id); setLinkSet(a, aSet); changed = true; }
        if (!bSet.has(a.id)) { bSet.add(a.id); setLinkSet(b, bSet); changed = true; }
        return changed;
    }

    // Remove bidirectional link
    function removeBidirectionalLink(a, b) {
        if (!a || !b || a === b) return false;
        const aSet = getLinkSet(a);
        const bSet = getLinkSet(b);
        let changed = false;

        if (aSet.delete(b.id)) { setLinkSet(a, aSet); changed = true; }
        if (bSet.delete(a.id)) { setLinkSet(b, bSet); changed = true; }
        return changed;
    }


    // Highlight a cell via DOM style (view-only) and track it       
    function highlight(cell, color) {
        domHighlightVertex(cell, color);
    }



    // DOM-based vertex highlighting (no model/undo impact)                    
    function domHighlightVertex(cell, color) {
        if (!cell || !cell.id) return;
        const st = graph.getView().getState(cell);
        if (!st || !st.shape || !st.shape.node) return;

        const root = st.shape.node;
        // pick actual drawable child (path/rect) instead of the <g> container
        let target = root.querySelector('path, rect');
        if (!target) target = root;

        if (!highlightDomCache.has(cell.id)) {
            highlightDomCache.set(cell.id, {
                stroke: target.style.stroke || '',
                strokeWidth: target.style.strokeWidth || ''
            });
        }

        target.style.stroke = color || '#ff0000';
        target.style.strokeWidth = '3px';
        markHighlighted(cell);
    }

    function clearDomHighlights() {
        const view = graph.getView();
        for (const [id, prev] of highlightDomCache.entries()) {
            const cell = model.getCell(id);
            if (!cell) continue;
            const st = view.getState(cell);
            if (!st || !st.shape || !st.shape.node) continue;

            const root = st.shape.node;
            let target = root.querySelector('path, rect');
            if (!target) target = root;

            target.style.stroke = prev.stroke;
            target.style.strokeWidth = prev.strokeWidth;
        }
        highlightDomCache.clear();
        highlightedIds.clear();
    }




    // Clear visuals WITHOUT opening a transaction; caller groups.
    // Only clear what we previously changed, and only on vertices.
    function clearAllHighlights() {
        linkOverlays.clearAll();                                             
        clearDomHighlights();                                               
    }


    function refreshCurrentHighlight() { // CHANGE
        const selected = graph.getSelectionCells(); // CHANGE
    
        if (!selected || selected.length !== 1) { // CHANGE
            highlightLinked(null); // CHANGE
            return; // CHANGE
        }
    
        const cell = normalizeForLinkingAndPrimary(selected[0]); // CHANGE
        if (cell && model.isVertex(cell)) { // CHANGE
            highlightLinked(cell); // CHANGE
        } else { // CHANGE
            highlightLinked(null); // CHANGE
        } // CHANGE
    } // CHANGE

    // Config: whether a Primary vertex should be highlighted even without links
    const ALLOW_PRIMARY_WHEN_UNLINKED = true; // set to false to require links

    function highlightLinked(cell) {
        const YELLOW = '#ffd400';
        const RED = '#ff0000';

        model.beginUpdate();
        try {
            clearAllHighlights();
            if (!cell) return;

            const pruned = pruneBrokenLinks(cell);

            let linkedIds = getLinkSet(cell);
            const selIsPrimary = isPrimary(cell);
            const hasLinks = linkedIds.size > 0;

            if (!hasLinks && !(ALLOW_PRIMARY_WHEN_UNLINKED && selIsPrimary)) {
                return;
            }

            highlight(cell, selIsPrimary ? YELLOW : RED);

            if (!hasLinks) return;

            const targets = [];
            for (const id of linkedIds) {
                const other = model.getCell(id);
                if (other && model.isVertex(other))
                    targets.push(other);
            }

            const exitMap = computeExitParamsForOrigin(cell, targets);

            for (const other of targets) {
                const otherIsPrimary = isPrimary(other);
                highlight(other, otherIsPrimary ? YELLOW : RED);

                // If link touches a Kanban task card, edge color = lane fillColor  
                const laneColor = getLinkLaneColor(cell, other);
                const edgeColor = laneColor
                    ? laneColor
                    : ((selIsPrimary || otherIsPrimary) ? YELLOW : RED);

                const label = getRawTextLabel ? getRawTextLabel(other) : '';
                const exitHint = exitMap.get(other.id);

                // Decide visibility using internal lane-based policy               
                const shouldShow = shouldShowEdgeInternal(cell, other);
                if (shouldShow) {
                    linkOverlays.setLinkOverlay(
                        cell, other, exitHint, edgeColor, label
                    );
                }
            }


        } finally {
            model.endUpdate();
        }
    }

    // -------------------- Shift/Ctrl Click Handling --------------------
    graph.addMouseListener({
        mouseDown(sender, me) {
            const evt = me.getEvent();


            // Ctrl/Meta+Click: toggle the deepest vertex under mouse and consume
            if (mxEvent.isControlDown(evt) || mxEvent.isMetaDown(evt)) {
                const pt = mxUtils.convertPoint(graph.container, me.getX(), me.getY());
                const target = graph.getCellAt(pt.x, pt.y); // deepest due to our getCellAt override

                if (target && model.isVertex(target)) {
                    if (graph.isCellSelected(target)) {
                        graph.removeSelectionCell(target);
                    } else {
                        graph.addSelectionCell(target);
                    }
                    graph.__ctrlToggleHandled = true;
                    mxEvent.consume(evt);
                    me.consume();
                }
                return;
            }

            // Shift+Click:
            // - If vertex: do NOTHING here → let normal selection occur
            // - If overlay line/label: navigate between endpoints                
            if (mxEvent.isShiftDown(evt)) {
                const cell = me.getCell();

                // If clicking a vertex, let normal multi-select logic handle it
                if (cell && model.isVertex(cell)) {
                    return; // do not consume; selection proceeds            
                }

                // Non-vertex with Shift: nothing special now                
                return;
            }


            // Plain clicks fall through to default selection
        },

        // Hover: optional z-boost for overlay lines/labels (DOM-only)           
        mouseMove(sender, me) {
            const evt = me.getEvent();
            const domTarget = evt.target || evt.srcElement;
            const meta = linkOverlays.getLinkMetaForNode(domTarget);
            if (meta && domTarget && domTarget.parentNode) {
                domTarget.parentNode.appendChild(domTarget);
            }
        },

        mouseUp() {
            graph.__ctrlToggleHandled = false;
        }
    });


    // -------------------- Paste/Add hook: auto-return links on pasted vertices --------------------  
    graph.addListener(mxEvent.CELLS_ADDED, function (sender, evt) {
        const cells = asVertexArray(evt.getProperty('cells'));
        if (!cells || cells.length === 0) return;

        let created = 0;
        const m = graph.getModel();
        m.beginUpdate();
        try {
            for (const v of cells) {
                const ids = Array.from(getLinkSet(v));
                if (ids.length === 0) continue;
                for (const id of ids) {
                    const other = m.getCell(id);
                    if (!other || !m.isVertex(other)) continue;
                    if (addBidirectionalLink(v, other)) {
                        created++;
                        graph.refresh(other);
                    }
                }
                graph.refresh(v);
            }
        } finally {
            m.endUpdate();
        }
        if (created > 0) {
            try { graph.fireEvent(new mxEventObject('linksChanged', 'cells', cells)); } catch (_) { }
            const sel = graph.getSelectionCell();
            if (sel && m.isVertex(sel)) highlightLinked(sel);
        }
    });


    graph.addListener(mxEvent.CELLS_REMOVED, function (sender, evt) {
        const m = M();
        const deletedVerts = asVertexArray(evt.getProperty('cells'));
        if (!deletedVerts || deletedVerts.length === 0) return;

        const deletedIds = new Set(deletedVerts.map(v => v.id));
        const deletedIdArr = Array.from(deletedIds);                         // existing
        let verticesTouched = 0;
        let linksRemoved = 0;

        const impactedIds = [];                                              // collect who changed

        m.beginUpdate();
        try {
            forEachVertex((v) => {
                if (deletedIds.has(v.id)) return;
                const res = removeIdsFromLinkSet(v, deletedIds);
                if (res.changed) {
                    verticesTouched++;
                    linksRemoved += res.removed;
                    impactedIds.push(v.id);                                  // record changed vertex id
                    graph.refresh(v);
                }
            });
        } finally { m.endUpdate(); }

        if (verticesTouched > 0) {
            try {
                graph.fireEvent(new mxEventObject(
                    'linksChanged',
                    'deletedIds', deletedIdArr,
                    'impactedIds', impactedIds,                             // include impacted ids
                    'verticesTouched', verticesTouched,
                    'linksRemoved', linksRemoved
                ));
            } catch (_) { }
            const sel = graph.getSelectionCell();
            if (sel && m.isVertex(sel)) highlightLinked(sel);
        }
    });


    // Selection Highlight Logic
    graph.getSelectionModel().addListener(mxEvent.CHANGE, function () {
        const selected = graph.getSelectionCells();
        if (selected.length !== 1) {
            // clearAllHighlights();  -> one grouped clear step
            highlightLinked(null);
            return;
        }
        const cell = normalizeForLinkingAndPrimary(selected[0]);                                 
        if (cell && model.isVertex(cell)) highlightLinked(cell);                                         
    });


    // -------------------- Context Menu Hook --------------------
    (function installContextMenuExtension() {
        if (graph.__manualLinkerHooked) return;
        graph.__manualLinkerHooked = true;

        function addMenuItems(menu) {
            const verts = asVertexArray(graph.getSelectionCells());
            if (verts.length === 0) return;

            if (verts.length >= 1) {
                menu.addSeparator();

                // --- Primary actions (conditional) --------------------------------------------

                // Counts
                const total = verts.length;                                                      
                const primCount = verts.reduce((n, v) => n + (isPrimary(v) ? 1 : 0), 0);          
                const nonPrimCount = total - primCount;                                          

                menu.addSeparator();                                                          

                // Only primaries -> only "Remove Primary"
                if (primCount === total) {                                                       
                    menu.addItem(`Remove Primary (${total})`, null, function () {                 
                        model.beginUpdate();
                        try {
                            for (const v of verts) setPrimary(v, false);
                        } finally { model.endUpdate(); }
                        console.log(`[Primary] Removed: ${verts.map(v => v.id).join(', ')}`);
                        const sel = graph.getSelectionCell();
                        if (sel && model.isVertex(sel)) highlightLinked(sel);
                    });
                }
                // Only non-primaries -> only "Mark as Primary"
                else if (nonPrimCount === total) {                                               
                    menu.addItem(`Mark as Primary (${total})`, null, function () {                
                        model.beginUpdate();
                        try {
                            for (const v of verts) setPrimary(v, true);
                        } finally { model.endUpdate(); }
                        console.log(`[Primary] Marked: ${verts.map(v => v.id).join(', ')}`);
                        const sel = graph.getSelectionCell();
                        if (sel && model.isVertex(sel)) highlightLinked(sel);
                    });
                }
                // Mixed -> show both
                else {                                                                                 // UNCHANGED
                    menu.addItem(`Mark as Primary (${nonPrimCount})`, null, function () {              
                        model.beginUpdate();
                        try {
                            for (const v of verts) {                                                   
                                if (!isPrimary(v)) setPrimary(v, true);                                
                            }
                        } finally { model.endUpdate(); }
                        console.log(`[Primary] Marked: ${verts.filter(v => !isPrimary(v)).map(v => v.id).join(', ')}`); // OPTIONAL (see note)
                        const sel = graph.getSelectionCell();
                        if (sel && model.isVertex(sel)) highlightLinked(sel);
                    });

                    menu.addItem(`Remove Primary (${primCount})`, null, function () {                  
                        model.beginUpdate();
                        try {
                            for (const v of verts) {                                                   
                                if (isPrimary(v)) setPrimary(v, false);                                
                            }
                        } finally { model.endUpdate(); }
                        console.log(`[Primary] Removed: ${verts.filter(v => isPrimary(v)).map(v => v.id).join(', ')}`); // OPTIONAL (see note)
                        const sel = graph.getSelectionCell();
                        if (sel && model.isVertex(sel)) highlightLinked(sel);
                    });

                    console.log(`[Primary] Mixed selection: primary=${primCount}, nonPrimary=${nonPrimCount}`); // UNCHANGED
                }
            }
            // Single-selection: show Remove Links if the vertex has any links
            if (verts.length === 1) {
                const v = verts[0];
                const linkCount = getLinkSet(v).size;
                if (linkCount > 0) {
                    menu.addItem(`Remove Links (from this vertex)`, null, function () {
                        const res = unlinkAllFor(v);
                        console.log(`[UNLINK one] checked=${res.checked}, removed=${res.removed}`);
                        // Repaint current highlight state
                        if (typeof refreshCurrentHighlight === 'function') refreshCurrentHighlight();
                        else {
                            const sel = graph.getSelectionCell();
                            if (sel && graph.getModel().isVertex(sel)) highlightLinked(sel);
                        }
                    });
                    menu.addSeparator();
                }
            }

            if (verts.length >= 2) {
                const pairs = computeApplicablePairsForLinking(verts);                  
                const totalPairs = pairs.length;                                        
                const linkedPairs = countLinkedPairs(pairs);                            
                const missingPairs = totalPairs - linkedPairs;                          

                // Only linked -> only "Unlink"                                          
                if (linkedPairs === totalPairs && totalPairs > 0) {                     
                    menu.addItem(`Unlink Selected (${linkedPairs})`, null, function () { 
                        const res = unlinkRespectingPrimaries(verts);                   
                        console.log(`[BULK UNLINK] pairs=${res.pairs}, removed=${res.removed}`); 
                        const sel = graph.getSelectionCell();                           
                        if (sel && model.isVertex(sel)) highlightLinked(sel);           
                    });
                }
                // Only missing -> only "Link"                                           
                else if (missingPairs === totalPairs && totalPairs > 0) {               
                    menu.addItem(`Link Selected (respect primaries) (${totalPairs})`, null, function () { 
                        const res = linkRespectingPrimaries(verts);                     // UNCHANGED
                        console.log(`[LINK P↔S] pairs=${res.pairs}, changed=${res.changes}`); // UNCHANGED
                        const sel = graph.getSelectionCell();                           // UNCHANGED
                        if (sel && model.isVertex(sel)) highlightLinked(sel);           // UNCHANGED
                    });
                }
                // Mixed -> show both with counts                                        
                else if (totalPairs > 0) {                                              
                    menu.addItem(`Link Selected (respect primaries) (${missingPairs})`, null, function () { 
                        const res = linkRespectingPrimaries(verts);                     // UNCHANGED
                        console.log(`[LINK P↔S] pairs=${res.pairs}, changed=${res.changes}`); // UNCHANGED
                        const sel = graph.getSelectionCell();                           // UNCHANGED
                        if (sel && model.isVertex(sel)) highlightLinked(sel);           // UNCHANGED
                    });

                    menu.addItem(`Unlink Selected (${linkedPairs})`, null, function () { 
                        const res = unlinkRespectingPrimaries(verts);                   
                        console.log(`[BULK UNLINK] pairs=${res.pairs}, removed=${res.removed}`); 
                        const sel = graph.getSelectionCell();                           
                        if (sel && model.isVertex(sel)) highlightLinked(sel);           
                    });
                }
            }
        }

        let hooked = false;
        try {
            if (ui.menus && typeof ui.menus.get === 'function') {
                const cellMenu = ui.menus.get('cell');
                if (cellMenu && typeof cellMenu.funct === 'function') {
                    const prev = cellMenu.funct;
                    cellMenu.funct = function (menu, cell, evt) {
                        prev.apply(this, arguments);
                        addMenuItems(menu);
                    };
                    hooked = true;
                }
            }
        } catch (_) { }

        if (!hooked) {
            const pmh = graph.popupMenuHandler;
            const oldFactory = pmh ? pmh.factoryMethod : null;
            pmh.factoryMethod = function (menu, cell, evt) {
                if (typeof oldFactory === 'function') oldFactory.apply(this, arguments);
                addMenuItems(menu);
            };
            console.log('[ManualLinker] Hooked popupMenuHandler.factoryMethod (fallback)');
        }
    })();


    // Force selection of deepest visible child under mouse
    (function enforceDirectChildSelection() {
        const graph = ui.editor.graph;

        graph.selectParentAfterCollapse = false;
        graph.cellsSelectable = true;
        graph.keepEdgesInBackground = false;
        graph.cellsLocked = false;

        // --- Step 1: Override hit detection ---
        graph.getCellAt = function (x, y, parent, vertices, edges) {
            // Start from the top-level hit
            const initial = mxGraph.prototype.getCellAt.apply(this, arguments);
            if (!initial) return null;
            if (!this.model.isVertex(initial)) return initial;

            const descendants = [];
            const collect = (c) => {
                const children = this.model.getChildCells(c);
                if (children) {
                    for (const ch of children) {
                        if (this.model.isVertex(ch) && this.isCellVisible(ch)) {
                            descendants.push(ch);
                        }
                        collect(ch);
                    }
                }
            };
            collect(initial);

            // Return the deepest child that contains the point
            for (let i = descendants.length - 1; i >= 0; i--) {
                const d = descendants[i];
                const state = this.view.getState(d);
                if (state && mxUtils.contains(state, x, y)) {
                    return d;
                }
            }
            return initial;
        };

        // --- Step 2: Override handler event logic ---
        const oldGetInitial = mxGraphHandler.prototype.getInitialCellForEvent;
        mxGraphHandler.prototype.getInitialCellForEvent = function (me) {
            // Ask the graph for the deepest cell at the click point
            const graph = this.graph;
            const pt = mxUtils.convertPoint(
                graph.container,
                me.getX(),
                me.getY()
            );
            const cell = graph.getCellAt(pt.x, pt.y);
            // Bypass Draw.io’s parent substitution logic
            return cell;
        };

        // --- Step 3: Improved selection (respects Ctrl/Shift multi-selection) ---
        graph.selectCellForEvent = function (cell, evt) {
            if (!cell) return;

            const isCtrl = mxEvent.isControlDown(evt) || mxEvent.isMetaDown(evt);
            const isShift = mxEvent.isShiftDown(evt);

            // If we already toggled on mouseDown, skip doing anything here
            if (isCtrl && this.__ctrlToggleHandled) {
                this.__ctrlToggleHandled = false; // clear one-shot flag
                return;
            }

            if (isCtrl) {
                // Normal Ctrl toggle (when not handled in mouseDown)
                if (this.isCellSelected(cell)) this.removeSelectionCell(cell);
                else this.addSelectionCell(cell);
                return;
            }

            if (isShift) {
                this.addSelectionCell(cell);
                return;
            }

            // Plain click
            this.setSelectionCell(cell);
        };


        console.log("[ManualLinker] Direct child selection (deepest under mouse) enabled.");
    })();

    // always read the current model inside helpers                    
    function M() { return graph.getModel(); }

    // ---------- Traversal helpers ----------
    function forEachCell(fn) {
        const m = M();
        const stack = [m.getRoot()];
        while (stack.length) {
            const p = stack.pop();
            const n = m.getChildCount(p);
            for (let i = 0; i < n; i++) {
                const c = m.getChildAt(p, i);
                if (!c) continue;
                fn(c, m);
                if (m.getChildCount(c) > 0) stack.push(c);
            }
        }
    }
    function forEachVertex(fn) { forEachCell(c => { if (M().isVertex(c)) fn(c); }); }

    function pruneBrokenLinks(cell) {
        const m = M();
        const ids = Array.from(getLinkSet(cell));
        let checked = 0, removed = 0;
        for (const id of ids) {
            const other = m.getCell(id);
            checked++;
            if (!other || !m.contains(other) || !m.isVertex(other)) {
                if (other && m.isVertex && m.isVertex(other)) {
                    if (removeBidirectionalLink(cell, other)) removed++;
                } else {
                    removeOneWayLink(cell, id);
                    removed++;
                }
            }
        }
        return { checked, removed };
    }

    function pruneOneWayLinks(cell) {
        const m = M();
        const ids = Array.from(getLinkSet(cell));
        let removed = 0;
        for (const id of ids) {
            const other = m.getCell(id);
            if (!other || !m.isVertex(other)) continue;
            const back = getLinkSet(other);
            if (!back.has(cell.id)) { removeOneWayLink(cell, id); removed++; }
        }
        return removed;
    }


    // Keep link overlays attached on zoom/pan and geometry changes                 
    const view = graph.getView();
    if (view && view.addListener) {
        function refreshViewOnlyLinkVisuals() { // CHANGE
            linkOverlays.refreshAll(); // CHANGE
    
            // Draw.io may recreate SVG nodes during zoom/pan, so reapply DOM highlights
            // after the view has finished its redraw cycle. // CHANGE
            setTimeout(function () { // CHANGE
                refreshCurrentHighlight(); // CHANGE
                linkOverlays.refreshAll(); // CHANGE
            }, 0); // CHANGE
        } // CHANGE
    
        view.addListener(mxEvent.SCALE, refreshViewOnlyLinkVisuals); // CHANGE
        view.addListener(mxEvent.TRANSLATE, refreshViewOnlyLinkVisuals); // CHANGE
        view.addListener(mxEvent.SCALE_AND_TRANSLATE, refreshViewOnlyLinkVisuals); // CHANGE
    }

    graph.getModel().addListener(mxEvent.CHANGE, function () {
        // Any geometry change (move/resize) will trigger recompute                
        linkOverlays.refreshAll();
    });


    console.log('[ManualLinker] Plugin loaded.');
});
