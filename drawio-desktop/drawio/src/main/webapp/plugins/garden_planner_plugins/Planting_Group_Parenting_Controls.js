/**
 * Draw.io Plugin: Tiler Group Non-Parenting
 * - Nothing user-dropped may become a child of a tiler group.
 * - Generated plant tiles and LOD summaries remain valid tiler group internals.
 */
Draw.loadPlugin(function (ui) {
  const graph = ui.editor.graph;
  const model = graph.getModel();

  if (graph.__tilerNoChildInstalled) return;
  graph.__tilerNoChildInstalled = true;

  // -------------------- Predicates --------------------
  function isTilerGroup(cell) {
    return !!cell && cell.getAttribute && cell.getAttribute('tiler_group') === '1';
  }

  function isAllowedTilerGroupChild(cell) {
    if (!cell || !cell.getAttribute) return false;
    return cell.getAttribute('plant_tiler') === '1' || cell.getAttribute('lod_summary') === '1'; // CHANGE: keep generated planting internals in the group.
  }

  function findTilerGroupAncestor(cell) {
    let cur = cell;
    while (cur) {
      if (isTilerGroup(cur)) return cur;
      cur = model.getParent ? model.getParent(cur) : cur.parent;
    }
    return null;
  }

  // -------------------- Geometry helpers --------------------
  function finiteNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function getGeometry(cell) {
    return model.getGeometry ? model.getGeometry(cell) : (cell && cell.geometry);
  }

  function setGeometry(cell, geometry) {
    if (model.setGeometry) model.setGeometry(cell, geometry);
    else if (cell) cell.geometry = geometry;
  }

  function cellBoundsInModel(cell) {
    const state = graph.view && graph.view.getState ? graph.view.getState(cell) : null;
    if (state && Number.isFinite(Number(state.x)) && Number.isFinite(Number(state.y))) {
      const scale = finiteNumber(graph.view && graph.view.scale, 1) || 1;
      const translate = graph.view && graph.view.translate ? graph.view.translate : { x: 0, y: 0 };
      return {
        x: finiteNumber(state.x, 0) / scale - finiteNumber(translate.x, 0),
        y: finiteNumber(state.y, 0) / scale - finiteNumber(translate.y, 0),
        width: finiteNumber(state.width, 0) / scale,
        height: finiteNumber(state.height, 0) / scale
      };
    }

    const geo = getGeometry(cell);
    if (!geo) return null;
    let x = finiteNumber(geo.x, 0);
    let y = finiteNumber(geo.y, 0);
    let parent = model.getParent ? model.getParent(cell) : cell && cell.parent;
    while (parent) {
      const parentGeo = getGeometry(parent);
      if (parentGeo) {
        x += finiteNumber(parentGeo.x, 0);
        y += finiteNumber(parentGeo.y, 0);
      }
      parent = model.getParent ? model.getParent(parent) : parent.parent;
    }
    return { x, y, width: finiteNumber(geo.width, 0), height: finiteNumber(geo.height, 0) };
  }

  function geometryForParent(cell, nextParent) {
    const geo = getGeometry(cell);
    if (!geo || !nextParent) return null;
    const absolute = cellBoundsInModel(cell);
    const parentBounds = cellBoundsInModel(nextParent) || { x: 0, y: 0 };
    const nextGeo = geo.clone ? geo.clone() : Object.assign({}, geo);
    nextGeo.x = finiteNumber(absolute && absolute.x, finiteNumber(geo.x, 0)) - finiteNumber(parentBounds.x, 0);
    nextGeo.y = finiteNumber(absolute && absolute.y, finiteNumber(geo.y, 0)) - finiteNumber(parentBounds.y, 0);
    return nextGeo;
  }

  function moveCellToParent(cell, parent) {
    if (!cell || !parent) return;
    if (model.add) {
      const index = model.getChildCount ? model.getChildCount(parent) : ((parent.children || []).length);
      model.add(parent, cell, index);
      return;
    }
    const oldParent = model.getParent ? model.getParent(cell) : cell.parent;
    if (oldParent && oldParent.children) oldParent.children = oldParent.children.filter(child => child !== cell);
    cell.parent = parent;
    parent.children = parent.children || [];
    parent.children.push(cell);
  }

  // -------------------- Parenting guard --------------------
  // Disallow dropping anything into tiler groups.
  const _isValidDropTarget = graph.isValidDropTarget;
  graph.isValidDropTarget = function (cell, cells, evt) {
    if (cell && findTilerGroupAncestor(cell)) return false; // CHANGE: planting groups are not user drop containers.
    return _isValidDropTarget ? _isValidDropTarget.apply(this, arguments) : true;
  };

  function sanitizeNoExternalChildrenOfTG(cells) {
    if (!cells || !cells.length) return;
    let changed = false;
    model.beginUpdate();
    try {
      for (const c of cells) {
        if (!c || isAllowedTilerGroupChild(c)) continue; // CHANGE: generated tiles and summaries are legitimate children.
        const group = findTilerGroupAncestor(model.getParent ? model.getParent(c) : c.parent);
        if (!group) continue;
        const parent = (model.getParent ? model.getParent(group) : group.parent) || graph.getDefaultParent();
        const nextGeo = geometryForParent(c, parent);
        moveCellToParent(c, parent);
        if (nextGeo) setGeometry(c, nextGeo);
        changed = true;
      }
    } finally { model.endUpdate(); }
    if (changed && graph.refresh) graph.refresh();
  }

  // -------------------- Event wiring: scope to moves only ----------------------
  graph.addListener(mxEvent.CELLS_MOVED, function(sender, evt) {
    const cells = evt.getProperty('cells') || [];
    sanitizeNoExternalChildrenOfTG(cells); // CHANGE: repair leaked user-dropped children only on moves.
  });
});
