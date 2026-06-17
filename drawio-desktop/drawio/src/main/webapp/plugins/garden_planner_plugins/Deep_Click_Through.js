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

    graph.selectParentAfterCollapse = false; // CHANGE
    graph.cellsSelectable = true; // CHANGE
    graph.keepEdgesInBackground = false; // CHANGE
    graph.cellsLocked = false; // CHANGE

    const baseGetCellAt = graph.getCellAt; // CHANGE

    graph.getCellAt = function (x, y, parent, vertices, edges) { // CHANGE
        const initial = baseGetCellAt.apply(this, arguments); // CHANGE
        if (!initial) return null; // CHANGE
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
            if (state && mxUtils.contains(state, x, y)) return child; // CHANGE
        } // CHANGE
        return initial; // CHANGE
    }; // CHANGE

    mxGraphHandler.prototype.getInitialCellForEvent = function (me) { // CHANGE
        return getDragInitialCellForEvent(this.graph, me, me.getCell(), this); // CHANGE
    }; // CHANGE

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
        if (!graph || !deepest || !fallback || deepest === fallback) return deepest; // CHANGE
        const model = graph.getModel(); // CHANGE
        if (model.isVertex(deepest) && model.isVertex(fallback) && isStrictAncestorOf(model, fallback, deepest)) { // CHANGE
            if (!graph.isCellMovable(deepest) && graph.isCellMovable(fallback)) return fallback; // CHANGE
        } // CHANGE
        return deepest; // CHANGE
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

    function hasSelectedAncestor(graph, cell) { // CHANGE
        if (!graph || !cell) return false; // CHANGE
        const model = graph.getModel(); // CHANGE
        const selected = graph.getSelectionCells ? graph.getSelectionCells() : []; // CHANGE
        for (const selectedCell of selected || []) { // CHANGE
            if (isStrictAncestorOf(model, selectedCell, cell)) return true; // CHANGE
        } // CHANGE
        return false; // CHANGE
    } // CHANGE

    function getDeepestCellForMouseEvent(graph, me, fallback) { // CHANGE
        if (!graph || !me) return fallback || null; // CHANGE
        const pt = mxUtils.convertPoint(graph.container, me.getX(), me.getY()); // CHANGE
        return graph.getCellAt(pt.x, pt.y) || fallback || null; // CHANGE
    } // CHANGE

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
        if (handler) { // CHANGE
            handler.__manualLinkerLockedDragSource = null; // CHANGE
            handler.__manualLinkerLockedDragParent = null; // CHANGE
        } // CHANGE
        if (!graph || !deepest || !graph.getModel().isVertex(deepest)) return deepest; // CHANGE
        if (graph.isCellMovable(deepest)) return deepest; // CHANGE

        const movableParent = findMovableDragAncestorForLockedCell(graph, deepest); // CHANGE
        if (!movableParent) return deepest; // CHANGE
        if (handler) { // CHANGE
            handler.__manualLinkerLockedDragSource = deepest; // CHANGE
            handler.__manualLinkerLockedDragParent = movableParent; // CHANGE
        } // CHANGE
        return movableParent; // CHANGE
    } // CHANGE

    const oldIsDelayedSelection = mxGraphHandler.prototype.isDelayedSelection; // CHANGE
    mxGraphHandler.prototype.isDelayedSelection = function (cell, me) { // CHANGE
        const graph = this.graph; // CHANGE
        const deepest = getDeepestCellForMouseEvent(graph, me, cell); // CHANGE

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

        this.setSelectionCell(cell); // CHANGE
    }; // CHANGE

    console.log('[DeepClickThrough] Deep child selection enabled.'); // CHANGE
}); // CHANGE
