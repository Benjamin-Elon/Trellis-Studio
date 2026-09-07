/**
 * Roadmap runtime: semantic commands, personal graph projection, and canvas controls. // NEW
 * Dates belong to the document; scales and perspective belong to the viewer. // NEW
 * All user mutations pass through one undoable command boundary. // NEW
 */
Draw.loadPlugin(function (ui) {
    'use strict'; // NEW
    const graph = ui.editor && ui.editor.graph;
    const core = globalThis.TrellisRoadmapCore;
    if (!graph || !core || graph.__trellisRoadmapManager) return;
    const model = graph.getModel();
    const HEADER = 64, PAD = 12, PROCESS_HEADER = 28, OBJECT_HEIGHT = 26, GAP = 8;
    const TYPES = new Set(['module', 'board', 'process', 'object', 'timeframe', 'marker']);
    const STATUS_COLORS = { Planned: '#e2e8f0', Doing: '#bfdbfe', Blocked: '#fecaca', Done: '#bbf7d0' };
    const BOARD_STYLE = 'rounded=0;fillColor=#ffffff;strokeColor=#64748b;container=1;collapsible=0;recursiveResize=0;resizable=0;connectable=0;verticalAlign=top;align=left;spacing=6;whiteSpace=nowrap;overflow=hidden;';
    const PROCESS_STYLE = 'rounded=0;fillColor=#f8fafc;strokeColor=#94a3b8;container=1;collapsible=0;recursiveResize=0;resizable=0;movable=0;connectable=0;verticalAlign=top;align=left;spacing=5;whiteSpace=nowrap;overflow=hidden;fontSize=11;';
    const OBJECT_STYLE = 'rounded=1;arcSize=12;fillColor=#e2e8f0;strokeColor=#64748b;resizable=0;movable=0;connectable=0;whiteSpace=nowrap;overflow=hidden;spacing=3;fontSize=11;';
    const FRAME_STYLE = 'shape=trellisRoadmapTimeframe;fillColor=none;strokeColor=#cbd5e1;resizable=0;movable=0;connectable=0;verticalAlign=top;align=center;spacingTop=24;whiteSpace=nowrap;overflow=hidden;fontSize=10;';
    const preferences = new Map(), layouts = new Map();
    let projections = new WeakMap(), committingCanonical = false, fixedBoardMoves = new Set(); // NEW
    let commandDepth = 0, journal = null, gesture = null, refreshPending = false, boardRegistry = null, destroyed = false; // CHANGE
    let lastToday = core.todayDay(), overlay = null, dateHint = null, assignmentPicker = null, dialogError = null; // CHANGE
    const columnPanels = new WeakMap(); // NEW // CHANGE
    const baseGeometry = graph.getCellGeometry.bind(graph);
    const baseVisible = graph.isCellVisible ? graph.isCellVisible.bind(graph) : () => true;

    function attr(cell, name) { return cell && cell.value && cell.value.getAttribute ? cell.value.getAttribute(name) || '' : ''; }
    function id(cell) { return cell ? String(cell.id || (cell.getId && cell.getId()) || '') : ''; }
    function kind(cell) { return attr(cell, 'roadmap_type'); }
    function children(cell) { return model.getChildren ? model.getChildren(cell) || [] : Array.from({ length: model.getChildCount(cell) }, (_, i) => model.getChildAt(cell, i)); }
    function parent(cell) { return model.getParent ? model.getParent(cell) : cell && cell.parent; }
    function typedChildren(cell, type) { return children(cell).filter(child => kind(child) === type); }
    function ancestor(cell, type) { for (let c = cell; c; c = parent(c)) if (kind(c) === type) return c; return null; }
    function allCells() { const result = []; function walk(cell) { if (!cell) return; result.push(cell); children(cell).forEach(walk); } walk(model.getRoot()); return result; }
    function label(cell) { return attr(cell, 'label') || (typeof cell.value === 'string' ? cell.value : '') || ''; }
    function users() { return graph.__trellisUsers || (window.Trellis && window.Trellis.users); }
    function allowed(cell, action) { const api = users(); return !(graph.isCellLocked && graph.isCellLocked(cell)) && (!api || typeof api[action || 'canEditCell'] !== 'function' || api[action || 'canEditCell'](cell)); } // CHANGE
    function requireEdit(cell, action) { if (!cell || !allowed(cell, action)) throw new Error('You do not have permission to change this roadmap content.'); }
    function alertError(error) { const message = error && error.message || String(error); if (dialogError && dialogError.isConnected) { dialogError.textContent = message; return; } if (ui.alert) ui.alert(message); else if (mxUtils.alert) mxUtils.alert(message); }
    function parseIds(text) { try { const value = JSON.parse(text || '[]'); return Array.isArray(value) ? Array.from(new Set(value.map(String).filter(Boolean))) : []; } catch (_) { return []; } }
    function links(cell) { return new Set(attr(cell, 'linkedTo').split(',').filter(Boolean)); }

    /** Clone XML values so each metadata change participates in mxGraph undo. // NEW */
    function patch(cell, attributes) {
        let value = cell.value && cell.value.cloneNode ? cell.value.cloneNode(true) : mxUtils.createXmlDocument().createElement('object');
        if (!(cell.value && cell.value.cloneNode)) value.setAttribute('label', label(cell));
        let changed = false;
        Object.entries(attributes).forEach(([key, val]) => {
            const previous = value.getAttribute(key);
            if (val == null) { if (previous != null) { value.removeAttribute(key); changed = true; } }
            else if (String(val) !== previous) { value.setAttribute(key, String(val)); changed = true; }
        });
        if (changed) { const previous = cell.value; if (journal) journal.push(() => model.setValue(cell, previous)); model.setValue(cell, value); }
    }

    function setGeometry(cell, next) {
        const previous = model.getGeometry(cell);
        if (previous && ['x', 'y', 'width', 'height'].every(key => Math.abs(previous[key] - next[key]) < 0.001)) return;
        if (journal) journal.push(() => model.setGeometry(cell, previous));
        model.setGeometry(cell, next);
    }

    /** Nested commands share the caller's edit; failed commands reverse their own changes. // NEW */
    function command(fn) {
        if (commandDepth) return fn();
        const previousBounds = snapshotPeerBounds(); fixedBoardMoves = new Set(); // CHANGE
        model.beginUpdate();
        const currentEdit = model.currentEdit;
        const start = currentEdit && currentEdit.changes ? currentEdit.changes.length : 0;
        journal = [];
        commandDepth++;
        let result = null; // CHANGE: return only after synchronous permission inspection accepts the edit.
        try { result = fn(); resolveSavedCollisions(previousBounds); } // CHANGE
        catch (error) {
            result = null; // NEW
            const undo = journal; journal = null;
            if (currentEdit && currentEdit.changes) {
                const changes = currentEdit.changes.splice(start);
                for (let i = changes.length - 1; i >= 0; i--) changes[i].execute();
            } else { for (let i = undo.length - 1; i >= 0; i--) undo[i](); }
            alertError(error);
        } finally {
            journal = null; commandDepth--; invalidateLayouts(); committingCanonical = true; try { model.endUpdate(); } finally { committingCanonical = false; } refresh(); // CHANGE
        }
        return currentEdit && currentEdit.__trellisUsersRejected ? null : result; // NEW
    }

    function vertex(container, type, name, style, attributes) {
        const value = mxUtils.createXmlDocument().createElement('object');
        Object.entries(Object.assign({ label: name, roadmap_type: type }, attributes || {})).forEach(([key, val]) => value.setAttribute(key, String(val)));
        const cell = new mxCell(value, new mxGeometry(0, 0, 100, 30), style);
        cell.setVertex(true); if (cell.setConnectable) cell.setConnectable(false);
        model.add(container, cell);
        if (journal) journal.push(() => model.remove(cell));
        return cell;
    }

    function link(left, right) {
        const a = links(left), b = links(right); a.add(id(right)); b.add(id(left));
        patch(left, { linkedTo: Array.from(a).join(',') }); patch(right, { linkedTo: Array.from(b).join(',') });
    }

    function unlink(left, right) {
        if (!left || !right) return;
        const a = links(left), b = links(right); a.delete(id(right)); b.delete(id(left));
        patch(left, { linkedTo: Array.from(a).join(',') }); patch(right, { linkedTo: Array.from(b).join(',') });
    }

    function range(cell) {
        const start = core.parseDay(attr(cell, 'roadmap_start')), end = core.parseDay(attr(cell, 'roadmap_end'));
        if (start == null || end == null || end < start) throw new Error('Roadmap dates must be a valid inclusive ISO date range.');
        return { start, end };
    }

    function objectRecord(cell) { return Object.assign({ id: id(cell), cell, status: attr(cell, 'roadmap_status') || 'Planned', progress: Number(attr(cell, 'roadmap_progress')) || 0 }, range(cell)); }
    function processRecords(board) { return typedChildren(board, 'process').map(cell => Object.assign({ id: id(cell), cell, preferredRow: attr(cell, 'roadmap_preferred_row') === '' ? undefined : Number(attr(cell, 'roadmap_preferred_row')), objects: typedChildren(cell, 'object').map(objectRecord) }, range(cell))); }
    function getSummary(cell) { const objects = kind(cell) === 'object' ? [cell] : kind(cell) === 'process' ? typedChildren(cell, 'object') : typedChildren(cell, 'process').flatMap(process => typedChildren(process, 'object')); return core.progressSummary(objects.map(objectRecord)); }
    function summaryText(cell) { const result = getSummary(cell); return Math.round(result.percent) + '% · ' + result.blockedCount + ' blocked'; }

    /** Preference identity does not create a diagram ID as a side effect of viewing. // NEW */
    function preferenceKey(board) {
        const api = users(), user = api && api.getCurrentUser ? api.getCurrentUser() : null;
        const diagram = api && api.getDiagramKey ? api.getDiagramKey({ create: false }) : '';
        return ['trellis.roadmap.view.v1', diagram || attr(board, 'roadmap_document_key') || 'document', pageIdFor(board), user && user.id || 'anonymous', id(board)].join(':'); // CHANGE
    }

    /** Cell IDs are page-local; use the existing page identity without creating metadata. */ // NEW
    const isolatedPageIds = new WeakMap(); // NEW: export-only roots never enter live page state.
    function pageIdFor(cell) { // NEW
        let root = cell; while (parent(root)) root = parent(root); // NEW
        const page = (ui.pages || []).find(candidate => candidate.root === root); // NEW
        return isolatedPageIds.get(root) || page && (page.getId ? page.getId() : page.node && page.node.getAttribute('id')) || ''; // CHANGE
    } // NEW

    function getViewState(board) {
        const key = preferenceKey(board);
        if (!preferences.has(key)) {
            let value = null; try { value = JSON.parse(window.localStorage.getItem(key) || 'null'); } catch (_) { /* Local storage is optional. // NEW */ }
            const normalized = core.normalizeView(value); // CHANGE
            ['today', 'inception'].forEach(mode => { try { core.buildTimeline({ anchor: 0, minDay: -4000000, maxDay: 4000000, view: normalized[mode] }); } catch (_) { normalized[mode] = core.normalizeView()[mode]; } }); // NEW
            preferences.set(key, normalized);
        }
        return core.normalizeView(preferences.get(key));
    }

    function setViewState(board, changes) {
        if (kind(board) !== 'board') return null;
        const previous = getViewState(board), merged = Object.assign({}, previous, changes);
        ['today', 'inception'].forEach(mode => { merged[mode] = Object.assign({}, previous[mode], changes && changes[mode]); });
        const next = core.normalizeView(merged), key = preferenceKey(board);
        try { ['today', 'inception'].forEach(mode => core.buildTimeline({ anchor: 0, minDay: -4000000, maxDay: 4000000, view: next[mode] })); } catch (_) { return previous; } // NEW
        preferences.set(key, next); invalidateLayouts(); // CHANGE
        try { personalProjection(cellRoot(board)); } catch (error) { preferences.set(key, previous); invalidateLayouts(); alertError(error); return previous; } // NEW: an unresolved view arrangement does not partially apply preferences.
        try { window.localStorage.setItem(key, JSON.stringify(next)); } catch (_) { /* Keep the session view if persistence is unavailable. // NEW */ }
        invalidateLayouts(); refresh(); return getViewState(board); // CHANGE
    }

    function anchorFor(board, records, perspective) {
        return perspective === 'today' ? lastToday : records.length ? Math.min(...records.map(process => process.start)) : core.parseDay(attr(board, 'roadmap_created_date')) ?? lastToday;
    }

    /** Shared clipping for resting and gesture geometry; inclusive ends map to the next day. */ // NEW
    function projectRange(timeline, dates) { // NEW
        const start = Math.max(timeline.start, Math.min(timeline.end, dates.start)); // NEW
        const end = Math.max(start, Math.min(timeline.end, dates.end + 1)); // NEW
        return { x: PAD + core.dayToX(timeline, start), width: core.dayToX(timeline, end) - core.dayToX(timeline, start), visible: dates.end + 1 > timeline.start && dates.start < timeline.end, clipped: { left: dates.start < timeline.start, right: dates.end + 1 > timeline.end } }; // NEW
    } // NEW

    /** Pack against full dates; trimming changes horizontal projection only. // NEW */
    function calculateLayout(board, canonical) {
        const records = processRecords(board), state = canonical ? core.normalizeView({ perspective: 'inception' }) : getViewState(board);
        const anchor = anchorFor(board, records, state.perspective);
        const extent = records.flatMap(process => [process, ...process.objects]);
        const timeline = core.buildTimeline({ anchor, minDay: extent.length ? Math.min(...extent.map(item => item.start)) : anchor, maxDay: extent.length ? Math.max(...extent.map(item => item.end)) : anchor, view: state[state.perspective] });
        const geometry = new Map(), hidden = new Set(), clipped = new Map();
        const objectPacks = new Map();
        records.forEach(process => { const packed = core.packIntervals(process.objects.map(object => Object.assign({}, object, { height: OBJECT_HEIGHT }))); objectPacks.set(process.id, packed); process.height = PROCESS_HEADER + PAD + Math.max(OBJECT_HEIGHT, packed.height) + PAD; });
        const packedProcesses = core.packIntervals(records, { preferRows: true }); // CHANGE
        const height = HEADER + PAD * 2 + Math.max(70, packedProcesses.height);
        const visibleColumns = timeline.columns.filter(column => column.visible);
        const visibleStart = visibleColumns[0].start, visibleEnd = visibleColumns[visibleColumns.length - 1].end;
        function projected(item) {
            const result = projectRange(timeline, item); // CHANGE
            if (!result.visible) hidden.add(item.id); clipped.set(item.id, result.clipped); return result; // NEW
        }
        records.forEach(process => {
            const p = projected(process), placement = packedProcesses.placements.get(process.id);
            geometry.set(process.id, new mxGeometry(p.x, HEADER + PAD + placement.y, p.width, process.height));
            process.objects.forEach(object => {
                const o = projected(object), row = objectPacks.get(process.id).placements.get(object.id);
                geometry.set(object.id, new mxGeometry(o.x - p.x, PROCESS_HEADER + PAD + row.y, o.width, OBJECT_HEIGHT));
            });
        });
        typedChildren(board, 'timeframe').forEach((cell, index) => {
            const column = timeline.columns[index]; if (!column) return;
            geometry.set(id(cell), new mxGeometry(PAD + column.x, 0, column.width, height));
            if (!column.visible) hidden.add(id(cell));
        });
        typedChildren(board, 'marker').forEach(cell => geometry.set(id(cell), new mxGeometry(PAD + core.dayToX(timeline, anchor), HEADER - 10, 1, height - HEADER + 10)));
        const saved = model.getGeometry(board) || new mxGeometry(PAD, PAD, 1, 1);
        geometry.set(id(board), new mxGeometry(saved.x, saved.y, timeline.width + PAD * 2, height));
        return { board, records, timeline, geometry, hidden, clipped, width: timeline.width + PAD * 2, height, anchor, packedProcesses, perspective: state.perspective }; // CHANGE
    }

    function getLayout(board) {
        const key = preferenceKey(board), cached = layouts.get(board); // CHANGE
        if (!cached || cached.preferenceKey !== key) { const layout = calculateLayout(board, false); layout.preferenceKey = key; layouts.set(board, layout); } // NEW
        return layouts.get(board); // CHANGE
    }

    function saveCanonicalLayout(board) {
        const layout = calculateLayout(board, true);
        layout.geometry.forEach((geometry, cellId) => { const cell = model.getCell(cellId); if (cell) setGeometry(cell, geometry); });
        layouts.delete(board); // CHANGE

    }

    function invalidateLayouts() { layouts.clear(); projections = new WeakMap(); } // NEW
    function isModuleCell(cell) { return kind(cell) === 'module' || /(?:^|;)module=1(?:;|$)/.test(cell && cell.style || ''); } // NEW
    function peerMargin(cell) { const modules = graph.__trellisModules; return modules && modules.getModuleExternalMargin ? modules.getModuleExternalMargin(cell, 40) : 40; } // NEW
    function rectRecord(cell, geometry) { return { id: id(cell), x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height, margin: peerMargin(cell) }; } // NEW
    function peerPlan(cells, geometries, seeds, previous, fixed) { // NEW
        const modules = graph.__trellisModules; // NEW
        return core.planCollisions(cells.map(cell => rectRecord(cell, geometries.get(cell))), { seedIds: seeds.map(id), protectedIds: (fixed || seeds.slice(0, 1)).map(id), previous: new Map(cells.filter(cell => previous.has(cell)).map(cell => [id(cell), previous.get(cell)])), pushDelta: modules && modules.getPeerCollisionDelta }); // NEW
    } // NEW
    function applyPeerPlan(cells, plan, geometries) { cells.forEach(cell => { const result = plan.get(id(cell)), geometry = geometries.get(cell).clone(); geometry.x = result.x; geometry.y = result.y; geometries.set(cell, geometry); }); } // NEW
    function moduleBounds(cell, geometries) { // NEW
        const saved = geometries.get(cell) || model.getGeometry(cell); if (!saved) return null; // NEW
        const next = saved.clone(), modules = graph.__trellisModules, margin = modules && modules.getModuleMargin ? modules.getModuleMargin(cell) : PAD; // NEW
        next.width = 160; next.height = 100; const header = Number(baseCellStyle && baseCellStyle.call(graph, cell).startSize) || 0; // NEW
        children(cell).forEach(child => { const g = geometries.get(child) || model.getGeometry(child); if (g) { next.width = Math.max(next.width, g.x + g.width + margin); next.height = Math.max(next.height, g.y + g.height + margin + header); } }); return next; // NEW
    } // NEW
    function snapshotPeerBounds() { const result = new Map(allCells().filter(cell => kind(cell) === 'board' || isModuleCell(cell)).map(cell => [cell, model.getGeometry(cell)?.clone()]).filter(entry => entry[1])); result.parents = new Map(Array.from(result.keys()).map(cell => [cell, parent(cell)])); return result; } // CHANGE // NEW
    function differentBounds(a, b) { return !a || !b || ['x', 'y', 'width', 'height'].some(key => a[key] !== b[key]); } // NEW

    /** Plan every saved displacement before applying it; command rollback covers all mutations. */ // NEW
    function resolveSavedCollisions(previous) { // NEW
        const geometries = snapshotPeerBounds(), dirtyBoards = Array.from(geometries.keys()).filter(cell => kind(cell) === 'board' && differentBounds(previous.get(cell), geometries.get(cell))); // NEW
        const modules = new Set(dirtyBoards.map(parent)); // NEW
        previous.forEach((_geometry, cell) => { if (kind(cell) === 'board' && !model.getCell(id(cell))) { const oldParent = previous.parents.get(cell); if (oldParent && model.getCell(id(oldParent))) modules.add(oldParent); } }); // NEW
        modules.forEach(module => { const boards = typedChildren(module, 'board'); if (boards.length) applyPeerPlan(boards, peerPlan(boards, geometries, boards.filter(cell => dirtyBoards.includes(cell)), previous, boards.filter(cell => fixedBoardMoves.has(cell)).length ? boards.filter(cell => fixedBoardMoves.has(cell)) : undefined), geometries); const bounds = moduleBounds(module, geometries); if (bounds) geometries.set(module, bounds); }); // NEW
        const top = children(graph.getDefaultParent()).filter(cell => isModuleCell(cell) && geometries.has(cell)); // NEW
        const changed = top.filter(cell => differentBounds(previous.get(cell), geometries.get(cell))); // NEW
        if (changed.length) applyPeerPlan(top, peerPlan(top, geometries, changed, previous), geometries); // NEW
        const mutations = Array.from(geometries).filter(([cell, g]) => differentBounds(model.getGeometry(cell), g)); // NEW
        mutations.forEach(([cell]) => requireEdit(cell)); mutations.forEach(([cell, g]) => setGeometry(cell, g)); // NEW
    } // NEW

    /** Build one immutable display arrangement per root; no personal offset is stored in a cell. */ // NEW
    function personalProjection(root) { // NEW
        const roadmapBoards = collectDescendants([root]).filter(cell => kind(cell) === 'board'); // NEW
        const key = roadmapBoards.map(preferenceKey).join('|'), cached = projections.get(root); if (cached && cached.key === key) return cached.geometry; // NEW
        const geometry = new Map(), previous = new Map(), modules = new Set(roadmapBoards.map(parent)); // NEW
        collectDescendants([root]).filter(cell => kind(cell) === 'board' || isModuleCell(cell)).forEach(cell => { const g = model.getGeometry(cell); if (g) { geometry.set(cell, g.clone()); previous.set(cell, g.clone()); } }); // NEW
        roadmapBoards.forEach(board => geometry.set(board, getLayout(board).geometry.get(id(board)).clone())); // NEW
        modules.forEach(module => { // NEW
            const boards = typedChildren(module, 'board'), changed = boards.filter(board => differentBounds(previous.get(board), geometry.get(board))); // NEW
            if (changed.length) applyPeerPlan(boards, peerPlan(boards, geometry, changed, previous), geometry); // NEW
            const bounds = moduleBounds(module, geometry); if (bounds) geometry.set(module, bounds); // NEW
        }); // NEW
        children(root).forEach(layer => { // NEW
            const peers = children(layer).filter(cell => isModuleCell(cell) && geometry.has(cell)), changed = peers.filter(cell => modules.has(cell) && differentBounds(previous.get(cell), geometry.get(cell))); // NEW
            if (changed.length) applyPeerPlan(peers, peerPlan(peers, geometry, changed, previous), geometry); // NEW
        }); // NEW
        projections.set(root, { key, geometry }); return geometry; // NEW
    } // NEW
    function cellRoot(cell) { let root = cell; while (parent(root)) root = parent(root); return root; } // NEW

    function nextName(container, type, prefix, initial, excluded) { // CHANGE
        const names = new Set(typedChildren(container, type).filter(cell => cell !== excluded).map(label)); let number = initial || 1; // CHANGE
        while (names.has(prefix + number)) number++;
        return prefix + number;
    }

    function makeProcess(board, name, start, end) { return vertex(board, 'process', name, PROCESS_STYLE, { roadmap_start: core.formatDay(start), roadmap_end: core.formatDay(end) }); }
    function makeObject(process, name, start, end) { return vertex(process, 'object', name, OBJECT_STYLE, { roadmap_start: core.formatDay(start), roadmap_end: core.formatDay(end), roadmap_status: 'Planned', roadmap_progress: '0' }); }

    function createBoard(moduleCell, role) {
        requireEdit(moduleCell, 'canAddCell');
        if (kind(moduleCell) !== 'module' && attr(moduleCell, 'moduleType') !== 'roadmap') throw new Error('Select a Roadmap Module.');
        const boards = typedChildren(moduleCell, 'board');
        const board = vertex(moduleCell, 'board', role === 'main' ? 'Main Roadmap' : nextName(moduleCell, 'board', 'Roadmap ', 2), BOARD_STYLE, {
            roadmap_role: role, roadmap_created_date: core.formatDay(lastToday), roadmap_document_key: attr(moduleCell, 'roadmap_document_key') || id(moduleCell) + '-' + Date.now().toString(36)
        });
        const previousBottom = boards.reduce((bottom, cell) => { const g = model.getGeometry(cell); return g ? Math.max(bottom, g.y + g.height + 70) : bottom; }, PAD);
        setGeometry(board, new mxGeometry(PAD, previousBottom, 1, 1));
        const process = makeProcess(board, 'Planning', lastToday, lastToday + 30);
        makeObject(process, 'First Step', lastToday, lastToday + 7);
        ['Past Year', 'Past Month', 'Past Week', 'This Week', 'Next Week', 'Next Month', 'Next Year', 'Future'].forEach((name, index) => vertex(board, 'timeframe', name, FRAME_STYLE, { roadmap_timeframe_index: index }));
        vertex(board, 'marker', '', 'fillColor=#dc2626;strokeColor=#dc2626;resizable=0;movable=0;selectable=0;connectable=0;');
        const garden = model.getCell(attr(moduleCell, 'roadmap_garden_module_id'));
        if (garden) allCells().filter(cell => attr(cell, 'trellis_role_garden_module_id') === id(garden) && attr(cell, 'trellis_role_user_id')).forEach(roleCell => link(board, roleCell));
        saveCanonicalLayout(board);
        return board;
    }

    function ensureMainRoadmapInRoadmapModule(moduleCell) {
        const existing = typedChildren(moduleCell, 'board').find(cell => attr(cell, 'roadmap_role') === 'main');
        return existing || command(() => createBoard(moduleCell, 'main'));
    }
    function createSecondaryRoadmapInRoadmapModule(moduleCell) { return command(() => createBoard(moduleCell, 'secondary')); }
    function findRoadmapModule(gardenCell) { const valid = cell => kind(cell) === 'module' && attr(cell, 'roadmap_garden_module_id') === id(gardenCell); const direct = model.getCell(attr(gardenCell, 'roadmap_module_id')); return valid(direct) ? direct : allCells().find(valid); } // CHANGE
    function listRoadmapsForGarden(gardenCell) { const moduleCell = findRoadmapModule(gardenCell); return moduleCell ? typedChildren(moduleCell, 'board').map(cell => ({ id: id(cell), name: label(cell), role: attr(cell, 'roadmap_role') })) : []; }

    function openBoard(board) {
        if (!board) return null;
        graph.setSelectionCell(board); refresh();
        const state = graph.view.getState(board), layout = getLayout(board), container = graph.container;
        if (state && container) {
            container.scrollLeft = Math.max(0, state.x + (PAD + core.dayToX(layout.timeline, layout.anchor)) * graph.view.scale - container.clientWidth / 4);
            container.scrollTop = Math.max(0, state.y - 65);
        } else if (graph.scrollCellToVisible) graph.scrollCellToVisible(board);
        return board;
    }

    function openRoadmapForGarden(gardenCell, roadmapId) {
        let moduleCell = findRoadmapModule(gardenCell);
        if (!moduleCell) { const api = graph.__trellisModules; if (!api || !api.ensureGardenRoadmapModule) { alertError('Roadmap companion creation is unavailable.'); return null; } moduleCell = api.ensureGardenRoadmapModule(gardenCell); }
        if (!moduleCell) return null;
        const board = roadmapId ? typedChildren(moduleCell, 'board').find(cell => id(cell) === String(roadmapId)) : ensureMainRoadmapInRoadmapModule(moduleCell);
        return openBoard(board);
    }

    function addProcess(board) { return command(() => { requireEdit(board, 'canAddCell'); const cell = makeProcess(board, nextName(board, 'process', 'Process ', 2), lastToday, lastToday + 30); saveCanonicalLayout(board); graph.setSelectionCell(cell); return cell; }); }
    function addObject(process) { return command(() => { requireEdit(process, 'canAddCell'); const dates = range(process); const cell = makeObject(process, nextName(process, 'object', 'Roadmap Object ', 2), dates.start, Math.min(dates.end, dates.start + 7)); saveCanonicalLayout(ancestor(process, 'board')); graph.setSelectionCell(cell); return cell; }); }

    function parseInputRange(changes, cell) {
        const current = range(cell), start = changes.startISO == null ? current.start : core.parseDay(changes.startISO), end = changes.endISO == null ? current.end : core.parseDay(changes.endISO);
        if (start == null || end == null || end < start) throw new Error('Choose valid start and end dates; the end must be on or after the start.');
        return { start, end };
    }

    function expandProcess(process) {
        const dates = range(process), objects = typedChildren(process, 'object').map(range);
        if (objects.length) patch(process, { roadmap_start: core.formatDay(Math.min(dates.start, ...objects.map(item => item.start))), roadmap_end: core.formatDay(Math.max(dates.end, ...objects.map(item => item.end))) });
    }

    function editProcess(process, changes) {
        return command(() => {
            requireEdit(process); if (kind(process) !== 'process') throw new Error('Select a process.');
            const dates = parseInputRange(changes, process), objects = typedChildren(process, 'object').map(range);
            if (objects.length) { dates.start = Math.min(dates.start, ...objects.map(item => item.start)); dates.end = Math.max(dates.end, ...objects.map(item => item.end)); }
            patch(process, { label: changes.name == null ? label(process) : String(changes.name).trim() || 'Process', roadmap_start: core.formatDay(dates.start), roadmap_end: core.formatDay(dates.end) });
            saveCanonicalLayout(ancestor(process, 'board')); return process;
        });
    }

    function editObject(cell, changes) {
        return command(() => {
            requireEdit(cell); if (kind(cell) !== 'object') throw new Error('Select a roadmap object.');
            const dates = parseInputRange(changes, cell), previous = objectRecord(cell);
            const status = core.transitionStatus(previous, changes.status || previous.status);
            if (changes.progress != null && status.status === 'Doing') {
                const progress = Number(changes.progress); if (!Number.isInteger(progress) || progress < 0 || progress > 100) throw new Error('Doing progress must be a whole percentage from 0 to 100.'); status.progress = progress;
            }
            patch(cell, { label: changes.name == null ? label(cell) : String(changes.name).trim() || 'Roadmap Object', roadmap_start: core.formatDay(dates.start), roadmap_end: core.formatDay(dates.end), roadmap_status: status.status, roadmap_progress: status.progress, roadmap_notes: changes.notes == null ? attr(cell, 'roadmap_notes') : String(changes.notes) });
            const style = String(cell.style || OBJECT_STYLE).replace(/fillColor=[^;]*;/, 'fillColor=' + STATUS_COLORS[status.status] + ';');
            if (model.setStyle) model.setStyle(cell, style);
            expandProcess(parent(cell)); saveCanonicalLayout(ancestor(cell, 'board')); return cell;
        });
    }

    /** Remove selected descendants so a native container move never shifts them twice. */ // NEW
    function moveRoots(cells) { const selected = new Set(cells || []); return Array.from(selected).filter(cell => { for (let p = parent(cell); p; p = parent(p)) if (selected.has(p)) return false; return true; }); } // NEW

    /** Read-only transfer validation is repeated after any membership dialog. */ // NEW
    function planMove(cells, target, options) { // NEW
        const roots = moveRoots(cells), o = options || {}, boards = new Set(roots.map(cell => ancestor(cell, 'board'))); // NEW
        if (!roots.length || boards.size !== 1 || !Array.from(boards)[0] || roots.some(cell => !['object', 'process'].includes(kind(cell)))) throw new Error('Move processes or objects from one project at a time.'); // NEW
        const sourceBoard = Array.from(boards)[0], destinationBoard = target ? ancestor(target, 'board') : sourceBoard; // NEW
        if (!destinationBoard || parent(destinationBoard) !== parent(sourceBoard)) throw new Error('Move content only between projects in the same Roadmap Module.'); // NEW
        roots.forEach(cell => { requireEdit(cell); if (target && kind(target) !== (kind(cell) === 'object' ? 'process' : 'board')) throw new Error('Objects belong to processes; processes belong to projects.'); if (target && parent(cell) !== target) { if (!o.clone) requireEdit(cell, 'canDeleteCell'); requireEdit(target, 'canAddCell'); } }); // NEW
        const contents = collectDescendants(roots).filter(cell => ['object', 'process'].includes(kind(cell))); contents.forEach(cell => requireEdit(cell)); // NEW
        const crossProject = destinationBoard !== sourceBoard, objects = contents.filter(cell => kind(cell) === 'object'); // NEW
        const sourceRoles = new Set(roleRoster(sourceBoard).map(role => String(role.id))), destinationRoles = new Set(roleRoster(destinationBoard).map(role => String(role.id))); // NEW
        const missing = crossProject ? Array.from(new Set(objects.flatMap(cell => parseIds(attr(cell, 'roadmap_assignee_role_ids_json'))).filter(roleId => sourceRoles.has(roleId) && !destinationRoles.has(roleId)))) : []; // NEW
        const signature = JSON.stringify([roots.map(cell => [id(cell), id(parent(cell))]), contents.map(cell => [id(cell), attr(cell, 'roadmap_start'), attr(cell, 'roadmap_end'), attr(cell, 'roadmap_assignee_role_ids_json')]), id(destinationBoard), Array.from(sourceRoles).sort(), Array.from(destinationRoles).sort()]); // NEW
        if (o.expectedSignature && signature !== o.expectedSignature) throw new Error('The selection or membership changed. Please drag again.'); // NEW
        const days = crossProject ? 0 : Number(o.days || 0); if (!Number.isInteger(days)) throw new Error('Move by whole calendar days.'); // NEW
        contents.forEach(cell => { const dates = range(cell); core.formatDay(dates.start + days); core.formatDay(dates.end + days); }); // NEW
        return { roots, contents, objects, sourceBoard, destinationBoard, crossProject, sourceRoles, destinationRoles, missing, signature, days }; // NEW
    } // NEW

    /** Native movement commits semantic data, parenting and navigation in one edit. */ // NEW
    function moveContent(cells, target, options) { // NEW
        return command(() => { // NEW
            const o = options || {}, plan = planMove(cells, target, o); // NEW
            if (plan.missing.length && o.linkMissingAssignees == null) throw new Error('Choose how to handle the missing destination assignees.'); // NEW
            if (plan.missing.length && o.linkMissingAssignees) { requireEdit(plan.destinationBoard, 'canManageAccess'); plan.missing.forEach(roleId => { link(plan.destinationBoard, model.getCell(roleId)); plan.destinationRoles.add(roleId); }); } // NEW
            plan.contents.forEach(cell => { const dates = range(cell); if (plan.days) patch(cell, { roadmap_start: core.formatDay(dates.start + plan.days), roadmap_end: core.formatDay(dates.end + plan.days) }); }); // NEW
            plan.roots.forEach(cell => { if (target && target !== parent(cell)) model.add(target, cell); if (kind(cell) === 'process' && Number.isInteger(o.preferredRow)) patch(cell, { roadmap_preferred_row: Math.max(0, o.preferredRow) }); }); // NEW
            if (plan.crossProject) plan.objects.forEach(cell => { // NEW
                patch(cell, { roadmap_assignee_role_ids_json: JSON.stringify(parseIds(attr(cell, 'roadmap_assignee_role_ids_json')).filter(roleId => plan.sourceRoles.has(roleId) && plan.destinationRoles.has(roleId))) }); // NEW
                linkedTasks(cell).forEach(task => patch(task, { roadmap_source_board_id: id(plan.destinationBoard) })); // NEW: navigation moves; provenance names remain snapshots.
            }); // NEW
            new Set(plan.objects.map(parent)).forEach(expandProcess); // NEW
            new Set([plan.sourceBoard, plan.destinationBoard]).forEach(saveCanonicalLayout); return plan.roots; // NEW
        }); // NEW
    } // NEW

    /** Validate every status transition before making any bulk mutation. */ // NEW
    function setObjectStatuses(cells, status) { // NEW
        return command(() => { // NEW
            const objects = Array.from(new Set(cells || [])); if (!objects.length || objects.some(cell => kind(cell) !== 'object')) throw new Error('Select roadmap objects.'); // NEW
            const conflicts = []; objects.forEach(cell => { requireEdit(cell); try { core.transitionStatus(objectRecord(cell), status); } catch (_) { conflicts.push(label(cell)); } }); // NEW
            if (conflicts.length) throw new Error('Cannot change the selected status for: ' + conflicts.join(', ')); // NEW
            objects.forEach(cell => editObject(cell, { status })); return objects; // NEW
        }); // NEW
    } // NEW

    function setObjectAssignments(cells, ids) { return command(() => { const objects = Array.from(new Set(cells || [])); if (!objects.length || objects.some(cell => kind(cell) !== 'object')) throw new Error('Select roadmap objects.'); objects.forEach(cell => setAssignments(cell, ids)); return objects; }); } // NEW

    function shiftObjects(cells, days) {
        return command(() => {
            const board = cells.length && ancestor(cells[0], 'board');
            if (!Number.isInteger(days) || !board || cells.some(cell => kind(cell) !== 'object' || ancestor(cell, 'board') !== board)) throw new Error('Select roadmap objects within one roadmap to move dates together.');
            cells.forEach(cell => requireEdit(cell));
            cells.forEach(cell => { const dates = range(cell); patch(cell, { roadmap_start: core.formatDay(dates.start + days), roadmap_end: core.formatDay(dates.end + days) }); });
            new Set(cells.map(parent)).forEach(expandProcess); saveCanonicalLayout(board); return cells;
        });
    }

    function roleRoster(board) {
        const taskApi = graph.__trellisTaskManager;
        if (taskApi && taskApi.getBoardRoleRoster) return taskApi.getBoardRoleRoster(board);
        return Array.from(links(board)).map(roleId => model.getCell(roleId)).filter(cell => cell && links(cell).has(id(board)) && /role_card=1/.test(cell.style || '')).map(cell => ({ id: id(cell), name: label(cell), cell, eligible: true })); // CHANGE
    }

    function setAssignments(cell, ids) { return command(() => { requireEdit(cell); const valid = new Set(roleRoster(ancestor(cell, 'board')).map(role => role.id)); const previous = new Set(parseIds(attr(cell, 'roadmap_assignee_role_ids_json'))); const next = Array.from(new Set(ids.map(String))); if (next.some(roleId => !valid.has(roleId) && !previous.has(roleId))) throw new Error('Assignments must be roles linked to this roadmap.'); patch(cell, { roadmap_assignee_role_ids_json: JSON.stringify(next) }); return cell; }); }

    function taskModuleFor(moduleCell) { const cell = model.getCell(attr(moduleCell, 'roadmap_task_module_id')); return attr(cell, 'task_module') === '1' ? cell : null; } // CHANGE
    function linkedTasks(cell) { return parseIds(attr(cell, 'roadmap_task_ids_json')).map(taskId => model.getCell(taskId)).filter(task => task && attr(task, 'kanban_card') === '1'); }

    /** Task creation validates before creating companions; the surrounding command owns rollback. // NEW */
    function createTaskFromRoadmapObject(cell, options) {
        return command(() => {
            requireEdit(cell); if (kind(cell) !== 'object') throw new Error('Select a roadmap object.');
            const status = attr(cell, 'roadmap_status');
            if (status !== 'Planned' && status !== 'Doing') throw new Error('Only Planned or Doing objects can create tasks.');
            const o = options || {}, dates = parseInputRange(o, cell), bounds = range(cell), title = String(o.title == null ? label(cell) : o.title).trim();
            if (!title) throw new Error('Enter a task name.');
            if (dates.start < bounds.start || dates.end > bounds.end) throw new Error('Task dates must stay within the roadmap object’s date range.');
            const taskApi = graph.__trellisTaskManager, modules = graph.__trellisModules;
            if (!taskApi || !taskApi.createRoadmapTaskInBoard || !modules || !modules.ensureRoadmapTaskModule) throw new Error('Task creation is unavailable. Load Task Manager and Modules first.');
            const board = ancestor(cell, 'board'), moduleCell = parent(board);
            let taskModule = taskModuleFor(moduleCell), taskBoard = o.taskBoardId ? model.getCell(o.taskBoardId) : null;
            if (o.taskBoardId && (!taskModule || !taskBoard || parent(taskBoard) !== taskModule)) throw new Error('The selected Task Board is no longer available in the linked Task Module.');
            if (!taskBoard && taskModule && taskApi.listBoardsInTaskModule) { const main = taskApi.listBoardsInTaskModule(taskModule).find(board => board.role === 'main'); taskBoard = main && model.getCell(main.id); } // NEW: reuse existing Main without a normalizing model command.
            const sourceEligible = new Set(roleRoster(board).map(role => String(role.id))); // NEW
            const assigned = parseIds(attr(cell, 'roadmap_assignee_role_ids_json')).filter(roleId => sourceEligible.has(roleId)); // CHANGE
            const destinationRoles = new Set(taskBoard && taskApi.getBoardRoleRoster ? taskApi.getBoardRoleRoster(taskBoard).map(role => String(role.id)) : []); // NEW
            const missingBeforeCreation = assigned.filter(roleId => !destinationRoles.has(roleId)); // NEW
            if (missingBeforeCreation.length && o.linkMissingAssignees == null) throw new Error('Choose whether to link the missing assignees before creating the task.'); // NEW
            if (missingBeforeCreation.length && o.linkMissingAssignees === true) requireEdit(taskBoard || taskModule || moduleCell, 'canManageAccess'); // NEW
            if (taskBoard) requireEdit(taskBoard, 'canAddCell'); else requireEdit(taskModule || moduleCell, 'canAddCell');
            if (!taskModule) taskModule = modules.ensureRoadmapTaskModule(moduleCell, { insideUpdate: true, createMainBoard: true });
            if (!taskModule) throw new Error('Could not create the linked Task Module.');
            if (!taskBoard) { const result = taskApi.ensureMainBoardInTaskModule(taskModule); taskBoard = result && (result.board || result); }
            if (!taskBoard || !id(taskBoard)) throw new Error('Could not create the destination Main Task Board.');
            requireEdit(taskBoard, 'canAddCell');
            const eligible = new Set((taskApi.getBoardRoleRoster ? taskApi.getBoardRoleRoster(taskBoard) : []).map(role => String(role.id)));
            const missing = assigned.filter(roleId => !eligible.has(roleId));
            if (missing.length && o.linkMissingAssignees === true) {
                if (!taskApi.linkRoadmapAssigneesToBoard || !taskApi.linkRoadmapAssigneesToBoard(taskBoard, missing)) throw new Error('You do not have permission to link the missing assignees to this Task Board.');
                missing.forEach(roleId => eligible.add(roleId));
            } else if (missing.length && o.linkMissingAssignees == null) throw new Error('Choose whether to link the missing assignees before creating the task.');
            const task = taskApi.createRoadmapTaskInBoard(taskBoard, { title, startISO: core.formatDay(dates.start), endISO: core.formatDay(dates.end), workflowState: status === 'Doing' ? 'DOING' : 'TODO', assigneeRoleIds: assigned.filter(roleId => eligible.has(roleId)), roadmapObjectId: id(cell), roadmapBoardId: id(board), roadmapObjectName: label(cell), roadmapBoardName: label(board), insideUpdate: true });
            if (!task) throw new Error('Task creation failed.');
            patch(task, { roadmap_source_object_id: id(cell), roadmap_source_board_id: id(board), roadmap_source_object_name: label(cell), roadmap_source_board_name: label(board) });
            link(task, cell); patch(cell, { roadmap_task_ids_json: JSON.stringify([...linkedTasks(cell).map(id), id(task)]) });
            return task;
        });
    }

    function collectDescendants(cells) { const result = new Set(); function walk(cell) { if (!cell || result.has(cell)) return; result.add(cell); children(cell).forEach(walk); } cells.forEach(walk); return Array.from(result); }
    function tasksAffectedBy(cells) { return Array.from(new Set(collectDescendants(cells).filter(cell => kind(cell) === 'object').flatMap(linkedTasks))); }
    const baseRemoveCells = graph.removeCells;
    let deleting = false;

    /** Confirm once at the graph boundary; explicit API decisions remain synchronous and testable. // NEW */
    function deleteRoadmapCells(cells, decision) {
        if (decision === 'cancel') return null;
        const affected = tasksAffectedBy(cells);
        if (affected.length && decision !== 'keep' && decision !== 'delete') { showDeletionDialog(cells, affected); return null; }
        return command(() => {
            const removed = collectDescendants(cells), removedSet = new Set(removed);
            removed.filter(cell => !['timeframe', 'marker'].includes(kind(cell))).forEach(cell => requireEdit(cell, 'canDeleteCell')); // CHANGE
            if (decision === 'delete') affected.forEach(task => requireEdit(task, 'canDeleteCell'));
            const boards = new Set(removed.map(cell => ancestor(cell, 'board')).filter(board => board && !removedSet.has(board)));
            removed.filter(cell => kind(cell) === 'object').forEach(cell => linkedTasks(cell).forEach(task => { unlink(cell, task); patch(task, { roadmap_source_object_id: null, roadmap_source_board_id: null }); }));
            removed.filter(cell => attr(cell, 'kanban_card') === '1').forEach(task => {
                const source = model.getCell(attr(task, 'roadmap_source_object_id'));
                if (source && !removedSet.has(source)) { unlink(source, task); patch(source, { roadmap_task_ids_json: JSON.stringify(linkedTasks(source).filter(item => item !== task).map(id)) }); }
            });
            const modules = new Set(removed.map(cell => kind(cell) === 'board' ? parent(cell) : null).filter(Boolean)); // NEW
            removed.filter(cell => TYPES.has(kind(cell))).forEach(cell => links(cell).forEach(linkId => { const other = model.getCell(linkId); if (other && !removedSet.has(other)) unlink(cell, other); })); // NEW
            const targets = decision === 'delete' ? Array.from(new Set([...cells, ...affected])) : cells;
            deleting = true;
            let result;
            try { result = baseRemoveCells ? baseRemoveCells.call(graph, targets, true) : targets.map(cell => model.remove(cell)); }
            finally { deleting = false; }
            boards.forEach(saveCanonicalLayout); modules.forEach(moduleCell => { const remaining = typedChildren(moduleCell, 'board')[0]; if (remaining) saveCanonicalLayout(remaining); }); return result; // CHANGE
        });
    }

    if (baseRemoveCells) graph.removeCells = function (cells, includeEdges) {
        const selected = cells || graph.getSelectionCells();
        const relevant = collectDescendants(selected).some(cell => TYPES.has(kind(cell)) || attr(cell, 'roadmap_source_object_id'));
        return !deleting && relevant ? deleteRoadmapCells(selected) : baseRemoveCells.apply(this, arguments);
    };

    /** Clone planning values while postponing ID remapping until insertion assigns destination IDs. */ // NEW
    const pendingCopies = new WeakMap(); // NEW
    const baseCloneCells = graph.cloneCells; // NEW
    if (baseCloneCells) graph.cloneCells = function (cells) { // NEW
        const clones = baseCloneCells.apply(this, arguments), mapping = new Map(), originals = new Map(); // NEW
        function pair(source, copy) { if (!source || !copy) return; mapping.set(id(source), copy); originals.set(copy, source); children(source).forEach((child, index) => pair(child, children(copy)[index])); } // NEW
        (cells || []).forEach((cell, index) => pair(cell, clones[index])); // NEW
        if (!Array.from(originals.values()).some(source => TYPES.has(kind(source)) || attr(source, 'roadmap_module_id') || attr(source, 'roadmap_source_object_id'))) return clones; // NEW: ordinary role copies retain the existing Modules behavior.
        const group = { mapping, originals }; // NEW
        originals.forEach((source, copy) => { // NEW
            const type = kind(source); // NEW
            if (!TYPES.has(type) && !attr(source, 'roadmap_module_id') && !attr(source, 'roadmap_source_object_id') && !/role_card=1/.test(source.style || '')) return; // NEW
            const value = copy.value && copy.value.cloneNode ? copy.value.cloneNode(true) : null; if (!value) return; // NEW
            ['roadmap_task_ids_json', 'roadmap_source_object_id', 'roadmap_source_board_id'].forEach(key => value.removeAttribute(key)); // NEW
            if (type === 'board') { // NEW
                if (!mapping.has(id(parent(source)))) value.setAttribute('roadmap_role', 'secondary'); // NEW
                value.setAttribute('roadmap_document_key', Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)); // NEW
            } // NEW
            const liveTasks = new Set(linkedTasks(source).map(id)); // NEW
            value.setAttribute('linkedTo', Array.from(links(source)).filter(linkId => !liveTasks.has(linkId) && linkId !== attr(source, 'roadmap_source_object_id')).join(',')); // NEW
            copy.value = value; pendingCopies.set(copy, group); // NEW
        }); // NEW
        return clones; // NEW
    }; // NEW

    /** Finalize the entire inserted copy batch inside the caller's undoable edit. */ // NEW
    function finishCopies(cells) { // NEW
        const groups = new Set(collectDescendants(cells).map(cell => pendingCopies.get(cell)).filter(Boolean)); // NEW
        groups.forEach(group => { // NEW
            const inserted = Array.from(group.originals.keys()).filter(cell => model.getCell(id(cell)) === cell); // NEW
            const counterpartKeys = ['roadmap_module_id', 'roadmap_task_module_id', 'roadmap_garden_module_id', 'roadmap_team_module_id', 'trellis_task_module_id', 'trellis_team_module_id', 'trellis_garden_module_id', 'trellis_role_garden_module_id', 'trellis_role_team_module_id']; // NEW
            inserted.forEach(cell => { // NEW
                const source = group.originals.get(cell), updates = {}; // NEW
                counterpartKeys.forEach(key => { const oldId = attr(source, key); if (oldId) { const mapped = group.mapping.get(oldId); updates[key] = mapped && model.getCell(id(mapped)) === mapped ? id(mapped) : null; } }); // NEW
                const sourceBoard = ancestor(source, 'board'), eligible = new Set(sourceBoard ? roleRoster(sourceBoard).map(role => String(role.id)) : []); // NEW
                if (kind(cell) === 'object') updates.roadmap_assignee_role_ids_json = JSON.stringify(parseIds(attr(source, 'roadmap_assignee_role_ids_json')).filter(roleId => eligible.has(roleId)).map(roleId => id(group.mapping.get(roleId) || model.getCell(roleId)))); // NEW
                const retained = Array.from(links(source)).map(linkId => { // NEW
                    const target = group.mapping.get(linkId) || model.getCell(linkId); // NEW
                    if (!target || attr(target, 'kanban_card') === '1' || attr(source, 'kanban_card') === '1' && kind(target) === 'object') return null; // NEW
                    return group.mapping.has(linkId) || kind(cell) === 'board' && /role_card=1/.test(target.style || '') && links(model.getCell(linkId)).has(id(source)) ? id(target) : null; // NEW
                }).filter(Boolean); // NEW
                updates.linkedTo = retained.join(','); patch(cell, updates); // NEW
            }); // NEW
            inserted.filter(cell => kind(cell) === 'board').forEach(board => { // NEW
                links(board).forEach(roleId => { const role = model.getCell(roleId); if (role && /role_card=1/.test(role.style || '')) { requireEdit(board, 'canManageAccess'); link(board, role); } }); // NEW
                if (!group.mapping.has(id(parent(group.originals.get(board))))) patch(board, { label: nextName(parent(board), 'board', 'Roadmap ', 2, board) }); // CHANGE: whole-module copies preserve project names.
                saveCanonicalLayout(board); // NEW
            }); // NEW
            inserted.filter(cell => kind(cell) === 'object').forEach(cell => { const roster = new Set(roleRoster(ancestor(cell, 'board')).map(role => String(role.id))); patch(cell, { roadmap_assignee_role_ids_json: JSON.stringify(parseIds(attr(cell, 'roadmap_assignee_role_ids_json')).filter(roleId => roster.has(roleId))) }); }); // NEW
            inserted.forEach(cell => pendingCopies.delete(cell)); // NEW
        }); // NEW
    } // NEW
    const baseCellsAdded = graph.cellsAdded; // NEW
    if (baseCellsAdded) graph.cellsAdded = function (cells) { // NEW
        const args = arguments, receiver = this; // NEW
        if (!collectDescendants(cells || []).some(cell => pendingCopies.has(cell))) return baseCellsAdded.apply(this, args); // NEW
        return command(() => { const result = baseCellsAdded.apply(receiver, args); finishCopies(cells); return result; }); // NEW
    }; // NEW

    // Project personal geometry without mutating any stored cell or undo history. // NEW
    graph.getCellGeometry = function (cell) { // CHANGE
        if (committingCanonical || commandDepth || !cell) return baseGeometry(cell); // NEW: model-side Modules listeners must only observe canonical bounds.
        if (kind(cell) === 'board' || isModuleCell(cell)) { const projected = personalProjection(cellRoot(cell)).get(cell); if (projected) return projected.clone(); } // NEW
        const board = ancestor(cell, 'board'); // NEW
        if (board && !attr(board, 'roadmap_export_snapshot')) { const projected = getLayout(board).geometry.get(id(cell)); if (projected) return projected.clone(); } // NEW
        return baseGeometry(cell); // NEW
    }; // NEW

    graph.isCellVisible = function (cell) {
        const board = ancestor(cell, 'board');
        return baseVisible(cell) && (!board || attr(board, 'roadmap_export_snapshot') || !getLayout(board).hidden.has(id(cell)));
    };

    const baseConvert = graph.convertValueToString;
    graph.convertValueToString = function (cell) {
        const type = kind(cell);
        if (type === 'board') return label(cell) + ' · ' + summaryText(cell);
        if (type === 'process') { const clipped = getLayout(ancestor(cell, 'board')).clipped.get(id(cell)); return (clipped && clipped.left ? '‹ ' : '') + label(cell) + ' · ' + summaryText(cell) + (clipped && clipped.right ? ' ›' : ''); } // CHANGE
        if (type === 'object') {
            const clipped = getLayout(ancestor(cell, 'board')).clipped.get(id(cell));
            return (clipped && clipped.left ? '‹ ' : '') + label(cell) + (clipped && clipped.right ? ' ›' : '');
        }
        return baseConvert ? baseConvert.apply(this, arguments) : label(cell);
    };

    function getTooltipForCell(cell) {
        if (kind(cell) === 'process' || kind(cell) === 'object') return label(cell) + '\n' + attr(cell, 'roadmap_start') + ' through ' + attr(cell, 'roadmap_end') + '\n' + (kind(cell) === 'object' ? attr(cell, 'roadmap_status') + ' · ' : '') + summaryText(cell);
        return TYPES.has(kind(cell)) ? label(cell) : null;
    }
    const baseTooltip = graph.getTooltipForCell;
    graph.getTooltipForCell = function (cell) { return getTooltipForCell(cell) || (baseTooltip ? baseTooltip.apply(this, arguments) : null); };

    ['isCellMovable', 'isCellResizable', 'isCellFoldable', 'isCellEditable'].forEach(method => {
        const base = graph[method]; if (!base) return;
        graph[method] = function (cell) {
            const type = kind(cell);
            if (['process', 'object', 'timeframe', 'marker', 'board'].includes(type)) { // CHANGE
                if (method === 'isCellFoldable' || type === 'marker') return false; // NEW
                if (method === 'isCellEditable' && ['board', 'process', 'object'].includes(type)) return false; // CHANGE: roadmap names are edited through DOM overlays, not native graph label editing.
                if (type === 'timeframe') return method === 'isCellResizable'; // NEW: readers may resize their personal scale.
                if (method === 'isCellResizable' && type === 'board') return false; // NEW
                return allowed(cell); // NEW
            }
            return base.apply(this, arguments);
        };
    });

    const baseEditingValue = graph.getEditingValue, baseLabelChanged = graph.labelChanged; // NEW
    graph.getEditingValue = function (cell) { return ['object', 'process', 'board'].includes(kind(cell)) ? '' : baseEditingValue.apply(this, arguments); }; // CHANGE: disabled roadmap native editing must not expose rendered summary text.
    graph.labelChanged = function (cell) { return ['object', 'process', 'board'].includes(kind(cell)) ? cell : baseLabelChanged.apply(this, arguments); }; // CHANGE: ignore native label commits for overlay-managed roadmap names.

    /** Hit-test the transparent column headers after checking actual bars. // NEW */
    function getHitCellAt(x, y) {
        const boards = boardRegistry || (boardRegistry = allCells().filter(cell => kind(cell) === 'board')); // CHANGE: pointer movement never scans the document again until a model edit.
        for (let i = boards.length - 1; i >= 0; i--) {
            const board = boards[i], state = graph.view.getState(board);
            if (!contains(state, x, y)) continue;
            const scale = graph.view.scale;
            if (y < state.y + HEADER * scale) {
                const frames = typedChildren(board, 'timeframe');
                return frames.find(cell => graph.isCellVisible(cell) && contains(graph.view.getState(cell), x, y)) || board;
            }
            const processes = typedChildren(board, 'process');
            for (let p = processes.length - 1; p >= 0; p--) {
                if (!graph.isCellVisible(processes[p]) || !containsBar(graph.view.getState(processes[p]), x, y)) continue;
                return typedChildren(processes[p], 'object').find(cell => graph.isCellVisible(cell) && containsBar(graph.view.getState(cell), x, y)) || processes[p]; // CHANGE
            }
            return board;
        }
        return null;
    }
    function contains(state, x, y) { return state && x >= state.x && x <= state.x + state.width && y >= state.y && y <= state.y + state.height; }
    function containsBar(state, x, y) { const pad = state ? Math.max(0, (12 - state.width) / 2) : 0; return state && x >= state.x - pad && x <= state.x + state.width + pad && y >= state.y && y <= state.y + state.height; } // NEW: selection target is independent of duration and zoom.
    const baseUpdateMouseEvent = graph.updateMouseEvent; // NEW
    graph.updateMouseEvent = function (me) { const result = baseUpdateMouseEvent.apply(this, arguments), hit = getHitCellAt(me.getGraphX(), me.getGraphY()); if (hit) me.state = graph.view.getState(hit); return result; }; // NEW: expanded short-bar hit targets feed native selection.
    const baseGetCellAt = graph.getCellAt;
    if (baseGetCellAt) graph.getCellAt = function (x, y) { return getHitCellAt(x, y) || baseGetCellAt.apply(this, arguments); };

    const baseCellStyle = graph.getCellStyle;
    if (baseCellStyle) graph.getCellStyle = function (cell) {
        const style = baseCellStyle.apply(this, arguments);
        if (['process', 'object'].includes(kind(cell))) return Object.assign({}, style, { movable: 1, resizable: 1, editable: 0, rotatable: 0, recursiveResize: 0 }); // CHANGE: native label editing is disabled while move/resize handles stay available.
        if (kind(cell) !== 'timeframe') return style;
        const board = ancestor(cell, 'board'), layout = getLayout(board), timeline = gesture && gesture.board === board && gesture.layout.timeline || layout.timeline, column = timeline.columns[Number(attr(cell, 'roadmap_timeframe_index'))]; // CHANGE
        return Object.assign({}, style, { resizable: 1, movable: 0, rotatable: 0, roadmapFrameStart: column.start, roadmapFrameEnd: column.end, roadmapFrameAnchor: layout.anchor, roadmapFrameScale: column.scale, roadmapFrameStep: column.tickStep });
    };

    /** Patch an export-only XML clone; this never changes the editor's model. // NEW */
    function projectExportXml(node) {
        const copy = node.cloneNode(true);
        Array.from(copy.getElementsByTagName('mxCell')).forEach(xmlCell => {
            const wrapper = xmlCell.parentNode, cellId = xmlCell.getAttribute('id') || wrapper && wrapper.getAttribute && wrapper.getAttribute('id');
            const cell = model.getCell(cellId); if (!cell || (!TYPES.has(kind(cell)) && kind(parent(cell)) !== 'module')) return;
            const geometry = graph.getCellGeometry(cell), xmlGeometry = xmlCell.getElementsByTagName('mxGeometry')[0];
            if (geometry && xmlGeometry) ['x', 'y', 'width', 'height'].forEach(key => xmlGeometry.setAttribute(key, String(geometry[key])));
            if (!graph.isCellVisible(cell)) xmlCell.setAttribute('visible', '0');
            if (wrapper && wrapper.setAttribute && wrapper !== copy && kind(cell) === 'board') wrapper.setAttribute('roadmap_export_snapshot', '1');
            if (wrapper && wrapper.setAttribute && ['board', 'process', 'object'].includes(kind(cell))) wrapper.setAttribute('label', graph.convertValueToString(cell));
            if (kind(cell) === 'timeframe') {
                const style = graph.getCellStyle(cell);
                xmlCell.setAttribute('style', (xmlCell.getAttribute('style') || '') + ';' + ['roadmapFrameStart', 'roadmapFrameEnd', 'roadmapFrameAnchor', 'roadmapFrameScale', 'roadmapFrameStep'].map(key => key + '=' + style[key]).join(';') + ';');
            }
        });
        return copy;
    }
    /** Transport display data separately; saving and embedded editable XML always stay canonical. */ // NEW
    function exportProjection() { // NEW
        const pages = {}; // NEW
        const roots = ui.pages && ui.pages.length ? ui.pages.map(page => { // CHANGE
            if (page.root) return page.root; // NEW
            if (!page.node || !ui.updatePageRoot) return null; // NEW
            const isolated = { node: page.node.cloneNode(true) }; ui.updatePageRoot(isolated); // NEW: decode unopened pages without touching their XML or cache.
            if (isolated.root) isolatedPageIds.set(isolated.root, page.getId ? page.getId() : page.node.getAttribute('id')); // NEW
            return isolated.root; // NEW
        }).filter(Boolean) : [model.getRoot()]; // NEW
        roots.forEach(root => collectDescendants([root]).filter(cell => TYPES.has(kind(cell)) || isModuleCell(cell)).forEach(cell => { // NEW
            const pageId = pageIdFor(cell), geometry = graph.getCellGeometry(cell); // NEW
            const record = { id: id(cell), visible: graph.isCellVisible(cell), geometry: geometry && { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height } }; // NEW
            if (['board', 'process', 'object'].includes(kind(cell))) record.label = graph.convertValueToString(cell); // NEW
            if (kind(cell) === 'timeframe') { const style = graph.getCellStyle(cell); record.frameStyle = {}; ['roadmapFrameStart', 'roadmapFrameEnd', 'roadmapFrameAnchor', 'roadmapFrameScale', 'roadmapFrameStep'].forEach(key => { record.frameStyle[key] = style[key]; }); } // NEW
            (pages[pageId] || (pages[pageId] = [])).push(record); // NEW
        })); // NEW
        return pages; // NEW
    } // NEW
    const baseExportVariables = graph.getExportVariables; // NEW
    graph.getExportVariables = function () { return Object.assign({}, baseExportVariables ? baseExportVariables.apply(this, arguments) : {}, { __trellisRoadmapProjection: exportProjection() }); }; // NEW

    function element(tag, text, className) { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; }
    function button(text, action, host, disabled) {
        const node = element('button', text); node.type = 'button'; node.disabled = !!disabled;
        node.style.cssText = 'font:12px Arial;padding:3px 6px;cursor:pointer;'; // CHANGE
        const variant = /^(Add|Create|Save|Apply|Link)/.test(text) ? 'add' : /^Delete/.test(text) ? 'danger' : /^(Open|Edit|Today|Inception)/.test(text) ? 'open' : 'neutral'; // NEW
        const shared = graph.__trellisTaskUi; // NEW
        if (shared) shared.applyButtonStyle(node, variant, { compact: true, active: text.includes('✓') }); // NEW
        else if (window.Trellis && window.Trellis.ui && window.Trellis.ui.applyButtonStyle) window.Trellis.ui.applyButtonStyle(node, variant, { compact: true }); // NEW
        else { node.style.border = '1px solid #6b7280'; node.style.color = '#111827'; node.style.background = '#fff'; } // NEW
        node.addEventListener('mousedown', event => mxEvent.consume(event)); // NEW
        node.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); action(); });
        if (host) host.appendChild(node); return node;
    }
    function inputField(host, title, value, type) {
        const row = element('label'), caption = element('span', title), input = element(type === 'textarea' ? 'textarea' : 'input');
        row.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin:7px 0;';
        if (type !== 'textarea') input.type = type || 'text';
        input.value = value == null ? '' : String(value); input.setAttribute('aria-label', title);
        input.style.cssText = 'font:12px Arial;padding:5px;box-sizing:border-box;width:100%;';
        row.appendChild(caption); row.appendChild(input); host.appendChild(row); return input;
    }
    function dialog(title, build, height) {
        const body = element('div', null, 'trellis-roadmap-dialog');
        body.style.cssText = 'padding:16px;font:12px Arial;overflow:auto;box-sizing:border-box;height:100%;'; // CHANGE
        body.appendChild(element('h3', title)); dialogError = element('div', '', 'trellis-roadmap-validation'); dialogError.setAttribute('role', 'alert'); dialogError.style.color = '#b91c1c'; body.appendChild(dialogError); build(body); // NEW
        if (graph.__trellisTaskUi) graph.__trellisTaskUi.showDialog(body, 440, height || 440, true, true); // NEW
        else if (ui.showDialog) ui.showDialog(body, 440, height || 440, true, true); // NEW
        return body;
    }
    function closeDialog() { dialogError = null; if (ui.hideDialog) ui.hideDialog(); }
    function dialogActions(body, save, saveLabel) {
        const actions = element('div'); actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:14px;';
        button('Cancel', closeDialog, actions); button(saveLabel || 'Save', save, actions); body.appendChild(actions);
    }

    function showEditDialog(cell) {
        dialog(kind(cell) === 'process' ? 'Edit Process' : 'Edit Roadmap Object', body => {
            const name = inputField(body, 'Name', label(cell));
            const start = inputField(body, 'Start date', attr(cell, 'roadmap_start'), 'date'), end = inputField(body, 'End date', attr(cell, 'roadmap_end'), 'date');
            let status, progress, notes;
            if (kind(cell) === 'object') {
                status = element('select'); status.setAttribute('aria-label', 'Status'); status.style.cssText = 'width:100%;padding:5px;';
                ['Planned', 'Doing', 'Blocked', 'Done'].forEach(value => { const option = element('option', value); option.value = value; option.disabled = attr(cell, 'roadmap_status') === 'Done' && value === 'Blocked'; status.appendChild(option); });
                status.value = attr(cell, 'roadmap_status'); body.appendChild(element('label', 'Status')); body.appendChild(status);
                progress = inputField(body, 'Doing percentage', attr(cell, 'roadmap_progress') || '0', 'number'); progress.min = '0'; progress.max = '100'; progress.step = '1'; progress.disabled = status.value !== 'Doing';
                status.addEventListener('change', () => { progress.disabled = status.value !== 'Doing'; if (attr(cell, 'roadmap_status') === 'Done') progress.value = '100'; });
                notes = inputField(body, 'Notes', attr(cell, 'roadmap_notes'), 'textarea'); notes.rows = 4;
            }
            dialogActions(body, () => {
                const change = { name: name.value, startISO: start.value, endISO: end.value };
                if (status) Object.assign(change, { status: status.value, notes: notes.value, progress: status.value === 'Doing' ? Number(progress.value) : undefined });
                if ((kind(cell) === 'process' ? editProcess : editObject)(cell, change)) closeDialog();
            });
        }, kind(cell) === 'object' ? 590 : 335);
    }

    function closeAssignmentPicker() { if (assignmentPicker) assignmentPicker.remove(); assignmentPicker = null; } // NEW
    function selectionSignature(cells) { return cells.map(cell => id(cell) + ':' + attr(cell, 'roadmap_assignee_role_ids_json') + ':' + id(parent(cell))).sort().join('|'); } // NEW
    /** Task-style anchored picker: mixed assignments remain unchanged until explicitly toggled. */ // NEW
    function showAssignmentDialog(cellOrCells) { // CHANGE
        closeAssignmentPicker(); const cells = Array.isArray(cellOrCells) ? cellOrCells : [cellOrCells], board = ancestor(cells[0], 'board'), shared = graph.__trellisTaskUi; // NEW
        const host = shared ? shared.ensureControlHost() : graph.container, picker = element('div', null, 'trellis-task-assignment-picker trellis-roadmap-control'); // NEW
        picker.style.cssText = 'position:absolute;z-index:10030;background:#fff;border:1px solid #111;padding:8px;font:12px Arial;pointer-events:auto;min-width:260px;max-height:400px;overflow:auto;'; // NEW
        picker.addEventListener('mousedown', event => mxEvent.consume(event)); host.appendChild(picker); assignmentPicker = picker; // NEW
        const signature = selectionSignature(cells), roster = roleRoster(board).slice(), rosterSignature = roster.map(role => role.id).sort().join(','), initial = cells.map(cell => new Set(parseIds(attr(cell, 'roadmap_assignee_role_ids_json')))); // NEW
        const ids = new Set(roster.map(role => String(role.id))); initial.forEach(selected => selected.forEach(roleId => { if (!ids.has(roleId)) { ids.add(roleId); roster.push({ id: roleId, name: model.getCell(roleId) ? label(model.getCell(roleId)) : 'Deleted role', eligible: false }); } })); // NEW
        const search = inputField(picker, 'Search assignees', ''), checks = []; // NEW
        if (!roster.length) picker.appendChild(element('p', 'No assignable roles. Link role cards to this roadmap to build its roster.')); // NEW
        roster.forEach(role => { // NEW
            const row = element('label'), check = element('input'), key = String(role.id), count = initial.filter(selected => selected.has(key)).length; // NEW
            row.style.cssText = 'display:grid;grid-template-columns:28px minmax(120px,1fr) auto;gap:6px;align-items:center;padding:3px 2px;'; // NEW
            if (shared) row.appendChild(shared.makeRoleAvatarNode(role, 24)); else row.appendChild(element('span', (role.name || '?').slice(0, 2))); // NEW
            row.appendChild(element('span', (role.name || key) + (role.roleTitle ? ' — ' + role.roleTitle : '') + (role.eligible === false ? ' (unavailable)' : ''))); // NEW
            check.type = 'checkbox'; check.checked = count === cells.length; check.indeterminate = count > 0 && count < cells.length; check.disabled = role.eligible === false && count === 0; // NEW
            const item = { id: key, check, row, changed: false }; check.addEventListener('change', () => { item.changed = true; if (role.eligible === false && check.checked) check.checked = false; }); // NEW
            row.appendChild(check); picker.appendChild(row); checks.push(item); // NEW
        }); // NEW
        search.addEventListener('input', () => checks.forEach(item => { item.row.style.display = item.row.textContent.toLowerCase().includes(search.value.toLowerCase()) ? 'grid' : 'none'; })); // NEW
        const error = element('div'); error.style.color = '#b91c1c'; error.setAttribute('role', 'alert'); picker.appendChild(error); // NEW
        const actions = element('div'); actions.style.cssText = 'display:flex;justify-content:flex-end;gap:6px;margin-top:8px;'; picker.appendChild(actions); // NEW
        button('Cancel', closeAssignmentPicker, actions); button('Apply', () => { // NEW
            if (signature !== selectionSignature(cells) || rosterSignature !== roleRoster(board).map(role => role.id).sort().join(',')) { error.textContent = 'Assignments or membership changed. Close and reopen the picker.'; return; } // NEW
            const result = command(() => { cells.forEach((cell, index) => { const next = new Set(initial[index]); checks.filter(item => item.changed).forEach(item => { if (item.check.checked) next.add(item.id); else next.delete(item.id); }); setAssignments(cell, Array.from(next)); }); return cells; }); // NEW
            if (result) { closeAssignmentPicker(); refresh(); } // NEW
        }, actions, cells.some(cell => !allowed(cell))); // NEW
        const state = graph.view.getState(cells[0]), bounds = shared ? shared.getCellVisualBounds(cells[0], host) : state; // NEW
        if (bounds) { picker.style.left = Math.max(0, bounds.x + 20) + 'px'; picker.style.top = Math.max(0, bounds.y + bounds.height + 9) + 'px'; } // NEW
    } // NEW
    function showStatusDialog(cells) { dialog('Change Status', body => { const select = element('select'); select.setAttribute('aria-label', 'Status'); ['Planned', 'Doing', 'Blocked', 'Done'].forEach(value => select.appendChild(element('option', value))); body.appendChild(select); dialogActions(body, () => { if (setObjectStatuses(cells, select.value)) closeDialog(); }, 'Apply'); }, 220); } // NEW

    function taskBoards(moduleCell) {
        const taskModule = taskModuleFor(moduleCell), api = graph.__trellisTaskManager;
        if (!taskModule) return [];
        if (api && api.listBoardsInTaskModule) return api.listBoardsInTaskModule(taskModule);
        return children(taskModule).filter(cell => /KANBAN_BOARD/.test(attr(cell, 'board_key'))).map(cell => ({ id: id(cell), name: label(cell), role: attr(cell, 'board_role') }));
    }

    function showTaskCreationDialog(cell) {
        dialog('Create Task', body => {
            const name = inputField(body, 'Task name', label(cell));
            body.appendChild(element('p', 'Allowed range: ' + attr(cell, 'roadmap_start') + ' through ' + attr(cell, 'roadmap_end') + ' (inclusive).'));
            const start = inputField(body, 'Task start date', attr(cell, 'roadmap_start'), 'date'), end = inputField(body, 'Task end date', attr(cell, 'roadmap_end'), 'date');
            [start, end].forEach(input => { input.min = attr(cell, 'roadmap_start'); input.max = attr(cell, 'roadmap_end'); });
            const chooser = element('select'); chooser.setAttribute('aria-label', 'Destination Task Board'); chooser.style.cssText = 'width:100%;padding:6px;';
            const boards = taskBoards(parent(ancestor(cell, 'board'))); boards.sort((a, b) => (a.role === 'main' ? -1 : b.role === 'main' ? 1 : 0));
            if (!boards.some(board => board.role === 'main')) { const option = element('option', 'Main Board (create when submitted)'); option.value = ''; chooser.appendChild(option); }
            boards.forEach(board => { const option = element('option', board.name); option.value = board.id; chooser.appendChild(option); });
            body.appendChild(element('label', 'Destination Task Board')); body.appendChild(chooser);
            const warning = element('div'); warning.style.cssText = 'margin-top:12px;padding:8px;background:#fffbeb;'; body.appendChild(warning);
            function missingRoles() {
                const taskBoard = model.getCell(chooser.value), taskApi = graph.__trellisTaskManager;
                const eligible = new Set(taskBoard && taskApi && taskApi.getBoardRoleRoster ? taskApi.getBoardRoleRoster(taskBoard).map(role => String(role.id)) : []);
                const source = new Set(roleRoster(ancestor(cell, 'board')).map(role => String(role.id))); // NEW
                return parseIds(attr(cell, 'roadmap_assignee_role_ids_json')).filter(roleId => source.has(roleId) && !eligible.has(roleId)); // CHANGE
            }
            const linkChoice = element('input'); linkChoice.type = 'checkbox'; linkChoice.checked = true;
            function updateWarning() {
                warning.replaceChildren(); const missing = missingRoles(); warning.style.display = missing.length ? '' : 'none';
                if (missing.length) {
                    warning.appendChild(element('p', 'These assignees are not linked to the destination board: ' + missing.map(roleId => { const role = model.getCell(roleId); return role ? label(role) : 'Deleted role'; }).join(', ')));
                    const row = element('label'); row.appendChild(linkChoice); row.appendChild(element('span', ' Link these assignees to the board. If unchecked, create the task without them.')); warning.appendChild(row);
                    const destination = model.getCell(chooser.value);
                    linkChoice.disabled = !!destination && !allowed(destination, 'canManageAccess'); if (linkChoice.disabled) { linkChoice.checked = false; warning.appendChild(element('p', 'You do not have permission to change membership on this board.')); }
                }
            }
            chooser.addEventListener('change', updateWarning); updateWarning();
            dialogActions(body, () => {
                const task = createTaskFromRoadmapObject(cell, { title: name.value, startISO: start.value, endISO: end.value, taskBoardId: chooser.value || null, linkMissingAssignees: missingRoles().length ? linkChoice.checked : false });
                if (task) { closeDialog(); graph.setSelectionCell(cell); showTaskSuccess(task); }
            }, 'Create Task');
        }, 580);
    }

    function showTaskSuccess(task) {
        if (!graph.container) return;
        const toast = element('div', 'Task created. ', 'trellis-roadmap-control'); toast.style.cssText = 'position:absolute;left:16px;top:16px;z-index:10030;background:#ecfdf5;padding:10px;border:1px solid #15803d;pointer-events:auto;';
        button('Open Task', () => { toast.remove(); openTask(task); }, toast); button('Dismiss', () => toast.remove(), toast); graph.container.appendChild(toast);
        window.setTimeout(() => toast.remove(), 10000);
    }
    function openTask(task) { const api = graph.__trellisTaskManager; if (api && api.openTaskCard) return api.openTaskCard(task); graph.setSelectionCell(task); if (graph.scrollCellToVisible) graph.scrollCellToVisible(task); return task; }
    function showTasks(cell) {
        const tasks = linkedTasks(cell); if (tasks.length === 1) return openTask(tasks[0]);
        dialog('Linked Tasks', body => { tasks.forEach(task => button(attr(task, 'title') || label(task), () => { closeDialog(); openTask(task); }, body)); button('Close', closeDialog, body); }, 320);
    }
    function showDeletionDialog(cells, tasks) {
        dialog('Delete Roadmap Content', body => {
            body.appendChild(element('p', tasks.length + ' linked task(s) exist. Keep the tasks or delete them too?'));
            const choice = element('select'); choice.setAttribute('aria-label', 'Linked tasks on deletion');
            [['keep', 'Keep linked tasks'], ['delete', 'Delete linked tasks too']].forEach(([value, name]) => { const option = element('option', name); option.value = value; choice.appendChild(option); }); body.appendChild(choice);
            dialogActions(body, () => { if (deleteRoadmapCells(cells, choice.value)) closeDialog(); }, 'Delete');
        }, 245);
    }

    function normalizedName(cell, name) { return String(name == null ? '' : name).trim() || label(cell); } // NEW: blank overlay edits keep the existing label instead of creating an empty graph label.
    function rename(cell, name) { return command(() => { requireEdit(cell); patch(cell, { label: normalizedName(cell, name) }); return cell; }); }
    function stopDomPropagation(event) { if (event && event.stopPropagation) event.stopPropagation(); } // NEW: overlay text editing should never start graph gestures.
    function consumeDomEvent(event) { if (event && event.preventDefault) event.preventDefault(); stopDomPropagation(event); } // NEW
    function writeOverlayName(cell, name) { // NEW
        const previous = label(cell), next = normalizedName(cell, name); // NEW
        if (next === previous) return previous; // NEW
        return rename(cell, next) ? label(cell) : previous; // NEW: permission failures restore the last committed label.
    } // NEW
    function nameControl(host, cell) { // CHANGE
        const shared = graph.__trellisTaskUi; // NEW
        if (shared) { const input = shared.makeNameInput({ value: label(cell), title: 'Name', disabled: !allowed(cell), commit: value => writeOverlayName(cell, value) }); host.appendChild(input); return input; } // CHANGE
        let committedLabel = label(cell); // NEW
        const input = inputField(host, 'Name', committedLabel); input.disabled = !allowed(cell); // CHANGE
        ['mousedown', 'mouseup', 'click', 'dblclick', 'pointerdown', 'pointerup'].forEach(type => input.addEventListener(type, stopDomPropagation)); // NEW: mirror task board overlay input gesture isolation.
        input.addEventListener('keydown', event => { // NEW
            stopDomPropagation(event); // NEW
            if (event.key === 'Enter') { input.value = writeOverlayName(cell, input.value); committedLabel = input.value; if (input.blur) input.blur(); consumeDomEvent(event); } // NEW
            else if (event.key === 'Escape') { input.value = committedLabel; consumeDomEvent(event); } // NEW
        }); // NEW
        ['keypress', 'keyup'].forEach(type => input.addEventListener(type, stopDomPropagation)); // NEW
        input.addEventListener('blur', () => { input.value = writeOverlayName(cell, input.value); committedLabel = input.value; }); // CHANGE
        return input; // CHANGE
    } // NEW
    function toolbar(board, host) { // CHANGE
        nameControl(host, board); host.appendChild(element('span', summaryText(board))); // NEW
        const state = getViewState(board), mode = state.perspective, settings = state[mode], row = element('div'), columns = element('div'); // NEW
        row.style.cssText = 'display:flex;gap:4px;align-items:center;white-space:nowrap;'; columns.style.cssText = 'display:' + (columnPanels.get(board) ? 'flex' : 'none') + ';gap:4px;align-items:center;'; host.appendChild(row); host.appendChild(columns); // NEW
        button(mode === 'today' ? 'Today ✓' : 'Today', () => setViewState(board, { perspective: 'today' }), row); button(mode === 'inception' ? 'Inception ✓' : 'Inception', () => setViewState(board, { perspective: 'inception' }), row); // NEW
        button('Columns', () => { columnPanels.set(board, !columnPanels.get(board)); refresh(); }, row); // NEW
        button('Add Process', () => addProcess(board), row, !allowed(board, 'canAddCell')); button('Add Project', () => openBoard(createSecondaryRoadmapInRoadmapModule(parent(board))), row, !allowed(parent(board), 'canAddCell')); // NEW
        function changeView(changes) { setViewState(board, { [mode]: Object.assign({}, settings, changes) }); } // NEW
        button('Hide past', () => changeView({ leftHidden: settings.leftHidden + 1 }), columns, settings.leftHidden >= 3); button('Show past', () => changeView({ leftHidden: settings.leftHidden - 1 }), columns, !settings.leftHidden); // NEW
        button('Hide future', () => changeView({ rightHidden: settings.rightHidden + 1 }), columns, settings.rightHidden >= 4); button('Show future', () => changeView({ rightHidden: settings.rightHidden - 1 }), columns, !settings.rightHidden); // NEW
        const scale = inputField(columns, 'Scale %', Math.round(settings.multiplier * 100), 'number'); scale.min = '1'; scale.max = '10000'; scale.style.width = '64px'; // NEW
        scale.addEventListener('change', () => { const multiplier = Number(scale.value) / 100; if (multiplier > 0 && multiplier <= 100) changeView({ multiplier }); }); // NEW
        button('Reset scale', () => changeView({ scales: Array(8).fill(4), multiplier: 1 }), columns); // NEW
    } // NEW

    function renderControls() {
        if (!document || !graph.container || gesture) return; // CHANGE
        if (!overlay) { overlay = element('div', null, 'trellis-roadmap-controls'); overlay.style.cssText = 'position:absolute;left:0;top:0;z-index:10020;pointer-events:none;'; (graph.__trellisTaskUi ? graph.__trellisTaskUi.ensureControlHost() : graph.container).appendChild(overlay); }
        if (overlay.contains(document.activeElement) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return; // CHANGE: focused buttons must refresh their captured perspective/trim settings after every click.
        overlay.replaceChildren();
        const cell = graph.getSelectionCell && graph.getSelectionCell(); if (!cell) return; // CHANGE
        const type = kind(cell), board = ancestor(cell, 'board');
        function panel(anchor, topOffset) {
            const state = graph.view.getState(anchor); if (!state) return null;
            const host = element('div', null, 'trellis-roadmap-control'); host.style.cssText = 'position:absolute;display:flex;flex-direction:column;align-items:flex-start;gap:4px;background:#fff;border:1px solid #111;padding:4px;pointer-events:auto;font:12px Arial;white-space:nowrap;'; // CHANGE
            host.__roadmapAnchor = anchor; host.__roadmapAbove = topOffset < 0; // CHANGE
            host.style.left = Math.max(0, state.x + (topOffset < 0 ? 0 : 20)) + 'px'; host.style.top = Math.max(0, state.y + topOffset) + 'px'; // NEW
            host.addEventListener('mousedown', event => event.stopPropagation()); overlay.appendChild(host); return host;
        }
        if (board) { const host = panel(board, -85); if (host) toolbar(board, host); } // NEW
        const selected = graph.getSelectionCells(); // NEW
        if (selected.length > 1) { // NEW
            if (selected.every(item => kind(item) === 'object' && ancestor(item, 'board') === board)) { const state = graph.view.getState(cell), host = state && panel(cell, state.height + 9); if (host) { host.appendChild(element('span', selected.length + ' objects selected')); button('Assign', () => showAssignmentDialog(selected), host, selected.some(item => !allowed(item))); button('Status', () => showStatusDialog(selected), host, selected.some(item => !allowed(item))); } } // NEW
            positionControls(); return; // NEW
        }
        if (type === 'module') {
            const host = panel(cell, -76); if (!host) return;
            nameControl(host, cell);
            button('Margins', () => { const api = graph.__trellisModules; if (api && api.promptSetModuleMargins) api.promptSetModuleMargins(cell); }, host, !allowed(cell));
            const main = typedChildren(cell, 'board').find(item => attr(item, 'roadmap_role') === 'main');
            button(main ? 'Open Main Roadmap' : 'Add Main Roadmap', () => openBoard(main || ensureMainRoadmapInRoadmapModule(cell)), host, !main && !allowed(cell, 'canAddCell'));
            button('Add Secondary Roadmap', () => openBoard(createSecondaryRoadmapInRoadmapModule(cell)), host, !allowed(cell, 'canAddCell'));
            typedChildren(cell, 'board').filter(item => item !== main).forEach(item => button(label(item), () => openBoard(item), host));
        } else if (type === 'process' || type === 'object') {
            const state = graph.view.getState(cell), host = state && panel(cell, state.height + 8); if (!host) return;
            nameControl(host, cell); button('Edit', () => showEditDialog(cell), host, !allowed(cell));
            if (type === 'process') {
                const start = inputField(host, 'Start date', attr(cell, 'roadmap_start'), 'date'), end = inputField(host, 'End date', attr(cell, 'roadmap_end'), 'date');
                [start, end].forEach(input => { input.disabled = !allowed(cell); input.addEventListener('change', () => editProcess(cell, { startISO: start.value, endISO: end.value })); });
                button('Add Roadmap Object', () => addObject(cell), host, !allowed(cell, 'canAddCell'));
            } else {
                button('Assign', () => showAssignmentDialog(cell), host, !allowed(cell));
                button('Create Task', () => showTaskCreationDialog(cell), host, !allowed(cell) || !['Planned', 'Doing'].includes(attr(cell, 'roadmap_status')));
                const tasks = linkedTasks(cell); button('Open Tasks (' + tasks.length + ')', () => showTasks(cell), host, !tasks.length);
            }
        }
        positionControls(); // NEW
    }

    function positionControls() { // NEW
        if (!overlay) return; const shared = graph.__trellisTaskUi; // NEW
        Array.from(overlay.children).forEach(host => { const anchor = host.__roadmapAnchor, state = anchor && graph.view.getState(anchor); if (!state) return; const bounds = shared ? shared.getCellVisualBounds(anchor, overlay) : state; if (shared) shared.positionDomOverlayFromBounds(host, bounds, !host.__roadmapAbove, host.__roadmapAbove, 3, host.__roadmapAbove ? 0 : 20); else host.style.top = Math.max(0, host.__roadmapAbove ? bounds.y - host.offsetHeight - 9 : bounds.y + bounds.height + 9) + 'px'; }); // NEW
    } // NEW

    function point(event) { const rect = graph.container.getBoundingClientRect(); return { x: event.clientX - rect.left + graph.container.scrollLeft, y: event.clientY - rect.top + graph.container.scrollTop }; }
    /** Native handlers own pointer capture, outlines, Escape and selection handles. */ // NEW
    function beginGesture(cell, edge, event) { // CHANGE
        const board = ancestor(cell, 'board'); if (!board || kind(cell) !== 'timeframe' && !allowed(cell)) return; // NEW
        const selected = graph.getSelectionCells(), targets = edge === 'move' && selected.includes(cell) ? moveRoots(selected) : [cell]; // NEW
        if (targets.some(item => ancestor(item, 'board') !== board)) return; // NEW
        const layout = getLayout(board); // NEW
        gesture = { cell, edge, board, layout, targets, settings: getViewState(board), startPoint: point(event), boardState: graph.view.getState(board), geometry: graph.getCellGeometry(cell).clone(), delta: 0 }; // NEW
        closeAssignmentPicker(); // NEW
        if (!dateHint) { dateHint = element('div', '', 'trellis-roadmap-date-hint'); dateHint.style.cssText = 'position:absolute;z-index:10030;pointer-events:none;background:#fff;border:1px solid #111;padding:4px;font:12px Arial;'; graph.container.appendChild(dateHint); } // NEW
        dateHint.style.display = ''; if (overlay) overlay.style.display = 'none'; // NEW
    } // NEW

    function gestureDays(cell, dx, layout) { const dates = range(cell); return Math.round(core.xToDay(layout.timeline, core.dayToX(layout.timeline, dates.start) + dx) - dates.start); } // NEW
    function requestedRow(g, dy) { // NEW
        const rows = g.layout.packedProcesses.rows; let top = HEADER + PAD; // NEW
        const wanted = g.geometry.y + dy, candidates = rows.map((row, index) => { const distance = Math.abs(top - wanted); top += row.height + GAP; return { index, distance }; }); // NEW
        return candidates.sort((a, b) => a.distance - b.distance || a.index - b.index)[0]?.index || 0; // NEW
    } // NEW
    function previewGesture(event, nativeDx, nativeDy) { // CHANGE
        if (!gesture) return; const g = gesture, current = point(event); // NEW
        const dx = nativeDx == null ? (current.x - g.startPoint.x) / graph.view.scale : nativeDx, dy = nativeDy == null ? (current.y - g.startPoint.y) / graph.view.scale : nativeDy; // NEW
        g.dx = dx; g.dy = dy; // NEW
        if (kind(g.cell) === 'board') dateHint.style.display = 'none'; // NEW
        else if (kind(g.cell) === 'timeframe') { const column = g.layout.timeline.columns[Number(attr(g.cell, 'roadmap_timeframe_index'))]; dateHint.textContent = (Math.max(0.05, (g.geometry.width + dx) / (column.end - column.start) / g.settings[g.settings.perspective].multiplier)).toFixed(2) + ' px/day'; } // CHANGE // NEW
        else { // NEW
            g.delta = gestureDays(g.cell, dx, g.layout); const dates = range(g.cell); // NEW
            const start = g.edge === 'right' ? dates.start : Math.min(dates.end, dates.start + g.delta); // NEW
            const end = g.edge === 'left' ? dates.end : Math.max(start, dates.end + g.delta); // NEW
            const crossProject = g.edge === 'move' && nativeMove && nativeMove.target && ancestor(nativeMove.target, 'board') !== g.board; // NEW
            dateHint.textContent = core.formatDay(crossProject ? dates.start : g.edge === 'move' ? dates.start + g.delta : start) + ' → ' + core.formatDay(crossProject ? dates.end : end); // CHANGE // NEW
        } // NEW
        dateHint.style.left = current.x + 15 + 'px'; dateHint.style.top = current.y - 30 + 'px'; // NEW
    } // NEW
    function clearGesture() { gesture = null; if (dateHint) dateHint.style.display = 'none'; if (overlay) overlay.style.display = ''; checkToday(); refresh(); } // NEW
    function endGesture(cancel) { const g = gesture; if (!g) return; if (!cancel && g.edge === 'move') moveContent(g.targets, null, { days: g.delta, preferredRow: kind(g.cell) === 'process' ? requestedRow(g, g.dy || 0) : undefined }); clearGesture(); } // CHANGE: direct command test seam, not a second pointer engine.

    function performNativeMove(cells, target, options) { // NEW
        if (!options.clone) return moveContent(cells, target, options); // NEW
        return command(() => { // NEW
            const plan = planMove(cells, target, options); // NEW
            const copies = plan.roots.flatMap(cell => baseMoveCells.call(graph, [cell], 0, 0, true, parent(cell), options.event, options.mapping)); // NEW
            return moveContent(copies, target, Object.assign({}, options, { expectedSignature: null })); // NEW
        }); // NEW
    } // NEW
    function requestNativeMove(cells, target, options) { // NEW
        let plan; try { plan = planMove(cells, target, options); } catch (error) { alertError(error); return []; } // NEW
        if (!plan.missing.length) return performNativeMove(cells, target, options) || []; // NEW
        dialog('Move to Project', body => { // NEW
            body.appendChild(element('p', 'These assignees are missing from the destination: ' + plan.missing.map(roleId => label(model.getCell(roleId))).join(', '))); // NEW
            body.appendChild(element('p', 'Moving without them removes their assignments from the moved objects. Existing tasks keep their assignments.')); // NEW
            const submit = linkMissingAssignees => { if (performNativeMove(cells, target, Object.assign({}, options, { linkMissingAssignees, expectedSignature: plan.signature }))) closeDialog(); }; // NEW
            button('Link and move', () => submit(true), body, !allowed(plan.destinationBoard, 'canManageAccess')); // NEW
            button('Move without missing assignments', () => submit(false), body); button('Cancel', closeDialog, body); // NEW
        }, 260); return []; // NEW
    } // NEW

    const baseMoveCells = graph.moveCells; // NEW
    graph.moveCells = function (cells, dx, dy, clone, target, event, mapping) { // NEW
        const roots = moveRoots(cells), roadmap = roots.some(cell => ['object', 'process', 'board'].includes(kind(cell))); // NEW
        if (!roadmap) return baseMoveCells.apply(this, arguments); // NEW
        if (roots.every(cell => kind(cell) === 'board')) return command(() => { // CHANGE
            roots.forEach(cell => requireEdit(cell)); // NEW
            if (target && roots.some(cell => parent(cell) !== target)) throw new Error('Keep project boards in their Roadmap Module.'); // NEW
            const result = clone // NEW
                ? roots.flatMap(cell => baseMoveCells.call(this, [cell], dx, dy, true, parent(cell), event, mapping)) // NEW: native copies retain their module parent.
                : baseMoveCells.call(this, roots, dx, dy, false, target, event, mapping); // NEW
            result.forEach(cell => fixedBoardMoves.add(cell)); // NEW: collision cascades preserve the requested group arrangement.
            return result; // NEW
        }) || []; // NEW
        const primary = roots[0], layout = gesture && gesture.layout || getLayout(ancestor(primary, 'board')); // NEW
        if (!layout) return []; // NEW
        const options = { days: gestureDays(primary, dx, layout), preferredRow: kind(primary) === 'process' ? requestedRow(gesture || { layout, geometry: graph.getCellGeometry(primary) }, dy) : undefined }; // NEW
        options.clone = !!clone; options.event = event; options.mapping = mapping; // NEW
        return requestNativeMove(roots, target, options); // NEW
    }; // NEW

    /** The resize command receives display bounds, never persists the native projected geometry. */ // NEW
    function resizeTimelineCell(cell, bounds, edge) { // NEW
        const board = ancestor(cell, 'board'), layout = gesture && gesture.board === board ? gesture.layout : getLayout(board), old = gesture && gesture.cell === cell ? gesture.geometry : graph.getCellGeometry(cell); // NEW
        if (kind(cell) === 'timeframe') { // NEW
            const state = gesture && gesture.settings || getViewState(board), mode = state.perspective, scales = state[mode].scales.slice(), index = Number(attr(cell, 'roadmap_timeframe_index')), column = layout.timeline.columns[index]; // NEW
            scales[index] = Math.max(0.05, bounds.width / (column.end - column.start) / state[mode].multiplier); return setViewState(board, { [mode]: { scales } }); // NEW
        } // NEW
        const dates = range(cell), left = edge === 'left' || !edge && bounds.x !== old.x; // NEW
        const start = left ? Math.min(dates.end, Math.round(core.xToDay(layout.timeline, core.dayToX(layout.timeline, dates.start) + bounds.x - old.x))) : dates.start; // NEW
        const end = left ? dates.end : Math.max(start, Math.round(core.xToDay(layout.timeline, core.dayToX(layout.timeline, dates.end + 1) + bounds.x + bounds.width - old.x - old.width)) - 1); // NEW
        return (kind(cell) === 'process' ? editProcess : editObject)(cell, { startISO: core.formatDay(start), endISO: core.formatDay(end) }); // NEW
    } // NEW
    const baseResizeCells = graph.resizeCells; // NEW
    graph.resizeCells = function (cells, bounds) { // NEW
        if (!(cells || []).some(cell => ['object', 'process', 'timeframe'].includes(kind(cell)))) return baseResizeCells.apply(this, arguments); // NEW
        if (cells.length === 1 && kind(cells[0]) === 'timeframe') { resizeTimelineCell(cells[0], bounds[0], gesture && gesture.edge); return cells; } // NEW
        return command(() => { if (cells.some(cell => !['object', 'process'].includes(kind(cell)))) throw new Error('Resize roadmap bars separately from other cells.'); cells.forEach((cell, index) => resizeTimelineCell(cell, bounds[index], gesture && gesture.edge)); return cells; }) || []; // NEW
    }; // NEW

    function RoadmapVertexHandler(state) { this.manageSizers = true; this.livePreview = false; this.rotationEnabled = false; mxVertexHandler.call(this, state); } // NEW
    mxUtils.extend(RoadmapVertexHandler, mxVertexHandler); // NEW
    RoadmapVertexHandler.prototype.isSizerVisible = function (index) { return kind(this.state.cell) === 'timeframe' ? index === 4 : index === 3 || index === 4; }; // NEW
    RoadmapVertexHandler.prototype.getHandleForEvent = function (me) { const index = mxVertexHandler.prototype.getHandleForEvent.call(this, me); return this.isSizerVisible(index) ? index : null; }; // NEW
    RoadmapVertexHandler.prototype.redrawHandles = function () { mxVertexHandler.prototype.redrawHandles.call(this); (this.sizers || []).forEach((sizer, index) => { if (sizer && sizer.node && !this.isSizerVisible(index)) sizer.node.style.display = 'none'; }); }; // NEW
    RoadmapVertexHandler.prototype.start = function (x, y, index) { beginGesture(this.state.cell, index === 3 ? 'left' : 'right', { button: 0, clientX: x, clientY: y }); mxVertexHandler.prototype.start.apply(this, arguments); }; // NEW
    RoadmapVertexHandler.prototype.mouseMove = function (sender, me) { mxVertexHandler.prototype.mouseMove.call(this, sender, me); if (this.index != null) previewGesture(me.getEvent()); }; // NEW
    RoadmapVertexHandler.prototype.resizeCell = function (cell, dx, dy, index) { const bounds = gesture.geometry.clone(); if (index === 3) { bounds.x += dx; bounds.width -= dx; } else bounds.width += dx; graph.resizeCells([cell], [bounds]); }; // NEW
    RoadmapVertexHandler.prototype.reset = function () { mxVertexHandler.prototype.reset.call(this); if (gesture && gesture.edge !== 'move') clearGesture(); }; // NEW
    const baseCreateHandler = graph.createHandler; // NEW
    graph.createHandler = function (state) { return ['object', 'process', 'timeframe'].includes(kind(state.cell)) ? new RoadmapVertexHandler(state) : baseCreateHandler.apply(this, arguments); }; // NEW

    const nativeMove = graph.graphHandler; // NEW
    if (nativeMove) { // NEW
        const start = nativeMove.start, move = nativeMove.mouseMove, reset = nativeMove.reset, initial = nativeMove.getInitialCellForEvent; // CHANGE
        nativeMove.getInitialCellForEvent = function (me) { return ['object', 'process', 'timeframe'].includes(kind(me.getCell())) ? me.getCell() : initial.apply(this, arguments); }; // NEW // NEW
        nativeMove.start = function (cell, x, y) { if (['object', 'process', 'board'].includes(kind(cell))) { beginGesture(cell, 'move', { button: 0, clientX: x, clientY: y }); this.__roadmapMaxLivePreview = this.maxLivePreview; this.maxLivePreview = 0; } return start.apply(this, arguments); }; // NEW
        nativeMove.mouseMove = function (sender, me) { const result = move.apply(this, arguments); if (gesture && gesture.edge === 'move') previewGesture(me.getEvent(), (this.currentDx || 0) / graph.view.scale, (this.currentDy || 0) / graph.view.scale); return result; }; // NEW
        nativeMove.reset = function () { const result = reset.apply(this, arguments); if (this.__roadmapMaxLivePreview !== undefined) { this.maxLivePreview = this.__roadmapMaxLivePreview; delete this.__roadmapMaxLivePreview; } if (gesture && gesture.edge === 'move') clearGesture(); return result; }; // NEW
    } // NEW
    const baseDropTarget = graph.getDropTarget; // NEW
    graph.getDropTarget = function (cells, event, cell) { // NEW
        const roots = moveRoots(cells); if (!roots.some(item => ['object', 'process'].includes(kind(item)))) return baseDropTarget.apply(this, arguments); // NEW
        return roots.every(item => kind(item) === 'object') ? ancestor(cell, 'process') : roots.every(item => kind(item) === 'process') ? ancestor(cell, 'board') : null; // NEW
    }; // NEW

    function refresh() {
        if (destroyed || refreshPending) return; refreshPending = true;
        const schedule = window.requestAnimationFrame || (fn => window.setTimeout(fn, 0));
        schedule(() => { refreshPending = false; if (destroyed) return; if (graph.refresh) graph.refresh(); renderControls(); });
    }
    function checkToday() { const today = core.todayDay(); if (!gesture && today !== lastToday) { lastToday = today; invalidateLayouts(); refresh(); } }

    const disposers = []; // NEW
    function listenDom(target, event, handler) { target.addEventListener(event, handler); disposers.push(() => target.removeEventListener(event, handler)); } // NEW
    function listenModel(target, event, handler) { if (target && target.addListener) { target.addListener(event, handler); disposers.push(() => target.removeListener(handler)); } } // NEW
    if (graph.container && document) { // CHANGE: only non-gesture lifecycle events belong to Roadmap.
        listenDom(graph.container, 'scroll', renderControls); // NEW
        listenDom(window, 'trellisUsersSessionChanged', () => { if (gesture) { if (graph.escape) graph.escape(); clearGesture(); } invalidateLayouts(); refresh(); }); // NEW
        listenDom(window, 'trellisUsersStoreChanged', () => { invalidateLayouts(); refresh(); }); // NEW
        listenDom(window, 'focus', checkToday); listenDom(document, 'visibilitychange', checkToday); // NEW
        const timer = window.setInterval(checkToday, 60000); disposers.push(() => window.clearInterval(timer)); // NEW
    } // NEW
    listenModel(model, mxEvent.CHANGE, () => { boardRegistry = null; invalidateLayouts(); if (gesture && !committingCanonical && !commandDepth) { if (graph.escape) graph.escape(); clearGesture(); } if (!commandDepth) refresh(); }); // NEW
    listenModel(graph.getSelectionModel && graph.getSelectionModel(), mxEvent.CHANGE, () => { closeAssignmentPicker(); refresh(); }); // NEW
    [mxEvent.SCALE, mxEvent.TRANSLATE, mxEvent.SCALE_AND_TRANSLATE].filter(Boolean).forEach(event => listenModel(graph.view, event, renderControls)); // NEW
    const destroyGraph = graph.destroy; // NEW
    graph.destroy = function () { destroyed = true; disposers.splice(0).forEach(dispose => dispose()); closeAssignmentPicker(); if (overlay) overlay.remove(); if (dateHint) dateHint.remove(); return destroyGraph.apply(this, arguments); }; // NEW
    graph.__trellisRoadmapManager = {
        runModelCommand: command, // NEW: Modules joins Roadmap lifecycle rollback and post-edit permission validation.
        ensureMainRoadmapInRoadmapModule, createSecondaryRoadmapInRoadmapModule, listRoadmapsForGarden, openRoadmapForGarden, createTaskFromRoadmapObject,
        addProcess, addObject, editProcess, editObject, setAssignments, getViewState, setViewState, getLayout, getSummary, shiftObjects, deleteRoadmapCells,
        getHitCellAt, getTooltipForCell, isRoadmapCell: cell => TYPES.has(kind(cell)), isRoadmapGestureCell: cell => ['object', 'timeframe', 'marker'].includes(kind(cell)),
        projectExportXml, exportProjection, refresh, openBoard, showTaskCreationDialog, showEditDialog, linkedTasks, roleRoster,
        _test: { moveContent, planMove, setObjectStatuses, setObjectAssignments, resizeTimelineCell, command, beginGesture, previewGesture, endGesture, checkToday, calculateLayout, get gesture() { return gesture; } }
    };
    refresh();
});
