/**
 * Draw.io Plugin: Task Manager (Kanban Template Style + Auto Placement + Auto Archive + Badges)
 */
function normalizeTaskReplacementDetail(detail) { // FIX: centralize the scheduler event contract
    const source = detail && typeof detail === 'object' ? detail : {};
    return {
        mode: String(source.mode || 'replace').trim().toLowerCase(),
        targetGroupId: source.targetGroupId,
        tasks: Array.isArray(source.tasks) ? source.tasks : []
    };
}

function applyImmediateTaskReplacement({ targetGroupId, tasks, removeTasks, createTasks }) { // FIX: make empty replacement testable
    removeTasks(targetGroupId);
    if (tasks.length) createTasks(tasks, targetGroupId, { reflow: true });
}

if (typeof globalThis !== 'undefined' && globalThis.__TRELLIS_TASK_MANAGER_TEST__) { // FIX: no runtime exposure unless tests opt in
    globalThis.__TRELLIS_TASK_MANAGER_TEST_HOOKS__ = {
        normalizeTaskReplacementDetail,
        applyImmediateTaskReplacement
    };
}

Draw.loadPlugin(function (ui) {
    const graph = ui.editor.graph;
    const model = graph.getModel();

    const BOARD_KEY = 'KANBAN_BOARD';
    const BOARD_ROLE_ATTR = 'board_role';
    const TG_COMPLETED_ATTR = 'tg_completed';                                            // NEW


    // -------------------- Template styles --------------------
    const BOARD_STYLE =
        'swimlane;fontStyle=2;childLayout=stackLayout;horizontal=1;startSize=28;horizontalStack=1;resizeParent=1;resizeParentMax=0;resizeLast=0;collapsible=1;marginBottom=0;swimlaneFillColor=none;fontFamily=Permanent Marker;fontSize=16;points=[];verticalAlign=top;stackBorder=0;resizable=1;strokeWidth=2;disableMultiStroke=1;';
    const LANE_STYLE_BASE =
        'swimlane;strokeWidth=2;fontFamily=Permanent Marker;html=0;startSize=1;verticalAlign=bottom;spacingBottom=5;points=[];childLayout=stackLayout;stackBorder=20;stackSpacing=20;resizeLast=0;resizeParent=1;horizontalStack=0;collapsible=1;fillStyle=solid;swimlaneFillColor=default;';
    const CARD_STYLE =
        'whiteSpace=wrap;html=1;strokeWidth=2;fillColor=swimlane;fontStyle=1;spacingTop=0;rounded=1;arcSize=9;points=[];fontFamily=Permanent Marker;hachureGap=8;fillWeight=1;';

    // Lane fills
    const LANE_FILL = [
        '#C7D2FE', // UPCOMING (year)
        '#BAE6FD', // UPCOMING (month)
        '#BBF7D0', // UPCOMING (week)
        '#E5E7EB', // TODO (staged)
        '#F8CECC', // TODO
        '#FFF2CC', // DOING
        '#D5E8D4', // DONE
        '#D1FAE5', // DONE (week)
        '#A7F3D0', // DONE (month)
        '#6EE7B7', // DONE (year)
        '#F3F4F6'  // ARCHIVED
    ];

    const BOARD_GEOM = { x: 40, y: 40, w: 2200, h: 760 };
    const LANE_W = 220, LANE_H = 680, LANE_GAP = 16;

    const LINK_ATTR = 'linkedTo';

    const LANES = [
        { key: 'UPCOMING_YEAR', label: 'UPCOMING (year)' },
        { key: 'UPCOMING_MONTH', label: 'UPCOMING (month)' },
        { key: 'UPCOMING_WEEK', label: 'UPCOMING (week)' },
        { key: 'TODO_STAGED', label: 'TODO (staged)' },
        { key: 'TODO', label: 'TODO' },
        { key: 'DOING', label: 'DOING' },
        { key: 'DONE', label: 'DONE' },
        { key: 'DONE_WEEK', label: 'DONE (week)' },
        { key: 'DONE_MONTH', label: 'DONE (month)' },
        { key: 'DONE_YEAR', label: 'DONE (year)' },
        { key: 'ARCHIVED', label: 'ARCHIVED' }
    ];

    // -------------------- Paging icons --------------------                                       
    const ICON_PAGE_UP = 'data:image/svg+xml;utf8,' +
        encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14">' +
            '<polygon points="7,3 3,9 11,9" stroke="#000" fill="none" stroke-width="1.4"/>' +
            '</svg>'
        );

    const ICON_PAGE_DOWN = 'data:image/svg+xml;utf8,' +
        encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14">' +
            '<polygon points="3,5 11,5 7,11" stroke="#000" fill="none" stroke-width="1.4"/>' +
            '</svg>'
        );


    // -------------------- Helpers --------------------
    function ensureXmlValue(cell) {
        if (!cell.value || typeof cell.value === 'string') {
            const doc = mxUtils.createXmlDocument();
            const obj = doc.createElement('object');
            obj.setAttribute('label', cell.value || '');
            cell.value = obj;
        }
        return cell.value;
    }
    function setAttrNoUndo(cell, key, val, suppressRefresh) {
        ensureXmlValue(cell);
        const v = cell.value;
        if (!v || !v.setAttribute) return;

        if (val == null) v.removeAttribute(key);
        else v.setAttribute(key, String(val));

        if (!suppressRefresh) {
            graph.refresh(cell);
        }
    }

    function getAttr(cell, k) {
        const v = cell && cell.value;
        return (v && v.getAttribute) ? v.getAttribute(k) : null;
    }
    function createVertex(label, x, y, w, h, style) {
        const v = new mxCell(label || '', new mxGeometry(x, y, w, h), style || '');
        v.setVertex(true);
        v.setConnectable(false);
        return v;
    }

    // Garden-module helpers
    function isGardenModule(cell) { return getAttr(cell, 'garden_module') === '1'; }
    function findGardenModuleAncestor(cell) {
        if (!cell) return null;
        let cur = cell;
        while (cur) {
            if (isGardenModule(cur)) return cur;
            cur = model.getParent(cur);
        }
        return null;
    }

    function ensureBoardTemplateIn(containerVertex, opts) {                                  // CHANGE
        const parent = containerVertex || graph.getDefaultParent();
        let { main } = findBoardsIn(parent);
    
        const insideUpdate = !!(opts && opts.insideUpdate);                                  // NEW
        if (!insideUpdate) model.beginUpdate();                                              // NEW
        try {                                                                                // CHANGE
            let board = main;
            if (!board) {
                board = createVertex('Kanban', BOARD_GEOM.x, BOARD_GEOM.y, BOARD_GEOM.w, BOARD_GEOM.h, BOARD_STYLE);
                model.add(parent, board, model.getChildCount(parent));
                setAttrNoUndo(board, 'board_key', BOARD_KEY);
                setAttrNoUndo(board, BOARD_ROLE_ATTR, 'main');
                main = board;
            }
            ensureLanes(main);
            return { parent, board: main, lanes: lanesMap(main) };
        } finally {                                                                          // CHANGE
            if (!insideUpdate) model.endUpdate();                                            // NEW
        }                                                                                     // CHANGE
    }    

    function createSecondaryBoardIn(parent) {
        const board = createVertex('Kanban', BOARD_GEOM.x, BOARD_GEOM.y, BOARD_GEOM.w, BOARD_GEOM.h, BOARD_STYLE);
        model.add(parent, board, model.getChildCount(parent));
        setAttrNoUndo(board, 'board_key', BOARD_KEY);
        setAttrNoUndo(board, BOARD_ROLE_ATTR, 'secondary');
        ensureLanes(board);
        return board;
    }

    function ensureLanes(board) {
        const existingByKey = {};
        const count = model.getChildCount(board);
        for (let i = 0; i < count; i++) {
            const ch = model.getChildAt(board, i);
            if (!model.isVertex(ch)) continue;
            const k = getAttr(ch, 'lane_key');
            if (k) existingByKey[k] = ch;
        }
        let x = 10, y = 28;
        LANES.forEach((lane, idx) => {
            const fill = LANE_FILL[idx % LANE_FILL.length];
            const style = LANE_STYLE_BASE + 'fillColor=' + fill + ';strokeColor=' + fill + ';';
            let laneCell = existingByKey[lane.key];
            if (!laneCell) {
                laneCell = createVertex(lane.label, x, y, LANE_W, LANE_H, style);
                model.add(board, laneCell, model.getChildCount(board));
                setAttrNoUndo(laneCell, 'lane_key', lane.key);
                setAttrNoUndo(laneCell, 'status', lane.label);
            } else {
                laneCell.setStyle(style);
                ensureXmlValue(laneCell).setAttribute('label', lane.label);
                setAttrNoUndo(laneCell, 'status', lane.label);
            }
            x += LANE_W + LANE_GAP;
        });
        const totalW = 10 + (LANES.length * LANE_W) + ((LANES.length - 1) * LANE_GAP) + 10;
        const geo = board.getGeometry().clone();
        geo.width = Math.max(totalW, BOARD_GEOM.w);
        geo.height = BOARD_GEOM.h;
        model.setGeometry(board, geo);
    }

    function lanesMap(board) {
        const lanes = {};
        const n = model.getChildCount(board);
        for (let i = 0; i < n; i++) {
            const ch = model.getChildAt(board, i);
            if (!model.isVertex(ch)) continue;
            const k = getAttr(ch, 'lane_key');
            if (k) lanes[k] = ch;
        }
        return lanes;
    }

    // tiler group completed helpers

    function isTilerGroupCompleted(group) {                                              // NEW
        return getAttr(group, TG_COMPLETED_ATTR) === '1';                                // NEW
    }                                                                                    // NEW

    function setTilerGroupCompleted(group, completed) {                                   // NEW
        if (!group) return;                                                               // NEW
        setAttrNoUndo(group, TG_COMPLETED_ATTR, completed ? '1' : null, true);            // NEW (persist, no refresh)
    }                                                                                    // NEW

    function setStyleKey(style, key, val) {                                               // NEW
        const re = new RegExp("(^|;)" + key + "=[^;]*", "g");                             // NEW
        const cleaned = String(style || "").replace(re, "");                              // NEW
        const suffix = cleaned && !cleaned.endsWith(";") ? ";" : "";                      // NEW
        return cleaned + suffix + key + "=" + val + ";";                                  // NEW
    }                                                                                    // NEW

    function applyCompletedStyleToGroup(group, completed) {                     // CHANGE
        if (!group) return;                                                      // CHANGE

        const cur = group.getStyle ? (group.getStyle() || '') : (group.style || '');

        let next = cur;

        if (completed) {
            next = setStyleKey(next, 'fillStyle', 'zigzag-line');                // NEW
            next = setStyleKey(next, 'fillColor', '#FF3333');                    // NEW
            next = setStyleKey(next, 'strokeWidth', '3');                        // NEW
        } else {
            // remove only what we added                                          // NEW
            next = next.replace(/(^|;)fillStyle=zigzag-line(;|$)/g, '$1');       // NEW
            next = next.replace(/(^|;)fillColor=#FF3333(;|$)/g, '$1');            // NEW
            next = next.replace(/(^|;)strokeWidth=3(;|$)/g, '$1');               // NEW
        }

        if (next !== cur) {
            group.setStyle(next);                                                // CHANGE
        }
    }                                                                                    // NEW


    // Lane Helpers
    const PROTECTED_WORK_LANES = new Set(['TODO_STAGED', 'TODO', 'DOING']);

    function isDoneLikeLane(laneKey) {
        return laneKey === 'DONE' || laneKey === 'DONE_WEEK' ||
            laneKey === 'DONE_MONTH' || laneKey === 'DONE_YEAR' ||
            laneKey === 'ARCHIVED';
    }

    function isUpcomingLane(lk) {
        return lk === 'UPCOMING_YEAR' || lk === 'UPCOMING_MONTH' || lk === 'UPCOMING_WEEK';
    }

    function isWorkLane(laneKey) {
        return laneKey === 'UPCOMING_YEAR' || laneKey === 'UPCOMING_MONTH' ||
            laneKey === 'UPCOMING_WEEK' || laneKey === 'TODO_STAGED' ||
            laneKey === 'TODO' || laneKey === 'DOING';
    }

    // -------------------- Time helpers --------------------
    const MS_DAY = 86400000;
    function parseISO(iso) {
        if (!iso) return null;
        const [y, m, d] = iso.split('-').map(Number);
        if (!y || !m || !d) return null;
        return new Date(Date.UTC(y, m - 1, d));
    }
    function startOfUTCDay(d) {
        return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    }
    function todayISO() {
        const t = startOfUTCDay(new Date());
        const y = t.getUTCFullYear(), m = String(t.getUTCMonth() + 1).padStart(2, '0'), d = String(t.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    function daysUntilUTC(dateISO) {
        const dt = parseISO(dateISO);
        if (!dt) return null;
        const today = startOfUTCDay(new Date());
        return Math.floor((dt - today) / MS_DAY);
    }
    function daysSinceUTC(dateISO) {
        const dt = parseISO(dateISO);
        if (!dt) return null;
        const today = startOfUTCDay(new Date());
        return Math.floor((today - dt) / MS_DAY);
    }
    function daysBetweenUTC(aISO, bISO) {
        const a = parseISO(aISO), b = parseISO(bISO);
        if (!a || !b) return null;
        return Math.floor((a - b) / MS_DAY);
    }
    function fmtSigned(n) {
        if (n == null) return '';
        if (n > 0) return '+' + n;
        return String(n);
    }

    // -------------------- Classification --------------------
    function decideUpcomingLaneKey(startISO) {
        const du = daysUntilUTC(startISO);
        if (du == null || du <= 0) return 'TODO_STAGED';
        if (du <= 7) return 'UPCOMING_WEEK';
        if (du <= 30) return 'UPCOMING_MONTH';
        if (du <= 365) return 'UPCOMING_YEAR';
        return 'TODO_STAGED';
    }

    function classifyDoneLane(ageDays) {
        if (ageDays == null || ageDays < 1) return 'DONE';        // safety default
        if (ageDays <= 7) return 'DONE_WEEK';
        if (ageDays <= 30) return 'DONE_MONTH';
        if (ageDays <= 365) return 'DONE_YEAR';
        return 'ARCHIVED';
    }


    // -------------------- Badge helpers --------------------                                           
    function computeDaysToStart(startISO) {
        const n = daysUntilUTC(startISO);
        return (n == null) ? null : n;
    }
    function computeDaysLeft(endISO) {
        const n = daysUntilUTC(endISO);
        return (n == null) ? null : n;
    }
    function computeCompletedDelta(endISO, compISO) {
        if (!endISO) return null;
        const comp = compISO || todayISO();
        const delta = daysBetweenUTC(endISO, comp);  // end - completed                                  
        if (delta == null) return null;
        if (delta === 0) return { text: 'On Time', numeric: 0 };
        if (delta > 0) return { text: delta + ' Days Early', numeric: delta };
        return { text: Math.abs(delta) + ' Days Late', numeric: delta };
    }
    function renderBadge(label, text) {
        if (text == null || text === '') return '';
        return '<span style="display:inline-block;margin:2px 4px 0 0;border:1px solid #000;padding:0 6px;border-radius:10px;font-size:11px;line-height:16px;vertical-align:middle;"><b>' +
            mxUtils.htmlEntities(label) + ':</b> ' + mxUtils.htmlEntities(String(text)) + '</span>';
    }
    function computeBadgesFor(card, laneKey) {
        const startISO = getAttr(card, 'start');
        const endISO = getAttr(card, 'end');
        const compISO = getAttr(card, 'completed');
        if (isUpcomingLane(laneKey)) {
            const dts = computeDaysToStart(startISO);
            return { primaryText: (dts == null ? '' : String(dts)), html: renderBadge('Days to Start', dts) };
        }
        if (isWorkLane(laneKey)) {
            const dl = computeDaysLeft(endISO);
            return { primaryText: (dl == null ? '' : String(dl)), html: renderBadge('Days Left', dl) };
        }
        // DONE-like lanes                                                                                
        const delta = computeCompletedDelta(endISO, compISO);
        const text = delta ? delta.text : '';
        const primary = delta ? (delta.numeric === 0 ? '0' : fmtSigned(delta.numeric)) : '';
        return { primaryText: primary, html: renderBadge('Completed Time', text) };
    }

    function getLinkCount(cell) {
        return getLinkSet(cell).size;
    }


    // -------------------- Sorting helpers --------------------                                             
    function tsFromISO(iso) {
        const d = parseISO(iso);
        return d ? d.getTime() : null;
    }

    function getLaneSortKey(laneKey, card) {
        if (isUpcomingLane(laneKey)) {
            const dts = computeDaysToStart(getAttr(card, 'start'));
            return (dts == null) ? Number.POSITIVE_INFINITY : dts;
        }
        if (PROTECTED_WORK_LANES.has(laneKey)) {
            const dl = computeDaysLeft(getAttr(card, 'end'));
            return (dl == null) ? Number.POSITIVE_INFINITY : dl;
        }
        if (isDoneLikeLane(laneKey)) {
            const compISO = getAttr(card, 'completed') || getAttr(card, 'end');
            const t = tsFromISO(compISO);
            // Most recent first -> larger timestamp first                                                  
            return (t == null) ? Number.NEGATIVE_INFINITY : t;
        }
        return Number.POSITIVE_INFINITY;
    }

    function sortLaneCards(lane, laneKey) {
        // Collect cards                                                                                    
        const items = [];
        const n = model.getChildCount(lane);
        for (let i = 0; i < n; i++) {
            const c = model.getChildAt(lane, i);
            if (model.isVertex(c) && isRenderableKanbanCard(c)) {                             // CHANGE
                const key = getLaneSortKey(laneKey, c);
                const title = (getAttr(c, 'title') || '').toLowerCase();
                items.push({ cell: c, key, title });
            }
        }
        if (!items.length) return [];

        // Choose comparator                                                                                
        let cmp;
        if (isDoneLikeLane(laneKey)) {
            // Descending by timestamp (recent first). Nulls already mapped to -INF so they end last.       
            cmp = (a, b) => (b.key - a.key) || a.title.localeCompare(b.title);
        } else {
            // Ascending. Nulls mapped to +INF so they end last.                                            
            cmp = (a, b) => (a.key - b.key) || a.title.localeCompare(b.title);
        }

        const sorted = items.slice().sort(cmp);

        // Reinsert in desired order                                                                        
        model.beginUpdate();
        try {
            for (let i = 0; i < sorted.length; i++) {
                const c = sorted[i].cell;
                // Place at index i among lane children                                                     
                model.add(lane, c, i);
            }
        } finally { model.endUpdate(); }

        // Return sorted card cells for paging                                                   
        return sorted.map(entry => entry.cell);
    }


    // -------------------- Paging helpers --------------------                                   

    function measureAverageCardHeight(lane) {
        let total = 0;
        let count = 0;
        const n = model.getChildCount(lane);
        for (let i = 0; i < n; i++) {
            const c = model.getChildAt(lane, i);
            if (!model.isVertex(c)) continue;
            if (!isRenderableKanbanCard(c)) continue;                                         // CHANGE
            const geo = c.getGeometry();
            if (!geo) continue;
            total += geo.height;
            count++;
        }
        return count > 0 ? (total / count) : 80;  // fallback to 80px if no cards                
    }

    function computeLanePageSize(lane) {
        const geo = lane.getGeometry();
        if (!geo) return 10;

        // Style-derived constants: startSize=1, stackBorder=20, spacingBottom=5                 
        const headerHeight = 1;
        const topPadding = 20;
        const bottomPadding = 5;
        const reserved = headerHeight + topPadding + bottomPadding;  // 26px                     

        const laneHeight = geo.height;
        const availableHeight = Math.max(0, laneHeight - reserved);

        const avgCardHeight = measureAverageCardHeight(lane);
        const STACK_SPACING = 20;  // from LANE_STYLE_BASE                                       
        const unitHeight = avgCardHeight + STACK_SPACING;

        if (unitHeight <= 0 || availableHeight <= 0) return 1;
        const pageSize = Math.floor(availableHeight / unitHeight);
        return Math.max(1, pageSize);
    }

    function getLanePageIndex(lane) {
        const raw = getAttr(lane, 'page_index');
        if (raw == null || raw === '') return 0;
        const n = parseInt(raw, 10);
        return Number.isNaN(n) ? 0 : n;
    }

    function setLanePageIndex(lane, idx) {
        setAttrNoUndo(lane, 'page_index', String(idx));
    }

    function clampLanePageIndex(pageIndex, totalCards, pageSize) {
        if (totalCards <= 0) return 0;
        const maxPageIndex = Math.max(0, Math.ceil(totalCards / pageSize) - 1);
        if (pageIndex < 0) return 0;
        if (pageIndex > maxPageIndex) return maxPageIndex;
        return pageIndex;
    }

    function countRenderable(cards) {                                                  // NEW
        let n = 0;                                                                     // NEW
        for (const c of (cards || [])) if (!isYearHiddenCard(c)) n++;                  // NEW
        return n;                                                                       // NEW
    }

    function applyLanePaging(lane, laneKey, sortedCards) {
        const total = sortedCards ? sortedCards.length : 0;
        const renderableTotal = countRenderable(sortedCards);                          // NEW

        let anyVisibilityChanged = false;
        let labelChanged = false;

        if (renderableTotal === 0) {
            setLanePageIndex(lane, 0);
            const baseLabel = getAttr(lane, 'status') || lane.value || '';
            const v = ensureXmlValue(lane);
            const oldLabel = v.getAttribute('label') || '';
            const newLabel = String(baseLabel);
            if (oldLabel !== newLabel) {
                v.setAttribute('label', newLabel);
                labelChanged = true;
            }
            if (labelChanged) {
                graph.refresh(lane);
            }
            return;
        }

        const pageSize = computeLanePageSize(lane);
        let pageIndex = getLanePageIndex(lane);
        pageIndex = clampLanePageIndex(pageIndex, renderableTotal, pageSize);
        setLanePageIndex(lane, pageIndex);

        const start = pageIndex * pageSize;
        const end = Math.min(start + pageSize, renderableTotal);
        let pageIdx = 0;                                                                   // NEW

        for (let i = 0; i < total; i++) {
            const card = sortedCards[i];

            if (isYearHiddenCard(card)) continue;                                          // keep hidden; don't page // CHANGE

            const visible = (pageIdx >= start && pageIdx < end);                           // CHANGE
            pageIdx++;

            const curVisible = model.isVisible ? model.isVisible(card) : true;
            if (curVisible !== visible) {
                model.setVisible(card, visible);
                anyVisibilityChanged = true;
            }
        }

        const maxPageIndex = Math.max(0, Math.ceil(renderableTotal / pageSize) - 1);
        const baseLabel = getAttr(lane, 'status') || lane.value || '';
        const pageInfo = (maxPageIndex > 0)
            ? ` (Page ${pageIndex + 1} / ${maxPageIndex + 1})`
            : '';
        const v = ensureXmlValue(lane);
        const oldLabel = v.getAttribute('label') || '';
        const newLabel = String(baseLabel) + pageInfo;
        if (oldLabel !== newLabel) {
            v.setAttribute('label', newLabel);
            labelChanged = true;
        }

        if (anyVisibilityChanged || labelChanged) {
            graph.refresh(lane);
        }
    }

    // Simple page-navigation helper; overlays will call this                                    
    function changeLanePage(lane, laneKey, delta) {
        if (!lane) return;
        const current = getLanePageIndex(lane);
        setLanePageIndex(lane, current + delta);

        const cards = getLaneCardsInOrder(lane);                                    // use existing lane order
        applyLanePaging(lane, laneKey, cards);                                      // page only this lane
        ensureLanePagingControls(lane, laneKey, cards.length);                      // update overlays for this lane
    }


    function getLaneCardsInOrder(lane) {
        const out = [];
        if (!lane) return out;
        const n = model.getChildCount(lane);
        for (let i = 0; i < n; i++) {
            const c = model.getChildAt(lane, i);
            if (model.isVertex(c) && isRenderableKanbanCard(c)) {                             // CHANGE
                out.push(c);
            }
        }
        return out;
    }


    function resortAndPageLane(lane, laneKey) {
        const sortedCards = sortLaneCards(lane, laneKey) || [];
        applyLanePaging(lane, laneKey, sortedCards);
        ensureLanePagingControls(lane, laneKey, sortedCards.length);
    }


    // Paging controls (overlays) for each lane                                                  
    function ensureLanePagingControls(lane, laneKey, totalCards) {
        if (!lane || totalCards == null) return;

        const pageSize = computeLanePageSize(lane);
        if (totalCards <= pageSize) {
            // No paging needed: clear overlays and reset page index                             
            graph.removeCellOverlays(lane);
            setLanePageIndex(lane, 0);
            return;
        }

        let pageIndex = getLanePageIndex(lane);
        const maxPageIndex = Math.max(0, Math.ceil(totalCards / pageSize) - 1);
        pageIndex = clampLanePageIndex(pageIndex, totalCards, pageSize);
        setLanePageIndex(lane, pageIndex);

        // Clear any existing overlays for this lane                                             
        graph.removeCellOverlays(lane);

        // Up overlay (top-right) – only if not on first page                                    
        if (pageIndex > 0) {
            const upImage = new mxImage(ICON_PAGE_UP, 14, 14);
            const upOverlay = new mxCellOverlay(upImage, 'Page Up');
            upOverlay.align = mxConstants.ALIGN_RIGHT;
            upOverlay.verticalAlign = mxConstants.ALIGN_TOP;
            upOverlay.offset = new mxPoint(-4, 4);
            upOverlay.cursor = 'pointer';
            upOverlay.addListener(mxEvent.CLICK, function (_sender, evt) {
                changeLanePage(lane, laneKey, -1);
                if (evt && evt.consume) evt.consume();
            });
            graph.addCellOverlay(lane, upOverlay);
        }

        // Down overlay (bottom-right) – only if not on last page                                
        if (pageIndex < maxPageIndex) {
            const downImage = new mxImage(ICON_PAGE_DOWN, 14, 14);
            const downOverlay = new mxCellOverlay(downImage, 'Page Down');
            downOverlay.align = mxConstants.ALIGN_RIGHT;
            downOverlay.verticalAlign = mxConstants.ALIGN_BOTTOM;
            downOverlay.offset = new mxPoint(-4, -4);
            downOverlay.cursor = 'pointer';
            downOverlay.addListener(mxEvent.CLICK, function (_sender, evt) {
                changeLanePage(lane, laneKey, +1);
                if (evt && evt.consume) evt.consume();
            });
            graph.addCellOverlay(lane, downOverlay);
        }
    }


    // -------------------- Badge + label --------------------
    function refreshCardLabel(card, suppressRefresh) {
        if (getAttr(card, 'kanban_card') !== '1') return;
        const title = mxUtils.htmlEntities(getAttr(card, 'title') || 'Task');
        const parent = model.getParent(card);
        const laneKey = parent ? getAttr(parent, 'lane_key') : null;
        const badgesHtml = getAttr(card, 'badges_html') || '';

        const linkCount = getLinkCount(card);
        const linkBadge = (linkCount > 1) ? renderBadge('Links', linkCount) : '';

        const badgesBlock = (badgesHtml || linkBadge)
            ? ('<br/>' + badgesHtml + linkBadge)
            : '';

        const html = title + badgesBlock;

        ensureXmlValue(card).setAttribute('label', html);
        if (!suppressRefresh) {
            graph.refresh(card);
        }
    }




    function setBadge(card, text, suppressRefresh) {
        setAttrNoUndo(card, 'badge', text || '', suppressRefresh);
        // no refresh here; refreshCardLabel builds full badges block
    }

    function updateBadgeForLane(card, laneKey, suppressRefresh) {
        const oldBadge = getAttr(card, 'badge') || '';
        const oldHtml = getAttr(card, 'badges_html') || '';

        const badges = computeBadgesFor(card, laneKey);
        const newBadge = badges.primaryText || '';
        const newHtml = badges.html || '';

        if (oldBadge === newBadge && oldHtml === newHtml) {
            // Badges unchanged, but links may have changed, so always rebuild label //
            refreshCardLabel(card, suppressRefresh);
            return false;
        }

        setBadge(card, newBadge, true);
        setAttrNoUndo(card, 'badges_html', newHtml, true);
        refreshCardLabel(card, suppressRefresh);
        return true;
    }




    // Delete old / unlink tasks
    function removeTasksLinkedOnlyTo(targetGroupId) {
        if (!targetGroupId) return;

        const grp = model.getCell(targetGroupId);
        if (!grp) return;

        // All cells currently linked FROM this group
        const linkedCells = getLinkedCellsOf(grp) || [];
        if (!linkedCells.length) return;

        // Mutable link set for the group itself
        const groupLinkSet = getLinkSet(grp);

        model.beginUpdate();
        try {
            for (const c of linkedCells) {
                // Only operate on Kanban cards
                if (!isKanbanCard(c)) continue;

                // All IDs linked TO this card
                const linkSet = getLinkSet(c);
                if (!linkSet || !linkSet.has(targetGroupId)) continue;

                if (linkSet.size === 1) {
                    // Case 1: card is linked ONLY to this group → delete card
                    groupLinkSet.delete(c.id);      // unlink from group side
                    model.remove(c);
                } else {
                    // Case 2: card is linked to this group AND others → just unlink this group
                    linkSet.delete(targetGroupId);  // unlink group on card side
                    setLinkSet(c, linkSet);         // writes back + refreshes label

                    groupLinkSet.delete(c.id);      // unlink card on group side
                }
            }

            // Write back updated group link set once
            setLinkSet(grp, groupLinkSet);

        } finally {
            model.endUpdate();
        }
    }



    // -------------------- Task creation --------------------
    async function createTasks(tasks, targetGroupId, opts) {
        if (!Array.isArray(tasks) || tasks.length === 0) return [];

        const reflow = !opts || opts.reflow !== false;

        let gardenModule = null;
        const grp = model.getCell(targetGroupId);
        if (grp) {
            const gm = findGardenModuleAncestor(grp);
            if (gm) gardenModule = gm;
        }

        const out = [];

        model.beginUpdate();
        try {
            const { board, lanes } = ensureBoardTemplateIn(gardenModule, { insideUpdate: true });   // CHANGE

            for (const t of tasks) {
                const laneKey = decideUpcomingLaneKey(t.startISO);
                const parentLane = lanes[laneKey] || lanes['TODO_STAGED'];

                const card = createCard(parentLane, {
                    title: t.title,
                    notes: t.notes,
                    startISO: t.startISO,
                    endISO: t.endISO
                }, /*suppressRefresh*/ true);

                if (t.method) setAttrNoUndo(card, 'method', t.method);
                if (t.plant_name) setAttrNoUndo(card, 'plant_name', t.plant_name);
                if (t.succession_index != null) {
                    setAttrNoUndo(card, 'succession_index', String(t.succession_index));
                }

                if (grp) linkBothWays(grp, card);
                updateBadgeForLane(card, getAttr(parentLane, 'lane_key'));

                out.push({ cellId: card.id, title: t.title });
            }

            // Run scan only on the affected board inside the same transaction
            if (board && reflow) {
                scanAndReflowBoard(board, { insideUpdate: true });
            }

        } finally {
            model.endUpdate();
        }

        if (out.length) {
            const last = model.getCell(out[out.length - 1].cellId);
            if (last) {
                graph.setSelectionCell(last);
                graph.scrollCellToVisible(last, true);
            }
        }

        return out;
    }


    function createCard(parentLane, { title, notes, startISO, endISO }, suppressRefresh) {
        const card = createVertex('', 0, 0, 160, 80, CARD_STYLE);
        model.add(parentLane, card, model.getChildCount(parentLane));
        setAttrNoUndo(card, 'kanban_card', '1', /*suppressRefresh*/ !!suppressRefresh);
        setAttrNoUndo(card, 'title', title || 'Task', !!suppressRefresh);
        if (notes) setAttrNoUndo(card, 'notes', notes, !!suppressRefresh);
        if (startISO) setAttrNoUndo(card, 'start', startISO, !!suppressRefresh);
        if (endISO) setAttrNoUndo(card, 'end', endISO, !!suppressRefresh);
        const laneStatus = getAttr(parentLane, 'status') || parentLane.value || '';
        setAttrNoUndo(card, 'status', laneStatus, !!suppressRefresh);
        setAttrNoUndo(card, 'badge', '', !!suppressRefresh);
        setAttrNoUndo(card, 'badges_html', '', !!suppressRefresh);
        refreshCardLabel(card, !!suppressRefresh);
        return card;
    }




    // -------------------- Linking --------------------
    function getLinkSet(cell) {
        const raw = getAttr(cell, LINK_ATTR);
        if (!raw) return new Set();
        return new Set(String(raw).split(',').map(s => s.trim()).filter(Boolean));
    }
    function setLinkSet(cell, set) {
        setAttrNoUndo(cell, LINK_ATTR, Array.from(set).join(','));
        if (getAttr(cell, 'kanban_card') === '1') refreshCardLabel(cell);                  // refresh only for cards
    }
    function linkBothWays(a, b) {
        if (!a || !b || a === b) return false;
        const sa = getLinkSet(a), sb = getLinkSet(b);
        let changed = false;
        if (!sa.has(b.id)) { sa.add(b.id); setLinkSet(a, sa); changed = true; } // route via setLinkSet (refresh)
        if (!sb.has(a.id)) { sb.add(a.id); setLinkSet(b, sb); changed = true; } // route via setLinkSet (refresh)
        return changed;
    }
    function getLinkedCellsOf(cell) {
        const out = [];
        getLinkSet(cell).forEach(id => {
            const c = model.getCell(id);
            if (c && model.isVertex(c)) out.push(c);
        });
        return out;
    }


    // -------------------- Reflow logic --------------------
    function boardLanes(board) { return lanesMap(board); }

    function putInLane(card, lanes, laneKey, suppressRefresh) {
        const lane = lanes[laneKey];
        if (!lane) return false;
        if (model.getParent(card) === lane) {
            updateBadgeForLane(card, laneKey, suppressRefresh);
            return false;
        }
        model.add(lane, card, model.getChildCount(lane));
        const status = getAttr(lane, 'status') || lane.value || '';
        setAttrNoUndo(card, 'status', status, true);
        updateBadgeForLane(card, laneKey, suppressRefresh);
        return true;
    }


    // 2) Guard reclassifyUpcoming so it never moves cards out of protected lanes  
    function reclassifyUpcoming(card, lanes) {
        const parent = model.getParent(card);
        const curKey = parent ? getAttr(parent, 'lane_key') : null;
        if (curKey && PROTECTED_WORK_LANES.has(curKey)) {
            updateBadgeForLane(card, curKey, true);
            return false;
        }
        const startISO = getAttr(card, 'start');
        const laneKey = decideUpcomingLaneKey(startISO);
        return putInLane(card, lanes, laneKey, true);
    }

    function reclassifyDone(card, lanes) {
        let comp = getAttr(card, 'completed') || getAttr(card, 'end');
        if (!comp) {
            comp = todayISO();
            setAttrNoUndo(card, 'completed', comp, true);
        }
        const age = daysSinceUTC(comp);
        const target = classifyDoneLane(age);
        return putInLane(card, lanes, target, true);
    }

    function enforceYearHiddenVisibility(card) {                                       // NEW
        if (!isYearHiddenCard(card)) return false;                                     // NEW
        const cur = model.isVisible ? model.isVisible(card) : true;                    // NEW
        if (cur === false) return false;                                               // NEW
        model.setVisible(card, false);                                                 // NEW
        graph.refresh(card);                                                          // NEW (or graph.refresh(model.getParent(card)) )
        return true;                                                                   // NEW
    }                                                                                  // NEW


    // 3) Scan logic: skip auto-move for protected lanes; still refresh badges     
    function scanAndReflowBoard(board, opts) {
        if (!board) return;
        const lanes = boardLanes(board);
        const insideUpdate = opts && opts.insideUpdate;
        let boardDirty = false;

        if (!insideUpdate) model.beginUpdate();
        try {
            for (const key in lanes) {
                const lane = lanes[key];
                const n = model.getChildCount(lane);
                let laneDirty = false;

                for (let i = 0; i < n; i++) {
                    const c = model.getChildAt(lane, i);
                    if (!model.isVertex(c) || getAttr(c, 'kanban_card') !== '1') continue;

                    if (isYearHiddenCard(c)) {                                                         // CHANGE
                        enforceYearHiddenVisibility(c);                                                // NEW
                        continue;                                                                      // existing
                    }

                    if (isDoneLikeLane(key)) {
                        if (reclassifyDone(c, lanes)) laneDirty = true;
                        continue;
                    }
                    if (key === 'ARCHIVED') {
                        if (updateBadgeForLane(c, 'ARCHIVED', true)) laneDirty = true;
                        continue;
                    }
                    if (PROTECTED_WORK_LANES.has(key)) {
                        if (updateBadgeForLane(c, key, true)) laneDirty = true;
                        continue;
                    }
                    if (isUpcomingLane(key)) {
                        if (reclassifyUpcoming(c, lanes)) laneDirty = true;
                        continue;
                    }
                    if (updateBadgeForLane(c, key, true)) laneDirty = true;
                }

                if (laneDirty) {
                    // Classification or badges changed → re-sort and page
                    resortAndPageLane(lane, key);
                    boardDirty = true;
                } else {
                    // Nothing structurally changed, but enforce paging anyway
                    const cards = getLaneCardsInOrder(lane);
                    applyLanePaging(lane, key, cards);
                    ensureLanePagingControls(lane, key, cards.length);
                }
            }

            if (boardDirty) {
                graph.refresh(board);
            }
        } finally {
            if (!insideUpdate) model.endUpdate();
        }
    }

    function scanAllBoards(opts) {
        const insideUpdate = opts && opts.insideUpdate;

        const containers = [];
        (function walk(p) {
            const n = model.getChildCount(p);
            for (let i = 0; i < n; i++) {
                const ch = model.getChildAt(p, i);
                if (!ch) continue;
                if (model.isVertex(ch) && isGardenModule(ch)) containers.push(ch);
                walk(ch);
            }
        })(model.getRoot());

        const targets = containers.length ? containers : [graph.getDefaultParent()];

        if (!insideUpdate) model.beginUpdate();
        try {
            targets.forEach(parent => {
                const { main, secondary } = findBoardsIn(parent);
                [main, ...secondary].filter(Boolean).forEach(scanAndReflowBoard);
            });
        } finally {
            if (!insideUpdate) model.endUpdate();
        }
    }

    // -------------------- Kanban / Group helpers --------------------
    function isKanbanCard(cell) { return getAttr(cell, 'kanban_card') === '1'; }

    function isTilerGroup(cell) {
        return !isKanbanCard(cell) && (
            getAttr(cell, 'tiler_group') === '1'
        );
    }

    function laneKeyOfCard(card) {
        const p = model.getParent(card);
        return p ? getAttr(p, 'lane_key') : null;
    }

    function allLinkedCardsDone(group) {
        const cards = getLinkedCellsOf(group).filter(isKanbanCard);
        if (cards.length === 0) return null;  // indicates "no linked cards"
        return cards.every(c => {
            const lk = laneKeyOfCard(c);
            return lk && isDoneLikeLane(lk);
        });
    }

    function updateGroupRenderState(group) {                                              // CHANGE
        if (!group || !isTilerGroup(group)) return;                                       // CHANGE
        const cards = getLinkedCellsOf(group).filter(isKanbanCard);                       // CHANGE

        if (cards.length === 0) {
            // no linked cards left -> delete the group                                   
            const edges = graph.getEdges(group, null, true, true, true) || [];
            model.beginUpdate();
            try {
                edges.forEach(e => model.remove(e));
                model.remove(group);
            } finally { model.endUpdate(); }
            return;
        }

        // Completion is a state, not visibility                                           // NEW
        const allDone = allLinkedCardsDone(group) === true;                               // CHANGE
        const wasDone = isTilerGroupCompleted(group);                                     // NEW

        if (allDone === wasDone) return;                                                  // NEW (no change)

        model.beginUpdate();                                                              // NEW
        try {
            setTilerGroupCompleted(group, allDone);                                       // NEW
            applyCompletedStyleToGroup(group, allDone);                                   // NEW
        } finally {
            model.endUpdate();                                                            // NEW
        }

        graph.refresh(group);                                                             // CHANGE
    }                                                                                    // CHANGE


    function updateRenderForGroupsLinkedTo(card) {
        if (!card) return;
        getLinkedCellsOf(card)
            .filter(isTilerGroup)
            .forEach(updateGroupRenderState);
    }

    function isYearHiddenCard(card) {                                                 // NEW
        return getAttr(card, 'year_hidden') === '1';                                  // NEW
    }                                                                                 // NEW

    function isRenderableKanbanCard(card) {                                           // NEW
        return isKanbanCard(card) && !isYearHiddenCard(card);                         // NEW
    }                                                                                 // NEW




    // -------------------- Auto-status, badges, and DONE autopromotion --------------------
    model.addListener(mxEvent.CHANGE, function (_sender, evt) {
        const edit = evt.getProperty('edit');
        if (!edit || !edit.changes) return;
        for (const ch of edit.changes) {
            if (ch instanceof mxChildChange) {
                const cell = ch.child;
                if (!cell || !model.isVertex(cell) || !isKanbanCard(cell)) continue;
                if (isYearHiddenCard(cell)) continue;                                              // NEW


                const parent = model.getParent(cell);
                if (!parent) continue;

                const laneKey = getAttr(parent, 'lane_key');
                if (!laneKey) continue;

                // Keep %status% and badge in sync
                const laneStatus = getAttr(parent, 'status') || parent.value || '';
                setAttrNoUndo(cell, 'status', laneStatus);
                updateBadgeForLane(cell, laneKey);

                // If entering any DONE-like lane...
                if (isDoneLikeLane(laneKey)) {
                    if (!getAttr(cell, 'completed')) setAttrNoUndo(cell, 'completed', todayISO());
                    const board = model.getParent(parent);
                    const lanes = boardLanes(board);
                    reclassifyDone(cell, lanes);
                    updateRenderForGroupsLinkedTo(cell);                                            // moved before continue
                    continue;
                }

                // If entering a work lane from completed/archived, remove completed
                if (isWorkLane(laneKey) && getAttr(cell, 'completed') != null) {
                    setAttrNoUndo(cell, 'completed', null);
                    updateBadgeForLane(cell, laneKey);
                    updateRenderForGroupsLinkedTo(cell);                                           // evaluate after badge reset
                    continue;
                }

                // Fallback: still evaluate groups
                updateRenderForGroupsLinkedTo(cell);
            }
            // no-op for non-child changes
        }
    });


    graph.addListener('linksChanged', function (_sender, evt) {
        const deletedIdArr = evt.getProperty('deletedIds') || [];
        const impactedIdArr = evt.getProperty('impactedIds') || [];
        if ((!deletedIdArr || deletedIdArr.length === 0) && impactedIdArr.length === 0) {
            console.warn('[Kanban] linksChanged: no deletedIds/impactedIds payload');
            return;
        }

        const deletedIds = new Set(deletedIdArr);
        const impactedIds = new Set(impactedIdArr);

        const toDelete = [];
        const deletedCards = [];
        const debug = [];
        let cardsSeen = 0, cardsLinkedToDeleted = 0, cardsWithSurvivors = 0, cardsNoLinks = 0;
        let removedCount = 0;

        function forEachCandidate(fn) {
            if (impactedIds.size > 0) {
                impactedIds.forEach(id => {
                    const c = model.getCell(id);
                    if (c && model.isVertex(c) && isKanbanCard(c)) fn(c);
                });
            } else {
                (function walk(p) {
                    const n = model.getChildCount(p);
                    for (let i = 0; i < n; i++) {
                        const ch = model.getChildAt(p, i);
                        if (!ch) continue;
                        if (model.isVertex(ch) && isKanbanCard(ch)) fn(ch);
                        walk(ch);
                    }
                })(model.getRoot());
            }
        }

        model.beginUpdate();
        try {
            // --- clean groups regardless of card deletion outcome -------------------------
            (function cleanGroupsAndReevaluate() {
                if (!deletedIds || deletedIds.size === 0) return;
                const touchedGroups = new Set();
                (function walk(p) {
                    const n = model.getChildCount(p);
                    for (let i = 0; i < n; i++) {
                        const ch = model.getChildAt(p, i);
                        if (!ch) continue;
                        if (model.isVertex(ch) && isTilerGroup(ch)) {
                            const links = getLinkSet(ch);
                            let changed = false;
                            deletedIds.forEach(id => {
                                if (links.has(id)) { links.delete(id); changed = true; }
                            });
                            if (changed) {
                                setLinkSet(ch, links);                                   // keeps undo; no label refresh for non-cards
                                touchedGroups.add(ch.id);
                            }
                        }
                        walk(ch);
                    }
                })(model.getRoot());

                touchedGroups.forEach(id => {
                    const g = model.getCell(id);
                    if (g) updateGroupRenderState(g);                                    // hide or delete now
                });
            })();
            // ------------------------------------------------------------------------------

            // Decide per candidate
            forEachCandidate(function (card) {
                cardsSeen++;

                // Current link set for this card
                const linkSet = getLinkSet(card);
                const beforeSize = linkSet.size;

                if (beforeSize === 0) {
                    // Already has no links -> delete according to rule
                    cardsNoLinks++;
                    toDelete.push(card);
                    debug.push(`[Orphan] card ${card.id} (${getAttr(card, 'title') || 'Untitled'}) had no links pre-cleanup → delete`);
                    return;
                }

                // Remove any references to deletedIds
                let removedAny = false;
                deletedIds.forEach(function (id) {
                    if (linkSet.has(id)) {
                        linkSet.delete(id);
                        removedAny = true;
                    }
                });

                const afterSize = linkSet.size;

                if (!removedAny && afterSize > 0) {
                    // Card not affected: still has non-deleted links
                    debug.push(`[Skip] card ${card.id} still linked to ${afterSize} survivors; no change`);
                    return;
                }

                if (afterSize === 0) {
                    // All links were to deleted ids -> orphan -> delete
                    cardsLinkedToDeleted++;
                    cardsNoLinks++;
                    setLinkSet(card, linkSet);
                    toDelete.push(card);
                    debug.push(`[Delete] card ${card.id} all links pointed to deletedIds; now orphaned → delete`);
                } else {
                    // Still has surviving links: keep, but persist pruned set
                    cardsLinkedToDeleted++;
                    cardsWithSurvivors++;
                    setLinkSet(card, linkSet);
                    debug.push(`[Keep] card ${card.id} pruned to ${afterSize} surviving links`);
                }
            });

            // Apply deletions inside same update
            if (toDelete.length > 0) {
                for (const c of toDelete) {
                    deletedCards.push({ id: c.id, title: getAttr(c, 'title') || 'Untitled' });
                    const edges = graph.getEdges(c, null, true, true, true) || [];
                    edges.forEach(e => model.remove(e));
                    model.remove(c);
                    removedCount++;
                }
            }

        } finally {
            model.endUpdate();
        }

        if (removedCount === 0) {
            console.log(`[Kanban] Orphan cleanup summary: deletedIds=${deletedIdArr.length}, cardsSeen=${cardsSeen}, linkedToDeleted=${cardsLinkedToDeleted}, survivors=${cardsWithSurvivors}, noLinks=${cardsNoLinks}, removed=0`);
            console.log('[Kanban] No cards removed. Detailed traces:\n' + debug.join('\n'));
        } else {
            console.log(`[Kanban] Orphan cleanup summary: deletedIds=${deletedIdArr.length}, cardsSeen=${cardsSeen}, linkedToDeleted=${cardsLinkedToDeleted}, survivors=${cardsWithSurvivors}, noLinks=${cardsNoLinks}, removed=${removedCount}`);
            console.log('[Kanban] Deleted cards:');
            deletedCards.forEach(c => console.log(`  - ${c.id}: ${c.title}`));
        }
    });



    // -------------------- Board selection scan --------------------
    graph.getSelectionModel().addListener(mxEvent.CHANGE, function () {
        const sel = graph.getSelectionCell();
        if (!sel || !model.isVertex(sel)) return;
        const key = getAttr(sel, 'board_key');
        if (key === BOARD_KEY || key === 'MAIN_KANBAN_BOARD') {
            scanAndReflowBoard(sel);
        }
    });

    function findBoardsIn(parent) {
        const out = { main: null, secondary: [] };
        if (!parent) return out;
        const n = model.getChildCount(parent);
        for (let i = 0; i < n; i++) {
            const c = model.getChildAt(parent, i);
            if (!model.isVertex(c)) continue;
            const key = getAttr(c, 'board_key');
            if (key !== BOARD_KEY && key !== 'MAIN_KANBAN_BOARD') continue;
            const role = getAttr(c, BOARD_ROLE_ATTR);
            const isMain = role === 'main' || key === 'MAIN_KANBAN_BOARD';
            if (isMain && !out.main) out.main = c;
            else out.secondary.push(c);
        }
        return out;
    }

    // -------------------- Menu hook --------------------
    (function addMenuHook() {
        const pmh = graph.popupMenuHandler;
        const prev = pmh.factoryMethod;
        pmh.factoryMethod = function (menu, cell, evt) {
            if (typeof prev === 'function') prev.apply(this, arguments);
            menu.addSeparator();
            menu.addItem('Add Kanban Board', null, function () {
                const gm = findGardenModuleAncestor(cell) || null;                                   // CHANGE
                model.beginUpdate();                                                                 // CHANGE
                try {                                                                                // NEW
                    ensureBoardTemplateIn(gm, { insideUpdate: true });                                // NEW
                } finally {                                                                          // NEW
                    model.endUpdate();                                                               // NEW
                }                                                                                    // NEW
            });
            
        };
    })();

    // -------------------- Succession buffer (global per recompute) --------------------
    let successionBuffer = null; // { totalSucc, chunks, clearedGroups, seenSuccIndexes }  

    // -------------------- Event bridge from scheduler --------------------                
    function handleTasksCreatedEvent(ev) {
        const detail = ev && ev.detail ? ev.detail : {};
        const replacement = normalizeTaskReplacementDetail(detail); // FIX
        const tasks = replacement.tasks; // FIX
        const targetGroupId = replacement.targetGroupId; // FIX
        if (replacement.mode !== 'replace' || !targetGroupId) return; // FIX: missing mode remains replace-compatible

        // Prefer successionOffset if present, else fallback to successionIndex      
        const rawIdx = (detail.successionOffset != null)
            ? detail.successionOffset
            : detail.successionIndex;

        const rawTotal = detail.totalSuccessions;

        const succIndex = Number.isFinite(Number(rawIdx))
            ? Number(rawIdx)
            : null;
        const totalSucc = Number.isFinite(Number(rawTotal))
            ? Number(rawTotal)
            : null;

        const hasMeta = (totalSucc != null && totalSucc > 0);

        // DEBUG: event summary                                                  (optional to remove later)
        console.log('[Kanban] tasksCreated event', {
            targetGroupId, rawIdx, rawTotal, succIndex, totalSucc,
            hasMeta, taskCount: tasks.length
        });

        // Defer so the scheduler UI thread is not blocked
        setTimeout(function () {
            // No meta or trivially 1 succession -> behave as before              
            if (!hasMeta || totalSucc === 1) {
                console.log('[Kanban] immediate createTasks (no/1 succession)', {
                    targetGroupId, taskCount: tasks.length
                });
                applyImmediateTaskReplacement({
                    targetGroupId,
                    tasks,
                    removeTasks: removeTasksLinkedOnlyTo,
                    createTasks
                }); // FIX: an empty replacement still clears stale tasks
                return;
            }

            // -------------------- Global buffered-per-run path -------------------- 

            // Initialize or reset buffer if none or totalSucc changed             
            if (!successionBuffer || successionBuffer.totalSucc !== totalSucc) {
                console.log('[Kanban] init/reset global succession buffer', {
                    totalSuccOld: successionBuffer ? successionBuffer.totalSucc : null,
                    totalSuccNew: totalSucc
                });
                successionBuffer = {
                    totalSucc: totalSucc,
                    chunks: [],
                    clearedGroups: new Set(),
                    seenSuccIndexes: new Set()
                };
            }

            const buf = successionBuffer;

            // Clear old tasks exactly once per group for this run                 
            if (!buf.clearedGroups.has(targetGroupId)) {
                console.log('[Kanban] clearing old tasks for group', {
                    targetGroupId
                });
                removeTasksLinkedOnlyTo(targetGroupId);
                buf.clearedGroups.add(targetGroupId);
            }

            const beforeChunks = buf.chunks.length;
            buf.chunks.push({ succIndex, targetGroupId, tasks });
            if (succIndex != null) {
                buf.seenSuccIndexes.add(succIndex);
            }

            console.log('[Kanban] global buffer updated', {
                beforeChunks, afterChunks: buf.chunks.length,
                pushedSuccIndex: succIndex, pushedTasks: tasks.length,
                seenSuccIndexes: Array.from(buf.seenSuccIndexes)
            });

            const haveAllSucc = (
                succIndex != null &&
                buf.seenSuccIndexes.size >= buf.totalSucc
            );

            console.log('[Kanban] succession progress', {
                succIndex, totalSucc, haveAllSucc
            });

            if (!haveAllSucc) {
                // Wait for remaining successions in this run                      
                return;
            }

            // -------------------- Flush: we have all successions -------------------- 

            const chunksSorted = buf.chunks.slice().sort((a, b) => {
                const ai = (a.succIndex != null ? a.succIndex : 0);
                const bi = (b.succIndex != null ? b.succIndex : 0);
                return ai - bi;
            });

            // Group merged tasks by targetGroupId                                  
            const perGroup = new Map();
            for (const chunk of chunksSorted) {
                const gid = chunk.targetGroupId;
                if (!perGroup.has(gid)) perGroup.set(gid, []);
                perGroup.get(gid).push.apply(perGroup.get(gid), chunk.tasks);
            }

            // For logging: total merged tasks                                      
            let mergedTotal = 0;
            perGroup.forEach(arr => { mergedTotal += arr.length; });

            console.log('[Kanban] flushing global succession buffer', {
                totalSucc: buf.totalSucc,
                totalChunks: buf.chunks.length,
                groups: Array.from(perGroup.keys()),
                mergedTaskCount: mergedTotal
            });

            // Clear buffer                                                         
            successionBuffer = null;

            // Create tasks per group. Allow first group to trigger reflow;        
            // subsequent groups ride on same board reflow to avoid repeats.       
            let first = true;
            for (const [gid, taskList] of perGroup.entries()) {
                if (!taskList || taskList.length === 0) continue;
                createTasks(taskList, gid, { reflow: first });
                first = false;
            }
        }, 0);
    }

    window.addEventListener('tasksCreated', handleTasksCreatedEvent);

    window.addEventListener("yearFilterChanged", function (ev) {                         // NEW
        try {                                                                           // NEW
            // simplest: rescan boards so paging respects year_hidden                   // NEW
            scanAllBoards({ insideUpdate: false });                                     // NEW
        } catch (e) { }                                                                 // NEW
    });

    console.log('[TaskManager] Kanban loaded. Use window.TaskBus.createTasks([...]).');

    // -------------------- Auto-create board on garden settings event --------------------  // NEW
    if (!graph.__uslKanbanGardenEventInstalled) {                                            // NEW
        graph.__uslKanbanGardenEventInstalled = true;                                        // NEW

        graph.addListener("usl:gardenModuleNeedsSettings", function (_sender, evt) {         // NEW
            const moduleCell = evt && typeof evt.getProperty === "function"                  // NEW
                ? evt.getProperty("cell")                                                    // NEW
                : null;                                                                      // NEW

            if (!moduleCell || !model.isVertex(moduleCell)) return;                          // NEW
            if (!isGardenModule(moduleCell)) return;                                         // NEW

            const boards = findBoardsIn(moduleCell);                                         // NEW
            if (boards && boards.main) return;                                               // NEW (already has a board)

            // Defer to avoid running inside someone else's model.beginUpdate()               // NEW
            setTimeout(function () {                                                         // NEW
                const again = findBoardsIn(moduleCell);                                      // NEW
                if (again && again.main) return;                                             // NEW
                model.beginUpdate();                                                         // NEW
                try {                                                                        // NEW
                    ensureBoardTemplateIn(moduleCell, { insideUpdate: true });                               // CHANGE
                } finally {                                                                  // NEW
                    model.endUpdate();                                                       // NEW
                }                                                                            // NEW
                graph.refresh(moduleCell);   
                graph.fireEvent(new mxEventObject("usl:requestApplyModuleMargins","cell",moduleCell));// NEW
                // NEW
            }, 0);                                                                           // NEW
        });                                                                                  // NEW
    }                                                                                        // NEW

});
