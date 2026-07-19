/**
 * Draw.io Plugin: ChangeMap + CreateMap (Scope + Time Slice + Navigate)
 *
 * Features
 * - Right-click menu: Show/Hide ChangeMap, Show/Hide CreateMap
 * - Overlay UI (top-right of graph):
 *   - Mode: ChangeMap / CreateMap
 *   - Scope: Diagram / Selection / Subtree (single selected root)
 *   - Time slice: last N (minutes/hours/days); out-of-range cells are de-emphasized
 *   - Navigate: Prev/Next + clickable list of top N matches (newest-first or oldest-first)
 *
 * Persistent attributes on each cell:
 * - createdAt      : epoch ms (write-once on insert if missing)
 * - lastEditedAt   : epoch ms (only for user-selected edits during a short input window)
 * - origStyle      : persisted original style string (write-once on first map apply; removed on restore)
 */

Draw.loadPlugin(function (ui) {
  const graph = ui && ui.editor && ui.editor.graph;
  if (!graph) return;

  if (graph.__ccMapInstalled) return;
  graph.__ccMapInstalled = true;

  const model = graph.getModel();

  // -------------------- Config --------------------

  const ATTR_CREATED = 'createdAt';
  const ATTR_EDITED = 'lastEditedAt';
  const ATTR_ORIG_STYLE = 'origStyle';
  const ATTR_HISTORY_ID = 'trellis_history_id';                              // NEW
  const ATTR_CREATED_BY = 'createdByUserId';                                  // NEW
  const ATTR_EDITED_BY = 'lastEditedByUserId';                                // NEW

  const MODE_NONE = 'none';
  const MODE_CHANGE = 'changemap';
  const MODE_CREATE = 'createdmap';

  const SCOPE_DIAGRAM = 'diagram';
  const SCOPE_SELECTION = 'selection';
  const SCOPE_SUBTREE = 'subtree';

  const COLOR_RAMP = [
    '#2509FF', // blue (oldest)
    '#5e5ce6', // purple
    '#ff3b30', // red
    '#ff9f0a', // orange
    '#ffd60a', // yellow
    '#a8e063', // yellow-green
    '#34c759'  // green (newest)
  ];

  const VERTEX_WIDTH_MIN = 2;
  const VERTEX_WIDTH_MAX = 5;
  const EDGE_WIDTH_MIN = 1;
  const EDGE_WIDTH_MAX = 10;

  const UNKNOWN_STYLE = { strokeColor: '#c7c7cc', dashed: 1, strokeOpacity: 60 };
  const OUT_OF_RANGE_STYLE = { strokeColor: '#c7c7cc', dashed: 1, strokeOpacity: 25 };

  const ATTR_LOD_SUMMARY = 'lod_summary';

  function isLodSummaryCell(cell) {
    return getAttrStr(cell, ATTR_LOD_SUMMARY) === '1';
  }

  graph.__ccPasteUntil = 0;
  graph.__ccPasteIds = new Set();
  const PASTE_WINDOW_MS = 250;


  // Input window for "user action" gating
  const USER_ACTION_WINDOW_MS = 1000;

  // List size for click-to-navigate
  const NAV_LIST_MAX = 200;

  const HISTORY_DB_NAME = 'Trellis_history.sqlite';                          // NEW
  const HISTORY_SETTLE_MS = 2500;                                             // NEW
  const HISTORY_RETENTION_BYTES = 500 * 1024 * 1024;                          // NEW
  const HISTORY_SCHEMA_VERSION = 1;                                           // NEW
  const HISTORY_EVENT_BEFORE_RESTORE = 'trellisHistoryBeforeRestore';          // NEW
  const HISTORY_EVENT_AFTER_RESTORE = 'trellisHistoryAfterRestore';            // NEW
  const HISTORY_EVENT_COMPARE_CLEARED = 'trellisHistoryCompareCleared';        // NEW
  const HISTORY_CATEGORIES = [                                                // NEW
    'Diagram', 'Content', 'Planning', 'Garden scheduling', 'Assignments',      // NEW
    'Tasks', 'Conditions', 'Irrigation', 'Resources', 'Data', 'History',       // NEW
    'System'                                                                  // NEW
  ];                                                                          // NEW


  // -------------------- Responsive apply scheduler --------------------  
  const APPLY_DEBOUNCE_MS = 1000;
  const APPLY_BATCH_SIZE = 300;
  graph.__ccApplyTimer = null;
  graph.__ccApplyToken = 0;
  graph.__ccApplyQueued = false;

  function scheduleRefreshIfEnabled() {
    if (graph.__ccMode === MODE_NONE) return;
    if (graph.__ccApplyTimer) clearTimeout(graph.__ccApplyTimer);
    graph.__ccApplyTimer = setTimeout(() => {
      graph.__ccApplyTimer = null;
      applyMapBatched(graph.__ccMode);
    }, APPLY_DEBOUNCE_MS);
  }


  // -------------------- State --------------------

  graph.__ccMapInternalChange = false;

  graph.__ccMode = MODE_NONE;
  graph.__ccScope = SCOPE_DIAGRAM;

  graph.__ccWindowValue = 7;        // default: last 7 days
  graph.__ccWindowUnit = 'days';    // minutes | hours | days

  graph.__ccSortOrder = 'newest'; // newest | oldest
  graph.__ccUserFilter = 'all';                                               // NEW
  graph.__ccFiltered = [];          // current filtered cells (for navigation)
  graph.__ccNavIndex = 0;
  graph.__ccHistoryRevisions = [];                                           // NEW
  graph.__ccHistorySelectedId = null;                                         // NEW
  graph.__ccHistoryFilter = 'all';                                           // NEW
  graph.__ccHistoryPreviewMode = false;                                      // NEW
  graph.__ccHistoryCompareOverlays = [];                                     // NEW
  graph.__ccHistoryRestoring = false;                                        // NEW
  graph.__ccHistoryLastRestoreAudit = null;                                  // NEW
  graph.__ccHistoryRestoreStatus = '';                                       // NEW


  // -------------------- Zoom-aware stroke width --------------------     
  graph.__ccZoomStrokeMult = 1;
  graph.__ccLastScale = null;

  function getGraphScale() {
    return (graph.view && typeof graph.view.scale === 'number')
      ? graph.view.scale
      : 1;
  }

  function computeZoomStrokeMult(scale) {
    // Scale-aware: when zoomed out (<1), increase stroke widths.           
    // Clamp to prevent absurd widths.                                      
    const s = Math.max(0.2, Number(scale) || 1);
    const mult = 1 / s;
    return Math.max(1, Math.min(4, mult));
  }

  function updateZoomStrokeMult() {
    const s = getGraphScale();
    if (graph.__ccLastScale != null && Math.abs(s - graph.__ccLastScale) < 0.001) return;
    graph.__ccLastScale = s;
    graph.__ccZoomStrokeMult = computeZoomStrokeMult(s);
  }


  // User action gating state
  graph.__ccUserActionActive = false;
  graph.__ccUserActionUntil = 0;
  graph.__ccUserActionSelIds = new Set();

  // -------------------- Small utilities --------------------

  function nowMs() { return Date.now(); }

  function isCell(obj) {
    return obj != null && typeof obj === 'object' && typeof obj.getId === 'function';
  }

  function isVertex(cell) { return !!(cell && model.isVertex(cell)); }
  function isEdge(cell) { return !!(cell && model.isEdge(cell)); }

  function shouldStyleCell(cell) {
    if (!cell) return false;
    if (cell === model.getRoot()) return false;
    if (isLodSummaryCell(cell)) return false;
    if (shouldIgnoreBecauseInTilerGroup(cell)) return false;
    return isVertex(cell) || isEdge(cell);
  }



  function getAttrStr(cell, key) {
    if (!cell || typeof cell.getAttribute !== 'function') return null;
    const v = cell.getAttribute(key);
    if (v == null || v === '') return null;
    return String(v);
  }

  function getAttrMs(cell, key) {
    const raw = getAttrStr(cell, key);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  function ensureXmlValue(cell) {
    if (!cell) return false;
    const v = cell.value;
    const isXml = v && typeof v === 'object' && typeof v.nodeName === 'string';
    if (isXml) return true;

    // Create an XML user object and preserve the visible label if present.                   
    const doc = mxUtils.createXmlDocument();
    const obj = doc.createElement('object');
    const label = (v != null) ? String(v) : '';
    if (label) obj.setAttribute('label', label);

    model.setValue(cell, obj);
    return true;
  }


  function setAttrMs(cell, key, ms) {
    if (!cell) return;
    ensureXmlValue(cell);
    if (typeof cell.setAttribute !== 'function') return;
    cell.setAttribute(key, String(ms));
  }


  function removeAttr(cell, key) {
    if (!cell) return;
    if (typeof cell.removeAttribute === 'function') cell.removeAttribute(key);
    else if (typeof cell.setAttribute === 'function') cell.setAttribute(key, '');
  }

  function clamp01(x) {
    if (x < 0) return 0;
    if (x > 1) return 1;
    return x;
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function hexToRgb(hex) {
    const h = (hex || '').replace('#', '').trim();
    if (h.length !== 6) return null;
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
    return { r, g, b };
  }

  function rgbToHex(rgb) {
    function to2(n) {
      const s = Math.max(0, Math.min(255, Math.round(n))).toString(16);
      return s.length === 1 ? '0' + s : s;
    }
    return '#' + to2(rgb.r) + to2(rgb.g) + to2(rgb.b);
  }

  function lerpColor(aHex, bHex, t) {
    const a = hexToRgb(aHex);
    const b = hexToRgb(bHex);
    if (!a || !b) return aHex;
    return rgbToHex({
      r: lerp(a.r, b.r, t),
      g: lerp(a.g, b.g, t),
      b: lerp(a.b, b.b, t)
    });
  }

  function lerpColorRamp(colors, p) {
    if (!colors || colors.length === 0) return '#000000';
    if (colors.length === 1) return colors[0];

    const n = colors.length - 1;
    const scaled = clamp01(p) * n;
    const i = Math.floor(scaled);
    const t = scaled - i;

    const c0 = colors[Math.max(0, Math.min(n, i))];
    const c1 = colors[Math.max(0, Math.min(n, i + 1))];

    return lerpColor(c0, c1, t);
  }

  function parseStyle(styleStr) {
    const out = Object.create(null);
    const s = styleStr || '';
    const parts = s.split(';');
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!p) continue;
      const eq = p.indexOf('=');
      if (eq < 0) out[p] = '';
      else out[p.substring(0, eq)] = p.substring(eq + 1);
    }
    return out;
  }

  function styleToString(styleObj) {
    const keys = Object.keys(styleObj);
    keys.sort();
    let s = '';
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const v = styleObj[k];
      s += (v === '' ? (k + ';') : (k + '=' + v + ';'));
    }
    return s;
  }

  function mergeStyle(baseStyleStr, overrides) {
    const o = parseStyle(baseStyleStr);

    if (overrides.strokeColor != null) o.strokeColor = String(overrides.strokeColor);
    if (overrides.strokeWidth != null) o.strokeWidth = String(overrides.strokeWidth);
    if (overrides.dashed != null) o.dashed = String(overrides.dashed);
    if (overrides.strokeOpacity != null) o.strokeOpacity = String(overrides.strokeOpacity);

    return styleToString(o);
  }

  function iterAllCells(fn) {
    const root = model.getRoot();
    if (!root) return;
    (function visit(cell) {
      fn(cell);
      const n = model.getChildCount(cell);
      for (let i = 0; i < n; i++) visit(model.getChildAt(cell, i));
    })(root);
  }

  function modeKey(mode) {
    return mode === MODE_CHANGE ? ATTR_EDITED : ATTR_CREATED;
  }

  function actorKey(mode) {                                                    // NEW
    return mode === MODE_CHANGE ? ATTR_EDITED_BY : ATTR_CREATED_BY;            // NEW
  }                                                                            // NEW

  function usersApi() {                                                        // NEW
    return typeof window !== 'undefined' && window.Trellis && window.Trellis.users; // NEW
  }                                                                            // NEW

  function actorMetadata(metadata) {                                           // NEW
    const users = usersApi();                                                   // NEW
    if (users && typeof users.withActorMetadata === 'function') return users.withActorMetadata(metadata || {}); // NEW
    return Object.assign({}, metadata || {});                                  // NEW
  }                                                                            // NEW

  function currentActorUserId() {                                              // NEW
    const users = usersApi();                                                   // NEW
    const user = users && typeof users.getCurrentUser === 'function' ? users.getCurrentUser() : null; // NEW
    return user && user.id ? String(user.id) : '';                              // NEW
  }                                                                            // NEW

  function stampActor(cell, kind) {                                            // NEW
    const users = usersApi();                                                   // NEW
    if (users && typeof users.stampActorOnCell === 'function') users.stampActorOnCell(cell, kind); // NEW
  }                                                                            // NEW

  function isDirectEditChange(ch) {
    const n = ch && ch.constructor && ch.constructor.name;
    return n === 'mxStyleChange' ||
      n === 'mxValueChange' ||
      n === 'mxTerminalChange' ||
      n === 'mxGeometryChange' ||
      n === 'mxCollapseChange' ||
      n === 'mxVisibleChange';
  }

  // -------------------- History identity + serialization -------------------- // NEW

  function makeHistoryId(prefix) {                                             // NEW
    const rand = Math.random().toString(36).slice(2, 10);                      // NEW
    return prefix + '_' + Date.now().toString(36) + '_' + rand;                // NEW
  }                                                                            // NEW

  function hashString(text) {                                                  // NEW
    const s = String(text == null ? '' : text);                                // NEW
    let h1 = 0x811c9dc5;                                                       // NEW
    let h2 = 0x01000193;                                                       // NEW
    for (let i = 0; i < s.length; i++) {                                       // NEW
      const c = s.charCodeAt(i);                                               // NEW
      h1 ^= c;                                                                 // NEW
      h1 = Math.imul(h1, 0x01000193);                                          // NEW
      h2 = Math.imul(h2 ^ c, 0x85ebca6b);                                      // NEW
    }                                                                          // NEW
    return ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')); // NEW
  }                                                                            // NEW

  function uniqueArray(values) {                                               // NEW
    const out = [];                                                            // NEW
    const seen = new Set();                                                    // NEW
    for (let i = 0; i < (values || []).length; i++) {                          // NEW
      const v = values[i];                                                     // NEW
      if (v == null || v === '' || seen.has(v)) continue;                      // NEW
      seen.add(v);                                                             // NEW
      out.push(v);                                                             // NEW
    }                                                                          // NEW
    return out;                                                                // NEW
  }                                                                            // NEW

  function finiteNumberOrNull(value) {                                         // NEW
    const n = Number(value);                                                    // NEW
    return Number.isFinite(n) ? n : null;                                       // NEW
  }                                                                            // NEW

  function normalizeBounds(bounds) {                                           // NEW
    if (!bounds) return null;                                                   // NEW
    const x = finiteNumberOrNull(bounds.x);                                     // NEW
    const y = finiteNumberOrNull(bounds.y);                                     // NEW
    const width = finiteNumberOrNull(bounds.width != null ? bounds.width : bounds.w); // NEW
    const height = finiteNumberOrNull(bounds.height != null ? bounds.height : bounds.h); // NEW
    if (x == null || y == null || width == null || height == null) return null; // NEW
    return { x, y, width: Math.max(1, width), height: Math.max(1, height) };    // NEW
  }                                                                            // NEW

  function unionBounds(a, b) {                                                  // NEW
    const left = normalizeBounds(a);                                            // NEW
    const right = normalizeBounds(b);                                           // NEW
    if (!left) return right;                                                    // NEW
    if (!right) return left;                                                    // NEW
    const x1 = Math.min(left.x, right.x);                                       // NEW
    const y1 = Math.min(left.y, right.y);                                       // NEW
    const x2 = Math.max(left.x + left.width, right.x + right.width);            // NEW
    const y2 = Math.max(left.y + left.height, right.y + right.height);          // NEW
    return { x: x1, y: y1, width: Math.max(1, x2 - x1), height: Math.max(1, y2 - y1) }; // NEW
  }                                                                            // NEW

  function centerOfBounds(bounds) {                                             // NEW
    const b = normalizeBounds(bounds);                                          // NEW
    return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;          // NEW
  }                                                                            // NEW

  function normalizeCenter(center) {                                            // NEW
    if (!center) return null;                                                   // NEW
    const x = finiteNumberOrNull(center.x);                                     // NEW
    const y = finiteNumberOrNull(center.y);                                     // NEW
    return x == null || y == null ? null : { x, y };                            // NEW
  }                                                                            // NEW

  function normalizeViewport(viewport) {                                        // NEW
    if (!viewport) return null;                                                 // NEW
    const x = finiteNumberOrNull(viewport.x);                                   // NEW
    const y = finiteNumberOrNull(viewport.y);                                   // NEW
    const scale = finiteNumberOrNull(viewport.scale);                           // NEW
    if (x == null || y == null) return null;                                    // NEW
    return scale == null ? { x, y } : { x, y, scale };                          // NEW
  }                                                                            // NEW

  function captureViewportContext() {                                          // NEW
    const view = graph.view || {};                                              // NEW
    const scale = finiteNumberOrNull(view.scale) || 1;                          // NEW
    const tr = view.translate || { x: 0, y: 0 };                                // NEW
    const container = graph.container || {};                                    // NEW
    const scrollLeft = finiteNumberOrNull(container.scrollLeft) || 0;           // NEW
    const scrollTop = finiteNumberOrNull(container.scrollTop) || 0;             // NEW
    return { x: scrollLeft / scale - (Number(tr.x) || 0), y: scrollTop / scale - (Number(tr.y) || 0), scale }; // NEW
  }                                                                            // NEW

  function cellModelBounds(cell) {                                              // NEW
    if (!cell || cell === model.getRoot()) return null;                         // NEW
    const geo = cell.getGeometry ? cell.getGeometry() : cell.geometry;          // NEW
    if (!geo) return null;                                                      // NEW
    let x = finiteNumberOrNull(geo.x);                                          // NEW
    let y = finiteNumberOrNull(geo.y);                                          // NEW
    const width = finiteNumberOrNull(geo.width);                                // NEW
    const height = finiteNumberOrNull(geo.height);                              // NEW
    if (x == null || y == null || width == null || height == null) return null; // NEW
    let parent = model.getParent && model.getParent(cell);                      // NEW
    while (parent && parent !== model.getRoot()) {                              // NEW
      const pGeo = parent.getGeometry ? parent.getGeometry() : parent.geometry; // NEW
      if (pGeo) {                                                               // NEW
        x += finiteNumberOrNull(pGeo.x) || 0;                                   // NEW
        y += finiteNumberOrNull(pGeo.y) || 0;                                   // NEW
      }                                                                        // NEW
      parent = model.getParent && model.getParent(parent);                      // NEW
    }                                                                          // NEW
    return normalizeBounds({ x, y, width, height });                            // NEW
  }                                                                            // NEW

  function boundsForCells(cells) {                                              // NEW
    let out = null;                                                             // NEW
    for (let i = 0; i < (cells || []).length; i++) out = unionBounds(out, cellModelBounds(cells[i])); // NEW
    return out;                                                                // NEW
  }                                                                            // NEW

  function boundsForCellIds(ids) {                                              // NEW
    const cells = [];                                                           // NEW
    for (let i = 0; i < (ids || []).length; i++) {                              // NEW
      const cell = model.getCell && model.getCell(ids[i]);                      // NEW
      if (cell) cells.push(cell);                                               // NEW
    }                                                                          // NEW
    return boundsForCells(cells);                                               // NEW
  }                                                                            // NEW

  function activeDiagramModelBounds() {                                         // NEW
    let out = null;                                                             // NEW
    iterAllCells(function (cell) { out = unionBounds(out, cellModelBounds(cell)); }); // NEW
    return out;                                                                // NEW
  }                                                                            // NEW

  function fireHistoryLifecycleEvent(name, detail) {                           // NEW
    const payload = Object.assign({ graph, history: window.Trellis && window.Trellis.history }, detail || {}); // NEW
    try {                                                                      // NEW
      if (typeof mxEventObject !== 'undefined' && graph.fireEvent) graph.fireEvent(new mxEventObject(name, 'detail', payload)); // NEW
    } catch (e) { }                                                            // NEW
    try {                                                                      // NEW
      if (window && typeof window.dispatchEvent === 'function' && typeof window.CustomEvent === 'function') window.dispatchEvent(new window.CustomEvent(name, { detail: payload })); // NEW
    } catch (e) { }                                                            // NEW
  }                                                                            // NEW

  function cloneRestoreAudit(audit) {                                          // NEW
    if (!audit) return null;                                                    // NEW
    return safeParseJson(JSON.stringify(audit), null);                          // NEW
  }                                                                            // NEW

  function createRestoreAudit(rev, beforeHash) {                               // NEW
    const now = nowMs();                                                        // NEW
    return {                                                                    // NEW
      restoreId: makeHistoryId('restore'),                                      // NEW
      sourceRevisionId: rev && rev.id || null,                                  // NEW
      beforeHash: beforeHash || null,                                           // NEW
      loadedHash: null,                                                         // NEW
      afterRehydrateHash: null,                                                 // NEW
      startedAt: now,                                                           // NEW
      loadedAt: null,                                                           // NEW
      rehydratedAt: null,                                                       // NEW
      completedAt: null,                                                        // NEW
      warnings: []                                                              // NEW
    };                                                                          // NEW
  }                                                                            // NEW

  function addRestoreAuditWarning(audit, code, message) {                       // NEW
    if (!audit) return;                                                         // NEW
    audit.warnings = audit.warnings || [];                                      // NEW
    audit.warnings.push({ code: String(code || 'restoreWarning'), message: String(message || 'Restore warning') }); // NEW
  }                                                                            // NEW

  function waitForHistoryRehydrateTick() {                                      // NEW
    if (typeof setTimeout !== 'function') return Promise.resolve();             // NEW
    return new Promise(function (resolve) { setTimeout(resolve, 0); });          // NEW
  }                                                                            // NEW

  function getHistoryIdentityCell() {                                          // NEW
    const defaultParent = graph.getDefaultParent && graph.getDefaultParent();  // NEW
    return defaultParent || model.getRoot();                                   // NEW
  }                                                                            // NEW

  function getDiagramHistoryId() {                                             // NEW
    const cell = getHistoryIdentityCell();                                     // NEW
    let id = cell && cell !== model.getRoot() ? getAttrStr(cell, ATTR_HISTORY_ID) : null; // NEW
    if (!id && graph.__ccDiagramHistoryId) id = graph.__ccDiagramHistoryId;    // NEW
    if (!id) id = makeHistoryId('diagram');                                    // NEW
    graph.__ccDiagramHistoryId = id;                                           // NEW
    if (cell && cell !== model.getRoot() && getAttrStr(cell, ATTR_HISTORY_ID) == null) { // NEW
      try { ensureXmlValue(cell); cell.setAttribute(ATTR_HISTORY_ID, id); } catch (e) { } // NEW
    }                                                                          // NEW
    return id;                                                                 // NEW
  }                                                                            // NEW

  function serializeActivePageXml() {                                          // NEW
    if (typeof graph.__trellisHistoryTestSerialize === 'function') {           // NEW
      return String(graph.__trellisHistoryTestSerialize());                    // NEW
    }                                                                          // NEW
    if (typeof mxCodec !== 'undefined' && typeof mxUtils !== 'undefined' && mxUtils.getXml) { // NEW
      const enc = new mxCodec();                                               // NEW
      return mxUtils.getXml(enc.encode(model));                                // NEW
    }                                                                          // NEW
    throw new Error('Diagram XML serialization is unavailable.');              // NEW
  }                                                                            // NEW

  function compressSnapshotXml(xml) {                                          // NEW
    if (typeof Graph !== 'undefined' && Graph && typeof Graph.compress === 'function') { // NEW
      try { return { compressed: Graph.compress(xml), compressedKind: 'graph-compress' }; } catch (e) { } // NEW
    }                                                                          // NEW
    return { compressed: xml, compressedKind: 'plain' };                       // NEW
  }                                                                            // NEW

  function decompressSnapshotXml(snapshot) {                                   // NEW
    const raw = snapshot && (snapshot.compressed_xml || snapshot.xml || snapshot.compressedXml); // NEW
    if (snapshot && snapshot.compressed_kind === 'graph-compress' && typeof Graph !== 'undefined' && Graph && typeof Graph.decompress === 'function') { // NEW
      try { return Graph.decompress(raw); } catch (e) { return null; }          // NEW
    }                                                                          // NEW
    return raw;                                                                // NEW
  }                                                                            // NEW

  function restoreActivePageXml(xml) {                                         // NEW
    if (typeof graph.__trellisHistoryTestRestore === 'function') {             // NEW
      graph.__trellisHistoryTestRestore(xml);                                  // NEW
      return;                                                                  // NEW
    }                                                                          // NEW
    const doc = mxUtils.parseXml(xml);                                         // NEW
    const node = doc.documentElement;                                          // NEW
    if (ui.editor && typeof ui.editor.setGraphXml === 'function') {            // NEW
      ui.editor.setGraphXml(node);                                             // NEW
      return;                                                                  // NEW
    }                                                                          // NEW
    if (typeof mxCodec !== 'undefined' && typeof mxGraphModel !== 'undefined') { // NEW
      const nextModel = new mxGraphModel();                                    // NEW
      new mxCodec(node.ownerDocument).decode(node, nextModel);                 // NEW
      if (typeof model.setRoot === 'function') model.setRoot(nextModel.getRoot()); // NEW
    }                                                                          // NEW
  }                                                                            // NEW

  function boundsFromXmlCellMap(map, ids) {                                    // NEW
    let out = null;                                                             // NEW
    const idList = Array.isArray(ids) ? ids : null;                             // NEW
    if (idList) {                                                               // NEW
      for (let i = 0; i < idList.length; i++) {                                 // NEW
        const entry = map && map.get && map.get(idList[i]);                     // NEW
        out = unionBounds(out, entry && entry.bounds);                          // NEW
      }                                                                        // NEW
      return out;                                                              // NEW
    }                                                                          // NEW
    if (map && typeof map.forEach === 'function') {                             // NEW
      map.forEach(function (entry, id) {                                        // NEW
        if (id === '0' || id === '1') return;                                   // NEW
        out = unionBounds(out, entry && entry.bounds);                          // NEW
      });                                                                      // NEW
    }                                                                          // NEW
    return out;                                                                // NEW
  }                                                                            // NEW

  function boundsFromSnapshotDiff(previousXml, currentXml) {                   // NEW
    if (!previousXml || !currentXml) return null;                               // NEW
    const diff = diffSnapshotWithCurrent(previousXml, currentXml);              // NEW
    const current = parseXmlCellMap(currentXml);                                // NEW
    let out = null;                                                             // NEW
    for (let i = 0; i < diff.added.length; i++) out = unionBounds(out, current.get(diff.added[i]) && current.get(diff.added[i]).bounds); // NEW
    for (let i = 0; i < diff.changed.length; i++) out = unionBounds(out, current.get(diff.changed[i]) && current.get(diff.changed[i]).bounds); // NEW
    for (let i = 0; i < diff.deleted.length; i++) out = unionBounds(out, diff.deleted[i] && diff.deleted[i].bounds); // NEW
    return out;                                                                // NEW
  }                                                                            // NEW

  function computeHistoryViewTarget(meta, currentXml, previousXml) {           // NEW
    const affectedIds = uniqueArray(meta && meta.affectedCellIds || []);        // NEW
    let bounds = normalizeBounds(meta && meta.bounds);                          // NEW
    if (!bounds) bounds = boundsForCellIds(affectedIds);                        // NEW
    if (!bounds && previousXml && affectedIds.length) bounds = boundsFromXmlCellMap(parseXmlCellMap(previousXml), affectedIds); // NEW
    if (!bounds) bounds = boundsFromSnapshotDiff(previousXml, currentXml);      // NEW
    if (!bounds) bounds = activeDiagramModelBounds();                           // NEW
    if (!bounds) bounds = boundsFromXmlCellMap(parseXmlCellMap(currentXml));    // NEW
    bounds = normalizeBounds(bounds);                                           // NEW
    const center = normalizeCenter(meta && meta.center) || centerOfBounds(bounds); // NEW
    const viewport = normalizeViewport(meta && meta.viewport) || captureViewportContext(); // NEW
    return { bounds, center, viewport };                                        // NEW
  }                                                                            // NEW

  function extractAffectedCellIds(edit) {                                      // NEW
    const ids = [];                                                            // NEW
    const changes = (edit && edit.changes) || [];                              // NEW
    for (let i = 0; i < changes.length; i++) {                                 // NEW
      const ch = changes[i];                                                   // NEW
      const cell = ch && (ch.cell || ch.child || ch.previous || ch.terminal || null); // NEW
      if (cell && cell.id) ids.push(cell.id);                                  // NEW
    }                                                                          // NEW
    return uniqueArray(ids);                                                   // NEW
  }                                                                            // NEW

  function extractChangeTypes(edit) {                                          // NEW
    const out = [];                                                            // NEW
    const changes = (edit && edit.changes) || [];                              // NEW
    for (let i = 0; i < changes.length; i++) {                                 // NEW
      const ch = changes[i];                                                   // NEW
      const name = ch && ch.constructor && ch.constructor.name;                // NEW
      if (name) out.push(name);                                                // NEW
    }                                                                          // NEW
    return uniqueArray(out);                                                   // NEW
  }                                                                            // NEW

  // -------------------- HistoryStore -------------------- // NEW

  function createHistoryStore() {                                              // NEW
    const bridge = (typeof window !== 'undefined') ? window.dbBridge : null;   // NEW
    const store = { ready: false, disabled: false, warning: '', dbId: null };  // NEW

    async function exec(sql, params) {                                         // NEW
      return bridge.exec(store.dbId, sql, params || []);                      // NEW
    }                                                                          // NEW

    async function query(sql, params) {                                        // NEW
      const res = await bridge.query(store.dbId, sql, params || []);           // NEW
      return (res && res.rows) || [];                                          // NEW
    }                                                                          // NEW

    async function init() {                                                    // NEW
      if (!bridge || typeof bridge.resolvePath !== 'function' || typeof bridge.open !== 'function') { // NEW
        store.disabled = true;                                                 // NEW
        store.warning = 'History storage is unavailable in this environment.'; // NEW
        return store;                                                          // NEW
      }                                                                        // NEW
      try {                                                                    // NEW
        const resolved = await bridge.resolvePath({ dbName: HISTORY_DB_NAME, seedRelPath: null, createIfMissing: true }); // NEW
        const opened = await bridge.open(resolved.dbPath, { readOnly: false, fileMustExist: false, pragma: { journal_mode: 'WAL', synchronous: 'NORMAL' } }); // NEW
        store.dbId = opened.dbId;                                              // NEW
        await exec('CREATE TABLE IF NOT EXISTS history_snapshots (snapshot_id TEXT PRIMARY KEY, diagram_id TEXT NOT NULL, hash TEXT NOT NULL, compressed_kind TEXT NOT NULL, compressed_xml TEXT NOT NULL, byte_size INTEGER NOT NULL, checksum TEXT NOT NULL, created_at INTEGER NOT NULL, snapshot_kind TEXT NOT NULL DEFAULT "full")'); // NEW
        await exec('CREATE TABLE IF NOT EXISTS history_events (id TEXT PRIMARY KEY, diagram_id TEXT NOT NULL, timestamp INTEGER NOT NULL, category TEXT NOT NULL, action TEXT NOT NULL, origin TEXT NOT NULL, title TEXT NOT NULL, affected_cell_ids TEXT NOT NULL, change_types TEXT NOT NULL, counts_json TEXT NOT NULL, snapshot_id TEXT NOT NULL, parent_revision_id TEXT, restored_from_revision_id TEXT, tags_json TEXT NOT NULL, metadata_json TEXT NOT NULL, checkpoint INTEGER NOT NULL DEFAULT 0, diagram_hash TEXT NOT NULL, schema_version INTEGER NOT NULL)'); // NEW
        await exec('CREATE INDEX IF NOT EXISTS idx_history_events_diagram_time ON history_events(diagram_id, timestamp)'); // NEW
        await exec('CREATE INDEX IF NOT EXISTS idx_history_snapshots_diagram_hash ON history_snapshots(diagram_id, hash)'); // NEW
        store.ready = true;                                                    // NEW
      } catch (e) {                                                            // NEW
        store.disabled = true;                                                 // NEW
        store.warning = 'History storage failed: ' + (e && e.message ? e.message : String(e)); // NEW
      }                                                                        // NEW
      return store;                                                            // NEW
    }                                                                          // NEW

    async function getLatestRevision(diagramId) {                              // NEW
      if (!store.ready) return null;                                           // NEW
      const rows = await query('SELECT * FROM history_events WHERE diagram_id = ? ORDER BY timestamp DESC LIMIT 1', [diagramId]); // NEW
      return rows[0] || null;                                                  // NEW
    }                                                                          // NEW

    async function listRevisions(diagramId) {                                  // NEW
      if (!store.ready) return [];                                             // NEW
      const rows = await query('SELECT * FROM history_events WHERE diagram_id = ? ORDER BY timestamp ASC', [diagramId]); // NEW
      return rows.map(rowToRevision);                                          // NEW
    }                                                                          // NEW

    async function loadSnapshot(snapshotId) {                                  // NEW
      if (!store.ready || !snapshotId) return null;                            // NEW
      const rows = await query('SELECT * FROM history_snapshots WHERE snapshot_id = ? LIMIT 1', [snapshotId]); // NEW
      return rows[0] || null;                                                  // NEW
    }                                                                          // NEW

    async function recordRevision(revision, snapshot) {                        // NEW
      if (!store.ready) return false;                                          // NEW
      await exec('INSERT OR IGNORE INTO history_snapshots (snapshot_id, diagram_id, hash, compressed_kind, compressed_xml, byte_size, checksum, created_at, snapshot_kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [snapshot.snapshotId, revision.diagramHistoryId, revision.diagramHash, snapshot.compressedKind, snapshot.compressedXml, snapshot.byteSize, snapshot.checksum, revision.timestamp, 'full']); // NEW
      await exec('INSERT INTO history_events (id, diagram_id, timestamp, category, action, origin, title, affected_cell_ids, change_types, counts_json, snapshot_id, parent_revision_id, restored_from_revision_id, tags_json, metadata_json, checkpoint, diagram_hash, schema_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [revision.id, revision.diagramHistoryId, revision.timestamp, revision.category, revision.action, revision.origin, revision.title, JSON.stringify(revision.affectedCellIds || []), JSON.stringify(revision.changeTypes || []), JSON.stringify(revision.counts || {}), revision.snapshotId, revision.parentRevisionId || null, revision.restoredFromRevisionId || null, JSON.stringify(revision.tags || []), JSON.stringify(revision), revision.checkpoint ? 1 : 0, revision.diagramHash, HISTORY_SCHEMA_VERSION]); // NEW
      await thinHistoryIfNeeded(revision.diagramHistoryId);                    // NEW
      return true;                                                             // NEW
    }                                                                          // NEW

    async function thinHistoryIfNeeded(diagramId) {                            // NEW
      const rows = await query('SELECT e.id, e.snapshot_id, e.checkpoint, e.category, e.action, s.byte_size FROM history_events e JOIN history_snapshots s ON e.snapshot_id = s.snapshot_id WHERE e.diagram_id = ? ORDER BY e.timestamp ASC', [diagramId]); // NEW
      let total = rows.reduce(function (sum, row) { return sum + Number(row.byte_size || 0); }, 0); // NEW
      if (total <= HISTORY_RETENTION_BYTES) return;                            // NEW
      const protectedIds = new Set();                                          // NEW
      for (let i = Math.max(0, rows.length - 100); i < rows.length; i++) protectedIds.add(rows[i].id); // NEW
      if (rows[0]) protectedIds.add(rows[0].id);                               // NEW
      if (rows[rows.length - 1]) protectedIds.add(rows[rows.length - 1].id);   // NEW
      for (let i = 0; i < rows.length; i++) {                                  // NEW
        const row = rows[i];                                                   // NEW
        if (row.checkpoint || row.category !== 'Diagram' || row.action === 'restore') protectedIds.add(row.id); // NEW
      }                                                                        // NEW
      for (let i = 0; i < rows.length && total > HISTORY_RETENTION_BYTES; i++) { // NEW
        const row = rows[i];                                                   // NEW
        if (protectedIds.has(row.id)) continue;                                // NEW
        await exec('DELETE FROM history_events WHERE id = ?', [row.id]);       // NEW
        await exec('DELETE FROM history_snapshots WHERE snapshot_id = ? AND NOT EXISTS (SELECT 1 FROM history_events WHERE snapshot_id = ?)', [row.snapshot_id, row.snapshot_id]); // NEW
        total -= Number(row.byte_size || 0);                                   // NEW
      }                                                                        // NEW
    }                                                                          // NEW

    function rowToRevision(row) {                                              // NEW
      const metadata = safeParseJson(row.metadata_json, {});                   // NEW
      metadata.id = row.id;                                                    // NEW
      metadata.timestamp = Number(row.timestamp);                              // NEW
      metadata.category = row.category;                                        // NEW
      metadata.action = row.action;                                            // NEW
      metadata.origin = row.origin;                                            // NEW
      metadata.title = row.title;                                              // NEW
      metadata.snapshotId = row.snapshot_id;                                   // NEW
      metadata.parentRevisionId = row.parent_revision_id || null;              // NEW
      metadata.restoredFromRevisionId = row.restored_from_revision_id || null; // NEW
      metadata.affectedCellIds = safeParseJson(row.affected_cell_ids, []);     // NEW
      metadata.changeTypes = safeParseJson(row.change_types, []);              // NEW
      metadata.tags = safeParseJson(row.tags_json, []);                        // NEW
      metadata.checkpoint = Number(row.checkpoint) === 1;                      // NEW
      metadata.diagramHash = row.diagram_hash;                                 // NEW
      return metadata;                                                         // NEW
    }                                                                          // NEW

    return {                                                                   // NEW
      init,                                                                    // NEW
      getLatestRevision,                                                       // NEW
      listRevisions,                                                           // NEW
      loadSnapshot,                                                            // NEW
      recordRevision,                                                          // NEW
      get ready() { return store.ready; },                                     // NEW
      get disabled() { return store.disabled; },                               // NEW
      get warning() { return store.warning; }                                  // NEW
    };                                                                         // NEW
  }                                                                            // NEW

  function safeParseJson(text, fallback) {                                     // NEW
    try { return JSON.parse(text); } catch (e) { return fallback; }            // NEW
  }                                                                            // NEW

  // -------------------- HistoryRecorder -------------------- // NEW

  function createHistoryRecorder(store) {                                      // NEW
    const txStack = [];                                                        // NEW
    let pending = null;                                                        // NEW
    let settleTimer = null;                                                    // NEW
    let latestHash = null;                                                     // NEW
    let latestXml = null;                                                       // NEW
    let latestRevisionId = null;                                               // NEW
    let recording = false;                                                     // NEW

    function normalizeMetadata(metadata) {                                     // NEW
      const meta = actorMetadata(metadata || {});                              // CHANGE
      const category = HISTORY_CATEGORIES.indexOf(meta.category) >= 0 ? meta.category : 'Diagram'; // NEW
      return {                                                                 // NEW
        category,                                                              // NEW
        action: String(meta.action || 'change'),                               // NEW
        origin: String(meta.origin || 'drawio'),                               // NEW
        title: String(meta.title || category + ' change'),                     // NEW
        tags: uniqueArray(meta.tags || []),                                    // NEW
        actorUserId: meta.actorUserId ? String(meta.actorUserId) : '',         // NEW
        actorName: meta.actorName ? String(meta.actorName) : '',               // NEW
        actorRole: meta.actorRole ? String(meta.actorRole) : '',               // NEW
        affectedCellIds: uniqueArray(meta.affectedCellIds || []),              // NEW
        changeTypes: uniqueArray(meta.changeTypes || []),                      // NEW
        bounds: normalizeBounds(meta.bounds),                                   // NEW
        center: normalizeCenter(meta.center),                                   // NEW
        viewport: normalizeViewport(meta.viewport),                             // NEW
        checkpoint: !!meta.checkpoint,                                         // NEW
        restoredFromRevisionId: meta.restoredFromRevisionId || null,           // NEW
        restoreAudit: meta.restoreAudit || null                                // NEW
      };                                                                       // NEW
    }                                                                          // NEW

    function mergePending(meta, edit) {                                        // NEW
      const normalized = normalizeMetadata(meta);                              // NEW
      if (!pending) pending = normalized;                                      // NEW
      else {                                                                   // NEW
        if (pending.category === 'Diagram' && normalized.category !== 'Diagram') pending.category = normalized.category; // NEW
        if (pending.action === 'change' && normalized.action !== 'change') pending.action = normalized.action; // NEW
        if (!pending.title || pending.title === 'Diagram change') pending.title = normalized.title; // NEW
        pending.origin = pending.origin === 'drawio' ? normalized.origin : pending.origin; // NEW
        pending.actorUserId = pending.actorUserId || normalized.actorUserId;   // NEW
        pending.actorName = pending.actorName || normalized.actorName;         // NEW
        pending.actorRole = pending.actorRole || normalized.actorRole;         // NEW
        pending.tags = uniqueArray((pending.tags || []).concat(normalized.tags || [], normalized.category)); // NEW
        pending.bounds = unionBounds(pending.bounds, normalized.bounds);        // NEW
        pending.center = normalizeCenter(normalized.center) || pending.center;  // NEW
        pending.viewport = normalizeViewport(normalized.viewport) || pending.viewport; // NEW
        pending.checkpoint = pending.checkpoint || normalized.checkpoint;       // NEW
        pending.restoredFromRevisionId = pending.restoredFromRevisionId || normalized.restoredFromRevisionId; // NEW
        pending.restoreAudit = pending.restoreAudit || normalized.restoreAudit; // NEW
      }                                                                        // NEW
      pending.affectedCellIds = uniqueArray((pending.affectedCellIds || []).concat(normalized.affectedCellIds || [], extractAffectedCellIds(edit))); // NEW
      pending.changeTypes = uniqueArray((pending.changeTypes || []).concat(normalized.changeTypes || [], extractChangeTypes(edit))); // NEW
      scheduleStableRecord();                                                  // NEW
    }                                                                          // NEW

    function recordModelChange(edit, capturedMetadata) {                       // CHANGE
      if (graph.__ccMapInternalChange || graph.__ccHistoryRestoring) return;   // NEW
      const active = capturedMetadata || activeTransactionMetadata();           // CHANGE
      mergePending(active || { category: 'Diagram', action: 'change', origin: 'drawio', title: inferTitleFromEdit(edit) }, edit); // NEW
    }                                                                          // NEW

    function captureActiveTransactionMetadata() {                              // NEW
      return activeTransactionMetadata();                                      // NEW
    }                                                                          // NEW

    function activeTransactionMetadata() {                                      // NEW
      if (!txStack.length) return null;                                        // NEW
      const outer = Object.assign({}, txStack[0]);                             // NEW
      for (let i = 1; i < txStack.length; i++) {                               // NEW
        outer.tags = uniqueArray((outer.tags || []).concat(txStack[i].tags || [], txStack[i].category)); // NEW
        outer.affectedCellIds = uniqueArray((outer.affectedCellIds || []).concat(txStack[i].affectedCellIds || [])); // NEW
        outer.changeTypes = uniqueArray((outer.changeTypes || []).concat(txStack[i].changeTypes || [])); // NEW
        outer.bounds = unionBounds(outer.bounds, txStack[i].bounds);            // NEW
        outer.center = normalizeCenter(txStack[i].center) || outer.center;      // NEW
        outer.viewport = normalizeViewport(txStack[i].viewport) || outer.viewport; // NEW
      }                                                                        // NEW
      return outer;                                                            // NEW
    }                                                                          // NEW

    function inferTitleFromEdit(edit) {                                        // NEW
      const types = extractChangeTypes(edit);                                  // NEW
      if (types.indexOf('mxChildChange') >= 0) return 'Diagram structure changed'; // NEW
      if (types.indexOf('mxGeometryChange') >= 0) return 'Diagram layout changed'; // NEW
      if (types.indexOf('mxStyleChange') >= 0) return 'Diagram style changed'; // NEW
      if (types.indexOf('mxValueChange') >= 0) return 'Content changed';       // NEW
      return 'Diagram changed';                                                // NEW
    }                                                                          // NEW

    function scheduleStableRecord() {                                          // NEW
      if (settleTimer) clearTimeout(settleTimer);                              // NEW
      settleTimer = setTimeout(function () {                                   // NEW
        settleTimer = null;                                                    // NEW
        recordStableRevision(false);                                           // NEW
      }, HISTORY_SETTLE_MS);                                                   // NEW
    }                                                                          // NEW

    async function recordStableRevision(force) {                               // NEW
      if (recording) return;                                                   // NEW
      const meta = pending || normalizeMetadata({ category: 'System', action: 'baseline', origin: 'history', title: 'Opened diagram baseline' }); // NEW
      pending = null;                                                          // NEW
      recording = true;                                                        // NEW
      try {                                                                    // NEW
        const xml = serializeActivePageXml();                                  // NEW
        const hash = hashString(xml);                                          // NEW
        if (!force && latestHash === hash && !meta.checkpoint) return;         // NEW
        const compressed = compressSnapshotXml(xml);                           // NEW
        const diagramId = getDiagramHistoryId();                               // NEW
        const snapshotId = makeHistoryId('snap');                              // NEW
        const viewTarget = computeHistoryViewTarget(meta, xml, latestXml);      // NEW
        const revision = {                                                     // NEW
          id: makeHistoryId('rev'),                                            // NEW
          timestamp: nowMs(),                                                  // NEW
          category: meta.category,                                             // NEW
          tags: uniqueArray(meta.tags || []),                                  // NEW
          action: meta.action,                                                 // NEW
          origin: meta.origin,                                                 // NEW
          title: meta.title,                                                   // NEW
          actorUserId: meta.actorUserId || '',                                 // NEW
          actorName: meta.actorName || '',                                     // NEW
          actorRole: meta.actorRole || '',                                     // NEW
          affectedCellIds: uniqueArray(meta.affectedCellIds || []),            // NEW
          changeTypes: uniqueArray(meta.changeTypes || []),                    // NEW
          bounds: viewTarget.bounds,                                           // NEW
          center: viewTarget.center,                                           // NEW
          viewport: viewTarget.viewport,                                       // NEW
          counts: { affectedCells: uniqueArray(meta.affectedCellIds || []).length, changeTypes: uniqueArray(meta.changeTypes || []).length }, // NEW
          snapshotId,                                                          // NEW
          parentRevisionId: latestRevisionId,                                  // NEW
          restoredFromRevisionId: meta.restoredFromRevisionId || null,         // NEW
          restoreAudit: meta.restoreAudit || null,                             // NEW
          diagramHistoryId: diagramId,                                         // NEW
          diagramHash: hash,                                                   // NEW
          trellisVersion: '2.3.1',                                             // NEW
          pluginVersion: 'history-mvp',                                        // NEW
          schemaVersion: HISTORY_SCHEMA_VERSION,                               // NEW
          checkpoint: !!meta.checkpoint                                        // NEW
        };                                                                     // NEW
        const snapshot = { snapshotId, compressedXml: compressed.compressed, compressedKind: compressed.compressedKind, byteSize: String(compressed.compressed).length, checksum: hashString(compressed.compressed) }; // NEW
        const saved = await store.recordRevision(revision, snapshot);          // NEW
        if (saved) {                                                           // NEW
          latestHash = hash;                                                   // NEW
          latestXml = xml;                                                     // NEW
          latestRevisionId = revision.id;                                      // NEW
          await refreshHistoryRevisions();                                     // NEW
        }                                                                      // NEW
      } catch (e) {                                                            // NEW
        graph.__ccHistoryWarning = 'History record failed: ' + (e && e.message ? e.message : String(e)); // NEW
        updateHistoryUI();                                                     // NEW
      } finally {                                                              // NEW
        recording = false;                                                     // NEW
      }                                                                        // NEW
    }                                                                          // NEW

    function run(metadata, operation) {                                        // NEW
      const normalized = normalizeMetadata(metadata);                          // NEW
      txStack.push(normalized);                                                // NEW
      let result;                                                              // NEW
      try {                                                                    // NEW
        result = typeof operation === 'function' ? operation() : undefined;    // NEW
      } catch (e) {                                                            // NEW
        txStack.pop();                                                         // NEW
        throw e;                                                               // NEW
      }                                                                        // NEW
      if (result && typeof result.then === 'function') {                       // NEW
        return result.finally(function () { txStack.pop(); });                 // NEW
      }                                                                        // NEW
      txStack.pop();                                                           // NEW
      return result;                                                           // NEW
    }                                                                          // NEW

    async function initializeBaseline() {                                      // NEW
      await store.init();                                                      // NEW
      if (!store.ready) { updateHistoryUI(); return; }                         // NEW
      const diagramId = getDiagramHistoryId();                                 // NEW
      const latest = await store.getLatestRevision(diagramId);                 // NEW
      if (latest) {                                                            // NEW
        latestHash = latest.diagram_hash;                                      // NEW
        latestRevisionId = latest.id;                                          // NEW
        try {                                                                  // NEW
          const snapshot = await store.loadSnapshot(latest.snapshot_id);        // NEW
          latestXml = decompressSnapshotXml(snapshot);                          // NEW
        } catch (e) { latestXml = null; }                                      // NEW
        await refreshHistoryRevisions();                                       // NEW
        return;                                                                // NEW
      }                                                                        // NEW
      pending = normalizeMetadata({ category: 'System', action: 'baseline', origin: 'history', title: 'Opened diagram baseline' }); // NEW
      await recordStableRevision(true);                                        // NEW
    }                                                                          // NEW

    function createCheckpoint(title) {                                         // NEW
      pending = normalizeMetadata({ category: 'History', action: 'checkpoint', origin: 'history', title: title || 'Named checkpoint', checkpoint: true }); // NEW
      return recordStableRevision(true);                                       // NEW
    }                                                                          // NEW

    async function recordRestore(restoredFromRevisionId, audit) {              // NEW
      pending = normalizeMetadata({ category: 'History', action: 'restore', origin: 'history', title: 'Restored historical revision', restoredFromRevisionId, restoreAudit: cloneRestoreAudit(audit) }); // NEW
      await recordStableRevision(true);                                        // NEW
    }                                                                          // NEW

    return { initializeBaseline, recordModelChange, captureActiveTransactionMetadata, run, createCheckpoint, recordRestore, recordStableRevision }; // CHANGE
  }                                                                            // NEW

  const historyStore = createHistoryStore();                                   // NEW
  const historyRecorder = createHistoryRecorder(historyStore);                 // NEW

  // -------------------- Tiler-group ignore --------------------

  const TILER_GROUP_STYLE_KEY = 'tiler_group';
  const TILER_GROUP_STYLE_VAL = '1';

  function getStyle(cell) {
    return (cell && typeof cell.getStyle === 'function') ? (cell.getStyle() || '') : (cell && cell.style ? cell.style : '') || '';
  }

  function getStoredStyle(cell) {
    if (!cell) return '';
    // Prefer the raw property if present (most direct)                                         
    if (typeof cell.style === 'string') return cell.style || '';
    // Fallback to API                                                                          
    if (typeof cell.getStyle === 'function') return cell.getStyle() || '';
    return '';
  }


  function isTilerGroup(cell) {
    if (!cell) return false;
    const st = getStoredStyle(cell);
    const styleHit = /(?:^|;)tiler_group=1(?:;|$)/.test(st);
    const attrHit = getAttrStr(cell, 'tiler_group') === '1';
    return styleHit || attrHit;
  }

  function hasTilerGroupAncestor(cell) {
    if (!cell) return false;
    let p = model.getParent(cell);
    while (p) {
      if (isTilerGroup(p)) return true;
      p = model.getParent(p);
    }
    return false;
  }

  function shouldIgnoreBecauseInTilerGroup(cell) {
    // Ignore descendants, but NOT the tiler group cell itself
    return !!cell && !isTilerGroup(cell) && hasTilerGroupAncestor(cell);
  }


  // -------------------- Timestamp stamping --------------------

  function stampCreatedIfMissing(cell, tNow) {
    if (!shouldStyleCell(cell)) return;
    if (getAttrMs(cell, ATTR_CREATED) == null) { setAttrMs(cell, ATTR_CREATED, tNow); stampActor(cell, 'created'); } // CHANGE
  }

  function stampEdited(cell, tNow) {
    if (!shouldStyleCell(cell)) return;
    setAttrMs(cell, ATTR_EDITED, tNow);
    stampActor(cell, 'edited');                                                // NEW
  }

  function snapshotSelectionIds() {
    const sel = (graph.getSelectionCells && graph.getSelectionCells()) || [];
    const ids = new Set();
    for (let i = 0; i < sel.length; i++) {
      const c = sel[i];
      if (c && c.id) ids.add(c.id);
    }
    return ids;
  }

  function beginUserActionWindow() {
    graph.__ccUserActionActive = true;
    graph.__ccUserActionUntil = nowMs() + USER_ACTION_WINDOW_MS;

    // Snapshot after selection has had a chance to update from the click.               
    setTimeout(function () {
      graph.__ccUserActionSelIds = snapshotSelectionIds();
    }, 0);
  }


  function endUserActionWindowIfExpired() {
    if (!graph.__ccUserActionActive) return;
    if (nowMs() > graph.__ccUserActionUntil) {
      graph.__ccUserActionActive = false;
      graph.__ccUserActionSelIds = new Set();
    }
  }

  function stampEditedFromSelectedIntersection(edit) {
    endUserActionWindowIfExpired();
    if (!graph.__ccUserActionActive) return false;

    const selIds = graph.__ccUserActionSelIds;
    if (!selIds || selIds.size === 0) return false;

    const changes = (edit && edit.changes) || [];
    const touched = new Map();
    const tNow = nowMs();
    let did = false;

    for (let i = 0; i < changes.length; i++) {
      const ch = changes[i];
      if (!isDirectEditChange(ch)) continue;

      const cell = ch.cell || ch.child || null;
      if (!cell || !cell.id) continue;
      if (!selIds.has(cell.id)) continue;                                                 // (selection intersection)
      if (!shouldStyleCell(cell)) continue;
      if (shouldIgnoreBecauseInTilerGroup(cell)) continue;

      touched.set(cell.id, cell);
    }

    if (touched.size === 0) return false;

    model.beginUpdate();
    try {
      for (const cell of touched.values()) {
        stampCreatedIfMissing(cell, tNow);                                                 // keep createdAt stable
        stampEdited(cell, tNow);
        did = true;
      }
    } finally {
      model.endUpdate();
    }

    return did;
  }

  function stampCreatedOnInsert(edit) {
    const changes = (edit && edit.changes) || [];
    const tNow = nowMs();
    let did = false;

    model.beginUpdate();
    try {
      for (let i = 0; i < changes.length; i++) {
        const ch = changes[i];
        const name = ch && ch.constructor && ch.constructor.name;
        if (name !== 'mxChildChange') continue;

        const child = ch.child || ch.cell;
        if (!child || !child.id) continue;
        if (!shouldStyleCell(child)) continue;
        if (shouldIgnoreBecauseInTilerGroup(child)) continue;

        // Insert-like: child is being attached to a parent
        // mxChildChange commonly has ch.parent when attached, and ch.previous when detached
        const isAttach = (ch.parent != null);
        if (!isAttach) continue;

        if (getAttrMs(child, ATTR_CREATED) == null) {
          setAttrMs(child, ATTR_CREATED, tNow);
          stampActor(child, 'created');                                        // NEW
          did = true;
        }
      }
    } finally {
      model.endUpdate();
    }

    return did;
  }

  // Input hooks (keep tight to reduce false positives)
  if (graph.container) {
    graph.container.addEventListener('mousedown', beginUserActionWindow, true);
    graph.container.addEventListener('mouseup', beginUserActionWindow, true);
    graph.container.addEventListener('touchstart', beginUserActionWindow, true);
    graph.container.addEventListener('touchend', beginUserActionWindow, true);
  }

  window.addEventListener('resize', function () {                          // NEW
    if (!panel) return;                                                    // NEW
    if (!isPanelVisible()) return;                                         // NEW (avoid 0x0 rect when hidden)
    readAndStorePanelSize();                                               // NEW
  }, true);


  document.addEventListener('keydown', beginUserActionWindow, true);

  // -------------------- origStyle persist/restore --------------------

  const NULL_STYLE_SENTINEL = '__NULL_STYLE__';

  function ensureOrigStyle(cell) {
    if (!shouldStyleCell(cell)) return;
    const orig = getAttrStr(cell, ATTR_ORIG_STYLE);
    if (orig != null) return;

    const st = (typeof cell.getStyle === 'function') ? cell.getStyle() : (cell.style || null);
    cell.setAttribute(ATTR_ORIG_STYLE, st == null ? NULL_STYLE_SENTINEL : String(st));
  }

  function baseStyleForApply(cell) {
    const orig = getAttrStr(cell, ATTR_ORIG_STYLE);
    if (orig === NULL_STYLE_SENTINEL) return null;
    return orig != null ? orig : ((cell.getStyle && cell.getStyle()) || null);
  }

  // -------------------- Scope + filtering --------------------

  function collectScopeCells(scope) {
    if (scope === SCOPE_SELECTION) return collectSelectionCellsOnly();
    if (scope === SCOPE_SUBTREE) return collectSubtreeCellsFromSingleSelection();
    return collectDiagramCells();
  }

  function collectDiagramCells() {
    const out = [];
    iterAllCells(function (cell) {
      if (shouldStyleCell(cell)) out.push(cell);
    });
    return out;
  }

  function collectSelectionCellsOnly() {
    const sel = (graph.getSelectionCells && graph.getSelectionCells()) || [];
    const out = [];
    const seen = new Set();
    for (let i = 0; i < sel.length; i++) {
      const c = sel[i];
      if (!c || !c.id) continue;
      if (!shouldStyleCell(c)) continue;
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
    return out;
  }

  function collectSubtreeCellsFromSingleSelection() {
    const sel = (graph.getSelectionCells && graph.getSelectionCells()) || [];
    if (sel.length !== 1) return collectSelectionCellsOnly();

    const root = sel[0];
    const out = [];
    (function visit(cell) {
      if (shouldStyleCell(cell)) out.push(cell);

      // If this cell is a tiler group, do not include its descendants               
      if (isTilerGroup(cell)) return;

      const n = model.getChildCount(cell);
      for (let i = 0; i < n; i++) visit(model.getChildAt(cell, i));
    })(root);

    return out;
  }

  function windowMsFromSettings() {
    const v = Number(graph.__ccWindowValue);
    if (!Number.isFinite(v) || v <= 0) return null;

    const unit = graph.__ccWindowUnit;
    if (unit === 'minutes') return v * 60 * 1000;
    if (unit === 'hours') return v * 60 * 60 * 1000;
    return v * 24 * 60 * 60 * 1000; // days default
  }

  function getTimestampForMode(cell, mode) {
    if (mode === MODE_CHANGE) {
      const edited = getAttrMs(cell, ATTR_EDITED);
      if (edited != null) return edited;
      return getAttrMs(cell, ATTR_CREATED); // (fallback)
    }
    // MODE_CREATE
    return getAttrMs(cell, ATTR_CREATED);
  }


  function filterCellsByTimeSlice(cells, mode) {
    const ms = windowMsFromSettings();
    if (ms == null) {
      // no slicing: include all timestamped cells for range; still keep non-ts cells for unknown styling
      return { inRange: cells.slice(), tMin: null, tMax: null, windowMs: null };
    }

    const cutoff = nowMs() - ms;
    const inRange = [];
    let tMin = Infinity;
    let tMax = -Infinity;

    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const ts = getTimestampForMode(c, mode);
      if (ts == null) continue;
      if (ts < cutoff) continue;
      inRange.push(c);
      if (ts < tMin) tMin = ts;
      if (ts > tMax) tMax = ts;
    }

    if (inRange.length === 0) return { inRange: [], tMin: null, tMax: null, windowMs: ms };
    return { inRange, tMin, tMax, windowMs: ms };
  }

  function resolveUserFilterId() {                                             // NEW
    const filter = graph.__ccUserFilter || 'all';                              // NEW
    if (filter === 'all') return '';                                           // NEW
    if (filter === 'current') return currentActorUserId();                     // NEW
    if (filter.indexOf('user:') === 0) return filter.substring(5);             // NEW
    return '';                                                                 // NEW
  }                                                                            // NEW

  function filterCellsByUser(cells, mode) {                                    // NEW
    const userId = resolveUserFilterId();                                      // NEW
    if (!userId) return cells;                                                 // NEW
    const key = actorKey(mode);                                                // NEW
    const fallbackKey = mode === MODE_CHANGE ? ATTR_CREATED_BY : '';           // NEW
    return (cells || []).filter(function (cell) {                              // NEW
      return getAttrStr(cell, key) === userId || (!!fallbackKey && getAttrStr(cell, fallbackKey) === userId); // NEW
    });                                                                        // NEW
  }                                                                            // NEW

  function recomputeSliceRange(slice, mode) {                                  // NEW
    let tMin = Infinity;                                                       // NEW
    let tMax = -Infinity;                                                      // NEW
    const inRange = (slice && slice.inRange) || [];                            // NEW
    for (let i = 0; i < inRange.length; i++) {                                 // NEW
      const ts = getTimestampForMode(inRange[i], mode);                        // NEW
      if (ts == null) continue;                                                // NEW
      if (ts < tMin) tMin = ts;                                                // NEW
      if (ts > tMax) tMax = ts;                                                // NEW
    }                                                                          // NEW
    slice.tMin = tMin === Infinity ? null : tMin;                              // NEW
    slice.tMax = tMax === -Infinity ? null : tMax;                             // NEW
  }                                                                            // NEW

  function positionForTimestamp(ts, tMin, tMax) {
    const span = (tMax - tMin);
    if (span <= 0) return 1;
    return clamp01((ts - tMin) / span);
  }

  function widthFromP(cell, p) {
    updateZoomStrokeMult();
    const m = graph.__ccZoomStrokeMult || 1;
    if (isVertex(cell)) return lerp(VERTEX_WIDTH_MIN, VERTEX_WIDTH_MAX, p) * m;
    return lerp(EDGE_WIDTH_MIN, EDGE_WIDTH_MAX, p) * m;
  }


  // -------------------- Apply map --------------------

  function applyMapBatched(mode) {
    const token = ++graph.__ccApplyToken;

    const scopeCells = collectScopeCells(graph.__ccScope);
    const userScopedCells = filterCellsByUser(scopeCells, mode);                // NEW
    const userFilterActive = !!resolveUserFilterId();                           // NEW
    const userScopedSet = new Set(userScopedCells.map(c => c.id));              // NEW
    const slice = filterCellsByTimeSlice(userScopedCells, mode);                // CHANGE
    recomputeSliceRange(slice, mode);                                          // NEW

    const inRangeSet = new Set(slice.inRange.map(c => c.id));
    graph.__ccFiltered = buildNavList(slice.inRange, mode);
    graph.__ccNavIndex = 0;
    updateNavUI();

    graph.__ccMapInternalChange = true;
    model.beginUpdate();

    let i = 0;

    function step() {
      if (token !== graph.__ccApplyToken) {
        try { model.endUpdate(); } finally { graph.__ccMapInternalChange = false; }
        return;
      }

      const end = Math.min(scopeCells.length, i + APPLY_BATCH_SIZE);

      for (; i < end; i++) {
        const cell = scopeCells[i];
        if (!shouldStyleCell(cell)) continue;

        ensureOrigStyle(cell);
        const base = baseStyleForApply(cell);

        if (userFilterActive && !userScopedSet.has(cell.id)) {                 // NEW
          const p0 = 0;                                                         // NEW
          const strokeWidth = widthFromP(cell, p0);                             // NEW
          model.setStyle(cell, mergeStyle(base, {                               // NEW
            strokeColor: OUT_OF_RANGE_STYLE.strokeColor,                        // NEW
            dashed: OUT_OF_RANGE_STYLE.dashed,                                  // NEW
            strokeOpacity: OUT_OF_RANGE_STYLE.strokeOpacity,                    // NEW
            strokeWidth: strokeWidth                                            // NEW
          }));                                                                  // NEW
          continue;                                                             // NEW
        }                                                                       // NEW

        const ts = getTimestampForMode(cell, mode);

        if (ts == null) {
          const p0 = 0;
          const strokeWidth = widthFromP(cell, p0);
          model.setStyle(cell, mergeStyle(base, {
            strokeColor: UNKNOWN_STYLE.strokeColor,
            dashed: UNKNOWN_STYLE.dashed,
            strokeOpacity: UNKNOWN_STYLE.strokeOpacity,
            strokeWidth: strokeWidth
          }));
          continue;
        }


        if (slice.windowMs != null && !inRangeSet.has(cell.id)) {
          const p0 = 0;
          const strokeWidth = widthFromP(cell, p0);
          model.setStyle(cell, mergeStyle(base, {
            strokeColor: OUT_OF_RANGE_STYLE.strokeColor,
            dashed: OUT_OF_RANGE_STYLE.dashed,
            strokeOpacity: OUT_OF_RANGE_STYLE.strokeOpacity,
            strokeWidth: strokeWidth
          }));
          continue;
        }


        if (slice.tMin == null || slice.tMax == null) {
          const p0 = 0;
          const strokeWidth = widthFromP(cell, p0);
          model.setStyle(cell, mergeStyle(base, {
            strokeColor: OUT_OF_RANGE_STYLE.strokeColor,
            dashed: OUT_OF_RANGE_STYLE.dashed,
            strokeOpacity: OUT_OF_RANGE_STYLE.strokeOpacity,
            strokeWidth: strokeWidth
          }));
          continue;
        }


        const p = positionForTimestamp(ts, slice.tMin, slice.tMax);
        const strokeColor = lerpColorRamp(COLOR_RAMP, p);
        const strokeWidth = widthFromP(cell, p);

        model.setStyle(cell, mergeStyle(base, { strokeColor, strokeWidth, dashed: 0, strokeOpacity: 100 }));
      }

      if (i < scopeCells.length) {
        requestAnimationFrame(step);
      } else {
        try {
          model.endUpdate();
        } finally {
          graph.__ccMapInternalChange = false;
          // Single refresh at end (avoid per-cell refresh)                
          if (typeof graph.refresh === 'function') graph.refresh();
        }
      }
    }

    requestAnimationFrame(step);
  }


  function clearMap() {
    const scopeCells = collectScopeCells(graph.__ccScope);

    graph.__ccFiltered = [];
    graph.__ccNavIndex = 0;
    updateNavUI();

    graph.__ccMapInternalChange = true;
    model.beginUpdate();
    try {
      for (let i = 0; i < scopeCells.length; i++) {
        const cell = scopeCells[i];
        const orig = getAttrStr(cell, ATTR_ORIG_STYLE);
        if (orig == null) continue;

        model.setStyle(cell, orig === NULL_STYLE_SENTINEL ? null : orig);
        removeAttr(cell, ATTR_ORIG_STYLE);
      }
    } finally {
      model.endUpdate();
      graph.__ccMapInternalChange = false;
      if (typeof graph.refresh === 'function') graph.refresh();
    }

    graph.__ccMode = MODE_NONE;
  }

  function enableMode(mode) {
    if (graph.__ccMode !== MODE_NONE) clearMap();
    graph.__ccMode = mode;
    scheduleRefreshIfEnabled();
  }

  function toggleMode(mode) {
    if (graph.__ccMode === mode) clearMap();
    else enableMode(mode);
  }

  function refreshIfEnabled() {
    scheduleRefreshIfEnabled();
  }


  // -------------------- Navigation --------------------

  function buildNavList(cellsInRange, mode) {
    const key = modeKey(mode);
    const list = [];
    for (let i = 0; i < cellsInRange.length; i++) {
      const c = cellsInRange[i];
      const ts = getAttrMs(c, key);
      if (ts == null) continue;
      list.push({ cell: c, ts });
    }

    list.sort(function (a, b) {
      return graph.__ccSortOrder === 'oldest' ? (a.ts - b.ts) : (b.ts - a.ts);
    });

    return list;
  }

  function navSelectIndex(idx) {
    if (!graph.__ccFiltered || graph.__ccFiltered.length === 0) return;
    const clamped = Math.max(0, Math.min(graph.__ccFiltered.length - 1, idx));
    graph.__ccNavIndex = clamped;

    const entry = graph.__ccFiltered[clamped];
    if (!entry || !entry.cell) return;

    graph.setSelectionCell(entry.cell);
    if (typeof graph.scrollCellToVisible === 'function') {
      graph.scrollCellToVisible(entry.cell);
    }

    updateNavUI();
  }

  function navPrev() { navSelectIndex(graph.__ccNavIndex - 1); }
  function navNext() { navSelectIndex(graph.__ccNavIndex + 1); }

  // -------------------- UI overlay --------------------

  let panel = null;
  let modeSelect = null;
  let scopeSelect = null;
  let windowValueInput = null;
  let windowUnitSelect = null;
  let sortSelect = null;
  let userFilterSelect = null;                                                // NEW
  let infoLabel = null;
  let prevBtn = null;
  let nextBtn = null;
  let listWrap = null;
  let historyFilterSelect = null;                                             // NEW
  let historyRailWrap = null;                                                 // NEW
  let historyPreview = null;                                                  // NEW
  let historyStatus = null;                                                   // NEW
  let returnLatestBtn = null;                                                 // NEW
  let compareBtn = null;                                                       // NEW
  let restoreBtn = null;                                                       // NEW
  let checkpointBtn = null;                                                    // NEW

  graph.__ccPanelVisible = false;

  graph.__ccPanelW = 340;                                                  // (px) // CHANGE
  graph.__ccPanelH = 320;                                                  // (px)

  function applyPanelSize() {
    if (!panel) return;
    panel.style.width = String(graph.__ccPanelW) + 'px';
    panel.style.height = '100%';                                               // CHANGE
  }

  function clamp(n, a, b) {
    n = Number(n);
    if (!Number.isFinite(n)) return a;
    return Math.max(a, Math.min(b, n));
  }

  function readAndStorePanelSize() {
    if (!panel) return;
    // getBoundingClientRect is reliable even with box sizing
    const r = panel.getBoundingClientRect();
    const maxW = Math.max(280, (window.innerWidth || 1200) - 40);
    const maxH = Math.max(220, (window.innerHeight || 800) - 40);

    graph.__ccPanelW = clamp(r.width, 320, maxW);                              // CHANGE
    graph.__ccPanelH = clamp(r.height, 200, maxH);

    // Re-apply clamped values so it doesn't drift beyond bounds
    applyPanelSize();
  }


  function isPanelVisible() {
    return !!(panel && panel.style.display !== 'none' && graph.__ccPanelVisible);
  }

  function showPanel() {
    createPanel();
    if (!panel) return;
    panel.style.display = '';
    graph.__ccPanelVisible = true;
    syncPanelFromState();
    updateNavUI();
    updateHistoryUI();                                                         // NEW
  }

  function hidePanel() {
    if (!panel) return;
    panel.style.display = 'none';
    graph.__ccPanelVisible = false;
    clearHistoryCompareOverlays();                                             // NEW
  }

  function togglePanel() {
    if (isPanelVisible()) hidePanel();
    else showPanel();
  }

  function makeEl(tag, styleObj) {
    const el = document.createElement(tag);
    if (styleObj) Object.assign(el.style, styleObj);
    return el;
  }

  function createPanel() {
    if (panel) return;

    panel = makeEl('div', {
      position: 'absolute',
      top: '0',                                                               // CHANGE
      right: '0',                                                             // CHANGE
      zIndex: 9999,
      bottom: '0',                                                            // NEW
      background: '#ffffff',                                                   // CHANGE
      borderLeft: '1px solid #c7c7cc',                                         // CHANGE
      padding: '10px',
      fontFamily: 'Arial, sans-serif',
      fontSize: '12px',
      minWidth: '320px',                                                       // CHANGE
      boxShadow: '-2px 0 8px rgba(0,0,0,0.10)',                                // CHANGE
      display: 'flex',              // ← ADD HERE
      flexDirection: 'column',      // ← ADD HERE
      gap: '6px',
      resize: 'horizontal',                                                    // CHANGE
      overflow: 'auto',                                                        // CHANGE
      boxSizing: 'border-box',                                             // NEW
      minHeight: '200px',                                                  // NEW (recommended)
    });

    const title = makeEl('div', { fontWeight: '600', marginBottom: '8px' });
    title.textContent = 'ChangeMap History';                                  // CHANGE
    panel.appendChild(title);

    panel.appendChild(makeRow('Mode', (modeSelect = makeSelect([
      { value: MODE_NONE, label: 'Off' },
      { value: MODE_CHANGE, label: 'ChangeMap' },
      { value: MODE_CREATE, label: 'CreateMap' }
    ]))));

    panel.appendChild(makeRow('Scope', (scopeSelect = makeSelect([
      { value: SCOPE_DIAGRAM, label: 'Diagram' },
      { value: SCOPE_SELECTION, label: 'Selection' },
      { value: SCOPE_SUBTREE, label: 'Subtree (single selected)' }
    ]))));

    const timeRow = makeEl('div', { display: 'flex', alignItems: 'center', gap: '8px', margin: '6px 0' });
    const timeLab = makeEl('div', { minWidth: '60px' });
    timeLab.textContent = 'Window';
    timeRow.appendChild(timeLab);

    windowValueInput = makeEl('input', { width: '70px', padding: '3px 6px' });
    windowValueInput.type = 'number';
    windowValueInput.min = '0';
    windowValueInput.value = String(graph.__ccWindowValue);

    windowUnitSelect = makeSelect([
      { value: 'minutes', label: 'minutes' },
      { value: 'hours', label: 'hours' },
      { value: 'days', label: 'days' }
    ]);

    timeRow.appendChild(windowValueInput);
    timeRow.appendChild(windowUnitSelect);

    const hint = makeEl('div', { color: '#666', marginTop: '2px', fontSize: '11px' });
    hint.textContent = 'Set window=0 to disable slicing.';
    panel.appendChild(timeRow);
    panel.appendChild(hint);

    panel.appendChild(makeRow('Order', (sortSelect = makeSelect([
      { value: 'newest', label: 'Newest first' },
      { value: 'oldest', label: 'Oldest first' }
    ]))));

    panel.appendChild(makeRow('User', (userFilterSelect = makeSelect(userFilterOptions())))); // NEW

    const navRow = makeEl('div', { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' });
    prevBtn = makeEl('button', { padding: '4px 8px', cursor: 'pointer' });
    prevBtn.textContent = 'Prev';
    nextBtn = makeEl('button', { padding: '4px 8px', cursor: 'pointer' });
    nextBtn.textContent = 'Next';
    infoLabel = makeEl('div', { flex: '1', textAlign: 'right', color: '#444' });
    navRow.appendChild(prevBtn);
    navRow.appendChild(nextBtn);
    navRow.appendChild(infoLabel);
    panel.appendChild(navRow);

    listWrap = makeEl('div', {
      borderTop: '1px solid #ddd',
      paddingTop: '6px',
      flex: '0 0 auto',                                                        // CHANGE
      overflow: 'auto',
      maxHeight: '150px',                                                      // NEW
      minHeight: '70px'                                                        // CHANGE
    });
    panel.appendChild(listWrap);

    const historyTitle = makeEl('div', { fontWeight: '600', marginTop: '10px', borderTop: '1px solid #ddd', paddingTop: '8px' }); // NEW
    historyTitle.textContent = 'Persistent History';                           // NEW
    panel.appendChild(historyTitle);                                           // NEW

    historyStatus = makeEl('div', { color: '#666', fontSize: '11px', minHeight: '16px' }); // NEW
    panel.appendChild(historyStatus);                                          // NEW

    panel.appendChild(makeRow('Filter', (historyFilterSelect = makeSelect([{ value: 'all', label: 'All categories' }].concat(HISTORY_CATEGORIES.map(function (category) { return { value: category, label: category }; })))))); // NEW

    historyRailWrap = makeEl('div', {                                          // NEW
      border: '1px solid #ddd',                                                // NEW
      minHeight: '220px',                                                      // NEW
      flex: '1 1 auto',                                                        // NEW
      overflow: 'auto',                                                        // NEW
      padding: '8px',                                                          // NEW
      background: '#fafafa'                                                    // NEW
    });                                                                        // NEW
    panel.appendChild(historyRailWrap);                                        // NEW

    historyPreview = makeEl('div', { borderTop: '1px solid #ddd', paddingTop: '8px', minHeight: '90px', color: '#333' }); // NEW
    panel.appendChild(historyPreview);                                         // NEW

    const historyActions = makeEl('div', { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }); // NEW
    returnLatestBtn = makeEl('button', { padding: '5px 8px', cursor: 'pointer' }); // NEW
    returnLatestBtn.textContent = 'Return latest';                             // NEW
    compareBtn = makeEl('button', { padding: '5px 8px', cursor: 'pointer' });  // NEW
    compareBtn.textContent = 'Compare';                                        // NEW
    restoreBtn = makeEl('button', { padding: '5px 8px', cursor: 'pointer' });  // NEW
    restoreBtn.textContent = 'Restore';                                        // NEW
    checkpointBtn = makeEl('button', { padding: '5px 8px', cursor: 'pointer' }); // NEW
    checkpointBtn.textContent = 'Checkpoint';                                  // NEW
    historyActions.appendChild(returnLatestBtn);                               // NEW
    historyActions.appendChild(compareBtn);                                    // NEW
    historyActions.appendChild(restoreBtn);                                    // NEW
    historyActions.appendChild(checkpointBtn);                                 // NEW
    panel.appendChild(historyActions);                                         // NEW

    wirePanelEvents();
    // Persist size after user finishes resizing (mouse/touch release)
    panel.addEventListener('mouseup', readAndStorePanelSize, true);        // NEW
    panel.addEventListener('touchend', readAndStorePanelSize, true);       // NEW

    attachPanel();
    panel.style.display = graph.__ccPanelVisible ? '' : 'none';

    applyPanelSize();

    syncPanelFromState();
    updateNavUI();
    updateHistoryUI();                                                         // NEW
  }

  function makeRow(label, control) {
    const row = makeEl('div', { display: 'flex', alignItems: 'center', gap: '8px', margin: '6px 0' });
    const lab = makeEl('div', { minWidth: '60px' });
    lab.textContent = label;
    row.appendChild(lab);
    row.appendChild(control);
    control.style.flex = '1';
    return row;
  }

  function makeSelect(options) {
    const sel = makeEl('select', { padding: '3px 6px' });
    for (let i = 0; i < options.length; i++) {
      const opt = document.createElement('option');
      opt.value = options[i].value;
      opt.textContent = options[i].label;
      sel.appendChild(opt);
    }
    return sel;
  }

  function userFilterOptions() {                                               // NEW
    const options = [{ value: 'all', label: 'All users' }, { value: 'current', label: 'Current user' }]; // NEW
    const users = usersApi();                                                  // NEW
    const list = users && typeof users.listUsers === 'function' ? users.listUsers() : []; // NEW
    for (let i = 0; i < list.length; i++) {                                    // NEW
      if (list[i] && list[i].id) options.push({ value: 'user:' + list[i].id, label: list[i].name || list[i].id }); // NEW
    }                                                                          // NEW
    return options;                                                            // NEW
  }                                                                            // NEW

  function refreshSelectOptions(select, options, selectedValue) {              // NEW
    if (!select) return;                                                       // NEW
    const value = selectedValue || select.value || 'all';                      // NEW
    select.innerHTML = '';                                                     // NEW
    for (let i = 0; i < options.length; i++) {                                 // NEW
      const opt = document.createElement('option');                            // NEW
      opt.value = options[i].value;                                            // NEW
      opt.textContent = options[i].label;                                      // NEW
      select.appendChild(opt);                                                 // NEW
    }                                                                          // NEW
    select.value = options.some(function (option) { return option.value === value; }) ? value : 'all'; // NEW
  }                                                                            // NEW

  function attachPanel() {
    if (!graph.container || !panel) return;
    const parent = graph.container.parentNode || graph.container;
    if (parent && parent.style && (!parent.style.position || parent.style.position === 'static')) parent.style.position = 'relative'; // NEW
    if (panel.parentNode !== parent) parent.appendChild(panel);
  }

  function wirePanelEvents() {
    modeSelect.addEventListener('change', function () {
      const v = modeSelect.value;
      if (v === MODE_NONE) clearMap();
      else enableMode(v);
    });

    scopeSelect.addEventListener('change', function () {
      graph.__ccScope = scopeSelect.value;
      refreshIfEnabled();
    });

    windowValueInput.addEventListener('change', function () {
      graph.__ccWindowValue = Number(windowValueInput.value || 0);
      refreshIfEnabled();
    });

    windowUnitSelect.addEventListener('change', function () {
      graph.__ccWindowUnit = windowUnitSelect.value;
      refreshIfEnabled();
    });

    sortSelect.addEventListener('change', function () {
      graph.__ccSortOrder = sortSelect.value;
      refreshIfEnabled();
    });

    userFilterSelect.addEventListener('change', function () {                  // NEW
      graph.__ccUserFilter = userFilterSelect.value || 'all';                  // NEW
      refreshIfEnabled();                                                      // NEW
      updateHistoryUI();                                                       // NEW
    });                                                                        // NEW

    prevBtn.addEventListener('click', function () { navPrev(); });
    nextBtn.addEventListener('click', function () { navNext(); });
    historyFilterSelect.addEventListener('change', function () {               // NEW
      graph.__ccHistoryFilter = historyFilterSelect.value;                     // NEW
      updateHistoryUI();                                                       // NEW
    });                                                                        // NEW
    returnLatestBtn.addEventListener('click', function () {                    // NEW
      graph.__ccHistorySelectedId = null;                                      // NEW
      clearHistoryCompareOverlays();                                           // NEW
      updateHistoryUI();                                                       // NEW
    });                                                                        // NEW
    compareBtn.addEventListener('click', function () { compareSelectedRevision(); }); // NEW
    restoreBtn.addEventListener('click', function () { confirmRestoreSelectedRevision(); }); // NEW
    checkpointBtn.addEventListener('click', function () { historyRecorder.createCheckpoint('Manual checkpoint'); }); // NEW
  }

  function syncPanelFromState() {
    modeSelect.value = graph.__ccMode;
    scopeSelect.value = graph.__ccScope;
    windowValueInput.value = String(graph.__ccWindowValue);
    windowUnitSelect.value = graph.__ccWindowUnit;
    sortSelect.value = graph.__ccSortOrder;
    refreshSelectOptions(userFilterSelect, userFilterOptions(), graph.__ccUserFilter || 'all'); // NEW
    graph.__ccUserFilter = userFilterSelect ? userFilterSelect.value : (graph.__ccUserFilter || 'all'); // NEW
    if (historyFilterSelect) historyFilterSelect.value = graph.__ccHistoryFilter || 'all'; // NEW
  }

  function formatTs(ts) {
    try { return new Date(ts).toLocaleString(); } catch (e) { return String(ts); }
  }

  function updateNavUI() {
    if (!panel) return;

    const n = graph.__ccFiltered ? graph.__ccFiltered.length : 0;
    const idx = graph.__ccNavIndex;

    infoLabel.textContent = n === 0 ? '0' : ((idx + 1) + ' / ' + n);

    prevBtn.disabled = (n === 0 || idx <= 0);
    nextBtn.disabled = (n === 0 || idx >= n - 1);

    // Build clickable list
    listWrap.innerHTML = '';
    if (n === 0) {
      const empty = makeEl('div', { color: '#666' });
      empty.textContent = 'No matches in window.';
      listWrap.appendChild(empty);
      return;
    }

    const max = Math.min(NAV_LIST_MAX, n);
    for (let i = 0; i < max; i++) {
      const entry = graph.__ccFiltered[i];
      const row = makeEl('div', {
        padding: '4px 6px',
        cursor: 'pointer',
        borderRadius: '6px',
        marginBottom: '2px',
        background: (i === idx) ? 'rgba(52,199,89,0.12)' : 'transparent'
      });

      const label = entry.cell.value && entry.cell.value.nodeName
        ? (entry.cell.value.getAttribute('label') || entry.cell.id)
        : (entry.cell.id);

      row.textContent = label + '  —  ' + formatTs(entry.ts);

      (function (targetIndex) {
        row.addEventListener('click', function () {
          navSelectIndex(targetIndex);
        });
      })(i);

      listWrap.appendChild(row);
    }
  }

  async function refreshHistoryRevisions() {                                  // NEW
    try {                                                                      // NEW
      if (!historyStore.ready) return;                                         // NEW
      graph.__ccHistoryRevisions = await historyStore.listRevisions(getDiagramHistoryId()); // NEW
      updateHistoryUI();                                                       // NEW
    } catch (e) {                                                              // NEW
      graph.__ccHistoryWarning = 'History refresh failed: ' + (e && e.message ? e.message : String(e)); // NEW
      updateHistoryUI();                                                       // NEW
    }                                                                          // NEW
  }                                                                            // NEW

  function selectedHistoryRevision() {                                         // NEW
    const id = graph.__ccHistorySelectedId;                                    // NEW
    const list = graph.__ccHistoryRevisions || [];                             // NEW
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; // NEW
    return null;                                                               // NEW
  }                                                                            // NEW

  function revisionMatchesUserFilter(rev) {                                    // NEW
    const userId = resolveUserFilterId();                                      // NEW
    if (!userId) return true;                                                  // NEW
    return !!(rev && rev.actorUserId === userId);                              // NEW
  }                                                                            // NEW

  function updateHistoryUI() {                                                 // NEW
    if (!panel || !historyRailWrap || !historyPreview || !historyStatus) return; // NEW
    refreshSelectOptions(userFilterSelect, userFilterOptions(), graph.__ccUserFilter || 'all'); // NEW
    graph.__ccUserFilter = userFilterSelect ? userFilterSelect.value : (graph.__ccUserFilter || 'all'); // NEW
    const warning = graph.__ccHistoryWarning || historyStore.warning || '';    // NEW
    historyStatus.textContent = warning || graph.__ccHistoryRestoreStatus || (historyStore.ready ? 'History is recording stable revisions.' : 'History storage is starting.'); // NEW
    historyRailWrap.innerHTML = '';                                            // NEW
    const filter = graph.__ccHistoryFilter || 'all';                           // NEW
    const all = graph.__ccHistoryRevisions || [];                              // NEW
    const categoryFiltered = filter === 'all' ? all : all.filter(function (rev) { return rev.category === filter || (rev.tags || []).indexOf(filter) >= 0; }); // CHANGE
    const revisions = categoryFiltered.filter(revisionMatchesUserFilter);       // NEW
    if (revisions.length === 0) {                                               // NEW
      const empty = makeEl('div', { color: '#666' });                          // NEW
      empty.textContent = historyStore.ready ? 'No revisions match this filter.' : 'Persistent history unavailable.'; // NEW
      historyRailWrap.appendChild(empty);                                      // NEW
    }                                                                          // NEW
    for (let i = 0; i < revisions.length; i++) {                               // NEW
      historyRailWrap.appendChild(createHistoryRevisionRow(revisions[i], i, revisions.length)); // NEW
    }                                                                          // NEW
    updateHistoryPreview();                                                    // NEW
  }                                                                            // NEW

  function createHistoryRevisionRow(rev, index, total) {                       // NEW
    const active = rev.id === graph.__ccHistorySelectedId;                     // NEW
    const row = makeEl('div', {                                                // NEW
      display: 'grid',                                                         // NEW
      gridTemplateColumns: '18px 1fr',                                         // NEW
      columnGap: '7px',                                                        // NEW
      alignItems: 'start',                                                     // NEW
      cursor: 'pointer',                                                       // NEW
      padding: '4px',                                                          // NEW
      background: active ? 'rgba(26,115,232,0.10)' : 'transparent',            // NEW
      borderRadius: '4px'                                                      // NEW
    });                                                                        // NEW
    const tick = makeEl('div', { width: '10px', height: '10px', borderRadius: '5px', marginTop: '4px', background: rev.checkpoint ? '#f9ab00' : (rev.category === 'History' ? '#1a73e8' : '#5f6368') }); // NEW
    const label = makeEl('div', { overflow: 'hidden' });                       // NEW
    const title = makeEl('div', { fontWeight: active ? '600' : '400', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }); // NEW
    title.textContent = rev.title || rev.action || 'Revision';                 // NEW
    const meta = makeEl('div', { color: '#666', fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }); // NEW
    meta.textContent = rev.category + ' - ' + formatTs(rev.timestamp) + (rev.actorName ? ' - ' + rev.actorName : ''); // CHANGE
    label.appendChild(title);                                                  // NEW
    label.appendChild(meta);                                                   // NEW
    row.appendChild(tick);                                                     // NEW
    row.appendChild(label);                                                    // NEW
    row.title = (index + 1) + ' / ' + total + ' - ' + rev.category;             // NEW
    row.addEventListener('click', function () { selectHistoryRevision(rev.id); }); // NEW
    return row;                                                                // NEW
  }                                                                            // NEW

  function updateHistoryPreview() {                                            // NEW
    const rev = selectedHistoryRevision();                                     // NEW
    if (!rev) {                                                                // NEW
      historyPreview.textContent = 'Select a revision to preview affected cells, compare, or restore.'; // NEW
      compareBtn.disabled = true;                                              // NEW
      restoreBtn.disabled = true;                                              // NEW
      return;                                                                  // NEW
    }                                                                          // NEW
    compareBtn.disabled = false;                                               // NEW
    restoreBtn.disabled = false;                                               // NEW
    const affected = rev.affectedCellIds || [];                                // NEW
    historyPreview.innerHTML = '';                                             // NEW
    const title = makeEl('div', { fontWeight: '600', marginBottom: '4px' });   // NEW
    title.textContent = rev.title || 'Revision';                               // NEW
    const meta = makeEl('div', { color: '#555', fontSize: '11px', marginBottom: '4px' }); // NEW
    meta.textContent = rev.category + ' - ' + formatTs(rev.timestamp) + (rev.actorName ? ' - ' + rev.actorName : ''); // CHANGE
    const counts = makeEl('div', { color: '#333' });                           // NEW
    counts.textContent = String(affected.length) + ' affected cell' + (affected.length === 1 ? '' : 's') + (rev.restoredFromRevisionId ? ' - branch restore' : ''); // NEW
    historyPreview.appendChild(title);                                         // NEW
    historyPreview.appendChild(meta);                                          // NEW
    historyPreview.appendChild(counts);                                        // NEW
    const compareSummary = graph.__ccHistoryCompareSummary;                    // NEW
    if (compareSummary && compareSummary.revisionId === rev.id) {              // NEW
      const diff = makeEl('div', { color: '#333', marginTop: '4px' });          // NEW
      diff.textContent = 'Compare: ' + compareSummary.added + ' added, ' + compareSummary.changed + ' changed, ' + compareSummary.deleted + ' deleted'; // NEW
      historyPreview.appendChild(diff);                                        // NEW
    }                                                                          // NEW
    const audit = graph.__ccHistoryLastRestoreAudit;                           // NEW
    if (audit && audit.sourceRevisionId === rev.id) {                          // NEW
      const status = makeEl('div', { color: audit.warnings && audit.warnings.length ? '#b06000' : '#188038', marginTop: '4px' }); // NEW
      status.textContent = audit.warnings && audit.warnings.length ? 'Restore warning: ' + audit.warnings.map(function (entry) { return entry.message; }).join(' ') : 'Graph restored. External Trellis data was not rolled back.'; // NEW
      historyPreview.appendChild(status);                                      // NEW
    }                                                                          // NEW
  }                                                                            // NEW

  function historyBoundsAsRect(bounds) {                                       // NEW
    const b = normalizeBounds(bounds);                                          // NEW
    if (!b) return null;                                                        // NEW
    return (typeof mxRectangle !== 'undefined') ? new mxRectangle(b.x, b.y, b.width, b.height) : b; // NEW
  }                                                                            // NEW

  function fitHistoryRevisionTarget(rev, cells) {                              // NEW
    const bounds = normalizeBounds(rev && rev.bounds) || boundsForCells(cells); // NEW
    const rect = historyBoundsAsRect(bounds);                                   // NEW
    if (rect && typeof graph.fitWindow === 'function') { graph.fitWindow(rect, 16); return true; } // NEW
    if (rect && typeof graph.scrollRectToVisible === 'function') { graph.scrollRectToVisible(rect); return true; } // NEW
    if (cells && cells.length && graph.scrollCellToVisible) { graph.scrollCellToVisible(cells[0], true); return true; } // NEW
    return false;                                                              // NEW
  }                                                                            // NEW

  function selectHistoryRevision(id) {                                         // NEW
    graph.__ccHistorySelectedId = id;                                          // NEW
    clearHistoryCompareOverlays();                                             // NEW
    const rev = selectedHistoryRevision();                                     // NEW
    const ids = (rev && rev.affectedCellIds) || [];                            // NEW
    const cells = ids.map(function (cellId) { return model.getCell && model.getCell(cellId); }).filter(Boolean); // NEW
    if (cells.length && graph.setSelectionCells) graph.setSelectionCells(cells); // NEW
    fitHistoryRevisionTarget(rev, cells);                                      // NEW
    updateHistoryUI();                                                         // NEW
  }                                                                            // NEW

  function clearHistoryCompareOverlays() {                                     // NEW
    const overlays = graph.__ccHistoryCompareOverlays || [];                   // NEW
    for (let i = 0; i < overlays.length; i++) {                                // NEW
      const node = overlays[i];                                                // NEW
      if (node && node.parentNode) node.parentNode.removeChild(node);          // NEW
    }                                                                          // NEW
    graph.__ccHistoryCompareOverlays = [];                                     // NEW
    graph.__ccHistoryCompareSummary = null;                                    // NEW
    fireHistoryLifecycleEvent(HISTORY_EVENT_COMPARE_CLEARED, {});              // NEW
  }                                                                            // NEW

  function overlayHost() {                                                     // NEW
    return (graph.container && graph.container.parentNode) || graph.container || document.body; // NEW
  }                                                                            // NEW

  function addCompareOverlay(bounds, label, color, dashed) {                   // NEW
    if (!bounds) return;                                                       // NEW
    const div = makeEl('div', {                                                // NEW
      position: 'absolute',                                                    // NEW
      left: String(Math.round(bounds.x)) + 'px',                               // NEW
      top: String(Math.round(bounds.y)) + 'px',                                // NEW
      width: String(Math.max(8, Math.round(bounds.width))) + 'px',             // NEW
      height: String(Math.max(8, Math.round(bounds.height))) + 'px',           // NEW
      border: '2px ' + (dashed ? 'dashed' : 'solid') + ' ' + color,            // NEW
      background: dashed ? 'rgba(217,48,37,0.08)' : 'rgba(26,115,232,0.08)',   // NEW
      pointerEvents: 'none',                                                   // NEW
      zIndex: 9998,                                                            // NEW
      boxSizing: 'border-box'                                                  // NEW
    });                                                                        // NEW
    if (label) div.title = label;                                              // NEW
    overlayHost().appendChild(div);                                            // NEW
    graph.__ccHistoryCompareOverlays.push(div);                                // NEW
  }                                                                            // NEW

  function cellBoundsForOverlay(cell) {                                        // NEW
    const state = graph.view && graph.view.getState && graph.view.getState(cell); // NEW
    if (state) return { x: state.x, y: state.y, width: state.width, height: state.height }; // NEW
    const geo = cell && cell.geometry;                                         // NEW
    if (!geo) return null;                                                     // NEW
    return { x: geo.x || 0, y: geo.y || 0, width: geo.width || 40, height: geo.height || 24 }; // NEW
  }                                                                            // NEW

  async function compareSelectedRevision() {                                  // NEW
    const rev = selectedHistoryRevision();                                     // NEW
    if (!rev) return;                                                          // NEW
    clearHistoryCompareOverlays();                                             // NEW
    const snapshot = await historyStore.loadSnapshot(rev.snapshotId);          // NEW
    if (!snapshot) return;                                                     // NEW
    const historicalXml = decompressSnapshotXml(snapshot);                     // NEW
    if (!historicalXml) { graph.__ccHistoryWarning = 'History snapshot is unreadable.'; updateHistoryUI(); return; } // NEW
    const diff = diffSnapshotWithCurrent(historicalXml, serializeActivePageXml()); // NEW
    graph.__ccHistoryCompareSummary = { revisionId: rev.id, added: diff.added.length, changed: diff.changed.length, deleted: diff.deleted.length }; // NEW
    for (let i = 0; i < diff.added.length; i++) {                              // NEW
      const cell = model.getCell && model.getCell(diff.added[i]);              // NEW
      if (cell) addCompareOverlay(cellBoundsForOverlay(cell), 'Added: ' + diff.added[i], '#188038', false); // NEW
    }                                                                          // NEW
    for (let i = 0; i < diff.changed.length; i++) {                            // NEW
      const cell = model.getCell && model.getCell(diff.changed[i]);            // NEW
      if (cell) addCompareOverlay(cellBoundsForOverlay(cell), 'Changed: ' + diff.changed[i], '#1a73e8', false); // NEW
    }                                                                          // NEW
    for (let i = 0; i < diff.deleted.length; i++) {                            // NEW
      const ghost = diff.deleted[i];                                           // NEW
      addCompareOverlay(ghost.bounds, 'Deleted: ' + ghost.id, '#d93025', true); // NEW
    }                                                                          // NEW
    updateHistoryPreview();                                                    // NEW
  }                                                                            // NEW

  function diffSnapshotWithCurrent(historicalXml, currentXml) {                // NEW
    const historical = parseXmlCellMap(historicalXml);                         // NEW
    const current = parseXmlCellMap(currentXml);                               // NEW
    const added = [];                                                          // NEW
    const changed = [];                                                        // NEW
    const deleted = [];                                                        // NEW
    historical.forEach(function (oldEntry, id) {                               // NEW
      if (id === '0' || id === '1') return;                                    // NEW
      const cur = current.get(id);                                             // NEW
      if (!cur) deleted.push({ id, bounds: oldEntry.bounds });                 // NEW
      else if (oldEntry.signature !== cur.signature) changed.push(id);         // NEW
    });                                                                        // NEW
    current.forEach(function (_entry, id) {                                     // NEW
      if (id === '0' || id === '1') return;                                    // NEW
      if (!historical.has(id)) added.push(id);                                  // NEW
    });                                                                        // NEW
    return { added, changed, deleted };                                        // NEW
  }                                                                            // NEW

  function parseXmlCellMap(xml) {                                              // NEW
    const out = new Map();                                                     // NEW
    try {                                                                      // NEW
      const doc = mxUtils.parseXml(xml);                                       // NEW
      const cells = doc.getElementsByTagName('mxCell');                        // NEW
      for (let i = 0; i < cells.length; i++) {                                 // NEW
        const cell = cells[i];                                                 // NEW
        const id = cell.getAttribute('id');                                    // NEW
        if (!id) continue;                                                     // NEW
        const geo = cell.getElementsByTagName('mxGeometry')[0];                // NEW
        const localBounds = geo ? normalizeBounds({ x: geo.getAttribute('x') || 0, y: geo.getAttribute('y') || 0, width: geo.getAttribute('width') || 40, height: geo.getAttribute('height') || 24 }) : null; // NEW
        out.set(id, { id, parentId: cell.getAttribute('parent') || null, signature: cell.outerHTML || mxUtils.getXml(cell), localBounds, bounds: localBounds }); // NEW
      }                                                                        // NEW
      const offsets = new Map();                                                // NEW
      function offsetFor(id) {                                                  // NEW
        if (!id || offsets.has(id)) return offsets.get(id) || { x: 0, y: 0 };   // NEW
        const entry = out.get(id);                                              // NEW
        if (!entry) return { x: 0, y: 0 };                                      // NEW
        const parentOffset = offsetFor(entry.parentId);                         // NEW
        const local = normalizeBounds(entry.localBounds);                       // NEW
        const offset = { x: parentOffset.x + (local ? local.x : 0), y: parentOffset.y + (local ? local.y : 0) }; // NEW
        offsets.set(id, offset);                                                // NEW
        return offset;                                                          // NEW
      }                                                                         // NEW
      out.forEach(function (entry) {                                            // NEW
        const local = normalizeBounds(entry.localBounds);                       // NEW
        if (!local) { entry.bounds = null; return; }                            // NEW
        const parentOffset = offsetFor(entry.parentId);                         // NEW
        entry.bounds = normalizeBounds({ x: parentOffset.x + local.x, y: parentOffset.y + local.y, width: local.width, height: local.height }); // NEW
      });                                                                       // NEW
    } catch (e) { }                                                            // NEW
    return out;                                                                // NEW
  }                                                                            // NEW

  function confirmRestoreSelectedRevision() {                                 // NEW
    const rev = selectedHistoryRevision();                                     // NEW
    if (!rev) return;                                                          // NEW
    const message = 'Restore "' + (rev.title || rev.id) + '" from ' + formatTs(rev.timestamp) + '?\n\nThe current state will be saved first and native undo/redo will be cleared.'; // NEW
    if (typeof window.confirm === 'function' && !window.confirm(message)) return; // NEW
    restoreSelectedRevision(rev);                                              // NEW
  }                                                                            // NEW

  async function restoreSelectedRevision(rev) {                                // NEW
    const snapshot = await historyStore.loadSnapshot(rev.snapshotId);          // NEW
    clearHistoryCompareOverlays();                                             // NEW
    graph.__ccHistoryWarning = '';                                             // NEW
    graph.__ccHistoryRestoreStatus = '';                                       // NEW
    const beforeXml = serializeActivePageXml();                                // NEW
    const audit = createRestoreAudit(rev, hashString(beforeXml));              // NEW
    graph.__ccHistoryLastRestoreAudit = audit;                                 // NEW
    if (!snapshot) {                                                           // NEW
      addRestoreAuditWarning(audit, 'missingSnapshot', 'History snapshot is missing.'); // NEW
      audit.completedAt = nowMs();                                             // NEW
      graph.__ccHistoryWarning = 'History snapshot is missing.';               // NEW
      updateHistoryUI();                                                       // NEW
      return false;                                                            // NEW
    }                                                                          // NEW
    const xml = decompressSnapshotXml(snapshot);                               // NEW
    if (!xml) {                                                                // NEW
      addRestoreAuditWarning(audit, 'unreadableSnapshot', 'History snapshot is unreadable.'); // NEW
      audit.completedAt = nowMs();                                             // NEW
      graph.__ccHistoryWarning = 'History snapshot is unreadable.';            // NEW
      updateHistoryUI();                                                       // NEW
      return false;                                                            // NEW
    }                                                                          // NEW
    await historyRecorder.recordStableRevision(true);                          // NEW
    graph.__ccHistoryRestoring = true;                                         // NEW
    fireHistoryLifecycleEvent(HISTORY_EVENT_BEFORE_RESTORE, { revision: rev, audit }); // NEW
    try {                                                                      // NEW
      restoreActivePageXml(xml);                                               // NEW
      audit.loadedHash = hashString(serializeActivePageXml());                 // NEW
      audit.loadedAt = nowMs();                                                // NEW
      const undoManager = ui && ui.editor && ui.editor.undoManager;            // NEW
      if (undoManager && typeof undoManager.clear === 'function') undoManager.clear(); // NEW
      else if (undoManager && Array.isArray(undoManager.history)) { undoManager.history.length = 0; undoManager.indexOfNextAdd = 0; } // NEW
      if (typeof graph.refresh === 'function') graph.refresh();                // NEW
      fireHistoryLifecycleEvent(HISTORY_EVENT_AFTER_RESTORE, { revision: rev, audit }); // NEW
      await waitForHistoryRehydrateTick();                                     // NEW
      audit.afterRehydrateHash = hashString(serializeActivePageXml());         // NEW
      audit.rehydratedAt = nowMs();                                            // NEW
      if (audit.loadedHash && audit.afterRehydrateHash && audit.loadedHash !== audit.afterRehydrateHash) { // NEW
        addRestoreAuditWarning(audit, 'rehydrationMutatedGraph', 'Plugin rehydration changed the graph after restore.'); // NEW
      }                                                                        // NEW
      audit.completedAt = nowMs();                                             // NEW
      graph.__ccHistoryRestoreStatus = 'Graph restored. External Trellis data was not rolled back.'; // NEW
      if (audit.warnings && audit.warnings.length) graph.__ccHistoryWarning = audit.warnings.map(function (entry) { return entry.message; }).join(' '); // NEW
      await historyRecorder.recordRestore(rev.id, audit);                      // NEW
      updateHistoryUI();                                                       // NEW
      return true;                                                             // NEW
    } catch (e) {                                                              // NEW
      addRestoreAuditWarning(audit, 'restoreFailed', e && e.message ? e.message : String(e)); // NEW
      audit.completedAt = nowMs();                                             // NEW
      graph.__ccHistoryWarning = 'History restore failed: ' + (e && e.message ? e.message : String(e)); // NEW
      clearHistoryCompareOverlays();                                           // NEW
      updateHistoryUI();                                                       // NEW
      return false;                                                            // NEW
    } finally {                                                                // NEW
      graph.__ccHistoryRestoring = false;                                      // NEW
    }                                                                          // NEW
  }                                                                            // NEW

  const ChangeMapRenderer = {                                                  // NEW
    enable: enableMode,                                                        // NEW
    clear: clearMap,                                                           // NEW
    refresh: refreshIfEnabled,                                                 // NEW
    compare: compareSelectedRevision,                                          // NEW
    clearCompare: clearHistoryCompareOverlays                                  // NEW
  };                                                                           // NEW

  const HistoryRail = {                                                        // NEW
    show: showPanel,                                                           // NEW
    hide: hidePanel,                                                           // NEW
    toggle: togglePanel,                                                       // NEW
    select: selectHistoryRevision,                                             // NEW
    update: updateHistoryUI                                                    // NEW
  };                                                                           // NEW

  function dedupeTimestampsOnPaste(cells) {
    if (!Array.isArray(cells) || cells.length === 0) return false;

    const tBase = nowMs();
    let bump = 0;
    let did = false;

    model.beginUpdate();
    try {
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        if (!c || !c.id) continue;
        if (!shouldStyleCell(c)) continue;
        if (shouldIgnoreBecauseInTilerGroup(c)) continue;

        ensureXmlValue(c);

        // createdAt: reset only if it conflicts with another cell                             
        const created = getAttrMs(c, ATTR_CREATED);
        if (created != null && hasTimestampConflict(ATTR_CREATED, created, c.id)) {
          setAttrMs(c, ATTR_CREATED, tBase + (bump++));
          did = true;
        }

        // Optional: lastEditedAt can also be duplicated on paste; same rule                    
        const edited = getAttrMs(c, ATTR_EDITED);
        if (edited != null && hasTimestampConflict(ATTR_EDITED, edited, c.id)) {
          setAttrMs(c, ATTR_EDITED, tBase + (bump++));
          did = true;
        }
      }
    } finally {
      model.endUpdate();
    }

    return did;
  }

  function hasTimestampConflict(key, ts, excludeId) {
    if (ts == null) return false;
    let conflict = false;
    iterAllCells(function (c) {
      if (conflict) return;
      if (!c || !c.id || c.id === excludeId) return;
      const other = getAttrMs(c, key);
      if (other != null && other === ts) conflict = true;
    });
    return conflict;
  }


  function isWithinPasteWindow() {
    return nowMs() <= (graph.__ccPasteUntil || 0);
  }

  function stampCreatedCells(cells, tNow) {
    if (!Array.isArray(cells) || cells.length === 0) return false;
    let did = false;

    model.beginUpdate();
    try {
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        if (!c || !c.id) continue;
        if (!shouldStyleCell(c)) continue;
        if (shouldIgnoreBecauseInTilerGroup(c)) continue;

        ensureXmlValue(c);
        if (getAttrMs(c, ATTR_CREATED) == null) {
          setAttrMs(c, ATTR_CREATED, tNow);
          stampActor(c, 'created');                                            // NEW
          did = true;
        }
      }
    } finally {
      model.endUpdate();
    }

    return did;
  }

  // -------------------- Listen for model changes --------------------
  const DEBUG_CCMAP_CONSOLE = false; // CHANGE

  function debugLogEdit(edit, label) {
    if (!DEBUG_CCMAP_CONSOLE) return; // CHANGE
    try {
      const changes = (edit && edit.changes) || [];
      console.log(`[CCMap] ${label}: ${changes.length} change(s)`);
      for (let i = 0; i < changes.length; i++) {
        const ch = changes[i];
        const name = ch && ch.constructor && ch.constructor.name;
        const cell = ch && (ch.child || ch.cell || ch.previous || ch.terminal || null);
        const id = cell && cell.id;
        const parent = cell ? model.getParent(cell) : null;
        console.log(`  - #${i} ${name}`, { id, parentId: parent && parent.id, ch });
      }
    } catch (e) {
      console.warn('[CCMap] debugLogEdit failed', e);
    }
  }

  model.addListener(mxEvent.CHANGE, function (sender, evt) {
    if (graph.__ccMapInternalChange) return;
    if (graph.__trellisUsersRejecting || graph.__trellisUsersInternalChange) return; // NEW

    const edit = evt && evt.getProperty && evt.getProperty('edit');
    if (!edit || !edit.changes) return;
    if (edit.__trellisUsersRejected) return;                                    // NEW
    const capturedMetadata = historyRecorder.captureActiveTransactionMetadata(); // NEW

    Promise.resolve().then(function () {                                        // NEW
      if (graph.__ccMapInternalChange) return;                                  // NEW
      if (graph.__trellisUsersRejecting || graph.__trellisUsersInternalChange) return; // NEW
      if (edit.__trellisUsersRejected) return;                                  // NEW

      debugLogEdit(edit, 'CHANGE');                                             // CHANGE
      historyRecorder.recordModelChange(edit, capturedMetadata);                // CHANGE

      const createdStamped = stampCreatedOnInsert(edit);                        // CHANGE
      const editedStamped = stampEditedFromSelectedIntersection(edit);           // CHANGE

      if (createdStamped || editedStamped) scheduleRefreshIfEnabled();           // CHANGE
    });                                                                         // NEW
  });

  const selectionModel = graph.getSelectionModel && graph.getSelectionModel();  // NEW
  if (selectionModel && typeof selectionModel.addListener === 'function') {     // NEW
    selectionModel.addListener(mxEvent.CHANGE, function () { clearHistoryCompareOverlays(); }); // NEW
  }                                                                            // NEW

  function installHistoryPublicApi() {                                         // NEW
    window.Trellis = window.Trellis || {};                                     // NEW
    window.Trellis.history = window.Trellis.history || {};                     // NEW
    window.Trellis.history.run = historyRecorder.run;                          // NEW
    window.Trellis.history.createCheckpoint = historyRecorder.createCheckpoint; // NEW
    window.Trellis.history.list = function () { return (graph.__ccHistoryRevisions || []).slice(); }; // NEW
    window.Trellis.history.isRestoring = function () { return !!graph.__ccHistoryRestoring; }; // NEW
    window.Trellis.history.getLastRestoreAudit = function () { return cloneRestoreAudit(graph.__ccHistoryLastRestoreAudit); }; // NEW
    window.Trellis.history.restore = function (revisionId) {                   // NEW
      const rev = (graph.__ccHistoryRevisions || []).find(function (entry) { return entry.id === revisionId; }); // NEW
      return rev ? restoreSelectedRevision(rev) : Promise.resolve(false);      // NEW
    };                                                                         // NEW
    window.Trellis.history.events = {                                          // NEW
      beforeRestore: HISTORY_EVENT_BEFORE_RESTORE,                             // NEW
      afterRestore: HISTORY_EVENT_AFTER_RESTORE,                               // NEW
      compareCleared: HISTORY_EVENT_COMPARE_CLEARED                            // NEW
    };                                                                         // NEW
    window.Trellis.history._test = {                                           // NEW
      getDiagramHistoryId,                                                     // NEW
      serializeActivePageXml,                                                  // NEW
      hashString,                                                              // NEW
      diffSnapshotWithCurrent,                                                 // NEW
      computeHistoryViewTarget,                                                // NEW
      fitHistoryRevisionTarget,                                                // NEW
      recordStableRevision: historyRecorder.recordStableRevision,              // NEW
      components: {                                                            // NEW
        ChangeMapRenderer,                                                     // NEW
        HistoryRecorder: historyRecorder,                                      // NEW
        HistoryStore: historyStore,                                            // NEW
        HistoryRail                                                            // NEW
      }                                                                        // NEW
    };                                                                         // NEW
    graph.__trellisHistory = window.Trellis.history;                           // NEW
  }                                                                            // NEW


  const originalAddCells = graph.addCells;

  graph.addCells = function (cells, parent, index, source, target, absolute) {
    const tNow = nowMs();
    model.beginUpdate();
    try {
      // Ensure user object exists + stamp createdAt before actual insertion.                 
      if (Array.isArray(cells)) {
        for (let i = 0; i < cells.length; i++) {
          const c = cells[i];
          if (!c || !c.id) continue;
          if (!shouldStyleCell(c)) continue;
          if (shouldIgnoreBecauseInTilerGroup(c)) continue;

          ensureXmlValue(c);
          if (getAttrMs(c, ATTR_CREATED) == null) { setAttrMs(c, ATTR_CREATED, tNow); stampActor(c, 'created'); } // CHANGE
        }
      }

      return originalAddCells.apply(this, arguments);
    } finally {
      model.endUpdate();
    }
  };

  graph.addListener(mxEvent.CELLS_ADDED, function (sender, evt) {
    if (graph.__ccMapInternalChange) return;

    const cells = (evt && evt.getProperty && (evt.getProperty('cells') || evt.getProperty('added'))) || [];

    // Normal insert stamping (createdAt if missing)                                            
    const didCreate = stampCreatedCells(cells, nowMs());

    // Paste-specific dedupe                                                                    
    const maybePaste = isWithinPasteWindow() ||
      (cells || []).some(c => c && c.id && graph.__ccPasteIds && graph.__ccPasteIds.has(c.id));

    const didDedupe = maybePaste ? dedupeTimestampsOnPaste(cells) : false;

    if (didCreate || didDedupe) scheduleRefreshIfEnabled();
  });


  const originalImportCells = graph.importCells;

  graph.importCells = function (cells, dx, dy, target, evt, mapping) {
    const tNow = nowMs();
    model.beginUpdate();
    try {
      if (Array.isArray(cells)) {
        for (let i = 0; i < cells.length; i++) {
          const c = cells[i];
          if (!c || !c.id) continue;
          if (!shouldStyleCell(c)) continue;
          if (shouldIgnoreBecauseInTilerGroup(c)) continue;

          ensureXmlValue(c);
          if (getAttrMs(c, ATTR_CREATED) == null) { setAttrMs(c, ATTR_CREATED, tNow); stampActor(c, 'created'); } // CHANGE
        }
      }

      return originalImportCells.apply(this, arguments);
    } finally {
      model.endUpdate();
    }
  };


  graph.addListener(mxEvent.PASTE, function (sender, evt) {
    const cells = (evt && evt.getProperty && evt.getProperty('cells')) || [];
    graph.__ccPasteIds = new Set((cells || []).map(c => c && c.id).filter(Boolean));
    graph.__ccPasteUntil = nowMs() + PASTE_WINDOW_MS;
  });



  // -------------------- Zoom listener (debounced apply) ---------------- 
  if (graph.view && typeof graph.view.addListener === 'function') {
    graph.view.addListener(mxEvent.SCALE, function () {
      if (graph.__ccMode === MODE_NONE) return;
      updateZoomStrokeMult();
      scheduleRefreshIfEnabled();
    });
  }



  // -------------------- Context eligibility -------------------- // NEW

  const MODULE_STYLE_KEYS = ['garden_module']; // NEW

  function hasStyleFlag(cell, key, expected) { // NEW
    if (!cell || !key) return false; // NEW
    const st = getStoredStyle(cell); // NEW
    const re = new RegExp('(?:^|;)' + key + '=' + expected + '(?:;|$)'); // NEW
    return re.test(st); // NEW
  } // NEW

  function hasAttrOrStyleFlag(cell, key, expected) { // NEW
    return getAttrStr(cell, key) === expected || hasStyleFlag(cell, key, expected); // NEW
  } // NEW

  function isModuleCell(cell) { // NEW
    if (!cell) return false; // NEW

    for (let i = 0; i < MODULE_STYLE_KEYS.length; i++) { // NEW
      if (hasAttrOrStyleFlag(cell, MODULE_STYLE_KEYS[i], '1')) return true; // NEW
    } // NEW

    return false; // NEW
  } // NEW

  function isDiagramRootContext(cell) { // NEW
    if (!cell) return true; // NEW blank-canvas right click
    if (cell === model.getRoot()) return true; // NEW actual mxGraph model root

    const defaultParent = graph.getDefaultParent && graph.getDefaultParent(); // NEW usually the current page/layer
    if (cell === defaultParent) return true; // NEW

    return false; // NEW
  } // NEW

  function shouldShowCcMapContext(cell) { // NEW
    return isDiagramRootContext(cell) || isModuleCell(cell); // NEW
  } // NEW

  function installHistoryAction() {                                            // NEW
    if (!ui || !ui.actions || typeof ui.actions.addAction !== 'function') return; // NEW
    if (ui.__trellisChangeMapHistoryActionInstalled) return;                   // NEW
    ui.__trellisChangeMapHistoryActionInstalled = true;                        // NEW
    ui.actions.addAction('trellisChangeMapHistory', function () { togglePanel(); }); // NEW
    const menus = ui.menus;                                                    // NEW
    if (menus && typeof menus.get === 'function' && typeof menus.addMenuItems === 'function') { // NEW
      const viewMenu = menus.get('view') || menus.get('extras');               // NEW
      if (viewMenu && !viewMenu.__trellisChangeMapHistoryPatched) {            // NEW
        const oldFunct = viewMenu.funct;                                       // NEW
        viewMenu.funct = function (menu, parent) {                             // NEW
          if (typeof oldFunct === 'function') oldFunct.apply(this, arguments); // NEW
          menus.addMenuItems(menu, ['-', 'trellisChangeMapHistory'], parent);  // NEW
        };                                                                     // NEW
        viewMenu.__trellisChangeMapHistoryPatched = true;                      // NEW
      }                                                                        // NEW
    }                                                                          // NEW
  }                                                                            // NEW

  function installHistoryToolbarButton() {                                     // NEW
    if (ui.__trellisChangeMapHistoryButtonInstalled || typeof document === 'undefined') return; // NEW
    const host = ui.toolbarContainer || ui.menubarContainer || ui.container || (graph.container && graph.container.parentNode); // NEW
    if (!host || typeof host.appendChild !== 'function') return;               // NEW
    ui.__trellisChangeMapHistoryButtonInstalled = true;                        // NEW
    const button = document.createElement('button');                            // NEW
    button.type = 'button';                                                     // NEW
    button.className = 'geButton trellis-changemap-history-button';             // NEW
    button.title = 'ChangeMap History';                                         // NEW
    button.textContent = 'History';                                             // NEW
    button.style.cssText = 'margin:2px 4px;padding:3px 8px;cursor:pointer;';    // NEW
    button.addEventListener('click', function () { togglePanel(); });           // NEW
    host.appendChild(button);                                                   // NEW
  }                                                                            // NEW



  // -------------------- Context menu --------------------

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
    id: "createdChangeMap", // NEW
    priority: 700, // NEW
    addItems: function (menu, cell, evt) { // CHANGE

    if (!shouldShowCcMapContext(cell)) return; // CHANGE

    const panelLabel = isPanelVisible() ? 'Hide ChangeMap History' : 'Show ChangeMap History'; // CHANGE
    menu.addItem(panelLabel, null, function () {
      togglePanel();
    });
    } // CHANGE
  }); // CHANGE

  installHistoryPublicApi();                                                   // NEW
  installHistoryAction();                                                      // NEW
  installHistoryToolbarButton();                                               // NEW
  historyRecorder.initializeBaseline();                                        // NEW

});
