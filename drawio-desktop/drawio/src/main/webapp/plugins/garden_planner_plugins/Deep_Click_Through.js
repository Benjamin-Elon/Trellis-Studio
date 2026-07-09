/**
 * Draw.io Plugin: Deep Click-Through Selection
 *
 * Selects and drags the deepest visible child under the pointer instead of
 * letting a selected parent intercept descendant clicks. Locked or otherwise
 * non-movable descendants redirect drag gestures to the nearest movable parent.
 */
Draw.loadPlugin(function (ui) { // CHANGE
    const graph = ui.editor && ui.editor.graph; // CHANGE
    if (!graph || graph.__deepClickThroughInstalled) return; // CHANGE
    graph.__deepClickThroughInstalled = true; // CHANGE
    const WORKSPACE_HANDLE_SIZE = 18; // NEW
    const WORKSPACE_HANDLE_GAP = 2; // NEW
    const WORKSPACE_HOVER_GRACE_PX = 30; // NEW
    const WORKSPACE_CALLOUT_MS = 5000; // NEW
    const workspaceCalloutSeenByType = { module: false, lane: false }; // NEW
    let workspaceHoveredCell = null; // NEW
    let workspaceDraggingHandleCell = null; // NEW
    let workspaceHandleRefreshThread = null; // NEW
    let workspaceCalloutDiv = null; // NEW
    let workspaceCursorOverrideActive = false; // NEW
    let workspaceCursorPreviousValue = ''; // NEW
    const workspaceHandleEntries = new Map(); // NEW

    graph.selectParentAfterCollapse = false; // CHANGE
    graph.cellsSelectable = true; // CHANGE
    graph.keepEdgesInBackground = false; // CHANGE
    graph.cellsLocked = false; // CHANGE

    const baseGetCellAt = graph.getCellAt; // CHANGE
    const baseGetCursorForMouseEvent = graph.getCursorForMouseEvent; // NEW

    graph.getCellAt = function (x, y, parent, vertices, edges, ignoreFn) { // CHANGE
        const initial = baseGetCellAt.call(this, x, y, parent, vertices, edges, plantExactHitIgnoreFn(ignoreFn)); // CHANGE
        if (!initial) return null; // CHANGE
        const plantTarget = getPlantClickThroughCellAt(this, x, y, parent, initial); // CHANGE
        if (plantTarget) return plantTarget; // CHANGE
        if (!this.model.isVertex(initial)) return initial; // CHANGE

        const descendants = []; // CHANGE
        const collect = (cell) => { // CHANGE
            const children = this.model.getChildCells(cell); // CHANGE
            if (!children) return; // CHANGE
            for (const child of children) { // CHANGE
                if (this.model.isVertex(child) && this.isCellVisible(child)) descendants.push(child); // CHANGE
                collect(child); // CHANGE
            } // CHANGE
        }; // CHANGE
        collect(initial); // CHANGE

        for (let i = descendants.length - 1; i >= 0; i--) { // CHANGE
            const child = descendants[i]; // CHANGE
            const state = this.view.getState(child); // CHANGE
            if (state && cellStateContainsPoint(this, state, x, y)) return child; // CHANGE
        } // CHANGE
        return initial; // CHANGE
    }; // CHANGE

    graph.getCursorForMouseEvent = function (me) { // NEW
        const hit = getDeepestCellForMouseEvent(this, me, me && me.getCell ? me.getCell() : null); // NEW
        if (shouldUseWorkspaceSelectCursor(me, hit)) return 'default'; // NEW
        return baseGetCursorForMouseEvent ? baseGetCursorForMouseEvent.apply(this, arguments) : null; // NEW
    }; // NEW

    mxGraphHandler.prototype.getInitialCellForEvent = function (me) { // CHANGE
        return getDragInitialCellForEvent(this.graph, me, me.getCell(), this); // CHANGE
    }; // CHANGE

    const oldGraphHandlerMouseDown = mxGraphHandler.prototype.mouseDown; // NEW
    mxGraphHandler.prototype.mouseDown = function (sender, me) { // NEW
        const context = getWorkspaceSurfaceDragContext(this.graph, me); // NEW
        if (context) { // NEW
            this.graph.__trellisWorkspaceDragContext = context; // NEW
            scheduleWorkspaceHandleRefresh(); // NEW
            return; // NEW
        } // NEW
        return oldGraphHandlerMouseDown.apply(this, arguments); // NEW
    }; // NEW

    if (typeof mxRubberband !== 'undefined' && mxRubberband.prototype) { // NEW
        const oldRubberbandMouseDown = mxRubberband.prototype.mouseDown; // NEW
        mxRubberband.prototype.mouseDown = function (sender, me) { // NEW
            const context = this.graph && (this.graph.__trellisWorkspaceDragContext || getWorkspaceSurfaceDragContext(this.graph, me)); // NEW
            if (context && !me.isConsumed() && this.isEnabled() && this.graph.isEnabled() && !mxEvent.isMultiTouchEvent(me.getEvent())) { // NEW
                this.graph.__trellisWorkspaceDragContext = context; // NEW
                this.graph.__trellisWorkspaceMarqueeContainer = context.cell; // NEW
                const offset = mxUtils.getOffset(this.graph.container); // NEW
                const origin = mxUtils.getScrollOrigin(this.graph.container); // NEW
                origin.x -= offset.x; // NEW
                origin.y -= offset.y; // NEW
                this.start(me.getX() + origin.x, me.getY() + origin.y); // NEW
                me.consume(false); // NEW
                return; // NEW
            } // NEW
            return oldRubberbandMouseDown.apply(this, arguments); // NEW
        }; // NEW

        const oldRubberbandMouseMove = mxRubberband.prototype.mouseMove; // NEW
        mxRubberband.prototype.mouseMove = function (sender, me) { // NEW
            const context = this.graph && this.graph.__trellisWorkspaceDragContext; // NEW
            if (context && shouldShowWorkspaceCallout(this.graph, context, this, me)) showWorkspaceMoveCallout(context.cell, context.type, me); // NEW
            return oldRubberbandMouseMove.apply(this, arguments); // NEW
        }; // NEW

        const oldRubberbandMouseUp = mxRubberband.prototype.mouseUp; // NEW
        mxRubberband.prototype.mouseUp = function (sender, me) { // NEW
            try { // NEW
                return oldRubberbandMouseUp.apply(this, arguments); // NEW
            } finally { // NEW
                if (this.graph) { // NEW
                    this.graph.__trellisWorkspaceDragContext = null; // NEW
                    this.graph.__trellisWorkspaceMarqueeContainer = null; // NEW
                } // NEW
            } // NEW
        }; // NEW
    } // NEW

    const baseSelectRegion = graph.selectRegion; // NEW
    graph.selectRegion = function (rect, evt) { // NEW
        const container = this.__trellisWorkspaceMarqueeContainer; // NEW
        if (!container) return baseSelectRegion.apply(this, arguments); // NEW
        const isect = (mxEvent.isAltDown && mxEvent.isAltDown(evt)) ? rect : null; // NEW
        let cells = this.getCells(rect.x, rect.y, rect.width, rect.height, null, null, isect, null, true) || []; // NEW
        cells = filterWorkspaceDescendantSelection(this, container, cells); // NEW
        if (this.isToggleEvent && this.isToggleEvent(evt)) { // NEW
            for (let i = 0; i < cells.length; i++) this.selectCellForEvent(cells[i], evt); // NEW
        } else if (this.selectCellsForEvent) { // NEW
            this.selectCellsForEvent(cells, evt); // NEW
        } else if (this.setSelectionCells) { // NEW
            this.setSelectionCells(cells); // NEW
        } // NEW
        return cells; // NEW
    }; // NEW

    function getDeepestCellForNativeEvent(graph, evt, fallback) { // CHANGE
        if (!graph || !evt) return fallback || null; // CHANGE
        const pt = mxUtils.convertPoint( // CHANGE
            graph.container, // CHANGE
            mxEvent.getClientX(evt), // CHANGE
            mxEvent.getClientY(evt) // CHANGE
        ); // CHANGE
        return graph.getCellAt(pt.x, pt.y) || fallback || null; // CHANGE
    } // CHANGE

    function getSelectionCellForNativeEvent(graph, evt, fallback) { // CHANGE
        const deepest = getDeepestCellForNativeEvent(graph, evt, fallback); // CHANGE
        const plantTarget = getPlantSelectionTargetForEvent(graph, deepest, evt); // CHANGE
        if (plantTarget && (plantTarget !== deepest || isPlantTile(plantTarget))) return plantTarget; // CHANGE
        if (!graph || !deepest || !fallback || deepest === fallback) return plantTarget || deepest; // CHANGE
        const model = graph.getModel(); // CHANGE
        if (model.isVertex(deepest) && model.isVertex(fallback) && isStrictAncestorOf(model, fallback, deepest)) { // CHANGE
            if (!graph.isCellMovable(deepest) && graph.isCellMovable(fallback)) return fallback; // CHANGE
        } // CHANGE
        return plantTarget || deepest; // CHANGE
    } // CHANGE

    function isPlantTile(cell) { // CHANGE
        return !!cell && cell.getAttribute && cell.getAttribute('plant_tiler') === '1'; // CHANGE
    } // CHANGE

    function isTilerGroup(cell) { // CHANGE
        return !!cell && cell.getAttribute && cell.getAttribute('tiler_group') === '1'; // CHANGE
    } // CHANGE

    function isGardenBed(cell) { // CHANGE
        if (!cell || !cell.getAttribute) return false; // CHANGE
        return cell.getAttribute('garden_bed') === '1' || cell.getAttribute('gardenBed') === '1' || cell.getAttribute('is_garden_bed') === '1'; // CHANGE
    } // CHANGE

    function isGardenModule(cell) { // NEW
        return !!cell && cell.getAttribute && (cell.getAttribute('garden_module') === '1' || cell.getAttribute('trellis_garden_module') === '1'); // NEW
    } // NEW

    function isTrellisModule(cell) { // NEW
        const style = cell && (typeof cell.getStyle === 'function' ? cell.getStyle() : cell.style) || ''; // NEW
        return /(?:^|;)module=1(?=;|$)/.test(String(style)); // NEW
    } // NEW

    function isKanbanLane(cell) { // NEW
        return !!cell && cell.getAttribute && !!cell.getAttribute('lane_key'); // NEW
    } // NEW

    function getWorkspaceContainerType(cell) { // NEW
        if (isKanbanLane(cell)) return 'lane'; // CHANGE
        if (isGardenModule(cell) || isTrellisModule(cell)) return 'module'; // CHANGE
        return null; // NEW
    } // NEW

    function isWorkspaceContainer(cell) { // NEW
        return !!getWorkspaceContainerType(cell); // NEW
    } // NEW

    function isLodSummary(cell) { // CHANGE
        return !!cell && cell.getAttribute && cell.getAttribute('lod_summary') === '1'; // CHANGE
    } // CHANGE

    function isCollapsedTilerGroup(cell) { // CHANGE
        return isTilerGroup(cell) && cell.getAttribute('lod_collapsed') === '1'; // CHANGE
    } // CHANGE

    function findTilerGroupAncestor(graph, cell) { // CHANGE
        if (!graph || !cell) return null; // CHANGE
        const model = graph.getModel(); // CHANGE
        let cur = cell; // CHANGE
        while (cur) { // CHANGE
            if (isTilerGroup(cur)) return cur; // CHANGE
            cur = model.getParent(cur); // CHANGE
        } // CHANGE
        return null; // CHANGE
    } // CHANGE

    function isPlantGroupSelected(graph, groupCell) { // CHANGE
        return !!graph && !!groupCell && graph.isCellSelected && graph.isCellSelected(groupCell); // CHANGE
    } // CHANGE

    function eventTargetsPlantChildDirectly(graph, evt, groupCell) { // CHANGE
        if (!evt) return isPlantGroupSelected(graph, groupCell); // CHANGE
        return mxEvent.isControlDown(evt) || mxEvent.isMetaDown(evt) || mxEvent.isShiftDown(evt) || isPlantGroupSelected(graph, groupCell); // CHANGE
    } // CHANGE

    function getPlantSelectionTargetForEvent(graph, cell, evt) { // CHANGE
        if (!graph || !cell) return cell || null; // CHANGE
        const group = findTilerGroupAncestor(graph, cell); // CHANGE
        if (!group) return cell; // CHANGE
        if (isPlantTile(cell)) return eventTargetsPlantChildDirectly(graph, evt, group) ? cell : group; // CHANGE
        if (isLodSummary(cell)) return eventTargetsPlantChildDirectly(graph, evt, group) ? cell : group; // CHANGE
        if (isCollapsedTilerGroup(cell) || isTilerGroup(cell)) return group; // CHANGE
        return cell; // CHANGE
    } // CHANGE

    function plantExactHitIgnoreFn(ignoreFn) { // CHANGE
        return function (state, x, y) { // CHANGE
            if (ignoreFn && ignoreFn(state, x, y)) return true; // CHANGE
            return !!state && isPlantTile(state.cell) && !isPointInPlantTileCircleState(state, x, y); // CHANGE
        }; // CHANGE
    } // CHANGE

    function cellStateContainsPoint(graph, state, x, y) { // CHANGE
        if (!state) return false; // CHANGE
        if (isPlantTile(state.cell)) return isPointInPlantTileCircleState(state, x, y); // CHANGE
        return graph && graph.intersects ? graph.intersects(state, x, y) : mxUtils.contains(state, x, y); // CHANGE
    } // CHANGE

    function isPointInPlantTileCircleState(state, x, y) { // CHANGE
        if (!state) return false; // CHANGE
        const rx = Number(state.width) / 2; // CHANGE
        const ry = Number(state.height) / 2; // CHANGE
        if (!isFinite(rx) || !isFinite(ry) || rx <= 0 || ry <= 0) return false; // CHANGE
        const cx = Number(state.x) + rx; // CHANGE
        const cy = Number(state.y) + ry; // CHANGE
        let px = x; // CHANGE
        let py = y; // CHANGE
        const rotation = Number(mxUtils.getValue(state.style, mxConstants.STYLE_ROTATION, 0)) || 0; // CHANGE
        if (rotation) { // CHANGE
            const alpha = mxUtils.toRadians(rotation); // CHANGE
            const point = mxUtils.getRotatedPoint(new mxPoint(x, y), Math.cos(-alpha), Math.sin(-alpha), new mxPoint(cx, cy)); // CHANGE
            px = point.x; // CHANGE
            py = point.y; // CHANGE
        } // CHANGE
        const dx = (px - cx) / rx; // CHANGE
        const dy = (py - cy) / ry; // CHANGE
        return (dx * dx) + (dy * dy) <= 1; // CHANGE
    } // CHANGE

    function getPlantClickThroughCellAt(graph, x, y, parent, initial) { // CHANGE
        if (!graph || !initial) return null; // CHANGE
        const group = findTilerGroupAncestor(graph, initial); // CHANGE
        if (!group) return null; // CHANGE
        if (isLodSummary(initial)) return initial; // CHANGE
        const plantSelectable = findTopmostPlantSelectableAt(graph, x, y, parent); // CHANGE
        if (plantSelectable) return plantSelectable; // CHANGE
        if (isCollapsedTilerGroup(group)) return initial; // CHANGE
        return findTopmostGardenBedAt(graph, x, y, parent) || null; // CHANGE
    } // CHANGE

    function findTopmostPlantSelectableAt(graph, x, y, parent) { // CHANGE
        const model = graph && graph.getModel ? graph.getModel() : null; // CHANGE
        if (!model) return null; // CHANGE
        const root = parent || graph.getCurrentRoot && graph.getCurrentRoot() || model.getRoot(); // CHANGE
        return scanTopmostPlantSelectable(graph, model, root, x, y); // CHANGE
    } // CHANGE

    function scanTopmostPlantSelectable(graph, model, parent, x, y) { // CHANGE
        if (!parent) return null; // CHANGE
        for (let i = model.getChildCount(parent) - 1; i >= 0; i--) { // CHANGE
            const cell = model.getChildAt(parent, i); // CHANGE
            if (!cell || !graph.isCellVisible(cell)) continue; // CHANGE
            const childHit = scanTopmostPlantSelectable(graph, model, cell, x, y); // CHANGE
            if (childHit) return childHit; // CHANGE
            const state = graph.view.getState(cell); // CHANGE
            if (state && isPlantTile(cell) && isPointInPlantTileCircleState(state, x, y)) return cell; // CHANGE
            if (state && isLodSummary(cell) && cellStateContainsPoint(graph, state, x, y)) return cell; // CHANGE
        } // CHANGE
        return null; // CHANGE
    } // CHANGE

    function findTopmostGardenBedAt(graph, x, y, parent) { // CHANGE
        const model = graph && graph.getModel ? graph.getModel() : null; // CHANGE
        if (!model) return null; // CHANGE
        const root = parent || graph.getCurrentRoot && graph.getCurrentRoot() || model.getRoot(); // CHANGE
        return scanTopmostGardenBed(graph, model, root, x, y); // CHANGE
    } // CHANGE

    function scanTopmostGardenBed(graph, model, parent, x, y) { // CHANGE
        if (!parent) return null; // CHANGE
        for (let i = model.getChildCount(parent) - 1; i >= 0; i--) { // CHANGE
            const cell = model.getChildAt(parent, i); // CHANGE
            if (!cell || !graph.isCellVisible(cell)) continue; // CHANGE
            const childHit = scanTopmostGardenBed(graph, model, cell, x, y); // CHANGE
            if (childHit) return childHit; // CHANGE
            if (!isGardenBed(cell)) continue; // CHANGE
            const state = graph.view.getState(cell); // CHANGE
            if (state && cellStateContainsPoint(graph, state, x, y)) return cell; // CHANGE
        } // CHANGE
        return null; // CHANGE
    } // CHANGE

    function isStrictAncestorOf(model, ancestor, cell) { // CHANGE
        if (!model || !ancestor || !cell || ancestor === cell) return false; // CHANGE
        let cur = model.getParent(cell); // CHANGE
        while (cur) { // CHANGE
            if (cur === ancestor) return true; // CHANGE
            cur = model.getParent(cur); // CHANGE
        } // CHANGE
        return false; // CHANGE
    } // CHANGE

    function filterWorkspaceDescendantSelection(graph, container, cells) { // NEW
        const model = graph && graph.getModel ? graph.getModel() : null; // NEW
        if (!model || !container) return []; // NEW
        const out = []; // NEW
        for (let i = 0; i < (cells || []).length; i++) { // NEW
            const cell = cells[i]; // NEW
            if (cell && cell !== container && isStrictAncestorOf(model, container, cell)) out.push(cell); // NEW
        } // NEW
        return out; // NEW
    } // NEW

    function hasSelectedAncestor(graph, cell) { // CHANGE
        if (!graph || !cell) return false; // CHANGE
        const model = graph.getModel(); // CHANGE
        const selected = graph.getSelectionCells ? graph.getSelectionCells() : []; // CHANGE
        for (const selectedCell of selected || []) { // CHANGE
            if (isStrictAncestorOf(model, selectedCell, cell)) return true; // CHANGE
        } // CHANGE
        return false; // CHANGE
    } // CHANGE

    function isOnlySelectedCell(graph, cell) { // NEW
        const selected = graph && graph.getSelectionCells ? (graph.getSelectionCells() || []) : []; // NEW
        return selected.length === 1 && selected[0] === cell; // NEW
    } // NEW

    function isDoubleClickOrTextEditClick(evt) { // NEW
        return !!evt && Number(evt.detail || 0) > 1; // NEW
    } // NEW

    function shouldCloseGardenModuleIrrigationOnPlainClick(graph, cell, evt) { // CHANGE
        return !isDoubleClickOrTextEditClick(evt) && isGardenModule(cell) && isOnlySelectedCell(graph, cell); // CHANGE
    } // NEW

    function clearSelection(graph) { // NEW
        if (graph && graph.clearSelection) graph.clearSelection(); // NEW
        else if (graph && graph.setSelectionCells) graph.setSelectionCells([]); // NEW
        else if (graph && graph.setSelectionCell) graph.setSelectionCell(null); // NEW
    } // NEW

    function closeIrrigationModeIfAvailable(graph) { // NEW
        const graphApi = graph && graph.__trellisIrrigationPlanner; // NEW
        const windowApi = typeof window !== 'undefined' && window.TrellisIrrigationPlanner; // NEW
        const close = graphApi && graphApi.closeIrrigationMode || windowApi && windowApi.closeIrrigationMode; // NEW
        if (typeof close === 'function') close(); // NEW
    } // NEW

    function getDeepestCellForMouseEvent(graph, me, fallback) { // CHANGE
        if (!graph || !me) return fallback || null; // CHANGE
        const pt = mxUtils.convertPoint(graph.container, me.getX(), me.getY()); // CHANGE
        return graph.getCellAt(pt.x, pt.y) || fallback || null; // CHANGE
    } // CHANGE

    function isPrimaryPointerEvent(evt) { // NEW
        if (!evt) return true; // NEW
        if ((mxEvent.isPopupTrigger && mxEvent.isPopupTrigger(evt)) || evt.button === 2) return false; // NEW
        return evt.button == null || evt.button === 0; // NEW
    } // NEW

    function isWorkspaceHandleEvent(evt) { // NEW
        let node = evt && (evt.target || evt.srcElement); // NEW
        while (node) { // NEW
            if (node.getAttribute && node.getAttribute('data-trellis-workspace-drag-handle') === '1') return true; // NEW
            node = node.parentNode; // NEW
        } // NEW
        return false; // NEW
    } // NEW

    function isCellControlEvent(me) { // NEW
        if (!me || !me.getState || !me.isSource) return false; // NEW
        const state = me.getState(); // NEW
        return !!(state && state.control && me.isSource(state.control)); // NEW
    } // NEW

    function getWorkspaceStyleValue(cell, state, key, fallback) { // NEW
        const style = state && state.style || graph.getCurrentCellStyle && graph.getCurrentCellStyle(cell) || cell && cell.style || ''; // NEW
        if (style && typeof style === 'object') return mxUtils.getValue ? mxUtils.getValue(style, key, fallback) : (style[key] != null ? style[key] : fallback); // NEW
        const match = String(style || '').match(new RegExp('(?:^|;)' + key + '=([^;]*)(?=;|$)')); // NEW
        return match ? match[1] : fallback; // NEW
    } // NEW

    function isWorkspaceSwimlaneCell(graph, cell, state) { // NEW
        if (graph && graph.isSwimlane && graph.isSwimlane(cell)) return true; // NEW
        const shape = getWorkspaceStyleValue(cell, state, mxConstants.STYLE_SHAPE || 'shape', null); // NEW
        const style = cell && cell.style || ''; // NEW
        return shape === mxConstants.SHAPE_SWIMLANE || shape === 'swimlane' || /(?:^|;)swimlane(?:;|$)/.test(String(style)); // NEW
    } // NEW

    function getWorkspaceHeaderSize(graph, cell, state) { // NEW
        if (graph && graph.getStartSize) return graph.getStartSize(cell) || { width: 0, height: 0 }; // NEW
        const startKey = mxConstants.STYLE_STARTSIZE || 'startSize'; // NEW
        const horizontalKey = mxConstants.STYLE_HORIZONTAL || 'horizontal'; // NEW
        const defaultStartSize = Number(mxConstants.DEFAULT_STARTSIZE) || 40; // NEW
        const startSize = Number(getWorkspaceStyleValue(cell, state, startKey, defaultStartSize)) || 0; // NEW
        const horizontal = String(getWorkspaceStyleValue(cell, state, horizontalKey, '1')) !== '0'; // NEW
        return horizontal ? { width: 0, height: startSize } : { width: startSize, height: 0 }; // NEW
    } // NEW

    function isWorkspaceHeaderDragStart(graph, cell, me) { // NEW
        const state = cell && graph.view && graph.view.getState(cell); // NEW
        const evt = me && me.getEvent ? me.getEvent() : null; // NEW
        const pt = eventPointInGraphContainer(evt); // NEW
        if (!state || !pt || !isWorkspaceSwimlaneCell(graph, cell, state)) return false; // NEW
        const size = getWorkspaceHeaderSize(graph, cell, state); // NEW
        const headerWidth = Math.max(0, Math.min(Number(size.width) || 0, Number(state.width) || 0)); // NEW
        const headerHeight = Math.max(0, Math.min(Number(size.height) || 0, Number(state.height) || 0)); // NEW
        const inBounds = pt.x >= state.x && pt.x <= state.x + state.width && pt.y >= state.y && pt.y <= state.y + state.height; // NEW
        return inBounds && ((headerHeight > 0 && pt.y <= state.y + headerHeight) || (headerWidth > 0 && pt.x <= state.x + headerWidth)); // NEW
    } // NEW

    function getWorkspaceSurfaceDragContext(graph, me) { // NEW
        if (!graph || !me || me.isConsumed && me.isConsumed()) return null; // NEW
        const evt = me.getEvent ? me.getEvent() : null; // NEW
        if (!isPrimaryPointerEvent(evt) || isWorkspaceHandleEvent(evt) || isCellControlEvent(me)) return null; // NEW
        const cell = getDeepestCellForMouseEvent(graph, me, me.getCell ? me.getCell() : null); // NEW
        const type = getWorkspaceContainerType(cell); // NEW
        if (!type || !graph.getModel || !graph.getModel().isVertex(cell)) return null; // NEW
        if (isWorkspaceHeaderDragStart(graph, cell, me)) return null; // NEW
        return { cell: cell, type: type }; // NEW
    } // NEW

    function findMovableDragAncestorForLockedCell(graph, cell) { // CHANGE
        if (!graph || !cell) return null; // CHANGE
        const model = graph.getModel(); // CHANGE
        let cur = model.getParent(cell); // CHANGE
        while (cur) { // CHANGE
            if (model.isVertex(cur) && graph.isCellMovable(cur)) return cur; // CHANGE
            cur = model.getParent(cur); // CHANGE
        } // CHANGE
        return null; // CHANGE
    } // CHANGE

    function getDragInitialCellForEvent(graph, me, fallback, handler) { // CHANGE
        const deepest = getDeepestCellForMouseEvent(graph, me, fallback); // CHANGE
        const dragTarget = getPlantSelectionTargetForEvent(graph, deepest, me && me.getEvent ? me.getEvent() : null); // CHANGE
        if (handler) { // CHANGE
            handler.__manualLinkerLockedDragSource = null; // CHANGE
            handler.__manualLinkerLockedDragParent = null; // CHANGE
        } // CHANGE
        if (!graph || !dragTarget || !graph.getModel().isVertex(dragTarget)) return dragTarget; // CHANGE
        if (graph.isCellMovable(dragTarget)) return dragTarget; // CHANGE

        const movableParent = findMovableDragAncestorForLockedCell(graph, dragTarget); // CHANGE
        if (!movableParent) return dragTarget; // CHANGE
        if (handler) { // CHANGE
            handler.__manualLinkerLockedDragSource = dragTarget; // CHANGE
            handler.__manualLinkerLockedDragParent = movableParent; // CHANGE
        } // CHANGE
        return movableParent; // CHANGE
    } // CHANGE

    const oldIsDelayedSelection = mxGraphHandler.prototype.isDelayedSelection; // CHANGE
    mxGraphHandler.prototype.isDelayedSelection = function (cell, me) { // CHANGE
        const graph = this.graph; // CHANGE
        const deepest = getPlantSelectionTargetForEvent(graph, getDeepestCellForMouseEvent(graph, me, cell), me && me.getEvent ? me.getEvent() : null); // CHANGE

        if (deepest && deepest !== cell && graph.getModel().isVertex(deepest)) { // CHANGE
            if (!graph.isCellSelected(deepest) && hasSelectedAncestor(graph, deepest)) return false; // CHANGE
        } // CHANGE

        if (deepest && graph.getModel().isVertex(deepest)) { // CHANGE
            if (!graph.isCellSelected(deepest) && hasSelectedAncestor(graph, deepest)) return false; // CHANGE
        } // CHANGE

        return oldIsDelayedSelection.apply(this, arguments); // CHANGE
    }; // CHANGE

    const oldGetCellsForDrag = mxGraphHandler.prototype.getCells; // CHANGE
    mxGraphHandler.prototype.getCells = function (initialCell, cells) { // CHANGE
        const graph = this.graph; // CHANGE
        const redirectedParent = this.__manualLinkerLockedDragParent; // CHANGE
        if (redirectedParent && graph.getModel().isVertex(redirectedParent) && graph.isCellMovable(redirectedParent)) { // CHANGE
            const explicitCells = cells || []; // CHANGE
            if (initialCell === redirectedParent || this.cell === redirectedParent || explicitCells.indexOf(redirectedParent) >= 0) { // CHANGE
                return [redirectedParent]; // CHANGE
            } // CHANGE
        } // CHANGE

        if (initialCell && graph.getModel().isVertex(initialCell)) { // CHANGE
            if (!graph.isCellSelected(initialCell) && hasSelectedAncestor(graph, initialCell)) return [initialCell]; // CHANGE
        } // CHANGE

        return oldGetCellsForDrag.apply(this, arguments); // CHANGE
    }; // CHANGE

    graph.selectCellForEvent = function (cell, evt) { // CHANGE
        cell = getSelectionCellForNativeEvent(this, evt, cell); // CHANGE
        if (!cell) return; // CHANGE

        const isCtrl = mxEvent.isControlDown(evt) || mxEvent.isMetaDown(evt); // CHANGE
        const isShift = mxEvent.isShiftDown(evt); // CHANGE

        if (isCtrl && this.__ctrlToggleHandled) { // CHANGE
            this.__ctrlToggleHandled = false; // CHANGE
            return; // CHANGE
        } // CHANGE

        if (isCtrl) { // CHANGE
            if (this.isCellSelected(cell)) this.removeSelectionCell(cell); // CHANGE
            else this.addSelectionCell(cell); // CHANGE
            return; // CHANGE
        } // CHANGE

        if (isShift) { // CHANGE
            this.addSelectionCell(cell); // CHANGE
            return; // CHANGE
        } // CHANGE

        if (shouldCloseGardenModuleIrrigationOnPlainClick(this, cell, evt)) closeIrrigationModeIfAvailable(this); // CHANGE

        this.setSelectionCell(cell); // CHANGE
    }; // CHANGE

    function getCellId(cell) { // NEW
        return cell && (cell.id || (cell.getId && cell.getId())) || null; // NEW
    } // NEW

    function ensureWorkspaceOverlayHost() { // NEW
        const host = graph.container; // NEW
        if (!host) return null; // NEW
        const style = window.getComputedStyle ? window.getComputedStyle(host) : null; // NEW
        if (style && style.position === 'static') host.style.position = 'relative'; // NEW
        return host; // NEW
    } // NEW

    function isWorkspaceHandleVisibleForCell(cell) { // NEW
        return isWorkspaceContainer(cell) && graph.isCellVisible(cell) && graph.isCellMovable(cell) && graph.view && graph.view.getState(cell); // NEW
    } // NEW

    function getWorkspaceHandleCells() { // NEW
        const cells = []; // NEW
        const seen = {}; // NEW
        const selected = graph.getSelectionCells ? (graph.getSelectionCells() || []) : []; // NEW
        function add(cell) { // NEW
            const id = getCellId(cell); // NEW
            if (!id || seen[id] || !isWorkspaceHandleVisibleForCell(cell)) return; // NEW
            seen[id] = true; // NEW
            cells.push(cell); // NEW
        } // NEW
        for (let i = 0; i < selected.length; i++) add(selected[i]); // NEW
        add(workspaceHoveredCell); // NEW
        add(workspaceDraggingHandleCell); // NEW
        return cells; // NEW
    } // NEW

    function styleWorkspaceHandle(handle) { // NEW
        handle.type = 'button'; // NEW
        handle.setAttribute('data-trellis-workspace-drag-handle', '1'); // NEW
        handle.style.position = 'absolute'; // NEW
        handle.style.zIndex = '10020'; // NEW
        handle.style.width = WORKSPACE_HANDLE_SIZE + 'px'; // NEW
        handle.style.height = WORKSPACE_HANDLE_SIZE + 'px'; // NEW
        handle.style.padding = '0'; // NEW
        handle.style.border = '1px solid rgba(60, 64, 67, 0.35)'; // NEW
        handle.style.borderRadius = '4px'; // NEW
        handle.style.background = 'rgba(255, 255, 255, 0.96)'; // NEW
        handle.style.boxShadow = '0 1px 4px rgba(0, 0, 0, 0.20)'; // NEW
        handle.style.cursor = 'move'; // NEW
        handle.style.color = '#3c4043'; // NEW
        handle.style.font = '13px Arial, sans-serif'; // NEW
        handle.style.lineHeight = WORKSPACE_HANDLE_SIZE + 'px'; // NEW
        handle.style.textAlign = 'center'; // NEW
        handle.style.pointerEvents = 'auto'; // NEW
        handle.style.display = 'flex'; // NEW
        handle.style.alignItems = 'center'; // NEW
        handle.style.justifyContent = 'center'; // NEW
        handle.style.overflow = 'hidden'; // NEW
        handle.textContent = ''; // CHANGE
    } // NEW

    function addWorkspaceHandleIcon(handle) { // NEW
        while (handle.firstChild) handle.removeChild(handle.firstChild); // NEW
        if (typeof Editor !== 'undefined' && Editor.moveImage) { // NEW
            const img = document.createElement('img'); // NEW
            img.setAttribute('src', Editor.moveImage); // NEW
            img.setAttribute('alt', ''); // NEW
            img.setAttribute('aria-hidden', 'true'); // NEW
            img.style.width = '16px'; // NEW
            img.style.height = '16px'; // NEW
            img.style.display = 'block'; // NEW
            img.style.pointerEvents = 'none'; // NEW
            handle.appendChild(img); // NEW
        } else { // NEW
            handle.textContent = '+'; // NEW
        } // NEW
    } // NEW

    function createWorkspaceHandle(cell) { // NEW
        const handle = document.createElement('button'); // NEW
        styleWorkspaceHandle(handle); // NEW
        addWorkspaceHandleIcon(handle); // NEW
        handle.setAttribute('aria-label', workspaceHandleTitle(cell)); // NEW
        handle.setAttribute('title', workspaceHandleTitle(cell)); // NEW
        mxEvent.addListener(handle, 'mousedown', function (evt) { // NEW
            beginWorkspaceHandleDrag(cell, evt); // NEW
        }); // NEW
        mxEvent.addListener(handle, 'mousemove', function () { // NEW
            workspaceHoveredCell = cell; // NEW
            scheduleWorkspaceHandleRefresh(); // NEW
        }); // NEW
        return handle; // NEW
    } // NEW

    function workspaceHandleTitle(cell) { // NEW
        return getWorkspaceContainerType(cell) === 'lane' ? 'Move lane' : 'Move module'; // NEW
    } // NEW

    function positionWorkspaceHandle(handle, cell) { // NEW
        const state = graph.view && graph.view.getState(cell); // NEW
        if (!state) return false; // NEW
        handle.style.left = Math.round(state.x - WORKSPACE_HANDLE_SIZE - WORKSPACE_HANDLE_GAP) + 'px'; // NEW
        handle.style.top = Math.round(state.y - WORKSPACE_HANDLE_SIZE - WORKSPACE_HANDLE_GAP) + 'px'; // NEW
        handle.setAttribute('aria-label', workspaceHandleTitle(cell)); // NEW
        handle.setAttribute('title', workspaceHandleTitle(cell)); // NEW
        return true; // NEW
    } // NEW

    function refreshWorkspaceHandles() { // NEW
        workspaceHandleRefreshThread = null; // NEW
        const host = ensureWorkspaceOverlayHost(); // NEW
        if (!host) return; // NEW
        const cells = getWorkspaceHandleCells(); // NEW
        const keep = {}; // NEW
        for (let i = 0; i < cells.length; i++) { // NEW
            const cell = cells[i]; // NEW
            const id = getCellId(cell); // NEW
            let entry = workspaceHandleEntries.get(id); // NEW
            if (!entry) { // NEW
                entry = { cell: cell, handle: createWorkspaceHandle(cell) }; // NEW
                workspaceHandleEntries.set(id, entry); // NEW
            } // NEW
            if (entry.handle.parentNode !== host) host.appendChild(entry.handle); // NEW
            if (positionWorkspaceHandle(entry.handle, cell)) keep[id] = true; // NEW
        } // NEW
        workspaceHandleEntries.forEach(function (entry, id) { // NEW
            if (!keep[id]) { // NEW
                if (entry.handle.parentNode) entry.handle.parentNode.removeChild(entry.handle); // NEW
                workspaceHandleEntries.delete(id); // NEW
            } // NEW
        }); // NEW
    } // NEW

    function scheduleWorkspaceHandleRefresh() { // NEW
        if (workspaceHandleRefreshThread) return; // NEW
        workspaceHandleRefreshThread = window.setTimeout(refreshWorkspaceHandles, 0); // NEW
    } // NEW

    function eventPointInGraphContainer(evt) { // NEW
        if (!evt || !graph.container) return null; // NEW
        return mxUtils.convertPoint(graph.container, mxEvent.getClientX(evt), mxEvent.getClientY(evt)); // NEW
    } // NEW

    function pointInWorkspaceGrace(cell, pt) { // NEW
        const state = cell && graph.view && graph.view.getState(cell); // NEW
        if (!state || !pt) return false; // NEW
        return pt.x >= state.x - WORKSPACE_HOVER_GRACE_PX && pt.x <= state.x + state.width + WORKSPACE_HOVER_GRACE_PX && pt.y >= state.y - WORKSPACE_HOVER_GRACE_PX && pt.y <= state.y + state.height + WORKSPACE_HOVER_GRACE_PX; // NEW
    } // NEW

    function setWorkspaceSelectCursor() { // NEW
        if (!graph.container) return; // NEW
        if (!workspaceCursorOverrideActive) { // NEW
            workspaceCursorPreviousValue = graph.container.style.cursor || ''; // NEW
            workspaceCursorOverrideActive = true; // NEW
        } // NEW
        graph.container.style.cursor = 'default'; // NEW
    } // NEW

    function restoreWorkspaceCursor() { // NEW
        if (!workspaceCursorOverrideActive || !graph.container) return; // NEW
        graph.container.style.cursor = workspaceCursorPreviousValue; // NEW
        workspaceCursorOverrideActive = false; // NEW
        workspaceCursorPreviousValue = ''; // NEW
    } // NEW

    function shouldUseWorkspaceSelectCursor(me, hit) { // NEW
        const evt = me && me.getEvent ? me.getEvent() : null; // NEW
        if (!hit || workspaceDraggingHandleCell || isWorkspaceHandleEvent(evt) || isCellControlEvent(me)) return false; // NEW
        if (!isWorkspaceContainer(hit) || !graph.isCellVisible(hit) || !graph.view || !graph.view.getState(hit)) return false; // NEW
        return !isWorkspaceHeaderDragStart(graph, hit, me); // NEW
    } // NEW

    function updateWorkspaceCursorFromHover(me, hit) { // NEW
        if (shouldUseWorkspaceSelectCursor(me, hit)) setWorkspaceSelectCursor(); // NEW
        else restoreWorkspaceCursor(); // NEW
    } // NEW

    function updateWorkspaceHoverFromMouseEvent(me) { // NEW
        if (workspaceDraggingHandleCell) return; // NEW
        const evt = me && me.getEvent ? me.getEvent() : null; // NEW
        const hit = getDeepestCellForMouseEvent(graph, me, null); // NEW
        const pt = eventPointInGraphContainer(evt); // NEW
        updateWorkspaceCursorFromHover(me, hit); // NEW
        if (workspaceHoveredCell && workspaceHoveredCell !== hit && isKanbanLane(workspaceHoveredCell) && pointInWorkspaceGrace(workspaceHoveredCell, pt)) { // NEW
            scheduleWorkspaceHandleRefresh(); // NEW
            return; // NEW
        } // NEW
        if (isWorkspaceHandleVisibleForCell(hit)) { // NEW
            workspaceHoveredCell = hit; // NEW
        } else if (!pointInWorkspaceGrace(workspaceHoveredCell, pt)) { // NEW
            workspaceHoveredCell = null; // NEW
        } // NEW
        scheduleWorkspaceHandleRefresh(); // NEW
    } // NEW

    function beginWorkspaceHandleDrag(cell, evt) { // NEW
        if (!cell || !graph.isCellMovable(cell)) return; // NEW
        restoreWorkspaceCursor(); // NEW
        if (!graph.isCellSelected || !graph.isCellSelected(cell)) graph.setSelectionCell(cell); // NEW
        workspaceDraggingHandleCell = cell; // NEW
        workspaceHoveredCell = cell; // NEW
        const handler = graph.graphHandler; // NEW
        if (handler) { // NEW
            const oldMouseDown = graph.isMouseDown; // NEW
            graph.isMouseDown = true; // NEW
            handler.mouseDownX = mxEvent.getClientX(evt); // NEW
            handler.mouseDownY = mxEvent.getClientY(evt); // NEW
            handler.delayedSelection = true; // NEW
            handler.cell = cell; // NEW
            const move = function (moveEvt) { // NEW
                handler.mouseMove(graph, createWorkspaceMouseEvent(moveEvt, cell)); // NEW
            }; // NEW
            const up = function (upEvt) { // NEW
                try { // NEW
                    handler.mouseUp(graph, createWorkspaceMouseEvent(upEvt, cell)); // NEW
                } finally { // NEW
                    graph.isMouseDown = oldMouseDown; // NEW
                    workspaceDraggingHandleCell = null; // NEW
                    mxEvent.removeGestureListeners(document, null, move, up); // NEW
                    scheduleWorkspaceHandleRefresh(); // NEW
                } // NEW
            }; // NEW
            mxEvent.addGestureListeners(document, null, move, up); // NEW
        } // NEW
        scheduleWorkspaceHandleRefresh(); // NEW
        mxEvent.consume(evt); // NEW
    } // NEW

    function createWorkspaceMouseEvent(evt, fallbackCell) { // NEW
        if (typeof mxMouseEvent !== 'function') return { getEvent: function () { return evt; }, getX: function () { return mxEvent.getClientX(evt); }, getY: function () { return mxEvent.getClientY(evt); }, getCell: function () { return fallbackCell; }, isConsumed: function () { return false; }, consume: function () { } }; // NEW
        const pt = eventPointInGraphContainer(evt); // NEW
        const cell = pt && graph.getCellAt ? graph.getCellAt(pt.x, pt.y) : fallbackCell; // NEW
        const state = cell && graph.view ? graph.view.getState(cell) : graph.view && graph.view.getState(fallbackCell); // NEW
        return new mxMouseEvent(evt, state); // NEW
    } // NEW

    function shouldShowWorkspaceCallout(graph, context, rubberband, me) { // NEW
        if (!context || workspaceCalloutSeenByType[context.type]) return false; // NEW
        if (rubberband && rubberband.div) return true; // NEW
        if (!rubberband || !rubberband.first || !me) return false; // NEW
        const dx = Math.abs((rubberband.first.x || 0) - me.getX()); // NEW
        const dy = Math.abs((rubberband.first.y || 0) - me.getY()); // NEW
        return dx > (graph.tolerance || 4) || dy > (graph.tolerance || 4); // NEW
    } // NEW

    function getWorkspaceCalloutAnchorPoint(cell, me) { // NEW
        const evt = me && me.getEvent ? me.getEvent() : null; // NEW
        const cursorPoint = eventPointInGraphContainer(evt); // NEW
        if (cursorPoint) return cursorPoint; // NEW
        const state = graph.view && graph.view.getState(cell); // NEW
        return state ? { x: state.x, y: state.y } : { x: 0, y: 0 }; // NEW
    } // NEW

    function showWorkspaceMoveCallout(cell, type, me) { // NEW
        workspaceCalloutSeenByType[type] = true; // NEW
        if (workspaceCalloutDiv && workspaceCalloutDiv.parentNode) workspaceCalloutDiv.parentNode.removeChild(workspaceCalloutDiv); // NEW
        const host = ensureWorkspaceOverlayHost(); // NEW
        if (!host) return; // NEW
        const div = document.createElement('div'); // NEW
        div.textContent = type === 'lane' ? 'To move this lane, drag the handle in the top-left corner.' : 'To move this module, drag the handle in the top-left corner.'; // NEW
        div.style.position = 'absolute'; // NEW
        div.style.zIndex = '10021'; // NEW
        div.style.maxWidth = '260px'; // NEW
        div.style.padding = '8px 10px'; // NEW
        div.style.border = '1px solid rgba(60, 64, 67, 0.28)'; // NEW
        div.style.borderRadius = '6px'; // NEW
        div.style.background = 'rgba(32, 33, 36, 0.94)'; // NEW
        div.style.color = '#fff'; // NEW
        div.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.24)'; // NEW
        div.style.font = '12px Arial, sans-serif'; // NEW
        div.style.lineHeight = '16px'; // NEW
        div.style.pointerEvents = 'none'; // NEW
        const pt = getWorkspaceCalloutAnchorPoint(cell, me); // CHANGE
        div.style.left = Math.round(pt.x + 8) + 'px'; // CHANGE
        div.style.top = Math.round(pt.y + 8) + 'px'; // CHANGE
        host.appendChild(div); // NEW
        workspaceCalloutDiv = div; // NEW
        window.setTimeout(function () { // NEW
            if (div.parentNode) div.parentNode.removeChild(div); // NEW
            if (workspaceCalloutDiv === div) workspaceCalloutDiv = null; // NEW
        }, WORKSPACE_CALLOUT_MS); // NEW
    } // NEW

    if (graph.addMouseListener) { // NEW
        graph.addMouseListener({ // NEW
            mouseDown() { }, // NEW
            mouseMove(sender, me) { updateWorkspaceHoverFromMouseEvent(me); }, // NEW
            mouseUp() { graph.__trellisWorkspaceDragContext = null; graph.__trellisWorkspaceMarqueeContainer = null; restoreWorkspaceCursor(); } // CHANGE
        }); // NEW
    } // NEW

    function addRefreshListener(source, eventName) { // NEW
        if (source && source.addListener && eventName) source.addListener(eventName, scheduleWorkspaceHandleRefresh); // NEW
    } // NEW

    const selectionModel = graph.getSelectionModel && graph.getSelectionModel(); // NEW
    addRefreshListener(selectionModel, mxEvent.CHANGE || 'change'); // NEW
    addRefreshListener(graph, mxEvent.CELLS_MOVED || 'cellsMoved'); // NEW
    addRefreshListener(graph, mxEvent.CELLS_RESIZED || 'cellsResized'); // NEW
    addRefreshListener(graph, mxEvent.CELLS_TOGGLED || 'cellsToggled'); // NEW
    addRefreshListener(graph.view, mxEvent.SCALE || 'scale'); // NEW
    addRefreshListener(graph.view, mxEvent.TRANSLATE || 'translate'); // NEW
    addRefreshListener(graph.view, mxEvent.SCALE_AND_TRANSLATE || 'scaleAndTranslate'); // NEW
    addRefreshListener(graph.view, mxEvent.REPAINT || 'repaint'); // NEW
    addRefreshListener(graph.getModel && graph.getModel(), mxEvent.CHANGE || 'change'); // NEW
    if (graph.container && mxEvent.addListener) mxEvent.addListener(graph.container, 'mouseleave', restoreWorkspaceCursor); // NEW
    if (typeof window !== 'undefined' && mxEvent.addListener) mxEvent.addListener(window, 'resize', scheduleWorkspaceHandleRefresh); // NEW
    scheduleWorkspaceHandleRefresh(); // NEW

    graph.__trellisWorkspaceDragPolicy = { // NEW
        isWorkspaceContainer: isWorkspaceContainer, // NEW
        getWorkspaceContainerType: getWorkspaceContainerType, // NEW
        filterWorkspaceDescendantSelection: function (container, cells) { return filterWorkspaceDescendantSelection(graph, container, cells); }, // NEW
        getCalloutAnchorPointForTests: getWorkspaceCalloutAnchorPoint, // NEW
        getHandleCells: getWorkspaceHandleCells, // NEW
        shouldUseSelectCursorForTests: function (me) { return shouldUseWorkspaceSelectCursor(me, getDeepestCellForMouseEvent(graph, me, null)); }, // NEW
        updateHoverForTests: updateWorkspaceHoverFromMouseEvent, // NEW
        setHoveredCellForTests: function (cell) { workspaceHoveredCell = cell; scheduleWorkspaceHandleRefresh(); }, // NEW
        refreshHandles: refreshWorkspaceHandles // NEW
    }; // NEW

    console.log('[DeepClickThrough] Deep child selection enabled.'); // CHANGE
}); // CHANGE
