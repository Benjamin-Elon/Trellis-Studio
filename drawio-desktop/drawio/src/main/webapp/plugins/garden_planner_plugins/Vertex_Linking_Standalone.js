/**
 * Draw.io Plugin: Manual Vertex Linker with Highlight and Overlay Navigation // CHANGE
 * - Right-click to link/unlink selected vertices
 * - Highlights linked vertices and draws dashed edges
 * - Left-click a visible link or link label to navigate between linked vertices // CHANGE
 */
Draw.loadPlugin(function (ui) {
    const graph = ui.editor.graph;
    let model = graph.getModel();

    const LINK_ATTR = 'linkedTo';
    const TILER_GROUP_CREATED_EVENT = 'usl:tilerGroupCreated'; // CHANGE
    const HL_TAG_KEY = 'manualLinkHL';
    const HL_OLD_COLOR = 'manualLinkOldColor';
    const HL_OLD_WIDTH = 'manualLinkOldWidth';
    const DEBUG_VERTEX_LINKING_CONSOLE = false; // CHANGE
    const GRAPH_OVERLAY_Z = Object.freeze({ ANNOTATION: 10000, CONNECTION: 10010, CONTROL: 10020, CONTROL_TOP: 10030 }); // CHANGE
    const GRAPH_OVERLAY_LAYER_CLASS = Object.freeze({ annotation: 'trellis-graph-annotation-layer', connection: 'trellis-graph-connection-layer', control: 'trellis-graph-control-layer', controlTop: 'trellis-graph-control-top-layer' }); // NEW
    const GRAPH_OVERLAY_LAYER_Z = Object.freeze({ annotation: GRAPH_OVERLAY_Z.ANNOTATION, connection: GRAPH_OVERLAY_Z.CONNECTION, control: GRAPH_OVERLAY_Z.CONTROL, controlTop: GRAPH_OVERLAY_Z.CONTROL_TOP }); // NEW
    const LINK_ENDPOINT_CENTER_OFFSET_PX = 5; // NEW
    const LINK_LABEL_STAGGER_PX = 15; // NEW
    graph.__ctrlToggleHandled = false;

    // -------------------- Helpers --------------------

    function vertexLinkLog() { // CHANGE
        if (!DEBUG_VERTEX_LINKING_CONSOLE) return; // CHANGE
        try { console.log.apply(console, arguments); } catch (_) { } // CHANGE
    } // CHANGE

    function ensureGraphOverlayContainer() { // NEW
        const host = graph.container; // NEW
        if (!host) return null; // NEW
        try { // NEW
            if (window.getComputedStyle && window.getComputedStyle(host).position === 'static') host.style.position = 'relative'; // NEW
        } catch (_) { } // NEW
        return host; // NEW
    } // NEW

    function ensureGraphOverlayHtmlLayer(layerKey) { // NEW
        const host = ensureGraphOverlayContainer(); // NEW
        const key = GRAPH_OVERLAY_LAYER_CLASS[layerKey] ? layerKey : 'control'; // NEW
        const className = GRAPH_OVERLAY_LAYER_CLASS[key]; // NEW
        if (!host || !className) return null; // NEW
        let layer = host.querySelector('.' + className); // NEW
        if (!layer) { // NEW
            layer = document.createElement('div'); // NEW
            layer.className = className; // NEW
            layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:' + GRAPH_OVERLAY_LAYER_Z[key] + ';'; // NEW
            host.appendChild(layer); // NEW
        } // NEW
        return layer; // NEW
    } // NEW

    function ensureGraphOverlaySvgLayer(layerKey) { // NEW
        const layer = ensureGraphOverlayHtmlLayer(layerKey || 'connection'); // NEW
        if (!layer) return null; // NEW
        layer.style.width = '100%'; // NEW
        layer.style.height = '100%'; // NEW
        let svg = layer.querySelector('svg.trellis-graph-connection-svg'); // NEW
        if (!svg) { // NEW
            svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); // NEW
            svg.setAttribute('class', 'trellis-graph-connection-svg'); // NEW
            svg.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:auto;'; // NEW
            layer.appendChild(svg); // NEW
        } // NEW
        return svg; // NEW
    } // NEW

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
        model.setValue(cell, obj); // CHANGE
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

    function isKanbanBoard(cell) { // CHANGE
        return !!cell && (getAttr(cell, 'board_key') === 'KANBAN_BOARD'); // CHANGE
    } // CHANGE

    function findKanbanBoardAncestor(cell) { // CHANGE
        const m = graph.getModel(); // CHANGE
        let cur = cell; // CHANGE
        while (cur) { // CHANGE
            if (isKanbanBoard(cur)) return cur; // CHANGE
            cur = m.getParent(cur); // CHANGE
        } // CHANGE
        return null; // CHANGE
    } // CHANGE

    function isGardenModuleCell(cell) { // CHANGE
        return !!cell && getAttr(cell, 'garden_module') === '1'; // CHANGE
    } // CHANGE

    function isGardenDashboardCell(cell) { // CHANGE
        return !!cell && getAttr(cell, 'garden_dashboard') === '1'; // CHANGE
    } // CHANGE

    function findGardenModuleAncestor(cell) { // CHANGE
        let cur = cell; // CHANGE
        while (cur) { // CHANGE
            if (isGardenModuleCell(cur)) return cur; // CHANGE
            cur = model.getParent(cur); // CHANGE
        } // CHANGE
        return null; // CHANGE
    } // CHANGE

    function findDashboardCellInModule(moduleCell) { // CHANGE
        if (!moduleCell) return null; // CHANGE
        const stack = [moduleCell]; // CHANGE
        while (stack.length) { // CHANGE
            const cur = stack.pop(); // CHANGE
            const count = model.getChildCount(cur); // CHANGE
            for (let i = 0; i < count; i++) { // CHANGE
                const child = model.getChildAt(cur, i); // CHANGE
                if (!child) continue; // CHANGE
                if (isGardenDashboardCell(child)) return child; // CHANGE
                stack.push(child); // CHANGE
            } // CHANGE
        } // CHANGE
        return null; // CHANGE
    } // CHANGE

    function getDashboardYearForCell(cell) { // CHANGE
        const moduleCell = findGardenModuleAncestor(cell); // CHANGE
        const dashboard = findDashboardCellInModule(moduleCell); // CHANGE
        const year = Number(getAttr(dashboard, 'dashboard_year')); // CHANGE
        return Number.isFinite(year) && year > 1900 && year < 3000 ? year : new Date().getFullYear(); // CHANGE
    } // CHANGE

    function collectSameBoardLinkedKanbanCards(selectedCard, directTargets) { // CHANGE
        if (!isKanbanCard(selectedCard)) return []; // CHANGE

        const board = findKanbanBoardAncestor(selectedCard); // CHANGE
        if (!board) return []; // CHANGE

        const out = []; // CHANGE
        const seen = new Set([selectedCard.id]); // CHANGE

        // Avoid duplicate highlighting for cards already highlighted as direct targets. // CHANGE
        for (const t of directTargets || []) { // CHANGE
            if (t && t.id) seen.add(t.id); // CHANGE
        } // CHANGE

        // A selected task card may link to a shared source, such as a tiler group. // CHANGE
        // Highlight the other task cards linked to that same source, but only inside this board. // CHANGE
        for (const sourceId of getLinkSet(selectedCard)) { // CHANGE
            const source = model.getCell(sourceId); // CHANGE
            if (!source || !model.isVertex(source)) continue; // CHANGE
            if (!isTilerGroup(source)) continue; // CHANGE

            for (const candidateId of getLinkSet(source)) { // CHANGE
                const candidate = model.getCell(candidateId); // CHANGE
                if (!candidate || !model.isVertex(candidate)) continue; // CHANGE
                if (!isKanbanCard(candidate)) continue; // CHANGE
                if (candidate === selectedCard) continue; // CHANGE
                if (findKanbanBoardAncestor(candidate) !== board) continue; // CHANGE
                if (seen.has(candidate.id)) continue; // CHANGE

                seen.add(candidate.id); // CHANGE
                out.push(candidate); // CHANGE
            } // CHANGE
        } // CHANGE

        return out; // CHANGE
    } // CHANGE

    function collectLinkedTaskCardSiblingIdsForTiler(selectedTiler, directTargets) { // CHANGE
        if (!isTilerGroup(selectedTiler)) return new Set(); // CHANGE

        const cards = []; // CHANGE
        const seen = new Set(); // CHANGE

        for (const target of directTargets || []) { // CHANGE
            if (!target || !target.id || seen.has(target.id)) continue; // CHANGE
            if (!model.isVertex(target)) continue; // CHANGE
            if (!isKanbanCard(target)) continue; // CHANGE
            if (!findKanbanBoardAncestor(target)) continue; // CHANGE

            seen.add(target.id); // CHANGE
            cards.push(target); // CHANGE
        } // CHANGE

        if (cards.length < 2) return new Set(); // CHANGE
        return new Set(cards.map(card => card.id)); // CHANGE
    } // CHANGE

    function collectLinkedKanbanCardsForSource(source) { // CHANGE
        if (!source || isKanbanCard(source)) return []; // CHANGE

        const out = []; // CHANGE
        const seen = new Set(); // CHANGE
        const m = graph.getModel(); // CHANGE

        for (const id of getLinkSet(source)) { // CHANGE
            if (!id || seen.has(id)) continue; // CHANGE
            const card = m.getCell(id); // CHANGE
            if (!card || !m.isVertex(card)) continue; // CHANGE
            if (!isKanbanCard(card)) continue; // CHANGE
            if (!findKanbanBoardAncestor(card)) continue; // CHANGE

            seen.add(card.id); // CHANGE
            out.push(card); // CHANGE
        } // CHANGE

        out.sort(compareTaskCardsByStartDate); // CHANGE
        return out; // CHANGE
    } // CHANGE

    function compareTaskCardsByStartDate(a, b) { // CHANGE
        const aRange = getTaskDateRange(a); // CHANGE
        const bRange = getTaskDateRange(b); // CHANGE
        const aHasDate = !!aRange; // CHANGE
        const bHasDate = !!bRange; // CHANGE

        if (aHasDate !== bHasDate) return aHasDate ? -1 : 1; // CHANGE
        if (aHasDate && bHasDate && aRange.startDay !== bRange.startDay) return aRange.startDay - bRange.startDay; // CHANGE

        const aLabel = (getRawTextLabel(a) || getAttr(a, 'title') || a.id || '').toLowerCase(); // CHANGE
        const bLabel = (getRawTextLabel(b) || getAttr(b, 'title') || b.id || '').toLowerCase(); // CHANGE
        if (aLabel < bLabel) return -1; // CHANGE
        if (aLabel > bLabel) return 1; // CHANGE

        return String(a.id || '').localeCompare(String(b.id || '')); // CHANGE
    } // CHANGE

    function parseTaskOverlayDate(raw) { // CHANGE
        if (!raw) return null; // CHANGE
        const match = String(raw).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); // CHANGE
        if (!match) return null; // CHANGE
        const year = Number(match[1]); // CHANGE
        const month = Number(match[2]); // CHANGE
        const day = Number(match[3]); // CHANGE
        if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null; // CHANGE
        const utc = Date.UTC(year, month - 1, day); // CHANGE
        const date = new Date(utc); // CHANGE
        if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null; // CHANGE
        return { // CHANGE
            iso: match[0], // CHANGE
            date, // CHANGE
            dayNumber: Math.floor(utc / 86400000) // CHANGE
        }; // CHANGE
    } // CHANGE

    function getTaskDateRange(card) { // CHANGE
        const start = parseTaskOverlayDate(getAttr(card, 'start')); // CHANGE
        if (!start) return null; // CHANGE
        const rawEnd = getAttr(card, 'end'); // CHANGE
        const end = rawEnd ? parseTaskOverlayDate(rawEnd) : start; // CHANGE
        if (!end || end.dayNumber < start.dayNumber) return null; // CHANGE
        return { // CHANGE
            start, // CHANGE
            end, // CHANGE
            startDay: start.dayNumber, // CHANGE
            endDay: end.dayNumber, // CHANGE
            durationDays: end.dayNumber - start.dayNumber + 1 // CHANGE
        }; // CHANGE
    } // CHANGE

    function taskDateRangeOverlapsYear(card, year) { // CHANGE
        const range = getTaskDateRange(card); // CHANGE
        const selectedYear = Number(year); // CHANGE
        if (!range || !Number.isFinite(selectedYear)) return false; // CHANGE
        const startDay = Math.floor(Date.UTC(selectedYear, 0, 1) / 86400000); // CHANGE
        const endDay = Math.floor(Date.UTC(selectedYear, 11, 31) / 86400000); // CHANGE
        return range.startDay <= endDay && range.endDay >= startDay; // CHANGE
    } // CHANGE

    function getTaskOverlayYears(cards) { // CHANGE
        const years = new Set(); // CHANGE
        for (const card of cards || []) { // CHANGE
            const range = getTaskDateRange(card); // CHANGE
            if (!range) continue; // CHANGE
            for (let year = range.start.date.getUTCFullYear(); year <= range.end.date.getUTCFullYear(); year++) { // CHANGE
                if (year > 1900 && year < 3000) years.add(year); // CHANGE
            } // CHANGE
        } // CHANGE
        return Array.from(years).sort((a, b) => a - b); // CHANGE
    } // CHANGE

    function chooseDefaultOverlayYear(years) { // CHANGE
        const list = Array.isArray(years) ? years : []; // CHANGE
        if (!list.length) return null; // CHANGE
        const currentYear = new Date().getFullYear(); // CHANGE
        return list.indexOf(currentYear) >= 0 ? currentYear : list[0]; // CHANGE
    } // CHANGE

    function formatTaskOverlayDate(dateInfo) { // CHANGE
        if (!dateInfo || !dateInfo.date) return ''; // CHANGE
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; // CHANGE
        return months[dateInfo.date.getUTCMonth()] + ' ' + String(dateInfo.date.getUTCDate()).padStart(2, '0'); // CHANGE
    } // CHANGE

    function formatTaskDateRange(card) { // CHANGE
        const range = getTaskDateRange(card); // CHANGE
        if (!range) return 'Unscheduled'; // CHANGE
        const startLabel = formatTaskOverlayDate(range.start); // CHANGE
        const endLabel = formatTaskOverlayDate(range.end); // CHANGE
        return range.startDay === range.endDay ? startLabel : (startLabel + ' - ' + endLabel); // CHANGE
    } // CHANGE

    function stripTaskBadgeText(raw) { // CHANGE
        const text = stripHtmlAndPlaceholders(String(raw || '')); // CHANGE
        return text.length > 36 ? text.slice(0, 33) + '...' : text; // CHANGE
    } // CHANGE

    function getTaskLaneColor(card) { // CHANGE
        return getLaneColorForCard(card) || '#9aa0a6'; // CHANGE
    } // CHANGE

    function getTaskOverlayBadges(card) { // CHANGE
        const badges = []; // CHANGE
        const rawBadges = stripTaskBadgeText(getAttr(card, 'badges_html')); // CHANGE
        if (rawBadges) badges.push(rawBadges); // CHANGE
        const repeatBadge = getAttr(card, 'repeat_badge'); // CHANGE
        if (repeatBadge) badges.push('Repeat ' + repeatBadge); // CHANGE
        const note = stripTaskBadgeText(getAttr(card, 'card_note')); // CHANGE
        if (note) badges.push('Note ' + note); // CHANGE
        if (getAttr(card, 'date_override') === '1') badges.push('Dates edited'); // CHANGE
        const linkCount = getLinkSet(card).size; // CHANGE
        if (linkCount > 1) badges.push('Links ' + linkCount); // CHANGE
        return badges; // CHANGE
    } // CHANGE

    function normalizeRepeatIdentityText(value) { // CHANGE
        return String(value == null ? '' : value).trim().toLowerCase(); // CHANGE
    } // CHANGE

    function normalizeRepeatLinkedIds(value) { // CHANGE
        return Array.from(new Set(String(value == null ? '' : value) // CHANGE
            .split(',') // CHANGE
            .map(id => id.trim()) // CHANGE
            .filter(Boolean))) // CHANGE
            .sort(); // CHANGE
    } // CHANGE

    function buildRepeatSeriesKeyForOverlay(card) { // CHANGE
        const linkedIds = normalizeRepeatLinkedIds(getAttr(card, LINK_ATTR)); // CHANGE
        if (linkedIds.length === 0) return null; // CHANGE

        return JSON.stringify([ // CHANGE
            linkedIds, // CHANGE
            normalizeRepeatIdentityText(getAttr(card, 'plant_name')), // CHANGE
            normalizeRepeatIdentityText(getAttr(card, 'method')), // CHANGE
            normalizeRepeatIdentityText(getAttr(card, 'title')) // CHANGE
        ]); // CHANGE
    } // CHANGE

    function compareRepeatOccurrenceCards(a, b) { // CHANGE
        const aRange = getTaskDateRange(a); // CHANGE
        const bRange = getTaskDateRange(b); // CHANGE
        if (aRange && bRange && aRange.startDay !== bRange.startDay) return aRange.startDay - bRange.startDay; // CHANGE
        if (aRange && !bRange) return -1; // CHANGE
        if (!aRange && bRange) return 1; // CHANGE
        if (aRange && bRange && aRange.endDay !== bRange.endDay) return aRange.endDay - bRange.endDay; // CHANGE
        return String(a && a.id || '').localeCompare(String(b && b.id || '')); // CHANGE
    } // CHANGE

    function isOverlayCardVisibilityEligible(card) { // CHANGE
        return getAttr(card, 'year_hidden') !== '1' && getAttr(card, 'repeat_hidden') !== '1'; // CHANGE
    } // CHANGE

    function getLaneOrderIndex(lane) { // CHANGE
        if (!lane) return Number.POSITIVE_INFINITY; // CHANGE
        const parent = model.getParent(lane); // CHANGE
        if (!parent) return Number.POSITIVE_INFINITY; // CHANGE
        const count = model.getChildCount(parent); // CHANGE
        for (let i = 0; i < count; i++) { // CHANGE
            if (model.getChildAt(parent, i) === lane) return i; // CHANGE
        } // CHANGE
        return Number.POSITIVE_INFINITY; // CHANGE
    } // CHANGE

    function cleanOverlayLaneLabel(label) { // CHANGE
        return stripHtmlAndPlaceholders(String(label || '')).replace(/\s*\(Page\s+\d+\s*\/\s*\d+\)\s*$/i, '').trim(); // CHANGE
    } // CHANGE

    function getLaneGroupLabel(card, lane, laneKey) { // CHANGE
        if (lane) { // CHANGE
            const explicit = getAttr(lane, 'label') || getAttr(lane, 'status'); // CHANGE
            if (explicit) return cleanOverlayLaneLabel(explicit); // CHANGE
            if (typeof lane.value === 'string' && lane.value) return cleanOverlayLaneLabel(lane.value); // CHANGE
            if (lane.value && lane.value.textContent) return cleanOverlayLaneLabel(lane.value.textContent); // CHANGE
        } // CHANGE
        return laneKey || getAttr(card, 'status') || 'Unlaned'; // CHANGE
    } // CHANGE

    function makeLaneGroupForCard(card) { // CHANGE
        const lane = findLaneAncestor(card); // CHANGE
        const laneKey = getLaneStatusKeyForTask(card) || (lane ? getAttr(lane, 'lane_key') : null) || 'UNLANED'; // CHANGE
        return { // CHANGE
            lane, // CHANGE
            laneId: lane && lane.id ? lane.id : laneKey, // CHANGE
            laneKey, // CHANGE
            label: getLaneGroupLabel(card, lane, laneKey), // CHANGE
            color: getTaskLaneColor(card), // CHANGE
            order: getLaneOrderIndex(lane), // CHANGE
            items: [] // CHANGE
        }; // CHANGE
    } // CHANGE

    function withRepeatOverlayBadge(item, badgeText) { // CHANGE
        item.repeatBadge = badgeText || ''; // CHANGE
        return item; // CHANGE
    } // CHANGE

    function groupLinkedTasksForOverlay(cards) { // CHANGE
        const groupsByLane = new Map(); // CHANGE

        function getGroup(card) { // CHANGE
            const lane = findLaneAncestor(card); // CHANGE
            const laneKey = getLaneStatusKeyForTask(card) || (lane ? getAttr(lane, 'lane_key') : null) || 'UNLANED'; // CHANGE
            const laneId = lane && lane.id ? lane.id : laneKey; // CHANGE
            if (!groupsByLane.has(laneId)) groupsByLane.set(laneId, makeLaneGroupForCard(card)); // CHANGE
            return groupsByLane.get(laneId); // CHANGE
        } // CHANGE

        const recordsByLaneAndSeries = new Map(); // CHANGE
        for (const card of cards || []) { // CHANGE
            if (!card || getAttr(card, 'year_hidden') === '1') continue; // CHANGE
            const group = getGroup(card); // CHANGE
            const seriesKey = buildRepeatSeriesKeyForOverlay(card); // CHANGE

            if (!seriesKey) { // CHANGE
                if (isOverlayCardVisibilityEligible(card)) group.items.push({ card, repeatBadge: '' }); // CHANGE
                continue; // CHANGE
            } // CHANGE

            const laneSeriesKey = group.laneId + '|' + seriesKey; // CHANGE
            if (!recordsByLaneAndSeries.has(laneSeriesKey)) { // CHANGE
                recordsByLaneAndSeries.set(laneSeriesKey, { group, seriesKey, cards: [] }); // CHANGE
            } // CHANGE
            recordsByLaneAndSeries.get(laneSeriesKey).cards.push(card); // CHANGE
        } // CHANGE

        for (const series of recordsByLaneAndSeries.values()) { // CHANGE
            const ordered = series.cards.slice().sort(compareRepeatOccurrenceCards); // CHANGE
            const candidates = ordered.filter(isOverlayCardVisibilityEligible); // CHANGE
            if (!candidates.length) continue; // CHANGE
            const representative = candidates[0]; // CHANGE
            const globalIndex = ordered.indexOf(representative); // CHANGE
            const hiddenInLane = Math.max(0, ordered.length - 1); // CHANGE
            const badge = ordered.length > 1 // CHANGE
                ? ((globalIndex + 1) + '/' + ordered.length + (hiddenInLane > 0 ? ' +' + hiddenInLane : '')) // CHANGE
                : ''; // CHANGE
            series.group.items.push(withRepeatOverlayBadge({ card: representative }, badge)); // CHANGE
        } // CHANGE

        const groups = Array.from(groupsByLane.values()) // CHANGE
            .map(group => { // CHANGE
                group.items.sort((a, b) => compareTaskCardsByStartDate(a.card, b.card)); // CHANGE
                return group; // CHANGE
            }) // CHANGE
            .filter(group => group.items.length > 0) // CHANGE
            .sort((a, b) => (a.order - b.order) || String(a.label || '').localeCompare(String(b.label || ''))); // CHANGE

        return groups; // CHANGE
    } // CHANGE

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

    function sideLengthForAnchor(center, side) { // NEW
        if (!center) return 0; // NEW
        return (side === 'left' || side === 'right') ? center.h : center.w; // NEW
    } // NEW

    function avoidStandardLinkEndpointCenterT(center, side, t, marginPx) { // NEW
        const sideLenPx = sideLengthForAnchor(center, side); // NEW
        const baseT = Math.max(0, Math.min(1, t == null ? 0.5 : t)); // NEW
        if (!Number.isFinite(sideLenPx) || sideLenPx <= 0) return baseT; // NEW
        const marginT = Math.min(Math.max(0, marginPx || 0) / sideLenPx, 0.49); // NEW
        const minT = marginT; // NEW
        const maxT = 1 - marginT; // NEW
        const clampedT = Math.max(minT, Math.min(maxT, baseT)); // NEW
        if (Math.abs(clampedT - 0.5) > 0.0001) return clampedT; // NEW
        const offsetT = Math.max(0, LINK_ENDPOINT_CENTER_OFFSET_PX) / sideLenPx; // NEW
        return Math.max(minT, Math.min(maxT, 0.5 + offsetT)); // NEW
    } // NEW

    function anchorStandardLinkEndpointOnSide(center, side, t, marginPx) { // NEW
        return anchorOnSide(center, side, avoidStandardLinkEndpointCenterT(center, side, t, marginPx)); // NEW
    } // NEW


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

    function isRoleCard(cell) { // NEW
        const style = cell && cell.style != null ? String(cell.style) : ''; // NEW
        return /(?:^|;)role_card=1(?:;|$)/.test(style); // NEW
    } // NEW

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

        function getOverlayPane() { // CHANGE
            const view = graph.getView && graph.getView(); // CHANGE
            return view && view.getOverlayPane ? view.getOverlayPane() : null; // CHANGE
        } // CHANGE

        function formatLinkOverlayBadgeLabel(label) { // CHANGE
            const text = stripHtmlAndPlaceholders(String(label || '')).trim(); // CHANGE
            return text.length > 40 ? text.slice(0, 37) + '...' : text; // CHANGE
        } // CHANGE

        function applyLinkOverlayBadgeStyle(txt, stroke) { // CHANGE
            if (!txt) return; // CHANGE
            txt.size = 10; // CHANGE
            txt.fontStyle = mxConstants.FONT_BOLD; // CHANGE
            txt.color = '#3c4043'; // CHANGE
            txt.background = '#ffffff'; // CHANGE
            txt.border = stroke || '#9aa0a6'; // CHANGE
            txt.spacing = 6; // CHANGE
            txt.spacingTop = 2; // CHANGE
            txt.spacingRight = 6; // CHANGE
            txt.spacingBottom = 2; // CHANGE
            txt.spacingLeft = 6; // CHANGE
            if (txt.node && txt.node.style) { // CHANGE
                txt.node.style.borderRadius = '10px'; // CHANGE
                txt.node.style.filter = 'drop-shadow(0 1px 2px rgba(0, 0, 0, 0.16))'; // CHANGE
            } // CHANGE
        } // CHANGE

        function normalizeLabelOffset(offset) { // NEW
            const x = offset && Number.isFinite(offset.x) ? offset.x : 0; // NEW
            const y = offset && Number.isFinite(offset.y) ? offset.y : 0; // NEW
            return { x, y }; // NEW
        } // NEW

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
                srcPt = anchorStandardLinkEndpointOnSide(srcC, hint.side, hint.t, 4); // CHANGE
            }
            if (!srcPt) {
                srcPt = { x: srcC.x, y: srcC.y };
            }

            const trgSide = sideToward(dstC, srcC);
            const trgPt = anchorStandardLinkEndpointOnSide(dstC, trgSide, 0.5, 4); // CHANGE
            if (!trgPt) return null;

            return [
                new mxPoint(srcPt.x, srcPt.y),
                new mxPoint(trgPt.x, trgPt.y)
            ];
        }

        // Create or update text label near the source side                               
        function createOrUpdateLabel(entry, pts) {
            const pane = getOverlayPane();
            const label = formatLinkOverlayBadgeLabel(entry.label); // CHANGE
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
            const labelOffset = normalizeLabelOffset(entry.labelOffset); // NEW
            const labelX = lx + labelOffset.x; // NEW
            const labelY = ly + labelOffset.y; // NEW

            if (!isFinite(labelX) || !isFinite(labelY)) { // CHANGE
                return;
            }

            if (entry.labelElt && entry.labelElt.node &&
                entry.labelElt.node.parentNode === pane) {
                // Update existing mxText
                entry.labelElt.value = label;
                entry.labelElt.bounds.x = labelX; // CHANGE
                entry.labelElt.bounds.y = labelY; // CHANGE
                applyLinkOverlayBadgeStyle(entry.labelElt, entry.color); // CHANGE
                entry.labelElt.redraw();
            } else {
                // Remove old, if any
                if (entry.labelElt && entry.labelElt.node && entry.labelElt.node.parentNode) {
                    entry.labelElt.node.parentNode.removeChild(entry.labelElt.node);
                }

                // --- CREATE NEW LABEL -------------------------------------------------------
                const bounds = new mxRectangle(labelX, labelY, 1, 1); // CHANGE

                const txt = new mxText(
                    label,
                    bounds,
                    mxConstants.ALIGN_LEFT,
                    mxConstants.ALIGN_MIDDLE,
                    '#3c4043', // CHANGE
                    'Arial, Helvetica, sans-serif', // CHANGE
                    10, // CHANGE
                    mxConstants.FONT_BOLD, // CHANGE
                    6, // CHANGE
                    2, // CHANGE
                    6, // CHANGE
                    2, // CHANGE
                    6, // CHANGE
                    true, // CHANGE
                    '#ffffff', // CHANGE
                    entry.color || '#9aa0a6' // CHANGE
                );
                applyLinkOverlayBadgeStyle(txt, entry.color); // CHANGE
                txt.dialect = graph.dialect;
                txt.init(pane);
                txt.redraw();
                applyLinkOverlayBadgeStyle(txt, entry.color); // CHANGE

                if (txt.node) {
                    txt.node.__manualLinkMeta = {
                        srcId: entry.srcId,
                        trgId: entry.trgId
                    };
                    txt.node.style.pointerEvents = 'all';                        // ensure click
                    mxEvent.addListener(txt.node, 'mousedown', function (evt) {
                        const isLeft = (evt.button === 0); // CHANGE

                        if (isLeft) { // CHANGE
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
                        const isLeft = (evt.button === 0); // CHANGE

                        if (isLeft) { // CHANGE
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
         * - labelOffset: {x, y} screen-space stagger in pixels // NEW
         */
        function setLinkOverlay(a, b, exitHint, color, label, labelOffset) { // CHANGE
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
                    labelOffset: normalizeLabelOffset(labelOffset), // NEW
                    poly: null,
                    labelElt: null
                };
                registry.set(key, entry);
            } else {
                entry.exitHint = exitHint || null;
                entry.color = color || '#ff0000';
                entry.label = label || '';
                entry.labelOffset = normalizeLabelOffset(labelOffset); // NEW
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

    // -------------------- Linked Task Schedule Overlay Manager -------------------- // CHANGE
    // DOM-only task schedule panel plus mxPolyline guide lines; no model or undo changes. // CHANGE
    const taskScheduleOverlay = (function () { // CHANGE
        const MODE_CARDS = 'cards'; // CHANGE
        const MODE_SCHEDULE = 'schedule'; // CHANGE
        const MODE_OCCUPANCY = 'occupancy'; // NEW
        const PANEL_WIDTH = 380; // CHANGE
        const PANEL_GAP = 12; // CHANGE
        const PANEL_SIDE_OFFSET = 60; // CHANGE
        const BODY_MAX_HEIGHT = 360; // CHANGE
        const registry = new Map(); // sourceId -> entry // CHANGE
        const selectedYearBySource = new Map(); // sourceId -> session-only year // CHANGE
        const LANE_COLLAPSE_STORAGE_KEY = 'trellis.vertexLinker.taskOverlay.collapsedLanes.v1'; // CHANGE
        const laneCollapseState = new Map(); // laneKey -> collapsed boolean // CHANGE
        let laneCollapseLoaded = false; // CHANGE
        let activeMode = MODE_CARDS; // CHANGE

        function getOverlayPane() { // CHANGE
            const layeredPane = ensureGraphOverlaySvgLayer('connection'); // CHANGE
            if (layeredPane) return layeredPane; // CHANGE
            const view = graph.getView && graph.getView(); // CHANGE
            return view && view.getOverlayPane ? view.getOverlayPane() : null; // CHANGE
        } // CHANGE

        function getPanelHost() { // CHANGE
            const host = graph.container; // CHANGE
            if (!host) return null; // CHANGE
            try { // CHANGE
                if (window.getComputedStyle(host).position === 'static') { // CHANGE
                    host.style.position = 'relative'; // CHANGE
                } // CHANGE
            } catch (_) { } // CHANGE
            return host; // CHANGE
        } // CHANGE

        function getPanelLayer() { // NEW
            return ensureGraphOverlayHtmlLayer('control') || getPanelHost(); // NEW
        } // NEW

        function removeNode(node) { // CHANGE
            if (node && node.parentNode) node.parentNode.removeChild(node); // CHANGE
        } // CHANGE

        function removePolyline(poly) { // CHANGE
            if (poly && poly.node && poly.node.parentNode) { // CHANGE
                poly.node.parentNode.removeChild(poly.node); // CHANGE
            } // CHANGE
        } // CHANGE

        function loadLaneCollapseState() { // CHANGE
            if (laneCollapseLoaded) return; // CHANGE
            laneCollapseLoaded = true; // CHANGE
            try { // CHANGE
                const raw = window.localStorage && window.localStorage.getItem(LANE_COLLAPSE_STORAGE_KEY); // CHANGE
                const parsed = raw ? JSON.parse(raw) : null; // CHANGE
                if (!parsed || typeof parsed !== 'object') return; // CHANGE
                for (const key in parsed) { // CHANGE
                    if (Object.prototype.hasOwnProperty.call(parsed, key)) laneCollapseState.set(key, parsed[key] === true); // CHANGE
                } // CHANGE
            } catch (_) { } // CHANGE
        } // CHANGE

        function saveLaneCollapseState() { // CHANGE
            try { // CHANGE
                if (!window.localStorage) return; // CHANGE
                const out = {}; // CHANGE
                laneCollapseState.forEach((collapsed, key) => { out[key] = !!collapsed; }); // CHANGE
                window.localStorage.setItem(LANE_COLLAPSE_STORAGE_KEY, JSON.stringify(out)); // CHANGE
            } catch (_) { } // CHANGE
        } // CHANGE

        function laneCollapseKey(group) { // CHANGE
            return String(group && (group.laneKey || group.label || group.laneId) || 'UNLANED'); // CHANGE
        } // CHANGE

        function isLaneGroupCollapsed(group) { // CHANGE
            loadLaneCollapseState(); // CHANGE
            return laneCollapseState.get(laneCollapseKey(group)) === true; // CHANGE
        } // CHANGE

        function setLaneGroupCollapsed(group, collapsed) { // CHANGE
            loadLaneCollapseState(); // CHANGE
            laneCollapseState.set(laneCollapseKey(group), !!collapsed); // CHANGE
            saveLaneCollapseState(); // CHANGE
        } // CHANGE

        function normalizeBadgeText(text) { // CHANGE
            return stripHtmlAndPlaceholders(String(text || '')).trim(); // CHANGE
        } // CHANGE

        function isValidOverlayCard(card) { // CHANGE
            return !!card && model.isVertex(card) && isKanbanCard(card) && !!findKanbanBoardAncestor(card); // CHANGE
        } // CHANGE

        function taskTitle(card) { // CHANGE
            return getAttr(card, 'title') || getRawTextLabel(card) || card.id || 'Task'; // CHANGE
        } // CHANGE

        function getSourceCropTitle(source) { // CHANGE
            if (!source) return ''; // CHANGE
            const plant = normalizeBadgeText(getAttr(source, 'plant_name') || getAttr(source, 'crop_name') || ''); // CHANGE
            const variety = normalizeBadgeText(getAttr(source, 'variety_name') || getAttr(source, 'variety') || ''); // CHANGE
            if (plant && variety) return plant + ' - ' + variety; // CHANGE
            return plant || variety || normalizeBadgeText(getAttr(source, 'title') || getRawTextLabel(source)); // CHANGE
        } // CHANGE

        function getOverlayTitle(entry) { // CHANGE
            const source = entry && entry.sourceId ? model.getCell(entry.sourceId) : null; // CHANGE
            const cropTitle = getSourceCropTitle(source); // CHANGE
            return cropTitle ? 'Linked Task Schedule - ' + cropTitle : 'Linked Task Schedule'; // CHANGE
        } // CHANGE

        function getScheduleOnlyTitle(entry) { // ADDED
            const source = entry && entry.sourceId ? model.getCell(entry.sourceId) : null; // ADDED
            const cropTitle = getSourceCropTitle(source); // ADDED
            return cropTitle ? 'Plant Schedule - ' + cropTitle : 'Plant Schedule'; // ADDED
        } // ADDED

        function hasTilerSchedule(cell) { // ADDED
            const start = getAttr(cell, 'sow_date'); // ADDED
            return start != null && String(start).trim() !== ''; // ADDED
        } // ADDED

        function getOccupancyNavigatorApi() { // NEW
            return graph && graph.__trellisBedSuccessionNavigator && typeof graph.__trellisBedSuccessionNavigator.getSelectedClusterOccupancy === 'function' // NEW
                ? graph.__trellisBedSuccessionNavigator // NEW
                : null; // NEW
        } // NEW

        function getPlantingOccupancyRange(cell) { // NEW
            const start = parseTaskOverlayDate(getAttr(cell, 'transplant_date')) || parseTaskOverlayDate(getAttr(cell, 'sow_date')); // NEW
            const end = parseTaskOverlayDate(getAttr(cell, 'harvest_end')); // NEW
            if (!start || !end || end.dayNumber < start.dayNumber) return { startISO: null, endISO: null }; // NEW
            return { startISO: start.iso, endISO: end.iso }; // NEW
        } // NEW

        function fallbackOccupancyForSource(source) { // NEW
            if (!isTilerGroup(source)) return { selectedId: null, items: [] }; // NEW
            const range = getPlantingOccupancyRange(source); // NEW
            return { // NEW
                selectedId: source.id, // NEW
                items: [{ cellId: source.id, label: getSourceCropTitle(source) || source.id || 'Planting', startISO: range.startISO, endISO: range.endISO }] // NEW
            }; // NEW
        } // NEW

        function getOccupancyModelForEntry(entry) { // NEW
            const source = entry && entry.sourceId ? model.getCell(entry.sourceId) : null; // NEW
            const api = getOccupancyNavigatorApi(); // NEW
            if (api) { // NEW
                const result = api.getSelectedClusterOccupancy(source); // NEW
                if (result && Array.isArray(result.items) && result.items.length) return result; // NEW
            } // NEW
            return fallbackOccupancyForSource(source); // NEW
        } // NEW

        function getScheduleDialogOpener() { // ADDED
            return window.USL && window.USL.scheduler && typeof window.USL.scheduler.openScheduleDialog === 'function' // ADDED
                ? window.USL.scheduler.openScheduleDialog // ADDED
                : null; // ADDED
        } // ADDED

        function getSetPlantDialogOpener() { // ADDED
            return window.USL && window.USL.scheduler && typeof window.USL.scheduler.openSetPlantDialog === 'function' // ADDED
                ? window.USL.scheduler.openSetPlantDialog // ADDED
                : null; // ADDED
        } // ADDED

        function hasAssignedPlant(cell) { // ADDED
            const plantName = getAttr(cell, 'plant_name'); // ADDED
            return plantName != null && String(plantName).trim() !== ''; // ADDED
        } // ADDED

        function getTaskLinkLabelBadge(entry, card) { // CHANGE
            if (!entry || !entry.linkLabels || !card) return ''; // CHANGE
            const label = normalizeBadgeText(entry.linkLabels.get(card.id)); // CHANGE
            if (!label) return ''; // CHANGE
            const title = normalizeBadgeText(taskTitle(card)); // CHANGE
            return label.toLowerCase() === title.toLowerCase() ? '' : label; // CHANGE
        } // CHANGE

        function applyPanelStyle(panel) { // CHANGE
            panel.style.position = 'absolute'; // CHANGE
            panel.style.zIndex = String(GRAPH_OVERLAY_Z.CONTROL); // CHANGE
            panel.style.width = PANEL_WIDTH + 'px'; // CHANGE
            panel.style.boxSizing = 'border-box'; // CHANGE
            panel.style.padding = '8px'; // CHANGE
            panel.style.border = '1px solid rgba(60, 64, 67, 0.28)'; // CHANGE
            panel.style.borderRadius = '6px'; // CHANGE
            panel.style.background = 'rgba(255, 255, 255, 0.97)'; // CHANGE
            panel.style.boxShadow = '0 3px 10px rgba(0, 0, 0, 0.20)'; // CHANGE
            panel.style.fontFamily = 'Arial, Helvetica, sans-serif'; // CHANGE
            panel.style.fontSize = '11px'; // CHANGE
            panel.style.lineHeight = '16px'; // CHANGE
            panel.style.pointerEvents = 'all'; // CHANGE
            panel.style.color = '#202124'; // CHANGE
        } // CHANGE

        function makeTextSpan(text, color) { // CHANGE
            const span = document.createElement('span'); // CHANGE
            span.textContent = text || ''; // CHANGE
            span.style.overflow = 'hidden'; // CHANGE
            span.style.textOverflow = 'ellipsis'; // CHANGE
            span.style.whiteSpace = 'nowrap'; // CHANGE
            if (color) span.style.color = color; // CHANGE
            return span; // CHANGE
        } // CHANGE

        function makeClickableRow(card, className) { // CHANGE
            const row = document.createElement('div'); // CHANGE
            row.className = className || ''; // CHANGE
            row.setAttribute('title', 'Click to navigate to task'); // CHANGE
            const cardId = card.id; // CHANGE
            mxEvent.addListener(row, 'mousedown', function (evt) { // CHANGE
                if (evt.button != null && evt.button !== 0) return; // CHANGE
                const realCard = model.getCell(cardId); // CHANGE
                if (realCard && model.isVertex(realCard)) selectAndReveal(realCard); // CHANGE
                mxEvent.consume(evt); // CHANGE
                if (evt.stopPropagation) evt.stopPropagation(); // CHANGE
                if (evt.preventDefault) evt.preventDefault(); // CHANGE
            }); // CHANGE
            return row; // CHANGE
        } // CHANGE

        function makeBadge(text) { // CHANGE
            const badge = document.createElement('span'); // CHANGE
            badge.textContent = text; // CHANGE
            badge.style.display = 'inline-block'; // CHANGE
            badge.style.maxWidth = '150px'; // CHANGE
            badge.style.overflow = 'hidden'; // CHANGE
            badge.style.textOverflow = 'ellipsis'; // CHANGE
            badge.style.whiteSpace = 'nowrap'; // CHANGE
            badge.style.padding = '1px 6px'; // CHANGE
            badge.style.border = '1px solid rgba(60, 64, 67, 0.25)'; // CHANGE
            badge.style.borderRadius = '10px'; // CHANGE
            badge.style.background = '#f8f9fa'; // CHANGE
            badge.style.color = '#3c4043'; // CHANGE
            badge.style.fontSize = '10px'; // CHANGE
            badge.style.lineHeight = '14px'; // CHANGE
            return badge; // CHANGE
        } // CHANGE

        function makeYearControlButton(text, disabled) { // CHANGE
            const button = document.createElement('button'); // CHANGE
            button.type = 'button'; // CHANGE
            button.textContent = text; // CHANGE
            button.disabled = !!disabled; // CHANGE
            button.style.width = '24px'; // CHANGE
            button.style.height = '22px'; // CHANGE
            button.style.border = '1px solid rgba(60, 64, 67, 0.28)'; // CHANGE
            button.style.borderRadius = '5px'; // CHANGE
            button.style.background = disabled ? '#f1f3f4' : '#ffffff'; // CHANGE
            button.style.color = disabled ? '#9aa0a6' : '#202124'; // CHANGE
            button.style.cursor = disabled ? 'default' : 'pointer'; // CHANGE
            button.style.padding = '0'; // CHANGE
            button.style.lineHeight = '18px'; // CHANGE
            return button; // CHANGE
        } // CHANGE

        function consumeOverlayControlEvent(evt) { // ADDED
            try { mxEvent.consume(evt); } catch (_) { } // ADDED
            if (evt && evt.stopPropagation) evt.stopPropagation(); // ADDED
            if (evt && evt.preventDefault) evt.preventDefault(); // ADDED
        } // ADDED

        function createScheduleActionButton(entry) { // ADDED
            const source = entry && entry.sourceId ? model.getCell(entry.sourceId) : null; // ADDED
            if (!isTilerGroup(source)) return null; // ADDED
            const opener = getScheduleDialogOpener(); // ADDED
            const button = document.createElement('button'); // ADDED
            button.type = 'button'; // ADDED
            button.textContent = hasTilerSchedule(source) ? 'Edit schedule' : 'Set schedule'; // ADDED
            button.title = opener ? button.textContent : 'Scheduler plugin is unavailable.'; // ADDED
            button.disabled = !opener; // ADDED
            button.style.border = '1px solid #2563eb'; // ADDED
            button.style.borderRadius = '5px'; // ADDED
            button.style.background = opener ? '#ffffff' : '#f1f3f4'; // ADDED
            button.style.color = opener ? '#1d4ed8' : '#9aa0a6'; // ADDED
            button.style.cursor = opener ? 'pointer' : 'default'; // ADDED
            button.style.fontSize = '10px'; // ADDED
            button.style.fontWeight = 'bold'; // ADDED
            button.style.padding = '4px 7px'; // ADDED
            button.style.whiteSpace = 'nowrap'; // ADDED
            mxEvent.addListener(button, 'mousedown', consumeOverlayControlEvent); // ADDED
            mxEvent.addListener(button, 'dblclick', consumeOverlayControlEvent); // ADDED
            mxEvent.addListener(button, 'click', async function (evt) { // ADDED
                consumeOverlayControlEvent(evt); // ADDED
                if (!opener) return; // ADDED
                const liveSource = model.getCell(entry.sourceId); // ADDED
                if (!isTilerGroup(liveSource)) return; // ADDED
                try { // ADDED
                    await opener(ui, liveSource); // ADDED
                    setTimeout(refresh, 0); // ADDED
                } catch (e) { // ADDED
                    mxUtils.alert('Scheduling error: ' + (e && e.message ? e.message : String(e))); // ADDED
                } // ADDED
            }); // ADDED
            return button; // ADDED
        } // ADDED

        function createSetPlantActionButton(entry) { // ADDED
            const source = entry && entry.sourceId ? model.getCell(entry.sourceId) : null; // ADDED
            if (!isTilerGroup(source) || hasAssignedPlant(source)) return null; // ADDED
            const opener = getSetPlantDialogOpener(); // ADDED
            const button = document.createElement('button'); // ADDED
            button.type = 'button'; // ADDED
            button.textContent = 'Set plant'; // ADDED
            button.title = opener ? 'Set plant' : 'Scheduler plant picker is unavailable.'; // ADDED
            button.disabled = !opener; // ADDED
            button.style.border = '1px solid #188038'; // ADDED
            button.style.borderRadius = '5px'; // ADDED
            button.style.background = opener ? '#ffffff' : '#f1f3f4'; // ADDED
            button.style.color = opener ? '#137333' : '#9aa0a6'; // ADDED
            button.style.cursor = opener ? 'pointer' : 'default'; // ADDED
            button.style.fontSize = '10px'; // ADDED
            button.style.fontWeight = 'bold'; // ADDED
            button.style.padding = '4px 7px'; // ADDED
            button.style.whiteSpace = 'nowrap'; // ADDED
            mxEvent.addListener(button, 'mousedown', consumeOverlayControlEvent); // ADDED
            mxEvent.addListener(button, 'dblclick', consumeOverlayControlEvent); // ADDED
            mxEvent.addListener(button, 'click', async function (evt) { // ADDED
                consumeOverlayControlEvent(evt); // ADDED
                if (!opener) return; // ADDED
                const liveSource = model.getCell(entry.sourceId); // ADDED
                if (!isTilerGroup(liveSource) || hasAssignedPlant(liveSource)) return; // ADDED
                try { // ADDED
                    await opener(ui, liveSource); // ADDED
                    setTimeout(refresh, 0); // ADDED
                } catch (e) { // ADDED
                    mxUtils.alert('Set Plant error: ' + (e && e.message ? e.message : String(e))); // ADDED
                } // ADDED
            }); // ADDED
            return button; // ADDED
        } // ADDED

        function createSecondaryActionRow(entry) { // ADDED
            const setPlantButton = createSetPlantActionButton(entry); // ADDED
            if (!setPlantButton) return null; // ADDED
            const row = document.createElement('div'); // ADDED
            row.style.gridColumn = '1 / span 2'; // ADDED
            row.style.display = 'flex'; // ADDED
            row.style.justifyContent = 'flex-end'; // ADDED
            row.style.marginTop = '7px'; // ADDED
            row.appendChild(setPlantButton); // ADDED
            return row; // ADDED
        } // ADDED

        function applyOverlayYearFilter(entry, year) { // CHANGE
            if (!entry || !Number.isFinite(Number(year))) return; // CHANGE
            const selectedYear = Number(year); // CHANGE
            const cards = entry.targetIds.map(id => model.getCell(id)).filter(isValidOverlayCard); // CHANGE
            model.beginUpdate(); // CHANGE
            try { // CHANGE
                for (const card of cards) { // CHANGE
                    const hidden = !taskDateRangeOverlapsYear(card, selectedYear); // CHANGE
                    const nextValue = hidden ? '1' : null; // CHANGE
                    if (getAttr(card, 'year_hidden') !== (nextValue || null)) setCellAttrUndoable(card, 'year_hidden', nextValue); // CHANGE
                } // CHANGE
            } finally { // CHANGE
                model.endUpdate(); // CHANGE
            } // CHANGE
            entry.selectedYear = selectedYear; // CHANGE
            selectedYearBySource.set(entry.sourceId, selectedYear); // CHANGE
            dispatchYearFilterChangedForTaskOverlay(null, selectedYear); // CHANGE
            renderEntry(entry); // CHANGE
        } // CHANGE

        function restoreEntryTasksToCurrentYear(entry) { // CHANGE
            if (!entry || !entry.targetIds) return; // CHANGE
            const cards = entry.targetIds.map(id => model.getCell(id)).filter(isValidOverlayCard); // CHANGE
            if (!cards.length) return; // CHANGE
            const source = model.getCell(entry.sourceId); // CHANGE
            const restoreYear = getDashboardYearForCell(source || cards[0]); // CHANGE
            if (Number(entry.selectedYear) === restoreYear) return; // CHANGE
            model.beginUpdate(); // CHANGE
            try { // CHANGE
                for (const card of cards) { // CHANGE
                    const hidden = !taskDateRangeOverlapsYear(card, restoreYear); // CHANGE
                    const nextValue = hidden ? '1' : null; // CHANGE
                    if (getAttr(card, 'year_hidden') !== (nextValue || null)) setCellAttrUndoable(card, 'year_hidden', nextValue); // CHANGE
                } // CHANGE
            } finally { // CHANGE
                model.endUpdate(); // CHANGE
            } // CHANGE
            selectedYearBySource.delete(entry.sourceId); // CHANGE
            dispatchYearFilterChangedForTaskOverlay(null, restoreYear); // CHANGE
        } // CHANGE

        function isEntryStillSelected(entry) { // CHANGE
            const selected = graph.getSelectionCells && graph.getSelectionCells(); // CHANGE
            if (!entry || !selected || selected.length !== 1) return false; // CHANGE
            const selectedCell = normalizeForLinkingAndPrimary(selected[0]); // CHANGE
            return !!selectedCell && selectedCell.id === entry.sourceId; // CHANGE
        } // CHANGE

        function createYearControls(entry) { // CHANGE
            const years = entry && entry.years ? entry.years : []; // CHANGE
            if (years.length < 2) return null; // CHANGE
            const current = Number(entry.selectedYear); // CHANGE
            const idx = Math.max(0, years.indexOf(current)); // CHANGE
            const wrap = document.createElement('div'); // CHANGE
            wrap.style.gridColumn = '1 / span 2'; // CHANGE
            wrap.style.display = 'flex'; // CHANGE
            wrap.style.alignItems = 'center'; // CHANGE
            wrap.style.gap = '5px'; // CHANGE
            wrap.style.marginTop = '7px'; // CHANGE

            const prev = makeYearControlButton('<', idx <= 0); // CHANGE
            const label = document.createElement('div'); // CHANGE
            label.textContent = String(years[idx] || current || years[0]); // CHANGE
            label.style.minWidth = '48px'; // CHANGE
            label.style.textAlign = 'center'; // CHANGE
            label.style.border = '1px solid rgba(60, 64, 67, 0.28)'; // CHANGE
            label.style.borderRadius = '5px'; // CHANGE
            label.style.background = '#ffffff'; // CHANGE
            label.style.fontWeight = 'bold'; // CHANGE
            label.style.fontSize = '10px'; // CHANGE
            label.style.lineHeight = '20px'; // CHANGE
            const next = makeYearControlButton('>', idx >= years.length - 1); // CHANGE

            mxEvent.addListener(prev, 'mousedown', function (evt) { // CHANGE
                if (idx > 0) applyOverlayYearFilter(entry, years[idx - 1]); // CHANGE
                mxEvent.consume(evt); // CHANGE
                if (evt.stopPropagation) evt.stopPropagation(); // CHANGE
                if (evt.preventDefault) evt.preventDefault(); // CHANGE
            }); // CHANGE
            mxEvent.addListener(next, 'mousedown', function (evt) { // CHANGE
                if (idx < years.length - 1) applyOverlayYearFilter(entry, years[idx + 1]); // CHANGE
                mxEvent.consume(evt); // CHANGE
                if (evt.stopPropagation) evt.stopPropagation(); // CHANGE
                if (evt.preventDefault) evt.preventDefault(); // CHANGE
            }); // CHANGE

            wrap.appendChild(prev); // CHANGE
            wrap.appendChild(label); // CHANGE
            wrap.appendChild(next); // CHANGE
            return wrap; // CHANGE
        } // CHANGE

        function createHeader(entry, count) { // CHANGE
            const header = document.createElement('div'); // CHANGE
            header.style.display = 'grid'; // CHANGE
            header.style.gridTemplateColumns = '1fr auto'; // CHANGE
            header.style.alignItems = 'center'; // CHANGE
            header.style.columnGap = '8px'; // CHANGE
            header.style.marginBottom = '8px'; // CHANGE

            const titleWrap = document.createElement('div'); // CHANGE
            const title = document.createElement('div'); // CHANGE
            title.textContent = getOverlayTitle(entry); // CHANGE
            title.style.fontWeight = 'bold'; // CHANGE
            title.style.fontSize = '12px'; // CHANGE
            title.style.overflow = 'hidden'; // CHANGE
            title.style.textOverflow = 'ellipsis'; // CHANGE
            title.style.whiteSpace = 'nowrap'; // CHANGE
            const subtitle = document.createElement('div'); // CHANGE
            subtitle.textContent = activeMode === MODE_OCCUPANCY ? (count + (count === 1 ? ' planting group' : ' planting groups')) : (count + (count === 1 ? ' linked task' : ' linked tasks')); // CHANGE
            subtitle.style.color = '#5f6368'; // CHANGE
            subtitle.style.fontSize = '10px'; // CHANGE
            titleWrap.appendChild(title); // CHANGE
            titleWrap.appendChild(subtitle); // CHANGE
            header.appendChild(titleWrap); // CHANGE

            const actions = document.createElement('div'); // ADDED
            actions.style.display = 'inline-flex'; // ADDED
            actions.style.alignItems = 'center'; // ADDED
            actions.style.gap = '6px'; // ADDED
            actions.style.flexWrap = 'wrap'; // ADDED
            actions.style.justifyContent = 'flex-end'; // ADDED

            const toggle = document.createElement('div'); // CHANGE
            toggle.style.display = 'inline-flex'; // CHANGE
            toggle.style.border = '1px solid rgba(60, 64, 67, 0.28)'; // CHANGE
            toggle.style.borderRadius = '5px'; // CHANGE
            toggle.style.overflow = 'hidden'; // CHANGE
            toggle.appendChild(createModeButton(entry, 'Cards', MODE_CARDS)); // CHANGE
            toggle.appendChild(createModeButton(entry, 'Schedule', MODE_SCHEDULE)); // CHANGE
            toggle.appendChild(createModeButton(entry, 'Occupancy', MODE_OCCUPANCY)); // NEW
            actions.appendChild(toggle); // CHANGED
            const scheduleButton = createScheduleActionButton(entry); // ADDED
            if (scheduleButton) actions.appendChild(scheduleButton); // ADDED
            header.appendChild(actions); // ADDED
            const secondaryActionRow = createSecondaryActionRow(entry); // ADDED
            if (secondaryActionRow) header.appendChild(secondaryActionRow); // ADDED
            const yearControls = createYearControls(entry); // CHANGE
            if (yearControls) header.appendChild(yearControls); // CHANGE
            return header; // CHANGE
        } // CHANGE

        function createScheduleOnlyHeader(entry) { // ADDED
            const header = document.createElement('div'); // ADDED
            header.style.display = 'flex'; // CHANGED
            header.style.flexDirection = 'column'; // ADDED
            header.style.alignItems = 'stretch'; // CHANGED
            header.style.gap = '7px'; // ADDED

            const title = document.createElement('div'); // ADDED
            title.textContent = getScheduleOnlyTitle(entry); // ADDED
            title.style.fontWeight = 'bold'; // ADDED
            title.style.fontSize = '12px'; // ADDED
            title.style.overflow = 'hidden'; // ADDED
            title.style.textOverflow = 'ellipsis'; // ADDED
            title.style.whiteSpace = 'nowrap'; // ADDED
            header.appendChild(title); // ADDED

            const toggle = document.createElement('div'); // NEW
            toggle.style.display = 'inline-flex'; // NEW
            toggle.style.alignSelf = 'flex-start'; // NEW
            toggle.style.border = '1px solid rgba(60, 64, 67, 0.28)'; // NEW
            toggle.style.borderRadius = '5px'; // NEW
            toggle.style.overflow = 'hidden'; // NEW
            const effectiveMode = activeMode === MODE_OCCUPANCY ? MODE_OCCUPANCY : MODE_SCHEDULE; // NEW
            toggle.appendChild(createModeButton(entry, 'Schedule', MODE_SCHEDULE, effectiveMode)); // NEW
            toggle.appendChild(createModeButton(entry, 'Occupancy', MODE_OCCUPANCY, effectiveMode)); // NEW
            header.appendChild(toggle); // NEW

            const scheduleButton = createScheduleActionButton(entry); // ADDED
            if (scheduleButton) { // ADDED
                scheduleButton.style.alignSelf = 'flex-start'; // ADDED
                header.appendChild(scheduleButton); // ADDED
            } // ADDED
            const setPlantButton = createSetPlantActionButton(entry); // ADDED
            if (setPlantButton) { // ADDED
                setPlantButton.style.alignSelf = 'flex-start'; // ADDED
                header.appendChild(setPlantButton); // ADDED
            } // ADDED
            return header; // ADDED
        } // ADDED

        function createModeButton(entry, label, mode, activeOverride) { // CHANGE
            const button = document.createElement('button'); // CHANGE
            button.type = 'button'; // CHANGE
            button.textContent = label; // CHANGE
            button.style.border = '0'; // CHANGE
            button.style.padding = '4px 7px'; // CHANGE
            button.style.fontSize = '10px'; // CHANGE
            button.style.cursor = 'pointer'; // CHANGE
            const active = (activeOverride || activeMode) === mode; // NEW
            button.style.background = active ? '#202124' : '#ffffff'; // CHANGE
            button.style.color = active ? '#ffffff' : '#202124'; // CHANGE
            mxEvent.addListener(button, 'mousedown', function (evt) { // CHANGE
                setMode(mode); // CHANGE
                mxEvent.consume(evt); // CHANGE
                if (evt.stopPropagation) evt.stopPropagation(); // CHANGE
                if (evt.preventDefault) evt.preventDefault(); // CHANGE
            }); // CHANGE
            return button; // CHANGE
        } // CHANGE

        function createBody() { // CHANGE
            const body = document.createElement('div'); // CHANGE
            body.style.maxHeight = BODY_MAX_HEIGHT + 'px'; // CHANGE
            body.style.overflowY = 'auto'; // CHANGE
            body.style.overflowX = 'hidden'; // CHANGE
            body.style.paddingRight = '2px'; // CHANGE
            return body; // CHANGE
        } // CHANGE

        function renderEmptyTaskOverlayMessage(body) { // CHANGE
            const empty = document.createElement('div'); // CHANGE
            empty.textContent = 'No linked tasks visible for this year'; // CHANGE
            empty.style.color = '#5f6368'; // CHANGE
            empty.style.padding = '8px 0'; // CHANGE
            body.appendChild(empty); // CHANGE
        } // CHANGE

        function countGroupItems(groups) { // CHANGE
            return (groups || []).reduce((sum, group) => sum + group.items.length, 0); // CHANGE
        } // CHANGE

        function countScheduleRows(cards) { // CHANGE
            return buildScheduleRowsForCards(cards).length; // CHANGE
        } // CHANGE

        function countOccupancyRows(entry) { // NEW
            const occupancy = getOccupancyModelForEntry(entry); // NEW
            return occupancy && Array.isArray(occupancy.items) ? occupancy.items.length : 0; // NEW
        } // NEW

        function todayOverlayDayNumber() { // CHANGE
            const now = new Date(); // CHANGE
            return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000); // CHANGE
        } // CHANGE

        function firstScheduledCard(cards) { // CHANGE
            return (cards || []).slice().sort(compareRepeatOccurrenceCards).find(card => !!getTaskDateRange(card)) || (cards && cards[0]) || null; // CHANGE
        } // CHANGE

        function buildScheduleRowsForCards(cards) { // CHANGE
            const rows = []; // CHANGE
            const repeatRows = new Map(); // CHANGE

            for (const card of cards || []) { // CHANGE
                const seriesKey = buildRepeatSeriesKeyForOverlay(card); // CHANGE
                if (!seriesKey) { // CHANGE
                    rows.push({ // CHANGE
                        key: 'card:' + card.id, // CHANGE
                        card, // CHANGE
                        cards: [card], // CHANGE
                        label: taskTitle(card), // CHANGE
                        repeat: false // CHANGE
                    }); // CHANGE
                    continue; // CHANGE
                } // CHANGE

                if (!repeatRows.has(seriesKey)) { // CHANGE
                    repeatRows.set(seriesKey, { // CHANGE
                        key: 'repeat:' + seriesKey, // CHANGE
                        card, // CHANGE
                        cards: [], // CHANGE
                        label: taskTitle(card), // CHANGE
                        repeat: true // CHANGE
                    }); // CHANGE
                } // CHANGE
                repeatRows.get(seriesKey).cards.push(card); // CHANGE
            } // CHANGE

            for (const row of repeatRows.values()) { // CHANGE
                row.cards.sort(compareRepeatOccurrenceCards); // CHANGE
                row.card = firstScheduledCard(row.cards) || row.cards[0]; // CHANGE
                row.label = taskTitle(row.card); // CHANGE
                rows.push(row); // CHANGE
            } // CHANGE

            rows.sort((a, b) => compareTaskCardsByStartDate(a.card, b.card)); // CHANGE
            return rows; // CHANGE
        } // CHANGE

        function createLaneHeader(entry, group, collapsed) { // CHANGE
            const header = document.createElement('div'); // CHANGE
            header.style.display = 'grid'; // CHANGE
            header.style.gridTemplateColumns = '21px 6px 1fr auto'; // CHANGE
            header.style.alignItems = 'center'; // CHANGE
            header.style.columnGap = '6px'; // CHANGE
            header.style.margin = '8px 0 3px'; // CHANGE
            header.style.color = '#3c4043'; // CHANGE
            header.style.fontWeight = 'bold'; // CHANGE
            header.style.fontSize = '10px'; // CHANGE
            header.style.cursor = 'pointer'; // CHANGE
            header.setAttribute('title', collapsed ? 'Expand lane' : 'Collapse lane'); // CHANGE

            const toggle = document.createElement('span'); // CHANGE
            toggle.textContent = collapsed ? '+' : '-'; // CHANGE
            toggle.style.display = 'inline-block'; // CHANGE
            toggle.style.width = '21px'; // CHANGE
            toggle.style.textAlign = 'center'; // CHANGE
            toggle.style.color = '#5f6368'; // CHANGE
            toggle.style.fontSize = '15px'; // CHANGE
            toggle.style.lineHeight = '14px'; // CHANGE
            header.appendChild(toggle); // CHANGE

            const stripe = document.createElement('span'); // CHANGE
            stripe.style.height = '12px'; // CHANGE
            stripe.style.borderRadius = '4px'; // CHANGE
            stripe.style.background = group.color || '#9aa0a6'; // CHANGE
            header.appendChild(stripe); // CHANGE

            header.appendChild(makeTextSpan(group.label || 'Lane', null)); // CHANGE
            const count = document.createElement('span'); // CHANGE
            count.textContent = String(group.items.length); // CHANGE
            count.style.color = '#5f6368'; // CHANGE
            count.style.fontWeight = 'normal'; // CHANGE
            header.appendChild(count); // CHANGE
            mxEvent.addListener(header, 'mousedown', function (evt) { // CHANGE
                if (evt.button != null && evt.button !== 0) return; // CHANGE
                setLaneGroupCollapsed(group, !isLaneGroupCollapsed(group)); // CHANGE
                renderEntry(entry); // CHANGE
                mxEvent.consume(evt); // CHANGE
                if (evt.stopPropagation) evt.stopPropagation(); // CHANGE
                if (evt.preventDefault) evt.preventDefault(); // CHANGE
            }); // CHANGE
            return header; // CHANGE
        } // CHANGE

        function renderCardView(entry, body, groups) { // CHANGE
            for (const group of groups) { // CHANGE
                const collapsed = isLaneGroupCollapsed(group); // CHANGE
                body.appendChild(createLaneHeader(entry, group, collapsed)); // CHANGE
                if (collapsed) continue; // CHANGE
                for (const item of group.items) { // CHANGE
                    const card = item.card; // CHANGE
                const row = makeClickableRow(card, 'manual-link-task-schedule-card'); // CHANGE
                row.style.display = 'grid'; // CHANGE
                row.style.gridTemplateColumns = '6px 1fr'; // CHANGE
                row.style.columnGap = '8px'; // CHANGE
                row.style.margin = '4px 0'; // CHANGE
                row.style.border = '1px solid rgba(60, 64, 67, 0.18)'; // CHANGE
                row.style.borderRadius = '5px'; // CHANGE
                row.style.background = '#ffffff'; // CHANGE
                row.style.cursor = 'pointer'; // CHANGE
                row.style.overflow = 'hidden'; // CHANGE

                const stripe = document.createElement('div'); // CHANGE
                stripe.style.background = getTaskLaneColor(card); // CHANGE
                row.appendChild(stripe); // CHANGE

                const content = document.createElement('div'); // CHANGE
                content.style.minWidth = '0'; // CHANGE
                content.style.padding = '6px 7px 6px 0'; // CHANGE

                const titleLine = makeTextSpan(taskTitle(card), null); // CHANGE
                titleLine.style.display = 'block'; // CHANGE
                titleLine.style.fontWeight = 'bold'; // CHANGE
                titleLine.style.fontSize = '12px'; // CHANGE
                content.appendChild(titleLine); // CHANGE

                const metaLine = makeTextSpan(formatTaskDateRange(card), '#5f6368'); // CHANGE
                metaLine.style.display = 'block'; // CHANGE
                metaLine.style.fontSize = '10px'; // CHANGE
                content.appendChild(metaLine); // CHANGE

                    let badges = getTaskOverlayBadges(card); // CHANGE
                    const linkLabelBadge = getTaskLinkLabelBadge(entry, card); // CHANGE
                    if (linkLabelBadge) badges.unshift(linkLabelBadge); // CHANGE
                    if (item.repeatBadge) { // CHANGE
                        badges = badges.filter(text => !String(text || '').startsWith('Repeat ')); // CHANGE
                        badges.unshift('Repeat ' + item.repeatBadge); // CHANGE
                    } // CHANGE
                    const visibleBadges = badges.slice(0, 4); // CHANGE
                    if (visibleBadges.length) { // CHANGE
                    const badgeRow = document.createElement('div'); // CHANGE
                    badgeRow.style.display = 'flex'; // CHANGE
                    badgeRow.style.flexWrap = 'wrap'; // CHANGE
                    badgeRow.style.gap = '3px'; // CHANGE
                    badgeRow.style.marginTop = '4px'; // CHANGE
                        for (const badge of visibleBadges) badgeRow.appendChild(makeBadge(badge)); // CHANGE
                    content.appendChild(badgeRow); // CHANGE
                } // CHANGE

                row.appendChild(content); // CHANGE
                body.appendChild(row); // CHANGE
                entry.visibleItems.push({ cardId: card.id, row }); // CHANGE
                } // CHANGE
            } // CHANGE
        } // CHANGE

        function axisLabelForDay(dayNumber) { // CHANGE
            const date = new Date(dayNumber * 86400000); // CHANGE
            return formatTaskOverlayDate({ date }); // CHANGE
        } // CHANGE

        function renderScheduleAxis(grid, minDay, maxDay, todayPct, leftHeaderText = 'Task') { // CHANGE
            const axis = document.createElement('div'); // CHANGE
            axis.style.display = 'grid'; // CHANGE
            axis.style.gridTemplateColumns = '112px 1fr'; // CHANGE
            axis.style.columnGap = '8px'; // CHANGE
            axis.style.alignItems = 'end'; // CHANGE
            axis.style.marginBottom = '4px'; // CHANGE

            const taskHead = document.createElement('div'); // CHANGE
            taskHead.textContent = leftHeaderText; // CHANGE
            taskHead.style.color = '#5f6368'; // CHANGE
            taskHead.style.fontSize = '10px'; // CHANGE
            axis.appendChild(taskHead); // CHANGE

            const ticks = document.createElement('div'); // CHANGE
            ticks.style.display = 'grid'; // CHANGE
            ticks.style.gridTemplateColumns = 'repeat(4, 1fr)'; // CHANGE
            ticks.style.color = '#5f6368'; // CHANGE
            ticks.style.fontSize = '10px'; // CHANGE
            ticks.style.position = 'relative'; // CHANGE
            ticks.appendChild(makeTextSpan(axisLabelForDay(minDay), null)); // CHANGE
            ticks.appendChild(makeTextSpan(axisLabelForDay(Math.round(minDay + (maxDay - minDay) / 3)), null)); // CHANGE
            ticks.appendChild(makeTextSpan(axisLabelForDay(Math.round(minDay + 2 * (maxDay - minDay) / 3)), null)); // CHANGE
            const end = makeTextSpan(axisLabelForDay(maxDay), null); // CHANGE
            end.style.textAlign = 'right'; // CHANGE
            ticks.appendChild(end); // CHANGE
            if (todayPct != null) { // CHANGE
                const today = document.createElement('span'); // CHANGE
                today.textContent = 'Today'; // CHANGE
                today.style.position = 'absolute'; // CHANGE
                today.style.left = todayPct + '%'; // CHANGE
                today.style.top = '-12px'; // CHANGE
                today.style.transform = 'translateX(-50%)'; // CHANGE
                today.style.color = '#b91c1c'; // CHANGE
                today.style.fontWeight = 'bold'; // CHANGE
                ticks.appendChild(today); // CHANGE
            } // CHANGE
            axis.appendChild(ticks); // CHANGE
            grid.appendChild(axis); // CHANGE
        } // CHANGE

        function renderScheduleBar(track, card, range, minDay, totalDays) { // CHANGE
            const bar = document.createElement('div'); // CHANGE
            const leftPct = Math.max(0, Math.min(98, ((range.startDay - minDay) / totalDays) * 100)); // CHANGE
            const rawWidthPct = range.startDay === range.endDay ? 2 : ((range.endDay - range.startDay + 1) / totalDays) * 100; // CHANGE
            const widthPct = Math.max(range.startDay === range.endDay ? 2 : 3, rawWidthPct); // CHANGE
            bar.style.position = 'absolute'; // CHANGE
            bar.style.left = leftPct + '%'; // CHANGE
            bar.style.top = '5px'; // CHANGE
            bar.style.width = Math.min(100 - leftPct, widthPct) + '%'; // CHANGE
            bar.style.height = range.startDay === range.endDay ? '8px' : '9px'; // CHANGE
            bar.style.borderRadius = range.startDay === range.endDay ? '999px' : '4px'; // CHANGE
            bar.style.background = getTaskLaneColor(card); // CHANGE
            track.appendChild(bar); // CHANGE
        } // CHANGE

        function occupancyRangeForItem(item) { // NEW
            const start = parseTaskOverlayDate(item && item.startISO); // NEW
            const end = parseTaskOverlayDate(item && item.endISO); // NEW
            if (!start || !end || end.dayNumber < start.dayNumber) return null; // NEW
            return { start, end, startDay: start.dayNumber, endDay: end.dayNumber, durationDays: end.dayNumber - start.dayNumber + 1 }; // NEW
        } // NEW

        function renderOccupancyBar(track, range, selected, minDay, totalDays) { // NEW
            const bar = document.createElement('div'); // NEW
            const leftPct = Math.max(0, Math.min(98, ((range.startDay - minDay) / totalDays) * 100)); // NEW
            const rawWidthPct = range.startDay === range.endDay ? 2 : ((range.endDay - range.startDay + 1) / totalDays) * 100; // NEW
            const widthPct = Math.max(range.startDay === range.endDay ? 2 : 3, rawWidthPct); // NEW
            bar.style.position = 'absolute'; // NEW
            bar.style.left = leftPct + '%'; // NEW
            bar.style.top = '5px'; // NEW
            bar.style.width = Math.min(100 - leftPct, widthPct) + '%'; // NEW
            bar.style.height = range.startDay === range.endDay ? '8px' : '9px'; // NEW
            bar.style.borderRadius = range.startDay === range.endDay ? '999px' : '4px'; // NEW
            bar.style.background = selected ? '#137333' : '#188038'; // NEW
            bar.style.opacity = selected ? '1' : '0.72'; // NEW
            track.appendChild(bar); // NEW
        } // NEW

        function makeOccupancyRow(entry, item) { // NEW
            const row = document.createElement('div'); // NEW
            row.className = 'manual-link-task-occupancy-row'; // NEW
            row.setAttribute('title', 'Click to select planting group'); // NEW
            mxEvent.addListener(row, 'mousedown', function (evt) { // NEW
                if (evt.button != null && evt.button !== 0) return; // NEW
                const cell = item && item.cellId ? model.getCell(item.cellId) : null; // NEW
                if (cell && model.isVertex(cell)) selectAndReveal(cell); // NEW
                mxEvent.consume(evt); // NEW
                if (evt.stopPropagation) evt.stopPropagation(); // NEW
                if (evt.preventDefault) evt.preventDefault(); // NEW
            }); // NEW
            return row; // NEW
        } // NEW

        function renderOccupancyRow(entry, grid, item, range, minDay, totalDays, todayPct) { // NEW
            const selected = item && item.cellId === entry.sourceId; // NEW
            const row = makeOccupancyRow(entry, item); // NEW
            row.style.display = 'grid'; // NEW
            row.style.gridTemplateColumns = '112px 1fr'; // NEW
            row.style.columnGap = '8px'; // NEW
            row.style.alignItems = 'center'; // NEW
            row.style.minHeight = '24px'; // NEW
            row.style.cursor = 'pointer'; // NEW
            row.style.fontWeight = selected ? 'bold' : 'normal'; // NEW

            const labelCell = document.createElement('div'); // NEW
            labelCell.style.minWidth = '0'; // NEW
            const label = makeTextSpan(item.label || item.cellId || 'Planting', null); // NEW
            label.style.fontSize = '10px'; // NEW
            labelCell.appendChild(label); // NEW
            row.appendChild(labelCell); // NEW

            const track = document.createElement('div'); // NEW
            track.style.position = 'relative'; // NEW
            track.style.height = '18px'; // NEW
            track.style.borderBottom = '1px solid #e8eaed'; // NEW
            if (todayPct != null) { // NEW
                const todayLine = document.createElement('div'); // NEW
                todayLine.style.position = 'absolute'; // NEW
                todayLine.style.left = todayPct + '%'; // NEW
                todayLine.style.top = '0'; // NEW
                todayLine.style.bottom = '0'; // NEW
                todayLine.style.width = '1px'; // NEW
                todayLine.style.background = '#b91c1c'; // NEW
                todayLine.style.opacity = '0.75'; // NEW
                track.appendChild(todayLine); // NEW
            } // NEW
            renderOccupancyBar(track, range, selected, minDay, totalDays); // NEW
            row.appendChild(track); // NEW
            grid.appendChild(row); // NEW
        } // NEW

        function renderScheduleRow(entry, grid, scheduleRow, minDay, totalDays, todayPct) { // CHANGE
            const card = scheduleRow.card; // CHANGE
            const row = makeClickableRow(card, 'manual-link-task-schedule-row'); // CHANGE
            row.style.display = 'grid'; // CHANGE
            row.style.gridTemplateColumns = '112px 1fr'; // CHANGE
            row.style.columnGap = '8px'; // CHANGE
            row.style.alignItems = 'center'; // CHANGE
            row.style.minHeight = '24px'; // CHANGE
            row.style.cursor = 'pointer'; // CHANGE

            const labelCell = document.createElement('div'); // CHANGE
            labelCell.style.minWidth = '0'; // CHANGE
            const label = makeTextSpan(scheduleRow.label, null); // CHANGE
            label.style.fontSize = '10px'; // CHANGE
            if (scheduleRow.repeat && scheduleRow.cards.length > 1) { // CHANGE
                label.textContent = scheduleRow.label + ' (' + scheduleRow.cards.length + ')'; // CHANGE
            } // CHANGE
            labelCell.appendChild(label); // CHANGE

            const scheduleBadge = getTaskLinkLabelBadge(entry, card); // CHANGE
            if (scheduleBadge) { // CHANGE
                const badgeWrap = document.createElement('div'); // CHANGE
                badgeWrap.style.marginTop = '2px'; // CHANGE
                badgeWrap.appendChild(makeBadge(scheduleBadge)); // CHANGE
                labelCell.appendChild(badgeWrap); // CHANGE
            } // CHANGE
            row.appendChild(labelCell); // CHANGE

            const track = document.createElement('div'); // CHANGE
            track.style.position = 'relative'; // CHANGE
            track.style.height = '18px'; // CHANGE
            track.style.borderBottom = '1px solid #e8eaed'; // CHANGE
            if (todayPct != null) { // CHANGE
                const todayLine = document.createElement('div'); // CHANGE
                todayLine.style.position = 'absolute'; // CHANGE
                todayLine.style.left = todayPct + '%'; // CHANGE
                todayLine.style.top = '0'; // CHANGE
                todayLine.style.bottom = '0'; // CHANGE
                todayLine.style.width = '1px'; // CHANGE
                todayLine.style.background = '#b91c1c'; // CHANGE
                todayLine.style.opacity = '0.75'; // CHANGE
                track.appendChild(todayLine); // CHANGE
            } // CHANGE

            for (const occurrenceCard of scheduleRow.cards) { // CHANGE
                const range = getTaskDateRange(occurrenceCard); // CHANGE
                if (range) renderScheduleBar(track, occurrenceCard, range, minDay, totalDays); // CHANGE
            } // CHANGE
            row.appendChild(track); // CHANGE

            grid.appendChild(row); // CHANGE
            for (const occurrenceCard of scheduleRow.cards) { // CHANGE
                entry.visibleItems.push({ cardId: occurrenceCard.id, row }); // CHANGE
            } // CHANGE
        } // CHANGE

        function renderUnscheduledSection(entry, body, unscheduledRows) { // CHANGE
            if (!unscheduledRows.length) return; // CHANGE
            const section = document.createElement('div'); // CHANGE
            section.style.marginTop = '8px'; // CHANGE
            const title = document.createElement('div'); // CHANGE
            title.textContent = 'Unscheduled'; // CHANGE
            title.style.fontWeight = 'bold'; // CHANGE
            title.style.fontSize = '10px'; // CHANGE
            title.style.color = '#5f6368'; // CHANGE
            title.style.marginBottom = '3px'; // CHANGE
            section.appendChild(title); // CHANGE
            for (const scheduleRow of unscheduledRows) { // CHANGE
                const card = scheduleRow.card; // CHANGE
                const row = makeClickableRow(card, 'manual-link-task-schedule-unscheduled'); // CHANGE
                row.style.display = 'grid'; // CHANGE
                row.style.gridTemplateColumns = '6px 1fr'; // CHANGE
                row.style.columnGap = '6px'; // CHANGE
                row.style.alignItems = 'center'; // CHANGE
                row.style.minHeight = '22px'; // CHANGE
                row.style.padding = '2px 0'; // CHANGE
                row.style.cursor = 'pointer'; // CHANGE
                const stripe = document.createElement('span'); // CHANGE
                stripe.style.height = '14px'; // CHANGE
                stripe.style.borderRadius = '4px'; // CHANGE
                stripe.style.background = getTaskLaneColor(card); // CHANGE
                row.appendChild(stripe); // CHANGE
                const label = scheduleRow.repeat && scheduleRow.cards.length > 1 // CHANGE
                    ? scheduleRow.label + ' (' + scheduleRow.cards.length + ')' // CHANGE
                    : scheduleRow.label; // CHANGE
                const labelWrap = document.createElement('div'); // CHANGE
                labelWrap.style.minWidth = '0'; // CHANGE
                labelWrap.appendChild(makeTextSpan(label, '#5f6368')); // CHANGE
                const linkLabelBadge = getTaskLinkLabelBadge(entry, card); // CHANGE
                if (linkLabelBadge) { // CHANGE
                    const badgeLine = document.createElement('div'); // CHANGE
                    badgeLine.style.marginTop = '2px'; // CHANGE
                    badgeLine.appendChild(makeBadge(linkLabelBadge)); // CHANGE
                    labelWrap.appendChild(badgeLine); // CHANGE
                } // CHANGE
                row.appendChild(labelWrap); // CHANGE
                section.appendChild(row); // CHANGE
                for (const occurrenceCard of scheduleRow.cards) { // CHANGE
                    entry.visibleItems.push({ cardId: occurrenceCard.id, row }); // CHANGE
                } // CHANGE
            } // CHANGE
            body.appendChild(section); // CHANGE
        } // CHANGE

        function renderScheduleView(entry, body, cards) { // CHANGE
            const rows = buildScheduleRowsForCards(cards); // CHANGE
            const scheduledRows = []; // CHANGE
            const unscheduled = []; // CHANGE
            for (const row of rows) { // CHANGE
                const ranges = row.cards.map(card => getTaskDateRange(card)).filter(Boolean); // CHANGE
                if (ranges.length) scheduledRows.push({ row, ranges }); // CHANGE
                else unscheduled.push(row); // CHANGE
            } // CHANGE

            let minDay = null; // CHANGE
            let maxDay = null; // CHANGE
            let totalDays = 1; // CHANGE
            let todayPct = null; // CHANGE
            if (scheduledRows.length) { // CHANGE
                const startDays = []; // CHANGE
                const endDays = []; // CHANGE
                for (const record of scheduledRows) { // CHANGE
                    for (const range of record.ranges) { // CHANGE
                        startDays.push(range.startDay); // CHANGE
                        endDays.push(range.endDay); // CHANGE
                    } // CHANGE
                } // CHANGE
                minDay = Math.min.apply(null, startDays); // CHANGE
                maxDay = Math.max.apply(null, endDays); // CHANGE
                totalDays = Math.max(1, maxDay - minDay + 1); // CHANGE
                const today = todayOverlayDayNumber(); // CHANGE
                if (today >= minDay && today <= maxDay) todayPct = ((today - minDay) / totalDays) * 100; // CHANGE
            } // CHANGE

            if (!scheduledRows.length) { // CHANGE
                const empty = document.createElement('div'); // CHANGE
                empty.textContent = 'No scheduled task dates'; // CHANGE
                empty.style.color = '#5f6368'; // CHANGE
                empty.style.padding = '8px 0'; // CHANGE
                body.appendChild(empty); // CHANGE
            } else { // CHANGE
                const grid = document.createElement('div'); // CHANGE
                renderScheduleAxis(grid, minDay, maxDay, todayPct); // CHANGE
                scheduledRows.sort((a, b) => compareTaskCardsByStartDate(a.row.card, b.row.card)); // CHANGE
                for (const record of scheduledRows) { // CHANGE
                    renderScheduleRow(entry, grid, record.row, minDay, totalDays, todayPct); // CHANGE
                } // CHANGE
                body.appendChild(grid); // CHANGE
            } // CHANGE

            renderUnscheduledSection(entry, body, unscheduled); // CHANGE
        } // CHANGE

        function renderOccupancyUnscheduledSection(entry, body, items) { // NEW
            if (!items.length) return; // NEW
            const section = document.createElement('div'); // NEW
            section.style.marginTop = '8px'; // NEW
            const title = document.createElement('div'); // NEW
            title.textContent = 'Unscheduled'; // NEW
            title.style.fontWeight = 'bold'; // NEW
            title.style.fontSize = '10px'; // NEW
            title.style.color = '#5f6368'; // NEW
            title.style.marginBottom = '3px'; // NEW
            section.appendChild(title); // NEW
            for (const item of items) { // NEW
                const row = makeOccupancyRow(entry, item); // NEW
                row.style.display = 'grid'; // NEW
                row.style.gridTemplateColumns = '6px 1fr'; // NEW
                row.style.columnGap = '6px'; // NEW
                row.style.alignItems = 'center'; // NEW
                row.style.minHeight = '22px'; // NEW
                row.style.padding = '2px 0'; // NEW
                row.style.cursor = 'pointer'; // NEW
                const stripe = document.createElement('span'); // NEW
                stripe.style.height = '14px'; // NEW
                stripe.style.borderRadius = '4px'; // NEW
                stripe.style.background = '#9aa0a6'; // NEW
                row.appendChild(stripe); // NEW
                const labelWrap = document.createElement('div'); // NEW
                labelWrap.style.minWidth = '0'; // NEW
                labelWrap.appendChild(makeTextSpan(item.label || item.cellId || 'Planting', '#5f6368')); // NEW
                row.appendChild(labelWrap); // NEW
                section.appendChild(row); // NEW
            } // NEW
            body.appendChild(section); // NEW
        } // NEW

        function renderOccupancyView(entry, body) { // NEW
            const occupancy = getOccupancyModelForEntry(entry); // NEW
            const rows = (occupancy.items || []).map(item => ({ item, range: occupancyRangeForItem(item) })); // NEW
            const scheduledRows = rows.filter(row => !!row.range); // NEW
            const unscheduledItems = rows.filter(row => !row.range).map(row => row.item); // NEW
            let minDay = null; // NEW
            let maxDay = null; // NEW
            let totalDays = 1; // NEW
            let todayPct = null; // NEW

            if (scheduledRows.length) { // NEW
                minDay = Math.min.apply(null, scheduledRows.map(row => row.range.startDay)); // NEW
                maxDay = Math.max.apply(null, scheduledRows.map(row => row.range.endDay)); // NEW
                totalDays = Math.max(1, maxDay - minDay + 1); // NEW
                const today = todayOverlayDayNumber(); // NEW
                if (today >= minDay && today <= maxDay) todayPct = ((today - minDay) / totalDays) * 100; // NEW
            } // NEW

            if (!scheduledRows.length) { // NEW
                const empty = document.createElement('div'); // NEW
                empty.textContent = 'No scheduled occupancy dates'; // NEW
                empty.style.color = '#5f6368'; // NEW
                empty.style.padding = '8px 0'; // NEW
                body.appendChild(empty); // NEW
            } else { // NEW
                const grid = document.createElement('div'); // NEW
                renderScheduleAxis(grid, minDay, maxDay, todayPct, 'Planting'); // NEW
                scheduledRows.sort((a, b) => a.range.startDay - b.range.startDay || String(a.item.cellId || '').localeCompare(String(b.item.cellId || ''))); // NEW
                for (const row of scheduledRows) renderOccupancyRow(entry, grid, row.item, row.range, minDay, totalDays, todayPct); // NEW
                body.appendChild(grid); // NEW
            } // NEW

            renderOccupancyUnscheduledSection(entry, body, unscheduledItems); // NEW
        } // NEW

        function getSourceBoundsForPanel(source) { // CHANGE
            const host = getPanelHost(); // CHANGE
            const state = source && graph.getView && graph.getView().getState(source); // CHANGE
            if (host && state && state.shape && state.shape.node && state.shape.node.getBoundingClientRect) { // CHANGE
                const hostRect = host.getBoundingClientRect(); // CHANGE
                const cellRect = state.shape.node.getBoundingClientRect(); // CHANGE
                return { // CHANGE
                    x: cellRect.left - hostRect.left + (host.scrollLeft || 0), // CHANGE
                    y: cellRect.top - hostRect.top + (host.scrollTop || 0), // CHANGE
                    w: cellRect.width, // CHANGE
                    h: cellRect.height // CHANGE
                }; // CHANGE
            } // CHANGE
            const center = getCellCenter(source); // CHANGE
            return center ? { x: center.x - center.w / 2, y: center.y - center.h / 2, w: center.w, h: center.h } : null; // CHANGE
        } // CHANGE

        function positionPanel(entry, source) { // CHANGE
            const host = getPanelHost(); // CHANGE
            const sourceBounds = getSourceBoundsForPanel(source); // CHANGE
            if (!host || !entry.panel || !sourceBounds) return false; // CHANGE

            const panelHeight = entry.panel.offsetHeight || 32; // CHANGE
            const visibleRight = (host.scrollLeft || 0) + (host.clientWidth || 0); // CHANGE
            const visibleLeft = host.scrollLeft || 0; // CHANGE
            const rightLeft = sourceBounds.x + sourceBounds.w + PANEL_GAP + PANEL_SIDE_OFFSET; // CHANGE
            const leftLeft = sourceBounds.x - PANEL_GAP - PANEL_SIDE_OFFSET - PANEL_WIDTH; // CHANGE
            const leftFits = leftLeft >= visibleLeft + 4 && leftLeft + PANEL_WIDTH <= visibleRight - 8; // CHANGE
            let left = rightLeft; // CHANGE

            if (visibleRight && rightLeft + PANEL_WIDTH > visibleRight - 8 && leftFits) { // CHANGE
                left = leftLeft; // CHANGE
            } // CHANGE

            const top = sourceBounds.y + sourceBounds.h / 2 - panelHeight / 2; // CHANGE

            entry.panelLeft = left; // CHANGE
            entry.panelTop = top; // CHANGE
            entry.panel.style.left = left + 'px'; // CHANGE
            entry.panel.style.top = top + 'px'; // CHANGE
            return true; // CHANGE
        } // CHANGE

        function itemCenterFromRow(entry, row) { // CHANGE
            const host = getPanelHost(); // CHANGE
            if (!host || !row || !row.getBoundingClientRect) return null; // CHANGE
            const rowRect = row.getBoundingClientRect(); // CHANGE
            const hostRect = host.getBoundingClientRect(); // CHANGE
            return { // CHANGE
                x: rowRect.left - hostRect.left + (host.scrollLeft || 0) + rowRect.width / 2, // CHANGE
                y: rowRect.top - hostRect.top + (host.scrollTop || 0) + rowRect.height / 2, // CHANGE
                w: rowRect.width, // CHANGE
                h: rowRect.height // CHANGE
            }; // CHANGE
        } // CHANGE

        function createOrUpdateLine(entry, cardId, row) { // CHANGE
            const pane = getOverlayPane(); // CHANGE
            const card = model.getCell(cardId); // CHANGE
            if (!pane || !row || !isValidOverlayCard(card)) { // CHANGE
                removePolyline(entry.lines.get(cardId)); // CHANGE
                entry.lines.delete(cardId); // CHANGE
                return; // CHANGE
            } // CHANGE

            const itemC = itemCenterFromRow(entry, row); // CHANGE
            const dstC = getCellCenter(card); // CHANGE
            if (!itemC || !dstC) { // CHANGE
                removePolyline(entry.lines.get(cardId)); // CHANGE
                entry.lines.delete(cardId); // CHANGE
                return; // CHANGE
            } // CHANGE

            const srcPt = anchorOnSide(itemC, sideToward(itemC, dstC), 0.5); // CHANGE
            const dstPt = anchorOnSide(dstC, sideToward(dstC, itemC), 0.5); // CHANGE
            if (!srcPt || !dstPt) return; // CHANGE

            const points = [new mxPoint(srcPt.x, srcPt.y), new mxPoint(dstPt.x, dstPt.y)]; // CHANGE
            const stroke = getTaskLaneColor(card); // CHANGE
            let poly = entry.lines.get(cardId); // CHANGE

            if (poly && poly.node && poly.node.parentNode === pane) { // CHANGE
                poly.points = points; // CHANGE
                poly.stroke = stroke; // CHANGE
                poly.redraw(); // CHANGE
            } else { // CHANGE
                removePolyline(poly); // CHANGE
                poly = new mxPolyline(points, stroke, 2); // CHANGE
                poly.dialect = graph.dialect; // CHANGE
                poly.init(pane); // CHANGE
                poly.redraw(); // CHANGE
                if (poly.node) { // CHANGE
                    poly.node.style.pointerEvents = 'none'; // CHANGE
                    poly.node.setAttribute('opacity', '0.72'); // CHANGE
                } // CHANGE
                entry.lines.set(cardId, poly); // CHANGE
            } // CHANGE
        } // CHANGE

        function refreshLines(entry) { // CHANGE
            const liveIds = new Set(); // CHANGE
            for (const item of entry.visibleItems || []) { // CHANGE
                liveIds.add(item.cardId); // CHANGE
                createOrUpdateLine(entry, item.cardId, item.row); // CHANGE
            } // CHANGE
            for (const [cardId, poly] of Array.from(entry.lines.entries())) { // CHANGE
                if (liveIds.has(cardId)) continue; // CHANGE
                removePolyline(poly); // CHANGE
                entry.lines.delete(cardId); // CHANGE
            } // CHANGE
        } // CHANGE

        function renderEntry(entry) { // CHANGE
            const host = getPanelHost(); // CHANGE
            const panelHost = getPanelLayer(); // NEW
            const source = model.getCell(entry.sourceId); // CHANGE
            if (!host || !panelHost || !source || !model.isVertex(source)) { // CHANGE
                removeEntry(entry); // CHANGE
                return; // CHANGE
            } // CHANGE

            const cards = entry.targetIds // CHANGE
                .map((id) => model.getCell(id)) // CHANGE
                .filter(isValidOverlayCard) // CHANGE
                .sort(compareTaskCardsByStartDate); // CHANGE
            entry.targetIds = cards.map((card) => card.id); // CHANGE
            if (entry.linkLabels) { // CHANGE
                const liveLabels = new Map(); // CHANGE
                for (const card of cards) liveLabels.set(card.id, entry.linkLabels.get(card.id) || ''); // CHANGE
                entry.linkLabels = liveLabels; // CHANGE
            } // CHANGE
            if (cards.length === 0) { // CHANGE
                if (!entry.scheduleOnly) { // ADDED
                    removeEntry(entry); // CHANGE
                    return; // CHANGE
                } // ADDED
            } // CHANGE

            if (entry.scheduleOnly) { // ADDED
                if (!entry.panel) { // ADDED
                    entry.panel = document.createElement('div'); // ADDED
                    entry.panel.className = 'manual-link-task-schedule-overlay manual-link-task-schedule-only'; // ADDED
                    applyPanelStyle(entry.panel); // ADDED
                    panelHost.appendChild(entry.panel); // CHANGE
                } else if (entry.panel.parentNode !== panelHost) { // NEW
                    panelHost.appendChild(entry.panel); // NEW
                } // ADDED
                while (entry.panel.firstChild) entry.panel.removeChild(entry.panel.firstChild); // ADDED
                entry.visibleItems = []; // ADDED
                entry.panel.appendChild(createScheduleOnlyHeader(entry)); // ADDED
                if (activeMode === MODE_OCCUPANCY) { // NEW
                    const body = createBody(); // NEW
                    entry.panel.appendChild(body); // NEW
                    renderOccupancyView(entry, body); // NEW
                } // NEW
                if (!positionPanel(entry, source)) { // ADDED
                    removeEntry(entry); // ADDED
                    return; // ADDED
                } // ADDED
                refreshLines(entry); // ADDED
                return; // ADDED
            } // ADDED

            entry.years = getTaskOverlayYears(cards); // CHANGE
            if (entry.years.length) { // CHANGE
                const rememberedYear = selectedYearBySource.get(entry.sourceId); // CHANGE
                entry.selectedYear = entry.years.indexOf(rememberedYear) >= 0 ? rememberedYear : (entry.selectedYear || chooseDefaultOverlayYear(entry.years)); // CHANGE
            } else { // CHANGE
                entry.selectedYear = null; // CHANGE
            } // CHANGE
            const visibleCards = cards.filter(card => getAttr(card, 'year_hidden') !== '1'); // CHANGE
            const groups = groupLinkedTasksForOverlay(visibleCards); // CHANGE

            if (!entry.panel) { // CHANGE
                entry.panel = document.createElement('div'); // CHANGE
                entry.panel.className = 'manual-link-task-schedule-overlay'; // CHANGE
                applyPanelStyle(entry.panel); // CHANGE
                panelHost.appendChild(entry.panel); // CHANGE
            } else if (entry.panel.parentNode !== panelHost) { // NEW
                panelHost.appendChild(entry.panel); // NEW
            } // CHANGE

            while (entry.panel.firstChild) entry.panel.removeChild(entry.panel.firstChild); // CHANGE
            entry.visibleItems = []; // CHANGE
            const headerCount = activeMode === MODE_OCCUPANCY ? countOccupancyRows(entry) : (activeMode === MODE_SCHEDULE ? countScheduleRows(visibleCards) : countGroupItems(groups)); // CHANGE
            entry.panel.appendChild(createHeader(entry, headerCount)); // CHANGE
            const body = createBody(); // CHANGE
            entry.panel.appendChild(body); // CHANGE
            mxEvent.addListener(body, 'scroll', function () { refreshLines(entry); }); // CHANGE

            if (activeMode === MODE_OCCUPANCY) renderOccupancyView(entry, body); // NEW
            else if (visibleCards.length === 0) renderEmptyTaskOverlayMessage(body); // CHANGE
            else if (activeMode === MODE_SCHEDULE) renderScheduleView(entry, body, visibleCards); // CHANGE
            else if (groups.length) renderCardView(entry, body, groups); // CHANGE
            else renderEmptyTaskOverlayMessage(body); // CHANGE

            if (!positionPanel(entry, source)) { // CHANGE
                removeEntry(entry); // CHANGE
                return; // CHANGE
            } // CHANGE

            refreshLines(entry); // CHANGE
        } // CHANGE

        function removeEntry(entry, restoreYear) { // CHANGE
            if (!entry) return; // CHANGE
            for (const poly of entry.lines.values()) removePolyline(poly); // CHANGE
            entry.lines.clear(); // CHANGE
            removeNode(entry.panel); // CHANGE
            registry.delete(entry.sourceId); // CHANGE
            if (restoreYear && !isEntryStillSelected(entry)) restoreEntryTasksToCurrentYear(entry); // CHANGE
        } // CHANGE

        function show(source, cards, linkLabels) { // CHANGE
            clear(); // CHANGE
            if (!source || !source.id || !cards || cards.length === 0) return; // CHANGE

            const validCards = cards.filter(isValidOverlayCard).sort(compareTaskCardsByStartDate); // CHANGE
            if (validCards.length === 0) return; // CHANGE

            const entry = { // CHANGE
                sourceId: source.id, // CHANGE
                targetIds: validCards.map((card) => card.id), // CHANGE
                linkLabels: new Map(), // CHANGE
                panel: null, // CHANGE
                panelLeft: 0, // CHANGE
                panelTop: 0, // CHANGE
                visibleItems: [], // CHANGE
                lines: new Map() // CHANGE
            }; // CHANGE
            for (const card of validCards) entry.linkLabels.set(card.id, linkLabels && linkLabels.get ? (linkLabels.get(card.id) || '') : ''); // CHANGE
            registry.set(source.id, entry); // CHANGE
            renderEntry(entry); // CHANGE
        } // CHANGE

        function showScheduleOnly(source) { // ADDED
            clear(); // ADDED
            if (!source || !source.id || !isTilerGroup(source)) return; // ADDED
            const entry = { // ADDED
                sourceId: source.id, // ADDED
                targetIds: [], // ADDED
                linkLabels: new Map(), // ADDED
                scheduleOnly: true, // ADDED
                panel: null, // ADDED
                panelLeft: 0, // ADDED
                panelTop: 0, // ADDED
                visibleItems: [], // ADDED
                lines: new Map() // ADDED
            }; // ADDED
            registry.set(source.id, entry); // ADDED
            renderEntry(entry); // ADDED
        } // ADDED

        function clear() { // CHANGE
            for (const entry of Array.from(registry.values())) removeEntry(entry, true); // CHANGE
        } // CHANGE

        function refresh() { // CHANGE
            for (const entry of Array.from(registry.values())) renderEntry(entry); // CHANGE
        } // CHANGE

        function setMode(mode) { // CHANGE
            activeMode = mode === MODE_OCCUPANCY ? MODE_OCCUPANCY : (mode === MODE_SCHEDULE ? MODE_SCHEDULE : MODE_CARDS); // CHANGE
            refresh(); // CHANGE
        } // CHANGE

        return { // CHANGE
            show, // CHANGE
            showScheduleOnly, // ADDED
            clear, // CHANGE
            refresh, // CHANGE
            setMode // CHANGE
        }; // CHANGE
    })(); // CHANGE


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

    function dispatchYearFilterChangedForTaskOverlay(card, year) { // CHANGE
        try { // CHANGE
            window.dispatchEvent(new CustomEvent('yearFilterChanged', { // CHANGE
                detail: { moduleCellId: null, taskCardId: card && card.id || null, year: year == null ? null : year } // CHANGE
            })); // CHANGE
        } catch (_) { } // CHANGE
    } // CHANGE

    function revealKanbanCardForNavigation(card) { // CHANGE
        if (!isKanbanCard(card)) return; // CHANGE
        if (getAttr(card, 'year_hidden') === '1' || getAttr(card, 'repeat_hidden') === '1') return; // CHANGE
        if (!model.isVisible || model.isVisible(card)) return; // CHANGE
        const pagingApi = graph.__trellisTaskPagingApi; // CHANGE
        if (pagingApi && typeof pagingApi.revealCard === 'function' && pagingApi.revealCard(card)) { dispatchYearFilterChangedForTaskOverlay(card, null); return; } // CHANGE
        dispatchYearFilterChangedForTaskOverlay(card, null); // CHANGE
    } // CHANGE


    // Works for arbitrarily nested children
    function selectAndReveal(cell) {
        if (!cell) return;
        const m = graph.getModel();

        revealKanbanCardForNavigation(cell); // CHANGE

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


    function refreshAfterLinkNavigation() { // CHANGE
        setTimeout(function () { // CHANGE
            refreshCurrentHighlight(); // CHANGE
            taskScheduleOverlay.refresh(); // CHANGE
        }, 0); // CHANGE
    } // CHANGE

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
            refreshAfterLinkNavigation(); // CHANGE
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

    function historyCellIds(cells) { // NEW
        return (cells || []).map(cell => cell && (cell.id || (cell.getId && cell.getId()))).filter(Boolean).map(String); // NEW
    } // NEW

    function runTrellisHistoryTransaction(metadata, operation) { // NEW
        const history = typeof window !== "undefined" && window.Trellis && window.Trellis.history; // NEW
        if (history && typeof history.run === "function" && !(typeof history.isRestoring === "function" && history.isRestoring())) { // NEW
            return history.run(metadata, operation); // NEW
        } // NEW
        return operation(); // NEW
    } // NEW

    function unlinkRespectingPrimaries(verts) {
        return runTrellisHistoryTransaction({ category: "Data", action: "unlinkVertices", origin: "Vertex_Linking_Standalone", title: "Remove vertex links", affectedCellIds: historyCellIds(verts), tags: ["Links"] }, function () { // NEW
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
        }); // NEW
    }


    // Link respecting primaries:
    // If any primaries, link every Primary ↔ every Secondary only.
    // If no primaries, link all pairs (existing behavior).
    function linkRespectingPrimaries(verts) {
        return runTrellisHistoryTransaction({ category: "Data", action: "linkVertices", origin: "Vertex_Linking_Standalone", title: "Create vertex links", affectedCellIds: historyCellIds(verts), tags: ["Links"] }, function () { // NEW
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
        }); // NEW
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
        return runTrellisHistoryTransaction({ category: "Data", action: "unlinkAllVertices", origin: "Vertex_Linking_Standalone", title: "Remove all vertex links", affectedCellIds: historyCellIds([cell]), tags: ["Links"] }, function () { // NEW
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
        }); // NEW
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


    function highlight(cell, color, widthPx) { // CHANGE
        domHighlightVertex(cell, color, widthPx); // CHANGE
    }



    // DOM-based vertex highlighting (no model/undo impact)                    
    function domHighlightVertex(cell, color, widthPx) { // CHANGE
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

        target.style.stroke = color || '#ff0000';
        target.style.strokeWidth = (widthPx || 3) + 'px'; // CHANGE
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
        taskScheduleOverlay.clear(); // CHANGE
        linkOverlays.clearAll();
        clearDomHighlights();
    }


    function selectedLinkableVertices() { // NEW
        return asVertexArray(graph.getSelectionCells && graph.getSelectionCells()); // NEW
    } // NEW

    function refreshCurrentHighlight() { // CHANGE
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

        if (selected.every(isRoleCard)) { // NEW
            highlightLinkedRoleCards(selected); // NEW
        } else { // NEW
            highlightLinked(null); // CHANGE
        } // CHANGE
    } // CHANGE

    function assignStandardLinkLabelOffsets(records) { // NEW
        const groups = { left: [], right: [], top: [], bottom: [] }; // NEW
        for (const record of records || []) { // NEW
            record.labelOffset = { x: 0, y: 0 }; // NEW
            const side = record.exitHint && record.exitHint.side; // NEW
            if (groups[side]) groups[side].push(record); // NEW
        } // NEW

        for (const side of ['left', 'right', 'top', 'bottom']) { // NEW
            groups[side].sort((a, b) => { // NEW
                const at = a.exitHint && Number.isFinite(a.exitHint.t) ? a.exitHint.t : 0; // NEW
                const bt = b.exitHint && Number.isFinite(b.exitHint.t) ? b.exitHint.t : 0; // NEW
                return at - bt; // NEW
            }); // NEW
            for (let i = 0; i < groups[side].length; i++) { // NEW
                const offsetPx = i * LINK_LABEL_STAGGER_PX; // NEW
                groups[side][i].labelOffset = (side === 'left' || side === 'right') // NEW
                    ? { x: 0, y: offsetPx } // NEW
                    : { x: offsetPx, y: 0 }; // NEW
            } // NEW
        } // NEW
    } // NEW

    // Config: whether a Primary vertex should be highlighted even without links
    const ALLOW_PRIMARY_WHEN_UNLINKED = true; // set to false to require links

    function highlightLinkedRoleCards(cells) { // NEW
        const YELLOW = '#ffd400'; // NEW
        const RED = '#ff0000'; // NEW
        const selectedRoleCards = (cells || []).filter(cell => cell && model.isVertex(cell) && isRoleCard(cell)); // NEW

        model.beginUpdate(); // NEW
        try { // NEW
            clearAllHighlights(); // NEW
            if (selectedRoleCards.length === 0) return; // NEW

            const visibleLinkOverlayRecords = []; // NEW
            for (const cell of selectedRoleCards) { // NEW
                pruneBrokenLinks(cell); // NEW
                const linkedIds = getLinkSet(cell); // NEW
                const selIsPrimary = isPrimary(cell); // NEW
                highlight(cell, selIsPrimary ? YELLOW : RED); // NEW
                if (linkedIds.size === 0) continue; // NEW

                const targets = []; // NEW
                for (const id of linkedIds) { // NEW
                    const other = model.getCell(id); // NEW
                    if (other && model.isVertex(other)) targets.push(other); // NEW
                } // NEW

                const exitMap = computeExitParamsForOrigin(cell, targets); // NEW
                for (const other of targets) { // NEW
                    const otherIsPrimary = isPrimary(other); // NEW
                    highlight(other, otherIsPrimary ? YELLOW : RED); // NEW
                    const laneColor = getLinkLaneColor(cell, other); // NEW
                    const edgeColor = laneColor ? laneColor : ((selIsPrimary || otherIsPrimary) ? YELLOW : RED); // NEW
                    const label = getRawTextLabel ? getRawTextLabel(other) : ''; // NEW
                    const exitHint = exitMap.get(other.id); // NEW
                    if (shouldShowEdgeInternal(cell, other)) { // NEW
                        visibleLinkOverlayRecords.push({ source: cell, other, exitHint, edgeColor, label, labelOffset: { x: 0, y: 0 } }); // NEW
                    } // NEW
                } // NEW
            } // NEW

            assignStandardLinkLabelOffsets(visibleLinkOverlayRecords); // NEW
            for (const record of visibleLinkOverlayRecords) { // NEW
                linkOverlays.setLinkOverlay(record.source, record.other, record.exitHint, record.edgeColor, record.label, record.labelOffset); // NEW
            } // NEW
        } finally { // NEW
            model.endUpdate(); // NEW
        } // NEW
    } // NEW

    function highlightLinked(cell) {
        const YELLOW = '#ffd400';
        const RED = '#ff0000';
        const SAME_CROP_HIGHLIGHT = '#2563eb'; // NEW

        model.beginUpdate();
        try {
            clearAllHighlights();
            if (!cell) return;

            const pruned = pruneBrokenLinks(cell);

            let linkedIds = getLinkSet(cell);
            const selIsPrimary = isPrimary(cell);
            const hasLinks = linkedIds.size > 0;
            const selectedIsTilerGroup = isTilerGroup(cell); // ADDED

            if (!hasLinks && selectedIsTilerGroup) { // ADDED
                highlight(cell, selIsPrimary ? YELLOW : RED); // CHANGED
                taskScheduleOverlay.showScheduleOnly(cell); // ADDED
                return; // ADDED
            } // ADDED

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

            const sameBoardLinkedCards = collectSameBoardLinkedKanbanCards(cell, targets); // CHANGE
            const selectedTilerTaskSiblingIds = collectLinkedTaskCardSiblingIdsForTiler(cell, targets); // CHANGE
            const linkedTaskCards = collectLinkedKanbanCardsForSource(cell); // CHANGE
            const taskOverlayActive = linkedTaskCards.length > 0 && !isKanbanCard(cell); // CHANGE
            const taskOverlayLinkLabels = new Map(); // CHANGE
            if (taskOverlayActive) { // CHANGE
                taskScheduleOverlay.show(cell, linkedTaskCards, taskOverlayLinkLabels); // CHANGE
            } else if (selectedIsTilerGroup) { // ADDED
                taskScheduleOverlay.showScheduleOnly(cell); // ADDED
            } else { // CHANGE
                taskScheduleOverlay.clear(); // CHANGE
            } // CHANGE

            const exitMap = computeExitParamsForOrigin(cell, targets);
            const visibleLinkOverlayRecords = []; // NEW

            for (const other of targets) {
                const otherIsPrimary = isPrimary(other);
                const linkedTargetHighlight = selectedTilerTaskSiblingIds.has(other.id) ? SAME_CROP_HIGHLIGHT : RED; // CHANGE
                highlight(other, otherIsPrimary ? YELLOW : linkedTargetHighlight); // CHANGE

                // If link touches a Kanban task card, edge color = lane fillColor  
                const laneColor = getLinkLaneColor(cell, other);
                const edgeColor = laneColor
                    ? laneColor
                    : ((selIsPrimary || otherIsPrimary) ? YELLOW : RED);

                const label = getRawTextLabel ? getRawTextLabel(other) : '';
                const exitHint = exitMap.get(other.id);

                // Decide visibility using internal lane-based policy               
                const shouldShow = shouldShowEdgeInternal(cell, other);
                if (shouldShow) { // CHANGE
                    visibleLinkOverlayRecords.push({ other, exitHint, edgeColor, label, labelOffset: { x: 0, y: 0 } }); // NEW
                }
            }

            assignStandardLinkLabelOffsets(visibleLinkOverlayRecords); // NEW
            for (const record of visibleLinkOverlayRecords) { // NEW
                linkOverlays.setLinkOverlay( // CHANGE
                    cell, record.other, record.exitHint, record.edgeColor, record.label, record.labelOffset // CHANGE
                ); // CHANGE
            } // NEW

            for (const otherCard of sameBoardLinkedCards) { // CHANGE
                const otherIsPrimary = isPrimary(otherCard); // CHANGE
                highlight(otherCard, otherIsPrimary ? YELLOW : SAME_CROP_HIGHLIGHT, 1.5); // CHANGE
            } // CHANGE


        } finally {
            model.endUpdate();
        }
    }

    // -------------------- Ctrl Click Handling -------------------- // CHANGE
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

    function resolveLiveCreatedTilerGroup(evt) { // CHANGE
        const m = graph.getModel(); // CHANGE
        const eventCell = evt && evt.getProperty ? evt.getProperty('cell') : null; // CHANGE
        const eventCellId = evt && evt.getProperty ? evt.getProperty('cellId') : null; // CHANGE
        const cellId = eventCellId || (eventCell && eventCell.id) || ''; // CHANGE
        const liveCell = cellId && m.getCell ? m.getCell(cellId) : eventCell; // CHANGE
        if (!liveCell || !isTilerGroup(liveCell)) return null; // CHANGE
        if (typeof m.contains === 'function' && !m.contains(liveCell)) return null; // CHANGE
        return liveCell; // CHANGE
    } // CHANGE

    graph.addListener(TILER_GROUP_CREATED_EVENT, function (_sender, evt) { // CHANGE
        const createdGroup = resolveLiveCreatedTilerGroup(evt); // CHANGE
        if (!createdGroup) return; // CHANGE
        if (graph.getSelectionCell && graph.getSelectionCell() !== createdGroup) graph.setSelectionCell(createdGroup); // CHANGE
        setTimeout(function () { // CHANGE
            const liveGroup = resolveLiveCreatedTilerGroup(evt); // CHANGE
            if (!liveGroup) return; // CHANGE
            if (graph.getSelectionCell && graph.getSelectionCell() !== liveGroup) graph.setSelectionCell(liveGroup); // CHANGE
            taskScheduleOverlay.showScheduleOnly(liveGroup); // CHANGE
            taskScheduleOverlay.refresh(); // CHANGE
        }, 0); // CHANGE
    }); // CHANGE


    // Selection Highlight Logic
    graph.getSelectionModel().addListener(mxEvent.CHANGE, function () {
        refreshCurrentHighlight(); // CHANGE
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
                else {                                                                                 // UNCHANGED
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

                    vertexLinkLog(`[Primary] Mixed selection: primary=${primCount}, nonPrimary=${nonPrimCount}`); // UNCHANGED
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
                        const res = linkRespectingPrimaries(verts);                     // UNCHANGED
                        vertexLinkLog(`[LINK P↔S] pairs=${res.pairs}, changed=${res.changes}`); // UNCHANGED
                        const sel = graph.getSelectionCell();                           // UNCHANGED
                        if (sel && model.isVertex(sel)) highlightLinked(sel);           // UNCHANGED
                    });
                }
                // Mixed -> show both with counts                                        
                else if (totalPairs > 0) {
                    menu.addItem(`Link Selected (respect primaries) (${missingPairs})`, null, function () {
                        const res = linkRespectingPrimaries(verts);                     // UNCHANGED
                        vertexLinkLog(`[LINK P↔S] pairs=${res.pairs}, changed=${res.changes}`); // UNCHANGED
                        const sel = graph.getSelectionCell();                           // UNCHANGED
                        if (sel && model.isVertex(sel)) highlightLinked(sel);           // UNCHANGED
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

        function registerTrellisContextMenuContributor(contributor) { // NEW
            function finishRegistration() { // NEW
                if (!window.TrellisContextMenu) return; // NEW
                window.TrellisContextMenu.install(ui); // NEW
                window.TrellisContextMenu.register(contributor); // NEW
            } // NEW

            if (window.TrellisContextMenu) { // NEW
                finishRegistration(); // NEW
            } else if (typeof mxscript === "function") { // NEW
                mxscript("plugins/garden_planner_plugins/Trellis_Context_Menu.js", finishRegistration); // NEW
            } // NEW
        } // NEW

        registerTrellisContextMenuContributor({ // CHANGE
            id: "gardenLinking", // NEW
            priority: 600, // NEW
            addItems: function (menu) { // CHANGE
                addMenuItems(menu); // NEW
            } // CHANGE
        }); // CHANGE
        vertexLinkLog('[ManualLinker] Registered ordered context menu contributor'); // CHANGE
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
            taskScheduleOverlay.refresh(); // CHANGE

            // Draw.io may recreate SVG nodes during zoom/pan, so reapply DOM highlights
            // after the view has finished its redraw cycle. // CHANGE
            setTimeout(function () { // CHANGE
                refreshCurrentHighlight(); // CHANGE
                linkOverlays.refreshAll(); // CHANGE
                taskScheduleOverlay.refresh(); // CHANGE
            }, 0); // CHANGE
        } // CHANGE

        view.addListener(mxEvent.SCALE, refreshViewOnlyLinkVisuals); // CHANGE
        view.addListener(mxEvent.TRANSLATE, refreshViewOnlyLinkVisuals); // CHANGE
        view.addListener(mxEvent.SCALE_AND_TRANSLATE, refreshViewOnlyLinkVisuals); // CHANGE
    }

    graph.getModel().addListener(mxEvent.CHANGE, function () {
        // Any geometry change (move/resize) will trigger recompute                
        linkOverlays.refreshAll();
        taskScheduleOverlay.refresh(); // CHANGE
    });

    window.addEventListener('trellisHistoryBeforeRestore', function () { // NEW
        try { clearAllHighlights(); } catch (e) { } // NEW
    }); // NEW

    window.addEventListener('trellisHistoryAfterRestore', function () { // NEW
        try { refreshCurrentHighlight(); } catch (e) { } // NEW
        try { linkOverlays.refreshAll(); } catch (e) { } // NEW
        try { taskScheduleOverlay.refresh(); } catch (e) { } // NEW
    }); // NEW


    vertexLinkLog('[ManualLinker] Plugin loaded.');
});
