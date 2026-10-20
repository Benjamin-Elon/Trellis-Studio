/**
 * Trellis plugin: UI Cleanup
 *
 * Keeps Trellis' primary drawing surface compact while preserving the host editor's
 * less common commands behind explicit overflow submenus.
 */

(function () {
    if (typeof window === 'undefined') return;

    window.Trellis = window.Trellis || {};
    window.Trellis.ui = window.Trellis.ui || {};

    const BUTTON_TOKENS = Object.freeze({
        open: { border: '#2563eb', color: '#1d4ed8', background: '#fff', hoverBackground: '#eff6ff' },
        add: { border: '#188038', color: '#166534', background: '#fff', hoverBackground: '#f0fdf4' },
        close: { border: '#b91c1c', color: '#b91c1c', background: '#fff', hoverBackground: '#fef2f2' }, // NEW
        danger: { border: '#b91c1c', color: '#fff', background: '#b91c1c', hoverBackground: '#991b1b' }, // CHANGE: destructive actions are red filled
        neutral: { border: '#6b7280', color: '#111827', background: '#fff', hoverBackground: '#f9fafb' },
        mode: { color: '#374151', background: '#fff', hoverBackground: '#ecfeff', activeColor: '#155e75' }, // CHANGE: joined view selectors share the irrigation Build/Analysis palette.
        focus: 'rgba(37, 99, 235, 0.28)',
        disabledOpacity: '0.55'
    });

    function normalizeButtonVariant(variant) {
        return BUTTON_TOKENS[variant] ? variant : 'neutral';
    }

    function classForVariant(variant) {
        return 'trellis-button trellis-button-' + normalizeButtonVariant(variant);
    }

    function ensureButtonStyles(doc) {
        const owner = doc || (typeof document !== 'undefined' ? document : null);
        if (!owner || owner.getElementById('trellis-shared-button-styles')) return;

        const style = owner.createElement('style');
        style.id = 'trellis-shared-button-styles';
        style.textContent = [
            '.trellis-button{box-sizing:border-box;border-radius:6px;cursor:pointer;font:12px Arial,sans-serif;padding:6px 10px;background:#fff;transition:background-color 120ms ease,border-color 120ms ease,color 120ms ease}',
            '.trellis-button-open{border:1px solid #2563eb;color:#1d4ed8}',
            '.trellis-button-open:hover{background:#eff6ff}',
            '.trellis-button-open.trellis-button-active{background:#eff6ff;color:#1e3a8a;font-weight:700}', // CHANGE: share the light-blue active treatment with open-style buttons
            '.trellis-button-open.trellis-button-active:hover{background:#eff6ff}', // CHANGE: keep active open buttons visually stable on hover
            '.trellis-button-add{border:1px solid #188038;color:#166534}',
            '.trellis-button-add:hover{background:#f0fdf4}',
            '.trellis-button-add.trellis-button-filled{background:#188038;color:#fff}',
            '.trellis-button-add.trellis-button-filled:hover{background:#166534}',
            '.trellis-button-close{border:1px solid #b91c1c;color:#b91c1c}', // NEW
            '.trellis-button-close:hover{background:#fef2f2}', // NEW
            '.trellis-button-danger{border:1px solid #b91c1c;background:#b91c1c;color:#fff}', // CHANGE
            '.trellis-button-danger:hover{background:#991b1b;border-color:#991b1b}', // CHANGE
            '.trellis-button-neutral{border:1px solid #6b7280;color:#111827}',
            '.trellis-button-neutral:hover{background:#f9fafb}',
            '.trellis-button-compact{padding:3px 6px;font-size:12px}',
            '.trellis-button:disabled,.trellis-button[aria-disabled="true"]{opacity:.55;cursor:not-allowed}',
            '.trellis-button:focus-visible{outline:2px solid #2563eb;outline-offset:2px;box-shadow:0 0 0 3px rgba(37,99,235,.28)}', // CHANGE: mode selectors override the external focus ring below.
            '.trellis-button-mode{border:0;border-radius:0;color:#374151;white-space:nowrap}', // CHANGE: the containing selector owns the rounded border.
            '.trellis-button-mode.trellis-button-active{background:#ecfeff;color:#155e75;font-weight:700}', // CHANGE: match the irrigation analysis selector.
            '.trellis-button-mode:focus-visible{outline:2px solid #155e75;outline-offset:-2px;box-shadow:none}' // CHANGE: keep keyboard focus visible inside the selector's clipped border.
        ].join('\n');
        (owner.head || owner.documentElement || owner.body).appendChild(style);
    }

    /** Style semantic buttons; the mode variant uses borderless segments inside a joined selector, with options.active marking the selected view. */ // CHANGE
    function applyButtonStyle(button, variant, options) {
        if (!button || !button.style) return button;
        const opts = options || {};
        const normalized = normalizeButtonVariant(variant);
        const tokens = BUTTON_TOKENS[normalized];
        ensureButtonStyles(button.ownerDocument);

        const active = opts.active === true && (normalized === 'open' || normalized === 'mode'); // CHANGE: open buttons and joined mode selectors support active styling.
        ['trellis-button', 'trellis-button-open', 'trellis-button-add', 'trellis-button-close', 'trellis-button-danger', 'trellis-button-neutral', 'trellis-button-mode', 'trellis-button-compact', 'trellis-button-filled', 'trellis-button-active'].forEach(function (className) { // CHANGE: clear prior active and semantic state when restyling.
            if (button.classList) button.classList.remove(className);
        });
        if (button.classList) {
            button.classList.add('trellis-button', 'trellis-button-' + normalized);
            if (opts.compact) button.classList.add('trellis-button-compact');
            if (opts.filled) button.classList.add('trellis-button-filled');
            if (active) button.classList.add('trellis-button-active'); // CHANGE: expose active state to shared CSS.
        }
        button.setAttribute('data-trellis-button-variant', normalized);
        button.type = button.type || 'button';
        button.style.border = normalized === 'mode' ? '0' : '1px solid ' + tokens.border; // CHANGE: joined mode buttons use their group's border.
        button.style.borderRadius = normalized === 'mode' ? '0' : opts.radius || '6px'; // CHANGE: keep segment edges joined.
        button.style.background = active ? tokens.hoverBackground : (opts.filled && normalized === 'add' ? tokens.border : tokens.background); // CHANGE: use the selected variant's active fill.
        button.style.color = active ? tokens.activeColor || '#1e3a8a' : (opts.filled && normalized === 'add' ? '#fff' : tokens.color); // CHANGE: mode selectors use the irrigation active text color.
        button.style.cursor = button.disabled ? 'not-allowed' : 'pointer';
        button.style.font = opts.font || '12px Arial, sans-serif';
        button.style.fontWeight = active ? '700' : (opts.fontWeight || ''); // CHANGE: emphasize the selected view.
        button.style.padding = opts.compact ? '3px 6px' : (opts.padding || '6px 10px');
        button.style.boxSizing = 'border-box';
        return button;
    }

    function button(label, variant, onClick, options) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = String(label == null ? '' : label);
        applyButtonStyle(b, variant, options);
        if (options && options.title != null) b.title = String(options.title);
        if (options && options.ariaLabel != null) b.setAttribute('aria-label', String(options.ariaLabel));
        if (typeof onClick === 'function') b.addEventListener('click', onClick);
        return b;
    }

    window.Trellis.ui.buttonTokens = BUTTON_TOKENS;
    window.Trellis.ui.applyButtonStyle = window.Trellis.ui.applyButtonStyle || applyButtonStyle;
    window.Trellis.ui.button = window.Trellis.ui.button || button;
    window.Trellis.ui.classForVariant = window.Trellis.ui.classForVariant || classForVariant;
    window.Trellis.ui.ensureButtonStyles = window.Trellis.ui.ensureButtonStyles || ensureButtonStyles;

    let overlayGraphSequence = 0; // NEW

    /** Keep informational DOM alive, but remove it from rendering and hit-testing during manipulation. */ // NEW
    function installOverlayVisibility(graph) { // NEW
        if (!graph || !graph.container) return; // NEW
        if (graph.__trellisOverlayVisibility) return graph.__trellisOverlayVisibility; // NEW
        const doc = graph.container.ownerDocument, win = doc.defaultView; // NEW
        const owner = 'trellis-overlay-' + (++overlayGraphSequence); // NEW
        const selector = '[data-trellis-overlay-owner="' + owner + '"]'; // NEW
        const style = doc.createElement('style'), sources = new Set(); // NEW
        let suppressed = false, pendingFrame = null, destroyed = false; // NEW
        (doc.head || doc.documentElement).appendChild(style); // NEW
        const requestFrame = win.requestAnimationFrame ? win.requestAnimationFrame.bind(win) : callback => win.setTimeout(callback, 0); // NEW
        const cancelFrame = win.cancelAnimationFrame ? win.cancelAnimationFrame.bind(win) : win.clearTimeout.bind(win); // NEW

        /** Owners reposition after normal view validation; CSS is removed before the browser paints. */ // NEW
        function notify() { // NEW
            if (graph.fireEvent && typeof mxEventObject !== 'undefined') graph.fireEvent(new mxEventObject('trellisOverlayVisibilityChanged', 'suppressed', suppressed)); // NEW
        } // NEW
        function restoreSoon() { // NEW
            if (!suppressed || pendingFrame != null || destroyed) return; // NEW
            pendingFrame = requestFrame(function () { // NEW
                pendingFrame = null; // NEW
                if (sources.size || destroyed) return; // NEW
                suppressed = false; style.textContent = ''; // NEW: preserve each owner's inline display and visibility policies.
                notify(); // NEW: synchronous measurement is now possible, before this frame paints.
            }); // NEW
        } // NEW
        const api = graph.__trellisOverlayVisibility = { // NEW
            mark(node) { if (node && node.setAttribute && !destroyed) node.setAttribute('data-trellis-overlay-owner', owner); return node; }, // NEW
            begin(source) { // NEW
                if (destroyed || source == null) return; // NEW
                sources.add(source); // NEW
                if (pendingFrame != null) { cancelFrame(pendingFrame); pendingFrame = null; } // NEW
                if (!suppressed) { // NEW
                    suppressed = true; // NEW
                    style.textContent = selector + '{display:none!important;pointer-events:none!important}'; // NEW
                    notify(); // NEW
                } // NEW
            }, // NEW
            end(source) { sources.delete(source); if (!sources.size) restoreSoon(); }, // NEW
            isSuppressed() { return suppressed; } // NEW
        }; // NEW
        function release() { sources.clear(); restoreSoon(); } // NEW
        function cancel() { // NEW
            const active = Array.from(sources); sources.clear(); // NEW
            try { active.forEach(source => { if (source && typeof source.reset === 'function') source.reset(); }); } // NEW
            finally { restoreSoon(); } // NEW
        } // NEW
        const releases = ['mouseup', 'pointerup', 'touchend']; // NEW
        const cancellations = ['pointercancel', 'touchcancel', 'blur']; // NEW
        releases.forEach(name => win.addEventListener(name, release)); // NEW: bubble after native document commits.
        cancellations.forEach(name => win.addEventListener(name, cancel)); // NEW
        function destroy() { // NEW
            if (destroyed) return; // NEW
            destroyed = true; suppressed = false; sources.clear(); // NEW
            if (pendingFrame != null) cancelFrame(pendingFrame); // NEW
            style.remove(); // NEW
            releases.forEach(name => win.removeEventListener(name, release)); // NEW
            cancellations.forEach(name => win.removeEventListener(name, cancel)); // NEW
            if (graph.removeListener) { graph.removeListener(cancel); graph.removeListener(destroy); } // NEW
        } // NEW
        if (graph.addListener && typeof mxEvent !== 'undefined') { // NEW
            graph.addListener(mxEvent.ESCAPE, cancel); graph.addListener(mxEvent.DESTROY, destroy); // NEW
        } // NEW
        const graphDestroy = graph.destroy; // NEW
        if (typeof graphDestroy === 'function') graph.destroy = function () { // NEW: stock mxGraph does not emit a DESTROY event.
            try { cancel(); return graphDestroy.apply(this, arguments); } // NEW
            finally { destroy(); } // NEW
        }; // NEW
        installOverlayGestureHooks(); // NEW
        return api; // NEW
    } // NEW

    /** Wrap shared handlers once, resolving the graph-local controller on every call. */ // NEW
    function installOverlayGestureHooks() { // NEW
        function wrap(prototype, method, before, after) { // NEW
            if (!prototype || typeof prototype[method] !== 'function') return; // NEW
            const original = prototype[method]; // NEW
            prototype[method] = function () { // NEW
                const api = (this.graph || this.currentGraph)?.__trellisOverlayVisibility; // NEW
                if (before) before.call(this, api, arguments); // NEW
                try { return original.apply(this, arguments); } // NEW
                finally { if (after) after.call(this, api, arguments); } // NEW
            }; // NEW
        } // NEW
        function end(api) { if (api) api.end(this); } // NEW
        if (typeof mxGraphHandler !== 'undefined' && !mxGraphHandler.prototype.__trellisOverlayGestureHooks) { // NEW
            const prototype = mxGraphHandler.prototype; prototype.__trellisOverlayGestureHooks = true; // NEW
            wrap(prototype, 'mouseMove', function (api, args) { // NEW
                const me = args[1], graph = this.graph; // NEW
                if (!api || !me || me.isConsumed() || !graph.isMouseDown || !this.cell || this.suspended) return; // NEW
                const delta = this.first ? this.getDelta(me) : null, evt = me.getEvent(); // NEW
                const dx = delta ? delta.x : mxEvent.getClientX(evt) - this.mouseDownX; // NEW
                const dy = delta ? delta.y : mxEvent.getClientY(evt) - this.mouseDownY; // NEW
                if ((this.first || this.delayedSelection) && (Math.abs(dx) > graph.tolerance || Math.abs(dy) > graph.tolerance)) api.begin(this); // NEW: hide before native drop-target evaluation, including handle-delayed starts.
            }); // NEW
            ['mouseUp', 'reset', 'destroy'].forEach(method => wrap(prototype, method, null, end)); // NEW
        } // NEW
        if (typeof mxVertexHandler !== 'undefined' && !mxVertexHandler.prototype.__trellisOverlayGestureHooks) { // NEW
            const prototype = mxVertexHandler.prototype; prototype.__trellisOverlayGestureHooks = true; // NEW
            wrap(prototype, 'mouseMove', function (api, args) { // NEW
                const me = args[1]; // NEW
                if (!api || !me || me.isConsumed() || this.index == null || !(this.index >= 0 || this.index === mxEvent.ROTATION_HANDLE)) return; // NEW
                const dx = me.getGraphX() - this.startX, dy = me.getGraphY() - this.startY; // NEW
                const moved = dx !== 0 || dy !== 0; // NEW
                if (moved && (!this.inTolerance || mxEvent.isMouseEvent(me.getEvent()) || Math.abs(dx) > this.graph.tolerance || Math.abs(dy) > this.graph.tolerance)) api.begin(this); // NEW: match native mouse/touch resize tolerance without treating a press as movement.
            }); // NEW
            ['mouseUp', 'reset', 'destroy'].forEach(method => wrap(prototype, method, null, end)); // NEW
        } // NEW
        if (typeof mxDragSource !== 'undefined' && !mxDragSource.prototype.__trellisOverlayGestureHooks) { // NEW
            const prototype = mxDragSource.prototype; prototype.__trellisOverlayGestureHooks = true; // NEW
            wrap(prototype, 'dragEnter', function (_api, args) { args[0]?.__trellisOverlayVisibility?.begin(this); }); // NEW
            wrap(prototype, 'dragExit', null, function (api, args) { (args[0]?.__trellisOverlayVisibility || api)?.end(this); }); // NEW
            ['mouseUp', 'reset'].forEach(method => wrap(prototype, method, null, end)); // NEW
        } // NEW
    } // NEW
    window.Trellis.ui.installOverlayVisibility = window.Trellis.ui.installOverlayVisibility || installOverlayVisibility; // NEW: retain graph ownership sequencing if the plugin is loaded twice.
})();

