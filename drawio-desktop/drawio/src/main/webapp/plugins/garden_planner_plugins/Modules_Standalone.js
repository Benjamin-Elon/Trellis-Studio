Draw.loadPlugin(function (ui) {
    const graph = ui.editor.graph;
    const model = graph.getModel();
    const GRAPH_OVERLAY_Z = Object.freeze({ ANNOTATION: 10000, CONNECTION: 10010, CONTROL: 10020, CONTROL_TOP: 10030 });
    const ATTR_GARDEN_TEAM_MODULE = "trellis_team_module_id";
    const ATTR_TEAM_GARDEN_MODULE = "trellis_garden_module_id";
    const ATTR_GARDEN_TASK_MODULE = "trellis_task_module_id";
    const ATTR_TASK_GARDEN_MODULE = "trellis_garden_module_id";
    const ATTR_OWNER = "trellis_owner_user_id";
    const ATTR_ACCESS_GRANTS = "trellis_access_grants_json";
    const LINK_ATTR = "linkedTo";
    const COMPANION_TEAM_GAP = 40;

    function applyTrellisButtonStyle(button, variant, options) {
        if (window.Trellis && window.Trellis.ui && typeof window.Trellis.ui.applyButtonStyle === "function") {
            window.Trellis.ui.applyButtonStyle(button, variant, options);
        } else if (button) {
            const normalized = variant || "neutral"; // CHANGE
            const activeOpen = normalized === "open" && options && options.active === true; // NEW
            const style = { open: ["#2563eb", activeOpen ? "#1e3a8a" : "#1d4ed8", activeOpen ? "#eff6ff" : "#fff"], add: ["#188038", "#166534", "#fff"], close: ["#b91c1c", "#b91c1c", "#fff"], danger: ["#b91c1c", "#fff", "#b91c1c"], neutral: ["#6b7280", "#111827", "#fff"] }[normalized] || ["#6b7280", "#111827", "#fff"]; // NEW
            button.setAttribute("data-trellis-button-variant", normalized); // CHANGE
            button.style.border = "1px solid " + style[0]; // NEW
            button.style.color = style[1]; // NEW
            button.style.background = style[2]; // NEW
            if (activeOpen) button.style.fontWeight = "700"; // NEW
        }
        return button;
    }

    // Override resizeChildCells so modules do not resize children
    const originalResizeChildCells = graph.resizeChildCells;

    graph.resizeChildCells = function (cell, newGeo) {
        if (cell && cell.style && cell.style.includes("module=1")) {
            return;
        }
        return originalResizeChildCells.apply(this, arguments);
    };

    // Safe style accessor
    function getStyle(cell) {
        return (cell && typeof cell.getStyle === "function")
            ? (cell.getStyle() || "")
            : (cell && cell.style ? cell.style : "") || "";
    }

    // ------------------------
    // MINIMAL MARGIN FEATURE
    // ------------------------

    // Parse integer style key with fallback
    function getIntStyle(cell, key, defVal) {
        const st = getStyle(cell);
        const m = st.match(new RegExp("(?:^|;)" + key + "=(\\d+)(?=;|$)"));
        return m ? parseInt(m[1], 10) : defVal;
    }

    // Is this a module?
    function isModule(cell) {
        return !!cell && getStyle(cell).includes("module=1");
    }

    // Get child union bounds relative to module (direct children only)
    function getChildUnionRelative(moduleCell) {
        const kids = model.getChildren(moduleCell) || [];
        let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
        let any = false;

        for (const k of kids) {
            if (!(k && k.isVertex && k.isVertex())) continue;
            const g = model.getGeometry(k);
            if (!g || g.relative) continue;

            const x = g.x || 0;
            const y = g.y || 0;
            const w = g.width || 0;
            const h = g.height || 0;

            left = Math.min(left, x);
            top = Math.min(top, y);
            right = Math.max(right, x + w);
            bottom = Math.max(bottom, y + h);
            any = true;
        }
        if (!any) return null;

        return { left, top, right, bottom, width: right - left, height: bottom - top };
    }

    // Is this a swimlane?                                                       
    function isSwimlane(cell) {
        return !!cell && /(?:^|;)swimlane(?:;|$)/.test(getStyle(cell));
    }

    // Get swimlane header size (startSize) safely                                
    function getStartSize(cell) {
        if (graph.getStartSize) {
            const sz = graph.getStartSize(cell) || {};
            return { width: sz.width || 0, height: sz.height || 0 };
        }
        const st = getStyle(cell) || "";
        const m = st.match(/(?:^|;)startSize=(\d+)(?=;|$)/);
        return { width: 0, height: m ? parseInt(m[1], 10) : 0 };
    }



    const MIN_W = 60, MIN_H = 40;
    const DEFAULT_MODULE_MARGIN_UNITS = 450; // CHANGE: 5 m at PX_PER_CM 5 and DRAW_SCALE 0.18
    const DEFAULT_MODULE_EXTERNAL_MARGIN_UNITS = 40; // NEW: default spacing kept between neighboring top-level modules

    const EPS = 0.5; // epsilon                                                      

    function getModuleMinContentSize(moduleCell) {
        return { width: MIN_W, height: MIN_H }; // CHANGE: garden dimensions are user-controlled
    }

    function getModuleHeaderHeight(moduleCell) {
        return isSwimlane(moduleCell) ? getStartSize(moduleCell).height : 0;
    }

    function getModuleMinOuterSize(moduleCell) {
        const content = getModuleMinContentSize(moduleCell);
        return { width: content.width, height: content.height + getModuleHeaderHeight(moduleCell) };
    }

    function enforceGardenModuleMinimum(moduleCell) {
        if (!isGardenModule(moduleCell)) return false;
        return false; // CHANGE: preserve API without forcing a fixed garden size
    }

    function applyModuleMargins(moduleCell, opts) {
        const o = opts || {};
        const allowShrink = !!o.allowShrink;
        const manageUpdate = o.manageUpdate !== false;
        if (!isModule(moduleCell)) return;

        const margin = getIntStyle(moduleCell, "module_margin", DEFAULT_MODULE_MARGIN_UNITS); // CHANGE
        const mGeo = model.getGeometry(moduleCell);
        if (!mGeo) return;

        const u = getChildUnionRelative(moduleCell); // union in module space
        const minContent = getModuleMinContentSize(moduleCell);

        // Children coords are in swimlane content space; outerHeight = content + header.
        const headerH = getModuleHeaderHeight(moduleCell);

        const minRight = Math.max(u ? u.right + margin : 0, minContent.width);
        const minBottom = Math.max(u ? u.bottom + margin : 0, minContent.height);

        // If shrinking is allowed, snap to minima; otherwise never shrink (only expand).     
        const targetW = allowShrink ? minRight : Math.max(mGeo.width, minRight);
        const targetH = allowShrink ? (minBottom + headerH)
            : Math.max(mGeo.height, minBottom + headerH);

        if (Math.abs(targetW - mGeo.width) < EPS && Math.abs(targetH - mGeo.height) < EPS) {
            return;
        }

        if (manageUpdate) model.beginUpdate();
        try {
            const g2 = mGeo.clone();
            g2.width = targetW;
            g2.height = targetH;
            model.setGeometry(moduleCell, g2);
        } finally {
            if (manageUpdate) model.endUpdate();
        }

        graph.refresh(moduleCell);
    }

    function getModuleMarginValue(moduleCell, defaultPx) {
        const fallback = Number.isInteger(defaultPx) && defaultPx >= 0 ? defaultPx : DEFAULT_MODULE_MARGIN_UNITS; // CHANGE
        return getIntStyle(moduleCell, "module_margin", fallback);
    }

    function setModuleStyleIntValue(moduleCell, key, valuePx) {
        if (!isModule(moduleCell)) return;
        const n = Math.max(0, parseInt(valuePx, 10) || 0);
        let st = getStyle(moduleCell) || "";
        st = st.replace(new RegExp("(?:^|;)" + key + "=\\d+(?=;|$)", "g"), "");
        st = st.replace(/;;+/g, ";").replace(/^;|;$/g, "");
        st += (st ? ";" : "") + key + "=" + n;
        model.setStyle(moduleCell, st);
        return n;
    }

    function setModuleMarginValue(moduleCell, marginPx) {
        if (!isModule(moduleCell)) return;
        model.beginUpdate();
        try {
            setModuleStyleIntValue(moduleCell, "module_margin", marginPx); // CHANGE
            applyModuleMargins(moduleCell);
        } finally {
            model.endUpdate();
        }
    }

    function promptSetModuleMargin(moduleCell) {
        if (!isModule(moduleCell) || !ui.prompt) return;
        const cur = getIntStyle(moduleCell, "module_margin", DEFAULT_MODULE_MARGIN_UNITS); // CHANGE
        if (graph.popupMenuHandler && graph.popupMenuHandler.hideMenu) {
            graph.popupMenuHandler.hideMenu();
        }
        setTimeout(function () {
            ui.prompt("Module internal margin (diagram units):", String(cur), function (val) { // CHANGE
                if (val == null) return;
                setModuleMarginValue(moduleCell, val);
            });
        }, 0);
    }

    function getModuleExternalMarginValue(moduleCell, defaultPx) {
        const fallback = Number.isInteger(defaultPx) && defaultPx >= 0 ? defaultPx : DEFAULT_MODULE_EXTERNAL_MARGIN_UNITS; // NEW
        return getIntStyle(moduleCell, "module_external_margin", fallback); // NEW
    }

    function setModuleExternalMarginValue(moduleCell, marginPx) {
        if (!isModule(moduleCell)) return;
        model.beginUpdate();
        try {
            setModuleStyleIntValue(moduleCell, "module_external_margin", marginPx); // NEW
            enforceModuleExternalMarginsFor([moduleCell], { manageUpdate: false }); // NEW
        } finally {
            model.endUpdate();
        }
    }

    function promptSetModuleExternalMargin(moduleCell) {
        if (!isModule(moduleCell) || !ui.prompt) return;
        const cur = getModuleExternalMarginValue(moduleCell); // NEW
        if (graph.popupMenuHandler && graph.popupMenuHandler.hideMenu) {
            graph.popupMenuHandler.hideMenu();
        }
        setTimeout(function () {
            ui.prompt("Module external margin (diagram units):", String(cur), function (val) { // NEW
                if (val == null) return;
                setModuleExternalMarginValue(moduleCell, val);
            });
        }, 0);
    }


    // ---- Helpers for module typing ----                                               
    function isGardenModule(cell) {
        return !!cell && getXmlFlag(cell, "garden_module");
    }

    function isTeamModule(cell) {
        return !!cell && getXmlFlag(cell, "team_module");
    }

    function isTaskModule(cell) {
        return !!cell && getXmlFlag(cell, "task_module");
    }

    function isGardenDashboardCell(cell) {
        return !!cell && cell.getAttribute && cell.getAttribute("garden_dashboard") === "1";
    }

    // Safely set/remove a style flag key=1                                       
    function setStyleFlag(cell, key, on) {
        let st = getStyle(cell) || "";
        st = st.replace(new RegExp("(?:^|;)" + key + "=[^;]*(?=;|$)", "g"), "");
        if (on) st += (st && !st.endsWith(";") ? ";" : "") + key + "=1";
        model.setStyle(cell, st);
    }

    // Mirror to XML value node if present (optional)                             
    function setValueAttr(cell, key, on) {
        const v = cell.value;
        if (v && v.nodeType === 1) { // Element node                                    
            if (on) v.setAttribute(key, "1"); else v.removeAttribute(key);
            model.setValue(cell, v);
        }
    }


    // Ensure cell.value is an Element, preserving label if it was a string
    function ensureXmlValue(cell) {
        if (!cell) return null;
        let v = cell.value;
        if (v && v.nodeType === 1) return v; // already Element                                     
        const doc = mxUtils.createXmlDocument();
        const elt = doc.createElement("obj");
        const label = (typeof v === "string") ? v : "";
        if (label) elt.setAttribute("label", label);
        cell.value = elt;
        model.setValue(cell, elt);
        return elt;
    }

    // Read boolean XML attribute "key" (="1") off cell.value Element
    function getXmlFlag(cell, key) {
        const v = cell && cell.value;
        return (v && v.nodeType === 1 && v.getAttribute(key) === "1") ? true : false;
    }

    // Write/remove boolean XML attribute "key" on cell.value Element
    function setXmlFlag(cell, key, on) {
        const elt = ensureXmlValue(cell);
        if (!elt) return;
        if (on) elt.setAttribute(key, "1"); else elt.removeAttribute(key);
        model.setValue(cell, elt);
    }

    function cellId(cell) {
        return cell && (cell.id || (cell.getId && cell.getId())) || "";
    }

    function getValueAttr(cell, key) {
        const v = cell && cell.value;
        return v && v.nodeType === 1 ? (v.getAttribute(key) || "") : "";
    }

    function setStringValueAttr(cell, key, value) {
        const elt = ensureXmlValue(cell);
        if (!elt) return;
        const next = value == null || value === "" ? "" : String(value);
        if (next) elt.setAttribute(key, next);
        else elt.removeAttribute(key);
        model.setValue(cell, elt);
    }

    function linkSet(cell) {
        return new Set(String(getValueAttr(cell, LINK_ATTR) || "").split(",").map(function (part) { return part.trim(); }).filter(Boolean));
    }

    function setLinkSet(cell, ids) {
        setStringValueAttr(cell, LINK_ATTR, Array.from(ids || []).filter(Boolean).join(","));
    }

    function addReciprocalLink(a, b) {
        const aId = cellId(a);
        const bId = cellId(b);
        if (!a || !b || !aId || !bId || a === b) return false;
        const aLinks = linkSet(a);
        const bLinks = linkSet(b);
        let changed = false;
        if (!aLinks.has(bId)) { aLinks.add(bId); setLinkSet(a, aLinks); changed = true; }
        if (!bLinks.has(aId)) { bLinks.add(aId); setLinkSet(b, bLinks); changed = true; }
        return changed;
    }

    function plainCellLabel(cell, fallback) {
        const raw = getValueAttr(cell, "label") || (typeof (cell && cell.value) === "string" ? cell.value : "");
        if (document && document.createElement) {
            const holder = document.createElement("div");
            holder.innerHTML = raw;
            const text = String(holder.textContent || "").replace(/\s+/g, " ").trim();
            if (text) return text;
        }
        const stripped = String(raw || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        return stripped || fallback || "Garden";
    }

    function companionModuleLabelFallback(cell) {
        if (isTeamModule(cell)) return "Team Module";
        if (isTaskModule(cell)) return "Task Module";
        if (isGardenModule(cell)) return "Garden Module";
        return "Module";
    }

    function normalizeModuleLabel(cell, label) {
        const trimmed = String(label == null ? "" : label).trim();
        return trimmed || companionModuleLabelFallback(cell);
    }

    function getModuleLabel(cell, fallback) {
        return plainCellLabel(cell, fallback || companionModuleLabelFallback(cell));
    }

    function buildModuleLabelXmlValueForEdit(cell) {
        if (!cell) return null;
        const value = cell.value;
        if (value && value.nodeType === 1) return value.cloneNode(true);
        const doc = mxUtils.createXmlDocument();
        const node = doc.createElement("obj");
        if (typeof value === "string" && value) node.setAttribute("label", value);
        return node;
    }

    function setModuleLabelUndoable(cell, label) {
        const node = buildModuleLabelXmlValueForEdit(cell);
        if (!node) return;
        const next = label == null || label === "" ? "" : String(label);
        if (next) node.setAttribute("label", next);
        else node.removeAttribute("label");
        model.beginUpdate();
        try {
            model.setValue(cell, node);
        } finally {
            model.endUpdate();
        }
    }

    function writeModuleLabel(cell, label) {
        const next = normalizeModuleLabel(cell, label);
        if (getModuleLabel(cell) === next) return next;
        setModuleLabelUndoable(cell, next);
        if (graph.refresh) graph.refresh(cell);
        return next;
    }

    function linkedGardenModuleForCompanion(cell) {
        const gardenId = getValueAttr(cell, ATTR_TEAM_GARDEN_MODULE) || getValueAttr(cell, ATTR_TASK_GARDEN_MODULE);
        const garden = gardenId && model.getCell ? model.getCell(gardenId) : null;
        return isGardenModule(garden) ? garden : null;
    }

    function linkedGardenLabelForCompanion(cell) {
        const garden = linkedGardenModuleForCompanion(cell);
        return garden ? getModuleLabel(garden, "Garden") : "";
    }

    function stopModuleOverlayDomEvent(evt) {
        if (evt && evt.stopPropagation) evt.stopPropagation();
    }

    function stopAndPreventModuleOverlayDomEvent(evt) {
        stopModuleOverlayDomEvent(evt);
        if (evt && evt.preventDefault) evt.preventDefault();
    }

    function cellPageBounds(cell) {
        const g = model.getGeometry(cell);
        if (!g || g.relative) return null;
        let x = Number(g.x) || 0;
        let y = Number(g.y) || 0;
        let p = model.getParent(cell);
        while (p) {
            const pg = model.getGeometry(p);
            if (pg && !pg.relative) {
                x += Number(pg.x) || 0;
                y += Number(pg.y) || 0;
                if (isModule(p) && isSwimlane(p)) y += getStartSize(p).height || 0;
            }
            p = model.getParent(p);
        }
        return { x, y, w: Number(g.width) || 0, h: Number(g.height) || 0 }; // NEW
    }

    function rectCenter(rect) {
        return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }; // NEW
    }

    function expandedRect(rect, margin) {
        const gap = Math.max(0, Number(margin) || 0);
        return { x: rect.x - gap, y: rect.y - gap, w: rect.w + 2 * gap, h: rect.h + 2 * gap }; // NEW
    }

    function rectsIntersect(a, b) {
        return !!(a && b && b.x < a.x + a.w - EPS && b.x + b.w > a.x + EPS && b.y < a.y + a.h - EPS && b.y + b.h > a.y + EPS); // NEW
    }

    function modulePairExternalMargin(a, b) {
        return Math.max(getModuleExternalMarginValue(a), getModuleExternalMarginValue(b)); // NEW
    }

    function allTopLevelModules() {
        const root = graph.getDefaultParent();
        const cells = model.cells ? Object.values(model.cells) : (model.getChildren(root) || []);
        const seen = new Set();
        return cells.filter(function (cell) {
            const id = cellId(cell);
            if (!id || seen.has(id) || !isModule(cell) || model.getParent(cell) !== root) return false;
            seen.add(id);
            return true;
        });
    }

    function translateModuleGeometry(cell, dx, dy) {
        const g = model.getGeometry(cell);
        if (!g || g.relative || (Math.abs(dx) < EPS && Math.abs(dy) < EPS)) return false;
        const g2 = g.clone();
        g2.x = (Number(g2.x) || 0) + dx;
        g2.y = (Number(g2.y) || 0) + dy;
        model.setGeometry(cell, g2);
        if (graph.refresh) graph.refresh(cell);
        return true; // NEW
    }

    function shortestExternalMarginDelta(anchorRect, targetRect, margin) {
        const expanded = expandedRect(anchorRect, margin);
        if (!rectsIntersect(expanded, targetRect)) return null;
        const candidates = [
            { dx: expanded.x - (targetRect.x + targetRect.w), dy: 0 },
            { dx: expanded.x + expanded.w - targetRect.x, dy: 0 },
            { dx: 0, dy: expanded.y - (targetRect.y + targetRect.h) },
            { dx: 0, dy: expanded.y + expanded.h - targetRect.y }
        ];
        candidates.sort(function (a, b) { return (Math.abs(a.dx) + Math.abs(a.dy)) - (Math.abs(b.dx) + Math.abs(b.dy)); });
        return candidates[0] || null; // NEW
    }

    function vectorExternalMarginDelta(anchorRect, targetRect, margin, vector) {
        const expanded = expandedRect(anchorRect, margin);
        if (!rectsIntersect(expanded, targetRect)) return null;
        const len = Math.sqrt((vector && vector.x || 0) * (vector && vector.x || 0) + (vector && vector.y || 0) * (vector && vector.y || 0));
        if (len < EPS) return null;
        const vx = vector.x / len;
        const vy = vector.y / len;
        const ac = rectCenter(anchorRect);
        const tc = rectCenter(targetRect);
        if (((tc.x - ac.x) * vx + (tc.y - ac.y) * vy) <= EPS) return null;
        const candidates = [];
        if (Math.abs(vx) >= EPS) {
            if (vx > 0) candidates.push((expanded.x + expanded.w - targetRect.x) / vx);
            else candidates.push((expanded.x - (targetRect.x + targetRect.w)) / vx);
        }
        if (Math.abs(vy) >= EPS) {
            if (vy > 0) candidates.push((expanded.y + expanded.h - targetRect.y) / vy);
            else candidates.push((expanded.y - (targetRect.y + targetRect.h)) / vy);
        }
        candidates.sort(function (a, b) { return a - b; });
        for (let i = 0; i < candidates.length; i++) {
            const t = candidates[i];
            if (!(t > EPS)) continue;
            const delta = { dx: vx * t, dy: vy * t }; // CHANGE
            const moved = { x: targetRect.x + delta.dx, y: targetRect.y + delta.dy, w: targetRect.w, h: targetRect.h };
            if (!rectsIntersect(expanded, moved)) return delta;
        }
        return null; // NEW
    }

    function relativePushVector(anchorRect, targetRect) {
        const ac = rectCenter(anchorRect);
        const tc = rectCenter(targetRect);
        const dx = tc.x - ac.x;
        const dy = tc.y - ac.y;
        if (Math.abs(dx) >= EPS || Math.abs(dy) >= EPS) return { x: dx, y: dy };
        return { x: 1, y: 0 }; // NEW
    }

    function enforceModuleExternalMarginsFor(seedCells, opts) {
        const options = opts || {};
        const seeds = (seedCells || []).filter(function (cell) { return isModule(cell) && model.getParent(cell) === graph.getDefaultParent(); });
        if (!seeds.length || graph.__trellisModuleExternalMarginEnforcing) return;
        const modules = allTopLevelModules();
        if (modules.length < 2) return;
        const seedIds = new Set(seeds.map(cellId));
        let frontier = seeds.slice();
        const manageUpdate = options.manageUpdate !== false;
        graph.__trellisModuleExternalMarginEnforcing = true;
        if (manageUpdate) model.beginUpdate();
        try {
            const maxPasses = Math.max(1, modules.length * 2);
            for (let pass = 0; pass < maxPasses && frontier.length; pass++) {
                const movedThisPass = [];
                frontier.forEach(function (anchor) {
                    const anchorRect = cellPageBounds(anchor);
                    if (!anchorRect) return;
                    modules.forEach(function (candidate) {
                        const candidateId = cellId(candidate);
                        if (!candidateId || candidate === anchor || seedIds.has(candidateId)) return;
                        const candidateRect = cellPageBounds(candidate);
                        if (!candidateRect) return;
                        const margin = modulePairExternalMargin(anchor, candidate);
                        const preferred = options.vector || relativePushVector(anchorRect, candidateRect);
                        const delta = vectorExternalMarginDelta(anchorRect, candidateRect, margin, preferred)
                            || shortestExternalMarginDelta(anchorRect, candidateRect, margin);
                        if (delta && translateModuleGeometry(candidate, delta.dx, delta.dy)) movedThisPass.push(candidate);
                    });
                });
                frontier = movedThisPass;
            }
        } finally {
            if (manageUpdate) model.endUpdate();
            graph.__trellisModuleExternalMarginEnforcing = false;
        }
    }

    function setCellLabel(cell, label) {
        setStringValueAttr(cell, "label", label || "");
    }


    // Place a new child inside a module using abs click coords and a cell factory           
    function placeChildInModule(parentModule, absX, absY, makeChild /*(relX,relY)=>mxCell*/, opts) {
        const o = opts || {};
        const pg = graph.getCellGeometry(parentModule);
        const relX = pg ? (absX - pg.x) : absX;
        const relY = pg ? (absY - pg.y) : absY;

        let child = null;
        model.beginUpdate();
        try {
            child = makeChild(relX, relY);
            child && (child.vertex = true);
            if (child) model.add(parentModule, child);
            if (o.applyMargins !== false) {
                applyModuleMargins(parentModule);
                if (child) applyModuleMargins(child);
            }
        } finally {
            model.endUpdate();
        }
        if (o.select !== false && child) graph.setSelectionCell(child);
        return child;
    }

    function hasGardenSettingsSet(cell) {                                                     
        const v = cell && cell.value;                                                         
        if (!(v && v.nodeType === 1)) return false;                                           
        const city = (v.getAttribute("city_id") || v.getAttribute("city_name") || "").trim();
        const units = (v.getAttribute("unit_system") || "").trim();                           
        return !!(city && units);                                                             
    }                                                                                         

    function emitGardenSettingsNeededIfMissing(graph, moduleCell) {                           
        if (!graph || !moduleCell) return;                                                    
        if (hasGardenSettingsSet(moduleCell)) return;                                         
        graph.fireEvent(new mxEventObject(                                                    
            "usl:gardenModuleNeedsSettings",                                                  
            "cell", moduleCell                                                                
        ));                                                                                   
    }                                                                                         


    function setModuleType(cell, type) {
        let becameGarden = false;                                                            

        model.beginUpdate();
        try {
            ensureXmlValue(cell);
            setXmlFlag(cell, "garden_module", false);
            setXmlFlag(cell, "team_module", false);
            setXmlFlag(cell, "task_module", false);

            // Set the desired flag
            if (type === "garden") {
                setXmlFlag(cell, "garden_module", true);
                becameGarden = true;                                                        
            } else if (type === "team") {
                setXmlFlag(cell, "team_module", true);
            } else if (type === "task") {
                setXmlFlag(cell, "task_module", true);
            }

            let st = getStyle(cell) || "";
            st = st.replace(/(?:^|;)swimlaneFillColor=[^;]*(?=;|$)/g, "");
            st = st.replace(/;;+/g, ";").replace(/^;|;$/g, "");

            if (type === "garden") {
                st += (st ? ";" : "") + "swimlaneFillColor=#B9E0A5";
            } else if (type === "team") {
                st += (st ? ";" : "") + "swimlaneFillColor=#FFF2CC";
            } else if (type === "task") {
                st += (st ? ";" : "") + "swimlaneFillColor=#E0F2FE";
            } else {
                st += (st ? ";" : "") + "swimlaneFillColor=default";
            }

            model.setStyle(cell, st);
        } finally {
            model.endUpdate();
        }
        graph.refresh(cell);

        if (becameGarden) {
            model.beginUpdate();
            try {
                enforceGardenModuleMinimum(cell);
                applyModuleMargins(cell, { allowShrink: false });
                ensureGardenTeamModule(cell, { insideUpdate: true });
                ensureGardenTaskModule(cell, { insideUpdate: true, createMainBoard: true });
            } finally {
                model.endUpdate();
            }
        }

        if (becameGarden) {
            setTimeout(() => emitGardenSettingsNeededIfMissing(graph, cell), 0);
        }                                                                              
    }                                                                                        

    function isRoleCard(cell) {
        const st = getStyle(cell);
        if (!st) return false;
        if (/(^|;)role_card=1(;|$)/.test(st)) return true;             // primary signal
        // optional fallback: swimlane under a team module
        const p = model.getParent(cell);
        return /(^|;)swimlane(;|$)/.test(st) && !!p && isModule(p) && isTeamModule(p);
    }

    function isRoleImageRow(cell) {
        return /(^|;)role_imagerow=1(;|$)/.test(getStyle(cell));
    }

    function isRoleAvatar(cell) {
        return /(^|;)role_avatar=1(;|$)/.test(getStyle(cell));
    }

    const ROLE_CARD_VERSION = "2";
    const ROLE_EXPANDED_W = 260;
    const ROLE_EXPANDED_H = 250;
    const ROLE_COLLAPSED_W = 180;
    const ROLE_COLLAPSED_H = 64;

    function styleHasKeyValue(cell, key, value) {
        const safeKey = String(key || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const safeValue = String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp("(^|;)" + safeKey + "=" + safeValue + "(;|$)").test(getStyle(cell));
    }

    function isRoleCardV2(cell) {
        return isRoleCard(cell) && styleHasKeyValue(cell, "role_card_version", ROLE_CARD_VERSION);
    }

    function htmlEscape(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function getCellDisplayText(cell) {
        if (!cell) return "";
        const value = cell.value;
        const raw = value && value.getAttribute ? (value.getAttribute("label") || "") : (value == null ? "" : String(value));
        if (document && document.createElement) {
            const holder = document.createElement("div");
            holder.innerHTML = raw;
            return String(holder.textContent || "").replace(/\s+/g, " ").trim();
        }
        return String(raw).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    }

    function getCellRawLabel(cell) {
        if (!cell) return "";
        const value = cell.value;
        return value && value.getAttribute ? (value.getAttribute("label") || "") : (value == null ? "" : String(value));
    }

    function getRoleField(roleCard, flag) {
        const children = model.getChildren(roleCard) || [];
        return children.find(function (child) { return styleHasKeyValue(child, flag, "1"); }) || null;
    }

    function roleFieldDisplayValue(roleCard, flag, fallback) {
        const text = getCellDisplayText(getRoleField(roleCard, flag));
        return text || fallback;
    }

    function roleInitials(name) {
        const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return "?";
        return (parts[0].charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : "")).toUpperCase();
    }

    function roleAvatarColor(seed) {
        const palette = ["#2563EB", "#047857", "#B45309", "#7C3AED", "#BE123C", "#0F766E"];
        let hash = 0;
        String(seed || "").split("").forEach(function (ch) { hash = ((hash * 31) + ch.charCodeAt(0)) | 0; });
        return palette[Math.abs(hash) % palette.length];
    }

    function getStyleImageSource(cell) {
        const match = getStyle(cell).match(/(?:^|;)image=(.*?)(?=;[A-Za-z_][A-Za-z0-9_]*=|;?$)/);
        return match ? String(match[1] || "").trim() : "";
    }

    function removeStyleKey(style, key) {
        const safeKey = String(key || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const valuePattern = key === "image" ? ".*?(?=;[A-Za-z_][A-Za-z0-9_]*=|;?$)" : "[^;]*";
        return String(style || "")
            .replace(new RegExp("(?:^|;)" + safeKey + "=" + valuePattern, "g"), "")
            .replace(/;;+/g, ";")
            .replace(/^;|;$/g, "");
    }

    function setStyleValue(style, key, value) {
        let next = removeStyleKey(style, key);
        next += (next ? ";" : "") + key + "=" + String(value == null ? "" : value);
        return next;
    }

    function summaryInitialsImageSource(name, title) {
        const initials = htmlEscape(roleInitials(name));
        const fill = roleAvatarColor(name + "|" + title);
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="38" height="38" viewBox="0 0 38 38">'
            + '<circle cx="19" cy="19" r="19" fill="' + fill + '"/>'
            + '<text x="19" y="24" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" font-weight="700" fill="#ffffff">' + initials + '</text>'
            + '</svg>';
        return "data:image/svg+xml," + encodeURIComponent(svg);
    }

    function buildRoleSummaryImageSource(roleCard, name, title) {
        return getStyleImageSource(getRoleAvatar(roleCard)) || summaryInitialsImageSource(name, title);
    }

    function applyRoleSummaryImageStyle(roleCard, imageSource) {
        let st = getStyle(roleCard);
        ["image", "imageWidth", "imageHeight", "imageAlign", "imageVerticalAlign", "imageAspect", "spacingLeft", "spacingRight", "spacingTop", "align", "verticalAlign"].forEach(function (key) {
            st = removeStyleKey(st, key);
        });
        st = setStyleValue(st, "image", imageSource);
        st = setStyleValue(st, "imageWidth", "38");
        st = setStyleValue(st, "imageHeight", "38");
        st = setStyleValue(st, "imageAlign", "left");
        st = setStyleValue(st, "imageVerticalAlign", "top");
        st = setStyleValue(st, "imageAspect", "1");
        st = setStyleValue(st, "spacingLeft", "54");
        st = setStyleValue(st, "spacingRight", "8");
        st = setStyleValue(st, "spacingTop", "8");
        st = setStyleValue(st, "align", "left");
        st = setStyleValue(st, "verticalAlign", "top");
        if (getStyle(roleCard) !== st) model.setStyle(roleCard, st);
    }

    function buildCollapsedRoleLabel(roleCard) {
        const name = roleFieldDisplayValue(roleCard, "role_name", "Unnamed person");
        const title = roleFieldDisplayValue(roleCard, "role_title", "Unspecified role");
        return '<div style="box-sizing:border-box;width:100%;height:100%;padding:6px 8px 5px 0;text-align:left;font-family:Arial,sans-serif;overflow:hidden;line-height:1.15;">'
            + '<div style="font-size:12px;font-weight:700;color:#1F2937;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + htmlEscape(name) + '</div>'
            + '<div style="font-size:10px;color:#4B5563;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;">' + htmlEscape(title) + '</div>'
            + '</div>';
    }

    function syncRoleCardSummary(roleCard) {
        if (!isRoleCardV2(roleCard)) return false;
        const name = roleFieldDisplayValue(roleCard, "role_name", "Unnamed person");
        const title = roleFieldDisplayValue(roleCard, "role_title", "Unspecified role");
        const nextLabel = buildCollapsedRoleLabel(roleCard);
        const imageSource = buildRoleSummaryImageSource(roleCard, name, title);
        const labelChanged = getCellRawLabel(roleCard) !== nextLabel;
        if (labelChanged) setCellLabel(roleCard, nextLabel);
        applyRoleSummaryImageStyle(roleCard, imageSource);
        return labelChanged;
    }

    let syncingRoleCardSummaries = false;

    function syncAllRoleCardSummaries() {
        if (syncingRoleCardSummaries) return;
        const cells = model.cells ? Object.values(model.cells) : [];
        const roles = cells.filter(isRoleCardV2);
        if (!roles.length) return;
        syncingRoleCardSummaries = true;
        model.beginUpdate();
        try { roles.forEach(syncRoleCardSummary); } finally { model.endUpdate(); syncingRoleCardSummaries = false; }
    }

    function makeAlternateBounds(x, y, width, height) {
        return (typeof mxRectangle !== "undefined") ? new mxRectangle(x, y, width, height) : new mxGeometry(x, y, width, height);
    }

    if (model.addListener && typeof mxEvent !== "undefined" && mxEvent.CHANGE) {
        model.addListener(mxEvent.CHANGE, function () { syncAllRoleCardSummaries(); });
    }

    function getRoleImageRow(roleCard) {
        const children = model.getChildren(roleCard) || [];
        return children.find(function (child) { return isRoleImageRow(child); }) || null;
    }

    function getRoleAvatar(roleCard) {
        const imageRow = getRoleImageRow(roleCard);
        const children = imageRow ? (model.getChildren(imageRow) || []) : [];
        return children.find(function (child) { return isRoleAvatar(child); }) || null;
    }

    function roleCardForImageCell(cell) {
        if (!cell) return null;
        if (isRoleCard(cell)) return cell;
        if (isRoleImageRow(cell)) {
            const roleCard = model.getParent(cell);
            return isRoleCard(roleCard) ? roleCard : null;
        }
        if (isRoleAvatar(cell)) {
            const imageRow = model.getParent(cell);
            const roleCard = model.getParent(imageRow);
            return isRoleImageRow(imageRow) && isRoleCard(roleCard) ? roleCard : null;
        }
        return null;
    }

    function roleHasAvatar(roleCard) {
        return !!getRoleAvatar(roleCard);
    }

    function setCellLabel(cell, label) {
        if (!cell) return;
        const v = cell.value;
        if (v && v.nodeType === 1) {
            v.setAttribute("label", label || "");
            model.setValue(cell, v);
        } else {
            model.setValue(cell, label || "");
        }
    }

    function normalizeRoleImagePlaceholder(roleCard) {
        const imageRow = getRoleImageRow(roleCard);
        if (imageRow && !roleHasAvatar(roleCard) && imageRow.value === "Image") setCellLabel(imageRow, "click to add image");
    }

    function roleImageActionForCell(cell, options) {
        const opts = options || {};
        const roleCard = roleCardForImageCell(cell);
        if (!roleCard) return null;
        const hasAvatar = roleHasAvatar(roleCard);
        if (hasAvatar && !isRoleAvatar(cell) && !(opts.allowImageRowChange && isRoleImageRow(cell))) return null;
        if (!hasAvatar && !(isRoleCard(cell) || isRoleImageRow(cell))) return null;
        return { roleCard: roleCard, mode: hasAvatar ? "change" : "add", avatar: getRoleAvatar(roleCard), imageRow: getRoleImageRow(roleCard), sourceCell: cell };
    }

    function getOrCreateRoleImageRow(roleCard) {
        let imageRow = getRoleImageRow(roleCard);
        if (imageRow) return imageRow;
        const roleGeo = graph.getCellGeometry(roleCard);
        const rowGeo = new mxGeometry(0, 0, roleGeo ? roleGeo.width : 80, 80);
        const rowStyle = "shape=rectangle;fillColor=#ffffff;strokeColor=#d6b656;role_imagerow=1;";
        imageRow = new mxCell("click to add image", rowGeo, rowStyle);
        imageRow.vertex = true;
        model.add(roleCard, imageRow, 0);
        return imageRow;
    }

    function removeExistingRoleAvatar(imageRow) {
        const children = model.getChildren(imageRow) || [];
        children.forEach(function (child) { if (isRoleAvatar(child)) model.remove(child); });
    }

    function tagRoleAvatar(cell) {
        let st = getStyle(cell) || "";
        st = st.replace(/(?:^|;)role_avatar=1(?=;|$)/g, "");
        st = st.replace(/;;+/g, ";").replace(/^;|;$/g, "");
        st += (st ? ";" : "") + "role_avatar=1";
        model.setStyle(cell, st);
    }

    function placeRoleAvatar(roleCard, cell) {
        const imageRow = getOrCreateRoleImageRow(roleCard);
        removeExistingRoleAvatar(imageRow);
        setCellLabel(imageRow, "");
        const geo = cell.getGeometry().clone();
        geo.width = isRoleCardV2(roleCard) ? 40 : 70;
        geo.height = isRoleCardV2(roleCard) ? 40 : 70;
        geo.x = 5;
        geo.y = 5;
        model.setGeometry(cell, geo);
        tagRoleAvatar(cell);
        model.remove(cell);
        model.add(imageRow, cell);
        syncRoleCardSummary(roleCard);
    }


    function createReadOnlyRoleLabel(text, x, y, width) {
        const label = new mxCell(text, new mxGeometry(x, y, width, 14),
            "shape=rectangle;fillColor=none;strokeColor=none;fontSize=9;fontColor=#6B7280;align=left;verticalAlign=bottom;whiteSpace=wrap;editable=0;movable=0;resizable=0;connectable=0;role_field_label=1;");
        label.vertex = true;
        return label;
    }

    function createRoleValueCell(value, x, y, width, height, extraStyle) {
        const cell = new mxCell(value, new mxGeometry(x, y, width, height),
            "shape=rectangle;align=left;verticalAlign=middle;whiteSpace=wrap;html=1;overflow=hidden;fillColor=#ffffff;strokeColor=#CBD5E1;fontSize=12;fontColor=#111827;spacingLeft=6;spacingRight=6;" + (extraStyle || ""));
        cell.vertex = true;
        return cell;
    }

    function createRoleHeaderSeparator(width) {
        const separator = new mxCell("", new mxGeometry(0, 54, width, 1),
            "shape=line;strokeColor=#7AA35A;strokeWidth=1;editable=0;movable=0;resizable=0;connectable=0;role_header_separator=1;");
        separator.vertex = true;
        return separator;
    }

    function createRoleCard(graph, moduleCell, x, y, opts) {
        const o = opts || {};
        const manageUpdate = o.manageUpdate !== false;
        const w = ROLE_EXPANDED_W, h = ROLE_EXPANDED_H;
        const moduleGeo = graph.getCellGeometry(moduleCell);

        const relX = x - moduleGeo.x;
        const relY = y - moduleGeo.y;

        const roleGeo = new mxGeometry(relX, relY, w, h);
        roleGeo.alternateBounds = makeAlternateBounds(relX, relY, ROLE_COLLAPSED_W, ROLE_COLLAPSED_H);
        const role = new mxCell("", roleGeo,
            "shape=label;whiteSpace=wrap;html=1;collapsible=1;resizable=0;rounded=1;arcSize=8;fillColor=#F8FAFC;strokeColor=#7AA35A;role_card=1;role_card_version=2");
        role.vertex = true;

        const headerSeparator = createRoleHeaderSeparator(w);
        const photoLabel = createReadOnlyRoleLabel("Photo", 10, 62, 50);
        const avatar = createRoleValueCell("click to add image", 10, 76, 50, 50,
            "align=center;verticalAlign=middle;fillColor=#F3F4F6;strokeColor=#94A3B8;fontSize=10;spacingLeft=0;role_imagerow=1;");

        const nameLabel = createReadOnlyRoleLabel("Name", 70, 62, 174);
        const name = createRoleValueCell("", 70, 76, 174, 24, "fontStyle=1;role_name=1;");

        const titleLabel = createReadOnlyRoleLabel("Role / title", 70, 104, 174);
        const title = createRoleValueCell("", 70, 118, 174, 22, "role_title=1;");

        const notesLabel = createReadOnlyRoleLabel("Description / notes", 10, 144, 234);
        const notes = createRoleValueCell("", 10, 158, 234, 34, "verticalAlign=top;spacingTop=4;");

        const contactLabel = createReadOnlyRoleLabel("Contact info", 10, 194, 234);
        const contact = createRoleValueCell("", 10, 208, 234, 32, "fontSize=10;verticalAlign=top;spacingTop=4;role_contact=1;");

        if (manageUpdate) model.beginUpdate();
        try {
            model.add(moduleCell, role);
            [headerSeparator, photoLabel, avatar, nameLabel, name, titleLabel, title, notesLabel, notes, contactLabel, contact].forEach(child => model.add(role, child));
            syncRoleCardSummary(role);
        } finally {
            if (manageUpdate) model.endUpdate();
        }
        return role;
    }

    function addRoleCardToTeamModule(moduleCell, x, y) {
        if (!moduleCell || !isTeamModule(moduleCell)) return null;
        let role = null;
        model.beginUpdate();
        try {
            role = createRoleCard(graph, moduleCell, x, y, { manageUpdate: false });
            applyModuleMargins(moduleCell, { manageUpdate: false });
        } finally {
            model.endUpdate();
        }
        if (role && graph.setSelectionCell) graph.setSelectionCell(role);
        return role;
    }


    function selectRoleImage(ui, graph, roleCard) {
        const origInsertVertex = graph.insertVertex;
        let restored = false;

        function restoreInsertVertex() {
            if (restored) return;
            restored = true;
            graph.insertVertex = origInsertVertex;
        }

        graph.insertVertex = function (parent, id, value, x, y, w, h, style, relative) {
            const cell = origInsertVertex.apply(this, arguments);
            const insertedStyle = style || getStyle(cell);

            if (insertedStyle && insertedStyle.includes("shape=image")) {
                // Delay to let Draw.io finish committing the inserted image
                setTimeout(() => {
                    model.beginUpdate();
                    try {
                        placeRoleAvatar(roleCard, cell);
                    } finally {
                        model.endUpdate();
                    }

                    restoreInsertVertex();
                }, 0);
            } else {
                restoreInsertVertex();
            }

            return cell;
        };

        // Trigger the standard Insert → Image dialog
        const action = ui.actions && ui.actions.get ? ui.actions.get("insertImage") : null;
        if (!action || typeof action.funct !== "function") { restoreInsertVertex(); return; }
        try {
            action.funct();
        } catch (e) {
            restoreInsertVertex();
            throw e;
        }
    }



    // --- Layout Manager for Role Cards ---
    graph.layoutManager = new mxLayoutManager(graph);
    graph.layoutManager.getLayout = function (cell) {
        if (cell != null && graph.getModel().isVertex(cell)) {
            const style = graph.getCurrentCellStyle(cell);
            if (style["fillColor"] === "#fff2cc") {
                const layout = new mxStackLayout(graph, false);
                layout.resizeParent = true;
                layout.fill = true;
                layout.border = 5;
                layout.marginLeft = 5;
                layout.marginRight = 5;
                return layout;
            }
        }
        return null;
    };

    // ------------------------
    // EVENT HOOKS (LIGHTWEIGHT)
    // ------------------------

    if (!graph.__uslHandlersInstalled) {
        graph.__uslHandlersInstalled = true;

        // NOTE: We keep edges/vertices default behavior (Draw.io handles containment).         

        graph.addListener(mxEvent.ADD_CELLS, function (sender, evt) {
            const cells = evt.getProperty("cells") || [];
            const seenModules = new Set();
            cells.forEach(c => {
                const p = model.getParent(c);
                if (p && isModule(p)) seenModules.add(p.id);
            });
             // children shouldn’t trigger shrink (usually expands only)
            seenModules.forEach(id => applyModuleMargins(model.getCell(id), { allowShrink: false }));
        });

        // Utility: get absolute bounds of a vertex, walking up parents      
        function getAbsBounds(cell) {
            const g = model.getGeometry(cell);
            if (!g || g.relative) return null;

            let x = g.x || 0;
            let y = g.y || 0;
            const w = g.width || 0;
            const h = g.height || 0;

            let p = model.getParent(cell);
            while (p) {
                const pg = model.getGeometry(p);
                if (pg && !pg.relative) {
                    x += pg.x || 0;
                    y += pg.y || 0;

                    // Adjust for swimlane header so child coordinates match visual position   
                    if (isModule(p) && isSwimlane(p)) {
                        const header = getStartSize(p).height || 0;
                        y += header;
                    }
                }
                p = model.getParent(p);
            }

            return { x, y, w, h };
        }


        // Tiler group classification – REUSE your existing version if you have one   
        function isTilerGroup(cell) {
            if (!cell) return false;
            // Example using XML attributes; adapt to your own schema if needed             
            const v = cell.value;
            if (v && v.nodeType === 1) {
                if (v.getAttribute("tiler_group") === "1") return true;
            }
            const st = getStyle(cell);
            return /(^|;)tiler_group=1(;|$)/.test(st);
        }

        // Does this cell sit under any tiler group in its ancestor chain?            
        function hasTilerGroupAncestor(cell) {
            let p = model.getParent(cell);
            while (p) {
                if (isTilerGroup(p)) return true;
                p = model.getParent(p);
            }
            return false;
        }

        // Filter to only top-level cells (no ancestor also in "cells")          
        function getTopLevelAddedCells(cells) {
            const idSet = new Set();
            cells.forEach(c => {
                if (c && c.id != null) idSet.add(c.id);
            });

            return cells.filter(c => {
                if (!c) return false;
                let p = model.getParent(c);
                while (p) {
                    if (p.id != null && idSet.has(p.id)) return false;
                    p = model.getParent(p);
                }
                return true;
            });
        }

        // Check if a cell already has a module ancestor                       
        function hasModuleAncestor(cell) {
            let p = model.getParent(cell);
            while (p) {
                if (isModule(p)) return true;
                p = model.getParent(p);
            }
            return false;
        }

        function isAllowedModuleParent(parent) {
            return !!parent && (parent === graph.getDefaultParent() || isModule(parent));
        }

        function restoreModuleToDefaultParent(cell) {
            if (!isModule(cell)) return false;
            const parent = model.getParent(cell);
            if (isAllowedModuleParent(parent)) return false;
            const b = getAbsBounds(cell);
            const root = graph.getDefaultParent();
            const rootGeo = model.getGeometry(root);
            const rootX = (rootGeo && !rootGeo.relative) ? (rootGeo.x || 0) : 0;
            const rootY = (rootGeo && !rootGeo.relative) ? (rootGeo.y || 0) : 0;
            const g = cell.getGeometry && cell.getGeometry();
            if (b && g) {
                const g2 = g.clone();
                g2.x = b.x - rootX;
                g2.y = b.y - rootY;
                model.setGeometry(cell, g2);
            }
            model.add(root, cell);
            return true;
        }

        function sanitizeModuleParents(cells) {
            const source = cells && cells.length ? cells : (model.cells ? Object.values(model.cells) : []);
            if (!source.length) return false;
            let changed = false;
            model.beginUpdate();
            try { source.forEach(function (cell) { changed = restoreModuleToDefaultParent(cell) || changed; }); } finally { model.endUpdate(); }
            return changed;
        }

        const originalIsValidDropTarget = graph.isValidDropTarget;
        graph.isValidDropTarget = function (cell, cells, evt) {
            if ((cells || []).some(isModule) && cell && !isAllowedModuleParent(cell)) return false;
            return originalIsValidDropTarget ? originalIsValidDropTarget.apply(this, arguments) : true;
        };

        // Reparent only top-level cells that are not already under modules
        // and not children of tiler groups                                                
        function reparentCellsIntoModules(cells) {
            if (!cells || !cells.length) return;

            // Skip modules themselves; only auto-snap non-module vertices          
            cells = cells.filter(function (c) {
                return c && !isModule(c);
            });
            if (!cells.length) return;

            // 1) Only process top-level added cells (no ancestor also in "cells")         
            let topLevel = getTopLevelAddedCells(cells);
            if (!topLevel.length) return;

            // 2) Skip anything that already has a module ancestor                         
            topLevel = topLevel.filter(c => !hasModuleAncestor(c));
            if (!topLevel.length) return;

            // 3) Skip anything that has a tiler group ancestor (tiler internals)          
            topLevel = topLevel.filter(c => !hasTilerGroupAncestor(c));
            if (!topLevel.length) return;

            const modules = Object.values(model.cells)
                .filter(c => isModule(c));
            if (!modules.length) return;

            topLevel.forEach(cell => {
                if (!model.isVertex(cell)) return;

                const b = getAbsBounds(cell);
                if (!b) return;

                const containing = modules.filter(m => rectInsideModule(b, m));
                if (containing.length === 0) return;

                containing.sort((a, b2) => {
                    const ga = graph.getCellGeometry(a);
                    const gb = graph.getCellGeometry(b2);
                    return (ga.width * ga.height) - (gb.width * gb.height);
                });

                const targetModule = containing[0];
                const oldParent = model.getParent(cell);
                if (oldParent === targetModule) return;

                const g = cell.getGeometry();
                if (g) {
                    const mg = graph.getCellGeometry(targetModule);
                    if (mg) {
                        const headerH = isSwimlane(targetModule)
                            ? getStartSize(targetModule).height
                            : 0;

                        const g2 = g.clone();
                        g2.x = b.x - mg.x;
                        g2.y = b.y - (mg.y + headerH);
                        model.setGeometry(cell, g2);
                    }
                }

                model.add(targetModule, cell);
            });

            const touched = new Set();
            topLevel.forEach(c => {
                const p = model.getParent(c);
                if (p && isModule(p)) touched.add(p.id);
            });

            touched.forEach(id => applyModuleMargins(model.getCell(id)));
        }


        // After cells are added, defer reparenting to AFTER paste move     
        graph.addListener(mxEvent.CELLS_ADDED, function (sender, evt) {
            const cells = evt.getProperty("cells") || [];
            if (!cells.length) return;

            // Defer to next tick so paste offset/move is already applied             
            setTimeout(function () {
                sanitizeModuleParents(cells);
                model.beginUpdate();
                try {
                    reparentCellsIntoModules(cells);
                    enforceModuleExternalMarginsFor(cells, { manageUpdate: false }); // NEW
                } finally {
                    model.endUpdate();
                }
            }, 0);
        });


        // Center-based containment: cell is "inside" if its center is inside module rect   
        function rectInsideModule(rect, modCell) {
            const mg = graph.getCellGeometry(modCell);
            if (!mg) return false;

            const cx = rect.x + rect.w / 2;  // center x                                             
            const cy = rect.y + rect.h / 2;  // center y                                             

            return (
                cx >= mg.x &&
                cx <= mg.x + mg.width &&
                cy >= mg.y &&
                cy <= mg.y + mg.height
            );
        }



        graph.addListener(mxEvent.CELLS_MOVED, function (sender, evt) {
            const cells = evt.getProperty("cells") || [];
            if (!cells.length) return;
            sanitizeModuleParents(cells);

            const seenModules = new Set();
            const toRoot = [];

            // Determine which children have left their module                          
            cells.forEach(c => {
                const p = model.getParent(c);
                if (!p) return;

                if (isModule(p)) {
                    const b = getAbsBounds(c);
                    if (!b) return;

                    // If no longer inside module content, mark for reparenting         
                    if (!rectInsideModule(b, p)) {
                        if (isGardenDashboardCell(c)) seenModules.add(p.id);
                        else toRoot.push({ cell: c, oldModule: p });
                    } else {
                        seenModules.add(p.id);
                    }
                } else if (isModule(model.getParent(p))) {                              // optional: grandchild case
                    // If you only want direct children handled, you can remove this     
                    const mp = model.getParent(p);
                    if (mp && isModule(mp)) seenModules.add(mp.id);
                }
            });

            const root = graph.getDefaultParent();
            if (toRoot.length) {
                model.beginUpdate();
                try {
                    const rootGeo = model.getGeometry(root);
                    const rootX = (rootGeo && !rootGeo.relative) ? (rootGeo.x || 0) : 0;
                    const rootY = (rootGeo && !rootGeo.relative) ? (rootGeo.y || 0) : 0;

                    toRoot.forEach(({ cell, oldModule }) => {
                        const b = getAbsBounds(cell);
                        if (!b) return;

                        const g = cell.getGeometry();
                        if (!g) return;

                        const g2 = g.clone();
                        // Place at same page coordinates, now relative to root         
                        g2.x = b.x - rootX;
                        g2.y = b.y - rootY;
                        model.setGeometry(cell, g2);

                        // Reparent into root (or whatever parent you prefer)           
                        model.add(root, cell);

                        seenModules.add(oldModule.id);
                    });
                } finally {
                    model.endUpdate();
                }
            }

            // Shrink/expand modules after any reparenting                              
            seenModules.forEach(id => {
                const mod = model.getCell(id);
                if (mod) applyModuleMargins(mod, { allowShrink: true });
            });
            enforceModuleExternalMarginsFor(cells, { vector: { x: Number(evt.getProperty("dx")) || 0, y: Number(evt.getProperty("dy")) || 0 } }); // NEW
        });


        graph.addListener(mxEvent.CELLS_RESIZED, function (sender, evt) {
            const cells = evt.getProperty("cells") || [];
            const bounds = evt.getProperty("bounds") || []; // NEW
            const previous = evt.getProperty("previous") || []; // NEW
            const seenModules = new Set();
            cells.forEach(c => {
                if (isGardenModule(c)) enforceGardenModuleMinimum(c);
                if (isModule(c)) seenModules.add(c.id);                // module resized by user
                const p = model.getParent(c);
                if (p && isModule(p)) seenModules.add(p.id);           // child resized
            });
            // Do NOT shrink for module resize or child resize                                      
            seenModules.forEach(id => applyModuleMargins(model.getCell(id), { allowShrink: false }));
            cells.forEach(function (cell, index) {
                if (!isModule(cell)) return;
                const next = bounds[index] || model.getGeometry(cell);
                const prev = previous[index];
                if (!next || !prev) return;
                if (next.x < prev.x - EPS) enforceModuleExternalMarginsFor([cell], { vector: { x: next.x - prev.x, y: 0 } }); // NEW
                if (next.y < prev.y - EPS) enforceModuleExternalMarginsFor([cell], { vector: { x: 0, y: next.y - prev.y } }); // NEW
                const rightDelta = (next.x + next.width) - (prev.x + prev.width);
                const bottomDelta = (next.y + next.height) - (prev.y + prev.height);
                if (rightDelta > EPS) enforceModuleExternalMarginsFor([cell], { vector: { x: rightDelta, y: 0 } }); // NEW
                if (bottomDelta > EPS) enforceModuleExternalMarginsFor([cell], { vector: { x: 0, y: bottomDelta } }); // NEW
            });
        });

    }

    // ------------------------
    // MODULE CREATION
    // ------------------------

    function createModuleCell(graph, x, y, parentOverride) {
        const parent = parentOverride || graph.getDefaultParent();
        const w = 160, h = 100;

        const moduleCell = new mxCell("",
            new mxGeometry(x, y, w, h),
            "swimlane;whiteSpace=wrap;html=1;swimlaneFillColor=default;module=1");
        moduleCell.vertex = true;
        model.add(parent, moduleCell);

        return moduleCell;
    }

    function createSiblingModuleCell(sourceCell, x, y) {
        const parent = (sourceCell && model.getParent(sourceCell)) || graph.getDefaultParent();
        return createModuleCell(graph, x, y, parent);
    }

    function companionTeamLabel(gardenCell) {
        return plainCellLabel(gardenCell, "Garden") + " Team";
    }

    function companionTaskLabel(gardenCell) {
        return plainCellLabel(gardenCell, "Garden") + " Tasks";
    }

    function validCompanionTeam(gardenCell, teamCell) {
        return !!(gardenCell && teamCell && isTeamModule(teamCell) && getValueAttr(teamCell, ATTR_TEAM_GARDEN_MODULE) === cellId(gardenCell));
    }

    function validCompanionTask(gardenCell, taskCell) {
        return !!(gardenCell && taskCell && isTaskModule(taskCell) && getValueAttr(taskCell, ATTR_TASK_GARDEN_MODULE) === cellId(gardenCell));
    }

    function findExistingCompanionTeam(gardenCell) {
        const expectedGardenId = cellId(gardenCell);
        if (!expectedGardenId) return null;
        const typedId = getValueAttr(gardenCell, ATTR_GARDEN_TEAM_MODULE);
        const typed = typedId && model.getCell ? model.getCell(typedId) : null;
        if (validCompanionTeam(gardenCell, typed)) return typed;
        const root = model.getRoot && model.getRoot();
        const cells = model.cells ? Object.values(model.cells) : [];
        const pool = cells.length ? cells : (model.getChildren(root) || []);
        return pool.find(function (cell) { return validCompanionTeam(gardenCell, cell); }) || null;
    }

    function findExistingCompanionTask(gardenCell) {
        const expectedGardenId = cellId(gardenCell);
        if (!expectedGardenId) return null;
        const typedId = getValueAttr(gardenCell, ATTR_GARDEN_TASK_MODULE);
        const typed = typedId && model.getCell ? model.getCell(typedId) : null;
        if (validCompanionTask(gardenCell, typed)) return typed;
        const root = model.getRoot && model.getRoot();
        const cells = model.cells ? Object.values(model.cells) : [];
        const pool = cells.length ? cells : (model.getChildren(root) || []);
        return pool.find(function (cell) { return validCompanionTask(gardenCell, cell); }) || null;
    }

    function companionTeamPoint(gardenCell) {
        const g = graph.getCellGeometry(gardenCell) || { x: 0, y: 0, width: 160 };
        const gap = getModuleExternalMarginValue(gardenCell, COMPANION_TEAM_GAP); // CHANGE
        return { x: (Number(g.x) || 0) + (Number(g.width) || 160) + gap, y: Number(g.y) || 0 }; // CHANGE
    }

    function companionTaskPoint(gardenCell, teamCell) {
        const gardenGeo = graph.getCellGeometry(gardenCell) || { x: 0, y: 0, width: 160, height: 100 };
        const teamGeo = teamCell ? graph.getCellGeometry(teamCell) : null;
        const gap = teamCell ? modulePairExternalMargin(gardenCell, teamCell) : getModuleExternalMarginValue(gardenCell, COMPANION_TEAM_GAP); // CHANGE
        const x = teamGeo ? Number(teamGeo.x) || 0 : (Number(gardenGeo.x) || 0) + (Number(gardenGeo.width) || 160) + gap; // CHANGE
        const y = teamGeo ? (Number(teamGeo.y) || 0) + (Number(teamGeo.height) || 100) + gap : (Number(gardenGeo.y) || 0) + (Number(gardenGeo.height) || 100) + gap; // CHANGE
        return { x, y };
    }

    function syncCompanionModuleAccess(gardenCell, companionCell) {
        if (!gardenCell || !companionCell) return false;
        let changed = false;
        const owner = getValueAttr(gardenCell, ATTR_OWNER);
        if (owner !== getValueAttr(companionCell, ATTR_OWNER)) { setStringValueAttr(companionCell, ATTR_OWNER, owner); changed = true; }
        const grants = getValueAttr(gardenCell, ATTR_ACCESS_GRANTS);
        if (grants !== getValueAttr(companionCell, ATTR_ACCESS_GRANTS)) { setStringValueAttr(companionCell, ATTR_ACCESS_GRANTS, grants); changed = true; }
        return changed;
    }

    function ensureGardenTeamModule(gardenCell, opts) {
        if (!isGardenModule(gardenCell)) return null;
        const o = opts || {};
        let team = findExistingCompanionTeam(gardenCell);
        const manageUpdate = !o.insideUpdate;
        if (manageUpdate) model.beginUpdate();
        try {
            if (!team) {
                const pt = companionTeamPoint(gardenCell);
                team = createSiblingModuleCell(gardenCell, pt.x, pt.y);
                setModuleType(team, "team");
                setCellLabel(team, companionTeamLabel(gardenCell));
            }
            syncCompanionModuleAccess(gardenCell, team);
            setStringValueAttr(gardenCell, ATTR_GARDEN_TEAM_MODULE, cellId(team));
            setStringValueAttr(team, ATTR_TEAM_GARDEN_MODULE, cellId(gardenCell));
            addReciprocalLink(gardenCell, team);
            applyModuleMargins(team, { allowShrink: false, manageUpdate: false });
            enforceModuleExternalMarginsFor([gardenCell, team], { manageUpdate: false }); // NEW
        } finally {
            if (manageUpdate) model.endUpdate();
        }
        try { graph.fireEvent(new mxEventObject("linksChanged", "cells", [gardenCell, team])); } catch (_) { }
        return team;
    }

    function ensureGardenTaskModule(gardenCell, opts) {
        if (!isGardenModule(gardenCell)) return null;
        const o = opts || {};
        let task = findExistingCompanionTask(gardenCell);
        const manageUpdate = !o.insideUpdate;
        if (manageUpdate) model.beginUpdate();
        try {
            const team = ensureGardenTeamModule(gardenCell, { insideUpdate: true });
            if (!task) {
                const pt = companionTaskPoint(gardenCell, team);
                task = createSiblingModuleCell(gardenCell, pt.x, pt.y);
                setModuleType(task, "task");
                setCellLabel(task, companionTaskLabel(gardenCell));
            }
            syncCompanionModuleAccess(gardenCell, task);
            setStringValueAttr(gardenCell, ATTR_GARDEN_TASK_MODULE, cellId(task));
            setStringValueAttr(task, ATTR_TASK_GARDEN_MODULE, cellId(gardenCell));
            addReciprocalLink(gardenCell, task);
            applyModuleMargins(task, { allowShrink: false, manageUpdate: false });
            enforceModuleExternalMarginsFor([gardenCell, team, task], { manageUpdate: false }); // NEW
        } finally {
            if (manageUpdate) model.endUpdate();
        }
        try { graph.fireEvent(new mxEventObject("linksChanged", "cells", [gardenCell, task])); } catch (_) { }
        try { graph.fireEvent(new mxEventObject("usl:taskModuleReady", "gardenCell", gardenCell, "taskModule", task, "createMainBoard", !!o.createMainBoard)); } catch (_) { }
        const taskApi = graph.__trellisTaskManager;
        if (o.createMainBoard && taskApi && typeof taskApi.ensureMainBoardInTaskModule === "function") taskApi.ensureMainBoardInTaskModule(task);
        return task;
    }

    function normalizeRootModuleType(type) {
        return type === "garden" || type === "team" || type === "task" ? type : "regular";
    }

    function createModuleAtPoint(point, type) {
        const moduleType = normalizeRootModuleType(type);
        const x = Number(point && point.x) || 0;
        const y = Number(point && point.y) || 0;
        let mod = null;
        model.beginUpdate();
        try {
            mod = createModuleCell(graph, x, y);
            applyModuleMargins(mod);
            if (moduleType !== "regular") setModuleType(mod, moduleType);
            if (window.Trellis && window.Trellis.users && typeof window.Trellis.users.stampCreatedOwner === "function") window.Trellis.users.stampCreatedOwner(mod); // NEW: modules created by logged-in users become ownership boundaries
            if (moduleType === "garden") { ensureGardenTeamModule(mod, { insideUpdate: true }); ensureGardenTaskModule(mod, { insideUpdate: true, createMainBoard: true }); }
            enforceModuleExternalMarginsFor([mod], { manageUpdate: false }); // NEW
            if (mod && graph.setSelectionCell) graph.setSelectionCell(mod);
        } finally {
            model.endUpdate();
        }
        return mod;
    }

    function installRootModuleCreationOverlay() {
        if (graph.__trellisRootModuleCreationOverlayInstalled) return;
        graph.__trellisRootModuleCreationOverlayInstalled = true;

        const OFFSET_PX = 8;
        const SIMPLE_CLICK_MAX_MOVE_PX = 4;
        let overlay = null;
        let pendingClick = null;
        let overlayShownAt = 0;
        let dismissOnlyClick = false;

        function overlayHost() {
            return graph.container || null;
        }

        function ensureOverlayHost() {
            const host = overlayHost();
            if (!host) return null;
            const style = window.getComputedStyle ? window.getComputedStyle(host) : null;
            if (style && style.position === "static") host.style.position = "relative";
            return host;
        }

        function eventSource(evt) {
            return mxEvent.getSource ? mxEvent.getSource(evt) : evt && (evt.target || evt.srcElement);
        }

        function eventInOverlay(evt) {
            return !!overlay && !!evt && overlay.contains(eventSource(evt));
        }

        function isPlainLeftMouseEvent(evt) {
            if (!evt) return false;
            const button = typeof evt.button === "number" ? evt.button : 0;
            const popup = mxEvent.isPopupTrigger && mxEvent.isPopupTrigger(evt);
            return button === 0 && !popup && !mxEvent.isControlDown(evt) && !mxEvent.isMetaDown(evt) && !mxEvent.isShiftDown(evt) && !evt.altKey;
        }

        function isDoubleClick(evt) {
            return !!evt && Number(evt.detail || 0) > 1;
        }

        function eventClientPoint(evt) {
            return { x: mxEvent.getClientX(evt), y: mxEvent.getClientY(evt) };
        }

        function containerPointForEvent(evt) {
            const host = overlayHost();
            const rect = host && host.getBoundingClientRect ? host.getBoundingClientRect() : { left: 0, top: 0 };
            const client = eventClientPoint(evt);
            return {
                x: client.x - (rect.left || 0) + (host ? host.scrollLeft || 0 : 0),
                y: client.y - (rect.top || 0) + (host ? host.scrollTop || 0 : 0)
            };
        }

        function modelPointForEvent(evt) {
            if (graph.getPointForEvent) return graph.getPointForEvent(evt, false);
            return containerPointForEvent(evt);
        }

        function hitPointForMouseEvent(me, evt) {
            if (me && typeof me.getGraphX === "function" && typeof me.getGraphY === "function") {
                return { x: me.getGraphX(), y: me.getGraphY() };
            }
            return containerPointForEvent(evt);
        }

        function cellForMouseEvent(me, evt) {
            const direct = me && typeof me.getCell === "function" ? me.getCell() : null;
            if (direct) return direct;
            const pt = hitPointForMouseEvent(me, evt);
            return graph.getCellAt ? graph.getCellAt(pt.x, pt.y) : null;
        }

        function isSimpleClick(start, evt) {
            if (!start || !evt) return false;
            const client = eventClientPoint(evt);
            const dx = client.x - start.client.x;
            const dy = client.y - start.client.y;
            return Math.sqrt(dx * dx + dy * dy) <= SIMPLE_CLICK_MAX_MOVE_PX;
        }

        function hideOverlay() {
            if (overlay) overlay.style.display = "none";
        }

        function isOverlayVisible() {
            return !!overlay && overlay.style.display !== "none";
        }

        function makeOverlayButton(label, type) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.textContent = label;
            btn.style.border = "1px solid #b8b8b8";
            btn.style.borderRadius = "4px";
            btn.style.background = "#fff";
            btn.style.color = "#222";
            btn.style.cursor = "pointer";
            btn.style.font = "12px Arial, sans-serif";
            btn.style.padding = "5px 8px";
            btn.style.textAlign = "left";
            btn.style.whiteSpace = "nowrap";
            applyTrellisButtonStyle(btn, "add", { compact: true });
            mxEvent.addListener(btn, "click", function (evt) {
                mxEvent.consume(evt);
                const point = overlay && overlay.__trellisModulePoint;
                if (point) createModuleAtPoint(point, type);
                hideOverlay();
            });
            return btn;
        }

        function ensureOverlay() {
            if (overlay) return overlay;
            overlay = document.createElement("div");
            overlay.className = "trellis-root-module-overlay";
            overlay.style.position = "absolute";
            overlay.style.zIndex = String(GRAPH_OVERLAY_Z.CONTROL);
            overlay.style.display = "none";
            overlay.style.flexDirection = "column";
            overlay.style.gap = "4px";
            overlay.style.padding = "4px";
            overlay.style.background = "rgba(255,255,255,0.96)";
            overlay.style.border = "1px solid #c7c7cc";
            overlay.style.borderRadius = "6px";
            overlay.style.boxShadow = "0 2px 8px rgba(0,0,0,0.16)";
            overlay.style.font = "12px Arial, sans-serif";
            overlay.style.pointerEvents = "auto";
            mxEvent.addListener(overlay, "mousedown", function (evt) { mxEvent.consume(evt); });
            mxEvent.addListener(overlay, "click", function (evt) { mxEvent.consume(evt); });
            overlay.appendChild(makeOverlayButton("Add Module", "regular"));
            overlay.appendChild(makeOverlayButton("Add Garden Module", "garden"));
            overlay.appendChild(makeOverlayButton("Add Team Module", "team"));
            overlay.appendChild(makeOverlayButton("Add Task Module", "task"));
            const host = ensureOverlayHost();
            if (host) host.appendChild(overlay);
            return overlay;
        }

        function positionOverlay(containerPoint) {
            const host = ensureOverlayHost();
            const div = ensureOverlay();
            if (!host || !div) return;
            if (div.parentNode !== host) host.appendChild(div);
            div.style.display = "flex";
            div.style.left = "0px";
            div.style.top = "0px";
            const width = div.offsetWidth || 150;
            const height = div.offsetHeight || 92;
            const scrollLeft = host.scrollLeft || 0;
            const scrollTop = host.scrollTop || 0;
            const maxLeft = scrollLeft + Math.max(0, (host.clientWidth || width) - width - OFFSET_PX);
            const maxTop = scrollTop + Math.max(0, (host.clientHeight || height) - height - OFFSET_PX);
            const left = Math.max(scrollLeft, Math.min(maxLeft, Math.round(containerPoint.x + OFFSET_PX)));
            const top = Math.max(scrollTop, Math.min(maxTop, Math.round(containerPoint.y + OFFSET_PX)));
            div.style.left = left + "px";
            div.style.top = top + "px";
        }

        function showOverlay(anchor) {
            const div = ensureOverlay();
            if (!div) return;
            div.__trellisModulePoint = { x: anchor.model.x, y: anchor.model.y };
            overlayShownAt = Date.now();
            positionOverlay(anchor.container);
        }

        function onDismissEvent() {
            if (overlayShownAt && Date.now() - overlayShownAt < 80) return;
            pendingClick = null;
            hideOverlay();
        }

        if (graph.addMouseListener) {
            graph.addMouseListener({
                mouseDown: function (_sender, me) {
                    const evt = me && me.getEvent ? me.getEvent() : null;
                    if (eventInOverlay(evt)) return;
                    if (isOverlayVisible()) {
                        dismissOnlyClick = true;
                        pendingClick = null;
                        hideOverlay();
                        return;
                    }
                    dismissOnlyClick = false;
                    hideOverlay();
                    pendingClick = null;
                    if (!isPlainLeftMouseEvent(evt) || isDoubleClick(evt)) return;
                    pendingClick = {
                        client: eventClientPoint(evt),
                        model: modelPointForEvent(evt),
                        container: containerPointForEvent(evt)
                    };
                },
                mouseMove: function () { },
                mouseUp: function (_sender, me) {
                    const evt = me && me.getEvent ? me.getEvent() : null;
                    if (dismissOnlyClick) {
                        dismissOnlyClick = false;
                        pendingClick = null;
                        return;
                    }
                    const start = pendingClick;
                    pendingClick = null;
                    if (eventInOverlay(evt)) return;
                    if (!isPlainLeftMouseEvent(evt) || isDoubleClick(evt) || !isSimpleClick(start, evt)) return;
                    if (cellForMouseEvent(me, evt)) return;
                    showOverlay(start);
                }
            });
        }

        const selectionModel = graph.getSelectionModel ? graph.getSelectionModel() : null;
        if (selectionModel && selectionModel.addListener) selectionModel.addListener(mxEvent.CHANGE, onDismissEvent);
        if (model.addListener) model.addListener(mxEvent.CHANGE, onDismissEvent);
        if (graph.getView && graph.getView()) {
            const view = graph.getView();
            if (view.addListener) {
                view.addListener(mxEvent.SCALE, onDismissEvent);
                view.addListener(mxEvent.TRANSLATE, onDismissEvent);
                view.addListener(mxEvent.SCALE_AND_TRANSLATE, onDismissEvent);
            }
        }
        mxEvent.addListener(document, "keydown", function (evt) { if (evt && evt.key === "Escape") hideOverlay(); });
        graph.addListener && graph.addListener(mxEvent.DESTROY, function () { if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay); overlay = null; });
    }

    //  Role cards, menus, layouts etc… remain as you have them.
    function installSelectedTeamModuleRoleOverlay() {
        if (graph.__trellisSelectedTeamModuleRoleOverlayInstalled) return;
        graph.__trellisSelectedTeamModuleRoleOverlayInstalled = true;

        const OFFSET_PX = 8;
        const SIMPLE_CLICK_MAX_MOVE_PX = 4;
        let overlay = null;
        let pendingClick = null;
        let lastClickAnchor = null;
        let currentTeamModule = null;
        let dismissOnlyClick = false;
        let recentlyDismissedCell = null;
        let recentlyDismissedAt = 0;
        let labelControls = null;

        function overlayHost() {
            return graph.container || null;
        }

        function ensureOverlayHost() {
            const host = overlayHost();
            if (!host) return null;
            const style = window.getComputedStyle ? window.getComputedStyle(host) : null;
            if (style && style.position === "static") host.style.position = "relative";
            return host;
        }

        function eventSource(evt) {
            return mxEvent.getSource ? mxEvent.getSource(evt) : evt && (evt.target || evt.srcElement);
        }

        function eventInOverlay(evt) {
            return !!overlay && !!evt && overlay.contains(eventSource(evt));
        }

        function isPlainLeftMouseEvent(evt) {
            if (!evt) return false;
            const button = typeof evt.button === "number" ? evt.button : 0;
            const popup = mxEvent.isPopupTrigger && mxEvent.isPopupTrigger(evt);
            return button === 0 && !popup && !mxEvent.isControlDown(evt) && !mxEvent.isMetaDown(evt) && !mxEvent.isShiftDown(evt) && !evt.altKey;
        }

        function isDoubleClick(evt) {
            return !!evt && Number(evt.detail || 0) > 1;
        }

        function eventClientPoint(evt) {
            return { x: mxEvent.getClientX(evt), y: mxEvent.getClientY(evt) };
        }

        function containerPointForEvent(evt) {
            const host = overlayHost();
            const rect = host && host.getBoundingClientRect ? host.getBoundingClientRect() : { left: 0, top: 0 };
            const client = eventClientPoint(evt);
            return {
                x: client.x - (rect.left || 0) + (host ? host.scrollLeft || 0 : 0),
                y: client.y - (rect.top || 0) + (host ? host.scrollTop || 0 : 0)
            };
        }

        function modelPointForEvent(evt) {
            if (graph.getPointForEvent) return graph.getPointForEvent(evt, false);
            return containerPointForEvent(evt);
        }

        function hitPointForMouseEvent(me, evt) {
            if (me && typeof me.getGraphX === "function" && typeof me.getGraphY === "function") {
                return { x: me.getGraphX(), y: me.getGraphY() };
            }
            return containerPointForEvent(evt);
        }

        function cellForMouseEvent(me, evt) {
            const direct = me && typeof me.getCell === "function" ? me.getCell() : null;
            if (direct) return direct;
            const pt = hitPointForMouseEvent(me, evt);
            return graph.getCellAt ? graph.getCellAt(pt.x, pt.y) : null;
        }

        function isSimpleClick(start, evt) {
            if (!start || !evt) return false;
            const client = eventClientPoint(evt);
            const dx = client.x - start.client.x;
            const dy = client.y - start.client.y;
            return Math.sqrt(dx * dx + dy * dy) <= SIMPLE_CLICK_MAX_MOVE_PX;
        }

        function selectedTeamModule() {
            const cells = graph.getSelectionCells ? graph.getSelectionCells() : (graph.getSelectionCell ? [graph.getSelectionCell()] : []);
            return cells && cells.length === 1 && isModule(cells[0]) && isTeamModule(cells[0]) ? cells[0] : null;
        }

        function hideOverlay() {
            if (overlay) overlay.style.display = "none";
            currentTeamModule = null;
        }

        function isOverlayVisible() {
            return !!overlay && overlay.style.display !== "none";
        }

        function moduleContainsPoint(moduleCell, point) {
            const geo = graph.getCellGeometry(moduleCell);
            return !!geo && !!point && point.x >= geo.x && point.x <= geo.x + geo.width && point.y >= geo.y && point.y <= geo.y + geo.height;
        }

        function fallbackRoleCardPoint(moduleCell) {
            const geo = graph.getCellGeometry(moduleCell);
            const margin = getIntStyle(moduleCell, "module_margin", 100);
            const headerH = getModuleHeaderHeight(moduleCell);
            return { x: (geo ? geo.x : 0) + margin, y: (geo ? geo.y : 0) + headerH + margin };
        }

        function roleCardPoint(moduleCell) {
            return moduleContainsPoint(moduleCell, lastClickAnchor && lastClickAnchor.model) ? lastClickAnchor.model : fallbackRoleCardPoint(moduleCell);
        }

        function cellContainerPoint(cell) {
            const view = graph.getView ? graph.getView() : graph.view;
            const state = view && typeof view.getState === "function" ? view.getState(cell) : null;
            if (state) return { x: state.x, y: state.y };
            const geo = graph.getCellGeometry(cell);
            const scale = view && view.scale ? view.scale : 1;
            const translate = view && view.translate ? view.translate : { x: 0, y: 0 };
            return { x: geo ? (geo.x + (translate.x || 0)) * scale : 0, y: geo ? (geo.y + (translate.y || 0)) * scale : 0 };
        }

        function moduleOverlayAnchor(cell) {
            return { model: fallbackRoleCardPoint(cell), container: cellContainerPoint(cell) };
        }

        function overlayAnchorForCell(cell) {
            if (pendingClick && moduleContainsPoint(cell, pendingClick.model)) return pendingClick;
            if (lastClickAnchor && moduleContainsPoint(cell, lastClickAnchor.model)) return lastClickAnchor;
            return moduleOverlayAnchor(cell);
        }

        function positionOverlay(anchor) {
            const host = ensureOverlayHost();
            const div = ensureOverlay();
            if (!host || !div || !anchor || !anchor.container) return;
            if (div.parentNode !== host) host.appendChild(div);
            div.style.display = "flex";
            div.style.left = "0px";
            div.style.top = "0px";
            const point = anchor.container;
            const left = Math.round(point.x + OFFSET_PX); // CHANGE: selected team module overlays intentionally do not clamp to the viewport
            const top = Math.round(point.y + OFFSET_PX); // CHANGE: selected team module overlays intentionally do not clamp to the viewport
            div.style.left = left + "px";
            div.style.top = top + "px";
        }

        function addRoleCardFromOverlay(evt) {
            mxEvent.consume(evt);
            const moduleCell = currentTeamModule || selectedTeamModule();
            if (!moduleCell) { hideOverlay(); return; }
            const point = roleCardPoint(moduleCell);
            addRoleCardToTeamModule(moduleCell, point.x, point.y);
            hideOverlay();
        }

        function promptModuleMarginFromOverlay(evt) {
            mxEvent.consume(evt);
            const moduleCell = currentTeamModule || selectedTeamModule();
            if (!moduleCell) { hideOverlay(); return; }
            hideOverlay();
            promptSetModuleMargin(moduleCell);
        }

        function promptModuleExternalMarginFromOverlay(evt) {
            mxEvent.consume(evt);
            const moduleCell = currentTeamModule || selectedTeamModule();
            if (!moduleCell) { hideOverlay(); return; }
            hideOverlay();
            promptSetModuleExternalMargin(moduleCell); // NEW
        }

        function makeOverlayButton(label, onClick, variant) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.textContent = label;
            btn.style.border = "1px solid #b8b8b8";
            btn.style.borderRadius = "4px";
            btn.style.background = "#fff";
            btn.style.color = "#222";
            btn.style.cursor = "pointer";
            btn.style.font = "12px Arial, sans-serif";
            btn.style.padding = "5px 8px";
            btn.style.whiteSpace = "nowrap";
            applyTrellisButtonStyle(btn, variant || "neutral", { compact: true });
            mxEvent.addListener(btn, "click", onClick);
            return btn;
        }

        function makeModuleLabelInput(moduleCell, ariaLabel) {
            const initialLabel = getModuleLabel(moduleCell);
            const input = document.createElement("input");
            input.type = "text";
            input.value = initialLabel;
            input.setAttribute("aria-label", ariaLabel);
            input.style.display = "block";
            input.style.boxSizing = "border-box";
            input.style.width = "100%";
            input.style.minWidth = "0";
            input.style.marginBottom = "2px";
            input.style.border = "1px solid rgba(75, 85, 99, 0.35)";
            input.style.borderRadius = "4px";
            input.style.padding = "3px 5px";
            input.style.font = "12px Arial, sans-serif";
            input.style.fontWeight = "600";
            ["mousedown", "mouseup", "click", "dblclick", "pointerdown", "pointerup"].forEach(function (type) {
                input.addEventListener(type, stopModuleOverlayDomEvent);
            });
            input.addEventListener("keydown", function (evt) {
                stopModuleOverlayDomEvent(evt);
                if (evt.key === "Enter") {
                    input.value = writeModuleLabel(moduleCell, input.value);
                    if (input.blur) input.blur();
                    stopAndPreventModuleOverlayDomEvent(evt);
                } else if (evt.key === "Escape") {
                    input.value = initialLabel;
                    stopAndPreventModuleOverlayDomEvent(evt);
                }
            });
            ["keypress", "keyup"].forEach(function (type) { input.addEventListener(type, stopModuleOverlayDomEvent); });
            input.addEventListener("blur", function () { input.value = writeModuleLabel(moduleCell, input.value); });
            return input;
        }

        function renderTeamModuleLabelControls(moduleCell) {
            if (!labelControls) return;
            labelControls.innerHTML = "";
            labelControls.appendChild(makeModuleLabelInput(moduleCell, "Team label"));
        }

        function ensureOverlay() {
            if (overlay) return overlay;
            overlay = document.createElement("div");
            overlay.className = "trellis-team-role-overlay";
            overlay.style.position = "absolute";
            overlay.style.zIndex = String(GRAPH_OVERLAY_Z.CONTROL);
            overlay.style.display = "none";
            overlay.style.flexDirection = "column";
            overlay.style.gap = "4px";
            overlay.style.padding = "4px";
            overlay.style.background = "rgba(255,255,255,0.96)";
            overlay.style.border = "1px solid #c7c7cc";
            overlay.style.borderRadius = "6px";
            overlay.style.boxShadow = "0 2px 8px rgba(0,0,0,0.16)";
            overlay.style.font = "12px Arial, sans-serif";
            overlay.style.pointerEvents = "auto";
            mxEvent.addListener(overlay, "mousedown", function (evt) { mxEvent.consume(evt); });
            mxEvent.addListener(overlay, "click", function (evt) { mxEvent.consume(evt); });
            labelControls = document.createElement("div");
            labelControls.className = "trellis-team-module-label-controls";
            labelControls.style.display = "flex";
            labelControls.style.flexDirection = "column";
            labelControls.style.gap = "4px";
            labelControls.style.padding = "2px 2px 4px";
            labelControls.style.borderBottom = "1px solid #e5e7eb";
            overlay.appendChild(labelControls);
            overlay.appendChild(makeOverlayButton("Add Role Card", addRoleCardFromOverlay, "add"));
            overlay.appendChild(makeOverlayButton("Internal Margin", promptModuleMarginFromOverlay, "open")); // CHANGE
            overlay.appendChild(makeOverlayButton("External Margin", promptModuleExternalMarginFromOverlay, "open")); // NEW
            const host = ensureOverlayHost();
            if (host) host.appendChild(overlay);
            return overlay;
        }

        function showOverlay(cell, anchor) {
            currentTeamModule = cell;
            ensureOverlay();
            renderTeamModuleLabelControls(cell);
            positionOverlay(anchor || moduleOverlayAnchor(cell));
        }

        function refreshSelectedOverlay() {
            const cell = selectedTeamModule();
            hideOverlay();
            if (!cell) return;
            if (recentlyDismissedCell === cell && Date.now() - recentlyDismissedAt < 250) return;
            showOverlay(cell, overlayAnchorForCell(cell));
        }

        function onDismissEvent() {
            pendingClick = null;
            hideOverlay();
        }

        if (graph.addMouseListener) {
            graph.addMouseListener({
                mouseDown: function (_sender, me) {
                    const evt = me && me.getEvent ? me.getEvent() : null;
                    if (eventInOverlay(evt)) return;
                    const hitCell = cellForMouseEvent(me, evt);
                    if (isOverlayVisible()) {
                        dismissOnlyClick = true;
                        pendingClick = null;
                        recentlyDismissedCell = hitCell === currentTeamModule ? currentTeamModule : null;
                        recentlyDismissedAt = recentlyDismissedCell ? Date.now() : 0;
                        hideOverlay();
                        return;
                    }
                    dismissOnlyClick = false;
                    pendingClick = null;
                    if (!isPlainLeftMouseEvent(evt) || isDoubleClick(evt)) return;
                    pendingClick = {
                        client: eventClientPoint(evt),
                        model: modelPointForEvent(evt),
                        container: containerPointForEvent(evt)
                    };
                },
                mouseMove: function () { },
                mouseUp: function (_sender, me) {
                    const evt = me && me.getEvent ? me.getEvent() : null;
                    if (dismissOnlyClick) {
                        dismissOnlyClick = false;
                        pendingClick = null;
                        return;
                    }
                    const start = pendingClick;
                    pendingClick = null;
                    if (eventInOverlay(evt)) return;
                    if (!isPlainLeftMouseEvent(evt) || isDoubleClick(evt) || !isSimpleClick(start, evt)) return;
                    lastClickAnchor = { model: { x: start.model.x, y: start.model.y }, container: { x: start.container.x, y: start.container.y } };
                    refreshSelectedOverlay();
                }
            });
        }

        const selectionModel = graph.getSelectionModel ? graph.getSelectionModel() : null;
        if (selectionModel && selectionModel.addListener) selectionModel.addListener(mxEvent.CHANGE, refreshSelectedOverlay);
        if (model.addListener) model.addListener(mxEvent.CHANGE, onDismissEvent);
        if (graph.getView && graph.getView()) {
            const view = graph.getView();
            if (view.addListener) {
                view.addListener(mxEvent.SCALE, onDismissEvent);
                view.addListener(mxEvent.TRANSLATE, onDismissEvent);
                view.addListener(mxEvent.SCALE_AND_TRANSLATE, onDismissEvent);
            }
        }
        mxEvent.addListener(document, "keydown", function (evt) { if (evt && evt.key === "Escape") hideOverlay(); });
        graph.addListener && graph.addListener(mxEvent.DESTROY, function () { if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay); overlay = null; currentTeamModule = null; });
    }

    function installSelectedRoleImageOverlay() {
        if (graph.__trellisSelectedRoleImageOverlayInstalled) return;
        graph.__trellisSelectedRoleImageOverlayInstalled = true;

        const OFFSET_PX = 8;
        let overlay = null;
        let button = null;
        let currentAction = null;

        function overlayHost() {
            return graph.container || null;
        }

        function ensureOverlayHost() {
            const host = overlayHost();
            if (!host) return null;
            const style = window.getComputedStyle ? window.getComputedStyle(host) : null;
            if (style && style.position === "static") host.style.position = "relative";
            return host;
        }

        function selectedRoleImageAction() {
            const cells = graph.getSelectionCells ? (graph.getSelectionCells() || []) : (graph.getSelectionCell ? [graph.getSelectionCell()] : []);
            if (!cells || cells.length !== 1) return null;
            const action = roleImageActionForCell(cells[0], { allowImageRowChange: true });
            if (action && action.roleCard) normalizeRoleImagePlaceholder(action.roleCard);
            return action;
        }

        function anchorCellForAction(action) {
            if (!action) return null;
            if (action.mode === "change") return isRoleImageRow(action.sourceCell) || isRoleAvatar(action.sourceCell) ? action.sourceCell : action.avatar;
            return action.imageRow || action.roleCard;
        }

        function hideOverlay() {
            currentAction = null;
            if (overlay) overlay.style.display = "none";
        }

        function invokeRoleImageAction(evt) {
            mxEvent.consume(evt);
            const action = currentAction;
            if (!action || !action.roleCard) { hideOverlay(); return; }
            hideOverlay();
            selectRoleImage(ui, graph, action.roleCard);
        }

        function makeOverlayButton() {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.style.border = "1px solid #b8b8b8";
            btn.style.borderRadius = "4px";
            btn.style.background = "#fff";
            btn.style.color = "#222";
            btn.style.cursor = "pointer";
            btn.style.font = "12px Arial, sans-serif";
            btn.style.padding = "5px 8px";
            btn.style.whiteSpace = "nowrap";
            applyTrellisButtonStyle(btn, "open", { compact: true });
            mxEvent.addListener(btn, "click", invokeRoleImageAction);
            return btn;
        }

        function ensureOverlay() {
            if (overlay) return overlay;
            overlay = document.createElement("div");
            overlay.className = "trellis-role-image-overlay";
            overlay.style.position = "absolute";
            overlay.style.zIndex = String(GRAPH_OVERLAY_Z.CONTROL);
            overlay.style.display = "none";
            overlay.style.padding = "4px";
            overlay.style.background = "rgba(255,255,255,0.96)";
            overlay.style.border = "1px solid #c7c7cc";
            overlay.style.borderRadius = "6px";
            overlay.style.boxShadow = "0 2px 8px rgba(0,0,0,0.16)";
            overlay.style.font = "12px Arial, sans-serif";
            overlay.style.pointerEvents = "auto";
            mxEvent.addListener(overlay, "mousedown", function (evt) { mxEvent.consume(evt); });
            mxEvent.addListener(overlay, "click", function (evt) { mxEvent.consume(evt); });
            button = makeOverlayButton();
            overlay.appendChild(button);
            const host = ensureOverlayHost();
            if (host) host.appendChild(overlay);
            return overlay;
        }

        function positionOverlay(action) {
            const host = ensureOverlayHost();
            const div = ensureOverlay();
            const anchorCell = anchorCellForAction(action);
            const view = graph.getView ? graph.getView() : graph.view;
            const state = view && typeof view.getState === "function" && anchorCell ? view.getState(anchorCell) : null;
            if (!host || !div || !state) { hideOverlay(); return; }
            if (div.parentNode !== host) host.appendChild(div);
            if (button) button.textContent = action.mode === "change" ? "Change Image" : "Add Image";
            currentAction = action;
            div.style.display = "flex";
            div.style.left = "0px";
            div.style.top = "0px";
            const width = div.offsetWidth || 105;
            const height = div.offsetHeight || 30;
            const scrollLeft = host.scrollLeft || 0;
            const scrollTop = host.scrollTop || 0;
            const maxLeft = scrollLeft + Math.max(0, (host.clientWidth || width) - width - OFFSET_PX);
            const maxTop = scrollTop + Math.max(0, (host.clientHeight || height) - height - OFFSET_PX);
            const left = Math.max(scrollLeft, Math.min(maxLeft, Math.round(state.x + (state.width || 0) + OFFSET_PX)));
            const top = Math.max(scrollTop, Math.min(maxTop, Math.round(state.y)));
            div.style.left = left + "px";
            div.style.top = top + "px";
        }

        function refreshSelectedOverlay() {
            const action = selectedRoleImageAction();
            if (!action) { hideOverlay(); return; }
            positionOverlay(action);
        }

        const selectionModel = graph.getSelectionModel ? graph.getSelectionModel() : null;
        if (selectionModel && selectionModel.addListener) selectionModel.addListener(mxEvent.CHANGE, refreshSelectedOverlay);
        if (model.addListener) model.addListener(mxEvent.CHANGE, refreshSelectedOverlay);
        if (graph.getView && graph.getView()) {
            const view = graph.getView();
            if (view.addListener) {
                view.addListener(mxEvent.SCALE, refreshSelectedOverlay);
                view.addListener(mxEvent.TRANSLATE, refreshSelectedOverlay);
                view.addListener(mxEvent.SCALE_AND_TRANSLATE, refreshSelectedOverlay);
            }
        }
        mxEvent.addListener(document, "keydown", function (evt) { if (evt && evt.key === "Escape") hideOverlay(); });
        graph.addListener && graph.addListener(mxEvent.DESTROY, function () { if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay); overlay = null; button = null; currentAction = null; });
    }

    // Ensure right-click does not alter selection unexpectedly                           
    graph.popupMenuHandler && (graph.popupMenuHandler.selectOnPopup = false);

    graph.__trellisModules = {
        applyModuleMargins: function (moduleCell, opts) {
            return applyModuleMargins(moduleCell, opts);
        },
        enforceGardenModuleMinimum: function (moduleCell) {
            let changed = false;
            model.beginUpdate();
            try {
                changed = enforceGardenModuleMinimum(moduleCell);
            } finally {
                model.endUpdate();
            }
            return changed;
        },
        getGardenModuleMinimumSize: function (moduleCell) {
            return getModuleMinOuterSize(moduleCell);
        },
        getModuleMargin: function (moduleCell, defaultPx) {
            return getModuleMarginValue(moduleCell, defaultPx);
        },
        setModuleMargin: function (moduleCell, marginPx) {
            return setModuleMarginValue(moduleCell, marginPx);
        },
        promptSetModuleMargin: function (moduleCell) {
            return promptSetModuleMargin(moduleCell);
        },
        getModuleExternalMargin: function (moduleCell, defaultPx) {
            return getModuleExternalMarginValue(moduleCell, defaultPx); // NEW
        },
        setModuleExternalMargin: function (moduleCell, marginPx) {
            return setModuleExternalMarginValue(moduleCell, marginPx); // NEW
        },
        promptSetModuleExternalMargin: function (moduleCell) {
            return promptSetModuleExternalMargin(moduleCell); // NEW
        },
        enforceModuleExternalMargins: function (moduleCells) {
            return enforceModuleExternalMarginsFor(moduleCells); // NEW
        },
        createModuleAtPoint: function (point, type) {
            return createModuleAtPoint(point, type);
        },
        createRoleCard: function (moduleCell, x, y) {
            return createRoleCard(graph, moduleCell, x, y);
        },
        ensureGardenTeamModule: function (gardenCell) {
            return ensureGardenTeamModule(gardenCell);
        },
        findExistingCompanionTeam: function (gardenCell) {
            return findExistingCompanionTeam(gardenCell);
        },
        ensureGardenTaskModule: function (gardenCell, opts) {
            return ensureGardenTaskModule(gardenCell, opts);
        },
        findExistingCompanionTask: function (gardenCell) {
            return findExistingCompanionTask(gardenCell);
        },
        syncCompanionModuleAccess: function (gardenCell, companionCell) {
            return syncCompanionModuleAccess(gardenCell, companionCell);
        },
        getModuleLabel: function (moduleCell, fallback) {
            return getModuleLabel(moduleCell, fallback);
        },
        writeModuleLabel: function (moduleCell, label) {
            return writeModuleLabel(moduleCell, label);
        },
        linkedGardenModuleForCompanion: function (moduleCell) {
            return linkedGardenModuleForCompanion(moduleCell);
        },
        linkedGardenLabelForCompanion: function (moduleCell) {
            return linkedGardenLabelForCompanion(moduleCell);
        },
        addReciprocalLink: function (left, right) {
            return addReciprocalLink(left, right);
        },
        selectRoleImage: function (roleCard) {
            return selectRoleImage(ui, graph, roleCard);
        }
    };

    installRootModuleCreationOverlay();
    installSelectedTeamModuleRoleOverlay();
    installSelectedRoleImageOverlay();

    graph.addListener("usl:requestApplyModuleMargins", function (_sender, evt) {
        const cell = evt && evt.getProperty ? evt.getProperty("cell") : null;
        if (!cell || !isModule(cell)) return;
        model.beginUpdate();
        try {
            enforceGardenModuleMinimum(cell);
            applyModuleMargins(cell, { allowShrink: false });
        } finally {
            model.endUpdate();
        }
    });

    graph.addListener("usl:requestPromptSetModuleMargin", function (_sender, evt) {
        const cell = evt && evt.getProperty ? evt.getProperty("cell") : null;
        if (!cell || !isModule(cell)) return;
        promptSetModuleMargin(cell);
    });

    graph.addListener("usl:requestSetModuleMargin", function (_sender, evt) {
        const cell = evt && evt.getProperty ? evt.getProperty("cell") : null;
        const marginPx = evt && evt.getProperty ? evt.getProperty("marginPx") : null;
        if (!cell || !isModule(cell)) return;
        setModuleMarginValue(cell, marginPx);
    });

    graph.addListener("usl:requestPromptSetModuleExternalMargin", function (_sender, evt) {
        const cell = evt && evt.getProperty ? evt.getProperty("cell") : null;
        if (!cell || !isModule(cell)) return;
        promptSetModuleExternalMargin(cell); // NEW
    });

    graph.addListener("usl:requestSetModuleExternalMargin", function (_sender, evt) {
        const cell = evt && evt.getProperty ? evt.getProperty("cell") : null;
        const marginPx = evt && evt.getProperty ? evt.getProperty("marginPx") : null;
        if (!cell || !isModule(cell)) return;
        setModuleExternalMarginValue(cell, marginPx); // NEW
    });

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
        id: "modules",
        priority: 100,
        addItems: function (menu, cell, evt) {

        // Add Module on background or right-click on module
        if (!cell) {
            menu.addItem("Add Module", null, function () {
                const pt = graph.getPointForEvent(evt);
                createModuleAtPoint(pt, "regular");
            });
        }

        const roleImageAction = roleImageActionForCell(cell);
        if (roleImageAction) {
            if (menu.addSeparator) menu.addSeparator();
            menu.addItem(roleImageAction.mode === "change" ? "Change Role Image" : "Add Role Image", null, function () {
                selectRoleImage(ui, graph, roleImageAction.roleCard);
            });
        }

        if (cell && isModule(cell)) {
            const isGarden = isGardenModule(cell);
            const isTeam = isTeamModule(cell);
            const isTask = isTaskModule(cell);

            // Toggle options based on current type                                       
            if (!isGarden && !isTeam && !isTask) {
                menu.addItem("Set as Garden Module", null, function () {
                    setModuleType(cell, "garden");
                });
                menu.addItem("Set as Team Module", null, function () {
                    setModuleType(cell, "team");
                });
                menu.addItem("Set as Task Module", null, function () {
                    setModuleType(cell, "task");
                });
            } else {
                menu.addItem("Set as Regular Module", null, function () {
                    setModuleType(cell, "regular");
                });
            }
            // Add Submodule (child module with relative coordinates)               
            menu.addItem("Add Submodule", null, function () {
                const pt = graph.getPointForEvent(evt);
                const sub = placeChildInModule(
                    cell,                                                           // parent module
                    pt.x,                                                           // abs X
                    pt.y,                                                           // abs Y
                    function (relX, relY) {                                         // factory: create submodule
                        const w = 160, h = 100;                                     // match createModuleCell defaults
                        const subCell = new mxCell(
                            "",
                            new mxGeometry(relX, relY, w, h),
                            "swimlane;whiteSpace=wrap;html=1;swimlaneFillColor=default;module=1"
                        );
                        subCell.vertex = true;
                        return subCell;
                    },
                    { applyMargins: true }                                         // optional, keeps parent margins updated
                );
                if (sub) {
                    graph.setSelectionCell(sub);
                }
            });

            // Keep your existing margin editor (using ui.prompt)                         
            menu.addItem("Set Internal Margin (diagram units)...", null, function () { // CHANGE
                promptSetModuleMargin(cell);
            });
            menu.addItem("Set External Margin (diagram units)...", null, function () { // NEW
                promptSetModuleExternalMargin(cell);
            });

            // Team module gets Add Role Card                                             
            if (isTeam) {
                menu.addItem("Add Role Card", null, function () {
                    const pt = graph.getPointForEvent(evt);
                    addRoleCardToTeamModule(cell, pt.x, pt.y);
                });
            }

        }
        }
    });

});
