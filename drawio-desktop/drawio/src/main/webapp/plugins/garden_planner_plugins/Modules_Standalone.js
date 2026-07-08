Draw.loadPlugin(function (ui) {
    const graph = ui.editor.graph;
    const model = graph.getModel();

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



    const MIN_W = 60, MIN_H = 40; // CHANGE
    const GARDEN_MIN_CONTENT_W = 440, GARDEN_MIN_CONTENT_H = 340; // CHANGE

    const EPS = 0.5; // epsilon                                                      

    function getModuleMinContentSize(moduleCell) { // CHANGE
        return isGardenModule(moduleCell) // CHANGE
            ? { width: GARDEN_MIN_CONTENT_W, height: GARDEN_MIN_CONTENT_H } // CHANGE
            : { width: MIN_W, height: MIN_H }; // CHANGE
    } // CHANGE

    function getModuleHeaderHeight(moduleCell) { // CHANGE
        return isSwimlane(moduleCell) ? getStartSize(moduleCell).height : 0; // CHANGE
    } // CHANGE

    function getModuleMinOuterSize(moduleCell) { // CHANGE
        const content = getModuleMinContentSize(moduleCell); // CHANGE
        return { width: content.width, height: content.height + getModuleHeaderHeight(moduleCell) }; // CHANGE
    } // CHANGE

    function enforceGardenModuleMinimum(moduleCell) { // CHANGE
        if (!isGardenModule(moduleCell)) return false; // CHANGE
        const g = model.getGeometry(moduleCell); // CHANGE
        if (!g) return false; // CHANGE
        const min = getModuleMinOuterSize(moduleCell); // CHANGE
        const nextW = Math.max(Number(g.width) || 0, min.width); // CHANGE
        const nextH = Math.max(Number(g.height) || 0, min.height); // CHANGE
        if (Math.abs(nextW - g.width) < EPS && Math.abs(nextH - g.height) < EPS) return false; // CHANGE
        const g2 = g.clone(); // CHANGE
        g2.width = nextW; // CHANGE
        g2.height = nextH; // CHANGE
        model.setGeometry(moduleCell, g2); // CHANGE
        return true; // CHANGE
    } // CHANGE

    function applyModuleMargins(moduleCell, opts) {
        const o = opts || {};
        const allowShrink = !!o.allowShrink;
        const manageUpdate = o.manageUpdate !== false; // NEW
        if (!isModule(moduleCell)) return;

        const margin = getIntStyle(moduleCell, "module_margin", 100);
        const mGeo = model.getGeometry(moduleCell);
        if (!mGeo) return;

        const u = getChildUnionRelative(moduleCell); // union in module space
        const minContent = getModuleMinContentSize(moduleCell); // CHANGE

        // Children coords are in swimlane content space; outerHeight = content + header.
        const headerH = getModuleHeaderHeight(moduleCell); // CHANGE

        const minRight = Math.max(u ? u.right + margin : 0, minContent.width); // CHANGE
        const minBottom = Math.max(u ? u.bottom + margin : 0, minContent.height); // CHANGE

        // If shrinking is allowed, snap to minima; otherwise never shrink (only expand).     
        const targetW = allowShrink ? minRight : Math.max(mGeo.width, minRight);
        const targetH = allowShrink ? (minBottom + headerH)
            : Math.max(mGeo.height, minBottom + headerH);

        if (Math.abs(targetW - mGeo.width) < EPS && Math.abs(targetH - mGeo.height) < EPS) {
            return;
        }

        if (manageUpdate) model.beginUpdate(); // CHANGE
        try { // CHANGE
            const g2 = mGeo.clone();
            g2.width = targetW;
            g2.height = targetH;
            model.setGeometry(moduleCell, g2);
        } finally {
            if (manageUpdate) model.endUpdate(); // CHANGE
        }

        graph.refresh(moduleCell);
    }

    function setModuleMarginValue(moduleCell, marginPx) { // NEW
        if (!isModule(moduleCell)) return; // NEW
        const n = Math.max(0, parseInt(marginPx, 10) || 0); // NEW
        let st = getStyle(moduleCell) || ""; // NEW
        st = st.replace(/(?:^|;)module_margin=\d+(?=;|$)/, ""); // NEW
        st = st.replace(/;;+/g, ";").replace(/^;|;$/g, ""); // NEW
        st += (st ? ";" : "") + "module_margin=" + n; // NEW

        model.beginUpdate(); // NEW
        try { // NEW
            model.setStyle(moduleCell, st); // NEW
            applyModuleMargins(moduleCell); // NEW
        } finally { // NEW
            model.endUpdate(); // NEW
        } // NEW
    } // NEW

    function promptSetModuleMargin(moduleCell) { // NEW
        if (!isModule(moduleCell) || !ui.prompt) return; // NEW
        const cur = getIntStyle(moduleCell, "module_margin", 100); // NEW
        if (graph.popupMenuHandler && graph.popupMenuHandler.hideMenu) { // NEW
            graph.popupMenuHandler.hideMenu(); // NEW
        } // NEW
        setTimeout(function () { // NEW
            ui.prompt("Module internal margin (px):", String(cur), function (val) { // NEW
                if (val == null) return; // NEW
                setModuleMarginValue(moduleCell, val); // NEW
            }); // NEW
        }, 0); // NEW
    } // NEW


    // ---- Helpers for module typing ----                                               
    function isGardenModule(cell) {
        return !!cell && getXmlFlag(cell, "garden_module");
    }

    function isTeamModule(cell) {
        return !!cell && getXmlFlag(cell, "team_module");
    }

    function isGardenDashboardCell(cell) { // CHANGE
        return !!cell && cell.getAttribute && cell.getAttribute("garden_dashboard") === "1"; // CHANGE
    } // CHANGE

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
        const city = (v.getAttribute("city_id") || v.getAttribute("city_name") || "").trim(); // CHANGED
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

            // Set the desired flag
            if (type === "garden") {
                setXmlFlag(cell, "garden_module", true);                                     // FIX
                becameGarden = true;                                                        
            } else if (type === "team") {
                setXmlFlag(cell, "team_module", true);
            }

            let st = getStyle(cell) || "";
            st = st.replace(/(?:^|;)swimlaneFillColor=[^;]*(?=;|$)/g, "");
            st = st.replace(/;;+/g, ";").replace(/^;|;$/g, "");

            if (type === "garden") {
                st += (st ? ";" : "") + "swimlaneFillColor=#B9E0A5";
            } else if (type === "team") {
                st += (st ? ";" : "") + "swimlaneFillColor=#FFF2CC";
            } else {
                st += (st ? ";" : "") + "swimlaneFillColor=default";
            }

            model.setStyle(cell, st);
        } finally {
            model.endUpdate();
        }
        graph.refresh(cell);

        if (becameGarden) {                                                                  // CHANGE
            model.beginUpdate();                                                             // CHANGE
            try {                                                                            // CHANGE
                enforceGardenModuleMinimum(cell);                                            // CHANGE
                applyModuleMargins(cell, { allowShrink: false });                            // CHANGE
            } finally {                                                                      // CHANGE
                model.endUpdate();                                                           // CHANGE
            }                                                                                // CHANGE
        }                                                                                    // CHANGE

        if (becameGarden) {                                                                  // FIX
            setTimeout(() => emitGardenSettingsNeededIfMissing(graph, cell), 0);             // FIX
        }                                                                              
    }                                                                                        

    function isRoleCard(cell) { // CHANGE
        const st = getStyle(cell);
        if (!st) return false;
        if (/(^|;)role_card=1(;|$)/.test(st)) return true;             // primary signal
        // optional fallback: swimlane under a team module
        const p = model.getParent(cell);
        return /(^|;)swimlane(;|$)/.test(st) && !!p && isModule(p) && isTeamModule(p);
    }

    function isRoleImageRow(cell) { // NEW
        return /(^|;)role_imagerow=1(;|$)/.test(getStyle(cell)); // NEW
    } // NEW

    function isRoleAvatar(cell) { // NEW
        return /(^|;)role_avatar=1(;|$)/.test(getStyle(cell)); // NEW
    } // NEW

    function getRoleImageRow(roleCard) { // NEW
        const children = model.getChildren(roleCard) || []; // NEW
        return children.find(function (child) { return isRoleImageRow(child); }) || null; // NEW
    } // NEW

    function getRoleAvatar(roleCard) { // NEW
        const imageRow = getRoleImageRow(roleCard); // NEW
        const children = imageRow ? (model.getChildren(imageRow) || []) : []; // NEW
        return children.find(function (child) { return isRoleAvatar(child); }) || null; // NEW
    } // NEW

    function roleCardForImageCell(cell) { // NEW
        if (!cell) return null; // NEW
        if (isRoleCard(cell)) return cell; // NEW
        if (isRoleImageRow(cell)) { // NEW
            const roleCard = model.getParent(cell); // NEW
            return isRoleCard(roleCard) ? roleCard : null; // NEW
        } // NEW
        if (isRoleAvatar(cell)) { // NEW
            const imageRow = model.getParent(cell); // NEW
            const roleCard = model.getParent(imageRow); // NEW
            return isRoleImageRow(imageRow) && isRoleCard(roleCard) ? roleCard : null; // NEW
        } // NEW
        return null; // NEW
    } // NEW

    function roleHasAvatar(roleCard) { // NEW
        return !!getRoleAvatar(roleCard); // NEW
    } // NEW

    function setCellLabel(cell, label) { // NEW
        if (!cell) return; // NEW
        const v = cell.value; // NEW
        if (v && v.nodeType === 1) { // NEW
            v.setAttribute("label", label || ""); // NEW
            model.setValue(cell, v); // NEW
        } else { // NEW
            model.setValue(cell, label || ""); // NEW
        } // NEW
    } // NEW

    function normalizeRoleImagePlaceholder(roleCard) { // NEW
        const imageRow = getRoleImageRow(roleCard); // NEW
        if (imageRow && !roleHasAvatar(roleCard) && imageRow.value === "Image") setCellLabel(imageRow, "click to add image"); // NEW
    } // NEW

    function roleImageActionForCell(cell, options) { // CHANGE
        const opts = options || {}; // NEW
        const roleCard = roleCardForImageCell(cell); // NEW
        if (!roleCard) return null; // NEW
        const hasAvatar = roleHasAvatar(roleCard); // NEW
        if (hasAvatar && !isRoleAvatar(cell) && !(opts.allowImageRowChange && isRoleImageRow(cell))) return null; // CHANGE
        if (!hasAvatar && !(isRoleCard(cell) || isRoleImageRow(cell))) return null; // NEW
        return { roleCard: roleCard, mode: hasAvatar ? "change" : "add", avatar: getRoleAvatar(roleCard), imageRow: getRoleImageRow(roleCard), sourceCell: cell }; // CHANGE
    } // NEW

    function getOrCreateRoleImageRow(roleCard) { // NEW
        let imageRow = getRoleImageRow(roleCard); // NEW
        if (imageRow) return imageRow; // NEW
        const roleGeo = graph.getCellGeometry(roleCard); // NEW
        const rowGeo = new mxGeometry(0, 0, roleGeo ? roleGeo.width : 80, 80); // NEW
        const rowStyle = "shape=rectangle;fillColor=#ffffff;strokeColor=#d6b656;role_imagerow=1;"; // NEW
        imageRow = new mxCell("click to add image", rowGeo, rowStyle); // NEW
        imageRow.vertex = true; // NEW
        model.add(roleCard, imageRow, 0); // NEW
        return imageRow; // NEW
    } // NEW

    function removeExistingRoleAvatar(imageRow) { // NEW
        const children = model.getChildren(imageRow) || []; // NEW
        children.forEach(function (child) { if (isRoleAvatar(child)) model.remove(child); }); // NEW
    } // NEW

    function tagRoleAvatar(cell) { // NEW
        let st = getStyle(cell) || ""; // NEW
        st = st.replace(/(?:^|;)role_avatar=1(?=;|$)/g, ""); // NEW
        st = st.replace(/;;+/g, ";").replace(/^;|;$/g, ""); // NEW
        st += (st ? ";" : "") + "role_avatar=1"; // NEW
        model.setStyle(cell, st); // NEW
    } // NEW

    function placeRoleAvatar(roleCard, cell) { // NEW
        const imageRow = getOrCreateRoleImageRow(roleCard); // NEW
        removeExistingRoleAvatar(imageRow); // NEW
        setCellLabel(imageRow, ""); // NEW
        const geo = cell.getGeometry().clone(); // NEW
        geo.width = 70; // NEW
        geo.height = 70; // NEW
        geo.x = 5; // NEW
        geo.y = 5; // NEW
        model.setGeometry(cell, geo); // NEW
        tagRoleAvatar(cell); // NEW
        model.remove(cell); // NEW
        model.add(imageRow, cell); // NEW
    } // NEW


    function createRoleCard(graph, moduleCell, x, y, opts) { // CHANGE
        const o = opts || {}; // NEW
        const manageUpdate = o.manageUpdate !== false; // NEW
        const w = 240, h = 160;
        const moduleGeo = graph.getCellGeometry(moduleCell);

        const relX = x - moduleGeo.x;
        const relY = y - moduleGeo.y;

        const role = new mxCell("Role", new mxGeometry(relX, relY, w, h),
            "shape=swimlane;horizontal=1;whiteSpace=wrap;collapsible=1;rounded=1;fillColor=#fff2cc;strokeColor=#d6b656;role_card=1");
        role.vertex = true;

        // Avatar placeholder (80px tall gray rectangle)
        const avatarGeo = new mxGeometry(5, 5, 30, 80);
        const avatar = new mxCell("click to add image", avatarGeo, // CHANGE
            "shape=rectangle;align=left;verticalAlign=middle;whiteSpace=wrap;fillColor=#f5f5f5;strokeColor=#999999;role_imagerow=1;");
        avatar.vertex = true;

        const name = new mxCell("Name", new mxGeometry(40, 0, w - 40, 30),
            "shape=rectangle;align=left;verticalAlign=middle;whiteSpace=wrap;fillColor=#ffffff;strokeColor=#d6b656;");
        name.vertex = true;

        const title = new mxCell("Role/Title", new mxGeometry(0, 30, w, 30),
            "shape=rectangle;align=left;verticalAlign=middle;whiteSpace=wrap;fillColor=#ffffff;strokeColor=#d6b656;");
        title.vertex = true;

        const notes = new mxCell("Description/Notes", new mxGeometry(0, 60, w, 60),
            "shape=rectangle;align=left;verticalAlign=top;whiteSpace=wrap;fillColor=#ffffff;strokeColor=#d6b656;");
        notes.vertex = true;

        const contact = new mxCell("Contact Info", new mxGeometry(0, 120, w, 30),
            "shape=rectangle;align=left;verticalAlign=middle;whiteSpace=wrap;fillColor=#ffffff;strokeColor=#d6b656;");
        contact.vertex = true;

        if (manageUpdate) model.beginUpdate(); // CHANGE
        try { // CHANGE
            model.add(moduleCell, role);
            [avatar, name, title, notes, contact].forEach(child => model.add(role, child));
        } finally {
            if (manageUpdate) model.endUpdate(); // CHANGE
        }
        return role;
    }

    function addRoleCardToTeamModule(moduleCell, x, y) { // NEW
        if (!moduleCell || !isTeamModule(moduleCell)) return null; // NEW
        let role = null; // NEW
        model.beginUpdate(); // NEW
        try { // NEW
            role = createRoleCard(graph, moduleCell, x, y, { manageUpdate: false }); // NEW
            applyModuleMargins(moduleCell, { manageUpdate: false }); // NEW
        } finally { // NEW
            model.endUpdate(); // NEW
        } // NEW
        if (role && graph.setSelectionCell) graph.setSelectionCell(role); // NEW
        return role; // NEW
    } // NEW


    function selectRoleImage(ui, graph, roleCard) {
        const origInsertVertex = graph.insertVertex;
        let restored = false; // NEW

        function restoreInsertVertex() { // NEW
            if (restored) return; // NEW
            restored = true; // NEW
            graph.insertVertex = origInsertVertex; // NEW
        } // NEW

        graph.insertVertex = function (parent, id, value, x, y, w, h, style, relative) {
            const cell = origInsertVertex.apply(this, arguments);
            const insertedStyle = style || getStyle(cell); // NEW

            if (insertedStyle && insertedStyle.includes("shape=image")) { // CHANGE
                // Delay to let Draw.io finish committing the inserted image
                setTimeout(() => {
                    model.beginUpdate();
                    try {
                        placeRoleAvatar(roleCard, cell); // CHANGE
                    } finally {
                        model.endUpdate();
                    }

                    restoreInsertVertex(); // CHANGE
                }, 0);
            } else {
                restoreInsertVertex(); // CHANGE
            }

            return cell;
        };

        // Trigger the standard Insert → Image dialog
        const action = ui.actions && ui.actions.get ? ui.actions.get("insertImage") : null; // NEW
        if (!action || typeof action.funct !== "function") { restoreInsertVertex(); return; } // NEW
        try { // NEW
            action.funct(); // CHANGE
        } catch (e) { // NEW
            restoreInsertVertex(); // NEW
            throw e; // NEW
        } // NEW
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
                model.beginUpdate();
                try {
                    reparentCellsIntoModules(cells);
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
                        if (isGardenDashboardCell(c)) seenModules.add(p.id); // CHANGE
                        else toRoot.push({ cell: c, oldModule: p }); // CHANGE
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
        });


        graph.addListener(mxEvent.CELLS_RESIZED, function (sender, evt) {
            const cells = evt.getProperty("cells") || [];
            const seenModules = new Set();
            cells.forEach(c => {
                if (isGardenModule(c)) enforceGardenModuleMinimum(c);          // CHANGE
                if (isModule(c)) seenModules.add(c.id);                // module resized by user
                const p = model.getParent(c);
                if (p && isModule(p)) seenModules.add(p.id);           // child resized
            });
            // Do NOT shrink for module resize or child resize                                      
            seenModules.forEach(id => applyModuleMargins(model.getCell(id), { allowShrink: false }));
        });

    }

    // ------------------------
    // MODULE CREATION
    // ------------------------

    function createModuleCell(graph, x, y) {
        const parent = graph.getDefaultParent();
        const w = 160, h = 100;

        const moduleCell = new mxCell("",
            new mxGeometry(x, y, w, h),
            "swimlane;whiteSpace=wrap;html=1;swimlaneFillColor=default;module=1");
        moduleCell.vertex = true;
        model.add(parent, moduleCell);

        return moduleCell;
    }

    function normalizeRootModuleType(type) { // NEW
        return type === "garden" || type === "team" ? type : "regular"; // NEW
    } // NEW

    function createModuleAtPoint(point, type) { // NEW
        const moduleType = normalizeRootModuleType(type); // NEW
        const x = Number(point && point.x) || 0; // NEW
        const y = Number(point && point.y) || 0; // NEW
        let mod = null; // NEW
        model.beginUpdate(); // NEW
        try { // NEW
            mod = createModuleCell(graph, x, y); // NEW
            applyModuleMargins(mod); // NEW
            if (moduleType !== "regular") setModuleType(mod, moduleType); // NEW
            if (mod && graph.setSelectionCell) graph.setSelectionCell(mod); // NEW
        } finally { // NEW
            model.endUpdate(); // NEW
        } // NEW
        return mod; // NEW
    } // NEW

    function installRootModuleCreationOverlay() { // NEW
        if (graph.__trellisRootModuleCreationOverlayInstalled) return; // NEW
        graph.__trellisRootModuleCreationOverlayInstalled = true; // NEW

        const OFFSET_PX = 8; // NEW
        const SIMPLE_CLICK_MAX_MOVE_PX = 4; // NEW
        let overlay = null; // NEW
        let pendingClick = null; // NEW
        let overlayShownAt = 0; // NEW
        let dismissOnlyClick = false; // NEW

        function overlayHost() { // NEW
            return graph.container || null; // NEW
        } // NEW

        function ensureOverlayHost() { // NEW
            const host = overlayHost(); // NEW
            if (!host) return null; // NEW
            const style = window.getComputedStyle ? window.getComputedStyle(host) : null; // NEW
            if (style && style.position === "static") host.style.position = "relative"; // NEW
            return host; // NEW
        } // NEW

        function eventSource(evt) { // NEW
            return mxEvent.getSource ? mxEvent.getSource(evt) : evt && (evt.target || evt.srcElement); // NEW
        } // NEW

        function eventInOverlay(evt) { // NEW
            return !!overlay && !!evt && overlay.contains(eventSource(evt)); // NEW
        } // NEW

        function isPlainLeftMouseEvent(evt) { // NEW
            if (!evt) return false; // NEW
            const button = typeof evt.button === "number" ? evt.button : 0; // NEW
            const popup = mxEvent.isPopupTrigger && mxEvent.isPopupTrigger(evt); // NEW
            return button === 0 && !popup && !mxEvent.isControlDown(evt) && !mxEvent.isMetaDown(evt) && !mxEvent.isShiftDown(evt) && !evt.altKey; // NEW
        } // NEW

        function isDoubleClick(evt) { // NEW
            return !!evt && Number(evt.detail || 0) > 1; // NEW
        } // NEW

        function eventClientPoint(evt) { // NEW
            return { x: mxEvent.getClientX(evt), y: mxEvent.getClientY(evt) }; // NEW
        } // NEW

        function containerPointForEvent(evt) { // NEW
            const host = overlayHost(); // NEW
            const rect = host && host.getBoundingClientRect ? host.getBoundingClientRect() : { left: 0, top: 0 }; // NEW
            const client = eventClientPoint(evt); // NEW
            return { // NEW
                x: client.x - (rect.left || 0) + (host ? host.scrollLeft || 0 : 0), // NEW
                y: client.y - (rect.top || 0) + (host ? host.scrollTop || 0 : 0) // NEW
            }; // NEW
        } // NEW

        function modelPointForEvent(evt) { // NEW
            if (graph.getPointForEvent) return graph.getPointForEvent(evt, false); // NEW
            return containerPointForEvent(evt); // NEW
        } // NEW

        function hitPointForMouseEvent(me, evt) { // NEW
            if (me && typeof me.getGraphX === "function" && typeof me.getGraphY === "function") { // NEW
                return { x: me.getGraphX(), y: me.getGraphY() }; // NEW
            } // NEW
            return containerPointForEvent(evt); // NEW
        } // NEW

        function cellForMouseEvent(me, evt) { // NEW
            const direct = me && typeof me.getCell === "function" ? me.getCell() : null; // NEW
            if (direct) return direct; // NEW
            const pt = hitPointForMouseEvent(me, evt); // NEW
            return graph.getCellAt ? graph.getCellAt(pt.x, pt.y) : null; // NEW
        } // NEW

        function isSimpleClick(start, evt) { // NEW
            if (!start || !evt) return false; // NEW
            const client = eventClientPoint(evt); // NEW
            const dx = client.x - start.client.x; // NEW
            const dy = client.y - start.client.y; // NEW
            return Math.sqrt(dx * dx + dy * dy) <= SIMPLE_CLICK_MAX_MOVE_PX; // NEW
        } // NEW

        function hideOverlay() { // NEW
            if (overlay) overlay.style.display = "none"; // NEW
        } // NEW

        function isOverlayVisible() { // NEW
            return !!overlay && overlay.style.display !== "none"; // NEW
        } // NEW

        function makeOverlayButton(label, type) { // NEW
            const btn = document.createElement("button"); // NEW
            btn.type = "button"; // NEW
            btn.textContent = label; // NEW
            btn.style.border = "1px solid #b8b8b8"; // NEW
            btn.style.borderRadius = "4px"; // NEW
            btn.style.background = "#fff"; // NEW
            btn.style.color = "#222"; // NEW
            btn.style.cursor = "pointer"; // NEW
            btn.style.font = "12px Arial, sans-serif"; // NEW
            btn.style.padding = "5px 8px"; // NEW
            btn.style.textAlign = "left"; // NEW
            btn.style.whiteSpace = "nowrap"; // NEW
            mxEvent.addListener(btn, "click", function (evt) { // NEW
                mxEvent.consume(evt); // NEW
                const point = overlay && overlay.__trellisModulePoint; // NEW
                if (point) createModuleAtPoint(point, type); // NEW
                hideOverlay(); // NEW
            }); // NEW
            return btn; // NEW
        } // NEW

        function ensureOverlay() { // NEW
            if (overlay) return overlay; // NEW
            overlay = document.createElement("div"); // NEW
            overlay.className = "trellis-root-module-overlay"; // NEW
            overlay.style.position = "absolute"; // NEW
            overlay.style.zIndex = "10007"; // NEW
            overlay.style.display = "none"; // NEW
            overlay.style.flexDirection = "column"; // NEW
            overlay.style.gap = "4px"; // NEW
            overlay.style.padding = "4px"; // NEW
            overlay.style.background = "rgba(255,255,255,0.96)"; // NEW
            overlay.style.border = "1px solid #c7c7cc"; // NEW
            overlay.style.borderRadius = "6px"; // NEW
            overlay.style.boxShadow = "0 2px 8px rgba(0,0,0,0.16)"; // NEW
            overlay.style.font = "12px Arial, sans-serif"; // NEW
            overlay.style.pointerEvents = "auto"; // NEW
            mxEvent.addListener(overlay, "mousedown", function (evt) { mxEvent.consume(evt); }); // NEW
            mxEvent.addListener(overlay, "click", function (evt) { mxEvent.consume(evt); }); // NEW
            overlay.appendChild(makeOverlayButton("Add Module", "regular")); // NEW
            overlay.appendChild(makeOverlayButton("Add Garden Module", "garden")); // NEW
            overlay.appendChild(makeOverlayButton("Add Team Module", "team")); // NEW
            const host = ensureOverlayHost(); // NEW
            if (host) host.appendChild(overlay); // NEW
            return overlay; // NEW
        } // NEW

        function positionOverlay(containerPoint) { // NEW
            const host = ensureOverlayHost(); // NEW
            const div = ensureOverlay(); // NEW
            if (!host || !div) return; // NEW
            if (div.parentNode !== host) host.appendChild(div); // NEW
            div.style.display = "flex"; // NEW
            div.style.left = "0px"; // NEW
            div.style.top = "0px"; // NEW
            const width = div.offsetWidth || 150; // NEW
            const height = div.offsetHeight || 92; // NEW
            const scrollLeft = host.scrollLeft || 0; // NEW
            const scrollTop = host.scrollTop || 0; // NEW
            const maxLeft = scrollLeft + Math.max(0, (host.clientWidth || width) - width - OFFSET_PX); // NEW
            const maxTop = scrollTop + Math.max(0, (host.clientHeight || height) - height - OFFSET_PX); // NEW
            const left = Math.max(scrollLeft, Math.min(maxLeft, Math.round(containerPoint.x + OFFSET_PX))); // NEW
            const top = Math.max(scrollTop, Math.min(maxTop, Math.round(containerPoint.y + OFFSET_PX))); // NEW
            div.style.left = left + "px"; // NEW
            div.style.top = top + "px"; // NEW
        } // NEW

        function showOverlay(anchor) { // NEW
            const div = ensureOverlay(); // NEW
            if (!div) return; // NEW
            div.__trellisModulePoint = { x: anchor.model.x, y: anchor.model.y }; // NEW
            overlayShownAt = Date.now(); // NEW
            positionOverlay(anchor.container); // NEW
        } // NEW

        function onDismissEvent() { // NEW
            if (overlayShownAt && Date.now() - overlayShownAt < 80) return; // NEW
            pendingClick = null; // NEW
            hideOverlay(); // NEW
        } // NEW

        if (graph.addMouseListener) { // NEW
            graph.addMouseListener({ // NEW
                mouseDown: function (_sender, me) { // NEW
                    const evt = me && me.getEvent ? me.getEvent() : null; // NEW
                    if (eventInOverlay(evt)) return; // NEW
                    if (isOverlayVisible()) { // NEW
                        dismissOnlyClick = true; // NEW
                        pendingClick = null; // NEW
                        hideOverlay(); // NEW
                        return; // NEW
                    } // NEW
                    dismissOnlyClick = false; // NEW
                    hideOverlay(); // NEW
                    pendingClick = null; // NEW
                    if (!isPlainLeftMouseEvent(evt) || isDoubleClick(evt)) return; // NEW
                    pendingClick = { // NEW
                        client: eventClientPoint(evt), // NEW
                        model: modelPointForEvent(evt), // NEW
                        container: containerPointForEvent(evt) // NEW
                    }; // NEW
                }, // NEW
                mouseMove: function () { }, // NEW
                mouseUp: function (_sender, me) { // NEW
                    const evt = me && me.getEvent ? me.getEvent() : null; // NEW
                    if (dismissOnlyClick) { // NEW
                        dismissOnlyClick = false; // NEW
                        pendingClick = null; // NEW
                        return; // NEW
                    } // NEW
                    const start = pendingClick; // NEW
                    pendingClick = null; // NEW
                    if (eventInOverlay(evt)) return; // NEW
                    if (!isPlainLeftMouseEvent(evt) || isDoubleClick(evt) || !isSimpleClick(start, evt)) return; // NEW
                    if (cellForMouseEvent(me, evt)) return; // NEW
                    showOverlay(start); // NEW
                } // NEW
            }); // NEW
        } // NEW

        const selectionModel = graph.getSelectionModel ? graph.getSelectionModel() : null; // NEW
        if (selectionModel && selectionModel.addListener) selectionModel.addListener(mxEvent.CHANGE, onDismissEvent); // NEW
        if (model.addListener) model.addListener(mxEvent.CHANGE, onDismissEvent); // NEW
        if (graph.getView && graph.getView()) { // NEW
            const view = graph.getView(); // NEW
            if (view.addListener) { // NEW
                view.addListener(mxEvent.SCALE, onDismissEvent); // NEW
                view.addListener(mxEvent.TRANSLATE, onDismissEvent); // NEW
                view.addListener(mxEvent.SCALE_AND_TRANSLATE, onDismissEvent); // NEW
            } // NEW
        } // NEW
        mxEvent.addListener(document, "keydown", function (evt) { if (evt && evt.key === "Escape") hideOverlay(); }); // NEW
        graph.addListener && graph.addListener(mxEvent.DESTROY, function () { if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay); overlay = null; }); // NEW
    } // NEW

    //  Role cards, menus, layouts etc… remain as you have them.
    function installSelectedTeamModuleRoleOverlay() { // NEW
        if (graph.__trellisSelectedTeamModuleRoleOverlayInstalled) return; // NEW
        graph.__trellisSelectedTeamModuleRoleOverlayInstalled = true; // NEW

        const OFFSET_PX = 8; // NEW
        const SIMPLE_CLICK_MAX_MOVE_PX = 4; // NEW
        let overlay = null; // NEW
        let pendingClick = null; // NEW
        let lastClickAnchor = null; // CHANGE
        let currentTeamModule = null; // NEW
        let dismissOnlyClick = false; // NEW
        let recentlyDismissedCell = null; // NEW
        let recentlyDismissedAt = 0; // NEW

        function overlayHost() { // NEW
            return graph.container || null; // NEW
        } // NEW

        function ensureOverlayHost() { // NEW
            const host = overlayHost(); // NEW
            if (!host) return null; // NEW
            const style = window.getComputedStyle ? window.getComputedStyle(host) : null; // NEW
            if (style && style.position === "static") host.style.position = "relative"; // NEW
            return host; // NEW
        } // NEW

        function eventSource(evt) { // NEW
            return mxEvent.getSource ? mxEvent.getSource(evt) : evt && (evt.target || evt.srcElement); // NEW
        } // NEW

        function eventInOverlay(evt) { // NEW
            return !!overlay && !!evt && overlay.contains(eventSource(evt)); // NEW
        } // NEW

        function isPlainLeftMouseEvent(evt) { // NEW
            if (!evt) return false; // NEW
            const button = typeof evt.button === "number" ? evt.button : 0; // NEW
            const popup = mxEvent.isPopupTrigger && mxEvent.isPopupTrigger(evt); // NEW
            return button === 0 && !popup && !mxEvent.isControlDown(evt) && !mxEvent.isMetaDown(evt) && !mxEvent.isShiftDown(evt) && !evt.altKey; // NEW
        } // NEW

        function isDoubleClick(evt) { // NEW
            return !!evt && Number(evt.detail || 0) > 1; // NEW
        } // NEW

        function eventClientPoint(evt) { // NEW
            return { x: mxEvent.getClientX(evt), y: mxEvent.getClientY(evt) }; // NEW
        } // NEW

        function containerPointForEvent(evt) { // NEW
            const host = overlayHost(); // NEW
            const rect = host && host.getBoundingClientRect ? host.getBoundingClientRect() : { left: 0, top: 0 }; // NEW
            const client = eventClientPoint(evt); // NEW
            return { // NEW
                x: client.x - (rect.left || 0) + (host ? host.scrollLeft || 0 : 0), // NEW
                y: client.y - (rect.top || 0) + (host ? host.scrollTop || 0 : 0) // NEW
            }; // NEW
        } // NEW

        function modelPointForEvent(evt) { // NEW
            if (graph.getPointForEvent) return graph.getPointForEvent(evt, false); // NEW
            return containerPointForEvent(evt); // NEW
        } // NEW

        function hitPointForMouseEvent(me, evt) { // NEW
            if (me && typeof me.getGraphX === "function" && typeof me.getGraphY === "function") { // NEW
                return { x: me.getGraphX(), y: me.getGraphY() }; // NEW
            } // NEW
            return containerPointForEvent(evt); // NEW
        } // NEW

        function cellForMouseEvent(me, evt) { // NEW
            const direct = me && typeof me.getCell === "function" ? me.getCell() : null; // NEW
            if (direct) return direct; // NEW
            const pt = hitPointForMouseEvent(me, evt); // NEW
            return graph.getCellAt ? graph.getCellAt(pt.x, pt.y) : null; // NEW
        } // NEW

        function isSimpleClick(start, evt) { // NEW
            if (!start || !evt) return false; // NEW
            const client = eventClientPoint(evt); // NEW
            const dx = client.x - start.client.x; // NEW
            const dy = client.y - start.client.y; // NEW
            return Math.sqrt(dx * dx + dy * dy) <= SIMPLE_CLICK_MAX_MOVE_PX; // NEW
        } // NEW

        function selectedTeamModule() { // NEW
            const cells = graph.getSelectionCells ? graph.getSelectionCells() : (graph.getSelectionCell ? [graph.getSelectionCell()] : []); // NEW
            return cells && cells.length === 1 && isModule(cells[0]) && isTeamModule(cells[0]) ? cells[0] : null; // NEW
        } // NEW

        function hideOverlay() { // NEW
            if (overlay) overlay.style.display = "none"; // NEW
            currentTeamModule = null; // NEW
        } // NEW

        function isOverlayVisible() { // NEW
            return !!overlay && overlay.style.display !== "none"; // NEW
        } // NEW

        function moduleContainsPoint(moduleCell, point) { // NEW
            const geo = graph.getCellGeometry(moduleCell); // NEW
            return !!geo && !!point && point.x >= geo.x && point.x <= geo.x + geo.width && point.y >= geo.y && point.y <= geo.y + geo.height; // NEW
        } // NEW

        function fallbackRoleCardPoint(moduleCell) { // NEW
            const geo = graph.getCellGeometry(moduleCell); // NEW
            const margin = getIntStyle(moduleCell, "module_margin", 100); // NEW
            const headerH = getModuleHeaderHeight(moduleCell); // NEW
            return { x: (geo ? geo.x : 0) + margin, y: (geo ? geo.y : 0) + headerH + margin }; // NEW
        } // NEW

        function roleCardPoint(moduleCell) { // NEW
            return moduleContainsPoint(moduleCell, lastClickAnchor && lastClickAnchor.model) ? lastClickAnchor.model : fallbackRoleCardPoint(moduleCell); // CHANGE
        } // NEW

        function cellContainerPoint(cell) { // NEW
            const view = graph.getView ? graph.getView() : graph.view; // NEW
            const state = view && typeof view.getState === "function" ? view.getState(cell) : null; // NEW
            if (state) return { x: state.x, y: state.y }; // NEW
            const geo = graph.getCellGeometry(cell); // NEW
            const scale = view && view.scale ? view.scale : 1; // NEW
            const translate = view && view.translate ? view.translate : { x: 0, y: 0 }; // NEW
            return { x: geo ? (geo.x + (translate.x || 0)) * scale : 0, y: geo ? (geo.y + (translate.y || 0)) * scale : 0 }; // NEW
        } // NEW

        function moduleOverlayAnchor(cell) { // NEW
            return { model: fallbackRoleCardPoint(cell), container: cellContainerPoint(cell) }; // NEW
        } // NEW

        function overlayAnchorForCell(cell) { // NEW
            if (pendingClick && moduleContainsPoint(cell, pendingClick.model)) return pendingClick; // NEW
            if (lastClickAnchor && moduleContainsPoint(cell, lastClickAnchor.model)) return lastClickAnchor; // NEW
            return moduleOverlayAnchor(cell); // NEW
        } // NEW

        function positionOverlay(anchor) { // CHANGE
            const host = ensureOverlayHost(); // NEW
            const div = ensureOverlay(); // NEW
            if (!host || !div || !anchor || !anchor.container) return; // CHANGE
            if (div.parentNode !== host) host.appendChild(div); // NEW
            div.style.display = "flex"; // NEW
            div.style.left = "0px"; // NEW
            div.style.top = "0px"; // NEW
            const point = anchor.container; // NEW
            const width = div.offsetWidth || 110; // NEW
            const height = div.offsetHeight || 30; // NEW
            const scrollLeft = host.scrollLeft || 0; // NEW
            const scrollTop = host.scrollTop || 0; // NEW
            const maxLeft = scrollLeft + Math.max(0, (host.clientWidth || width) - width - OFFSET_PX); // NEW
            const maxTop = scrollTop + Math.max(0, (host.clientHeight || height) - height - OFFSET_PX); // NEW
            const left = Math.max(scrollLeft, Math.min(maxLeft, Math.round(point.x + OFFSET_PX))); // CHANGE
            const top = Math.max(scrollTop, Math.min(maxTop, Math.round(point.y + OFFSET_PX))); // CHANGE
            div.style.left = left + "px"; // NEW
            div.style.top = top + "px"; // NEW
        } // NEW

        function addRoleCardFromOverlay(evt) { // NEW
            mxEvent.consume(evt); // NEW
            const moduleCell = currentTeamModule || selectedTeamModule(); // NEW
            if (!moduleCell) { hideOverlay(); return; } // NEW
            const point = roleCardPoint(moduleCell); // NEW
            addRoleCardToTeamModule(moduleCell, point.x, point.y); // CHANGE
            hideOverlay(); // NEW
        } // NEW

        function promptModuleMarginFromOverlay(evt) { // NEW
            mxEvent.consume(evt); // NEW
            const moduleCell = currentTeamModule || selectedTeamModule(); // NEW
            if (!moduleCell) { hideOverlay(); return; } // NEW
            hideOverlay(); // NEW
            promptSetModuleMargin(moduleCell); // NEW
        } // NEW

        function makeOverlayButton(label, onClick) { // CHANGE
            const btn = document.createElement("button"); // NEW
            btn.type = "button"; // NEW
            btn.textContent = label; // CHANGE
            btn.style.border = "1px solid #b8b8b8"; // NEW
            btn.style.borderRadius = "4px"; // NEW
            btn.style.background = "#fff"; // NEW
            btn.style.color = "#222"; // NEW
            btn.style.cursor = "pointer"; // NEW
            btn.style.font = "12px Arial, sans-serif"; // NEW
            btn.style.padding = "5px 8px"; // NEW
            btn.style.whiteSpace = "nowrap"; // NEW
            mxEvent.addListener(btn, "click", onClick); // CHANGE
            return btn; // NEW
        } // NEW

        function ensureOverlay() { // NEW
            if (overlay) return overlay; // NEW
            overlay = document.createElement("div"); // NEW
            overlay.className = "trellis-team-role-overlay"; // NEW
            overlay.style.position = "absolute"; // NEW
            overlay.style.zIndex = "10008"; // NEW
            overlay.style.display = "none"; // NEW
            overlay.style.flexDirection = "column"; // NEW
            overlay.style.gap = "4px"; // NEW
            overlay.style.padding = "4px"; // NEW
            overlay.style.background = "rgba(255,255,255,0.96)"; // NEW
            overlay.style.border = "1px solid #c7c7cc"; // NEW
            overlay.style.borderRadius = "6px"; // NEW
            overlay.style.boxShadow = "0 2px 8px rgba(0,0,0,0.16)"; // NEW
            overlay.style.font = "12px Arial, sans-serif"; // NEW
            overlay.style.pointerEvents = "auto"; // NEW
            mxEvent.addListener(overlay, "mousedown", function (evt) { mxEvent.consume(evt); }); // NEW
            mxEvent.addListener(overlay, "click", function (evt) { mxEvent.consume(evt); }); // NEW
            overlay.appendChild(makeOverlayButton("Add Role Card", addRoleCardFromOverlay)); // CHANGE
            overlay.appendChild(makeOverlayButton("Set Module Margin", promptModuleMarginFromOverlay)); // NEW
            const host = ensureOverlayHost(); // NEW
            if (host) host.appendChild(overlay); // NEW
            return overlay; // NEW
        } // NEW

        function showOverlay(cell, anchor) { // CHANGE
            currentTeamModule = cell; // NEW
            positionOverlay(anchor || moduleOverlayAnchor(cell)); // CHANGE
        } // NEW

        function refreshSelectedOverlay() { // NEW
            const cell = selectedTeamModule(); // NEW
            hideOverlay(); // NEW
            if (!cell) return; // NEW
            if (recentlyDismissedCell === cell && Date.now() - recentlyDismissedAt < 250) return; // NEW
            showOverlay(cell, overlayAnchorForCell(cell)); // CHANGE
        } // NEW

        function onDismissEvent() { // NEW
            pendingClick = null; // NEW
            hideOverlay(); // NEW
        } // NEW

        if (graph.addMouseListener) { // NEW
            graph.addMouseListener({ // NEW
                mouseDown: function (_sender, me) { // NEW
                    const evt = me && me.getEvent ? me.getEvent() : null; // NEW
                    if (eventInOverlay(evt)) return; // NEW
                    const hitCell = cellForMouseEvent(me, evt); // NEW
                    if (isOverlayVisible()) { // NEW
                        dismissOnlyClick = true; // NEW
                        pendingClick = null; // NEW
                        recentlyDismissedCell = hitCell === currentTeamModule ? currentTeamModule : null; // NEW
                        recentlyDismissedAt = recentlyDismissedCell ? Date.now() : 0; // NEW
                        hideOverlay(); // NEW
                        return; // NEW
                    } // NEW
                    dismissOnlyClick = false; // NEW
                    pendingClick = null; // NEW
                    if (!isPlainLeftMouseEvent(evt) || isDoubleClick(evt)) return; // NEW
                    pendingClick = { // NEW
                        client: eventClientPoint(evt), // NEW
                        model: modelPointForEvent(evt), // CHANGE
                        container: containerPointForEvent(evt) // NEW
                    }; // NEW
                }, // NEW
                mouseMove: function () { }, // NEW
                mouseUp: function (_sender, me) { // NEW
                    const evt = me && me.getEvent ? me.getEvent() : null; // NEW
                    if (dismissOnlyClick) { // NEW
                        dismissOnlyClick = false; // NEW
                        pendingClick = null; // NEW
                        return; // NEW
                    } // NEW
                    const start = pendingClick; // NEW
                    pendingClick = null; // NEW
                    if (eventInOverlay(evt)) return; // NEW
                    if (!isPlainLeftMouseEvent(evt) || isDoubleClick(evt) || !isSimpleClick(start, evt)) return; // NEW
                    lastClickAnchor = { model: { x: start.model.x, y: start.model.y }, container: { x: start.container.x, y: start.container.y } }; // CHANGE
                    refreshSelectedOverlay(); // NEW
                } // NEW
            }); // NEW
        } // NEW

        const selectionModel = graph.getSelectionModel ? graph.getSelectionModel() : null; // NEW
        if (selectionModel && selectionModel.addListener) selectionModel.addListener(mxEvent.CHANGE, refreshSelectedOverlay); // NEW
        if (model.addListener) model.addListener(mxEvent.CHANGE, onDismissEvent); // NEW
        if (graph.getView && graph.getView()) { // NEW
            const view = graph.getView(); // NEW
            if (view.addListener) { // NEW
                view.addListener(mxEvent.SCALE, onDismissEvent); // NEW
                view.addListener(mxEvent.TRANSLATE, onDismissEvent); // NEW
                view.addListener(mxEvent.SCALE_AND_TRANSLATE, onDismissEvent); // NEW
            } // NEW
        } // NEW
        mxEvent.addListener(document, "keydown", function (evt) { if (evt && evt.key === "Escape") hideOverlay(); }); // NEW
        graph.addListener && graph.addListener(mxEvent.DESTROY, function () { if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay); overlay = null; currentTeamModule = null; }); // NEW
    } // NEW

    function installSelectedRoleImageOverlay() { // NEW
        if (graph.__trellisSelectedRoleImageOverlayInstalled) return; // NEW
        graph.__trellisSelectedRoleImageOverlayInstalled = true; // NEW

        const OFFSET_PX = 8; // NEW
        let overlay = null; // NEW
        let button = null; // NEW
        let currentAction = null; // NEW

        function overlayHost() { // NEW
            return graph.container || null; // NEW
        } // NEW

        function ensureOverlayHost() { // NEW
            const host = overlayHost(); // NEW
            if (!host) return null; // NEW
            const style = window.getComputedStyle ? window.getComputedStyle(host) : null; // NEW
            if (style && style.position === "static") host.style.position = "relative"; // NEW
            return host; // NEW
        } // NEW

        function selectedRoleImageAction() { // NEW
            const cells = graph.getSelectionCells ? (graph.getSelectionCells() || []) : (graph.getSelectionCell ? [graph.getSelectionCell()] : []); // NEW
            if (!cells || cells.length !== 1) return null; // NEW
            const action = roleImageActionForCell(cells[0], { allowImageRowChange: true }); // CHANGE
            if (action && action.roleCard) normalizeRoleImagePlaceholder(action.roleCard); // NEW
            return action; // NEW
        } // NEW

        function anchorCellForAction(action) { // NEW
            if (!action) return null; // NEW
            if (action.mode === "change") return isRoleImageRow(action.sourceCell) || isRoleAvatar(action.sourceCell) ? action.sourceCell : action.avatar; // CHANGE
            return action.imageRow || action.roleCard; // NEW
        } // NEW

        function hideOverlay() { // NEW
            currentAction = null; // NEW
            if (overlay) overlay.style.display = "none"; // NEW
        } // NEW

        function invokeRoleImageAction(evt) { // NEW
            mxEvent.consume(evt); // NEW
            const action = currentAction; // NEW
            if (!action || !action.roleCard) { hideOverlay(); return; } // NEW
            hideOverlay(); // NEW
            selectRoleImage(ui, graph, action.roleCard); // NEW
        } // NEW

        function makeOverlayButton() { // NEW
            const btn = document.createElement("button"); // NEW
            btn.type = "button"; // NEW
            btn.style.border = "1px solid #b8b8b8"; // NEW
            btn.style.borderRadius = "4px"; // NEW
            btn.style.background = "#fff"; // NEW
            btn.style.color = "#222"; // NEW
            btn.style.cursor = "pointer"; // NEW
            btn.style.font = "12px Arial, sans-serif"; // NEW
            btn.style.padding = "5px 8px"; // NEW
            btn.style.whiteSpace = "nowrap"; // NEW
            mxEvent.addListener(btn, "click", invokeRoleImageAction); // NEW
            return btn; // NEW
        } // NEW

        function ensureOverlay() { // NEW
            if (overlay) return overlay; // NEW
            overlay = document.createElement("div"); // NEW
            overlay.className = "trellis-role-image-overlay"; // NEW
            overlay.style.position = "absolute"; // NEW
            overlay.style.zIndex = "10009"; // NEW
            overlay.style.display = "none"; // NEW
            overlay.style.padding = "4px"; // NEW
            overlay.style.background = "rgba(255,255,255,0.96)"; // NEW
            overlay.style.border = "1px solid #c7c7cc"; // NEW
            overlay.style.borderRadius = "6px"; // NEW
            overlay.style.boxShadow = "0 2px 8px rgba(0,0,0,0.16)"; // NEW
            overlay.style.font = "12px Arial, sans-serif"; // NEW
            overlay.style.pointerEvents = "auto"; // NEW
            mxEvent.addListener(overlay, "mousedown", function (evt) { mxEvent.consume(evt); }); // NEW
            mxEvent.addListener(overlay, "click", function (evt) { mxEvent.consume(evt); }); // NEW
            button = makeOverlayButton(); // NEW
            overlay.appendChild(button); // NEW
            const host = ensureOverlayHost(); // NEW
            if (host) host.appendChild(overlay); // NEW
            return overlay; // NEW
        } // NEW

        function positionOverlay(action) { // NEW
            const host = ensureOverlayHost(); // NEW
            const div = ensureOverlay(); // NEW
            const anchorCell = anchorCellForAction(action); // NEW
            const view = graph.getView ? graph.getView() : graph.view; // NEW
            const state = view && typeof view.getState === "function" && anchorCell ? view.getState(anchorCell) : null; // NEW
            if (!host || !div || !state) { hideOverlay(); return; } // NEW
            if (div.parentNode !== host) host.appendChild(div); // NEW
            if (button) button.textContent = action.mode === "change" ? "Change Image" : "Add Image"; // NEW
            currentAction = action; // NEW
            div.style.display = "flex"; // NEW
            div.style.left = "0px"; // NEW
            div.style.top = "0px"; // NEW
            const width = div.offsetWidth || 105; // NEW
            const height = div.offsetHeight || 30; // NEW
            const scrollLeft = host.scrollLeft || 0; // NEW
            const scrollTop = host.scrollTop || 0; // NEW
            const maxLeft = scrollLeft + Math.max(0, (host.clientWidth || width) - width - OFFSET_PX); // NEW
            const maxTop = scrollTop + Math.max(0, (host.clientHeight || height) - height - OFFSET_PX); // NEW
            const left = Math.max(scrollLeft, Math.min(maxLeft, Math.round(state.x + (state.width || 0) + OFFSET_PX))); // NEW
            const top = Math.max(scrollTop, Math.min(maxTop, Math.round(state.y))); // NEW
            div.style.left = left + "px"; // NEW
            div.style.top = top + "px"; // NEW
        } // NEW

        function refreshSelectedOverlay() { // NEW
            const action = selectedRoleImageAction(); // NEW
            if (!action) { hideOverlay(); return; } // NEW
            positionOverlay(action); // NEW
        } // NEW

        const selectionModel = graph.getSelectionModel ? graph.getSelectionModel() : null; // NEW
        if (selectionModel && selectionModel.addListener) selectionModel.addListener(mxEvent.CHANGE, refreshSelectedOverlay); // NEW
        if (model.addListener) model.addListener(mxEvent.CHANGE, refreshSelectedOverlay); // NEW
        if (graph.getView && graph.getView()) { // NEW
            const view = graph.getView(); // NEW
            if (view.addListener) { // NEW
                view.addListener(mxEvent.SCALE, refreshSelectedOverlay); // NEW
                view.addListener(mxEvent.TRANSLATE, refreshSelectedOverlay); // NEW
                view.addListener(mxEvent.SCALE_AND_TRANSLATE, refreshSelectedOverlay); // NEW
            } // NEW
        } // NEW
        mxEvent.addListener(document, "keydown", function (evt) { if (evt && evt.key === "Escape") hideOverlay(); }); // NEW
        graph.addListener && graph.addListener(mxEvent.DESTROY, function () { if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay); overlay = null; button = null; currentAction = null; }); // NEW
    } // NEW

    // Ensure right-click does not alter selection unexpectedly                           
    graph.popupMenuHandler && (graph.popupMenuHandler.selectOnPopup = false);

    graph.__trellisModules = { // CHANGE
        applyModuleMargins: function (moduleCell, opts) { // CHANGE
            return applyModuleMargins(moduleCell, opts); // CHANGE
        }, // CHANGE
        enforceGardenModuleMinimum: function (moduleCell) { // CHANGE
            let changed = false; // CHANGE
            model.beginUpdate(); // CHANGE
            try { // CHANGE
                changed = enforceGardenModuleMinimum(moduleCell); // CHANGE
            } finally { // CHANGE
                model.endUpdate(); // CHANGE
            } // CHANGE
            return changed; // CHANGE
        }, // CHANGE
        getGardenModuleMinimumSize: function (moduleCell) { // CHANGE
            return getModuleMinOuterSize(moduleCell); // CHANGE
        }, // CHANGE
        promptSetModuleMargin: function (moduleCell) { // NEW
            return promptSetModuleMargin(moduleCell); // NEW
        }, // NEW
        createModuleAtPoint: function (point, type) { // NEW
            return createModuleAtPoint(point, type); // NEW
        }, // CHANGE
        createRoleCard: function (moduleCell, x, y) { // NEW
            return createRoleCard(graph, moduleCell, x, y); // NEW
        }, // NEW
        selectRoleImage: function (roleCard) { // NEW
            return selectRoleImage(ui, graph, roleCard); // NEW
        } // CHANGE
    }; // CHANGE

    installRootModuleCreationOverlay(); // NEW
    installSelectedTeamModuleRoleOverlay(); // NEW
    installSelectedRoleImageOverlay(); // NEW

    graph.addListener("usl:requestApplyModuleMargins", function (_sender, evt) { // CHANGE
        const cell = evt && evt.getProperty ? evt.getProperty("cell") : null; // CHANGE
        if (!cell || !isModule(cell)) return; // CHANGE
        model.beginUpdate(); // CHANGE
        try { // CHANGE
            enforceGardenModuleMinimum(cell); // CHANGE
            applyModuleMargins(cell, { allowShrink: false }); // CHANGE
        } finally { // CHANGE
            model.endUpdate(); // CHANGE
        } // CHANGE
    }); // CHANGE

    graph.addListener("usl:requestPromptSetModuleMargin", function (_sender, evt) { // NEW
        const cell = evt && evt.getProperty ? evt.getProperty("cell") : null; // NEW
        if (!cell || !isModule(cell)) return; // NEW
        promptSetModuleMargin(cell); // NEW
    }); // NEW

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
        id: "modules", // NEW
        priority: 100, // NEW
        addItems: function (menu, cell, evt) { // CHANGE

        // Add Module on background or right-click on module
        if (!cell) {
            menu.addItem("Add Module", null, function () {
                const pt = graph.getPointForEvent(evt);
                createModuleAtPoint(pt, "regular"); // CHANGE
            });
        }

        const roleImageAction = roleImageActionForCell(cell); // NEW
        if (roleImageAction) { // NEW
            if (menu.addSeparator) menu.addSeparator(); // NEW
            menu.addItem(roleImageAction.mode === "change" ? "Change Role Image" : "Add Role Image", null, function () { // NEW
                selectRoleImage(ui, graph, roleImageAction.roleCard); // NEW
            }); // NEW
        } // NEW

        if (cell && isModule(cell)) {
            const isGarden = isGardenModule(cell);
            const isTeam = isTeamModule(cell);

            // Toggle options based on current type                                       
            if (!isGarden && !isTeam) {
                menu.addItem("Set as Garden Module", null, function () {
                    setModuleType(cell, "garden");
                });
                menu.addItem("Set as Team Module", null, function () {
                    setModuleType(cell, "team");
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
            menu.addItem("Set Module Margin (px)…", null, function () {
                promptSetModuleMargin(cell); // CHANGE
            });

            // Team module gets Add Role Card                                             
            if (isTeam) {
                menu.addItem("Add Role Card", null, function () {
                    const pt = graph.getPointForEvent(evt);
                    addRoleCardToTeamModule(cell, pt.x, pt.y); // CHANGE
                });
            }

        }
        } // CHANGE
    }); // CHANGE

});
