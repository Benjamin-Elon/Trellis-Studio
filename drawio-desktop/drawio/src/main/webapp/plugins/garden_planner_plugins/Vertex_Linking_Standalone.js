/**
 * Draw.io Plugin: Manual Vertex Linker with Highlight and Overlay Navigation
 * - Right-click to link/unlink selected vertices
 * - Highlights linked vertices and draws dashed edges
 * - Left-click a visible link or link label to navigate between linked vertices
 */
Draw.loadPlugin(function (ui) {
    const graph = ui.editor.graph;
    let model = graph.getModel();

    const LINK_ATTR = 'linkedTo';
    const TILER_GROUP_CREATED_EVENT = 'usl:tilerGroupCreated';
    const TRELLIS_SELECTION_VISUALS_REFRESH_EVENT = 'trellisSelectionVisualsRefresh';
    const HL_TAG_KEY = 'manualLinkHL';
    const HL_OLD_COLOR = 'manualLinkOldColor';
    const HL_OLD_WIDTH = 'manualLinkOldWidth';
    const DEBUG_VERTEX_LINKING_CONSOLE = false;
    const GRAPH_OVERLAY_Z = Object.freeze({ ANNOTATION: 10000, CONNECTION: 10010, CONTROL: 10020, CONTROL_TOP: 10030 });
    const GRAPH_OVERLAY_LAYER_CLASS = Object.freeze({ annotation: 'trellis-graph-annotation-layer', connection: 'trellis-graph-connection-layer', control: 'trellis-graph-control-layer', controlTop: 'trellis-graph-control-top-layer' });
    const GRAPH_OVERLAY_LAYER_Z = Object.freeze({ annotation: GRAPH_OVERLAY_Z.ANNOTATION, connection: GRAPH_OVERLAY_Z.CONNECTION, control: GRAPH_OVERLAY_Z.CONTROL, controlTop: GRAPH_OVERLAY_Z.CONTROL_TOP });
    const LINK_ENDPOINT_CENTER_OFFSET_PX = 5;
    const LINK_LABEL_STAGGER_PX = 15;
    graph.__ctrlToggleHandled = false;

    function applyVertexButtonStyle(button, variant, options) {
        if (window.Trellis && window.Trellis.ui && typeof window.Trellis.ui.applyButtonStyle === 'function') {
            window.Trellis.ui.applyButtonStyle(button, variant, options);
        } else if (button) {
            const normalized = variant || 'neutral'; // CHANGE
            const activeOpen = normalized === 'open' && options && options.active === true; // NEW
            const style = { open: ['#2563eb', activeOpen ? '#1e3a8a' : '#1d4ed8', activeOpen ? '#eff6ff' : '#fff'], add: ['#188038', '#166534', '#fff'], close: ['#b91c1c', '#b91c1c', '#fff'], danger: ['#b91c1c', '#fff', '#b91c1c'], neutral: ['#6b7280', '#111827', '#fff'] }[normalized] || ['#6b7280', '#111827', '#fff']; // NEW
            button.setAttribute('data-trellis-button-variant', normalized); // CHANGE
            button.style.border = '1px solid ' + style[0]; // NEW
            button.style.color = style[1]; // NEW
            button.style.background = style[2]; // NEW
            if (activeOpen) button.style.fontWeight = '700'; // NEW
        }
        return button;
    }

    // -------------------- Helpers --------------------

    function vertexLinkLog() {
        if (!DEBUG_VERTEX_LINKING_CONSOLE) return;
        try { console.log.apply(console, arguments); } catch (_) { }
    }

    function ensureGraphOverlayContainer() {
        const host = graph.container;
        if (!host) return null;
        try {
            if (window.getComputedStyle && window.getComputedStyle(host).position === 'static') host.style.position = 'relative';
        } catch (_) { }
        return host;
    }

    function ensureGraphOverlayHtmlLayer(layerKey) {
        const host = ensureGraphOverlayContainer();
        const key = GRAPH_OVERLAY_LAYER_CLASS[layerKey] ? layerKey : 'control';
        const className = GRAPH_OVERLAY_LAYER_CLASS[key];
        if (!host || !className) return null;
        let layer = host.querySelector('.' + className);
        if (!layer) {
            layer = document.createElement('div');
            layer.className = className;
            layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:' + GRAPH_OVERLAY_LAYER_Z[key] + ';';
            host.appendChild(layer);
        }
        return layer;
    }

    function ensureGraphOverlaySvgLayer(layerKey) {
        const layer = ensureGraphOverlayHtmlLayer(layerKey || 'connection');
        if (!layer) return null;
        layer.style.width = '100%';
        layer.style.height = '100%';
        let svg = layer.querySelector('svg.trellis-graph-connection-svg');
        if (!svg) {
            svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('class', 'trellis-graph-connection-svg');
            svg.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:auto;';
            layer.appendChild(svg);
        }
        return svg;
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

    function isGardenModuleCell(cell) {
        return !!cell && getAttr(cell, 'garden_module') === '1';
    }

    function isGardenDashboardCell(cell) {
        return !!cell && getAttr(cell, 'garden_dashboard') === '1';
    }

    function findGardenModuleAncestor(cell) {
        let cur = cell;
        while (cur) {
            if (isGardenModuleCell(cur)) return cur;
            cur = model.getParent(cur);
        }
        return null;
    }

    function findDashboardCellInModule(moduleCell) {
        if (!moduleCell) return null;
        const stack = [moduleCell];
        while (stack.length) {
            const cur = stack.pop();
            const count = model.getChildCount(cur);
            for (let i = 0; i < count; i++) {
                const child = model.getChildAt(cur, i);
                if (!child) continue;
                if (isGardenDashboardCell(child)) return child;
                stack.push(child);
            }
        }
        return null;
    }

    function getDashboardYearForCell(cell) {
        const moduleCell = findGardenModuleAncestor(cell);
        const dashboard = findDashboardCellInModule(moduleCell);
        const year = Number(getAttr(dashboard, 'dashboard_year'));
        return Number.isFinite(year) && year > 1900 && year < 3000 ? year : new Date().getFullYear();
    }

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

    function taskDateRangeOverlapsYear(card, year) {
        const range = getTaskDateRange(card);
        const selectedYear = Number(year);
        if (!range || !Number.isFinite(selectedYear)) return false;
        const startDay = Math.floor(Date.UTC(selectedYear, 0, 1) / 86400000);
        const endDay = Math.floor(Date.UTC(selectedYear, 11, 31) / 86400000);
        return range.startDay <= endDay && range.endDay >= startDay;
    }

    function getTaskOverlayYears(cards) {
        const years = new Set();
        for (const card of cards || []) {
            const range = getTaskDateRange(card);
            if (!range) continue;
            for (let year = range.start.date.getUTCFullYear(); year <= range.end.date.getUTCFullYear(); year++) {
                if (year > 1900 && year < 3000) years.add(year);
            }
        }
        return Array.from(years).sort((a, b) => a - b);
    }

    function chooseDefaultOverlayYear(years) {
        const list = Array.isArray(years) ? years : [];
        if (!list.length) return null;
        const currentYear = new Date().getFullYear();
        return list.indexOf(currentYear) >= 0 ? currentYear : list[0];
    }

    function formatTaskOverlayDate(dateInfo) {
        if (!dateInfo || !dateInfo.date) return '';
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return months[dateInfo.date.getUTCMonth()] + ' ' + String(dateInfo.date.getUTCDate()).padStart(2, '0');
    }

    function formatTaskDateRange(card) {
        const range = getTaskDateRange(card);
        if (!range) return 'Unscheduled';
        const startLabel = formatTaskOverlayDate(range.start);
        const endLabel = formatTaskOverlayDate(range.end);
        return range.startDay === range.endDay ? startLabel : (startLabel + ' - ' + endLabel);
    }

    function stripTaskBadgeText(raw) {
        const text = stripHtmlAndPlaceholders(String(raw || ''));
        return text.length > 36 ? text.slice(0, 33) + '...' : text;
    }

    function getTaskLaneColor(card) {
        return getLaneColorForCard(card) || '#9aa0a6';
    }

    function getTaskOverlayBadges(card) {
        const badges = [];
        const rawBadges = stripTaskBadgeText(getAttr(card, 'badges_html'));
        if (rawBadges) badges.push(rawBadges);
        const repeatBadge = getAttr(card, 'repeat_badge');
        if (repeatBadge) badges.push('Repeat ' + repeatBadge);
        const note = stripTaskBadgeText(getAttr(card, 'card_note'));
        if (note) badges.push('Note ' + note);
        if (getAttr(card, 'date_override') === '1') badges.push('Dates edited');
        const linkCount = getLinkSet(card).size;
        if (linkCount > 1) badges.push('Links ' + linkCount);
        return badges;
    }

    function normalizeRepeatIdentityText(value) {
        return String(value == null ? '' : value).trim().toLowerCase();
    }

    function normalizeRepeatLinkedIds(value) {
        return Array.from(new Set(String(value == null ? '' : value)
            .split(',')
            .map(id => id.trim())
            .filter(Boolean)))
            .sort();
    }

    function buildRepeatSeriesKeyForOverlay(card) {
        const linkedIds = normalizeRepeatLinkedIds(getAttr(card, LINK_ATTR));
        if (linkedIds.length === 0) return null;

        return JSON.stringify([
            linkedIds,
            normalizeRepeatIdentityText(getAttr(card, 'plant_name')),
            normalizeRepeatIdentityText(getAttr(card, 'method')),
            normalizeRepeatIdentityText(getAttr(card, 'title'))
        ]);
    }

    function compareRepeatOccurrenceCards(a, b) {
        const aRange = getTaskDateRange(a);
        const bRange = getTaskDateRange(b);
        if (aRange && bRange && aRange.startDay !== bRange.startDay) return aRange.startDay - bRange.startDay;
        if (aRange && !bRange) return -1;
        if (!aRange && bRange) return 1;
        if (aRange && bRange && aRange.endDay !== bRange.endDay) return aRange.endDay - bRange.endDay;
        return String(a && a.id || '').localeCompare(String(b && b.id || ''));
    }

    function isOverlayCardVisibilityEligible(card) {
        return getAttr(card, 'year_hidden') !== '1' && getAttr(card, 'repeat_hidden') !== '1';
    }

    function getLaneOrderIndex(lane) {
        if (!lane) return Number.POSITIVE_INFINITY;
        const parent = model.getParent(lane);
        if (!parent) return Number.POSITIVE_INFINITY;
        const count = model.getChildCount(parent);
        for (let i = 0; i < count; i++) {
            if (model.getChildAt(parent, i) === lane) return i;
        }
        return Number.POSITIVE_INFINITY;
    }

    function cleanOverlayLaneLabel(label) {
        return stripHtmlAndPlaceholders(String(label || '')).replace(/\s*\(Page\s+\d+\s*\/\s*\d+\)\s*$/i, '').trim();
    }

    function getLaneGroupLabel(card, lane, laneKey) {
        if (lane) {
            const explicit = getAttr(lane, 'label') || getAttr(lane, 'status');
            if (explicit) return cleanOverlayLaneLabel(explicit);
            if (typeof lane.value === 'string' && lane.value) return cleanOverlayLaneLabel(lane.value);
            if (lane.value && lane.value.textContent) return cleanOverlayLaneLabel(lane.value.textContent);
        }
        return laneKey || getAttr(card, 'status') || 'Unlaned';
    }

    function makeLaneGroupForCard(card) {
        const lane = findLaneAncestor(card);
        const laneKey = getLaneStatusKeyForTask(card) || (lane ? getAttr(lane, 'lane_key') : null) || 'UNLANED';
        return {
            lane,
            laneId: lane && lane.id ? lane.id : laneKey,
            laneKey,
            label: getLaneGroupLabel(card, lane, laneKey),
            color: getTaskLaneColor(card),
            order: getLaneOrderIndex(lane),
            items: []
        };
    }

    function withRepeatOverlayBadge(item, badgeText) {
        item.repeatBadge = badgeText || '';
        return item;
    }

    function groupLinkedTasksForOverlay(cards) {
        const groupsByLane = new Map();

        function getGroup(card) {
            const lane = findLaneAncestor(card);
            const laneKey = getLaneStatusKeyForTask(card) || (lane ? getAttr(lane, 'lane_key') : null) || 'UNLANED';
            const laneId = lane && lane.id ? lane.id : laneKey;
            if (!groupsByLane.has(laneId)) groupsByLane.set(laneId, makeLaneGroupForCard(card));
            return groupsByLane.get(laneId);
        }

        const recordsByLaneAndSeries = new Map();
        for (const card of cards || []) {
            if (!card || getAttr(card, 'year_hidden') === '1') continue;
            const group = getGroup(card);
            const seriesKey = buildRepeatSeriesKeyForOverlay(card);

            if (!seriesKey) {
                if (isOverlayCardVisibilityEligible(card)) group.items.push({ card, repeatBadge: '' });
                continue;
            }

            const laneSeriesKey = group.laneId + '|' + seriesKey;
            if (!recordsByLaneAndSeries.has(laneSeriesKey)) {
                recordsByLaneAndSeries.set(laneSeriesKey, { group, seriesKey, cards: [] });
            }
            recordsByLaneAndSeries.get(laneSeriesKey).cards.push(card);
        }

        for (const series of recordsByLaneAndSeries.values()) {
            const ordered = series.cards.slice().sort(compareRepeatOccurrenceCards);
            const candidates = ordered.filter(isOverlayCardVisibilityEligible);
            if (!candidates.length) continue;
            const representative = candidates[0];
            const globalIndex = ordered.indexOf(representative);
            const hiddenInLane = Math.max(0, ordered.length - 1);
            const badge = ordered.length > 1
                ? ((globalIndex + 1) + '/' + ordered.length + (hiddenInLane > 0 ? ' +' + hiddenInLane : ''))
                : '';
            series.group.items.push(withRepeatOverlayBadge({ card: representative }, badge));
        }

        const groups = Array.from(groupsByLane.values())
            .map(group => {
                group.items.sort((a, b) => compareTaskCardsByStartDate(a.card, b.card));
                return group;
            })
            .filter(group => group.items.length > 0)
            .sort((a, b) => (a.order - b.order) || String(a.label || '').localeCompare(String(b.label || '')));

        return groups;
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
                    color: color || '#ff0000',
                    label: label || '',
                    labelOffset: normalizeLabelOffset(labelOffset),
                    poly: null,
                    labelElt: null
                };
                registry.set(key, entry);
            } else {
                entry.exitHint = exitHint || null;
                entry.color = color || '#ff0000';
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

    // -------------------- Linked Task Schedule Overlay Manager --------------------
    // DOM-only task schedule panel plus mxPolyline guide lines; no model or undo changes.
    const taskScheduleOverlay = (function () {
        const MODE_CARDS = 'cards';
        const MODE_SCHEDULE = 'schedule';
        const MODE_SPACING = 'spacing';
        const PANEL_WIDTH = 380;
        const PANEL_GAP = 12;
        const PANEL_SIDE_OFFSET = 60;
        const BODY_MAX_HEIGHT = 360;
        const registry = new Map(); // sourceId -> entry
        const selectedYearBySource = new Map(); // sourceId -> session-only year
        const LANE_COLLAPSE_STORAGE_KEY = 'trellis.vertexLinker.taskOverlay.collapsedLanes.v1';
        const laneCollapseState = new Map(); // laneKey -> collapsed boolean
        let laneCollapseLoaded = false;
        let activeMode = MODE_CARDS;

        function getOverlayPane() {
            const layeredPane = ensureGraphOverlaySvgLayer('connection');
            if (layeredPane) return layeredPane;
            const view = graph.getView && graph.getView();
            return view && view.getOverlayPane ? view.getOverlayPane() : null;
        }

        function getPanelHost() {
            const host = graph.container;
            if (!host) return null;
            try {
                if (window.getComputedStyle(host).position === 'static') {
                    host.style.position = 'relative';
                }
            } catch (_) { }
            return host;
        }

        function getPanelLayer() {
            return ensureGraphOverlayHtmlLayer('control'); // CHANGE: task schedule panels must stay on the graph control layer below dialogs.
        }

        function removeNode(node) {
            if (node && node.parentNode) node.parentNode.removeChild(node);
        }

        function removePolyline(poly) {
            if (poly && poly.node && poly.node.parentNode) {
                poly.node.parentNode.removeChild(poly.node);
            }
        }

        function loadLaneCollapseState() {
            if (laneCollapseLoaded) return;
            laneCollapseLoaded = true;
            try {
                const raw = window.localStorage && window.localStorage.getItem(LANE_COLLAPSE_STORAGE_KEY);
                const parsed = raw ? JSON.parse(raw) : null;
                if (!parsed || typeof parsed !== 'object') return;
                for (const key in parsed) {
                    if (Object.prototype.hasOwnProperty.call(parsed, key)) laneCollapseState.set(key, parsed[key] === true);
                }
            } catch (_) { }
        }

        function saveLaneCollapseState() {
            try {
                if (!window.localStorage) return;
                const out = {};
                laneCollapseState.forEach((collapsed, key) => { out[key] = !!collapsed; });
                window.localStorage.setItem(LANE_COLLAPSE_STORAGE_KEY, JSON.stringify(out));
            } catch (_) { }
        }

        function laneCollapseKey(group) {
            return String(group && (group.laneKey || group.label || group.laneId) || 'UNLANED');
        }

        function isLaneGroupCollapsed(group) {
            loadLaneCollapseState();
            return laneCollapseState.get(laneCollapseKey(group)) === true;
        }

        function setLaneGroupCollapsed(group, collapsed) {
            loadLaneCollapseState();
            laneCollapseState.set(laneCollapseKey(group), !!collapsed);
            saveLaneCollapseState();
        }

        function normalizeBadgeText(text) {
            return stripHtmlAndPlaceholders(String(text || '')).trim();
        }

        function isValidOverlayCard(card) {
            return !!card && model.isVertex(card) && isKanbanCard(card) && !!findKanbanBoardAncestor(card);
        }

        function taskTitle(card) {
            return getAttr(card, 'title') || getRawTextLabel(card) || card.id || 'Task';
        }

        function getSourceCropTitle(source) {
            if (!source) return '';
            const plant = normalizeBadgeText(getAttr(source, 'plant_name') || getAttr(source, 'crop_name') || '');
            const variety = normalizeBadgeText(getAttr(source, 'variety_name') || getAttr(source, 'variety') || '');
            if (plant && variety) return plant + ' - ' + variety;
            return plant || variety; // CHANGE: selected planting overlays use only crop/variety, never task/link metadata.
        }

        function getOverlayTitle(entry) {
            const source = entry && entry.sourceId ? model.getCell(entry.sourceId) : null;
            return getSourceCropTitle(source) || 'Planting'; // CHANGE: title reflects the selected crop instead of the overlay's task internals.
        }

        function getScheduleOnlyTitle(entry) {
            const source = entry && entry.sourceId ? model.getCell(entry.sourceId) : null;
            return getSourceCropTitle(source) || 'Planting'; // CHANGE: schedule-only overlay follows the same crop/variety title rule.
        }

        function hasTilerSchedule(cell) {
            const start = getAttr(cell, 'sow_date');
            return start != null && String(start).trim() !== '';
        }

        function canScheduleTilerGroup(cell) {
            if (!isTilerGroup(cell)) return false;
            const users = window.Trellis && window.Trellis.users;
            if (users && typeof users.isEnabled === 'function' && users.isEnabled() && typeof users.canManagePlanting === 'function') return users.canManagePlanting(cell);
            return true;
        }

        function getOccupancyNavigatorApi() {
            return graph && graph.__trellisBedSuccessionNavigator && typeof graph.__trellisBedSuccessionNavigator.getSelectedClusterOccupancy === 'function'
                ? graph.__trellisBedSuccessionNavigator
                : null;
        }

        function getPlantingOccupancyRange(cell) {
            const perennial = String(getAttr(cell, 'perennial') || '') === '1' || !!String(getAttr(cell, 'lifespan_start') || '').trim();
            const start = perennial ? parseTaskOverlayDate(getAttr(cell, 'lifespan_start')) : (parseTaskOverlayDate(getAttr(cell, 'transplant_date')) || parseTaskOverlayDate(getAttr(cell, 'sow_date')));
            const end = perennial ? parseTaskOverlayDate(getAttr(cell, 'lifespan_end')) : parseTaskOverlayDate(getAttr(cell, 'harvest_end'));
            if (!start || !end || end.dayNumber < start.dayNumber) return { startISO: null, endISO: null };
            return { startISO: start.iso, endISO: end.iso };
        }

        function fallbackOccupancyForSource(source) {
            if (!isTilerGroup(source)) return { selectedId: null, items: [] };
            const range = getPlantingOccupancyRange(source);
            return {
                selectedId: source.id,
                items: [{ cellId: source.id, label: getSourceCropTitle(source) || 'Planting', startISO: range.startISO, endISO: range.endISO }]
            };
        }

        function getOccupancyModelForEntry(entry) {
            const source = entry && entry.sourceId ? model.getCell(entry.sourceId) : null;
            const api = getOccupancyNavigatorApi();
            if (api) {
                const result = api.getSelectedClusterOccupancy(source);
                if (result && Array.isArray(result.items) && result.items.length) return result;
            }
            return fallbackOccupancyForSource(source);
        }

        function getScheduleDialogOpener() {
            return window.USL && window.USL.scheduler && typeof window.USL.scheduler.openScheduleDialog === 'function'
                ? window.USL.scheduler.openScheduleDialog
                : null;
        }

        function getDerivedScheduleDialogOpener() {
            return window.USL && window.USL.scheduler && typeof window.USL.scheduler.openDerivedScheduleDialog === 'function'
                ? window.USL.scheduler.openDerivedScheduleDialog
                : null;
        }

        function getSetPlantDialogOpener() {
            return window.USL && window.USL.scheduler && typeof window.USL.scheduler.openSetPlantDialog === 'function'
                ? window.USL.scheduler.openSetPlantDialog
                : null;
        }

        function sourceOccupancyCompleteForDerived(cell) {
            if (!isTilerGroup(cell)) return false;
            const perennial = String(getAttr(cell, 'perennial') || '') === '1' || !!String(getAttr(cell, 'lifespan_start') || '').trim();
            const start = perennial ? String(getAttr(cell, 'lifespan_start') || '').trim() : (String(getAttr(cell, 'transplant_date') || '').trim() || String(getAttr(cell, 'sow_date') || '').trim());
            const end = perennial ? String(getAttr(cell, 'lifespan_end') || '').trim() : String(getAttr(cell, 'harvest_end') || '').trim();
            return !!(start && end);
        }

        function sourceIsAnnual(cell) {
            if (String(getAttr(cell, 'perennial') || '') === '1' || String(getAttr(cell, 'lifespan_start') || '').trim()) return false;
            return String(getAttr(cell, 'annual') || '') === '1' || !!String(getAttr(cell, 'harvest_end') || '').trim();
        }

        function styleDerivedActionButton(button, enabled, color) {
            applyVertexButtonStyle(button, 'add', { compact: true });
            button.style.border = '1px solid ' + color;
            button.style.borderRadius = '5px';
            button.style.background = enabled ? '#ffffff' : '#f1f3f4';
            button.style.color = enabled ? color : '#9aa0a6';
            button.style.cursor = enabled ? 'pointer' : 'default';
            button.style.fontSize = '10px';
            button.style.fontWeight = 'bold';
            button.style.padding = '4px 7px';
            button.style.whiteSpace = 'nowrap';
        }

        function createDerivedScheduleActionButton(entry, mode) {
            const source = entry && entry.sourceId ? model.getCell(entry.sourceId) : null;
            if (!isTilerGroup(source) || !hasTilerSchedule(source)) return null;
            const opener = getDerivedScheduleDialogOpener();
            const allowed = canScheduleTilerGroup(source);
            const hasDates = sourceOccupancyCompleteForDerived(source);
            const annualOk = mode !== 'turnover' || sourceIsAnnual(source);
            const enabled = !!(opener && allowed && hasDates && annualOk);
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = mode === 'turnover' ? 'Add Turnover' : 'Add Companion';
            button.disabled = !enabled;
            button.title = !opener ? 'Scheduler plugin is unavailable.' : (!allowed ? 'You do not have permission to schedule this planting group.' : (!hasDates ? 'Source occupancy dates are required.' : (!annualOk ? 'Turnover is available only for annual source groups.' : button.textContent)));
            styleDerivedActionButton(button, enabled, '#166534');
            mxEvent.addListener(button, 'mousedown', consumeOverlayControlEvent);
            mxEvent.addListener(button, 'dblclick', consumeOverlayControlEvent);
            mxEvent.addListener(button, 'click', async function (evt) {
                consumeOverlayControlEvent(evt);
                if (!enabled) return;
                const liveSource = model.getCell(entry.sourceId);
                if (!isTilerGroup(liveSource)) return;
                try {
                    await opener(ui, liveSource, { mode });
                    setTimeout(refresh, 0);
                } catch (e) {
                    mxUtils.alert('Derived scheduling error: ' + (e && e.message ? e.message : String(e)));
                }
            });
            return button;
        }

        function hasAssignedPlant(cell) {
            const plantName = getAttr(cell, 'plant_name');
            return plantName != null && String(plantName).trim() !== '';
        }

        function getTaskLinkLabelBadge(entry, card) {
            if (!entry || !entry.linkLabels || !card) return '';
            const label = normalizeBadgeText(entry.linkLabels.get(card.id));
            if (!label) return '';
            const title = normalizeBadgeText(taskTitle(card));
            return label.toLowerCase() === title.toLowerCase() ? '' : label;
        }

        function applyPanelStyle(panel) {
            panel.style.position = 'absolute';
            panel.style.zIndex = String(GRAPH_OVERLAY_Z.CONTROL);
            panel.style.width = PANEL_WIDTH + 'px';
            panel.style.boxSizing = 'border-box';
            panel.style.padding = '8px';
            panel.style.border = '1px solid rgba(60, 64, 67, 0.28)';
            panel.style.borderRadius = '6px';
            panel.style.background = 'rgba(255, 255, 255, 0.97)';
            panel.style.boxShadow = '0 3px 10px rgba(0, 0, 0, 0.20)';
            panel.style.fontFamily = 'Arial, Helvetica, sans-serif';
            panel.style.fontSize = '11px';
            panel.style.lineHeight = '16px';
            panel.style.pointerEvents = 'all';
            panel.style.color = '#202124';
        }

        function makeTextSpan(text, color) {
            const span = document.createElement('span');
            span.textContent = text || '';
            span.style.overflow = 'hidden';
            span.style.textOverflow = 'ellipsis';
            span.style.whiteSpace = 'nowrap';
            if (color) span.style.color = color;
            return span;
        }

        function makeClickableRow(card, className) {
            const row = document.createElement('div');
            row.className = className || '';
            row.setAttribute('title', 'Click to navigate to task');
            const cardId = card.id;
            mxEvent.addListener(row, 'mousedown', function (evt) {
                if (evt.button != null && evt.button !== 0) return;
                const realCard = model.getCell(cardId);
                if (realCard && model.isVertex(realCard)) selectAndReveal(realCard);
                mxEvent.consume(evt);
                if (evt.stopPropagation) evt.stopPropagation();
                if (evt.preventDefault) evt.preventDefault();
            });
            return row;
        }

        function makeBadge(text) {
            const badge = document.createElement('span');
            badge.textContent = text;
            badge.style.display = 'inline-block';
            badge.style.maxWidth = '150px';
            badge.style.overflow = 'hidden';
            badge.style.textOverflow = 'ellipsis';
            badge.style.whiteSpace = 'nowrap';
            badge.style.padding = '1px 6px';
            badge.style.border = '1px solid rgba(60, 64, 67, 0.25)';
            badge.style.borderRadius = '10px';
            badge.style.background = '#f8f9fa';
            badge.style.color = '#3c4043';
            badge.style.fontSize = '10px';
            badge.style.lineHeight = '14px';
            return badge;
        }

        function makeYearControlButton(text, disabled) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = text;
            button.disabled = !!disabled;
            button.style.width = '24px';
            button.style.height = '22px';
            button.style.border = '1px solid rgba(60, 64, 67, 0.28)';
            button.style.borderRadius = '5px';
            button.style.background = disabled ? '#f1f3f4' : '#ffffff';
            button.style.color = disabled ? '#9aa0a6' : '#202124';
            button.style.cursor = disabled ? 'default' : 'pointer';
            button.style.padding = '0';
            button.style.lineHeight = '18px';
            return button;
        }

        function consumeOverlayControlEvent(evt) {
            try { mxEvent.consume(evt); } catch (_) { }
            if (evt && evt.stopPropagation) evt.stopPropagation();
            if (evt && evt.preventDefault) evt.preventDefault();
        }

        function scheduleActionButtonLabelFor(source) {
            return hasTilerSchedule(source) ? 'Edit schedule' : 'Set schedule'; // CHANGE: legacy companion identity no longer changes schedule editing copy.
        }

        function scheduleActionButtonTitleFor(source, opener, allowed) {
            if (!allowed) return 'You do not have permission to schedule this planting group.';
            if (!opener) return 'Scheduler plugin is unavailable.';
            return scheduleActionButtonLabelFor(source);
        }

        function createScheduleActionButton(entry) {
            const source = entry && entry.sourceId ? model.getCell(entry.sourceId) : null;
            if (!isTilerGroup(source)) return null;
            const opener = getScheduleDialogOpener();
            const allowed = canScheduleTilerGroup(source);
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = scheduleActionButtonLabelFor(source);
            button.title = scheduleActionButtonTitleFor(source, opener, allowed);
            button.disabled = !opener || !allowed;
            applyVertexButtonStyle(button, 'open', { compact: true });
            button.style.border = '1px solid #2563eb';
            button.style.borderRadius = '5px';
            button.style.background = opener && allowed ? '#ffffff' : '#f1f3f4';
            button.style.color = opener && allowed ? '#1d4ed8' : '#9aa0a6';
            button.style.cursor = opener && allowed ? 'pointer' : 'default';
            button.style.fontSize = '10px';
            button.style.fontWeight = 'bold';
            button.style.padding = '4px 7px';
            button.style.whiteSpace = 'nowrap';
            mxEvent.addListener(button, 'mousedown', consumeOverlayControlEvent);
            mxEvent.addListener(button, 'dblclick', consumeOverlayControlEvent);
            mxEvent.addListener(button, 'click', async function (evt) {
                consumeOverlayControlEvent(evt);
                if (!opener) return;
                const liveSource = model.getCell(entry.sourceId);
                if (!isTilerGroup(liveSource)) return;
                if (!canScheduleTilerGroup(liveSource)) return;
                try {
                    await opener(ui, liveSource);
                    setTimeout(refresh, 0);
                } catch (e) {
                    mxUtils.alert('Scheduling error: ' + (e && e.message ? e.message : String(e)));
                }
            });
            return button;
        }

        function createSetPlantActionButton(entry) {
            const source = entry && entry.sourceId ? model.getCell(entry.sourceId) : null;
            if (!isTilerGroup(source) || hasAssignedPlant(source)) return null;
            const opener = getSetPlantDialogOpener();
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = 'Set plant';
            button.title = opener ? 'Set plant' : 'Scheduler plant picker is unavailable.';
            button.disabled = !opener;
            applyVertexButtonStyle(button, 'add', { compact: true });
            button.style.border = '1px solid #188038';
            button.style.borderRadius = '5px';
            button.style.background = opener ? '#ffffff' : '#f1f3f4';
            button.style.color = opener ? '#137333' : '#9aa0a6';
            button.style.cursor = opener ? 'pointer' : 'default';
            button.style.fontSize = '10px';
            button.style.fontWeight = 'bold';
            button.style.padding = '4px 7px';
            button.style.whiteSpace = 'nowrap';
            mxEvent.addListener(button, 'mousedown', consumeOverlayControlEvent);
            mxEvent.addListener(button, 'dblclick', consumeOverlayControlEvent);
            mxEvent.addListener(button, 'click', async function (evt) {
                consumeOverlayControlEvent(evt);
                if (!opener) return;
                const liveSource = model.getCell(entry.sourceId);
                if (!isTilerGroup(liveSource) || hasAssignedPlant(liveSource)) return;
                try {
                    await opener(ui, liveSource);
                    setTimeout(refresh, 0);
                } catch (e) {
                    mxUtils.alert('Set Plant error: ' + (e && e.message ? e.message : String(e)));
                }
            });
            return button;
        }

        function createSecondaryActionRow(entry) {
            const setPlantButton = createSetPlantActionButton(entry);
            if (!setPlantButton) return null;
            const row = document.createElement('div');
            row.style.gridColumn = '1 / span 2';
            row.style.display = 'flex';
            row.style.justifyContent = 'flex-end';
            row.style.marginTop = '7px';
            row.appendChild(setPlantButton);
            return row;
        }

        function applyOverlayYearFilter(entry, year) {
            if (!entry || !Number.isFinite(Number(year))) return;
            const selectedYear = Number(year);
            const cards = entry.targetIds.map(id => model.getCell(id)).filter(isValidOverlayCard);
            model.beginUpdate();
            try {
                for (const card of cards) {
                    const hidden = !taskDateRangeOverlapsYear(card, selectedYear);
                    const nextValue = hidden ? '1' : null;
                    if (getAttr(card, 'year_hidden') !== (nextValue || null)) setCellAttrUndoable(card, 'year_hidden', nextValue);
                }
            } finally {
                model.endUpdate();
            }
            entry.selectedYear = selectedYear;
            selectedYearBySource.set(entry.sourceId, selectedYear);
            dispatchYearFilterChangedForTaskOverlay(null, selectedYear);
            renderEntry(entry);
        }

        function restoreEntryTasksToCurrentYear(entry) {
            if (!entry || !entry.targetIds) return;
            const cards = entry.targetIds.map(id => model.getCell(id)).filter(isValidOverlayCard);
            if (!cards.length) return;
            const source = model.getCell(entry.sourceId);
            const restoreYear = getDashboardYearForCell(source || cards[0]);
            if (Number(entry.selectedYear) === restoreYear) return;
            model.beginUpdate();
            try {
                for (const card of cards) {
                    const hidden = !taskDateRangeOverlapsYear(card, restoreYear);
                    const nextValue = hidden ? '1' : null;
                    if (getAttr(card, 'year_hidden') !== (nextValue || null)) setCellAttrUndoable(card, 'year_hidden', nextValue);
                }
            } finally {
                model.endUpdate();
            }
            selectedYearBySource.delete(entry.sourceId);
            dispatchYearFilterChangedForTaskOverlay(null, restoreYear);
        }

        function isEntryStillSelected(entry) {
            const selected = graph.getSelectionCells && graph.getSelectionCells();
            if (!entry || !selected || selected.length !== 1) return false;
            const selectedCell = normalizeForLinkingAndPrimary(selected[0]);
            return !!selectedCell && selectedCell.id === entry.sourceId;
        }

        function createYearControls(entry) {
            const years = entry && entry.years ? entry.years : [];
            if (years.length < 2) return null;
            const current = Number(entry.selectedYear);
            const idx = Math.max(0, years.indexOf(current));
            const wrap = document.createElement('div');
            wrap.style.gridColumn = '1 / span 2';
            wrap.style.display = 'flex';
            wrap.style.alignItems = 'center';
            wrap.style.gap = '5px';
            wrap.style.marginTop = '7px';

            const prev = makeYearControlButton('<', idx <= 0);
            const label = document.createElement('div');
            label.textContent = String(years[idx] || current || years[0]);
            label.style.minWidth = '48px';
            label.style.textAlign = 'center';
            label.style.border = '1px solid rgba(60, 64, 67, 0.28)';
            label.style.borderRadius = '5px';
            label.style.background = '#ffffff';
            label.style.fontWeight = 'bold';
            label.style.fontSize = '10px';
            label.style.lineHeight = '20px';
            const next = makeYearControlButton('>', idx >= years.length - 1);

            mxEvent.addListener(prev, 'mousedown', function (evt) {
                if (idx > 0) applyOverlayYearFilter(entry, years[idx - 1]);
                mxEvent.consume(evt);
                if (evt.stopPropagation) evt.stopPropagation();
                if (evt.preventDefault) evt.preventDefault();
            });
            mxEvent.addListener(next, 'mousedown', function (evt) {
                if (idx < years.length - 1) applyOverlayYearFilter(entry, years[idx + 1]);
                mxEvent.consume(evt);
                if (evt.stopPropagation) evt.stopPropagation();
                if (evt.preventDefault) evt.preventDefault();
            });

            wrap.appendChild(prev);
            wrap.appendChild(label);
            wrap.appendChild(next);
            return wrap;
        }

        function createHeader(entry, count) {
            const header = document.createElement('div');
            header.style.display = 'grid';
            header.style.gridTemplateColumns = '1fr auto';
            header.style.alignItems = 'center';
            header.style.columnGap = '8px';
            header.style.marginBottom = '8px';

            const titleWrap = document.createElement('div');
            const title = document.createElement('div');
            title.textContent = getOverlayTitle(entry);
            title.style.fontWeight = 'bold';
            title.style.fontSize = '12px';
            title.style.overflow = 'hidden';
            title.style.textOverflow = 'ellipsis';
            title.style.whiteSpace = 'nowrap';
            const subtitle = document.createElement('div');
            subtitle.textContent = activeMode === MODE_SPACING ? (count + (count === 1 ? ' planting row' : ' planting rows')) : (count + (count === 1 ? ' linked task' : ' linked tasks'));
            subtitle.style.color = '#5f6368';
            subtitle.style.fontSize = '10px';
            titleWrap.appendChild(title);
            titleWrap.appendChild(subtitle);
            header.appendChild(titleWrap);

            const actions = document.createElement('div');
            actions.style.display = 'inline-flex';
            actions.style.alignItems = 'center';
            actions.style.gap = '6px';
            actions.style.flexWrap = 'wrap';
            actions.style.justifyContent = 'flex-end';

            const toggle = document.createElement('div');
            toggle.style.display = 'inline-flex';
            toggle.style.border = '1px solid rgba(60, 64, 67, 0.28)';
            toggle.style.borderRadius = '5px';
            toggle.style.overflow = 'hidden';
            toggle.appendChild(createModeButton(entry, 'Cards', MODE_CARDS));
            toggle.appendChild(createModeButton(entry, 'Schedule', MODE_SCHEDULE));
            toggle.appendChild(createModeButton(entry, 'Spacing', MODE_SPACING));
            actions.appendChild(toggle);
            const scheduleButton = createScheduleActionButton(entry);
            if (scheduleButton) actions.appendChild(scheduleButton);
            const companionButton = createDerivedScheduleActionButton(entry, 'companion');
            if (companionButton) actions.appendChild(companionButton);
            const turnoverButton = createDerivedScheduleActionButton(entry, 'turnover');
            if (turnoverButton) actions.appendChild(turnoverButton);
            header.appendChild(actions);
            const secondaryActionRow = createSecondaryActionRow(entry);
            if (secondaryActionRow) header.appendChild(secondaryActionRow);
            const yearControls = createYearControls(entry);
            if (yearControls) header.appendChild(yearControls);
            return header;
        }

        function createScheduleOnlyHeader(entry) {
            const header = document.createElement('div');
            header.style.display = 'flex';
            header.style.flexDirection = 'column';
            header.style.alignItems = 'stretch';
            header.style.gap = '7px';

            const title = document.createElement('div');
            title.textContent = getScheduleOnlyTitle(entry);
            title.style.fontWeight = 'bold';
            title.style.fontSize = '12px';
            title.style.overflow = 'hidden';
            title.style.textOverflow = 'ellipsis';
            title.style.whiteSpace = 'nowrap';
            header.appendChild(title);

            const toggle = document.createElement('div');
            toggle.style.display = 'inline-flex';
            toggle.style.alignSelf = 'flex-start';
            toggle.style.border = '1px solid rgba(60, 64, 67, 0.28)';
            toggle.style.borderRadius = '5px';
            toggle.style.overflow = 'hidden';
            const effectiveMode = activeMode === MODE_SPACING ? MODE_SPACING : MODE_SCHEDULE;
            toggle.appendChild(createModeButton(entry, 'Schedule', MODE_SCHEDULE, effectiveMode));
            toggle.appendChild(createModeButton(entry, 'Spacing', MODE_SPACING, effectiveMode));
            header.appendChild(toggle);

            const scheduleButton = createScheduleActionButton(entry);
            if (scheduleButton) {
                scheduleButton.style.alignSelf = 'flex-start';
                header.appendChild(scheduleButton);
            }
            const companionButton = createDerivedScheduleActionButton(entry, 'companion');
            if (companionButton) { companionButton.style.alignSelf = 'flex-start'; header.appendChild(companionButton); }
            const turnoverButton = createDerivedScheduleActionButton(entry, 'turnover');
            if (turnoverButton) { turnoverButton.style.alignSelf = 'flex-start'; header.appendChild(turnoverButton); }
            const setPlantButton = createSetPlantActionButton(entry);
            if (setPlantButton) {
                setPlantButton.style.alignSelf = 'flex-start';
                header.appendChild(setPlantButton);
            }
            return header;
        }

        function createModeButton(entry, label, mode, activeOverride) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = label;
            button.style.border = '0';
            button.style.padding = '4px 7px';
            button.style.fontSize = '10px';
            button.style.cursor = 'pointer';
            const active = (activeOverride || activeMode) === mode;
            button.style.background = active ? '#202124' : '#ffffff';
            button.style.color = active ? '#ffffff' : '#202124';
            mxEvent.addListener(button, 'mousedown', function (evt) {
                setMode(mode);
                mxEvent.consume(evt);
                if (evt.stopPropagation) evt.stopPropagation();
                if (evt.preventDefault) evt.preventDefault();
            });
            return button;
        }

        function createBody() {
            const body = document.createElement('div');
            body.style.maxHeight = BODY_MAX_HEIGHT + 'px';
            body.style.overflowY = 'auto';
            body.style.overflowX = 'hidden';
            body.style.paddingRight = '2px';
            return body;
        }

        function renderEmptyTaskOverlayMessage(body) {
            const empty = document.createElement('div');
            empty.textContent = 'No linked tasks visible for this year';
            empty.style.color = '#5f6368';
            empty.style.padding = '8px 0';
            body.appendChild(empty);
        }

        function countGroupItems(groups) {
            return (groups || []).reduce((sum, group) => sum + group.items.length, 0);
        }

        function countScheduleRows(cards) {
            return buildScheduleRowsForCards(cards).length;
        }

        function countOccupancyRows(entry) {
            const occupancy = getOccupancyModelForEntry(entry);
            return occupancy && Array.isArray(occupancy.items) ? occupancy.items.length : 0;
        }

        function getLayoutTools() {
            return window.USL && window.USL.scheduler && window.USL.scheduler.layoutTools;
        }

        function countSpacingRows(entry) {
            if (entry && Array.isArray(entry.spacingRows)) return entry.spacingRows.length;
            const source = entry && entry.sourceId ? model.getCell(entry.sourceId) : null;
            const api = graph.__trellisBedSuccessionNavigator;
            const context = api && typeof api.getSelectedClusterLayoutContext === 'function' ? api.getSelectedClusterLayoutContext(source) : null;
            return context && Array.isArray(context.cellIds) && context.cellIds.length ? context.cellIds.length : 1;
        }

        const spacingPreviewState = { host: null, faded: [] };

        function clearSpacingPreview() {
            spacingPreviewState.faded.forEach(item => {
                if (item && item.node && item.node.style) item.node.style.opacity = item.opacity;
            });
            spacingPreviewState.faded = [];
            removeNode(spacingPreviewState.host);
            spacingPreviewState.host = null;
        }

        function fadeSpacingPreviewCell(cell) {
            const state = cell && graph.getView && graph.getView().getState(cell);
            const node = state && state.shape && state.shape.node;
            if (!node || !node.style) return;
            if (!spacingPreviewState.faded.some(item => item.node === node)) {
                spacingPreviewState.faded.push({ node, opacity: node.style.opacity || '' });
            }
            node.style.opacity = '0.28'; // CHANGE: draft spacing preview keeps the real group visible as context.
        }

        function modelRectToViewRect(rect) {
            const view = graph.getView && graph.getView();
            const scale = Number(view && view.scale) || 1;
            const translate = view && view.translate || { x: 0, y: 0 };
            return {
                x: (Number(rect.x || 0) + Number(translate.x || 0)) * scale,
                y: (Number(rect.y || 0) + Number(translate.y || 0)) * scale,
                width: Number(rect.width || 0) * scale,
                height: Number(rect.height || 0) * scale,
                scale
            };
        }

        function renderSpacingPreview(modelPreview) {
            clearSpacingPreview();
            const rows = modelPreview && Array.isArray(modelPreview.rows) ? modelPreview.rows : [];
            if (!rows.length) return;
            const host = ensureGraphOverlayHtmlLayer('annotation');
            if (!host) return;
            const preview = document.createElement('div');
            preview.className = 'manual-link-spacing-preview';
            preview.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;';
            rows.forEach(row => {
                const cell = row.cellId ? model.getCell(row.cellId) : null;
                fadeSpacingPreviewCell(cell);
                const rect = modelRectToViewRect(row.rect || {});
                const box = document.createElement('div');
                box.dataset.spacingPreviewCell = row.cellId || '';
                box.style.position = 'absolute';
                box.style.left = Math.round(rect.x) + 'px';
                box.style.top = Math.round(rect.y) + 'px';
                box.style.width = Math.round(rect.width) + 'px';
                box.style.height = Math.round(rect.height) + 'px';
                box.style.boxSizing = 'border-box';
                box.style.border = '2px dashed #1a73e8'; // CHANGE: spacing preview rows are ordinary planting rows, not anchor/companion roles.
                box.style.background = 'rgba(26,115,232,0.08)';
                preview.appendChild(box);
                (row.dots && row.dots.circles || []).forEach(dot => {
                    const circle = document.createElement('div');
                    circle.style.position = 'absolute';
                    const x = (Number(dot.x || 0) + Number((graph.getView() && graph.getView().translate && graph.getView().translate.x) || 0)) * rect.scale;
                    const y = (Number(dot.y || 0) + Number((graph.getView() && graph.getView().translate && graph.getView().translate.y) || 0)) * rect.scale;
                    const r = Math.max(2, Number(dot.r || 2.5) * rect.scale);
                    circle.style.left = Math.round(x - r) + 'px';
                    circle.style.top = Math.round(y - r) + 'px';
                    circle.style.width = Math.round(r * 2) + 'px';
                    circle.style.height = Math.round(r * 2) + 'px';
                    circle.style.borderRadius = '50%';
                    circle.style.background = '#2563eb'; // CHANGE: spacing dots share one planting style after companion identity removal.
                    circle.style.opacity = '0.78';
                    preview.appendChild(circle);
                });
            });
            host.appendChild(preview);
            spacingPreviewState.host = preview;
        }

        function spacingNumberInput(value, enabled) {
            const input = document.createElement('input');
            input.type = 'number';
            input.step = '1'; // CHANGE: native spacing-tab steppers move in whole-centimeter intervals while typed decimals remain valid.
            input.value = value == null ? '' : String(Math.round(Number(value) * 10) / 10);
            input.disabled = !enabled;
            input.style.width = '100%'; // CHANGE: fit all spacing fields inside the fixed overlay width.
            input.style.minWidth = '0';
            input.style.boxSizing = 'border-box';
            input.style.fontSize = '10px';
            input.style.padding = '2px 3px'; // CHANGE: compact numeric fields prevent clipped columns.
            input.style.textAlign = 'right'; // CHANGE: compact numeric columns stay readable.
            return input;
        }

        function spacingSelect(value, enabled) {
            const select = document.createElement('select');
            ['beside', 'interplant', 'staggered'].forEach(optionValue => {
                const option = document.createElement('option');
                option.value = optionValue;
                option.textContent = optionValue;
                select.appendChild(option);
            });
            select.value = value || 'beside';
            select.disabled = !enabled;
            select.style.width = '100%'; // CHANGE: let the spacing grid own column sizing.
            select.style.minWidth = '0'; // CHANGE: prevent the native select width from forcing overflow.
            select.style.fontSize = '10px';
            select.style.padding = '2px 3px'; // CHANGE: keep template control aligned with compact numeric fields.
            return select;
        }

        function spacingIdleStatus(rows) {
            const allRows = rows || [];
            const activeCount = allRows.filter(row => row && row.enabled !== false).length;
            const inactiveCount = allRows.length - activeCount;
            if (!activeCount && allRows.length) return 'No active rows in this occupancy window.'; // CHANGE: explain why preview/apply is unavailable.
            return inactiveCount ? 'Only active-window rows preview and apply.' : ''; // CHANGE: inactive rows are context, not editable targets.
        }

        function spacingDraftFromRowStates(rowStates) {
            return (rowStates || []).map(state => Object.assign({}, state.row, {
                spacingXCm: state.spacingX.value,
                spacingYCm: state.spacingY.value,
                offsetXCm: state.offsetX.value,
                offsetYCm: state.offsetY.value
            }));
        }

        function spacingRowChanged(state) {
            const row = state.row;
            return String(state.spacingX.value) !== String(row.spacingXCm == null ? '' : Math.round(Number(row.spacingXCm) * 10) / 10) ||
                String(state.spacingY.value) !== String(row.spacingYCm == null ? '' : Math.round(Number(row.spacingYCm) * 10) / 10) ||
                String(state.offsetX.value) !== String(row.offsetXCm == null ? '' : Math.round(Number(row.offsetXCm) * 10) / 10) ||
                String(state.offsetY.value) !== String(row.offsetYCm == null ? '' : Math.round(Number(row.offsetYCm) * 10) / 10);
        }

        function revertSpacingRowState(state) {
            const row = state.row.plantDefaultLayout || state.row; // CHANGE: row reset restores plant defaults when the scheduler exposes them.
            state.spacingX.value = row.spacingXCm == null ? '' : String(Math.round(Number(row.spacingXCm) * 10) / 10);
            state.spacingY.value = row.spacingYCm == null ? '' : String(Math.round(Number(row.spacingYCm) * 10) / 10);
            state.offsetX.value = row.offsetXCm == null ? '' : String(Math.round(Number(row.offsetXCm) * 10) / 10);
            state.offsetY.value = row.offsetYCm == null ? '' : String(Math.round(Number(row.offsetYCm) * 10) / 10);
        }

        const SPACING_ROW_GRID_COLUMNS = 'minmax(92px,1fr) repeat(4,minmax(42px,46px)) 24px'; // CHANGE: companion template column is gone; rows are uniform planting layout rows.

        function createSpacingGridRow(className) {
            const row = document.createElement('div');
            row.className = className || '';
            row.style.display = 'grid';
            row.style.gridTemplateColumns = SPACING_ROW_GRID_COLUMNS;
            row.style.columnGap = '4px';
            row.style.alignItems = 'center';
            row.style.width = '100%';
            row.style.minWidth = '0';
            return row; // CHANGE: each plant owns one grid row instead of relying on global CSS grid auto-placement.
        }

        function renderSpacingEditor(entry, body, context, tools) {
            body.innerHTML = '';
            entry.spacingRows = context.rows || [];
            const wrap = document.createElement('div');
            wrap.className = 'manual-link-spacing-editor';
            wrap.style.display = 'flex';
            wrap.style.flexDirection = 'column';
            wrap.style.gap = '6px';

            const rowsWrap = document.createElement('div');
            rowsWrap.className = 'manual-link-spacing-rows';
            rowsWrap.style.display = 'flex';
            rowsWrap.style.flexDirection = 'column';
            rowsWrap.style.gap = '5px';
            rowsWrap.style.width = '100%';
            rowsWrap.style.minWidth = '0';
            const headerRow = createSpacingGridRow('manual-link-spacing-header');
            ['Planting', 'Space X', 'Space Y', 'Off X', 'Off Y', ''].forEach(text => {
                const head = document.createElement('div');
                head.textContent = text;
                head.style.fontSize = '9px';
                head.style.color = '#5f6368';
                head.style.fontWeight = '700';
                head.style.minWidth = '0'; // CHANGE: headers no longer force the spacing grid wider than the panel.
                head.style.textAlign = text === 'Planting' ? 'left' : 'center'; // CHANGE: compact columns remain visually aligned.
                headerRow.appendChild(head);
            });
            rowsWrap.appendChild(headerRow);

            const rowStates = [];
            (context.rows || []).forEach(row => {
                const enabled = row.enabled !== false;
                const rowEl = createSpacingGridRow('manual-link-spacing-row');
                rowEl.dataset.spacingRowCell = row.cellId || '';
                const labelCell = document.createElement('div');
                labelCell.style.minWidth = '0';
                labelCell.style.display = 'flex';
                labelCell.style.flexDirection = 'column';
                labelCell.style.lineHeight = '12px';
                const label = makeTextSpan(row.label || row.cellId || 'Planting', enabled ? null : '#9aa0a6');
                label.style.fontWeight = row.selected ? '700' : '400';
                labelCell.appendChild(label);
                if (!enabled) {
                    const marker = document.createElement('span');
                    marker.textContent = 'Inactive';
                    marker.style.fontSize = '9px';
                    marker.style.color = '#9aa0a6';
                    marker.style.whiteSpace = 'nowrap';
                    marker.style.lineHeight = '10px';
                    labelCell.appendChild(marker); // CHANGE: disabled rows are explicitly outside the active occupancy window.
                }
                rowEl.appendChild(labelCell);

                const spacingX = spacingNumberInput(row.spacingXCm, enabled);
                const spacingY = spacingNumberInput(row.spacingYCm, enabled);
                const offsetX = spacingNumberInput(row.offsetXCm, enabled);
                const offsetY = spacingNumberInput(row.offsetYCm, enabled);
                [spacingX, spacingY, offsetX, offsetY].forEach(input => rowEl.appendChild(input));

                const revert = document.createElement('button');
                revert.type = 'button';
                revert.textContent = '↺'; // CHANGE: use a revert symbol instead of Reset text.
                revert.setAttribute('aria-label', 'Restore plant defaults'); // CHANGE: row reset targets the plant-table defaults.
                revert.title = 'Restore plant defaults'; // CHANGE: distinguish plant defaults from companion-set defaults.
                revert.style.fontSize = '12px';
                revert.style.lineHeight = '14px';
                revert.style.visibility = 'hidden'; // CHANGE: reserve the grid slot without exposing inactive actions.
                revert.style.pointerEvents = 'none';
                revert.disabled = !enabled;
                applyVertexButtonStyle(revert, 'neutral', { compact: true });
                revert.style.width = '100%'; // CHANGE: revert column stays fixed and aligned.
                revert.style.minWidth = '0';
                revert.style.padding = '2px 0'; // CHANGE: override shared compact padding to fit the icon column.
                rowEl.appendChild(revert);

                const state = { row, spacingX, spacingY, offsetX, offsetY, revert };
                rowStates.push(state);
                rowsWrap.appendChild(rowEl);
            });
            wrap.appendChild(rowsWrap);

            const defaultLabel = document.createElement('label');
            defaultLabel.style.display = 'none';
            defaultLabel.style.alignItems = 'center';
            defaultLabel.style.gap = '6px';
            defaultLabel.style.fontSize = '10px';
            defaultLabel.style.color = '#3c4043';
            const saveDefaults = document.createElement('input');
            saveDefaults.type = 'checkbox';
            defaultLabel.appendChild(saveDefaults);
            defaultLabel.appendChild(document.createTextNode('Save active rows as set default')); // CHANGE: defaults are anchorless active companion-set layouts.
            wrap.appendChild(defaultLabel);

            const status = document.createElement('div');
            status.style.minHeight = '14px';
            status.style.color = '#92400e';
            status.style.fontSize = '10px';
            status.style.fontWeight = '700';
            wrap.appendChild(status);
            const idleStatus = spacingIdleStatus(context.rows || []);
            status.textContent = idleStatus; // CHANGE: clarify inactive rows before edits begin.

            const actions = document.createElement('div');
            actions.style.display = 'flex';
            actions.style.gap = '6px';
            actions.style.justifyContent = 'flex-end';
            const applySetDefault = document.createElement('button');
            applySetDefault.type = 'button';
            applySetDefault.textContent = 'Apply set default';
            applySetDefault.style.display = context.hasSetDefault ? '' : 'none';
            applyVertexButtonStyle(applySetDefault, 'neutral', { compact: true });
            actions.appendChild(applySetDefault); // CHANGE: set defaults can be restored explicitly without editing a row first.
            const apply = document.createElement('button');
            apply.type = 'button';
            apply.textContent = 'Apply';
            apply.disabled = true;
            applyVertexButtonStyle(apply, 'add', { compact: true });
            actions.appendChild(apply);
            wrap.appendChild(actions);
            body.appendChild(wrap);

            function refreshDraftState() {
                const changed = rowStates.filter(state => state.row.enabled !== false && spacingRowChanged(state));
                rowStates.forEach(state => {
                    const showRevert = state.row.enabled !== false && spacingRowChanged(state);
                    state.revert.style.visibility = showRevert ? 'visible' : 'hidden'; // CHANGE: keep row layout stable while toggling the revert affordance.
                    state.revert.style.pointerEvents = showRevert ? 'auto' : 'none'; // CHANGE: hidden revert controls are not interactive.
                });
                defaultLabel.style.display = changed.length ? 'flex' : 'none';
                const draft = spacingDraftFromRowStates(rowStates);
                const validation = tools.validateSpacingDraft(draft);
                apply.disabled = !changed.length || !validation.ok;
                status.textContent = validation.ok ? idleStatus : validation.errors.join(' '); // CHANGE: preserve active-window explanation while editing.
                if (!changed.length || !validation.ok) {
                    clearSpacingPreview();
                    return;
                }
                const previewRows = draft.map(row => Object.assign({}, row, { enabled: changed.some(state => state.row.cellId === row.cellId) }));
                const preview = tools.buildSpacingPreviewModel(previewRows);
                renderSpacingPreview(preview);
                if (preview.warning) status.textContent = preview.warning;
            }

            rowStates.forEach(state => {
                [state.spacingX, state.spacingY, state.offsetX, state.offsetY].filter(Boolean).forEach(control => {
                    control.addEventListener('input', refreshDraftState);
                    control.addEventListener('change', refreshDraftState);
                });
                state.revert.addEventListener('click', function (evt) {
                    consumeOverlayControlEvent(evt);
                    revertSpacingRowState(state);
                    refreshDraftState();
                });
            });

            apply.addEventListener('click', async function (evt) {
                consumeOverlayControlEvent(evt);
                if (apply.disabled) return;
                try {
                    await tools.applySpacingDraft(graph, spacingDraftFromRowStates(rowStates), { saveDefaults: saveDefaults.checked });
                    clearSpacingPreview();
                    status.textContent = 'Spacing applied.';
                    setTimeout(refresh, 0);
                } catch (e) {
                    status.textContent = e && e.message ? e.message : String(e);
                }
            });
            applySetDefault.addEventListener('click', async function (evt) {
                consumeOverlayControlEvent(evt);
                if (!context.hasSetDefault || !tools || typeof tools.applySetDefault !== 'function') return;
                try {
                    await tools.applySetDefault(graph, context);
                    clearSpacingPreview();
                    status.textContent = 'Set default applied.';
                    setTimeout(refresh, 0);
                } catch (e) {
                    status.textContent = e && e.message ? e.message : String(e);
                }
            });
        }

        function renderSpacingView(entry, body) {
            clearSpacingPreview();
            const tools = getLayoutTools();
            if (!tools || typeof tools.buildSpacingLayoutRows !== 'function') {
                const empty = document.createElement('div');
                empty.textContent = 'Spacing tools are unavailable.';
                empty.style.color = '#5f6368';
                empty.style.padding = '8px 0';
                body.appendChild(empty);
                return;
            }
            const source = entry && entry.sourceId ? model.getCell(entry.sourceId) : null;
            const token = (entry.spacingRenderToken || 0) + 1;
            entry.spacingRenderToken = token;
            const loading = document.createElement('div');
            loading.textContent = 'Loading spacing...';
            loading.style.color = '#5f6368';
            loading.style.padding = '8px 0';
            body.appendChild(loading);
            Promise.resolve(tools.buildSpacingLayoutRows(graph, source)).then(context => {
                if (entry.spacingRenderToken !== token || !entry.panel || activeMode !== MODE_SPACING) return;
                renderSpacingEditor(entry, body, context || { rows: [] }, tools);
                positionPanel(entry, source);
            }).catch(e => {
                if (entry.spacingRenderToken !== token) return;
                body.innerHTML = '';
                const error = document.createElement('div');
                error.textContent = e && e.message ? e.message : String(e);
                error.style.color = '#b91c1c';
                error.style.padding = '8px 0';
                body.appendChild(error);
            });
        }

        function todayOverlayDayNumber() {
            const now = new Date();
            return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
        }

        function firstScheduledCard(cards) {
            return (cards || []).slice().sort(compareRepeatOccurrenceCards).find(card => !!getTaskDateRange(card)) || (cards && cards[0]) || null;
        }

        function buildScheduleRowsForCards(cards) {
            const rows = [];
            const repeatRows = new Map();

            for (const card of cards || []) {
                const seriesKey = buildRepeatSeriesKeyForOverlay(card);
                if (!seriesKey) {
                    rows.push({
                        key: 'card:' + card.id,
                        card,
                        cards: [card],
                        label: taskTitle(card),
                        repeat: false
                    });
                    continue;
                }

                if (!repeatRows.has(seriesKey)) {
                    repeatRows.set(seriesKey, {
                        key: 'repeat:' + seriesKey,
                        card,
                        cards: [],
                        label: taskTitle(card),
                        repeat: true
                    });
                }
                repeatRows.get(seriesKey).cards.push(card);
            }

            for (const row of repeatRows.values()) {
                row.cards.sort(compareRepeatOccurrenceCards);
                row.card = firstScheduledCard(row.cards) || row.cards[0];
                row.label = taskTitle(row.card);
                rows.push(row);
            }

            rows.sort((a, b) => compareTaskCardsByStartDate(a.card, b.card));
            return rows;
        }

        function createLaneHeader(entry, group, collapsed) {
            const header = document.createElement('div');
            header.style.display = 'grid';
            header.style.gridTemplateColumns = '21px 6px 1fr auto';
            header.style.alignItems = 'center';
            header.style.columnGap = '6px';
            header.style.margin = '8px 0 3px';
            header.style.color = '#3c4043';
            header.style.fontWeight = 'bold';
            header.style.fontSize = '10px';
            header.style.cursor = 'pointer'; // CHANGE: visible toggle replaces browser title tooltip

            const toggle = document.createElement('span');
            toggle.textContent = collapsed ? '+' : '-';
            toggle.style.display = 'inline-block';
            toggle.style.width = '21px';
            toggle.style.textAlign = 'center';
            toggle.style.color = '#5f6368';
            toggle.style.fontSize = '15px';
            toggle.style.lineHeight = '14px';
            header.appendChild(toggle);

            const stripe = document.createElement('span');
            stripe.style.height = '12px';
            stripe.style.borderRadius = '4px';
            stripe.style.background = group.color || '#9aa0a6';
            header.appendChild(stripe);

            header.appendChild(makeTextSpan(group.label || 'Lane', null));
            const count = document.createElement('span');
            count.textContent = String(group.items.length);
            count.style.color = '#5f6368';
            count.style.fontWeight = 'normal';
            header.appendChild(count);
            mxEvent.addListener(header, 'mousedown', function (evt) {
                if (evt.button != null && evt.button !== 0) return;
                setLaneGroupCollapsed(group, !isLaneGroupCollapsed(group));
                renderEntry(entry);
                mxEvent.consume(evt);
                if (evt.stopPropagation) evt.stopPropagation();
                if (evt.preventDefault) evt.preventDefault();
            });
            return header;
        }

        function renderCardView(entry, body, groups) {
            for (const group of groups) {
                const collapsed = isLaneGroupCollapsed(group);
                body.appendChild(createLaneHeader(entry, group, collapsed));
                if (collapsed) continue;
                for (const item of group.items) {
                    const card = item.card;
                const row = makeClickableRow(card, 'manual-link-task-schedule-card');
                row.style.display = 'grid';
                row.style.gridTemplateColumns = '6px 1fr';
                row.style.columnGap = '8px';
                row.style.margin = '4px 0';
                row.style.border = '1px solid rgba(60, 64, 67, 0.18)';
                row.style.borderRadius = '5px';
                row.style.background = '#ffffff';
                row.style.cursor = 'pointer';
                row.style.overflow = 'hidden';

                const stripe = document.createElement('div');
                stripe.style.background = getTaskLaneColor(card);
                row.appendChild(stripe);

                const content = document.createElement('div');
                content.style.minWidth = '0';
                content.style.padding = '6px 7px 6px 0';

                const titleLine = makeTextSpan(taskTitle(card), null);
                titleLine.style.display = 'block';
                titleLine.style.fontWeight = 'bold';
                titleLine.style.fontSize = '12px';
                content.appendChild(titleLine);

                const metaLine = makeTextSpan(formatTaskDateRange(card), '#5f6368');
                metaLine.style.display = 'block';
                metaLine.style.fontSize = '10px';
                content.appendChild(metaLine);

                    let badges = getTaskOverlayBadges(card);
                    const linkLabelBadge = getTaskLinkLabelBadge(entry, card);
                    if (linkLabelBadge) badges.unshift(linkLabelBadge);
                    if (item.repeatBadge) {
                        badges = badges.filter(text => !String(text || '').startsWith('Repeat '));
                        badges.unshift('Repeat ' + item.repeatBadge);
                    }
                    const visibleBadges = badges.slice(0, 4);
                    if (visibleBadges.length) {
                    const badgeRow = document.createElement('div');
                    badgeRow.style.display = 'flex';
                    badgeRow.style.flexWrap = 'wrap';
                    badgeRow.style.gap = '3px';
                    badgeRow.style.marginTop = '4px';
                        for (const badge of visibleBadges) badgeRow.appendChild(makeBadge(badge));
                    content.appendChild(badgeRow);
                }

                row.appendChild(content);
                body.appendChild(row);
                entry.visibleItems.push({ cardId: card.id, row });
                }
            }
        }

        function axisLabelForDay(dayNumber) {
            const date = new Date(dayNumber * 86400000);
            return formatTaskOverlayDate({ date });
        }

        function renderScheduleAxis(grid, minDay, maxDay, todayPct, leftHeaderText = 'Task') {
            const axis = document.createElement('div');
            axis.style.display = 'grid';
            axis.style.gridTemplateColumns = '112px 1fr';
            axis.style.columnGap = '8px';
            axis.style.alignItems = 'end';
            axis.style.marginBottom = '4px';

            const taskHead = document.createElement('div');
            taskHead.textContent = leftHeaderText;
            taskHead.style.color = '#5f6368';
            taskHead.style.fontSize = '10px';
            axis.appendChild(taskHead);

            const ticks = document.createElement('div');
            ticks.style.display = 'grid';
            ticks.style.gridTemplateColumns = 'repeat(4, 1fr)';
            ticks.style.color = '#5f6368';
            ticks.style.fontSize = '10px';
            ticks.style.position = 'relative';
            ticks.appendChild(makeTextSpan(axisLabelForDay(minDay), null));
            ticks.appendChild(makeTextSpan(axisLabelForDay(Math.round(minDay + (maxDay - minDay) / 3)), null));
            ticks.appendChild(makeTextSpan(axisLabelForDay(Math.round(minDay + 2 * (maxDay - minDay) / 3)), null));
            const end = makeTextSpan(axisLabelForDay(maxDay), null);
            end.style.textAlign = 'right';
            ticks.appendChild(end);
            if (todayPct != null) {
                const today = document.createElement('span');
                today.textContent = 'Today';
                today.style.position = 'absolute';
                today.style.left = todayPct + '%';
                today.style.top = '-12px';
                today.style.transform = 'translateX(-50%)';
                today.style.color = '#b91c1c';
                today.style.fontWeight = 'bold';
                ticks.appendChild(today);
            }
            axis.appendChild(ticks);
            grid.appendChild(axis);
        }

        function renderScheduleBar(track, card, range, minDay, totalDays) {
            const bar = document.createElement('div');
            const leftPct = Math.max(0, Math.min(98, ((range.startDay - minDay) / totalDays) * 100));
            const rawWidthPct = range.startDay === range.endDay ? 2 : ((range.endDay - range.startDay + 1) / totalDays) * 100;
            const widthPct = Math.max(range.startDay === range.endDay ? 2 : 3, rawWidthPct);
            bar.style.position = 'absolute';
            bar.style.left = leftPct + '%';
            bar.style.top = '5px';
            bar.style.width = Math.min(100 - leftPct, widthPct) + '%';
            bar.style.height = range.startDay === range.endDay ? '8px' : '9px';
            bar.style.borderRadius = range.startDay === range.endDay ? '999px' : '4px';
            bar.style.background = getTaskLaneColor(card);
            track.appendChild(bar);
        }

        function occupancyRangeForItem(item) {
            const start = parseTaskOverlayDate(item && item.startISO);
            const end = parseTaskOverlayDate(item && item.endISO);
            if (!start || !end || end.dayNumber < start.dayNumber) return null;
            return { start, end, startDay: start.dayNumber, endDay: end.dayNumber, durationDays: end.dayNumber - start.dayNumber + 1 };
        }

        function renderOccupancyBar(track, range, selected, minDay, totalDays) {
            const bar = document.createElement('div');
            const leftPct = Math.max(0, Math.min(98, ((range.startDay - minDay) / totalDays) * 100));
            const rawWidthPct = range.startDay === range.endDay ? 2 : ((range.endDay - range.startDay + 1) / totalDays) * 100;
            const widthPct = Math.max(range.startDay === range.endDay ? 2 : 3, rawWidthPct);
            bar.style.position = 'absolute';
            bar.style.left = leftPct + '%';
            bar.style.top = '5px';
            bar.style.width = Math.min(100 - leftPct, widthPct) + '%';
            bar.style.height = range.startDay === range.endDay ? '8px' : '9px';
            bar.style.borderRadius = range.startDay === range.endDay ? '999px' : '4px';
            bar.style.background = selected ? '#137333' : '#188038';
            bar.style.opacity = selected ? '1' : '0.72';
            track.appendChild(bar);
        }

        function makeOccupancyRow(entry, item) {
            const row = document.createElement('div');
            row.className = 'manual-link-task-occupancy-row';
            row.setAttribute('title', 'Click to select planting group');
            mxEvent.addListener(row, 'mousedown', function (evt) {
                if (evt.button != null && evt.button !== 0) return;
                const cell = item && item.cellId ? model.getCell(item.cellId) : null;
                if (cell && model.isVertex(cell)) selectAndReveal(cell);
                mxEvent.consume(evt);
                if (evt.stopPropagation) evt.stopPropagation();
                if (evt.preventDefault) evt.preventDefault();
            });
            return row;
        }

        function occupancyRangesOverlap(left, right) {
            return !!(left && right && left.startDay <= right.endDay && right.startDay <= left.endDay);
        }

        function makeRelationshipBadge(text, color) {
            const badge = document.createElement('span');
            badge.textContent = text;
            badge.style.display = 'inline-block';
            badge.style.marginTop = '2px';
            badge.style.marginRight = '4px';
            badge.style.padding = '1px 4px';
            badge.style.borderRadius = '4px';
            badge.style.border = '1px solid ' + color;
            badge.style.color = color;
            badge.style.fontSize = '9px';
            badge.style.fontWeight = '700';
            return badge;
        }

        function renderOccupancyRelationshipBadges(entry, labelCell, item, range) {
            const rel = item && item.relationship;
            if (!rel || !range) return '';
            if (rel.mode === 'turnover') {
                const gap = rel.gapDays !== '' ? rel.gapDays + 'd gap' : 'turnover';
                return 'Turnover relationship: ' + gap + '.'; // CHANGE: only explicit turnover keeps relationship tooltip semantics.
            }
            return '';
        }

        function renderOccupancyRow(entry, grid, item, range, minDay, totalDays, todayPct) {
            const selected = item && item.cellId === entry.sourceId;
            const row = makeOccupancyRow(entry, item);
            row.style.display = 'grid';
            row.style.gridTemplateColumns = '112px 1fr';
            row.style.columnGap = '8px';
            row.style.alignItems = 'center';
            row.style.minHeight = '24px';
            row.style.cursor = 'pointer';
            row.style.fontWeight = selected ? 'bold' : 'normal';

            const labelCell = document.createElement('div');
            labelCell.style.minWidth = '0';
            const label = makeTextSpan(item.label || item.cellId || 'Planting', null);
            label.style.fontSize = '10px';
            labelCell.appendChild(label);
            const relationshipTooltip = renderOccupancyRelationshipBadges(entry, labelCell, item, range);
            if (relationshipTooltip) {
                row.title = relationshipTooltip;
                labelCell.title = relationshipTooltip;
            }
            row.appendChild(labelCell);

            const track = document.createElement('div');
            track.style.position = 'relative';
            track.style.height = '18px';
            track.style.borderBottom = '1px solid #e8eaed';
            if (todayPct != null) {
                const todayLine = document.createElement('div');
                todayLine.style.position = 'absolute';
                todayLine.style.left = todayPct + '%';
                todayLine.style.top = '0';
                todayLine.style.bottom = '0';
                todayLine.style.width = '1px';
                todayLine.style.background = '#b91c1c';
                todayLine.style.opacity = '0.75';
                track.appendChild(todayLine);
            }
            renderOccupancyBar(track, range, selected, minDay, totalDays);
            if (relationshipTooltip) track.title = relationshipTooltip;
            row.appendChild(track);
            grid.appendChild(row);
        }

        function renderScheduleRow(entry, grid, scheduleRow, minDay, totalDays, todayPct) {
            const card = scheduleRow.card;
            const row = makeClickableRow(card, 'manual-link-task-schedule-row');
            row.style.display = 'grid';
            row.style.gridTemplateColumns = '112px 1fr';
            row.style.columnGap = '8px';
            row.style.alignItems = 'center';
            row.style.minHeight = '24px';
            row.style.cursor = 'pointer';

            const labelCell = document.createElement('div');
            labelCell.style.minWidth = '0';
            const label = makeTextSpan(scheduleRow.label, null);
            label.style.fontSize = '10px';
            if (scheduleRow.repeat && scheduleRow.cards.length > 1) {
                label.textContent = scheduleRow.label + ' (' + scheduleRow.cards.length + ')';
            }
            labelCell.appendChild(label);

            const scheduleBadge = getTaskLinkLabelBadge(entry, card);
            if (scheduleBadge) {
                const badgeWrap = document.createElement('div');
                badgeWrap.style.marginTop = '2px';
                badgeWrap.appendChild(makeBadge(scheduleBadge));
                labelCell.appendChild(badgeWrap);
            }
            row.appendChild(labelCell);

            const track = document.createElement('div');
            track.style.position = 'relative';
            track.style.height = '18px';
            track.style.borderBottom = '1px solid #e8eaed';
            if (todayPct != null) {
                const todayLine = document.createElement('div');
                todayLine.style.position = 'absolute';
                todayLine.style.left = todayPct + '%';
                todayLine.style.top = '0';
                todayLine.style.bottom = '0';
                todayLine.style.width = '1px';
                todayLine.style.background = '#b91c1c';
                todayLine.style.opacity = '0.75';
                track.appendChild(todayLine);
            }

            for (const occurrenceCard of scheduleRow.cards) {
                const range = getTaskDateRange(occurrenceCard);
                if (range) renderScheduleBar(track, occurrenceCard, range, minDay, totalDays);
            }
            row.appendChild(track);

            grid.appendChild(row);
            for (const occurrenceCard of scheduleRow.cards) {
                entry.visibleItems.push({ cardId: occurrenceCard.id, row });
            }
        }

        function renderUnscheduledSection(entry, body, unscheduledRows) {
            if (!unscheduledRows.length) return;
            const section = document.createElement('div');
            section.style.marginTop = '8px';
            const title = document.createElement('div');
            title.textContent = 'Unscheduled';
            title.style.fontWeight = 'bold';
            title.style.fontSize = '10px';
            title.style.color = '#5f6368';
            title.style.marginBottom = '3px';
            section.appendChild(title);
            for (const scheduleRow of unscheduledRows) {
                const card = scheduleRow.card;
                const row = makeClickableRow(card, 'manual-link-task-schedule-unscheduled');
                row.style.display = 'grid';
                row.style.gridTemplateColumns = '6px 1fr';
                row.style.columnGap = '6px';
                row.style.alignItems = 'center';
                row.style.minHeight = '22px';
                row.style.padding = '2px 0';
                row.style.cursor = 'pointer';
                const stripe = document.createElement('span');
                stripe.style.height = '14px';
                stripe.style.borderRadius = '4px';
                stripe.style.background = getTaskLaneColor(card);
                row.appendChild(stripe);
                const label = scheduleRow.repeat && scheduleRow.cards.length > 1
                    ? scheduleRow.label + ' (' + scheduleRow.cards.length + ')'
                    : scheduleRow.label;
                const labelWrap = document.createElement('div');
                labelWrap.style.minWidth = '0';
                labelWrap.appendChild(makeTextSpan(label, '#5f6368'));
                const linkLabelBadge = getTaskLinkLabelBadge(entry, card);
                if (linkLabelBadge) {
                    const badgeLine = document.createElement('div');
                    badgeLine.style.marginTop = '2px';
                    badgeLine.appendChild(makeBadge(linkLabelBadge));
                    labelWrap.appendChild(badgeLine);
                }
                row.appendChild(labelWrap);
                section.appendChild(row);
                for (const occurrenceCard of scheduleRow.cards) {
                    entry.visibleItems.push({ cardId: occurrenceCard.id, row });
                }
            }
            body.appendChild(section);
        }

        function renderScheduleView(entry, body, cards) {
            const rows = buildScheduleRowsForCards(cards);
            const scheduledRows = [];
            const unscheduled = [];
            for (const row of rows) {
                const ranges = row.cards.map(card => getTaskDateRange(card)).filter(Boolean);
                if (ranges.length) scheduledRows.push({ row, ranges });
                else unscheduled.push(row);
            }

            let minDay = null;
            let maxDay = null;
            let totalDays = 1;
            let todayPct = null;
            if (scheduledRows.length) {
                const startDays = [];
                const endDays = [];
                for (const record of scheduledRows) {
                    for (const range of record.ranges) {
                        startDays.push(range.startDay);
                        endDays.push(range.endDay);
                    }
                }
                minDay = Math.min.apply(null, startDays);
                maxDay = Math.max.apply(null, endDays);
                totalDays = Math.max(1, maxDay - minDay + 1);
                const today = todayOverlayDayNumber();
                if (today >= minDay && today <= maxDay) todayPct = ((today - minDay) / totalDays) * 100;
            }

            if (!scheduledRows.length) {
                const empty = document.createElement('div');
                empty.textContent = 'No scheduled task dates';
                empty.style.color = '#5f6368';
                empty.style.padding = '8px 0';
                body.appendChild(empty);
            } else {
                const grid = document.createElement('div');
                renderScheduleAxis(grid, minDay, maxDay, todayPct);
                scheduledRows.sort((a, b) => compareTaskCardsByStartDate(a.row.card, b.row.card));
                for (const record of scheduledRows) {
                    renderScheduleRow(entry, grid, record.row, minDay, totalDays, todayPct);
                }
                body.appendChild(grid);
            }

            renderUnscheduledSection(entry, body, unscheduled);
        }

        function renderOccupancyUnscheduledSection(entry, body, items) {
            if (!items.length) return;
            const section = document.createElement('div');
            section.style.marginTop = '8px';
            const title = document.createElement('div');
            title.textContent = 'Unscheduled';
            title.style.fontWeight = 'bold';
            title.style.fontSize = '10px';
            title.style.color = '#5f6368';
            title.style.marginBottom = '3px';
            section.appendChild(title);
            for (const item of items) {
                const row = makeOccupancyRow(entry, item);
                row.style.display = 'grid';
                row.style.gridTemplateColumns = '6px 1fr';
                row.style.columnGap = '6px';
                row.style.alignItems = 'center';
                row.style.minHeight = '22px';
                row.style.padding = '2px 0';
                row.style.cursor = 'pointer';
                const stripe = document.createElement('span');
                stripe.style.height = '14px';
                stripe.style.borderRadius = '4px';
                stripe.style.background = '#9aa0a6';
                row.appendChild(stripe);
                const labelWrap = document.createElement('div');
                labelWrap.style.minWidth = '0';
                labelWrap.appendChild(makeTextSpan(item.label || item.cellId || 'Planting', '#5f6368'));
                row.appendChild(labelWrap);
                section.appendChild(row);
            }
            body.appendChild(section);
        }

        function renderOccupancyView(entry, body) {
            const occupancy = getOccupancyModelForEntry(entry);
            const rows = (occupancy.items || []).map(item => ({ item, range: occupancyRangeForItem(item) }));
            const scheduledRows = rows.filter(row => !!row.range);
            const unscheduledItems = rows.filter(row => !row.range).map(row => row.item);
            let minDay = null;
            let maxDay = null;
            let totalDays = 1;
            let todayPct = null;

            if (scheduledRows.length) {
                minDay = Math.min.apply(null, scheduledRows.map(row => row.range.startDay));
                maxDay = Math.max.apply(null, scheduledRows.map(row => row.range.endDay));
                totalDays = Math.max(1, maxDay - minDay + 1);
                const today = todayOverlayDayNumber();
                if (today >= minDay && today <= maxDay) todayPct = ((today - minDay) / totalDays) * 100;
            }

            if (!scheduledRows.length) {
                const empty = document.createElement('div');
                empty.textContent = 'No scheduled occupancy dates';
                empty.style.color = '#5f6368';
                empty.style.padding = '8px 0';
                body.appendChild(empty);
            } else {
                const grid = document.createElement('div');
                renderScheduleAxis(grid, minDay, maxDay, todayPct, 'Planting');
                scheduledRows.sort((a, b) => a.range.startDay - b.range.startDay || String(a.item.cellId || '').localeCompare(String(b.item.cellId || '')));
                for (const row of scheduledRows) renderOccupancyRow(entry, grid, row.item, row.range, minDay, totalDays, todayPct);
                body.appendChild(grid);
            }

            renderOccupancyUnscheduledSection(entry, body, unscheduledItems);
        }

        function getSourceBoundsForPanel(source) {
            const host = getPanelHost();
            const state = source && graph.getView && graph.getView().getState(source);
            if (host && state && state.shape && state.shape.node && state.shape.node.getBoundingClientRect) {
                const hostRect = host.getBoundingClientRect();
                const cellRect = state.shape.node.getBoundingClientRect();
                return {
                    x: cellRect.left - hostRect.left + (host.scrollLeft || 0),
                    y: cellRect.top - hostRect.top + (host.scrollTop || 0),
                    w: cellRect.width,
                    h: cellRect.height
                };
            }
            const center = getCellCenter(source);
            return center ? { x: center.x - center.w / 2, y: center.y - center.h / 2, w: center.w, h: center.h } : null;
        }

        function normalizeLayoutBounds(bounds) {
            if (!bounds) return null;
            const w = Number(bounds.w ?? bounds.width ?? 0);
            const h = Number(bounds.h ?? bounds.height ?? 0);
            const x = Number(bounds.x ?? bounds.left ?? 0);
            const y = Number(bounds.y ?? bounds.top ?? 0);
            return Number.isFinite(x) && Number.isFinite(y) && w >= 0 && h >= 0 ? { x, y, w, h } : null;
        }

        function getClusterBoundsForPanel(source) {
            const api = graph.__trellisBedSuccessionNavigator;
            if (api && typeof api.getSelectedClusterLayoutContext === 'function') {
                const context = api.getSelectedClusterLayoutContext(source);
                const bounds = normalizeLayoutBounds(context && (context.overlayAnchorBounds || context.clusterBounds)); // CHANGE: visual anchoring is separate from bed-scoped layout context.
                if (bounds) return bounds;
            }
            return getSourceBoundsForPanel(source);
        }

        function positionPanel(entry, source) {
            const host = getPanelHost();
            const sourceBounds = getClusterBoundsForPanel(source);
            if (!host || !entry.panel || !sourceBounds) return false;

            const panelHeight = entry.panel.offsetHeight || 32;
            const left = sourceBounds.x - PANEL_GAP - PANEL_SIDE_OFFSET - PANEL_WIDTH; // CHANGE: spacing/task overlay now lives on the left side of the selected cluster.
            const centeredTop = sourceBounds.y + sourceBounds.h / 2 - panelHeight / 2; // CHANGE: center only when the overlay would not enter the reserved occupancy space above the cluster.
            const top = centeredTop < sourceBounds.y ? sourceBounds.y : centeredTop; // CHANGE: deterministic clamp avoids render-order-sensitive Occupancy bounds measurement.

            entry.panelLeft = left;
            entry.panelTop = top;
            entry.panel.style.left = left + 'px';
            entry.panel.style.top = top + 'px';
            return true;
        }

        function itemCenterFromRow(entry, row) {
            const host = getPanelHost();
            if (!host || !row || !row.getBoundingClientRect) return null;
            const rowRect = row.getBoundingClientRect();
            const hostRect = host.getBoundingClientRect();
            return {
                x: rowRect.left - hostRect.left + (host.scrollLeft || 0) + rowRect.width / 2,
                y: rowRect.top - hostRect.top + (host.scrollTop || 0) + rowRect.height / 2,
                w: rowRect.width,
                h: rowRect.height
            };
        }

        function createOrUpdateLine(entry, cardId, row) {
            const pane = getOverlayPane();
            const card = model.getCell(cardId);
            if (!pane || !row || !isValidOverlayCard(card)) {
                removePolyline(entry.lines.get(cardId));
                entry.lines.delete(cardId);
                return;
            }

            const itemC = itemCenterFromRow(entry, row);
            const dstC = getCellCenter(card);
            if (!itemC || !dstC) {
                removePolyline(entry.lines.get(cardId));
                entry.lines.delete(cardId);
                return;
            }

            const srcPt = anchorOnSide(itemC, sideToward(itemC, dstC), 0.5);
            const dstPt = anchorOnSide(dstC, sideToward(dstC, itemC), 0.5);
            if (!srcPt || !dstPt) return;

            const points = [new mxPoint(srcPt.x, srcPt.y), new mxPoint(dstPt.x, dstPt.y)];
            const stroke = getTaskLaneColor(card);
            let poly = entry.lines.get(cardId);

            if (poly && poly.node && poly.node.parentNode === pane) {
                poly.points = points;
                poly.stroke = stroke;
                poly.redraw();
            } else {
                removePolyline(poly);
                poly = new mxPolyline(points, stroke, 2);
                poly.dialect = graph.dialect;
                poly.init(pane);
                poly.redraw();
                if (poly.node) {
                    poly.node.style.pointerEvents = 'none';
                    poly.node.setAttribute('opacity', '0.72');
                }
                entry.lines.set(cardId, poly);
            }
        }

        function refreshLines(entry) {
            const liveIds = new Set();
            for (const item of entry.visibleItems || []) {
                liveIds.add(item.cardId);
                createOrUpdateLine(entry, item.cardId, item.row);
            }
            for (const [cardId, poly] of Array.from(entry.lines.entries())) {
                if (liveIds.has(cardId)) continue;
                removePolyline(poly);
                entry.lines.delete(cardId);
            }
        }

        function renderEntry(entry) {
            const host = getPanelHost();
            const panelHost = getPanelLayer();
            const source = model.getCell(entry.sourceId);
            if (!host || !panelHost || !source || !model.isVertex(source)) {
                removeEntry(entry);
                return;
            }

            const cards = entry.targetIds
                .map((id) => model.getCell(id))
                .filter(isValidOverlayCard)
                .sort(compareTaskCardsByStartDate);
            entry.targetIds = cards.map((card) => card.id);
            if (entry.linkLabels) {
                const liveLabels = new Map();
                for (const card of cards) liveLabels.set(card.id, entry.linkLabels.get(card.id) || '');
                entry.linkLabels = liveLabels;
            }
            if (cards.length === 0) {
                if (!entry.scheduleOnly) {
                    removeEntry(entry);
                    return;
                }
            }

            if (entry.scheduleOnly) {
                if (!entry.panel) {
                    entry.panel = document.createElement('div');
                    entry.panel.className = 'manual-link-task-schedule-overlay manual-link-task-schedule-only';
                    applyPanelStyle(entry.panel);
                    panelHost.appendChild(entry.panel);
                } else if (entry.panel.parentNode !== panelHost) {
                    panelHost.appendChild(entry.panel);
                }
                while (entry.panel.firstChild) entry.panel.removeChild(entry.panel.firstChild);
                entry.visibleItems = [];
                entry.panel.appendChild(createScheduleOnlyHeader(entry));
                if (activeMode === MODE_SPACING) {
                    const body = createBody();
                    entry.panel.appendChild(body);
                    renderSpacingView(entry, body);
                }
                if (!positionPanel(entry, source)) {
                    removeEntry(entry);
                    return;
                }
                refreshLines(entry);
                return;
            }

            entry.years = getTaskOverlayYears(cards);
            if (entry.years.length) {
                const rememberedYear = selectedYearBySource.get(entry.sourceId);
                entry.selectedYear = entry.years.indexOf(rememberedYear) >= 0 ? rememberedYear : (entry.selectedYear || chooseDefaultOverlayYear(entry.years));
            } else {
                entry.selectedYear = null;
            }
            const visibleCards = cards.filter(card => getAttr(card, 'year_hidden') !== '1');
            const groups = groupLinkedTasksForOverlay(visibleCards);

            if (!entry.panel) {
                entry.panel = document.createElement('div');
                entry.panel.className = 'manual-link-task-schedule-overlay';
                applyPanelStyle(entry.panel);
                panelHost.appendChild(entry.panel);
            } else if (entry.panel.parentNode !== panelHost) {
                panelHost.appendChild(entry.panel);
            }

            while (entry.panel.firstChild) entry.panel.removeChild(entry.panel.firstChild);
            entry.visibleItems = [];
            const headerCount = activeMode === MODE_SPACING ? countSpacingRows(entry) : (activeMode === MODE_SCHEDULE ? countScheduleRows(visibleCards) : countGroupItems(groups));
            entry.panel.appendChild(createHeader(entry, headerCount));
            const body = createBody();
            entry.panel.appendChild(body);
            mxEvent.addListener(body, 'scroll', function () { refreshLines(entry); });

            if (activeMode === MODE_SPACING) renderSpacingView(entry, body);
            else if (visibleCards.length === 0) renderEmptyTaskOverlayMessage(body);
            else if (activeMode === MODE_SCHEDULE) renderScheduleView(entry, body, visibleCards);
            else if (groups.length) renderCardView(entry, body, groups);
            else renderEmptyTaskOverlayMessage(body);

            if (!positionPanel(entry, source)) {
                removeEntry(entry);
                return;
            }

            refreshLines(entry);
        }

        function removeEntry(entry, restoreYear) {
            if (!entry) return;
            clearSpacingPreview();
            for (const poly of entry.lines.values()) removePolyline(poly);
            entry.lines.clear();
            removeNode(entry.panel);
            registry.delete(entry.sourceId);
            if (restoreYear && !isEntryStillSelected(entry)) restoreEntryTasksToCurrentYear(entry);
        }

        function show(source, cards, linkLabels) {
            clear();
            if (!source || !source.id || !cards || cards.length === 0) return;

            const validCards = cards.filter(isValidOverlayCard).sort(compareTaskCardsByStartDate);
            if (validCards.length === 0) return;

            const entry = {
                sourceId: source.id,
                targetIds: validCards.map((card) => card.id),
                linkLabels: new Map(),
                panel: null,
                panelLeft: 0,
                panelTop: 0,
                visibleItems: [],
                lines: new Map()
            };
            for (const card of validCards) entry.linkLabels.set(card.id, linkLabels && linkLabels.get ? (linkLabels.get(card.id) || '') : '');
            registry.set(source.id, entry);
            renderEntry(entry);
        }

        function showScheduleOnly(source) {
            clear();
            if (!source || !source.id || !isTilerGroup(source)) return;
            const entry = {
                sourceId: source.id,
                targetIds: [],
                linkLabels: new Map(),
                scheduleOnly: true,
                panel: null,
                panelLeft: 0,
                panelTop: 0,
                visibleItems: [],
                lines: new Map()
            };
            registry.set(source.id, entry);
            renderEntry(entry);
        }

        function clear() {
            for (const entry of Array.from(registry.values())) removeEntry(entry, true);
        }

        function refresh() {
            for (const entry of Array.from(registry.values())) renderEntry(entry);
        }

        function setMode(mode) {
            clearSpacingPreview();
            activeMode = mode === MODE_SPACING ? MODE_SPACING : (mode === MODE_SCHEDULE ? MODE_SCHEDULE : MODE_CARDS);
            refresh();
        }

        return {
            show,
            showScheduleOnly,
            clear,
            refresh,
            setMode
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

    function dispatchYearFilterChangedForTaskOverlay(card, year) {
        try {
            window.dispatchEvent(new CustomEvent('yearFilterChanged', {
                detail: { moduleCellId: null, taskCardId: card && card.id || null, year: year == null ? null : year }
            }));
        } catch (_) { }
    }

    function revealKanbanCardForNavigation(card) {
        if (!isKanbanCard(card)) return;
        if (getAttr(card, 'year_hidden') === '1' || getAttr(card, 'repeat_hidden') === '1') return;
        if (!model.isVisible || model.isVisible(card)) return;
        const pagingApi = graph.__trellisTaskPagingApi;
        if (pagingApi && typeof pagingApi.revealCard === 'function' && pagingApi.revealCard(card)) { dispatchYearFilterChangedForTaskOverlay(card, null); return; }
        dispatchYearFilterChangedForTaskOverlay(card, null);
    }


    // Works for arbitrarily nested children
    function selectAndReveal(cell) {
        if (!cell) return;
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
            taskScheduleOverlay.refresh();
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

        target.style.stroke = color || '#ff0000';
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
        taskScheduleOverlay.clear();
        linkOverlays.clearAll();
        clearDomHighlights();
    }


    function selectedLinkableVertices() {
        return asVertexArray(graph.getSelectionCells && graph.getSelectionCells());
    }

    function refreshCurrentHighlight() {
        const selected = selectedLinkableVertices();

        if (!selected || selected.length === 0) {
            highlightLinked(null);
            return;
        }

        if (selected.length === 1) {
            const cell = selected[0];
            if (cell && model.isVertex(cell)) highlightLinked(cell);
            else highlightLinked(null);
            return;
        }

        if (selected.every(isRoleCard)) {
            highlightLinkedRoleCards(selected);
        } else {
            highlightLinked(null);
        }
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
        const RED = '#ff0000';
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
                highlight(cell, selIsPrimary ? YELLOW : RED);
                if (linkedIds.size === 0) continue;

                const targets = [];
                for (const id of linkedIds) {
                    const other = model.getCell(id);
                    if (other && model.isVertex(other)) targets.push(other);
                }

                const exitMap = computeExitParamsForOrigin(cell, targets);
                for (const other of targets) {
                    const otherIsPrimary = isPrimary(other);
                    highlight(other, otherIsPrimary ? YELLOW : RED);
                    const laneColor = getLinkLaneColor(cell, other);
                    const edgeColor = laneColor ? laneColor : ((selIsPrimary || otherIsPrimary) ? YELLOW : RED);
                    const label = getRawTextLabel ? getRawTextLabel(other) : '';
                    const exitHint = exitMap.get(other.id);
                    if (shouldShowEdgeInternal(cell, other)) {
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
        const RED = '#ff0000';
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
                highlight(cell, selIsPrimary ? YELLOW : RED);
                taskScheduleOverlay.showScheduleOnly(cell);
                return;
            }

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

            const sameBoardLinkedCards = collectSameBoardLinkedKanbanCards(cell, targets);
            const selectedTilerTaskSiblingIds = collectLinkedTaskCardSiblingIdsForTiler(cell, targets);
            const linkedTaskCards = collectLinkedKanbanCardsForSource(cell);
            const taskOverlayActive = linkedTaskCards.length > 0 && !isKanbanCard(cell);
            const taskOverlayLinkLabels = new Map();
            if (taskOverlayActive) {
                taskScheduleOverlay.show(cell, linkedTaskCards, taskOverlayLinkLabels);
            } else if (selectedIsTilerGroup) {
                taskScheduleOverlay.showScheduleOnly(cell);
            } else {
                taskScheduleOverlay.clear();
            }

            const exitMap = computeExitParamsForOrigin(cell, targets);
            const visibleLinkOverlayRecords = [];

            for (const other of targets) {
                const otherIsPrimary = isPrimary(other);
                const linkedTargetHighlight = selectedTilerTaskSiblingIds.has(other.id) ? SAME_CROP_HIGHLIGHT : RED;
                highlight(other, otherIsPrimary ? YELLOW : linkedTargetHighlight);

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

    function resolveLiveCreatedTilerGroup(evt) {
        const m = graph.getModel();
        const eventCell = evt && evt.getProperty ? evt.getProperty('cell') : null;
        const eventCellId = evt && evt.getProperty ? evt.getProperty('cellId') : null;
        const cellId = eventCellId || (eventCell && eventCell.id) || '';
        const liveCell = cellId && m.getCell ? m.getCell(cellId) : eventCell;
        if (!liveCell || !isTilerGroup(liveCell)) return null;
        if (typeof m.contains === 'function' && !m.contains(liveCell)) return null;
        return liveCell;
    }

    graph.addListener(TILER_GROUP_CREATED_EVENT, function (_sender, evt) {
        const createdGroup = resolveLiveCreatedTilerGroup(evt);
        if (!createdGroup) return;
        if (graph.getSelectionCell && graph.getSelectionCell() !== createdGroup) graph.setSelectionCell(createdGroup);
        setTimeout(function () {
            const liveGroup = resolveLiveCreatedTilerGroup(evt);
            if (!liveGroup) return;
            if (graph.getSelectionCell && graph.getSelectionCell() !== liveGroup) graph.setSelectionCell(liveGroup);
            taskScheduleOverlay.showScheduleOnly(liveGroup);
            taskScheduleOverlay.refresh();
        }, 0);
    });


    // Selection Highlight Logic
    graph.getSelectionModel().addListener(mxEvent.CHANGE, function () {
        refreshCurrentHighlight();
    });
    graph.addListener(TRELLIS_SELECTION_VISUALS_REFRESH_EVENT, function () {
        refreshCurrentHighlight();
        taskScheduleOverlay.refresh();
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
            const back = getLinkSet(other);
            if (!back.has(cell.id)) { removeOneWayLink(cell, id); removed++; }
        }
        return removed;
    }


    // Keep link overlays attached on zoom/pan and geometry changes                 
    const view = graph.getView();
    if (view && view.addListener) {
        function refreshViewOnlyLinkVisuals() {
            linkOverlays.refreshAll();
            taskScheduleOverlay.refresh();

            // Draw.io may recreate SVG nodes during zoom/pan, so reapply DOM highlights
            // after the view has finished its redraw cycle.
            setTimeout(function () {
                refreshCurrentHighlight();
                linkOverlays.refreshAll();
                taskScheduleOverlay.refresh();
            }, 0);
        }

        view.addListener(mxEvent.SCALE, refreshViewOnlyLinkVisuals);
        view.addListener(mxEvent.TRANSLATE, refreshViewOnlyLinkVisuals);
        view.addListener(mxEvent.SCALE_AND_TRANSLATE, refreshViewOnlyLinkVisuals);
    }

    graph.getModel().addListener(mxEvent.CHANGE, function () {
        // Any geometry change (move/resize) will trigger recompute                
        linkOverlays.refreshAll();
        taskScheduleOverlay.refresh();
    });

    window.addEventListener('trellisHistoryBeforeRestore', function () {
        try { clearAllHighlights(); } catch (e) { }
    });

    window.addEventListener('trellisHistoryAfterRestore', function () {
        try { refreshCurrentHighlight(); } catch (e) { }
        try { linkOverlays.refreshAll(); } catch (e) { }
        try { taskScheduleOverlay.refresh(); } catch (e) { }
    });


    vertexLinkLog('[ManualLinker] Plugin loaded.');
});