Draw.loadPlugin(function (ui) {
    if (!ui || ui.__trellisUiCleanupInstalled) {
        return;
    }

    ui.__trellisUiCleanupInstalled = true;
    window.Trellis.ui.installOverlayVisibility(ui.editor && ui.editor.graph); // NEW

    /** Rebind replaced labels so native stopEditing restores the live node without restarting the draft. */ // NEW
    function installEditingLabelGuard(graph) { // NEW
        const renderer = graph && graph.cellRenderer; // NEW
        if (!renderer || renderer.__trellisEditingLabelGuard || typeof renderer.redrawLabel !== 'function') return; // NEW
        const redrawLabel = renderer.redrawLabel; // NEW
        renderer.redrawLabel = function (state) { // NEW
            const result = redrawLabel.apply(this, arguments); // NEW: preserve the renderer's normal creation, sizing and visibility policy first.
            const editor = graph.cellEditor, text = state && state.text; // NEW
            if (editor && state && editor.editingCell === state.cell && text && text.node && // NEW
                typeof editor.isHideLabel === 'function' && editor.isHideLabel(state)) { // NEW
                editor.textShape = text; editor.textNode = text.node; // NEW: resize and completion must refer to the replacement, never the destroyed label.
                text.node.style.visibility = 'hidden'; // NEW: apply synchronously before the browser can paint the saved label beneath the draft.
            } // NEW
            return result; // NEW
        }; // NEW
        renderer.__trellisEditingLabelGuard = true; // NEW: graph-local installation leaves other graphs and shared prototypes untouched.
    } // NEW
    installEditingLabelGuard(ui.editor && ui.editor.graph); // NEW

    /** Enroll new edges only; keep anchors and U legs in the initiating edit, never in a render-time edit. */ // NEW
    function installEdgeAttachmentGuard(graph) { // NEW
        if (!graph || !graph.model || typeof graph.model.addListener !== 'function' || graph.__trellisEdgeAttachmentGuard) return; // NEW
        const model = graph.model, view = graph.view, flag = 'trellisPreserveAttachment'; // NEW
        const known = new WeakSet(), pending = new Set(); // NEW
        let activeRoutes = null, endpointGesture = null, adjusting = false; // CHANGE

        /** Remember identity rather than IDs: pasted clones are new, undo and reparenting are not. */ // NEW
        function visit(cell, callback) { // NEW
            if (!cell) return; // NEW
            callback(cell); // NEW
            for (let i = 0; i < model.getChildCount(cell); i++) visit(model.getChildAt(cell, i), callback); // NEW
        } // NEW
        visit(model.getRoot(), cell => { known.add(cell); if (participates(cell)) pending.add(cell); }); // NEW
        function participates(edge) { return model.isEdge(edge) && graph.getCellStyle(edge)[flag] == '1'; } // NEW: read persisted style even before model notifications refresh rendered states.
        function finite(point) { return point && Number.isFinite(point.x) && Number.isFinite(point.y); } // NEW
        function world(point) { return new mxPoint(point.x / view.scale - view.translate.x, point.y / view.scale - view.translate.y); } // NEW
        function local(point, state) { return new mxPoint(point.x - state.origin.x, point.y - state.origin.y); } // NEW

        const sides = { west: { x: -1, y: 0, mask: 1 }, north: { x: 0, y: -1, mask: 2 }, south: { x: 0, y: 1, mask: 4 }, east: { x: 1, y: 0, mask: 8 } }; // NEW
        function sideKey(source) { return source ? 'sourcePortConstraint' : 'targetPortConstraint'; } // NEW

        /** Convert a shape-local attachment normal through the same rotation/direction/flip mechanics as its point. */ // NEW
        function constraintSide(terminal, constraint, fallback) { // NEW
            if (!terminal || !constraint || !finite(constraint.point)) return fallback || null; // NEW
            const p = constraint.point, distances = { west: Math.abs(p.x), east: Math.abs(1 - p.x), north: Math.abs(p.y), south: Math.abs(1 - p.y) }; // NEW
            const name = Object.keys(sides).sort((a, b) => distances[a] - distances[b])[0]; // NEW
            if (distances[name] > 0.25) return fallback || null; // NEW: interior/custom ports use their declared port restrictions.
            const probe = p.clone(); probe.x += sides[name].x * 0.01; probe.y += sides[name].y * 0.01; // NEW
            const a = graph.getConnectionPoint(terminal, new mxConnectionConstraint(p, false), false); // NEW
            const b = graph.getConnectionPoint(terminal, new mxConnectionConstraint(probe, false), false); // NEW
            if (!finite(a) || !finite(b)) return fallback || null; // NEW
            return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? (b.x < a.x ? 'west' : 'east') : (b.y < a.y ? 'north' : 'south'); // NEW
        } // NEW

        /** Shape/port restrictions have priority; edge styles represent the explicit gesture side otherwise. */ // NEW
        function allowedSide(state, terminal, source, desired) { // NEW
            if (!terminal) return desired; // CHANGE
            const port = view.getTerminalPort(state, terminal, source); // NEW
            if (!port || port.style.portConstraint == null) return desired; // NEW
            const mask = mxUtils.getPortConstraints(port, state, source, mxConstants.DIRECTION_MASK_ALL); // NEW
            return desired && (mask & sides[desired].mask) ? desired : Object.keys(sides).find(name => mask & sides[name].mask) || null; // CHANGE
        } // NEW

        /** Write only the preview cell's style; a live model cell is never changed by rendering. */ // NEW
        function previewSide(state, terminal, source, constraint) { // NEW
            if (!state) return; // NEW
            const port = terminal && view.getTerminalPort(state, terminal, source); // NEW
            const name = constraint && finite(constraint.point) ? allowedSide(state, terminal, source, constraintSide(port, constraint)) : null; // CHANGE
            const key = sideKey(source); // NEW
            if (name) { state.style[key] = name; state.style[flag] = '1'; } else delete state.style[key]; // NEW
            if (!model.contains(state.cell)) { // NEW
                state.cell.style = mxUtils.setStyle(state.cell.style, key, name); // NEW
                if (name) state.cell.style = mxUtils.setStyle(state.cell.style, flag, '1'); // NEW
            } // NEW
        } // NEW

        /** Resolve persisted side intent into screen-facing cardinal directions as shapes rotate or flip. */ // NEW
        function endpointSide(state, terminal, source) { // NEW
            const saved = state.style[sideKey(source)]; // NEW
            if (state.style[flag] != '1' || !sides[saved] || !terminal) return null; // NEW
            const port = view.getTerminalPort(state, terminal, source); // NEW
            const constraint = graph.getConnectionConstraint(state, terminal, source); // NEW
            const name = allowedSide(state, terminal, source, constraintSide(port, constraint, saved)); // NEW
            return name && { name, terminal: port, ...sides[name] }; // NEW
        } // NEW

        /** Remove redundant points without removing a deliberate reversal around a terminal. */ // NEW
        function simplifyPoints(points, tolerance) { // NEW
            const result = []; // NEW
            points.forEach(point => { // NEW
                if (!finite(point)) return; // NEW
                const last = result[result.length - 1]; // NEW
                if (last && Math.abs(last.x - point.x) < tolerance && Math.abs(last.y - point.y) < tolerance) return; // NEW
                result.push(point.clone()); // NEW
                while (result.length >= 3) { // NEW
                    const [a, b, c] = result.slice(-3); // NEW
                    const vertical = Math.abs(a.x - b.x) < tolerance && Math.abs(b.x - c.x) < tolerance && (b.y - a.y) * (c.y - b.y) >= 0; // NEW
                    const horizontal = Math.abs(a.y - b.y) < tolerance && Math.abs(b.y - c.y) < tolerance && (b.x - a.x) * (c.x - b.x) >= 0; // NEW
                    if (!vertical && !horizontal) break; // NEW
                    result.splice(result.length - 2, 1); // NEW
                } // NEW
            }); // NEW
            return result; // NEW
        } // NEW

        /** Replace a conflicting terminal leg with an outward jetty and bends outside that terminal's bounds. */ // NEW
        function outwardPoints(points, side, clearance) { // NEW
            if (!side || points.length < 2 || !finite(points[0]) || !finite(points[1])) return points; // NEW
            const [p, q, r] = points, axis = side.x ? 'x' : 'y', other = side.x ? 'y' : 'x', sign = side[axis], tolerance = 0.15; // NEW
            if (Math.abs(q[other] - p[other]) < tolerance && (q[axis] - p[axis]) * sign >= clearance - tolerance) return points; // NEW
            const terminal = side.terminal, jetty = p.clone(); // NEW
            const near = axis === 'x' ? terminal.x : terminal.y, size = axis === 'x' ? terminal.width : terminal.height; // NEW
            jetty[axis] = sign > 0 ? Math.max(p[axis] + clearance, near + size + clearance) : Math.min(p[axis] - clearance, near - clearance); // NEW
            if (!r) { // NEW
                const corner = jetty.clone(); corner[other] = q[other]; return [p, jetty, corner, q]; // NEW
            } // NEW
            if (Math.abs(q[axis] - p[axis]) < tolerance) { // NEW: preserve an existing crossbar while shifting its adjoining leg outside the chosen side.
                const corner = jetty.clone(); corner[other] = q[other]; return [p, jetty, corner, ...points.slice(2)]; // NEW
            } // NEW
            const boundary = other === 'x' ? terminal.x : terminal.y, extent = other === 'x' ? terminal.width : terminal.height; // NEW
            const detour = r[other] < p[other] ? boundary - clearance : boundary + extent + clearance; // NEW
            const first = jetty.clone(), last = q.clone(); first[other] = detour; last[other] = detour; // NEW
            return [p, jetty, first, last, ...points.slice(2)]; // NEW: an old waypoint behind the chosen side must route around, not back through, the terminal.
        } // NEW

        /** Native SegmentConnector ignores direction masks, so enforce endpoint clearance on its rendered result too. */ // NEW
        function enforceSides(state, source, target) { // NEW
            if (state.style[flag] != '1' || !sides[state.style.sourcePortConstraint] && !sides[state.style.targetPortConstraint]) return; // NEW
            if (!graph.isOrthogonal(state) || !state.absolutePoints || state.absolutePoints.some(point => !finite(point))) return; // NEW
            const departure = endpointSide(state, source, true), arrival = endpointSide(state, target, false); // NEW
            if (!departure && !arrival) return; // NEW
            let points = simplifyPoints(state.absolutePoints, 0.15); // NEW
            points = outwardPoints(points, departure, Math.max(10, Number(mxEdgeStyle.getJettySize(state, true)) || 0) * view.scale); // NEW
            points = outwardPoints(points.reverse(), arrival, Math.max(10, Number(mxEdgeStyle.getJettySize(state, false)) || 0) * view.scale).reverse(); // NEW
            state.absolutePoints = simplifyPoints(points, 0.15); // NEW
        } // NEW

        /** Collapse duplicate/collinear points, then require opposite parallel legs and one crossbar. */ // NEW
        function uRoute(state) { // NEW
            if (!state || !state.absolutePoints || !graph.isOrthogonal(state) || !state.visibleSourceState || !state.visibleTargetState) return null; // NEW
            if (state.absolutePoints.some(point => !finite(point))) return null; // NEW
            const points = simplifyPoints(state.absolutePoints, 0.15).map(world), tolerance = 0.15 / view.scale; // CHANGE
            const source = points[0], target = points[points.length - 1]; // NEW
            const maxStart = sides[state.style.sourcePortConstraint] ? 3 : 0, maxEnd = sides[state.style.targetPortConstraint] ? 3 : 0; // NEW
            for (let start = 0; start <= maxStart; start++) { // NEW
                const end = points.length - start - 4; // NEW
                if (end < 0 || end > maxEnd) continue; // NEW
                const [a, b, c, d] = points.slice(start, start + 4); // NEW
                const vertical = Math.abs(a.x - b.x) < tolerance && Math.abs(b.y - c.y) < tolerance && Math.abs(c.x - d.x) < tolerance; // NEW
                const horizontal = Math.abs(a.y - b.y) < tolerance && Math.abs(b.x - c.x) < tolerance && Math.abs(c.y - d.y) < tolerance; // NEW
                if (!vertical && !horizontal) continue; // NEW
                const axis = vertical ? 'y' : 'x', sign = Math.sign(b[axis] - a[axis]); // NEW
                if (!sign || sign !== Math.sign(c[axis] - d[axis])) continue; // NEW
                return { source, target, axis, sign, bar: b[axis], sourceInset: new mxPoint(a.x - source.x, a.y - source.y), targetInset: new mxPoint(d.x - target.x, d.y - target.y), origin: state.origin.clone() }; // CHANGE: retain the U's core beyond endpoint clearance bends.
            } // NEW
            return null; // NEW
        } // NEW

        /** Collect through groups and ports without scanning unrelated diagram edges on each drag. */ // NEW
        function captureRoutes(cells) { // NEW
            const edges = new Set(), routes = new Map(); // NEW
            (cells || []).forEach(cell => visit(cell, child => { // NEW
                if (model.isVertex(child)) model.getEdges(child).forEach(edge => edges.add(edge)); // NEW
            })); // NEW
            edges.forEach(edge => { // NEW
                if (!participates(edge) || (cells || []).includes(edge)) return; // NEW: explicit edge dragging owns its bends.
                const route = uRoute(view.getState(edge)); // NEW
                if (route) routes.set(edge, route); // NEW
            }); // NEW
            return routes; // NEW
        } // NEW

        /** Use current fixed endpoints; translate a shared move once and retain the bar for independent moves. */ // NEW
        function routePoints(state, route) { // NEW
            const absolute = state.absolutePoints; // NEW
            if (!absolute || !finite(absolute[0]) || !finite(absolute[absolute.length - 1])) return null; // NEW
            const source = world(absolute[0]), target = world(absolute[absolute.length - 1]), axis = route.axis; // NEW
            const ds = source[axis] - route.source[axis], dt = target[axis] - route.target[axis]; // NEW
            let bar = route.bar + (Math.abs(ds - dt) < 0.01 ? ds : state.origin[axis] - route.origin[axis]); // NEW
            const limit = route.sign > 0 ? Math.max(source[axis], target[axis]) : Math.min(source[axis], target[axis]); // NEW
            const clearance = Math.max(10, Number(mxEdgeStyle.getJettySize(state, true)) || 0, Number(mxEdgeStyle.getJettySize(state, false)) || 0); // NEW
            if ((bar - limit) * route.sign < clearance) bar = limit + route.sign * clearance; // NEW: a box crossing the bar must not reverse the attachment's outgoing leg.
            const first = source.clone(), last = target.clone(); // NEW
            first.x += route.sourceInset.x; first.y += route.sourceInset.y; last.x += route.targetInset.x; last.y += route.targetInset.y; // NEW
            first[axis] = bar; last[axis] = bar; // NEW
            return [local(first, state), local(last, state)]; // NEW
        } // NEW

        const updatePoints = view.updatePoints; // NEW
        view.updatePoints = function (state, points, source, target) { // NEW
            if (!activeRoutes && !endpointGesture && (state.style[flag] != '1' || !sides[state.style.sourcePortConstraint] && !sides[state.style.targetPortConstraint])) return updatePoints.apply(this, arguments); // NEW
            if (endpointGesture && state.style[flag] == '1') { // NEW
                const gesture = endpointGesture; // NEW
                if (gesture.isSource || gesture.isTarget) { // CHANGE
                    delete state.style[gesture.isSource ? 'sourcePort' : 'targetPort']; // NEW: a previous endpoint's child port cannot determine the new terminal's side.
                    previewSide(state, gesture.isSource ? source : target, gesture.isSource, gesture.getConstraintHandler().currentConstraint); // NEW
                } // NEW
            } // NEW
            const route = activeRoutes && activeRoutes.get(state.cell); // NEW
            const adjusted = route && routePoints(state, route); // NEW
            if (adjusted) route.points = adjusted; // NEW: preview and commit share this pure calculation.
            const originalStyle = state.style, resolved = { ...originalStyle }; // NEW
            for (const isSource of [true, false]) { const side = endpointSide(state, isSource ? source : target, isSource); if (side) resolved[sideKey(isSource)] = side.name; } // NEW
            try { state.style = resolved; updatePoints.call(this, state, adjusted || points, source, target); enforceSides(state, source, target); } // CHANGE
            finally { state.style = originalStyle; } // NEW: rotation changes routing direction, never persisted styles during rendering.
        }; // NEW
        const updateFloating = view.updateFloatingTerminalPoints; // NEW
        view.updateFloatingTerminalPoints = function (state, source, target) { // NEW
            updateFloating.apply(this, arguments); enforceSides(state, source, target); // NEW: body drops obtain their target point only after waypoint routing finishes.
        }; // NEW

        /** Hover-arrow gestures choose a side before routing; ordinary explicit points use their actual constraints. */ // NEW
        const connection = graph.connectionHandler, hover = ui.hoverIcons; // NEW
        if (hover && connection && typeof hover.drag === 'function') { // NEW
            const drag = hover.drag; // NEW
            hover.drag = function (event) { // CHANGE
                const arrow = event && (event.currentTarget || event.target); // NEW
                const direction = arrow === this.arrowLeft ? 'west' : arrow === this.arrowRight ? 'east' : arrow === this.arrowUp ? 'north' : arrow === this.arrowDown ? 'south' : this.getDirection(); // NEW: touch may begin without a preceding mouseenter.
                const state = this.currentState, result = drag.apply(this, arguments); // CHANGE
                if (!state || connection.previous !== state || !sides[direction] || !connection.edgeState) return result; // NEW
                const vector = sides[direction], center = new mxPoint(state.getCenterX(), state.getCenterY()); // NEW
                const far = new mxPoint(center.x + vector.x * (state.width + state.height + 100), center.y + vector.y * (state.width + state.height + 100)); // NEW
                const probe = connection.edgeState.clone(); probe.absolutePoints = [null, far]; // NEW
                const point = view.getFloatingTerminalPoint(probe, state, null, true); // NEW
                connection.sourceConstraint = graph.getOutlineConstraint(point, state); // NEW
                connection.first = graph.getConnectionPoint(state, connection.sourceConstraint, false); // NEW
                previewSide(connection.edgeState, state, true, connection.sourceConstraint); // NEW
                return result; // NEW
            }; // NEW
        } // NEW
        if (connection && typeof connection.updateEdgeState === 'function') { // NEW
            const update = connection.updateEdgeState, connect = connection.connect; // NEW
            connection.updateEdgeState = function (current, constraint) { // NEW
                previewSide(this.edgeState, this.previous, true, this.sourceConstraint); // NEW
                previewSide(this.edgeState, this.currentState, false, constraint); // NEW
                return update.apply(this, arguments); // NEW
            }; // NEW
            connection.connect = function (_source, target) { // NEW
                if (!this.edgeState) this.edgeState = this.createEdgeState(null); // NEW
                previewSide(this.edgeState, this.previous || view.getState(_source), true, this.sourceConstraint); // NEW
                previewSide(this.edgeState, target && view.getState(target), false, this.constraintHandler.currentConstraint); // NEW
                return connect.apply(this, arguments); // NEW: native insertion copies preview styles into the same creation transaction.
            }; // NEW
        } // NEW

        /** Reconnection previews resolve outline constraints inside the native handler; commits replace only the edited end. */ // NEW
        const createEdgeHandler = graph.createEdgeHandler; // NEW
        if (typeof createEdgeHandler === 'function') graph.createEdgeHandler = function () { // NEW
            const edgeHandler = createEdgeHandler.apply(this, arguments); // NEW
            if (!edgeHandler) return edgeHandler; // NEW
            const update = edgeHandler.updatePreviewState, connect = edgeHandler.connect; // NEW
            edgeHandler.updatePreviewState = function () { // NEW
                const previous = endpointGesture; // NEW
                try { endpointGesture = this; return update.apply(this, arguments); } finally { endpointGesture = previous; } // NEW
            }; // NEW
            edgeHandler.connect = function (edge, terminal, source) { // NEW
                if (!participates(edge)) return connect.apply(this, arguments); // NEW
                const constraint = this.getConstraintHandler().currentConstraint, terminalState = terminal && view.getState(terminal); // NEW
                const preview = this.state.clone(); delete preview.style[source ? 'sourcePort' : 'targetPort']; // NEW
                const name = constraint && finite(constraint.point) ? allowedSide(preview, terminalState, source, constraintSide(terminalState, constraint)) : null; // CHANGE
                model.beginUpdate(); // NEW
                try { graph.setCellStyles(sideKey(source), name, [edge]); return connect.apply(this, arguments); } finally { model.endUpdate(); } // NEW
            }; // NEW
            return edgeHandler; // NEW
        }; // NEW

        /** Validate changed states before taking coordinates; model notifications have not run yet. */ // NEW
        function validateChanges(changes) { // NEW
            changes.forEach(change => { // NEW
                const cell = change.cell || change.child, state = cell && view.getState(cell); // NEW
                if (state && change instanceof mxStyleChange) state.invalidStyle = true; // NEW: a reconnect may have just removed a cached constraint.
                if (cell) view.invalidate(cell); // NEW
            }); // NEW
            view.validate(); // NEW
        } // NEW

        /** Resolve only actual visible terminals, never substitute a collapsed group's perimeter for a hidden child. */ // NEW
        function pinEndpoint(edge, state, source) { // NEW
            const terminal = model.getTerminal(edge, source); // NEW
            if (!terminal) return true; // NEW: dangling ends stay free until attached.
            const constraint = graph.getConnectionConstraint(state, view.getState(terminal), source); // NEW
            if (constraint && finite(constraint.point)) return true; // NEW: ports, offsets and explicit off-center intent win.
            const terminalState = view.getState(terminal), visible = state.getVisibleTerminalState(source); // NEW
            if (!terminalState || visible !== terminalState) return false; // NEW
            const port = view.getTerminalPort(state, terminalState, source), points = state.absolutePoints; // NEW
            const point = points && points[source ? 0 : points.length - 1]; // NEW
            if (!port || !finite(point) || port.width <= 0 || port.height <= 0) return false; // NEW
            const inferred = graph.getOutlineConstraint(point, port); // NEW
            if (!inferred || !finite(inferred.point)) return false; // NEW
            graph.setConnectionConstraint(edge, terminal, source, inferred); // NEW
            return true; // NEW
        } // NEW

        model.addListener(mxEvent.BEFORE_UNDO, function (_sender, event) { // NEW
            const changes = event.getProperty('edit').changes.slice(); // NEW
            if (changes.some(change => change instanceof mxRootChange)) { // NEW: loading/replacing a document is not edge creation.
                pending.clear(); visit(model.getRoot(), cell => { known.add(cell); if (participates(cell)) pending.add(cell); }); return; // NEW
            } // NEW
            const added = new Set(), reconnecting = new Set(); // NEW
            changes.forEach(change => { // NEW
                if (change instanceof mxChildChange && model.contains(change.child)) visit(change.child, cell => { // NEW
                    if (!known.has(cell) && model.isEdge(cell)) added.add(cell); // NEW
                    known.add(cell); // NEW
                }); // NEW
                if (change instanceof mxTerminalChange && participates(change.cell)) reconnecting.add(change.cell); // NEW
            }); // NEW
            if (!added.size && !pending.size && !reconnecting.size) return; // NEW
            added.forEach(edge => { graph.setCellStyles(flag, '1', [edge]); pending.add(edge); }); // NEW
            reconnecting.forEach(edge => pending.add(edge)); // NEW
            validateChanges(event.getProperty('edit').changes); // NEW: include the newly written enrollment styles, even for already-rendered imported cells.
            pending.forEach(edge => { // NEW
                if (!model.contains(edge) || !participates(edge)) { pending.delete(edge); return; } // NEW
                const state = view.getState(edge); // NEW
                if (!state) return; // NEW
                const geometry = model.getGeometry(edge); // NEW
                if (edge.source && edge.source === edge.target && geometry && (!geometry.points || !geometry.points.length) && uRoute(state)) { // NEW
                    const next = geometry.clone(); next.points = state.absolutePoints.slice(1, -1).map(point => local(world(point), state)); model.setGeometry(edge, next); // NEW: fixed constraints disable the native loop style, so retain its already-rendered bends.
                } // NEW
                const sourcePinned = pinEndpoint(edge, state, true), targetPinned = pinEndpoint(edge, state, false); // NEW
                if (sourcePinned && targetPinned) pending.delete(edge); // NEW
            }); // NEW
        }); // NEW

        /** Keep route edits within native move/resize transactions, including direct plugin calls to cellsMoved. */ // NEW
        ['cellsMoved', 'cellsResized'].forEach(method => { // NEW
            const original = graph[method]; // NEW
            graph[method] = function (cells) { // NEW
                if (adjusting) return original.apply(this, arguments); // NEW
                if (method === 'cellsMoved' && !arguments[1] && !arguments[2]) return original.apply(this, arguments); // NEW
                const routes = captureRoutes(cells); // NEW
                if (!routes.size) return original.apply(this, arguments); // NEW
                model.beginUpdate(); adjusting = true; // NEW
                try { // NEW
                    const result = original.apply(this, arguments); // NEW
                    activeRoutes = routes; // NEW
                    (cells || []).forEach(cell => view.invalidate(cell)); view.validate(); // NEW
                    routes.forEach((route, edge) => { // NEW
                        const geometry = model.getGeometry(edge); // NEW
                        if (!geometry || !route.points || !model.contains(edge)) return; // NEW
                        const current = geometry.points; // NEW
                        if (current && current.length === route.points.length && current.every((p, i) => p && p.equals(route.points[i]))) return; // NEW
                        const next = geometry.clone(); next.points = route.points.map(point => point.clone()); model.setGeometry(edge, next); // NEW
                    }); // NEW
                    return result; // NEW
                } finally { activeRoutes = null; adjusting = false; model.endUpdate(); } // NEW
            }; // NEW
        }); // NEW

        const handler = graph.graphHandler; // NEW
        if (handler && typeof handler.updateLivePreview === 'function') { // NEW
            let previewRoutes = null; // NEW
            const start = handler.start, reset = handler.reset, update = handler.updateLivePreview; // NEW
            handler.start = function () { const result = start.apply(this, arguments); previewRoutes = captureRoutes(this.cells); return result; }; // NEW
            handler.reset = function () { try { return reset.apply(this, arguments); } finally { previewRoutes = null; } }; // NEW
            handler.updateLivePreview = function () { // NEW
                const previous = activeRoutes; // NEW
                try { activeRoutes = this.cloning ? null : previewRoutes; return update.apply(this, arguments); } // NEW
                finally { activeRoutes = previous; } // NEW: never persist geometry or leave a routing override active after a canceled gesture.
            }; // NEW
        } // NEW
        /** Resize handlers are per selection; wrap their live preview locally rather than changing shared prototypes. */ // NEW
        const createVertexHandler = graph.createVertexHandler; // NEW
        if (typeof createVertexHandler === 'function') graph.createVertexHandler = function (state) { // NEW
            const vertexHandler = createVertexHandler.apply(this, arguments); // NEW
            if (!vertexHandler || typeof vertexHandler.updateLivePreview !== 'function') return vertexHandler; // NEW
            let resizeRoutes = null; // NEW
            const start = vertexHandler.start, reset = vertexHandler.reset, update = vertexHandler.updateLivePreview; // NEW
            vertexHandler.start = function () { resizeRoutes = captureRoutes([state.cell]); return start.apply(this, arguments); }; // NEW
            vertexHandler.reset = function () { try { return reset.apply(this, arguments); } finally { resizeRoutes = null; } }; // NEW
            vertexHandler.updateLivePreview = function () { // NEW
                const previous = activeRoutes; // NEW
                try { activeRoutes = resizeRoutes; return update.apply(this, arguments); } // NEW
                finally { activeRoutes = previous; } // NEW
            }; // NEW
            return vertexHandler; // NEW
        }; // NEW
        graph.__trellisEdgeAttachmentGuard = true; // NEW
    } // NEW
    installEdgeAttachmentGuard(ui.editor && ui.editor.graph); // NEW

    const menus = ui.menus;
    const actions = ui.actions;

    const MENU_LABELS = {
        file: 'More editor file options', // CHANGE
        edit: 'More editor edit options', // CHANGE
        view: 'More editor view options', // CHANGE
        arrange: 'More editor arrange options', // CHANGE
        extras: 'More editor extras', // CHANGE
        help: 'More editor help options' // CHANGE
    };

    const ACTION_LABELS = {
        synchronize: 'Synchronize',
        newLibrary: 'New Library',
        openLibraryFrom: 'Open Library',
        pageSetup: 'Page Setup',
        close: 'Close',
        exit: 'Exit',
        desktopResetZoom: 'Actual Size',
        desktopZoomIn: 'Zoom In',
        desktopZoomOut: 'Zoom Out'
    };

    function getMenu(name) {
        return menus && typeof menus.get === 'function' ? menus.get(name) : null;
    }

    function getAction(actionKey) {
        return actions && typeof actions.get === 'function' ? actions.get(actionKey) : null;
    }

    function getActionLabel(actionKey) {
        const action = getAction(actionKey);
        return ACTION_LABELS[actionKey] || (action && action.label) || actionKey;
    }

    function getOwner(parent) {
        return parent && parent.tbody ? parent : null;
    }

    function getRows(menu, parent) {
        const owner = getOwner(parent) || menu;
        const tbody = owner && owner.tbody;
        return tbody ? Array.prototype.slice.call(tbody.children || []) : [];
    }

    function isSeparator(row) {
        return !!(row && row.querySelector && row.querySelector('.mxPopupMenuSeparator'));
    }

    function getRowText(row) {
        return (row && (row.innerText || row.textContent) || '').trim();
    }

    function normalizeLabel(value) {
        return String(value || '').replace(/\.\.\./g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function hideRowsByLabels(menu, parent, labels) {
        if (!menu || !labels || !labels.length) {
            return;
        }

        const labelSet = labels.reduce(function (result, label) {
            const normalized = normalizeLabel(label);
            if (normalized) result[normalized] = true;
            return result;
        }, {});

        getRows(menu, parent).forEach(function (row) {
            if (isSeparator(row)) return;
            const text = normalizeLabel(getRowText(row));
            const matched = Object.keys(labelSet).some(function (label) {
                return text === label || text.indexOf(label) === 0;
            });
            if (matched) {
                row.style.display = 'none';
            }
        });

        cleanSeparators(menu, parent);
    }

    function cleanSeparators(menu, parent) {
        const rows = getRows(menu, parent);
        let previousVisibleWasSeparator = true;
        let lastVisibleSeparator = null;

        rows.forEach(function (row) {
            if (row.style && row.style.display === 'none') return;

            if (isSeparator(row)) {
                if (previousVisibleWasSeparator) {
                    row.style.display = 'none';
                } else {
                    lastVisibleSeparator = row;
                    previousVisibleWasSeparator = true;
                }
                return;
            }

            lastVisibleSeparator = null;
            previousVisibleWasSeparator = false;
        });

        if (lastVisibleSeparator) {
            lastVisibleSeparator.style.display = 'none';
        }
    }

    function addSeparator(menu, parent) {
        if (menu && typeof menu.addSeparator === 'function') {
            menu.addSeparator(parent || null);
        }
    }

    function addSubmenu(menu, parent, label) {
        if (!menu || typeof menu.addItem !== 'function') {
            return null;
        }

        return menu.addItem(label, null, null, parent || null);
    }

    function addActionItem(menu, parent, actionKey, labelOverride) {
        const action = getAction(actionKey);
        if (!action || !menu || typeof menu.addItem !== 'function') {
            return false;
        }

        menu.addItem(labelOverride || getActionLabel(actionKey), null, function () {
            if (typeof action.funct === 'function') {
                action.funct();
            }
        }, parent || null);
        return true;
    }

    function addActionGroup(menu, parent, actionKeys) {
        let added = false;

        actionKeys.forEach(function (actionKey) {
            if (actionKey === '-') {
                if (added) addSeparator(menu, parent);
                added = false;
                return;
            }

            added = addActionItem(menu, parent, actionKey) || added;
        });

        cleanSeparators(menu, parent);
    }

    function addNamedSubmenu(menu, parent, menuKey, labelOverride) {
        if (!menus || typeof menus.addSubmenu !== 'function') {
            return false;
        }

        if (typeof menus.get === 'function' && !menus.get(menuKey)) {
            return false;
        }

        menus.addSubmenu(menuKey, menu, parent || null, labelOverride || null);
        return true;
    }

    function addMenuOverflow(menu, parent, label, buildItems) {
        const submenu = addSubmenu(menu, parent, label);
        if (submenu && typeof buildItems === 'function') {
            buildItems(submenu);
            cleanSeparators(menu, submenu);
        }
        return submenu;
    }

    function withOriginalMenu(menuName, replacement) {
        const menu = getMenu(menuName);
        if (!menu || typeof replacement !== 'function') {
            return;
        }

        const originalFunct = typeof menu.funct === 'function' ? menu.funct : function () {};
        menu.funct = function (menuInstance, parent) {
            return replacement.call(this, menuInstance, parent || null, originalFunct);
        };
    }

    function installFileCleanup() {
        withOriginalMenu('file', function (menu, parent, originalFunct) {
            originalFunct.call(this, menu, parent);
            hideRowsByLabels(menu, parent, [
                getActionLabel('synchronize'),
                getActionLabel('newLibrary'),
                getActionLabel('openLibraryFrom'),
                getActionLabel('pageSetup'),
                getActionLabel('close'),
                getActionLabel('exit')
            ]);

            addSeparator(menu, parent);
            addMenuOverflow(menu, parent, MENU_LABELS.file, function (submenu) {
                addActionItem(menu, submenu, 'synchronize');
                addNamedSubmenu(menu, submenu, 'newLibrary', ACTION_LABELS.newLibrary) ||
                    addActionItem(menu, submenu, 'newLibrary', ACTION_LABELS.newLibrary);
                addNamedSubmenu(menu, submenu, 'openLibraryFrom', ACTION_LABELS.openLibraryFrom) ||
                    addActionItem(menu, submenu, 'openLibraryFrom', ACTION_LABELS.openLibraryFrom);
                addActionItem(menu, submenu, 'pageSetup');
                addActionItem(menu, submenu, 'close');
                addActionItem(menu, submenu, 'exit');
            });
            cleanSeparators(menu, parent);
        });
    }

    function installEditCleanup() {
        withOriginalMenu('edit', function (menu, parent) {
            addMenuOverflow(menu, parent, MENU_LABELS.edit, function (submenu) {
                addActionGroup(menu, submenu, [
                    'undo', 'redo', '-',
                    'cut', 'copy', 'copyAsImage', 'copyAsSvg', 'paste', 'delete', 'duplicate', '-',
                    'findReplace', '-',
                    'editData', 'editTooltip', 'editStyle', 'editGeometry', 'edit', 'editLink', 'openLink', '-',
                    'selectVertices', 'selectEdges', 'selectAll', 'selectNone', '-',
                    'lockUnlock'
                ]);
            });
        });
    }

    function installViewCleanup() {
        withOriginalMenu('view', function (menu, parent) {
            addActionItem(menu, parent, 'grid');
            addActionItem(menu, parent, 'guides');
            addSeparator(menu, parent);
            addMenuOverflow(menu, parent, MENU_LABELS.view, function (submenu) {
                addActionGroup(menu, submenu, [
                    'format', 'toggleShapes', 'pageTabs', 'ruler', 'search', 'scratchpad',
                    'findReplace', 'outline', 'layers', 'tags', 'comments', '-',
                    'pageView', 'pageScale', 'tooltips', 'animations', 'connectionArrows',
                    'connectionPoints', '-',
                    'resetView', 'zoomIn', 'zoomOut', 'fullscreen'
                ]);
            });
            cleanSeparators(menu, parent);
        });
    }

    function installArrangeCleanup() {
        withOriginalMenu('arrange', function (menu, parent) {
            addMenuOverflow(menu, parent, MENU_LABELS.arrange, function (submenu) {
                addActionGroup(menu, submenu, ['toFront', 'toBack', 'bringForward', 'sendBackward']);
                addNamedSubmenu(menu, submenu, 'direction');
                addNamedSubmenu(menu, submenu, 'turn');
                addNamedSubmenu(menu, submenu, 'align');
                addNamedSubmenu(menu, submenu, 'distribute');
                addNamedSubmenu(menu, submenu, 'navigation');
                addNamedSubmenu(menu, submenu, 'insert');
                addNamedSubmenu(menu, submenu, 'layout');
                addActionGroup(menu, submenu, ['group', 'ungroup', 'removeFromGroup', '-', 'clearWaypoints', 'autosize']);
            });
        });
    }

    function installExtrasCleanup() {
        withOriginalMenu('extras', function (menu, parent, originalFunct) {
            addActionItem(menu, parent, 'plugins');
            addActionItem(menu, parent, 'trellisRestoreBuiltInDatabase');
            addSeparator(menu, parent);
            addMenuOverflow(menu, parent, MENU_LABELS.extras, function (submenu) {
                originalFunct.call(this, menu, submenu);
                hideRowsByLabels(menu, submenu, [
                    getActionLabel('plugins'),
                    getActionLabel('trellisRestoreBuiltInDatabase')
                ]);
            });
            cleanSeparators(menu, parent);
        });
    }

    function installHelpCleanup() {
        withOriginalMenu('help', function (menu, parent, originalFunct) {
            originalFunct.call(this, menu, parent);
            hideRowsByLabels(menu, parent, [
                getActionLabel('desktopResetZoom'),
                getActionLabel('desktopZoomIn'),
                getActionLabel('desktopZoomOut')
            ]);

            addSeparator(menu, parent);
            addMenuOverflow(menu, parent, MENU_LABELS.help, function (submenu) {
                addActionItem(menu, submenu, 'desktopResetZoom', ACTION_LABELS.desktopResetZoom);
                addActionItem(menu, submenu, 'desktopZoomIn', ACTION_LABELS.desktopZoomIn);
                addActionItem(menu, submenu, 'desktopZoomOut', ACTION_LABELS.desktopZoomOut);
            });
            cleanSeparators(menu, parent);
        });
    }

    function removeChild(child) {
        if (child && child.parentNode) {
            child.parentNode.removeChild(child);
        }
    }

    function shouldPreserveMainToolbarChild(child, index) {
        return index === 0 || !!(child && child.classList && child.classList.contains('geZoomInput'));
    }

    function pruneMainToolbar() {
        const container = ui.toolbar && ui.toolbar.container;
        if (!container || !container.children) {
            return;
        }

        Array.prototype.slice.call(container.children).forEach(function (child, index) {
            if (!shouldPreserveMainToolbarChild(child, index)) {
                removeChild(child);
            }
        });
    }

    function pruneHeaderToolbar() {
        const container = ui.toolbarContainer;
        if (!container || !container.querySelector) {
            return;
        }

        const toolbarEnd = container.querySelector('.geToolbarEnd');
        if (!toolbarEnd || !toolbarEnd.children) {
            return;
        }

        while (toolbarEnd.children.length > 2) {
            removeChild(toolbarEnd.children[0]);
        }
    }

    function pruneToolbar() {
        pruneMainToolbar();
        pruneHeaderToolbar();
    }

    function applyStartupLayout() {
        if (typeof ui.setCompactMode === 'function') {
            ui.setCompactMode(true, false, 0);
        }

        if (typeof ui.toggleShapesPanel === 'function') {
            ui.toggleShapesPanel(false);
        }

        if (typeof ui.toggleFormatPanel === 'function') {
            ui.toggleFormatPanel(false);
        }

        pruneToolbar();

        if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
            window.setTimeout(pruneToolbar, 0);
        }
    }

    installFileCleanup();
    installEditCleanup();
    installViewCleanup();
    installArrangeCleanup();
    installExtrasCleanup();
    installHelpCleanup();
    applyStartupLayout();
});
