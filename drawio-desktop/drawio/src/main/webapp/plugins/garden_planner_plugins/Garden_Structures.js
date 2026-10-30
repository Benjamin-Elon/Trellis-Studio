/** Garden structures are portable layout vertices; footprint drafts never mutate the model. */ // NEW
Draw.loadPlugin(function (ui) { // NEW
    const graph = ui.editor && ui.editor.graph; // NEW
    if (!graph || graph.__trellisStructures) return; // NEW
    const model = graph.getModel(), EPS = 1e-7, MODE = 'structure-footprint'; // NEW
    const GRAPH_OVERLAY_Z = Object.freeze({ ANNOTATION: 10000, CONNECTION: 10010, CONTROL: 10020, CONTROL_TOP: 10030 }); // NEW
    const ATTR = 'structure_footprint_json', RECT = [[0, 0], [1, 0], [1, 1], [0, 1]]; // NEW
    const DEFAULT_SIZE_UNITS = 200 * 5 * 0.18; // NEW: 2 m using the same centimeter scale as garden beds and dimension feedback.
    let session = null, panelCell = null, panel = null, nameInput = null, message = '', hiddenCell = null, timer = null, committing = false, restoringSelection = false, destroyed = false; // NEW
    const disposers = []; // NEW
    const isStructure = cell => !!cell && cell.getAttribute?.('garden_structure') === '1'; // NEW
    const isGarden = cell => !!cell && (cell.getAttribute?.('garden_module') === '1' || cell.getAttribute?.('trellis_garden_module') === '1' || cell.getAttribute?.('module_type') === 'garden'); // NEW
    const copy = points => points.map(point => point.slice()); // NEW
    const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b); // NEW
    const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); // NEW

    /** Reject touching nonadjacent edges as well as ordinary crossings and degenerate edges. */ // NEW
    function validPolygon(points) { // NEW
        if (!Array.isArray(points) || points.length < 3 || points.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))) return false; // NEW
        let area = 0; // NEW
        const onSegment = (a, b, p) => Math.abs(cross(a, b, p)) <= EPS && p[0] >= Math.min(a[0], b[0]) - EPS && p[0] <= Math.max(a[0], b[0]) + EPS && p[1] >= Math.min(a[1], b[1]) - EPS && p[1] <= Math.max(a[1], b[1]) + EPS; // NEW
        for (let i = 0; i < points.length; i++) { // NEW
            const a = points[i], b = points[(i + 1) % points.length], previous = points[(i + points.length - 1) % points.length]; // NEW
            if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= EPS) return false; // NEW
            if (Math.abs(cross(previous, a, b)) <= EPS && (previous[0] - a[0]) * (b[0] - a[0]) + (previous[1] - a[1]) * (b[1] - a[1]) > EPS) return false; // NEW
            area += a[0] * b[1] - a[1] * b[0]; // NEW
            for (let j = i + 1; j < points.length; j++) { // NEW
                if (j === i + 1 || (i === 0 && j === points.length - 1)) continue; // NEW
                const c = points[j], d = points[(j + 1) % points.length]; // NEW
                if (onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)) return false; // NEW
                if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return false; // NEW
            } // NEW
        } // NEW
        return Math.abs(area) > EPS; // NEW
    } // NEW

    function readPoints(cell) { // NEW
        const data = JSON.parse(cell.getAttribute(ATTR) || 'null'); // NEW
        if (!data || data.version !== 1 || !validPolygon(data.points) || data.points.some(p => p.some(n => n < -EPS || n > 1 + EPS))) throw new Error('This structure has an invalid saved footprint. Its saved data has been preserved.'); // NEW
        return data.points; // NEW
    } // NEW

    function stencil(points) { // NEW
        const path = points.map((p, i) => '<' + (i ? 'line' : 'move') + ' x="' + (p[0] * 100) + '" y="' + (p[1] * 100) + '"/>').join(''); // NEW
        return 'stencil(' + Graph.compress('<shape w="100" h="100" aspect="variable" strokewidth="inherit"><foreground><path>' + path + '<close/></path><fillstroke/></foreground></shape>') + ')'; // NEW
    } // NEW

    function editable(cell) { // NEW
        return !!cell && model.contains(cell) && (!graph.isEnabled || graph.isEnabled()) && (!graph.isCellLocked || !graph.isCellLocked(cell)) && (window.Trellis?.users?.canEditCell?.(cell) !== false); // NEW
    } // NEW

    function transform(point, geometry, style) { // NEW
        const angle = Number(style.rotation || 0) * Math.PI / 180, cx = geometry.x + geometry.width / 2, cy = geometry.y + geometry.height / 2; // NEW
        const x = (point[0] - cx) * (String(style.flipH) === '1' ? -1 : 1), y = (point[1] - cy) * (String(style.flipV) === '1' ? -1 : 1); // NEW
        return [cx + x * Math.cos(angle) - y * Math.sin(angle), cy + x * Math.sin(angle) + y * Math.cos(angle)]; // NEW
    } // NEW

    function inside(points, garden, geometry = model.getGeometry(garden)) { // NEW
        return !!geometry && points.every(p => p[0] >= -EPS && p[1] >= -EPS && p[0] <= geometry.width + EPS && p[1] <= geometry.height + EPS); // NEW
    } // NEW

    function footprint(cell, geometry = model.getGeometry(cell), style = graph.getCellStyle(cell)) { // NEW
        return readPoints(cell).map(p => transform([geometry.x + p[0] * geometry.width, geometry.y + p[1] * geometry.height], geometry, style)); // NEW
    } // NEW

    function snapshot(cell) { // NEW
        return JSON.stringify([model.getParent(cell)?.id, mxUtils.getXml(cell.value), cell.style, model.getGeometry(cell)]); // NEW
    } // NEW

    function draftError(draft) { // NEW
        if (!editable(draft.cell) || !editable(draft.garden)) return 'This structure is missing or you no longer have permission to edit it.'; // NEW
        if (snapshot(draft.cell) !== draft.original) return 'This structure changed elsewhere. Your draft is retained; cancel and reopen to edit the current version.'; // NEW
        if (!validPolygon(draft.points)) return 'Use at least three distinct corners and an outline without crossings.'; // NEW
        if (!inside(draft.points.map(p => transform(p, draft.geometry, draft.style)), draft.garden)) return 'Keep the entire footprint inside the garden.'; // NEW
        return ''; // NEW
    } // NEW

    function listen(target, event, callback) { // NEW
        target.addListener(event, callback); disposers.push(() => target.removeListener(callback)); // NEW
    } // NEW

    function scheduleRefresh() { // NEW
        if (destroyed) return; // NEW
        if (timer != null) clearTimeout(timer); // NEW
        timer = setTimeout(() => { timer = null; refresh(); }, 0); // NEW
    } // NEW

    function button(text, callback) { // NEW
        const node = document.createElement('button'); node.type = 'button'; node.textContent = text; // NEW
        node.style.cssText = 'padding:5px 8px;border:1px solid #b8b8b8;border-radius:4px;background:white;color:#222;font:12px Arial;cursor:pointer;text-align:left'; // NEW
        node.addEventListener('click', event => { event.stopPropagation(); callback(); }); // NEW
        return node; // NEW
    } // NEW

    function closePanel() { if (panel) panel.style.display = 'none'; } // NEW

    function rename(cell, text) { // NEW
        if (!editable(cell)) return cell.getAttribute('label') || 'Structure'; // NEW
        const label = String(text).trim() || 'Structure'; // NEW
        if (label !== cell.getAttribute('label')) { const value = cell.value.cloneNode(true); value.setAttribute('label', label); model.setValue(cell, value); } // NEW
        return label; // NEW
    } // NEW

    function buildPanel(cell) { // NEW
        if (panel) panel.remove(); // NEW
        panelCell = cell; panel = document.createElement('div'); panel.className = 'trellis-structure-overlay'; // NEW
        panel.style.cssText = 'position:absolute;z-index:10020;display:flex;flex-direction:column;gap:4px;padding:4px;background:rgba(255,255,255,.96);border:1px solid #c7c7cc;border-radius:6px;box-shadow:0 2px 8px #0003;font:12px Arial;max-width:280px;pointer-events:auto'; // NEW
        panel.style.zIndex = String(GRAPH_OVERLAY_Z.CONTROL); // NEW
        panel.addEventListener('mousedown', event => event.stopPropagation()); panel.addEventListener('click', event => event.stopPropagation()); // NEW
        panel.addEventListener('keydown', event => event.stopPropagation()); // NEW
        const input = document.createElement('input'); input.type = 'text'; input.setAttribute('aria-label', 'Structure name'); input.value = cell.getAttribute('label') || 'Structure'; // CHANGE: callbacks own this field even after another panel is created.
        input.style.cssText = 'padding:3px 5px;border:1px solid #b8b8b8;border-radius:4px;font:600 12px Arial'; // CHANGE
        const stopInputEvent = event => event.stopPropagation(); // NEW: match the garden module input's event isolation without blocking native input defaults.
        for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'keypress', 'keyup']) input.addEventListener(type, stopInputEvent); // NEW
        let initial = input.value; // CHANGE
        input.addEventListener('focus', () => { initial = input.value; }); // CHANGE
        input.addEventListener('blur', () => { if (!session) input.value = rename(cell, input.value); }); // CHANGE
        input.addEventListener('keydown', event => { // CHANGE
            stopInputEvent(event); // NEW
            if (event.key === 'Enter') { input.value = rename(cell, input.value); input.blur(); event.preventDefault(); } // CHANGE
            if (event.key === 'Escape') { input.value = initial; event.preventDefault(); } // CHANGE
        }); // CHANGE
        nameInput = input; panel.appendChild(input); // CHANGE
        if (session) { // NEW
            panel.appendChild(button('Done', done)); panel.appendChild(button('Cancel', cancel)); // NEW
        } else { // NEW
            panel.appendChild(button('Edit Footprint', () => editFootprint(cell))); // NEW
            panel.appendChild(button('Remove Structure', () => { if (editable(cell)) graph.removeCells([cell]); })); // NEW
        } // NEW
        const status = document.createElement('div'); status.className = 'trellis-structure-status'; status.setAttribute('role', 'status'); panel.appendChild(status); // NEW
        graph.container.appendChild(panel); graph.__trellisOverlayVisibility?.mark(panel); // NEW
    } // NEW

    function refresh() { // NEW
        if (session) drawPreview(session); // NEW
        const selected = graph.getSelectionCells(), cell = session?.cell || (selected.length === 1 && isStructure(selected[0]) ? selected[0] : null); // NEW
        const activeMode = window.Trellis?.interactionModes?.getActive(); // NEW
        if (!cell || (!session && (!model.contains(cell) || hiddenCell === cell || activeMode || window.Trellis?.users?.isTeamPermissionModeActive?.()))) { closePanel(); return; } // NEW
        const state = graph.view.getState(cell) || session?.lastState; if (!state) { closePanel(); return; } // NEW
        if (session) session.lastState = { x: state.x, y: state.y, width: state.width }; // NEW: deletion retains an accessible Cancel control and stale-draft explanation.
        if (cell !== panelCell || !panel || panel.dataset.editing !== String(!!session)) { buildPanel(cell); panel.dataset.editing = String(!!session); } // NEW
        panel.style.display = 'flex'; // NEW
        panel.style.left = Math.round(state.x + state.width + 8) + 'px'; panel.style.top = Math.round(state.y + 8) + 'px'; // NEW
        if (document.activeElement !== nameInput) nameInput.value = cell.getAttribute('label') || 'Structure'; // NEW
        nameInput.disabled = !!session || !editable(cell); // NEW
        const error = session ? draftError(session) : ''; // NEW
        panel.querySelector('.trellis-structure-status').textContent = error || message; // NEW
        panel.querySelectorAll('button').forEach(node => { node.disabled = node.textContent === 'Cancel' ? false : !!error || !editable(cell); }); // NEW
    } // NEW

    /** Map a parent-local point through its native rendered state, including rotation and flip. */ // NEW
    function screenPoint(draft, point) { // NEW
        const state = graph.view.getState(draft.cell), p = transform(point, draft.geometry, draft.style), scale = graph.view.scale; // NEW
        return new mxPoint(state.x + (p[0] - draft.geometry.x) * scale, state.y + (p[1] - draft.geometry.y) * scale); // NEW
    } // NEW

    function drawPreview(draft) { // NEW
        if (!graph.view.getState(draft.cell)) return; // NEW
        const points = (draft.previewPoints || draft.points).map(p => screenPoint(draft, p)); points.push(points[0]); // NEW
        if (!draft.preview) { draft.preview = new mxPolyline(points, '#2563eb', 2); draft.preview.isDashed = true; draft.preview.pointerEvents = false; draft.preview.svgStrokeTolerance = 0; draft.preview.init(graph.view.getOverlayPane()); draft.preview.node.style.pointerEvents = 'none'; } // NEW
        draft.preview.points = points; draft.preview.redraw(); // NEW
    } // NEW

    function refreshHandles() { // NEW
        const cell = session?.cell; if (!cell) return; // NEW
        const state = graph.view.getState(cell); if (state) graph.selectionCellsHandler.updateHandler(state); // NEW
    } // NEW

    function updatePoints(points, corner) { // NEW
        if (!session) return false; // NEW
        const proposed = { ...session, points }, error = draftError(proposed); // NEW
        session.previewPoints = null; message = error; // NEW
        if (!error) { session.points = copy(points); session.selectedCorner = corner; } // NEW
        scheduleRefresh(); setTimeout(refreshHandles, 0); // NEW
        return !error; // NEW
    } // NEW

    function moveCorner(index, point) { // NEW
        if (!session || !session.points[index]) return false; // NEW
        const points = copy(session.points); points[index] = point.slice(); return updatePoints(points, index); // NEW
    } // NEW

    function insertCorner(index, point) { // NEW
        if (!session || !session.points[index]) return false; // NEW
        const points = copy(session.points); points.splice(index + 1, 0, point.slice()); return updatePoints(points, index + 1); // NEW
    } // NEW

    function removeCorner(index) { // NEW
        if (!session || !session.points[index]) return false; // NEW
        const points = copy(session.points); points.splice(index, 1); return updatePoints(points, null); // NEW
    } // NEW

    /** A specialized native handler supplies corner/midpoint handles without resize or rotation controls. */ // NEW
    function FootprintHandler(state) { this.rotationEnabled = false; mxVertexHandler.call(this, state); } // NEW
    mxUtils.extend(FootprintHandler, mxVertexHandler); // NEW
    FootprintHandler.prototype.createSizers = function () { return []; }; // NEW
    FootprintHandler.prototype.createCustomHandles = function () { // NEW
        const draft = session; if (!draft || this.state.cell !== draft.cell) return []; // NEW
        const handles = []; // NEW
        draft.points.forEach((point, index) => { // NEW
            [false, true].forEach(midpoint => { // NEW
                const next = draft.points[(index + 1) % draft.points.length], original = midpoint ? [(point[0] + next[0]) / 2, (point[1] + next[1]) / 2] : point; // NEW
                const handle = new mxHandle(this.state, 'crosshair'); handle.ignoreGrid = false; // NEW
                handle.shape.fill = midpoint ? '#ffffff' : '#2563eb'; handle.shape.redraw(); // NEW
                handle.shape.node.setAttribute('data-structure-handle', (midpoint ? 'edge-' : 'corner-') + index); // NEW
                mxEvent.addListener(handle.shape.node, 'mousedown', () => { draft.selectedCorner = midpoint ? null : index; }); // NEW
                handle.getPosition = function (bounds) { const p = this.point || original; return new mxPoint(bounds.x + p[0] - draft.geometry.x, bounds.y + p[1] - draft.geometry.y); }; // NEW
                handle.setPosition = function (bounds, p) { // NEW
                    this.point = [p.x - bounds.x + draft.geometry.x, p.y - bounds.y + draft.geometry.y]; // NEW
                    const points = copy(draft.points); if (midpoint) points.splice(index + 1, 0, this.point); else points[index] = this.point; // NEW
                    draft.previewPoints = points; drawPreview(draft); // NEW
                }; // NEW
                handle.positionChanged = function () { drawPreview(draft); }; // NEW
                handle.execute = function () { if (session === draft && this.point) (midpoint ? insertCorner : moveCorner)(index, this.point); }; // NEW
                handle.reset = function () { this.point = null; draft.previewPoints = null; drawPreview(draft); this.redraw(); }; // NEW
                handles.push(handle); // NEW
            }); // NEW
        }); // NEW
        return handles; // NEW
    }; // NEW
    const createHandler = graph.createVertexHandler; // NEW
    graph.createVertexHandler = function (state) { return session && state.cell === session.cell ? new FootprintHandler(state) : createHandler.apply(this, arguments); }; // NEW

    function confirmDiscard() { // NEW
        if (!session || equal(session.previewPoints || session.points, session.initialPoints)) return Promise.resolve(true); // CHANGE: in-progress handle previews are uncommitted changes too.
        if (session.confirmation) return session.confirmation; // NEW
        const draft = session; // NEW
        draft.confirmation = new Promise(resolve => { // NEW
            const dialog = document.createElement('div'); dialog.className = 'trellis-structure-discard'; dialog.setAttribute('role', 'alertdialog'); dialog.setAttribute('aria-modal', 'true'); // NEW
            dialog.style.cssText = 'position:fixed;z-index:2000000001;left:50%;top:35%;transform:translate(-50%,-50%);padding:16px;background:white;border:1px solid #999;border-radius:6px;box-shadow:0 4px 24px #0005;font:13px Arial'; // NEW
            const text = document.createElement('p'); text.textContent = 'Discard your footprint changes?'; dialog.appendChild(text); // NEW
            const finish = result => { dialog.remove(); draft.confirmation = null; draft.dismissConfirmation = null; resolve(result); }; // NEW
            dialog.appendChild(button('Keep Editing', () => finish(false))); dialog.appendChild(button('Discard Changes', () => finish(true))); // NEW
            dialog.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false); } if (event.key === 'Tab') { event.preventDefault(); const buttons = dialog.querySelectorAll('button'); (document.activeElement === buttons[0] ? buttons[1] : buttons[0]).focus(); } }); // NEW
            graph.container.appendChild(dialog); dialog.querySelector('button').focus(); draft.dismissConfirmation = () => finish(false); // NEW
        }); // NEW
        return draft.confirmation; // NEW
    } // NEW

    function finishEditing() { // NEW
        const previous = session; if (!previous) return; // NEW
        graph.selectionCellsHandler.getHandler(previous.cell)?.reset(); // NEW: do not transfer an active footprint handle into the ordinary vertex handler.
        session = null; previous.dismissConfirmation?.(); previous.preview?.destroy(); message = ''; // NEW
        unregisterHistory(previous); // NEW
        window.Trellis?.interactionModes?.release(MODE, previous.ownerId); // NEW
        const state = graph.view.getState(previous.cell); if (state) graph.selectionCellsHandler.updateHandler(state); // NEW
        scheduleRefresh(); // NEW
    } // NEW

    async function cancel() { // NEW
        const draft = session; if (draft && await confirmDiscard() && session === draft) finishEditing(); // NEW
    } // NEW

    /** Footprints participate in the existing first-command-dismisses-preview history policy. */ // NEW
    function registerHistory(draft) { // NEW
        const owners = graph.__trellisPlantingPreviewDrafts ||= new Map(); // NEW: load order does not require the planting controller to be installed first.
        draft.historyOwner = { // NEW
            isActive: () => session === draft, // NEW
            beforeDiscard: () => session === draft && (equal(draft.previewPoints || draft.points, draft.initialPoints) ? true : confirmDiscard()), // NEW
            discard: () => { if (session === draft) finishEditing(); } // NEW
        }; // NEW
        owners.set(MODE, draft.historyOwner); graph.__trellisPlantingPreviewHistory?.refreshActions(); // NEW
    } // NEW

    function unregisterHistory(draft) { // NEW
        const owners = graph.__trellisPlantingPreviewDrafts; // NEW
        if (owners?.get(MODE) === draft.historyOwner) owners.delete(MODE); // NEW
        graph.__trellisPlantingPreviewHistory?.refreshActions(); // NEW
    } // NEW

    async function editFootprint(cell) { // NEW
        if (!isStructure(cell) || !editable(cell) || !editable(model.getParent(cell))) return false; // NEW
        if (session?.cell === cell) return true; // NEW
        let points; try { points = readPoints(cell); } catch (error) { message = error.message; scheduleRefresh(); return false; } // NEW
        const garden = model.getParent(cell); if (!isGarden(garden)) return false; // NEW
        const modes = window.Trellis?.interactionModes, ownerId = MODE + ':' + cell.id; // NEW
        const hooks = { beforeClose: confirmDiscard, close: finishEditing }; // NEW
        if (modes && !(await (modes.requestAsync ? modes.requestAsync(MODE, ownerId, hooks) : modes.request(MODE, ownerId, hooks)))) return false; // NEW
        const geometry = model.getGeometry(cell).clone(), style = { ...graph.getCellStyle(cell) }; // NEW
        points = points.map(p => [geometry.x + p[0] * geometry.width, geometry.y + p[1] * geometry.height]); // NEW
        session = { cell, garden, geometry, style, points, initialPoints: copy(points), original: snapshot(cell), ownerId, selectedCorner: null }; // NEW
        registerHistory(session); // NEW
        hiddenCell = null; graph.setSelectionCell(cell); refreshHandles(); refresh(); // NEW
        return true; // NEW
    } // NEW

    /** Rebase the bounding box around the edited points without shifting rotated world positions. */ // NEW
    function done() { // NEW
        const draft = session; if (!draft) return false; // NEW
        const error = draftError(draft); if (error) { message = error; refresh(); return false; } // NEW
        if (equal(draft.points, draft.initialPoints)) { finishEditing(); return true; } // NEW
        const xs = draft.points.map(p => p[0]), ys = draft.points.map(p => p[1]), minX = Math.min(...xs), minY = Math.min(...ys), width = Math.max(...xs) - minX, height = Math.max(...ys) - minY; // NEW
        const points = draft.points.map(p => [(p[0] - minX) / width, (p[1] - minY) / height]), center = transform([minX + width / 2, minY + height / 2], draft.geometry, draft.style); // NEW
        const geometry = draft.geometry.clone(); geometry.x = center[0] - width / 2; geometry.y = center[1] - height / 2; geometry.width = width; geometry.height = height; // NEW
        const value = draft.cell.value.cloneNode(true); value.setAttribute(ATTR, JSON.stringify({ version: 1, points })); // NEW
        const style = mxUtils.setStyle(draft.cell.style, 'shape', stencil(points)); // NEW
        committing = true; model.beginUpdate(); // NEW
        try { model.setValue(draft.cell, value); model.setGeometry(draft.cell, geometry); model.setStyle(draft.cell, style); } finally { model.endUpdate(); committing = false; } // NEW
        if (snapshot(draft.cell) === draft.original) { message = 'The footprint change was rejected. Check your permissions and try again.'; refresh(); return false; } // NEW
        finishEditing(); return true; // NEW
    } // NEW

    function create(garden, modelPoint) { // NEW
        if (!isGarden(garden) || !editable(garden)) throw new Error('Select an editable garden module.'); // NEW
        const state = graph.view.getState(garden), geo = model.getGeometry(garden); // NEW
        if (!geo || geo.width <= EPS || geo.height <= EPS) throw new Error('The garden needs a positive width and height.'); // NEW
        const size = Math.min(DEFAULT_SIZE_UNITS, geo.width, geo.height), scale = graph.view.scale; // NEW
        const origin = state ? { x: state.x / scale - graph.view.translate.x, y: state.y / scale - graph.view.translate.y } : { x: geo.x, y: geo.y }; // NEW
        const x = Math.max(0, Math.min(geo.width - size, (modelPoint?.x ?? origin.x + geo.width / 2) - origin.x - size / 2)); // NEW
        const y = Math.max(0, Math.min(geo.height - size, (modelPoint?.y ?? origin.y + geo.height / 2) - origin.y - size / 2)); // NEW
        const value = mxUtils.createXmlDocument().createElement('GardenStructure'); value.setAttribute('garden_structure', '1'); value.setAttribute('label', 'Structure'); value.setAttribute(ATTR, JSON.stringify({ version: 1, points: RECT })); // NEW
        const cell = new mxCell(value, new mxGeometry(x, y, size, size), 'shape=' + stencil(RECT) + ';whiteSpace=wrap;html=0;fillColor=#94a3b8;fillOpacity=35;strokeColor=#475569;strokeWidth=2;container=0;connectable=0;'); cell.setVertex(true); cell.setConnectable(false); // NEW
        model.beginUpdate(); try { graph.addCell(cell, garden); } finally { model.endUpdate(); } // NEW
        if (!model.contains(cell)) throw new Error('Structure creation was rejected by permissions.'); // NEW
        hiddenCell = null; message = ''; graph.setSelectionCell(cell); scheduleRefresh(); return cell; // NEW
    } // NEW

    /** Guard model entry points so programmatic transforms share native gesture containment. Undo uses native changes. */ // NEW
    const setGeometry = model.setGeometry; // NEW
    model.setGeometry = function (cell, geometry) { // NEW
        if (!committing && geometry && isStructure(cell)) { // NEW
            try { if (![geometry.x, geometry.y, geometry.width, geometry.height].every(Number.isFinite) || geometry.width <= EPS || geometry.height <= EPS || !inside(footprint(cell, geometry), model.getParent(cell))) return model.getGeometry(cell); } catch (_) { return model.getGeometry(cell); } // NEW
        } // NEW
        if (!committing && geometry && isGarden(cell)) { // NEW
            let minWidth = 0, minHeight = 0; // NEW
            for (const child of model.getChildVertices(cell)) { // NEW
                if (!isStructure(child)) continue; // NEW
                let points; try { points = footprint(child); } catch (_) { const g = model.getGeometry(child); points = [[g.x + g.width, g.y + g.height]]; } // NEW
                minWidth = Math.max(minWidth, ...points.map(p => p[0])); minHeight = Math.max(minHeight, ...points.map(p => p[1])); // NEW
            } // NEW
            if (geometry.width < minWidth || geometry.height < minHeight) { geometry = geometry.clone(); geometry.width = Math.max(geometry.width, minWidth); geometry.height = Math.max(geometry.height, minHeight); } // NEW
        } // NEW
        if ((isStructure(cell) || isGarden(cell)) && geometry && model.getGeometry(cell)?.equals(geometry)) return model.getGeometry(cell); // NEW: rejected native resizes must not create no-op undo entries.
        return setGeometry.call(this, cell, geometry); // NEW
    }; // NEW
    const setStyle = model.setStyle; // NEW
    model.setStyle = function (cell, style) { // NEW
        if (!committing && isStructure(cell)) { // NEW
            const stylesheet = graph.getStylesheet(), proposed = stylesheet.getCellStyle(style, stylesheet.getDefaultVertexStyle()); // NEW: use native precedence, including named styles and repeated keys.
            try { if (!inside(footprint(cell, model.getGeometry(cell), proposed), model.getParent(cell))) return model.getStyle(cell); } catch (_) { return model.getStyle(cell); } // NEW
        } // NEW
        return setStyle.call(this, cell, style); // NEW
    }; // NEW
    const dropTarget = graph.isValidDropTarget; // NEW
    graph.isValidDropTarget = function (cell, cells) { if (isStructure(cell) || (cells || []).some(c => isStructure(c) && cell && cell !== model.getParent(c))) return false; return dropTarget.apply(this, arguments); }; // NEW
    for (const name of ['isCellMovable', 'isCellResizable', 'isCellRotatable', 'isCellDeletable', 'isCellEditable']) { // NEW
        const previous = graph[name]; if (typeof previous !== 'function') continue; // NEW
        graph[name] = function (cell) { return session && (cell === session.cell || cell === session.garden) ? false : previous.apply(this, arguments); }; // NEW
    } // NEW

    listen(graph.getSelectionModel(), mxEvent.CHANGE, async () => { // NEW
        clickStart = null; // NEW: even a selection change that returns before release invalidates the old click.
        if (restoringSelection) return; // NEW
        const cells = graph.getSelectionCells(); // NEW
        if (session && !model.contains(session.cell)) { scheduleRefresh(); return; } // NEW: external deletion retains the stale draft instead of treating native selection cleanup as navigation.
        if (session && (cells.length !== 1 || cells[0] !== session.cell)) { // NEW
            const draft = session, requested = cells.slice(); restoringSelection = true; graph.setSelectionCell(draft.cell); restoringSelection = false; // NEW
            if (await confirmDiscard() && session === draft) { finishEditing(); graph.setSelectionCells(requested.filter(cell => model.contains(cell))); } // NEW
        } else if (!session) { hiddenCell = null; message = ''; } // NEW
        scheduleRefresh(); // NEW
    }); // NEW
    listen(model, mxEvent.CHANGE, scheduleRefresh); // NEW
    for (const event of [mxEvent.SCALE, mxEvent.TRANSLATE, mxEvent.SCALE_AND_TRANSLATE]) listen(graph.view, event, scheduleRefresh); // NEW
    listen(graph, mxEvent.PAN, scheduleRefresh); // NEW
    listen(graph, 'trellisOverlayVisibilityChanged', refresh); // NEW
    let clickStart = null; // NEW
    function plainClick(event) { // NEW
        return !!event && !(mxEvent.isPopupTrigger?.(event)) && (event.button == null || event.button === 0) && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && Number(event.detail || 1) <= 1; // NEW
    } // NEW

    function overlayControl(event) { // NEW
        const source = event && mxEvent.getSource(event), element = source?.nodeType === 1 ? source : source?.parentElement; // NEW
        return !!element && (!!panel?.contains(element) || !!element.closest('input,select,textarea,button,[contenteditable=true]')); // NEW
    } // NEW

    function structureModeSuppressed() { // NEW
        return !!window.Trellis?.interactionModes?.getActive() || !!window.Trellis?.users?.isTeamPermissionModeActive?.(); // NEW
    } // NEW

    /** Snapshot eligibility before mxGraph changes selection; control/handle presses never start toggles. */ // NEW
    listen(graph, mxEvent.FIRE_MOUSE_EVENT, (_sender, event) => { // NEW
        if (event.getProperty('eventName') !== mxEvent.MOUSE_DOWN) return; // NEW
        clickStart = null; // NEW
        const me = event.getProperty('event'), evt = me.getEvent(); // NEW
        if (session || structureModeSuppressed() || !plainClick(evt) || overlayControl(evt) || graph.getSelectionCount() !== 1) return; // NEW
        const cell = graph.getSelectionCell(), handler = graph.selectionCellsHandler.getHandler(cell); // NEW
        if (!isStructure(cell) || me.getCell() !== cell || handler?.getHandleForEvent(me) != null || graph.__trellisWorkspaceHandleDragActive) return; // NEW
        clickStart = { cell, x: mxEvent.getClientX(evt), y: mxEvent.getClientY(evt), moved: false }; // CHANGE
    }); // NEW
    const mouse = { // NEW
        mouseDown() {}, // NEW: capture before native selection in FIRE_MOUSE_EVENT.
        mouseMove(_sender, me) { if (clickStart && Math.hypot(mxEvent.getClientX(me.getEvent()) - clickStart.x, mxEvent.getClientY(me.getEvent()) - clickStart.y) >= 4) clickStart.moved = true; }, // CHANGE: movement stays a drag even after returning to the press point.
        mouseUp(_sender, me) { // CHANGE
            const pending = clickStart; clickStart = null; // NEW
            const evt = me.getEvent(), source = mxEvent.getSource(evt); // NEW
            if (!pending || pending.moved || session || structureModeSuppressed() || !plainClick(evt) || overlayControl(evt) || !source || !graph.container.contains(source)) return; // NEW
            if (Math.hypot(mxEvent.getClientX(evt) - pending.x, mxEvent.getClientY(evt) - pending.y) >= 4 || graph.getSelectionCount() !== 1 || graph.getSelectionCell() !== pending.cell || me.getCell() !== pending.cell) return; // NEW
            hiddenCell = hiddenCell === pending.cell ? null : pending.cell; refresh(); // NEW: commit dismissal before a queued repaint can reveal the panel.
        } // CHANGE
    }; // NEW
    graph.addMouseListener(mouse); disposers.push(() => graph.removeMouseListener(mouse)); // NEW
    const cancelClick = () => { clickStart = null; }; // NEW
    for (const event of ['mouseup', 'pointerup', 'pointercancel', 'blur']) { window.addEventListener(event, cancelClick); disposers.push(() => window.removeEventListener(event, cancelClick)); } // CHANGE: graph release runs first; outside or late releases can only cancel.
    const keydown = event => { // NEW
        if (!session || event.target.closest?.('input,textarea,[contenteditable=true],.trellis-structure-discard')) return; // NEW
        if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cancel(); } // NEW
        if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopImmediatePropagation(); if (session.selectedCorner != null) removeCorner(session.selectedCorner); } // NEW
    }; // NEW
    document.addEventListener('keydown', keydown, true); disposers.push(() => document.removeEventListener('keydown', keydown, true)); // NEW
    const modeChanged = () => scheduleRefresh(); // NEW
    for (const event of ['trellisInteractionModeChanged', 'trellisTeamPermissionModeChanged']) { window.addEventListener(event, modeChanged); disposers.push(() => window.removeEventListener(event, modeChanged)); } // NEW
    const destroy = graph.destroy; // NEW
    graph.destroy = function () { destroyed = true; if (timer != null) clearTimeout(timer); session?.dismissConfirmation?.(); session?.preview?.destroy(); const previous = session; session = null; if (previous) { unregisterHistory(previous); window.Trellis?.interactionModes?.release(MODE, previous.ownerId); } panel?.remove(); disposers.forEach(dispose => dispose()); return destroy.apply(this, arguments); }; // CHANGE
    graph.__trellisStructures = { create, editFootprint, done, cancel, moveCorner, insertCorner, removeCorner, isStructure, validPolygon, footprint, getDraft: () => session && ({ cell: session.cell, points: copy(session.points), error: draftError(session) }) }; // NEW
}); // NEW
