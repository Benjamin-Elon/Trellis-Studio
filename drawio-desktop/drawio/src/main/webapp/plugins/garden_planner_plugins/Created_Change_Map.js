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
  const ATTR_HISTORY_ID = 'trellis_history_id';
  const ATTR_CREATED_BY = 'createdByUserId';
  const ATTR_EDITED_BY = 'lastEditedByUserId';
  const GRAPH_OVERLAY_Z = Object.freeze({ ANNOTATION: 10000, CONNECTION: 10010, CONTROL: 10020, CONTROL_TOP: 10030 });

  function applyChangeMapButtonStyle(button, variant, options) {
    if (window.Trellis && window.Trellis.ui && typeof window.Trellis.ui.applyButtonStyle === 'function') {
      window.Trellis.ui.applyButtonStyle(button, variant, options);
    } else if (button) {
      const normalized = variant || 'neutral'; // CHANGE: fallback needs the variant to support active open styling
      const activeOpen = normalized === 'open' && options && options.active === true; // CHANGE: match shared active-open treatment before Trellis UI loads
      const style = { open: ['#2563eb', activeOpen ? '#1e3a8a' : '#1d4ed8', activeOpen ? '#eff6ff' : '#fff'], add: ['#188038', '#166534', '#fff'], close: ['#b91c1c', '#b91c1c', '#fff'], danger: ['#b91c1c', '#fff', '#b91c1c'], neutral: ['#6b7280', '#111827', '#fff'] }[normalized] || ['#6b7280', '#111827', '#fff']; // NEW
      button.setAttribute('data-trellis-button-variant', normalized);
      button.style.border = '1px solid ' + style[0]; // CHANGE
      button.style.background = style[2]; // CHANGE
      button.style.color = style[1]; // CHANGE
      if (activeOpen) button.style.fontWeight = '700'; // CHANGE: fallback active emphasis
    }
    return button;
  }

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

  const HISTORY_DB_NAME = 'Trellis_history.sqlite';
  const HISTORY_SETTLE_MS = 2500;
  const HISTORY_RETENTION_BYTES = 500 * 1024 * 1024;
  const HISTORY_SCHEMA_VERSION = 1;
  const HISTORY_EVENT_BEFORE_RESTORE = 'trellisHistoryBeforeRestore';
  const HISTORY_EVENT_AFTER_RESTORE = 'trellisHistoryAfterRestore';
  const HISTORY_EVENT_COMPARE_CLEARED = 'trellisHistoryCompareCleared';
  const HISTORY_CATEGORIES = [
    'Diagram', 'Content', 'Planning', 'Garden scheduling', 'Assignments',
    'Tasks', 'Conditions', 'Irrigation', 'Resources', 'Data', 'History',
    'System'
  ];


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
  graph.__ccUserFilter = 'all';
  graph.__ccFiltered = [];          // current filtered cells (for navigation)
  graph.__ccNavIndex = 0;
  graph.__ccHistoryRevisions = [];
  graph.__ccHistorySelectedId = null;
  graph.__ccHistoryFilter = 'all';
  graph.__ccHistoryPreviewMode = false;
  graph.__ccHistoryCompareOverlays = [];
  graph.__ccHistoryRestoring = false;
  graph.__ccHistoryLastRestoreAudit = null;
  graph.__ccHistoryRestoreStatus = '';


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

  function actorKey(mode) {
    return mode === MODE_CHANGE ? ATTR_EDITED_BY : ATTR_CREATED_BY;
  }

  function usersApi() {
    return typeof window !== 'undefined' && window.Trellis && window.Trellis.users;
  }

  function actorMetadata(metadata) {
    const users = usersApi();
    if (users && typeof users.withActorMetadata === 'function') return users.withActorMetadata(metadata || {});
    return Object.assign({}, metadata || {});
  }

  function currentActorUserId() {
    const users = usersApi();
    const user = users && typeof users.getCurrentUser === 'function' ? users.getCurrentUser() : null;
    return user && user.id ? String(user.id) : '';
  }

  function stampActor(cell, kind, edit) {
    const users = usersApi();
    if (users && edit && typeof users.stampActorIntoEdit === 'function') users.stampActorIntoEdit(edit, cell, kind);
    else if (users && typeof users.stampActorOnCell === 'function') users.stampActorOnCell(cell, kind);
  }

  function isDirectEditChange(ch) {
    const n = ch && ch.constructor && ch.constructor.name;
    return n === 'mxStyleChange' ||
      n === 'mxValueChange' ||
      n === 'mxTerminalChange' ||
      n === 'mxGeometryChange' ||
      n === 'mxCollapseChange' ||
      n === 'mxVisibleChange';
  }

  // -------------------- History identity + serialization --------------------

  function makeHistoryId(prefix) {
    const rand = Math.random().toString(36).slice(2, 10);
    return prefix + '_' + Date.now().toString(36) + '_' + rand;
  }

  function hashString(text) {
    const s = String(text == null ? '' : text);
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 ^= c;
      h1 = Math.imul(h1, 0x01000193);
      h2 = Math.imul(h2 ^ c, 0x85ebca6b);
    }
    return ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0'));
  }

  function uniqueArray(values) {
    const out = [];
    const seen = new Set();
    for (let i = 0; i < (values || []).length; i++) {
      const v = values[i];
      if (v == null || v === '' || seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    return out;
  }

  function finiteNumberOrNull(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function normalizeBounds(bounds) {
    if (!bounds) return null;
    const x = finiteNumberOrNull(bounds.x);
    const y = finiteNumberOrNull(bounds.y);
    const width = finiteNumberOrNull(bounds.width != null ? bounds.width : bounds.w);
    const height = finiteNumberOrNull(bounds.height != null ? bounds.height : bounds.h);
    if (x == null || y == null || width == null || height == null) return null;
    return { x, y, width: Math.max(1, width), height: Math.max(1, height) };
  }

  function unionBounds(a, b) {
    const left = normalizeBounds(a);
    const right = normalizeBounds(b);
    if (!left) return right;
    if (!right) return left;
    const x1 = Math.min(left.x, right.x);
    const y1 = Math.min(left.y, right.y);
    const x2 = Math.max(left.x + left.width, right.x + right.width);
    const y2 = Math.max(left.y + left.height, right.y + right.height);
    return { x: x1, y: y1, width: Math.max(1, x2 - x1), height: Math.max(1, y2 - y1) };
  }

  function centerOfBounds(bounds) {
    const b = normalizeBounds(bounds);
    return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
  }

  function normalizeCenter(center) {
    if (!center) return null;
    const x = finiteNumberOrNull(center.x);
    const y = finiteNumberOrNull(center.y);
    return x == null || y == null ? null : { x, y };
  }

  function normalizeViewport(viewport) {
    if (!viewport) return null;
    const x = finiteNumberOrNull(viewport.x);
    const y = finiteNumberOrNull(viewport.y);
    const scale = finiteNumberOrNull(viewport.scale);
    if (x == null || y == null) return null;
    return scale == null ? { x, y } : { x, y, scale };
  }

  function captureViewportContext() {
    const view = graph.view || {};
    const scale = finiteNumberOrNull(view.scale) || 1;
    const tr = view.translate || { x: 0, y: 0 };
    const container = graph.container || {};
    const scrollLeft = finiteNumberOrNull(container.scrollLeft) || 0;
    const scrollTop = finiteNumberOrNull(container.scrollTop) || 0;
    return { x: scrollLeft / scale - (Number(tr.x) || 0), y: scrollTop / scale - (Number(tr.y) || 0), scale };
  }

  function cellModelBounds(cell) {
    if (!cell || cell === model.getRoot()) return null;
    const geo = cell.getGeometry ? cell.getGeometry() : cell.geometry;
    if (!geo) return null;
    let x = finiteNumberOrNull(geo.x);
    let y = finiteNumberOrNull(geo.y);
    const width = finiteNumberOrNull(geo.width);
    const height = finiteNumberOrNull(geo.height);
    if (x == null || y == null || width == null || height == null) return null;
    let parent = model.getParent && model.getParent(cell);
    while (parent && parent !== model.getRoot()) {
      const pGeo = parent.getGeometry ? parent.getGeometry() : parent.geometry;
      if (pGeo) {
        x += finiteNumberOrNull(pGeo.x) || 0;
        y += finiteNumberOrNull(pGeo.y) || 0;
      }
      parent = model.getParent && model.getParent(parent);
    }
    return normalizeBounds({ x, y, width, height });
  }

  function boundsForCells(cells) {
    let out = null;
    for (let i = 0; i < (cells || []).length; i++) out = unionBounds(out, cellModelBounds(cells[i]));
    return out;
  }

  function boundsForCellIds(ids) {
    const cells = [];
    for (let i = 0; i < (ids || []).length; i++) {
      const cell = model.getCell && model.getCell(ids[i]);
      if (cell) cells.push(cell);
    }
    return boundsForCells(cells);
  }

  function activeDiagramModelBounds() {
    let out = null;
    iterAllCells(function (cell) { out = unionBounds(out, cellModelBounds(cell)); });
    return out;
  }

  function fireHistoryLifecycleEvent(name, detail) {
    const payload = Object.assign({ graph, history: window.Trellis && window.Trellis.history }, detail || {});
    try {
      if (typeof mxEventObject !== 'undefined' && graph.fireEvent) graph.fireEvent(new mxEventObject(name, 'detail', payload));
    } catch (e) { }
    try {
      if (window && typeof window.dispatchEvent === 'function' && typeof window.CustomEvent === 'function') window.dispatchEvent(new window.CustomEvent(name, { detail: payload }));
    } catch (e) { }
  }

  function cloneRestoreAudit(audit) {
    if (!audit) return null;
    return safeParseJson(JSON.stringify(audit), null);
  }

  function createRestoreAudit(rev, beforeHash) {
    const now = nowMs();
    return {
      restoreId: makeHistoryId('restore'),
      sourceRevisionId: rev && rev.id || null,
      beforeHash: beforeHash || null,
      loadedHash: null,
      afterRehydrateHash: null,
      startedAt: now,
      loadedAt: null,
      rehydratedAt: null,
      completedAt: null,
      warnings: []
    };
  }

  function addRestoreAuditWarning(audit, code, message) {
    if (!audit) return;
    audit.warnings = audit.warnings || [];
    audit.warnings.push({ code: String(code || 'restoreWarning'), message: String(message || 'Restore warning') });
  }

  function waitForHistoryRehydrateTick() {
    if (typeof setTimeout !== 'function') return Promise.resolve();
    return new Promise(function (resolve) { setTimeout(resolve, 0); });
  }

  function getHistoryIdentityCell() {
    const defaultParent = graph.getDefaultParent && graph.getDefaultParent();
    return defaultParent || model.getRoot();
  }

  function getDiagramHistoryId() {
    const cell = getHistoryIdentityCell();
    let id = cell && cell !== model.getRoot() ? getAttrStr(cell, ATTR_HISTORY_ID) : null;
    if (!id && graph.__ccDiagramHistoryId) id = graph.__ccDiagramHistoryId;
    if (!id) id = makeHistoryId('diagram');
    graph.__ccDiagramHistoryId = id;
    if (cell && cell !== model.getRoot() && getAttrStr(cell, ATTR_HISTORY_ID) == null) {
      try { ensureXmlValue(cell); cell.setAttribute(ATTR_HISTORY_ID, id); } catch (e) { }
    }
    return id;
  }

  function serializeActivePageXml() {
    if (typeof graph.__trellisHistoryTestSerialize === 'function') {
      return String(graph.__trellisHistoryTestSerialize());
    }
    if (typeof mxCodec !== 'undefined' && typeof mxUtils !== 'undefined' && mxUtils.getXml) {
      const enc = new mxCodec();
      return mxUtils.getXml(enc.encode(model));
    }
    throw new Error('Diagram XML serialization is unavailable.');
  }

  function compressSnapshotXml(xml) {
    if (typeof Graph !== 'undefined' && Graph && typeof Graph.compress === 'function') {
      try { return { compressed: Graph.compress(xml), compressedKind: 'graph-compress' }; } catch (e) { }
    }
    return { compressed: xml, compressedKind: 'plain' };
  }

  function decompressSnapshotXml(snapshot) {
    const raw = snapshot && (snapshot.compressed_xml || snapshot.xml || snapshot.compressedXml);
    if (snapshot && snapshot.compressed_kind === 'graph-compress' && typeof Graph !== 'undefined' && Graph && typeof Graph.decompress === 'function') {
      try { return Graph.decompress(raw); } catch (e) { return null; }
    }
    return raw;
  }

  function restoreActivePageXml(xml) {
    if (typeof graph.__trellisHistoryTestRestore === 'function') {
      graph.__trellisHistoryTestRestore(xml);
      return;
    }
    const doc = mxUtils.parseXml(xml);
    const node = doc.documentElement;
    if (ui.editor && typeof ui.editor.setGraphXml === 'function') {
      ui.editor.setGraphXml(node);
      return;
    }
    if (typeof mxCodec !== 'undefined' && typeof mxGraphModel !== 'undefined') {
      const nextModel = new mxGraphModel();
      new mxCodec(node.ownerDocument).decode(node, nextModel);
      if (typeof model.setRoot === 'function') model.setRoot(nextModel.getRoot());
    }
  }

  function boundsFromXmlCellMap(map, ids) {
    let out = null;
    const idList = Array.isArray(ids) ? ids : null;
    if (idList) {
      for (let i = 0; i < idList.length; i++) {
        const entry = map && map.get && map.get(idList[i]);
        out = unionBounds(out, entry && entry.bounds);
      }
      return out;
    }
    if (map && typeof map.forEach === 'function') {
      map.forEach(function (entry, id) {
        if (id === '0' || id === '1') return;
        out = unionBounds(out, entry && entry.bounds);
      });
    }
    return out;
  }

  function boundsFromSnapshotDiff(previousXml, currentXml) {
    if (!previousXml || !currentXml) return null;
    const diff = diffSnapshotWithCurrent(previousXml, currentXml);
    const current = parseXmlCellMap(currentXml);
    let out = null;
    for (let i = 0; i < diff.added.length; i++) out = unionBounds(out, current.get(diff.added[i]) && current.get(diff.added[i]).bounds);
    for (let i = 0; i < diff.changed.length; i++) out = unionBounds(out, current.get(diff.changed[i]) && current.get(diff.changed[i]).bounds);
    for (let i = 0; i < diff.deleted.length; i++) out = unionBounds(out, diff.deleted[i] && diff.deleted[i].bounds);
    return out;
  }

  function computeHistoryViewTarget(meta, currentXml, previousXml) {
    const affectedIds = uniqueArray(meta && meta.affectedCellIds || []);
    let bounds = normalizeBounds(meta && meta.bounds);
    if (!bounds) bounds = boundsForCellIds(affectedIds);
    if (!bounds && previousXml && affectedIds.length) bounds = boundsFromXmlCellMap(parseXmlCellMap(previousXml), affectedIds);
    if (!bounds) bounds = boundsFromSnapshotDiff(previousXml, currentXml);
    if (!bounds) bounds = activeDiagramModelBounds();
    if (!bounds) bounds = boundsFromXmlCellMap(parseXmlCellMap(currentXml));
    bounds = normalizeBounds(bounds);
    const center = normalizeCenter(meta && meta.center) || centerOfBounds(bounds);
    const viewport = normalizeViewport(meta && meta.viewport) || captureViewportContext();
    return { bounds, center, viewport };
  }

  function extractAffectedCellIds(edit) {
    const ids = [];
    const changes = (edit && edit.changes) || [];
    for (let i = 0; i < changes.length; i++) {
      const ch = changes[i];
      const cell = ch && (ch.cell || ch.child || ch.previous || ch.terminal || null);
      if (cell && cell.id) ids.push(cell.id);
    }
    return uniqueArray(ids);
  }

  function extractChangeTypes(edit) {
    const out = [];
    const changes = (edit && edit.changes) || [];
    for (let i = 0; i < changes.length; i++) {
      const ch = changes[i];
      const name = ch && ch.constructor && ch.constructor.name;
      if (name) out.push(name);
    }
    return uniqueArray(out);
  }

  // -------------------- HistoryStore --------------------

  function createHistoryStore() {
    const bridge = (typeof window !== 'undefined') ? window.dbBridge : null;
    const store = { ready: false, disabled: false, warning: '', dbId: null };

    async function exec(sql, params) {
      return bridge.exec(store.dbId, sql, params || []);
    }

    async function query(sql, params) {
      const res = await bridge.query(store.dbId, sql, params || []);
      return (res && res.rows) || [];
    }

    async function init() {
      if (!bridge || typeof bridge.resolvePath !== 'function' || typeof bridge.open !== 'function') {
        store.disabled = true;
        store.warning = 'History storage is unavailable in this environment.';
        return store;
      }
      try {
        const resolved = await bridge.resolvePath({ dbName: HISTORY_DB_NAME, seedRelPath: null, createIfMissing: true });
        const opened = await bridge.open(resolved.dbPath, { readOnly: false, fileMustExist: false, pragma: { journal_mode: 'WAL', synchronous: 'NORMAL' } });
        store.dbId = opened.dbId;
        await exec('CREATE TABLE IF NOT EXISTS history_snapshots (snapshot_id TEXT PRIMARY KEY, diagram_id TEXT NOT NULL, hash TEXT NOT NULL, compressed_kind TEXT NOT NULL, compressed_xml TEXT NOT NULL, byte_size INTEGER NOT NULL, checksum TEXT NOT NULL, created_at INTEGER NOT NULL, snapshot_kind TEXT NOT NULL DEFAULT "full")');
        await exec('CREATE TABLE IF NOT EXISTS history_events (id TEXT PRIMARY KEY, diagram_id TEXT NOT NULL, timestamp INTEGER NOT NULL, category TEXT NOT NULL, action TEXT NOT NULL, origin TEXT NOT NULL, title TEXT NOT NULL, affected_cell_ids TEXT NOT NULL, change_types TEXT NOT NULL, counts_json TEXT NOT NULL, snapshot_id TEXT NOT NULL, parent_revision_id TEXT, restored_from_revision_id TEXT, tags_json TEXT NOT NULL, metadata_json TEXT NOT NULL, checkpoint INTEGER NOT NULL DEFAULT 0, diagram_hash TEXT NOT NULL, schema_version INTEGER NOT NULL)');
        await exec('CREATE INDEX IF NOT EXISTS idx_history_events_diagram_time ON history_events(diagram_id, timestamp)');
        await exec('CREATE INDEX IF NOT EXISTS idx_history_snapshots_diagram_hash ON history_snapshots(diagram_id, hash)');
        store.ready = true;
      } catch (e) {
        store.disabled = true;
        store.warning = 'History storage failed: ' + (e && e.message ? e.message : String(e));
      }
      return store;
    }

    async function getLatestRevision(diagramId) {
      if (!store.ready) return null;
      const rows = await query('SELECT * FROM history_events WHERE diagram_id = ? ORDER BY timestamp DESC LIMIT 1', [diagramId]);
      return rows[0] || null;
    }

    async function listRevisions(diagramId) {
      if (!store.ready) return [];
      const rows = await query('SELECT * FROM history_events WHERE diagram_id = ? ORDER BY timestamp ASC', [diagramId]);
      return rows.map(rowToRevision);
    }

    async function loadSnapshot(snapshotId) {
      if (!store.ready || !snapshotId) return null;
      const rows = await query('SELECT * FROM history_snapshots WHERE snapshot_id = ? LIMIT 1', [snapshotId]);
      return rows[0] || null;
    }

    async function recordRevision(revision, snapshot) {
      if (!store.ready) return false;
      await exec('INSERT OR IGNORE INTO history_snapshots (snapshot_id, diagram_id, hash, compressed_kind, compressed_xml, byte_size, checksum, created_at, snapshot_kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [snapshot.snapshotId, revision.diagramHistoryId, revision.diagramHash, snapshot.compressedKind, snapshot.compressedXml, snapshot.byteSize, snapshot.checksum, revision.timestamp, 'full']);
      await exec('INSERT INTO history_events (id, diagram_id, timestamp, category, action, origin, title, affected_cell_ids, change_types, counts_json, snapshot_id, parent_revision_id, restored_from_revision_id, tags_json, metadata_json, checkpoint, diagram_hash, schema_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [revision.id, revision.diagramHistoryId, revision.timestamp, revision.category, revision.action, revision.origin, revision.title, JSON.stringify(revision.affectedCellIds || []), JSON.stringify(revision.changeTypes || []), JSON.stringify(revision.counts || {}), revision.snapshotId, revision.parentRevisionId || null, revision.restoredFromRevisionId || null, JSON.stringify(revision.tags || []), JSON.stringify(revision), revision.checkpoint ? 1 : 0, revision.diagramHash, HISTORY_SCHEMA_VERSION]);
      await thinHistoryIfNeeded(revision.diagramHistoryId);
      return true;
    }

    async function thinHistoryIfNeeded(diagramId) {
      const rows = await query('SELECT e.id, e.snapshot_id, e.checkpoint, e.category, e.action, s.byte_size FROM history_events e JOIN history_snapshots s ON e.snapshot_id = s.snapshot_id WHERE e.diagram_id = ? ORDER BY e.timestamp ASC', [diagramId]);
      let total = rows.reduce(function (sum, row) { return sum + Number(row.byte_size || 0); }, 0);
      if (total <= HISTORY_RETENTION_BYTES) return;
      const protectedIds = new Set();
      for (let i = Math.max(0, rows.length - 100); i < rows.length; i++) protectedIds.add(rows[i].id);
      if (rows[0]) protectedIds.add(rows[0].id);
      if (rows[rows.length - 1]) protectedIds.add(rows[rows.length - 1].id);
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (row.checkpoint || row.category !== 'Diagram' || row.action === 'restore') protectedIds.add(row.id);
      }
      for (let i = 0; i < rows.length && total > HISTORY_RETENTION_BYTES; i++) {
        const row = rows[i];
        if (protectedIds.has(row.id)) continue;
        await exec('DELETE FROM history_events WHERE id = ?', [row.id]);
        await exec('DELETE FROM history_snapshots WHERE snapshot_id = ? AND NOT EXISTS (SELECT 1 FROM history_events WHERE snapshot_id = ?)', [row.snapshot_id, row.snapshot_id]);
        total -= Number(row.byte_size || 0);
      }
    }

    function rowToRevision(row) {
      const metadata = safeParseJson(row.metadata_json, {});
      metadata.id = row.id;
      metadata.timestamp = Number(row.timestamp);
      metadata.category = row.category;
      metadata.action = row.action;
      metadata.origin = row.origin;
      metadata.title = row.title;
      metadata.snapshotId = row.snapshot_id;
      metadata.parentRevisionId = row.parent_revision_id || null;
      metadata.restoredFromRevisionId = row.restored_from_revision_id || null;
      metadata.affectedCellIds = safeParseJson(row.affected_cell_ids, []);
      metadata.changeTypes = safeParseJson(row.change_types, []);
      metadata.tags = safeParseJson(row.tags_json, []);
      metadata.checkpoint = Number(row.checkpoint) === 1;
      metadata.diagramHash = row.diagram_hash;
      return metadata;
    }

    return {
      init,
      getLatestRevision,
      listRevisions,
      loadSnapshot,
      recordRevision,
      get ready() { return store.ready; },
      get disabled() { return store.disabled; },
      get warning() { return store.warning; }
    };
  }

  function safeParseJson(text, fallback) {
    try { return JSON.parse(text); } catch (e) { return fallback; }
  }

  // -------------------- HistoryRecorder --------------------

  function createHistoryRecorder(store) {
    const txStack = [];
    let pending = null;
    let settleTimer = null;
    let latestHash = null;
    let latestXml = null;
    let latestRevisionId = null;
    let recording = false;

    function normalizeMetadata(metadata) {
      const meta = actorMetadata(metadata || {});
      const category = HISTORY_CATEGORIES.indexOf(meta.category) >= 0 ? meta.category : 'Diagram';
      return {
        category,
        action: String(meta.action || 'change'),
        origin: String(meta.origin || 'drawio'),
        title: String(meta.title || category + ' change'),
        tags: uniqueArray(meta.tags || []),
        actorUserId: meta.actorUserId ? String(meta.actorUserId) : '',
        actorName: meta.actorName ? String(meta.actorName) : '',
        actorRole: meta.actorRole ? String(meta.actorRole) : '',
        affectedCellIds: uniqueArray(meta.affectedCellIds || []),
        changeTypes: uniqueArray(meta.changeTypes || []),
        bounds: normalizeBounds(meta.bounds),
        center: normalizeCenter(meta.center),
        viewport: normalizeViewport(meta.viewport),
        checkpoint: !!meta.checkpoint,
        restoredFromRevisionId: meta.restoredFromRevisionId || null,
        restoreAudit: meta.restoreAudit || null
      };
    }

    function mergePending(meta, edit) {
      const normalized = normalizeMetadata(meta);
      if (!pending) pending = normalized;
      else {
        if (pending.category === 'Diagram' && normalized.category !== 'Diagram') pending.category = normalized.category;
        if (pending.action === 'change' && normalized.action !== 'change') pending.action = normalized.action;
        if (!pending.title || pending.title === 'Diagram change') pending.title = normalized.title;
        pending.origin = pending.origin === 'drawio' ? normalized.origin : pending.origin;
        pending.actorUserId = pending.actorUserId || normalized.actorUserId;
        pending.actorName = pending.actorName || normalized.actorName;
        pending.actorRole = pending.actorRole || normalized.actorRole;
        pending.tags = uniqueArray((pending.tags || []).concat(normalized.tags || [], normalized.category));
        pending.bounds = unionBounds(pending.bounds, normalized.bounds);
        pending.center = normalizeCenter(normalized.center) || pending.center;
        pending.viewport = normalizeViewport(normalized.viewport) || pending.viewport;
        pending.checkpoint = pending.checkpoint || normalized.checkpoint;
        pending.restoredFromRevisionId = pending.restoredFromRevisionId || normalized.restoredFromRevisionId;
        pending.restoreAudit = pending.restoreAudit || normalized.restoreAudit;
      }
      pending.affectedCellIds = uniqueArray((pending.affectedCellIds || []).concat(normalized.affectedCellIds || [], extractAffectedCellIds(edit)));
      pending.changeTypes = uniqueArray((pending.changeTypes || []).concat(normalized.changeTypes || [], extractChangeTypes(edit)));
      scheduleStableRecord();
    }

    function recordModelChange(edit, capturedMetadata) {
      if (graph.__ccMapInternalChange || graph.__ccHistoryRestoring) return;
      const active = capturedMetadata || activeTransactionMetadata();
      mergePending(active || { category: 'Diagram', action: 'change', origin: 'drawio', title: inferTitleFromEdit(edit) }, edit);
    }

    function captureActiveTransactionMetadata() {
      return activeTransactionMetadata();
    }

    function activeTransactionMetadata() {
      if (!txStack.length) return null;
      const outer = Object.assign({}, txStack[0]);
      for (let i = 1; i < txStack.length; i++) {
        outer.tags = uniqueArray((outer.tags || []).concat(txStack[i].tags || [], txStack[i].category));
        outer.affectedCellIds = uniqueArray((outer.affectedCellIds || []).concat(txStack[i].affectedCellIds || []));
        outer.changeTypes = uniqueArray((outer.changeTypes || []).concat(txStack[i].changeTypes || []));
        outer.bounds = unionBounds(outer.bounds, txStack[i].bounds);
        outer.center = normalizeCenter(txStack[i].center) || outer.center;
        outer.viewport = normalizeViewport(txStack[i].viewport) || outer.viewport;
      }
      return outer;
    }

    function inferTitleFromEdit(edit) {
      const types = extractChangeTypes(edit);
      if (types.indexOf('mxChildChange') >= 0) return 'Diagram structure changed';
      if (types.indexOf('mxGeometryChange') >= 0) return 'Diagram layout changed';
      if (types.indexOf('mxStyleChange') >= 0) return 'Diagram style changed';
      if (types.indexOf('mxValueChange') >= 0) return 'Content changed';
      return 'Diagram changed';
    }

    function scheduleStableRecord() {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(function () {
        settleTimer = null;
        recordStableRevision(false);
      }, HISTORY_SETTLE_MS);
    }

    async function recordStableRevision(force) {
      if (recording) return;
      const meta = pending || normalizeMetadata({ category: 'System', action: 'baseline', origin: 'history', title: 'Opened diagram baseline' });
      pending = null;
      recording = true;
      try {
        const xml = serializeActivePageXml();
        const hash = hashString(xml);
        if (!force && latestHash === hash && !meta.checkpoint) return;
        const compressed = compressSnapshotXml(xml);
        const diagramId = getDiagramHistoryId();
        const snapshotId = makeHistoryId('snap');
        const viewTarget = computeHistoryViewTarget(meta, xml, latestXml);
        const revision = {
          id: makeHistoryId('rev'),
          timestamp: nowMs(),
          category: meta.category,
          tags: uniqueArray(meta.tags || []),
          action: meta.action,
          origin: meta.origin,
          title: meta.title,
          actorUserId: meta.actorUserId || '',
          actorName: meta.actorName || '',
          actorRole: meta.actorRole || '',
          affectedCellIds: uniqueArray(meta.affectedCellIds || []),
          changeTypes: uniqueArray(meta.changeTypes || []),
          bounds: viewTarget.bounds,
          center: viewTarget.center,
          viewport: viewTarget.viewport,
          counts: { affectedCells: uniqueArray(meta.affectedCellIds || []).length, changeTypes: uniqueArray(meta.changeTypes || []).length },
          snapshotId,
          parentRevisionId: latestRevisionId,
          restoredFromRevisionId: meta.restoredFromRevisionId || null,
          restoreAudit: meta.restoreAudit || null,
          diagramHistoryId: diagramId,
          diagramHash: hash,
          trellisVersion: '2.3.1',
          pluginVersion: 'history-mvp',
          schemaVersion: HISTORY_SCHEMA_VERSION,
          checkpoint: !!meta.checkpoint
        };
        const snapshot = { snapshotId, compressedXml: compressed.compressed, compressedKind: compressed.compressedKind, byteSize: String(compressed.compressed).length, checksum: hashString(compressed.compressed) };
        const saved = await store.recordRevision(revision, snapshot);
        if (saved) {
          latestHash = hash;
          latestXml = xml;
          latestRevisionId = revision.id;
          await refreshHistoryRevisions();
        }
      } catch (e) {
        graph.__ccHistoryWarning = 'History record failed: ' + (e && e.message ? e.message : String(e));
        updateHistoryUI();
      } finally {
        recording = false;
      }
    }

    function run(metadata, operation) {
      const normalized = normalizeMetadata(metadata);
      txStack.push(normalized);
      let result;
      try {
        result = typeof operation === 'function' ? operation() : undefined;
      } catch (e) {
        txStack.pop();
        throw e;
      }
      if (result && typeof result.then === 'function') {
        return result.finally(function () { txStack.pop(); });
      }
      txStack.pop();
      return result;
    }

    async function initializeBaseline() {
      await store.init();
      if (!store.ready) { updateHistoryUI(); return; }
      const diagramId = getDiagramHistoryId();
      const latest = await store.getLatestRevision(diagramId);
      if (latest) {
        latestHash = latest.diagram_hash;
        latestRevisionId = latest.id;
        try {
          const snapshot = await store.loadSnapshot(latest.snapshot_id);
          latestXml = decompressSnapshotXml(snapshot);
        } catch (e) { latestXml = null; }
        await refreshHistoryRevisions();
        return;
      }
      pending = normalizeMetadata({ category: 'System', action: 'baseline', origin: 'history', title: 'Opened diagram baseline' });
      await recordStableRevision(true);
    }

    function createCheckpoint(title) {
      pending = normalizeMetadata({ category: 'History', action: 'checkpoint', origin: 'history', title: title || 'Named checkpoint', checkpoint: true });
      return recordStableRevision(true);
    }

    async function recordRestore(restoredFromRevisionId, audit) {
      pending = normalizeMetadata({ category: 'History', action: 'restore', origin: 'history', title: 'Restored historical revision', restoredFromRevisionId, restoreAudit: cloneRestoreAudit(audit) });
      await recordStableRevision(true);
    }

    return { initializeBaseline, recordModelChange, captureActiveTransactionMetadata, run, createCheckpoint, recordRestore, recordStableRevision };
  }

  const historyStore = createHistoryStore();
  const historyRecorder = createHistoryRecorder(historyStore);

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

  function stampCreatedIfMissing(cell, tNow, edit) {
    if (!shouldStyleCell(cell)) return;
    if (getAttrMs(cell, ATTR_CREATED) == null) { setAttrMs(cell, ATTR_CREATED, tNow); stampActor(cell, 'created', edit); }
  }

  function stampEdited(cell, tNow, edit) {
    if (!shouldStyleCell(cell)) return;
    setAttrMs(cell, ATTR_EDITED, tNow);
    stampActor(cell, 'edited', edit);
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
        stampCreatedIfMissing(cell, tNow, edit);
        stampEdited(cell, tNow, edit);
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
          stampActor(child, 'created', edit);
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

  window.addEventListener('resize', function () {
    if (!panel) return;
    if (!isPanelVisible()) return;                                         // NEW (avoid 0x0 rect when hidden)
    readAndStorePanelSize();
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

  function resolveUserFilterId() {
    const filter = graph.__ccUserFilter || 'all';
    if (filter === 'all') return '';
    if (filter === 'current') return currentActorUserId();
    if (filter.indexOf('user:') === 0) return filter.substring(5);
    return '';
  }

  function filterCellsByUser(cells, mode) {
    const userId = resolveUserFilterId();
    if (!userId) return cells;
    const key = actorKey(mode);
    const fallbackKey = mode === MODE_CHANGE ? ATTR_CREATED_BY : '';
    return (cells || []).filter(function (cell) {
      return getAttrStr(cell, key) === userId || (!!fallbackKey && getAttrStr(cell, fallbackKey) === userId);
    });
  }

  function recomputeSliceRange(slice, mode) {
    let tMin = Infinity;
    let tMax = -Infinity;
    const inRange = (slice && slice.inRange) || [];
    for (let i = 0; i < inRange.length; i++) {
      const ts = getTimestampForMode(inRange[i], mode);
      if (ts == null) continue;
      if (ts < tMin) tMin = ts;
      if (ts > tMax) tMax = ts;
    }
    slice.tMin = tMin === Infinity ? null : tMin;
    slice.tMax = tMax === -Infinity ? null : tMax;
  }

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
    const userScopedCells = filterCellsByUser(scopeCells, mode);
    const userFilterActive = !!resolveUserFilterId();
    const userScopedSet = new Set(userScopedCells.map(c => c.id));
    const slice = filterCellsByTimeSlice(userScopedCells, mode);
    recomputeSliceRange(slice, mode);

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

        if (userFilterActive && !userScopedSet.has(cell.id)) {
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
  let historyToolbarButton = null; // CHANGE: retain the toolbar button so its active state can track the panel
  let modeSelect = null;
  let scopeSelect = null;
  let windowValueInput = null;
  let windowUnitSelect = null;
  let sortSelect = null;
  let userFilterSelect = null;
  let infoLabel = null;
  let prevBtn = null;
  let nextBtn = null;
  let listWrap = null;
  let historyFilterSelect = null;
  let historyRailWrap = null;
  let historyPreview = null;
  let historyStatus = null;
  let returnLatestBtn = null;
  let compareBtn = null;
  let restoreBtn = null;
  let checkpointBtn = null;
  let formatPanelState = null;
  let nativeFormatState = null;

  graph.__ccPanelVisible = false;

  graph.__ccPanelW = 340;                                                  // (px)
  graph.__ccPanelH = 320;                                                  // (px)

  function applyPanelSize() {
    if (!panel) return;
    panel.style.width = '100%';
    panel.style.height = '100%';
    if (formatPanelState) refreshChangeMapSidebarLayout();
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

    graph.__ccPanelW = clamp(r.width, 320, maxW);
    graph.__ccPanelH = clamp(r.height, 200, maxH);

    // Re-apply clamped values so it doesn't drift beyond bounds
    applyPanelSize();
  }

  function fireFormatWidthChanged() {
    if (!ui || typeof ui.fireEvent !== 'function') return false;
    if (typeof mxEventObject === 'undefined') return false;
    ui.fireEvent(new mxEventObject('formatWidthChanged'));
    return true;
  }

  function suspendNativeFormatRefresh() {
    if (nativeFormatState) return;
    const nativeFormat = ui && ui.format && !ui.formatWindow ? ui.format : null;
    if (!nativeFormat) return;
    nativeFormatState = {
      format: nativeFormat,
      refresh: nativeFormat.refresh,
      immediateRefresh: nativeFormat.immediateRefresh,
      clear: nativeFormat.clear
    };
    if (typeof nativeFormat.refresh === 'function') nativeFormat.refresh = function () { };
    if (typeof nativeFormat.immediateRefresh === 'function') nativeFormat.immediateRefresh = function () { };
    if (typeof nativeFormat.clear === 'function') nativeFormat.clear = function () { };
  }

  function restoreNativeFormatRefresh() {
    if (!nativeFormatState) return null;
    const state = nativeFormatState;
    nativeFormatState = null;
    state.format.refresh = state.refresh;
    state.format.immediateRefresh = state.immediateRefresh;
    state.format.clear = state.clear;
    return state.format;
  }

  function refreshChangeMapSidebarLayout() {
    const container = formatPanelState && formatPanelState.container;
    if (!container) return;
    const width = clamp(graph.__ccPanelW || 340, 320, Math.max(320, (window.innerWidth || 1200) - 40));
    graph.__ccPanelW = width;
    if (typeof ui.formatWidth !== 'undefined') ui.formatWidth = width;
    if (typeof ui.refresh === 'function') ui.refresh(true);
    container.style.width = String(width) + 'px';
    if (graph && typeof graph.sizeDidChange === 'function') graph.sizeDidChange();
    fireFormatWidthChanged();
  }

  function restoreFormatPanel() {
    if (!formatPanelState) return;
    const state = formatPanelState;
    formatPanelState = null;
    const nativeFormat = restoreNativeFormatRefresh();
    if (panel && panel.parentNode === state.container) panel.parentNode.removeChild(panel);
    while (state.container.firstChild) state.container.removeChild(state.container.firstChild);
    state.container.appendChild(state.fragment);
    if (typeof ui.formatWidth !== 'undefined') ui.formatWidth = state.formatWidth;
    state.container.style.cssText = state.cssText;
    if (typeof ui.refresh === 'function') ui.refresh(true);
    if (graph && typeof graph.sizeDidChange === 'function') graph.sizeDidChange();
    if (!fireFormatWidthChanged() && nativeFormat && typeof nativeFormat.refresh === 'function') nativeFormat.refresh();
  }


  function isPanelVisible() {
    return !!(panel && panel.style.display !== 'none' && graph.__ccPanelVisible);
  }

  function updateHistoryToolbarButton() {
    if (!historyToolbarButton) return;
    const active = isPanelVisible();
    historyToolbarButton.title = active ? 'Hide ChangeMap History' : 'Show ChangeMap History'; // CHANGE: align title with current panel state
    applyChangeMapButtonStyle(historyToolbarButton, 'open', { compact: true, active: active }); // CHANGE: reuse shared light-blue active open-button styling
    historyToolbarButton.setAttribute('aria-pressed', active ? 'true' : 'false'); // CHANGE: expose panel state to assistive tech
  }

  function showPanel() {
    createPanel();
    if (!panel) return;
    attachPanel();
    panel.style.display = '';
    graph.__ccPanelVisible = true;
    syncPanelFromState();
    updateNavUI();
    updateHistoryUI();
    updateHistoryToolbarButton(); // CHANGE: opening the panel activates the history button
  }

  function hidePanel() {
    if (!panel) return;
    panel.style.display = 'none';
    graph.__ccPanelVisible = false;
    clearHistoryCompareOverlays();
    restoreFormatPanel();
    updateHistoryToolbarButton(); // CHANGE: closing the panel clears the history button active state
  }

  function turnOffChangeMapForFileBoundary() {
    const shouldRestorePanel = !!(panel && (graph.__ccPanelVisible || formatPanelState));
    if (graph.__ccApplyTimer) { clearTimeout(graph.__ccApplyTimer); graph.__ccApplyTimer = null; }
    graph.__ccApplyToken++;
    graph.__ccApplyQueued = false;
    graph.__ccHistorySelectedId = null;
    graph.__ccFiltered = [];
    graph.__ccNavIndex = 0;
    if (graph.__ccMode !== MODE_NONE) clearMap();
    if (shouldRestorePanel) hidePanel();
    else clearHistoryCompareOverlays();
    graph.__ccPanelVisible = false;
    if (modeSelect) modeSelect.value = MODE_NONE;
    updateNavUI();
    updateHistoryUI();
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
      position: 'relative',
      background: '#ffffff',
      borderLeft: '1px solid #c7c7cc',
      padding: '10px',
      fontFamily: 'Arial, sans-serif',
      fontSize: '12px',
      minWidth: '320px',
      boxShadow: '-2px 0 8px rgba(0,0,0,0.10)',
      display: 'flex',              // ← ADD HERE
      flexDirection: 'column',      // ← ADD HERE
      gap: '6px',
      resize: 'horizontal',
      overflow: 'auto',
      boxSizing: 'border-box',
      minHeight: '200px',                                                  // NEW (recommended)
    });

    const title = makeEl('div', { fontWeight: '600', marginBottom: '8px' });
    title.textContent = 'ChangeMap History';
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

    panel.appendChild(makeRow('User', (userFilterSelect = makeSelect(userFilterOptions()))));

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
      flex: '0 0 auto',
      overflow: 'auto',
      maxHeight: '150px',
      minHeight: '70px'
    });
    panel.appendChild(listWrap);

    const historyTitle = makeEl('div', { fontWeight: '600', marginTop: '10px', borderTop: '1px solid #ddd', paddingTop: '8px' });
    historyTitle.textContent = 'Persistent History';
    panel.appendChild(historyTitle);

    historyStatus = makeEl('div', { color: '#666', fontSize: '11px', minHeight: '16px' });
    panel.appendChild(historyStatus);

    panel.appendChild(makeRow('Filter', (historyFilterSelect = makeSelect([{ value: 'all', label: 'All categories' }].concat(HISTORY_CATEGORIES.map(function (category) { return { value: category, label: category }; }))))));

    historyRailWrap = makeEl('div', {
      border: '1px solid #ddd',
      minHeight: '220px',
      flex: '1 1 auto',
      overflow: 'auto',
      padding: '8px',
      background: '#fafafa'
    });
    panel.appendChild(historyRailWrap);

    historyPreview = makeEl('div', { borderTop: '1px solid #ddd', paddingTop: '8px', minHeight: '90px', color: '#333' });
    panel.appendChild(historyPreview);

    const historyActions = makeEl('div', { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' });
    returnLatestBtn = makeEl('button', { padding: '5px 8px', cursor: 'pointer' });
    returnLatestBtn.textContent = 'Return latest';
    compareBtn = makeEl('button', { padding: '5px 8px', cursor: 'pointer' });
    compareBtn.textContent = 'Compare';
    restoreBtn = makeEl('button', { padding: '5px 8px', cursor: 'pointer' });
    restoreBtn.textContent = 'Restore';
    checkpointBtn = makeEl('button', { padding: '5px 8px', cursor: 'pointer' });
    checkpointBtn.textContent = 'Checkpoint';
    historyActions.appendChild(returnLatestBtn);
    historyActions.appendChild(compareBtn);
    historyActions.appendChild(restoreBtn);
    historyActions.appendChild(checkpointBtn);
    panel.appendChild(historyActions);

    wirePanelEvents();
    // Persist size after user finishes resizing (mouse/touch release)
    panel.addEventListener('mouseup', readAndStorePanelSize, true);
    panel.addEventListener('touchend', readAndStorePanelSize, true);

    attachPanel();
    panel.style.display = graph.__ccPanelVisible ? '' : 'none';
    updateHistoryToolbarButton(); // CHANGE: keep the toolbar button synced when the panel is first created

    applyPanelSize();

    syncPanelFromState();
    updateNavUI();
    updateHistoryUI();
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

  function userFilterOptions() {
    const options = [{ value: 'all', label: 'All users' }, { value: 'current', label: 'Current user' }];
    const users = usersApi();
    const list = users && typeof users.listUsers === 'function' ? users.listUsers() : [];
    for (let i = 0; i < list.length; i++) {
      if (list[i] && list[i].id) options.push({ value: 'user:' + list[i].id, label: list[i].name || list[i].id });
    }
    return options;
  }

  function refreshSelectOptions(select, options, selectedValue) {
    if (!select) return;
    const value = selectedValue || select.value || 'all';
    select.innerHTML = '';
    for (let i = 0; i < options.length; i++) {
      const opt = document.createElement('option');
      opt.value = options[i].value;
      opt.textContent = options[i].label;
      select.appendChild(opt);
    }
    select.value = options.some(function (option) { return option.value === value; }) ? value : 'all';
  }

  function attachPanel() {
    if (!graph.container || !panel) return;
    const formatContainer = ui && ui.formatContainer && !ui.formatWindow ? ui.formatContainer : null;
    if (formatContainer) {
      if (panel.parentNode === formatContainer && formatPanelState) { refreshChangeMapSidebarLayout(); return; }
      if (!formatPanelState) {
        const fragment = document.createDocumentFragment();
        while (formatContainer.firstChild) fragment.appendChild(formatContainer.firstChild);
        formatPanelState = { container: formatContainer, fragment, cssText: formatContainer.style.cssText, formatWidth: ui.formatWidth };
      }
      suspendNativeFormatRefresh();
      if (panel.parentNode && panel.parentNode !== formatContainer) panel.parentNode.removeChild(panel);
      panel.style.position = 'relative';
      panel.style.top = '';
      panel.style.right = '';
      panel.style.zIndex = '';
      formatContainer.appendChild(panel);
      refreshChangeMapSidebarLayout();
      return;
    }
    const parent = graph.container.parentNode || graph.container;
    if (parent && parent.style && (!parent.style.position || parent.style.position === 'static')) parent.style.position = 'relative';
    panel.style.position = 'absolute';
    panel.style.top = '0';
    panel.style.right = '0';
    panel.style.zIndex = String(GRAPH_OVERLAY_Z.CONTROL);
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

    userFilterSelect.addEventListener('change', function () {
      graph.__ccUserFilter = userFilterSelect.value || 'all';
      refreshIfEnabled();
      updateHistoryUI();
    });

    prevBtn.addEventListener('click', function () { navPrev(); });
    nextBtn.addEventListener('click', function () { navNext(); });
    historyFilterSelect.addEventListener('change', function () {
      graph.__ccHistoryFilter = historyFilterSelect.value;
      updateHistoryUI();
    });
    returnLatestBtn.addEventListener('click', function () {
      graph.__ccHistorySelectedId = null;
      clearHistoryCompareOverlays();
      updateHistoryUI();
    });
    compareBtn.addEventListener('click', function () { compareSelectedRevision(); });
    restoreBtn.addEventListener('click', function () { confirmRestoreSelectedRevision(); });
    checkpointBtn.addEventListener('click', function () { historyRecorder.createCheckpoint('Manual checkpoint'); });
  }

  function syncPanelFromState() {
    modeSelect.value = graph.__ccMode;
    scopeSelect.value = graph.__ccScope;
    windowValueInput.value = String(graph.__ccWindowValue);
    windowUnitSelect.value = graph.__ccWindowUnit;
    sortSelect.value = graph.__ccSortOrder;
    refreshSelectOptions(userFilterSelect, userFilterOptions(), graph.__ccUserFilter || 'all');
    graph.__ccUserFilter = userFilterSelect ? userFilterSelect.value : (graph.__ccUserFilter || 'all');
    if (historyFilterSelect) historyFilterSelect.value = graph.__ccHistoryFilter || 'all';
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

  async function refreshHistoryRevisions() {
    try {
      if (!historyStore.ready) return;
      graph.__ccHistoryRevisions = await historyStore.listRevisions(getDiagramHistoryId());
      updateHistoryUI();
    } catch (e) {
      graph.__ccHistoryWarning = 'History refresh failed: ' + (e && e.message ? e.message : String(e));
      updateHistoryUI();
    }
  }

  function selectedHistoryRevision() {
    const id = graph.__ccHistorySelectedId;
    const list = graph.__ccHistoryRevisions || [];
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function revisionMatchesUserFilter(rev) {
    const userId = resolveUserFilterId();
    if (!userId) return true;
    return !!(rev && rev.actorUserId === userId);
  }

  function updateHistoryUI() {
    if (!panel || !historyRailWrap || !historyPreview || !historyStatus) return;
    refreshSelectOptions(userFilterSelect, userFilterOptions(), graph.__ccUserFilter || 'all');
    graph.__ccUserFilter = userFilterSelect ? userFilterSelect.value : (graph.__ccUserFilter || 'all');
    const warning = graph.__ccHistoryWarning || historyStore.warning || '';
    historyStatus.textContent = warning || graph.__ccHistoryRestoreStatus || (historyStore.ready ? 'History is recording stable revisions.' : 'History storage is starting.');
    historyRailWrap.innerHTML = '';
    const filter = graph.__ccHistoryFilter || 'all';
    const all = graph.__ccHistoryRevisions || [];
    const categoryFiltered = filter === 'all' ? all : all.filter(function (rev) { return rev.category === filter || (rev.tags || []).indexOf(filter) >= 0; });
    const revisions = categoryFiltered.filter(revisionMatchesUserFilter);
    if (revisions.length === 0) {
      const empty = makeEl('div', { color: '#666' });
      empty.textContent = historyStore.ready ? 'No revisions match this filter.' : 'Persistent history unavailable.';
      historyRailWrap.appendChild(empty);
    }
    for (let i = 0; i < revisions.length; i++) {
      historyRailWrap.appendChild(createHistoryRevisionRow(revisions[i], i, revisions.length));
    }
    updateHistoryPreview();
  }

  function createHistoryRevisionRow(rev, index, total) {
    const active = rev.id === graph.__ccHistorySelectedId;
    const row = makeEl('div', {
      display: 'grid',
      gridTemplateColumns: '18px 1fr',
      columnGap: '7px',
      alignItems: 'start',
      cursor: 'pointer',
      padding: '4px',
      background: active ? 'rgba(26,115,232,0.10)' : 'transparent',
      borderRadius: '4px'
    });
    const tick = makeEl('div', { width: '10px', height: '10px', borderRadius: '5px', marginTop: '4px', background: rev.checkpoint ? '#f9ab00' : (rev.category === 'History' ? '#1a73e8' : '#5f6368') });
    const label = makeEl('div', { overflow: 'hidden' });
    const title = makeEl('div', { fontWeight: active ? '600' : '400', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });
    title.textContent = rev.title || rev.action || 'Revision';
    const meta = makeEl('div', { color: '#666', fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });
    meta.textContent = rev.category + ' - ' + formatTs(rev.timestamp) + (rev.actorName ? ' - ' + rev.actorName : '');
    label.appendChild(title);
    label.appendChild(meta);
    row.appendChild(tick);
    row.appendChild(label);
    row.title = (index + 1) + ' / ' + total + ' - ' + rev.category;
    row.addEventListener('click', function () { selectHistoryRevision(rev.id); });
    return row;
  }

  function updateHistoryPreview() {
    const rev = selectedHistoryRevision();
    if (!rev) {
      historyPreview.textContent = 'Select a revision to preview affected cells, compare, or restore.';
      compareBtn.disabled = true;
      restoreBtn.disabled = true;
      return;
    }
    compareBtn.disabled = false;
    restoreBtn.disabled = false;
    const affected = rev.affectedCellIds || [];
    historyPreview.innerHTML = '';
    const title = makeEl('div', { fontWeight: '600', marginBottom: '4px' });
    title.textContent = rev.title || 'Revision';
    const meta = makeEl('div', { color: '#555', fontSize: '11px', marginBottom: '4px' });
    meta.textContent = rev.category + ' - ' + formatTs(rev.timestamp) + (rev.actorName ? ' - ' + rev.actorName : '');
    const counts = makeEl('div', { color: '#333' });
    counts.textContent = String(affected.length) + ' affected cell' + (affected.length === 1 ? '' : 's') + (rev.restoredFromRevisionId ? ' - branch restore' : '');
    historyPreview.appendChild(title);
    historyPreview.appendChild(meta);
    historyPreview.appendChild(counts);
    const compareSummary = graph.__ccHistoryCompareSummary;
    if (compareSummary && compareSummary.revisionId === rev.id) {
      const diff = makeEl('div', { color: '#333', marginTop: '4px' });
      diff.textContent = 'Compare: ' + compareSummary.added + ' added, ' + compareSummary.changed + ' changed, ' + compareSummary.deleted + ' deleted';
      historyPreview.appendChild(diff);
    }
    const audit = graph.__ccHistoryLastRestoreAudit;
    if (audit && audit.sourceRevisionId === rev.id) {
      const status = makeEl('div', { color: audit.warnings && audit.warnings.length ? '#b06000' : '#188038', marginTop: '4px' });
      status.textContent = audit.warnings && audit.warnings.length ? 'Restore warning: ' + audit.warnings.map(function (entry) { return entry.message; }).join(' ') : 'Graph restored. External Trellis data was not rolled back.';
      historyPreview.appendChild(status);
    }
  }

  function historyBoundsAsRect(bounds) {
    const b = normalizeBounds(bounds);
    if (!b) return null;
    return (typeof mxRectangle !== 'undefined') ? new mxRectangle(b.x, b.y, b.width, b.height) : b;
  }

  function fitHistoryRevisionTarget(rev, cells) {
    const bounds = normalizeBounds(rev && rev.bounds) || boundsForCells(cells);
    const rect = historyBoundsAsRect(bounds);
    if (rect && typeof graph.fitWindow === 'function') { graph.fitWindow(rect, 16); return true; }
    if (rect && typeof graph.scrollRectToVisible === 'function') { graph.scrollRectToVisible(rect); return true; }
    if (cells && cells.length && graph.scrollCellToVisible) { graph.scrollCellToVisible(cells[0], true); return true; }
    return false;
  }

  function selectHistoryRevision(id) {
    graph.__ccHistorySelectedId = id;
    clearHistoryCompareOverlays();
    const rev = selectedHistoryRevision();
    const ids = (rev && rev.affectedCellIds) || [];
    const cells = ids.map(function (cellId) { return model.getCell && model.getCell(cellId); }).filter(Boolean);
    if (cells.length && graph.setSelectionCells) graph.setSelectionCells(cells);
    fitHistoryRevisionTarget(rev, cells);
    updateHistoryUI();
  }

  function clearHistoryCompareOverlays() {
    const overlays = graph.__ccHistoryCompareOverlays || [];
    for (let i = 0; i < overlays.length; i++) {
      const node = overlays[i];
      if (node && node.parentNode) node.parentNode.removeChild(node);
    }
    graph.__ccHistoryCompareOverlays = [];
    graph.__ccHistoryCompareSummary = null;
    fireHistoryLifecycleEvent(HISTORY_EVENT_COMPARE_CLEARED, {});
  }

  function overlayHost() {
    return (graph.container && graph.container.parentNode) || graph.container || document.body;
  }

  function addCompareOverlay(bounds, label, color, dashed) {
    if (!bounds) return;
    const div = makeEl('div', {
      position: 'absolute',
      left: String(Math.round(bounds.x)) + 'px',
      top: String(Math.round(bounds.y)) + 'px',
      width: String(Math.max(8, Math.round(bounds.width))) + 'px',
      height: String(Math.max(8, Math.round(bounds.height))) + 'px',
      border: '2px ' + (dashed ? 'dashed' : 'solid') + ' ' + color,
      background: dashed ? 'rgba(217,48,37,0.08)' : 'rgba(26,115,232,0.08)',
      pointerEvents: 'none',
      zIndex: String(GRAPH_OVERLAY_Z.ANNOTATION),
      boxSizing: 'border-box'
    });
    if (label) div.title = label;
    overlayHost().appendChild(div);
    graph.__ccHistoryCompareOverlays.push(div);
  }

  function cellBoundsForOverlay(cell) {
    const state = graph.view && graph.view.getState && graph.view.getState(cell);
    if (state) return { x: state.x, y: state.y, width: state.width, height: state.height };
    const geo = cell && cell.geometry;
    if (!geo) return null;
    return { x: geo.x || 0, y: geo.y || 0, width: geo.width || 40, height: geo.height || 24 };
  }

  async function compareSelectedRevision() {
    const rev = selectedHistoryRevision();
    if (!rev) return;
    clearHistoryCompareOverlays();
    const snapshot = await historyStore.loadSnapshot(rev.snapshotId);
    if (!snapshot) return;
    const historicalXml = decompressSnapshotXml(snapshot);
    if (!historicalXml) { graph.__ccHistoryWarning = 'History snapshot is unreadable.'; updateHistoryUI(); return; }
    const diff = diffSnapshotWithCurrent(historicalXml, serializeActivePageXml());
    graph.__ccHistoryCompareSummary = { revisionId: rev.id, added: diff.added.length, changed: diff.changed.length, deleted: diff.deleted.length };
    for (let i = 0; i < diff.added.length; i++) {
      const cell = model.getCell && model.getCell(diff.added[i]);
      if (cell) addCompareOverlay(cellBoundsForOverlay(cell), 'Added: ' + diff.added[i], '#188038', false);
    }
    for (let i = 0; i < diff.changed.length; i++) {
      const cell = model.getCell && model.getCell(diff.changed[i]);
      if (cell) addCompareOverlay(cellBoundsForOverlay(cell), 'Changed: ' + diff.changed[i], '#1a73e8', false);
    }
    for (let i = 0; i < diff.deleted.length; i++) {
      const ghost = diff.deleted[i];
      addCompareOverlay(ghost.bounds, 'Deleted: ' + ghost.id, '#d93025', true);
    }
    updateHistoryPreview();
  }

  function diffSnapshotWithCurrent(historicalXml, currentXml) {
    const historical = parseXmlCellMap(historicalXml);
    const current = parseXmlCellMap(currentXml);
    const added = [];
    const changed = [];
    const deleted = [];
    historical.forEach(function (oldEntry, id) {
      if (id === '0' || id === '1') return;
      const cur = current.get(id);
      if (!cur) deleted.push({ id, bounds: oldEntry.bounds });
      else if (oldEntry.signature !== cur.signature) changed.push(id);
    });
    current.forEach(function (_entry, id) {
      if (id === '0' || id === '1') return;
      if (!historical.has(id)) added.push(id);
    });
    return { added, changed, deleted };
  }

  function parseXmlCellMap(xml) {
    const out = new Map();
    try {
      const doc = mxUtils.parseXml(xml);
      const cells = doc.getElementsByTagName('mxCell');
      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        const id = cell.getAttribute('id');
        if (!id) continue;
        const geo = cell.getElementsByTagName('mxGeometry')[0];
        const localBounds = geo ? normalizeBounds({ x: geo.getAttribute('x') || 0, y: geo.getAttribute('y') || 0, width: geo.getAttribute('width') || 40, height: geo.getAttribute('height') || 24 }) : null;
        out.set(id, { id, parentId: cell.getAttribute('parent') || null, signature: cell.outerHTML || mxUtils.getXml(cell), localBounds, bounds: localBounds });
      }
      const offsets = new Map();
      function offsetFor(id) {
        if (!id || offsets.has(id)) return offsets.get(id) || { x: 0, y: 0 };
        const entry = out.get(id);
        if (!entry) return { x: 0, y: 0 };
        const parentOffset = offsetFor(entry.parentId);
        const local = normalizeBounds(entry.localBounds);
        const offset = { x: parentOffset.x + (local ? local.x : 0), y: parentOffset.y + (local ? local.y : 0) };
        offsets.set(id, offset);
        return offset;
      }
      out.forEach(function (entry) {
        const local = normalizeBounds(entry.localBounds);
        if (!local) { entry.bounds = null; return; }
        const parentOffset = offsetFor(entry.parentId);
        entry.bounds = normalizeBounds({ x: parentOffset.x + local.x, y: parentOffset.y + local.y, width: local.width, height: local.height });
      });
    } catch (e) { }
    return out;
  }

  function confirmRestoreSelectedRevision() {
    const rev = selectedHistoryRevision();
    if (!rev) return;
    const message = 'Restore "' + (rev.title || rev.id) + '" from ' + formatTs(rev.timestamp) + '?\n\nThe current state will be saved first and native undo/redo will be cleared.';
    if (typeof window.confirm === 'function' && !window.confirm(message)) return;
    restoreSelectedRevision(rev);
  }

  async function restoreSelectedRevision(rev) {
    const snapshot = await historyStore.loadSnapshot(rev.snapshotId);
    clearHistoryCompareOverlays();
    graph.__ccHistoryWarning = '';
    graph.__ccHistoryRestoreStatus = '';
    const beforeXml = serializeActivePageXml();
    const audit = createRestoreAudit(rev, hashString(beforeXml));
    graph.__ccHistoryLastRestoreAudit = audit;
    if (!snapshot) {
      addRestoreAuditWarning(audit, 'missingSnapshot', 'History snapshot is missing.');
      audit.completedAt = nowMs();
      graph.__ccHistoryWarning = 'History snapshot is missing.';
      updateHistoryUI();
      return false;
    }
    const xml = decompressSnapshotXml(snapshot);
    if (!xml) {
      addRestoreAuditWarning(audit, 'unreadableSnapshot', 'History snapshot is unreadable.');
      audit.completedAt = nowMs();
      graph.__ccHistoryWarning = 'History snapshot is unreadable.';
      updateHistoryUI();
      return false;
    }
    await historyRecorder.recordStableRevision(true);
    graph.__ccHistoryRestoring = true;
    fireHistoryLifecycleEvent(HISTORY_EVENT_BEFORE_RESTORE, { revision: rev, audit });
    try {
      restoreActivePageXml(xml);
      audit.loadedHash = hashString(serializeActivePageXml());
      audit.loadedAt = nowMs();
      const undoManager = ui && ui.editor && ui.editor.undoManager;
      if (undoManager && typeof undoManager.clear === 'function') undoManager.clear();
      else if (undoManager && Array.isArray(undoManager.history)) { undoManager.history.length = 0; undoManager.indexOfNextAdd = 0; }
      if (typeof graph.refresh === 'function') graph.refresh();
      fireHistoryLifecycleEvent(HISTORY_EVENT_AFTER_RESTORE, { revision: rev, audit });
      await waitForHistoryRehydrateTick();
      audit.afterRehydrateHash = hashString(serializeActivePageXml());
      audit.rehydratedAt = nowMs();
      if (audit.loadedHash && audit.afterRehydrateHash && audit.loadedHash !== audit.afterRehydrateHash) {
        addRestoreAuditWarning(audit, 'rehydrationMutatedGraph', 'Plugin rehydration changed the graph after restore.');
      }
      audit.completedAt = nowMs();
      graph.__ccHistoryRestoreStatus = 'Graph restored. External Trellis data was not rolled back.';
      if (audit.warnings && audit.warnings.length) graph.__ccHistoryWarning = audit.warnings.map(function (entry) { return entry.message; }).join(' ');
      await historyRecorder.recordRestore(rev.id, audit);
      updateHistoryUI();
      return true;
    } catch (e) {
      addRestoreAuditWarning(audit, 'restoreFailed', e && e.message ? e.message : String(e));
      audit.completedAt = nowMs();
      graph.__ccHistoryWarning = 'History restore failed: ' + (e && e.message ? e.message : String(e));
      clearHistoryCompareOverlays();
      updateHistoryUI();
      return false;
    } finally {
      graph.__ccHistoryRestoring = false;
    }
  }

  const ChangeMapRenderer = {
    enable: enableMode,
    clear: clearMap,
    refresh: refreshIfEnabled,
    compare: compareSelectedRevision,
    clearCompare: clearHistoryCompareOverlays
  };

  const HistoryRail = {
    show: showPanel,
    hide: hidePanel,
    toggle: togglePanel,
    select: selectHistoryRevision,
    update: updateHistoryUI
  };

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
          stampActor(c, 'created');
          did = true;
        }
      }
    } finally {
      model.endUpdate();
    }

    return did;
  }

  // -------------------- Listen for model changes --------------------
  const DEBUG_CCMAP_CONSOLE = false;

  function debugLogEdit(edit, label) {
    if (!DEBUG_CCMAP_CONSOLE) return;
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
    if (graph.__trellisUsersRejecting || graph.__trellisUsersInternalChange) return;

    const edit = evt && evt.getProperty && evt.getProperty('edit');
    if (!edit || !edit.changes) return;
    if (edit.__trellisUsersRejected) return;
    const capturedMetadata = historyRecorder.captureActiveTransactionMetadata();
    const createdStamped = stampCreatedOnInsert(edit);
    const editedStamped = stampEditedFromSelectedIntersection(edit);
    if (createdStamped || editedStamped) scheduleRefreshIfEnabled();

    Promise.resolve().then(function () {
      if (graph.__ccMapInternalChange) return;
      if (graph.__trellisUsersRejecting || graph.__trellisUsersInternalChange) return;
      if (edit.__trellisUsersRejected) return;

      debugLogEdit(edit, 'CHANGE');
      historyRecorder.recordModelChange(edit, capturedMetadata);
    });
  });

  const selectionModel = graph.getSelectionModel && graph.getSelectionModel();
  if (selectionModel && typeof selectionModel.addListener === 'function') {
    selectionModel.addListener(mxEvent.CHANGE, function () { clearHistoryCompareOverlays(); });
  }

  function installHistoryPublicApi() {
    window.Trellis = window.Trellis || {};
    window.Trellis.history = window.Trellis.history || {};
    window.Trellis.history.run = historyRecorder.run;
    window.Trellis.history.createCheckpoint = historyRecorder.createCheckpoint;
    window.Trellis.history.list = function () { return (graph.__ccHistoryRevisions || []).slice(); };
    window.Trellis.history.isRestoring = function () { return !!graph.__ccHistoryRestoring; };
    window.Trellis.history.getLastRestoreAudit = function () { return cloneRestoreAudit(graph.__ccHistoryLastRestoreAudit); };
    window.Trellis.history.restore = function (revisionId) {
      const rev = (graph.__ccHistoryRevisions || []).find(function (entry) { return entry.id === revisionId; });
      return rev ? restoreSelectedRevision(rev) : Promise.resolve(false);
    };
    window.Trellis.history.events = {
      beforeRestore: HISTORY_EVENT_BEFORE_RESTORE,
      afterRestore: HISTORY_EVENT_AFTER_RESTORE,
      compareCleared: HISTORY_EVENT_COMPARE_CLEARED
    };
    window.Trellis.history._test = {
      getDiagramHistoryId,
      serializeActivePageXml,
      hashString,
      diffSnapshotWithCurrent,
      computeHistoryViewTarget,
      fitHistoryRevisionTarget,
      recordStableRevision: historyRecorder.recordStableRevision,
      components: {
        ChangeMapRenderer,
        HistoryRecorder: historyRecorder,
        HistoryStore: historyStore,
        HistoryRail
      }
    };
    graph.__trellisHistory = window.Trellis.history;
  }


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
          if (getAttrMs(c, ATTR_CREATED) == null) { setAttrMs(c, ATTR_CREATED, tNow); stampActor(c, 'created'); }
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
          if (getAttrMs(c, ATTR_CREATED) == null) { setAttrMs(c, ATTR_CREATED, tNow); stampActor(c, 'created'); }
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



  // -------------------- Context eligibility --------------------

  const MODULE_STYLE_KEYS = ['garden_module'];

  function hasStyleFlag(cell, key, expected) {
    if (!cell || !key) return false;
    const st = getStoredStyle(cell);
    const re = new RegExp('(?:^|;)' + key + '=' + expected + '(?:;|$)');
    return re.test(st);
  }

  function hasAttrOrStyleFlag(cell, key, expected) {
    return getAttrStr(cell, key) === expected || hasStyleFlag(cell, key, expected);
  }

  function isModuleCell(cell) {
    if (!cell) return false;

    for (let i = 0; i < MODULE_STYLE_KEYS.length; i++) {
      if (hasAttrOrStyleFlag(cell, MODULE_STYLE_KEYS[i], '1')) return true;
    }

    return false;
  }

  function isDiagramRootContext(cell) {
    if (!cell) return true; // NEW blank-canvas right click
    if (cell === model.getRoot()) return true; // NEW actual mxGraph model root

    const defaultParent = graph.getDefaultParent && graph.getDefaultParent(); // NEW usually the current page/layer
    if (cell === defaultParent) return true;

    return false;
  }

  function shouldShowCcMapContext(cell) {
    return isDiagramRootContext(cell) || isModuleCell(cell);
  }

  function installHistoryAction() {
    if (!ui || !ui.actions || typeof ui.actions.addAction !== 'function') return;
    if (ui.__trellisChangeMapHistoryActionInstalled) return;
    ui.__trellisChangeMapHistoryActionInstalled = true;
    ui.actions.addAction('trellisChangeMapHistory', function () { togglePanel(); });
    const menus = ui.menus;
    if (menus && typeof menus.get === 'function' && typeof menus.addMenuItems === 'function') {
      const viewMenu = menus.get('view') || menus.get('extras');
      if (viewMenu && !viewMenu.__trellisChangeMapHistoryPatched) {
        const oldFunct = viewMenu.funct;
        viewMenu.funct = function (menu, parent) {
          if (typeof oldFunct === 'function') oldFunct.apply(this, arguments);
          menus.addMenuItems(menu, ['-', 'trellisChangeMapHistory'], parent);
        };
        viewMenu.__trellisChangeMapHistoryPatched = true;
      }
    }
  }

  function installHistoryToolbarButton() {
    if (ui.__trellisChangeMapHistoryButtonInstalled || typeof document === 'undefined') return;
    const host = ui.toolbarContainer || ui.menubarContainer || ui.container || (graph.container && graph.container.parentNode);
    if (!host || typeof host.appendChild !== 'function') return;
    ui.__trellisChangeMapHistoryButtonInstalled = true;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'geButton trellis-changemap-history-button';
    button.title = 'ChangeMap History';
    button.textContent = 'History';
    button.style.cssText = 'margin:2px 4px;padding:3px 8px;cursor:pointer;';
    applyChangeMapButtonStyle(button, 'open', { compact: true });
    button.addEventListener('click', function () { togglePanel(); });
    host.appendChild(button);
    historyToolbarButton = button; // CHANGE: allow active styling updates after show/hide
    updateHistoryToolbarButton(); // CHANGE: initialize active state if the panel was already open
  }

  function installDiagramBoundaryReset() {
    const editor = ui && ui.editor;
    if (!editor || typeof editor.addListener !== 'function') return;
    if (ui.__trellisChangeMapFileBoundaryResetInstalled) return;
    ui.__trellisChangeMapFileBoundaryResetInstalled = true;
    editor.addListener('fileLoaded', function () {
      turnOffChangeMapForFileBoundary();
    });
  }



  // -------------------- Context menu --------------------

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
    id: "createdChangeMap",
    priority: 700,
    addItems: function (menu, cell, evt) {

    if (!shouldShowCcMapContext(cell)) return;

    const panelLabel = isPanelVisible() ? 'Hide ChangeMap History' : 'Show ChangeMap History';
    menu.addItem(panelLabel, null, function () {
      togglePanel();
    });
    }
  });

  installHistoryPublicApi();
  installHistoryAction();
  installHistoryToolbarButton();
  installDiagramBoundaryReset();
  historyRecorder.initializeBaseline();

});
