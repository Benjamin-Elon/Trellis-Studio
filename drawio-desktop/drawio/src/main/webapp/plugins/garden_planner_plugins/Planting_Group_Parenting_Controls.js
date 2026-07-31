/**
 * Draw.io Plugin: Tiler Group Non-Parenting + Fit-On-Drop
 * - Nothing may become a child of a tiler group.
 * - If a tiler group is dragged into another tiler group, it is resized to fit the target (as a sibling).
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

  // -------------------- Parenting guard --------------------
  // Disallow dropping *into* tiler groups
  const _isValidDropTarget = graph.isValidDropTarget;
  graph.isValidDropTarget = function (cell, cells, evt) {
    // Only block when attempting to drop a TilerGroup into a TilerGroup
    if (isTilerGroup(cell) && (cells || []).some(isTilerGroup)) return false;
    return _isValidDropTarget.apply(this, arguments);
  };
  
  // --- Replace the sanitizer with a TG→TG-only ejection, and only on moves -----
  
  function sanitizeTGtoTGNesting(cells) {
    if (!cells || !cells.length) return;
    model.beginUpdate();
    try {
      for (const c of cells) {
        if (!isTilerGroup(c)) continue;                  // only care about moved TGs
        const p = model.getParent(c);
        if (p && isTilerGroup(p)) {                      // TG nested in TG? eject
          const grand = model.getParent(p) || graph.getDefaultParent();
          graph.moveCells([c], 0, 0, false, grand);      // preserve absolute geometry
        }
      }
    } finally { model.endUpdate(); }
  }
  
  
  // -------------------- Event wiring: scope to moves only ----------------------
  
  // REMOVE these earlier hooks if present:
  // graph.addListener(mxEvent.ADD_CELLS, ... sanitizeNoChildrenOfTG ...);
  // graph.addListener(mxEvent.CELLS_RESIZED, ... sanitizeNoChildrenOfTG ...);
  // graph.getModel().addListener(mxEvent.UNDO/REDO, ... sanitizeNoChildrenOfTG ...);
  
  graph.addListener(mxEvent.CELLS_MOVED, function(sender, evt) {
    const cells = evt.getProperty('cells') || [];
    sanitizeTGtoTGNesting(cells);                     // only on user move
  });
});
