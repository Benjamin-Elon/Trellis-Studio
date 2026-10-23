/**
 * Trellis plugin: Manual Vertex Linker with Highlight and Overlay Navigation
 * - Right-click to link/unlink selected vertices
 * - Highlights linked vertices and draws dashed edges
 * - Left-click a visible link or link label to navigate between linked vertices
 */
Draw.loadPlugin(function (ui) {
    const graph = ui.editor.graph;
    let model = graph.getModel();

    const LINK_ATTR = 'linkedTo';
    const TRELLIS_SELECTION_VISUALS_REFRESH_EVENT = 'trellisSelectionVisualsRefresh';
    const HL_TAG_KEY = 'manualLinkHL';
    const HL_OLD_COLOR = 'manualLinkOldColor';
    const HL_OLD_WIDTH = 'manualLinkOldWidth';
    const DEBUG_VERTEX_LINKING_CONSOLE = false;
    const GRAPH_OVERLAY_Z = Object.freeze({ ANNOTATION: 10000, CONNECTION: 10010, CONTROL: 10020, CONTROL_TOP: 10030 });
    const LINK_ENDPOINT_CENTER_OFFSET_PX = 5;
    const LINK_LABEL_STAGGER_PX = 15;
    const ORDINARY_LINK_OVERLAY_COLOR = '#2563eb'; // CHANGE: ordinary connector overlays and vertex highlight outlines use the same neutral blue.
    const STANDARD_LINK_OVERLAY_STROKE_WIDTH = 1.5; // CHANGE: standard connector overlays are half the previous 3px width.
    graph.__ctrlToggleHandled = false;


    // -------------------- Helpers --------------------

    function vertexLinkLog() {
        if (!DEBUG_VERTEX_LINKING_CONSOLE) return;
        try { console.log.apply(console, arguments); } catch (_) { }
    }


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
        model.setValue(cell, obj);
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

    function isKanbanBoard(cell) {
        return !!cell && (getAttr(cell, 'board_key') === 'KANBAN_BOARD');
    }

    function findKanbanBoardAncestor(cell) {
        const m = graph.getModel();
        let cur = cell;
        while (cur) {
            if (isKanbanBoard(cur)) return cur;
            cur = m.getParent(cur);
        }
        return null;
    }


    function isRoadmapObjectCell(cell) { return !!cell && getAttr(cell, 'roadmap_type') === 'object'; } // NEW

    function findRoadmapModuleAncestor(cell) { // NEW
        let cur = cell; // NEW
        while (cur) { // NEW
            if (getAttr(cur, 'roadmap_type') === 'module' || getAttr(cur, 'roadmap_module') === '1') return cur; // NEW
            cur = model.getParent(cur); // NEW
        } // NEW
        return null; // NEW
    } // NEW

    function shouldSuppressStandardRoadmapDependencyOverlay(source, target) { // NEW
        if (!graph.__trellisRoadmapManager || !isRoadmapObjectCell(source) || !isRoadmapObjectCell(target)) return false; // NEW
        const sourceModule = findRoadmapModuleAncestor(source), targetModule = findRoadmapModuleAncestor(target); // NEW
        return !!sourceModule && sourceModule === targetModule && getLinkSet(source).has(target.id) && getLinkSet(target).has(source.id); // NEW
    } // NEW


    function collectSameBoardLinkedKanbanCards(selectedCard, directTargets) {
        if (!isKanbanCard(selectedCard)) return [];

        const board = findKanbanBoardAncestor(selectedCard);
        if (!board) return [];

        const out = [];
        const seen = new Set([selectedCard.id]);

        // Avoid duplicate highlighting for cards already highlighted as direct targets.
        for (const t of directTargets || []) {
            if (t && t.id) seen.add(t.id);
        }

        // A selected task card may link to a shared source, such as a tiler group.
        // Highlight the other task cards linked to that same source, but only inside this board.
        for (const sourceId of getLinkSet(selectedCard)) {
            const source = model.getCell(sourceId);
            if (!source || !model.isVertex(source)) continue;
            if (!isTilerGroup(source)) continue;

            for (const candidateId of getLinkSet(source)) {
                const candidate = model.getCell(candidateId);
                if (!candidate || !model.isVertex(candidate)) continue;
                if (!isKanbanCard(candidate)) continue;
                if (candidate === selectedCard) continue;
                if (findKanbanBoardAncestor(candidate) !== board) continue;
                if (seen.has(candidate.id)) continue;

                seen.add(candidate.id);
                out.push(candidate);
            }
        }

        return out;
    }

    function collectLinkedTaskCardSiblingIdsForTiler(selectedTiler, directTargets) {
        if (!isTilerGroup(selectedTiler)) return new Set();

        const cards = [];
        const seen = new Set();

        for (const target of directTargets || []) {
            if (!target || !target.id || seen.has(target.id)) continue;
            if (!model.isVertex(target)) continue;
            if (!isKanbanCard(target)) continue;
            if (!findKanbanBoardAncestor(target)) continue;

            seen.add(target.id);
            cards.push(target);
        }

        if (cards.length < 2) return new Set();
        return new Set(cards.map(card => card.id));
    }

    function collectLinkedKanbanCardsForSource(source) {
        if (!source || isKanbanCard(source)) return [];

        const out = [];
        const seen = new Set();
        const m = graph.getModel();

        for (const id of getLinkSet(source)) {
            if (!id || seen.has(id)) continue;
            const card = m.getCell(id);
            if (!card || !m.isVertex(card)) continue;
            if (!isKanbanCard(card)) continue;
            if (!findKanbanBoardAncestor(card)) continue;

            seen.add(card.id);
            out.push(card);
        }

        out.sort(compareTaskCardsByStartDate);
        return out;
    }

    function compareTaskCardsByStartDate(a, b) {
        const aRange = getTaskDateRange(a);
        const bRange = getTaskDateRange(b);
        const aHasDate = !!aRange;
        const bHasDate = !!bRange;

        if (aHasDate !== bHasDate) return aHasDate ? -1 : 1;
        if (aHasDate && bHasDate && aRange.startDay !== bRange.startDay) return aRange.startDay - bRange.startDay;

        const aLabel = (getRawTextLabel(a) || getAttr(a, 'title') || a.id || '').toLowerCase();
        const bLabel = (getRawTextLabel(b) || getAttr(b, 'title') || b.id || '').toLowerCase();
        if (aLabel < bLabel) return -1;
        if (aLabel > bLabel) return 1;

        return String(a.id || '').localeCompare(String(b.id || ''));
    }

    function parseTaskOverlayDate(raw) {
        if (!raw) return null;
        const match = String(raw).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (!match) return null;
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
        const utc = Date.UTC(year, month - 1, day);
        const date = new Date(utc);
        if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
        return {
            iso: match[0],
            date,
            dayNumber: Math.floor(utc / 86400000)
        };
    }

    function getTaskDateRange(card) {
        const start = parseTaskOverlayDate(getAttr(card, 'start'));
        if (!start) return null;
        const rawEnd = getAttr(card, 'end');
        const end = rawEnd ? parseTaskOverlayDate(rawEnd) : start;
        if (!end || end.dayNumber < start.dayNumber) return null;
        return {
            start,
            end,
            startDay: start.dayNumber,
            endDay: end.dayNumber,
            durationDays: end.dayNumber - start.dayNumber + 1
        };
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
            vertexLinkLog('[ManualLinker] getLaneColorForCard: no lane for card',
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

        vertexLinkLog('[ManualLinker] getLaneColorForCard', {
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
        vertexLinkLog('[ManualLinker] getLinkLaneColor', {
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

    function sideLengthForAnchor(center, side) {
        if (!center) return 0;
        return (side === 'left' || side === 'right') ? center.h : center.w;
    }

    function avoidStandardLinkEndpointCenterT(center, side, t, marginPx) {
        const sideLenPx = sideLengthForAnchor(center, side);
        const baseT = Math.max(0, Math.min(1, t == null ? 0.5 : t));
        if (!Number.isFinite(sideLenPx) || sideLenPx <= 0) return baseT;
        const marginT = Math.min(Math.max(0, marginPx || 0) / sideLenPx, 0.49);
        const minT = marginT;
        const maxT = 1 - marginT;
        const clampedT = Math.max(minT, Math.min(maxT, baseT));
        if (Math.abs(clampedT - 0.5) > 0.0001) return clampedT;
        const offsetT = Math.max(0, LINK_ENDPOINT_CENTER_OFFSET_PX) / sideLenPx;
        return Math.max(minT, Math.min(maxT, 0.5 + offsetT));
    }

    function anchorStandardLinkEndpointOnSide(center, side, t, marginPx) {
        return anchorOnSide(center, side, avoidStandardLinkEndpointCenterT(center, side, t, marginPx));
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
            vertexLinkLog('[LaneStatus] from lane_key', { cardId: card.id, laneId: lane && lane.id, laneRaw, key });
            return key || null;
        }

        const statusRaw = getAttr(card, 'status');
        const mapped = mapStatusToKey(statusRaw);
        vertexLinkLog('[LaneStatus] from status', { cardId: card.id, statusRaw, mapped });
        return mapped;
    }


    function isTilerGroup(cell) {
        return !!cell && getAttr(cell, 'tiler_group') === '1';
    }

    function isRoleCard(cell) {
        const style = cell && cell.style != null ? String(cell.style) : '';
        return /(?:^|;)role_card=1(?:;|$)/.test(style);
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
    function shouldShowEdgeInternal(source, target, repeatLinkVisibility) { // CHANGE: one precomputed selection per linked board/series
        const clusters = graph.__trellisModules?.clusters; // NEW
        if (clusters && (!clusters.isRendered(source) || !clusters.isRendered(target) || !graph.view.getState(source) || !graph.view.getState(target))) return false; // NEW: overlay endpoints must both have rendered states in the current city/neighborhood.

        const sid = source ? source.id : null;
        const tid = target ? target.id : null;

        const sourceIsTiler = isTilerGroup(source);
        const targetIsTask = isKanbanCard(target);

        vertexLinkLog("[EdgePolicy] ENTER", {
            sourceId: sid,
            targetId: tid,
            sourceIsTiler,
            targetIsTask
        });

        // For anything other than tiler-group → task-card, always show edge:
        if (!sourceIsTiler || !targetIsTask) {
            vertexLinkLog("[EdgePolicy] NOT tiler→task → SHOW");
            return true;
        }

        if (getAttr(target, 'year_hidden') === '1') return false; // NEW: respect each board's displayed year
        if (repeatLinkVisibility && repeatLinkVisibility.has(String(target.id))) { // NEW
            return repeatLinkVisibility.get(String(target.id)); // NEW: chosen repeats bypass the per-column policy
        } // NEW
        if (getAttr(target, 'repeat_hidden') === '1') return false; // NEW: safe fallback before Task Manager initializes

        // Status is defined by the TARGET task (its lane/status), not the tiler.
        const key = getLaneStatusKeyForTask(target);

        vertexLinkLog("[EdgePolicy] laneKey", {
            taskId: tid,
            laneKey: key,
            rawStatus: getAttr(target, 'status'),
            laneAncestor: (function () {
                const lane = findLaneAncestor(target);
                return lane ? { id: lane.id, lane_key: getAttr(lane, 'lane_key') } : null;
            })()
        });

        if (!key) {
            vertexLinkLog("[EdgePolicy] NO LANE KEY → SHOW");
            return true;
        }

        // ACTIVE lanes: always show edges to tasks in active lanes
        if (ACTIVE_LANES.has(key)) {
            vertexLinkLog("[EdgePolicy] ACTIVE lane → SHOW");
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

        vertexLinkLog("[EdgePolicy] BEST per lane", {
            laneKey: key,
            bestUpcomingId: bestUpcomingEntry ? bestUpcomingEntry.cell.id : null,
            bestDoneId: bestDoneEntry ? bestDoneEntry.cell.id : null
        });

        // UPCOMING lanes: only show edge to the chosen upcoming card for this lane 
        if (UPCOMING_LANES.has(key)) {
            const show = !!bestUpcomingEntry && bestUpcomingEntry.cell === target;
            vertexLinkLog("[EdgePolicy] UPCOMING lane →", show ? "SHOW" : "HIDE");
            return show;
        }

        // DONE / ARCHIVED lanes: only show edge to the chosen done card for this lane 
        if (DONE_LANES.has(key)) {
            const show = !!bestDoneEntry && bestDoneEntry.cell === target;
            vertexLinkLog("[EdgePolicy] DONE lane →", show ? "SHOW" : "HIDE");
            return show;
        }

        // Fallback: hide
        vertexLinkLog("[EdgePolicy] FALLBACK → HIDE");
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

        function formatLinkOverlayBadgeLabel(label) {
            const text = stripHtmlAndPlaceholders(String(label || '')).trim();
            return text.length > 40 ? text.slice(0, 37) + '...' : text;
        }

        function applyLinkOverlayBadgeStyle(txt, stroke) {
            if (!txt) return;
            txt.size = 10;
            txt.fontStyle = mxConstants.FONT_BOLD;
            txt.color = '#3c4043';
            txt.background = '#ffffff';
            txt.border = stroke || '#9aa0a6';
            txt.spacing = 6;
            txt.spacingTop = 2;
            txt.spacingRight = 6;
            txt.spacingBottom = 2;
            txt.spacingLeft = 6;
            if (txt.node && txt.node.style) {
                txt.node.style.borderRadius = '10px';
                txt.node.style.filter = 'drop-shadow(0 1px 2px rgba(0, 0, 0, 0.16))';
            }
        }

        function normalizeLabelOffset(offset) {
            const x = offset && Number.isFinite(offset.x) ? offset.x : 0;
            const y = offset && Number.isFinite(offset.y) ? offset.y : 0;
            return { x, y };
        }

        // Compute line endpoints from current cell geometry + exitHint                    
        function computePointsFor(entry) {
            const m = model;
            const a = m.getCell(entry.srcId);
            const b = m.getCell(entry.trgId);
            if (!a || !b) return null;
            const clusters = graph.__trellisModules?.clusters; // NEW
            if (clusters && (!clusters.isRendered(a) || !clusters.isRendered(b) || !graph.view.getState(a) || !graph.view.getState(b))) return null; // NEW

            const srcC = getCellCenter(a);
            const dstC = getCellCenter(b);
            if (!srcC || !dstC) return null;

            let srcPt = null;
            const hint = entry.exitHint;
            if (hint && hint.side) {
                srcPt = anchorStandardLinkEndpointOnSide(srcC, hint.side, hint.t, 4);
            }
            if (!srcPt) {
                srcPt = { x: srcC.x, y: srcC.y };
            }

            const trgSide = sideToward(dstC, srcC);
            const trgPt = anchorStandardLinkEndpointOnSide(dstC, trgSide, 0.5, 4);
            if (!trgPt) return null;

            return [
                new mxPoint(srcPt.x, srcPt.y),
                new mxPoint(trgPt.x, trgPt.y)
            ];
        }

        // Create or update text label near the source side
        function createOrUpdateLabel(entry, pts) {
            const pane = getOverlayPane();
            const label = formatLinkOverlayBadgeLabel(entry.label);
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
            const labelOffset = normalizeLabelOffset(entry.labelOffset);
            const labelX = lx + labelOffset.x;
            const labelY = ly + labelOffset.y;

            if (!isFinite(labelX) || !isFinite(labelY)) {
                return;
            }

            if (entry.labelElt && entry.labelElt.node &&
                entry.labelElt.node.parentNode === pane) {
                // Update existing mxText
                entry.labelElt.value = label;
                entry.labelElt.bounds.x = labelX;
                entry.labelElt.bounds.y = labelY;
                applyLinkOverlayBadgeStyle(entry.labelElt, entry.color);
                entry.labelElt.redraw();
            } else {
                // Remove old, if any
                if (entry.labelElt && entry.labelElt.node && entry.labelElt.node.parentNode) {
                    entry.labelElt.node.parentNode.removeChild(entry.labelElt.node);
                }

                // --- CREATE NEW LABEL -------------------------------------------------------
                const bounds = new mxRectangle(labelX, labelY, 1, 1);

                const txt = new mxText(
                    label,
                    bounds,
                    mxConstants.ALIGN_LEFT,
                    mxConstants.ALIGN_MIDDLE,
                    '#3c4043',
                    'Arial, Helvetica, sans-serif',
                    10,
                    mxConstants.FONT_BOLD,
                    6,
                    2,
                    6,
                    2,
                    6,
                    true,
                    '#ffffff',
                    entry.color || '#9aa0a6'
                );
                applyLinkOverlayBadgeStyle(txt, entry.color);
                txt.dialect = graph.dialect;
                txt.init(pane);
                graph.__trellisOverlayVisibility?.mark(txt.node); // NEW: informational overlays must not obstruct manipulation.
                txt.redraw();
                applyLinkOverlayBadgeStyle(txt, entry.color);

                if (txt.node) {
                    txt.node.__manualLinkMeta = {
                        srcId: entry.srcId,
                        trgId: entry.trgId
                    };
                    txt.node.style.pointerEvents = 'all';                        // ensure click
                    mxEvent.addListener(txt.node, 'mousedown', function (evt) {
                        const isLeft = (evt.button === 0);

                        if (isLeft) {
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

            const stroke = entry.color || ORDINARY_LINK_OVERLAY_COLOR; // CHANGE: fallback connector color follows ordinary-link blue.

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

                const poly = new mxPolyline(pts, stroke, STANDARD_LINK_OVERLAY_STROKE_WIDTH); // CHANGE: halve ordinary standard connector width.
                poly.dialect = graph.dialect;
                poly.init(pane);
                graph.__trellisOverlayVisibility?.mark(poly.node); // NEW: informational overlays must not obstruct manipulation.
                poly.redraw();

                if (poly.node) {
                    poly.node.__manualLinkMeta = {
                        srcId: entry.srcId,
                        trgId: entry.trgId
                    };
                    poly.node.style.pointerEvents = 'stroke';                     // ensure hit
                    mxEvent.addListener(poly.node, 'mousedown', function (evt) {
                        const isLeft = (evt.button === 0);

                        if (isLeft) {
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
         * - labelOffset: {x, y} screen-space stagger in pixels
         */
        function setLinkOverlay(a, b, exitHint, color, label, labelOffset) {
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
                    color: color || ORDINARY_LINK_OVERLAY_COLOR, // CHANGE: unlabeled/default overlays use ordinary-link blue.
                    label: label || '',
                    labelOffset: normalizeLabelOffset(labelOffset),
                    poly: null,
                    labelElt: null
                };
                registry.set(key, entry);
            } else {
                entry.exitHint = exitHint || null;
                entry.color = color || ORDINARY_LINK_OVERLAY_COLOR; // CHANGE: keep refreshed fallback overlays blue.
                entry.label = label || '';
                entry.labelOffset = normalizeLabelOffset(labelOffset);
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

        function getLinkMetaForNode(node) {
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

    // CHANGE: Cards, Schedule, Spacing and planting previews are owned by Planting_Group.js.


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

    function dispatchYearFilterChangedForTaskOverlay(card, year) {
        try {
            window.dispatchEvent(new CustomEvent('yearFilterChanged', {
                detail: { moduleCellId: null, taskCardId: card && card.id || null, year: year == null ? null : year }
            }));
        } catch (_) { }
    }

    function revealKanbanCardForNavigation(card) {
        if (!isKanbanCard(card)) return;
        if (getAttr(card, 'year_hidden') === '1') return; // CHANGE: hidden repeats can be revealed using Task Manager commands
        const taskManager = graph.__trellisTaskManager; // NEW: resolve after both plugins have initialized
        if (taskManager && typeof taskManager.revealLinkedTaskOccurrence === 'function' && taskManager.revealLinkedTaskOccurrence(card)) { // NEW
            dispatchYearFilterChangedForTaskOverlay(card, null); // NEW
            return; // NEW
        } // NEW
        if (getAttr(card, 'repeat_hidden') === '1') return; // NEW: keep hidden repeats intact when Task Manager is unavailable
        if (!model.isVisible || model.isVisible(card)) return;
        const pagingApi = graph.__trellisTaskPagingApi;
        if (pagingApi && typeof pagingApi.revealCard === 'function' && pagingApi.revealCard(card)) { dispatchYearFilterChangedForTaskOverlay(card, null); return; }
        dispatchYearFilterChangedForTaskOverlay(card, null);
    }


    // Works for arbitrarily nested children
    function selectAndReveal(cell) {
        if (!cell) return;
        graph.__trellisModules?.clusters?.revealCell(cell); // NEW: resolve city and rendering membership before expanding or scrolling.
        const m = graph.getModel();

        revealKanbanCardForNavigation(cell);

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


    function refreshAfterLinkNavigation() {
        setTimeout(function () {
            refreshCurrentHighlight();

        }, 0);
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
            refreshAfterLinkNavigation();
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

    function historyCellIds(cells) {
        return (cells || []).map(cell => cell && (cell.id || (cell.getId && cell.getId()))).filter(Boolean).map(String);
    }

    function runTrellisHistoryTransaction(metadata, operation) {
        const history = typeof window !== "undefined" && window.Trellis && window.Trellis.history;
        if (history && typeof history.run === "function" && !(typeof history.isRestoring === "function" && history.isRestoring())) {
            return history.run(metadata, operation);
        }
        return operation();
    }

    function unlinkRespectingPrimaries(verts) {
        return runTrellisHistoryTransaction({ category: "Data", action: "unlinkVertices", origin: "Vertex_Linking_Standalone", title: "Remove vertex links", affectedCellIds: historyCellIds(verts), tags: ["Links"] }, function () {
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
        });
    }


    // Link respecting primaries:
    // If any primaries, link every Primary ↔ every Secondary only.
    // If no primaries, link all pairs (existing behavior).
    function linkRespectingPrimaries(verts) {
        return runTrellisHistoryTransaction({ category: "Data", action: "linkVertices", origin: "Vertex_Linking_Standalone", title: "Create vertex links", affectedCellIds: historyCellIds(verts), tags: ["Links"] }, function () {
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
        });
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
        return runTrellisHistoryTransaction({ category: "Data", action: "unlinkAllVertices", origin: "Vertex_Linking_Standalone", title: "Remove all vertex links", affectedCellIds: historyCellIds([cell]), tags: ["Links"] }, function () {
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
        });
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


    function highlight(cell, color, widthPx) {
        domHighlightVertex(cell, color, widthPx);
    }


    // DOM-based vertex highlighting (no model/undo impact)                    
    function domHighlightVertex(cell, color, widthPx) {
        if (!cell || !cell.id) return;
        const st = graph.getView().getState(cell);
        if (!st || !st.shape || !st.shape.node) return;

        const root = st.shape.node;
        let target = root.querySelector('path, rect');
        if (!target) target = root;

        if (!highlightDomCache.has(cell.id)) {
            highlightDomCache.set(cell.id, {
                stroke: target.style.stroke || '',
                strokeWidth: target.style.strokeWidth || ''
            });
        }

        target.style.stroke = color || ORDINARY_LINK_OVERLAY_COLOR; // CHANGE: fallback vertex outlines match ordinary link blue.
        target.style.strokeWidth = (widthPx || 3) + 'px';
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


    function selectedLinkableVertices() {
        return asVertexArray(graph.getSelectionCells && graph.getSelectionCells());
    }

    let highlightRefreshPending = false; // NEW: coalesce model/year changes after board reflow
    let refreshingCurrentHighlight = false; // NEW: highlight cleanup may itself emit a model change

    /** Rebuilds connector membership once after the current model changes settle. */ // NEW
    function requestCurrentHighlightRefresh() { // NEW
        if (highlightRefreshPending || refreshingCurrentHighlight) return; // NEW
        highlightRefreshPending = true; // NEW
        setTimeout(function () { // NEW
            highlightRefreshPending = false; // NEW
            refreshCurrentHighlight(); // NEW
        }, 0); // NEW
    } // NEW

    function refreshCurrentHighlight() { // CHANGE: prevent recursive refreshes from link cleanup
        if (refreshingCurrentHighlight) return; // NEW
        refreshingCurrentHighlight = true; // NEW
        try { // NEW
            const selected = selectedLinkableVertices(); // CHANGE

            if (!selected || selected.length === 0) { // CHANGE
                highlightLinked(null); // CHANGE
                return; // CHANGE
            } // CHANGE

            if (selected.length === 1) { // CHANGE
                const cell = selected[0]; // CHANGE
                if (cell && model.isVertex(cell)) highlightLinked(cell); // CHANGE
                else highlightLinked(null); // CHANGE
                return; // CHANGE
            } // CHANGE

            if (selected.every(isRoleCard)) { // CHANGE
                highlightLinkedRoleCards(selected); // CHANGE
            } else { // CHANGE
                highlightLinked(null); // CHANGE
            } // CHANGE
        } finally { refreshingCurrentHighlight = false; } // NEW
    }

    function assignStandardLinkLabelOffsets(records) {
        const groups = { left: [], right: [], top: [], bottom: [] };
        for (const record of records || []) {
            record.labelOffset = { x: 0, y: 0 };
            const side = record.exitHint && record.exitHint.side;
            if (groups[side]) groups[side].push(record);
        }

        for (const side of ['left', 'right', 'top', 'bottom']) {
            groups[side].sort((a, b) => {
                const at = a.exitHint && Number.isFinite(a.exitHint.t) ? a.exitHint.t : 0;
                const bt = b.exitHint && Number.isFinite(b.exitHint.t) ? b.exitHint.t : 0;
                return at - bt;
            });
            for (let i = 0; i < groups[side].length; i++) {
                const offsetPx = i * LINK_LABEL_STAGGER_PX;
                groups[side][i].labelOffset = (side === 'left' || side === 'right')
                    ? { x: 0, y: offsetPx }
                    : { x: offsetPx, y: 0 };
            }
        }
    }

    // Config: whether a Primary vertex should be highlighted even without links
    const ALLOW_PRIMARY_WHEN_UNLINKED = true; // set to false to require links

    function highlightLinkedRoleCards(cells) {
        const YELLOW = '#ffd400';
        const selectedRoleCards = (cells || []).filter(cell => cell && model.isVertex(cell) && isRoleCard(cell));

        model.beginUpdate();
        try {
            clearAllHighlights();
            if (selectedRoleCards.length === 0) return;

            const visibleLinkOverlayRecords = [];
            for (const cell of selectedRoleCards) {
                pruneBrokenLinks(cell);
                const linkedIds = getLinkSet(cell);
                const selIsPrimary = isPrimary(cell);
                highlight(cell, selIsPrimary ? YELLOW : ORDINARY_LINK_OVERLAY_COLOR); // CHANGE: ordinary role-card outlines match ordinary link blue.
                if (linkedIds.size === 0) continue;

                const targets = [];
                for (const id of linkedIds) {
                    const other = model.getCell(id);
                    if (other && model.isVertex(other)) targets.push(other);
                }

                const exitMap = computeExitParamsForOrigin(cell, targets);
                for (const other of targets) {
                    const otherIsPrimary = isPrimary(other);
                    highlight(other, otherIsPrimary ? YELLOW : ORDINARY_LINK_OVERLAY_COLOR); // CHANGE: ordinary linked role-card outlines match ordinary link blue.
                    const laneColor = getLinkLaneColor(cell, other);
                    const edgeColor = laneColor ? laneColor : ((selIsPrimary || otherIsPrimary) ? YELLOW : ORDINARY_LINK_OVERLAY_COLOR); // CHANGE: only connector overlays use blue for ordinary links.
                    const label = getRawTextLabel ? getRawTextLabel(other) : '';
                    const exitHint = exitMap.get(other.id);
                    if (shouldShowEdgeInternal(cell, other) && !shouldSuppressStandardRoadmapDependencyOverlay(cell, other)) { // CHANGE
                        visibleLinkOverlayRecords.push({ source: cell, other, exitHint, edgeColor, label, labelOffset: { x: 0, y: 0 } });
                    }
                }
            }

            assignStandardLinkLabelOffsets(visibleLinkOverlayRecords);
            for (const record of visibleLinkOverlayRecords) {
                linkOverlays.setLinkOverlay(record.source, record.other, record.exitHint, record.edgeColor, record.label, record.labelOffset);
            }
        } finally {
            model.endUpdate();
        }
    }

    function highlightLinked(cell) {
        const YELLOW = '#ffd400';
        const SAME_CROP_HIGHLIGHT = '#2563eb';

        model.beginUpdate();
        try {
            clearAllHighlights();
            if (!cell) return;

            const pruned = pruneBrokenLinks(cell);

            let linkedIds = getLinkSet(cell);
            const selIsPrimary = isPrimary(cell);
            const hasLinks = linkedIds.size > 0;
            const selectedIsTilerGroup = isTilerGroup(cell);

            if (!hasLinks && selectedIsTilerGroup) {
                highlight(cell, selIsPrimary ? YELLOW : ORDINARY_LINK_OVERLAY_COLOR); // CHANGE: ordinary selected tiler outlines match ordinary link blue.

                return;
            }

            if (!hasLinks && !(ALLOW_PRIMARY_WHEN_UNLINKED && selIsPrimary)) {
                return;
            }

            highlight(cell, selIsPrimary ? YELLOW : ORDINARY_LINK_OVERLAY_COLOR); // CHANGE: ordinary selected outlines match ordinary link blue.

            if (!hasLinks) return;

            const targets = [];
            for (const id of linkedIds) {
                const other = model.getCell(id);
                if (other && model.isVertex(other))
                    targets.push(other);
            }

            const sameBoardLinkedCards = collectSameBoardLinkedKanbanCards(cell, targets);
            const selectedTilerTaskSiblingIds = collectLinkedTaskCardSiblingIdsForTiler(cell, targets);
            const taskManager = graph.__trellisTaskManager; // NEW: linking and task plugins may initialize in either order
            const repeatLinkVisibility = selectedIsTilerGroup && taskManager && typeof taskManager.getRepeatLinkVisibility === 'function' // NEW
                ? taskManager.getRepeatLinkVisibility(targets) : null; // NEW
            const connectorTargets = targets.filter(other => shouldShowEdgeInternal(cell, other, repeatLinkVisibility) && !shouldSuppressStandardRoadmapDependencyOverlay(cell, other)); // NEW
            const exitMap = computeExitParamsForOrigin(cell, connectorTargets); // CHANGE: hidden occurrences cannot distort visible endpoint spacing
            const visibleLinkOverlayRecords = [];

            for (const other of targets) {
                const otherIsPrimary = isPrimary(other);
                const linkedTargetHighlight = selectedTilerTaskSiblingIds.has(other.id) ? SAME_CROP_HIGHLIGHT : ORDINARY_LINK_OVERLAY_COLOR; // CHANGE: ordinary target outlines match ordinary link blue.
                highlight(other, otherIsPrimary ? YELLOW : linkedTargetHighlight);

                // If link touches a Kanban task card, edge color = lane fillColor  
                const laneColor = getLinkLaneColor(cell, other);
                const edgeColor = laneColor
                    ? laneColor
                    : ((selIsPrimary || otherIsPrimary) ? YELLOW : ORDINARY_LINK_OVERLAY_COLOR);

                const label = getRawTextLabel ? getRawTextLabel(other) : '';
                const exitHint = exitMap.get(other.id);

                // Decide visibility using internal lane-based policy               
                const shouldShow = shouldShowEdgeInternal(cell, other, repeatLinkVisibility); // CHANGE: use the same series choice for geometry and drawing
                if (shouldShow && !shouldSuppressStandardRoadmapDependencyOverlay(cell, other)) { // CHANGE
                    visibleLinkOverlayRecords.push({ other, exitHint, edgeColor, label, labelOffset: { x: 0, y: 0 } });
                }
            }

            assignStandardLinkLabelOffsets(visibleLinkOverlayRecords);
            for (const record of visibleLinkOverlayRecords) {
                linkOverlays.setLinkOverlay(
                    cell, record.other, record.exitHint, record.edgeColor, record.label, record.labelOffset
                );
            }

            for (const otherCard of sameBoardLinkedCards) {
                const otherIsPrimary = isPrimary(otherCard);
                highlight(otherCard, otherIsPrimary ? YELLOW : SAME_CROP_HIGHLIGHT, 1.5);
            }


        } finally {
            model.endUpdate();
        }
    }

    // -------------------- Ctrl Click Handling --------------------
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


    // -------------------- Paste hook: cursor-anchored parenting --------------------
    const PASTE_PARENT_POINTER_TOLERANCE_PX = 8; // NEW: repeated keyboard paste keeps the original parent through minor pointer jitter.
    let lastPasteParentPointerPoint = null; // NEW
    let pasteParentAnchor = null; // NEW

    function finitePasteParentNumber(value, fallback) { // NEW
        const n = Number(value); // NEW
        return Number.isFinite(n) ? n : fallback; // NEW
    } // NEW

    function eventClientPoint(evt) { // NEW
        if (!evt) return null; // NEW
        const x = finitePasteParentNumber(evt.clientX, NaN); // NEW
        const y = finitePasteParentNumber(evt.clientY, NaN); // NEW
        return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null; // NEW
    } // NEW

    function graphPointFromClientPoint(point) { // NEW
        if (!point || !graph.container || !mxUtils || !mxUtils.convertPoint) return null; // NEW
        const converted = mxUtils.convertPoint(graph.container, point.x, point.y); // NEW
        return converted ? { x: finitePasteParentNumber(converted.x, 0), y: finitePasteParentNumber(converted.y, 0) } : null; // NEW
    } // NEW

    function rememberPasteParentPointerPoint(evt) { // NEW
        const client = eventClientPoint(evt); // NEW
        const graphPt = graphPointFromClientPoint(client); // NEW
        if (client && graphPt) lastPasteParentPointerPoint = { x: graphPt.x, y: graphPt.y, clientX: client.x, clientY: client.y }; // NEW
    } // NEW

    function addPasteParentPointerListener(name) { // NEW
        if (!graph.container) return; // NEW
        if (mxEvent && typeof mxEvent.addListener === 'function') mxEvent.addListener(graph.container, name, rememberPasteParentPointerPoint); // NEW
        else if (graph.container.addEventListener) graph.container.addEventListener(name, rememberPasteParentPointerPoint, true); // NEW
    } // NEW

    addPasteParentPointerListener('pointermove'); // NEW
    addPasteParentPointerListener('mousemove'); // NEW
    addPasteParentPointerListener('mousedown'); // NEW

    function pasteParentPointFromExplicitPoint(pt) { // NEW
        if (!pt) return null; // NEW
        const x = finitePasteParentNumber(pt.x, NaN); // NEW
        const y = finitePasteParentNumber(pt.y, NaN); // NEW
        return Number.isFinite(x) && Number.isFinite(y) ? { x, y, clientX: null, clientY: null, explicit: true } : null; // NEW
    } // NEW

    function pasteParentAnchorPoint(pt, evt) { // NEW
        const explicit = pasteParentPointFromExplicitPoint(pt); // NEW
        if (explicit) return explicit; // NEW
        const client = eventClientPoint(evt); // NEW
        const graphPt = graphPointFromClientPoint(client); // NEW
        if (client && graphPt) return { x: graphPt.x, y: graphPt.y, clientX: client.x, clientY: client.y, explicit: false }; // NEW
        return lastPasteParentPointerPoint ? Object.assign({ explicit: false }, lastPasteParentPointerPoint) : null; // NEW
    } // NEW

    function pasteParentPointsNear(a, b) { // NEW
        if (!a || !b) return false; // NEW
        const useClient = Number.isFinite(Number(a.clientX)) && Number.isFinite(Number(a.clientY)) && Number.isFinite(Number(b.clientX)) && Number.isFinite(Number(b.clientY)); // NEW
        const ax = useClient ? a.clientX : a.x; // NEW
        const ay = useClient ? a.clientY : a.y; // NEW
        const bx = useClient ? b.clientX : b.x; // NEW
        const by = useClient ? b.clientY : b.y; // NEW
        return Math.max(Math.abs(ax - bx), Math.abs(ay - by)) <= PASTE_PARENT_POINTER_TOLERANCE_PX; // NEW
    } // NEW

    function isDiagramCellPasteXml(ctx, xml, compat) { // NEW
        if (compat) return true; // NEW
        return !!(ctx && typeof ctx.isCompatibleString === 'function' && ctx.isCompatibleString(xml)); // NEW
    } // NEW

    function cellAtPasteParentPoint(point) { // NEW
        if (!point || !graph.getCellAt) return null; // NEW
        try { return graph.getCellAt(point.x, point.y) || null; } catch (_) { return null; } // NEW
    } // NEW

    function modelContainsPasteParentCell(cell) { // NEW
        const m = graph.getModel(); // NEW
        if (!cell || !m) return false; // NEW
        if (typeof m.contains === 'function') return !!m.contains(cell); // NEW
        const root = m.getRoot && m.getRoot(); // NEW
        let cur = cell; // NEW
        while (cur) { // NEW
            if (cur === root) return true; // NEW
            cur = m.getParent ? m.getParent(cur) : cur.parent; // NEW
        } // NEW
        return !root; // NEW
    } // NEW

    function pasteParentCellId(cell) { // NEW
        return cell && (cell.id || (cell.getId && cell.getId())) || null; // NEW
    } // NEW

    function pasteParentSetContainsAncestor(cell, cellSet) { // NEW
        const m = graph.getModel(); // NEW
        let cur = cell ? (m.getParent ? m.getParent(cell) : cell.parent) : null; // NEW
        while (cur) { // NEW
            if (cellSet.has(cur)) return true; // NEW
            cur = m.getParent ? m.getParent(cur) : cur.parent; // NEW
        } // NEW
        return false; // NEW
    } // NEW

    function pasteParentTerminal(edge, source) { // NEW
        const m = graph.getModel(); // NEW
        if (m && typeof m.getTerminal === 'function') return m.getTerminal(edge, source); // NEW
        return edge ? (source ? edge.source : edge.target) : null; // NEW
    } // NEW

    function pasteParentEndpointInBatch(endpoint, batchSet) { // NEW
        if (!endpoint) return false; // NEW
        if (batchSet.has(endpoint)) return true; // NEW
        const m = graph.getModel(); // NEW
        let cur = m && m.getParent ? m.getParent(endpoint) : endpoint.parent; // NEW
        while (cur) { // NEW
            if (batchSet.has(cur)) return true; // NEW
            cur = m && m.getParent ? m.getParent(cur) : cur.parent; // NEW
        } // NEW
        return false; // NEW
    } // NEW

    function topLevelPasteParentRoots(cells) { // NEW
        const m = graph.getModel(); // NEW
        const list = Array.isArray(cells) ? cells.filter(Boolean) : []; // NEW
        const batchSet = new Set(list); // NEW
        const out = []; // NEW
        const seen = new Set(); // NEW
        for (const cell of list) { // NEW
            if (!cell || pasteParentSetContainsAncestor(cell, batchSet)) continue; // NEW
            const id = pasteParentCellId(cell) || String(out.length); // NEW
            if (seen.has(id)) continue; // NEW
            if (m && m.isEdge && m.isEdge(cell)) { // NEW
                const source = pasteParentTerminal(cell, true); // NEW
                const target = pasteParentTerminal(cell, false); // NEW
                if (!pasteParentEndpointInBatch(source, batchSet) || !pasteParentEndpointInBatch(target, batchSet)) continue; // NEW
            } // NEW
            seen.add(id); // NEW
            out.push(cell); // NEW
        } // NEW
        return out; // NEW
    } // NEW

    function isPasteParentCandidateValid(candidate, roots, evt) { // NEW
        const m = graph.getModel(); // NEW
        if (!candidate || !roots || !roots.length || !modelContainsPasteParentCell(candidate)) return false; // NEW
        if (m && typeof m.isVertex === 'function' && !m.isVertex(candidate)) return false; // NEW
        if (graph.isCellVisible && !graph.isCellVisible(candidate)) return false; // NEW
        if (graph.isCellLocked && graph.isCellLocked(candidate)) return false; // NEW
        if (roots.indexOf(candidate) >= 0) return false; // NEW
        const rootSet = new Set(roots); // NEW
        if (pasteParentSetContainsAncestor(candidate, rootSet)) return false; // NEW
        if (graph.isValidDropTarget) { // NEW
            try { if (!graph.isValidDropTarget(candidate, roots, evt)) return false; } catch (_) { return false; } // NEW
        } // NEW
        return true; // NEW
    } // NEW

    function resolvePasteParentFromHit(hit, roots, evt) { // NEW
        const m = graph.getModel(); // NEW
        let cur = hit; // NEW
        while (cur) { // NEW
            if (isPasteParentCandidateValid(cur, roots, evt)) return cur; // NEW
            cur = m && m.getParent ? m.getParent(cur) : cur.parent; // NEW
        } // NEW
        return null; // NEW
    } // NEW

    function getPasteParentStyle(cell) { // NEW
        return (cell && typeof cell.getStyle === 'function' ? cell.getStyle() : cell && cell.style) || ''; // NEW
    } // NEW

    function isPasteParentSwimlane(cell) { // NEW
        if (graph.isSwimlane) { try { if (graph.isSwimlane(cell)) return true; } catch (_) { } } // NEW
        return /(?:^|;)swimlane(?:;|$)|(?:^|;)shape=swimlane(?:;|$)/.test(String(getPasteParentStyle(cell))); // NEW
    } // NEW

    function pasteParentStartSize(cell) { // NEW
        if (graph.getStartSize) { // NEW
            try { return graph.getStartSize(cell) || { width: 0, height: 0 }; } catch (_) { } // NEW
        } // NEW
        const match = String(getPasteParentStyle(cell)).match(/(?:^|;)startSize=(\d+(?:\.\d+)?)(?=;|$)/); // NEW
        return { width: 0, height: match ? finitePasteParentNumber(match[1], 0) : 0 }; // NEW
    } // NEW

    function pasteParentGeometry(cell) { // NEW
        const m = graph.getModel(); // NEW
        if (m && typeof m.getGeometry === 'function') return m.getGeometry(cell); // NEW
        if (graph.getCellGeometry) return graph.getCellGeometry(cell); // NEW
        return cell && (cell.geometry || (cell.getGeometry && cell.getGeometry())) || null; // NEW
    } // NEW

    function pasteParentPageBounds(cell) { // NEW
        const m = graph.getModel(); // NEW
        const geo = pasteParentGeometry(cell); // NEW
        if (!geo || geo.relative) return null; // NEW
        let x = finitePasteParentNumber(geo.x, 0); // NEW
        let y = finitePasteParentNumber(geo.y, 0); // NEW
        const w = finitePasteParentNumber(geo.width, 0); // NEW
        const h = finitePasteParentNumber(geo.height, 0); // NEW
        let parent = m && m.getParent ? m.getParent(cell) : cell && cell.parent; // NEW
        while (parent) { // NEW
            const parentGeo = pasteParentGeometry(parent); // NEW
            if (parentGeo && !parentGeo.relative) { // NEW
                x += finitePasteParentNumber(parentGeo.x, 0); // NEW
                y += finitePasteParentNumber(parentGeo.y, 0); // NEW
                if (isPasteParentSwimlane(parent)) y += finitePasteParentNumber(pasteParentStartSize(parent).height, 0); // NEW
            } // NEW
            parent = m && m.getParent ? m.getParent(parent) : parent.parent; // NEW
        } // NEW
        return { x, y, w, h }; // NEW
    } // NEW

    function pasteParentChildOrigin(parent) { // NEW
        if (!parent) return { x: 0, y: 0 }; // NEW
        const bounds = pasteParentPageBounds(parent); // NEW
        if (!bounds) return { x: 0, y: 0 }; // NEW
        return { x: bounds.x, y: bounds.y + (isPasteParentSwimlane(parent) ? finitePasteParentNumber(pasteParentStartSize(parent).height, 0) : 0) }; // NEW
    } // NEW

    function clonePasteParentGeometry(geo) { // NEW
        return geo && typeof geo.clone === 'function' ? geo.clone() : Object.assign({}, geo); // NEW
    } // NEW

    function movePasteRootToParent(root, parent) { // NEW
        const m = graph.getModel(); // NEW
        const index = m.getChildCount ? m.getChildCount(parent) : undefined; // NEW
        if (m.add) m.add(parent, root, index); // NEW
        else if (graph.addCell) graph.addCell(root, parent); // NEW
    } // NEW

    function setPasteRootGeometry(root, geometry) { // NEW
        const m = graph.getModel(); // NEW
        if (m.setGeometry) m.setGeometry(root, geometry); // NEW
        else if (root) root.geometry = geometry; // NEW
    } // NEW

    function reparentPasteRoots(parent, roots) { // NEW
        const m = graph.getModel(); // NEW
        for (const root of roots || []) { // NEW
            if (!root || (m.getParent && m.getParent(root) === parent)) continue; // NEW
            const geo = pasteParentGeometry(root); // NEW
            const bounds = geo && !(m.isEdge && m.isEdge(root)) ? pasteParentPageBounds(root) : null; // NEW
            const nextGeo = bounds ? clonePasteParentGeometry(geo) : null; // NEW
            const origin = bounds ? pasteParentChildOrigin(parent) : null; // NEW
            movePasteRootToParent(root, parent); // NEW
            if (nextGeo && origin) { // NEW
                nextGeo.x = bounds.x - origin.x; // NEW
                nextGeo.y = bounds.y - origin.y; // NEW
                setPasteRootGeometry(root, nextGeo); // NEW
            } // NEW
        } // NEW
        if (graph.refresh) graph.refresh(parent); // NEW
    } // NEW

    function beginCursorAnchoredPaste(pt, evt) { // NEW
        const point = pasteParentAnchorPoint(pt, evt); // NEW
        if (!point) return null; // NEW
        const canReuse = pasteParentAnchor && !point.explicit && pasteParentPointsNear(point, pasteParentAnchor.point); // NEW
        return { point, cachedParent: canReuse ? pasteParentAnchor.parent : null, hit: canReuse ? null : cellAtPasteParentPoint(point) }; // NEW
    } // NEW

    function completeCursorAnchoredPaste(op, cells, evt) { // NEW
        const roots = topLevelPasteParentRoots(cells); // NEW
        if (!op || !roots.length) return null; // NEW
        let parent = isPasteParentCandidateValid(op.cachedParent, roots, evt) ? op.cachedParent : null; // NEW
        if (!parent) parent = resolvePasteParentFromHit(op.cachedParent ? cellAtPasteParentPoint(op.point) : op.hit, roots, evt); // NEW
        if (!parent) { pasteParentAnchor = null; return null; } // NEW
        reparentPasteRoots(parent, roots); // NEW
        pasteParentAnchor = { point: op.point, parent }; // NEW
        return parent; // NEW
    } // NEW

    function installCursorAnchoredPasteParenting() { // NEW
        if (graph.__trellisCursorAnchoredPasteParentingInstalled) return; // NEW
        graph.__trellisCursorAnchoredPasteParentingInstalled = true; // NEW

        const originalPasteXml = ui.pasteXml; // NEW
        if (typeof originalPasteXml === 'function') { // NEW
            ui.pasteXml = function (xml, pasteAsLabel, compat, evt, html, pt) { // NEW
                if (!isDiagramCellPasteXml(this, xml, compat)) return originalPasteXml.apply(this, arguments); // NEW
                const op = beginCursorAnchoredPaste(pt, evt); // NEW
                const m = graph.getModel(); // NEW
                m.beginUpdate(); // NEW
                try { // NEW
                    const cells = originalPasteXml.apply(this, arguments); // NEW
                    completeCursorAnchoredPaste(op, cells, evt); // NEW
                    return cells; // NEW
                } finally { // NEW
                    m.endUpdate(); // NEW
                } // NEW
            }; // NEW
        } // NEW

        const originalPasteFromLocalClipboard = ui.pasteFromLocalClipboard; // NEW
        if (typeof originalPasteFromLocalClipboard === 'function' && typeof mxClipboard !== 'undefined' && mxClipboard && typeof mxClipboard.paste === 'function') { // NEW
            ui.pasteFromLocalClipboard = function (pt) { // NEW
                const m = graph.getModel(); // NEW
                const op = beginCursorAnchoredPaste(pt, null); // NEW
                m.beginUpdate(); // NEW
                try { // NEW
                    const cells = mxClipboard.paste(graph); // NEW
                    if (graph.moveCellsTo) graph.moveCellsTo(cells, pt); // NEW
                    completeCursorAnchoredPaste(op, cells, null); // NEW
                    return cells; // NEW
                } finally { // NEW
                    m.endUpdate(); // NEW
                } // NEW
            }; // NEW
        } // NEW

        graph.__trellisPasteParenting = { // NEW
            rememberPointer: rememberPasteParentPointerPoint, // NEW
            beginPaste: beginCursorAnchoredPaste, // NEW
            completePaste: completeCursorAnchoredPaste, // NEW
            roots: topLevelPasteParentRoots, // NEW
            resolve: resolvePasteParentFromHit, // NEW
            clearAnchor: function () { pasteParentAnchor = null; }, // NEW
            getAnchor: function () { return pasteParentAnchor; } // NEW
        }; // NEW
    } // NEW

    installCursorAnchoredPasteParenting(); // NEW


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
        refreshCurrentHighlight();
    });
    graph.addListener(TRELLIS_SELECTION_VISUALS_REFRESH_EVENT, function () {
        refreshCurrentHighlight();

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
                        vertexLinkLog(`[Primary] Removed: ${verts.map(v => v.id).join(', ')}`);
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
                        vertexLinkLog(`[Primary] Marked: ${verts.map(v => v.id).join(', ')}`);
                        const sel = graph.getSelectionCell();
                        if (sel && model.isVertex(sel)) highlightLinked(sel);
                    });
                }
                // Mixed -> show both
                else {
                    menu.addItem(`Mark as Primary (${nonPrimCount})`, null, function () {
                        model.beginUpdate();
                        try {
                            for (const v of verts) {
                                if (!isPrimary(v)) setPrimary(v, true);
                            }
                        } finally { model.endUpdate(); }
                        vertexLinkLog(`[Primary] Marked: ${verts.filter(v => !isPrimary(v)).map(v => v.id).join(', ')}`); // OPTIONAL (see note)
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
                        vertexLinkLog(`[Primary] Removed: ${verts.filter(v => isPrimary(v)).map(v => v.id).join(', ')}`); // OPTIONAL (see note)
                        const sel = graph.getSelectionCell();
                        if (sel && model.isVertex(sel)) highlightLinked(sel);
                    });

                    vertexLinkLog(`[Primary] Mixed selection: primary=${primCount}, nonPrimary=${nonPrimCount}`);
                }
            }
            // Single-selection: show Remove Links if the vertex has any links
            if (verts.length === 1) {
                const v = verts[0];
                const linkCount = getLinkSet(v).size;
                if (linkCount > 0) {
                    menu.addItem(`Remove Links (from this vertex)`, null, function () {
                        const res = unlinkAllFor(v);
                        vertexLinkLog(`[UNLINK one] checked=${res.checked}, removed=${res.removed}`);
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
                        vertexLinkLog(`[BULK UNLINK] pairs=${res.pairs}, removed=${res.removed}`);
                        const sel = graph.getSelectionCell();
                        if (sel && model.isVertex(sel)) highlightLinked(sel);
                    });
                }
                // Only missing -> only "Link"                                           
                else if (missingPairs === totalPairs && totalPairs > 0) {
                    menu.addItem(`Link Selected (respect primaries) (${totalPairs})`, null, function () {
                        const res = linkRespectingPrimaries(verts);
                        vertexLinkLog(`[LINK P↔S] pairs=${res.pairs}, changed=${res.changes}`);
                        const sel = graph.getSelectionCell();
                        if (sel && model.isVertex(sel)) highlightLinked(sel);
                    });
                }
                // Mixed -> show both with counts                                        
                else if (totalPairs > 0) {
                    menu.addItem(`Link Selected (respect primaries) (${missingPairs})`, null, function () {
                        const res = linkRespectingPrimaries(verts);
                        vertexLinkLog(`[LINK P↔S] pairs=${res.pairs}, changed=${res.changes}`);
                        const sel = graph.getSelectionCell();
                        if (sel && model.isVertex(sel)) highlightLinked(sel);
                    });

                    menu.addItem(`Unlink Selected (${linkedPairs})`, null, function () {
                        const res = unlinkRespectingPrimaries(verts);
                        vertexLinkLog(`[BULK UNLINK] pairs=${res.pairs}, removed=${res.removed}`);
                        const sel = graph.getSelectionCell();
                        if (sel && model.isVertex(sel)) highlightLinked(sel);
                    });
                }
            }
        }

        function registerTrellisContextMenuContributor(contributor) {
            function finishRegistration() {
                if (!window.TrellisContextMenu) return;
                window.TrellisContextMenu.install(ui);
                window.TrellisContextMenu.register(contributor);
            }

            if (window.TrellisContextMenu) {
                finishRegistration();
            } else if (typeof mxscript === "function") {
                mxscript("plugins/garden_planner_plugins/Trellis_Context_Menu.js", finishRegistration);
            }
        }

        registerTrellisContextMenuContributor({
            id: "gardenLinking",
            priority: 600,
            addItems: function (menu) {
                addMenuItems(menu);
            }
        });
        vertexLinkLog('[ManualLinker] Registered ordered context menu contributor');
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
            if (graph.__trellisModules?.clusters && /(?:^|;)module=1(?:;|$)/.test(cell.style || '') && /(?:^|;)module=1(?:;|$)/.test(other.style || '')) continue; // NEW: module connectivity is undirected; selecting a module must not prune a valid one-sided link.
            const back = getLinkSet(other);
            if (!back.has(cell.id)) { removeOneWayLink(cell, id); removed++; }
        }
        return removed;
    }


    // Keep link overlays attached on zoom/pan and geometry changes                 
    const view = graph.getView();
    graph.addListener('trellisClustersChanged', requestCurrentHighlightRefresh); // NEW: release connector overlays when either endpoint leaves the rendered set.
    if (view && view.addListener) {
        function refreshViewOnlyLinkVisuals() {
            linkOverlays.refreshAll();


            // The host editor may recreate SVG nodes during zoom/pan, so reapply DOM highlights
            // after the view has finished its redraw cycle.
            setTimeout(function () {
                refreshCurrentHighlight();
                linkOverlays.refreshAll();

            }, 0);
        }

        view.addListener(mxEvent.SCALE, refreshViewOnlyLinkVisuals);
        view.addListener(mxEvent.TRANSLATE, refreshViewOnlyLinkVisuals);
        view.addListener(mxEvent.SCALE_AND_TRANSLATE, refreshViewOnlyLinkVisuals);
    }

    graph.getModel().addListener(mxEvent.CHANGE, function (_sender, evt) {
        // Any geometry change (move/resize) will trigger recompute                
        linkOverlays.refreshAll();
        requestCurrentHighlightRefresh(); // NEW: completion, dates, links and undo/redo can change the chosen occurrence
    });

    window.addEventListener('yearFilterChanged', requestCurrentHighlightRefresh); // NEW: year filtering can change without an undoable model edit

    window.addEventListener('trellisHistoryBeforeRestore', function () {
        try { clearAllHighlights(); } catch (e) { }
    });

    window.addEventListener('trellisHistoryAfterRestore', function () {
        try { refreshCurrentHighlight(); } catch (e) { }
        try { linkOverlays.refreshAll(); } catch (e) { }
    });


    /** Linking context is late-bound because plugins can finish loading in either order. */ // CHANGE
    graph.__trellisPlantingLinking = { // CHANGE
        normalizeSelection: normalizeForLinkingAndPrimary, // CHANGE
        getContext: source => ({ source, cards: collectLinkedKanbanCardsForSource(source), linkLabels: new Map() }), // CHANGE
        navigate: selectAndReveal // CHANGE
    }; // CHANGE
    if (graph.__trellisPlantingGroup) graph.__trellisPlantingGroup.overlay.syncSelection(); // CHANGE
    graph.fireEvent(new mxEventObject('trellisPlantingLinkingReady')); // CHANGE
    vertexLinkLog('[ManualLinker] Plugin loaded.');
});
