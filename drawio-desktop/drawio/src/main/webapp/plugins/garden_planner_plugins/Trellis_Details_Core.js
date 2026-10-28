/** Shared details normalization, placement and isolated export rendering; safe without an editor UI. */ // NEW
(function (root) { // NEW
    'use strict'; // NEW
    const ATTRIBUTE = 'trellis_details_html'; // NEW
    const COMMENTS_ATTRIBUTE = 'trellis_comments_json', COMMENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // CHANGE

    /** Fail closed on unknown versions or damaged records; never repair stored discussion by dropping it. */ // CHANGE
    const parseComments = root.TrellisPermissionCore.parseComments; // CHANGE: the renderer and replay share authorship and retention rules.
    function commentsChangeAllowed(before, after, actor, at = Date.now()) { // CHANGE
        return root.TrellisPermissionCore.commentsChangeAllowed(before, after, actor, at, normalizeHtml); // CHANGE
    } // CHANGE

    /** Apply one explicit action to fresh canonical data, using the target baseline to reject stale editing or moderation. */ // CHANGE
    function changeComments(raw, action, actor, now = Date.now()) { // CHANGE
        if (!actor || !actor.enabled || !actor.editable || !actor.user || !actor.user.id) throw new Error('Log in with object-edit access before changing comments.'); // CHANGE
        const comments = parseComments(raw), index = comments.findIndex(item => item.id === action.id), old = comments[index]; // CHANGE
        if (action.type !== 'post') { // CHANGE
            let baseline = null; // CHANGE
            try { const item = JSON.parse(action.baseline); baseline = parseComments(JSON.stringify({ version: Object.prototype.hasOwnProperty.call(item, 'isAlert') ? 2 : 1, comments: [item] }))[0]; } catch (_) { /* Invalid or stale baselines never authorize a mutation. */ } // CHANGE
            if (!old || JSON.stringify(old) !== JSON.stringify(baseline)) throw new Error('This comment changed elsewhere. Copy your draft or reload the comment before retrying.'); // CHANGE: canonical comparison preserves legacy private edit drafts.
        } // CHANGE
        const html = action.html == null ? '' : normalizeHtml(action.html); // CHANGE
        if (action.type === 'post') { // CHANGE
            if (old) { if (old.authorUserId === actor.user.id && old.html === html && old.isAlert === (action.isAlert === true)) return raw; throw new Error('This comment ID is already in use.'); } // CHANGE: retries cannot duplicate or silently change an accepted submission.
            comments.push({ id: action.id, authorUserId: actor.user.id, authorName: actor.user.name, html, createdAt: now, updatedAt: now, resolvedAt: null, resolvedByUserId: null, resolvedByName: null, isAlert: action.isAlert === true }); // CHANGE
        } else if (action.type === 'edit') { // CHANGE
            if (old.authorUserId !== actor.user.id) throw new Error('This comment action is not permitted.'); // CHANGE: even flag-only composer submissions belong to the author.
            const isAlert = action.isAlert == null ? old.isAlert : action.isAlert === true; // CHANGE
            if (html === old.html && isAlert === old.isAlert) return raw; // CHANGE
            comments[index] = html === old.html ? { ...old, isAlert } : { ...old, html, isAlert, updatedAt: now, resolvedAt: null, resolvedByUserId: null, resolvedByName: null }; // CHANGE
        } else if (action.type === 'markAlert' || action.type === 'removeAlert') { // CHANGE
            const isAlert = action.type === 'markAlert'; if (isAlert === old.isAlert) return raw; // CHANGE
            comments[index] = { ...old, isAlert }; // CHANGE
        } else if (action.type === 'resolve') comments[index] = { ...old, resolvedAt: now, resolvedByUserId: actor.user.id, resolvedByName: actor.user.name }; // CHANGE
        else if (action.type === 'reopen') comments[index] = { ...old, resolvedAt: null, resolvedByUserId: null, resolvedByName: null }; // CHANGE
        else if (action.type === 'delete') comments.splice(index, 1); // CHANGE
        else throw new Error('Unknown comment action.'); // CHANGE
        const next = comments.length ? JSON.stringify({ version: 2, comments }) : ''; // CHANGE
        if (!commentsChangeAllowed(raw, next, actor, now)) throw new Error('This comment action is not permitted.'); // CHANGE
        return next; // CHANGE
    } // CHANGE
    const DEFAULTS = Object.freeze({ visible: true, side: 'below', width: 320, height: 180 }); // NEW
    const SIDES = Object.freeze(['above', 'below', 'left', 'right']); // NEW
    const ALLOWED_TAGS = new Set(['P', 'DIV', 'SPAN', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'SUB', 'SUP', 'UL', 'OL', 'LI', 'A', 'FONT', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE']); // NEW
    const ALLOWED_STYLES = new Set(['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-decoration', 'text-align', 'line-height', 'margin-left', 'margin-right', 'padding-left', 'list-style-type']); // NEW

    /** Sanitize first, then limit rich text to the supported text-only vocabulary on read, paste and write. */ // NEW
    function normalizeHtml(value) { // NEW
        const node = document.createElement('div'); // NEW
        node.innerHTML = root.Graph.sanitizeHtml(String(value || '')); // NEW
        for (const element of Array.from(node.querySelectorAll('*'))) { // NEW
            if (['IMG', 'SVG', 'MATH', 'VIDEO', 'AUDIO', 'IFRAME', 'OBJECT', 'INPUT', 'BUTTON', 'STYLE'].includes(element.tagName)) { element.remove(); continue; } // NEW
            if (!ALLOWED_TAGS.has(element.tagName)) { element.replaceWith(...element.childNodes); continue; } // NEW
            for (const attribute of Array.from(element.attributes)) { // NEW
                if (!['style', 'href', 'face', 'color', 'size', 'start', 'type'].includes(attribute.name) || attribute.name === 'href' && element.tagName !== 'A') element.removeAttribute(attribute.name); // NEW
            } // NEW
            for (const property of Array.from(element.style)) { // NEW
                const value = element.style.getPropertyValue(property); // NEW
                if (!ALLOWED_STYLES.has(property) || /url\s*\(|expression\s*\(|var\s*\(/i.test(value)) element.style.removeProperty(property); // NEW
            } // NEW
            if (element.tagName === 'A') { // NEW
                const href = root.Graph.sanitizeLink(element.getAttribute('href')); // NEW
                if (href && /^(https?:|mailto:|tel:|#)/i.test(href)) element.setAttribute('href', href); else element.removeAttribute('href'); // NEW
                element.setAttribute('rel', 'noopener noreferrer'); // NEW
            } // NEW
            if (element.tagName === 'PRE') element.style.whiteSpace = 'pre-wrap'; // NEW: formatted text still wraps inside the resizable field.
            if (!element.getAttribute('style')) element.removeAttribute('style'); // NEW
            const attributes = Array.from(element.attributes).map(attribute => [attribute.name, attribute.value]).sort(([a], [b]) => a.localeCompare(b)); // NEW
            for (const attribute of Array.from(element.attributes)) element.removeAttribute(attribute.name); // NEW
            for (const [name, value] of attributes) element.setAttribute(name, value); // NEW: sanitizer attribute reordering cannot create a false save conflict.
        } // NEW
        return node.textContent.replace(/[\s\u200b\ufeff]/g, '') ? node.innerHTML : ''; // NEW
    } // NEW

    /** Ignore malformed local storage without letting dimensions collapse or corrupt positioning. */ // NEW
    function normalizePreferences(value) { // NEW
        const source = value && typeof value === 'object' ? value : {}; // NEW
        const dimension = (key, minimum) => Number.isFinite(Number(source[key])) ? Math.max(minimum, Math.min(4096, Number(source[key]))) : DEFAULTS[key]; // NEW
        return { visible: source.visible !== false, side: SIDES.includes(source.side) ? source.side : DEFAULTS.side, width: dimension('width', 180), height: dimension('height', 100) }; // NEW
    } // NEW

    /** Place one field in viewport coordinates, preserving its chosen side and an eight-pixel gap. */ // NEW
    function panelBounds(bounds, preferences, height = preferences.height) { // NEW
        const width = preferences.width, gap = 8; // NEW
        let x = bounds.x + (bounds.width - width) / 2, y = bounds.y + bounds.height + gap; // NEW
        if (preferences.side === 'above') y = bounds.y - height - gap; // NEW
        if (preferences.side === 'left' || preferences.side === 'right') { x = preferences.side === 'left' ? bounds.x - width - gap : bounds.x + bounds.width + gap; y = bounds.y + (bounds.height - height) / 2; } // NEW
        return { x, y, width, height }; // NEW
    } // NEW

    /** Use distance along the rendered route, including loops and repeated points, rather than its bounding box. */ // CHANGE
    function edgeBounds(points) { // CHANGE
        const route = Array.isArray(points) ? points.filter(point => point && Number.isFinite(point.x) && Number.isFinite(point.y)) : []; // CHANGE
        if (!route.length) return null; // CHANGE
        const lengths = route.slice(1).map((point, index) => Math.hypot(point.x - route[index].x, point.y - route[index].y)); // CHANGE
        let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2; // CHANGE
        for (let index = 0; index < lengths.length; index++) { // CHANGE
            const length = lengths[index]; // CHANGE
            if (length > 0 && remaining <= length) { // CHANGE
                const start = route[index], end = route[index + 1], fraction = remaining / length; // CHANGE
                return { x: start.x + (end.x - start.x) * fraction, y: start.y + (end.y - start.y) * fraction, width: 0, height: 0 }; // CHANGE
            } // CHANGE
            remaining -= length; // CHANGE
        } // CHANGE
        return { x: route[0].x, y: route[0].y, width: 0, height: 0 }; // CHANGE: a rendered point is still a valid anchor for a zero-length route.
    } // CHANGE

    /** Resolve generated planting visuals to their enduring group; vertices and edges own details, layers do not. */ // CHANGE
    function detailsOwner(cell, model) { // NEW
        const attr = (target, name) => target && target.value && target.value.getAttribute ? target.value.getAttribute(name) : null; // NEW
        if (!cell || !model.isVertex(cell) && !model.isEdge(cell)) return null; // CHANGE
        if (attr(cell, 'plant_tiler') === '1' && attr(cell, 'auto') === '1' || attr(cell, 'lod_summary') === '1') { // NEW
            for (let parent = model.getParent(cell); parent; parent = model.getParent(parent)) if (attr(parent, 'tiler_group') === '1') return parent; // NEW
            return null; // NEW
        } // NEW
        return cell; // NEW
    } // NEW

    /** An undoable typing-burst writer. Failed writes retain the draft; composition never commits partial characters. */ // NEW
    function createDraft(options) { // NEW
        let baseline = options.read(), draft = baseline, timer = null, composing = false, disposed = false; // NEW
        const cancel = () => { if (timer != null) clearTimeout(timer); timer = null; }; // NEW
        function flush() { // NEW
            cancel(); // NEW
            if (disposed) return false; // NEW
            if (draft === baseline) return true; // NEW
            if (composing) { options.state('pending'); return false; } // NEW
            try { options.write(draft, baseline); baseline = draft; options.state('saved'); return true; } // NEW
            catch (error) { options.state('failed', error); return false; } // NEW
        } // NEW
        function edit(value) { // NEW
            if (disposed) return; // NEW
            draft = normalizeHtml(value); cancel(); // NEW
            options.state(draft === baseline ? 'saved' : 'pending'); // NEW
            if (!composing && draft !== baseline) timer = setTimeout(flush, 500); // NEW
        } // NEW
        return { // NEW
            edit, flush, cancel, value: () => draft, baseline: () => baseline, dirty: () => draft !== baseline, composing: () => composing, // NEW
            beginComposition() { composing = true; cancel(); }, // NEW
            endComposition(value) { if (!composing || disposed) return; composing = false; edit(value); }, // NEW
            reload() { cancel(); composing = false; baseline = draft = options.read(); options.state('saved'); return draft; }, // NEW
            retain(value) { cancel(); composing = false; baseline = options.read(); draft = normalizeHtml(value); }, // NEW
            dispose() { cancel(); disposed = true; } // NEW
        }; // NEW
    } // NEW

    /** Apply sanitized display records exclusively to an isolated export model. Canonical XML is never modified. */ // NEW
    function applyProjection(graph, pages, pageId) { // NEW
        const records = pages && pages[String(pageId || '')]; // NEW
        if (!records) return; // NEW
        const model = graph.getModel(); model.beginUpdate(); // NEW
        try { // NEW
            records.forEach(record => { // NEW
                const owner = model.getCell(record.ownerId); // NEW
                if (!owner || !record.geometry) return; // NEW
                for (let cell = owner; cell; cell = model.getParent(cell)) if (!graph.isCellVisible(cell)) return; // NEW
                const geometry = record.geometry, label = record.badge ? '&#9432;' : normalizeHtml(record.html); // NEW
                if (!label || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(geometry[key]))) return; // NEW
                const fontSize = record.fontSize || 13, padding = Number.isFinite(record.padding) ? record.padding : 8; // NEW
                const style = 'html=1;whiteSpace=wrap;overflow=hidden;align=left;verticalAlign=top;spacing=' + padding + ';fillColor=#ffffff;strokeColor=#94a3b8;fontColor=#111827;connectable=0;resizable=0;fontSize=' + fontSize + ';' + (record.badge ? 'rounded=1;arcSize=50;spacing=0;align=center;verticalAlign=middle;fillColor=#eff6ff;strokeColor=#2563eb;fontColor=#2563eb;' : ''); // NEW
                let layer = owner; while (model.getParent(layer) && model.getParent(layer) !== model.getRoot()) layer = model.getParent(layer); // NEW
                const cell = graph.insertVertex(layer, null, label, geometry.x, geometry.y, geometry.width, geometry.height, style); // NEW: generated IDs cannot collide with canonical cells; owning layers retain export filtering.
                cell.__trellisDetailsOwner = owner; // NEW
            }); // NEW
        } finally { model.endUpdate(); } // NEW
    } // NEW

    root.TrellisDetailsCore = Object.freeze({ ATTRIBUTE, COMMENTS_ATTRIBUTE, COMMENT_RETENTION_MS, parseComments, commentsChangeAllowed, changeComments, DEFAULTS, SIDES, normalizeHtml, normalizePreferences, panelBounds, edgeBounds, detailsOwner, createDraft, applyProjection }); // CHANGE
})(globalThis); // NEW
