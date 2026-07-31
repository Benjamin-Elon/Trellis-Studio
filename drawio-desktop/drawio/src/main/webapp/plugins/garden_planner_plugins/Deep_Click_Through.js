/**
 * Draw.io Plugin: Deep Click-Through Selection
 *
 * Selects and drags the deepest visible child under the pointer instead of
 * letting a selected parent intercept descendant clicks. Locked or otherwise
 * non-movable descendants redirect drag gestures to the nearest movable parent.
 */
Draw.loadPlugin(function (ui) {
    const graph = ui.editor && ui.editor.graph;
    if (!graph || graph.__deepClickThroughInstalled) return;
    graph.__deepClickThroughInstalled = true;
    const WORKSPACE_HANDLE_SIZE = 18;
    const WORKSPACE_HANDLE_GAP = 2;
    const WORKSPACE_HOVER_GRACE_PX = 30;
    const WORKSPACE_CALLOUT_MS = 5000;
    const GRAPH_OVERLAY_Z = Object.freeze({ ANNOTATION: 10000, CONNECTION: 10010, CONTROL: 10020, CONTROL_TOP: 10030 });
    const workspaceCalloutSeenByType = { module: false, lane: false };
    let workspaceHoveredCell = null;
    let workspaceDraggingHandleCell = null;
    let workspaceHandleRefreshThread = null;
    let workspaceCalloutDiv = null;
    let workspaceCursorOverrideActive = false;
    let workspaceCursorPreviousValue = '';
    const workspaceHandleEntries = new Map();

    graph.selectParentAfterCollapse = false;
    graph.cellsSelectable = true;
    graph.keepEdgesInBackground = false;
    graph.cellsLocked = false;

    const baseGetCellAt = graph.getCellAt;
    const baseGetCursorForMouseEvent = graph.getCursorForMouseEvent;

    graph.getCellAt = function (x, y, parent, vertices, edges, ignoreFn) {
        const initial = baseGetCellAt.call(this, x, y, parent, vertices, edges, plantExactHitIgnoreFn(ignoreFn));
        if (!initial) return null;
        const plantTarget = getPlantClickThroughCellAt(this, x, y, parent, initial);
        if (plantTarget) return plantTarget;
        if (!this.model.isVertex(initial)) return initial;

        const descendants = [];
        const collect = (cell) => {
            const children = this.model.getChildCells(cell);
            if (!children) return;
            for (const child of children) {
                if (this.model.isVertex(child) && this.isCellVisible(child)) descendants.push(child);
                collect(child);
            }
        };
        collect(initial);

        for (let i = descendants.length - 1; i >= 0; i--) {
            const child = descendants[i];
            const state = this.view.getState(child);
            if (state && cellStateContainsPoint(this, state, x, y)) return child;
        }
        return initial;
    };

    graph.getCursorForMouseEvent = function (me) {
        const hit = getDeepestCellForMouseEvent(this, me, me && me.getCell ? me.getCell() : null);
        if (shouldUseWorkspaceSelectCursor(me, hit)) return 'default';
        return baseGetCursorForMouseEvent ? baseGetCursorForMouseEvent.apply(this, arguments) : null;
    };

    mxGraphHandler.prototype.getInitialCellForEvent = function (me) {
        return getDragInitialCellForEvent(this.graph, me, me.getCell(), this);
    };

    const oldGraphHandlerMouseDown = mxGraphHandler.prototype.mouseDown;
    mxGraphHandler.prototype.mouseDown = function (sender, me) {
        const context = getWorkspaceSurfaceDragContext(this.graph, me);
        if (context) {
            this.graph.__trellisWorkspaceDragContext = context;
            scheduleWorkspaceHandleRefresh();
            return;
        }
        return oldGraphHandlerMouseDown.apply(this, arguments);
    };

    if (typeof mxRubberband !== 'undefined' && mxRubberband.prototype) {
        const oldRubberbandMouseDown = mxRubberband.prototype.mouseDown;
        mxRubberband.prototype.mouseDown = function (sender, me) {
            const context = this.graph && (this.graph.__trellisWorkspaceDragContext || getWorkspaceSurfaceDragContext(this.graph, me));
            if (context && !me.isConsumed() && this.isEnabled() && this.graph.isEnabled() && !mxEvent.isMultiTouchEvent(me.getEvent())) {
                this.graph.__trellisWorkspaceDragContext = context;
                this.graph.__trellisWorkspaceMarqueeContainer = context.cell;
                const offset = mxUtils.getOffset(this.graph.container);
                const origin = mxUtils.getScrollOrigin(this.graph.container);
                origin.x -= offset.x;
                origin.y -= offset.y;
                this.start(me.getX() + origin.x, me.getY() + origin.y);
                me.consume(false);
                return;
            }
            return oldRubberbandMouseDown.apply(this, arguments);
        };

        const oldRubberbandMouseMove = mxRubberband.prototype.mouseMove;
        mxRubberband.prototype.mouseMove = function (sender, me) {
            const context = this.graph && this.graph.__trellisWorkspaceDragContext;
            if (context && shouldShowWorkspaceCallout(this.graph, context, this, me)) showWorkspaceMoveCallout(context.cell, context.type, me);
            return oldRubberbandMouseMove.apply(this, arguments);
        };

        const oldRubberbandMouseUp = mxRubberband.prototype.mouseUp;
        mxRubberband.prototype.mouseUp = function (sender, me) {
            try {
                return oldRubberbandMouseUp.apply(this, arguments);
            } finally {
                if (this.graph) {
                    this.graph.__trellisWorkspaceDragContext = null;
                    this.graph.__trellisWorkspaceMarqueeContainer = null;
                }
            }
        };
    }

    const baseSelectRegion = graph.selectRegion;
    graph.selectRegion = function (rect, evt) {
        const container = this.__trellisWorkspaceMarqueeContainer;
        if (!container) return baseSelectRegion.apply(this, arguments);
        const isect = (mxEvent.isAltDown && mxEvent.isAltDown(evt)) ? rect : null;
        let cells = this.getCells(rect.x, rect.y, rect.width, rect.height, null, null, isect, null, true) || [];
        cells = filterWorkspaceDescendantSelection(this, container, cells);
        if (this.isToggleEvent && this.isToggleEvent(evt)) {
            for (let i = 0; i < cells.length; i++) this.selectCellForEvent(cells[i], evt);
        } else if (this.selectCellsForEvent) {
            this.selectCellsForEvent(cells, evt);
        } else if (this.setSelectionCells) {
            this.setSelectionCells(cells);
        }
        return cells;
    };

    function getDeepestCellForNativeEvent(graph, evt, fallback) {
        if (!graph || !evt) return fallback || null;
        const pt = mxUtils.convertPoint(
            graph.container,
            mxEvent.getClientX(evt),
            mxEvent.getClientY(evt)
        );
        return graph.getCellAt(pt.x, pt.y) || fallback || null;
    }

    function getSelectionCellForNativeEvent(graph, evt, fallback) {
        const deepest = getDeepestCellForNativeEvent(graph, evt, fallback);
        const plantTarget = getPlantSelectionTargetForEvent(graph, deepest, evt);
        if (plantTarget && (plantTarget !== deepest || isPlantTile(plantTarget))) return plantTarget;
        if (!graph || !deepest || !fallback || deepest === fallback) return plantTarget || deepest;
        const model = graph.getModel();
        if (model.isVertex(deepest) && model.isVertex(fallback) && isStrictAncestorOf(model, fallback, deepest)) {
            if (!graph.isCellMovable(deepest) && graph.isCellMovable(fallback)) return fallback;
        }
        return plantTarget || deepest;
    }

    function isPlantTile(cell) {
        return !!cell && cell.getAttribute && cell.getAttribute('plant_tiler') === '1';
    }

    function isTilerGroup(cell) {
        return !!cell && cell.getAttribute && cell.getAttribute('tiler_group') === '1';
    }

    function isGardenBed(cell) {
        if (!cell || !cell.getAttribute) return false;
        return cell.getAttribute('garden_bed') === '1' || cell.getAttribute('gardenBed') === '1' || cell.getAttribute('is_garden_bed') === '1';
    }

    function isGardenModule(cell) {
        return !!cell && cell.getAttribute && (cell.getAttribute('garden_module') === '1' || cell.getAttribute('trellis_garden_module') === '1');
    }

    function isTrellisModule(cell) {
        const style = cell && (typeof cell.getStyle === 'function' ? cell.getStyle() : cell.style) || '';
        return /(?:^|;)module=1(?=;|$)/.test(String(style));
    }

    function isKanbanLane(cell) {
        return !!cell && cell.getAttribute && !!cell.getAttribute('lane_key');
    }

    function isCanonicalKanbanBoardCell(cell) {
        return !!cell && cell.getAttribute && cell.getAttribute('board_key') === 'KANBAN_BOARD';
    }

    function findCanonicalKanbanBoardAncestor(cell) {
        const model = graph && graph.getModel ? graph.getModel() : null;
        let cur = cell;
        while (cur) {
            if (isCanonicalKanbanBoardCell(cur)) return cur;
            cur = model && model.getParent ? model.getParent(cur) : null;
        }
        return null;
    }

    function isCanonicalKanbanBoardLane(cell) {
        return isKanbanLane(cell) && !!findCanonicalKanbanBoardAncestor(cell);
    }

    function getWorkspaceContainerType(cell) {
        if (isKanbanLane(cell)) return 'lane';
        if (isGardenModule(cell) || isTrellisModule(cell)) return 'module';
        return null;
    }

    function isWorkspaceContainer(cell) {
        return !!getWorkspaceContainerType(cell);
    }

    function isWorkspaceHandleEligibleForCell(cell) {
        return isWorkspaceContainer(cell) && !isCanonicalKanbanBoardLane(cell);
    }

    function getOccupiedBedMoveUnit(cell) {
        const api = graph && graph.__trellisBedSuccessionNavigator;
        const resolve = api && api.resolveOccupiedBedMoveUnit;
        if (typeof resolve !== 'function') return null;
        const unit = resolve(cell);
        if (!unit || !unit.bed || !Array.isArray(unit.cells) || unit.cells.length < 2) return null;
        if (!graph.isCellVisible(unit.bed) || !graph.isCellMovable(unit.bed) || !graph.view || !graph.view.getState(unit.bed)) return null;
        for (let i = 0; i < unit.cells.length; i++) {
            if (!unit.cells[i] || !graph.isCellMovable(unit.cells[i])) return null;
        }
        return unit;
    }

    function isOccupiedBedHandleCell(cell) {
        const unit = getOccupiedBedMoveUnit(cell);
        return !!(unit && unit.bed === cell);
    }

    function getHandleCellForSelectedCell(cell) {
        const unit = getOccupiedBedMoveUnit(cell);
        return unit ? unit.bed : cell;
    }

    function getWorkspaceHandleDragCells(cell) {
        const unit = getOccupiedBedMoveUnit(cell);
        return unit ? unit.cells.slice() : [cell];
    }

    function isLodSummary(cell) {
        return !!cell && cell.getAttribute && cell.getAttribute('lod_summary') === '1';
    }

    function isCollapsedTilerGroup(cell) {
        return isTilerGroup(cell) && cell.getAttribute('lod_collapsed') === '1';
    }

    function findTilerGroupAncestor(graph, cell) {
        if (!graph || !cell) return null;
        const model = graph.getModel();
        let cur = cell;
        while (cur) {
            if (isTilerGroup(cur)) return cur;
            cur = model.getParent(cur);
        }
        return null;
    }

    function isPlantGroupSelected(graph, groupCell) {
        return !!graph && !!groupCell && graph.isCellSelected && graph.isCellSelected(groupCell);
    }

    function eventTargetsPlantChildDirectly(graph, evt, groupCell) {
        if (!evt) return isPlantGroupSelected(graph, groupCell);
        return mxEvent.isControlDown(evt) || mxEvent.isMetaDown(evt) || mxEvent.isShiftDown(evt) || isPlantGroupSelected(graph, groupCell);
    }

    function getPlantSelectionTargetForEvent(graph, cell, evt) {
        if (!graph || !cell) return cell || null;
        const group = findTilerGroupAncestor(graph, cell);
        if (!group) return cell;
        if (isPlantTile(cell)) return eventTargetsPlantChildDirectly(graph, evt, group) ? cell : group;
        if (isLodSummary(cell)) return eventTargetsPlantChildDirectly(graph, evt, group) ? cell : group;
        if (isCollapsedTilerGroup(cell) || isTilerGroup(cell)) return group;
        return cell;
    }

    function plantExactHitIgnoreFn(ignoreFn) {
        return function (state, x, y) {
            if (ignoreFn && ignoreFn(state, x, y)) return true;
            return !!state && isPlantTile(state.cell) && !isPointInPlantTileCircleState(state, x, y);
        };
    }

    function cellStateContainsPoint(graph, state, x, y) {
        if (!state) return false;
        if (isPlantTile(state.cell)) return isPointInPlantTileCircleState(state, x, y);
        return graph && graph.intersects ? graph.intersects(state, x, y) : mxUtils.contains(state, x, y);
    }

    function isPointInPlantTileCircleState(state, x, y) {
        if (!state) return false;
        const rx = Number(state.width) / 2;
        const ry = Number(state.height) / 2;
        if (!isFinite(rx) || !isFinite(ry) || rx <= 0 || ry <= 0) return false;
        const cx = Number(state.x) + rx;
        const cy = Number(state.y) + ry;
        let px = x;
        let py = y;
        const rotation = Number(mxUtils.getValue(state.style, mxConstants.STYLE_ROTATION, 0)) || 0;
        if (rotation) {
            const alpha = mxUtils.toRadians(rotation);
            const point = mxUtils.getRotatedPoint(new mxPoint(x, y), Math.cos(-alpha), Math.sin(-alpha), new mxPoint(cx, cy));
            px = point.x;
            py = point.y;
        }
        const dx = (px - cx) / rx;
        const dy = (py - cy) / ry;
        return (dx * dx) + (dy * dy) <= 1;
    }

    function getPlantClickThroughCellAt(graph, x, y, parent, initial) {
        if (!graph || !initial) return null;
        const group = findTilerGroupAncestor(graph, initial);
        if (!group) return null;
        if (isLodSummary(initial)) return initial;
        const plantSelectable = findTopmostPlantSelectableAt(graph, x, y, parent);
        if (plantSelectable) return plantSelectable;
        if (isCollapsedTilerGroup(group)) return initial;
        return findTopmostGardenBedAt(graph, x, y, parent) || null;
    }

    function findTopmostPlantSelectableAt(graph, x, y, parent) {
        const model = graph && graph.getModel ? graph.getModel() : null;
        if (!model) return null;
        const root = parent || graph.getCurrentRoot && graph.getCurrentRoot() || model.getRoot();
        return scanTopmostPlantSelectable(graph, model, root, x, y);
    }

    function scanTopmostPlantSelectable(graph, model, parent, x, y) {
        if (!parent) return null;
        for (let i = model.getChildCount(parent) - 1; i >= 0; i--) {
            const cell = model.getChildAt(parent, i);
            if (!cell || !graph.isCellVisible(cell)) continue;
            const childHit = scanTopmostPlantSelectable(graph, model, cell, x, y);
            if (childHit) return childHit;
            const state = graph.view.getState(cell);
            if (state && isPlantTile(cell) && isPointInPlantTileCircleState(state, x, y)) return cell;
            if (state && isLodSummary(cell) && cellStateContainsPoint(graph, state, x, y)) return cell;
        }
        return null;
    }

    function findTopmostGardenBedAt(graph, x, y, parent) {
        const model = graph && graph.getModel ? graph.getModel() : null;
        if (!model) return null;
        const root = parent || graph.getCurrentRoot && graph.getCurrentRoot() || model.getRoot();
        return scanTopmostGardenBed(graph, model, root, x, y);
    }

    function scanTopmostGardenBed(graph, model, parent, x, y) {
        if (!parent) return null;
        for (let i = model.getChildCount(parent) - 1; i >= 0; i--) {
            const cell = model.getChildAt(parent, i);
            if (!cell || !graph.isCellVisible(cell)) continue;
            const childHit = scanTopmostGardenBed(graph, model, cell, x, y);
            if (childHit) return childHit;
            if (!isGardenBed(cell)) continue;
            const state = graph.view.getState(cell);
            if (state && cellStateContainsPoint(graph, state, x, y)) return cell;
        }
        return null;
    }

    function isStrictAncestorOf(model, ancestor, cell) {
        if (!model || !ancestor || !cell || ancestor === cell) return false;
        let cur = model.getParent(cell);
        while (cur) {
            if (cur === ancestor) return true;
            cur = model.getParent(cur);
        }
        return false;
    }

    function filterWorkspaceDescendantSelection(graph, container, cells) {
        const model = graph && graph.getModel ? graph.getModel() : null;
        if (!model || !container) return [];
        const out = [];
        for (let i = 0; i < (cells || []).length; i++) {
            const cell = cells[i];
            if (!cell || isWorkspaceContainer(cell)) continue;
            if (hasWorkspaceContainerAncestor(model, cell) && out.indexOf(cell) < 0) out.push(cell);
        }
        return out;
    }

    function hasWorkspaceContainerAncestor(model, cell) {
        let cur = model && cell ? model.getParent(cell) : null;
        while (cur) {
            if (isWorkspaceContainer(cur)) return true;
            cur = model.getParent(cur);
        }
        return false;
    }

    function hasSelectedAncestor(graph, cell) {
        if (!graph || !cell) return false;
        const model = graph.getModel();
        const selected = graph.getSelectionCells ? graph.getSelectionCells() : [];
        for (const selectedCell of selected || []) {
            if (isStrictAncestorOf(model, selectedCell, cell)) return true;
        }
        return false;
    }

    function isOnlySelectedCell(graph, cell) {
        const selected = graph && graph.getSelectionCells ? (graph.getSelectionCells() || []) : [];
        return selected.length === 1 && selected[0] === cell;
    }

    function isDoubleClickOrTextEditClick(evt) {
        return !!evt && Number(evt.detail || 0) > 1;
    }

    function shouldCloseGardenModuleIrrigationOnPlainClick(graph, cell, evt) {
        return !isDoubleClickOrTextEditClick(evt) && isGardenModule(cell) && isOnlySelectedCell(graph, cell);
    }

    function clearSelection(graph) {
        if (graph && graph.clearSelection) graph.clearSelection();
        else if (graph && graph.setSelectionCells) graph.setSelectionCells([]);
        else if (graph && graph.setSelectionCell) graph.setSelectionCell(null);
    }

    function closeIrrigationModeIfAvailable(graph) {
        const graphApi = graph && graph.__trellisIrrigationPlanner;
        const windowApi = typeof window !== 'undefined' && window.TrellisIrrigationPlanner;
        const close = graphApi && graphApi.closeIrrigationMode || windowApi && windowApi.closeIrrigationMode;
        if (typeof close === 'function') close();
    }

    function getDeepestCellForMouseEvent(graph, me, fallback) {
        if (!graph || !me) return fallback || null;
        const pt = mxUtils.convertPoint(graph.container, me.getX(), me.getY());
        return graph.getCellAt(pt.x, pt.y) || fallback || null;
    }

    function isPrimaryPointerEvent(evt) {
        if (!evt) return true;
        if ((mxEvent.isPopupTrigger && mxEvent.isPopupTrigger(evt)) || evt.button === 2) return false;
        return evt.button == null || evt.button === 0;
    }

    function isWorkspaceHandleEvent(evt) {
        let node = evt && (evt.target || evt.srcElement);
        while (node) {
            if (node.getAttribute && node.getAttribute('data-trellis-workspace-drag-handle') === '1') return true;
            node = node.parentNode;
        }
        return false;
    }

    function isCellControlEvent(me) {
        if (!me || !me.getState || !me.isSource) return false;
        const state = me.getState();
        return !!(state && state.control && me.isSource(state.control));
    }

    function getWorkspaceStyleValue(cell, state, key, fallback) {
        const style = state && state.style || graph.getCurrentCellStyle && graph.getCurrentCellStyle(cell) || cell && cell.style || '';
        if (style && typeof style === 'object') return mxUtils.getValue ? mxUtils.getValue(style, key, fallback) : (style[key] != null ? style[key] : fallback);
        const match = String(style || '').match(new RegExp('(?:^|;)' + key + '=([^;]*)(?=;|$)'));
        return match ? match[1] : fallback;
    }

    function isWorkspaceSwimlaneCell(graph, cell, state) {
        if (graph && graph.isSwimlane && graph.isSwimlane(cell)) return true;
        const shape = getWorkspaceStyleValue(cell, state, mxConstants.STYLE_SHAPE || 'shape', null);
        const style = cell && cell.style || '';
        return shape === mxConstants.SHAPE_SWIMLANE || shape === 'swimlane' || /(?:^|;)swimlane(?:;|$)/.test(String(style));
    }

    function getWorkspaceHeaderSize(graph, cell, state) {
        if (graph && graph.getStartSize) return graph.getStartSize(cell) || { width: 0, height: 0 };
        const startKey = mxConstants.STYLE_STARTSIZE || 'startSize';
        const horizontalKey = mxConstants.STYLE_HORIZONTAL || 'horizontal';
        const defaultStartSize = Number(mxConstants.DEFAULT_STARTSIZE) || 40;
        const startSize = Number(getWorkspaceStyleValue(cell, state, startKey, defaultStartSize)) || 0;
        const horizontal = String(getWorkspaceStyleValue(cell, state, horizontalKey, '1')) !== '0';
        return horizontal ? { width: 0, height: startSize } : { width: startSize, height: 0 };
    }

    function isWorkspaceHeaderDragStart(graph, cell, me) {
        const state = cell && graph.view && graph.view.getState(cell);
        const evt = me && me.getEvent ? me.getEvent() : null;
        const pt = eventPointInGraphContainer(evt);
        if (!state || !pt || !isWorkspaceSwimlaneCell(graph, cell, state)) return false;
        const size = getWorkspaceHeaderSize(graph, cell, state);
        const headerWidth = Math.max(0, Math.min(Number(size.width) || 0, Number(state.width) || 0));
        const headerHeight = Math.max(0, Math.min(Number(size.height) || 0, Number(state.height) || 0));
        const inBounds = pt.x >= state.x && pt.x <= state.x + state.width && pt.y >= state.y && pt.y <= state.y + state.height;
        return inBounds && ((headerHeight > 0 && pt.y <= state.y + headerHeight) || (headerWidth > 0 && pt.x <= state.x + headerWidth));
    }

    function getWorkspaceSurfaceDragContext(graph, me) {
        if (!graph || !me || me.isConsumed && me.isConsumed()) return null;
        const evt = me.getEvent ? me.getEvent() : null;
        if (!isPrimaryPointerEvent(evt) || isWorkspaceHandleEvent(evt) || isCellControlEvent(me)) return null;
        const cell = getDeepestCellForMouseEvent(graph, me, me.getCell ? me.getCell() : null);
        const type = getWorkspaceContainerType(cell);
        if (!type || !graph.getModel || !graph.getModel().isVertex(cell)) return null;
        if (isWorkspaceHeaderDragStart(graph, cell, me)) return null;
        return { cell: cell, type: type };
    }

    function findMovableDragAncestorForLockedCell(graph, cell) {
        if (!graph || !cell) return null;
        const model = graph.getModel();
        let cur = model.getParent(cell);
        while (cur) {
            if (model.isVertex(cur) && graph.isCellMovable(cur)) return cur;
            cur = model.getParent(cur);
        }
        return null;
    }

    function selectedTilerDragTargetForEvent(graph, me, fallback) {
        if (!graph || !me || !graph.view) return null;
        const evt = me.getEvent ? me.getEvent() : null;
        const pt = eventPointInGraphContainer(evt) || { x: me.getX(), y: me.getY() };
        const selected = graph.getSelectionCells ? (graph.getSelectionCells() || []) : [];
        const candidates = [];
        if (fallback && selected.indexOf(fallback) >= 0) candidates.push(fallback);
        for (let i = 0; i < selected.length; i++) {
            if (candidates.indexOf(selected[i]) < 0) candidates.push(selected[i]);
        }
        for (let i = 0; i < candidates.length; i++) {
            const cell = candidates[i];
            if (!isTilerGroup(cell)) continue;
            const state = graph.view.getState(cell);
            if (state && cellStateContainsPoint(graph, state, pt.x, pt.y)) return cell;
        }
        return null;
    }

    function getDragInitialCellForEvent(graph, me, fallback, handler) {
        if (handler) {
            handler.__manualLinkerLockedDragSource = null;
            handler.__manualLinkerLockedDragParent = null;
        }
        const selectedTilerTarget = selectedTilerDragTargetForEvent(graph, me, fallback);
        if (selectedTilerTarget) return selectedTilerTarget;
        const deepest = getDeepestCellForMouseEvent(graph, me, fallback);
        const dragTarget = getPlantSelectionTargetForEvent(graph, deepest, me && me.getEvent ? me.getEvent() : null);
        if (!graph || !dragTarget || !graph.getModel().isVertex(dragTarget)) return dragTarget;
        if (graph.isCellMovable(dragTarget)) return dragTarget;

        const movableParent = findMovableDragAncestorForLockedCell(graph, dragTarget);
        if (!movableParent) return dragTarget;
        if (handler) {
            handler.__manualLinkerLockedDragSource = dragTarget;
            handler.__manualLinkerLockedDragParent = movableParent;
        }
        return movableParent;
    }

    const oldIsDelayedSelection = mxGraphHandler.prototype.isDelayedSelection;
    mxGraphHandler.prototype.isDelayedSelection = function (cell, me) {
        const graph = this.graph;
        const deepest = getPlantSelectionTargetForEvent(graph, getDeepestCellForMouseEvent(graph, me, cell), me && me.getEvent ? me.getEvent() : null);

        if (deepest && deepest !== cell && graph.getModel().isVertex(deepest)) {
            if (!graph.isCellSelected(deepest) && hasSelectedAncestor(graph, deepest)) return false;
        }

        if (deepest && graph.getModel().isVertex(deepest)) {
            if (!graph.isCellSelected(deepest) && hasSelectedAncestor(graph, deepest)) return false;
        }

        return oldIsDelayedSelection.apply(this, arguments);
    };

    const oldGetCellsForDrag = mxGraphHandler.prototype.getCells;
    mxGraphHandler.prototype.getCells = function (initialCell, cells) {
        const graph = this.graph;
        if (this.__trellisWorkspaceHandleDragCells && this.__trellisWorkspaceHandleDragCells.length) return this.__trellisWorkspaceHandleDragCells.slice();
        const redirectedParent = this.__manualLinkerLockedDragParent;
        if (redirectedParent && graph.getModel().isVertex(redirectedParent) && graph.isCellMovable(redirectedParent)) {
            const explicitCells = cells || [];
            if (initialCell === redirectedParent || this.cell === redirectedParent || explicitCells.indexOf(redirectedParent) >= 0) {
                return [redirectedParent];
            }
        }

        if (initialCell && graph.getModel().isVertex(initialCell)) {
            if (!graph.isCellSelected(initialCell) && hasSelectedAncestor(graph, initialCell)) return [initialCell];
        }

        return oldGetCellsForDrag.apply(this, arguments);
    };

    graph.selectCellForEvent = function (cell, evt) {
        cell = getSelectionCellForNativeEvent(this, evt, cell);
        if (!cell) return;

        const isCtrl = mxEvent.isControlDown(evt) || mxEvent.isMetaDown(evt);
        const isShift = mxEvent.isShiftDown(evt);

        if (isCtrl && this.__ctrlToggleHandled) {
            this.__ctrlToggleHandled = false;
            return;
        }

        if (isCtrl) {
            if (this.isCellSelected(cell)) this.removeSelectionCell(cell);
            else this.addSelectionCell(cell);
            return;
        }

        if (isShift) {
            this.addSelectionCell(cell);
            return;
        }

        if (shouldCloseGardenModuleIrrigationOnPlainClick(this, cell, evt)) closeIrrigationModeIfAvailable(this);

        this.setSelectionCell(cell);
    };

    function getCellId(cell) {
        return cell && (cell.id || (cell.getId && cell.getId())) || null;
    }

    function ensureWorkspaceOverlayHost() {
        const host = graph.container;
        if (!host) return null;
        const style = window.getComputedStyle ? window.getComputedStyle(host) : null;
        if (style && style.position === 'static') host.style.position = 'relative';
        return host;
    }

    function isWorkspaceHandleVisibleForCell(cell) {
        return isWorkspaceHandleEligibleForCell(cell) && graph.isCellVisible(cell) && graph.isCellMovable(cell) && graph.view && graph.view.getState(cell);
    }

    function isHandleVisibleForResolvedCell(cell) {
        return isWorkspaceHandleVisibleForCell(cell) || isOccupiedBedHandleCell(cell);
    }

    function getWorkspaceHandleCells() {
        const cells = [];
        const seen = {};
        const selected = graph.getSelectionCells ? (graph.getSelectionCells() || []) : [];
        function add(cell) {
            const id = getCellId(cell);
            if (!id || seen[id] || !isHandleVisibleForResolvedCell(cell)) return;
            seen[id] = true;
            cells.push(cell);
        }
        for (let i = 0; i < selected.length; i++) add(getHandleCellForSelectedCell(selected[i]));
        add(workspaceHoveredCell);
        add(workspaceDraggingHandleCell);
        return cells;
    }

    function styleWorkspaceHandle(handle) {
        handle.type = 'button';
        handle.setAttribute('data-trellis-workspace-drag-handle', '1');
        handle.style.position = 'absolute';
        handle.style.zIndex = String(GRAPH_OVERLAY_Z.CONTROL_TOP);
        handle.style.width = WORKSPACE_HANDLE_SIZE + 'px';
        handle.style.height = WORKSPACE_HANDLE_SIZE + 'px';
        handle.style.padding = '0';
        handle.style.border = '1px solid rgba(60, 64, 67, 0.35)';
        handle.style.borderRadius = '4px';
        handle.style.background = 'rgba(255, 255, 255, 0.96)';
        handle.style.boxShadow = '0 1px 4px rgba(0, 0, 0, 0.20)';
        handle.style.cursor = 'move';
        handle.style.color = '#3c4043';
        handle.style.font = '13px Arial, sans-serif';
        handle.style.lineHeight = WORKSPACE_HANDLE_SIZE + 'px';
        handle.style.textAlign = 'center';
        handle.style.pointerEvents = 'auto';
        handle.style.display = 'flex';
        handle.style.alignItems = 'center';
        handle.style.justifyContent = 'center';
        handle.style.overflow = 'hidden';
        handle.textContent = '';
    }

    function addWorkspaceHandleIcon(handle) {
        while (handle.firstChild) handle.removeChild(handle.firstChild);
        if (typeof Editor !== 'undefined' && Editor.moveImage) {
            const img = document.createElement('img');
            img.setAttribute('src', Editor.moveImage);
            img.setAttribute('alt', '');
            img.setAttribute('aria-hidden', 'true');
            img.style.width = '16px';
            img.style.height = '16px';
            img.style.display = 'block';
            img.style.pointerEvents = 'none';
            handle.appendChild(img);
        } else {
            handle.textContent = '+';
        }
    }

    function createWorkspaceHandle(cell) {
        const handle = document.createElement('button');
        styleWorkspaceHandle(handle);
        addWorkspaceHandleIcon(handle);
        handle.setAttribute('aria-label', workspaceHandleTitle(cell));
        handle.setAttribute('title', workspaceHandleTitle(cell));
        mxEvent.addListener(handle, 'mousedown', function (evt) {
            beginWorkspaceHandleDrag(cell, evt);
        });
        mxEvent.addListener(handle, 'mousemove', function () {
            workspaceHoveredCell = cell;
            scheduleWorkspaceHandleRefresh();
        });
        return handle;
    }

    function workspaceHandleTitle(cell) {
        const unit = isOccupiedBedHandleCell(cell) ? getOccupiedBedMoveUnit(cell) : null;
        if (unit) return unit.bedAssemblies && unit.bedAssemblies.length ? 'Move garden bed, irrigation assembly, and planting groups' : 'Move garden bed and planting groups';
        return getWorkspaceContainerType(cell) === 'lane' ? 'Move lane' : 'Move module';
    }

    function viewBoundsForCells(cells) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = 0; i < (cells || []).length; i++) {
            const state = graph.view && graph.view.getState(cells[i]);
            if (!state) continue;
            minX = Math.min(minX, state.x);
            minY = Math.min(minY, state.y);
            maxX = Math.max(maxX, state.x + state.width);
            maxY = Math.max(maxY, state.y + state.height);
        }
        if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return null;
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }

    function workspaceHandleBounds(cell) {
        const unit = isOccupiedBedHandleCell(cell) ? getOccupiedBedMoveUnit(cell) : null;
        const unitBounds = unit && viewBoundsForCells(unit.cells);
        if (unitBounds) return unitBounds;
        return graph.view && graph.view.getState(cell);
    }

    function positionWorkspaceHandle(handle, cell) {
        const bounds = workspaceHandleBounds(cell);
        if (!bounds) return false;
        handle.style.left = Math.round(bounds.x - WORKSPACE_HANDLE_SIZE - WORKSPACE_HANDLE_GAP - 2) + 'px';
        handle.style.top = Math.round(bounds.y - WORKSPACE_HANDLE_SIZE - WORKSPACE_HANDLE_GAP - 2) + 'px';
        handle.setAttribute('aria-label', workspaceHandleTitle(cell));
        handle.setAttribute('title', workspaceHandleTitle(cell));
        return true;
    }

    function refreshWorkspaceHandles() {
        workspaceHandleRefreshThread = null;
        const host = ensureWorkspaceOverlayHost();
        if (!host) return;
        const cells = getWorkspaceHandleCells();
        const keep = {};
        for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            const id = getCellId(cell);
            let entry = workspaceHandleEntries.get(id);
            if (!entry) {
                entry = { cell: cell, handle: createWorkspaceHandle(cell) };
                workspaceHandleEntries.set(id, entry);
            }
            if (entry.handle.parentNode !== host) host.appendChild(entry.handle);
            if (positionWorkspaceHandle(entry.handle, cell)) keep[id] = true;
        }
        workspaceHandleEntries.forEach(function (entry, id) {
            if (!keep[id]) {
                if (entry.handle.parentNode) entry.handle.parentNode.removeChild(entry.handle);
                workspaceHandleEntries.delete(id);
            }
        });
    }

    function scheduleWorkspaceHandleRefresh() {
        if (workspaceHandleRefreshThread) return;
        workspaceHandleRefreshThread = window.setTimeout(refreshWorkspaceHandles, 0);
    }

    function eventPointInGraphContainer(evt) {
        if (!evt || !graph.container) return null;
        return mxUtils.convertPoint(graph.container, mxEvent.getClientX(evt), mxEvent.getClientY(evt));
    }

    function pointInWorkspaceGrace(cell, pt) {
        const state = cell && graph.view && graph.view.getState(cell);
        if (!state || !pt) return false;
        return pt.x >= state.x - WORKSPACE_HOVER_GRACE_PX && pt.x <= state.x + state.width + WORKSPACE_HOVER_GRACE_PX && pt.y >= state.y - WORKSPACE_HOVER_GRACE_PX && pt.y <= state.y + state.height + WORKSPACE_HOVER_GRACE_PX;
    }

    function setWorkspaceSelectCursor() {
        if (!graph.container) return;
        if (!workspaceCursorOverrideActive) {
            workspaceCursorPreviousValue = graph.container.style.cursor || '';
            workspaceCursorOverrideActive = true;
        }
        graph.container.style.cursor = 'default';
    }

    function restoreWorkspaceCursor() {
        if (!workspaceCursorOverrideActive || !graph.container) return;
        graph.container.style.cursor = workspaceCursorPreviousValue;
        workspaceCursorOverrideActive = false;
        workspaceCursorPreviousValue = '';
    }

    function shouldUseWorkspaceSelectCursor(me, hit) {
        const evt = me && me.getEvent ? me.getEvent() : null;
        if (!hit || workspaceDraggingHandleCell || isWorkspaceHandleEvent(evt) || isCellControlEvent(me)) return false;
        if (!isWorkspaceContainer(hit) || !graph.isCellVisible(hit) || !graph.view || !graph.view.getState(hit)) return false;
        return !isWorkspaceHeaderDragStart(graph, hit, me);
    }

    function updateWorkspaceCursorFromHover(me, hit) {
        if (shouldUseWorkspaceSelectCursor(me, hit)) setWorkspaceSelectCursor();
        else restoreWorkspaceCursor();
    }

    function updateWorkspaceHoverFromMouseEvent(me) {
        if (workspaceDraggingHandleCell) return;
        const evt = me && me.getEvent ? me.getEvent() : null;
        const hit = getDeepestCellForMouseEvent(graph, me, null);
        const pt = eventPointInGraphContainer(evt);
        updateWorkspaceCursorFromHover(me, hit);
        if (workspaceHoveredCell && workspaceHoveredCell !== hit && isKanbanLane(workspaceHoveredCell) && pointInWorkspaceGrace(workspaceHoveredCell, pt)) {
            scheduleWorkspaceHandleRefresh();
            return;
        }
        if (isWorkspaceHandleVisibleForCell(hit)) {
            workspaceHoveredCell = hit;
        } else if (!pointInWorkspaceGrace(workspaceHoveredCell, pt)) {
            workspaceHoveredCell = null;
        }
        scheduleWorkspaceHandleRefresh();
    }

    function beginWorkspaceHandleDrag(cell, evt) {
        if (!cell || !graph.isCellMovable(cell)) return;
        const dragCells = getWorkspaceHandleDragCells(cell);
        const occupiedBedDrag = isOccupiedBedHandleCell(cell);
        restoreWorkspaceCursor();
        if (occupiedBedDrag && graph.setSelectionCells) graph.setSelectionCells(dragCells);
        else if (!occupiedBedDrag && (!graph.isCellSelected || !graph.isCellSelected(cell))) graph.setSelectionCell(cell);
        workspaceDraggingHandleCell = cell;
        workspaceHoveredCell = cell;
        const handler = graph.graphHandler;
        if (handler) {
            const oldMouseDown = graph.isMouseDown;
            graph.isMouseDown = true;
            handler.mouseDownX = mxEvent.getClientX(evt);
            handler.mouseDownY = mxEvent.getClientY(evt);
            handler.delayedSelection = true;
            handler.cell = cell;
            if (occupiedBedDrag) handler.__trellisWorkspaceHandleDragCells = dragCells;
            const move = function (moveEvt) {
                handler.mouseMove(graph, createWorkspaceMouseEvent(moveEvt, cell));
            };
            const up = function (upEvt) {
                try {
                    handler.mouseUp(graph, createWorkspaceMouseEvent(upEvt, cell));
                } finally {
                    graph.isMouseDown = oldMouseDown;
                    workspaceDraggingHandleCell = null;
                    handler.__trellisWorkspaceHandleDragCells = null;
                    mxEvent.removeGestureListeners(document, null, move, up);
                    scheduleWorkspaceHandleRefresh();
                }
            };
            mxEvent.addGestureListeners(document, null, move, up);
        }
        scheduleWorkspaceHandleRefresh();
        mxEvent.consume(evt);
    }

    function createWorkspaceMouseEvent(evt, fallbackCell) {
        if (typeof mxMouseEvent !== 'function') return { getEvent: function () { return evt; }, getX: function () { return mxEvent.getClientX(evt); }, getY: function () { return mxEvent.getClientY(evt); }, getCell: function () { return fallbackCell; }, isConsumed: function () { return false; }, consume: function () { } };
        const pt = eventPointInGraphContainer(evt);
        const cell = pt && graph.getCellAt ? graph.getCellAt(pt.x, pt.y) : fallbackCell;
        const state = cell && graph.view ? graph.view.getState(cell) : graph.view && graph.view.getState(fallbackCell);
        return new mxMouseEvent(evt, state);
    }

    function shouldShowWorkspaceCallout(graph, context, rubberband, me) {
        if (!context || workspaceCalloutSeenByType[context.type]) return false;
        if (context.type === 'lane' && isCanonicalKanbanBoardLane(context.cell)) return false;
        if (rubberband && rubberband.div) return true;
        if (!rubberband || !rubberband.first || !me) return false;
        const dx = Math.abs((rubberband.first.x || 0) - me.getX());
        const dy = Math.abs((rubberband.first.y || 0) - me.getY());
        return dx > (graph.tolerance || 4) || dy > (graph.tolerance || 4);
    }

    function getWorkspaceCalloutAnchorPoint(cell, me) {
        const evt = me && me.getEvent ? me.getEvent() : null;
        const cursorPoint = eventPointInGraphContainer(evt);
        if (cursorPoint) return cursorPoint;
        const state = graph.view && graph.view.getState(cell);
        return state ? { x: state.x, y: state.y } : { x: 0, y: 0 };
    }

    function showWorkspaceMoveCallout(cell, type, me) {
        workspaceCalloutSeenByType[type] = true;
        if (workspaceCalloutDiv && workspaceCalloutDiv.parentNode) workspaceCalloutDiv.parentNode.removeChild(workspaceCalloutDiv);
        const host = ensureWorkspaceOverlayHost();
        if (!host) return;
        const div = document.createElement('div');
        div.textContent = type === 'lane' ? 'To move this lane, drag the handle in the top-left corner.' : 'To move this module, drag the handle in the top-left corner.';
        div.style.position = 'absolute';
        div.style.zIndex = String(GRAPH_OVERLAY_Z.CONTROL_TOP);
        div.style.maxWidth = '260px';
        div.style.padding = '8px 10px';
        div.style.border = '1px solid rgba(60, 64, 67, 0.28)';
        div.style.borderRadius = '6px';
        div.style.background = 'rgba(32, 33, 36, 0.94)';
        div.style.color = '#fff';
        div.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.24)';
        div.style.font = '12px Arial, sans-serif';
        div.style.lineHeight = '16px';
        div.style.pointerEvents = 'none';
        const pt = getWorkspaceCalloutAnchorPoint(cell, me);
        div.style.left = Math.round(pt.x + 8) + 'px';
        div.style.top = Math.round(pt.y + 8) + 'px';
        host.appendChild(div);
        workspaceCalloutDiv = div;
        window.setTimeout(function () {
            if (div.parentNode) div.parentNode.removeChild(div);
            if (workspaceCalloutDiv === div) workspaceCalloutDiv = null;
        }, WORKSPACE_CALLOUT_MS);
    }

    if (graph.addMouseListener) {
        graph.addMouseListener({
            mouseDown() { },
            mouseMove(sender, me) { updateWorkspaceHoverFromMouseEvent(me); },
            mouseUp() { graph.__trellisWorkspaceDragContext = null; graph.__trellisWorkspaceMarqueeContainer = null; restoreWorkspaceCursor(); }
        });
    }

    function addRefreshListener(source, eventName) {
        if (source && source.addListener && eventName) source.addListener(eventName, scheduleWorkspaceHandleRefresh);
    }

    const selectionModel = graph.getSelectionModel && graph.getSelectionModel();
    addRefreshListener(selectionModel, mxEvent.CHANGE || 'change');
    addRefreshListener(graph, mxEvent.CELLS_MOVED || 'cellsMoved');
    addRefreshListener(graph, mxEvent.CELLS_RESIZED || 'cellsResized');
    addRefreshListener(graph, mxEvent.CELLS_TOGGLED || 'cellsToggled');
    addRefreshListener(graph.view, mxEvent.SCALE || 'scale');
    addRefreshListener(graph.view, mxEvent.TRANSLATE || 'translate');
    addRefreshListener(graph.view, mxEvent.SCALE_AND_TRANSLATE || 'scaleAndTranslate');
    addRefreshListener(graph.view, mxEvent.REPAINT || 'repaint');
    addRefreshListener(graph.getModel && graph.getModel(), mxEvent.CHANGE || 'change');
    if (graph.container && mxEvent.addListener) mxEvent.addListener(graph.container, 'mouseleave', restoreWorkspaceCursor);
    if (typeof window !== 'undefined' && mxEvent.addListener) mxEvent.addListener(window, 'resize', scheduleWorkspaceHandleRefresh);
    scheduleWorkspaceHandleRefresh();

    graph.__trellisWorkspaceDragPolicy = {
        isWorkspaceContainer: isWorkspaceContainer,
        getWorkspaceContainerType: getWorkspaceContainerType,
        filterWorkspaceDescendantSelection: function (container, cells) { return filterWorkspaceDescendantSelection(graph, container, cells); },
        getCalloutAnchorPointForTests: getWorkspaceCalloutAnchorPoint,
        shouldShowCalloutForTests: function (context, rubberband, me) { return shouldShowWorkspaceCallout(graph, context, rubberband, me); },
        getHandleCells: getWorkspaceHandleCells,
        getHandleDragCellsForTests: getWorkspaceHandleDragCells,
        beginHandleDragForTests: beginWorkspaceHandleDrag,
        shouldUseSelectCursorForTests: function (me) { return shouldUseWorkspaceSelectCursor(me, getDeepestCellForMouseEvent(graph, me, null)); },
        updateHoverForTests: updateWorkspaceHoverFromMouseEvent,
        setHoveredCellForTests: function (cell) { workspaceHoveredCell = cell; scheduleWorkspaceHandleRefresh(); },
        refreshHandles: refreshWorkspaceHandles
    };

    console.log('[DeepClickThrough] Deep child selection enabled.');
});
